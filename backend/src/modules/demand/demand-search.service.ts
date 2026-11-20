/**
 * demand-search.service.ts — §DEMANDA F2 (API_CONTRACT_DEMANDA §3, §5): la ESCRITURA de la demanda por carta agotada
 * (`SearchDemandSeen`/`SearchDemandDaily`/`DemandTermMatch`) vive aquí, no en `marketing-search-miss.service.ts` (DM-5; frontera en
 * ARCHITECTURE). Marketing solo DELEGA: calcula el día y el hash (sal del día de c6, **solo la IP**: el user-agent NO entra al hash,
 * DM-1) y llama a este servicio. Sin dependencia de Marketing ⇒ sin ciclo de módulos.
 *
 * Reglas (nunca se confía en el cliente): `cardId` verificado en el servidor (existe y 0 stock vendible = mismo predicado que
 * `GET /catalog/cards`); UA vacío o de robot ⇒ no cuenta; topes ≤ 200 hashes por (cardId, día), ≤ 10 cardId por persona y día (DM-1) y
 * ≤ 1000 cardId por día, EXENTOS del global los cardId con wishlist activa o con fila en `SearchDemandDaily` de los últimos 30 d (DM-2:
 * un relleno no desplaza a las cartas reales). ⛔ Sin IP/UA/cookie/usuario guardados.
 */
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

export const SEARCH_DEMAND_MAX_HASHES_PER_CARD = 200;
export const SEARCH_DEMAND_MAX_CARDS_PER_PERSON = 10;
export const SEARCH_DEMAND_MAX_CARDS_PER_DAY = 1000;
export const SEARCH_DEMAND_EXEMPT_DAYS = 30;
export const SEARCH_DEMAND_VERIFY_TTL_MS = 60_000;
export const SEARCH_DEMAND_VERIFY_MAX_ENTRIES = 5000;
export const SEARCH_DEMAND_DAY_NAMESPACE = 98_130_202;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT_UA_RE = /bot|crawl|spider|slurp|headless|preview|curl|wget|python|httpclient/i;

/** `unknown` (no existe) ⇒ camino de texto; `stocked` ⇒ no es hueco; `empty` ⇒ cuenta. */
export type CardDemandState = 'unknown' | 'stocked' | 'empty';
/** Qué hace el llamador con una petición con `cardId`: `skip` = 204 sin contar; `text` = camino de texto de siempre; `count` = contar persona. */
export type CardDemandVerdict = 'skip' | 'text' | 'count';

/** UA vacío o de robot (§3 regla 2b). PURO. */
export function isBotUserAgent(ua: unknown): boolean {
  if (typeof ua !== 'string' || ua.trim() === '') return true;
  return BOT_UA_RE.test(ua);
}

