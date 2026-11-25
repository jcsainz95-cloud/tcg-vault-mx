/**
 * §BOVEDA-COBRADA-SIN-PIEZAS (visibilidad): UN solo punto de mapeo entre lo que el backend exponga y lo que pintan
 * las pantallas. Las formas exactas están pendientes de confirmar con el backend: todos los campos son OPCIONALES y
 * cualquier ausencia se lee como «no hay nada que mostrar». Si el backend renombra un campo, se cambia SOLO aquí.
 * ⛔ La pantalla no calcula la regla (cuáles pedidos están afectados): solo muestra lo que el servidor manda.
 */
import { formatDateTimeShortMx } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';

// ---------- Tablero ----------

/** Pedidos pagados con cartas sin asignar. 0, ausente o no numérico ⇒ 0 (la tarjeta no se pinta). */
export function unassignedOrdersCount(d: {
  workQueue?: { vaultOrdersWithUnassignedItems?: number | null } | null;
  vaultOrdersWithUnassignedItems?: number | null;
}): number {
  const raw = d.workQueue?.vaultOrdersWithUnassignedItems ?? d.vaultOrdersWithUnassignedItems;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** Destino del enlace del tablero y del filtro de Pedidos (`GET /admin/orders?mismatch=true`). */
export const UNASSIGNED_ORDERS_HREF = '/admin/m3?mismatch=true';

/** `?mismatch=true` / `?fulfillmentMode=vault|direct_ship` de la URL de Pedidos. Cualquier otro valor ⇒ sin filtro. */
export function parseMismatch(raw: string | string[] | undefined): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'true';
}
export type OrderModeFilter = '' | 'vault' | 'direct_ship';
export function parseModeFilter(raw: string | string[] | undefined): OrderModeFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'vault' || v === 'direct_ship' ? v : '';
}

// ---------- Lista de pedidos ----------

/** Cartas sin asignar de un pedido de la lista (0 ⇒ sin marca). Acepta el conteo o un booleano `mismatch`. */
export function orderUnassignedCount(o: { unassignedItemCount?: number | null; mismatch?: boolean | null }): number {
  if (typeof o.unassignedItemCount === 'number' && Number.isFinite(o.unassignedItemCount)) {
    return Math.max(0, Math.floor(o.unassignedItemCount));
  }
  return o.mismatch === true ? 1 : 0;
}

// ---------- Detalle del pedido ----------

export type LineFulfillment =
  | { kind: 'in_vault' }
  | { kind: 'replaced'; from: string | null; to: string | null }
  | { kind: 'attention'; reasonKey: string };

const KNOWN_REASONS = new Set([
  'no_equivalent_copy',
  'sold_to_other',
  'reserved_other',
  'withdrawn',
  'not_found',
]);

/** Código crudo del servidor ⇒ clave de texto llano. Un código desconocido NUNCA se muestra tal cual. */
export function reasonKey(raw: string | null | undefined): string {
  const k = (raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return KNOWN_REASONS.has(k) ? k : 'unknown';
}

export interface FulfillmentFields {
  fulfillmentFailedAt?: string | null;
  fulfillmentFailedReason?: string | null;
  replacedInventoryItemId?: string | null;
  /** Folios para el «INV-X → INV-Y». */
  folio?: string | null;
  replacedFolio?: string | null;
}

/**
 * Estado por carta. `null` ⇒ no se pinta (p. ej. pedido que no es de bóveda o aún sin liquidar y sin novedad).
 * `settledVault` = pedido de bóveda liquidado: ahí una línea sin novedad es «En su bóveda».
 */
export function lineFulfillment(it: FulfillmentFields, settledVault: boolean): LineFulfillment | null {
  if (it.fulfillmentFailedAt || it.fulfillmentFailedReason) {
    return { kind: 'attention', reasonKey: reasonKey(it.fulfillmentFailedReason) };
  }
  if (it.replacedInventoryItemId) {
    return { kind: 'replaced', from: it.replacedFolio ?? null, to: it.folio ?? null };
  }
  return settledVault ? { kind: 'in_vault' } : null;
}

// ---------- Bóvedas de clientes ----------

/** «Pedido pagado, faltan k piezas»: k total y cuántos pedidos. `null` ⇒ sin renglón. */
export function vaultMissingPieces(v: {
  unassignedPaidOrders?: { orderId: string; orderNumber?: string | null; missingCount: number }[] | null;
}): { pieces: number; orders: number } | null {
  const list = (v.unassignedPaidOrders ?? []).filter((o) => Number.isFinite(o.missingCount) && o.missingCount > 0);
  if (list.length === 0) return null;
  return { pieces: list.reduce((n, o) => n + o.missingCount, 0), orders: list.length };
}

// ---------- Bitácora ----------

export interface AuditDetailRow {
  depth: number;
  key: string;
  /** `null` ⇒ fila de encabezado de un objeto anidado (sin valor). */
  value: string | null;
}
export interface AuditDetailSection {
  /** `before` | `after`. */
  side: 'before' | 'after';
  rows: AuditDetailRow[];
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MAX_DEPTH = 4;

function flatten(
  value: unknown,
  depth: number,
  out: AuditDetailRow[],
  locale: AppLocale,
  yes: string,
  no: string,
): void {
  if (value === null || typeof value !== 'object') return;
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v])
    : Object.entries(value as Record<string, unknown>);
  for (const [key, v] of entries) {
    if (v !== null && typeof v === 'object') {
      if (depth >= MAX_DEPTH) {
        out.push({ depth, key, value: JSON.stringify(v) });
      } else if (Object.keys(v as object).length === 0) {
        out.push({ depth, key, value: '—' });
      } else {
        out.push({ depth, key, value: null });
        flatten(v, depth + 1, out, locale, yes, no);
      }
      continue;
    }
    let text: string;
    if (v === null || v === undefined) text = '—';
    else if (typeof v === 'boolean') text = v ? yes : no;
    else if (typeof v === 'string' && ISO_DATETIME.test(v)) text = formatDateTimeShortMx(v, locale) || v;
    else text = String(v);
    out.push({ depth, key, value: text });
  }
}

/**
 * Detalle de un renglón de la bitácora a partir de `before`/`after`. Ausente o vacío ⇒ `null` («Sin detalle»).
 * Un valor primitivo suelto (no objeto) se muestra como una fila con clave `value`.
 */
export function auditDetail(
  a: { before?: unknown; after?: unknown },
  locale: AppLocale,
  yes: string,
  no: string,
): AuditDetailSection[] | null {
  const sections: AuditDetailSection[] = [];
  for (const side of ['before', 'after'] as const) {
    const raw = a[side];
    if (raw === undefined || raw === null) continue;
    const rows: AuditDetailRow[] = [];
    if (typeof raw === 'object') flatten(raw, 0, rows, locale, yes, no);
    else rows.push({ depth: 0, key: 'value', value: String(raw) });
    if (rows.length > 0) sections.push({ side, rows });
  }
  return sections.length > 0 ? sections : null;
}
