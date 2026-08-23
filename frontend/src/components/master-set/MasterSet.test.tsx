import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import type {
  BuylistBatchQuoteResultDTO,
  BuylistQuoteItemDTO,
  CardDTO,
  CardSetDTO,
  InventoryAdjustmentRequest,
} from '@/types/contract';
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
  // Espera a que el binder cargue sus tarjetas (Blastoise #2 siempre existe en base1). Rejilla plana
  // (N-16): una carta con varios acabados aporta varias tarjetas → varios "#2".
  await screen.findAllByText('#2');
}

// Abre el drawer de una carta desde la REJILLA PLANA (N-16). Ahora hay una TARJETA por acabado a
// pintar, así que una misma carta tiene varias tarjetas; el drawer es por-carta, así que se abre
// desde la PRIMERA tarjeta que casa el nombre (#4 = Charizard, #16 = Zapdos en fixtures base1).
async function openCell(name: RegExp): Promise<HTMLElement> {
  const tiles = await screen.findAllByRole('button', { name });
  fireEvent.click(tiles[0]);
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

describe('Master Set · Binder (rejilla PLANA: una tarjeta por impresión + orden + huecos)', () => {
  it('N-16: una TARJETA por impresión (carta+acabado), imagen COMPARTIDA por carta y conteo por acabado', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Charizard (#4) tiene 3 acabados en el universo → 3 TARJETAS independientes en el flujo plano.
    const charizardTiles = await screen.findAllByRole('button', { name: /Charizard/ });
    expect(charizardTiles).toHaveLength(3);
    // Todas comparten la imagen de la carta: cada tarjeta pinta UNA sola imagen.
    charizardTiles.forEach((tile) => expect(tile.querySelectorAll('img')).toHaveLength(1));

    // Conteo POR ACABADO en la propia tarjeta: normal 3 piezas, reverse holo 1 pieza, holofoil HUECO.
    const normalTile = charizardTiles.find((t) => /·\s*Normal/.test(t.textContent ?? ''))!;
    const reverseTile = charizardTiles.find((t) => /Reverse Holo/.test(t.textContent ?? ''))!;
    const holoTile = charizardTiles.find((t) => /·\s*Holofoil/.test(t.textContent ?? ''))!;
    expect(within(normalTile).getByText('3 piezas')).toBeInTheDocument();
    expect(within(reverseTile).getByText('1 pieza')).toBeInTheDocument();
    expect(within(holoTile).getByText('Hueco')).toBeInTheDocument();

    // El drawer por-carta sigue mostrando el desglose por acabado (detalle/alta/publicación).
    const drawer = await openCell(/Charizard/);
    expect(within(drawer).getByText('Casillas por acabado')).toBeInTheDocument();
    expect(within(drawer).getByText('3 piezas')).toBeInTheDocument();
  });

  it('INV-2: el badge on-hand de cada tarjeta es POR ACABADO (countsByFinish[finish]), no el total de la carta', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Charizard (#4): normal 3 piezas, reverse holo 1 pieza, holofoil 0 (HUECO). Cada tarjeta de
    // impresión (N-16) lleva el badge on-hand de SU acabado — NO la suma de la carta (4). La
    // regresión (IMP-2) sumaba `countsByFinish` y pintaba «4 en total» en las TRES tarjetas, incluida
    // la de holofoil (0 piezas). El badge visible es el número; el aria describe el acabado.
    const charizardTiles = await screen.findAllByRole('button', { name: /Charizard/ });
    expect(charizardTiles).toHaveLength(3);
    const normalTile = charizardTiles.find((t) => /·\s*Normal/.test(t.textContent ?? ''))!;
    const reverseTile = charizardTiles.find((t) => /Reverse Holo/.test(t.textContent ?? ''))!;
    const holoTile = charizardTiles.find((t) => /·\s*Holofoil/.test(t.textContent ?? ''))!;
    expect(within(normalTile).getByTitle('Tengo 3 piezas de este acabado')).toBeInTheDocument();
    expect(within(reverseTile).getByTitle('Tengo 1 pieza de este acabado')).toBeInTheDocument();
    // Holofoil (0 piezas) → HUECO, SIN badge de conteo (ni el propio 0 ni la suma 4 de la carta).
    expect(within(holoTile).queryByTitle(/de este acabado$/)).toBeNull();
    // El total de la carta (4) NO se pinta en NINGUNA tarjeta (la regresión exacta).
    charizardTiles.forEach((tile) => {
      expect(within(tile).queryByTitle('Tengo 4 piezas de este acabado')).toBeNull();
    });

    // Una carta SIN piezas on-hand (Pikachu, 0 en todos los acabados) NO pinta badge en ninguna teja.
    const pikachuTiles = await screen.findAllByRole('button', { name: /Pikachu/ });
    pikachuTiles.forEach((tile) => {
      expect(within(tile).queryByTitle(/de este acabado$/)).toBeNull();
    });
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

describe('Master Set · Precio de mercado POR VARIANTE en el tile (P-15, v1.27)', () => {
  it('cada tarjeta pinta el mercado de SU variante — Normal, Reverse y Holofoil con precios DISTINTOS', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Charizard (c-charizard): las fixtures derivan una PriceReference POR ACABADO (base 4850000
    // cents en normal; reverse ×1.25; holofoil ×1.6). El bug P-15 era pintar el precio del acabado
    // BASE (campo de celda) en TODAS las tarjetas; ahora cada tarjeta lee SU variante.
    const charizardTiles = await screen.findAllByRole('button', { name: /Charizard/ });
    const normalTile = charizardTiles.find((t) => /·\s*Normal/.test(t.textContent ?? ''))!;
    const reverseTile = charizardTiles.find((t) => /Reverse Holo/.test(t.textContent ?? ''))!;
    const holoTile = charizardTiles.find((t) => /·\s*Holofoil/.test(t.textContent ?? ''))!;
    expect(within(normalTile).getByText('Mercado')).toBeInTheDocument();
    expect(within(normalTile).getByText('MX$48,500.00')).toBeInTheDocument();
    expect(within(reverseTile).getByText('MX$60,625.00')).toBeInTheDocument();
    expect(within(holoTile).getByText('MX$77,600.00')).toBeInTheDocument();
    // Y el precio del acabado base NO se repite en las otras variantes (el bug P-15 exacto).
    expect(within(reverseTile).queryByText('MX$48,500.00')).toBeNull();
    expect(within(holoTile).queryByText('MX$48,500.00')).toBeNull();
  });

  it('una variante SIN referencia (Zapdos, null) muestra el affordance de pendiente — NUNCA $0', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Zapdos (c-zapdos) queda sin referencia a propósito → marketReferenceMxnCents = null en TODAS
    // sus variantes. El tile pinta el affordance "—" (precio pendiente), jamás un MX$0.00 inventado
    // (money-safe, bug P-1); null explícito de variante NO cae al fallback de celda.
    const zapdosTiles = await screen.findAllByRole('button', { name: /Zapdos/ });
    zapdosTiles.forEach((tile) => {
      expect(within(tile).getByText('Mercado')).toBeInTheDocument();
      // v1.28 (P-18): la teja platform trae la consola compacta (MERCADO/COMPRA/VENTA) — cada
      // cara sin precio pinta su propio "—" (puede haber varios), jamás un MX$0.00 inventado.
      expect(within(tile).getAllByText('—').length).toBeGreaterThan(0);
      expect(within(tile).queryByText(/MX\$0\.00/)).toBeNull();
    });
  });

  it('retrocompat de deploy: variante SIN el campo (backend rezagado) cae al campo de CELDA deprecado', async () => {
    // Backend pre-v1.27: la variante no trae marketReferenceMxnCents (undefined, no null) y el
    // dato vive solo en el campo de celda. El tile debe seguir pintando ese valor durante la
    // ventana de deploy; el fallback se retira junto con el campo de celda (siguiente rev).
    vi.spyOn(api, 'getMasterSetBinder').mockResolvedValue({
      set: { id: 'base1', name: 'Base Set', series: 'Base', releaseDate: '1999-01-09' },
      printedTotal: 102,
      catalogCardCount: 1,
      scope: 'platform',
      cells: [
        {
          cardId: 'c-legacy',
          number: '2',
          name: 'Legacy Reader',
          rarity: 'Rare',
          imageSmallUrl: '',
          availableFinishes: ['normal'],
          displayFinishes: ['normal'],
          countsByFinish: [],
          totalCount: 0,
          isSecretRare: false,
          expectedVariantCount: 1,
          coveredVariantCount: 0,
          variants: [{ finish: 'normal', count: 0, covered: false, displayed: true }],
          marketReferenceMxnCents: 123400, // DEPRECADO v1.27: espejo de celda del backend rezagado.
        },
      ],
    });

    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    const tile = (await screen.findAllByRole('button', { name: /Legacy Reader/ }))[0];
    expect(within(tile).getByText('Mercado')).toBeInTheDocument();
    expect(within(tile).getByText('MX$1,234.00')).toBeInTheDocument();
  });
});

describe('Master Set · Productos SEPARADOS (Deck Exclusives/promo, v1.29 §4.27)', () => {
  it('el binder pinta el Deck Exclusive de Charizard como producto APARTE con su propio precio, y el promo sin precio como "—"', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Charizard (base1) trae separateProducts en fixtures: un Deck Exclusive (holofoil, con precio)
    // y un promo (holofoil, sin precio). Se pintan como productos PROPIOS, no fusionados en la carta.
    const deckName = await screen.findByText('Charizard (Deck Exclusive)');
    const deckTile = deckName.closest('div')!;
    // El tipo de producto se rotula (badge + renglón mono) y trae su propio precio de mercado.
    expect(within(deckTile).getAllByText('Deck Exclusive').length).toBeGreaterThan(0);
    expect(within(deckTile).getByText('MX$5,120.00')).toBeInTheDocument();

    // El promo sin precio pinta "—" (money-safe), jamás un MX$0.00 inventado.
    const promoTile = screen.getByText('Charizard (Promo)').closest('div')!;
    expect(within(promoTile).getByText('—')).toBeInTheDocument();
    expect(within(promoTile).queryByText(/MX\$0\.00/)).toBeNull();
  });

  it('una carta SIN productos separados (Pikachu) no pinta ningún producto aparte', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    await screen.findByText('Charizard (Deck Exclusive)'); // binder cargado
    expect(screen.queryByText(/Pikachu \(Deck Exclusive\)/)).toBeNull();
    expect(screen.queryByText(/Pikachu \(Promo\)/)).toBeNull();
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

    fireEvent.click(within(drawer).getByRole('button', { name: 'Agregar al lote' }));
    expect(await within(drawer).findByText('Agregada al lote de alta.')).toBeInTheDocument();

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

describe('Master Set · Alta INMEDIATA al inventario (T3: concluyente y visible)', () => {
  it('"Dar de alta al inventario" encola y envía en el MISMO clic; el resultado se ve DENTRO del modal, sin cerrar nada', async () => {
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue({
      batchKey: 'b-immediate',
      idempotentReplay: false,
      summary: { requested: 1, createdItems: 1, failedLines: 0 },
      results: [{ index: 0, ok: true, folios: ['INV-000500'], inventoryItemIds: ['x9'] }],
    });

    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    fireEvent.click(within(drawer).getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // El desenlace se pinta en el PIE del propio modal: sin scroll, sin cerrar el drawer.
    expect(await within(drawer).findByText('1 piezas creadas · 0 líneas con error.')).toBeInTheDocument();
    expect(within(drawer).getByText('INV-000500')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('un error de alta se muestra VISIBLE dentro del modal (antes quedaba al fondo de la página, tapado por el overlay)', async () => {
    vi.spyOn(api, 'batchCreateItems').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );

    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    fireEvent.click(within(drawer).getByRole('button', { name: 'Dar de alta al inventario' }));

    expect(
      await within(drawer).findByText('Error del servidor. Intenta de nuevo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Master Set · Rejilla plana (N-16: una tarjeta por impresión)', () => {
  it('una carta con VARIOS acabados genera VARIAS tarjetas (una por acabado), cada una con la imagen de la carta', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Zapdos tiene 2 acabados → 2 tarjetas independientes; cada una pinta UNA imagen (la de la carta).
    const zapdosTiles = await screen.findAllByRole('button', { name: /Zapdos/ });
    expect(zapdosTiles).toHaveLength(2);
    zapdosTiles.forEach((tile) => expect(tile.querySelectorAll('img')).toHaveLength(1));

    // Set con carta promo de UN solo acabado (Rayquaza Trainer Gallery, sv08): UNA sola tarjeta, sin
    // "Normal" espuria — el universo a pintar sale de displayFinishes (fallback availableFinishes).
    fireEvent.click(await screen.findByRole('button', { name: 'Sets' }));
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Surging Sparks' } });
    fireEvent.click(await screen.findByRole('button', { name: /Surging Sparks/ }));
    await screen.findByRole('heading', { level: 2, name: 'Surging Sparks' });

    const rayquazaTiles = await screen.findAllByRole('button', { name: /Rayquaza/ });
    expect(rayquazaTiles).toHaveLength(1);
    expect(rayquazaTiles[0].querySelectorAll('img')).toHaveLength(1);
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

  it('P-7: "Publicar" reprecia FRESCO (repriceFresh:true) sobre una pieza in_stock NO publicada', async () => {
    // El backend refresca el precio por carta en el momento de publicar. La acción debe funcionar
    // sobre inventario `in_stock` aún NO publicado (INV-000201 / inv-2001 es in_stock publicable).
    const spy = vi.spyOn(api, 'bulkPublishItems').mockResolvedValue({
      summary: { requested: 1, published: 1, failedLines: 0 },
      results: [
        { index: 0, inventoryItemId: 'inv-2001', ok: true, status: 'listed', salePriceCents: 5000000, priceSource: 'derived' },
      ],
    });
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    const stockRow = (await within(drawer).findByText('INV-000201')).closest('li')!;
    fireEvent.click(within(stockRow).getByRole('checkbox'));
    fireEvent.click(within(drawer).getByRole('button', { name: /Publicar seleccionadas/ }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Reprecia fresco Y solo manda la pieza in_stock seleccionada.
    expect(spy.mock.calls[0][0]).toEqual(expect.objectContaining({ repriceFresh: true }));
    expect(spy.mock.calls[0][0].items).toEqual([{ inventoryItemId: 'inv-2001' }]);
    // Éxito pleno → sin aviso de escalada a pendientes.
    expect(await within(drawer).findByText('1 publicadas · 0 con error.')).toBeInTheDocument();
  });

  it('P-7 (④): una línea PRICE_PENDING surfacea la escalada a la cola de pendientes (VENTA), NO como éxito', async () => {
    // El gate ④: tras el reprice, una variante aún sin precio ESCALA a la cola de precios pendientes
    // y NO se publica. Debe verse un aviso explícito (no un banner de éxito).
    vi.spyOn(api, 'bulkPublishItems').mockResolvedValue({
      summary: { requested: 1, published: 0, failedLines: 1 },
      results: [
        {
          index: 0,
          inventoryItemId: 'inv-2001',
          ok: false,
          error: { code: 'PRICE_PENDING', message: 'no ref' },
          pendingPriceEntryId: 'ppe-1',
        },
      ],
    });
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    const stockRow = (await within(drawer).findByText('INV-000201')).closest('li')!;
    fireEvent.click(within(stockRow).getByRole('checkbox'));
    fireEvent.click(within(drawer).getByRole('button', { name: /Publicar seleccionadas/ }));

    // Aviso EXPLÍCITO de escalada a la cola de precios pendientes (Venta) — la variante NO se publicó.
    expect(await within(drawer).findByText(/cola de precios pendientes/)).toBeInTheDocument();
    // El resumen refleja 0 publicadas · 1 con error (jamás presentado como éxito).
    expect(within(drawer).getByText('0 publicadas · 1 con error.')).toBeInTheDocument();
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
    fireEvent.click(within(drawer).getByRole('button', { name: 'Agregar al lote' }));
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
    fireEvent.click(within(drawer).getByRole('button', { name: 'Agregar al lote' }));
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
    expect(within(drawer).queryByText('Alta rápida al inventario')).toBeNull();
    expect(within(drawer).queryByText('Publicar piezas de esta carta')).toBeNull();
    expect(within(drawer).queryByText('Ajuste por levantamiento físico')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: /Dar de alta al inventario|Agregar al lote/ })).toBeNull();
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

/**
 * mode="quoter" (WS-cotizador, unificación con Master Set): el binder compone client-side
 * `GET /buylist/sets` + `GET /buylist/cards` + `POST /buylist/quote/batch` (SIN endpoint
 * nuevo). Cada casilla es UNA IMAGEN por acabado real de la carta (nunca chip de texto,
 * nunca hueco para un acabado que no existe); clic = agrega al carrito de venta.
 */
describe('Master Set · mode="quoter" (cotizador unificado con el binder de Master Set)', () => {
  const QUOTER_SET: CardSetDTO = { id: 'set-quoter', name: 'Quoter Set', year: 2024 };

  function mockOneSet() {
    vi.spyOn(api, 'listBuylistSets').mockResolvedValue([QUOTER_SET]);
  }

  /** Cotización determinista: MX$100.00 en normal, MX$150.00 en cualquier otro acabado. */
  function mockDeterministicQuotes() {
    vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
      results: items.map(
        (it, index): BuylistBatchQuoteResultDTO => ({
          index,
          cardId: it.cardId,
          ok: true,
          rarity: 'Rare',
          finish: it.finish ?? 'normal',
          appliedRule: { mode: 'fixed', value: it.finish === 'normal' ? 10000 : 15000, source: 'rule' },
          quote: {
            status: 'cotizada',
            quotedPriceCents: it.finish === 'normal' ? 10000 : 15000,
            currency: 'MXN',
          },
          referencePrice: { status: 'priced', priceMxnCents: 25000 },
          paymentNotice: 'PAY_AFTER_RECEIPT',
        }),
      ),
    }));
  }

  async function openQuoterSet(
    handlers: {
      onAddToSellCart?: (...args: unknown[]) => void;
      onAddProductToSellCart?: (...args: unknown[]) => void;
    } = {},
  ) {
    renderWithProviders(
      <MasterSetPanel
        mode="quoter"
        onAddToSellCart={handlers.onAddToSellCart ?? vi.fn()}
        onAddProductToSellCart={handlers.onAddProductToSellCart}
      />,
      'es',
    );
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Quoter' } });
    fireEvent.click(await screen.findByRole('button', { name: /Quoter Set/ }));
  }

  it('una carta con DOS acabados muestra DOS casillas cotizables independientes (nunca un chip de texto)', async () => {
    mockOneSet();
    const dualFinishCard: CardDTO = {
      id: 'c-dual',
      externalId: 'quoter-1',
      name: 'Dual Finish Card',
      number: '1',
      rarity: 'Rare',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'set-quoter',
      setName: 'Quoter Set',
      imageSmallUrl: 'https://images.pokemontcg.io/quoter/1.png',
      imageLargeUrl: 'https://images.pokemontcg.io/quoter/1_hires.png',
      availableFinishes: ['normal', 'reverse_holo'],
    };
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [dualFinishCard],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockDeterministicQuotes();

    renderWithProviders(<MasterSetPanel mode="quoter" />, 'es');
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Quoter' } });
    fireEvent.click(await screen.findByRole('button', { name: /Quoter Set/ }));

    // Dos casillas independientes, cada una con su propio precio cotizado.
    expect(
      await screen.findByRole('button', {
        name: 'Agregar Dual Finish Card (Normal) a la venta · MX$100.00',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Agregar Dual Finish Card (Reverse Holo) a la venta · MX$150.00',
      }),
    ).toBeInTheDocument();
  });

  it('INV-2: el cotizador (mode="quoter") NUNCA pinta el badge de on-hand por acabado', async () => {
    // Lock de invariante: el on-hand no aplica al cotizador (QuoterTile no pasa showFinishCount).
    // Este test evita que un refactor futuro de defaults lo reintroduzca en silencio.
    mockOneSet();
    const dualFinishCard: CardDTO = {
      id: 'c-dual',
      externalId: 'quoter-1',
      name: 'Dual Finish Card',
      number: '1',
      rarity: 'Rare',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'set-quoter',
      setName: 'Quoter Set',
      imageSmallUrl: '',
      imageLargeUrl: '',
      availableFinishes: ['normal', 'reverse_holo'],
    };
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [dualFinishCard],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockDeterministicQuotes();

    await openQuoterSet();

    // Las casillas del cotizador ya cargaron (precio visible)…
    expect(await screen.findByText('MX$100.00')).toBeInTheDocument();
    // …pero NO hay badge de on-hand por acabado en ninguna casilla del cotizador.
    expect(screen.queryByTitle(/de este acabado$/)).toBeNull();
  });

  it('una carta con UN solo acabado muestra SOLO una casilla, sin hueco vacío para los demás', async () => {
    mockOneSet();
    const singleFinishCard: CardDTO = {
      id: 'c-single',
      externalId: 'quoter-2',
      name: 'Single Finish Card',
      number: '2',
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'set-quoter',
      setName: 'Quoter Set',
      imageSmallUrl: 'https://images.pokemontcg.io/quoter/2.png',
      imageLargeUrl: 'https://images.pokemontcg.io/quoter/2_hires.png',
      availableFinishes: ['normal'],
    };
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [singleFinishCard],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockDeterministicQuotes();

    renderWithProviders(<MasterSetPanel mode="quoter" />, 'es');
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Quoter' } });
    fireEvent.click(await screen.findByRole('button', { name: /Quoter Set/ }));

    expect(
      await screen.findByRole('button', {
        name: 'Agregar Single Finish Card (Normal) a la venta · MX$100.00',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Single Finish Card \(Reverse Holo\)/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Single Finish Card \(Holofoil\)/ }),
    ).not.toBeInTheDocument();
  });

  it('v1.29: una carta de ENERGÍA ESPECIAL (holofoil + reverse_holo, SIN normal) muestra EXACTAMENTE 2 casillas, no 3', async () => {
    // Regresión del modelo por-producto (§4.27): el set base de una energía especial existe solo en
    // holofoil y reverse holo — NUNCA el `normal` fantasma. El binder pinta UNA casilla por acabado
    // REAL (availableFinishes), así que son 2, no 3.
    mockOneSet();
    const specialEnergy: CardDTO = {
      id: 'c-special-energy',
      externalId: 'quoter-se',
      name: 'Reversal Energy',
      number: '9',
      rarity: 'Special Energy',
      supertype: 'Energy',
      subtypes: ['Special'],
      setId: 'set-quoter',
      setName: 'Quoter Set',
      imageSmallUrl: '',
      imageLargeUrl: '',
      availableFinishes: ['holofoil', 'reverse_holo'],
    };
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [specialEnergy],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockDeterministicQuotes();

    await openQuoterSet();

    // Exactamente 2 casillas cotizables (holofoil + reverse holo), cada una con su precio.
    const addButtons = await screen.findAllByRole('button', { name: /Agregar Reversal Energy/ });
    expect(addButtons).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: /Agregar Reversal Energy \(Holofoil\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Agregar Reversal Energy \(Reverse Holo\)/ }),
    ).toBeInTheDocument();
    // NUNCA una tercera casilla "Normal" fantasma.
    expect(
      screen.queryByRole('button', { name: /Agregar Reversal Energy \(Normal\)/ }),
    ).toBeNull();
  });

  /** Carta con productos SEPARADOS para los tests del cotizador (v1.30 §4.29). */
  const IONO_WITH_SEPARATE: CardDTO = {
    id: 'c-with-sep',
    externalId: 'quoter-sep',
    name: 'Iono',
    number: '3',
    rarity: 'Rare',
    supertype: 'Trainer',
    subtypes: [],
    setId: 'set-quoter',
    setName: 'Quoter Set',
    imageSmallUrl: '',
    imageLargeUrl: '',
    availableFinishes: ['normal', 'reverse_holo'],
    separateProducts: [
      {
        productId: 71001,
        kind: 'deck_exclusive',
        name: 'Iono (Deck Exclusive)',
        finishes: ['holofoil'],
        prices: [{ finish: 'holofoil', marketReferenceMxnCents: 34500 }],
      },
      {
        productId: 71002,
        kind: 'promo',
        name: 'Iono (Promo)',
        finishes: ['holofoil'],
        prices: [{ finish: 'holofoil', marketReferenceMxnCents: null }],
      },
    ],
  };

  it('v1.30 (§4.29): un PRODUCTO SEPARADO (Deck Exclusive) es COTIZABLE en el cotizador como su propia línea con su propio estimado (no fusionado en la carta base)', async () => {
    mockOneSet();
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [IONO_WITH_SEPARATE],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockDeterministicQuotes();

    await openQuoterSet();

    // La carta base sigue con SUS casillas cotizables (normal = MX$100.00)…
    const normalBtn = await screen.findByRole('button', { name: /Agregar Iono \(Normal\)/ });
    expect(normalBtn.getAttribute('aria-label')).toContain('MX$100.00');
    // …y el Deck Exclusive aparece como PRODUCTO APARTE con su PROPIO botón «Agregar» y su PROPIO
    // estimado de buylist (holofoil = MX$150.00, cotizado server-side por su productId).
    const deckAdd = screen.getByRole('button', {
      name: /Agregar Iono \(Deck Exclusive\) \(Deck Exclusive, Holofoil\) a la venta/,
    });
    expect(deckAdd.getAttribute('aria-label')).toContain('MX$150.00');
    // El producto base NO absorbe el estimado del producto separado (no fusionado).
    expect(normalBtn.getAttribute('aria-label')).not.toContain('MX$150.00');
  });

  it('v1.30 (§4.29): «Agregar» de un producto separado manda su productId al carrito de venta', async () => {
    mockOneSet();
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [IONO_WITH_SEPARATE],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockDeterministicQuotes();
    const onAddProduct = vi.fn();

    await openQuoterSet({ onAddProductToSellCart: onAddProduct });

    const deckAdd = await screen.findByRole('button', {
      name: /Agregar Iono \(Deck Exclusive\) \(Deck Exclusive, Holofoil\) a la venta/,
    });
    await waitFor(() => expect(deckAdd).toBeEnabled());
    fireEvent.click(deckAdd);

    expect(onAddProduct).toHaveBeenCalledTimes(1);
    const [cell, product, finish, quote] = onAddProduct.mock.calls[0];
    expect(cell.cardId).toBe('c-with-sep');
    expect(product.productId).toBe(71001);
    expect(finish).toBe('holofoil');
    // El eco del contrato: la cotización que viaja al carrito lleva el productId (§4.29).
    expect(quote.productId).toBe(71001);
    expect(quote.quote.quotedPriceCents).toBe(15000);
  });

  it('v1.30 (§4.29): PRODUCT_CARD_MISMATCH del backend se muestra como error de línea legible sin romper el binder', async () => {
    mockOneSet();
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [IONO_WITH_SEPARATE],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    // El set_base cotiza OK; el ítem con productId (producto separado) sale ok:false por-ítem.
    vi.spyOn(api, 'batchQuote').mockImplementation(async (items: BuylistQuoteItemDTO[]) => ({
      results: items.map((it, index): BuylistBatchQuoteResultDTO => {
        if (it.productId != null) {
          return {
            index,
            cardId: it.cardId,
            ok: false,
            error: { code: 'PRODUCT_CARD_MISMATCH', message: 'Product does not belong to this card' },
          };
        }
        return {
          index,
          cardId: it.cardId,
          ok: true,
          rarity: 'Rare',
          finish: it.finish ?? 'normal',
          appliedRule: { mode: 'fixed', value: 10000, source: 'rule' },
          quote: { status: 'cotizada', quotedPriceCents: 10000, currency: 'MXN' },
          referencePrice: { status: 'priced', priceMxnCents: 25000 },
          paymentNotice: 'PAY_AFTER_RECEIPT',
        };
      }),
    }));
    const onAddProduct = vi.fn();

    await openQuoterSet({ onAddProductToSellCart: onAddProduct });

    // La carta base cotiza normal (el lote NO se cae por el ítem inválido)…
    expect(await screen.findByRole('button', { name: /Agregar Iono \(Normal\)/ })).toBeInTheDocument();
    // …y la(s) teja(s) de producto separado muestran el error legible del contrato (uno por producto:
    // deck_exclusive + promo) y su «Agregar» queda inhábil.
    expect(screen.getAllByText('Este producto no corresponde a esta carta.').length).toBeGreaterThan(0);
    const deckAdd = screen.getByRole('button', {
      name: /Agregar Iono \(Deck Exclusive\) \(Deck Exclusive, Holofoil\) a la venta/,
    });
    expect(deckAdd).toBeDisabled();
    fireEvent.click(deckAdd);
    expect(onAddProduct).not.toHaveBeenCalled();
  });

  it('un set con 120 cartas (bug P-4a: el cotizador cortaba en 20 sin control) muestra TODAS, no solo la primera página', async () => {
    mockOneSet();
    const cards: CardDTO[] = Array.from({ length: 120 }, (_, i) => ({
      id: `c-pb-${i + 1}`,
      externalId: `quoter-pb-${i + 1}`,
      name: `Pitch Black Card ${i + 1}`,
      number: String(i + 1),
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'set-quoter',
      setName: 'Quoter Set',
      imageSmallUrl: '',
      imageLargeUrl: '',
      availableFinishes: ['normal'],
    }));
    vi.spyOn(api, 'searchBuylistCards').mockImplementation(async ({ page = 1, pageSize = 50 } = {}) => {
      const start = (page - 1) * pageSize;
      return { data: cards.slice(start, start + pageSize), page, pageSize, total: cards.length };
    });
    mockDeterministicQuotes();

    await openQuoterSet();

    // La última carta de la 3ª página (50+50+20) prueba que se acumularon TODAS las páginas.
    expect(await screen.findByText('#120')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /Agregar Pitch Black Card \d+ \(Normal\)/ }),
    ).toHaveLength(120);
  });

  it('clic en una casilla agrega al carrito de venta con el precio correcto de esa combinación', async () => {
    mockOneSet();
    const dualFinishCard: CardDTO = {
      id: 'c-dual',
      externalId: 'quoter-1',
      name: 'Dual Finish Card',
      number: '1',
      rarity: 'Rare',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'set-quoter',
      setName: 'Quoter Set',
      imageSmallUrl: '',
      imageLargeUrl: '',
      availableFinishes: ['normal', 'reverse_holo'],
    };
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({
      data: [dualFinishCard],
      page: 1,
      pageSize: 50,
      total: 1,
    });
    mockDeterministicQuotes();

    const onAddToSellCart = vi.fn();
    renderWithProviders(<MasterSetPanel mode="quoter" onAddToSellCart={onAddToSellCart} />, 'es');
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Quoter' } });
    fireEvent.click(await screen.findByRole('button', { name: /Quoter Set/ }));

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Agregar Dual Finish Card (Reverse Holo) a la venta · MX$150.00',
      }),
    );

    await waitFor(() => expect(onAddToSellCart).toHaveBeenCalledTimes(1));
    const [cellArg, variantArg] = onAddToSellCart.mock.calls[0];
    expect(cellArg.cardId).toBe('c-dual');
    expect(variantArg.finish).toBe('reverse_holo');
    expect(variantArg.quote?.quotedPriceCents).toBe(15000);
  });

  it('TL-C1: la barra sticky de filtros del quoter se ancla BAJO el header (var --app-header-h, no top-0 ni px hardcodeado)', async () => {
    // jsdom no pinta sticky: se asserta el contrato de clases — el offset viene de la var
    // CSS `--app-header-h` (altura REAL del header del layout, expuesta por StorefrontHeader)
    // con fallback 0px. Un `lg:top-0` dejaría la barra escondida detrás del header opaco
    // (sticky top-0 z-40, ~72px); un `top-[72px]` hardcodearía el shell en un compartido.
    mockOneSet();
    const card: CardDTO = {
      id: 'c-sticky',
      externalId: 'quoter-sticky',
      name: 'Sticky Card',
      number: '1',
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 'set-quoter',
      setName: 'Quoter Set',
      imageSmallUrl: '',
      imageLargeUrl: '',
      availableFinishes: ['normal'],
    };
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue({ data: [card], page: 1, pageSize: 50, total: 1 });
    mockDeterministicQuotes();

    const { container } = renderWithProviders(<MasterSetPanel mode="quoter" />, 'es');
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Quoter' } });
    fireEvent.click(await screen.findByRole('button', { name: /Quoter Set/ }));
    await screen.findByLabelText('Buscar carta');

    const stickyBar = container.querySelector('[class*="lg:sticky"]');
    expect(stickyBar).not.toBeNull();
    expect(stickyBar!.className).toContain('lg:top-[var(--app-header-h,0px)]');
    expect(stickyBar!.className).not.toContain('lg:top-0');
  });
});

/**
 * v1.33-master-set-multipart (P-27, §4.31): un set multi-parte (Celebrations `cel25` + Classic
 * Collection `cel25c` = 50) se presenta como UN master combinado — cells fan-in de ambas partes,
 * separador/etiqueta por bloque, conteos = Σ (50), plegado en índice/dropdown, y normalización de
 * un subset a su principal vía `canonicalSetId`. Aditivo: un set de una sola parte NO cambia.
 */
describe('Master Set · Multi-parte / master combinado (P-27, v1.33)', () => {
  async function openCelebrations() {
    fireEvent.change(await screen.findByLabelText('Buscar set'), {
      target: { value: 'Celebrations' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Celebrations/ }));
    await screen.findByRole('heading', { level: 2, name: 'Celebrations' });
  }

  it('el binder COMBINADO muestra las 50 (Σ de partes) con separador/etiqueta por bloque (principal primero, luego el subset)', async () => {
    const { container } = renderWithProviders(<MasterSetPanel />, 'es');
    await openCelebrations();

    // Encabezado de completitud = universo COMBINADO por variante = 50 (cada carta 1 acabado × 50).
    expect(await screen.findByText('0/50 variantes · 0%')).toBeInTheDocument();

    // Dos SEPARADORES de bloque: el del principal (etiqueta = nombre del master) y el del subset.
    const principalSep = await screen.findByRole('heading', { level: 3, name: 'Celebrations' });
    const subsetSep = screen.getByRole('heading', { level: 3, name: 'Classic Collection' });
    expect(principalSep).toBeInTheDocument();
    expect(subsetSep).toBeInTheDocument();
    // Cada separador etiqueta su parte REAL (money-safe: cardId sigue llaveado a su set).
    expect(principalSep.getAttribute('data-part-set-id')).toBe('cel25');
    expect(subsetSep.getAttribute('data-part-set-id')).toBe('cel25c');
    // El bloque del principal va ANTES que el del subset en el DOM (orden de bloque §4.31b.3).
    const seps = container.querySelectorAll('[data-part-set-id]');
    expect(Array.from(seps).map((s) => s.getAttribute('data-part-set-id'))).toEqual([
      'cel25',
      'cel25c',
    ]);

    // Colisión de numeración entre partes: hay DOS "#1" (uno por bloque), desambiguados por el separador.
    expect(screen.getAllByText('#1')).toHaveLength(2);
    // Y una carta de cada parte, cada una bajo su nombre de bloque (texto exacto: "#1" ≠ "#10").
    expect(screen.getByText('Celebrations #1')).toBeInTheDocument();
    expect(screen.getByText('Classic Collection #1')).toBeInTheDocument();
  });

  it('un set de UNA sola parte (Base Set) NO pinta separadores de bloque (render idéntico a hoy)', async () => {
    const { container } = renderWithProviders(<MasterSetPanel />, 'es');
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Base' } });
    fireEvent.click(await screen.findByRole('button', { name: /Base Set/ }));
    await screen.findByRole('heading', { level: 2, name: 'Base Set' });
    await screen.findAllByText('#2'); // binder cargado

    // Sin `parts` ⇒ una sola sección sin encabezado de bloque (ningún separador con data-part-set-id).
    expect(container.querySelector('[data-part-set-id]')).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('el índice/dropdown pliega el subset: Celebrations aparece UNA vez (marcada "Combinado") y Classic Collection NO como fila suelta', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');

    // El master combinado aparece una sola vez, marcado "Combinado", con las 50 esperadas.
    const celButtons = await screen.findAllByRole('button', { name: /^Celebrations/ });
    expect(celButtons).toHaveLength(1);
    expect(within(celButtons[0]).getByText('Combinado')).toBeInTheDocument();
    expect(within(celButtons[0]).getByText('0/50 variantes · 0%')).toBeInTheDocument();

    // El subset NO aparece como set suelto duplicado en el índice.
    expect(screen.queryByRole('button', { name: /Classic Collection/ })).toBeNull();
  });

  it('navegación por canonicalSetId: abrir el binder de un SUBSET (cel25c) normaliza al principal y muestra "Celebrations"', async () => {
    // Simula un deep-link/entrada rezagada que abre el binder por el SUBSET. El índice ya lo pliega,
    // así que se fuerza una fila del subset para ejercer la normalización servidor→canonicalSetId.
    vi.spyOn(api, 'getMasterSets').mockResolvedValue({
      data: [
        {
          setId: 'cel25c',
          name: 'Classic Collection',
          series: 'Sword & Shield',
          year: 2021,
          catalogCardCount: 25,
          distinctCardsOwned: 0,
          completionPct: 0,
          totalPieces: 0,
          catalogVariantCount: 25,
          distinctVariantsOwned: 0,
          variantCompletionPct: 0,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      scope: 'platform',
    });

    renderWithProviders(<MasterSetPanel />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Classic Collection/ }));

    // El binder pidió por cel25c pero el backend lo normalizó a su principal: el título es "Celebrations"
    // (no el binder roto de 25) y trae las 50 combinadas con sus dos separadores de bloque.
    expect(await screen.findByRole('heading', { level: 2, name: 'Celebrations' })).toBeInTheDocument();
    expect(await screen.findByText('0/50 variantes · 0%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Classic Collection' })).toBeInTheDocument();
  });
});
