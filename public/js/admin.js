let S = {};
let PRODUCTS = [];
let PC = { fixed_per_unit: 0, fee_pct: 0, fixed_monthly: 0, units_month: 0, units_source: '' }; // costo de la página
// precio mínimo = (costo total + costo fijo por unidad) / (1 - comisiones%)
const minPriceFor = (total) => (total + PC.fixed_per_unit) / Math.max(0.05, 1 - PC.fee_pct / 100);
const pageCostFor = (price) => PC.fixed_per_unit + (price * PC.fee_pct) / 100;
const charts = [];
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a']; // paleta categórica validada (orden fijo)
const TABS = { resumen: 'Resumen', pedidos: 'Pedidos', productos: 'Productos y stock', compras: 'Facturas de compra', promos: 'Promociones', reclamos: 'Reclamos', costos: 'Costos y márgenes', estadisticas: 'Estadísticas', importar: 'Importar productos', mensajes: 'Mensajes', config: 'Configuración' };
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtMonth = (m) => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ${y.slice(2)}`; };
const fmtDate = (d) => new Date(d.replace(' ', 'T')).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pct = (n) => `${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
const stBadge = (s) => `<span class="st st-${s}">${STATUS_LABELS[s] || s}</span>`;

// ---------- arranque / login ----------
async function boot() {
  try { await api('/api/admin/me'); showApp(); }
  catch { $('#login').classList.remove('hidden'); }
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); $('#login').classList.add('hidden'); showApp(); }
    catch (err) { $('#login-err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
  };
}

async function showApp() {
  $('#shell').classList.remove('hidden');
  [S, PC] = await Promise.all([api('/api/admin/settings'), api('/api/admin/page-cost')]);
  applyTheme(S);
  $('#a-brand').innerHTML = `${logoHTML(S)}`;
  $$('#side-nav a').forEach((a) => (a.onclick = () => { location.hash = a.dataset.tab; $('#side').classList.remove('open'); }));
  $('#side-toggle').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); };
  window.onhashchange = route;
  route();
  refreshBadges();
  setInterval(refreshBadges, 30000);
}

async function refreshBadges() {
  try {
    const d = await api('/api/admin/dashboard');
    $('#n-pend').textContent = d.pending || '';
    $('#n-msg').textContent = d.unread_messages || '';
    $('#n-claims').textContent = d.open_claims || '';
    return d;
  } catch (e) { if (e.status === 401) location.reload(); }
}

