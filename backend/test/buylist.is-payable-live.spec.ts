import { ConfigService } from '@nestjs/config';
import { SellRequestStatus } from '@prisma/client';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { AdminBuylistController } from '../src/modules/buylist/admin-buylist.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import {
  isPayableSellRequest,
  SELL_REQUEST_PAYABLE_STATES,
  SELL_REQUEST_TERMINAL_STATES,
} from '../src/common/sell-request-states';

/**
 * v1.51.8 — **BL-17 (`isPayable`) y BL-18 (`live?`)**: mismo endpoint, mismo DTO, misma doctrina.
 *
 * **BL-17** — `M5View` decidía el botón de **pagar por SPEI** con `SELL_REQUEST_PAYABLE_STATES`
 * transcrito a mano **y con UNO SOLO de los dos términos**: la UI habilitaba el pago en filas donde
 * el servidor responde `422`. *No era una copia que pudiera desincronizarse algún día: ya lo estaba.*
 *
 * **BL-18** — `live?` estaba **declarado en el contrato y ausente del código**, así que la pestaña
 * «Cerradas» tenía que mandar un CSV **enumerando los cuatro terminales**.
 */

const pii = new PiiCryptoService(new ConfigService({}));
const ALL_STATUSES = Object.values(SellRequestStatus);

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'sr-1',
    userId: 'u1',
    user: { id: 'u1', name: 'Ash', email: 'ash@e.mx' },
    status: 'aprobada' as SellRequestStatus,
    verifiedAt: new Date('2026-08-02T00:00:00Z'),
    quotedTotalCents: 50_000,
    approvedTotalCents: 40_000,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    items: [],
    ...over,
  };
}

/** Evalúa una condición Prisma sobre un valor: escalar, `{in}`, `{notIn}`. */
function matchesStatus(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object') {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).includes(value);
    if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
    throw new Error(`condición no soportada: ${JSON.stringify(cond)}`);
  }
  return value === cond;
}

/**
 * Prisma de mentira que **EVALÚA el `where`** contra un universo de filas (una por estado). Es
 * deliberado: un mock que devolviera una lista fija dejaría pasar estos tests aunque el filtro no
 * existiera, y lo que hay que probar de `live?` es **qué filas salen**.
 */
function buildList(rows: ReturnType<typeof row>[]) {
  const wheres: any[] = [];
  const evalWhere = (where: any, r: any): boolean => {
    const conds: any[] = [];
    if (where.status !== undefined) conds.push(where.status);
    for (const clause of where.AND ?? []) if (clause.status !== undefined) conds.push(clause.status);
    return conds.every((c) => matchesStatus(r.status, c));
  };
  const prisma: any = {
    sellRequest: {
      findMany: jest.fn(async ({ where }: any) => {
        wheres.push(where);
        return rows.filter((r) => evalWhere(where, r));
      }),
      count: jest.fn(async ({ where }: any) => rows.filter((r) => evalWhere(where, r)).length),
    },
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    {} as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, wheres };
}

/** Un universo con EXACTAMENTE una solicitud por estado del enum. */
const universo = ALL_STATUSES.map((status) => row({ id: `sr-${status}`, status }));

