import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import * as manual from '@/lib/api/manual-version';
import { ApiClientError } from '@/lib/api-client';
import type { CardVersionsResponse, VersionComboDTO } from '@/types/contract';
import { ManualVersionForm, stripInvisible } from './ManualVersionForm';

const combo = (o: Partial<VersionComboDTO>): VersionComboDTO => ({
  finish: 'holofoil', finishLabel: 'holo', language: 'en', stamp: null, previewPriceCents: 1, baseReferenceMxnCents: 1,
  appliedMarketPct: null, buySuggestedCents: null, unavailableReason: null, ...o,
});
const card = { id: 'c1', availableFinishes: ['holofoil', 'reverse_holo'] as ('holofoil' | 'reverse_holo')[] };
// El producto real 777 solo existe en reverse_holo; el panel está en holofoil.
const versions: CardVersionsResponse = {
  combos: [combo({}), combo({ stamp: { type: 'prize_pack', label: null, productId: 777 }, finish: 'reverse_holo', finishLabel: 'reverse_holo' })],
  candidates: [],
  canAddManual: true,
};

function setup() {
  vi.spyOn(manual, 'createManualVersion').mockRejectedValue(
    new ApiClientError(409, { code: 'USE_EXISTING', message: 'x', details: { stamps: [{ productId: 777, label: 'Prize Pack' }] } }),
  );
  const props = { onFinish: vi.fn(), onStamp: vi.fn(), onAttached: vi.fn(), onCreated: vi.fn() };
  renderWithProviders(<ManualVersionForm card={card} defaultFinish="holofoil" versions={versions} {...props} />, 'es');
  return props;
}

describe('§ALTA-LIGA-2 · ManualVersionForm', () => {
  it('USE_EXISTING «Usar»: si el producto existente no tiene el acabado vigente, el panel pasa a uno que sí tiene', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Versión de liga' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    await userEvent.click(await screen.findByRole('button', { name: /Usar la existente/ }));
    expect(p.onStamp).toHaveBeenCalledWith(777);
    expect(p.onFinish).toHaveBeenCalledWith('reverse_holo');
  });

  it('si el producto existente ya tiene el acabado vigente, no lo cambia', async () => {
    const p = setup();
    versions.combos.push(combo({ stamp: { type: 'prize_pack', label: null, productId: 777 } }));
    await userEvent.click(screen.getByRole('button', { name: '+ Versión de liga' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    await userEvent.click(await screen.findByRole('button', { name: /Usar la existente/ }));
    expect(p.onFinish).not.toHaveBeenCalled();
    versions.combos.pop();
  });

  it('la etiqueta no deja teclear caracteres invisibles, de control ni de dirección', async () => {
    expect(stripInvisible('Temp\u200Borada\u202E 7\u0007')).toBe('Temporada 7');
    setup();
    await userEvent.click(screen.getByRole('button', { name: '+ Versión de liga' }));
    const input = screen.getByLabelText(/Etiqueta/) as HTMLInputElement;
    await userEvent.type(input, 'A\u200EB');
    expect(input.value).toBe('AB');
  });

  it('400 VALIDATION_ERROR sobre stampLabel: error en el campo, no un aviso genérico', async () => {
    vi.spyOn(manual, 'createManualVersion').mockRejectedValue(new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'stampLabel' } }));
    renderWithProviders(<ManualVersionForm card={card} defaultFinish="holofoil" versions={versions} onCreated={vi.fn()} onAttached={vi.fn()} onStamp={vi.fn()} />, 'es');
    await userEvent.click(screen.getByRole('button', { name: '+ Versión de liga' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    await waitFor(() => expect(screen.getByText(/caracteres no permitidos/)).toBeTruthy());
    expect(screen.queryByText('Revisa el tipo, la etiqueta y el acabado.')).toBeNull();
  });
});

describe('§ALTA-LIGA-2 · VERSION_BUSY', () => {
  it('409 VERSION_BUSY (fusión en curso): aviso claro y «Reintentar» vuelve a mandar el alta', async () => {
    const create = vi
      .spyOn(manual, 'createManualVersion')
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'VERSION_BUSY', message: 'x' }))
      .mockResolvedValue({ created: true, finishAdded: false, stamp: { type: 'prize_pack', label: null, productId: -1, manual: true }, finishes: ['holofoil'], combos: [] });
    const onCreated = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ManualVersionForm card={card} defaultFinish="holofoil" versions={versions} onCreated={onCreated} onAttached={vi.fn()} onStamp={vi.fn()} />, 'es');
    await userEvent.click(screen.getByRole('button', { name: '+ Versión de liga' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear versión' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Se está actualizando esta carta/);
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});
