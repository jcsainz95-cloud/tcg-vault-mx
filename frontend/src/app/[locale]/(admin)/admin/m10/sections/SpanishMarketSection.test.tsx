import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import es from '../../../../../../../messages/es.json';
import en from '../../../../../../../messages/en.json';
import { SpanishMarketSection, SPANISH_MARKET_DIAL_KEYS } from './SpanishMarketSection';
import type { SettingsDTO } from '@/types/contract';

/**
 * IDS-F7 (API_CONTRACT §IDS.7 y §IDS.9, criterio 517) — el dial `spanishMarketPct` en M10, junto a los de IVA:
 * (1) lee el valor del `GET`; (2) `PUT` parcial con SOLO el entero; (3) entero 1–200 (vacío, 0, 201, 7.5 y texto no
 * viajan); (4) el `422` del servidor se pinta tal cual; (5) oculta para un rol sin permiso de la curva (`super_admin`,
 * IDS-B10); (6) servidor anterior a §IDS ⇒ sin campo. Texto provisional del contrato hasta que ux-ui lo afine.
 */

const role = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: role.isSuperAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: role.isSuperAdmin, canSwitchRole: false }),
}));

const T = es.admin.m10.spanishMarket;

function settings(over: Partial<SettingsDTO> = {}): SettingsDTO {
  return { ...mockSettings, spanishMarketPct: 75, ...over };
}

beforeEach(() => {
  vi.restoreAllMocks();
  role.isSuperAdmin = true;
});

describe('IDS-F7 · dial del español en M10', () => {
  it('título provisional del contrato, el valor del servidor con «%» y la nota de bitácora', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<SpanishMarketSection />, 'es');
    const section = await screen.findByTestId('m10-spanish-market');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Precio del español (% del inglés)');
    const input = (await within(section).findByLabelText(T.label)) as HTMLInputElement;
    expect(input.value).toBe('75');
    expect(input.parentElement!.textContent).toContain('%');
    expect(within(section).getByText(T.audit)).toBeInTheDocument();
    expect(SPANISH_MARKET_DIAL_KEYS).toEqual(['spanishMarketPct']);
  });

  it('`PUT` parcial con SOLO `spanishMarketPct` como entero; guardado ⇒ aviso', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings({ spanishMarketPct: 80 }));
    renderWithProviders(<SpanishMarketSection />, 'es');
    const input = await screen.findByLabelText(T.label);
    expect(screen.getByTestId('m10-spanish-market-save')).toBeDisabled();
    fireEvent.change(input, { target: { value: ' 80 ' } });
    fireEvent.click(screen.getByTestId('m10-spanish-market-save'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toEqual({ spanishMarketPct: 80 });
    expect(await screen.findByText(T.saved)).toBeInTheDocument();
  });

  it.each([
    ['vacío', ''],
    ['cero', '0'],
    ['negativo', '-1'],
    ['fuera de rango', '201'],
    ['no entero', '7.5'],
    ['texto', 'a'],
  ])('%s ⇒ campo inválido, Guardar bloqueado y sin `PUT`', async (_n, value) => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings());
    renderWithProviders(<SpanishMarketSection />, 'es');
    const input = await screen.findByLabelText(T.label);
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(T.invalid)).toBeInTheDocument();
    const save = screen.getByTestId('m10-spanish-market-save');
    expect(save).toBeDisabled();
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 20));
    expect(put).not.toHaveBeenCalled();
  });

  it('los extremos 1 y 200 sí viajan', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(settings());
    renderWithProviders(<SpanishMarketSection />, 'es');
    const input = await screen.findByLabelText(T.label);
    fireEvent.change(input, { target: { value: '200' } });
    expect(input).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByTestId('m10-spanish-market-save'));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ spanishMarketPct: 200 }));
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('m10-spanish-market-save'));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ spanishMarketPct: 1 }));
  });

  it('422 VALIDATION_ERROR ⇒ se pinta el diagnóstico del servidor tal cual', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    vi.spyOn(api, 'updateSettings').mockRejectedValue(
      new ApiClientError(422, {
        code: 'VALIDATION_ERROR',
        message: 'invalid',
        details: { errors: { spanishMarketPct: 'must be an integer in [1, 200] (percent of the English market)' } },
      }),
    );
    renderWithProviders(<SpanishMarketSection />, 'es');
    const input = await screen.findByLabelText(T.label);
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('m10-spanish-market-save'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(T.serverError);
    expect(alert).toHaveTextContent('must be an integer in [1, 200] (percent of the English market)');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('rol sin permiso de la curva (vault_operator) ⇒ la sección no existe y no lee ajustes', async () => {
    role.isSuperAdmin = false;
    const get = vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    const { container } = renderWithProviders(<SpanishMarketSection />, 'es');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('m10-spanish-market')).toBeNull();
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it('servidor anterior a §IDS (sin la clave) ⇒ aviso, sin campo', async () => {
    const old = { ...settings() } as Partial<SettingsDTO>;
    delete old.spanishMarketPct;
    vi.spyOn(api, 'getSettings').mockResolvedValue(old as SettingsDTO);
    renderWithProviders(<SpanishMarketSection />, 'es');
    expect(await screen.findByText(T.unavailable)).toBeInTheDocument();
    expect(screen.queryByLabelText(T.label)).toBeNull();
  });

  it('en inglés: «Spanish price (% of English)»', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue(settings());
    renderWithProviders(<SpanishMarketSection />, 'en');
    const section = await screen.findByTestId('m10-spanish-market');
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(en.admin.m10.spanishMarket.title);
    expect(en.admin.m10.spanishMarket.title).toBe('Spanish price (% of English)');
  });
});
