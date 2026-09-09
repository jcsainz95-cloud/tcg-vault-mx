import { Finish } from '@prisma/client';
import { envOr } from '../mail/mail-env.util';
import { MailMessage } from '../mail/mail.port';
import {
  brandRows,
  cardLineRows,
  ctaRows,
  deadlineRow,
  escapeHtml,
  eyebrowRow,
  headingRow,
  mailShell,
  proseRow,
  ruleRow,
  sectionLabelRow,
  smallPrintRow,
  spacerRow,
  termsBoxRows,
  totalsRows,
} from './mail-shell';

/**
 * Plantilla LOCAL al módulo buylist del correo de RECHAZO de ítem (v1.18-buylist-rejects,
 * ARCHITECTURE §4.18c). El módulo `mail` pertenece al stream «Cuentas y acceso» y NO se toca:
 * `buylist` solo inyecta el puerto global `MAIL_PORT` y renderiza aquí. El helper de layout y el
 * escape HTML (S15-B1) están DUPLICADOS a propósito desde `mail/mail.templates.ts` (mismo
 * branding/disciplina); deuda aceptada BE-43 (TECH_DEBT): se absorben en `MailService` cuando el
 * stream «Cuentas y acceso» toque `mail/`.
 *
 * MINIMIZACIÓN DE DATOS (norma §4.18c): el correo lleva SOLO la carta (nombre/set/número), acabado,
 * motivo y los dos plazos con el canal de coordinación.
 *
 * ⚠️ **PROHIBIDO — LA LISTA CANÓNICA DE LOS CINCO** (`PROJECT.md` §P.3, criterio **173(h)**), la misma
 * en todo correo que salga de este fichero: **(1) domicilio**, **(2) CLABE (ni enmascarada)**,
 * **(3) datos de terceros**, **(4) montos/estado de OTRAS solicitudes u OTROS ítems** y **(5) cifras
 * internas de la mesa** (posición, sugerencia, topes del operador).
 * **Esta cabecera nombraba TRES.** Se completa por la misma razón que la del ciclo: *una lista que
 * dice tres de cinco deja de vigilarse a sí misma* — quien la lee para saber qué NO puede escribir se
 * lleva una autorización tácita sobre los dos que faltan. **La regla nunca dependió del número**, y el
 * barrido que la hace cumplir en los cinco correos del ciclo es `test/buylist.cycle-mail-pii.spec.ts`.
 */

type Locale = 'es' | 'en';

// P-21 (rebrand): overridable por env sin redeploy (mismo patrón que `disputes.constants.ts`).
// Cae en cascada a `DISPUTE_EVIDENCE_CONTACT` (mismo buzón de soporte) y, al final, al default de
// código. P-21 MIGRACIÓN CERRADA (ago-2026): ese default es ya el buzón VIVO `soporte@tcghunt.mx`
// (el histórico `@tcgvaultmx.com` está muerto: el vendedor escribiría a nadie). P-21 cierre:
// `envOr` (no `??`) — env definida pero vacía/blanca sigue la cascada hasta el default.
const SUPPORT_EMAIL = envOr(
  process.env.SUPPORT_EMAIL,
  envOr(process.env.DISPUTE_EVIDENCE_CONTACT, 'soporte@tcghunt.mx'),
);
// P-21 (rebrand): marca visible "TCG HUNT" (DESIGN_SYSTEM §17.4).
const BRAND = 'TCG HUNT';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

/**
 * S15-B1 — el escape de HTML **ya no se define aquí**: se importa de `mail-shell.ts`, que es donde
 * viven los builders de §31 y donde tiene que estar para que **el llamador no pueda olvidarlo**.
 * *No es el arreglo de BE-43* —el `layout()` de abajo sigue duplicado con `mail/`, y su disparador
 * declarado es el pase 2—: es no crear una **tercera** copia del mismo escape en el mismo módulo.
 */

/**
 * ⚠️ **`layout()` — el esqueleto VIEJO, y solo lo usan los correos 2, 3, 4, 5 y el de rechazo.**
 * El correo 1 ya migró al esqueleto de §31 (`mail-shell.ts`). Los otros cinco de este fichero son el
 * **resto del pase 1** y salen en el siguiente empujón; hasta entonces conviven, porque migrar medio
 * correo es peor que migrar uno entero. ⛔ **No se le añaden funciones nuevas**: lo que este layout no
 * sabe hacer (marca, pie en tinta, modo oscuro, preheader) es exactamente lo que §31 vino a resolver.
 */
