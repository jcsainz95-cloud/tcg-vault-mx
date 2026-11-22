/**
 * §FICHA-CLIENTE (`docs/API_CONTRACT_FICHA_CLIENTE.md`) + §CELULAR (M6) — cliente de la ficha completa del cliente.
 * Un archivo por dominio (deuda DT-API). ⛔ El front nunca multiplica ni suma dinero: pinta los `*Cents` del servidor.
 * ⛔ Las notas internas solo viajan por estos endpoints; jamás a `dataLayer`, URL, `localStorage` ni logs.
 */
import { apiRequest } from '../api-client';
import { config } from '../config';
import { mockUserPhones } from '../mock-user-phones';

const MOCKS_BUILD = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';
const isMock = () => MOCKS_BUILD && config.useMocks;
const wait = <T>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

export type ShipmentRefStatus = 'solicitado' | 'picking' | 'guia' | 'enviado' | 'entregado' | 'cancelado';
export interface ShipmentRef {
  id: string;
  status: ShipmentRefStatus;
  mode: 'withdrawal' | 'direct_ship';
  orderId: string | null;
  orderNumber: string | null;
  itemsCount: number;
  totalCents: number;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  requestedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}
export type RefundRefStatus = 'requested' | 'submitted' | 'succeeded' | 'failed' | 'pending' | 'paid' | 'cancelled';
export interface RefundRef {
  id: string;
  channel: 'card' | 'spei';
  status: RefundRefStatus;
  amountCents: number;
  orderId: string | null;
  createdAt: string;
}
export interface AdminUserOverviewDTO {
  userId: string;
  generatedAt: string;
  attention: {
    ordersPending: number;
    shipmentsOpen: number;
    sellRequestsOpen: number;
    sellRequestsNeedingStore: number;
    disputesOpen: number;
    refundsOpen: number;
  };
  summary: {
    customerSince: string;
    lastOrderAt: string | null;
    lastSellRequestAt: string | null;
    lifetime: {
      purchasesCount: number;
      purchasesCents: number;
      refundedCents: number;
      salesPaidCount: number;
      salesPaidCents: number;
      salesInProgressCents: number;
    };
  };
  vault: { piecesCount: number; valueCents: number | null; pricedCount: number; asOf: string | null };
  shipments: { total: number; items: ShipmentRef[] };
  refunds: { total: number; items: RefundRef[] };
  wishlist: { itemCount: number; alertsPaused: boolean };
  totals: { orders: number; sellRequests: number; disputes: number; ownedItems: number };
}

export interface NoteDTO {
  id: string;
  body: string;
  pinned: boolean;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  canEdit: boolean;
}
export interface NotesPage {
  items: NoteDTO[];
  nextCursor: string | null;
}
export const NOTE_MAX_LENGTH = 1000;

const enc = encodeURIComponent;

export async function getAdminUserOverview(id: string): Promise<AdminUserOverviewDTO> {
  if (!isMock()) return apiRequest<AdminUserOverviewDTO>(`/admin/users/${enc(id)}/overview`);
  return wait(mockOverview(id));
}

export async function getAdminUserNotes(id: string, params: { cursor?: string; limit?: number } = {}): Promise<NotesPage> {
  if (!isMock()) {
    return apiRequest<NotesPage>(`/admin/users/${enc(id)}/notes`, { query: { cursor: params.cursor, limit: params.limit } });
  }
  return wait({ items: sortNotes(mockNotesOf(id)).map((n) => ({ ...n })), nextCursor: null });
}

export async function createAdminUserNote(
  id: string,
  input: { body: string; pinned?: boolean; clientRequestId?: string },
): Promise<NoteDTO> {
  if (!isMock()) return apiRequest<NoteDTO>(`/admin/users/${enc(id)}/notes`, { method: 'POST', body: input });
  const list = mockNotesOf(id);
  const body = input.body.trim();
  if (input.clientRequestId) {
    const dup = list.find((n) => (n as MockNote).clientRequestId === input.clientRequestId);
    if (dup) return wait({ ...dup });
  }
  const now = new Date().toISOString();
  const note: MockNote = {
    id: `note-${++noteSeq}`,
    body,
    pinned: !!input.pinned,
    authorId: MOCK_ME,
    authorName: 'Tú (operador)',
    createdAt: now,
    updatedAt: now,
    edited: false,
    canEdit: true,
    clientRequestId: input.clientRequestId,
  };
  list.push(note);
  return wait({ ...note });
}

export async function updateAdminUserNote(
  id: string,
  noteId: string,
  input: { body?: string; pinned?: boolean },
): Promise<NoteDTO> {
  if (!isMock()) {
    return apiRequest<NoteDTO>(`/admin/users/${enc(id)}/notes/${enc(noteId)}`, { method: 'PATCH', body: input });
  }
  const n = mockNotesOf(id).find((x) => x.id === noteId);
  if (!n) throw new Error('NOT_FOUND');
  if (input.body !== undefined) {
    if (!n.canEdit) throw new Error('FORBIDDEN');
    n.body = input.body.trim();
    n.edited = true;
    n.updatedAt = new Date().toISOString();
  }
  if (input.pinned !== undefined) n.pinned = input.pinned;
  return wait({ ...n });
}

