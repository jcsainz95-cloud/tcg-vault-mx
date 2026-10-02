import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, getDefaultNormalizer } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type {
  BuylistBatchQuoteResultDTO,
  BuylistQuoteItemDTO,
  BuylistSetDTO,
  CardDTO,
  MasterSetBinderResponse,
  MasterSetCardCellDTO,
  MasterSetIndexResponse,
  MasterSetSummaryDTO,
} from '@/types/contract';
import { MasterSetPanel } from './MasterSetPanel';
import type { MasterSetViewMode } from './mode';
import * as api from '@/lib/api';
import { formatCardCode, setMatchesQuery } from '@/lib/setCode';

/**
 * # P-71 (DESIGN_SYSTEM §37.3, contrato v1.80) — el código corto del set junto a las cartas
 *
 * - **P71-F1** teja con `ptcgoCode: null` ⇒ `#130`, y **ningún** «—» / «null» / «undefined».
 * - **P71-F2** con código ⇒ teja «TWM 130» (espacio NO separable) y cabecera del binder «TWM», en
 *   los CUATRO modos (`platform`, `user_vault_admin`, `user_vault_self`, `quoter`). En `quoter` el
 *   código viaja `BuylistSetDTO.ptcgoCode` → teja del índice → cabecera del binder; olvidar ese
 *   mapeo ⇒ rojo aquí.
 * - **P71-F3** «Buscar set» en `quoter` con `por` encuentra el set de código `POR` cuyo nombre no
 *   contiene «por»; un set con `ptcgoCode: null` no revienta el filtro.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

/** Mismo valor que `NBSP` de `@/lib/setCode`, escrito aparte a propósito: la prueba mide el carácter, no la constante. */
const NBSP = '\u00A0';
/** El normalizador por defecto colapsa el NBSP a un espacio: aquí se mide el carácter real. */
const KEEP_NBSP = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) };

function summary(code: string | null): MasterSetSummaryDTO {
  return {
    setId: 'sv06',
    name: 'Twilight Masquerade',
    series: 'Scarlet & Violet',
    year: 2024,
    logoUrl: null,
    ptcgoCode: code,
    catalogCardCount: 1,
    distinctCardsOwned: 0,
    completionPct: 0,
    totalPieces: 0,
    catalogVariantCount: 1,
    distinctVariantsOwned: 0,
    variantCompletionPct: 0,
  };
}

const CELL: MasterSetCardCellDTO = {
  cardId: 'c-dragapult',
  number: '130',
  name: 'Dragapult ex',
  rarity: 'Double Rare',
  imageSmallUrl: '',
  availableFinishes: ['normal'],
  displayFinishes: ['normal'],
  countsByFinish: [],
  totalCount: 0,
  isSecretRare: false,
  expectedVariantCount: 1,
  coveredVariantCount: 0,
  variants: [{ finish: 'normal', count: 0, covered: false, displayed: true, marketReferenceMxnCents: null }],
};

function binder(code: string | null, scope: 'platform' | 'user_vault'): MasterSetBinderResponse {
  return {
    set: { id: 'sv06', name: 'Twilight Masquerade', ptcgoCode: code },
    printedTotal: 167,
    catalogCardCount: 1,
    cells: [CELL],
    scope,
  };
}

function index(code: string | null, scope: 'platform' | 'user_vault'): MasterSetIndexResponse {
  return { data: [summary(code)], page: 1, pageSize: 24, total: 1, scope };
}

