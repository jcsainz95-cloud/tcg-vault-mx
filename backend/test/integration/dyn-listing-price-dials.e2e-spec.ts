/**
 * dyn-listing-price-dials.e2e-spec.ts — 💰 DYN-B17 (API_CONTRACT §DYN.5.4, errata v1.113.3): **candado de
 * `PRICE_AFFECTING_SETTING_KEYS` en los DOS sentidos**, contra Postgres REAL y el cuerpo único del precio de venta tal cual
 * corre en la app.
 *
 * Método: un fixture que ejercita TODAS las ramas del cuerpo (raw por mercado con DOS fuentes frescas del árbitro que
 * DISCREPAN, en USD con FX en modo `manual`; raw premium en el piso; graduada; sellado con spread por presentación y con
 * spread global). Para CADA clave de `SettingKey` se escribe un valor alternativo VÁLIDO (su propio validador lo acepta), se
 * recalcula el cuerpo —`P`, `L`, base, mercado y el «valor de mercado» exhibido de la fila (§DYN.5.5)— sobre el fixture y
 * se compara con la línea base.
 *   (a) completitud: si la salida cambia, la clave mueve el precio ⇒ TIENE que estar en la lista.
 *   (b) testigo: toda clave de la lista tiene que moverla aquí; una que no la mueve es una clave inerte (cuesta una corrida
 *       por nada) o un hueco del fixture — salvo las de `SIN_TESTIGO`, lista CERRADA con el porqué medido.
 * Una clave sin valor alternativo válido no se puede medir: va en `SIN_PERTURBACION`, también CERRADA.
 *
 * Mutaciones que la ponen roja: quitar de la lista una clave que mueve (a); añadir una clave inerte (b). Determinista (N=1).
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { SaleDecisionService, SaleItem, isPricePending } from '../../src/modules/pricing/sale-decision.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import {
  PRICE_AFFECTING_SETTING_KEYS,
  SETTING_DEFAULTS,
  SETTING_VALIDATORS,
  SettingKey,
  SettingKeyType,
} from '../../src/modules/settings/settings.constants';
import { SEALED_SALE_PRICE_INCLUDE } from '../../src/common/money';
import { DEFAULT_GRADING_COST_TIERS } from '../../src/common/graded-estimate';
import { SPEND_ALERT_CODES } from '../../src/modules/settings/shipping-dials';

/** Claves cuyo validador no acepta ningún candidato genérico NI específico (se miden en otra parte o no aplican). */
const SIN_PERTURBACION: Partial<Record<SettingKeyType, string>> = {};

/**
 * (b) Claves de la lista SIN testigo posible, con el porqué MEDIDO. Lista CERRADA: una clave nueva que no mueva nada pone
 * esto rojo.
 *
 * `price_consensus_tolerance_pct`: al valuar, el árbitro (`pricing.service.ts` `robustMarketForRows`) devuelve solo la
 * mediana, su fuente y su fecha; la tolerancia decide el booleano `consensus` (`common/robust-market.ts`, `resolveRobustMarket`)
 * que solo lee el candado del barrido (`decideLock`), automático y fuera del cuerpo de §DYN.5.1. No hay fixture que la haga
 * mover `P` ni la referencia. El contrato (§DYN.5.4, v1.113.3) dice que «se queda» y a la vez pide testigo por clave:
 * contradicción elevada al arquitecto (BACKEND_NOTES §DYN). Se deja en la lista (una clave de más cuesta una corrida).
 */
const SIN_TESTIGO: Partial<Record<SettingKeyType, string>> = {
  [SettingKey.PRICE_CONSENSUS_TOLERANCE_PCT]: 'solo decide `consensus`, que el cuerpo de §DYN.5.1 no lee',
};

const STRINGS = [
  'on', 'off', 'tcgcsv', 'tcgcsv_singles', 'pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual', 'auto', 'legacy',
  'enabled', 'disabled', 'standard', 'thermal', 'cost', 'sale', 'with_iva', 'without_iva', 'median', 'mean', 'p25', 'low',
  'dryrun', '2025/06/01', '49101601', 'average', 'smart', 'skydropx', 'super_admin_only', 'operators',
];

