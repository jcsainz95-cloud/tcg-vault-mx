import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import * as cf from '@/lib/api/customer-file';
import es from '../../../../../../../messages/es.json';
import en from '../../../../../../../messages/en.json';
import { looksLikeFolio, folioInventoryHref, folioOf } from '@/lib/folio-hint';
import { lineCardFacts, inventorySearchHref, paidUnassignedLines } from '@/lib/api/vault-unassigned';
import { M6View } from '../M6View';
import { FolioHint } from '@/components/domain/FolioHint';
import { NameField } from './NameField';
import { PaidUnassignedBlock } from '../../vaults/[userId]/PaidUnassignedBlock';
import { PhysicalInventoryPanel } from '../../vaults/[userId]/PhysicalInventoryPanel';
import { M3OrderDetailView } from '../../m3/[orderId]/M3OrderDetailView';

/** Peticiones del dueño 2026-11-26 (producción tras #158). */

const role = vi.hoisted(() => ({ superAdmin: true }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: role.superAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: role.superAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m6',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  role.superAdmin = true;
});

describe('folio en un buscador de carta', () => {
  it('reconoce INV-001306 / inv 1306; no reconoce nombres ni números sueltos', () => {
    for (const ok of ['INV-001306', ' inv 1306 ', 'inv001306']) expect(looksLikeFolio(ok)).toBe(true);
    for (const no of ['', 'pikachu', '078', 'PRE 078', 'INV']) expect(looksLikeFolio(no)).toBe(false);
    expect(folioOf('inv 1306')).toBe('INV-1306');
    expect(folioInventoryHref('INV-001306')).toBe('/admin/m1?folio=INV-001306');
  });
  it('FolioHint: con folio dice dónde buscar y enlaza; con otra cosa no pinta nada', () => {
    const first = renderWithProviders(<FolioHint query="INV-001306" />, 'es');
    expect(screen.getByTestId('folio-hint')).toHaveTextContent('Para buscar una pieza por su folio usa «Buscar por folio».');
    expect(screen.getByRole('link', { name: 'Abrir INV-001306 en Inventario' })).toHaveAttribute('href', '/admin/m1?folio=INV-001306');
    first.unmount();
    renderWithProviders(<FolioHint query="pikachu" />, 'es');
    expect(screen.queryByTestId('folio-hint')).toBeNull();
    expect(en.admin.folioHint.text).toContain('Search by folio');
  });
});

