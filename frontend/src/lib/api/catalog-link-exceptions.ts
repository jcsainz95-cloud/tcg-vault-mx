/**
 * §AUTO-ENLACE contrato §2 — `GET /admin/catalog/link-exceptions`: lista única de sets con cartas sin ligar,
 * con motivo y grupo de la fuente de precios usado. Solo lectura local. Mapeo defensivo en `readLinkExceptions`.
 */
import { apiRequest } from '../api-client';
import { LINK_SET_REASONS, readGroupUsed, type LinkGroupUsed, type LinkSetReason } from './catalog-link-repair';

export interface LinkExceptionSet {
  setId: string;
  name: string;
  unlinked: number;
  total: number;
  reason: LinkSetReason | null;
  groupUsed: LinkGroupUsed | null;
  nextAttemptAt: string | null;
}
export interface LinkExceptions {
  unlinkedCards: number;
  sets: LinkExceptionSet[];
}

/** Motivos sin botón: la fuente no permite ligar. */
export const NO_BUTTON_REASONS: readonly LinkSetReason[] = ['tcgcsv_source', 'not_in_provider'];

interface RawExceptions {
  summary?: { unlinkedCards?: number };
  sets?: Array<{
    setId?: string; name?: string; unlinked?: number; total?: number; reason?: string;
    groupUsed?: { groupId?: number; name?: string; via?: string } | null; nextAttemptAt?: string | null;
  }>;
}

export function readLinkExceptions(raw: RawExceptions): LinkExceptions {
  const sets = (raw.sets ?? [])
    .filter((s) => typeof s.setId === 'string' && typeof s.name === 'string')
    .map((s) => ({
      setId: s.setId as string,
      name: s.name as string,
      unlinked: Number(s.unlinked) || 0,
      total: Number(s.total) || 0,
      reason: (LINK_SET_REASONS as readonly string[]).includes(s.reason ?? '') ? (s.reason as LinkSetReason) : null,
      groupUsed: readGroupUsed(s.groupUsed),
      nextAttemptAt: s.nextAttemptAt ?? null,
    }));
  return { unlinkedCards: Number(raw.summary?.unlinkedCards) || 0, sets };
}

export async function getLinkExceptions(): Promise<LinkExceptions> {
  return readLinkExceptions(await apiRequest<RawExceptions>('/admin/catalog/link-exceptions'));
}
