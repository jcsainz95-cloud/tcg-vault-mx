/**
 * A2 (contrato v1.116.8 I-6 «Piezas del cajón», IDS-F11 (e); DESIGN_SYSTEM vIDS-10 IDS-UX.3 y §16.4 punto 5). tester-e2e
 * RECHAZÓ sobre el stack real: una pieza de liga en Holo de una carta cuyo binder solo tiene la casilla `normal` no se veía
 * en ninguna casilla. La lista de la casilla raw `(carta, F)` = la lectura de hoy (`finish=F`) ∪ una segunda lectura
 * `stamped=true` SIN `finish`, quedándose solo con las piezas cuyo acabado no tiene casilla raw en el binder
 * (`cardFinishes`). «Piezas (n)» = el total sin filtrar; pista bajo el título si alguna fila no es inglés sin liga; la
 * baja rápida cuenta solo la primera lectura; vacío filtrado con «Quitar filtros»; «Mostrando n de N» con filtro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { InventoryItemDTO, Paginated } from '@/types/contract';
import { mockCards } from '@/lib/mock/fixtures';
import { VariantDrawer } from './VariantDrawer';

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => vi.restoreAllMocks());

const card = mockCards.find((c) => c.id === 'c-pikachu')!;
const LEAGUE = { type: 'league' as const, label: null, productId: 651001 };

function piece(o: Partial<InventoryItemDTO> & Pick<InventoryItemDTO, 'id' | 'folio' | 'finish'>): InventoryItemDTO {
  return {
    card,
    productType: 'raw',
    rawCondition: 'NM',
    status: 'in_stock',
    ownerType: 'platform',
    acquisitionType: 'compra',
    version: { key: 'en', language: 'en', stamp: null },
    ...o,
  } as InventoryItemDTO;
}
const SLOT_EN = piece({ id: 'p-1', folio: 'INV-000801', finish: 'normal' });
const SLOT_ES = piece({ id: 'p-2', folio: 'INV-000802', finish: 'normal', version: { key: 'es', language: 'es', stamp: null } });
const LEAGUE_HOLO = piece({ id: 'p-3', folio: 'INV-000803', finish: 'holofoil', version: { key: 'en.651001', language: 'en', stamp: LEAGUE } });
/** Liga en `normal`: SÍ tiene casilla raw (`normal` ∈ cardFinishes) ⇒ vive en esa casilla, no en la de Holo. */
const LEAGUE_NORMAL = piece({ id: 'p-4', folio: 'INV-000804', finish: 'normal', version: { key: 'en.651001', language: 'en', stamp: LEAGUE } });

const page = (data: InventoryItemDTO[]): Paginated<InventoryItemDTO> => ({ data, total: data.length, page: 1, pageSize: 100 });

/** Simulador del servidor: `finish=F` ⇒ piezas de ese acabado; `stamped=true` ⇒ todas las de liga de la carta. */
function spyInventory(slot: InventoryItemDTO[], league: InventoryItemDTO[]) {
  return vi.spyOn(api, 'getAdminInventory').mockImplementation(async (f = {}) => {
    if (f.stamped === 'true') return page(league.filter((p) => f.finish == null || p.finish === f.finish));
    return page(slot.filter((p) => f.finish == null || p.finish === f.finish));
  });
}

function renderDrawer(overrides: Partial<React.ComponentProps<typeof VariantDrawer>> = {}) {
  return renderWithProviders(
    <VariantDrawer cardId="c-pikachu" cardName="Pikachu" cardNumber="58" finish="normal" productType="raw" cardFinishes={['normal']} onClose={() => {}} {...overrides} />,
    'es',
  );
}
const piecesRegion = () => screen.getByRole('region', { name: /^Piezas \(\d+\)$/ });
const stampFilter = () => screen.getByRole('radiogroup', { name: 'Liga' });
const langFilter = () => screen.getByRole('radiogroup', { name: 'Idioma' });

