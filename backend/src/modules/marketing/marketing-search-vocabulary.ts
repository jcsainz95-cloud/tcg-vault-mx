/**
 * marketing-search-vocabulary.ts — LISTA PERMITIDA de c6 (MKT_PANEL_V2 §7, MKV2-1). Un término de búsqueda sin resultado solo
 * se guarda y solo se muestra si CADA palabra suya es del vocabulario del catálogo (palabras de nombres de carta, de set y de
 * serie, código del set, rarezas, supertipos/subtipos y nombres de producto sellado) o es un número de carta (`^\d{1,4}$`, con
 * `/` ya partido en espacio). Se deriva de la BD (caché 1 h): crece solo con el catálogo, sin lista a mano. Un nombre de persona,
 * una calle, un dominio o un error de dedo quedan fuera: es el costo aceptado (no hay lista de pendientes).
 * ⛔ Fail-closed: si la BD no responde y no hay caché, nada se permite.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const SEARCH_VOCAB_TTL_MS = 60 * 60 * 1000;
const CARD_NUMBER = /^\d{1,4}$/;

/** Minúsculas, sin acentos salvo ñ, solo `[a-z0-9ñ ]`, espacios colapsados. PURO. */
export function foldSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Cada palabra del término (ya normalizado) está en el vocabulario o es número de carta? PURO. */
export function termInVocabulary(term: string, vocab: ReadonlySet<string>): boolean {
  const words = term.split(' ').filter(Boolean);
  if (words.length === 0) return false;
  return words.every((w) => vocab.has(w) || CARD_NUMBER.test(w));
}

@Injectable()
export class MarketingSearchVocabulary {
  private readonly logger = new Logger(MarketingSearchVocabulary.name);
  private cache: { at: number; words: Set<string> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load(now: number): Promise<Set<string> | null> {
    if (this.cache && now - this.cache.at < SEARCH_VOCAB_TTL_MS) return this.cache.words;
    try {
      const rows = await this.prisma.$queryRaw<{ v: string | null }[]>`
        SELECT "name" AS v FROM "Card"
        UNION SELECT "rarity" FROM "Card"
        UNION SELECT "supertype" FROM "Card"
        UNION SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof("subtypes"::jsonb) = 'array' THEN "subtypes"::jsonb ELSE '[]'::jsonb END) FROM "Card"
        UNION SELECT "name" FROM "CardSet"
        UNION SELECT "series" FROM "CardSet"
        UNION SELECT "ptcgoCode" FROM "CardSet"
        UNION SELECT "name" FROM "SealedProduct"
        UNION SELECT "cleanName" FROM "SealedProduct"`;
      const words = new Set<string>();
      for (const r of rows) if (typeof r.v === 'string') for (const w of foldSearchText(r.v).split(' ')) if (w) words.add(w);
      this.cache = { at: now, words };
      return words;
    } catch {
      this.logger.warn('marketing: no se pudo derivar el vocabulario del catálogo (c6 fail-closed)');
      return this.cache?.words ?? null;
    }
  }

  /** ¿El término normalizado es todo vocabulario del catálogo? `false` si no se pudo derivar el vocabulario. */
  async allows(term: string, now = Date.now()): Promise<boolean> {
    const vocab = await this.load(now);
    return vocab !== null && termInVocabulary(term, vocab);
  }
}
