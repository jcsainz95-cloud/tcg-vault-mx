import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import type { InventoryAdjustmentRequest } from '@/types/contract';
import { MasterSetPanel } from './MasterSetPanel';
import * as api from '@/lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
});

// Abre el binder de Base Set desde el índice (búsqueda + click en la tarjeta del set).
async function openBaseSetBinder() {
  fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Base' } });
  const setBtn = await screen.findByRole('button', { name: /Base Set/ });
  fireEvent.click(setBtn);
  // El binder pinta el título del set como h2.
  await screen.findByRole('heading', { level: 2, name: 'Base Set' });
  // Espera a que el binder cargue sus celdas (Blastoise #2 siempre existe en base1).
  await screen.findByText('#2');
}

// Abre el drawer de una celda por su número (#4 = Charizard, #16 = Zapdos en fixtures base1).
async function openCell(name: RegExp): Promise<HTMLElement> {
  const cellBtn = await screen.findByRole('button', { name });
  fireEvent.click(cellBtn);
  return screen.findByRole('dialog');
}

describe('Master Set · Índice (agregados por VARIANTE, v1.20)', () => {
  it('la tarjeta del set pinta completitud POR VARIANTES (cubiertas/universo · %) y piezas', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Base' } });

    // base1 en fixtures: universo de variantes = Σ availableFinishes = 13 (Charizard 3,
    // Blastoise/Pikachu/Zapdos/Eevee/Machamp 2 c/u). Cubiertas (plataforma on-hand): Charizard
    // normal + Charizard reverse_holo + Zapdos holofoil = 3 → 23.1%. Piezas on-hand: 5.
    expect(await screen.findByText('3/13 variantes · 23.1%')).toBeInTheDocument();
    expect(screen.getByText('5 piezas')).toBeInTheDocument();
  });

  it('manda q/sort/paginación reales a GET /admin/inventory/master-sets', async () => {
    const spy = vi.spyOn(api, 'getMasterSets');
    renderWithProviders(<MasterSetPanel />, 'es');

    await screen.findByRole('button', { name: /Surging Sparks/ });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, sort: 'release_desc' }),
    );

    fireEvent.change(await screen.findByLabelText('Ordenar por'), {
      target: { value: 'pieces_desc' },
    });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sort: 'pieces_desc' })),
    );
  });
});

describe('Master Set · Binder (casillas por acabado + orden + huecos + secret rare)', () => {
  it('pinta una casilla POR ACABADO: cubiertas con conteo y «HUECO» por acabado faltante', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Charizard (#4): normal:3 y reverse_holo:1 cubiertas; holofoil SIN pieza → HUECO por acabado.
    expect(document.querySelector('[aria-label="Normal: 3 piezas"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Reverse Holo: 1 piezas"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Holofoil: hueco"]')).toBeTruthy();
    // El contador de la celda cuenta VARIANTES (2 de 3 casillas cubiertas).
    expect(screen.getByText('2/3 casillas')).toBeInTheDocument();
  });

  it('respeta el ORDEN NATURAL del backend (numéricos ascendentes) sin re-ordenar', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Números de las celdas en el orden en que se pintan (no alfabético/lexicográfico).
    const numbers = screen
      .getAllByText(/^#\d+$/)
      .map((el) => Number(el.textContent!.replace('#', '')));
    const sorted = [...numbers].sort((a, b) => a - b);
    expect(numbers).toEqual(sorted);
    // "10" no va antes que "2" (bug lexicográfico que el backend ya evita).
    expect(numbers[0]).toBe(2);
  });

  it('marca huecos (celdas sin ninguna variante) y permite filtrar celdas con huecos', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Hay al menos un hueco total (Pikachu/Blastoise/… sin piezas on-hand en fixtures).
    expect((await screen.findAllByText('Hueco')).length).toBeGreaterThan(0);
  });
});

