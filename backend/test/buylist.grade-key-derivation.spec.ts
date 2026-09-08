import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ProductType } from '@prisma/client';

// ⚠️ EL MOCK ES EL SPEC. `BUYLIST_ACCEPTED_PRODUCT_TYPES` es una constante de módulo, así que se
// intercepta con un GETTER para poder ensanchar la lista **dentro de un test** y observar qué hace
// el código el día de `M-49`. Sin esto, «qué pasa cuando la lista cambie» solo se puede razonar, y
// razonar es exactamente lo que falló: el predicado y la derivación parecían moverse juntos.
//
// ⚠️ v1.55 — **el truco ya no vive aquí**: se movió a `test/helpers/widen-list.ts` para que lo reuse
// quien toque **cualquier lista de política de esta clase** (una `readonly T[]` exportada que un
// `switch`, una guarda o un barrido consuman). Encontró dos defectos en dos pases; no es una
// curiosidad de este archivo. `require` y no `import` porque el factory de `jest.mock` se iza por
// encima de los imports.
jest.mock('../src/common/business-rules', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./helpers/widen-list').widenableModule(
    jest.requireActual('../src/common/business-rules'),
    'BUYLIST_ACCEPTED_PRODUCT_TYPES',
  ),
);

import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { MailPort } from '../src/modules/mail/mail.port';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { variantKey, variantPositionKey } from '../src/common/variant-key';
import { BUYLIST_ACCEPTED_PRODUCT_TYPES } from '../src/common/business-rules';
import { resetLists, setList } from './helpers/widen-list';
import {
  InventoryPositionPort,
  VariantPositionRef,
} from '../src/modules/inventory/inventory-position.port';

/**
 * ⚠️⚠️ v1.54/v1.55 · **B-3 — SON DOS PREGUNTAS: `llaveable = ACEPTADO ∧ CLAVABLE`.**
 *
 * ### El defecto que este spec ancla (techlead, gate de v1.54)
 * v1.53 unificó **el permiso**: `lineIsKeyable` dejó de preguntar `productType === 'raw'` y pasó a
 * consultar `BUYLIST_ACCEPTED_PRODUCT_TYPES`, la misma lista que usa la guarda. La intención era
 * correcta —*«la guarda y la degradación se ensanchan a la vez o no se ensanchan»*— **pero el código
 * no la implementaba**: la **derivación** seguía siendo el literal `{ productType: 'raw', … }`
 * escrito a mano en tres sitios, y uno de sus comentarios **declaraba el invariante del que
 * dependía** (*«la lista = `['raw']`»*), que es justo lo que la lista compartida existe para poder
 * cambiar.
 *
 * **Qué pasaba el día de `M-49`** (añadir `'graded'` a la lista, por el camino que §4.40.6 describe):
 * la guarda **deja pasar** ⇒ la derivación produce **`raw:NM` para una graduada** ⇒ las tres
 * superficies cotizan contra la referencia **raw** —el defecto de v1.53 con otro literal— y la mesa
 * emite **`stock: 0` con `positionUnavailable: false`**: el cero que §P.8 prohíbe, con cara de dato.
 *
 * ### Lo que se prueba, y por qué así
 * Estos tests **ensanchan la lista de verdad** (el `jest.mock` de arriba) en vez de confiar en una
 * lectura del código. Es la única forma de que la aserción siga siendo cierta el día que alguien
 * ensanche la lista **de veras**: si ese día la derivación no se visita, **este spec cae aquí**, y no
 * en producción sobre una oferta vinculante.
 *
 * Y la contrapartida: **una lista ensanchada no vale por sí sola**. `M-49` no es «añadir un string»,
 * es capturar la identidad del slab; hasta que exista, lo correcto es `SIN PRECIO` + `SIN CONTEO`.
 *
 * ### ⚠️ v1.55 — la forma final: DOS preguntas, no una lista partida
 * La política de producto sigue siendo **UNA** lista (`BUYLIST_ACCEPTED_PRODUCT_TYPES`); lo que
 * faltaba era la **segunda pregunta**, la de capacidad técnica:
 * `llaveable = isPurchasableProductType ∧ identityGradeKeyInput`. Tienen **dueños y fechas de cierre
 * distintos** —`graded` desbloquea con `M-49` (producto), `sealed` con `BL-33` (backend) más una
 * columna de identidad en la fila—, y por eso no pueden ser un booleano. El bloque `(0-bis)` prueba
 * que **las dos están vivas**: cada una sola basta para negar la llave.
 */

