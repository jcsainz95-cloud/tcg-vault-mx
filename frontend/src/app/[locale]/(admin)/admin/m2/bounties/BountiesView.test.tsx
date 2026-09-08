import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  AdminBountyListResponse,
  AdminBountyRowDTO,
  BountyState,
  Finish,
  VariantPricingDTO,
} from '@/types/contract';
import es from '../../../../../../../messages/es.json';
import en from '../../../../../../../messages/en.json';
import { BountiesView } from './BountiesView';
import M2BountiesPage from './page';

/**
 * # BountiesView.test.tsx — la mitad de FRONTEND de `API_CONTRACT §M2-B.6`
 *
 * Cada `describe` cita **la fila de §M2-B.6** o el caso de **§28.14** que pone en rojo. Las dos
 * filas que el contrato marca explícitamente como *«test de FRONTEND»* son **B-11** (el cuerpo del
 * `PUT`) y **B-13(b)** (ninguna acción de alcance de conjunto); el resto son los **espejos de
 * cliente** de candados de servidor: no re-asertan la regla del servidor —eso se prueba donde vive
 * el endpoint (§M2-B.6, nota final)—, asertan que **esta pantalla obedece lo que llegó** en vez de
 * recalcularlo.
 *
 * ⚠️ **Ningún test teclea una versalita** (§28.10, §28.13 nº20): los rótulos se leen del catálogo
 * i18n. La lección es la del homoglifo cirílico de este proyecto — una letra que se *ve* igual
 * cruzaría cualquier candado que transcribiera la cadena a mano.
 */

const T = es.admin.m2.bounties;
const T_EN = en.admin.m2.bounties;

