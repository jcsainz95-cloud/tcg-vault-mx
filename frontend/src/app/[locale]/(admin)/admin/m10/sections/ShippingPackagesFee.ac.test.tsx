import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import type { ShippingPackageDTO } from '@/types/contract';
import { ShippingSection } from './ShippingSection';

/**
 * AC-F11 / AC-UX-12 (`API_CONTRACT §AC.7` «Cajas en el panel», `DESIGN_SYSTEM §AC-UX.10`): la columna
 * «Tarifa al cliente (con IVA)». Vacía ⇒ `null` en el `PUT` (⛔ nunca 0); todas `null` ⇒ `noneCharges`.
 */
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const BOX = (over: Partial<ShippingPackageDTO>): ShippingPackageDTO => ({
  code: 'chica',
  label: 'Chica',
  lengthCm: 20,
  widthCm: 15,
  heightCm: 10,
  weightKg: 1,
  providerPackageType: '4G',
  active: true,
  sortOrder: 1,
  customerFeeCents: null,
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, shippingProvider: 'skydropx', shippingLabelPurchase: 'super_admin_only' });
  vi.spyOn(api, 'getShippingBalance').mockResolvedValue({ balanceCents: 96516, currency: 'MXN', lowBalance: false, thresholdCents: 50000, fetchedAt: '2026-10-04T16:00:00Z' });
  vi.spyOn(api, 'getShippingCatalogs').mockResolvedValue({ packagings: [{ code: '4G', name: 'Caja' }], consignmentNote: null, addressTemplates: [] });
  vi.spyOn(api, 'getMe').mockResolvedValue({ id: 'u-sa1', email: 'd@x.mx', name: 'Dueño', role: 'super_admin', locale: 'es', isOwner: true });
});

describe('AC-UX-12 · tarifa al cliente por caja', () => {
  it('todas sin tarifa ⇒ «Ninguna caja cobra todavía…» y la regla explicada', async () => {
    vi.spyOn(api, 'listShippingPackages').mockResolvedValue([BOX({}), BOX({ code: 'grande', label: 'Grande' })]);
    renderWithProviders(<ShippingSection />, 'es');
    const row = await screen.findByTestId('package-row-chica');
    expect(within(row).getByLabelText('Tarifa al cliente (con IVA)')).toHaveAttribute('placeholder', 'No cobra');
    expect(
      screen.getByText('Ninguna caja cobra todavía: los pedidos con accesorios pagan la tarifa fija de envío de siempre.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Las cajas con tarifa se usan solo cuando el pedido lleva accesorios con medidas\./)).toBeInTheDocument();
  });

  it('vacía ⇒ null en el PUT; con pesos ⇒ centavos', async () => {
    vi.spyOn(api, 'listShippingPackages').mockResolvedValue([BOX({ customerFeeCents: 9900 }), BOX({ code: 'grande', label: 'Grande' })]);
    const put = vi.spyOn(api, 'putShippingPackages').mockImplementation(async (p) => p);
    renderWithProviders(<ShippingSection />, 'es');
    const chica = await screen.findByTestId('package-row-chica');
    const fee = within(chica).getByLabelText('Tarifa al cliente (con IVA)');
    expect(fee).toHaveValue('99.00');
    fireEvent.change(fee, { target: { value: '' } });
    const grande = screen.getByTestId('package-row-grande');
    fireEvent.change(within(grande).getByLabelText('Tarifa al cliente (con IVA)'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empaques' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const sent = put.mock.calls[0][0];
    expect(sent.find((p) => p.code === 'chica')!.customerFeeCents).toBeNull();
    expect(sent.find((p) => p.code === 'grande')!.customerFeeCents).toBe(25000);
    expect(screen.queryByText(/Ninguna caja cobra todavía/)).toBeNull();
  });

  it('`400 {field:customerFeeCents, index}` ⇒ el error bajo la fila de ese índice', async () => {
    vi.spyOn(api, 'listShippingPackages').mockResolvedValue([BOX({}), BOX({ code: 'grande', label: 'Grande', customerFeeCents: 100 })]);
    vi.spyOn(api, 'putShippingPackages').mockRejectedValue(
      new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'customerFeeCents', index: 1 } }),
    );
    renderWithProviders(<ShippingSection />, 'es');
    await screen.findByTestId('package-row-grande');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empaques' }));
    const row = screen.getByTestId('package-row-grande');
    expect(await within(row).findByText('Escribe una tarifa entre $0.01 y $100,000.')).toBeInTheDocument();
  });
});
