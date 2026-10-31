import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings, mockGradedEstimateBudget } from '@/lib/mock/fixtures';
import type { GradedEstimateBudgetDTO } from '@/types/contract';
import { FEATURED_PSA_DIAL_KEYS, FeaturedPsaDialsSection } from './FeaturedPsaDialsSection';

/**
 * DYN-F5 (API_CONTRACT §DYN.3, §DYN.4.6, criterios 926 y 301) — M10 edita los SEIS diales nuevos y pinta el presupuesto
 * de créditos PSA con los campos del servidor. Mutaciones que lo ponen rojo: quitar un dial de la lista, mandar el
 * borrador completo en vez de lo tocado, o tragarse el `422` de combinación.
 */
const SIX = [
  'featuredPoolSize',
  'featuredRandomSlots',
  'featuredNewArrivalSlots',
  'featuredNewArrivalWindowDays',
  'featuredRotationHour',
  'gradedEstimateDailyCreditCap',
] as const;

const LABEL: Record<(typeof SIX)[number], RegExp> = {
  featuredPoolSize: /Piezas de más valor entre las que se sortea/,
  featuredRandomSlots: /Lugares al azar/,
  featuredNewArrivalSlots: /Lugares de recién llegadas/,
  featuredNewArrivalWindowDays: /Días que una pieza cuenta como recién llegada/,
  featuredRotationHour: /Hora del cambio diario/,
  gradedEstimateDailyCreditCap: /Tope de créditos PSA al día/,
};

const budget = (over: Partial<GradedEstimateBudgetDTO> = {}): GradedEstimateBudgetDTO => ({
  ...mockGradedEstimateBudget(),
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSettings').mockResolvedValue({
    ...mockSettings,
    featuredPoolSize: 60,
    featuredRandomSlots: 8,
    featuredNewArrivalSlots: 2,
    featuredNewArrivalWindowDays: 7,
    featuredRotationHour: 6,
    gradedEstimateDailyCreditCap: 3000,
  });
  vi.spyOn(api, 'getGradedEstimateBudget').mockResolvedValue(budget());
});

describe('DYN-F5 · «Destacadas y PSA» en M10', () => {
  it('edita los SEIS diales de §DYN.3 con el valor del servidor', async () => {
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    await screen.findByLabelText(LABEL.featuredPoolSize);
    expect(FEATURED_PSA_DIAL_KEYS).toEqual(SIX);
    const expected = { featuredPoolSize: '60', featuredRandomSlots: '8', featuredNewArrivalSlots: '2', featuredNewArrivalWindowDays: '7', featuredRotationHour: '6', gradedEstimateDailyCreditCap: '3000' };
    for (const k of SIX) expect((screen.getByLabelText(LABEL[k]) as HTMLInputElement).value).toBe(expected[k]);
    // Lo dice: no toca la selección de hoy (926).
    expect(screen.getByText(/la selección de hoy no se toca/)).toBeInTheDocument();
  });

  it('PUT parcial: solo las claves tocadas, como número', async () => {
    const spy = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    fireEvent.change(await screen.findByLabelText(LABEL.featuredRandomSlots), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(LABEL.gradedEstimateDailyCreditCap), { target: { value: '1200' } });
    fireEvent.click(screen.getByTestId('m10-featured-psa-save'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0]).toEqual({ featuredRandomSlots: 6, gradedEstimateDailyCreditCap: 1200 });
  });

  it('422 de combinación (`details.rule`): frase de la regla y los dos campos marcados', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { rule: 'featured_slots_total' } }),
    );
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    fireEvent.change(await screen.findByLabelText(LABEL.featuredRandomSlots), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('m10-featured-psa-save'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/deben sumar entre 1 y 20/);
    expect(screen.getByLabelText(LABEL.featuredRandomSlots)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(LABEL.featuredNewArrivalSlots)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(LABEL.featuredPoolSize)).not.toHaveAttribute('aria-invalid');
  });

  it('422 `featured_pool_lt_random`: su propia frase', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { rule: 'featured_pool_lt_random' } }),
    );
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    fireEvent.change(await screen.findByLabelText(LABEL.featuredPoolSize), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('m10-featured-psa-save'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/no pueden ser menos que los lugares al azar/);
    expect(screen.getByLabelText(LABEL.featuredPoolSize)).toHaveAttribute('aria-invalid', 'true');
  });

  it('422 de rango (`details.errors`): marca el campo que nombra el servidor', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { errors: { featuredRotationHour: 'must be in [0, 23]' } } }),
    );
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    fireEvent.change(await screen.findByLabelText(LABEL.featuredRotationHour), { target: { value: '24' } });
    fireEvent.click(screen.getByTestId('m10-featured-psa-save'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Revisa los campos marcados/);
    expect(screen.getByLabelText(LABEL.featuredRotationHour)).toHaveAttribute('aria-invalid', 'true');
  });

  it('servidor anterior sin los diales: la sección no los pinta como si existieran', async () => {
    const { featuredPoolSize: _a, featuredRandomSlots: _b, featuredNewArrivalSlots: _c, featuredNewArrivalWindowDays: _d, featuredRotationHour: _e, gradedEstimateDailyCreditCap: _f, ...old } = mockSettings;
    vi.spyOn(api, 'getSettings').mockResolvedValue(old);
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    expect(await screen.findByText('El servidor todavía no tiene estos ajustes.')).toBeInTheDocument();
    expect(screen.queryByLabelText(LABEL.featuredPoolSize)).not.toBeInTheDocument();
  });
});

