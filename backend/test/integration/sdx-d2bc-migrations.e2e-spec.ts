/**
 * sdx-d2bc-migrations.e2e-spec.ts — 💰🔒 M-67 (`M-SDX-E`, el folio) y M-68 (`M-GAS-1`) contra Postgres REAL.
 * Propiedad: backend.
 *
 * - PS-135 (a) / C-18: el folio nace de la secuencia por el DEFAULT (cero escritores en la app), único y `ENV-` + ≥ 6
 *   dígitos; el backfill de M-67 numera en orden `(requestedAt, id)` y es idempotente; con la secuencia en 999999 ⇒
 *   `ENV-999999` y luego `ENV-1000000` (⛔ sin truncar). El SQL que se ejercita es el TEXTO de la migración (sus
 *   sentencias, con los nombres de objeto cambiados a sondas de esta corrida): se prueba lo que se despliega.
 * - PS-160 (a)(b) / C-20: la marca inicial del dueño con 1, 2 y 0 candidatos; el índice parcial (≤ 1 dueño) y el CHECK
 *   `user_owner_shape` muerden.
 * - Los CHECKs de M-68 (§19.29.2/§19.30): el trío del 7b.2, la cancelación emparejada, la recompra con actor, la intención
 *   de cancelación solo en huérfanas/duplicados, `seen` emparejado, una sola fila de `SpendOwnerWatch`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2EHarness } from './helpers/e2e-app';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { SetOwnerRefused, setOwner } from '../../prisma/set-owner';

const RUN = `mig${Date.now().toString(36)}`;
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const sqlOf = (re: RegExp) => readFileSync(join(MIGRATIONS, readdirSync(MIGRATIONS).find((d) => re.test(d))!, 'migration.sql'), 'utf8');
const M67 = sqlOf(/_m67_sdx_e_folio$/);
const M68 = sqlOf(/_m68_gas_1_spend_control$/);
const code = (s: string) => s.replace(/--.*$/gm, '');
/** La sentencia del texto de la migración que empieza por `head` (hasta su `;` final, o `$$;` en bloques). */
function statement(sql: string, head: RegExp, end: RegExp = /;\s*$/m): string {
  const c = code(sql);
  const start = c.search(head);
  if (start < 0) throw new Error(`no encuentro ${head} en la migración`);
  const rest = c.slice(start);
  const m = end.exec(rest);
  if (!m) throw new Error(`sentencia sin fin: ${head}`);
  return rest.slice(0, m.index + m[0].length).trim();
}
const ROLLBACK = Symbol('rollback');

