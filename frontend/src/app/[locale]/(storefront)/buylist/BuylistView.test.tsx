import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistView } from './BuylistView';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import type { KycInfoDTO, UserDTO, CardDTO, BuylistQuoteItemDTO } from '@/types/contract';
// ⚠️ El spy HACE DE SERVIDOR: `isTerminal` es **server-derived** (contrato §6 · v1.51). Se
// proyecta con la MISMA función que el mock en vez de escribir el booleano a mano, para no
// reintroducir en las pruebas la copia local del set terminal.
import { mockSellRequestDTO as srv } from '@/lib/mock/fixtures';

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

/**
 * v1.21-cotizador-master-set: en `raw` (default de BuylistView) el grid YA NO es un buscador
 * plano — es el binder COMPARTIDO de Master Set (mode="quoter", §4.20f): primero se elige un
 * set ("Buscar set", MasterSetIndex) y luego se ve su binder con una CASILLA de imagen por
 * acabado real de la carta (nunca un chip de texto). `openBaseSet` navega hasta "Base Set"
 * (donde viven los fixtures Charizard/Pikachu/Zapdos/Eevee); es un no-op si el binder ya
 * está abierto (permite encadenar `addCard` sin re-navegar).
 */
async function openBaseSet() {
  const searchSet = screen.queryByLabelText('Buscar set');
  if (!searchSet) return; // el binder ya está abierto (índice ya no está en pantalla).
  fireEvent.change(searchSet, { target: { value: 'Base' } });
  fireEvent.click(await screen.findByRole('button', { name: /Base Set/ }));
}

/**
 * Agrega una carta al carrito clicando su CASILLA de acabado en el binder Master Set
 * (rediseño v1.21: el clic en la casilla agrega DIRECTO al carrito, mismo espíritu que el
 * grid anterior — sin panel intermedio). La casilla queda habilitada cuando su cotización
 * (batch client-side de MasterSetBinder) resuelve.
 */
/**
 * v1.51.3 (D36/D37): crear la solicitud exige `addressId`. La libreta mock trae una dirección
 * predeterminada, así que el modal la PRESELECCIONA — pero llega por red: los tests esperan al
 * `Select` antes de confirmar. (Que el id viaje explícito lo verifica BuylistKycForm.test.)
 */
async function pickAddress() {
  const select = (await screen.findByLabelText('Dirección de origen')) as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe('addr-1'));
}

async function addCard(name: string, finish = 'Normal') {
  await openBaseSet();
  const btn = await screen.findByRole('button', {
    name: new RegExp(`^Agregar ${name} \\(${finish}\\) a la venta`),
  });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

/**
 * v1.29 Stream C (P-16, §18.4): el carrito YA NO es columna lateral siempre visible — vive
 * en un DRAWER flotante disparado por el FAB. Agregar desde la grilla NO lo abre (no
 * interrumpe el flujo de seguir cotizando); los asserts sobre el contenido del carrito
 * (líneas, total, CTA de enviar, requisitos de venta) deben abrirlo primero.
 */
function openCart() {
  fireEvent.click(screen.getByTestId('sell-cart-fab'));
}

describe('BuylistView · raw = binder Master Set (mode="quoter", v1.21)', () => {
  it('sin elegir set, el binder invita a buscar uno (grid vacío honesto)', () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(screen.getByLabelText('Buscar set')).toBeInTheDocument();
  });

  it('cada carta lista SUS casillas de acabado (una por finish real), cada una con su estimado', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await openBaseSet();

    // Charizard existe en normal / reverse holo / holofoil: una casilla agregable por acabado.
    const normal = await screen.findByRole('button', { name: /^Agregar Charizard \(Normal\) a la venta/ });
    expect(
      screen.getByRole('button', { name: /^Agregar Charizard \(Reverse Holo\) a la venta/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Agregar Charizard \(Holofoil\) a la venta/ }),
    ).toBeInTheDocument();
    // Estimado del acabado normal: la CURVA de compra sobre el mercado del acabado. El mercado
    // (MX$48,500) queda por encima del último punto ⇒ tramo plano final 50% ⇒ MX$24,250.00.
    // La rareza NO interviene en el monto (criterio 84).
    // N-16 rejilla plana: el botón "Agregar" es su propia acción; el precio va en su etiqueta
    // accesible (aria-label) y en el renglón mono de la tarjeta, no dentro del texto del botón.
    await waitFor(() => expect(normal).toBeEnabled());
    expect(normal.getAttribute('aria-label')).toContain('MX$24,250.00');
  });

  it('clic en una casilla agrega la carta DIRECTO al carrito con su estimado', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');

    // §18.4a: agregar desde la grilla NO abre el drawer; anuncia por role="status" y
    // el contador del FAB cambia.
    expect(screen.getByText('Charizard (Normal) agregada al carrito.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('sell-cart-fab')).toHaveAttribute(
      'aria-label',
      'Carrito de venta, 1 carta(s)',
    );

    openCart();
    expect(screen.getByText('Valor de tus cartas')).toBeInTheDocument();
    expect(screen.getByText('Estimado c/u:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeEnabled();
  });

  it('P-14 (§18.5): la línea del carrito y el resumen del modal pintan el FinishMark (banda + etiqueta)', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard', 'Reverse Holo');
    openCart();

    const drawer = screen.getByRole('dialog', { name: 'Carrito de venta (1)' });
    // Banda decorativa + etiqueta mono del componente COMPARTIDO (§16.6), no texto plano.
    expect(within(drawer).getByTestId('finish-band')).toHaveAttribute('data-finish', 'reverse_holo');
    expect(within(drawer).getByText('Reverse')).toHaveAttribute('aria-label', 'Reverse Holo');

    // Mismo lenguaje en el resumen del modal de solicitud.
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    const modal = await screen.findByRole('dialog', { name: 'Crear solicitud de venta' });
    expect(within(modal).getByTestId('finish-band')).toHaveAttribute('data-finish', 'reverse_holo');
    expect(within(modal).getByText('Reverse')).toBeInTheDocument();
  });

  it('una carta sin referencia (Zapdos) muestra "Precio pendiente" en su casilla y sigue siendo agregable', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Zapdos', 'Holofoil');
    openCart();

    // §23.3h (v2.3.8): en el COTIZADOR la línea sin precio se rotula con la versalita
    // `SIN PRECIO` —no con el rótulo largo— y el total lo explica UNA vez, con el conteo.
    expect(screen.getAllByTestId('buylist-pending-label').length).toBeGreaterThan(0);
    expect(screen.getByTestId('buylist-pending-note')).toHaveTextContent(
      '1 carta todavía no tiene precio, así que no suma al total',
    );
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
  });

  it('una carta con un solo acabado muestra SOLO esa casilla (sin hueco vacío para los que no tiene)', async () => {
    renderWithProviders(<BuylistView />, 'es');
    // Pikachu ex (sv08, fixtures) tiene un único acabado disponible (holofoil).
    fireEvent.change(screen.getByLabelText('Buscar set'), { target: { value: 'Surging Sparks' } });
    fireEvent.click(await screen.findByRole('button', { name: /Surging Sparks/ }));

    // v1.28 (P-22): "Pikachu ex" también aparece en la vitrina Top Bounties de arriba, así que
    // se espera directo a la CASILLA agregable del binder (no al primer texto que coincida).
    await screen.findByRole('button', { name: /^Agregar Pikachu ex \(Holofoil\)/ });
    const shownFinishes = ['Normal', 'Reverse Holo', 'Holofoil'].filter((f) =>
      screen.queryByRole('button', { name: new RegExp(`^Agregar Pikachu ex \\(${f}\\)`) }),
    );
    expect(shownFinishes).toEqual(['Holofoil']);
  });

  it('P-16 (§18.4): el carrito vive en un DRAWER flotante tras el FAB (no columna lateral)', () => {
    renderWithProviders(<BuylistView />, 'es');

    // Cerrado por defecto; ya no existe el toggle textual «Ocultar/Mostrar carrito».
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ocultar carrito|Mostrar carrito/ })).not.toBeInTheDocument();

    // FAB vacío: sin badge, con aria-label «…, vacío» (acceso al panel de requisitos).
    const fab = screen.getByTestId('sell-cart-fab');
    expect(fab).toHaveAttribute('aria-label', 'Carrito de venta, vacío');
    expect(screen.queryByTestId('sell-cart-fab-badge')).not.toBeInTheDocument();

    // Abrir: drawer vacío ÚTIL (§18.6) — copy de carrito vacío dentro del diálogo.
    fireEvent.click(fab);
    const drawer = screen.getByRole('dialog', { name: 'Carrito de venta (0)' });
    expect(
      within(drawer).getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.'),
    ).toBeInTheDocument();

    // Cerrar con el botón: el diálogo desaparece y el foco regresa al FAB.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cerrar carrito' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fab).toHaveFocus();
  });
});

