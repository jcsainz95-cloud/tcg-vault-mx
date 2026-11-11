/**
 * index-inspection.service.ts — §GSHOP.A (docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md): job `gsc-index-inspect` y lectura para el aviso AV7.
 *
 * Cada tick (6 al día, 03:00-08:00 CDMX): relee el universo (sitemap + páginas clave), sincroniza la tabla `IndexInspection` (altas y
 * bajas), calcula cuántas consultas van HOY (presupuesto propio de 250), toma las filas con `lastCheckedAt` más viejo (NULL primero; las
 * páginas clave no revisadas hoy primero) y las inspecciona en lotes de 40 con concurrencia 2. Idempotente por selección (sin estado de
 * «corrida»): un tick que muere deja las filas sin tocar y el siguiente retoma. 429/5xx ⇒ backoff 2-4-8 s ×3 por URL y se corta el tick;
 * 403 ⇒ se detiene ese día (marca en `ConfigSetting`), sin aviso falso (AV7 dice «No se evaluó…»). Sin cuenta/propiedad ⇒ no hace nada.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toMexicoCityDateKey } from '../../common/business-days';
import { CatalogService } from '../catalog/catalog.service';
import { SealedCatalogService } from '../catalog/sealed-catalog.service';
import { MarketingExternalSources, type UrlInspectOutcome } from './marketing-external-sources';
import {
  COVERAGE_WINDOW_MS,
  GSC_INSPECT_BACKOFF_MS,
  GSC_INSPECT_BATCH,
  GSC_INSPECT_CONCURRENCY,
  GSC_INSPECT_DAILY_BUDGET,
  GSC_INSPECT_FLAG,
  GSC_INSPECT_STATE_KEY,
  MIN_COVERAGE,
  GSC_INSPECT_MIN_GAP_MS,
  SITEMAP_ORIGIN,
  classifyInspection,
  nextFlagState,
  noticeableUrls,
  summarizeAv7,
  type Av7Summary,
  type FlagState,
  type IndexFlag,
  type NoticeRow,
} from './index-inspection';

/**
 * Conjunto de respaldo de páginas clave si no se puede descargar `sitemap.xml` (spec §A «Limitaciones» 1). La fuente normal es el
 * `sitemap.xml` publicado; una prueba compara este respaldo con el `STATIC_PATHS` real del front.
 */
export const KEY_PAGE_FALLBACK = ['/es', '/es/catalog', '/es/sellado', '/es/accesorios', '/es/decks-meta', '/es/buylist', '/es/terminos', '/es/privacidad', '/es/nosotros', '/card-show'] as const;
const AV7_CACHE_MS = 10 * 60 * 1000;

export type TickOutcome = 'off' | 'not_configured' | 'no_origin' | 'no_universe' | 'denied_today' | 'budget' | 'forbidden' | 'rate_limited' | 'transient' | 'done';
export interface TickResult {
  job: 'gsc-index-inspect';
  outcome: TickOutcome;
  inspected: number;
  doneToday: number;
}

interface JobState {
  /** Día CDMX del último 403 sin resolver (se limpia con una inspección correcta). */
  deniedDay?: string;
  /** Día CDMX en que un 429 `RESOURCE_EXHAUSTED` fijó el tope del día, y ese tope. */
  capDay?: string;
  cap?: number;
}

export interface Av7Input {
  /** URLs que este resultado incluye (para marcarlas como avisadas tras el envío del correo). */
  urls?: string[];
  /** Texto para «No se evaluó: …»; `null` si se evaluó. */
  missing: string | null;
  summary: Av7Summary | null;
}

@Injectable()
export class IndexInspectionService {
  private readonly logger = new Logger(IndexInspectionService.name);
  private av7Cache: { at: number; forEmail: boolean; value: Av7Input } | null = null;
  private lastCall = 0;
  /** Espera del backoff; reemplazable en pruebas. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Pausa de ritmo (≤ 2 consultas/s); separada de `sleep` (backoff) para poder medirlas por separado. */
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Descarga de texto (el `sitemap.xml` publicado); reemplazable en pruebas. `null` si falla. */
  fetchText: (url: string) => Promise<string | null> = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly external: MarketingExternalSources,
    private readonly catalog: CatalogService,
    private readonly sealed: SealedCatalogService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  // ───────── universo ─────────

