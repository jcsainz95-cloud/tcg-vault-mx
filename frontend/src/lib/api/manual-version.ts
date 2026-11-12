/**
 * §ALTA-LIGA-2 (`docs/API_CONTRACT_ALTA_LIGA.md` §2): alta manual de una versión de liga desde el alta rápida.
 * `POST /admin/inventory/cards/:cardId/versions` (staff). El idioma NO viaja (es propiedad de la pieza).
 * Sin backend (`useMocks`) no hay simulación: el servidor es quien crea el producto sintético.
 */
import { ApiClientError, apiRequest } from '../api-client';
import { config } from '../config';
import type { Finish, StampDTO, StampType, VersionComboDTO } from '@/types/contract';

export interface ManualVersionInput {
  stampType: StampType;
  /** Opcional, 1..40 caracteres; vacío ⇒ se omite. */
  stampLabel?: string;
  finish: Finish;
}

export interface ManualVersionResponse {
  created: boolean;
  finishAdded: boolean;
  stamp: StampDTO & { manual: true };
  finishes: Finish[];
  combos: VersionComboDTO[];
}

export async function createManualVersion(cardId: string, input: ManualVersionInput): Promise<ManualVersionResponse> {
  if (config.useMocks) throw new ApiClientError(503, { code: 'MANUAL_VERSION_NEEDS_BACKEND', message: 'No mock' });
  const label = input.stampLabel?.trim();
  return apiRequest<ManualVersionResponse>(`/admin/inventory/cards/${encodeURIComponent(cardId)}/versions`, {
    method: 'POST',
    body: { stampType: input.stampType, finish: input.finish, ...(label ? { stampLabel: label } : {}) },
  });
}