const pii = new PiiCryptoService(new ConfigService({}));

const DIALS: Record<string, number> = {
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
  // v1.58 · §M5-A (BL-38) — los tres diales AML/INE que `adminOffer` lee desde v1.58. Van con sus
  // DEFAULTS reales (`settings.constants.ts`): sin ellos el doble devuelve `0` para las tres claves y
  // **toda** oferta rebotaría con `422 BUYLIST_LIMIT_EXCEEDED`.
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: 300000,
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: 1000000,
  [SettingKey.INE_THRESHOLD_CENTS]: 300000,
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000,
  [SettingKey.BUYLIST_VARIANT_POSITION_CAP]: 3,
  [SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]: 2,
};

const OPERATOR = { id: 'op-1', role: 'vault_operator' as const };
const SUPER = { id: 'sa-1', role: 'super_admin' as const };

/** Las tres funciones privadas, expuestas para el test: son estáticas, puras y no tocan `this`. */
type Line0 = { productType: ProductType; rawCondition?: string | null };
const statics = BuylistService as unknown as {
  gradeKeyInputFor(l: Line0): unknown;
  identityGradeKeyInput(l: Line0): unknown;
  isPurchasableProductType(t: ProductType): boolean;
};
/** La CONJUNCIÓN: `ACEPTADO ∧ CLAVABLE`. Es la que consumen los call-sites de lectura. */
const gradeKeyInputFor = (line: Line0) => statics.gradeKeyInputFor(line);
/** Sólo la pregunta TÉCNICA. */
const identityGradeKeyInput = (line: Line0) => statics.identityGradeKeyInput(line);
/** Sólo la pregunta de POLÍTICA. */
const isPurchasableProductType = (t: ProductType) => statics.isPurchasableProductType(t);

interface Line {
  id: string;
  productType?: ProductType;
}

interface OtherLine {
  status: string;
  productType?: ProductType;
}

