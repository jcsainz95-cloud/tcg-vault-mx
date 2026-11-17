import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Finish, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { headingRow, mailShell, proseRow, spacerRow } from '../buylist/mail-shell';
import { ownerRecipients } from '../spend-alerts/spend-mail.service';
import { FinishReconciler } from '../catalog/finish-reconciler.service';
import { productPreferenceOf, VARIANT_PRODUCT_SUFFIX_PG } from '../../common/variant-product';
import { variantKey } from '../../common/variant-key';
import { MONEY_REF_WHERE, PricingService } from './pricing.service';
import { ListingPriceService } from './listing-price.service';

/** Freno de anomalía (§PRICE-PATTERN punto 4): una corrida que cambiaría MÁS combinaciones que esto NO se aplica y avisa al dueño. */
export const PATTERN_RECLASSIFY_BRAKE = 200;

export interface PatternReclassifyResult {
  /** Productos `set_base|other` cuyo nombre coincide con «(… Pattern/Ball/Energy Symbol)» (candidatos). */
  candidates: number;
  /** Productos reclasificados a `variant` (0 si el freno actuó). */
  reclassified: number;
  /** Combinaciones carta×acabado EXPUESTAS: la versión alterna cuesta > 1.5× la base (o la base no tiene mercado). Es lo que mide el freno. */
  combosExposed: number;
  /** Combinaciones cuyo PRECIO PUBLICADO (`ListingPrice`) cambió y quedaron auditadas `pricing.pattern_correction`. */
  corrections: number;
  /** El freno actuó: NADA se aplicó. */
  halted: boolean;
  /** Combinaciones (carta×acabado) sin precio automático por ambigüedad real de producto. */
  ambiguous: number;
}

type Combo = { cardId: string; finish: Finish };

