import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VariantPriceConsole, VariantPricingCompact } from './VariantPriceConsole';
import * as api from '@/lib/api';
import type { VariantPricingDTO } from '@/types/contract';

// Rol controlable (edición SOLO super_admin; vault_operator lee).
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

const basePricing: VariantPricingDTO = {
  buy: { suggestedCents: 87_500, overrideCents: null, effectiveCents: 87_500, source: 'rule' },
  sell: { suggestedCents: 169_000, overrideCents: null, effectiveCents: 169_000, source: 'rule' },
};

const overriddenPricing: VariantPricingDTO = {
  buy: { suggestedCents: 87_500, overrideCents: 95_000, effectiveCents: 95_000, source: 'override' },
  sell: { suggestedCents: 169_000, overrideCents: 180_000, effectiveCents: 180_000, source: 'override' },
  bounty: { enabled: false, priceCents: null, targetQty: null, acquiredQty: 0, completedAt: null },
};

describe('VariantPricingCompact (§16.3a) · teja de solo-lectura', () => {
  it('pinta MERCADO/COMPRA/VENTA con sufijo ·M en override y ·B en bounty — nunca $0', () => {
    const pricing: VariantPricingDTO = {
      buy: { suggestedCents: 87_500, overrideCents: null, effectiveCents: 250_000, source: 'bounty' },
      sell: { suggestedCents: 169_000, overrideCents: 180_000, effectiveCents: 180_000, source: 'override' },
      bounty: { enabled: true, priceCents: 250_000, targetQty: 3, acquiredQty: 1, completedAt: null },
    };
    renderWithProviders(<VariantPricingCompact pricing={pricing} marketRefCents={125_000} />, 'es');

    expect(screen.getByText('Mercado')).toBeInTheDocument();
    expect(screen.getByText('MX$1,250.00')).toBeInTheDocument();
    // COMPRA = bounty → ·B (bermellón); VENTA = override → ·M (tinta).
    expect(screen.getByText('MX$2,500.00')).toBeInTheDocument();
    expect(screen.getByText('·B')).toBeInTheDocument();
    expect(screen.getByText('MX$1,800.00')).toBeInTheDocument();
    expect(screen.getByText('·M')).toBeInTheDocument();
    expect(screen.queryByText(/MX\$0\.00/)).toBeNull();
  });

  it('sin precio → «—» con affordance de pendiente (jamás un 0 inventado)', () => {
    const pricing: VariantPricingDTO = {
      buy: { suggestedCents: null, overrideCents: null, effectiveCents: null, source: 'pending' },
      sell: { suggestedCents: null, overrideCents: null, effectiveCents: null, source: 'pending' },
    };
    renderWithProviders(<VariantPricingCompact pricing={pricing} marketRefCents={null} />, 'es');
    expect(screen.getAllByText('—').length).toBe(3);
    expect(screen.queryByText(/MX\$0\.00/)).toBeNull();
  });
});

describe('VariantPriceConsole (§16.3b) · edición super_admin', () => {
  it('«Guardar precios» hace UN PUT con ambas caras (override capturado + null la vacía)', async () => {
    const spy = vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c-charizard',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      pricing: overriddenPricing,
    });
    renderWithProviders(
      <VariantPriceConsole
        cardId="c-charizard"
        finish="normal"
        pricing={basePricing}
        marketRefCents={125_000}
      />,
      'es',
    );

    // Captura override de COMPRA (input en pesos) y guarda; VENTA queda vacía → null explícito.
    const overrides = screen.getAllByLabelText('Override');
    fireEvent.change(overrides[0], { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('c-charizard', 'normal', {
      productType: 'raw',
      buyOverrideCents: 95_000,
      sellOverrideCents: null,
      bounty: { enabled: false },
    });
  });

  it('«Restablecer a regla» manda null explícito SOLO de esa cara (visible solo con override)', async () => {
    const spy = vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c-charizard',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      pricing: basePricing,
    });
    renderWithProviders(
      <VariantPriceConsole
        cardId="c-charizard"
        finish="normal"
        pricing={overriddenPricing}
        marketRefCents={125_000}
      />,
      'es',
    );

    const resets = screen.getAllByRole('button', { name: 'Restablecer a regla' });
    expect(resets).toHaveLength(2); // compra y venta tienen override activo
    fireEvent.click(resets[0]);

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('c-charizard', 'normal', {
      productType: 'raw',
      buyOverrideCents: null,
    });
    // Confirmación de que la cara volvió a la regla.
    expect(
      await screen.findByText('Override retirado — vuelve a regir la regla.'),
    ).toBeInTheDocument();
  });

  it('sin override activo NO hay enlace «Restablecer a regla»', () => {
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={basePricing} marketRefCents={125_000} />,
      'es',
    );
    expect(screen.queryByRole('button', { name: 'Restablecer a regla' })).toBeNull();
  });

  it('monto ≤ 0 → error inline y el guardado se bloquea', async () => {
    const spy = vi.spyOn(api, 'putVariantControls');
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={basePricing} marketRefCents={125_000} />,
      'es',
    );

    fireEvent.change(screen.getAllByLabelText('Override')[0], { target: { value: '0' } });
    expect(await screen.findByText('El precio debe ser mayor a cero.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar precios' })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('bounty: activar sin precio muestra el error del contrato; con precio manda bounty en el PUT', async () => {
    const spy = vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c-charizard',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      pricing: basePricing,
    });
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={basePricing} marketRefCents={125_000} />,
      'es',
    );

    fireEvent.click(screen.getByRole('switch', { name: /Marcar como bounty/ }));
    // Sin precio explícito: validación espejo BOUNTY_PRICE_REQUIRED, guardado bloqueado.
    expect(await screen.findByText('El bounty necesita un precio explícito.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar precios' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Precio bounty (MXN)'), { target: { value: '2500' } });
    // Premium sobre la regla (2500.00 − 875.00 = +1,625.00).
    expect(screen.getByText(/Premium sobre la regla/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][2].bounty).toEqual({ enabled: true, priceCents: 250_000, targetQty: null });
  });

  it('vault_operator: lectura sí, edición no (sin inputs ni guardar)', () => {
    roleState.role = 'vault_operator';
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={overriddenPricing} marketRefCents={125_000} />,
      'es',
    );

    expect(screen.queryByLabelText('Override')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar precios' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    // Pero VE los efectivos (texto plano).
    expect(screen.getAllByText('MX$950.00').length).toBeGreaterThan(0);
  });
});
