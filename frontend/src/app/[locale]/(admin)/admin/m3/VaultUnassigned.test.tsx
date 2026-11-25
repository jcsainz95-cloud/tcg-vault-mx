import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockDashboard, mockAdminOrders, mockAuditLog } from '@/lib/mock/fixtures';
import type { AdminOrderDetailDTO, AdminOrderDTO, AuditLogDTO } from '@/types/contract';
import {
  auditDetail,
  lineFulfillment,
  orderUnassignedCount,
  reasonKey,
  unassignedOrdersCount,
  vaultMissingPieces,
} from '@/lib/api/vault-unassigned';
import { AdminDashboard } from '../AdminDashboard';
import { M3View } from './M3View';
import { M3OrderDetailView } from './[orderId]/M3OrderDetailView';
import { VaultsView } from '../vaults/VaultsView';
import { M10View } from '../m10/M10View';

/**
 * §BOVEDA-COBRADA-SIN-PIEZAS (visibilidad): las 5 pantallas. Formas del backend por confirmar ⇒ todo opcional;
 * cada punto se prueba ausente / presente / 0.
 */

const role = vi.hoisted(() => ({ superAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: role.superAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: role.superAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = true;
});

describe('mapeo único (lib/api/vault-unassigned)', () => {
  it('contador del tablero: ausente / 0 / negativo / basura ⇒ 0; en workQueue o en la raíz', () => {
    expect(unassignedOrdersCount({})).toBe(0);
    expect(unassignedOrdersCount({ workQueue: { vaultOrdersWithUnassignedItems: 0 } })).toBe(0);
    expect(unassignedOrdersCount({ vaultOrdersWithUnassignedItems: -2 })).toBe(0);
    expect(unassignedOrdersCount({ workQueue: { vaultOrdersWithUnassignedItems: Number.NaN } })).toBe(0);
    expect(unassignedOrdersCount({ workQueue: { vaultOrdersWithUnassignedItems: 2 } })).toBe(2);
    expect(unassignedOrdersCount({ vaultOrdersWithUnassignedItems: 3 })).toBe(3);
  });
  it('pedido: conteo o booleano `mismatch`; ausente ⇒ 0', () => {
    expect(orderUnassignedCount({})).toBe(0);
    expect(orderUnassignedCount({ unassignedItemCount: 0 })).toBe(0);
    expect(orderUnassignedCount({ unassignedItemCount: 2 })).toBe(2);
    expect(orderUnassignedCount({ mismatch: true })).toBe(1);
  });
  it('estado por carta sin códigos crudos: un motivo desconocido cae a «unknown»', () => {
    expect(reasonKey('NO_EQUIVALENT_COPY')).toBe('no_equivalent_copy');
    expect(reasonKey('algo-raro-123')).toBe('unknown');
    expect(reasonKey(null)).toBe('unknown');
    expect(lineFulfillment({}, false)).toBeNull();
    expect(lineFulfillment({}, true)).toEqual({ kind: 'in_vault' });
    expect(lineFulfillment({ replacedInventoryItemId: 'x', folio: 'INV-2', replacedFolio: 'INV-1' }, true)).toEqual({ kind: 'replaced', from: 'INV-1', to: 'INV-2' });
    expect(lineFulfillment({ fulfillmentFailedAt: '2026-11-25T00:00:00Z', replacedInventoryItemId: 'x' }, true)?.kind).toBe('attention');
  });
  it('bóvedas: suma piezas y pedidos; vacío / 0 ⇒ null', () => {
    expect(vaultMissingPieces({})).toBeNull();
    expect(vaultMissingPieces({ unassignedPaidOrders: [{ orderId: 'a', missingCount: 0 }] })).toBeNull();
    expect(vaultMissingPieces({ unassignedPaidOrders: [{ orderId: 'a', missingCount: 2 }, { orderId: 'b', missingCount: 1 }] })).toEqual({ pieces: 3, orders: 2 });
  });
  it('bitácora: ausente/vacío ⇒ null; anida con sangría y formatea fechas en hora de CDMX', () => {
    expect(auditDetail({}, 'es', 'Sí', 'No')).toBeNull();
    expect(auditDetail({ before: {}, after: null }, 'es', 'Sí', 'No')).toBeNull();
    const s = auditDetail({ after: { a: 1, ok: true, at: '2026-11-25T05:54:30Z', n: { b: null } } }, 'es', 'Sí', 'No')!;
    expect(s).toHaveLength(1);
    const rows = s[0]!.rows;
    expect(rows.find((r) => r.key === 'ok')!.value).toBe('Sí');
    // 05:54 UTC = 23:54 del día anterior en CDMX (UTC-6).
    expect(rows.find((r) => r.key === 'at')!.value).toMatch(/24 nov 2026,? 11:54/);
    expect(rows.find((r) => r.key === 'n')).toEqual({ depth: 0, key: 'n', value: null });
    expect(rows.find((r) => r.key === 'b')).toEqual({ depth: 1, key: 'b', value: '—' });
  });
});

describe('1 · Tablero', () => {
  function serve(extra: Record<string, unknown>, root: Record<string, unknown> = {}) {
    vi.spyOn(api, 'getDashboard').mockResolvedValue({
      ...mockDashboard,
      ...root,
      workQueue: { ...mockDashboard.workQueue, ...extra },
    } as never);
  }
  it('presente (2) ⇒ aviso con el conteo y enlace a Pedidos filtrado', async () => {
    serve({ vaultOrdersWithUnassignedItems: 2 });
    renderWithProviders(<AdminDashboard />, 'es');
    const link = await screen.findByTestId('dashboard-unassigned');
    expect(link).toHaveTextContent('Pedidos pagados con cartas sin asignar: 2');
    expect(link).toHaveAttribute('href', '/admin/m3?mismatch=true');
  });
  it('en la raíz también se lee (un único lector)', async () => {
    serve({}, { vaultOrdersWithUnassignedItems: 1 });
    renderWithProviders(<AdminDashboard />, 'en');
    expect(await screen.findByTestId('dashboard-unassigned')).toHaveTextContent('Paid orders with unassigned cards: 1');
  });
  for (const [name, extra] of [['ausente', {}], ['0', { vaultOrdersWithUnassignedItems: 0 }]] as const) {
    it(`${name} ⇒ no se pinta`, async () => {
      serve(extra);
      renderWithProviders(<AdminDashboard />, 'es');
      await screen.findByText('Cola de trabajo');
      expect(screen.queryByTestId('dashboard-unassigned')).toBeNull();
    });
  }
});

describe('2 · Pedidos', () => {
  const rows: AdminOrderDTO[] = [
    { ...mockAdminOrders[0]!, id: 'o-bad', orderNumber: 'TCG-1', fulfillmentMode: 'vault', unassignedItemCount: 2 },
    { ...mockAdminOrders[0]!, id: 'o-ok', orderNumber: 'TCG-2', fulfillmentMode: 'vault', unassignedItemCount: 0 },
    { ...mockAdminOrders[0]!, id: 'o-abs', orderNumber: 'TCG-3', fulfillmentMode: 'direct_ship' },
  ];
  function serve() {
    return vi.spyOn(api, 'getAdminOrders').mockResolvedValue({ data: rows, page: 1, pageSize: 25, total: 3 });
  }
  it('marca solo en el pedido afectado (2 ⇒ sí; 0 y ausente ⇒ no)', async () => {
    serve();
    renderWithProviders(<M3View />, 'es');
    expect((await screen.findAllByTestId('m3-unassigned-chip-o-bad'))[0]).toHaveTextContent('2 cartas sin asignar');
    expect(screen.queryByTestId('m3-unassigned-chip-o-ok')).toBeNull();
    expect(screen.queryByTestId('m3-unassigned-chip-o-abs')).toBeNull();
  });
  it('los dos filtros mandan fulfillmentMode y mismatch; llegan ya marcados desde la URL', async () => {
    const spy = serve();
    renderWithProviders(<M3View initialMismatch initialMode="vault" />, 'es');
    await screen.findAllByTestId('m3-unassigned-chip-o-bad');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ mismatch: true, fulfillmentMode: 'vault' }));
    expect(screen.getByTestId('m3-mismatch-filter')).toBeChecked();
    expect(screen.getByLabelText('Tipo de pedido')).toHaveValue('vault');
    fireEvent.click(screen.getByTestId('m3-mismatch-filter'));
    fireEvent.change(screen.getByLabelText('Tipo de pedido'), { target: { value: 'direct_ship' } });
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.not.objectContaining({ mismatch: true })));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ fulfillmentMode: 'direct_ship' }));
  });
  it('sin filtros no manda ninguno de los dos parámetros', async () => {
    const spy = serve();
    renderWithProviders(<M3View />, 'es');
    await screen.findAllByTestId('m3-unassigned-chip-o-bad');
    const arg = spy.mock.calls[0]![0]!;
    expect(arg).not.toHaveProperty('mismatch');
    expect(arg).not.toHaveProperty('fulfillmentMode');
  });
  it('opciones del tipo de pedido en es y en', async () => {
    serve();
    renderWithProviders(<M3View />, 'en');
    await screen.findAllByTestId('m3-unassigned-chip-o-bad');
    const sel = screen.getByLabelText('Order type');
    expect(within(sel).getByRole('option', { name: 'Vault purchase' })).toBeInTheDocument();
    expect(within(sel).getByRole('option', { name: 'Home delivery' })).toBeInTheDocument();
    expect(screen.getByLabelText('With unassigned cards')).toBeInTheDocument();
  });
});

