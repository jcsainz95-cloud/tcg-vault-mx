/**
 * dyn.listing-price.spec.ts — 💰 v1.113⟨portada⟩ + errata v1.113.1 (API_CONTRACT §DYN.5, ARCHITECTURE §4.DYN (e)): el precio
 * del día, en unitarias (la integración contra Postgres vive en `test/integration/dyn-listing-price*.e2e-spec.ts`).
 *
 *   DYN-B16 (checkout) — fila `priced` ⇒ se cobra SU `P` y su instrumentación tal cual, aunque el vivo dé otro (⛔ ni vivo,
 *                        ni `min`/`max`); `pending` ⇒ `PRICE_PENDING`; sin fila ⇒ vivo + `missing_row`.
 *   DYN-B16 (lectores) — el `ListingDTO` exhibe el `P` de la fila Y su «valor de mercado» (v1.113.3, §DYN.5.5), sin leer
 *                        ninguna referencia en vivo; `pending` no se vende.
 *   DYN-B22 (unidad) — `enqueueVariant` encola SOLO las piezas que leen la variante escrita; la corrida guarda la referencia
 *                        del MISMO lote (con el gate del sellado) y cuenta las piezas que salta `SKIP LOCKED`.
 *   DYN-B19 — `salesFor`: sin fila ⇒ cuerpo único en vivo + `missing_row`; con fila ⇒ ni curva ni referencia.
 *   DYN.5.3/.4 — un `PUT` con clave de `PRICE_AFFECTING_SETTING_KEYS` ⇒ `dial_change`; otra clave ⇒ nada; el aviso llega
 *                DESPUÉS del commit y solo si hubo escritura (también desde `PUT /admin/settings/iva-transfer`).
 *   Puertas — todo fichero de `src/` que escribe `ConfigSetting` avisa (`notifyKeysWritten`) o está en la lista cerrada de
 *             puertas que solo escriben claves que NO mueven el precio.
 *   DYN.5.8 — salud `never` / `ok` / `stale`; el tablero da `stale` si la lectura falla (v1.113.2).
 *   DYN.6.1 — `Cache-Control` en `cards`, `facets`, `sealed` y `featured` y ninguna de ellas lee sesión.
 * Deterministas (N=1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ListingPrice } from '@prisma/client';
import { OrdersService } from '../src/modules/orders/orders.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { CatalogController, CATALOG_LIST_CACHE_CONTROL } from '../src/modules/catalog/catalog.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { ListingPriceService, decisionOfRow, portadaServedDay, referenceOfRow } from '../src/modules/pricing/listing-price.service';
import { SaleDecisionService } from '../src/modules/pricing/sale-decision.service';
import { PRICE_AFFECTING_SETTING_KEYS, SettingKey } from '../src/modules/settings/settings.constants';
import { marketBracketOf, DEFAULT_PRICING_CURVE, DEFAULT_SALE_PREMIUM_FLOOR_POLICY } from '../src/common/pricing-curve';
import { stripComments } from './helpers/strip-comments';
import { DIAL_AUTOFETCH, DIAL_AUTOPUBLISH } from '../src/modules/decks-meta/limitless.config';
import { ivaDialsStub, IVA_DIALS_NEUTRAL } from './helpers/iva-dials';

const SRC = join(__dirname, '..', 'src');

const CARD = { id: 'c1', name: 'Pikachu', rarity: 'Common', rarityCanonical: 'Common', setId: 's1', set: null } as never;
function rawItem(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    folio: 'INV-1',
    cardId: 'c1',
    card: CARD,
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    ownerType: 'platform',
    status: 'listed',
    listPriceCents: null,
    gradingCompany: null,
    gradeValue: null,
    sealedProduct: null,
    tcgplayerProductId: null,
    ...over,
  } as never;
}

/** El vivo de este doble: mercado 10 000 ⇒ curva ⇒ `L` = 11 500 ⇒ `P` = 13 340 (neutro). */
function pricingDouble() {
  return {
    loadSalePremiumFloorPolicy: jest.fn(async () => DEFAULT_SALE_PREMIUM_FLOOR_POLICY),
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    // v1.114 (§DYN.5.9): sin caso de revisión vigente ⇒ la entrada del cuerpo de venta no cambia.
    saleRetentionFor: jest.fn(async () => new Map()),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    tryGradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10_000 })),
    getVariantOverride: jest.fn(async () => null),
    getReferencesBatch: jest.fn(
      async () => new Map([['c1|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 10_000, source: 'tcgcsv_singles', capturedDate: '2026-10-28' }]]),
    ),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false })),
    sealedMarketGradeKeyForItem: jest.fn(() => null),
    gateSealedMarketCents: jest.fn(() => null),
  } as unknown as PricingService & Record<string, jest.Mock>;
}