/**
 * Transparencia por línea: el detalle expandible del carrito lateral (BuylistView, sin
 * cambios) sigue mostrando valor de referencia / regla aplicada / acabado — ahora la
 * cotización llega del batch client-side del binder Master Set en vez del grid plano.
 */
describe('BuylistView · detalle expandible por línea', () => {
  it('muestra valor de referencia + rareza + acabado al expandir (SIN «regla aplicada», v2.0)', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    fireEvent.click(screen.getByRole('button', { name: 'Detalle del estimado' }));
    // P-44: la rareza ahora también se pinta en las tejas del binder → se acota el assert de
    // «Rare Holo» al diálogo del carrito (el detalle de la línea) para no chocar con las tejas.
    const cartDialog = screen.getByRole('dialog', { name: 'Carrito de venta (1)' });
    expect(within(cartDialog).getByText('Valor de referencia')).toBeInTheDocument();
    expect(within(cartDialog).getByText('MX$48,500.00')).toBeInTheDocument();
    // v2.0 (P-48): la fila «Regla aplicada» SE RETIRÓ — no hay reglas por rareza/acabado que
    // rotular, y dejarla habría sido texto falso (la clase de bug que P-48 existe para cerrar).
    expect(within(cartDialog).queryByText('Regla aplicada')).toBeNull();
    expect(within(cartDialog).queryByText('40% de referencia')).toBeNull();
    // La rareza SÍ sigue: es dato informativo del catálogo (ya no decide el monto).
    expect(within(cartDialog).getByText('Rare Holo')).toBeInTheDocument();

    // El toggle colapsa de vuelta.
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar detalle' }));
    expect(screen.queryByText('Valor de referencia')).not.toBeInTheDocument();
  });

  it('una línea pendiente explica el "precio pendiente" en su detalle', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Zapdos', 'Holofoil');
    openCart();

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
    openCart();
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
    openCart();

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
    await pickAddress();
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
    openCart();

    fireEvent.change(screen.getByLabelText('Cantidad de Charizard'), { target: { value: '12' } });
    expect(screen.getByRole('button', { name: 'Enviar solicitud (12)' })).toBeInTheDocument();

    // Un valor inválido (< 1) se normaliza a 1.
    fireEvent.change(screen.getByLabelText('Cantidad de Charizard'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();
  });

  // IMP-A (regresión): un número absurdo en el stepper reventaba TODA la página con
  // `RangeError: Invalid array length` (Array.from({ length }) en requestItems). Ahora la
  // cantidad se clampa a MAX_LINE_QUANTITY (999) y la vista sigue viva.
  it('una cantidad gigante en el stepper NO crashea: se clampa al tope (999)', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    expect(() =>
      fireEvent.change(screen.getByLabelText('Cantidad de Charizard'), {
        target: { value: '646180157000000004' },
      }),
    ).not.toThrow();

    // La página sigue montada (no «Application error») y la cantidad quedó topada en 999.
    expect(screen.getByRole('button', { name: 'Enviar solicitud (999)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cantidad de Charizard')).toHaveValue(999);
  });

  it('agrega varias cartas distintas y las envía en una sola solicitud', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    await addCard('Pikachu');
    openCart();

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (2)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
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
    openCart();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(
      screen.getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.'),
    ).toBeInTheDocument();
  });

  it('TL-C2: quitar la ÚNICA línea con el foco en «Quitar» deja el foco DENTRO del diálogo (el trap no se desengancha)', async () => {
    // Regresión del hallazgo: al desmontarse el botón enfocado, el foco caía a <body> y Tab
    // se escapaba detrás del scrim con el drawer abierto (el trap vivía solo en onKeyDown).
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    const remove = screen.getByRole('button', { name: 'Quitar' });
    remove.focus();
    fireEvent.click(remove);

    const dialog = screen.getByRole('dialog', { name: 'Carrito de venta (0)' });
    expect(
      screen.getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.'),
    ).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('TL-C2: «Vaciar la lista» con el foco en el botón también deja el foco DENTRO del diálogo', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    const clear = screen.getByRole('button', { name: /Vaciar la lista/ });
    clear.focus();
    fireEvent.click(clear);

    const dialog = screen.getByRole('dialog', { name: 'Carrito de venta (0)' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('vaciar el carrito lo deja vacío', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();
    fireEvent.click(screen.getByRole('button', { name: /Vaciar la lista/ }));
    expect(
      screen.getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.'),
    ).toBeInTheDocument();
  });

  it('el modal final muestra el RESUMEN de la venta (cartas + total + vigencia) antes de confirmar', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    // §18.4b: abrir el modal de solicitud CIERRA el drawer (un solo focus trap activo).
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    expect(await screen.findByText('Resumen de tu venta')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Carrito de venta (1)' })).not.toBeInTheDocument();
    // El total estimado aparece en el modal: línea (unitario × cantidad) + total.
    expect(screen.getAllByText('MX$24,250.00').length).toBeGreaterThan(1);
    // Aviso de vigencia del estimado (en la página y en el modal).
    expect(screen.getAllByText(/estimado con los precios de hoy/).length).toBeGreaterThan(1);
  });
});

/**
 * ⚠️ v1.53 (MONEY — contrato §6, ARCHITECTURE §4.40): EL COTIZADOR ES RAW-ONLY.
 *
 * Lo que se retiró (y por qué estos tests lo AFIRMAN en negativo): el selector «Tipo de producto»
 * ofrecía `raw | graded | sealed`, pero ningún DTO de buylist tuvo nunca dónde capturar QUÉ grado
 * es un slab — el backend caía a `graded:PSA:10`, el grado más caro, y cotizaba cualquier graduada
 * a ese precio. `PROJECT.md` §E, §K LOCKED y el criterio 61 nunca autorizaron esa compra. Con el
 * selector se fueron el grid plano de graded/sealed, su barra de filtros (set + texto) y el bulk.
 *
 * Estos casos son el CANDADO: si alguien vuelve a montar el selector (o el grid plano), se ponen
 * rojos. La guarda que manda sigue siendo server-side (`422 BUYLIST_RAW_ONLY`); esto es la UI.
 */
describe('BuylistView · v1.53 el cotizador compra RAW y solo raw (§4.40)', () => {
  it('NO existe selector de tipo de producto (con una sola opción, el control sobra)', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await screen.findByLabelText('Buscar set');
    expect(screen.queryByLabelText('Tipo de producto')).not.toBeInTheDocument();
    // Y ninguna de sus opciones queda suelta en la página (ni la de sueltas).
    expect(screen.queryByRole('option', { name: 'Gradeada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sellado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Suelta (raw)' })).not.toBeInTheDocument();
  });

  it('NO existe la barra de filtros del grid plano: la búsqueda es la del binder', async () => {
    renderWithProviders(<BuylistView />, 'es');
    // La que SÍ existe: «Buscar set» del índice de Master Set (mode="quoter").
    expect(await screen.findByLabelText('Buscar set')).toBeInTheDocument();
    // Las que se fueron con el grid plano de graded/sealed.
    expect(screen.queryByLabelText('Filtrar por set')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Buscar carta')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();
  });

  it('todo item de la solicitud creada viaja con productType "raw" (nunca graded/sealed)', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    await addCard('Pikachu');
    openCart();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (2)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    // v1.51.3 (D36/D37): crear exige `addressId` — se espera a que la libreta preseleccione.
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const items = spy.mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.productType === 'raw')).toBe(true);
  });

  it('BUYLIST_RAW_ONLY es error POR ÍTEM: una línea caída no tumba las cotizaciones vivas', async () => {
    asVerifiedCustomer();
    // El backend degrada por-ítem (HTTP 200): la línea de Charizard sale ok:false con el código
    // nuevo y TODAS las demás cotizan. Si el front lo tratara como fallo global, el binder se
    // quedaría sin una sola teja agregable — que es justo la razón por la que el contrato lo puso
    // por-ítem (§4.40.3.3: un lote de 50 con una mala debe dar 49 cotizaciones vivas).
    vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
      results: items.map((it, index) =>
        it.cardId === 'c-charizard'
          ? {
              index,
              cardId: it.cardId,
              ok: false as const,
              error: {
                code: 'BUYLIST_RAW_ONLY' as const,
                message: 'The buylist only accepts raw cards',
              },
            }
          : {
              index,
              cardId: it.cardId,
              ok: true as const,
              rarity: 'Rare Holo',
              finish: it.finish ?? ('normal' as const),
              priceBasis: 'market' as const,
              quote: { status: 'cotizada' as const, quotedPriceCents: 1940000, currency: 'MXN' as const },
              referencePrice: { status: 'priced' as const, priceMxnCents: 4850000 },
              paymentNotice: 'PAY_AFTER_RECEIPT' as const,
            },
      ),
    }));
    renderWithProviders(<BuylistView />, 'es');
    await openBaseSet();

    // La teja viva se cotiza y se puede agregar…
    const pikachu = await screen.findByRole('button', {
      name: /^Agregar Pikachu \(Normal\) a la venta/,
    });
    await waitFor(() => expect(pikachu).toBeEnabled());
    fireEvent.click(pikachu);
    openCart();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();

    // …y la caída se marca SOLO a sí misma: su teja queda inhábil, sin precio inventado.
    expect(
      screen.getByRole('button', { name: /^Agregar Charizard \(Normal\) a la venta/ }),
    ).toBeDisabled();
    expect(screen.getAllByText('No disponible').length).toBeGreaterThan(0);
  });
});

