import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import type { AdminOrderDetailDTO, OrderAccessoryLineDTO, RefundOrderResponse } from '@/types/contract';
import { orderContentsOf, shippedRefundKey } from './RefundOrderDialog';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';

/**
 * AC-UX.gates §3 (`DESIGN_SYSTEM`, 2026-10-08) · reembolso TOTAL de un pedido YA ENVIADO que trae accesorios.
 * Variante por LO QUE TRAE EL PEDIDO (`items` + `accessoryLines` del detalle M3, `API_CONTRACT §AC.12`):
 * solo cartas ⇒ claves de hoy; solo accesorios ⇒ `…Accessories`; ambos ⇒ `…Mixed`. Con accesorios el fieldset pasa
 * `subject: 'item'`. Mutación de referencia: elegir siempre la clave de cartas ⇒ rojo.
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

const ACC: OrderAccessoryLineDTO = {
  id: 'oal-1', kind: 'accessory', name: 'Penny sleeves x100', photo: null, quantity: 2, unitPriceCents: 8_900,
  lineTotalCents: 17_800, refundedQty: 0, deckName: null, components: [],
};
const CARD = {
  inventoryItemId: 'inv-1', unitPriceCents: 20_000, card: { name: 'Pikachu' },
} as unknown as NonNullable<AdminOrderDetailDTO['items']>[number];

function detail(kind: 'cards' | 'accessories' | 'mixed'): AdminOrderDetailDTO {
  return {
    id: 'ord-8101',
    userId: null,
    orderNumber: 'TCG-008101',
    status: 'settled',
    breakdown: {
      subtotalCents: 17_800, ivaCents: 2_455, ivaRatePct: 16, processingFeeCents: 1_000, shippingFeeCents: 17_500,
      totalCents: 36_300, currency: 'MXN', priceConvention: 'IVA_INCLUSIVE', ivaIncluded: true,
    },
    refundedCents: 0,
    items: kind === 'accessories' ? [] : [CARD],
    accessoryLines: kind === 'cards' ? [] : [ACC],
    fulfillmentMode: 'direct_ship',
    createdAt: '2026-10-01T10:00:00Z',
    settledAt: '2026-10-01T10:02:00Z',
    shipmentShipped: true,
    fullRefundReview: null,
  };
}

const OK: RefundOrderResponse = { orderId: 'ord-8101', status: 'refunded', refundId: 'pr_1' };
const MSG = { es, en } as const;
const sh = (loc: 'es' | 'en') => MSG[loc].admin.m3.shippedRefund as Record<string, unknown>;
const sr = (loc: 'es' | 'en') => MSG[loc].admin.m3.shippedReason;
const fill = (s: string, ref: string, reason: string) => s.replace('{ref}', ref).replace('{reason}', reason);
const CARD_WORD = /carta|card/i;

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

/** Abre el reembolso desde el detalle, elige «Llegó en mala condición», escribe la nota y confirma. */
async function refundFromDetail(kind: 'cards' | 'accessories' | 'mixed', loc: 'es' | 'en') {
  vi.spyOn(api, 'getAdminOrder').mockResolvedValue(detail(kind));
  const post = vi.spyOn(api, 'refundOrder').mockResolvedValue(OK);
  renderWithProviders(<M3OrderDetailView orderId="ord-8101" />, loc);
  fireEvent.click(await screen.findByTestId('m3-refund-cta'));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByTestId('m3-shipped-warning');
  await waitFor(() => expect(within(dialog).getByTestId('m3-refund-shipped-reason')).toBeInTheDocument());
  const dialogText = dialog.textContent ?? '';
  fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(sr(loc).arrived_damaged) }));
  fireEvent.change(within(dialog).getByLabelText(sh(loc).noteLabel as string), { target: { value: 'llegaron rotas las fundas' } });
  fireEvent.click(within(dialog).getByTestId('m3-refund-confirm'));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const notice = await screen.findByTestId('m3-notice');
  return { dialogText, noticeText: notice.textContent ?? '' };
}

describe('AC-UX.gates §3 · selección de variante por lo que trae el pedido', () => {
  it('orderContentsOf: solo cartas / solo accesorios / ambos; sin detalle ni renglones ⇒ cartas (claves de hoy)', () => {
    expect(orderContentsOf(detail('cards'))).toBe('cards');
    expect(orderContentsOf(detail('accessories'))).toBe('accessories');
    expect(orderContentsOf(detail('mixed'))).toBe('mixed');
    expect(orderContentsOf(undefined)).toBe('cards');
    expect(orderContentsOf({ ...detail('cards'), items: undefined, accessoryLines: undefined })).toBe('cards');
  });

  it('shippedRefundKey: cartas ⇒ la clave de hoy; accesorios ⇒ …Accessories; mixto ⇒ …Mixed', () => {
    expect(shippedRefundKey('warning', 'cards')).toBe('warning');
    expect(shippedRefundKey('body', 'accessories')).toBe('bodyAccessories');
    expect(shippedRefundKey('done', 'mixed')).toBe('doneMixed');
  });
});

describe.each(['es', 'en'] as const)('AC-UX.gates §3 · RefundOrderDialog enviado (%s)', (loc) => {
  it('solo accesorios ⇒ ⛔ «carta/card» en el diálogo y en el aviso de hecho; textos …Accessories; ayuda hintItem', async () => {
    const { dialogText, noticeText } = await refundFromDetail('accessories', loc);
    expect(dialogText).toContain(sh(loc).warningAccessories as string);
    expect(dialogText).toContain(sh(loc).bodyAccessories as string);
    expect(dialogText).toContain(sr(loc).hintItem.arrived_damaged);
    expect(dialogText).not.toMatch(CARD_WORD);
    expect(noticeText).toBe(fill(sh(loc).doneAccessories as string, 'TCG-008101', sr(loc).arrived_damaged));
    expect(noticeText).not.toMatch(CARD_WORD);
  });

  it('mixto ⇒ textos …Mixed (nombran accesorios), ayuda hintItem; aviso doneMixed', async () => {
    const { dialogText, noticeText } = await refundFromDetail('mixed', loc);
    const word = loc === 'es' ? 'accesorios' : 'accessories';
    expect(dialogText).toContain(sh(loc).warningMixed as string);
    expect(dialogText).toContain(sh(loc).bodyMixed as string);
    expect(dialogText).toContain(sr(loc).hintItem.arrived_damaged);
    expect(dialogText).toContain(word);
    expect(noticeText).toBe(fill(sh(loc).doneMixed as string, 'TCG-008101', sr(loc).arrived_damaged));
    expect(noticeText).toContain(word);
  });

  it('solo cartas ⇒ texto idéntico al de hoy (warning/body/hint/done)', async () => {
    const { dialogText, noticeText } = await refundFromDetail('cards', loc);
    expect(dialogText).toContain(sh(loc).warning as string);
    expect(dialogText).toContain(sh(loc).body as string);
    expect(dialogText).toContain(sr(loc).hint.arrived_damaged);
    expect(dialogText).not.toContain(sr(loc).hintItem.arrived_damaged);
    expect(dialogText).not.toMatch(/accesorio|accessor/i);
    expect(noticeText).toBe(fill(sh(loc).done as string, 'TCG-008101', sr(loc).arrived_damaged));
  });
});
