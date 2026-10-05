import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO, LabelAlertDTO, LabelAlertKind, ShipPreparationOrderDTO } from '@/types/contract';
import { PreparationQueue } from './PreparationQueue';
import { ShipmentsQueue } from './ShipmentsQueue';
import { labelFor, quote, rateOf, shipment } from './capture/sdx-test-fixtures';

/**
 * La guía de Skydropx en las dos superficies de la cola (`DESIGN_SYSTEM §43.8`): UX-SDX-26, UX-SDX-16 y la
 * mitad de UX-SDX-2 que es de las tarjetas («⛔ ningún botón «Cotizar envío»»).
 */

const role = vi.hoisted(() => ({ superAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: role.superAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: role.superAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = true;
});

function preparedOrder(over: Partial<ShipPreparationOrderDTO> = {}): ShipPreparationOrderDTO {
  return {
    destination: 'ship',
    shipmentId: 'shp-1',
    kind: 'guest_direct_ship',
    orderId: 'ord-1',
    orderNumber: 'TCG-000123',
    requestedAt: '2026-09-20T10:00:00Z',
    customer: { userId: 'u-1', email: 'ash@example.com', lastName: 'Ketchum', fullName: 'Ash Ketchum' },
    preparation: { status: 'prepared', preparedAt: '2026-09-28T17:20:00Z', preparedBy: { userId: 'u-op1', name: 'Operador' }, openReplacements: 0, total: 1, pending: 0, picked: 1, missing: 0, blocked: 0 },
    shipTo: { recipientName: 'Ash Ketchum', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5550000000' },
    items: [
      {
        shipmentItemId: 'sit-a',
        inventoryItemId: 'inv-a',
        folio: 'INV-a',
        quantity: 1,
        card: { name: 'Carta a', setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
        currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
        prepStatus: 'picked',
        missingReason: null,
        prepMarkedBy: null,
        availability: { kind: 'available' },
        refund: { kind: 'refundable', amountCents: 31458 },
      } as ShipPreparationOrderDTO['items'][number],
    ],
    ...over,
  };
}

const ALERTS: { kind: LabelAlertKind; title: string }[] = [
  { kind: 'label_unknown', title: 'Compra sin respuesta' },
  { kind: 'label_processing_stuck', title: 'Guía atorada en proceso' },
  { kind: 'label_cancel_failed', title: 'Cancelación sin confirmar' },
  { kind: 'label_live_on_cancelled', title: 'Guía viva en un envío cancelado' },
];
const alert = (kind: LabelAlertKind, canRelease = false): LabelAlertDTO => ({ kind, since: '2026-10-03T10:00:00Z', canRelease });

describe('UX-SDX-26 · la tarjeta de «Preparar» con compra pendiente', () => {
  it("labelPending.state='in_flight' ⇒ «Compra sin confirmar · …», botón «Ver compra sin confirmar» y SIN «Deshacer preparado»", async () => {
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([
      preparedOrder({ labelPending: { since: '2026-10-04T16:05:00Z', state: 'in_flight', carrierLabel: '99minutos', serviceName: 'Next Day Nacional', chosenBy: null } }),
    ]);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const line = await screen.findByTestId('ship-label-pending-shp-1');
    expect(line.textContent).toMatch(/^Compra sin confirmar · 99minutos · desde /);
    expect(line.textContent).not.toMatch(/en proceso/);
    const footer = screen.getByTestId('ship-footer-shp-1');
    expect(within(footer).getByRole('button', { name: 'Ver compra sin confirmar' })).toBeInTheDocument();
    expect(within(footer).queryByRole('button', { name: /Deshacer preparado/ })).not.toBeInTheDocument();
  });
  it("labelPending.state='processing' ⇒ «Guía en proceso · …» y «Ver guía en proceso»", async () => {
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([
      preparedOrder({ labelPending: { since: '2026-10-04T16:05:00Z', state: 'processing', carrierLabel: null, serviceName: null, chosenBy: null } }),
    ]);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    expect((await screen.findByTestId('ship-label-pending-shp-1')).textContent).toMatch(/^Guía en proceso · desde /);
    expect(screen.getByRole('button', { name: 'Ver guía en proceso' })).toBeInTheDocument();
  });
  it('sin compra pendiente ⇒ «Capturar guía» y «Deshacer preparado»; ⛔ ningún «Cotizar envío» (UX-SDX-2)', async () => {
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([preparedOrder({ shipTo: { ...preparedOrder().shipTo, addressCorrected: true } })]);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const footer = await screen.findByTestId('ship-footer-shp-1');
    expect(within(footer).getByRole('button', { name: 'Capturar guía' })).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: /Deshacer preparado/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cotizar envío/i })).not.toBeInTheDocument();
    // FS-20: la dirección corregida se nombra en la tarjeta.
    expect(screen.getByTestId('prep-address-corrected-shp-1')).toHaveTextContent('Dirección corregida');
  });
  it.each(ALERTS)('labelAlert $kind ⇒ su título en ShipPreparationCard', async ({ kind, title }) => {
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([preparedOrder({ labelAlert: alert(kind) })]);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    expect(await within(await screen.findByTestId('ship-label-alert-shp-1')).findByText(title)).toBeInTheDocument();
  });
});

function row(over: Partial<AdminShipmentDTO> = {}): AdminShipmentDTO {
  return { ...shipment({ id: 'shp-9', status: 'guia', carrier: null, trackingNumber: null }), ...over };
}
function serveRows(rows: AdminShipmentDTO[]) {
  vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total: rows.length });
}