export async function deleteAdminUserNote(id: string, noteId: string): Promise<void> {
  if (!isMock()) {
    await apiRequest<void>(`/admin/users/${enc(id)}/notes/${enc(noteId)}`, { method: 'DELETE' });
    return;
  }
  const list = mockNotesOf(id);
  const i = list.findIndex((x) => x.id === noteId);
  if (i < 0 || !list[i].canEdit) throw new Error('FORBIDDEN');
  list.splice(i, 1);
  await wait(undefined);
}

/** §CELULAR · `PATCH /admin/users/:id/phone` (super_admin). Misma validación que el servidor; sin vaciar. */
export async function updateAdminUserPhone(id: string, phone: string): Promise<{ id: string; phone: string; phoneRequired?: boolean }> {
  if (!isMock()) return apiRequest<{ id: string; phone: string; phoneRequired?: boolean }>(`/admin/users/${enc(id)}/phone`, { method: 'PATCH', body: { phone } });
  mockUserPhones[id] = phone.replace(/\D/g, '').slice(-10);
  return wait({ id, phone: mockUserPhones[id] });
}

// ---------------- Mocks (siguen el contrato al pie de la letra) ----------------
type MockNote = NoteDTO & { clientRequestId?: string };
const MOCK_ME = 'mock-operator';
let noteSeq = 100;
const mockNotesStore: Record<string, MockNote[]> = {};
function mockNotesOf(id: string): MockNote[] {
  if (!mockNotesStore[id]) {
    mockNotesStore[id] =
      id === 'u-777'
        ? [
            { id: 'note-1', body: 'Prefiere recoger en tienda.\nAvisar por WhatsApp antes de enviar.', pinned: true, authorId: MOCK_ME, authorName: 'Tú (operador)', createdAt: '2026-11-18T16:10:00Z', updatedAt: '2026-11-18T16:10:00Z', edited: false, canEdit: true },
            { id: 'note-2', body: 'Pidió factura de la compra TCG-000431.', pinned: false, authorId: 'u-other-op', authorName: 'Luis (operador)', createdAt: '2026-11-05T11:00:00Z', updatedAt: '2026-11-06T09:00:00Z', edited: true, canEdit: false },
          ]
        : [];
  }
  return mockNotesStore[id];
}
function sortNotes(list: MockNote[]): MockNote[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

function mockOverview(id: string): AdminUserOverviewDTO {
  const rich = id === 'u-777';
  const zero = {
    attention: { ordersPending: 0, shipmentsOpen: 0, sellRequestsOpen: 0, sellRequestsNeedingStore: 0, disputesOpen: 0, refundsOpen: 0 },
    lifetime: { purchasesCount: 0, purchasesCents: 0, refundedCents: 0, salesPaidCount: 0, salesPaidCents: 0, salesInProgressCents: 0 },
  };
  return {
    userId: id,
    generatedAt: '2026-11-22T12:00:00Z',
    attention: rich
      ? { ordersPending: 1, shipmentsOpen: 1, sellRequestsOpen: 1, sellRequestsNeedingStore: 1, disputesOpen: 1, refundsOpen: 0 }
      : zero.attention,
    summary: {
      customerSince: '2026-09-14T15:00:00Z',
      lastOrderAt: rich ? '2026-11-03T18:30:00Z' : null,
      lastSellRequestAt: rich ? '2026-11-18T22:00:00Z' : null,
      lifetime: rich
        ? { purchasesCount: 2, purchasesCents: 363000, refundedCents: 35000, salesPaidCount: 1, salesPaidCents: 420000, salesInProgressCents: 186000 }
        : zero.lifetime,
    },
    vault: rich ? { piecesCount: 2, valueCents: 128000, pricedCount: 1, asOf: '2026-11-21' } : { piecesCount: 0, valueCents: null, pricedCount: 0, asOf: null },
    shipments: {
      total: rich ? 2 : 0,
      items: rich
        ? [
            { id: 'shp-1', status: 'enviado', mode: 'withdrawal', orderId: null, orderNumber: null, itemsCount: 2, totalCents: 148000, carrier: 'Estafeta', trackingNumber: '8012 4455 9021', trackingUrl: 'https://tracking.example.test/801244559021', requestedAt: '2026-11-15T10:00:00Z', shippedAt: '2026-11-16T10:00:00Z', deliveredAt: null },
            { id: 'shp-2', status: 'entregado', mode: 'direct_ship', orderId: 'o-412', orderNumber: 'TCG-000412', itemsCount: 3, totalCents: 248000, carrier: 'DHL', trackingNumber: 'JD001460 0392 1187', trackingUrl: null, requestedAt: '2026-10-20T10:00:00Z', shippedAt: '2026-10-21T10:00:00Z', deliveredAt: '2026-10-24T10:00:00Z' },
          ]
        : [],
    },
    refunds: {
      total: rich ? 1 : 0,
      items: rich ? [{ id: 'RF-0019', channel: 'card', status: 'succeeded', amountCents: 35000, orderId: 'TCG-000412', createdAt: '2026-10-25T10:00:00Z' }] : [],
    },
    wishlist: { itemCount: rich ? 7 : 0, alertsPaused: false },
    totals: { orders: rich ? 3 : 0, sellRequests: rich ? 2 : 0, disputes: rich ? 1 : 0, ownedItems: rich ? 2 : 0 },
  };
}
