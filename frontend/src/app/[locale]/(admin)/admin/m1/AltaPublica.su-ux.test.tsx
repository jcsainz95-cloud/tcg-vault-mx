import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { BatchCreateInventoryResponse, CardDTO, InventoryStatus, Paginated } from '@/types/contract';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import { AddItemModal } from './AddItemModal';
import { AddGradedModal } from './AddGradedModal';
import { QuickAddSection } from './QuickAdd';
import { M1View } from './M1View';

/**
 * ⭐ **SU.8 — el alta dispara la publicación: candados SU-UX-7…11** (`DESIGN_SYSTEM §SU-UX.6–7` vSU-2,
 * `API_CONTRACT §M1-SU` SU.8.3–SU.8.5; SU-UX-7 es el SU-F2 del contrato). El aviso tras el alta dice si la pieza
 * **ya está a la venta** según el `status` del `201` (no según el precio del formulario), el lote añade la nota
 * condicional sin tocar el texto de hoy, y toda alta correcta refresca «Listas para publicar».
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
  window.history.replaceState(null, '', '/');
});

type Dict = Record<string, unknown>;
const at = (d: Dict, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], d);

const NOTE_ES = es.admin.m1.batchPublishNote;

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

function created(status: InventoryStatus, folio = 'INV-000777') {
  return { id: 'inv-new-1', folio, status, acquisitionCostCents: 0 };
}

function batchResult(failed: number): BatchCreateInventoryResponse {
  const ok = [{ index: 0, ok: true as const, folios: ['INV-000501'], inventoryItemIds: ['inv-a'] }];
  const ko = failed > 0 ? [{ index: 1, ok: false as const, error: { code: 'PRICE_PENDING', message: 'price pending' } }] : [];
  return {
    batchKey: 'batch-test',
    idempotentReplay: false,
    summary: { requested: 1 + failed, createdItems: 1, failedLines: failed },
    results: [...ok, ...ko],
  } as BatchCreateInventoryResponse;
}

async function searchIn(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'Fake' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
}

/** Alta de UNA pieza por `AddItemModal` con el `status` dado; devuelve el `onToast` espiado. */
async function altaUna(status: InventoryStatus) {
  vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1)]));
  vi.spyOn(api, 'createInventoryItem').mockResolvedValue(created(status));
  const onToast = vi.fn();
  renderWithProviders(<AddItemModal onClose={() => {}} onToast={onToast} />, 'es');
  const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
  await searchIn(dialog);
  fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear item' }));
  await waitFor(() => expect(onToast).toHaveBeenCalledTimes(1));
  return onToast.mock.calls[0][0] as { variant: string; title: string; message: string; duration?: number };
}