/** Monta los espías del modo con el set de código `code` (o `null`). */
function mockMode(mode: MasterSetViewMode, code: string | null) {
  if (mode === 'platform') {
    vi.spyOn(api, 'getMasterSets').mockResolvedValue(index(code, 'platform'));
    vi.spyOn(api, 'getMasterSetBinder').mockResolvedValue(binder(code, 'platform'));
  } else if (mode === 'user_vault_admin') {
    vi.spyOn(api, 'getAdminVaultMasterSets').mockResolvedValue(index(code, 'user_vault'));
    vi.spyOn(api, 'getAdminVaultMasterSetBinder').mockResolvedValue(binder(code, 'user_vault'));
  } else if (mode === 'user_vault_self') {
    vi.spyOn(api, 'getVaultMasterSets').mockResolvedValue(index(code, 'user_vault'));
    vi.spyOn(api, 'getVaultMasterSetBinder').mockResolvedValue(binder(code, 'user_vault'));
  } else {
    const set: BuylistSetDTO = {
      id: 'sv06',
      name: 'Twilight Masquerade',
      series: 'Scarlet & Violet',
      year: 2024,
      logoUrl: null,
      ptcgoCode: code,
    };
    vi.spyOn(api, 'listBuylistSets').mockResolvedValue([set]);
    const card: CardDTO = {
      id: 'c-dragapult',
      externalId: 'sv6-130',
      name: 'Dragapult ex',
      number: '130',
      rarity: 'Double Rare',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'sv06',
      setName: 'Twilight Masquerade',
      setPtcgoCode: code,
      imageSmallUrl: '',
      imageLargeUrl: '',
      availableFinishes: ['normal'],
    };
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [card], page: 1, pageSize: 50, total: 1 });
    vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
      results: items.map(
        (it, i): BuylistBatchQuoteResultDTO => ({
          index: i,
          cardId: it.cardId,
          ok: true,
          rarity: 'Double Rare',
          finish: it.finish ?? 'normal',
          priceBasis: 'market',
          quote: { status: 'cotizada', quotedPriceCents: 10000, currency: 'MXN' },
          referencePrice: { status: 'priced', priceMxnCents: 20000 },
          paymentNotice: 'PAY_AFTER_RECEIPT',
        }),
      ),
    }));
  }
}

async function openTheSet(mode: MasterSetViewMode) {
  renderWithProviders(
    <MasterSetPanel mode={mode} userId={mode === 'user_vault_admin' ? 'u-1' : undefined} onAddToSellCart={vi.fn()} />,
    'es',
  );
  fireEvent.click(await screen.findByRole('button', { name: /Twilight Masquerade/ }));
  await screen.findByRole('heading', { level: 2, name: 'Twilight Masquerade' });
  // La teja ya pintó su renglón de número.
  return screen.findAllByTestId('card-code');
}

const MODES: MasterSetViewMode[] = ['platform', 'user_vault_admin', 'user_vault_self', 'quoter'];

describe('P71-F1 · sin código, la teja se queda con «#130» — nunca «—», «null» ni «undefined»', () => {
  it.each(MODES)('%s', async (mode) => {
    mockMode(mode, null);
    const codes = await openTheSet(mode);
    for (const c of codes) {
      expect(c.textContent).toBe('#130');
      expect(c.textContent).not.toMatch(/—|null|undefined|N\/A/);
    }
    // Y la cabecera del binder no pinta nada en su lugar.
    expect(screen.queryByTestId('binder-set-code')).toBeNull();
    // Ni la teja del índice (se vuelve con el binder abierto: basta con que no exista en el DOM).
    expect(document.body.textContent).not.toMatch(/\bnull\b|\bundefined\b/);
  });
});

describe('P71-F2 · con código, teja «TWM 130» y cabecera «TWM» en los cuatro modos', () => {
  it.each(MODES)('%s', async (mode) => {
    mockMode(mode, 'TWM');
    const codes = await openTheSet(mode);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c.textContent).toBe(`TWM${NBSP}130`);
    expect(screen.getAllByText(`TWM${NBSP}130`, KEEP_NBSP).length).toBeGreaterThan(0);
    // Texto real, en su orden: sin aria-hidden ni tooltip que «explique» la sigla.
    expect(codes[0].closest('[aria-hidden="true"]')).toBeNull();
    expect(codes[0]).not.toHaveAttribute('title');
    const header = screen.getByTestId('binder-set-code');
    expect(header).toHaveTextContent('TWM');
    // En la misma línea base que el nombre: hermano del h2, dentro del mismo contenedor.
    expect(header.parentElement).toContainElement(
      screen.getByRole('heading', { level: 2, name: 'Twilight Masquerade' }),
    );
  });

  it('la teja del índice lleva el código bajo el nombre (quoter: mapeado desde `GET /buylist/sets`)', async () => {
    mockMode('quoter', 'TWM');
    renderWithProviders(<MasterSetPanel mode="quoter" onAddToSellCart={vi.fn()} />, 'es');
    const tile = await screen.findByRole('button', { name: /Twilight Masquerade/ });
    expect(within(tile).getByTestId('index-set-code')).toHaveTextContent('TWM');
  });

  it('el alta al carrito de venta recibe el código de la celda (para la línea «TWM 130 · …»)', async () => {
    mockMode('quoter', 'TWM');
    const onAdd = vi.fn();
    renderWithProviders(<MasterSetPanel mode="quoter" onAddToSellCart={onAdd} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Twilight Masquerade/ }));
    const add = await screen.findByRole('button', { name: /^Agregar Dragapult ex \(Normal\) a la venta/ });
    await vi.waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'c-dragapult' }), expect.anything(), 'TWM');
  });
});

