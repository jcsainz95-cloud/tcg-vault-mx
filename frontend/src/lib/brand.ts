/**
 * Dominio y marca canónicos para el código que **no puede llamar a `useTranslations`** (los
 * fixtures del modo mock, los helpers de `lib/`). La UI nunca debe usar esto: en un componente el
 * dominio se lee de i18n (`common.brand.domain`, p. ej. el pie de `(storefront)/layout.tsx`).
 *
 * **Por qué existe (API_CONTRACT §0 «Datos de contacto y valores de configuración», cláusula 4).**
 * Un correo de contacto es un dato de INFRAESTRUCTURA: lo resuelve el servidor y el frontend
 * **renderiza el que recibe**. Un literal solo se admite como *fallback offline* —fixtures y modo
 * degradado sin API— y **debe construirse sobre `common.brand.domain`**, jamás copiarse de la
 * documentación: así fue como `tcgvaultmx.com`, muerto desde el rebrand, sobrevivió meses en el
 * producto.
 *
 * **Por qué es una constante y no un `import` de `messages/es.json`.** `fixtures.ts` lo importa
 * `src/lib/api.ts` de forma **estática**, así que traer el JSON de mensajes aquí lo metería en el
 * bundle de toda la app (no solo en el modo mock, que es `opt-in`). En su lugar esto es un
 * **espejo fijado por test**: `brand.test.ts` compara este valor contra `common.brand.domain` de
 * **las dos** traducciones, así que no puede separarse de la fuente sin que CI lo diga.
 */
export const BRAND_DOMAIN = 'tcghunt.mx';

/** Buzón de la marca (`soporte` ⇒ `soporte@tcghunt.mx`). Solo para fixtures/fallback offline. */
export function brandEmail(mailbox: string): string {
  return `${mailbox}@${BRAND_DOMAIN}`;
}