async function altaLote(failed: number) {
  vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1), fakeCard(2)]));
  vi.spyOn(api, 'batchCreateItems').mockResolvedValue(batchResult(failed));
  const onToast = vi.fn();
  renderWithProviders(<AddItemModal onClose={() => {}} onToast={onToast} />, 'es');
  const dialog = await screen.findByRole('dialog', { name: 'Alta de carta en bóveda' });
  await searchIn(dialog);
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Seleccionar varias/ }));
  fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
  fireEvent.click(within(dialog).getByRole('option', { name: /Fake Card 2/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta 2 cartas' }));
  await waitFor(() => expect(onToast).toHaveBeenCalledTimes(1));
  return onToast.mock.calls[0][0] as { variant: string; message: string; duration?: number };
}

async function altaGradeada(status: InventoryStatus) {
  vi.spyOn(api, 'createInventoryItem').mockResolvedValue(created(status, 'INV-000888'));
  const onToast = vi.fn();
  const onCreated = vi.fn();
  renderWithProviders(
    <AddGradedModal open card={{ id: 'c-fake-1', name: 'Fake Card 1' }} onClose={() => {}} onCreated={onCreated} onToast={onToast} />,
    'es',
  );
  const dialog = await screen.findByRole('dialog', { name: 'Agregar gradeada' });
  fireEvent.change(within(dialog).getByLabelText('Número de certificado'), { target: { value: '12345678' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta al inventario' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onToast).toHaveBeenCalledTimes(1));
  return onToast.mock.calls[0][0] as { variant: string; message: string; duration?: number };
}

describe('SU-UX-7 (SU-F2) · AddItemModal: el aviso de una pieza sigue el `status` del 201', () => {
  it('`listed` ⇒ success con folio y «a la venta», sin «Aún no»; `in_stock` ⇒ info 9 s con «Aún no está a la venta» y «Listas para publicar»', async () => {
    const listed = await altaUna('listed');
    expect(listed.variant).toBe('success');
    expect(listed.message).toContain('INV-000777');
    expect(listed.message).toContain('a la venta');
    expect(listed.message).not.toContain('Aún no');
    expect(listed.title).toBe(es.admin.m1.createToastTitle);

    document.body.innerHTML = '';
    vi.restoreAllMocks();

    const notListed = await altaUna('in_stock');
    expect(notListed.variant).toBe('info');
    expect(notListed.duration).toBe(9000);
    expect(notListed.message).toContain('INV-000777');
    expect(notListed.message).toContain('Aún no está a la venta');
    expect(notListed.message).toContain('Listas para publicar');
    expect(notListed.title).toBe(es.admin.m1.createToastTitle);

    expect(notListed.message).not.toBe(listed.message);
  });
});

describe('SU-UX-8 · AddGradedModal avisa con `onToast` y sigue llamando a `onCreated`', () => {
  it('`listed` ⇒ success «a la venta»', async () => {
    const t = await altaGradeada('listed');
    expect(t.variant).toBe('success');
    expect(t.message).toBe('Gradeada dada de alta y a la venta · folio INV-000888.');
  });
  it('`in_stock` ⇒ info 9 s «Aún no está a la venta» + «Listas para publicar»', async () => {
    const t = await altaGradeada('in_stock');
    expect(t.variant).toBe('info');
    expect(t.duration).toBe(9000);
    expect(t.message).toContain('INV-000888');
    expect(t.message).toContain('Aún no está a la venta');
    expect(t.message).toContain('Listas para publicar');
  });
});

describe('SU-UX-9 · Lote: la nota se AÑADE detrás del texto de hoy', () => {
  it('AddItemModal lote sin fallos: success 9 s con `batchToastAllOk` + `batchPublishNote`', async () => {
    const t = await altaLote(0);
    expect(t.variant).toBe('success');
    expect(t.duration).toBe(9000);
    expect(t.message).toContain('1 cartas dadas de alta.');
    expect(t.message).toContain(NOTE_ES);
  });
  it('AddItemModal lote con fallos: danger con `batchToastPartial` + `batchPublishNote`', async () => {
    const t = await altaLote(1);
    expect(t.variant).toBe('danger');
    expect(t.message).toContain('1 creadas, 1 con error. Revisa el detalle.');
    expect(t.message).toContain(NOTE_ES);
  });
  it('QuickAdd: el toast trae `successOne` + `batchPublishNote`; el resultado del panel no cambia', async () => {
    vi.spyOn(api, 'batchCreateItems').mockResolvedValue(batchResult(0));
    const onToast = vi.fn();
    renderWithProviders(
      <QuickAddSection
        target={{ cardId: 'c-charizard', productType: 'raw', finish: 'normal' }}
        buyEffectiveCents={87_500}
        buySource="market"
        marketRefCents={125_000}
        onToast={onToast}
      />,
      'es',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(onToast).toHaveBeenCalledTimes(1));
    const msg = onToast.mock.calls[0][0] as string;
    expect(msg).toContain('Pieza dada de alta · INV-000501.');
    expect(msg).toContain(NOTE_ES);
    expect(await screen.findByText('Pieza dada de alta · INV-000501.')).toBeInTheDocument();
  });
});

describe('SU-UX-10 · Toda alta correcta refresca «Listas para publicar» (`[\'pending-publish\']`)', () => {
  const PENDING = { queryKey: ['pending-publish'] };

  it('AddItemModal, una pieza', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    await altaUna('in_stock');
    expect(spy).toHaveBeenCalledWith(PENDING);
  });
  it('AddItemModal, lote', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    await altaLote(0);
    expect(spy).toHaveBeenCalledWith(PENDING);
  });
  it('QuickAdd', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    vi.spyOn(api, 'batchCreateItems').mockResolvedValue(batchResult(0));
    renderWithProviders(
      <QuickAddSection target={{ cardId: 'c-charizard', productType: 'raw', finish: 'normal' }} buyEffectiveCents={87_500} buySource="market" marketRefCents={125_000} />,
      'es',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(PENDING));
  });
  it('M1View, gradeada: invalida la cola y pinta el aviso (M1View le pasa `pushToast`)', async () => {
    vi.spyOn(api, 'searchBuylistCards').mockResolvedValue(page([fakeCard(1)]));
    vi.spyOn(api, 'createInventoryItem').mockResolvedValue(created('in_stock', 'INV-000999'));
    renderWithProviders(<M1View />, 'es');
    fireEvent.click(screen.getByRole('tab', { name: 'Gradeadas' }));
    fireEvent.click((await screen.findAllByRole('button', { name: /Agregar gradeada/ }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Agregar gradeada' });
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    fireEvent.change(within(dialog).getByLabelText('Buscar carta'), { target: { value: 'Fake' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await within(dialog).findByRole('option', { name: /Fake Card 1/ }));
    fireEvent.change(within(dialog).getByLabelText('Número de certificado'), { target: { value: '12345678' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dar de alta al inventario' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(PENDING));
    expect(await screen.findByText(/Gradeada dada de alta · folio INV-000999\. Aún no está a la venta/)).toBeInTheDocument();
  });
});

describe('SU-UX-11 · Paridad de las 5 claves nuevas', () => {
  const KEYS: Array<[string, boolean]> = [
    ['admin.m1.createToastListed', true],
    ['admin.m1.createToastNotListed', true],
    ['admin.inventory.addGraded.successListed', true],
    ['admin.inventory.addGraded.successNotListed', true],
    ['admin.m1.batchPublishNote', false],
  ];
  it.each(KEYS)('%s existe en es y en, con {folio} donde toca y sin nombrar la ubicación', (key, withFolio) => {
    for (const dict of [es, en] as Dict[]) {
      const v = at(dict, key);
      expect(typeof v).toBe('string');
      expect((v as string).includes('{folio}')).toBe(withFolio);
      expect(v as string).not.toMatch(/ubicaci[oó]n|location/i);
    }
  });
});
