import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockSettings } from '@/lib/mock/fixtures';
import es from '../../../../../../messages/es.json';
import { M11View } from './M11View';

// El rol es controlable por test (patrón M2View.test). La ruta de M11 es `vault_operator+`; los
// «Ajustes avanzados» (capa 3) se gatean DENTRO de la vista con SuperAdminOnly.
const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: true,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

// Los hijos pesados (inventario y la capa 2 de precios) se stubean: aquí se prueba el ARMADO de las
// TRES capas y el gate de rol de la capa 3, no su lógica interna (que tiene sus propios tests). El
// gate del botón de la capa 2 se prueba en SealedPriceStatusSection.test.
vi.mock('../m1/SealedTab', () => ({ SealedTab: () => <div data-testid="sealed-tab" /> }));
vi.mock('../m1/PendingPublishQueue', () => ({
  PendingPublishQueue: ({ productType }: { productType?: string }) => (
    <div data-testid="pending-queue" data-product-type={productType} />
  ),
}));
vi.mock('./sections/SealedPriceStatusSection', () => ({
  SealedPriceStatusSection: () => <div data-testid="collection-section" />,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, sealedPriceSource: 'off' });
  vi.spyOn(api, 'getSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 15,
  });
  vi.spyOn(api, 'getLocations').mockResolvedValue([]);
});

describe('M11View · Sellado (§diseño §1/§2 · tres capas)', () => {
  it('el título es «Sellado» en llano (D-6: sin el código «M11»)', async () => {
    renderWithProviders(<M11View />, 'es');
    expect(
      await screen.findByRole('heading', { level: 1, name: /^Sellado$/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: /M11/ })).not.toBeInTheDocument();
  });

  it('arma las tres capas y filtra la cola a sellado', async () => {
    renderWithProviders(<M11View />, 'es');
    await screen.findByRole('heading', { level: 1, name: /^Sellado$/ });
    // Capa 1: inventario + cola (con productType="sealed").
    expect(screen.getByTestId('sealed-tab')).toBeInTheDocument();
    expect(screen.getByTestId('pending-queue')).toHaveAttribute('data-product-type', 'sealed');
    // Capa 2: precios de la colección.
    expect(screen.getByTestId('collection-section')).toBeInTheDocument();
    // Capa 3: acordeón «Ajustes avanzados», plegado por defecto.
    const advanced = screen.getByText('Ajustes avanzados (precios de mercado)');
    expect(advanced).toBeInTheDocument();
    expect(advanced.closest('details')).not.toHaveAttribute('open');
  });

  it('M11-role-operator-no-advanced: un vault_operator ve la capa 3 con el candado, no los diales', async () => {
    roleState.role = 'vault_operator';
    renderWithProviders(<M11View />, 'es');
    await screen.findByRole('heading', { level: 1, name: /^Sellado$/ });
    // MARCADOR DETERMINISTA del gate (canario que MUERDE): con `SuperAdminOnly` puesto, el operador
    // ve el candado de `EmptyState`. Si se quita el `<SuperAdminOnly>`, el candado desaparece (monta
    // el panel async en su lugar) y este `findByText` agota el tiempo → la prueba FALLA.
    expect(await screen.findByText(es.admin.superAdminGateTitle)).toBeInTheDocument();
    // El panel super_admin no monta: no hay control del interruptor maestro ni selects de dial.
    expect(screen.queryByRole('button', { name: /Encender la fuente automática/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tendencia de valor del sellado/)).not.toBeInTheDocument();
    // Pero sí ve el inventario (capa 1) y la cola.
    expect(screen.getByTestId('sealed-tab')).toBeInTheDocument();
    expect(screen.getByTestId('pending-queue')).toBeInTheDocument();
  });

  it('un super_admin SÍ ve los diales avanzados (interruptor maestro)', async () => {
    renderWithProviders(<M11View />, 'es');
    expect(
      await screen.findByRole('button', { name: /Encender la fuente automática/ }),
    ).toBeInTheDocument();
    // El botón «Traer precios ahora» ya NO vive en los diales: subió a la capa 2.
    expect(screen.queryByRole('button', { name: /Traer precios ahora/ })).not.toBeInTheDocument();
  });
});