const roleState = vi.hoisted(() => ({ role: 'super_admin' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: true,
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures: se escriben a mano para poder mandar EXACTAMENTE lo que manda el servidor —incluido
// un `state` que contradice a los números de la fila, que es como se comprueba que la pantalla
// obedece y no deduce.
// ---------------------------------------------------------------------------

function pricing(over: Partial<NonNullable<VariantPricingDTO['bounty']>>): VariantPricingDTO {
  const face = {
    suggestedCents: null,
    overrideCents: null,
    effectiveCents: null,
    source: 'market' as const,
    premiumAtFloor: false,
  };
  return {
    buy: face,
    sell: face,
    bounty: {
      enabled: true,
      priceCents: 90000,
      targetQty: 2,
      acquiredQty: 0,
      completedAt: null,
      effective: false,
      curveQuoteCents: 95000,
      ...over,
    },
  };
}

interface RowSpec {
  id: string;
  name: string;
  state: string;
  priceCents?: number | null;
  curveQuoteCents?: number | null;
  enabled?: boolean;
  completedAt?: string | null;
  targetQty?: number | null;
  acquiredQty?: number;
  finish?: Finish;
}

function makeRow(spec: RowSpec): AdminBountyRowDTO {
  const targetQty = spec.targetQty === undefined ? 2 : spec.targetQty;
  const acquiredQty = spec.acquiredQty ?? 0;
  return {
    cardId: spec.id,
    setId: 'sv3',
    setName: 'Obsidian Flames',
    name: spec.name,
    number: '125',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: spec.finish ?? 'holofoil',
    state: spec.state as BountyState,
    progress: {
      targetQty,
      acquiredQty,
      remainingQty: targetQty != null ? Math.max(0, targetQty - acquiredQty) : null,
    },
    updatedAt: '2026-09-01T12:00:00.000Z',
    pricing: pricing({
      enabled: spec.enabled ?? true,
      priceCents: spec.priceCents === undefined ? 90000 : spec.priceCents,
      curveQuoteCents: spec.curveQuoteCents === undefined ? 95000 : spec.curveQuoteCents,
      completedAt: spec.completedAt ?? null,
      targetQty,
      acquiredQty,
    }),
  };
}

function response(over: Partial<AdminBountyListResponse> = {}): AdminBountyListResponse {
  const data = over.data ?? [];
  return {
    data,
    page: 1,
    pageSize: 25,
    total: data.length,
    counts: { activa: 0, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
    truncated: false,
    ...over,
  };
}

/** Sirve la respuesta que se le dé, y devuelve el espía para inspeccionar la query emitida. */
function serve(res: AdminBountyListResponse | (() => AdminBountyListResponse)) {
  return vi
    .spyOn(api, 'getAdminBounties')
    .mockImplementation(async () => (typeof res === 'function' ? res() : res));
}

const chip = (state: BountyState) =>
  screen.getByRole('button', { name: new RegExp(T.counts[state].replace('{count}', '')) });

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

// ===========================================================================
// El estado lo dice el SERVIDOR (§28.0 regla nueva · espejo de cliente de B-1/B-2/B-8)
// ===========================================================================
describe('⭐ el `state` llega resuelto y la pantalla lo PINTA, no lo recalcula', () => {
  it('⭐⭐ pinta `activa` aunque los números de la fila «parezcan» rebasados', async () => {
    // Fixture DELIBERADAMENTE contradictorio: el precio está por debajo de la tarifa, pero el
    // servidor clasificó `activa`. Si alguien vuelve a derivar el estado en el cliente —cruzando
    // banderas o comparando PAGAMOS con TARIFA VIGENTE— esta fila se pintaría REBASADO y el test
    // se pone rojo. *Si el signo del premium y el `state` no coinciden, manda el `state`* (§28.4).
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Pikachu VMAX', state: 'activa', priceCents: 90000, curveQuoteCents: 95000 })],
        counts: { activa: 1, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Pikachu VMAX')).closest('tr')!;
    expect(within(row).getByText(T.state.activa)).toBeInTheDocument();
    expect(within(row).queryByText(T.state.rebasada)).toBeNull();
  });

  it('⭐ pinta `rebasada` aunque el empate exacto «parezca» suficiente (§28.14 caso 2)', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada', priceCents: 95000, curveQuoteCents: 95000 })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Charizard ex')).closest('tr')!;
    expect(within(row).getByText(T.state.rebasada)).toBeInTheDocument();
    expect(within(row).getByLabelText(T.state.rebasadaAria)).toBeInTheDocument();
  });

  it('`completada` y `apagada` NO se colapsan: dos rótulos y DOS bloques (espejo de B-8)', async () => {
    serve(
      response({
        data: [
          makeRow({ id: 'c1', name: 'Mew ex', state: 'completada', enabled: false, completedAt: '2026-08-01T00:00:00.000Z', acquiredQty: 2 }),
          makeRow({ id: 'c2', name: 'Snorlax VMAX', state: 'apagada', enabled: false, priceCents: 60000, curveQuoteCents: 64000 }),
        ],
        counts: { activa: 0, rebasada: 0, invalida: 0, completada: 1, apagada: 1 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const done = (await screen.findByText('Mew ex')).closest('tr')!;
    const off = screen.getByText('Snorlax VMAX').closest('tr')!;
    expect(within(done).getByText(T.state.completada)).toBeInTheDocument();
    expect(within(off).getByText(T.state.apagada)).toBeInTheDocument();
    expect(T.state.completada).not.toBe(T.state.apagada);
    // Dos encabezados de bloque distintos, no uno compartido (§28.2a, cambio v3.4).
    expect(screen.getByText(T.group.completada.replace('{count}', '1'))).toBeInTheDocument();
    expect(screen.getByText(T.group.apagada.replace('{count}', '1'))).toBeInTheDocument();
  });

  it('un `state` fuera del enum se pinta NEUTRO, jamás `ACTIVO` (§28.14 caso 18)', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Gengar VMAX', state: 'zombi' })],
        counts: { activa: 0, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Gengar VMAX')).closest('tr')!;
    expect(within(row).getByText(T.state.unknown)).toBeInTheDocument();
    expect(within(row).queryByText(T.state.activa)).toBeNull();
    // Sin premium: no se afirma nada sobre su dinero.
    expect(within(row).getByText(T.premium.none)).toBeInTheDocument();
  });
});

// ===========================================================================
// §28.14 caso 3 — la fila `invalida`, que es el defecto que motivó la revisión v3.4
// ===========================================================================
describe('⭐ la fila `invalida`: encendida, sin precio, y con dos puertas', () => {
  function renderInvalid() {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Gengar VMAX', state: 'invalida', priceCents: null, curveQuoteCents: 78000 })],
        counts: { activa: 0, rebasada: 0, invalida: 1, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
  }

  it('dice SIN PRECIO, no ACTIVO, y su `aria-label` cuenta que está ENCENDIDA', async () => {
    renderInvalid();
    const row = (await screen.findByText('Gengar VMAX')).closest('tr')!;
    expect(within(row).getByText(T.state.invalida)).toBeInTheDocument();
    expect(within(row).queryByText(T.state.activa)).toBeNull();
    expect(within(row).getByLabelText(T.state.invalidaAria)).toBeInTheDocument();
  });

  it('⛔ deja el hueco en PAGAMOS y NO inventa premium (ni la tarifa, ni `0`, ni `−100%`)', async () => {
    renderInvalid();
    const row = (await screen.findByText('Gengar VMAX')).closest('tr')!;
    // El hueco es la señal; para el lector de pantalla se dice con palabras (§28.10).
    expect(within(row).getByLabelText(T.row.noPriceAria)).toBeInTheDocument();
    expect(within(row).getByLabelText(T.premium.noPriceAria)).toBeInTheDocument();
    // La tarifa vigente SÍ se enseña al lado — es el punto; escribirla en el hueco, no.
    expect(within(row).getByText('MX$780.00')).toBeInTheDocument();
    expect(within(row).queryByText(/-?100(\.0)?%/)).toBeNull();
  });

  it('su botón principal cambia de rótulo a `Poner precio` (§28.6g)', async () => {
    renderInvalid();
    expect(await screen.findByRole('button', { name: T.row.setPriceAria.replace('{card}', 'Gengar VMAX') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: T.row.editAria.replace('{card}', 'Gengar VMAX') })).toBeNull();
    // Segunda puerta: apagar, con el mismo trato que cualquier otra fila.
    expect(screen.getByRole('button', { name: T.row.turnOffAria.replace('{card}', 'Gengar VMAX') })).toBeInTheDocument();
  });

  it('⛔ el campo de precio NO se prellena con la tarifa vigente (§28.13 nº13)', async () => {
    renderInvalid();
    fireEvent.click(await screen.findByRole('button', { name: T.row.setPriceAria.replace('{card}', 'Gengar VMAX') }));
    const price = await screen.findByLabelText(T.edit.price);
    expect(price).toHaveValue('');
    // Y el aviso del bloque lleva la tarifa, sin `role="alert"`: es una decisión pendiente.
    expect(screen.getByText(T.noPrice.bannerTitle)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ===========================================================================
// Espejo de cliente de B-9 / B-10 — `counts` es del CONJUNTO, no de la página
// ===========================================================================
describe('⭐ B-9/B-10 (espejo de cliente) — los chips cuentan el conjunto, no lo que se ve', () => {
  it('⭐ el chip dice el número del servidor aunque la página enseñe menos filas', async () => {
    // Página 1 con UNA rebasada visible y `counts.rebasada = 3`: las otras dos están en otra
    // página. Un conteo derivado de `data` diría «1» exactamente donde la pantalla existe para no
    // decirlo (§28.13 nº8).
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })],
        counts: { activa: 12, rebasada: 3, invalida: 1, completada: 2, apagada: 4 },
        total: 22,
        pageSize: 1,
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByRole('button', { name: T.counts.rebasada.replace('{count}', '3') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: T.counts.rebasada.replace('{count}', '1') })).toBeNull();
    // El encabezado del bloque de atención también cuenta el conjunto.
    expect(
      screen.getByText(
        new RegExp(T.group.attentionCounts.replace('{outbid}', '3').replace('{noPrice}', '1')),
      ),
    ).toBeInTheDocument();
  });

  it('los CINCO chips existen y ninguno se esconde al llegar a cero (§28.5)', async () => {
    serve(response({ data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })], counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 } }));
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');
    for (const s of ['rebasada', 'invalida', 'activa', 'completada', 'apagada'] as BountyState[]) {
      expect(chip(s)).toBeInTheDocument();
    }
  });

  it('seleccionar un chip aplica `?state=` en el SERVIDOR y no cambia los demás números', async () => {
    const spy = serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })],
        counts: { activa: 12, rebasada: 1, invalida: 0, completada: 2, apagada: 4 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');
    fireEvent.click(chip('rebasada'));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ states: ['rebasada'] }));
    });
    // `counts` IGNORA el filtro de estado ⇒ el resto del mapa sigue en pie (§28.14 caso 7): con
    // `REBASADOS` puesto, los otros cuatro CONSERVAN su número en vez de caer a `0`.
    expect(
      await screen.findByRole('button', { name: T.counts.activa.replace('{count}', '12') }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.counts.apagada.replace('{count}', '4') })).toBeInTheDocument();
  });

  it('mientras carga, los conteos son `—` y NUNCA `0` (§28.13 nº10)', () => {
    serve(() => response());
    vi.spyOn(api, 'getAdminBounties').mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<BountiesView />, 'es');
    expect(screen.getByRole('button', { name: T.counts.rebasada.replace('{count}', '—') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: T.counts.rebasada.replace('{count}', '0') })).toBeNull();
  });
});