function route() {
  const tab = TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'resumen';
  $$('#side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  $('#tab-title').textContent = TABS[tab];
  $('#layer').innerHTML = '';
  charts.splice(0).forEach((c) => c.destroy());
  $('#view').innerHTML = '<p class="muted">Cargando…</p>';
  VIEWS[tab]().catch((e) => { $('#view').innerHTML = `<div class="error-box">${esc(e.message)}</div>`; });
}

function openModal(html, wide = false) {
  $('#layer').innerHTML = `<div class="overlay"><div class="modal ${wide ? '' : 'sm'}"><button class="icon-btn close" data-close aria-label="Cerrar">${icon('x')}</button><div class="modal-pad">${html}</div></div></div>`;
  const ov = $('#layer .overlay');
  const close = () => { $('#layer').innerHTML = ''; };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  return close;
}

// ---------- gráficos ----------
function chart(canvas, type, labels, datasets, { money: isMoney = true, stacked = false, horizontal = false } = {}) {
  if (typeof Chart === 'undefined') { // sin librería de gráficos: no romper la vista
    canvas.parentElement.innerHTML = '<p class="muted">No se pudo cargar el gráfico.</p>';
    return { destroy() {}, update() {} };
  }
  const fmt = (v) => (isMoney ? money(v) : Number(v).toLocaleString('es-AR'));
  const c = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        borderColor: SERIES[i], backgroundColor: SERIES[i], borderWidth: type === 'line' ? 2 : 0, borderRadius: 4,
        pointRadius: 3, pointHoverRadius: 6, tension: .25, maxBarThickness: 28, spanGaps: true, ...d,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: 'top', align: 'start', labels: { boxWidth: 12, boxHeight: 12, color: '#5b6b66', font: { family: 'Nunito', weight: 700 } } },
        tooltip: { backgroundColor: '#1f2a27', padding: 10, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(horizontal ? ctx.parsed.x : ctx.parsed.y)}` } },
      },
      indexAxis: horizontal ? 'y' : 'x',
      scales: {
        [horizontal ? 'y' : 'x']: { stacked, grid: { display: false }, ticks: { color: '#5b6b66' } },
        [horizontal ? 'x' : 'y']: { stacked, beginAtZero: true, grid: { color: '#eef2f0' }, border: { display: false }, ticks: { color: '#5b6b66', callback: (v) => (isMoney ? '$' + Number(v).toLocaleString('es-AR', { notation: 'compact' }) : Number(v).toLocaleString('es-AR')) } },
      },
    },
  });
  charts.push(c);
  return c;
}

// =================== VISTAS ===================
const VIEWS = {};

VIEWS.resumen = async () => {
  const [d, orders, stats] = await Promise.all([refreshBadges(), api('/api/admin/orders'), api('/api/admin/stats?months=6')]);
  const pending = orders.filter((o) => ['pendiente', 'aceptado', 'en_preparacion', 'en_envio', 'listo_retiro'].includes(o.status)).slice(0, 10);
  $('#view').innerHTML = `
    <div class="page-head"><h1>¡Hola! 👋</h1><a class="btn btn-primary btn-sm" href="#pedidos">Ver todos los pedidos</a></div>
    <div class="kpis">
      <div class="kpi"><div class="lbl">Pedidos por confirmar</div><div class="val">${d.pending}</div><div class="sub">esperando revisión</div></div>
      <div class="kpi"><div class="lbl">Pedidos en curso</div><div class="val">${d.active}</div><div class="sub">aceptados / preparación / envío</div></div>
      <div class="kpi"><div class="lbl">Ventas del mes</div><div class="val">${money(d.month_revenue)}</div><div class="sub">${d.month_orders} pedidos</div></div>
      <div class="kpi"><div class="lbl">Stock bajo</div><div class="val ${d.low_stock ? 'low' : ''}">${d.low_stock}</div><div class="sub">productos con ≤ 3 unidades</div></div>
      <div class="kpi"><div class="lbl">Mensajes sin leer</div><div class="val">${d.unread_messages}</div><div class="sub"><a href="#mensajes">ver mensajes</a></div></div>
    </div>
    <div class="panels-2">
      <div class="panel"><h3>Pedidos activos</h3>${ordersTable(pending, true)}</div>
      <div class="panel"><h3>Ventas — últimos 6 meses</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>
    </div>`;
  bindOrderRows();
  chart($('#c1'), 'bar', stats.months.map((m) => fmtMonth(m.month)), [{ label: 'Ventas', data: stats.months.map((m) => m.revenue) }]);
};

// ---------- pedidos ----------
function ordersTable(list, compact = false) {
  if (!list.length) return '<p class="muted">No hay pedidos para mostrar.</p>';
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Fecha</th><th>Cliente</th>${compact ? '' : '<th>Entrega</th><th>Pago</th>'}<th class="num">Total</th><th>Estado</th></tr></thead><tbody>
    ${list.map((o) => `<tr class="click" data-order="${o.id}"><td><b>${o.id}</b></td><td>${fmtDate(o.created_at)}</td><td>${esc(o.customer_name)}${compact ? '' : `<br><small class="muted">${esc(o.email)}</small>`}</td>
      ${compact ? '' : `<td>${o.delivery_method === 'envio' ? '🚚 Envío' : '🏪 Retiro'}</td><td>${o.payment_method === 'qr' ? 'QR' : 'Transferencia'}${o.receipt ? ' 📎' : ''}</td>`}
      <td class="num">${money(o.total)}</td><td>${stBadge(o.status)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindOrderRows() { $$('[data-order]').forEach((r) => (r.onclick = () => openOrder(r.dataset.order))); }

VIEWS.pedidos = async () => {
  $('#view').innerHTML = `<div class="page-head"><h1>Pedidos</h1></div>
    <div class="filters"><input type="search" id="o-q" placeholder="Buscar cliente, email o #">
      ${['', ...Object.keys(STATUS_LABELS)].map((s) => `<button class="chip-f ${s ? '' : 'active'}" data-st="${s}">${s ? STATUS_LABELS[s] : 'Todos'}</button>`).join('')}</div>
    <div class="panel" id="o-list"></div>`;
  let st = '';
  const load = async () => {
    const q = $('#o-q').value.trim();
    const list = await api(`/api/admin/orders?status=${st}&q=${encodeURIComponent(q)}`);
    $('#o-list').innerHTML = ordersTable(list);
    bindOrderRows();
  };
  $$('[data-st]').forEach((b) => (b.onclick = () => { st = b.dataset.st; $$('[data-st]').forEach((x) => x.classList.toggle('active', x === b)); load(); }));
  let t; $('#o-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  VIEWS.pedidos.reload = load;
  await load();
};

async function openOrder(id) {
  const o = await api('/api/admin/orders/' + id);
  const cost = o.items.reduce((a, i) => a + i.unit_cost_total * i.qty, 0);
  const profit = o.subtotal - cost;
  const link = `${location.origin}/pedido/${o.code}`;
  const flow = o.delivery_method === 'envio' ? ['pendiente', 'aceptado', 'en_preparacion', 'en_envio', 'entregado'] : ['pendiente', 'aceptado', 'en_preparacion', 'listo_retiro', 'entregado'];
  const close = openModal(`
    <h2>Pedido #${o.id} ${stBadge(o.status)}</h2>
    <p class="muted" style="margin-top:-6px">${fmtDate(o.created_at)} · <a href="${link}" target="_blank">ver página del cliente ↗</a></p>
    <div class="two">
      <div class="panel" style="box-shadow:none;border:1px solid var(--line)"><b>Cliente</b><br>${esc(o.customer_name)}<br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a><br>
        ${o.phone ? `<a href="https://wa.me/${o.phone.replace(/\D/g, '')}" target="_blank">${esc(o.phone)}</a>` : ''}</div>
      <div class="panel" style="box-shadow:none;border:1px solid var(--line)"><b>${o.delivery_method === 'envio' ? '🚚 Envío a domicilio' : '🏪 Retiro en local'}</b>${o.shipping_zone ? ` <span class="st st-aceptado">${esc(o.shipping_zone)}</span>` : ''}<br>${esc(o.address)}${o.city ? ', ' + esc(o.city) : ''}<br>
        <b>Pago:</b> ${o.payment_method === 'qr' ? 'QR' : 'Transferencia'}<br>
        ${o.receipt ? `<a href="/api/admin/receipts/${esc(o.receipt)}" target="_blank" class="btn btn-ghost btn-sm" style="margin-top:6px">📎 Ver comprobante</a>` : '<span class="muted">Sin comprobante aún</span>'}</div>
    </div>
    ${o.notes ? `<div class="help" style="margin-bottom:12px"><b>Nota del cliente:</b> ${esc(o.notes)}</div>` : ''}
    ${o.arrival_code ? `<div class="help" style="margin-bottom:12px">📬 Entregado el ${fmtDate(o.delivered_at)} · código de llegada <b style="letter-spacing:2px">${esc(o.arrival_code)}</b></div>` : ''}
    ${o.claims.length ? `<div class="error-box" style="font-weight:600">⚠️ Reclamos: ${o.claims.map((c) => `<a href="#reclamos" data-claim="${c.id}">#${c.id} ${esc(c.type_label)} (${esc(c.status_label)})</a>`).join(' · ')}</div>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Costo total</th><th class="num">Subtotal</th></tr></thead><tbody>
      ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${money(i.unit_price)}</td><td class="num muted">${money(i.unit_cost_total)}</td><td class="num">${money(i.unit_price * i.qty)}</td></tr>`).join('')}
    </tbody><tfoot>
      <tr><td colspan="4">Envío cobrado</td><td class="num">${money(o.shipping_fee)}</td></tr>
      <tr><td colspan="4">Total cobrado</td><td class="num">${money(o.total)}</td></tr>
      <tr><td colspan="4">Ganancia bruta (productos − costo c/IVA y envío)</td><td class="num ${profit >= 0 ? 'pos' : 'neg'}">${money(profit)}</td></tr>
      <tr><td colspan="4">Costo de la página (comisiones + parte del costo fijo, estimado)</td><td class="num neg">− ${money(o.page_cost)}</td></tr>
      <tr><td colspan="4">Ganancia neta estimada</td><td class="num ${profit - o.page_cost >= 0 ? 'pos' : 'neg'}">${money(profit - o.page_cost)}</td></tr>
    </tfoot></table></div>

    <div class="panel" style="box-shadow:none;border:2px solid var(--primary);margin-top:16px">
      <h3>Actualizar estado</h3>
      <div class="filters">${[...flow, 'rechazado', 'cancelado'].map((s) => `<label class="chip-f" style="display:flex;gap:6px"><input type="radio" name="st" value="${s}" ${s === o.status ? 'checked' : ''}>${STATUS_LABELS[s]}</label>`).join('')}</div>
      <div class="field"><label>Mensaje para el cliente (opcional)</label><textarea id="st-note" style="min-height:60px" placeholder="Ej: Tu pedido sale hoy entre las 16 y 18 hs."></textarea></div>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-weight:700"><input type="checkbox" id="st-notify" checked> Avisar al cliente por email</label>
      <p class="muted" style="margin-top:-4px;font-size:.88rem">Al marcarlo como <b>Entregado</b>, el cliente recibe el email "Tu pedido llegó" con su <b>código de llegada</b>, el link para reclamar y tu WhatsApp.</p>
      <button class="btn btn-primary" id="st-save">Guardar estado</button>
    </div>
    <h3>Historial</h3>
    <ul class="timeline">${[...o.history].reverse().map((h) => `<li><b>${STATUS_LABELS[h.status] || h.status}</b> <span class="muted">· ${fmtDate(h.created_at)}</span>${h.note ? `<br>${esc(h.note)}` : ''}</li>`).join('')}</ul>`, true);
  $$('[data-claim]', $('#layer')).forEach((el) => (el.onclick = (e) => { e.preventDefault(); close(); openClaim(el.dataset.claim); }));
  $('#st-save').onclick = async () => {
    const status = $('input[name=st]:checked').value;
    try {
      await api(`/api/admin/orders/${o.id}/status`, { method: 'PATCH', body: { status, note: $('#st-note').value, notify: $('#st-notify').checked } });
      toast(`Pedido #${o.id}: ${STATUS_LABELS[status]}${$('#st-notify').checked ? ' · cliente notificado ✉️' : ''}`);
      close();
      refreshBadges();
      if (location.hash === '#pedidos' && VIEWS.pedidos.reload) VIEWS.pedidos.reload(); else route();
    } catch (e) { toast(e.message); }
  };
}

// ---------- productos ----------
VIEWS.productos = async () => {
  PRODUCTS = await api('/api/admin/products');
  const cats = [...new Set(PRODUCTS.map((p) => p.category))].sort();
  $('#view').innerHTML = `<div class="page-head"><h1>Productos y stock</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-ghost btn-sm" href="#importar">⬇️ Importar</a><button class="btn btn-primary btn-sm" id="p-new">+ Nuevo producto</button></div></div>
    <div class="filters"><input type="search" id="p-q" placeholder="Buscar producto…">
      <select id="p-cat" style="max-width:220px"><option value="">Todas las categorías</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <label class="chip-f" style="display:flex;gap:6px"><input type="checkbox" id="p-low"> Solo stock bajo</label>
      <span class="muted" id="p-count"></span></div>
    <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th class="num">Stock</th><th>Estado</th><th></th></tr></thead><tbody id="p-body"></tbody></table></div></div>`;
  const render = () => {
    const q = $('#p-q').value.toLowerCase(), c = $('#p-cat').value, low = $('#p-low').checked;
    const list = PRODUCTS.filter((p) => (!q || `${p.name} ${p.brand} ${p.sku}`.toLowerCase().includes(q)) && (!c || p.category === c) && (!low || p.stock <= 3));
    $('#p-count').textContent = `${list.length} productos`;
    $('#p-body').innerHTML = list.map((p) => `<tr>
      <td><img class="mini" src="${esc(p.images[0] || PLACEHOLDER)}" alt="" onerror="this.src=PLACEHOLDER"></td>
      <td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.brand)} ${p.sku ? '· ' + esc(p.sku) : ''} ${p.ml_id ? '· ML ' + esc(p.ml_id) : ''}</small></td>
      <td>${esc(p.category)}</td><td class="num">${money(p.price)}</td>
      <td class="num"><div class="qty"><button data-sd="${p.id}" aria-label="Restar">−</button><span class="${p.stock <= 3 ? 'low' : ''}">${p.stock}</span><button data-si="${p.id}" aria-label="Sumar">+</button></div></td>
      <td>${p.active ? '<span class="st st-entregado">Publicado</span>' : '<span class="st st-cancelado">Oculto</span>'}${p.requires_prescription ? ' <span class="st st-en_preparacion">Receta</span>' : ''}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin resultados</td></tr>';
    $$('[data-edit]').forEach((b) => (b.onclick = () => productForm(PRODUCTS.find((p) => p.id == b.dataset.edit))));
    const adj = async (id, d) => {
      const p = PRODUCTS.find((x) => x.id == id);
      const upd = await api(`/api/admin/products/${id}`, { method: 'PUT', body: { stock: Math.max(0, p.stock + d) } });
      Object.assign(p, upd); render();
    };
    $$('[data-si]').forEach((b) => (b.onclick = () => adj(b.dataset.si, 1)));
    $$('[data-sd]').forEach((b) => (b.onclick = () => adj(b.dataset.sd, -1)));
  };
  $('#p-q').oninput = render; $('#p-cat').onchange = render; $('#p-low').onchange = render;
  $('#p-new').onclick = () => productForm(null);
  render();
};

function productForm(p) {
  const isNew = !p;
  p = p || { name: '', description: '', category: '', brand: '', sku: '', barcode: '', price: 0, cost: 0, shipping_cost: 0, iva_rate: 21, stock: 0, images: [], requires_prescription: false, featured: false, active: true };
  let images = [...p.images];
  const cats = [...new Set(PRODUCTS.map((x) => x.category))];
  const close = openModal(`<h2>${isNew ? 'Nuevo producto' : 'Editar producto'}</h2>
    <form id="pf">
      <div class="field"><label>Fotos (la primera es la principal)</label><div class="img-list" id="imgs"></div></div>
      <div class="field"><label>Nombre</label><input type="text" name="name" value="${esc(p.name)}" required></div>
      <div class="three">
        <div class="field"><label>Categoría</label><input type="text" name="category" value="${esc(p.category)}" list="cats"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="field"><label>Marca</label><input type="text" name="brand" value="${esc(p.brand)}"></div>
        <div class="field"><label>SKU / Código</label><input type="text" name="sku" value="${esc(p.sku)}"></div>
        <div class="field"><label>Código de barras</label><input type="text" name="barcode" value="${esc(p.barcode || '')}"></div>
      </div>
      <div class="field"><label>Descripción</label><textarea name="description">${esc(p.description)}</textarea></div>
      <div class="three">
        <div class="field"><label>Precio de venta ($)</label><input type="number" step="0.01" min="0" name="price" value="${p.price}" required></div>
        <div class="field"><label>Stock (unidades)</label><input type="number" min="0" name="stock" value="${p.stock}"></div>
        <div class="field"><label>IVA (%)</label><select name="iva_rate">${[0, 10.5, 21, 27].map((v) => `<option ${Number(p.iva_rate) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Costo del producto ($, sin IVA)</label><input type="number" step="0.01" min="0" name="cost" value="${p.cost}"></div>
        <div class="field"><label>Costo de envío/flete por unidad ($)</label><input type="number" step="0.01" min="0" name="shipping_cost" value="${p.shipping_cost}"></div>
      </div>
      <div class="calc" id="calc"></div>
      <div class="checks" style="margin-top:14px">
        <label><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Publicado en la tienda</label>
        <label><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> Destacado</label>
        <label><input type="checkbox" name="requires_prescription" ${p.requires_prescription ? 'checked' : ''}> Venta bajo receta (no se vende online)</label>
      </div>
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">
        ${isNew ? '<span></span>' : '<button type="button" class="btn btn-light btn-sm" id="pf-del" style="color:#b3261e">Eliminar</button>'}
        <button class="btn btn-primary">Guardar</button>
      </div>
    </form>`, true);
  const f = $('#pf');
  const renderImgs = () => {
    $('#imgs').innerHTML = images.map((u, i) => `<div class="im"><img src="${esc(u)}" alt="">${i === 0 ? '<span class="first">Principal</span>' : `<span class="first" style="background:#5b6b66;cursor:pointer" data-main="${i}">Hacer principal</span>`}<button type="button" data-rmimg="${i}">×</button></div>`).join('')
      + `<label class="img-add" title="Subir fotos">+<input type="file" accept="image/*" multiple hidden id="img-in"></label>
         <button type="button" class="btn btn-light btn-sm" id="img-url">+ desde URL</button>`;
    $$('[data-rmimg]').forEach((b) => (b.onclick = () => { images.splice(+b.dataset.rmimg, 1); renderImgs(); }));
    $$('[data-main]').forEach((b) => (b.onclick = () => { const [x] = images.splice(+b.dataset.main, 1); images.unshift(x); renderImgs(); }));
    $('#img-in').onchange = async (e) => {
      const fd = new FormData();
      [...e.target.files].forEach((file) => fd.append('images', file));
      try { const r = await api('/api/admin/upload', { method: 'POST', body: fd }); images.push(...r.urls); renderImgs(); } catch (err) { toast(err.message); }
    };
    $('#img-url').onclick = () => { const u = prompt('Pegá la URL de la imagen'); if (u) { images.push(u.trim()); renderImgs(); } };
  };
  const calc = () => {
    const price = +f.price.value || 0, cost = +f.cost.value || 0, ship = +f.shipping_cost.value || 0, iva = +f.iva_rate.value || 0;
    const ivaAmt = (cost + ship) * iva / 100, total = cost + ship + ivaAmt, page = pageCostFor(price), margin = price - total - page, min = minPriceFor(total);
    $('#calc').innerHTML = `<div><span>IVA sobre costo</span><b>${money(ivaAmt)}</b></div><div><span>Costo total c/IVA</span><b>${money(total)}</b></div>
      <div><span>Precio mínimo</span><b class="${price && price < min ? 'neg' : ''}">${money(min)}</b>${price && price < min ? '<br><small class="neg">el precio no cubre los costos</small>' : ''}</div>
      <div><span>Costo de la página</span><b>${money(page)}</b></div>
      <div><span>Ganancia neta por unidad</span><b class="${margin >= 0 ? 'pos' : 'neg'}">${money(margin)}</b></div>
      <div><span>Margen neto s/ venta</span><b>${price ? pct((margin / price) * 100) : '—'}</b></div>`;
  };
  renderImgs(); calc();
  ['price', 'cost', 'shipping_cost', 'iva_rate'].forEach((n) => (f[n].oninput = calc));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    ['active', 'featured', 'requires_prescription'].forEach((k) => (body[k] = f[k].checked));
    body.images = images;
    try {
      await api(isNew ? '/api/admin/products' : `/api/admin/products/${p.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast('Producto guardado ✓'); close(); route();
    } catch (err) { toast(err.message); }
  };
  if (!isNew) $('#pf-del').onclick = async () => {
    if (!confirm(`¿Eliminar "${p.name}"?`)) return;
    const r = await api(`/api/admin/products/${p.id}`, { method: 'DELETE' });
    toast(r.deactivated ? 'Tenía ventas: se ocultó de la tienda para conservar las estadísticas' : 'Producto eliminado');
    close(); route();
  };
}

// ---------- promociones y suscriptores ----------
let promoPoll = null;
VIEWS.promos = async () => {
  clearTimeout(promoPoll);
  const [{ promotions, subscribers, smtp }, subs] = await Promise.all([api('/api/admin/promotions'), api('/api/admin/subscribers')]);
  const t = localDate();
  const state = (p) => !p.active ? ['Pausada', 'st-cancelado'] : p.starts_at && p.starts_at > t ? ['Programada', 'st-aceptado'] : p.ends_at && p.ends_at < t ? ['Vencida', 'st-cancelado'] : ['Vigente', 'st-entregado'];
  const target = (p) => p.target === 'all' ? 'Toda la tienda' : p.target === 'category' ? `Categoría: ${esc(p.target_category)}` : `${p.product_ids.length} productos`;
  const sendTxt = (p) => p.send_status === 'enviando' ? `<span class="st st-pendiente">Enviando ${p.sent_count}/${p.send_total}</span>`
    : p.send_status === 'enviada' ? `<small>Enviada a ${p.sent_count}<br><span class="muted">${fmtDate(p.sent_at)}</span></small>` : '<span class="muted">Sin enviar</span>';
  const fdate = (d) => (d ? d.split('-').reverse().join('/') : '');
  const active = subs.filter((s) => s.active);
  $('#view').innerHTML = `<div class="page-head"><h1>Promociones</h1><button class="btn btn-primary btn-sm" id="pr-new">+ Nueva promoción</button></div>
    ${smtp ? '' : '<div class="error-box" style="font-weight:600">⚠️ Todavía no está configurado el servidor de correo (SMTP en .env): los emails se simulan y no llegan a nadie.</div>'}
    <div class="kpis">
      <div class="kpi"><div class="lbl">Suscriptores activos</div><div class="val">${subscribers}</div><div class="sub">${subs.filter((s) => s.source === 'compra' && s.active).length} desde compras · ${subs.filter((s) => s.source === 'web' && s.active).length} desde la web</div></div>
      <div class="kpi"><div class="lbl">Promociones vigentes</div><div class="val">${promotions.filter((p) => state(p)[0] === 'Vigente').length}</div><div class="sub">se muestran en la tienda</div></div>
    </div>
    <div class="help" style="margin-bottom:16px">Una promoción puede ser <b>solo un anuncio</b> (descuento 0%) o aplicar un <b>descuento real</b>: mientras está vigente, la tienda muestra el precio tachado y cobra el precio con descuento. Desde <b>Vista previa y envío</b> mandás el email a todos los suscriptores (cada email trae su link para darse de baja).</div>
    <div class="panel">${promotions.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Promoción</th><th class="num">Descuento</th><th>Aplica a</th><th>Vigencia</th><th>Estado</th><th>Email</th><th></th></tr></thead><tbody>
      ${promotions.map((p) => { const [st, cls] = state(p); return `<tr><td><b>${esc(p.title)}</b>${p.label ? `<br><span class="st st-pendiente">${esc(p.label)}</span>` : ''}</td>
        <td class="num">${p.discount_pct ? `<b>${pct(p.discount_pct)}</b>` : '<span class="muted">solo anuncio</span>'}</td><td>${target(p)}</td>
        <td><small>${p.starts_at || p.ends_at ? `${fdate(p.starts_at) || 'hoy'} → ${fdate(p.ends_at) || 'sin fin'}` : 'Sin vencimiento'}</small></td>
        <td><span class="st ${cls}">${st}</span>${p.show_on_site ? '' : '<br><small class="muted">no se muestra en la web</small>'}</td><td>${sendTxt(p)}</td>
        <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-pedit="${p.id}">Editar</button> <button class="btn btn-primary btn-sm" data-psend="${p.id}">Vista previa y envío</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted">Todavía no creaste promociones.</p>'}</div>
    <div class="panel"><div class="page-head" style="margin-bottom:8px"><h3 style="margin:0">Suscriptores (${active.length})</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><form id="sub-add" style="display:flex;gap:6px"><input type="email" name="email" placeholder="Agregar email" required style="max-width:220px;padding:7px 12px"><button class="btn btn-ghost btn-sm">Agregar</button></form>
        <a class="btn btn-light btn-sm" href="/api/admin/subscribers.csv">⬇️ Exportar</a></div></div>
      <p class="muted" style="margin-top:0">Solo reciben promociones quienes lo aceptaron (al comprar, desde la página de su pedido o desde el pie de la web). Agregá a mano solo personas que te hayan dado su consentimiento.</p>
      ${subs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Nombre</th><th>Origen</th><th>Alta</th><th>Estado</th><th></th></tr></thead><tbody>
        ${subs.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.name)}</td><td>${({ compra: '🛒 Compra', web: '🌐 Web', admin: '✍️ Manual' })[s.source] || esc(s.source)}</td><td>${fmtDate(s.created_at)}</td>
          <td>${s.active ? '<span class="st st-entregado">Activo</span>' : `<span class="st st-cancelado">Se dio de baja</span>`}</td><td><button class="btn btn-light btn-sm" data-sdel="${s.id}">Quitar</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no hay suscriptores.</p>'}</div>`;
  $('#pr-new').onclick = () => promoForm(null);
  $$('[data-pedit]').forEach((b) => (b.onclick = () => promoForm(promotions.find((p) => p.id == b.dataset.pedit))));
  $$('[data-psend]').forEach((b) => (b.onclick = () => promoSend(promotions.find((p) => p.id == b.dataset.psend), subscribers)));
  $$('[data-sdel]').forEach((b) => (b.onclick = async () => { if (confirm('¿Quitar este suscriptor?')) { await api(`/api/admin/subscribers/${b.dataset.sdel}`, { method: 'DELETE' }); route(); } }));
  $('#sub-add').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/admin/subscribers', { method: 'POST', body: { email: e.target.email.value } }); toast(r.already ? 'Ya estaba suscripto' : 'Suscriptor agregado ✓'); route(); }
    catch (err) { toast(err.message); }
  };
  // mientras se envía una campaña, refrescar el progreso
  if (promotions.some((p) => p.send_status === 'enviando')) promoPoll = setTimeout(() => location.hash === '#promos' && route(), 2500);
};

async function promoForm(p) {
  const isNew = !p;
  p = p || { title: '', body: '', label: '', image: '', discount_pct: 0, target: 'all', target_category: '', product_ids: [], starts_at: localDate(), ends_at: '', show_on_site: true, active: true };
  PRODUCTS = await api('/api/admin/products');
  const cats = [...new Set(PRODUCTS.map((x) => x.category))].sort();
  let image = p.image;
  const selected = new Set(p.product_ids);
  const close = openModal(`<h2>${isNew ? 'Nueva promoción' : 'Editar promoción'}</h2>
    <form id="prf">
      <div class="two">
        <div class="field"><label>Título</label><input type="text" name="title" value="${esc(p.title)}" required placeholder="Ej: Semana de la dermocosmética"></div>
        <div class="field"><label>Etiqueta corta</label><input type="text" name="label" value="${esc(p.label)}" placeholder="Ej: 20% OFF, 2x1, Envío gratis"></div>
      </div>
      <div class="field"><label>Texto</label><textarea name="body" placeholder="Contá de qué se trata la promo, condiciones, etc.">${esc(p.body)}</textarea></div>
      <div class="field"><label>Imagen (opcional)</label><div style="display:flex;gap:10px;align-items:center"><div class="img-list"><div class="im" id="pr-img">${image ? `<img src="${esc(image)}" alt="">` : ''}</div></div>
        <label class="btn btn-ghost btn-sm">Subir<input type="file" accept="image/*" hidden id="pr-img-in"></label><button type="button" class="btn btn-light btn-sm" id="pr-img-rm">Quitar</button></div></div>
      <div class="three">
        <div class="field"><label>Descuento en la tienda (%)</label><input type="number" name="discount_pct" min="0" max="90" step="0.5" value="${p.discount_pct}"><small class="muted">0 = solo anuncio, no cambia precios</small></div>
        <div class="field"><label>Desde</label><input type="date" name="starts_at" value="${esc(p.starts_at)}"></div>
        <div class="field"><label>Hasta (inclusive)</label><input type="date" name="ends_at" value="${esc(p.ends_at)}"></div>
      </div>
      <div class="field"><label>Aplica a</label><div class="filters" style="margin:0">
        ${[['all', 'Toda la tienda'], ['category', 'Una categoría'], ['products', 'Productos elegidos']].map(([v, l]) => `<label class="chip-f" style="display:flex;gap:6px"><input type="radio" name="target" value="${v}" ${p.target === v ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
      <div class="field" id="pr-cat"><select name="target_category">${cats.map((c) => `<option ${c === p.target_category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field" id="pr-prods"><input type="search" id="pr-q" placeholder="Buscar productos…"><div class="pick-list" id="pr-list"></div><small class="muted" id="pr-sel"></small></div>
      <div class="checks"><label><input type="checkbox" name="show_on_site" ${p.show_on_site ? 'checked' : ''}> Mostrar en la web</label><label><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Activa</label></div>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">${isNew ? '<span></span>' : '<button type="button" class="btn btn-light btn-sm" id="pr-del" style="color:#b3261e">Eliminar</button>'}
        <button class="btn btn-primary">Guardar</button></div>
    </form>`, true);
  const f = $('#prf');
  const syncTarget = () => {
    const t = f.target.value;
    $('#pr-cat').classList.toggle('hidden', t !== 'category');
    $('#pr-prods').classList.toggle('hidden', t !== 'products');
  };
  const renderList = () => {
    const q = $('#pr-q').value.toLowerCase();
    $('#pr-list').innerHTML = PRODUCTS.filter((x) => !q || `${x.name} ${x.brand}`.toLowerCase().includes(q)).map((x) =>
      `<label><input type="checkbox" value="${x.id}" ${selected.has(x.id) ? 'checked' : ''}> ${esc(x.name)} <span class="muted">${money(x.price)}</span></label>`).join('');
    $$('#pr-list input').forEach((c) => (c.onchange = () => { c.checked ? selected.add(+c.value) : selected.delete(+c.value); $('#pr-sel').textContent = `${selected.size} seleccionados`; }));
    $('#pr-sel').textContent = `${selected.size} seleccionados`;
  };
  $$('input[name=target]', f).forEach((r) => (r.onchange = syncTarget));
  $('#pr-q').oninput = renderList;
  syncTarget(); renderList();
  $('#pr-img-in').onchange = async (e) => {
    const fd = new FormData(); fd.append('images', e.target.files[0]);
    try { image = (await api('/api/admin/upload', { method: 'POST', body: fd })).urls[0]; $('#pr-img').innerHTML = `<img src="${esc(image)}" alt="">`; } catch (err) { toast(err.message); }
  };
  $('#pr-img-rm').onclick = () => { image = ''; $('#pr-img').innerHTML = ''; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    body.show_on_site = f.show_on_site.checked; body.active = f.active.checked;
    body.image = image; body.product_ids = [...selected];
    if (body.target === 'products' && !selected.size) { toast('Elegí al menos un producto'); return; }
    if (body.ends_at && body.starts_at && body.ends_at < body.starts_at) { toast('La fecha "hasta" es anterior a "desde"'); return; }
    try { await api(isNew ? '/api/admin/promotions' : `/api/admin/promotions/${p.id}`, { method: isNew ? 'POST' : 'PUT', body }); toast('Promoción guardada ✓'); close(); route(); }
    catch (err) { toast(err.message); }
  };
  if (!isNew) $('#pr-del').onclick = async () => { if (confirm('¿Eliminar la promoción? Si tenía descuento, los precios vuelven a la normalidad.')) { await api(`/api/admin/promotions/${p.id}`, { method: 'DELETE' }); close(); route(); } };
}

function promoSend(p, subscribers) {
  const close = openModal(`<h2>${esc(p.title)}</h2>
    <p class="muted" style="margin-top:-6px">Así se va a ver el email:</p>
    <iframe src="/api/admin/promotions/${p.id}/preview" class="mail-preview" title="Vista previa del email"></iframe>
    <div class="two" style="margin-top:14px;align-items:end">
      <form class="field" id="pt-form" style="margin:0"><label>Enviarme una prueba a</label><div style="display:flex;gap:6px"><input type="email" name="email" value="${esc(S.email || '')}" required><button class="btn btn-ghost btn-sm">Probar</button></div></form>
      <div style="text-align:right">${p.send_status === 'enviada' ? `<small class="muted">Ya se envió a ${p.sent_count} el ${fmtDate(p.sent_at)}</small><br>` : ''}
        <button class="btn btn-primary" id="pt-send" ${subscribers ? '' : 'disabled'}>📣 Enviar a ${subscribers} suscriptores</button></div>
    </div>`, true);
  $('#pt-form').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api(`/api/admin/promotions/${p.id}/test`, { method: 'POST', body: { email: e.target.email.value } }); toast(r.simulated ? 'Prueba simulada (falta configurar SMTP)' : 'Prueba enviada ✓'); }
    catch (err) { toast(err.message); }
  };
  $('#pt-send').onclick = async () => {
    if (!confirm(`¿Enviar "${p.title}" a ${subscribers} suscriptores?${p.send_status === 'enviada' ? '\n\nOjo: esta promoción ya se envió antes.' : ''}`)) return;
    try { await api(`/api/admin/promotions/${p.id}/send`, { method: 'POST' }); toast('Enviando… podés seguir el progreso en la lista'); close(); route(); }
    catch (err) { toast(err.message); }
  };
}

// ---------- reclamos post-compra ----------
const CLAIM_ST = { abierto: ['Nuevo', 'st-pendiente'], en_revision: ['En revisión', 'st-aceptado'], resuelto: ['Resuelto', 'st-entregado'], rechazado: ['Rechazado', 'st-cancelado'] };
const claimBadge = (s) => `<span class="st ${CLAIM_ST[s]?.[1] || ''}">${CLAIM_ST[s]?.[0] || s}</span>`;

VIEWS.reclamos = async () => {
  $('#view').innerHTML = `<div class="page-head"><h1>Reclamos y devoluciones</h1></div>
    <div class="help" style="margin-bottom:16px">Cuando marcás un pedido como <b>Entregado</b>, el cliente recibe un <b>código de llegada</b>. Con ese código (dentro de los ${esc(S.claim_days || 10)} días) puede hacer un reclamo desde la web, con fotos. También está el <b>botón de arrepentimiento</b> que pide la ley. Si no tiene el código, se comunica por WhatsApp al ${esc(fmtPhone(S.owner_phone || S.whatsapp))}.</div>
    <div class="filters">${[['', 'Todos'], ['abierto', 'Nuevos'], ['en_revision', 'En revisión'], ['resuelto', 'Resueltos'], ['rechazado', 'Rechazados']].map(([v, l]) => `<button class="chip-f ${v ? '' : 'active'}" data-cst="${v}">${l}</button>`).join('')}</div>
    <div class="panel" id="cl-list"></div>`;
  let st = '';
  const load = async () => {
    const list = await api('/api/admin/claims' + (st ? `?status=${st}` : ''));
    $('#cl-list').innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>
      ${list.map((c) => `<tr class="click" data-claim="${c.id}"><td><b>${c.id}</b></td><td>${fmtDate(c.created_at)}</td><td>#${c.order_id}</td><td>${esc(c.customer_name)}</td><td>${c.type === 'arrepentimiento' ? '↩️ ' : ''}${esc(c.type_label)}</td><td>${claimBadge(c.status)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No hay reclamos para mostrar. 🎉</p>';
    $$('[data-claim]').forEach((r) => (r.onclick = () => openClaim(r.dataset.claim)));
  };
  $$('[data-cst]').forEach((b) => (b.onclick = () => { st = b.dataset.cst; $$('[data-cst]').forEach((x) => x.classList.toggle('active', x === b)); load(); }));
  VIEWS.reclamos.reload = load;
  await load();
};

async function openClaim(id) {
  const c = await api('/api/admin/claims/' + id);
  const close = openModal(`<h2>Reclamo #${c.id} ${claimBadge(c.status)}</h2>
    <p class="muted" style="margin-top:-6px">${fmtDate(c.created_at)} · pedido <a href="#" id="cl-order">#${c.order_id}</a> (${money(c.total)}) ${c.delivered_at ? `· entregado ${fmtDate(c.delivered_at)}` : '· sin entregar'}</p>
    <div class="two">
      <div class="panel" style="box-shadow:none;border:1px solid var(--line)"><b>Cliente</b><br>${esc(c.customer_name)}<br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a><br>
        ${[c.contact_phone, c.phone].filter(Boolean).map((t) => `<a href="https://wa.me/${t.replace(/\D/g, '')}" target="_blank">WhatsApp ${esc(t)}</a>`).join('<br>')}</div>
      <div class="panel" style="box-shadow:none;border:1px solid var(--line)"><b>${esc(c.type_label)}</b><br>Pide: <b>${esc(c.resolution_label || '—')}</b><br>
        <small class="muted">${c.items.map((i) => `${esc(i.name)} ×${i.qty}`).join(', ')}</small></div>
    </div>
    ${c.photos.length ? `<div class="img-list" style="margin-bottom:14px">${c.photos.map((f) => `<a class="im" href="/api/admin/claims-photo/${esc(f)}" target="_blank"><img src="/api/admin/claims-photo/${esc(f)}" alt="Foto del reclamo" style="object-fit:cover"></a>`).join('')}</div>` : ''}
    <h3>Conversación</h3>
    <ul class="timeline">${c.messages.map((m) => `<li><b>${m.author === 'cliente' ? esc(c.customer_name) : 'Farmacia'}</b> ${m.author === 'farmacia' ? claimBadge(m.status) : ''} <span class="muted">· ${fmtDate(m.created_at)}</span>${m.message ? `<br><span style="white-space:pre-wrap">${esc(m.message)}</span>` : ''}</li>`).join('')}</ul>
    <div class="panel" style="box-shadow:none;border:2px solid var(--primary)">
      <h3>Responder</h3>
      <div class="filters">${Object.entries(CLAIM_ST).map(([v, [l]]) => `<label class="chip-f" style="display:flex;gap:6px"><input type="radio" name="cst" value="${v}" ${v === c.status ? 'checked' : ''}>${l}</label>`).join('')}</div>
      <div class="field"><label>Mensaje para el cliente</label><textarea id="cl-msg" style="min-height:80px" placeholder="Ej: Te pedimos disculpas. Mañana pasamos a retirar el producto y te llevamos uno nuevo."></textarea></div>
      <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-weight:700"><input type="checkbox" id="cl-notify" checked> Enviar por email al cliente</label>
      <button class="btn btn-primary" id="cl-save">Guardar</button>
    </div>
    <p class="muted" style="font-size:.88rem">Si acordás una devolución de dinero, hacé la transferencia y dejalo escrito acá. Si el producto vuelve al stock, sumalo desde Productos.</p>`, true);
  $('#cl-order').onclick = (e) => { e.preventDefault(); close(); openOrder(c.order_id); };
  $('#cl-save').onclick = async () => {
    try {
      await api(`/api/admin/claims/${c.id}`, { method: 'PATCH', body: { status: $('input[name=cst]:checked').value, message: $('#cl-msg').value, notify: $('#cl-notify').checked } });
      toast('Reclamo actualizado ✓'); close(); refreshBadges();
      if (location.hash === '#reclamos' && VIEWS.reclamos.reload) VIEWS.reclamos.reload();
    } catch (e) { toast(e.message); }
  };
}

// ---------- facturas de compra ----------
VIEWS.compras = async () => {
  const list = await api('/api/admin/purchases');
  $('#view').innerHTML = `<div class="page-head"><h1>Facturas de compra</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" id="pu-manual">Cargar a mano</button>
      <label class="btn btn-primary btn-sm">🧾 Subir factura<input type="file" id="pu-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,application/pdf,image/*,text/csv" hidden></label></div></div>
    <div class="dropzone" id="pu-drop">
      <b>Arrastrá acá la factura del proveedor</b><br><span class="muted">PDF, foto (JPG/PNG) o planilla CSV. Se leen los productos, cantidades y costos; vos revisás y confirmás.</span>
    </div>
    <div class="help" style="margin-bottom:16px">Al aplicar una factura, cada producto <b>suma el stock</b> comprado y actualiza su <b>costo</b>, <b>IVA</b> y <b>flete</b> (el flete de la factura se reparte entre los productos según su valor). El <b>precio de venta</b> se recalcula según la regla que elijas. Los productos que no existen se pueden crear en el momento.</div>
    <div class="panel">${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th class="num">Líneas</th><th class="num">Unidades</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
      ${list.map((i) => `<tr class="click" data-pu="${i.id}"><td>${i.id}</td><td>${esc(i.invoice_date || i.created_at.slice(0, 10))}</td><td><b>${esc(i.supplier)}</b></td><td>${esc(i.invoice_type)} ${esc(i.number)}</td>
        <td class="num">${i.lines}</td><td class="num">${i.units || 0}</td><td class="num">${money(i.total)}</td><td>${i.status === 'anulada' ? '<span class="st st-cancelado">Anulada</span>' : '<span class="st st-entregado">Aplicada</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Todavía no cargaste facturas de compra.</p>'}</div>`;
  $$('[data-pu]').forEach((r) => (r.onclick = () => openPurchase(r.dataset.pu)));
  const handle = (file) => file && extractInvoice(file);
  $('#pu-file').onchange = (e) => handle(e.target.files[0]);
  const dz = $('#pu-drop');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files[0]); };
  $('#pu-manual').onclick = () => reviewInvoice({ supplier: '', invoice_number: '', invoice_date: new Date().toISOString().slice(0, 10), invoice_type: 'A', items: [] });
};

async function extractInvoice(file) {
  $('#view').innerHTML = `<div class="panel center" style="padding:60px 20px"><div class="spinner"></div><h3>Leyendo la factura…</h3><p class="muted">${esc(file.name)} · esto puede tardar hasta un minuto</p></div>`;
  const fd = new FormData();
  fd.append('file', file);
  try {
    reviewInvoice(await api('/api/admin/purchases/extract', { method: 'POST', body: fd }));
  } catch (e) {
    await VIEWS.compras();
    $('#pu-drop').insertAdjacentHTML('beforebegin', `<div class="error-box">${esc(e.message)}</div>`);
  }
}

async function reviewInvoice(data) {
  PRODUCTS = await api('/api/admin/products');
  const cats = [...new Set(PRODUCTS.map((p) => p.category))].sort();
  const items = data.items.map((it) => ({ ...it, product_id: it.match?.product_id || '', include: true, category: 'General' }));
  const productOpts = (sel) => `<option value="">➕ Crear producto nuevo</option>` + PRODUCTS.map((p) => `<option value="${p.id}" ${String(p.id) === String(sel) ? 'selected' : ''}>${esc(p.name)}${p.brand ? ' · ' + esc(p.brand) : ''}</option>`).join('');
  const n = (v) => (v == null ? '' : v);

  $('#view').innerHTML = `<div class="page-head"><h1>Revisar factura</h1><a class="btn btn-light btn-sm" href="#compras" id="rv-cancel">Cancelar</a></div>
    ${data.file ? '<div class="help" style="margin-bottom:14px">✓ Factura leída. <b>Revisá</b> que proveedor, cantidades, costos y productos sean correctos antes de aplicarla.</div>' : ''}
    <div class="panel"><h3>Datos del comprobante</h3>
      <div class="three">
        <div class="field"><label>Proveedor</label><input type="text" id="rv-supplier" value="${esc(data.supplier)}" required></div>
        <div class="field"><label>Número</label><input type="text" id="rv-number" value="${esc(data.invoice_number)}"></div>
        <div class="field"><label>Fecha</label><input type="text" id="rv-date" value="${esc(data.invoice_date)}" placeholder="AAAA-MM-DD"></div>
        <div class="field"><label>Tipo</label><input type="text" id="rv-type" value="${esc(data.invoice_type)}"></div>
        <div class="field"><label>Flete sin IVA ($) — se reparte en el costo</label><input type="number" step="0.01" id="rv-freight" value="${n(data.freight)}"></div>
        <div class="field"><label>Percepciones / otros impuestos ($)</label><input type="number" step="0.01" id="rv-other" value="${n(data.other_taxes)}"></div>
        <div class="field"><label>IVA total ($)</label><input type="number" step="0.01" id="rv-iva" value="${n(data.iva_total)}"></div>
        <div class="field"><label>Total de la factura ($)</label><input type="number" step="0.01" id="rv-total" value="${n(data.total)}"></div>
      </div><div id="rv-check"></div></div>
    <div class="panel"><h3>Precio de venta</h3>
      <div class="filters" style="margin-bottom:6px">
        <label class="chip-f" style="display:flex;gap:6px"><input type="radio" name="pol" value="keep_markup" checked> Mantener el margen actual de cada producto</label>
        <label class="chip-f" style="display:flex;gap:6px"><input type="radio" name="pol" value="markup"> Aplicar <input type="number" id="rv-mk" value="${esc(S.default_markup || 40)}" style="width:70px;padding:2px 6px"> % sobre el costo</label>
        <label class="chip-f" style="display:flex;gap:6px"><input type="radio" name="pol" value="none"> No cambiar precios</label>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="rv-nodec" checked> No bajar precios si el costo bajó</label>
      <p class="muted" style="margin:6px 0 0">Los productos nuevos usan ${esc(S.default_markup || 40)}% de ganancia (se cambia en Configuración). Precios redondeados a $${esc(S.price_rounding || 10)}.</p></div>
    <div class="panel"><div class="page-head" style="margin-bottom:8px"><h3 style="margin:0">Productos (<span id="rv-count"></span>)</h3><button class="btn btn-ghost btn-sm" id="rv-add">+ Agregar línea</button></div>
      <div class="tbl-wrap"><table class="tbl rv"><thead><tr><th></th><th>En la factura</th><th>Producto de la tienda</th><th class="num">Cant.</th><th class="num">Costo neto u.</th><th>IVA</th>
        <th class="num">Costo total</th><th class="num">Precio venta</th><th class="num">Margen</th><th class="num">Stock</th></tr></thead><tbody id="rv-body"></tbody></table></div></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-bottom:30px"><span class="muted" id="rv-sum" style="align-self:center"></span><button class="btn btn-primary" id="rv-apply">✓ Aplicar factura</button></div>`;

  const policy = () => ({ mode: $('input[name=pol]:checked').value, markup_pct: Number($('#rv-mk').value) || 0, no_decrease: $('#rv-nodec').checked });
  const payload = () => ({
    supplier: $('#rv-supplier').value, number: $('#rv-number').value, invoice_date: $('#rv-date').value, invoice_type: $('#rv-type').value,
    freight: $('#rv-freight').value, other_taxes: $('#rv-other').value, iva_total: $('#rv-iva').value, total: $('#rv-total').value,
    file: data.file || null, policy: policy(),
    items: items.filter((i) => i.include).map((i) => ({ ...i, new_name: i.new_name || i.description })),
  });
  const delta = (a, b) => {
    if (a == null || !a) return '';
    const d = ((b - a) / a) * 100;
    return Math.abs(d) < 0.05 ? '<small class="muted">=</small>' : `<small class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '▲' : '▼'}${pct(Math.abs(d))}</small>`;
  };

  function renderRows(preview = []) {
    let k = 0;
    $('#rv-body').innerHTML = items.map((it, i) => {
      const r = it.include ? preview[k++] : null;
      const m = it.match || {};
      const badge = !it.product_id ? '<span class="st st-pendiente">Nuevo</span>'
        : m.product_id && String(m.product_id) === String(it.product_id) ? `<span class="st ${m.confidence >= 0.9 ? 'st-entregado' : 'st-aceptado'}" title="Reconocido por ${esc(m.how)}">✓ ${esc(m.how)}</span>` : '<span class="st st-en_preparacion">elegido a mano</span>';
      const bigChange = r && r.old_cost > 0 && Math.abs(r.unit_cost - r.old_cost) / r.old_cost > 0.3;
      return `<tr class="${it.include ? '' : 'off'} ${bigChange ? 'warn' : ''}" ${bigChange ? 'title="El costo cambió más de 30%: revisá cantidad y costo"' : ''}>
        <td><input type="checkbox" data-inc="${i}" ${it.include ? 'checked' : ''} title="Incluir esta línea"></td>
        <td style="min-width:150px">${bigChange ? '<span class="st st-pendiente">⚠ revisar costo</span><br>' : ''}${it.manual ? `<input type="text" data-f="description" data-i="${i}" value="${esc(it.description)}" placeholder="Descripción">` : `<b>${esc(it.description)}</b>`}<br><small class="muted">${esc([it.code && 'Cód. ' + it.code, it.barcode && 'EAN ' + it.barcode, it.discount_pct ? `bonif. ${it.discount_pct}%` : ''].filter(Boolean).join(' · '))}</small></td>
        <td style="min-width:190px"><select data-f="product_id" data-i="${i}">${productOpts(it.product_id)}</select><div style="margin-top:4px">${badge}</div>
          ${!it.product_id ? `<div class="newp"><input type="text" data-f="new_name" data-i="${i}" value="${esc(it.new_name || it.description)}" placeholder="Nombre en la tienda">
            <input type="text" data-f="category" data-i="${i}" value="${esc(it.category)}" list="rv-cats" placeholder="Categoría">
            <label><input type="checkbox" data-pub="${i}" ${it.publish ? 'checked' : ''}> Publicar ya</label></div>` : ''}</td>
        <td class="num"><input type="number" min="1" data-f="qty" data-i="${i}" value="${it.qty}" style="width:58px"></td>
        <td class="num"><input type="number" step="0.01" min="0" data-f="unit_cost" data-i="${i}" value="${it.unit_cost}" style="width:92px">${r ? `<br>${r.old_cost != null ? `<small class="muted">antes ${money(r.old_cost)}</small> ${delta(r.old_cost, r.unit_cost)}` : ''}` : ''}</td>
        <td><select data-f="iva_rate" data-i="${i}" style="width:66px">${[0, 10.5, 21, 27].map((v) => `<option ${Number(it.iva_rate) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td class="num">${r ? `<b>${money(r.new_total_cost)}</b>${r.freight_unit ? `<br><small class="muted">incl. flete ${money(r.freight_unit)}</small>` : ''}` : ''}</td>
        <td class="num">${r ? `<b class="${r.new_price < r.min_price ? 'neg' : ''}">${money(r.new_price)}</b><br><small class="${r.new_price < r.min_price ? 'neg' : 'muted'}">mín. ${money(r.min_price)}</small>${r.old_price != null ? `<br><small class="muted">antes ${money(r.old_price)}</small> ${delta(r.old_price, r.new_price)}` : ''}` : ''}</td>
        <td class="num ${r && r.new_margin_pct < 15 ? 'neg' : ''}">${r ? pct(r.new_margin_pct) : ''}</td>
        <td class="num">${r ? `${r.old_stock} → <b>${r.old_stock + r.qty}</b>` : ''}</td></tr>`;
    }).join('') + `<datalist id="rv-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
    const inc = items.filter((i) => i.include);
    $('#rv-count').textContent = `${inc.length} de ${items.length}`;
    const net = preview.reduce((a, r) => a + r.unit_cost * r.qty, 0);
    const warns = $$('#rv-body tr.warn').length;
    if (warns) $('#rv-count').textContent += ` · ⚠ ${warns} con cambio de costo grande`;
    $('#rv-sum').textContent = preview.length ? `${inc.filter((i) => !i.product_id).length} productos nuevos · ${preview.reduce((a, r) => a + r.qty, 0)} unidades · neto ${money(net)}` : '';
    checkTotals(net);
    bindRows();
  }

  function checkTotals(net) {
    const total = Number($('#rv-total').value), iva = Number($('#rv-iva').value), fr = Number($('#rv-freight').value) || 0, ot = Number($('#rv-other').value) || 0;
    if (!total || !net) { $('#rv-check').innerHTML = ''; return; }
    const calc = net + fr + (iva || 0) + ot;
    const diff = total - calc;
    $('#rv-check').innerHTML = Math.abs(diff) <= Math.max(5, total * 0.005)
      ? '<div class="help" style="border-color:#17794a">✓ Los productos + flete + IVA + percepciones coinciden con el total de la factura.</div>'
      : `<div class="error-box" style="font-weight:600">⚠️ La suma (${money(calc)}) no coincide con el total de la factura (${money(total)}): diferencia de ${money(diff)}. Revisá cantidades, costos o el IVA.</div>`;
  }

  let timer, seq = 0;
  async function refresh() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++seq;
      const p = payload();
      if (!p.items.length) { renderRows([]); return; }
      try {
        const rows = await api('/api/admin/purchases/preview', { method: 'POST', body: p });
        if (my === seq) renderRows(rows);
      } catch (e) { toast(e.message); }
    }, 250);
  }

  function bindRows() {
    $$('#rv-body [data-f]').forEach((el) => (el.onchange = () => {
      const it = items[el.dataset.i];
      it[el.dataset.f] = el.value;
      if (el.dataset.f === 'product_id') { it.manual_pick = true; return refresh(); }
      if (['qty', 'unit_cost', 'iva_rate'].includes(el.dataset.f)) refresh();
    }));
    $$('#rv-body [data-inc]').forEach((el) => (el.onchange = () => { items[el.dataset.inc].include = el.checked; refresh(); }));
    $$('#rv-body [data-pub]').forEach((el) => (el.onchange = () => { items[el.dataset.pub].publish = el.checked; }));
  }

  // con el proveedor se pueden reconocer los códigos aprendidos de facturas anteriores
  $('#rv-supplier').onchange = async () => {
    const auto = items.filter((i) => !i.manual_pick);
    const res = await api('/api/admin/purchases/match', { method: 'POST', body: { supplier: $('#rv-supplier').value, items: auto } });
    auto.forEach((it, k) => { it.match = res[k]; it.product_id = res[k].product_id || ''; });
    refresh();
  };
  $$('input[name=pol], #rv-mk, #rv-nodec, #rv-freight').forEach((el) => (el.oninput = refresh));
  $$('#rv-total, #rv-iva, #rv-other').forEach((el) => (el.oninput = refresh));
  $('#rv-add').onclick = () => { items.push({ manual: true, description: '', code: '', barcode: '', qty: 1, unit_cost: 0, iva_rate: 21, product_id: '', include: true, category: 'General' }); refresh(); };
  $('#rv-apply').onclick = async () => {
    const p = payload();
    if (!p.supplier.trim()) { toast('Indicá el proveedor'); $('#rv-supplier').focus(); return; }
    if (!p.items.length) { toast('No hay líneas para aplicar'); return; }
    const nuevos = p.items.filter((i) => !i.product_id).length;
    if (!confirm(`¿Aplicar la factura? Se va a sumar el stock y actualizar costos y precios de ${p.items.length - nuevos} productos${nuevos ? ` y crear ${nuevos} nuevos` : ''}.`)) return;
    $('#rv-apply').disabled = true;
    try {
      const r = await api('/api/admin/purchases', { method: 'POST', body: p });
      toast(`✓ Factura aplicada: ${r.updated} productos actualizados, ${r.created} nuevos, +${r.units} unidades`, 4000);
      location.hash = 'compras'; route();
      setTimeout(() => openPurchase(r.id), 300);
    } catch (e) { toast(e.message, 5000); $('#rv-apply').disabled = false; }
  };
  renderRows([]);
  refresh();
}

async function openPurchase(id) {
  const inv = await api('/api/admin/purchases/' + id);
  const close = openModal(`<h2>Compra #${inv.id} · ${esc(inv.supplier)} ${inv.status === 'anulada' ? '<span class="st st-cancelado">Anulada</span>' : ''}</h2>
    <p class="muted" style="margin-top:-6px">${esc(inv.invoice_type)} ${esc(inv.number)} · ${esc(inv.invoice_date)} · cargada ${fmtDate(inv.created_at)}
      ${inv.file ? ` · <a href="/api/admin/purchases/${inv.id}/file" target="_blank">ver factura original ↗</a>` : ''}</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Costo antes</th><th class="num">Costo nuevo</th><th class="num">Flete u.</th><th class="num">IVA</th><th class="num">Precio antes</th><th class="num">Precio nuevo</th></tr></thead><tbody>
      ${inv.items.map((i) => `<tr><td><b>${esc(i.product_name || i.description)}</b>${i.created_product ? ' <span class="st st-pendiente">nuevo</span>' : ''}<br><small class="muted">${esc(i.description)}</small></td>
        <td class="num">${i.qty}</td><td class="num muted">${i.old_cost != null ? money(i.old_cost) : '—'}</td><td class="num">${money(i.unit_cost)}</td><td class="num">${money(i.freight_unit)}</td><td class="num">${i.iva_rate}%</td>
        <td class="num muted">${i.old_price != null ? money(i.old_price) : '—'}</td><td class="num"><b>${money(i.new_price)}</b></td></tr>`).join('')}
    </tbody><tfoot>
      <tr><td colspan="7">Neto productos</td><td class="num">${money(inv.subtotal_net)}</td></tr>
      <tr><td colspan="7">Flete</td><td class="num">${money(inv.freight)}</td></tr>
      <tr><td colspan="7">IVA</td><td class="num">${money(inv.iva_total)}</td></tr>
      <tr><td colspan="7">Percepciones / otros</td><td class="num">${money(inv.other_taxes)}</td></tr>
      <tr><td colspan="7">Total</td><td class="num">${money(inv.total)}</td></tr></tfoot></table></div>
    ${inv.status === 'aplicada' ? `<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-light btn-sm" id="pu-annul" style="color:#b3261e">Anular factura</button></div>` : ''}`, true);
  const b = $('#pu-annul');
  if (b) b.onclick = async () => {
    if (!confirm('¿Anular esta factura? Se descuenta del stock lo que había sumado. Los costos y precios NO vuelven atrás (si hace falta, editalos en Productos).')) return;
    try { await api(`/api/admin/purchases/${inv.id}/annul`, { method: 'POST' }); toast('Factura anulada'); close(); route(); } catch (e) { toast(e.message); }
  };
}

// ---------- costos ----------
VIEWS.costos = async () => {
  [PRODUCTS, PC] = await Promise.all([api('/api/admin/products'), api('/api/admin/page-cost')]);
  $('#view').innerHTML = `<div class="page-head"><h1>Costos y márgenes</h1><a class="btn btn-ghost btn-sm" href="#config">Ajustar costos de la página</a></div>
    <div class="help" style="margin-bottom:16px"><b>Costo total</b> = (costo + envío por unidad) × (1 + IVA).
      <b>Costo de la página</b> = parte del costo fijo mensual de la web (${money(PC.fixed_monthly)} ÷ ${PC.units_month || 0} unidades/mes = ${money(PC.fixed_per_unit)} por unidad) + ${pct(PC.fee_pct)} de comisiones e impuestos sobre el precio.
      <b>Precio mínimo</b> = el precio que cubre todo eso sin ganar ni perder: por debajo, cada venta pierde plata.</div>
    <div class="kpis" id="c-kpis"></div>
    <div class="panel"><h3>Calculadora de precio</h3>
      <div class="three" id="calc-in">
        <div class="field"><label>Costo ($ sin IVA)</label><input type="number" id="k-cost" value="1000"></div>
        <div class="field"><label>Envío por unidad ($)</label><input type="number" id="k-ship" value="100"></div>
        <div class="field"><label>IVA (%)</label><select id="k-iva"><option>0</option><option>10.5</option><option selected>21</option><option>27</option></select></div>
        <div class="field"><label>Margen deseado sobre costo (%)</label><input type="number" id="k-mk" value="40"></div>
      </div><div class="calc" id="k-out"></div></div>
    <div class="panel"><div class="filters"><input type="search" id="c-q" placeholder="Buscar…">
        <label class="chip-f" style="display:flex;gap:6px"><input type="checkbox" id="c-min"> Solo precio por debajo del mínimo</label>
        <label class="chip-f" style="display:flex;gap:6px"><input type="checkbox" id="c-neg"> Solo margen bajo (&lt; 15%)</label></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Costo</th><th class="num">Envío</th><th class="num">IVA</th><th class="num">Costo total</th><th class="num">Costo página</th>
        <th class="num">Precio mínimo</th><th class="num">Precio venta</th><th class="num">Ganancia neta</th><th class="num">Margen neto</th><th class="num">Stock</th><th class="num">Stock valorizado</th></tr></thead>
      <tbody id="c-body"></tbody><tfoot id="c-foot"></tfoot></table></div></div>`;
  const kcalc = () => {
    const c = +$('#k-cost').value || 0, s = +$('#k-ship').value || 0, iva = +$('#k-iva').value, mk = +$('#k-mk').value || 0;
    const total = (c + s) * (1 + iva / 100), price = total * (1 + mk / 100), min = minPriceFor(total), page = pageCostFor(price);
    $('#k-out').innerHTML = `<div><span>Costo total c/IVA</span><b>${money(total)}</b></div><div><span>Precio mínimo</span><b>${money(min)}</b></div>
      <div><span>Precio sugerido</span><b class="${price < min ? 'neg' : ''}">${money(price)}</b></div><div><span>Costo de la página</span><b>${money(page)}</b></div>
      <div><span>Ganancia neta por unidad</span><b class="${price - total - page >= 0 ? 'pos' : 'neg'}">${money(price - total - page)}</b></div>
      <div><span>Margen neto s/ venta</span><b>${price ? pct(((price - total - page) / price) * 100) : '—'}</b></div>`;
  };
  $$('#calc-in input, #calc-in select').forEach((i) => (i.oninput = kcalc)); kcalc();
  const all = PRODUCTS.filter((p) => p.active);
  const sum = (f) => all.reduce((a, p) => a + f(p), 0);
  const vCost = sum((p) => p.unit_total_cost * p.stock), vPrice = sum((p) => p.price * p.stock);
  const avgMargin = all.length ? sum((p) => (p.price ? (p.net_margin / p.price) * 100 : 0)) / all.length : 0;
  const below = all.filter((p) => p.price < p.min_price).length;
  $('#c-kpis').innerHTML = `
    <div class="kpi"><div class="lbl">Productos bajo el precio mínimo</div><div class="val ${below ? 'low' : 'pos'}">${below}</div><div class="sub">${below ? 'pierden plata en cada venta' : 'todos cubren sus costos'}</div></div>
    <div class="kpi"><div class="lbl">Costo de la página por unidad</div><div class="val">${money(PC.fixed_per_unit)}</div><div class="sub">+ ${pct(PC.fee_pct)} del precio · ${PC.units_month} u./mes (${esc(PC.units_source)})</div></div>
    <div class="kpi"><div class="lbl">Margen neto promedio</div><div class="val">${pct(avgMargin)}</div><div class="sub">después de costo de la página</div></div>
    <div class="kpi"><div class="lbl">Stock valorizado a costo</div><div class="val">${money(vCost)}</div><div class="sub">incluye IVA y envío</div></div>
    <div class="kpi"><div class="lbl">Stock a precio de venta</div><div class="val">${money(vPrice)}</div><div class="sub">IVA contenido: ${money(sum((p) => p.iva_amount * p.stock))}</div></div>`;
  const render = () => {
    const q = $('#c-q').value.toLowerCase(), neg = $('#c-neg').checked, low = $('#c-min').checked;
    const list = PRODUCTS.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!neg || p.margin_pct < 15) && (!low || p.price < p.min_price));
    $('#c-body').innerHTML = list.map((p) => {
      const under = p.price < p.min_price;
      return `<tr class="${under ? 'under' : ''}"><td><b>${esc(p.name)}</b>${p.cost ? '' : ' <span class="st st-pendiente">sin costo cargado</span>'}${under ? ' <span class="st st-cancelado">bajo el mínimo</span>' : ''}</td>
      <td class="num">${money(p.cost)}</td><td class="num">${money(p.shipping_cost)}</td><td class="num">${p.iva_rate}%<br><small class="muted">${money(p.iva_amount)}</small></td>
      <td class="num"><b>${money(p.unit_total_cost)}</b></td><td class="num">${money(p.page_cost)}</td>
      <td class="num"><b>${money(p.min_price)}</b></td><td class="num ${under ? 'neg' : ''}"><b>${money(p.price)}</b></td>
      <td class="num ${p.net_margin >= 0 ? 'pos' : 'neg'}">${money(p.net_margin)}</td><td class="num ${p.price && p.net_margin / p.price < 0.15 ? 'neg' : ''}">${p.price ? pct((p.net_margin / p.price) * 100) : '—'}</td>
      <td class="num">${p.stock}</td><td class="num">${money(p.unit_total_cost * p.stock)}</td></tr>`;
    }).join('');
    const t = (f) => list.reduce((a, p) => a + f(p), 0);
    $('#c-foot').innerHTML = `<tr><td>Total (${list.length})</td><td colspan="9"></td><td class="num">${t((p) => p.stock)}</td><td class="num">${money(t((p) => p.unit_total_cost * p.stock))}</td></tr>`;
  };
  $('#c-q').oninput = render; $('#c-neg').onchange = render; $('#c-min').onchange = render; render();
};

// ---------- estadísticas ----------
VIEWS.estadisticas = async () => {
  const months = Number(sessionStorage.getItem('stats_months') || 12);
  const [st, prods] = await Promise.all([api(`/api/admin/stats?months=${months}`), api('/api/admin/products')]);
  const M = st.months, labels = M.map((m) => fmtMonth(m.month));
  const tot = (k) => M.reduce((a, m) => a + m[k], 0);
  const last = M[M.length - 1], prev = M[M.length - 2];
  const delta = (k) => (prev && prev[k] ? ((last[k] - prev[k]) / prev[k]) * 100 : null);
  const dTxt = (k) => { const d = delta(k); return d == null ? 'sin datos del mes anterior' : `${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))} vs mes anterior`; };
  $('#view').innerHTML = `<div class="page-head"><h1>Estadísticas</h1>
      <div class="filters" style="margin:0">${[3, 6, 12, 24].map((n) => `<button class="chip-f ${n === months ? 'active' : ''}" data-m="${n}">${n} meses</button>`).join('')}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="lbl">Ventas (${months} meses)</div><div class="val">${money(tot('revenue'))}</div><div class="sub">este mes: ${money(last.revenue)} · ${dTxt('revenue')}</div></div>
      <div class="kpi"><div class="lbl">Ganancia bruta</div><div class="val pos">${money(tot('profit'))}</div><div class="sub">${tot('revenue') ? pct((tot('profit') / tot('revenue')) * 100) : '—'} de margen</div></div>
      <div class="kpi"><div class="lbl">Pedidos</div><div class="val">${tot('orders')}</div><div class="sub">este mes: ${last.orders} · ${dTxt('orders')}</div></div>
      <div class="kpi"><div class="lbl">Unidades vendidas</div><div class="val">${tot('units_sold').toLocaleString('es-AR')}</div></div>
      <div class="kpi"><div class="lbl">Ticket promedio</div><div class="val">${money(tot('orders') ? tot('revenue') / tot('orders') : 0)}</div></div>
      <div class="kpi"><div class="lbl">Stock actual</div><div class="val">${last.stock_units.toLocaleString('es-AR')} u.</div><div class="sub">${money(last.stock_value_cost)} a costo</div></div>
    </div>
    <div class="panel"><h3>Ventas, costo y ganancia por mes</h3><div class="chart-box"><canvas id="ch-rev"></canvas></div></div>
    <div class="panels-2">
      <div class="panel"><h3>Pedidos por mes</h3><div class="chart-box sm"><canvas id="ch-ord"></canvas></div></div>
      <div class="panel"><h3>Unidades vendidas por mes</h3><div class="chart-box sm"><canvas id="ch-units"></canvas></div></div>
      <div class="panel"><h3>Stock al cierre de cada mes (unidades)</h3><div class="chart-box sm"><canvas id="ch-stock"></canvas></div></div>
      <div class="panel"><h3>Stock valorizado al cierre de cada mes</h3><div class="chart-box sm"><canvas id="ch-stockv"></canvas></div></div>
      <div class="panel"><h3>Ventas por categoría</h3><div class="chart-box sm"><canvas id="ch-cat"></canvas></div></div>
      <div class="panel"><h3>Ticket promedio por mes</h3><div class="chart-box sm"><canvas id="ch-tick"></canvas></div></div>
    </div>
    <div class="panel"><div class="page-head" style="margin-bottom:8px"><h3 style="margin:0">Evolución de un producto: precio, ventas y stock</h3>
      <select id="pp" style="max-width:340px">${prods.map((p) => `<option value="${p.id}" ${p.id === st.top[0]?.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="three"><div><b class="muted">Precio y costo</b><div class="chart-box sm"><canvas id="pp-price"></canvas></div></div>
        <div><b class="muted">Unidades vendidas</b><div class="chart-box sm"><canvas id="pp-units"></canvas></div></div>
        <div><b class="muted">Stock</b><div class="chart-box sm"><canvas id="pp-stock"></canvas></div></div></div></div>
    <div class="panels-2">
      <div class="panel"><h3>Productos más vendidos</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Unidades</th><th class="num">Ventas</th><th class="num">Ganancia</th></tr></thead>
        <tbody>${st.top.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.units}</td><td class="num">${money(t.revenue)}</td><td class="num pos">${money(t.profit)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin ventas en el período</td></tr>'}</tbody></table></div></div>
      <div class="panel"><h3>Stock bajo (≤ 5 u.)</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Stock</th></tr></thead>
        <tbody>${st.low_stock.map((p) => `<tr><td>${esc(p.name)}</td><td class="num low">${p.stock}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Todo en orden ✓</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="panel"><h3>Detalle mensual</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mes</th><th class="num">Pedidos</th><th class="num">Unidades</th><th class="num">Ventas</th><th class="num">Costo</th><th class="num">Ganancia</th><th class="num">Envíos cobrados</th><th class="num">Compras (neto)</th><th class="num">Ticket prom.</th><th class="num">Stock (u.)</th><th class="num">Stock a costo</th></tr></thead>
      <tbody>${[...M].reverse().map((m) => `<tr><td>${fmtMonth(m.month)}</td><td class="num">${m.orders}</td><td class="num">${m.units_sold}</td><td class="num">${money(m.revenue)}</td><td class="num">${money(m.cost)}</td><td class="num pos">${money(m.profit)}</td><td class="num">${money(m.shipping_charged)}</td><td class="num">${money(m.purchases)}</td><td class="num">${money(m.avg_ticket)}</td><td class="num">${m.stock_units}</td><td class="num">${money(m.stock_value_cost)}</td></tr>`).join('')}</tbody></table></div></div>`;

  $$('[data-m]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('stats_months', b.dataset.m); route(); }));
  chart($('#ch-rev'), 'bar', labels, [
    { label: 'Ventas', data: M.map((m) => m.revenue) },
    { label: 'Costo (c/IVA y envío)', data: M.map((m) => m.cost) },
    { label: 'Ganancia', data: M.map((m) => m.profit) },
  ]);
  chart($('#ch-ord'), 'bar', labels, [{ label: 'Pedidos', data: M.map((m) => m.orders) }], { money: false });
  chart($('#ch-units'), 'bar', labels, [{ label: 'Unidades', data: M.map((m) => m.units_sold) }], { money: false });
  chart($('#ch-stock'), 'line', labels, [{ label: 'Unidades en stock', data: M.map((m) => m.stock_units) }], { money: false });
  chart($('#ch-stockv'), 'line', labels, [
    { label: 'A costo', data: M.map((m) => m.stock_value_cost) },
    { label: 'A precio de venta', data: M.map((m) => m.stock_value_price) },
  ]);
  chart($('#ch-cat'), 'bar', st.categories.map((c) => c.category), [{ label: 'Ventas', data: st.categories.map((c) => c.revenue) }], { horizontal: true });
  chart($('#ch-tick'), 'line', labels, [{ label: 'Ticket promedio', data: M.map((m) => m.avg_ticket || null) }]);

  let pcharts = [];
  const loadProduct = async () => {
    pcharts.forEach((c) => { c.destroy(); charts.splice(charts.indexOf(c), 1); });
    const r = await api(`/api/admin/stats/product/${$('#pp').value}?months=${months}`);
    const l = r.months.map((m) => fmtMonth(m.month));
    pcharts = [
      chart($('#pp-price'), 'line', l, [{ label: 'Precio', data: r.months.map((m) => m.price) }, { label: 'Costo', data: r.months.map((m) => m.cost) }]),
      chart($('#pp-units'), 'bar', l, [{ label: 'Unidades', data: r.months.map((m) => m.units_sold) }], { money: false }),
      chart($('#pp-stock'), 'line', l, [{ label: 'Stock', data: r.months.map((m) => m.stock) }], { money: false }),
    ];
  };
  $('#pp').onchange = loadProduct;
  if (prods.length) loadProduct();
};

// ---------- importar ----------
VIEWS.importar = async () => {
  $('#view').innerHTML = `<div class="page-head"><h1>Importar productos</h1></div>
    <div class="panel"><h3>🟡 Desde Mercado Libre</h3>
      <p class="muted">Trae todas tus publicaciones activas: nombre, precio, stock, fotos, categoría, marca y descripción. Si el producto ya existe, actualiza precio, stock y fotos (los costos que cargaste no se tocan).</p>
      <form id="ml-form">
        <div class="two">
          <div class="field"><label>ID de vendedor (seller_id)</label><input type="text" name="seller_id" value="${esc(S.ml_seller_id)}" placeholder="Ej: 123456789"></div>
          <div class="field"><label>Access token de Mercado Libre</label><input type="password" name="access_token" value="${esc(S.ml_access_token)}" placeholder="APP_USR-…"></div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px;font-weight:700"><input type="checkbox" name="update_existing" checked> Actualizar productos ya importados</label>
        <button class="btn btn-primary" id="ml-btn">Importar desde Mercado Libre</button>
        <div id="ml-res" style="margin-top:12px"></div>
      </form>
      <div class="help" style="margin-top:14px"><b>¿Cómo obtengo estos datos?</b><ol>
        <li>Entrá a <a href="https://developers.mercadolibre.com.ar/devcenter" target="_blank">developers.mercadolibre.com.ar</a> con la cuenta de la farmacia y creá una aplicación.</li>
        <li>Generá un <b>access token</b> para tu usuario (dura 6 horas; se puede volver a generar cuando quieras importar).</li>
        <li>Tu <b>seller_id</b> es el número de usuario de la cuenta (si dejás el campo vacío y ponés el token, se detecta solo).</li>
        <li>Alternativa sin token: en Mercado Libre andá a <i>Publicaciones → Modificar en Excel</i>, descargá el archivo, guardalo como CSV e importalo abajo.</li></ol></div>
    </div>
    <div class="panel"><h3>📄 Desde planilla (CSV / Excel)</h3>
      <p class="muted">Columnas reconocidas: <code>nombre, descripcion, categoria, marca, sku, precio, costo, costo_envio, iva, stock, receta, imagenes</code> (varias imágenes separadas por <code>|</code>). Si el SKU (o el nombre) ya existe, se actualiza.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="btn btn-primary">⬆️ Subir CSV<input type="file" id="csv-in" accept=".csv,text/csv" hidden></label>
        <a class="btn btn-ghost" href="/api/admin/export/csv">⬇️ Exportar productos actuales</a>
        <button class="btn btn-light" id="csv-tpl">Descargar plantilla</button>
      </div><div id="csv-res" style="margin-top:12px"></div></div>`;
  $('#ml-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#ml-btn').disabled = true; $('#ml-btn').textContent = 'Importando… (puede tardar unos minutos)';
    try {
      const r = await api('/api/admin/import/mercadolibre', { method: 'POST', body: { seller_id: f.seller_id.value, access_token: f.access_token.value, update_existing: f.update_existing.checked } });
      $('#ml-res').innerHTML = `<div class="help" style="border-color:#17794a"><b>✓ Listo:</b> ${r.total} publicaciones leídas · ${r.created} nuevas · ${r.updated} actualizadas. <a href="#costos">Cargá ahora los costos →</a></div>`;
      S = await api('/api/admin/settings');
    } catch (err) { $('#ml-res').innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
    $('#ml-btn').disabled = false; $('#ml-btn').textContent = 'Importar desde Mercado Libre';
  };
  $('#csv-in').onchange = async (e) => {
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    try { const r = await api('/api/admin/import/csv', { method: 'POST', body: fd }); $('#csv-res').innerHTML = `<div class="help"><b>✓ Importado:</b> ${r.created} nuevos · ${r.updated} actualizados · ${r.skipped} filas omitidas.</div>`; }
    catch (err) { $('#csv-res').innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
    e.target.value = '';
  };
  $('#csv-tpl').onclick = () => {
    const csv = '﻿nombre;descripcion;categoria;marca;sku;precio;costo;costo_envio;iva;stock;receta;imagenes\n"Ibuprofeno 400mg x 20";"Analgésico";"Medicamentos";"Ibupirac";"IBU400";4500;2800;80;21;30;no;https://ejemplo.com/foto.jpg';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'plantilla-productos.csv' });
    a.click();
  };
};

// ---------- mensajes ----------
VIEWS.mensajes = async () => {
  const list = await api('/api/admin/messages');
  $('#view').innerHTML = `<div class="page-head"><h1>Mensajes de contacto</h1></div><div class="panel">${list.length ? list.map((m) => `
    <div class="msg ${m.read ? '' : 'unread'}"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div><b>${esc(m.name)}</b> <span class="muted">· ${fmtDate(m.created_at)}</span><br>
        ${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''} ${m.phone ? ` · <a href="https://wa.me/${m.phone.replace(/\D/g, '')}" target="_blank">${esc(m.phone)}</a>` : ''}</div>
      <div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-read="${m.id}" data-v="${m.read ? 0 : 1}">${m.read ? 'Marcar no leído' : 'Marcar leído'}</button><button class="btn btn-light btn-sm" data-del="${m.id}">Borrar</button></div></div>
      <p style="white-space:pre-wrap;margin:8px 0 0">${esc(m.message)}</p></div>`).join('') : '<p class="muted">Todavía no hay mensajes.</p>'}</div>`;
  $$('[data-read]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/messages/${b.dataset.read}`, { method: 'PATCH', body: { read: b.dataset.v === '1' } }); refreshBadges(); route(); }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => { if (confirm('¿Borrar mensaje?')) { await api(`/api/admin/messages/${b.dataset.del}`, { method: 'DELETE' }); route(); } }));
};

// ---------- configuración ----------
VIEWS.config = async () => {
  S = await api('/api/admin/settings');
  const inp = (k, label, type = 'text') => `<div class="field"><label>${label}</label><input type="${type}" name="${k}" value="${esc(S[k])}"></div>`;
  const area = (k, label, hint = '') => `<div class="field"><label>${label}</label><textarea name="${k}">${esc(S[k])}</textarea>${hint ? `<small class="muted">${hint}</small>` : ''}</div>`;
  const img = (k, label) => `<div class="field"><label>${label}</label><div style="display:flex;gap:10px;align-items:center">
      <div class="img-list"><div class="im">${S[k] ? `<img src="${esc(S[k])}" alt="">` : ''}</div></div>
      <label class="btn btn-ghost btn-sm">Subir<input type="file" accept="image/*" hidden data-up="${k}"></label>
      ${S[k] ? `<button type="button" class="btn btn-light btn-sm" data-clear="${k}">Quitar</button>` : ''}</div></div>`;
  $('#view').innerHTML = `<div class="page-head"><h1>Configuración</h1></div><form id="cfg">
    <div class="panel"><h3>Datos de la farmacia</h3>
      <div class="two">${inp('name', 'Nombre')}${inp('slogan', 'Frase principal')}</div>
      ${area('about', 'Quiénes somos')}
      <div class="two">${inp('address', 'Dirección')}${inp('city', 'Localidad')}${inp('phone', 'Teléfono')}${inp('whatsapp', 'WhatsApp (solo números, con 549)')}${inp('email', 'Email')}${inp('maps_url', 'Link de Google Maps', 'url')}</div>
      ${area('hours', 'Horarios')}
      ${area('services', 'Servicios', 'Separá cada servicio con el símbolo |')}</div>
    <div class="panel"><h3>Imagen y redes</h3>
      <div class="two">${img('logo', 'Logo')}${img('hero_image', 'Foto principal (portada)')}</div>
      <div class="two"><div class="field"><label>Color principal</label><input type="color" name="color_primary" value="${esc(S.color_primary)}" style="height:46px;width:100%"></div>
        <div class="field"><label>Color de acento</label><input type="color" name="color_accent" value="${esc(S.color_accent)}" style="height:46px;width:100%"></div></div>
      <div class="three">${inp('instagram', 'Instagram', 'url')}${inp('facebook', 'Facebook', 'url')}${inp('tiktok', 'TikTok', 'url')}</div></div>
    <div class="panel"><h3>Precios automáticos (facturas de compra)</h3><div class="two">${inp('default_markup', 'Ganancia por defecto sobre el costo (%)', 'number')}${inp('price_rounding', 'Redondear precios hacia arriba a múltiplos de ($)', 'number')}</div>
      <p class="muted">Se usa para productos nuevos que llegan en una factura, o cuando elegís "aplicar un margen" al cargarla.</p></div>
    <div class="panel"><div class="page-head" style="margin-bottom:6px"><h3 style="margin:0">Zonas de envío</h3><button type="button" class="btn btn-ghost btn-sm" id="z-add">+ Agregar zona</button></div>
      <p class="muted" style="margin-top:0">Solo se puede elegir envío a domicilio para las localidades de las zonas activas; el resto puede retirar en la farmacia. Cambialas según lo que arregles con la logística.</p>
      <div id="zones"></div></div>
    <div class="panel"><h3>Costos de la página (para el precio mínimo)</h3>
      <div class="three">${inp('page_fixed_monthly', 'Costos fijos de la web por mes ($)', 'number')}${inp('page_fee_pct', 'Comisiones e impuestos sobre la venta (%)', 'number')}${inp('page_units_month', 'Unidades vendidas por mes (0 = automático)', 'number')}</div>
      <p class="muted">Costos fijos: hosting, dominio, servicio de emails, lectura de facturas, etc. Comisiones: cobro con QR/billetera, Ingresos Brutos y otros impuestos que se calculan sobre el precio.
        El costo fijo se reparte entre las unidades vendidas: hoy son <b>${PC.units_month}</b> por mes (${esc(PC.units_source)}), o sea <b>${money(PC.fixed_per_unit)} por unidad</b>.</p></div>
    <div class="panel"><h3>Post-compra y reclamos</h3>
      <div class="two">${inp('owner_phone', 'Celular / WhatsApp de la dueña para reclamos (con 549)')}${inp('claim_days', 'Días para reclamar después de la entrega', 'number')}</div>
      <p class="muted">Este número aparece en el email "Tu pedido llegó", en la página del pedido y en la de reclamos. Si lo dejás vacío se usa el WhatsApp de la farmacia. La ley de Defensa del Consumidor da 10 días para arrepentirse de una compra online.</p></div>
    <div class="panel"><h3>Cobros: transferencia y QR</h3>
      <div class="two">${inp('bank_holder', 'Titular')}${inp('bank_cuit', 'CUIT')}${inp('bank_name', 'Banco / billetera')}${inp('bank_cbu', 'CBU / CVU')}${inp('bank_alias', 'Alias')}</div>
      <div class="two">${img('qr_image', 'Imagen del QR de cobro (ej. QR de Mercado Pago)')}
        ${inp('qr_text', 'O texto/link para generar el QR automáticamente')}</div>
      <p class="muted">Si subís la imagen del QR de tu cuenta (Mercado Pago, MODO, etc.) se muestra esa. Si no, se genera un QR con el link o texto que pongas.</p></div>
    <button class="btn btn-primary">Guardar configuración</button></form>`;
  $$('[data-up]').forEach((i) => (i.onchange = async () => {
    const fd = new FormData(); fd.append('images', i.files[0]);
    const r = await api('/api/admin/upload', { method: 'POST', body: fd });
    await api('/api/admin/settings', { method: 'PUT', body: { [i.dataset.up]: r.urls[0] } });
    toast('Imagen actualizada ✓'); route();
  }));
  $$('[data-clear]').forEach((b) => (b.onclick = async () => { await api('/api/admin/settings', { method: 'PUT', body: { [b.dataset.clear]: '' } }); route(); }));
  // ----- editor de zonas de envío -----
  let zones = [];
  try { zones = JSON.parse(S.shipping_zones || '[]'); } catch {}
  const renderZones = () => {
    $('#zones').innerHTML = zones.map((z, i) => `<div class="zone ${z.enabled ? '' : 'off'}">
      <div class="zone-head"><input type="text" data-z="${i}" data-k="name" value="${esc(z.name)}" placeholder="Nombre de la zona">
        <label><input type="checkbox" data-z="${i}" data-k="enabled" ${z.enabled ? 'checked' : ''}> Activa</label>
        <button type="button" class="btn btn-light btn-sm" data-zdel="${i}">Quitar</button></div>
      <div class="two"><div class="field"><label>Costo de envío ($)</label><input type="number" min="0" data-z="${i}" data-k="fee" value="${z.fee}"></div>
        <div class="field"><label>Envío gratis desde ($, 0 = nunca)</label><input type="number" min="0" data-z="${i}" data-k="free_from" value="${z.free_from}"></div></div>
      <div class="field"><label>Localidades / partidos (uno por línea)</label><textarea data-z="${i}" data-k="places" rows="4">${esc((z.places || []).join('\n'))}</textarea></div></div>`).join('') || '<p class="muted">Sin zonas: solo retiro en la farmacia.</p>';
    $$('#zones [data-z]').forEach((el) => (el.onchange = () => {
      const z = zones[el.dataset.z], k = el.dataset.k;
      z[k] = k === 'enabled' ? el.checked : k === 'places' ? el.value.split('\n').map((x) => x.trim()).filter(Boolean) : ['fee', 'free_from'].includes(k) ? Number(el.value) || 0 : el.value;
      if (k === 'enabled') renderZones();
    }));
    $$('#zones [data-zdel]').forEach((b) => (b.onclick = () => { if (confirm(`¿Quitar la zona "${zones[b.dataset.zdel].name}"?`)) { zones.splice(+b.dataset.zdel, 1); renderZones(); } }));
  };
  $('#z-add').onclick = () => { zones.push({ name: 'Nueva zona', fee: 0, free_from: 0, enabled: true, places: [] }); renderZones(); };
  renderZones();

  $('#cfg').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    for (const k of Object.keys(body)) if (k === '') delete body[k];
    body.shipping_zones = zones;
    try { S = await api('/api/admin/settings', { method: 'PUT', body }); } catch (err) { toast(err.message); return; }
    PC = await api('/api/admin/page-cost');
    applyTheme(S);
    toast('Configuración guardada ✓');
  };
};

boot();
