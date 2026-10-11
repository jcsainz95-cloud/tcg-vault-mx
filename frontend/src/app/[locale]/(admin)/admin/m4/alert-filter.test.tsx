import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setToken } from '@/lib/api-client';
import * as sdx from '@/lib/mock/skydropx';
import { config } from '@/lib/config';
import type { AdminShipmentDTO } from '@/types/contract';
import { ShipmentsQueue } from './ShipmentsQueue';
import { parseAlert } from './tabs';

/**
 * UX-SDX-43 (`DESIGN_SYSTEM §43.22.4`, FS-65/FS-66): `/admin/m4?tab=envios&alert=true` — el destino del enlace de
 * «Alertas de envíos». Contrato: `GET /admin/shipments?alert=true` (clase L, dominio `true`; §0-Q, §19.20.2: la UNIÓN
 * `carrierAlert ≠ null ∨ labelAlert ≠ null`).
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const row = (id: string): AdminShipmentDTO =>
  ({
    id,
    userId: 'u-1',
    kind: 'vault_withdrawal',
    orderId: null,
    status: 'guia',
    carrier: null,
    trackingNumber: null,
    requestedAt: '2026-09-20T10:00:00Z',
    addressSnapshot: { recipientName: 'Misty', line1: 'Calle 1', city: 'Cerulean', state: 'KAN', postalCode: '10000', country: 'MX', phone: '5550000000' },
    customer: { userId: 'u-1', fullName: 'Misty', email: 'misty@example.com' },
    items: [{ inventoryItemId: 'inv-1' }],
  }) as AdminShipmentDTO;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('UX-SDX-43 · el filtro de alertas en «Envíos»', () => {
  it('solo `true` activa; `1`, `false`, ausente ⇒ inactivo', () => {
    expect(parseAlert('true')).toBe(true);
    expect(parseAlert(['true'])).toBe(true);
    expect(parseAlert('1')).toBe(false);
    expect(parseAlert('false')).toBe(false);
    expect(parseAlert('TRUE')).toBe(false);
    expect(parseAlert(undefined)).toBe(false);
  });

  it('activo ⇒ la petición lleva `alert: true` y se ve la línea; su ✕ ⇒ la siguiente sin `alert` y la línea desaparece', async () => {
    const list = vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: [row('shp-a')], page: 1, pageSize: 20, total: 1 });
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} initialAlert />, 'es');
    expect(await screen.findByTestId('shipments-alert-filter')).toHaveTextContent(
      'Solo envíos con alerta de guía o aviso de la paquetería',
    );
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ alert: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el filtro de alertas' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ alert: undefined })));
    expect(screen.queryByTestId('shipments-alert-filter')).not.toBeInTheDocument();
  });

  it('inactivo ⇒ ni línea ni `alert` en la petición', async () => {
    const list = vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: [row('shp-a')], page: 1, pageSize: 20, total: 1 });
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} />, 'es');
    await screen.findByTestId('shipment-row-shp-a');
    expect(screen.queryByTestId('shipments-alert-filter')).toBeNull();
    for (const [f] of list.mock.calls) expect(f?.alert).toBeUndefined();
  });

  it('lista vacía con el filtro ⇒ el vacío de hoy', async () => {
    vi.spyOn(api, 'getAdminShipments').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    renderWithProviders(<ShipmentsQueue onCaptureGuide={() => {}} initialAlert />, 'es');
    expect(await screen.findByText('Sin envíos con ese filtro.')).toBeInTheDocument();
  });
});

describe('UX-SDX-43 · `getAdminShipments` (rama REAL) manda `alert=true` solo con el filtro', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;
  beforeEach(() => {
    config.useMocks = false;
    setToken('access-token');
    fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: [], page: 1, pageSize: 20, total: 0 }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = originalUseMocks;
    setToken(null);
    vi.unstubAllGlobals();
  });

  it('`{alert:true}` ⇒ `?alert=true`; sin él ⇒ ningún `alert`', async () => {
    await api.getAdminShipments({ alert: true });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/admin\/shipments\?(.*&)?alert=true(&|$)/);
    await api.getAdminShipments({});
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('alert');
    await api.getAdminShipments({ alert: false });
    expect(String(fetchMock.mock.calls[2][0])).not.toContain('alert');
  });
});

describe('MOCK · el servidor falso filtra por la UNIÓN de las dos alertas', () => {
  afterEach(() => sdx.resetMockSkydropx());
  it('cada fila de `?alert=true` tiene `carrierAlert` o `labelAlert`', async () => {
    sdx.mockSeedLabelState('shp-7002', { labelAlert: { kind: 'label_processing_stuck', since: '2026-10-05T10:00:00Z', canRelease: false } });
    const all = await api.getAdminShipments({ pageSize: 200 });
    const filtered = await api.getAdminShipments({ alert: true, pageSize: 200 });
    const union = all.data.filter((s) => s.carrierAlert != null || s.labelAlert != null).map((s) => s.id);
    expect(union.length).toBeGreaterThan(0);
    expect(union.length).toBeLessThan(all.data.length);
    expect(filtered.data.map((s) => s.id)).toEqual(union);
  });
});
