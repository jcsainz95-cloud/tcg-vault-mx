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

export interface LinkRepairResult {
  linked: number;
  /** Con `linked === 0`: hasta 2 motivos relevantes para CARTAS (con su cuenta; `null` = motivo del set entero). */
  reasons: Array<{ key: LinkRepairReasonKey; count: number | null }>;
  piecesCorrected: number;
  piecesExcluded: Array<{ key: PieceExcludedKey; count: number }>;
}

interface RawLinkRepair {
  linked?: number;
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

export function readLinkRepair(raw: RawLinkRepair): LinkRepairResult {
  const linked = Number(raw.linked) || 0;
  const base = {
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
