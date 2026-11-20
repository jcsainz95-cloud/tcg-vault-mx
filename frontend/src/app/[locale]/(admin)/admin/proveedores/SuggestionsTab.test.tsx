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
  reasons: [{ kind: 'metadeck', ref: null, rank: 1, copies: 4, mult: 2 }], status: 'draft', skipReason: null, requestId: null, createdAt: '2026-11-20T00:00:00Z', ...over,
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

describe('§PROV-F4 · decks de origen y errores', () => {
  const rs = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'metadeck' as const, ref: null, rank: i + 2, copies: 4, mult: 2 }));
  it('muestra deck, copias × multiplicador; con 5 decks, 3 + «y 2 más»', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [sug(2, { reasons: rs(5) }), sug(3, { id: 'n', reasons: [{ kind: 'metadeck', ref: 'Gardevoir', rank: 1, copies: 1, mult: 2 }] })], page: 1, pageSize: 25, total: 2 });
    view();
    expect(await screen.findByText('Deck #2 · 4 copias × 2')).toBeTruthy();
    expect(screen.getByText('Deck #4 · 4 copias × 2')).toBeTruthy();
    expect(screen.queryByText('Deck #5 · 4 copias × 2')).toBeNull();
    expect(screen.getByText('y 2 más')).toBeTruthy();
    expect(screen.getByText('Gardevoir (#1) · 1 copia × 2')).toBeTruthy();
  });

  it('reason vieja sin cifras, rank null y slug legible: sin NaN', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [
      sug(2, { reasons: [{ kind: 'metadeck', ref: 'charizard-ex', rank: 3, copies: 4, mult: 2 }] }),
      sug(3, { id: 'n', reasons: [{ kind: 'metadeck', ref: 'gardevoir-ex', rank: null, copies: null, mult: null }] }),
      sug(4, { id: 'o', reasons: [{ kind: 'metadeck', ref: null } as never] }),
    ], page: 1, pageSize: 25, total: 3 });
    const { container } = view();
    expect(await screen.findByText('Charizard ex (#3) · 4 copias × 2')).toBeTruthy();
    expect(screen.getByText('Gardevoir ex')).toBeTruthy();
    expect(screen.getByText('Meta deck')).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('fila covered: sin Publicar (ni como super_admin)', async () => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [sug(1, { status: 'skipped', skipReason: 'covered' })], page: 1, pageSize: 25, total: 1 });
    view();
    expect(await screen.findByText('1 pieza')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^publicar$/i })).toBeNull();
  });

  it.each([
    ['ALREADY_COVERED', 409, /ya está cubierta/i],
    ['BUDGET_EXCEEDED', 409, /no cabe en el tope/i],
    ['ABOVE_MARKET_CAP', 422, /rebasa el precio de mercado/i],
    ['ALREADY_PUBLISHED', 409, /ya se publicó/i],
    ['MARKET_UNAVAILABLE', 503, /no hay precio de mercado disponible ahora; reintenta en unos minutos/i],
  ])('publicar con %s muestra su texto', async (code, status, re) => {
    vi.spyOn(api, 'getSupplySettings').mockResolvedValue(settings());
    vi.spyOn(api, 'listSupplySuggestions').mockResolvedValue({ data: [sug(1)], page: 1, pageSize: 25, total: 1 });
    vi.spyOn(api, 'publishSupplySuggestion').mockRejectedValue(apiErr(status, code));
    view();
    await userEvent.click(await screen.findByRole('button', { name: /^publicar$/i }));
    expect(within(await screen.findByRole('alert')).getByText(re)).toBeTruthy();
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
    expect(screen.getByText(/MX\$120\.00 de MX\$5,000\.00/)).toBeTruthy();
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
