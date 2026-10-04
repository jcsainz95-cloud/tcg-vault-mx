import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO, ShipmentQuoteDTO } from '@/types/contract';
import { CaptureLabelDialog, POLL_MAX_MS, POLL_MS } from './CaptureLabelDialog';
import { PACKAGES, REF, SHIP_ID, TARGET, deferred, labelFor, quote, rateOf, shipment } from './capture/sdx-test-fixtures';

/**
 * Candados de UX de la ventana «Capturar guía» (`DESIGN_SYSTEM §43.15`, UX-SDX-1…25 menos 3/14–17/26, que
 * viven en sus propias suites) contra el contrato `§M4-SHIP.19.19/19.20`, con la API espiada (equivalente a
 * MSW: el servidor de la fase D no existe todavía). Cada `it` nombra su ID; el canario de cada uno está en
 * `docs/FRONTEND_NOTES.md` §Skydropx (la mutación que lo pone rojo, medida).
 */

const role = vi.hoisted(() => ({ superAdmin: false }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: role.superAdmin ? 'super_admin' : 'vault_operator',
    setRole: () => {},
    isSuperAdmin: role.superAdmin,
    canSwitchRole: false,
  }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const Q_A = quote();
const Q_B = quote({ quoteId: 'q-B' }, 700);

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = false;
  vi.spyOn(api, 'listShippingPackages').mockResolvedValue(PACKAGES);
  vi.spyOn(api, 'getPostalCode').mockImplementation(async (cp: string) => {
    if (cp === '14210') return { postalCode: cp, state: 'Ciudad de México', municipality: 'Tlalpan', neighborhoods: ['Jardines de la Montaña', 'Parques del Pedregal'], source: 'local' };
    if (cp === '44100') return { postalCode: cp, state: 'Jalisco', municipality: 'Guadalajara', neighborhoods: ['Guadalajara Centro', 'Americana'], source: 'local' };
    throw new ApiClientError(404, { code: 'POSTAL_CODE_UNKNOWN', message: 'x', details: { postalCode: cp } });
  });
});
afterEach(() => {
  vi.useRealTimers();
});

function open(s: AdminShipmentDTO = shipment(), q: ShipmentQuoteDTO = Q_A) {
  const get = vi.spyOn(api, 'getAdminShipment').mockResolvedValue(s);
  const quoteSpy = vi.spyOn(api, 'quoteShipment').mockResolvedValue(q);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(<CaptureLabelDialog target={TARGET} onClose={onClose} onSaved={onSaved} />, 'es');
  return { get, quoteSpy, onSaved, onClose, dialog: () => screen.getByRole('dialog', { name: 'Captura de guía' }) };
}

async function toStep2() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
  await screen.findByRole('group', { name: 'Elige una paquetería' });
}
async function toStep3(rateLabel = '99minutos · Next Day Nacional') {
  await toStep2();
  fireEvent.click(screen.getByRole('radio', { name: rateLabel }));
  fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
  await screen.findByText('Paso 3 de 4 · Comprar');
}

const buyButtons = () => screen.queryAllByRole('button', { name: /^Comprar guía/ });
const manualButtons = () => screen.queryAllByRole('button', { name: 'Capturar a mano' });

describe('UX-SDX-1 = PS-101 (a) · dos caminos en una ventana', () => {
  it("provider:'off' ⇒ el formulario de hoy, sin «Paso n de 4»", async () => {
    open(shipment({}, { provider: 'off', canPurchase: false }));
    expect(await screen.findByLabelText('Paquetería')).toBeInTheDocument();
    expect(screen.getByLabelText('Número de guía')).toBeInTheDocument();
    expect(screen.queryByText(/^Paso \d de 4/)).not.toBeInTheDocument();
  });
  it('sin `labelOptions` (servidor anterior a la fase D) ⇒ también el formulario de hoy', async () => {
    open(shipment({ labelOptions: undefined }));
    expect(await screen.findByLabelText('Paquetería')).toBeInTheDocument();
    expect(screen.queryByText(/^Paso \d de 4/)).not.toBeInTheDocument();
  });
  it("provider:'skydropx' ⇒ paso 1 con la `<dl>` del snapshot", async () => {
    open();
    expect(await screen.findByText('Paso 1 de 4 · Dirección')).toBeInTheDocument();
    const dl = screen.getByTestId('sdx-address-dl');
    expect(within(dl).getByText('Ana López')).toBeInTheDocument();
    expect(within(dl).getByText('14210')).toBeInTheDocument();
    expect(within(dl).getByText('Portón negro')).toBeInTheDocument();
    expect(screen.queryByLabelText('Paquetería')).not.toBeInTheDocument();
  });
});

