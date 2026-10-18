/**
 * marketing-query.ts — adapta una query de objeto (`{ pantalla, week, … }`) a los argumentos POSICIONALES de los handlers
 * de `MarketingController` (v1.104, nota `CEQ-MKT-1`: una llave por `@Query('<nombre>')`, ⛔ sin `@Query()` entero).
 * El orden es el de los handlers; si cambia allí, esto deja de compilar o las pruebas de conducta se ponen rojas.
 */
export interface MktQuery {
  pantalla?: string;
  format?: string;
  week?: string;
  weekStart?: string;
  month?: string;
  from?: string;
  to?: string;
  day?: string;
  preset?: string;
}

/** `week, weekStart, month, from, to, day, preset` — la cola de parámetros de periodo de los cinco handlers. */
export const periodArgs = (q: MktQuery) => [q.week, q.weekStart, q.month, q.from, q.to, q.day, q.preset] as const;

/** `aggregates(req, …)` y `panel(user, …)`: `pantalla` + periodo. */
export const screenArgs = (q: MktQuery) => [q.pantalla, ...periodArgs(q)] as const;

/** `export(user, res, …)`: `pantalla`, `format` + periodo. */
export const exportArgs = (q: MktQuery) => [q.pantalla, q.format, ...periodArgs(q)] as const;
