import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockInventory } from '@/lib/mock/fixtures';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import type { AdminInventoryItemDetailDTO, PendingPublishRowDTO, VaultLocationDTO } from '@/types/contract';
import { ItemDetailModal } from './ItemDetailModal';
import { PendingPublishQueue } from './PendingPublishQueue';
import { M1View } from './M1View';

/**
 * ⭐ **Errata SU-1 — candados SU-UX-1…6** (`DESIGN_SYSTEM §SU-UX.4`, `API_CONTRACT §M1-SU`). La ubicación deja de ser
 * requisito para publicar: la nota de la cola deja de mentir sobre el sellado ligado, el folio se ve como enlace, y la
 * ficha sin destino de «Mover» dice por qué y lleva a «Ubicaciones» en lugar de pintar un selector vacío.
 */

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m1',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));
const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
  search.value = '';
  window.history.replaceState(null, '', '/');
});

type Dict = Record<string, unknown>;
const at = (d: Dict, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], d);

const LOC_A: VaultLocationDTO = { id: 'loc-a', label: 'C01-F01-S01', zone: 'platform_stock', isActive: true } as VaultLocationDTO;
const LOC_B: VaultLocationDTO = { id: 'loc-b', label: 'C01-F01-S02', zone: 'platform_stock', isActive: true } as VaultLocationDTO;

function detail(location: AdminInventoryItemDetailDTO['location']): AdminInventoryItemDetailDTO {
  return { ...mockInventory[0], status: 'in_stock', ownerType: 'platform', location, movements: [], sealedProductId: null } as AdminInventoryItemDetailDTO;
}

async function openDetail(locations: VaultLocationDTO[], location: AdminInventoryItemDetailDTO['location'], locationsReady?: boolean) {
  vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail(location));
  renderWithProviders(
    <ItemDetailModal itemId="inv-1001" onClose={() => {}} locations={locations} locationsReady={locationsReady} />,
    'es',
  );
  const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
  await within(dialog).findByRole('heading', { name: /Mover de ubicación/ });
  return dialog;
}

describe('SU-UX-1 · la nota de la cola dice la verdad del sellado ligado (con IVA) y del suelto (antes de IVA)', () => {
  it('ES y EN', () => {
    const esNote = at(es, 'admin.m1.publishQueue.note') as string;
    const enNote = at(en, 'admin.m1.publishQueue.note') as string;
    expect(esNote).toContain('con IVA');
    expect(esNote).toContain('antes de IVA');
    expect(esNote).not.toContain('Solo el producto sellado admite aquí');
    expect(enNote).toContain('VAT included');
    expect(enNote).toContain('before VAT');
  });
});

