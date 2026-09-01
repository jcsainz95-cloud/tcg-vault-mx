import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { variantKey, variantPositionKey } from '../src/common/variant-key';
import {
  InventoryPositionPort,
  VariantPositionRef,
} from '../src/modules/inventory/inventory-position.port';

/**
 * v1.51 (M-46, D6 · API_CONTRACT §M5 · ARCHITECTURE §4.39f/g · criterios 115/116/117/144/153) —
 * **LA MESA DE DECISIÓN.**
 *
 * Lo que estos tests protegen NO es la ruta feliz: es **lo que la mesa promete cuando algo va mal**,
 * que es justo donde una pantalla de dinero se rompe en silencio.
 *
 *  1. **Puerto caído ⇒ `position: null` + `positionUnavailable: true`. JAMÁS `0`** — y se asevera
 *     `toBeNull()` / `not.toBe(0)`, no `toBeFalsy()`: `toBeFalsy()` pasaría con `0`, que es
 *     EXACTAMENTE el bug.
 *  2. **Los cuatro sumandos van separados**, y una solicitud `aceptada` **no** entra en `inTransit`.
 *  3. **La sugerencia nunca impide ofertar** y **nombra la regla**.
 *  4. **Un bounty legacy con `targetQty = null` cae al TOPE GENERAL** (`rule: 'variant_cap'`).
 *  5. **No hay N+1**: las llamadas a Prisma **no crecen** con el número de líneas.
 */

const pii = new PiiCryptoService(new ConfigService({}));

const DIALS: Record<string, number> = {
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000,
  [SettingKey.BUYLIST_VARIANT_POSITION_CAP]: 10,
};

interface FakeLine {
  id: string;
  cardId?: string;
  finish?: string;
  cardProductId?: number | null;
  quotedPriceCents?: number | null;
  rawCondition?: string | null;
}

/** Línea VIVA de otra solicitud que aporta a la posición (verificando / tránsito / comprometido). */
interface OtherLine {
  cardId?: string;
  finish?: string;
  cardProductId?: number | null;
  status: string;
}

interface Opts {
  lines: FakeLine[];
  /** Referencia de mercado por acabado (MXN cents). Ausente ⇒ `precio_pendiente`. */
  refs?: Record<string, number>;
  /** Fila M-30 de la variante (bounty/override), llaveada por `variantKey`. */
  overrides?: Record<string, Record<string, unknown>>;
  /** Piezas on-hand que devuelve el PUERTO, por `variantPositionKey`. */
  onHand?: Record<string, number>;
  /** `null` ⇒ el puerto NO está cableado. `'throw'` ⇒ el puerto revienta. */
  port?: 'missing' | 'throw' | 'ok';
  otherLines?: OtherLine[];
  status?: string;
  pickupAddressSnapshot?: unknown;
}

