import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PreparationQueue } from './PreparationQueue';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  PreparationOrderDTO,
  ShipPreparationOrderDTO,
  VaultPreparationItemDTO,
  VaultPreparationOrderDTO,
  VaultPreparationStateDTO,
} from '@/types/contract';

/**
 * **Candados PV-1..PV-12 de `DESIGN_SYSTEM §36.16`** — la tarjeta «Para bóveda» (contrato
 * `§M4-VAULT` v1.79.3). PV-11 vive en `vaults/[userId]/VaultDetailView.test.tsx` (vista física) y
 * PV-12 en `M4View.test.tsx` (vacío de la cubeta). Cada prueba sirve la cola con un espía sobre
 * `getAdminPreparationQueue` y, cuando hace falta, sobre el verbo: el backend de los verbos se
 * construye en paralelo, así que la tarjeta se mide contra el CONTRATO, no contra un servidor.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const ZONES = /(Custodia de clientes|Stock de plataforma|Customer custody|Platform stock) · $/;

function counts(items: VaultPreparationItemDTO[]) {
  const c = { total: items.length, pending: 0, picked: 0, missing: 0, blocked: 0 };
  for (const i of items) {
    if (i.placeability.kind === 'blocked') c.blocked += 1;
    else c[i.prepStatus] += 1;
  }
  return c;
}

function prep(items: VaultPreparationItemDTO[], prepared = false): VaultPreparationStateDTO {
  return prepared
    ? {
        status: 'prepared',
        preparedAt: '2026-09-24T17:20:00Z',
        preparedBy: { userId: 'u-op1', name: 'Operador Bóveda' },
        ...counts(items),
      }
    : { status: 'in_progress', ...counts(items) };
}

const vItem = (id: string, over: Partial<VaultPreparationItemDTO> = {}): VaultPreparationItemDTO => ({
  placementItemId: id,
  orderItemId: `oi-${id}`,
  inventoryItemId: `inv-${id}`,
  folio: `INV-${id}`,
  quantity: 1,
  card: { name: `Carta ${id}`, setName: 'Base Set', finish: 'holofoil', conditionLabel: 'NM', imageSmallUrl: null },
  currentLocation: { kind: 'assigned', label: 'C03-F02-S15' },
  currentZone: 'platform_stock',
  prepStatus: 'pending',
  placeability: { kind: 'placeable' },
  ...over,
});

function vaultOrder(
  over: Partial<VaultPreparationOrderDTO> & { prepared?: boolean } = {},
): VaultPreparationOrderDTO {
  const { prepared, ...rest } = over;
  const items = rest.items ?? [vItem('a1')];
  return {
    destination: 'vault',
    placementId: 'vp-1',
    orderId: 'ord-1',
    orderNumber: 'TCG-000501',
    requestedAt: '2026-09-01T10:00:00Z',
    customer: { userId: 'u-1', email: 'maria@example.com', lastName: 'Gómez', fullName: 'María de la Luz Pérez Gómez' },
    suggestedLocation: {
      source: 'existing_customer_vault',
      location: { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody', customerPieceCount: 4 },
    },
    preparation: prep(items, prepared),
    ...rest,
    items,
  };
}

const shipOrder = (over: Partial<ShipPreparationOrderDTO> = {}): ShipPreparationOrderDTO => ({
  destination: 'ship',
  shipmentId: 'shp-1',
  orderId: 'ord-s',
  orderNumber: 'TCG-000400',
  requestedAt: '2026-08-01T10:00:00Z',
  customer: { lastName: 'Oak', fullName: 'Samuel Oak' },
  shipTo: {
    recipientName: 'Samuel Oak',
    line1: 'Calle 1',
    city: 'CDMX',
    state: 'CDMX',
    postalCode: '01000',
    country: 'MX',
    phone: '5550000000',
  },
  items: [
    {
      shipmentItemId: 'sit-1',
      inventoryItemId: 'inv-s1',
      folio: 'INV-S1',
      quantity: 1,
      card: { name: 'Pikachu', setName: 'Base Set', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: null },
      currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
    },
  ],
  ...over,
});

/** La cola «del servidor»: el espía lee SIEMPRE el valor actual, así una prueba puede cambiarlo. */
function serve(initial: PreparationOrderDTO[]) {
  const state = { orders: initial };
  const spy = vi
    .spyOn(api, 'getAdminPreparationQueue')
    .mockImplementation(async ({ destination } = {}) =>
      state.orders.filter((o) => !destination || o.destination === destination),
    );
  return { state, spy };
}

