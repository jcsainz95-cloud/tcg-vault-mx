import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EffectiveVariantRow } from '../../common/variant-product';
import type { ReaderBaseRow } from './pattern-plan';

/**
 * §PRICE-PATTERN v2 (punto 6.1) — lectura de BD de la «variante efectiva»: para las cartas dadas que tengan ≥ 1 producto `variant`, trae la fila
 * de mercado VIGENTE (la más fresca) de cada producto con precio > 0 —más los precios genéricos sin producto— y delega la decisión en la
 * función única `effectiveVariantKeys`. Solo cartas con `variant`: el resto de la lectura no cambia ni un byte (alcance acotado, punto 3).
 * `hypotheticalVariantIds`: productos aún `set_base|other` que el job quiere tratar como `variant` (simulación antes de reclasificar).
 */
export async function loadEffectiveVariantRows(
  db: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient,
  cardIds: readonly string[],
  opts: { productTypes?: readonly string[]; gradeKeys?: readonly string[]; hypotheticalVariantIds?: readonly string[] } = {},
): Promise<(EffectiveVariantRow & { observedAt: Date; usdCents: number | null })[]> {
  if (cardIds.length === 0) return [];
  const hyp = [...(opts.hypotheticalVariantIds ?? [])];
  const pt = opts.productTypes?.length ? Prisma.sql`AND pr."productType"::text IN (${Prisma.join([...opts.productTypes])})` : Prisma.empty;
  const gk = opts.gradeKeys?.length ? Prisma.sql`AND pr."gradeKey" IN (${Prisma.join([...opts.gradeKeys])})` : Prisma.empty;
  const rows = await (db as Pick<PrismaService, '$queryRaw'>).$queryRaw<
    { cardId: string; productType: string; gradeKey: string; finish: string; cardProductId: string | null; kind: string | null; tcgplayerProductId: number | null; cents: number; usdCents: number | null; observedAt: Date }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (pr."cardId", pr."productType", pr."gradeKey", pr."finish", pr."cardProductId")
           pr."cardId", pr."productType"::text AS "productType", pr."gradeKey", pr."finish"::text AS "finish", pr."cardProductId",
           CASE WHEN cp."id" = ANY (${hyp}::text[]) THEN 'variant' ELSE cp."kind"::text END AS "kind",
           cp."tcgplayerProductId", pr."priceMxnCents" AS cents, pr."priceUsdCents" AS "usdCents", COALESCE(pr."evidenceDate", pr."capturedDate") AS "observedAt"
    FROM "PriceReference" pr
    LEFT JOIN "CardProduct" cp ON cp."id" = pr."cardProductId"
    WHERE pr."cardId" IN (${Prisma.join([...cardIds])})
      AND pr."refKind" = 'market'::"PriceRefKind" AND pr."priceMxnCents" > 0
      ${pt} ${gk}
      AND (pr."cardProductId" IS NULL OR cp."kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind", 'variant'::"CardProductKind"))
      AND EXISTS (SELECT 1 FROM "CardProduct" v WHERE v."cardId" = pr."cardId" AND (v."kind" = 'variant'::"CardProductKind" OR v."id" = ANY (${hyp}::text[])))
    ORDER BY pr."cardId", pr."productType", pr."gradeKey", pr."finish", pr."cardProductId",
             COALESCE(pr."evidenceDate", pr."capturedDate") DESC, pr."capturedDate" DESC`);
  return rows.map((r) => ({ ...r, cents: Number(r.cents), usdCents: r.usdCents == null ? null : Number(r.usdCents) }));
}

/**
 * Filas de mercado raw NM tal como las conserva la lectura REAL (`getReferencesBatch`, mismo SQL de poda): todo override manual y, de las
 * automáticas de productos `set_base|other` o sin producto, solo las del día MÁS FRESCO del combo (de TODOS los productos y fuentes; sin colapsar
 * por producto). `candidateIds` = los productos a reclasificar: se devuelven marcados (`isCandidate`) porque ANTES del cambio cuentan en la lectura y DESPUÉS ya no; por eso
 * se conservan las filas del día más fresco de TODOS y las del día más fresco de los NO candidatos. Para el plan del job (PP-7 / qa).
 */
export async function loadReaderBaseRows(
  db: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient,
  cardIds: readonly string[],
  candidateIds: readonly string[],
): Promise<ReaderBaseRow[]> {
  if (cardIds.length === 0) return [];
  const ex = [...candidateIds];
  const rows = await (db as Pick<PrismaService, '$queryRaw'>).$queryRaw<
    {
      cardId: string; finish: string; cardProductId: string | null; productExtId: number | null; productName: string | null; cardName: string; cardTcgplayerId: string | null;
      source: string; isManual: boolean; isCandidate: boolean; priceMxnCents: number; capturedDate: Date; evidenceDate: Date | null;
    }[]
  >(Prisma.sql`
    WITH filtered AS (
      SELECT pr."cardId", pr."finish"::text AS "finish", pr."cardProductId", cp."tcgplayerProductId" AS "productExtId", cp."name" AS "productName",
             c."name" AS "cardName", c."tcgplayerId" AS "cardTcgplayerId", pr."source", (pr."isManualOverride" OR pr."source" = 'manual') AS "isManual",
             (pr."cardProductId" IS NOT NULL AND pr."cardProductId" = ANY (${ex}::text[])) AS "isCandidate",
             pr."priceMxnCents", pr."capturedDate", pr."evidenceDate"
      FROM "PriceReference" pr
      LEFT JOIN "CardProduct" cp ON cp."id" = pr."cardProductId"
      JOIN "Card" c ON c."id" = pr."cardId"
      WHERE pr."cardId" IN (${Prisma.join([...cardIds])})
        AND pr."productType" = 'raw'::"ProductType" AND pr."gradeKey" = 'raw:NM' AND pr."refKind" = 'market'::"PriceRefKind"
        AND (pr."cardProductId" IS NULL OR cp."kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind"))
    ), ranked AS (
      SELECT filtered.*,
             MAX(CASE WHEN NOT "isManual" THEN COALESCE("evidenceDate", "capturedDate") END) OVER (PARTITION BY "cardId", "finish") AS "maxAutoDate",
             MAX(CASE WHEN NOT "isManual" AND NOT "isCandidate" THEN COALESCE("evidenceDate", "capturedDate") END) OVER (PARTITION BY "cardId", "finish") AS "maxBaseDate"
      FROM filtered
    )
    SELECT "cardId", "finish", "cardProductId", "productExtId", "productName", "cardName", "cardTcgplayerId", "source", "isManual", "isCandidate", "priceMxnCents", "capturedDate", "evidenceDate"
    FROM ranked
    WHERE "isManual" OR COALESCE("evidenceDate", "capturedDate") = "maxAutoDate"
       OR (NOT "isCandidate" AND COALESCE("evidenceDate", "capturedDate") = "maxBaseDate")`);
  return rows.map((r) => ({ ...r, priceMxnCents: Number(r.priceMxnCents) }));
}

/** Candidatos (ids) con alguna fila de mercado FUERA de raw NM (graded u otro tipo): la lectura les aplica la misma «variante efectiva». */
export async function loadNonRawCandidateIds(db: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient, candidateIds: readonly string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await (db as Pick<PrismaService, '$queryRaw'>).$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT pr."cardProductId" AS id FROM "PriceReference" pr
    WHERE pr."cardProductId" IN (${Prisma.join([...candidateIds])}) AND pr."refKind" = 'market'::"PriceRefKind"
      AND NOT (pr."productType" = 'raw'::"ProductType" AND pr."gradeKey" = 'raw:NM')`);
  return new Set(rows.map((r) => r.id));
}

/**
 * `cardId|finish` con ≥ 1 producto `variant` que NO es candidato y cuyo `finishes` incluye el acabado: lo que la lectura REAL fija como `variantCombo`
 * HOY (mismo `EXISTS` que `getReferencesBatch`), sin el filtro «con precio» que usaba el plan (qa MENOR 6.6).
 */
export async function loadPreVariantCombos(
  db: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient,
  cardIds: readonly string[],
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();
  const rows = await (db as Pick<PrismaService, '$queryRaw'>).$queryRaw<{ cardId: string; finish: string }[]>(Prisma.sql`
    SELECT DISTINCT v."cardId", f::text AS "finish"
    FROM "CardProduct" v CROSS JOIN LATERAL unnest(v."finishes") AS f
    WHERE v."cardId" IN (${Prisma.join([...cardIds])}) AND v."kind" = 'variant'::"CardProductKind" AND NOT (v."id" = ANY (${[...candidateIds]}::text[]))`);
  return new Set(rows.map((r) => `${r.cardId}|${r.finish}`));
}