// ===========================================================================
// Espejo de cliente de B-4 — la lista incompleta se DICE (§28.2b)
// ===========================================================================
describe('⭐ B-4 (espejo de cliente) — `truncated: true` se declara en pantalla', () => {
  it('pinta el banner, pone `≥` en los chips y NO enuncia ningún cero', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Pikachu VMAX', state: 'activa', priceCents: 250000, curveQuoteCents: 210000 })],
        counts: { activa: 40, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
        truncated: true,
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByText(T.list.truncated)).toBeInTheDocument();
    // El `≥` es lo único verdadero sobre un conjunto cortado.
    expect(screen.getByRole('button', { name: T.counts.activa.replace('{count}', '≥ 40') })).toBeInTheDocument();
    // ⛔ Y ningún cero, ni siquiera con `counts.rebasada === 0`: un cero de una lista cortada no
    // es un cero (§28.5, §28.14 caso 5).
    expect(screen.queryByText(T.zero.outbid)).toBeNull();
    expect(screen.queryByText(T.zero.outbidLabel)).toBeNull();
  });

  it('no es una avería: el banner va en `status`, no en `alert`, y la tabla se sigue pintando', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Pikachu VMAX', state: 'activa' })],
        counts: { activa: 40, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
        truncated: true,
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const banner = (await screen.findByText(T.list.truncated)).closest('[role]')!;
    expect(banner).toHaveAttribute('role', 'status');
    expect(screen.getByText('Pikachu VMAX')).toBeInTheDocument();
  });
});

