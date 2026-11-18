import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Finish, Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { headingRow, mailShell, proseRow, spacerRow } from '../buylist/mail-shell';
import { ownerRecipients } from '../spend-alerts/spend-mail.service';
import { FinishReconciler } from '../catalog/finish-reconciler.service';
import { isVariantProductName, productPreferenceOf, VARIANT_PRODUCT_PREFILTER_LIKE } from '../../common/variant-product';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { loadEffectiveVariantRows, loadNonRawCandidateIds, loadPreVariantCombos, loadReaderBaseRows } from './effective-variant';
import { PATTERN_RUN_MAX, PatternPlan, PlannedCombo, planPatternRun } from './pattern-plan';
import { classifyCardProductKind } from './providers/tcgcsv-singles.provider';
import { variantKey } from '../../common/variant-key';
import { MONEY_REF_WHERE, PricingService } from './pricing.service';
import { ListingPriceService } from './listing-price.service';
import { lockPriceWriteExclusive } from './price-write-lock';
import { PATTERN_QUARANTINE_DAYS, PATTERN_QUARANTINE_REASONS_MAX, PATTERN_QUARANTINE_REPORT_MAX, QuarantineEntry, QuarantineMap, cardSig, isQuarantineActive, readQuarantine, writeQuarantine } from './pattern-quarantine';

/** Máximo de ítems del informe `pricing.pattern_reclassify_run` (6.3) y de los «mayores» que lleva el correo. */
export const PATTERN_ITEMS_MAX = 500;
export const PATTERN_MAIL_TOP = 20;
/** Auto-pausa (6.2): este número de corridas SEGUIDAS con diferidos y la lista creciendo; la pausa dura {@link PATTERN_PAUSE_DAYS} y se reanuda sola. */
export const PATTERN_PAUSE_STREAK = 3;
export const PATTERN_PAUSE_DAYS = 3;
export { PATTERN_RUN_MAX };
/** Candado consultivo del job (single-flight, 4b-i; 6.6: se toma POR LOTE, `pg_try_advisory_xact_lock`): una instancia a la vez. Censo: `lock-keys.census.spec.ts`. */
export const PATTERN_RECLASSIFY_LOCK_KEY = 91_170_217;
/** 6.6 (1): un lote de la prueba son ≤ 50 cartas en UNA transacción de ≤ 60 s (el candado de precios jamás vive más). */
export const PATTERN_BATCH_CARDS = 50;
export const PATTERN_BATCH_TX_TIMEOUT_MS = 60_000;

type Combo = { cardId: string; finish: Finish };
type RefSnap = { cardId: string; productType: ProductType; gradeKey: string; finish: Finish; cents: number | null };
/** Bajada de la referencia raw NM de un combo, MEDIDA antes/después de la prueba (misma lectura en vivo, dentro de la transacción del lote). */
type Measured = { cardId: string; finish: Finish; fromCents: number; toCents: number };
type Rejected = { cardId: string; reasons: string[]; sig: string };
type BatchOutcome = { skipped: true } | { skipped: false; measured: Measured[]; rejected: Rejected[] };

export interface PatternRunOpts {
  /** Freno por corrida (por defecto {@link PATTERN_RUN_MAX}). */
  max?: number;
  now?: Date;
  /** Cartas por lote de la prueba (por defecto {@link PATTERN_BATCH_CARDS}). */
  batchSize?: number;
  /** Tiempo máximo de la transacción de un lote (por defecto {@link PATTERN_BATCH_TX_TIMEOUT_MS}); se acorta solo en pruebas. */
  batchTimeoutMs?: number;
}

export interface PatternReclassifyResult {
  /** `true` ⇒ otra corrida tenía el candado: esta salió sin hacer nada. */
  skipped?: boolean;
  /** `true` ⇒ el job está auto-pausado (6.2): esta corrida no hizo nada. */
  paused?: boolean;
  /** Productos `set_base|other` cuyo nombre coincide con «(… Pattern/Ball/Energy Symbol)» (candidatos). */
  candidates: number;
  /** Productos reclasificados a `variant` y CONFIRMADOS (commit) en esta corrida. */
  reclassified: number;
  /** Combinaciones carta×acabado EXPUESTAS (hay base con precio fresco y la versión vale > 1.5×): aplicadas + diferidas. */
  combosExposed: number;
  /** Combos que se corrigieron DE VERDAD (bajada de la referencia medida en la prueba, no el plan): ≤ {@link PATTERN_RUN_MAX}. */
  applied: number;
  /** Combos que el plan quería aplicar ahora (≥ `applied`: un override manual o un rechazo de la prueba los dejan sin cambio real). */
  planned: number;
  /** Cartas cuya prueba falló en ESTA corrida (nueva cuarentena): el lote las revirtió dentro de la transacción, nadie vio nada. */
  trialRejected: number;
  /** Cartas en cuarentena ACTIVA al terminar (rechazadas ahora o antes, con la misma firma y < 7 días). */
  quarantined: number;
  /** Hasta {@link PATTERN_QUARANTINE_REPORT_MAX} cartas en cuarentena activa con sus motivos. */
  quarantinedCards: { cardId: string; reasons: string[] }[];
  /** Lotes que lanzaron una excepción o excedieron su tiempo: ROLLBACK completo, sus cartas se reintentan la siguiente corrida (sin cuarentena). */
  failedBatches: number;
  /** Combos expuestos que esperan a la siguiente corrida (freno fijo). */
  deferred: number;
  /** Combos en cuarentena del PLAN (base vencida / sin base fresca / razón ≤ 1.5): el precio se conserva. */
  held: number;
  /** Combinaciones cuyo PRECIO PUBLICADO (`ListingPrice`) cambió tras confirmar y quedaron auditadas `pricing.pattern_correction`. */
  corrections: number;
  /** Combinaciones (carta×acabado) sin precio automático por ambigüedad real de producto. */
  ambiguous: number;
}

