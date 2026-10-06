/**
 * 💰 P-DB-LIMPIEZA · E — `limpieza:republicar` (docs/specs/LIMPIEZA_DB.md §4.5, vía preferida). Propiedad: backend.
 *
 * El guion B deja las piezas de prueba restauradas en `in_stock` (falla cerrado: SQL no sabe resolver precio). Las que
 * YA tienen precio y cajón no le faltan nada, así que la cola «Listas para publicar» NO las enseña
 * (`inventory.service.ts` `pendingPublish`: `missing: []` ⇒ no entra) y se quedaban fuera de venta sin aviso (QA-1).
 *
 * Este comando lee los ids de la fila de rastro de B (`AuditLog` `maintenance.test_data_purge`, `piezasRestauradas`)
 * y los pasa por el pipeline de publicación de siempre (`InventoryService.reevaluateForPublication`: guardas +
 * precio + `claimListed`). ⛔ No decide nada por su cuenta y nunca escribe `listed` directo:
 *  - precio y cajón ⇒ `listed`;
 *  - sin cajón o sin precio ⇒ se queda `in_stock` y SÍ sale en «Listas para publicar» con su motivo (`missing`);
 *  - algo que ni se publica ni sale en la cola (p. ej. gradeada sin certificado) ⇒ «SIN RESOLVER» con el motivo, y el
 *    comando termina con código 2 para que no pase desapercibido;
 *  - una pieza que cambió de estado DESPUÉS de la limpieza (vendida, perdida…) ⇒ se informa y no se toca.
 * Sin `--apply` es un SIMULACRO (`previewPublication`, el mismo recorrido sin escribir). Idempotente: una segunda
 * corrida no cambia nada (lo publicado sale «ya estaba a la venta»).
 */
import type { PrismaService } from '../../prisma/prisma.service';
import type { InventoryService } from './inventory.service';
import type { PublishReevaluationResult } from './inventory-publish.port';

export const PURGE_TRACE_ACTION = 'maintenance.test_data_purge';

export type RepublicarDestino = 'a_la_venta' | 'en_cola' | 'otro_estado' | 'sin_resolver';

export interface RepublicarFila {
  inventoryItemId: string;
  folio: string;
  destino: RepublicarDestino;
  /** En castellano, para el dueño. */
  motivo: string;
}

export interface RepublicarReporte {
  apply: boolean;
  rastro: { id: string; createdAt: Date };
  filas: RepublicarFila[];
  resumen: { aLaVenta: number; enCola: number; otroEstado: number; sinResolver: number };
}

const ESTADO_ES: Record<string, string> = {
  in_stock: 'en inventario',
  listed: 'a la venta',
  reserved: 'apartada',
  in_custody: 'en custodia',
  picking: 'en preparación',
  shipped: 'enviada',
  delivered: 'entregada',
  lost: 'perdida',
  damaged: 'dañada',
  withdrawn: 'retirada',
};

const FALTA_ES: Record<string, string> = { location: 'cajón', price: 'precio' };

function piezasDelRastro(after: unknown): { id: string; folio: string }[] {
  const list = (after as { piezasRestauradas?: unknown } | null)?.piezasRestauradas;
  if (!Array.isArray(list)) {
    throw new Error('El rastro de la limpieza no trae «piezasRestauradas»: no sé qué piezas re-publicar. No se escribió nada.');
  }
  return list.map((x) => {
    const p = x as { id?: unknown; folio?: unknown };
    if (typeof p.id !== 'string' || p.id.length === 0) {
      throw new Error('El rastro de la limpieza trae una pieza sin id. No se escribió nada.');
    }
    return { id: p.id, folio: typeof p.folio === 'string' ? p.folio : p.id };
  });
}

function clasifica(r: PublishReevaluationResult, apply: boolean): Pick<RepublicarFila, 'destino' | 'motivo'> {
  switch (r.outcome) {
    case 'published':
      return { destino: 'a_la_venta', motivo: apply ? 'publicada' : 'se publicaría' };
    case 'already_listed':
      return { destino: 'a_la_venta', motivo: 'ya estaba a la venta' };
    case 'missing_location':
    case 'price_pending': {
      const falta = r.missing.map((m) => FALTA_ES[m] ?? m).join(' y ');
      return { destino: 'en_cola', motivo: `en «Listas para publicar»: le falta ${falta}` };
    }
    case 'not_found':
      return { destino: 'sin_resolver', motivo: 'la pieza ya no existe' };
    default:
      return { destino: 'sin_resolver', motivo: `no se puede publicar: ${r.detail ?? 'guarda de publicación'}` };
  }
}

