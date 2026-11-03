import { Injectable, Logger } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { baseMatchKey, catalogMatchKey, STAMPED_SOURCE_GROUPS, stampTypeOf } from '../../common/card-version';
import { deriveStructuralFinishes, tcgcsvSubTypeToFinish, TcgcsvPriceRow, TcgcsvSingleProductRef } from './pricing.types';
import { TcgcsvCatalogClient } from './providers/tcgcsv-singles.provider';
import { PricingService } from './pricing.service';

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
  error?: string;
}

/** Un producto de liga colgado y sus acabados con precio escrito (para el disparo de publicación). */
export interface StampedWritten {
  cardId: string;
  tcgplayerProductId: number;
  finish: Finish;
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
    return { logs, written };
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
    for (const r of rows) {
      const finish = tcgcsvSubTypeToFinish(r.subTypeName);
      if (finish == null || seen.has(finish)) continue;
      seen.add(finish);
      if (r.marketPrice == null || !(r.marketPrice > 0)) continue;
      const usdCents = Math.round(r.marketPrice * 100);
      if (usdCents <= 0) continue;
      await this.pricing.persistMarketReference(cardId, finish, { marketCents: usdCents, currency: 'USD', source: 'tcgcsv_singles' }, fx, cardProductInternalId);
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
