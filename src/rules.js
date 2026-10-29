// Reglas de negocio configurables desde el panel: zonas de envío y precio mínimo.
const { db, getSettings, round2 } = require('./db');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- zonas de envío ----------
function shippingZones(s = getSettings()) {
  try {
    const z = JSON.parse(s.shipping_zones || '[]');
    return Array.isArray(z) ? z : [];
  } catch {
    return [];
  }
}

function zoneFor(place, s = getSettings()) {
  const n = norm(place);
  if (!n) return null;
  return shippingZones(s).find((z) => z.enabled && (z.places || []).some((p) => norm(p) === n)) || null;
}

// costo de envío para una localidad; null si no se envía ahí
function shippingQuote(subtotal, place, s = getSettings()) {
  const zone = zoneFor(place, s);
  if (!zone) return null;
  const free = Number(zone.free_from || 0);
  return { zone: zone.name, fee: free > 0 && subtotal >= free ? 0 : Number(zone.fee || 0) };
}

function cleanZones(zones) {
  if (!Array.isArray(zones)) throw new Error('Formato de zonas inválido');
  return zones
    .map((z) => ({
      name: String(z.name || '').trim().slice(0, 60),
      fee: Math.max(0, Number(z.fee) || 0),
      free_from: Math.max(0, Number(z.free_from) || 0),
      enabled: !!z.enabled,
      places: [...new Set((Array.isArray(z.places) ? z.places : String(z.places || '').split(/[\n,]/)).map((p) => String(p).trim()).filter(Boolean))],
    }))
    .filter((z) => z.name);
}

// ---------- costo de la página y precio mínimo ----------
// unidades vendidas por mes (promedio de los últimos 90 días) para repartir los costos fijos
function avgUnitsPerMonth() {
  const r = db.prepare(`SELECT COALESCE(SUM(i.qty), 0) u FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.status NOT IN ('cancelado','rechazado') AND o.created_at >= datetime('now','localtime','-90 days')`).get();
  return r.u / 3;
}

// se cachea unos segundos: se usa para cada producto de las listas
let pcCache = null;
function pageCost(s) {
  if (!s && pcCache && pcCache.until > Date.now()) return pcCache.value;
  const value = computePageCost(s || getSettings());
  if (!s) pcCache = { value, until: Date.now() + 15000 };
  return value;
}
const clearPageCostCache = () => { pcCache = null; };

function computePageCost(s) {
  const fixed = Number(s.page_fixed_monthly || 0);
  const manual = Number(s.page_units_month || 0);
  const units = manual > 0 ? manual : Math.round(avgUnitsPerMonth());
  return {
    fixed_monthly: fixed,
    units_month: units,
    units_source: manual > 0 ? 'manual' : 'promedio últimos 3 meses',
    fixed_per_unit: units > 0 ? round2(fixed / units) : fixed,
    fee_pct: Number(s.page_fee_pct || 0),
  };
}

// precio de venta que cubre: costo total (con IVA y flete) + parte del costo fijo de la página + comisiones/impuestos sobre la venta
function minPrice(unitTotalCost, pc = pageCost()) {
  const k = 1 - pc.fee_pct / 100;
  return round2((unitTotalCost + pc.fixed_per_unit) / (k > 0.05 ? k : 0.05));
}

// costo de vender una unidad a cierto precio (lo que se lleva la página)
const pageCostOfSale = (price, pc = pageCost()) => round2(pc.fixed_per_unit + (price * pc.fee_pct) / 100);

module.exports = { shippingZones, zoneFor, shippingQuote, cleanZones, pageCost, clearPageCostCache, minPrice, pageCostOfSale, norm };
