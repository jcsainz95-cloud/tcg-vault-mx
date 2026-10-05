import { MailMessage } from '../../mail/mail.port';
import {
  appUrl,
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  monoRow,
  proseRow,
  ruleRow,
  smallPrintRow,
  spacerRow,
  supportEmail,
} from '../../buylist/mail-shell';
import { formatDateTime } from '../../buylist/buylist-mail.templates';

/**
 * # Plantillas LOCALES al módulo `shipments` — los avisos `AV-4`, `AV-5` y `AV-6` (§R.3, v1.74)
 *
 * `ARCHITECTURE §4.54.5`: **cada aviso vive en el módulo dueño del hecho**, y ⛔ **no se toca `mail/`
 * por dentro** — `shipments` inyecta el puerto global `MAIL_PORT` (`@Optional()`) y renderiza aquí,
 * exactamente como hicieron `buylist` (v1.18) y `orders` (v1.21). **§4.11 no cambia.**
 *
 * ## ⚠️ El esqueleto se REUSA, no se estrena
 * Los bloques vienen de `buylist/mail-shell.ts` (`DESIGN_SYSTEM §31`), que es el esqueleto de los
 * correos que ya funcionan. **Estrenar un tercer estilo de correo era la alternativa, y es peor**:
 * §31 existe justo para que todos se hablen. *El import cruza el límite de módulo y eso se dice en
 * voz alta*: el sitio correcto del esqueleto es `src/common/`, y moverlo es el **pase 2 de §31.15**
 * (deuda **BE-43**), que necesita la zona compartida y por tanto **no se hace en este pase**.
 * Queda anotado en `BACKEND_NOTES` para que lo decida el arquitecto/techlead, no de paso.
 *
 * ## ⛔ PROHIBICIONES DE CONTENIDO (§R.8), y por qué estos tres las cumplen POR CONSTRUCCIÓN
 * **Ninguno de los tres lleva un solo importe.** Es la forma más fuerte de cumplir los criterios
 * **207** (*ningún aviso inventa una cifra*), **208** (*cero afirmaciones jurídicas*), **209**
 * (⛔ `ivaTransferPct` no viaja a ninguna superficie de cliente) y **201** (*ni topes ni umbrales*):
 * *no se puede filtrar un dial desde un correo que no renderiza la orden.* ⚠️ **Y el riesgo era
 * concreto**: `Order.ivaTransferPct` y `ShipmentRequest.ivaTransferPct` son columnas de la fila, así
 * que un correo que renderizara «el envío» **lo filtraría sin que nadie lo escribiera**. Estas
 * plantillas reciben **campos sueltos**, nunca la fila.
 * ⛔ Tampoco viaja el **domicilio** (ni el `addressSnapshot`, ni una parte de él): el destinatario se
 * resuelve **por id** (§R.5) y el correo no repite a dónde va.
 *
 * ## ⭐ v1.81 (D2e, §M4-SHIP.19.12) — «ENTREGADO» EXISTE, PERO SOLO CON LA PALABRA DEL TRANSPORTISTA
 * El criterio **210** se reescribió: con guía **manual** siguen siendo **dos correos de envío (guía y
 * salida) y NINGUNO al entregar** (`C-AV-3a`, intacto: `updateStatus` sigue sin rama de `entregado`).
 * Con guía de **Skydropx** la paquetería confirma la entrega y entonces sí sale `AV-17` (`C-AV-3b`),
 * más `AV-18` (en sucursal) y `AV-19` (intento fallido). ⛔ **Ninguno de los tres cuelga de
 * `updateStatus`**: los dispara `applyCarrierStatus` (post-commit) por el puerto `CARRIER_NOTICES`, con
 * su sello propio (`deliveredNoticeSentAt`, `branchNoticeSentAt`, `lastDeliveryAttemptAt`).
 * ⛔ Ninguno anuncia un plazo ni la palabra «disputa» (`HECHOS.md:52`, DESIGN_SYSTEM §43.12).
 *
 * ## ⭐ D2e — el enlace y la liga de rastreo los decide el SERVICIO, no la plantilla
 * `customerUrl` lo resuelve el servicio (§19.12, PS-87); la plantilla solo lo pinta. `trackingUrl` viaja
 * **solo** si Skydropx la dio y pasó `assertProviderUrl` (PS-88): ⛔ ninguna plantilla construye una URL
 * con la guía (`C-SDX-6`), y va como letra chica con la URL visible (§41.4: un solo CTA).
 */

type Locale = 'es' | 'en';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

const BRAND = 'TCG HUNT';

