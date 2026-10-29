# Farmacia Durand — Tienda online + panel de gestión

Sitio web completo para la farmacia: catálogo con fotos, carrito, compra con **transferencia o QR**, seguimiento del pedido por link, avisos por **email** en cada cambio de estado, y un **panel de administración** con pedidos, productos/stock, costos con IVA, importación desde **Mercado Libre** y **estadísticas** mensuales.

## Puesta en marcha

Hace falta Node.js 18 o más nuevo.

```bash
npm install
```

```bash
cp .env.example .env
```

Editá `.env` (contraseña del admin, datos SMTP para los mails y `BASE_URL` con el dominio real). Después:

```bash
npm start
```

- Tienda: http://localhost:3000
- Panel: http://localhost:3000/admin (usuario y contraseña de `.env`; por defecto `admin` / `farmacia123`)

Opcional: `npm run seed` carga 17 productos y un año de ventas de ejemplo para ver las estadísticas. **Borra los productos y pedidos existentes**, así que usalo solo para probar.

## Qué incluye

### Tienda (clientes)
- Portada con datos de la farmacia, servicios, horarios, mapa, redes (Instagram/Facebook/TikTok) y botón flotante de WhatsApp.
- Catálogo con buscador, categorías, orden por precio y ficha de producto con galería de fotos.
- Productos **bajo receta**: se muestran, pero en vez de comprarse online se consultan por WhatsApp.
- Carrito → checkout con envío a domicilio o retiro en el local (costo de envío y "envío gratis desde $X" configurables).
- Pago por **transferencia** (alias/CBU con botón de copiar) o **QR** (sube la imagen del QR de Mercado Pago/MODO o se genera uno automáticamente). El cliente puede subir el comprobante.

### Seguimiento del pedido
- Al comprar, el cliente recibe un **email con el link** `/pedido/<código>` (y la farmacia recibe un aviso del pedido nuevo).
- Esa página muestra la barra de estado (Recibido → Aceptado → En preparación → En camino / Listo para retirar → Entregado), el historial y los datos de pago. Se actualiza sola.
- Cada vez que la dueña cambia el estado, el cliente recibe **otro email** con el estado nuevo, un mensaje opcional y el mismo link.

### Panel de administración
- **Resumen**: pedidos por confirmar, en curso, ventas del mes, stock bajo y mensajes.
- **Pedidos**: filtros por estado, detalle con cliente, comprobante, ganancia del pedido y cambio de estado (con aviso por email). Si se cancela o rechaza, el stock vuelve solo.
- **Productos y stock**: alta/edición con varias fotos, categoría, marca, SKU, stock (+/−), destacado, oculto y bajo receta.
- **Costos y márgenes**: por producto se ve costo, costo de envío, IVA (%) y en $, **costo total con IVA**, precio, ganancia, margen y markup. También el stock valorizado y una calculadora de precio sugerido.
  *Costo total = (costo + envío por unidad) × (1 + IVA)*
- **Estadísticas** (3/6/12/24 meses): ventas, costo y ganancia, pedidos, unidades, ticket promedio, stock al cierre de cada mes (en unidades y valorizado), ventas por categoría, más vendidos, y evolución de **precio, ventas y stock** de cada producto.
- **Facturas de compra**: subís la factura del proveedor (PDF, foto o planilla) y se actualizan solos el **stock**, el **costo**, el **IVA**, el **flete** y el **precio de venta** de cada producto. Ver más abajo.
- **Promociones**: anuncios y descuentos que se muestran en la tienda, se aplican al precio y se envían por email a los suscriptores. Ver más abajo.
- **Importar**: desde **Mercado Libre** (con access token) o desde **CSV/Excel**. También se pueden exportar los productos.
- **Mensajes** del formulario de contacto.
- **Configuración**: nombre, textos, dirección, horarios, teléfonos, redes, logo, foto de portada, **colores**, datos bancarios, QR y costos de envío.

## Mercado Libre

1. Entrá a https://developers.mercadolibre.com.ar/devcenter con la cuenta de la farmacia y creá una aplicación.
2. Generá un *access token* (dura 6 horas; se genera uno nuevo cada vez que quieras sincronizar).
3. En **Panel → Importar** pegá el token (y opcionalmente el seller_id) y tocá *Importar*. Se traen nombre, precio, stock, fotos, categoría, marca y descripción. Si volvés a importar, se actualizan precio, stock y fotos, pero **los costos que cargaste no se tocan**.

Sin token: en Mercado Libre, *Publicaciones → Modificar en Excel*, guardá el archivo como CSV e importalo desde la misma pantalla.

