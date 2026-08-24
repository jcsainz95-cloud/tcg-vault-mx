import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { formatMoneyCents } from '@/lib/format';
import { SealedDetailView } from './SealedDetailView';
import * as api from '@/lib/api';
import { mockSealedGroups } from '@/lib/mock/fixtures';
import type { ListingDTO, SealedGroupDTO, SealedGroupDetailResponse } from '@/types/contract';

// El CTA «Ir al carrito» navega con el router de next-intl; se mockea para espiarlo.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const BOX_MINT = mockSealedGroups[0]; // inv-1008, box, mint, 4 disponibles
const BOX_MINOR = mockSealedGroups[2]; // inv-1020, box, minor_box_damage, 2 disponibles

function listingsOf(group: SealedGroupDTO, ids: string[]): ListingDTO[] {
  return ids.map((id, i) => ({
    inventoryItemId: id,
    card: group.card,
    productType: 'sealed',
    sealedSubtype: group.sealedSubtype ?? undefined,
    sealedCondition: group.sealedCondition,
    finish: 'normal',
    referenceValue: group.referenceValue,
    priceBasis: group.priceBasis,
    salePriceCents: group.fromPriceCents + i * 500,
    sellable: true,
  }));
}

function mockDetail(over: Partial<SealedGroupDetailResponse> & { group: SealedGroupDTO }): void {
  const detail: SealedGroupDetailResponse = {
    group: over.group,
    listings: over.listings ?? listingsOf(over.group, ['inv-a', 'inv-b', 'inv-c', 'inv-d']),
    trendEnabled: over.trendEnabled ?? false,
    restockEnabled: over.restockEnabled ?? false,
  };
  vi.spyOn(api, 'getSealedGroupDetail').mockResolvedValue(detail);
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  window.localStorage.clear();
});

describe('SealedDetailView · condición visible', () => {
  it('producto mint muestra la condición «Como nueva»', async () => {
    mockDetail({ group: BOX_MINT });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText('Como nueva')).toBeInTheDocument();
    expect(screen.getAllByText('Sellado').length).toBeGreaterThan(0);
    expect(screen.queryByText(/detalle menor en la caja/i)).toBeNull();
  });

  it('producto con detalle menor muestra la condición y su nota', async () => {
    mockDetail({ group: BOX_MINOR, listings: listingsOf(BOX_MINOR, ['inv-1020', 'inv-1020-p2']) });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1020" />, 'es');

    expect(await screen.findByText('Detalle menor en caja')).toBeInTheDocument();
    expect(screen.getByText(/detalle menor en la caja/i)).toBeInTheDocument();
  });
});

describe('SealedDetailView · selector de cantidad y carrito', () => {
  it('agrega N piezas (las más baratas) al carrito y ofrece ir al carrito', async () => {
    mockDetail({ group: BOX_MINT });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    // Sube la cantidad a 2 con el botón «Agregar uno».
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar uno' }));

    fireEvent.click(screen.getByRole('button', { name: 'Agregar 2 al carrito' }));

    // Agrega las DOS piezas más baratas (inv-a, inv-b).
    expect(JSON.parse(window.localStorage.getItem('tcg.cart')!).ids).toEqual(['inv-a', 'inv-b']);

    // Con todo lo seleccionado en el carrito, el CTA cambia a «Ir al carrito» y navega a /checkout.
    const goCta = await screen.findByRole('button', { name: 'Ir al carrito' });
    fireEvent.click(goCta);
    expect(push).toHaveBeenCalledWith('/checkout');
  });

  it('muestra la nota de destino recibir/bóveda (checkout)', async () => {
    mockDetail({ group: BOX_MINT });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText(/recibirlo en tu domicilio o dejarlo en tu bóveda/i)).toBeInTheDocument();
  });
});

describe('SealedDetailView · sin stock', () => {
  it('grupo agotado: «Agotado», controles de cantidad deshabilitados y carrito intacto', async () => {
    mockDetail({ group: { ...BOX_MINT, availableCount: 0 }, listings: [] });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText('Agotado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar uno' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quitar uno' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Agregar 1 al carrito' }));
    expect(window.localStorage.getItem('tcg.cart')).toBeNull();
  });
});

/**
 * §21.8 — el mismo mecanismo que la ficha de carta, con DOS hechos. El sellado no cambia de
 * matemática (conserva su spread por presentación, §K): solo obedece el `priceBasis` que el backend
 * DERIVA de `priceSource`.
 */
