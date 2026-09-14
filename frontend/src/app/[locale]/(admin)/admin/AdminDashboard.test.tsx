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

    // Cada conteo enlaza a su módulo: envíos→M4, buylist→M5, disputas→M8, precios→M2.
    const shipments = await screen.findByRole('link', { name: /Envíos/ });
    expect(shipments.getAttribute('href')).toContain('/admin/m4');

    const buylist = screen.getByRole('link', { name: /^Buylist/ });
    expect(buylist.getAttribute('href')).toContain('/admin/m5');

    const disputes = screen.getByRole('link', { name: /Disputas/ });
    expect(disputes.getAttribute('href')).toContain('/admin/m8');

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
  it('la tarjeta de ventas publica las dos cifras, rotuladas', async () => {
    renderWithProviders(<AdminDashboard />, 'es');
    const bruto = await screen.findByTestId('sales-gross');
    const neto = screen.getByTestId('sales-net');
    expect(bruto).toHaveTextContent('Bruto');
    expect(neto).toHaveTextContent('Neto');
    // ⛔ El neto es MENOR que el bruto: el bruto lleva IVA, comisión y envío dentro.
    expect(bruto.textContent).toContain('15,919.98');
    expect(neto.textContent).toContain('12,500.00');
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
