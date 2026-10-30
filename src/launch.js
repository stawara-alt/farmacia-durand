// Puesta en marcha: la tienda arranca cerrada al público. La dueña completa los datos, acuerda la logística
// y, cuando la lista está completa, abre la tienda desde el panel.
const { db, getSettings, setSettings } = require('./db');
const rules = require('./rules');
const mailer = require('./mailer');

// valores de ejemplo que vienen cargados de fábrica y hay que reemplazar
const PLACEHOLDERS = {
  email: ['contacto@farmaciadurand.com'],
  whatsapp: ['5491100000000'],
  phone: ['+54 11 0000-0000'],
  bank_cbu: ['0110000000000000000000'],
  bank_cuit: ['30-12345678-9'],
};
const isPlaceholder = (s, k) => !String(s[k] || '').trim() || (PLACEHOLDERS[k] || []).includes(String(s[k]).trim());

// cosas que no se pueden verificar solas: las confirma la dueña
const MANUAL = {
  logistica: 'Acordé la logística de envíos y cargué las zonas, costos y localidades',
  costos_pagina: 'Cargué los costos reales de la página (hosting, comisiones e impuestos)',
  precios: 'Revisé precios y costos de los productos',
  compra_prueba: 'Hice una compra de prueba de punta a punta (pedido, pago, mail y estados)',
};

function manualChecks(s = getSettings()) {
  try { return JSON.parse(s.launch_checks || '{}'); } catch { return {}; }
}