function layout(title: string, bodyHtml: string): string {
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#111">`,
    `<h2 style="margin:0 0 16px">${BRAND}</h2>`,
    `<h3 style="margin:0 0 12px">${title}</h3>`,
    bodyHtml,
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>`,
    `<p style="font-size:12px;color:#888">${BRAND}</p>`,
    `</div>`,
  ].join('');
}

/** Etiquetas legibles del acabado (los datos de catálogo van en inglés por diseño, ARCHITECTURE §6). */
const FINISH_LABELS: Record<Finish, string> = {
  normal: 'Normal',
  reverse_holo: 'Reverse Holo',
  holofoil: 'Holofoil',
  first_edition_holofoil: '1st Edition Holofoil',
};

function formatDate(date: Date | null, locale: Locale): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    dateStyle: 'long',
    timeZone: 'America/Mexico_City',
  }).format(date);
}

export interface SellItemRejectedParams {
  cardName: string;
  setName: string;
  cardNumber: string;
  finish: Finish;
  reason: string;
  returnDeadlineAt: Date | null;
  abandonDeadlineAt: Date | null;
  /**
   * §31.6b — **el folio del eyebrow**, y aquí gana más que en ningún otro: este es exactamente el
   * correo que le pide al vendedor **escribir a soporte**, y el folio es *«la llave con la que el
   * vendedor escribirá a soporte»*. Lo pasa `BuylistService` desde `item.sellRequestId`.
   * ⚠️ **Opcional a propósito**: la firma la fija `ARCHITECTURE §4.18c` y hay lectores que no lo
   * tienen (los specs de cascada de entorno). Sin folio el eyebrow va **solo** — ⛔ ni se inventa un
   * identificador ni se deja un `·` huérfano (§31.6b, la misma regla de los correos 7 y 8).
   */
  folio?: string | null;
}

/**
 * **CORREO 4 — CARTA NO ACEPTADA** (§31.9; `ARCHITECTURE §4.18c`). Correo al vendedor cuando el admin
 * RECHAZA una de sus cartas (típicamente no-NM): qué carta, acabado, motivo y **las dos opciones con
 * sus plazos** — devolución antes de `returnDeadlineAt` (A COSTO DEL USUARIO, coordinada con soporte)
 * o abandono en `abandonDeadlineAt`. `to` lo fija el llamador (BuylistService).
 *
 * ### §31 — qué cambia y qué NO
 * Cambia **cómo se ve**: el esqueleto de `mail-shell.ts` en lugar del `layout()` de nueve líneas.
 * ⛔ **No cambia ni una cadena** (§31.0): las dos opciones, el motivo, el aviso final y el asunto son
 * los de siempre, **carácter por carácter**, y las dos que se pintan en versalitas (`TUS OPCIONES`)
 * van **en mayúsculas en la cadena**, no por CSS (§31.2).
 *
 * - **Caja de términos, y es el único correo del ciclo además del 1 que la lleva** (§31.9): dentro van
 *   **los dos plazos**. Por eso `termsBoxRows` acepta ahora varios párrafos — la extensión está en el
 *   patrón, no aquí.
 * - **⛔ Sin CTA, y es deliberado.** §31.7 le asigna *«el de coordinación»*, pero **§31 no dice qué
 *   dice ese botón ni a dónde apunta**, y este módulo no tiene URL de coordinación: el canal es el
 *   buzón de soporte, que **ya viaja dentro de la opción de devolución**, en las dos mitades del
 *   correo. Inventarle un rótulo sería escribir copy de negocio, que no es mío (§31.0). *Queda
 *   escalado a ux-ui/arquitecto en `BACKEND_NOTES`.*
 *
 * **MINIMIZACIÓN (norma §4.18c):** solo la carta, el acabado, el motivo y los dos plazos con el canal.
 */
export function sellItemRejectedTemplate(
  params: SellItemRejectedParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const finishLabel = FINISH_LABELS[params.finish] ?? params.finish;
  const cardLine = `${params.cardName} · ${params.setName} · #${params.cardNumber}`;
  const returnDate = formatDate(params.returnDeadlineAt, l);
  const abandonDate = formatDate(params.abandonDeadlineAt, l);

  const title = en ? 'A card was rejected' : 'Una carta fue rechazada';
  const intro = en
    ? 'During verification we rejected the following card from your sell request:'
    : 'Durante la verificación rechazamos la siguiente carta de tu solicitud de venta:';
  const reasonProse = en ? `Reason: ${params.reason}` : `Motivo: ${params.reason}`;
  // §31.2 — versalita **en la cadena**: `text-transform` no existe en Outlook.
  const optionsLabel = en ? 'YOUR OPTIONS' : 'TUS OPCIONES';
  const returnOption = en
    ? `Return: request the return of your card before ${returnDate}. Shipping is at your cost; write to ${SUPPORT_EMAIL} to coordinate it.`
    : `Devolución: solicita la devolución de tu carta antes del ${returnDate}. El envío corre por tu cuenta; escribe a ${SUPPORT_EMAIL} para coordinarla.`;
  const abandonOption = en
    ? `Abandonment: if we don't hear from you by ${abandonDate}, the card will be considered abandoned.`
    : `Abandono: si no recibimos respuesta antes del ${abandonDate}, la carta se considerará abandonada.`;
  const closing = en
    ? 'This decision only affects the card above; the rest of your request is not modified by this email.'
    : 'Esta decisión solo afecta a la carta indicada; el resto de tu solicitud no se modifica con este correo.';
  const eyebrow = en ? 'CARD NOT ACCEPTED' : 'CARTA NO ACEPTADA';
  const eyebrowText = params.folio ? `${eyebrow} · ${params.folio}` : eyebrow;

  const blocks = [
    brandRows(),
    eyebrowRow(eyebrow, params.folio ?? null),
    // §31.9 — titular serif **22px**: los 26px son de los correos 1 y 2, que piden una decisión.
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}${en ? ',' : ':'}`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(16),
    // §31.6c — la misma línea de carta de los ocho, con la celda de importe **vacía**: aquí no hay
    // dinero que decir y ⛔ jamás `MX$ 0.00` (§31.0 regla 3).
    cardLineRows({
      title: params.cardName,
      meta: `${params.setName} · #${params.cardNumber} · ${finishLabel}`,
    }),
    spacerRow(16),
    ruleRow(),
    spacerRow(24),
    proseRow(reasonProse),
    spacerRow(32),
    // §31.6d — el rótulo en versalitas es **el portador**; la regla bermellón es decorativa (§31.8.4b).
    termsBoxRows(optionsLabel, [returnOption, abandonOption]),
    spacerRow(32),
    smallPrintRow(closing),
  ];

  // §31.12 — la parte de texto plano dice **lo mismo**, no un resumen. Gana el eyebrow con el folio y
  // el aviso de cierre, que hasta ahora vivían solo en el HTML: un cliente que solo pinta texto leía
  // menos que los demás, y este correo es el que le pide escribir a soporte con su folio.
  const text =
    `${en ? `Hi ${name},` : `Hola ${name}:`}\n\n` +
    `${eyebrowText}\n\n` +
    `${title}\n\n` +
    `${intro}\n` +
    `${cardLine} (${en ? 'Finish' : 'Acabado'}: ${finishLabel})\n\n` +
    `${reasonProse}\n\n` +
    `${optionsLabel}\n` +
    `- ${returnOption}\n` +
    `- ${abandonOption}\n\n` +
    `${closing}\n\n` +
    `${BRAND}`;

  return {
    to: '', // lo fija el llamador
    // ⚠️ §31.9 — los asuntos NO se tocan en este pase.
    subject: en
      ? 'A card in your sell request was rejected'
      : 'Una carta de tu solicitud de venta fue rechazada',
    html: mailShell({
      locale: l,
      title,
      // §31.6a — 40–90 caracteres, y es **la frase que ya abre el cuerpo**: la del hecho. ⛔ No se
      // redacta un preheader nuevo para este correo (§31.0: no se escribe copy que no exista).
      preheader: intro,
      blocks,
      footerWhy: sellRequestFooterWhy(en),
    }),
    text,
  };
}

/**
 * v1.51 (§4.39n, DESIGN_SYSTEM §23.4.2/§23.4.4-bis) — los **DOS correos del ciclo de oferta** que este
 * pase produce: el **1 (LA OFERTA)** y el **5 (CANCELAMOS LA OFERTA)**.
 *
 * ⚠️ **Un productor por correo, elegido en el CALL-SITE.** No hay `switch (status)` que elija plantilla:
 * `expiredReason` es `null` en dos de los tres productores del correo 3, así que ramificar sobre datos
 * de la fila **elegiría mal**. Cada endpoint llama a la plantilla que le corresponde y a ninguna otra.
 *
 * **MINIMIZACIÓN (norma §4.18c/§4.39n), en los dos:** solo las cartas de ESTA solicitud, sus montos y
 * los plazos. **PROHIBIDO — LOS CINCO** (`PROJECT.md` §P.3, criterio **173(h)**): **domicilio**,
 * **CLABE (ni enmascarada)**, **datos de terceros**, **montos de OTRAS solicitudes** y **cualquier
 * cifra interna de la mesa** (posición, sugerencia, tope del operador).
 * **⚠️ v1.55 — este banner nombraba CUATRO, y gobierna literalmente el correo que fugó** (el 1, B-1):
 * quien lo leyera para saber qué no podía escribir **no encontraba el domicilio en la lista**. *Una
 * lista que dice cuatro de cinco deja de vigilarse a sí misma.* La lista completa se declara además en
 * la cabecera de este fichero y se hace cumplir, en los cinco correos a la vez, en
 * `test/buylist.cycle-mail-pii.spec.ts`.
 * **S15-B1:** todo valor dinámico pasa por `escapeHtml`.
 */

