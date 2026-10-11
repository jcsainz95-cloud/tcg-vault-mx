import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';
import type { AdminBuylistDTO } from '@/types/contract';
import { AcceptedRequestPanel } from './AcceptedRequestPanel';

/**
 * Gate de QA sobre `b6acea1e`:
 *  - **C-1:** tras comprar la guía de entrada, el aviso de M5 pintaba la CLAVE cruda `admin.m5.inbound.bought` (el texto
 *    vive en `admin.m4.tracking.sdx.inbound.bought`). Se renderiza el panel con los MENSAJES REALES (`renderWithProviders`
 *    carga `messages/*.json`) y la ventana sustituida por un doble que llama a `onSaved({kind:'skydropx'})`.
 *  - **M-4:** si falla `GET /admin/buylist/:id`, «Generar guía» no puede ofrecerse ⇒ el panel lo dice con el error de
 *    siempre y «Reintentar» (⛔ que el botón desaparezca mudo).
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
vi.mock('../m4/CaptureLabelDialog', () => ({
  CaptureLabelDialog: ({ target, onSaved }: { target: { ref: string } | null; onSaved: (s: unknown) => void }) =>
    target ? (
      <button type="button" onClick={() => onSaved({ kind: 'skydropx', ref: target.ref, carrier: 'Paquetexpress', number: 'PQX123' })}>
        doble: guía comprada
      </button>
    ) : null,
}));

const ID = 'sr-qa1';
function row(): AdminBuylistDTO {
  return {
    ...srv({
      id: ID, userId: 'u-1', seller: { id: 'u-1', name: 'V', email: 'v@example.com' }, status: 'aceptada', quotedTotalCents: 1,
      createdAt: '2026-09-01T00:00:00.000Z', receivedAt: null, verifiedAt: null, approvedTotalCents: null,
      offerSentAt: '2026-09-01T10:00:00.000Z', items: [],
    }),
    declineAcceptedAllowed: true,
    inboundShipment: null,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('C-1 · el aviso tras comprar la guía de entrada es TEXTO, no una clave', () => {
  it('«Guía comprada para la solicitud …: Paquetexpress · PQX123. Le mandamos su guía al vendedor.»', async () => {
    vi.spyOn(api, 'getAdminBuylistRequest').mockResolvedValue({ ...row(), inboundLabelOptions: { provider: 'skydropx', purchase: 'operators', canPurchase: true } });
    vi.spyOn(api, 'openBuylistInboundShipment').mockResolvedValue({ created: true, shipment: { id: 'shp-1', status: 'solicitado', folio: 'ENV-1' } as never });
    const onNotice = vi.fn();
    renderWithProviders(<AcceptedRequestPanel req={row()} onNotice={onNotice} />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Generar guía con Skydropx' }));
    fireEvent.click(await screen.findByRole('button', { name: 'doble: guía comprada' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
    const text = onNotice.mock.calls[0][0].text as string;
    expect(text).toBe(`Guía comprada para la solicitud ${ID}: Paquetexpress · PQX123. Le mandamos su guía al vendedor.`);
    expect(text).not.toMatch(/admin\.|inbound\./);
  });
});

describe('M-4 · sin el detalle, el panel lo dice y deja reintentar', () => {
  it('`GET /admin/buylist/:id` falla ⇒ aviso con «Reintentar»; reintentar con éxito ⇒ vuelve «Generar guía»', async () => {
    const detail = vi.spyOn(api, 'getAdminBuylistRequest').mockRejectedValueOnce(new ApiClientError(503, { code: 'INTERNAL', message: 'x' }));
    renderWithProviders(<AcceptedRequestPanel req={row()} onNotice={vi.fn()} />, 'es');
    const box = await screen.findByTestId(`m5-accepted-detail-error-${ID}`);
    expect(box.querySelector('[role="alert"]')).not.toBeNull();
    expect(box.textContent).not.toMatch(/admin\.|common\./);
    expect(screen.queryByRole('button', { name: 'Generar guía con Skydropx' })).toBeNull();
    detail.mockResolvedValue({ ...row(), inboundLabelOptions: { provider: 'skydropx', purchase: 'operators', canPurchase: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Generar guía con Skydropx' })).toBeInTheDocument();
    expect(screen.queryByTestId(`m5-accepted-detail-error-${ID}`)).toBeNull();
  });
});
