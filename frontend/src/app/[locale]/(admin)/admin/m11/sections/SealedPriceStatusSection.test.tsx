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
  total: 4,
  data: [
    // Todo el set con precio ⇒ verde, no aparece en la lista de «por completar».
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
    // EL CASO DEL DUEÑO (2026-09-17): 22 de 23 con precio. El rollup lo marcaba `mapped_unpriced`
    // ⇒ rojo «CONECTADO, SIN PRECIO». Debe verse verde/neutro con «22 de 23 con precio», NO rojo.
    {
      set: ref('s-partial', 'Pitch Black'),
      setMainGroupId: 200,
      linkedGroupIds: [200],
      productCount: 23,
      priced: 22,
      mappedUnpriced: 1,
      unmapped: 0,
      state: 'mapped_unpriced',
      reason: 'no_source_price',
    },
    // 0 de 2 con precio y sin conectar ⇒ alarma legítima (sí necesita arreglo).
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
    // 0 de 3 con precio pero conectado ⇒ alarma legítima (la fuente no trajo nada).
    {
      set: ref('s-none', 'Ancient Guardians'),
      setMainGroupId: 300,
      linkedGroupIds: [300],
      productCount: 3,
      priced: 0,
      mappedUnpriced: 3,
      unmapped: 0,
      state: 'mapped_unpriced',
      reason: 'no_source_price',
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
  it('M11-collection-photo: pinta la foto en llano contando PRODUCTOS (con precio / pendientes), no sets', async () => {
    withSource('tcgcsv');
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    // 4 + 22 + 0 + 0 = 26 con precio; (0) + (1) + (2) + (3) = 6 pendientes.
    // NO cuenta sets: el defecto era decir «5 sets sin precio» cuando 22 de 23 SÍ tenían precio.
    expect(await screen.findByText(/26 productos con precio · 6 pendientes/)).toBeInTheDocument();
  });

  it('M11-status-honesto: un set 22/23 NO se pinta como «sin precio» rojo; muestra «22 de 23 con precio» y «Completar»', async () => {
    withSource('tcgcsv');
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    // El progreso honesto se lee (lista de «por completar» y desglose).
    expect((await screen.findAllByText(/22 de 23 con precio/)).length).toBeGreaterThanOrEqual(1);
    // Nota suave, no alarma.
    expect(screen.getAllByText(/le falta 1 producto/).length).toBeGreaterThanOrEqual(1);
    // El encuadre es «completar los que faltan», no «Arreglar/roto».
    expect(screen.getAllByRole('button', { name: /Completar este set/ }).length).toBeGreaterThanOrEqual(1);
    // El rótulo rojo del rollup («Conectado, sin precio») NO aparece para el set 22/23: solo lo
    // lleva el set 0/N conectado (Ancient Guardians), y solo en el desglose ⇒ 1 sola aparición.
    expect(screen.getAllByText('Conectado, sin precio').length).toBe(1);
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

  it('M11-fix-list-por-completar: la lista muestra los sets NO completos (partial + 0/N), no los 100% preciados', async () => {
    withSource('tcgcsv');
    renderWithProviders(<SealedPriceStatusSection />, 'es');
    // 3 sets por completar (Pitch Black 22/23 + Silver Tempest 0/2 + Ancient Guardians 0/3).
    expect(await screen.findByText(/3 sets por completar:/)).toBeInTheDocument();
    // El 100% preciado (Chaos Rising) NO aparece con ningún botón de acción.
    expect(screen.queryByText('Chaos Rising')).toBeInTheDocument(); // sí en el desglose
    // Los 0/N ofrecen «Arreglar este set»; el 22/23 ofrece «Completar este set» (no «Arreglar»).
    const fixButtons = await screen.findAllByRole('button', { name: /Arreglar este set/ });
    expect(fixButtons.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('button', { name: /Completar este set/ }).length).toBeGreaterThanOrEqual(1);
    // El motivo en llano del set sin conectar se lee.
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
    await screen.findByText(/26 productos con precio · 6 pendientes/);
    expect(
      screen.queryByRole('button', { name: /Actualizar precios de la colección/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Arreglar este set/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Completar este set/ })).not.toBeInTheDocument();
  });
});