describe('SU-UX-2/3 · ficha: «Mover» sin destino', () => {
  it('SU-UX-2 · sin ninguna ubicación de stock ⇒ `noTargets` + enlace a /admin/m1?locations=open; ⛔ selector vacío', async () => {
    const dialog = await openDetail([], undefined);
    expect(within(dialog).getByTestId('move-no-target')).toHaveTextContent(at(es, 'admin.m1.move.noTargets') as string);
    expect(within(dialog).getByRole('link', { name: 'Ir a Ubicaciones' }).getAttribute('href')).toMatch(/\/admin\/m1\?locations=open$/);
    expect(within(dialog).queryByRole('combobox', { name: 'Nueva ubicación' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Mover' })).toBeNull();
  });

  it('SU-UX-3 · ya está en la ÚNICA ⇒ `noOtherTarget` (texto distinto de `noTargets`)', async () => {
    const dialog = await openDetail([LOC_A], { id: 'loc-a', label: LOC_A.label, zone: 'platform_stock' });
    const box = within(dialog).getByTestId('move-no-target');
    expect(box).toHaveTextContent(at(es, 'admin.m1.move.noOtherTarget') as string);
    expect(box).not.toHaveTextContent(at(es, 'admin.m1.move.noTargets') as string);
    expect(within(dialog).queryByRole('combobox', { name: 'Nueva ubicación' })).toBeNull();
  });

  it('SU-UX-3 · con ≥1 destino ⇒ ni `noTargets` ni `noOtherTarget`, y sí el selector', async () => {
    const dialog = await openDetail([LOC_A, LOC_B], { id: 'loc-a', label: LOC_A.label, zone: 'platform_stock' });
    expect(within(dialog).queryByTestId('move-no-target')).toBeNull();
    expect(within(dialog).getByRole('combobox', { name: 'Nueva ubicación' })).toBeInTheDocument();
  });

  it('lista sin resolver (`locationsReady=false`) ⇒ ⛔ «no hay ubicaciones»: se pinta el selector de siempre', async () => {
    const dialog = await openDetail([], undefined, false);
    expect(within(dialog).queryByTestId('move-no-target')).toBeNull();
    expect(within(dialog).getByRole('combobox', { name: 'Nueva ubicación' })).toBeInTheDocument();
  });
});

describe('SU-UX-4 · M1View con `?locations=open`', () => {
  it('abre «Ubicaciones de bóveda» y quita el parámetro de la URL', async () => {
    search.value = 'locations=open';
    window.history.replaceState(null, '', '/es/admin/m1?locations=open');
    renderWithProviders(<M1View />, 'es');
    expect(await screen.findByRole('dialog', { name: 'Ubicaciones de bóveda' })).toBeInTheDocument();
    expect(window.location.search).not.toContain('locations=');
  });

  it('sin el parámetro, no se abre', async () => {
    renderWithProviders(<M1View />, 'es');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog', { name: 'Ubicaciones de bóveda' })).toBeNull();
  });
});

describe('SU-UX-5 · el folio de la cola se ve como enlace, y la ayuda dice que se puede pulsar', () => {
  const row: PendingPublishRowDTO = {
    inventoryItemId: 'inv-1',
    folio: 'INV-004201',
    card: { id: 'c', externalId: 'x', name: 'Pikachu', number: '1', rarity: 'Common', supertype: 'Pokémon', subtypes: [], setId: 's', setName: 'S', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] },
    productType: 'raw',
    finish: 'normal',
    cardProductId: null,
    locationId: null,
    listPriceCents: null,
    resolvedSalePriceCents: null,
    priceBasis: null,
    pendingPriceEntryId: null,
    missing: ['price'],
    acquisitionType: 'buylist',
    sourceSellRequestItemId: null,
    createdAt: '2026-10-07T00:00:00.000Z',
  };

  it('con filas: `underline` sin prefijo `hover:` y `openHint` presente', async () => {
    vi.spyOn(api, 'getPendingPublish').mockResolvedValue({ data: [row], page: 1, pageSize: 20, total: 1 });
    renderWithProviders(<PendingPublishQueue />, 'es');
    const folio = await screen.findByRole('button', { name: 'Abrir la pieza INV-004201' });
    expect(folio.className.split(/\s+/)).toContain('underline');
    expect(folio.className).not.toMatch(/(^|\s)hover:underline(\s|$)/);
    expect(screen.getByText(at(es, 'admin.m1.publishQueue.openHint') as string)).toBeInTheDocument();
  });

  it('cola vacía: sin `openHint`', async () => {
    vi.spyOn(api, 'getPendingPublish').mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    renderWithProviders(<PendingPublishQueue />, 'es');
    await screen.findByText('Ninguna pieza pendiente de publicar.');
    expect(screen.queryByText(at(es, 'admin.m1.publishQueue.openHint') as string)).toBeNull();
  });
});

describe('SU-UX-6 · paridad ES/EN y claves dormidas conservadas', () => {
  const NEW = [
    'admin.m1.publishQueue.note',
    'admin.m1.publishQueue.openHint',
    'admin.m1.move.noTargets',
    'admin.m1.move.noOtherTarget',
    'admin.m1.move.manageLocations',
  ];
  const DORMANT = [
    'admin.m1.publishQueue.missingLocation',
    'admin.m1.publishQueue.reason.location',
    'admin.sealedFinalPrice.noLocationHint',
    'admin.sealedFinalPrice.confirm.effectNoLocation',
    'admin.sealedFinalPrice.done.savedNoLocation',
  ];
  it.each([...NEW, ...DORMANT])('%s existe en ES y EN', (key) => {
    expect(typeof at(es, key)).toBe('string');
    expect(typeof at(en, key)).toBe('string');
  });
});
