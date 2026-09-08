import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailPort } from '../src/modules/mail/mail.port';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { variantKey } from '../src/common/variant-key';
import { monthCommittedGrossCents } from '../src/common/buylist-aml';

/**
 * `buylist.m5a-offer-aml.spec.ts` — **INVARIANTE A (API_CONTRACT §M5-A, v1.58): «NO SE COMPROMETE LO
 * QUE NO SE PUEDE CUMPLIR».** Cierre de **BL-38**; hermana de `buylist.m5p-received-guard.spec.ts` y
 * de `buylist.m5t-terminal-guard.spec.ts`.
 *
 * ### El defecto que reproduce
 * `PROJECT.md:1127-1128` exige los topes **en los dos momentos** (al cotizar y al ofertar) y sobre el
 * **BRUTO OFERTADO**. Hasta v1.58 `adminOffer` **no referenciaba ninguno de los tres diales**: el tope
 * por solicitud se juzgaba **exactamente una vez**, en el intake y sobre el **cotizado**, mientras el
 * override de D26 llega a MX$10,000 por línea contra un tope AML de MX$3,000. Y **la oferta es
 * VINCULANTE** (D2): *emitimos por encima del tope → el vendedor acepta → **manda sus cartas** → al
 * pagar no podemos*. ***Un control que se descubre después de comprometer la palabra no controla.***
 *
 * ### ⚠️ POR QUÉ ESTA SUITE CORRE CON LOS DIALES **REALES**
 * `buylist.offer-cycle.spec.ts` los eleva a propósito —su eje es el tope del **OPERADOR** y con los
 * defaults el AML dispararía primero—. **Aquí van los defaults de `settings.constants.ts`
 * (MX$3,000 / MX$10,000 / MX$3,000) sin tocar**, porque el eje bajo prueba **es** el AML, incluido el
 * caso que cruza los dos topes: *nada inofertable llega a la cola de autorización*.
 *
 * ### ⚠️ POR QUÉ EL DOBLE DE PRISMA **EVALÚA EL `where`** Y **FILTRA LA VENTANA DEL MES**
 * Un fake que responde `{count: 1}` a cualquier `updateMany` pasa igual con la guarda puesta y
 * quitada, y un `findMany` que devuelve siempre lo mismo no puede distinguir «se sustituyó la fila
 * propia» de «se sumó dos veces». *Un test que no puede fallar por la razón por la que el sistema
 * falla no es cobertura: es decoración.*
 *
 * ### Las mutaciones que esta suite tiene que tumbar
 * | Mutación | Test que cae |
 * |---|---|
 * | borrar el término **A1** | «A1 · el bruto ofertado por encima del tope NO se emite» |
 * | `>` → `>=` en **A1** (el borde) | «A1 · EL BORDE: el bruto EXACTAMENTE igual al tope SÍ se emite» |
 * | medir A1 con **`brutoConsumado`/`quotedTotalCents`** en vez de `G` | «⚠️ EL MONTO ES `G` …» |
 * | dejar que el **rol** levante el tope | «A1 · ⭐ el súper-admin NO lo levanta» |
 * | borrar el término **A2** | «A2 · sin INE en archivo y cruzando el umbral, NO se emite» |
 * | `>=` → `>` en **A2** (el borde) | «A2 · el umbral es INCLUSIVO» |
 * | leer `ineProvided` de la **columna** y no del `KycProfile` | «A2 · el INE se relee del `KycProfile` …» |
 * | emitir `thresholdCents` en `INE_REQUIRED` | «A2 · el `details` NO lleva el umbral» |
 * | `ineRequired` **no monótona** | «A2 · `ineRequired` es MONÓTONA» |
 * | borrar el término **A3** | «A3 · el acumulado del mes …» |
 * | **sumar** `G` en vez de sustituir la fila propia | «A3 · ⭐ contra-caso: NO hay doble conteo» |
 * | sacar A3 de la transacción **`SERIALIZABLE`** | «A3 · la transacción de la emisión es SERIALIZABLE» |
 * | poner A1/A2 **después** del tope del operador | «⭐ nada inofertable llega a la cola» |
 * | una guarda que **nunca oferte** (el falso verde) | «⭐ EL CAMINO FELIZ …» |
 */

const pii = new PiiCryptoService(new ConfigService({}));

