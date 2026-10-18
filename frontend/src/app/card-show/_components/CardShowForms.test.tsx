/**
 * Formularios del Card Show tras el PIVOTE A CAPTURA (API_CONTRACT §CARDSHOW.3/.5/.6/.11/.12, v1.96
 * M-84). Se mockean las llamadas HTTP; lo que se prueba es la CONDUCTA del cliente: validación,
 * estados de error/éxito, el cuerpo que se envía al contrato y el honeypot oculto. Las tres formas:
 *  - `LeadVisitorForm`  → POST /leads  (type=visitor; name, email, gameInterest?, raffleOptIn, raffleTermsVersion)
 *  - `MerchantSponsorForm` → POST /leads (type=merchant|sponsor; name, phone, email, sellsWhat?)
 *  - `TorneoForm`       → POST /players (Pokémon FORMAL pide playerId; resto LIGERA ⛔ sin playerId)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardShowApiError } from '@/lib/card-show-api';
import { CARD_SHOW } from '@/content/card-show';
import { LeadVisitorForm } from './LeadVisitorForm';
import { MerchantSponsorForm } from './MerchantSponsorForm';
import { TorneoForm } from './TorneoForm';
import { FORM_MESSAGES, formTokenTiming } from './form-shared';

const { getFormToken, submitLead, submitPlayer } = vi.hoisted(() => ({
  getFormToken: vi.fn(),
  submitLead: vi.fn(),
  submitPlayer: vi.fn(),
}));

vi.mock('@/lib/card-show-api', async (orig) => {
  const actual = await orig<typeof import('@/lib/card-show-api')>();
  return { ...actual, getFormToken, submitLead, submitPlayer };
});

beforeEach(() => {
  // Las pruebas no esperan de verdad el min-age del token anti-bot: se pone en 0 (prod = 2 s).
  formTokenTiming.minAgeMs = 0;
  formTokenTiming.slackMs = 0;
  getFormToken.mockResolvedValue('tok');
});

afterEach(() => {
  vi.clearAllMocks();
  formTokenTiming.minAgeMs = 2_000;
  formTokenTiming.slackMs = 150;
});

describe('LeadVisitorForm · asistente (type=visitor)', () => {
  it('idle · se pinta con campos visibles, sin opacity:0 (sin JS)', () => {
    const { container } = render(<LeadVisitorForm />);
    expect(screen.getByRole('button', { name: 'Registrarme gratis' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toBeInTheDocument();
    expect(container.querySelector('.opacity-0')).toBeNull();
  });

  it('la casilla de la rifa nace DESMARCADA (⭐M-89: separada de privacidad, con enlace a bases)', () => {
    render(<LeadVisitorForm />);
    expect(screen.getByRole('checkbox', { name: /Quiero participar en la rifa/ })).not.toBeChecked();
    // El enlace a las bases vive en la propia casilla de rifa, no en la de privacidad.
    expect(screen.getByRole('link', { name: /Ver bases de la rifa/ })).toHaveAttribute('href', '#rifa');
  });

  it('sin nombre / correo inválido / sin consentimiento ⇒ errores de campo, no hace POST', async () => {
    const u = userEvent.setup();
    render(<LeadVisitorForm />);
    await u.type(screen.getByLabelText('Correo'), 'no-es-correo');
    await u.click(screen.getByRole('button', { name: 'Registrarme gratis' }));
    expect(await screen.findByText(FORM_MESSAGES.needName)).toBeInTheDocument();
    expect(screen.getByText(FORM_MESSAGES.needEmail)).toBeInTheDocument();
    expect(screen.getByText(FORM_MESSAGES.needConsent)).toBeInTheDocument();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it('§CS-UX.3 clear-on-change: el error de un campo DESAPARECE al corregirlo (solo ese)', async () => {
    const u = userEvent.setup();
    render(<LeadVisitorForm />);
    await u.click(screen.getByRole('button', { name: 'Registrarme gratis' }));
    // Al enviar vacío salen los tres errores de campo.
    expect(await screen.findByText(FORM_MESSAGES.needName)).toBeInTheDocument();
    expect(screen.getByText(FORM_MESSAGES.needConsent)).toBeInTheDocument();
    // Teclear en Nombre retira SU error (clearFieldError en onChange, §CS-UX.3 punto 3)…
    await u.type(screen.getByLabelText('Nombre'), 'A');
    await waitFor(() => expect(screen.queryByText(FORM_MESSAGES.needName)).toBeNull());
    // …y no borra los demás de golpe: el de consentimiento sigue hasta corregirse.
    expect(screen.getByText(FORM_MESSAGES.needConsent)).toBeInTheDocument();
  });

  it('adquisición PEREZOSA (§CARDSHOW.5 M-87): 0 GET form-token al montar, 1 al primer foco', async () => {
    const u = userEvent.setup();
    render(<LeadVisitorForm />);
    // Montar NO pide token (a 30/h por IP bloqueaba a visitantes tras un NAT compartido).
    expect(getFormToken).not.toHaveBeenCalled();
    // El primer foco en un campo (vía onFocus del <form>) pide EXACTAMENTE uno…
    await u.click(screen.getByLabelText('Nombre'));
    await waitFor(() => expect(getFormToken).toHaveBeenCalledTimes(1));
    // …y es idempotente: enfocar otros campos no dispara más GETs.
    await u.click(screen.getByLabelText('Correo'));
    await u.click(screen.getByRole('button', { name: 'Lorcana' }));
    expect(getFormToken).toHaveBeenCalledTimes(1);
  });

  it('éxito · envía UN lead visitor con gameInterest, raffleOptIn y raffleTermsVersion', async () => {
    submitLead.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<LeadVisitorForm />);
    expect(getFormToken).not.toHaveBeenCalled(); // ⛔ nada al montar (lazy)
    await u.type(screen.getByLabelText('Nombre'), 'Ana López');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByRole('button', { name: 'Lorcana' }));
    // ⭐M-89: la rifa nace desmarcada; hay que marcarla para que raffleOptIn=true.
    await u.click(screen.getByRole('checkbox', { name: /Quiero participar en la rifa/ }));
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Registrarme gratis' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    expect(submitLead).toHaveBeenCalledTimes(1);
    const body = submitLead.mock.calls[0][0];
    expect(body.type).toBe('visitor');
    expect(body.name).toBe('Ana López');
    expect(body.gameInterest).toBe('lorcana');
    expect(body.raffleOptIn).toBe(true);
    expect(body.raffleTermsVersion).toBe(CARD_SHOW.raffleTermsVersion);
    expect(typeof body.formToken).toBe('string');
    expect('phone' in body ? body.phone : undefined).toBeUndefined();
  });

  it('sin rifa (casilla desmarcada por defecto) ⇒ raffleOptIn=false y SIN raffleTermsVersion (⭐M-89)', async () => {
    submitLead.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<LeadVisitorForm />);
    await u.type(screen.getByLabelText('Nombre'), 'Ana');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    // ⭐M-89: NO se toca la casilla de rifa (nace desmarcada); solo se marca privacidad.
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Registrarme gratis' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    const body = submitLead.mock.calls[0][0];
    expect(body.raffleOptIn).toBe(false);
    expect(body.raffleTermsVersion).toBeUndefined();
    expect(body.gameInterest).toBeUndefined(); // «Aún no sé» por defecto
  });

  it('429 ⇒ mensaje de rate-limit; honeypot oculto y fuera del foco', async () => {
    submitLead.mockRejectedValue(new CardShowApiError(429, 'RATE_LIMITED', 'too many', undefined, 60));
    const u = userEvent.setup();
    const { container } = render(<LeadVisitorForm />);
    const hp = container.querySelector('input[name="website"]') as HTMLInputElement;
    expect(hp.getAttribute('tabindex')).toBe('-1');
    expect(hp.closest('[aria-hidden="true"]')).not.toBeNull();
    await u.type(screen.getByLabelText('Nombre'), 'Ana');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Registrarme gratis' }));
    expect(await screen.findByText(FORM_MESSAGES.rateLimited)).toBeInTheDocument();
  });
});

describe('MerchantSponsorForm · vendedor/patrocinador (type=merchant|sponsor)', () => {
  it('teléfono inválido ⇒ error de campo, no hace POST', async () => {
    const u = userEvent.setup();
    render(<MerchantSponsorForm />);
    await u.type(screen.getByLabelText('Nombre o marca'), 'Mi Tienda');
    await u.type(screen.getByLabelText('Teléfono'), '123');
    await u.type(screen.getByLabelText('Correo'), 'tienda@correo.com');
    await u.click(screen.getByLabelText(/Acepto que TCG HUNT/));
    await u.click(screen.getByRole('button', { name: 'Quiero que me contacten' }));
    expect(await screen.findByText(FORM_MESSAGES.needPhone)).toBeInTheDocument();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it('éxito · envía name, phone y sellsWhat; el tipo por defecto es merchant', async () => {
    submitLead.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<MerchantSponsorForm />);
    await u.type(screen.getByLabelText('Nombre o marca'), 'Mi Tienda');
    await u.type(screen.getByLabelText('Teléfono'), '55 1234 5678');
    await u.type(screen.getByLabelText('Correo'), 'tienda@correo.com');
    await u.type(screen.getByLabelText(/Qué vendes/), 'Singles y sellado');
    await u.click(screen.getByLabelText(/Acepto que TCG HUNT/));
    await u.click(screen.getByRole('button', { name: 'Quiero que me contacten' }));
    expect(await screen.findByText(/Confirma tu correo/)).toBeInTheDocument();
    const body = submitLead.mock.calls[0][0];
    expect(body.type).toBe('merchant');
    expect(body.name).toBe('Mi Tienda');
    expect(body.phone).toBe('55 1234 5678');
    expect(body.sellsWhat).toBe('Singles y sellado');
  });

  it('al elegir «Patrocinador» el POST lleva type=sponsor', async () => {
    submitLead.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<MerchantSponsorForm />);
    await u.click(screen.getByRole('button', { name: 'Patrocinador' }));
    await u.type(screen.getByLabelText('Nombre o marca'), 'Marca X');
    await u.type(screen.getByLabelText('Teléfono'), '5512345678');
    await u.type(screen.getByLabelText('Correo'), 'marca@correo.com');
    await u.click(screen.getByLabelText(/Acepto que TCG HUNT/));
    await u.click(screen.getByRole('button', { name: 'Quiero que me contacten' }));
    expect(await screen.findByText(/Confirma tu correo/)).toBeInTheDocument();
    expect(submitLead.mock.calls[0][0].type).toBe('sponsor');
  });
});

describe('TorneoForm · preinscripción (§CARDSHOW.12 M-84)', () => {
  it('Pokémon = FORMAL: pide Player ID; vacío/no numérico ⇒ error y limpia a dígitos', async () => {
    const u = userEvent.setup();
    render(<TorneoForm />);
    await u.selectOptions(screen.getByLabelText('Juego'), 'pokemon');
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

  it('juego LIGERA (Riftbound): ⛔ no muestra Player ID y el POST no lo envía', async () => {
    submitPlayer.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<TorneoForm />);
    await u.selectOptions(screen.getByLabelText('Juego'), 'riftbound');
    expect(screen.queryByLabelText('Player ID')).toBeNull();
    await u.click(screen.getByRole('radio', { name: /Sábado/ }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    const body = submitPlayer.mock.calls[0][0];
    expect(body.game).toBe('riftbound');
    expect(body.playerId).toBeUndefined();
  });

  it('sin juego ⇒ error de campo', async () => {
    const u = userEvent.setup();
    render(<TorneoForm />);
    await u.click(screen.getByRole('radio', { name: /Sábado/ }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.needGame)).toBeInTheDocument();
    expect(submitPlayer).not.toHaveBeenCalled();
  });

  it('«los dos días» (Pokémon) ⇒ dos POST (sat + sun), cada uno con su token de un solo uso', async () => {
    let n = 0;
    getFormToken.mockImplementation(() => Promise.resolve(`tok-${++n}`));
    submitPlayer.mockResolvedValue(undefined);
    const u = userEvent.setup();
    render(<TorneoForm />);
    expect(getFormToken).not.toHaveBeenCalled(); // ⛔ lazy: nada al montar
    await u.selectOptions(screen.getByLabelText('Juego'), 'pokemon'); // primer foco ⇒ 1 GET
    await u.click(screen.getByRole('radio', { name: 'Los dos días' }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Player ID'), '12345');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText(/He leído el/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.success)).toBeInTheDocument();
    expect(submitPlayer.mock.calls.map((c) => c[0].day).sort()).toEqual(['sat', 'sun']);
    const tokens = submitPlayer.mock.calls.map((c) => c[0].formToken);
    expect(new Set(tokens).size).toBe(2); // un token de un solo uso POR POST
    // Dos POST ⇒ dos tokens: el primero cacheado al enfocar, el segundo pedido en caliente.
    expect(getFormToken).toHaveBeenCalledTimes(2);
    expect(submitPlayer.mock.calls.every((c) => c[0].playerId === '12345')).toBe(true);
  });

  it('menor sin consentimiento del tutor ⇒ bloquea el envío', async () => {
    const u = userEvent.setup();
    render(<TorneoForm />);
    await u.selectOptions(screen.getByLabelText('Juego'), 'pokemon');
    await u.click(screen.getByRole('radio', { name: /Sábado/ }));
    await u.type(screen.getByLabelText('Nombre del jugador'), 'Ana');
    await u.type(screen.getByLabelText('Player ID'), '12345');
    await u.type(screen.getByLabelText('Correo'), 'ana@correo.com');
    await u.click(screen.getByLabelText('El jugador es menor de edad'));
    await u.click(screen.getByLabelText(/He leído el aviso de privacidad/));
    await u.click(screen.getByRole('button', { name: 'Preinscríbete' }));
    expect(await screen.findByText(FORM_MESSAGES.needGuardian)).toBeInTheDocument();
    expect(submitPlayer).not.toHaveBeenCalled();
  });
});
