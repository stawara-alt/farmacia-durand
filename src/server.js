require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const QRCode = require('qrcode');

const { db, getSettings, setSettings, unitTotalCost, round2, parseProduct, recordStock, recordPrice } = require('./db');
const mailer = require('./mailer');
const { fetchSellerProducts } = require('./mercadolibre');
const { parseCSV, num } = require('./csv');
const sheets = require('./sheets');
const promotions = require('./promotions');
const rules = require('./rules');
const claims = require('./claims');
const launch = require('./launch');
const geo = require('./geo');
const delivery = require('./delivery');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const RECEIPTS = path.join(ROOT, 'data', 'receipts');
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(RECEIPTS, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const STATUSES = Object.keys(mailer.STATUS);
const INACTIVE = ['cancelado', 'rechazado']; // estados que devuelven el stock

// ---------- uploads ----------
const randName = (orig) => crypto.randomBytes(10).toString('hex') + path.extname(orig || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
const imageUpload = multer({
  storage: multer.diskStorage({ destination: UPLOADS, filename: (_req, f, cb) => cb(null, randName(f.originalname)) }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, /^image\//.test(f.mimetype)),
});
const receiptUpload = multer({
  storage: multer.diskStorage({ destination: RECEIPTS, filename: (_req, f, cb) => cb(null, randName(f.originalname)) }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, /^image\//.test(f.mimetype) || f.mimetype === 'application/pdf'),
});
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- auth admin ----------
const sessions = new Map(); // token -> expira
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'farmacia123';
if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  Usando contraseña de admin por defecto. Definí ADMIN_PASSWORD en .env');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAdminReq(req) {
  const t = req.cookies.admin_session;
  const exp = t && sessions.get(t);
  return !!exp && exp > Date.now();
}

function requireAdmin(req, res, next) {
  if (!isAdminReq(req)) return res.status(401).json({ error: 'No autorizado' });
  next();
}

const loginAttempts = new Map();
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Demasiados intentos. Probá en 15 minutos.' });
  const { user, password } = req.body || {};
  if (!safeEqual(user || '', ADMIN_USER) || !safeEqual(password || '', ADMIN_PASSWORD)) {
    a.n++; loginAttempts.set(ip, a);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + 7 * 24 * 3600e3);
  res.cookie('admin_session', token, { httpOnly: true, sameSite: 'lax', secure: String(process.env.BASE_URL || '').startsWith('https'), maxAge: 7 * 24 * 3600e3 });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(req.cookies.admin_session);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (_req, res) => res.json({ ok: true, user: ADMIN_USER }));

// ---------- helpers ----------
// precio público: aplica el mejor descuento vigente (list_price = precio sin descuento)
const publicProduct = (p, promos = promotions.activePromos()) => {
  const x = { ...parseProduct(p), ...promotions.priceWithPromo(p, promos) };
  delete x.cost; delete x.shipping_cost; delete x.iva_rate; delete x.barcode;
  return x;
};

function loadOrder(where, val) {
  const o = db.prepare(`SELECT * FROM orders WHERE ${where} = ?`).get(val);
  if (!o) return null;
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  o.history = db.prepare('SELECT status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY id').all(o.id);
  return o;
}


// ================= API PÚBLICA =================
app.get('/api/settings', (_req, res) => {
  const s = getSettings();
  // datos internos que no van a la web pública
  for (const k of ['ml_access_token', 'ml_seller_id', 'launch_checks', 'page_fixed_monthly', 'page_fee_pct', 'page_units_month', 'default_markup', 'price_rounding', 'shipping_fee', 'free_shipping_from']) delete s[k];
  s.shipping_zones = JSON.stringify(rules.shippingZones().filter((z) => z.enabled));
  if (!s.owner_phone) s.owner_phone = s.whatsapp;
  res.json(s);
});

app.get('/api/products', (req, res) => {
  const { q, category } = req.query;
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR brand LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY featured DESC, name';
  const promos = promotions.activePromos();
  res.json(db.prepare(sql).all(...params).map((p) => publicProduct(p, promos)));
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(publicProduct(p));
});

app.get('/api/categories', (_req, res) => {
  res.json(db.prepare("SELECT category AS name, COUNT(*) AS count FROM products WHERE active = 1 GROUP BY category ORDER BY category").all());
});

app.post('/api/orders', (req, res) => {
  // mientras la tienda está cerrada solo la dueña (con sesión iniciada) puede hacer compras de prueba
  if (!launch.isOpen() && !isAdminReq(req)) return res.status(403).json({ error: 'La tienda online todavía no está abierta. ¡Muy pronto!' });
  const b = req.body || {};
  const s = getSettings();
  const email = String(b.email || '').trim();
  if (!String(b.customer_name || '').trim()) return res.status(400).json({ error: 'Ingresá tu nombre' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ingresá un email válido' });
  if (!['transferencia', 'qr'].includes(b.payment_method)) return res.status(400).json({ error: 'Elegí un medio de pago' });
  if (!['envio', 'retiro'].includes(b.delivery_method)) return res.status(400).json({ error: 'Elegí envío o retiro' });
  if (b.delivery_method === 'envio' && !String(b.address || '').trim()) return res.status(400).json({ error: 'Ingresá la dirección de envío' });
  const deliveryPref = ['mano', 'portero', 'puerta'].includes(b.delivery_pref) ? b.delivery_pref : 'mano';
  if (b.delivery_method === 'envio' && !rules.zoneFor(b.city, s)) {
    return res.status(400).json({ error: `Por ahora no hacemos envíos a "${b.city || 'esa localidad'}". Podés elegir retiro en la farmacia o escribirnos por WhatsApp.` });
  }
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'El carrito está vacío' });

  try {
    const promos = promotions.activePromos();
    const order = db.transaction(() => {
      let subtotal = 0;
      const lines = [];
      for (const it of b.items) {
        const qty = Math.max(1, parseInt(it.qty, 10) || 1);
        const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(it.id);
        if (!p) throw new Error('Un producto del carrito ya no está disponible');
        if (p.requires_prescription) throw new Error(`"${p.name}" requiere receta. Consultanos por WhatsApp.`);
        if (p.stock < qty) throw new Error(`No hay stock suficiente de "${p.name}" (disponible: ${p.stock})`);
        const price = promotions.priceWithPromo(p, promos).price;
        subtotal += price * qty;
        lines.push({ p, qty, price });
      }
      subtotal = round2(subtotal);
      const quote = b.delivery_method === 'envio' ? rules.shippingQuote(subtotal, b.city, s) : null;
      const shipping = quote ? quote.fee : 0;
      const code = crypto.randomBytes(12).toString('base64url');
      const r = db.prepare(`INSERT INTO orders (code, customer_name, email, phone, delivery_method, address, city, shipping_zone, delivery_pref, notes, payment_method, subtotal, shipping_fee, total)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, b.customer_name.trim(), email, b.phone || '', b.delivery_method, b.address || '', quote ? b.city : '', quote ? quote.zone : '', b.delivery_method === 'envio' ? deliveryPref : null, b.notes || '', b.payment_method, subtotal, shipping, round2(subtotal + shipping));
      const orderId = r.lastInsertRowid;
      for (const { p, qty, price } of lines) {
        const imgs = JSON.parse(p.images || '[]');
        db.prepare('INSERT INTO order_items (order_id, product_id, name, image, unit_price, unit_cost_total, qty) VALUES (?,?,?,?,?,?,?)')
          .run(orderId, p.id, p.name, imgs[0] || null, price, unitTotalCost(p), qty);
        const after = p.stock - qty;
        db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, p.id);
        recordStock(p.id, -qty, after, 'venta', `pedido #${orderId}`);
      }
      db.prepare('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)').run(orderId, 'pendiente', 'Pedido recibido');
      return loadOrder('id', orderId);
    })();
    if (b.subscribe) {
      try { promotions.subscribe(email, b.customer_name, 'compra'); } catch {}
    }
    mailer.sendOrderCreated(order);
    geo.locateOrder(order.id).catch(() => {}); // ubicación para el recorrido de reparto (en segundo plano)
    res.json({ ok: true, code: order.code, id: order.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/orders/:code', (req, res) => {
  const o = loadOrder('code', req.params.code);
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  const s = getSettings();
  res.json({
    id: o.id, code: o.code, customer_name: o.customer_name, status: o.status, status_label: mailer.STATUS[o.status]?.label,
    delivery_method: o.delivery_method, address: o.address, city: o.city, payment_method: o.payment_method,
    subtotal: o.subtotal, shipping_fee: o.shipping_fee, total: o.total, created_at: o.created_at, has_receipt: !!o.receipt, subscribed: promotions.isSubscribed(o.email),
    items: o.items.map(({ name, image, unit_price, qty }) => ({ name, image, unit_price, qty })),
    history: o.history,
    delivery_pref: o.delivery_pref, arrival_code: o.status === 'entregado' ? o.arrival_code : null, delivered_at: o.delivered_at, shipping_zone: o.shipping_zone,
    claim_until: claims.claimDeadline(o, s), claims: claims.forOrder(o.id),
    owner_phone: s.owner_phone || s.whatsapp,
    payment: { bank_holder: s.bank_holder, bank_cuit: s.bank_cuit, bank_name: s.bank_name, bank_cbu: s.bank_cbu, bank_alias: s.bank_alias, qr_image: s.qr_image },
  });
});

app.get('/api/orders/:code/qr.png', async (req, res) => {
  const o = db.prepare('SELECT id, total FROM orders WHERE code = ?').get(req.params.code);
  if (!o) return res.status(404).end();
  const s = getSettings();
  const text = s.qr_text || `Pago pedido #${o.id} - ${s.name} - Alias: ${s.bank_alias} - Monto: $${o.total}`;
  res.type('png').send(await QRCode.toBuffer(text, { width: 320, margin: 1, color: { dark: '#1f2a27' } }));
});

app.post('/api/orders/:code/receipt', receiptUpload.single('receipt'), (req, res) => {
  const o = db.prepare('SELECT id FROM orders WHERE code = ?').get(req.params.code);
  if (!o || !req.file) return res.status(400).json({ error: 'No se pudo subir el comprobante (imagen o PDF, máx 8MB)' });
  db.prepare("UPDATE orders SET receipt = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(req.file.filename, o.id);
  db.prepare('INSERT INTO order_status_history (order_id, status, note) VALUES (?, (SELECT status FROM orders WHERE id = ?), ?)').run(o.id, o.id, 'El cliente subió el comprobante de pago');
  res.json({ ok: true });
});

app.post('/api/contact', (req, res) => {
  const { name, email, phone, message } = req.body || {};
  if (!String(name || '').trim() || !String(message || '').trim()) return res.status(400).json({ error: 'Completá tu nombre y el mensaje' });
  const m = { name: String(name).slice(0, 120), email: String(email || '').slice(0, 160), phone: String(phone || '').slice(0, 60), message: String(message).slice(0, 4000) };
  db.prepare('INSERT INTO messages (name, email, phone, message) VALUES (?,?,?,?)').run(m.name, m.email, m.phone, m.message);
  mailer.sendContactNotice(m);
  res.json({ ok: true });
});

// ================= API ADMIN =================
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/dashboard', (_req, res) => {
  const month = lastMonths(1)[0];
  const k = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue FROM orders WHERE strftime('%Y-%m', created_at) = ? AND status NOT IN ('cancelado','rechazado')`).get(month);
  res.json({
    pending: db.prepare("SELECT COUNT(*) n FROM orders WHERE status = 'pendiente'").get().n,
    active: db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('aceptado','en_preparacion','en_envio','listo_retiro')").get().n,
    month_orders: k.n, month_revenue: k.revenue,
    low_stock: db.prepare('SELECT COUNT(*) n FROM products WHERE active = 1 AND stock <= 3').get().n,
    unread_messages: db.prepare('SELECT COUNT(*) n FROM messages WHERE read = 0').get().n,
    open_claims: db.prepare("SELECT COUNT(*) n FROM claims WHERE status IN ('abierto','en_revision')").get().n,
    launch_pending: launch.isOpen() ? 0 : launch.checklist().pending,
  });
});

// ----- pedidos -----
admin.get('/orders', (req, res) => {
  const { status, q } = req.query;
  let sql = 'SELECT o.*, (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) units FROM orders o WHERE 1=1';
  const p = [];
  if (status) { sql += ' AND status = ?'; p.push(status); }
  if (q) { sql += ' AND (customer_name LIKE ? OR email LIKE ? OR CAST(id AS TEXT) = ?)'; p.push(`%${q}%`, `%${q}%`, q); }
  sql += ' ORDER BY id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...p));
});

admin.get('/orders/:id', (req, res) => {
  const o = loadOrder('id', req.params.id);
  if (!o) return res.status(404).json({ error: 'No encontrado' });
  // costo estimado de la página para este pedido (comisiones + parte del costo fijo)
  const pc = rules.pageCost();
  o.page_cost = round2(o.items.reduce((a, i) => a + rules.pageCostOfSale(i.unit_price, pc) * i.qty, 0));
  o.claims = claims.forOrder(o.id);
  res.json(o);
});

// cambia el estado de un pedido: devuelve/descuenta stock si se cancela o se reactiva, y al entregarlo genera el código de llegada.
// Lo usan el panel y la página de reparto.
function setOrderStatus(orderId, status, note = '', extra = {}) {
  if (!STATUSES.includes(status)) throw new Error('Estado inválido');
  return db.transaction(() => {
    const o = loadOrder('id', orderId);
    if (!o) throw new Error('Pedido no encontrado');
    const wasInactive = INACTIVE.includes(o.status), willInactive = INACTIVE.includes(status);
    if (!wasInactive && willInactive) {
      for (const it of o.items) if (it.product_id) {
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
        recordStock(it.product_id, it.qty, db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product_id).stock, 'cancelacion', `pedido #${o.id}`);
      }
    } else if (wasInactive && !willInactive) {
      for (const it of o.items) if (it.product_id) {
        const p = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(it.product_id);
        if (p.stock < it.qty) throw new Error(`No hay stock para reactivar: ${p.name}`);
        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.qty, it.product_id);
        recordStock(it.product_id, -it.qty, p.stock - it.qty, 'venta', `pedido #${o.id} (reactivado)`);
      }
    }
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, o.id);
    // al entregarse se genera el código de llegada, que habilita el reclamo post-compra
    if (status === 'entregado' && !o.arrival_code) {
      db.prepare("UPDATE orders SET arrival_code = ?, delivered_at = datetime('now','localtime') WHERE id = ?").run(claims.newArrivalCode(), o.id);
    }
    for (const [k, v] of Object.entries(extra)) if (['driver', 'out_at', 'delivery_note'].includes(k)) db.prepare(`UPDATE orders SET ${k} = ? WHERE id = ?`).run(v, o.id);
    db.prepare('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)').run(o.id, status, note);
    return loadOrder('id', o.id);
  })();
}

