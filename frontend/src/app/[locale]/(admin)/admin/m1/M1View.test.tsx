import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Fake', page: 1, pageSize: 20 }),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cargar más' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'Fake', page: 2, pageSize: 20 })),
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

  it('P-4: un error del alta muestra el mensaje real del contrato (PRICE_PENDING)', async () => {
    vi.spyOn(api, 'createInventoryItem').mockRejectedValue(
      new ApiClientError(422, { code: 'PRICE_PENDING', message: 'price pending' }),
    );
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Pikachu');
    fireEvent.click((await within(dialog).findAllByRole('option', { name: /Pikachu/ }))[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));

    expect(
      await within(dialog).findByText('Esta carta tiene precio pendiente y aún no se puede comprar.'),
    ).toBeInTheDocument();
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
    fireEvent.click(markBtn);

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
