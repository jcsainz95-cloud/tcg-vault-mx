import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { SealedAddFlow } from './SealedAddFlow';
import type {
  SealedProductListResponse,
  SealedProductDTO,
} from '@/types/contract';
import * as api from '@/lib/api';

const roleState = vi.hoisted(() => ({ role: 'super_admin' as string }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

// Presentaciones: DEL SET (etb con mercado, bundle SIN mercado) + PROMO (blíster con mercado, inferido).
const ETB: SealedProductDTO = {
  id: 'sp-etb',
  setId: 'sv08',
  tcgplayerProductId: 590411,
  tcgplayerGroupId: 23966,
  name: 'Surging Sparks Elite Trainer Box',
  cleanName: 'Surging Sparks Elite Trainer Box',
  subtype: 'etb',
  subtypeInferred: false,
  isPrincipal: true,
  origin: 'set_main',
  imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/590411.jpg',
  marketRef: { status: 'priced', referenceMxnCents: 125_000, source: 'tcgcsv' },
  // v1.41 (IMP-1): mercado GATEADO presente (dial tcgcsv) ⇒ el alta registra a valor de mercado; manual oculto.
  effectiveMarketCents: 125_000,
};
const BUNDLE: SealedProductDTO = {
  id: 'sp-bundle',
  setId: 'sv08',
  tcgplayerProductId: 590413,
  tcgplayerGroupId: 23966,
  name: 'Surging Sparks Booster Bundle',
  cleanName: 'Surging Sparks Booster Bundle',
  subtype: 'bundle',
  subtypeInferred: false,
  isPrincipal: false,
  origin: 'set_main',
  imageUrl: null,
  marketRef: null,
  // v1.41 (IMP-1): sin mercado gateado ⇒ el alta acepta precio manual.
  effectiveMarketCents: null,
};
const PROMO: SealedProductDTO = {
  id: 'sp-promo',
  setId: 'sv08',
  tcgplayerProductId: 590420,
  tcgplayerGroupId: 24010,
  name: 'Mega Evolution Blister',
  cleanName: 'Mega Evolution Blister',
  subtype: 'blister',
  subtypeInferred: true,
  isPrincipal: false,
  origin: 'promo_collection',
  imageUrl: null,
  marketRef: { status: 'priced', referenceMxnCents: 18_000, source: 'tcgcsv' },
  effectiveMarketCents: 18_000,
};

const LIST: SealedProductListResponse = {
  set: { id: 'sv08', name: 'Surging Sparks' },
  needsSync: false,
  groups: [],
  sealedPriceSource: 'tcgcsv',
  data: [ETB, BUNDLE, PROMO],
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

describe('SealedAddFlow (P-38, §16.8a) · alta dedicada de sellado con SealedProduct', () => {
  it('paso 1: DOS SECCIONES por origin — «Del set» primero, «Promos/colecciones» después', async () => {
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue(LIST);
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    const fromSet = await screen.findByRole('region', { name: 'Del set' });
    const promo = screen.getByRole('region', { name: 'Promos y colecciones' });

    // Cada sección contiene sus productos por `origin`.
    expect(fromSet).toBeInTheDocument();
    expect(promo).toBeInTheDocument();
    // «Del set» aparece ANTES que «Promos/colecciones» en el DOM (lo principal arriba).
    expect(fromSet.compareDocumentPosition(promo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // El ETB (set_main) y el blíster (promo) caen en su sección respectiva.
    expect(screen.getByRole('option', { name: /Elite Trainer Box/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Mega Evolution Blister/ })).toBeInTheDocument();
  });

  it('teja money-safe: precio de mercado o pill SIN PRECIO DE MERCADO, badge Principal — NUNCA 0', async () => {
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue(LIST);
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    expect(await screen.findByText('MX$1,250.00')).toBeInTheDocument();
    // El bundle sin mercado muestra la pill (una en la teja), JAMÁS 0.
    expect(screen.getAllByText('Sin precio de mercado').length).toBeGreaterThan(0);
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
    // El ETB es principal → badge (redundante con el orden).
    expect(screen.getAllByText('Principal').length).toBeGreaterThan(0);
    // La teja sin mercado sigue siendo seleccionable (option, no deshabilitada).
    expect(screen.getByRole('option', { name: /Booster Bundle/ })).toBeEnabled();
  });

  it('sync: needsSync + super_admin → CTA Sincronizar; resumen HONESTO (nunca 0 en pendientes)', async () => {
    const spy = vi
      .spyOn(api, 'listSealedProducts')
      .mockResolvedValueOnce({ ...LIST, needsSync: true, data: [] })
      .mockResolvedValue(LIST);
    const sync = vi.spyOn(api, 'syncSealedProducts').mockResolvedValue({
      setsSynced: 1,
      groupsPopulated: 0,
      productsUpserted: 12,
      productsDeactivated: 0,
      pricedCount: 9,
      pendingPriceCount: 3,
    });
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    const cta = await screen.findByRole('button', { name: 'Sincronizar' });
    fireEvent.click(cta);

    await waitFor(() => expect(sync).toHaveBeenCalledWith({ setId: 'sv08' }));
    // Resumen honesto: 12 · 9 · 3 pendientes (nunca «0»).
    expect(
      await screen.findByText('12 presentaciones · 9 con precio · 3 pendientes de precio'),
    ).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2); // relee tras sincronizar
  });

  it('sync: vault_operator NO ve el botón (sin permiso) — copy honesto, sin botón muerto', async () => {
    roleState.role = 'vault_operator';
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue({ ...LIST, needsSync: true, data: [] });
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    expect(
      await screen.findByText(/Pídele a un administrador que lo sincronice/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sincronizar' })).not.toBeInTheDocument();
  });

  it('alta: manda sealedProductId (identidad real, NO cardId ancla) + campos de sellado', async () => {
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue(LIST);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000500']));
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    fireEvent.click(await screen.findByRole('option', { name: /Elite Trainer Box/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // Aportación habilitada (hay mercado vivo) → dar de alta.
    fireEvent.click(await screen.findByRole('radio', { name: /Aportación/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const item = spy.mock.calls[0][0].items[0];
    expect(item).toMatchObject({
      productType: 'sealed',
      sealedSubtype: 'etb',
      sealedCondition: 'mint',
      sealedProductId: 'sp-etb',
      acquisitionType: 'aportacion_en_especie',
      acquisitionPct: 100,
    });
    // La pieza NACE con identidad real, no anclada a un single: sin cardId ni campos M-37 sueltos.
    expect(item).not.toHaveProperty('cardId');
    expect(item).not.toHaveProperty('tcgplayerProductId');
    expect(item).not.toHaveProperty('manualMarketMxnCents');
  });

  it('precio manual (vault_operator): SOLO cuando marketRef es null; valida >0 y mapea a manualMarketMxnCents', async () => {
    roleState.role = 'vault_operator';
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue(LIST);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000600']));
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    // Elegir el Bundle (SIN mercado) → Continuar.
    fireEvent.click(await screen.findByRole('option', { name: /Booster Bundle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // El campo de precio manual aparece (marketRef null + vault_operator+).
    const manual = await screen.findByLabelText('Precio de mercado manual (MX$)');
    // Vacío por defecto (jamás 0 ni sugerido).
    expect((manual as HTMLInputElement).value).toBe('');

    // Captura un precio > 0 → rehabilita la aportación.
    fireEvent.change(manual, { target: { value: '850' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Aportación/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const item = spy.mock.calls[0][0].items[0];
    expect(item).toMatchObject({
      productType: 'sealed',
      sealedProductId: 'sp-bundle',
      manualMarketMxnCents: 85_000,
    });
  });

  it('IMP-1 (dead-end): dial off ⇒ effectiveMarketCents null aunque marketRef traiga caché → MUESTRA el manual y NO promete valor de mercado', async () => {
    roleState.role = 'vault_operator';
    // Dial `off`: el mercado GATEADO es null en TODOS los productos, aunque `marketRef` traiga un valor
    // de caché. La UI del alta debe keyear en `effectiveMarketCents` (autoritativo), NO en `marketRef`.
    const OFF_LIST: SealedProductListResponse = {
      ...LIST,
      sealedPriceSource: 'off',
      data: [
        { ...ETB, effectiveMarketCents: null },
        { ...BUNDLE, effectiveMarketCents: null },
        { ...PROMO, effectiveMarketCents: null },
      ],
    };
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue(OFF_LIST);
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000700']));
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    // El ETB tiene marketRef en caché (MX$1,250) pero SIN mercado gateado (dial off).
    fireEvent.click(await screen.findByRole('option', { name: /Elite Trainer Box/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    // Antes (dead-end): se ocultaba el manual y se prometía «valor de mercado: $X» keyeando en marketRef,
    // pero el backend rechazaba con 422. Ahora el manual SÍ aparece (coherente con lo que el backend acepta).
    const manual = await screen.findByLabelText('Precio de mercado manual (MX$)');
    expect((manual as HTMLInputElement).value).toBe('');

    // Captura un manual > 0 y da de alta como aportación → viaja manualMarketMxnCents (el backend lo acepta).
    fireEvent.change(manual, { target: { value: '1300' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Aportación/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).toMatchObject({
      productType: 'sealed',
      sealedProductId: 'sp-etb',
      manualMarketMxnCents: 130_000,
    });
  });

  it('precio manual: NO aparece cuando hay mercado vivo (no pisa un mercado ya resuelto)', async () => {
    roleState.role = 'vault_operator';
    vi.spyOn(api, 'listSealedProducts').mockResolvedValue(LIST);
    renderWithProviders(<SealedAddFlow open onClose={() => {}} presetSet={preset} />, 'es');

    // El ETB tiene mercado vivo → el campo manual NO se ofrece.
    fireEvent.click(await screen.findByRole('option', { name: /Elite Trainer Box/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await screen.findByRole('radio', { name: /Aportación/ });
    expect(screen.queryByLabelText('Precio de mercado manual (MX$)')).not.toBeInTheDocument();
  });
});