/** ⚠️ Los DEFAULTS REALES de `settings.constants.ts`. No se tocan en esta suite. */
const CAP_PER_REQUEST = 300000; // MX$3,000
const CAP_PER_MONTH = 1000000; // MX$10,000
const INE_THRESHOLD = 300000; // MX$3,000  (= tope por solicitud)
const SHIPPING_FEE = 18000;
const OPERATOR_CAP = 150000; // MX$1,500

const DIALS: Record<string, number> = {
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: SHIPPING_FEE,
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: OPERATOR_CAP,
  [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: 2,
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: CAP_PER_REQUEST,
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: CAP_PER_MONTH,
  [SettingKey.INE_THRESHOLD_CENTS]: INE_THRESHOLD,
};

const OPERATOR = { id: 'op-1', role: 'vault_operator' as const };
const SUPER = { id: 'sa-1', role: 'super_admin' as const };

/** Un instante fijo DENTRO de un mes, para que la ventana del acumulado sea determinista. */
const NOW = new Date('2026-08-20T15:00:00Z');
const ESTE_MES = new Date('2026-08-03T00:00:00Z');
const MES_PASADO = new Date('2026-07-28T00:00:00Z');

type Row = Record<string, any>;

interface Opts {
  /** `quotedTotalCents` de la solicitud bajo prueba. **Deliberadamente BAJO** en casi todos los casos. */
  quotedTotalCents?: number;
  /** `createdAt` de la solicitud: dentro o fuera de la ventana del mes. */
  createdAt?: Date;
  /** `KycProfile` del vendedor. `null` = sin perfil (ni INE ni overrides). */
  kyc?: Row | null;
  /** OTRAS solicitudes del mismo vendedor que ya están en el acumulado. */
  otras?: Row[];
  /** Valor inicial de `ineRequired` en la fila (el que fijó el intake). */
  ineRequired?: boolean;
}

function build(opts: Opts = {}) {
  const item: Row = {
    id: 'it-1',
    sellRequestId: 'sr-1',
    cardId: 'card-1',
    card: {
      id: 'card-1',
      name: 'Charizard VMAX',
      number: '020',
      rarity: 'Rare Holo',
      rarityCanonical: 'rare',
      subtypes: null,
      availableFinishes: ['normal'],
      set: { id: 's1', name: 'Darkness Ablaze' },
    },
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    cardProductId: null,
    quotedPriceCents: 50000,
    approvedPriceCents: null,
    itemStatus: 'cotizada',
    inventoryItemId: null,
    offerDecision: null,
    offeredPriceCents: null,
    offerDerivedPriceCents: null,
    offerOverrideReason: null,
  };

  const request: Row = {
    id: 'sr-1',
    userId: 'u-1',
    user: { id: 'u-1', name: 'Ash Ketchum', email: 'ash@example.mx', locale: 'es' },
    status: 'cotizada',
    offerState: null,
    closedAt: null,
    // ⚠️ BAJO a propósito: es el número que `brutoConsumado` devolvería en este instante, y el que la
    // guarda **no** debe estar mirando.
    quotedTotalCents: opts.quotedTotalCents ?? 50000,
    approvedTotalCents: null,
    createdAt: opts.createdAt ?? ESTE_MES,
    pickupAddressSnapshot: { line1: 'Av. Central 123' },
    offerSentAt: null,
    offerAcceptDeadlineAt: null,
    offerGrossCents: null,
    offerShippingFeeCents: null,
    offerNetCents: null,
    offerIssueClockStartedAt: null,
    offerReissueCount: 0,
    offerCancelledAt: null,
    offerSentCancelledAt: null,
    acceptedAt: null,
    shipDeadlineAt: null,
    sellerShippedDeclaredAt: null,
    shipmentCarrier: null,
    shipmentTrackingNumber: null,
    guideCancellationPendingAt: null,
    guideCancellationDoneAt: null,
    ineRequired: opts.ineRequired ?? false,
    ineProvided: false,
  };

  /** El universo de filas del vendedor: la propia + las que el test declare. */
  const universo: Row[] = [request, ...(opts.otras ?? [])];

  const matches = (value: unknown, cond: unknown): boolean => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
      if ('not' in c) return !matches(value, c.not);
      if ('gte' in c) return value instanceof Date && value.getTime() >= (c.gte as Date).getTime();
      throw new Error(`condición no soportada: ${JSON.stringify(cond)}`);
    }
    if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
    return value === cond;
  };
  const whereHits = (where: Row, row: Row): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === 'OR') return (cond as Row[]).some((c) => whereHits(c, row));
      return matches(row[k], cond);
    });

  const isolationLevels: (string | undefined)[] = [];
  const mailsSent: unknown[] = [];

  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async ({ where }: any) => {
        const row = universo.find((r) => r.id === where.id);
        return row == null ? null : { ...row, items: [{ ...item }] };
      }),
      // ⚠️ El acumulado del mes: **evalúa el `where` de verdad** (`userId`, `createdAt gte` y el
      // `notIn` de los no-comprometedores). Sin esto, «se sustituye la fila propia» y «se suma dos
      // veces» darían el mismo resultado y el contra-caso de A3 no probaría nada.
      findMany: jest.fn(async ({ where }: any) => universo.filter((r) => whereHits(where, r))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const { id: _id, ...rest } = where;
        if (!whereHits(rest, request)) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      }),
    },
    sellRequestItem: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ids: string[] = where.id?.in ?? (where.id ? [where.id] : [item.id]);
        if (ids.includes(item.id)) Object.assign(item, data);
        return { count: ids.length };
      }),
      findMany: jest.fn(async () => []),
      aggregate: jest.fn(async () => ({
        _sum: { approvedPriceCents: null },
        _count: { approvedPriceCents: 0 },
      })),
    },
    kycProfile: { findUnique: jest.fn(async () => opts.kyc ?? null) },
    inventoryItem: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb: any, txOpts?: any) => {
      isolationLevels.push(txOpts?.isolationLevel);
      // Doble FIEL: si el callback lanza, **no queda nada escrito** (la propiedad de la que depende
      // «no se persiste, no sale correo, `offerSentAt` no se sella»).
      const snapReq = { ...request };
      const snapItem = { ...item };
      try {
        return await cb(prisma);
      } catch (e) {
        for (const k of Object.keys(request)) delete request[k];
        Object.assign(request, snapReq);
        for (const k of Object.keys(item)) delete item[k];
        Object.assign(item, snapItem);
        throw e;
      }
    }),
  };

  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    // Sin referencia de mercado: TODA línea `buy` sale por override con motivo, que es justo la
    // palanca de D26 que este invariante acota.
    getReferencesBatch: jest.fn(async (list: any[]) => {
      const m = new Map();
      for (const i of list) m.set(variantKey(i), { status: 'priced', referenceMxnCents: 100000 });
      return m;
    }),
    findCardProductsByTcgIds: jest.fn(async () => new Map()),
    getReferencesByCardProductBatch: jest.fn(async () => new Map()),
  };
  const settings = { getNumber: jest.fn(async (k: any) => DIALS[k as string] ?? 0) };
  const mail: MailPort = {
    send: jest.fn(async (m: unknown) => {
      mailsSent.push(m);
      return { id: 'm1' };
    }),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    pricing as unknown as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    mail,
  );
  return { svc, prisma, request, item, mail, mailsSent, isolationLevels, universo };
}

