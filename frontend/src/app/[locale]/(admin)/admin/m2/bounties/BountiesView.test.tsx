import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react';
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

  it('⭐ …y sus acciones se limitan a `Editar` + el binder: NI `Apagar` NI `Encender` (§28.3)', async () => {
    // *No sabemos qué significa ese estado, así que no sabemos qué hace apagarlo* — y `Apagar` manda
    // un `PUT` que mueve dinero. El fallback neutro que ya rige el rótulo y el premium rige también
    // la acción: cuando falta el dato, no se afirma de más **y no se actúa de más**.
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Gengar VMAX', state: 'zombi' })],
        counts: { activa: 0, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Gengar VMAX')).closest('tr')!;
    expect(
      within(row).queryByRole('button', { name: T.row.turnOffAria.replace('{card}', 'Gengar VMAX') }),
    ).toBeNull();
    expect(within(row).queryByRole('button', { name: T.row.turnOn })).toBeNull();
    // Las dos que §28.3 sí le deja siguen ahí.
    expect(
      within(row).getByRole('button', { name: T.row.editAria.replace('{card}', 'Gengar VMAX') }),
    ).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Gengar VMAX/ })).toBeInTheDocument();
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
// ⭐⭐ §28.14 caso 19 / §28.5 v3.5 — el cero que un FILTRO acota deja de ser un cero
// ===========================================================================
describe('⭐⭐ caso 19 — con un filtro de identidad puesto, la pantalla NO afirma sobre «todos»', () => {
  /*
   * ### El defecto que cierra, medido antes de existir la norma
   * Con dos `rebasada` en el sistema y `Buscar carta = Pikachu`, la pantalla leía
   * **`SIN REBASADOS` · «Ningún bounty rebasado. Todos los encendidos pagan por encima de la tarifa
   * vigente»**. Las dos piezas eran correctas por separado —`counts` **respeta** la identidad
   * (§M2-B.1) y el copy pintaba lo que dictaba la tabla— y **la frase resultante era falsa**.
   *
   * Y es el peor sitio posible: esa frase es literalmente el mecanismo que le dice al dueño *«puedes
   * dejar de preocuparte»* sobre la única pantalla donde un rebasado invisible se ve.
   *
   * ⚠️ El servidor falso de estos casos **filtra `data` y `counts` con `q`**, como el de verdad: sin
   * eso el candado no mediría nada — estaría comprobando la frase contra unos conteos que ningún
   * servidor produciría.
   */
  const CHARIZARD = makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' });
  const GENGAR = makeRow({ id: 'c2', name: 'Gengar VMAX', state: 'rebasada' });
  const PIKACHU = makeRow({
    id: 'c3',
    name: 'Pikachu VMAX',
    state: 'activa',
    priceCents: 250000,
    curveQuoteCents: 210000,
  });

  function serveRespetandoIdentidad() {
    const todas = [CHARIZARD, GENGAR, PIKACHU];
    return vi.spyOn(api, 'getAdminBounties').mockImplementation(async (filters = {}) => {
      const q = (filters.q ?? '').trim().toLowerCase();
      const data = q ? todas.filter((r) => r.name.toLowerCase().includes(q)) : todas;
      const rebasada = data.filter((r) => r.state === 'rebasada').length;
      return response({
        data,
        // `counts` RESPETA la identidad (y sigue ignorando el filtro de estado).
        counts: { activa: data.length - rebasada, rebasada, invalida: 0, completada: 0, apagada: 0 },
      });
    });
  }

  /** El bloque ①: la línea sobre la tabla. Se localiza por su versalita, sea cual sea. */
  const bloqueUno = () =>
    (screen.queryByText(T.zero.filteredLabel) ?? screen.queryByText(T.zero.outbidLabel))?.closest('div');

  it('⭐⭐ `q` que no casa con ningún rebasado ⇒ `VISTA FILTRADA`, jamás `SIN REBASADOS`', async () => {
    serveRespetandoIdentidad();
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');

    fireEvent.change(screen.getByLabelText(T.filters.searchLabel), { target: { value: 'Pikachu' } });

    // La respuesta trae `counts.rebasada = 0` —correcto— y el bloque ① tiene que NOMBRAR EL RECORTE.
    expect(await screen.findByText(T.zero.filtered, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(T.zero.filteredLabel)).toBeInTheDocument();
    expect(chip('rebasada')).toHaveTextContent(T.counts.rebasada.replace('{count}', '0'));

    // ⛔ Ni la versalita tranquilizadora, ni ninguna de sus dos frases, ni acotadas.
    expect(screen.queryByText(T.zero.outbidLabel)).toBeNull();
    expect(screen.queryByText(T.zero.outbid)).toBeNull();
    expect(screen.queryByText(new RegExp(T.zero.outbidButNoPrice.replace('{count}', '\\d+')))).toBeNull();
    // Y nada del bloque ① afirma sobre «todos» los encendidos, ni siquiera acotando: se compara
    // contra el CATÁLOGO (§28.13 nº20), no contra una cadena tecleada aquí.
    const afirmacionGlobal = T.zero.outbid.split('.')[1].trim(); // «Todos los encendidos pagan…»
    expect(bloqueUno()?.textContent ?? '').not.toContain(afirmacionGlobal);

    // Y la palanca, que es lo que la frase promete.
    expect(within(bloqueUno()!).getByRole('button', { name: es.common.clearFilters })).toBeInTheDocument();
  });

  it('⭐ LA VUELTA: al limpiar el filtro vuelven los conteos, las filas y el silencio', async () => {
    serveRespetandoIdentidad();
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText('Charizard ex');
    fireEvent.change(screen.getByLabelText(T.filters.searchLabel), { target: { value: 'Pikachu' } });
    await screen.findByText(T.zero.filtered, {}, { timeout: 3000 });

    fireEvent.click(within(bloqueUno()!).getByRole('button', { name: es.common.clearFilters }));

    // Sin recargar: los dos rebasados vuelven a estar a la vista y a contarse…
    expect(await screen.findByText('Charizard ex', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Gengar VMAX')).toBeInTheDocument();
    await waitFor(() =>
      expect(chip('rebasada')).toHaveTextContent(T.counts.rebasada.replace('{count}', '2')),
    );
    // …y ahora no se enuncia ningún cero, porque no lo hay: el bloque ① tiene filas.
    expect(screen.queryByText(T.zero.filtered)).toBeNull();
    expect(screen.queryByText(T.zero.outbid)).toBeNull();
  });

  it('⭐ CONTROL NEGATIVO 1: sin filtro, el cero SÍ se enuncia (el candado no se pasa de listo)', async () => {
    serve(
      response({
        data: [PIKACHU],
        counts: { activa: 1, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByText(T.zero.outbid)).toBeInTheDocument();
    expect(screen.queryByText(T.zero.filtered)).toBeNull();
  });

  it('⭐ CONTROL NEGATIVO 2: un CHIP DE ESTADO no es filtro de identidad ⇒ el cero se enuncia igual', async () => {
    // `counts` **ignora** el filtro de estado (§28.2a), así que con un chip puesto `counts.rebasada`
    // sigue siendo el número del sistema entero: *el chip no acota el conjunto de la pregunta, la
    // responde*. Si alguien mete los chips en el predicado, este control se pone rojo.
    //
    // ⚠️⚠️ **EL CHIP TIENE QUE SER PULSABLE, O EL CONTROL ES VACUO** — es la hermana del defecto
    // del control negativo 3, en el caso de al lado. En su primera forma este caso servía
    // `apagada: 0`, y un chip en cero **se deshabilita** (§28.5: no se esconde, se apaga) ⇒ el clic
    // no hacía nada, `states` se quedaba en `[]` y el caso **nunca ejercía la condición que dice
    // ejercer**. Medido a una cifra de diferencia: con `apagada: 0` la mutación «los chips cuentan
    // como identidad» queda **VERDE**; con el chip encendido, **ROJA**.
    //
    // Por eso el servidor falso responde aquí como el de verdad: `data` **respeta** el filtro de
    // estado y `counts` **lo ignora** (§28.2a) — y el caso asevera que el gesto **surtió efecto**
    // antes de creerse la frase.
    const SNORLAX = makeRow({
      id: 'c9',
      name: 'Snorlax VMAX',
      state: 'apagada',
      enabled: false,
      priceCents: 60000,
      curveQuoteCents: 64000,
    });
    vi.spyOn(api, 'getAdminBounties').mockImplementation(async (filters = {}) => {
      const states = filters.states ?? [];
      const todas = [PIKACHU, SNORLAX];
      return response({
        data: states.length > 0 ? todas.filter((r) => states.includes(r.state)) : todas,
        // El conteo del sistema entero, sea cual sea el chip puesto.
        counts: { activa: 1, rebasada: 0, invalida: 0, completada: 0, apagada: 1 },
      });
    });
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText(T.zero.outbid);

    // (a) el chip está VIVO — si vuelve a salir deshabilitado, este control deja de medir nada.
    expect(chip('apagada')).toBeEnabled();
    fireEvent.click(chip('apagada'));

    // (b) el gesto SURTIÓ EFECTO: el chip queda pulsado y la página es ya la del estado filtrado.
    await waitFor(() => expect(chip('apagada')).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByText('Snorlax VMAX', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Pikachu VMAX')).toBeNull());

    // (c) …y con el chip puesto el cero SIGUE enunciándose: el chip no acotó la pregunta.
    expect(await screen.findByText(T.zero.outbid)).toBeInTheDocument();
    expect(screen.queryByText(T.zero.filtered)).toBeNull();
    expect(screen.queryByText(T.zero.filteredLabel)).toBeNull();
  });

  it('⭐ CONTROL NEGATIVO 4: la PAGINACIÓN no es filtro de identidad ⇒ el cero se enuncia en la página 2', async () => {
    // §28.5 v3.5 lo escribe con todas las letras —*«La paginación tampoco cuenta: no toca
    // `counts`»*— y era la **única cláusula de la norma sin candado**: la mutación
    // `hasIdentityFilter({ q }) || page > 1` se quedaba verde con la suite entera. Pasar de página
    // no acota el conjunto que `counts` cuenta: cambia la ventana, no la pregunta.
    const OTRA = makeRow({
      id: 'c8',
      name: 'Snorlax VMAX',
      state: 'activa',
      priceCents: 250000,
      curveQuoteCents: 210000,
    });
    const spy = vi.spyOn(api, 'getAdminBounties').mockImplementation(async (filters = {}) => {
      const page = filters.page ?? 1;
      return response({
        data: [page === 1 ? PIKACHU : OTRA],
        page,
        pageSize: 1,
        total: 2, // dos páginas de una fila: lo mínimo para que exista un «Siguiente»
        counts: { activa: 2, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      });
    });
    renderWithProviders(<BountiesView />, 'es');
    expect(await screen.findByText(T.zero.outbid)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: T.page.next }));

    // El gesto SURTIÓ EFECTO —la lección del control negativo 2: un control que no se pulsa no
    // mide—: la petición viajó con `page: 2` y la fila de la segunda página está a la vista.
    expect(await screen.findByText('Snorlax VMAX', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(spy.mock.calls.at(-1)?.[0]?.page).toBe(2));

    // …y el cero sigue diciéndose, porque sigue siendo verdadero.
    expect(screen.getByText(T.zero.outbid)).toBeInTheDocument();
    expect(screen.queryByText(T.zero.filtered)).toBeNull();
    expect(screen.queryByText(T.zero.filteredLabel)).toBeNull();
  });

  it('⭐ CONTROL NEGATIVO 3: una `q` de SOLO ESPACIOS no acota nada — ni en pantalla ni en la petición', async () => {
    // §28.5 v3.5 lo declara: *«una `q` vacía o de solo espacios no acota nada»*. Y si la pantalla lo
    // declara, tampoco puede mandarla: el servidor **sí** filtraría por esos espacios y la pantalla
    // creería estar sin filtro sobre un conjunto acotado — el defecto de v3.5 por la puerta de atrás.
    //
    // ⚠️ El conjunto de este caso **no tiene rebasados a la vista** a propósito: con filas en el
    // bloque ① no habría frase que comparar y el control sería VACUO — pasaría igual aunque los
    // espacios contaran como filtro. Aquí el cero **se enuncia**, así que la diferencia se ve.
    const spy = vi.spyOn(api, 'getAdminBounties').mockImplementation(async (filters = {}) => {
      const q = (filters.q ?? '').trim().toLowerCase();
      const data = q && !PIKACHU.name.toLowerCase().includes(q) ? [] : [PIKACHU];
      return response({
        data,
        counts: { activa: data.length, rebasada: 0, invalida: 0, completada: 0, apagada: 0 },
      });
    });
    renderWithProviders(<BountiesView />, 'es');
    await screen.findByText(T.zero.outbid);

    fireEvent.change(screen.getByLabelText(T.filters.searchLabel), { target: { value: '   ' } });
    await new Promise((r) => setTimeout(r, 400)); // el rebote de la búsqueda

    // Sigue siendo el cero de siempre: los espacios no acotan nada.
    expect(screen.getByText(T.zero.outbid)).toBeInTheDocument();
    expect(screen.queryByText(T.zero.filtered)).toBeNull();
    expect(screen.queryByText(T.zero.filteredLabel)).toBeNull();
    // Y la petición viajó **sin `q`**: lo que no acota, no viaja.
    expect(spy.mock.calls.at(-1)?.[0]?.q).toBeUndefined();

    // …y con texto DE VERDAD el mismo arnés sí cambia de frase (si no, el control no medía nada).
    fireEvent.change(screen.getByLabelText(T.filters.searchLabel), { target: { value: 'zzz' } });
    expect(await screen.findByText(T.zero.filtered, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(spy.mock.calls.at(-1)?.[0]?.q).toBe('zzz');
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

  it('⭐⭐ B-13(b) por CONDUCTA: NINGÚN gesto humano produce más de UNA escritura', async () => {
    /*
     * ⚠️⚠️ **ESTE ES EL CANDADO DE B-13(b); LOS DOS DE ARRIBA SON DE RÓTULO.**
     *
     * §M2-B.2 nombra la forma en que esto reaparece sin mala fe: *«el alcance lo define el GESTO
     * DEL HUMANO, no el transporte»* — N escrituras disparadas por un gesto son una acción masiva
     * **aunque viajen de una en una**. Por eso se mide la conducta, no el texto del rótulo.
     *
     * ### Las TRES evasiones que ya sobrevivieron a una versión anterior de este candado
     * Se dejan escritas porque cada una define una parte del barrido, y quitarla lo vuelve a abrir:
     *  1. **Rótulo neutro** («Pausar el grupo»): los candados de casilla/dígitos/palabras prohibidas
     *     miran el TEXTO ⇒ ninguno lo tocaba. ⇒ el barrido pulsa **todo**, mire lo que mire.
     *  2. **Detrás de una ventana de confirmación**: pulsar el botón abre el modal y escribe cero;
     *     el `Confirmar` **no existe en un render limpio**, así que un barrido de una sola pulsación
     *     nunca llega a él. ⇒ **el gesto se sigue hasta su confirmación**: un diálogo abierto no es
     *     el final del gesto, es la mitad.
     *  3. **Un control que no es `<button>`** (un `<select>` cuyo `onChange` escribe): rol
     *     `combobox` ⇒ un barrido de `getAllByRole('button')` ni lo mira. ⇒ se barre **todo lo
     *     interactivo** y a cada tipo se le hace **su** gesto (clic, cambio de opción, tecleo).
     *
     * Cada control se acciona **desde un render limpio**, para que ninguno herede el estado que dejó
     * el anterior (un chip filtra, `Editar` abre una fila) y el barrido mida lo que dice medir.
     */
    const putOk = {
      cardId: 'c1',
      productType: 'raw' as const,
      gradeKey: 'raw:NM' as const,
      finish: 'holofoil' as Finish,
      pricing: pricing({ enabled: false }),
    };
    /** Todo lo que un humano puede accionar. ⛔ No solo `button`: la evasión 3 entró por un `select`. */
    const INTERACTIVOS =
      'button, [role="button"], a[href], input, select, textarea, [role="switch"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="combobox"], [role="option"], [tabindex]:not([tabindex="-1"])';

    const tick = () => new Promise((r) => setTimeout(r, 0));
    /** El gesto que corresponde a CADA tipo de control (un clic no acciona un `<select>`). */
    async function accionar(el: Element) {
      await act(async () => {
        if (el instanceof HTMLSelectElement) {
          const otra = Array.from(el.options).find((o) => o.value !== el.value);
          if (otra) fireEvent.change(el, { target: { value: otra.value } });
        } else if (el instanceof HTMLInputElement && /checkbox|radio/.test(el.type)) {
          fireEvent.click(el);
        } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          fireEvent.change(el, { target: { value: '1' } });
        } else {
          fireEvent.click(el);
        }
        await tick();
      });
    }

    const nombre = (el: Element) =>
      el.getAttribute('aria-label') || (el as HTMLElement).textContent || el.nodeName.toLowerCase();

    renderThreeOutbid();
    await screen.findByText('Charizard ex');
    const total = document.querySelectorAll(INTERACTIVOS).length;
    expect(total, 'el barrido tiene que tener algo que barrer').toBeGreaterThan(5);
    cleanup();

    const writes: number[] = [];
    for (let i = 0; i < total; i++) {
      vi.restoreAllMocks();
      renderThreeOutbid();
      await screen.findByText('Charizard ex');
      const put = vi.spyOn(api, 'putVariantControls').mockResolvedValue(putOk);
      const control = document.querySelectorAll(INTERACTIVOS)[i];
      const label = nombre(control);

      await accionar(control);

      // ⭐ **SEGUIR EL GESTO HASTA SU CONFIRMACIÓN.** Si el control abrió una ventana, el gesto del
      // humano no ha terminado: falta el botón que la cierra confirmando. Se pulsa el ÚLTIMO botón
      // del diálogo —en este sistema de diseño el primario va al final del pie— porque pulsar el
      // primero (`×` / `Cancelar`) cerraría la ventana sin llegar nunca a la escritura, que es
      // justamente por donde se coló la evasión 2.
      const dialog = screen.queryByRole('dialog');
      if (dialog) {
        const botones = within(dialog).getAllByRole('button');
        await accionar(botones[botones.length - 1]);
      }

      expect(
        put.mock.calls.length,
        `el control «${label}» escribió sobre varias filas de un solo gesto`,
      ).toBeLessThanOrEqual(1);
      writes.push(put.mock.calls.length);
      cleanup();
    }

    // ⚠️ Guarda contra el VERDE VACUO: si ningún control llegara a escribir —porque el espía no
    // estuviera enganchado, o porque el barrido accionara elementos muertos—, el «como mucho uno»
    // se cumpliría sin medir nada. `Apagar` **tiene** que aparecer como exactamente una escritura.
    expect(Math.max(...writes), 'ningún control escribió: el barrido no está midiendo').toBe(1);
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

  it('⭐ volver a pulsar `Editar` sobre la fila ABIERTA no borra la suciedad (§28.6b)', async () => {
    // Regresión real del código anterior: `requestEdit` limpiaba `editorDirty` cuando la fila
    // siguiente era **la misma**, pero el bloque de edición NO se remonta en ese caso (conserva lo
    // tecleado) y su efecto de suciedad solo reporta **cuando `dirty` cambia** ⇒ la vista se quedaba
    // creyendo que no había nada que perder y el siguiente `Cancelar` descartaba **sin preguntar**.
    renderOne('rebasada');
    const edit = await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') });
    fireEvent.click(edit);
    fireEvent.change(await screen.findByLabelText(T.edit.price), { target: { value: '1200' } });
    fireEvent.click(edit); // la MISMA fila
    expect(screen.getByLabelText(T.edit.price)).toHaveValue('1200');
    fireEvent.click(screen.getByRole('button', { name: es.common.cancel }));
    expect(await screen.findByText(T.edit.discardConfirm.replace('{card}', 'Charizard ex'))).toBeInTheDocument();
  });

  it('⭐ tras un guardado FALLIDO lo tecleado sigue ahí, y `Cancelar` sigue preguntando (§28.6e)', async () => {
    // El error ancla la fila abierta; **no** es un cierre. Si esa transición limpiara la suciedad,
    // el vendedor perdería sin aviso lo que acababa de teclear justo después de un error.
    renderOne('rebasada');
    vi.spyOn(api, 'putVariantControls').mockRejectedValue(
      new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    fireEvent.change(await screen.findByLabelText(T.edit.price), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: T.edit.save }));
    await waitFor(() => expect(screen.getByLabelText(T.edit.price)).toHaveValue('800'));
    fireEvent.click(screen.getByRole('button', { name: es.common.cancel }));
    expect(await screen.findByText(T.edit.discardConfirm.replace('{card}', 'Charizard ex'))).toBeInTheDocument();
  });

  it('⭐ `Apagar` en una fila NO cierra el editor sucio de OTRA fila (el quinto camino)', async () => {
    // §28.6b nombra CUATRO caminos de descarte, y todos preguntan. Apagar una fila en reposo mientras
    // otra está abierta con cambios era un quinto camino **que no preguntaba**: cerraba el editor
    // ajeno y tiraba lo tecleado. *El borrador de otra fila no es nuestro para tirarlo.*
    serve(
      response({
        data: [
          makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' }),
          makeRow({ id: 'c2', name: 'Umbreon VMAX', state: 'rebasada' }),
        ],
        counts: { activa: 0, rebasada: 2, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    const put = vi.spyOn(api, 'putVariantControls').mockResolvedValue({
      cardId: 'c2',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      pricing: pricing({ enabled: false }),
    });
    renderWithProviders(<BountiesView />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    fireEvent.change(await screen.findByLabelText(T.edit.price), { target: { value: '1200' } });

    fireEvent.click(screen.getByRole('button', { name: T.row.turnOffAria.replace('{card}', 'Umbreon VMAX') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    // El editor de Charizard sigue abierto y con lo tecleado.
    expect(screen.getByLabelText(T.edit.price)).toHaveValue('1200');
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

  it('⭐ el rótulo de móvil etiqueta SU celda, y no se anuncia dos veces (§28.9)', async () => {
    /*
     * ⚠️ **Presencia no es correspondencia.** Intercambiar los dos `CellLabel` deja la tarjeta de
     * móvil diciendo `PAGAMOS <tarifa> · TARIFA VIGENTE <lo que pagamos>` —**los dos importes
     * invertidos**— y cualquier aserción de «el rótulo está» pasa igual. Es la confusión exacta que
     * el colapso existe para evitar, y sobre las dos cifras de dinero de la pantalla.
     * El espejo de navegador vive en `e2e/admin-bounties.spec.ts` (§28.9); éste es el barato.
     */
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada', priceCents: 90000, curveQuoteCents: 95000 })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    const row = (await screen.findByText('Charizard ex')).closest('tr')!;
    const rotulo = (label: string) => within(row).getByText(label, { selector: 'span' });

    expect(rotulo(T.col.pay).closest('td')).toHaveTextContent('MX$900.00');
    expect(rotulo(T.col.rate).closest('td')).toHaveTextContent('MX$950.00');

    // El rótulo es **redundante para el lector** (los `role=` explícitos conservan la cabecera de
    // columna también en móvil): sin `aria-hidden` cada celda se anunciaría dos veces.
    expect(rotulo(T.col.pay)).toHaveAttribute('aria-hidden', 'true');
    expect(rotulo(T.col.rate)).toHaveAttribute('aria-hidden', 'true');
  });

  it('⭐ todos los elementos de la tabla llevan su `role` EXPLÍCITO (el mecanismo de §28.9)', async () => {
    /*
     * ⚠️⚠️ Este candado es sobre el **MECANISMO**, y por eso mira atributos y no conducta: los
     * `role=` son lo que sostiene la `<table>` real de §28.10 **cuando §28.9 le quita el
     * `display:table`**. Hoy cualquiera puede borrarlos en una limpieza de «atributos redundantes».
     *
     * ⚠️ Y hay que decir con precisión **cuánto** cubre, porque medí las dos mitades:
     *  · En **Chromium**, `table`/`row`/`cell`/`rowheader` son redundantes de verdad —Blink los
     *    deriva igual con `display:block|grid|flex`— y **`rowgroup` NO lo es** (el `<tbody>` sin rol
     *    ni se expone). Esa mitad se mide donde se pierde: en el navegador
     *    (`e2e/admin-bounties.spec.ts`, §28.9, el conteo de `rowgroup` contra los `<tbody>`).
     *  · La otra mitad —los cuatro redundantes en Chromium— es defensa para los motores donde **sí**
     *    se pierden (WebKit/VoiceOver es el caso documentado), que **no se pueden correr aquí**: el
     *    proyecto de Playwright es solo Chromium. Sin este candado, esos cuatro se pueden borrar sin
     *    que nada se ponga rojo **en ningún sitio**.
     * *Un candado que solo caza el borrado masivo no sirve: el borrado que llega es el de una línea.*
     */
    serve(
      response({
        data: [makeRow({ id: 'c1', name: 'Charizard ex', state: 'rebasada' })],
        counts: { activa: 0, rebasada: 1, invalida: 0, completada: 0, apagada: 0 },
      }),
    );
    renderWithProviders(<BountiesView />, 'es');
    // Con el bloque de edición ABIERTO: su `<td colspan>` vive en otro fichero y también se colapsa.
    fireEvent.click(await screen.findByRole('button', { name: T.row.editAria.replace('{card}', 'Charizard ex') }));
    await screen.findByLabelText(T.edit.price);

    const table = screen.getByRole('table', { name: T.table.caption });
    expect(table).toHaveAttribute('role', 'table');
    const sinRol = (selector: string) =>
      Array.from(table.querySelectorAll(selector)).map((el) => el.outerHTML.slice(0, 80));
    expect(sinRol('thead:not([role="rowgroup"]), tbody:not([role="rowgroup"])')).toEqual([]);
    expect(sinRol('tr:not([role="row"])')).toEqual([]);
    expect(sinRol('td:not([role="cell"])')).toEqual([]);
    expect(sinRol('th[scope="rowgroup"]:not([role="rowheader"])')).toEqual([]);
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
