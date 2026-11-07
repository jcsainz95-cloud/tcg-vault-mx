/**
 * Cliente admin de P-PROMOS opción C (API_CONTRACT §M1: GET /admin/catalog/tcgcsv-groups y
 * POST /admin/catalog/import-tcgcsv-set). Un archivo por dominio (deuda DT-API).
 * El frontend no calcula precios: «sin precio» lo dice el servidor (`noPrice`).
 */
import { apiRequest, ApiClientError } from '../api-client';
import { config } from '../config';


const MOCKS_BUILD = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

export interface TcgcsvGroupDTO {
  groupId: number;
  name: string;
  publishedOn: string | null;
  imported: boolean;
  cardCount: number;
}

export interface TcgcsvSkippedDTO {
  productId: number;
  name: string;
  /** Código del servidor (minúsculas): no_number, number_mismatch, unknown_stamp, empty_name, no_base, ambiguous_base, product_already_linked, card_exists_in_pokemontcg. Desconocido ⇒ se muestra crudo. */
  reason: string;
}

export interface TcgcsvImportResult {
  setId: string;
  created: number;
  updated: number;
  stamped: number;
  noPrice: number;
  skipped: TcgcsvSkippedDTO[];
}

/**
 * Mock en línea (a propósito NO bajo `lib/mock/`: el candado R1 del mock-boundary solo admite esa
 * importación en api.ts/marketing-api.ts). Solo se ejecuta tras `(MOCKS_BUILD && config.useMocks)`.
 * Forma = contrato; únicamente el ejemplo medido (grupo 24451, 148 productos, 10 sin precio).
 */
const mockImported = new Set<number>();
function mockGroups(): TcgcsvGroupDTO[] {
  return [
    { groupId: 24451, name: 'ME: Mega Evolution Promo', publishedOn: '2025-09-26T00:00:00', imported: mockImported.has(24451), cardCount: 148 },
    { groupId: 24500, name: 'Trick or Trade 2025', publishedOn: '2025-10-01T00:00:00', imported: mockImported.has(24500), cardCount: 40 },
  ];
}
function mockImport(groupId: number): TcgcsvImportResult {
  if (!mockGroups().some((g) => g.groupId === groupId)) {
    throw new ApiClientError(404, { code: 'TCGCSV_GROUP_UNKNOWN', message: 'TCGCSV_GROUP_UNKNOWN' });
  }
  const again = mockImported.has(groupId);
  mockImported.add(groupId);
  return {
    setId: `tcgcsv-${groupId}`,
    created: again ? 0 : 130,
    updated: again ? 130 : 0,
    stamped: 6,
    noPrice: 10,
    skipped: [
      { productId: 900001, name: 'Paradise Resort 092 [Staff]', reason: 'ambiguous_base' },
      { productId: 900002, name: 'Booster Box Promo', reason: 'no_number' },
    ],
  };
}

export async function getTcgcsvGroups(): Promise<TcgcsvGroupDTO[]> {
  if (!(MOCKS_BUILD && config.useMocks)) {
    return apiRequest<TcgcsvGroupDTO[]>('/admin/catalog/tcgcsv-groups');
  }
  return mockGroups();
}

export async function importTcgcsvSet(groupId: number): Promise<TcgcsvImportResult> {
  if (!(MOCKS_BUILD && config.useMocks)) {
    return apiRequest<TcgcsvImportResult>('/admin/catalog/import-tcgcsv-set', {
      method: 'POST',
      body: { groupId },
    });
  }
  return mockImport(groupId);
}
