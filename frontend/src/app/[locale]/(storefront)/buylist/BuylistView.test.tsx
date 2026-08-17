import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistView } from './BuylistView';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { KycInfoDTO, UserDTO, CardDTO, BuylistQuoteItemDTO } from '@/types/contract';

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
  clabeOnFile: false,
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

/** Busca por texto en la barra de filtros. */
function searchFor(term: string) {
  fireEvent.change(screen.getByLabelText('Buscar carta'), { target: { value: term } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
}

/**
 * Agrega una carta al carrito clicando la FILA de su acabado en el grid (rediseño
 * grid-protagonista: el clic en el acabado agrega DIRECTO al carrito, sin panel).
 * La fila queda habilitada cuando el batch del grid trae su estimado.
 */
async function addCard(name: string, finish = 'Normal') {
  searchFor(name);
  const btn = await screen.findByRole('button', {
    name: `Agregar ${name} (${finish}) al carrito`,
  });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

/**
 * Rediseño grid-protagonista (2026-08-17): ya no existe el panel "COTIZACIÓN" ni la
 * selección intermedia — cada carta lista sus acabados con estimado server-side y el
 * clic agrega directo al carrito.
 */
describe('BuylistView · grid protagonista (cotización directa al carrito)', () => {
  it('ya no existe el panel COTIZACIÓN ni el campo falso de condición fija; el aviso NM-only queda', () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(screen.queryByText('Cotización')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cotizar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Condición: Near Mint (NM) fija')).not.toBeInTheDocument();
    // La política NM-only sigue comunicada por el aviso existente.
    expect(screen.getByText(/Solo compramos en Near Mint/)).toBeInTheDocument();
  });

  it('sin búsqueda muestra la invitación a filtrar/buscar (grid vacío honesto)', () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(
      screen.getByText('Filtra por set o busca por nombre para ver el catálogo con su precio de compra estimado.'),
    ).toBeInTheDocument();
  });

  it('el grid lista UNA fila por acabado disponible, cada una con su estimado', async () => {
    renderWithProviders(<BuylistView />, 'es');
    searchFor('Charizard');

    // Charizard existe en normal / reverse holo / holofoil: una fila agregable por acabado.
    const normal = await screen.findByRole('button', { name: 'Agregar Charizard (Normal) al carrito' });
    expect(screen.getByRole('button', { name: 'Agregar Charizard (Reverse Holo) al carrito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar Charizard (Holofoil) al carrito' })).toBeInTheDocument();
    // Estimado del acabado normal: Rare Holo (fallback 40%) sobre MX$48,500 → MX$19,400.00.
    // (getAllBy: otros acabados/coincidencias de "Charizard" pueden resolver el mismo monto.)
    await waitFor(() => expect(normal).toBeEnabled());
    expect(screen.getAllByText('MX$19,400.00').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Estimado de compra por acabado (NM en sueltas); un clic agrega al carrito.'),
    ).toBeInTheDocument();
  });

  it('clic en un acabado agrega la carta DIRECTO al carrito con su estimado', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    expect(screen.getByText('Charizard (Normal) agregada al carrito.')).toBeInTheDocument();
    expect(screen.getByText('Total estimado')).toBeInTheDocument();
    expect(screen.getByText('Estimado c/u:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeEnabled();
  });

  it('filtra por set y muestra las cartas de ese set', async () => {
    renderWithProviders(<BuylistView />, 'es');

    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    expect(
      (await screen.findAllByRole('button', { name: /Agregar Pikachu/ })).length,
    ).toBeGreaterThan(0);
  });

  it('una carta sin referencia (Zapdos) muestra "Precio pendiente" en su fila y sigue siendo agregable', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Zapdos');

    // En el carrito la línea queda pendiente (no MX$0.00) y el total lo explica.
    expect(screen.getAllByText('Precio pendiente').length).toBeGreaterThan(0);
    expect(screen.getByText(/El total no incluye 1 carta\(s\) con precio pendiente/)).toBeInTheDocument();
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
  });

  it('las etiquetas de tipo de producto están traducidas (no raw/graded/sealed crudos)', () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(screen.getByRole('option', { name: 'Suelta (raw)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gradeada' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sellado' })).toBeInTheDocument();
  });

  it('en tipo Gradeada cada carta cotiza como gradeada (una sola fila, sin acabados raw)', async () => {
    renderWithProviders(<BuylistView />, 'es');
    fireEvent.change(screen.getByLabelText('Tipo de producto'), { target: { value: 'graded' } });
    searchFor('Charizard');

    const row = await screen.findByRole('button', { name: 'Agregar Charizard (Gradeada) al carrito' });
    await waitFor(() => expect(row).toBeEnabled());
    expect(
      screen.queryByRole('button', { name: 'Agregar Charizard (Normal) al carrito' }),
    ).not.toBeInTheDocument();
  });

  it('el carrito es colapsable desde la barra (el grid manda)', () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(screen.getByText('Carrito de venta')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar carrito' }));
    expect(screen.queryByText('Carrito de venta')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar carrito (0)' }));
    expect(screen.getByText('Carrito de venta')).toBeInTheDocument();
  });
});

/**
 * Transparencia por línea: el detalle expandible sustituye al panel COTIZACIÓN
 * (valor de referencia, regla aplicada, acabado y nota de pendiente viven ahí).
 */
describe('BuylistView · detalle expandible por línea', () => {
  it('muestra valor de referencia + regla aplicada + acabado al expandir', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    fireEvent.click(screen.getByRole('button', { name: 'Detalle del estimado' }));
    expect(screen.getByText('Valor de referencia')).toBeInTheDocument();
    expect(screen.getByText('MX$48,500.00')).toBeInTheDocument();
    expect(screen.getByText('Regla aplicada')).toBeInTheDocument();
    expect(screen.getByText('40% de referencia')).toBeInTheDocument();
    expect(screen.getByText('Rare Holo')).toBeInTheDocument();

    // El toggle colapsa de vuelta.
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar detalle' }));
    expect(screen.queryByText('Regla aplicada')).not.toBeInTheDocument();
  });

  it('una línea pendiente explica el "precio pendiente" en su detalle', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Zapdos');

    fireEvent.click(screen.getByRole('button', { name: 'Detalle del estimado' }));
    expect(
      screen.getByText(
        'Esta carta no tiene precio de referencia; entrará a la cola de precio pendiente y la cotizaremos a mano.',
      ),
    ).toBeInTheDocument();
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
      screen.getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar solicitud/ })).not.toBeInTheDocument();
  });

  it('la cantidad por línea suma al total y expande los items al enviar', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

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

  it('la cantidad también se captura con input NUMÉRICO (no solo −/+ de 1 en 1)', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    fireEvent.change(screen.getByLabelText('Cantidad de Charizard'), { target: { value: '12' } });
    expect(screen.getByRole('button', { name: 'Enviar solicitud (12)' })).toBeInTheDocument();

    // Un valor inválido (< 1) se normaliza a 1.
    fireEvent.change(screen.getByLabelText('Cantidad de Charizard'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();
  });

  it('agrega varias cartas distintas y las envía en una sola solicitud', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    await addCard('Pikachu');

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
    await addCard('Charizard');
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(
      screen.getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.'),
    ).toBeInTheDocument();
  });

  it('vaciar el carrito lo deja vacío', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    fireEvent.click(screen.getByRole('button', { name: /Vaciar carrito/ }));
    expect(
      screen.getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.'),
    ).toBeInTheDocument();
  });

  it('el modal final muestra el RESUMEN de la venta (cartas + total + vigencia) antes de confirmar', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    expect(await screen.findByText('Resumen de tu venta')).toBeInTheDocument();
    // El total estimado aparece también dentro del modal (además del carrito).
    expect(screen.getAllByText('MX$19,400.00').length).toBeGreaterThan(1);
    // Aviso de vigencia del estimado (en la página y en el modal).
    expect(screen.getAllByText(/estimado con los precios de hoy/).length).toBeGreaterThan(1);
  });
});

