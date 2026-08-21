import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { QuickAddSection } from './QuickAdd';
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

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

const target = { cardId: 'c-charizard', productType: 'raw' as const, finish: 'reverse_holo' as const };

function okBatch(folios: string[]) {
  return {
    batchKey: 'k',
    idempotentReplay: false,
    summary: { requested: 1, createdItems: folios.length, failedLines: 0 },
    results: [
      { index: 0, ok: true as const, folios, inventoryItemIds: folios.map((f) => `id-${f}`) },
    ],
  };
}

describe('QuickAddSection (P-19, §16.5) · alta rápida simplificada', () => {
  it('«Comprar»: precio PRELLENADO con buy.effectiveCents (editable) + helper por fuente', () => {
    renderWithProviders(
      <QuickAddSection
        target={target}
        buyEffectiveCents={87_500}
        buySource="rule"
        marketRefCents={125_000}
      />,
      'es',
    );

    const price = screen.getByLabelText('Precio pagado (MXN)') as HTMLInputElement;
    expect(price.value).toBe('875');
    expect(screen.getByText('Sugerido por regla')).toBeInTheDocument();
    // SIN dropdown de acabado y SIN ubicación (la variante viene de la casilla picada).
    expect(screen.queryByLabelText(/Acabado/)).toBeNull();
    expect(screen.queryByLabelText(/Ubicación/)).toBeNull();
  });

  it('«Comprar» envía compra con acquisitionCostCents y qty del stepper; éxito con folios', async () => {
    const spy = vi
      .spyOn(api, 'batchCreateItems')
      .mockResolvedValue(okBatch(['INV-000301', 'INV-000302', 'INV-000303']));
    renderWithProviders(
      <QuickAddSection target={target} buyEffectiveCents={87_500} buySource="bounty" marketRefCents={125_000} />,
      'es',
    );

    // Helper de fuente bounty + stepper a 3.
    expect(screen.getByText('Precio bounty activo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sumar uno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sumar uno' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const { items, batchKey } = spy.mock.calls[0][0];
    expect(batchKey).toBeTruthy();
    expect(items).toEqual([
      {
        cardId: 'c-charizard',
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'reverse_holo',
        qty: 3,
        acquisitionType: 'compra',
        acquisitionCostCents: 87_500,
      },
    ]);
    // Resultado DENTRO del panel: resumen con rango de folios.
    expect(
      await screen.findByText('3 piezas dadas de alta · INV-000301 a INV-000303.'),
    ).toBeInTheDocument();
  });

  it('«Aportación» manda acquisitionPct: 100 EXPLÍCITO (sin % visible en ninguna parte)', async () => {
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue(okBatch(['INV-000400']));
    renderWithProviders(
      <QuickAddSection target={target} buyEffectiveCents={87_500} buySource="rule" marketRefCents={125_000} />,
      'es',
    );

    // La tarjeta muestra el valor de mercado NO editable.
    expect(screen.getByText('MX$1,250.00')).toBeInTheDocument();
    expect(screen.queryByLabelText(/%/)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Aportación/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].items[0]).toMatchObject({
      acquisitionType: 'aportacion_en_especie',
      acquisitionPct: 100,
    });
  });

  it('sin referencia de mercado la tarjeta Aportación se DESHABILITA con pill PRECIO PENDIENTE', () => {
    renderWithProviders(
      <QuickAddSection target={target} buyEffectiveCents={null} buySource={null} marketRefCents={null} />,
      'es',
    );

    const contribRadio = screen.getByRole('radio', { name: /Aportación/ });
    expect(contribRadio).toBeDisabled();
    expect(screen.getByText('Precio pendiente')).toBeInTheDocument();
    expect(screen.getByText(/Sin valor de mercado/)).toBeInTheDocument();
    // Comprar sin sugerido: input vacío con helper de captura manual.
    expect((screen.getByLabelText('Precio pagado (MXN)') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Sin sugerido — captura el precio pagado.')).toBeInTheDocument();
  });

  it('respaldo P-4: un 422 PRICE_PENDING por línea se ancla como alerta con copy claro', async () => {
    vi.spyOn(api, 'batchCreateItems').mockResolvedValue({
      batchKey: 'k',
      idempotentReplay: false,
      summary: { requested: 1, createdItems: 0, failedLines: 1 },
      results: [
        { index: 0, ok: false, error: { code: 'PRICE_PENDING', message: 'no reference' } },
      ],
    });
    renderWithProviders(
      <QuickAddSection target={target} buyEffectiveCents={87_500} buySource="rule" marketRefCents={125_000} />,
      'es',
    );

    fireEvent.click(screen.getByRole('radio', { name: /Aportación/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'No se registró la aportación: esta variante no tiene valor de mercado. Fija el precio y vuelve a intentar.',
    );
  });
});
