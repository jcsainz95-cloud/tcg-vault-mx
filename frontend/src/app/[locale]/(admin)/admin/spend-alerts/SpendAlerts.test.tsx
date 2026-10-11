import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockDashboard } from '@/lib/mock/fixtures';
import type { DashboardDTO, PickingListSummaryDTO, SpendAlertDTO, SpendAlertSummaryDTO, SpendControlDTO } from '@/types/contract';
import { SpendAlertsView } from './SpendAlertsView';
import { SpendAlertDetailView } from './[id]/SpendAlertDetailView';
import { AdminDashboard } from '../AdminDashboard';
import { AdminSidebar } from '@/components/layout/AdminSidebar';

/**
 * Candados de «Avisos de gasto» del diseño **v4.20** (`DESIGN_SYSTEM §43.19.15`: UX-GAS-1, 2, 3, 5, 6) y la parte de
 * PS-152/PS-158/PS-164 de pantalla (`API_CONTRACT §M4-SHIP.19.29.9`, `§19.30`), con la API espiada (equivalente a MSW:
 * `modules/spend-alerts/` aún se construye). Canarios en `docs/FRONTEND_NOTES.md` §92.
 */

const role = vi.hoisted(() => ({ superAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: role.superAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: role.superAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = true;
  window.history.replaceState(null, '', '/es/admin/spend-alerts');
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const ANA = { userId: 'u-op1', name: 'Ana' };
/** Canarios de PII del cliente que un servidor equivocado podría colar en `facts` (UX-GAS-6). */
const PII = { recipientName: 'CANARIO', phone: '5559998877', email: 'canario@cliente.test', clabe: '012180001234567891' };

function a(over: Partial<SpendAlertDTO> & Pick<SpendAlertDTO, 'id' | 'code' | 'kind'>): SpendAlertDTO {
  return {
    severity: 'immediate',
    subject: null,
    shipment: { id: 'shp-1', folio: 'ENV-000045', kind: 'guest_direct_ship' },
    order: { id: 'ord-1', orderNumber: 'TCG-000123' },
    amountCents: 15000,
    occurrenceCount: 1,
    firstOccurredAt: '2026-10-04T15:00:00Z',
    lastOccurredAt: '2026-10-04T15:00:00Z',
    resolvedAt: null,
    seen: null,
    mail: { status: 'sent', at: '2026-10-04T15:01:00Z' },
    ...over,
    facts: { ...PII, ...(over.facts ?? {}) },
  };
}

/** Los trece tipos, con la frase que su `facts` debe producir (§43.19.11). */
const THIRTEEN: [SpendAlertDTO, string][] = [
  [a({ id: 'a1', code: 'AG-1', kind: 'label_after_address_fix', subject: ANA, facts: { changedKeys: ['line1', 'postalCode'], carrierName: '99minutos', chargedCents: 14850 } }), 'Ana corrigió la dirección del pedido TCG-000123 (calle y número y CP) y compró su guía: 99minutos, MX$148.50.'],
  [a({ id: 'a2', code: 'AG-2', kind: 'label_cap_warning', severity: 'digest', subject: ANA, facts: { usedCents: 200000, capCents: 250000, pct: 80 } }), 'Ana lleva MX$2,000.00 en guías en las últimas 24 horas: el 80 % de su tope de MX$2,500.00.'],
  [a({ id: 'a3', code: 'AG-3', kind: 'label_cap_blocked', subject: ANA, facts: { priceCents: 15000, usedCents: 240000, capCents: 250000 } }), 'A Ana se le negó la guía del pedido TCG-000123 (MX$150.00): con ella pasaba su tope de MX$2,500.00 en 24 horas (llevaba MX$2,400.00). Puedes comprarla tú o subir su tope.'],
  [a({ id: 'a4', code: 'AG-4', kind: 'label_reissue_loop', subject: ANA, facts: { cancelledCount: 2, unrecoveredCents: 3000, unknownRefunds: 1, actors: ['Ana', 'Luis'], triggers: ['shipment_cancels'] } }), 'Van 2 guías canceladas en el pedido TCG-000123 (Ana y Luis). Saldo no recuperado: MX$30.00; sin cifra de reembolso en 1.'],
  [a({ id: 'a5', code: 'AG-5', kind: 'label_charge_drift', facts: { quotedCents: 14850, chargedCents: 15350, diffCents: 777 } }), 'La guía del pedido TCG-000123 se cobró en MX$153.50; se cotizó en MX$148.50 (+MX$7.77).'],
  [a({ id: 'a6', code: 'AG-6', kind: 'carrier_extra_charge', facts: { kind: 'overweight', carrierName: 'FedEx', amountCents: 16000 } }), 'Cargo extra de FedEx en el pedido TCG-000123: sobrepeso, MX$160.00.'],
  [a({ id: 'a7', code: 'AG-7', kind: 'provider_balance_low', order: null, shipment: null, facts: { balanceCents: 96516, thresholdCents: 100000 } }), 'Tu saldo de Skydropx bajó a MX$965.16 (avisamos debajo de MX$1,000.00). Recarga en el panel de Skydropx.'],
  [a({ id: 'a8', code: 'AG-8', kind: 'cancel_refund_missing', facts: { chargedCents: 14850, refundedCents: null, unrefundedCents: null, cancelKind: 'reissue' } }), 'Se canceló la guía del pedido TCG-000123 y Skydropx no dijo cuánto devolvió; no podemos confirmar que regresaran MX$148.50. Revísalo en tu panel de Skydropx.'],
  [a({ id: 'a9', code: 'AG-9', kind: 'label_charged_unexplained', facts: { cause: 'charged_not_found', expectedChargeCents: 14850, providerReference: 'ENV-000045-01' } }), 'Skydropx descontó MX$148.50 por la guía del pedido TCG-000123 y no encontramos la guía. Búscala en tu panel de Skydropx como «Pedido ENV-000045-01».'],
  [a({ id: 'a10', code: 'AG-10', kind: 'label_not_shipped', severity: 'digest', order: null, shipment: { id: 's', folio: 'ENV-000047', kind: 'vault_withdrawal' }, facts: { daysSincePurchase: 3, chargedCents: 14850, carrierName: '99minutos' } }), 'La guía del envío ENV-000047 (99minutos, MX$148.50) se compró hace 3 días y el paquete no ha salido. Si ya no va a salir, cancélala para recuperar el saldo.'],
  [a({ id: 'a11', code: 'AG-11', kind: 'parcel_returned', facts: { status: 'destroyed', carrierName: 'FedEx', chargedCents: 14850 } }), 'El paquete del pedido TCG-000123 (FedEx) fue destruido por la paquetería. La guía costó MX$148.50.'],
  [a({ id: 'a12', code: 'AG-12', kind: 'parcel_problem', severity: 'digest', facts: { status: 'retained', carrierName: 'FedEx' } }), 'FedEx reporta el paquete retenido en el pedido TCG-000123.'],
  [a({ id: 'a13', code: 'AG-13', kind: 'label_costly_choice', severity: 'digest', subject: ANA, facts: { marginCents: -1200, priceCents: 20300, recommendedPriceCents: 18000, overRecommendedCents: 2300 } }), 'Ana compró la guía del pedido TCG-000123 con margen negativo (−MX$12.00) y MX$23.00 por encima de la recomendada (MX$203.00 contra MX$180.00).'],
];

function serveList(rows: SpendAlertDTO[], total = rows.length) {
  return vi.spyOn(api, 'listSpendAlerts').mockResolvedValue({ data: rows, page: 1, pageSize: 25, total });
}

describe('UX-GAS-6 (GAS-2) · los trece textos, ⛔ ningún dato del cliente aunque el servidor lo cuele en `facts`', () => {
  it('lista: cada frase de §43.19.11 y cero canarios', async () => {
    serveList(THIRTEEN.map(([x]) => x));
    renderWithProviders(<SpendAlertsView />, 'es');
    const table = await screen.findByTestId('spend-alerts-table');
    for (const [x, text] of THIRTEEN) expect(within(screen.getByTestId(`spend-alert-row-${x.id}`)).getByText(text)).toBeInTheDocument();
    for (const v of Object.values(PII)) expect(document.body.textContent, v).not.toContain(v);
    expect(table).toBeInTheDocument();
  });
  it.each(THIRTEEN.map(([x, text]) => [x.code, x, text] as const))('detalle %s: su frase, la `<dl>` en lista blanca y cero canarios', async (_c, x, text) => {
    vi.spyOn(api, 'getSpendAlert').mockResolvedValue(x);
    renderWithProviders(<SpendAlertDetailView id={x.id} />, 'es');
    expect(await screen.findByText(text)).toBeInTheDocument();
    for (const v of Object.values(PII)) expect(document.body.textContent, v).not.toContain(v);
  });
  it('AG-4 con `triggers ∋ reissue_denied` dice que se negó la guía; AG-6 con un `kind` sin rótulo ⇒ «otro cargo»', async () => {
    serveList([
      a({ id: 'd4', code: 'AG-4', kind: 'label_reissue_loop', subject: ANA, facts: { cancelledCount: 2, unrecoveredCents: 0, unknownRefunds: 0, actors: ['Ana'], triggers: ['reissue_denied', 'shipment_cancels'] } }),
      a({ id: 'd6', code: 'AG-6', kind: 'carrier_extra_charge', facts: { kind: 'zz_nuevo', carrierName: 'FedEx', amountCents: 100 } }),
    ]);
    renderWithProviders(<SpendAlertsView />, 'es');
    const table = await screen.findByTestId('spend-alerts-table');
    expect(within(table).getByText(/^Se negó una guía más para el pedido TCG-000123: ya había usado todas sus recompras\./)).toBeInTheDocument();
    expect(within(table).getByText('Cargo extra de FedEx en el pedido TCG-000123: otro cargo, MX$1.00.')).toBeInTheDocument();
  });
});

describe('UX-GAS-5 (GAS-4) · cada cifra tal cual llegó: la pantalla no suma ni resta', () => {
  it('AG-5 pinta `diffCents` aunque no sea cobrado − cotizado (arriba: +MX$7.77, no +MX$5.00)', async () => {
    serveList([THIRTEEN[4][0]]);
    renderWithProviders(<SpendAlertsView />, 'es');
    expect(within(await screen.findByTestId('spend-alerts-table')).getByText(/\(\+MX\$7\.77\)\.$/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('+MX$5.00');
  });
  it('el resumen del día pinta sus filas tal cual, aunque no cuadren con nada', async () => {
    serveList([]);
    const SUMMARY: SpendAlertSummaryDTO = {
      from: '2026-10-03',
      to: '2026-10-03',
      byKind: [
        { code: 'AG-1', immediate: 2, digest: 1, amountCents: 99901 },
        { code: 'AG-13', immediate: 0, digest: 3, amountCents: 7 },
      ],
      labelSpendByPerson: [{ userId: 'u-op1', name: 'Ana', cents: 123456, labels: 3 }],
      costlyChoices: { count: 5, overRecommendedCents: 4321, byPerson: [{ userId: 'u-op1', name: 'Ana', count: 2 }, { userId: 'u-op2', name: 'Luis', count: 1 }] },
    };
    const sum = vi.spyOn(api, 'getSpendAlertSummary').mockResolvedValue(SUMMARY);
    renderWithProviders(<SpendAlertsView />, 'es');
    const details = await screen.findByTestId('spend-alerts-summary');
    fireEvent.click(within(details).getByText('Resumen de un día'));
    (details as HTMLDetailsElement).open = true;
    fireEvent(details, new Event('toggle'));
    const table = await screen.findByTestId('spend-summary-by-kind');
    expect(sum).toHaveBeenCalled();
    expect(table).toHaveTextContent('MX$999.01');
    expect(table).toHaveTextContent('MX$0.07');
    expect(screen.getByTestId('spend-summary-people')).toHaveTextContent('Ana: MX$1,234.56 en 3 guías');
    // count 5 con byPerson que suma 3: se pinta 5 (⛔ no se recalcula).
    expect(screen.getByTestId('spend-summary-costly')).toHaveTextContent('5 guías por encima de la recomendada o con margen negativo: MX$43.21 de más (Ana 2, Luis 1)');
    expect(screen.getByText('Es lo mismo que dice el correo del resumen de ese día.')).toBeInTheDocument();
  });
});

describe('UX-GAS-2 · filtros en la URL, «Marcar como vistos», ⛔ sin borrar ni «no visto»', () => {
  it('cada filtro escribe su parámetro en la URL y pide `GET …/spend-alerts` con él', async () => {
    const list = serveList(THIRTEEN.slice(0, 3).map(([x]) => x));
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'label_cap_blocked' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'label_cap_blocked' })));
    expect(window.location.search).toContain('kind=label_cap_blocked');
    fireEvent.change(screen.getByLabelText('Gravedad'), { target: { value: 'immediate' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'label_cap_blocked', severity: 'immediate' })));
    expect(window.location.search).toContain('severity=immediate');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-04' } });
    fireEvent.click(screen.getByLabelText('Solo sin ver'));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01', to: '2026-10-04', unseen: true })),
    );
    expect(window.location.search).toContain('from=2026-10-01');
    expect(window.location.search).toContain('to=2026-10-04');
    expect(window.location.search).toContain('unseen=true');
    // Pulsar el nombre de una persona filtra por ella y pone su chip.
    fireEvent.click(within(screen.getByTestId('spend-alerts-table')).getAllByRole('button', { name: 'Ver solo los avisos de Ana' })[0]);
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ subjectUserId: 'u-op1' })));
    expect(window.location.search).toContain('subjectUserId=u-op1');
    expect(screen.getByTestId('spend-alerts-subject-chip')).toHaveTextContent('Solo de Ana');
    fireEvent.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]);
    await waitFor(() => expect(window.location.search).toBe(''));
  });
  it('arranca con los filtros que trae la URL (al volver del detalle)', async () => {
    const list = serveList([]);
    renderWithProviders(<SpendAlertsView initial={{ severity: 'digest', unseen: true }} />, 'es');
    await screen.findByText('Ningún aviso con estos filtros.');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ severity: 'digest', unseen: true }));
  });
  it('«Marcar como vistos (2)» manda `{ids:[a,b]}` y las dos filas SIGUEN con «Visto por…»; cero «Borrar» / «no visto»', async () => {
    const r1 = THIRTEEN[0][0];
    const r2 = THIRTEEN[2][0];
    const list = serveList([r1, r2]);
    const seen = vi.spyOn(api, 'markSpendAlertsSeen').mockResolvedValue({ updated: 2, skipped: 0 });
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    const table = screen.getByTestId('spend-alerts-table');
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Seleccionar aviso AG-1' }));
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Seleccionar aviso AG-3' }));
    const by = { at: '2026-10-04T16:00:00Z', by: { userId: 'u-sa1', name: 'Dueño' } };
    list.mockResolvedValue({ data: [{ ...r1, seen: by }, { ...r2, seen: by }], page: 1, pageSize: 25, total: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como vistos (2)' }));
    await waitFor(() => expect(seen).toHaveBeenCalledWith([r1.id, r2.id]));
    expect(await screen.findByText('2 avisos marcados como visto.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(`spend-alert-seen-${r1.id}`)).toHaveTextContent(/^Visto por Dueño · /));
    expect(screen.getByTestId(`spend-alert-seen-${r2.id}`)).toHaveTextContent(/^Visto por Dueño · /);
    expect(screen.getByTestId(`spend-alert-row-${r1.id}`)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /Borrar|Eliminar|Archivar|no visto|Deshacer/i })).toHaveLength(0);
  });
  it('🔒 v1.80.12.10: `skipped` ⇒ se dice cuántos no se marcaron (sobre uno mismo o la cuenta del dueño)', async () => {
    serveList([THIRTEEN[2][0]]);
    vi.spyOn(api, 'markSpendAlertsSeen').mockResolvedValue({ updated: 0, skipped: 1 });
    renderWithProviders(<SpendAlertsView />, 'es');
    fireEvent.click(within(await screen.findByTestId('spend-alerts-table')).getByRole('button', { name: 'Marcar visto' }));
    expect(await screen.findByText(/1 aviso no se marcó: los avisos sobre ti y los de la cuenta del dueño solo los marca el dueño\./)).toBeInTheDocument();
  });
  it('vacío sin filtros ⇒ el texto de §43.19.8', async () => {
    serveList([]);
    renderWithProviders(<SpendAlertsView />, 'es');
    expect(await screen.findByText(/^Todavía no hay avisos de gasto\./)).toBeInTheDocument();
  });
  it('detalle: abrirlo NO lo marca visto; «Marcar como visto» sí; 404 ⇒ «Ese aviso no existe.»', async () => {
    vi.spyOn(api, 'getSpendAlert').mockResolvedValue(THIRTEEN[2][0]);
    const seen = vi.spyOn(api, 'markSpendAlertsSeen').mockResolvedValue({ updated: 1, skipped: 0 });
    const { unmount } = renderWithProviders(<SpendAlertDetailView id="a3" />, 'es');
    await screen.findByTestId('spend-alert-detail');
    expect(seen).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Frenar la compra de guías' }).getAttribute('href')).toBe('/admin/m10#compra-guias');
    expect(screen.getByRole('link', { name: 'Cambiar el tope' }).getAttribute('href')).toBe('/admin/m10#control-gasto');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como visto' }));
    await waitFor(() => expect(seen).toHaveBeenCalledWith(['a3']));
    unmount();
    vi.spyOn(api, 'getSpendAlert').mockRejectedValue(new ApiClientError(404, { code: 'NOT_FOUND', message: 'x' }));
    renderWithProviders(<SpendAlertDetailView id="nope" />, 'es');
    expect(await screen.findByText('Ese aviso no existe.')).toBeInTheDocument();
  });
  it('un retiro (sin pedido) enlaza a «Envíos» filtrado por su folio (S-GAS-2), ⛔ nunca a una ruta que actúe', async () => {
    serveList([THIRTEEN[9][0]]);
    renderWithProviders(<SpendAlertsView />, 'es');
    const link = within(await screen.findByTestId('spend-alerts-table')).getByRole('link', { name: 'Envío ENV-000047' });
    expect(link.getAttribute('href')).toBe('/admin/m4?tab=envios&folio=ENV-000047');
  });
});

