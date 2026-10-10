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
 * - MIV-F8 / MIV-UX-2: el grupo accesible «Valor de mercado MX$1,160.00 IVA 16 % incluido» (es y en).
 * - MIV-UX-1: dos `iva-label`… o el del precio y el de mercado con el MISMO texto; orden del DOM
 *   rótulo → cifra → IVA → fecha.
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

describe('MIV-F8 / MIV-UX-2 · el lector de pantalla lee la cifra CON su rótulo de IVA (criterio 863)', () => {
  it('es: grupo «Valor de mercado MX$1,160.00 IVA 16 % incluido»', async () => {
    mockDetail(grp());
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    const group = await screen.findByRole('group', { name: 'Valor de mercado MX$1,160.00 IVA 16 % incluido' });
    // El rótulo es texto VISIBLE del DOM: ni aria-hidden ni title.
    const label = within(group).getByTestId('iva-label');
    expect(label).toHaveTextContent('IVA 16 % incluido');
    expect(label.closest('[aria-hidden="true"]')).toBeNull();
    expect(label.getAttribute('title')).toBeNull();
    // ⛔ ningún aria-label con una cadena aparte: el nombre sale de los nodos visibles.
    expect(group.getAttribute('aria-label')).toBeNull();
  });

  it('en: grupo «Market value MX$1,160.00 16 % VAT included» (la cifra es la misma)', async () => {
    mockDetail(grp());
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'en');
    expect(
      await screen.findByRole('group', { name: 'Market value MX$1,160.00 16 % VAT included' }),
    ).toBeInTheDocument();
  });

  it('la tasa es la del DTO (`ivaRatePct`), no un 16 fijo', async () => {
    mockDetail(grp({ ivaRatePct: 8, referenceDisplayCents: 108000 }), unit({ ivaRatePct: 8 }));
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    expect(
      await screen.findByRole('group', { name: 'Valor de mercado MX$1,080.00 IVA 8 % incluido' }),
    ).toBeInTheDocument();
  });
});

describe('MIV-UX-1 · el rótulo del mercado es el MISMO que el del precio, en orden cifra → IVA → fecha', () => {
  it('mismo texto que la celda de precio; orden del DOM rótulo → cifra → IVA → fecha', async () => {
    mockDetail(grp());
    renderWithProviders(<CardDetailView cardId="c-miv" />, 'es');
    const group = await screen.findByRole('group', { name: /^Valor de mercado/ });

    // Las dos celdas dicen exactamente lo mismo (peras con peras).
    expect(screen.getAllByText('IVA 16 % incluido')).toHaveLength(2);

    const text = group.textContent ?? '';
    const iLabel = text.indexOf('Valor de mercado');
    const iFig = text.indexOf('MX$1,160.00');
    const iIva = text.indexOf('IVA 16 % incluido');
    const iDate = text.search(/9 oct/i);
    expect(iLabel).toBeGreaterThanOrEqual(0);
    expect(iLabel).toBeLessThan(iFig);
    expect(iFig).toBeLessThan(iIva);
    expect(iIva).toBeLessThan(iDate);
    // ⛔ «incluye IVA» escrito a mano en vez del rótulo compartido.
    expect(text).not.toMatch(/incluye IVA/i);
  });
});
