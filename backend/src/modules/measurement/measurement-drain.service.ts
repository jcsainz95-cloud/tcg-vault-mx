/**
 * measurement-drain.service.ts — job `measurement-drain` (cada minuto en la cola `tcg-daily`; API_CONTRACT §MKT.H.6,
 * ARCHITECTURE §14.6). Es el ÚNICO camino de la medición a la red.
 *
 * Por corrida:
 *  1. Purga: filas de `MeasurementOutbox` y `MeasurementContext` con `expiresAt ≤ now` (7 días) ⇒ borradas (C-B8).
 *  2. Con `MEASUREMENT_MODE=off`: ⛔ no sale a la red (las filas esperan y caducan). C-B1.
 *  3. Lote de 50 filas con `nextAttemptAt ≤ now` SOLO de destinos habilitados (las de un destino apagado esperan y caducan
 *     sin ocupar el lote: si no, 50 filas de un destino apagado bloquean a los demás 7 días — TL-MKT2-R2). Cada fila se
 *     RECLAMA con un CAS sobre `nextAttemptAt` (dos instancias no envían la misma fila a la vez).
 *  3b. Presupuesto por corrida (`DRAIN_BUDGET_MS`): no se empieza una fila si el envío podría pasar del presupuesto; las que
 *     quedan no se reclaman y salen en la corrida siguiente (el worker `tcg-daily` es compartido — TL-MKT2-D2).
 *  4. El cuerpo se arma AL ENVIAR (constructores puros, `measurement-bodies.ts`); ⛔ nunca se guarda.
 *  5. 2xx ⇒ borra · 5xx/red/429 ⇒ `attempts+1` y escalera 1 min, 5 min, 30 min, 2 h, 12 h · otro 4xx ⇒ borra y cuenta.
 *
 * Logs (C-B6): solo `destination`, `kind`, código HTTP, `attempts` y el id de la fila. ⛔ Ni cuerpo, ni URL, ni token, ni
 * `api_secret`, ni `fbp`/`fbc`/`gaClientId`.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MeasurementDestination, type MeasurementOutbox } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { readFrozenCardFacts } from '../orders/order-item-card';
import { META_GRAPH_API_VERSION } from './measurement.config';
import { MeasurementService } from './measurement.service';
import { measurementItemOf } from './measurement-item';
import { MEASUREMENT_HTTP, fetchMeasurementHttp, type MeasurementHttp } from './measurement-http';
import {
  buildCapiLead,
  buildCapiPurchase,
  buildGa4Lead,
  buildGa4Purchase,
  eventSourceUrl,
  pesos,
  type BrowserIds,
  type LeadFact,
  type MeasurementItem,
  type PurchaseFact,
} from './measurement-bodies';

export const DRAIN_BATCH = 50;
/** Todos los destinos del enum de Prisma (el lote se filtra a los habilitados). */
const MEASUREMENT_DESTINATIONS = Object.values(MeasurementDestination);
export const DRAIN_TIMEOUT_MS = 5_000;
/** Presupuesto de una corrida: ninguna fila empieza si su envío (≤ `DRAIN_TIMEOUT_MS`) podría pasarlo. */
export const DRAIN_BUDGET_MS = 30_000;
/** Escalera de reintentos (§MKT.H.6): 1 min, 5 min, 30 min, 2 h, 12 h (y 12 h hasta caducar). */
export const RETRY_LADDER_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
/** Tiempo que una fila reclamada queda fuera del lote mientras se envía (si el proceso muere, vuelve sola). */
const CLAIM_MS = 10 * 60_000;

const GA4_MP_URL = 'https://www.google-analytics.com/mp/collect';
const META_GRAPH_URL = 'https://graph.facebook.com';

/** `event_source_url` = `APP_BASE_URL` + la página que crea el hecho (API_CONTRACT v1.105 §MKT.H.13; sin `sourcePath`). */
const DEFAULT_PATH = { purchase: '/checkout', generate_lead: '/buylist' } as const;

export interface DrainResult {
  purgedOutbox: number;
  purgedContext: number;
  sent: number;
  retried: number;
  dropped: number;
  skipped: number;
  /** Filas del lote que no se empezaron por el presupuesto de tiempo (salen en la corrida siguiente). */
  deferred: number;
}