describe('3 · Detalle del pedido', () => {
  async function detail(items: AdminOrderDetailDTO['items'], mode: 'vault' | 'direct_ship' = 'vault', lang: 'es' | 'en' = 'es') {
    const base = await api.getAdminOrder('ord-9001');
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue({ ...base, status: 'settled', fulfillmentMode: mode, items });
    renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, lang);
  }
  const line = (id: string, extra: object = {}) => ({ ...mockLine(), inventoryItemId: id, ...extra });
  function mockLine() {
    return { inventoryItemId: 'x', card: { cardName: 'Pikachu' }, unitPriceCents: 1000 } as never as NonNullable<AdminOrderDetailDTO['items']>[number];
  }
  it('los tres estados en claro, sin códigos crudos, y la explicación', async () => {
    await detail([
      line('i1'),
      line('i2', { folio: 'INV-000012', replacedInventoryItemId: 'i0', replacedFolio: 'INV-000007' }),
      line('i3', { fulfillmentFailedAt: '2026-11-25T05:54:00Z', fulfillmentFailedReason: 'no_equivalent_copy' }),
    ]);
    expect(await screen.findByTestId('m3-item-fulfillment-i1')).toHaveTextContent('En su bóveda');
    expect(screen.getByTestId('m3-item-fulfillment-i2')).toHaveTextContent('Se repuso por otra copia igual (INV-000007 → INV-000012)');
    const att = screen.getByTestId('m3-item-fulfillment-i3');
    expect(att).toHaveTextContent('Requiere atención: no hay otra copia igual disponible');
    expect(att.textContent).not.toMatch(/no_equivalent_copy/);
    expect(screen.getByTestId('m3-attention-help')).toHaveTextContent(/consigue la carta.*al día siguiente.*reembolsa solo esa carta/);
  });
  it('motivo desconocido ⇒ frase genérica, nunca el código', async () => {
    await detail([line('i3', { fulfillmentFailedAt: '2026-11-25T05:54:00Z', fulfillmentFailedReason: 'ZZ_TOP_9' })]);
    const att = await screen.findByTestId('m3-item-fulfillment-i3');
    expect(att).toHaveTextContent('Requiere atención: no se pudo asignar la carta');
    expect(att.textContent).not.toMatch(/ZZ_TOP/);
  });
  it('sin líneas «requiere atención» no hay explicación; en inglés', async () => {
    await detail([line('i1')], 'vault', 'en');
    expect(await screen.findByTestId('m3-item-fulfillment-i1')).toHaveTextContent('In their vault');
    expect(screen.queryByTestId('m3-attention-help')).toBeNull();
  });
  it('envío a domicilio y sin novedad (campos ausentes) ⇒ ninguna etiqueta', async () => {
    await detail([line('i1')], 'direct_ship');
    await screen.findByTestId('m3-item-price-i1');
    expect(screen.queryByTestId('m3-item-fulfillment-i1')).toBeNull();
    expect(screen.queryByTestId('m3-attention-help')).toBeNull();
  });
});

