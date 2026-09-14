import { MailMessage } from '../mail/mail.port';
import {
  ctaRows,
  deadlineRow,
  eyebrowRow,
  headingRow,
  mailShell,
  monoRow,
  proseRow,
  ruleRow,
  smallPrintRow,
  spacerRow,
  totalsRows,
} from './mail-shell';
import { buylistPortalUrl, formatDateTime, money } from './buylist-mail.templates';

/**
 * # Los TRES avisos nuevos del ciclo de venta — `AV-7`, `AV-8` y `AV-9` (§R.3, v1.74)
 *
 * ## ⚠️ Por qué un fichero NUEVO y no tres funciones más en `buylist-mail.templates.ts`
 * Aquel fichero tiene un candado de **exhaustividad** (`test/buylist.cycle-mail-pii.spec.ts`): toda
 * plantilla que exporte debe estar clasificada como **del ciclo de oferta** (son cinco, criterio
 * 173(h)) o **fuera de él**. Los tres de aquí **no son del ciclo de la oferta** —son la guía, el
 * acuse y el pago—, así que meterlos allí obligaría a aflojar la cuenta de cinco, que es
 * exactamente la aserción que impide que la lista deje de vigilarse a sí misma.
 * ⭐ **Y lo prohibido se les busca igual, en los ONCE a la vez**: `test/avisos.copy-guard.spec.ts`
 * (candado `C-AV-9`) barre estas tres **y las ocho de los otros módulos**, y es **exhaustivo sobre
 * los exports** de los cinco ficheros de avisos — una plantilla nueva rompe ese test hasta que
 * alguien la clasifique. *El agujero no se cierra tapando el que apareció.*
 *
 * ## ⛔ LOS CINCO PROHIBIDOS siguen aplicando, íntegros (`PROJECT §P.3`, criterio 173(h))
 * **(1) domicilio · (2) CLABE, ni enmascarada · (3) datos de terceros · (4) montos o estado de OTRAS
 * solicitudes · (5) cifras internas de la mesa** (posición, sugerencia, topes del operador).
 * **Y los de §R.8** encima: ⛔ ninguna cifra inventada, ⛔ cero vocabulario del traslado del IVA,
 * ⛔ `ivaTransferPct` jamás, ⛔ ningún tope ni umbral (criterio **201**).
 *
 * ## ⛔ Y LA PROHIBICIÓN NÚMERO UNO DE TODO §R
 * Ninguno de los tres menciona, insinúa ni depende de `SellOfferState`. `pending_authorization` es
 * **admin-only** —*«EL CLIENTE NO DEBE ENTERARSE DE QUE EXISTE […] le filtraría el orden de magnitud
 * de nuestro tope»*, `schema.prisma`— y aquí no hay ninguna rama que lo lea. Candado `C-AV-8`.
 */

type Locale = 'es' | 'en';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

const BRAND = 'TCG HUNT';

/**
 * §31.6h — la línea del «por qué recibes esto». **La misma que ya usan los seis correos del ciclo**:
 * el hecho que origina los nueve es idéntico —*hay una solicitud de venta*— y si dos correos del
 * mismo ciclo explicaran distinto por qué llegan, «que todos se hablen» dejaría de ser cierto justo
 * en la línea que no cambia nunca.
 */
function sellRequestFooterWhy(en: boolean): string {
  return en
    ? 'You are receiving this email because you have a sell request with us.'
    : 'Recibes este correo porque tienes una solicitud de venta con nosotros.';
}

export interface SellGuideParams {
  folio: string;
  carrier: string;
  trackingNumber: string;
  /** Plazo de envío YA congelado en la fila. `null` ⇒ ⛔ no se inventa ninguna fecha. */
  shipDeadlineAt: Date | null;
  portalUrl?: string;
}

/**
 * **`AV-7` — AQUÍ VA TU GUÍA** (el segundo que más duele, `PROJECT §R.3`).
 *
 * Medido antes de escribirlo: `adminGuide` **capturaba transportista y número y lo auditaba**, y
 * **no existía ninguna plantilla que se lo mandara** ⇒ el vendedor no podía saber que su etiqueta
 * prepagada existe, **y encima corría contra un plazo de envío que el sistema sí vigila**.
 *
 * ### Lo que lleva, y por qué exactamente eso
 * - **La etiqueta** (paquetería + número), en mono seleccionable: es el dato que va a teclear.
 * - **El plazo, con FECHA Y HORA** en `America/Mexico_City` (criterios **154** y **161(d)**), y
 *   **reusando `formatDateTime`**, que es el MISMO formateador de la pantalla y del recordatorio del
 *   barrido. ⛔ *No se escribe un segundo formateador: el correo y la pantalla dicen el mismo string.*
 * - ⛔ **Ni un importe.** El neto vinculante ya se lo dijo el correo de la oferta y se lo repite el
 *   recordatorio; repetirlo aquí **con otra resta** sería releerlo como una oferta nueva, que es la
 *   propiedad que este ciclo más protege.
 * - ⛔ **Ni el domicilio de recogida** (§R.8 fila 7), aunque sea «suyo»: es el dato del hallazgo B-1.
 *
 * **Una sola vez:** el sello `guideNoticeSentAt`, que se limpia **solo si el par
 * `(carrier, trackingNumber)` cambia** (§R.4.b) — `adminGuide` es **re-capturable a propósito**
 * («se corrige el número, NO se mueve la fecha»), así que sin sello cada corrección mandaría otro
 * correo idéntico.
 */