const PATTERN_QUARANTINE_DAYS_MS = PATTERN_QUARANTINE_DAYS * 86_400_000;

function chunksOf<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const emptyResult = (): PatternReclassifyResult => ({
  candidates: 0, reclassified: 0, combosExposed: 0, applied: 0, planned: 0, trialRejected: 0, quarantined: 0, quarantinedCards: [], failedBatches: 0, deferred: 0, held: 0, corrections: 0, ambiguous: 0,
});

/**
 * §PRICE-PATTERN v2.1 (docs/DECISIONES.md puntos 6 y 6.6) — job `pattern-reclassify`, IDEMPOTENTE, al desplegar y diario. TODO AUTOMÁTICO (sin dial, sin aprobación).
 *  1. Candidatos: `CardProduct set_base|other` cuyo NOMBRE termina en «(… Pattern|Ball|Energy Symbol)» (clasificador único).
 *  2. Plan puro (`planPatternRun`): por carta×acabado, un candidato solo se reclasifica si (a) es el ÚNICO producto con precio de ese acabado (queda como
 *     base: la lectura lo usa, 6.1) o (b) hay base fresca con precio y el candidato vale > 1.5× ⇒ combo EXPUESTO, se BAJA a la base. Cuarentena del plan: base
 *     sin precio fresco, razón ≤ 1.5 o base ambigua ⇒ no se toca. Freno FIJO {@link PATTERN_RUN_MAX}: aplica los de mayor razón, difiere el resto.
 *  3. PRUEBA SIN PUBLICAR (6.6): por lote de ≤ 50 cartas, UNA transacción de ≤ 60 s que (a) toma el candado COMPARTIDO con la ingesta
 *     (`PRICE_WRITE_LOCK_KEY`, exclusivo), (b) mide «antes» con la lectura EN VIVO (FX y mediana, nunca `priceMxnCents` congelado), (c) hace el flip de `kind`,
 *     (d) mide «después» con la MISMA lectura y (e) revierte SOLO la carta que viola «solo baja, nunca sin precio» y la manda a cuarentena. Cualquier excepción
 *     ⇒ ROLLBACK de todo el lote (no existe «flip sin medir»); hasta el COMMIT nadie ve nada. Después del commit: `availableFinishes`, `reprice` (BullMQ) y la
 *     auditoría `pricing.pattern_correction` por cada precio PUBLICADO que cambió, solo de las cartas confirmadas.
 *  4. Cuarentena persistente (`pattern-quarantine.ts`, fila `ConfigSetting`): la carta rechazada se reintenta solo si cambia su firma (precios/FX) o a los 7 días.
 *     Sin correo ni `pattern_trial_rejected` repetidos; suma a la racha de auto-pausa.
 *  5. Informe (6.3/6.6): `pricing.pattern_reclassify_run {applied (medidos), deferred, exposed, planned, trialRejected, quarantined, quarantinedCards≤50, items≤500,
 *     truncated}`; correo al dueño solo si `applied ≥ 1` o `deferred ≥ 1`.
 *  6. Auto-pausa (6.2): {@link PATTERN_PAUSE_STREAK} corridas seguidas con (diferidos + cuarentenas activas) CRECIENTES ⇒ `pricing.pattern_reclassify_paused` + alerta;
 *     reanuda sola tras {@link PATTERN_PAUSE_DAYS} días.
 *  7. Audita `pricing.product_ambiguous` (≥ 2 productos «del montón» con precios que difieren > 25 % junto a un `variant`), una vez por semana y combinación.
 * ⛔ No toca precios, inventario ni dinero directamente: solo la clase de un producto; el precio sale de la lectura de siempre.
 */