function build(opts: Opts) {
  const cardOf = (id: string) => ({
    id,
    externalId: `ext-${id}`,
    name: 'Charizard VMAX',
    number: '020',
    numberSort: 20,
    numberPrefix: '',
    rarity: 'Rare Holo',
    rarityCanonical: 'rare',
    supertype: 'Pokémon',
    subtypes: null,
    setId: 'swsh3',
    set: { id: 'swsh3', name: 'Darkness Ablaze' },
    imageSmallUrl: null,
    imageLargeUrl: null,
    availableFinishes: ['normal', 'holofoil', 'reverse_holo'],
  });

  const prismaCalls: string[] = [];
  const track = <T>(name: string, fn: (args?: any) => Promise<T>) =>
    jest.fn(async (args?: any) => {
      prismaCalls.push(name);
      return fn(args);
    });

  const prisma: any = {
    sellRequest: {
      findUnique: track('sellRequest.findUnique', async () => ({
        id: 'sr-1',
        userId: 'u-1',
        user: { id: 'u-1', name: 'Ash Ketchum', email: 'ash@example.com' },
        status: opts.status ?? 'cotizada',
        quotedTotalCents: 90000,
        pickupAddressSnapshot:
          'pickupAddressSnapshot' in opts ? opts.pickupAddressSnapshot : { line1: 'Calle 1' },
        items: opts.lines.map((l) => ({
          id: l.id,
          cardId: l.cardId ?? 'card-1',
          card: cardOf(l.cardId ?? 'card-1'),
          productType: 'raw',
          rawCondition: (l.rawCondition ?? 'NM') as string,
          finish: l.finish ?? 'normal',
          cardProductId: l.cardProductId ?? null,
          quotedPriceCents: l.quotedPriceCents ?? 90000,
        })),
      })),
    },
    sellRequestItem: {
      findMany: track('sellRequestItem.findMany', async () =>
        (opts.otherLines ?? []).map((o) => ({
          cardId: o.cardId ?? 'card-1',
          productType: 'raw',
          rawCondition: 'NM',
          finish: o.finish ?? 'normal',
          cardProductId: o.cardProductId ?? null,
          sellRequest: { status: o.status },
        })),
      ),
    },
  };

  const refKeyed = opts.refs ?? {};
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    getVariantOverridesBatch: track('pricing.getVariantOverridesBatch', async () => {
      const m = new Map<string, unknown>();
      for (const [k, v] of Object.entries(opts.overrides ?? {})) m.set(k, v);
      return m;
    }),
    getReferencesBatch: track('pricing.getReferencesBatch', async (items: any[]) => {
      const m = new Map<string, unknown>();
      for (const i of items ?? []) {
        const cents = refKeyed[i.finish];
        if (cents != null) m.set(variantKey(i), { status: 'priced', referenceMxnCents: cents });
      }
      return m;
    }),
    findCardProductsByTcgIds: track('pricing.findCardProductsByTcgIds', async () => new Map()),
    getReferencesByCardProductBatch: track(
      'pricing.getReferencesByCardProductBatch',
      async () => new Map(),
    ),
  };

  const settings = {
    getNumber: track('settings.getNumber', async (key: any) => DIALS[key as string] ?? 0),
  };

  const port: InventoryPositionPort = {
    onHandCountsFor: jest.fn(async (refs: VariantPositionRef[]) => {
      prismaCalls.push('port.onHandCountsFor');
      if (opts.port === 'throw') throw new Error('boom: la BD de inventario no responde');
      const m = new Map<string, number>();
      for (const r of refs) {
        const n = (opts.onHand ?? {})[variantPositionKey(r)];
        if (n != null) m.set(variantPositionKey(r), n);
      }
      return m;
    }),
  };

  const svc = new BuylistService(
    prisma as unknown as PrismaService,
    pricing as unknown as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    undefined,
    opts.port === 'missing' ? undefined : port,
  );
  return { svc, prismaCalls, port };
}

const OPERATOR = { id: 'op-1', role: 'vault_operator' as const };
const SUPER = { id: 'sa-1', role: 'super_admin' as const };

/** La variante por defecto de los fixtures: `card-1`, raw NM, normal, set_base. */
const K = variantPositionKey({
  cardId: 'card-1',
  productType: 'raw',
  gradeKey: 'raw:NM',
  finish: 'normal',
  cardProductId: null,
});
const VK = variantKey({ cardId: 'card-1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' });

