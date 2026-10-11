import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View, M5_STATUS_TAB } from './M5View';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { SellRequestStatus } from '@/types/contract';
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';

/**
 * # P-M5-DECLINE — «Declinar» en `cotizada` y «Cancelar la oferta» en `ofertada` (DESIGN_SYSTEM §25.8, D39)
 *
 * - **DC-1** matriz por los 11 estados × los DOS roles: «Declinar» ⇔ `cotizada`; «Cancelar la oferta» ⇔ `ofertada`
 *   (contrato, tabla «Qué ofrece M5 en cada estado»). El verbo es de `vault_operator` y de `super_admin`.
 * - **DC-2** confirmar llama a `declineBuylistRequest(id, { reason })` — y NO a `cancelBuylistOffer` —, avisa a
 *   nivel de página y vuelve a pedir la lista (invalida `['admin-buylist']`).
 * - **DC-3** `409 DECLINE_NOT_ALLOWED` se lee DENTRO del diálogo con el copy de §27.2 (`error.DECLINE_NOT_ALLOWED`),
 *   ⛔ nunca el inglés del servidor; el diálogo sigue abierto.
 * - **DC-4** «Cancelar la oferta» llama a `cancelBuylistOffer`, y su `409 OFFER_NOT_CANCELLABLE` también tiene copy.
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const ALL_STATUSES = Object.keys(M5_STATUS_TAB) as SellRequestStatus[];
const TAB_LABELS = es.admin.m5.tabs as Record<string, string>;
const D = es.admin.m5.desk;

function rowIn(status: SellRequestStatus) {
  const reached = (s: SellRequestStatus[]) => s.includes(status);
  return srv({
    id: `sr-${status}`,
    userId: 'u-matrix',
    seller: { id: 'u-matrix', name: 'Matriz D', email: 'matriz@example.com' },
    status,
    quotedTotalCents: 1000,
    createdAt: '2026-09-01T00:00:00.000Z',
    receivedAt: reached(['recibida', 'verificacion', 'aprobada', 'pagada']) ? '2026-09-02T00:00:00.000Z' : null,
    verifiedAt: reached(['verificacion', 'aprobada', 'pagada']) ? '2026-09-03T00:00:00.000Z' : null,
    approvedTotalCents: reached(['aprobada', 'pagada']) ? 1000 : null,
    offerSentAt: reached(['ofertada', 'aceptada', 'en_transito']) ? '2026-09-02T00:00:00.000Z' : null,
    items: [],
  });
}

async function openTabFor(status: SellRequestStatus) {
  const tab = TAB_LABELS[M5_STATUS_TAB[status]];
  fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${tab}`) }));
  await screen.findByText(`sr-${status}`);
}

function listOf(status: SellRequestStatus) {
  return vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [rowIn(status)], page: 1, pageSize: 25, total: 1 });
}

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

describe('DC-1 · «Declinar» ⇔ cotizada y «Cancelar la oferta» ⇔ ofertada, para los dos roles', () => {
  const CASES = (['super_admin', 'vault_operator'] as const).flatMap((role) => ALL_STATUSES.map((s) => [role, s] as const));
  it.each(CASES)('%s · %s', async (role, status) => {
    roleState.role = role;
    listOf(status);
    renderWithProviders(<M5View />, 'es');
    await openTabFor(status);
    const decline = screen.queryByRole('button', { name: D.decline.action });
    const cancel = screen.queryByRole('button', { name: D.cancelOffer.action });
    if (status === 'cotizada') expect(decline).toBeInTheDocument();
    else expect(decline).toBeNull();
    if (status === 'ofertada') expect(cancel).toBeInTheDocument();
    else expect(cancel).toBeNull();
  });
});

describe('DC-2 · declinar: diálogo §25.8 → POST …/decline → aviso y lista recargada', () => {
  it('como operador: motivo opcional, llama al verbo correcto y avisa', async () => {
    roleState.role = 'vault_operator';
    const list = listOf('cotizada');
    const decline = vi.spyOn(api, 'declineBuylistRequest').mockResolvedValue(rowIn('expirada'));
    const cancel = vi.spyOn(api, 'cancelBuylistOffer');
    renderWithProviders(<M5View />, 'es');
    await openTabFor('cotizada');

    fireEvent.click(screen.getByRole('button', { name: D.decline.action }));
    const dialog = await screen.findByRole('dialog', { name: D.decline.title });
    expect(within(dialog).getByText(D.decline.body)).toBeInTheDocument();
    expect(within(dialog).getByText(D.decline.reasonHint)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(D.decline.reasonLabel), { target: { value: 'no nos interesa' } });
    const callsBefore = list.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: D.decline.confirm }));

    await waitFor(() => expect(decline).toHaveBeenCalledWith('sr-cotizada', { reason: 'no nos interesa' }));
    expect(cancel).not.toHaveBeenCalled();
    expect(await screen.findByTestId('m5-page-notice')).toHaveTextContent('sr-cotizada');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('en inglés, el diálogo usa su copy (paridad)', async () => {
    listOf('cotizada');
    renderWithProviders(<M5View />, 'en');
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${(en.admin.m5.tabs as Record<string, string>)[M5_STATUS_TAB.cotizada]}`) }));
    await screen.findByText('sr-cotizada');
    fireEvent.click(screen.getByRole('button', { name: en.admin.m5.desk.decline.action }));
    const dialog = await screen.findByRole('dialog', { name: en.admin.m5.desk.decline.title });
    expect(within(dialog).getByRole('button', { name: en.admin.m5.desk.decline.confirm })).toBeInTheDocument();
  });
});

describe('DC-3 · `409 DECLINE_NOT_ALLOWED` se lee en español, dentro del diálogo', () => {
  it('copy de §27.2 y nada del servidor; el diálogo no se cierra', async () => {
    listOf('cotizada');
    vi.spyOn(api, 'declineBuylistRequest').mockRejectedValue(
      new ApiClientError(409, {
        code: 'DECLINE_NOT_ALLOWED',
        message: 'Sell request cannot be declined',
        details: { status: 'ofertada', offerState: 'sent' },
      }),
    );
    renderWithProviders(<M5View />, 'es');
    await openTabFor('cotizada');
    fireEvent.click(screen.getByRole('button', { name: D.decline.action }));
    const dialog = await screen.findByRole('dialog', { name: D.decline.title });
    fireEvent.click(within(dialog).getByRole('button', { name: D.decline.confirm }));

    expect(await within(dialog).findByText(es.error.DECLINE_NOT_ALLOWED)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be declined/)).toBeNull();
    expect(screen.queryByTestId('m5-page-notice')).toBeNull();
  });
});

describe('DC-4 · cancelar la oferta de una `ofertada`', () => {
  it('llama a POST …/offer/cancel (no a decline) y avisa', async () => {
    roleState.role = 'vault_operator';
    listOf('ofertada');
    const cancel = vi.spyOn(api, 'cancelBuylistOffer').mockResolvedValue(rowIn('cotizada'));
    const decline = vi.spyOn(api, 'declineBuylistRequest');
    renderWithProviders(<M5View />, 'es');
    await openTabFor('ofertada');
    fireEvent.click(screen.getByRole('button', { name: D.cancelOffer.action }));
    const dialog = await screen.findByRole('dialog', { name: D.cancelOffer.title });
    expect(within(dialog).getByText(D.cancelOffer.body)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: D.cancelOffer.confirm }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('sr-ofertada', { reason: '' }));
    expect(decline).not.toHaveBeenCalled();
    expect(await screen.findByTestId('m5-page-notice')).toHaveTextContent('sr-ofertada');
  });

  it('`409 OFFER_NOT_CANCELLABLE` tiene copy propio en el diálogo', async () => {
    listOf('ofertada');
    vi.spyOn(api, 'cancelBuylistOffer').mockRejectedValue(
      new ApiClientError(409, { code: 'OFFER_NOT_CANCELLABLE', message: 'no live offer', details: { status: 'aceptada' } }),
    );
    renderWithProviders(<M5View />, 'es');
    await openTabFor('ofertada');
    fireEvent.click(screen.getByRole('button', { name: D.cancelOffer.action }));
    const dialog = await screen.findByRole('dialog', { name: D.cancelOffer.title });
    fireEvent.click(within(dialog).getByRole('button', { name: D.cancelOffer.confirm }));
    expect(await within(dialog).findByText(es.error.OFFER_NOT_CANCELLABLE)).toBeInTheDocument();
    expect(screen.queryByText('no live offer')).toBeNull();
  });
});
