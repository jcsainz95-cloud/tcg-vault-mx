import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VariantDrawer } from './VariantDrawer';
import * as api from '@/lib/api';
import type { VariantPricingDTO } from '@/types/contract';

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

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
});

function renderDrawer(overrides: Partial<React.ComponentProps<typeof VariantDrawer>> = {}) {
  return renderWithProviders(
    <VariantDrawer
      cardId="c-charizard"
      cardName="Charizard"
      cardNumber="4"
      finish="normal"
      productType="raw"
      onClose={() => {}}
      {...overrides}
    />,
    'es',
  );
}

describe('VariantDrawer (P-17, §16.4) · piezas de la variante', () => {
  it('lista SOLO las piezas de ESA variante (cardId+finish) con folio y estado', async () => {
    renderDrawer();

    // Fixtures: Charizard normal → INV-000201 (in_stock) + INV-000203 (reserved).
    expect(await screen.findByText(/INV-000201/)).toBeInTheDocument();
    expect(screen.getByText(/INV-000203/)).toBeInTheDocument();
    // La pieza reverse (INV-000202) NO pertenece a esta variante.
    expect(screen.queryByText(/INV-000202/)).toBeNull();
    expect(screen.getByText('Piezas (2)')).toBeInTheDocument();
  });

  it('publicar selección usa bulk-publish (repriceFresh) y pinta el resultado por-línea', async () => {
    const spy = vi.spyOn(api, 'bulkPublishItems').mockResolvedValue({
      summary: { requested: 1, published: 0, failedLines: 1 },
      results: [
        {
          index: 0,
          inventoryItemId: 'inv-2001',
          ok: false,
          error: { code: 'PRICE_PENDING', message: 'no price' },
          pendingPriceEntryId: 'ppe-1',
        },
      ],
    });
    renderDrawer();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar INV-000201' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publicar selección (1)' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0]).toMatchObject({
      items: [{ inventoryItemId: 'inv-2001' }],
      repriceFresh: true,
    });
    // Honestidad por-línea: la escalada a pendiente NO se disfraza de éxito.
    expect(await screen.findByText('0 publicadas · 1 con error.')).toBeInTheDocument();
    expect(screen.getAllByText(/INV-000201/).length).toBeGreaterThan(0);
  });

  it('editar precio por pieza convierte pesos→centavos y manda PATCH listPriceCents', async () => {
    const spy = vi.spyOn(api, 'updateInventoryItem').mockResolvedValue({
      ...((await import('@/lib/mock/fixtures')).mockInventory.find((i) => i.id === 'inv-2001')!),
      listPriceCents: 123_456,
    });
    renderDrawer();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar precio de INV-000201' }));
    fireEvent.change(screen.getByLabelText('Precio (MXN)'), { target: { value: '1234.56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('inv-2001', { listPriceCents: 123_456 }),
    );
  });

  it('con pricing (scope platform) monta la consola de precios; el sellado NO la lleva', async () => {
    const pricing: VariantPricingDTO = {
      buy: { suggestedCents: 87_500, overrideCents: null, effectiveCents: 87_500, source: 'market', premiumAtFloor: false },
      sell: { suggestedCents: 169_000, overrideCents: null, effectiveCents: 169_000, source: 'market', premiumAtFloor: false },
    };
    const { unmount } = renderDrawer({ pricing, marketRefCents: 125_000 });
    expect(await screen.findByRole('heading', { name: 'Precios' })).toBeInTheDocument();
    unmount();

    renderDrawer({
      productType: 'sealed',
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      cardId: 'c-sealed-sv08-box',
      cardName: 'Surging Sparks Booster Box',
      pricing,
    });
    await screen.findByText(/Piezas \(/);
    expect(screen.queryByRole('heading', { name: 'Precios' })).toBeNull();
  });

  it('SELLADO-M1(C): el encabezado del sellado muestra el SUBTIPO (Bundle/Booster Box), no solo «SELLADO»', async () => {
    // S3-SELLADO-M1 (2026-09-17): tras el alta el desglose de FORMATO se perdía en el drill-down —
    // el encabezado pintaba «SELLADO» a secas aunque el subtipo YA viaja como prop.
    renderDrawer({
      productType: 'sealed',
      sealedSubtype: 'bundle',
      sealedCondition: 'mint',
      cardId: 'c-sealed-chaos-bundle',
      cardName: 'Chaos Rising Booster Bundle',
    });
    await screen.findByText(/Piezas \(/);
    // El subtipo (Bundle) aparece en el encabezado.
    expect(screen.getByText(/BUNDLE/)).toBeInTheDocument();
  });

  it('M-1: guardar un override en la consola pinta el estado nuevo SIN reabrir y refresca agregados', async () => {
    const pricing: VariantPricingDTO = {
      buy: { suggestedCents: 87_500, overrideCents: null, effectiveCents: 87_500, source: 'market', premiumAtFloor: false },
      sell: { suggestedCents: 169_000, overrideCents: null, effectiveCents: 169_000, source: 'market', premiumAtFloor: false },
    };
    vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c-charizard',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      pricing: {
        buy: { suggestedCents: 87_500, overrideCents: 95_000, effectiveCents: 95_000, source: 'override', premiumAtFloor: false },
        sell: { suggestedCents: 169_000, overrideCents: null, effectiveCents: 169_000, source: 'market', premiumAtFloor: false },
      },
    });
    const onChanged = vi.fn();
    renderDrawer({ pricing, marketRefCents: 125_000, onChanged });

    fireEvent.change((await screen.findAllByLabelText('Override'))[0], { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }));

    // Efectivo/FUENTE del response, visibles al instante (antes quedaba el prop capturado al abrir).
    expect(await screen.findByRole('button', { name: 'Restablecer a la curva' })).toBeInTheDocument();
    expect(screen.getAllByText('Manual').length).toBeGreaterThanOrEqual(1);
    // Y el drawer avisa al dueño para refrescar el binder (respuesta ya no se descarta).
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('M-2: si el servidor capea la lista (100 de N), el truncado SE DICE con el conteo real', async () => {
    const fxm = await import('@/lib/mock/fixtures');
    const rows = fxm.mockInventory.filter(
      (i) =>
        i.card.id === 'c-charizard' &&
        (i.finish ?? 'normal') === 'normal' &&
        i.productType === 'raw' &&
        i.ownerType === 'platform',
    );
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({
      data: rows,
      page: 1,
      pageSize: 100,
      total: 137,
    });
    renderDrawer();

    expect(
      await screen.findByText(
        `Mostrando ${rows.length} de 137 piezas de esta carta (lista truncada).`,
      ),
    ).toBeInTheDocument();
  });

  /**
   * **QA MENOR (preexistente) sobre `4ca6c45`, 2026-09-29.** El cajón ofrecía «Merma» y «Editar
   * precio» sobre una pieza VENDIDA (`picking`); el backend rechaza la merma
   * (`422 ITEM_NOT_ADJUSTABLE`: solo `in_stock|listed`, contrato §0) y el precio de una pieza vendida
   * ya está en la orden. Reglas de pantalla del contrato (§M1 v1.79.6 «5»): «Merma» solo en
   * `in_stock|listed` (⛔ nunca `picking` ni `reserved`); «Editar precio» ⛔ no sobre `picking` (aquí
   * también `shipped|delivered`, la misma pieza vendida más tarde). En `in_stock` siguen las dos
   * (control positivo). Sobre `reserved` el precio no está normado y no se asevera.
   */
  it('una pieza VENDIDA (picking/shipped/delivered) NO ofrece «Merma» ni «Editar precio»; `reserved` tampoco merma; `in_stock` sí', async () => {
    const fxm = await import('@/lib/mock/fixtures');
    const base = { ...fxm.mockInventory.find((i) => i.id === 'inv-2001')!, listPriceCents: 150_000 };
    const rows = [
      base,
      { ...base, id: 'inv-2901', folio: 'INV-002901', status: 'picking' as const },
      { ...base, id: 'inv-2902', folio: 'INV-002902', status: 'shipped' as const },
      { ...base, id: 'inv-2903', folio: 'INV-002903', status: 'delivered' as const },
      { ...base, id: 'inv-2904', folio: 'INV-002904', status: 'reserved' as const },
    ];
    vi.spyOn(api, 'getAdminInventory').mockResolvedValue({ data: rows, page: 1, pageSize: 100, total: 5 });
    renderDrawer();

    // Control positivo: la pieza en stock conserva las dos acciones.
    expect(await screen.findByRole('button', { name: 'Merma de INV-000201' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar precio de INV-000201' })).toBeInTheDocument();
    for (const folio of ['INV-002901', 'INV-002902', 'INV-002903']) {
      // La fila existe (folio y detalle), pero sin merma ni edición de precio.
      expect(screen.getByRole('button', { name: `Ver detalle de ${folio}` })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `Merma de ${folio}` })).toBeNull();
      expect(screen.queryByRole('button', { name: `Editar precio de ${folio}` })).toBeNull();
    }
    // Apartada en un pedido sin pagar: tampoco se merma (`ITEM_NOT_ADJUSTABLE`).
    expect(screen.getByRole('button', { name: 'Ver detalle de INV-002904' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merma de INV-002904' })).toBeNull();
    // El precio de la pieza vendida se sigue LEYENDO (solo deja de editarse): 5 filas, 5 precios.
    expect(screen.getAllByText('MX$1,500.00').length).toBe(5);
  });

  it('gradeadas: las filas muestran el certNumber completo (copiable)', async () => {
    renderDrawer({
      productType: 'graded',
      cardId: 'c-charizard',
      gradeInfo: { gradingCompany: 'PSA', gradeValue: '9' },
    });

    // inv-1001 (fixtures): Charizard PSA 9, cert 82749163.
    expect(await screen.findByText(/CERT 82749163/)).toBeInTheDocument();
  });
});
