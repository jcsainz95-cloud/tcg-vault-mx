/**
 * card-show-content.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.9 C3-W; ARCHITECTURE §4.CARDSHOW.m).
 *
 * ⭐ **Contenido PÚBLICO del evento + enlaces RICOS del correo de BIENVENIDA (C3-W).**
 *
 * Por decisión del dueño (2026-10-16, rama `feat/event-landing`) los datos del evento (fecha, sede,
 * horarios, precios de mesa, niveles de patrocinio, WhatsApp, Drive, Maps) **YA SON PÚBLICOS** y por
 * eso viven **en el código** (a diferencia de la fase de secreto previa, §CARDSHOW.0). Son el mismo
 * dato que la landing muestra; una sola fuente para el correo evita que diverja del sitio.
 *
 * ⛔ **ÚNICO SECRETO que sigue fuera del repo:** los NOMBRES de patrocinador. Este módulo ⛔ NO contiene
 * ni un nombre de patrocinador (los textos del dueño tampoco los mencionan). Si alguna vez un nombre de
 * patrocinador tuviera que entrar a un correo, NO se escribe aquí: entra por entorno.
 *
 * Los textos verbatim de las 3 variantes de bienvenida viven en `card-show-welcome.templates.ts`; aquí
 * viven solo los ENLACES (y el número de WhatsApp / URLs externas públicas que esos enlaces usan).
 */

import { CardShowLeadType } from '@prisma/client';

/** WhatsApp público del evento (dato público del dueño; también va en el cierre del correo a patrocinador). */
export const CARD_SHOW_WHATSAPP_E164 = '525564893921';
/** El WhatsApp en formato legible para el cuerpo del correo a patrocinador (cierre verbatim del dueño). */
export const CARD_SHOW_WHATSAPP_HUMAN = '55 6489 3921';

/** URL pública del deck de patrocinio en Google Drive (dato público del dueño). */
export const CARD_SHOW_DECK_URL =
  'https://drive.google.com/file/d/1DP9p8yXA8ThLP1uyWVjSCB13gD5P1bzd/view';

/** «Cómo llegar» (Google Maps) a la sede — coordenadas por texto, dato público del dueño. */
export const CARD_SHOW_MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=Jos%C3%A9+del+Castillo+3%2C+San+Jos%C3%A9+Insurgentes%2C+Benito+Ju%C3%A1rez%2C+CDMX';

/** mailto del contacto de patrocinio (cc al correo del café), con asunto prellenado (verbatim del dueño). */
export const CARD_SHOW_SPONSOR_MAILTO =
  'mailto:jsainz@tcghunt.mx?cc=cardshow@jakomi.mx&subject=Patrocinio%20Card%20Show%20CDMX';

/**
 * WhatsApp para APARTAR MESA: base verbatim del dueño (texto prellenado) + `utm_source=email`. Como la
 * base ya trae `?text=…`, el utm se añade con `&`.
 */
export const CARD_SHOW_RESERVE_TABLE_WA_URL =
  `https://wa.me/${CARD_SHOW_WHATSAPP_E164}?text=Hola%2C%20quiero%20apartar%20una%20mesa%20para%20el%20Card%20Show%20CDMX%20(5%E2%80%936%20dic).%20Me%20interesa%20la%20mesa%20%23` +
  '&utm_source=email';

/** «Ver el plano de mesas» en la landing, con utm propios (enlace de dominio propio + utm permitido en C3-W). */
export const CARD_SHOW_PLANO_URL =
  'https://tcghunt.mx/card-show#plano?utm_source=email&utm_campaign=cardshow-dic26';

/**
 * «Agregar al calendario» (.ics con los dos días, America/Mexico_City). El `.ics` lo sirve el **dominio
 * propio** (frontend / un endpoint estático); el correo solo enlaza. Se arma sobre `base` = `publicBase()`
 * del backend (mismo origen que los enlaces de confirmación) para no fijar el dominio dos veces.
 *
 * ⚠️ DEPENDENCIA (frontend/devops): esta ruta `.ics` DEBE servirse en el dominio propio. Hoy NO hay
 * endpoint `.ics` en el contrato; ver `BACKEND_NOTES §CARDSHOW` (punto para devops/arquitecto).
 */
export function cardShowCalendarIcsUrl(base: string): string {
  const b = base.replace(/\/+$/, '');
  return `${b}/card-show/card-show-cdmx.ics?utm_source=email&utm_campaign=cardshow-dic26`;
}

/** La variante de bienvenida que corresponde a cada tipo de lead. */
export type WelcomeVariant = CardShowLeadType; // 'merchant' | 'sponsor' | 'visitor'