/** Emite con un override motivado que fija el bruto en `gross` exacto. */
const ofertaDe = (gross: number) => [
  {
    itemId: 'it-1',
    decision: 'buy' as const,
    overridePriceCents: gross,
    overrideReason: 'carta firmada, vale más que la curva',
  },
];

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

// =============================================================================================
describe('§M5-A · A1 — tope POR SOLICITUD sobre el bruto ofertado', () => {
  it('A1 · el bruto ofertado por encima del tope NO se emite: `422`, CERO escritura y NINGÚN correo', async () => {
    const { svc, request, item, mail } = build();
    await expect(
      svc.adminOffer('sr-1', SUPER, ofertaDe(CAP_PER_REQUEST + 1)),
    ).rejects.toMatchObject({
      code: 'BUYLIST_LIMIT_EXCEEDED',
      details: {
        scope: 'per_request_offer',
        capCents: CAP_PER_REQUEST,
        wouldBeCents: CAP_PER_REQUEST + 1,
      },
    });
    // Cero escritura: ni encabezado ni líneas.
    expect(request.offerGrossCents).toBeNull();
    expect(request.offerState).toBeNull();
    expect(request.offerSentAt).toBeNull();
    expect(request.status).toBe('cotizada');
    expect(item.offerDecision).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('A1 · EL BORDE: el bruto EXACTAMENTE igual al tope SÍ se emite (el comparador es `>`)', async () => {
    // ⭐ Sin este assert, el anterior lo pasa una guarda estricta de más que rechaza **justo la cifra
    // legal** — el error que D40 nombra para los tres bordes del ciclo.
    const { svc, request } = build({ kyc: { ineFrontKey: 'f', ineBackKey: 'b' } });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(CAP_PER_REQUEST));
    expect(res.response.offerGrossCents).toBe(CAP_PER_REQUEST);
    expect(request.offerState).toBe('sent');
    expect(request.status).toBe('ofertada');
  });

  it('A1 · ⭐ el súper-admin NO lo levanta: el mismo caso ilegal da el MISMO `422`', async () => {
    // *«El súper-admin oferta sin tope»* habla del tope del OPERADOR, que es **delegación**. El tope
    // AML es **cumplimiento sobre el vendedor**: ningún rol lo levanta. Éste es el assert que
    // distingue un tope de cumplimiento de un tope de delegación.
    for (const actor of [SUPER, OPERATOR]) {
      const { svc, request } = build();
      await expect(
        svc.adminOffer('sr-1', actor, ofertaDe(CAP_PER_REQUEST + 1)),
      ).rejects.toMatchObject({ code: 'BUYLIST_LIMIT_EXCEEDED', details: { scope: 'per_request_offer' } });
      expect(request.offerState).toBeNull();
    }
  });

  it('A1 · el override por KYC del VENDEDOR sí lo mueve (misma fuente que el intake)', async () => {
    const { svc, request } = build({
      kyc: { capPerRequestCentsOverride: 600000, ineFrontKey: 'f', ineBackKey: 'b' },
    });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(500000));
    expect(res.response.offerGrossCents).toBe(500000);
    expect(request.offerState).toBe('sent');
  });

  it('⚠️ EL MONTO ES `G`, NO `brutoConsumado`: una cotización BAJA no salva un bruto ofertado ALTO', async () => {
    // ⭐ La trampa de §M5-A.2: en este instante `approvedTotalCents` y `offerGrossCents` son `null`, así
    // que `brutoConsumado(req)` devolvería `quotedTotalCents` — **justo el número que no ve el
    // override**. Con la cotización en MX$500 y el override en MX$3,001, una guarda que midiera el
    // término que YA EXISTÍA pasaría feliz.
    const { svc } = build({ quotedTotalCents: 50000 });
    await expect(
      svc.adminOffer('sr-1', SUPER, ofertaDe(CAP_PER_REQUEST + 1)),
    ).rejects.toMatchObject({ code: 'BUYLIST_LIMIT_EXCEEDED' });
  });
});

