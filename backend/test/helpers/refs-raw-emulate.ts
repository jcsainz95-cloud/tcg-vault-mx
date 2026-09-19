/**
 * refs-raw-emulate.ts — emula EN MEMORIA el SQL crudo de H-PERF-1 para los specs UNITARIOS.
 * Propiedad: backend.
 *
 * `PricingService.getReferencesBatch` y `getPricedRawFinishesBatch` dejaron de leer el histórico entero
 * con `priceReference.findMany` y ahora PODAN en la BD con `$queryRaw`:
 *   · getReferencesBatch  → `WITH … max_auto_date …` (manuales perennes ∪ automáticas de la FRESCURA
 *                            EFECTIVA máxima `COALESCE(evidenceDate,capturedDate)` por clave — P-53
 *                            ALTO-3 §3), con WHERE `refKind='market'` + base-card (cardProductId IS NULL o
 *                            kind∈{set_base,other}). El desempate fino lo sigue haciendo `isBetterRef` en Node.
 *   · getPricedRawFinishesBatch → `SELECT DISTINCT (cardId,finish)` con `raw` + `raw:NM` + `priceMxnCents>0`
 *                            + market + base-card.
 *
 * Este helper reproduce ESE filtrado sobre un array de filas en memoria — el MISMO papel que `matchRefWhere`
 * cumplía para el `findMany` mockeado — para que los specs unitarios sigan ejercitando la composición JS
 * (FX viva, `isBetterRef`, claves del Map) sin una BD. La equivalencia byte-a-byte del SQL REAL con el
 * algoritmo previo (histórico completo + `pickBestRef`) sobre Postgres real vive en
 * `test/integration/references-batch-history-prune.e2e-spec.ts`.
 */

function sqlTextOf(sql: any): string {
  if (sql == null) return '';
  if (typeof sql.sql === 'string') return sql.sql;
  if (Array.isArray(sql.strings)) return sql.strings.join(' ');
  return String(sql);
}

const isMarket = (r: any) => r.refKind !== 'graded_estimate'; // enum de 2 valores; undefined ⇒ market
const isBaseCard = (r: any) =>
  r.cardProductId == null || ['set_base', 'other'].includes(r.cardProductKind);
const isManual = (r: any) => r.isManualOverride === true || r.source === 'manual';

/**
 * Devuelve un `jest.fn` para usar como `prisma.$queryRaw`. Despacha por la FORMA del SQL:
 * `SELECT DISTINCT …` → getPricedRawFinishesBatch; en otro caso, la poda de getReferencesBatch.
 * Lee SIEMPRE el array `rows` por referencia (así un spec que muta `rows` — p.ej. borra el estimado —
 * ve el cambio, igual que con el `findMany` mockeado).
 */
export function makeRefsRawQuery(rows: any[]) {
  return jest.fn(async (sql: any) => {
    const text = sqlTextOf(sql);
    if (/SELECT\s+DISTINCT/i.test(text)) {
      const seen = new Set<string>();
      const out: { cardId: string; finish: string }[] = [];
      for (const r of rows) {
        if (r.productType !== 'raw' || r.gradeKey !== 'raw:NM') continue;
        if (!isMarket(r) || !(r.priceMxnCents > 0) || !isBaseCard(r)) continue;
        const k = `${r.cardId}|${r.finish}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ cardId: r.cardId, finish: r.finish });
      }
      return out;
    }
    // getReferencesBatch: market + base-card, ventana (manual ∪ máximo automático por clave).
    // P-53 ALTO-3 (§3): la ventana se mide por FRESCURA EFECTIVA `COALESCE(evidenceDate, capturedDate)`
    // — EL MISMO `COALESCE("evidenceDate","capturedDate")` del `$queryRaw` real (max_auto_date + WHERE).
    // Con `evidenceDate` ausente/null cae a `capturedDate` ⇒ ventana idéntica a la previa (CA-10).
    const effTime = (r: any) => new Date(r.evidenceDate ?? r.capturedDate).getTime();
    const filt = rows.filter((r) => isMarket(r) && isBaseCard(r));
    const byKey = new Map<string, any[]>();
    for (const r of filt) {
      const k = `${r.cardId}|${r.productType}|${r.gradeKey}|${r.finish}`;
      const a = byKey.get(k);
      if (a) a.push(r);
      else byKey.set(k, [r]);
    }
    const out: any[] = [];
    for (const rs of byKey.values()) {
      const autoTimes = rs.filter((r) => !isManual(r)).map(effTime);
      const maxAuto = autoTimes.length ? Math.max(...autoTimes) : null;
      for (const r of rs) {
        if (isManual(r) || (maxAuto != null && effTime(r) === maxAuto)) out.push(r);
      }
    }
    return out;
  });
}
