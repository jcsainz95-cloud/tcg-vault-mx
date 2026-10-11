/**
 * wishlist-demand.service.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.8). La «lista de compra casi segura» del dueño (M9,
 * `super_admin`): por (carta, acabado) deseada y SIN piezas vendibles, cuántos la buscan, el máximo de cada nivel CON IVA,
 * «puedes pagar hasta» SIN IVA, el techo principal, mercado, precio normal, cuántos pagan el normal, margen a mercado y lo que
 * pagaría hoy el buylist.
 *
 * ⛔ Sin datos personales (821): la respuesta se construye con una LISTA BLANCA de claves; ni `userId`, ni `wishlistItemId`,
 * ni correo, ni nombre, ni fechas por cuenta. Los sellados van aparte y SOLO con conteo de correos distintos (P-WSH-9).
 * ⛔ Las cifras salen de `common/wishlist-math.ts` (una sola aritmética) y del seam de venta (precio normal).
 */
import { Injectable } from '@nestjs/common';
import { Finish, SealedCondition, SealedSubtype } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CatalogService } from '../catalog/catalog.service';
import { BuylistService } from '../buylist/buylist.service';
import { parseEnumFilter } from '../../common/enum-filter';
import { demandRowMath, WishlistIvaMode, WishlistMarginBasis, WishlistPct } from '../../common/wishlist-math';
import { readWishlistDials } from './wishlist-dials';
import { keyOf, WishlistMarketService } from './wishlist-market.service';
import { listedPiecesForKeys } from './wishlist-pieces';

export const WISHLIST_DEMAND_SORTS = ['wanted', 'ceiling', 'margin', 'market', 'normal', 'buyers', 'buylist'] as const;
export type WishlistDemandSort = (typeof WISHLIST_DEMAND_SORTS)[number];
export const WISHLIST_DEMAND_DIRS = ['asc', 'desc'] as const;

export interface WishlistDemandTierDTO {
  maxPct: WishlistPct;
  accounts: number;
  maxDisplayCents: number | null;
  ceilingCents: number | null;
}
export interface WishlistDemandRowDTO {
  cardId: string;
  cardName: string;
  setName: string;
  number: string;
  finish: Finish;
  imageSmallUrl: string | null;
  wantedCount: number;
  tiers: WishlistDemandTierDTO[];
  mainCeilingCents: number | null;
  marketCents: number | null;
  normalPrice: { listCents: number; displayCents: number } | null;
  buyersAtNormalPrice: number | null;
  marginAtMarket: { cents: number; pct: number } | null;
  buylistTodayCents: number | null;
}
export interface WishlistDemandResponse {
  generatedAt: string;
  dials: { ivaMode: WishlistIvaMode; ivaRatePct: number; ivaTransferPct: number; targetMarginPct: number; marginBasis: WishlistMarginBasis };
  rows: WishlistDemandRowDTO[];
  sealed: { productName: string; sealedSubtype: SealedSubtype | null; sealedCondition: SealedCondition; waitingCount: number }[];
}

const BUYLIST_BATCH = 50;

