import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { SealedPriceStatusRowDTO } from '@/types/contract';
import { SealedSetMappingModal } from './SealedSetMappingModal';

function rowWith(over: Partial<SealedPriceStatusRowDTO> = {}): SealedPriceStatusRowDTO {
  return {
    set: { id: 's-1', name: 'Pitch Black' },
    setMainGroupId: 200,
    linkedGroupIds: [200],
    productCount: 3,
    priced: 0,
    mappedUnpriced: 3,
    unmapped: 0,
    state: 'mapped_unpriced',
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('SealedSetMappingModal · «Arreglar el precio de» (§diseño §4)', () => {
  it('el título y los rótulos están en llano (sin jerga TCGCSV/set_main)', async () => {
    renderWithProviders(<SealedSetMappingModal row={rowWith()} onClose={() => {}} />, 'es');
    expect(
      await screen.findByRole('dialog', { name: /Arreglar el precio de: Pitch Black/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Código del set en TCGplayer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conectar y actualizar/ })).toBeInTheDocument();
  });

  it('M11-connect-then-refresh (D-3): conectar fija el grupo y ACTO SEGUIDO dispara la actualización de ESE set', async () => {
    const put = vi
      .spyOn(api, 'setSealedSetMainGroup')
      .mockResolvedValue({ id: 'g', setId: 's-1', tcgplayerGroupId: 999, kind: 'set_main' });
    const ingest = vi
      .spyOn(api, 'triggerSealedPriceIngest')
      .mockResolvedValue({ job: 'sealed-price-ingest', enqueued: true, jobId: 'j1', groupId: 999 });
    renderWithProviders(<SealedSetMappingModal row={rowWith()} onClose={() => {}} />, 'es');

    // Sin código válido el CTA está deshabilitado.
    const cta = screen.getByRole('button', { name: /Conectar y actualizar/ });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Código del set en TCGplayer/), { target: { value: '999' } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'SV08 prefijo' } });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('s-1', { tcgplayerGroupId: 999, reason: 'SV08 prefijo' }),
    );
    // D-3: la ingesta se dispara ACOTADA al grupo recién conectado (menos pasos para el usuario).
    await waitFor(() => expect(ingest).toHaveBeenCalledWith(999));
  });

  it('rechaza un código no entero positivo (CTA deshabilitado, no conecta)', async () => {
    const put = vi.spyOn(api, 'setSealedSetMainGroup');
    renderWithProviders(<SealedSetMappingModal row={rowWith()} onClose={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/Código del set en TCGplayer/), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /Conectar y actualizar/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Código del set en TCGplayer/), { target: { value: 'abc' } });
    expect(screen.getByRole('button', { name: /Conectar y actualizar/ })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it('«Desconectar» el grupo actual llama a DELETE groups con el groupId actual', async () => {
    const del = vi.spyOn(api, 'deleteSealedSetGroup').mockResolvedValue(undefined);
    renderWithProviders(<SealedSetMappingModal row={rowWith({ setMainGroupId: 200 })} onClose={() => {}} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Desconectar/ }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('s-1', 200));
  });

  it('sin grupo actual no se ofrece «Desconectar»', async () => {
    renderWithProviders(
      <SealedSetMappingModal row={rowWith({ setMainGroupId: null, state: 'unmapped' })} onClose={() => {}} />,
      'es',
    );
    expect(screen.queryByRole('button', { name: /Desconectar/ })).not.toBeInTheDocument();
  });
});