function notifyStatus(order, note) {
  mailer.sendStatusChanged(order, note, order.status === 'entregado' && order.arrival_code ? claims.deliveredBlock(order) : '');
}

admin.patch('/orders/:id/status', (req, res) => {
  const { status, note = '', notify = true } = req.body || {};
  try {
    const order = setOrderStatus(req.params.id, status, note);
    if (notify) notifyStatus(order, note);
    res.json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

admin.get('/receipts/:file', (req, res) => {
  const f = path.basename(req.params.file);
  const full = path.join(RECEIPTS, f);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

// ----- productos -----
const withCosts = (p) => {
  const x = parseProduct(p);
  const pc = rules.pageCost();
  x.unit_total_cost = unitTotalCost(p);
  x.min_price = rules.minPrice(x.unit_total_cost, pc);
  x.page_cost = rules.pageCostOfSale(p.price, pc);
  x.net_margin = round2(p.price - x.unit_total_cost - x.page_cost);
  x.iva_amount = round2((p.cost + p.shipping_cost) * p.iva_rate / 100);
  x.margin = round2(p.price - x.unit_total_cost);
  x.margin_pct = p.price > 0 ? round2((x.margin / p.price) * 100) : 0;
  x.markup_pct = x.unit_total_cost > 0 ? round2((x.margin / x.unit_total_cost) * 100) : 0;
  return x;
};

admin.get('/products', (_req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY name').all().map(withCosts));
});

const PRODUCT_FIELDS = ['name', 'description', 'category', 'brand', 'sku', 'barcode', 'price', 'cost', 'shipping_cost', 'iva_rate', 'stock', 'images', 'requires_prescription', 'featured', 'active'];
function cleanProduct(b) {
  const o = {};
  for (const f of PRODUCT_FIELDS) if (b[f] !== undefined) o[f] = b[f];
  for (const f of ['price', 'cost', 'shipping_cost', 'iva_rate']) if (o[f] !== undefined) o[f] = round2(num(o[f]));
  if (o.stock !== undefined) o.stock = Math.max(0, parseInt(o.stock, 10) || 0);
  if (o.images !== undefined) o.images = JSON.stringify(Array.isArray(o.images) ? o.images : []);
  for (const f of ['requires_prescription', 'featured', 'active']) if (o[f] !== undefined) o[f] = o[f] ? 1 : 0;
  return o;
}

function createProduct(data, reason = 'carga') {
  const d = { category: 'General', iva_rate: 21, ...data };
  const cols = Object.keys(d);
  const r = db.prepare(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => d[c]));
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid);
  recordPrice(p.id, p.price, p.cost);
  if (p.stock) recordStock(p.id, p.stock, p.stock, reason);
  return p;
}

function updateProduct(id, data, reason = 'ajuste') {
  const before = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!before) return null;
  const cols = Object.keys(data);
  if (cols.length) db.prepare(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...cols.map((c) => data[c]), id);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (p.price !== before.price || p.cost !== before.cost) recordPrice(id, p.price, p.cost);
  if (p.stock !== before.stock) recordStock(id, p.stock - before.stock, p.stock, reason);
  return p;
}

admin.post('/products', (req, res) => {
  const d = cleanProduct(req.body || {});
  if (!d.name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  res.json(withCosts(createProduct(d)));
});

admin.put('/products/:id', (req, res) => {
  const p = updateProduct(req.params.id, cleanProduct(req.body || {}));
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json(withCosts(p));
});

admin.delete('/products/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) n FROM order_items WHERE product_id = ?').get(req.params.id).n;
  // si tiene ventas, se desactiva para no perder estadísticas
  if (used) db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  else db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deactivated: !!used });
});