// ===========================================================================
// §28.5 — el cero que se dice y las dos veces que no se dice
// ===========================================================================
describe('§28.5 — el panel DICE el cero (inversión deliberada de la vitrina)', () => {
  it('cero de verdad (rebasada 0 · invalida 0 · truncated false) ⇒ frase tranquilizadora', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Pikachu VMAX', state: 'activa', priceCents: 250000, curveQuoteCents: 210000 })],
        counts: { activa: 1, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByText(T.zero.outbid)).toBeInTheDocument();
  });

  it('⭐ con `invalida > 0` se lee el cero ACOTADO, nunca «todos los encendidos pagan»', async () => {
    // La fila `invalida` está fuera de la página que se ve (filtro por estado), pero su conteo
    // sigue en `counts`: la frase tiene que mirarlo (§28.14 caso 4).
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Pikachu VMAX', state: 'activa', priceCents: 250000, curveQuoteCents: 210000 })],
        counts: { activa: 1, rebasada: 0, invalida: 2, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByText(T.zero.outbidButNoPrice.replace('{count}', '2'))).toBeInTheDocument();
    expect(screen.queryByText(T.zero.outbid)).toBeNull();
  });
});

// ===========================================================================
// Espejo de cliente de B-12 — la tarifa vigente también en filas apagadas
// ===========================================================================
describe('B-12 (espejo de cliente) — `—` en TARIFA VIGENTE significa UNA cosa: la curva no resuelve', () => {
  it('una fila apagada con mercado resoluble enseña su tarifa (§28.14 caso 9)', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Snorlax VMAX', state: 'apagada', enabled: false, priceCents: 60000, curveQuoteCents: 64000 })],
        counts: { activa: 0, rebasada: 0, invalida: 0, completada: 0, apagada: 1 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Snorlax VMAX')).closest('tr')!;
    expect(within(row).getByText('MX$640.00')).toBeInTheDocument();
    // Sin premium (no paga), pero con su tarifa a la vista para poder decidir antes de encenderla.
    expect(within(row).getByLabelText(T.premium.noneAria)).toBeInTheDocument();
  });

  it('`curveQuoteCents: null` es SIN TARIFA y no trae aviso de rebasado', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Pikachu VMAX', state: 'activa', priceCents: 90000, curveQuoteCents: null })],
        counts: { activa: 1, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Pikachu VMAX')).closest('tr')!;
    expect(within(row).getByText(T.premium.noRate)).toBeInTheDocument();
    // Dos celdas lo dicen con palabras: el `—` de TARIFA VIGENTE y el `SIN TARIFA` del premium.
    // El guion no se lee, así que ninguna de las dos puede quedarse muda (§28.10).
    expect(within(row).getAllByLabelText(T.premium.noRateAria)).toHaveLength(2);
  });

  it('`targetQty: null` ⇒ SIN OBJETIVO, y CERO aritmética con `null` (§28.13 nº11)', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Pikachu VMAX', state: 'activa', targetQty: null })],
        counts: { activa: 1, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Pikachu VMAX')).closest('tr')!;
    expect(within(row).getByText(T.progress.noTarget)).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/NaN|null|undefined/);
  });
});

