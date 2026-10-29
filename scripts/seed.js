// Carga productos y ventas de ejemplo para probar la tienda y las estadísticas.
// Uso: npm run seed   (borra productos y pedidos existentes)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, unitTotalCost } = require('../src/db');
const { newArrivalCode } = require('../src/claims');
const rules = require('../src/rules');

const DIR = path.join(__dirname, '..', 'public', 'uploads', 'demo');
fs.mkdirSync(DIR, { recursive: true });

const CATS = {
  Medicamentos: '#2a78d6', Dermocosmética: '#e87ba4', 'Cuidado personal': '#1baf7a',
  Perfumería: '#6250d6', 'Bebés y maternidad': '#eda100', 'Vitaminas y suplementos': '#eb6834',
};
const P = [
  ['Ibuprofeno 400 mg x 20 comp.', 'Medicamentos', 'Ibupirac', 4500, 2600, 60],
  ['Paracetamol 500 mg x 16 comp.', 'Medicamentos', 'Tafirol', 3200, 1800, 80],
  ['Amoxicilina 500 mg x 16', 'Medicamentos', 'Amixen', 9800, 6100, 25, true],
  ['Antiácido masticable x 30', 'Medicamentos', 'Sertal', 5200, 3100, 30],
  ['Protector solar FPS 50 200 ml', 'Dermocosmética', 'La Roche-Posay', 32500, 21000, 18],
  ['Crema hidratante facial 50 ml', 'Dermocosmética', 'CeraVe', 24800, 15200, 20],
  ['Agua micelar 400 ml', 'Dermocosmética', 'Bioderma', 18900, 11300, 22],
  ['Shampoo anticaspa 375 ml', 'Cuidado personal', 'Head & Shoulders', 8900, 5400, 40],
  ['Cepillo dental suave x 2', 'Cuidado personal', 'Colgate', 4200, 2300, 50],
  ['Desodorante roll-on 50 ml', 'Cuidado personal', 'Rexona', 3900, 2200, 45],
  ['Perfume Floral EDT 100 ml', 'Perfumería', 'Natura', 45900, 29800, 8],
  ['Colonia infantil 200 ml', 'Perfumería', 'Johnson\'s', 7900, 4600, 15],
  ['Pañales talle G x 36', 'Bebés y maternidad', 'Pampers', 21500, 15400, 30],
  ['Toallitas húmedas x 80', 'Bebés y maternidad', 'Huggies', 4600, 2700, 60],
  ['Vitamina C 1 g x 30', 'Vitaminas y suplementos', 'Redoxon', 11200, 6900, 35],
  ['Magnesio + B6 x 60', 'Vitaminas y suplementos', 'Bagó', 14500, 8700, 20],
  ['Omega 3 x 60 cápsulas', 'Vitaminas y suplementos', 'Nature\'s Bounty', 19800, 12100, 3],
];

function svg(name, color, variant) {
  const words = name.split(' ');
  const lines = [words.slice(0, 2).join(' '), words.slice(2, 4).join(' ')].filter(Boolean);
  const box = variant === 1
    ? `<rect x="130" y="70" width="140" height="250" rx="40" fill="${color}"/><rect x="155" y="40" width="90" height="45" rx="10" fill="#1f2a27" opacity=".8"/>`
    : `<rect x="95" y="90" width="210" height="220" rx="18" fill="${color}"/><rect x="95" y="90" width="210" height="50" rx="18" fill="#000" opacity=".12"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f4f7f6"/>${box}
    <circle cx="200" cy="190" r="34" fill="#fff" opacity=".9"/><path d="M190 168h20v12h12v20h-12v12h-20v-12h-12v-20h12z" fill="${color}"/>
    ${lines.map((l, i) => `<text x="200" y="${255 + i * 24}" font-family="Arial" font-weight="700" font-size="19" text-anchor="middle" fill="#fff">${l.replace(/&/g, '&amp;')}</text>`).join('')}</svg>`;
}