function build(opts: {
  lines: Line[];
  otherLines?: OtherLine[];
  onHand?: Record<string, number>;
  refCents?: number | null;
}) {
  const card = (id: string) => ({
    id,
    name: 'Charizard VMAX',
    number: '020',
    rarity: 'Rare Holo',
    rarityCanonical: 'rare',
    subtypes: null,
    availableFinishes: ['normal'],
    set: { id: 'swsh3', name: 'Darkness Ablaze' },
  });

  const items = opts.lines.map((l) => ({
    id: l.id,
    sellRequestId: 'sr-1',
    cardId: 'card-1',
    card: card('card-1'),
    productType: l.productType ?? 'raw',
    // ⚠️ Ni `gradingCompany` ni `gradeValue`: NO EXISTEN en `SellRequestItem`. Ésa es la razón 1 de
    // la degradación, y el fixture la reproduce fielmente.
    rawCondition: (l.productType ?? 'raw') === 'raw' ? 'NM' : null,
    finish: 'normal',
    cardProductId: null,
    quotedPriceCents: 90000,
    approvedPriceCents: null,
    itemStatus: 'cotizada',
    inventoryItemId: null,
    offerDecision: null as string | null,
    offeredPriceCents: null as number | null,
    offerDerivedPriceCents: null as number | null,
    offerOverrideReason: null as string | null,
  }));

  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u-1',
    user: { id: 'u-1', name: 'Ash Ketchum', email: 'ash@example.mx', locale: 'es' },
    status: 'cotizada',
    offerState: null,
    closedAt: null,
    quotedTotalCents: 90000,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    pickupAddressSnapshot: { line1: 'Av. Central 123' },
    offerSentAt: null,
    offerAcceptDeadlineAt: null,
    offerGrossCents: null,
    offerShippingFeeCents: null,
    offerNetCents: null,
    offerIssueClockStartedAt: null,
    offerReissueCount: 0,
    offerCancelledAt: null,
    ineRequired: false,
    ineProvided: false,
  };

  const prisma: any = {
    card: { findUnique: jest.fn(async () => card('card-1')) },
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request, items: items.map((i) => ({ ...i })) })),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(request, data);
        return { count: 1 };
      }),
      findMany: jest.fn(async () => []),
    },
    sellRequestItem: {
      findMany: jest.fn(async () =>
        (opts.otherLines ?? []).map((o) => ({
          cardId: 'card-1',
          productType: o.productType ?? 'raw',
          rawCondition: (o.productType ?? 'raw') === 'raw' ? 'NM' : null,
          finish: 'normal',
          cardProductId: null,
          sellRequest: { status: o.status },
        })),
      ),
      // ⚠️ APLICA de verdad: un fake que solo cuenta dejaría pasar una emisión que no escribió nada,
      // y la guarda de proyección (BL-24) existe precisamente para atrapar eso.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ids: string[] = where?.id?.in ?? (where?.id ? [where.id] : items.map((i) => i.id));
        for (const it of items) if (ids.includes(it.id)) Object.assign(it, data);
        return { count: ids.length };
      }),
      aggregate: jest.fn(async () => ({
        _sum: { approvedPriceCents: null },
        _count: { approvedPriceCents: 0 },
      })),
    },
    kycProfile: { findUnique: jest.fn(async () => null) },
    inventoryItem: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };

  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // El CUERPO REAL: si la derivación mandara un input `graded` incompleto, esto LANZA
    // (`IncompleteGradeIdentityError`) en vez de devolver una clave inventada.
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    getVariantOverride: jest.fn(async () => null),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getReference: jest.fn(async () =>
      opts.refCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.refCents },
    ),
    getReferencesBatch: jest.fn(async (list: any[]) => {
      const m = new Map<string, unknown>();
      if (opts.refCents != null) {
        for (const i of list) m.set(variantKey(i), { status: 'priced', referenceMxnCents: opts.refCents });
      }
      return m;
    }),
    findCardProductsByTcgIds: jest.fn(async () => new Map()),
    getReferencesByCardProductBatch: jest.fn(async () => new Map()),
    settlePendingForVariant: jest.fn(async () => undefined),
  };

  const settings = { getNumber: jest.fn(async (k: any) => DIALS[k as string] ?? 0) };

  const seenRefs: VariantPositionRef[][] = [];
  const port: InventoryPositionPort = {
    onHandCountsFor: jest.fn(async (refs: VariantPositionRef[]) => {
      seenRefs.push(refs);
      const m = new Map<string, number>();
      for (const r of refs) {
        const n = (opts.onHand ?? {})[variantPositionKey(r)];
        if (n != null) m.set(variantPositionKey(r), n);
      }
      return m;
    }),
  };

  const mail: MailPort = { send: jest.fn(async () => ({ id: 'm1' })) };

  const svc = new BuylistService(
    prisma as PrismaService,
    pricing as unknown as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    mail,
    port,
  );
  return { svc, seenRefs, pricing, items };
}

const K_RAW = variantPositionKey({
  cardId: 'card-1',
  productType: 'raw',
  gradeKey: 'raw:NM',
  finish: 'normal',
  cardProductId: null,
});

/** Ensancha (o estrecha) la lista de política VIVA durante el test. Tipada a `ProductType`. */
const widenAcceptedTypes = (types: readonly ProductType[]) =>
  setList('BUYLIST_ACCEPTED_PRODUCT_TYPES', types);

afterEach(() => {
  // ⚠️ El override es estado GLOBAL del helper: sin esto se filtra al siguiente test.
  resetLists();
  jest.restoreAllMocks();
});

// =============================================================================================
describe('(0-bis) son DOS preguntas, y las dos están vivas', () => {
  // `llaveable = ACEPTADO ∧ CLAVABLE`. Cada leg tiene dueño y fecha de cierre propios: la política
  // la mueve el dueño del producto (`M-49`); la capacidad técnica la movemos nosotros (`BL-33` y la
  // captura de identidad). Que hoy las dos digan «no» a lo mismo es coincidencia, no equivalencia.
  it('la POLÍTICA sola no basta: con la lista ensanchada, `graded` es aceptado y aun así NO se llavea', () => {
    widenAcceptedTypes(['raw', 'graded']);
    expect(isPurchasableProductType('graded')).toBe(true); // pregunta 1: sí
    expect(identityGradeKeyInput({ productType: 'graded' })).toBeNull(); // pregunta 2: no
    expect(gradeKeyInputFor({ productType: 'graded' })).toBeNull(); // conjunción: no
  });

  it('la CAPACIDAD sola no basta: con la lista vacía, `raw` es clavable y aun así NO se llavea', () => {
    widenAcceptedTypes([]);
    expect(identityGradeKeyInput({ productType: 'raw' })).not.toBeNull(); // pregunta 2: sí
    expect(isPurchasableProductType('raw')).toBe(false); // pregunta 1: no
    expect(gradeKeyInputFor({ productType: 'raw' })).toBeNull(); // conjunción: no
  });
});

