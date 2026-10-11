import { envOr } from './mail-env.util';

/** Default de código del buzón de soporte (P-21: el dominio VIVO; el histórico `@tcgvaultmx.com` está muerto). */
export const SUPPORT_CONTACT_DEFAULT = 'soporte@tcghunt.mx';

/**
 * v1.82 · **PNL-1 / `D-PNL-2` — EL ÚNICO resolutor del buzón de soporte** (`API_CONTRACT §PNL.1`,
 * `ARCHITECTURE §4.61.1`).
 *
 * Cascada: `SUPPORT_EMAIL` → `DISPUTE_EVIDENCE_CONTACT` → `soporte@tcghunt.mx`, con `envOr` en cada
 * peldaño (vacío/blanco cuenta como ausente; el valor sale con `trim`).
 *
 * ### Por qué existe
 * Hasta v1.81 había **dos** cascadas que solo coincidían por casualidad: `disputes.constants.ts` y
 * `orders/guest-checkout.constants.ts` leían SOLO `DISPUTE_EVIDENCE_CONTACT`; `buylist-mail.templates.ts`
 * y `buylist/mail-shell.ts` leían `SUPPORT_EMAIL` primero. Con `SUPPORT_EMAIL` fijada y distinta, el
 * seguimiento del invitado y el correo de buylist le daban al cliente **dos buzones**. Todos los lectores
 * importan esta función; ⛔ **ninguna cascada local** (candado DSC-8: `test/support-contact.single-resolver.spec.ts`
 * barre `src/` y falla si alguien vuelve a leer esas dos variables de `process.env` fuera de este fichero).
 *
 * ### Por qué es función y no constante
 * Las constantes de antes se fijaban **al importar**: el valor dependía del orden de carga de módulos, y
 * una prueba que fijara la env después del `import` medía el default, no la cascada. Leer en cada llamada
 * cuesta dos lecturas de `process.env` y quita esa clase entera.
 */
export function supportContact(): string {
  return envOr(
    process.env.SUPPORT_EMAIL,
    envOr(process.env.DISPUTE_EVIDENCE_CONTACT, SUPPORT_CONTACT_DEFAULT),
  );
}
