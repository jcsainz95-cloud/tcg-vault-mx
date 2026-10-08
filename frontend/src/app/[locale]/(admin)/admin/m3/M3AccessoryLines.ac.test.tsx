import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { photo } from '@/test/accessories.testkit';
import type { AdminOrderDetailDTO } from '@/types/contract';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';

/**
 * AC-F13 + AC-F19 (`API_CONTRACT §AC.10 (2)` y `§AC.12` con la errata v1.86.2; `DESIGN_SYSTEM §AC-UX.13`).
 * M3 pinta los renglones de accesorio. «Reembolsar unidades» SOLO con `deliveredRefund.kind = 'refundable'` y
 * súper-admin; selector 1..`refundableQty`; importe = `amountByQtyCents[k−1]` LEÍDO (⛔ no calculado); nota
 * obligatoria 3–500; el cuerpo lleva `expectedRefundCents` = ese importe. `409 REFUND_PREVIEW_STALE` ⇒ enseña
 * `refundCents` y pide confirmar de nuevo (⛔ nunca reintenta solo).
 */
const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const DETAIL: AdminOrderDetailDTO = {
  id: 'ord-8001',
  userId: null,
  orderNumber: 'TCG-008001',
  status: 'settled',
  breakdown: {
    subtotalCents: 19_800, ivaCents: 2_731, ivaRatePct: 16, processingFeeCents: 1_000, shippingFeeCents: 17_500,
    totalCents: 38_300, currency: 'MXN', priceConvention: 'IVA_INCLUSIVE', ivaIncluded: true,
  },
  items: [],
  fulfillmentMode: 'direct_ship',
  createdAt: '2026-10-01T10:00:00Z',
  settledAt: '2026-10-01T10:02:00Z',
  fullRefundReview: null,
  accessoryLines: [
    {
      id: 'oal-1', kind: 'accessory', name: 'Penny sleeves x100', photo: photo('acc-1'), quantity: 3, unitPriceCents: 8_900,
      lineTotalCents: 26_700, refundedQty: 1, deckName: null, components: [],
      // ⚠️ A propósito, NO es k × 8900: si la pantalla multiplicara, se notaría.
      deliveredRefund: { kind: 'refundable', refundableQty: 2, amountByQtyCents: [9_311, 18_622] },
    },
    {
      id: 'oal-2', kind: 'energy_bundle', name: 'Dragapult ex', // v1.86.3 (§AC.19.6): name = deckName
      photo: null, quantity: 1, unitPriceCents: 2_000,
      lineTotalCents: 2_000, refundedQty: 0, deckName: 'Dragapult ex',
      components: [
        { energyType: 'fire', quantity: 8 },
        { energyType: 'water', quantity: 4 },
      ],
      deliveredRefund: { kind: 'refundable', refundableQty: 1, amountByQtyCents: [2_093] },
    },
    {
      id: 'oal-3', kind: 'accessory', name: 'Toploaders', photo: null, quantity: 1, unitPriceCents: 12_000,
      lineTotalCents: 12_000, refundedQty: 0, deckName: null, components: [],
      deliveredRefund: { kind: 'not_refundable', reason: 'not_delivered' },
    },
  ],
};

const fresh = () => structuredClone(DETAIL);

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

async function openDialog(lineId: string) {
  fireEvent.click(await screen.findByTestId(`m3-accessory-refund-${lineId}`));
  return screen.findByRole('dialog');
}
function fillNote(dialog: HTMLElement, text = 'No llegó el paquete según la paquetería') {
  fireEvent.change(within(dialog).getByLabelText('Nota (obligatoria)'), { target: { value: text } });
}

describe('AC-F13 · M3 con renglones de accesorio', () => {
  it('pinta renglón, paquete con desglose y «1 reembolsadas»; ⛔ sin costo', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    const acc = await screen.findByTestId('m3-accessory-oal-1');
    expect(within(acc).getByText(/Penny sleeves x100 ×3/)).toBeInTheDocument();
    expect(within(acc).getByText(/267\.00/)).toBeInTheDocument();
    expect(within(acc).getByText('1 reembolsadas')).toBeInTheDocument();
    const b = screen.getByTestId('m3-accessory-oal-2');
    expect(within(b).getByText(/Paquete de energías — Dragapult ex/)).toBeInTheDocument();
    expect(within(b).getByText('Fuego ×8 · Agua ×4')).toBeInTheDocument();
  });
});

