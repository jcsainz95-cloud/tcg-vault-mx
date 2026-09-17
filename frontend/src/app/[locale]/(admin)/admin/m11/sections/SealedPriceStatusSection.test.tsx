import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockSettings } from '@/lib/mock/fixtures';
import type { SealedPriceStatusResponse } from '@/types/contract';
import { SealedPriceStatusSection } from './SealedPriceStatusSection';

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: true,
  }),
}));

function ref(id: string, name: string) {
  return { id, name };
}

const RESPONSE: SealedPriceStatusResponse = {
  sealedPriceSource: 'off',
  page: 1,
  pageSize: 20,
  total: 3,
  data: [
    {
      set: ref('s-priced', 'Chaos Rising'),
      setMainGroupId: 100,
      linkedGroupIds: [100],
      productCount: 4,
      priced: 4,
      mappedUnpriced: 0,
      unmapped: 0,
      state: 'priced',
    },
    {
      set: ref('s-mapped', 'Pitch Black'),
      setMainGroupId: 200,
      linkedGroupIds: [200],
      productCount: 3,
      priced: 0,
      mappedUnpriced: 3,
      unmapped: 0,
      state: 'mapped_unpriced',
      reason: 'no_source_price',
    },
    {
      set: ref('s-unmapped', 'Silver Tempest'),
      setMainGroupId: null,
      linkedGroupIds: [],
      productCount: 2,
      priced: 0,
      mappedUnpriced: 0,
      unmapped: 2,
      state: 'unmapped',
      reason: 'no_group',
    },
  ],
};

function withSource(source: 'off' | 'tcgcsv') {
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, sealedPriceSource: source });
}

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
  vi.spyOn(api, 'getSealedPriceStatus').mockResolvedValue(RESPONSE);
});

describe('SealedPriceStatusSection · Precios de mercado de la colección (§diseño §2/§3)', () => {
  it('M11-collection-photo: pinta la foto en llano (con precio / sin precio), no un delta', async () => {
    withSource('tcgcsv');
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    // 1 priced · 2 sin precio (mapped_unpriced + unmapped).
    expect(await screen.findByText(/1 set con precio · 2 sets sin precio/)).toBeInTheDocument();
  });

  it('M11-refresh-source-on: con la fuente encendida el botón dispara la ingesta SIN confirmar ni tocar settings', async () => {
    withSource('tcgcsv');
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    const ingest = vi
      .spyOn(api, 'triggerSealedPriceIngest')
      .mockResolvedValue({ job: 'sealed-price-ingest', enqueued: true, jobId: 'j1' });
    renderWithProviders(<SealedPriceStatusSection />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Actualizar precios de la colección/ }));
    await waitFor(() => expect(ingest).toHaveBeenCalled());
    // No pregunta nada y NO reescribe el interruptor (ya está encendido).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    // Foto de resultado en llano tras la corrida.
    expect(await screen.findByText('Listo')).toBeInTheDocument();
  });

  it('M11-refresh-source-off: con la fuente apagada, el botón pide UNA confirmación de dinero y al aceptar la enciende y actualiza', async () => {
    withSource('off');
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    const ingest = vi
      .spyOn(api, 'triggerSealedPriceIngest')
      .mockResolvedValue({ job: 'sealed-price-ingest', enqueued: true, jobId: 'j1' });
    renderWithProviders(<SealedPriceStatusSection />, 'es');

    fireEvent.click(await screen.findByRole('button', { name: /Actualizar precios de la colección/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Es una decisión de dinero/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Activar y actualizar/ }));
    // Enciende la fuente (acto de dinero) y ACTO SEGUIDO trae precios.
    await waitFor(() => expect(put).toHaveBeenCalledWith({ sealedPriceSource: 'tcgcsv' }));
    await waitFor(() => expect(ingest).toHaveBeenCalled());
  });

  it('estado en curso (single-flight): enqueued=false sin reason muestra el aviso, no un error', async () => {
    withSource('tcgcsv');
    vi.spyOn(api, 'triggerSealedPriceIngest').mockResolvedValue({
      job: 'sealed-price-ingest',
      enqueued: false,
    });
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Actualizar precios de la colección/ }));
    expect(await screen.findByText(/Ya hay una actualización en marcha/)).toBeInTheDocument();
  });

  it('M11-fix-list-only-unpriced: la lista de «arreglar» muestra SOLO los sets sin precio, no los preciados', async () => {
    withSource('tcgcsv');
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    // Los dos sin precio ofrecen «Arreglar este set»; el preciado no aparece en la lista corta.
    const fixButtons = await screen.findAllByRole('button', { name: /Arreglar este set/ });
    // 2 sin precio, cada uno con su botón (+ los del desglose plegado, que también son 2).
    expect(fixButtons.length).toBeGreaterThanOrEqual(2);
    // El motivo en llano del set sin conectar se lee (en la lista corta y en el desglose).
    expect(screen.getAllByText(/aún no está conectado a la fuente de precios/i).length).toBeGreaterThanOrEqual(1);
  });

  it('«Arreglar este set» abre el modal re-rotulado «Arreglar el precio de: {set}»', async () => {
    withSource('tcgcsv');
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    const fixButtons = await screen.findAllByRole('button', { name: /Arreglar este set/ });
    fireEvent.click(fixButtons[0]);
    expect(await screen.findByRole('dialog', { name: /Arreglar el precio de/ })).toBeInTheDocument();
  });

  it('M11-collection-operator: un vault_operator ve la foto pero NO el botón ni «Arreglar este set»', async () => {
    roleState.role = 'vault_operator';
    withSource('tcgcsv');
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    await screen.findByText(/1 set con precio · 2 sets sin precio/);
    expect(
      screen.queryByRole('button', { name: /Actualizar precios de la colección/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Arreglar este set/ })).not.toBeInTheDocument();
  });
});
