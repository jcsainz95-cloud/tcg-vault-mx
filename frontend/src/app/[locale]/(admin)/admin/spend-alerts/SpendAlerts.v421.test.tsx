import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { SpendAlertDTO, UserDTO } from '@/types/contract';
import { SpendAlertsView } from './SpendAlertsView';
import { SpendAlertDetailView } from './[id]/SpendAlertDetailView';
import { parseSpendAlertFilters } from './filters';

/**
 * Candados de la errata **v4.21** (`DESIGN_SYSTEM §43.20.12`) en «Avisos de gasto»: UX-GAS-8 (AG-21 en cuatro
 * variantes), UX-GAS-9 (AG-22 por `act`), UX-GAS-10 (`seen` del súper-admin no dueño), UX-GAS-11 (apagados, lista y
 * filtro) y UX-GAS-12 («del», nunca «de el»), con la API espiada. Canarios en `docs/FRONTEND_NOTES.md` §93.
 */

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
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
  window.history.replaceState(null, '', '/es/admin/spend-alerts');
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const ME = (id: string, isOwner: boolean): UserDTO => ({ id, email: `${id}@x.mx`, name: id, role: 'super_admin', locale: 'es', isOwner });
const LUIS = { userId: 'u-sa2', name: 'Luis' };

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
    facts: {},
    ...over,
  };
}
const sys = (over: Partial<SpendAlertDTO> & Pick<SpendAlertDTO, 'id' | 'code' | 'kind'>) => a({ order: null, shipment: null, amountCents: null, ...over });

function serveList(rows: SpendAlertDTO[]) {
  return vi.spyOn(api, 'listSpendAlerts').mockResolvedValue({ data: rows, page: 1, pageSize: 25, total: rows.length });
}
/** El texto de la celda «Aviso» de una fila (título + frase). */
const alertTextOf = (id: string) => {
  const row = screen.getByTestId(`spend-alert-row-${id}`);
  return row.querySelectorAll('td')[3].textContent ?? '';
};

describe('UX-GAS-8 · AG-21 «Cambió la cuenta del dueño» en cuatro variantes (§43.20.2)', () => {
  const OLD = { userId: 'u-old-777', name: 'Viejo' };
  const NEW = { userId: 'u-new-888', name: 'Nuevo' };
  const CASES: [SpendAlertDTO, string, string][] = [
    [
      sys({ id: 'c1', code: 'AG-21', kind: 'owner_account_changed', facts: { cause: 'changed', previousOwner: OLD, currentOwner: NEW } }),
      'Cambió la cuenta del dueño',
      'La cuenta del dueño pasó de Viejo a Nuevo. Esa marca solo se cambia desde el servidor: si no lo esperabas, revísalo hoy con quien lo administra.',
    ],
    [
      sys({ id: 'c2', code: 'AG-21', kind: 'owner_account_changed', facts: { cause: 'changed', previousOwner: null, currentOwner: { userId: 'u-new-888', name: '' } } }),
      'Cambió la cuenta del dueño',
      'La cuenta de una cuenta sin nombre quedó marcada como la del dueño; antes no había ninguna. Desde ahora es la única sin tope, la que cambia los ajustes de gasto y la que recibe estos correos.',
    ],
    [
      sys({ id: 'c3', code: 'AG-21', kind: 'owner_account_changed', facts: { cause: 'no_owner', previousOwner: null, currentOwner: null } }),
      'No hay cuenta de dueño',
      'Ninguna cuenta está marcada como la del dueño. Mientras siga así, nadie queda sin tope, nadie puede cambiar los ajustes de gasto y los avisos no mandan correo. Se arregla marcando la cuenta del dueño desde el servidor.',
    ],
    [
      sys({ id: 'c4', code: 'AG-21', kind: 'owner_account_changed', facts: { cause: 'no_owner', previousOwner: { userId: 'u-old-777', name: '' }, currentOwner: null } }),
      'No hay cuenta de dueño',
      'La cuenta de una cuenta sin nombre dejó de ser la del dueño y ninguna otra quedó marcada. Mientras siga así, nadie queda sin tope, nadie puede cambiar los ajustes de gasto y los avisos no mandan correo. Se arregla marcando la cuenta del dueño desde el servidor.',
    ],
  ];
  it('las cuatro dan cuatro textos distintos, `name:""` ⇒ «una cuenta sin nombre», ⛔ ni `@` ni el `userId`', async () => {
    serveList(CASES.map(([x]) => x));
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    const seen = new Set<string>();
    for (const [x, title, text] of CASES) {
      const row = within(screen.getByTestId(`spend-alert-row-${x.id}`));
      expect(row.getByRole('link', { name: title })).toBeInTheDocument();
      expect(row.getByText(text)).toBeInTheDocument();
      seen.add(text);
    }
    expect(seen.size).toBe(4);
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('@');
    expect(body).not.toContain('u-old-777');
    expect(body).not.toContain('u-new-888');
  });
});

