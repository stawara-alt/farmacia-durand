const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(DATA_DIR, 'farmacia.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'General',
  brand TEXT DEFAULT '',
  sku TEXT DEFAULT '',
  price REAL NOT NULL DEFAULT 0,          -- precio de venta al público (final)
  cost REAL NOT NULL DEFAULT 0,           -- costo neto del producto (sin IVA)
  shipping_cost REAL NOT NULL DEFAULT 0,  -- costo de envío/flete por unidad que paga la farmacia
  iva_rate REAL NOT NULL DEFAULT 21,      -- % de IVA aplicable al costo
  stock INTEGER NOT NULL DEFAULT 0,
  images TEXT NOT NULL DEFAULT '[]',      -- JSON array de URLs
  requires_prescription INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  ml_id TEXT UNIQUE,
  ml_permalink TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  cost REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL,                   -- carga, ajuste, venta, cancelacion, mercadolibre
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,              -- código público para seguir el pedido
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  delivery_method TEXT NOT NULL,          -- envio | retiro
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  payment_method TEXT NOT NULL,           -- transferencia | qr
  subtotal REAL NOT NULL,
  shipping_fee REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  receipt TEXT,                           -- comprobante de pago subido por el cliente
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  image TEXT,
  unit_price REAL NOT NULL,
  unit_cost_total REAL NOT NULL,          -- costo total c/IVA y envío al momento de la venta
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  invoice_date TEXT DEFAULT '',
  invoice_type TEXT DEFAULT '',
  subtotal_net REAL NOT NULL DEFAULT 0,
  iva_total REAL NOT NULL DEFAULT 0,
  other_taxes REAL NOT NULL DEFAULT 0,     -- percepciones / impuestos internos (no se suman al costo)
  freight REAL NOT NULL DEFAULT 0,         -- flete sin IVA, se prorratea en el costo de envío de cada producto
  total REAL NOT NULL DEFAULT 0,
  price_policy TEXT DEFAULT '',
  file TEXT,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aplicada', -- aplicada | anulada
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  code TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  description TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,                 -- costo neto unitario (con bonificación, sin IVA)
  iva_rate REAL NOT NULL DEFAULT 21,
  freight_unit REAL NOT NULL DEFAULT 0,
  old_cost REAL, old_shipping_cost REAL, old_price REAL, new_price REAL,
  created_product INTEGER NOT NULL DEFAULT 0
);