/**
 * v1.6-finish: acabados por carta (una casilla agregable por acabado, binder Master Set) y
 * dedup del carrito por (cardId + finish).
 */
describe('BuylistView · acabado (finish, raw)', () => {
  it('dedup: agregar la MISMA (carta, tipo, acabado) incrementa la cantidad, no duplica la línea', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard'); // finish normal
    // Segundo clic en la misma casilla de acabado: suma cantidad.
    fireEvent.click(screen.getByRole('button', { name: /^Agregar Charizard \(Normal\) a la venta/ }));

    // El contador del FAB suma PIEZAS (2), aunque sea una sola línea.
    expect(screen.getByTestId('sell-cart-fab')).toHaveAttribute(
      'aria-label',
      'Carrito de venta, 2 carta(s)',
    );
    openCart();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();
    // Una sola línea en el carrito (un único botón "Quitar").
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
  });

  it('dedup: la MISMA carta en DISTINTO acabado es una línea separada', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard'); // normal
    // El acabado Reverse Holo es otra casilla de LA MISMA carta → línea distinta del carrito.
    fireEvent.click(screen.getByRole('button', { name: /^Agregar Charizard \(Reverse Holo\) a la venta/ }));
    openCart();

    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(2);
  });

  it('el finish elegido viaja en los items de la solicitud creada', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard', 'Holofoil');
    openCart();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items.every((i) => i.finish === 'holofoil')).toBe(true);
  });
});

