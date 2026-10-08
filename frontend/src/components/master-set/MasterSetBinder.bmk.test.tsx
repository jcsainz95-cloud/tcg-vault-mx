import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type {
  BuylistBatchQuoteResultDTO,
  BuylistQuoteItemDTO,
  CardDTO,
  Finish,
  MasterSetBinderResponse,
  MasterSetSummaryDTO,
} from '@/types/contract';
import es from '../../../messages/es.json';

/**
 * §BMK (API_CONTRACT §BMK.3–§BMK.5, §BMK.8 · DESIGN_SYSTEM §BMK.2–§BMK.4, §BMK.11) — el cotizador
 * pinta «Valor de mercado» junto a «Te pagamos» por carta, con UNA regla (`visibleMarketCents`) y UNA
 * fuente (`referencePrice` de la cotización; ⛔ nunca `CardProductDTO.prices[]`).
 *
 * El binder del cotizador se compone con `GET /buylist/cards` + `POST /buylist/quote/batch`; aquí los
 * dos se mockean con cotizaciones fijas para poder afirmar cifras exactas.
 */
vi.mock('@/lib/api', () => ({
  getMasterSetBinder: vi.fn(),
  getAdminVaultMasterSetBinder: vi.fn(),
  getVaultMasterSetBinder: vi.fn(),
  searchBuylistCards: vi.fn(),
  batchQuote: vi.fn(),
  BUYLIST_QUOTE_BATCH_MAX: 50,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

import { MasterSetBinder } from './MasterSetBinder';
import { batchQuote, getMasterSetBinder, searchBuylistCards } from '@/lib/api';

const set: MasterSetSummaryDTO = {
  setId: 'bmk1',
  name: 'BMK Set',
  logoUrl: null,
  ptcgoCode: 'BMK',
  catalogCardCount: 6,
  distinctCardsOwned: 0,
  completionPct: 0,
  totalPieces: 0,
  catalogVariantCount: 6,
  distinctVariantsOwned: 0,
  variantCompletionPct: 0,
};

function card(id: string, name: string, number: string, extra: Partial<CardDTO> = {}): CardDTO {
  return {
    id,
    externalId: id,
    name,
    number,
    rarity: 'Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 'bmk1',
    setName: 'BMK Set',
    setPtcgoCode: 'BMK',
    imageSmallUrl: '',
    imageLargeUrl: '',
    availableFinishes: ['normal'],
    displayFinishes: ['normal'],
    ...extra,
  };
}

type Ref = { status: 'priced' | 'pending'; priceMxnCents?: number };
type Q = { status: 'cotizada' | 'precio_pendiente'; cents: number | null; ref: Ref };

/** Cotización por (cardId, finish, productId?). */
const QUOTES: Record<string, Q> = {
  // BMK-F1: el ejemplo del dueño — mercado MX$1,000.00, te pagamos MX$500.00.
  'c-alpha:normal:': { status: 'cotizada', cents: 50_000, ref: { status: 'priced', priceMxnCents: 100_000 } },
  // BMK-F2: precio pendiente con mercado `priced` (servidor sin BMK.2).
  'c-beta:normal:': { status: 'precio_pendiente', cents: null, ref: { status: 'priced', priceMxnCents: 77_700 } },
  // BMK-F3: cotizada sin mercado.
  'c-gamma:normal:': { status: 'cotizada', cents: 30_000, ref: { status: 'pending' } },
  // BMK-F3: cotizada con mercado 0.
  'c-delta:normal:': { status: 'cotizada', cents: 8_000, ref: { status: 'priced', priceMxnCents: 0 } },
  // BMK-UX-1 / §BMK.6: pagamos más que el mercado.
  'c-eps:normal:': { status: 'cotizada', cents: 100, ref: { status: 'priced', priceMxnCents: 50 } },
  // BMK-F4: carta base de Zeta y su producto aparte (cotización 80 000; catálogo 99 999).
  'c-zeta:normal:': { status: 'cotizada', cents: 1_000, ref: { status: 'priced', priceMxnCents: 2_000 } },
  'c-zeta:holofoil:777': { status: 'cotizada', cents: 40_000, ref: { status: 'priced', priceMxnCents: 80_000 } },
  // Producto aparte en precio pendiente con mercado `priced` (servidor viejo).
  'c-zeta:holofoil:778': { status: 'precio_pendiente', cents: null, ref: { status: 'priced', priceMxnCents: 66_600 } },
};

const CARDS: CardDTO[] = [
  card('c-alpha', 'Alpha', '1'),
  card('c-beta', 'Beta', '2'),
  card('c-gamma', 'Gamma', '3'),
  card('c-delta', 'Delta', '4'),
  card('c-eps', 'Epsilon', '5'),
  card('c-zeta', 'Zeta', '6', {
    separateProducts: [
      {
        productId: 777,
        kind: 'deck_exclusive',
        name: 'Zeta DX',
        finishes: ['holofoil'],
        prices: [{ finish: 'holofoil', marketReferenceMxnCents: 99_999 }],
      },
      {
        productId: 778,
        kind: 'promo',
        name: 'Zeta Promo',
        finishes: ['holofoil'],
        prices: [{ finish: 'holofoil', marketReferenceMxnCents: 55_500 }],
      },
    ],
  }),
];

function batchResult(item: BuylistQuoteItemDTO, index: number): BuylistBatchQuoteResultDTO {
  const q = QUOTES[`${item.cardId}:${item.finish}:${item.productId ?? ''}`];
  if (!q) throw new Error(`sin cotización de prueba para ${JSON.stringify(item)}`);
  return {
    index,
    cardId: item.cardId,
    ok: true,
    rarity: 'Rare',
    finish: item.finish as Finish,
    ...(item.productId != null ? { productId: item.productId } : {}),
    priceBasis: q.status === 'cotizada' ? 'market' : 'pending',
    quote: { status: q.status, quotedPriceCents: q.cents, currency: 'MXN' },
    referencePrice: q.ref,
    paymentNotice: 'PAY_AFTER_RECEIPT',
  };
}

beforeEach(() => {
  vi.mocked(searchBuylistCards).mockReset();
  vi.mocked(batchQuote).mockReset();
  vi.mocked(searchBuylistCards).mockResolvedValue({
    data: CARDS,
    total: CARDS.length,
    page: 1,
    pageSize: 50,
  } as Awaited<ReturnType<typeof searchBuylistCards>>);
  vi.mocked(batchQuote).mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
    results: items.map((it, i) => batchResult(it, i)),
  }));
});

