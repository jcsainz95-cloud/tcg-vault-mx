import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import es from '../../../../../../messages/es.json';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';
import type { AdminBuylistDTO, AdminInboundShipmentDTO, LabelOptionsDTO, SellRequestStatus } from '@/types/contract';
import { shipment } from '../m4/capture/sdx-test-fixtures';

/**
 * 💰 rev BSD-1 — M5 (DESIGN_SYSTEM §BSD-UX.6 · contrato §BSD.4–§BSD.6, BSD-1.1 C-8, BSD-1.3 punto 4).
 *
 * - **BSD-F1:** «Generar guía con Skydropx» solo en `aceptada` sin guía y con `inboundLabelOptions.provider='skydropx'`
 *   (del DETALLE); abre la ventana tras `POST …/inbound-shipment`.
 * - **UX-BSD-7 (BSD-F5):** «Declinar» oculto con `declineAcceptedAllowed:false` aunque `status='aceptada'`; motivo
 *   `"  ab "` ⇒ botón apagado con razón; `"abc"` ⇒ `POST {reason:'abc'}`; `5xx` ⇒ `GET` de relectura y **0** segundo `POST`.
 * - **UX-BSD-8 (BSD-F6, M5):** la marca la enciende SOLO `guideDueSoon`; el reloj de la pantalla no cambia nada.
 * - **UX-BSD-10:** el DOM de una `aceptada` no dice «ya no se cancela».
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

const TAB_LABELS = es.admin.m5.tabs as Record<string, string>;
const ID = 'sr-bsd';
const SDX: LabelOptionsDTO = { provider: 'skydropx', purchase: 'operators', canPurchase: true };
const OFF: LabelOptionsDTO = { provider: 'off', purchase: 'disabled', canPurchase: false };

function row(over: Partial<AdminBuylistDTO> = {}, status: SellRequestStatus = 'aceptada'): AdminBuylistDTO {
  return {
    ...srv({
      id: ID, userId: 'u-1', seller: { id: 'u-1', name: 'Vendedor', email: 'v@example.com' }, status,
      quotedTotalCents: 150_000, createdAt: '2026-09-01T00:00:00.000Z', receivedAt: null, verifiedAt: null,
      approvedTotalCents: null, offerSentAt: '2026-09-01T10:00:00.000Z', items: [],
    }),
    guideDueAt: null,
    guideDueSoon: false,
    guideDueInDays: null,
    declineAcceptedAllowed: status === 'aceptada',
    inboundShipment: null,
    ...over,
  };
}
function liveGuide(over: Partial<AdminInboundShipmentDTO> = {}): AdminInboundShipmentDTO {
  return {
    id: 'shp-in-1', folio: 'ENV-000099', status: 'guia', labelSource: 'skydropx', labelProcessing: false, carrier: 'Paquetexpress',
    trackingNumber: 'PQX123', trackingUrl: null, costCents: 25_000, costIvaCents: 3_448, insuranceCostCents: 1_000,
    providerCanceledAt: null, cancelConfirmed: false, labelAlert: null, ...over,
  };
}

async function render(r: AdminBuylistDTO, options: LabelOptionsDTO = SDX) {
  const list = vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [r], page: 1, pageSize: 25, total: 1 });
  const detail = vi.spyOn(api, 'getAdminBuylistRequest').mockResolvedValue({ ...r, inboundLabelOptions: options });
  renderWithProviders(<M5View />, 'es');
  fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${TAB_LABELS.con_vendedor}`) }));
  await screen.findByText(ID);
  return { list, detail };
}
const card = () => screen.getByTestId(`m5-request-${ID}`);

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

describe('BSD-F1 · «Generar guía con Skydropx»', () => {
  it('aceptada sin guía + provider skydropx (del DETALLE) ⇒ botón; el clic abre la fila de entrada y la ventana', async () => {
    const openSpy = vi.spyOn(api, 'openBuylistInboundShipment').mockResolvedValue({
      created: true,
      shipment: shipment({ id: 'shp-in-1', kind: 'buylist_inbound', status: 'solicitado', folio: 'ENV-000099' }),
    });
    vi.spyOn(api, 'getAdminShipment').mockResolvedValue(
      shipment({ id: 'shp-in-1', kind: 'buylist_inbound', status: 'solicitado', inbound: { sellRequestId: ID, sellerName: 'Vendedor', offerShippingFeeCents: 18000, offerGrossCents: 150000, destination: { name: 'TCG', street1: 'x', postalCode: '14210', state: 'CDMX', city: 'Tlalpan', neighborhood: 'y' } } }),
    );
    await render(row());
    const btn = await within(card()).findByRole('button', { name: 'Generar guía con Skydropx' });
    fireEvent.click(btn);
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(ID));
    expect(await screen.findByRole('dialog', { name: 'Guía del vendedor a la tienda' })).toBeInTheDocument();
  });

  it("provider 'off' ⇒ sin botón (la captura a mano sigue)", async () => {
    await render(row(), OFF);
    await waitFor(() => expect(within(card()).getByTestId('shipment-actions')).toBeInTheDocument());
    expect(within(card()).queryByRole('button', { name: 'Generar guía con Skydropx' })).toBeNull();
    expect(within(card()).getByLabelText('Número de guía')).toBeInTheDocument();
  });

  it('guía manual ya capturada ⇒ sin botón', async () => {
    await render(row({ shipmentCarrier: 'DHL', shipmentTrackingNumber: 'DHL1', guideSentAt: '2026-10-01T00:00:00.000Z' }));
    await waitFor(() => expect(within(card()).getByTestId('shipment-actions')).toBeInTheDocument());
    expect(within(card()).queryByRole('button', { name: 'Generar guía con Skydropx' })).toBeNull();
  });

  it('`en_transito` ⇒ ni botón ni «Declinar» (la ficha de aceptada no existe)', async () => {
    await render(row({ declineAcceptedAllowed: false }, 'en_transito'));
    expect(screen.queryByTestId(`m5-accepted-panel-${ID}`)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generar guía con Skydropx' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Declinar' })).toBeNull();
  });

  it('`404 FEATURE_DISABLED` ⇒ su frase y el botón desaparece', async () => {
    vi.spyOn(api, 'openBuylistInboundShipment').mockRejectedValue(new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'x' }));
    await render(row());
    fireEvent.click(await within(card()).findByRole('button', { name: 'Generar guía con Skydropx' }));
    expect(await within(card()).findByText('La compra de guías con Skydropx está apagada. No se abrió nada: captura la guía a mano.')).toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: 'Generar guía con Skydropx' })).toBeNull();
  });

  it('`422 PICKUP_ADDRESS_MISSING` ⇒ manda a capturar a mano', async () => {
    vi.spyOn(api, 'openBuylistInboundShipment').mockRejectedValue(new ApiClientError(422, { code: 'PICKUP_ADDRESS_MISSING', message: 'x' }));
    await render(row());
    fireEvent.click(await within(card()).findByRole('button', { name: 'Generar guía con Skydropx' }));
    expect(await within(card()).findByText(/Esta solicitud no guardó la dirección del vendedor/)).toBeInTheDocument();
  });

  it('guía de Skydropx viva ⇒ resumen, costo tal cual, «Descargar PDF», sin captura a mano y sin campo de costo', async () => {
    await render(row({ inboundShipment: liveGuide(), shipmentCarrier: 'Paquetexpress', shipmentTrackingNumber: 'PQX123' }));
    const live = await within(card()).findByTestId('m5-inbound-live');
    expect(live).toHaveTextContent('Guía de Skydropx: Paquetexpress · PQX123');
    expect(live).toHaveTextContent('Costo de la guía: MX$250.00');
    expect(within(live).getByRole('button', { name: 'Descargar PDF' })).toBeInTheDocument();
    expect(within(live).getByRole('button', { name: 'Cancelar guía y comprar otra' })).toBeInTheDocument();
    expect(within(card()).queryByLabelText('Número de guía')).toBeNull();
    expect(within(card()).getByTestId('m5-cost-from-provider')).toHaveTextContent('El costo de esta guía lo dio Skydropx (MX$250.00): no se captura aquí.');
    expect(within(card()).queryByRole('button', { name: 'Generar guía con Skydropx' })).toBeNull();
  });

  it('guía de entrada con alerta (BSD-1.3 punto 4) ⇒ la alerta de M4 y «Abrir guía»', async () => {
    await render(
      row({ inboundShipment: liveGuide({ status: 'cancelado', providerCanceledAt: '2026-10-05T10:00:00.000Z', labelAlert: { kind: 'label_cancel_failed', since: '2026-10-05T10:00:00.000Z', canRelease: false } }) }),
    );
    expect(await within(card()).findByTestId(`m5-inbound-alert-${ID}`)).toHaveTextContent('Cancelación sin confirmar');
    expect(within(card()).getByRole('button', { name: 'Abrir la ventana de la guía' })).toBeInTheDocument();
  });
});

describe('UX-BSD-7 (BSD-F5) · «Declinar» en «Aceptada»', () => {
  it('oculto con `declineAcceptedAllowed:false` aunque `status=aceptada`; visible con `true`', async () => {
    await render(row({ declineAcceptedAllowed: false }));
    await waitFor(() => expect(within(card()).getByTestId('shipment-actions')).toBeInTheDocument());
    expect(within(card()).queryByRole('button', { name: 'Declinar' })).toBeNull();
  });

  it('motivo `"  ab "` ⇒ apagado con su razón unida; `"abc"` ⇒ `POST {reason:"abc"}`, aviso de página', async () => {
    const post = vi.spyOn(api, 'declineAcceptedBuylistRequest').mockResolvedValue(row({}, 'expirada'));
    await render(row());
    fireEvent.click(await within(card()).findByRole('button', { name: 'Declinar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Declinar esta solicitud aceptada' });
    expect(dialog).toHaveTextContent('Se cierra la solicitud y al vendedor le llega el correo de «no continuamos»');
    const reason = within(dialog).getByLabelText('Motivo (interno, obligatorio)');
    await waitFor(() => expect(reason).toHaveFocus());
    expect(reason).toHaveAttribute('aria-required', 'true');
    fireEvent.change(reason, { target: { value: '  ab ' } });
    const confirm = within(dialog).getByTestId('m5-decline-accepted-confirm');
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAccessibleDescription('Escribe el motivo (3 caracteres o más) para poder declinar.');
    fireEvent.change(reason, { target: { value: 'abc' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledWith(ID, { reason: 'abc' }));
    expect(await screen.findByTestId('m5-page-notice')).toHaveTextContent(
      `Solicitud ${ID} declinada: quedó cerrada y al vendedor le llega el correo de «no continuamos».`,
    );
  });

  it('`5xx` ⇒ RELEE (`GET /admin/buylist/:id`) y **0** segundo `POST`; sigue aceptada ⇒ «No se declinó…»', async () => {
    const post = vi.spyOn(api, 'declineAcceptedBuylistRequest').mockRejectedValue(new ApiClientError(503, { code: 'INTERNAL', message: 'x' }));
    const { detail } = await render(row());
    fireEvent.click(await within(card()).findByRole('button', { name: 'Declinar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Declinar esta solicitud aceptada' });
    fireEvent.change(within(dialog).getByLabelText('Motivo (interno, obligatorio)'), { target: { value: 'ya no la queremos' } });
    const before = detail.mock.calls.length;
    fireEvent.click(within(dialog).getByTestId('m5-decline-accepted-confirm'));
    expect(await within(dialog).findByText('No se declinó: el servidor no respondió. Vuelve a intentarlo.')).toBeInTheDocument();
    expect(detail.mock.calls.length).toBeGreaterThan(before);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('`5xx` y la relectura dice `expirada` ⇒ «declinada» (no se vuelve a pedir)', async () => {
    const post = vi.spyOn(api, 'declineAcceptedBuylistRequest').mockRejectedValue(new TypeError('Failed to fetch'));
    const { detail } = await render(row());
    fireEvent.click(await within(card()).findByRole('button', { name: 'Declinar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Declinar esta solicitud aceptada' });
    fireEvent.change(within(dialog).getByLabelText('Motivo (interno, obligatorio)'), { target: { value: 'ya no la queremos' } });
    detail.mockResolvedValue({ ...row({ expiredReason: 'not_continued' }, 'expirada') });
    fireEvent.click(within(dialog).getByTestId('m5-decline-accepted-confirm'));
    expect(await screen.findByTestId('m5-page-notice')).toHaveTextContent(`Solicitud ${ID} declinada`);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("`409 DECLINE_NOT_ALLOWED {reason:'seller_declared_shipped'}` ⇒ cierra y avisa en `warning` sobre la ficha", async () => {
    vi.spyOn(api, 'declineAcceptedBuylistRequest').mockRejectedValue(
      new ApiClientError(409, { code: 'DECLINE_NOT_ALLOWED', message: 'x', details: { status: 'aceptada', reason: 'seller_declared_shipped' } }),
    );
    await render(row());
    fireEvent.click(await within(card()).findByRole('button', { name: 'Declinar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Declinar esta solicitud aceptada' });
    fireEvent.change(within(dialog).getByLabelText('Motivo (interno, obligatorio)'), { target: { value: 'ya no' } });
    fireEvent.click(within(dialog).getByTestId('m5-decline-accepted-confirm'));
    expect(
      await within(card()).findByText('El vendedor ya dijo que mandó el paquete: ya no se declina. Recíbelo y, si hace falta, rechaza las cartas al revisarlas.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Declinar esta solicitud aceptada' })).toBeNull();
  });

  it('una sola línea de guía en el cuerpo: Skydropx viva ⇒ `bodySdx` (sin cifra de costo)', async () => {
    await render(row({ inboundShipment: liveGuide(), shipmentCarrier: 'Paquetexpress', shipmentTrackingNumber: 'PQX123' }));
    fireEvent.click(await within(card()).findByRole('button', { name: 'Declinar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Declinar esta solicitud aceptada' });
    expect(within(dialog).getByTestId('m5-decline-accepted-guide')).toHaveTextContent('Su guía de Skydropx (Paquetexpress · PQX123) se cancela sola');
    expect(dialog.textContent).not.toMatch(/MX\$/);
  });
});

describe('UX-BSD-8 (BSD-F6, M5) · la marca «se cierra sola» la decide el servidor', () => {
  it('`guideDueSoon:true` ⇒ versalita (con «en N días» de C-8) y nota; la fecha del servidor tal cual', async () => {
    await render(row({ guideDueAt: '2026-10-12T14:00:00.000Z', guideDueSoon: true, guideDueInDays: 2 }));
    expect(await within(card()).findByTestId('m5-guide-due-tag')).toHaveTextContent('Se cierra sola · en 2 días');
    expect(within(card()).getByTestId('m5-guide-due-note')).toHaveTextContent('Al cerrarse, al vendedor le llega el correo de «no continuamos»');
    expect(within(card()).getByTestId('m5-guide-due-line')).toHaveTextContent(/^Sin guía: se cierra sola el .+ si para entonces no tiene guía\.$/);
  });

  it('`guideDueSoon:false` con `guideDueAt` ⇒ solo la línea neutra; mover el reloj 30 días no enciende nada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T00:00:00.000Z')); // MUY después de `guideDueAt`
    await render(row({ guideDueAt: '2026-10-12T14:00:00.000Z', guideDueSoon: false, guideDueInDays: null }));
    expect(await within(card()).findByTestId('m5-guide-due-line')).toBeInTheDocument();
    expect(within(card()).queryByTestId('m5-guide-due-tag')).toBeNull();
    expect(within(card()).queryByTestId('m5-guide-due-note')).toBeNull();
  });

  it('`guideDueSoon:true` con el reloj ANTES de la ventana de aviso ⇒ la marca sale igual; sin `guideDueInDays` no hay «en N días»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    await render(row({ guideDueAt: '2026-10-12T14:00:00.000Z', guideDueSoon: true, guideDueInDays: null }));
    const tag = await within(card()).findByTestId('m5-guide-due-tag');
    expect(tag).toHaveTextContent(/^Se cierra sola$/);
  });

  it('sin `guideDueAt` ⇒ nada', async () => {
    await render(row());
    await waitFor(() => expect(within(card()).getByTestId('shipment-actions')).toBeInTheDocument());
    expect(within(card()).queryByTestId('m5-guide-due')).toBeNull();
  });
});

describe('BSD-1.3 punto 4 · filtro «solo con alerta en su guía de entrada»', () => {
  it('marcarlo pide `?inboundLabelAlert=true`; sin marcar, la petición de siempre', async () => {
    const { list } = await render(row());
    expect(list).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Solo solicitudes con alerta en su guía' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ inboundLabelAlert: true }));
  });
});

describe('UX-BSD-10 · la ficha `aceptada` ya no dice «ya no se cancela»', () => {
  it('ni en la nota corta ni en ningún otro sitio del DOM', async () => {
    await render(row());
    await waitFor(() => expect(within(card()).getByTestId('shipment-actions')).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/ya no se cancela|can no longer be cancelled/);
  });
});
