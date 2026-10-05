import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../../../../../messages/es.json';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderWithProviders } from '@/test/render';
import { codigoDe } from '@/test/strip-comments';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { SealedPriceSheetResponse, SealedPriceSheetRowDTO } from '@/types/contract';
import { SealedPriceSheet } from './SealedPriceSheet';

/**
 * 💰 La hoja «Precios del sellado» (`DESIGN_SYSTEM §70.2`, `API_CONTRACT §M11-SP.5 + 12.4 + 13.7`). Candados UX-SP-1…7,
 * UX-SP-17, UX-SP-19, UX-SP-20 de `§70.7` (los que coinciden con §M11-SP.8/12.14 llevan su F-SP).
 */

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m11',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

function row(over: Partial<SealedPriceSheetRowDTO> = {}): SealedPriceSheetRowDTO {
  return {
    sealedProductId: 'sp-1',
    name: 'Surging Sparks Elite Trainer Box',
    subtype: 'etb',
    imageUrl: null,
    active: true,
    set: { id: 'sv08', name: 'Surging Sparks' },
    pieces: { inStock: 3, listed: 3, reserved: 1 },
    cost: { avgCents: 90000, minCents: 85000, maxCents: 95000, withoutCost: 1 },
    ownerDisplayPriceCents: 145000,
    automaticListPriceCents: 118320,
    automaticDisplayPriceCents: 137251,
    automaticSource: 'subtype_spread',
    appliedSpreadPct: 16,
    effectiveOrigin: 'product',
    displayPriceCents: 145000,
    netPriceCents: 125000,
    market: { status: 'priced', referenceMxnCents: 102000, capturedDate: '2026-10-03' },
    legacyPiecePrices: { count: 0, minDisplayCents: null, maxDisplayCents: null, shadowed: true },
    margin: { cents: 35000, bps: 2800 },
    ...over,
  };
}

function sheet(rows: SealedPriceSheetRowDTO[], over: Partial<SealedPriceSheetResponse> = {}): SealedPriceSheetResponse {
  return {
    data: rows,
    page: 1,
    pageSize: 50,
    total: rows.length,
    unlinkedCount: 0,
    canEdit: true,
    iva: { ratePct: 16, transferPct: 100 },
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSealedInventorySets').mockResolvedValue({ data: [], page: 1, pageSize: 100, total: 0, unmappedTotal: 0 });
});

describe('UX-SP-1 = F-SP-1 · columnas de v6.1 y lápiz por `canEdit` (no por el rol del cliente)', () => {
  it('nueve columnas por su cabecera, ninguna «Lo ve el cliente»; «Sin IVA» pinta netPriceCents', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    renderWithProviders(<SealedPriceSheet />);
    await screen.findByTestId('sheet-row-sp-1');
    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent ?? '');
    for (const h of [
      'Producto',
      'Piezas',
      'Costo promedio',
      'Tu precio, con IVA',
      'Automático, con IVA',
      'Se vende a, con IVA',
      'Sin IVA',
      'Mercado',
      'Margen',
    ]) {
      expect(headers.some((x) => x.startsWith(h)), h).toBe(true);
    }
    expect(headers).toHaveLength(9);
    expect(table.textContent).not.toMatch(/Lo ve el cliente/);
    const cell = screen.getByTestId('sheet-net-sp-1');
    expect(cell.textContent).toContain('MX$1,250.00');
    expect(cell.textContent).toContain('IVA 16 %');
  });

  it('canEdit:false ⇒ cero botones de precio y cero inputs; pie del personal', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row(), row({ sealedProductId: 'sp-2', ownerDisplayPriceCents: null })], { canEdit: false }),
    );
    renderWithProviders(<SealedPriceSheet />);
    await screen.findByTestId('sheet-row-sp-1');
    expect(screen.queryAllByRole('button', { name: /^(Poner|Cambiar) precio de/ })).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(1); // solo «Buscar producto»
    expect(screen.getByText(/Solo el dueño cambia estos precios/)).toBeInTheDocument();
    // El personal VE costo y margen (P-SP-2).
    expect(screen.getAllByText('MX$900.00').length).toBeGreaterThan(0);
  });

  it('canEdit:true ⇒ un botón por fila', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row(), row({ sealedProductId: 'sp-2', name: 'Otro', ownerDisplayPriceCents: null })]),
    );
    renderWithProviders(<SealedPriceSheet />);
    await screen.findByTestId('sheet-row-sp-1');
    expect(screen.getByRole('button', { name: 'Cambiar precio de Surging Sparks Elite Trainer Box' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Poner precio de Otro' })).toBeInTheDocument();
  });
});

