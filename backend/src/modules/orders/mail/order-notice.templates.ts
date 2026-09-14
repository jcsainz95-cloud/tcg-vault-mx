import { MailMessage } from '../../mail/mail.port';
import {
  appUrl,
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  proseRow,
  ruleRow,
  sectionLabelRow,
  smallPrintRow,
  spacerRow,
  totalsRows,
} from '../../buylist/mail-shell';

/**
 * # Los avisos del PEDIDO — `AV-2` (liquidado, al REGISTRADO) y `AV-3` (reembolso) · §R.3, v1.74
 *
 * Plantillas **locales al módulo `orders`** (§4.54.5: cada aviso vive en el módulo dueño del hecho;
 * ⛔ `mail/` no se toca por dentro). El esqueleto es el de `DESIGN_SYSTEM §31`, reusado — ver la nota
 * de `shipments/mail/shipment-notice.templates.ts` sobre dónde debería vivir (BE-43, §31.15 pase 2).
 *
 * ## ⛔⛔ LO QUE ESTAS DOS PLANTILLAS NO PUEDEN RECIBIR, Y POR ESO NO RECIBEN LA FILA
 * `Order.ivaTransferPct` **es una columna de la fila** desde v1.64. ⇒ *un correo que renderice «la
 * orden» lo filtra sin que nadie lo escriba*, y eso es exactamente el criterio **209** («no viaja a
 * ninguna superficie de cliente»). **Defensa por construcción: la firma pide campos sueltos**
 * —número, líneas, total— y ⛔ **jamás un `Order`**. Lo mide `C-AV-9` buscando la cadena en el
 * JSON/HTML de los once correos.
 *
 * ## ⛔ Y NO HAY LÍNEA DE IVA, EN NINGUNA DE LAS DOS
 * §R.8 fila 2: si la orden es `IVA_INCLUSIVE` **el IVA no es un sumando** y la línea *informa*; un
 * correo que lo desglosara como si sumara **es un fallo**. La forma más barata de no fallarlo —y la
 * que además cumple el criterio **208** (cero afirmaciones jurídicas) y el **195** (cero vocabulario
 * del traslado)— es **no escribir ninguna línea de IVA**: el cliente ve **lo que pagó**, que es el
 * total persistido, exactamente como en el correo del invitado que ya funciona.
 * *No es una omisión: es que ninguna de las dos convenciones cambia lo que se le cobró.*
 */

type Locale = 'es' | 'en';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

const BRAND = 'TCG HUNT';

