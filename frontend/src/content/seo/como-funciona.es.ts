/**
 * ⭐ §MKT tienda §E4 — `/como-funciona` (brief v1 §3.1: bóveda, cotizador/buylist, envío y revisión de
 * cada carta, frases cortas y comprobables, «Última revisión» visible).
 *
 * El repo de marketing NO tiene un texto propio para esta página (medido 2026-10-18: ningún `copy.md`
 * ni `plan/*.md` la redacta; `RESPUESTAS.md` §12.2 sí tiene las respuestas aprobadas de esos temas).
 * Por eso la página NO redacta nada: COMPONE respuestas públicas de §12.2 por id (el texto vive en
 * `faq.es.ts`, una sola fuente) bajo los encabezados de grupo del propio manual. Si una FAQ vence
 * (`validThrough`), desaparece también de aquí.
 *
 * Cubre las dos correcciones del brief §E4: cotizar es sin cuenta, vender pide cuenta con correo
 * verificado (P12) y CLABE (P17); la guía la pone TCG HUNT y su costo fijo se descuenta del pago (P15).
 * ⛔ El paso «autenticamos» de la v1 §3.1 se retiró: la revisión es «revisamos / verificamos» (P7, P17).
 */
import type { FaqGroup } from './faq.es';

export const HOW_IT_WORKS_SECTIONS: readonly { group: FaqGroup; faqIds: readonly string[] }[] = [
  { group: 'Comprar', faqIds: ['P4', 'P5', 'P3'] },
  { group: 'Bóveda', faqIds: ['P1', 'P2', 'P24'] },
  { group: 'Vender', faqIds: ['P12', 'P15', 'P17'] },
  { group: 'Cartas y condición', faqIds: ['P7'] },
];
