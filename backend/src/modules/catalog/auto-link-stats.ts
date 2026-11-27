import { PrismaService } from '../../prisma/prisma.service';
import { isTcgcsvOrigin } from './tcgcsv-card-name';
import { promoGroupFor } from './promo-set-groups';

/** Cartas sin ningún `CardProduct`, por set (consulta LOCAL, una sola). */
export interface UnlinkedSetRow {
  setId: string;
  name: string;
  externalId: string;
  unlinked: number;
  total: number;
}

export async function unlinkedBySet(prisma: Pick<PrismaService, '$queryRaw'>): Promise<UnlinkedSetRow[]> {
  return prisma.$queryRaw<UnlinkedSetRow[]>`
    SELECT s."id" AS "setId", s."name", s."externalId",
           COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "CardProduct" cp WHERE cp."cardId" = c."id"))::int AS "unlinked",
           COUNT(*)::int AS "total"
    FROM "Card" c JOIN "CardSet" s ON s."id" = c."setId"
    GROUP BY s."id", s."name", s."externalId"
    HAVING COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "CardProduct" cp WHERE cp."cardId" = c."id")) > 0`;
}

/**
 * Sets que TCGCSV NO tiene (tabla curada, residuo irreductible de B3; DECISIONES §AUTO-ENLACE 6.v). Cada fila lleva su prueba.
 * Se compara por nombre normalizado (acentos/mayúsculas/puntuación fuera) porque el `externalId` de pokemontcg.io no es estable para estos.
 */
const NOT_IN_PROVIDER_NAME_KEYS: readonly string[] = ['futsal'];

export function isNotInProviderSet(name: string): boolean {
  const key = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return NOT_IN_PROVIDER_NAME_KEYS.some((k) => key.includes(k));
}

/** Motivo fijo (sin llamar a nadie) por el que la tanda NO intenta un set; `null` = reparable por el job. */
export function untryableReason(set: { name: string; externalId: string }): 'tcgcsv_source' | 'promo_route' | 'not_in_provider' | null {
  if (isTcgcsvOrigin(set.externalId)) return 'tcgcsv_source';
  if (promoGroupFor(set.externalId)) return 'promo_route';
  if (isNotInProviderSet(set.name)) return 'not_in_provider';
  return null;
}

/** Cartas sin ligar que SÍ cuentan en el contador (excluye `tcgcsv_source` y `not_in_provider`, que salen aparte y sin botón). */
export function countsInUnlinkedCards(set: { name: string; externalId: string }): boolean {
  const r = untryableReason(set);
  return r !== 'tcgcsv_source' && r !== 'not_in_provider';
}

export function utcDayStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Próxima corrida diaria (05:00 UTC; zona del scheduler = UTC, sin `tz`). */
export const AUTO_LINK_HOUR_UTC = 5;
export function nextAutoLinkRun(now = new Date()): Date {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), AUTO_LINK_HOUR_UTC));
  return t.getTime() > now.getTime() ? t : new Date(t.getTime() + 86_400_000);
}