// =============================================================================================
describe('§M5-A · A2 — umbral de INE sobre el bruto ofertado', () => {
  it('A2 · sin INE en archivo y cruzando el umbral, NO se emite: `422 INE_REQUIRED`, sin escritura ni correo', async () => {
    const { svc, request, mail } = build({ kyc: null });
    await expect(svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD))).rejects.toMatchObject({
      code: 'INE_REQUIRED',
      details: { sellRequestId: 'sr-1', grossCents: INE_THRESHOLD },
    });
    expect(request.offerState).toBeNull();
    expect(request.offerGrossCents).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('A2 · el umbral es INCLUSIVO (`>=`): el bruto EXACTAMENTE igual al umbral ya lo exige', async () => {
    // Y un centavo por debajo NO lo exige: sin este par, un `>` pasaría inadvertido.
    const bajo = build({ kyc: null });
    const res = await bajo.svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD - 1));
    expect(res.response.offerGrossCents).toBe(INE_THRESHOLD - 1);

    const justo = build({ kyc: null });
    await expect(
      justo.svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD)),
    ).rejects.toMatchObject({ code: 'INE_REQUIRED' });
  });

  it('A2 · el INE se relee del `KycProfile`, NO de la columna rancia de la solicitud', async () => {
    // ⭐ La fila dice `ineProvided: false` (snapshot del intake) y el `KycProfile` tiene las dos claves:
    // el vendedor lo subió DESPUÉS de crear la solicitud. *Negarle la oferta por leer un snapshot
    // rancio sería rechazarle un documento que ya nos dio.*
    const { svc, request } = build({ kyc: { ineFrontKey: 'front', ineBackKey: 'back' } });
    expect(request.ineProvided).toBe(false);
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD));
    expect(res.response.offerGrossCents).toBe(INE_THRESHOLD);
    expect(request.offerState).toBe('sent');
  });

  it('A2 · media credencial NO es credencial: con una sola cara sigue faltando el INE', async () => {
    for (const kyc of [{ ineFrontKey: 'f' }, { ineBackKey: 'b' }]) {
      const { svc } = build({ kyc });
      await expect(
        svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD)),
      ).rejects.toMatchObject({ code: 'INE_REQUIRED' });
    }
  });

  it('A2 · el `details` NO lleva el umbral (§M5-A.7: el operador no es el sujeto de la regla)', async () => {
    const { svc } = build({ kyc: null });
    await expect(svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD))).rejects.toMatchObject({
      details: expect.not.objectContaining({ thresholdCents: expect.anything() }),
    });
  });

  it('A2 · una oferta que cruza el umbral ENCIENDE `ineRequired` en la fila', async () => {
    const { svc, request } = build({
      ineRequired: false,
      kyc: { ineFrontKey: 'f', ineBackKey: 'b' },
    });
    await svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD));
    expect(request.ineRequired).toBe(true);
  });

  it('A2 · `ineRequired` es MONÓTONA: una oferta POR DEBAJO del umbral no la apaga', async () => {
    // ⭐ Apagarla revertiría en silencio una decisión de cumplimiento ya tomada (el intake la enciende
    // también cuando hay una línea en `precio_pendiente`, cuyo monto real aún no se conoce).
    const { svc, request } = build({ ineRequired: true, kyc: null });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(INE_THRESHOLD - 1));
    expect(res.response.offerGrossCents).toBe(INE_THRESHOLD - 1);
    expect(request.ineRequired).toBe(true);
  });
});