/**
 * §33.3 (Stream A): «Mis solicitudes» se MUDÓ a la pestaña Ventas de «Compras y ventas». En
 * /buylist queda UNA línea con sesión y, sin sesión, la invitación neutra de siempre — que
 * NUNCA consulta el endpoint ni muestra error. El enlace de entrar lleva `?next=/buylist`
 * (§33.11): el carrito de venta persiste y el usuario vuelve al cotizador.
 */
describe('BuylistView · Mis solicitudes (enlace a Ventas)', () => {
  it('sin sesión: invita a iniciar sesión con next=/buylist, NO consulta el endpoint y NO muestra error', async () => {
    const spy = vi.spyOn(api, 'getSellRequests').mockRejectedValue(new Error('401'));
    renderWithProviders(<BuylistView />, 'es');

    expect(
      await screen.findByText('Inicia sesión para ver el estado de tus solicitudes de venta.'),
    ).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // El primer «Iniciar sesión» es el de la invitación (el del carrito vive en el drawer).
    const invite = screen
      .getAllByRole('link', { name: 'Iniciar sesión' })
      .find((a) => a.getAttribute('href') === '/login?next=/buylist');
    expect(invite).toBeDefined();
  });

  it('con sesión: NO lista solicitudes aquí; enlaza «Ver el estado de mis solicitudes» → /orders?tab=ventas', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'getSellRequests').mockResolvedValue([]);
    renderWithProviders(<BuylistView />, 'es');

    const link = await screen.findByRole('link', { name: /Ver el estado de mis solicitudes/ });
    expect(link).toHaveAttribute('href', '/orders?tab=ventas');
    expect(screen.queryByRole('heading', { name: 'Mis solicitudes' })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * §33.11 / ARCHITECTURE §4.47.6 (P-55): el carrito de venta sobrevive al login y, al restaurarlo,
 * SUS PRECIOS SE VUELVEN A PEDIR. El precio persistido NO es autoridad («nunca inventes un
 * precio»): hasta que el batch vuelve, el total es «—» y el CTA está apagado con `aria-busy`.
 */
describe('BuylistView · carrito de venta restaurado (P-55)', () => {
  const storedLine = (cents: number) => ({
    id: 'line-1',
    card: { id: 'c-charizard', name: 'Charizard', number: '4' },
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    quote: {
      rarity: 'Rare Holo',
      finish: 'normal',
      priceBasis: 'market',
      quote: { status: 'cotizada', quotedPriceCents: cents, currency: 'MXN' },
      referencePrice: { status: 'priced', priceMxnCents: cents * 2 },
      paymentNotice: 'PAY_AFTER_RECEIPT',
    },
    quantity: 1,
  });

  function batchWith(cents: number, gate?: Promise<void>) {
    return vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => {
      if (gate) await gate;
      return {
        results: items.map((it, index) => ({
          index,
          cardId: it.cardId,
          ok: true as const,
          rarity: 'Rare Holo',
          finish: it.finish ?? ('normal' as const),
          priceBasis: 'market' as const,
          quote: { status: 'cotizada' as const, quotedPriceCents: cents, currency: 'MXN' as const },
          referencePrice: { status: 'priced' as const, priceMxnCents: cents * 2 },
          paymentNotice: 'PAY_AFTER_RECEIPT' as const,
        })),
      };
    });
  }

  it('mientras recotiza: «se conservó», total «—», CTA deshabilitado con aria-busy; luego el precio es el NUEVO', async () => {
    asVerifiedCustomer();
    window.localStorage.setItem(
      'tcg.sellCart',
      JSON.stringify({ lines: [storedLine(100000)], updatedAt: Date.now() - 1000 }),
    );
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const batch = batchWith(125000, gate);
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('Tu lista de venta se conservó: 1 carta(s).')).toBeInTheDocument();
    await waitFor(() => expect(batch).toHaveBeenCalled());
    openCart();
    // Lo desconocido no se afirma: «—», no la cifra vieja (MX$1,000.00 no aparece como total).
    expect(screen.getByTestId('sell-cart-total-requoting')).toHaveTextContent('—');
    const cta = screen.getByRole('button', { name: 'Enviar solicitud (1)' });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('aria-busy', 'true');

    release();
    // Al volver el batch: el total es el precio de HOY (1,250.00), el CTA vive y se explica el cambio.
    await waitFor(() => expect(screen.queryByTestId('sell-cart-total-requoting')).not.toBeInTheDocument());
    const money = screen.getByTestId('sell-cart-money');
    expect(money).toHaveTextContent('MX$1,250.00');
    expect(money).not.toHaveTextContent('MX$1,000.00');
    await waitFor(() => expect(cta).toBeEnabled());
    expect(cta).not.toHaveAttribute('aria-busy');
    expect(
      screen.getByText('Actualizamos tu lista con los precios de hoy: antes MX$1,000.00, ahora MX$1,250.00.'),
    ).toBeInTheDocument();
  });

  it('el batch se pide con las MISMAS (cardId, finish) guardadas y una línea caída se quita con aviso', async () => {
    asVerifiedCustomer();
    window.localStorage.setItem(
      'tcg.sellCart',
      JSON.stringify({
        lines: [storedLine(100000), { ...storedLine(3000), id: 'line-2', card: { id: 'c-gone', name: 'Missingno', number: '0' } }],
        updatedAt: Date.now() - 1000,
      }),
    );
    const batch = vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
      results: items.map((it, index) =>
        it.cardId === 'c-gone'
          ? { index, cardId: it.cardId, ok: false as const, error: { code: 'NOT_FOUND' as const, message: 'nope' } }
          : {
              index,
              cardId: it.cardId,
              ok: true as const,
              rarity: 'Rare Holo',
              finish: it.finish ?? ('normal' as const),
              priceBasis: 'market' as const,
              quote: { status: 'cotizada' as const, quotedPriceCents: 100000, currency: 'MXN' as const },
              referencePrice: { status: 'priced' as const, priceMxnCents: 200000 },
              paymentNotice: 'PAY_AFTER_RECEIPT' as const,
            },
      ),
    }));
    renderWithProviders(<BuylistView />, 'es');

    expect(await screen.findByText('Quitamos 1 carta(s) que ya no podemos cotizar.')).toBeInTheDocument();
    expect(batch).toHaveBeenCalledWith([
      { cardId: 'c-charizard', productType: 'raw', rawCondition: 'NM', finish: 'normal' },
      { cardId: 'c-gone', productType: 'raw', rawCondition: 'NM', finish: 'normal' },
    ]);
    openCart();
    expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeInTheDocument();
    expect(screen.queryByText('Missingno')).not.toBeInTheDocument();
  });

  it('si el batch falla: la lista se conserva, el CTA sigue apagado con motivo y «Reintentar» lo recupera', async () => {
    asVerifiedCustomer();
    window.localStorage.setItem(
      'tcg.sellCart',
      JSON.stringify({ lines: [storedLine(100000)], updatedAt: Date.now() - 1000 }),
    );
    const batch = vi.spyOn(api, 'batchQuote').mockRejectedValueOnce(new Error('network'));
    renderWithProviders(<BuylistView />, 'es');
    await screen.findByText('Tu lista de venta se conservó: 1 carta(s).');
    openCart();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos actualizar los precios. Reintenta.');
    const cta = screen.getByRole('button', { name: 'Enviar solicitud (1)' });
    expect(cta).toBeDisabled();
    expect(cta.getAttribute('aria-describedby')).toContain('sell-cart-requote-failed');
    expect(screen.getByText('Charizard')).toBeInTheDocument();

    batch.mockRestore();
    batchWith(100000);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(cta).toBeEnabled());
  });

  it('caducada (> 30 días): se vacía y lo dice; sin batch', async () => {
    asVerifiedCustomer();
    window.localStorage.setItem(
      'tcg.sellCart',
      JSON.stringify({ lines: [storedLine(100000)], updatedAt: Date.now() - 31 * 24 * 3600 * 1000 }),
    );
    const batch = vi.spyOn(api, 'batchQuote');
    renderWithProviders(<BuylistView />, 'es');
    expect(
      await screen.findByText('Tu lista de venta caducó y la vaciamos. Vuelve a cotizar tus cartas.'),
    ).toBeInTheDocument();
    expect(batch).not.toHaveBeenCalled();
    openCart();
    expect(screen.queryByRole('button', { name: /Enviar solicitud/ })).not.toBeInTheDocument();
  });

  it('los CTAs sin sesión del carrito llevan ?next=/buylist', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();
    const links = screen.getAllByRole('link', { name: 'Iniciar sesión' }).map((a) => a.getAttribute('href'));
    expect(links).toContain('/login?next=/buylist');
    const registers = screen.getAllByRole('link', { name: 'Crear cuenta' }).map((a) => a.getAttribute('href'));
    expect(registers).toContain('/register?next=/buylist');
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
    openCart();

    // Aviso claro en el drawer (panel de requisitos) + CTAs de login/registro; NO hay botón de enviar.
    expect(screen.getByText('Inicia sesión o crea cuenta para vender')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar solicitud/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Iniciar sesión' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Crear cuenta' }).length).toBeGreaterThan(0);
  });

  it('correo no verificado: aviso con CTA de reenvío y el botón de enviar queda deshabilitado con motivo', async () => {
    asVerifiedCustomer({ emailVerified: false });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

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
    openCart();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Reenviar correo de verificación' }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Te enviamos un nuevo correo de verificación.')).toBeInTheDocument();
  });

  it('sin CLABE registrada: el checklist la marca como requisito pendiente desde el inicio', async () => {
    asVerifiedCustomer({}, { clabeMasked: undefined });
    renderWithProviders(<BuylistView />, 'es');
    openCart();

    expect(await screen.findByText('Requisitos para cobrar')).toBeInTheDocument();
    expect(
      await screen.findByText(/CLABE a tu nombre \(18 dígitos\): requisito/),
    ).toBeInTheDocument();
  });

  it('sin CLABE: el modal exige capturarla y NO llama al backend si va vacía', async () => {
    asVerifiedCustomer({}, { clabeMasked: undefined });
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    await pickAddress();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar y enviar' }));

    expect(screen.getByText('La CLABE debe tener 18 dígitos.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('con CLABE registrada: el checklist la muestra cumplida (enmascarada)', async () => {
    asVerifiedCustomer({}, { clabeMasked: '****1234', clabeOnFile: true, kycStatus: 'pending' });
    renderWithProviders(<BuylistView />, 'es');
    openCart();

    expect(await screen.findByText('CLABE registrada (****1234)')).toBeInTheDocument();
    expect(screen.getByText('Correo verificado')).toBeInTheDocument();
  });

  it('con CLABE registrada: el modal ofrece "Usar mi CLABE" en un clic (sin reteclear)', async () => {
    // v1.15: el atajo se gatea por el booleano REAL clabeOnFile (GET /users/me/kyc).
    asVerifiedCustomer({}, { clabeMasked: '****1234', clabeOnFile: true });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

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
    openCart();

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
    openCart();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    // El modal arranca en modo "usar mi CLABE": se confirma sin teclear los 18 dígitos.
    await pickAddress();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].clabe).toBeUndefined();
  });

  it('con INE en archivo, el modal NO re-pide el INE (oculta los uploaders)', async () => {
    asVerifiedCustomer({}, { clabeMasked: '****1234', clabeOnFile: true, ineOnFile: true });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    expect(
      await screen.findByText('Tu INE ya está en archivo; no necesitas volver a subirlo.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('INE (anverso)')).not.toBeInTheDocument();
  });
});