// =============================================================================================
describe('⚠️ (1) El puerto no responde ⇒ `position: null` + `positionUnavailable: true`, JAMÁS 0', () => {
  it.each([
    ['el provider NO está cableado (defecto de arranque)', 'missing' as const],
    ['el provider REVIENTA al contar', 'throw' as const],
  ])('%s ⇒ null + positionUnavailable, y NUNCA un cero', async (_titulo, port) => {
    const { svc } = build({ port, lines: [{ id: 'it-1' }], refs: { normal: 200000 } });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const line = res.lines[0];

    // ⚠️ ASEVERACIÓN LITERAL, no `toBeFalsy()`: `toBeFalsy()` pasa con `0`, que es EXACTAMENTE el
    // bug que esta rama existe para impedir. Si alguien cambia el `null` por un `0`, ESTO falla.
    expect(line.position).toBeNull();
    expect(line.position).not.toBe(0);
    expect(line.positionUnavailable).toBe(true);
    // Y no se cuela un cero por ninguna otra puerta: ni un desglose de ceros, ni un total.
    expect(JSON.stringify(line.position)).toBe('null');
  });

  it('sin conteo NO se infiere sugerencia: `verdict: "none"` y `rule: null`', async () => {
    const { svc } = build({ port: 'throw', lines: [{ id: 'it-1' }], refs: { normal: 200000 } });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].suggestion).toEqual({
      verdict: 'none',
      rule: null,
      thresholdQty: null,
      bountyActive: false,
    });
  });

  it('un `0` REAL (variante sin piezas) SÍ se emite como 0, con la tira completa', async () => {
    // El contraste que prueba que el diseño funciona (DESIGN_SYSTEM §23.7c): «cero real» es un
    // número dentro de la retícula; «sin conteo» es la ausencia de la retícula entera.
    const { svc } = build({ port: 'ok', lines: [{ id: 'it-1' }], refs: { normal: 200000 }, onHand: {} });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].position).toEqual({
      stock: 0,
      verifying: 0,
      inTransit: 0,
      committed: 0,
      total: 0,
    });
    expect(res.lines[0].positionUnavailable).toBeUndefined();
  });

  it('los totales SIGUEN siendo válidos con `positionUnavailable` (dependen de montos, no del conteo)', async () => {
    const { svc } = build({ port: 'throw', lines: [{ id: 'it-1' }], refs: { normal: 200000 } });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.totals.shippingFeeCents).toBe(18000);
    expect(res.totals.minimumOfferNetCents).toBe(20000);
    expect(res.totals.requiredGrossCents).toBe(38000);
    expect(res.totals.buyableGrossCents).toBeGreaterThan(0);
  });
});

// =============================================================================================
describe('(2) La posición son CUATRO sumandos, y «en camino» es UNO SOLO de ellos', () => {
  it('emite los cuatro por separado + el total, sin colapsarlos', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      onHand: { [K]: 5 },
      otherLines: [
        { status: 'recibida' },
        { status: 'verificacion' },
        { status: 'en_transito' },
        { status: 'ofertada' },
        { status: 'aceptada' },
      ],
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].position).toEqual({
      stock: 5,
      verifying: 2, // recibida + verificacion
      inTransit: 1, // SOLO en_transito
      committed: 2, // ofertada + aceptada
      total: 10,
    });
  });

  it('⚠️ una solicitud `aceptada` NO suma a `inTransit`: es una promesa, no un paquete', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      onHand: { [K]: 0 },
      otherLines: [{ status: 'aceptada' }, { status: 'aceptada' }, { status: 'aceptada' }],
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    // Criterio 116: «en camino» = SOLO lo que el operador confirmó como enviado (D20).
    expect(res.lines[0].position?.inTransit).toBe(0);
    expect(res.lines[0].position?.committed).toBe(3);
    // Pero SÍ cuenta como posición: la oferta es vinculante (D2), somos responsables de esas copias.
    expect(res.lines[0].position?.total).toBe(3);
  });

  it('NO existe un segundo campo «en camino»: uno ES el otro desglosado', async () => {
    const { svc } = build({ port: 'ok', lines: [{ id: 'it-1' }], refs: { normal: 200000 } });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const claves = Object.keys(res.lines[0]);
    expect(claves.filter((k) => /transit|camino|incoming/i.test(k))).toEqual([]);
    expect(Object.keys(res.lines[0].position as object).sort()).toEqual([
      'committed',
      'inTransit',
      'stock',
      'total',
      'verifying',
    ]);
  });

  it('el conteo respeta la IDENTIDAD del producto (D7): una promo no suma a la carta de set', async () => {
    const promoKey = variantPositionKey({
      cardId: 'card-1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      cardProductId: 777,
    });
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }], // línea de SET_BASE
      refs: { normal: 200000 },
      onHand: { [K]: 1, [promoKey]: 8 },
      otherLines: [{ status: 'en_transito', cardProductId: 777 }],
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    // Las 8 de la promo y la que viaja de la promo NO se mezclan con la del set base.
    expect(res.lines[0].position).toEqual({
      stock: 1,
      verifying: 0,
      inTransit: 0,
      committed: 0,
      total: 1,
    });
  });

  it('el acabado separa la posición: `holofoil` no cuenta para `normal`', async () => {
    const holoKey = variantPositionKey({
      cardId: 'card-1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      cardProductId: null,
    });
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1', finish: 'normal' }],
      refs: { normal: 200000, holofoil: 200000 },
      onHand: { [K]: 2, [holoKey]: 9 },
      otherLines: [{ status: 'en_transito', finish: 'holofoil' }],
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].position?.stock).toBe(2);
    expect(res.lines[0].position?.inTransit).toBe(0);
  });
});