/**
 * §PRICE-PATTERN (docs/DECISIONES.md punto 4) — job `pattern-reclassify`, IDEMPOTENTE, al desplegar y diario.
 *  1. Reclasifica a `variant` los `CardProduct` `set_base|other` cuyo NOMBRE termina en «(… Pattern|Ball|Energy Symbol)».
 *  2. FRENO: mide las combinaciones carta×acabado EXPUESTAS (la versión alterna vale > 1.5× la base, o la base no tiene mercado). Si son MÁS de
 *     {@link PATTERN_RECLASSIFY_BRAKE} no aplica NADA (ni la clase), avisa al dueño y espera. El caso esperado son decenas (PRE, Black Bolt,
 *     White Flare); un patrón que de pronto coincidiera con miles de productos es un error de regla, no una corrección.
 *  3. Aplica: recomputa `availableFinishes` (FinishReconciler), reencola el precio del día de las piezas de plataforma de esas cartas
 *     (`ListingPriceService`) y, ya recalculado, audita `pricing.pattern_correction {cardId, finish, fromCents, toCents, productId}` por cada
 *     combinación cuyo precio PUBLICADO cambió. Las caídas se publican solas (corregir un error conocido). Precios a mano y overrides son el
 *     tier manual: NUNCA cambian. Si la base no tiene mercado en ese acabado queda `PRICE_PENDING`; jamás se presta el del patrón.
 *  4. Audita `pricing.product_ambiguous` por cada combinación sin precio automático por ambigüedad real (≥2 productos del montón con precios
 *     que difieren > 25 %), una vez por semana y combinación.
 * La LECTURA del precio ya es correcta con la sola preferencia de producto (ancla ⇒ nombre exacto) incluso antes de reclasificar; el job
 * saca las versiones alternas del precio base, de `availableFinishes` y del binder, y corrige lo ya publicado.
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
  ) {}

  async run(opts: { brake?: number } = {}): Promise<PatternReclassifyResult> {
    const brake = opts.brake ?? PATTERN_RECLASSIFY_BRAKE;
    const out: PatternReclassifyResult = { candidates: 0, reclassified: 0, combosExposed: 0, corrections: 0, halted: false, ambiguous: 0 };

    const cand = await this.prisma.$queryRaw<{ id: string; cardId: string }[]>(Prisma.sql`
      SELECT "id", "cardId" FROM "CardProduct"
      WHERE "kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind") AND "name" ~* ${VARIANT_PRODUCT_SUFFIX_PG}
    `);
    out.candidates = cand.length;

    if (cand.length > 0) {
      const ids = cand.map((c) => c.id);
      const cardIds = [...new Set(cand.map((c) => c.cardId))];
      const exposed = await this.exposedCombos(cardIds);
      out.combosExposed = exposed.length;
      if (exposed.length > brake) {
        out.halted = true;
        await this.alertHalt(exposed.length, brake, cand.length);
        this.logger.error(`pattern-reclassify: ${exposed.length} combinaciones expuestas (> ${brake}); NO se aplicó nada (aviso al dueño).`);
        out.ambiguous = await this.auditAmbiguities();
        return out;
      }

      // Precio PUBLICADO de antes (ListingPrice de las piezas de plataforma de esas cartas), para auditar lo que de verdad cambió.
      const before = await this.publishedPrices(cardIds);
      await this.prisma.cardProduct.updateMany({ where: { id: { in: ids } }, data: { kind: 'variant' } });
      out.reclassified = cand.length;
      await this.finishReconciler.reconcile(cardIds);
      if (this.listingPrices) {
        for (const c of await this.combosOf(cardIds)) {
          void this.listingPrices.enqueueVariant('manual_price', { cardId: c.cardId, productType: 'raw', gradeKey: 'raw:NM', finish: c.finish });
        }
        await this.listingPrices.idle();
      }
      const after = await this.publishedPrices(cardIds);
      const changed = new Map<string, Combo & { from: number | null; to: number | null }>();
      for (const [itemId, b] of before) {
        const a = after.get(itemId);
        if (a == null || a.price === b.price) continue;
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
      out.corrections = changed.size;
      this.logger.log(`pattern-reclassify: ${cand.length} productos → variant; ${exposed.length} combinaciones expuestas; ${changed.size} con precio publicado distinto.`);
    }

    out.ambiguous = await this.auditAmbiguities();
    return out;
  }

  /** `itemId → {precio publicado P, carta, acabado}` de las piezas de plataforma (raw) de esas cartas con fila de `ListingPrice`. */
  private async publishedPrices(cardIds: string[]): Promise<Map<string, Combo & { price: number | null }>> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { cardId: { in: cardIds }, ownerType: 'platform', productType: 'raw' },
      select: { id: true, cardId: true, finish: true, listingPrice: { select: { unitPriceCents: true } } },
    });
    return new Map(rows.filter((r) => r.listingPrice != null).map((r) => [r.id, { cardId: r.cardId, finish: r.finish, price: r.listingPrice!.unitPriceCents }]));
  }

  /**
   * Combinaciones carta×acabado EXPUESTAS: algún candidato (versión alterna) cuesta > 1.5× el producto base más barato del mismo acabado, o
   * la carta NO tiene base con precio en ese acabado (el patrón prestaría su precio). Es lo que el freno cuenta.
   */
  private async exposedCombos(cardIds: string[]): Promise<Combo[]> {
    if (cardIds.length === 0) return [];
    return this.prisma.$queryRaw<Combo[]>(Prisma.sql`
      WITH rows AS (
        SELECT pr."cardId", pr."finish", pr."priceMxnCents" AS cents,
               (cp."name" ~* ${VARIANT_PRODUCT_SUFFIX_PG}) AS is_variant
        FROM "PriceReference" pr
        JOIN "CardProduct" cp ON cp."id" = pr."cardProductId"
        WHERE pr."cardId" IN (${Prisma.join(cardIds)})
          AND cp."kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind", 'variant'::"CardProductKind")
          AND pr."productType" = 'raw'::"ProductType" AND pr."gradeKey" = 'raw:NM' AND pr."refKind" = 'market'::"PriceRefKind"
          AND pr."priceMxnCents" > 0
      )
      SELECT "cardId", "finish" FROM rows GROUP BY "cardId", "finish"
      HAVING MAX(CASE WHEN is_variant THEN cents END) IS NOT NULL
         AND (MIN(CASE WHEN NOT is_variant THEN cents END) IS NULL
              OR MAX(CASE WHEN is_variant THEN cents END) > 1.5 * MIN(CASE WHEN NOT is_variant THEN cents END))
    `);
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
        cardProducts: { where: { kind: { in: ['set_base', 'other'] } }, select: { tcgplayerProductId: true, name: true, finishes: true } },
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

  /** Combinaciones con ≥2 productos `set_base|other` con precio que quedaron sin precio automático (ambigüedad real): auditoría semanal. */
  private async auditAmbiguities(): Promise<number> {
    const multi = await this.prisma.$queryRaw<{ cardId: string; finish: Finish }[]>(Prisma.sql`
      SELECT pr."cardId", pr."finish" FROM "PriceReference" pr
      JOIN "CardProduct" cp ON cp."id" = pr."cardProductId"
      WHERE cp."kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind")
        AND pr."productType" = 'raw'::"ProductType" AND pr."gradeKey" = 'raw:NM' AND pr."refKind" = 'market'::"PriceRefKind"
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

  /** Aviso al dueño (una vez al día) cuando el freno actúa. Best-effort: un correo caído no cambia el resultado (nada se aplicó). */
  private async alertHalt(changed: number, brake: number, products: number): Promise<void> {
    const since = new Date(Date.now() - 86_400_000);
    const prev = await this.prisma.auditLog.findFirst({ where: { action: 'pricing.pattern_reclassify_halted', createdAt: { gte: since } }, select: { id: true } });
    if (prev) return;
    await this.audit?.log({ action: 'pricing.pattern_reclassify_halted', entityType: 'CardProduct', after: { combosChanged: changed, brake, products } }).catch(() => undefined);
    if (!this.mail) return;
    try {
      const owners = await ownerRecipients(this.prisma);
      const subject = 'TCG HUNT: una corrección de precios quedó en pausa';
      const text = `El sistema quiso corregir los precios de cartas con versiones «Pattern/Ball» y habría cambiado ${changed} combinaciones (el límite de seguridad es ${brake}). No se aplicó nada. Revisa los precios antes de autorizar.`;
      const html = mailShell({
        locale: 'es', title: subject, preheader: 'Corrección de precios en pausa por seguridad.',
        blocks: [headingRow(subject, 22), spacerRow(24), proseRow(text), spacerRow(16)],
        footerWhy: 'Recibes este aviso porque eres el dueño de la tienda.',
      });
      for (const o of owners) await this.mail.send({ to: o.email, subject, html, text });
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo avisar al dueño: ${(e as Error).message}`);
    }
  }
}