// ===========================================================================
// ⭐⭐ B-11 — el cuerpo del `PUT` (la fila que el contrato marca como test de FRONTEND)
// ===========================================================================
describe('⭐⭐ B-11 — el `PUT` que emite esta pantalla NO reenvía los overrides', () => {
  async function editPriceAndSave() {
    serve(
      response({
        data: [makeRow({ id: 'card-1', name: 'Charizard ex', state: 'rebasada', priceCents: 90000, curveQuoteCents: 95000 })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    const put = vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'card-1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      pricing: pricing({ priceCents: 100000, effective: true }),
    });
    renderWithProviders(<BountiesView />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    fireEvent.change(await screen.findByLabelText(T.edit.price), { target: { value: '1000' } });
    // Subir el precio SUBE el gasto ⇒ pasa por la ventana con los dos importes (§28.6c).
    fireEvent.click(screen.getByRole('button', { name: new RegExp(T.edit.saveRaising.replace('{amount}', '')) }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(T.confirm.cta.replace('{amount}', '')) }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    return put;
  }

  it('⭐ el cuerpo no contiene las claves `sellOverrideCents` ni `buyOverrideCents`', async () => {
    const put = await editPriceAndSave();
    const [cardId, finish, body] = put.mock.calls[0];
    expect(cardId).toBe('card-1');
    expect(finish).toBe('holofoil');
    // Aserción sobre la PETICIÓN, no sobre la respuesta (§28.6f).
    expect(Object.keys(body)).not.toContain('sellOverrideCents');
    expect(Object.keys(body)).not.toContain('buyOverrideCents');
    expect(JSON.stringify(body)).not.toMatch(/OverrideCents/);
  });

  it('manda EXACTAMENTE lo que el humano editó: el bounty y la identidad de la variante', async () => {
    const put = await editPriceAndSave();
    expect(put.mock.calls[0][2]).toEqual({
      productType: 'raw',
      gradeKey: 'raw:NM',
      bounty: { enabled: true, priceCents: 100000 },
    });
  });

  it('una edición muta UNA variante: una petición, un gesto', async () => {
    const put = await editPriceAndSave();
    expect(put).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// ⭐⭐ B-13(b) — ninguna acción cuyo alcance sea un CONJUNTO
// ===========================================================================
describe('⭐⭐ B-13(b) — la pantalla no expone ninguna acción de alcance de conjunto', () => {
  function renderThreeOutbid() {
    serve(
      response({
        data: [
          makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' }),
          makeRow({ id: 'c2', name: 'Umbreon VMAX', state: 'rebasada' }),
          makeRow({ id: 'c3', name: 'Lugia V', state: 'rebasada' }),
        ],
        counts: { activa: 0, rebasada: 3, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
  }

  it('⛔ no hay multi-selección: ninguna casilla en la tabla', async () => {
    renderThreeOutbid();
    await screen.findByText('Charizard ex');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('⛔ ningún control de ACCIÓN lleva un contador en el rótulo (`Apagar los {n}…`)', async () => {
    renderThreeOutbid();
    await screen.findByText('Charizard ex');
    // Los chips de conteo SÍ llevan número y son legítimos: filtran, no escriben (§28.2a). Lo que
    // no puede existir es un control con contador que dispare escrituras. Se comprueba por dos
    // vías: (1) los únicos botones con dígitos son los cinco chips; (2) pulsarlos no escribe nada.
    const put = vi.spyOn(api, 'putVariantControls');
    const withDigits = screen
      .getAllByRole('button')
      .filter((b) => /\d/.test(b.textContent ?? ''));
    const chipLabels = (['rebasada', 'invalida', 'activa', 'completada', 'apagada'] as BountyState[]).map(
      (s) => T.counts[s].replace('{count}', '').trim(),
    );
    for (const b of withDigits) {
      expect(chipLabels.some((l) => (b.textContent ?? '').includes(l))).toBe(true);
    }
    for (const b of withDigits) fireEvent.click(b);
    expect(put).not.toHaveBeenCalled();
  });

  it('⛔ ni «apagar todos», ni «aplicar a los filtrados», ni «+10 % a los rebasados» — ES y EN', async () => {
    renderThreeOutbid();
    await screen.findByText('Charizard ex');
    const prohibido =
      /(apagar (los|todos)|apaga los|aplicar a los|a los seleccionados|seleccionad|en lote|masiv|turn off (all|the \d)|apply to (all|the )|selected|bulk)/i;
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '', `botón «${b.textContent}»`).not.toMatch(prohibido);
    }
    // Y las cadenas retiradas en v3.4 no volvieron al catálogo por la puerta de atrás (§28.12).
    expect(JSON.stringify(es.admin.m2.bounties)).not.toMatch(/"bulk/i);
    expect(JSON.stringify(en.admin.m2.bounties)).not.toMatch(/"bulk/i);
  });

  it('⭐ `Apagar` alcanza UNA fila: tres rebasadas a la vista, una sola petición y con SU `cardId`', async () => {
    renderThreeOutbid();
    const put = vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c2',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      pricing: pricing({ enabled: false }),
    });
    await screen.findByText('Umbreon VMAX');
    fireEvent.click(screen.getByRole('button', { name: T.row.turnOffAria.replace('{card}', 'Umbreon VMAX') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toBe('c2');
    expect(put.mock.calls[0][2]).toEqual({ productType: 'raw', gradeKey: 'raw:NM', bounty: { enabled: false } });
  });

  it('⛔ verificable POR AUSENCIA (criterio 184(f)): ni alta, ni tablero, ni gráficas', async () => {
    renderThreeOutbid();
    await screen.findByText('Charizard ex');
    expect(screen.queryByRole('button', { name: /nuevo bounty|crear bounty|añadir bounty|new bounty/i })).toBeNull();
    expect(document.querySelector('svg.recharts-surface')).toBeNull();
  });
});

// ===========================================================================
// §28.6 — editar una fila sin que un resbalón mueva dinero
// ===========================================================================
describe('§28.6 — la tabla en reposo no tiene formularios, y la fricción va en la dirección del dinero', () => {
  function renderOne(state: string, over: Partial<RowSpec> = {}) {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state, ...over })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
  }

  it('en reposo la fila es TEXTO: ni un `input`, ni un `switch`, ni una celda editable', async () => {
    renderOne('rebasada');
    await screen.findByText('Charizard ex');
    const table = screen.getByRole('table');
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(table).queryAllByRole('switch')).toHaveLength(0);
    expect(within(table).queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('BAJAR el precio no abre ventana; SUBIRLO sí (§28.14 caso 14)', async () => {
    renderOne('rebasada');
    const put = vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      pricing: pricing({ priceCents: 80000 }),
    });
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    fireEvent.change(await screen.findByLabelText(T.edit.price), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: T.edit.save }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('`Guardar` está deshabilitado sin cambios, con el motivo anunciado', async () => {
    renderOne('rebasada');
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    expect(await screen.findByRole('button', { name: T.edit.save })).toBeDisabled();
    expect(screen.getByText(T.edit.noChanges)).toBeInTheDocument();
  });

  it('`Encender` NO es un clic: abre la fila con el aviso de revisar el precio (§28.6c)', async () => {
    renderOne('apagada', { enabled: false, priceCents: 60000, curveQuoteCents: 64000 });
    const put = vi.spyOn(api, 'putVariantControls');
    fireEvent.click(await screen.findByRole('button', { name: T.row.turnOn }));
    expect(await screen.findByText(T.row.turnOnHint)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it('`Esc` con cambios sucios CONFIRMA antes de descartar (§28.6b)', async () => {
    renderOne('rebasada');
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    const price = await screen.findByLabelText(T.edit.price);
    fireEvent.change(price, { target: { value: '1200' } });
    fireEvent.keyDown(price, { key: 'Escape' });
    expect(await screen.findByText(T.edit.discardConfirm.replace('{card}', 'Charizard ex'))).toBeInTheDocument();
    // El bloque de edición sigue abierto hasta que se confirme.
    expect(screen.getByLabelText(T.edit.price)).toBeInTheDocument();
  });

  it('⛔ `BOUNTY_BELOW_RULE` se ancla EN LA FILA, no en un toast, y no se reintenta solo', async () => {
    renderOne('rebasada');
    const put = vi
      .spyOn(api, 'putVariantControls')
      .mockRejectedValue(
        new ApiClientError(422, {
          code: 'BOUNTY_BELOW_RULE',
          message: 'below',
          details: { curveQuoteCents: 99000 },
        }),
      );
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    fireEvent.change(await screen.findByLabelText(T.edit.price), { target: { value: '960' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(T.edit.saveRaising.replace('{amount}', '')) }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(T.confirm.cta.replace('{amount}', '')) }));
    // El mensaje trae la tarifa que devolvió el SERVIDOR (`details.curveQuoteCents`), no la que la
    // pantalla tenía pintada: la curva se movió entre el render y el guardado (§M2-B.3).
    expect(await screen.findByText(es.error.BOUNTY_BELOW_RULE.replace('{suggested}', 'MX$990.00'))).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(put).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// §28.8 — carga, vacío y error (obligatorios)
// ===========================================================================
describe('§28.8 — los tres estados obligatorios', () => {
  it('el error de carga NO pinta media tabla: banner + `Reintentar`', async () => {
    vi.spyOn(api, 'getAdminBounties').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByText(T.error.load)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: es.common.retry })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('el vacío total explica qué es un bounty y manda al binder (el alta NO vive aquí)', async () => {
    serve(response());
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByText(T.empty.title)).toBeInTheDocument();
    expect(screen.getByText(T.empty.body)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: T.empty.cta })).toHaveAttribute('href', '/admin/m1');
  });

  it('el vacío POR FILTRO ofrece limpiar, no explica el concepto', async () => {
    // Conjunto con un rebasado (el chip está vivo) pero la página que se pide viene vacía.
    serve(response({ counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 } }));
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText(T.empty.title);
    fireEvent.click(chip('rebasada'));
    expect(await screen.findByText(T.empty.filteredTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: es.common.clearFilters })).toBeInTheDocument();
  });
});

// ===========================================================================
// §28.1 / §M2-B.1 — el rol (espejo de cliente de B-6)
// ===========================================================================
describe('§28.1 — `super_admin` únicamente; para `vault_operator` NO se renderiza', () => {
  it('⭐ con `vault_operator` la pantalla no se pinta, ni en solo lectura, y NO se pide la lista', async () => {
    roleState.role = 'vault_operator';
    const spy = serve(response({ data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })] }));
    renderWithProviders(<M2BountiesPage />, 'es');
    expect(await screen.findByText(es.admin.superAdminGateTitle)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Charizard ex')).toBeNull();
    // Un lector con menos rol tendría una pantalla donde cada botón contesta 403 (§M2-B.1): ni
    // siquiera se le pide la lista.
    expect(spy).not.toHaveBeenCalled();
  });

  it('con `super_admin` la misma página sí monta la consola', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<M2BountiesPage />, 'es');
    expect(await screen.findByRole('table', { name: T.table.caption })).toBeInTheDocument();
  });
});

// ===========================================================================
// §28.10 / §28.13 nº20 — accesibilidad y el catálogo
// ===========================================================================
describe('§28.10 — accesibilidad y el barrido del homoglifo', () => {
  it('es una `<table>` real, con `<caption>` y un encabezado de grupo por bloque', async () => {
    serve(
      response({
        data: [
          makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' }),
          makeRow({ id: 'c2', name: 'Pikachu VMAX', state: 'activa', priceCents: 250000, curveQuoteCents: 210000 }),
        ],
        counts: { activa: 1, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByRole('table', { name: T.table.caption })).toBeInTheDocument();
    const groupHeaders = document.querySelectorAll('th[scope="rowgroup"]');
    expect(groupHeaders).toHaveLength(2);
  });

  it('⛔ ni `role="alert"` ni `aria-live="assertive"`: el rebasado es un estado, no un incidente', async () => {
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull();
  });

  it('⭐ el catálogo de esta pantalla no lleva NINGÚN carácter fuera del juego declarado', () => {
    // §28.10: «los catálogos se barren buscando no-ASCII fuera del juego esperado, y esta pantalla
    // entra en ese barrido». Es el candado del homoglifo: una `А` cirílica dentro de `REBASADO` se
    // ve idéntica y rompería en silencio cualquier comparación. El juego permitido es el declarado
    // por §28.10, con el `−` (U+2212) y el `≥` (U+2265) escritos con su punto de código.
    const permitido = /^[\x20-\x7EáéíóúÁÉÍÓÚñÑüÜ¡¿·—…×‹›«»−≥●’“”]*$/u;
    for (const catalog of [T, T_EN] as unknown as Record<string, unknown>[]) {
      const walk = (obj: Record<string, unknown>, path: string) => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') {
            expect(v, `${path}.${k} = ${JSON.stringify(v)}`).toMatch(permitido);
          } else if (v && typeof v === 'object') {
            walk(v as Record<string, unknown>, `${path}.${k}`);
          }
        }
      };
      walk(catalog, 'admin.m2.bounties');
    }
  });

  it('los CINCO rótulos de estado son distintos entre sí, en ES y en EN (§28.13 nº2)', () => {
    for (const catalog of [T, T_EN]) {
      const labels = [
        catalog.state.activa,
        catalog.state.rebasada,
        catalog.state.invalida,
        catalog.state.completada,
        catalog.state.apagada,
      ];
      expect(new Set(labels).size).toBe(5);
    }
  });
});

// ===========================================================================
// §28.2a — la pantalla NO ordena
// ===========================================================================
describe('§28.2a — el orden llega hecho y la pantalla no lo toca', () => {
  it('pinta las filas en el orden en que vinieron, aunque el precio diga otra cosa', async () => {
    serve(
      response({
        data: [
          makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada', priceCents: 10000 }),
          makeRow({ id: 'c2', name: 'Umbreon VMAX', state: 'rebasada', priceCents: 900000 }),
        ],
        counts: { activa: 0, rebasada: 2, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');
    const names = Array.from(document.querySelectorAll('td a')).map((a) => a.textContent);
    expect(names).toEqual(['Charizard ex', 'Umbreon VMAX']);
  });

  it('con un `sort` distinto de `attention_first` NO se pintan encabezados de bloque', async () => {
    const spy = serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');
    expect(document.querySelectorAll('th[scope="rowgroup"]')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(T.sort.label), { target: { value: 'price_desc' } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sort: 'price_desc' })));
    await waitFor(() => expect(document.querySelectorAll('th[scope="rowgroup"]')).toHaveLength(0));
  });

  it('solo ofrece los TRES órdenes del endpoint', async () => {
    serve(response({ data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })] }));
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');
    const options = within(screen.getByLabelText(T.sort.label)).getAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      'attention_first',
      'price_desc',
      'updated_desc',
    ]);
  });
});

// ===========================================================================
// EN — los rótulos existen y se pintan (§28.14 caso 16)
// ===========================================================================
describe('EN — la pantalla habla los dos idiomas', () => {
  it('pinta los cinco estados y la frase de lista incompleta en inglés', async () => {
    serve(
      response({
        data: [
          makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' }),
          makeRow({ id: 'c2', name: 'Gengar VMAX', state: 'invalida', priceCents: null }),
          makeRow({ id: 'c3', name: 'Pikachu VMAX', state: 'activa', priceCents: 250000, curveQuoteCents: 210000 }),
          makeRow({ id: 'c4', name: 'Mew ex', state: 'completada', enabled: false, completedAt: '2026-08-01T00:00:00.000Z' }),
          makeRow({ id: 'c5', name: 'Snorlax VMAX', state: 'apagada', enabled: false }),
        ],
        counts: { activa: 1, rebasada: 1, invalida: 1, completada: 1, apagada: 1 },
        truncated: true,
      }),
    );
    renderWithProviders(<BountiesView />, 'en');
    expect(await screen.findByText(T_EN.state.rebasada)).toBeInTheDocument();
    expect(screen.getByText(T_EN.state.invalida)).toBeInTheDocument();
    expect(screen.getByText(T_EN.state.activa)).toBeInTheDocument();
    expect(screen.getByText(T_EN.state.completada)).toBeInTheDocument();
    expect(screen.getByText(T_EN.state.apagada)).toBeInTheDocument();
    expect(screen.getByText(T_EN.list.truncated)).toBeInTheDocument();
    // El rótulo del botón de la fila `invalida` también cambia en EN.
    expect(
      screen.getByRole('button', { name: T_EN.row.setPriceAria.replace('{card}', 'Gengar VMAX') }),
    ).toBeInTheDocument();
  });
});
