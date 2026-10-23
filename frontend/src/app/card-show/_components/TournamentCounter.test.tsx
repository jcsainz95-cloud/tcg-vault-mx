/**
 * Contador público del torneo Pokémon (API_CONTRACT §CARDSHOW.12-bis, criterio §13 [M-90] (8)).
 * Se mockea `fetch`: lo que se prueba es la pintura según la respuesta y que se OCULTE ante no-200.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TournamentCounter } from './TournamentCounter';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const ok = (sat: [number, number | null, boolean], sun: [number, number | null, boolean]) => ({
  game: 'pokemon',
  days: [
    { day: 'sat', confirmed: sat[0], cap: sat[1], full: sat[2] },
    { day: 'sun', confirmed: sun[0], cap: sun[1], full: sun[2] },
  ],
  asOf: '2026-10-21T18:00:00.000Z',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TournamentCounter (§CARDSHOW.12-bis)', () => {
  it('200 ⇒ «Sábado N/64 · Domingo N/64» y pide GET /card-show/tournament/count', async () => {
    const f = mockFetch(200, ok([37, 64, false], [12, 64, false]));
    render(<TournamentCounter />);
    const el = await screen.findByTestId('tournament-counter');
    expect(el).toHaveTextContent('Sábado 37/64 · Domingo 12/64');
    expect(String(f.mock.calls[0][0])).toMatch(/\/card-show\/tournament\/count$/);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('full ⇒ «Cupo lleno — lista de espera» en ese día, sin «64/64»', async () => {
    mockFetch(200, ok([20, 64, false], [64, 64, true]));
    render(<TournamentCounter />);
    const el = await screen.findByTestId('tournament-counter');
    expect(el).toHaveTextContent('Sábado 20/64 · Domingo: Cupo lleno — lista de espera');
    expect(el).not.toHaveTextContent('64/64');
  });

  it('cap=null ⇒ solo «N preinscritos», sin «/» ni «lleno»', async () => {
    mockFetch(200, ok([5, null, false], [0, null, false]));
    render(<TournamentCounter />);
    const el = await screen.findByTestId('tournament-counter');
    expect(el).toHaveTextContent('Sábado 5 preinscritos · Domingo 0 preinscritos');
    expect(el.textContent).not.toMatch(/\/|lleno/);
  });

  it.each([503, 429, 500])('%i ⇒ contador oculto (nada pintado), aunque el cuerpo traiga números', async (status) => {
    // Cuerpo con forma válida a propósito: lo que oculta es el STATUS, no la forma del cuerpo.
    const f = mockFetch(status, ok([37, 64, false], [12, 64, false]));
    const { container } = render(<TournamentCounter />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('tournament-counter')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('red caída o forma inesperada ⇒ oculto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const { unmount } = render(<TournamentCounter />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('tournament-counter')).toBeNull();
    unmount();
    mockFetch(200, { game: 'pokemon', days: [{ day: 'sat', confirmed: '37', cap: 64, full: false }] });
    render(<TournamentCounter />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('tournament-counter')).toBeNull();
  });
});
