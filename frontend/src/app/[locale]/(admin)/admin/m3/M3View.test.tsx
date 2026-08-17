import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M3View } from './M3View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

// El reembolso es money-out (super_admin): se fija el rol para ejercer el flujo.
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M3View · Ventas / órdenes (refund)', () => {
  it('solo las órdenes settled muestran el botón Reembolsar', async () => {
    renderWithProviders(<M3View />, 'es');
    expect((await screen.findAllByText('ord-9001')).length).toBeGreaterThan(0);
    // Fixture: solo ord-9001 está settled → tabla desktop + card mobile = 2 renders máx.
    const refundButtons = screen.getAllByRole('button', { name: 'Reembolsar' });
    expect(refundButtons.length).toBeLessThanOrEqual(2);
  });

  it('el refund exige motivo, llama a POST /admin/orders/:id/refund y confirma', async () => {
    const spy = vi
      .spyOn(api, 'refundOrder')
      .mockResolvedValue({ orderId: 'ord-9001', status: 'refunded', refundId: 're_1' });
    renderWithProviders(<M3View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Reembolsar' }))[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    const confirm = within(dialog).getByRole('button', { name: /Reembolsar MX\$/ });
    // Sin motivo no hay reembolso (queda en bitácora).
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Motivo del reembolso'), {
      target: { value: 'cobro doble' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Reembolsar MX\$/ }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('ord-9001', 'cobro doble'));
    expect(
      await screen.findByText('Reembolso ejecutado para la orden ord-9001.'),
    ).toBeInTheDocument();
  });

  it('un error del refund muestra el mensaje real del backend en el modal', async () => {
    vi.spyOn(api, 'refundOrder').mockRejectedValue(
      new ApiClientError(422, { code: 'UNMAPPED_REFUND_ERROR', message: 'Stripe refund failed: charge disputed' }),
    );
    renderWithProviders(<M3View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Reembolsar' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Reembolsar' });
    fireEvent.change(within(dialog).getByLabelText('Motivo del reembolso'), {
      target: { value: 'cobro doble' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Reembolsar MX\$/ }));

    expect(
      await within(dialog).findByText('Stripe refund failed: charge disputed'),
    ).toBeInTheDocument();
  });
});