/** Una fila `priced` cuyo `P` NO es el del vivo (13 340): 21 000 / L 18 103. */
function pricedRow(over: Partial<ListingPrice> = {}): ListingPrice {
  return {
    inventoryItemId: 'i1',
    variantKey: 'c1|raw|raw:NM|normal',
    runId: 'r1',
    status: 'priced',
    unitPriceCents: 21_000,
    listPriceCents: 18_103,
    fixedDisplayCents: null,
    priceBasis: 'market',
    marketMxnCents: 16_000,
    ivaRatePct: 16,
    ivaTransferPct: 100,
    // v1.113.3: el «valor de mercado» que la fila congeló — distinto del vivo del doble (10 000 del 2026-10-28).
    referenceMxnCents: 16_500,
    referenceCapturedDate: new Date('2026-10-20T00:00:00.000Z'),
    computedAt: new Date(),
    ...over,
  };
}

function lpDouble(rows: ListingPrice[]) {
  return {
    rowsFor: jest.fn(async (ids: string[]) => new Map(rows.filter((r) => ids.includes(r.inventoryItemId)).map((r) => [r.inventoryItemId, r]))),
    enqueue: jest.fn(async () => undefined),
  };
}

function orders(pricing: PricingService, lp?: ReturnType<typeof lpDouble>) {
  // TL-DYN-1: «fila o vivo» vive en `ListingPriceService.chargeDecisionsFor`. El doble corre ESE método real sobre sus filas,
  // con el cuerpo único sobre el mismo `pricing` que usa el checkout: DYN-B16 sigue midiendo el código de producción.
  if (lp) {
    Object.assign(lp, {
      decider: new SaleDecisionService(pricing),
      chargeDecisionsFor: ListingPriceService.prototype.chargeDecisionsFor,
    });
  }
  return new OrdersService(
    {} as PrismaService,
    pricing,
    ivaDialsStub() as unknown as SettingsService,
    {} as never,
    {} as never,
    undefined,
    undefined,
    lp as unknown as ListingPriceService,
  );
}
const buildLines = (svc: OrdersService, items: unknown[]) =>
  (svc as unknown as { buildLines(i: unknown[], d: unknown): Promise<{ subtotalCents: number; lines: Record<string, unknown>[] }> }).buildLines(
    items,
    IVA_DIALS_NEUTRAL,
  );

