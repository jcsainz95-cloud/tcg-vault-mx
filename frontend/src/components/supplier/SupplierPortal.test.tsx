import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/', Link: 'a' }));

import { renderWithProviders } from '@/test/render';
import { SupplierRequestsView } from './SupplierRequestsView';
import { SupplierPurchasesView } from './SupplierPurchasesView';
import { SupplierQueryState } from './SupplierQueryState';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api/suppliers';

const card = { cardId: 'c1', name: 'Erika Victreebel', nameEs: null, number: '6', setId: 's', setName: 'ASC', imageUrl: null, rarity: null, finish: 'holofoil' as const };
const req = (over: Partial<api.SupplierRequest> = {}): api.SupplierRequest => ({ id: 'r1', card, minCondition: 'LP', qtyOpen: 3, unitCents: 12000, expiresAt: '2099-01-01T00:00:00Z', myOfferStatus: null, ...over });
const page = <T,>(data: T[]) => ({ data, page: 1, pageSize: 20, total: data.length });

afterEach(() => vi.restoreAllMocks());

describe('§PROV · portal del proveedor', () => {
  it('no ofrece estados bajo el mínimo', async () => {
    vi.spyOn(api, 'listSupplierRequests').mockResolvedValue(page([req()]));
    renderWithProviders(<SupplierRequestsView />);
    await userEvent.click(await screen.findByRole('button', { name: /la tengo/i }));
    const sel = screen.getByLabelText(/estado de tus cartas/i) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['NM', 'LP']);
  });

  it.each(['withdrawn', 'rejected', 'expired'] as const)('IMP3: con oferta %s se puede volver a ofrecer', async (status) => {
    vi.spyOn(api, 'listSupplierRequests').mockResolvedValue(page([req({ myOfferStatus: status })]));
    renderWithProviders(<SupplierRequestsView />);
    expect(await screen.findByRole('button', { name: /ofrecer de nuevo/i })).toBeTruthy();
  });

  it.each(['open', 'accepted'] as const)('con oferta %s no se ofrece otra', async (status) => {
    vi.spyOn(api, 'listSupplierRequests').mockResolvedValue(page([req({ myOfferStatus: status })]));
    renderWithProviders(<SupplierRequestsView />);
    await screen.findByText('Erika Victreebel');
    expect(screen.queryByRole('button', { name: /la tengo|ofrecer de nuevo/i })).toBeNull();
  });

  it('el reintento tras un error manda la misma Idempotency-Key', async () => {
    vi.spyOn(api, 'listSupplierRequests').mockResolvedValue(page([req({ minCondition: 'NM' })]));
    const create = vi.spyOn(api, 'createSupplierOffer').mockRejectedValueOnce(new Error('red')).mockResolvedValue({} as never);
    renderWithProviders(<SupplierRequestsView />);
    await userEvent.click(await screen.findByRole('button', { name: /la tengo/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar oferta/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /enviar oferta/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[0][2]).toBeTruthy();
    expect(create.mock.calls[1][2]).toBe(create.mock.calls[0][2]);
  });

  it('acuerdo cancelado: dice por qué y no hay nada que pagar', async () => {
    const p = { id: 'p1', offerId: 'o', card, qty: 2, agreedUnitCents: 1000, totalCents: 2000, status: 'cancelled', pickupDueAt: '2099-01-01T00:00:00Z', units: [], payableCents: 0, method: null, reference: null, paidAt: null, reason: 'all_returned', createdAt: '2026-11-12T00:00:00Z' } as api.SupplyPurchase;
    vi.spyOn(api, 'listSupplierPurchases').mockResolvedValue(page([p]));
    renderWithProviders(<SupplierPurchasesView />);
    expect(await screen.findByText(/todas se devolvieron/i)).toBeTruthy();
  });

  it('SUPPLIER_SUSPENDED se dice claro, sin botón de reintento', () => {
    const err = new ApiClientError(403, { code: 'SUPPLIER_SUSPENDED', message: 'x' });
    renderWithProviders(<SupplierQueryState isLoading={false} isError error={err}><p>hijo</p></SupplierQueryState>);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/suspendida/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('§PROV · activación (PROV-4)', () => {
  it('quita el token de la URL al montar', async () => {
    const { SupplierActivateForm } = await import('./SupplierActivateForm');
    window.history.replaceState(null, '', '/es/proveedores/activar?token=abc123');
    renderWithProviders(<SupplierActivateForm token="abc123" />);
    expect(window.location.search).not.toContain('token');
  });
});

describe('§PROV · acuerdo vencido sin recoger (B3)', () => {
  const base = { id: 'p1', offerId: 'o', card, qty: 2, agreedUnitCents: 1000, totalCents: 2000, status: 'cancelled', pickupDueAt: '2026-11-01T00:00:00Z', units: [], payableCents: null, method: null, reference: null, paidAt: null, createdAt: '2026-10-20T00:00:00Z' };
  it('pickup_expired se explica con texto propio, no con la clave cruda', async () => {
    vi.spyOn(api, 'listSupplierPurchases').mockResolvedValue(page([{ ...base, reason: 'pickup_expired' } as api.SupplyPurchase]));
    renderWithProviders(<SupplierPurchasesView />);
    expect(await screen.findByText(/no llevaste las piezas en 7 días/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain('cancelledReason');
  });
  it('un reason desconocido cae al texto genérico', async () => {
    vi.spyOn(api, 'listSupplierPurchases').mockResolvedValue(page([{ ...base, reason: 'otro_futuro' } as api.SupplyPurchase]));
    renderWithProviders(<SupplierPurchasesView />);
    expect(await screen.findByText('Acuerdo cancelado.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('otro_futuro');
  });
});
