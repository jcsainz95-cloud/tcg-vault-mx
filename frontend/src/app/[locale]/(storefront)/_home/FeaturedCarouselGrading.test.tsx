import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { expectNoMicroNotice, expectVisibleMicroNotice, sightedText } from '@/test/grading';
import * as api from '@/lib/api';
import type { CardDTO, GradedEstimateDTO, GroupedListingSummaryDTO } from '@/types/contract';
import { FeaturedCarousel } from './FeaturedCarousel';
import { GradingFootnoteBoundary } from '../_shared/grading/GradingFootnote';
import HomePage from '../page';

/**
 * **§22.6b — el carrusel «Piezas destacadas» como CUARTA superficie del gancho de grading.**
 *
 * El caso que estos tests protegen por encima de todos los demás es el de §22.6b-g, y es el que
 * mata la feature EN SILENCIO si se omite: la pista ordena por precio descendente y el gate de ROI
 * castiga justo a las caras, así que **«vitrina vacía + una burbuja en el carrusel» es el estado
 * FRECUENTE**, no un borde. Si el home derivara el hospedaje de la nota al pie solo de la vitrina,
 * `fail-closed` (R3.3) apagaría la burbuja del carrusel y **nadie vería un error**: ni excepción, ni
 * hueco, ni log. Solo una feature que no aparece. Por eso el bloque «§22.6b-g» de abajo renderiza el
 * HOME COMPLETO con la vitrina vacía, y no el carrusel aislado.
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

const psa10: GradedEstimateDTO = {
  gradingCompany: 'PSA',
  gradeValue: '10',
  gradeKey: 'graded:PSA:10',
  estimate: { status: 'priced', referenceMxnCents: 2_900_000, capturedDate: '2026-08-22' },
};

function card(id: string, name: string): CardDTO {
  return {
    id,
    externalId: `base1-${id}`,
    name,
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: `https://img.example/${id}-small.png`,
    imageLargeUrl: `https://img.example/${id}-large.png`,
    availableFinishes: ['normal'],
  };
}

function grp(id: string, over: Partial<GroupedListingSummaryDTO> = {}): GroupedListingSummaryDTO {
  return {
    representativeInventoryItemId: `inv-${id}`,
    card: card(`c-${id}`, `Card ${id}`),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    gradeKey: 'raw:NM',
    stockCount: 1,
    salePriceCents: 480_000,
    currency: 'MXN',
    ...over,
  };
}

/** Las ocho piezas más caras; `eligibleAt` marca cuál de ellas trae la burbuja ya gateada. */
function track(eligibleAt: number | null = null): GroupedListingSummaryDTO[] {
  return Array.from({ length: 8 }, (_, i) =>
    grp(String(i), i === eligibleAt ? { gradingHighlight: [psa10] } : {}),
  );
}

function mockCatalog(data: GroupedListingSummaryDTO[]) {
  return vi
    .spyOn(api, 'getCatalog')
    .mockResolvedValue({ data, page: 1, pageSize: data.length, total: data.length });
}

/** Las tejas del carrusel: cada una es un `<a>` que envuelve TODO (§22.6b-h). */
function tilesOf(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/catalog/"]'));
}

/** El bloque del badge dentro de una teja (la regla + cifra + micro-aviso), o `null`. */
function badgeOf(tile: HTMLElement): HTMLElement | null {
  return tile.querySelector<HTMLElement>('div.border-t');
}

const renderTrack = (data: GroupedListingSummaryDTO[], active = true, locale: 'es' | 'en' = 'es') =>
  renderWithProviders(
    <GradingFootnoteBoundary active={active}>
      <FeaturedCarousel />
    </GradingFootnoteBoundary>,
    locale,
  ).container as HTMLElement;

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// ───────────────────────────── (a) teja GRANDE · surface="featuredLead" ─────────────────────────