describe('UX-GAS-9 · AG-22 «Cambios de otro súper-admin»: una frase por `act` (§43.20.3)', () => {
  const op = { userId: 'u-op1', name: 'Ana', role: 'vault_operator' as const };
  const sa = { userId: 'u-sa3', name: 'Marta', role: 'super_admin' as const };
  const owner = { userId: 'u-owner', name: 'Dueño', role: 'super_admin' as const };
  const ag22 = (id: string, facts: SpendAlertDTO['facts']) =>
    sys({ id, code: 'AG-22', kind: 'staff_control_by_non_owner', subject: LUIS, facts });
  const CASES: [SpendAlertDTO, string][] = [
    [ag22('d1', { act: 'staff_created', target: op, keys: null }), 'Luis creó una cuenta para Ana (operador).'],
    [ag22('d2', { act: 'staff_password_reset', target: sa, keys: null }), 'Luis restableció la contraseña de Marta (súper-admin).'],
    [ag22('d3', { act: 'staff_status_changed', target: op, keys: null }), 'Luis bloqueó o reactivó la cuenta de Ana (operador); cómo quedó se ve en «Usuarios».'],
    [ag22('d4', { act: 'staff_deleted', target: op, keys: null }), 'Luis borró la cuenta de Ana (operador).'],
    [
      ag22('d5', { act: 'owner_account_denied', target: owner, keys: null }),
      'Luis intentó restablecer, bloquear o borrar la cuenta del dueño (Dueño). El sistema se lo negó: no cambió nada.',
    ],
    [
      ag22('d6', { act: 'owner_setting_denied', target: null, keys: ['operatorLabelCap24hCents', 'shippingLabelPurchase'] }),
      'Luis intentó cambiar el tope de guías por persona y quién puede comprar guías. Solo el dueño puede cambiarlo: no se guardó nada.',
    ],
    [ag22('d7', { act: 'zz_nuevo', target: op, keys: null }), 'Luis hizo un cambio en una cuenta del personal.'],
  ];
  it('los seis `act` + uno desconocido ⇒ siete textos distintos; `keys` por sus rótulos (⛔ la clave cruda); rol entre paréntesis', async () => {
    serveList(CASES.map(([x]) => x));
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    for (const [x, text] of CASES) {
      const row = within(screen.getByTestId(`spend-alert-row-${x.id}`));
      expect(row.getByRole('link', { name: 'Cambios de otro súper-admin' })).toBeInTheDocument();
      expect(row.getByText(text)).toBeInTheDocument();
    }
    expect(new Set(CASES.map(([, t]) => t)).size).toBe(7);
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('operatorLabelCap24hCents');
    expect(body).not.toContain('shippingLabelPurchase');
    expect(body).not.toMatch(/: \./); // ⛔ el «:» suelto del `select` viejo
  });
  it('`target:null` ⇒ «una cuenta del personal»; rol sin rótulo ⇒ solo el nombre; clave sin rótulo o `keys` vacío ⇒ «un ajuste del dueño»', async () => {
    serveList([
      ag22('e1', { act: 'staff_deleted', target: null, keys: null }),
      ag22('e2', { act: 'staff_created', target: { userId: 'u-x', name: 'Pepe', role: 'customer' }, keys: null }),
      ag22('e3', { act: 'owner_setting_denied', target: null, keys: ['zz_raw_key', 'zz_raw_key'] }),
      ag22('e4', { act: 'owner_setting_denied', target: null, keys: [] }),
    ]);
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    expect(alertTextOf('e1')).toContain('Luis borró la cuenta de una cuenta del personal.');
    expect(alertTextOf('e2')).toContain('Luis creó una cuenta para Pepe.');
    expect(alertTextOf('e3')).toContain('Luis intentó cambiar un ajuste del dueño. Solo el dueño');
    expect(alertTextOf('e4')).toContain('Luis intentó cambiar un ajuste del dueño. Solo el dueño');
    expect(document.body.textContent).not.toContain('zz_raw_key');
  });
});

