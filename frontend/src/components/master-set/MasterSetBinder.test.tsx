import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type {
  MasterSetBinderResponse,
  MasterSetCardCellDTO,
  MasterSetSummaryDTO,
} from '@/types/contract';

// El binder consume `@/lib/api`; se mockea el módulo entero y cada test alimenta el DTO del
// endpoint de la vista `platform` (getMasterSetBinder).
vi.mock('@/lib/api', () => ({
  getMasterSetBinder: vi.fn(),
  getAdminVaultMasterSetBinder: vi.fn(),
  getVaultMasterSetBinder: vi.fn(),
  searchBuylistCards: vi.fn(),
  batchQuote: vi.fn(),
  BUYLIST_QUOTE_BATCH_MAX: 50,
}));

import { MasterSetBinder } from './MasterSetBinder';
import { getMasterSetBinder } from '@/lib/api';

// `@/i18n/navigation` (next-intl) no resuelve bajo vitest; se stubea a un <a> que preserva href.
// Lo necesita el enlace del guardarraíl («Ver en la cola de pendientes») de la consola de precios.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));


const set: MasterSetSummaryDTO = {
  setId: 'sv08',
  name: 'Surging Sparks',
  catalogCardCount: 1,
  distinctCardsOwned: 1,
  completionPct: 50,
  totalPieces: 2,
  catalogVariantCount: 2,
  distinctVariantsOwned: 1,
  variantCompletionPct: 50,
};

/**
 * Regresión de display reportada en prod: Spinarak con 2 piezas NORMAL y 0 REVERSE HOLO. El badge
 * on-hand sobre el arte debe reflejar el conteo de CADA acabado (`countsByFinish[finish]`), NO el
 * total de la carta. La celda trae `countsByFinish=[{normal:2}]` (solo acabados con ≥1 pieza, por
 * contrato) y variantes por acabado con su `count`/`covered`.
 */
const spinarakCell: MasterSetCardCellDTO = {
  cardId: 'sv08-064',
  number: '064',
  name: 'Spinarak',
  rarity: 'Common',
  imageSmallUrl: 'https://img.example/spinarak.png',
  availableFinishes: ['normal', 'reverse_holo'],
  displayFinishes: ['normal', 'reverse_holo'],
  countsByFinish: [{ finish: 'normal', count: 2 }],
  totalCount: 2,
  isSecretRare: false,
  expectedVariantCount: 2,
  coveredVariantCount: 1,
  variants: [
    { finish: 'normal', count: 2, covered: true },
    { finish: 'reverse_holo', count: 0, covered: false },
  ],
};

const response: MasterSetBinderResponse = {
  set: { id: 'sv08', name: 'Surging Sparks' },
  printedTotal: 191,
  catalogCardCount: 1,
  cells: [spinarakCell],
  scope: 'platform',
};

function tileFor(finishLabel: string): HTMLElement {
  // Cada teja del binder es un <button> cuyo contenido rotula el acabado (TileHeader).
  const btn = screen
    .getAllByRole('button')
    .find((b) => b.textContent?.includes(finishLabel) && b.getAttribute('aria-haspopup') === 'dialog');
  if (!btn) throw new Error(`No se encontró la teja del acabado ${finishLabel}`);
  return btn;
}

