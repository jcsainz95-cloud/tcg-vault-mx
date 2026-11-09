import { normalizeMatchText } from '../../common/card-version';
import { PTCG_PROMO_GROUPS } from './promo-set-groups';

/**
 * AUTO-F (docs/specs/AUTO_CATALOGO.md §F) - evaluador PURO y SIN ESTADO de grupos de promos de TCGCSV. Se reevalua en cada corrida.
 * Patrones medidos 2026-11-09 sobre los 221 grupos de la categoria 3 (31 casan el patron de promo; ver docs/STATUS.md).
 *
 * Elegible = TODAS las condiciones duras (1-2 por nombre) y las suaves limpias (3-5). Dudoso (falla suave) => cuarentena.
 */
export const PROMO_NAME_PATTERN = /\bpromos?\b|black star/i;
export const PROMO_EXCLUDE_PATTERN = /japan|\bjp\b|chinese|korean|jumbo|deck|kit|sealed|theme/i;
export const MIN_PRODUCTS_WITH_NUMBER = 20;
export const NUMBER_RATIO_ELIGIBLE = 0.8;
export const NUMBER_RATIO_GRAY = 0.5;
export const CONTENT_MATCH_ELIGIBLE_MAX = 0.1; // < 10 % coincidencia con un set vivo: sin equivalente
export const CONTENT_MATCH_EQUIVALENT = 0.3; // >= 30 %: equivalente
export const MIN_PUBLISHED_AGE_DAYS = 7;
export const MAX_NEW_GROUPS_PER_RUN = 2;

export type DiscoveryVerdict = 'eligible' | 'quarantine' | 'ignore';
export interface DiscoveryResult {
  verdict: DiscoveryVerdict;
  reasons: string[];
}
export interface DiscoveryInput {
  group: { groupId: number; name: string; publishedOn?: string | null };
  products: { name: string; number: string | null }[];
  /** lista VIVA de pokemontcg.io (id + nombre). */
  liveSets: { id: string; name: string }[];
  /** Mayor fraccion (0..1) de productos del grupo cuyo (nombre+numero) coincide con UN mismo set ya conocido. */
  maxContentMatch: number;
  now: Date;
}

const SEALED_NAME = /booster|\bbox\b|\bpack\b|\btin\b|bundle|collection|deck|case|display|blister|elite trainer/i;

export function evaluateDiscoveryGroup(i: DiscoveryInput): DiscoveryResult {
  const name = i.group.name;
  // 2. (dura) ES de promos y sin exclusion.
  const isPromo = PROMO_NAME_PATTERN.test(name);
  const excluded = PROMO_EXCLUDE_PATTERN.test(name);
  if (!isPromo) return { verdict: 'ignore', reasons: ['not_promo_name'] };
  if (excluded) return { verdict: 'quarantine', reasons: ['name_in_promo_and_exclusion'] };
  const reasons: string[] = [];
  // 3. >= 20 productos con Number y >= 80 % de los no-sellado.
  const withNumber = i.products.filter((p) => (p.number ?? '').trim() !== '');
  const nonSealed = i.products.filter((p) => (p.number ?? '').trim() !== '' || !SEALED_NAME.test(p.name));
  const ratio = nonSealed.length === 0 ? 0 : withNumber.length / nonSealed.length;
  if (withNumber.length < MIN_PRODUCTS_WITH_NUMBER) return { verdict: 'ignore', reasons: ['too_few_numbered_products'] };
  if (ratio < NUMBER_RATIO_GRAY) return { verdict: 'ignore', reasons: ['numbered_ratio_low'] };
  if (ratio < NUMBER_RATIO_ELIGIBLE) reasons.push('numbered_ratio_gray');
  // 4. sin equivalente vivo.
  const norm = normalizeMatchText(name);
  const oldPromoIds = new Set(PTCG_PROMO_GROUPS.map((g) => g.groupId));
  if (oldPromoIds.has(i.group.groupId)) return { verdict: 'ignore', reasons: ['covered_by_old_promo_group'] };
  if (i.liveSets.some((s) => s.name != null && normalizeMatchText(s.name) === norm)) return { verdict: 'ignore', reasons: ['live_equivalent_by_name'] };
  if (i.maxContentMatch >= CONTENT_MATCH_EQUIVALENT) return { verdict: 'ignore', reasons: ['live_equivalent_by_content'] };
  if (i.maxContentMatch >= CONTENT_MATCH_ELIGIBLE_MAX) reasons.push('content_match_gray');
  // 5. estable: publishedOn con >= 7 dias.
  const pub = i.group.publishedOn ? Date.parse(i.group.publishedOn) : NaN;
  if (!Number.isFinite(pub)) {
    reasons.push('published_on_missing');
  } else if (i.now.getTime() - pub < MIN_PUBLISHED_AGE_DAYS * 86_400_000) {
    reasons.push('published_too_recent');
  }
  return reasons.length > 0 ? { verdict: 'quarantine', reasons } : { verdict: 'eligible', reasons: [] };
}