@Injectable()
export class WishlistDemandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
    private readonly market: WishlistMarketService,
    private readonly buylist: BuylistService,
  ) {}

  parseQuery(q: { sort?: unknown; dir?: unknown }): { sort: WishlistDemandSort; dir: 'asc' | 'desc' | null } {
    const sort = parseEnumFilter('sort', q.sort, WISHLIST_DEMAND_SORTS) ?? 'wanted';
    const dir = parseEnumFilter('dir', q.dir, WISHLIST_DEMAND_DIRS) ?? null;
    return { sort, dir };
  }

  async report(q: { sort?: unknown; dir?: unknown }, now: Date): Promise<WishlistDemandResponse> {
    const { sort, dir } = this.parseQuery(q);
    const dials = await readWishlistDials(this.settings);
    const iva = await this.market.ivaDials();

    // Deseos de cuentas ACTIVAS (cuentan los pausados y sin verificar: siguen siendo demanda).
    const grouped = await this.prisma.wishlistItem.groupBy({
      by: ['cardId', 'finish', 'maxPct'],
      where: { user: { status: 'active' } },
      _count: { _all: true },
    });
    const byKey = new Map<string, { cardId: string; finish: Finish; tiers: Map<number, number> }>();
    for (const g of grouped) {
      const k = keyOf(g);
      const cur = byKey.get(k) ?? { cardId: g.cardId, finish: g.finish, tiers: new Map<number, number>() };
      cur.tiers.set(g.maxPct, (cur.tiers.get(g.maxPct) ?? 0) + g._count._all);
      byKey.set(k, cur);
    }
    // Fuera las que tienen piezas vendibles hoy (819).
    const keys = [...byKey.values()].map((v) => ({ cardId: v.cardId, finish: v.finish }));
    const pieces = await listedPiecesForKeys(this.prisma, keys);
    const sellable = new Set((await this.catalog.sellableByIds(pieces.map((p) => p.id))).map((s) => s.inventoryItemId));
    for (const p of pieces) if (sellable.has(p.id)) byKey.delete(keyOf(p));

    const entries = [...byKey.values()];
    const cards = await this.prisma.card.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.cardId))] } },
      include: { set: true },
    });
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const market = await this.market.marketOf(entries);
    const normal = await this.market.normalPriceOf(
      entries.map((e) => {
        const c = cardById.get(e.cardId);
        return { cardId: e.cardId, finish: e.finish, rarity: c?.rarityCanonical ?? c?.rarity ?? null };
      }),
      market,
      iva,
    );
    const buylistToday = await this.buylistToday(entries);

    const rows: WishlistDemandRowDTO[] = entries.map((e) => {
      const k = keyOf(e);
      const c = cardById.get(e.cardId)!;
      const M = market.get(k) ?? null;
      const np = M == null ? null : (normal.get(k) ?? null);
      const math = demandRowMath({
        marketCents: M,
        normalDisplayCents: np?.displayCents ?? null,
        tiers: [...e.tiers.entries()].map(([maxPct, accounts]) => ({ maxPct: maxPct as WishlistPct, accounts })),
        ivaMode: dials.ivaMode,
        dials: iva,
        targetMarginPct: dials.targetMarginPct,
        marginBasis: dials.marginBasis,
      });
      // ⛔ Lista blanca: exactamente estas claves (821, WSH-T20).
      return {
        cardId: c.id,
        cardName: c.name,
        setName: c.set.name,
        number: c.number,
        finish: e.finish,
        imageSmallUrl: c.imageSmallUrl,
        wantedCount: [...e.tiers.values()].reduce((a, b) => a + b, 0),
        tiers: math.tiers,
        mainCeilingCents: math.mainCeilingCents,
        marketCents: M,
        normalPrice: np,
        buyersAtNormalPrice: math.buyersAtNormalPrice,
        marginAtMarket: math.marginAtMarket,
        buylistTodayCents: buylistToday.get(k) ?? null,
      };
    });
    sortRows(rows, sort, dir);

    return {
      generatedAt: now.toISOString(),
      dials: {
        ivaMode: dials.ivaMode,
        ivaRatePct: iva.ivaRatePct,
        ivaTransferPct: iva.ivaTransferPct,
        targetMarginPct: dials.targetMarginPct,
        marginBasis: dials.marginBasis,
      },
      rows,
      sealed: await this.sealedWaiting(),
    };
  }

  /** `buylist.batchQuote` (raw, NM, acabado) en lotes de ≤ 50; `precio_pendiente` o error por ítem ⇒ `null`. */
  private async buylistToday(entries: { cardId: string; finish: Finish }[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    for (let i = 0; i < entries.length; i += BUYLIST_BATCH) {
      const chunk = entries.slice(i, i + BUYLIST_BATCH);
      const { results } = await this.buylist.batchQuote(
        chunk.map((e) => ({ cardId: e.cardId, productType: 'raw' as const, rawCondition: 'NM' as const, finish: e.finish })),
      );
      for (const r of results) {
        const e = chunk[r.index];
        const v = r.ok && r.quote.status === 'cotizada' ? r.quote.quotedPriceCents : null;
        out.set(keyOf(e), v ?? null);
      }
    }
    return out;
  }

  /** P-WSH-9: SOLO el conteo de correos DISTINTOS con suscripción pendiente, por producto sellado. */
  private async sealedWaiting(): Promise<WishlistDemandResponse['sealed']> {
    const subs = await this.prisma.sealedRestockSubscription.findMany({
      where: { notifiedAt: null },
      select: { email: true, cardId: true, tcgplayerProductId: true, sealedSubtype: true, sealedCondition: true, card: { select: { name: true } } },
    });
    const groups = new Map<string, { productId: number | null; cardName: string; sub: SealedSubtype | null; cond: SealedCondition; emails: Set<string> }>();
    for (const s of subs) {
      const k = s.tcgplayerProductId != null ? `p:${s.tcgplayerProductId}:${s.sealedCondition}` : `c:${s.cardId}:${s.sealedSubtype ?? ''}:${s.sealedCondition}`;
      const g = groups.get(k) ?? { productId: s.tcgplayerProductId, cardName: s.card.name, sub: s.sealedSubtype, cond: s.sealedCondition, emails: new Set<string>() };
      g.emails.add(s.email);
      groups.set(k, g);
    }
    const productIds = [...new Set([...groups.values()].map((g) => g.productId).filter((x): x is number => x != null))];
    const names = new Map<number, string>();
    if (productIds.length > 0) {
      const named = await this.prisma.inventoryItem.findMany({
        where: { productType: 'sealed', tcgplayerProductId: { in: productIds }, sealedProductName: { not: null } },
        select: { tcgplayerProductId: true, sealedProductName: true },
        orderBy: { createdAt: 'desc' },
      });
      for (const n of named) if (n.tcgplayerProductId != null && !names.has(n.tcgplayerProductId)) names.set(n.tcgplayerProductId, n.sealedProductName as string);
    }
    return [...groups.values()]
      .map((g) => ({
        productName: (g.productId != null ? names.get(g.productId) : undefined) ?? g.cardName,
        sealedSubtype: g.sub,
        sealedCondition: g.cond,
        waitingCount: g.emails.size,
      }))
      .sort((a, b) => b.waitingCount - a.waitingCount || a.productName.localeCompare(b.productName));
  }

  /** CSV (§WSH.8, criterio 822): mismas filas y orden que el JSON con el `sort` activo; pesos con 2 decimales. */
  async csv(q: { sort?: unknown; dir?: unknown }, now: Date): Promise<{ filename: string; body: string }> {
    const r = await this.report(q, now);
    const pesos = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
    const tier = (row: WishlistDemandRowDTO, p: WishlistPct) => {
      const t = row.tiers.find((x) => x.maxPct === p);
      return [t ? String(t.accounts) : '0', pesos(t?.maxDisplayCents ?? null), pesos(t?.ceilingCents ?? null)];
    };
    const lines = [
      'carta,set,numero,acabado,la_buscan,cuentas_16,max_16,techo_16,cuentas_10,max_10,techo_10,cuentas_5,max_5,techo_5,' +
        'techo_principal,mercado,normal_sin_iva,normal_con_iva,pagan_normal,margen_mercado,margen_mercado_pct,buylist_hoy',
      ...r.rows.map((row) =>
        [
          text(row.cardName),
          text(row.setName),
          text(row.number),
          row.finish,
          String(row.wantedCount),
          ...tier(row, 16),
          ...tier(row, 10),
          ...tier(row, 5),
          pesos(row.mainCeilingCents),
          pesos(row.marketCents),
          pesos(row.normalPrice?.listCents ?? null),
          pesos(row.normalPrice?.displayCents ?? null),
          row.buyersAtNormalPrice == null ? '' : String(row.buyersAtNormalPrice),
          pesos(row.marginAtMarket?.cents ?? null),
          row.marginAtMarket == null ? '' : row.marginAtMarket.pct.toFixed(1),
          pesos(row.buylistTodayCents),
        ].join(','),
      ),
      '',
      'sellados',
      'producto,presentacion,condicion,esperan',
      ...r.sealed.map((s) => [text(s.productName), s.sealedSubtype ?? '', s.sealedCondition, String(s.waitingCount)].join(',')),
    ];
    return { filename: `lista_de_compra_${r.generatedAt.slice(0, 10)}.csv`, body: `${lines.join('\n')}\n` };
  }
}