@Injectable()
export class DemandSearchService {
  private readonly cardState = new Map<string, { state: CardDemandState; exp: number }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly catalog?: CatalogService,
  ) {}

  /**
   * Veredicto para una petición con `cardId` uuid. Robot ⇒ `skip` (el servidor es la autoridad; el front además filtra). Con stock ⇒ `skip`
   * (no es hueco). Inexistente ⇒ `text`. 0 stock ⇒ `count`.
   */
  async classify(cardId: string, userAgent: unknown, now: Date): Promise<CardDemandVerdict> {
    if (isBotUserAgent(userAgent)) return 'skip';
    const state = await this.verifyCard(cardId.toLowerCase(), now);
    if (state === 'stocked') return 'skip';
    return state === 'empty' ? 'count' : 'text';
  }

  /** Caché 60 s, ≤ 5000 entradas, evicción O(1) del más antiguo por orden de inserción del `Map` (sin barrer). */
  private async verifyCard(cardId: string, now: Date): Promise<CardDemandState> {
    const t = now.getTime();
    const hit = this.cardState.get(cardId);
    if (hit && hit.exp > t) return hit.state;
    let state: CardDemandState = 'unknown';
    if (this.catalog) {
      const exists = await this.prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
      if (exists) state = (await this.catalog.cardIdsWithSellable([cardId])).has(cardId) ? 'stocked' : 'empty';
    }
    // Reinsertar mueve la clave al final: el primero del Map es siempre el más antiguo.
    this.cardState.delete(cardId);
    if (this.cardState.size >= SEARCH_DEMAND_VERIFY_MAX_ENTRIES) {
      const oldest = this.cardState.keys().next();
      if (!oldest.done) this.cardState.delete(oldest.value);
    }
    this.cardState.set(cardId, { state, exp: t + SEARCH_DEMAND_VERIFY_TTL_MS });
    return state;
  }

  /** Tamaño de la caché (solo pruebas). */
  cacheSize(): number {
    return this.cardState.size;
  }

  /**
   * Cuenta UNA persona (`h` = HMAC del día sobre la IP, calculado por Marketing) para (cardId, día), con los topes en la MISMA sentencia y
   * bajo el candado consultivo del día. `closedThroughKey` = marca de cierre de c6 (ningún hash resucita un día cerrado).
   */
  async recordSeen(cardId: string, day: string, h: string, closedThroughKey: string): Promise<boolean> {
    const [, n] = await this.prisma.$transaction([
      this.prisma.$executeRaw`SELECT pg_advisory_xact_lock(${SEARCH_DEMAND_DAY_NAMESPACE}::int, hashtext(${day}))`,
      this.prisma.$executeRaw`
        INSERT INTO "SearchDemandSeen" ("cardId", "day", "h")
        SELECT ${cardId}::text, ${day}::date, ${h}::text
         WHERE ${day}::text >= COALESCE((SELECT "valueJson"#>>'{}' FROM "ConfigSetting" WHERE "key" = ${closedThroughKey}), '0000-00-00')
           AND (SELECT count(*) FROM "SearchDemandSeen" WHERE "cardId" = ${cardId}::text AND "day" = ${day}::date) < ${SEARCH_DEMAND_MAX_HASHES_PER_CARD}::int
           AND (SELECT count(*) FROM "SearchDemandSeen" WHERE "day" = ${day}::date AND "h" = ${h}::text) < ${SEARCH_DEMAND_MAX_CARDS_PER_PERSON}::int
           AND (EXISTS (SELECT 1 FROM "SearchDemandSeen" WHERE "cardId" = ${cardId}::text AND "day" = ${day}::date)
                OR (SELECT count(DISTINCT "cardId") FROM "SearchDemandSeen" WHERE "day" = ${day}::date) < ${SEARCH_DEMAND_MAX_CARDS_PER_DAY}::int
                OR EXISTS (SELECT 1 FROM "WishlistItem" WHERE "cardId" = ${cardId}::text)
                OR EXISTS (SELECT 1 FROM "SearchDemandDaily" WHERE "cardId" = ${cardId}::text AND "day" >= ${day}::date - ${SEARCH_DEMAND_EXEMPT_DAYS}::int))
        ON CONFLICT DO NOTHING`,
    ]);
    return n > 0;
  }

  /** Días anteriores a `today` con hashes de demanda pendientes de cerrar (`YYYY-MM-DD`). */
  async openDays(today: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ d: string }[]>`
      SELECT DISTINCT to_char("day", 'YYYY-MM-DD') AS d FROM "SearchDemandSeen" WHERE "day" < ${today}::date`;
    return rows.map((r) => r.d);
  }

  /** Operaciones del cierre de UN día (volcar `COUNT(h)` a `SearchDemandDaily` y borrar los hashes); Marketing las mete en SU transacción. */
  closeDayOps(d: string): Prisma.PrismaPromise<number>[] {
    return [
      this.prisma.$executeRaw`
        INSERT INTO "SearchDemandDaily" ("id", "cardId", "day", "people")
        SELECT gen_random_uuid()::text, "cardId", "day", count(*)::int FROM "SearchDemandSeen" WHERE "day" = ${d}::date GROUP BY "cardId", "day"
        ON CONFLICT ("cardId", "day") DO UPDATE SET "people" = "SearchDemandDaily"."people" + EXCLUDED."people"`,
      this.prisma.$executeRaw`DELETE FROM "SearchDemandSeen" WHERE "day" = ${d}::date`,
    ];
  }

  /**
   * Retención: `SearchDemandDaily` > 90 d y bajo umbral > 30 d (misma regla que c6, por cardId; `keepCards` lo calcula quien conoce la
   * función de umbral) y `DemandTermMatch` cuyo término ya no existe en `SearchNoResultDaily`. Devuelve filas borradas.
   */
  async purgeExpired(visibleCutoff: Date, belowCutoff: Date, qualifying: (rows: { cardId: string; day: Date; people: number }[]) => string[]): Promise<number> {
    const old = await this.prisma.searchDemandDaily.deleteMany({ where: { day: { lt: visibleCutoff } } });
    const all = await this.prisma.searchDemandDaily.findMany({ select: { cardId: true, day: true, people: true } });
    const below = await this.prisma.searchDemandDaily.deleteMany({ where: { day: { lt: belowCutoff }, cardId: { notIn: qualifying(all) } } });
    const orphans = await this.prisma.$executeRaw`DELETE FROM "DemandTermMatch" m WHERE NOT EXISTS (SELECT 1 FROM "SearchNoResultDaily" d WHERE d."termNormalized" = m."termNormalized")`;
    return old.count + below.count + orphans;
  }
}