// =============================================================================================
describe('§M5-A · A3 — tope MENSUAL de compromiso, dentro de la transacción SERIALIZABLE', () => {
  it('A3 · el acumulado del mes CON esta fila sustituida por encima del tope ⇒ `422 per_month_offer`', async () => {
    // Otra solicitud viva del mismo vendedor, este mes, con MX$8,000 ya comprometidos.
    const { svc, request, mail } = build({
      kyc: { ineFrontKey: 'f', ineBackKey: 'b' },
      otras: [
        {
          id: 'sr-0',
          userId: 'u-1',
          status: 'ofertada',
          createdAt: ESTE_MES,
          offerGrossCents: 800000,
          quotedTotalCents: 800000,
        },
      ],
    });
    // 800000 (otra) + 250000 (ésta) = 1_050_000 > 1_000_000.
    await expect(svc.adminOffer('sr-1', SUPER, ofertaDe(250000))).rejects.toMatchObject({
      code: 'BUYLIST_LIMIT_EXCEEDED',
      details: { scope: 'per_month_offer', capCents: CAP_PER_MONTH, wouldBeCents: 1050000 },
    });
    // La transacción se deshizo entera: no se persiste, no sale correo, `offerSentAt` no se sella.
    expect(request.offerGrossCents).toBeNull();
    expect(request.offerSentAt).toBeNull();
    expect(request.status).toBe('cotizada');
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('A3 · ⭐ contra-caso: NO hay doble conteo — la fila propia se SUSTITUYE, no se suma', async () => {
    // La solicitud ya aporta su `quotedTotalCents` (MX$9,000) al acumulado. Su bruto ofertado, MX$2,500,
    // cabe de sobra en el tope mensual. Si el código sumara `G` sin excluirse, el acumulado sería
    // 900000 + 250000 = 1_150_000 y **rechazaría una oferta legítima**.
    const { svc, request } = build({
      quotedTotalCents: 900000,
      kyc: { ineFrontKey: 'f', ineBackKey: 'b' },
    });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(250000));
    expect(res.response.offerGrossCents).toBe(250000);
    expect(request.offerState).toBe('sent');
  });

  it('A3 · ⭐ la guarda asevera SU POST-CONDICIÓN: el acumulado tras la escritura es el que se juzgó', async () => {
    // §M5-A.5: *«la guarda asevera exactamente el valor que el acumulado devolverá el instante después
    // de la escritura»*. Se comprueba llamando al acumulado ANTES y DESPUÉS, con el mismo cuerpo que
    // usa el intake — sin leer el código de la guarda.
    const { svc, prisma } = build({
      quotedTotalCents: 900000,
      kyc: { ineFrontKey: 'f', ineBackKey: 'b' },
      otras: [
        {
          id: 'sr-0',
          userId: 'u-1',
          status: 'aceptada',
          createdAt: ESTE_MES,
          offerGrossCents: 100000,
          quotedTotalCents: 100000,
        },
      ],
    });
    const antes = await monthCommittedGrossCents(prisma, 'u-1', NOW);
    expect(antes).toBe(100000 + 900000); // la propia aporta su COTIZADO
    await svc.adminOffer('sr-1', SUPER, ofertaDe(250000));
    const despues = await monthCommittedGrossCents(prisma, 'u-1', NOW);
    expect(despues).toBe(100000 + 250000); // …y ahora aporta su BRUTO OFERTADO
    expect(despues).toBeLessThanOrEqual(CAP_PER_MONTH);
  });

  it('A3 · una fila TERMINAL que ya no compromete no quema cuota (predicado por complemento)', async () => {
    const { svc, request } = build({
      kyc: { ineFrontKey: 'f', ineBackKey: 'b' },
      otras: [
        {
          id: 'sr-0',
          userId: 'u-1',
          status: 'expirada', // ∈ NON_COMMITTING ⇒ fuera del acumulado
          createdAt: ESTE_MES,
          offerGrossCents: 900000,
          quotedTotalCents: 900000,
        },
      ],
    });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(250000));
    expect(res.response.offerGrossCents).toBe(250000);
    expect(request.offerState).toBe('sent');
  });

  it('A3 · el ancla es `createdAt`: una fila del mes PASADO no está en la ventana', async () => {
    const { svc, request } = build({
      kyc: { ineFrontKey: 'f', ineBackKey: 'b' },
      otras: [
        {
          id: 'sr-0',
          userId: 'u-1',
          status: 'ofertada',
          createdAt: MES_PASADO,
          offerGrossCents: 900000,
          quotedTotalCents: 900000,
        },
      ],
    });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(250000));
    expect(res.response.offerGrossCents).toBe(250000);
    expect(request.offerState).toBe('sent');
  });

  it('A3 · RESIDUAL NOMBRADO: la solicitud creada el mes pasado y ofertada este mes no topa aquí', async () => {
    // No es un olvido: es la consecuencia del ancla `createdAt`, declarada en §M5-A.5 y NO bloqueante
    // (al pagar, la fila entra al acumulado CONSUMADO del mes del pago y ahí sí topa).
    // *El compromiso puede cruzar el mes; el pago no.*
    const { svc, request } = build({
      createdAt: MES_PASADO,
      kyc: { ineFrontKey: 'f', ineBackKey: 'b' },
      otras: [
        {
          id: 'sr-0',
          userId: 'u-1',
          status: 'ofertada',
          createdAt: ESTE_MES,
          offerGrossCents: 990000,
          quotedTotalCents: 990000,
        },
      ],
    });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(250000));
    expect(res.response.offerGrossCents).toBe(250000);
    expect(request.offerState).toBe('sent');
  });

  it('A3 · la transacción de la emisión es `SERIALIZABLE` (si no, el tope es decorativo)', async () => {
    const { svc, isolationLevels } = build({ kyc: { ineFrontKey: 'f', ineBackKey: 'b' } });
    await svc.adminOffer('sr-1', SUPER, ofertaDe(250000));
    expect(isolationLevels).toContain(Prisma.TransactionIsolationLevel.Serializable);
  });
});

