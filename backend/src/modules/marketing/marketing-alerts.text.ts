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
  AV6: (term: string, people: number, days: number) => ({
    titulo: `Buscan «${term}» y no hay resultado`,
    evidencia: `«${term}»: ${nf(people)} personas distintas sin resultado, en ${nf(days)} días con al menos 2 personas.`,
    accion: `Buscan "${term}" ${nf(people)} personas y no hay resultado: ¿falta en el catálogo?`,
  }),
  // §GSHOP.A: una sola fila con los conteos por problema y ≤ 3 rutas por categoría («y N más» si hay más).
  AV7: (total: number, groups: { flag: string; count: number; examples: string[] }[]) => {
    const label = (g: { flag: string; count: number }): string => {
      const n = nf(g.count);
      switch (g.flag) {
        case 'NOT_FOUND':
          return `${n} no ${g.count === 1 ? 'existe' : 'existen'} (404)`;
        case 'BLOCKED':
          return `${n} bloqueada${g.count === 1 ? '' : 's'} para Google`;
        case 'FETCH_ERROR':
          return `${n} con error al rastrear`;
        case 'DUP_NO_CANON':
          return `${n} duplicada${g.count === 1 ? '' : 's'} sin canónica`;
        default:
          return `${n} rastreada${g.count === 1 ? '' : 's'} sin indexar`;
      }
    };
    const resumen = groups.map(label).join(', ');
    const ejemplos = groups
      .flatMap((g) => [...g.examples, ...(g.count > g.examples.length ? [`y ${nf(g.count - g.examples.length)} más`] : [])])
      .join(', ');
    return {
      titulo: `Google tiene problemas con ${nf(total)} ${total === 1 ? 'ficha' : 'fichas'}`,
      evidencia: `Google tiene problemas con ${nf(total)} ${total === 1 ? 'ficha' : 'fichas'}: ${resumen}. Ejemplos: ${ejemplos}.`,
      accion: 'Revisa esas páginas en Search Console (Inspección de URL): si ya no existen, quítalas; si es una duplicada, confirma su canónica.',
    };
  },
} as const;

export const NO_ALERTS = { titulo: 'Sin avisos esta semana', evidencia: 'Ninguna regla pasó su umbral.', accion: '' } as const;
export const NOT_EVALUATED = (what: string) => ({ titulo: `No se evaluó: ${what}`, evidencia: '', accion: '' });

/** Cuando hay fuentes sin medir, «Sin avisos» sería engañoso: se dice que no se pudo evaluar. */
export const NOT_FULLY_EVALUATED = {
  titulo: 'No se pudo evaluar esta semana por completo',
  evidencia: 'Faltan fuentes de datos (abajo): no se puede asegurar que no haya avisos.',
  accion: '',
} as const;
