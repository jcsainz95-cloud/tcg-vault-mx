/**
 * rarity-catalog.ts (v1.29, ARCHITECTURE §4.28) — CATÁLOGO CANÓNICO de rarezas: la ÚNICA fuente
 * autoritativa de rarezas del sistema. Zona compartida (`common/`), sin dependencias de infra
 * (importable desde seeds/tests). Cierra el problema de que `Card.rarity` guarda el string CRUDO de
 * pokemontcg.io y las reglas de precio se resolvían por match EXACTO case-sensitive → cualquier
 * discrepancia caía al fallback pct en silencio.
 *
 * Tres responsabilidades:
 *  1. `normalizeRarity(raw) → canonical` — colapsa las formas crudas a la `key` canónica que el admin
 *     edita (empate 1:1 por construcción). Se aplica en el INGEST (poblando `Card.rarityCanonical`),
 *     en el ADMIN (`groupBy(['rarityCanonical'])`) y en el LOOKUP de reglas.
 *  2. `isPremiumCanonicalRarity(rarity)` — la ÚNICA definición de «premium/chase» del sistema (§4.28e).
 *     Reemplaza las DOS `isPremiumRarity` divergentes (money.ts `PREMIUM_RARITY_PATTERNS` y
 *     ppt-sync-scope.ts `PREMIUM_RARITY_TERMS`) que daban verdictos OPUESTOS sobre el mismo string.
 *     DECISIÓN DEL PO (R-4, cerrada): «premium» es UN SOLO atributo, al servicio del pricing buylist.
 *  3. `rarityInfo(raw)` — proyección `{ canonical, premium, mapped }` para el editor de reglas del admin.
 *
 * Money-safe: una rareza sin entrada en el catálogo entra como `unmapped` (pass-through Title-case) y
 * cae al fallback pct de forma PREDECIBLE y auditable — nunca se descarta ni se inventa precio. Para el
 * verdicto premium de una rareza `unmapped` se usa un predicado por PATRÓN (heredado de money.ts) como
 * red money-safe conservadora: sobre-incluir premium es inocuo (cotiza por % de mercado), sub-incluir
 * una chase la tira al bin fijo barato de bulk = pérdida de dinero. El seed de `premium` de las
 * entradas del catálogo REPRODUCE EXACTAMENTE la semántica vigente de money.ts (Common/Uncommon/Rare/
 * Rare Holo/Reverse Holo = NO premium; ex/Double Rare/Ultra/Illustration/Secret/Hyper/… = premium).
 */

export interface CanonicalRarity {
  /** Etiqueta canónica EXACTA = la key que el admin edita en las reglas por rareza. */
  key: string;
  /** ÚNICA definición de «premium/chase» del sistema (§4.28e). */
  premium: boolean;
  /** Formas NORMALIZADAS de pokemontcg.io (u otras fuentes) que colapsan a esta canónica. */
  aliases: string[];
}

/** Forma normalizada de búsqueda: minúsculas + colapsa espacios + quita todo lo no alfanumérico. */
function normKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9]/g, '');
}

/**
 * Predicado premium POR PATRÓN (red money-safe para rarezas `unmapped`). Espejo de los
 * `PREMIUM_RARITY_PATTERNS` que vivían en money.ts — se centraliza aquí para que exista UNA sola
 * verdad. Sobre-incluir es inocuo; sub-incluir una chase pierde dinero.
 */