// =============================================================================================
describe('§M5-A.6 — DÓNDE va en la secuencia, y el camino feliz', () => {
  it('⭐ nada inofertable llega a la cola: `G > capPerRequest` como operador da `422`, NO `202`', async () => {
    // Una oferta que rompe el tope AML **no puede quedar esperando a un súper-admin que no tiene poder
    // para levantarlo**. Es la prueba de que A1 va ANTES del tope del operador y no después.
    const { svc, request } = build();
    await expect(
      svc.adminOffer('sr-1', OPERATOR, ofertaDe(CAP_PER_REQUEST + 1)),
    ).rejects.toMatchObject({ code: 'BUYLIST_LIMIT_EXCEEDED', details: { scope: 'per_request_offer' } });
    expect(request.offerState).not.toBe('pending_authorization');
    expect(request.offerState).toBeNull();
  });

  it('el piso de neto sigue ganando a A1 (se evalúa antes, y el orden es normativo)', async () => {
    const { svc } = build();
    await expect(svc.adminOffer('sr-1', SUPER, ofertaDe(20000))).rejects.toMatchObject({
      code: 'OFFER_NET_BELOW_MINIMUM',
    });
  });

  it('A1 gana a A2: si el monto es ilegal a ese tamaño, el INE no lo arregla', async () => {
    const { svc } = build({ kyc: null });
    await expect(
      svc.adminOffer('sr-1', SUPER, ofertaDe(CAP_PER_REQUEST + 1)),
    ).rejects.toMatchObject({ code: 'BUYLIST_LIMIT_EXCEEDED' });
  });

  it('⭐ EL CAMINO FELIZ: dentro de los tres términos la oferta SALE, con correo y plazo congelado', async () => {
    // *Sin este assert, los anteriores los pasa un endpoint que no oferta nunca.*
    const { svc, request, item, mail } = build({ kyc: { ineFrontKey: 'f', ineBackKey: 'b' } });
    const res = await svc.adminOffer('sr-1', SUPER, ofertaDe(250000));
    expect(res.response.offerGrossCents).toBe(250000);
    expect(res.response.offerNetCents).toBe(250000 - SHIPPING_FEE);
    expect(request.status).toBe('ofertada');
    expect(request.offerState).toBe('sent');
    expect(request.offerSentAt).toBeInstanceOf(Date);
    expect(request.offerAcceptDeadlineAt).toBeInstanceOf(Date);
    expect(item.offerDecision).toBe('buy');
    expect(item.offeredPriceCents).toBe(250000);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('⭐ EL CAMINO FELIZ del `202`: dentro del AML pero sobre el tope del OPERADOR ⇒ espera, sin correo', async () => {
    const { svc, request, mail } = build({ kyc: { ineFrontKey: 'f', ineBackKey: 'b' } });
    const res = await svc.adminOffer('sr-1', OPERATOR, ofertaDe(250000));
    expect(res.audit.requiresAuthorization).toBe(true);
    expect(request.offerState).toBe('pending_authorization');
    expect(request.status).toBe('cotizada');
    expect(mail.send).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('§M5-A.8 — `sellerIneOnFile` en la mesa de decisión', () => {
  it('la mesa emite `sellerIneOnFile` SIEMPRE, derivado del `KycProfile`', async () => {
    const sin = build({ kyc: null });
    expect((await sin.svc.adminDecisionTable('sr-1', SUPER)).sellerIneOnFile).toBe(false);

    const con = build({ kyc: { ineFrontKey: 'f', ineBackKey: 'b' } });
    expect((await con.svc.adminDecisionTable('sr-1', SUPER)).sellerIneOnFile).toBe(true);

    const media = build({ kyc: { ineFrontKey: 'f' } });
    expect((await media.svc.adminDecisionTable('sr-1', SUPER)).sellerIneOnFile).toBe(false);
  });

  it('⛔ la mesa NO gana el umbral, ni los topes, ni el acumulado del mes (la lista es CERRADA)', async () => {
    const { svc } = build({ kyc: null });
    const mesa = (await svc.adminDecisionTable('sr-1', SUPER)) as Record<string, unknown>;
    for (const prohibido of [
      'ineThresholdCents',
      'thresholdCents',
      'capPerRequestCents',
      'capPerMonthCents',
      'monthCommittedCents',
      'amlCapExceeded',
    ]) {
      expect(mesa).not.toHaveProperty(prohibido);
      expect(mesa.totals as Record<string, unknown>).not.toHaveProperty(prohibido);
    }
    // Y va en la RAÍZ, no en `totals`.
    expect(mesa).toHaveProperty('sellerIneOnFile');
    expect(mesa.totals as Record<string, unknown>).not.toHaveProperty('sellerIneOnFile');
  });
});
