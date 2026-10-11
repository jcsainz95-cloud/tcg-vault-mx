import { EnergyType } from '@prisma/client';

/**
 * 💰 §AC.8 «Tipo de energía» — `energyTypeOf(rawName)`, PURO.
 *
 * - Diccionario sin distinguir mayúsculas, sobre PALABRAS COMPLETAS, con o sin «Basic».
 * - `darkness|dark` ⇒ `darkness`; símbolos `{G} {R} {W} {L} {P} {F} {D} {M}`.
 * - Sin coincidencia, o con MÁS DE UN tipo distinto ⇒ `null`. (El mismo tipo dos veces —palabra y símbolo— es un tipo.)
 * - Solo se aplica a líneas `matchStatus = unmatched_basic_energy` (eso lo filtra quien llama).
 */
const WORDS: ReadonlyArray<readonly [RegExp, EnergyType]> = [
  [/\bgrass\b/i, EnergyType.grass],
  [/\bfire\b/i, EnergyType.fire],
  [/\bwater\b/i, EnergyType.water],
  [/\blightning\b/i, EnergyType.lightning],
  [/\bpsychic\b/i, EnergyType.psychic],
  [/\bfighting\b/i, EnergyType.fighting],
  [/\b(?:darkness|dark)\b/i, EnergyType.darkness],
  [/\bmetal\b/i, EnergyType.metal],
];

const SYMBOLS: Readonly<Record<string, EnergyType>> = {
  G: EnergyType.grass,
  R: EnergyType.fire,
  W: EnergyType.water,
  L: EnergyType.lightning,
  P: EnergyType.psychic,
  F: EnergyType.fighting,
  D: EnergyType.darkness,
  M: EnergyType.metal,
};

export function energyTypeOf(rawName: string): EnergyType | null {
  if (typeof rawName !== 'string') return null;
  const found = new Set<EnergyType>();
  for (const [re, t] of WORDS) if (re.test(rawName)) found.add(t);
  for (const m of rawName.matchAll(/\{([A-Za-z])\}/g)) {
    const t = SYMBOLS[m[1].toUpperCase()];
    if (t) found.add(t);
  }
  return found.size === 1 ? [...found][0] : null;
}