async function openEditor(name: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByLabelText('Tu precio, con IVA (MXN)');
}

describe('UX-SP-3 · prellenado', () => {
  it('sin precio del dueño ⇒ vacío aunque haya automático', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row({ ownerDisplayPriceCents: null, automaticDisplayPriceCents: 137251, effectiveOrigin: 'automatic', displayPriceCents: 137251 })]),
    );
    renderWithProviders(<SealedPriceSheet />);
    const input = (await openEditor(/^Poner precio de/)) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('con precio del dueño ⇒ ese precio', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    renderWithProviders(<SealedPriceSheet />);
    const input = (await openEditor(/^Cambiar precio de/)) as HTMLInputElement;
    expect(input.value).toBe('1450.00');
  });
});

describe('UX-SP-4 · pending ⇒ «Sin precio: no se vende», nunca MX$0.00', () => {
  it('fila pending', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([
        row({
          ownerDisplayPriceCents: null,
          automaticListPriceCents: null,
          automaticDisplayPriceCents: null,
          automaticSource: null,
          appliedSpreadPct: null,
          effectiveOrigin: 'pending',
          displayPriceCents: null,
          netPriceCents: null,
          market: null,
          margin: null,
          cost: { avgCents: null, minCents: null, maxCents: null, withoutCost: 2 },
        }),
      ]),
    );
    renderWithProviders(<SealedPriceSheet />);
    const tr = (await screen.findByTestId('sheet-row-sp-1')) as HTMLElement;
    expect(tr.textContent).toContain('Sin precio: no se vende');
    expect(tr.textContent).not.toContain('MX$0.00');
    expect(tr.textContent).toContain('sin costo registrado');
    expect(tr.textContent).toContain('sin mercado');
    expect(within(screen.getByTestId('sheet-margin-sp-1')).getByText('sin precio')).toBeInTheDocument();
  });

  it('costo 0 es válido: se pinta MX$0.00 en el costo', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row({ cost: { avgCents: 0, minCents: 0, maxCents: 0, withoutCost: 0 } })]),
    );
    renderWithProviders(<SealedPriceSheet />);
    expect((await screen.findByTestId('sheet-cost-sp-1')).textContent).toContain('MX$0.00');
  });
});

describe('UX-SP-5 · margen negativo y nulo', () => {
  it('pérdida ⇒ «−» y «pérdida»', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row({ margin: { cents: -5000, bps: -400 } })]));
    renderWithProviders(<SealedPriceSheet />);
    const cell = await screen.findByTestId('sheet-margin-sp-1');
    expect(cell.textContent).toContain('−MX$50.00');
    expect(cell.textContent).toMatch(/−4\.0\s?% · pérdida/);
  });

  it('margin null con precio ⇒ «—» + «sin costo»', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row({ margin: null, cost: { avgCents: null, minCents: null, maxCents: null, withoutCost: 7 } })]),
    );
    renderWithProviders(<SealedPriceSheet />);
    const cell = await screen.findByTestId('sheet-margin-sp-1');
    expect(cell.textContent).toContain('—');
    expect(cell.textContent).toContain('sin costo');
  });

  it('margen positivo con un decimal', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    renderWithProviders(<SealedPriceSheet />);
    const cell = await screen.findByTestId('sheet-margin-sp-1');
    expect(cell.textContent).toContain('MX$350.00');
    expect(cell.textContent).toMatch(/28\.0\s?%/);
    expect(cell.textContent).not.toMatch(/pérdida/);
  });
});

