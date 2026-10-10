import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ManualRefundDetailView } from './ManualRefundDetailView';
import { ManualRefundsView } from '../ManualRefundsView';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { resetMockM4Ship } from '@/lib/mock/m4-ship';

/**
 * **La cubeta SPEI** (`DESIGN_SYSTEM §37.9`, contrato `§M4-SHIP.15.13/.17.3/.17.8`). Candados `PS-UI-7` (la CLABE
 * solo existe en la vista del reveal, en UN nodo, y desaparece al pagar) y `PS-UI-8` (la casilla reforzada aparece
 * SIN marcar cuando el `422` la pide, y el segundo `POST` la lleva solo tras marcarla).
 *
 * El «servidor» es el mock con estado (`mr-1001`: Ana, pendiente, CLABE registrada sin cambio reciente;
 * el cambio reciente de CLABE se simula con espías sobre el reveal y el pago).
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' as 'super_admin' | 'vault_operator' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: true }),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const EIGHTEEN_DIGITS = /\d{18}/;

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockM4Ship();
  roleState.role = 'super_admin';
  window.localStorage.setItem('tcg.role', 'super_admin');
});
afterEach(() => {
  window.localStorage.removeItem('tcg.role');
});

describe('PS-UI-7 · la CLABE solo vive en la vista del reveal', () => {
  it('lista: el HTML no contiene 18 dígitos seguidos (solo la máscara)', async () => {
    renderWithProviders(<ManualRefundsView />, 'es');
    await screen.findByTestId('mr-row-mr-1001');
    expect(document.body.innerHTML).not.toMatch(EIGHTEEN_DIGITS);
  });

  it('detalle: antes del reveal no hay 18 dígitos; tras «Revelar CLABE» están en UN `<output>`; tras «Marcar pagada» ya no', async () => {
    const paid = vi.spyOn(api, 'markManualRefundPaid');
    renderWithProviders(<ManualRefundDetailView id="mr-1001" />, 'es');

    const revealBtn = await screen.findByTestId('mr-reveal');
    expect(document.body.innerHTML).not.toMatch(EIGHTEEN_DIGITS);
    expect(screen.queryByTestId('mr-paid-cta')).not.toBeInTheDocument(); // «Marcar pagada» solo DENTRO del reveal

    fireEvent.click(revealBtn);
    const output = await screen.findByTestId('mr-clabe');
    expect(output.tagName).toBe('OUTPUT');
    expect(output.childNodes).toHaveLength(1);
    expect(output.textContent).toMatch(/^\d{18}$/);
    // ⛔ ni en un `title` ni en un `aria-label` (S5): el único nodo con la CLABE es el `<output>`.
    const clabe = output.textContent!;
    expect(document.body.innerHTML.split(clabe)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Copiar CLABE' })).not.toHaveAttribute('title');

    fireEvent.click(screen.getByTestId('mr-paid-cta'));
    const dialog = await screen.findByRole('dialog', { name: '¿Marcar como pagada?' });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    fireEvent.click(within(dialog).getByTestId('mr-paid-confirm'));

    await waitFor(() => expect(paid).toHaveBeenCalledWith('mr-1001', expect.objectContaining({ revealToken: expect.stringMatching(/^tok:/) })));
    await screen.findByTestId('mr-paid');
    expect(document.body.innerHTML).not.toMatch(EIGHTEEN_DIGITS);
    expect(screen.getByTestId('mr-notice')).toHaveTextContent(/Pagada\. Registrado a tu nombre/);
    expect(screen.getByTestId('mr-paid')).toHaveTextContent('Sin clave de rastreo');
  });

  it('«Ocultar CLABE» la quita de pantalla sin pagar nada', async () => {
    renderWithProviders(<ManualRefundDetailView id="mr-1001" />, 'es');
    fireEvent.click(await screen.findByTestId('mr-reveal'));
    await screen.findByTestId('mr-clabe');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar CLABE' }));
    await waitFor(() => expect(screen.queryByTestId('mr-clabe')).not.toBeInTheDocument());
    expect(document.body.innerHTML).not.toMatch(EIGHTEEN_DIGITS);
  });
});

describe('PS-UI-8 · `422 MANUAL_REFUND_CONFIRMATION_REQUIRED {required:[recent_clabe_change]}`', () => {
  it('aparece UNA casilla sin marcar; el botón sigue habilitado; el segundo POST lleva `confirmRecentClabeChange: true` solo tras marcarla', async () => {
    // El reveal dice que la CLABE cambió hace poco; el servidor exige la casilla en el primer POST y acepta el segundo.
    const real = api.revealManualRefundClabe;
    vi.spyOn(api, 'revealManualRefundClabe').mockImplementation(async (id) => ({ ...(await real(id)), clabeChangedRecently: true }));
    const realPaid = api.markManualRefundPaid;
    const paid = vi.spyOn(api, 'markManualRefundPaid').mockImplementation(async (id, body) => {
      if (body.confirmRecentClabeChange !== true) {
        throw new ApiClientError(422, { code: 'MANUAL_REFUND_CONFIRMATION_REQUIRED', message: 'confirm', details: { required: ['recent_clabe_change'], clabeUpdatedAt: '2026-09-28T10:00:00Z' } });
      }
      return realPaid(id, body);
    });
    renderWithProviders(<ManualRefundDetailView id="mr-1001" />, 'es');

    fireEvent.click(await screen.findByTestId('mr-reveal'));
    await screen.findByTestId('mr-clabe');
    // El aviso del cambio reciente ya está en la vista del reveal (§37.9b), pero la casilla ⛔ no se adelanta.
    expect(screen.getByText(/La CLABE cambió hace poco/)).toBeInTheDocument();
    expect(screen.queryByTestId('mr-confirm-clabe')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mr-paid-cta'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('mr-paid-confirm'));
    await waitFor(() => expect(paid).toHaveBeenCalledTimes(1));
    expect(paid.mock.calls[0][1]).not.toHaveProperty('confirmRecentClabeChange');

    const box = await screen.findByTestId('mr-confirm-clabe');
    expect(box).not.toBeChecked();
    expect(screen.queryByTestId('mr-confirm-origin')).not.toBeInTheDocument();
    expect(screen.getByTestId('mr-error')).toHaveTextContent('Falta confirmar lo de arriba.');
    expect(screen.getByTestId('mr-paid-cta')).toBeEnabled();
    // La CLABE sigue visible: el pago no se hizo y el reveal sigue siendo válido.
    expect(screen.getByTestId('mr-clabe')).toBeInTheDocument();

    fireEvent.click(box);
    fireEvent.click(screen.getByTestId('mr-paid-cta'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('mr-paid-confirm'));
    await waitFor(() => expect(paid).toHaveBeenCalledTimes(2));
    expect(paid.mock.calls[1][1]).toMatchObject({ confirmRecentClabeChange: true });
    await screen.findByTestId('mr-paid');
    expect(document.body.innerHTML).not.toMatch(EIGHTEEN_DIGITS);
  });
});

describe('PS-UI-6 · al operador la cubeta no existe', () => {
  it('rol `vault_operator`: ni la lista ni el detalle pintan la cubeta (ni «SPEI»)', async () => {
    roleState.role = 'vault_operator';
    window.localStorage.setItem('tcg.role', 'vault_operator');
    const { unmount } = renderWithProviders(<ManualRefundsView />, 'es');
    await waitFor(() => expect(screen.queryByTestId('mr-row-mr-1001')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/SPEI/);
    unmount();

    renderWithProviders(<ManualRefundDetailView id="mr-1001" />, 'es');
    await waitFor(() => expect(screen.queryByTestId('mr-reveal')).not.toBeInTheDocument());
    expect(document.body.innerHTML).not.toMatch(EIGHTEEN_DIGITS);
  });
});

/**
 * C-1 (techlead, LIVE-5 · `API_CONTRACT §14.5`): el aviso del cobro de origen se ve AL REVELAR la CLABE, antes de
 * transferir — el `422` de `paid` llega cuando el dinero ya salió. Rojo (`role="alert"`) y ENCIMA de la CLABE.
 */
