import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { renderWithProviders, renderWithIntl } from '@/test/render';
import es from '../../../../../../messages/es.json';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';
import type { AdminBuylistDTO } from '@/types/contract';
import { M5View } from './M5View';
import { GuideDueTag } from './GuideDueMark';
import { sdxErrorView } from '../m4/capture/sdx-errors';

/**
 * ✏ vBSD-1.1 — **UX-BSD-17** (DESIGN_SYSTEM §BSD-UX.9; BSD-F6, §BSD.10):
 *  (a) `guideDueInDays` 0 ⇒ «en cualquier momento», 1 ⇒ «en menos de 24 h», 3 ⇒ «en 3 días», `null` ⇒ ningún « · »;
 *  (b) `GUIDE_NOT_ALLOWED {status:'aceptada', reason:'shipment_confirmed'}` ⇒ `shipmentConfirmed`, ⛔ «ya no está aceptada»;
 *  (c) re-emitir en entrada con `outcome:'cancelled'` ⇒ `Banner` con `reissueDone` (⛔ «preparado»).
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.restoreAllMocks());

describe('UX-BSD-17 (a) · «en N días» es un techo del servidor', () => {
  it.each([
    [0, 'Se cierra sola · en cualquier momento'],
    [1, 'Se cierra sola · en menos de 24 h'],
    [3, 'Se cierra sola · en 3 días'],
  ])('guideDueInDays %s ⇒ «%s»', (n, text) => {
    renderWithIntl(<GuideDueTag req={{ guideDueAt: '2026-10-12T14:00:00.000Z', guideDueSoon: true, guideDueInDays: n }} />);
    expect(screen.getByTestId('m5-guide-due-tag')).toHaveTextContent(text);
    expect(screen.getByTestId('m5-guide-due-tag').textContent).not.toMatch(/hoy|en 1 día/);
  });
  it('`null` ⇒ ningún « · »', () => {
    renderWithIntl(<GuideDueTag req={{ guideDueAt: '2026-10-12T14:00:00.000Z', guideDueSoon: true, guideDueInDays: null }} />);
    expect(screen.getByTestId('m5-guide-due-tag').textContent).not.toContain('·');
  });
});

describe('UX-BSD-17 (b) · `GUIDE_NOT_ALLOWED` por motivo', () => {
  const t = createTranslator({ locale: 'es', messages: es, namespace: 'admin.m4.tracking.sdx' }) as unknown as Parameters<typeof sdxErrorView>[1];
  const ctx = { op: 'quote' as const, isSuperAdmin: false, money: String, statusLabel: String, inbound: true, sellStatusLabel: () => 'Aceptada' };
  it("`shipment_confirmed` ⇒ `shipmentConfirmed`, ⛔ «ya no está aceptada»", () => {
    const v = sdxErrorView(new ApiClientError(409, { code: 'GUIDE_NOT_ALLOWED', message: 'x', details: { status: 'aceptada', reason: 'shipment_confirmed' } }), t, ctx);
    expect(v.text).toBe(
      'El envío de esta solicitud ya está confirmado: ya no se genera guía. No se abrió ni se cobró nada. Cuando llegue el paquete, recíbelo y revisa las cartas.',
    );
    expect(v.text).not.toMatch(/ya no está aceptada/);
  });
  it.each(['status', 'closed', undefined])('`%s` ⇒ `notAccepted` (red de seguridad)', (reason) => {
    const v = sdxErrorView(new ApiClientError(409, { code: 'GUIDE_NOT_ALLOWED', message: 'x', details: { status: 'expirada', reason } }), t, ctx);
    expect(v.text).toMatch(/^Esta solicitud ya no está aceptada/);
  });
});

describe('UX-BSD-17 (c) · tras re-emitir la guía de entrada, la frase propia', () => {
  it("`outcome:'cancelled'` ⇒ aviso de éxito con `reissueDone` (⛔ «preparado»)", async () => {
    const r: AdminBuylistDTO = {
      ...srv({
        id: 'sr-17', userId: 'u-1', seller: { id: 'u-1', name: 'V', email: 'v@example.com' }, status: 'aceptada',
        quotedTotalCents: 1, createdAt: '2026-09-01T00:00:00.000Z', receivedAt: null, verifiedAt: null, approvedTotalCents: null,
        offerSentAt: '2026-09-01T10:00:00.000Z', items: [],
      }),
      declineAcceptedAllowed: true,
      shipmentCarrier: 'Paquetexpress',
      shipmentTrackingNumber: 'PQX1',
      inboundShipment: {
        id: 'shp-in-17', folio: 'ENV-1', status: 'guia', labelSource: 'skydropx', labelProcessing: false, carrier: 'Paquetexpress',
        trackingNumber: 'PQX1', trackingUrl: null, costCents: 1, costIvaCents: 0, insuranceCostCents: 0, providerCanceledAt: null,
        cancelConfirmed: false, labelAlert: null,
      },
    };
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [r], page: 1, pageSize: 25, total: 1 });
    vi.spyOn(api, 'getAdminBuylistRequest').mockResolvedValue({ ...r, inboundLabelOptions: { provider: 'skydropx', purchase: 'operators', canPurchase: true } });
    const cancel = vi.spyOn(api, 'cancelShipmentLabel').mockResolvedValue({ outcome: 'cancelled', shipment: {} as never });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: /^Con el vendedor/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar guía y comprar otra' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'la paquetería no recoge' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar guía' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    const notice = await screen.findByTestId('m5-page-notice');
    expect(notice).toHaveTextContent(
      'Guía cancelada. La solicitud sr-17 volvió a «sin guía» y la cuenta para su cierre automático empieza de nuevo hoy.',
    );
    expect(notice.textContent).not.toMatch(/preparado/);
  });
});