@Injectable()
export class PatternReclassifyService {
  private readonly logger = new Logger(PatternReclassifyService.name);
  /** Single-flight dentro del proceso (la segunda instancia la ataja el `pg_try_advisory_xact_lock` de cada lote). */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly finishReconciler: FinishReconciler,
    @Optional() private readonly listingPrices?: ListingPriceService,
    @Optional() private readonly audit?: AuditService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  /** El único dial que queda: `pattern_classify_enabled` (on|off). Sin servicio de ajustes ⇒ encendido. */
  private async enabled(): Promise<boolean> {
    try {
      if (this.settings) return (await this.settings.getString(SettingKey.PATTERN_CLASSIFY_ENABLED)) !== 'off';
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo leer pattern_classify_enabled (se usa «on»): ${(e as Error).message}`);
    }
    return true;
  }

  /**
   * Una corrida a la vez por proceso (`running`) y, entre instancias, por LOTE (`pg_try_advisory_xact_lock` dentro de la transacción del lote): la segunda
   * instancia no obtiene el candado y sale sin hacer nada (`skipped`). Ya no hay una transacción de 25 minutos sosteniendo el candado (PP-11).
   */
  async run(opts: PatternRunOpts = {}): Promise<PatternReclassifyResult> {
    if (this.running) {
      this.logger.warn('pattern-reclassify: ya hay una corrida en curso; esta sale sin hacer nada.');
      return { ...emptyResult(), skipped: true };
    }
    this.running = true;
    try {
      return await this.runInner(opts);
    } finally {
      this.running = false;
    }
  }

  /** Una transacción de lote: candado del job (try) + candado de precios (exclusivo, compartido con la ingesta) y luego `fn`. */
  private inBatchTx<T>(timeoutMs: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<{ skipped: true } | { skipped: false; value: T }> {
    return this.prisma.$transaction(
      async (tx) => {
        const got = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${PATTERN_RECLASSIFY_LOCK_KEY}::bigint) AS ok`;
        if (got[0]?.ok !== true) return { skipped: true as const };
        await lockPriceWriteExclusive(tx);
        return { skipped: false as const, value: await fn(tx) };
      },
      { timeout: timeoutMs, maxWait: 5_000 },
    );
  }

  private async runInner(opts: PatternRunOpts): Promise<PatternReclassifyResult> {
    const max = opts.max ?? PATTERN_RUN_MAX;
    const now = opts.now ?? new Date();
    const batchSize = Math.max(1, opts.batchSize ?? PATTERN_BATCH_CARDS);
    const timeoutMs = opts.batchTimeoutMs ?? PATTERN_BATCH_TX_TIMEOUT_MS;
    const out = emptyResult();

    // REVERSA FUNCIONAL (flag apagado): `variant → set_base` y la lectura vuelve al comportamiento previo. Sin freno: es decisión explícita del dueño.
    if (!(await this.enabled())) {
      const back = await this.prisma.cardProduct.findMany({ where: { kind: 'variant' }, select: { id: true, cardId: true } });
      out.candidates = back.length;
      const byCard = new Map<string, string[]>();
      for (const b of back) byCard.set(b.cardId, [...(byCard.get(b.cardId) ?? []), b.id]);
      for (const chunk of chunksOf([...byCard.keys()].sort(), batchSize)) {
        const ids = chunk.flatMap((c) => byCard.get(c)!);
        const before = await this.publishedPrices(chunk);
        try {
          const r = await this.inBatchTx(timeoutMs, (tx) => tx.cardProduct.updateMany({ where: { id: { in: ids } }, data: { kind: 'set_base' } }));
          if (r.skipped) return { ...out, skipped: true };
        } catch (e) {
          out.failedBatches += 1;
          this.logger.error(`pattern-reclassify: lote de reversa falló (ROLLBACK): ${(e as Error).message}`);
          continue;
        }
        out.reclassified += ids.length;
        out.corrections += await this.settle(chunk, before);
      }
      return out;
    }

    // Auto-pausa vigente (6.2): no hace nada hasta que pase la ventana (se reanuda sola).
    const pausedSince = new Date(now.getTime() - PATTERN_PAUSE_DAYS * 86_400_000);
    if (await this.prisma.auditLog.findFirst({ where: { action: 'pricing.pattern_reclassify_paused', createdAt: { gte: pausedSince } }, select: { id: true } })) {
      this.logger.warn('pattern-reclassify: AUTO-PAUSADO (anomalía de la fuente); se reanuda solo.');
      return { ...out, paused: true };
    }

    // Candidatos: pre-filtro SQL barato (superconjunto) y decisión en el CLASIFICADOR ÚNICO (promo/deck_exclusive mandan, normalización de acentos).
    const pre = await this.prisma.$queryRaw<{ id: string; cardId: string; name: string }[]>(Prisma.sql`
      SELECT "id", "cardId", "name" FROM "CardProduct"
      WHERE "kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind")
        AND "name" ILIKE ANY (${VARIANT_PRODUCT_PREFILTER_LIKE as string[]})`);
    const cand = pre.filter((p) => classifyCardProductKind(p.name) === 'variant' && isVariantProductName(p.name));
    out.candidates = cand.length;
    const candCards = new Set(cand.map((c) => c.cardId));
    const confirmedCards = new Set<string>();
    const rejectedNow = new Map<string, Rejected>();
    let plan: PatternPlan | null = null;
    let measured: Measured[] = [];
    const quarantineBefore = await readQuarantine(this.prisma);

    if (cand.length > 0) {
      const allIds = cand.map((c) => c.id);
      const cardIds = [...candCards];
      const fx = await this.pricing.fxSnapshotSafe(); // UNA lectura de FX por corrida: la firma y las dos mediciones de cada lote usan la misma
      const dials = await this.pricing.loadArbiterDialsSafe();
      const rowsAll = await loadEffectiveVariantRows(this.prisma, cardIds, { productTypes: ['raw'], gradeKeys: ['raw:NM'], hypotheticalVariantIds: allIds });
      // La firma de cada carta se calcula con TODAS sus filas vigentes (cualquier tipo/grado: la prueba mide todos).
      const sigRows = await loadEffectiveVariantRows(this.prisma, cardIds, { hypotheticalVariantIds: allIds });
      const sigRowsByCard = new Map<string, typeof sigRows>();
      for (const r of sigRows) sigRowsByCard.set(r.cardId, [...(sigRowsByCard.get(r.cardId) ?? []), r]);
      const sigs = new Map<string, string>(cardIds.map((c) => [c, cardSig(sigRowsByCard.get(c) ?? [], fx, dials)]));
      // CUARENTENA ACTIVA (6.6 (2)): misma firma y < 7 días ⇒ ni se planea ni se prueba (cero trabajo, cero correo, cero auditoría de rechazo).
      const skipCards = new Set(cardIds.filter((c) => isQuarantineActive(quarantineBefore[c], sigs.get(c)!, now)));
      const candIds = new Set(cand.filter((c) => !skipCards.has(c.cardId)).map((c) => c.id));
      const planCards = cardIds.filter((c) => !skipCards.has(c));
      if (candIds.size > 0) {
        const rows = rowsAll.filter((r) => !skipCards.has(r.cardId));
        // Lo que la lectura REAL conservaría de la base (sin colapsar por producto, con manual) y los candidatos con precio fuera de raw NM.
        const readerBase = await loadReaderBaseRows(this.prisma, planCards, [...candIds]);
        const nonRaw = await loadNonRawCandidateIds(this.prisma, [...candIds]);
        const preVariantCombos = await loadPreVariantCombos(this.prisma, planCards, [...candIds]);
        plan = planPatternRun(rows, candIds, now, max, readerBase, nonRaw, preVariantCombos);
        out.combosExposed = plan.applied.length + plan.deferred.length;
        out.planned = plan.applied.length;
        out.deferred = plan.deferred.length;
        out.held = plan.held;
        const flipSet = new Set(plan.flipIds);
        const flipByCard = new Map<string, string[]>();
        for (const c of cand) if (flipSet.has(c.id)) flipByCard.set(c.cardId, [...(flipByCard.get(c.cardId) ?? []), c.id]);
        for (const chunk of chunksOf([...flipByCard.keys()].sort(), batchSize)) {
          const ids = chunk.flatMap((c) => flipByCard.get(c)!);
          const listingBefore = await this.publishedPrices(chunk);
          let r: { skipped: true } | { skipped: false; value: BatchOutcome };
          try {
            r = await this.inBatchTx(timeoutMs, (tx) => this.trialBatch(tx, ids, chunk, fx, sigs, now));
          } catch (e) {
            // Excepción o más de 60 s ⇒ ROLLBACK de TODO el lote (no hubo flip visible ni cuarentena): se reintenta la siguiente corrida.
            out.failedBatches += 1;
            this.logger.error(`pattern-reclassify: lote de ${chunk.length} carta(s) falló y se REVIRTIÓ entero (ROLLBACK): ${(e as Error).message}`);
            continue;
          }
          if (r.skipped) {
            this.logger.warn('pattern-reclassify: otra instancia tiene el candado del job; esta sale sin hacer nada.');
            return { ...out, skipped: true };
          }
          const b = r.value as unknown as BatchOutcome & { skipped: false };
          const bad = new Set(b.rejected.map((x) => x.cardId));
          for (const x of b.rejected) rejectedNow.set(x.cardId, x);
          const ok = chunk.filter((c) => !bad.has(c));
          for (const c of ok) confirmedCards.add(c);
          out.reclassified += ok.reduce((n, c) => n + (flipByCard.get(c)?.length ?? 0), 0);
          measured = measured.concat(b.measured);
          out.corrections += await this.settle(ok, listingBefore);
        }
        measured.sort((x, y) => y.fromCents / y.toCents - x.fromCents / x.toCents || x.cardId.localeCompare(y.cardId));
        out.applied = measured.length;
      }
    }

    // Memoria de cuarentena al cierre: solo siguen las cartas que aún son candidatas (no confirmadas) y vigentes; lo demás se poda.
    const qFinal = await readQuarantine(this.prisma);
    const keep: QuarantineMap = {};
    for (const [cardId, e] of Object.entries(qFinal)) {
      if (candCards.has(cardId) && !confirmedCards.has(cardId) && now.getTime() - Date.parse(e.at) < PATTERN_QUARANTINE_DAYS_MS) keep[cardId] = e;
    }
    if (Object.keys(keep).length !== Object.keys(qFinal).length) await writeQuarantine(this.prisma, keep);
    out.trialRejected = rejectedNow.size;
    out.quarantined = Object.keys(keep).length;
    out.quarantinedCards = Object.entries(keep).slice(0, PATTERN_QUARANTINE_REPORT_MAX).map(([cardId, e]) => ({ cardId, reasons: e.reasons }));
    // Auditoría por carta SOLO en la 1.ª cuarentena o cuando la firma cambió y vuelve a fallar (6.6 (4)); jamás repetida con la misma firma.
    for (const x of rejectedNow.values()) {
      if (quarantineBefore[x.cardId]?.sig === x.sig) continue;
      await this.audit
        ?.log({ action: 'pricing.pattern_trial_rejected', entityType: 'Card', entityId: x.cardId, after: { cardId: x.cardId, reasons: x.reasons, sig: x.sig } })
        .catch((e: Error) => this.logger.warn(`pattern-reclassify: no se pudo auditar el rechazo de ${x.cardId}: ${e.message}`));
    }
    this.logger.log(
      `pattern-reclassify: ${cand.length} candidatos; ${out.reclassified} → variant (confirmados); expuestas ${out.combosExposed} (planeadas ${out.planned}, corregidas medidas ${out.applied}, diferidas ${out.deferred}); ` +
        `cuarentena del plan ${out.held}; prueba rechazó ${out.trialRejected} carta(s) (activas en cuarentena ${out.quarantined}); lotes fallidos ${out.failedBatches}; ${out.corrections} con precio publicado distinto.`,
    );
    if (plan && (out.applied + out.deferred + out.trialRejected > 0)) await this.report(plan, now, measured, out);

    // Red de seguridad (6.1): productos que el import ya creó como `variant` (patrón único) y cuyo precio llegó después: su acabado entra a
    // `availableFinishes` sin esperar un re-sync. Idempotente (el reconciliador solo escribe si cambia).
    const withVariant = await this.prisma.cardProduct.findMany({ where: { kind: 'variant' }, select: { cardId: true }, distinct: ['cardId'] });
    if (withVariant.length > 0) await this.finishReconciler.reconcile(withVariant.map((v) => v.cardId));

    out.ambiguous = await this.auditAmbiguities();
    return out;
  }

  /**
   * LA PRUEBA de un lote (6.6 (1)), DENTRO de la transacción `tx` (que ya tiene el candado del job y el de precios): mide «antes», hace el flip de `kind`, mide
   * «después» con la MISMA lectura en vivo (`getReferencesBatch` con el cliente `tx` y el FX fijo de la corrida) y revierte SOLO las cartas que violan «solo
   * baja, nunca sin precio»; esas pasan a cuarentena (misma transacción). Nada de esto es visible fuera hasta el COMMIT; cualquier excepción ⇒ ROLLBACK.
   */
  private async trialBatch(
    tx: Prisma.TransactionClient,
    ids: string[],
    cardIds: string[],
    fx: { rate: number; bufferPct: number } | null,
    sigs: Map<string, string>,
    now: Date,
  ): Promise<BatchOutcome> {
    const prev = await tx.cardProduct.findMany({ where: { id: { in: ids } }, select: { id: true, cardId: true, kind: true } });
    const combos = await tx.priceReference.groupBy({
      by: ['cardId', 'productType', 'gradeKey', 'finish'],
      where: { cardId: { in: cardIds }, ...MONEY_REF_WHERE },
    });
    const read = async (): Promise<Map<string, RefSnap>> => {
      const got = await this.pricing.getReferencesBatch(combos.map((c) => ({ cardId: c.cardId, productType: c.productType, gradeKey: c.gradeKey, finish: c.finish })), { client: tx, fx });
      const m = new Map<string, RefSnap>();
      for (const c of combos) {
        const r = got.get(variantKey(c));
        m.set(variantKey(c), { cardId: c.cardId, productType: c.productType, gradeKey: c.gradeKey, finish: c.finish, cents: r?.status === 'priced' ? (r.referenceMxnCents ?? null) : null });
      }
      return m;
    };
    const before = await read();
    await tx.cardProduct.updateMany({ where: { id: { in: ids } }, data: { kind: 'variant' } });
    const after = await read();
    const bad = this.assess(before, after);
    if (bad.size > 0) {
      const back = prev.filter((p) => bad.has(p.cardId));
      for (const k of new Set(back.map((p) => p.kind))) await tx.cardProduct.updateMany({ where: { id: { in: back.filter((p) => p.kind === k).map((p) => p.id) } }, data: { kind: k } });
      const q = await readQuarantine(tx);
      for (const [cardId, reasons] of bad) q[cardId] = { sig: sigs.get(cardId) ?? '', at: now.toISOString(), reasons: reasons.slice(0, PATTERN_QUARANTINE_REASONS_MAX) } satisfies QuarantineEntry;
      await writeQuarantine(tx, q);
    }
    const measured: Measured[] = [];
    for (const [k, b] of before) {
      const a = after.get(k);
      if (bad.has(b.cardId) || b.productType !== 'raw' || b.gradeKey !== 'raw:NM' || b.cents == null || a?.cents == null || a.cents >= b.cents) continue;
      measured.push({ cardId: b.cardId, finish: b.finish, fromCents: b.cents, toCents: a.cents });
    }
    return { skipped: false, measured, rejected: [...bad].map(([cardId, reasons]) => ({ cardId, reasons: reasons.slice(0, PATTERN_QUARANTINE_REASONS_MAX), sig: sigs.get(cardId) ?? '' })) };
  }

  /**
   * DESPUÉS DEL COMMIT, solo de las cartas confirmadas: `availableFinishes`, reencola el precio del día de las piezas de plataforma (BullMQ; si falla, la
   * corrida diaria idempotente y el barrido de precios lo rehacen) y audita `pricing.pattern_correction` por cada precio PUBLICADO que cambió.
   * Devuelve cuántas combinaciones cambiaron de precio publicado.
   */
  private async settle(cardIds: string[], listingBefore: Map<string, Combo & { price: number | null }>): Promise<number> {
    if (cardIds.length === 0) return 0;
    try {
      await this.finishReconciler.reconcile(cardIds);
      await this.reprice(cardIds);
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo reconciliar/reencolar tras el commit (se rehace en la siguiente corrida): ${(e as Error).message}`);
    }
    const after = await this.publishedPrices(cardIds);
    const changed = new Map<string, Combo & { from: number | null; to: number | null }>();
    for (const [itemId, b] of listingBefore) {
      const a = after.get(itemId);
      if (a == null || a.price == null || a.price === b.price) continue;
      const k = this.key(b);
      if (!changed.has(k)) changed.set(k, { cardId: b.cardId, finish: b.finish, from: b.price, to: a.price });
    }
    const winners = await this.winnerProducts([...changed.values()]);
    for (const c of changed.values()) {
      await this.audit
        ?.log({
          action: 'pricing.pattern_correction',
          entityType: 'Card',
          entityId: c.cardId,
          after: { cardId: c.cardId, finish: c.finish, fromCents: c.from, toCents: c.to, productId: winners.get(this.key(c)) ?? null },
        })
        .catch((e: Error) => this.logger.warn(`pattern-reclassify: no se pudo auditar ${c.cardId}/${c.finish}: ${e.message}`));
    }
    return changed.size;
  }

  /** Reencola el precio del día de las piezas de plataforma de esas cartas y espera a que termine. */
  private async reprice(cardIds: string[]): Promise<void> {
    if (!this.listingPrices) return;
    for (const c of await this.combosOf(cardIds)) {
      void this.listingPrices.enqueueVariant('manual_price', { cardId: c.cardId, productType: 'raw', gradeKey: 'raw:NM', finish: c.finish });
    }
    await this.listingPrices.idle();
  }

  /**
   * «Solo baja, nunca sin precio» MEDIDO con la lectura en vivo: por carta, los motivos de violación entre `before` y `after`. Referencia raw NM:
   * desaparece/0/NULL o SUBE. Cualquier otro tipo/grado (la lectura aplica la «variante efectiva» a todos): CUALQUIER cambio. El `ListingPrice` no entra:
   * se recalcula DESPUÉS del commit desde esta misma lectura (su valor rezagado es el previo, nunca peor).
   */
  private assess(before: Map<string, RefSnap>, after: Map<string, RefSnap>): Map<string, string[]> {
    const bad = new Map<string, string[]>();
    const add = (cardId: string, why: string) => bad.set(cardId, [...(bad.get(cardId) ?? []), why]);
    for (const [k, b] of before) {
      if (b.cents == null) continue;
      const a = after.get(k)?.cents ?? null;
      const rawNm = b.productType === 'raw' && b.gradeKey === 'raw:NM';
      if (a == null || a <= 0) add(b.cardId, `${b.productType}/${b.gradeKey}/${b.finish}: ${b.cents} → sin precio`);
      else if (rawNm ? a > b.cents : a !== b.cents) add(b.cardId, `${b.productType}/${b.gradeKey}/${b.finish}: ${b.cents} → ${a}`);
    }
    return bad;
  }

  /** `itemId → {precio publicado P, carta, acabado}` de las piezas de plataforma (raw) de esas cartas con fila de `ListingPrice`. */
  private async publishedPrices(cardIds: string[]): Promise<Map<string, Combo & { price: number | null }>> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { cardId: { in: cardIds }, ownerType: 'platform', productType: 'raw' },
      select: { id: true, cardId: true, finish: true, listingPrice: { select: { unitPriceCents: true } } },
    });
    return new Map(rows.filter((r) => r.listingPrice != null).map((r) => [r.id, { cardId: r.cardId, finish: r.finish, price: r.listingPrice!.unitPriceCents }]));
  }

  private key(c: Combo): string {
    return variantKey({ cardId: c.cardId, productType: 'raw', gradeKey: 'raw:NM', finish: c.finish });
  }

  /** (carta, acabado) con alguna `PriceReference` de mercado raw NM de cualquiera de los productos de esas cartas. */
  private async combosOf(cardIds: string[]): Promise<Combo[]> {
    const rows = await this.prisma.priceReference.findMany({
      where: { cardId: { in: cardIds }, productType: 'raw', gradeKey: 'raw:NM', ...MONEY_REF_WHERE },
      select: { cardId: true, finish: true },
      distinct: ['cardId', 'finish'],
    });
    return rows;
  }

  /** key → referencia de mercado MXN vigente (o `null` si queda pendiente), con la lectura REAL de siempre. */
  private async referenceMap(combos: Combo[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (combos.length === 0) return out;
    const refs = await this.pricing.getReferencesBatch(combos.map((c) => ({ cardId: c.cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish: c.finish })));
    for (const c of combos) {
      const r = refs.get(this.key(c));
      out.set(this.key(c), r?.status === 'priced' ? (r.referenceMxnCents ?? null) : null);
    }
    return out;
  }

  /** `tcgplayerProductId` del producto que hoy sostiene el precio de cada combinación (preferencia ⇒ id externo asc), o `null`. */
  private async winnerProducts(combos: Combo[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (combos.length === 0) return out;
    const cards = await this.prisma.card.findMany({
      where: { id: { in: [...new Set(combos.map((c) => c.cardId))] } },
      select: {
        id: true, name: true, tcgplayerId: true,
        cardProducts: { where: { kind: { in: ['set_base', 'other', 'variant'] } }, select: { tcgplayerProductId: true, name: true, finishes: true } },
      },
    });
    const byCard = new Map(cards.map((c) => [c.id, c]));
    for (const c of combos) {
      const card = byCard.get(c.cardId);
      const prods = (card?.cardProducts ?? []).filter((p) => p.finishes.includes(c.finish));
      prods.sort((a, b) => productPreferenceOf(a, card!) - productPreferenceOf(b, card!) || a.tcgplayerProductId - b.tcgplayerProductId);
      out.set(this.key(c), prods[0]?.tcgplayerProductId ?? null);
    }
    return out;
  }

  /**
   * Combinaciones con ≥ 1 producto `variant` y ≥ 2 productos `set_base|other` con precio que quedaron SIN precio automático (ambigüedad real; la
   * lectura solo devuelve «pendiente» ahí por la regla de ambigüedad): auditoría semanal. Fuera de ese alcance no se cuenta nada.
   */
  private async auditAmbiguities(): Promise<number> {
    const multi = await this.prisma.$queryRaw<{ cardId: string; finish: Finish }[]>(Prisma.sql`
      SELECT pr."cardId", pr."finish" FROM "PriceReference" pr
      JOIN "CardProduct" cp ON cp."id" = pr."cardProductId"
      WHERE cp."kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind")
        AND pr."productType" = 'raw'::"ProductType" AND pr."gradeKey" = 'raw:NM' AND pr."refKind" = 'market'::"PriceRefKind"
        -- SOLO combos con ≥ 1 producto variant en ese acabado: el único alcance de la regla de ambigüedad (gates qa B1 / seguridad PP-1).
        AND EXISTS (SELECT 1 FROM "CardProduct" v WHERE v."cardId" = pr."cardId" AND v."kind" = 'variant'::"CardProductKind" AND pr."finish" = ANY (v."finishes"))
      GROUP BY pr."cardId", pr."finish" HAVING COUNT(DISTINCT cp."id") > 1
    `);
    if (multi.length === 0) return 0;
    const map = await this.referenceMap(multi);
    let n = 0;
    const since = new Date(Date.now() - 7 * 86_400_000);
    for (const c of multi) {
      if (map.get(this.key(c)) != null) continue; // tiene precio ⇒ no es ambigua (o no tiene mercado: otra historia)
      const id = `${c.cardId}|${c.finish}`;
      // Solo cuenta como ambigua si hay filas del día (no por falta de mercado): la lectura devolvió pendiente teniendo ≥2 productos.
      n += 1;
      const prev = await this.prisma.auditLog.findFirst({ where: { action: 'pricing.product_ambiguous', entityId: id, createdAt: { gte: since } }, select: { id: true } });
      if (prev) continue;
      await this.audit?.log({ action: 'pricing.product_ambiguous', entityType: 'Card', entityId: id, after: { cardId: c.cardId, finish: c.finish } }).catch(() => undefined);
    }
    return n;
  }


  /**
   * Informe de la corrida (6.3/6.6) y vigilancia de la fuente (6.2). Solo se llama con ≥ 1 combo corregido, diferido o rechazado por la prueba. Best-effort:
   * un fallo de auditoría o de correo NO cambia lo ya confirmado. NO MIENTE: `applied` y los `items` aplicados son lo MEDIDO en la prueba (referencia en vivo
   * antes/después); lo planeado que no cambió (override manual) o se rechazó no aparece como corregido. Los diferidos llevan los valores del plan. El correo
   * va SOLO si `applied ≥ 1` o `deferred ≥ 1` (una cuarentena nueva sin cambios de precio queda en Auditoría).
   */
  private async report(plan: PatternPlan, now: Date, measured: Measured[], out: PatternReclassifyResult): Promise<void> {
    const ordered: { cardId: string; finish: string; fromCents: number; toCents: number }[] = [...measured, ...plan.deferred.map((d: PlannedCombo) => ({ cardId: d.cardId, finish: d.finish, fromCents: d.fromCents, toCents: d.toCents }))];
    const shown = ordered.slice(0, PATTERN_ITEMS_MAX);
    const cards = await this.prisma.card.findMany({
      where: { id: { in: [...new Set(shown.map((c) => c.cardId))] } },
      select: { id: true, name: true, set: { select: { name: true } } },
    });
    const byCard = new Map(cards.map((c) => [c.id, c]));
    const items = shown.map((c) => ({
      cardId: c.cardId,
      name: byCard.get(c.cardId)?.name ?? null,
      set: byCard.get(c.cardId)?.set?.name ?? null,
      finish: c.finish,
      fromCents: c.fromCents,
      toCents: c.toCents,
    }));
    await this.audit
      ?.log({
        action: 'pricing.pattern_reclassify_run',
        entityType: 'CardProduct',
        after: {
          applied: measured.length, planned: plan.applied.length, deferred: plan.deferred.length, exposed: plan.applied.length + plan.deferred.length,
          trialRejected: out.trialRejected, quarantined: out.quarantined, quarantinedCards: out.quarantinedCards, items, truncated: ordered.length > shown.length,
        },
      })
      .catch((e: Error) => this.logger.warn(`pattern-reclassify: no se pudo auditar la corrida: ${e.message}`));
    if (measured.length + plan.deferred.length > 0) await this.mailRun(measured.length, plan.deferred.length, out.quarantined, items.slice(0, PATTERN_MAIL_TOP));
    await this.checkStreak(now);
  }

  /** Auto-pausa: las últimas {@link PATTERN_PAUSE_STREAK} corridas (cada una a ≤ 48 h de la anterior, tras la última pausa) con (diferidos + cuarentenas activas) > 0 y CRECIENTES. */
  private async checkStreak(now: Date): Promise<void> {
    try {
      const lastPause = await this.prisma.auditLog.findFirst({ where: { action: 'pricing.pattern_reclassify_paused' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      const runs = await this.prisma.auditLog.findMany({
        where: { action: 'pricing.pattern_reclassify_run', ...(lastPause ? { createdAt: { gt: lastPause.createdAt } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: PATTERN_PAUSE_STREAK,
        select: { createdAt: true, after: true },
      });
      if (runs.length < PATTERN_PAUSE_STREAK) return;
      const asc = [...runs].reverse();
      // 6.6 (2): la racha mide lo pendiente de verdad = diferidos + cartas en cuarentena activas (las corridas viejas sin `quarantined` cuentan 0).
      const pending = asc.map((r) => {
        const a = r.after as { deferred?: unknown; quarantined?: unknown } | null;
        return Number(a?.deferred ?? 0) + Number(a?.quarantined ?? 0);
      });
      const growing = pending.every((d, i) => d > 0 && (i === 0 || d > pending[i - 1]));
      const close = asc.every((r, i) => i === 0 || r.createdAt.getTime() - asc[i - 1].createdAt.getTime() <= 48 * 3_600_000);
      if (!growing || !close) return;
      await this.audit?.log({ action: 'pricing.pattern_reclassify_paused', entityType: 'CardProduct', after: { deferred: pending, pausedDays: PATTERN_PAUSE_DAYS, at: now.toISOString() } });
      this.logger.error(`pattern-reclassify: AUTO-PAUSA: ${PATTERN_PAUSE_STREAK} corridas seguidas con pendientes (diferidos + cuarentena) crecientes (${pending.join(' → ')}).`);
      await this.sendOwners(
        'TCG HUNT: la corrección de precios se pausó sola',
        [`La corrección automática de precios de versiones «Pattern/Ball» frenó ${PATTERN_PAUSE_STREAK} corridas seguidas y la lista de pendientes sigue creciendo (${pending.join(' → ')}). Parece una anomalía de la fuente de precios, no una corrección normal: el proceso se pausó ${PATTERN_PAUSE_DAYS} días y se reanuda solo. No tienes que hacer nada; si quieres revisar, está en Auditoría (pricing.pattern_reclassify_run).`],
      );
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo evaluar la auto-pausa: ${(e as Error).message}`);
    }
  }

  private async mailRun(applied: number, deferred: number, quarantined: number, top: { name: string | null; set: string | null; finish: string; fromCents: number; toCents: number }[]): Promise<void> {
    const mxn = (c: number) => `$${(c / 100).toFixed(2)}`;
    const lines = top.map((t) => `${t.name ?? '?'} (${t.set ?? '?'}, ${t.finish}): ${mxn(t.fromCents)} → ${mxn(t.toCents)}`);
    const head =
      `Corrección automática de precios de versiones «Pattern/Ball»: ${applied} corregidas hoy` +
      (deferred > 0 ? `, ${deferred} pendientes para la siguiente corrida diaria (límite de seguridad por día)` : '') +
      (quarantined > 0 ? `. ${quarantined} en cuarentena (detalle en Auditoría): la prueba previa vio que habrían subido de precio o quedado sin precio, así que no se tocaron` : '') +
      `. Solo bajan precios inflados; no necesitas aprobar nada. Las ${lines.length} de mayor diferencia (lista completa en Auditoría, pricing.pattern_reclassify_run):`;
    await this.sendOwners('TCG HUNT: corrección automática de precios', [head, ...lines]);
  }

  /** Correo al dueño: `paragraphs[0]` es el texto principal; el resto, líneas de detalle. Best-effort. */
  private async sendOwners(subject: string, paragraphs: string[]): Promise<void> {
    if (!this.mail) return;
    try {
      const owners = await ownerRecipients(this.prisma);
      const text = paragraphs.join('\n');
      const html = mailShell({
        locale: 'es', title: subject, preheader: paragraphs[0].slice(0, 90),
        blocks: [headingRow(subject, 22), spacerRow(24), ...paragraphs.map((l) => proseRow(l)), spacerRow(16)],
        footerWhy: 'Recibes este aviso porque eres el dueño de la tienda.',
      });
      for (const o of owners) await this.mail.send({ to: o.email, subject, html, text });
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo avisar al dueño: ${(e as Error).message}`);
    }
  }
}