describe('DYN-B16 — checkout: se cobra la FILA del día (§DYN.5.7)', () => {
  it('el doble del vivo da OTRO precio (si no, la prueba no distingue fila de vivo)', async () => {
    const live = await new SaleDecisionService(pricingDouble()).decide(rawItem(), IVA_DIALS_NEUTRAL);
    expect(live.unitPriceCents).toBe(13_340);
    expect(live.unitPriceCents).not.toBe(pricedRow().unitPriceCents);
  });

  it('fila `priced` ⇒ su `P` y SU instrumentación, tal cual; ⛔ sin calcular en vivo y sin encolar', async () => {
    const pricing = pricingDouble();
    const lp = lpDouble([pricedRow()]);
    const { subtotalCents, lines } = await buildLines(orders(pricing, lp), [rawItem()]);
    expect(subtotalCents).toBe(21_000);
    expect(lines[0]).toMatchObject({
      unitPriceCents: 21_000,
      marketMxnCents: 16_000,
      priceBasis: 'market',
      marketBracket: marketBracketOf(16_000),
      finish: 'normal',
    });
    expect(pricing.getReference).not.toHaveBeenCalled();
    expect(pricing.computeSalePriceForItem).not.toHaveBeenCalled();
    expect(lp.enqueue).not.toHaveBeenCalled();
  });

  it('la fila MÁS BARATA que el vivo también se cobra tal cual (⛔ `max`), y la más cara también (⛔ `min`)', async () => {
    for (const p of [9_000, 21_000]) {
      const { lines } = await buildLines(orders(pricingDouble(), lpDouble([pricedRow({ unitPriceCents: p })])), [rawItem()]);
      expect(lines[0].unitPriceCents).toBe(p);
    }
  });

  it('fila `pending` ⇒ `PRICE_PENDING` (422) aunque el vivo tenga precio', async () => {
    const lp = lpDouble([pricedRow({ status: 'pending', unitPriceCents: null, listPriceCents: null, priceBasis: null })]);
    await expect(buildLines(orders(pricingDouble(), lp), [rawItem()])).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });

  it('sin fila ⇒ el cuerpo único en vivo y `missing_row` encolado con ESA pieza; con fila al lado, cada una lo suyo', async () => {
    const lp = lpDouble([pricedRow()]);
    const { lines } = await buildLines(orders(pricingDouble(), lp), [rawItem(), rawItem({ id: 'i2', folio: 'INV-2' })]);
    expect(lines.map((l) => [l.inventoryItemId, l.unitPriceCents])).toEqual([
      ['i1', 21_000],
      ['i2', 13_340],
    ]);
    expect(lp.enqueue).toHaveBeenCalledWith('missing_row', ['i2']);
  });

  it('sin precio del día inyectado (unitarias a mano) ⇒ el cuerpo único en vivo, como antes de M-94', async () => {
    const { lines } = await buildLines(orders(pricingDouble()), [rawItem()]);
    expect(lines[0].unitPriceCents).toBe(13_340);
  });

  it('`decisionOfRow`: el tramo se DERIVA del mercado de la fila; una fila `pending` no es decisión', () => {
    expect(decisionOfRow(pricedRow({ marketMxnCents: null }), { finish: 'holo' } as never)).toMatchObject({ marketBracket: null, finish: 'holo' });
    expect(() => decisionOfRow(pricedRow({ status: 'pending', unitPriceCents: null, listPriceCents: null }), { finish: 'normal' } as never)).toThrow();
  });
});

describe('DYN-B16 — lectores: el `ListingDTO` exhibe la fila (§DYN.5.6)', () => {
  const catalog = (lp: unknown) =>
    new CatalogService({} as PrismaService, pricingDouble(), ivaDialsStub() as unknown as SettingsService, lp as ListingPriceService);

  it('fila `priced` ⇒ `displayPriceCents` = su `P`, vendible, y el «valor de mercado» de la FILA (⛔ sin leer referencias)', async () => {
    const row = pricedRow();
    const lp = {
      salesFor: jest.fn(
        async () => new Map([['i1', { kind: 'priced', from: 'row', decision: decisionOfRow(row, { finish: 'normal' } as never), reference: referenceOfRow(row) }]]),
      ),
    };
    const pricing = pricingDouble();
    const dto = await new CatalogService({} as PrismaService, pricing, ivaDialsStub() as unknown as SettingsService, lp as unknown as ListingPriceService).toListingDTO(rawItem());
    expect(dto).toMatchObject({ displayPriceCents: 21_000, sellable: true, priceBasis: 'market' });
    // v1.113.3 (§DYN.5.5): la referencia de la fila, sin `source` (superficie anónima), con su fecha; ⛔ la del vivo (10 000).
    expect(dto.referenceValue).toEqual({ status: 'priced', referenceMxnCents: 16_500, capturedDate: '2026-10-20' });
    expect(pricing.getReference).not.toHaveBeenCalled();
    expect(pricing.getReferencesBatch).not.toHaveBeenCalled();
    expect(pricing.loadSealedSpreads).not.toHaveBeenCalled();
  });

  it('fila con `referenceMxnCents = null` ⇒ `referenceValue` `pending` aunque el vivo SÍ tenga mercado', async () => {
    const row = pricedRow({ referenceMxnCents: null, referenceCapturedDate: null });
    expect(referenceOfRow(row)).toEqual({ status: 'pending' });
    const lp = {
      salesFor: jest.fn(
        async () => new Map([['i1', { kind: 'priced', from: 'row', decision: decisionOfRow(row, { finish: 'normal' } as never), reference: referenceOfRow(row) }]]),
      ),
    };
    const dto = await catalog(lp).toListingDTO(rawItem());
    expect(dto.referenceValue).toEqual({ status: 'pending' });
  });

  it('`pending` ⇒ sin precio y NO vendible', async () => {
    const lp = { salesFor: jest.fn(async () => new Map([['i1', { kind: 'pending', reference: { status: 'pending' } }]])) };
    const dto = await catalog(lp).toListingDTO(rawItem());
    expect(dto.displayPriceCents).toBeUndefined();
    expect(dto.sellable).toBe(false);
  });
});