describe('A2 (e) · piezas del cajón: segunda lectura `stamped=true` filtrada a los acabados sin casilla', () => {
  it('la pieza de liga en Holo (sin casilla en un binder solo `normal`) aparece en la casilla `normal` con su versión; dos lecturas con el query exacto', async () => {
    const spy = spyInventory([SLOT_EN], [LEAGUE_HOLO]);
    renderDrawer();
    expect(await screen.findByText(/INV-000803/)).toBeInTheDocument();
    expect(screen.getByText(/INV-000801/)).toBeInTheDocument();
    const row = screen.getByText(/INV-000803/).closest('li')!;
    expect(within(row).getByTestId('piece-version')).toHaveTextContent('ENDe liga');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const queries = spy.mock.calls.map((c) => c[0]!);
    expect(queries).toContainEqual({ cardId: 'c-pikachu', finish: 'normal', productType: 'raw', ownerType: 'platform', pageSize: 100 });
    expect(queries).toContainEqual({ cardId: 'c-pikachu', productType: 'raw', ownerType: 'platform', pageSize: 100, stamped: 'true' });
    // «Piezas (n)» suma las dos lecturas.
    expect(screen.getByRole('heading', { level: 3, name: 'Piezas (2)' })).toBeInTheDocument();
  });

  it('una pieza de liga cuyo acabado SÍ tiene casilla no se duplica en otra casilla', async () => {
    spyInventory([piece({ id: 'p-9', folio: 'INV-000809', finish: 'holofoil' })], [LEAGUE_NORMAL, LEAGUE_HOLO]);
    renderDrawer({ finish: 'holofoil', cardFinishes: ['normal', 'holofoil'] });
    expect(await screen.findByText(/INV-000809/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    // La liga en `normal` vive en la casilla `normal`; la liga en Holo tiene casilla (`holofoil` ∈ cardFinishes), así que
    // solo entraría por la primera lectura (`finish=holofoil`), nunca por la segunda: aquí no entra por ninguna.
    expect(screen.queryByText(/INV-000804/)).toBeNull();
    expect(screen.queryByText(/INV-000803/)).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Piezas (1)' })).toBeInTheDocument();
  });

  it('sin `cardFinishes` (sellado/gradeadas o quien no lo sabe) ⇒ solo la lectura de hoy', async () => {
    const spy = spyInventory([SLOT_EN], [LEAGUE_HOLO]);
    renderDrawer({ cardFinishes: undefined });
    expect(await screen.findByText(/INV-000801/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/INV-000803/)).toBeNull();
  });

  it('pista bajo «Piezas (n)» solo si alguna fila no es inglés sin liga; sin `role`', async () => {
    spyInventory([SLOT_EN], [LEAGUE_HOLO]);
    renderDrawer();
    await screen.findByText(/INV-000803/);
    const note = screen.getByText('La casilla cuenta solo inglés sin liga. Las piezas en español o de liga se ven aquí.');
    expect(note).not.toHaveAttribute('role');
    const heading = screen.getByRole('heading', { level: 3, name: 'Piezas (2)' });
    const filters = screen.getByText('Filtrar piezas');
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(after(heading, note)).toBe(true);
    expect(after(note, filters)).toBe(true);
  });

  it('todas inglés sin liga ⇒ sin pista', async () => {
    spyInventory([SLOT_EN], []);
    renderDrawer();
    await screen.findByText(/INV-000801/);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/La casilla cuenta solo inglés sin liga/)).toBeNull();
  });

  it('«Piezas (n)» no cambia con el filtro; «Mostrando n de N» con filtro activo; «Sin liga» esconde la segunda lectura', async () => {
    spyInventory([SLOT_EN, SLOT_ES], [LEAGUE_HOLO]);
    renderDrawer();
    await screen.findByText(/INV-000803/);
    expect(screen.getByRole('heading', { level: 3, name: 'Piezas (3)' })).toBeInTheDocument();
    expect(screen.queryByText(/^Mostrando \d+ de \d+$/)).toBeNull();
    fireEvent.click(within(stampFilter()).getByRole('radio', { name: 'Sin liga' }));
    await waitFor(() => expect(screen.queryByText(/INV-000803/)).toBeNull());
    expect(screen.getByText(/INV-000801/)).toBeInTheDocument();
    expect(screen.getByText(/INV-000802/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Piezas (3)' })).toBeInTheDocument();
    expect(screen.getByText('Mostrando 2 de 3')).toBeInTheDocument();
    fireEvent.click(within(langFilter()).getByRole('radio', { name: 'Español' }));
    await waitFor(() => expect(screen.queryByText(/INV-000801/)).toBeNull());
    expect(screen.getByText('Mostrando 1 de 3')).toBeInTheDocument();
    fireEvent.click(within(stampFilter()).getByRole('radio', { name: 'De liga' }));
    await waitFor(() => expect(screen.queryByText(/INV-000802/)).toBeNull());
    expect(screen.getByText('Mostrando 0 de 3')).toBeInTheDocument();
  });

  it('vacío filtrado ⇒ «Ninguna pieza con este filtro.» + «Quitar filtros» (44 px) que restaura; nunca «Sin piezas de esta variante» con piezas ocultas', async () => {
    spyInventory([SLOT_EN], [LEAGUE_HOLO]);
    renderDrawer();
    await screen.findByText(/INV-000803/);
    fireEvent.click(within(langFilter()).getByRole('radio', { name: 'Español' }));
    await waitFor(() => expect(screen.getByText('Ninguna pieza con este filtro.')).toBeInTheDocument());
    expect(screen.queryByText('Sin piezas de esta variante.')).toBeNull();
    const clear = screen.getByRole('button', { name: 'Quitar filtros' });
    expect(clear.className).toMatch(/min-h-\[44px\]|min-h-11/);
    fireEvent.click(clear);
    await waitFor(() => expect(screen.getByText(/INV-000801/)).toBeInTheDocument());
    expect(within(langFilter()).getByRole('radio', { name: 'Todos' })).toHaveAttribute('aria-checked', 'true');
    expect(within(stampFilter()).getByRole('radio', { name: 'Todas' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Ninguna pieza con este filtro.')).toBeNull();
  });

  it('casilla realmente vacía (sin piezas en ninguna lectura) ⇒ «Sin piezas de esta variante.» y el alta se abre sola', async () => {
    spyInventory([], []);
    renderDrawer();
    expect(await screen.findByText('Sin piezas de esta variante.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Alta rápida' })).toBeInTheDocument();
  });

  it('casilla sin piezas propias pero con una de liga sin casilla ⇒ NO está vacía', async () => {
    spyInventory([], [LEAGUE_HOLO]);
    renderDrawer();
    expect(await screen.findByText(/INV-000803/)).toBeInTheDocument();
    expect(screen.queryByText('Sin piezas de esta variante.')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Piezas (1)' })).toBeInTheDocument();
  });

  it('la baja rápida cuenta solo la primera lectura (las piezas de liga sin casilla no se dan de baja desde aquí)', async () => {
    spyInventory([SLOT_EN], [LEAGUE_HOLO]);
    renderDrawer();
    await screen.findByText(/INV-000803/);
    fireEvent.click(screen.getByRole('button', { name: 'Baja rápida' }));
    expect(await screen.findByText('1 piezas disponibles para dar de baja.')).toBeInTheDocument();
  });

  it('tras un alta en el cajón se releen las dos lecturas y no hay toast: el banner del panel es el único aviso', async () => {
    const league: InventoryItemDTO[] = [];
    const spy = spyInventory([SLOT_EN], league);
    vi.spyOn(api, 'getCardVersions').mockResolvedValue({ combos: [], candidates: [] });
    vi.spyOn(api, 'batchCreateItems').mockImplementation(async () => {
      league.push(LEAGUE_HOLO);
      return { batchKey: 'k', idempotentReplay: false, summary: { requested: 1, createdItems: 1, failedLines: 0 }, results: [{ index: 0, ok: true, folios: ['INV-000803'], inventoryItemIds: ['p-3'] }] };
    });
    const onToast = vi.fn();
    renderDrawer({ onToast, pricing: undefined });
    await screen.findByText(/INV-000801/);
    fireEvent.click(screen.getByRole('button', { name: 'Alta rápida' }));
    const panel = await screen.findByRole('region', { name: 'Alta rápida' });
    fireEvent.change(within(panel).getByLabelText('Costo TOTAL de la factura, IVA incluido (MXN)'), { target: { value: '100' } });
    const cta = within(panel).getByRole('button', { name: 'Dar de alta al inventario' });
    await waitFor(() => expect(cta).toBeEnabled());
    fireEvent.click(cta);
    expect(await within(panel).findByRole('status')).toHaveTextContent('Pieza dada de alta · INV-000803.');
    expect(await within(piecesRegion()).findByText(/INV-000803/)).toBeInTheDocument();
    expect(onToast).not.toHaveBeenCalled();
    expect(spy.mock.calls.filter((c) => c[0]?.stamped === 'true').length).toBeGreaterThanOrEqual(2);
    expect(within(piecesRegion()).getByText(/La casilla cuenta solo inglés sin liga/)).toBeInTheDocument();
  });
});
