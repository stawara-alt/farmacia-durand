// Importación de publicaciones de Mercado Libre.
// Con access token (recomendado): usa /users/{id}/items/search y /items?ids=...
// Sin token: intenta la búsqueda pública por seller_id (Mercado Libre la puede restringir).
const API = 'https://api.mercadolibre.com';

async function mlFetch(url, token) {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Mercado Libre respondió ${res.status} en ${url.replace(API, '')}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const categoryCache = new Map();
async function categoryName(id, token) {
  if (!id) return 'General';
  if (categoryCache.has(id)) return categoryCache.get(id);
  try {
    const c = await mlFetch(`${API}/categories/${id}`, token);
    categoryCache.set(id, c.name);
    return c.name;
  } catch {
    return 'General';
  }
}

async function listItemIds(sellerId, token) {
  const ids = [];
  if (token) {
    if (!sellerId) sellerId = (await mlFetch(`${API}/users/me`, token)).id;
    // search_type=scan permite recorrer más de 1000 publicaciones
    let scrollId = null;
    for (let guard = 0; guard < 200; guard++) {
      const url = `${API}/users/${sellerId}/items/search?status=active&search_type=scan&limit=100${scrollId ? `&scroll_id=${scrollId}` : ''}`;
      const r = await mlFetch(url, token);
      if (!r.results || r.results.length === 0) break;
      ids.push(...r.results);
      scrollId = r.scroll_id;
      if (!scrollId) break;
    }
    return { ids, sellerId };
  }
  if (!sellerId) throw new Error('Ingresá el ID de vendedor o un access token de Mercado Libre.');
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await mlFetch(`${API}/sites/MLA/search?seller_id=${sellerId}&limit=50&offset=${offset}`);
    ids.push(...r.results.map((x) => x.id));
    if (offset + 50 >= Math.min(r.paging.total, 1000)) break;
  }
  return { ids, sellerId };
}

async function fetchItems(ids, token) {
  const out = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const r = await mlFetch(`${API}/items?ids=${chunk.join(',')}`, token);
    for (const entry of r) if (entry.code === 200) out.push(entry.body);
  }
  return out;
}

async function description(id, token) {
  try {
    const d = await mlFetch(`${API}/items/${id}/description`, token);
    return d.plain_text || '';
  } catch {
    return '';
  }
}

async function fetchSellerProducts({ sellerId, token, withDescriptions = true }) {
  const { ids } = await listItemIds(sellerId, token);
  const items = await fetchItems(ids, token);
  const products = [];
  for (const it of items) {
    const brand = (it.attributes || []).find((a) => a.id === 'BRAND')?.value_name || '';
    const sku = it.seller_custom_field || (it.attributes || []).find((a) => a.id === 'SELLER_SKU')?.value_name || '';
    products.push({
      ml_id: it.id,
      name: it.title,
      price: it.price,
      stock: it.available_quantity ?? 0,
      images: (it.pictures || []).map((p) => p.secure_url || p.url).filter(Boolean),
      category: await categoryName(it.category_id, token),
      brand,
      sku,
      ml_permalink: it.permalink,
      description: withDescriptions ? await description(it.id, token) : '',
    });
  }
  return products;
}

module.exports = { fetchSellerProducts };
