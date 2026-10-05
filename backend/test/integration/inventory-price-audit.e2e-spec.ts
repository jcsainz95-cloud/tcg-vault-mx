/**
 * inventory-price-audit.e2e-spec.ts — ⭐ v1.80.8.7 «PRECIO FINAL DEL SELLADO» contra Postgres real y por
 * HTTP (API_CONTRACT §M1 `M1-SFP`, ARCHITECTURE §4.36.5 (c-quater), criterio 255; cierra `D-SFP-1`).
 * Propiedad: backend; la ejecuta QA. Las unitarias (incluida SFP-6, estática) viven en
 * `test/inventory.sealed-final-price.spec.ts`.
 *
 * - SFP-1/2: todo `PATCH` que cambia `status` o `listPriceCents` deja UNA fila `inventory.item_updated` con
 *   `before/after {status, listPriceCents}` y el actor, en los dos caminos.
 * - SFP-3: atomicidad medida en la BD — un TRIGGER que hace fallar el `INSERT` de esa fila; la pieza debe
 *   quedar intacta (si la bitácora se escribiera fuera de la tx, el cambio quedaría confirmado).
 * - SFP-4: sin cambio o con rechazo ⇒ cero filas.
 * - SFP-5 ⭐: la carrera de dos re-precios. Orden FORZADO con candado de fila (`row-lock-barrier.ts`):
 *   ambos leen y se bloquean en su escritura; al soltar, uno gana y el otro recibe `409` (el precio leído
 *   está en el CAS). Y suelta (sin barrera), con proporción. Los dos caminos.
 * - SFP-7: `pendingReason` en «Listas para publicar».
 * - SFP-8: `resolvedSalePriceCents`/`priceBasis` en el listado de M1, solo sellado de plataforma.
 * - SFP-9: el dial rige desde la siguiente petición (sin caché) y la forma del `422` del `PUT`.
 * - SFP-10 ⭐ (v1.80.8.8): «el lote publica en la ventana». Un `publish-all` REAL publica la pieza `in_stock → listed`
 *   (sin precio de línea) entre la lectura del `PATCH` publicante y su CAS ⇒ el `PATCH` recibe `409 CONFLICT` y no deja
 *   fila. Forzada con candado de fila (el lote se encola PRIMERO en la cola FIFO del candado, el `PATCH` detrás) y
 *   suelta, con proporción. El oráculo del «antes real» es un TRIGGER que anota cada `UPDATE` de la pieza en la BD.
 *
 * ⚠️ El dial `premium_floor_sale_publish` es fila COMPARTIDA de `ConfigSetting`: se guarda y se restaura.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';
import { PricingCurve } from '../../src/common/pricing-curve';

const RUN = `sfp${Date.now().toString(36)}`;
const SET_ID = 'e2e-sfp-set';
const PREFIX = 'e2e-sfp-';
const DIAL_KEY = 'premium_floor_sale_publish';
const SEED_DIAL = { mode: 'only', rarities: ['Double Rare', 'Rare Holo EX'] };
const NONE_DIAL = { mode: 'none', rarities: [] as string[] };
const BROKEN_MARKET = 1000; // MX$10 ⇒ la venta cae al piso
const GOOD_MARKET = 200_000;
const SEALED_PID = 990_001;
const N = 10;

type Slug = 'sealed' | 'sealed2' | 'common' | 'sir' | 'noref' | 'dr' | 'graded';
const CARDS: Record<Slug, { rarity: string; n: string }> = {
  sealed: { rarity: 'Sealed', n: '1' },
  sealed2: { rarity: 'Sealed', n: '2' },
  common: { rarity: 'Common', n: '3' },
  sir: { rarity: 'Special Illustration Rare', n: '4' },
  noref: { rarity: 'Common', n: '5' },
  dr: { rarity: 'Double Rare', n: '6' },
  graded: { rarity: 'Rare', n: '7' },
};
const cardId = (s: Slug) => `${PREFIX}${s}`;
/** SFP-10: set y carta PROPIOS ⇒ el `publish-all` filtrado por `setId` solo ve las piezas de SFP-10. */
const SFP10_SET = 'e2e-sfp10-set';
const SFP10_CARD = `${PREFIX}sfp10`;