  /**
   * Origen de las URLs inspeccionadas = host canónico del sitemap (`https://tcghunt.mx`), NUNCA `APP_PUBLIC_URL`/`APP_BASE_URL` (un
   * `www` respondería 308 ⇒ falso «sin problemas»). Con propiedad de prefijo de URL de OTRO host no se consulta (`null`); con
   * `sc-domain:` vale el mismo origen.
   */
  origin(): string | null {
    const prop = this.external.searchConsoleOrigin();
    return prop && prop !== SITEMAP_ORIGIN ? null : SITEMAP_ORIGIN;
  }

  /**
   * Páginas clave = las `<loc>` del `sitemap.xml` publicado, menos `/<locale>/catalog/…` y `/<locale>/sellado/…` (esas vienen de
   * `GET /catalog/sitemap`). Sin lista a mano: guías y preguntas nuevas entran solas. Descarga fallida ⇒ conjunto de respaldo.
   */
  async keyPagePaths(origin: string): Promise<string[]> {
    const xml = await this.fetchText(`${origin}/sitemap.xml`);
    const paths = new Set<string>();
    if (xml) {
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        let u: URL;
        try {
          u = new URL(m[1].replace(/&amp;/g, '&'));
        } catch {
          continue;
        }
        if (u.origin !== origin) continue;
        const path = u.pathname.replace(/\/+$/, '') || '/';
        if (/^\/(?:[a-z]{2}\/)?(?:catalog|sellado)\//.test(path)) continue;
        paths.add(path);
      }
    }
    if (paths.size === 0) {
      this.logger.warn('gsc-index-inspect: no se pudo leer sitemap.xml; se usa el conjunto de páginas clave de respaldo');
      return [...KEY_PAGE_FALLBACK];
    }
    return [...paths].sort();
  }

  /** Universo ACTUAL: páginas clave + una URL por carta y por grupo de sellado a la venta (la misma regla que `GET /catalog/sitemap`). */
  async universe(origin: string): Promise<{ url: string; kind: 'card' | 'sealed' | 'key' }[]> {
    const [cards, sealed, keyPaths] = await Promise.all([this.catalog.sitemapCardEntries(), this.sealed.sitemapSealedEntries(), this.keyPagePaths(origin)]);
    return [
      ...keyPaths.map((p) => ({ url: `${origin}${p}`, kind: 'key' as const })),
      ...cards.map((c) => ({ url: `${origin}/es/catalog/${encodeURIComponent(c.id)}`, kind: 'card' as const })),
      ...sealed.map((c) => ({ url: `${origin}/es/sellado/${encodeURIComponent(c.id)}`, kind: 'sealed' as const })),
    ];
  }

  // ───────── estado / interruptor ─────────

  private async enabled(): Promise<boolean> {
    const f = await this.prisma.configSetting.findUnique({ where: { key: GSC_INSPECT_FLAG }, select: { valueJson: true } });
    return f?.valueJson !== 'off';
  }

