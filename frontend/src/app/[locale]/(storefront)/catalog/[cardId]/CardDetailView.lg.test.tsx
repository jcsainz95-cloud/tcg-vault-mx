import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CardDetailView } from './CardDetailView';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { CardDTO, GroupedListingDTO, ListingDTO } from '@/types/contract';

/**
 * MKT-CONV.2 (vMKT-CONV-2, L-9 en `e2e/measurement-on.spec.ts`): en lg el renglón de compra sube por encima de la
 * pila de avisos y de la retícula Condición/Acabado (`lg:flex-col` + `lg:order-*`), y el nombre se recorta a tres
 * renglones. En < lg el orden del DOM no cambia. jsdom no maqueta: aquí se fija la MECÁNICA (clases y orden del
 * DOM); la geometría la mide L-9 en el navegador.
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const card: CardDTO = {
  id: 'c-test',
  externalId: 'base1-4',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: ['Stage 2'],
  setId: 'base1',
  setName: 'Base Set',
  setPtcgoCode: null,
  imageSmallUrl: 'https://img.example/s.png',
  imageLargeUrl: 'https://img.example/l.png',
  availableFinishes: ['normal'],
};

const refValue: ListingDTO['referenceValue'] = {
  status: 'priced',
  referenceMxnCents: 128000,
  source: 'pokemontcg_io',
  capturedDate: '2026-08-13',
};

function unit(id: string, over: Partial<ListingDTO> = {}): ListingDTO {
  return {
    inventoryItemId: id,
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    referenceValue: refValue,
    displayPriceCents: 140800,
    ivaIncluded: true,
    ivaRatePct: 16,
    priceBasis: 'market',
    sellable: true,
    ...over,
  };
}

function grp(over: Partial<GroupedListingDTO> = {}): GroupedListingDTO {
  return {
    representativeInventoryItemId: 'inv-a',
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    displayPriceCents: 140800,
    ivaIncluded: true,
    ivaRatePct: 16,
    priceBasis: 'market',
    referenceValue: refValue,
    referenceDisplayCents: 148480,
    currency: 'MXN',
    ...over,
  };
}

function mockDetail(listings: GroupedListingDTO[], units: ListingDTO[]) {
  vi.spyOn(api, 'getCardDetail').mockResolvedValue({ card, listings, units });
  vi.spyOn(api, 'getPublicShippingRule').mockResolvedValue({
    cardsOnlyFeeCents: 10000,
    sealedFeeCents: 20000,
    freeFromCents: 400000,
    currency: 'MXN',
  } as never);
}

/** El hijo DIRECTO de la columna de datos que contiene `el` (es el que lleva el `lg:order-*`). */
function columnChild(el: Element): HTMLElement {
  const column = screen.getByTestId('card-detail-column');
  let node: Element | null = el;
  while (node && node.parentElement !== column) node = node.parentElement;
  if (!node) throw new Error('el elemento no está en la columna de datos');
  return node as HTMLElement;
}

/** `lg:order-N` del hijo de la columna (sin clase ⇒ 0, que en flex lo pondría ARRIBA de todo). */
function lgOrder(el: Element): number {
  const m = columnChild(el).className.match(/(?:^|\s)lg:order-(\d+)(?:\s|$)/);
  return m ? Number(m[1]) : 0;
}

/** El rótulo (eyebrow) de una celda de la retícula; «Condición» también es el nombre de una pestaña. */
const factLabel = (text: string) => screen.getAllByText(text).find((el) => el.classList.contains('eyebrow'))!;

const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  setStoredUser(null);
});

