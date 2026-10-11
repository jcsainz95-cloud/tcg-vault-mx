import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { mockInventory } from '@/lib/mock/fixtures';
import type { AdminInventoryItemDetailDTO, BatchCreateInventoryResponse, CardDTO, Paginated, VaultLocationDTO } from '@/types/contract';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import { AddItemModal } from './AddItemModal';
import { VariantDrawer } from './VariantDrawer';

/**
 * ⭐ **Ubicación opcional en el alta: lo que se ve es lo que se envía** (gate QA sobre 2c516314, IMPORTANTE;
 * `API_CONTRACT §M1-SU`, HECHOS 2026-10-07 «La ubicación (cajón) NO es requisito para publicar, por ahora»).
 * Antes, el `Select` de ubicación de `AddItemModal` no tenía opción vacía: el navegador mostraba el PRIMER cajón
 * mientras el estado seguía en `''`, y la pieza se creaba con `locationId` ausente ⇒ el operador creía haberla
 * guardado en un cajón que no se envió. Ahora el selector arranca en «Sin ubicación» y envía lo que muestra.
 *
 * Y (QA, MENOR): `VariantDrawer` no pasaba `locationsReady` a la ficha ⇒ con la lista aún sin llegar, la ficha
 * decía «no hay ubicaciones» sin saberlo (`ItemDetailModal` asume `true` por defecto).
 */

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.role, setRole: () => {}, isSuperAdmin: roleState.role === 'super_admin', canSwitchRole: false }),
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

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

const LOC_A = { id: 'loc-a', label: 'E2E-F01-S01', zone: 'platform_stock', isActive: true } as VaultLocationDTO;
const LOC_B = { id: 'loc-b', label: 'E2E-F01-S02', zone: 'platform_stock', isActive: true } as VaultLocationDTO;

function fakeCard(i: number): CardDTO {
  return {
    id: `c-fake-${i}`,
    externalId: `c-fake-${i}`,
    name: `Fake Card ${i}`,
    number: String(i),
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    setId: 'base1',
    setName: 'Base Set',
    setPtcgoCode: null,
    imageSmallUrl: `https://img.example/${i}.png`,
    imageLargeUrl: `https://img.example/${i}_hires.png`,
    availableFinishes: ['normal'],
  };
}
const page = (cards: CardDTO[]): Paginated<CardDTO> => ({ data: cards, page: 1, pageSize: 50, total: cards.length });

/** Abre el alta con dos cajones y espera a que el selector de ubicación tenga sus opciones. */
async function openAlta(cards: CardDTO[]) {
  vi.spyOn(api, 'getLocations').mockResolvedValue([LOC_A, LOC_B]);
  vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page(cards));
  renderWithProviders(<AddItemModal onClose={() => {}} onToast={() => {}} />, 'es');
  const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
  const select = within(dialog).getByRole('combobox', { name: es.admin.m1.location }) as HTMLSelectElement;
  await within(select).findByRole('option', { name: LOC_A.label });
  fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'Fake' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
  return { dialog, select };
}

/** Lo que el `<select>` MUESTRA: la opción seleccionada (el navegador pinta la primera si ninguna casa). */
const shown = (select: HTMLSelectElement) => select.options[select.selectedIndex]?.textContent;

describe('Ubicación opcional · AddItemModal: el selector muestra lo que se envía', () => {
  it('sin elegir: se ve «Sin ubicación» y la pieza viaja SIN `locationId`', async () => {
    const spy = vi.spyOn(api, 'createInventoryItem').mockResolvedValue({ id: 'n1', folio: 'INV-1', status: 'in_stock', acquisitionCostCents: 0 });
    const { dialog, select } = await openAlta([fakeCard(1)]);
    expect(shown(select)).toBe(es.admin.m1.locationNone);
    expect(shown(select)).not.toBe(LOC_A.label);
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].locationId).toBeUndefined();
  });

  it('eligiendo un cajón: se ve ese cajón y se envía su id', async () => {
    const spy = vi.spyOn(api, 'createInventoryItem').mockResolvedValue({ id: 'n1', folio: 'INV-1', status: 'listed', acquisitionCostCents: 0 });
    const { dialog, select } = await openAlta([fakeCard(1)]);
    fireEvent.change(select, { target: { value: LOC_B.id } });
    expect(shown(select)).toBe(LOC_B.label);
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].locationId).toBe(LOC_B.id);
  });

  it('lote sin elegir: «Sin ubicación» visible y ninguna línea lleva `locationId`', async () => {
    const spy = vi.spyOn(api, 'batchCreateItems').mockResolvedValue({
      batchKey: 'b',
      idempotentReplay: false,
      summary: { requested: 2, createdItems: 2, failedLines: 0 },
      results: [
        { index: 0, ok: true, folios: ['INV-1'], inventoryItemIds: ['a'] },
        { index: 1, ok: true, folios: ['INV-2'], inventoryItemIds: ['b'] },
      ],
    } as BatchCreateInventoryResponse);
    const { dialog, select } = await openAlta([fakeCard(1), fakeCard(2)]);
    expect(shown(select)).toBe(es.admin.m1.locationNone);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: /Fake Card 2/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 2 cartas' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    for (const item of spy.mock.calls[0][0].items) expect(item.locationId).toBeUndefined();
  });

  it('paridad: `admin.m1.locationNone` existe en es y en', () => {
    expect(es.admin.m1.locationNone).toBe('Sin ubicación');
    expect((en.admin.m1 as Record<string, unknown>).locationNone).toBe('No location');
  });
});

describe('Ubicación opcional · VariantDrawer pasa `locationsReady` a la ficha', () => {
  function detail(): AdminInventoryItemDetailDTO {
    return { ...mockInventory[0], status: 'in_stock', ownerType: 'platform', location: undefined, movements: [], sealedProductId: null } as AdminInventoryItemDetailDTO;
  }
  async function openFicha(props: Partial<React.ComponentProps<typeof VariantDrawer>>) {
    vi.spyOn(api, 'getAdminInventoryItem').mockResolvedValue(detail());
    renderWithProviders(
      <VariantDrawer cardId="c-charizard" cardName="Charizard" cardNumber="4" finish="normal" productType="raw" onClose={() => {}} {...props} />,
      'es',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de INV-000201' }));
    const dialog = await screen.findByRole('dialog', { name: 'Detalle de pieza' });
    await within(dialog).findByRole('heading', { name: /Mover de ubicación/ });
    return dialog;
  }

  it('lista sin resolver ⇒ ⛔ «no hay ubicaciones»', async () => {
    const dialog = await openFicha({ locations: [], locationsReady: false });
    expect(within(dialog).queryByTestId('move-no-target')).toBeNull();
  });

  it('sin `locations` (nadie las cargó) ⇒ tampoco afirma que no hay', async () => {
    const dialog = await openFicha({});
    expect(within(dialog).queryByTestId('move-no-target')).toBeNull();
  });

  it('lista resuelta y vacía ⇒ sí dice «no hay» (`noTargets`)', async () => {
    const dialog = await openFicha({ locations: [], locationsReady: true });
    expect(within(dialog).getByTestId('move-no-target')).toHaveTextContent(es.admin.m1.move.noTargets);
  });
});