-- el código que usa cada proveedor para un producto: se aprende al aplicar facturas
CREATE TABLE IF NOT EXISTS supplier_codes (
  supplier TEXT NOT NULL,
  code TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (supplier, code)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT DEFAULT '',
  source TEXT DEFAULT 'web',               -- compra | web | admin
  token TEXT NOT NULL UNIQUE,              -- para el link de baja
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  unsubscribed_at TEXT
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  label TEXT DEFAULT '',                   -- etiqueta corta, ej. "20% OFF" o "2x1"
  image TEXT DEFAULT '',
  discount_pct REAL NOT NULL DEFAULT 0,    -- 0 = solo anuncio; > 0 = se descuenta del precio en la tienda
  target TEXT NOT NULL DEFAULT 'all',      -- all | category | products
  target_category TEXT DEFAULT '',
  product_ids TEXT NOT NULL DEFAULT '[]',
  starts_at TEXT DEFAULT '',               -- YYYY-MM-DD (vacío = desde ya)
  ends_at TEXT DEFAULT '',                 -- YYYY-MM-DD inclusive (vacío = sin vencimiento)
  show_on_site INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  send_status TEXT NOT NULL DEFAULT 'borrador', -- borrador | enviando | enviada
  sent_count INTEGER NOT NULL DEFAULT 0,
  send_total INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                      -- roto | equivocado | faltante | vencido | arrepentimiento | otro
  description TEXT NOT NULL DEFAULT '',
  resolution TEXT DEFAULT '',              -- lo que pide el cliente: cambio | devolucion | otro
  photos TEXT NOT NULL DEFAULT '[]',
  contact_phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'abierto',  -- abierto | en_revision | resuelto | rechazado
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS claim_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  author TEXT NOT NULL,                    -- cliente | farmacia
  status TEXT,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// migraciones de columnas agregadas después
const productCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
if (!orderCols.includes('shipping_zone')) db.exec("ALTER TABLE orders ADD COLUMN shipping_zone TEXT DEFAULT ''");
if (!orderCols.includes('arrival_code')) db.exec('ALTER TABLE orders ADD COLUMN arrival_code TEXT');
if (!orderCols.includes('delivered_at')) db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT');
if (!productCols.includes('barcode')) db.exec("ALTER TABLE products ADD COLUMN barcode TEXT DEFAULT ''");

const DEFAULT_SETTINGS = {
  name: 'Farmacia Durand',
  slogan: 'Cuidamos tu salud desde 1916',
  about: 'Desde 1916 acompañamos a nuestro barrio con atención cercana y profesional. Medicamentos, vacunas, obras sociales y prepagas, dermocosmética, perfumería y maquillaje, con el asesoramiento de siempre.',
  address: 'Av. Díaz Vélez 5115',
  city: 'C1405 CABA, Buenos Aires',
  phone: '+54 11 0000-0000',
  whatsapp: '5491100000000',
  email: 'contacto@farmaciadurand.com',
  hours: 'Lunes a Viernes: 8:00 a 21:00\nSábados: 9:00 a 14:00\nDomingos y feriados: según turno',
  services: 'Vacunación|Obras sociales y prepagas|Maquillaje|Cosmética y perfumería|Atención farmacéutica|Envíos a domicilio',
  since_year: '1916',
  linktree: 'https://linktr.ee/farmacia.durand',
  instagram: 'https://www.instagram.com/farmaciadurand/',
  facebook: 'https://www.facebook.com/FarmaciaDurand/',
  tiktok: '',
  color_primary: '#038b37',   // verde de Farmacia Durand (Instagram)
  color_accent: '#e4002b',    // rojo para ofertas y descuentos
  logo: '',
  hero_image: '',
  bank_holder: 'Farmacia Durand',
  bank_cuit: '30-12345678-9',
  bank_name: 'Banco Nación',
  bank_cbu: '0110000000000000000000',
  bank_alias: 'FARMACIA.DURAND',
  qr_image: '',                // imagen de QR subida (ej. QR de Mercado Pago)
  qr_text: '',                 // si no hay imagen, se genera un QR con este texto/link
  maps_url: 'https://www.google.com/maps/place/farmacia+durand/data=!4m2!3m1!1s0x95bcca6ca194d707:0x1beb13e24f87d47d',
  owner_phone: '',              // celular de la dueña para reclamos (si está vacío se usa el WhatsApp)
  claim_days: '10',             // días desde la entrega para iniciar un reclamo
  // costos de vender online, para calcular el precio mínimo
  page_fixed_monthly: '30000',  // hosting, dominio, emails, lectura de facturas, etc. ($ por mes)
  page_fee_pct: '3.5',          // comisiones de cobro + impuestos sobre la venta (IIBB, etc.) en % del precio
  page_units_month: '0',        // unidades vendidas por mes para repartir el costo fijo (0 = promedio real de los últimos 3 meses)
  shipping_zones: JSON.stringify([
    { name: 'CABA', fee: 2500, free_from: 40000, enabled: true, places: ['CABA'] },
    { name: 'GBA 1er cordón', fee: 3500, free_from: 50000, enabled: true,
      places: ['Avellaneda', 'General San Martín', 'Hurlingham', 'Ituzaingó', 'La Matanza', 'Lanús', 'Lomas de Zamora', 'Morón', 'Quilmes', 'San Isidro', 'Tres de Febrero', 'Vicente López'] },
    { name: 'GBA 2do cordón', fee: 4500, free_from: 60000, enabled: true,
      places: ['Almirante Brown', 'Berazategui', 'Esteban Echeverría', 'Ezeiza', 'Florencio Varela', 'José C. Paz', 'Malvinas Argentinas', 'Merlo', 'Moreno', 'San Fernando', 'San Miguel', 'Tigre'] },
  ]),
  default_markup: '40',        // % de ganancia sobre costo para productos nuevos de facturas
  price_rounding: '10',        // redondeo hacia arriba de precios calculados ($)
  ml_seller_id: '614432576',  // cuenta de Mercado Libre de la farmacia (listado.mercadolibre.com.ar/_CustId_614432576)
  ml_access_token: '',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) {
      if (k in DEFAULT_SETTINGS) stmt.run(k, v == null ? '' : String(v));
    }
  })();
}

// Costo total unitario = (costo + envío) * (1 + IVA)
function unitTotalCost(p) {
  return round2((Number(p.cost) + Number(p.shipping_cost)) * (1 + Number(p.iva_rate) / 100));
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseProduct(p) {
  if (!p) return p;
  return { ...p, images: JSON.parse(p.images || '[]'), requires_prescription: !!p.requires_prescription, featured: !!p.featured, active: !!p.active };
}

function recordStock(productId, delta, stockAfter, reason, ref = null) {
  db.prepare('INSERT INTO stock_movements (product_id, delta, stock_after, reason, ref) VALUES (?, ?, ?, ?, ?)').run(productId, delta, stockAfter, reason, ref);
}

function recordPrice(productId, price, cost) {
  db.prepare('INSERT INTO price_history (product_id, price, cost) VALUES (?, ?, ?)').run(productId, price, cost);
}

module.exports = { db, getSettings, setSettings, unitTotalCost, round2, parseProduct, recordStock, recordPrice, DEFAULT_SETTINGS };
