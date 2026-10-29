let S = {};          // configuración de la farmacia
let PRODUCTS = [];
let category = '';
let PROMOS = [];
let promoFilter = null; // ids de productos de la promo elegida
let cart = loadCart();

function loadCart() {
  try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch { return []; }
}
function saveCart() {
  try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {}
  $('#cart-count').textContent = cart.reduce((a, i) => a + i.qty, 0);
}
const waLink = (text = '') => `https://wa.me/${(S.whatsapp || '').replace(/\D/g, '')}${text ? '?text=' + encodeURIComponent(text) : ''}`;
const productById = (id) => PRODUCTS.find((p) => p.id === id);

async function init() {
  S = await api('/api/settings');
  applyTheme(S);
  renderInfo();
  $('#q').insertAdjacentHTML('beforebegin', icon('search'));
  $('#menu-btn').innerHTML = icon('menu');
  $('#cart-btn').insertAdjacentHTML('afterbegin', icon('cart'));
  $('#menu-btn').onclick = () => $('#nav').classList.toggle('open');
  $$('#nav a').forEach((a) => (a.onclick = () => $('#nav').classList.remove('open')));
  $('#cart-btn').onclick = openCart;
  let t;
  $('#q').oninput = () => { clearTimeout(t); t = setTimeout(renderGrid, 150); };
  $('#sort').onchange = renderGrid;
  $('#contact-form').onsubmit = sendContact;
  $('#news-form').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/subscribe', { method: 'POST', body: { email: e.target.email.value } }); e.target.reset(); toast(r.already ? 'Ya estabas suscripto 💚' : '¡Listo! Te vamos a avisar de las promos 💚'); }
    catch (err) { toast(err.message); }
  };
  loadPromos();
  await loadProducts();
  saveCart();
  const m = location.hash.match(/^#p-(\d+)$/);
  if (m) openProduct(Number(m[1]));
}

// zonas de envío habilitadas (CABA, GBA, etc.)
const ZONES = () => { try { return JSON.parse(S.shipping_zones || '[]'); } catch { return []; } };
const zoneOf = (place) => ZONES().find((z) => z.places.includes(place));
const minFree = () => Math.min(...ZONES().map((z) => Number(z.free_from) || Infinity));

