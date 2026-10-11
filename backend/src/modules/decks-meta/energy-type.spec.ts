import { EnergyType } from '@prisma/client';
import { energyTypeOf } from './energy-type';

/**
 * AC-B28 (`API_CONTRACT §AC.8` «Tipo de energía») — `energyTypeOf(rawName)` puro: diccionario sin distinguir
 * mayúsculas, sobre palabras completas, con o sin «Basic»; `darkness|dark`; símbolos `{G} {R} {W} {L} {P} {F} {D} {M}`.
 * Sin coincidencia, o con MÁS DE UN tipo ⇒ `null`.
 */
describe('AC-B28 energyTypeOf (§AC.8)', () => {
  const cases: [string, EnergyType | null][] = [
    // Nombres en inglés, con y sin «Basic», cualquier capitalización.
    ['Basic Grass Energy', 'grass'],
    ['Grass Energy', 'grass'],
    ['basic fire energy', 'fire'],
    ['FIRE ENERGY', 'fire'],
    ['Basic Water Energy', 'water'],
    ['Lightning Energy', 'lightning'],
    ['Basic Psychic Energy', 'psychic'],
    ['Fighting Energy', 'fighting'],
    ['Basic Darkness Energy', 'darkness'],
    ['Dark Energy', 'darkness'],
    ['Basic Metal Energy', 'metal'],
    // Símbolos de Limitless / PTCGL.
    ['Basic {G} Energy', 'grass'],
    ['Basic {R} Energy', 'fire'],
    ['Basic {W} Energy', 'water'],
    ['Basic {L} Energy', 'lightning'],
    ['Basic {P} Energy', 'psychic'],
    ['Basic {F} Energy', 'fighting'],
    ['Basic {D} Energy', 'darkness'],
    ['Basic {M} Energy', 'metal'],
    ['basic {m} energy', 'metal'],
    // El mismo tipo dos veces (palabra + símbolo, o «dark» + «darkness») NO es ambiguo: es un tipo.
    ['Basic Fire Energy {R}', 'fire'],
    ['Darkness Energy (Dark)', 'darkness'],
    // Desconocido ⇒ null.
    ['Double Turbo Energy', null],
    ['Jet Energy', null],
    ['Basic Energy', null],
    ['', null],
    ['   ', null],
    ['{X} Energy', null],
    // Palabra COMPLETA: subcadenas no cuentan.
    ['Firestarter Energy', null],
    ['Metallic Energy', null],
    ['Watery Energy', null],
    ['Darkest Energy', null],
    // Más de un tipo ⇒ null (ambiguo).
    ['Fire Water Energy', null],
    ['Basic {G}{R} Energy', null],
    ['Dark Metal Energy', null],
    ['Psychic Energy {F}', null],
  ];

  it.each(cases)('%j ⇒ %j', (raw, expected) => {
    expect(energyTypeOf(raw)).toBe(expected);
  });

  it('los 8 tipos del enum se reconocen (ninguno se queda fuera del diccionario)', () => {
    const seen = new Set<EnergyType>();
    for (const [raw, t] of cases) if (t && energyTypeOf(raw) === t) seen.add(t);
    expect([...seen].sort()).toEqual(Object.values(EnergyType).sort());
  });

  it('entradas no-cadena ⇒ null (no revienta)', () => {
    expect(energyTypeOf(undefined as unknown as string)).toBeNull();
    expect(energyTypeOf(null as unknown as string)).toBeNull();
  });
});
