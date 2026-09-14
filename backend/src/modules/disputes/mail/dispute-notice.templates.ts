import { MailMessage } from '../../mail/mail.port';
import {
  appUrl,
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  proseRow,
  ruleRow,
  smallPrintRow,
  spacerRow,
} from '../../buylist/mail-shell';
import { DISPUTE_EVIDENCE_CONTACT } from '../disputes.constants';

/**
 * # Los dos avisos de DISPUTA — `AV-10` (recompra) y `AV-11` (rechazada) · §R.3, v1.74
 *
 * Plantillas locales a `disputes` (§4.54.5). El esqueleto es el de `DESIGN_SYSTEM §31`, reusado.
 *
 * ## ⭐ Por qué estos dos avisan y los otros dos estados NO
 * `abierta` **la abrió él** y `en_revision` **no le pide ninguna acción** (`PROJECT §R.3`): los dos
 * son `▫️` —se ven donde ya viven hoy— y ⛔ **no tienen plantilla aquí**. Su ausencia es parte del
 * criterio **206**, que falla **por exceso**.
 *
 * ## ⭐⭐ EL IMPORTE NO SE INVENTA: SE REPITE EL TEXTO QUE EL CLIENTE YA VE
 * `Dispute.resolution` **es campo de cliente** (`toDisputeDTO` lo devuelve en `GET /disputes/:id`),
 * y es donde vive lo que se decidió, incluida la cifra de la recompra que el servicio compuso
 * leyendo `OrderItem.unitPriceCents`. ⇒ el correo **repite ese mismo string**, sin recomponerlo y
 * sin recalcular nada. *Criterio **207** en su forma literal: el aviso dice exactamente lo que
 * muestra la pantalla de esa misma disputa; si un día discreparan, sería porque alguien escribió una
 * segunda fuente — y aquí no hay ninguna.*
 * ⛔ **Y por eso la plantilla no formatea dinero**: no tiene ningún importe que formatear.
 */

type Locale = 'es' | 'en';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

const BRAND = 'TCG HUNT';

/** §31.6h — la línea del «por qué recibes esto», común a los dos avisos de disputa. */
function disputeFooterWhy(en: boolean): string {
  return en
    ? 'You are receiving this email because you opened a claim with us.'
    : 'Recibes este correo porque abriste una aclaración con nosotros.';
}

export interface DisputeNoticeParams {
  folio: string;
  /** El MISMO texto que devuelve `GET /disputes/:id`. `null` ⇒ no se pinta ninguna línea. */
  resolution: string | null;
}

function blocksFor(
  params: DisputeNoticeParams,
  l: Locale,
  title: string,
  intro: string,
  tail: string,
): { blocks: string[]; url?: string; lines: string[] } {
  const en = l === 'en';
  const url = appUrl('cuenta/aclaraciones', l);
  const ctaLabel = en ? 'SEE MY CLAIM' : 'VER MI ACLARACIÓN';
  const resolutionLabel = en ? 'What we decided' : 'Lo que decidimos';
  const blocks = [
    eyebrowRow(en ? 'YOUR CLAIM' : 'TU ACLARACIÓN', params.folio),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(intro),
    // ⛔ Sin texto de resolución no se pinta un rótulo huérfano ni un «—»: el dato no existe.
    ...(params.resolution
      ? [
          spacerRow(24),
          ruleRow(),
          spacerRow(24),
          proseRow(`${resolutionLabel}: ${params.resolution}`),
        ]
      : []),
    spacerRow(24),
    smallPrintRow(tail),
    spacerRow(32),
    ...(url ? [ctaRows(url, ctaLabel, 'ink')] : []),
  ];
  const lines = [
    title,
    '',
    intro,
    ...(params.resolution ? ['', `${resolutionLabel}: ${params.resolution}`] : []),
    '',
    tail,
    ...(url ? ['', url] : []),
    '',
    BRAND,
  ];
  return { blocks, url, lines };
}

/**
 * **`AV-10` — RESUELTA CON RECOMPRA.** *Dinero* (`PROJECT §R.3`).
 *
 * **Una sola vez, sin estrenar columna:** `updateMany` sobre `DISPUTE_RESOLVABLE_STATES` +
 * `count === 1`. ⛔ **No es idempotente a propósito**: resolver dos veces es **registrar dos veces un
 * money-out**, así que la segunda llamada es `409` y ⛔ no llega aquí.
 * ⛔ **No dice que devuelva la carta**: en la recompra **el cliente la conserva** y la pieza no
 * reingresa al inventario; afirmar lo contrario sería inventar una obligación suya.
 */
export function disputeRepurchaseTemplate(
  params: DisputeNoticeParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We resolved your claim: we buy it back' : 'Resolvimos tu aclaración: te la recompramos';
  const intro = en
    ? 'We reviewed your claim and we are buying the card back from you. You keep the card.'
    : 'Revisamos tu aclaración y te recompramos la carta. La carta se queda contigo.';
  const tail = en
    ? `If anything does not match, reply to ${DISPUTE_EVIDENCE_CONTACT}.`
    : `Si algo no cuadra, escríbenos a ${DISPUTE_EVIDENCE_CONTACT}.`;
  const { blocks, lines } = blocksFor(params, l, title, intro, tail);
  return {
    subject: en ? `${BRAND} — Your claim was resolved` : `${BRAND} — Resolvimos tu aclaración`,
    html: mailShell({
      locale: l,
      title,
      preheader: `${title}. ${intro}`,
      blocks,
      footerWhy: disputeFooterWhy(en),
    }),
    text: lines.join('\n'),
  };
}

/**
 * **`AV-11` — RECHAZADA.** *Decisión que le afecta y sobre la que querrá responder* (`PROJECT §R.3`).
 *
 * ⭐ **Por eso el correo termina en el canal de respuesta** (`DISPUTE_EVIDENCE_CONTACT`, el mismo
 * buzón que ya publica el DTO): un «no» sin a dónde contestar es un callejón, y el dueño pidió este
 * aviso justamente **porque querrá responder**.
 * ⛔ **No argumenta la decisión más allá del texto que el operador escribió**: inventar un motivo que
 * no está en la fila es inventar un dato (criterio 207 en su lectura general).
 */
export function disputeRejectedTemplate(
  params: DisputeNoticeParams,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We resolved your claim' : 'Resolvimos tu aclaración';
  const intro = en
    ? 'We reviewed your claim and it did not proceed.'
    : 'Revisamos tu aclaración y no procedió.';
  const tail = en
    ? `If you have something else to show us, reply to ${DISPUTE_EVIDENCE_CONTACT}.`
    : `Si tienes algo más que mostrarnos, escríbenos a ${DISPUTE_EVIDENCE_CONTACT}.`;
  const { blocks, lines } = blocksFor(params, l, title, intro, tail);
  return {
    subject: en ? `${BRAND} — Your claim was resolved` : `${BRAND} — Resolvimos tu aclaración`,
    html: mailShell({
      locale: l,
      title,
      preheader: `${title}. ${intro}`,
      blocks,
      footerWhy: disputeFooterWhy(en),
    }),
    text: lines.join('\n'),
  };
}
