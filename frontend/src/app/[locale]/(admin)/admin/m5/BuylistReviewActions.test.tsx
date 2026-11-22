import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as flujo from '@/lib/api';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockAdminBuylist, mockAdminBuylistDTO } from '@/lib/mock/fixtures';
import es from '../../../../../../messages/es.json';
import { ConvertAllButton, PickupLine, RevisePricePanel, ReviewItemActions, parsePesosToCents } from './BuylistReviewActions';

const F2 = es.admin.m5.flow.f2;
const getErr = (e: unknown) => (e instanceof Error ? e.message : 'x');

function reqOf(id: string) {
  const row = mockAdminBuylist.find((r) => r.id === id)!;
  return mockAdminBuylistDTO(row);
}

afterEach(() => vi.restoreAllMocks());

describe('parsePesosToCents', () => {
  it('convierte lo que TECLEA el operador y rechaza lo ambiguo', () => {
    expect(parsePesosToCents('5,700.00')).toBe(570_000);
    expect(parsePesosToCents('$5700')).toBe(570_000);
    expect(parsePesosToCents('12.5')).toBe(1_250);
    expect(parsePesosToCents('')).toBeNull();
    expect(parsePesosToCents('1.234')).toBeNull();
    expect(parsePesosToCents('-3')).toBeNull();
  });
});