/**
 * v1.30 (§4.29): productos SEPARADOS (deck_exclusive/promo) cotizables como LÍNEA PROPIA por
 * `productId`. Charizard (base1) trae en fixtures un Deck Exclusive holofoil (productId 90001).
 * El binder del cotizador lo pinta como su propia teja con botón «Agregar».
 */
describe('BuylistView · productos SEPARADOS por productId (v1.30 §4.29)', () => {
  /** Agrega un producto separado clicando su botón «Agregar» en el binder del cotizador. */
  async function addSeparateProduct(re: RegExp) {
    await openBaseSet();
    const btn = await screen.findByRole('button', { name: re });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
  }

  const DECK_EXCLUSIVE_RE = /^Agregar Charizard \(Deck Exclusive\) \(Deck Exclusive, Holofoil\) a la venta/;

  it('agregar un producto separado manda su productId a POST /buylist/requests', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addSeparateProduct(DECK_EXCLUSIVE_RE);
    openCart();

    // La línea del carrito usa el NOMBRE del producto (no el de la carta base).
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Charizard (Deck Exclusive)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const items = spy.mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    expect(items[0].cardId).toBe('c-charizard');
    expect(items[0].productId).toBe(90001);
  });

  it('dos líneas con el mismo (cardId, finish) pero distinto productId son DISTINTAS (no se fusionan)', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    // Set_base Charizard holofoil (sin productId) + Deck Exclusive holofoil (productId 90001).
    await addCard('Charizard', 'Holofoil');
    await addSeparateProduct(DECK_EXCLUSIVE_RE);
    openCart();

    // NO se fusionan en una sola línea con ×2: son DOS líneas → dos piezas.
    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (2)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const items = spy.mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    // Una línea es el set_base (sin productId) y la otra el producto separado (productId 90001).
    expect(items.filter((i) => i.productId == null)).toHaveLength(1);
    expect(items.filter((i) => i.productId === 90001)).toHaveLength(1);
    // Ambas comparten (cardId, finish) — la distinción es SOLO el productId.
    expect(items.every((i) => i.cardId === 'c-charizard' && i.finish === 'holofoil')).toBe(true);
  });

  it('una carta base (sin productId) sigue viajando SIN productId (retrocompatible)', async () => {
    asVerifiedCustomer();
    const spy = vi.spyOn(api, 'createSellRequest');
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud (1)' }));
    fireEvent.change(await screen.findByLabelText(/CLABE/), {
      target: { value: '002010077777777771' },
    });
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar y enviar' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const items = spy.mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBeUndefined();
  });
});