const PREMIUM_SUBSTRINGS = [
  'illustration', // Illustration Rare, Special Illustration Rare
  'ultrarare', // Ultra Rare / Rare Ultra (Full Art)
  'doublerare', // Double Rare (ex, Scarlet & Violet)
  'secret', // Rare Secret / Secret Rare / Gold Secret
  'rainbow', // Rainbow Rare
  'hyper', // Hyper Rare
  'fullart', // Full Art
  'alternateart', // Alternate Art
  'altart', // Alt Art
  'special', // Special Illustration Rare, etc.
  'amazing', // Amazing Rare
  'radiant', // Radiant
  'shiny', // Rare Shiny / Shiny Ultra Rare
  'trainergallery', // Trainer Gallery
  'character', // Character Rare / Super Rare
  'gold', // Gold (Secret) Rare
  'prism', // Prism Star
  // H5 (P-34, TECH_DEBT): patrones que ANTES solo cubrían alias explícitos → una variante string NUEVA
  // no-alias («Mega X», «Black White Y») caería a premium:false = bin holo barato (money-losing clase
  // R-5). Consistentes con las canónicas premium ya mapeadas (`MEGA_ATTACK_RARE`→Mega Rare, Black White
  // Rare → T3). Sobre-incluir premium es inocuo (cotiza por % de mercado); sub-incluir una chase pierde $.
  'mega', // Mega Rare / Mega Hyper Rare / MEGA_ATTACK_RARE
  'blackwhite', // Black White Rare (y variantes futuras «Black White …»)
];
/** Familia V/EX/GX como TOKEN (sobre el string con espacios) para evitar falsos positivos. */
const PREMIUM_WORDS = /\b(v|vmax|vstar|vunion|v-union|ex|gx)\b/;

function premiumByPattern(rarity: string): boolean {
  const s = rarity.toLowerCase();
  const norm = normKey(rarity);
  if (norm === '') return false;
  if (PREMIUM_SUBSTRINGS.some((t) => norm.includes(t))) return true;
  return PREMIUM_WORDS.test(s);
}

/**
 * Seed del catálogo canónico (§4.28b). `key` = la cadena EXACTA con la que el admin edita las reglas.
 * `premium` reproduce la semántica vigente de money.ts. `aliases` = formas normalizadas equivalentes.
 * Cerrado y versionado: una rareza nueva de un release futuro entra `unmapped` (fallback pct) hasta
 * que se añada aquí (R-5, deuda documentada).
 */
export const CANONICAL_RARITIES: CanonicalRarity[] = [
  // --- Bulk / no premium (precio FIJO de bin barato en buylist) ---
  { key: 'Common', premium: false, aliases: ['common'] },
  { key: 'Uncommon', premium: false, aliases: ['uncommon'] },
  { key: 'Rare', premium: false, aliases: ['rare', 'rarenormal'] },
  { key: 'Rare Holo', premium: false, aliases: ['rareholo'] },
  { key: 'Reverse Holo', premium: false, aliases: ['reverseholo', 'reverseholofoil'] },
  { key: 'Promo', premium: false, aliases: ['promo', 'rarepromo'] },
  // --- Premium / chase (cotiza por % de mercado, nunca al bin fijo de bulk) ---
  { key: 'Double Rare', premium: true, aliases: ['doublerare', 'raredouble'] },
  { key: 'Ultra Rare', premium: true, aliases: ['ultrarare', 'rareultra'] },
  { key: 'Illustration Rare', premium: true, aliases: ['illustrationrare', 'rareillustration'] },
  {
    key: 'Special Illustration Rare',
    premium: true,
    aliases: ['specialillustrationrare', 'rarespecialillustration'],
  },
  // v1.37 (§4.33e, P-34): +alias `megahyperrare` — `normalizeRarity('Mega Hyper Rare') → "Hyper Rare"` → T4.
  { key: 'Hyper Rare', premium: true, aliases: ['hyperrare', 'rarerainbow', 'rainbowrare', 'megahyperrare'] },
  { key: 'Secret Rare', premium: true, aliases: ['secretrare', 'raresecret', 'goldsecretrare'] },
  { key: 'Gold Rare', premium: true, aliases: ['goldrare', 'raregold'] },
  { key: 'Shiny Rare', premium: true, aliases: ['shinyrare', 'rareshiny', 'shinyultrarare'] },
  { key: 'Amazing Rare', premium: true, aliases: ['amazingrare', 'rareamazing'] },
  { key: 'Radiant Rare', premium: true, aliases: ['radiantrare', 'radiant'] },
  { key: 'Rare Holo EX', premium: true, aliases: ['rareholoex', 'rareex'] },
  { key: 'Rare Holo GX', premium: true, aliases: ['rarehologx'] },
  { key: 'Rare Holo V', premium: true, aliases: ['rareholov'] },
  { key: 'Rare Holo VMAX', premium: true, aliases: ['rareholovmax'] },
  { key: 'Rare Holo VSTAR', premium: true, aliases: ['rareholovstar'] },
  { key: 'Rare Holo LV.X', premium: true, aliases: ['rarehololvx', 'rarehololevelx'] },
  { key: 'Rare Prime', premium: true, aliases: ['rareprime'] },
  { key: 'Rare BREAK', premium: true, aliases: ['rarebreak'] },
  { key: 'LEGEND', premium: true, aliases: ['legend', 'rarelegend'] },
  { key: 'Rare ACE', premium: true, aliases: ['rareace', 'acespecrare'] },
  { key: 'Trainer Gallery Rare Holo', premium: true, aliases: ['trainergalleryrareholo'] },
  // v1.37 (§4.33e, P-34): +2 canónicas PREMIUM que cerraban `unmapped` money-losing. `MEGA_ATTACK_RARE`
  // (snake_case; `normKey` lo colapsa a `megaattackrare`) → "Mega Rare" → T3; `Black White Rare` → T3.
  // Con `premium:true` DEJAN de cotizar al bin de acabado holo barato de bulk (FIX de dinero §4.33f).
  { key: 'Mega Rare', premium: true, aliases: ['megaattackrare', 'megarare'] },
  { key: 'Black White Rare', premium: true, aliases: ['blackwhiterare'] },
];