describe('Master Set · Carrito de captura por lote (#12, tolerante por-línea)', () => {
  it('acumula una línea y muestra resultado por-línea (ok + error) sin tumbar el resto', async () => {
    // Respuesta de lote con una línea creada y otra fallida (render tolerante).
    vi.spyOn(api, 'batchCreateItems').mockResolvedValue({
      batchKey: 'b1',
      idempotentReplay: false,
      summary: { requested: 2, createdItems: 1, failedLines: 1 },
      results: [
        { index: 0, ok: true, folios: ['INV-000301'], inventoryItemIds: ['x1'] },
        { index: 1, ok: false, error: { code: 'PRICE_PENDING', message: 'no ref' } },
      ],
    });

    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    fireEvent.click(within(drawer).getByRole('button', { name: 'Agregar al carrito' }));
    expect(await within(drawer).findByText('Agregado al carrito de captura.')).toBeInTheDocument();

    // Cerrar el drawer para operar el carrito del panel.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));

    // El carrito muestra la línea acumulada.
    expect(await screen.findByText(/Charizard · #4/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Dar de alta/ }));

    // Resumen + render tolerante: folio creado Y el error de la línea inválida.
    expect(await screen.findByText('1 piezas creadas · 1 líneas con error.')).toBeInTheDocument();
    expect(screen.getByText('INV-000301')).toBeInTheDocument();
    expect(
      screen.getByText(/Esta carta tiene precio pendiente/),
    ).toBeInTheDocument();
  });
});

describe('Master Set · Publicación masiva (bulk-publish por-línea)', () => {
  it('deshabilita el checkbox de una pieza NO publicable (reserved) y no la ofrece', async () => {
    // qa MENOR: solo {in_stock, listed} son publicables; una `reserved` no debe poder marcarse
    // (el backend la rechazaría con ITEM_NOT_PUBLISHABLE). El guardarraíl server-side se queda;
    // esto es UX para no ofrecer una acción que va a fallar.
    const spy = vi.spyOn(api, 'bulkPublishItems');
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    // La pieza reservada (INV-000203 / inv-2003) → checkbox deshabilitado + hint del porqué.
    const reservedRow = (await within(drawer).findByText('INV-000203')).closest('li')!;
    const reservedBox = within(reservedRow).getByRole('checkbox');
    expect(reservedBox).toBeDisabled();
    expect(
      within(reservedRow).getByText(/No publicable en su estado actual/),
    ).toBeInTheDocument();

    // Una pieza in_stock (INV-000201 / inv-2001) SÍ es publicable → checkbox habilitado.
    const stockRow = within(drawer).getByText('INV-000201').closest('li')!;
    const stockBox = within(stockRow).getByRole('checkbox');
    expect(stockBox).toBeEnabled();

    // Publicar: el lote solo incluye la pieza publicable (la reservada nunca entró).
    fireEvent.click(stockBox);
    fireEvent.click(within(drawer).getByRole('button', { name: /Publicar seleccionadas/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0].items).toEqual([{ inventoryItemId: 'inv-2001' }]);
  });

  it('maneja PRICE_PENDING (in_stock sin referencia) como error por-línea', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    // Zapdos (#16): 1 pieza in_stock holofoil SIN referencia de mercado → PRICE_PENDING.
    const drawer = await openCell(/Zapdos/);

    const boxes = await within(drawer).findAllByRole('checkbox');
    fireEvent.click(boxes[0]);
    fireEvent.click(within(drawer).getByRole('button', { name: /Publicar seleccionadas/ }));

    expect(await within(drawer).findByText('0 publicadas · 1 con error.')).toBeInTheDocument();
    expect(
      within(drawer).getByText(/Esta carta tiene precio pendiente/),
    ).toBeInTheDocument();
  });
});

describe('Master Set · batchKey ESTABLE por sesión de carrito (techlead #1, anti-duplicado)', () => {
  it('reusa la MISMA batchKey en un reintento y la RENUEVA solo tras un éxito', async () => {
    const keys: string[] = [];
    let n = 0;
    vi.spyOn(api, 'batchCreateItems').mockImplementation(async (payload) => {
      keys.push(payload.batchKey);
      n += 1;
      // 1ª llamada: "expira por red" (pero pudo procesarse) → el operador reintenta.
      if (n === 1) throw new Error('network timeout');
      return {
        batchKey: payload.batchKey,
        idempotentReplay: n > 2,
        summary: { requested: 1, createdItems: 1, failedLines: 0 },
        results: [{ index: 0, ok: true, folios: ['INV-000301'], inventoryItemIds: ['x1'] }],
      };
    });

    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // --- Sesión de carrito 1: agrega una línea de Charizard ---
    let drawer = await openCell(/Charizard/);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Agregar al carrito' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));

    // Submit 1 → falla (timeout). El carrito NO se limpia (onSuccess no corrió).
    fireEvent.click(await screen.findByRole('button', { name: /Dar de alta/ }));
    await waitFor(() => expect(keys.length).toBe(1));

    // Reintento del MISMO submit lógico → misma batchKey (backend lo trata como replay).
    fireEvent.click(await screen.findByRole('button', { name: /Dar de alta/ }));
    await waitFor(() => expect(keys.length).toBe(2));
    expect(keys[0]).toBe(keys[1]);

    // Éxito confirmado → carrito vacío.
    expect(await screen.findByText('1 piezas creadas · 0 líneas con error.')).toBeInTheDocument();

    // --- Sesión de carrito 2 (nuevo carrito tras éxito) → batchKey NUEVA ---
    drawer = await openCell(/Charizard/);
    fireEvent.click(within(drawer).getByRole('button', { name: 'Agregar al carrito' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: /Dar de alta/ }));
    await waitFor(() => expect(keys.length).toBe(3));
    expect(keys[2]).not.toBe(keys[1]);
  });
});

describe('Master Set · Ajuste por levantamiento físico (v1.20.1, solo M1)', () => {
  it('registra un ajuste `perdida` con pieza + nota obligatoria (SIN batchKey) y muestra éxito', async () => {
    const spy = vi.spyOn(api, 'createInventoryAdjustment').mockResolvedValue({
      adjustmentIds: ['adj-1'],
      reason: 'perdida',
      inventoryItemIds: ['inv-2001'],
      folios: ['INV-000201'],
      fromStatus: 'in_stock',
      toStatus: 'lost',
      idempotentReplay: false,
    });
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    fireEvent.change(within(drawer).getByLabelText('Motivo'), { target: { value: 'perdida' } });
    // Solo piezas in_stock/listed son elegibles (inv-2003 reserved NO aparece).
    const pieceSelect = (await within(drawer).findByLabelText('Pieza a ajustar')) as HTMLSelectElement;
    expect([...pieceSelect.options].map((o) => o.value)).not.toContain('inv-2003');
    fireEvent.change(pieceSelect, { target: { value: 'inv-2001' } });
    fireEvent.change(within(drawer).getByLabelText('Nota (obligatoria)'), {
      target: { value: 'no aparece en el levantamiento' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Registrar ajuste' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        reason: 'perdida',
        inventoryItemId: 'inv-2001',
        note: 'no aparece en el levantamiento',
      }),
    );
    expect(await within(drawer).findByText('Ajuste registrado (INV-000201).')).toBeInTheDocument();
  });

  it('registra `encontrada` creando pieza(s) nuevas (payload con item de alta + batchKey v1.20.1)', async () => {
    const spy = vi.spyOn(api, 'createInventoryAdjustment').mockResolvedValue({
      adjustmentIds: ['adj-2'],
      reason: 'encontrada',
      inventoryItemIds: ['inv-adj-1'],
      folios: ['INV-000401'],
      fromStatus: null,
      toStatus: 'in_stock',
      idempotentReplay: false,
    });
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    // Motivo default = encontrada → alta mínima raw NM con acabado del universo.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Registrar ajuste' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        reason: 'encontrada',
        item: {
          cardId: 'c-charizard',
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          acquisitionType: 'aportacion_en_especie',
          qty: 1,
        },
        // Idempotencia v1.20.1: el drawer SIEMPRE manda batchKey en `encontrada`.
        batchKey: expect.stringMatching(/^adj-/),
      }),
    );
    expect(await within(drawer).findByText('Ajuste registrado (INV-000401).')).toBeInTheDocument();
  });

  it('el batchKey de `encontrada` es ESTABLE por intento: un retry tras error reusa la MISMA clave y solo rota tras éxito', async () => {
    const spy = vi
      .spyOn(api, 'createInventoryAdjustment')
      .mockRejectedValueOnce(
        new ApiClientError(422, { code: 'PRICE_PENDING', message: 'no reference' }),
      )
      .mockResolvedValue({
        adjustmentIds: ['adj-3'],
        reason: 'encontrada',
        inventoryItemIds: ['inv-adj-2'],
        folios: ['INV-000402'],
        fromStatus: null,
        toStatus: 'in_stock',
        idempotentReplay: false,
      });
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);
    const submit = within(drawer).getByRole('button', { name: 'Registrar ajuste' });

    // Intento 1 falla → retry (intento MISMO) debe reusar la clave (el backend no duplica).
    fireEvent.click(submit);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    fireEvent.click(submit);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    type FoundReq = Extract<InventoryAdjustmentRequest, { reason: 'encontrada' }>;
    const keyOf = (i: number) => (spy.mock.calls[i][0] as FoundReq).batchKey;
    expect(keyOf(1)).toBe(keyOf(0));

    // Tras el éxito, una intención NUEVA usa clave NUEVA (no replayaría el ajuste anterior).
    await within(drawer).findByText('Ajuste registrado (INV-000402).');
    fireEvent.click(submit);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    expect(keyOf(2)).not.toBe(keyOf(1));
  });

  it('replay idempotente (idempotentReplay:true) → mismo éxito, SIN refrescar agregados doble', async () => {
    const piecesSpy = vi.spyOn(api, 'getAdminInventory');
    vi.spyOn(api, 'createInventoryAdjustment').mockResolvedValue({
      adjustmentIds: ['adj-4'],
      reason: 'encontrada',
      inventoryItemIds: ['inv-adj-3'],
      folios: ['INV-000403'],
      fromStatus: null,
      toStatus: 'in_stock',
      idempotentReplay: true,
    });
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);
    await within(drawer).findAllByRole('checkbox'); // piezas de la celda cargadas
    const callsBefore = piecesSpy.mock.calls.length;

    fireEvent.click(within(drawer).getByRole('button', { name: 'Registrar ajuste' }));

    // MISMO éxito que un procesamiento nuevo (un solo Banner, sin aviso duplicado)…
    expect(await within(drawer).findAllByText('Ajuste registrado (INV-000403).')).toHaveLength(1);
    // …pero SIN re-consultar piezas ni invalidar agregados (nada cambió en el servidor).
    expect(piecesSpy.mock.calls.length).toBe(callsBefore);
  });

  it('muestra el error ITEM_NOT_ADJUSTABLE traducido cuando el backend rechaza', async () => {
    vi.spyOn(api, 'createInventoryAdjustment').mockRejectedValue(
      new ApiClientError(422, { code: 'ITEM_NOT_ADJUSTABLE', message: 'status reserved not adjustable' }),
    );
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    fireEvent.change(within(drawer).getByLabelText('Motivo'), { target: { value: 'danada' } });
    fireEvent.change(await within(drawer).findByLabelText('Pieza a ajustar'), {
      target: { value: 'inv-2001' },
    });
    fireEvent.change(within(drawer).getByLabelText('Nota (obligatoria)'), {
      target: { value: 'borde dañado' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Registrar ajuste' }));

    expect(
      await within(drawer).findByText('Esta pieza no se puede ajustar en su estado actual.'),
    ).toBeInTheDocument();
  });
});

describe('Master Set · Modo user_vault_admin (bóveda de cliente, SOLO lectura)', () => {
  it('muestra al dueño (con email) y NO monta captura/publicación/ajuste ni CTA de compra', async () => {
    renderWithProviders(<MasterSetPanel mode="user_vault_admin" userId="u-777" />, 'es');

    // Owner con email (vista (ii) del contrato).
    expect(await screen.findByText(/Bóveda de Ana López · ana@example\.com/)).toBeInTheDocument();

    await openBaseSetBinder();
    const drawer = await openCell(/Zapdos/);

    // Casillas por acabado visibles (lectura)…
    expect(within(drawer).getByText('Casillas por acabado')).toBeInTheDocument();
    // …pero SIN acciones de M1 ni de compra (scope read-only).
    expect(within(drawer).queryByText('Alta rápida al carrito')).toBeNull();
    expect(within(drawer).queryByText('Publicar piezas de esta carta')).toBeNull();
    expect(within(drawer).queryByText('Ajuste por levantamiento físico')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: /Agregar al carrito/ })).toBeNull();
    expect(within(drawer).queryByText('No disponible')).toBeNull();
  });

  it('consume GET /admin/vaults/:userId/master-sets (índice de ESE cliente)', async () => {
    const spy = vi.spyOn(api, 'getAdminVaultMasterSets');
    renderWithProviders(<MasterSetPanel mode="user_vault_admin" userId="u-777" />, 'es');
    await screen.findByRole('button', { name: /Base Set/ });
    expect(spy).toHaveBeenCalledWith('u-777', expect.objectContaining({ page: 1 }));
  });
});