function renderQuoter(locale: 'es' | 'en' = 'es') {
  return renderWithProviders(
    <MasterSetBinder
      mode="quoter"
      set={set}
      onBack={() => {}}
      onOpenCell={() => {}}
      onAddVariant={() => {}}
      onAddProduct={() => {}}
    />,
    locale,
  );
}

async function tileOf(addNamePrefix: RegExp): Promise<HTMLElement> {
  const btn = await screen.findByRole('button', { name: addNamePrefix });
  const li = btn.closest('li');
  if (!li) throw new Error('la teja no está en un <li>');
  return li as HTMLElement;
}

const MARKET_ES = 'Valor de mercado';
const WEPAY_ES = 'Te pagamos';

describe('§BMK · teja del cotizador (QuoterTile)', () => {
  it('BMK-F1: cotizada 50 000 + priced 100 000 ⇒ los dos rótulos y las dos cifras', async () => {
    renderQuoter();
    const tile = await tileOf(/^Agregar Alpha \(Normal\) a la venta/);
    expect(tile).toHaveTextContent('Valor de mercado');
    expect(tile).toHaveTextContent('Te pagamos');
    expect(tile).toHaveTextContent('MX$1,000.00');
    expect(tile).toHaveTextContent('MX$500.00');
  });

  it('BMK-F1: la ventana de detalle pinta las mismas dos filas', async () => {
    renderQuoter();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Alpha (Normal)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Alpha' });
    expect(within(dialog).getByText('Valor de mercado')).toBeInTheDocument();
    expect(within(dialog).getByText('MX$1,000.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Te pagamos')).toBeInTheDocument();
    expect(within(dialog).getByText('MX$500.00')).toBeInTheDocument();
    // La fila «Estimado» se renombró en pantalla (§BMK.3 del diseño).
    expect(within(dialog).queryByText('Estimado')).toBeNull();
  });

  it('BMK-F2: precio_pendiente con mercado priced ⇒ ni rótulo ni cifra de mercado (teja, aria y ventana)', async () => {
    renderQuoter();
    const tile = await tileOf(/^Agregar Beta \(Normal\) a la venta/);
    expect(tile).not.toHaveTextContent('Valor de mercado');
    expect(tile).not.toHaveTextContent('MX$777.00');
    expect(tile).toHaveTextContent('Precio pendiente');
    const add = within(tile).getByRole('button', { name: /^Agregar Beta/ });
    expect(add.getAttribute('aria-label')).not.toContain('MX$777.00');
    expect(add.getAttribute('aria-label')).not.toContain('Valor de mercado');
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Beta (Normal)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Beta' });
    expect(within(dialog).queryByText('Valor de mercado')).toBeNull();
    expect(within(dialog).queryByText('MX$777.00')).toBeNull();
  });

  it('BMK-F3: cotizada con referencePrice pending ⇒ solo «Te pagamos», sin «MX$0.00» ni «—»', async () => {
    renderQuoter();
    const tile = await tileOf(/^Agregar Gamma \(Normal\) a la venta/);
    expect(tile).not.toHaveTextContent('Valor de mercado');
    expect(tile).toHaveTextContent('Te pagamos');
    expect(tile).toHaveTextContent('MX$300.00');
    expect(tile).not.toHaveTextContent('MX$0.00');
    expect(tile).not.toHaveTextContent('—');
  });

  it('BMK-F3: cotizada con priced 0 ⇒ igual: sin par de mercado', async () => {
    renderQuoter();
    const tile = await tileOf(/^Agregar Delta \(Normal\) a la venta/);
    expect(tile).not.toHaveTextContent('Valor de mercado');
    expect(tile).toHaveTextContent('MX$80.00');
    expect(tile).not.toHaveTextContent('MX$0.00');
    expect(tile).not.toHaveTextContent('—');
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Delta (Normal)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delta' });
    expect(within(dialog).queryByText('Valor de mercado')).toBeNull();
    expect(within(dialog).queryByText('MX$0.00')).toBeNull();
  });

  it('BMK-F8: el aria-label de «Agregar» lleva los dos rótulos y las dos cifras cuando el mercado es visible', async () => {
    renderQuoter();
    const add = await screen.findByRole('button', { name: /^Agregar Alpha \(Normal\) a la venta/ });
    expect(add).toHaveAttribute(
      'aria-label',
      'Agregar Alpha (Normal) a la venta · Valor de mercado MX$1,000.00 · Te pagamos MX$500.00',
    );
    // Sin mercado: solo la cifra a pagar, rotulada.
    const gamma = screen.getByRole('button', { name: /^Agregar Gamma \(Normal\) a la venta/ });
    expect(gamma).toHaveAttribute('aria-label', 'Agregar Gamma (Normal) a la venta · Te pagamos MX$300.00');
  });

  it('BMK-UX-1: mismas clases en el par de mercado y de pago gane quien gane; nunca line-through', async () => {
    renderQuoter();
    const alpha = await tileOf(/^Agregar Alpha \(Normal\) a la venta/);
    const eps = await tileOf(/^Agregar Epsilon \(Normal\) a la venta/);
    const ddOf = (tile: HTMLElement) => Array.from(tile.querySelectorAll('dd'));
    const [aMarket, aPay] = ddOf(alpha);
    const [eMarket, ePay] = ddOf(eps);
    expect(aMarket).toHaveTextContent('MX$1,000.00');
    expect(eMarket).toHaveTextContent('MX$0.50');
    expect(ePay).toHaveTextContent('MX$1.00');
    expect(aMarket.className).toBe(eMarket.className);
    expect(aPay.className).toBe(ePay.className);
    for (const el of [...ddOf(alpha), ...ddOf(eps), ...Array.from(alpha.querySelectorAll('dt'))]) {
      expect(el.className).not.toMatch(/line-through/);
    }
  });

  it('BMK-UX-2: el dd de mercado precede al de «Te pagamos» en el DOM, y el rótulo de cada uno es un dt', async () => {
    renderQuoter();
    const tile = await tileOf(/^Agregar Alpha \(Normal\) a la venta/);
    const dl = tile.querySelector('dl');
    expect(dl).not.toBeNull();
    const kids = Array.from(dl!.querySelectorAll('dt, dd')).map((n) => `${n.tagName}:${n.textContent}`);
    expect(kids).toEqual([
      `DT:${MARKET_ES}`,
      'DD:MX$1,000.00',
      `DT:${WEPAY_ES}`,
      'DD:MX$500.00',
    ]);
  });

  it('BMK-UX-6: la nota «Te pagamos…» se pinta UNA vez en el cotizador', async () => {
    renderQuoter();
    await tileOf(/^Agregar Alpha \(Normal\) a la venta/);
    const note = (es.masterSet as Record<string, unknown>).quoterPriceNote as string;
    expect(typeof note).toBe('string');
    expect(screen.getAllByText(note)).toHaveLength(1);
  });
});