describe('UX-GAS-1 = PS-152 / PS-158 (pantalla) · solo del súper-admin', () => {
  it('operador por URL: `403 MONEY_OUT_FORBIDDEN` ⇒ «Esta página es solo del súper-admin.»', async () => {
    role.superAdmin = false;
    vi.spyOn(api, 'listSpendAlerts').mockRejectedValue(new ApiClientError(403, { code: 'MONEY_OUT_FORBIDDEN', message: 'x' }));
    renderWithProviders(<SpendAlertsView />, 'es');
    expect(await screen.findByText('Esta página es solo del súper-admin.')).toBeInTheDocument();
  });
  it('operador: el menú no tiene «Avisos de gasto»; súper-admin: sí, tras «Reembolsos», con badge de inmediatos sin ver', async () => {
    const summary = (n: number | null): PickingListSummaryDTO => ({
      ship: 0, vault: 0, oldestRequestedAt: null, stuckRefunds: 0, toReplace: 0, oldestOpenCaseAt: null, toReplaceOverdue: 0,
      manualRefundsPending: null, spendAlertsUnseenImmediate: n,
    });
    role.superAdmin = false;
    vi.spyOn(api, 'getPickingListSummary').mockResolvedValue(summary(null));
    const { unmount } = renderWithProviders(<AdminSidebar />, 'es');
    await screen.findAllByRole('link');
    expect(screen.queryByRole('link', { name: /Avisos de gasto/ })).not.toBeInTheDocument();
    unmount();
    role.superAdmin = true;
    vi.spyOn(api, 'getPickingListSummary').mockResolvedValue(summary(3));
    renderWithProviders(<AdminSidebar />, 'es');
    const link = await screen.findByRole('link', { name: /Avisos de gasto/ });
    expect(link.getAttribute('href')).toBe('/admin/spend-alerts');
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs.indexOf('/admin/spend-alerts')).toBe(hrefs.indexOf('/admin/refunds') + 1);
    // PS-164 (S-GAS-3): el badge es `spendAlertsUnseenImmediate` del summary.
    expect(await within(link).findByTestId('nav-badge-spendAlerts')).toHaveTextContent('3');
    expect(within(link).getByTestId('nav-badge-spendAlerts')).toHaveAttribute('aria-label', '3 avisos inmediatos sin ver');
  });
});

