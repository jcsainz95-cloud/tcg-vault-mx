import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PromosSummary } from './CatalogSyncSection';
import { blockEstimatesOf, badgeEstimatesOf } from '../../../../(storefront)/_shared/grading/estimates';
import type { GradedEstimateDTO, GroupedListingSummaryDTO } from '@/types/contract';

describe('AUTO · compuerta Black Star, descubrimiento y ligas (solo lectura)', () => {
  it('cerrada: «k de 30», con n/f/expansiones; sin sets ni grupos también se pinta', () => {
    renderWithIntl(
      <PromosSummary
        promos={{
          sets: [], tcgcsv: [],
          gate: { open: false, n: 200, k: 12, f: 0, expansions: 3 },
          discovery: { scanned: 40, eligible: 5, quarantined: 2, ignored: 33 },
          links: { high: 12, low: 80, none: 9, changed: 1 },
        }}
      />,
    );
    expect(screen.getByTestId('promo-gate').textContent).toContain('Black Star ocultas: 12 de 30 aciertos necesarios');
    expect(screen.getByTestId('promo-discovery').textContent).toContain('40 grupos revisados');
    expect(screen.getByTestId('promo-links').textContent).toContain('12 seguras');
  });
  it('abierta: lo dice', () => {
    renderWithIntl(<PromosSummary promos={{ sets: [], tcgcsv: [], gate: { open: true, n: 90, k: 31, f: 0, expansions: 2 } }} />);
    expect(screen.getByTestId('promo-gate').textContent).toContain('compuerta abierta (31 aciertos');
  });
});

describe('PMS-F1 · el resumen de la corrida muestra las promos', () => {
  it('lista omitidas, TCGCSV y skipped_needs_super_admin; sin promos no pinta nada', () => {
    const empty = renderWithIntl(<PromosSummary promos={undefined} />, 'es');
    expect(empty.container.textContent).toBe('');
    empty.unmount();
    renderWithIntl(
      <PromosSummary
        promos={{
          sets: [
            { setId: 'svp', status: 'created' },
            { setId: 'swshp', status: 'unchanged' },
            { setId: 'smp', status: 'missing_remote' },
          ],
          tcgcsv: [{ groupId: 24451, status: 'skipped_needs_super_admin', created: 0, updated: 0 }],
        }}
      />,
    );
    const box = screen.getByTestId('promos-summary');
    expect(box.textContent).toContain('1 nuevas');
    expect(box.textContent).toContain('smp');
    expect(box.textContent).toContain('no existe en pokemontcg.io');
    expect(box.textContent).toContain('Grupo 24451');
    expect(box.textContent).toContain('solo lo importa un súper-admin');
  });
});

const est = (gradeValue: string, finish: GradedEstimateDTO['finish'], cents: number): GradedEstimateDTO => ({
  gradingCompany: 'PSA',
  gradeValue,
  gradeKey: `graded:PSA:${gradeValue}`,
  finish,
  estimate: { status: 'priced', referenceMxnCents: cents, capturedDate: '2026-08-22' },
});

describe('PSA-F1 · el estimado es del acabado elegido', () => {
  const detail = {
    listings: [{ productType: 'raw' }] as never,
    gradedEstimates: [est('10', 'holofoil', 900_000), est('10', 'reverse_holo', 400_000)],
  };
  it('cada acabado ve SOLO su cifra; sin entrada de ese acabado ⇒ null', () => {
    expect(blockEstimatesOf(detail, 'holofoil')?.map((e) => e.estimate.referenceMxnCents)).toEqual([900_000]);
    expect(blockEstimatesOf(detail, 'reverse_holo')?.map((e) => e.estimate.referenceMxnCents)).toEqual([400_000]);
    expect(blockEstimatesOf(detail, 'normal')).toBeNull();
  });
  it('el badge filtra por el acabado del grupo', () => {
    const l = { productType: 'raw', finish: 'normal', gradingHighlight: [est('10', 'holofoil', 900_000)] };
    expect(badgeEstimatesOf(l as unknown as GroupedListingSummaryDTO)).toBeNull();
  });
});