describe('DYN-B19 — `ListingPriceService.salesFor`', () => {
  function service(rows: ListingPrice[], pricing = pricingDouble()) {
    const prisma = { listingPrice: { findMany: jest.fn(async () => rows) } } as unknown as PrismaService;
    const svc = new ListingPriceService(prisma, new SaleDecisionService(pricing), {} as SettingsService);
    const enqueue = jest.spyOn(svc, 'enqueue').mockResolvedValue(undefined);
    return { svc, enqueue, pricing };
  }

  it('con fila ⇒ ni curva, ni referencia, ni override (la rejilla deja de cargarlos); sin fila ⇒ vivo + `missing_row`', async () => {
    const { svc, enqueue, pricing } = service([pricedRow()]);
    const withRow = await svc.salesFor([rawItem()], IVA_DIALS_NEUTRAL);
    expect(withRow.get('i1')).toMatchObject({
      kind: 'priced',
      from: 'row',
      decision: { unitPriceCents: 21_000 },
      reference: { status: 'priced', referenceMxnCents: 16_500, capturedDate: '2026-10-20' },
    });
    expect(pricing.loadPricingCurve).not.toHaveBeenCalled();
    expect(pricing.getReferencesBatch).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    const s2 = service([]);
    const noRow = await s2.svc.salesFor([rawItem()], IVA_DIALS_NEUTRAL);
    expect(noRow.get('i1')).toMatchObject({
      kind: 'priced',
      from: 'live',
      decision: { unitPriceCents: 13_340 },
      reference: { status: 'priced', referenceMxnCents: 10_000, capturedDate: '2026-10-28' },
    });
    expect(s2.enqueue).toHaveBeenCalledWith('missing_row', ['i1']);
  });

  it('`pending` nunca se convierte en precio', async () => {
    const { svc } = service([pricedRow({ status: 'pending', unitPriceCents: null, listPriceCents: null, priceBasis: null })]);
    expect((await svc.salesFor([rawItem()], IVA_DIALS_NEUTRAL)).get('i1')).toEqual({
      kind: 'pending',
      reference: { status: 'priced', referenceMxnCents: 16_500, capturedDate: '2026-10-20' },
    });
  });
});