// =============================================================================================
describe('(0) la derivación es un `switch` EXHAUSTIVO, y cada `null` tiene su propia razón', () => {
  it('`raw` ⇒ SU input (y el `NM` no se rellena aquí: lo pone su dueño, `buildGradeKey`)', () => {
    expect(gradeKeyInputFor({ productType: 'raw', rawCondition: 'NM' })).toEqual({
      productType: 'raw',
      rawCondition: 'NM',
    });
    expect(gradeKeyInputFor({ productType: 'raw' })).toEqual({
      productType: 'raw',
      rawCondition: null,
    });
  });

  it('⚠️ `graded` ⇒ `null` — RAZÓN A: la fila no guarda identidad de slab (desbloquea M-49)', () => {
    expect(gradeKeyInputFor({ productType: 'graded' })).toBeNull();
    // Y lo que importa de verdad: NO devuelve el input de raw disfrazado.
    expect(gradeKeyInputFor({ productType: 'graded' })).not.toEqual({
      productType: 'raw',
      rawCondition: null,
    });
  });

  it('⚠️ `sealed` ⇒ `null` — RAZÓN B: ni la fila dice qué producto es, ni la clave plana lo distingue', () => {
    // v1.55, re-diagnosticado y verificado en el código: `SellRequestItem` no tiene `sealedProductId`
    // (`cardProductId` es OTRO eje), y la clave plana `'sealed'` que devolvería `buildGradeKey` es la
    // del override MANUAL del admin (§4.19d), no una identidad de producto — la de mercado es
    // `sealedMarketGradeKey()` ⇒ `sealed:tcg:<productId>`. Desbloquea BL-33 + una columna en la fila.
    expect(gradeKeyInputFor({ productType: 'sealed' })).toBeNull();
  });

  it('⚠️ las dos razones son INDEPENDIENTES: cerrar M-49 no cerraría la de sellado', () => {
    // Anclado como aserción y no solo como comentario porque las notas de la rama llegaron a decir
    // las dos cosas a la vez («la lista VA a cambiar» / «el continue ya estrechó a raw»), y solo una
    // podía ser cierta. Aquí queda escrito qué desbloquea qué: son ramas distintas del mismo switch.
    const razones = {
      graded: 'M-49 — capturar la identidad del slab en SellRequestItem',
      // v1.55: re-diagnosticado. NO es «cambiar la forma del puerto entre streams» (ese diagnóstico
      // era mío y era falso): la identidad del sellado ya cabe en `gradeKey` y el arreglo del conteo
      // es un defecto de adaptador dentro de `inventory` ⇒ BL-33, backend, no bloqueante.
      sealed: 'BL-33 (adaptador) + una columna de identidad de sellado en la fila',
    };
    expect(razones.graded).not.toBe(razones.sealed);
    expect(identityGradeKeyInput({ productType: 'graded' })).toBeNull();
    expect(identityGradeKeyInput({ productType: 'sealed' })).toBeNull();
  });

  it('hoy la lista de negocio y la derivación COINCIDEN — y esa coincidencia es el estado sano', () => {
    for (const t of BUYLIST_ACCEPTED_PRODUCT_TYPES) {
      expect(gradeKeyInputFor({ productType: t })).not.toBeNull();
    }
    expect([...BUYLIST_ACCEPTED_PRODUCT_TYPES]).toEqual(['raw']);
  });
});