describe('§22.6b-a · teja GRANDE del carrusel', () => {
  it('la burbuja es el ÚLTIMO elemento de la teja y va A TODO EL ANCHO, no en la columna del precio', async () => {
    mockCatalog(track(0));
    const container = renderTrack(track(0));
    await screen.findByText('Card 0');

    const lead = tilesOf(container)[0];
    const badge = badgeOf(lead)!;
    expect(badge).not.toBeNull();
    // ÚLTIMO elemento de la teja: nada de lo que está encima —arte, nombre, set/#, acabado, precio,
    // stock— se mueve un píxel por su presencia (§22.6b-d).
    expect(lead.lastElementChild).toBe(badge);
    // …y NO cuelga de la columna derecha del precio (estrecha y `text-right`): es hijo directo de la
    // teja, bajo una regla que cruza los 400px.
    expect(badge.parentElement).toBe(lead);
    expect(badge.closest('.lg\\:text-right')).toBeNull();

    // Orden de DOM = orden visual = orden de lectura: precio real → estimado → micro-aviso.
    const text = sightedText(lead);
    expect(text.indexOf('MX$4,800.00')).toBeLessThan(text.indexOf('MX$29,000.00'));
    expect(text.indexOf('MX$29,000.00')).toBeLessThan(text.search(/Ilustrativo/i));
  });

  it('usa la forma LARGA desde `lg` y la corta por debajo (el corte es `lg`, NO `sm`)', async () => {
    mockCatalog(track(0));
    const container = renderTrack(track(0));
    await screen.findByText('Card 0');

    const figure = badgeOf(tilesOf(container)[0])!.querySelector('p')!;
    const [long, short] = Array.from(figure.children) as HTMLElement[];
    expect(long.textContent).toContain('En PSA 10 vale');
    expect(long.className).toBe('hidden lg:inline');
    expect(short.textContent).toContain('PSA 10 ');
    expect(short.textContent).not.toContain('En PSA 10 vale');
    expect(short.className).toBe('lg:hidden');
    // La cifra no crece con la teja: 12px desde `lg`, piso de 11px (§22.4d).
    expect(figure.className).toContain('text-[11px]');
    expect(figure.className).toContain('lg:text-[12px]');
    // Prohibido «PSA 10: MX$…»: dos puntos afirman, `≈` estima.
    expect(figure.textContent).not.toContain('PSA 10:');
  });
});

// ───────────────────────────── (b) tejas CHICAS · surface="featuredRest" ────────────────────────

describe('§22.6b-b · tejas CHICAS del carrusel', () => {
  it('`figureShort` SIEMPRE: la forma larga no existe en el DOM a ningún breakpoint', async () => {
    mockCatalog(track(3));
    const container = renderTrack(track(3));
    await screen.findByText('Card 3');

    const figure = badgeOf(tilesOf(container)[3])!.querySelector('p')!;
    expect(figure.children).toHaveLength(1);
    expect(figure.textContent).toContain('PSA 10 ');
    expect(figure.textContent).not.toContain('En PSA 10 vale');
    // Ni truncada, ni con ellipsis, ni encogida por debajo de 11px.
    expect(figure.className).toContain('text-[11px]');
    expect(figure.className).not.toMatch(/truncate|line-clamp/);
  });

  it('va DESPUÉS del StockBadge, como último elemento de la teja', async () => {
    mockCatalog(track(3));
    const container = renderTrack(track(3));
    await screen.findByText('Card 3');

    const tile = tilesOf(container)[3];
    const badge = badgeOf(tile)!;
    expect(tile.lastElementChild).toBe(badge);
    const text = sightedText(tile);
    expect(text.indexOf('Queda 1')).toBeLessThan(text.indexOf('MX$29,000.00'));
  });

  /** EL BLOQUEANTE DE QA, en las DOS tejas nuevas: el aviso sobrevive a ocultar los `sr-only`. */
  it.each([
    ['GRANDE', 0],
    ['chica', 5],
  ])('R3.1 · el micro-aviso es VISIBLE en la teja %s, con sus dos ideas', async (_anatomy, at) => {
    mockCatalog(track(at));
    const container = renderTrack(track(at));
    await screen.findByText(`Card ${at}`);
    expectVisibleMicroNotice(tilesOf(container)[at], 'es');
  });

  it('EN: la misma burbuja con el copy en inglés (§O.3 bilingüe)', async () => {
    mockCatalog(track(3));
    const container = renderTrack(track(3), true, 'en');
    await screen.findByText('Card 3');
    expectVisibleMicroNotice(tilesOf(container)[3], 'en');
  });
});

// ───────────────────────────── (c) la numeración, condicional POR PISTA ─────────────────────────