describe('SealedDetailView · «Valor de mercado» condicional (P-48, §21.8)', () => {
  it('precio derivado por SPREAD (priceBasis="market"): se muestran los dos hechos', async () => {
    mockDetail({ group: BOX_MINT });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');

    expect(await screen.findByText('Valor de mercado')).toBeInTheDocument();
    expect(screen.getByText('MX$3,050.00')).toBeInTheDocument();
  });

  it('la TENDENCIA de valor también obedece `priceBasis`: con override no se pinta', async () => {
    // El objeto de la regla no es una celda: es no publicar el valor de mercado cuando el mercado
    // no fijó el precio. «Tendencia de valor» lo pintaba a 32-40px y lo rotulaba literalmente
    // «valor de mercado de referencia» — hacía lo que la regla prohíbe, 200px más abajo.
    mockDetail({ group: BOX_MINOR, trendEnabled: true });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1020" />, 'es');

    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Tendencia de valor')).toBeNull();
    expect(
      screen.queryByText('Valor de mercado de referencia (TCGCSV), actualizado a diario.'),
    ).toBeNull();
  });

  /**
   * Matiz de QA sobre el assert de la ficha: el de la E2E caza el **rótulo**, no la **cifra**, así
   * que un bloque futuro que republicara el número sin la frase —un eje de gráfica, un tooltip, un
   * `aria-label`— pasaría en verde. Aquí sí se puede afirmar por la CIFRA sin volverse frágil: el
   * test es dueño de su fixture, así que compara contra el mismo valor que inyecta, no contra un
   * monto global que cualquiera puede mover.
   *
   * El caso es además el más exigente: hay mercado CONOCIDO y aun así lo fijó un override (§K:
   * `override manual > mercado × spread`), o sea que la cifra existe y NO debe publicarse.
   */
  it('con override NO se publica la CIFRA del mercado en ninguna parte, ni sin su rótulo', async () => {
    const MARKET_CENTS = 987_654; // valor propio del test: se afirma contra él, no contra fixtures.
    mockDetail({
      group: {
        ...BOX_MINOR,
        priceBasis: 'override',
        referenceValue: {
          status: 'priced',
          referenceMxnCents: MARKET_CENTS,
          source: 'tcgcsv',
          capturedDate: '2026-08-20',
        },
      },
      trendEnabled: true,
    });
    // La serie de tendencia se sirve con ESE mismo mercado como valor actual (es lo que la
    // tendencia pinta a 32-40px). Así el assert MUERDE: si el bloque volviera a renderizarse, la
    // cifra aparecería aunque alguien le quitara la frase «valor de mercado de referencia».
    vi.spyOn(api, 'getSealedValueHistory').mockResolvedValue({
      set: { id: 'sealed:box', name: 'Surging Sparks Booster Box' },
      range: '1m',
      points: [
        { date: '2026-08-19', valueMxnCents: MARKET_CENTS - 1000, pricedCardCount: 1 },
        { date: '2026-08-20', valueMxnCents: MARKET_CENTS, pricedCardCount: 1 },
      ],
      change: { direction: 'up', absMxnCents: 1000, pct: 1.02 },
    });
    const { container } = renderWithProviders(
      <SealedDetailView inventoryItemId="inv-1020" />,
      'es',
    );

    expect(await screen.findByText('Desde')).toBeInTheDocument();
    const formatted = formatMoneyCents(MARKET_CENTS, 'es'); // MX$9,876.54
    // Ni con rótulo ni sin él: la cifra no aparece en el texto…
    expect(container.textContent).not.toContain(formatted);
    // …ni escondida en un atributo accesible o un tooltip.
    expect(container.innerHTML).not.toContain(formatted);
    expect(container.innerHTML).not.toContain(String(MARKET_CENTS));
  });

  it('con precio por SPREAD la tendencia SÍ se pinta (ahí el mercado explica el precio)', async () => {
    mockDetail({ group: BOX_MINT, trendEnabled: true });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1008" />, 'es');
    expect(await screen.findByText('Tendencia de valor')).toBeInTheDocument();
  });

  it('precio por OVERRIDE manual (priceBasis="override"): queda UNA sola celda a fila completa', async () => {
    mockDetail({ group: BOX_MINOR });
    renderWithProviders(<SealedDetailView inventoryItemId="inv-1020" />, 'es');

    expect(await screen.findByText('Desde')).toBeInTheDocument();
    expect(screen.queryByText('Valor de mercado')).toBeNull();
    // No queda hueco: la celda del dinero ocupa la fila completa.
    const cells = Array.from(
      document.querySelectorAll('div.border-b.border-border.py-6'),
    ) as HTMLElement[];
    expect(cells).toHaveLength(1);
    expect(cells[0].className).toContain('sm:col-span-2');
  });
});
