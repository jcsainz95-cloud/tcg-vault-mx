import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import { VaultView, withdrawableHintKey } from './VaultView';
import { mockHoldings } from '@/lib/mock/fixtures';
import type { HoldingDTO } from '@/types/contract';
import { WITHDRAWAL_REQUESTED_KEY } from './vaultTabs';

// `?tab=` lo decide cada test (vi.hoisted: la fábrica de vi.mock se iza al top del módulo).
const { search } = vi.hoisted(() => ({ search: { tab: null as string | null } }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? search.tab : null) }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  search.tab = null;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/es/vault');
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Orden de los nombres de carta (cada card pinta el nombre en un <p lang="en">). */
function cardNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('p[lang="en"]')).map((e) => e.textContent ?? '');
}

describe('VaultView · orden de holdings', () => {
  it('orden por defecto respeta el orden del backend', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');
    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Latias ex',
      'Surging Sparks Booster Box',
      'Zapdos',
    ]);
  });

  it('ordena por valor descendente (pendientes al final)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'value_desc' } });

    // Latias 950000 > Booster Box 320000 > Blastoise 128000 > Zapdos (precio pendiente → al final)
    expect(cardNames(container)).toEqual([
      'Latias ex',
      'Surging Sparks Booster Box',
      'Blastoise',
      'Zapdos',
    ]);
  });

  it('ordena por valor ascendente (pendientes al final)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'value_asc' } });

    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Surging Sparks Booster Box',
      'Latias ex',
      'Zapdos', // pendiente siempre al final, aun en asc
    ]);
  });

  it('ordena por set (nombre de set, desempate por nombre de carta)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'set' } });

    // Base Set (Blastoise, Zapdos) antes de Surging Sparks (Latias ex, Booster Box)
    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Zapdos',
      'Latias ex',
      'Surging Sparks Booster Box',
    ]);
  });
});

describe('VaultView · pestaña Master set (v1.20, vista (iii))', () => {
  it('la pestaña "Master set" muestra el índice de MI bóveda (solo sets con piezas propias)', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    fireEvent.click(screen.getByRole('tab', { name: 'Master set' }));

    // Índice del scope user_vault: base1 y sv08 tienen piezas del usuario; swsh1 no aparece.
    expect(await screen.findByRole('button', { name: /Base Set/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Surging Sparks/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sword & Shield/ })).toBeNull();
    // El contador «X/Y» cuenta VARIANTES, no cartas.
    expect(screen.getAllByText(/variantes ·/).length).toBeGreaterThan(0);
  });
});

/**
 * §33.4 (Stream A): cuarta pestaña «Retiros», direccionable por URL (`/vault?tab=retiros`), con
 * foco en el `role="tab"` activo al montar así, teclado WAI-ARIA (← → Home End) y el aviso de
 * aterrizaje «Retiro solicitado» que deja /shipments al pagar.
 */
