import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockSettings } from '@/lib/mock/fixtures';
import es from '../../../../../../messages/es.json';
import { M11View } from './M11View';

// El rol es controlable por test (patrón M2View.test). La ruta de M11 es `vault_operator+`; el
// panel de diales (iv) se gatea DENTRO de la vista con SuperAdminOnly.
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

// Los hijos pesados (inventario y estado) se stubean: aquí se prueba el ARMADO de M11 y el gate de
// rol de la sección (iv), no la lógica interna de SealedTab (que tiene sus propios tests).
vi.mock('../m1/SealedTab', () => ({ SealedTab: () => <div data-testid="sealed-tab" /> }));
vi.mock('../m1/PendingPublishQueue', () => ({
  PendingPublishQueue: ({ productType }: { productType?: string }) => (
    <div data-testid="pending-queue" data-product-type={productType} />
  ),
}));
vi.mock('./sections/SealedPriceStatusSection', () => ({
  SealedPriceStatusSection: () => <div data-testid="status-section" />,
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

describe('M11View · Sellado (§diseño §1)', () => {
  it('arma las 4 secciones y filtra la cola a sellado', async () => {
    renderWithProviders(<M11View />, 'es');
    expect(await screen.findByRole('heading', { level: 1, name: /M11 · Sellado/ })).toBeInTheDocument();
    expect(screen.getByTestId('sealed-tab')).toBeInTheDocument();
    expect(screen.getByTestId('status-section')).toBeInTheDocument();
    // (iii) la cola se monta con productType="sealed".
    expect(screen.getByTestId('pending-queue')).toHaveAttribute('data-product-type', 'sealed');
  });

  it('M11-role-operator-no-dials: un vault_operator NO ve inputs de dial; la sección (iv) muestra el candado', async () => {
    roleState.role = 'vault_operator';
    renderWithProviders(<M11View />, 'es');
    await screen.findByRole('heading', { level: 1, name: /M11 · Sellado/ });
    // MARCADOR DETERMINISTA del gate (canario que MUERDE): con `SuperAdminOnly` puesto, el operador ve
    // el candado de `EmptyState` (patrón BountiesView.test). Es una aserción POSITIVA y esperada, no un
    // `queryByText` síncrono: si se quita el `<SuperAdminOnly>`, el candado desaparece (monta el panel
    // async en su lugar) y este `findByText` agota el tiempo → la prueba FALLA. Va antes de los
    // negativos para asegurar que el render ya se asentó cuando se comprueba la ausencia de diales.
    expect(await screen.findByText(es.admin.superAdminGateTitle)).toBeInTheDocument();
    // El panel super_admin no monta: no hay control del interruptor maestro ni selects de dial.
    expect(screen.queryByText('Encender la fuente automática')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Tendencia de valor del sellado/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Traer precios ahora/ })).not.toBeInTheDocument();
    // Pero sí ve el inventario (i/ii) y la cola (iii).
    expect(screen.getByTestId('sealed-tab')).toBeInTheDocument();
    expect(screen.getByTestId('pending-queue')).toBeInTheDocument();
  });

  it('un super_admin SÍ ve el panel de diales (interruptor maestro y «Traer precios ahora»)', async () => {
    renderWithProviders(<M11View />, 'es');
    expect(
      await screen.findByRole('button', { name: /Encender la fuente automática/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Traer precios ahora/ })).toBeInTheDocument();
  });
});