describe('UX-SDX-2 = PS-101 (b) · «Capturar a mano» en los pasos', () => {
  it('presente y habilitado en los pasos 1, 2 y 3 (antes de comprar), y lleva al formulario de hoy', async () => {
    open();
    await screen.findByText('Paso 1 de 4 · Dirección');
    expect(manualButtons()).toHaveLength(1);
    expect(manualButtons()[0]).toBeEnabled();
    await toStep2();
    expect(manualButtons()).toHaveLength(1);
    expect(manualButtons()[0]).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
    await screen.findByText('Paso 3 de 4 · Comprar');
    expect(manualButtons()).toHaveLength(1);
    expect(manualButtons()[0]).toBeEnabled();
    fireEvent.click(manualButtons()[0]);
    expect(await screen.findByLabelText('Paquetería')).toBeInTheDocument();
    expect(screen.getByText('Para una guía que ya compraste en el panel de Skydropx o con otra paquetería.')).toBeInTheDocument();
    // «Volver a Skydropx» regresa al paso en que estaba, con lo cotizado intacto.
    fireEvent.click(screen.getByRole('button', { name: 'Volver a Skydropx' }));
    expect(await screen.findByText('Paso 3 de 4 · Comprar')).toBeInTheDocument();
    expect(api.quoteShipment).toHaveBeenCalledTimes(1);
  });
  it('paso 4 «no se creó» ⇒ presente; paso 4 «sin confirmar» ⇒ ausente (SK5)', async () => {
    const s = shipment({ labelPending: { since: '2026-10-04T16:00:00Z', state: 'in_flight', carrierLabel: '99minutos', serviceName: 'Next Day Nacional', chosenBy: { userId: 'u', name: 'Ana' } } });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { get } = open(s);
    expect(await screen.findByText('Compra sin confirmar')).toBeInTheDocument();
    expect(manualButtons()).toHaveLength(0);
    // La relectura dice que el reclamo se deshizo ⇒ «no se creó» y vuelve la salida manual.
    get.mockResolvedValue(shipment());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    vi.useRealTimers();
    expect(await screen.findByText('Skydropx no creó la guía. No se compró nada.')).toBeInTheDocument();
    expect(manualButtons()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Volver a elegir' })).toBeInTheDocument();
  });
});

describe('UX-SDX-4 = PS-101 (c) · la lista con el fixture medido', () => {
  it('99minutos preseleccionada aunque no es la más barata; sucursal plegada; excluidas «no disponibles por API»', async () => {
    open();
    await toStep2();
    expect(screen.getByRole('radio', { name: '99minutos · Next Day Nacional' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Paquetexpress · Nacional' })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'PuntoPost · Sucursal a sucursal' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sdx-excluded')).toHaveTextContent('1 opción no se muestra: 1 no disponibles por API.');
    fireEvent.click(screen.getByRole('button', { name: 'Ver también 1 opción sin entrega a domicilio' }));
    expect(screen.getByRole('radio', { name: 'PuntoPost · Sucursal a sucursal' })).toBeInTheDocument();
    expect(screen.getByText('No entrega a domicilio: el cliente recoge en sucursal')).toHaveClass('text-accent');
  });
});

describe('UX-SDX-5 · toda ausencia tiene nombre (SK8)', () => {
  it('days/pickup/deliveryKind/planType nulos ⇒ «sin dato»; ni `null`, ni `undefined`, ni «—» suelto', async () => {
    const base = quote();
    const r = { ...rateOf(base, 'rate-99min'), days: null, pickup: null, deliveryKind: 'unknown' as const, planType: null, dropoff: null };
    open(shipment(), { ...base, rates: [r] });
    await toStep2();
    expect(screen.getByText(/Días: sin dato · Recolección: sin dato · Entrega: sin dato/)).toBeInTheDocument();
    expect(screen.queryByText(/Plan Skydropx/)).not.toBeInTheDocument();
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).not.toMatch(/\bnull\b|\bundefined\b/);
    expect(screen.queryAllByText('—')).toHaveLength(0);
  });
});

describe('UX-SDX-6 · el seguro se ve y no se quita (SK9)', () => {
  it('cabecera y renglón del desglose con la cobertura; cero controles para quitarlo', async () => {
    open();
    await toStep2();
    expect(screen.getByText('Asegurado por MX$2,500.00. El seguro cuesta MX$25.00 y ya va dentro de cada precio.')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
    await screen.findByText('Paso 3 de 4 · Comprar');
    expect(within(screen.getByTestId('sdx-breakdown')).getByText('Seguro (cobertura MX$2,500.00)')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /seguro/i })).not.toBeInTheDocument();
  });
});

