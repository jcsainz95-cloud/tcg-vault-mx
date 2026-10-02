import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ReplacementCaseView } from './ReplacementCaseView';
import { ReplacementCaseCard } from '../../ReplacementCaseCard';
import * as api from '@/lib/api';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';
import type { ReplacementCaseDTO } from '@/types/contract';

/**
 * **«Por reponer»** (`DESIGN_SYSTEM §37.8`, contrato `§M4-SHIP.15`). Candados `PS-UI-6` (al operador no se le
 * pintan los verbos del súper-admin), `PS-UI-9` (la confirmación reforzada exige re-escribir el monto, sin pegar)
 * y `PS-UI-11` (`overdue` manda: «Vencido» lo dice el servidor, no el reloj de la pantalla).
 *
 * El «servidor» es el mock con estado de `lib/mock/m4-ship` (`rc-9001`: retiro de Gary, `not_found`, dos
 * candidatas; `rc-9002`: compra a bóveda, `damaged`, vencido, sin mercado). El rol del mock se lee de
 * `localStorage('tcg.role')` y el de la pantalla de `useRole`: se fijan los dos.
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' as 'super_admin' | 'vault_operator' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: true }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
  window.localStorage.setItem('tcg.role', 'super_admin');
});
afterEach(() => {
  window.localStorage.removeItem('tcg.role');
});

describe('PS-UI-6 · el operador no ve los verbos de dinero', () => {
  it('súper-admin: «Reembolsar» y «Anular» existen donde aplican; operador: ningún nodo con esos textos', async () => {
    renderWithProviders(<ReplacementCaseView caseId="rc-9001" />, 'es');
    expect(await screen.findByTestId('case-refund-cta')).toBeInTheDocument();
    // rc-9001 tiene origen liquidado ⇒ «Anular» no aplica ni para el súper-admin (S6: ausencia con nombre).
    expect(screen.queryByTestId('case-void-cta')).not.toBeInTheDocument();
  });

  it('operador (`vault_operator`): sin «Reembolsar», sin «Anular», y «Reponer con esta pieza» sigue ahí', async () => {
    roleState.role = 'vault_operator';
    window.localStorage.setItem('tcg.role', 'vault_operator');
    renderWithProviders(<ReplacementCaseView caseId="rc-9001" />, 'es');

    expect((await screen.findAllByRole('button', { name: /Reponer con esta pieza/ })).length).toBeGreaterThan(0);
    expect(screen.queryByText('Reembolsar')).not.toBeInTheDocument();
    expect(screen.queryByText('Anular')).not.toBeInTheDocument();
    expect(screen.queryByTestId('case-refund-cta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('case-void-cta')).not.toBeInTheDocument();
  });
});

describe('PS-UI-11 · `overdue` manda', () => {
  const base = {
    id: 'rc-t',
    source: 'withdrawal',
    status: 'open',
    missingReason: 'not_found',
    customer: { userId: 'u-1', fullName: 'Gary Oak', email: 'gary@example.com' },
    original: {
      inventoryItemId: 'inv-1',
      folio: 'INV-000001',
      card: { name: 'Pikachu', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
      identity: { cardId: 'c-1', productType: 'raw', finish: 'holofoil', rawCondition: 'NM', gradingCompany: null, gradeValue: null, sealedProductId: null },
      pieceStatus: 'reserved',
      currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
    },
    origin: { orderId: 'ord-1', orderNumber: 'TCG-000001', orderStatus: 'settled' },
    shipment: { id: 'shp-1', status: 'picking', preparedAt: '2026-09-27T10:00:00Z' },
    placement: null,
    destination: 'package',
    customerDrawers: [],
    candidateCount: 0,
    openedAt: '2026-09-20T10:00:00Z',
    openedBy: { userId: 'u-op1', name: 'Operador' },
    resolvedAt: null,
    resolvedBy: null,
    replacement: null,
    refund: null,
    voidNote: null,
    dueAt: '2026-09-27T10:00:00Z',
    overdue: true,
    refundContext: null,
    refundCapture: null,
    manualRefunds: null,
  } as unknown as ReplacementCaseDTO;

  it('`overdue: true` ⇒ la tarjeta contiene «Vencido» en `text-accent`', () => {
    renderWithProviders(<ReplacementCaseCard kase={base} locale="es" />, 'es');
    const due = screen.getByTestId('case-due-rc-t');
    expect(due).toHaveTextContent(/Vencido/);
    expect(due.className).toContain('text-accent');
  });

  it('`overdue: false` con `dueAt` en el pasado (fixture contradictorio) ⇒ ⛔ NO contiene «Vencido»', () => {
    renderWithProviders(<ReplacementCaseCard kase={{ ...base, overdue: false }} locale="es" />, 'es');
    const due = screen.getByTestId('case-due-rc-t');
    expect(due).not.toHaveTextContent(/Vencido/);
    expect(due.className).not.toContain('text-accent');
  });
});

describe('PS-UI-9 · reembolso reforzado: se re-escribe el monto', () => {
  async function openRefund() {
    renderWithProviders(<ReplacementCaseView caseId="rc-9001" />, 'es');
    fireEvent.click(await screen.findByTestId('case-refund-cta'));
    return screen.findByRole('dialog', { name: 'Reembolsar sin reposición' });
  }

  it('monto ≤ 2× la referencia: sin segundo diálogo; el POST lleva `amountCents` y el reparto del servidor', async () => {
    const spy = vi.spyOn(api, 'refundCase');
    const dialog = await openRefund();
    // Las dos referencias a la vista (S3): lo pagado y el mercado (o su ausencia).
    expect(within(dialog).getByTestId('case-refund-refs')).toHaveTextContent(/Pagó/);
    fireEvent.change(within(dialog).getByTestId('case-refund-amount'), { target: { value: '500' } });
    fireEvent.change(within(dialog).getByTestId('case-refund-reason'), { target: { value: 'No hay pieza igual' } });
    await waitFor(() => expect(within(dialog).getByTestId('case-refund-preview')).toHaveTextContent('500.00'), { timeout: 3000 });
    fireEvent.click(within(dialog).getByTestId('case-refund-submit'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('rc-9001', expect.objectContaining({ amountCents: 50000, reason: 'No hay pieza igual', expectedStripeCents: expect.any(Number), expectedManualCents: expect.any(Number) })));
    expect(screen.queryByTestId('case-refund-retype')).not.toBeInTheDocument();
    expect(await screen.findByTestId('case-notice')).toHaveTextContent(/reembolso de MX\$500\.00 capturado/);
  });

  it('`confirmation: reinforced` ⇒ segundo diálogo con campo vacío; «899.99» no coincide y apaga el botón; «900» coincide', async () => {
    const spy = vi.spyOn(api, 'refundCase');
    const dialog = await openRefund();
    fireEvent.change(within(dialog).getByTestId('case-refund-amount'), { target: { value: '900' } });
    fireEvent.change(within(dialog).getByTestId('case-refund-reason'), { target: { value: 'Pieza rara' } });
    await waitFor(() => expect(within(dialog).getByTestId('case-refund-preview')).toHaveTextContent('900.00'), { timeout: 3000 });
    fireEvent.click(within(dialog).getByTestId('case-refund-submit'));

    const retype = await screen.findByTestId('case-refund-retype');
    expect(retype).toHaveValue('');
    const submit = screen.getByTestId('case-refund-retype-submit');
    expect(submit).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();

    fireEvent.change(retype, { target: { value: '899.99' } });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/No coincide con/)).toBeInTheDocument();

    fireEvent.change(retype, { target: { value: '900' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('rc-9001', expect.objectContaining({ amountCents: 90000, confirmAboveReference: true })));
  });

  it('pegar en el campo de re-escritura se bloquea (hay que teclearlo)', async () => {
    const dialog = await openRefund();
    fireEvent.change(within(dialog).getByTestId('case-refund-amount'), { target: { value: '900' } });
    fireEvent.change(within(dialog).getByTestId('case-refund-reason'), { target: { value: 'Pieza rara' } });
    await waitFor(() => expect(within(dialog).getByTestId('case-refund-preview')).toHaveTextContent('900.00'), { timeout: 3000 });
    fireEvent.click(within(dialog).getByTestId('case-refund-submit'));
    const retype = await screen.findByTestId('case-refund-retype');
    const prevented = !fireEvent.paste(retype, { clipboardData: { getData: () => '900' } });
    expect(prevented).toBe(true);
    expect(retype).toHaveValue('');
  });
});
