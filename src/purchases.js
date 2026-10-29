// Facturas de compra: leer la factura (PDF/foto con Claude, o planilla CSV), reconocer los productos
// y actualizar stock, costo, IVA, flete y precio de venta de una sola vez.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { z } = require('zod');
const { db, getSettings, unitTotalCost, round2, recordStock, recordPrice } = require('./db');
const { parseCSV, num } = require('./csv');

const INVOICES = path.join(__dirname, '..', 'data', 'invoices');
fs.mkdirSync(INVOICES, { recursive: true });

const MEDIA = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: INVOICES,
    filename: (_req, f, cb) => cb(null, crypto.randomBytes(10).toString('hex') + path.extname(f.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '')),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ---------- lectura con Claude ----------
const InvoiceSchema = z.object({
  supplier: z.string().describe('Razón social del proveedor / droguería que emite la factura'),
  invoice_number: z.string().describe('Número de comprobante, ej. 0003-00012345'),
  invoice_date: z.string().describe('Fecha de emisión en formato YYYY-MM-DD, o vacío si no figura'),
  invoice_type: z.string().describe('A, B, C, remito, presupuesto, etc.'),
  subtotal_net: z.number().nullable(),
  iva_total: z.number().nullable(),
  other_taxes: z.number().nullable().describe('Suma de percepciones (IIBB, IVA), impuestos internos y otros tributos'),
  freight: z.number().nullable().describe('Flete / envío / gastos de distribución facturados, neto sin IVA'),
  total: z.number().nullable(),
  items: z.array(z.object({
    code: z.string().describe('Código interno del proveedor, troquel o artículo; vacío si no hay'),
    barcode: z.string().describe('Código de barras EAN si figura; vacío si no'),
    description: z.string(),
    quantity: z.number(),
    unit_cost_net: z.number().describe('Costo unitario final SIN IVA y CON bonificaciones/descuentos aplicados'),
    discount_pct: z.number().describe('Bonificación % aplicada a la línea (0 si no hay)'),
    iva_rate: z.number().describe('Alícuota de IVA de la línea: 0, 10.5, 21 o 27'),
  })),
});

const EXTRACT_PROMPT = `Sos un asistente administrativo de una farmacia argentina. Leé esta factura de compra de un proveedor (droguería, laboratorio o distribuidora) y devolvé sus datos.

Reglas:
- Cada producto comprado es un ítem. No incluyas como ítem el flete, envío, gastos de distribución, percepciones ni impuestos: el flete va en "freight" y los impuestos/percepciones en "other_taxes".
- "unit_cost_net" es el costo por unidad sin IVA y con todas las bonificaciones o descuentos ya aplicados (incluidos descuentos generales al pie de la factura, prorrateados).
- En facturas B, C o tickets los precios suelen incluir IVA: dividí por (1 + alícuota) para obtener el neto. Los medicamentos suelen llevar 21%; si la factura indica exento, usá 0.
- Si la cantidad viene en cajas o packs con unidades adentro, usá la cantidad de unidades de venta al público que indique la factura.
- Usá punto como separador decimal en los números. Si un dato no figura, usá null (o texto vacío).
- Copiá las descripciones tal cual figuran.`;

