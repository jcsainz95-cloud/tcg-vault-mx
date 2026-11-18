import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EffectiveVariantRow } from '../../common/variant-product';

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
): Promise<(EffectiveVariantRow & { observedAt: Date })[]> {
  if (cardIds.length === 0) return [];
  const hyp = [...(opts.hypotheticalVariantIds ?? [])];
  const pt = opts.productTypes?.length ? Prisma.sql`AND pr."productType"::text IN (${Prisma.join([...opts.productTypes])})` : Prisma.empty;
  const gk = opts.gradeKeys?.length ? Prisma.sql`AND pr."gradeKey" IN (${Prisma.join([...opts.gradeKeys])})` : Prisma.empty;
  const rows = await (db as Pick<PrismaService, '$queryRaw'>).$queryRaw<
    { cardId: string; productType: string; gradeKey: string; finish: string; cardProductId: string | null; kind: string | null; tcgplayerProductId: number | null; cents: number; observedAt: Date }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (pr."cardId", pr."productType", pr."gradeKey", pr."finish", pr."cardProductId")
           pr."cardId", pr."productType"::text AS "productType", pr."gradeKey", pr."finish"::text AS "finish", pr."cardProductId",
           CASE WHEN cp."id" = ANY (${hyp}::text[]) THEN 'variant' ELSE cp."kind"::text END AS "kind",
           cp."tcgplayerProductId", pr."priceMxnCents" AS cents, COALESCE(pr."evidenceDate", pr."capturedDate") AS "observedAt"
    FROM "PriceReference" pr
    LEFT JOIN "CardProduct" cp ON cp."id" = pr."cardProductId"
    WHERE pr."cardId" IN (${Prisma.join([...cardIds])})
      AND pr."refKind" = 'market'::"PriceRefKind" AND pr."priceMxnCents" > 0
      ${pt} ${gk}
      AND (pr."cardProductId" IS NULL OR cp."kind" IN ('set_base'::"CardProductKind", 'other'::"CardProductKind", 'variant'::"CardProductKind"))
      AND EXISTS (SELECT 1 FROM "CardProduct" v WHERE v."cardId" = pr."cardId" AND (v."kind" = 'variant'::"CardProductKind" OR v."id" = ANY (${hyp}::text[])))
    ORDER BY pr."cardId", pr."productType", pr."gradeKey", pr."finish", pr."cardProductId",
             COALESCE(pr."evidenceDate", pr."capturedDate") DESC, pr."capturedDate" DESC`);
  return rows.map((r) => ({ ...r, cents: Number(r.cents) }));
}
