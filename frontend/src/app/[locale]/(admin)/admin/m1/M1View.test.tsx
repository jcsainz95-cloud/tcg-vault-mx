import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';
import { M1View } from './M1View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { CardDTO, Paginated } from '@/types/contract';

// Rol controlable por test (P-24: las tarjetas de valor son solo super_admin).
const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

// Link de next-intl no resuelve bajo vitest; se stubea a <a href> (patrón AdminDashboard.test).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
  window.history.replaceState(null, '', '/');
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

/** Abre el modal «Alta por lote» (el alta masiva P-5, ahora en la toolbar) y busca. */
async function openModalAndSearch(term: string) {
  fireEvent.click(screen.getByRole('button', { name: /Alta por lote/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
  fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: term } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
  return dialog;
}

describe('M1View · Layout P-17 (pestañas + buscador por folio + tarjetas de valor)', () => {
  it('abre en Master Set por default, con pestañas Sellado y Gradeadas — SIN pestaña Piezas', async () => {
    renderWithProviders(<M1View />, 'es');

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Master Set', 'Sellado', 'Gradeadas']);
    expect(screen.getByRole('tab', { name: 'Master Set' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Piezas' })).not.toBeInTheDocument();
    // El binder Master Set (índice de sets) es el contenido default.
    expect(await screen.findByLabelText('Buscar set')).toBeInTheDocument();
  });

  it('P-24: super_admin ve las 4 tarjetas de valor (a mercado + costo + N sin precio → M2)', async () => {
    renderWithProviders(<M1View />, 'es');

    expect(await screen.findByText('Valor total')).toBeInTheDocument();
    expect(screen.getByText('Sueltas')).toBeInTheDocument();
    // "Sellado"/"Gradeadas" aparecen también como pestañas → basta el total + sueltas + cifras.
    expect(screen.getByText('MX$84,300.00')).toBeInTheDocument(); // atReferenceCents total
    expect(screen.getByText('Costo: MX$59,010.00')).toBeInTheDocument();
    // Exclusión visible: la línea "sin precio" enlaza a la cola M2 (context=inventory).
    const pending = screen.getByRole('link', { name: '3 piezas sin precio' });
    expect(pending.getAttribute('href')).toContain('/admin/m2');
  });

  it('P-24: para vault_operator la fila de valor se OMITE por completo (sin candados)', async () => {
    roleState.role = 'vault_operator';
    renderWithProviders(<M1View />, 'es');

    await screen.findByLabelText('Buscar set');
    expect(screen.queryByText('Valor total')).not.toBeInTheDocument();
    expect(screen.queryByText(/sin precio/)).not.toBeInTheDocument();
  });

  it('la pestaña activa se refleja en la URL (?tab=) al cambiar a Sellado', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('tab', { name: 'Sellado' }));

    await waitFor(() => expect(window.location.search).toContain('tab=sealed'));
    expect(screen.getByRole('tab', { name: 'Sellado' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('M1View · Buscador por folio persistente (§16.1.1)', () => {
  it('un folio válido abre el DRILL-DOWN de la variante dueña con la pieza resaltada', async () => {
    renderWithProviders(<M1View />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar por folio'), {
      target: { value: 'INV-000110' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar folio' }));

    // INV-000110 (fixtures) = Zapdos raw holofoil → drill-down de ESA variante.
    const drawer = await screen.findByRole('dialog', { name: /Zapdos/ });
    expect(within(drawer).getByText(/RAW · NM · HOLOFOIL/)).toBeInTheDocument();
    // La fila de la pieza está presente (folio copiable).
    expect(await within(drawer).findByText(/INV-000110/)).toBeInTheDocument();
  });

  it('folio inexistente → mensaje inline bajo el input (no toast)', async () => {
    renderWithProviders(<M1View />, 'es');

    fireEvent.change(screen.getByLabelText('Buscar por folio'), {
      target: { value: 'INV-999999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar folio' }));

    expect(await screen.findByText('No existe una pieza con ese folio.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('M1View · «Alta por lote» (modal P-5 existente, sin cambios funcionales)', () => {
  it('los resultados muestran miniatura, #número, rareza y acabados disponibles', async () => {
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Charizard');

    const option = await within(dialog).findByRole('option', { name: /Charizard/ });
    expect(within(option).getByText('#4')).toBeInTheDocument();
    expect(within(option).getByText('Rare Holo')).toBeInTheDocument();
    expect(within(option).getByText('Holofoil')).toBeInTheDocument();
    expect(within(option).getByText('Reverse Holo')).toBeInTheDocument();
  });

  it('pagina con "Cargar más": pide page=2 y acumula resultados', async () => {
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
    // P-3: pageSize 50 para bajar la fricción de "Cargar más".
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'Fake', page: 1, pageSize: 50 }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cargar más' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'Fake', page: 2, pageSize: 50 })),
    );
    expect(await within(dialog).findByText('25 de 25 cartas')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('P-4.3: al crear con éxito dispara un toast INEQUÍVOCO con el folio y refresca la lista', async () => {
    vi.spyOn(api, 'createInventoryItem').mockResolvedValue({
      id: 'inv-new-1',
      folio: 'INV-000777',
      status: 'in_stock',
      acquisitionCostCents: 0,
    });
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Pikachu');
    fireEvent.click((await within(dialog).findAllByRole('option', { name: /Pikachu/ }))[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));

    // El toast vive en un portal a <body>, visible por encima del modal.
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

    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText('No se pudo dar de alta')).toBeInTheDocument();
    expect(
      within(alert).getByText(
        'Esta carta aún no tiene precio de referencia; se envió a la cola de precios pendientes.',
      ),
    ).toBeInTheDocument();
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
    const dialog = await openModalAndSearch('Fake');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));

    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: /Fake Card 2/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 2 cartas' }));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    const payload = batchSpy.mock.calls[0][0];
    expect(payload.items).toHaveLength(2);
    expect(payload.batchKey).toBeTruthy();

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
    const dialog = await openModalAndSearch('Fake');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));

    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByText('INV-000600')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Dar de alta 0 cartas' })).toBeDisabled();
  });

  it('P-5: anti-doble-alta — tras un ÉXITO el batchKey se RENUEVA; un retry tras FALLO lo REUSA', async () => {
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
    const dialog = await openModalAndSearch('Fake');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));

    // 1ª tanda.
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
    await within(dialog).findByText('INV-000700');

    // 2ª tanda: nueva key (nunca un replay que duplique).
    fireEvent.click(within(dialog).getByRole('option', { name: /Fake Card 2/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(2));

    const firstKey = batchSpy.mock.calls[0][0].batchKey;
    const secondKey = batchSpy.mock.calls[1][0].batchKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it('P-5: replay — un reintento del MISMO envío (tras fallo) REUSA la batchKey (idempotencia)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1)], 1, 1));
    const batchSpy = vi
      .spyOn(api, 'batchCreateItems')
      .mockRejectedValue(new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }));
    renderWithProviders(<M1View />, 'es');
    const dialog = await openModalAndSearch('Fake');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 1 cartas' }));
    await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(2));

    expect(batchSpy.mock.calls[1][0].batchKey).toBe(batchSpy.mock.calls[0][0].batchKey);
  });

  it('FIX 1: en `graded` la multi-selección se DESHABILITA (cert único por pieza)', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Alta por lote/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });

    const multi = within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ });
    fireEvent.click(multi);
    expect(multi).toBeChecked();

    fireEvent.change(within(dialog).getByLabelText('Tipo de producto'), {
      target: { value: 'graded' },
    });
    expect(multi).not.toBeChecked();
    expect(multi).toBeDisabled();
    expect(
      within(dialog).queryByRole('button', { name: /Dar de alta \d+ cartas/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Crear item' })).toBeInTheDocument();
  });

  it('el select de adquisición manual NO ofrece "buylist" (esa vía es la conversión de M5)', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Alta por lote/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
    const acqSelect = within(dialog).getByLabelText('Tipo de adquisición');
    expect(within(acqSelect).getByRole('option', { name: 'Aportación en especie' })).toBeInTheDocument();
    expect(within(acqSelect).getByRole('option', { name: 'Compra' })).toBeInTheDocument();
    expect(within(acqSelect).queryByRole('option', { name: /Buylist/ })).not.toBeInTheDocument();
  });
});

describe('M1View · Drill-down: detalle por pieza (capacidades de la ex-pestaña Piezas)', () => {
  async function openDrawerByFolio(folio: string) {
    renderWithProviders(<M1View />, 'es');
    fireEvent.change(screen.getByLabelText('Buscar por folio'), { target: { value: folio } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar folio' }));
    return screen.findByRole('dialog');
  }

  it('desde la fila del drill-down se abre el detalle con historial de movimientos', async () => {
    const drawer = await openDrawerByFolio('INV-000110');

    fireEvent.click(await within(drawer).findByRole('button', { name: 'Ver detalle de INV-000110' }));
    const detail = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    expect(await within(detail).findByText('Historial de movimientos')).toBeInTheDocument();
    expect(within(detail).getAllByText('INV-000110').length).toBeGreaterThan(0);
  });

  it('merma exige nota obligatoria y llama a POST /admin/inventory/adjustments', async () => {
    const spy = vi.spyOn(api, 'createInventoryAdjustment');
    const drawer = await openDrawerByFolio('INV-000110');

    fireEvent.click(await within(drawer).findByRole('button', { name: 'Merma de INV-000110' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Merma de INV-000110' });

    const confirmBtn = within(confirmDialog).getByRole('button', { name: 'Registrar merma' });
    expect(confirmBtn).toBeDisabled(); // sin nota no hay merma

    fireEvent.change(within(confirmDialog).getByLabelText(/Nota/), {
      target: { value: 'No apareció en levantamiento' },
    });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        reason: 'perdida',
        inventoryItemId: 'inv-1010',
        note: 'No apareció en levantamiento',
      }),
    );
  });
});

describe('M1View · Ubicaciones de bóveda (capacidad conservada)', () => {
  it('crea una ubicación (POST /admin/locations) y confirma con el label', async () => {
    const spy = vi.spyOn(api, 'createLocation');
    renderWithProviders(<M1View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: /Ubicaciones/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Ubicaciones de bóveda' });

    expect(await within(dialog).findByText('C03-F02-S15')).toBeInTheDocument();

    const createBtn = within(dialog).getByRole('button', { name: /Crear ubicación/ });
    expect(createBtn).toBeDisabled();

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

describe('M1View · Pestañas Sellado y Gradeadas (P-25 / P-20)', () => {
  it('Sellado: índice por set con piezas/listadas/valor y badge de no-mapeados', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('tab', { name: 'Sellado' }));

    // sv08 (fixtures): 1 pieza sellada mapeada con referencia MX$3,200.00. (La DataTable pinta
    // tabla md+ y bloques <md → el mismo texto aparece dos veces.)
    expect((await screen.findAllByText('Surging Sparks')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('MX$3,200.00').length).toBeGreaterThan(0);
    // super_admin ve el acceso a la cola de no-mapeados (unmappedTotal global > 0).
    expect(screen.getByRole('link', { name: /Cola de no mapeados/ })).toBeInTheDocument();
  });

  it('Sellado: para vault_operator NO existe el enlace a la cola de no-mapeados', async () => {
    roleState.role = 'vault_operator';
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('tab', { name: 'Sellado' }));

    await screen.findAllByText('Surging Sparks');
    expect(screen.queryByRole('link', { name: /Cola de no mapeados/ })).not.toBeInTheDocument();
  });

  it('Gradeadas: lista por carta+grado con valor manual ·M y costo (super_admin)', async () => {
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('tab', { name: 'Gradeadas' }));

    // Charizard PSA 9 (fixtures) con valor de mercado manual (MX$32,600.00 ·M).
    expect((await screen.findAllByText('Charizard')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('PSA 9').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MX\$32,600\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('·M').length).toBeGreaterThan(0);
  });
});
