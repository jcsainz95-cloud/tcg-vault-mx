import { Injectable, Logger, Optional } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { ManualVersionMergeService } from './manual-version-merge.service';
import { PrismaService } from '../../prisma/prisma.service';
import { baseMatchKey, catalogMatchKey, STAMPED_SOURCE_GROUPS, stampTypeOf } from '../../common/card-version';
import { deriveStructuralFinishes, tcgcsvSubTypeToFinish, TcgcsvPriceRow, TcgcsvSingleProductRef } from './pricing.types';
import { TcgcsvCatalogClient } from './providers/tcgcsv-singles.provider';
import { PricingService } from './pricing.service';
import { releaseTcgcsvRow, resolveTcgcsvGroupForSet, shouldRetainTcgcsvPrice } from './providers/tcgcsv-group-match';
import { priorRefKey, priorTcgcsvRefKeys } from './providers/tcgcsv-prior-refs';
import { AutoLinkPriceGate } from './auto-link-price-gate.service';
import { usdToMxnCents } from '../../common/money';
import { variantKey } from '../../common/variant-key';
import type { TcgcsvGroupRef } from './pricing.types';

/** El log de un grupo (§IDS.3): `{grupo, colgados, ambiguos, sinPareja, sinTipo, conPrecio}` + `sinNumero` y `ocupados`. */
export interface StampedGroupLog {
  grupo: number;
  colgados: number;
  ambiguos: number;
  sinPareja: number;
  sinTipo: number;
  sinNumero: number;
  /** El `productId` ya existe como `CardProduct` de otro kind (p. ej. una promo): no se toca (IDS-D2 punto 3). */
  ocupados: number;
  conPrecio: number;
  /** §13.2: cartas de sets con grupo `via:'b3'` sin confirmar: ni se cuelga la liga ni se precia (`b3_unverified`). Solo aparece si hubo. */
  omitted?: { reason: 'b3_unverified'; count: number }[];
  /** §14.2: en sets B3 sin confirmar, referencias de liga YA publicadas (misma clave `productId|subtipo`, CardProduct ya colgado) cuyo precio se refrescó. Solo aparece si hubo. */
  refreshedPublished?: number;
  /** §14.2: refrescos que el candado (`price_jump`/`price_sanity`) retuvo (o sin candado disponible ⇒ falla cerrada). Solo aparece si hubo. */
  refreshHeld?: number;
  error?: string;
}

/** Un producto de liga colgado y sus acabados con precio escrito (para el disparo de publicación). */
export interface StampedWritten {
  cardId: string;
  tcgplayerProductId: number;
  finish: Finish;
}

/** §14.1: veredicto explícito del resolver para el set de una carta. `b3` = grupo sin confirmar (solo refresca lo ya publicado); `retain` = nada (falla cerrada). */
export type StampedVerdict = { mode: 'release' } | { mode: 'retain' } | { mode: 'b3'; setId: string; groupId: number };

/** «No hay grupo» DEFINITIVO del resolver (cualquier otra forma sin `groupId` no es un veredicto ⇒ retiene). */
const NO_GROUP_FAILURES: ReadonlySet<string> = new Set(['no_match', 'ambiguous', 'empty_name']);

/** Una carta de liga ya colgada en un set B3 sin confirmar, con las filas de precio que trae TCGCSV. */
interface B3RefreshEntry {
  setId: string;
  groupId: number;
  cardId: string;
  cardProductId: string;
  productId: number;
  rows: TcgcsvPriceRow[];
}

/** El índice del catálogo: `catalogMatchKey` ⇒ cartas distintas que la comparten. */
export type CatalogMatchIndex = Map<string, Set<string>>;

/**
 * StampedIngestService — 💰 v1.116⟨ids⟩ (API_CONTRACT §IDS.3, ARCHITECTURE §15.2, D-IDS-E/F/G). El paso de productos de LIGA
 * del barrido diario, después de los sets: por grupo de `STAMPED_SOURCE_GROUPS`, `getProducts` + `getPrices` del cliente
 * TCGCSV de siempre, clasificación por `stampTypeOf` (falla cerrado), empate por `baseMatchKey` contra los `CardProduct`
 * `set_base|other` del catálogo:
 *   - 1 carta ⇒ upsert `CardProduct { kind: stamped, … }` (y se borran sus candidatas);
 *   - ≥ 2 ⇒ filas `StampedProductCandidate` (una por carta), que elige quien captura (`attach`, §IDS.4);
 *   - 0 ⇒ nada.
 * Un producto colgado ⛔ no se re-cuelga (conserva su carta). ⛔ Nunca adivina; ⛔ ningún reporte al dueño (I-3): solo el log.
 * Precio: por producto colgado y acabado con `marketPrice > 0` ⇒ `PriceReference` `tcgcsv_singles` con su `cardProductId`
 * (el escritor de singles de siempre, write-on-change) y la FX de la corrida; sin precio ⇒ nada (jamás 0).
 * Un fallo de un grupo no tumba el barrido (log, conserva lo previo).
 */