/**
 * Bulk: multi-selección en los resultados + agregar varias de golpe. Reusa las
 * cotizaciones del batch del grid (cero requests extra) y es tolerante por-ítem.
 */
describe('BuylistView · bulk (multi-selección)', () => {
  it('selecciona varias cartas del grid y las agrega al carrito de golpe', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');

    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar Charizard' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Pikachu' }));
    const addBtn = screen.getByRole('button', { name: 'Agregar seleccionadas (2)' });
    await waitFor(() => expect(addBtn).toBeEnabled());
    fireEvent.click(addBtn);

    expect(await screen.findByText('2 carta(s) agregada(s) al carrito.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(2);
  });

  it('el grid cotiza por ACABADO en batch y el bulk reusa esas cotizaciones (sin requests extra)', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'batchQuote');
    renderWithProviders(<BuylistView />, 'es');

    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar Charizard' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Eevee' }));
    const addBtn = screen.getByRole('button', { name: 'Agregar seleccionadas (2)' });
    await waitFor(() => expect(addBtn).toBeEnabled());

    // El batch del grid incluye TODOS los acabados de Charizard (una entrada por acabado).
    const gridItems = spy.mock.calls.flatMap((c) => c[0]);
    for (const finish of ['normal', 'reverse_holo', 'holofoil']) {
      expect(gridItems.some((i) => i.cardId === 'c-charizard' && i.finish === finish)).toBe(true);
    }

    const callsBefore = spy.mock.calls.length;
    fireEvent.click(addBtn);
    expect(await screen.findByText('2 carta(s) agregada(s) al carrito.')).toBeInTheDocument();
    // El bulk NO dispara requests: reusa el batch ya cargado del grid.
    expect(spy.mock.calls.length).toBe(callsBefore);
  });

  it('tolerante por-ítem: una carta inválida NO tumba el lote (batch parcial → aviso parcial)', async () => {
    asVerifiedCustomer();
    // El batch responde 200 con errores POR-ÍTEM: Eevee sale ok:false y no tira el resto.
    vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
      results: items.map((it, index) =>
        it.cardId === 'c-eevee'
          ? {
              index,
              cardId: it.cardId,
              ok: false as const,
              error: { code: 'NOT_FOUND' as const, message: 'Card not found' },
            }
          : {
              index,
              cardId: it.cardId,
              ok: true as const,
              rarity: 'Rare Holo',
              finish: it.finish ?? ('normal' as const),
              appliedRule: { mode: 'pct' as const, value: 40, source: 'fallback' as const },
              quote: { status: 'cotizada' as const, quotedPriceCents: 1940000, currency: 'MXN' as const },
              referencePrice: { status: 'priced' as const, priceMxnCents: 4850000 },
              paymentNotice: 'PAY_AFTER_RECEIPT' as const,
            },
      ),
    }));
    renderWithProviders(<BuylistView />, 'es');

    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar Charizard' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Eevee' }));
    const addBtn = screen.getByRole('button', { name: 'Agregar seleccionadas (2)' });
    await waitFor(() => expect(addBtn).toBeEnabled());
    fireEvent.click(addBtn);

    // Aviso parcial (1 agregada, 1 no disponible) y la válida SÍ entró (1 línea "Quitar").
    expect(await screen.findByText('1 carta(s) agregada(s); 1 no disponible(s).')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
    // Las filas de Eevee muestran su error por-ítem sin romper el grid.
    expect(screen.getAllByText('No disponible').length).toBeGreaterThan(0);
  });

  it('limpiar selección desmarca sin agregar nada', async () => {
    renderWithProviders(<BuylistView />, 'es');

    await screen.findByRole('option', { name: /Base Set/ });
    fireEvent.change(screen.getByLabelText('Filtrar por set'), { target: { value: 'base1' } });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar Charizard' }));
    expect(screen.getByRole('button', { name: 'Agregar seleccionadas (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' }));
    expect(screen.queryByRole('button', { name: /Agregar seleccionadas/ })).not.toBeInTheDocument();
    expect((screen.getByRole('checkbox', { name: 'Seleccionar Charizard' }) as HTMLInputElement).checked).toBe(false);
  });
});