/** Candidatos específicos de las claves con valor compuesto. */
function specific(key: SettingKeyType, v: unknown): unknown[] {
  switch (key) {
    case SettingKey.PRICING_CURVE: {
      const c = JSON.parse(JSON.stringify(v)) as { sale: { floorCents: number; points: { multiplierBp: number }[] } };
      const a = JSON.parse(JSON.stringify(c));
      a.sale.points = a.sale.points.map((p: { multiplierBp: number }) => ({ ...p, multiplierBp: p.multiplierBp + 3000 }));
      const b = JSON.parse(JSON.stringify(c));
      b.sale.floorCents = c.sale.floorCents * 3;
      return [a, b];
    }
    case SettingKey.PREMIUM_FLOOR_SALE_PUBLISH:
      return [{ mode: 'all', rarities: [] }, { mode: 'none', rarities: [] }];
    case SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE:
      return [{ ...(v as object), box: 60, etb: 60 }, {}];
    case SettingKey.PRICE_ARBITER_SOURCES:
      return [['tcgcsv_singles'], ['tcgdex'], ['tcgcsv_singles', 'cardmarket']];
    case SettingKey.SPEND_ALERTS_DISABLED:
      return [[SPEND_ALERT_CODES[0]]];
    case SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES:
      return [['9'], ['10', '9']];
    case SettingKey.GRADING_COST_TIERS:
      return [DEFAULT_GRADING_COST_TIERS.map((t) => ({ ...t, costMxnCents: t.costMxnCents * 2 }))];
    default:
      return [];
  }
}

function candidates(key: SettingKeyType, current: unknown): unknown[] {
  const out: unknown[] = [...specific(key, current)];
  if (typeof current === 'number') {
    out.push(current + 1, current * 2, current - 1, Math.round(current / 2), 0, 1, 2, 5, 10, 25, 50, 99, 100, 1000, 0.5, 0.05);
  } else if (current === null) {
    out.push(25, 20.5, 1, 'manual', [], {});
  } else if (typeof current === 'string') {
    out.push(...STRINGS);
  } else if (Array.isArray(current)) {
    out.push([], current.slice(0, 1), current.slice(1), [...current].reverse());
  } else if (typeof current === 'object') {
    out.push({});
  }
  const same = JSON.stringify(current);
  return out.filter((c) => JSON.stringify(c) !== same && SETTING_VALIDATORS[key](c) === null);
}