describe('P71-F3 · «Buscar set» del cotizador casa también por código', () => {
  const SETS: BuylistSetDTO[] = [
    { id: 'me3', name: 'Perfect Order', year: 2026, logoUrl: null, ptcgoCode: 'POR' },
    { id: 'promo', name: 'Black Star Promos', year: 2025, logoUrl: null, ptcgoCode: null },
    { id: 'sv06', name: 'Twilight Masquerade', year: 2024, logoUrl: null, ptcgoCode: 'TWM' },
  ];

  it('«por» encuentra Perfect Order (código POR; su nombre no contiene «por») y el set sin código no revienta', async () => {
    vi.spyOn(api, 'listBuylistSets').mockResolvedValue(SETS);
    renderWithProviders(<MasterSetPanel mode="quoter" onAddToSellCart={vi.fn()} />, 'es');
    await screen.findByRole('button', { name: /Black Star Promos/ });
    fireEvent.change(screen.getByLabelText('Buscar set'), { target: { value: 'por' } });
    expect(await screen.findByRole('button', { name: /Perfect Order/ })).toBeInTheDocument();
    // Ni TWM ni «Black Star Promos» casan («promos» contiene «pro», no «por»; su código es null).
    expect(screen.queryByRole('button', { name: /Twilight Masquerade/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Black Star Promos/ })).toBeNull();
  });

  it('sin distinguir mayúsculas: «tWm» encuentra Twilight Masquerade; el nombre sigue funcionando', async () => {
    vi.spyOn(api, 'listBuylistSets').mockResolvedValue(SETS);
    renderWithProviders(<MasterSetPanel mode="quoter" onAddToSellCart={vi.fn()} />, 'es');
    await screen.findByRole('button', { name: /Black Star Promos/ });
    fireEvent.change(screen.getByLabelText('Buscar set'), { target: { value: 'tWm' } });
    expect(await screen.findByRole('button', { name: /Twilight Masquerade/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Perfect Order/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar set'), { target: { value: 'black star' } });
    expect(await screen.findByRole('button', { name: /Black Star Promos/ })).toBeInTheDocument();
  });
});

describe('P-71 · la función de formato y la de búsqueda (una sola forma)', () => {
  it('formatCardCode', () => {
    expect(formatCardCode('TWM', '130')).toBe(`TWM${NBSP}130`);
    expect(formatCardCode(null, '130')).toBe('#130');
    expect(formatCardCode(undefined, '130')).toBe('#130');
    expect(formatCardCode('', '130')).toBe('#130');
    expect(formatCardCode('   ', '130')).toBe('#130');
    // Tal como llega: sin mayúsculas forzadas.
    expect(formatCardCode('twm', '130')).toBe(`twm${NBSP}130`);
    expect(formatCardCode('TWM', '')).toBe('TWM');
    expect(formatCardCode(null, '')).toBe('');
  });

  it('setMatchesQuery', () => {
    expect(setMatchesQuery('Perfect Order', 'POR', 'por')).toBe(true);
    expect(setMatchesQuery('Perfect Order', 'POR', 'order')).toBe(true);
    expect(setMatchesQuery('Black Star Promos', null, 'por')).toBe(false);
    expect(setMatchesQuery('Black Star Promos', null, 'promo')).toBe(true);
    expect(setMatchesQuery('Anything', null, '  ')).toBe(true);
  });
});
