// Promociones y descuentos: se muestran en la tienda, se aplican al precio y se envían por email a los suscriptores.
const crypto = require('crypto');
const { db, getSettings, round2, parseProduct } = require('./db');
const mailer = require('./mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAIL_DELAY_MS = Number(process.env.MAIL_DELAY_MS || 400); // pausa entre mails para no saturar el SMTP

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function parsePromo(p) {
  return p && { ...p, product_ids: JSON.parse(p.product_ids || '[]'), show_on_site: !!p.show_on_site, active: !!p.active };
}

// Promociones vigentes hoy
function activePromos() {
  const t = today();
  return db.prepare(`SELECT * FROM promotions WHERE active = 1 AND (starts_at = '' OR starts_at <= ?) AND (ends_at = '' OR ends_at >= ?) ORDER BY id DESC`)
    .all(t, t).map(parsePromo);
}

function appliesTo(promo, product) {
  if (promo.target === 'all') return true;
  if (promo.target === 'category') return promo.target_category === product.category;
  return promo.product_ids.includes(product.id);
}

// Precio final con el mejor descuento vigente
function priceWithPromo(product, promos = activePromos()) {
  let best = null;
  for (const pr of promos) {
    if (pr.discount_pct > 0 && appliesTo(pr, product) && (!best || pr.discount_pct > best.discount_pct)) best = pr;
  }
  if (!best) return { price: product.price, list_price: product.price, discount_pct: 0, promo_label: '' };
  return {
    price: round2(product.price * (1 - best.discount_pct / 100)),
    list_price: product.price,
    discount_pct: best.discount_pct,
    promo_label: best.label || `${best.discount_pct}% OFF`,
  };
}

function subscribe(email, name = '', source = 'web') {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('Ingresá un email válido');
  const ex = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
  if (ex) {
    if (!ex.active) db.prepare('UPDATE subscribers SET active = 1, unsubscribed_at = NULL WHERE id = ?').run(ex.id);
    if (name && !ex.name) db.prepare('UPDATE subscribers SET name = ? WHERE id = ?').run(String(name).slice(0, 120), ex.id);
    return { already: !!ex.active };
  }
  db.prepare('INSERT INTO subscribers (email, name, source, token) VALUES (?,?,?,?)').run(email, String(name || '').slice(0, 120), source, crypto.randomBytes(16).toString('hex'));
  return { already: false };
}

const isSubscribed = (email) => !!db.prepare('SELECT 1 FROM subscribers WHERE email = ? AND active = 1').get(String(email || '').trim().toLowerCase());

// ---------- email de la promoción ----------
function absUrl(u) {
  if (!u) return '';
  return /^https?:\/\//.test(u) ? u : mailer.baseUrl() + (u.startsWith('/') ? '' : '/') + u;
}

function promoProducts(promo, limit = 6) {
  let rows;
  if (promo.target === 'products' && promo.product_ids.length) {
    rows = db.prepare(`SELECT * FROM products WHERE active = 1 AND id IN (${promo.product_ids.map(() => '?').join(',')})`).all(...promo.product_ids);
  } else if (promo.target === 'category') {
    rows = db.prepare('SELECT * FROM products WHERE active = 1 AND category = ? ORDER BY featured DESC, name LIMIT ?').all(promo.target_category, limit);
  } else {
    rows = db.prepare('SELECT * FROM products WHERE active = 1 AND requires_prescription = 0 ORDER BY featured DESC, name LIMIT ?').all(limit);
  }
  return rows.slice(0, limit).map(parseProduct);
}

function promoEmailHTML(promo, unsubscribeToken) {
  const s = getSettings();
  const { esc, money } = mailer;
  const c = s.color_primary || '#0f9d76';
  const products = promoProducts(promo);
  const vig = promo.ends_at ? `Válido hasta el ${promo.ends_at.split('-').reverse().join('/')}` : '';
  const cells = products.map((p) => {
    const pr = promo.discount_pct > 0 ? round2(p.price * (1 - promo.discount_pct / 100)) : p.price;
    const img = absUrl(p.images[0]);
    return `<td width="33%" valign="top" style="padding:6px"><a href="${mailer.baseUrl()}/#p-${p.id}" style="text-decoration:none;color:#1f2a27">
      <div style="border:1px solid #e3e8e6;border-radius:12px;padding:10px;text-align:center">
        ${img ? `<img src="${esc(img)}" alt="" width="120" style="width:120px;max-width:100%;height:auto;border-radius:8px">` : ''}
        <div style="font-size:13px;margin:6px 0;min-height:34px">${esc(p.name)}</div>
        ${pr < p.price ? `<div style="font-size:12px;color:#8a9692;text-decoration:line-through">${money(p.price)}</div>` : ''}
        <div style="font-size:16px;font-weight:bold;color:${c}">${money(pr)}</div></div></a></td>`;
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 3) rows.push(`<tr>${cells.slice(i, i + 3).join('')}</tr>`);
  const unsub = unsubscribeToken ? `${mailer.baseUrl()}/baja/${unsubscribeToken}` : '#';
  const inner = `
    ${promo.image ? `<img src="${esc(absUrl(promo.image))}" alt="" width="544" style="width:100%;height:auto;border-radius:12px;margin-bottom:18px">` : ''}
    ${promo.label ? `<div style="display:inline-block;background:${s.color_accent || '#ff6f61'};color:#fff;font-weight:bold;padding:6px 14px;border-radius:30px;font-size:14px">${esc(promo.label)}</div>` : ''}
    <h1 style="margin:12px 0 8px;font-size:26px">${esc(promo.title)}</h1>
    <p style="white-space:pre-line;font-size:15px;line-height:1.5;color:#33413d">${esc(promo.body)}</p>
    ${vig ? `<p style="font-size:13px;color:#5b6b66">${vig}</p>` : ''}
    ${rows.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${rows.join('')}</table>` : ''}
    ${mailer.button(s, `${mailer.baseUrl()}/#promociones`, 'Ver promociones en la tienda')}
    <p style="font-size:11px;color:#8a9692;text-align:center">Recibís este email porque te suscribiste a las novedades de ${esc(s.name)}.
      <a href="${unsub}" style="color:#8a9692">Darme de baja</a></p>`;
  return mailer.layout(s, inner);
}

function sendPromoTo(promo, sub) {
  const s = getSettings();
  const unsub = `${mailer.baseUrl()}/baja/${sub.token}`;
  return mailer.send(sub.email, `${promo.label ? promo.label + ' · ' : ''}${promo.title} - ${s.name}`, promoEmailHTML(promo, sub.token), {
    'List-Unsubscribe': `<${unsub}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendCampaign(promoId) {
  const promo = parsePromo(db.prepare('SELECT * FROM promotions WHERE id = ?').get(promoId));
  const subs = db.prepare('SELECT * FROM subscribers WHERE active = 1 ORDER BY id').all();
  db.prepare("UPDATE promotions SET send_status = 'enviando', sent_count = 0, send_total = ? WHERE id = ?").run(subs.length, promoId);
  let ok = 0;
  for (const sub of subs) {
    const r = await sendPromoTo(promo, sub);
    if (!r || !r.error) ok++;
    db.prepare('UPDATE promotions SET sent_count = ? WHERE id = ?').run(ok, promoId);
    if (MAIL_DELAY_MS) await sleep(MAIL_DELAY_MS);
  }
  db.prepare("UPDATE promotions SET send_status = 'enviada', sent_at = datetime('now','localtime') WHERE id = ?").run(promoId);
}

// ---------- rutas ----------
const PROMO_FIELDS = ['title', 'body', 'label', 'image', 'discount_pct', 'target', 'target_category', 'product_ids', 'starts_at', 'ends_at', 'show_on_site', 'active'];
function cleanPromo(b) {
  const o = {};
  for (const f of PROMO_FIELDS) if (b[f] !== undefined) o[f] = b[f];
  if (o.discount_pct !== undefined) o.discount_pct = Math.min(90, Math.max(0, Number(o.discount_pct) || 0));
  if (o.target !== undefined && !['all', 'category', 'products'].includes(o.target)) o.target = 'all';
  if (o.product_ids !== undefined) o.product_ids = JSON.stringify((Array.isArray(o.product_ids) ? o.product_ids : []).map(Number).filter(Boolean));
  for (const f of ['starts_at', 'ends_at']) if (o[f] !== undefined && o[f] && !/^\d{4}-\d{2}-\d{2}$/.test(o[f])) throw new Error('Las fechas tienen que tener formato AAAA-MM-DD');
  for (const f of ['show_on_site', 'active']) if (o[f] !== undefined) o[f] = o[f] ? 1 : 0;
  return o;
}

function register(app, admin) {
  // promociones vigentes para mostrar en la web
  app.get('/api/promotions', (_req, res) => {
    res.json(activePromos().filter((p) => p.show_on_site).map(({ id, title, body, label, image, discount_pct, target, target_category, product_ids, ends_at }) =>
      ({ id, title, body, label, image, discount_pct, target, target_category, product_ids, ends_at })));
  });

  app.post('/api/subscribe', (req, res) => {
    try { res.json({ ok: true, ...subscribe(req.body.email, req.body.name, 'web') }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // suscripción con un clic desde la página del pedido
  app.post('/api/orders/:code/subscribe', (req, res) => {
    const o = db.prepare('SELECT email, customer_name FROM orders WHERE code = ?').get(req.params.code);
    if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json({ ok: true, ...subscribe(o.email, o.customer_name, 'compra') });
  });

  // baja: GET muestra la página (para que los antivirus de email no den de baja solos), POST confirma
  const unsubscribe = (token) => {
    const sub = db.prepare('SELECT * FROM subscribers WHERE token = ?').get(token);
    if (sub && sub.active) db.prepare("UPDATE subscribers SET active = 0, unsubscribed_at = datetime('now','localtime') WHERE id = ?").run(sub.id);
    return sub;
  };
  app.get('/baja/:token', (req, res) => {
    const s = getSettings();
    const sub = db.prepare('SELECT email, active FROM subscribers WHERE token = ?').get(req.params.token);
    const { esc } = mailer;
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja de novedades</title>
      <link rel="stylesheet" href="/css/styles.css"></head><body style="display:grid;place-items:center;min-height:100vh;padding:16px">
      <div class="info-card center" style="max-width:440px"><h2>${esc(s.name)}</h2>
      ${!sub ? '<p>El link no es válido.</p>' : `<p>¿Querés dejar de recibir promociones en <b>${esc(sub.email)}</b>?</p>
        <form method="post"><button class="btn btn-primary">Sí, darme de baja</button></form>`}
      <p><a href="/">Volver a la tienda</a></p></div></body></html>`);
  });
  app.post('/baja/:token', (req, res) => {
    const sub = unsubscribe(req.params.token);
    const s = getSettings();
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja confirmada</title>
      <link rel="stylesheet" href="/css/styles.css"></head><body style="display:grid;place-items:center;min-height:100vh;padding:16px">
      <div class="info-card center" style="max-width:440px"><h2>${sub ? 'Listo, te diste de baja' : 'Link no válido'}</h2>
      <p class="muted">${sub ? `No vas a recibir más promociones de ${mailer.esc(s.name)}. Los emails de tus pedidos te van a seguir llegando.` : ''}</p>
      <p><a href="/">Volver a la tienda</a></p></div></body></html>`);
  });

  // ----- admin: promociones -----
  admin.get('/promotions', (_req, res) => {
    res.json({
      promotions: db.prepare('SELECT * FROM promotions ORDER BY id DESC').all().map(parsePromo),
      subscribers: db.prepare('SELECT COUNT(*) n FROM subscribers WHERE active = 1').get().n,
      smtp: mailer.hasSMTP(),
    });
  });
  admin.post('/promotions', (req, res) => {
    try {
      const d = cleanPromo(req.body || {});
      if (!String(d.title || '').trim()) throw new Error('Poné un título');
      const cols = Object.keys(d);
      const r = db.prepare(`INSERT INTO promotions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => d[c]));
      res.json(parsePromo(db.prepare('SELECT * FROM promotions WHERE id = ?').get(r.lastInsertRowid)));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  admin.put('/promotions/:id', (req, res) => {
    try {
      const d = cleanPromo(req.body || {});
      const cols = Object.keys(d);
      if (cols.length) db.prepare(`UPDATE promotions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => d[c]), req.params.id);
      res.json(parsePromo(db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id)));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  admin.delete('/promotions/:id', (req, res) => {
    db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  admin.get('/promotions/:id/preview', (req, res) => {
    const p = parsePromo(db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id));
    if (!p) return res.status(404).end();
    res.type('html').send(promoEmailHTML(p, null));
  });
  admin.post('/promotions/:id/test', async (req, res) => {
    const p = parsePromo(db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id));
    const to = String(req.body.email || '').trim();
    if (!p || !EMAIL_RE.test(to)) return res.status(400).json({ error: 'Ingresá un email válido para la prueba' });
    const r = await mailer.send(to, `[PRUEBA] ${p.label ? p.label + ' · ' : ''}${p.title}`, promoEmailHTML(p, null));
    if (r && r.error) return res.status(400).json({ error: 'No se pudo enviar: ' + r.error });
    res.json({ ok: true, simulated: !!(r && r.simulated) });
  });
  admin.post('/promotions/:id/send', (req, res) => {
    const p = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'No encontrada' });
    if (p.send_status === 'enviando') return res.status(400).json({ error: 'Esta promoción se está enviando' });
    const n = db.prepare('SELECT COUNT(*) n FROM subscribers WHERE active = 1').get().n;
    if (!n) return res.status(400).json({ error: 'Todavía no hay suscriptores' });
    sendCampaign(p.id).catch((e) => {
      console.error('Error enviando promoción:', e);
      db.prepare("UPDATE promotions SET send_status = 'enviada', sent_at = datetime('now','localtime') WHERE id = ?").run(p.id);
    });
    res.json({ ok: true, total: n });
  });

  // ----- admin: suscriptores -----
  admin.get('/subscribers', (_req, res) => res.json(db.prepare('SELECT id, email, name, source, active, created_at, unsubscribed_at FROM subscribers ORDER BY id DESC').all()));
  admin.post('/subscribers', (req, res) => {
    try { res.json({ ok: true, ...subscribe(req.body.email, req.body.name, 'admin') }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  admin.delete('/subscribers/:id', (req, res) => {
    db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });
  admin.get('/subscribers.csv', (_req, res) => {
    const rows = db.prepare('SELECT email, name, source, active, created_at FROM subscribers ORDER BY id').all();
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.setHeader('Content-Disposition', 'attachment; filename="suscriptores.csv"');
    res.type('text/csv').send('﻿' + ['email;nombre;origen;activo;alta', ...rows.map((r) => [r.email, r.name, r.source, r.active ? 'si' : 'no', r.created_at].map(q).join(';'))].join('\n'));
  });
}

module.exports = { register, activePromos, priceWithPromo, subscribe, isSubscribed };
