import { describe, it, expect, afterEach } from 'vitest';
import {
  mockAdminBuylist,
  mockAdminBuylistDTO,
  type MockAdminBuylistRow,
  type MockPayabilityAnchors,
} from './fixtures';
import { paySpeiBuylist } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { SellRequestStatus } from '@/types/contract';

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
 * §M5-P (contrato v1.57) — «NO SE PAGA LO QUE NO HA LLEGADO».
 *
 * El servidor falso deriva `isPayable` porque en modo mock no hay backend que lo haga, y **M5
 * enciende el botón de pagar SPEI con ese booleano**. Cuando la fórmula pasó de dos términos a
 * tres, el mock se quedó en dos: en la pantalla de demostración —la que existe para razonar sobre
 * dinero saliente— una solicitud sin constancia de recepción salía «lista para pagar».
 *
 * Estos asserts son los del contrato (§M5-P «QA — asserts exigibles»), traídos al servidor falso.
 * ⚠️ **No re-escriben la fórmula**: afirman la INVARIANTE por el lado negativo (ningún hecho
 * ausente puede pagar) más el camino feliz, que es lo que impide que un predicado que siempre
 * devuelve `false` los pase en verde.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RECEIVED = '2026-09-01T10:00:00Z';
const VERIFIED = '2026-09-01T11:00:00Z';

function row(
  status: SellRequestStatus,
  anchors: MockPayabilityAnchors,
  id = 'sr-payability',
): MockAdminBuylistRow {
  return {
    id,
    userId: 'u-poc',
    status,
    quotedTotalCents: 32000,
    createdAt: '2026-09-01T09:00:00Z',
    items: [],
    ...anchors,
  };
}

const ANCHOR_COMBOS: MockPayabilityAnchors[] = [
  { receivedAt: null, verifiedAt: null },
  { receivedAt: RECEIVED, verifiedAt: null },
  { receivedAt: null, verifiedAt: VERIFIED },
  { receivedAt: RECEIVED, verifiedAt: VERIFIED },
];

describe('servidor falso · `isPayable` (§M5-P, los TRES términos)', () => {
  it('barre TODO el enum × receivedAt × verifiedAt y jamás paga sin las DOS marcas', () => {
    const payable: string[] = [];
    for (const status of ALL_SELL_REQUEST_STATUSES) {
      for (const anchors of ANCHOR_COMBOS) {
        const isPayable = mockAdminBuylistDTO(row(status, anchors)).isPayable;
        const label = `${status} · receivedAt=${anchors.receivedAt ?? 'null'} · verifiedAt=${anchors.verifiedAt ?? 'null'}`;
        // ⚠️ «RECIBIMOS»: el término que v1.57 añadió y el mock no tenía. Sin él, ésta era la
        // combinación que encendía el botón de pagar sobre mercancía que nunca llegó.
        if (anchors.receivedAt == null) expect(isPayable, label).toBe(false);
        // «y VERIFICAMOS».
        if (anchors.verifiedAt == null) expect(isPayable, label).toBe(false);
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
    const poc = mockAdminBuylistDTO(row('verificacion', { receivedAt: null, verifiedAt: VERIFIED }));
    expect(poc.isPayable).toBe(false);
    // El contraste que prueba el assert: la MISMA fila con la recepción sellada sí paga.
    const legit = mockAdminBuylistDTO(row('verificacion', { receivedAt: RECEIVED, verifiedAt: VERIFIED }));
    expect(legit.isPayable).toBe(true);
  });

  it('las anclas NO viajan en el DTO admin (son columnas de la «tabla», no campos del contrato)', () => {
    const dto = mockAdminBuylistDTO(row('aprobada', { receivedAt: RECEIVED, verifiedAt: VERIFIED }));
    // `AdminBuylistDTO` no las declara: si un `...row` distraído las filtrara, el cliente podría
    // llegar a recomponer la fórmula, que es justo lo que `isPayable` vino a impedir.
    expect(Object.keys(dto)).not.toContain('receivedAt');
    expect(Object.keys(dto)).not.toContain('verifiedAt');
    expect(dto.isPayable).toBe(true);
  });
});

describe('servidor falso · `pay-spei` hereda el tercer término sin tocarse', () => {
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

  it('422 y CERO escritura sobre una fila en estado pagable sin `receivedAt`', async () => {
    const poc = seed(
      row('verificacion', { receivedAt: null, verifiedAt: VERIFIED }, 'sr-poc-never-arrived'),
    );
    await expect(paySpeiBuylist(poc.id, 'SPEI-TEST-1')).rejects.toBeInstanceOf(ApiClientError);
    // «Cero escritura» en el servidor falso = la fila NO se movió a `pagada`.
    expect(poc.status).toBe('verificacion');
  });

  it('camino feliz intacto: con las dos marcas, paga', async () => {
    const ok = seed(row('aprobada', { receivedAt: RECEIVED, verifiedAt: VERIFIED }, 'sr-poc-arrived'));
    const res = await paySpeiBuylist(ok.id, 'SPEI-TEST-2');
    expect(res.status).toBe('pagada');
  });
});