/** §31.6h — la única línea variable del pie, compartida por los tres avisos de envío. */
function shipmentFooterWhy(en: boolean): string {
  return en
    ? 'You are receiving this email because you have a shipment with us.'
    : 'Recibes este correo porque tienes un envío con nosotros.';
}

export interface ShipmentNoticeParams {
  /** Folio del envío: la llave con la que escribirá a soporte. */
  shipmentId: string;
  /** Número de pedido, si el envío fulfilla uno. `null` en un retiro de bóveda. */
  orderNumber?: string | null;
  /**
   * `Order.id` del pedido que fulfilla el envío, **solo si el destinatario es el titular
   * registrado**. `null` con `orderNumber` presente = pedido de invitado ⇒ **sin CTA** (el detalle
   * del pedido exige sesión y el invitado no tiene cuenta).
   */
  orderId?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  /**
   * ⭐ D2e (§19.12, PS-87) — el enlace del CTA, RESUELTO POR EL SERVICIO (retiro ⇒ `shipments/<id>`; registrado ⇒
   * `orders/<id>`; invitado ⇒ `pedido?token=…`). `null` ⇒ sin CTA. `undefined` ⇒ la ruta por defecto de
   * {@link shipmentUrl} (llamadores que aún no pasan por el servicio: las pruebas de plantilla de antes de D2e).
   */
  customerUrl?: string | null;
  /** ⭐ D2e (PS-88) — la liga de rastreo de la paquetería, SOLO si Skydropx la dio (ya validada al escribirla). */
  trackingUrl?: string | null;
}

/**
 * Enlace a la superficie donde el dato SIEMPRE está (la red de seguridad de `D-AVISO-2`).
 *
 * ⚠️ Antes apuntaba a `cuenta/pedidos` / `boveda/envios`, que **no existen** en el storefront (404
 * medido en clientes reales). Las rutas reales son `orders/[orderId]` y `shipments/[id]`; el candado
 * `test/mail-links.frontend-routes.spec.ts` lee el árbol del front y falla si alguna desaparece.
 *  - Envío de un pedido ⇒ detalle del pedido (el envío de un pedido de cliente registrado no es
 *    legible en `GET /shipments/:id`: su `userId` va en la orden, no en el envío).
 *  - Retiro de bóveda ⇒ detalle del envío.
 */
function shipmentUrl(params: ShipmentNoticeParams, locale: Locale): string | undefined {
  if (params.customerUrl !== undefined) return params.customerUrl ?? undefined;
  if (params.orderNumber) {
    return params.orderId ? appUrl(`orders/${encodeURIComponent(params.orderId)}`, locale) : undefined;
  }
  return appUrl(`shipments/${encodeURIComponent(params.shipmentId)}`, locale);
}

/** Eyebrow: el folio del envío, o el número de pedido si lo hay. Ya en MAYÚSCULAS (§31.2). */
function eyebrow(params: ShipmentNoticeParams, en: boolean): string {
  return params.orderNumber ? (en ? 'YOUR ORDER' : 'TU PEDIDO') : en ? 'YOUR SHIPMENT' : 'TU ENVÍO';
}

function folio(params: ShipmentNoticeParams): string {
  return params.orderNumber ?? params.shipmentId;
}

/**
 * ⭐ D2e (§43.12) — la frase de soporte, escrita UNA vez para `AV-17/18/19`: pedido ⇒ «¿Problema con tu pedido?» con el
 * número; retiro ⇒ «¿Problema con tu envío?» con la referencia (el folio). `{soporte}` = `supportEmail()`, la MISMA cascada
 * que el pie (⛔ dos buzones). Va en la PROSA, ⛔ no en el pie (§31.6h: en el pie no vive nada que el lector necesite).
 */
function supportLine(params: ShipmentNoticeParams, en: boolean): string {
  const to = supportEmail();
  if (params.orderNumber) {
    return en
      ? `Problem with your order? Write to ${to} with your order number ${params.orderNumber} and, if needed, photos.`
      : `¿Problema con tu pedido? Escríbenos a ${to} con tu número de pedido ${params.orderNumber} y, si hace falta, fotos.`;
  }
  return en
    ? `Problem with your shipment? Write to ${to} with reference ${params.shipmentId} and, if needed, photos.`
    : `¿Problema con tu envío? Escríbenos a ${to} con la referencia ${params.shipmentId} y, si hace falta, fotos.`;
}

