import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistView } from './BuylistView';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { KycInfoDTO, UserDTO } from '@/types/contract';

// El gating de venta usa Link de next-intl (login/registro); se mockea el router
// de Next para aislar la vista (mismo patrón que StorefrontHeader.test).
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const BASE_KYC: KycInfoDTO = {
  kycStatus: 'none',
  clabeMasked: undefined,
  ineOnFile: false,
  capPerRequestCents: 300000,
  capPerMonthCents: 1000000,
  monthUsedCents: 0,
};

/** Sesión de cliente verificada (requisito para VENDER; el cotizador es público). */
function asVerifiedCustomer(overrides: Partial<UserDTO> = {}, kyc: Partial<KycInfoDTO> = {}) {
  setStoredUser({
    id: 'u-777',
    email: 'ash@example.com',
    name: 'Ash Ketchum',
    role: 'customer',
    locale: 'es',
    emailVerified: true,
    ...overrides,
  });
  // KYC determinista (GET /users/me/kyc) para el checklist de requisitos.
  vi.spyOn(api, 'getKyc').mockResolvedValue({ ...BASE_KYC, ...kyc });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Cotiza una carta por su nombre y la agrega al carrito (helper de flujo). */
async function quoteAndAdd(name: string) {
  fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  // Una búsqueda puede devolver varias coincidencias (p. ej. "Pikachu" y "Pikachu ex");
  // se toma la primera opción de la lista.
  const options = await screen.findAllByRole('option', { name: new RegExp(name) });
  fireEvent.click(options[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));
  fireEvent.click(await screen.findByRole('button', { name: /Agregar al carrito/ }));
}

/**
 * Nuevo flujo del cotizador (Opción 1, contrato §6 v1.3): buscar sobre TODO el
 * catálogo (por set y/o texto) → elegir una carta → cotizar con getBuylistQuote.
 */
describe('BuylistView · cotizador con búsqueda real', () => {
  it('el botón de cotizar está deshabilitado hasta elegir una carta', async () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(screen.getByRole('button', { name: 'Cotizar' })).toBeDisabled();
    expect(screen.getByText('Elige una carta de los resultados para cotizar.')).toBeInTheDocument();
  });

  it('busca por texto, elige carta y cotiza mostrando rareza + regla aplicada (fallback 40%)', async () => {
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'Charizard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    const option = await screen.findByRole('option', { name: /Charizard/ });
    fireEvent.click(option);

    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));

    expect(await screen.findByRole('heading', { name: 'Cotización' })).toBeInTheDocument();
    expect(screen.getByText('Rare Holo')).toBeInTheDocument();
    expect(screen.getByText('40% de referencia')).toBeInTheDocument();
  });

  it('filtra por set y muestra las cartas de ese set', async () => {
    renderWithProviders(<BuylistView />, 'es');

    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    expect(await screen.findByRole('option', { name: /Pikachu/ })).toBeInTheDocument();
  });

  it('una carta sin referencia (Zapdos) queda en precio pendiente', async () => {
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: 'Zapdos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    fireEvent.click(await screen.findByRole('option', { name: /Zapdos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));

    expect(await screen.findByText(/precio pendiente/i)).toBeInTheDocument();
  });
});

/**
 * Carrito de venta: varias cartas en UNA sola solicitud. La cantidad por línea
 * se expande a N entradas de `items` al enviar (1 item por carta física).
 * Enviar requiere sesión con correo verificado (gating, contrato §6).
 */
describe('BuylistView · carrito de venta', () => {
  it('parte con el carrito vacío y sin poder enviar', () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    expect(
      screen.getByText('Tu carrito está vacío. Cotiza una carta y agrégala para venderla.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar solicitud/ })).not.toBeInTheDocument();
  });

  it('agrega una carta cotizada al carrito y muestra su estimado', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    // La línea aparece en el carrito con su nombre y hay un total estimado.
    expect(screen.getByText('Total estimado')).toBeInTheDocument();
    expect(screen.getByText('Estimado c/u:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeEnabled();
  });

  it('la cantidad por línea suma al total y expande los items al enviar', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    // Sube la cantidad de la línea a 3 (alguien vende 3 iguales).
    const inc = screen.getByRole('button', { name: 'Aumentar cantidad' });
    fireEvent.click(inc);
    fireEvent.click(inc);
    expect(screen.getByRole('button', { name: 'Enviar solicitud (3)' })).toBeInTheDocument();

    // Enviar → abre el KYC/CLABE; se completa y se crea con 3 items expandidos.
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (3)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    // a11y (hallazgo QA): el submit del modal KYC tiene una etiqueta DISTINTA del CTA del carrito.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const payload = spy.mock.calls[0][0];
    expect(payload.items).toHaveLength(3);
    expect(payload.items.every((i) => i.cardId === 'c-charizard' && i.rawCondition === 'NM')).toBe(
      true,
    );
  });

  it('agrega varias cartas distintas y las envía en una sola solicitud', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');
    await quoteAndAdd('Pikachu');

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (2)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const ids = spy.mock.calls[0][0].items.map((i) => i.cardId);
    expect(ids).toContain('c-charizard');
    expect(ids).toContain('c-pikachu');
  });

  it('quitar una línea la elimina del carrito', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(
      screen.getByText('Tu carrito está vacío. Cotiza una carta y agrégala para venderla.'),
    ).toBeInTheDocument();
  });

  it('vaciar el carrito lo deja vacío', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');
    fireEvent.click(screen.getByRole('button', { name: /Vaciar carrito/ }));
    expect(
      screen.getByText('Tu carrito está vacío. Cotiza una carta y agrégala para venderla.'),
    ).toBeInTheDocument();
  });
});

