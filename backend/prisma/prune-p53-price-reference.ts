/**
 * P-53 §5+§6 · Backfill de `evidenceDate` + poda (dedup) de filas redundantes de SINGLES ya acumuladas.
 *
 * ⚠️ **NO es una migración de schema (DDL).** Las columnas `evidenceDate`/`refKind` ya existen
 * (v1.50.3-f). Esto es una **OPERACIÓN DE DATOS**: idempotente, por LOTES, para correr en una ventana
 * con RESPALDO (money-critical) coordinada con devops. Por defecto corre en **dry-run** (solo mide y
 * reporta); muta solo con `--apply`.
 *
 * ## Qué hace (P-53 §6.1)
 * Alcance EXACTO: `source='tcgcsv_singles'` AND `productType='raw'` AND `gradeKey='raw:NM'` AND
 * `refKind='market'` AND `isManualOverride=false`. (Excluye manual, graded, sellado y cualquier
 * `refKind` no-market: intactos.)
 *
 * Agrupa por `key0 = (cardId, productType, gradeKey, finish, cardProductId)`, ordena por `capturedDate`
 * asc. Un **run** es una secuencia CONTIGUA con el mismo `(priceUsdCents, fxBufferPct)`. Para cada run
 * `[f0, …, fk]`:
 *  - **CONSERVA `f0`** (el punto de cambio: «desde cuándo rige este valor») y fija
 *    `f0.evidenceDate := max(evidenceDate ?? capturedDate)` del run (la última confirmación de ese valor).
 *  - **BORRA `f1 … fk`** (confirmaciones redundantes del MISMO valor).
 *
 * ## Por qué es seguro (P-53 §6.2)
 *  - **No se borra ningún cambio:** dos runs distintos = dos valores de USD distintos = dos filas
 *    conservadas. La serie «valor vigente por fecha» (`computeSetValue` forward-fill) es IDÉNTICA:
 *    para todo `asOf`, la fila más reciente `<= asOf` conserva el mismo `priceUsdCents` (y el MXN se
 *    recompone en vivo).
 *  - **Idempotente:** `evidenceDate` se fija a un `max` que NUNCA retrocede ⇒ una segunda corrida deja
 *    runs de una sola fila y `max = evidenceDate` ya fijado ⇒ sin cambios.
 *  - **Historia congelada intacta:** `SetValueSnapshot`/`PortfolioSnapshot` no se recomputan.
 *  - **Fuera de alcance intacto:** manual/graded/sellado excluidos por el predicado.
 *
 * Uso: `ts-node prisma/prune-p53-price-reference.ts [--apply] [--vacuum] [--batch=500]`.
 */
import { PrismaClient } from '@prisma/client';

/** Fila mínima que la planificación necesita. `fxBufferPct` puede venir como `Decimal` o `number`. */
export interface PrunableRow {
  id: string;
  capturedDate: Date;
  evidenceDate: Date | null;
  priceUsdCents: number | null;
  fxBufferPct: unknown;
}

/** Plan de poda de UN `key0`: qué filas conservar (con su `evidenceDate` nueva) y cuáles borrar. */
export interface CollapsePlan {
  /** `{ id, evidenceDate }` de los `f0` cuya evidencia hay que fijar/avanzar (solo si cambia). */
  updates: { id: string; evidenceDate: Date }[];
  /** ids de las filas redundantes (`f1…fk`) a borrar. */
  deleteIds: string[];
}

function bufferKey(v: unknown): string {
  if (v == null) return 'null';
  return String(Number(v));
}

/** La fecha de EVIDENCIA de una fila: `evidenceDate ?? capturedDate` (P-53 §3). */
function evidenceOf(r: PrunableRow): Date {
  return r.evidenceDate ?? r.capturedDate;
}

/**
 * Planifica la poda de UN `key0`. `rows` NO tiene que venir ordenada: se ordena por `capturedDate` asc
 * aquí (los `capturedDate` son únicos por `key0` bajo la `@@unique`). Pura: no toca la base.
 */
export function planRunCollapse(rows: PrunableRow[]): CollapsePlan {
  const updates: { id: string; evidenceDate: Date }[] = [];
  const deleteIds: string[] = [];
  if (rows.length === 0) return { updates, deleteIds };
  const sorted = [...rows].sort((a, b) => a.capturedDate.getTime() - b.capturedDate.getTime());

  let runStart = 0;
  const flush = (start: number, end: number) => {
    // Run = [start, end). f0 = sorted[start] (el punto de cambio, capturedDate más antiguo).
    const f0 = sorted[start];
    let maxEvidence = evidenceOf(f0);
    for (let i = start + 1; i < end; i += 1) {
      const e = evidenceOf(sorted[i]);
      if (e.getTime() > maxEvidence.getTime()) maxEvidence = e;
      deleteIds.push(sorted[i].id);
    }
    // Solo emite update si la evidencia AVANZA (nunca retrocede) ⇒ idempotente.
    const cur = f0.evidenceDate;
    if (cur == null || cur.getTime() < maxEvidence.getTime()) {
      updates.push({ id: f0.id, evidenceDate: maxEvidence });
    }
  };

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const sameValue =
      prev.priceUsdCents === curr.priceUsdCents && bufferKey(prev.fxBufferPct) === bufferKey(curr.fxBufferPct);
    if (!sameValue) {
      flush(runStart, i);
      runStart = i;
    }
  }
  flush(runStart, sorted.length);
  return { updates, deleteIds };
}