describe('AG-9 `orphan_cancel_unknown` (§43.20.4) y `cancelKind` sin rótulo (§43.20.1)', () => {
  it('la causa gana su frase (⛔ el respaldo `other`)', async () => {
    serveList([a({ id: 'o1', code: 'AG-9', kind: 'label_charged_unexplained', facts: { cause: 'orphan_cancel_unknown', expectedChargeCents: 14850, providerReference: 'ENV-000045-02' } })]);
    renderWithProviders(<SpendAlertsView />, 'es');
    const table = await screen.findByTestId('spend-alerts-table');
    expect(
      within(table).getByText(
        'Intentamos cancelar sola una guía de más del pedido TCG-000123 («Pedido ENV-000045-02», MX$148.50) y Skydropx no contestó: no sabemos si se canceló. No lo volvemos a intentar solos; búscala en tu panel de Skydropx y cancélala ahí si sigue activa.',
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('que no cuadra');
  });
  it('detalle: `cancelKind` desconocido ⇒ «sin dato» (⛔ el valor crudo); uno conocido ⇒ quién y por qué', async () => {
    vi.spyOn(api, 'getSpendAlert').mockResolvedValue(
      a({ id: 'k1', code: 'AG-8', kind: 'cancel_refund_missing', facts: { chargedCents: 100, refundedCents: null, cancelKind: 'zz_crudo' } }),
    );
    const { unmount } = renderWithProviders(<SpendAlertDetailView id="k1" />, 'es');
    const dl = await screen.findByTestId('spend-alert-facts');
    expect(dl.textContent).toContain('Cómo se canceló');
    expect(dl.textContent).toContain('sin dato');
    expect(dl.textContent).not.toContain('zz_crudo');
    unmount();
    vi.spyOn(api, 'getSpendAlert').mockResolvedValue(
      a({ id: 'k2', code: 'AG-8', kind: 'cancel_refund_missing', facts: { chargedCents: 100, refundedCents: null, cancelKind: 'reissue' } }),
    );
    renderWithProviders(<SpendAlertDetailView id="k2" />, 'es');
    expect((await screen.findByTestId('spend-alert-facts')).textContent).toContain('cancelada por una persona para comprar otra');
  });
});

describe('UX-GAS-10 · `seen` de un súper-admin que no es el dueño (§43.20.6)', () => {
  const mine = a({ id: 's1', code: 'AG-3', kind: 'label_cap_blocked', subject: LUIS, facts: { priceCents: 1, capCents: 2, usedCents: 3 } });
  const owner21 = sys({ id: 's2', code: 'AG-21', kind: 'owner_account_changed', facts: { cause: 'no_owner', previousOwner: null, currentOwner: null } });
  const other = a({ id: 's3', code: 'AG-3', kind: 'label_cap_blocked', subject: { userId: 'u-op1', name: 'Ana' }, facts: { priceCents: 1, capCents: 2, usedCents: 3 } });
  const markBtns = (id: string) => within(screen.getByTestId(`spend-alert-row-${id}`)).queryAllByRole('button', { name: 'Marcar visto' });

  it('no dueño: su propia fila y la AG-21 ⇒ cero «Marcar visto» y «Lo marca el dueño»; la de otro ⇒ botón; `skipped` ⇒ las dos frases', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME('u-sa2', false));
    serveList([mine, owner21, other]);
    const seen = vi.spyOn(api, 'markSpendAlertsSeen').mockResolvedValue({ updated: 1, skipped: 1 });
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    await waitFor(() => expect(markBtns('s1')).toHaveLength(0));
    for (const id of ['s1', 's2']) {
      expect(markBtns(id)).toHaveLength(0);
      expect(within(screen.getByTestId(`spend-alert-row-${id}`)).getByText('Lo marca el dueño')).toBeInTheDocument();
      expect(within(screen.getByTestId(`spend-alert-row-${id}`)).getByText('Sin ver')).toBeInTheDocument();
    }
    expect(markBtns('s3')).toHaveLength(1);
    expect(within(screen.getByTestId('spend-alert-row-s3')).queryByText('Lo marca el dueño')).not.toBeInTheDocument();
    // La selección múltiple no se recorta (OWN-2): el servidor decide y el resultado lo dice.
    fireEvent.click(within(screen.getByTestId('spend-alerts-table')).getByRole('checkbox', { name: 'Seleccionar los de esta página' }));
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como vistos (3)' }));
    await waitFor(() => expect(seen).toHaveBeenCalledWith(['s1', 's2', 's3']));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('1 aviso marcado como visto.');
    expect(status).toHaveTextContent('1 aviso no se marcó: los avisos sobre ti y los de la cuenta del dueño solo los marca el dueño.');
  });
  it('sesión del dueño ⇒ botón en todas, cero «Lo marca el dueño»', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME('u-sa2', true));
    serveList([mine, owner21, other]);
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    await waitFor(() => expect(api.getMe).toHaveBeenCalled());
    for (const id of ['s1', 's2', 's3']) expect(markBtns(id)).toHaveLength(1);
    expect(screen.queryAllByText('Lo marca el dueño')).toHaveLength(0);
  });
  it('detalle: no dueño en un aviso sobre sí mismo ⇒ «Lo marca el dueño» en lugar de «Marcar como visto»', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue(ME('u-sa2', false));
    vi.spyOn(api, 'getSpendAlert').mockResolvedValue(mine);
    renderWithProviders(<SpendAlertDetailView id="s1" />, 'es');
    expect(await screen.findByTestId('spend-alert-owner-marks')).toHaveTextContent('Lo marca el dueño');
    expect(screen.queryByRole('button', { name: 'Marcar como visto' })).not.toBeInTheDocument();
  });
});

