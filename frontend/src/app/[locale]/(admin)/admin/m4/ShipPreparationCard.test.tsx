import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PreparationQueue } from './PreparationQueue';
import { moneyOutLimitDetailsOf } from './ShipPreparationCard';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { ShipPreparationItemDTO, ShipPreparationOrderDTO, ShipPreparationStateDTO } from '@/types/contract';

/**
 * **La tarjeta de ENVÍO palomea** (`DESIGN_SYSTEM §37.3–§37.5`, contrato `§M4-SHIP.4/.5`). Candados
 * `PS-UI-3`, `PS-UI-4` y `PS-UI-5` de §37.18, más la guía bloqueada mientras hay casos abiertos.
 *
 * Regla S1/S2 (§37.0): la cifra del reembolso la produce el SERVIDOR (`refundPreviewCents`) y esta pantalla
 * la repite tal cual en la fila, en el conteo y en el botón del diálogo; el `POST` lleva esa misma cifra como
 * `expectedRefundCents`. Un `409 REFUND_PREVIEW_STALE` vuelve a pedir la confirmación con la cifra nueva y
 * ⛔ nunca reintenta solo. **31458** es la cifra de ejemplo del contrato (`§M4-SHIP.4`).
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function counts(items: ShipPreparationItemDTO[]) {
  const c = {
    total: items.length,
    pending: 0,
    picked: 0,
    missing: 0,
    blocked: 0,
  };
  for (const i of items) {
    if (i.availability.kind === 'blocked') c.blocked += 1;
    else c[i.prepStatus] += 1;
  }
  return c;
}

function prep(
  items: ShipPreparationItemDTO[],
  refundPreviewCents: number,
  prepared = false,
  openReplacements = 0,
): ShipPreparationStateDTO {
  return prepared
    ? {
        status: 'prepared',
        preparedAt: '2026-09-28T17:20:00Z',
        preparedBy: { userId: 'u-op1', name: 'Operador' },
        openReplacements,
        ...counts(items),
      }
    : { status: 'in_progress', refundPreviewCents, ...counts(items) };
}

const item = (id: string, over: Partial<ShipPreparationItemDTO> = {}): ShipPreparationItemDTO => ({
  shipmentItemId: `sit-${id}`,
  inventoryItemId: `inv-${id}`,
  folio: `INV-${id}`,
  quantity: 1,
  card: {
    name: `Carta ${id}`,
    setName: 'Base Set',
    finish: 'holofoil',
    conditionLabel: 'NM',
    imageSmallUrl: null,
  },
  currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
  prepStatus: 'pending',
  missingReason: null,
  prepMarkedBy: null,
  availability: { kind: 'available' },
  refund: { kind: 'refundable', amountCents: 31458 },
  ...over,
});

function shipOrder(
  items: ShipPreparationItemDTO[],
  over: Partial<ShipPreparationOrderDTO> & {
    refundPreviewCents?: number;
    prepared?: boolean;
    openReplacements?: number;
  } = {},
): ShipPreparationOrderDTO {
  const { refundPreviewCents = 0, prepared = false, openReplacements = 0, ...rest } = over;
  return {
    destination: 'ship',
    shipmentId: 'shp-1',
    kind: 'guest_direct_ship',
    orderId: 'ord-1',
    orderNumber: 'TCG-000123',
    requestedAt: '2026-09-20T10:00:00Z',
    customer: {
      userId: 'u-1',
      email: 'ash@example.com',
      lastName: 'Ketchum',
      fullName: 'Ash Ketchum',
    },
    preparation: prep(items, refundPreviewCents, prepared, openReplacements),
    shipTo: {
      recipientName: 'Ash Ketchum',
      line1: 'Calle 1',
      city: 'CDMX',
      state: 'CDMX',
      postalCode: '01000',
      country: 'MX',
      phone: '5550000000',
    },
    items,
    ...rest,
  };
}

/** La cola «del servidor»: el espía lee SIEMPRE el estado actual, así una prueba lo cambia tras un verbo. */
function serve(order: ShipPreparationOrderDTO | null) {
  const state = { order };
  vi.spyOn(api, 'getAdminPreparationQueue').mockImplementation(async ({ destination } = {}) =>
    state.order && (!destination || destination === 'ship') ? [state.order] : [],
  );
  return state;
}

