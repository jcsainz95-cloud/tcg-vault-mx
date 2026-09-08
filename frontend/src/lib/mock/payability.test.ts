import { describe, it, expect, afterEach } from 'vitest';
import {
  mockAdminBuylist,
  mockAdminBuylistDTO,
  type MockAdminBuylistRow,
  type MockPayabilityColumns,
} from './fixtures';
import { paySpeiBuylist } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { CardDTO, SellItemDTO, SellRequestStatus } from '@/types/contract';

/**
 * Los ONCE valores del enum, escritos a mano **con candado de tipo**: las dos asignaciones de
 * abajo solo compilan si esta lista y la unión `SellRequestStatus` son el MISMO conjunto. Es el
 * patrón que ya usa `types/sell-request-status.test.ts`, y aquí es lo que hace que «barre TODO el
 * enum» sea una propiedad y no una intención: si el arquitecto agrega un estado, este archivo deja
 * de compilar hasta que alguien decida si ese estado paga.
 */
const ALL_SELL_REQUEST_STATUSES = [
  'cotizada',
  'ofertada',
  'aceptada',
  'en_transito',
  'recibida',
  'verificacion',
  'aprobada',
  'pagada',
  'rechazada',
  'abandonada',
  'expirada',
] as const;
const _unionCoversList: SellRequestStatus = null as unknown as (typeof ALL_SELL_REQUEST_STATUSES)[number];
const _listCoversUnion: (typeof ALL_SELL_REQUEST_STATUSES)[number] = null as unknown as SellRequestStatus;
void _unionCoversList;
void _listCoversUnion;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * §M5-P (v1.57) «NO SE PAGA LO QUE NO HA LLEGADO» + §M5-V (v1.61) «NO SE PAGA LO QUE NO SE HA
 * JUZGADO».
 *
 * El servidor falso deriva `isPayable` porque en modo mock no hay backend que lo haga, y **M5
 * enciende el botón de pagar SPEI con ese booleano**. Ha pasado DOS VECES: la fórmula creció
 * (dos → tres en v1.57, tres → CINCO en v1.61) y el servidor falso se quedó atrás, así que en la
 * pantalla de demostración —la que existe para razonar sobre dinero saliente— salía «lista para
 * pagar» una solicitud que el servidor real contesta con `422`.
 *
 * Estos asserts son los del contrato (§M5-V.8), traídos al servidor falso. ⚠️ **No re-escriben la
 * fórmula**: afirman la INVARIANTE por el lado negativo (ningún hecho ausente puede pagar) más los
 * dos caminos felices —el clásico y **el del cherry-pick**—, que es lo que impide que un predicado
 * que siempre devuelve `false` los pase en verde.
 *
 * ⚠️ El candado que mira si la FÓRMULA CRECIÓ vive en `payability-contract.test.ts`: éste mide la
 * conducta de los términos que ya existen, aquél mide que no falte ninguno.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RECEIVED = '2026-09-01T10:00:00Z';
const VERIFIED = '2026-09-01T11:00:00Z';
const OFFER_SENT = '2026-08-29T10:00:00Z';

const card: CardDTO = {
  id: 'c-x',
  externalId: 'c-x',
  name: 'Charizard',
  number: '4',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 'base1',
  setName: 'Base Set',
  imageSmallUrl: '',
  imageLargeUrl: '',
  availableFinishes: ['normal'],
};

/** Una línea de oferta: qué decidimos comprar y en qué estado de verificación quedó. */
function line(
  id: string,
  offerDecision: 'buy' | 'skip' | undefined,
  itemStatus: SellItemDTO['itemStatus'],
): SellItemDTO {
  return { id, card, productType: 'raw', finish: 'normal', itemStatus, offerDecision };
}

function row(
  status: SellRequestStatus,
  columns: MockPayabilityColumns,
  id = 'sr-payability',
  items: SellItemDTO[] = [],
): MockAdminBuylistRow {
  return {
    id,
    userId: 'u-poc',
    status,
    quotedTotalCents: 32000,
    createdAt: '2026-09-01T09:00:00Z',
    items,
    ...columns,
  };
}

