/**
 * marketing-search-miss.service.ts — c6 (MKT_PANEL_V2 §6.4, §7): búsquedas SIN resultado, contadas en PERSONAS, no en peticiones.
 * ⛔ Sin usuario, sin IP, sin cookie guardados. Al llegar un término se filtra (PII → normalización `[a-z0-9ñ ]` ≤ 40, ≤ 4 palabras →
 * LISTA PERMITIDA de vocabulario del catálogo) y se anota `h = HMAC-SHA256(sal del día, ip|user-agent)` (16 hex) en
 * `SearchNoResultSeen`. La sal es aleatoria por día CDMX (memoria + `ConfigSetting` `search_salt_<día>`). Al cierre (job
 * `marketing-search-close` 00:10 CDMX, y perezoso al escribir) `people = COUNT(h)` pasa a `SearchNoResultDaily` y se BORRAN los
 * hashes y la sal: el hash no sirve al día siguiente. Topes (MKV2-2): ≤ 300 términos/día y ≤ 200 hashes por (término, día).
 * Apagable con `marketing_search_log` (ausente = encendido). Retención: bajo el umbral 30 días, sobre él 90.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { toMexicoCityDateKey } from '../../common/business-days';
import { addDays } from '../sales-analytics/sales-period';
import { containsPii } from './marketing-pii-filter';
import { MarketingSearchVocabulary, foldSearchText } from './marketing-search-vocabulary';

export const SEARCH_MISS_TERM_MAX = 40;
export const SEARCH_MISS_WORDS_MAX = 4;
export const SEARCH_MISS_FLAG = 'marketing_search_log';
export const SEARCH_MISS_RETENTION_BELOW_DAYS = 30;
export const SEARCH_MISS_RETENTION_VISIBLE_DAYS = 90;
/** Umbral de lectura: ≥ 5 PERSONAS en total y ≥ 2 días con ≥ 2 personas cada uno. */
export const SEARCH_MISS_MIN_PEOPLE = 5;
export const SEARCH_MISS_MIN_DAYS = 2;
export const SEARCH_MISS_MIN_PEOPLE_PER_DAY = 2;
export const SEARCH_MISS_MAX_TERMS_PER_DAY = 300;
export const SEARCH_MISS_MAX_HASHES_PER_TERM = 200;
export const SEARCH_SALT_PREFIX = 'search_salt_';
const LAZY_CLOSE_EVERY_MS = 60_000;

/** Término listo para evaluar contra el vocabulario (`[a-z0-9ñ ]`, ≤ 40, ≤ 4 palabras) o `null`. PURO (sin vocabulario). */
export function normalizeSearchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 80) return null;
  if (containsPii(raw)) return null;
  const t = foldSearchText(raw).slice(0, SEARCH_MISS_TERM_MAX).trim();
  if (t.length < 2) return null;
  if (t.split(' ').length > SEARCH_MISS_WORDS_MAX) return null;
  if (containsPii(t)) return null; // segunda pasada sobre el texto normalizado
  return t;
}

/** Quien escribe: solo para el hash del día; ⛔ nunca se guarda. */
export interface SearchMissClient {
  ip?: string;
  userAgent?: string;
}

export interface SearchMissRow {
  term: string;
  people: number;
  days: number;
}

/** Agrega filas diarias (término × día × personas) y aplica el umbral de lectura. PURO. */
export function qualifyingSearchMisses(rows: { termNormalized: string; people: number }[]): SearchMissRow[] {
  const acc = new Map<string, { people: number; days: number }>();
  for (const r of rows) {
    const e = acc.get(r.termNormalized) ?? { people: 0, days: 0 };
    e.people += r.people;
    if (r.people >= SEARCH_MISS_MIN_PEOPLE_PER_DAY) e.days += 1;
    acc.set(r.termNormalized, e);
  }
  return [...acc.entries()]
    .filter(([, e]) => e.people >= SEARCH_MISS_MIN_PEOPLE && e.days >= SEARCH_MISS_MIN_DAYS)
    .map(([term, e]) => ({ term, people: e.people, days: e.days }));
}

