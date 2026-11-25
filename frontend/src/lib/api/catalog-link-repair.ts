/**
 * §PRECIO-SIN-ENLACE (correcciones tras gates, a) — `POST /admin/catalog/link-repair {setId}` (setId = UUID LOCAL).
 * Solo toca cartas SIN ligar. ⛔ Nunca `POST /admin/catalog/sync`. ÚNICO punto de mapeo de la respuesta: si backend
 * cambia nombres, solo cambia `readLinkRepair`.
 */
import { apiRequest } from '../api-client';

export type LinkRepairReasonKey =
  | 'collisions'
  | 'conflicts'
  | 'noGroup'
  | 'tcgcsvSource'
  | 'nameMismatch'
  | 'unknownStamp'
  | 'other';

export interface LinkRepairResult {
  linked: number;
  /** Motivo dominante cuando `linked === 0`; `null` si no hay nada que explicar. */
  reason: LinkRepairReasonKey | null;
}

interface RawLinkRepair {
  linked?: number;
  collisions?: number;
  conflicts?: number;
  omitted?: Array<{ reason: string; count: number }>;
  notLinkable?: 'no_group' | 'tcgcsv_source' | null;
}

const OMITTED_KEY: Record<string, LinkRepairReasonKey> = {
  name_mismatch: 'nameMismatch',
  unknown_stamp: 'unknownStamp',
};

export function readLinkRepair(raw: RawLinkRepair): LinkRepairResult {
  const linked = Number(raw.linked) || 0;
  if (linked > 0) return { linked, reason: null };
  if (raw.notLinkable === 'no_group') return { linked: 0, reason: 'noGroup' };
  if (raw.notLinkable === 'tcgcsv_source') return { linked: 0, reason: 'tcgcsvSource' };
  const cands: Array<[number, LinkRepairReasonKey]> = [
    [Number(raw.collisions) || 0, 'collisions'],
    [Number(raw.conflicts) || 0, 'conflicts'],
    ...(raw.omitted ?? []).map((o): [number, LinkRepairReasonKey] => [Number(o.count) || 0, OMITTED_KEY[o.reason] ?? 'other']),
  ];
  const top = cands.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0])[0];
  return { linked: 0, reason: top ? top[1] : 'other' };
}

export async function repairCatalogLinks(setId: string): Promise<LinkRepairResult> {
  const raw = await apiRequest<RawLinkRepair>('/admin/catalog/link-repair', { method: 'POST', body: { setId } });
  return readLinkRepair(raw);
}