/** §41.7 regla ✏ del 18: `Paquetería: <c> · Guía: <n>`; sin `carrier` ⇒ `Guía: <n>`; sin número ⇒ nada. */
function carrierDato(params: ShipmentNoticeParams, en: boolean): string {
  if (!params.trackingNumber) return '';
  if (!params.carrier) return en ? `Tracking: ${params.trackingNumber}` : `Guía: ${params.trackingNumber}`;
  return en
    ? `Carrier: ${params.carrier} · Tracking: ${params.trackingNumber}`
    : `Paquetería: ${params.carrier} · Guía: ${params.trackingNumber}`;
}

/** La liga de rastreo como letra chica (§43.12b–c); `null` ⇒ ninguna. ⛔ Nunca construida con la guía (`C-SDX-6`). */
function trackLine(params: ShipmentNoticeParams, en: boolean): string {
  if (!params.trackingUrl) return '';
  return en ? `Track my package with the carrier: ${params.trackingUrl}` : `Rastrear mi paquete en la paquetería: ${params.trackingUrl}`;
}

function ctaLabelOf(params: ShipmentNoticeParams, en: boolean): string {
  return params.orderNumber ? (en ? 'SEE MY ORDER' : 'VER MI PEDIDO') : en ? 'SEE MY SHIPMENT' : 'VER MI ENVÍO';
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * El esqueleto común de `AV-17/18/19` (§43.12: familia ENVÍO, sin saludo, sin importes, un CTA): eyebrow, titular = asunto,
 * prosas, dato, frase de soporte, letra chica de rastreo, CTA. La parte de texto a paridad (§31.12).
 */
function carrierNotice(
  params: ShipmentNoticeParams,
  l: Locale,
  title: string,
  proses: string[],
  track: string,
): Omit<MailMessage, 'to'> {
  const en = l === 'en';
  const dato = carrierDato(params, en);
  const soporte = supportLine(params, en);
  const url = shipmentUrl(params, l);
  const blocks = [
    eyebrowRow(eyebrow(params, en), folio(params)),
    headingRow(title, 22),
    spacerRow(24),
    ...proses.flatMap((p, i) => (i === 0 ? [proseRow(p)] : [spacerRow(16), proseRow(p)])),
    ...(dato ? [spacerRow(24), ruleRow(), spacerRow(24), monoRow(dato)] : []),
    spacerRow(24),
    proseRow(soporte),
    ...(track ? [spacerRow(16), smallPrintRow(track)] : []),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabelOf(params, en), 'ink')] : []),
  ];
  return {
    subject: title,
    html: mailShell({ locale: l, title, preheader: `${title}. ${proses[0]}`, blocks, footerWhy: shipmentFooterWhy(en) }),
    text: [title, '', ...proses.flatMap((p) => [p, '']), ...(dato ? [dato, ''] : []), soporte, ...(track ? ['', track] : []), ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

/**
 * **`AV-4` — LA GUÍA, CON SU NÚMERO** (criterios **198** y **199**; §R.3.a).
 *
 * ⭐⭐ **Cuelga de `setTracking`, JAMÁS del estado `guia`**, y ése es el punto entero: `PATCH
 * /admin/shipments/:id/status { to:'guia' }` es legal desde `picking` y deja `carrier` y
 * `trackingNumber` en `null` ⇒ colgar este correo del estado mandaría **«aquí está tu guía» sin
 * número**, que es el criterio 198 servido al revés.
 * ⇒ **Esta plantilla EXIGE los dos datos** (no son opcionales en su tipo): si no hay etiqueta, no hay
 * correo de guía. *Un aviso que no puede afirmar su dato no se manda.*
 */
export function shipmentGuideTemplate(
  params: ShipmentNoticeParams & { carrier: string; trackingNumber: string },
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'Your package has a tracking number' : 'Tu paquete ya tiene guía';
  const intro = en
    ? 'We prepared your package and it already has a carrier and a tracking number.'
    : 'Preparamos tu paquete y ya tiene paquetería y número de guía.';
  // §31.6c/§25.4.3 — el dato que se COPIA va en mono seleccionable, no en prosa: es donde se
  // distingue un `0` de una `O`, y es lo que el cliente va a teclear en la web de la paquetería.
  const dato = en
    ? `Carrier: ${params.carrier} · Tracking: ${params.trackingNumber}`
    : `Paquetería: ${params.carrier} · Guía: ${params.trackingNumber}`;
  const nota = en
    ? 'The carrier may take a few hours to show movement on this number.'
    : 'La paquetería puede tardar unas horas en mostrar movimiento con este número.';
  // ⭐ D2e (§19.12, PS-88): la liga de rastreo SOLO si Skydropx la dio; letra chica (un solo CTA, §41.4).
  const track = trackLine(params, en);
  const url = shipmentUrl(params, l);
  const ctaLabel = en ? 'SEE MY SHIPMENT' : 'VER MI ENVÍO';
  const blocks = [
    eyebrowRow(eyebrow(params, en), folio(params)),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(24),
    monoRow(dato),
    spacerRow(24),
    smallPrintRow(nota),
    ...(track ? [spacerRow(16), smallPrintRow(track)] : []),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your tracking number` : `${BRAND} — Tu guía de envío`,
    html: mailShell({ locale: l, title, preheader: `${title}. ${dato}`, blocks, footerWhy: shipmentFooterWhy(en) }),
    text: [`${title}`, '', intro, '', dato, '', nota, ...(track ? ['', track] : []), ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

/**
 * **`AV-5` — SALIÓ** (pregunta **74**: el dueño pidió **dos** correos, guía y salida).
 *
 * ⭐ **NO exige etiqueta, y ⛔ no inventa un número.** Si el envío llegó a `enviado` por el camino
 * que no captura etiqueta (`D-AV-2`), el correo dice **que salió** y nada más; si la fila tiene
 * `carrier`/`trackingNumber`, los **repite tal cual** (criterio **207** en su lectura general).
 */
export function shipmentShippedTemplate(
  params: ShipmentNoticeParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'Your package is on its way' : 'Tu paquete va en camino';
  const intro = en
    ? 'Your package left our hands and is now with the carrier.'
    : 'Tu paquete salió de nuestras manos y ya va con la paquetería.';
  // ⛔ Si no hay número, NO se escribe una línea vacía ni un «—»: el dato no existe y no se finge.
  const dato =
    params.trackingNumber
      ? en
        ? `Carrier: ${params.carrier ?? ''} · Tracking: ${params.trackingNumber}`
        : `Paquetería: ${params.carrier ?? ''} · Guía: ${params.trackingNumber}`
      : '';
  // ⭐ D2e (§19.12, PS-88): ídem `AV-4`.
  const track = trackLine(params, en);
  const url = shipmentUrl(params, l);
  const ctaLabel = en ? 'SEE MY SHIPMENT' : 'VER MI ENVÍO';
  const blocks = [
    eyebrowRow(eyebrow(params, en), folio(params)),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    ...(dato ? [spacerRow(24), ruleRow(), spacerRow(24), monoRow(dato)] : []),
    ...(track ? [spacerRow(16), smallPrintRow(track)] : []),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your package is on its way` : `${BRAND} — Tu paquete va en camino`,
    html: mailShell({ locale: l, title, preheader: `${title}. ${intro}`, blocks, footerWhy: shipmentFooterWhy(en) }),
    text: [title, '', intro, ...(dato ? ['', dato] : []), ...(track ? ['', track] : []), ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

/**
 * **`AV-6` — CANCELADO.** *Su solicitud no procede: probablemente tenga que rehacerla* (`PROJECT §R.3`).
 *
 * ⛔ **No dice POR QUÉ se canceló**: el motivo de una cancelación operativa no está en la fila (no hay
 * columna), y **un aviso no inventa un dato que no tiene**. Dice el hecho y dónde preguntar.
 * ⛔ **Cero dinero**: si hubo cobro, lo que le devuelve el dinero es el reembolso (`AV-3`), que es
 * **otro hecho** con su propio correo. *Dos correos por un hecho es el defecto; un correo por hecho
 * es la regla.*
 */
export function shipmentCancelledTemplate(
  params: ShipmentNoticeParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'Your shipment was cancelled' : 'Tu envío quedó cancelado';
  const intro = en
    ? 'This shipment will not go out. Nothing left our warehouse.'
    : 'Este envío no va a salir. Nada salió de nuestro almacén.';
  const next = en
    ? 'If you still want your cards shipped, you can request it again from your account.'
    : 'Si todavía quieres que te enviemos tus cartas, puedes volver a solicitarlo desde tu cuenta.';
  const url = shipmentUrl(params, l);
  const ctaLabel = en ? 'GO TO MY ACCOUNT' : 'IR A MI CUENTA';
  const blocks = [
    eyebrowRow(eyebrow(params, en), folio(params)),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    spacerRow(16),
    proseRow(next),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your shipment was cancelled` : `${BRAND} — Tu envío quedó cancelado`,
    html: mailShell({ locale: l, title, preheader: `${title}. ${intro}`, blocks, footerWhy: shipmentFooterWhy(en) }),
    text: [title, '', intro, '', next, ...(url ? ['', url] : []), '', BRAND].join('\n'),
  };
}

/**
 * **`AV-17` — ENTREGADO, con la palabra del transportista** (§19.12, DESIGN_SYSTEM §43.12, ML-24).
 *
 * Lo dispara `applyCarrierStatus` con `delivered` (post-commit, sello `deliveredNoticeSentAt`, solo `labelSource='skydropx'`
 * por CHECK). ⛔ Nunca la marca a mano (criterio 210.b, `C-AV-3a`). La fecha es la del transportista (`carrierStatusAt`).
 * ⛔ Sin plazo de disputa ni la palabra (`HECHOS.md:50/52`): lleva «¿Problema con tu pedido? Escríbenos».
 */
export function shipmentDeliveredTemplate(
  params: ShipmentNoticeParams & { carrierStatusAt?: Date | string | null },
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const at = asDate(params.carrierStatusAt);
  const prose = at
    ? en
      ? `The carrier confirmed delivery on ${formatDateTime(at, l)}.`
      : `La paquetería confirmó la entrega el ${formatDateTime(at, l)}.`
    : en
      ? 'The carrier confirmed your package was delivered.'
      : 'La paquetería confirmó la entrega de tu paquete.';
  const track = params.trackingUrl ? (en ? `Tracking with the carrier: ${params.trackingUrl}` : `Rastreo en la paquetería: ${params.trackingUrl}`) : '';
  return carrierNotice(params, l, en ? 'Your package was delivered' : 'Tu paquete fue entregado', [prose], track);
}

/**
 * **`AV-18` — EN SUCURSAL** (§19.12, §19.20.6, DESIGN_SYSTEM §43.12b, ML-25). `delivered_to_branch` (⛔ el envío NO pasa a
 * `entregado`); una vez por envío (sello `branchNoticeSentAt`). `branchName` tal cual lo dio Skydropx (escapado por el shell).
 * ⛔ Sin dirección, horario ni plazo para recoger: el contrato no los da.
 */
export function shipmentAtBranchTemplate(
  params: ShipmentNoticeParams & { branchName?: string | null },
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const branch = params.branchName?.trim() || null;
  const p1 = branch
    ? en
      ? `The carrier left your package at the ${branch} branch. To get it, you need to pick it up there.`
      : `La paquetería dejó tu paquete en la sucursal ${branch}. Para recibirlo, tienes que pasar a recogerlo ahí.`
    : en
      ? 'The carrier left your package at one of its branches. To get it, you need to pick it up there.'
      : 'La paquetería dejó tu paquete en una de sus sucursales. Para recibirlo, tienes que pasar a recogerlo.';
  const p2 = params.carrier
    ? en
      ? `If you don't know which branch it is or its opening hours, ask ${params.carrier} with your tracking number.`
      : `Si no sabes cuál es la sucursal o su horario, pregúntale a ${params.carrier} con tu número de guía.`
    : en
      ? "If you don't know which branch it is or its opening hours, ask the carrier with your tracking number."
      : 'Si no sabes cuál es la sucursal o su horario, pregúntale a la paquetería con tu número de guía.';
  return carrierNotice(params, l, en ? 'Your package is at the branch' : 'Tu paquete está en sucursal', [p1, p2], trackLine(params, en));
}

/**
 * **`AV-19` — INTENTARON ENTREGARTE** (§19.12, §19.20.6, DESIGN_SYSTEM §43.12c, ML-26). `delivery_attempt`; UNO POR INTENTO
 * (sello `lastDeliveryAttemptAt` reclamado con `< occurredAt`). `attemptAt` = el `occurredAt` del intento. El asunto NO cambia
 * entre intentos (⛔ sin contador: el contrato da un sello, no una cuenta). ⛔ Sin motivo, plazo ni teléfono.
 */
export function shipmentDeliveryAttemptTemplate(
  params: ShipmentNoticeParams & { attemptAt?: Date | string | null },
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const at = asDate(params.attemptAt);
  const p1 = at
    ? en
      ? `The carrier tried to deliver your package on ${formatDateTime(at, l)} and couldn't.`
      : `La paquetería intentó entregar tu paquete el ${formatDateTime(at, l)} y no pudo.`
    : en
      ? "The carrier tried to deliver your package and couldn't."
      : 'La paquetería intentó entregar tu paquete y no pudo.';
  const p2 = params.carrier
    ? en
      ? `Contact ${params.carrier} with your tracking number to arrange another delivery.`
      : `Comunícate con ${params.carrier} con tu número de guía para acordar otra entrega.`
    : en
      ? 'Contact the carrier with your tracking number to arrange another delivery.'
      : 'Comunícate con la paquetería con tu número de guía para acordar otra entrega.';
  return carrierNotice(params, l, en ? 'The carrier tried to deliver your package' : 'La paquetería intentó entregar tu paquete', [p1, p2], trackLine(params, en));
}
