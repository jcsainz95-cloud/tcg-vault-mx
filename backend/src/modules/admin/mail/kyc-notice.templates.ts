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
  termsBoxRows,
} from '../../buylist/mail-shell';

/**
 * # `AV-1` — EL RECHAZO DE IDENTIDAD, CON SU MOTIVO (§R.3, v1.74)
 *
 * ⭐ **Es el aviso que originó todo `PROJECT §R`**: el dueño rechazó una identidad y **no supo si al
 * cliente le llegaba algo**. Medido antes de escribirlo: `grep -rn kyc backend/src/modules/mail/` ⇒
 * **0**. *El lazo ya cerraba —resubir devuelve el estado a `pending` y limpia el motivo—: faltaba el
 * aviso, no el circuito.*
 *
 * ## ⭐ EL MOTIVO VIAJA VERBATIM, Y ESO ES LA FUNCIÓN
 * El operador elige uno de los **seis presets** (`unreadable · missingSide · notAnId · expired ·
 * nameMismatch · other`) o escribe el suyo, y **el preset escribe una frase completa y editable** en
 * `KycProfile.rejectionReason`. Esa frase es **exactamente** la que el cliente ya lee en el portal
 * (`GET /users/me/kyc`) ⇒ el correo **la repite**, ⛔ no la reescribe ni la interpreta. *Dos redacciones
 * del mismo rechazo son dos rechazos distintos en cuanto una se edite.*
 *
 * ⚠️ **Residual declarado y NO resuelto en este corte** (`API_CONTRACT §R.1.b`): el motivo viaja **en
 * el idioma en que lo escribió el operador**, así que un cliente con `locale='en'` puede leerlo en
 * español dentro de un correo en inglés. **Es conducta que YA existe** (el portal lo hace así desde
 * v1.69) y **nadie pidió cambiarla**; resolverla exigiría un catálogo de códigos de motivo, que el
 * contrato **rechaza explícitamente** (§R.1.a punto 1: sería una segunda fuente para el mismo hecho).
 * Queda como deuda **no bloqueante** en `TECH_DEBT.md`, dueño backend.
 *
 * ## ⛔ LO QUE ESTE CORREO NO PUEDE DECIR, Y ES MÁS IMPORTANTE QUE LO QUE DICE
 * - ⛔ **Ni un tope, ni un umbral, ni un acumulado** (criterio **201**, y `HECHOS.md (c)`: los topes
 *   **dejaron de mostrarse al cliente** — son política interna). Aplica **también a los seis motivos**,
 *   y eso lo vigila `C-AV-9` leyendo las dos tablas de mensajes del frontend.
 * - ⛔ **Ni una afirmación jurídica** (criterios **195** y **208**) ni vocabulario del traslado del IVA.
 * - ⛔ **Ni la CLABE, ni el RFC, ni una object key de INE** (§R.8 fila 7). El correo **no lleva ningún
 *   dato del expediente**: lleva el motivo (que lo escribió un admin **sobre** el documento, y por
 *   tanto no es PII del cliente) y el camino para corregirlo.
 * - ⛔ **Y no dice que cotejemos la CLABE contra un titular** (criterio 183(c) sigue vigente).
 */

type Locale = 'es' | 'en';

function normalizeLocale(locale?: string | null): Locale {
  return locale === 'en' ? 'en' : 'es';
}

const BRAND = 'TCG HUNT';

export interface KycRejectedParams {
  /** El texto que escribió el operador, **tal cual** lo lee el cliente en el portal. */
  reason: string;
}

/**
 * `AV-1`. **Una sola vez por ciclo (criterio 205):** lo garantiza el sello
 * `KycProfile.kycRejectionNoticeSentAt` (§R.4.a) — **es el único de los once sin guarda de motor**,
 * porque el `upsert` de `updateUserKyc` **no mira el estado actual** y N rechazos seguidos serían N
 * correos en un minuto.
 */
export function kycRejectedTemplate(
  params: KycRejectedParams,
  name: string,
  locale?: string | null,
): Omit<MailMessage, 'to'> {
  const l = normalizeLocale(locale);
  const en = l === 'en';
  const title = en ? 'We could not verify your ID' : 'No pudimos validar tu identificación';
  const intro = en
    ? 'We reviewed the ID you uploaded and we cannot use it as it is.'
    : 'Revisamos la identificación que subiste y no podemos usarla como está.';
  const reasonLabel = en ? 'WHY' : 'POR QUÉ';
  const next = en
    ? 'Upload it again from your account and we review it as soon as it arrives.'
    : 'Vuelve a subirla desde tu cuenta y la revisamos en cuanto llegue.';
  const privacy = en
    ? 'Your documents are stored privately and are only used to verify your identity.'
    : 'Tus documentos se guardan de forma privada y solo se usan para verificar tu identidad.';
  const url = appUrl('cuenta/identidad', l);
  const ctaLabel = en ? 'UPLOAD MY ID AGAIN' : 'VOLVER A SUBIR MI IDENTIFICACIÓN';
  const blocks = [
    // ⛔ Sin folio: el expediente de identidad no tiene uno que el cliente use, y ⛔ no se inventa un
    // identificador (§31.6b: «sin folio el eyebrow va solo»).
    eyebrowRow(en ? 'YOUR IDENTITY' : 'TU IDENTIDAD'),
    headingRow(title, 22),
    spacerRow(24),
    proseRow(`${en ? 'Hi' : 'Hola'} ${name}:`),
    spacerRow(16),
    proseRow(intro),
    spacerRow(24),
    ruleRow(),
    spacerRow(24),
    // §31.6d — el motivo va en la caja de términos: es **lo único accionable** del correo, y el
    // rótulo en versalitas es el portador (⛔ el color no porta nada, §31.8 regla 4b).
    termsBoxRows(reasonLabel, params.reason),
    spacerRow(24),
    proseRow(next),
    spacerRow(24),
    smallPrintRow(privacy),
    spacerRow(32),
    ...(url
      ? [ctaRows(url, ctaLabel, 'ink')]
      : [proseRow(en ? 'Sign in to your account to continue.' : 'Entra a tu cuenta para continuar.')]),
  ];
  return {
    subject: en ? `${BRAND} — About your ID` : `${BRAND} — Sobre tu identificación`,
    html: mailShell({
      locale: l,
      title,
      preheader: `${title}. ${next}`,
      blocks,
      footerWhy: en
        ? 'You are receiving this email because you uploaded an ID to your account.'
        : 'Recibes este correo porque subiste una identificación a tu cuenta.',
    }),
    text: [
      `${en ? 'Hi' : 'Hola'} ${name}:`,
      '',
      title,
      '',
      intro,
      '',
      `${reasonLabel}: ${params.reason}`,
      '',
      next,
      '',
      privacy,
      ...(url ? ['', url] : []),
      '',
      BRAND,
    ].join('\n'),
  };
}
