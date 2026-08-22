import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedAddFlow } from './SealedAddFlow';
import type { SealedCatalogResponse } from '@/types/contract';
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

// Catálogo mock: un ETB CON mercado y un Bundle SIN mercado (marketRef null → money-safe).
const CATALOG: SealedCatalogResponse = {
  set: { id: 'sv08', name: 'Surging Sparks' },
  tcgcsvGroupId: 23966,
  groupResolved: true,
  anchorCardId: 'c-sealed-sv08-box',
  data: [
    {
      tcgplayerProductId: 590411,
      name: 'Surging Sparks Elite Trainer Box',
      cleanName: 'Surging Sparks Elite Trainer Box',
      sealedSubtype: 'etb',
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/590411.jpg',
      marketRef: { status: 'priced', referenceMxnCents: 125_000, source: 'tcgcsv' },
    },
    {
      tcgplayerProductId: 590413,
      name: 'Surging Sparks Booster Bundle',
      cleanName: 'Surging Sparks Booster Bundle',
      sealedSubtype: 'bundle',
      imageUrl: null,
      marketRef: null,
    },
  ],
};

function okBatch(folios: string[]) {
  return {
    batchKey: 'k',
    idempotentReplay: false,
    summary: { requested: 1, createdItems: folios.length, failedLines: 0 },
    results: [{ index: 0, ok: true as const, folios, inventoryItemIds: folios.map((f) => `id-${f}`) }],
  };
}

const preset = { id: 'sv08', name: 'Surging Sparks' };

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

describe('SealedAddFlow (P-35, §16.8a) · alta dedicada de sellado', () => {
  it('paso 1: grid de PRODUCTOS con nombre + subtipo y referencia money-safe (precio / pill SIN PRECIO DE MERCADO, nunca 0)', async () => {
    vi.spyOn(api, 'getSealedCatalog').mockResolvedValue(CATALOG);
    renderWithProviders(
      <SealedAddFlow open onClose={() => {}} presetSet={preset} />,
      'es',
    );

    // Tejas de PRODUCTO sellado (no singles) como listbox de opciones.
    const etb = await screen.findByRole('option', { name: /Elite Trainer Box/ });
    expect(etb).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Booster Bundle/ })).toBeInTheDocument();

    // Money-safe: el ETB muestra su precio de mercado; el Bundle sin mercado muestra la pill,
    // JAMÁS MX$ 0.00.
    expect(screen.getByText('MX$1,250.00')).toBeInTheDocument();
    expect(screen.getByText('Sin precio de mercado')).toBeInTheDocument();
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
  });

  it('sin mercado: la tarjeta Aportación queda DESHABILITADA con pill PRECIO PENDIENTE en el paso 2', async () => {
    vi.spyOn(api, 'getSealedCatalog').mockResolvedValue(CATALOG);
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    // Elegir el Bundle (sin mercado) → Continuar.
    fireEvent.click(await screen.findByRole('option', { name: /Booster Bundle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // Paso 2: aportación bloqueada (heredado de QuickAddSection §16.5a2).
    const contribRadio = await screen.findByRole('radio', { name: /Aportación/ });
    expect(contribRadio).toBeDisabled();
    expect(screen.getByText('Precio pendiente')).toBeInTheDocument();
  });

  it('alta con mercado: envía el batch con productType=sealed + identidad TCGCSV + campos de sellado + cardId ancla', async () => {
    vi.spyOn(api, 'getSealedCatalog').mockResolvedValue(CATALOG);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000500']));
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    // Elegir el ETB (con mercado) → Continuar.
    fireEvent.click(await screen.findByRole('option', { name: /Elite Trainer Box/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // Aportación habilitada (hay mercado) → dar de alta.
    fireEvent.click(await screen.findByRole('radio', { name: /Aportación/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const { items, batchKey } = spy.mock.calls[0][0];
    expect(batchKey).toBeTruthy();
    expect(items[0]).toMatchObject({
      cardId: 'c-sealed-sv08-box', // ancla del set (NO un single)
      productType: 'sealed',
      sealedSubtype: 'etb',
      sealedCondition: 'mint',
      tcgplayerProductId: 590411,
      tcgplayerGroupId: 23966,
      sealedImageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/590411.jpg',
      sealedProductName: 'Surging Sparks Elite Trainer Box',
      acquisitionType: 'aportacion_en_especie',
      acquisitionPct: 100,
    });
  });

  it('camino de respaldo (fuente TCGCSV caída, 502): banner + captura manual marcada como excepción, sin mapeo', async () => {
    vi.spyOn(api, 'getSealedCatalog').mockRejectedValue(
      new (await import('@/lib/api-client')).ApiClientError(502, {
        code: 'UPSTREAM_ERROR',
        message: 'down',
      }),
    );
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000600']));
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    // Banner de fuente caída + enlace al respaldo.
    expect(await screen.findByRole('alert')).toHaveTextContent(/fuente TCGCSV no disponible/);
    fireEvent.click(screen.getByRole('button', { name: 'Capturar sin catálogo de producto' }));

    // Aviso money-safe explícito + nombre manual requerido.
    expect(screen.getByText(/quedará sin precio de mercado/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nombre del producto'), {
      target: { value: 'ETB manual sin catálogo' },
    });

    // Comprar con precio capturado (aportación bloqueada al no haber mercado).
    fireEvent.change(screen.getByLabelText('Precio pagado (MXN)'), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const item = spy.mock.calls[0][0].items[0];
    expect(item).toMatchObject({
      cardId: 'c-sealed-sv08-box',
      productType: 'sealed',
      sealedProductName: 'ETB manual sin catálogo',
      acquisitionType: 'compra',
    });
    // Nace SIN mapeo (respaldo honesto): no lleva identidad TCGCSV.
    expect(item).not.toHaveProperty('tcgplayerProductId');
    expect(item).not.toHaveProperty('tcgplayerGroupId');
  });

  it('vacío legítimo (set sin sellado en la fuente): muestra el mensaje y ofrece el respaldo, sin error', async () => {
    vi.spyOn(api, 'getSealedCatalog').mockResolvedValue({
      ...CATALOG,
      groupResolved: false,
      data: [],
    });
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    expect(
      await screen.findByText('Este set no tiene producto sellado en la fuente.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Capturar sin catálogo de producto' })).toBeInTheDocument();
  });
});
