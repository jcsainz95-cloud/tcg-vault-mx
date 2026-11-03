/**
 * IDS-F1 (API_CONTRACT §IDS.9, criterios 513 y 530; IDS-UX.6 candados 2–4) — captura con Idioma y Versión.
 *  (2) inglés + sin liga = 0 toques: la pieza viaja SIN `language` ni `cardProductId` (cuerpo de hoy);
 *  (3) sin productos de liga ni candidatas, la fila «Versión» no existe;
 *  (4) una versión sin precio está apagada con su motivo y no se puede crear;
 *  sin campo de precio (I-4); candidata ⇒ `attach`; «Sin liga» y «No holo» (⛔ «Normal»);
 *  desglose (v1.116.2) con `baseReferenceMxnCents` y `appliedMarketPct` DEL COMBO, sin aritmética del navegador.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { CardDTO, CardVersionsResponse, Paginated, VersionComboDTO } from '@/types/contract';
import { AddItemModal } from './AddItemModal';

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m1',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeEach(() => vi.restoreAllMocks());

function card(id: string, availableFinishes: CardDTO['availableFinishes']): CardDTO {
  return {
    id,
    externalId: id,
    name: `Card ${id}`,
    number: '1',
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    setId: 'sv1',
    setName: 'Set',
    setPtcgoCode: null,
    imageSmallUrl: null,
    imageLargeUrl: null,
    availableFinishes,
  } as unknown as CardDTO;
}
const page = (cards: CardDTO[]): Paginated<CardDTO> => ({ data: cards, page: 1, pageSize: 50, total: cards.length });
const PP = { type: 'prize_pack' as const, label: null, productId: 648703 };
const STAFF = { type: 'staff' as const, label: null, productId: 610001 };
const combo = (o: Partial<VersionComboDTO>): VersionComboDTO => ({
  finish: 'holofoil',
  finishLabel: 'holo',
  language: 'en',
  stamp: null,
  previewPriceCents: 20000,
  baseReferenceMxnCents: 20000,
  appliedMarketPct: null,
  unavailableReason: null,
  ...o,
});

const PLAIN: CardVersionsResponse = {
  combos: [combo({}), combo({ language: 'es', previewPriceCents: 15000, appliedMarketPct: 75 })],
  candidates: [],
};
const STAMPED: CardVersionsResponse = {
  combos: [
    ...PLAIN.combos,
    combo({ stamp: PP, previewPriceCents: 48000, baseReferenceMxnCents: 48000 }),
    // `P` ≠ base × X a propósito (curva, piso e IVA van después): el navegador no recompone nada.
    combo({ stamp: PP, language: 'es', previewPriceCents: 36000, baseReferenceMxnCents: 48000, appliedMarketPct: 75 }),
    // Prize Pack también en No holo (acabado que la carta holo no tiene) ⇒ Acabado pasa a burbujas.
    combo({ stamp: PP, finish: 'normal', finishLabel: 'non_holo', previewPriceCents: 9000 }),
    combo({ stamp: PP, finish: 'normal', finishLabel: 'non_holo', language: 'es', previewPriceCents: 6750 }),
    combo({ stamp: STAFF, previewPriceCents: null, unavailableReason: 'no_stamped_market' }),
    combo({ stamp: STAFF, language: 'es', previewPriceCents: null, unavailableReason: 'no_stamped_market' }),
  ],
  candidates: [{ tcgplayerProductId: 777001, name: 'Pikachu (Prize Pack Series Seven)', stamp: { ...PP, productId: 777001 }, finishes: ['normal'] }],
};

async function open(c: CardDTO, versions: CardVersionsResponse) {
  vi.spyOn(api, 'getLocations').mockResolvedValue([]);
  vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([c]));
  vi.spyOn(api, 'getCardVersions').mockResolvedValue(versions);
  vi.spyOn(api, 'getSettings').mockResolvedValue({ spanishMarketPct: 75 } as never);
  const create = vi.spyOn(api, 'createInventoryItem').mockResolvedValue({ id: 'n1', folio: 'INV-1', status: 'listed', acquisitionCostCents: 0 });
  renderWithProviders(<AddItemModal onClose={() => {}} onToast={() => {}} />, 'es');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'x' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
  fireEvent.click(await within(dialog).findByRole('option', { name: new RegExp(c.name) }));
  await within(dialog).findByTestId('ids-price');
  return { dialog, create };
}

describe('IDS-F1 · captura (AddItemModal)', () => {
  it('(2)(3) carta sin liga: Idioma con «Inglés» de fábrica, SIN fila «Versión»; 0 toques ⇒ cuerpo de hoy', async () => {
    const { dialog, create } = await open(card('c-plain', ['holofoil']), PLAIN);
    const lang = within(dialog).getByRole('radiogroup', { name: 'Idioma' });
    expect(within(lang).getByRole('radio', { name: 'Inglés' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).queryByRole('radiogroup', { name: 'Versión' })).toBeNull();
    // Precio automático, sin campo de precio tecleable
    expect(within(dialog).getByTestId('ids-price')).toHaveTextContent('Precio de venta (auto)');
    expect(within(dialog).queryByLabelText(/precio/i)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const body = create.mock.calls[0][0];
    expect(body).not.toHaveProperty('language');
    expect(body).not.toHaveProperty('cardProductId');
    expect(body).not.toHaveProperty('listPriceCents');
  });

  it('versión: «Sin liga» (⛔ «Normal»), Prize Pack con precio y «Staff» apagada con su motivo', async () => {
    const { dialog } = await open(card('c-st', ['holofoil']), STAMPED);
    const version = within(dialog).getByRole('radiogroup', { name: 'Versión' });
    const radios = within(version).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Sin liga', 'De liga · Prize Pack', 'Staff']);
    expect(within(dialog).getByTestId('ids-capture').textContent).not.toMatch(/\bNormal\b/);
    const staff = within(version).getByRole('radio', { name: 'Staff' });
    expect(staff).toHaveAttribute('aria-disabled', 'true');
    expect(staff).toHaveAccessibleDescription('Sin mercado de esta versión');
    fireEvent.click(staff);
    expect(within(version).getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Acabado × Versión: la liga trae «No holo» ⇒ Acabado en burbujas con «No holo»; de fábrica el de la carta', async () => {
    const { dialog } = await open(card('c-st', ['holofoil']), STAMPED);
    const fin = within(dialog).getByTestId('ids-finish');
    expect(within(fin).getAllByRole('radio').map((r) => r.textContent)).toEqual(['No holo', 'Holo']);
    expect(within(fin).getByRole('radio', { name: 'Holo' })).toHaveAttribute('aria-checked', 'true');
    // «Sin liga» no existe en No holo ⇒ apagada y se pasa a la versión válida.
    fireEvent.click(within(fin).getByRole('radio', { name: 'No holo' }));
    const version = within(dialog).getByRole('radiogroup', { name: 'Versión' });
    expect(within(version).getByRole('radio', { name: 'Sin liga' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(version).getByRole('radio', { name: 'De liga · Prize Pack' })).toHaveAttribute('aria-checked', 'true');
  });

  it('español de liga: +2 toques, precio del servidor con desglose en una línea; viaja `language` y `cardProductId`, sin precio', async () => {
    const { dialog, create } = await open(card('c-st', ['holofoil']), STAMPED);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Español' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'De liga · Prize Pack' }));
    expect(within(dialog).getByTestId('ids-price')).toHaveTextContent('MX$360.00');
    expect(within(dialog).getByTestId('ids-breakdown').textContent).toBe('Base: De liga · Prize Pack en inglés · MX$480.00 × 75 % (español)');
    expect(within(dialog).getByTestId('ids-breakdown').className).toContain('whitespace-nowrap');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const body = create.mock.calls[0][0];
    expect(body.language).toBe('es');
    expect(body.cardProductId).toBe(648703);
    expect(body).not.toHaveProperty('listPriceCents');
  });

  it('desglose: la base y el % salen del COMBO (no de Ajustes) y el navegador no los multiplica', async () => {
    const odd: CardVersionsResponse = {
      combos: [
        combo({ baseReferenceMxnCents: 31000, previewPriceCents: 39900 }),
        // Dial del servidor en 80 aunque Ajustes diga 75; P (25 900) ≠ 31 000 × 80 % (24 800): se pinta P tal cual.
        combo({ language: 'es', baseReferenceMxnCents: 31000, appliedMarketPct: 80, previewPriceCents: 25900 }),
      ],
      candidates: [],
    };
    const { dialog } = await open(card('c-odd', ['holofoil']), odd);
    expect(within(dialog).getByTestId('ids-breakdown').textContent).toBe('Base: Sin liga en inglés · MX$310.00 (mercado de TCGplayer)');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Español' }));
    expect(within(dialog).getByTestId('ids-price')).toHaveTextContent('MX$259.00');
    expect(within(dialog).getByTestId('ids-breakdown').textContent).toBe('Base: Sin liga en inglés · MX$310.00 × 80 % (español)');
    expect(within(dialog).getByTestId('ids-capture').textContent).not.toMatch(/248\.00|75 %/);
    expect(api.getSettings).not.toHaveBeenCalled();
  });

  it('desglose sin base del servidor ⇒ no inventa la cifra', async () => {
    const noBase: CardVersionsResponse = {
      combos: [combo({ baseReferenceMxnCents: null }), combo({ language: 'es', baseReferenceMxnCents: null, appliedMarketPct: 75, previewPriceCents: 15000 })],
      candidates: [],
    };
    const { dialog } = await open(card('c-nb', ['holofoil']), noBase);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Español' }));
    expect(within(dialog).getByTestId('ids-breakdown').textContent).toBe('Base: Sin liga en inglés · × 75 % (español)');
    expect(within(dialog).getByTestId('ids-breakdown').textContent).not.toMatch(/MX\$/);
  });

  it('(4) versión no default sin precio ⇒ no se puede crear', async () => {
    const noEs: CardVersionsResponse = {
      combos: [combo({}), combo({ language: 'es', previewPriceCents: null, unavailableReason: 'no_english_market' })],
      candidates: [],
    };
    const { dialog } = await open(card('c-x', ['holofoil']), noEs);
    const es = within(dialog).getByRole('radio', { name: 'Español' });
    expect(es).toHaveAttribute('aria-disabled', 'true');
    expect(es).toHaveAccessibleDescription('Sin mercado del inglés');
  });

  it('candidata ⇒ «Es esta: …» llama a attach con el producto y la carta', async () => {
    const attach = vi.spyOn(api, 'attachStampedCandidate').mockResolvedValue(STAMPED);
    const { dialog } = await open(card('c-st', ['holofoil']), STAMPED);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Es esta: Pikachu (Prize Pack Series Seven)' }));
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));
    expect(attach.mock.calls[0][0]).toBe(777001);
    expect(attach.mock.calls[0][1].id).toBe('c-st');
  });
});