describe('§BMK · teja de producto aparte en modo cotizador (SeparateProductTile)', () => {
  it('BMK-F4: pinta y anuncia el mercado de la cotización (80 000), nunca el del catálogo (99 999)', async () => {
    renderQuoter();
    const add = await screen.findByRole('button', { name: /^Agregar Zeta DX \(Deck Exclusive, Holofoil\) a la venta/ });
    const tile = add.closest('li') as HTMLElement;
    expect(tile).toHaveTextContent('Valor de mercado');
    expect(tile).toHaveTextContent('MX$800.00');
    expect(tile).toHaveTextContent('MX$400.00');
    expect(tile.innerHTML).not.toContain('999.99');
    expect(add).toHaveAttribute(
      'aria-label',
      'Agregar Zeta DX (Deck Exclusive, Holofoil) a la venta · Valor de mercado MX$800.00 · Te pagamos MX$400.00',
    );
    // El contenedor de la teja deja de anunciar el precio del catálogo (§BMK.4, desviación (f)2).
    const container = tile.querySelector('[aria-label^="Zeta DX"]');
    expect(container).not.toBeNull();
    expect(container!.getAttribute('aria-label')).toBe(
      'Zeta DX (Deck Exclusive, Holofoil) · Valor de mercado MX$800.00 · Te pagamos MX$400.00',
    );
    // Ningún aria de la página anuncia 99 999.
    for (const el of Array.from(document.querySelectorAll('[aria-label]'))) {
      expect(el.getAttribute('aria-label')).not.toContain('MX$999.99');
    }
  });

  it('BMK-F2 (producto aparte): precio pendiente con mercado priced ⇒ sin mercado, y el contenedor tampoco anuncia el catálogo', async () => {
    renderQuoter();
    const add = await screen.findByRole('button', { name: /^Agregar Zeta Promo \(Promo, Holofoil\) a la venta/ });
    const tile = add.closest('li') as HTMLElement;
    expect(tile).not.toHaveTextContent('Valor de mercado');
    expect(tile).not.toHaveTextContent('MX$666.00');
    expect(tile).not.toHaveTextContent('MX$555.00');
    const container = tile.querySelector('[aria-label^="Zeta Promo"]');
    expect(container!.getAttribute('aria-label')).toBe('Zeta Promo (Promo, Holofoil) · Precio pendiente');
  });
});