  private async readState(): Promise<JobState> {
    const row = await this.prisma.configSetting.findUnique({ where: { key: GSC_INSPECT_STATE_KEY }, select: { valueJson: true } });
    const v = row?.valueJson;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as JobState) : {};
  }

  private async writeState(s: JobState): Promise<void> {
    const json: Prisma.InputJsonObject = { ...s };
    await this.prisma.configSetting.upsert({
      where: { key: GSC_INSPECT_STATE_KEY },
      create: { key: GSC_INSPECT_STATE_KEY, valueJson: json },
      update: { valueJson: json },
    });
  }

  /** Inicio (instante UTC) del día CDMX de `now` (sin horario de verano desde 2022: UTC−6). */
  private dayStart(now: Date): Date {
    return new Date(`${toMexicoCityDateKey(now)}T06:00:00.000Z`);
  }

  // ───────── job ─────────

  async tick(now = new Date()): Promise<TickResult> {
    const res = (outcome: TickOutcome, inspected = 0, doneToday = 0): TickResult => ({ job: 'gsc-index-inspect', outcome, inspected, doneToday });
    if (!(await this.enabled())) return res('off');
    if (!this.external.searchConsoleConfigured()) return res('not_configured');
    const origin = this.origin();
    if (!origin) return res('no_origin');
    const today = toMexicoCityDateKey(now);
    let state = await this.readState();
    if (state.deniedDay === today) return res('denied_today');

    const universe = await this.universe(origin);
    if (universe.length === 0) return res('no_universe'); // sitemap vacío o caído: no se borra nada
    await this.sync(universe, now);

    const start = this.dayStart(now);
    const doneToday = await this.prisma.indexInspection.count({ where: { lastCheckedAt: { gte: start } } });
    const budget = state.capDay === today && typeof state.cap === 'number' ? Math.min(GSC_INSPECT_DAILY_BUDGET, state.cap) : GSC_INSPECT_DAILY_BUDGET;
    const remaining = budget - doneToday;
    if (remaining <= 0) return res('budget', 0, doneToday);

    const keyPending = await this.prisma.indexInspection.findMany({
      where: { kind: 'key', OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: start } }] },
      orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { url: 'asc' }],
      take: remaining,
      select: { url: true },
    });
    const rest = remaining - keyPending.length;
    const others =
      rest > 0
        ? await this.prisma.indexInspection.findMany({
            where: { kind: { not: 'key' }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: start } }] },
            orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { url: 'asc' }],
            take: rest,
            select: { url: true },
          })
        : [];
    // Nunca se consulta una URL fuera del host canónico (una fila vieja de otro origen se ignora; `sync` la borra).
    const queue = [...keyPending, ...others].map((r) => r.url).filter((u) => u.startsWith(`${origin}/`));

    let inspected = 0;
    let invalid = 0;
    let stop: TickOutcome | null = null;
    for (let i = 0; i < queue.length && !stop; i += GSC_INSPECT_BATCH) {
      const batch = queue.slice(i, i + GSC_INSPECT_BATCH);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (!stop && cursor < batch.length) {
          const url = batch[cursor++];
          const out = await this.inspectWithBackoff(url);
          if (out.kind === 'ok') {
            await this.record(url, out, now);
            inspected += 1;
          } else if (out.kind === 'invalid') {
            // Respuesta sin veredicto o 400 para esa URL: se anota la revisión (para no repetirla en bucle) sin tocar su flag.
            await this.prisma.indexInspection.updateMany({ where: { url }, data: { lastCheckedAt: now } });
            inspected += 1;
            invalid += 1;
            this.logger.warn(`gsc-index-inspect: respuesta inválida (${out.errClass ?? 'sin clase'})`);
            if (invalid >= 5) stop = 'transient';
          } else if (out.kind === 'forbidden') {
            stop = 'forbidden';
          } else if (out.kind === 'rate_limited') {
            stop = 'rate_limited';
            if ((out.errClass ?? '').includes('RESOURCE_EXHAUSTED')) state = { ...state, capDay: today, cap: doneToday + inspected };
          } else {
            stop = 'transient';
          }
        }
      };
      await Promise.all(Array.from({ length: GSC_INSPECT_CONCURRENCY }, () => worker()));
    }

    if (stop === 'forbidden') {
      await this.writeState({ ...state, deniedDay: today });
      this.logger.warn('gsc-index-inspect: 403 de Search Console (sin permiso para URL Inspection); se detiene hoy');
    } else {
      if (inspected > 0 && state.deniedDay) {
        state = { ...state };
        delete state.deniedDay;
      }
      if (stop === 'rate_limited' && state.capDay === today) this.logger.warn(`gsc-index-inspect: 429 RESOURCE_EXHAUSTED; tope del día = ${state.cap}`);
      if (JSON.stringify(state) !== JSON.stringify(await this.readState())) await this.writeState(state);
    }
    this.av7Cache = null;
    return res(stop ?? 'done', inspected, doneToday + inspected);
  }

  /** Pausa explícita: ≤ 2 consultas/s a Google en total (las dos tareas en paralelo comparten el reloj). */
  private async pace(): Promise<void> {
    const slot = Math.max(Date.now(), this.lastCall + GSC_INSPECT_MIN_GAP_MS);
    this.lastCall = slot;
    const wait = slot - Date.now();
    if (wait > 0) await this.pause(wait);
  }

  private async inspectWithBackoff(url: string): Promise<UrlInspectOutcome> {
    await this.pace();
    let out = await this.external.urlInspect(url);
    for (const wait of GSC_INSPECT_BACKOFF_MS) {
      if (out.kind !== 'rate_limited' && out.kind !== 'transient') return out;
      await this.sleep(wait);
      await this.pace();
      out = await this.external.urlInspect(url);
    }
    return out;
  }

  /** Altas (primera vez en el universo) y bajas (la ficha ya no está a la venta ⇒ su fila se borra: una carta vendida no genera «404»). */
  private async sync(universe: { url: string; kind: string }[], now: Date): Promise<void> {
    const urls = universe.map((u) => u.url);
    await this.prisma.indexInspection.createMany({ data: universe.map((u) => ({ url: u.url, kind: u.kind, firstSeenAt: now })), skipDuplicates: true });
    await this.prisma.indexInspection.deleteMany({ where: { url: { notIn: urls } } });
  }

  private async record(url: string, out: Extract<UrlInspectOutcome, { kind: 'ok' }>, now: Date): Promise<void> {
    const prev = await this.prisma.indexInspection.findUnique({ where: { url }, select: { flag: true, flagSince: true, flagStreak: true } });
    if (!prev) return; // la fila se borró entre medias (la ficha salió del sitemap)
    const flag = classifyInspection(out.fields);
    const next = nextFlagState(prev.flag ? ({ flag: prev.flag as IndexFlag, flagSince: prev.flagSince, flagStreak: prev.flagStreak } satisfies FlagState) : null, flag, now);
    await this.prisma.indexInspection.updateMany({
      where: { url },
      data: {
        lastCheckedAt: now,
        ...out.fields,
        flag: next.flag,
        flagSince: next.flagSince,
        flagStreak: next.flagStreak,
        ...(next.resetNotified ? { notifiedAt: null } : {}),
      },
    });
  }

  // ───────── lectura para AV7 ─────────

  /**
   * Entrada de AV7 para `r2`. `missing` (texto de «No se evaluó: …») si el job está apagado, sin permiso o con < 50 % del universo
   * revisado en 7 días; si no, el resumen (o `null` ⇒ sin aviso). Relee el sitemap ANTES de avisar y descarta lo que ya no está a la
   * venta. Caché de 10 min en memoria (el panel no repite la lectura del sitemap en cada vista).
   */
  async av7Input(now = new Date(), opts: { forEmail?: boolean } = {}): Promise<Av7Input> {
    const forEmail = opts.forEmail === true;
    const c = this.av7Cache;
    if (c && c.forEmail === forEmail && now.getTime() - c.at < AV7_CACHE_MS && now.getTime() >= c.at) return c.value;
    const value = await this.computeAv7(now, forEmail);
    this.av7Cache = { at: now.getTime(), forEmail, value };
    return value;
  }

  private async computeAv7(now: Date, forEmail: boolean): Promise<Av7Input> {
    if (!(await this.enabled())) return { missing: 'la indexación: revisión apagada', summary: null };
    const state = await this.readState();
    if (state.deniedDay) return { missing: 'la indexación: sin permiso de Search Console', summary: null };
    const total = await this.prisma.indexInspection.count();
    const recent = await this.prisma.indexInspection.count({ where: { lastCheckedAt: { gte: new Date(now.getTime() - COVERAGE_WINDOW_MS) } } });
    if (total === 0 || recent / total < MIN_COVERAGE) return { missing: 'la indexación: aún se revisó menos de la mitad de las páginas', summary: null };
    const rows: NoticeRow[] = await this.prisma.indexInspection.findMany({
      where: { flag: { not: null } },
      select: { url: true, kind: true, flag: true, flagStreak: true, firstSeenAt: true, notifiedAt: true },
    });
    const candidates = rows.filter((r) => noticeableUrls([r], now, { forEmail }).length > 0);
    if (candidates.length === 0) return { missing: null, summary: null };
    const origin = this.origin();
    if (!origin) return { missing: 'la indexación: sin dirección pública del sitio', summary: null };
    const live = new Set((await this.universe(origin)).map((u) => u.url));
    if (live.size === 0) return { missing: 'la indexación: no se pudo leer el catálogo', summary: null };
    const included = candidates.filter((r) => live.has(r.url));
    return { missing: null, summary: summarizeAv7(included, now, { forEmail }), urls: noticeableUrls(included, now, { forEmail }) };
  }

  /**
   * Marca como avisadas SOLO las URLs que el correo incluyó (GS-3): las del último `av7Input({forEmail:true})` (misma lectura que armó
   * el correo, ya filtradas por el sitemap vivo y la supresión de 28 días), no todas las filas con flag.
   */
  async markNotified(now = new Date()): Promise<number> {
    const input = await this.av7Input(now, { forEmail: true });
    this.av7Cache = null;
    const urls = input.urls ?? [];
    if (!input.summary || urls.length === 0) return 0;
    const r = await this.prisma.indexInspection.updateMany({ where: { url: { in: urls } }, data: { notifiedAt: now } });
    return r.count;
  }
}
