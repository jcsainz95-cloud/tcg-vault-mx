import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { AdminDashboard } from './AdminDashboard';
import { mockDashboard, mockPnl } from '@/lib/mock/fixtures';

// `useRole`: super_admin para que las cifras enmascaradas no oculten la cola de trabajo.
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

// El `Link` de next-intl no resuelve bajo vitest; se stubea a un <a href> que preserva props.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

describe('AdminDashboard · cola de trabajo accionable (§7.8)', () => {
  it('los conteos de la cola de trabajo son ENLACES a su módulo', async () => {
    renderWithProviders(<AdminDashboard />, 'es');

    // Cada conteo enlaza a su módulo: envíos→M4, buylist→M5, precios→M2 (F-26: M8 retirado, sin enlace a disputas).
    const shipments = await screen.findByRole('link', { name: /Envíos/ });
    expect(shipments.getAttribute('href')).toContain('/admin/m4');

    const buylist = screen.getByRole('link', { name: /^Buylist/ });
    expect(buylist.getAttribute('href')).toContain('/admin/m5');

    expect(screen.queryByRole('link', { name: /Disputas/ })).toBeNull();

    // "Precios pendientes" aparece como enlace a M2 (cola de trabajo y salud de datos).
    const pending = screen.getAllByRole('link', { name: /Precios pendientes/ });
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].getAttribute('href')).toContain('/admin/m2');
  });
});

/**
 * ⭐⭐ **§M10-IVA.7 — LA TARJETA DE VENTAS PASA DE UNA CIFRA A DOS** (D55(b), pregunta **70**).
 *
 * `amountCents` **desapareció** del DTO. Lo que se mide aquí es que la tarjeta publique **bruto y
 * neto** y que la diferencia entre ambos sea **explicable**, no sospechosa.
 */
describe('AdminDashboard · §M10-IVA.7 ventas BRUTAS y NETAS', () => {
  // §REPORTES-CEO F1 (CR-2): Inicio ya NO pinta ventas ni ganancia del periodo (viven en Ventas y Finanzas); lo que sigue
  // asertando el dato es que el bruto/neto del servidor cuadran, que ahora consumen Ventas y Finanzas.
  it('Inicio no pinta ventas, ganancia, valor de inventario ni buylist del periodo', async () => {
    const { container } = renderWithProviders(<AdminDashboard />, 'es');
    expect(await screen.findByText('Cola de trabajo')).toBeInTheDocument();
    expect(screen.queryByTestId('sales-gross')).toBeNull();
    expect(screen.queryByTestId('sales-net')).toBeNull();
    expect(screen.queryByTestId('sales-today-card')).toBeNull();
    for (const gone of ['Ganancia del periodo', 'Ventas del periodo', 'Valor de inventario', 'Valor en bóveda', 'Buylist del periodo']) {
      expect(container.textContent).not.toContain(gone);
    }
  });

  /**
   * ⭐⭐ **LA IDENTIDAD NORMATIVA DEL PUENTE, sobre el fixture** (`IVA-10(a)`):
   * ```
   * grossAmountCents ≡ netAmountCents + netShippingRevenueCents + ivaCents + processingFeeCents
   * ```
   * Se asierta sobre el **dato**, no sobre el render, porque es una propiedad del dato: *lo que hace
   * la diferencia bruto↔neto explicable en vez de sospechosa*. ⛔ Un fixture que no la cumpla
   * enseñaría a leer el tablero como dos cifras que «más o menos» cuadran.
   */
  it('⭐ bruto ≡ neto + envío neto + IVA + comisión, EXACTO', () => {
    const s = mockDashboard.salesPeriod;
    expect(s.netAmountCents + s.netShippingRevenueCents + s.ivaCents + s.processingFeeCents).toBe(
      s.grossAmountCents,
    );
  });

  /**
   * ⭐⭐ **`IVA-10(b)` — EL NETO DEL TABLERO *ES* EL INGRESO DEL P&L, y se asierta como IGUALDAD.**
   *
   * Es **la mutación realista**, porque son dos endpoints y dos ficheros: dos definiciones de «neto»
   * que se parecen es peor que una sola cifra. El dueño preguntó (pregunta **70**) *«¿si me refiero
   * al mismo número?»* y la respuesta fue que sí ⇒ dejó de ser una propiedad deseable del diseño y
   * pasó a ser lo que él pidió. **Rojo si difieren en un centavo.**
   */
  it('⭐ `salesPeriod.netAmountCents` == `pnl.incomeCents`, al centavo', () => {
    expect(mockDashboard.salesPeriod.netAmountCents).toBe(mockPnl.incomeCents);
  });

  /** ⛔ `amountCents` ya no existe: un «amount» junto a otro «amount» distinto es la ambigüedad que se mató. */
  it('⛔ `amountCents` ya no existe en la tarjeta de ventas', () => {
    expect(Object.keys(mockDashboard.salesPeriod)).not.toContain('amountCents');
  });
});

/**
 * **SR-UI-9** (`DESIGN_SYSTEM §40.3 (e)`, contrato §M4-SHIP.18.12 (7)): `workQueue.refundReviews` `null` ⇒ la tarjeta
 * NO existe; con `{pending:2, oldestRefundedAt}` ⇒ «2» y el enlace a `/admin/m3?refundReview=pending`.
 */
describe('AdminDashboard · SR-UI-9 «Reembolsos por revisar»', () => {
  it('`refundReviews: null` ⇒ no existe la tarjeta', async () => {
    const api = await import('@/lib/api');
    vi.spyOn(api, 'getDashboard').mockResolvedValue({ ...mockDashboard, workQueue: { ...mockDashboard.workQueue, refundReviews: null } } as never);
    renderWithProviders(<AdminDashboard />, 'es');
    await screen.findByText('Cola de trabajo');
    expect(screen.queryByTestId('dashboard-refund-reviews')).toBeNull();
    expect(screen.queryByText('Reembolsos por revisar')).toBeNull();
  });

  it('`{pending:2, oldestRefundedAt}` ⇒ «2» y el enlace a Ventas filtrado', async () => {
    const api = await import('@/lib/api');
    const oldest = new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString();
    vi.spyOn(api, 'getDashboard').mockResolvedValue({
      ...mockDashboard,
      workQueue: { ...mockDashboard.workQueue, refundReviews: { pending: 2, oldestRefundedAt: oldest } },
    } as never);
    renderWithProviders(<AdminDashboard />, 'es');
    const link = await screen.findByTestId('dashboard-refund-reviews');
    expect(link).toHaveAttribute('href', '/admin/m3?refundReview=pending');
    expect(link).toHaveTextContent('Falta el motivo · el más viejo hace 3 días');
    const card = screen.getByText('Reembolsos por revisar').parentElement!;
    expect(card.parentElement!.textContent).toContain('2');
  });

  it('`{pending:0}` ⇒ «Nada por revisar.»', async () => {
    const api = await import('@/lib/api');
    vi.spyOn(api, 'getDashboard').mockResolvedValue({
      ...mockDashboard,
      workQueue: { ...mockDashboard.workQueue, refundReviews: { pending: 0, oldestRefundedAt: null } },
    } as never);
    renderWithProviders(<AdminDashboard />, 'es');
    expect(await screen.findByTestId('dashboard-refund-reviews')).toHaveTextContent('Nada por revisar.');
  });
});