function renderInfo() {
  const free = Number.isFinite(minFree()) ? minFree() : 0;
  // "CABA, GBA 1er cordón, GBA 2do cordón" -> "CABA y GBA" para que entre en la barra
  const zoneNames = ZONES().some((z) => /gba|cord/i.test(z.name)) && ZONES().some((z) => /caba/i.test(z.name)) ? 'CABA y GBA' : ZONES().map((z) => z.name).join(', ');
  $('#brand').innerHTML = `${logoHTML(S)}`;
  $('#tb-ship').textContent = ZONES().length ? `🚚 Envíos a ${zoneNames}${free ? ` · gratis desde ${money(free)}` : ''}` : '🏪 Retiro en la farmacia';
  $('#tb-phone').textContent = S.phone; $('#tb-phone').href = `tel:${S.phone}`;
  $('#tb-hours').textContent = (S.hours || '').split('\n')[0];

  const words = (S.slogan || '').split(' ');
  const half = Math.ceil(words.length / 2);
  const years = S.since_year ? new Date().getFullYear() - Number(S.since_year) : 0;
  $('#hero-eyebrow').textContent = S.since_year ? `${S.name} · Desde ${S.since_year}` : S.name;
  $('#hero-title').innerHTML = `${esc(words.slice(0, half).join(' '))} <span>${esc(words.slice(half).join(' '))}</span>`;
  $('#hero-lead').textContent = 'Medicamentos, dermocosmética, perfumería y maquillaje, con la atención de siempre. Comprá online, pagá con transferencia o QR y seguí tu pedido en tiempo real.';
  $('#cta-shop').innerHTML = `${icon('cart')} Comprar ahora`;
  $('#cta-wa').innerHTML = `${icon('phone')} Consultanos`;
  $('#cta-wa').href = waLink('¡Hola! Quería hacer una consulta.');
  // placa verde como las de sus posteos; si hay foto de portada, la usa de fondo
  $('#hero-art').innerHTML = `<div class="brand-card brand-green ${S.hero_image ? 'has-photo' : ''}">
      ${S.hero_image ? `<img class="photo" src="${esc(S.hero_image)}" alt="">` : ''}
      <img class="emblem" src="/img/logo-durand-white.svg" alt="">
      ${years > 0 ? `<div class="big"><span>¡Celebramos</span><strong>${years} años!</strong><em>cuidando la salud del barrio</em></div>` : `<div class="big"><strong>${esc(S.slogan)}</strong></div>`}
      ${wordmarkHTML(S)}
    </div>
    <div class="chip a">${icon('shield')} Farmacéuticos matriculados</div>
    ${ZONES().length ? `<div class="chip b">${icon('truck')} Envíos a CABA y GBA</div>` : ''}`;

  const perks = [
    ['truck', 'Envíos a domicilio', ZONES().length ? `${ZONES().some((z) => /gba|cord/i.test(z.name)) ? 'CABA y GBA' : zoneNames}${free ? ` · gratis desde ${money(free)}` : ''}` : 'Consultá por tu zona'],
    ['bank', 'Transferencia', 'Sin recargo'],
    ['qr', 'Pagá con QR', 'Desde tu billetera virtual'],
    ['heart', 'Atención personalizada', 'Te asesoramos'],
  ];
  $('#perks').innerHTML = perks.map(([i, b, s]) => `<div class="perk"><span class="ico">${icon(i)}</span><div><b>${b}</b><small>${s}</small></div></div>`).join('');

  // ícono según el servicio, como las historias destacadas del Instagram
  const svcIcon = (t) => [[/vacun/i, 'syringe'], [/obra|prepag/i, 'heartplus'], [/maquill/i, 'lipstick'], [/perfum|cosm|dermo/i, 'sparkle'], [/presi/i, 'steth'],
    [/env[ií]o/i, 'truck'], [/atenci|farmac/i, 'users'], [/promo|regal/i, 'gift']].find(([r]) => r.test(t))?.[1] || 'pill';
  $('#services').innerHTML = (S.services || '').split('|').filter(Boolean)
    .map((s) => `<div class="service"><span class="ico">${icon(svcIcon(s))}</span>${esc(s)}</div>`).join('');

  $('#about-title').textContent = S.name;
  $('#about-text').textContent = S.about;
  $('#info-list').innerHTML = `
    <li><span class="ico">${icon('pin')}</span><div><b>Dirección</b><br>${esc(S.address)}, ${esc(S.city)}${S.maps_url ? `<br><a href="${esc(S.maps_url)}" target="_blank" rel="noopener">Cómo llegar →</a>` : ''}</div></li>
    <li><span class="ico">${icon('clock')}</span><div><b>Horarios</b><br><span class="pre">${esc(S.hours)}</span></div></li>
    <li><span class="ico">${icon('phone')}</span><div><b>Teléfono</b><br><a href="tel:${esc(S.phone)}">${esc(S.phone)}</a></div></li>`;
  $('#map').src = `https://www.google.com/maps?q=${encodeURIComponent(`${S.name}, ${S.address}, ${S.city}`)}&output=embed`;

  const socials = [['instagram', 'ig', 'Instagram'], ['facebook', 'fb', 'Facebook'], ['tiktok', 'tiktok', 'TikTok']].filter(([k]) => S[k]);
  $('#social-links').innerHTML = socials.map(([k, i, l]) => `<a href="${esc(S[k])}" target="_blank" rel="noopener">${icon(i)} ${l}</a>`).join('')
    + (S.linktree ? `<a href="${esc(S.linktree)}" target="_blank" rel="noopener">${icon('link')} Todos los links</a>` : '')
    + (S.whatsapp ? `<a href="${waLink()}" target="_blank" rel="noopener">${icon('phone')} WhatsApp</a>` : '');
  const handle = (S.instagram || '').match(/instagram\.com\/([^/?#]+)/i);
  $('#social-handle').textContent = handle ? `@${handle[1]}` : '';

  $('#contact-opts').innerHTML = `
    ${S.whatsapp ? `<a class="contact-opt wa" href="${waLink('¡Hola! Quería hacer una consulta.')}" target="_blank" rel="noopener"><span class="ico">${WA_SVG}</span><div><b>WhatsApp</b><br><span class="muted">Respuesta rápida</span></div></a>` : ''}
    <a class="contact-opt" href="tel:${esc(S.phone)}"><span class="ico">${icon('phone')}</span><div><b>Llamanos</b><br><span class="muted">${esc(S.phone)}</span></div></a>
    <a class="contact-opt" href="mailto:${esc(S.email)}"><span class="ico">${icon('mail')}</span><div><b>Email</b><br><span class="muted">${esc(S.email)}</span></div></a>
    ${S.instagram ? `<a class="contact-opt" href="${esc(S.instagram)}" target="_blank" rel="noopener"><span class="ico" style="background:linear-gradient(45deg,#f9a825,#e1306c,#833ab4)">${icon('ig')}</span><div><b>Instagram</b><br><span class="muted">Mandanos un DM</span></div></a>` : ''}`;

  $('#f-name').textContent = S.name;
  $('#f-about').textContent = S.slogan;
  $('#f-hours').textContent = S.hours;
  $('#f-contact').innerHTML = `${esc(S.address)}<br>${esc(S.city)}<br><a href="tel:${esc(S.phone)}">${esc(S.phone)}</a><br><a href="mailto:${esc(S.email)}">${esc(S.email)}</a>`;
  $('#f-copy').textContent = `© ${new Date().getFullYear()} ${S.name}. Todos los derechos reservados.`;
  $('#wa-float').innerHTML = WA_SVG;
  $('#wa-float').href = waLink('¡Hola! Quería hacer una consulta.');
  if (!S.whatsapp) $('#wa-float').classList.add('hidden');
}

async function loadPromos() {
  try { PROMOS = await api('/api/promotions'); } catch { PROMOS = []; }
  $('#promociones').classList.toggle('hidden', !PROMOS.length);
  $('#nav-promos').classList.toggle('hidden', !PROMOS.length);
  const until = (d) => d ? `Hasta el ${d.split('-').reverse().join('/')}` : '';
  $('#promos').innerHTML = PROMOS.map((pr) => `<article class="promo">
      ${pr.image ? `<img src="${esc(pr.image)}" alt="">` : `<div class="promo-art">${esc(pr.label || '%')}</div>`}
      <div class="promo-body">${pr.label ? `<span class="badge" style="position:static">${esc(pr.label)}</span>` : ''}
        <h3>${esc(pr.title)}</h3><p class="muted pre">${esc(pr.body)}</p>
        <div class="promo-foot"><small class="muted">${until(pr.ends_at)}</small><button class="btn btn-primary btn-sm" data-promo="${pr.id}">Ver productos</button></div></div></article>`).join('');
  $$('[data-promo]').forEach((b) => (b.onclick = () => {
    const pr = PROMOS.find((x) => x.id == b.dataset.promo);
    promoFilter = pr.target === 'products' ? (p) => pr.product_ids.includes(p.id) : pr.target === 'category' ? (p) => p.category === pr.target_category : null;
    category = '';
    $$('#chips .chip-f').forEach((x) => x.classList.toggle('active', x.dataset.c === ''));
    renderGrid();
    if (promoFilter) toast(`Mostrando: ${pr.title} · tocá "Todos" para ver todo`);
    $('#productos').scrollIntoView();
  }));
}

async function loadProducts() {
  PRODUCTS = await api('/api/products');
  const cats = [...new Set(PRODUCTS.map((p) => p.category))].sort();
  $('#chips').innerHTML = ['', ...cats].map((c) => `<button class="chip-f ${c === category ? 'active' : ''}" data-c="${esc(c)}">${c ? esc(c) : 'Todos'}</button>`).join('');
  $$('#chips .chip-f').forEach((b) => (b.onclick = () => { category = b.dataset.c; promoFilter = null; $$('#chips .chip-f').forEach((x) => x.classList.toggle('active', x === b)); renderGrid(); }));
  // limpiar del carrito lo que ya no existe
  cart = cart.filter((i) => productById(i.id));
  renderGrid();
}

function renderGrid() {
  const q = $('#q').value.trim().toLowerCase();
  let list = PRODUCTS.filter((p) => (!promoFilter || promoFilter(p)) && (!category || p.category === category) && (!q || `${p.name} ${p.brand} ${p.description}`.toLowerCase().includes(q)));
  const sort = $('#sort').value;
  if (sort === 'price_asc') list.sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') list.sort((a, b) => b.price - a.price);
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) { $('#grid').innerHTML = '<div class="empty" style="grid-column:1/-1">No encontramos productos con esa búsqueda.</div>'; return; }
  $('#grid').innerHTML = list.map((p) => {
    const off = p.list_price > p.price;
    const badge = p.requires_prescription ? '<span class="badge rx">Bajo receta</span>' : off ? `<span class="badge">${esc(p.promo_label)}</span>` : p.stock <= 0 ? '<span class="badge out">Sin stock</span>' : p.featured ? '<span class="badge">Destacado</span>' : '';
    const canBuy = !p.requires_prescription && p.stock > 0;
    return `<article class="card" data-id="${p.id}">
      <div class="thumb">${badge}<img src="${esc(p.images[0] || PLACEHOLDER)}" alt="${esc(p.name)}" loading="lazy" onerror="this.src=PLACEHOLDER"></div>
      <div class="body">
        <span class="brand-name">${esc(p.brand || p.category)}</span>
        <h3>${esc(p.name)}</h3>
        <div class="row"><span>${off ? `<s class="list-price">${money(p.list_price)}</s>` : ''}<span class="price">${money(p.price)}</span></span>
          <button class="add-btn" data-add="${p.id}" ${canBuy ? '' : 'disabled'} aria-label="Agregar al carrito">${icon('plus')}</button></div>
      </div></article>`;
  }).join('');
  $$('#grid .card').forEach((c) => (c.onclick = (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { e.stopPropagation(); addToCart(Number(add.dataset.add), 1); }
    else openProduct(Number(c.dataset.id));
  }));
}

function addToCart(id, qty) {
  const p = productById(id);
  const line = cart.find((i) => i.id === id);
  const current = line ? line.qty : 0;
  if (current + qty > p.stock) { toast(`Solo hay ${p.stock} unidades disponibles`); return; }
  if (line) line.qty += qty; else cart.push({ id, qty });
  saveCart();
  toast(`✓ ${p.name} agregado al carrito`);
}

// ---------- modales ----------
function openLayer(html, onClose) {
  $('#layer').innerHTML = html;
  const close = () => { $('#layer').innerHTML = ''; document.body.style.overflow = ''; onClose && onClose(); };
  document.body.style.overflow = 'hidden';
  const ov = $('#layer').firstElementChild;
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  document.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  return close;
}

function openProduct(id) {
  const p = productById(id);
  if (!p) return;
  history.replaceState(null, '', `#p-${id}`);
  const imgs = p.images.length ? p.images : [PLACEHOLDER];
  let qty = 1;
  const canBuy = !p.requires_prescription && p.stock > 0;
  openLayer(`<div class="overlay"><div class="modal" role="dialog" aria-label="${esc(p.name)}">
    <button class="icon-btn close" data-close aria-label="Cerrar">${icon('x')}</button>
    <div class="pdp">
      <div class="gallery">
        <div class="main-img"><img id="main-img" src="${esc(imgs[0])}" alt="${esc(p.name)}" onerror="this.src=PLACEHOLDER"></div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button class="${i ? '' : 'active'}" data-img="${esc(u)}"><img src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}
      </div>
      <div class="info">
        <span class="brand-name muted"><b>${esc(p.brand)}</b> · ${esc(p.category)}</span>
        <h2>${esc(p.name)}</h2>
        <div>${p.list_price > p.price ? `<s class="list-price">${money(p.list_price)}</s> <span class="badge" style="position:static">${esc(p.promo_label)}</span>` : ''}<div class="price">${money(p.price)}</div></div>
        ${p.requires_prescription ? `<div class="rx-note">💊 Este medicamento es de <b>venta bajo receta</b>. Consultanos por WhatsApp para coordinar la compra.</div>`
          : `<div class="stock-note">${p.stock > 0 ? (p.stock <= 5 ? `¡Últimas ${p.stock} unidades!` : '✓ Disponible') : 'Sin stock por el momento'}</div>`}
        <div class="desc">${esc(p.description || 'Sin descripción.')}</div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:auto">
          ${canBuy ? `<div class="qty"><button id="q-minus">−</button><span id="q-val">1</span><button id="q-plus">+</button></div>
          <button class="btn btn-primary" id="pdp-add" style="flex:1">${icon('cart')} Agregar al carrito</button>`
          : `<a class="btn btn-primary" style="flex:1" target="_blank" rel="noopener" href="${waLink(`Hola! Quería consultar por: ${p.name}`)}">Consultar por WhatsApp</a>`}
        </div>
      </div>
    </div></div></div>`, () => history.replaceState(null, '', location.pathname));
  $$('.thumbs button').forEach((b) => (b.onclick = () => { $('#main-img').src = b.dataset.img; $$('.thumbs button').forEach((x) => x.classList.toggle('active', x === b)); }));
  if (canBuy) {
    $('#q-minus').onclick = () => { qty = Math.max(1, qty - 1); $('#q-val').textContent = qty; };
    $('#q-plus').onclick = () => { qty = Math.min(p.stock, qty + 1); $('#q-val').textContent = qty; };
    $('#pdp-add').onclick = () => { addToCart(p.id, qty); $('[data-close]').click(); };
  }
}

function totals(delivery = 'envio', place = '') {
  const subtotal = cart.reduce((a, i) => a + productById(i.id).price * i.qty, 0);
  const z = delivery === 'envio' ? zoneOf(place) : null;
  const free = z ? Number(z.free_from || 0) : (Number.isFinite(minFree()) ? minFree() : 0);
  const shipping = z && !(free > 0 && subtotal >= free) ? Number(z.fee || 0) : 0;
  return { subtotal, shipping, total: subtotal + shipping, free, zone: z };
}

function openCart() {
  openLayer('<div class="drawer-wrap"><aside class="drawer" id="drawer"></aside></div>');
  renderCart();
}

function renderCart() {
  const d = $('#drawer');
  if (!d) return;
  const t = totals();
  d.innerHTML = `<header><h3 style="margin:0">Tu carrito</h3><button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></header>
    <div class="items">${cart.length ? cart.map((i) => {
      const p = productById(i.id);
      return `<div class="cart-item"><img src="${esc(p.images[0] || PLACEHOLDER)}" alt="">
        <div><div class="name">${esc(p.name)}</div><div class="muted">${money(p.price)}</div>
          <div class="qty" style="margin-top:6px"><button data-dec="${p.id}">−</button><span>${i.qty}</span><button data-inc="${p.id}">+</button></div></div>
        <div style="text-align:right"><b>${money(p.price * i.qty)}</b><br><button class="icon-btn" data-rm="${p.id}" aria-label="Quitar">${icon('x')}</button></div></div>`;
    }).join('') : `<div class="empty">${icon('cart')}<p>Tu carrito está vacío</p><button class="btn btn-ghost btn-sm" data-close>Ver productos</button></div>`}</div>
    ${cart.length ? `<footer>
      ${t.free > 0 && t.subtotal < t.free ? `<div class="ship-hint">🚚 Envío gratis desde ${money(t.free)} (según tu zona)</div>` : t.free > 0 ? `<div class="ship-hint">🎉 ¡Ya tenés envío gratis en ${esc((ZONES().find((z) => Number(z.free_from) === t.free) || {}).name || 'tu zona')}!</div>` : ''}
      <div class="sum-row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
      <button class="btn btn-primary btn-block" id="go-checkout">Finalizar compra</button></footer>` : ''}`;
  const change = (id, delta) => {
    const l = cart.find((x) => x.id === id), p = productById(id);
    l.qty = Math.min(p.stock, l.qty + delta);
    if (l.qty <= 0) cart = cart.filter((x) => x !== l);
    saveCart(); renderCart();
  };
  $$('[data-inc]', d).forEach((b) => (b.onclick = () => change(Number(b.dataset.inc), 1)));
  $$('[data-dec]', d).forEach((b) => (b.onclick = () => change(Number(b.dataset.dec), -1)));
  $$('[data-rm]', d).forEach((b) => (b.onclick = () => change(Number(b.dataset.rm), -999)));
  const go = $('#go-checkout');
  if (go) go.onclick = openCheckout;
}

function openCheckout() {
  openLayer(`<div class="overlay"><div class="modal sm"><button class="icon-btn close" data-close aria-label="Cerrar">${icon('x')}</button>
    <form class="modal-pad" id="checkout">
      <h2>Finalizar compra</h2>
      <div id="co-err"></div>
      <div class="field"><label>Nombre y apellido</label><input type="text" name="customer_name" required autocomplete="name"></div>
      <div class="two">
        <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
        <div class="field"><label>Teléfono / WhatsApp</label><input type="tel" name="phone" required autocomplete="tel"></div>
      </div>
      <div class="field"><label>Entrega</label>
        <div class="options">
          <label class="option ${ZONES().length ? '' : 'hidden'}"><input type="radio" name="delivery_method" value="envio" ${ZONES().length ? 'checked' : ''}> <span>${icon('truck')}</span><span>Envío a domicilio<small id="ship-lbl"></small></span></label>
          <label class="option"><input type="radio" name="delivery_method" value="retiro" ${ZONES().length ? '' : 'checked'}> <span>${icon('store')}</span><span>Retiro en farmacia<small>Sin costo</small></span></label>
        </div></div>
      <div id="addr">
        <div class="two">
          <div class="field"><label>Localidad / partido</label><select name="city"><option value="">Elegí tu localidad…</option>
            ${ZONES().map((z) => `<optgroup label="${esc(z.name)} · envío ${money(z.fee)}">${z.places.map((p) => `<option>${esc(p)}</option>`).join('')}</optgroup>`).join('')}</select></div>
          <div class="field"><label>Dirección</label><input type="text" name="address" autocomplete="street-address" placeholder="Calle, número, piso/depto"></div>
        </div>
        <p class="muted" style="font-size:.85rem;margin:-6px 0 12px">Enviamos solo a ${esc(ZONES().map((z) => z.name).join(', '))}. ¿Tu localidad no está? Elegí retiro en la farmacia o <a href="${waLink('Hola! Quería consultar si hacen envíos a mi zona.')}" target="_blank" rel="noopener">consultanos por WhatsApp</a>.</p>
      </div>
      <div class="field"><label>Medio de pago</label>
        <div class="options">
          <label class="option"><input type="radio" name="payment_method" value="transferencia" checked> <span>${icon('bank')}</span><span>Transferencia<small>CBU / Alias</small></span></label>
          <label class="option"><input type="radio" name="payment_method" value="qr"> <span>${icon('qr')}</span><span>Código QR<small>Billetera virtual</small></span></label>
        </div></div>
      <label class="sub-check"><input type="checkbox" name="subscribe" value="1"> <span>Quiero recibir <b>promociones y descuentos</b> por email</span></label>
      <div class="field"><label>Notas (opcional)</label><textarea name="notes" style="min-height:70px" placeholder="Ej: timbre 2B, horario de entrega…"></textarea></div>
      <div id="co-sum" style="display:grid;gap:6px;margin:8px 0 16px"></div>
      <button class="btn btn-primary btn-block" id="co-btn">Confirmar pedido</button>
      <p class="muted center" style="font-size:.85rem;margin-bottom:0">Te enviaremos un email con los datos de pago y el link para seguir tu pedido.</p>
    </form></div></div>`);
  const f = $('#checkout');
  const upd = () => {
    const dm = f.delivery_method.value;
    const t = totals(dm, f.city.value);
    $('#addr').classList.toggle('hidden', dm !== 'envio');
    f.address.required = f.city.required = dm === 'envio';
    $('#ship-lbl').textContent = t.zone ? `${t.zone.name}: ${t.shipping ? money(t.shipping) : '¡gratis!'}` : 'CABA y GBA';
    const shipTxt = dm !== 'envio' ? 'Sin costo' : !t.zone ? 'Elegí tu localidad' : t.shipping ? money(t.shipping) : 'Gratis';
    $('#co-sum').innerHTML = `<div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      <div class="sum-row"><span>Envío${t.zone ? ` (${esc(t.zone.name)})` : ''}</span><span>${shipTxt}</span></div>
      ${t.zone && t.free > 0 && t.subtotal < t.free ? `<div class="ship-hint">🚚 Te faltan ${money(t.free - t.subtotal)} para el envío gratis en ${esc(t.zone.name)}</div>` : ''}
      <div class="sum-row total"><span>Total</span><span>${money(t.total)}</span></div>`;
  };
  $$('input[name=delivery_method]', f).forEach((r) => (r.onchange = upd));
  f.city.onchange = upd;
  upd();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    data.items = cart;
    data.subscribe = !!f.subscribe.checked;
    $('#co-btn').disabled = true; $('#co-btn').textContent = 'Enviando…';
    try {
      const r = await api('/api/orders', { method: 'POST', body: data });
      cart = []; saveCart();
      location.href = `/pedido/${r.code}?nuevo=1`;
    } catch (err) {
      $('#co-err').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      $('#co-btn').disabled = false; $('#co-btn').textContent = 'Confirmar pedido';
      f.scrollTop = 0;
      loadProducts();
    }
  };
}

async function sendContact(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/contact', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
    f.reset();
    toast('¡Gracias! Te vamos a responder a la brevedad.');
  } catch (err) { toast(err.message); }
}

init().catch((e) => { console.error(e); toast('No se pudo cargar la tienda'); });