describe('§22.6b-c · numeración `01·02·03` condicional por pista (todo o nada)', () => {
  it('sin ninguna burbuja el carrusel es EXACTAMENTE §20.3: las siete chicas numeradas', async () => {
    mockCatalog(track(null));
    const container = renderTrack(track(null));
    await screen.findByText('Card 0');

    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('07')).toBeInTheDocument();
    // Ninguna cifra ⇒ ningún aviso: la ausencia es el estado por defecto de esta superficie.
    // (Se mide sobre las TEJAS: la nota al pie de la boundary sí habla de «ilustrar», por diseño.)
    for (const tile of tilesOf(container)) expectNoMicroNotice(tile, 'es');
    expect(tilesOf(container).every((t) => badgeOf(t) === null)).toBe(true);
  });

  it('con UNA burbuja la numeración desaparece de las OCHO tejas, no solo de la que la lleva', async () => {
    mockCatalog(track(3));
    const container = renderTrack(track(3));
    await screen.findByText('Card 3');

    for (const n of ['01', '02', '03', '04', '05', '06', '07']) {
      expect(screen.queryByText(n)).not.toBeInTheDocument();
    }
    // Y NO se renumera para tapar el hueco, ni se sustituye por otro glifo, ni queda espacio
    // reservado: el nombre de las ocho tejas arranca en el borde izquierdo de su teja.
    const row = tilesOf(container)[1].querySelector('div.flex.items-baseline')!;
    expect(row.children).toHaveLength(1);
    expect(row.textContent).toBe('Card 1');
  });

  it('fail-closed: sin nota al pie NO hay cifra, así que la numeración se QUEDA', async () => {
    mockCatalog(track(3));
    const container = renderTrack(track(3), false);
    await screen.findByText('Card 3');

    // Sin boundary activa el badge devuelve `null` (R3.3) ⇒ no se pinta ninguna cifra…
    expect(tilesOf(container).every((t) => badgeOf(t) === null)).toBe(true);
    expectNoMicroNotice(container, 'es');
    // …y la pista no puede perder los números sin haber ganado la burbuja.
    expect(screen.getByText('03')).toBeInTheDocument();
  });
});

// ───────────────────────────── (d/h/i) el caso disparejo y la accesibilidad ─────────────────────

describe('§22.6b-d/h/i · el caso disparejo NO se compensa y la teja no lleva `aria-label`', () => {
  it('las siete tejas sin cifra quedan EXACTAMENTE como hoy: sin hueco, sin regla, sin min-height', async () => {
    mockCatalog(track(3));
    const container = renderTrack(track(3));
    await screen.findByText('Card 3');

    const tiles = tilesOf(container);
    expect(tiles.filter((t) => badgeOf(t) !== null)).toHaveLength(1);
    for (const t of tiles) {
      // Ni `min-height`, ni espacio reservado, ni skeleton del badge (R4 / §22.6b-i nº5).
      expect(t.className).not.toMatch(/min-h/);
      expect(t.querySelector('[class*="min-h-"]')).toBeNull();
    }
    // Ninguna teja sin cifra dibuja una regla o un guion «para que iguale».
    const empty = tiles.filter((t) => badgeOf(t) === null);
    expect(empty).toHaveLength(7);
    for (const t of empty) {
      expect(sightedText(t)).not.toMatch(/—|--/);
      expectNoMicroNotice(t, 'es');
    }
  });

  it('la pista NO se reordena ni se agrupa por elegibilidad: el orden es el del servidor', async () => {
    mockCatalog(track(6));
    const container = renderTrack(track(6));
    await screen.findByText('Card 6');

    const names = tilesOf(container).map((t) => t.querySelector('p')!.textContent);
    expect(names).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => `Card ${i}`));
  });

  it('PROHIBIDO `aria-label` en el enlace: el aviso forma parte del NOMBRE ACCESIBLE de la teja', async () => {
    mockCatalog(track(0));
    const container = renderTrack(track(0));
    await screen.findByText('Card 0');

    for (const tile of tilesOf(container)) {
      expect(tile.hasAttribute('aria-label')).toBe(false);
      expect(tile.hasAttribute('aria-labelledby')).toBe(false);
    }
    // El nombre accesible del enlace = su contenido, así que incluye cifra y micro-aviso completos.
    const lead = tilesOf(container)[0];
    expect(lead).toHaveAttribute('href', '/catalog/c-0');
    expect(lead.textContent).toMatch(/no evaluamos esta carta/i);
    expect(lead.textContent).toContain('MX$29,000.00');
    // Y la llamada `*` NO es un ancla anidada dentro del ancla de la teja (§22.6b-h).
    expect(badgeOf(lead)!.querySelector('a')).toBeNull();
  });
});

// ───────────────────────────── §22.6b · el `nowrap` vive en el MONTO ────────────────────────────

describe('§22.6b · el `whitespace-nowrap` pasa del párrafo al MONTO', () => {
  it('el párrafo puede envolver; lo indivisible es la cifra (y esto endurece también a Compra)', async () => {
    mockCatalog(track(3));
    const container = renderTrack(track(3));
    await screen.findByText('Card 3');

    const figure = badgeOf(tilesOf(container)[3])!.querySelector('p')!;
    // Con la clase en el `<p>` entero, un importe grande desbordaba la teja EN SILENCIO.
    expect(figure.className).not.toContain('whitespace-nowrap');
    const amount = figure.querySelector('.whitespace-nowrap')!;
    expect(amount.textContent).toBe('MX$29,000.00');
  });
});