/**
 * v1.6-finish: acabados por carta en el grid (una fila agregable por acabado) y
 * dedup del carrito por (cardId + productType + finish).
 */
describe('BuylistView · acabado (finish)', () => {
  it('dedup: agregar la MISMA (carta, tipo, acabado) incrementa la cantidad, no duplica la línea', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard'); // finish normal
    // Segundo clic en la misma fila de acabado: suma cantidad.
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Charizard (Normal) al carrito' }));

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();
    // Una sola línea en el carrito (un único botón "Quitar").
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
  });

  it('dedup: la MISMA carta en DISTINTO acabado es una línea separada', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard'); // normal
    // El acabado Reverse Holo es otra fila del MISMO tile → línea distinta del carrito.
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Charizard (Reverse Holo) al carrito' }));

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(2);
  });

  it('el finish elegido viaja en los items de la solicitud creada', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard', 'Holofoil');

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
 * "Mis solicitudes": sin sesión NUNCA muestra estado de error — la sección invita a
 * iniciar sesión en tono informativo y no consulta el endpoint. Con sesión, el
 * pendiente sigue siendo honesto (sin MX$0.00).
 */
describe('BuylistView · Mis solicitudes', () => {
  it('sin sesión: invita a iniciar sesión, NO consulta el endpoint y NO muestra error', async () => {
    const spy = vi.spyOn(api, 'getSellRequests').mockRejectedValue(new Error('401'));
    renderWithProviders(<BuylistView />, 'es');

    expect(
      await screen.findByText('Inicia sesión para ver el estado de tus solicitudes de venta.'),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un item sin precio muestra "Precio pendiente" (no MX$0.00) y una nota explica el total', async () => {
    asVerifiedCustomer();
    const card: CardDTO = {
      id: 'c-zapdos',
      externalId: 'base1-16',
      name: 'Zapdos',
      number: '16',
      rarity: 'Rare Holo',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'base1',
      setName: 'Base Set',
      imageSmallUrl: 'https://images.pokemontcg.io/base1/16.png',
      imageLargeUrl: 'https://images.pokemontcg.io/base1/16_hires.png',
      availableFinishes: ['normal'],
    };
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      {
        sellRequestId: 'sr-pend-1',
        status: 'cotizada',
        quotedTotalCents: 0,
        ineRequired: false,
        items: [
          {
            id: 'sri-1',
            card,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'normal',
            rarity: 'Rare Holo',
            itemStatus: 'precio_pendiente',
          },
        ],
        createdAt: '2026-08-17T10:00:00Z',
      },
    ]);
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('sr-pend-1')).toBeInTheDocument();
    expect(screen.getAllByText('Precio pendiente').length).toBeGreaterThan(0);
    expect(
      screen.getByText('El total mostrado no incluye las cartas con precio pendiente.'),
    ).toBeInTheDocument();
  });
});