describe('UX-GAS-3 · la tarjeta «Control del gasto» del tablero', () => {
  const dash = (spendControl: SpendControlDTO | null): DashboardDTO => ({ ...mockDashboard, workQueue: { ...mockDashboard.workQueue, spendControl } });
  const people = (n: number): SpendControlDTO['labelSpend24h'] =>
    Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: i === 0 ? 'Dueño' : `P${i}`, cents: 1000 * (i + 1), capCents: i === 0 ? null : 250000 }));

  it('«últimas 24 h» y ⛔ «hoy»; `capCents:null` ⇒ «sin tope»; con 7 personas, 5 filas y «y 2 más»; bermellón con inmediatos', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(dash({ unseenImmediate: 2, unseenDigest: 5, labelSpend24h: people(7) }));
    renderWithProviders(<AdminDashboard />, 'es');
    const card = await screen.findByTestId('dashboard-spend-control');
    expect(card).toHaveTextContent('Guías, últimas 24 h');
    expect(card.textContent).not.toMatch(/\bhoy\b/i);
    expect(card).toHaveTextContent('Dueño: MX$10.00 · sin tope');
    expect(card).toHaveTextContent('P1: MX$20.00 de MX$2,500.00');
    expect(within(card).getAllByRole('listitem')).toHaveLength(5);
    expect(card).toHaveTextContent('y 2 más');
    expect(within(card).getByRole('link', { name: '2 inmediatos y 5 del resumen sin ver' }).getAttribute('href')).toBe('/admin/spend-alerts?unseen=true');
    expect(screen.getByTestId('dashboard-spend-control-value').closest('div.flex-col')?.className).toMatch(/text-accent/);
  });
  it('`unseenImmediate:0` ⇒ el valor sin `text-accent`', async () => {
    vi.spyOn(api, 'getDashboard').mockResolvedValue(dash({ unseenImmediate: 0, unseenDigest: 1, labelSpend24h: [] }));
    renderWithProviders(<AdminDashboard />, 'es');
    const card = await screen.findByTestId('dashboard-spend-control');
    expect(card).toHaveTextContent('Nadie compró guías en las últimas 24 h.');
    expect(screen.getByTestId('dashboard-spend-control-value').closest('div.flex-col')?.className ?? '').not.toMatch(/text-accent/);
  });
  it('operador (`spendControl:null`) ⇒ CERO nodos de la tarjeta', async () => {
    role.superAdmin = false;
    vi.spyOn(api, 'getDashboard').mockResolvedValue(dash(null));
    renderWithProviders(<AdminDashboard />, 'es');
    await screen.findByTestId('sales-gross');
    expect(screen.queryByTestId('dashboard-spend-control')).not.toBeInTheDocument();
    expect(screen.queryByText('Control del gasto')).not.toBeInTheDocument();
  });
});