describe('CardDetailView · lg: el renglón de compra antes de la pila y de Condición/Acabado (vMKT-CONV-2)', () => {
  it('la columna es flex-col en lg y CADA hijo lleva su lg:order (ninguno se cuela arriba con order 0)', async () => {
    mockDetail([grp()], [unit('inv-a')]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findAllByTestId('instance-cta');
    await screen.findByTestId('vault-note');

    const column = screen.getByTestId('card-detail-column');
    expect(column.className).toMatch(/(?:^|\s)lg:flex(?:\s|$)/);
    expect(column.className).toContain('lg:flex-col');
    for (const child of Array.from(column.children)) {
      expect(child.className, child.outerHTML.slice(0, 120)).toMatch(/(?:^|\s)lg:order-\d+(?:\s|$)/);
    }
  });

  it('orden visual en lg: h1 → precio → «Ejemplares disponibles» y renglones → franja → pila T1a/T8/T2 → Condición/Acabado → lista', async () => {
    mockDetail([grp()], [unit('inv-a')]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const [cta] = await screen.findAllByTestId('instance-cta');
    const note = await screen.findByTestId('vault-note');

    const h1 = screen.getByRole('heading', { level: 1 });
    const price = factLabel('Precio de venta');
    const h2 = screen.getByRole('heading', { name: 'Ejemplares disponibles' });
    const hint = await screen.findByTestId('shipping-fee-hint');
    const refund = screen.getByTestId('refund-promise-line');
    const condition = factLabel('Condición');
    const finish = factLabel('Acabado');
    const strip = screen.getByTestId('about-strip');

    expect(lgOrder(h1)).toBeLessThan(lgOrder(price));
    expect(lgOrder(price)).toBeLessThan(lgOrder(h2));
    expect(lgOrder(h2)).toBe(lgOrder(cta));
    expect(lgOrder(strip)).toBe(lgOrder(cta));
    for (const pile of [hint, refund, note]) expect(lgOrder(cta)).toBeLessThan(lgOrder(pile));
    expect(lgOrder(note)).toBeLessThan(lgOrder(condition));
    expect(lgOrder(condition)).toBe(lgOrder(finish));
    // El precio y la condición ya no comparten retícula: la de condición puede bajar sola.
    expect(columnChild(price)).not.toBe(columnChild(condition));
  });

  it('< lg: el DOM conserva el orden de antes (pila y retícula ANTES de «Ejemplares disponibles»)', async () => {
    mockDetail([grp()], [unit('inv-a')]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findAllByTestId('instance-cta');
    const note = await screen.findByTestId('vault-note');
    const h2 = screen.getByRole('heading', { name: 'Ejemplares disponibles' });
    expect(follows(factLabel('Precio de venta'), factLabel('Condición'))).toBe(true);
    expect(follows(factLabel('Acabado'), note)).toBe(true);
    expect(follows(note, h2)).toBe(true);
  });

  it('el nombre se recorta a 3 renglones SOLO en lg; el texto y el nombre accesible del h1 siguen completos', async () => {
    mockDetail([grp()], [unit('inv-a')]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    await screen.findAllByTestId('instance-cta');
    const name = screen.getByTestId('card-name');
    expect(name.className.split(/\s+/)).toEqual(expect.arrayContaining(['lg:line-clamp-3', 'lg:pb-1.5', 'lg:-mb-1.5']));
    expect(name.className).not.toMatch(/(?:^|\s)line-clamp-\d/);
    expect(name).toHaveTextContent('Charizard');
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(/^Charizard · Base Set/);
  });

  it('gradeada: el certificado (con botón) va tras la compra en lg MOVIDO EN EL DOM; en < lg, en su sitio de siempre', async () => {
    const g = grp({ productType: 'graded', rawCondition: undefined, gradingCompany: 'PSA', gradeValue: '10', gradeKey: 'graded:PSA:10' });
    mockDetail([g], [unit('inv-a', { productType: 'graded', rawCondition: undefined, gradingCompany: 'PSA', gradeValue: '10', certNumber: '12345678' })]);
    renderWithProviders(<CardDetailView cardId="c-test" />, 'es');
    const [cta] = await screen.findAllByTestId('instance-cta');
    const certs = screen.getAllByTestId('cert-number');
    expect(certs).toHaveLength(2);
    const [small, large] = certs.map(columnChild);
    // La copia de < lg desaparece en lg y viceversa (display:none ⇒ fuera del foco y del árbol accesible).
    expect(small.className).toContain('lg:hidden');
    expect(large.className).toMatch(/(?:^|\s)hidden(?:\s|$)/);
    expect(large.className).toContain('lg:block');
    // < lg: antes de «Ejemplares disponibles», como siempre. lg: DESPUÉS del renglón en el DOM (foco = orden visual).
    expect(follows(small, screen.getByRole('heading', { name: 'Ejemplares disponibles' }))).toBe(true);
    expect(follows(cta, large)).toBe(true);
    expect(lgOrder(large)).toBeGreaterThan(lgOrder(cta));
  });
});