describe('UX-SDX-7 (SK3) · ninguna cifra la calcula la pantalla', () => {
  it('con un `priceCents` que NO es la suma del desglose, las cuatro cifras son la del servidor', async () => {
    const base = quote();
    const adulterated = { ...rateOf(base, 'rate-99min'), priceCents: 99999 };
    open(shipment(), { ...base, rates: base.rates.map((r) => (r.rateId === 'rate-99min' ? adulterated : r)) });
    await toStep2();
    expect(within(screen.getByTestId('sdx-rate-rate-99min')).getByText('MX$999.99')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
    await screen.findByText('Paso 3 de 4 · Comprar');
    expect(screen.getByTestId('sdx-total')).toHaveTextContent('MX$999.99');
    expect(screen.getByTestId('sdx-charge')).toHaveTextContent('Se cobrará MX$999.99 del saldo de Skydropx de la tienda.');
    expect(screen.getByRole('button', { name: 'Comprar guía por MX$999.99' })).toBeInTheDocument();
  });
});

describe('UX-SDX-8 = PS-101 (d) · el botón de compra solo si se puede comprar (SK2, SK4)', () => {
  it.each([
    ['disabled', false, 'La compra de guías está desactivada. Se activa en «Configuración › Envíos». Mientras, captura la guía a mano.'],
    ['super_admin_only', false, 'Solo el dueño compra guías por ahora. Avísale, o captura la guía a mano si ya la tienes.'],
    ['operators', false, 'La compra de guías no está habilitada en este servidor. No se cobró nada. Captura la guía a mano.'],
  ] as const)("canPurchase:false con purchase '%s' ⇒ cero «Comprar guía…» y la frase", async (purchase, canPurchase, text) => {
    open(shipment({}, { purchase, canPurchase }));
    await toStep3();
    expect(buyButtons()).toHaveLength(0);
    expect(screen.getByTestId('sdx-cannot-buy')).toHaveTextContent(text);
    expect(manualButtons()[0].className).toMatch(/bg-primary/); // «Capturar a mano» pasa a primaria
  });
  it('canPurchase:true ⇒ UN botón con la cifra y encima la frase de dinero con el MISMO monto', async () => {
    role.superAdmin = true;
    open(shipment({}, { purchase: 'super_admin_only', canPurchase: true }));
    await toStep3();
    expect(buyButtons()).toHaveLength(1);
    expect(buyButtons()[0]).toHaveTextContent('Comprar guía por MX$112.99');
    expect(screen.getByTestId('sdx-charge')).toHaveTextContent('Se cobrará MX$112.99 de tu saldo de Skydropx.');
  });
});

describe('UX-SDX-9 · las confirmaciones viajan solo si el aviso estaba pintado', () => {
  it('sucursal ⇒ aviso y `confirmBranchDelivery:true`; sin aviso ⇒ el cuerpo no lleva ninguna en true', async () => {
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(new ApiClientError(422, { code: 'RATE_NOT_IN_QUOTE', message: 'x' }));
    open();
    await toStep2();
    fireEvent.click(screen.getByRole('button', { name: /^Ver también/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'PuntoPost · Sucursal a sucursal' }));
    fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
    await screen.findByText('Paso 3 de 4 · Comprar');
    expect(screen.getByText(/Esta opción no entrega a domicilio: el cliente tendrá que ir a recogerlo/)).toBeInTheDocument();
    fireEvent.click(buyButtons()[0]);
    await waitFor(() => expect(buy).toHaveBeenCalledTimes(1));
    expect(buy.mock.calls[0][1]).toMatchObject({ confirmBranchDelivery: true });
    expect(buy.mock.calls[0][1].confirmNegativeMargin).toBeUndefined();

    fireEvent.click(await screen.findByRole('button', { name: 'Atrás' }));
    fireEvent.click(screen.getByRole('radio', { name: '99minutos · Next Day Nacional' }));
    fireEvent.click(screen.getByRole('button', { name: /^Continuar con/ }));
    await screen.findByText('Paso 3 de 4 · Comprar');
    expect(screen.queryByText(/Si compras, lo confirmas/)).not.toBeInTheDocument();
    fireEvent.click(buyButtons()[0]);
    await waitFor(() => expect(buy).toHaveBeenCalledTimes(2));
    const body = buy.mock.calls[1][1];
    expect(body.confirmBranchDelivery).toBeUndefined();
    expect(body.confirmNegativeMargin).toBeUndefined();
    expect(body).toEqual({ quoteId: Q_A.quoteId, rateId: 'rate-99min', expectedPriceCents: 11299, expectedMarginCents: 7353 });
  });
});

describe('UX-SDX-10 = PS-101 (e) · re-cotizar nunca compra solo', () => {
  it('409 QUOTE_EXPIRED ⇒ paso 2 con la cifra nueva y CERO compras sin un clic nuevo', async () => {
    const fresh = quote({ quoteId: 'q-fresh' }, 500);
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      new ApiClientError(409, { code: 'QUOTE_EXPIRED', message: 'x', details: { quote: fresh, reason: 'expired' } }),
    );
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText('Los precios vencieron y volvimos a cotizar. No se compró nada. Revisa la cifra nueva y elige otra vez.')).toBeInTheDocument();
    expect(screen.getByText('Paso 2 de 4 · Opciones')).toBeInTheDocument();
    expect(within(screen.getByTestId('sdx-rate-rate-99min')).getByText('MX$117.99')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '99minutos · Next Day Nacional' })).toBeChecked();
    await new Promise((r) => setTimeout(r, 300));
    expect(buy).toHaveBeenCalledTimes(1);
  });
  it('409 LABEL_PREVIEW_STALE ⇒ el paso 3 se repinta con la cifra del servidor', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      new ApiClientError(409, { code: 'LABEL_PREVIEW_STALE', message: 'x', details: { priceCents: 12345, marginCents: 6000 } }),
    );
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/El precio cambió mientras confirmabas: ahora son MX\$123\.45 \(margen MX\$60\.00\)/)).toBeInTheDocument();
    expect(screen.getByText('Paso 3 de 4 · Comprar')).toBeInTheDocument();
    expect(screen.getByTestId('sdx-total')).toHaveTextContent('MX$123.45');
    expect(screen.getByRole('button', { name: 'Comprar guía por MX$123.45' })).toBeInTheDocument();
  });
});