function checklist() {
  const s = getSettings();
  const manual = manualChecks(s);
  const prod = db.prepare(`SELECT COUNT(*) n,
      SUM(CASE WHEN images LIKE '%/uploads/demo/%' THEN 1 ELSE 0 END) demo,
      SUM(CASE WHEN cost <= 0 THEN 1 ELSE 0 END) sin_costo,
      SUM(CASE WHEN images = '[]' THEN 1 ELSE 0 END) sin_foto
    FROM products WHERE active = 1`).get();
  const zones = rules.shippingZones(s).filter((z) => z.enabled);
  const pwd = process.env.ADMIN_PASSWORD;
  const base = process.env.BASE_URL || '';
  const items = [
    { key: 'datos', group: 'Datos de la farmacia', tab: 'config', required: true, label: 'Nombre, dirección, teléfono y horarios',
      ok: !!(s.name && s.address && !isPlaceholder(s, 'phone') && s.hours) },
    { key: 'whatsapp', group: 'Datos de la farmacia', tab: 'config', required: true, label: 'WhatsApp de la farmacia', ok: !isPlaceholder(s, 'whatsapp') },
    { key: 'email', group: 'Datos de la farmacia', tab: 'config', required: true, label: 'Email real de la farmacia (ahí llegan los avisos de pedidos y reclamos)',
      ok: !isPlaceholder(s, 'email'), detail: isPlaceholder(s, 'email') ? 'Todavía tiene el email de ejemplo' : '' },
    { key: 'banco', group: 'Cobros', tab: 'config', required: true, label: 'Datos para transferencia: titular, CUIT, CBU/CVU y alias',
      ok: !!(s.bank_holder && s.bank_alias && !isPlaceholder(s, 'bank_cbu') && !isPlaceholder(s, 'bank_cuit')),
      detail: isPlaceholder(s, 'bank_cbu') || isPlaceholder(s, 'bank_cuit') ? 'CBU o CUIT todavía son de ejemplo' : '' },
    { key: 'qr', group: 'Cobros', tab: 'config', required: false, label: 'QR de cobro (imagen del QR de Mercado Pago, MODO, etc.)', ok: !!(s.qr_image || s.qr_text) },
    { key: 'zonas', group: 'Envíos', tab: 'config', required: true, label: 'Al menos una zona de envío activa', ok: zones.length > 0,
      detail: zones.length ? zones.map((z) => `${z.name} ($${z.fee})`).join(', ') : 'Sin zonas: solo retiro en la farmacia' },
    { key: 'logistica', group: 'Envíos', tab: 'config', required: true, manual: true, label: MANUAL.logistica, ok: !!manual.logistica },
    { key: 'productos', group: 'Productos', tab: 'productos', required: true, label: 'Productos reales cargados', ok: prod.n > 0 && !prod.demo,
      detail: !prod.n ? 'Todavía no hay productos' : prod.demo ? `Hay ${prod.demo} productos de ejemplo: borralos con el botón de abajo` : `${prod.n} productos publicados` },
    { key: 'costos', group: 'Productos', tab: 'costos', required: false, label: 'Costo cargado en todos los productos (para márgenes y precio mínimo)', ok: prod.n > 0 && !prod.sin_costo,
      detail: prod.sin_costo ? `${prod.sin_costo} productos sin costo` : '' },
    { key: 'fotos', group: 'Productos', tab: 'productos', required: false, label: 'Foto en todos los productos', ok: prod.n > 0 && !prod.sin_foto, detail: prod.sin_foto ? `${prod.sin_foto} sin foto` : '' },
    { key: 'precios', group: 'Productos', tab: 'costos', required: false, manual: true, label: MANUAL.precios, ok: !!manual.precios },
    { key: 'costos_pagina', group: 'Productos', tab: 'config', required: false, manual: true, label: MANUAL.costos_pagina, ok: !!manual.costos_pagina },
    { key: 'smtp', group: 'Servidor (lo configura quien publica la página)', required: true, label: 'Correo configurado para enviar mails (SMTP en .env)', ok: mailer.hasSMTP() },
    { key: 'password', group: 'Servidor (lo configura quien publica la página)', required: true, label: 'Contraseña propia para el panel (ADMIN_PASSWORD en .env)', ok: !!pwd && pwd !== 'farmacia123' },
    { key: 'base_url', group: 'Servidor (lo configura quien publica la página)', required: true, label: 'Dirección pública de la página con https (BASE_URL en .env, se usa en los links de los mails)',
      ok: /^https:\/\//.test(base), detail: base ? base : 'Sin configurar' },
    { key: 'compra_prueba', group: 'Prueba final', required: true, manual: true, label: MANUAL.compra_prueba, ok: !!manual.compra_prueba },
  ];
  const pending = items.filter((i) => i.required && !i.ok);
  return { open: s.store_open === '1', items, pending: pending.length, done: items.filter((i) => i.ok).length, total: items.length,
    demo: { products: prod.demo || 0, orders: db.prepare("SELECT COUNT(*) n FROM orders").get().n } };
}

const isOpen = () => getSettings().store_open === '1';

function register(admin) {
  admin.get('/launch', (_req, res) => res.json(checklist()));

  admin.put('/launch/check', (req, res) => {
    const { key, value } = req.body || {};
    if (!MANUAL[key]) return res.status(400).json({ error: 'Ítem inválido' });
    const m = manualChecks();
    m[key] = !!value;
    setSettings({ launch_checks: JSON.stringify(m) });
    res.json(checklist());
  });

  admin.put('/launch/open', (req, res) => {
    setSettings({ store_open: req.body && req.body.open ? '1' : '0' });
    res.json(checklist());
  });

  // borra los datos de ejemplo (productos de demo y toda la actividad de prueba) para empezar de cero
  admin.post('/launch/reset-demo', (req, res) => {
    if (isOpen()) return res.status(400).json({ error: 'La tienda ya está abierta al público: no se pueden borrar los datos (serían pedidos reales).' });
    if (String((req.body || {}).confirm || '').trim().toUpperCase() !== 'BORRAR') return res.status(400).json({ error: 'Escribí BORRAR para confirmar' });
    db.transaction(() => {
      db.exec(`DELETE FROM claim_messages; DELETE FROM claims; DELETE FROM order_status_history; DELETE FROM order_items; DELETE FROM orders;
        DELETE FROM purchase_items; DELETE FROM purchase_invoices; DELETE FROM supplier_codes; DELETE FROM messages; DELETE FROM subscribers;`);
      db.prepare("DELETE FROM products WHERE images LIKE '%/uploads/demo/%'").run();
      db.exec('DELETE FROM stock_movements WHERE product_id NOT IN (SELECT id FROM products); DELETE FROM price_history WHERE product_id NOT IN (SELECT id FROM products);');
    })();
    rules.clearPageCostCache();
    res.json(checklist());
  });
}

module.exports = { register, isOpen, checklist };