// ───────────────────────────── (g) LA TRAMPA: unión vitrina ∪ carrusel ──────────────────────────

/**
 * Aquí se renderiza el **home completo**, no el carrusel aislado, porque el defecto que se persigue
 * vive en la PÁGINA: es la condición con la que el home decide hospedar la nota al pie.
 */
describe('§22.6b-g · el hospedaje de la nota al pie es la UNIÓN de vitrina y carrusel', () => {
  function mockHome({
    gems,
    featured,
  }: {
    gems: GroupedListingSummaryDTO[];
    featured: GroupedListingSummaryDTO[];
  }) {
    vi.spyOn(api, 'getCatalogFacets').mockResolvedValue({
      sets: [],
      rarities: [],
      productTypes: [],
      sealedSubtypes: [],
      finishes: [],
      price: { minCents: 0, maxCents: 0, currency: 'MXN' },
    });
    vi.spyOn(api, 'getSealedGroups').mockResolvedValue({ data: [], page: 1, pageSize: 3, total: 0 });
    vi.spyOn(api, 'getPublicBounties').mockResolvedValue({ data: [] });
    vi.spyOn(api, 'getCatalog').mockImplementation(async (filters = {}) => {
      const data = filters.gradingHighlight
        ? gems
        : filters.productType === 'graded'
          ? []
          : featured;
      return { data, page: 1, pageSize: data.length || 8, total: data.length };
    });
  }

  /**
   * **El caso NORMAL, y el que fallaría en silencio.** Dial encendido, vitrina VACÍA (el gate de ROI
   * no curó nada) y una destacada elegible. Antes, `active` salía solo de la vitrina ⇒ `false` ⇒ el
   * carrusel no pintaba NADA y no había forma de enterarse.
   */
  it('vitrina VACÍA + UNA destacada elegible ⇒ la burbuja SE PINTA y la nota al pie aparece', async () => {
    mockHome({ gems: [], featured: track(3) });
    const { container } = renderWithProviders(<HomePage />, 'es');

    await screen.findByText('Card 3');
    // La vitrina no existe (ni encabezado, ni kicker): es el caso que hace frecuente a este estado.
    expect(screen.queryByText('Joyas para gradear')).not.toBeInTheDocument();

    // …y aun así la cifra del carrusel SE PINTA, con su micro-aviso visible.
    const tile = tilesOf(container as HTMLElement).find((t) => t.textContent?.includes('Card 3'))!;
    expect(sightedText(tile)).toContain('MX$29,000.00');
    expectVisibleMicroNotice(tile, 'es');

    // La página hospeda la nota al pie COMPLETA (R3.3) y el regreso apunta al carrusel, que es la
    // primera superficie que de verdad pintó cifra (§22.4a).
    const note = document.getElementById('nota-estimado')!;
    expect(note).toBeInTheDocument();
    expect(within(note).getByText(/INFORMACIÓN ILUSTRATIVA/)).toBeInTheDocument();
    expect(note.querySelector('a[href="#piezas-destacadas"]')).not.toBeNull();

    // El ancla existe de verdad y lleva su `scroll-mt` para no quedar tapada por el header sticky.
    const target = document.getElementById('piezas-destacadas')!;
    expect(target).toBeInTheDocument();
    expect(target.className).toContain('scroll-mt-[calc(var(--app-header-h,0px)+16px)]');
  });

  it('con vitrina el regreso apunta a la VITRINA, y las dos superficies conviven sin deduplicar', async () => {
    // La MISMA carta sale en las dos superficies: no se filtra ni se condiciona una a la otra.
    const shared = grp('3', { gradingHighlight: [psa10] });
    mockHome({ gems: [shared], featured: track(3) });
    const { container } = renderWithProviders(<HomePage />, 'es');

    await screen.findByText('Joyas para gradear');
    const note = document.getElementById('nota-estimado')!;
    expect(note.querySelector('a[href="#joyas-para-gradear"]')).not.toBeNull();
    // Dos superficies con cifras NO son dos notas (§22.6b-f).
    expect(document.querySelectorAll('#nota-estimado')).toHaveLength(1);
    // La pieza aparece en las dos, con su burbuja en ambas.
    const figures = within(container as HTMLElement).getAllByText(/MX\$29,000\.00/);
    expect(figures.length).toBeGreaterThanOrEqual(2);
  });

  it('sin cifras en NINGUNA de las dos superficies el home no hospeda la nota (ni una huérfana)', async () => {
    mockHome({ gems: [], featured: track(null) });
    const { container } = renderWithProviders(<HomePage />, 'es');

    await screen.findByText('Card 0');
    expect(document.getElementById('nota-estimado')).toBeNull();
    expectNoMicroNotice(container as HTMLElement, 'es');
  });
});
