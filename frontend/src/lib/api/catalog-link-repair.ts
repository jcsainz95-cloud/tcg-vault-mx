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
  /** Motivo dominante cuando `linked === 0`; `null` si no hay nada que explicar. */
  reason: LinkRepairReasonKey | null;
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
  if (linked > 0) return { linked, reason: null, ...base };
  if (raw.notLinkable === 'no_group') return { linked: 0, reason: 'noGroup', ...base };
  if (raw.notLinkable === 'tcgcsv_source') return { linked: 0, reason: 'tcgcsvSource', ...base };
  const cands: Array<[number, LinkRepairReasonKey]> = [
    [Number(raw.collisions) || 0, 'collisions'],
    [Number(raw.conflicts) || 0, 'ownerConflict'],
    ...(raw.omitted ?? []).map((o): [number, LinkRepairReasonKey] => [Number(o.count) || 0, OMITTED_KEY[o.reason] ?? 'other']),
  ];
  const top = cands.filter(([n]) => n > 0).sort((x, y) => y[0] - x[0])[0];
  return { linked: 0, reason: top ? top[1] : 'other', ...base };
}

export async function repairCatalogLinks(setId: string): Promise<LinkRepairResult> {
  const raw = await apiRequest<RawLinkRepair>('/admin/catalog/link-repair', { method: 'POST', body: { setId } });
  return readLinkRepair(raw);
}
