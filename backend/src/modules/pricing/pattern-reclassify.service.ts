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
import { loadEffectiveVariantRows, loadNonRawCandidateIds, loadReaderBaseRows } from './effective-variant';
import { PATTERN_RUN_MAX, PatternPlan, PlannedCombo, planPatternRun } from './pattern-plan';
import { classifyCardProductKind } from './providers/tcgcsv-singles.provider';
import { variantKey } from '../../common/variant-key';
import { MONEY_REF_WHERE, PricingService } from './pricing.service';
import { ListingPriceService } from './listing-price.service';

/** Máximo de ítems del informe `pricing.pattern_reclassify_run` (6.3) y de los «mayores» que lleva el correo. */
export const PATTERN_ITEMS_MAX = 500;
export const PATTERN_MAIL_TOP = 20;
/** Auto-pausa (6.2): este número de corridas SEGUIDAS con diferidos y la lista creciendo; la pausa dura {@link PATTERN_PAUSE_DAYS} y se reanuda sola. */
export const PATTERN_PAUSE_STREAK = 3;
export const PATTERN_PAUSE_DAYS = 3;
export { PATTERN_RUN_MAX };
/** Candado consultivo del job (single-flight, punto 4b-i): UNA instancia a la vez; la segunda sale sin hacer nada. Censo: `lock-keys.census.spec.ts`. */
export const PATTERN_RECLASSIFY_LOCK_KEY = 91_170_217;
/** La transacción que SOSTIENE el candado vive lo que dure la corrida (recalcular precios publicados puede tardar). */
const PATTERN_RECLASSIFY_TX_TIMEOUT_MS = 25 * 60 * 1000;

export interface PatternReclassifyResult {
  /** `true` ⇒ otra corrida tenía el candado: esta salió sin hacer nada. */
  skipped?: boolean;
  /** `true` ⇒ el job está auto-pausado (6.2): esta corrida no hizo nada. */
  paused?: boolean;
  /** Productos `set_base|other` cuyo nombre coincide con «(… Pattern/Ball/Energy Symbol)» (candidatos). */
  candidates: number;
  /** Productos reclasificados a `variant` en esta corrida. */
  reclassified: number;
  /** Combinaciones carta×acabado EXPUESTAS (hay base con precio fresco y la versión vale > 1.5×): aplicadas + diferidas. */
  combosExposed: number;
  /** Combos que se corrigieron DE VERDAD (precio de referencia medido antes/después en `applyKind`, no el plan): ≤ {@link PATTERN_RUN_MAX}. */
  applied: number;
  /** Combos que el plan quería aplicar ahora (≥ `applied`: un override manual o una reversa los deja sin cambio real). */
  planned: number;
  /** Cartas cuya reclasificación se REVIRTIÓ porque, medida, habría subido un precio o lo habría dejado sin precio (PP-7). */
  rolledBack: number;
  /** Combos expuestos que esperan a la siguiente corrida (freno fijo). */
  deferred: number;
  /** Combos en cuarentena (base vencida / sin base fresca / razón ≤ 1.5): el precio se conserva. */
  held: number;
  /** Combinaciones cuyo PRECIO PUBLICADO (`ListingPrice`) cambió y quedaron auditadas `pricing.pattern_correction`. */
  corrections: number;
  /** Violaciones de «solo baja, nunca sin precio» que SIGUEN tras la reversa (debe ser 0; si no, se registra como error). */
  violations: number;
  /** Combinaciones (carta×acabado) sin precio automático por ambigüedad real de producto. */
  ambiguous: number;
}

type Combo = { cardId: string; finish: Finish };
type RefSnap = { cardId: string; productType: ProductType; gradeKey: string; finish: Finish; cents: number | null };
type Snapshot = { refs: Map<string, RefSnap>; listing: Map<string, Combo & { price: number | null }> };
/** Bajada de la referencia raw NM de un combo, MEDIDA antes/después de aplicar. */
type Measured = { cardId: string; finish: Finish; fromCents: number; toCents: number };
type ApplyResult = { changed: number; violations: number; rolledBack: { cardId: string; reasons: string[] }[]; refChanges: Measured[] };

const emptyResult = (): PatternReclassifyResult => ({ candidates: 0, reclassified: 0, combosExposed: 0, applied: 0, planned: 0, rolledBack: 0, deferred: 0, held: 0, corrections: 0, violations: 0, ambiguous: 0 });