describe('UX-GAS-11 · avisos apagados (`muted`) en la lista, el detalle y el filtro (§43.20.5)', () => {
  const mutedRow = a({ id: 'm1', code: 'AG-6', kind: 'carrier_extra_charge', severity: 'immediate', muted: true, mail: { status: 'not_applicable', at: null }, facts: { kind: 'overweight', carrierName: 'FedEx', amountCents: 100 } });
  it('`muted:true` ⇒ «Apagado: sin correo» EN LUGAR de la línea del correo, y la gravedad sin bermellón aunque sea inmediata', async () => {
    serveList([mutedRow]);
    renderWithProviders(<SpendAlertsView />, 'es');
    const row = within(await screen.findByTestId('spend-alert-row-m1'));
    expect(row.getByText('Apagado: sin correo')).toBeInTheDocument();
    expect(row.queryByText(/Va en el resumen/)).not.toBeInTheDocument();
    const tag = row.getByText('Inmediato');
    expect(tag.className).not.toMatch(/text-accent/);
    expect(tag.className).toMatch(/text-muted/);
  });
  it('detalle: la fila «Correo» = «Apagado: sin correo»', async () => {
    vi.spyOn(api, 'getSpendAlert').mockResolvedValue(mutedRow);
    renderWithProviders(<SpendAlertDetailView id="m1" />, 'es');
    const dl = await screen.findByTestId('spend-alert-facts');
    expect(dl.textContent).toContain('Apagado: sin correo');
    expect(dl.textContent).not.toContain('Va en el resumen');
  });
  it('el `Select` «Avisos apagados» escribe `muted=true` y `muted=false` en la URL y en la petición; «Incluirlos» los quita', async () => {
    const list = serveList([mutedRow]);
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    fireEvent.change(screen.getByLabelText('Avisos apagados'), { target: { value: 'true' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true })));
    expect(window.location.search).toContain('muted=true');
    fireEvent.change(screen.getByLabelText('Avisos apagados'), { target: { value: 'false' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ muted: false })));
    expect(window.location.search).toContain('muted=false');
    // «Sin los apagados» es un filtro: aparece «Limpiar filtros».
    expect(screen.getAllByRole('button', { name: 'Limpiar filtros' }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Avisos apagados'), { target: { value: '' } });
    await waitFor(() => expect(window.location.search).not.toContain('muted'));
    expect(list.mock.lastCall?.[0]?.muted).toBeUndefined();
  });
  it('la URL se lee: `muted=true|false` y nada más', () => {
    expect(parseSpendAlertFilters({ muted: 'true' }).muted).toBe(true);
    expect(parseSpendAlertFilters({ muted: 'false' }).muted).toBe(false);
    expect(parseSpendAlertFilters({ muted: '1' }).muted).toBeUndefined();
  });
  it('filtro «Tipo»: los trece + AG-21 + AG-22, en orden de código; AG-14…AG-20 fuera', async () => {
    serveList([]);
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByText(/^Todavía no hay avisos de gasto\./);
    const opts = within(screen.getByLabelText('Tipo') as HTMLSelectElement)
      .getAllByRole('option')
      .map((o) => o.textContent?.split(' · ')[0]);
    // 💰 rev BSD-1: + AG-23 «Solicitud de venta sin guía» (BSD-1.1 C-7), en orden de código.
    expect(opts).toEqual(['Todos', ...Array.from({ length: 13 }, (_, i) => `AG-${i + 1}`), 'AG-21', 'AG-22', 'AG-23']);
    expect(within(screen.getByLabelText('Tipo')).getByRole('option', { name: 'AG-22 · Cambios de otro súper-admin' })).toHaveAttribute(
      'value',
      'staff_control_by_non_owner',
    );
  });
});

