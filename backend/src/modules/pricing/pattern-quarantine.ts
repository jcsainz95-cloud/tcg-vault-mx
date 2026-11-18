import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * §PRICE-PATTERN 6.6 (2) — MEMORIA DE CUARENTENA de la prueba del job `pattern-reclassify`, sin migración: una fila de `ConfigSetting`
 * (`key = 'pattern_quarantine'`, `valueJson = { "<cardId>": { sig, at, reasons[≤5] } }`). NO es un dial: no está en la lista blanca de
 * `GET/PUT /admin/settings` (PUT ⇒ 422). Una carta cuya prueba falló NO se vuelve a probar hasta que cambie su `sig` (precios o FX) o pasen
 * {@link PATTERN_QUARANTINE_DAYS} días: así no hay bucle diario de «aplicar → rechazar» ni un correo repetido (qa B-1, seguridad PP-10).
 */
export const PATTERN_QUARANTINE_KEY = 'pattern_quarantine';
export const PATTERN_QUARANTINE_DAYS = 7;
export const PATTERN_QUARANTINE_REASONS_MAX = 5;
/** Tope de cartas que lleva el informe de la corrida (`quarantinedCards`). */
export const PATTERN_QUARANTINE_REPORT_MAX = 50;

export interface QuarantineEntry {
  sig: string;
  at: string;
  reasons: string[];
}
export type QuarantineMap = Record<string, QuarantineEntry>;

/** Lectura defensiva: lo que no tenga la forma exacta se descarta (nunca rompe la corrida ni abre una cuarentena inventada). */
export function parseQuarantine(raw: unknown): QuarantineMap {
  const out: QuarantineMap = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [cardId, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<QuarantineEntry> | null;
    if (e && typeof e.sig === 'string' && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at)) && Array.isArray(e.reasons)) {
      out[cardId] = { sig: e.sig, at: e.at, reasons: e.reasons.filter((r) => typeof r === 'string').slice(0, PATTERN_QUARANTINE_REASONS_MAX) };
    }
  }
  return out;
}

/** ¿Sigue vigente la cuarentena? Solo si la firma NO cambió y no pasaron {@link PATTERN_QUARANTINE_DAYS} días. */
export function isQuarantineActive(entry: QuarantineEntry | undefined, sig: string, now: Date): boolean {
  if (!entry || entry.sig !== sig) return false;
  return now.getTime() - Date.parse(entry.at) < PATTERN_QUARANTINE_DAYS * 86_400_000;
}

export interface SigRow {
  cardProductId: string | null;
  productType: string;
  gradeKey: string;
  finish: string;
  cents: number;
  /** `marketCents` en USD de la fila (lo que cambia cuando llega un precio nuevo aunque el MXN congelado no se mueva). */
  usdCents?: number | null;
}

/**
 * Firma de una carta: hash de los `marketCents` de las referencias implicadas (todas las filas vigentes de la carta con su producto, tipo, grado y
 * acabado), el FX usado y los diales del árbitro (con ellos la mediana es función de lo anterior). Cambia si llega un precio nuevo o se mueve el FX.
 */
export function cardSig(rows: readonly SigRow[], fx: { rate: number; bufferPct: number } | null, dials: unknown): string {
  const lines = rows.map((r) => [r.cardProductId ?? '-', r.productType, r.gradeKey, r.finish, r.cents, r.usdCents ?? '-'].join('\u0001')).sort();
  const h = createHash('sha256');
  h.update(JSON.stringify({ lines, fx: fx ? [fx.rate, fx.bufferPct] : null, dials }));
  return h.digest('hex').slice(0, 24);
}

export async function readQuarantine(db: Pick<PrismaService, 'configSetting'> | Prisma.TransactionClient): Promise<QuarantineMap> {
  const row = await db.configSetting.findUnique({ where: { key: PATTERN_QUARANTINE_KEY }, select: { valueJson: true } });
  return parseQuarantine(row?.valueJson);
}

export async function writeQuarantine(db: Pick<PrismaService, 'configSetting'> | Prisma.TransactionClient, map: QuarantineMap): Promise<void> {
  const valueJson = map as unknown as Prisma.InputJsonValue;
  await db.configSetting.upsert({
    where: { key: PATTERN_QUARANTINE_KEY },
    create: { key: PATTERN_QUARANTINE_KEY, valueJson, updatedBy: 'pattern-reclassify' },
    update: { valueJson, updatedBy: 'pattern-reclassify' },
  });
}

/** Memoria de cuarentena al cierre (PURA): solo siguen las cartas que aún son candidatas, NO confirmadas y vigentes (< {@link PATTERN_QUARANTINE_DAYS} días); lo demás se poda. */
export function pruneQuarantine(q: QuarantineMap, candCards: ReadonlySet<string>, confirmedCards: ReadonlySet<string>, now: Date): QuarantineMap {
  const keep: QuarantineMap = {};
  for (const [cardId, e] of Object.entries(q)) {
    if (candCards.has(cardId) && !confirmedCards.has(cardId) && now.getTime() - Date.parse(e.at) < PATTERN_QUARANTINE_DAYS * 86_400_000) keep[cardId] = e;
  }
  return keep;
}
