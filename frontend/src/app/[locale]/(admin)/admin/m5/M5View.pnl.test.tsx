import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
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
    // 💰 rev BSD-1: la página gana UNA casilla global (filtro «solo con alerta en su guía de entrada»); en la FICHA, cero.
    expect(within(screen.getByTestId('m5-request-sr-pnl')).queryAllByRole('checkbox')).toHaveLength(0);
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

describe('§60.5 b · ✏ §BSD-UX.6a · la fila `aceptada` dice dónde está la acción', () => {
  it('«Aceptada. Si al llegar…» bajo sus acciones (UX-BSD-10: ⛔ «ya no se cancela»), y ningún «Cancelar»', async () => {
    await render('aceptada', [item('it-a', 'Alakazam', 'buy')]);
    expect(screen.getByTestId('m5-accepted-note-sr-pnl')).toHaveTextContent(
      'Aceptada. Si al llegar alguna carta viene en mala condición, la rechazas al revisar, diciendo el motivo.',
    );
    expect(document.body.textContent).not.toContain('ya no se cancela');
    expect(screen.queryByRole('button', { name: /Cancelar/ })).not.toBeInTheDocument();
  });
});

/**
 * F-33 · **BRJ-UI-5 = FE-BRJ-4** (`DESIGN_SYSTEM §60.14` · contrato §PNL.10.2 / §PNL.10.6): la decisión por carta sobre una
 * carta que ya es inventario o ya se pagó responde `409 CONFLICT { itemId, itemStatus, reason: 'ITEM_FINAL' }`. La
 * pantalla lo distingue por `details.reason` ANTES que cualquier otra rama del 409: cierra el diálogo, recarga la
 * solicitud, y pinta en la fila el texto de ux-ui con `role="status"` y el foco en el aviso. ⛔ Ni el genérico
 * «Hubo un conflicto con el estado actual», ni `CONFLICT_WITH_DETAILS` (habla de la SOLICITUD), ni el `message` del servidor.
 */