/**
 * v1.6-finish: selector de acabado en el cotizador (poblado de card.availableFinishes) y
 * dedup del carrito por (cardId + productType + finish).
 */
describe('BuylistView · acabado (finish)', () => {
  async function pick(name: string) {
    fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    const options = await screen.findAllByRole('option', { name: new RegExp(name) });
    fireEvent.click(options[0]);
  }

  it('el selector de acabado manda el finish elegido a getBuylistQuote', async () => {
    const spy = vi.spyOn(api, 'getBuylistQuote');
    renderWithProviders(<BuylistView />, 'es');
    await pick('Charizard');
    // Charizard tiene >1 acabado → el selector es visible.
    fireEvent.change(screen.getByLabelText('Acabado / versión'), {
      target: { value: 'reverse_holo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.at(-1)![0].finish).toBe('reverse_holo');
  });

  it('dedup: agregar la MISMA (carta, tipo, acabado) incrementa la cantidad, no duplica la línea', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard'); // finish normal por defecto
    // Segundo add del mismo acabado: reutiliza la cotización visible.
    fireEvent.click(screen.getByRole('button', { name: /Agregar al carrito/ }));

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();
    // Una sola línea en el carrito (un único botón "Quitar").
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
  });

  it('dedup: la MISMA carta en DISTINTO acabado es una línea separada', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard'); // normal
    // Cambia el acabado a Reverse Holo, re-cotiza y agrega → línea distinta.
    fireEvent.change(screen.getByLabelText('Acabado / versión'), {
      target: { value: 'reverse_holo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Agregar al carrito/ }));

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(2);
  });

  it('el finish elegido viaja en los items de la solicitud creada', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await pick('Charizard');
    fireEvent.change(screen.getByLabelText('Acabado / versión'), {
      target: { value: 'holofoil' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cotizar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Agregar al carrito/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items.every((i) => i.finish === 'holofoil')).toBe(true);
  });
});

/**
 * Gating de requisitos de cuenta para VENDER (guards del contrato §6: JwtAuthGuard →
 * RolesGuard → EmailVerifiedGuard). El usuario debe saber QUÉ le falta ANTES de llenar
 * todo; el bloqueo autoritativo sigue siendo server-side.
 */
describe('BuylistView · gating de requisitos de cuenta (vender)', () => {
  it('sin sesión: cotizar es libre, pero el envío se sustituye por CTA de iniciar sesión / crear cuenta', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    // Aviso claro desde el inicio (panel) + CTAs de login/registro; NO hay botón de enviar.
    expect(screen.getByText('Inicia sesión o crea cuenta para vender')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar solicitud/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Iniciar sesión' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Crear cuenta' }).length).toBeGreaterThan(0);
  });

  it('correo no verificado: aviso con CTA de reenvío y el botón de enviar queda deshabilitado con motivo', async () => {
    asVerifiedCustomer({ emailVerified: false });
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    const send = screen.getByRole('button', { name: /Enviar solicitud/ });
    expect(send).toBeDisabled();
    // El motivo del bloqueo es visible y el botón lo referencia (aria-describedby).
    expect(screen.getByText('Verifica tu correo para enviar tu solicitud.')).toBeInTheDocument();
    expect(send).toHaveAttribute('aria-describedby', 'sell-blocked-reason');
    // El panel muestra el aviso claro con el CTA de reenviar verificación.
    expect(screen.getByText('Verifica tu correo para completar esta acción')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reenviar correo de verificación' }),
    ).toBeInTheDocument();
  });

  it('correo no verificado: el CTA de reenviar llama a POST /auth/verify-email/resend', async () => {
    asVerifiedCustomer({ emailVerified: false });
    const spy = vi.spyOn(api, 'resendVerificationEmail').mockResolvedValue({ ok: true });
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Reenviar correo de verificación' }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Te enviamos un nuevo correo de verificación.')).toBeInTheDocument();
  });

  it('sin CLABE registrada: el checklist la marca como requisito pendiente desde el inicio', async () => {
    asVerifiedCustomer({}, { clabeMasked: undefined });
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('Requisitos para vender')).toBeInTheDocument();
    expect(
      await screen.findByText(/CLABE a tu nombre \(18 dígitos\): requisito/),
    ).toBeInTheDocument();
  });

  it('sin CLABE: el modal exige capturarla y NO llama al backend si va vacía', async () => {
    asVerifiedCustomer({}, { clabeMasked: undefined });
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar y enviar' }));

    expect(screen.getByText('La CLABE debe tener 18 dígitos.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('con CLABE registrada: el checklist la muestra cumplida (enmascarada)', async () => {
    asVerifiedCustomer({}, { clabeMasked: '****1234', kycStatus: 'pending' });
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('CLABE registrada (****1234)')).toBeInTheDocument();
    expect(screen.getByText('Correo verificado')).toBeInTheDocument();
  });

  it('estimado sobre el tope sin INE: avisa ANTES de enviar y el modal pide el INE de entrada', async () => {
    // Tope por solicitud ínfimo → cualquier estimado lo supera (heads-up de INE_REQUIRED).
    asVerifiedCustomer({}, { capPerRequestCents: 1 });
    renderWithProviders(<BuylistView />, 'es');
    await quoteAndAdd('Charizard');

    expect(await screen.findByText(/supera el tope .*se pedirá tu INE/)).toBeInTheDocument();

    // Al abrir el modal, la petición de INE ya está visible (no espera al 422).
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    expect(
      await screen.findByText('Esta solicitud supera el tope: sube tu INE (anverso y reverso) para continuar.'),
    ).toBeInTheDocument();
  });
});