/** Índice `aliasNormalizado → CanonicalRarity`, más la `key` canónica normalizada como alias. */
const BY_ALIAS = new Map<string, CanonicalRarity>();
for (const r of CANONICAL_RARITIES) {
  BY_ALIAS.set(normKey(r.key), r);
  for (const a of r.aliases) BY_ALIAS.set(normKey(a), r);
}

/** Title-case de la forma cruda (para el pass-through de una rareza `unmapped`). */
function titleCase(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * §4.28c — Normaliza `rawRarity → canonicalRarity`. Devuelve la `key` canónica si la forma normalizada
 * empata un alias del catálogo; si NO (rareza `unmapped`), devuelve una canónica pass-through
 * (Title-case de la forma cruda) para que el admin la vea y le asigne regla. `null`/vacío → `null`.
 */
export function normalizeRarity(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const hit = BY_ALIAS.get(normKey(trimmed));
  if (hit) return hit.key;
  return titleCase(trimmed);
}

/** ¿La rareza cruda/canónica tiene ENTRADA en el catálogo canónico? (false = `unmapped`). */
export function isRarityMapped(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  return BY_ALIAS.has(normKey(String(raw)));
}

/**
 * §4.28e — ÚNICA definición de «premium» del sistema. Acepta la rareza CRUDA o la canónica. Si empata
 * una entrada del catálogo, usa su `premium` (DATO auditable); si es `unmapped`, cae a `premiumByPattern`
 * (red money-safe conservadora). Reemplaza las dos `isPremiumRarity` divergentes.
 */
export function isPremiumCanonicalRarity(rarity: string | null | undefined): boolean {
  if (rarity == null) return false;
  const s = String(rarity);
  const hit = BY_ALIAS.get(normKey(s));
  if (hit) return hit.premium;
  return premiumByPattern(s);
}

/** Proyección para el editor del admin (`GET /admin/pricing/rarities`, §4.28c). */
export function rarityInfo(raw: string | null | undefined): {
  canonical: string | null;
  premium: boolean;
  mapped: boolean;
} {
  const canonical = normalizeRarity(raw);
  return {
    canonical,
    premium: isPremiumCanonicalRarity(raw),
    mapped: isRarityMapped(raw),
  };
}