// =============================================================================================
// BL-17 — `isPayable`
// =============================================================================================
describe('⚠️ BL-17 · `isPayable` — los DOS términos, no uno', () => {
  it('⚠️ EL CASO: estado pagable pero `verifiedAt` NULO ⇒ `isPayable: false`', async () => {
    // Es exactamente la fila que hoy la UI pinta como pagable y el servidor rechaza con 422.
    for (const status of SELL_REQUEST_PAYABLE_STATES) {
      const { svc } = buildList([row({ status, verifiedAt: null })]);
      const res = await svc.adminList(undefined, 1, 20);
      expect(res.data[0].status).toBe(status);
      expect(res.data[0].isPayable).toBe(false);
      // Y NO es `undefined`: el frontend consume `=== true`, pero un campo ausente sería un contrato
      // a medias — la fila tiene una respuesta, y es «no».
      expect(res.data[0]).toHaveProperty('isPayable');
    }
  });

  it('estado pagable CON `verifiedAt` ⇒ `isPayable: true`', async () => {
    for (const status of SELL_REQUEST_PAYABLE_STATES) {
      const { svc } = buildList([row({ status, verifiedAt: new Date() })]);
      const res = await svc.adminList(undefined, 1, 20);
      expect(res.data[0].isPayable).toBe(true);
    }
  });

  it('la tabla de verdad COMPLETA: todo el enum × `verifiedAt ∈ {null, fecha}`', async () => {
    for (const status of ALL_STATUSES) {
      for (const verifiedAt of [null, new Date('2026-08-02T00:00:00Z')]) {
        const { svc } = buildList([row({ status, verifiedAt })]);
        const res = await svc.adminList(undefined, 1, 20);
        const esperado =
          (SELL_REQUEST_PAYABLE_STATES as readonly string[]).includes(status) && verifiedAt != null;
        expect({ status, verifiedAt: !!verifiedAt, isPayable: res.data[0].isPayable }).toEqual({
          status,
          verifiedAt: !!verifiedAt,
          isPayable: esperado,
        });
      }
    }
  });

  it('un estado NO pagable no se vuelve pagable por tener `verifiedAt`', async () => {
    const noPagables = ALL_STATUSES.filter(
      (s) => !(SELL_REQUEST_PAYABLE_STATES as readonly string[]).includes(s),
    );
    expect(noPagables.length).toBeGreaterThan(0);
    for (const status of noPagables) {
      const { svc } = buildList([row({ status, verifiedAt: new Date() })]);
      const res = await svc.adminList(undefined, 1, 20);
      expect(res.data[0].isPayable).toBe(false);
    }
  });
});

