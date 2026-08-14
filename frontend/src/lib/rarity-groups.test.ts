import { describe, it, expect } from 'vitest';
import { rarityGroup, groupRarities } from './rarity-groups';

describe('rarity-groups (taxonomía abierta → grupos de presentación)', () => {
  it('mapea rarezas conocidas a su grupo', () => {
    expect(rarityGroup('Common')).toBe('standard');
    expect(rarityGroup('Reverse Holo')).toBe('standard');
    expect(rarityGroup('Illustration Rare')).toBe('illustration');
    expect(rarityGroup('Special Illustration Rare')).toBe('illustration');
    expect(rarityGroup('Ultra Rare')).toBe('ultra');
    expect(rarityGroup('Radiant Rare')).toBe('special');
    expect(rarityGroup('Rare Secret')).toBe('special');
  });

  it('cae en "other" para rarezas no mapeadas (fallback, nunca cierra la taxonomía)', () => {
    expect(rarityGroup('Totally New Rarity 2027')).toBe('other');
  });

  it('agrupa respetando el orden y ordena alfabéticamente dentro del grupo', () => {
    const groups = groupRarities([
      'Ultra Rare',
      'Common',
      'Illustration Rare',
      'Reverse Holo',
      'Mystery XYZ',
    ]);
    const keys = groups.map((g) => g.group);
    // standard antes que ultra antes que illustration antes que other
    expect(keys.indexOf('standard')).toBeLessThan(keys.indexOf('ultra'));
    expect(keys.indexOf('ultra')).toBeLessThan(keys.indexOf('illustration'));
    expect(keys).toContain('other');
    const standard = groups.find((g) => g.group === 'standard')!;
    expect(standard.rarities).toEqual(['Common', 'Reverse Holo']);
  });
});