/**
 * ⚠️ **`approvedTotalCents` barre TRES valores, no dos** (§M5-V.8, assert 9): `null`, **`0`** y un
 * monto. El `0` es el que distingue el término correcto (`IS NOT NULL`) del error obvio de
 * implementación (`> 0`), que rompería el **depósito de cero** de D40 / criterio 140.
 */
const COLUMN_COMBOS: MockPayabilityColumns[] = [null, RECEIVED].flatMap((receivedAt) =>
  [null, VERIFIED].flatMap((verifiedAt) =>
    [null, 0, 28000].map((approvedTotalCents) => ({
      receivedAt,
      verifiedAt,
      approvedTotalCents,
      // Fuera del ciclo en el barrido: V-b tiene su propia batería abajo, con líneas.
      offerSentAt: null,
    })),
  ),
);

describe('servidor falso · `isPayable` (§M5-V.0, los CINCO términos)', () => {
  it('barre TODO el enum × receivedAt × verifiedAt × approvedTotalCents y jamás paga sin las TRES columnas', () => {
    const payable: string[] = [];
    for (const status of ALL_SELL_REQUEST_STATUSES) {
      for (const columns of COLUMN_COMBOS) {
        const isPayable = mockAdminBuylistDTO(row(status, columns)).isPayable;
        const label = `${status} · receivedAt=${columns.receivedAt ?? 'null'} · verifiedAt=${columns.verifiedAt ?? 'null'} · approvedTotalCents=${columns.approvedTotalCents ?? 'null'}`;
        // ⚠️ «RECIBIMOS»: el término que v1.57 añadió y el mock no tenía. Sin él, ésta era la
        // combinación que encendía el botón de pagar sobre mercancía que nunca llegó.
        if (columns.receivedAt == null) expect(isPayable, label).toBe(false);
        // «y VERIFICAMOS».
        if (columns.verifiedAt == null) expect(isPayable, label).toBe(false);
        // ⚠️ «y APROBAMOS ALGO» (V-a): el término que v1.61 añadió y el mock volvió a no tener.
        if (columns.approvedTotalCents == null) expect(isPayable, label).toBe(false);
        if (isPayable) payable.push(status);
      }
    }
    // Anti-vacuidad: un predicado que devolviera SIEMPRE `false` pasaría todo lo de arriba.
    // El camino feliz tiene que seguir pagando, y solo desde los estados pagables.
    expect([...new Set(payable)].sort()).toEqual(['aprobada', 'verificacion']);
  });

  it('el PoC del eje 2, invertido: `verificacion` verificada pero NUNCA recibida no es pagable', () => {
    // Es la fila con la que seguridad liquidó MX$320 reales: `verify` es llamable desde cualquier
    // estado vivo y sella `verifiedAt` sin exigir predecesor.
    const columns = { verifiedAt: VERIFIED, approvedTotalCents: 28000, offerSentAt: null };
    const poc = mockAdminBuylistDTO(row('verificacion', { ...columns, receivedAt: null }));
    expect(poc.isPayable).toBe(false);
    // El contraste que prueba el assert: la MISMA fila con la recepción sellada sí paga.
    const legit = mockAdminBuylistDTO(row('verificacion', { ...columns, receivedAt: RECEIVED }));
    expect(legit.isPayable).toBe(true);
  });

  /**
   * ⛔ **EL AGUJERO DE DINERO de `BL-45`** (§M5-V.4, recuadro): ciclo con cherry-pick y **todas**
   * las líneas `buy` rechazadas. La auto-transición a `rechazada` **no dispara** —la `skip` cuenta
   * como no-rechazada—, así que la fila sigue `verificacion`, recibida y verificada… y sin nada
   * aprobado. Sin V-a se pagaba `max(0, offerGrossCents − fee)` **por CERO cartas**.
   */
  it('V-a: rechazo TOTAL con cherry-pick (la `skip` impide el cierre) NO se paga', () => {
    const rejected = row(
      'verificacion',
      { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: null, offerSentAt: OFFER_SENT },
      'sr-money-hole',
      [line('i-1', 'buy', 'rechazada'), line('i-2', 'buy', 'rechazada'), line('i-3', 'skip', 'verificacion')],
    );
    const dto = mockAdminBuylistDTO(rejected);
    expect(dto.isPayable).toBe(false);
    // Y no es V-b quien lo frena: las dos `buy` tienen veredicto. Es V-a, y sola.
    expect(dto.pendingDecisionItemCount).toBe(0);
  });

  /**
   * ⚠️ **El contra-caso de V-a, y es NORMATIVO** (D40 / criterio 140): `approvedTotalCents = 0`
   * **con** líneas aprobadas —el envío se comió el bruto— **SE PAGA**. Escribir `> 0` en el
   * término es el error obvio de implementación, y este assert es el que lo mata.
   */
  it('V-a NO es `> 0`: el DEPÓSITO DE CERO de D40 se sigue pagando', () => {
    const zero = mockAdminBuylistDTO(
      row(
        'aprobada',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: 0, offerSentAt: null },
        'sr-zero-deposit',
        [line('i-1', undefined, 'aprobada')],
      ),
    );
    expect(zero.isPayable).toBe(true);
  });

  it('V-b: dentro del ciclo, una línea COMPRADA sin veredicto apaga el botón y se puede decir cuántas', () => {
    const dto = mockAdminBuylistDTO(
      row(
        'verificacion',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: 40000, offerSentAt: OFFER_SENT },
        'sr-cycle-pending',
        [line('i-1', 'buy', 'aprobada'), line('i-2', 'buy', 'verificacion'), line('i-3', 'skip', 'verificacion')],
      ),
    );
    expect(dto.isPayable).toBe(false);
    // El conteo lo da el SERVIDOR (§M5-V.5) y cuenta **solo** la `buy` sin veredicto.
    expect(dto.pendingDecisionItemCount).toBe(1);
  });

  /**
   * ⭐ **EL CONTRA-CASO OBLIGATORIO** (§M5-V.8, assert 2-bis). Sin él, V-b se implementa como
   * «ninguna línea sin veredicto» a secas y **el camino normal del ciclo deja de poder pagarse**:
   * las `skip` se quedan en `verificacion` a propósito y **jamás pueden aprobarse**.
   */
  it('V-b: cherry-pick con TODAS las `buy` aprobadas SÍ se paga — la `skip` no necesita veredicto', () => {
    const dto = mockAdminBuylistDTO(
      row(
        'verificacion',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: 47000, offerSentAt: OFFER_SENT },
        'sr-cherry-pick',
        [line('i-1', 'buy', 'aprobada'), line('i-2', 'buy', 'aprobada'), line('i-3', 'skip', 'verificacion')],
      ),
    );
    expect(dto.isPayable).toBe(true);
    expect(dto.pendingDecisionItemCount).toBe(0);
  });

  it('V-b es SOLO del ciclo: fuera de él (`offerSentAt IS NULL`) no bloquea nada', () => {
    // §M5-V.4: fuera del ciclo `respond(accept)` deja líneas sin veredicto individual de forma
    // LEGÍTIMA; aplicar V-b allí rompería la cohorte entera.
    const dto = mockAdminBuylistDTO(
      row(
        'aprobada',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: 28000, offerSentAt: null },
        'sr-legacy',
        [line('i-1', 'buy', 'verificacion')],
      ),
    );
    expect(dto.isPayable).toBe(true);
  });

  it('las columnas OCULTAS no viajan en el DTO admin; `approvedTotalCents`, que es del contrato, sí', () => {
    const dto = mockAdminBuylistDTO(
      row('aprobada', {
        receivedAt: RECEIVED,
        verifiedAt: VERIFIED,
        approvedTotalCents: 28000,
        offerSentAt: OFFER_SENT,
      }),
    );
    // `AdminBuylistDTO` no las declara: si un `...row` distraído las filtrara, el cliente podría
    // llegar a recomponer la fórmula, que es justo lo que `isPayable` vino a impedir.
    for (const hidden of ['receivedAt', 'verifiedAt', 'offerSentAt']) {
      expect(Object.keys(dto), `${hidden} se filtró al DTO`).not.toContain(hidden);
    }
    expect(dto.approvedTotalCents).toBe(28000);
    expect(dto.isPayable).toBe(true);
  });

  it('`null` en la tabla → `undefined` en el DTO (el contrato declara el campo OPCIONAL, no nullable)', () => {
    const dto = mockAdminBuylistDTO(
      row('verificacion', {
        receivedAt: RECEIVED,
        verifiedAt: VERIFIED,
        approvedTotalCents: null,
        offerSentAt: null,
      }),
    );
    expect(dto.approvedTotalCents).toBeUndefined();
  });
});

