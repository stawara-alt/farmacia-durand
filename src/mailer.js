const nodemailer = require('nodemailer');
const { getSettings } = require('./db');

const STATUS = {
  pendiente: { label: 'Pendiente de confirmación', emoji: '🕒', text: 'Recibimos tu pedido. Lo vamos a revisar y confirmar a la brevedad.' },
  aceptado: { label: 'Pedido aceptado', emoji: '✅', text: '¡Confirmamos tu pago y aceptamos tu pedido!' },
  en_preparacion: { label: 'En preparación', emoji: '📦', text: 'Estamos preparando tu pedido.' },
  en_envio: { label: 'En camino', emoji: '🚚', text: 'Tu pedido salió y está en camino.' },
  listo_retiro: { label: 'Listo para retirar', emoji: '🏪', text: 'Tu pedido está listo para retirar en la farmacia.' },
  entregado: { label: 'Entregado', emoji: '🎉', text: '¡Tu pedido llegó! Gracias por elegirnos.' },
  rechazado: { label: 'Rechazado', emoji: '⚠️', text: 'No pudimos aceptar tu pedido. Comunicate con nosotros para más información.' },
  cancelado: { label: 'Cancelado', emoji: '❌', text: 'Tu pedido fue cancelado.' },
};

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const money = (n) => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function baseUrl() {
  return (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

// "Farmacia DURAND / Desde 1916" como en el logo (con fuentes seguras para email)
function wordmark(s) {
  const words = String(s.name || '').trim().split(/\s+/);
  const big = words.length > 1 ? words.pop() : words[0] || '';
  return `<span style="font-size:13px">${esc(words.join(' '))}</span><br><span style="font-size:26px;font-weight:bold;letter-spacing:1px">${esc(big.toUpperCase())}</span>${s.since_year ? `<br><i style="font-size:11px">Desde ${esc(s.since_year)}</i>` : ''}`;
}

function layout(s, inner) {
  const c = s.color_primary || '#0f9d76';
  return `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2a27">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden">
    <tr><td style="background:${c};padding:18px 28px;color:#fff;font-family:Georgia,'Times New Roman',serif">${wordmark(s)}</td></tr>
    <tr><td style="padding:28px">${inner}</td></tr>
    <tr><td style="background:#f0f3f2;padding:18px 28px;font-size:12px;color:#5b6b66">
      ${esc(s.address)} · ${esc(s.city)}<br>Tel: ${esc(s.phone)} · ${esc(s.email)}
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function itemsTable(order) {
  const rows = order.items.map((i) => `<tr><td style="padding:6px 0">${esc(i.name)} × ${i.qty}</td><td align="right">${money(i.unit_price * i.qty)}</td></tr>`).join('');
  return `<table width="100%" style="border-top:1px solid #e3e8e6;margin-top:16px;font-size:14px">${rows}
    <tr><td style="padding-top:8px;color:#5b6b66">Envío</td><td align="right" style="padding-top:8px">${money(order.shipping_fee)}</td></tr>
    <tr><td style="font-weight:bold;padding-top:6px">Total</td><td align="right" style="font-weight:bold;padding-top:6px">${money(order.total)}</td></tr></table>`;
}

function button(s, href, label) {
  return `<p style="text-align:center;margin:26px 0"><a href="${href}" style="background:${s.color_primary};color:#fff;text-decoration:none;padding:14px 26px;border-radius:30px;font-weight:bold;display:inline-block">${label}</a></p>`;
}

function paymentBlock(s, order) {
  if (order.payment_method === 'transferencia') {
    return `<div style="background:#f0faf6;border-radius:10px;padding:16px;font-size:14px;margin-top:16px">
      <b>Datos para la transferencia</b><br>
      Titular: ${esc(s.bank_holder)}<br>CUIT: ${esc(s.bank_cuit)}<br>Banco: ${esc(s.bank_name)}<br>
      CBU/CVU: ${esc(s.bank_cbu)}<br>Alias: <b>${esc(s.bank_alias)}</b><br>Monto: <b>${money(order.total)}</b><br>
      <span style="color:#5b6b66">Podés subir el comprobante desde el link de seguimiento.</span></div>`;
  }
  return `<div style="background:#f0faf6;border-radius:10px;padding:16px;font-size:14px;margin-top:16px">
    <b>Pago con QR</b><br>Escaneá el código QR que aparece en la página de tu pedido y aboná <b>${money(order.total)}</b>.
    Luego subí el comprobante desde el mismo link.</div>`;
}

async function send(to, subject, html, headers = {}) {
  if (!transporter) {
    console.log(`\n📧 [EMAIL SIMULADO - configurá SMTP en .env]\n   Para: ${to}\n   Asunto: ${subject}\n`);
    return { simulated: true };
  }
  const s = getSettings();
  try {
    return await transporter.sendMail({ from: process.env.MAIL_FROM || `"${s.name}" <${process.env.SMTP_USER}>`, to, subject, html, headers });
  } catch (e) {
    console.error('Error enviando email:', e.message);
    return { error: e.message };
  }
}

function sendOrderCreated(order) {
  const s = getSettings();
  const link = `${baseUrl()}/pedido/${order.code}`;
  const html = layout(s, `
    <h2 style="margin:0 0 8px">¡Gracias por tu compra, ${esc(order.customer_name.split(' ')[0])}!</h2>
    <p>Recibimos tu pedido <b>#${order.id}</b>. Estado actual: <b>${STATUS.pendiente.emoji} ${STATUS.pendiente.label}</b>.</p>
    <p>Te vamos a avisar por mail cada vez que cambie el estado. También podés seguirlo en todo momento desde este link:</p>
    ${button(s, link, 'Ver el estado de mi pedido')}
    <p style="font-size:12px;color:#5b6b66;word-break:break-all">${link}</p>
    ${paymentBlock(s, order)}
    ${itemsTable(order)}`);
  send(order.email, `Recibimos tu pedido #${order.id} - ${s.name}`, html);

  // aviso a la farmacia
  const adminTo = process.env.ADMIN_EMAIL || s.email;
  if (adminTo) {
    send(adminTo, `🛒 Nuevo pedido #${order.id} - ${money(order.total)}`, layout(s, `
      <h2>Nuevo pedido #${order.id}</h2>
      <p>${esc(order.customer_name)} · ${esc(order.email)} · ${esc(order.phone)}</p>
      <p>Pago: ${order.payment_method === 'qr' ? 'QR' : 'Transferencia'} · Entrega: ${order.delivery_method === 'envio' ? 'Envío a ' + esc(order.address) : 'Retiro en local'}</p>
      ${itemsTable(order)}
      ${button(s, `${baseUrl()}/admin`, 'Abrir panel de administración')}`));
  }
}

function sendStatusChanged(order, note, extraHtml = '') {
  const s = getSettings();
  const st = STATUS[order.status] || { label: order.status, emoji: '', text: '' };
  const link = `${baseUrl()}/pedido/${order.code}`;
  const html = layout(s, `
    <h2 style="margin:0 0 8px">${st.emoji} ${st.label}</h2>
    <p>Hola ${esc(order.customer_name.split(' ')[0])}, tu pedido <b>#${order.id}</b> cambió de estado.</p>
    <p>${st.text}</p>
    ${note ? `<div style="background:#fff7e6;border-radius:10px;padding:14px;font-size:14px"><b>Mensaje de la farmacia:</b><br>${esc(note)}</div>` : ''}
    ${extraHtml || button(s, link, 'Seguir mi pedido')}
    ${itemsTable(order)}`);
  const subject = order.status === 'entregado' && order.arrival_code
    ? `📬 ¡Tu pedido #${order.id} llegó! Guardá tu código de llegada - ${s.name}`
    : `${st.emoji} Pedido #${order.id}: ${st.label} - ${s.name}`;
  send(order.email, subject, html);
}

function sendContactNotice(msg) {
  const s = getSettings();
  const adminTo = process.env.ADMIN_EMAIL || s.email;
  if (!adminTo) return;
  send(adminTo, `💬 Nueva consulta de ${msg.name}`, layout(s, `
    <h2>Nueva consulta desde la web</h2>
    <p><b>${esc(msg.name)}</b> · ${esc(msg.email)} · ${esc(msg.phone)}</p>
    <p style="white-space:pre-wrap">${esc(msg.message)}</p>`));
}

module.exports = { STATUS, sendOrderCreated, sendStatusChanged, sendContactNotice, baseUrl, send, layout, button, money, esc, hasSMTP: () => !!transporter };
