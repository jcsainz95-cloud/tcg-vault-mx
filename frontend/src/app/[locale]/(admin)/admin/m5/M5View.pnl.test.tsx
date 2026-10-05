import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import es from '../../../../../../messages/es.json';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { BuyDecision, CardDTO, SellItemDTO, SellRequestStatus } from '@/types/contract';
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';

/**
 * DESIGN_SYSTEM §60.5 / §60.7 a · contrato v1.82 §PNL.4 y §E2E-ADM.2.
 * - **BRJ-UI-1** (= FE-BRJ-1): seleccionar 2 de 3 `buy` (con una `skip` presente) ⇒ `itemIds` exactos; la `skip` sin casilla.
 * - **BRJ-UI-4**: `422 ITEM_NOT_OFFERED {itemIds}` ⇒ salen de la selección, el texto dice cuántas; ⛔ no el `message`.
 * - **NC-UI** (= M5-NC-1…4): `skip` ⇒ «NO COMPRADA» y ningún botón; `buy` ⇒ Aprobar y Rechazar sin Ajustar; `null`
 *   ⇒ los tres; `422 ITEM_NOT_OFFERED` de la decisión por carta ⇒ copy de §27.2.
 * - §60.5 b: la fila `aceptada` dice que no se cancela.
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const TAB_LABELS = es.admin.m5.tabs as Record<string, string>;

function card(id: string, name: string): CardDTO {
  return {
    id, externalId: id, name, number: '4', rarity: 'Rare', supertype: 'Pokémon', subtypes: [], setId: 'base1',
    setName: 'Base Set', setPtcgoCode: 'BS', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'],
  };
}
function item(id: string, name: string, offerDecision: BuyDecision | null): SellItemDTO {
  return {
    id, card: card(`c-${id}`, name), productType: 'raw', finish: 'normal', quotedPriceCents: 10_000,
    itemStatus: 'recibida', offerDecision,
  };
}
function row(status: SellRequestStatus, items: SellItemDTO[]) {
  return srv({
    id: 'sr-pnl', userId: 'u-pnl', seller: { id: 'u-pnl', name: 'Vendedor', email: 'v@example.com' }, status,
    quotedTotalCents: 30_000, createdAt: '2026-09-01T00:00:00.000Z',
    receivedAt: status === 'verificacion' ? '2026-09-02T00:00:00.000Z' : null,
    verifiedAt: status === 'verificacion' ? '2026-09-03T00:00:00.000Z' : null,
    approvedTotalCents: null, offerSentAt: '2026-09-01T10:00:00.000Z', items,
  });
}
const THREE_BUY_ONE_SKIP = () => [
  item('it-a', 'Alakazam', 'buy'),
  item('it-b', 'Blastoise', 'buy'),
  item('it-c', 'Charizard', 'buy'),
  item('it-s', 'Squirtle', 'skip'),
];

async function render(status: SellRequestStatus, items: SellItemDTO[]) {
  vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [row(status, items)], page: 1, pageSize: 25, total: 1 });
  renderWithProviders(<M5View />, 'es');
  const tab = status === 'verificacion' ? TAB_LABELS.verificando : TAB_LABELS.con_vendedor;
  fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${tab}`) }));
  await screen.findByText('sr-pnl');
}

beforeEach(() => vi.restoreAllMocks());

describe('BRJ-UI-1 · «Rechazar seleccionadas» manda los `itemIds` exactos, sin la `skip`', () => {
  it('la `skip` no tiene casilla ni cuenta en «todas»; 2 de 3 `buy` ⇒ `itemIds` exactos y el motivo recortado', async () => {
    const spy = vi.spyOn(api, 'rejectBuylistItems').mockResolvedValue({ items: [], requestClosed: false });
    await render('verificacion', THREE_BUY_ONE_SKIP());
    expect(screen.getByLabelText('Todas las que se pueden rechazar (3)')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Squirtle/ })).not.toBeInTheDocument();
    const confirmSel = screen.getByRole('button', { name: 'Rechazar seleccionadas (0)' });
    expect(confirmSel).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Charizard · it-c' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Alakazam · it-a' }));
    expect(screen.getByText('2 seleccionadas')).toBeInTheDocument();
    const master = screen.getByLabelText('Todas las que se pueden rechazar (3)') as HTMLInputElement;
    expect(master.indeterminate).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar seleccionadas (2)' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rechazar 2 cartas' });
    expect(within(dialog).getByTestId('m5-bulk-list')).toHaveTextContent('Alakazam');
    expect(within(dialog).getByTestId('m5-bulk-list')).not.toHaveTextContent('Squirtle');
    fireEvent.change(within(dialog).getByTestId('m5-bulk-reason'), { target: { value: '  llegaron con dobleces  ' } });
    fireEvent.click(within(dialog).getByTestId('m5-bulk-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Orden de la LISTA (no el del clic) y sin la `skip`.
    expect(spy).toHaveBeenCalledWith('sr-pnl', { itemIds: ['it-a', 'it-c'], reason: 'llegaron con dobleces' });
  });

  it('«Rechazar todas (3)» marca las tres rechazables y abre el MISMO diálogo', async () => {
    const spy = vi.spyOn(api, 'rejectBuylistItems').mockResolvedValue({ items: [], requestClosed: false });
    await render('verificacion', THREE_BUY_ONE_SKIP());
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar todas (3)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar 3 cartas' });
    fireEvent.change(within(dialog).getByTestId('m5-bulk-reason'), { target: { value: 'mala condición' } });
    fireEvent.click(within(dialog).getByTestId('m5-bulk-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-pnl', { itemIds: ['it-a', 'it-b', 'it-c'], reason: 'mala condición' }));
  });

  it('fuera de `verificacion` no hay barra ni casillas', async () => {
    await render('aceptada', THREE_BUY_ONE_SKIP());
    expect(screen.queryByTestId('m5-bulk-bar-sr-pnl')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('§60.5 c · tras el 200, la solicitud cerrada lo dice la PÁGINA', () => {
  it('`requestClosed: true` (§PNL.10.1) ⇒ aviso de página con las dos frases', async () => {
    vi.spyOn(api, 'rejectBuylistItems').mockResolvedValue({ items: [], requestClosed: true });
    await render('verificacion', THREE_BUY_ONE_SKIP());
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar todas (3)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar 3 cartas' });
    fireEvent.change(within(dialog).getByTestId('m5-bulk-reason'), { target: { value: 'mala condición' } });
    fireEvent.click(within(dialog).getByTestId('m5-bulk-confirm'));
    expect(await screen.findByTestId('m5-page-notice')).toHaveTextContent(
      '3 cartas rechazadas. Se le avisa al vendedor en un solo correo. La solicitud quedó cerrada: no queda ninguna carta por aprobar.',
    );
  });
});

describe('BRJ-UI-4 · `422 ITEM_NOT_OFFERED {itemIds}`', () => {
  it('esas filas salen de la selección y el texto nombra cuántas; ⛔ no aparece el `message` del servidor', async () => {
    vi.spyOn(api, 'rejectBuylistItems').mockRejectedValue(
      new ApiClientError(422, { code: 'ITEM_NOT_OFFERED', message: 'This line was not purchased', details: { itemIds: ['it-b'] } }),
    );
    await render('verificacion', THREE_BUY_ONE_SKIP());
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar todas (3)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar 3 cartas' });
    fireEvent.change(within(dialog).getByTestId('m5-bulk-reason'), { target: { value: 'mala condición' } });
    fireEvent.click(within(dialog).getByTestId('m5-bulk-confirm'));
    expect(await within(dialog).findByTestId('m5-bulk-error')).toHaveTextContent(
      'Una de las cartas elegidas no entró en la compra: se marcaron como no compradas al ofertar y no se rechazan. Las quitamos de la selección. No se guardó nada.',
    );
    expect(document.body.textContent).not.toContain('This line was not purchased');
    // Fuera de la selección y del diálogo; marcada «NO COMPRADA» en su fila.
    expect(screen.getByRole('dialog', { name: 'Rechazar 2 cartas' })).toBeInTheDocument();
    expect(screen.getByTestId('m5-not-bought-it-b')).toHaveTextContent('NO COMPRADA');
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar Blastoise · it-b' })).not.toBeInTheDocument();
  });
});

describe('NC-UI · F-4 «No comprada» (M5-NC-1…4)', () => {
  it('M5-NC-1 · `skip` ⇒ «NO COMPRADA» + su nota, y NINGÚN botón de decisión', async () => {
    await render('verificacion', [item('it-s', 'Squirtle', 'skip')]);
    const r = screen.getByTestId('m5-item-it-s');
    expect(within(r).getByText('NO COMPRADA')).toBeInTheDocument();
    expect(within(r).getByText('Se marcó como no comprada al ofertar: no se aprueba ni se rechaza.')).toBeInTheDocument();
    for (const name of [es.admin.m5.approve, es.admin.m5.adjust, es.admin.m5.reject]) {
      expect(within(r).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('M5-NC-2 · `buy` ⇒ Aprobar y Rechazar, ⛔ sin Ajustar', async () => {
    await render('verificacion', [item('it-a', 'Alakazam', 'buy')]);
    const r = screen.getByTestId('m5-item-it-a');
    expect(within(r).getByRole('button', { name: es.admin.m5.approve })).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: es.admin.m5.reject })).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: es.admin.m5.adjust })).not.toBeInTheDocument();
  });

  it('M5-NC-3 · `null` (pre-ciclo) ⇒ los tres (regresión)', async () => {
    await render('verificacion', [item('it-n', 'Nidoran', null)]);
    const r = screen.getByTestId('m5-item-it-n');
    for (const name of [es.admin.m5.approve, es.admin.m5.adjust, es.admin.m5.reject]) {
      expect(within(r).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('M5-NC-4 · el servidor responde `422 ITEM_NOT_OFFERED` a una aprobación ⇒ copy de §27.2, ⛔ no el inglés', async () => {
    vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(
      new ApiClientError(422, { code: 'ITEM_NOT_OFFERED', message: 'This line was not purchased', details: { itemId: 'it-n', offerDecision: 'skip' } }),
    );
    await render('verificacion', [item('it-n', 'Nidoran', null)]);
    fireEvent.click(within(screen.getByTestId('m5-item-it-n')).getByRole('button', { name: es.admin.m5.approve }));
    expect(await screen.findByText(es.error.ITEM_NOT_OFFERED)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('This line was not purchased');
  });
});

describe('§60.5 b · la fila `aceptada` dice dónde está la acción', () => {
  it('«Aceptada: ya no se cancela…» bajo sus acciones, y ningún «Cancelar»', async () => {
    await render('aceptada', [item('it-a', 'Alakazam', 'buy')]);
    expect(screen.getByTestId('m5-accepted-note-sr-pnl')).toHaveTextContent(
      'Aceptada: ya no se cancela. Si al llegar alguna carta viene en mala condición, la rechazas al revisar, diciendo el motivo.',
    );
    expect(screen.queryByRole('button', { name: /Cancelar/ })).not.toBeInTheDocument();
  });
});