describe('servidor falso · `pay-spei` hereda los términos nuevos sin tocarse', () => {
  const added: string[] = [];
  afterEach(() => {
    for (const id of added.splice(0)) {
      const i = mockAdminBuylist.findIndex((r) => r.id === id);
      if (i >= 0) mockAdminBuylist.splice(i, 1);
    }
  });

  function seed(r: MockAdminBuylistRow) {
    mockAdminBuylist.push(r);
    added.push(r.id);
    return r;
  }

  async function payAndCatch(id: string): Promise<ApiClientError> {
    try {
      await paySpeiBuylist(id, 'SPEI-TEST');
      throw new Error(`pay-spei pagó ${id} y no debía`);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiClientError);
      return e as ApiClientError;
    }
  }

  it('422 y CERO escritura sobre una fila en estado pagable sin `receivedAt`', async () => {
    const poc = seed(
      row(
        'verificacion',
        { receivedAt: null, verifiedAt: VERIFIED, approvedTotalCents: 28000, offerSentAt: null },
        'sr-poc-never-arrived',
      ),
    );
    const err = await payAndCatch(poc.id);
    expect(err.status).toBe(422);
    // «Cero escritura» en el servidor falso = la fila NO se movió a `pagada`.
    expect(poc.status).toBe('verificacion');
  });

  it('422 y CERO escritura sin `approvedTotalCents` — el agujero de dinero de `BL-45`', async () => {
    const poc = seed(
      row(
        'verificacion',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: null, offerSentAt: OFFER_SENT },
        'sr-poc-zero-cards',
        [line('i-1', 'buy', 'rechazada'), line('i-2', 'skip', 'verificacion')],
      ),
    );
    const err = await payAndCatch(poc.id);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(poc.status).toBe('verificacion');
  });

  /**
   * ⚠️ **LA ESCALERA DE §M5-V.6, y no es cosmética:** aquí fallan **los dos** términos (no hay
   * nada aprobado **y** faltan veredictos) y el que tiene que ganar es `ITEMS_NOT_DECIDED`,
   * porque **decidir las líneas es el acto que satisface los dos**. El genérico mandaría al
   * operador a revisar el estado y la recepción, que están bien.
   */
  it('`ITEMS_NOT_DECIDED` GANA a la genérica, nombra las líneas `buy` y no paga', async () => {
    const poc = seed(
      row(
        'verificacion',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: null, offerSentAt: OFFER_SENT },
        'sr-poc-not-decided',
        [line('i-1', 'buy', 'verificacion'), line('i-2', 'buy', 'aprobada'), line('i-3', 'skip', 'verificacion')],
      ),
    );
    const err = await payAndCatch(poc.id);
    expect(err.code).toBe('ITEMS_NOT_DECIDED');
    expect(err.status).toBe(422);
    // ⚠️ Solo la `buy` sin veredicto: ni la ya aprobada ni la `skip`.
    expect(err.details).toEqual({ sellRequestId: poc.id, pendingDecisionItemIds: ['i-1'] });
    expect(poc.status).toBe('verificacion');
  });

  it('camino feliz intacto: con las cuatro columnas, paga', async () => {
    const ok = seed(
      row(
        'aprobada',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: 28000, offerSentAt: null },
        'sr-poc-arrived',
      ),
    );
    const res = await paySpeiBuylist(ok.id, 'SPEI-TEST-2');
    expect(res.status).toBe('pagada');
  });

  it('camino feliz DEL CICLO: cherry-pick con todas las `buy` decididas, paga', async () => {
    const ok = seed(
      row(
        'verificacion',
        { receivedAt: RECEIVED, verifiedAt: VERIFIED, approvedTotalCents: 47000, offerSentAt: OFFER_SENT },
        'sr-poc-cherry-pick',
        [line('i-1', 'buy', 'aprobada'), line('i-2', 'buy', 'rechazada'), line('i-3', 'skip', 'verificacion')],
      ),
    );
    const res = await paySpeiBuylist(ok.id, 'SPEI-TEST-3');
    expect(res.status).toBe('pagada');
  });
});