const card = () => screen.findByTestId('prep-order-shp-1');

describe('PS-UI-5 · la fila pendiente tiene EXACTAMENTE tres verbos', () => {
  it('«La tengo», «No la encontré», «Llegó dañada» — y nada más en el grupo', async () => {
    serve(shipOrder([item('a')]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const row = within(await card()).getByTestId('prep-item-sit-a');
    const group = within(row).getByRole('group');
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['La tengo', 'No la encontré', 'Llegó dañada']);
    // El nombre accesible lleva carta y folio (§36.12): «{acción}: {carta} · {folio}».
    expect(buttons[2]).toHaveAttribute('aria-label', 'Llegó dañada: Carta a · INV-a');
  });

  it('«Llegó dañada» manda `missingReason: damaged`; la marca se pinta con la RESPUESTA del servidor', async () => {
    const items = [item('a')];
    serve(shipOrder(items));
    const damaged = {
      ...items[0],
      prepStatus: 'missing' as const,
      missingReason: 'damaged' as const,
    };
    const spy = vi.spyOn(api, 'setShipPrepItem').mockResolvedValue({
      changed: true,
      item: damaged,
      preparation: prep([damaged], 31458),
    });
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const row = within(await card()).getByTestId('prep-item-sit-a');
    fireEvent.click(within(row).getByRole('button', { name: /^Llegó dañada:/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-1', 'sit-a', 'missing', 'damaged'));
    await waitFor(() => expect(row).toHaveTextContent('Dañada'));
  });
});

describe('PS-UI-3 · la cifra del servidor se repite en fila, conteo y botón; el POST la lleva', () => {
  it('missing refundable 31458 + refundPreviewCents 31458 ⇒ «314.58» tres veces y `expectedRefundCents: 31458`', async () => {
    const items = [
      item('a', {
        prepStatus: 'missing',
        missingReason: 'not_found',
        prepMarkedBy: { userId: 'u-op1', name: 'Op' },
      }),
    ];
    serve(shipOrder(items, { refundPreviewCents: 31458 }));
    const spy = vi.spyOn(api, 'prepareShipment').mockResolvedValue({
      outcome: 'prepared',
      shipment: { id: 'shp-1', status: 'picking' },
      preparation: prep(items, 0, true),
      refunds: [
        {
          id: 'pr-1',
          kind: 'item_missing',
          status: 'submitted',
          amountCents: 31458,
          missingReason: 'not_found',
          requestedAt: '2026-09-29T10:00:00Z',
          requestedBy: { userId: 'u-op1', name: 'Op', role: 'vault_operator' },
          submittedAt: '2026-09-29T10:00:01Z',
          succeededAt: null,
          failedAt: null,
          failureCode: null,
          replacementCaseId: null,
        },
      ],
      cases: [],
    } as never);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const c = await card();
    expect(within(c).getByTestId('ship-refund-line-sit-a')).toHaveTextContent('314.58');
    expect(within(c).getByTestId('ship-refund-preview-shp-1')).toHaveTextContent('314.58');

    fireEvent.click(within(c).getByRole('button', { name: 'Pedido preparado' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('ship-prepare-confirm')).toHaveTextContent('314.58');
    // Foco inicial en «Cancelar» (S9): la confirmación no se dispara con un Enter distraído.
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    fireEvent.click(within(dialog).getByTestId('ship-prepare-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-1', 31458));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('con `refundPreviewCents: 0` y sin faltantes ⛔ no se abre diálogo: el POST sale directo con 0', async () => {
    const items = [
      item('a', {
        prepStatus: 'picked',
        prepMarkedBy: { userId: 'u-op1', name: 'Op' },
      }),
    ];
    serve(shipOrder(items));
    const spy = vi.spyOn(api, 'prepareShipment').mockResolvedValue({
      outcome: 'prepared',
      shipment: { id: 'shp-1', status: 'picking' },
      preparation: prep(items, 0, true),
      refunds: [],
      cases: [],
    } as never);
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    fireEvent.click(within(await card()).getByRole('button', { name: 'Pedido preparado' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-1', 0));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('con una carta por palomear el botón está apagado y la frase dice cuántas faltan', async () => {
    serve(shipOrder([item('a'), item('b', { prepStatus: 'picked' })]));
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const c = await card();
    expect(within(c).getByRole('button', { name: 'Pedido preparado' })).toBeDisabled();
    expect(c).toHaveTextContent('Falta 1 carta por palomear');
  });
});

describe('PS-UI-4 · `409 REFUND_PREVIEW_STALE` reabre con la cifra nueva y ⛔ no reintenta solo', () => {
  it('{refundCents: 31000} ⇒ el diálogo sigue abierto con «310.00» y hubo UN solo POST', async () => {
    const items = [item('a', { prepStatus: 'missing', missingReason: 'not_found' })];
    serve(shipOrder(items, { refundPreviewCents: 31458 }));
    const spy = vi.spyOn(api, 'prepareShipment').mockRejectedValue(
      new ApiClientError(409, {
        code: 'REFUND_PREVIEW_STALE',
        message: 'stale',
        details: { refundCents: 31000 },
      }),
    );
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const c = await card();
    fireEvent.click(within(c).getByRole('button', { name: 'Pedido preparado' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('ship-prepare-confirm'));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByTestId('ship-prepare-confirm')).toHaveTextContent('310.00'));
    expect(c).toHaveTextContent('ahora son MX$310.00');
    // Sin nueva pulsación: sigue habiendo exactamente una llamada.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('v1.80.7 · `403 MONEY_OUT_LIMIT_EXCEEDED` trae `{capCents, usedCents, requestedCents}` tipados y el copy va SIN cifra (§37.4)', () => {
  it('el pie dice la frase de §37.4 y ⛔ ninguna de las tres cifras aparece; hubo UN solo POST', async () => {
    const items = [item('a', { prepStatus: 'missing', missingReason: 'not_found' })];
    serve(shipOrder(items, { refundPreviewCents: 31458 }));
    const spy = vi.spyOn(api, 'prepareShipment').mockRejectedValue(
      new ApiClientError(403, {
        code: 'MONEY_OUT_LIMIT_EXCEEDED',
        message: 'cap',
        details: { capCents: 91457, usedCents: 60000, requestedCents: 31458 },
      }),
    );
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const c = await card();
    fireEvent.click(within(c).getByRole('button', { name: 'Pedido preparado' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByTestId('ship-prepare-confirm'));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(c).toHaveTextContent('Este reembolso supera lo que puedes devolver en 24 horas. No se preparó nada y el intento quedó en bitácora.'),
    );
    expect(c).not.toHaveTextContent('914.57');
    expect(c).not.toHaveTextContent('600.00');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('`moneyOutLimitDetailsOf`: los tres enteros ⇒ tipados; falta uno ⇒ null (no se inventan cifras)', () => {
    expect(moneyOutLimitDetailsOf({ capCents: 91457, usedCents: 60000, requestedCents: 31458 })).toEqual({
      capCents: 91457,
      usedCents: 60000,
      requestedCents: 31458,
    });
    expect(moneyOutLimitDetailsOf({ capCents: 91457, usedCents: 60000 })).toBeNull();
    expect(moneyOutLimitDetailsOf({ capCents: '91457', usedCents: 60000, requestedCents: 31458 })).toBeNull();
    expect(moneyOutLimitDetailsOf(undefined)).toBeNull();
  });
});

describe('preparado · guía y deshacer (§37.4–§37.5)', () => {
  it('preparado ⇒ «Capturar guía» habilitado, «Deshacer preparado» con confirmación', async () => {
    const items = [item('a', { prepStatus: 'picked' })];
    const state = serve(shipOrder(items, { prepared: true }));
    const onCapture = vi.fn();
    const undo = vi.spyOn(api, 'unprepareShipment').mockImplementation(async () => {
      state.order = shipOrder(items); // el servidor ya lo tiene sin preparar cuando la cola se relee
      return {
        outcome: 'unprepared',
        shipment: { id: 'shp-1', status: 'picking' },
        preparation: prep(items, 0),
      } as never;
    });
    renderWithProviders(<PreparationQueue onCaptureGuide={onCapture} />, 'es');

    const c = await card();
    expect(c).toHaveTextContent('Paso 2 de 2 · Empaca y captura la guía');
    fireEvent.click(within(c).getByRole('button', { name: 'Capturar guía' }));
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 'shp-1' }));

    fireEvent.click(within(c).getByRole('button', { name: 'Deshacer preparado' }));
    const dialog = await screen.findByRole('dialog', {
      name: '¿Deshacer «preparado»?',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deshacer preparado' }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith('shp-1'));
    await waitFor(() => expect(c).toHaveTextContent('Paso 1 de 2 · Junta y palomea'));
  });

  it('retiro preparado con casos abiertos: la guía se APAGA y la frase nombra la espera (v1.80.1)', async () => {
    const items = [
      item('a', {
        prepStatus: 'missing',
        missingReason: 'not_found',
        refund: {
          kind: 'replacement',
          case: {
            id: 'rc-1',
            status: 'open',
            missingReason: 'not_found',
            openedAt: '2026-09-28T10:00:00Z',
            resolvedAt: null,
            replacement: null,
          },
        },
      }),
    ];
    serve(
      shipOrder(items, {
        prepared: true,
        openReplacements: 1,
        kind: 'vault_withdrawal',
        orderId: null,
        orderNumber: null,
      }),
    );
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const c = await card();
    expect(within(c).getByRole('button', { name: 'Capturar guía' })).toBeDisabled();
    expect(c).toHaveTextContent('Este retiro espera 1 carta que se está reponiendo');
    expect(c).toHaveTextContent('Paso 2 de 2 · Esperando reposición (1)');
  });

  it('retiro con TODAS las líneas bloqueadas por el reclamo (v1.80.6): «Nada que enviar» y el cierre por preparado', async () => {
    const items = [
      item('a', {
        availability: {
          kind: 'blocked',
          reason: 'piece_not_available',
          pieceStatus: 'in_stock',
        },
        refund: { kind: 'to_replacement' },
      }),
    ];
    const state = serve(
      shipOrder(items, {
        kind: 'vault_withdrawal',
        orderId: null,
        orderNumber: null,
      }),
    );
    const spy = vi.spyOn(api, 'prepareShipment').mockImplementation(async () => {
      state.order = null; // cerrado: el servidor ya no lo lista
      return {
        outcome: 'closed_nothing_to_ship',
        shipment: { id: 'shp-1', status: 'cancelado' },
        preparation: prep(items, 0, true),
        refunds: [
          {
            id: 'pr-2',
            kind: 'shipment_fee',
            status: 'submitted',
            amountCents: 15000,
            missingReason: null,
            requestedAt: '2026-09-29T10:00:00Z',
            requestedBy: {
              userId: 'u-op1',
              name: 'Op',
              role: 'vault_operator',
            },
            submittedAt: null,
            succeededAt: null,
            failedAt: null,
            failureCode: null,
            replacementCaseId: null,
          },
        ],
        cases: [],
      } as never;
    });
    renderWithProviders(<PreparationQueue onCaptureGuide={() => {}} />, 'es');

    const c = await card();
    expect(c).toHaveTextContent('Nada que enviar: se devolverá la tarifa');
    fireEvent.click(within(c).getByRole('button', { name: 'Pedido preparado' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shp-1', 0));
    // El retiro sale de la lista con su aviso.
    await waitFor(() => expect(screen.queryByTestId('prep-order-shp-1')).not.toBeInTheDocument());
  });
});
