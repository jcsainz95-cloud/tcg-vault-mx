import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import type { PricingCurveDTO, RarityHealthResponse, SettingsDTO } from '@/types/contract';
import { PremiumFloorSection } from './PremiumFloorSection';

/**
 * 💰 `DESIGN_SYSTEM §39.1` — el dial `premiumFloorSalePublish` (`API_CONTRACT §M2 M2-PF`, v1.80.8.5).
 * Candados PF-UI-1…4 (§39.6 N-13) + los estados que el diseño exige (clave ausente, 422 con diagnóstico).
 */

const SEED = { mode: 'only' as const, rarities: ['Double Rare', 'Rare Holo EX'] };

const RARITIES: RarityHealthResponse = {
  rarities: [
    { canonical: 'Common', raw: 'Common', premium: false, mapped: true, cardCount: 5000 },
    { canonical: 'Illustration Rare', raw: 'Illustration Rare', premium: true, mapped: true, cardCount: 870 },
    { canonical: 'Double Rare', raw: 'Double Rare', premium: true, mapped: true, cardCount: 412 },
    { canonical: 'Special Illustration Rare', raw: 'Special Illustration Rare', premium: true, mapped: true, cardCount: 310 },
    // Premium solo por patrón (sin canónica): de solo lectura, «siempre se retienen».
    { canonical: 'Rare Holo Ex Shiny', raw: 'Rare Holo Ex Shiny', premium: true, mapped: false, cardCount: 3 },
    // ⛔ `Rare Holo EX` NO viene: es una canónica guardada sin cartas en el catálogo.
  ],
};

function serve(settings: Partial<SettingsDTO> = { premiumFloorSalePublish: SEED }, opts: { curveFails?: boolean } = {}) {
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, premiumFloorSalePublish: undefined, ...settings });
  vi.spyOn(api, 'getRarityHealth').mockResolvedValue(RARITIES);
  if (opts.curveFails) {
    vi.spyOn(api, 'getPricingCurve').mockRejectedValue(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }));
  } else {
    vi.spyOn(api, 'getPricingCurve').mockResolvedValue({ version: 1, sale: { floorCents: 2500, points: [], rounding: [] } } as unknown as PricingCurveDTO);
  }
}

