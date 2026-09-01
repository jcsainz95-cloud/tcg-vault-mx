import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SellRequestDetailView } from './SellRequestDetailView';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { setStoredUser } from '@/lib/session';
import type { SellItemDTO, SellRequestDetailDTO, SellOfferPublicDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/buylist/requests/sr-1',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const CARD = {
  id: 'c-1',
  externalId: 'x-1',
  name: 'Charizard VMAX',
  number: '020/189',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's-1',
  setName: 'Darkness Ablaze',
  imageSmallUrl: '',
  imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};

function line(over: Partial<SellItemDTO> = {}): SellItemDTO {
  return {
    id: 'sri-1',
    card: { ...CARD, ...(over.card ?? {}) },
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    itemStatus: 'cotizada',
    ...over,
  };
}

/** El PLAZO llega YA RESUELTO del servidor: los tests nunca lo calculan, lo fijan. */
const DEADLINE = '2026-09-03T18:00:00.000Z';

function offer(over: Partial<SellOfferPublicDTO> = {}): SellOfferPublicDTO {
  return {
    sentAt: '2026-08-30T18:00:00.000Z',
    grossCents: 102000,
    shippingFeeCents: 18000,
    netCents: 84000,
    acceptDeadlineAt: DEADLINE,
    acceptedAt: null,
    shipDeadlineAt: null,
    sellerShippedDeclaredAt: null,
    carrier: null,
    trackingNumber: null,
    terms: {
      perLineConditionLabel: 'siempre que llegue en Near Mint',
      consequence: 'Si una carta no llega en Near Mint no se compra, no se paga y te la devolvemos.',
    },
    lines: [
      line({ id: 'a', offerDecision: 'buy', offeredPriceCents: 84000 }),
      line({
        id: 'b',
        card: { ...CARD, id: 'c-2', name: 'Snorlax V' },
        offerDecision: 'skip',
        offeredPriceCents: null,
      }),
    ],
    ...over,
  };
}

function detail(over: Partial<SellRequestDetailDTO> = {}): SellRequestDetailDTO {
  const base: SellRequestDetailDTO = {
    sellRequestId: 'sr-1',
    status: 'ofertada',
    isTerminal: false,
    quotedTotalCents: 105000,
    ineRequired: false,
    createdAt: '2026-08-28T14:00:00.000Z',
    items: offer().lines,
    offer: offer(),
  };
  return { ...base, ...over };
}