// =============================================================================================
describe('(3) La sugerencia NUNCA bloquea, y dice qué regla la disparó', () => {
  it('`do_not_buy` NO impide nada: la línea sigue con precio, ofertable, sin bandera de bloqueo', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      onHand: { [K]: 10 }, // == tope general
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].suggestion?.verdict).toBe('do_not_buy');
    // El precio sigue ahí y la línea sigue contando en el bruto previsualizado: la sugerencia
    // informa, no gatea. El backend NO valida la oferta contra ella (D6, criterio 117).
    expect(res.lines[0].derivedPriceCents).toBeGreaterThan(0);
    expect(res.totals.buyableGrossCents).toBe(res.lines[0].derivedPriceCents);
    // Y no aparece ninguna bandera que un front pudiera leer como «no se puede».
    const json = JSON.stringify(res.lines[0]);
    expect(json).not.toMatch(/blocked|locked|disabled|forbidden/i);
  });

  it('nombra la regla y su cifra: `variant_cap` con `thresholdQty` (criterio 144)', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      onHand: { [K]: 3 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].suggestion).toEqual({
      verdict: 'buy',
      rule: 'variant_cap',
      thresholdQty: 10,
      bountyActive: false,
    });
  });

  it('el borde del tope es INCLUSIVO: `total === thresholdQty` ⇒ `do_not_buy`', async () => {
    for (const [n, esperado] of [
      [9, 'buy'],
      [10, 'do_not_buy'],
      [11, 'do_not_buy'],
    ] as const) {
      const { svc } = build({
        port: 'ok',
        lines: [{ id: 'it-1' }],
        refs: { normal: 200000 },
        onHand: { [K]: n },
      });
      const res = await svc.adminDecisionTable('sr-1', OPERATOR);
      expect(res.lines[0].suggestion?.verdict).toBe(esperado);
    }
  });

  it('con bounty VIVO y meta, manda el BOUNTY: `rule: "bounty_target"` (el tope general no aplica)', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      // Bounty MUY por encima de la curva ⇒ efectivo (§4.36.6).
      overrides: {
        [VK]: {
          bountyEnabled: true,
          bountyPriceCents: 500000,
          bountyTargetQty: 2,
          bountyCompletedAt: null,
        },
      },
      onHand: { [K]: 2 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].suggestion).toEqual({
      verdict: 'do_not_buy',
      rule: 'bounty_target',
      thresholdQty: 2,
      bountyActive: true,
    });
    // «3/2 dice ya te pasaste»: el tope general (10) NO aplica mientras el bounty esté bien formado.
    expect(res.lines[0].suggestion?.thresholdQty).not.toBe(10);
  });
});