const pad = (n) => String(n).padStart(2, '0');
const ts = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

db.transaction(() => {
  db.exec('DELETE FROM claim_messages; DELETE FROM claims; DELETE FROM purchase_items; DELETE FROM purchase_invoices; DELETE FROM supplier_codes; DELETE FROM order_status_history; DELETE FROM order_items; DELETE FROM orders; DELETE FROM stock_movements; DELETE FROM price_history; DELETE FROM products;');
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1, 9);
  const prods = P.map(([name, cat, brand, price, cost, stock, rx], i) => {
    const file = `p${i + 1}.svg`;
    const file2 = `p${i + 1}b.svg`;
    fs.writeFileSync(path.join(DIR, file), svg(name, CATS[cat], 0));
    fs.writeFileSync(path.join(DIR, file2), svg(name, CATS[cat], 1));
    // precio inicial ~15% más bajo para mostrar evolución por inflación
    const p0 = Math.round(price * 0.82), c0 = Math.round(cost * 0.82);
    const initialStock = stock + rnd(40, 90);
    const r = db.prepare(`INSERT INTO products (name, description, category, brand, sku, price, cost, shipping_cost, iva_rate, stock, images, requires_prescription, featured, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(name, `${name} de ${brand}.\n\nProducto original con garantía de farmacia. Consultá a tu farmacéutico ante cualquier duda.`, cat, brand, `SKU${1000 + i}`,
      p0, c0, rnd(50, 250), cat === 'Medicamentos' ? 21 : 21, initialStock, JSON.stringify([`/uploads/demo/${file}`, `/uploads/demo/${file2}`]), rx ? 1 : 0, i % 4 === 0 ? 1 : 0, ts(start));
    db.prepare('INSERT INTO price_history (product_id, price, cost, created_at) VALUES (?,?,?,?)').run(r.lastInsertRowid, p0, c0, ts(start));
    db.prepare('INSERT INTO stock_movements (product_id, delta, stock_after, reason, created_at) VALUES (?,?,?,?,?)').run(r.lastInsertRowid, initialStock, initialStock, 'carga', ts(start));
    return { id: r.lastInsertRowid, name, price, cost, rx, img: `/uploads/demo/${file}` };
  });

  // dos aumentos de precio en el año
  for (const [monthsAgo, factor] of [[8, 0.9], [3, 1]]) {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 5, 10);
    for (const p of prods) {
      const price = Math.round(p.price * factor), cost = Math.round(p.cost * factor);
      db.prepare('UPDATE products SET price = ?, cost = ? WHERE id = ?').run(price, cost, p.id);
      db.prepare('INSERT INTO price_history (product_id, price, cost, created_at) VALUES (?,?,?,?)').run(p.id, price, cost, ts(d));
    }
  }

  const names = ['María González', 'Juan Pérez', 'Lucía Fernández', 'Carlos Rodríguez', 'Sofía López', 'Martín Gómez', 'Valentina Díaz', 'Diego Martínez'];
  const buyable = prods.filter((p) => !p.rx);
  let orderNo = 0;
  for (let m = 12; m >= 0; m--) {
    const nOrders = rnd(8, 14) + (12 - m);
    for (let k = 0; k < nOrders; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, rnd(1, 28), rnd(9, 20), rnd(0, 59));
      if (d > now) continue;
      const items = [];
      for (let j = 0; j < rnd(1, 3); j++) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(buyable[rnd(0, buyable.length - 1)].id);
        const q = rnd(1, 3);
        if (p.stock < q || items.some((x) => x.p.id === p.id)) continue;
        items.push({ p, q });
      }
      if (!items.length) continue;
      orderNo++;
      // precio vigente a esa fecha
      const priceAt = (pid) => db.prepare('SELECT price, cost FROM price_history WHERE product_id = ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1').get(pid, ts(d));
      const lines = items.map(({ p, q }) => { const ph = priceAt(p.id); return { p, q, price: ph.price, costTotal: unitTotalCost({ ...p, cost: ph.cost }) }; });
      const subtotal = lines.reduce((a, l) => a + l.price * l.q, 0);
      const envio = Math.random() < 0.6;
      const zones = rules.shippingZones().filter((z) => z.enabled);
      const zone = zones[rnd(0, zones.length - 1)];
      const place = zone.places[rnd(0, zone.places.length - 1)];
      const ship = envio ? rules.shippingQuote(subtotal, place).fee : 0;
      const recent = m === 0 && d > new Date(now - 4 * 864e5);
      const status = recent ? ['pendiente', 'aceptado', 'en_preparacion', 'en_envio'][rnd(0, 3)] : Math.random() < 0.06 ? 'cancelado' : 'entregado';
      const name = names[rnd(0, names.length - 1)];
      const o = db.prepare(`INSERT INTO orders (code, customer_name, email, phone, delivery_method, address, city, payment_method, subtotal, shipping_fee, total, status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomBytes(12).toString('base64url'), name, name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '.') + '@ejemplo.com', '11' + rnd(40000000, 69999999),
        envio ? 'envio' : 'retiro', envio ? `Calle ${rnd(100, 5000)}` : '', envio ? place : '', Math.random() < 0.55 ? 'transferencia' : 'qr', subtotal, ship, subtotal + ship, status, ts(d), ts(d));
      if (envio) db.prepare('UPDATE orders SET shipping_zone = ? WHERE id = ?').run(zone.name, o.lastInsertRowid);
      if (status === 'entregado') db.prepare('UPDATE orders SET arrival_code = ?, delivered_at = ? WHERE id = ?').run(newArrivalCode(), ts(new Date(d.getTime() + 26 * 3600e3)), o.lastInsertRowid);
      for (const l of lines) {
        db.prepare('INSERT INTO order_items (order_id, product_id, name, image, unit_price, unit_cost_total, qty) VALUES (?,?,?,?,?,?,?)')
          .run(o.lastInsertRowid, l.p.id, l.p.name, JSON.parse(l.p.images)[0], l.price, l.costTotal, l.q);
        if (status !== 'cancelado') {
          const after = l.p.stock - l.q;
          db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(after, l.p.id);
          db.prepare('INSERT INTO stock_movements (product_id, delta, stock_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)').run(l.p.id, -l.q, after, 'venta', `pedido #${o.lastInsertRowid}`, ts(d));
        }
      }
      db.prepare('INSERT INTO order_status_history (order_id, status, note, created_at) VALUES (?,?,?,?)').run(o.lastInsertRowid, 'pendiente', 'Pedido recibido', ts(d));
      if (status !== 'pendiente') db.prepare('INSERT INTO order_status_history (order_id, status, note, created_at) VALUES (?,?,?,?)').run(o.lastInsertRowid, status, '', ts(new Date(d.getTime() + 3 * 3600e3)));
    }
    // reposición mensual
    const rd = new Date(now.getFullYear(), now.getMonth() - m, 15, 8);
    if (rd < now) for (const p of prods) {
      const cur = db.prepare('SELECT stock FROM products WHERE id = ?').get(p.id).stock;
      if (cur < 25 && m > 0) {
        const add = rnd(20, 40);
        db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(cur + add, p.id);
        db.prepare('INSERT INTO stock_movements (product_id, delta, stock_after, reason, created_at) VALUES (?,?,?,?,?)').run(p.id, add, cur + add, 'carga', ts(rd));
      }
    }
  }
  // dejar un par con stock bajo para el ejemplo
  db.prepare("UPDATE products SET stock = 2 WHERE name LIKE 'Omega%'").run();
  console.log(`✓ ${prods.length} productos y ${orderNo} pedidos de ejemplo cargados`);
})();