@Injectable()
export class MeasurementDrainService {
  private readonly logger = new Logger(MeasurementDrainService.name);
  private readonly http: MeasurementHttp;
  /** Reloj del presupuesto (milisegundos monótonos). Las pruebas lo sustituyen. */
  clock: () => number = () => performance.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly measurement: MeasurementService,
    @Optional() @Inject(MEASUREMENT_HTTP) http?: MeasurementHttp,
  ) {
    this.http = http ?? fetchMeasurementHttp;
  }

  async run(now = new Date()): Promise<DrainResult> {
    const started = this.clock();
    const res: DrainResult = { purgedOutbox: 0, purgedContext: 0, sent: 0, retried: 0, dropped: 0, skipped: 0, deferred: 0 };
    res.purgedOutbox = (await this.prisma.measurementOutbox.deleteMany({ where: { expiresAt: { lte: now } } })).count;
    res.purgedContext = (await this.prisma.measurementContext.deleteMany({ where: { expiresAt: { lte: now } } })).count;
    if (this.measurement.mode !== 'on') return res;
    const enabled = MEASUREMENT_DESTINATIONS.filter((d) => this.measurement.enabled(d));
    if (enabled.length === 0) return res;

    const rows = await this.prisma.measurementOutbox.findMany({
      where: { destination: { in: enabled }, nextAttemptAt: { lte: now }, expiresAt: { gt: now } },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: DRAIN_BATCH,
    });
    for (const [i, row] of rows.entries()) {
      if (this.clock() - started + DRAIN_TIMEOUT_MS > DRAIN_BUDGET_MS) {
        res.deferred = rows.length - i;
        break;
      }
      const claimed = await this.prisma.measurementOutbox.updateMany({
        where: { id: row.id, nextAttemptAt: row.nextAttemptAt },
        data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
      });
      if (claimed.count !== 1) {
        res.skipped += 1;
        continue;
      }
      const req = await this.request(row, now);
      if (!req) {
        // El sujeto ya no existe o no tiene consentimiento registrado: el cuerpo no va a existir nunca.
        await this.prisma.measurementOutbox.deleteMany({ where: { id: row.id } });
        res.dropped += 1;
        this.log('dropped', row, null);
        continue;
      }
      const status = await this.http.postJson(req.url, req.body, DRAIN_TIMEOUT_MS);
      if (status !== null && status >= 200 && status < 300) {
        await this.prisma.measurementOutbox.deleteMany({ where: { id: row.id } });
        res.sent += 1;
      } else if (status !== null && status >= 400 && status < 500 && status !== 429) {
        await this.prisma.measurementOutbox.deleteMany({ where: { id: row.id } });
        res.dropped += 1;
        this.log('dropped', row, status);
      } else {
        const attempts = row.attempts + 1;
        const wait = RETRY_LADDER_MS[Math.min(attempts, RETRY_LADDER_MS.length) - 1];
        await this.prisma.measurementOutbox.updateMany({
          where: { id: row.id },
          data: { attempts, lastStatus: status, nextAttemptAt: new Date(now.getTime() + wait) },
        });
        res.retried += 1;
        this.log('retry', row, status, attempts);
      }
    }
    return res;
  }

  /** ⛔ Solo metadatos: destino, tipo, código, intentos, id de la fila. */
  private log(what: 'retry' | 'dropped', row: MeasurementOutbox, status: number | null, attempts = row.attempts): void {
    this.logger.warn(
      `measurement-drain ${what} destination=${row.destination} kind=${row.kind} status=${status ?? 'network'} attempts=${attempts} row=${row.id}`,
    );
  }

  /** Arma la petición AL ENVIAR. `null` ⇒ no hay hecho que contar (se borra la fila). */
  private async request(row: MeasurementOutbox, now: Date): Promise<{ url: string; body: unknown } | null> {
    const cfg = this.measurement.config;
    if (row.kind === 'purchase') {
      const fact = await this.purchaseFact(row.subjectId);
      if (!fact) return null;
      const ids = await this.ids({ orderId: row.subjectId });
      if (row.destination === 'ga4_mp' && cfg.ga4.enabled) {
        return { url: this.ga4Url(cfg.ga4.measurementId, cfg.ga4.apiSecret), body: buildGa4Purchase(fact, ids, now) };
      }
      if (row.destination === 'meta_capi' && cfg.meta.enabled) {
        const body = buildCapiPurchase(fact, ids, eventSourceUrl(this.measurement.origin, DEFAULT_PATH.purchase));
        return { url: this.metaUrl(cfg.meta.pixelId), body: { ...body, access_token: cfg.meta.token } };
      }
      return null;
    }
    const fact = await this.leadFact(row.subjectId);
    if (!fact) return null;
    const ids = await this.ids({ sellRequestId: row.subjectId });
    if (row.destination === 'ga4_mp' && cfg.ga4.enabled) {
      return { url: this.ga4Url(cfg.ga4.measurementId, cfg.ga4.apiSecret), body: buildGa4Lead(fact, ids, now) };
    }
    if (row.destination === 'meta_capi' && cfg.meta.enabled) {
      const body = buildCapiLead(fact, ids, eventSourceUrl(this.measurement.origin, DEFAULT_PATH.generate_lead));
      return { url: this.metaUrl(cfg.meta.pixelId), body: { ...body, access_token: cfg.meta.token } };
    }
    return null;
  }

  private ga4Url(measurementId: string, apiSecret: string): string {
    return `${GA4_MP_URL}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  }

  private metaUrl(pixelId: string): string {
    return `${META_GRAPH_URL}/${META_GRAPH_API_VERSION}/${encodeURIComponent(pixelId)}/events`;
  }

  private async ids(where: { orderId: string } | { sellRequestId: string }): Promise<BrowserIds> {
    const ctx = await this.prisma.measurementContext.findFirst({
      where,
      select: { gaClientId: true, fbp: true, fbc: true },
    });
    return ctx ?? {};
  }

  /** Proyección mínima de la compra: ids opacos, montos y nombres de producto. ⛔ Nada de la persona. */
  async purchaseFact(orderId: string): Promise<PurchaseFact | null> {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalCents: true,
        shippingFeeCents: true,
        settledAt: true,
        measurementConsentAnalytics: true,
        firstUtmSource: true,
        firstUtmMedium: true,
        firstUtmCampaign: true,
        firstUtmContent: true,
        items: { select: { cardSnapshot: true, unitPriceCents: true } },
        accessoryLines: {
          select: { accessoryId: true, metaDeckId: true, deckName: true, quantity: true, unitPriceCents: true, snapshot: true },
        },
      },
    });
    if (!o || !o.settledAt || o.measurementConsentAnalytics === null) return null;
    // Identidad canónica (§MKT.H.4, `measurementItemOf`): una línea sin identidad no viaja.
    const items: MeasurementItem[] = [];
    for (const it of o.items) {
      const id = measurementItemOf(readFrozenCardFacts(it.cardSnapshot));
      if (id) items.push({ ...id, price: pesos(it.unitPriceCents), quantity: 1 });
    }
    for (const l of o.accessoryLines) {
      const snap = (l.snapshot ?? {}) as { name?: unknown };
      const id = measurementItemOf({
        kind: 'accessory',
        accessoryId: l.accessoryId,
        metaDeckId: l.metaDeckId,
        name: typeof snap.name === 'string' ? snap.name : l.deckName,
      });
      if (id) items.push({ ...id, price: pesos(l.unitPriceCents), quantity: l.quantity });
    }
    return {
      orderId: o.id,
      totalCents: o.totalCents,
      shippingFeeCents: o.shippingFeeCents ?? 0,
      settledAt: o.settledAt,
      items,
      consentAnalytics: o.measurementConsentAnalytics,
      firstUtm: {
        source: o.firstUtmSource ?? undefined,
        medium: o.firstUtmMedium ?? undefined,
        campaign: o.firstUtmCampaign ?? undefined,
        content: o.firstUtmContent ?? undefined,
      },
    };
  }

  async leadFact(sellRequestId: string): Promise<LeadFact | null> {
    const s = await this.prisma.sellRequest.findUnique({
      where: { id: sellRequestId },
      select: {
        id: true,
        quotedTotalCents: true,
        createdAt: true,
        measurementConsentAnalytics: true,
        firstUtmSource: true,
        firstUtmMedium: true,
        firstUtmCampaign: true,
        firstUtmContent: true,
      },
    });
    if (!s || s.measurementConsentAnalytics === null) return null;
    return {
      sellRequestId: s.id,
      quotedTotalCents: s.quotedTotalCents,
      createdAt: s.createdAt,
      consentAnalytics: s.measurementConsentAnalytics,
      firstUtm: {
        source: s.firstUtmSource ?? undefined,
        medium: s.firstUtmMedium ?? undefined,
        campaign: s.firstUtmCampaign ?? undefined,
        content: s.firstUtmContent ?? undefined,
      },
    };
  }
}
