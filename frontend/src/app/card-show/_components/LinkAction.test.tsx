/**
 * §CARDSHOW.6 (Diseño A) — páginas de acción del doble opt-in. Se prueba la CONDUCTA del cliente:
 * render de marca con botón, que el GET NO muta (el POST va SOLO al pulsar), que el POST va en
 * `application/json` con la clave `token`, y el manejo de 200/410/400/429 y del rechazo con mensaje
 * (torneo lleno, §CARDSHOW.12). `fetch` se mockea para no tocar red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkActionClient } from './LinkActionClient';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LinkActionClient · render y C4 (el GET no muta)', () => {
  it('pinta la página de marca con botón y NO hace ningún POST al renderizar', () => {
    render(<LinkActionClient action="confirm" token="tok-abc" />);
    expect(screen.getByText('TCG HUNT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar registro' })).toBeInTheDocument();
    // C4: sin clic, cero llamadas de red.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin token muestra enlace inválido y NO pinta botón', () => {
    render(<LinkActionClient action="confirm" token={undefined} />);
    expect(screen.getByText(/no es válido/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('LinkActionClient · POST al pulsar (§CARDSHOW.2/.6)', () => {
  it('pulsar envía POST application/json con la clave token y pinta éxito', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, state: 'new' }));
    const user = userEvent.setup();
    render(<LinkActionClient action="confirm" token="tok-xyz" />);

    await user.click(screen.getByRole('button', { name: 'Confirmar registro' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/card-show/confirm');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-xyz' });

    expect(await screen.findByText(/tu registro quedó confirmado/i)).toBeInTheDocument();
  });

  it('410 ⇒ «este enlace ya se usó o expiró»', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(410, undefined));
    const user = userEvent.setup();
    render(<LinkActionClient action="unsubscribe" token="tok-1" />);
    await user.click(screen.getByRole('button', { name: 'Darme de baja' }));
    expect(await screen.findByText(/ya se usó o expiró/i)).toBeInTheDocument();
  });

  it('429 ⇒ «demasiados intentos»', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, undefined, { 'Retry-After': '30' }));
    const user = userEvent.setup();
    render(<LinkActionClient action="cancel" token="tok-2" />);
    await user.click(screen.getByRole('button', { name: 'Cancelar preinscripción' }));
    expect(await screen.findByText(/demasiados intentos/i)).toBeInTheDocument();
  });

  it('400 ⇒ error genérico', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: { code: 'VALIDATION_ERROR' } }));
    const user = userEvent.setup();
    render(<LinkActionClient action="confirm" token="tok-3" />);
    await user.click(screen.getByRole('button', { name: 'Confirmar registro' }));
    expect(await screen.findByText(/no pudimos completar la acción/i)).toBeInTheDocument();
  });

  it('torneo lleno `{ ok:false, message }` ⇒ muestra el message (§CARDSHOW.12)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ok: false, message: 'Este Player ID ya está preinscrito ese día' }),
    );
    const user = userEvent.setup();
    render(<LinkActionClient action="confirm" token="tok-4" />);
    await user.click(screen.getByRole('button', { name: 'Confirmar registro' }));
    expect(await screen.findByText('Este Player ID ya está preinscrito ese día')).toBeInTheDocument();
  });

  it('state=waitlist ⇒ copy de lista de espera', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, state: 'waitlist' }));
    const user = userEvent.setup();
    render(<LinkActionClient action="confirm" token="tok-5" />);
    await user.click(screen.getByRole('button', { name: 'Confirmar registro' }));
    expect(await screen.findByText(/lista de espera/i)).toBeInTheDocument();
  });
});
