// Lectura de planillas Excel (.xlsx): el "Modificar en Excel" de Mercado Libre o una planilla común con encabezados.
const ExcelJS = require('exceljs');
const { num } = require('./csv');

// valor "plano" de una celda (texto enriquecido, fórmulas, hipervínculos)
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return cellText(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

async function readWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

// ---------- Excel de Mercado Libre ----------
// si el título es muy corto (ej. "Silfab P63"), el nombre de la variante suele ser más descriptivo
function betterTitle(title, variation) {
  const t = title.replace(/\s+/g, ' ').trim();
  const v = variation.replace(/\s+/g, ' ').trim().replace(/\s+(color\s+)?(unico|único)$/i, '');
  return t.split(' ').length <= 3 && v.length > t.length ? `${v} (${t})` : t;
}
// Hoja "Publicaciones": fila 1 con códigos (ITEM_ID, TITLE, PRICE...), filas 2-6 de ayuda, datos desde la 7.
function mlSheet(wb) {
  const ws = wb.worksheets.find((w) => w.state === 'visible' && cellText(w.getRow(1).getCell(2).value) === 'ITEM_ID');
  if (!ws) return null;
  const head = {};
  ws.getRow(1).eachCell((c, i) => { head[cellText(c.value).trim()] = i; });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n < 2) return;
    const get = (k) => (head[k] ? cellText(row.getCell(head[k]).value).trim() : '');
    const id = get('ITEM_ID');
    if (!/^MLA\d+$/i.test(id)) return; // salta las filas de ayuda
    rows.push({
      ml_id: id.toUpperCase(),
      title: betterTitle(get('TITLE'), get('VARIATIONS')),
      variation: get('VARIATIONS'),
      stock: num(get('STOCK_FLEX')),
      price: num(get('PRICE')),
      sale_price: num(get('SALE_PRICE')),
      iva: /exento/i.test(get('VALUE_ADDED_TAX')) ? 0 : num(get('VALUE_ADDED_TAX').replace('%', '')),
      description: get('DESCRIPTION').replace(/\r/g, '').trim(),
    });
  });
  return rows;
}

// ---------- planilla común: primera fila con encabezados ----------
function genericRows(wb) {
  const ws = wb.worksheets.find((w) => w.state === 'visible' && w.rowCount > 1);
  if (!ws) return [];
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i] = cellText(c.value).trim().toLowerCase(); });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    headers.forEach((h, i) => { if (h) o[h] = cellText(row.getCell(i).value).trim(); });
    if (Object.values(o).some((v) => v !== '')) rows.push(o);
  });
  return rows;
}

// ---------- marca y categoría deducidas del título ----------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const BRANDS = [[/silfab/, 'Silfab'], [/jm ?sports/, 'JM Sports'], [/\bboos\b/, 'Boos'], [/disney/, 'Disney'], [/bernabo/, 'Bernabó'], [/microsul/, 'Microsules']];
const CATEGORIES = [
  [/aerocamara|nebuliz|\bp63\b/, 'Respiratorio y nebulización'],
  [/tensiometro|bp700|oximetro|saturometro/, 'Tensiómetros y medición'],
  [/balanza/, 'Balanzas'],
  [/perfume|colonia|elixir|mochila/, 'Perfumería'],
  [/comprimido|\bcomp\b|capsula|clotrimazol|antimicotic|\d+ ?mg\b/, 'Medicamentos de venta libre'],
  [/rodillera|hombrera|tobillera|pedalera|rehabilitacion|ortoped/, 'Ortopedia y rehabilitación'],
  [/frio|calor|frazada|termic|almohadon|gel\b/, 'Frío, calor y confort'],
  [/secador|planchita|cepillo/, 'Cuidado personal'],
  [/guante|barbijo|jeringa|descartable/, 'Descartables'],
];
const guessBrand = (t) => (BRANDS.find(([r]) => r.test(norm(t))) || [])[1] || '';
const guessCategory = (t) => (CATEGORIES.find(([r]) => r.test(norm(t))) || [])[1] || 'Salud y bienestar';
const mlPermalink = (id) => `https://articulo.mercadolibre.com.ar/${id.replace(/^MLA/i, 'MLA-')}`;

module.exports = { readWorkbook, mlSheet, genericRows, guessBrand, guessCategory, mlPermalink };
