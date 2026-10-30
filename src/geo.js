// Ubicación de las direcciones y recorrido recomendado para el reparto.
// Geocodifica con OpenStreetMap (Nominatim, gratis). Si no encuentra la dirección, usa el centro aproximado de la localidad.
const { db, getSettings } = require('./db');

// centro aproximado de CABA y de los partidos del GBA (lat, lng)
const CENTROIDS = {
  'caba': [-34.6118, -58.4173],
  'avellaneda': [-34.6625, -58.3653], 'general san martin': [-34.5753, -58.5375], 'hurlingham': [-34.5886, -58.6383],
  'ituzaingo': [-34.6585, -58.6672], 'la matanza': [-34.7464, -58.5869], 'lanus': [-34.7033, -58.3953],
  'lomas de zamora': [-34.7608, -58.4061], 'moron': [-34.6534, -58.6198], 'quilmes': [-34.7242, -58.2526],
  'san isidro': [-34.4708, -58.5286], 'tres de febrero': [-34.6033, -58.5617], 'vicente lopez': [-34.5265, -58.4790],
  'almirante brown': [-34.8264, -58.3897], 'berazategui': [-34.7646, -58.2128], 'esteban echeverria': [-34.8130, -58.4659],
  'ezeiza': [-34.8536, -58.5236], 'florencio varela': [-34.8272, -58.2756], 'jose c. paz': [-34.5153, -58.7686],
  'malvinas argentinas': [-34.4880, -58.7008], 'merlo': [-34.6653, -58.7276], 'moreno': [-34.6506, -58.7897],
  'san fernando': [-34.4419, -58.5600], 'san miguel': [-34.5426, -58.7123], 'tigre': [-34.4260, -58.5797],
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const centroid = (city) => CENTROIDS[norm(city)] || null;

async function geocode(address, city) {
  if (process.env.GEOCODER === 'off') return null;
  const base = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org';
  const q = `${address}, ${norm(city) === 'caba' ? 'Ciudad Autónoma de Buenos Aires' : city + ', Buenos Aires'}, Argentina`;
  try {
    const r = await fetch(`${base}/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': `FarmaciaDurand/1.0 (${process.env.ADMIN_EMAIL || getSettings().email || 'contacto'})`, 'Accept-Language': 'es' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const [hit] = await r.json();
    return hit ? [Number(hit.lat), Number(hit.lon)] : null;
  } catch {
    return null;
  }
}

// guarda la ubicación del pedido (se llama al crearlo, sin hacer esperar al cliente)
async function locateOrder(orderId) {
  const o = db.prepare('SELECT id, address, city, delivery_method FROM orders WHERE id = ?').get(orderId);
  if (!o || o.delivery_method !== 'envio') return;
  const pos = (await geocode(o.address, o.city)) || centroid(o.city);
  if (pos) db.prepare('UPDATE orders SET lat = ?, lng = ? WHERE id = ?').run(pos[0], pos[1], o.id);
}

function km([a, b], [c, d]) {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// recorrido recomendado: desde la farmacia, siempre al pedido más cercano (vecino más próximo)
function route(orders) {
  const s = getSettings();
  let here = [Number(s.pharmacy_lat), Number(s.pharmacy_lng)];
  const withPos = orders.filter((o) => o.lat != null || centroid(o.city));
  const pending = withPos.map((o) => ({ ...o, pos: o.lat != null ? [o.lat, o.lng] : centroid(o.city) }));
  const out = [];
  let total = 0;
  while (pending.length) {
    let best = 0;
    for (let i = 1; i < pending.length; i++) if (km(here, pending[i].pos) < km(here, pending[best].pos)) best = i;
    const [next] = pending.splice(best, 1);
    next.km_from_prev = Math.round(km(here, next.pos) * 10) / 10;
    total += next.km_from_prev;
    out.push(next);
    here = next.pos;
  }
  const rest = orders.filter((o) => !withPos.includes(o)); // sin ubicación: al final
  return { stops: [...out, ...rest], total_km: Math.round(total * 10) / 10 };
}

// link de Google Maps con el recorrido (Google acepta hasta 9 paradas intermedias por link)
function mapsLinks(stops) {
  const s = getSettings();
  const origin = `${s.address}, ${s.city}`;
  const place = (o) => `${o.address}, ${o.city}, Argentina`;
  const links = [];
  for (let i = 0; i < stops.length; i += 10) {
    const chunk = stops.slice(i, i + 10);
    const from = i === 0 ? origin : place(stops[i - 1]);
    const dest = place(chunk[chunk.length - 1]);
    const way = chunk.slice(0, -1).map(place).join('|');
    links.push(`https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(dest)}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}`);
  }
  return links;
}

module.exports = { geocode, locateOrder, route, mapsLinks, centroid };