/**
 * §PRICE-PATTERN v2 (docs/DECISIONES.md punto 6) — job `pattern-reclassify`, IDEMPOTENTE, al desplegar y diario. TODO AUTOMÁTICO (sin dial, sin aprobación).
 *  1. Candidatos: `CardProduct set_base|other` cuyo NOMBRE termina en «(… Pattern|Ball|Energy Symbol)» (clasificador único).
 *  2. Plan puro (`planPatternRun`): por carta×acabado, un candidato solo se reclasifica si (a) es el ÚNICO producto con precio de ese acabado (queda como
 *     base: la lectura lo usa, 6.1) o (b) hay base fresca con precio y el candidato vale > 1.5× ⇒ combo EXPUESTO, se BAJA a la base. Cuarentena: base sin
 *     precio fresco o razón ≤ 1.5 ⇒ no se toca. Freno FIJO {@link PATTERN_RUN_MAX}: aplica los de mayor razón, difiere el resto (se drena solo).
 *  3. Aplica: reclasifica, recomputa `availableFinishes`, reencola el precio de las piezas de plataforma y audita `pricing.pattern_correction` por cada precio
 *     PUBLICADO que cambió. REGLA DE ORO HECHA CUMPLIR (PP-7): se MIDE la referencia del catálogo (todos los tipos/grados) y el `ListingPrice` antes y
 *     después; si algún precio sube, queda en 0/NULL o desaparece, la reclasificación de esa carta se REVIERTE (`pricing.pattern_flip_rolled_back`) y se
 *     informa. Antes de aplicar, el plan pone en cuarentena el combo cuya base quedaría ambigua (≥ 2 productos pref. 2 con > 25 %) o con candidatos con
 *     precio fuera de raw NM. Precios a mano/override son el tier manual y no se tocan.
 *  4. Informe (6.3): `pricing.pattern_reclassify_run {applied (medidos), deferred, exposed, items≤500, truncated, planned, rolledBack}` + un correo al dueño
 *     (solo si hubo ≥ 1 corregido, diferido o revertido). Los `items` aplicados llevan el before/after MEDIDO; los diferidos, el del plan.
 *  5. Auto-pausa (6.2): {@link PATTERN_PAUSE_STREAK} corridas seguidas con diferidos CRECIENTES ⇒ `pricing.pattern_reclassify_paused` + alerta; reanuda sola tras {@link PATTERN_PAUSE_DAYS} días.
 *  6. Audita `pricing.product_ambiguous` (≥ 2 productos «del montón» con precios que difieren > 25 % junto a un `variant`), una vez por semana y combinación.
 * ⛔ No toca precios, inventario ni dinero directamente: solo la clase de un producto; el precio sale de la lectura de siempre.
 */