export async function republicarPiezasRestauradas(
  deps: { prisma: PrismaService; inventory: InventoryService },
  opts: { apply: boolean },
): Promise<RepublicarReporte> {
  const rastro = await deps.prisma.auditLog.findFirst({
    where: { action: PURGE_TRACE_ACTION },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (!rastro) {
    throw new Error(
      'No hay rastro de la limpieza (bitácora «maintenance.test_data_purge»): corre primero el fichero 2 con COMMIT. No se escribió nada.',
    );
  }
  const piezas = piezasDelRastro(rastro.after);
  const actuales = await deps.prisma.inventoryItem.findMany({
    where: { id: { in: piezas.map((p) => p.id) } },
    select: { id: true, status: true, ownerType: true },
  });
  const byId = new Map(actuales.map((a) => [a.id, a]));

  // Solo entran al pipeline las que siguen siendo de plataforma y publicables por estado. Lo que cambió DESPUÉS de la
  // limpieza (una venta real, una pérdida marcada en M1) es real: se informa y no se toca.
  const filas: RepublicarFila[] = [];
  const candidatas: string[] = [];
  for (const p of piezas) {
    const a = byId.get(p.id);
    if (!a) {
      filas.push({ inventoryItemId: p.id, folio: p.folio, destino: 'sin_resolver', motivo: 'la pieza ya no existe' });
    } else if (a.ownerType !== 'platform' || (a.status !== 'in_stock' && a.status !== 'listed')) {
      filas.push({
        inventoryItemId: p.id,
        folio: p.folio,
        destino: 'otro_estado',
        motivo: `cambió después de la limpieza (${a.ownerType === 'platform' ? '' : 'de cliente, '}${ESTADO_ES[a.status] ?? a.status}): no se toca`,
      });
    } else {
      candidatas.push(p.id);
    }
  }
  const results = opts.apply
    ? await deps.inventory.reevaluateForPublication(candidatas)
    : await deps.inventory.previewPublication(candidatas);
  const folioOf = new Map(piezas.map((p) => [p.id, p.folio]));
  for (const r of results) {
    filas.push({ inventoryItemId: r.inventoryItemId, folio: folioOf.get(r.inventoryItemId) ?? r.inventoryItemId, ...clasifica(r, opts.apply) });
  }
  filas.sort((a, b) => a.folio.localeCompare(b.folio));
  const count = (d: RepublicarDestino) => filas.filter((f) => f.destino === d).length;
  return {
    apply: opts.apply,
    rastro: { id: rastro.id, createdAt: rastro.createdAt },
    filas,
    resumen: { aLaVenta: count('a_la_venta'), enCola: count('en_cola'), otroEstado: count('otro_estado'), sinResolver: count('sin_resolver') },
  };
}

/** El texto que ve el dueño. */
export function formatRepublicar(r: RepublicarReporte): string {
  const out: string[] = [];
  out.push(
    r.apply
      ? '=== P-DB-LIMPIEZA · E · RE-PUBLICACIÓN (APLICADA) ==='
      : '=== P-DB-LIMPIEZA · E · SIMULACRO: no se escribió nada. Para aplicarlo, vuelve a correrlo con --apply ===',
  );
  out.push(`Rastro de la limpieza: ${r.rastro.createdAt.toISOString()} · ${r.filas.length} pieza(s) restauradas`);
  out.push('');
  const w = Math.max(5, ...r.filas.map((f) => f.folio.length));
  for (const f of r.filas) out.push(`${f.folio.padEnd(w)}  ${f.motivo}`);
  out.push('');
  out.push(
    `Resumen · a la venta: ${r.resumen.aLaVenta} · en «Listas para publicar»: ${r.resumen.enCola} · ` +
      `cambiaron después (no se tocan): ${r.resumen.otroEstado} · SIN RESOLVER: ${r.resumen.sinResolver}`,
  );
  if (r.resumen.sinResolver > 0) {
    out.push('⚠️ Las «SIN RESOLVER» no están a la venta NI salen en ninguna cola: corrígelas en M1 (editar la pieza) y vuelve a correr esto.');
  }
  if (r.resumen.enCola > 0) {
    out.push('Las de «Listas para publicar» se publican solas en cuanto les pongas cajón (M1) o tengan precio (M2).');
  }
  return out.join('\n');
}
