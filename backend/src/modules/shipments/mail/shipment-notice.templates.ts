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
} from '../../buylist/mail-shell';

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
 * ## ⛔ Y NO HAY PLANTILLA DE «ENTREGADO»
 * Es el criterio **210**, confirmado explícitamente por el dueño: **dos correos de envío (guía y
 * salida) y NINGUNO al entregar**. Su ausencia aquí es la mitad que se verifica **por exceso**
 * (`test/avisos.shipments.spec.ts` § «C-AV-3»). *No se añade «porque parecía razonable».*
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
  carrier?: string | null;
  trackingNumber?: string | null;
}

/** Enlace a la superficie donde el dato SIEMPRE está (la red de seguridad de `D-AVISO-2`). */
function shipmentUrl(params: ShipmentNoticeParams, locale: Locale): string | undefined {
  return params.orderNumber ? appUrl('cuenta/pedidos', locale) : appUrl('boveda/envios', locale);
}

/** Eyebrow: el folio del envío, o el número de pedido si lo hay. Ya en MAYÚSCULAS (§31.2). */
function eyebrow(params: ShipmentNoticeParams, en: boolean): string {
  return params.orderNumber ? (en ? 'YOUR ORDER' : 'TU PEDIDO') : en ? 'YOUR SHIPMENT' : 'TU ENVÍO';
}

function folio(params: ShipmentNoticeParams): string {
  return params.orderNumber ?? params.shipmentId;
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
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your tracking number` : `${BRAND} — Tu guía de envío`,
    html: mailShell({ locale: l, title, preheader: `${title}. ${dato}`, blocks, footerWhy: shipmentFooterWhy(en) }),
    text: [`${title}`, '', intro, '', dato, '', nota, ...(url ? ['', url] : []), '', BRAND].join('\n'),
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
  const url = shipmentUrl(params, l);
  const ctaLabel = en ? 'SEE MY SHIPMENT' : 'VER MI ENVÍO';
  const blocks = [
    eyebrowRow(eyebrow(params, en), folio(params)),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    ...(dato ? [spacerRow(24), ruleRow(), spacerRow(24), monoRow(dato)] : []),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en ? `${BRAND} — Your package is on its way` : `${BRAND} — Tu paquete va en camino`,
    html: mailShell({ locale: l, title, preheader: `${title}. ${intro}`, blocks, footerWhy: shipmentFooterWhy(en) }),
    text: [title, '', intro, ...(dato ? ['', dato] : []), ...(url ? ['', url] : []), '', BRAND].join('\n'),
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