const SCOPE = {
  source: 'tcgcsv_singles' as const,
  productType: 'raw' as const,
  gradeKey: 'raw:NM',
  refKind: 'market' as const,
  isManualOverride: false,
};

async function tableBytes(prisma: PrismaClient): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ size: bigint }[]>(
    `SELECT pg_total_relation_size('"PriceReference"') AS size`,
  );
  return rows[0]?.size ?? BigInt(0);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const doVacuum = args.includes('--vacuum');
  const batchArg = args.find((a) => a.startsWith('--batch='));
  const batchSize = batchArg ? Math.max(1, parseInt(batchArg.split('=')[1], 10) || 500) : 500;
  const prisma = new PrismaClient();
  const log = (m: string) => console.log(`[P-53 prune] ${m}`); // eslint-disable-line no-console

  try {
    log(apply ? 'MODO APLICAR (mutará la base).' : 'MODO DRY-RUN (solo mide; usa --apply para mutar).');
    const bytesBefore = await tableBytes(prisma);
    log(`pg_total_relation_size(PriceReference) ANTES = ${bytesBefore} bytes.`);

    // Lotea por `cardId` (índice existente) para no bloquear la tabla entera.
    const distinct = await prisma.priceReference.findMany({
      where: SCOPE,
      distinct: ['cardId'],
      select: { cardId: true },
    });
    const cardIds = distinct.map((d) => d.cardId);
    log(`${cardIds.length} cartas en alcance; lotes de ${batchSize}.`);

    let scoped = 0;
    let deletable = 0;
    let evidenceUpdates = 0;

    for (let off = 0; off < cardIds.length; off += batchSize) {
      const batch = cardIds.slice(off, off + batchSize);
      const rows = await prisma.priceReference.findMany({
        where: { ...SCOPE, cardId: { in: batch } },
        select: {
          id: true,
          cardId: true,
          finish: true,
          cardProductId: true,
          capturedDate: true,
          evidenceDate: true,
          priceUsdCents: true,
          fxBufferPct: true,
        },
      });
      scoped += rows.length;

      // Agrupa por key0 (cardId, finish, cardProductId) — productType/gradeKey son constantes en el alcance.
      const groups = new Map<string, PrunableRow[]>();
      for (const r of rows) {
        const k = `${r.cardId}|${r.finish}|${r.cardProductId ?? 'null'}`;
        const arr = groups.get(k);
        const pr: PrunableRow = {
          id: r.id,
          capturedDate: r.capturedDate,
          evidenceDate: r.evidenceDate,
          priceUsdCents: r.priceUsdCents,
          fxBufferPct: r.fxBufferPct,
        };
        if (arr) arr.push(pr);
        else groups.set(k, [pr]);
      }

      const updates: { id: string; evidenceDate: Date }[] = [];
      const deleteIds: string[] = [];
      for (const arr of groups.values()) {
        const plan = planRunCollapse(arr);
        updates.push(...plan.updates);
        deleteIds.push(...plan.deleteIds);
      }
      deletable += deleteIds.length;
      evidenceUpdates += updates.length;

      if (apply && (updates.length > 0 || deleteIds.length > 0)) {
        await prisma.$transaction([
          ...updates.map((u) =>
            prisma.priceReference.update({ where: { id: u.id }, data: { evidenceDate: u.evidenceDate } }),
          ),
          // deleteMany ACOTADO por ids del alcance (patrón de poda seguro, cf. graded-estimates.controller).
          ...(deleteIds.length > 0
            ? [prisma.priceReference.deleteMany({ where: { id: { in: deleteIds } } })]
            : []),
        ]);
      }
    }

    log(`Filas en alcance: ${scoped}. Redundantes borrables (f1…fk): ${deletable}. evidenceDate a fijar: ${evidenceUpdates}.`);
    if (!apply) {
      log('DRY-RUN: nada se tocó. Re-corre con --apply dentro de la ventana con respaldo.');
    } else {
      if (doVacuum) {
        // Borrar filas NO reduce el fichero por sí solo; VACUUM devuelve espacio (o el equivalente
        // gestionado de Railway). Fuera de transacción.
        log('VACUUM (ANALYZE) PriceReference…');
        await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "PriceReference"');
      }
      const bytesAfter = await tableBytes(prisma);
      log(`pg_total_relation_size(PriceReference) DESPUÉS = ${bytesAfter} bytes (Δ ${bytesBefore - bytesAfter}).`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Solo corre como script (no al importarlo desde el test de la lógica pura).
if (require.main === module) {
  main().catch((e) => {
    console.error('[P-53 prune] FALLÓ:', e); // eslint-disable-line no-console
    process.exit(1);
  });
}
