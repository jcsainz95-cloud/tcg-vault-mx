/**
 * DESIGN_SYSTEM MKT-CONV.4 (B2, criterios 944–946) — los datos del dueño para «Quiénes somos y contacto», la franja de
 * confianza, el pie y el `Organization` del JSON-LD. UNA fuente por dato: la página, el pie y `organizationJsonLd()`
 * leen de aquí (o de `messages/*.json` `about.*` para los textos); nadie los repite a mano.
 *
 * Origen (HECHOS.md 2026-10-31 «Marketing tanda 2: decisiones del dueño»): ciudad «Ciudad de México»; correo público
 * el de contacto; Instagram `@tcghunt.mx` (MKT-2). HECHOS.md 2026-11-01 «WhatsApp público, plazo de entrega y texto de
 * Quiénes somos»: WhatsApp 55 6489 3921 y el texto final de marketing (vive en `messages/*.json` `about.*`).
 * ⛔ Ningún dato inventado: un valor vacío ⇒ su fila NO se pinta (L-7).
 */
import { brandEmail } from '@/lib/brand';

/**
 * Correo público (D-F, el dueño: «usa el de contacto»). Se arma sobre el dominio de marca (API_CONTRACT §0 «Datos de
 * contacto…», cláusula 4: ningún literal copiado de un documento), igual que el fallback de `SealedShopView`.
 */
export const PUBLIC_CONTACT_EMAIL = brandEmail('contacto');

/**
 * WhatsApp público del dueño (HECHOS 2026-11-01: «Si ese es el número»), escrito por idioma como lo dio marketing
 * (`copy-final.md` @ 6fed1dd): nacional en español, internacional en inglés. **Es la única fuente del número:** el
 * enlace `wa.me` y el `telephone` del JSON-LD se derivan de la forma internacional (`CONTACT_PHONE.en`).
 */
export const CONTACT_PHONE = { es: '55 6489 3921', en: '+52 55 6489 3921' } as const;

/** Enlace de WhatsApp (`https://wa.me/<solo dígitos, con lada de país>`); vacío si no hay número. */
export function whatsappHref(intlPhone: string = CONTACT_PHONE.en): string {
  const digits = intlPhone.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

/** `telephone` de schema.org (`+52-55-6489-3921`: espacios → guiones); vacío si no hay número. */
export function schemaTelephone(intlPhone: string = CONTACT_PHONE.en): string {
  return intlPhone.trim().replace(/\s+/g, '-');
}

/** Ciudad del dueño, por idioma (la usan la página y el `address` del JSON-LD en español). */
export const ABOUT_CITY = { es: 'Ciudad de México', en: 'Mexico City' } as const;

/** Instagram que confirmó el dueño (MKT-2, HECHOS 2026-10-31). La URL es la que lleva `Organization.sameAs`. */
export const INSTAGRAM_HANDLE = '@tcghunt.mx';
export const INSTAGRAM_URL = 'https://www.instagram.com/tcghunt.mx/';

/** Ruta de la página (sin idioma; con prefijo `/es` y `/en` como `/como-funciona`, MKT-CONV.4). */
export const ABOUT_PATH = '/nosotros';

/** Fecha de la última revisión de los datos de la página (su `lastmod` en el sitemap). */
export const ABOUT_LAST_REVIEW = '2026-11-01';