// =============================================================================================
describe('⚠️ (4) Bounty LEGACY con `targetQty = null` ⇒ cae al TOPE GENERAL', () => {
  const legacy = {
    bountyEnabled: true,
    bountyPriceCents: 500000,
    bountyTargetQty: null,
    bountyCompletedAt: null,
  };

  it('`rule: "variant_cap"` CON `bountyActive: true` — no es «sin límite»', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      overrides: { [VK]: legacy },
      onHand: { [K]: 10 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    // La respuesta DECLARA el caso legacy: `variant_cap` + `bountyActive:true` (criterio 144).
    expect(res.lines[0].suggestion).toEqual({
      verdict: 'do_not_buy',
      rule: 'variant_cap',
      thresholdQty: 10,
      bountyActive: true,
    });
  });

  it('y por tanto SÍ FRENA: un bounty sin meta ya no es «nunca pinta no comprar»', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      overrides: { [VK]: legacy },
      onHand: { [K]: 12 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].suggestion?.verdict).toBe('do_not_buy');
  });

  it('un bounty NO efectivo contra la curva no es un bounty vivo ⇒ `bountyActive: false`', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      // 1 centavo: por debajo de la tarifa de la curva ⇒ dejó de ser bounty (§4.36.6).
      overrides: {
        [VK]: { bountyEnabled: true, bountyPriceCents: 1, bountyTargetQty: 2, bountyCompletedAt: null },
      },
      onHand: { [K]: 3 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].suggestion?.bountyActive).toBe(false);
    expect(res.lines[0].suggestion?.rule).toBe('variant_cap');
  });

  it('un bounty COMPLETADO tampoco gobierna', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      overrides: {
        [VK]: {
          bountyEnabled: true,
          bountyPriceCents: 500000,
          bountyTargetQty: 2,
          bountyCompletedAt: new Date('2026-08-01'),
        },
      },
      onHand: { [K]: 3 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].suggestion?.rule).toBe('variant_cap');
    expect(res.lines[0].suggestion?.bountyActive).toBe(false);
  });
});

// =============================================================================================
describe('⚠️ (5) NO hay N+1: las lecturas no crecen con el número de líneas', () => {
  const lineasDe = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `it-${i}`, cardId: `card-${i}` }));

  it('1 línea y 40 líneas hacen EXACTAMENTE el mismo número de lecturas', async () => {
    const una = build({ port: 'ok', lines: lineasDe(1), refs: { normal: 200000 } });
    await una.svc.adminDecisionTable('sr-1', OPERATOR);
    const cuarenta = build({ port: 'ok', lines: lineasDe(40), refs: { normal: 200000 } });
    await cuarenta.svc.adminDecisionTable('sr-1', OPERATOR);

    expect(cuarenta.prismaCalls.length).toBe(una.prismaCalls.length);
    // Y el conteo es el mismo POR TIPO de lectura, no solo en total (un intercambio de una lectura
    // por otra pasaría el total y sería igual de malo).
    const censo = (calls: string[]) =>
      calls.reduce<Record<string, number>>((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {});
    expect(censo(cuarenta.prismaCalls)).toEqual(censo(una.prismaCalls));
  });

  it('el puerto se llama UNA vez con las N variantes, no N veces con una', async () => {
    const { svc, port } = build({ port: 'ok', lines: lineasDe(25), refs: { normal: 200000 } });
    await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(port.onHandCountsFor).toHaveBeenCalledTimes(1);
    expect((port.onHandCountsFor as jest.Mock).mock.calls[0][0]).toHaveLength(25);
  });

  it('los tres sumandos de `SellRequestItem` salen de UNA query, no de tres ni de N', async () => {
    const { svc, prismaCalls } = build({
      port: 'ok',
      lines: lineasDe(12),
      refs: { normal: 200000 },
    });
    await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(prismaCalls.filter((c) => c === 'sellRequestItem.findMany')).toHaveLength(1);
    expect(prismaCalls.filter((c) => c === 'sellRequest.findUnique')).toHaveLength(1);
    expect(prismaCalls.filter((c) => c === 'pricing.getReferencesBatch')).toHaveLength(1);
    expect(prismaCalls.filter((c) => c === 'pricing.getVariantOverridesBatch')).toHaveLength(1);
  });
});