// =============================================================================================
describe('⚠️⚠️ (1) EL DÍA DE M-49: se ensancha la lista de negocio y NADA cotiza contra la referencia raw', () => {
  const WIDENED: readonly ProductType[] = ['raw', 'graded'];

  it('la mesa NO le pregunta al puerto por la graduada, y JAMÁS con la llave `raw:NM`', async () => {
    widenAcceptedTypes(WIDENED);
    const { svc, seenRefs } = build({
      lines: [
        { id: 'it-raw', productType: 'raw' },
        { id: 'it-grd', productType: 'graded' },
      ],
      onHand: { [K_RAW]: 2 },
      refCents: 200000,
    });
    await svc.adminDecisionTable('sr-1', OPERATOR);

    // Una sola pregunta, y solo por la línea raw. Con el literal clavado, la graduada entraba al
    // lote llaveada `raw:NM` y **sumaba al mismo bucket que la raw**.
    expect(seenRefs).toHaveLength(1);
    expect(seenRefs[0]).toHaveLength(1);
    expect(seenRefs[0][0]).toMatchObject({ productType: 'raw', gradeKey: 'raw:NM' });
    expect(seenRefs[0].some((r) => r.productType === 'graded')).toBe(false);
  });

  it('⚠️ EL CERO PROHIBIDO NO APARECE: la graduada sale SIN CONTEO, no con `stock: 0`', async () => {
    widenAcceptedTypes(WIDENED);
    const { svc } = build({ lines: [{ id: 'it-grd', productType: 'graded' }], refCents: 200000 });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const line = res.lines[0];

    // Literal, no `toBeFalsy()`: `toBeFalsy()` pasaría con el 0, que es el valor PROHIBIDO (§P.8).
    expect(line.position).toBeNull();
    expect(line.positionUnavailable).toBe(true);
    expect(line.suggestion).toMatchObject({ verdict: 'none', rule: null });
    // La combinación exacta que el defecto producía: un conteo con cara de dato cierto.
    expect(line.positionUnavailable === false && line.position != null).toBe(false);
  });

  it('⚠️ y NO se le pone precio derivado: sin identidad no hay referencia, aunque el mercado exista', async () => {
    widenAcceptedTypes(WIDENED);
    const { svc } = build({ lines: [{ id: 'it-grd', productType: 'graded' }], refCents: 200000 });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].derivedPriceCents).toBeNull();
    expect(res.lines[0].priceBasis).toBe('pending');
    // El snapshot histórico sí viaja: es lo que se le dijo al vendedor aquel día.
    expect(res.lines[0].quotedPriceCents).toBe(90000);
    expect(res.totals.buyableGrossCents).toBe(0);
  });

  it('⚠️ los sumandos de PROMESA tampoco se contaminan (la otra mitad de la misma llave)', async () => {
    // Éste es el sitio donde el literal `{ productType: 'raw' }` hacía MÁS daño: el `continue` dejaba
    // pasar la graduada ajena y la llaveaba `raw:NM`, así que **sumaba al bucket de la raw** e inflaba
    // el total contra el que se juzga el tope. Un `do_not_buy` inventado es dinero que NO se gana; el
    // mismo error al revés es dinero que se paga de más.
    widenAcceptedTypes(WIDENED);
    const { svc } = build({
      lines: [{ id: 'it-raw', productType: 'raw' }],
      otherLines: [
        { status: 'en_transito', productType: 'graded' },
        { status: 'en_transito', productType: 'graded' },
        { status: 'en_transito', productType: 'sealed' },
      ],
      refCents: 200000,
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].position).toEqual({
      stock: 0,
      verifying: 0,
      inTransit: 0,
      committed: 0,
      total: 0,
    });
    // Con el tope en 3, tres graduadas ajenas mal contadas habrían dado `do_not_buy`.
    expect(res.lines[0].suggestion).toMatchObject({ verdict: 'buy' });
  });

  it('⚠️ el COTIZADOR PÚBLICO se niega en vez de cotizar contra la referencia raw (el dinero LANZA)', async () => {
    widenAcceptedTypes(WIDENED);
    const { svc, pricing } = build({ lines: [{ id: 'it-1' }], refCents: 200000 });
    // La guarda de negocio YA no protege: la lista dice que las graduadas se compran.
    await expect(svc.publicQuote('card-1', 'graded' as ProductType)).rejects.toMatchObject({
      code: 'BUYLIST_LINE_NOT_KEYABLE',
      status: 500,
    });
    // Lo que NO pasó: construir una clave. Ni `raw:NM`, ni `graded:PSA:10`, ninguna.
    expect(pricing.gradeKeyFor).not.toHaveBeenCalled();
  });

  it('con la lista SIN ensanchar, la misma llamada es `422 BUYLIST_RAW_ONLY` (y tampoco cotiza)', async () => {
    const { svc, pricing } = build({ lines: [{ id: 'it-1' }], refCents: 200000 });
    await expect(svc.publicQuote('card-1', 'graded' as ProductType)).rejects.toMatchObject({
      code: 'BUYLIST_RAW_ONLY',
      status: 422,
    });
    expect(pricing.gradeKeyFor).not.toHaveBeenCalled();
  });

  it('⚠️ y el desajuste se GRITA AL ARRANCAR: ensanchar la lista sin escribir la rama es un defecto de despliegue', async () => {
    widenAcceptedTypes(WIDENED);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc } = build({ lines: [{ id: 'it-1' }] });
    svc.onModuleInit();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('graded'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('identityGradeKeyInput'));
  });

  it('⚠️⚠️ v1.55 — pero el arranque NO ES EL DETECTOR: avisa y la app SUBE IGUAL', async () => {
    // Atribución corregida (techlead, gate de v1.55). Varios comentarios vendían `onModuleInit` como
    // *el* mecanismo que frena el desajuste. **No frena nada**: hace `logger.error` y devuelve. Un
    // despliegue con la lista ensanchada y la rama sin escribir **sube en verde**, y el aviso queda en
    // una línea de log.
    //
    // **El detector real es ESTE archivo**: ensancha la lista VIVA (`test/helpers/widen-list.ts`) y
    // rompe el build antes de que nada se despliegue. Se asevera aquí, y no en un comentario, para
    // que la atribución no pueda volver a torcerse en silencio.
    widenAcceptedTypes(WIDENED);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc } = build({ lines: [{ id: 'it-1' }] });
    expect(() => svc.onModuleInit()).not.toThrow();
  });

  it('con la lista sana, el arranque NO grita por la derivación', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc } = build({ lines: [{ id: 'it-1' }] });
    svc.onModuleInit();
    expect(
      error.mock.calls.filter((c) => String(c[0]).includes('identityGradeKeyInput')),
    ).toHaveLength(0);
  });
});