describe('F-33 · BRJ-UI-5 = FE-BRJ-4 — `409 CONFLICT {reason: ITEM_FINAL}`', () => {
  // Los textos se leen de la TABLA de §60.14 (el candado de literalidad de §26/§27 no parsea §60).
  const DS = readFileSync(resolvePath(__dirname, '../../../../../../../docs/DESIGN_SYSTEM.md'), 'utf8');
  function dsRow(key: string): { es: string; en: string } {
    const line = DS.split('\n').find((l) => l.startsWith(`| \`error.${key}\` |`));
    if (!line) throw new Error(`§60.14 no tiene la fila error.${key}`);
    const [, esText, enText] = line.split(' | ').map((c) => c.replace(/^\| |\s*\|$/g, '').trim());
    return { es: esText, en: enText };
  }
  const TAIL = 'No se guardó nada y reintentar no lo cambia: actualizamos la solicitud para que veas su estado real.';
  const CONVERTED = `Esta carta ya entró al inventario, así que aquí ya no se aprueba, ajusta ni rechaza; si hay algo que corregir en la pieza, se hace desde «Inventario». ${TAIL}`;
  const PAID = `Esta carta ya se le pagó al vendedor, así que ya no se aprueba, ajusta ni rechaza. ${TAIL}`;
  const SERVER_MSG = 'Item is final (convertida_inventario)';

  function itemFinal(itemStatus?: string) {
    return new ApiClientError(409, {
      code: 'CONFLICT',
      message: SERVER_MSG,
      details: itemStatus === undefined ? { itemId: 'it-a', reason: 'ITEM_FINAL' } : { itemId: 'it-a', itemStatus, reason: 'ITEM_FINAL' },
    });
  }
  /** Vista vieja: la carta sale `recibida` (con botones); tras recargar, el servidor la devuelve en `finalStatus`. */
  async function renderStale(finalStatus: SellItemDTO['itemStatus']) {
    const stale = row('verificacion', [item('it-a', 'Alakazam', null), item('it-b', 'Blastoise', null)]);
    const fresh = row('verificacion', [{ ...item('it-a', 'Alakazam', null), itemStatus: finalStatus, approvedPriceCents: 8_000 }, item('it-b', 'Blastoise', null)]);
    const list = vi
      .spyOn(api, 'getAdminBuylist')
      .mockResolvedValueOnce({ data: [stale], page: 1, pageSize: 25, total: 1 })
      .mockResolvedValue({ data: [fresh], page: 1, pageSize: 25, total: 1 });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${TAB_LABELS.verificando}`) }));
    await screen.findByText('sr-pnl');
    return list;
  }
  function expectNoDecisionControls() {
    const r = screen.getByTestId('m5-item-it-a');
    for (const name of [es.admin.m5.approve, es.admin.m5.adjust, es.admin.m5.reject]) {
      expect(within(r).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(within(r).queryByRole('checkbox')).not.toBeInTheDocument();
  }
  function expectNoWrongText() {
    expect(document.body.textContent).not.toContain(es.error.CONFLICT);
    expect(document.body.textContent).not.toContain(SERVER_MSG);
    expect(document.body.textContent).not.toContain('Esta solicitud ya está cerrada');
  }

  it('los dos catálogos dicen lo que dice la tabla de §60.14, carácter por carácter', () => {
    const e = es.error as unknown as Record<string, string>;
    const n = en.error as unknown as Record<string, string>;
    for (const key of ['CONFLICT_ITEM_FINAL', 'CONFLICT_ITEM_FINAL_WITH_DETAILS']) {
      expect(e[key], `es error.${key}`).toBe(dsRow(key).es);
      expect(n[key], `en error.${key}`).toBe(dsRow(key).en);
    }
  });

  it('Rechazar (diálogo) sobre una carta ya convertida ⇒ diálogo cerrado, recarga, texto de `convertida_inventario` en la fila con el foco', async () => {
    const decide = vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(itemFinal('convertida_inventario'));
    const list = await renderStale('convertida_inventario');
    fireEvent.click(within(screen.getByTestId('m5-item-it-a')).getByRole('button', { name: es.admin.m5.reject }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(es.admin.m5.rejectReasonLabel), { target: { value: 'Borde dañado' } });
    fireEvent.click(within(dialog).getByRole('button', { name: es.admin.m5.rejectConfirm }));

    const notice = await screen.findByText(CONVERTED);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(notice.closest('[role="alert"]')).toBeNull();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expectNoDecisionControls());
    await waitFor(() => expect(document.activeElement?.contains(screen.getByText(CONVERTED))).toBe(true));
    expectNoWrongText();
  });

  it('Aprobar (fila) sobre una carta ya pagada ⇒ texto de `pagada`, recarga, sin botones ni casilla', async () => {
    vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(itemFinal('pagada'));
    const list = await renderStale('pagada');
    fireEvent.click(within(screen.getByTestId('m5-item-it-a')).getByRole('button', { name: es.admin.m5.approve }));
    const notice = await screen.findByText(PAID);
    expect(notice.closest('[role="status"]')).not.toBeNull();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expectNoDecisionControls());
    expectNoWrongText();
  });

  it.each([['sin `itemStatus`', undefined], ['con un `itemStatus` que la pantalla no conoce', 'archivada']] as const)(
    'Ajustar (diálogo) %s ⇒ la base `error.CONFLICT_ITEM_FINAL`',
    async (_c, itemStatus) => {
      vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(itemFinal(itemStatus));
      await renderStale('convertida_inventario');
      fireEvent.click(within(screen.getByTestId('m5-item-it-a')).getByRole('button', { name: es.admin.m5.adjust }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: es.admin.m5.adjustConfirm }));
      expect(await screen.findByText(es.error.CONFLICT_ITEM_FINAL)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expectNoWrongText();
    },
  );
});

describe('F-33 · el mock de `PATCH …/decision` espeja el peldaño ITEM_FINAL (§PNL.10.2)', () => {
  it.each(['convertida_inventario', 'pagada'] as const)('%s ⇒ 409 CONFLICT {itemId, itemStatus, reason} y la carta intacta, en los tres verbos', async (status) => {
    const fx = await import('@/lib/mock/fixtures');
    const target = fx.mockAdminBuylist.flatMap((r) => r.items)[0];
    const before = { ...target };
    target.itemStatus = status;
    try {
      for (const input of [
        { decision: 'approve' as const },
        { decision: 'adjust' as const, approvedPriceCents: 1 },
        { decision: 'reject' as const, reason: 'Borde dañado' },
      ]) {
        const err = await api.decideBuylistItem(target.id, input).then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).status).toBe(409);
        expect((err as ApiClientError).code).toBe('CONFLICT');
        expect((err as ApiClientError).details).toEqual({ itemId: target.id, itemStatus: status, reason: 'ITEM_FINAL' });
        expect(target.itemStatus).toBe(status);
        expect(target.approvedPriceCents).toBe(before.approvedPriceCents);
      }
    } finally {
      Object.assign(target, before);
    }
  });
});

/**
 * v1.82.3 · contrato §PNL.12.3 — **«Rechazar solicitud» lo enciende el SERVIDOR (`isRejectable`)**.
 * El defecto: `allItemsRejected` era la copia local de la Regla C **sin el filtro `skip`**; con una `skip` viva la
 * solicitud quedaba en `verificacion` sin salida en el panel. Se borró: la pantalla lee `req.isRejectable === true`.
 * Las filas se fuerzan con `isRejectable` explícito: aquí se mide la PANTALLA, no la derivación del mock
 * (ésa vive en `lib/mock/rejectability.test.ts`).
 */
describe('§PNL.12 · FE-SKP — «Rechazar solicitud» sale de `isRejectable`', () => {
  const rejected = (id: string, name: string): SellItemDTO => ({
    ...item(id, name, 'buy'), itemStatus: 'rechazada', rejectionReason: 'mala condición', rejectedAt: '2026-09-04T00:00:00.000Z',
  });
  async function renderRow(r: ReturnType<typeof row>) {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [r], page: 1, pageSize: 25, total: 1 });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${TAB_LABELS.verificando}`) }));
    await screen.findByText('sr-pnl');
  }

  it('FE-SKP-1 · `isRejectable: true` con las `buy` rechazadas y una `skip` viva ⇒ botón visible y llama `POST …/reject`', async () => {
    const r = { ...row('verificacion', [rejected('it-a', 'Alakazam'), rejected('it-b', 'Blastoise'), item('it-s', 'Squirtle', 'skip')]), isRejectable: true };
    const spy = vi.spyOn(api, 'rejectBuylistRequest').mockResolvedValue({ ...r, status: 'rechazada', isTerminal: true, isRejectable: false });
    await renderRow(r);
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar solicitud' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar solicitud completa' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar solicitud' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-pnl', { reason: undefined }));
  });

  it('FE-SKP-2 · todas `rechazada` pero `isRejectable: false` ⇒ sin botón', async () => {
    await renderRow({ ...row('verificacion', [rejected('it-a', 'Alakazam'), rejected('it-b', 'Blastoise')]), isRejectable: false });
    expect(screen.queryByRole('button', { name: 'Rechazar solicitud' })).not.toBeInTheDocument();
  });

  it('FE-SKP-2 · todas `rechazada` y `isRejectable` AUSENTE (backend previo a v1.82.3) ⇒ sin botón: fail-closed', async () => {
    const legacy: Record<string, unknown> = { ...row('verificacion', [rejected('it-a', 'Alakazam'), rejected('it-b', 'Blastoise')]) };
    delete legacy.isRejectable;
    await renderRow(legacy as unknown as ReturnType<typeof row>);
    expect(screen.queryByRole('button', { name: 'Rechazar solicitud' })).not.toBeInTheDocument();
  });
});