describe('ReviewItemActions · cuatro acciones y baja pendiente (F2c)', () => {
  it('línea `buy` por decidir ⇒ Aprobar al pactado, Bajar precio, No aceptar y No llegó', () => {
    const item = reqOf('sr-3020').items.find((i) => i.id === 'sri-f2-2')!;
    renderWithProviders(<ReviewItemActions item={item} panel={null} onPanel={() => {}} onApprove={() => {}} approving={false} />, 'es');
    expect(screen.getByRole('button', { name: F2.actions.approve })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`^${F2.actions.reduce}`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`^${F2.actions.reject}`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: F2.actions.notReceived })).toBeInTheDocument();
  });

  it('baja pendiente ⇒ «Esperando al vendedor · vence en N días», y el neto SI ACEPTA es el del servidor (sin botones de decisión)', () => {
    const item = reqOf('sr-3020').items.find((i) => i.id === 'sri-f2-3')!;
    expect(item.revision?.netIfAcceptedCents).toBeTypeOf('number');
    renderWithProviders(<ReviewItemActions item={item} panel={null} onPanel={() => {}} onApprove={() => {}} approving={false} />, 'es');
    const w = screen.getByTestId('f2-waiting-sri-f2-3');
    expect(w.textContent).toMatch(/Esperando al vendedor · vence en 1 día/);
    expect(w.textContent).toContain('Propusimos MX$1,100.00 (antes MX$1,450.00)');
    // Paridad: lo mostrado es EXACTAMENTE el neto que manda el servidor (no se recalcula).
    const net = item.revision!.netIfAcceptedCents as number;
    expect(screen.getByTestId('f2-net-if-sri-f2-3').textContent).toContain(
      (net / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    );
    // Anexo §3.2: aprobar o rechazar con la baja pendiente la RETIRA; la fila lo dice y ofrece ambas acciones.
    expect(screen.getByTestId('f2-cancels-sri-f2-3')).toHaveTextContent('se cancela');
    expect(screen.getByRole('button', { name: F2.actions.approveCancels })).toBeInTheDocument();
    expect(screen.getByTestId('f2-reject-sri-f2-3')).toHaveTextContent(F2.actions.rejectCancels);
    expect(screen.queryByRole('button', { name: F2.actions.reduce })).not.toBeInTheDocument();
  });

  it('aprobar con baja pendiente llama onApprove (el servidor cancela la baja)', () => {
    const item = reqOf('sr-3020').items.find((i) => i.id === 'sri-f2-3')!;
    const onApprove = vi.fn();
    renderWithProviders(<ReviewItemActions item={item} panel={null} onPanel={() => {}} onApprove={onApprove} approving={false} />, 'es');
    fireEvent.click(screen.getByTestId('f2-approve-sri-f2-3'));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});

describe('RevisePricePanel · neto en vivo del servidor (F2c)', () => {
  function setup() {
    const req = reqOf('sr-3020');
    const item = req.items.find((i) => i.id === 'sri-f2-2')!;
    const onDone = vi.fn();
    renderWithProviders(<RevisePricePanel req={req} item={item} getError={getErr} onClose={() => {}} onDone={onDone} />, 'es');
    return { req, item, onDone };
  }
  const type = (v: string) => fireEvent.change(screen.getByTestId('f2-revise-amount-sri-f2-2'), { target: { value: v } });

  it('teclear un monto llama al preview (debounce) y pinta SOLO lo que regresa; enviar manda el body del contrato', async () => {
    const preview = vi.spyOn(flujo, 'previewBuylistRevision').mockResolvedValue({
      itemId: 'sri-f2-2',
      offeredPriceCents: 620_000,
      revisedPriceCents: 570_000,
      payout: { grossCents: 2_550_000, shippingFeeCents: 18_000, netCents: 2_532_000, isFinal: true },
    });
    const send = vi.spyOn(flujo, 'reviseBuylistItemPrice').mockResolvedValue(reqOf('sr-3020'));
    const { onDone } = setup();
    expect(screen.getByTestId('f2-revise-send-sri-f2-2')).toBeDisabled();
    type('5,700.00');
    // Debounce: no llama en cada tecla.
    expect(preview).not.toHaveBeenCalled();
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview).toHaveBeenCalledWith('sri-f2-2', 570_000);
    expect((await screen.findByTestId('f2-revise-net-value-sri-f2-2')).textContent).toBe('MX$25,320.00');
    fireEvent.click(screen.getByTestId('f2-revise-send-sri-f2-2'));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith('sri-f2-2', { revisedPriceCents: 570_000, reasonCode: 'condition_mismatch' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('preview con isFinal=false ⇒ el neto se rotula «estimado» (solo se pinta el monto del servidor)', async () => {
    vi.spyOn(flujo, 'previewBuylistRevision').mockResolvedValue({
      itemId: 'sri-f2-2',
      offeredPriceCents: 620_000,
      revisedPriceCents: 570_000,
      payout: { grossCents: 2_550_000, shippingFeeCents: 18_000, netCents: 2_532_000, isFinal: false },
    });
    setup();
    type('5,700.00');
    const val = await screen.findByTestId('f2-revise-net-value-sri-f2-2');
    expect(val.textContent).toBe('MX$25,320.00');
    expect(screen.getByTestId('f2-revise-net-sri-f2-2')).toHaveTextContent(F2.revise.netLabelEstimated);
    expect(screen.getByTestId('f2-revise-net-sri-f2-2')).toHaveTextContent(F2.revise.netNoteEstimated);
  });

  it('un precio igual o mayor al pactado NO llama al preview ni habilita el envío', async () => {
    const preview = vi.spyOn(flujo, 'previewBuylistRevision');
    setup();
    type('6,200.00');
    await new Promise((r) => setTimeout(r, 400));
    expect(preview).not.toHaveBeenCalled();
    expect(screen.getByTestId('f2-revise-send-sri-f2-2')).toBeDisabled();
  });

  it.each([
    [422, 'REVISION_NOT_LOWER', 'El nuevo precio debe ser mayor que cero y menor al pactado (MX$6,200.00).'],
    [422, 'ITEM_NOT_OFFERED', F2.revise.errors.notOffered],
    [422, 'REQUEST_NOT_RECEIVED', F2.revise.errors.notReceived],
    [409, 'REVISION_ALREADY_RESOLVED', F2.revise.errors.resolved],
    [409, 'REVISION_PENDING', F2.revise.errors.pending],
    [400, 'VALIDATION_ERROR', F2.revise.errors.invalid],
  ])('el %i %s al enviar se muestra con su copy en el panel', async (status, code, text) => {
    vi.spyOn(flujo, 'previewBuylistRevision').mockResolvedValue({
      itemId: 'sri-f2-2',
      offeredPriceCents: 620_000,
      revisedPriceCents: 570_000,
      payout: { grossCents: 1, shippingFeeCents: 0, netCents: 1, isFinal: true },
    });
    vi.spyOn(flujo, 'reviseBuylistItemPrice').mockRejectedValue(new ApiClientError(status, { code, message: 'srv' }));
    setup();
    type('5700');
    await waitFor(() => expect(screen.getByTestId('f2-revise-send-sri-f2-2')).toBeEnabled());
    fireEvent.click(screen.getByTestId('f2-revise-send-sri-f2-2'));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});

describe('ConvertAllButton · diálogo con ubicación y lista (F2a)', () => {
  const req = () => reqOf('sr-3021');

  it('lista las cartas aprobadas, manda la ubicación elegida y avisa al terminar', async () => {
    vi.spyOn(api, 'getLocations').mockResolvedValue([
      { id: 'loc-1', zone: 'platform_stock', box: 'C03', row: 'F02', slot: 'S15', label: 'C03-F02-S15', isActive: true, createdAt: '' },
    ]);
    const run = vi.spyOn(flujo, 'convertAllBuylist').mockResolvedValue({
      converted: [
        { itemId: 'sri-f2-5', inventoryItemId: 'i1' },
        { itemId: 'sri-f2-6', inventoryItemId: 'i2' },
        { itemId: 'sri-f2-7', inventoryItemId: 'i3' },
      ],
      skipped: [{ itemId: 'sri-f2-8', code: 'NOT_APPROVED' }],
      failed: [],
    });
    const onDone = vi.fn();
    renderWithProviders(<ConvertAllButton req={req()} onDone={onDone} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todas (3)' }));
    const list = await screen.findByTestId('f2-convert-all-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    await screen.findByRole('option', { name: 'C03-F02-S15' });
    fireEvent.change(screen.getByTestId('f2-convert-all-location'), { target: { value: 'loc-1' } });
    fireEvent.click(screen.getByTestId('f2-convert-all-confirm'));
    await waitFor(() => expect(run).toHaveBeenCalledWith('sr-3021', 'loc-1'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Se dieron de alta 3 cartas en inventario.'));
  });

  it('éxito parcial ⇒ el diálogo queda abierto con el resumen y permite reintentar', async () => {
    vi.spyOn(api, 'getLocations').mockResolvedValue([]);
    vi.spyOn(flujo, 'convertAllBuylist').mockResolvedValue({
      converted: [{ itemId: 'sri-f2-5', inventoryItemId: 'i1' }],
      skipped: [],
      failed: [{ itemId: 'sri-f2-6', code: 'LOCATION_NOT_AVAILABLE' }],
    });
    renderWithProviders(<ConvertAllButton req={req()} onDone={() => {}} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todas (3)' }));
    fireEvent.click(await screen.findByTestId('f2-convert-all-confirm'));
    expect(await screen.findByText(/Dadas de alta: 1\. Omitidas: 0\. Con error: 1\./)).toBeInTheDocument();
    expect(screen.getByTestId('f2-convert-all-confirm')).toBeEnabled();
    // I-2: la UI dice QUÉ carta falló y POR QUÉ (código del servidor traducido).
    const failed = screen.getByTestId('f2-convert-all-failed-sri-f2-6');
    expect(failed).toHaveTextContent(F2.convertAll.failCodes.LOCATION_NOT_AVAILABLE);
    expect(failed.textContent).toMatch(/\S+ · .+/);
  });

  it('el mock real de convert-all con ubicación inexistente responde 200 con failed[] por línea (no 422)', async () => {
    const r = await api.convertAllBuylist('sr-3021', 'no-existe');
    expect(r.converted).toHaveLength(0);
    expect(r.failed.length).toBeGreaterThan(0);
    expect(new Set(r.failed.map((f) => f.code))).toEqual(new Set(['LOCATION_NOT_AVAILABLE']));
  });

  it('422 LOCATION_NOT_AVAILABLE ⇒ pide otra ubicación; sin cartas aprobadas no se pinta', async () => {
    vi.spyOn(api, 'getLocations').mockResolvedValue([]);
    vi.spyOn(flujo, 'convertAllBuylist').mockRejectedValue(new ApiClientError(422, { code: 'LOCATION_NOT_AVAILABLE', message: 'x' }));
    const { unmount } = renderWithProviders(<ConvertAllButton req={req()} onDone={() => {}} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Convertir todas (3)' }));
    fireEvent.click(await screen.findByTestId('f2-convert-all-confirm'));
    expect(await screen.findByRole('alert')).toHaveTextContent(F2.convertAll.locationGone);
    unmount();
    renderWithProviders(<ConvertAllButton req={reqOf('sr-3020')} onDone={() => {}} />, 'es');
    expect(screen.queryByTestId('f2-convert-all-sr-3020')).toBeInTheDocument(); // sr-3020 tiene 1 aprobada
  });
});

describe('PickupLine · «Entregada» (F2c)', () => {
  it('muestra el estado del contrato y marca «Entregada»; sin `pickup` (No llegó) no pinta nada', async () => {
    const mark = vi.spyOn(flujo, 'markBuylistPickupDone').mockResolvedValue({} as never);
    const onDone = vi.fn();
    const pickup = { method: 'in_person' as const, chosenAt: '2026-11-19T10:00:00Z', doneAt: null, returnDeadlineAt: null, abandonDeadlineAt: null };
    renderWithProviders(
      <PickupLine itemId="sri-f2-8" cardName="Eevee" pickup={pickup} onDone={onDone} onError={() => {}} />,
      'es',
    );
    expect(screen.getByTestId('f2-pickup-state-sri-f2-8')).toHaveTextContent('Recoge en tienda (sin costo)');
    fireEvent.click(screen.getByRole('button', { name: 'Entregada' }));
    await waitFor(() => expect(mark).toHaveBeenCalledWith('sri-f2-8'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    cleanup();
    renderWithProviders(<PickupLine itemId="sri-f2-8" cardName="Eevee" pickup={{ ...pickup, doneAt: '2026-11-20T10:00:00Z' }} onDone={onDone} onError={() => {}} />, 'es');
    expect(screen.queryByRole('button', { name: 'Entregada' })).not.toBeInTheDocument();
    expect(screen.getByTestId('f2-pickup-state-sri-f2-8').textContent).toMatch(/^Entregada el /);
    cleanup();
    renderWithProviders(<PickupLine itemId="sri-f2-8" cardName="Eevee" pickup={null} onDone={onDone} onError={() => {}} />, 'es');
    expect(screen.queryByTestId('f2-pickup-sri-f2-8')).not.toBeInTheDocument();
  });
});
