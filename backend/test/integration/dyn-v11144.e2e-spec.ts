/**
 * dyn-v11144.e2e-spec.ts — 💰 errata v1.114.4 de §DYN (API_CONTRACT §DYN.5.3, §DYN.5.9, §DYN.5.10) contra Postgres REAL.
 *
 *  DYN-B28: caso vigente SIN base, `tcgcsv_singles` y `tcgdex` frescas al MISMO precio con `capturedDate` distintas ⇒ la fila
 *           exhibe la fecha de la primera del dial `priceArbiterSources`; con el dial invertido, la de la otra.
 *  DYN-B29: caso CON base y `createdAt` = 2026-10-30T00:30Z (18:30 CDMX del 29) ⇒ `referenceCapturedDate` = 2026-10-30 (día
 *           UTC) en la fila y en la ficha.
 *  DYN-B30: dos corridas sobre las mismas piezas; la que EMPIEZA DESPUÉS en la BD corre con el reloj de Node 10 min atrás y
 *           termina antes ⇒ su fila sobrevive: la otra ni la pisa ni la borra.
 *  DYN-B31: poda de `ListingPriceRun` a 90 días sin fila que las cite, salvo la `bootstrap` ok y la `daily` ok más reciente;
 *           sin error de FK y con la salud igual antes y después; la corre el tic diario tras su `daily` ok.
 * Deterministas (N=1 por construcción): el solape de B30 lo fija un cerrojo; el reloj desfasado, `jest.useFakeTimers` solo
 * sobre `Date`.
 */
