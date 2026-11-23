import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import es from '../../../../../../messages/es.json';
import * as api from '@/lib/api';
import type { BuyDecision, CardDTO, SellItemDTO, SellRequestStatus } from '@/types/contract';
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';

/**
 * Lista ÚNICA de cartas de M5 (dueño 2026-11-22): las mismas cartas ya no salen dos veces (mesa de solo lectura + partidas).
 * Una fila por carta con carta · cotizado · pactado · estado; las NO compradas, plegadas en un grupo con la frase una sola vez.
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const TAB = es.admin.m5.tabs as Record<string, string>;

function card(id: string, name: string): CardDTO {
  return {
    id, externalId: id, name, number: '4', rarity: 'Rare', supertype: 'Pokémon', subtypes: [], setId: 'base1',
    setName: 'Base Set', setPtcgoCode: 'BS', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'],
  };
}
function item(id: string, name: string, offerDecision: BuyDecision | null, offered: number | null): SellItemDTO {
  return {
    id, card: card(`c-${id}`, name), productType: 'raw', finish: 'normal', quotedPriceCents: 10_000,
    itemStatus: 'cotizada', offerDecision, offeredPriceCents: offered,
  };
}
const ITEMS = () => [
  item('it-a', 'Alakazam', 'buy', 8_500),
  item('it-b', 'Blastoise', 'buy', 7_000),
  item('it-s', 'Squirtle', 'skip', null),
  item('it-t', 'Tauros', 'skip', null),
];

async function render(status: SellRequestStatus, items: SellItemDTO[] = ITEMS(), tabName?: string) {
  const r = srv({
    id: 'sr-ul', userId: 'u-ul', seller: { id: 'u-ul', name: 'Vendedor', email: 'v@example.com' }, status,
    quotedTotalCents: 30_000, createdAt: '2026-09-01T00:00:00.000Z', receivedAt: null, verifiedAt: null,
    approvedTotalCents: null, offerSentAt: '2026-09-01T10:00:00.000Z', items,
  });
  vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [r], page: 1, pageSize: 25, total: 1 });
  renderWithProviders(<M5View />, 'es');
  const tab = tabName ?? (status === 'cotizada' ? TAB.por_ofertar : TAB.con_vendedor);
  fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${tab}`) }));
  await screen.findByText('sr-ul');
}

beforeEach(() => vi.restoreAllMocks());

describe('Lista única de cartas (M5)', () => {
  it('aceptada: ya no hay «mesa de solo lectura»; el pactado va en la fila y las no compradas, plegadas con la frase UNA vez', async () => {
    await render('aceptada');
    expect(screen.queryByTestId('mesa-ro-sr-ul')).not.toBeInTheDocument();
    expect(screen.queryByText('Mesa de decisiones')).not.toBeInTheDocument();
    expect(screen.getByTestId('m5-items-summary-sr-ul')).toHaveTextContent('Se compran 2 · No entraron en la oferta 2');
    // Cada carta comprada: UNA fila con su pactado (MX$ del servidor).
    expect(screen.getAllByTestId(/^m5-item-/)).toHaveLength(4);
    expect(within(screen.getByTestId('m5-item-it-a')).getByTestId('m5-agreed-it-a')).toHaveTextContent('MX$85.00');
    // Las no compradas viven dentro del grupo; la explicación sale una sola vez.
    const group = screen.getByTestId('m5-notbought-group-sr-ul');
    expect(within(group).getByText('No compradas (2)')).toBeInTheDocument();
    expect(within(group).getByTestId('m5-item-it-s')).toBeInTheDocument();
    expect(within(group).queryByTestId('m5-item-it-a')).not.toBeInTheDocument();
    expect(screen.getAllByText(/no se aprueban ni se rechazan/)).toHaveLength(1);
  });

  it('por ofertar: con la mesa abierta la mesa ES la lista (no se repite); cerrada, la lista está', async () => {
    vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue({
      sellRequestId: 'sr-ul', mode: 'edit', status: 'cotizada', lines: [],
      totals: { buyableGrossCents: 0, shippingFeeCents: 0, netCents: 0, minimumOfferNetCents: 0, requiredGrossCents: 0, netBelowMinimum: false },
      operatorCapCents: 0, requiresAuthorization: false, pickupAddressMissing: false,
    } as never);
    await render('cotizada');
    expect(screen.getByTestId('m5-items-sr-ul')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: es.admin.m5.desk.open }));
    await waitFor(() => expect(screen.queryByTestId('m5-items-sr-ul')).not.toBeInTheDocument());
    expect(screen.getByTestId('decision-desk')).toBeInTheDocument();
  });

  it('por ofertar: mientras la mesa carga, o si falla, la lista de cartas SIGUE visible', async () => {
    vi.spyOn(api, 'getBuylistDecisionTable').mockReturnValue(new Promise(() => {}));
    await render('cotizada');
    fireEvent.click(screen.getByRole('button', { name: es.admin.m5.desk.open }));
    expect(screen.getByTestId('decision-desk')).toBeInTheDocument();
    expect(screen.getByTestId('m5-items-sr-ul')).toBeInTheDocument();
  });

  it('por ofertar: si la mesa falla, la lista sigue visible', async () => {
    vi.spyOn(api, 'getBuylistDecisionTable').mockRejectedValue(new Error('boom'));
    await render('cotizada');
    fireEvent.click(screen.getByRole('button', { name: es.admin.m5.desk.open }));
    await waitFor(() => expect(screen.getByTestId('decision-desk')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('m5-items-sr-ul')).toBeInTheDocument();
  });

  it('fuera de revisión (en tránsito): el pactado es agreedPriceCents (baja aceptada), no el ofertado', async () => {
    const items = [
      { ...item('it-a', 'Alakazam', 'buy', 8_500), itemStatus: 'ajustada' as const, approvedPriceCents: 6_000, revision: { state: 'accepted' } },
    ] as unknown as SellItemDTO[];
    await render('en_transito', items);
    expect(screen.getByTestId('m5-agreed-it-a')).toHaveTextContent('MX$60.00');
  });

  it('baja aceptada (ofertado distinto del pactado): se ven ambos importes', async () => {
    const items = [
      { ...item('it-a', 'Alakazam', 'buy', 8_500), itemStatus: 'ajustada' as const, approvedPriceCents: 6_000, revision: { state: 'accepted' } },
    ] as unknown as SellItemDTO[];
    await render('en_transito', items);
    expect(screen.getByTestId('m5-agreed-it-a')).toHaveTextContent('MX$60.00');
    expect(screen.getByTestId('offered-original-it-a')).toHaveTextContent('Ofertado: MX$85.00');
  });

  it('ofertado igual al pactado: no hay línea extra', async () => {
    const items = [
      { ...item('it-a', 'Alakazam', 'buy', 8_500), itemStatus: 'ajustada' as const, approvedPriceCents: 8_500, revision: { state: 'accepted' } },
    ] as unknown as SellItemDTO[];
    await render('en_transito', items);
    expect(screen.getByTestId('m5-agreed-it-a')).toHaveTextContent('MX$85.00');
    expect(screen.queryByTestId('offered-original-it-a')).toBeNull();
  });

  it('sin baja aceptada (pactado = ofertado por defecto): no hay línea extra', async () => {
    await render('en_transito', [{ ...item('it-a', 'Alakazam', 'buy', 8_500), itemStatus: 'ajustada' as const }] as unknown as SellItemDTO[]);
    expect(screen.getByTestId('m5-agreed-it-a')).toHaveTextContent('MX$85.00');
    expect(screen.queryByTestId('offered-original-it-a')).toBeNull();
  });

  it.each(['recibida', 'verificacion', 'aprobada'] as const)('m-28: en revisión (%s) el ofertado original sale UNA sola vez', async (st) => {
    const items = [
      { ...item('it-a', 'Alakazam', 'buy', 8_500), itemStatus: 'ajustada' as const, approvedPriceCents: 6_000, revision: { state: 'accepted' } },
    ] as unknown as SellItemDTO[];
    vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue({ sellRequestId: 'sr-ul', lines: [] } as never);
    await render(st, items, st === 'aprobada' ? TAB.por_pagar : TAB.verificando);
    expect(screen.getByTestId('agreed-it-a')).toHaveTextContent('MX$60.00'); // vista de revisión
    const row = screen.getByTestId('m5-item-it-a');
    expect(within(row).getAllByText(/Ofertado: MX\$85\.00/)).toHaveLength(1);
  });

  it('m-27: con ofertado null (y pactado) no hay línea extra ni MX$0.00', async () => {
    const items = [
      { ...item('it-a', 'Alakazam', 'buy', null), itemStatus: 'ajustada' as const, approvedPriceCents: 6_000, revision: { state: 'accepted' } },
    ] as unknown as SellItemDTO[];
    await render('en_transito', items);
    expect(screen.queryByTestId('offered-original-it-a')).toBeNull();
    expect(screen.getByTestId('m5-item-it-a')).not.toHaveTextContent('MX$0.00');
  });

  it('no comprada con rechazo: conserva el detalle del rechazo, la baja retirada y «Aprobado»', async () => {
    const items = [
      { ...item('it-s', 'Squirtle', 'skip', null), itemStatus: 'rechazada' as const, rejectionReason: 'dobleces', approvedPriceCents: 1_200, revision: { state: 'cancelled' } },
    ] as unknown as SellItemDTO[];
    await render('verificacion', items, TAB.verificando);
    const r = screen.getByTestId('m5-item-it-s');
    expect(within(r).getByText(/dobleces/)).toBeInTheDocument();
    expect(within(r).getByTestId('f2-retired-it-s')).toBeInTheDocument();
    expect(within(r).getByText(/MX\$12\.00/)).toBeInTheDocument();
  });
});