function asSeller() {
  setStoredUser({
    id: 'u-1',
    email: 'ash@example.com',
    name: 'Ash',
    role: 'customer',
    locale: 'es',
    emailVerified: true,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('Portal del vendedor — LA OFERTA (§23.5)', () => {
  it('pinta los TRES montos con el neto destacado, y la resta a la vista', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    const amounts = await screen.findByTestId('offer-amounts');
    // Bruto, envío CON su signo menos, y neto. R1: el bruto nunca aparece solo.
    expect(within(amounts).getByText('MX$1,020.00')).toBeInTheDocument();
    expect(within(amounts).getByText('− MX$180.00')).toBeInTheDocument();
    expect(screen.getByTestId('offer-net')).toHaveTextContent('MX$840.00');
    // La prosa repite ENVÍO y NETO (D43): un número que se estrena no vive en una sola celda.
    expect(
      screen.getByText(/Su costo, MX\$180\.00, es una tarifa fija/),
    ).toBeInTheDocument();
    expect(screen.getByText(/La cifra que se te deposita es MX\$840\.00/)).toBeInTheDocument();
  });

  it('la condición NM va pegada al monto de CADA línea comprada, verbatim del servidor', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    await screen.findByTestId('offer-amounts');
    // El string es DATO (offer.terms), no una clave del catálogo del front.
    expect(screen.getAllByText('siempre que llegue en Near Mint').length).toBeGreaterThan(0);
    // Y el bloque de consecuencia, también verbatim.
    expect(
      screen.getByText(/no se compra, no se paga y te la devolvemos/),
    ).toBeInTheDocument();
  });

  it('lista lo que NO compramos SIN monto: jamás MX$ 0.00', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText('No compramos (1)')).toBeInTheDocument();
    expect(screen.getByText('No entra en esta oferta')).toBeInTheDocument();
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
  });

  it('muestra el PLAZO con fecha y hora explícitas (nunca «en 2 días»)', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    // 2026-09-03T18:00Z = 12:00 p.m. en America/Mexico_City. La zona es FIJA para que la
    // pantalla y el correo digan la misma hora.
    const deadline = await screen.findByText(/Tienes hasta el .*3 de septiembre de 2026/);
    expect(deadline).toHaveTextContent('12:00');
    expect(screen.queryByText(/en 2 días/)).not.toBeInTheDocument();
  });

  it('NO ofrece elegir líneas: el todo-o-nada se demuestra por lo que no está', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    await screen.findByTestId('offer-amounts');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('acepta el paquete completo: confirma con el neto y la condición, y manda solo {decision}', async () => {
    asSeller();
    const d = detail();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(d);
    const respondSpy = vi.spyOn(api, 'respondToSellOffer').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'aceptada',
      acceptedAt: '2026-09-02T10:00:00.000Z',
      isTerminal: false,
      offer: offer({ acceptedAt: '2026-09-02T10:00:00.000Z' }),
    });
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar la oferta' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        /Aceptas que te compremos 1 carta por MX\$840\.00, siempre que llegue en Near Mint/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aceptar y recibir mi guía' }));

    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith('sr-1', 'accept'));
    // El resultado sustituye al bloque de acciones (§23.5c).
    expect(await screen.findByText(/Aceptaste la oferta/)).toBeInTheDocument();
  });

  it('rechazar es SECUNDARIO, nunca destructivo, y también pasa por confirmación', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    const respondSpy = vi.spyOn(api, 'respondToSellOffer').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'rechazada',
      isTerminal: true,
      offer: offer(),
    });
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    const reject = await screen.findByRole('button', { name: 'Rechazar la oferta' });
    // El rojo del sistema es de ATENCIÓN, no de castigo: pintar «rechazar» en rojo presiona
    // a aceptar. `secondary` = regla + texto.
    expect(reject.className).toContain('border-text');
    expect(reject.className).not.toContain('bg-accent');

    fireEvent.click(reject);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Rechazar la oferta' })[0]);
    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith('sr-1', 'reject'));
    expect(await screen.findByText('Rechazaste la oferta.')).toBeInTheDocument();
  });

  it('el 409 OFFER_EXPIRED se pinta como banner PERSISTENTE con role=alert, no como toast', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    vi.spyOn(api, 'respondToSellOffer').mockRejectedValue(
      new ApiClientError(409, {
        code: 'OFFER_EXPIRED',
        message: 'expired',
        details: { offerAcceptDeadlineAt: DEADLINE },
      }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar la oferta' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aceptar y recibir mi guía' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/El plazo para responder esta oferta ya venció/);
  });

  /**
   * ⚠️ La prueba que protege la decisión más contraintuitiva del archivo: **el reloj del
   * navegador no apaga los botones**. Con el equipo adelantado esconderlos le impediría aceptar
   * una oferta viva; el `409` del servidor es la puerta y no mueve nada.
   */
  it('con el plazo aparentemente vencido SIGUE ofreciendo responder (la puerta es el servidor)', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ offer: offer({ acceptDeadlineAt: '2020-01-01T00:00:00.000Z' }) }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);
    expect(await screen.findByRole('button', { name: 'Aceptar la oferta' })).toBeEnabled();
  });

  it('NUNCA filtra nada de la mesa de decisión', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    const { container } = renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);
    await screen.findByTestId('offer-amounts');
    const text = container.textContent ?? '';
    for (const forbidden of ['en camino', 'comprometid', 'sugerencia', 'no comprar', 'tope']) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('Portal del vendedor — los BORDES', () => {
  it('SIN oferta: dice que no mande nada, con la nota de envío y SIN guía ni acciones', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ status: 'cotizada', offer: null }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText(/Todavía no mandes nada\./)).toBeInTheDocument();
    expect(screen.getByTestId('buylist-shipping-note')).toBeInTheDocument();
    expect(screen.queryByTestId('offer-amounts')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar la oferta' })).not.toBeInTheDocument();
  });

  it('`offer` AUSENTE (backend anterior) se lee igual que `null`: nunca se inventa una oferta', async () => {
    asSeller();
    const { offer: _drop, ...withoutOffer } = detail({ status: 'cotizada' });
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(withoutOffer as SellRequestDetailDTO);
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText(/Todavía no mandes nada\./)).toBeInTheDocument();
    expect(screen.queryByTestId('offer-amounts')).not.toBeInTheDocument();
  });

  it('YA ACEPTADA: muestra la oferta y la fecha de aceptación, sin acciones', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({
        status: 'aceptada',
        offer: offer({ acceptedAt: '2026-09-02T16:00:00.000Z' }),
      }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText(/Aceptaste esta oferta el/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar la oferta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar la oferta' })).not.toBeInTheDocument();
    // Sigue viendo el registro de lo que se le ofreció: la oferta no desaparece al aceptarla.
    expect(screen.getByTestId('offer-amounts')).toBeInTheDocument();
  });

  it('YA RECHAZADA en frío: frase NEUTRA — el DTO no dice si la rechazó él o si venció', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ status: 'rechazada', isTerminal: true }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText('Esta oferta ya no está vigente.')).toBeInTheDocument();
    expect(screen.queryByText(/venció el plazo/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cotizar de nuevo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar la oferta' })).not.toBeInTheDocument();
  });

  it('sin la condición NM: NO pinta los montos y NO deja aceptar (R2 no tiene excepción)', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ offer: offer({ terms: { perLineConditionLabel: '', consequence: '' } }) }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText('No podemos mostrarte la oferta completa')).toBeInTheDocument();
    expect(screen.queryByTestId('offer-amounts')).not.toBeInTheDocument();
    expect(screen.queryByText('MX$840.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar la oferta' })).not.toBeInTheDocument();
  });

  it('sin `offerDecision` por línea tampoco deja aceptar: el desglose diría a medias qué compramos', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ offer: offer({ lines: [line({ id: 'a', quotedPriceCents: 84000 })] }) }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText('No podemos mostrarte la oferta completa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar la oferta' })).not.toBeInTheDocument();
  });

  it('404: mensaje neutro que no confirma que la solicitud exista', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockRejectedValue(
      new ApiClientError(404, { code: 'NOT_FOUND', message: 'not found' }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-ajena" />);

    expect(await screen.findByText('No encontramos esta solicitud')).toBeInTheDocument();
    // Nada que insinúe «existe pero no es tuya».
    expect(screen.queryByText(/otro usuario|no es tuya|sin permiso/i)).not.toBeInTheDocument();
  });

  it('SIN sesión no consulta el endpoint: invita a entrar (el CTA del correo no acepta)', async () => {
    const spy = vi.spyOn(api, 'getSellRequest');
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText('Entra con tu cuenta para ver tu oferta')).toBeInTheDocument();
    expect(
      screen.getByText(/esta oferta no se acepta desde un enlace del correo/),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    // Y vuelve aquí después de entrar.
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/login?next=%2Fbuylist%2Frequests%2Fsr-1',
    );
  });

  it('`expirada + no_offer`: se listan las cartas SIN una sola cifra (una deuda que no existe)', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({
        status: 'expirada',
        expiredReason: 'no_offer',
        isTerminal: true,
        offer: null,
        // Un backend anterior podría seguir mandando la cifra: el segundo cinturón la ignora.
        items: [line({ id: 'a', quotedPriceCents: 120000 })],
      }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText('No procedimos con la oferta.')).toBeInTheDocument();
    expect(screen.getByText('Charizard VMAX')).toBeInTheDocument();
    expect(screen.queryByText('MX$1,200.00')).not.toBeInTheDocument();
  });

  it('`expirada` sin motivo: fallback NEUTRO, nunca la versión que acusa de no haber enviado', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({ status: 'expirada', expiredReason: null, isTerminal: true, offer: null }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(await screen.findByText('Esta oferta ya no está vigente.')).toBeInTheDocument();
    expect(screen.queryByText(/Se venció el plazo para enviar/)).not.toBeInTheDocument();
  });

  /**
   * Paridad ES/EN **en la pantalla**, no solo en el catálogo: el test de paridad de claves no
   * detecta una clave que exista en los dos idiomas y no se use, ni una cadena en duro.
   * ⚠️ La condición NM y el bloque de consecuencia siguen saliendo EN ESPAÑOL aquí a propósito:
   * son DATO del servidor (`offer.terms`, renderizado con el `User.locale`), y esta fixture
   * simula un vendedor con `locale='es'` mirando la app en inglés. Que no se traduzcan en el
   * front **es la propiedad**: una traducción local sería la segunda plantilla que rompe el
   * espejo con el correo.
   */
  it('EN: la pantalla existe entera en inglés (paridad, y los términos siguen siendo DATO)', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(detail());
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />, 'en');

    expect(await screen.findByRole('button', { name: 'Accept the offer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline the offer' })).toBeInTheDocument();
    expect(screen.getByText('Deposited to you')).toBeInTheDocument();
    expect(screen.getByText('Shipping we provide')).toBeInTheDocument();
    expect(screen.getByText("We don\u2019t buy (1)")).toBeInTheDocument();
    expect(screen.getByText(/Its cost, MX\$180\.00, is a flat fee/)).toBeInTheDocument();
    expect(screen.getByText(/You have until .*September 3, 2026/)).toBeInTheDocument();
    // Ni una clave cruda en pantalla.
    expect(document.body.textContent).not.toMatch(/buylist\.offer\./);
  });

  it('la oferta cancelada se dice en el portal (el correo 5 no puede quedar sin espejo)', async () => {
    asSeller();
    vi.spyOn(api, 'getSellRequest').mockResolvedValue(
      detail({
        status: 'cotizada',
        offer: null,
        lastOfferCancelledAt: '2026-09-01T20:00:00.000Z',
      }),
    );
    renderWithProviders(<SellRequestDetailView sellRequestId="sr-1" />);

    expect(
      await screen.findByText(/Te mandamos una oferta y la cancelamos el/),
    ).toBeInTheDocument();
  });
});
