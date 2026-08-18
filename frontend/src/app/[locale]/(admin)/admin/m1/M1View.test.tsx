import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';
import { M1View } from './M1View';
import * as api from '@/lib/api';
import * as fx from '@/lib/mock/fixtures';
import { ApiClientError } from '@/lib/api-client';
import type { CardDTO, Paginated } from '@/types/contract';

beforeEach(() => {
  vi.restoreAllMocks();
});

function fakeCard(i: number): CardDTO {
  return {
    id: `c-fake-${i}`,
    externalId: `c-fake-${i}`,
    name: `Fake Card ${i}`,
    number: String(i),
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    setId: 'base1',
    setName: 'Base Set',
    imageSmallUrl: `https://img.example/${i}.png`,
    imageLargeUrl: `https://img.example/${i}_hires.png`,
    availableFinishes: ['normal'],
  };
}

function page(cards: CardDTO[], pageNum: number, total: number): Paginated<CardDTO> {
  return { data: cards, page: pageNum, pageSize: 20, total };
}

async function openModalAndSearch(term: string) {
  fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
  fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: term } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
  return dialog;
}

describe('M1View · Buscador / picker del catálogo', () => {
  it('los resultados muestran miniatura, #número, rareza y acabados disponibles', async () => {
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Charizard');

    const option = await within(dialog).findByRole('option', { name: /Charizard/ });
    // #número + rareza (CardDTO ya los trae) + badges de acabados (v1.6-finish).
    expect(within(option).getByText('#4')).toBeInTheDocument();
    expect(within(option).getByText('Rare Holo')).toBeInTheDocument();
    expect(within(option).getByText('Holofoil')).toBeInTheDocument();
    expect(within(option).getByText('Reverse Holo')).toBeInTheDocument();
  });

  it('pagina con "Cargar más": pide page=2 y acumula resultados (raíz de "veo pocas cartas")', async () => {
    const spy = vi
      .spyOn(api, 'searchBuylistCards')
      .mockImplementation(async (filters) =>
        (filters?.page ?? 1) === 1
          ? page(Array.from({ length: 20 }, (_, i) => fakeCard(i + 1)), 1, 25)
          : page(Array.from({ length: 5 }, (_, i) => fakeCard(i + 21)), 2, 25),
      );
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Fake');

    expect(await within(dialog).findByText('20 de 25 cartas')).toBeInTheDocument();
    // P-3: el buscador del alta pide pageSize 50 (antes 20) para bajar la fricción de "Cargar más".
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Fake', page: 1, pageSize: 50 }),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cargar más' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'Fake', page: 2, pageSize: 50 })),
    );
    expect(await within(dialog).findByText('25 de 25 cartas')).toBeInTheDocument();
    // Con todo cargado, el botón desaparece.
    expect(within(dialog).queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('una carta raw con UN solo acabado lo muestra fijo (no lo oculta en silencio)', async () => {
    renderWithProviders(<M1View />, 'es');
    // c-latias-sir solo existe en holofoil.
    const dialog = await openModalAndSearch('Latias');
    fireEvent.click(await within(dialog).findByRole('option', { name: /Latias/ }));

    expect(
      await within(dialog).findByText('Acabado: Holofoil (único disponible para esta carta).'),
    ).toBeInTheDocument();
  });

  it('P-4: el alta usa el folio devuelto para confirmar el éxito', async () => {
    vi.spyOn(api, 'createInventoryItem').mockResolvedValue({
      id: 'inv-new-1',
      folio: 'INV-000777',
      status: 'in_stock',
      acquisitionCostCents: 0,
    });
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Pikachu');
    fireEvent.click((await within(dialog).findAllByRole('option', { name: /Pikachu/ }))[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));

    expect(
      await screen.findByText('Item creado en bóveda · folio INV-000777.'),
    ).toBeInTheDocument();
  });

  it('P-4.3: al crear con éxito dispara un toast INEQUÍVOCO con el folio y refresca la lista', async () => {
    vi.spyOn(api, 'createInventoryItem').mockResolvedValue({
      id: 'inv-new-1',
      folio: 'INV-000777',
      status: 'in_stock',
      acquisitionCostCents: 0,
    });
    // FIX 4: el éxito debe invalidar la query del inventario admin (refresco de la tabla).
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Pikachu');
    fireEvent.click((await within(dialog).findAllByRole('option', { name: /Pikachu/ }))[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));

    // El toast vive en un portal a <body> (visible por encima del modal), no dentro del dialog.
    expect(await screen.findByText('Pieza dada de alta · folio INV-000777.')).toBeInTheDocument();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-inventory'] }),
    );
  });

  it('P-4.1/4.2: un error del alta se ve ARRIBA con copy del OPERADOR (PRICE_PENDING)', async () => {
    vi.spyOn(api, 'createInventoryItem').mockRejectedValue(
      new ApiClientError(422, { code: 'PRICE_PENDING', message: 'price pending' }),
    );
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Pikachu');
    fireEvent.click((await within(dialog).findAllByRole('option', { name: /Pikachu/ }))[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));

    // Copy del alta admin (no el de storefront "no se puede comprar").
    const alert = await within(dialog).findByRole('alert');
    // FIX 3: el título es corto y el cuerpo NO repite "No se pudo dar de alta:" (sin redundancia).
    expect(within(alert).getByText('No se pudo dar de alta')).toBeInTheDocument();
    expect(
      within(alert).getByText(
        'Esta carta aún no tiene precio de referencia; se envió a la cola de precios pendientes.',
      ),
    ).toBeInTheDocument();
    // El cuerpo no arrastra el prefijo del título.
    expect(within(alert).queryByText(/No se pudo dar de alta:/)).not.toBeInTheDocument();
  });

  it('P-5: alta MASIVA envía un lote y muestra el resultado por-ítem (folio + fallo)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1), fakeCard(2)], 1, 2));
    const batchSpy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue({
      batchKey: 'batch-test',
      idempotentReplay: false,
      summary: { requested: 2, createdItems: 1, failedLines: 1 },
      results: [
        { index: 0, ok: true, folios: ['INV-000501'], inventoryItemIds: ['inv-a'] },
        { index: 1, ok: false, error: { code: 'PRICE_PENDING', message: 'price pending' } },
      ],
    });
    renderWithProviders(<M1View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
    // Activa el modo de selección múltiple.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
    fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'Fake' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));

    // Marca las dos cartas en el lote.
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: /Fake Card 2/ }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 2 cartas' }));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    const payload = batchSpy.mock.calls[0][0];
    expect(payload.items).toHaveLength(2);
    expect(payload.batchKey).toBeTruthy();

    // Resultado por-ítem: la creada con su folio, la fallida con su motivo (copy del operador).
    expect(await within(dialog).findByText('INV-000501')).toBeInTheDocument();
    expect(within(dialog).getByText(/precio de referencia/)).toBeInTheDocument();
  });

  it('P-5: tras un envío exitoso el lote se VACÍA (no se puede reenviar y duplicar las creadas)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1)], 1, 1));
    const batchSpy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue({
      batchKey: 'batch-test',
      idempotentReplay: false,
      summary: { requested: 1, createdItems: 1, failedLines: 0 },
      results: [{ index: 0, ok: true, folios: ['INV-000600'], inventoryItemIds: ['inv-a'] }],
    });
    renderWithProviders(<M1View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
    fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'Fake' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    // Tras un envío exitoso el lote se vacía (evita reenviar y duplicar las creadas): el botón
    // queda deshabilitado con conteo 0 y el resultado por-ítem se conserva.
    expect(await within(dialog).findByText('INV-000600')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Dar de alta 0 cartas' })).toBeDisabled();
  });

  it('P-5: anti-doble-alta — tras un ÉXITO el batchKey se RENUEVA (la nueva tanda usa otra key)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1), fakeCard(2)], 1, 2));
    const batchSpy = vi.spyOn(api, 'batchCreateItems').mockImplementation(async (payload) => ({
      batchKey: payload.batchKey,
      idempotentReplay: false,
      summary: { requested: payload.items.length, createdItems: payload.items.length, failedLines: 0 },
      results: payload.items.map((_, i) => ({
        index: i,
        ok: true as const,
        folios: [`INV-00070${i}`],
        inventoryItemIds: [`inv-${i}`],
      })),
    }));
    renderWithProviders(<M1View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
    fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'Fake' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));

    // 1ª tanda.
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    await within(dialog).findByText('INV-000700');

    // 2ª tanda: se arma un nuevo lote y se envía.
    fireEvent.click(within(dialog).getByRole('option', { name: /Fake Card 2/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(2));

    const firstKey = batchSpy.mock.calls[0][0].batchKey;
    const secondKey = batchSpy.mock.calls[1][0].batchKey;
    // Cada tanda exitosa RENUEVA la key → dos altas distintas, nunca un replay que duplique.
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it('P-5: replay — un reintento del MISMO envío (tras fallo) REUSA la batchKey (idempotencia)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1)], 1, 1));
    // El envío falla (p. ej. timeout de red): el lote NO se vacía y la key NO se renueva.
    const batchSpy = vi
      .spyOn(api, 'batchCreateItems')
      .mockRejectedValue(new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }));
    renderWithProviders(<M1View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
    fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'Fake' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));

    const submit = within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' });
    fireEvent.click(submit);
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));

    // Reintento del mismo lote (el botón sigue con conteo 1 porque el fallo no vació el lote).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(2));

    // Misma key en ambos envíos → el backend lo trata como replay idempotente, no como alta nueva.
    expect(batchSpy.mock.calls[1][0].batchKey).toBe(batchSpy.mock.calls[0][0].batchKey);
  });

  it('FIX 1: en `graded` la multi-selección se DESHABILITA (no se arma/envía lote con cert compartido)', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });

    const multi = within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ });
    // En raw se puede activar el modo masivo.
    fireEvent.click(multi);
    expect(multi).toBeChecked();

    // Cambiar a gradeada FUERZA selección única: apaga el modo masivo y deshabilita el checkbox.
    fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), {
      target: { value: 'graded' },
    });
    expect(multi).not.toBeChecked();
    expect(multi).toBeDisabled();
    // No hay botón de envío de LOTE en graded (solo alta simple con su cert único).
    expect(
      within(dialog).queryByRole('button', { name: /Dar de alta \d+ cartas/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Crear item' })).toBeInTheDocument();
  });
});