describe('ficha 360: nombre editable y pedidos enlazados', () => {
  it('NameField: «Sin nombre — agregar» ⇒ valida 2–80 con letra, guarda y avisa; el operador no edita', async () => {
    const save = vi.spyOn(cf, 'updateAdminUserName').mockResolvedValue({ id: 'u1', name: 'Ana Ruiz' });
    const onSaved = vi.fn();
    renderWithProviders(<NameField userId="u1" name="" missing canEdit onSaved={onSaved} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Sin nombre — agregar' }));
    const field = screen.getByLabelText('Nombre del cliente');
    fireEvent.change(field, { target: { value: 'A' } });
    expect(screen.getByText(/Escribe un nombre de 2 a 80 caracteres/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '12345' } });
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.change(field, { target: { value: '  Ana   Ruiz ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('u1', 'Ana Ruiz'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
  it('NameField: con nombre hay «Editar»; error del servidor ⇒ mensaje claro; sin permiso, solo texto', async () => {
    vi.spyOn(cf, 'updateAdminUserName').mockRejectedValue(new Error('x'));
    const { unmount } = renderWithProviders(<NameField userId="u1" name="Ana" missing={false} canEdit onSaved={() => {}} />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Editar el nombre de Ana' }));
    fireEvent.change(screen.getByLabelText('Nombre del cliente'), { target: { value: 'Ana B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('No se pudo guardar el nombre. Inténtalo de nuevo.')).toBeInTheDocument();
    unmount();
    renderWithProviders(<NameField userId="u1" name="" missing canEdit={false} onSaved={() => {}} />, 'es');
    expect(screen.getByText('Sin nombre')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('la ficha: cada pedido enlaza a /admin/m3/<id> y «1 pedido pagado» va en singular', async () => {
    renderWithProviders(<M6View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver ficha' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /Ficha 360/ });
    const links = await within(dialog).findAllByTestId(/^ficha-order-link-/);
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute('href')).toMatch(/^\/admin\/m3\/.+/);
    expect(es.admin.m6.ficha.purchasesSubNone.includes('plural')).toBe(true);
  });
});

describe('detalle de pedido: datos de la carta y «Buscar en inventario»', () => {
  it('mapeo: set + clave, número, condición, folio ORIGINAL; sin datos ⇒ nada inventado', () => {
    expect(lineCardFacts({ card: { name: 'Pikachu', setName: 'Base Set', setPtcgoCode: 'BS', number: '58', rawCondition: 'NM', imageSmallUrl: 'u' }, folio: 'INV-2', replacedFolio: 'INV-1' })).toEqual({
      name: 'Pikachu', setName: 'Base Set', setCode: 'BS', number: '58', condition: 'NM', finish: null, folio: 'INV-1', imageUrl: 'u',
    });
    expect(lineCardFacts({})).toEqual({ name: null, setName: null, setCode: null, number: null, condition: null, finish: null, folio: null, imageUrl: null });
    // Forma del backend: `setKey`/`imageUrl`/`finish` al nivel del ítem.
    expect(lineCardFacts({ card: { name: 'X' }, setKey: 'PRE', imageUrl: 'big', finish: 'holofoil' })).toMatchObject({ setCode: 'PRE', imageUrl: 'big', finish: 'holofoil' });
    expect(inventorySearchHref('Mr. Mime')).toBe('/admin/m1?addQ=Mr.%20Mime');
    expect(inventorySearchHref(null)).toBeNull();
  });
  it('la línea «Requiere atención» muestra set, número y folio y enlaza a M1; la asignada no enlaza', async () => {
    const base = await api.getAdminOrder('ord-9001');
    const card = { name: 'Blastoise', setName: 'Base Set', setPtcgoCode: 'BS', number: '2', rawCondition: 'NM', imageSmallUrl: null } as never;
    vi.spyOn(api, 'getAdminOrder').mockResolvedValue({
      ...base,
      status: 'settled',
      fulfillmentMode: 'vault',
      items: [
        { ...base.items![0]!, inventoryItemId: 'a1', card, folio: 'INV-1', fulfillmentState: 'assigned' },
        { ...base.items![0]!, inventoryItemId: 'a2', card, folio: 'INV-2', fulfillmentState: 'needs_attention', fulfillmentFailedAt: '2026-11-25T00:00:00Z', fulfillmentFailedReason: 'no_equivalent_copy' },
      ],
    });
    renderWithProviders(<M3OrderDetailView orderId="ord-9001" />, 'es');
    expect(await screen.findByTestId('m3-item-facts-a2')).toHaveTextContent('Base Set (BS) · #2 · NM · INV-2');
    expect(screen.getByTestId('m3-item-search-inventory-a2')).toHaveAttribute('href', '/admin/m1?addQ=Blastoise');
    expect(screen.queryByTestId('m3-item-search-inventory-a1')).toBeNull();
  });
});

describe('«Qué debe haber»: pagadas sin asignar', () => {
  const raw = { orderItemId: 'oi1', orderId: 'ord-9', orderNumber: 'TCG-9', folio: 'INV-9', state: 'needs_attention' as const, fulfillmentFailedReason: 'no_equivalent_copy', card: { name: 'Charizard', setName: 'Base Set', setKey: 'BS', number: '4', rawCondition: 'NM' }, finish: null, imageUrl: null };
  const line = paidUnassignedLines({ unassignedLines: [raw] })[0]!;
  it('cada línea: nombre, set y clave, número, condición, folio, pedido enlazado y motivo llano', () => {
    renderWithProviders(<PaidUnassignedBlock lines={[line]} />, 'es');
    const row = screen.getByTestId('paid-unassigned-oi1');
    expect(screen.getByText('Pagadas sin asignar (1)')).toBeInTheDocument();
    expect(row).toHaveTextContent('Charizard');
    expect(row).toHaveTextContent('Base Set (BS) · #4 · NM · INV-9');
    expect(row).toHaveTextContent('Requiere atención: no hay otra copia igual disponible');
    expect(within(row).getByRole('link', { name: 'Ver pedido TCG-9' })).toHaveAttribute('href', '/admin/m3/ord-9');
  });
  it('vacío o ausente ⇒ nada', () => {
    const { container } = renderWithProviders(<PaidUnassignedBlock lines={[]} />, 'es');
    expect(container.firstChild).toBeNull();
    expect(paidUnassignedLines(undefined)).toEqual([]);
    expect(paidUnassignedLines({ unassignedLines: [raw] })).toEqual([expect.objectContaining({ orderItemId: 'oi1', reason: 'no_equivalent_copy', folio: 'INV-9' })]);
  });
  it('el resumen dice «1 pagada sin asignar» (también sin piezas a su nombre) y el bloque aparece', async () => {
    const res = await api.getAdminVaultPhysicalInventory('u-777');
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue({ ...res, items: [], unassignedLines: [raw] });
    renderWithProviders(<PhysicalInventoryPanel userId="u-777" />, 'es');
    expect(await screen.findByTestId('physical-paid-unassigned-count')).toHaveTextContent('1 pagada sin asignar');
    expect(screen.getByTestId('paid-unassigned-block')).toBeInTheDocument();
  });
  it('sin `unassignedLines` (servidor anterior) no cambia nada', async () => {
    const res = await api.getAdminVaultPhysicalInventory('u-778');
    vi.spyOn(api, 'getAdminVaultPhysicalInventory').mockResolvedValue({ ...res, unassignedLines: undefined });
    renderWithProviders(<PhysicalInventoryPanel userId="u-778" />, 'es');
    await screen.findByTestId('physical-inventory');
    expect(screen.queryByTestId('physical-paid-unassigned-count')).toBeNull();
  });
});