describe('LIVE-5 C-1 · `reveal-clabe` trae `originCharge`: el aviso sale antes de transferir', () => {
  type Origin = { originCharge: { disputed: boolean; otherMode: boolean } | null; originChargeUnavailable: boolean };
  function revealWith(o: Origin) {
    const real = api.revealManualRefundClabe;
    vi.spyOn(api, 'revealManualRefundClabe').mockImplementation(async (id) => ({ ...(await real(id)), ...o }));
  }
  async function revealNow() {
    renderWithProviders(<ManualRefundDetailView id="mr-1001" />, 'es');
    fireEvent.click(await screen.findByTestId('mr-reveal'));
    return screen.findByTestId('mr-clabe');
  }
  function expectAboveClabe(banner: HTMLElement, clabe: HTMLElement) {
    expect(banner.compareDocumentPosition(clabe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  it('cobro con contracargo ⇒ aviso rojo «No transfieras» con el texto del contrato, encima de la CLABE', async () => {
    revealWith({ originCharge: { disputed: true, otherMode: false }, originChargeUnavailable: false });
    const clabe = await revealNow();
    const banner = screen.getByTestId('mr-origin-charge');
    expect(within(banner).getByRole('alert')).toBeInTheDocument();
    expect(banner).toHaveAttribute('data-reason', 'disputed');
    expect(banner).toHaveTextContent('No transfieras');
    expect(banner).toHaveTextContent('Este cobro tiene un contracargo en el banco. No transfieras: el banco ya está resolviendo el dinero.');
    expectAboveClabe(banner, clabe);
  });

  it('cobro de otro modo de Stripe ⇒ aviso rojo de modo prueba', async () => {
    revealWith({ originCharge: { disputed: false, otherMode: true }, originChargeUnavailable: false });
    const clabe = await revealNow();
    const banner = screen.getByTestId('mr-origin-charge');
    expect(within(banner).getByRole('alert')).toBeInTheDocument();
    expect(banner).toHaveAttribute('data-reason', 'other_mode');
    expect(banner).toHaveTextContent('Este pedido se pagó en modo prueba. No hay dinero real que devolver.');
    expectAboveClabe(banner, clabe);
  });

  it('Stripe no respondió ⇒ aviso rojo «revisa en tu panel de Stripe antes de transferir»', async () => {
    revealWith({ originCharge: null, originChargeUnavailable: true });
    const clabe = await revealNow();
    const banner = screen.getByTestId('mr-origin-charge');
    expect(within(banner).getByRole('alert')).toBeInTheDocument();
    expect(banner).toHaveAttribute('data-reason', 'unavailable');
    expect(banner).toHaveTextContent('No pudimos consultar Stripe. Revisa el cobro en tu panel de Stripe antes de transferir.');
    expectAboveClabe(banner, clabe);
  });

  it('en inglés también sale (paridad de claves)', async () => {
    revealWith({ originCharge: { disputed: true, otherMode: false }, originChargeUnavailable: false });
    renderWithProviders(<ManualRefundDetailView id="mr-1001" />, 'en');
    fireEvent.click(await screen.findByTestId('mr-reveal'));
    await screen.findByTestId('mr-clabe');
    expect(screen.getByTestId('mr-origin-charge')).toHaveTextContent(/chargeback/i);
  });

  it.each([
    ['cobro limpio', { originCharge: { disputed: false, otherMode: false }, originChargeUnavailable: false }],
    ['sin orden ni PI', { originCharge: null, originChargeUnavailable: false }],
  ] as const)('%s ⇒ sin aviso', async (_n, o) => {
    revealWith(o);
    await revealNow();
    expect(screen.queryByTestId('mr-origin-charge')).not.toBeInTheDocument();
  });

  it('el aviso se va con la CLABE («Ocultar CLABE»)', async () => {
    revealWith({ originCharge: { disputed: true, otherMode: false }, originChargeUnavailable: false });
    await revealNow();
    expect(screen.getByTestId('mr-origin-charge')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar CLABE' }));
    await waitFor(() => expect(screen.queryByTestId('mr-origin-charge')).not.toBeInTheDocument());
  });

  it('el `422 {required:[origin_not_settled], reason:payment_other_mode}` de `paid` nombra el modo prueba en la casilla, no «reembolsada»', async () => {
    revealWith({ originCharge: { disputed: false, otherMode: true }, originChargeUnavailable: false });
    vi.spyOn(api, 'markManualRefundPaid').mockRejectedValue(
      new ApiClientError(422, { code: 'MANUAL_REFUND_CONFIRMATION_REQUIRED', message: 'confirm', details: { required: ['origin_not_settled'], originStatus: 'settled', reason: 'payment_other_mode' } }),
    );
    await revealNow();
    fireEvent.click(screen.getByTestId('mr-paid-cta'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('mr-paid-confirm'));
    const box = await screen.findByTestId('mr-confirm-origin');
    expect(box.closest('label')).toHaveTextContent(/modo prueba/);
    expect(box.closest('label')).not.toHaveTextContent(/reembolsada/);
  });
});
