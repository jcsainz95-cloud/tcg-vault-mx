/**
 * DESIGN_SYSTEM MKT-CONV.4 (B2, criterios 944–946) — los datos del dueño para «Quiénes somos y contacto», la franja de
 * confianza, el pie y el `Organization` del JSON-LD. UNA fuente por dato: la página, el pie y `organizationJsonLd()`
 * leen de aquí (o de `messages/*.json` `about.*` para los textos); nadie los repite a mano.
 *
 * Origen (HECHOS.md 2026-10-31 «Marketing tanda 2: decisiones del dueño»): ciudad «Ciudad de México»; correo público
 * el de contacto; plazo de entrega «4 a 10 días hábiles»; sin atención en persona, «atención telefónica únicamente»;
 * Instagram `@tcghunt.mx` (MKT-2). ⛔ Ningún dato inventado: un valor vacío ⇒ su fila NO se pinta (L-7).
 */
import { brandEmail } from '@/lib/brand';

/**
 * Correo público (D-F, el dueño: «usa el de contacto»). Se arma sobre el dominio de marca (API_CONTRACT §0 «Datos de
 * contacto…», cláusula 4: ningún literal copiado de un documento), igual que el fallback de `SealedShopView`.
 */
export const PUBLIC_CONTACT_EMAIL = brandEmail('contacto');

/**
 * Teléfono / WhatsApp del dueño. **Vacío a propósito: el número NO está en HECHOS** (medido por el orquestador,
 * HECHOS 2026-10-31). Es la ÚNICA constante que hay que rellenar (formato E.164, p. ej. `+52…`): con valor, la página
 * pinta la fila «Teléfono» (con la nota «Atención solo por teléfono») y el `contactPoint` lleva `telephone`; vacío,
 * no hay fila ni campo.
 */
export const CONTACT_PHONE = '';

/** Ciudad del dueño, por idioma (la usan la página y el `address` del JSON-LD en español). */
export const ABOUT_CITY = { es: 'Ciudad de México', en: 'Mexico City' } as const;

/** Instagram que confirmó el dueño (MKT-2, HECHOS 2026-10-31). La URL es la que lleva `Organization.sameAs`. */
export const INSTAGRAM_HANDLE = '@tcghunt.mx';
export const INSTAGRAM_URL = 'https://www.instagram.com/tcghunt.mx/';

/** Ruta de la página (sin idioma; con prefijo `/es` y `/en` como `/como-funciona`, MKT-CONV.4). */
export const ABOUT_PATH = '/nosotros';

/** Fecha de la última revisión de los datos de la página (su `lastmod` en el sitemap). */
export const ABOUT_LAST_REVIEW = '2026-10-31';

/** `tel:` de un número tal como se escribe (deja solo dígitos y el `+`). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