describe('Master Set · Modo user_vault_self (mi bóveda: faltantes comprables)', () => {
  it('variante faltante con `buyable` → CTA agrega al carrito de compra; sin `buyable` → no disponible', async () => {
    const onBuy = vi.fn();
    renderWithProviders(<MasterSetPanel mode="user_vault_self" onBuyMissing={onBuy} />, 'es');
    await openBaseSetBinder();

    // Pikachu (#58): sin piezas del usuario. normal → sin inventario publicado (No disponible);
    // reverse_holo → pieza listed más barata (inv-1003) con precio → CTA de compra.
    const drawer = await openCell(/Pikachu/);
    expect(await within(drawer).findByText('No disponible')).toBeInTheDocument();

    const cta = within(drawer).getByRole('button', { name: /Agregar al carrito · MX\$/ });
    fireEvent.click(cta);
    expect(onBuy).toHaveBeenCalledWith('inv-1003');
    expect(await within(drawer).findByText('Agregada al carrito de compra.')).toBeInTheDocument();

    // SIN acciones de venta/captura en la vista del cliente.
    expect(within(drawer).queryByText('Alta rápida al carrito')).toBeNull();
    expect(within(drawer).queryByText('Publicar piezas de esta carta')).toBeNull();
    expect(within(drawer).queryByText('Ajuste por levantamiento físico')).toBeNull();
  });

  it('el índice consume GET /vault/master-sets y solo lista sets con piezas propias', async () => {
    const spy = vi.spyOn(api, 'getVaultMasterSets');
    renderWithProviders(<MasterSetPanel mode="user_vault_self" />, 'es');

    // mockHoldings vive en base1 (Blastoise/Zapdos) y sv08 (Latias) → esos sets sí…
    await screen.findByRole('button', { name: /Base Set/ });
    expect(screen.getByRole('button', { name: /Surging Sparks/ })).toBeInTheDocument();
    // …pero un set sin piezas del usuario (swsh1) NO aparece en el índice.
    expect(screen.queryByRole('button', { name: /Sword & Shield/ })).toBeNull();
    expect(spy).toHaveBeenCalled();
  });
});
