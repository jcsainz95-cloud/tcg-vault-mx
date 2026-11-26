import { Prisma, PrismaClient } from '@prisma/client';
import { CARD_ORDER_BY_GLOBAL } from './card-order';

/**
 * card-search.ts — §BUSCADOR-CARTAS (docs/DECISIONES.md). UNA sola función de búsqueda de cartas por texto
 * para todos los buscadores (`searchAllCards`, `listCards`, bounties M2, sellado/graduado, supply, demand-match).
 * ⛔ Prohibido volver a escribir `contains` sobre `Card` fuera de este fichero (lo verifica card-search.spec.ts).
 *
 * Entiende (todas las palabras en Y, cualquier orden): número («078», «78/131»), código con prefijo
 * («SWSH132», «TG12», «GG05»), clave de set (`CardSet.ptcgoCode`: «PRE 078», «PRE-078», «pre78») y nombre
 * (sin acentos/símbolos). Una sola palabra conserva la conducta anterior (nombre OR número contiene).
 * Sin regex ni comodines del usuario: las palabras quedan solo en [a-z0-9] y todo va parametrizado por Prisma.
 */

export const CARD_SEARCH_Q_MAX = 60;
export const CARD_SEARCH_MAX_WORDS = 6;
export const CARD_SEARCH_WORD_MAX = 24;
/** Tope de volcado: con `q` y sin `setId`, `page × pageSize` ≤ 1000. */
export const CARD_SEARCH_DEPTH_CAP = 1000;
export const CARD_SEARCH_IDENTITY_MAX = 200;
export const CARD_SEARCH_KEYS_TTL_MS = 10 * 60_000;

type SetKeyDb = { cardSet: Pick<PrismaClient['cardSet'], 'findMany'> };
type CardDb = SetKeyDb & { card: Pick<PrismaClient['card'], 'findMany' | 'count'> };

export interface CardSearchSetKeys {
  /** clave en minúsculas → ids de los sets que la comparten. */
  byKey: Map<string, string[]>;
  /** setId → printedTotal. */
  totals: Map<string, number | null>;
}

let keysCache: { at: number; value: CardSearchSetKeys } | null = null;

/** Para pruebas / tras el sync de claves. */
export function clearCardSearchKeysCache(): void {
  keysCache = null;
}

export async function loadCardSearchSetKeys(db: SetKeyDb, now = Date.now()): Promise<CardSearchSetKeys> {
  if (keysCache && now - keysCache.at < CARD_SEARCH_KEYS_TTL_MS) return keysCache.value;
  const sets = await db.cardSet.findMany({
    where: { ptcgoCode: { not: null } },
    select: { id: true, ptcgoCode: true, printedTotal: true },
  });
  const byKey = new Map<string, string[]>();
  const totals = new Map<string, number | null>();
  for (const s of sets) {
    const k = (s.ptcgoCode ?? '').trim().toLowerCase();
    if (!/^[a-z0-9]{2,5}$/.test(k)) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), s.id]);
    totals.set(s.id, s.printedTotal ?? null);
  }
  const value = { byKey, totals };
  keysCache = { at: now, value };
  return value;
}

/** Pliega: sin acentos, minúsculas, δ→delta, ♀♂ fuera. */
export function foldCardText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[δΔ]/g, 'delta')
    .replace(/[♀♂]/g, '')
    .toLowerCase();
}

export interface ParsedCardQuery {
  /** Palabras plegadas (≤ 6, ≤ 24 caracteres), sin las de 1 letra. */
  words: string[];
  /** Total impreso pedido («078/131» ⇒ 131), si lo hubo. */
  total: number | null;
  /** `q` tenía contenido pero ninguna palabra útil («%%%»). */
  noUsableWords: boolean;
}

export function parseCardQuery(raw: string | undefined | null): ParsedCardQuery | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let text = foldCardText(trimmed.slice(0, CARD_SEARCH_Q_MAX));
  let total: number | null = null;
  text = text.replace(/(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/, (_m, n: string, t: string) => {
    total = parseInt(t, 10);
    return ` ${n} `;
  });
  const all = text
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.slice(0, CARD_SEARCH_WORD_MAX));
  const words = all.filter((w) => !/^[a-z]$/.test(w)).slice(0, CARD_SEARCH_MAX_WORDS);
  if (words.length === 0 && all.length > 0) {
    // Solo palabras de 1 letra («a»): se trata como una sola palabra (conducta de hoy).
    return { words: [all[0]], total, noUsableWords: false };
  }
  return { words, total, noUsableWords: words.length === 0 };
}

const stripZeros = (d: string): string => d.replace(/^0+(?=\d)/, '');