describe('⚠️ BL-17 · el aviso de la UI y la guarda del servidor NO pueden discrepar', () => {
  /**
   * El invariante que de verdad protege esta desviación: el booleano que gobierna el botón y el
   * `where` que gobierna la escritura tienen que decir **lo mismo**, sobre **todo** el espacio de
   * entrada. Si alguien mueve uno y no el otro, esto cae.
   */
  it('`isPayableSellRequest` ≡ el `where` de la guarda atómica, en TODO el enum × `verifiedAt`', () => {
    const svc = buildList([]).svc as unknown as {
      payableWhere(): { status: { in: string[] }; verifiedAt: { not: null } };
    };
    const w = svc.payableWhere();
    for (const status of ALL_STATUSES) {
      for (const verifiedAt of [null, new Date()]) {
        const porElWhere = matchesStatus(status, w.status) && verifiedAt !== null;
        expect({ status, v: !!verifiedAt, r: porElWhere }).toEqual({
          status,
          v: !!verifiedAt,
          r: isPayableSellRequest({ status, verifiedAt }),
        });
      }
    }
  });

  it('el `where` de la guarda lleva LOS DOS términos (no solo el estado)', () => {
    const svc = buildList([]).svc as unknown as { payableWhere(): Record<string, unknown> };
    expect(svc.payableWhere()).toEqual({
      status: { in: [...SELL_REQUEST_PAYABLE_STATES] },
      verifiedAt: { not: null },
    });
  });

  it('`isPayable: false` por `verifiedAt` nulo ⇒ `paySpei` responde 422 (el caso del botón muerto)', async () => {
    const req = row({ status: 'aprobada', verifiedAt: null });
    const prisma: any = {
      sellRequest: { findUnique: jest.fn(async () => ({ ...req })) },
      kycProfile: { findUnique: jest.fn(async () => null) },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    // El aviso de la UI y la respuesta del servidor coinciden: el botón NO se ofrece, y si se
    // forzara, el servidor lo rechaza igual.
    expect(isPayableSellRequest(req)).toBe(false);
    await expect(svc.paySpei('sr-1', 'SPEI-1', 'admin')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('⚠️ BL-17 · `isPayable` es ADMIN-ONLY y ACTOR-INDEPENDIENTE', () => {
  it('NO viaja en la proyección de CLIENTE (`listMine`), donde `isTerminal` sí', async () => {
    const prisma: any = {
      sellRequest: {
        findMany: jest.fn(async () => [
          { ...row({ status: 'aprobada' }), items: [], ineRequired: false, ineProvided: false },
        ]),
      },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      {} as SettingsService,
      {} as UsersService,
      pii,
    );
    const res: any = await svc.listMine('u1');
    // Al vendedor no le toca saber si su solicitud entró a la cola de pago: le anticiparía un
    // depósito que aún puede no ocurrir.
    expect(res.data[0]).not.toHaveProperty('isPayable');
    // El contraste que prueba que la exclusión es deliberada y no un olvido.
    expect(res.data[0]).toHaveProperty('isTerminal');
  });

  it('no depende del ACTOR: `adminList` no recibe rol y el valor es propiedad de la FILA', async () => {
    // «¿esta solicitud está en condición de pagarse?» es propiedad de la fila; «¿puedo pagarla yo?»
    // lo resuelve el rol, que se queda en el cliente y lo impone `MoneyOutGuard`.
    const { svc } = buildList([row({ status: 'aprobada' })]);
    const a = await svc.adminList(undefined, 1, 20);
    const b = await svc.adminList(undefined, 1, 20);
    expect(a.data[0].isPayable).toBe(b.data[0].isPayable);
    // Firma sin actor: no hay forma de que la misma fila conteste distinto según quién pregunte.
    expect(svc.adminList.length).toBeLessThanOrEqual(5);
  });
});

// =============================================================================================
// BL-18 — `live?`
// =============================================================================================
describe('BL-18 · `live?` — por EXCLUSIÓN, nunca una lista de vivos', () => {
  it('`live=true` filtra por `notIn TERMINAL` (exclusión), no enumerando estados vivos', async () => {
    const { svc, wheres } = buildList(universo);
    const res = await svc.adminList(undefined, 1, 100, undefined, { live: true });
    expect(wheres[0].status).toEqual({ notIn: [...SELL_REQUEST_TERMINAL_STATES] });
    const salieron = res.data.map((d) => d.status).sort();
    const esperados = ALL_STATUSES.filter(
      (s) => !(SELL_REQUEST_TERMINAL_STATES as readonly string[]).includes(s),
    ).sort();
    expect(salieron).toEqual(esperados);
  });

  it('`live=false` devuelve EXACTAMENTE los terminales', async () => {
    const { svc, wheres } = buildList(universo);
    const res = await svc.adminList(undefined, 1, 100, undefined, { live: false });
    expect(wheres[0].status).toEqual({ in: [...SELL_REQUEST_TERMINAL_STATES] });
    expect(res.data.map((d) => d.status).sort()).toEqual([...SELL_REQUEST_TERMINAL_STATES].sort());
  });

  it('⚠️ un estado NUEVO del enum entra SOLO: las dos vistas PARTICIONAN el enum entero', async () => {
    // Ésta es la propiedad que compra la exclusión, y la que una lista de vivos NO daría: cada
    // estado cae en exactamente UNA de las dos vistas, sin que nadie tenga que actualizar nada.
    const vivas = (await buildList(universo).svc.adminList(undefined, 1, 100, undefined, { live: true }))
      .data.map((d) => d.status);
    const cerradas = (
      await buildList(universo).svc.adminList(undefined, 1, 100, undefined, { live: false })
    ).data.map((d) => d.status);
    expect([...vivas, ...cerradas].sort()).toEqual([...ALL_STATUSES].sort()); // cobertura total
    expect(vivas.filter((s) => cerradas.includes(s))).toEqual([]); // disjuntas
  });

  it('⚠️ un estado NUEVO no-terminal aparece en `live=true` SIN tocar el endpoint', async () => {
    // La prueba literal de lo que compra la exclusión: se simula un valor que el enum todavía no
    // tiene. Con `notIn TERMINAL` sale en «vivas» **solo**; con una lista de vivos enumerada a mano
    // NO saldría, y la cola de trabajo perdería filas EN SILENCIO — que es el lado en el que
    // olvidarse duele.
    const futuro = 'en_tasacion' as SellRequestStatus;
    const { svc } = buildList([...universo, row({ id: 'sr-futuro', status: futuro })]);
    const vivas = await svc.adminList(undefined, 1, 100, undefined, { live: true });
    expect(vivas.data.map((d) => d.status)).toContain(futuro);

    // Y su recíproco: para que un estado nuevo cuente como CERRADO hay que declararlo terminal
    // (clase R, decisión de negocio) — no basta con que exista. Mientras no se declare, NO sale aquí.
    const cerradas = await buildList([...universo, row({ id: 'sr-futuro', status: futuro })]).svc.adminList(
      undefined,
      1,
      100,
      undefined,
      { live: false },
    );
    expect(cerradas.data.map((d) => d.status)).not.toContain(futuro);
  });

  it('las dos vistas se DERIVAN de la constante: declarar un terminal nuevo las mueve a las dos', async () => {
    // No hay literal que actualizar en el endpoint: los dos `where` son la constante, tal cual.
    const vivas = buildList(universo);
    await vivas.svc.adminList(undefined, 1, 100, undefined, { live: true });
    const cerradas = buildList(universo);
    await cerradas.svc.adminList(undefined, 1, 100, undefined, { live: false });
    expect(vivas.wheres[0].status.notIn).toEqual(cerradas.wheres[0].status.in);
    expect(cerradas.wheres[0].status.in).toEqual([...SELL_REQUEST_TERMINAL_STATES]);
  });

  it('sin `live` el `where` queda EXACTAMENTE como hoy (cero regresión)', async () => {
    const { svc, wheres } = buildList(universo);
    await svc.adminList(undefined, 1, 100);
    expect(wheres[0]).not.toHaveProperty('status');
    expect(wheres[0]).not.toHaveProperty('AND');
    // Y con un solo token de `status` sigue siendo el ESCALAR de siempre.
    const dos = buildList(universo);
    await dos.svc.adminList('verificacion', 1, 100);
    expect(dos.wheres[0].status).toBe('verificacion');
  });
});

describe('BL-18 · `live?` combinado con `status` — se INTERSECTAN', () => {
  it('`status` CSV ∧ `live=true` ⇒ solo los vivos de la lista', async () => {
    const { svc, res } = await (async () => {
      const b = buildList(universo);
      const r = await b.svc.adminList('cotizada,pagada', 1, 100, undefined, { live: true });
      return { svc: b, res: r };
    })();
    expect(svc.wheres[0].AND).toEqual([
      { status: { in: ['cotizada', 'pagada'] } },
      { status: { notIn: [...SELL_REQUEST_TERMINAL_STATES] } },
    ]);
    expect(res.data.map((d) => d.status)).toEqual(['cotizada']);
  });

  it('⚠️ el filtro del usuario NO se pisa: los dos predicados van en `AND`, no reasignando `status`', async () => {
    const { svc, wheres } = buildList(universo);
    await svc.adminList('cotizada', 1, 100, undefined, { live: true });
    // Asignar `where.status` dos veces dejaría ganar al último y el filtro pedido desaparecería EN
    // SILENCIO — un listado que ignora lo que le pidieron es peor que uno que falla.
    expect(wheres[0].status).toBeUndefined();
    expect(wheres[0].AND).toHaveLength(2);
  });

  it('⚠️ contradicción ⇒ CONJUNTO VACÍO, no un 4xx', async () => {
    const { svc } = buildList(universo);
    const res = await svc.adminList('pagada', 1, 100, undefined, { live: true });
    expect(res.data).toEqual([]);
    expect(res.total).toBe(0);
    // Un 400 aquí obligaría al cliente a razonar sobre qué estados son terminales… que es
    // exactamente lo que este parámetro existe para evitar.
  });

  it('un token de `status` inválido SIGUE siendo 400 (la validación previa no se relaja)', async () => {
    const { svc } = buildList(universo);
    await expect(
      svc.adminList('no_existe', 1, 100, undefined, { live: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { invalidStatus: ['no_existe'] } });
  });
});

describe('BL-18 · el controller traduce el query param', () => {
  function ctrl() {
    const buylist = {
      adminList: jest.fn(async (..._args: any[]) => ({ data: [], page: 1, pageSize: 20, total: 0 })),
    };
    return {
      c: new AdminBuylistController(buylist as unknown as BuylistService, {} as AuditService),
      buylist,
    };
  }

  it.each([
    ['true', true],
    ['false', false],
    [undefined, undefined],
    ['1', undefined],
    ['sí', undefined],
    ['', undefined],
  ])('`live=%s` ⇒ filters.live = %s', async (entrada, esperado) => {
    const { c, buylist } = ctrl();
    await c.list(undefined, undefined, '1', '20', undefined, undefined, undefined, undefined, undefined, entrada as string | undefined);
    expect((buylist.adminList.mock.calls[0] as any[])[4]).toMatchObject({ live: esperado });
  });

  it('un valor basura NO produce un 400: el modo seguro de un filtro ausente es no filtrar', async () => {
    const { c, buylist } = ctrl();
    await expect(
      c.list(undefined, undefined, '1', '20', undefined, undefined, undefined, undefined, undefined, 'basura'),
    ).resolves.toBeDefined();
    expect((buylist.adminList.mock.calls[0] as any[])[4].live).toBeUndefined();
  });
});