describe('E2E — M1-SFP: bitácora antes/después del PATCH, motivo en la cola, precio derivado (v1.80.8.7)', () => {
  let h: E2EHarness;
  let op: string;
  let admin: string;
  let operatorId: string;
  let customerId: string;
  let shelf: string;
  let curve: PricingCurve;
  let dialBefore: unknown = undefined;
  let seq = 0;

  async function cleanup() {
    const ids = [...Object.keys(CARDS).map((s) => cardId(s as Slug)), SFP10_CARD];
    const its = await h.prisma.inventoryItem.findMany({
      where: { cardId: { in: ids } },
      select: { id: true },
    });
    const itemIds = its.map((i) => i.id);
    await h.prisma.auditLog.deleteMany({
      where: { entityType: 'InventoryItem', entityId: { in: itemIds } },
    });
    await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.card.deleteMany({ where: { setId: { in: [SET_ID, SFP10_SET] } } });
    await h.prisma.cardSet.deleteMany({ where: { id: { in: [SET_ID, SFP10_SET] } } });
  }

  async function setDial(value: unknown) {
    const res = await h.api('PUT', '/admin/settings', {
      token: admin,
      json: { premiumFloorSalePublish: value },
    });
    expect({ status: res.status, body: res.status === 200 ? null : res.body }).toEqual({
      status: 200,
      body: null,
    });
  }

  async function market(slug: Slug, cents: number) {
    await h.prisma.priceReference.create({
      data: {
        cardId: cardId(slug),
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        source: 'manual',
        priceMxnCents: cents,
        capturedDate: new Date('2026-10-04T00:00:00.000Z'),
        isManualOverride: true,
        refKind: 'market',
      },
    });
  }

  async function mk(slug: Slug, o: Record<string, unknown> = {}) {
    seq += 1;
    const sealed = slug === 'sealed' || slug === 'sealed2';
    const graded = slug === 'graded';
    return h.prisma.inventoryItem.create({
      data: {
        folio: `SFP-${RUN}-${String(seq).padStart(4, '0')}`,
        cardId: cardId(slug),
        productType: sealed ? 'sealed' : graded ? 'graded' : 'raw',
        ...(sealed ? { sealedSubtype: 'box', sealedCondition: 'mint' } : {}),
        ...(sealed || graded ? {} : { rawCondition: 'NM' }),
        finish: 'normal',
        acquisitionType: 'compra',
        ownerType: 'platform',
        status: 'in_stock',
        locationId: shelf,
        ...o,
      } as never,
    });
  }

  // 💰 v1.83 (§M11-SP.4): el precio de un sellado SIN producto (todas las piezas selladas de esta suite) solo lo
  // escribe el dueño — un operador recibe `403` (SP-9, `sealed-price.e2e-spec.ts`). Lo que esta suite mide (bitácora,
  // CAS, carreras del `PATCH`) no depende del rol, así que el `PATCH` va con el token del dueño.
  const patch = (id: string, json: Record<string, unknown>) =>
    h.api('PATCH', `/admin/inventory/items/${id}`, { token: admin, json });
  const audits = (id: string) =>
    h.prisma.auditLog.findMany({
      where: { action: 'inventory.item_updated', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
  const state = (id: string) =>
    h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
      select: { status: true, listPriceCents: true },
    });
  const pendingSnapshot = async () =>
    (
      await h.prisma.pendingPriceEntry.findMany({
        where: { cardId: { startsWith: PREFIX } },
        orderBy: { id: 'asc' },
        // `PendingPriceEntry` no tiene `updatedAt` (schema medido): se compara la fila ENTERA (estado,
        // motivo, contexto, `resolvedAt`…) y el conteo — cualquier escritura cambia alguna columna.
      })
    ).map((r) => JSON.stringify(r));

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    op = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorId = (
      await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })
    ).id; // v1.83: el actor del `PATCH` es el dueño (ver `patch`); el nombre se conserva
    customerId = (
      await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })
    ).id;
    shelf = (
      await h.prisma.vaultLocation.findFirstOrThrow({
        where: { zone: 'platform_stock', isActive: true },
      })
    ).id;
    const row = await h.prisma.configSetting.findUnique({ where: { key: DIAL_KEY } });
    dialBefore = row ? row.valueJson : undefined;
    curve = (await h.api<PricingCurve>('GET', '/admin/pricing/curve', { token: admin })).body;

    await cleanup();
    await h.prisma.cardSet.create({
      data: { id: SET_ID, externalId: SET_ID, name: 'E2E Sealed Final Price' },
    });
    for (const [slug, c] of Object.entries(CARDS) as [Slug, (typeof CARDS)[Slug]][]) {
      await h.prisma.card.create({
        data: {
          id: cardId(slug),
          externalId: cardId(slug),
          setId: SET_ID,
          name: `SFP ${slug}`,
          number: c.n,
          rarity: c.rarity,
          rarityCanonical: c.rarity,
          availableFinishes: ['normal'],
        },
      });
    }
    await market('common', GOOD_MARKET);
    await market('sir', BROKEN_MARKET);
    await market('dr', BROKEN_MARKET);
    await setDial(SEED_DIAL);
  }, 180000);

  afterAll(async () => {
    if (h) {
      await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sfp_fail_audit ON "AuditLog"`);
      await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sfp_fail_audit()`);
      await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sfp10_trace ON "InventoryItem"`);
      await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sfp10_trace_fn()`);
      await h.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS sfp10_trace`);
      await cleanup();
      if (dialBefore === undefined)
        await h.prisma.configSetting.deleteMany({ where: { key: DIAL_KEY } });
      else
        await h.prisma.configSetting.update({
          where: { key: DIAL_KEY },
          data: { valueJson: dialBefore as object },
        });
      await h.close();
    }
  });

  // ===========================================================================================
  describe('SFP-1 — re-precio (no publicante): UNA fila con antes/después y el actor', () => {
    it.each([
      ['in_stock', 100000],
      ['in_stock', null],
      ['listed', 100000],
    ] as const)('sellado %s con precio %p ⇒ 200 y una fila', async (status, price) => {
      const it0 = await mk('sealed', { status, listPriceCents: price });
      const r = await patch(it0.id, { listPriceCents: 125000 });
      expect(r.status).toBe(200);
      expect(await state(it0.id)).toEqual({ status, listPriceCents: 125000 });
      const rows = await audits(it0.id);
      expect(
        rows.map((a) => ({
          u: a.actorUserId,
          r: a.actorRole,
          b: a.before,
          a: a.after,
          t: a.entityType,
        })),
      ).toEqual([
        {
          u: operatorId,
          r: 'super_admin',
          b: { status, listPriceCents: price },
          a: { status, listPriceCents: 125000, fields: ['listPriceCents'] },
          t: 'InventoryItem',
        },
      ]);
    });
  });

  // ===========================================================================================
  describe('SFP-2 — «Guardar y publicar» (publicante): UNA fila', () => {
    it('sellado `in_stock` con ubicación + `{listPriceCents, status:"listed"}`', async () => {
      const it0 = await mk('sealed');
      const r = await patch(it0.id, { listPriceCents: 125000, status: 'listed' });
      expect(r.status).toBe(200);
      expect(await state(it0.id)).toEqual({ status: 'listed', listPriceCents: 125000 });
      const rows = await audits(it0.id);
      expect(rows.map((a) => [a.actorUserId, a.before, a.after])).toEqual([
        [
          operatorId,
          { status: 'in_stock', listPriceCents: null },
          { status: 'listed', listPriceCents: 125000, fields: ['listPriceCents', 'status'] },
        ],
      ]);
    });

    it('`{status:"listed"}` solo sobre una carta con precio derivable ⇒ precio igual en los dos lados', async () => {
      const it0 = await mk('common');
      const r = await patch(it0.id, { status: 'listed' });
      expect(r.status).toBe(200);
      const rows = await audits(it0.id);
      expect(rows.map((a) => [a.before, a.after])).toEqual([
        [
          { status: 'in_stock', listPriceCents: null },
          { status: 'listed', listPriceCents: null, fields: ['status'] },
        ],
      ]);
    });
  });

  // ===========================================================================================
  describe('SFP-3 — atomicidad medida en la BD: si el INSERT de la bitácora falla, nada se confirma', () => {
    async function withFailingAudit(ids: string[], fn: () => Promise<void>) {
      const list = ids.map((i) => `'${i}'`).join(',');
      await h.prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION sfp_fail_audit() RETURNS trigger AS $$
        BEGIN
          IF NEW."action" = 'inventory.item_updated' AND NEW."entityId" IN (${list}) THEN
            RAISE EXCEPTION 'sfp: audit insert failed (test double)';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await h.prisma.$executeRawUnsafe(
        `CREATE TRIGGER sfp_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION sfp_fail_audit()`,
      );
      try {
        await fn();
      } finally {
        await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sfp_fail_audit ON "AuditLog"`);
        await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sfp_fail_audit()`);
      }
    }

    it('no publicante (solo precio) y publicante: respuesta de error y la pieza INTACTA', async () => {
      const a = await mk('sealed', { status: 'listed', listPriceCents: 100000 });
      const b = await mk('sealed');
      const c = await mk('sealed', { status: 'listed', listPriceCents: 100000 });
      await withFailingAudit([a.id, b.id, c.id], async () => {
        const ra = await patch(a.id, { listPriceCents: 125000 });
        const rb = await patch(b.id, { listPriceCents: 125000, status: 'listed' });
        const rc = await patch(c.id, { status: 'in_stock' });
        expect([ra.status, rb.status, rc.status].every((s) => s >= 500)).toBe(true);
      });
      expect(await state(a.id)).toEqual({ status: 'listed', listPriceCents: 100000 });
      expect(await state(b.id)).toEqual({ status: 'in_stock', listPriceCents: null });
      expect(await state(c.id)).toEqual({ status: 'listed', listPriceCents: 100000 });
      for (const x of [a, b, c]) expect(await audits(x.id)).toEqual([]);
    });
  });

  // ===========================================================================================
  describe('SFP-4 — sin cambio o con rechazo ⇒ cero filas `inventory.item_updated`', () => {
    const updates = (id: string) =>
      h.prisma.auditLog.count({ where: { action: 'inventory.update', entityId: id } });

    it.each([
      ['precio igual al leído', { listPriceCents: 100000 }, {}, 200],
      ['solo certNumber (gradeada)', { certNumber: 'C-1' }, { slug: 'graded' }, 200],
      ['reserved ⇒ 422 ITEM_NOT_ADJUSTABLE', { listPriceCents: 1 }, { status: 'reserved' }, 422],
      ['cliente ⇒ 422 ITEM_NOT_ADJUSTABLE', { listPriceCents: 1 }, { customer: true }, 422],
      ['sin precio ⇒ 422 PRICE_PENDING', { status: 'listed' }, { listPriceCents: null }, 422],
      ['picking ⇒ 422 ITEM_NOT_PUBLISHABLE', { status: 'listed' }, { status: 'picking' }, 422],
    ] as const)('%s', async (_l, body, o: any, code) => {
      const it0 = await mk(o.slug ?? 'sealed', {
        listPriceCents: 'listPriceCents' in o ? o.listPriceCents : 100000,
        ...(o.status ? { status: o.status } : {}),
        ...(o.customer
          ? {
              ownerType: 'customer',
              ownerUserId: customerId,
              ownershipStatus: 'settled',
              status: 'in_custody',
            }
          : {}),
      });
      const r = await patch(it0.id, body as Record<string, unknown>);
      expect(r.status).toBe(code);
      expect(await audits(it0.id)).toEqual([]);
      // La fila del controlador (`inventory.update`) solo en los 200, como hoy.
      expect(await updates(it0.id)).toBe(code === 200 ? 1 : 0);
    });
  });

  // ===========================================================================================
  describe('SFP-5 ⭐ — carrera de dos re-precios sobre la misma pieza', () => {
    /** Ambos `PATCH` leen y se BLOQUEAN en su escritura (comprobado); luego se suelta. */
    async function forced(id: string, bodies: [Record<string, unknown>, Record<string, unknown>]) {
      const candado = diferida();
      const soltar = diferida();
      const tx = h.prisma.$transaction(
        async (t) => {
          await t.$executeRawUnsafe(`SELECT id FROM "InventoryItem" WHERE id = $1 FOR UPDATE`, id);
          candado.abrir();
          await soltar.promesa;
        },
        { timeout: 30000, maxWait: 30000 },
      );
      let ps: Promise<any>[] = [];
      try {
        await candado.promesa;
        ps = bodies.map((b) => patch(id, b));
        await esperarBloqueoDeFila(h.prisma, 'InventoryItem', 2);
      } finally {
        soltar.abrir();
      }
      await tx;
      return Promise.all(ps);
    }

    async function verdict(
      id: string,
      initial: number | null,
      res: any[],
      bodies: Record<string, unknown>[],
    ) {
      const st = res.map((r) => r.status).sort();
      const rows = await audits(id);
      const s = await state(id);
      return { st, rows, s, bodies, initial };
    }

    const variants = [
      {
        name: 'no publicante (sellado `listed` re-preciado)',
        mkOpts: { status: 'listed', listPriceCents: 100000 },
        initial: 100000,
        bodies: [{ listPriceCents: 111111 }, { listPriceCents: 122222 }] as [any, any],
      },
      {
        name: 'publicante («Guardar y publicar» desde `in_stock`)',
        mkOpts: { listPriceCents: null },
        initial: null,
        bodies: [
          { listPriceCents: 111111, status: 'listed' },
          { listPriceCents: 122222, status: 'listed' },
        ] as [any, any],
      },
    ];

    for (const v of variants) {
      it(`forzada — ${v.name}: un 200 y un 409, una fila con el «antes» inicial (N=${N})`, async () => {
        const fallos: string[] = [];
        for (let i = 0; i < N; i += 1) {
          const it0 = await mk('sealed', v.mkOpts);
          const res = await forced(it0.id, v.bodies);
          const { st, rows, s } = await verdict(it0.id, v.initial, res, v.bodies);
          const winner = res.findIndex((r) => r.status === 200);
          const ok =
            JSON.stringify(st) === JSON.stringify([200, 409]) &&
            res.find((r) => r.status === 409)?.body?.error?.code === 'CONFLICT' &&
            winner >= 0 &&
            s.listPriceCents === v.bodies[winner].listPriceCents &&
            rows.length === 1 &&
            (rows[0].before as any).listPriceCents === v.initial &&
            (rows[0].after as any).listPriceCents === v.bodies[winner].listPriceCents;
          if (!ok)
            fallos.push(
              `#${i}: ${JSON.stringify(st)} filas=${rows.length} antes=${rows
                .map((r) => (r.before as any).listPriceCents)
                .join('/')} final=${s.listPriceCents}`,
            );
        }
        expect({ rojas: fallos.length, de: N, fallos }).toEqual({ rojas: 0, de: N, fallos: [] });
      }, 120000);

      it(`suelta — ${v.name}: nunca dos filas con el mismo «antes» (N=${N}, se reporta la proporción)`, async () => {
        const fallos: string[] = [];
        const formas: Record<string, number> = {};
        for (let i = 0; i < N; i += 1) {
          const it0 = await mk('sealed', v.mkOpts);
          const res = await Promise.all(v.bodies.map((b) => patch(it0.id, b)));
          const { st, rows, s } = await verdict(it0.id, v.initial, res, v.bodies);
          const key = JSON.stringify(st);
          formas[key] = (formas[key] ?? 0) + 1;
          const befores = rows.map((r) => (r.before as any).listPriceCents);
          const afters = rows.map((r) => (r.after as any).listPriceCents);
          let ok = false;
          if (key === JSON.stringify([200, 409])) {
            ok = rows.length === 1 && befores[0] === v.initial && afters[0] === s.listPriceCents;
          } else if (key === JSON.stringify([200, 200])) {
            ok =
              rows.length === 2 &&
              befores[0] === v.initial &&
              befores[1] === afters[0] &&
              afters[1] === s.listPriceCents;
          }
          if (!ok)
            fallos.push(
              `#${i}: ${key} antes=${befores.join('/')} después=${afters.join('/')} final=${s.listPriceCents}`,
            );
        }
        // eslint-disable-next-line no-console
        console.log(`SFP-5 suelta (${v.name}) formas: ${JSON.stringify(formas)}`);
        expect({ rojas: fallos.length, de: N, fallos }).toEqual({ rojas: 0, de: N, fallos: [] });
      }, 120000);
    }
  });

  // ===========================================================================================
  describe('SFP-7 + SFP-9 — `pendingReason` en la cola y el dial sin caché', () => {
    const queue = async () => {
      const r = await h.api(
        'GET',
        `/admin/inventory/pending-publish?setId=${SET_ID}&pageSize=100`,
        { token: op },
      );
      expect(r.status).toBe(200);
      return new Map<string, any>(r.body.data.map((d: any) => [d.inventoryItemId, d]));
    };
    const ids: Partial<Record<string, string>> = {};

    beforeAll(async () => {
      await setDial(SEED_DIAL);
      ids.sir = (await mk('sir')).id;
      ids.noref = (await mk('noref')).id;
      ids.dr = (await mk('dr', { locationId: null })).id;
      ids.sealed = (await mk('sealed2')).id;
      ids.graded = (
        await mk('graded', { gradingCompany: null, gradeValue: null, certNumber: 'G-1' })
      ).id;
      // Entrada VIEJA abierta con otro motivo: la cola NO la lee (veredicto de hoy, no la fila).
      await h.prisma.pendingPriceEntry.create({
        data: {
          cardId: cardId('noref'),
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          status: 'open',
          context: 'inventory',
          reason: 'premium_at_floor',
        },
      });
    });

    it('SFP-7 — dial seed: los cinco motivos; el GET deja la cola de M2 idéntica', async () => {
      const before = await pendingSnapshot();
      const q = await queue();
      expect(q.get(ids.sir!)).toMatchObject({
        missing: ['price'],
        pendingReason: 'premium_at_floor',
      });
      expect(q.get(ids.noref!)).toMatchObject({ missing: ['price'], pendingReason: 'no_market' });
      expect(q.get(ids.dr!)).toMatchObject({
        missing: ['location'],
        pendingReason: null,
        priceBasis: 'floor',
        resolvedSalePriceCents: curve.sale.floorCents,
      });
      expect(q.get(ids.sealed!)).toMatchObject({ missing: ['price'], pendingReason: 'no_market' });
      expect(q.get(ids.graded!)).toMatchObject({
        missing: ['price'],
        pendingReason: null,
        pendingPriceEntryId: null,
      });
      expect(await pendingSnapshot()).toEqual(before);
    });

    it('SFP-9 — `PUT` del dial a `none` y GET INMEDIATO: la DR ya sale `premium_at_floor`', async () => {
      await setDial(NONE_DIAL);
      const before = await pendingSnapshot();
      const q = await queue();
      expect(q.get(ids.dr!)).toMatchObject({
        missing: ['location', 'price'],
        pendingReason: 'premium_at_floor',
      });
      expect(await pendingSnapshot()).toEqual(before);
    });

    it('SFP-9 — `PUT` inválido ⇒ 422 con `details.errors.premiumFloorSalePublish` (string) y NADA escrito', async () => {
      const before = await h.prisma.configSetting.findUnique({ where: { key: DIAL_KEY } });
      const r = await h.api('PUT', '/admin/settings', {
        token: admin,
        json: { premiumFloorSalePublish: { mode: 'only', rarities: [] } },
      });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(typeof r.body.error.details.errors.premiumFloorSalePublish).toBe('string');
      const after = await h.prisma.configSetting.findUnique({ where: { key: DIAL_KEY } });
      expect(after?.valueJson).toEqual(before?.valueJson);
      await setDial(SEED_DIAL);
    });
  });

  // ===========================================================================================
  describe('SFP-8 — precio derivado del sellado en `GET /admin/inventory/items`', () => {
    it('igual que la cola para la misma pieza; override con precio a mano; ausente en el resto', async () => {
      await h.prisma.priceReference.create({
        data: {
          cardId: cardId('sealed'),
          productType: 'sealed',
          gradeKey: `sealed:tcg:${SEALED_PID}`,
          finish: 'normal',
          source: 'manual',
          priceMxnCents: 150_000,
          capturedDate: new Date('2026-10-04T00:00:00.000Z'),
          isManualOverride: true,
        },
      });
      const derived = await mk('sealed', { locationId: null, tcgplayerProductId: SEALED_PID });
      const manual = await mk('sealed', { listPriceCents: 150000 });
      const reserved = await mk('sealed', { status: 'reserved', listPriceCents: 150000 });
      const customer = await mk('sealed', {
        ownerType: 'customer',
        ownerUserId: customerId,
        ownershipStatus: 'settled',
        status: 'in_custody',
      });
      const raw = await mk('common');
      const graded = await mk('graded', {
        gradingCompany: 'PSA',
        gradeValue: '10',
        certNumber: 'G-2',
      });

      const before = await pendingSnapshot();
      const list = await h.api(
        'GET',
        `/admin/inventory/items?cardId=${cardId('sealed')}&productType=sealed&pageSize=100`,
        { token: op },
      );
      expect(list.status).toBe(200);
      const byId = new Map<string, any>(list.body.data.map((d: any) => [d.id, d]));
      const q = await h.api(
        'GET',
        `/admin/inventory/pending-publish?setId=${SET_ID}&productType=sealed&pageSize=100`,
        { token: op },
      );
      const qRow = q.body.data.find((d: any) => d.inventoryItemId === derived.id);
      expect(qRow).toBeDefined();
      expect(qRow.resolvedSalePriceCents).toBeGreaterThan(0);
      expect({
        p: byId.get(derived.id).resolvedSalePriceCents,
        b: byId.get(derived.id).priceBasis,
      }).toEqual({
        p: qRow.resolvedSalePriceCents,
        b: qRow.priceBasis,
      });
      expect({
        p: byId.get(manual.id).resolvedSalePriceCents,
        b: byId.get(manual.id).priceBasis,
      }).toEqual({
        p: 150000,
        b: 'override',
      });
      for (const x of [reserved, customer]) {
        expect('resolvedSalePriceCents' in byId.get(x.id)).toBe(false);
        expect('priceBasis' in byId.get(x.id)).toBe(false);
      }
      for (const [x, slug] of [
        [raw, 'common'],
        [graded, 'graded'],
      ] as const) {
        const r = await h.api('GET', `/admin/inventory/items?cardId=${cardId(slug)}&pageSize=100`, {
          token: op,
        });
        const row = r.body.data.find((d: any) => d.id === x.id);
        expect('resolvedSalePriceCents' in row).toBe(false);
        expect('priceBasis' in row).toBe(false);
      }
      expect(await pendingSnapshot()).toEqual(before);
    });
  });

  // ===========================================================================================
  describe('SFP-10 ⭐ (v1.80.8.8) — el lote publica la pieza entre la lectura del `PATCH` y su CAS', () => {
    const P = 90000; // el precio que la pieza ya tiene (el lote lo respeta: `override`)
    const Q = 125000; // el que trae el `PATCH`

    beforeAll(async () => {
      await h.prisma.cardSet.create({
        data: { id: SFP10_SET, externalId: SFP10_SET, name: 'E2E SFP-10' },
      });
      await h.prisma.card.create({
        data: {
          id: SFP10_CARD,
          externalId: SFP10_CARD,
          setId: SFP10_SET,
          name: 'SFP sfp10',
          number: '1',
          rarity: 'Sealed',
          rarityCanonical: 'Sealed',
          availableFinishes: ['normal'],
        },
      });
      // Oráculo del «antes REAL»: cada `UPDATE` de una pieza de SFP-10 queda anotado con su viejo y su nuevo valor,
      // en el orden en que el motor los confirmó. ⛔ No se infiere de las respuestas HTTP: se lee de la BD.
      await h.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS sfp10_trace`);
      await h.prisma.$executeRawUnsafe(
        `CREATE TABLE sfp10_trace (seq bigserial PRIMARY KEY, item_id text NOT NULL, old_status text,
           new_status text, old_price int, new_price int)`,
      );
      await h.prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION sfp10_trace_fn() RETURNS trigger AS $$
        BEGIN
          INSERT INTO sfp10_trace (item_id, old_status, new_status, old_price, new_price)
          VALUES (NEW.id, OLD.status::text, NEW.status::text, OLD."listPriceCents", NEW."listPriceCents");
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await h.prisma.$executeRawUnsafe(
        `CREATE TRIGGER sfp10_trace AFTER UPDATE ON "InventoryItem" FOR EACH ROW
           WHEN (NEW."cardId" = '${SFP10_CARD}') EXECUTE FUNCTION sfp10_trace_fn()`,
      );
    });

    afterAll(async () => {
      await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sfp10_trace ON "InventoryItem"`);
      await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sfp10_trace_fn()`);
      await h.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS sfp10_trace`);
    });

    async function mkPiece() {
      seq += 1;
      return h.prisma.inventoryItem.create({
        data: {
          folio: `SFP10-${RUN}-${String(seq).padStart(4, '0')}`,
          cardId: SFP10_CARD,
          productType: 'sealed',
          sealedSubtype: 'box',
          sealedCondition: 'mint',
          finish: 'normal',
          acquisitionType: 'compra',
          ownerType: 'platform',
          status: 'in_stock',
          locationId: shelf,
          listPriceCents: P,
        } as never,
      });
    }

    const lote = () =>
      h.api('POST', '/admin/inventory/publish-all', {
        token: op,
        json: { setId: SFP10_SET, productType: 'sealed' },
      });
    const elPatch = (id: string) => patch(id, { listPriceCents: Q, status: 'listed' });
    const trace = (id: string) =>
      h.prisma.$queryRawUnsafe<
        { old_status: string; new_status: string; old_price: number | null; new_price: number | null }[]
      >(
        `SELECT old_status, new_status, old_price, new_price FROM sfp10_trace WHERE item_id = $1 ORDER BY seq`,
        id,
      );

    /**
     * Veredicto de UNA tirada. Formas admitidas:
     *  - `409`: el `PATCH` perdió ⇒ `CONFLICT`, cero filas, la pieza `listed` con P (la dejó el lote).
     *  - `200`: UNA fila cuyo `before` es lo que la pieza tenía DE VERDAD cuando el `PATCH` escribió (la fila del
     *    oráculo P→Q), `after = {listed, Q}`, y la pieza `listed` con Q.
     * ⛔ Rojo: cualquier otra cosa — en particular `200` con `before.status:'in_stock'` sobre una pieza que el lote ya
     * había dejado `listed` (lo que daba el CAS por conjunto).
     */
    async function verdict(id: string, pr: any, lr: any) {
      const rows = await audits(id);
      const s = await state(id);
      const t = await trace(id);
      const mine = t.filter((x) => x.old_price === P && x.new_price === Q);
      let forma = `patch=${pr.status}`;
      let ok = false;
      if (lr.status !== 200) {
        forma += `,lote=${lr.status}`;
      } else if (pr.status === 409) {
        ok =
          pr.body?.error?.code === 'CONFLICT' &&
          rows.length === 0 &&
          s.status === 'listed' &&
          s.listPriceCents === P &&
          mine.length === 0;
      } else if (pr.status === 200 && mine.length === 1 && rows.length === 1) {
        const b = rows[0].before as any;
        const a = rows[0].after as any;
        forma += `,antesReal=${mine[0].old_status}`;
        ok =
          b.status === mine[0].old_status &&
          b.listPriceCents === mine[0].old_price &&
          a.status === 'listed' &&
          a.listPriceCents === Q &&
          s.status === 'listed' &&
          s.listPriceCents === Q;
      }
      const tag = `${forma} filas=${rows.length} antes=${rows
        .map((r) => (r.before as any).status)
        .join('/')} traza=${t.map((x) => `${x.old_status}>${x.new_status}:${x.old_price}>${x.new_price}`).join('|')} final=${s.status}/${s.listPriceCents}`;
      return { ok, forma, tag };
    }

    it(`forzada — el lote se encola PRIMERO en el candado y el \`PATCH\` (que ya leyó \`in_stock\`) detrás: 409 CONFLICT y cero filas (N=${N})`, async () => {
      const fallos: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const it0 = await mkPiece();
        const candado = diferida();
        const soltar = diferida();
        const tx = h.prisma.$transaction(
          async (t) => {
            await t.$executeRawUnsafe(`SELECT id FROM "InventoryItem" WHERE id = $1 FOR UPDATE`, it0.id);
            candado.abrir();
            await soltar.promesa;
          },
          { timeout: 30000, maxWait: 30000 },
        );
        let pl: Promise<any> = Promise.resolve(null);
        let pp: Promise<any> = Promise.resolve(null);
        try {
          await candado.promesa;
          // 1) El lote: su `claimListed` (sin precio de línea) se bloquea en el `UPDATE` de la pieza — comprobado.
          pl = lote();
          await esperarBloqueoDeFila(h.prisma, 'InventoryItem', 1);
          // 2) El `PATCH`: su lectura NO espera (lee `in_stock`, el lote aún no confirma) y su CAS se encola DETRÁS
          //    del lote — comprobado.
          pp = elPatch(it0.id);
          await esperarBloqueoDeFila(h.prisma, 'InventoryItem', 2);
        } finally {
          soltar.abrir();
        }
        await tx;
        const [lr, pr] = await Promise.all([pl, pp]);
        const v = await verdict(it0.id, pr, lr);
        // En la forzada SOLO vale el 409, y el oráculo tiene que mostrar que el lote escribió primero.
        const t = await trace(it0.id);
        const loteFirst = t.length >= 1 && t[0].old_status === 'in_stock' && t[0].new_status === 'listed' && t[0].new_price === P;
        if (!(v.ok && pr.status === 409 && loteFirst && lr.body?.summary?.published >= 1))
          fallos.push(`#${i}: ${v.tag} publicadas=${lr.body?.summary?.published}`);
      }
      expect({ rojas: fallos.length, de: N, fallos }).toEqual({ rojas: 0, de: N, fallos: [] });
    }, 180000);

    it(`suelta — \`PATCH\` y lote a la vez: 409, o 200 con el «antes» REAL (N=${N}, se reporta la proporción)`, async () => {
      const fallos: string[] = [];
      const formas: Record<string, number> = {};
      for (let i = 0; i < N; i += 1) {
        const it0 = await mkPiece();
        const [pr, lr] = await Promise.all([elPatch(it0.id), lote()]);
        const v = await verdict(it0.id, pr, lr);
        formas[v.forma] = (formas[v.forma] ?? 0) + 1;
        if (!v.ok) fallos.push(`#${i}: ${v.tag}`);
      }
      // eslint-disable-next-line no-console
      console.log(`SFP-10 suelta formas (N=${N}): ${JSON.stringify(formas)}`);
      expect({ rojas: fallos.length, de: N, fallos }).toEqual({ rojas: 0, de: N, fallos: [] });
    }, 180000);
  });
});