// La DataTable pinta tabla (md+) y bloques (<md): el mismo texto aparece dos veces.
// Estos helpers toleran esa duplicación responsive.
async function findFolioRow(folio: string): Promise<HTMLElement> {
  const cells = await screen.findAllByText(folio);
  const inTable = cells.map((c) => c.closest('tr')).find(Boolean);
  return inTable as HTMLElement;
}

describe('M1View · Tabla con filtros + paginación (Ola 2)', () => {
  it('manda los filtros y la paginación reales a GET /admin/inventory/items', async () => {
    const spy = vi.spyOn(api, 'getAdminInventory');
    renderWithProviders(<M1View />, 'es');

    await screen.findAllByText('INV-000101');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));

    // Cambiar el filtro de estado re-consulta con `status` y reinicia a página 1.
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'in_stock' } });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_stock', page: 1 })),
    );
    // La rama mock filtra de verdad: solo queda el item in_stock.
    expect((await screen.findAllByText('INV-000110')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('INV-000101')).toHaveLength(0);
  });

  it('pagina con Siguiente: pide page=2 cuando hay más de una página', async () => {
    const spy = vi.spyOn(api, 'getAdminInventory').mockImplementation(async (filters) => ({
      data: [
        {
          id: `inv-p${filters?.page ?? 1}`,
          folio: `INV-P${filters?.page ?? 1}`,
          card: fakeCard(1),
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          status: 'in_stock',
          ownerType: 'platform',
        },
      ],
      page: filters?.page ?? 1,
      pageSize: 20,
      total: 25,
    }));
    renderWithProviders(<M1View />, 'es');

    await screen.findAllByText('INV-P1');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    expect((await screen.findAllByText('INV-P2')).length).toBeGreaterThan(0);
  });
});

