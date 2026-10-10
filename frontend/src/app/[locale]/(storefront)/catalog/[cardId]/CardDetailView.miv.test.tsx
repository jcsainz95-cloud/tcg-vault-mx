import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { CardDetailView } from './CardDetailView';
import * as api from '@/lib/api';
import type { CardDTO, GroupedListingDTO, ListingDTO } from '@/types/contract';

/**
 * §MIV (v1.90⟨miv⟩) · ficha de carta — el mercado se pinta CON IVA y con su rótulo de IVA.
 *
 * Norma: `API_CONTRACT §MIV.2` (regla de pantalla) + `DESIGN_SYSTEM §MIV.2/.5/.8`. Cifras del dueño
 * (`HECHOS.md:160`, fila 2026-10-10 «Tienda: el VALOR DE MERCADO se muestra CON IVA…»): mercado
 * MX$1,000 → MX$1,160 junto a su precio MX$1,334.
 *
 * Las cifras con IVA las INYECTA el test como si las mandara el servidor: ⛔ la pantalla no calcula.
 *
 * - MIV-F1: market + `referenceDisplayCents` ⇒ «MX$1,160.00», el rótulo y «MX$1,334.00»; ⛔ «MX$1,000.00».
 * - MIV-F2: market SIN `referenceDisplayCents` ⇒ ni rótulo de mercado, ni nota, ni «—», ni neto; la
 *   celda de precio ocupa la fila.
 * - MIV-F3: override CON `referenceDisplayCents` (servidor erróneo) ⇒ sin bloque ni nota.
 * - MIV-F8 / MIV-UX-2 (vMIV-2): el grupo accesible «Valor de mercado MX$1,160.00 incluye IVA» (es) /
 *   «Market value MX$1,160.00 VAT included» (en) — el rótulo del mercado NO lleva tasa.
 * - MIV-UX-1 (vMIV-2): el rótulo del PRECIO sigue «IVA 16 % incluido» y el del MERCADO dice «incluye IVA»
 *   (textos DISTINTOS); orden del DOM rótulo → cifra → IVA → fecha; el de mercado sin ninguna cifra de tasa.
 * - MIV-UX-6: sin `referenceDisplayCents`, ningún `iva-label` fuera de la celda de precio.
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
  id: 'c-miv',
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

const NET = 100000; // MX$1,000.00 de mercado guardado (neto)
const WITH_IVA = 116000; // lo que manda el servidor: MX$1,160.00
const PRICE = 133400; // MX$1,334.00

const refValue: ListingDTO['referenceValue'] = {
  status: 'priced',
  referenceMxnCents: NET,
  source: 'pokemontcg_io',
  capturedDate: '2026-10-09',
};

function unit(over: Partial<ListingDTO> = {}): ListingDTO {
  return {
    inventoryItemId: 'inv-a',
    card,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    referenceValue: refValue,
    displayPriceCents: PRICE,
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
    displayPriceCents: PRICE,
    ivaIncluded: true,
    ivaRatePct: 16,
    priceBasis: 'market',
    referenceValue: refValue,
    referenceDisplayCents: WITH_IVA,
    currency: 'MXN',
    ...over,
  };
}

function mockDetail(listing: GroupedListingDTO, u: ListingDTO = unit()) {
  vi.spyOn(api, 'getCardDetail').mockResolvedValue({ card, listings: [listing], units: [u] });
}

/** Las celdas de la retícula de hechos de precio (misma consulta que la suite de §21.8). */
const cells = () => Array.from(document.querySelectorAll('div.border-b.border-border.py-6')) as HTMLElement[];

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('MIV-F1 · ficha de carta con mercado: la cifra es la CON IVA del servidor', () => {
  it('raw: «MX$1,160.00» + rótulo «IVA 16 % incluido» junto a «MX$1,334.00»; ⛔ el neto «MX$1,000.00»', async () => {
    mockDetail(grp());
    const { container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');

    expect(await screen.findByText('Valor de mercado')).toBeInTheDocument();
    expect(screen.getByText('MX$1,160.00')).toBeInTheDocument();
    // El precio sale en la celda y en el renglón de la pieza.
    expect(screen.getAllByText('MX$1,334.00').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('MX$1,000.00');
    // La fecha de captura se sigue viendo (criterio 860).
    expect(screen.getByText(/9 oct/i)).toBeInTheDocument();
  });

  it('gradeada: igual que raw (criterio 860)', async () => {
    mockDetail(
      grp({ productType: 'graded', rawCondition: undefined, gradingCompany: 'PSA', gradeValue: '9', gradeKey: 'graded:PSA:9' }),
      unit({ productType: 'graded', rawCondition: undefined, gradingCompany: 'PSA', gradeValue: '9' }),
    );
    const { container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    expect(await screen.findByText('MX$1,160.00')).toBeInTheDocument();
    expect(container.textContent).not.toContain('MX$1,000.00');
  });
});

describe('MIV-F2 · market SIN `referenceDisplayCents` (servidor sin §MIV): ⛔ nunca se cae al neto', () => {
  it('ni rótulo de mercado, ni nota, ni «—», ni el neto; la celda de precio ocupa la fila', async () => {
    const { referenceDisplayCents: _drop, ...noDisplay } = grp();
    mockDetail(noDisplay as GroupedListingDTO);
    const { container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');

    expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.textContent).not.toContain('MX$1,000.00');
    expect(screen.queryByText('—')).toBeNull();
    // El rótulo de IVA solo aparece en la celda de precio (MIV-UX-6).
    expect(screen.queryAllByTestId('iva-label')).toHaveLength(0);
    expect(screen.getAllByText('IVA 16 % incluido')).toHaveLength(1);
    expect(cells()[0].className).toContain('sm:col-span-2');
    // La nota al pie va con el bloque: sin bloque, la variante sin mercado.
    expect(screen.getByText('El precio de venta es el precio publicado de esta carta.')).toBeInTheDocument();
  });

  it('`referenceDisplayCents` 0 o no entero tampoco pinta el bloque (regla: entero > 0)', async () => {
    for (const bad of [0, 1160.5, -5]) {
      vi.restoreAllMocks();
      mockDetail(grp({ referenceDisplayCents: bad }));
      const { unmount } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
      expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
      expect(screen.queryByText('Valor de mercado'), `referenceDisplayCents=${bad}`).toBeNull();
      unmount();
    }
  });
});

describe('MIV-F3 · basis no-market con `referenceDisplayCents` presente (servidor erróneo)', () => {
  it('override: sin bloque ni nota; la cifra no aparece en ninguna parte', async () => {
    mockDetail(grp({ priceBasis: 'override' }), unit({ priceBasis: 'override' }));
    const { container } = renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');

    expect(await screen.findByText('Precio de venta')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    expect(container.innerHTML).not.toContain('MX$1,160.00');
    expect(screen.getAllByText('IVA 16 % incluido')).toHaveLength(1);
  });
});

describe('MIV-F8 / MIV-UX-2 (vMIV-2) · el lector de pantalla lee la cifra CON su rótulo de mercado (criterio 863)', () => {
  it('es: grupo «Valor de mercado MX$1,160.00 incluye IVA»', async () => {
    mockDetail(grp());
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    const group = await screen.findByRole('group', { name: 'Valor de mercado MX$1,160.00 incluye IVA' });
    // El rótulo es texto VISIBLE del DOM: ni aria-hidden ni title.
    const label = within(group).getByTestId('iva-label');
    expect(label).toHaveTextContent('incluye IVA');
    expect(label.closest('[aria-hidden="true"]')).toBeNull();
    expect(label.getAttribute('title')).toBeNull();
    // ⛔ ningún aria-label con una cadena aparte: el nombre sale de los nodos visibles.
    expect(group.getAttribute('aria-label')).toBeNull();
  });

  it('en: grupo «Market value MX$1,160.00 VAT included» (la cifra es la misma)', async () => {
    mockDetail(grp());
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'en');
    expect(
      await screen.findByRole('group', { name: 'Market value MX$1,160.00 VAT included' }),
    ).toBeInTheDocument();
  });

  it('MIV-UX-3 (vMIV-2): el rótulo del mercado NO lleva la tasa, sea cual sea `ivaRatePct`', async () => {
    mockDetail(grp({ ivaRatePct: 8, referenceDisplayCents: 108000 }), unit({ ivaRatePct: 8 }));
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    // El nombre accesible NO depende del dial: «incluye IVA», nunca «IVA 8 %».
    const group = await screen.findByRole('group', { name: 'Valor de mercado MX$1,080.00 incluye IVA' });
    expect(within(group).getByTestId('iva-label').textContent).not.toMatch(/8 %|16 %/);
  });
});

describe('MIV-UX-1 (vMIV-2) · el precio sigue con tasa y el mercado dice «incluye IVA» (textos DISTINTOS), en orden cifra → IVA → fecha', () => {
  it('precio «IVA 16 % incluido»; mercado «incluye IVA» sin tasa; orden rótulo → cifra → IVA → fecha', async () => {
    mockDetail(grp());
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    const group = await screen.findByRole('group', { name: /^Valor de mercado/ });

    // El PRECIO conserva su tasa (celda de venta): exactamente una vez, y NO dentro del grupo de mercado.
    expect(screen.getAllByText('IVA 16 % incluido')).toHaveLength(1);
    expect(group.textContent ?? '').not.toMatch(/IVA 16 % incluido/);

    // El MERCADO dice «incluye IVA», vía el rótulo compartido (no texto a mano).
    const label = within(group).getByTestId('iva-label');
    expect(label).toHaveTextContent('incluye IVA');
    // ⛔ MIV-UX-3: el rótulo de mercado no contiene ninguna cifra de tasa.
    expect(label.textContent).not.toMatch(/%|16|8/);

    const text = group.textContent ?? '';
    const iLabel = text.indexOf('Valor de mercado');
    const iFig = text.indexOf('MX$1,160.00');
    const iIva = text.indexOf('incluye IVA');
    const iDate = text.search(/9 oct/i);
    expect(iLabel).toBeGreaterThanOrEqual(0);
    expect(iLabel).toBeLessThan(iFig);
    expect(iFig).toBeLessThan(iIva);
    expect(iIva).toBeLessThan(iDate);
  });
});