describe('UX-SP-6 · precios propios heredados', () => {
  it('shadowed:false ⇒ aviso, y «Pon tu precio…» solo con canEdit', async () => {
    const legacy = { count: 2, minDisplayCents: 127600, maxDisplayCents: 150800, shadowed: false };
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row({ ownerDisplayPriceCents: null, effectiveOrigin: 'automatic', legacyPiecePrices: legacy })]),
    );
    const { unmount } = renderWithProviders(<SealedPriceSheet />);
    const line = await screen.findByTestId('sheet-legacy-sp-1');
    expect(line.textContent).toContain('2 piezas cobran su precio propio (MX$1,276.00–MX$1,508.00), no el de esta fila.');
    expect(line.textContent).toContain('Pon tu precio para que todas cobren lo mismo.');
    unmount();

    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row({ ownerDisplayPriceCents: null, effectiveOrigin: 'automatic', legacyPiecePrices: legacy })], { canEdit: false }),
    );
    renderWithProviders(<SealedPriceSheet />);
    const line2 = await screen.findByTestId('sheet-legacy-sp-1');
    expect(line2.textContent).not.toContain('Pon tu precio');
  });

  it('shadowed:true ⇒ línea muted «ya no cuenta»', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row({ legacyPiecePrices: { count: 1, minDisplayCents: 127600, maxDisplayCents: 127600, shadowed: true } })]),
    );
    renderWithProviders(<SealedPriceSheet />);
    const line = await screen.findByTestId('sheet-legacy-sp-1');
    expect(line.textContent).toContain('1 pieza tenía precio propio (MX$1,276.00); ya no cuenta: manda el tuyo.');
  });

  it('count:0 ⇒ nada', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    renderWithProviders(<SealedPriceSheet />);
    await screen.findByTestId('sheet-row-sp-1');
    expect(screen.queryByTestId('sheet-legacy-sp-1')).toBeNull();
  });
});

describe('UX-SP-7 · piezas sin producto', () => {
  it('unlinkedCount:3 ⇒ banner', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()], { unlinkedCount: 3 }));
    renderWithProviders(<SealedPriceSheet />);
    expect(await screen.findByText(/3 piezas de sellado no están ligadas a un producto/)).toBeInTheDocument();
  });

  it('unlinkedCount:0 ⇒ ningún banner', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()], { unlinkedCount: 0 }));
    renderWithProviders(<SealedPriceSheet />);
    await screen.findByTestId('sheet-row-sp-1');
    expect(screen.queryByText(/no están ligadas a un producto/)).toBeNull();
  });
});

describe('estados de la hoja', () => {
  it('vacío on_hand sin filtros ⇒ EmptyState + «Incluir sin existencias» pide scope=all', async () => {
    const spy = vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([]));
    renderWithProviders(<SealedPriceSheet />);
    expect(await screen.findByText('No hay sellado en existencia ligado a un producto.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Incluir sin existencias' })[0]!);
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'all', page: 1 })));
  });

  it('error ⇒ Reintentar', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockRejectedValue(new Error('boom'));
    renderWithProviders(<SealedPriceSheet />);
    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
  });

  it('pide pageSize 50 y scope on_hand por defecto', async () => {
    const spy = vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    renderWithProviders(<SealedPriceSheet />);
    await screen.findByTestId('sheet-row-sp-1');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ scope: 'on_hand', page: 1, pageSize: 50 }));
  });
});

