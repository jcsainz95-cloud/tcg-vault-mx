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

/**
 * Lectura del contador: `null` EXPLÍCITO = la consulta del servidor falló ⇒ «no se pudo medir» (⛔ nunca un 0);
 * ausente o 0 ⇒ nada; N > 0 ⇒ el conteo.
 */
export type UnassignedReading = { kind: 'none' } | { kind: 'count'; n: number } | { kind: 'unmeasured' };
export function unassignedOrdersReading(d: {
  workQueue?: { vaultOrdersWithUnassignedItems?: number | null } | null;
  vaultOrdersWithUnassignedItems?: number | null;
}): UnassignedReading {
  const wq = d.workQueue ?? undefined;
  const raw = wq && 'vaultOrdersWithUnassignedItems' in wq ? wq.vaultOrdersWithUnassignedItems : d.vaultOrdersWithUnassignedItems;
  if (raw === null) return { kind: 'unmeasured' };
  const n = unassignedOrdersCount(d);
  return n > 0 ? { kind: 'count', n } : { kind: 'none' };
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

// Motivos que emite el backend (a3f81be5). Cualquier otro ⇒ «unknown» (frase genérica, nunca el código).
const KNOWN_REASONS = new Set(['no_equivalent_copy', 'double_charge', 'item_missing', 'unassigned']);

/** Código crudo del servidor ⇒ clave de texto llano. Un código desconocido NUNCA se muestra tal cual. */
export function reasonKey(raw: string | null | undefined): string {
  const k = (raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return KNOWN_REASONS.has(k) ? k : 'unknown';
}

export type FulfillmentState = 'assigned' | 'replaced' | 'needs_attention' | 'unassigned';

export interface FulfillmentFields {
  /** Fuente del estado por carta (backend). Ausente (servidor anterior) ⇒ se deriva de los campos de abajo. */
  fulfillmentState?: FulfillmentState | null;
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
  switch (it.fulfillmentState) {
    case 'assigned':
      return settledVault ? { kind: 'in_vault' } : null;
    case 'replaced':
      return { kind: 'replaced', from: it.replacedFolio ?? null, to: it.folio ?? null };
    case 'needs_attention':
      return { kind: 'attention', reasonKey: reasonKey(it.fulfillmentFailedReason) };
    case 'unassigned':
      return { kind: 'attention', reasonKey: 'unassigned' };
    default:
      break;
  }
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

/** Traduce el valor de ciertas claves del detalle (p. ej. `was`); `null` ⇒ se muestra tal cual. */
export type AuditValueLabel = (key: string, value: string) => string | null;
/** Traduce la CLAVE (`was` ⇒ «Estaba»); `null` ⇒ se muestra tal cual. */
export type AuditKeyLabel = (key: string) => string | null;

function flatten(
  value: unknown,
  depth: number,
  out: AuditDetailRow[],
  locale: AppLocale,
  yes: string,
  no: string,
  label?: AuditValueLabel,
  keyLabel?: AuditKeyLabel,
): void {
  if (value === null || typeof value !== 'object') return;
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v])
    : Object.entries(value as Record<string, unknown>);
  const hasFolio = !Array.isArray(value) && typeof (value as Record<string, unknown>).folio === 'string';
  for (const [rawKey, v] of entries) {
    // Con folio, el id interno sobra; sin folio, el id se muestra abreviado (nunca el UUID entero).
    if (hasFolio && rawKey === 'inventoryItemId') continue;
    const key = keyLabel?.(rawKey) ?? rawKey;
    if (v !== null && typeof v === 'object') {
      if (depth >= MAX_DEPTH) {
        out.push({ depth, key, value: JSON.stringify(v) });
      } else if (Object.keys(v as object).length === 0) {
        out.push({ depth, key, value: '—' });
      } else {
        out.push({ depth, key, value: null });
        flatten(v, depth + 1, out, locale, yes, no, label, keyLabel);
      }
      continue;
    }
    let text: string;
    if (v === null || v === undefined) text = '—';
    else if (typeof v === 'boolean') text = v ? yes : no;
    else if (typeof v === 'string' && label?.(rawKey, v)) text = label(rawKey, v)!;
    else if (typeof v === 'string' && rawKey === 'inventoryItemId') text = v.length > 12 ? `${v.slice(0, 8)}…` : v;
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
  label?: AuditValueLabel,
  keyLabel?: AuditKeyLabel,
): AuditDetailSection[] | null {
  const sections: AuditDetailSection[] = [];
  for (const side of ['before', 'after'] as const) {
    const raw = a[side];
    if (raw === undefined || raw === null) continue;
    const rows: AuditDetailRow[] = [];
    if (typeof raw === 'object') flatten(raw, 0, rows, locale, yes, no, label, keyLabel);
    else rows.push({ depth: 0, key: 'value', value: String(raw) });
    if (rows.length > 0) sections.push({ side, rows });
  }
  return sections.length > 0 ? sections : null;
}

/**
 * Piezas de `vaultPieces` SIN las líneas cuyo estado no es «asignada» (requiere atención / sin asignar): el estado de la
 * línea ya lo dice y la lista de piezas no puede contradecirlo con «En su bóveda» (qa I-5).
 */
export function piecesExceptUnassigned<P extends { inventoryItemId: string }>(
  pieces: P[],
  items: { inventoryItemId: string; fulfillmentState?: FulfillmentState | null }[] | undefined,
): P[] {
  const bad = new Set(
    (items ?? [])
      .filter((i) => i.fulfillmentState === 'needs_attention' || i.fulfillmentState === 'unassigned')
      .map((i) => i.inventoryItemId),
  );
  return bad.size === 0 ? pieces : pieces.filter((p) => !bad.has(p.inventoryItemId));
}

// ---------- Datos de la carta en la línea / bloque «Pagadas sin asignar» (dueño, producción 2026-11-26) ----------

/** Lo que se sabe de la carta de una línea. Todo opcional: lo que falte se omite (⛔ nada inventado). Un solo punto de mapeo. */
export interface LineCardFacts {
  name: string | null;
  setName: string | null;
  /** Clave corta del set (`setKey` del backend). */
  setCode: string | null;
  number: string | null;
  condition: string | null;
  finish: string | null;
  folio: string | null;
  imageUrl: string | null;
}
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * Detalle de pedido (backend 92fe0cf0): `items[].card` (congelado) + aditivos al nivel del ítem `setKey`, `imageUrl`,
 * `finish`, `folio`, `replacedFolio`. Líneas pagadas sin asignar: el mismo vocabulario con `card.setKey` / `imageUrl`.
 */
export function lineCardFacts(it: {
  card?: Record<string, unknown> | null;
  folio?: string | null;
  replacedFolio?: string | null;
  setKey?: string | null;
  imageUrl?: string | null;
  finish?: string | null;
}): LineCardFacts {
  const c = (it.card ?? {}) as Record<string, unknown>;
  const cond = s(c.rawCondition) ?? ([s(c.gradingCompany), s(c.gradeValue)].filter(Boolean).join(' ') || null) ?? s(c.conditionLabel);
  return {
    name: s(c.name),
    setName: s(c.setName),
    setCode: s(it.setKey) ?? s(c.setKey) ?? s(c.setPtcgoCode),
    number: s(c.number),
    condition: cond,
    finish: s(it.finish),
    // Folio ORIGINAL pagado: el de la pieza que se repuso, si la hubo.
    folio: s(it.replacedFolio) ?? s(it.folio),
    imageUrl: s(it.imageUrl) ?? s(c.imageSmallUrl),
  };
}

/** `/admin/m1?addQ=<nombre>`: abre el alta de M1 con la búsqueda ya hecha por esa carta. */
export function inventorySearchHref(name: string | null): string | null {
  return name ? `/admin/m1?addQ=${encodeURIComponent(name)}` : null;
}

/** Línea pagada sin asignar de la bóveda de un cliente (`unassignedLines[]` de `physical-inventory`, backend 92fe0cf0). */
export interface PaidUnassignedLine {
  orderItemId: string;
  orderId: string;
  orderNumber: string | null;
  folio: string | null;
  reason: string | null;
  card: Record<string, unknown> | null;
  finish: string | null;
  imageUrl: string | null;
}
export function paidUnassignedLines(d: { unassignedLines?: { orderItemId: string; orderId: string; orderNumber: string | null; folio: string | null; fulfillmentFailedReason: string | null; card: Record<string, unknown> | null; finish: string | null; imageUrl: string | null }[] | null } | null | undefined): PaidUnassignedLine[] {
  return (d?.unassignedLines ?? [])
    .filter((l) => l && typeof l.orderId === 'string')
    .map((l) => ({ orderItemId: l.orderItemId, orderId: l.orderId, orderNumber: l.orderNumber ?? null, folio: l.folio ?? null, reason: l.fulfillmentFailedReason ?? null, card: l.card ?? null, finish: l.finish ?? null, imageUrl: l.imageUrl ?? null }));
}
