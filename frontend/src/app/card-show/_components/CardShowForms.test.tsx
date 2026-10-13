/**
 * §13 (formularios) — estados, validación y accesibilidad de los dos formularios del Card Show
 * (API_CONTRACT §CARDSHOW.3/.5/.6/.11/.12, RONDA_0 §6). Se mockean las llamadas HTTP; lo que se
 * prueba es la CONDUCTA del cliente: los 10 estados, el honeypot oculto y el reintento de token.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardShowApiError } from '@/lib/card-show-api';
import { AvisameForm } from './AvisameForm';
import { TorneoForm } from './TorneoForm';
import { FORM_MESSAGES } from './form-shared';

const { getFormToken, submitLead, submitPlayer } = vi.hoisted(() => ({
  getFormToken: vi.fn(),
  submitLead: vi.fn(),
  submitPlayer: vi.fn(),
}));

vi.mock('@/lib/card-show-api', async (orig) => {
  const actual = await orig<typeof import('@/lib/card-show-api')>();
  return { ...actual, getFormToken, submitLead, submitPlayer };
});
vi.mock('@/lib/card-show-clicks', () => ({ trackClick: vi.fn(), trackedHref: (d: string) => `/ir/${d}` }));

afterEach(() => {
  vi.clearAllMocks();
});

function expired() {
  return new CardShowApiError(400, 'FORM_EXPIRED', 'form expired');
}

describe('AvisameForm · estados y validación (§CARDSHOW.3/.5/.6)', () => {
  it('estado 1 (idle) · se pinta con campos visibles, sin opacity:0 (sin JS)', () => {
    const { container } = render(<AvisameForm />);
    expect(screen.getByRole('button', { name: 'Avísame' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toBeInTheDocument();
    // Ningún nodo del formulario se esconde hasta hidratar.
    expect(container.querySelector('.opacity-0')).toBeNull();
  });

  it('estado 2 · sin chip de interés ⇒ error de campo, no hace POST', async () => {
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    expect(await screen.findByText(FORM_MESSAGES.needInteres)).toBeInTheDocument();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it('estado 3 · correo inválido ⇒ error de campo', async () => {
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.click(screen.getByRole('button', { name: 'Voy' }));
    await u.type(screen.getByLabelText('Correo'), 'no-es-correo');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    expect(await screen.findByText(FORM_MESSAGES.needEmail)).toBeInTheDocument();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it('estado 4 · casilla de privacidad sin marcar ⇒ bloquea el envío', async () => {
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.click(screen.getByRole('button', { name: 'Voy' }));
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    expect(await screen.findByText(FORM_MESSAGES.needConsent)).toBeInTheDocument();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it('estado 5 (éxito) · alta válida ⇒ pantalla «revisa tu correo»; un POST por chip con token propio', async () => {
    getFormToken.mockResolvedValue('tok');
    submitLead.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.click(screen.getByRole('button', { name: 'Voy' }));
    await u.click(screen.getByRole('button', { name: 'Vender' }));
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    expect(submitLead).toHaveBeenCalledTimes(2); // dos chips ⇒ dos filas
    expect(getFormToken).toHaveBeenCalledTimes(2); // token de un solo uso por POST
    expect(submitLead.mock.calls.map((c) => c[0].type).sort()).toEqual(['merchant', 'visitor']);
  });

  it('estado 6 (pendiente) · botón en aria-busy mientras se envía', async () => {
    let resolve!: () => void;
    getFormToken.mockResolvedValue('tok');
    submitLead.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.click(screen.getByRole('button', { name: 'Voy' }));
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Avísame' })).toHaveAttribute('aria-busy', 'true'));
    resolve();
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
  });

  it('estado 7 (429) · demasiados intentos ⇒ mensaje de rate-limit', async () => {
    getFormToken.mockResolvedValue('tok');
    submitLead.mockRejectedValue(new CardShowApiError(429, 'RATE_LIMITED', 'too many', undefined, 60));
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.click(screen.getByRole('button', { name: 'Voy' }));
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    expect(await screen.findByText(FORM_MESSAGES.rateLimited)).toBeInTheDocument();
  });

  it('estado 8 (token caducado, reintento OK) · FORM_EXPIRED ⇒ pide otro token y reintenta sin perder lo tecleado', async () => {
    getFormToken.mockResolvedValueOnce('t1').mockResolvedValueOnce('t2');
    submitLead.mockRejectedValueOnce(expired()).mockResolvedValueOnce(undefined);
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.click(screen.getByRole('button', { name: 'Voy' }));
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    expect(getFormToken).toHaveBeenCalledTimes(2);
    expect(submitLead.mock.calls[1][0].token).toBe('t2');
    expect(submitLead.mock.calls[1][0].email).toBe('ana@correo.com'); // no se borró
  });

  it('estado 9 (caducado persistente) · dos FORM_EXPIRED ⇒ mensaje «Formulario caducado»', async () => {
    getFormToken.mockResolvedValue('tok');
    submitLead.mockRejectedValue(expired());
    const u = userEvent.setup();
    render(<AvisameForm />);
    await u.click(screen.getByRole('button', { name: 'Voy' }));
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Avísame' }));
    expect(await screen.findByText(FORM_MESSAGES.expired)).toBeInTheDocument();
  });

  it('estado 10 (honeypot) · el señuelo está oculto, fuera del orden de foco y sin autocompletar', () => {
    const { container } = render(<AvisameForm />);
    const hp = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(hp).not.toBeNull();
    expect(hp.getAttribute('tabindex')).toBe('-1');
    expect(hp.getAttribute('autocomplete')).toBe('off');
    // Lo envuelve un contenedor aria-hidden ⇒ el lector no lo anuncia.
    expect(hp.closest('[aria-hidden="true"]')).not.toBeNull();
    // No es alcanzable por nombre accesible (no lo autollena iOS/Android: name genérico + off).
    expect(screen.queryByRole('textbox', { name: /website|empresa|company/i })).toBeNull();
  });
});

describe('TorneoForm · validación del torneo (§CARDSHOW.12)', () => {
  it('Player ID: se limpia a solo dígitos y vacío/no numérico ⇒ error', async () => {
    const u = userEvent.setup();
    render(<TorneoForm />);
    const pid = screen.getByLabelText('Player ID');
    await u.type(pid, '12ab34');
    expect((pid as HTMLInputElement).value).toBe('1234'); // letras descartadas en captura
    await u.clear(pid);
    await u.click(screen.getByRole('radio', { name: /Sábado/ }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.needPlayerId)).toBeInTheDocument();
    expect(submitPlayer).not.toHaveBeenCalled();
  });

  it('menor sin consentimiento del tutor ⇒ bloquea el envío', async () => {
    const u = userEvent.setup();
    render(<TorneoForm />);
    await u.click(screen.getByRole('radio', { name: /Sábado/ }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Player ID'), '12345');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText('El jugador es menor de edad'));
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.needGuardian)).toBeInTheDocument();
    expect(submitPlayer).not.toHaveBeenCalled();
  });

  it('«los dos días» ⇒ dos POST (sat + sun), cada uno con su token', async () => {
    getFormToken.mockResolvedValue('tok');
    submitPlayer.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<TorneoForm />);
    await u.click(screen.getByRole('radio', { name: 'Los dos días' }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Player ID'), '12345');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    expect(submitPlayer.mock.calls.map((c) => c[0].day).sort()).toEqual(['sat', 'sun']);
    expect(getFormToken).toHaveBeenCalledTimes(2);
  });

  it('menor CON consentimiento ⇒ envía guardianConsent=true', async () => {
    getFormToken.mockResolvedValue('tok');
    submitPlayer.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<TorneoForm />);
    await u.click(screen.getByRole('radio', { name: /Domingo/ }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Player ID'), '12345');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText('El jugador es menor de edad'));
    await u.click(screen.getByLabelText(/padre, madre o tutor/));
    await u.click(screen.getByLabelText(/He leído el aviso de privacidad/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    const body = submitPlayer.mock.calls[0][0];
    expect(body.isMinor).toBe(true);
    expect(body.guardianConsent).toBe(true);
  });

  it('honeypot del torneo también oculto', () => {
    const { container } = render(<TorneoForm />);
    const hps = container.querySelectorAll('input[name="website"]');
    expect(hps.length).toBe(1);
    expect(within(hps[0].closest('[aria-hidden="true"]') as HTMLElement).getByLabelText(/No llenar/)).toBe(hps[0]);
  });
});
