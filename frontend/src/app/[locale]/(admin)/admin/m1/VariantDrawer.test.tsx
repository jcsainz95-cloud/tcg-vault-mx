import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VariantDrawer } from './VariantDrawer';
import * as api from '@/lib/api';

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
    const pricing = {
      buy: { suggestedCents: 87_500, overrideCents: null, effectiveCents: 87_500, source: 'rule' as const },
      sell: { suggestedCents: 169_000, overrideCents: null, effectiveCents: 169_000, source: 'rule' as const },
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
