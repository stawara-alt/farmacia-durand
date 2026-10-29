// Servicio post-compra: código de llegada, reclamos (llegó roto, equivocado, etc.) y botón de arrepentimiento.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, getSettings } = require('./db');
const mailer = require('./mailer');

const DIR = path.join(__dirname, '..', 'data', 'claims');
fs.mkdirSync(DIR, { recursive: true });

const TYPES = {
  roto: 'Llegó roto o dañado',
  equivocado: 'Llegó un producto equivocado',
  faltante: 'Faltó un producto',
  vencido: 'Producto vencido o en mal estado',
  arrepentimiento: 'Me arrepentí de la compra',
  otro: 'Otro problema',
};
const RESOLUTIONS = { cambio: 'Cambio del producto', devolucion: 'Devolución del dinero', otro: 'Otra solución' };
const STATUS = { abierto: 'Recibido', en_revision: 'En revisión', resuelto: 'Resuelto', rechazado: 'Rechazado' };

const upload = multer({
  storage: multer.diskStorage({ destination: DIR, filename: (_req, f, cb) => cb(null, crypto.randomBytes(10).toString('hex') + path.extname(f.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '')) }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, f, cb) => cb(null, /^image\//.test(f.mimetype)),
});

// código corto y fácil de dictar: sin 0/O ni 1/I
function newArrivalCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (const b of crypto.randomBytes(6)) c += abc[b % abc.length];
  return `${c.slice(0, 3)}-${c.slice(3)}`;
}
// "5491155550000" -> "+54 9 11 5555-0000" (deja igual lo que ya viene con formato)
const fmtPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  const m = d.match(/^549(11|\d{3})(\d{3,4})(\d{4})$/);
  return /^\d+$/.test(String(p || '').trim()) && m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : String(p || '');
};
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// fecha límite para reclamar (YYYY-MM-DD HH:MM:SS) o null si no fue entregado
function claimDeadline(order, s = getSettings()) {
  if (!order.delivered_at) return null;
  const d = new Date(order.delivered_at.replace(' ', 'T'));
  d.setDate(d.getDate() + Number(s.claim_days || 10));
  return localDate(d);
}
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const forOrder = (orderId) => db.prepare('SELECT id, type, status, created_at FROM claims WHERE order_id = ? ORDER BY id').all(orderId)
  .map((c) => ({ ...c, type_label: TYPES[c.type], status_label: STATUS[c.status] }));

function loadClaim(id) {
  const c = db.prepare(`SELECT c.*, o.customer_name, o.email, o.phone, o.code order_code, o.total, o.arrival_code, o.delivered_at
    FROM claims c JOIN orders o ON o.id = c.order_id WHERE c.id = ?`).get(id);
  if (!c) return null;
  c.photos = JSON.parse(c.photos || '[]');
  c.messages = db.prepare('SELECT author, status, message, created_at FROM claim_messages WHERE claim_id = ? ORDER BY id').all(c.id);
  c.items = db.prepare('SELECT name, qty, unit_price FROM order_items WHERE order_id = ?').all(c.order_id);
  c.type_label = TYPES[c.type]; c.status_label = STATUS[c.status]; c.resolution_label = RESOLUTIONS[c.resolution] || '';
  return c;
}

// ---------- emails ----------
function contactBlock(s) {
  const owner = s.owner_phone || s.whatsapp;
  const wa = String(owner || '').replace(/\D/g, '');
  return `<div style="background:#f0faf6;border-radius:10px;padding:14px;font-size:14px;margin-top:16px">
    <b>¿Necesitás hablar con nosotros?</b><br>WhatsApp / celular: <a href="https://wa.me/${wa}">${mailer.esc(fmtPhone(owner))}</a><br>Teléfono de la farmacia: ${mailer.esc(s.phone)}</div>`;
}