describe('DYN.5.3/.4 — `dial_change` desde las puertas de los diales', () => {
  it('una clave de PRICE_AFFECTING_SETTING_KEYS ⇒ `dial_change`; cualquier otra ⇒ nada', () => {
    const svc = new ListingPriceService({} as PrismaService, {} as SaleDecisionService, {} as SettingsService);
    const enqueue = jest.spyOn(svc, 'enqueue').mockResolvedValue(undefined);
    svc.onSettingsWritten([SettingKey.FEATURED_POOL_SIZE, SettingKey.GRADING_HOOK_ENABLED]);
    expect(enqueue).not.toHaveBeenCalled();
    for (const k of PRICE_AFFECTING_SETTING_KEYS) {
      enqueue.mockClear();
      svc.onSettingsWritten([SettingKey.FEATURED_POOL_SIZE, k]);
      expect({ k, calls: enqueue.mock.calls }).toEqual({ k, calls: [['dial_change']] });
    }
  });

  function settingsWith(tx: Record<string, unknown>) {
    const prisma = {
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      configSetting: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;
    return new SettingsService(prisma);
  }

  it('`PUT /admin/settings`: el aviso llega DESPUÉS del commit, con las claves escritas; si la tx falla, no hay aviso', async () => {
    const seen: string[][] = [];
    const ok = settingsWith({ configSetting: { upsert: jest.fn(async () => undefined), findUnique: jest.fn(async () => null) } });
    ok.onKeysWritten((k) => seen.push([...k]));
    await ok.update({ ivaPct: 16 });
    expect(seen).toEqual([[SettingKey.IVA_PCT]]);

    const seen2: string[][] = [];
    const ko = settingsWith({ configSetting: { upsert: jest.fn(async () => { throw new Error('tx abortada'); }), findUnique: jest.fn(async () => null) } });
    ko.onKeysWritten((k) => seen2.push([...k]));
    await expect(ko.update({ ivaPct: 16 })).rejects.toThrow('tx abortada');
    expect(seen2).toEqual([]);
  });

  it('un oyente que lanza ⛔ no tumba la escritura ya confirmada', async () => {
    const s = settingsWith({ configSetting: { upsert: jest.fn(async () => undefined), findUnique: jest.fn(async () => null) } });
    s.onKeysWritten(() => {
      throw new Error('oyente roto');
    });
    await expect(s.update({ ivaPct: 16 })).resolves.toEqual({ ivaPct: 16 });
  });
});

describe('Puertas de `ConfigSetting`: todas avisan o escriben solo claves que no mueven el precio', () => {
  /** Lista CERRADA: ficheros que escriben `ConfigSetting` sin avisar, con las claves que escriben (ninguna mueve el precio). */
  const SIN_AVISO: Record<string, { keys: string[]; why: string }> = {
    'modules/catalog/graded-estimates.controller.ts': {
      keys: [
        SettingKey.GRADED_ESTIMATE_GRADES,
        SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES,
        SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS,
        SettingKey.GRADING_MIN_UPSIDE_PCT,
        SettingKey.GRADING_COST_TIERS,
        SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
        SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
        SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
        SettingKey.GRADED_ESTIMATE_SOURCE_STAT,
      ],
      why: 'M2 «gancho de grading»: deciden qué se DESTACA, nunca el precio de venta (criterio 104; medido por DYN-B17).',
    },
    'modules/decks-meta/decks-meta.service.ts': {
      keys: [DIAL_AUTOFETCH, DIAL_AUTOPUBLISH],
      why: 'Diales de decks meta (autofetch/autopublish): no son `SettingKey` y no entran al precio.',
    },
  };
  const WRITE = /\bconfigSetting\.(upsert|update|updateMany|create|createMany)\(/;

  function ficheros(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const f = join(dir, e.name);
      if (e.isDirectory()) return ficheros(f);
      return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [f] : [];
    });
  }

  /**
   * El MÉTODO que contiene cada escritura (no el fichero: un fichero con una puerta que avisa y otra que no pasaría). Método
   * = desde la última cabecera de miembro de clase (2 espacios de sangría) antes de la escritura hasta su `\n  }\n`.
   */
  function metodosQueEscriben(code: string): { name: string; body: string }[] {
    const out: { name: string; body: string }[] = [];
    const re = new RegExp(WRITE.source, 'g');
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const head = /\n  (?:@\w+\([^)]*\)\s*\n  )*(?:(?:private|public|protected|static|async|readonly)\s+)*(\w+)\s*\(/g;
      let start = -1;
      let name = '?';
      for (let h = head.exec(code); h && h.index < m.index; h = head.exec(code)) {
        start = h.index;
        name = h[1];
      }
      const end = code.indexOf('\n  }\n', m.index);
      out.push({ name, body: code.slice(start, end) });
    }
    return out;
  }

  it('cada MÉTODO de `src/` que escribe `ConfigSetting` llama a `notifyKeysWritten`, salvo los de la lista cerrada', () => {
    const escritores = ficheros(SRC)
      .filter((f) => WRITE.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .sort();
    expect(escritores.length).toBeGreaterThanOrEqual(5); // control: el barrido ve escritores
    const mudos: string[] = [];
    const avisan = new Set<string>();
    for (const f of escritores) {
      for (const { name, body } of metodosQueEscriben(stripComments(readFileSync(join(SRC, f), 'utf8')))) {
        if (!body.includes('notifyKeysWritten(')) mudos.push(`${f}#${name}`);
        else avisan.add(`${f}#${name}`);
      }
    }
    // Control: el corte por método encuentra las puertas conocidas (si no, el candado no mide lo que dice).
    expect([...avisan].sort()).toEqual([
      'modules/pricing/fx.service.ts#setMode',
      'modules/pricing/pricing.controller.ts#putCurve',
      'modules/pricing/pricing.controller.ts#putSealedSpreads',
      'modules/settings/settings.service.ts#setIvaTransferPct',
      'modules/settings/settings.service.ts#update',
    ]);
    expect([...new Set(mudos)].map((m) => m.split('#')[0]).sort()).toEqual(Object.keys(SIN_AVISO).sort());
    expect(mudos.some((m) => m.startsWith('modules/pricing/'))).toBe(false);
  });

  it('🐤 canario del método: una puerta muda junto a otra que avisa en el MISMO fichero se ve', () => {
    const code = [
      'class C {',
      '  async a() {',
      '    await this.prisma.configSetting.upsert({});',
      '    this.settings.notifyKeysWritten([k]);',
      '  }',
      '  async b() {',
      '    await this.prisma.configSetting.upsert({});',
      '  }',
      '}',
      '',
    ].join('\n');
    expect(metodosQueEscriben(code).map((x) => [x.name, x.body.includes('notifyKeysWritten(')])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('…y las claves de la lista cerrada NO están en PRICE_AFFECTING_SETTING_KEYS', () => {
    for (const { keys } of Object.values(SIN_AVISO)) {
      for (const k of keys) expect((PRICE_AFFECTING_SETTING_KEYS as readonly string[]).includes(k)).toBe(false);
    }
  });

  it('🐤 canario: el patrón VE una escritura (si no, la lista sería verde por ceguera)', () => {
    expect(WRITE.test('await tx.configSetting.upsert({ where })')).toBe(true);
    expect(WRITE.test('// configSetting.upsert(')).toBe(true); // el comentario lo quita `stripComments`, no el patrón
    expect(WRITE.test(stripComments('// configSetting.upsert(\nconst x = 1;'))).toBe(false);
  });
});

describe('DYN.5.8 — `dataHealth.listingPrices`', () => {
  function healthOf(last: string | null, now: Date) {
    const prisma = {
      listingPriceRun: { findFirst: jest.fn(async () => (last ? { businessDate: new Date(`${last}T00:00:00.000Z`) } : null)) },
    } as unknown as PrismaService;
    const settings = { getNumber: jest.fn(async () => 6) } as unknown as SettingsService;
    return new ListingPriceService(prisma, {} as SaleDecisionService, settings).health(now);
  }
  const now = new Date('2026-11-12T15:00:00.000Z'); // 09:00 CDMX ⇒ se sirve el día 12
  it('`never` sin diaria; `ok` con la diaria del día que se sirve; `stale` con una anterior', async () => {
    expect(portadaServedDay(now, 6)).toBe('2026-11-12');
    expect(await healthOf(null, now)).toEqual({ status: 'never', lastDailyBusinessDate: null });
    expect(await healthOf('2026-11-12', now)).toEqual({ status: 'ok', lastDailyBusinessDate: '2026-11-12' });
    expect(await healthOf('2026-11-11', now)).toEqual({ status: 'stale', lastDailyBusinessDate: '2026-11-11' });
  });

  it('v1.113.2: si la lectura de la salud falla, el tablero da `stale` (y el resto responde)', async () => {
    const admin = Object.create(AdminService.prototype) as AdminService;
    Object.assign(admin, { listingPrices: { health: jest.fn(async () => { throw new Error('bd caída'); }) } });
    const h = await (admin as unknown as { listingPricesHealth(): Promise<unknown> }).listingPricesHealth();
    expect(h).toEqual({ status: 'stale', lastDailyBusinessDate: null });
  });
});

describe('DYN.6.1 — cabeceras de las lecturas públicas', () => {
  it('`cards`, `facets`, `sealed` y `featured` llevan `public, max-age=30, stale-while-revalidate=30`', () => {
    expect(CATALOG_LIST_CACHE_CONTROL).toBe('public, max-age=30, stale-while-revalidate=30');
    for (const m of ['listCards', 'facets', 'listSealed', 'featured'] as const) {
      const headers = Reflect.getMetadata('__headers__', CatalogController.prototype[m]) as { name: string; value: string }[];
      expect({ m, headers }).toEqual({ m, headers: [{ name: 'Cache-Control', value: CATALOG_LIST_CACHE_CONTROL }] });
    }
  });

  it('ninguna de las cuatro lee sesión (sin guardia de sesión opcional ni `@CurrentUser`)', () => {
    const src = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'catalog.controller.ts'), 'utf8'));
    for (const route of ["@Get('cards')", "@Get('facets')", "@Get('sealed')", "@Get('featured')"]) {
      const i = src.indexOf(route);
      expect(i).toBeGreaterThan(-1);
      const head = src.slice(src.lastIndexOf('@Public()', i), src.indexOf('{', src.indexOf(')', i + route.length) + 1));
      const body = src.slice(i, src.indexOf('\n  }\n', i));
      expect({ route, guard: /UseGuards|OptionalSessionGuard/.test(head), user: /CurrentUser|req\.user|@Req\(/.test(body) }).toEqual({
        route,
        guard: false,
        user: false,
      });
    }
  });
});

describe('DYN.5.3 — la corrida diaria (H − 60 min) y el `bootstrap`', () => {
  function svcWith(okDays: string[]) {
    const prisma = {
      listingPriceRun: {
        findFirst: jest.fn(async ({ where }: { where: { trigger: string; businessDate?: Date } }) =>
          where.trigger === 'daily' && where.businessDate && okDays.includes(where.businessDate.toISOString().slice(0, 10)) ? { id: 'x' } : null,
        ),
      },
    } as unknown as PrismaService;
    const settings = { getNumber: jest.fn(async () => 6), onKeysWritten: jest.fn() } as unknown as SettingsService;
    const svc = new ListingPriceService(prisma, {} as SaleDecisionService, settings);
    const run = jest.spyOn(svc, 'run').mockResolvedValue({ status: 'ok' } as never);
    return { svc, run, settings };
  }

  it('antes de 05:00 CDMX el día de portada sigue siendo el de hoy; a las 05:00 CDMX corre la de mañana, una vez', async () => {
    const before = svcWith(['2026-12-01']);
    expect(await before.svc.dailyTick(new Date('2026-12-02T10:59:00.000Z'))).toEqual({ status: 'exists', businessDate: '2026-12-01' });
    expect(before.run).not.toHaveBeenCalled();

    const due = svcWith(['2026-12-01']);
    expect(await due.svc.dailyTick(new Date('2026-12-02T11:00:00.000Z'))).toEqual({ status: 'ran', businessDate: '2026-12-02' });
    expect(due.run).toHaveBeenCalledWith('daily', undefined, { businessDate: '2026-12-02' });

    const done = svcWith(['2026-12-02']);
    expect(await done.svc.dailyTick(new Date('2026-12-02T11:15:00.000Z'))).toEqual({ status: 'exists', businessDate: '2026-12-02' });
    expect(done.run).not.toHaveBeenCalled();
  });

  it('al arrancar se suscribe a las escrituras de diales; bajo la suite NO lanza el `bootstrap`', async () => {
    const { svc, settings } = svcWith([]);
    const enqueue = jest.spyOn(svc, 'enqueue').mockResolvedValue(undefined);
    await svc.onApplicationBootstrap();
    expect(settings.onKeysWritten).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fuera de la suite: sin `bootstrap` ok ⇒ lo encola; con él ⇒ nada', async () => {
    const prev = process.env.E2E_ENABLE_SCHEDULER;
    process.env.E2E_ENABLE_SCHEDULER = 'true';
    try {
      for (const [done, calls] of [[null, [['bootstrap']]], [{ id: 'b' }, []]] as const) {
        const prisma = { listingPriceRun: { findFirst: jest.fn(async () => done) } } as unknown as PrismaService;
        const settings = { onKeysWritten: jest.fn() } as unknown as SettingsService;
        const svc = new ListingPriceService(prisma, {} as SaleDecisionService, settings);
        const enqueue = jest.spyOn(svc, 'enqueue').mockResolvedValue(undefined);
        await svc.onApplicationBootstrap();
        expect(enqueue.mock.calls).toEqual(calls);
      }
    } finally {
      if (prev === undefined) delete process.env.E2E_ENABLE_SCHEDULER;
      else process.env.E2E_ENABLE_SCHEDULER = prev;
    }
  });
});

describe('DYN-B22 (unidad) — variante de `manual_price` y referencia congelada (v1.113.3, §DYN.5.3/.5)', () => {
  it('`enqueueVariant` encola SOLO las piezas cuya clave de referencia es la escrita (grado y acabado incluidos)', async () => {
    const items = [
      rawItem({ id: 'nm', rawCondition: 'NM', finish: 'normal' }),
      rawItem({ id: 'lp', rawCondition: 'LP', finish: 'normal' }),
      rawItem({ id: 'nm-holo', rawCondition: 'NM', finish: 'holofoil' }),
    ];
    const prisma = { inventoryItem: { findMany: jest.fn(async () => items) } } as unknown as PrismaService;
    const pricing = pricingDouble();
    (pricing.tryGradeKeyFor as unknown as jest.Mock).mockImplementation((i: { rawCondition: string }) => `raw:${i.rawCondition}`);
    const svc = new ListingPriceService(prisma, new SaleDecisionService(pricing), {} as SettingsService);
    const enqueue = jest.spyOn(svc, 'enqueue').mockResolvedValue(undefined);
    await svc.enqueueVariant('manual_price', { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' });
    await svc.idle();
    expect(enqueue.mock.calls).toEqual([['manual_price', ['nm']]]);
    expect((prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
      ownerType: 'platform',
      cardId: 'c1',
      productType: 'raw',
    });
  });

  it('`exhibitedReferenceOf`: el sellado pasa por el gate de su fuente; el resto, la referencia `priced` de su variante', () => {
    const pricing = pricingDouble();
    const decider = new SaleDecisionService(pricing);
    (pricing.sealedMarketGradeKeyForItem as unknown as jest.Mock).mockReturnValue('sealed:tcg:9');
    const ref = { status: 'priced', referenceMxnCents: 50_000, source: 'tcgcsv', capturedDate: '2026-10-27' };
    const batch = {
      curve: null,
      premiumFloorPolicy: null,
      sealedSpreads: { spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false },
      refs: new Map([
        ['c1|sealed|sealed:tcg:9|normal', ref],
        ['c1|raw|raw:NM|normal', ref],
      ]),
      variantOverrides: new Map(),
    } as never;
    const sealed = rawItem({ productType: 'sealed', rawCondition: null, tcgplayerProductId: 9 });
    (pricing.gateSealedMarketCents as unknown as jest.Mock).mockReturnValueOnce(null);
    expect(decider.exhibitedReferenceOf(sealed, batch)).toEqual({ referenceMxnCents: null, capturedDate: null });
    expect(pricing.gateSealedMarketCents).toHaveBeenLastCalledWith(ref, false);
    (pricing.gateSealedMarketCents as unknown as jest.Mock).mockReturnValueOnce(50_000);
    expect(decider.exhibitedReferenceOf(sealed, batch)).toEqual({ referenceMxnCents: 50_000, capturedDate: '2026-10-27' });
    expect(decider.exhibitedReferenceOf(rawItem(), batch)).toEqual({ referenceMxnCents: 50_000, capturedDate: '2026-10-27' });
    expect(decider.exhibitedReferenceOf(rawItem({ cardId: 'otra' }), batch)).toEqual({ referenceMxnCents: null, capturedDate: null });
  });
});
