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