/**
 * P-42 · el carrito de venta en DESKTOP es un PANEL FIJO a la par del grid (no un drawer que
 * abre/cierra). El layout se decide con `matchMedia('(min-width: 1024px)')`; en jsdom el poly
 * devuelve `matches:false` (móvil) salvo que el test lo mockee a `true`.
 */
describe('BuylistView · P-42 carrito fijo (desktop) + sombreado', () => {
  /** Fuerza el media query de desktop; devuelve un restaurador. */
  function forceDesktop(): () => void {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  }

  it('en desktop el carrito se ve SIEMPRE lado a lado (sin FAB ni drawer): total y CTA visibles sin abrir nada', async () => {
    const restore = forceDesktop();
    try {
      asVerifiedCustomer();
      renderWithProviders(<BuylistView />, 'es');
      await addCard('Charizard');

      // No hay FAB ni drawer en desktop: el carrito es un panel persistente.
      expect(screen.queryByTestId('sell-cart-fab')).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // El total y el CTA de enviar están a la vista SIN necesidad de abrir el carrito.
      expect(screen.getByText('Valor de tus cartas')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeEnabled();
    } finally {
      restore();
    }
  });

  it('tras AGREGAR, la teja de esa (carta, acabado) se destaca como «En el carrito» (sombreado)', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await openBaseSet();
    // Antes de agregar, ninguna teja está marcada.
    expect(screen.queryByText('En el carrito')).not.toBeInTheDocument();

    await addCard('Charizard'); // acabado Normal
    // La teja del acabado agregado queda marcada (doble canal: texto + data-in-cart).
    expect(screen.getAllByText('En el carrito').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-in-cart="true"]')).not.toBeNull();
  });
});

/**
 * P-43 · click en la teja (imagen, no «AGREGAR») abre un pop-up de detalle con imagen grande y
 * datos; cierra con click fuera (backdrop) y Esc. AGREGAR sigue siendo su propia acción.
 */
