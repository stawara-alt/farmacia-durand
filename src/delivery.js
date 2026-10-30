// Reparto: etiquetas con QR para cada paquete y página para el celular del repartidor.
// El repartidor escanea el QR de la etiqueta (el pedido pasa a "En camino"), ve sus entregas en el orden recomendado
// y toca "Entregado" (o "No pude entregar") en cada una.
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db, getSettings, setSettings } = require('./db');
const mailer = require('./mailer');
const geo = require('./geo');

const PREFS = { mano: 'Entregar en mano', portero: 'Dejar al portero / encargado', puerta: 'Dejar en la puerta' };
const FAIL_REASONS = { ausente: 'No había nadie', direccion: 'Dirección incorrecta o incompleta', no_atiende: 'No atiende el teléfono', rechazo: 'Rechazó el pedido', otro: 'Otro motivo' };
const SCANNABLE = ['aceptado', 'en_preparacion', 'no_entregado'];

// el QR de la etiqueta lleva el número de pedido y un pedazo del código secreto, para que no se pueda adivinar
const scanKey = (o) => String(o.code).slice(0, 8);
const scanUrl = (o) => `${mailer.baseUrl()}/reparto?o=${o.id}&k=${scanKey(o)}`;

// ---------- sesión del repartidor (PIN que define la dueña en el panel) ----------
const drivers = new Map(); // token -> { name, exp }
const attempts = new Map();
function driverOf(req) {
  const t = req.cookies.driver_session;
  const d = t && drivers.get(t);
  return d && d.exp > Date.now() ? d : null;
}
function requireDriver(req, res, next) {
  const d = driverOf(req);
  if (!d) return res.status(401).json({ error: 'Ingresá con tu nombre y el PIN de reparto' });
  req.driver = d;
  next();
}

function publicStop(o) {
  const items = db.prepare('SELECT name, qty FROM order_items WHERE order_id = ?').all(o.id);
  return {
    id: o.id, customer_name: o.customer_name, phone: o.phone, address: o.address, city: o.city, zone: o.shipping_zone,
    delivery_pref: o.delivery_pref || 'mano', pref_label: PREFS[o.delivery_pref] || PREFS.mano, notes: o.notes,
    items, units: items.reduce((a, i) => a + i.qty, 0), out_at: o.out_at, km_from_prev: o.km_from_prev,
    maps: `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(`${o.address}, ${o.city}, Argentina`)}`,
  };
}