export function sellGuideTemplate(
  params: SellGuideParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'Your prepaid label is ready' : 'Tu guía prepagada ya está lista';
  const intro = en
    ? 'We already paid for the label. Drop the package off with the carrier below.'
    : 'La guía ya está pagada por nosotros. Entrega el paquete en la paquetería de abajo.';
  const dato = en
    ? `Carrier: ${params.carrier} · Tracking: ${params.trackingNumber}`
    : `Paquetería: ${params.carrier} · Guía: ${params.trackingNumber}`;
  const deadline = params.shipDeadlineAt ? formatDateTime(params.shipDeadlineAt, l) : '';
  const deadlinePre = en ? 'You have until ' : 'Tienes hasta el ';
  const deadlinePost = en ? ' to drop it off.' : ' para depositarlo.';
  const alreadySent = en
    ? 'If you already dropped it off, tell us from your account and we stop the clock.'
    : 'Si ya lo depositaste, avísanos desde tu cuenta y detenemos el reloj.';
  const ctaLabel = en ? 'GO TO MY REQUEST' : 'IR A MI SOLICITUD';
  const blocks = [
    eyebrowRow(en ? 'YOUR SELL REQUEST' : 'TU SOLICITUD DE VENTA', params.folio),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}:`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(24),
    monoRow(dato),
    // ⛔ Sin plazo congelado no se pinta ninguna fecha: *un aviso no inventa un dato que no tiene*.
    ...(deadline ? [spacerRow(24), deadlineRow(deadlinePre, deadline, deadlinePost)] : []),
    spacerRow(24),
    smallPrintRow(alreadySent),
    spacerRow(32),
    ...(params.portalUrl
      ? [ctaRows(params.portalUrl, ctaLabel, 'accent')]
      : [proseRow(en ? 'Sign in to your account to continue.' : 'Entra a tu cuenta para continuar.')]),
  ];
  return {
    to: '',
    subject: en ? `${BRAND} — Your prepaid label` : `${BRAND} — Tu guía prepagada`,
    html: mailShell({
      locale: l,
      title,
      preheader: `${title}. ${dato}`,
      blocks,
      footerWhy: sellRequestFooterWhy(en),
    }),
    text: [
      `${en ? 'Hi' : 'Hola'} ${name}:`,
      '',
      title,
      '',
      intro,
      '',
      dato,
      ...(deadline ? ['', `${deadlinePre}${deadline}${deadlinePost}`] : []),
      '',
      alreadySent,
      ...(params.portalUrl ? ['', params.portalUrl] : []),
      '',
      BRAND,
    ].join('\n'),
  };
}

export interface SellReceivedParams {
  folio: string;
  portalUrl?: string;
}

/**
 * **`AV-8` — ACUSE DE RECIBIDO** (pregunta **75**: el dueño lo pidió, contra el borrador).
 *
 * *«Es el momento de máxima ansiedad del vendedor —acaba de mandar cartas caras por paquetería— y
 * no puede saber que llegaron.»*
 *
 * ### ⛔ Criterio **211**: NO adelanta NINGÚN veredicto ni NINGUNA cifra
 * La verificación **aún no ha ocurrido**. Este correo dice **dos cosas y solo dos**: que llegaron y
 * que están en revisión. ⛔ Ni un importe, ni «todo se ve bien», ni cuántas piezas entran — todo eso
 * es deliberación interna que todavía no existe, y anticiparla crea una expectativa que la
 * verificación tendría que romper.
 * **Una sola vez, sin estrenar columna:** la guarda del motor de `receive` (`stepWhere('receive')` +
 * `count === 1` + `sealOnceTx('receivedAt')`) — la repetición idempotente **no transiciona**, así que
 * no llega aquí.
 */
export function sellReceivedTemplate(
  params: SellReceivedParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'Your cards arrived' : 'Tus cartas llegaron';
  const intro = en
    ? 'We received your package and your cards are now in review.'
    : 'Recibimos tu paquete y tus cartas ya están en revisión.';
  // ⛔ Ni veredicto ni cifra (criterio 211). Lo único que se promete es que habrá noticia.
  const next = en
    ? 'We will write to you again when the review is done.'
    : 'Te escribimos otra vez cuando termine la revisión.';
  const ctaLabel = en ? 'GO TO MY REQUEST' : 'IR A MI SOLICITUD';
  const blocks = [
    eyebrowRow(en ? 'YOUR SELL REQUEST' : 'TU SOLICITUD DE VENTA', params.folio),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}:`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(16),
    proseRow(next),
    spacerRow(32),
    ...(params.portalUrl ? [ctaRows(params.portalUrl, ctaLabel, 'ink')] : []),
  ];
  return {
    to: '',
    subject: en ? `${BRAND} — Your cards arrived` : `${BRAND} — Tus cartas llegaron`,
    html: mailShell({
      locale: l,
      title,
      preheader: `${title}. ${intro}`,
      blocks,
      footerWhy: sellRequestFooterWhy(en),
    }),
    text: [
      `${en ? 'Hi' : 'Hola'} ${name}:`,
      '',
      title,
      '',
      intro,
      '',
      next,
      ...(params.portalUrl ? ['', params.portalUrl] : []),
      '',
      BRAND,
    ].join('\n'),
  };
}