@Injectable()
export class StampedIngestService {
  private readonly logger = new Logger(StampedIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tcgcsv: TcgcsvCatalogClient,
    private readonly pricing: PricingService,
    // §ALTA-LIGA-2: tras colgar sellos reales, fusiona las versiones manuales equivalentes (best-effort).
    @Optional() private readonly manualMerge?: ManualVersionMergeService,
    // §14.2: candado `price_jump` + freno de cordura para el refresco de liga en sets B3. Sin él, ese refresco no se hace (falla cerrada).
    @Optional() private readonly gate?: AutoLinkPriceGate,
  ) {}

  /** El paso entero (todos los grupos). Devuelve los logs y lo escrito (para el disparo de publicación). */
  async ingestAll(fx: { rate: number; bufferPct: number }): Promise<{ logs: StampedGroupLog[]; written: StampedWritten[] }> {
    const logs: StampedGroupLog[] = [];
    const written: StampedWritten[] = [];
    let index: CatalogMatchIndex | null = null;
    for (const groupId of STAMPED_SOURCE_GROUPS) {
      try {
        index ??= await this.buildCatalogIndex();
        const [products, prices] = await Promise.all([this.tcgcsv.getProducts(groupId), this.tcgcsv.getPrices(groupId)]);
        const r = await this.ingestGroup(groupId, products, prices, index, fx);
        logs.push(r.log);
        written.push(...r.written);
        this.logger.log(`stamped-ingest ${JSON.stringify(r.log)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const log: StampedGroupLog = { grupo: groupId, colgados: 0, ambiguos: 0, sinPareja: 0, sinTipo: 0, sinNumero: 0, ocupados: 0, conPrecio: 0, error: msg };
        logs.push(log);
        this.logger.error(`stamped-ingest grupo ${groupId} FALLÓ (se conserva lo previo): ${msg}`);
      }
    }
    await this.manualMerge?.runAllSafe();
    return { logs, written };
  }

  /**
   * §13.2/§13.3/§14.1 — veredicto del resolver para el set de la carta, cacheado por set dentro de `cache`. FALLA CERRADA: carta/set ausente, error al consultar,
   * resolución nula o `via` desconocido ⇒ `retain`. `b3` ⇒ solo refresco de lo ya publicado (§14.2). `release` ⇒ `via` explícito que libera (confirmed/promo_table/legado)
   * o «no hay grupo» DEFINITIVO (`failure` conocido): se procesa como antes.
   */
  async cardVerdict(cardId: string, cache: Map<string, StampedVerdict>, groups: () => Promise<readonly TcgcsvGroupRef[]>): Promise<StampedVerdict> {
    try {
      // PROJECTION-EXEMPT: lectura interna de los datos del set para resolver su grupo (no es salida al cliente).
      const card = await this.prisma.card.findUnique({
        where: { id: cardId },
        select: { set: { select: { id: true, name: true, pptSetId: true, externalId: true, series: true, releaseDate: true, cardGroupId: true, cardGroupVia: true } } },
      });
      if (!card?.set) return { mode: 'retain' };
      const hit = cache.get(card.set.id);
      if (hit) return hit;
      const res = (await resolveTcgcsvGroupForSet(card.set, groups)) as { groupId?: number | null; via?: string; failure?: string } | null | undefined;
      let v: StampedVerdict;
      if (res == null) v = { mode: 'retain' };
      else if (res.groupId == null) v = res.failure != null && NO_GROUP_FAILURES.has(res.failure) ? { mode: 'release' } : { mode: 'retain' };
      else if (res.via === 'b3') v = { mode: 'b3', setId: card.set.id, groupId: res.groupId };
      else v = shouldRetainTcgcsvPrice({ groupId: res.groupId, via: res.via ?? null }, false) ? { mode: 'retain' } : { mode: 'release' };
      cache.set(card.set.id, v);
      return v;
    } catch (e) {
      this.logger.warn(`stamped-ingest: no se pudo resolver el grupo del set de la carta ${cardId} (${e instanceof Error ? e.message : String(e)}); se retiene.`);
      return { mode: 'retain' };
    }
  }

  /**
   * §14.2 — en sets B3 sin confirmar SOLO se refresca el precio de un `PriceReference` TCGCSV YA existente cuya clave `productId|subtipo` es la de la fila a escribir
   * y cuyo `CardProduct` de liga ya está colgado (la entrada). Pasa por `releaseTcgcsvRow` (tipo `RetainedPriceRow`), por `price_jump` y por el freno de cordura por
   * set. Jamás crea `CardProduct` ni referencias nuevas: una fila sin referencia previa cuenta en `omitted`; una retenida por el candado, en `held`.
   */
  private async refreshPublished(entries: B3RefreshEntry[], fx: { rate: number; bufferPct: number }): Promise<{ omitted: number; held: number; written: { entry: B3RefreshEntry; finish: Finish }[] }> {
    const res = { omitted: 0, held: 0, written: [] as { entry: B3RefreshEntry; finish: Finish }[] };
    if (entries.length === 0) return res;
    const prior = await priorTcgcsvRefKeys(this.prisma, entries.map((e) => e.productId));
    const cands: { entry: B3RefreshEntry; finish: Finish; usd: number; mxn: number }[] = [];
    for (const entry of entries) {
      const seen = new Set<Finish>();
      let lacksPrior = false;
      for (const r of entry.rows) {
        const finish = tcgcsvSubTypeToFinish(r.subTypeName);
        if (finish == null || seen.has(finish)) continue;
        seen.add(finish);
        if (r.marketPrice == null || !(r.marketPrice > 0)) continue;
        const usd = Math.round(r.marketPrice * 100);
        if (usd <= 0) continue;
        if (!prior.has(priorRefKey(entry.productId, finish))) {
          lacksPrior = true;
          continue;
        }
        cands.push({ entry, finish, usd, mxn: usdToMxnCents(usd, fx.rate, fx.bufferPct) });
      }
      if (lacksPrior) res.omitted += 1;
    }
    if (cands.length === 0) return res;
    if (!this.gate) {
      res.held += cands.length; // sin candado no hay refresco (falla cerrada)
      return res;
    }
    const verdicts = await this.gate.evaluate(cands.map((c) => ({ cardId: c.entry.cardId, finish: c.finish, candidateMxnCents: c.mxn })));
    const vOf = (c: (typeof cands)[number]) => verdicts.get(variantKey({ cardId: c.entry.cardId, productType: 'raw', gradeKey: 'raw:NM', finish: c.finish }));
    const tripped = new Set<string>();
    for (const setId of new Set(cands.map((c) => c.entry.setId))) {
      const vs = cands.filter((c) => c.entry.setId === setId).map(vOf).filter((v): v is NonNullable<typeof v> => v != null);
      if (AutoLinkPriceGate.sanity(vs).tripped) {
        tripped.add(setId);
        this.logger.warn(`stamped-ingest: set ${setId} (B3 sin confirmar) frenado por cordura; 0 refrescos de liga.`);
      }
    }
    const heldVerdicts: NonNullable<ReturnType<typeof vOf>>[] = [];
    const writtenKeys: { cardId: string; finish: Finish }[] = [];
    for (const c of cands) {
      const v = vOf(c);
      if (tripped.has(c.entry.setId) || v?.held) {
        res.held += 1;
        if (v?.held) heldVerdicts.push(v);
        continue;
      }
      const row = releaseTcgcsvRow({ groupId: c.entry.groupId, via: 'b3' }, true, { marketCents: c.usd, currency: 'USD' as const, source: 'tcgcsv_singles' as const });
      if (!row) continue;
      await this.pricing.persistMarketReference(c.entry.cardId, c.finish, row, fx, c.entry.cardProductId);
      res.written.push({ entry: c.entry, finish: c.finish });
      writtenKeys.push({ cardId: c.entry.cardId, finish: c.finish });
    }
    await this.gate.recordHeld(heldVerdicts);
    await this.gate.recordWritten(writtenKeys);
    return res;
  }

  /** El índice `catalogMatchKey ⇒ {cardId}` de los productos `set_base|other` del catálogo (una lectura). */
  async buildCatalogIndex(): Promise<CatalogMatchIndex> {
    // PROJECTION-EXEMPT: lectura interna del empate (nombre del producto, número y total de la carta).
    const rows = await this.prisma.cardProduct.findMany({
      where: { kind: { in: ['set_base', 'other'] } },
      select: { cardId: true, name: true, card: { select: { number: true, set: { select: { printedTotal: true } } } } },
    });
    const index: CatalogMatchIndex = new Map();
    for (const r of rows) {
      const k = catalogMatchKey({ name: r.name, cardNumber: r.card.number ?? null, printedTotal: r.card.set?.printedTotal ?? null });
      if (k == null) continue;
      const set = index.get(k) ?? new Set<string>();
      set.add(r.cardId);
      index.set(k, set);
    }
    return index;
  }

  /** Un grupo, sobre productos y precios ya bajados (las pruebas lo llaman con fixture: el egress a TCGCSV está vetado). */
  async ingestGroup(
    groupId: number,
    products: TcgcsvSingleProductRef[],
    prices: TcgcsvPriceRow[],
    index: CatalogMatchIndex,
    fx: { rate: number; bufferPct: number },
  ): Promise<{ log: StampedGroupLog; written: StampedWritten[] }> {
    const log: StampedGroupLog = { grupo: groupId, colgados: 0, ambiguos: 0, sinPareja: 0, sinTipo: 0, sinNumero: 0, ocupados: 0, conPrecio: 0 };
    const written: StampedWritten[] = [];
    const pricesByProduct = new Map<number, TcgcsvPriceRow[]>();
    for (const p of prices) {
      const list = pricesByProduct.get(p.productId) ?? [];
      list.push(p);
      pricesByProduct.set(p.productId, list);
    }
    const existing = new Map(
      (
        await this.prisma.cardProduct.findMany({
          where: { tcgplayerProductId: { in: products.map((p) => p.productId) } },
          select: { id: true, cardId: true, kind: true, tcgplayerProductId: true },
        })
      ).map((r) => [r.tcgplayerProductId, r]),
    );
    const now = new Date();
    const b3Cache = new Map<string, StampedVerdict>();
    const b3Entries: B3RefreshEntry[] = [];
    let groupsOnce: Promise<readonly TcgcsvGroupRef[]> | null = null;
    const groups = (): Promise<readonly TcgcsvGroupRef[]> => (groupsOnce ??= this.tcgcsv.listGroups());
    let b3Omitted = 0;
    for (const p of products) {
      if (p.number == null || p.number.trim() === '') {
        log.sinNumero += 1;
        continue;
      }
      const cls = stampTypeOf(groupId, p.name);
      if (cls == null) {
        log.sinTipo += 1;
        continue;
      }
      const rows = pricesByProduct.get(p.productId) ?? [];
      const finishes = deriveStructuralFinishes(rows.map((r) => r.subTypeName));
      if (finishes.length === 0) {
        log.sinPareja += 1; // sin acabado mapeable: nada que colgar (money-safe)
        continue;
      }
      const prev = existing.get(p.productId);
      let owner: { cardId: string; internalId: string } | null = null;
      if (prev && prev.kind !== 'stamped') {
        log.ocupados += 1;
        continue;
      }
      if (prev) {
        const v = await this.cardVerdict(prev.cardId, b3Cache, groups);
        if (v.mode === 'retain') {
          b3Omitted += 1; // §13.3/§14.1: sin veredicto explícito ⇒ retiene
          continue;
        }
        if (v.mode === 'b3') {
          // §14.2: producto ya colgado en set B3 sin confirmar: solo se refresca su referencia TCGCSV ya publicada (no se toca el CardProduct).
          b3Entries.push({ setId: v.setId, groupId: v.groupId, cardId: prev.cardId, cardProductId: prev.id, productId: p.productId, rows });
          continue;
        }
      }
      if (prev) {
        // Colgado ⇒ no se re-cuelga: conserva su carta; se refrescan nombre, tipo, detalle y acabados.
        await this.prisma.cardProduct.update({
          where: { id: prev.id },
          data: { name: p.name, stampType: cls.type, stampLabel: cls.label, sourceGroupId: groupId, finishes },
        });
        owner = { cardId: prev.cardId, internalId: prev.id };
        log.colgados += 1;
      } else {
        const key = baseMatchKey(p.name, p.number);
        const cards = key ? [...(index.get(key) ?? [])] : [];
        if (cards.length === 0) {
          log.sinPareja += 1;
          continue;
        }
        if (cards.length >= 2) {
          for (const cardId of cards) {
            await this.prisma.stampedProductCandidate.upsert({
              where: { tcgplayerProductId_cardId: { tcgplayerProductId: p.productId, cardId } },
              create: { tcgplayerProductId: p.productId, cardId, groupId, name: p.name, stampType: cls.type, stampLabel: cls.label, finishes, refreshedAt: now },
              update: { groupId, name: p.name, stampType: cls.type, stampLabel: cls.label, finishes, refreshedAt: now },
            });
          }
          log.ambiguos += 1;
          continue;
        }
        if ((await this.cardVerdict(cards[0], b3Cache, groups)).mode !== 'release') {
          b3Omitted += 1; // §13.2/§14.2: en B3 sin confirmar (o sin veredicto) ni se cuelga ni se precia
          continue;
        }
        const created = await this.prisma.$transaction(async (tx) => {
          const cp = await tx.cardProduct.create({
            data: { cardId: cards[0], tcgplayerProductId: p.productId, kind: 'stamped', name: p.name, finishes, stampType: cls.type, stampLabel: cls.label, sourceGroupId: groupId },
            select: { id: true, cardId: true },
          });
          await tx.stampedProductCandidate.deleteMany({ where: { tcgplayerProductId: p.productId } });
          return cp;
        });
        owner = { cardId: created.cardId, internalId: created.id };
        log.colgados += 1;
      }
      const w = await this.writePrices(owner.cardId, owner.internalId, rows, fx);
      if (w.length > 0) log.conPrecio += 1;
      for (const finish of w) written.push({ cardId: owner.cardId, tcgplayerProductId: p.productId, finish });
    }
    if (b3Entries.length > 0) {
      const r = await this.refreshPublished(b3Entries, fx);
      b3Omitted += r.omitted;
      if (r.written.length > 0) log.refreshedPublished = r.written.length;
      if (r.held > 0) log.refreshHeld = r.held;
      for (const w of r.written) written.push({ cardId: w.entry.cardId, tcgplayerProductId: w.entry.productId, finish: w.finish });
    }
    if (b3Omitted > 0) log.omitted = [{ reason: 'b3_unverified', count: b3Omitted }];
    return { log, written };
  }

  /**
   * Precio de UN producto de liga colgado (§IDS.3): por acabado con `marketPrice > 0`, el escritor de singles de siempre
   * (`persistMarketReference`, write-on-change) con SU `cardProductId`. Sin precio ⇒ nada (jamás 0). Devuelve los acabados
   * escritos. Lo usan el barrido y el `attach` (best-effort).
   */
  async writePrices(cardId: string, cardProductInternalId: string, rows: TcgcsvPriceRow[], fx: { rate: number; bufferPct: number }): Promise<Finish[]> {
    const out: Finish[] = [];
    const seen = new Set<Finish>();
    // §13.2/§14: defensa también en el `attach`/refresh: sin veredicto ⇒ 0 precios; set B3 sin confirmar ⇒ solo refresca lo ya publicado (nunca referencias nuevas).
    const verdict = await this.cardVerdict(cardId, new Map(), () => this.tcgcsv.listGroups());
    if (verdict.mode === 'retain') return out;
    if (verdict.mode === 'b3') {
      if (rows.length === 0) return out;
      const r = await this.refreshPublished([{ setId: verdict.setId, groupId: verdict.groupId, cardId, cardProductId: cardProductInternalId, productId: rows[0].productId, rows }], fx);
      return r.written.map((w) => w.finish);
    }
    for (const r of rows) {
      const finish = tcgcsvSubTypeToFinish(r.subTypeName);
      if (finish == null || seen.has(finish)) continue;
      seen.add(finish);
      if (r.marketPrice == null || !(r.marketPrice > 0)) continue;
      const usdCents = Math.round(r.marketPrice * 100);
      if (usdCents <= 0) continue;
      await this.pricing.persistMarketReference(cardId, finish, releaseTcgcsvRow({ groupId: null, via: 'confirmed' }, false, { marketCents: usdCents, currency: 'USD' as const, source: 'tcgcsv_singles' as const })!, fx, cardProductInternalId);
      out.push(finish);
    }
    return out;
  }

  /** Baja el precio de UN grupo y lo escribe para un producto recién colgado (`attach`, best-effort, §IDS.4). */
  async refreshProductPrice(groupId: number, tcgplayerProductId: number, cardId: string, internalId: string, fx: { rate: number; bufferPct: number }): Promise<Finish[]> {
    const prices = await this.tcgcsv.getPrices(groupId);
    return this.writePrices(
      cardId,
      internalId,
      prices.filter((r) => r.productId === tcgplayerProductId),
      fx,
    );
  }
}
