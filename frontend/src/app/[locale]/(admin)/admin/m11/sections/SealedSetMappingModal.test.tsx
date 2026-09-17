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

describe('SealedSetMappingModal · mapeo manual (§diseño §11)', () => {
  it('M11-remap-overwrites: fijar el grupo llama a set-main-group con el groupId y el motivo', async () => {
    const put = vi
      .spyOn(api, 'setSealedSetMainGroup')
      .mockResolvedValue({ id: 'g', setId: 's-1', tcgplayerGroupId: 999, kind: 'set_main' });
    renderWithProviders(<SealedSetMappingModal row={rowWith()} onClose={() => {}} />, 'es');

    // Sin groupId válido el CTA está deshabilitado.
    const cta = screen.getByRole('button', { name: /Fijar grupo principal/ });
    expect(cta).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/ID de grupo TCGCSV/), { target: { value: '999' } });
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'SV08 prefijo' } });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('s-1', { tcgplayerGroupId: 999, reason: 'SV08 prefijo' }),
    );
  });

  it('rechaza un groupId no entero positivo (CTA deshabilitado, no dispara PUT)', async () => {
    const put = vi.spyOn(api, 'setSealedSetMainGroup');
    renderWithProviders(<SealedSetMappingModal row={rowWith()} onClose={() => {}} />, 'es');
    fireEvent.change(screen.getByLabelText(/ID de grupo TCGCSV/), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /Fijar grupo principal/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/ID de grupo TCGCSV/), { target: { value: 'abc' } });
    expect(screen.getByRole('button', { name: /Fijar grupo principal/ })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it('desenlazar el set_main actual llama a DELETE groups con el groupId actual', async () => {
    const del = vi.spyOn(api, 'deleteSealedSetGroup').mockResolvedValue(undefined);
    renderWithProviders(<SealedSetMappingModal row={rowWith({ setMainGroupId: 200 })} onClose={() => {}} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: /Desenlazar grupo actual/ }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('s-1', 200));
  });

  it('sin grupo actual no se ofrece desenlazar', async () => {
    renderWithProviders(
      <SealedSetMappingModal row={rowWith({ setMainGroupId: null, state: 'unmapped' })} onClose={() => {}} />,
      'es',
    );
    expect(screen.queryByRole('button', { name: /Desenlazar grupo actual/ })).not.toBeInTheDocument();
  });
});