describe('4 · Bóvedas de clientes', () => {
  const base = { userId: 'u-1', name: 'Caro Ruiz', email: 'caro@example.com', totalValueMxnCents: 0, pendingPriceCount: 0 };
  it('0 piezas a su nombre pero pedido pagado con faltantes ⇒ renglón; 0 / ausente ⇒ nada', async () => {
    vi.spyOn(api, 'getAdminVaults').mockResolvedValue({
      page: 1, pageSize: 20, total: 3,
      data: [
        { ...base, pieceCount: 0, unassignedPaidOrders: [{ orderId: 'o1', missingCount: 3 }] },
        { ...base, userId: 'u-2', name: 'Dos Cero', pieceCount: 1, unassignedPaidOrders: [{ orderId: 'o2', missingCount: 0 }] },
        { ...base, userId: 'u-3', name: 'Tres Ausente', pieceCount: 1 },
      ],
    });
    renderWithProviders(<VaultsView />, 'es');
    expect(await screen.findByTestId('vault-row-missing-u-1')).toHaveTextContent('Pedido pagado: faltan 3 piezas');
    expect(screen.queryByTestId('vault-row-missing-u-2')).toBeNull();
    expect(screen.queryByTestId('vault-row-missing-u-3')).toBeNull();
  });
  it('singular y varios pedidos', async () => {
    vi.spyOn(api, 'getAdminVaults').mockResolvedValue({
      page: 1, pageSize: 20, total: 2,
      data: [
        { ...base, pieceCount: 0, unassignedPaidOrders: [{ orderId: 'o1', missingCount: 1 }] },
        { ...base, userId: 'u-2', name: 'Dos', pieceCount: 0, unassignedPaidOrders: [{ orderId: 'a', missingCount: 1 }, { orderId: 'b', missingCount: 2 }] },
      ],
    });
    renderWithProviders(<VaultsView />, 'es');
    expect(await screen.findByTestId('vault-row-missing-u-1')).toHaveTextContent('Pedido pagado: falta 1 pieza');
    expect(screen.getByTestId('vault-row-missing-u-2')).toHaveTextContent('2 pedidos pagados: faltan 3 piezas');
  });
});