import { randomUUID } from 'crypto';
import { Finish, Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import {
  ListingPriceService,
  portadaEffectiveFrom,
} from '../../src/modules/pricing/listing-price.service';
import { SaleDecisionService } from '../../src/modules/pricing/sale-decision.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SettingKey } from '../../src/modules/settings/settings.constants';
import { dayMx } from '../../src/modules/spend-alerts/spend-alerts.service';

type Ref = { status: string; referenceMxnCents?: number; capturedDate?: string };

describe('E2E — errata v1.114.4 de §DYN (DYN-B28…B31)', () => {
  let h: E2EHarness;
  let lp: ListingPriceService;
  let decider: SaleDecisionService;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  const cardIds: string[] = [];
  let seq = 0;
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const today = () => new Date(`${ymd(new Date())}T00:00:00.000Z`);
  const daysAgo = (n: number) => new Date(today().getTime() - n * 86_400_000);
  let savedSources: Prisma.JsonValue | undefined;

  async function card(n: number) {
    const c = await h.prisma.card.create({
      data: {
        externalId: `v4-${run}-${n}`,
        setId,
        name: `Carta Errata ${run} ${n}`,
        number: String(n),
        rarity: 'Common',
        rarityCanonical: 'Common',
        availableFinishes: ['normal', 'holofoil'],
      },
    });
    cardIds.push(c.id);
    return c.id;
  }
  async function item(cardId: string, finish: Finish = 'normal', data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return (
      await h.prisma.inventoryItem.create({
        data: {
          folio: `V4-${run}-${seq}`,
          cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish,
          ownerType: 'platform',
          status: 'listed',
          acquisitionType: 'compra',
          acquisitionCostCents: 1000,
          firstListedAt: new Date(),
          ...data,
        },
      })
    ).id;
  }
  async function refRow(cardId: string, finish: Finish, source: 'tcgcsv_singles' | 'tcgdex', cents: number, day: Date) {
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish, source, priceMxnCents: cents, capturedDate: day, refKind: 'market' },
    });
  }
  async function openCase(cardId: string, finish: Finish, baselineMxnCents: number | null, createdAt?: Date) {
    await h.prisma.priceReviewCase.create({
      data: {
        cardId,
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish,
        axis: 'sell',
        proposedMxnCents: 9_999,
        baselineMxnCents,
        jumpFactorMilli: 0,
        sourceCount: 2,
        familyCount: 1,
        consensus: false,
        quotesSnapshot: [],
        status: 'open',
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }
  const row = (id: string) => h.prisma.listingPrice.findUnique({ where: { inventoryItemId: id } });
  async function setSources(v: string[]) {
    const key = SettingKey.PRICE_ARBITER_SOURCES;
    await h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: v }, update: { valueJson: v } });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    lp = h.app.get(ListingPriceService);
    decider = h.app.get(SaleDecisionService);
    savedSources = (await h.prisma.configSetting.findUnique({ where: { key: SettingKey.PRICE_ARBITER_SOURCES } }))?.valueJson;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `v4-${run}`, name: `Set Errata ${run}` } })).id;
  });

  afterAll(async () => {
    if (!h) return;
    jest.useRealTimers();
    await lp?.idle();
    const key = SettingKey.PRICE_ARBITER_SOURCES;
    if (savedSources === undefined) await h.prisma.configSetting.deleteMany({ where: { key } });
    else await h.prisma.configSetting.update({ where: { key }, data: { valueJson: savedSources as Prisma.InputJsonValue } });
    const ids = (await h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: `V4-${run}-` } }, select: { id: true } })).map((i) => i.id);
    await h.prisma.listingPrice.deleteMany({ where: { inventoryItemId: { in: ids } } });
    await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
    await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } }).catch(() => undefined);
    await h.prisma.cardSet.deleteMany({ where: { id: setId } }).catch(() => undefined);
    await h.close();
  });

  describe('DYN-B28 — empate del mínimo sin base: el orden del dial', () => {
    let k: string;
    let X: string;
    const TCGCSV_DAY = () => daysAgo(2);
    const TCGDEX_DAY = () => today();
    beforeAll(async () => {
      k = await card(1);
      await refRow(k, 'holofoil', 'tcgcsv_singles', 300, TCGCSV_DAY());
      await refRow(k, 'holofoil', 'tcgdex', 300, TCGDEX_DAY());
      await openCase(k, 'holofoil', null);
      X = await item(k, 'holofoil');
    });
    afterAll(async () => {
      if (savedSources === undefined) await h.prisma.configSetting.deleteMany({ where: { key: SettingKey.PRICE_ARBITER_SOURCES } });
      else await setSources(savedSources as string[]);
    });

    it('dial tcgcsv_singles → tcgdex ⇒ la fecha de la de tcgcsv (aunque la de tcgdex sea más fresca)', async () => {
      await setSources(['tcgcsv_singles', 'tcgdex', 'cardmarket']);
      await lp.run('manual_price', [X]);
      const fila = (await row(X))!;
      expect({ ref: fila.referenceMxnCents, date: ymd(fila.referenceCapturedDate!) }).toEqual({ ref: 300, date: ymd(TCGCSV_DAY()) });
    });

    it('dial invertido (tcgdex → tcgcsv_singles) ⇒ la fecha de la de tcgdex', async () => {
      await setSources(['tcgdex', 'tcgcsv_singles', 'cardmarket']);
      await lp.run('manual_price', [X]);
      const fila = (await row(X))!;
      expect({ ref: fila.referenceMxnCents, date: ymd(fila.referenceCapturedDate!) }).toEqual({ ref: 300, date: ymd(TCGDEX_DAY()) });
    });
  });

  describe('DYN-B29 — la fecha de la base retenida es el día UTC de createdAt del caso', () => {
    it('createdAt 2026-10-30T00:30Z (18:30 CDMX del 29) ⇒ 2026-10-30 en la fila y en la ficha', async () => {
      const k = await card(2);
      // Base de MX$500 (precio de MERCADO, no de piso: la ficha solo exhibe la fecha si `priceBasis = market`, D2).
      await refRow(k, 'normal', 'tcgcsv_singles', 900_000, today());
      await openCase(k, 'normal', 50_000, new Date('2026-10-30T00:30:00.000Z'));
      const X = await item(k);
      await lp.run('manual_price', [X]);
      const fila = (await row(X))!;
      expect({ ref: fila.referenceMxnCents, date: ymd(fila.referenceCapturedDate!), basis: fila.priceBasis }).toEqual({
        ref: 50_000,
        date: '2026-10-30',
        basis: 'market',
      });
      const ficha = await h.api<{ listings: { finish: string; referenceValue: Ref }[] }>('GET', `/catalog/cards/${k}`);
      const l = ficha.body.listings.find((x) => x.finish === 'normal')!;
      expect(l.referenceValue.capturedDate).toBe('2026-10-30');
    });
  });

  describe('DYN-B30 — «empezó después» con el reloj de la BD', () => {
    it('💰 la corrida que empieza después en la BD (Node 10 min atrás) y termina antes conserva su fila: la otra ni la pisa ni la borra', async () => {
      const k = await card(3);
      await refRow(k, 'normal', 'tcgcsv_singles', 500, today());
      const X = await item(k);
      const Y = await item(k, 'normal', { status: 'withdrawn' }); // fuera del alcance de A cuando A lee
      // A: otra «instancia» (su propia cadena) con el cuerpo retenido en su primer lote hasta que B termine.
      let reached!: () => void;
      const atBatch = new Promise<void>((r) => (reached = r));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const deciderA = Object.create(decider) as SaleDecisionService;
      deciderA.loadBatch = async (...args: Parameters<SaleDecisionService['loadBatch']>) => {
        reached();
        await gate;
        return decider.loadBatch(...args);
      };
      const lpA = new ListingPriceService(h.prisma, deciderA, h.app.get(SettingsService));
      const a = lpA.run('manual_price', [X, Y]);
      await atBatch;
      await h.prisma.inventoryItem.update({ where: { id: Y }, data: { status: 'listed' } });
      // B empieza DESPUÉS en la BD, con el reloj del proceso 10 min atrás (instancia con el reloj desfasado).
      jest.useFakeTimers({
        now: Date.now() - 10 * 60_000,
        doNotFake: [
          'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
          'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
          'setTimeout', 'clearTimeout',
        ],
      });
      let b;
      try {
        b = await lp.run('manual_price', [X, Y]);
      } finally {
        jest.useRealTimers();
      }
      expect(b.status).toBe('ok');
      release();
      const ra = await a;
      expect(ra.status).toBe('ok');
      expect({ x: (await row(X))?.runId, y: (await row(Y))?.runId }).toEqual({ x: b.runId, y: b.runId });
    });
  });

  describe('DYN-B31 — retención de ListingPriceRun (§DYN.5.10)', () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    async function mkRun(trigger: string, status: string, startedAt: Date, businessDate = ymd(startedAt)) {
      const [{ id }] = await h.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "ListingPriceRun" (id, "businessDate", trigger, status, "scopeItemCount", "startedAt")
        VALUES (${randomUUID()}, ${businessDate}::date, ${trigger}::"ListingPriceRunTrigger", ${status}::"ListingPriceRunStatus", 0, ${startedAt})
        RETURNING id`;
      return id;
    }

    it('sale la de 91 días sin fila; quedan la citada, la de 89, la bootstrap ok y la última daily ok; FK intacta y salud igual', async () => {
      // El arnés borró las filas al arrancar; las corridas de suites anteriores no las cita nadie: se parte de cero.
      await lp.idle();
      await h.prisma.listingPrice.deleteMany({});
      await h.prisma.listingPriceRun.deleteMany({});
      const old = await mkRun('manual_price', 'ok', ago(91));
      const oldRunning = await mkRun('manual_price', 'running', ago(95));
      const cited = await mkRun('manual_price', 'ok', ago(91));
      const recent = await mkRun('manual_price', 'ok', ago(89));
      const boot = await mkRun('bootstrap', 'ok', ago(120));
      const lastDaily = await mkRun('daily', 'ok', ago(120));
      const olderDaily = await mkRun('daily', 'ok', ago(130));
      const k = await card(4);
      await refRow(k, 'normal', 'tcgcsv_singles', 500, today());
      const X = await item(k);
      await lp.run('manual_price', [X]);
      await h.prisma.listingPrice.update({ where: { inventoryItemId: X }, data: { runId: cited } });
      const before = await lp.health();
      const deleted = await lp.pruneRuns();
      const left = new Set((await h.prisma.listingPriceRun.findMany({ select: { id: true } })).map((r) => r.id));
      expect({
        deleted,
        old: left.has(old),
        oldRunning: left.has(oldRunning),
        olderDaily: left.has(olderDaily),
        cited: left.has(cited),
        recent: left.has(recent),
        boot: left.has(boot),
        lastDaily: left.has(lastDaily),
      }).toEqual({ deleted: 3, old: false, oldRunning: false, olderDaily: false, cited: true, recent: true, boot: true, lastDaily: true });
      expect(await lp.health()).toEqual(before);
    });

    it('el tic diario poda tras su `daily` ok', async () => {
      const hour = await h.app.get(SettingsService).getNumber(SettingKey.FEATURED_ROTATION_HOUR);
      const day = dayMx(new Date());
      const prune = jest.spyOn(lp, 'pruneRuns');
      try {
        const res = await lp.dailyTick(new Date(portadaEffectiveFrom(day, hour).getTime() + 60_000));
        expect(res.status).toBe('ran');
        expect(prune).toHaveBeenCalledTimes(1);
      } finally {
        prune.mockRestore();
      }
    }, 120_000);
  });
});