describe('UX-SDX-26 · las cuatro alertas también en «Envíos»', () => {
  it.each(ALERTS)('labelAlert $kind ⇒ su título en ShipmentsQueue', async ({ kind, title }) => {
    serveRows([row({ labelAlert: alert(kind) })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    expect(await within(await screen.findByTestId('label-alert-shp-9')).findByText(title)).toBeInTheDocument();
  });
  it('label_processing_stuck va SIN botón (A-6 abierta)', async () => {
    serveRows([row({ labelAlert: alert('label_processing_stuck') })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    const block = await screen.findByTestId('label-alert-shp-9');
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('UX-SDX-16 · «Liberar» ⇔ canRelease (⛔ nunca por el rol)', () => {
  it('súper-admin con canRelease:false ⇒ sin «Liberar» (ni apagado) y con «Un súper-admin puede liberarla…» (v4.20)', async () => {
    role.superAdmin = true;
    serveRows([row({ status: 'picking', labelAlert: alert('label_unknown', false) })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    const block = await screen.findByTestId('label-alert-shp-9');
    expect(within(block).getByText('Un súper-admin puede liberarla tras revisarla en el panel de Skydropx: avísale.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liberar' })).not.toBeInTheDocument();
  });
  it('operador con canRelease:true ⇒ «Liberar» presente; el diálogo manda la nota y pinta el resultado', async () => {
    role.superAdmin = false;
    serveRows([row({ status: 'picking', labelAlert: alert('label_unknown', true) })]);
    const rel = vi.spyOn(api, 'releaseShipmentLabel').mockResolvedValue({ outcome: 'released', shipment: row({ status: 'picking' }) });
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Liberar este envío?' });
    fireEvent.change(within(dialog).getByLabelText('Qué revisaste (obligatorio)'), { target: { value: 'Revisé el panel: no hay envío TCG-000123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar y liberar' }));
    // v4.20 (§43.19.6): sin casilla pintada, `confirmConflict` va en `false` ⇒ la clave no viaja (lo prueba la rama real).
    await waitFor(() => expect(rel).toHaveBeenCalledWith('shp-9', 'Revisé el panel: no hay envío TCG-000123', false));
    expect(await screen.findByText('No había guía en Skydropx. El envío volvió a «preparado».')).toBeInTheDocument();
  });
  it('409 LABEL_NOT_RELEASABLE too_early ⇒ minutos redondeados hacia arriba', async () => {
    serveRows([row({ status: 'picking', labelAlert: alert('label_unknown', true) })]);
    vi.spyOn(api, 'releaseShipmentLabel').mockRejectedValue(new ApiClientError(409, { code: 'LABEL_NOT_RELEASABLE', message: 'x', details: { reason: 'too_early', retryAfterSeconds: 61 } }));
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Liberar este envío?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar y liberar' }));
    expect(await within(dialog).findByText('Todavía no: espera 2 minutos antes de liberar.')).toBeInTheDocument();
  });
});

describe('§43.8b · la fila con guía de Skydropx', () => {
  const q = quote();
  it('sin «Capturar guía»; bloque con guía, quién, dinero y paquetería; ⛔ ningún «Cotizar envío»', async () => {
    const l = labelFor(rateOf(q, 'rate-paquetexpress'), { wasRecommended: false, recommended: rateOf(q, 'rate-99min') });
    serveRows([row({ labelSource: 'skydropx', label: l, carrier: 'Paquetexpress', trackingNumber: l.trackingNumber })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    const block = await screen.findByTestId('sdx-label-block-shp-9');
    const r = screen.getByTestId('shipment-row-shp-9');
    expect(within(r).queryByRole('button', { name: 'Capturar guía' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cotizar envío/i })).not.toBeInTheDocument();
    expect(within(block).getByText('Guía Skydropx · Paquetexpress · Nacional · 9900112233')).toBeInTheDocument();
    expect(within(block).getByText('No era la recomendada (99minutos).')).toBeInTheDocument();
    expect(within(block).getByText(/Costo MX\$76\.25 ·/)).toBeInTheDocument();
    expect(within(block).getByText('Paquetería: Guía creada · ', { exact: false })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Cancelar guía y comprar otra' })).toBeInTheDocument();
  });
  it('recogida por la paquetería ⇒ «Cancelar guía y comprar otra» no se pinta', async () => {
    const l = labelFor(rateOf(q, 'rate-99min'), { carrierStatus: 'in_transit' });
    serveRows([row({ status: 'enviado', labelSource: 'skydropx', label: l })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    const block = await screen.findByTestId('sdx-label-block-shp-9');
    expect(within(block).queryByRole('button', { name: 'Cancelar guía y comprar otra' })).not.toBeInTheDocument();
    expect(within(block).getByText(/Paquetería: En tránsito/)).toBeInTheDocument();
  });
  it('«Actualizar rastreo» con 429 ⇒ «Espera un minuto»', async () => {
    const l = labelFor(rateOf(q, 'rate-99min'));
    serveRows([row({ labelSource: 'skydropx', label: l })]);
    vi.spyOn(api, 'refreshShipmentTracking').mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x' }));
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    fireEvent.click(within(await screen.findByTestId('sdx-label-block-shp-9')).getByRole('button', { name: 'Actualizar rastreo' }));
    expect(await screen.findByText('Ya lo actualizaste hace un momento. Espera un minuto.')).toBeInTheDocument();
  });
});