admin.post('/upload', imageUpload.array('images', 10), (req, res) => {
  res.json({ urls: (req.files || []).map((f) => '/uploads/' + f.filename) });
});

// descarga una imagen desde un link (ej. copiado de Google Imágenes) y la guarda en la tienda,
// así no depende de que la otra página la siga teniendo
const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
admin.post('/upload-url', async (req, res) => {
  const raw = String((req.body || {}).url || '').trim();
  const m = raw.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  let buf, type;
  if (m) { type = m[1].toLowerCase(); buf = Buffer.from(m[2], 'base64'); }
  else {
    let u;
    try { u = new URL(raw); } catch { return res.status(400).json({ error: 'Ese link no es válido' }); }
    if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(u.hostname)) return res.status(400).json({ error: 'Ese link no es válido' });
    // links de Google Imágenes que envuelven la imagen real (imgurl=...)
    const inner = u.searchParams.get('imgurl') || u.searchParams.get('mediaurl');
    if (inner) { try { u = new URL(inner); } catch {} }
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (FarmaciaDurand)', Accept: 'image/*' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
      type = (r.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!r.ok || !IMG_EXT[type]) return res.status(400).json({ error: 'Ese link no es una imagen. En Google Imágenes abrí la foto, tocá con el botón derecho → "Copiar dirección de imagen".' });
      buf = Buffer.from(await r.arrayBuffer());
    } catch { return res.status(400).json({ error: 'No se pudo descargar la imagen de ese link' }); }
  }
  if (!IMG_EXT[type]) return res.status(400).json({ error: 'Formato de imagen no soportado' });
  if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'La imagen pesa más de 8 MB' });
  if (buf.length < 200) return res.status(400).json({ error: 'La imagen está vacía' });
  const name = crypto.randomBytes(10).toString('hex') + IMG_EXT[type];
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  res.json({ url: '/uploads/' + name });
});

// ----- importación -----
admin.post('/import/mercadolibre', async (req, res) => {
  const s = getSettings();
  const sellerId = String(req.body.seller_id ?? s.ml_seller_id ?? '').trim();
  const token = String(req.body.access_token ?? s.ml_access_token ?? '').trim();
  const updateExisting = req.body.update_existing !== false;
  setSettings({ ml_seller_id: sellerId, ml_access_token: token });
  try {
    const items = await fetchSellerProducts({ sellerId, token });
    let created = 0, updated = 0;
    db.transaction(() => {
      for (const it of items) {
        const ex = db.prepare('SELECT id FROM products WHERE ml_id = ?').get(it.ml_id);
        if (ex) {
          if (!updateExisting) continue;
          updateProduct(ex.id, { price: it.price, stock: it.stock, images: JSON.stringify(it.images), ml_permalink: it.ml_permalink }, 'mercadolibre');
          updated++;
        } else {
          createProduct({ ...it, images: JSON.stringify(it.images) }, 'mercadolibre');
          created++;
        }
      }
    })();
    res.json({ ok: true, total: items.length, created, updated });
  } catch (e) {
    if (!e.status) return res.status(400).json({ error: 'No se pudo conectar con Mercado Libre (' + e.message + '). Revisá la conexión a internet del servidor.' });
    const hint = e.status === 401 || e.status === 403
      ? ' Mercado Libre exige un access token válido para listar publicaciones. Generalo desde developers.mercadolibre.com.ar (o exportá tus publicaciones a Excel desde ML y usá la importación CSV).'
      : '';
    res.status(400).json({ error: e.message + hint });
  }
});

// planilla común (CSV o Excel con encabezados: nombre, precio, stock, costo...)
function importRows(rows) {
  let created = 0, updated = 0, skipped = 0;
  const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return undefined; };
  db.transaction(() => {
    for (const r of rows) {
      const name = pick(r, 'nombre', 'name', 'titulo', 'título', 'title');
      if (!name) { skipped++; continue; }
      const imgs = pick(r, 'imagenes', 'imágenes', 'imagen', 'image', 'images', 'foto');
      const raw = {
        name, description: pick(r, 'descripcion', 'descripción', 'description'), category: pick(r, 'categoria', 'categoría', 'category'),
        brand: pick(r, 'marca', 'brand'), sku: pick(r, 'sku', 'codigo', 'código'), barcode: pick(r, 'codigo_barras', 'ean', 'barcode'), price: pick(r, 'precio', 'price'),
        cost: pick(r, 'costo', 'cost'), shipping_cost: pick(r, 'costo_envio', 'costo envio', 'envio', 'shipping_cost'),
        iva_rate: pick(r, 'iva', 'iva_rate'), stock: pick(r, 'stock', 'cantidad'),
        images: imgs ? imgs.split(/[|\s]+/).filter(Boolean) : undefined,
        requires_prescription: pick(r, 'receta') !== undefined ? /^(si|sí|1|true|x)$/i.test(pick(r, 'receta')) : undefined,
      };
      const d = cleanProduct(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)));
      const ex = d.sku ? db.prepare('SELECT id FROM products WHERE sku = ?').get(d.sku) : db.prepare('SELECT id FROM products WHERE name = ?').get(d.name);
      if (ex) { updateProduct(ex.id, d, 'carga'); updated++; } else { createProduct(d); created++; }
    }
  })();
  return { ok: true, format: 'planilla', created, updated, skipped };
}

// Excel "Modificar en Excel" de Mercado Libre. La primera vez crea los productos (con marca y categoría
// deducidas del título); las siguientes solo actualizan precio, stock e IVA, así no pisa lo que editó la dueña.
function importMercadoLibre(rows) {
  const { nameScore } = require('./purchases');
  const report = { ok: true, format: 'mercadolibre', total: rows.length, created: 0, updated: 0, no_price: [], duplicates: [], promos: [], odd_stock: [] };
  const createdIds = [];
  db.transaction(() => {
    for (const r of rows) {
      if (!r.title) continue;
      if (!r.price) report.no_price.push(r.title);
      if (r.sale_price && r.price && r.sale_price < r.price) report.promos.push({ name: r.title, price: r.price, sale_price: r.sale_price });
      if (r.stock >= 1000) report.odd_stock.push({ name: r.title, stock: r.stock });
      const ex = db.prepare('SELECT id FROM products WHERE ml_id = ?').get(r.ml_id);
      if (ex) {
        updateProduct(ex.id, cleanProduct({ price: r.price, stock: r.stock, iva_rate: r.iva }), 'mercadolibre');
        report.updated++;
      } else {
        const p = createProduct({ ...cleanProduct({ name: r.title, description: r.description, price: r.price, stock: r.stock, iva_rate: r.iva,
          brand: sheets.guessBrand(r.title), category: sheets.guessCategory(r.title), active: r.price > 0 }), ml_id: r.ml_id, ml_permalink: sheets.mlPermalink(r.ml_id) }, 'mercadolibre');
        createdIds.push(p.id);
        report.created++;
      }
    }
    // la misma cosa publicada dos veces en Mercado Libre: queda visible la de mejor descripción, las otras ocultas
    const fresh = createdIds.map((id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id)).filter((p) => p.active);
    const hidden = new Set();
    for (let i = 0; i < fresh.length; i++) {
      if (hidden.has(fresh[i].id)) continue;
      const group = [fresh[i]];
      for (let j = i + 1; j < fresh.length; j++) {
        const a = fresh[i], b = fresh[j];
        if (!hidden.has(b.id) && a.price === b.price && nameScore(a.name, b.name) >= 0.75) group.push(b);
      }
      if (group.length < 2) continue;
      group.sort((a, b) => (b.description || '').length - (a.description || '').length);
      for (const p of group.slice(1)) { hidden.add(p.id); db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(p.id); }
      report.duplicates.push({ kept: group[0].name, hidden: group.slice(1).map((p) => p.name) });
    }
  })();
  return report;
}

admin.post('/import/csv', memUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Subí un archivo CSV o Excel' });
  try {
    if (/\.xlsx$/i.test(req.file.originalname || '')) {
      const wb = await sheets.readWorkbook(req.file.buffer);
      const ml = sheets.mlSheet(wb);
      return res.json(ml ? importMercadoLibre(ml) : importRows(sheets.genericRows(wb)));
    }
    if (/\.xls$/i.test(req.file.originalname || '')) return res.status(400).json({ error: 'El formato .xls viejo no se puede leer: abrilo en Excel y guardalo como .xlsx' });
    res.json(importRows(parseCSV(req.file.buffer.toString('utf8'))));
  } catch (e) {
    res.status(400).json({ error: 'No se pudo leer el archivo: ' + e.message });
  }
});

admin.get('/export/csv', (_req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY name').all();
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = 'nombre;descripcion;categoria;marca;sku;codigo_barras;precio;costo;costo_envio;iva;stock;receta;imagenes';
  const body = rows.map((p) => [p.name, p.description, p.category, p.brand, p.sku, p.barcode, p.price, p.cost, p.shipping_cost, p.iva_rate, p.stock, p.requires_prescription ? 'si' : 'no', JSON.parse(p.images).join('|')].map(q).join(';'));
  res.setHeader('Content-Disposition', 'attachment; filename="productos.csv"');
  res.type('text/csv').send('﻿' + [head, ...body].join('\n'));
});

// ----- estadísticas -----
function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); const e = new Date(y, mo, 0); return `${m}-${String(e.getDate()).padStart(2, '0')} 23:59:59`; };

admin.get('/stats', (req, res) => {
  const n = Math.min(36, Math.max(1, parseInt(req.query.months, 10) || 12));
  const months = lastMonths(n);
  const from = months[0] + '-01';
  const sales = db.prepare(`
    SELECT strftime('%Y-%m', o.created_at) m, COUNT(DISTINCT o.id) orders, SUM(i.qty) units,
      SUM(i.unit_price * i.qty) revenue, SUM(i.unit_cost_total * i.qty) cost
    FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.status NOT IN ('cancelado','rechazado') AND o.created_at >= ? GROUP BY m`).all(from);
  const shipping = db.prepare(`SELECT strftime('%Y-%m', created_at) m, SUM(shipping_fee) s FROM orders WHERE status NOT IN ('cancelado','rechazado') AND created_at >= ? GROUP BY m`).all(from);
  const purchases = Object.fromEntries(db.prepare(`SELECT strftime('%Y-%m', COALESCE(NULLIF(invoice_date,''), created_at)) m, SUM(subtotal_net + freight) s
    FROM purchase_invoices WHERE status = 'aplicada' GROUP BY m`).all().map((r) => [r.m, r.s]));
  const byM = Object.fromEntries(sales.map((r) => [r.m, r]));
  const shipM = Object.fromEntries(shipping.map((r) => [r.m, r.s]));

  // stock al cierre de cada mes = stock actual - movimientos posteriores
  const products = db.prepare('SELECT id, stock, cost, shipping_cost, iva_rate, price FROM products').all();
  const movs = db.prepare('SELECT product_id, delta, created_at FROM stock_movements WHERE created_at >= ?').all(from);
  const monthly = months.map((m) => {
    const end = monthEnd(m);
    let units = 0, valueCost = 0, valuePrice = 0;
    for (const p of products) {
      let st = p.stock;
      for (const mv of movs) if (mv.product_id === p.id && mv.created_at > end) st -= mv.delta;
      st = Math.max(0, st);
      units += st; valueCost += st * unitTotalCost(p); valuePrice += st * p.price;
    }
    const r = byM[m] || { orders: 0, units: 0, revenue: 0, cost: 0 };
    return {
      month: m, orders: r.orders, units_sold: r.units || 0, revenue: round2(r.revenue || 0), cost: round2(r.cost || 0),
      profit: round2((r.revenue || 0) - (r.cost || 0)), shipping_charged: round2(shipM[m] || 0), purchases: round2(purchases[m] || 0),
      avg_ticket: r.orders ? round2(r.revenue / r.orders) : 0,
      stock_units: units, stock_value_cost: round2(valueCost), stock_value_price: round2(valuePrice),
    };
  });

  const top = db.prepare(`
    SELECT i.product_id id, i.name, SUM(i.qty) units, SUM(i.unit_price*i.qty) revenue, SUM((i.unit_price - i.unit_cost_total)*i.qty) profit
    FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.status NOT IN ('cancelado','rechazado') AND o.created_at >= ? GROUP BY i.product_id, i.name ORDER BY units DESC LIMIT 10`).all(from);
  const categories = db.prepare(`
    SELECT COALESCE(p.category,'(eliminado)') category, SUM(i.qty) units, SUM(i.unit_price*i.qty) revenue
    FROM orders o JOIN order_items i ON i.order_id = o.id LEFT JOIN products p ON p.id = i.product_id
    WHERE o.status NOT IN ('cancelado','rechazado') AND o.created_at >= ? GROUP BY category ORDER BY revenue DESC`).all(from);
  const payments = db.prepare(`SELECT payment_method, COUNT(*) n, SUM(total) total FROM orders WHERE status NOT IN ('cancelado','rechazado') AND created_at >= ? GROUP BY payment_method`).all(from);
  const lowStock = db.prepare('SELECT id, name, stock FROM products WHERE active = 1 AND stock <= 5 ORDER BY stock, name LIMIT 20').all();
  res.json({ months: monthly, top, categories, payments, low_stock: lowStock });
});

admin.get('/stats/product/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const months = lastMonths(Math.min(36, parseInt(req.query.months, 10) || 12));
  const from = months[0] + '-01';
  const sold = Object.fromEntries(db.prepare(`
    SELECT strftime('%Y-%m', o.created_at) m, SUM(i.qty) u, SUM(i.unit_price*i.qty) r FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE i.product_id = ? AND o.status NOT IN ('cancelado','rechazado') AND o.created_at >= ? GROUP BY m`).all(p.id, from).map((r) => [r.m, r]));
  const prices = db.prepare('SELECT price, cost, created_at FROM price_history WHERE product_id = ? ORDER BY created_at, id').all(p.id);
  const movs = db.prepare('SELECT delta, created_at FROM stock_movements WHERE product_id = ?').all(p.id);
  const out = months.map((m) => {
    const end = monthEnd(m);
    const lastPrice = [...prices].reverse().find((x) => x.created_at <= end);
    let st = p.stock;
    for (const mv of movs) if (mv.created_at > end) st -= mv.delta;
    return { month: m, price: lastPrice ? lastPrice.price : null, cost: lastPrice ? lastPrice.cost : null, units_sold: sold[m]?.u || 0, revenue: round2(sold[m]?.r || 0), stock: Math.max(0, st) };
  });
  res.json({ product: withCosts(p), months: out });
});

// ----- mensajes -----
admin.get('/messages', (_req, res) => res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all()));
admin.patch('/messages/:id', (req, res) => {
  db.prepare('UPDATE messages SET read = ? WHERE id = ?').run(req.body.read ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
admin.delete('/messages/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ----- configuración -----
admin.get('/settings', (_req, res) => res.json(getSettings()));
admin.put('/settings', (req, res) => {
  const b = { ...(req.body || {}) };
  try {
    if (b.shipping_zones !== undefined) b.shipping_zones = JSON.stringify(rules.cleanZones(typeof b.shipping_zones === 'string' ? JSON.parse(b.shipping_zones) : b.shipping_zones));
  } catch (e) { return res.status(400).json({ error: 'Zonas de envío: ' + e.message }); }
  setSettings(b);
  rules.clearPageCostCache();
  res.json(getSettings());
});

admin.get('/page-cost', (_req, res) => res.json(rules.pageCost()));

// ----- puesta en marcha (tienda cerrada hasta que la dueña la abre) -----
launch.register(admin);

// ----- reparto: etiquetas con QR y página del repartidor (incluye rutas públicas) -----
delivery.register(app, admin, { setOrderStatus, notifyStatus });

// ----- reclamos post-compra (incluye rutas públicas) -----
claims.register(app, admin);

// ----- promociones y suscriptores (incluye rutas públicas) -----
promotions.register(app, admin);

// ----- facturas de compra -----
require('./purchases').register(admin);

app.use('/api/admin', admin);

// ================= PÁGINAS =================
app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.get('/vendor/jsqr.js', (_req, res) => res.sendFile(path.join(ROOT, 'node_modules', 'jsqr', 'dist', 'jsQR.js')));
app.get('/vendor/chart.umd.js', (_req, res) => res.sendFile(path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
app.get('/pedido/:code', (_req, res) => res.sendFile(path.join(PUBLIC, 'pedido.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`\n✚ Farmacia corriendo en ${mailer.baseUrl()}\n  Panel admin: ${mailer.baseUrl()}/admin\n`));
}

module.exports = app;
