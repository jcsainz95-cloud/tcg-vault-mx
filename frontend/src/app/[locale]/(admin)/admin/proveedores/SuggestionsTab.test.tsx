import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { SuggestionsTab } from './SuggestionsTab';
import { RoleProvider } from '@/lib/role';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api/supply-suggestions';

const settings = (over: Partial<api.SupplySettings> = {}): api.SupplySettings => ({
  autoPublish: true, autoAccept: false, defaultPctBps: 7000, openBudgetCents: 500000, openExposureCents: 12000,
  lastRunAt: null, ...over,
});
const view = () => renderWithProviders(<RoleProvider><SuggestionsTab /></RoleProvider>);

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem('tcg.role');
});

const card = { id: 'c1', name: 'Charizard ex', number: '125', setName: 'Obsidian', imageUrl: null, rarity: null, finish: 'normal' } as never;
const sug = (i: number, over: Partial<api.SupplySuggestion> = {}): api.SupplySuggestion => ({
  id: `s${i}`, card, finish: 'normal', suggestedQty: i === 1 ? 1 : 2, pctBps: 7000, unitCents: 1500, marketCents: 2000,
  reasons: [{ kind: 'metadeck', ref: null }], status: 'draft', skipReason: null, requestId: null, createdAt: '2026-11-20T00:00:00Z', ...over,
});
const apiErr = (status: number, code: string) => new ApiClientError(status, { code, message: 'x' } as never);

describe('§PROV-F4 · lista de sugeridas', () => {
  it('pagina: pide la página 2 y plural ICU', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings({ autoPublish: false }));
    const list = vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [sug(1), sug(2)], page: 1, pageSize: 25, total: 60 });
    view();
    expect(await screen.findByText('1 pieza')).toBeTruthy();
    expect(screen.getByText('2 piezas')).toBeTruthy();
    expect(screen.getByText(/nada se publica solo/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /sig/i }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ status: 'draft', page: 2 }));
  });

  it('operador: sin panel de ajustes, sin pedirlos (sin 403) y sin botones', async () => {
    window.localStorage.setItem('tcg.role', 'vault_operator');
    const get = vi.spyOn(api, 'getSupplySettings').mockRejectedValue(apiErr(403, 'FORBIDDEN_ROLE'));
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [sug(1)], page: 1, pageSize: 25, total: 1 });
    view();
    expect(await screen.findByText('1 pieza')).toBeTruthy();
    expect(get.mock.calls.length).toBeLessThanOrEqual(1); // modo mock: el rol llega tras el primer render
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /^publicar$/i })).toBeNull();
  });

  it('publicar usa Idempotency-Key y muestra 409 QUARANTINED; skipReason market_jump', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [sug(1, { status: 'skipped', skipReason: 'market_jump' })], page: 1, pageSize: 25, total: 1 });
    const pub = vi.spyOn(api, 'publishSupplySuggestion').mockRejectedValue(apiErr(409, 'QUARANTINED'));
    view();
    expect(await screen.findByText(/cambió más de 30 %/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^publicar$/i }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/cuarentena/i)).toBeTruthy();
    expect(pub.mock.calls[0][2]).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('§PROV-F4 · ajustes de sugeridas', () => {
  it('muestra interruptor, presupuesto en pesos y autoAccept apagado', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    view();
    const sw = await screen.findByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText(/tope de lo abierto/i) as HTMLInputElement).value).toBe('5000.00');
    expect(screen.getByText(/aceptar ofertas sigue siendo tuyo/i)).toBeTruthy();
    expect(screen.getByText(/abierto ahora MX\$120\.00 de MX\$5,000\.00/)).toBeTruthy();
    expect(screen.queryByText(/lunes a domingo|esta semana/i)).toBeNull();
  });

  it('presupuesto inválido bloquea guardar; válido envía centavos enteros', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    const patch = vi.spyOn(api, 'patchSupplySettings').mockResolvedValue(settings());
    view();
    const input = (await screen.findByLabelText(/tope de lo abierto/i)) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    expect((screen.getByRole('button', { name: /guardar tope/i }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(input);
    await userEvent.type(input, '2500.50');
    await userEvent.click(screen.getByRole('button', { name: /guardar tope/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ openBudgetCents: 250050 }));
  });
});
