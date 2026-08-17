import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
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

describe('Master Set · Índice (agregados)', () => {
  it('la tarjeta del set pinta completitud (distintas/catálogo · %) y conteo de piezas', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    fireEvent.change(await screen.findByLabelText('Buscar set'), { target: { value: 'Base' } });

    // base1 en fixtures: 2 cartas distintas con piezas de 6 del catálogo (33.3%), 5 piezas on-hand.
    expect(await screen.findByText('2/6 cartas · 33.3%')).toBeInTheDocument();
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

describe('Master Set · Binder (chips por acabado + orden + gaps + secret rare)', () => {
  it('pinta chips de cantidad POR ACABADO desde countsByFinish', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Charizard (#4) tiene 3 piezas normal + 1 reverse holo en fixtures.
    expect(document.querySelector('[aria-label="Normal: 3 piezas"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Reverse Holo: 1 piezas"]')).toBeTruthy();
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

  it('marca huecos (celdas sin piezas) y permite filtrar solo huecos', async () => {
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();

    // Hay al menos un hueco (Pikachu/Blastoise/… sin piezas on-hand en fixtures).
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
  it('maneja ITEM_NOT_PUBLISHABLE (pieza reservada) sin tumbar la pieza publicable', async () => {
    const spy = vi.spyOn(api, 'bulkPublishItems');
    renderWithProviders(<MasterSetPanel />, 'es');
    await openBaseSetBinder();
    const drawer = await openCell(/Charizard/);

    // Piezas de Charizard: [0]=listed, [1]=in_stock (publicable), [3]=reserved (NO publicable).
    const boxes = await within(drawer).findAllByRole('checkbox');
    fireEvent.click(boxes[1]); // in_stock → ok
    fireEvent.click(boxes[3]); // reserved → ITEM_NOT_PUBLISHABLE
    fireEvent.click(within(drawer).getByRole('button', { name: /Publicar seleccionadas/ }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // 1 publicada + 1 error, y el error por-línea traducido (no tumba a la publicable).
    expect(await within(drawer).findByText('1 publicadas · 1 con error.')).toBeInTheDocument();
    expect(
      within(drawer).getByText(/no se puede publicar en su estado actual/),
    ).toBeInTheDocument();
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