// =============================================================================================
describe('El resto del contrato de la mesa (§M5)', () => {
  it('el precio DERIVADO sale de la curva vigente y NO se hereda de la cotización', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1', quotedPriceCents: 111 }],
      refs: { normal: 200000 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    // (a) lo que se le cotizó — el snapshot, intacto.
    expect(res.lines[0].quotedPriceCents).toBe(111);
    // El derivado se recalculó AHORA: dos cifras distintas, ambas a la vista (§P.2).
    expect(res.lines[0].derivedPriceCents).not.toBe(111);
    expect(res.lines[0].derivedPriceCents).toBeGreaterThan(0);
    expect(res.lines[0].priceBasis).toBe('market');
  });

  it('línea SIN dato de mercado ⇒ `derivedPriceCents: null` + `pendingReason`, JAMÁS MX$0', async () => {
    const { svc } = build({ port: 'ok', lines: [{ id: 'it-1' }], refs: {} });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].derivedPriceCents).toBeNull();
    expect(res.lines[0].derivedPriceCents).not.toBe(0);
    expect(res.lines[0].pendingReason).toBe('no_market');
    expect(res.lines[0].priceBasis).toBe('pending');
    // Y no entra al bruto previsualizado: no se puede ofertar una cifra que no existe.
    expect(res.totals.buyableGrossCents).toBe(0);
  });

  it('`totals` = previsualización de la selección por defecto (toda línea CON precio)', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }, { id: 'it-2', cardId: 'card-2' }],
      refs: { normal: 200000 },
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const suma = res.lines.reduce((a, l) => a + (l.derivedPriceCents ?? 0), 0);
    expect(res.totals.buyableGrossCents).toBe(suma);
    expect(res.totals.netCents).toBe(Math.max(0, suma - 18000));
    expect(res.totals.netBelowMinimum).toBe(res.totals.netCents < 20000);
  });

  it('`netCents` nunca es negativo, y `netBelowMinimum` es AVISO (la mesa no bloquea)', async () => {
    // Bruto por debajo de la tarifa ⇒ neto 0 (no negativo) y aviso encendido.
    const { svc } = build({ port: 'ok', lines: [{ id: 'it-1' }], refs: { normal: 10000 } });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.totals.netCents).toBeGreaterThanOrEqual(0);
    expect(res.totals.netBelowMinimum).toBe(true);
    // Aviso: la respuesta es 200 con datos, no un error.
    expect(res.lines).toHaveLength(1);
  });

  it('`requiresAuthorization` depende del ACTOR: el súper-admin oferta sin tope', async () => {
    const alto = { port: 'ok' as const, lines: [{ id: 'it-1' }], refs: { normal: 900000 } };
    const op = build(alto);
    const sa = build(alto);
    const rOp = await op.svc.adminDecisionTable('sr-1', OPERATOR);
    const rSa = await sa.svc.adminDecisionTable('sr-1', SUPER);
    expect(rOp.totals.buyableGrossCents).toBeGreaterThan(150000);
    expect(rOp.requiresAuthorization).toBe(true);
    expect(rSa.requiresAuthorization).toBe(false);
    expect(rOp.operatorCapCents).toBe(150000);
  });

  it('`pickupAddressMissing` es DERIVADO y es un BOOLEANO — la dirección NO viaja', async () => {
    const { svc } = build({
      port: 'ok',
      lines: [{ id: 'it-1' }],
      refs: { normal: 200000 },
      pickupAddressSnapshot: null,
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.pickupAddressMissing).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/line1|Calle/);
  });

  it('NO filtra PII bancaria ni cifras que no sean de la mesa', async () => {
    const { svc } = build({ port: 'ok', lines: [{ id: 'it-1' }], refs: { normal: 200000 } });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/clabe/i);
    expect(json).not.toMatch(/offerReissue/);
  });

  it('404 cuando la solicitud no existe', async () => {
    const { svc } = build({ port: 'ok', lines: [] });
    (svc as unknown as { prisma: any }).prisma.sellRequest.findUnique = jest.fn(async () => null);
    await expect(svc.adminDecisionTable('nope', OPERATOR)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// =============================================================================================
describe('Líneas de PRODUCTO SEPARADO (D7 / §4.29b) — el lote no cambia una sola decisión', () => {
  /**
   * `decideBuyLine` es el **seam único** de la decisión de compra; el lote solo le adelanta los dos
   * lookups que haría por línea. Estos tests fijan que ese adelanto **no cambia el número** y que
   * las guardas de identidad (`PRODUCT_NOT_FOUND` / `PRODUCT_CARD_MISMATCH`) siguen aplicándose sobre
   * la fila que trajo el lote: un `productId` de otra carta **no se reinterpreta** como la carta de
   * set — eso sería fusión silenciosa de identidades, que es dinero mal.
   */
  function buildWithProducts(opts: {
    productId: number;
    productCardId?: string;
    productRefCents?: number | null;
    baseRefCents?: number;
  }) {
    const prisma: any = {
      sellRequest: {
        findUnique: jest.fn(async () => ({
          id: 'sr-1',
          userId: 'u-1',
          user: { id: 'u-1', name: 'Ash', email: 'a@b.mx' },
          status: 'cotizada',
          quotedTotalCents: 1000,
          pickupAddressSnapshot: {},
          items: [
            {
              id: 'it-1',
              cardId: 'card-1',
              card: {
                id: 'card-1',
                name: 'Pikachu',
                number: '25',
                rarity: 'Common',
                rarityCanonical: 'common',
                subtypes: null,
                availableFinishes: ['normal'],
                set: { id: 's', name: 'Base' },
              },
              productType: 'raw',
              rawCondition: 'NM',
              finish: 'normal',
              cardProductId: opts.productId,
              quotedPriceCents: 1,
            },
          ],
        })),
      },
      sellRequestItem: { findMany: jest.fn(async () => []) },
    };
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getReferencesBatch: jest.fn(async () => {
        const m = new Map();
        if (opts.baseRefCents != null) {
          m.set(
            variantKey({ cardId: 'card-1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }),
            { status: 'priced', referenceMxnCents: opts.baseRefCents },
          );
        }
        return m;
      }),
      findCardProductsByTcgIds: jest.fn(
        async () =>
          new Map([
            [
              opts.productId,
              {
                id: 'cp-uuid',
                cardId: opts.productCardId ?? 'card-1',
                tcgplayerProductId: opts.productId,
                finishes: ['normal'],
              },
            ],
          ]),
      ),
      getReferencesByCardProductBatch: jest.fn(async () => {
        const m = new Map();
        if (opts.productRefCents != null) {
          m.set('cp-uuid|raw|raw:NM|normal', {
            status: 'priced',
            referenceMxnCents: opts.productRefCents,
          });
        }
        return m;
      }),
    };
    const settings = { getNumber: jest.fn(async (k: any) => DIALS[k as string] ?? 0) };
    const port: InventoryPositionPort = { onHandCountsFor: jest.fn(async () => new Map()) };
    return new BuylistService(
      prisma as unknown as PrismaService,
      pricing as unknown as PricingService,
      settings as unknown as SettingsService,
      {} as UsersService,
      pii,
      undefined,
      port,
    );
  }

  it('el precio sale de la referencia DEL PRODUCTO, no de la del set base', async () => {
    const svc = buildWithProducts({ productId: 777, productRefCents: 300000, baseRefCents: 1000 });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].cardProductId).toBe(777);
    expect(res.lines[0].derivedPriceCents).toBeGreaterThan(0);
    // Con el mercado del producto ($3,000) el derivado NO puede parecerse al del set base ($10).
    expect(res.lines[0].derivedPriceCents).toBeGreaterThan(10000);
  });

  it('sin referencia del producto ⇒ `pendingReason: "no_market"`, NUNCA el precio del set base', async () => {
    const svc = buildWithProducts({ productId: 777, productRefCents: null, baseRefCents: 300000 });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].derivedPriceCents).toBeNull();
    expect(res.lines[0].pendingReason).toBe('no_market');
  });

  it('⚠️ un `productId` que cuelga de OTRA carta NO se reinterpreta: línea SIN precio y SIN motivo inventado', async () => {
    const svc = buildWithProducts({
      productId: 777,
      productCardId: 'card-OTRA',
      productRefCents: 300000,
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines[0].derivedPriceCents).toBeNull();
    // Ni `no_market` ni `premium_at_floor`: los dos afirman algo sobre el MERCADO, y aquí el mercado
    // ni se consultó. Decir «falta» es honesto; elegirle un motivo, no.
    expect(res.lines[0].pendingReason).toBeNull();
    expect(res.lines[0].priceBasis).toBe('pending');
    // Y la mesa NO revienta: el contrato solo declara 403/404 para este endpoint.
    expect(res.lines).toHaveLength(1);
  });
});