@Injectable()
export class PatternReclassifyService {
  private readonly logger = new Logger(PatternReclassifyService.name);

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
   * SINGLE-FLIGHT (punto 4b-i): la corrida entera vive dentro de UNA transacción larga que toma `pg_try_advisory_xact_lock`; una segunda
   * corrida en paralelo (boot + diario, dos instancias) NO obtiene el candado y sale sin hacer nada (`skipped`). El candado se libera solo al
   * terminar o si el proceso muere. La transacción solo SOSTIENE el candado: el trabajo usa sus propias conexiones.
   */
  async run(opts: { max?: number; now?: Date } = {}): Promise<PatternReclassifyResult> {
    return this.prisma.$transaction(
      async (lockTx) => {
        const got = await lockTx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${PATTERN_RECLASSIFY_LOCK_KEY}::bigint) AS ok`;
        if (got[0]?.ok !== true) {
          this.logger.warn('pattern-reclassify: ya hay una corrida en curso; esta sale sin hacer nada.');
          return { ...emptyResult(), skipped: true };
        }
        return this.runLocked(opts);
      },
      { timeout: PATTERN_RECLASSIFY_TX_TIMEOUT_MS, maxWait: 5_000 },
    );
  }

  private async runLocked(opts: { max?: number; now?: Date }): Promise<PatternReclassifyResult> {
    const max = opts.max ?? PATTERN_RUN_MAX;
    const now = opts.now ?? new Date();
    const out = emptyResult();

    // REVERSA FUNCIONAL (flag apagado): `variant → set_base` y la lectura vuelve al comportamiento previo. Sin freno: es decisión explícita del dueño.
    if (!(await this.enabled())) {
      const back = await this.prisma.cardProduct.findMany({ where: { kind: 'variant' }, select: { id: true, cardId: true } });
      out.candidates = back.length;
      if (back.length > 0) {
        out.corrections = (await this.applyKind(back.map((b) => b.id), [...new Set(back.map((b) => b.cardId))], 'set_base')).changed;
        out.reclassified = back.length;
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

    if (cand.length > 0) {
      const candIds = new Set(cand.map((c) => c.id));
      const cardIds = [...new Set(cand.map((c) => c.cardId))];
      const rows = await loadEffectiveVariantRows(this.prisma, cardIds, { productTypes: ['raw'], gradeKeys: ['raw:NM'], hypotheticalVariantIds: [...candIds] });
      // Lo que la lectura REAL conservaría de la base (sin colapsar por producto, con manual) y los candidatos con precio fuera de raw NM.
      const readerBase = await loadReaderBaseRows(this.prisma, cardIds, [...candIds]);
      const nonRaw = await loadNonRawCandidateIds(this.prisma, [...candIds]);
      const plan = planPatternRun(rows, candIds, now, max, readerBase, nonRaw);
      out.combosExposed = plan.applied.length + plan.deferred.length;
      out.planned = plan.applied.length;
      out.deferred = plan.deferred.length;
      out.held = plan.held;
      let measured: Measured[] = [];
      let rolled: { cardId: string; reasons: string[] }[] = [];
      if (plan.flipIds.length > 0) {
        const flipCards = [...new Set(cand.filter((c) => plan.flipIds.includes(c.id)).map((c) => c.cardId))];
        const r = await this.applyKind(plan.flipIds, flipCards, 'variant');
        out.corrections = r.changed;
        out.violations = r.violations;
        out.rolledBack = r.rolledBack.length;
        measured = r.refChanges;
        rolled = r.rolledBack;
        out.applied = measured.length;
        const rolledCards = new Set(r.rolledBack.map((x) => x.cardId));
        out.reclassified = cand.filter((c) => plan.flipIds.includes(c.id) && !rolledCards.has(c.cardId)).length;
      }
      this.logger.log(`pattern-reclassify: ${cand.length} candidatos; ${out.reclassified} → variant; expuestas ${out.combosExposed} (planeadas ${out.planned}, corregidas medidas ${out.applied}, diferidas ${out.deferred}); cuarentena ${out.held}; revertidas ${out.rolledBack} carta(s); ${out.corrections} con precio publicado distinto.`);
      if (out.applied + out.deferred + out.rolledBack > 0) await this.report(plan, now, measured, rolled);
    }

    // Red de seguridad (6.1): productos que el import ya creó como `variant` (patrón único) y cuyo precio llegó después: su acabado entra a
    // `availableFinishes` sin esperar un re-sync. Idempotente (el reconciliador solo escribe si cambia).
    const withVariant = await this.prisma.cardProduct.findMany({ where: { kind: 'variant' }, select: { cardId: true }, distinct: ['cardId'] });
    if (withVariant.length > 0) await this.finishReconciler.reconcile(withVariant.map((v) => v.cardId));

    out.ambiguous = await this.auditAmbiguities();
    return out;
  }

  /**
   * Cambia la clase de esos productos, recomputa `availableFinishes`, reencola el precio del día de las piezas de plataforma de esas cartas y, ya
   * recalculado, MIDE antes/después (referencia del catálogo de TODOS los tipos/grados + `ListingPrice`). Si la reclasificación a `variant` hizo
   * SUBIR un precio, lo dejó en 0/NULL o lo hizo desaparecer (PP-7), REVIERTE esa carta al `kind` original, reencola, lo audita
   * (`pricing.pattern_flip_rolled_back`) y devuelve el motivo. Audita `pricing.pattern_correction` por cada precio PUBLICADO que quedó distinto.
   * Devuelve los cambios REALES de referencia raw NM (de ahí salen el informe y el correo), no los del plan.
   */
  private async applyKind(ids: string[], cardIds: string[], kind: 'variant' | 'set_base'): Promise<ApplyResult> {
    const prev = await this.prisma.cardProduct.findMany({ where: { id: { in: ids } }, select: { id: true, cardId: true, kind: true } });
    const before = await this.snapshot(cardIds);
    await this.prisma.cardProduct.updateMany({ where: { id: { in: ids } }, data: { kind } });
    await this.finishReconciler.reconcile(cardIds);
    await this.reprice(cardIds);
    let after = await this.snapshot(cardIds);
    let violations = 0;
    const rolledBack: { cardId: string; reasons: string[] }[] = [];
    if (kind === 'variant') {
      const bad = this.assess(before, after);
      if (bad.size > 0) {
        const back = prev.filter((p) => bad.has(p.cardId));
        for (const k of new Set(back.map((p) => p.kind))) await this.prisma.cardProduct.updateMany({ where: { id: { in: back.filter((p) => p.kind === k).map((p) => p.id) } }, data: { kind: k } });
        const rbCards = [...bad.keys()];
        await this.finishReconciler.reconcile(rbCards);
        await this.reprice(rbCards);
        after = await this.snapshot(cardIds);
        for (const [cardId, reasons] of bad) {
          rolledBack.push({ cardId, reasons });
          this.logger.error(`pattern-reclassify: REVERSA en ${cardId} (solo baja / nunca sin precio): ${reasons.join('; ')}`);
          await this.audit
            ?.log({ action: 'pricing.pattern_flip_rolled_back', entityType: 'Card', entityId: cardId, after: { cardId, reasons: reasons.slice(0, 20), productIds: back.filter((p) => p.cardId === cardId).map((p) => p.id) } })
            .catch((e: Error) => this.logger.warn(`pattern-reclassify: no se pudo auditar la reversa de ${cardId}: ${e.message}`));
        }
        violations = this.assess(before, after).size; // lo que SIGUE mal tras revertir (no debería existir)
        if (violations > 0) this.logger.error(`pattern-reclassify: ${violations} carta(s) siguen con violación tras la reversa.`);
      }
    }
    const refChanges: Measured[] = [];
    for (const [k, b] of before.refs) {
      const a = after.refs.get(k);
      if (b.productType !== 'raw' || b.gradeKey !== 'raw:NM' || b.cents == null || a?.cents == null || a.cents >= b.cents) continue;
      refChanges.push({ cardId: b.cardId, finish: b.finish, fromCents: b.cents, toCents: a.cents });
    }
    refChanges.sort((x, y) => y.fromCents / y.toCents - x.fromCents / x.toCents || x.cardId.localeCompare(y.cardId));
    const changed = new Map<string, Combo & { from: number | null; to: number | null }>();
    for (const [itemId, b] of before.listing) {
      const a = after.listing.get(itemId);
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
    return { changed: changed.size, violations, rolledBack, refChanges };
  }

  /** Reencola el precio del día de las piezas de plataforma de esas cartas y espera a que termine. */
  private async reprice(cardIds: string[]): Promise<void> {
    if (!this.listingPrices) return;
    for (const c of await this.combosOf(cardIds)) {
      void this.listingPrices.enqueueVariant('manual_price', { cardId: c.cardId, productType: 'raw', gradeKey: 'raw:NM', finish: c.finish });
    }
    await this.listingPrices.idle();
  }

  /** Foto de lo que el cliente vería de esas cartas: referencia vigente de CADA combinación con mercado (todos los tipos/grados) y precio publicado. */
  private async snapshot(cardIds: string[]): Promise<Snapshot> {
    const refs = new Map<string, RefSnap>();
    for (let i = 0; i < cardIds.length; i += 200) {
      const combos = await this.prisma.priceReference.groupBy({
        by: ['cardId', 'productType', 'gradeKey', 'finish'],
        where: { cardId: { in: cardIds.slice(i, i + 200) }, ...MONEY_REF_WHERE },
      });
      const got = await this.pricing.getReferencesBatch(combos.map((c) => ({ cardId: c.cardId, productType: c.productType, gradeKey: c.gradeKey, finish: c.finish })));
      for (const c of combos) {
        const k = variantKey(c);
        const r = got.get(k);
        refs.set(k, { cardId: c.cardId, productType: c.productType, gradeKey: c.gradeKey, finish: c.finish, cents: r?.status === 'priced' ? (r.referenceMxnCents ?? null) : null });
      }
    }
    return { refs, listing: this.listingPrices ? await this.publishedPrices(cardIds) : new Map() };
  }

  /**
   * «Solo baja, nunca sin precio» MEDIDO: por carta, los motivos de violación entre `before` y `after`. Referencia raw NM: desaparece/0/NULL o SUBE.
   * Cualquier otro tipo/grado (la lectura aplica la «variante efectiva» a todos): CUALQUIER cambio. `ListingPrice`: desaparece/0/NULL o sube, pero solo
   * si la referencia de su combinación cambió (si no cambió, un precio publicado distinto es un precio viejo que hoy se recalcula, no efecto del flip).
   */
  private assess(before: Snapshot, after: Snapshot): Map<string, string[]> {
    const bad = new Map<string, string[]>();
    const add = (cardId: string, why: string) => bad.set(cardId, [...(bad.get(cardId) ?? []), why]);
    for (const [k, b] of before.refs) {
      if (b.cents == null) continue;
      const a = after.refs.get(k)?.cents ?? null;
      const rawNm = b.productType === 'raw' && b.gradeKey === 'raw:NM';
      if (a == null || a <= 0) add(b.cardId, `${b.productType}/${b.gradeKey}/${b.finish}: ${b.cents} → sin precio`);
      else if (rawNm ? a > b.cents : a !== b.cents) add(b.cardId, `${b.productType}/${b.gradeKey}/${b.finish}: ${b.cents} → ${a}`);
    }
    for (const [itemId, b] of before.listing) {
      if (b.price == null) continue;
      const k = this.key(b);
      if (before.refs.get(k)?.cents === after.refs.get(k)?.cents) continue; // referencia intacta ⇒ no atribuible al flip
      const a = after.listing.get(itemId)?.price ?? null;
      if (a == null || a <= 0 || a > b.price) add(b.cardId, `pieza ${itemId} ${b.finish}: publicado ${b.price} → ${a ?? 'sin precio'}`);
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
   * Informe de la corrida (6.3) y vigilancia de la fuente (6.2). Solo se llama con >= 1 combo corregido, diferido o revertido. Best-effort: un fallo
   * de auditoría o de correo NO cambia lo ya aplicado. NO MIENTE: `applied` y los `items` aplicados son lo MEDIDO en `applyKind` (referencia antes/
   * después); lo planeado que no cambió (override manual) o se revirtió no aparece como corregido. Los diferidos llevan los valores del plan.
   */
  private async report(plan: PatternPlan, now: Date, measured: Measured[], rolled: { cardId: string; reasons: string[] }[]): Promise<void> {
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
          rolledBack: rolled.length, rolledBackCards: rolled.slice(0, 50).map((r) => r.cardId), items, truncated: ordered.length > shown.length,
        },
      })
      .catch((e: Error) => this.logger.warn(`pattern-reclassify: no se pudo auditar la corrida: ${e.message}`));
    await this.mailRun(measured.length, plan.deferred.length, rolled.length, items.slice(0, PATTERN_MAIL_TOP));
    await this.checkStreak(now);
  }

  /** Auto-pausa: las últimas {@link PATTERN_PAUSE_STREAK} corridas (cada una a ≤ 48 h de la anterior, tras la última pausa) con diferidos > 0 y CRECIENTES. */
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
      const deferred = asc.map((r) => Number((r.after as { deferred?: unknown } | null)?.deferred ?? 0));
      const growing = deferred.every((d, i) => d > 0 && (i === 0 || d > deferred[i - 1]));
      const close = asc.every((r, i) => i === 0 || r.createdAt.getTime() - asc[i - 1].createdAt.getTime() <= 48 * 3_600_000);
      if (!growing || !close) return;
      await this.audit?.log({ action: 'pricing.pattern_reclassify_paused', entityType: 'CardProduct', after: { deferred, pausedDays: PATTERN_PAUSE_DAYS, at: now.toISOString() } });
      this.logger.error(`pattern-reclassify: AUTO-PAUSA: ${PATTERN_PAUSE_STREAK} corridas seguidas con diferidos crecientes (${deferred.join(' → ')}).`);
      await this.sendOwners(
        'TCG HUNT: la corrección de precios se pausó sola',
        [`La corrección automática de precios de versiones «Pattern/Ball» frenó ${PATTERN_PAUSE_STREAK} corridas seguidas y la lista de pendientes sigue creciendo (${deferred.join(' → ')}). Parece una anomalía de la fuente de precios, no una corrección normal: el proceso se pausó ${PATTERN_PAUSE_DAYS} días y se reanuda solo. No tienes que hacer nada; si quieres revisar, está en Auditoría (pricing.pattern_reclassify_run).`],
      );
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo evaluar la auto-pausa: ${(e as Error).message}`);
    }
  }

  private async mailRun(applied: number, deferred: number, rolledBack: number, top: { name: string | null; set: string | null; finish: string; fromCents: number; toCents: number }[]): Promise<void> {
    const mxn = (c: number) => `$${(c / 100).toFixed(2)}`;
    const lines = top.map((t) => `${t.name ?? '?'} (${t.set ?? '?'}, ${t.finish}): ${mxn(t.fromCents)} → ${mxn(t.toCents)}`);
    const head =
      `Corrección automática de precios de versiones «Pattern/Ball»: ${applied} corregidas hoy` +
      (deferred > 0 ? `, ${deferred} pendientes para la siguiente corrida diaria (límite de seguridad por día)` : '') +
      (rolledBack > 0 ? `. ${rolledBack} carta(s) se REVIRTIERON por seguridad: la corrección habría subido su precio o la habría dejado sin precio (quedaron como estaban; detalle en Auditoría, pricing.pattern_flip_rolled_back)` : '') +
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