describe('MasterSetBinder · badge on-hand POR ACABADO (regresión IMP-2)', () => {
  beforeEach(() => {
    vi.mocked(getMasterSetBinder).mockReset();
    vi.mocked(getMasterSetBinder).mockResolvedValue(response);
  });

  it('la teja NORMAL (2 piezas) muestra el badge de conteo de ESE acabado', async () => {
    renderWithProviders(
      <MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />,
    );

    await screen.findAllByText('Spinarak'); // espera a que resuelva la query y se pinten las tejas
    const normalTile = tileFor('Normal');
    // Badge on-hand del acabado propio de la teja (título aria = "Tengo 2 piezas de este acabado").
    expect(within(normalTile).getByTitle('Tengo 2 piezas de este acabado')).toBeInTheDocument();
    // No es HUECO: hay cobertura.
    expect(within(normalTile).queryByText('Hueco')).not.toBeInTheDocument();
  });

  it('la teja REVERSE HOLO (0 piezas) se muestra como HUECO, SIN badge de conteo del total de la carta', async () => {
    renderWithProviders(
      <MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />,
    );

    await screen.findAllByText('Spinarak'); // espera a que resuelva la query y se pinten las tejas
    const reverseTile = tileFor('Reverse Holo');
    // HUECO: sin piezas de ESTE acabado.
    expect(within(reverseTile).getByText('Hueco')).toBeInTheDocument();
    // El bug: pintaba el total de la carta (2) también en la teja de 0 piezas. No debe existir NINGÚN
    // badge de conteo (ni "2 piezas" del acabado, ni el aria de on-hand) en la teja REVERSE HOLO.
    expect(within(reverseTile).queryByTitle(/de este acabado$/)).not.toBeInTheDocument();
    expect(within(reverseTile).queryByText('2 piezas')).not.toBeInTheDocument();
  });

  it('el badge de on-hand del acabado NO se repite entre tejas (2 NORMAL no contamina REVERSE HOLO)', async () => {
    renderWithProviders(
      <MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />,
    );

    // Antes de la corrección el badge (suma de la carta = 2) aparecía en AMBAS tejas → 2 coincidencias.
    // Ahora es por acabado: aparece SOLO en la teja NORMAL.
    const badges = await screen.findAllByTitle('Tengo 2 piezas de este acabado');
    expect(badges).toHaveLength(1);
  });
});

/**
 * Consistencia visual del ACENTO por acabado (spec humano 2026-08): la banda de color de cada teja
 * depende SOLO de su acabado — reverse_holo=ROJO, holofoil=AZUL— y NO cambia porque la carta tenga
 * a la vez holofoil y reverse holo. Se prueba sobre una carta con AMBOS acabados (más normal).
 */
describe('MasterSetBinder · banda de acabado estrictamente por finish (independiente de la composición)', () => {
  const multiFinishCell: MasterSetCardCellDTO = {
    cardId: 'sv08-100',
    number: '100',
    name: 'Pikachu ex',
    rarity: 'Double Rare',
    imageSmallUrl: 'https://img.example/pikachu.png',
    availableFinishes: ['normal', 'reverse_holo', 'holofoil'],
    displayFinishes: ['normal', 'reverse_holo', 'holofoil'],
    countsByFinish: [{ finish: 'holofoil', count: 1 }],
    totalCount: 1,
    isSecretRare: false,
    expectedVariantCount: 3,
    coveredVariantCount: 1,
    variants: [
      { finish: 'normal', count: 0, covered: false },
      { finish: 'reverse_holo', count: 0, covered: false },
      { finish: 'holofoil', count: 1, covered: true },
    ],
  };

  const multiResponse: MasterSetBinderResponse = {
    set: { id: 'sv08', name: 'Surging Sparks' },
    printedTotal: 191,
    catalogCardCount: 1,
    cells: [multiFinishCell],
    scope: 'platform',
  };

  beforeEach(() => {
    vi.mocked(getMasterSetBinder).mockReset();
    vi.mocked(getMasterSetBinder).mockResolvedValue(multiResponse);
  });

  function bandIn(tile: HTMLElement): HTMLElement {
    const band = tile.querySelector('[data-testid="finish-band"]');
    if (!(band instanceof HTMLElement)) throw new Error('teja sin banda de acabado');
    return band;
  }

  it('reverse holo pinta ROJO y holofoil pinta AZUL en la MISMA carta (composición mixta)', async () => {
    renderWithProviders(
      <MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />,
    );
    await screen.findAllByText('Pikachu ex');

    // La teja reverse holo lleva el ROJO de acabado; la holofoil, el AZUL — sin importar que la
    // carta tenga AMBOS acabados a la vez.
    const reverseBand = bandIn(tileFor('Reverse Holo'));
    expect(reverseBand.getAttribute('data-finish')).toBe('reverse_holo');
    expect(reverseBand.getAttribute('style')).toContain('var(--color-finish-reverse');
    expect(reverseBand.getAttribute('style')).not.toContain('gradient');

    const holoBand = bandIn(tileFor('Holofoil'));
    expect(holoBand.getAttribute('data-finish')).toBe('holofoil');
    expect(holoBand.getAttribute('style')).toContain('var(--color-finish-holo');
  });

  it('la teja NORMAL no lleva banda (acabado neutro, sin cambio)', async () => {
    renderWithProviders(
      <MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />,
    );
    await screen.findAllByText('Pikachu ex');
    const normalTile = tileFor('Normal');
    expect(normalTile.querySelector('[data-testid="finish-band"]')).toBeNull();
  });
});