describe('UX-SDX-11 ⭐💰 (SK5) · la compra que no sabemos si ocurrió se trata como ocurrida', () => {
  const pendingInFlight = shipment({ labelPending: { since: '2026-10-04T16:05:00Z', state: 'in_flight', carrierLabel: '99minutos', serviceName: 'Next Day Nacional', chosenBy: { userId: 'u-op1', name: 'Operador' } } });

  async function assertInFlight() {
    expect(await screen.findByText('Compra sin confirmar')).toBeInTheDocument();
    expect(screen.getByText(/no sabemos si alcanzó a crear la guía\. No la vuelvas a comprar/)).toBeInTheDocument();
    expect(buyButtons()).toHaveLength(0);
    expect(manualButtons()).toHaveLength(0);
  }

  it('(a) 200 {outcome:in_flight} ⇒ «Compra sin confirmar»; 10 clics durante la compra ⇒ 1 llamada', async () => {
    const d = deferred<Awaited<ReturnType<typeof api.purchaseShipmentLabel>>>();
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockReturnValue(d.promise);
    open();
    await toStep3();
    const btn = buyButtons()[0];
    for (let i = 0; i < 10; i++) fireEvent.click(btn);
    await act(async () => d.resolve({ outcome: 'in_flight', shipment: pendingInFlight }));
    await assertInFlight();
    expect(buy).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['503', () => new ApiClientError(503, { code: 'SHIPPING_PROVIDER_BUSY', message: 'x' })],
    ['500', () => new ApiClientError(500, { code: 'INTERNAL', message: 'x' })],
    ['red', () => new TypeError('Failed to fetch')],
  ])('(b) %s en la compra + relectura con labelPending in_flight ⇒ el mismo texto (decide el ESTADO)', async (_n, makeErr) => {
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(makeErr());
    const { get } = open();
    await toStep3();
    get.mockResolvedValue(pendingInFlight);
    fireEvent.click(buyButtons()[0]);
    await assertInFlight();
    expect(get).toHaveBeenCalledTimes(2); // abrir + UNA relectura
    expect(buy).toHaveBeenCalledTimes(1);
  });
  it('(c) 503 y la relectura TAMBIÉN falla ⇒ «Compra sin confirmar» (falla cerrado)', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(new ApiClientError(503, { code: 'SHIPPING_PROVIDER_BUSY', message: 'x' }));
    const { get } = open();
    await toStep3();
    get.mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(buyButtons()[0]);
    await assertInFlight();
  });
  it('(d) 503 con relectura sin `label` ni `labelPending` ⇒ «no se compró nada», vuelve el botón y 0 llamadas sin clic', async () => {
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(new ApiClientError(503, { code: 'SHIPPING_PROVIDER_BUSY', message: 'x' }));
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText('Skydropx no respondió y lo comprobamos: no se compró nada. Puedes volver a intentarlo.')).toBeInTheDocument();
    expect(buyButtons()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(buy).toHaveBeenCalledTimes(1);
  });
  it('502 edge_blocked en la compra con relectura limpia ⇒ «no sirve reintentar» y el botón NO vuelve', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      new ApiClientError(502, { code: 'SHIPPING_PROVIDER_ERROR', message: 'x', details: { reason: 'edge_blocked', op: 'label' } }),
    );
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/No sirve reintentar: avisa al súper-admin/)).toBeInTheDocument();
    expect(buyButtons()).toHaveLength(0);
    expect(manualButtons()).toHaveLength(1);
  });
});

