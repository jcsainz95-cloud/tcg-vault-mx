import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VariantPriceConsole, VariantPricingCompact } from './VariantPriceConsole';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { VariantPricingDTO } from '@/types/contract';

// `@/i18n/navigation` (next-intl) no resuelve bajo vitest; se stubea a un <a> que preserva href.
// Lo necesita el enlace del guardarraíl («Ver en la cola de pendientes») de la consola de precios.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));


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
  buy: { suggestedCents: 87_500, overrideCents: null, effectiveCents: 87_500, source: 'market', premiumAtFloor: false },
  sell: { suggestedCents: 169_000, overrideCents: null, effectiveCents: 169_000, source: 'market', premiumAtFloor: false },
};

const overriddenPricing: VariantPricingDTO = {
  buy: { suggestedCents: 87_500, overrideCents: 95_000, effectiveCents: 95_000, source: 'override', premiumAtFloor: false },
  sell: { suggestedCents: 169_000, overrideCents: 180_000, effectiveCents: 180_000, source: 'override', premiumAtFloor: false },
  bounty: {
    enabled: false,
    priceCents: null,
    targetQty: null,
    acquiredQty: 0,
    completedAt: null,
    effective: false,
    curveQuoteCents: 87_500,
  },
};

describe('VariantPricingCompact (§16.3a) · teja de solo-lectura', () => {
  it('pinta MERCADO/COMPRA/VENTA con sufijo ·M en override y ·B en bounty — nunca $0', () => {
    const pricing: VariantPricingDTO = {
      buy: { suggestedCents: 87_500, overrideCents: null, effectiveCents: 250_000, source: 'bounty', premiumAtFloor: false },
      sell: { suggestedCents: 169_000, overrideCents: 180_000, effectiveCents: 180_000, source: 'override', premiumAtFloor: false },
      bounty: {
        enabled: true,
        priceCents: 250_000,
        targetQty: 3,
        acquiredQty: 1,
        completedAt: null,
        effective: true,
        curveQuoteCents: 87_500,
      },
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
      buy: { suggestedCents: null, overrideCents: null, effectiveCents: null, source: 'pending', premiumAtFloor: false },
      sell: { suggestedCents: null, overrideCents: null, effectiveCents: null, source: 'pending', premiumAtFloor: false },
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

  it('«Restablecer a la curva» manda null explícito SOLO de esa cara (visible solo con override)', async () => {
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

    const resets = screen.getAllByRole('button', { name: 'Restablecer a la curva' });
    expect(resets).toHaveLength(2); // compra y venta tienen override activo
    fireEvent.click(resets[0]);

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('c-charizard', 'normal', {
      productType: 'raw',
      buyOverrideCents: null,
    });
    // Confirmación de que la cara volvió a la regla.
    expect(
      await screen.findByText('Override retirado — vuelve a regir la curva.'),
    ).toBeInTheDocument();
  });

  it('sin override activo NO hay enlace «Restablecer a la curva»', () => {
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={basePricing} marketRefCents={125_000} />,
      'es',
    );
    expect(screen.queryByRole('button', { name: 'Restablecer a la curva' })).toBeNull();
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
    expect(screen.getByText(/Premium sobre la curva/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][2].bounty).toEqual({ enabled: true, priceCents: 250_000, targetQty: null });
  });

  it('M-1: tras guardar, Efectivo/FUENTE pintan el estado NUEVO de la respuesta sin reabrir', async () => {
    vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c-charizard',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      pricing: overriddenPricing,
    });
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={basePricing} marketRefCents={125_000} />,
      'es',
    );

    // Antes del write ambas caras resuelven por regla: no hay override que retirar.
    expect(screen.queryByRole('button', { name: 'Restablecer a la curva' })).toBeNull();

    fireEvent.change(screen.getAllByLabelText('Override')[0], { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar precios' }));

    // La consola adopta el pricing RESUELTO de la respuesta (no el prop capturado al abrir):
    // fuente Manual en ambas caras, efectivos nuevos y «Restablecer a regla» disponible — SIN reabrir.
    expect(await screen.findAllByRole('button', { name: 'Restablecer a la curva' })).toHaveLength(2);
    expect(screen.getAllByText('Manual').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('MX$1,800.00')).toBeInTheDocument(); // venta efectiva del response
  });

  it('M-3: si «Fijar mercado» falla, hay banner de error anclado (nada de éxito silencioso)', async () => {
    vi.spyOn(api, 'overridePrice').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'invalid price' }),
    );
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={basePricing} marketRefCents={null} />,
      'es',
    );

    fireEvent.change(screen.getByLabelText('Fijar mercado (MXN)'), { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fijar' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Referencia de mercado fijada.')).toBeNull();
  });

  it('M-3: el éxito de «Fijar mercado» dispara onChanged (refetch real) y NO fabrica un onSaved', async () => {
    const spy = vi.spyOn(api, 'overridePrice').mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    const onChanged = vi.fn();
    renderWithProviders(
      <VariantPriceConsole
        cardId="c-charizard"
        finish="normal"
        pricing={basePricing}
        marketRefCents={null}
        onSaved={onSaved}
        onChanged={onChanged}
      />,
      'es',
    );

    fireEvent.change(screen.getByLabelText('Fijar mercado (MXN)'), { target: { value: '1250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fijar' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // onSaved queda reservado para el payload REAL del PUT variant-controls.
    expect(onSaved).not.toHaveBeenCalled();
    // raw usa la clave canónica del contrato (no un default mágico de graded).
    expect(spy).toHaveBeenCalledWith({
      cardId: 'c-charizard',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      priceMxnCents: 125_000,
    });
    expect(await screen.findByText('Referencia de mercado fijada.')).toBeInTheDocument();
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

/**
 * §21.9a/b — mapa canónico de `priceBasis` y **guardarraíl visible**. `·P` es nuevo y necesario:
 * «el piso ganó» es lo que el dueño necesita ver para detectar un **piso mal calibrado**, y es la
 * causa de que la ficha pública NO muestre el mercado.
 */
describe('VariantPricingCompact · basis y guardarraíl (P-48, §21.9a/b)', () => {
  it('cuando gana la constante del eje, el renglón lleva ·P con su nombre accesible', () => {
    const pricing: VariantPricingDTO = {
      buy: { suggestedCents: 100, overrideCents: null, effectiveCents: 100, source: 'floor', premiumAtFloor: false },
      sell: { suggestedCents: 2_500, overrideCents: null, effectiveCents: 2_500, source: 'floor', premiumAtFloor: false },
    };
    renderWithProviders(<VariantPricingCompact pricing={pricing} marketRefCents={114} />, 'es');

    expect(screen.getAllByText('·P')).toHaveLength(2);
    // La desambiguación del eje vive en el nombre accesible, no en un segundo rótulo.
    expect(
      screen.getByTitle('Determinado por el piso — el mercado no explica este precio'),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle('Determinado por el mínimo de compra — el mercado no explica este precio'),
    ).toBeInTheDocument();
  });

  it('guardarraíl: `premiumAtFloor` pinta ·! (y NO ·P) — la retención implica el piso', () => {
    const pricing: VariantPricingDTO = {
      buy: { suggestedCents: 100, overrideCents: null, effectiveCents: null, source: 'pending', premiumAtFloor: true },
      sell: { suggestedCents: 2_500, overrideCents: null, effectiveCents: null, source: 'pending', premiumAtFloor: true },
    };
    renderWithProviders(<VariantPricingCompact pricing={pricing} marketRefCents={114} />, 'es');

    expect(screen.getAllByText('·!')).toHaveLength(2);
    expect(screen.queryByText('·P')).toBeNull();
    expect(
      screen.getByTitle(/No se publica: rareza premium que aterrizó en el piso/),
    ).toBeInTheDocument();
  });
});

describe('VariantPriceConsole · aviso de bounty rebasado (P-48, §21.9c-3)', () => {
  const outbid: VariantPricingDTO = {
    buy: { suggestedCents: 95_000, overrideCents: null, effectiveCents: 95_000, source: 'market', premiumAtFloor: false },
    sell: { suggestedCents: 169_000, overrideCents: null, effectiveCents: 169_000, source: 'market', premiumAtFloor: false },
    bounty: {
      enabled: true,
      priceCents: 90_000,
      targetQty: null,
      acquiredQty: 0,
      completedAt: null,
      effective: false,
      curveQuoteCents: 95_000,
    },
  };

  it('muestra las DOS cifras y el remedio, SIN acciones nuevas', () => {
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={outbid} marketRefCents={300_000} />,
      'es',
    );

    expect(screen.getByText('Bounty rebasado')).toBeInTheDocument();
    expect(screen.getByText(/Tu oferta MX\$900\.00/)).toBeInTheDocument();
    expect(screen.getByText(/tarifa vigente MX\$950\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Súbelo por encima de MX\$950\.00 o apágalo/)).toBeInTheDocument();
    // Cuánto pagar es decisión del dueño: no se ofrece «subir automáticamente».
    expect(screen.queryByRole('button', { name: /autom/i })).toBeNull();
  });

  it('sin tarifa de curva (curveQuoteCents null) NO hay aviso: el bounty explícito sigue siendo efectivo', () => {
    const noCurve: VariantPricingDTO = {
      ...outbid,
      bounty: { ...outbid.bounty!, effective: true, curveQuoteCents: null },
    };
    renderWithProviders(
      <VariantPriceConsole cardId="c-charizard" finish="normal" pricing={noCurve} marketRefCents={300_000} />,
      'es',
    );
    expect(screen.queryByText('Bounty rebasado')).toBeNull();
  });

  it('guardarraíl en el drill-down: versalita PISO en la fuente + enlace a la cola con ?reason=', () => {
    const held: VariantPricingDTO = {
      buy: { suggestedCents: 100, overrideCents: null, effectiveCents: null, source: 'pending', premiumAtFloor: true },
      sell: { suggestedCents: 2_500, overrideCents: null, effectiveCents: null, source: 'pending', premiumAtFloor: true },
    };
    renderWithProviders(
      <VariantPriceConsole cardId="c-latias-sir" finish="holofoil" pricing={held} marketRefCents={114} />,
      'es',
    );

    expect(screen.getAllByText('Piso')).toHaveLength(2);
    const links = screen.getAllByRole('link', { name: 'Ver en la cola de pendientes' });
    expect(links.length).toBe(2);
    // La ÚNICA acción es ir a revisar el mercado: el guardarraíl no se apaga desde aquí.
    expect(links[0]).toHaveAttribute('href', '/admin/m2?reason=premium_at_floor');
  });
});