describe('E2E — DYN-B17: completitud de PRICE_AFFECTING_SETTING_KEYS (§DYN.5.4)', () => {
  let h: E2EHarness;
  let decider: SaleDecisionService;
  let settings: SettingsService;
  const run = randomUUID().slice(0, 8);
  const pid = 700_000_000 + Math.floor(Math.random() * 90_000_000);
  let setId: string;
  const cardIds: string[] = [];
  const itemIds: string[] = [];
  /** Diales que el fixture fija para su línea base (y restaura al terminar). */
  const FIXTURE_DIALS: [SettingKeyType, Prisma.InputJsonValue][] = [
    // Con la fuente del sellado APAGADA los spreads no se ejercitan.
    [SettingKey.SEALED_PRICE_SOURCE, 'tcgcsv'],
    // FX en modo `manual` con una tasa que no es ni la de Banxico ni el fallback: el modo y la tasa manual eligen la tasa
    // con que se convierte el mercado en USD (`fx.service.ts` `getCurrent`), así que los dos tienen testigo.
    [SettingKey.FX_RATE_MODE, 'manual'],
    [SettingKey.FX_MANUAL_OVERRIDE_RATE, 21.37],
  ];
  const before = new Map<string, Prisma.JsonValue | undefined>();

  async function card(n: number, rarity: string) {
    const c = await h.prisma.card.create({
      data: {
        externalId: `lpd-${run}-${n}`,
        setId,
        name: `Carta Diales ${run} ${n}`,
        number: String(n),
        rarity,
        rarityCanonical: rarity,
        imageSmallUrl: `https://images.pokemontcg.io/lpd/${n}.png`,
        availableFinishes: ['normal'],
      },
    });
    cardIds.push(c.id);
    return c.id;
  }
  async function item(cardId: string, data: Partial<Prisma.InventoryItemUncheckedCreateInput>) {
    const it = await h.prisma.inventoryItem.create({
      data: {
        folio: `LPD-${run}-${itemIds.length + 1}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        ...data,
      },
    });
    itemIds.push(it.id);
  }
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const daysAgo = (n: number) => new Date(today().getTime() - n * 86_400_000);

  /** La salida del cuerpo único sobre TODO el fixture, con los diales que haya ahora en la BD. */
  async function snapshot(): Promise<string> {
    const dials = await settings.getIvaDials();
    const items = (await h.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE },
      orderBy: { folio: 'asc' },
    })) as SaleItem[];
    const out: unknown[] = [];
    // v1.113.3 (§DYN.5.5): el «valor de mercado» que la fila guardaría con `P`, del MISMO lote (también es salida del cálculo).
    const batch = await decider.loadBatch(items);
    const exhibited = (it: SaleItem) => decider.exhibitedReferenceOf(it, batch).referenceMxnCents;
    for (const it of items) {
      try {
        const d = await decider.decide(it, dials);
        out.push([it.folio, d.unitPriceCents, d.listPriceCents, d.priceBasis, d.marketMxnCents, exhibited(it)]);
      } catch (e) {
        if (!isPricePending(e)) throw e;
        out.push([it.folio, 'pending', exhibited(it)]);
      }
    }
    return JSON.stringify(out);
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    decider = h.app.get(SaleDecisionService);
    settings = h.app.get(SettingsService);
    const set = await h.prisma.cardSet.create({ data: { externalId: `lpd-${run}`, name: `Set Diales ${run}` } });
    setId = set.id;
    // (1) raw por MERCADO: DOS fuentes admitidas que votan el árbitro y DISCREPAN, del MISMO día (el lector solo arbitra las
    // filas de la fecha automática más reciente) y frescas con el dial de hoy (3 días ≤ 7), en USD (conversión VIVA). Así
    // las tres claves del árbitro tienen testigo: quitar una fuente o encoger la ventana mueve la mediana.
    const k1 = await card(1, 'Common');
    await item(k1, {});
    await h.prisma.priceReference.createMany({
      data: [
        { cardId: k1, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', priceUsdCents: 3_000, priceMxnCents: 55_000, capturedDate: daysAgo(3), refKind: 'market' },
        { cardId: k1, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgdex', priceUsdCents: 4_700, priceMxnCents: 86_000, capturedDate: daysAgo(3), refKind: 'market' },
      ],
    });
    // (2) raw PREMIUM con mercado bajísimo ⇒ cae al piso ⇒ el guardarraíl de venta decide.
    const k2 = await card(2, 'Special Illustration Rare');
    await item(k2, {});
    await h.prisma.priceReference.create({
      data: { cardId: k2, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'tcgcsv_singles', priceUsdCents: 30, priceMxnCents: 550, capturedDate: today(), refKind: 'market' },
    });
    // (3) graduada PSA 10 con mercado.
    const k3 = await card(3, 'Rare');
    await item(k3, { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '10', certNumber: `LPD-${run}` });
    await h.prisma.priceReference.create({
      data: { cardId: k3, productType: 'graded', gradeKey: 'graded:PSA:10', finish: 'normal', source: 'tcgcsv_singles', priceUsdCents: 21_000, priceMxnCents: 400_000, capturedDate: today(), refKind: 'market' },
    });
    // (4) sellado con spread POR PRESENTACIÓN y (5) sellado con spread GLOBAL (sin presentación), mercado TCGCSV.
    const k4 = await card(4, 'Common');
    for (const [i, subtype] of [[0, 'box'], [1, null]] as const) {
      await item(k4, {
        productType: 'sealed',
        rawCondition: null,
        sealedSubtype: subtype,
        sealedCondition: 'mint',
        tcgplayerProductId: pid + i,
      });
      await h.prisma.priceReference.create({
        data: { cardId: k4, productType: 'sealed', gradeKey: `sealed:tcg:${pid + i}`, finish: 'normal', source: 'tcgcsv', priceMxnCents: 100_000, capturedDate: today(), refKind: 'market' },
      });
    }
    for (const [key, value] of FIXTURE_DIALS) {
      before.set(key, (await h.prisma.configSetting.findUnique({ where: { key } }))?.valueJson);
      await h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: value }, update: { valueJson: value } });
    }
  });

  afterAll(async () => {
    if (h) {
      for (const [key, v] of before) {
        if (v === undefined) await h.prisma.configSetting.deleteMany({ where: { key } });
        else await h.prisma.configSetting.update({ where: { key }, data: { valueJson: v as Prisma.InputJsonValue } });
      }
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  it('el fixture ejercita las ramas: hay precio de mercado, pendiente por guardarraíl y sellado preciado', async () => {
    const s = JSON.parse(await snapshot()) as unknown[][];
    expect(s).toHaveLength(5);
    expect(s[0][3]).toBe('market');
    expect(s[1][1]).toBe('pending');
    expect(s.slice(2).every((r) => typeof r[1] === 'number')).toBe(true);
  });

  it('⭐ (a) toda clave que mueve la salida está en la lista y (b) toda clave de la lista la mueve aquí', async () => {
    const base = await snapshot();
    const mueven: string[] = [];
    const sinCandidato: string[] = [];
    for (const key of Object.values(SettingKey) as SettingKeyType[]) {
      const row = await h.prisma.configSetting.findUnique({ where: { key } });
      const current = row ? row.valueJson : SETTING_DEFAULTS[key];
      const cands = candidates(key, current);
      if (cands.length === 0) {
        sinCandidato.push(key);
        continue;
      }
      try {
        for (const c of cands) {
          await h.prisma.configSetting.upsert({
            where: { key },
            create: { key, valueJson: c as Prisma.InputJsonValue },
            update: { valueJson: c as Prisma.InputJsonValue },
          });
          if ((await snapshot()) !== base) {
            mueven.push(key);
            break;
          }
        }
      } finally {
        if (row) await h.prisma.configSetting.update({ where: { key }, data: { valueJson: row.valueJson as Prisma.InputJsonValue } });
        else await h.prisma.configSetting.deleteMany({ where: { key } });
      }
    }
    expect(await snapshot()).toBe(base); // la restauración es exacta
    // eslint-disable-next-line no-console
    console.log(`[DYN-B17] claves que mueven el precio sobre el fixture: ${mueven.sort().join(', ')}`);
    const faltan = mueven.filter((k) => !(PRICE_AFFECTING_SETTING_KEYS as readonly string[]).includes(k));
    expect(faltan).toEqual([]);
    // (b) testigo: toda clave de la lista mueve el precio o la referencia sobre el fixture, salvo la lista cerrada.
    const sinTestigo = PRICE_AFFECTING_SETTING_KEYS.filter((k) => !mueven.includes(k));
    expect(sinTestigo.sort()).toEqual(Object.keys(SIN_TESTIGO).sort());
    expect(sinCandidato.sort()).toEqual(Object.keys(SIN_PERTURBACION).sort());
    // Control: el método VE las claves que mueven (si no, el candado sería verde por ceguera).
    expect(mueven).toEqual(expect.arrayContaining([SettingKey.IVA_PCT, SettingKey.IVA_TRANSFER_PCT, SettingKey.PRICING_CURVE]));
    // …y las claves que el fixture de v1.113.3 vino a cubrir (árbitro con dos fuentes que discrepan; FX en `manual`).
    expect(mueven).toEqual(
      expect.arrayContaining([
        SettingKey.PRICE_ARBITER_FRESHNESS_DAYS,
        SettingKey.PRICE_ARBITER_SOURCES,
        SettingKey.FX_MANUAL_OVERRIDE_RATE,
        SettingKey.FX_RATE_MODE,
      ]),
    );
  }, 900_000);

  it('la lista es de claves REALES, sin repetir, e incluye `iva_transfer_pct` (que se escribe fuera de `PUT /admin/settings`)', () => {
    const all = Object.values(SettingKey) as string[];
    expect(PRICE_AFFECTING_SETTING_KEYS.filter((k) => !all.includes(k))).toEqual([]);
    expect(new Set(PRICE_AFFECTING_SETTING_KEYS).size).toBe(PRICE_AFFECTING_SETTING_KEYS.length);
    expect(PRICE_AFFECTING_SETTING_KEYS).toContain(SettingKey.IVA_TRANSFER_PCT);
  });
});
