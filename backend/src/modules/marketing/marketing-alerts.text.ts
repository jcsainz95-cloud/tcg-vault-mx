/**
 * marketing-alerts.text.ts — plantillas en español de los avisos del Resumen (MKT_PANEL_V2 §2). PURO. Cada plantilla cita sus
 * números (`evidencia`) y dice qué hacer (`accion`). Sin IA: texto fijo con huecos.
 */
const nf = (n: number): string => new Intl.NumberFormat('es-MX').format(n);
export const pesosPct = (n: number): string => `${n < 0 ? '−' : '+'}${Math.abs(n)} %`;

export const AV_TEXT = {
  AV1: (starts: number) => ({
    titulo: 'Iniciaron pagos y nadie pagó',
    evidencia: `${nf(starts)} inicios de pago y 0 pedidos pagados en la semana.`,
    accion: `Iniciaron ${nf(starts)} pagos y nadie pagó: prueba el pago tú mismo.`,
  }),
  AV2: (group: string, prev: number, curLabel: string, pct: number | null, instagram: boolean) => ({
    titulo: `${group} bajó mucho`,
    evidencia: `${group}: ${nf(prev)} sesiones la semana anterior y ${curLabel} esta semana${pct === null ? '' : ` (${pesosPct(pct)})`}.`,
    accion: `${group} bajó de ${nf(prev)} a ${curLabel}${pct === null ? '' : ` (${pesosPct(pct)})`}: ${instagram ? 'revisa que la historia lleve el enlace.' : 'revisa qué cambió en esa fuente.'}`,
  }),
  AV3: (name: string, views: number) => ({
    titulo: `${name}: vistas sin venta`,
    evidencia: `${name}: ${nf(views)} vistas, 0 vendidas y casi nadie la agregó al carrito.`,
    accion: `${name}: ${nf(views)} vistas, 0 ventas: revisa precio, foto y descripción.`,
  }),
  AV4: (page: string, impressions: number, position: number) => ({
    titulo: `${page} sin clics en Google`,
    evidencia: `${page}: ${nf(impressions)} impresiones en Google, 0 clics, posición media ${position}.`,
    accion: `${page} salió ${nf(impressions)} veces en Google sin clics (posición ${position}): mejora título y descripción de esa ficha.`,
  }),
  AV5: (name: string, quotes: number) => ({
    titulo: `${name}: la cotizan y no la tienes`,
    evidencia: `${name}: ${nf(quotes)} cotizaciones de buylist en la semana y 0 unidades a la venta.`,
    accion: `Te la cotizan ${nf(quotes)} veces y no tienes a la venta: súbela de oferta o consíguela.`,
  }),
  AV6: (term: string, count: number, days: number) => ({
    titulo: `Buscan «${term}» y no hay resultado`,
    evidencia: `«${term}»: ${nf(count)} búsquedas sin resultado en ${nf(days)} días distintos.`,
    accion: `Buscan "${term}" ${nf(count)} veces y no hay resultado: ¿falta en el catálogo?`,
  }),
} as const;

export const NO_ALERTS = { titulo: 'Sin avisos esta semana', evidencia: 'Ninguna regla pasó su umbral.', accion: '' } as const;
export const NOT_EVALUATED = (what: string) => ({ titulo: `No se evaluó: ${what}`, evidencia: '', accion: '' });