describe('💰 UX-SP-17 = F-SP-7 · lo tecleado es lo que viaja', () => {
  it.each([
    ['7.00', 700],
    ['1,299', 129900],
  ])('«%s» ⇒ displayPriceCents %i exacto, expected = el pintado', async (typed, cents) => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    const put = vi
      .spyOn(api, 'setSealedProductSalePrice')
      .mockResolvedValue({ data: row({ ownerDisplayPriceCents: cents }), autoPublish: { published: 0, missingLocation: 0, notPublished: 0 } });
    renderWithProviders(<SealedPriceSheet />);
    const input = await openEditor(/^Cambiar precio de/);
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByTestId('sealed-product-price-confirm'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('sp-1', { displayPriceCents: cents, expectedDisplayPriceCents: 145000 });
  });

  it('el margen en vivo usa iva.ratePct de la respuesta (r = 8 ⇒ cuarto vector)', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(
      sheet([row({ cost: { avgCents: 110000, minCents: 110000, maxCents: 110000, withoutCost: 0 } })], { iva: { ratePct: 8, transferPct: 100 } }),
    );
    renderWithProviders(<SealedPriceSheet />);
    const input = await openEditor(/^Cambiar precio de/);
    fireEvent.change(input, { target: { value: '1500' } });
    const preview = screen.getByTestId('sealed-product-price-margin-preview');
    expect(preview.textContent).toContain('Sin IVA: MX$1,388.89');
    expect(preview.textContent).toContain('margen MX$288.89');
    expect(preview.textContent).toMatch(/20\.8\s?%/);
  });

  it('⛔ ningún import de un derivador de L/P en frontend/src', () => {
    const root = join(process.cwd(), 'src');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const offenders = walk(root)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /\b(displayPriceCentsOf|listEquivalentCentsOf|saleDisplayCentsOf|taxBaseCentsOf)\b/.test(codigoDe(f)));
    expect(offenders).toEqual([]);
  });
});