async function card(placementId = 'vp-1') {
  return screen.findByTestId(`prep-order-${placementId}`);
}

describe('PV · tarjeta «Para bóveda» (§36 · §M4-VAULT)', () => {
  it('PV-1 · el titular es el nombre COMPLETO; ⛔ ningún nodo propio con el apellido derivado', async () => {
    serve([vaultOrder()]);
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    const who = within(c).getByTestId('prep-customer-vp-1');
    expect(who).toHaveTextContent('María de la Luz Pérez Gómez');
    expect(who).toHaveTextContent('maria@example.com');
    expect(c).not.toHaveTextContent('Apellido no identificado');
    // «en ningún nodo propio»: ningún elemento cuyo texto ENTERO sea el apellido derivado.
    const own = Array.from(c.querySelectorAll('*')).filter((el) => el.textContent?.trim() === 'Gómez');
    expect(own).toHaveLength(0);
  });

  it('PV-2 · `fullName` null: «Sin nombre registrado» + el correo, ⛔ el prefijo del correo solo DENTRO del correo, ⛔ sin «—»', async () => {
    serve([
      vaultOrder({
        customer: { userId: 'u-780', email: 'juan.perez95@example.com', lastName: null, fullName: null },
      }),
    ]);
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    const who = within(c).getByTestId('prep-customer-vp-1');
    expect(who).toHaveTextContent('Sin nombre registrado');
    expect(who).toHaveTextContent('Esta cuenta se creó sin nombre: el cliente no nos lo ha dado. Identifícalo por su correo.');
    expect(who).toHaveTextContent('juan.perez95@example.com');
    expect(who.textContent).not.toContain('—');
    // Todo nodo de texto de la tarjeta que contenga el prefijo es el correo completo.
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const offenders: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      if (text.includes('juan.perez95') && !text.includes('juan.perez95@example.com')) offenders.push(text);
    }
    expect(offenders).toEqual([]);
    // Y en el nombre accesible de la tarjeta tampoco se cuela como nombre.
    expect(c.getAttribute('aria-label') ?? '').not.toContain('juan.perez95');
  });

  it('PV-2 (EN) · la misma ausencia en inglés', async () => {
    serve([vaultOrder({ customer: { userId: 'u-780', email: 'j@example.com', lastName: null, fullName: null } })]);
    renderWithProviders(<PreparationQueue />, 'en');
    const who = within(await card()).getByTestId('prep-customer-vp-1');
    expect(who).toHaveTextContent('No name on file');
    expect(who).toHaveTextContent("This account was created without a name: the customer hasn't given us one.");
  });

  it('PV-3 · toda etiqueta de cajón o ubicación de la tarjeta va precedida de su ZONA (paso 1 y paso 2)', async () => {
    const items = [
      vItem('a1', { prepStatus: 'picked' }),
      vItem('a2', { prepStatus: 'missing', currentLocation: { kind: 'assigned', label: 'C10-F01-S01' }, currentZone: 'platform_stock' }),
    ];
    serve([
      vaultOrder({ placementId: 'vp-1', items }),
      vaultOrder({
        placementId: 'vp-2',
        requestedAt: '2026-09-02T10:00:00Z',
        prepared: true,
        items,
        suggestedLocation: {
          source: 'multiple_drawers',
          locations: [
            { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody', customerPieceCount: 1 },
            { id: 'loc-4', label: 'C10-F01-S02', zone: 'customer_custody', customerPieceCount: 2 },
          ],
        },
      }),
    ]);
    renderWithProviders(<PreparationQueue />, 'es');

    for (const id of ['vp-1', 'vp-2']) {
      const c = await card(id);
      // Rótulo + valor están en nodos de texto distintos: se aplanan con un separador y se mira lo
      // que va justo antes de cada etiqueta.
      const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const texts: string[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = (n.textContent ?? '').trim();
        if (v) texts.push(v);
      }
      const flat = texts.join(' · ');
      const labels = [...flat.matchAll(/C\d{2}-F\d{2}-S\d{2}/g)];
      expect(labels.length, `${id}: sin etiquetas que medir`).toBeGreaterThan(0);
      for (const m of labels) {
        const before = flat.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
        expect(before, `${id}: «${m[0]}» sin zona delante`).toMatch(ZONES);
      }
    }
  });

  it('PV-4 · `multiple_drawers`: anomalía con nombre, TODOS los cajones y ⛔ ningún radio marcado al abrir', async () => {
    serve([
      vaultOrder({
        prepared: true,
        items: [vItem('a1', { prepStatus: 'picked' })],
        suggestedLocation: {
          source: 'multiple_drawers',
          locations: [
            { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody', customerPieceCount: 1 },
            { id: 'loc-4', label: 'C10-F01-S02', zone: 'customer_custody', customerPieceCount: 7 },
          ],
        },
      }),
    ]);
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    expect(within(c).getByText('Cartas en varios cajones')).toBeInTheDocument();
    const radios = within(c).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const r of radios) expect(r).not.toBeChecked();
    expect(within(c).getByRole('group', { name: '¿A qué cajón van estas cartas?' })).toBeInTheDocument();
    // ⛔ «Confirmar» apagado mientras falta elegir, con la razón visible.
    expect(within(c).getByRole('button', { name: 'Confirmar colocación' })).toBeDisabled();
    expect(within(c).getByTestId('vault-summary-vp-1')).toHaveTextContent('Elige un cajón para ver a dónde van.');
  });

  it('PV-4 · `none`: el selector de cajón NO tiene valor inicial («Sin elegir») y solo ofrece cajones de clientes activos', async () => {
    serve([vaultOrder({ prepared: true, items: [vItem('a1', { prepStatus: 'picked' })], suggestedLocation: { source: 'none' } })]);
    vi.spyOn(api, 'getLocations').mockResolvedValue([
      { id: 'loc-1', zone: 'platform_stock', box: 'C03', row: 'F02', slot: 'S15', label: 'C03-F02-S15' },
      { id: 'loc-3', zone: 'customer_custody', box: 'C10', row: 'F01', slot: 'S01', label: 'C10-F01-S01' },
      { id: 'loc-9', zone: 'customer_custody', box: 'C12', row: 'F01', slot: 'S01', label: 'C12-F01-S01', isActive: false },
    ]);
    renderWithProviders(<PreparationQueue />, 'es');

    const select = (await within(await card()).findByLabelText('Elige su cajón')) as HTMLSelectElement;
    expect(select.value).toBe('');
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(['Sin elegir', 'Custodia de clientes · C10-F01-S01']);
  });

  it('PV-5 · con `pending > 0` «Pedido preparado» está deshabilitado y su razón VISIBLE va por `aria-describedby`', async () => {
    serve([vaultOrder({ items: [vItem('a1'), vItem('a2')] })]);
    renderWithProviders(<PreparationQueue />, 'es');

    const btn = within(await card()).getByRole('button', { name: 'Pedido preparado' });
    expect(btn).toBeDisabled();
    const reasonId = btn.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    const reason = document.getElementById(reasonId as string);
    expect(reason).toHaveTextContent('Faltan 2 cartas por palomear: márcalas como «La tengo» o «No la encontré».');
    expect(reason).toBeVisible();
  });

  it('PV-5 · con `pending === 0`, habilitado (las bloqueadas no cuentan)', async () => {
    serve([
      vaultOrder({
        items: [vItem('a1', { prepStatus: 'picked' }), vItem('a2', { placeability: { kind: 'blocked', reason: 'in_withdrawal' } })],
      }),
    ]);
    renderWithProviders(<PreparationQueue />, 'es');
    expect(within(await card()).getByRole('button', { name: 'Pedido preparado' })).toBeEnabled();
  });

  it('PV-6 · una carta BLOQUEADA no tiene botones de palomeo y dice su razón en texto', async () => {
    serve([
      vaultOrder({
        items: [
          vItem('ok'),
          vItem('bl', { placeability: { kind: 'blocked', reason: 'not_in_custody' } }),
        ],
      }),
    ]);
    renderWithProviders(<PreparationQueue />, 'es');

    const row = within(await card()).getByTestId('prep-item-bl');
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
    expect(row).toHaveTextContent('No va al cajón');
    expect(row).toHaveTextContent('Ya no está a nombre del cliente en bóveda, así que no va a su cajón. No hace falta buscarla.');
    // La otra sí se palomea.
    expect(within(within(await card()).getByTestId('prep-item-ok')).getByRole('button', { name: /^La tengo:/ })).toBeInTheDocument();
  });

  it('PV-7 · paso 2: «Confirmar colocación» y «Deshacer preparado»; paso 1: ninguno; ⛔ nunca un control de guía', async () => {
    serve([
      vaultOrder({ placementId: 'vp-1', items: [vItem('a1')] }),
      vaultOrder({ placementId: 'vp-2', requestedAt: '2026-09-02T10:00:00Z', prepared: true, items: [vItem('b1', { prepStatus: 'picked' })] }),
    ]);
    renderWithProviders(<PreparationQueue />, 'es');

    const step1 = await card('vp-1');
    const step2 = await card('vp-2');
    expect(within(step1).queryByRole('button', { name: 'Confirmar colocación' })).not.toBeInTheDocument();
    expect(within(step1).queryByRole('button', { name: 'Deshacer preparado' })).not.toBeInTheDocument();
    expect(within(step1).getByTestId('vault-step-vp-1')).toHaveTextContent('Paso 1 de 2 · Junta y palomea');
    expect(within(step2).getByRole('button', { name: 'Confirmar colocación' })).toBeInTheDocument();
    expect(within(step2).getByRole('button', { name: 'Deshacer preparado' })).toBeInTheDocument();
    expect(within(step2).getByTestId('vault-step-vp-2')).toHaveTextContent('Paso 2 de 2 · Llévalas a su cajón y confirma');
    for (const c of [step1, step2]) {
      expect(within(c).queryByRole('button', { name: /gu[ií]a|tracking|guide/i })).not.toBeInTheDocument();
      expect(within(c).queryByLabelText(/gu[ií]a|paqueter/i)).not.toBeInTheDocument();
    }
  });

  it('PV-8 · «Deshacer preparado» abre un diálogo con foco en «Cancelar»; tras `200 unprepared` las marcas SIGUEN', async () => {
    const items = [vItem('a1', { prepStatus: 'picked' }), vItem('a2', { prepStatus: 'missing' })];
    serve([vaultOrder({ prepared: true, items })]);
    const spy = vi.spyOn(api, 'unprepareVaultPlacement').mockResolvedValue({
      outcome: 'unprepared',
      placement: {} as never,
      preparation: prep(items, false),
    });
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    fireEvent.click(within(c).getByRole('button', { name: 'Deshacer preparado' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Deshacer «preparado»?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    // ⛔ No es destructivo: botones neutros.
    expect(within(dialog).getByRole('button', { name: 'Deshacer preparado' }).className).not.toMatch(/bg-accent/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Deshacer preparado' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('vp-1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(await within(c).findByText('Paso 1 de 2 · Junta y palomea')).toBeInTheDocument();
    expect(within(c).getByTestId('prep-item-a1')).toHaveTextContent('Tomada');
    expect(within(c).getByTestId('prep-item-a2')).toHaveTextContent('Faltante');
    expect(within(c).getByTestId('vault-live-vp-1')).toHaveTextContent(
      'Listo: ya puedes corregir las marcas. Cuando termines, vuelve a darlo por preparado.',
    );
  });

  it('PV-9 · `409 PREPARATION_CLOSED` al palomear: la FILA ofrece «Deshacer preparado» ahí mismo', async () => {
    serve([vaultOrder({ items: [vItem('a1')] })]);
    vi.spyOn(api, 'setVaultPrepItem').mockRejectedValue(
      new ApiClientError(409, { code: 'PREPARATION_CLOSED', message: 'closed', details: { preparedAt: '2026-09-24T17:20:00Z' } }),
    );
    renderWithProviders(<PreparationQueue />, 'es');

    const row = within(await card()).getByTestId('prep-item-a1');
    fireEvent.click(within(row).getByRole('button', { name: /^La tengo:/ }));

    const alert = await within(row).findByRole('alert');
    expect(alert).toHaveTextContent('Este pedido ya se dio por preparado y sus marcas están fijas.');
    expect(within(alert).getByRole('button', { name: 'Deshacer preparado' })).toBeInTheDocument();
  });

  it('PV-10 · en «Ambas», la tarjeta de ENVÍO no tiene casillas, «La tengo» ni línea de paso', async () => {
    serve([shipOrder(), vaultOrder()]);
    renderWithProviders(<PreparationQueue />, 'es');

    const ship = await screen.findByTestId('prep-order-shp-1');
    await card();
    expect(within(ship).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(ship).queryByText(/La tengo/)).not.toBeInTheDocument();
    expect(ship).not.toHaveTextContent(/Paso \d de 2/);
    expect(within(ship).queryByRole('button', { name: /Pedido preparado|Confirmar colocación/ })).not.toBeInTheDocument();
  });
});

describe('Tarjeta «Para bóveda» · verbos y respuestas (§36.5–§36.9)', () => {
  it('palomear: la marca se pinta con la RESPUESTA del servidor (sin optimismo) y el conteo vive en la región viva', async () => {
    const items = [vItem('a1'), vItem('a2')];
    serve([vaultOrder({ items })]);
    const picked = { ...items[0], prepStatus: 'picked' as const };
    const spy = vi.spyOn(api, 'setVaultPrepItem').mockResolvedValue({
      changed: true,
      item: picked,
      preparation: prep([picked, items[1]]),
    });
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    const live = within(c).getByTestId('vault-live-vp-1');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveTextContent('0 tomadas · 0 faltantes · 2 por palomear');
    fireEvent.click(within(within(c).getByTestId('prep-item-a1')).getByRole('button', { name: 'La tengo: Carta a1 · INV-a1' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('vp-1', 'a1', 'picked'));
    await waitFor(() => expect(within(c).getByTestId('prep-item-a1')).toHaveTextContent('Tomada'));
    expect(live).toHaveTextContent('1 tomada · 0 faltantes · 1 por palomear');
    // Y el nodo es el MISMO (región siempre montada).
    expect(within(c).getByTestId('vault-live-vp-1')).toBe(live);
  });

  it('«No la encontré»: faltante con su frase, que ⛔ no promete reembolso ni aviso', async () => {
    const items = [vItem('a1')];
    serve([vaultOrder({ items })]);
    const missing = { ...items[0], prepStatus: 'missing' as const };
    vi.spyOn(api, 'setVaultPrepItem').mockResolvedValue({ changed: true, item: missing, preparation: prep([missing]) });
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    fireEvent.click(within(c).getByRole('button', { name: /^No la encontré:/ }));
    const row = within(c).getByTestId('prep-item-a1');
    await waitFor(() => expect(row).toHaveTextContent('Faltante'));
    expect(row).toHaveTextContent('Queda anotada como faltante. No se mueve al cajón. Esta pantalla no avisa al cliente ni hace reembolsos.');
    // Todas faltantes ⇒ se puede preparar igual, con el aviso de «nada al cajón».
    expect(within(c).getByText('Ninguna carta está tomada: al final no se guardará nada en el cajón.')).toBeInTheDocument();
  });

  it('H-4 · paso 2 sin cartas tomadas: ⛔ sin selector, botón «Cerrar pedido sin guardar nada» y `confirm` SIN `locationId`', async () => {
    const items = [vItem('a1', { prepStatus: 'missing' })];
    serve([vaultOrder({ prepared: true, items, suggestedLocation: { source: 'none' } })]);
    const locs = vi.spyOn(api, 'getLocations');
    const spy = vi.spyOn(api, 'confirmVaultPlacement').mockResolvedValue({
      outcome: 'nothing_to_place',
      placement: { orderNumber: 'TCG-000501' } as never,
      items: [{ inventoryItemId: 'inv-a1', folio: 'INV-a1', result: 'missing' }],
    });
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    expect(within(c).queryByLabelText('Elige su cajón')).not.toBeInTheDocument();
    expect(within(c).queryAllByRole('radio')).toHaveLength(0);
    expect(locs).not.toHaveBeenCalled();
    expect(within(c).getByTestId('vault-summary-vp-1')).toHaveTextContent(
      'Ninguna carta está tomada: el pedido se cierra y sale de la lista. Las faltantes siguen anotadas.',
    );
    fireEvent.click(within(c).getByRole('button', { name: 'Cerrar pedido sin guardar nada' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('vp-1', {}));

    const notice = await screen.findByTestId('prep-notice');
    expect(notice).toHaveTextContent(
      'Pedido TCG-000501 cerrado sin guardar nada: ninguna carta estaba para el cajón. Las faltantes siguen anotadas en «Qué debe haber» del cliente.',
    );
    await waitFor(() => expect(document.activeElement).toBe(notice));
  });

  it('colocar en SU cajón: sin selector, resumen con zona, y el aviso de resultado queda ENCIMA de la lista', async () => {
    const items = [vItem('a1', { prepStatus: 'picked' }), vItem('a2', { prepStatus: 'missing' })];
    const { state } = serve([vaultOrder({ prepared: true, items })]);
    const spy = vi.spyOn(api, 'confirmVaultPlacement').mockImplementation(async () => {
      state.orders = []; // el servidor ya no la tiene pendiente
      return {
        outcome: 'placed',
        placement: {
          orderNumber: 'TCG-000501',
          location: { id: 'loc-3', label: 'C10-F01-S01', zone: 'customer_custody' },
        } as never,
        items: [
          { inventoryItemId: 'inv-a1', folio: 'INV-a1', result: 'moved' },
          { inventoryItemId: 'inv-a2', folio: 'INV-a2', result: 'missing' },
        ],
      };
    });
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    expect(within(c).getByTestId('vault-summary-vp-1')).toHaveTextContent(
      'Se guardan 1 carta en Custodia de clientes · C10-F01-S01.',
    );
    expect(within(c).getByTestId('vault-summary-vp-1')).toHaveTextContent('1 faltante no se mueve.');
    const confirmBtn = within(c).getByRole('button', { name: 'Confirmar colocación' });
    expect(confirmBtn.getAttribute('aria-describedby')).toBe(within(c).getByTestId('vault-summary-vp-1').id);
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('vp-1', { locationId: 'loc-3' }));
    const notice = await screen.findByTestId('prep-notice');
    expect(notice).toHaveTextContent('Pedido TCG-000501 colocado: 1 carta en Custodia de clientes · C10-F01-S01.');
    expect(notice).toHaveTextContent('1 faltante no se movió.');
    await waitFor(() => expect(screen.queryByTestId('prep-order-vp-1')).not.toBeInTheDocument());
  });

  it('`409 PLACEMENT_NOT_PENDING {placed, location}`: la tarjeta sale y el aviso NOMBRA el cajón (H-2)', async () => {
    const items = [vItem('a1', { prepStatus: 'picked' })];
    const { state } = serve([vaultOrder({ prepared: true, items })]);
    vi.spyOn(api, 'confirmVaultPlacement').mockImplementation(async () => {
      state.orders = [];
      throw new ApiClientError(409, {
        code: 'PLACEMENT_NOT_PENDING',
        message: 'placed',
        details: { status: 'placed', location: { id: 'loc-4', label: 'C10-F01-S02', zone: 'customer_custody' } },
      });
    });
    renderWithProviders(<PreparationQueue />, 'es');

    fireEvent.click(within(await card()).getByRole('button', { name: 'Confirmar colocación' }));
    const notice = await screen.findByTestId('prep-notice');
    expect(within(notice).getByRole('alert')).toHaveTextContent(
      'Otra persona ya colocó este pedido. No se cambió nada; sale de la lista.',
    );
    expect(notice).toHaveTextContent('Quedó en Custodia de clientes · C10-F01-S02.');
    await waitFor(() => expect(screen.queryByTestId('prep-order-vp-1')).not.toBeInTheDocument());
  });

  it('`422 location_required` (pantalla vieja): copy propio y se vuelve a pedir la cola', async () => {
    const items = [vItem('a1', { prepStatus: 'missing' })];
    const { spy: queueSpy } = serve([vaultOrder({ prepared: true, items })]);
    vi.spyOn(api, 'confirmVaultPlacement').mockRejectedValue(
      new ApiClientError(422, { code: 'LOCATION_NOT_AVAILABLE', message: 'x', details: { reason: 'location_required', pickedCount: 1 } }),
    );
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    const before = queueSpy.mock.calls.length;
    fireEvent.click(within(c).getByRole('button', { name: 'Cerrar pedido sin guardar nada' }));
    expect(await within(c).findByRole('alert')).toHaveTextContent(
      'Este pedido ya tiene cartas tomadas, así que hay que elegir su cajón',
    );
    await waitFor(() => expect(queueSpy.mock.calls.length).toBeGreaterThan(before));
  });

  it('`409 CONFLICT` de un verbo: copy PROPIO de la tarjeta, ⛔ no el genérico y ⛔ sin «Reintentar»', async () => {
    serve([vaultOrder({ items: [vItem('a1', { prepStatus: 'picked' })] })]);
    vi.spyOn(api, 'prepareVaultPlacement').mockRejectedValue(new ApiClientError(409, { code: 'CONFLICT', message: 'x' }));
    renderWithProviders(<PreparationQueue />, 'es');

    const c = await card();
    fireEvent.click(within(c).getByRole('button', { name: 'Pedido preparado' }));
    const alert = await within(c).findByRole('alert');
    expect(alert).toHaveTextContent(
      'Este pedido tiene datos que no cuadran y no se puede tocar desde aquí. Avisa al súper-admin.',
    );
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('`409 PREPARATION_INCOMPLETE`: dice cuántas faltan (ICU) y que alguien pudo deshacer una marca', async () => {
    serve([vaultOrder({ items: [vItem('a1', { prepStatus: 'picked' })] })]);
    vi.spyOn(api, 'prepareVaultPlacement').mockRejectedValue(
      new ApiClientError(409, { code: 'PREPARATION_INCOMPLETE', message: 'x', details: { pendingCount: 1 } }),
    );
    renderWithProviders(<PreparationQueue />, 'es');

    fireEvent.click(within(await card()).getByRole('button', { name: 'Pedido preparado' }));
    expect(await within(await card()).findByRole('alert')).toHaveTextContent(
      'Todavía falta 1 carta por palomear. Puede que alguien acabe de deshacer una marca.',
    );
  });

  it('«Preparado por» con operador sin nombre: «una cuenta sin nombre», ⛔ nunca vacío ni «null»', async () => {
    const items = [vItem('a1', { prepStatus: 'picked' })];
    serve([
      vaultOrder({
        items,
        preparation: { status: 'prepared', preparedAt: '2026-09-24T17:20:00Z', preparedBy: { userId: 'u-x', name: null }, ...counts(items) },
      }),
    ]);
    renderWithProviders(<PreparationQueue />, 'es');
    const live = within(await card()).getByTestId('vault-live-vp-1');
    expect(live).toHaveTextContent('Preparado por una cuenta sin nombre ·');
    expect(live).not.toHaveTextContent('null');
  });

  it('el enlace «Ver qué debe haber en su bóveda» lleva al detalle DIRECCIONABLE del cliente (H-6)', async () => {
    serve([vaultOrder()]);
    renderWithProviders(<PreparationQueue />, 'es');
    const link = within(await card()).getByRole('link', { name: 'Ver qué debe haber en su bóveda' });
    expect(link).toHaveAttribute('href', '/admin/vaults/u-1?tab=physical');
  });
});