async function extractWithClaude(file) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Para leer facturas en PDF o foto automáticamente falta configurar ANTHROPIC_API_KEY en el archivo .env. Mientras tanto podés subir la factura como planilla CSV o cargar las líneas a mano.');
  }
  const Anthropic = require('@anthropic-ai/sdk');
  const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
  const media = MEDIA[path.extname(file.filename)];
  const data = fs.readFileSync(file.path).toString('base64');
  const block = media === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: media, data } }
    : { type: 'image', source: { type: 'base64', media_type: media, data } };

  const client = new Anthropic();
  let res;
  try {
    res = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(InvoiceSchema) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: [block, { type: 'text', text: EXTRACT_PROMPT }] }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('La ANTHROPIC_API_KEY configurada no es válida.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Se alcanzó el límite de uso de la API de Claude. Probá de nuevo en unos minutos.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('No se pudo conectar con la API de Claude. Revisá la conexión a internet del servidor.');
    if (e instanceof Anthropic.APIError) throw new Error(`Error de la API de Claude (${e.status}): ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('No se pudo procesar este archivo. Probá con otra foto o cargalo como planilla.');
  if (res.stop_reason === 'max_tokens') throw new Error('La factura es demasiado larga para leerla de una vez. Probá subiéndola por partes (por ejemplo, de a una hoja).');
  if (!res.parsed_output) throw new Error('No se pudo interpretar la factura. Probá con una imagen más nítida.');
  return res.parsed_output;
}

// Planilla: codigo, codigo_barras, descripcion, cantidad, costo (neto unitario), bonificacion, iva
function extractFromCSV(file) {
  const rows = parseCSV(fs.readFileSync(file.path, 'utf8'));
  const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]; return ''; };
  const items = rows.map((r) => {
    const disc = num(pick(r, 'bonificacion', 'bonificación', 'descuento', 'dto'));
    const cost = num(pick(r, 'costo', 'costo_unitario', 'precio', 'precio_unitario', 'unitario'));
    return {
      code: pick(r, 'codigo', 'código', 'cod', 'articulo', 'troquel'),
      barcode: pick(r, 'codigo_barras', 'ean', 'barcode', 'barras'),
      description: pick(r, 'descripcion', 'descripción', 'producto', 'detalle', 'nombre'),
      quantity: num(pick(r, 'cantidad', 'cant', 'unidades')),
      unit_cost_net: round2(cost * (1 - disc / 100)),
      discount_pct: disc,
      iva_rate: pick(r, 'iva') === '' ? 21 : num(pick(r, 'iva')),
    };
  }).filter((i) => i.description && i.quantity > 0);
  return { supplier: '', invoice_number: '', invoice_date: '', invoice_type: '', subtotal_net: null, iva_total: null, other_taxes: null, freight: null, total: null, items };
}

// ---------- reconocimiento de productos ----------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// separa números de unidades: "400mg" -> "400 mg", "x20" -> "x 20"
const tokens = (s) => new Set(norm(s).replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').split(' ').filter((t) => t.length > 1 || /\d/.test(t)));

function nameScore(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0, numMismatch = false;
  // coincidencia exacta = 1; abreviatura (prefijo de 3+ letras, ej. "ibu" -> "ibuprofeno") = 0.8
  for (const t of A) {
    if (B.has(t)) inter++;
    else if (t.length >= 3 && !/\d/.test(t) && [...B].some((u) => u.startsWith(t) || (u.length >= 3 && t.startsWith(u)))) inter += 0.8;
  }
  // si ambos tienen números (mg, ml, unidades) y no coinciden, penalizar fuerte
  const nA = [...A].filter((t) => /\d/.test(t)), nB = [...B].filter((t) => /\d/.test(t));
  if (nA.length && nB.length && !nA.some((t) => B.has(t))) numMismatch = true;
  const score = inter / Math.min(A.size, B.size) * 0.7 + inter / Math.max(A.size, B.size) * 0.3;
  return numMismatch ? score * 0.5 : score;
}

function matchLine(supplier, line, products) {
  const sup = norm(supplier);
  if (line.code && sup) {
    const m = db.prepare('SELECT product_id FROM supplier_codes WHERE supplier = ? AND code = ?').get(sup, String(line.code).trim());
    if (m && products.some((p) => p.id === m.product_id)) return { product_id: m.product_id, how: 'código del proveedor', confidence: 1 };
  }
  const bc = String(line.barcode || '').replace(/\D/g, '');
  if (bc.length >= 8) {
    const p = products.find((x) => String(x.barcode || '').replace(/\D/g, '') === bc || String(x.sku || '').replace(/\D/g, '') === bc);
    if (p) return { product_id: p.id, how: 'código de barras', confidence: 1 };
  }
  if (line.code) {
    const p = products.find((x) => x.sku && norm(x.sku) === norm(line.code));
    if (p) return { product_id: p.id, how: 'SKU', confidence: 0.95 };
  }
  let best = null;
  for (const p of products) {
    const s = nameScore(line.description, `${p.name} ${p.brand}`);
    if (!best || s > best.s) best = { p, s };
  }
  if (best && best.s >= 0.55) return { product_id: best.p.id, how: 'nombre parecido', confidence: round2(best.s) };
  return { product_id: null, how: 'sin coincidencia', confidence: 0 };
}

// ---------- precio de venta ----------
function roundUp(n, step) {
  step = Number(step) || 0;
  return step > 0 ? Math.ceil(n / step) * step : round2(n);
}

// policy: { mode: 'keep_markup' | 'markup' | 'none', markup_pct, no_decrease }
function newPriceFor(p, newTotalCost, policy, s) {
  const oldPrice = p ? p.price : 0;
  if (policy.mode === 'none' && p) return oldPrice;
  let markup = Number(policy.markup_pct ?? s.default_markup ?? 40);
  if (policy.mode === 'keep_markup' && p) {
    const oldTotal = unitTotalCost(p);
    if (oldTotal > 0 && oldPrice > 0) markup = (oldPrice / oldTotal - 1) * 100;
  }
  let price = roundUp(newTotalCost * (1 + markup / 100), s.price_rounding);
  if (p && policy.no_decrease !== false && price < oldPrice) price = oldPrice;
  return price;
}

// Calcula el flete por unidad prorrateando por el valor neto de cada línea
function withFreight(lines, freight) {
  const totalNet = lines.reduce((a, l) => a + l.unit_cost * l.qty, 0);
  return lines.map((l) => ({ ...l, freight_unit: totalNet > 0 && freight > 0 ? round2((freight * (l.unit_cost * l.qty) / totalNet) / l.qty) : 0 }));
}

function register(admin) {
  // 1) Subir y leer la factura (no modifica nada todavía)
  admin.post('/purchases/extract', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Subí la factura (PDF, foto o planilla CSV)' });
    const ext = path.extname(file.filename);
    try {
      let data;
      if (ext === '.csv' || ext === '.txt') data = extractFromCSV(file);
      else if (MEDIA[ext]) data = await extractWithClaude(file);
      else throw new Error('Formato no soportado. Usá PDF, JPG, PNG, WEBP o CSV (las fotos HEIC del iPhone hay que convertirlas a JPG).');
      const products = db.prepare('SELECT * FROM products').all();
      const sup = data.supplier || '';
      const items = data.items.map((it) => ({
        code: it.code || '', barcode: it.barcode || '', description: it.description,
        qty: Math.max(1, Math.round(it.quantity)), unit_cost: round2(it.unit_cost_net), discount_pct: it.discount_pct || 0,
        iva_rate: [0, 10.5, 21, 27].includes(Number(it.iva_rate)) ? Number(it.iva_rate) : 21,
        match: matchLine(sup, it, products),
      }));
      res.json({ ...data, items, file: file.filename });
    } catch (e) {
      fs.rm(file.path, () => {});
      res.status(400).json({ error: e.message });
    }
  });

  // reconocer de nuevo (por ejemplo si cambió el proveedor escrito a mano)
  admin.post('/purchases/match', (req, res) => {
    const products = db.prepare('SELECT * FROM products').all();
    res.json((req.body.items || []).map((it) => matchLine(req.body.supplier, it, products)));
  });

  // 2) Vista previa: cómo quedarían costos y precios (no guarda)
  admin.post('/purchases/preview', (req, res) => {
    try { res.json(compute(req.body).rows); } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // 3) Aplicar: actualiza stock, costos, IVA, flete y precios
  admin.post('/purchases', (req, res) => {
    const b = req.body || {};
    if (!String(b.supplier || '').trim()) return res.status(400).json({ error: 'Indicá el proveedor' });
    try {
      const result = db.transaction(() => {
        if (b.number) {
          const dup = db.prepare("SELECT id FROM purchase_invoices WHERE supplier = ? AND number = ? AND status = 'aplicada'").get(b.supplier.trim(), String(b.number).trim());
          if (dup) throw new Error(`La factura ${b.number} de ${b.supplier} ya fue cargada (compra #${dup.id}).`);
        }
        const { rows, policy } = compute(b);
        const subtotal = round2(rows.reduce((a, r) => a + r.unit_cost * r.qty, 0));
        const ivaTotal = b.iva_total != null && b.iva_total !== '' ? num(b.iva_total) : round2(rows.reduce((a, r) => a + (r.unit_cost * r.qty + r.freight_unit * r.qty) * r.iva_rate / 100, 0));
        const freight = num(b.freight), other = num(b.other_taxes);
        const file = b.file && fs.existsSync(path.join(INVOICES, path.basename(b.file))) ? path.basename(b.file) : null;
        const inv = db.prepare(`INSERT INTO purchase_invoices (supplier, number, invoice_date, invoice_type, subtotal_net, iva_total, other_taxes, freight, total, price_policy, file, notes)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.supplier.trim(), String(b.number || '').trim(), b.invoice_date || '', b.invoice_type || '', subtotal, ivaTotal, other, freight,
          b.total != null && b.total !== '' ? num(b.total) : round2(subtotal + freight + ivaTotal + other), JSON.stringify(policy), file, b.notes || '');
        const invId = inv.lastInsertRowid;
        const ref = `factura ${b.number || '#' + invId} (${b.supplier})`;
        const sup = norm(b.supplier);
        let created = 0, updated = 0, units = 0;
        for (const r of rows) {
          let pid = r.product_id;
          const before = pid ? db.prepare('SELECT * FROM products WHERE id = ?').get(pid) : null;
          if (before) {
            const stock = before.stock + r.qty;
            db.prepare("UPDATE products SET stock = ?, cost = ?, shipping_cost = ?, iva_rate = ?, price = ?, barcode = CASE WHEN COALESCE(barcode,'') = '' THEN ? ELSE barcode END, updated_at = datetime('now','localtime') WHERE id = ?")
              .run(stock, r.unit_cost, r.freight_unit, r.iva_rate, r.new_price, r.barcode || '', pid);
            recordStock(pid, r.qty, stock, 'compra', ref);
            if (before.price !== r.new_price || before.cost !== r.unit_cost) recordPrice(pid, r.new_price, r.unit_cost);
            updated++;
          } else {
            const ins = db.prepare(`INSERT INTO products (name, category, sku, barcode, price, cost, shipping_cost, iva_rate, stock, active) VALUES (?,?,?,?,?,?,?,?,?,?)`)
              .run(r.new_name || r.description, r.category || 'General', r.code || '', r.barcode || '', r.new_price, r.unit_cost, r.freight_unit, r.iva_rate, r.qty, r.publish ? 1 : 0);
            pid = ins.lastInsertRowid;
            recordStock(pid, r.qty, r.qty, 'compra', ref);
            recordPrice(pid, r.new_price, r.unit_cost);
            created++;
          }
          units += r.qty;
          if (r.code && sup) db.prepare('INSERT INTO supplier_codes (supplier, code, product_id) VALUES (?,?,?) ON CONFLICT(supplier, code) DO UPDATE SET product_id = excluded.product_id').run(sup, String(r.code).trim(), pid);
          db.prepare(`INSERT INTO purchase_items (invoice_id, product_id, code, barcode, description, qty, unit_cost, iva_rate, freight_unit, old_cost, old_shipping_cost, old_price, new_price, created_product)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(invId, pid, r.code || '', r.barcode || '', r.description, r.qty, r.unit_cost, r.iva_rate, r.freight_unit,
            before ? before.cost : null, before ? before.shipping_cost : null, before ? before.price : null, r.new_price, before ? 0 : 1);
        }
        return { id: invId, created, updated, units };
      })();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  admin.get('/purchases', (_req, res) => {
    res.json(db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM purchase_items WHERE invoice_id = i.id) lines, (SELECT SUM(qty) FROM purchase_items WHERE invoice_id = i.id) units
      FROM purchase_invoices i ORDER BY i.id DESC LIMIT 500`).all());
  });

  admin.get('/purchases/:id', (req, res) => {
    const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'No encontrada' });
    inv.items = db.prepare('SELECT pi.*, p.name product_name FROM purchase_items pi LEFT JOIN products p ON p.id = pi.product_id WHERE invoice_id = ? ORDER BY pi.id').all(inv.id);
    res.json(inv);
  });

  admin.get('/purchases/:id/file', (req, res) => {
    const inv = db.prepare('SELECT file FROM purchase_invoices WHERE id = ?').get(req.params.id);
    if (!inv || !inv.file) return res.status(404).end();
    res.sendFile(path.join(INVOICES, path.basename(inv.file)));
  });

  // Anular: descuenta el stock que había sumado la factura. Costos y precios quedan como están (se editan a mano si hace falta).
  admin.post('/purchases/:id/annul', (req, res) => {
    try {
      db.transaction(() => {
        const inv = db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(req.params.id);
        if (!inv) throw new Error('No encontrada');
        if (inv.status === 'anulada') throw new Error('La factura ya estaba anulada');
        const ref = `anulación factura ${inv.number || '#' + inv.id} (${inv.supplier})`;
        for (const it of db.prepare('SELECT * FROM purchase_items WHERE invoice_id = ?').all(inv.id)) {
          if (!it.product_id) continue;
          const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(it.product_id);
          if (!p) continue;
          const delta = -Math.min(it.qty, p.stock);
          if (delta) {
            db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, it.product_id);
            recordStock(it.product_id, delta, p.stock + delta, 'ajuste', ref);
          }
        }
        db.prepare("UPDATE purchase_invoices SET status = 'anulada' WHERE id = ?").run(inv.id);
      })();
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Arma las filas finales con flete prorrateado, costo total y precio nuevo de cada producto
  function compute(b) {
    const s = getSettings();
    const policy = { mode: 'keep_markup', markup_pct: Number(s.default_markup || 40), no_decrease: true, ...(b.policy || {}) };
    const lines = (b.items || []).filter((it) => !it.skip).map((it) => ({
      product_id: it.product_id ? Number(it.product_id) : null,
      code: it.code || '', barcode: it.barcode || '', description: String(it.description || '').trim(),
      new_name: it.new_name, category: it.category, publish: !!it.publish,
      qty: Math.max(1, parseInt(it.qty, 10) || 0), unit_cost: round2(num(it.unit_cost)), iva_rate: num(it.iva_rate),
    }));
    if (!lines.length) throw new Error('La factura no tiene líneas para aplicar');
    for (const l of lines) if (!l.description && !l.product_id) throw new Error('Hay una línea sin descripción');
    const rows = withFreight(lines, num(b.freight)).map((l) => {
      const p = l.product_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(l.product_id) : null;
      if (l.product_id && !p) throw new Error(`El producto #${l.product_id} ya no existe`);
      const newTotal = unitTotalCost({ cost: l.unit_cost, shipping_cost: l.freight_unit, iva_rate: l.iva_rate });
      const new_price = newPriceFor(p, newTotal, policy, s);
      return {
        ...l, new_total_cost: newTotal, new_price,
        old_cost: p ? p.cost : null, old_total_cost: p ? unitTotalCost(p) : null, old_price: p ? p.price : null, old_stock: p ? p.stock : 0,
        product_name: p ? p.name : null,
        new_margin_pct: new_price > 0 ? round2(((new_price - newTotal) / new_price) * 100) : 0,
      };
    });
    return { rows, policy };
  }
}

module.exports = { register, matchLine, nameScore, newPriceFor };