// =============================================================================================
describe('(2) la EMISIÓN: la línea legacy no-raw obliga a una decisión humana, no se firma sola', () => {
  it('⚠️ `buy` sobre una línea LEGACY graduada sin override ⇒ `422 OFFER_LINE_NOT_PRICEABLE`', async () => {
    // El único test que existía de este código llegaba por OTRA puerta (`refCents: null`, o sea el
    // hueco de mercado). Ésta es la puerta de la guarda raw-only: el mercado EXISTE (`refCents`), y
    // aun así la línea no tiene precio derivable porque no hay llave con la que buscarlo.
    // *La lectura degrada; la firma sigue exigiendo una decisión humana registrada.*
    const { svc } = build({ lines: [{ id: 'it-grd', productType: 'graded' }], refCents: 200000 });
    await expect(
      svc.adminOffer('sr-1', SUPER, [{ itemId: 'it-grd', decision: 'buy' }]),
    ).rejects.toMatchObject({
      code: 'OFFER_LINE_NOT_PRICEABLE',
      details: { itemIds: ['it-grd'] },
    });
  });

  it('y `skip` sobre esa misma línea SÍ pasa: lo que se exige es decidir, no comprar', async () => {
    const { svc, items } = build({
      lines: [
        { id: 'it-grd', productType: 'graded' },
        { id: 'it-raw', productType: 'raw' },
      ],
      refCents: 200000,
    });
    const res = await svc.adminOffer('sr-1', SUPER, [
      { itemId: 'it-grd', decision: 'skip' },
      { itemId: 'it-raw', decision: 'buy' },
    ]);
    expect(res.response.offerGrossCents).toBeGreaterThan(0);
    // La línea saltada no aporta monto y no rompe la oferta de las demás (criterio 161b).
    expect(items.find((i) => i.id === 'it-grd')!.offeredPriceCents).toBeNull();
  });
});
