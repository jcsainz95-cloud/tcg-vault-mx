import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import {
  IN_FLIGHT_UNCERTAIN_REASONS,
  type AdminShipmentDTO,
  type InFlightUncertainReason,
  type LabelAlertDTO,
  type LabelPendingDTO,
  type ShipPreparationOrderDTO,
  type ShipmentDTO,
} from '@/types/contract';
import { PreparationQueue } from './PreparationQueue';
import { ShipmentsQueue } from './ShipmentsQueue';
import { DepartureBoard } from './DepartureBoard';
import { PrintSheetView } from './print/PrintSheetView';
import { shipment } from './capture/sdx-test-fixtures';
import { OrderShipmentBlock } from '@/components/domain/OrderShipmentBlock';
import { WithdrawalsList } from '../../../(storefront)/vault/WithdrawalsList';
import { ShipmentDetailView } from '../../../(storefront)/shipments/[id]/ShipmentDetailView';

/**
 * Candados de las tarjetas y superficies del diseño **v4.20** (`DESIGN_SYSTEM §43.19.15`): UX-SDX-32 (alertas con su
 * motivo y `label_orphan`), UX-SDX-33 💰 («Liberar» con folio, precio, destinatario y `confirmConflict`), UX-SDX-34 =
 * PS-136 (el folio en tarjeta, fila y hoja; ⛔ nunca al cliente) y la fila de «Salida de hoy» con folio (PS-164, S-GAS-1).
 * Contra la API espiada (equivalente a MSW). Canarios en `docs/FRONTEND_NOTES.md` §92.
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
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/',
}));

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = true;
});

const UUID = 'shp-0b7c2d4e-uuid';
const PHRASE: Record<InFlightUncertainReason | 'none', string> = {
  conflict: 'Skydropx contestó con una guía que ya es de otro envío.',
  charged_not_found: 'Skydropx descontó el saldo, pero no encontramos la guía.',
  ambiguous: 'Encontramos un envío parecido en Skydropx, pero no pudimos confirmar que sea éste.',
  balance_moved: 'El saldo de Skydropx se movió por otra causa y no sirve para comprobarlo.',
  unreadable: 'Skydropx no respondió a la comprobación.',
  not_calibrated: 'Aún no podemos comprobar solos que una guía no se creó.',
  duplicate: 'Skydropx creó dos guías para esta misma compra.',
  none: 'Todavía estamos terminando la comprobación.',
};

function pending(over: Partial<LabelPendingDTO> = {}): LabelPendingDTO {
  return {
    since: '2026-10-04T14:20:00Z',
    state: 'in_flight',
    carrierLabel: '99minutos',
    serviceName: 'Día siguiente',
    chosenBy: { userId: 'u-op1', name: 'Ana' },
    priceCents: 14850,
    providerReference: 'ENV-000045-01',
    verifyingUntil: '2026-10-04T14:35:00Z',
    ...over,
  };
}
const unknown = (reason: InFlightUncertainReason | null, canRelease = true): LabelAlertDTO => ({ kind: 'label_unknown', since: '2026-10-04T14:20:00Z', canRelease, reason });

function prepOrder(over: Partial<ShipPreparationOrderDTO> = {}): ShipPreparationOrderDTO {
  return {
    destination: 'ship',
    shipmentId: UUID,
    kind: 'guest_direct_ship',
    orderId: 'ord-1',
    orderNumber: 'TCG-000123',
    requestedAt: '2026-09-20T10:00:00Z',
    customer: { userId: 'u-1', email: 'ash@example.com', lastName: 'Ketchum', fullName: 'Ash Ketchum' },
    preparation: { status: 'prepared', preparedAt: '2026-09-28T17:20:00Z', preparedBy: { userId: 'u-op1', name: 'Operador' }, openReplacements: 0, total: 1, pending: 0, picked: 1, missing: 0, blocked: 0 },
    shipTo: { recipientName: 'Ana López', line1: 'Av. Juárez 120', neighborhood: 'Centro', city: 'Guadalajara', state: 'Jalisco', postalCode: '44100', country: 'MX', phone: '5550000000' },
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
    folio: 'ENV-000045',
    ...over,
  };
}
function row(over: Partial<AdminShipmentDTO> = {}): AdminShipmentDTO {
  return {
    ...shipment({
      id: UUID,
      status: 'picking',
      carrier: null,
      trackingNumber: null,
      addressSnapshot: {
        recipientName: 'Ana López',
        line1: 'Av. Juárez 120',
        neighborhood: 'Centro',
        city: 'Guadalajara',
        state: 'Jalisco',
        postalCode: '44100',
        country: 'MX',
        phone: '5551234567',
        references: 'Portón negro',
      },
    }),
    folio: 'ENV-000045',
    ...over,
  };
}
function serveRows(rows: AdminShipmentDTO[]) {
  vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: rows, page: 1, pageSize: 20, total: rows.length });
}

describe('UX-SDX-32 · las alertas de guía con su motivo, `label_orphan` sin botón', () => {
  const reasons = [...IN_FLIGHT_UNCERTAIN_REASONS, null] as const;
  it.each(reasons)('`label_unknown` con reason %s ⇒ su frase en la tarjeta de «Preparar»', async (reason) => {
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([prepOrder({ labelPending: pending(), labelAlert: unknown(reason) })]);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const block = await screen.findByTestId(`ship-label-alert-${UUID}`);
    expect(block).toHaveTextContent(PHRASE[reason ?? 'none']);
    expect(block.textContent).not.toMatch(new RegExp(`\\b${reason ?? 'null'}\\b`)); // ⛔ el valor crudo
  });
  it.each(reasons)('`label_unknown` con reason %s ⇒ su frase en la fila de «Envíos»', async (reason) => {
    serveRows([row({ labelPending: pending(), labelAlert: unknown(reason) })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    const block = await screen.findByTestId(`label-alert-${UUID}`);
    expect(block).toHaveTextContent(PHRASE[reason ?? 'none']);
  });
  it('`label_orphan` ⇒ «Guía de más en Skydropx» y CERO botones (⛔ ni «Liberar»), en las dos superficies', async () => {
    const orphan: LabelAlertDTO = { kind: 'label_orphan', since: '2026-10-04T14:20:00Z', canRelease: true };
    serveRows([row({ status: 'guia', labelAlert: orphan })]);
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([prepOrder({ labelAlert: orphan })]);
    renderWithProviders(
      <>
        <ShipmentsQueue onCaptureGuide={() => {}} />
        <PreparationQueue onCaptureGuide={() => {}} />
      </>,
      'es',
    );
    for (const id of [`label-alert-${UUID}`, `ship-label-alert-${UUID}`]) {
      const block = await screen.findByTestId(id);
      expect(within(block).getByText('Guía de más en Skydropx')).toBeInTheDocument();
      expect(block).toHaveTextContent('Hay que cancelarla en el panel de Skydropx para recuperar el saldo');
      expect(within(block).queryAllByRole('button')).toHaveLength(0);
    }
  });
  it('`canRelease:false` ⇒ «Un súper-admin puede liberarla…» y sin «Liberar»', async () => {
    role.superAdmin = false;
    serveRows([row({ labelPending: pending(), labelAlert: unknown('ambiguous', false) })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    const block = await screen.findByTestId(`label-alert-${UUID}`);
    expect(block).toHaveTextContent('Un súper-admin puede liberarla tras revisarla en el panel de Skydropx: avísale.');
    expect(block.textContent).not.toMatch(/dueño/);
    expect(screen.queryByRole('button', { name: 'Liberar' })).not.toBeInTheDocument();
  });
});

describe('UX-SDX-33 💰 · «Liberar» con los datos para cuadrar en el panel y la casilla de conflicto', () => {
  async function openRelease(rowOver: Partial<AdminShipmentDTO>) {
    serveRows([row(rowOver)]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Liberar' }));
    return screen.findByRole('dialog', { name: '¿Liberar este envío?' });
  }
  const note = (dialog: HTMLElement) =>
    fireEvent.change(within(dialog).getByLabelText('Qué revisaste (obligatorio)'), { target: { value: 'Revisé el panel de Skydropx' } });

  it('la `<dl>` trae «Pedido ENV-000045-01», el precio de `priceCents` y el destinatario; ⛔ ni uuid ni teléfono', async () => {
    const dialog = await openRelease({ labelPending: pending(), labelAlert: unknown('ambiguous') });
    const dl = within(dialog).getByTestId('release-data');
    expect(dl).toHaveTextContent('Pedido ENV-000045-01');
    expect(dl).toHaveTextContent('MX$148.50');
    expect(dl).toHaveTextContent('Ana López');
    expect(dl).toHaveTextContent('Av. Juárez 120, Centro · CP 44100');
    expect(dl).toHaveTextContent('99minutos · Día siguiente');
    expect(dl).toHaveTextContent(/Ana · /);
    expect(dialog).toHaveTextContent(PHRASE.ambiguous);
    expect(dialog.textContent).not.toContain(UUID);
    expect(dialog.textContent).not.toContain('5551234567');
    expect(dialog.textContent).not.toContain('Portón negro');
    expect(within(dialog).getByRole('button', { name: 'Copiar folio' })).toBeInTheDocument();
  });
  it('`providerReference:null` ⇒ «Esta compra no llegó a llevar folio…»; un dato ausente ⇒ «sin dato»', async () => {
    const dialog = await openRelease({ labelPending: pending({ providerReference: null, priceCents: null }), labelAlert: unknown('unreadable') });
    const dl = within(dialog).getByTestId('release-data');
    expect(dl).toHaveTextContent('Esta compra no llegó a llevar folio: búscala por destinatario, hora y precio.');
    expect(dl).toHaveTextContent('sin dato');
  });
  it('SIN conflicto ⇒ sin casilla y `confirmConflict` en false (la clave no viaja)', async () => {
    const rel = vi.spyOn(api, 'releaseShipmentLabel').mockResolvedValue({ outcome: 'released', shipment: row(), verdict: { outcome: 'not_charged', reason: null } });
    const dialog = await openRelease({ labelPending: pending(), labelAlert: unknown('ambiguous') });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    note(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar y liberar' }));
    await waitFor(() => expect(rel).toHaveBeenCalledWith(UUID, 'Revisé el panel de Skydropx', false));
  });
  it("`reason:'conflict'` ⇒ casilla; sin marcar ⇒ 0 peticiones y error bajo ella con foco; marcada ⇒ `confirmConflict:true`", async () => {
    const rel = vi.spyOn(api, 'releaseShipmentLabel').mockResolvedValue({ outcome: 'released', shipment: row(), verdict: { outcome: 'not_charged', reason: null } });
    const dialog = await openRelease({ labelPending: pending(), labelAlert: unknown('conflict') });
    const box = within(dialog).getByRole('checkbox', { name: /Revisé en el panel de Skydropx: la guía que devolvió Skydropx es del otro envío/ });
    expect(box).not.toBeChecked();
    note(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar y liberar' }));
    expect(await within(dialog).findByText(/^Marca la casilla: este envío tuvo un conflicto/)).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveFocus();
    expect(rel).not.toHaveBeenCalled();
    fireEvent.click(box);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar y liberar' }));
    await waitFor(() => expect(rel).toHaveBeenCalledWith(UUID, 'Revisé el panel de Skydropx', true));
  });
  it('`409 LABEL_NOT_RELEASABLE {reason:provider_conflict}` ⇒ su texto y APARECE la casilla', async () => {
    vi.spyOn(api, 'releaseShipmentLabel').mockRejectedValue(
      new ApiClientError(409, { code: 'LABEL_NOT_RELEASABLE', message: 'x', details: { reason: 'provider_conflict', otherShipmentId: 'shp-a' } }),
    );
    const dialog = await openRelease({ labelPending: pending(), labelAlert: unknown('ambiguous') });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    note(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar y liberar' }));
    expect(await within(dialog).findByText(/^Este envío tuvo un conflicto con otro envío\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox')).toBeInTheDocument();
  });
  it.each([
    [{ outcome: 'not_charged', reason: null }, 'Comprobamos con Skydropx que no se creó ni se cobró. El envío volvió a «preparado».'],
    [{ outcome: 'not_sent', reason: null }, 'La compra no había llegado a salir. El envío volvió a «preparado».'],
    [{ outcome: 'uncertain', reason: 'balance_moved' }, /^Liberado con tu nota: el sistema no pudo comprobarlo \(El saldo de Skydropx se movió por otra causa y no sirve para comprobarlo\)\./],
  ] as const)('respuesta por `verdict` %o ⇒ su texto', async (verdict, text) => {
    vi.spyOn(api, 'releaseShipmentLabel').mockResolvedValue({ outcome: 'released', shipment: row(), verdict: { ...verdict } });
    const dialog = await openRelease({ labelPending: pending(), labelAlert: unknown('ambiguous') });
    note(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar y liberar' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

describe('UX-SDX-34 = PS-136 · el folio en tarjeta, fila y hoja; ⛔ nunca el uuid ahí ni el folio al cliente', () => {
  it('tarjeta de «Preparar» ⇒ «Envío ENV-000045», sin uuid', async () => {
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([prepOrder()]);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    expect(await screen.findByTestId(`prep-shipment-ref-${UUID}`)).toHaveTextContent('Envío ENV-000045');
    expect(screen.getByTestId(`prep-order-${UUID}`).textContent).not.toContain(UUID);
  });
  it('fila de «Envíos» ⇒ «Envío ENV-000045», sin uuid', async () => {
    serveRows([row()]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    expect(await screen.findByTestId(`shipment-ref-${UUID}`)).toHaveTextContent('Envío ENV-000045');
    expect(screen.getByTestId(`shipment-row-${UUID}`).textContent).not.toContain(UUID);
  });
  it('sin folio (servidor anterior a M-67) ⇒ el uuid de hoy, ⛔ nunca vacío', async () => {
    serveRows([row({ folio: undefined })]);
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    expect(await screen.findByTestId(`shipment-ref-${UUID}`)).toHaveTextContent(UUID);
  });
  it('hoja de impresión ⇒ «Envío ENV-000045» tras el pedido; sin uuid', async () => {
    vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([prepOrder()]);
    renderWithProviders(<PrintSheetView destination="ship" />, 'es');
    expect(await screen.findByTestId(`print-folio-${UUID}`)).toHaveTextContent('Envío ENV-000045');
    expect(screen.getByTestId(`print-order-${UUID}`).textContent).not.toContain(UUID);
  });

  // SK15: las superficies de cliente con un DTO que trae `folio` POR ERROR ⇒ `/ENV-\d/` 0 veces.
  const leak = { folio: 'ENV-000045', providerReference: 'ENV-000045-01' };
  it('cliente · `OrderShipmentBlock`', () => {
    renderWithProviders(
      <OrderShipmentBlock
        shipment={{
          id: 'shp-c',
          status: 'enviado',
          carrier: 'Estafeta',
          trackingNumber: '999',
          requestedAt: '2026-10-01T10:00:00Z',
          pickingAt: null,
          shippedAt: '2026-10-02T10:00:00Z',
          deliveredAt: null,
          shipTo: { recipientName: 'Ana', city: 'Guadalajara', state: 'Jalisco', postalCode: '44100' },
          missingCount: 0,
          ...leak,
        }}
        publicStatus="enviado"
        fulfillmentMode="direct_ship"
      />,
      'es',
    );
    expect(document.body.textContent).not.toMatch(/ENV-\d/);
  });
  const clientShipment = (): ShipmentDTO =>
    ({ id: 'shp-c', status: 'enviado', carrier: 'Estafeta', trackingNumber: '999', createdAt: '2026-10-01T10:00:00Z', items: [], ...leak }) as ShipmentDTO;
  it('cliente · `WithdrawalsList`', async () => {
    vi.spyOn(api, 'getShipments').mockResolvedValue([clientShipment()]);
    vi.spyOn(api, 'getDisputes').mockResolvedValue([]);
    renderWithProviders(<WithdrawalsList />, 'es');
    await screen.findAllByText(/999/);
    expect(document.body.textContent).not.toMatch(/ENV-\d/);
  });
  it('cliente · `ShipmentDetailView`', async () => {
    vi.spyOn(api, 'getShipment').mockResolvedValue(clientShipment());
    renderWithProviders(<ShipmentDetailView shipmentId="shp-c" />, 'es');
    await screen.findAllByText(/999/);
    expect(document.body.textContent).not.toMatch(/ENV-\d/);
  });
});

describe('PS-164 (S-GAS-1) · «Salida de hoy» con folio', () => {
  it('con pedido ⇒ el número y «Envío ENV-…»; retiro ⇒ «Envío ENV-…» como referencia; ⛔ nunca el uuid', async () => {
    vi.spyOn(api, 'getDepartureBoard').mockResolvedValue({
      date: '2026-10-04',
      groups: [
        {
          carrierName: 'fedex',
          carrierLabel: 'FedEx',
          dropoff: null,
          isPreferred: false,
          shipments: [
            { shipmentId: UUID, orderNumber: 'TCG-000123', kind: 'guest_direct_ship', recipientName: 'Ana', city: 'Guadalajara', trackingNumber: 'G1', labelAvailable: false, labelPurchasedAt: '2026-10-04T10:00:00Z', folio: 'ENV-000045' },
            { shipmentId: 'shp-ret-uuid', orderNumber: null, kind: 'vault_withdrawal', recipientName: 'Beto', city: 'León', trackingNumber: 'G2', labelAvailable: false, labelPurchasedAt: '2026-10-04T11:00:00Z', folio: 'ENV-000046' },
          ],
        },
      ],
      manualPending: 0,
    });
    renderWithProviders(<DepartureBoard />, 'es');
    const r1 = await screen.findByTestId(`departure-row-${UUID}`);
    expect(r1).toHaveTextContent('TCG-000123 · Ana');
    expect(within(r1).getByTestId(`departure-folio-${UUID}`)).toHaveTextContent('Envío ENV-000045');
    const r2 = screen.getByTestId('departure-row-shp-ret-uuid');
    expect(r2).toHaveTextContent('Envío ENV-000046 · Beto');
    expect(document.body.textContent).not.toContain('shp-ret-uuid');
    expect(document.body.textContent).not.toContain(UUID);
  });
});
