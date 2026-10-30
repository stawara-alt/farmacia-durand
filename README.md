# Farmacia Durand — Tienda online + panel de gestión

Sitio web completo para la farmacia (con la identidad visual de su Instagram: verde #038B37, logo cruz + D, "Desde 1916"): catálogo con fotos, carrito, compra con **transferencia o QR**, seguimiento del pedido por link, avisos por **email** en cada cambio de estado, y un **panel de administración** con pedidos, productos/stock, costos con IVA, importación desde **Mercado Libre** y **estadísticas** mensuales.

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
- Carrito → checkout con envío a domicilio **solo a las zonas habilitadas** (por defecto CABA, GBA 1er y 2do cordón, cada una con su costo y su "envío gratis desde") o retiro en el local.
- Pago por **transferencia** (alias/CBU con botón de copiar) o **QR** (sube la imagen del QR de Mercado Pago/MODO o se genera uno automáticamente). El cliente puede subir el comprobante.

### Seguimiento del pedido
- Al comprar, el cliente recibe un **email con el link** `/pedido/<código>` (y la farmacia recibe un aviso del pedido nuevo).
- Esa página muestra la barra de estado (Recibido → Aceptado → En preparación → En camino / Listo para retirar → Entregado), el historial y los datos de pago. Se actualiza sola.
- Cada vez que la dueña cambia el estado, el cliente recibe **otro email** con el estado nuevo, un mensaje opcional y el mismo link.

### Panel de administración
- **Resumen**: pedidos por confirmar, en curso, ventas del mes, stock bajo y mensajes.
- **Pedidos**: filtros por estado, detalle con cliente, comprobante, ganancia del pedido y cambio de estado (con aviso por email). Si se cancela o rechaza, el stock vuelve solo.
- **Productos y stock**: alta/edición con varias fotos (botón **Buscar en Google Imágenes** con el nombre del producto; la foto se agrega pegándola con Ctrl+V, arrastrándola o pegando su link, y se guarda en la tienda; filtro *Solo sin foto*), categoría, marca, SKU, stock (+/−), destacado, oculto y bajo receta.
- **Costos y márgenes**: por producto se ve costo, costo de envío, IVA (%) y en $, **costo total con IVA**, precio, ganancia, margen y markup. También el stock valorizado y una calculadora de precio sugerido.
  *Costo total = (costo + envío por unidad) × (1 + IVA)*
- **Estadísticas** (3/6/12/24 meses): ventas, costo y ganancia, pedidos, unidades, ticket promedio, stock al cierre de cada mes (en unidades y valorizado), ventas por categoría, más vendidos, y evolución de **precio, ventas y stock** de cada producto.
- **Facturas de compra**: subís la factura del proveedor (PDF, foto o planilla) y se actualizan solos el **stock**, el **costo**, el **IVA**, el **flete** y el **precio de venta** de cada producto. Ver más abajo.
- **Promociones**: anuncios y descuentos que se muestran en la tienda, se aplican al precio y se envían por email a los suscriptores. Ver más abajo.
- **Reclamos**: reclamos post-compra con fotos y botón de arrepentimiento. Ver más abajo.
- **Importar**: desde **Mercado Libre** (con access token) o desde **CSV/Excel**. También se pueden exportar los productos.
- **Mensajes** del formulario de contacto.
- **Configuración**: nombre, textos, dirección, horarios, teléfonos, redes, logo, foto de portada, **colores**, datos bancarios, QR y costos de envío.

## Mercado Libre

1. Entrá a https://developers.mercadolibre.com.ar/devcenter con la cuenta de la farmacia y creá una aplicación.
2. Generá un *access token* (dura 6 horas; se genera uno nuevo cada vez que quieras sincronizar).
3. En **Panel → Importar** pegá el token (y opcionalmente el seller_id) y tocá *Importar*. Se traen nombre, precio, stock, fotos, categoría, marca y descripción. Si volvés a importar, se actualizan precio, stock y fotos, pero **los costos que cargaste no se tocan**.

Sin token: en Mercado Libre, *Publicaciones → Modificar en Excel → Descargar*, y subí ese **Excel (.xlsx) tal cual** en la misma pantalla. La primera vez crea los productos (marca y categoría deducidas del título; si algo está publicado dos veces en Mercado Libre deja uno visible y oculta el resto; los que no tienen precio quedan ocultos). Las siguientes veces solo actualiza **precio, stock e IVA**, sin pisar lo que se editó. Ese Excel no trae fotos ni costos: las fotos se traen después con la importación por token (que reconoce los productos por su número de publicación), se cargan a mano, o se guardan en `public/img/productos/` con su número de publicación en `fotos.json` (se ponen solas en los productos sin foto).

## Precio mínimo y costo de la página

En **Costos y márgenes** cada producto muestra, además del costo total con IVA y flete:
- **Costo de la página**: la parte del costo fijo mensual de la web (hosting, dominio, emails, lectura de facturas…) que le toca a cada unidad vendida, más el % de comisiones e impuestos sobre la venta (cobro con QR, Ingresos Brutos, etc.).
- **Precio mínimo** = (costo total + costo fijo por unidad) ÷ (1 − % de comisiones). Por debajo de ese precio, cada venta pierde plata; se marcan en rojo.
- **Ganancia neta** y **margen neto** después de todo eso.

El precio mínimo también aparece en la calculadora, al editar un producto y al revisar una factura de compra; el detalle de cada pedido muestra la ganancia neta. Los valores se configuran en **Configuración → Costos de la página**. El costo fijo se reparte entre las unidades vendidas por mes (automático según los últimos 3 meses, o un número fijo).

## Zonas de envío

En **Configuración → Zonas de envío** se definen las zonas (nombre, costo, envío gratis desde y lista de localidades/partidos) y se pueden activar o desactivar según lo que se arregle con la logística. En el checkout el cliente elige su localidad de una lista; si no está, solo puede retirar en la farmacia (o consultar por WhatsApp). El servidor también lo valida.

## Post-compra: código de llegada y reclamos

- Al marcar un pedido como **Entregado**, el cliente recibe el email **"Tu pedido llegó"** con un **código de llegada** (ej. `GCM-SAS`), el botón para reclamar y el **WhatsApp de la dueña** (Configuración → Post-compra).
- Con número de pedido + código de llegada, en `/reclamo` puede reclamar (llegó roto, equivocado, faltante, vencido u otro), pedir cambio o devolución y adjuntar hasta 5 fotos, dentro de los días configurados (10 por defecto). Sin código, la misma página le ofrece el WhatsApp.
- **Botón de arrepentimiento** (obligatorio para tiendas online en Argentina, Res. 424/2020): en el pie de la web; se identifica con número de pedido + email de la compra.
- En **Panel → Reclamos** la dueña ve fotos y conversación, cambia el estado (Nuevo / En revisión / Resuelto / Rechazado) y responde; el cliente recibe cada respuesta por email y la ve en la página de su pedido.

## Reparto (repartidor con el celular)

En el checkout el cliente elige cómo quiere recibir el envío: **en mano**, **al portero / encargado** o **en la puerta**.

1. **Panel → Reparto → Imprimir etiquetas**: una etiqueta por paquete con número de pedido, nombre, dirección, teléfono, cómo entregarlo, notas y un **QR**. (También desde cada pedido: *🏷️ Imprimir etiqueta*.)
2. El repartidor abre `/reparto` en su celular (el panel muestra el link y un QR) y entra con su nombre y el **PIN** (se cambia en Panel → Reparto).
3. **Escanea** la etiqueta con la cámara (o escribe el número de pedido): el pedido pasa de *En preparación* a **En camino** y al cliente le llega el email. Los pedidos sin pago confirmado no se pueden sacar.
4. Ve **cuántos pedidos lleva**, la **dirección** de cada uno en el **orden recomendado** (desde la farmacia, siempre al más cercano), los km aproximados, y botones para abrir el **recorrido en Google Maps**, llamar o escribir por WhatsApp.
5. Al entregar toca **✅ Entregado** (en mano / portero / puerta + nota): el cliente recibe el email con su **código de llegada**. Si no pudo, toca **No pude** con el motivo (no había nadie, dirección incorrecta, etc.): el pedido queda en *No entregado*, el cliente recibe un aviso y en el panel aparece para **volver a preparación**.

Las direcciones se ubican con OpenStreetMap (gratis); si no encuentra una, usa el centro de la localidad. Se puede desactivar con `GEOCODER=off`.

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
src/claims.js        Código de llegada, reclamos y botón de arrepentimiento
src/rules.js         Zonas de envío y precio mínimo (costo de la página)
src/delivery.js      Reparto: etiquetas con QR, escaneo, entregas y PIN del repartidor
src/geo.js           Ubicación de direcciones y recorrido recomendado
public/              Tienda (index.html), seguimiento (pedido.html), reclamos (reclamo.html), reparto (reparto.html), panel (admin.html)
scripts/seed.js      Datos de ejemplo
```