function deliveredBlock(order) {
  const s = getSettings();
  const link = `${mailer.baseUrl()}/reclamo?pedido=${order.id}&codigo=${encodeURIComponent(order.arrival_code)}`;
  return `<div style="border:2px dashed ${s.color_primary || '#0f9d76'};border-radius:12px;padding:16px;text-align:center;margin:18px 0">
      <div style="font-size:13px;color:#5b6b66">Tu código de llegada</div>
      <div style="font-size:28px;font-weight:bold;letter-spacing:3px;margin:4px 0">${mailer.esc(order.arrival_code)}</div>
      <div style="font-size:13px;color:#5b6b66">Guardalo: lo vas a necesitar si tenés algún problema con el pedido.</div></div>
    <p style="font-size:14px">¿Llegó algo roto, faltó un producto o hubo un error? Tenés <b>${Number(s.claim_days || 10)} días</b> para avisarnos:</p>
    ${mailer.button(s, link, 'Iniciar un reclamo')}
    ${contactBlock(s)}`;
}

function notifyNewClaim(c) {
  const s = getSettings();
  const { esc } = mailer;
  mailer.send(c.email, `Recibimos tu reclamo #${c.id} - ${s.name}`, mailer.layout(s, `
    <h2 style="margin:0 0 8px">Recibimos tu reclamo #${c.id}</h2>
    <p>Hola ${esc(c.customer_name.split(' ')[0])}, registramos tu reclamo por el pedido <b>#${c.order_id}</b>: <b>${esc(c.type_label)}</b>.</p>
    <p>Lo vamos a revisar y te respondemos por este medio. Podés seguirlo desde la página de tu pedido.</p>
    ${mailer.button(s, `${mailer.baseUrl()}/pedido/${c.order_code}`, 'Ver mi pedido')}
    ${contactBlock(s)}`));
  const adminTo = process.env.ADMIN_EMAIL || s.email;
  if (adminTo) mailer.send(adminTo, `⚠️ Nuevo reclamo #${c.id} - pedido #${c.order_id}: ${c.type_label}`, mailer.layout(s, `
    <h2>Nuevo reclamo #${c.id}</h2>
    <p><b>${esc(c.customer_name)}</b> · ${esc(c.email)} · ${esc(c.contact_phone || c.phone)}</p>
    <p><b>Pedido:</b> #${c.order_id} · <b>Motivo:</b> ${esc(c.type_label)} · <b>Pide:</b> ${esc(c.resolution_label || '-')}</p>
    <p style="white-space:pre-wrap">${esc(c.description)}</p>
    <p>${c.photos.length} foto(s) adjunta(s).</p>
    ${mailer.button(s, `${mailer.baseUrl()}/admin#reclamos`, 'Ver en el panel')}`));
}

function notifyClaimUpdate(c, message) {
  const s = getSettings();
  const { esc } = mailer;
  mailer.send(c.email, `Reclamo #${c.id}: ${c.status_label} - ${s.name}`, mailer.layout(s, `
    <h2 style="margin:0 0 8px">Tu reclamo #${c.id}: ${esc(c.status_label)}</h2>
    <p>Pedido #${c.order_id} · ${esc(c.type_label)}</p>
    ${message ? `<div style="background:#fff7e6;border-radius:10px;padding:14px;font-size:14px;white-space:pre-wrap"><b>Respuesta de la farmacia:</b><br>${esc(message)}</div>` : ''}
    ${mailer.button(s, `${mailer.baseUrl()}/pedido/${c.order_code}`, 'Ver mi pedido')}
    ${contactBlock(s)}`));
}

// ---------- rutas ----------
function register(app, admin) {
  // validar pedido + código antes de mostrar el formulario
  app.post('/api/claims/check', (req, res) => {
    const r = verify(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    const o = r.order;
    res.json({ ok: true, order_id: o.id, customer_name: o.customer_name, items: db.prepare('SELECT name, qty FROM order_items WHERE order_id = ?').all(o.id), claims: forOrder(o.id) });
  });

  app.post('/api/claims', upload.array('photos', 5), (req, res) => {
    const b = req.body || {};
    const cleanup = () => (req.files || []).forEach((f) => fs.rm(f.path, () => {}));
    const r = verify(b);
    if (r.error) { cleanup(); return res.status(400).json({ error: r.error }); }
    if (!TYPES[b.type]) { cleanup(); return res.status(400).json({ error: 'Elegí el motivo del reclamo' }); }
    const desc = String(b.description || '').trim();
    if (desc.length < 5) { cleanup(); return res.status(400).json({ error: 'Contanos qué pasó' }); }
    const ins = db.prepare('INSERT INTO claims (order_id, type, description, resolution, photos, contact_phone) VALUES (?,?,?,?,?,?)')
      .run(r.order.id, b.type, desc.slice(0, 4000), RESOLUTIONS[b.resolution] ? b.resolution : '', JSON.stringify((req.files || []).map((f) => f.filename)), String(b.contact_phone || '').slice(0, 60));
    db.prepare("INSERT INTO claim_messages (claim_id, author, status, message) VALUES (?, 'cliente', 'abierto', ?)").run(ins.lastInsertRowid, desc.slice(0, 4000));
    const c = loadClaim(ins.lastInsertRowid);
    notifyNewClaim(c);
    res.json({ ok: true, id: c.id, order_code: c.order_code });
  });

  // ----- admin -----
  admin.get('/claims', (req, res) => {
    const st = req.query.status;
    res.json(db.prepare(`SELECT c.id, c.order_id, c.type, c.status, c.created_at, c.updated_at, o.customer_name, o.total
      FROM claims c JOIN orders o ON o.id = c.order_id ${st ? 'WHERE c.status = ?' : ''} ORDER BY c.id DESC LIMIT 500`).all(...(st ? [st] : []))
      .map((c) => ({ ...c, type_label: TYPES[c.type], status_label: STATUS[c.status] })));
  });
  admin.get('/claims/:id', (req, res) => {
    const c = loadClaim(req.params.id);
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    res.json(c);
  });
  admin.patch('/claims/:id', (req, res) => {
    const { status, message = '', notify = true } = req.body || {};
    if (!STATUS[status]) return res.status(400).json({ error: 'Estado inválido' });
    const c0 = db.prepare('SELECT id FROM claims WHERE id = ?').get(req.params.id);
    if (!c0) return res.status(404).json({ error: 'No encontrado' });
    db.prepare("UPDATE claims SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, c0.id);
    db.prepare("INSERT INTO claim_messages (claim_id, author, status, message) VALUES (?, 'farmacia', ?, ?)").run(c0.id, status, String(message).slice(0, 4000));
    const c = loadClaim(c0.id);
    if (notify) notifyClaimUpdate(c, message);
    res.json(c);
  });
  admin.get('/claims-photo/:file', (req, res) => {
    const full = path.join(DIR, path.basename(req.params.file));
    if (!fs.existsSync(full)) return res.status(404).end();
    res.sendFile(full);
  });
}

// pedido + código de llegada (o, para el botón de arrepentimiento, pedido + email de la compra)
function verify(b) {
  const id = parseInt(String(b.order_id || '').replace(/\D/g, ''), 10);
  const o = id ? db.prepare('SELECT * FROM orders WHERE id = ?').get(id) : null;
  if (!o) return { error: 'No encontramos ese número de pedido' };
  const s = getSettings();
  if (b.type === 'arrepentimiento' && !b.arrival_code) {
    if (String(b.email || '').trim().toLowerCase() !== o.email.toLowerCase()) return { error: 'El email no coincide con el de la compra' };
    if (['cancelado', 'rechazado'].includes(o.status)) return { error: 'Ese pedido ya está cancelado' };
    if (o.delivered_at && claimDeadline(o, s) < localDate()) return { error: `Pasaron más de ${s.claim_days || 10} días desde la entrega. Escribinos por WhatsApp.` };
    return { order: o };
  }
  if (o.status !== 'entregado' || !o.arrival_code) return { error: 'El código de llegada se envía por email cuando el pedido se entrega. Si todavía no llegó, escribinos por WhatsApp.' };
  if (normCode(b.arrival_code) !== normCode(o.arrival_code)) return { error: 'El código de llegada no es correcto. Lo encontrás en el email "Tu pedido llegó".' };
  if (claimDeadline(o, s) < localDate()) return { error: `El plazo para reclamar (${s.claim_days || 10} días desde la entrega) ya venció. Escribinos por WhatsApp y lo vemos.` };
  return { order: o };
}

module.exports = { register, newArrivalCode, claimDeadline, forOrder, deliveredBlock, TYPES, STATUS };
