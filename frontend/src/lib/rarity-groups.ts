/**
 * Mapa de PRESENTACIÓN rareza → grupo para el filtro de rareza de Compra
 * (DESIGN_SYSTEM §7.16a). Es sólo del front: agrupa una taxonomía ABIERTA
 * (rarezas crudas de pokemontcg.io) en familias legibles con encabezados.
 * NUNCA cierra la taxonomía ni depende del backend; a la API se manda la
 * rareza CRUDA. Cualquier rareza no mapeada cae en "other" ("Otras"/"Other").
 */
export type RarityGroup = 'standard' | 'ultra' | 'illustration' | 'special' | 'other';

/** Orden de presentación de los grupos en el desplegable. */
export const RARITY_GROUP_ORDER: RarityGroup[] = [
  'standard',
  'ultra',
  'illustration',
  'special',
  'other',
];

// Reglas por substring (case-insensitive) sobre la rareza cruda. El orden importa:
// se evalúan de arriba a abajo y gana la primera coincidencia.
const RULES: { group: RarityGroup; patterns: RegExp[] }[] = [
  {
    group: 'illustration',
    patterns: [/illustration/i, /\bart\b/i, /full art/i, /alt(ernate)? art/i, /trainer gallery/i, /character/i],
  },
  {
    group: 'special',
    patterns: [/radiant/i, /shiny/i, /secret/i, /rainbow/i, /\bgold\b/i, /amazing/i, /hyper/i],
  },
  {
    group: 'ultra',
    patterns: [/ultra/i, /\bex\b/i, /\bgx\b/i, /\bv\b/i, /vmax/i, /vstar/i, /double rare/i],
  },
  {
    group: 'standard',
    patterns: [/reverse/i, /^common$/i, /uncommon/i, /^rare$/i, /rare holo/i, /^holo/i, /promo/i],
  },
];

export function rarityGroup(rarity: string): RarityGroup {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(rarity))) return rule.group;
  }
  return 'other';
}

/** Agrupa una lista de rarezas crudas en `{ group, rarities[] }`, respetando el orden. */
export function groupRarities(rarities: string[]): { group: RarityGroup; rarities: string[] }[] {
  const buckets = new Map<RarityGroup, string[]>();
  for (const r of rarities) {
    const g = rarityGroup(r);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(r);
  }
  return RARITY_GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    rarities: buckets.get(g)!.sort((a, b) => a.localeCompare(b)),
  }));
}