describe('VaultView · pestaña «Retiros» (§33.4)', () => {
  it('cuatro pestañas con role=tab; el CTA de cabecera dice «Solicitar retiro» → /shipments', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Piezas', 'Master set', 'Sellado', 'Retiros']);
    expect(screen.getByRole('tab', { name: 'Piezas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Solicitar retiro' })).toHaveAttribute('href', '/shipments');
    // El «Retirar» por pieza no cambia (§33.4).
    expect(screen.getAllByRole('link', { name: 'Retirar' }).length).toBeGreaterThan(0);
  });

  it('con ?tab=retiros arranca en «Retiros», con el foco en esa pestaña, y monta la lista de retiros', async () => {
    search.tab = 'retiros';
    window.history.replaceState(null, '', '/es/vault?tab=retiros');
    renderWithProviders(<VaultView />, 'es');

    const tab = screen.getByRole('tab', { name: 'Retiros' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab);
    expect(await screen.findByRole('heading', { name: 'Mis retiros' })).toBeInTheDocument();
    expect(screen.queryByText('Valor del portafolio')).not.toBeInTheDocument();
  });

  it('clic en «Retiros» refleja ?tab=retiros en la URL y volver a «Piezas» lo quita', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    fireEvent.click(screen.getByRole('tab', { name: 'Retiros' }));
    expect(window.location.search).toBe('?tab=retiros');
    expect(await screen.findByRole('heading', { name: 'Mis retiros' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Piezas' }));
    expect(window.location.search).toBe('');
  });

  it('teclado: tabindex itinerante y flechas/Home/End mueven la selección y el foco', async () => {
    renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');
    const pieces = screen.getByRole('tab', { name: 'Piezas' });
    const master = screen.getByRole('tab', { name: 'Master set' });
    const withdrawals = screen.getByRole('tab', { name: 'Retiros' });
    expect(pieces).toHaveAttribute('tabindex', '0');
    expect(master).toHaveAttribute('tabindex', '-1');

    pieces.focus();
    fireEvent.keyDown(pieces, { key: 'ArrowRight' });
    expect(master).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(master);

    fireEvent.keyDown(master, { key: 'End' });
    expect(withdrawals).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(withdrawals);
    expect(withdrawals).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(withdrawals, { key: 'ArrowRight' });
    expect(pieces).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(pieces, { key: 'ArrowLeft' });
    expect(withdrawals).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(withdrawals, { key: 'Home' });
    expect(pieces).toHaveAttribute('aria-selected', 'true');
  });

  it('tras pagar un retiro (marca de sessionStorage) pinta «Retiro solicitado» UNA vez', async () => {
    search.tab = 'retiros';
    window.sessionStorage.setItem(WITHDRAWAL_REQUESTED_KEY, '1');
    renderWithProviders(<VaultView />, 'es');

    expect(await screen.findByRole('status')).toHaveTextContent('Retiro solicitado. Aquí verás su avance.');
    expect(window.sessionStorage.getItem(WITHDRAWAL_REQUESTED_KEY)).toBeNull();
  });

  it('el aviso de reclamables se pinta entre la cabecera y las pestañas SOLO cuando hay pedidos', async () => {
    setStoredUser({ id: 'u-777', email: 'ash@example.com', name: 'Ash', role: 'customer', locale: 'es', emailVerified: true });
    vi.spyOn(api, 'getClaimableOrders').mockResolvedValue([
      { orderId: 'ord-g-1', orderNumber: 'TCG-000777', status: 'settled', totalCents: 168520, itemCount: 1, createdAt: '2026-08-10T18:20:00Z' },
    ]);
    renderWithProviders(<VaultView />, 'es');
    const notice = await screen.findByTestId('claimable-orders-notice');
    // Orden en el DOM: h1 → aviso → tablist.
    const h1 = screen.getByRole('heading', { level: 1 });
    const tablist = screen.getByRole('tablist');
    expect(h1.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(screen.getByText('TCG-000777')).toBeInTheDocument());
  });
});

/**
 * ⭐ v1.80.7 (contrato §3 · `DESIGN_SYSTEM §37.10d`): `withdrawableReason` viaja con el flag. Un caso por motivo:
 * el botón RETIRAR apagado con su hint, el chip «Compra en reembolso» SOLO con `origin_refunded`, «La estamos
 * reponiendo» con `replacing`, y `null` ⇒ el enlace RETIRAR. La invariante `withdrawable === (reason === null)`
 * la mide `lib/mock/holding-withdrawable.test.ts` sobre la regla y sobre `GET /vault/holdings`.
 */
describe('VaultView · v1.80.7 · chip y hint por `withdrawableReason`', () => {
  const base = (): HoldingDTO => ({
    inventoryItemId: 'inv-x1',
    folio: 'INV-000901',
    card: mockHoldings[0].card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    ownershipStatus: 'settled',
    status: 'in_custody',
    referenceValue: { status: 'priced', referenceMxnCents: 10000, capturedDate: '2026-08-13' },
    shipmentState: null,
    activeShipmentId: null,
    withdrawable: true,
    withdrawableReason: null,
  });
  const serve = (h: Partial<HoldingDTO>) =>
    vi.spyOn(api, 'getHoldings').mockResolvedValue({
      data: [{ ...base(), ...h }],
      portfolio: { totalValueMxnCents: 10000, pendingPriceCount: 0, currency: 'MXN' },
    });

  it('`null` ⇒ RETIRAR es un enlace a /shipments?item=…, sin chip', async () => {
    serve({});
    renderWithProviders(<VaultView />, 'es');
    const link = await screen.findByRole('link', { name: 'Retirar' });
    expect(link).toHaveAttribute('href', '/shipments?item=inv-x1');
    expect(screen.queryByTestId('item-origin-refunded-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-replacing')).not.toBeInTheDocument();
  });

  it('`origin_refunded` ⇒ chip «Compra en reembolso» + su frase, y el botón apagado la repite como hint', async () => {
    serve({ withdrawable: false, withdrawableReason: 'origin_refunded' });
    renderWithProviders(<VaultView />, 'es');
    const chip = await screen.findByTestId('item-origin-refunded-chip');
    expect(chip).toHaveTextContent('Compra en reembolso');
    expect(chip).toHaveTextContent(
      'Esta carta viene de una compra que se está reembolsando: no se puede retirar. Si el reembolso no procede, volverá a estar disponible.',
    );
    const btn = screen.getByRole('button', { name: /Retirar — Esta carta viene de una compra/ });
    expect(btn).toBeDisabled();
    // ⛔ Nada de «Ya no está en tu bóveda» aquí: esa frase es del pedido reembolsado, no de una carta que sigue siendo suya.
    expect(screen.queryByText(/Ya no está en tu bóveda/)).not.toBeInTheDocument();
  });

  it('`replacing` (con `replacement` abierto) ⇒ «La estamos reponiendo» + motivo; hint «se está reponiendo»', async () => {
    serve({
      status: 'lost',
      withdrawable: false,
      withdrawableReason: 'replacing',
      replacement: { status: 'open', reason: 'not_found', refund: null },
    });
    renderWithProviders(<VaultView />, 'es');
    const chip = await screen.findByTestId('item-replacing');
    expect(chip).toHaveTextContent('La estamos reponiendo');
    expect(chip).toHaveTextContent('No la encontramos al prepararla.');
    expect(screen.getByRole('button', { name: /Retirar — Esta carta se está reponiendo/ })).toBeDisabled();
    expect(screen.queryByTestId('item-origin-refunded-chip')).not.toBeInTheDocument();
  });

  it('`replacing` SIN `replacement` (backend anterior) ⇒ el chip solo, sin frase de motivo', async () => {
    serve({ status: 'lost', withdrawable: false, withdrawableReason: 'replacing' });
    renderWithProviders(<VaultView />, 'es');
    const chip = await screen.findByTestId('item-replacing');
    expect(chip).toHaveTextContent('La estamos reponiendo');
    expect(chip).not.toHaveTextContent('No la encontramos');
  });

  it('`in_withdrawal` ⇒ badge EN RETIRO, hint «ya está en un retiro en curso», sin chip', async () => {
    serve({ shipmentState: 'guia', activeShipmentId: 'shp-1', withdrawable: false, withdrawableReason: 'in_withdrawal' });
    renderWithProviders(<VaultView />, 'es');
    expect(await screen.findByRole('button', { name: /Retirar — Esta carta ya está en un retiro en curso/ })).toBeDisabled();
    expect(screen.queryByTestId('item-origin-refunded-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-replacing')).not.toBeInTheDocument();
  });

  it.each([
    ['pending', { ownershipStatus: 'pending' as const }],
    ['not_in_custody', { status: 'damaged' as const }],
  ])('`%s` ⇒ hint de siempre («Solo las piezas liquidadas…»), sin chip', async (reason, over) => {
    serve({ ...over, withdrawable: false, withdrawableReason: reason as HoldingDTO['withdrawableReason'] });
    renderWithProviders(<VaultView />, 'es');
    expect(await screen.findByRole('button', { name: /Retirar — Solo las piezas liquidadas y sin envío activo/ })).toBeDisabled();
    expect(screen.queryByTestId('item-origin-refunded-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('item-replacing')).not.toBeInTheDocument();
  });

  it('withdrawableHintKey: una clave por motivo; sin motivo cae a `shipmentState`', () => {
    expect(withdrawableHintKey('origin_refunded', false)).toBe('item.originRefundedBody');
    expect(withdrawableHintKey('replacing', false)).toBe('item.replacingHint');
    expect(withdrawableHintKey('in_withdrawal', false)).toBe('inWithdrawalHint');
    expect(withdrawableHintKey('pending', false)).toBe('onlySettled');
    expect(withdrawableHintKey('not_in_custody', false)).toBe('onlySettled');
    expect(withdrawableHintKey(null, true)).toBe('inWithdrawalHint');
    expect(withdrawableHintKey(null, false)).toBe('onlySettled');
  });
});