/**
 * §21.9c-1 — **bounty rebasado**. Con `enabled && !effective` el bounty no aplica al cotizar y no se
 * publica en la vitrina; si nadie lo dice, el dueño solo ve que su `·B` desapareció. El **texto** es
 * el portador del estado (§2.4): los dos estados comparten el rojo y se distinguen por la palabra;
 * la ausencia del glifo de mira es el refuerzo, no el canal.
 */
describe('MasterSetBinder · badge de bounty rebasado (P-48, §21.9c)', () => {
  function cellWithBounty(effective: boolean): MasterSetCardCellDTO {
    return {
      ...spinarakCell,
      variants: [
        {
          finish: 'normal',
          count: 2,
          covered: true,
          pricing: {
            buy: {
              suggestedCents: 95_000,
              overrideCents: null,
              // Rebasado: se paga la CURVA, no la oferta.
              effectiveCents: effective ? 90_000 : 95_000,
              source: effective ? 'bounty' : 'market',
              premiumAtFloor: false,
            },
            sell: {
              suggestedCents: 169_000,
              overrideCents: null,
              effectiveCents: 169_000,
              source: 'market',
              premiumAtFloor: false,
            },
            bounty: {
              enabled: true,
              priceCents: 90_000,
              targetQty: null,
              acquiredQty: 0,
              completedAt: null,
              effective,
              curveQuoteCents: 95_000,
            },
          },
        },
        { finish: 'reverse_holo', count: 0, covered: false },
      ],
    };
  }

  it('bounty EFECTIVO: badge «Bounty» (con glifo) y el renglón de compra lleva ·B', async () => {
    vi.mocked(getMasterSetBinder).mockResolvedValue({ ...response, cells: [cellWithBounty(true)] });
    renderWithProviders(
      <MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />,
    );
    await screen.findAllByText('Spinarak');
    const tile = tileFor('Normal');
    expect(within(tile).getByText('Bounty')).toBeInTheDocument();
    expect(within(tile).queryByText('Bounty rebasado')).toBeNull();
    expect(within(tile).getByText('·B')).toBeInTheDocument();
  });

  it('bounty REBASADO: badge «Bounty rebasado» sin ·B — la cifra es la de la curva', async () => {
    vi.mocked(getMasterSetBinder).mockResolvedValue({ ...response, cells: [cellWithBounty(false)] });
    renderWithProviders(
      <MasterSetBinder mode="platform" set={set} onBack={() => {}} onOpenCell={() => {}} />,
    );
    await screen.findAllByText('Spinarak');
    const tile = tileFor('Normal');
    expect(within(tile).getByText('Bounty rebasado')).toBeInTheDocument();
    // No se añade un cuarto renglón: el badge ya porta el aviso y la teja se lee de un vistazo.
    expect(within(tile).queryByText('·B')).toBeNull();
    expect(within(tile).getByText('MX$950.00')).toBeInTheDocument();
  });
});
