/**
 * §CARDSHOW.12 ⭐M-88 — confirmación de GRUPO «los dos días». Cuando `POST /card-show/confirm`
 * devuelve el desglose `days: { day, state }[]` con 2 días, el copy nombra SÁBADO Y DOMINGO (labels
 * del content `torneos.dias`, un hecho un sitio); si un día quedó en lista de espera, los nombra
 * aparte. Con 1 día o sin `days` (leads) el copy de un día no cambia (cubierto en `LinkAction.test`).
 * `fetch` se mockea; no toca red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CARD_SHOW } from '@/content/card-show';
import { LinkActionClient } from './LinkActionClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const SAT = CARD_SHOW.torneos.dias.find((d) => d.id === 'sat')!.label;
const SUN = CARD_SHOW.torneos.dias.find((d) => d.id === 'sun')!.label;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function confirmWith(body: unknown): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, body));
  const user = userEvent.setup();
  render(<LinkActionClient action="confirm" token="tok-grp" />);
  await user.click(screen.getByRole('button', { name: 'Confirmar registro' }));
}

describe('LinkActionClient · confirmación de grupo «los dos días» (§CARDSHOW.12 ⭐M-88)', () => {
  it('ambos días confirmados ⇒ nombra SÁBADO Y DOMINGO como preinscrito', async () => {
    await confirmWith({
      ok: true,
      state: 'confirmed',
      days: [
        { day: 'sat', state: 'confirmed' },
        { day: 'sun', state: 'confirmed' },
      ],
    });
    const msg = await screen.findByText(/preinscrito/i);
    expect(msg.textContent).toContain(SAT);
    expect(msg.textContent).toContain(SUN);
    expect(msg.textContent).not.toMatch(/lista de espera/i);
  });

  it('un día en lista de espera ⇒ nombra el confirmado y el de espera por separado', async () => {
    await confirmWith({
      ok: true,
      state: 'confirmed',
      days: [
        { day: 'sat', state: 'confirmed' },
        { day: 'sun', state: 'waitlist' },
      ],
    });
    const msg = await screen.findByText(/lista de espera/i);
    expect(msg.textContent).toContain(`preinscrito para ${SAT}`);
    expect(msg.textContent).toContain(`lista de espera para ${SUN}`);
  });

  it('1 solo día (desglose de 1) ⇒ copy de un día, sin nombrar el día', async () => {
    await confirmWith({ ok: true, state: 'confirmed', days: [{ day: 'sat', state: 'confirmed' }] });
    const msg = await screen.findByText(/tu registro quedó confirmado/i);
    expect(msg.textContent).not.toContain(SAT);
  });
});