describe('💰🔒 M-67 / M-68 contra Postgres real', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    db = new ShipPrepDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    await db.cleanup();
    await h?.close();
  });

  describe('M-67 — el folio (PS-135 (a), C-18)', () => {
    it('un envío nuevo recibe el folio del DEFAULT de BD: `ENV-` + ≥ 6 dígitos, únicos y crecientes', async () => {
      const a = await db.mkDirect();
      const b = await db.mkDirect();
      const fa = (await db.shipment(a.shipment.id)).folio;
      const fb = (await db.shipment(b.shipment.id)).folio;
      expect(fa).toMatch(/^ENV-\d{6,}$/);
      expect(fb).toMatch(/^ENV-\d{6,}$/);
      expect(Number(fb.slice(4))).toBeGreaterThan(Number(fa.slice(4)));
      await expect(h.prisma.$executeRawUnsafe(`UPDATE "ShipmentRequest" SET "folio" = 'X-1' WHERE id = $1`, a.shipment.id)).rejects.toThrow(/shipment_folio_format/);
      await expect(h.prisma.$executeRawUnsafe(`UPDATE "ShipmentRequest" SET "folio" = $2 WHERE id = $1`, b.shipment.id, fa)).rejects.toThrow(/23505.*folio/);
    });

    it('la FUNCIÓN de la migración (su texto) no trunca: secuencia en 999999 ⇒ ENV-999999 y luego ENV-1000000', async () => {
      const seq = `m67_probe_seq_${RUN}`;
      const fn = `m67_probe_next_${RUN}`;
      const create = statement(M67, /CREATE OR REPLACE FUNCTION shipment_folio_next\(\)/, /\$\$;/).replace(/shipment_folio_seq/g, seq).replace(/shipment_folio_next/g, fn);
      await h.prisma.$executeRawUnsafe(`CREATE SEQUENCE ${seq} START 1`);
      try {
        await h.prisma.$executeRawUnsafe(create);
        await h.prisma.$queryRawUnsafe(`SELECT setval('${seq}', 999998)`);
        const rows = await h.prisma.$queryRawUnsafe<{ f: string }[]>(`SELECT ${fn}() AS f UNION ALL SELECT ${fn}()`);
        expect(rows.map((r) => r.f).sort()).toEqual(['ENV-1000000', 'ENV-999999']);
        const one = await h.prisma.$queryRawUnsafe<{ f: string }[]>(`SELECT ${fn}() AS f`);
        expect(one[0].f).toBe('ENV-1000001');
      } finally {
        await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
        await h.prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS ${seq}`);
      }
    });

    it('el BACKFILL de la migración (su texto) numera en orden (requestedAt, id), solo lo nulo, y repetido no cambia nada', async () => {
      const seq = `m67_probe_seq2_${RUN}`;
      const fn = `m67_probe_next2_${RUN}`;
      const tbl = `m67_probe_tbl_${RUN}`;
      const create = statement(M67, /CREATE OR REPLACE FUNCTION shipment_folio_next\(\)/, /\$\$;/).replace(/shipment_folio_seq/g, seq).replace(/shipment_folio_next/g, fn);
      const backfill = statement(M67, /DO \$\$\s*DECLARE r RECORD;/, /END \$\$;/).replace(/"ShipmentRequest"/g, `"${tbl}"`).replace(/shipment_folio_next/g, fn);
      await h.prisma.$executeRawUnsafe(`CREATE SEQUENCE ${seq} START 1`);
      await h.prisma.$executeRawUnsafe(`CREATE TABLE "${tbl}" (id text PRIMARY KEY, "requestedAt" timestamp(3) NOT NULL, folio text)`);
      try {
        await h.prisma.$executeRawUnsafe(create);
        // insertadas FUERA de orden; dos con el mismo instante (desempata el id)
        await h.prisma.$executeRawUnsafe(
          `INSERT INTO "${tbl}" (id, "requestedAt") VALUES ('c', '2026-01-03'), ('a', '2026-01-01'), ('z', '2026-01-02'), ('b', '2026-01-02')`,
        );
        await h.prisma.$executeRawUnsafe(backfill);
        const rows = await h.prisma.$queryRawUnsafe<{ id: string; folio: string }[]>(`SELECT id, folio FROM "${tbl}" ORDER BY folio`);
        expect(rows).toEqual([
          { id: 'a', folio: 'ENV-000001' },
          { id: 'b', folio: 'ENV-000002' },
          { id: 'z', folio: 'ENV-000003' },
          { id: 'c', folio: 'ENV-000004' },
        ]);
        await h.prisma.$executeRawUnsafe(backfill); // idempotente: solo toca `folio IS NULL`
        const again = await h.prisma.$queryRawUnsafe<{ id: string; folio: string }[]>(`SELECT id, folio FROM "${tbl}" ORDER BY folio`);
        expect(again).toEqual(rows);
      } finally {
        await h.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tbl}"`);
        await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
        await h.prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS ${seq}`);
      }
    });
  });

  describe('M-68 — la marca del dueño (PS-160 (a)(b), C-20)', () => {
    const MARK = statement(M68, /UPDATE "User" SET "isOwner" = true/);

    /** Corre `body` en una tx que SIEMPRE se deshace (la BD compartida queda como estaba). */
    async function inRolledBackTx(body: (tx: Parameters<Parameters<PrismaTx>[0]>[0]) => Promise<void>): Promise<void> {
      try {
        await h.prisma.$transaction(async (tx) => {
          await body(tx);
          throw ROLLBACK;
        });
      } catch (e) {
        if (e !== ROLLBACK) throw e;
      }
    }
    type PrismaTx = typeof h.prisma.$transaction extends (fn: infer F, ...a: never[]) => unknown ? (fn: F) => unknown : never;

    /** Deja EXACTAMENTE `n` candidatos (súper-admin activo con correo) y nadie marcado; devuelve sus ids. */
    async function candidates(tx: any, n: number): Promise<string[]> {
      await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = false WHERE "isOwner"`);
      await tx.$executeRawUnsafe(`UPDATE "User" SET status = 'blocked' WHERE role = 'super_admin' AND email IS NOT NULL AND status = 'active'`);
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const u = await tx.user.create({ data: { email: `own.${RUN}.${i}@e2e.local`, name: `Dueño ${i}`, role: 'super_admin', emailVerified: true } });
        ids.push(u.id);
      }
      return ids;
    }
    const marked = async (tx: any) => (await tx.user.findMany({ where: { isOwner: true }, select: { id: true } })).map((u: { id: string }) => u.id);

    it('1 candidato ⇒ marcado; 2 ⇒ nadie; 0 ⇒ nadie (⛔ nunca «el más antiguo»)', async () => {
      await inRolledBackTx(async (tx) => {
        const [only] = await candidates(tx, 1);
        await tx.$executeRawUnsafe(MARK);
        expect(await marked(tx)).toEqual([only]);
      });
      await inRolledBackTx(async (tx) => {
        await candidates(tx, 2);
        await tx.$executeRawUnsafe(MARK);
        expect(await marked(tx)).toEqual([]);
      });
      await inRolledBackTx(async (tx) => {
        await candidates(tx, 0);
        await tx.$executeRawUnsafe(MARK);
        expect(await marked(tx)).toEqual([]);
      });
    });

    it('re-aplicada con un dueño ya marcado (p. ej. por `set-owner.ts`) ⇒ no toca nada', async () => {
      await inRolledBackTx(async (tx) => {
        const [a] = await candidates(tx, 1);
        const op = await tx.user.create({ data: { email: `own.${RUN}.x@e2e.local`, name: 'Otro', role: 'super_admin', emailVerified: true, status: 'blocked' } });
        await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, op.id);
        await tx.$executeRawUnsafe(MARK);
        expect(await marked(tx)).toEqual([op.id]);
        expect(a).toBeDefined();
      });
    });

    it('índice parcial: un segundo dueño ⇒ error de base; CHECK: un operador marcado ⇒ error', async () => {
      // (cada violación en su propia tx: Postgres aborta la tx tras el primer error)
      await expect(
        h.prisma.$transaction(async (tx) => {
          const [a, b] = await candidates(tx, 2);
          await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, a);
          await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, b);
        }),
      ).rejects.toThrow(/23505.*isOwner/);
      await expect(
        h.prisma.$transaction(async (tx) => {
          const op = await tx.user.create({ data: { email: `own.${RUN}.op@e2e.local`, name: 'Op', role: 'vault_operator', emailVerified: true } });
          await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, op.id);
        }),
      ).rejects.toThrow(/user_owner_shape/);
      await expect(
        h.prisma.$transaction(async (tx) => {
          const [a] = await candidates(tx, 1);
          await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true, "deletedAt" = now() WHERE id = $1`, a);
        }),
      ).rejects.toThrow(/user_owner_shape/);
    });
  });

  describe('`prisma/set-owner.ts` (PS-160 (e), §19.30.1 (2))', () => {
    it('quita la marca anterior y pone la nueva en UNA tx, con bitácora; cuenta bloqueada / sin correo / inexistente ⇒ se niega sin cambios', async () => {
      const prev = (await h.prisma.user.findFirst({ where: { isOwner: true }, select: { id: true } }))?.id ?? null;
      const mk = (k: string, status: 'active' | 'blocked' = 'active') =>
        h.prisma.user.create({ data: { email: `so.${RUN}.${k}@e2e.local`, name: `SO ${k}`, role: 'super_admin', emailVerified: true, status } });
      const a = await mk('a');
      const b = await mk('b');
      const blocked = await mk('c', 'blocked');
      const op = await h.prisma.user.create({ data: { email: `so.${RUN}.op@e2e.local`, name: 'SO op', role: 'vault_operator', emailVerified: true } });
      try {
        const r1 = await setOwner(h.prisma, { OWNER_EMAIL: ` SO.${RUN}.A@e2e.local ` });
        expect(r1).toEqual({ ownerUserId: a.id, previousOwnerUserId: prev, changed: true });
        const r2 = await setOwner(h.prisma, { OWNER_EMAIL: `so.${RUN}.b@e2e.local` });
        expect(r2).toEqual({ ownerUserId: b.id, previousOwnerUserId: a.id, changed: true });
        expect((await h.prisma.user.findMany({ where: { isOwner: true }, select: { id: true } })).map((u) => u.id)).toEqual([b.id]);
        const log = await h.prisma.auditLog.findFirst({ where: { action: 'user.owner_set', entityId: b.id }, orderBy: { createdAt: 'desc' } });
        expect(log).toMatchObject({ actorUserId: null, after: { previousOwnerUserId: a.id, actor: 'script:set-owner' } });
        for (const bad of [`so.${RUN}.c@e2e.local`, `so.${RUN}.op@e2e.local`, `nadie.${RUN}@e2e.local`, '']) {
          await expect(setOwner(h.prisma, { OWNER_EMAIL: bad })).rejects.toBeInstanceOf(SetOwnerRefused);
        }
        expect((await h.prisma.user.findMany({ where: { isOwner: true }, select: { id: true } })).map((u) => u.id)).toEqual([b.id]);
        expect(blocked.id).toBeDefined();
        expect(op.id).toBeDefined();
      } finally {
        await h.prisma.user.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
        if (prev) await h.prisma.user.update({ where: { id: prev }, data: { isOwner: true } });
        await h.prisma.auditLog.deleteMany({ where: { action: 'user.owner_set', entityId: { in: [a.id, b.id] } } });
        await h.prisma.user.deleteMany({ where: { id: { in: [a.id, b.id, blocked.id, op.id] } } });
      }
    });
  });

  describe('M-68 — CHECKs de los libros y los avisos (§19.29.2, §19.30)', () => {
    it('intento: el trío del 7b.2 va junto; `attemptNo` 1..99; `pending` sin `outcomeAt`; cargo ≥ 0', async () => {
      const d = await db.mkDirect();
      const ins = (cols: string) =>
        h.prisma.$executeRawUnsafe(
          `INSERT INTO "ShipmentLabelAttempt" (id, "shipmentRequestId", since, "actorUserId", "capExempt", "rateId", "carrierName", "expectedChargeCents", "marginCents"${cols ? ', ' + cols.split('=')[0] : ''}) VALUES (gen_random_uuid()::text, $1, now(), 'u', false, 'r', 'c', 100, 1${cols ? ', ' + cols.split('=')[1] : ''})`,
          d.shipment.id,
        );
      await expect(ins(`"sentAt"=now()`)).rejects.toThrow(/label_attempt_sent_triplet/);
      await expect(ins(`"attemptNo"=100`)).rejects.toThrow(/label_attempt_no_range|label_attempt_sent_triplet/);
      await expect(
        h.prisma.$executeRawUnsafe(
          `INSERT INTO "ShipmentLabelAttempt" (id, "shipmentRequestId", since, "actorUserId", "capExempt", "rateId", "carrierName", "expectedChargeCents", "marginCents", outcome, "outcomeAt") VALUES (gen_random_uuid()::text, $1, now(), 'u', false, 'r', 'c', 100, 1, 'pending', now())`,
          d.shipment.id,
        ),
      ).rejects.toThrow(/label_attempt_pending_without_outcome_at/);
      await expect(
        h.prisma.$executeRawUnsafe(
          `INSERT INTO "ShipmentLabelAttempt" (id, "shipmentRequestId", since, "actorUserId", "capExempt", "rateId", "carrierName", "expectedChargeCents", "marginCents") VALUES (gen_random_uuid()::text, $1, now(), 'u', false, 'r', 'c', -1, 1)`,
          d.shipment.id,
        ),
      ).rejects.toThrow(/label_attempt_expected_charge_nonneg/);
      // ⛔ el envío con un intento no se borra (RESTRICT: registro de dinero)
      await h.prisma.shipmentLabelAttempt.create({
        data: { shipmentRequestId: d.shipment.id, since: new Date(), actorUserId: 'u', capExempt: false, rateId: 'r', carrierName: 'c', expectedChargeCents: 1, marginCents: 0 },
      });
      await expect(h.prisma.$executeRawUnsafe(`DELETE FROM "ShipmentRequest" WHERE id = $1`, d.shipment.id)).rejects.toThrow(/ShipmentLabelAttempt_shipmentRequestId_fkey|foreign key/);
    });

    it('guía pagada: cancelación emparejada; `reissue` con actor; intención de cancelación solo en huérfanas/duplicados; cargo ≥ 0', async () => {
      const base = (extra: string, vals: string) =>
        h.prisma.$executeRawUnsafe(
          `INSERT INTO "ShipmentPaidLabel" (id, "providerShipmentId", "shipmentRequestId", origin, "chargedCents"${extra}) VALUES (gen_random_uuid()::text, gen_random_uuid()::text, 's', ${vals})`,
        );
      await expect(base(`, "cancelledAt"`, `'response', 1, now()`)).rejects.toThrow(/paid_label_cancel_paired/);
      await expect(base(`, "cancelledAt", "cancelKind"`, `'response', 1, now(), 'reissue'`)).rejects.toThrow(/paid_label_reissue_has_actor/);
      await expect(base(`, "autoCancelIntentAt"`, `'response', 1, now()`)).rejects.toThrow(/paid_label_auto_cancel_intent_orphans_only/);
      await expect(base(``, `'response', -1`)).rejects.toThrow(/paid_label_charged_nonneg/);
      await expect(base(`, "unrefundedCents"`, `'response', 1, -1`)).rejects.toThrow(/paid_label_unrefunded_nonneg/);
    });

    it('aviso: `seen` emparejado y `occurrenceCount ≥ 1`; `SpendOwnerWatch` admite solo la fila 1', async () => {
      await expect(
        h.prisma.$executeRawUnsafe(`INSERT INTO "SpendAlert" (id, kind, severity, "dedupKey", facts, "mailStatus", "seenAt") VALUES (gen_random_uuid()::text, 'label_cap_warning', 'digest', 'k-${RUN}', '{}', 'not_applicable', now())`),
      ).rejects.toThrow(/spend_alert_seen_paired/);
      await expect(
        h.prisma.$executeRawUnsafe(`INSERT INTO "SpendAlert" (id, kind, severity, "dedupKey", facts, "mailStatus", "occurrenceCount") VALUES (gen_random_uuid()::text, 'label_cap_warning', 'digest', 'k2-${RUN}', '{}', 'not_applicable', 0)`),
      ).rejects.toThrow(/spend_alert_occurrence_min_1/);
      await expect(h.prisma.$executeRawUnsafe(`INSERT INTO "SpendOwnerWatch" (id, "observedAt") VALUES (2, now())`)).rejects.toThrow(/spend_owner_watch_single_row/);
    });

    it('los diez diales de §19.29.8 están en la base tras migrar (o con su default), `skydropxLowBalanceCents` = 100000', async () => {
      const r = await h.api('GET', '/admin/settings', { token: db.adminToken });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        operatorLabelCap24hCents: 250000,
        shippingLabelReissueMaxPerShipment: 1,
        spendAlertsDisabled: [],
        spendAlertLabelCapWarnPct: 80,
        spendAlertShipmentCancelCount: 2,
        spendAlertPersonCancelCount24h: 3,
        spendAlertChargeDriftImmediateCents: 2000,
        spendAlertExtraChargeImmediateCents: 15000,
        spendAlertCancelRefundDays: 3,
        spendAlertLabelNotShippedDays: 3,
        skydropxLowBalanceCents: 100000,
      });
    });
  });
});