@Injectable()
export class MarketingSearchMissService {
  private readonly logger = new Logger(MarketingSearchMissService.name);
  private readonly salts = new Map<string, string>();
  private lastLazyClose = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly vocabulary?: MarketingSearchVocabulary,
  ) {}

  private async enabled(): Promise<boolean> {
    const row = await this.prisma.configSetting.findUnique({ where: { key: SEARCH_MISS_FLAG }, select: { valueJson: true } });
    return row?.valueJson !== 'off';
  }

  /** Sal del día: memoria → `ConfigSetting` → alta automática (`ON CONFLICT DO NOTHING` y relectura: varias réplicas coinciden). */
  private async saltOf(day: string): Promise<string> {
    const hit = this.salts.get(day);
    if (hit) return hit;
    const key = `${SEARCH_SALT_PREFIX}${day}`;
    const fresh = randomBytes(32).toString('hex');
    await this.prisma.$executeRaw`INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedAt") VALUES (${key}, to_jsonb(${fresh}::text), now()) ON CONFLICT ("key") DO NOTHING`;
    const row = await this.prisma.configSetting.findUniqueOrThrow({ where: { key }, select: { valueJson: true } });
    const salt = String(row.valueJson);
    this.salts.set(day, salt);
    return salt;
  }

  /** Cuenta UNA persona (hash del día) para el término. ⛔ Nunca lanza hacia fuera (el endpoint responde 204 siempre). */
  async record(rawTerm: unknown, client: SearchMissClient = {}, now = new Date()): Promise<boolean> {
    try {
      const term = normalizeSearchTerm(rawTerm);
      if (term === null || !(await this.enabled())) return false;
      if (!this.vocabulary || !(await this.vocabulary.allows(term, now.getTime()))) return false;
      const day = toMexicoCityDateKey(now);
      await this.lazyClose(now);
      const salt = await this.saltOf(day);
      const h = createHmac('sha256', salt).update(`${client.ip ?? ''}|${client.userAgent ?? ''}`).digest('hex').slice(0, 16);
      // Topes en la MISMA sentencia: ≤ 200 hashes por (término, día) y ≤ 300 términos distintos por día. Pasado el tope no escribe.
      const n = await this.prisma.$executeRaw`
        INSERT INTO "SearchNoResultSeen" ("termNormalized", "day", "h")
        SELECT ${term}::text, ${day}::date, ${h}::text
         WHERE (SELECT count(*) FROM "SearchNoResultSeen" WHERE "termNormalized" = ${term}::text AND "day" = ${day}::date) < ${SEARCH_MISS_MAX_HASHES_PER_TERM}::int
           AND (EXISTS (SELECT 1 FROM "SearchNoResultSeen" WHERE "termNormalized" = ${term}::text AND "day" = ${day}::date)
                OR (SELECT count(DISTINCT "termNormalized") FROM "SearchNoResultSeen" WHERE "day" = ${day}::date) < ${SEARCH_MISS_MAX_TERMS_PER_DAY}::int)
        ON CONFLICT DO NOTHING`;
      return n > 0;
    } catch (e) {
      this.logger.warn(`search-miss no registrado (${e instanceof Error ? e.constructor.name : 'error'})`);
      return false;
    }
  }

  /** Cierre perezoso: si quedan hashes de días pasados (el job no corrió), se cierran, como mucho una vez por minuto. */
  private async lazyClose(now: Date): Promise<void> {
    if (now.getTime() - this.lastLazyClose < LAZY_CLOSE_EVERY_MS) return;
    this.lastLazyClose = now.getTime();
    try {
      await this.closePastDays(now);
    } catch (e) {
      this.logger.warn(`search-miss: cierre perezoso falló (${e instanceof Error ? e.constructor.name : 'error'})`);
    }
  }

  /**
   * Job `marketing-search-close` (00:10 CDMX): vuelca `COUNT(h)` por (término, día pasado) a `SearchNoResultDaily` y borra los
   * hashes y las sales de esos días, en UNA transacción por día (idempotente: sin hashes no hay nada que volcar). Un fallo lanza
   * para que la cola reintente. Devuelve cuántos días cerró.
   */
  async closePastDays(now = new Date()): Promise<number> {
    const today = toMexicoCityDateKey(now);
    const open = await this.prisma.$queryRaw<{ d: string }[]>`SELECT DISTINCT to_char("day", 'YYYY-MM-DD') AS d FROM "SearchNoResultSeen" WHERE "day" < ${today}::date ORDER BY 1`;
    for (const { d } of open) {
      await this.prisma.$transaction([
        this.prisma.$executeRaw`
          INSERT INTO "SearchNoResultDaily" ("id", "termNormalized", "day", "people")
          SELECT gen_random_uuid()::text, "termNormalized", "day", count(*)::int FROM "SearchNoResultSeen" WHERE "day" = ${d}::date GROUP BY "termNormalized", "day"
          ON CONFLICT ("termNormalized", "day") DO UPDATE SET "people" = "SearchNoResultDaily"."people" + EXCLUDED."people"`,
        this.prisma.$executeRaw`DELETE FROM "SearchNoResultSeen" WHERE "day" = ${d}::date`,
      ]);
    }
    // Sales de días pasados (también las huérfanas): ya no sirven y no se guardan.
    const staleKey = `${SEARCH_SALT_PREFIX}${today}`;
    await this.prisma.$executeRaw`DELETE FROM "ConfigSetting" WHERE "key" LIKE ${SEARCH_SALT_PREFIX + '%'} AND "key" < ${staleKey}`;
    for (const k of [...this.salts.keys()]) if (k < today) this.salts.delete(k);
    if (open.length > 0) this.logger.log(`marketing-search-close: ${open.length} día(s) cerrado(s)`);
    return open.length;
  }

  /** Filas de c6 del rango que pasan el umbral (personas) y el vocabulario AL LEER. `null` ⇒ no se pudo leer. */
  async readQualifying(from: string, to: string): Promise<SearchMissRow[] | null> {
    try {
      if (!(await this.enabled())) return [];
      if (!this.vocabulary) return [];
      const rows = await this.prisma.searchNoResultDaily.findMany({
        where: { day: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
        select: { termNormalized: true, people: true },
      });
      const out: SearchMissRow[] = [];
      for (const r of qualifyingSearchMisses(rows)) {
        const t = normalizeSearchTerm(r.term);
        if (t !== null && t === r.term && (await this.vocabulary.allows(t))) out.push(r);
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Job `marketing-search-miss-retention` (diario): ver cabecera. Devuelve cuántas filas borró. */
  async purgeExpired(now = new Date()): Promise<number> {
    const today = toMexicoCityDateKey(now);
    const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
    const visibleCutoff = dayDate(addDays(today, -SEARCH_MISS_RETENTION_VISIBLE_DAYS));
    const belowCutoff = dayDate(addDays(today, -SEARCH_MISS_RETENTION_BELOW_DAYS));
    const old = await this.prisma.searchNoResultDaily.deleteMany({ where: { day: { lt: visibleCutoff } } });
    const all = await this.prisma.searchNoResultDaily.findMany({ select: { termNormalized: true, people: true } });
    const keep = qualifyingSearchMisses(all).map((r) => r.term);
    const below = await this.prisma.searchNoResultDaily.deleteMany({ where: { day: { lt: belowCutoff }, termNormalized: { notIn: keep } } });
    this.logger.log(`marketing-search-miss-retention: ${old.count + below.count} fila(s) borradas`);
    return old.count + below.count;
  }
}