describe('UX-GAS-12 · `{ref}` sin artículo: «del pedido», nunca «de el pedido» (§43.20.7)', () => {
  const F: Partial<Record<SpendAlertDTO['code'], [SpendAlertDTO['kind'], SpendAlertDTO['facts']]>> = {
    'AG-1': ['label_after_address_fix', { changedKeys: ['line1'], carrierName: 'X', chargedCents: 1 }],
    'AG-3': ['label_cap_blocked', { priceCents: 1, capCents: 1, usedCents: 1 }],
    'AG-4': ['label_reissue_loop', { cancelledCount: 2, unrecoveredCents: 0, actors: ['Ana'], triggers: ['reissue_denied'] }],
    'AG-5': ['label_charge_drift', { chargedCents: 1, quotedCents: 1, diffCents: 1 }],
    'AG-6': ['carrier_extra_charge', { kind: 'overweight', carrierName: 'X', amountCents: 1 }],
    'AG-7': ['provider_balance_low', { requiredCents: 1 }],
    'AG-8': ['cancel_refund_missing', { chargedCents: 1, refundedCents: 1, unrefundedCents: 0 }],
    'AG-10': ['label_not_shipped', { chargedCents: 1, daysSincePurchase: 3, carrierName: 'X' }],
    'AG-11': ['parcel_returned', { status: 'destroyed', carrierName: 'X', chargedCents: 1 }],
    'AG-12': ['parcel_problem', { status: 'retained', carrierName: 'X' }],
    'AG-13': ['label_costly_choice', { marginCents: -1 }],
  };
  const rows: SpendAlertDTO[] = [];
  for (const [code, [kind, facts]] of Object.entries(F) as [SpendAlertDTO['code'], [SpendAlertDTO['kind'], SpendAlertDTO['facts']]][]) {
    rows.push(a({ id: `${code}-o`, code, kind, subject: LUIS, facts }));
    rows.push(a({ id: `${code}-s`, code, kind, subject: LUIS, order: null, shipment: { id: 's', folio: 'ENV-000047', kind: null }, facts }));
  }
  for (const cause of ['charged_not_found', 'orphan', 'duplicate', 'orphan_auto_cancelled', 'orphan_cancel_unknown', 'zz_other']) {
    rows.push(a({ id: `AG-9-${cause}-o`, code: 'AG-9', kind: 'label_charged_unexplained', facts: { cause, expectedChargeCents: 1, providerReference: 'R' } }));
    rows.push(a({ id: `AG-9-${cause}-s`, code: 'AG-9', kind: 'label_charged_unexplained', order: null, facts: { cause, expectedChargeCents: 1, providerReference: 'R' } }));
  }
  it('ES: ninguna frase dice «de el»; con pedido y con envío, el artículo va en la frase («del» / «el»)', async () => {
    serveList(rows);
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    for (const r of rows) {
      const text = alertTextOf(r.id);
      expect(text, r.id).not.toMatch(/\bde el\b/i);
      expect(text, r.id).toMatch(r.order ? /\b(del|el) pedido TCG-000123\b/ : /\b(del|el) envío ENV-0000(45|47)\b/);
    }
    // Donde `{ref}` va tras «de», es «del».
    expect(alertTextOf('AG-1-o')).toContain('corrigió la dirección del pedido TCG-000123');
    expect(alertTextOf('AG-10-s')).toContain('La guía del envío ENV-000047');
    expect(alertTextOf('AG-4-o')).toContain('Se negó una guía más para el pedido TCG-000123: ya había usado todas sus recompras.');
    expect(alertTextOf('AG-4-o')).toContain('Van 2 guías canceladas en el pedido TCG-000123');
  });
  it('sin pedido ni folio ⇒ «del envío sin folio»', async () => {
    serveList([a({ id: 'n1', code: 'AG-5', kind: 'label_charge_drift', order: null, shipment: null, facts: { chargedCents: 1, quotedCents: 1, diffCents: 0 } })]);
    renderWithProviders(<SpendAlertsView />, 'es');
    await screen.findByTestId('spend-alerts-table');
    expect(alertTextOf('n1')).toContain('La guía del envío sin folio se cobró');
  });
});