describe('AC-F19 · «Reembolsar unidades» con el importe del servidor', () => {
  it('selector 1..refundableQty; importe = amountByQtyCents[k−1]; manda {quantity, reason, note, expectedRefundCents}', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    const post = vi.spyOn(api, 'refundAccessoryLineDelivered').mockResolvedValue({ refund: {} as never });
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    const dialog = await openDialog('oal-1');
    const qty = within(dialog).getByRole('spinbutton', { name: 'Cuántas' });
    expect(qty).toHaveValue(1);
    expect(dialog).toHaveTextContent(/93\.11/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar una' }));
    expect(qty).toHaveValue(2);
    expect(within(dialog).getByRole('button', { name: 'Agregar una' })).toBeDisabled();
    expect(dialog).toHaveTextContent(/186\.22/);
    fireEvent.click(within(dialog).getByRole('radio', { name: /No llegó/ }));
    fillNote(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reembolsar 2/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('ord-8001', 'oal-1', {
        quantity: 2,
        reason: 'not_arrived',
        note: 'No llegó el paquete según la paquetería',
        expectedRefundCents: 18_622,
      }),
    );
  });

  it('sin nota de 3+ caracteres (tras trim) no se manda nada', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    const post = vi.spyOn(api, 'refundAccessoryLineDelivered');
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    const dialog = await openDialog('oal-1');
    fireEvent.click(within(dialog).getByRole('radio', { name: /No llegó/ }));
    fillNote(dialog, '  ab  ');
    expect(within(dialog).getByRole('button', { name: /^Reembolsar 1/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('409 REFUND_PREVIEW_STALE ⇒ enseña refundCents y la segunda confirmación manda esa cifra', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    const post = vi
      .spyOn(api, 'refundAccessoryLineDelivered')
      .mockRejectedValueOnce(new ApiClientError(409, { code: 'REFUND_PREVIEW_STALE', message: 'x', details: { refundCents: 9_400 } }))
      .mockResolvedValueOnce({ refund: {} as never });
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    const dialog = await openDialog('oal-1');
    fireEvent.click(within(dialog).getByRole('radio', { name: /No llegó/ }));
    fillNote(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reembolsar 1/ }));
    expect(await within(dialog).findByText(/El importe cambió a .*94\.00/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reembolsar 1/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][2]).toMatchObject({ quantity: 1, expectedRefundCents: 9_400 });
  });

  it('paquete: sin stepper (siempre 1); 409 BUNDLE_REFUND_REQUIRES_DECK con su texto', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    vi.spyOn(api, 'refundAccessoryLineDelivered').mockRejectedValue(new ApiClientError(409, { code: 'BUNDLE_REFUND_REQUIRES_DECK', message: 'x' }));
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    const dialog = await openDialog('oal-2');
    expect(within(dialog).queryByRole('spinbutton', { name: 'Cuántas' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Llegó en mala condición/ }));
    fillNote(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reembolsar 1/ }));
    expect(
      await within(dialog).findByText('El paquete se reembolsa entero y solo cuando todas las cartas de su deck ya se reembolsaron. No se hizo nada.'),
    ).toBeInTheDocument();
  });

  it('409 ACCESSORY_REFUND_EXCEEDS {refundableQty}: «Solo quedan N…»', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    vi.spyOn(api, 'refundAccessoryLineDelivered').mockRejectedValue(
      new ApiClientError(409, { code: 'ACCESSORY_REFUND_EXCEEDS', message: 'x', details: { refundableQty: 1 } }),
    );
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    const dialog = await openDialog('oal-1');
    fireEvent.click(within(dialog).getByRole('radio', { name: /No llegó/ }));
    fillNote(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reembolsar 1/ }));
    expect(await within(dialog).findByText('Solo quedan 1 por reembolsar en este renglón. No se hizo nada.')).toBeInTheDocument();
  });

  it('operador, o renglón not_refundable: sin «Reembolsar unidades»', async () => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    const { unmount } = renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    await screen.findByTestId('m3-accessory-oal-3');
    expect(screen.queryByTestId('m3-accessory-refund-oal-3')).toBeNull();
    unmount();
    roleState.role = 'vault_operator';
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    await screen.findByTestId('m3-accessory-oal-1');
    expect(screen.queryByTestId('m3-accessory-refund-oal-1')).toBeNull();
  });
});

describe('AC-F22 (v1.86.3, §AC.19.6) · id y kind obligatorios', () => {
  it('el paquete se titula por `kind` (no por `deckName !== null`) y «Reembolsar unidades» usa la llave `id`', async () => {
    const d = fresh();
    // ⚠️ Sonda fuera de contrato a propósito: un `accessory` con deckName. Discriminar por deckName lo haría paquete.
    d.accessoryLines = [{ ...d.accessoryLines![0], id: 'oal-7', deckName: 'Dragapult ex' }];
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(d);
    const post = vi.spyOn(api, 'refundAccessoryLineDelivered').mockResolvedValue({ refund: {} as never });
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, 'es');
    const row = await screen.findByTestId('m3-accessory-oal-7');
    expect(within(row).getByText(/Penny sleeves x100 ×3/)).toBeInTheDocument();
    expect(within(row).queryByText(/Paquete de energías/)).toBeNull();
    const dialog = await openDialog('oal-7');
    // Renglón suelto ⇒ con stepper (un paquete no lo lleva).
    expect(within(dialog).getByRole('spinbutton', { name: 'Cuántas' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: /No llegó/ }));
    fillNote(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reembolsar 1/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('ord-8001', 'oal-7', expect.objectContaining({ quantity: 1 })));
  });
});

/** QA §AC.gates (MENOR, frontend): la ayuda de «Llegó en mala condición» decía «las cartas» en un renglón de accesorio. */
describe('QA §AC.gates · «Reembolsar unidades» no habla de cartas', () => {
  it.each([
    ['oal-1', 'es', /carta/i],
    ['oal-2', 'es', /carta/i],
    ['oal-1', 'en', /\bcards?\b/i],
  ] as const)('renglón %s (%s): ningún texto del diálogo al abrir nombra cartas', async (lineId, locale, re) => {
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue(fresh());
    renderWithProviders(<M3OrderDetailView orderId="ord-8001" />, locale);
    const dialog = await openDialog(lineId);
    expect(dialog.textContent ?? '').not.toMatch(re);
    expect(dialog).toHaveTextContent(locale === 'es' ? 'Llegó, pero no estaba como se vendió.' : "It arrived, but it wasn't as sold.");
  });
});