describe('BuylistView · P-43 pop-up de detalle de la carta', () => {
  it('click en el arte abre el modal de detalle (rareza visible) y cierra con click fuera (backdrop)', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await openBaseSet();

    // El detalle es su PROPIO disparador, distinto del botón «Agregar».
    const detailBtn = await screen.findByRole('button', {
      name: 'Ver detalle de Charizard (Normal)',
    });
    fireEvent.click(detailBtn);

    const dialog = await screen.findByRole('dialog');
    // El detalle muestra la rareza de la carta (P-44) dentro del modal.
    expect(within(dialog).getByText('Rare Holo')).toBeInTheDocument();

    // Cierra con click FUERA (backdrop = el overlay que envuelve al diálogo).
    const overlay = dialog.parentElement as HTMLElement;
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('el modal de detalle también cierra con Esc (a11y)', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await openBaseSet();

    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Charizard (Normal)' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

/**
 * P-44 · la rareza se muestra en las tejas del cotizador (junto al acabado). El binder comparte
 * teja con el admin M1 / Master Set, así que la rareza aparece en todas.
 */
describe('BuylistView · P-44 rareza en las tejas', () => {
  it('las tejas del cotizador raw muestran la rareza de la carta (Rare Holo)', async () => {
    renderWithProviders(<BuylistView />, 'es');
    await openBaseSet();
    await screen.findByRole('button', { name: /^Agregar Charizard \(Normal\) a la venta/ });
    // La rareza se pinta en las tejas (una por acabado de Charizard).
    expect(screen.getAllByText('Rare Holo').length).toBeGreaterThan(0);
  });
});

/**
 * v1.51.4/v1.51.5 (D43) — EL COTIZADOR PIERDE LA ARITMÉTICA DEL ENVÍO Y CONSERVA EL FALTANTE.
 *
 * Lo que estos tests fijan, y por qué cada uno:
 *  - el bloque de dinero tiene UN SOLO monto (sin línea de envío, sin resta, sin neto, sin `≈`);
 *  - la nota de servicio es copy estático: se pinta con el carrito VACÍO y no espera a ningún dato;
 *  - el faltante del mínimo (criterio 132a) dice CUÁNTO falta y apaga el CTA;
 *  - si `GET /buylist/quote-policy` falla, la degradación es FAIL-OPEN (sin faltante, CTA vivo).
 */
describe('BuylistView · cotizador sin cifras de envío (D43) + faltante del mínimo (132a)', () => {
  const NOTE_ES =
    'Nosotros ponemos la guía de envío y su costo se descuenta siempre de lo que te pagamos: tú no pagas nada de tu bolsillo. El monto exacto va en la oferta, antes de que aceptes.';

  /**
   * §23.3g fila 1-bis (v2.3.2) — LA CABECERA. En móvil el carrito es un drawer CERRADO, así
   * que sin esta instancia un vendedor puede recorrer /buylist entera —hero, bounties, binder,
   * políticas, guía de empaque— sin leer nunca quién pone el envío. El render de prueba es
   * móvil (sin `matchMedia` de escritorio), así que esto es exactamente el caso de 390px.
   */
  it('SIN abrir el carrito, la regla del envío ya se lee en la CABECERA (§23.3g fila 1-bis)', () => {
    renderWithProviders(<BuylistView />, 'es');
    const notes = screen.getAllByTestId('buylist-shipping-note');
    expect(notes).toHaveLength(1); // el drawer está cerrado: esta es la de la cabecera
    // §23.14.7-7: la instancia se NOMBRA. «La primera que aparezca» es exactamente la
    // medición que documentó un defecto inexistente en el sistema de diseño.
    expect(notes[0]).toHaveAttribute('data-note-surface', 'buylist-header');
    expect(notes[0]).toHaveTextContent(NOTE_ES);
  });

  /**
   * §23.14.2b — el remanente de `trustShipping` se RETIRÓ. Decía «si una carta se rechaza por
   * no estar en NM, la devolución corre por tu cuenta (7 días)»: un eco degradado de
   * `nmOnlyBody`, que está arriba y lo dice con más detalle. Su hueco original (quién pone el
   * envío) no podía llenarse ahí — ese bloque es `text-muted` de 13px y §23.3c prohíbe contar
   * la regla de D16 en letra chica. El bloque de confianza baja a DOS párrafos.
   */
  it('el bloque de confianza del pie queda en DOS párrafos: sin el eco retirado de `trustShipping`', () => {
    renderWithProviders(<BuylistView />, 'es');
    expect(
      screen.queryByText('Si una carta se rechaza por no estar en NM, la devolución corre por tu cuenta (7 días).'),
    ).not.toBeInTheDocument();
    // Lo que sí sigue: el pago tras verificar (cierto bajo D2/D9) y la vigencia reescrita.
    expect(
      screen.getAllByText('El pago se realiza después de recibir y verificar tus cartas.').length,
    ).toBeGreaterThan(0);
    // §23.14.4b: se promete que el PRECIO no se mueve, nunca que el total no cambie.
    const validity = screen.getByText(/El precio vinculante es el de la oferta/);
    expect(validity).toHaveTextContent('ese precio ya no se mueve cuando recibimos tus cartas');
    expect(validity.textContent).not.toMatch(/precios vigentes al verificar/);
    // La condición NM sigue a la vista, en su sitio y con su detalle.
    expect(screen.getByText(/se devuelve si deseas \(a tu costo, 7 días\)/)).toBeInTheDocument();
  });

  it('la nota de servicio se pinta con el carrito VACÍO (copy estático: no espera a ningún dato)', () => {
    // Sin sesión y sin cotizar nada: el trato se explica antes de que agregar cueste algo.
    renderWithProviders(<BuylistView />, 'es');
    openCart();
    expect(screen.getByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.')).toBeInTheDocument();
    // §23.3g-bis (v2.3.8) — EXACTAMENTE UNA, y con el drawer abierto le toca al bloque de
    // dinero. Antes eran DOS (cabecera + carrito) y se declaraba «repetición aceptada»: dos
    // párrafos idénticos a 600px no refuerzan, son la firma de un error de render.
    const notes = screen.getAllByTestId('buylist-shipping-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveAttribute('data-note-surface', 'cart-money');
    expect(notes[0]).toHaveTextContent(NOTE_ES);
  });

  it('la nota sigue ahí aunque la política del cotizador FALLE (no se esqueletiza, no se condiciona)', async () => {
    vi.spyOn(api, 'getBuylistQuotePolicy').mockRejectedValue(new Error('network'));
    renderWithProviders(<BuylistView />, 'es');
    openCart();
    const notes = screen.getAllByTestId('buylist-shipping-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(NOTE_ES);
  });

  it('el bloque de dinero lleva UN SOLO monto: ni línea de envío, ni resta, ni neto, ni «≈»', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    const money = screen.getByTestId('sell-cart-money');
    // El único rótulo de monto del bloque (§23.12), y jamás uno que prometa depósito.
    expect(within(money).getByText('Valor de tus cartas')).toBeInTheDocument();
    await waitFor(() => expect(money.textContent?.match(/MX\$/g) ?? []).toHaveLength(1));
    expect(money.textContent).not.toMatch(/≈|%|recibir[íi]as|neto|te quedar[íi]an|env[íi]o que ponemos/i);
    // Y la nota vive DENTRO del bloque de dinero, sin caja ni regla que la separe del monto.
    expect(within(money).getByTestId('buylist-shipping-note')).toBeInTheDocument();
  });

  it('por debajo del mínimo: dice cuánto falta (con el número del servidor) y el CTA NO procede', async () => {
    asVerifiedCustomer();
    // Mínimo alto a propósito: 1 Charizard (MX$24,250) queda por debajo de MX$50,000.
    vi.spyOn(api, 'getBuylistQuotePolicy').mockResolvedValue({ minimumRequestCents: 5_000_000 });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    const shortfall = await screen.findByTestId('buylist-minimum-shortfall');
    expect(shortfall).toHaveTextContent('Te faltan MX$25,750.00');
    expect(shortfall).toHaveTextContent('para el mínimo de MX$50,000.00');
    expect(shortfall).toHaveTextContent('Agrega otra carta.');
    // ⛔ el faltante NUNCA se expresa en términos de envío.
    expect(shortfall.textContent).not.toMatch(/env[íi]o|gu[íi]a/i);

    const cta = screen.getByRole('button', { name: 'Enviar solicitud (1)' });
    expect(cta).toBeDisabled();
    // §15.9: apagado pero no mudo — apunta al texto que explica y da el remedio.
    expect(cta.getAttribute('aria-describedby')).toContain('sell-cart-minimum');
  });

  /**
   * §23.14.6-7.3 — **ESCRITORIO: la cabecera NO monta la nota.** El carrito es un panel fijo
   * siempre a la vista, así que la única razón de ser de la instancia de la cabecera —cubrir el
   * caso en que el carrito no se ve— desaparece. Este es el caso exacto que a 1280px daba DOS.
   *
   * `useMediaQuery` lee `matchMedia`; jsdom lo tiene poly-rellenado con `matches:false` (móvil),
   * así que el escritorio se simula devolviendo `true` para el query del panel fijo.
   */
  it('§23.3g-bis · en ESCRITORIO la nota la pinta el bloque de dinero y la cabecera no se monta', async () => {
    asVerifiedCustomer();
    // ⚠️ `vi.spyOn`, NO una asignación directa: `window` es COMPARTIDO por todos los tests del
    // fichero, así que reescribir `matchMedia` a mano dejaría el resto de la suite en modo
    // escritorio (sin FAB) y los rojos aparecerían en tests que no tocan nada de esto. El
    // `vi.restoreAllMocks()` del `beforeEach` deshace el espía; una asignación no se deshace.
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('1024'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );

    renderWithProviders(<BuylistView />, 'es');
    // El panel fijo no necesita abrirse: ya está en pantalla (y no hay FAB que pulsar).
    await waitFor(() => {
      const notes = screen.getAllByTestId('buylist-shipping-note');
      expect(notes).toHaveLength(1);
      expect(notes[0]).toHaveAttribute('data-note-surface', 'cart-money');
    });
    expect(screen.queryByTestId('sell-cart-fab')).not.toBeInTheDocument();
  });

  /**
   * §23.14.6-8 — **el carrito explica su propia aritmética.** Este es, literalmente, el caso que
   * hizo que un test E2E concluyera que el cotizador no sumaba: cartas sin precio de referencia,
   * total en cero, y **nada en pantalla que lo explicara**.
   */
  it('§23.3h · con TODAS las líneas sin precio el total NO es MX$0.00 y la pantalla dice por qué', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Zapdos', 'Holofoil');
    openCart();

    const money = screen.getByTestId('sell-cart-money');
    // (8.4) el total es la VERSALITA, no un cero que se ve confiable.
    expect(within(money).getByTestId('buylist-pending-label')).toBeInTheDocument();
    expect(within(money).queryByText('MX$0.00')).not.toBeInTheDocument();
    // (8.1) la explicación aparece UNA sola vez, con el conteo, dentro del bloque de dinero.
    const notes = screen.getAllByTestId('buylist-pending-note');
    expect(notes).toHaveLength(1);
    expect(money).toContainElement(notes[0]);
    expect(notes[0]).toHaveTextContent('1 carta todavía no tiene precio, así que no suma al total');
    // (8.2) …y dice QUÉ PASA con esas cartas. Sin esta frase el vendedor las borra, que es el
    // peor desenlace posible de esta pantalla.
    expect(notes[0]).toHaveTextContent('Las cotizamos a mano y te las incluimos en la oferta.');
    // (8.5) el conteo de cartas NO introduce un monto: los únicos `MX$` del bloque son los del
    // faltante (faltante + mínimo, §23.3f). Descontados esos, el bloque no tiene ninguna cifra —
    // porque ninguna sería cierta.
    const shortfall = within(money).getByTestId('buylist-minimum-shortfall');
    const inBlock = ((money.textContent ?? '').match(/MX\$/g) ?? []).length;
    const inShortfall = ((shortfall.textContent ?? '').match(/MX\$/g) ?? []).length;
    expect(inBlock - inShortfall).toBe(0);
  });

  it('§23.3h · la explicación se pinta UNA vez aunque haya MUCHAS cartas sin precio', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Zapdos', 'Holofoil');
    openCart();
    const qty = screen.getByLabelText('Cantidad de Zapdos') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '999' } });

    // El plural del conteo entra; la explicación NO se repite por ítem (ese era el defecto:
    // repetirla N veces hunde lo único que hay que leer).
    const notes = await screen.findAllByTestId('buylist-pending-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('999 cartas todavía no tienen precio, así que no suman al total');
  });

  /**
   * §23.14.6-8.3 — el CONSEJO cambia; la CIFRA no. «Agrega otra carta» con el carrito lleno de
   * pendientes es una cinta de correr: puede agregar mil más del mismo set y seguir en cero.
   */
  it('§23.3f-bis · con líneas sin precio el consejo es «una carta que ya tenga precio»', async () => {
    asVerifiedCustomer();
    vi.spyOn(api, 'getBuylistQuotePolicy').mockResolvedValue({ minimumRequestCents: 5_000_000 });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard'); // con precio: hay faltante que pintar
    await addCard('Zapdos', 'Holofoil'); // sin precio: cambia el consejo
    openCart();

    const shortfall = await screen.findByTestId('buylist-minimum-shortfall');
    expect(shortfall).toHaveTextContent('Agrega una carta que ya tenga precio.');
    expect(shortfall).not.toHaveTextContent('Agrega otra carta.');
    // ⛔ Prohibido fundir el faltante con la explicación: la cifra tiene que seguir siendo
    // verificable por sí sola. El porqué vive arriba, en su propia frase.
    expect(shortfall).toHaveTextContent('Te faltan MX$25,750.00');
    expect(shortfall.textContent).not.toMatch(/no tiene[n]? precio|porque/i);
  });

  it('al CRUZAR el mínimo el faltante desaparece y se anuncia SIN mencionar envío ni neto', async () => {
    asVerifiedCustomer();
    // MX$30,000: una Charizard queda debajo; dos, arriba.
    vi.spyOn(api, 'getBuylistQuotePolicy').mockResolvedValue({ minimumRequestCents: 3_000_000 });
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();
    expect(await screen.findByTestId('buylist-minimum-shortfall')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar cantidad' }));

    await waitFor(() =>
      expect(screen.queryByTestId('buylist-minimum-shortfall')).not.toBeInTheDocument(),
    );
    const announce = await screen.findByText('Ya alcanzaste el mínimo de MX$30,000.00.');
    expect(announce).toHaveAttribute('aria-live', 'polite');
    expect(announce.textContent).not.toMatch(/env[íi]o|neto/i);
    expect(screen.getByRole('button', { name: 'Enviar solicitud (2)' })).toBeEnabled();
  });

  it('FAIL-OPEN: si la política no llega, no se pinta faltante, no se inventa mínimo y el CTA sigue vivo', async () => {
    asVerifiedCustomer();
    vi.spyOn(api, 'getBuylistQuotePolicy').mockRejectedValue(new Error('429'));
    renderWithProviders(<BuylistView />, 'es');
    await addCard('Charizard');
    openCart();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar solicitud (1)' })).toBeEnabled());
    expect(screen.queryByTestId('buylist-minimum-shortfall')).not.toBeInTheDocument();
    // Ni un número inventado: el bloque de dinero sigue con UN solo monto.
    expect(screen.getByTestId('sell-cart-money').textContent?.match(/MX\$/g) ?? []).toHaveLength(1);
  });
});
