import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { QuickRemoveSection } from './QuickRemove';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { BulkRemoveInventoryResponse } from '@/types/contract';

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

const target = { cardId: 'c-charizard', productType: 'raw' as const, finish: 'reverse_holo' as const };

// La baja es ATÓMICA: en 200 siempre removed === requested.
function okRemove(count: number): BulkRemoveInventoryResponse {
  return {
    idempotentReplay: false,
    removed: count,
    requested: count,
    reason: 'perdida',
    toStatus: 'lost',
    inventoryItemIds: Array.from({ length: count }, (_, i) => `inv-${i}`),
    folios: Array.from({ length: count }, (_, i) => `INV-00090${i}`),
    adjustmentIds: Array.from({ length: count }, (_, i) => `adj-${i}`),
  };
}

/** Llena la nota OBLIGATORIA (backend la exige no-vacía) para poder confirmar la baja. */
function fillNote(value = 'caja dañada en bodega') {
  fireEvent.change(screen.getByLabelText('Nota de la baja'), { target: { value } });
}

describe('QuickRemoveSection (P-29) · baja rápida de inventario', () => {
  it('sin piezas ajustables muestra el vacío y NO ofrece CTA de baja', () => {
    renderWithProviders(<QuickRemoveSection target={target} removableCount={0} />, 'es');

    expect(
      screen.getByText('No hay piezas en stock o publicadas que dar de baja en esta variante.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dar de baja/ })).toBeNull();
  });

  it('caso P-36 (1 pieza): stepper topado en [1,1] → AMBOS botones deshabilitados y el número no cambia', () => {
    renderWithProviders(<QuickRemoveSection target={target} removableCount={1} />, 'es');

    expect(screen.getByText('1 piezas disponibles para dar de baja.')).toBeInTheDocument();
    const minus = screen.getByRole('button', { name: 'Restar uno' });
    const plus = screen.getByRole('button', { name: 'Sumar uno' });
    // Sin margen (min=max=1): los dos botones están REALMENTE deshabilitados (no clickeables-muertos).
    expect(minus).toBeDisabled();
    expect(plus).toBeDisabled();

    const qty = screen.getByLabelText('Cantidad a dar de baja') as HTMLInputElement;
    fireEvent.click(plus); // no-op: disabled
    fireEvent.click(minus); // no-op: disabled
    expect(qty.value).toBe('1');
    // El CTA de baja de 1 sigue operativo (con nota).
    fillNote();
    expect(screen.getByRole('button', { name: 'Dar de baja 1' })).toBeEnabled();
  });

  it('multi-pieza (3): + sube 1→3 y se deshabilita en el tope; − baja 3→1 y se deshabilita en el piso', () => {
    renderWithProviders(<QuickRemoveSection target={target} removableCount={3} />, 'es');

    const minus = screen.getByRole('button', { name: 'Restar uno' });
    const plus = screen.getByRole('button', { name: 'Sumar uno' });
    const qty = screen.getByLabelText('Cantidad a dar de baja') as HTMLInputElement;

    // Piso: en 1, «Restar uno» está deshabilitado; «Sumar uno» activo.
    expect(minus).toBeDisabled();
    expect(plus).toBeEnabled();

    fireEvent.click(plus); // 1 → 2
    expect(qty.value).toBe('2');
    expect(minus).toBeEnabled();
    fireEvent.click(plus); // 2 → 3 (tope)
    expect(qty.value).toBe('3');
    // Tope: «Sumar uno» se deshabilita (nunca por encima de removableCount).
    expect(plus).toBeDisabled();

    fireEvent.click(minus); // 3 → 2
    expect(qty.value).toBe('2');
    expect(plus).toBeEnabled();
    fireEvent.click(minus); // 2 → 1 (piso)
    expect(qty.value).toBe('1');
    expect(minus).toBeDisabled();
  });

  it('money-safe: el stepper se capa al conteo VISIBLE (no ofrece bajar de más)', () => {
    renderWithProviders(<QuickRemoveSection target={target} removableCount={2} />, 'es');

    expect(screen.getByText('2 piezas disponibles para dar de baja.')).toBeInTheDocument();
    const plus = screen.getByRole('button', { name: 'Sumar uno' });
    fireEvent.click(plus); // 1 → 2 (tope)
    const qty = screen.getByLabelText('Cantidad a dar de baja') as HTMLInputElement;
    expect(qty.value).toBe('2');
    // En el tope, «Sumar uno» se deshabilita: imposible pedir 3 con 2 disponibles.
    expect(plus).toBeDisabled();
  });

  it('la nota es OBLIGATORIA: el CTA de baja se deshabilita con la nota vacía', () => {
    renderWithProviders(<QuickRemoveSection target={target} removableCount={5} />, 'es');

    // Sin nota, el CTA que abre la confirmación está deshabilitado (barrera de UI: sin note el
    // backend responde 400 VALIDATION_ERROR).
    expect(screen.getByRole('button', { name: 'Dar de baja 1' })).toBeDisabled();
    fillNote();
    expect(screen.getByRole('button', { name: 'Dar de baja 1' })).toBeEnabled();
  });

  it('confirma y da de baja N con reason + note + batchKey en el body; éxito con resumen', async () => {
    const spy = vi.spyOn(api, 'bulkRemoveInventory').mockResolvedValue(okRemove(2));
    renderWithProviders(<QuickRemoveSection target={target} removableCount={5} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Sumar uno' })); // qty 2
    fillNote('caja dañada en bodega');
    // Confirmación simple (dos pasos, sin modal).
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de 2' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const payload = spy.mock.calls[0][0];
    // La llamada REAL exige `note` (no-vacía) y manda `batchKey` (idempotencia v1.35).
    expect(payload).toMatchObject({
      cardId: 'c-charizard',
      finish: 'reverse_holo',
      quantity: 2,
      reason: 'perdida',
      note: 'caja dañada en bodega',
      productType: 'raw',
    });
    expect(payload.note).toBeTruthy();
    expect(typeof payload.batchKey).toBe('string');
    expect(payload.batchKey!.length).toBeGreaterThan(0);
    expect(await screen.findByText('2 piezas dadas de baja.')).toBeInTheDocument();
  });

  it('un reintento del MISMO submit reusa la batchKey (idempotencia anti encogimiento-fantasma)', async () => {
    const spy = vi
      .spyOn(api, 'bulkRemoveInventory')
      .mockRejectedValueOnce(new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }))
      .mockResolvedValueOnce(okRemove(1));
    renderWithProviders(<QuickRemoveSection target={target} removableCount={3} />, 'es');

    fillNote('perdida en tránsito');
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de 1' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Reintento del mismo intento (la confirmación se mantiene tras el error).
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de 1' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    const key1 = spy.mock.calls[0][0].batchKey;
    const key2 = spy.mock.calls[1][0].batchKey;
    expect(key1).toBeTruthy();
    expect(key2).toBe(key1); // MISMA key en el reintento del mismo submit.
  });

  it('el motivo elegido viaja en el body (danada)', async () => {
    const spy = vi.spyOn(api, 'bulkRemoveInventory').mockResolvedValue(okRemove(1));
    renderWithProviders(<QuickRemoveSection target={target} removableCount={3} />, 'es');

    fireEvent.change(screen.getByLabelText('Motivo de la baja'), { target: { value: 'danada' } });
    fillNote();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de 1' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].reason).toBe('danada');
  });

  it('422 INSUFFICIENT_STOCK (carrera) se muestra legible con las disponibles', async () => {
    vi.spyOn(api, 'bulkRemoveInventory').mockRejectedValue(
      new ApiClientError(422, {
        code: 'INSUFFICIENT_STOCK',
        message: 'not enough',
        details: { available: 1, requested: 2 },
      }),
    );
    renderWithProviders(<QuickRemoveSection target={target} removableCount={2} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Sumar uno' })); // qty 2
    fillNote();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de 2' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1 disponibles');
  });

  it('422 ITEM_NOT_ADJUSTABLE se ancla como alerta legible (no silencio)', async () => {
    vi.spyOn(api, 'bulkRemoveInventory').mockRejectedValue(
      new ApiClientError(422, { code: 'ITEM_NOT_ADJUSTABLE', message: 'not adjustable' }),
    );
    renderWithProviders(<QuickRemoveSection target={target} removableCount={3} />, 'es');

    fillNote();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de 1' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('no se puede ajustar');
  });

  it('refresca el conteo tras la baja (onRemoved recibe el resumen)', async () => {
    vi.spyOn(api, 'bulkRemoveInventory').mockResolvedValue(okRemove(1));
    const onRemoved = vi.fn();
    renderWithProviders(
      <QuickRemoveSection target={target} removableCount={3} onRemoved={onRemoved} />,
      'es',
    );

    fillNote();
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de 1' }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(onRemoved.mock.calls[0][0]).toMatchObject({ removed: 1 });
  });
});