describe('UX-SP-2 = F-SP-2 · 409 con recarga automática', () => {
  it('banner con la cifra del servidor, input conserva lo tecleado, la hoja se re-pide SIN clic', async () => {
    const get = vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    const put = vi.spyOn(api, 'setSealedProductSalePrice').mockRejectedValueOnce(
      new ApiClientError(409, { code: 'CONFLICT', message: 'x', details: { currentDisplayPriceCents: 1500 } }),
    );
    renderWithProviders(<SealedPriceSheet />);
    const input = (await openEditor(/^Cambiar precio de/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const callsBefore = get.mock.calls.length;
    fireEvent.click(await screen.findByTestId('sealed-product-price-confirm'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('MX$15.00');
    expect((screen.getByLabelText('Tu precio, con IVA (MXN)') as HTMLInputElement).value).toBe('1600');
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(within(alert).queryByRole('button', { name: 'Recargar' })).toBeNull();

    // El reintento lleva como `expected` el precio que dijo el servidor (1500), no el de la apertura.
    put.mockResolvedValueOnce({ data: row({ ownerDisplayPriceCents: 160000 }), autoPublish: { published: 0, missingLocation: 0, notPublished: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByTestId('sealed-product-price-confirm'));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1]![1]).toEqual({ displayPriceCents: 160000, expectedDisplayPriceCents: 1500 });
  });

  it('el expected NO se relee de la fila al enviar (la fila cambió por detrás sin 409)', async () => {
    const get = vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    const put = vi
      .spyOn(api, 'setSealedProductSalePrice')
      .mockResolvedValue({ data: row(), autoPublish: { published: 0, missingLocation: 0, notPublished: 0 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="es" messages={es}>
          <SealedPriceSheet />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const input = await openEditor(/^Cambiar precio de/);
    // Otra pestaña cambió el precio y la hoja se recargó mientras el editor estaba abierto.
    get.mockResolvedValue(sheet([row({ ownerDisplayPriceCents: 150000 })]));
    await client.invalidateQueries({ queryKey: ['sealed-price-sheet'] });
    await waitFor(() => expect(client.getQueryData<SealedPriceSheetResponse>(['sealed-price-sheet', { setId: undefined, q: '', scope: 'on_hand', page: 1 }])?.data[0]?.ownerDisplayPriceCents).toBe(150000));
    fireEvent.change(input, { target: { value: '1700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByTestId('sealed-product-price-confirm'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![1]).toEqual({ displayPriceCents: 170000, expectedDisplayPriceCents: 145000 });
  });
});

describe('UX-SP-19 = F-SP-8 · el aviso tras guardar lo dicen las cuentas de autoPublish', () => {
  it('{1,1,0} ⇒ 1 a la venta, 1 en caja; nada de notPublished', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    vi.spyOn(api, 'setSealedProductSalePrice').mockResolvedValue({
      // `pieces` del `data` iguales a las de antes: el aviso NO puede salir de compararlas.
      data: row({ ownerDisplayPriceCents: 150000 }),
      autoPublish: { published: 1, missingLocation: 1, notPublished: 0 },
    });
    renderWithProviders(<SealedPriceSheet />);
    const input = await openEditor(/^Cambiar precio de/);
    fireEvent.change(input, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByTestId('sealed-product-price-confirm'));
    const notice = await screen.findByTestId('sealed-price-saved-notice');
    expect(notice.textContent).toContain('Surging Sparks Elite Trainer Box: MX$1,500.00 con IVA para sus 7 piezas.');
    expect(notice.textContent).toContain('Se puso a la venta sola: 1.');
    expect(notice.textContent).toContain('1 sigue en caja: le falta ubicación.');
    expect(notice.textContent).not.toMatch(/no se pudo publicar/);
    expect(within(notice).getByRole('link', { name: 'Ver «Listas para publicar»' })).toBeInTheDocument();
    expect(screen.queryByTestId('sealed-product-price-editor-sp-1')).toBeNull();
  });

  it('autoPublish null ⇒ «se guardó, pero…» + enlace; editor cerrado (no es error)', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    vi.spyOn(api, 'setSealedProductSalePrice').mockResolvedValue({ data: row({ ownerDisplayPriceCents: 150000 }), autoPublish: null });
    renderWithProviders(<SealedPriceSheet />);
    const input = await openEditor(/^Cambiar precio de/);
    fireEvent.change(input, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    fireEvent.click(await screen.findByTestId('sealed-product-price-confirm'));
    const notice = await screen.findByTestId('sealed-price-saved-notice');
    expect(notice.textContent).toContain('El precio se guardó, pero no se pudo intentar publicar las piezas en caja.');
    expect(within(notice).getByRole('link', { name: 'Ver «Listas para publicar»' })).toBeInTheDocument();
    expect(screen.queryByTestId('sealed-product-price-editor-sp-1')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('UX-SP-20 · sin casilla «publicar también»', () => {
  it('la confirmación tiene cero checkbox; el editor no llama a bulkPublishItems', async () => {
    vi.spyOn(api, 'getSealedPriceSheet').mockResolvedValue(sheet([row()]));
    const bulk = vi.spyOn(api, 'bulkPublishItems');
    vi.spyOn(api, 'setSealedProductSalePrice').mockResolvedValue({ data: row(), autoPublish: { published: 0, missingLocation: 0, notPublished: 0 } });
    renderWithProviders(<SealedPriceSheet />);
    const input = await openEditor(/^Cambiar precio de/);
    fireEvent.change(input, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    expect(dialog.textContent).toContain('Ahora: MX$1,450.00 con IVA (tuyo)');
    expect(dialog.textContent).toContain('Nuevo: MX$1,500.00 con IVA para todas sus piezas.');
    expect(dialog.textContent).toContain('Cambia al momento en la tienda para sus 6 piezas en caja y publicadas.');
    expect(dialog.textContent).toContain('La 1 apartada en un pedido en curso conserva el precio con que se apartó.');
    fireEvent.click(screen.getByTestId('sealed-product-price-confirm'));
    await screen.findByTestId('sealed-price-saved-notice');
    expect(bulk).not.toHaveBeenCalled();
    const src = codigoDe(join(process.cwd(), 'src/app/[locale]/(admin)/admin/m1/SealedProductPriceEditor.tsx'));
    expect(src).not.toMatch(/bulkPublishItems|queueIdsWithLocation/);
  });
});