## Promociones y suscriptores

En **Panel → Promociones** se crea una promoción con título, texto, etiqueta (ej. "20% OFF"), imagen y vigencia (desde/hasta):

- **Descuento real o solo anuncio**: con un % de descuento, mientras está vigente la tienda muestra el precio tachado y **cobra el precio con descuento** (a toda la tienda, a una categoría o a productos elegidos). Con 0% es solo un anuncio.
- Las promociones vigentes aparecen en la sección **Promociones** de la web, con un botón que filtra los productos incluidos.
- **Vista previa y envío**: muestra el email, permite mandarse una prueba y enviarlo a todos los suscriptores activos. El progreso se ve en la lista.
- Cada email trae su link para **darse de baja** (y el encabezado `List-Unsubscribe` para que Gmail muestre el botón de baja).

**Cómo se suscriben los clientes** (siempre con su consentimiento, como pide la Ley 25.326 de datos personales):
- Casilla *"Quiero recibir promociones y descuentos por email"* al finalizar la compra.
- Botón **Suscribirme** (un clic) en la página de seguimiento del pedido.
- Formulario en el pie de la web.

La lista de suscriptores se puede exportar a CSV. Los clientes que compraron antes **no** se suscriben solos.

**Límites de envío**: Gmail permite unos 500 emails por día desde una cuenta común. Si la lista crece, conviene un servicio de envío masivo (Brevo, Mailgun, Amazon SES): solo hay que cambiar los datos SMTP en `.env`. `MAIL_DELAY_MS` regula la pausa entre emails (por defecto 400 ms).

## Facturas de compra

En **Panel → Facturas de compra** subís (o arrastrás) la factura del proveedor:

- **PDF o foto**: la lee Claude (inteligencia artificial de Anthropic) y extrae proveedor, número, fecha, productos, cantidades, costos con bonificación, IVA, flete y percepciones. Requiere `ANTHROPIC_API_KEY` en `.env` (cada factura cuesta aprox. USD 0,05–0,15).
- **Planilla CSV** (sin costo): columnas `codigo, codigo_barras, descripcion, cantidad, costo, bonificacion, iva`.
- **A mano**: botón *Cargar a mano*.

Antes de aplicar, se muestra una pantalla de **revisión**:
- Cada línea se asocia a un producto de la tienda: por el código que usa ese proveedor (se aprende de facturas anteriores), por código de barras, por SKU o por nombre parecido. Se puede cambiar o elegir *Crear producto nuevo* (queda oculto en la tienda hasta que le cargues foto, salvo que marques *Publicar ya*).
- Muestra costo anterior → nuevo, precio anterior → nuevo, margen y stock resultante. Marca en amarillo los cambios de costo de más de 30%, que suelen ser errores de lectura o de cantidad.
- Controla que productos + flete + IVA + percepciones sumen el total de la factura.
- Regla de precio: **mantener el margen actual** de cada producto, **aplicar un % fijo** sobre el costo, o **no tocar precios**. Opción para no bajar precios si el costo bajó. Redondeo configurable.

Al aplicar: suma el stock, guarda costo neto, IVA y flete por unidad (el flete se reparte según el valor de cada línea), actualiza el precio y deja todo registrado en el historial (sirve para las estadísticas). La misma factura no se puede cargar dos veces. **Anular** una factura descuenta el stock que había sumado; los costos y precios no vuelven atrás.

## Emails

Configurá SMTP en `.env`. Con Gmail: activá la verificación en 2 pasos y creá una *contraseña de aplicación* para `SMTP_PASS`. Si no hay SMTP configurado, los mails se muestran en la consola del servidor (modo prueba).

## Publicarlo en internet

Es una app Node con base de datos SQLite (archivo en `data/`). Funciona en cualquier VPS o en servicios como Railway o Render **con disco persistente** montado en `data/` y `public/uploads/`. Definí `BASE_URL` con el dominio final (con `https://`) para que los links de los mails apunten bien.

## Estructura

```
src/server.js        API y páginas
src/db.js            Base de datos (SQLite) y configuración por defecto
src/mailer.js        Plantillas y envío de emails
src/mercadolibre.js  Importación desde Mercado Libre
src/purchases.js     Facturas de compra (lectura, reconocimiento de productos y actualización)
src/promotions.js    Promociones, descuentos, suscriptores y envío de emails
public/              Tienda (index.html), seguimiento (pedido.html), panel (admin.html)
scripts/seed.js      Datos de ejemplo
```
