import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { PurchasesTab as Tab } from './PurchasesTab';
import { RoleProvider } from '@/lib/role';
import * as api from '@/lib/api/suppliers';

const card = { cardId: 'c1', name: 'Erika Victreebel', nameEs: null, number: '6', setId: 's', setName: 'ASC', imageUrl: null, rarity: null, finish: 'holofoil' as const };
const unit = (n: number, condition: api.SupplyCondition) => ({ n, condition, result: 'pending' as const, unitPayableCents: null, note: null });
const purchase = (over: Partial<api.SupplyPurchase>): api.SupplyPurchase => ({
  id: 'p1', offerId: 'o1', supplier: { id: 's1', businessName: 'Tienda Uno' }, card, qty: 2, agreedUnitCents: 10000, totalCents: 20000,
  status: 'collected', pickupDueAt: '2099-01-01T00:00:00Z', units: [unit(1, 'NM'), unit(2, 'LP')], payableCents: null, method: null, reference: null, paidAt: null, createdAt: '2026-11-12T00:00:00Z', ...over,
});
const list = (p: api.SupplyPurchase[]) => vi.spyOn(api, 'listSupplyPurchases').mockResolvedValue({ data: p, page: 1, pageSize: 20, total: p.length });

const PurchasesTab = () => (
  <RoleProvider>
    <Tab />
  </RoleProvider>
);

afterEach(() => vi.restoreAllMocks());

describe('§PROV · panel: acuerdos', () => {
  it('B1: la pieza no-NM arranca en «devolver» y la NM en «aceptada»; se verifica sin 422 OK_NOT_NM', async () => {
    list([purchase({})]);
    const verify = vi.spyOn(api, 'verifySupplyPurchase').mockResolvedValue({} as never);
    renderWithProviders(<PurchasesTab />);
    const s1 = (await screen.findByLabelText(/pieza 1 \(llegó NM\)/i)) as HTMLSelectElement;
    const s2 = screen.getByLabelText(/pieza 2 \(llegó LP\)/i) as HTMLSelectElement;
    expect(s1.value).toBe('ok');
    expect(s2.value).toBe('returned');
    expect([...s2.options].map((o) => o.value)).toEqual(['returned']);
    await userEvent.click(screen.getByRole('button', { name: /confirmar revisión/i }));
    await waitFor(() => expect(verify).toHaveBeenCalled());
    expect(verify.mock.calls[0][1]).toEqual([{ n: 1, result: 'ok' }, { n: 2, result: 'returned' }]);
    expect(verify.mock.calls[0][2]).toBeTruthy();
  });

  it('acuerdo cancelado (todo devuelto): lo dice y no ofrece pagar', async () => {
    list([purchase({ status: 'cancelled', reason: 'all_returned', payableCents: 0 })]);
    renderWithProviders(<PurchasesTab />);
    expect(await screen.findByText(/todas las piezas se devolvieron/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /registrar pago/i })).toBeNull();
  });

  it('verificado con total 0: no ofrece «Pagar MX$0»', async () => {
    list([purchase({ status: 'verified', payableCents: 0 })]);
    renderWithProviders(<PurchasesTab />);
    await screen.findByText('Erika Victreebel');
    expect(screen.queryByRole('button', { name: /registrar pago/i })).toBeNull();
  });

  it('pago: reintento con la misma Idempotency-Key', async () => {
    list([purchase({ status: 'verified', payableCents: 10000 })]);
    const pay = vi.spyOn(api, 'paySupplyPurchase').mockRejectedValueOnce(new Error('red')).mockResolvedValue({} as never);
    renderWithProviders(<PurchasesTab />);
    const btn = await screen.findByRole('button', { name: /registrar pago de/i });
    await userEvent.click(btn);
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /registrar pago de/i }));
    await waitFor(() => expect(pay).toHaveBeenCalledTimes(2));
    expect(pay.mock.calls[1][2]).toBe(pay.mock.calls[0][2]);
  });
});

describe('§PROV · ajuste que pagaría MX$0', () => {
  it('lo bloquea y sugiere devolver; un ajuste que sí paga se permite', async () => {
    list([purchase({ agreedUnitCents: 50, units: [unit(1, 'NM')], qty: 1 })]);
    renderWithProviders(<PurchasesTab />);
    await userEvent.selectOptions(await screen.findByLabelText(/pieza 1 \(llegó NM\)/i), 'adjusted');
    const pct = screen.getByLabelText(/pagar este porcentaje/i);
    await userEvent.type(pct, '1');
    expect(screen.getByText(/pagaría MX\$0\.00/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /confirmar revisión/i }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(pct);
    await userEvent.type(pct, '50');
    expect((screen.getByRole('button', { name: /confirmar revisión/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