function nameVariants(w: string): string[] {
  const v = new Set<string>([w]);
  if (w.includes('e')) v.add(w.replace(/e/g, 'é'));
  if (w.includes('delta')) v.add(w.replace(/delta/g, 'δ'));
  return [...v];
}

const nameCond = (w: string): Prisma.CardWhereInput => ({
  OR: nameVariants(w).map((x) => ({ name: { contains: x, mode: 'insensitive' as const } })),
});

const numberEq = (n: string): Prisma.CardWhereInput => ({ number: { equals: n, mode: 'insensitive' } });

function numberVariants(letters: string, digits: string): string[] {
  const s = stripZeros(digits);
  return [...new Set([letters + digits, letters + s, letters + s.padStart(2, '0'), letters + s.padStart(3, '0')])];
}

export interface CardSearchPlan {
  /** Filtro completo (todas las palabras). */
  where: Prisma.CardWhereInput;
  /** Niveles de identidad en orden (solo se usan sin `setId`); vacío ⇒ no hay nivel 1. */
  identityTiers: Prisma.CardWhereInput[];
  /** `q` sin ninguna palabra útil ⇒ no coincide nada. */
  matchesNothing: boolean;
}

/** Puro (recibe las claves ya cargadas): arma `where` e identidad. */
export function buildCardSearchPlan(raw: string | undefined | null, keys: CardSearchSetKeys): CardSearchPlan | null {
  const parsed = parseCardQuery(raw);
  if (!parsed) return null;
  // Folio de pieza («INV-001306»): devuelve la carta de ESA pieza (o nada), no busca por nombre.
  const folio = /^\s*(inv)-(\d{1,12})\s*$/i.exec(raw ?? '');
  if (folio) {
    const where: Prisma.CardWhereInput = { inventoryItems: { some: { folio: { equals: `INV-${folio[2]}`, mode: 'insensitive' } } } };
    return { where, identityTiers: [], matchesNothing: false };
  }
  if (parsed.noUsableWords) return { where: { id: { in: [] } }, identityTiers: [], matchesNothing: true };
  const { words, total } = parsed;
  const keyIds = (k: string): string[] => keys.byKey.get(k) ?? [];
  const single = words.length === 1;

  const soft: Prisma.CardWhereInput[] = [];
  const strict: Prisma.CardWhereInput[] = [];
  let hasIdentityWord = false;

  const wordConds = (w: string): { soft: Prisma.CardWhereInput; strict: Prisma.CardWhereInput; identity: boolean } | null => {
    const isNum = /^\d{1,3}$/.test(w);
    const code = /^([a-z]{1,5})(\d{1,3})$/.exec(w);
    const keyMatch = keyIds(w);
    if (isNum) {
      const s0 = stripZeros(w);
      if (single) {
        // Una sola palabra = hoy (nombre OR número contiene), sin ceros a la izquierda.
        const sc: Prisma.CardWhereInput = { OR: [{ name: { contains: s0, mode: 'insensitive' } }, { number: { contains: s0, mode: 'insensitive' } }] };
        const identity = s0 !== w || total !== null;
        return { soft: sc, strict: identity ? { OR: [numberEq(s0), numberEq(w)] } : sc, identity };
      }
      const c: Prisma.CardWhereInput = { OR: [numberEq(s0), ...(w !== s0 ? [numberEq(w)] : [])] };
      return { soft: c, strict: c, identity: true };
    }
    const alts: Prisma.CardWhereInput[] = [];
    const altsStrict: Prisma.CardWhereInput[] = [];
    let identity = false;
    if (code) {
      const [, letters, digits] = code;
      const codeConds: Prisma.CardWhereInput[] = numberVariants(letters, digits).map(numberEq);
      if (keyIds(letters).length > 0) {
        codeConds.push({ AND: [{ setId: { in: keyIds(letters) } }, numberEq(stripZeros(digits))] });
      }
      alts.push(...codeConds);
      altsStrict.push(...codeConds);
      identity = true;
    }
    if (keyMatch.length > 0) {
      alts.push({ setId: { in: keyMatch } });
      altsStrict.push({ setId: { in: keyMatch } });
      if (!single) identity = true;
    }
    if (single) {
      alts.push(nameCond(w), { number: { contains: w, mode: 'insensitive' } });
      // Identidad de una sola palabra: solo código exacto (no clave sola ni nombre).
      return { soft: { OR: alts }, strict: code ? { OR: altsStrict } : { OR: alts }, identity: !!code };
    }
    alts.push(nameCond(w));
    return { soft: alts.length === 1 ? alts[0] : { OR: alts }, strict: altsStrict.length > 0 ? { OR: altsStrict } : nameCond(w), identity };
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const nxt = words[i + 1];
    if (!single && /^[a-z]{1,5}$/.test(w) && nxt && /^\d{1,3}$/.test(nxt)) {
      // «swsh 132», «pre 078»: letras + número adyacentes ⇒ también valen como código unido («swsh132»).
      const joined = wordConds(w + nxt);
      const a1 = wordConds(w);
      const a2 = wordConds(nxt);
      if (joined && a1 && a2) {
        soft.push({ OR: [joined.soft, { AND: [a1.soft, a2.soft] }] });
        strict.push({ OR: [joined.strict, { AND: [a1.strict, a2.strict] }] });
        hasIdentityWord = true;
        i += 1;
        continue;
      }
    }
    const c = wordConds(w);
    if (!c) continue;
    soft.push(c.soft);
    strict.push(c.strict);
    if (c.identity) hasIdentityWord = true;
  }

  const where: Prisma.CardWhereInput = soft.length === 1 ? soft[0] : { AND: soft };
  const tiers: Prisma.CardWhereInput[] = [];
  if (hasIdentityWord && strict.length > 0) {
    const identity: Prisma.CardWhereInput = strict.length === 1 ? strict[0] : { AND: strict };
    if (total !== null) {
      const sets = [...keys.totals.entries()].filter(([, t]) => t === total).map(([id]) => id);
      if (sets.length > 0) tiers.push({ AND: [identity, { setId: { in: sets } }] });
    }
    tiers.push(identity);
  }
  return { where, identityTiers: tiers, matchesNothing: false };
}

