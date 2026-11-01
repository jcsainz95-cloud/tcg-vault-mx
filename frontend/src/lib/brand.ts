/**
 * Dominio y marca canónicos para el código que **no puede llamar a `useTranslations`** (los
 * fixtures del modo mock, los helpers de `lib/`, el contenido de `content/`). Para pintar el DOMINIO en un componente
 * se lee i18n (`common.brand.domain`, p. ej. el pie de `(storefront)/layout.tsx`).
 *
 * **Buzón de marca en UI (ARCHITECTURE §13.8 (c)).** El correo público de contacto de marca (`contacto@`) NO es de
 * entorno: su fuente única es `lib/about.ts` (`PUBLIC_CONTACT_EMAIL = brandEmail('contacto')`), y de ahí lo leen la
 * página «Quiénes somos», el pie, el JSON-LD y las FAQ. El buzón de SOPORTE de pedidos sí es de entorno (§PNL) y no
 * se arma aquí salvo como fallback offline.
 *
 * **Por qué existe (API_CONTRACT §0 «Datos de contacto y valores de configuración», cláusula 4).**
 * Un correo de soporte es un dato de INFRAESTRUCTURA (el de marca es la excepción de §13.8 (c), arriba): lo resuelve el servidor y el frontend
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

/** Buzón de la marca (`contacto` ⇒ `contacto@tcghunt.mx`). En UI, solo vía `lib/about.ts` (§13.8 (c)); el resto, fixtures/fallback offline. */
export function brandEmail(mailbox: string): string {
  return `${mailbox}@${BRAND_DOMAIN}`;
}