export interface SellPaidParams {
  folio: string;
  /** ⭐ LA COLUMNA PERSISTIDA `payoutNetCents`, leída tras el commit. ⛔ Jamás una resta recalculada. */
  payoutNetCents: number;
  speiReference: string;
  portalUrl?: string;
}

/**
 * **`AV-9` — SE TE PAGÓ.** *Se movió su dinero* (`PROJECT §R.3`), y medido: **no había plantilla de
 * pago** entre las seis del ciclo.
 *
 * ### ⭐ Criterio **207**, en su forma más estricta, porque esto es DINERO SALIENTE
 * El importe que viaja es **`payoutNetCents` leído de la fila después del commit** — la MISMA
 * columna que alimenta M7 y la pantalla. ⛔ **No se recalcula** `bruto − envío` aquí: ese cálculo ya
 * lo hizo la transacción del pago con la lectura releída (B-2), y repetirlo en una plantilla sería
 * **una segunda fuente para una cifra de dinero**, que es la clase de defecto que este proyecto paga
 * más caro. Si la resta de la plantilla y la de la transacción discreparan un centavo, el correo
 * sería el que mintiera.
 * ⛔ **Y no se desglosa nada**: ni bruto, ni envío, ni IVA. El neto es lo vinculante y es lo que se
 * depositó (criterio **208**: cero afirmaciones jurídicas; §R.8 fila 2: ⛔ nada de convenciones).
 * ⛔ **La CLABE NO viaja, ni enmascarada** (§R.8 fila 7): `reveal-clabe` sigue siendo el único punto
 * del contrato que devuelve una CLABE. La **referencia SPEI sí**: es el comprobante del movimiento y
 * es lo que le sirve para buscarlo en su banco.
 */
export function sellPaidTemplate(
  params: SellPaidParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We paid you' : 'Te pagamos';
  const intro = en
    ? 'We sent the transfer for your sell request. Your bank may take a few hours to show it.'
    : 'Mandamos la transferencia de tu solicitud de venta. Tu banco puede tardar unas horas en mostrarla.';
  const netLabel = en ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITARON';
  const netAmount = money(params.payoutNetCents, l);
  const ref = en
    ? `SPEI reference: ${params.speiReference}`
    : `Referencia SPEI: ${params.speiReference}`;
  const ctaLabel = en ? 'GO TO MY REQUEST' : 'IR A MI SOLICITUD';
  const blocks = [
    eyebrowRow(en ? 'YOUR SELL REQUEST' : 'TU SOLICITUD DE VENTA', params.folio),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}:`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(24),
    // La resta con la lista de sustraendos VACÍA: el neto conserva su regla de tinta, que es la
    // única del correo, y ⛔ no se reabre un desglose que ya se cerró al ofertar.
    totalsRows([], { label: netLabel, amount: netAmount }),
    spacerRow(24),
    monoRow(ref),
    spacerRow(32),
    ...(params.portalUrl ? [ctaRows(params.portalUrl, ctaLabel, 'ink')] : []),
  ];
  return {
    to: '',
    subject: en ? `${BRAND} — We paid you` : `${BRAND} — Te pagamos`,
    html: mailShell({
      locale: l,
      title,
      // §31.6a — R1: el preheader puede llevar el NETO (es el único monto vinculante) y nada más.
      preheader: `${title}. ${netLabel}: ${netAmount}`,
      blocks,
      footerWhy: sellRequestFooterWhy(en),
    }),
    text: [
      `${en ? 'Hi' : 'Hola'} ${name}:`,
      '',
      title,
      '',
      intro,
      '',
      `${netLabel}: ${netAmount}`,
      ref,
      ...(params.portalUrl ? ['', params.portalUrl] : []),
      '',
      BRAND,
    ].join('\n'),
  };
}

/** Re-export deliberado: los tres avisos usan el MISMO constructor de URL que los seis del ciclo. */
export { buylistPortalUrl };