function money(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** §31.6h — la línea del «por qué recibes esto», común a los dos avisos de pedido. */
function orderFooterWhy(en: boolean): string {
  return en
    ? 'You are receiving this email because you placed an order with us.'
    : 'Recibes este correo porque hiciste un pedido con nosotros.';
}

export interface OrderNoticeItem {
  name: string;
  setName: string;
  number: string;
}

export interface OrderSettledParams {
  orderNumber: string;
  items: OrderNoticeItem[];
  /** ⭐ `Order.totalCents` **persistido**. ⛔ Jamás una suma recalculada desde un dial vivo. */
  totalCents: number;
}

/**
 * **`AV-2` — TU PEDIDO QUEDÓ CONFIRMADO, para el cliente REGISTRADO** (criterio **200**).
 *
 * ### El hueco que cierra, medido
 * `guest-order-mail.service.ts` arranca con `if (!order.guestEmail) return null` ⇒ **el cliente con
 * cuenta —el que más nos importa— no recibía nada** al liquidar. Este correo es **la negación exacta
 * de ese `if`**: se manda **si y solo si** `guestEmail == null` **y** `userId != null`.
 * ⭐ Esa mitad es la que sostiene el criterio **206**, que **falla por exceso**: ⛔ ningún pedido
 * puede recibir **dos** confirmaciones.
 *
 * ### En qué se diferencia del correo del invitado, y por qué
 * ⛔ **No lleva enlace tokenizado.** El registrado **entra con su sesión**; emitirle un token de URL
 * sería fabricar un secreto que no necesita —y un secreto de más es una superficie de más—. El CTA
 * va a la pantalla de sus pedidos, que ya exige sesión.
 * ⛔ **No ofrece «crea una cuenta»**: ya la tiene.
 */
export function orderSettledTemplate(
  params: OrderSettledParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'Thanks for your purchase' : 'Gracias por tu compra';
  const intro = en
    ? `Your order ${params.orderNumber} is confirmed and we are preparing it.`
    : `Tu pedido ${params.orderNumber} quedó confirmado y lo estamos preparando.`;
  const itemsLabel = en ? 'WHAT YOU BOUGHT' : 'LO QUE COMPRASTE';
  const totalLabel = en ? 'TOTAL PAID' : 'TOTAL PAGADO';
  const total = money(params.totalCents, l);
  const finalSale = en
    ? 'All sales are final: no refunds on request, except for a damaged/wrong card or a platform error.'
    : 'Ventas finales: no hay reembolso a solicitud, salvo carta dañada/equivocada o error de la plataforma.';
  const url = appUrl('cuenta/pedidos', l);
  const ctaLabel = en ? 'SEE MY ORDER' : 'VER MI PEDIDO';
  const lineas = params.items.map((i) => `${i.name} — ${i.setName} #${i.number}`);
  const blocks = [
    eyebrowRow(en ? 'YOUR ORDER' : 'TU PEDIDO', params.orderNumber),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(24),
    sectionLabelRow(itemsLabel),
    spacerRow(8),
    ...lineas.map((t) => proseRow(t)),
    spacerRow(24),
    // La resta con sustraendos vacíos: **solo el total pagado**, que es la columna persistida.
    totalsRows([], { label: totalLabel, amount: total }),
    spacerRow(24),
    smallPrintRow(finalSale),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en
      ? `${BRAND} — Your order ${params.orderNumber} is confirmed`
      : `${BRAND} — Confirmación de tu pedido ${params.orderNumber}`,
    html: mailShell({
      locale: l,
      title,
      preheader: `${intro}`,
      blocks,
      footerWhy: orderFooterWhy(en),
    }),
    text: [
      title,
      '',
      intro,
      '',
      `${itemsLabel}:`,
      ...lineas.map((t) => `- ${t}`),
      '',
      `${totalLabel}: ${total}`,
      '',
      finalSale,
      ...(url ? ['', url] : []),
      '',
      BRAND,
    ].join('\n'),
  };
}

export interface OrderRefundedParams {
  orderNumber: string;
  /** ⭐ `Order.totalCents` persistido: `AV-3` sale **solo con reembolso TOTAL** (§R.3). */
  totalCents: number;
}

/**
 * **`AV-3` — TE DEVOLVIMOS TU DINERO.** *Su dinero volvió* — cláusula (b) de `PROJECT §R.2`.
 *
 * ### ⛔ Solo el reembolso TOTAL, y no es una simplificación
 * El parcial **no transiciona la orden** (`onChargeRefunded` lo loggea y sale) ⇒ **no hay hecho
 * nuevo del que colgar un aviso**, y avisar de un importe parcial obligaría a **recalcular** cuánto
 * volvió a partir del evento de Stripe en vez de leer una columna — justo lo que el criterio **207**
 * prohíbe. Con el reembolso total, el importe **es** `Order.totalCents`, que está persistido.
 *
 * **Una sola vez, sin estrenar columna:** el early-return `if (order.status === 'refunded') return`
 * ⇒ un reintento de Stripe no duplica.
 * **Destinatario (§R.5):** `guestEmail ?? user.email` — *el reembolso le toca a los dos*.
 */
export function orderRefundedTemplate(
  params: OrderRefundedParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We refunded your order' : 'Te reembolsamos tu pedido';
  const intro = en
    ? `We refunded order ${params.orderNumber} in full.`
    : `Reembolsamos completo tu pedido ${params.orderNumber}.`;
  const bankNote = en
    ? 'Your bank decides when it shows up; it usually takes a few business days.'
    : 'Tu banco decide cuándo aparece; suele tardar unos días hábiles.';
  const totalLabel = en ? 'REFUNDED' : 'TE DEVOLVIMOS';
  const total = money(params.totalCents, l);
  const url = appUrl('cuenta/pedidos', l);
  const ctaLabel = en ? 'SEE MY ORDER' : 'VER MI PEDIDO';
  const blocks = [
    eyebrowRow(en ? 'YOUR ORDER' : 'TU PEDIDO', params.orderNumber),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    spacerRow(24),
    totalsRows([], { label: totalLabel, amount: total }),
    spacerRow(24),
    smallPrintRow(bankNote),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  return {
    subject: en
      ? `${BRAND} — Refund for your order ${params.orderNumber}`
      : `${BRAND} — Reembolso de tu pedido ${params.orderNumber}`,
    html: mailShell({
      locale: l,
      title,
      preheader: `${intro} ${totalLabel}: ${total}`,
      blocks,
      footerWhy: orderFooterWhy(en),
    }),
    text: [
      title,
      '',
      intro,
      '',
      `${totalLabel}: ${total}`,
      '',
      bankNote,
      ...(url ? ['', url] : []),
      '',
      BRAND,
    ].join('\n'),
  };
}