describe('M1View · Alta manual (enums traducidos + sin buylist)', () => {
  it('el select de tipo de producto usa labels legibles (Suelta (raw)), no el enum crudo', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
    const typeSelect = within(dialog).getByLabelText('Tipo de producto');
    expect(within(typeSelect).getByRole('option', { name: 'Suelta (raw)' })).toBeInTheDocument();
    expect(within(typeSelect).getByRole('option', { name: 'Gradeada' })).toBeInTheDocument();
  });

  it('el select de adquisición manual NO ofrece "buylist" (esa vía es la conversión de M5)', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Alta de item/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
    const acqSelect = within(dialog).getByLabelText('Tipo de adquisición');
    expect(within(acqSelect).getByRole('option', { name: 'Aportación en especie' })).toBeInTheDocument();
    expect(within(acqSelect).getByRole('option', { name: 'Compra' })).toBeInTheDocument();
    // buylist queda fuera del alta manual.
    expect(within(acqSelect).queryByRole('option', { name: /Buylist/ })).not.toBeInTheDocument();
  });
});

describe('M1View · Detalle por pieza + publicar (Ola 2)', () => {
  async function openDetail(folio: string) {
    renderWithProviders(<M1View />, 'es');
    const row = await findFolioRow(folio);
    fireEvent.click(within(row).getByRole('button', { name: 'Detalle' }));
    return screen.findByRole('dialog', { name: 'Detalle de pieza' });
  }

  it('muestra folio + acabado + estado + ubicación + historial de movimientos', async () => {
    // inv-1001: gradeada listed con 2 movimientos en fixtures (alta + move).
    const dialog = await openDetail('INV-000101');

    expect(await within(dialog).findByText('Historial de movimientos')).toBeInTheDocument();
    expect(within(dialog).getAllByText('INV-000101').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('C03-F02-S15')).toBeInTheDocument();
    expect(within(dialog).getByText('Alta')).toBeInTheDocument();
    // Gradeada: certificado visible en el detalle.
    expect(within(dialog).getByText('82749163')).toBeInTheDocument();
  });

  it('el detalle muestra el tipo TRADUCIDO (Gradeada), no el enum crudo "graded"', async () => {
    // inv-1001 es gradeada; §9.2 exige label legible, nunca el enum crudo.
    const dialog = await openDetail('INV-000101');
    expect(await within(dialog).findByText('Gradeada')).toBeInTheDocument();
    expect(within(dialog).queryByText('graded')).not.toBeInTheDocument();
  });

  it('publicar convierte pesos→centavos (Math.round) y manda PATCH status=listed', async () => {
    const spy = vi.spyOn(api, 'updateInventoryItem').mockResolvedValue({
      ...fx.mockInventory[2],
      status: 'listed',
      listPriceCents: 123456,
    });
    // inv-1010: raw in_stock → publicable.
    const dialog = await openDetail('INV-000110');

    fireEvent.change(await within(dialog).findByLabelText('Precio de venta (MXN)'), {
      target: { value: '1234.56' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('inv-1010', { status: 'listed', listPriceCents: 123456 }),
    );
    expect(
      await within(dialog).findByText('Item publicado en Compra · INV-000110.'),
    ).toBeInTheDocument();
  });

  it('un error real del PATCH se muestra al operador (422 VALIDATION_ERROR)', async () => {
    vi.spyOn(api, 'updateInventoryItem').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'graded items require certNumber' }),
    );
    const dialog = await openDetail('INV-000110');

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Publicar' }));

    expect(await within(dialog).findByText('Revisa los datos ingresados.')).toBeInTheDocument();
  });

  it('marcar pérdida exige nota (botón deshabilitado sin nota, contrato §M1 mark)', async () => {
    const spy = vi.spyOn(api, 'markInventoryItem');
    const dialog = await openDetail('INV-000110');

    const markBtn = await within(dialog).findByRole('button', { name: 'Marcar' });
    expect(markBtn).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Nota \(obligatoria\)/), {
      target: { value: 'Se dañó en manejo' },
    });
    expect(markBtn).not.toBeDisabled();
    // §7.6: "Marcar" NO dispara la mutación directo → abre la confirmación.
    fireEvent.click(markBtn);
    expect(spy).not.toHaveBeenCalled();

    // Se confirma en el modal (acción destructiva).
    const confirm = await screen.findByRole('dialog', { name: 'Confirmar marca' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sí, marcar Perdida' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('inv-1010', { mark: 'lost', note: 'Se dañó en manejo' }),
    );
  });
});

describe('M1View · Ubicaciones de bóveda (Ola 2)', () => {
  it('crea una ubicación (POST /admin/locations) y confirma con el label', async () => {
    const spy = vi.spyOn(api, 'createLocation');
    renderWithProviders(<M1View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Ubicaciones/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ubicaciones de bóveda' });

    // Lista las existentes.
    expect(await within(dialog).findByText('C03-F02-S15')).toBeInTheDocument();

    const createBtn = within(dialog).getByRole('button', { name: /Crear ubicación/ });
    expect(createBtn).toBeDisabled(); // incompleta: caja/fila/slot vacíos

    fireEvent.change(within(dialog).getByLabelText('Caja'), { target: { value: 'C99' } });
    fireEvent.change(within(dialog).getByLabelText('Fila'), { target: { value: 'F01' } });
    fireEvent.change(within(dialog).getByLabelText('Slot'), { target: { value: 'S01' } });
    fireEvent.click(createBtn);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ zone: 'platform_stock', box: 'C99', row: 'F01', slot: 'S01' }),
    );
    expect(await within(dialog).findByText('Ubicación C99-F01-S01 creada.')).toBeInTheDocument();
  });
});