/** Fecha **Y HORA** explícitas en `America/Mexico_City` (criterio 154: nunca «en 2 días»). */
function formatDateTime(date: Date | null, locale: Locale): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(date);
}

/** MXN desde centavos, sin inventar decimales. */
function money(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export interface OfferMailLine {
  cardName: string;
  setName: string;
  cardNumber: string;
  finish: Finish;
  /** `null` en las líneas que NO compramos — y **jamás `0`**: cero es un precio y aquí no hay precio. */
  offeredPriceCents: number | null;
}

export interface SellOfferParams {
  folio: string;
  lines: OfferMailLine[];
  grossCents: number;
  shippingFeeCents: number;
  netCents: number;
  acceptDeadlineAt: Date;
  /** URL del portal; vacío ⇒ el CTA se degrada a instrucción de texto (nunca un botón muerto). */
  portalUrl?: string;
}

/**
 * **CORREO 1 — LA OFERTA** (D2/D16, criterios 133/134/161(b)).
 *
 * *«La resta se ENSEÑA, no se esconde»*: van **los tres montos** —valor de las cartas, envío que
 * ponemos y **lo que se deposita**—, nunca uno solo. Un correo que anuncie $1,480 y termine en un
 * depósito de $1,350 destruye exactamente la confianza que la oferta vinculante venía a construir.
 *
 * - **La condición va EN LA LÍNEA**, pegada al monto, no en una leyenda al pie: es imposible leer el
 *   precio sin barrer la condición.
 * - **Lo que NO compramos se lista, con nombre y SIN monto** (criterio 118). **Prohibido `MX$ 0.00`**
 *   ahí, y **prohibido explicar por qué**: es deliberación interna.
 * - **El plazo va con FECHA Y HORA explícitas** (criterio 154). El front **no** recalcula días hábiles.
 * - **NO se acepta desde el correo** (criterio 146): el enlace lleva a la pantalla, la sesión decide.
 * - **El correo NO compra etiqueta** (D21): solo anuncia que el envío corre por nuestra cuenta y que
 *   la guía llega **al aceptar**. *Solo se gasta etiqueta en quien ya dijo que sí.*
 * - **⚠️ v1.54 · B-1 — NI EL DOMICILIO NI NINGÚN OTRO DATO PROHIBIDO** (`PROJECT.md` §P.3, criterio
 *   **173(h)**): la lista es **CLABE (ni enmascarada), datos de terceros, montos de OTRAS solicitudes,
 *   cifras internas de la mesa (posición, sugerencia, topes) y domicilio**, y **aplica a los CINCO**
 *   correos del ciclo. Este llevaba el domicilio; ya no. El ancla que lo vigila **en los cinco a la
 *   vez** —y que obliga a clasificar cualquier plantilla nueva de este módulo— es
 *   `test/buylist.cycle-mail-pii.spec.ts`.
 */
export function sellOfferTemplate(
  params: SellOfferParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const buy = params.lines.filter((x) => x.offeredPriceCents != null);
  const skip = params.lines.filter((x) => x.offeredPriceCents == null);
  // ⚠️ v1.51.15 (§11 `SellItemDTO.condition`) — **UN CUERPO, TRES LECTORES.** La condición por línea y
  // la consecuencia salen de `offerTermsCopy`, **no de literales locales**. Antes había DOS copias
  // byte a byte del mismo texto VINCULANTE (aquí y allá) que solo coincidían por disciplina; el
  // contrato exige que `item.condition` sea **«el MISMO string que usó el correo»** (criterio 161(d):
  // la pantalla de aceptación lo muestra *palabra por palabra*), y eso **no se puede garantizar con
  // dos literales** — se garantiza con una sola fuente. *La copia se cura eliminando la copia.*
  // El texto renderizado NO cambia: los literales eran idénticos. Lo que cambia es que ahora **no
  // pueden divergir** en el próximo cambio de copy.
  const terms = offerTermsCopy(locale, {
    shippingFeeCents: params.shippingFeeCents,
    netCents: params.netCents,
  });
  const condition = terms.perLineConditionLabel;
  const deadline = formatDateTime(params.acceptDeadlineAt, l);
  const idOf = (x: OfferMailLine) =>
    `${x.cardName} · ${x.setName} · #${x.cardNumber} · ${FINISH_LABELS[x.finish] ?? x.finish}`;

  // =============================================================================================
  // §31 — EL CUERPO, BLOQUE A BLOQUE.
  //
  // **El orden es el de §31.3 y es el MISMO en los ocho**; el CONTENIDO y el orden de §25.4.2 los
  // declara **intactos** §31.1: la condición **antes** del dinero y **dentro** de cada línea, los
  // montos **antes** del CTA y el plazo **pegado** al CTA. *Esto es envoltura nueva sobre texto que
  // no se toca: lo único que cambia aquí es cómo se ve.*
  // =============================================================================================
  const metaOf = (x: OfferMailLine) =>
    `${x.setName} · #${x.cardNumber} · ${FINISH_LABELS[x.finish] ?? x.finish}`;
  const consequence = terms.consequence;
  const shippingProse = terms.rule;
  const notIncluded = en ? 'Not included in this offer' : 'No entra en esta oferta';

  /**
   * §31.6c — cada línea con su regla SÓLIDA de separación (§31.2: la punteada de §25.4.2 no
   * sobrevive a Outlook). ⛔ En las que NO compramos, `amount` va **`null`**: la celda del importe
   * existe y va vacía — **jamás `MX$ 0.00`** (§31.0 regla 3, criterio 118).
   */
  const linesBlock = (items: OfferMailLine[], comprada: boolean) =>
    items
      .map(
        (x, i) =>
          (i ? spacerRow(16) + ruleRow() + spacerRow(16) : spacerRow(16)) +
          cardLineRows({
            title: x.cardName,
            meta: metaOf(x),
            // ⛔ La condición sale de `offerTermsCopy` **tal cual**: es el string que el criterio
            // 161(d) obliga a que sea el MISMO que ve el portal. No se acorta «porque no cabe».
            note: comprada ? condition : null,
            amount: comprada ? money(x.offeredPriceCents as number, l) : null,
            aside: comprada ? null : notIncluded,
          }),
      )
      .join('');

  // §31.6d — el rótulo de la caja es **el portador** (§31.8 regla 4b: la regla bermellón es
  // decorativa). Va EN MAYÚSCULAS en la cadena: `text-transform` no existe en Outlook (§31.2).
  const consequenceLabel = en
    ? "WHAT HAPPENS IF A CARD DOESN'T ARRIVE NEAR MINT"
    : 'QUÉ PASA SI UNA CARTA NO LLEGA EN NEAR MINT';

  // §31.6f — la frase del plazo, **partida en tres para poder pintar el token sin reescribirla**:
  // `deadlinePre + deadline + deadlinePost` es, carácter por carácter, la misma frase de siempre, y
  // es la que viaja a la parte de texto plano. El rojo **acompaña** a la palabra, nunca la sustituye.
  const deadlinePre = en ? 'You have until ' : 'Tienes hasta el ';
  const deadlinePost = en
    ? ". If you don't respond before that time, the offer cancels itself."
    : '. Si no respondes antes de esa hora, la oferta se cancela sola.';
  const deadlineProse = `${deadlinePre}${deadline}${deadlinePost}`;
  const ctaProse = en
    ? 'You will sign in with your account: this offer cannot be accepted from an email link.'
    : 'Entrarás con tu cuenta: esta oferta no se acepta desde un enlace del correo.';
  // §31.7 — **bermellón, porque no responder cuesta dinero** (correos 1 y 2; los otros seis en
  // tinta). El texto del botón va en MAYÚSCULAS en la cadena (§31.2). `ctaRows` emite **siempre** la
  // URL en texto debajo: es el respaldo del botón bajo inversión forzada, no un adorno (§31.8.4c).
  const ctaBlocks = params.portalUrl
    ? [ctaRows(params.portalUrl, en ? 'VIEW AND RESPOND TO THE OFFER' : 'VER Y RESPONDER LA OFERTA', 'accent')]
    : [
        proseRow(
          en
            ? 'Sign in to your account and open your sell request to respond.'
            : 'Entra a tu cuenta y abre tu solicitud para responder.',
        ),
      ];
  // ⚠️ v1.54 · **B-1 (PII): EL AVISO SE QUEDA, EL DOMICILIO NO.**
  // Este párrafo llevaba el domicilio del vendedor interpolado. `PROJECT.md` §P.3 lo prohíbe **en los
  // cinco** correos del ciclo, en la misma frase que la CLABE, y el criterio **173(h)** ordena
  // verificarlo *«buscando esos datos en los cinco, no en cuatro»*.
  // **Que sea SU domicilio en SU correo no lo autoriza**: la prohibición es sobre el dato en el
  // canal, no sobre a quién pertenece — un correo se reenvía, se imprime y vive en un buzón ajeno.
  // **Lo que el párrafo hacía útil sí se conserva**: el aviso de que la etiqueta sale con la
  // dirección congelada en ESTA solicitud y de que corregirla es AHORA. *Se retira el dato, no la
  // advertencia.*
  const pickupProse = en
    ? 'When you accept we send you the label: it uses the pickup address saved on this request. If you moved, check it in your account and correct it before accepting.'
    : 'Al aceptar te mandamos la guía: sale con la dirección de origen que guardaste en esta solicitud. Si te mudaste, revísala en tu cuenta y corrígela antes de aceptar.';

  const title = en
    ? `We're buying ${buy.length} of your ${params.lines.length} cards`
    : `Te compramos ${buy.length} de tus ${params.lines.length} cartas`;
  const intro = en
    ? 'This offer is conditional, and this is how it works: we buy each card at the price below AS LONG AS IT ARRIVES NEAR MINT.'
    : 'Esta oferta es condicional y así funciona: compramos cada carta al precio de abajo SIEMPRE QUE LLEGUE EN NEAR MINT.';

  // §31.6a — **el preheader lleva el NETO, jamás el bruto** (R1 de §25.4). Es lo primero que se lee
  // en la bandeja, y la primera cifra que este vendedor ve en su vida sobre esta venta tiene que ser
  // **la que va a recibir**.
  const preheader = en
    ? `We deposit ${money(params.netCents, l)} to you. This offer has a deadline.`
    : `Se te depositan ${money(params.netCents, l)}. Esta oferta tiene fecha límite.`;

  const blocks = [
    brandRows(),
    eyebrowRow(en ? 'PURCHASE OFFER' : 'OFERTA DE COMPRA', params.folio),
    headingRow(title, 26),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}:`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(24),
    sectionLabelRow(`${en ? 'WE BUY' : 'COMPRAMOS'} (${buy.length})`),
    linesBlock(buy, true),
    ...(skip.length
      ? [
          spacerRow(24),
          ruleRow(),
          spacerRow(24),
          sectionLabelRow(`${en ? "WE DON'T BUY" : 'NO COMPRAMOS'} (${skip.length})`),
          linesBlock(skip, false),
        ]
      : []),
    spacerRow(24),
    ruleRow(),
    spacerRow(24),
    termsBoxRows(consequenceLabel, consequence),
    spacerRow(32),
    totalsRows(
      [
        { label: en ? 'Value of the cards' : 'Valor de las cartas', amount: money(params.grossCents, l) },
        {
          label: en ? 'Shipping we cover' : 'Envío que ponemos nosotros',
          amount: money(params.shippingFeeCents, l),
          minus: true,
        },
      ],
      {
        label: en ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITAN',
        amount: money(params.netCents, l),
      },
    ),
    spacerRow(24),
    proseRow(shippingProse),
    spacerRow(24),
    deadlineRow(deadlinePre, deadline, deadlinePost),
    spacerRow(32),
    ...ctaBlocks,
    spacerRow(24),
    smallPrintRow(ctaProse),
    spacerRow(16),
    smallPrintRow(pickupProse),
  ];

  // §31.12 — **la parte de texto plano dice lo MISMO**, no un resumen: los tres montos, la condición
  // por línea, el plazo y **la URL completa**. Un correo de dinero cuya versión de texto dice menos
  // que el HTML miente a la mitad de los clientes. Es además el candado más barato de los cinco
  // prohibidos (ML-2): aquí nada se esconde entre atributos.
  const text =
    `${en ? 'Hi' : 'Hola'} ${name}:\n\n` +
    `${en ? 'PURCHASE OFFER' : 'OFERTA DE COMPRA'} · ${params.folio}\n\n` +
    `${title}\n\n${intro}\n\n` +
    `${en ? 'WE BUY' : 'COMPRAMOS'} (${buy.length})\n` +
    buy
      .map((x) => `- ${idOf(x)} — ${condition} — ${money(x.offeredPriceCents as number, l)}`)
      .join('\n') +
    (skip.length
      ? `\n\n${en ? "WE DON'T BUY" : 'NO COMPRAMOS'} (${skip.length})\n` +
        skip.map((x) => `- ${idOf(x)}`).join('\n')
      : '') +
    `\n\n${consequenceLabel}\n${consequence}\n\n` +
    `${en ? 'Value of the cards' : 'Valor de las cartas'}: ${money(params.grossCents, l)}\n` +
    `${en ? 'Shipping we cover' : 'Envío que ponemos nosotros'}: -${money(params.shippingFeeCents, l)}\n` +
    `${en ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITAN'}: ${money(params.netCents, l)}\n\n` +
    `${shippingProse}\n\n${deadlineProse}\n` +
    // ML-5/ML-7: la URL **completa**, también aquí. El botón puede quedar ilegible bajo inversión
    // forzada (§31.8 regla 4) y hay clientes que solo enseñan esta mitad: si la URL vive únicamente
    // dentro del `href`, hay lectores para los que **no existe ruta a la acción**.
    (params.portalUrl ? `${params.portalUrl}\n` : '') +
    `${ctaProse}\n\n` +
    // B-1: la versión de texto llevaba la MISMA fuga que el HTML (`Sale desde: <domicilio>`). Las dos
    // mitades del correo se arreglan juntas: un cliente que solo renderiza texto plano leía el
    // domicilio igual.
    `${pickupProse}\n\n` +
    `${BRAND}`;

  return {
    to: '', // lo fija el llamador
    subject: en ? 'We have an offer for your cards' : 'Tenemos una oferta por tus cartas',
    // ⚠️ §31.9 — **los asuntos NO se tocan en este pase**: R1 gobierna el del correo 1 (solo el neto,
    // nunca el bruto) y está ratificado con PO. Rediseñar el envoltorio y de paso reescribir el
    // asunto mezclaría un cambio visual con uno de producto.
    html: mailShell({
      locale: l,
      title,
      preheader,
      blocks,
      // §31.6h — la única línea variable del pie. ⛔ Nada necesario vive en la banda de tinta.
      footerWhy: en
        ? 'You are receiving this email because you have a sell request with us.'
        : 'Recibes este correo porque tienes una solicitud de venta con nosotros.',
    }),
    text,
  };
}

/**
 * **CORREO 5 — CANCELAMOS LA OFERTA** (v1.51.4, §4.39n · DESIGN_SYSTEM §23.4.4-bis).
 *
 * **Un solo productor:** `POST /admin/buylist/:id/offer/cancel` sobre una oferta **`sent`**, y nada
 * más. **NO lo manda el barrido** —ahí el hecho real es *«no procederemos»*, que es el correo 4—.
 *
 * Es el **único desenlace del ciclo que NO cierra nada**: la solicitud vuelve a `cotizada`, **viva**,
 * con los 7 días hábiles íntegros (D38). Por eso **no es una variante del correo 3**: aquél afirma
 * *«hubo una oferta y **tu** plazo venció»*, y aquí **no venció nada** — **cancelamos nosotros**.
 * Mandarle el 3 le imputaría un incumplimiento por un acto nuestro, y su CTA (*«cotizar de nuevo»*) lo
 * mandaría a **duplicar una solicitud abierta**.
 *
 * **PROHIBIDO aquí:** la palabra «venció», cualquier plazo del vendedor, **cualquier monto** (los de la
 * oferta cancelada se limpiaron de la fila y **no se resucitan**), el motivo interno y el CTA de volver
 * a cotizar.
 */
export function sellOfferCancelledTemplate(
  params: { folio: string; offerSentAt: Date | null; portalUrl?: string },
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const sentOn = formatDate(params.offerSentAt, l);
  const title = en ? 'We cancelled the offer we sent you' : 'Cancelamos la oferta que te mandamos';
  const body1 = en
    ? `The offer from ${sentOn} is no longer valid: we cancelled it ourselves. It is nothing on your side.`
    : `La oferta del ${sentOn} ya no es válida: la cancelamos nosotros. No es nada de tu parte.`;
  const body2 = en
    ? 'Your request is still active and we are reviewing it again; we will write to you with a new offer or with our answer.'
    : 'Tu solicitud sigue viva y volvemos a revisarla; te escribiremos con una oferta nueva o con nuestra respuesta.';
  const ctaLabel = en ? 'View my request' : 'Ver mi solicitud';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : `<p style="margin:20px 0"><strong>${escapeHtml(en ? 'Sign in to your account to see your request.' : 'Entra a tu cuenta para ver tu solicitud.')}</strong></p>`;

  return {
    to: '',
    subject: en ? 'We cancelled the offer we sent you' : 'Cancelamos la oferta que te mandamos',
    html: layout(
      title,
      `<p style="font-size:12px;color:#888">${escapeHtml(params.folio)}</p>` +
        `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(body1)}</p><p>${escapeHtml(body2)}</p>` +
        cta,
    ),
    text:
      `${en ? 'Hi' : 'Hola'} ${name}:\n\n${params.folio}\n\n${title}\n\n${body1}\n\n${body2}\n\n${BRAND}`,
  };
}

/**
 * v1.51 (§11 `SellOfferPublicDTO.terms`) — **el texto legal lo RENDERIZA EL BACKEND**, con las
 * MISMAS plantillas que el correo. La redacción es de ux-ui (DESIGN_SYSTEM §23.4.2); el render es
 * nuestro, para que **la pantalla y el correo no puedan decir cosas distintas**.
 *
 * ### ⚠️ v1.51.15 — ESTA FUNCIÓN ES LA FUENTE ÚNICA, y tiene TRES lectores
 * 1. **`SellOfferPublicDTO.terms`** — el bloque legal de la pantalla de aceptación.
 * 2. **El correo de oferta** (`sellOfferTemplate`) — que hasta v1.51.15 llevaba **su propia copia
 *    byte a byte** de estos dos textos. Coincidían **por disciplina**, no por construcción.
 * 3. **`SellItemDTO.condition`** (proyección de CLIENTE) — la condición pegada al monto de cada
 *    línea comprada, que §11 define como *«**el MISMO string que usó el correo**»*.
 *
 * ⚠️ **v1.51.15 · BL-23(2): `rule` necesita LOS MONTOS**, por eso la firma los toma. Se pasan
 * **siempre** desde los dos productores reales (el correo y `offerPublicDTO`), que los tienen
 * congelados en la fila. El `?? 0` del default existe **solo** para los lectores que quieren el texto
 * sin cifras (tests de copy): **una oferta jamás se emite por esa vía** — la guarda de proyección
 * (BL-24) exige `rule` no vacío sobre la proyección REAL, con los montos REALES.
 *
 * El criterio 161(d) exige que la pantalla de aceptación muestre la condición **palabra por
 * palabra**. Con tres literales en tres archivos eso es una promesa que se rompe en el primer cambio
 * de copy y **sin que ningún test lo note**; con un cuerpo, es una propiedad. *Si cambias el texto
 * aquí, cambia en los tres sitios a la vez — que es exactamente lo que el contrato pide.*
 *
 * - `perLineConditionLabel` — la **frase cortísima** que se pinta pegada al monto de cada línea
 *   comprada. Es corta a propósito: se repite N veces y la ceguera por repetición es real; el detalle
 *   vive en `consequence`, en **un solo** bloque destacado.
 * - `consequence` — qué pasa con la carta que no llegue NM (no se compra, no se paga, se devuelve:
 *   7 días a su costo, abandono a 30) **más** que el rechazo de una línea **NO cancela la compra de
 *   las demás y NO reprecia ninguna** (criterio 161b).
 */
export function offerTermsCopy(
  locale?: string | null,
  amounts?: { shippingFeeCents: number; netCents: number },
): {
  perLineConditionLabel: string;
  consequence: string;
  rule: string;
} {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const shipping = money(amounts?.shippingFeeCents ?? 0, l);
  const net = money(amounts?.netCents ?? 0, l);
  return {
    perLineConditionLabel: en ? 'only if it arrives Near Mint' : 'siempre que llegue en Near Mint',
    consequence: en
      ? `If a card doesn't arrive Near Mint we don't buy it, we don't pay for it and we send it back: you have 7 days to arrange the return, at your cost, and after 30 days it is considered abandoned. Rejecting one card does NOT cancel the purchase of the others and does NOT change any price: the ones that do arrive Near Mint are paid at the price in this offer.`
      : `Si una carta no llega en Near Mint no se compra, no se paga y te la devolvemos: tienes 7 días para gestionar la devolución, a tu costo, y a los 30 días se considera abandonada. Rechazar una carta NO cancela la compra de las demás y NO cambia el precio de ninguna: las que sí lleguen en Near Mint se pagan al precio de esta oferta.`,
    // ⚠️ v1.51.15 · **BL-23(2)** — **LA PROSA DEL DESCUENTO, CON LOS MONTOS YA INTERPOLADOS.**
    // §23.5b obliga al portal a llevarla: bajo D43 **es el único sitio donde el vendedor puede
    // RELEER la resta** (el correo la estrena y el recordatorio no la repite). Vivía solo dentro de
    // la plantilla del correo, así que el frontend **tuvo que duplicarla en su i18n** — la única
    // copia de copy que ese pase se vio obligado a crear (DESIGN_SYSTEM §23.5h la permite **como
    // puente**, y este campo es lo que la deja sin objeto).
    // ⚠️ **Y lo que de verdad cierra: sin el campo, el front interpolaría ÉL los tres montos de una
    // oferta VINCULANTE.** No es copy duplicado, es **la presentación del dinero fabricándose en dos
    // sitios que pueden divergir** — justo lo que §23.5a existe para impedir.
    rule: en
      ? `We provide the shipping label. Its cost, ${shipping}, is a flat fee and is ALWAYS deducted from what we pay you: you pay nothing out of pocket. The amount deposited to you is ${net}.`
      : `Nosotros ponemos la guía de envío. Su costo, ${shipping}, es una tarifa fija y SIEMPRE se descuenta de lo que te pagamos: tú no pagas nada de tu bolsillo. La cifra que se te deposita es ${net}.`,
  };
}

// ⛔ **v1.54 · B-1 — `pickupAddressLine(snapshot)` SE ELIMINA, no se deja «por si acaso».**
// v1.51 (D36) la escribió para armar una línea legible del snapshot de dirección y meterla en el
// correo de oferta. Ese uso era su ÚNICO llamador y `PROJECT.md` §P.3 / criterio 173(h) lo prohíben,
// así que la función quedaba sin destino legítimo **dentro de este módulo**: lo único que sabe hacer
// es exactamente lo que ningún correo del ciclo puede llevar.
// *Una función que compone PII y que nadie llama es la rampa por la que el dato vuelve.* Si algún día
// una superficie **autenticada** necesita pintar el snapshot (el portal, la mesa), su sitio es el DTO
// de esa superficie —donde la audiencia está decidida— y **no un helper del módulo de correos**.
// El ancla `test/buylist.cycle-mail-pii.spec.ts` vigila que no reaparezca aquí.

/**
 * v1.51 (§4.39n · DESIGN_SYSTEM §23.4.3/§23.4.4/§23.4.5) — **los correos 2, 3 y 4 del ciclo.**
 *
 * ⚠️ **UN PRODUCTOR POR CORREO, elegido en el CALL-SITE.** Nada de `switch (status)`: `expiredReason`
 * es `null` en dos de los tres productores del 3, así que ramificar sobre datos de la fila
 * **elegiría mal**. El barrido llama a la plantilla que corresponde a **su regla**, y `decline` llama
 * a la del correo 4 — **la misma, con el mismo texto** que la regla 7 (*un correo por hecho, no un
 * correo por camino*).
 */

/** Variante del recordatorio (correo 2). Son **el mismo hecho** con dos acciones distintas. */
export type OfferReminderKind = 'accept' | 'ship';

export interface SellOfferReminderParams {
  kind: OfferReminderKind;
  folio: string;
  /** Nº de cartas compradas — el recordatorio NO re-lista el desglose. */
  buyLineCount: number;
  /** ⚠️ SOLO el neto: es el único monto vinculante, y repetir la resta lo volvería una oferta nueva. */
  netCents: number;
  deadlineAt: Date;
  /** Solo en `ship`: paquetería y número de guía, para que pueda usarlos. */
  carrier?: string | null;
  trackingNumber?: string | null;
  portalUrl?: string;
}

/**
 * **CORREO 2 — EL RECORDATORIO** (D23). *«Te queda un día.»*
 *
 * **UNA SOLA VEZ por plazo** — lo garantiza el barrido sellando `offerAcceptReminderSentAt` /
 * `shipReminderSentAt`, no esta plantilla. *Un segundo recordatorio idéntico destruye la credibilidad
 * del primero.*
 *
 * ### ⚠️ La regla que más fácil se rompe
 * El bloque congelado **repite la condición NM junto a la cifra**. La tentación de un recordatorio es
 * ser «ligero» y quedarse con el monto — y un correo que repite el neto **sin** decir *«siempre que
 * lleguen en Near Mint»* **degrada la condición a letra chica por omisión**, que es exactamente lo
 * que D30 vino a impedir.
 *
 * **No re-lista el desglose:** un recordatorio que repite la tabla completa **se lee como una oferta
 * nueva** y arruina la propiedad más valiosa del ciclo — que hay **una** oferta y **no se edita**.
 * **Mismos números, congelados:** si mostrara un monto o una fecha distintos de los del correo 1,
 * sería un defecto **bloqueante**, no una discrepancia menor.
 */
export function sellOfferReminderTemplate(
  params: SellOfferReminderParams,
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const accept = params.kind === 'accept';
  const deadline = formatDateTime(params.deadlineAt, l);
  const title = accept
    ? en
      ? 'Your offer expires tomorrow'
      : 'Tu oferta vence mañana'
    : en
      ? 'Your package needs to ship tomorrow'
      : 'Tu paquete debe salir mañana';
  // ⚠️ La condición NM viaja PEGADA al conteo de cartas, en una línea corta.
  const frozen = en
    ? `YOUR OFFER · ${params.folio}\n${params.buyLineCount} card(s), only if they arrive Near Mint\nDEPOSITED TO YOU: ${money(params.netCents, l)}\nExpires ${deadline}`
    : `TU OFERTA · ${params.folio}\n${params.buyLineCount} carta(s), siempre que lleguen en Near Mint\nSE TE DEPOSITAN: ${money(params.netCents, l)}\nVence el ${deadline}`;
  const ask = accept
    ? en
      ? 'You still have to respond to the offer.'
      : 'Todavía tienes que responder la oferta.'
    : en
      ? 'Your package still has to be dropped off.'
      : 'Tu paquete todavía tiene que salir.';
  // §P.13: la salida que evita que alguien pierda su venta por una demora NUESTRA.
  const alreadySent = accept
    ? ''
    : en
      ? 'If you already dropped it off, tell us from your account and we stop the clock.'
      : 'Si ya lo depositaste, avísanos desde tu cuenta y detenemos el reloj.';
  const guide =
    !accept && params.trackingNumber
      ? en
        ? `Carrier: ${params.carrier ?? ''} · Tracking: ${params.trackingNumber}`
        : `Paquetería: ${params.carrier ?? ''} · Guía: ${params.trackingNumber}`
      : '';
  const ctaLabel = accept
    ? en
      ? 'View and respond to the offer'
      : 'Ver y responder la oferta'
    : en
      ? 'Go to my request'
      : 'Ir a mi solicitud';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : `<p style="margin:20px 0"><strong>${escapeHtml(en ? 'Sign in to your account to continue.' : 'Entra a tu cuenta para continuar.')}</strong></p>`;

  return {
    to: '',
    subject: title,
    html: layout(
      title,
      `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(ask)}</p>` +
        `<div style="background:#EFEBE2;padding:12px;margin:16px 0"><p style="margin:0;font-size:13px;white-space:pre-line">${escapeHtml(frozen)}</p></div>` +
        (guide ? `<p style="font-family:monospace">${escapeHtml(guide)}</p>` : '') +
        (alreadySent ? `<p>${escapeHtml(alreadySent)}</p>` : '') +
        cta,
    ),
    text:
      `${en ? 'Hi' : 'Hola'} ${name}:\n\n${title}\n\n${ask}\n\n${frozen}\n` +
      (guide ? `\n${guide}\n` : '') +
      (alreadySent ? `\n${alreadySent}\n` : '') +
      `\n${BRAND}`,
  };
}

/** Variante del correo 3. **3a** = no respondió la oferta · **3b** = aceptó y el paquete no salió. */
export type SellExpiredKind = 'no_response' | 'not_shipped';

/**
 * **CORREO 3 — EXPIRACIÓN** (barrido, reglas 1 y 2). **Dos productores, un hecho de fondo:** *«se te
 * venció un plazo y la solicitud queda cerrada»*.
 *
 * ⚠️ **SIN MONTOS, ni siquiera en 3b** — donde el monto ya no se va a pagar y mencionarlo **solo
 * duele**. Y **este correo NO lo manda la cancelación de una oferta** (ése es el 5): aquél afirma que
 * *hubo una oferta y **tu** plazo venció*, y en una cancelación **no venció nada** — cancelamos
 * nosotros.
 */
export function sellRequestExpiredTemplate(
  params: { kind: SellExpiredKind; folio: string; closedAt: Date; portalUrl?: string },
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const noResponse = params.kind === 'no_response';
  const when = formatDate(params.closedAt, l);
  const title = noResponse
    ? en
      ? 'Your offer expired'
      : 'Tu oferta venció'
    : en
      ? 'Your sell request expired'
      : 'Tu solicitud de venta venció';
  const body1 = noResponse
    ? en
      ? `The deadline to respond ended on ${when} and the offer is no longer valid. No card was purchased and you have nothing pending.`
      : `El plazo para responder terminó el ${when} y la oferta ya no es válida. No se compró ninguna carta y no tienes nada pendiente.`
    : en
      ? `You accepted the offer, but the package did not ship within the deadline, which ended on ${when}. The request is closed and no card was purchased.`
      : `Aceptaste la oferta, pero el paquete no salió dentro del plazo, que terminó el ${when}. La solicitud queda cerrada y no se compró ninguna carta.`;
  const body2 = en
    ? 'If you still want to sell, you can get a new quote whenever you like.'
    : 'Si sigues queriendo vender, puedes cotizar de nuevo cuando quieras.';
  const ctaLabel = en ? 'Get a new quote' : 'Cotizar de nuevo';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return {
    to: '',
    subject: title,
    html: layout(
      title,
      `<p style="font-size:12px;color:#888">${escapeHtml(params.folio)}</p>` +
        `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(body1)}</p><p>${escapeHtml(body2)}</p>` +
        cta,
    ),
    text: `${en ? 'Hi' : 'Hola'} ${name}:\n\n${params.folio}\n\n${title}\n\n${body1}\n\n${body2}\n\n${BRAND}`,
  };
}

/**
 * **CORREO 4 — «NO PROCEDEREMOS»** (D33/D39). **DOS productores, UN solo correo:** el barrido (regla
 * 7) y `POST …/decline`. **Misma plantilla, mismo texto** — al vendedor no le corresponde saber si le
 * contestamos rápido o dejamos correr el reloj: *un correo por hecho, no un correo por camino.*
 *
 * ### ⚠️ Es el más corto y el más fácil de arruinar. Su trabajo es CERRAR SIN ACUSAR Y SIN EXPLICAR.
 * **PROHIBIDO aquí, y cada prohibición tiene su razón:**
 * - **Decir POR QUÉ no ofertamos** — abre una negociación que no existe y filtra criterio interno.
 * - **Cualquier referencia al TIEMPO transcurrido** («tras revisar», «después de 7 días», «perdón por
 *   la demora») — delata **por qué camino** se cerró, que es justo lo que la fusión de productores
 *   prohíbe.
 * - **Cualquier MONTO**, ni el total cotizado: nombrarlo junto a «no procederemos» se lee como *«te
 *   íbamos a pagar esto y no lo hicimos»*, y la cotización **nunca fue vinculante**.
 * - **Fórmulas vagas** («no pudimos procesar», «seguimos revisando») — dejan al vendedor esperando.
 * - **Culpar o insinuar incumplimiento**, y **la palabra «venció»**: aquí **no venció nada suyo**. Es
 *   el motivo entero por el que este correo existe separado del 3.
 */
export function sellRequestNotPursuedTemplate(
  params: { folio: string; portalUrl?: string },
  name: string,
  locale?: string | null,
): MailMessage {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We will not proceed with the offer' : 'No vamos a proceder con la oferta';
  const body1 = en
    ? `About your sell request ${params.folio}: we will not proceed with the offer.`
    : `Sobre tu solicitud ${params.folio}: no vamos a proceder con la oferta.`;
  // Lo único que de verdad le sirve saber: que no tiene nada que hacer.
  //
  // ⚠️ **§31.10 — se retira «y no nos debes nada» / «and you owe us nothing», en los dos idiomas.**
  // Es el ÚNICO cambio de copy del rediseño y lo pidió el dueño. La razón está escrita y es la norma
  // de **§7.12a**: una negación defensiva **nombra el tema** —mete la idea de una deuda que nunca
  // existió, solo para negarla— y sigue siendo **una afirmación que habría que sostener**. Y es
  // **redundante**: *«no se generó ninguna guía»* ya contesta la única duda real (*¿me van a cobrar el
  // envío?*), y la contesta **por un hecho**, no por una promesa.
  // ⛔ **Se mantiene el TUTEO** (§31.10): los ocho hablan de tú, y cambiar a usted en uno solo suena a
  // que lo escribió otra persona.
  const body2 = en
    ? "There is nothing pending on your side: don't send any card, and no shipping label was generated."
    : 'No hay nada pendiente de tu parte: no mandes ninguna carta y no se generó ninguna guía.';
  const body3 = en
    ? 'Prices move all the time. You can get a new quote whenever you like.'
    : 'Los precios se mueven todo el tiempo. Puedes volver a cotizar cuando quieras.';
  const ctaLabel = en ? 'Get a new quote' : 'Cotizar de nuevo';
  const cta = params.portalUrl
    ? `<p style="margin:20px 0"><a href="${escapeHtml(params.portalUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a></p>`
    : '';
  return {
    to: '',
    subject: title,
    html: layout(
      title,
      `<p style="font-size:12px;color:#888">${escapeHtml(params.folio)}</p>` +
        `<p>${escapeHtml(en ? 'Hi' : 'Hola')} ${escapeHtml(name)}:</p>` +
        `<p>${escapeHtml(body1)}</p><p>${escapeHtml(body2)}</p><p>${escapeHtml(body3)}</p>` +
        cta,
    ),
    text: `${en ? 'Hi' : 'Hola'} ${name}:\n\n${params.folio}\n\n${title}\n\n${body1}\n\n${body2}\n\n${body3}\n\n${BRAND}`,
  };
}

/**
 * v1.51.13 · **BL-21** (ARCHITECTURE §4.39n.1) — **la URL del CTA de los correos del ciclo, en UN
 * solo sitio.**
 *
 * ```
 * {origen público}/{locale}/buylist/{sellRequestId}
 * ```
 *
 * ### Por qué vive AQUÍ y no en cada servicio
 * El `{locale}` **no es un adorno ni un default: es EL MISMO valor con el que se renderizó el cuerpo**
 * — sale del mismo `normalizeLocale` que usan las plantillas, tres líneas más arriba. *Un correo
 * tiene UN idioma, y el cuerpo y el botón lo comparten.* Construirlos por vías distintas es
 * exactamente cómo se manda **un correo en inglés cuyo botón abre una pantalla en español**, y sería
 * en el correo donde el vendedor **acepta una oferta vinculante**.
 *
 * ### Las tres cosas que estaban mal antes (y las tres eran independientes)
 * 1. **Sin prefijo de idioma.** El frontend corre con `localePrefix: 'always'` ⇒ `/buylist/...`
 *    redirige a `/es/...` y el vendedor que eligió inglés **aterriza en español**.
 * 2. ~~**Path con forma de API**, no de pantalla~~ ⛔ **CORREGIDO por el arquitecto en v1.51.15
 *    (BL-23.1): esta frase estaba MAL y se podía leer al revés.** **Espejar la ruta del recurso es
 *    BUENO**; lo roto era **la falta del `{locale}`** y **que no existía pantalla detrás**. La
 *    pantalla del portal vive en **`/[locale]/buylist/requests/[id]`**, y v1.51.13 fijó
 *    `/{locale}/buylist/{id}` — backend implementó esa forma, así que **el enlace seguía roto, ahora
 *    por DIVERGENCIA**: mandábamos a una ruta y la pantalla vivía en otra. **Manda la del
 *    frontend**: `/buylist` **no es una colección, es una SECCIÓN** que ya renderiza pantalla propia;
 *    colgarle un `[id]` afirmaría que *todo* lo que hay bajo `/buylist` es una solicitud.
 *    ⚠️ *Sin esta nota, alguien quitaría `requests/` para cumplir una regla que nunca se escribió.*
 * 3. **Era el ÚNICO enlace de correo del proyecto fuera del molde.** Los otros dos (`auth.service` y
 *    `guest-order-mail.service`) son idénticos entre sí y ambos llevan locale: no fue un olvido
 *    puntual, fue **un enlace escrito fuera de un patrón que ya existía**.
 *
 * ### Segmento, no query param
 * El seguimiento de invitado usa `?token=` **porque el token es un SECRETO de URL**. Aquí el
 * `sellRequestId` **no es secreto** (el portal está autenticado y el vendedor ya ve ese id), así que
 * *la razón que obligó al query param allí no existe aquí* y manda la regla normal: **un recurso se
 * direcciona con un segmento**.
 *
 * ### ⚠️ El origen es UN ORIGEN, NO UNA LISTA — y no es el de CORS
 * Sale de la variable **dedicada** `APP_PUBLIC_URL`, cuyo único trabajo es *«la URL pública del
 * frontend»*: un esquema+host(+puerto), **sin path y sin barra final** (se normaliza aquí).
 * **PROHIBIDO rellenarla copiando la allow-list de CORS**, que en producción va separada por comas:
 * produciría `https://a,https://b/es/buylist/...` — **un href roto en un correo de dinero**.
 * *(Los otros dos enlaces del proyecto derivan su origen de `APP_BASE_URL.split(',')[0]`, o sea del
 * primer elemento de esa allow-list. Funciona, pero **el orden de una lista de CORS no significa
 * nada**: reordenarla movería en silencio el origen de todos los correos. Por eso éste sale de la
 * variable dedicada. Footgun heredado, registrado en BL-21; no se migra aquí.)*
 *
 * ### Sin origen configurado ⇒ `undefined`, y el correo SALE IGUAL
 * Las plantillas degradan a **instrucción de texto**. **El correo nunca se bloquea por no poder
 * construir el CTA** —la oferta es vinculante y el vendedor tiene que enterarse— y **jamás se emite
 * un href relativo, parcial o a medias**: o el enlace es completo y correcto, o no hay enlace.
 */
export function buylistPortalUrl(sellRequestId: string, locale?: string | null): string | undefined {
  const origin = envOr(process.env.APP_PUBLIC_URL, '').trim().replace(/\/+$/, '');
  if (!origin) return undefined;
  // ⚠️ EL MISMO normalizador que eligió el idioma del cuerpo, no una cascada paralela.
  // v1.51.15 · BL-23(1): `…/buylist/requests/{id}` — la ruta REAL de la pantalla. Ver el punto 2.
  return `${origin}/${normalizeLocale(locale)}/buylist/requests/${encodeURIComponent(sellRequestId)}`;
}