const saveButton = () => screen.getByRole('button', { name: /Guardar regla de premium/ });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('§39.1 · premium en el piso (venta)', () => {
  it('pinta el valor guardado: «Publicar solo estas rarezas» con Double Rare marcada y la cifra del piso de la curva', async () => {
    serve();
    renderWithProviders(<PremiumFloorSection />, 'es');
    const only = await screen.findByRole('radio', { name: /Publicar solo estas rarezas/ });
    await waitFor(() => expect(only).toBeChecked());
    expect(screen.getByTestId('premium-floor-rarity-Double Rare')).toBeChecked();
    expect(screen.getByTestId('premium-floor-rarity-Illustration Rare')).not.toBeChecked();
    // El piso sale de la curva, no a fuego.
    await waitFor(() => expect(screen.getAllByText(/MX\$25\.00/).length).toBeGreaterThan(0));
    // ⛔ Una no-premium no es una opción (el validador la rechazaría).
    expect(screen.queryByTestId('premium-floor-rarity-Common')).toBeNull();
    // Sin cambios ⇒ no se guarda.
    expect(saveButton()).toBeDisabled();
  });

  it('PF-UI-1 · con `only` y 0 marcadas: «Guardar» deshabilitado y el error visible', async () => {
    serve();
    renderWithProviders(<PremiumFloorSection />, 'es');
    await waitFor(() => expect(screen.getByTestId('premium-floor-rarity-Double Rare')).toBeChecked());
    fireEvent.click(screen.getByTestId('premium-floor-rarity-Double Rare'));
    fireEvent.click(screen.getByTestId('premium-floor-rarity-Rare Holo EX'));
    expect(screen.getByText('Marca al menos una rareza, o elige «Retener todas».')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('PF-UI-2 · al pasar a `all`, el `PUT` lleva `rarities: []` (y solo esa clave)', async () => {
    serve();
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue({ ...mockSettings, premiumFloorSalePublish: { mode: 'all', rarities: [] } });
    renderWithProviders(<PremiumFloorSection />, 'es');
    await waitFor(() => expect(screen.getByRole('radio', { name: /Publicar solo estas rarezas/ })).toBeChecked());

    fireEvent.click(screen.getByRole('radio', { name: /Publicar todas al piso/ }));
    // La selección se CONSERVA en pantalla (deshabilitada), pero no se envía.
    expect(screen.getByTestId('premium-floor-rarity-Double Rare')).toBeChecked();
    expect(screen.getByTestId('premium-floor-rarity-Double Rare')).toBeDisabled();
    fireEvent.click(saveButton());

    const dialog = await screen.findByRole('dialog', { name: '¿Cambiar la regla de premium en el piso?' });
    expect(dialog).toHaveTextContent('Antes: publicar solo Double Rare y Rare Holo EX');
    expect(dialog).toHaveTextContent('Ahora: publicar todas al piso');
    expect(dialog).toHaveTextContent('saldría a la venta a MX$25.00');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar regla' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({ premiumFloorSalePublish: { mode: 'all', rarities: [] } });
  });

  it('PF-UI-3 · una rareza guardada ausente de `/rarities` se pinta MARCADA con «sin cartas en el catálogo hoy»', async () => {
    serve();
    renderWithProviders(<PremiumFloorSection />, 'es');
    const box = await screen.findByTestId('premium-floor-rarity-Rare Holo EX');
    await waitFor(() => expect(box).toBeChecked());
    expect(box.closest('label')).toHaveTextContent('sin cartas en el catálogo hoy');
  });

  it.each(['only', 'all', 'none'] as const)('PF-UI-4 · el aviso «La rareza manda» está con modo `%s`', async (mode) => {
    serve({ premiumFloorSalePublish: { mode, rarities: mode === 'only' ? ['Double Rare'] : [] } });
    renderWithProviders(<PremiumFloorSection />, 'es');
    const note = await screen.findByTestId('premium-floor-ex-warning');
    expect(note).toHaveAttribute('role', 'note');
    expect(note).toHaveTextContent('La rareza manda, no el nombre');
    expect(note).toHaveTextContent('Charizard ex');
  });

  it('clave ausente en el `GET` ⇒ «este servidor todavía no tiene este ajuste», ⛔ sin el seed marcado', async () => {
    serve({ premiumFloorSalePublish: undefined });
    renderWithProviders(<PremiumFloorSection />, 'es');
    expect(await screen.findByText('Este servidor todavía no tiene este ajuste.')).toBeInTheDocument();
    for (const r of screen.getAllByRole('radio')) {
      expect(r).not.toBeChecked();
      expect(r).toBeDisabled();
    }
    expect(saveButton()).toBeDisabled();
  });

  it('sin curva ⇒ cede la CIFRA, nunca el texto (variantes sin piso)', async () => {
    serve(undefined, { curveFails: true });
    renderWithProviders(<PremiumFloorSection />, 'es');
    await screen.findByRole('radio', { name: /Publicar todas al piso/ });
    await waitFor(() => expect(screen.getByText(/Ojo: una carta cara con un dato de mercado roto también saldría al piso\./)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/\{floor\}|MX\$25/);
  });

  it('`422 VALIDATION_ERROR` ⇒ «Nada cambió» + el diagnóstico `details.errors.premiumFloorSalePublish`', async () => {
    serve();
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, {
        code: 'VALIDATION_ERROR',
        message: 'Invalid settings payload',
        details: { errors: { premiumFloorSalePublish: 'rarity "Foo" is not a premium canonical' } },
      }),
    );
    renderWithProviders(<PremiumFloorSection />, 'es');
    await waitFor(() => expect(screen.getByRole('radio', { name: /Publicar solo estas rarezas/ })).toBeChecked());
    fireEvent.click(screen.getByRole('radio', { name: /Retener todas/ }));
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('desaparecen de la tienda al guardar');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar regla' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se guardó: el servidor rechazó la regla. Nada cambió.');
    expect(alert).toHaveTextContent('rarity "Foo" is not a premium canonical');
  });

  it('EN: paridad (sin claves crudas)', async () => {
    serve();
    renderWithProviders(<PremiumFloorSection />, 'en');
    expect(await screen.findByText('Premium cards at the floor (sale)')).toBeInTheDocument();
    await screen.findByTestId('premium-floor-rarity-Double Rare');
    expect(document.body.textContent).not.toMatch(/admin\.m10\.premiumFloor/);
  });
});