/** Solo el filtro (para buscadores que ya tienen su propio orden/paginación). `null` ⇒ sin `q`. */
export async function buildCardSearchWhere(db: SetKeyDb, q: string | undefined | null): Promise<Prisma.CardWhereInput | null> {
  if (!parseCardQuery(q)) return null;
  const keys = await loadCardSearchSetKeys(db);
  return buildCardSearchPlan(q, keys)?.where ?? null;
}

/**
 * Página de cartas con el orden de §2: con `setId` el orden dado tal cual; sin `setId` y con identidad,
 * nivel 1 (≤ 200 ids, orden global) y después el resto, todo ANTES de paginar. `total` = count del conjunto.
 */
export async function searchCardsPage<I extends Prisma.CardInclude>(
  db: CardDb,
  params: {
    q?: string | null;
    baseWhere?: Prisma.CardWhereInput;
    hasSetId: boolean;
    orderBy: Prisma.CardOrderByWithRelationInput[];
    page: number;
    pageSize: number;
    include: I;
  },
) {
  const keys = parseCardQuery(params.q) ? await loadCardSearchSetKeys(db) : null;
  const plan = keys ? buildCardSearchPlan(params.q, keys) : null;
  const where: Prisma.CardWhereInput = plan
    ? { AND: [params.baseWhere ?? {}, plan.where] }
    : (params.baseWhere ?? {});
  const skip = (params.page - 1) * params.pageSize;
  const take = params.pageSize;
  const total = await db.card.count({ where });
  type Row = Prisma.CardGetPayload<{ include: I }>;

  if (plan && !params.hasSetId && skip + take > CARD_SEARCH_DEPTH_CAP) {
    return { rows: [] as Row[], total };
  }

  const tier1: string[] = [];
  if (plan && !params.hasSetId) {
    for (const tier of plan.identityTiers) {
      if (tier1.length >= CARD_SEARCH_IDENTITY_MAX) break;
      const got = await db.card.findMany({
        where: { AND: [params.baseWhere ?? {}, where, tier, ...(tier1.length ? [{ id: { notIn: tier1 } }] : [])] },
        select: { id: true },
        orderBy: CARD_ORDER_BY_GLOBAL,
        take: CARD_SEARCH_IDENTITY_MAX - tier1.length,
      });
      tier1.push(...got.map((g) => g.id));
    }
  }

  const head = tier1.slice(skip, skip + take);
  let rows: Row[] = [];
  if (head.length > 0) {
    const found = (await db.card.findMany({ where: { id: { in: head } }, include: params.include })) as Row[];
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = head.map((id) => byId.get(id)).filter((r): r is Row => !!r);
  }
  const need = take - rows.length;
  if (need > 0) {
    const rest = (await db.card.findMany({
      where: tier1.length ? { AND: [where, { id: { notIn: tier1 } }] } : where,
      include: params.include,
      orderBy: params.orderBy,
      skip: Math.max(0, skip - tier1.length),
      take: need,
    })) as Row[];
    rows = rows.concat(rest);
  }
  return { rows, total };
}
