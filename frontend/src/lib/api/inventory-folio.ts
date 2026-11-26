/**
 * §BUSCADOR-CARTAS (folio) — `GET /admin/inventory/by-folio/:folio` (staff, lectura, sin precios). `400` si no tiene forma de
 * folio, `404` si no existe. Un solo punto de mapeo; el servidor decide (el front solo normaliza el texto tecleado).
 */
import { apiRequest } from '../api-client';
import type { Finish, ProductType } from '@/types/contract';

export interface PieceByFolioDTO {
  id: string;
  folio: string;
  status: string;
  productType: ProductType;
  finish: Finish | null;
  language: string | null;
  rawCondition: string | null;
  gradingCompany: string | null;
  gradeValue: string | null;
  owner: { type: 'platform' | 'customer'; userId?: string | null };
  location: { id: string; label: string; zone: string } | null;
  card: { id: string; name: string; number: string | null; setName: string | null; setKey: string | null; imageSmallUrl: string | null; imageUrl: string | null };
}

/** `inv 1306` ⇒ `INV-1306`; lo que no parece folio se manda tal cual (el servidor responde 400). */
export function normalizeFolioInput(raw: string): string {
  const m = /^\s*INV[-\s]?(\d+)\s*$/i.exec(raw);
  return m ? `INV-${m[1]}` : raw.trim();
}

/** Pieza del MOCK de un CLIENTE (`INV-001306`): solo lectura. La arma `api.ts` (los módulos de `lib/api/` no importan `lib/mock`). */
export const MOCK_CUSTOMER_PIECE: PieceByFolioDTO = {
  id: 'inv-mock-1306', folio: 'INV-001306', status: 'in_custody', productType: 'raw', finish: 'reverse_holo', language: 'es', rawCondition: 'NM',
  gradingCompany: null, gradeValue: null, owner: { type: 'customer' }, location: { id: 'loc-1', label: 'C-04', zone: 'customer_custody' },
  card: { id: 'c-mock', name: 'Umbreon ex', number: '161', setName: 'Prismatic Evolutions', setKey: 'PRE', imageSmallUrl: null, imageUrl: null },
};

export function realGetInventoryByFolio(raw: string): Promise<PieceByFolioDTO> {
  return apiRequest<PieceByFolioDTO>(`/admin/inventory/by-folio/${encodeURIComponent(normalizeFolioInput(raw))}`);
}