describe('§BMK · BMK-F7: sin porcentajes, proporciones ni «ahorro» en el cotizador (es y en)', () => {
  it.each(['es', 'en'] as const)('%s', async (locale) => {
    const { container } = renderQuoter(locale);
    await screen.findByRole('button', {
      name: locale === 'es' ? /^Agregar Alpha \(Normal\) a la venta/ : /^Add Alpha \(Normal\) to the sale/,
    });
    const text = container.textContent ?? '';
    const arias = Array.from(container.querySelectorAll('[aria-label]'))
      .map((n) => n.getAttribute('aria-label'))
      .join(' ');
    for (const blob of [text, arias]) {
      expect(blob).not.toMatch(/%|mitad|half|ahorr|save/i);
    }
    // y el mercado sí está (no es un verde por ausencia).
    expect(text).toContain(locale === 'es' ? 'Valor de mercado' : 'Market value');
  });
});

describe('§BMK · los modos de inventario NO cambian', () => {
  it('BMK-UX-6 (canario): la nota del cotizador se pinta CERO veces en el binder de plataforma, y el producto aparte sigue anunciando su mercado de catálogo', async () => {
    const response: MasterSetBinderResponse = {
      set: { id: 'bmk1', name: 'BMK Set', ptcgoCode: 'BMK' },
      printedTotal: 1,
      catalogCardCount: 1,
      cells: [
        {
          cardId: 'c-zeta',
          number: '6',
          name: 'Zeta',
          rarity: 'Rare',
          imageSmallUrl: '',
          availableFinishes: ['normal'],
          displayFinishes: ['normal'],
          countsByFinish: [],
          totalCount: 0,
          isSecretRare: false,
          expectedVariantCount: 1,
          coveredVariantCount: 0,
          variants: [{ finish: 'normal', count: 0, covered: false }],
          separateProducts: CARDS[5].separateProducts,
        },
      ],
      scope: 'platform',
    };
    vi.mocked(getMasterSetBinder).mockResolvedValue(response);
    renderWithProviders(<MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />);
    await screen.findAllByText('Zeta DX');
    const note = (es.masterSet as Record<string, unknown>).quoterPriceNote as string;
    expect(typeof note).toBe('string');
    expect(screen.queryAllByText(note)).toHaveLength(0);
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(document.querySelector('[aria-label="Zeta DX (Deck Exclusive, Holofoil) · MX$999.99"]')).not.toBeNull();
  });
});