/** Celda de texto: entre comillas, comillas dobladas y sin fórmulas (`= + - @` al inicio ⇒ prefijo `'`). */
function text(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Orden (820): por defecto `wantedCount` ↓, `mainCeilingCents` ↓, `marginAtMarket.cents` ↓; sin mercado SIEMPRE al final. */
function sortRows(rows: WishlistDemandRowDTO[], sort: WishlistDemandSort, dir: 'asc' | 'desc' | null): void {
  const val: Record<WishlistDemandSort, (r: WishlistDemandRowDTO) => number | null> = {
    wanted: (r) => r.wantedCount,
    ceiling: (r) => r.mainCeilingCents,
    margin: (r) => r.marginAtMarket?.cents ?? null,
    market: (r) => r.marketCents,
    normal: (r) => r.normalPrice?.displayCents ?? null,
    buyers: (r) => r.buyersAtNormalPrice,
    buylist: (r) => r.buylistTodayCents,
  };
  const sign = (dir ?? 'desc') === 'asc' ? 1 : -1;
  const cmpNum = (a: number | null, b: number | null) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1; // nulos al final en cualquier dirección
    if (b == null) return -1;
    return sign * (a - b);
  };
  rows.sort((a, b) => {
    const am = a.marketCents == null ? 1 : 0;
    const bm = b.marketCents == null ? 1 : 0;
    if (am !== bm) return am - bm;
    const primary = cmpNum(val[sort](a), val[sort](b));
    if (primary !== 0) return primary;
    const tie =
      b.wantedCount - a.wantedCount ||
      cmpDesc(a.mainCeilingCents, b.mainCeilingCents) ||
      cmpDesc(a.marginAtMarket?.cents ?? null, b.marginAtMarket?.cents ?? null);
    return tie || a.cardName.localeCompare(b.cardName) || a.finish.localeCompare(b.finish);
  });
}

function cmpDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}