describe('5 · Bitácora', () => {
  const withDetail: AuditLogDTO = { ...mockAuditLog[0]!, id: 'd1', createdAt: '2026-11-25T05:54:30Z', before: { status: 'listed' }, after: { status: 'in_custody', movement: { at: '2026-11-25T05:54:30Z', ok: false } } };
  const noDetail: AuditLogDTO = { ...mockAuditLog[1]!, id: 'd2' };
  function serve() {
    vi.spyOn(api, 'getAuditLog').mockResolvedValue({ data: [withDetail, noDetail], page: 1, pageSize: 20, total: 2 });
  }
  it('la fecha lleva la hora en CDMX', async () => {
    serve();
    renderWithProviders(<M10View />, 'es');
    expect((await screen.findAllByText(/24 nov 2026,? 11:54/)).length).toBeGreaterThan(0);
  });
  it('al pulsar se despliega el detalle legible (clave: valor, con sangría); otra vez lo cierra', async () => {
    serve();
    renderWithProviders(<M10View />, 'es');
    const toggle = (await screen.findAllByTestId('audit-toggle-d1'))[0]!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const box = (await screen.findAllByTestId('audit-detail-d1'))[0]!;
    expect(within(box).getByText('Antes')).toBeInTheDocument();
    expect(within(box).getByText('Después')).toBeInTheDocument();
    expect(within(box).getByText('listed')).toBeInTheDocument();
    expect(within(box).getByText('No')).toBeInTheDocument();
    const nested = within(box).getByText('ok:').parentElement as HTMLElement;
    expect(nested.style.paddingLeft).toBe('16px');
    fireEvent.click(screen.getAllByTestId('audit-toggle-d1')[0]!);
    expect(screen.queryAllByTestId('audit-detail-d1')).toHaveLength(0);
  });
  it('detalle ausente ⇒ «Sin detalle»', async () => {
    serve();
    renderWithProviders(<M10View />, 'es');
    fireEvent.click((await screen.findAllByTestId('audit-toggle-d2'))[0]!);
    expect((await screen.findAllByTestId('audit-detail-d2'))[0]).toHaveTextContent('Sin detalle');
  });
  it('no súper-admin ⇒ ni botón ni detalle', async () => {
    role.superAdmin = false;
    serve();
    renderWithProviders(<M10View />, 'es');
    await screen.findAllByText('settings.update');
    expect(screen.queryByTestId('audit-toggle-d1')).toBeNull();
  });
});