describe('DYN-F5 · presupuesto de créditos PSA (§DYN.4.6, criterio 301)', () => {
  it('pinta las cifras del servidor tal cual', async () => {
    vi.spyOn(api, 'getGradedEstimateBudget').mockResolvedValue(
      budget({ dailyCreditCap: 3000, creditsToday: 1240, creditsTodayAllMeasured: false, creditsLast7Days: 9870, providerDailyQuota: null, providerDailyRemaining: 4321, publishedCards: 11200, cardsScannedLast7Days: 10400, cardsUnmapped: 35, weeklyCreditsNeeded: 22400, cycleDays: 8, capToCoverWeek: 3200 }),
    );
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    const panel = await screen.findByTestId('psa-budget');
    await within(panel).findByText('Gastados hoy');
    const row = (label: string) => within(panel).getByText(label).closest('div')!.textContent;
    expect(row('Gastados hoy')).toMatch(/1,240 · incluye estimados/);
    expect(row('Gastados en 7 días')).toMatch(/9,870/);
    expect(row('Cuota diaria del proveedor')).toMatch(/sin fijar/);
    expect(row('Le quedan al proveedor hoy')).toMatch(/4,321/);
    expect(row('Cartas sueltas publicadas')).toMatch(/11,200/);
    expect(row('Sin colección en el proveedor')).toMatch(/35/);
    expect(row('La vuelta completa tarda')).toMatch(/8 días/);
    expect(row('Tope que cubriría la semana')).toMatch(/3,200/);
    // Ciclo > 7 ⇒ el aviso lo dice con las cifras del servidor (no las calcula).
    expect(within(panel).getByRole('status').textContent).toMatch(/tarda 8 días.*3,200/);
  });

  it('tope 0 ⇒ ciclo «nunca» y sin aviso de ciclo', async () => {
    vi.spyOn(api, 'getGradedEstimateBudget').mockResolvedValue(budget({ dailyCreditCap: 0, cycleDays: null }));
    renderWithProviders(<FeaturedPsaDialsSection />, 'es');
    const panel = await screen.findByTestId('psa-budget');
    expect(await within(panel).findByText('nunca (tope en 0)')).toBeInTheDocument();
    expect(within(panel).queryByRole('status')).not.toBeInTheDocument();
  });
});
