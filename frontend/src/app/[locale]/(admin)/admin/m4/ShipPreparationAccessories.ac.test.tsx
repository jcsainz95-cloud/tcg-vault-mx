import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PreparationQueue } from './PreparationQueue';
import * as api from '@/lib/api';
import { shipAccLine } from '@/test/accessories.testkit';
import type { ShipAccessoryLineDTO, ShipPreparationOrderDTO } from '@/types/contract';

/**
 * Preparación con accesorios — `API_CONTRACT §AC.9` (+ errata v1.86.1), `DESIGN_SYSTEM §AC-UX.12`.
 * AC-F12 / AC-UX-13: renglones, faltante por cantidad, desglose del paquete por tipo, caja y «REVISAR CAJA»;
 * «Pedido preparado» apagado con un accesorio `pending` aunque el servidor cuente 0 cartas pendientes.
 * AC-F16: cada fila del diálogo pinta `refund.amountCents`; al elegir «faltan k» el importe es
 * `amountByQtyCents[k−1]`; el título es `refundPreviewCents` LEÍDO (⛔ nunca sumado aquí).
 * AC-F17: con `deckAllMissing` el paquete sugiere marcarse faltante; no se marca solo.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.restoreAllMocks());

const BUNDLE = shipAccLine({
  id: 'sal-b',
  kind: 'energy_bundle',
  name: 'Paquete de energías — Dragapult ex',
  deckName: 'Dragapult ex',
  photo: null,
  components: [
    { energyType: 'fire', quantity: 8 },
    { energyType: 'water', quantity: 4 },
  ],
  refund: { kind: 'refundable', amountByQtyCents: [2093], amountCents: 2093 },
});
const SLEEVES = shipAccLine({
  id: 'sal-s',
  name: 'Penny sleeves x100',
  quantity: 3,
  refund: { kind: 'refundable', amountByQtyCents: [9310, 18620, 27930], amountCents: 27930 },
});

function order(
  accessoryLines: ShipAccessoryLineDTO[],
  over: Partial<ShipPreparationOrderDTO> & { refundPreviewCents?: number } = {},
): ShipPreparationOrderDTO {
  const { refundPreviewCents = 0, ...rest } = over;
  return {
    destination: 'ship',
    shipmentId: 'shp-1',
    kind: 'guest_direct_ship',
    orderId: 'ord-1',
    orderNumber: 'TCG-000300',
    requestedAt: '2026-10-07T10:00:00Z',
    customer: { userId: null, email: 'g@example.com', lastName: 'Pérez', fullName: 'Juan Pérez' },
    preparation: { status: 'in_progress', refundPreviewCents, total: 0, pending: 0, picked: 0, missing: 0, blocked: 0 },
    shipTo: { recipientName: 'Juan', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5550000000' },
    items: [],
    accessoryLines,
    box: null,
    ...rest,
  };
}

function serve(o: ShipPreparationOrderDTO) {
  vi.spyOn(api, 'getAdminPreparationQueue').mockResolvedValue([o]);
}
const card = () => screen.findByTestId('prep-order-shp-1');

describe('AC-UX-13 (AC-F12) · renglones de accesorio y caja', () => {
  it('paquete: una línea por tipo; caja con medidas y «REVISAR CAJA» con su explicación', async () => {
    serve(
      order([BUNDLE, SLEEVES], {
        box: { code: 'grande', label: 'Grande', lengthCm: 40, widthCm: 30, heightCm: 20, review: true, contentWeightG: 1450 },
      }),
    );
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    const b = within(c).getByTestId('prep-acc-sal-b');
    expect(within(b).getByText('Fuego ×8')).toBeInTheDocument();
    expect(within(b).getByText('Agua ×4')).toBeInTheDocument();
    expect(within(c).getByText('ACCESORIOS')).toBeInTheDocument();
    expect(within(c).getByText('Caja: Grande · 40×30×20 cm · accesorios 1.5 kg')).toBeInTheDocument();
    expect(within(c).getByText('REVISAR CAJA')).toBeInTheDocument();
    expect(
      within(c).getByText('No cupo en ninguna caja registrada: se cobró la más grande. Decide cómo empacarlo (dos paquetes o una caja especial). Lo cobrado no cambia.'),
    ).toBeInTheDocument();
    expect(within(within(c).getByTestId('prep-acc-sal-s')).getByText('×3')).toBeInTheDocument();
  });

  it('«Pedido preparado» apagado con un accesorio pending aunque el servidor cuente 0 cartas pendientes', async () => {
    serve(order([SLEEVES]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    expect(within(c).getByRole('button', { name: 'Pedido preparado' })).toBeDisabled();
  });

  it('paquete: «Falta el paquete» manda missingQty: 1 (el paquete entero)', async () => {
    serve(order([BUNDLE]));
    const spy = vi.spyOn(api, 'setShipPrepAccessoryLine').mockResolvedValue(undefined);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const b = within(await card()).getByTestId('prep-acc-sal-b');
    expect(within(b).getByText('Si falta solo una parte, complétala del estante: las energías ya estaban apartadas.')).toBeInTheDocument();
    fireEvent.click(within(b).getByRole('button', { name: /^Falta el paquete/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('shp-1', 'sal-b', { status: 'missing', missingQty: 1, missingReason: 'not_found' }),
    );
  });

  it('accesorio ×1: «Lo tengo» / «No lo encontré» / «Llegó dañado»', async () => {
    serve(order([shipAccLine({ id: 'sal-1', name: 'Deck box' })]));
    const spy = vi.spyOn(api, 'setShipPrepAccessoryLine').mockResolvedValue(undefined);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const row = within(await card()).getByTestId('prep-acc-sal-1');
    const group = within(row).getByRole('group');
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Lo tengo', 'No lo encontré', 'Llegó dañado']);
    fireEvent.click(within(group).getByRole('button', { name: /^Llegó dañado/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('shp-1', 'sal-1', { status: 'missing', missingQty: 1, missingReason: 'damaged' }),
    );
  });

  it('AC-F16 · ×3: «Faltan…» abre en la fila el stepper; el importe sale de amountByQtyCents[k−1]', async () => {
    serve(order([SLEEVES]));
    const spy = vi.spyOn(api, 'setShipPrepAccessoryLine').mockResolvedValue(undefined);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const row = within(await card()).getByTestId('prep-acc-sal-s');
    fireEvent.click(within(row).getByRole('button', { name: /^Faltan…/ }));
    const qty = within(row).getByRole('spinbutton', { name: '¿Cuántas faltan?' });
    expect(qty).toHaveValue(1);
    expect(within(row).getByText(/93\.10/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Agregar una' }));
    expect(within(row).getByText(/186\.20/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('radio', { name: 'Llegaron dañadas' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Marcar' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('shp-1', 'sal-s', { status: 'missing', missingQty: 2, missingReason: 'damaged' }),
    );
  });

  it('marcas: «Faltan 2 de 3»; settledWithoutStock; refunded ⇒ sin «Deshacer» y «marca fija»', async () => {
    serve(
      order([
        { ...SLEEVES, prepStatus: 'missing', missingQty: 2, missingReason: 'not_found', refund: { kind: 'refundable', amountByQtyCents: [9310, 18620, 27930], amountCents: 18620 } },
        shipAccLine({ id: 'sal-x', name: 'Playmat', settledWithoutStock: true }),
        shipAccLine({
          id: 'sal-r',
          name: 'Toploader',
          prepStatus: 'missing',
          missingQty: 1,
          missingReason: 'not_found',
          refunded: true,
          refund: {
            kind: 'refunded',
            refund: {
              id: 'pr-9',
              kind: 'item_missing',
              status: 'succeeded',
              amountCents: 9310,
              missingReason: 'not_found',
              requestedAt: '2026-10-07T10:00:00Z',
              requestedBy: { userId: 'u', name: 'Op', role: 'vault_operator' },
              submittedAt: null,
              succeededAt: '2026-10-07T10:01:00Z',
              failedAt: null,
              failureCode: null,
              replacementCaseId: null,
            },
          } as never,
        }),
      ]),
    );
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    expect(within(within(c).getByTestId('prep-acc-sal-s')).getByText('Faltan 2 de 3')).toBeInTheDocument();
    expect(within(within(c).getByTestId('prep-acc-sal-s')).getByText(/186\.20/)).toBeInTheDocument();
    expect(within(within(c).getByTestId('prep-acc-sal-x')).getByText('SIN EXISTENCIAS AL COBRAR')).toBeInTheDocument();
    const r = within(c).getByTestId('prep-acc-sal-r');
    expect(within(r).getByText('Ya se reembolsó; la marca es fija.')).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: /Deshacer/ })).toBeNull();
  });

  it('AC-F16 · diálogo: filas con refund.amountCents del servidor y título = refundPreviewCents LEÍDO', async () => {
    // refundPreviewCents NO es la suma de lo pintado (18620 + 2093 = 20713): la pantalla debe leerlo.
    const lines = [
      { ...SLEEVES, prepStatus: 'missing' as const, missingQty: 2, missingReason: 'not_found' as const, refund: { kind: 'refundable' as const, amountByQtyCents: [9310, 18620, 27930], amountCents: 18620 } },
      { ...BUNDLE, prepStatus: 'missing' as const, missingQty: 1, missingReason: 'not_found' as const },
    ];
    serve(order(lines, { refundPreviewCents: 77777 }));
    const prepare = vi.spyOn(api, 'prepareShipment').mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const c = await card();
    fireEvent.click(within(c).getByRole('button', { name: 'Pedido preparado' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/777\.77/);
    expect(dialog).not.toHaveTextContent(/207\.13/);
    expect(within(dialog).getByText(/Penny sleeves x100 — faltan 2 de 3 · .*186\.20/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Paquete de energías — Dragapult ex — no está · .*20\.93/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId('ship-prepare-confirm'));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith('shp-1', 77777));
  });
});

describe('AC-F17 · sugerencia del paquete con todo su deck faltante', () => {
  it('deckAllMissing = true ⇒ sugiere; el paquete sigue pendiente (no se marca solo)', async () => {
    serve(order([{ ...BUNDLE, deckAllMissing: true, deckShipmentItemIds: ['sit-a'] }]));
    const spy = vi.spyOn(api, 'setShipPrepAccessoryLine');
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const b = within(await card()).getByTestId('prep-acc-sal-b');
    expect(within(b).getByText('Faltan todas las cartas de este deck: marca también el paquete como faltante.')).toBeInTheDocument();
    expect(b).toHaveAttribute('data-prep-status', 'pending');
    expect(spy).not.toHaveBeenCalled();
  });

  it('deckAllMissing = false ⇒ sin sugerencia', async () => {
    serve(order([BUNDLE]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');
    const b = within(await card()).getByTestId('prep-acc-sal-b');
    expect(within(b).queryByText(/Faltan todas las cartas de este deck/)).toBeNull();
  });
});
