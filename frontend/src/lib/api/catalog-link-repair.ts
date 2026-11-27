/**
 * §PRECIO-SIN-ENLACE (correcciones tras gates, a) — `POST /admin/catalog/link-repair {setId}` (setId = UUID LOCAL).
 * Solo toca cartas SIN ligar. ⛔ Nunca `POST /admin/catalog/sync`. ÚNICO punto de mapeo de la respuesta: si backend
 * cambia nombres, solo cambia `readLinkRepair`.
 */
import { apiRequest } from '../api-client';

export type LinkRepairReasonKey =
  | 'collisions'
  | 'ownerConflict'
  | 'noGroup'
  | 'tcgcsvSource'
  | 'nameMismatch'
  | 'noLocalCard'
  | 'alreadyLinked'
  | 'other';

export type PieceExcludedKey =
  | 'customerVault' | 'status' | 'reserved' | 'order' | 'shipment' | 'dispute' | 'movement'
  | 'ambiguousFinishes' | 'changedConcurrently' | 'other';

/** §AUTO-ENLACE contrato §2: motivo por set. */
export type LinkSetReason =
  | 'group_ambiguous' | 'group_none' | 'collisions' | 'name_mismatch' | 'promo_route'
  | 'wotc_pending' | 'provider_failing' | 'tcgcsv_source' | 'not_in_provider';
export const LINK_SET_REASONS: readonly LinkSetReason[] = [
  'group_ambiguous', 'group_none', 'collisions', 'name_mismatch', 'promo_route',
  'wotc_pending', 'provider_failing', 'tcgcsv_source', 'not_in_provider',
];
/** Grupo de la fuente de precios (TCGCSV) usado por el set (solo lectura). */
export interface LinkGroupUsed { groupId: number; name: string; via: 'auto' | 'confirmed' | 'promo_table' }

export interface LinkRepairResult {
  linked: number;
  /** §AUTO-ENLACE §4: precios escritos en la MISMA llamada. `null` = backend previo (no se sabe). */
  priced: number | null;
  groupUsed: LinkGroupUsed | null;
  reason: LinkSetReason | null;
  nextAttemptAt: string | null;
  /** Con `linked === 0`: hasta 2 motivos relevantes para CARTAS (con su cuenta; `null` = motivo del set entero). */
  reasons: Array<{ key: LinkRepairReasonKey; count: number | null }>;
  piecesCorrected: number;
  piecesExcluded: Array<{ key: PieceExcludedKey; count: number }>;
}

interface RawLinkRepair {
  linked?: number;
  priced?: number;
  groupUsed?: { groupId?: number; name?: string; via?: string } | null;
  reason?: string | null;
  nextAttemptAt?: string | null;
  collisions?: number;
  conflicts?: number;
  omitted?: Array<{ reason: string; count: number }>;
  notLinkable?: 'no_group' | 'tcgcsv_source' | null;
  piecesCorrected?: number;
  piecesExcluded?: Array<{ reason: string; count: number }>;
}

const OMITTED_KEY: Record<string, LinkRepairReasonKey> = {
  name_mismatch: 'nameMismatch',
  no_local_card: 'noLocalCard',
  card_already_linked: 'alreadyLinked',
  owner_conflict: 'ownerConflict',
};

const EXCLUDED_KEY: Record<string, PieceExcludedKey> = {
  customer_vault: 'customerVault',
  status: 'status',
  reserved: 'reserved',
  order: 'order',
  shipment: 'shipment',
  dispute: 'dispute',
  ambiguous_finishes: 'ambiguousFinishes',
  changed_concurrently: 'changedConcurrently',
};

export function readGroupUsed(g: { groupId?: number; name?: string; via?: string } | null | undefined): LinkGroupUsed | null {
  if (!g || typeof g.name !== 'string' || !Number.isFinite(Number(g.groupId))) return null;
  const via = g.via === 'confirmed' || g.via === 'promo_table' ? g.via : 'auto';
  return { groupId: Number(g.groupId), name: g.name, via };
}

export function readLinkRepair(raw: RawLinkRepair): LinkRepairResult {
  const linked = Number(raw.linked) || 0;
  const base = {
    priced: raw.priced == null ? null : Number(raw.priced) || 0,
    groupUsed: readGroupUsed(raw.groupUsed),
    reason: (LINK_SET_REASONS as readonly string[]).includes(raw.reason ?? '') ? (raw.reason as LinkSetReason) : null,
    nextAttemptAt: raw.nextAttemptAt ?? null,
    piecesCorrected: Number(raw.piecesCorrected) || 0,
    piecesExcluded: (raw.piecesExcluded ?? [])
      .filter((e) => Number(e.count) > 0)
      .map((e) => ({
        key: (e.reason.startsWith('movement:') ? 'movement' : EXCLUDED_KEY[e.reason]) ?? ('other' as PieceExcludedKey),
        count: Number(e.count) || 0,
      })),
  };
  if (linked > 0) return { linked, reasons: [], ...base };
  if (raw.notLinkable === 'no_group') return { linked: 0, reasons: [{ key: 'noGroup', count: null }], ...base };
  if (raw.notLinkable === 'tcgcsv_source') return { linked: 0, reasons: [{ key: 'tcgcsvSource', count: null }], ...base };
  // `no_local_card` incluye sellado y casi siempre gana por volumen: se lista SOLO si no hay otro motivo de cartas.
  const sum = (k: string) => (raw.omitted ?? []).filter((o) => o.reason === k).reduce((n, o) => n + (Number(o.count) || 0), 0);
  const ordered: Array<[number, LinkRepairReasonKey]> = [
    [(Number(raw.conflicts) || 0) + sum('owner_conflict'), 'ownerConflict'],
    [sum('name_mismatch'), 'nameMismatch'],
    [sum('card_already_linked'), 'alreadyLinked'],
    [Number(raw.collisions) || 0, 'collisions'],
  ];
  const cardReasons = ordered.filter(([n]) => n > 0).slice(0, 2).map(([n, key]) => ({ key, count: n }));
  if (cardReasons.length) return { linked: 0, reasons: cardReasons, ...base };
  const noLocal = sum('no_local_card');
  if (noLocal > 0) return { linked: 0, reasons: [{ key: 'noLocalCard', count: noLocal }], ...base };
  return { linked: 0, reasons: [{ key: 'other', count: null }], ...base };
}

export async function repairCatalogLinks(setId: string): Promise<LinkRepairResult> {
  const raw = await apiRequest<RawLinkRepair>('/admin/catalog/link-repair', { method: 'POST', body: { setId } });
  return readLinkRepair(raw);
}