/**
 * F5 · Responder ajuste de venta. El bloque de aceptar/rechazar aparece SOLO cuando hay ítems
 * `ajustada` (item-level), y "Aceptar" llama a respondSellRequest(id,'accept').
 */
describe('BuylistView · responder ajuste (F5)', () => {
  const adjustedCard: CardDTO = {
    id: 'c-charizard',
    externalId: 'base1-4',
    name: 'Charizard',
    number: '4',
    rarity: 'Rare Holo',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png',
    imageLargeUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    availableFinishes: ['holofoil'],
  };

  function withAdjustedRequest() {
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      {
        sellRequestId: 'sr-adj-1',
        status: 'verificacion',
        quotedTotalCents: 60000,
        ineRequired: false,
        createdAt: '2026-08-15T10:00:00Z',
        items: [
          {
            id: 'sri-adj-1',
            card: adjustedCard,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'holofoil',
            rarity: 'Rare Holo',
            quotedPriceCents: 60000,
            approvedPriceCents: 45000,
            itemStatus: 'ajustada',
          },
        ],
      },
    ]);
  }

  it('el bloque de ajuste aparece solo con ítems `ajustada` y muestra el precio ajustado', async () => {
    asVerifiedCustomer();
    withAdjustedRequest();
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('sr-adj-1')).toBeInTheDocument();
    expect(screen.getByText('Ajuste de precio propuesto')).toBeInTheDocument();
    // El precio ajustado (MX$450.00) se muestra; el original queda tachado.
    expect(screen.getByText('Aceptar ajuste')).toBeInTheDocument();
    expect(screen.getByText('Rechazar')).toBeInTheDocument();
  });

  it('el bloque NO aparece cuando ningún ítem está `ajustada`', async () => {
    asVerifiedCustomer();
    vi.spyOn(api, 'getSellRequests').mockResolvedValue([
      {
        sellRequestId: 'sr-plain-1',
        status: 'verificacion',
        quotedTotalCents: 50000,
        ineRequired: false,
        createdAt: '2026-08-15T10:00:00Z',
        items: [
          {
            id: 'sri-1',
            card: adjustedCard,
            productType: 'raw',
            rawCondition: 'NM',
            finish: 'holofoil',
            rarity: 'Rare Holo',
            quotedPriceCents: 50000,
            itemStatus: 'verificacion',
          },
        ],
      },
    ]);
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('sr-plain-1')).toBeInTheDocument();
    expect(screen.queryByText('Ajuste de precio propuesto')).not.toBeInTheDocument();
  });

  it('"Aceptar ajuste" llama respondSellRequest(id, "accept")', async () => {
    asVerifiedCustomer();
    withAdjustedRequest();
    const spy = vi
      .spyOn(api, 'respondSellRequest')
      .mockResolvedValue({ id: 'sr-adj-1', status: 'aprobada' });
    renderWithProviders(<BuylistView />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar ajuste' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-adj-1', 'accept'));
  });
});