function register(app, admin, { setOrderStatus, notifyStatus }) {
  app.post('/api/reparto/login', (req, res) => {
    const ip = req.ip, a = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
    if (a.n >= 10) return res.status(429).json({ error: 'Demasiados intentos. Probá en 15 minutos.' });
    const name = String((req.body || {}).name || '').trim().slice(0, 40);
    const pin = String((req.body || {}).pin || '').trim();
    const ok = pin && crypto.timingSafeEqual(crypto.createHash('sha256').update(pin).digest(), crypto.createHash('sha256').update(String(getSettings().delivery_pin)).digest());
    if (!name || !ok) { a.n++; attempts.set(ip, a); return res.status(401).json({ error: !name ? 'Escribí tu nombre' : 'PIN incorrecto' }); }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    drivers.set(token, { name, exp: Date.now() + 16 * 3600e3 }); // dura una jornada
    res.cookie('driver_session', token, { httpOnly: true, sameSite: 'lax', secure: String(process.env.BASE_URL || '').startsWith('https'), maxAge: 16 * 3600e3 });
    res.json({ ok: true, name });
  });
  app.post('/api/reparto/logout', (req, res) => { drivers.delete(req.cookies.driver_session); res.clearCookie('driver_session'); res.json({ ok: true }); });
  app.get('/api/reparto/me', requireDriver, (req, res) => res.json({ name: req.driver.name }));

  // escanear la etiqueta: el pedido sale de la farmacia con este repartidor
  app.post('/api/reparto/scan', requireDriver, (req, res) => {
    const id = parseInt((req.body || {}).o, 10);
    const o = id ? db.prepare('SELECT * FROM orders WHERE id = ?').get(id) : null;
    if (!o) return res.status(404).json({ error: 'No encontramos ese pedido' });
    if (req.body.k && req.body.k !== scanKey(o)) return res.status(400).json({ error: 'Esta etiqueta no corresponde al pedido. Pedí que la vuelvan a imprimir.' });
    if (!req.body.k && String(req.body.manual) !== '1') return res.status(400).json({ error: 'Falta el código de la etiqueta' });
    if (o.delivery_method !== 'envio') return res.status(400).json({ error: `El pedido #${o.id} es para retirar en la farmacia, no para envío.` });
    if (o.status === 'en_envio') {
      if (o.driver && o.driver !== req.driver.name) return res.status(400).json({ error: `El pedido #${o.id} ya lo lleva ${o.driver}.` });
      return res.json({ ok: true, already: true, id: o.id, customer_name: o.customer_name });
    }
    if (o.status === 'pendiente') return res.status(400).json({ error: `El pedido #${o.id} todavía no fue aceptado (falta confirmar el pago). No lo saques.` });
    if (!SCANNABLE.includes(o.status)) return res.status(400).json({ error: `El pedido #${o.id} está "${mailer.STATUS[o.status]?.label || o.status}": no se puede sacar a reparto.` });
    try {
      const order = setOrderStatus(o.id, 'en_envio', `Salió con ${req.driver.name}`, { driver: req.driver.name, out_at: new Date().toISOString() });
      notifyStatus(order, '');
      res.json({ ok: true, id: o.id, customer_name: o.customer_name });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // mis entregas, en el orden recomendado
  app.get('/api/reparto/route', requireDriver, (req, res) => {
    const mine = db.prepare("SELECT * FROM orders WHERE status = 'en_envio' AND delivery_method = 'envio' AND driver = ? ORDER BY id").all(req.driver.name);
    const { stops, total_km } = geo.route(mine);
    const done = db.prepare("SELECT COUNT(*) n FROM orders WHERE driver = ? AND status = 'entregado' AND date(delivered_at) = date('now','localtime')").get(req.driver.name).n;
    const failed = db.prepare("SELECT COUNT(*) n FROM orders WHERE driver = ? AND status = 'no_entregado' AND date(updated_at) = date('now','localtime')").get(req.driver.name).n;
    res.json({ driver: req.driver.name, stops: stops.map(publicStop), total_km, maps_links: geo.mapsLinks(stops), delivered_today: done, failed_today: failed, fail_reasons: FAIL_REASONS });
  });

  app.post('/api/reparto/deliver', requireDriver, (req, res) => {
    const o = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'en_envio'").get(req.body.id);
    if (!o) return res.status(400).json({ error: 'Ese pedido no está en camino' });
    if (o.driver && o.driver !== req.driver.name) return res.status(403).json({ error: `Ese pedido lo lleva ${o.driver}` });
    const how = PREFS[req.body.how] || PREFS[o.delivery_pref] || PREFS.mano;
    const note = `Entregado por ${req.driver.name} · ${how}${req.body.note ? ` · ${String(req.body.note).slice(0, 200)}` : ''}`;
    const order = setOrderStatus(o.id, 'entregado', note, { delivery_note: note });
    notifyStatus(order, how === PREFS.puerta ? 'Lo dejamos en la puerta, como pediste.' : how === PREFS.portero ? 'Lo dejamos al portero / encargado, como pediste.' : '');
    res.json({ ok: true });
  });

  app.post('/api/reparto/fail', requireDriver, (req, res) => {
    const o = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'en_envio'").get(req.body.id);
    if (!o) return res.status(400).json({ error: 'Ese pedido no está en camino' });
    if (o.driver && o.driver !== req.driver.name) return res.status(403).json({ error: `Ese pedido lo lleva ${o.driver}` });
    const reason = FAIL_REASONS[req.body.reason] || FAIL_REASONS.otro;
    const note = `${reason}${req.body.note ? ` · ${String(req.body.note).slice(0, 200)}` : ''} (${req.driver.name})`;
    const order = setOrderStatus(o.id, 'no_entregado', note, { delivery_note: note });
    notifyStatus(order, reason);
    res.json({ ok: true });
  });

  // ---------- panel: resumen del reparto, etiquetas y PIN ----------
  admin.get('/reparto', (_req, res) => {
    const list = (where) => db.prepare(`SELECT id, customer_name, address, city, shipping_zone, delivery_pref, status, driver, out_at, delivered_at, delivery_note, updated_at
      FROM orders WHERE delivery_method = 'envio' AND ${where} ORDER BY id`).all();
    res.json({
      pin: getSettings().delivery_pin, url: `${mailer.baseUrl()}/reparto`,
      ready: list("status IN ('aceptado','en_preparacion')"),
      on_route: list("status = 'en_envio'"),
      failed: list("status = 'no_entregado'"),
      delivered_today: list("status = 'entregado' AND date(delivered_at) = date('now','localtime')"),
    });
  });
  admin.put('/reparto/pin', (req, res) => {
    const pin = String((req.body || {}).pin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'El PIN tiene que tener entre 4 y 8 números' });
    setSettings({ delivery_pin: pin });
    drivers.clear(); // los repartidores vuelven a ingresar con el PIN nuevo
    res.json({ ok: true, pin });
  });

  // etiquetas imprimibles: ?ids=1,2,3 o ?ready=1 (todos los listos para salir)
  admin.get('/labels', async (req, res) => {
    const s = getSettings();
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
    const orders = req.query.ready
      ? db.prepare("SELECT * FROM orders WHERE delivery_method = 'envio' AND status IN ('aceptado','en_preparacion') ORDER BY id").all()
      : ids.map((id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id)).filter(Boolean);
    const { esc, money } = mailer;
    const cards = [];
    for (const o of orders) {
      const qr = await QRCode.toDataURL(scanUrl(o), { width: 220, margin: 1 });
      const units = db.prepare('SELECT COALESCE(SUM(qty),0) n FROM order_items WHERE order_id = ?').get(o.id).n;
      cards.push(`<div class="label">
        <div class="top"><b>${esc(s.name)}</b><span>${esc(s.phone)}</span></div>
        <div class="num">#${o.id}</div>
        <div class="main"><div>
          <div class="name">${esc(o.customer_name)}</div>
          <div class="addr">${esc(o.address)}<br>${esc(o.city)}${o.shipping_zone ? ` · ${esc(o.shipping_zone)}` : ''}</div>
          <div>Tel: <b>${esc(o.phone || '-')}</b></div>
          <div class="pref">${esc(PREFS[o.delivery_pref] || PREFS.mano)}</div>
          ${o.notes ? `<div class="notes">Nota: ${esc(o.notes)}</div>` : ''}
          <div class="small">${units} unidad(es) · ${o.status === 'pendiente' ? 'PAGO PENDIENTE' : 'Pagado'} · ${money(o.total)}</div>
        </div><div class="qr"><img src="${qr}" alt=""><small>Escanear con la página de reparto</small></div></div>
      </div>`);
    }
    res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas de envío</title><style>
      body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:12px;background:#eee}
      .bar{margin-bottom:12px;display:flex;gap:10px;align-items:center}.bar button{font-size:16px;padding:8px 16px;cursor:pointer}
      .sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:10px}
      .label{background:#fff;border:2px dashed #555;padding:12px;page-break-inside:avoid;break-inside:avoid}
      .top{display:flex;justify-content:space-between;font-size:13px;border-bottom:2px solid #000;padding-bottom:4px}
      .num{font-size:40px;font-weight:900;margin:4px 0}.main{display:flex;gap:10px;justify-content:space-between}
      .name{font-size:20px;font-weight:700}.addr{font-size:17px;margin:4px 0}.pref{margin-top:6px;font-weight:700;border:2px solid #000;display:inline-block;padding:2px 8px}
      .notes{margin-top:4px;font-size:13px}.small{margin-top:6px;font-size:12px;color:#333}.qr{text-align:center}.qr img{width:130px;height:130px}.qr small{display:block;font-size:10px;width:130px}
      @media print{body{background:#fff;padding:0}.bar{display:none}.label{border-color:#000}}
    </style></head><body>
      <div class="bar"><button onclick="print()">🖨️ Imprimir</button><span>${orders.length} etiqueta(s). Pegá cada una en su paquete.</span></div>
      <div class="sheet">${cards.join('') || '<p>No hay pedidos para etiquetar.</p>'}</div></body></html>`);
  });

  // QR con el link a la página de reparto (para abrirla en el celular del repartidor)
  admin.get('/reparto/qr.png', async (_req, res) => {
    res.type('png').send(await QRCode.toBuffer(`${mailer.baseUrl()}/reparto`, { width: 260, margin: 1 }));
  });
}

module.exports = { register, PREFS };