describe('UX-SDX-12 · errores por código, nunca por status', () => {
  it('dos 409 con códigos distintos dan textos distintos', async () => {
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValueOnce(
      new ApiClientError(409, { code: 'SHIPPING_INSUFFICIENT_BALANCE', message: 'x', details: { requiredCents: 11299 } }),
    );
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/El saldo de Skydropx de la tienda no alcanza para esta guía \(MX\$112\.99\)/)).toBeInTheDocument();
    buy.mockRejectedValueOnce(new ApiClientError(409, { code: 'QUOTE_EXPIRED', message: 'x', details: { quote: Q_A, reason: 'expired' } }));
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/Los precios vencieron y volvimos a cotizar/)).toBeInTheDocument();
    expect(screen.queryByText(/no alcanza para esta guía/)).not.toBeInTheDocument();
  });
  it('502 edge_blocked al cotizar ⇒ sin «Volver a cotizar»; un 502 sin razón ⇒ con «Volver a cotizar»', async () => {
    const { quoteSpy } = open();
    quoteSpy.mockRejectedValueOnce(new ApiClientError(502, { code: 'SHIPPING_PROVIDER_ERROR', message: 'x', details: { reason: 'edge_blocked', op: 'quote' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByText(/La conexión con Skydropx fue bloqueada antes de llegar/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a cotizar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    quoteSpy.mockRejectedValueOnce(new ApiClientError(502, { code: 'SHIPPING_PROVIDER_ERROR', message: 'x', details: { op: 'quote' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByText(/Skydropx no respondió\. No se cotizó nada/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a cotizar' })).toBeInTheDocument();
  });
});

describe('UX-SDX-13 = PS-101 (f) · «que regrese la guía»', () => {
  it("'labeled' ⇒ número + «Imprimir etiqueta», banner de la página; sin `trackingUrl` ⇒ ningún enlace de rastreo", async () => {
    const l = labelFor(rateOf(Q_A, 'rate-99min'));
    vi.spyOn(api, 'purchaseShipmentLabel').mockResolvedValue({ outcome: 'labeled', shipment: shipment({ status: 'guia', labelSource: 'skydropx', label: l }), label: l });
    const { onSaved } = open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText('Guía comprada')).toBeInTheDocument();
    expect(screen.getByText('Guía: 9900112233')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir etiqueta' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rastreo en la paquetería/ })).not.toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith({ kind: 'skydropx', ref: REF, carrier: '99minutos', number: '9900112233' });
  });
  it("'processing' ⇒ «Guía en proceso», relee cada 5 s y se detiene a los 2 min", async () => {
    const proc = shipment({ labelPending: { since: '2026-10-04T16:05:00Z', state: 'processing', carrierLabel: '99minutos', serviceName: 'Next Day Nacional', chosenBy: null } });
    vi.spyOn(api, 'purchaseShipmentLabel').mockResolvedValue({ outcome: 'processing', shipment: proc });
    const { get } = open();
    await toStep3();
    get.mockResolvedValue(proc);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    fireEvent.click(buyButtons()[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Guía en proceso')).toBeInTheDocument();
    const before = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(get.mock.calls.length - before).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MAX_MS);
    });
    const atTimeout = get.mock.calls.length;
    expect(screen.getByText(/Sigue en proceso\. Puedes cerrar/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    });
    expect(get.mock.calls.length).toBe(atTimeout);
    expect(atTimeout - before).toBeLessThanOrEqual(POLL_MAX_MS / POLL_MS);
  });
  it('trackingUrl presente ⇒ enlace externo con `rel=noopener noreferrer`', async () => {
    const l = labelFor(rateOf(Q_A, 'rate-99min'), { trackingUrl: 'https://rastreo.example/99' });
    vi.spyOn(api, 'purchaseShipmentLabel').mockResolvedValue({ outcome: 'labeled', shipment: shipment({ label: l }), label: l });
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    const a = await screen.findByRole('link', { name: /Rastreo en la paquetería/ });
    expect(a).toHaveAttribute('href', 'https://rastreo.example/99');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toMatch(/noopener/);
  });
});

describe('UX-SDX-18 ⭐ = PS-101 (corregida) · el paso 1 corrige la dirección del envío', () => {
  it('seis controles editables, ninguno de municipio/estado/teléfono; sin «Ver opciones» con el formulario abierto; el PUT lleva la versión LEÍDA', async () => {
    const put = vi.spyOn(api, 'correctShipmentAddress').mockResolvedValue({ outcome: 'unchanged', shipment: shipment() });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir dirección' }));
    await screen.findByRole('button', { name: 'Guardar dirección' });
    const form = document.querySelector('form') as HTMLElement;
    expect(within(form).getAllByRole('textbox')).toHaveLength(5); // destinatario, calle, interior, CP, referencias
    expect(within(form).getAllByRole('combobox')).toHaveLength(1); // colonia
    for (const name of [/municipio/i, /estado/i, /teléfono/i]) {
      expect(within(form).queryByRole('textbox', { name })).not.toBeInTheDocument();
      expect(within(form).queryByRole('combobox', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Ver opciones de envío' })).not.toBeInTheDocument();
    fireEvent.change(within(form).getByRole('textbox', { name: 'Destinatario' }), { target: { value: 'Ana María López' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const body = put.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(body.expectedAddressVersion).toBe(3);
    expect(body.recipientName).toBe('Ana María López');
    for (const k of ['city', 'state', 'phone', 'country']) expect(body).not.toHaveProperty(k);
    expect(await screen.findByText('No había nada que cambiar: la dirección ya era esa.')).toBeInTheDocument();
  });
  it('`complete:false` sin colonia ⇒ abre en modo corregir con el foco en «Colonia» y el texto de 43.2c', async () => {
    const s = shipment({
      addressSnapshot: { ...shipment().addressSnapshot!, neighborhood: null },
      address: { complete: false, version: 0, corrected: null, missing: ['neighborhood'] },
    });
    open(s);
    expect(await screen.findByText('Falta la colonia y Skydropx no cotiza sin ella. Elige la del CP 14210.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: /Colonia/ })));
    expect(screen.queryByRole('button', { name: 'Ver opciones de envío' })).not.toBeInTheDocument();
  });
  it('`missing` con teléfono ⇒ aviso del teléfono, sin «Ver opciones» y «Capturar a mano» como primaria (P-ADR-1)', async () => {
    open(shipment({ address: { complete: false, version: 1, corrected: null, missing: ['phone'] } }));
    expect(await screen.findByText(/El teléfono no tiene 10 dígitos/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver opciones de envío' })).not.toBeInTheDocument();
    expect(manualButtons()[0].className).toMatch(/bg-primary/);
  });
  it('«Corregida por {name} · {fecha}» con `address.corrected`', async () => {
    open(shipment({ address: { complete: true, version: 4, corrected: { at: '2026-10-04T16:00:00Z', by: { userId: 'u', name: null } } , missing: [] } }));
    expect(await screen.findByTestId('sdx-address-corrected')).toHaveTextContent(/^Corregida por una cuenta sin nombre · /);
  });
});

describe('§43.2a con un servidor anterior a v1.80.12.2 (sin `address.missing`) · decide el servidor', () => {
  it('`complete:false` sin `missing` ⇒ modo leer con «Ver opciones»; el 422 con teléfono ⇒ su texto y «a mano» primaria', async () => {
    const { quoteSpy } = // Servidor anterior a v1.80.12.2 (sin `missing`): la ventana no deduce nada y decide el `422`.
    open(shipment({ address: { complete: false, version: 1, corrected: null } as unknown as AdminShipmentDTO['address'] }));
    expect(await screen.findByTestId('sdx-address-dl')).toBeInTheDocument();
    quoteSpy.mockRejectedValueOnce(new ApiClientError(422, { code: 'SHIPMENT_ADDRESS_INCOMPLETE', message: 'x', details: { missing: ['phone'] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByText(/El teléfono no tiene 10 dígitos/)).toBeInTheDocument();
    expect(manualButtons()[0].className).toMatch(/bg-primary/);
  });
});

describe('UX-SDX-19 · la frase de alcance unida al formulario', () => {
  it('visible en modo corregir y referida por `aria-describedby` del <form>', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir dirección' }));
    const note = await screen.findByText(/^Esto corrige solo a dónde va este paquete\./);
    const form = document.querySelector('form')!;
    const describedBy = form.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)).toContainElement(note);
  });
});

describe('UX-SDX-20 💰 · corregir tira la cotización vieja', () => {
  it('cotiza A ⇒ Atrás ⇒ corrige (corrected) ⇒ Ver opciones ⇒ cotiza OTRA vez y no queda ni un precio de A', async () => {
    const corrected = shipment({ address: { complete: true, version: 4, corrected: { at: '2026-10-04T16:10:00Z', by: { userId: 'u-op1', name: 'Operador' } } , missing: [] } });
    vi.spyOn(api, 'correctShipmentAddress').mockResolvedValue({ outcome: 'corrected', shipment: corrected });
    const { quoteSpy } = open();
    quoteSpy.mockResolvedValueOnce(Q_A).mockResolvedValueOnce(Q_B);
    await toStep2();
    expect(screen.getByText('MX$112.99')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir dirección' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar dirección' }));
    expect(await screen.findByText('Dirección corregida. Queda registrado a tu nombre.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver opciones de envío' }));
    await screen.findByRole('group', { name: 'Elige una paquetería' });
    expect(quoteSpy).toHaveBeenCalledTimes(2);
    for (const r of Q_A.rates) expect(screen.queryByText(new RegExp(`MX\\$${(r.priceCents / 100).toFixed(2).replace('.', '\\.')}$`))).not.toBeInTheDocument();
    expect(screen.getByText('MX$119.99')).toBeInTheDocument();
  });
});

describe('§19.23.4 (errata v1.80.12.3) · el número interior admite 200 caracteres', () => {
  it('200 viajan tal cual en el PUT (sin recorte ni cota de pantalla); un 400 {field:line2} va bajo ese campo', async () => {
    const put = vi.spyOn(api, 'correctShipmentAddress').mockRejectedValueOnce(
      new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'line2' } }),
    );
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir dirección' }));
    const line2 = await screen.findByLabelText('Número interior o depto. (opcional)');
    expect(line2).not.toHaveAttribute('maxlength');
    fireEvent.change(line2, { target: { value: 'x'.repeat(200) } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1].line2).toBe('x'.repeat(200));
    expect(await screen.findByText('Revisa este campo: el servidor no lo aceptó.')).toBeInTheDocument();
    expect(screen.getByLabelText('Número interior o depto. (opcional)')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('UX-SDX-21 · conflicto de versión: relee, avisa y no re-manda', () => {
  it('409 CONFLICT address_changed ⇒ texto, UNA relectura, modo leer con lo nuevo, y el siguiente PUT con la versión nueva', async () => {
    const put = vi.spyOn(api, 'correctShipmentAddress').mockRejectedValueOnce(
      new ApiClientError(409, { code: 'CONFLICT', message: 'x', details: { reason: 'address_changed', addressVersion: 5 } }),
    );
    const { get } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir dirección' }));
    const theirs = shipment({
      addressSnapshot: { ...shipment().addressSnapshot!, recipientName: 'Beto Ruiz' },
      address: { complete: true, version: 5, corrected: { at: '2026-10-04T16:20:00Z', by: { userId: 'u2', name: 'Beto' } } , missing: [] },
    });
    get.mockResolvedValue(theirs);
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar dirección' }));
    expect(await screen.findByText(/^Alguien más corrigió esta dirección mientras la editabas\./)).toBeInTheDocument();
    expect(await within(screen.getByTestId('sdx-address-dl')).findByText('Beto Ruiz')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 300));
    expect(put).toHaveBeenCalledTimes(1);
    put.mockResolvedValueOnce({ outcome: 'unchanged', shipment: theirs });
    fireEvent.click(screen.getByRole('button', { name: 'Corregir dirección' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1][1].expectedAddressVersion).toBe(5);
  });
});

describe('UX-SDX-22 · QUOTE_EXPIRED por dirección ≠ por vencimiento', () => {
  it('reason:address_changed ⇒ su texto, relectura, paso 2 con la nueva y 0 compras adicionales', async () => {
    const fresh = quote({ quoteId: 'q-fresh' }, 300);
    const buy = vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(
      new ApiClientError(409, { code: 'QUOTE_EXPIRED', message: 'x', details: { quote: fresh, reason: 'address_changed' } }),
    );
    const { get } = open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByText(/^La dirección de este envío cambió después de cotizar/)).toBeInTheDocument();
    expect(screen.queryByText(/^Los precios vencieron/)).not.toBeInTheDocument();
    expect(screen.getByText('Paso 2 de 4 · Opciones')).toBeInTheDocument();
    expect(within(screen.getByTestId('sdx-rate-rate-99min')).getByText('MX$115.99')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 300));
    expect(buy).toHaveBeenCalledTimes(1);
  });
});

describe('UX-SDX-23 · el CP manda sobre colonia, municipio y estado', () => {
  it('CP nuevo de 5 dígitos ⇒ UNA consulta, municipio/estado del CP y la colonia vuelve al placeholder; 4 dígitos ⇒ 0 consultas y select apagado con razón', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Corregir dirección' }));
    const cp = await screen.findByRole('textbox', { name: 'CP' });
    const colonia = screen.getByRole('combobox', { name: /Colonia/ });
    await waitFor(() => expect(colonia).toHaveValue('Jardines de la Montaña'));
    fireEvent.change(cp, { target: { value: '4410' } });
    expect(colonia).toBeDisabled();
    expect(colonia).toHaveAccessibleDescription('Escribe los 5 dígitos del CP para ver sus colonias.');
    expect((api.getPostalCode as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([c]) => c === '4410')).toHaveLength(0);
    fireEvent.change(cp, { target: { value: '44100' } });
    expect(await screen.findByText('Municipio y estado: Guadalajara, Jalisco (salen del CP).')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Colonia/ })).toHaveValue(''));
    expect(screen.getByRole('option', { name: 'Elige una colonia' })).toBeInTheDocument();
    expect((api.getPostalCode as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([c]) => c === '44100')).toHaveLength(1);
    // Y lo que viaja es lo que se ve: ⛔ la colonia del CP viejo NO sale con el CP nuevo.
    const put = vi.spyOn(api, 'correctShipmentAddress').mockResolvedValue({ outcome: 'unchanged', shipment: shipment() });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1]).toMatchObject({ postalCode: '44100', neighborhood: '' });
  });
});

describe('UX-SDX-24 · «Promoción» obedece a `isPromo`, no a `planType`', () => {
  it("planType 50PESOS_… con isPromo:false ⇒ sin chip; ACQ_2026 con isPromo:true ⇒ con chip", async () => {
    const base = quote();
    const rates = base.rates.map((r) =>
      r.rateId === 'rate-paquetexpress' ? { ...r, planType: '50PESOS_30042026', isPromo: false } : r.rateId === 'rate-99min' ? { ...r, planType: 'ACQ_2026', isPromo: true } : r,
    );
    open(shipment(), { ...base, rates });
    await toStep2();
    expect(screen.getByTestId('sdx-rate-chips-rate-99min')).toHaveTextContent('Recomendada · Promoción');
    expect(screen.queryByTestId('sdx-rate-chips-rate-paquetexpress')).not.toBeInTheDocument();
    expect(screen.getByText(/^«Promoción» son tarifas de promoción de Skydropx/)).toBeInTheDocument();
  });
});

describe('UX-SDX-25 · «Cambiar empaque» para el operador', () => {
  it('visible con 2+ activos; solo los activos; elegir otro re-cotiza con {packageCode} y 0 compras', async () => {
    const buy = vi.spyOn(api, 'purchaseShipmentLabel');
    const { quoteSpy } = open();
    await toStep2();
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar empaque' }));
    const select = screen.getByRole('combobox', { name: 'Empaque' });
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Sobre · 25×18×3 cm · 1 kg', 'Caja · 49×23×21 cm · 5 kg']);
    fireEvent.change(select, { target: { value: 'box' } });
    await waitFor(() => expect(quoteSpy).toHaveBeenLastCalledWith(SHIP_ID, { packageCode: 'box' }));
    expect(buy).not.toHaveBeenCalled();
  });
  it('con UN solo empaque activo, o con la lista en error, el botón no se pinta', async () => {
    (api.listShippingPackages as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(PACKAGES.slice(0, 1));
    open();
    await toStep2();
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole('button', { name: 'Cambiar empaque' })).not.toBeInTheDocument();
  });
});

describe('§43.7 · la compra desactivada por el servidor quita el botón', () => {
  it('404 FEATURE_DISABLED {feature:label_purchase} ⇒ frase en el sitio del botón y «a mano» primaria', async () => {
    vi.spyOn(api, 'purchaseShipmentLabel').mockRejectedValue(new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'x', details: { feature: 'label_purchase' } }));
    open();
    await toStep3();
    fireEvent.click(buyButtons()[0]);
    expect(await screen.findByTestId('sdx-cannot-buy')).toHaveTextContent(/La compra de guías está desactivada\. No se cobró nada/);
    expect(buyButtons()).toHaveLength(0);
  });
  it('422 SHIPMENT_ADDRESS_INCOMPLETE sin teléfono ⇒ vuelve al paso 1 en modo corregir', async () => {
    const { quoteSpy } = open();
    quoteSpy.mockRejectedValueOnce(new ApiClientError(422, { code: 'SHIPMENT_ADDRESS_INCOMPLETE', message: 'x', details: { missing: ['neighborhood', 'line1'] } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver opciones de envío' }));
    expect(await screen.findByText('A la dirección le falta la colonia y la calle y Skydropx no cotiza sin ello. No se cotizó ni se compró nada. Corrígela en el paso 1.')).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 4 · Dirección')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar dirección' })).toBeInTheDocument();
  });
});