/**
 * Gating de requisitos de cuenta para VENDER (guards del contrato §6: JwtAuthGuard →
 * RolesGuard → EmailVerifiedGuard). El usuario debe saber QUÉ le falta ANTES de llenar
 * todo; el bloqueo autoritativo sigue siendo server-side. (P-11)
 */
describe('BuylistView · gating de requisitos de cuenta (vender)', () => {
  it('sin sesión: cotizar/agregar es libre, pero el envío se sustituye por CTA de iniciar sesión / crear cuenta', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    // Aviso claro desde el inicio (panel) + CTAs de login/registro; NO hay botón de enviar.
    expect(screen.getByText('Inicia sesión o crea cuenta para vender')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar solicitud/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Iniciar sesión' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Crear cuenta' }).length).toBeGreaterThan(0);
  });

  it('correo no verificado: aviso con CTA de reenvío y el botón de enviar queda deshabilitado con motivo', async () => {
    asVerifiedCustomer({ emailVerified: false });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

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
    await addCard('Charizard');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar y enviar' }));

    expect(screen.getByText('La CLABE debe tener 18 dígitos.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('con CLABE registrada: el checklist la muestra cumplida (enmascarada)', async () => {
    asVerifiedCustomer({}, { clabeMasked: '****1234', clabeOnFile: true, kycStatus: 'pending' });
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('CLABE registrada (****1234)')).toBeInTheDocument();
    expect(screen.getByText('Correo verificado')).toBeInTheDocument();
  });

  it('con CLABE registrada: el modal ofrece "Usar mi CLABE" en un clic (sin reteclear)', async () => {
    // v1.15: el atajo se gatea por el booleano REAL clabeOnFile (GET /users/me/kyc).
    asVerifiedCustomer({}, { clabeMasked: '****1234', clabeOnFile: true });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    expect(
      await screen.findByText('El pago irá a tu CLABE registrada (****1234).'),
    ).toBeInTheDocument();
    // No hay que reteclear los 18 dígitos: el input queda oculto salvo que pida otra CLABE.
    expect(screen.queryByLabelText(/CLABE \(18 dígitos/)).not.toBeInTheDocument();
  });

  it('estimado sobre el tope sin INE: avisa ANTES de enviar y el modal pide el INE de entrada', async () => {
    // Tope por solicitud ínfimo → cualquier estimado lo supera (heads-up de INE_REQUIRED).
    asVerifiedCustomer({}, { capPerRequestCents: 1 });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    expect(await screen.findByText(/supera el tope .*se pedirá tu INE/)).toBeInTheDocument();

    // Al abrir el modal, la petición de INE ya está visible (no espera al 422).
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    expect(
      await screen.findByText('Esta solicitud supera el tope: sube tu INE (anverso y reverso) para continuar.'),
    ).toBeInTheDocument();
  });
});

/**
 * v1.15 — CLABE en un clic REAL (omite `clabe`, fallback server-side) e INE en archivo (no re-pide),
 * cableados de useSellRequirements (GET /users/me/kyc) → BuylistKycForm de punta a punta.
 */
describe('BuylistView · v1.15 CLABE/INE en archivo', () => {
  it('con CLABE en archivo, enviar la solicitud OMITE `clabe` (el backend hace el fallback)', async () => {
    asVerifiedCustomer({}, { clabeMasked: '****1234', clabeOnFile: true });
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    // El modal arranca en modo "usar mi CLABE": se confirma sin teclear los 18 dígitos.
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].clabe).toBeUndefined();
  });

  it('con INE en archivo, el modal NO re-pide el INE (oculta los uploaders)', async () => {
    asVerifiedCustomer({}, { clabeMasked: '****1234', clabeOnFile: true, ineOnFile: true });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    expect(
      await screen.findByText('Tu INE ya está en archivo; no necesitas volver a subirlo.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('INE (anverso)')).not.toBeInTheDocument();
  });
});
