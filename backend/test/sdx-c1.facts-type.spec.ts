/**
 * sdx-c1.facts-type.spec.ts — 💰 C1 / G2 (API_CONTRACT §M4-SHIP.19.33.7): el tipo de `facts` se AMPLÍA (⛔ no se aplana) con el
 * objeto persona `{ userId: string; name: string | null; role?: Role }` (`role?` desde §19.34.1, B-4: AG-22 `target`), y es el MISMO en el servicio (`SpendFacts`) y en el DTO
 * (`SpendAlertDTO.facts`). Lo construido ya escribía objetos (AG-21 `previousOwner`/`currentOwner`, AG-22 `target`) a través de
 * un `as unknown as SpendFacts`; G2 quita ese cast del llamador. Propiedad: backend.
 *
 * La mitad de tipos la juzga el compilador (ts-jest con diagnósticos: si el tipo no admite el objeto, esta suite no compila);
 * la otra mitad es un censo: ningún `as unknown as SpendFacts` en `src/`.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Role } from '@prisma/client';
import { SpendFacts, SpendFactValue } from '../src/modules/spend-alerts/spend-alerts.service';
import { SpendAlertDTO } from '../src/modules/spend-alerts/spend-alert.view';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const assertType = <T extends true>(): T => true as T;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('G2 — `SpendFactValue` admite el objeto persona y es el tipo de `facts` en servicio y DTO', () => {
  it('compila: AG-21 y AG-22 sin cast (persona con nombre o con `name: null`)', () => {
    const person: SpendFactValue = { userId: 'u-1', name: 'Dueña' };
    const unnamed: SpendFactValue = { userId: 'u-2', name: null };
    const facts: SpendFacts = { cause: 'changed', previousOwner: person, currentOwner: unnamed, keys: ['a'], n: 1, ok: true, none: null };
    expect(Object.keys(facts)).toHaveLength(7);
  });

  it('compila (§19.34.1, B-4): AG-22 `target` con `role` es el objeto persona, sin subtipo ni cast; AG-21 sin `role`', () => {
    const target: SpendFactValue = { userId: 'u-3', name: 'Ana', role: Role.vault_operator };
    const facts: SpendFacts = { act: 'staff_created', target, keys: null };
    expect(facts.target).toEqual({ userId: 'u-3', name: 'Ana', role: 'vault_operator' });
  });

  it('`SpendFacts` ≡ `Record<string, SpendFactValue>` ≡ `SpendAlertDTO["facts"]` (un solo tipo, ⛔ dos que derivan)', () => {
    expect(assertType<Equal<SpendFacts, Record<string, SpendFactValue>>>()).toBe(true);
    expect(assertType<Equal<SpendAlertDTO['facts'], Record<string, SpendFactValue>>>()).toBe(true);
    expect(
      assertType<Equal<SpendFactValue, string | number | boolean | string[] | null | { userId: string; name: string | null; role?: Role }>>(),
    ).toBe(true);
  });

  it('censo: ningún `as unknown as SpendFacts` en `src/` (G2 quita el cast del llamador)', () => {
    const offenders = walk(join(__dirname, '..', 'src'))
      .filter((p) => !p.endsWith('.spec.ts'))
      .filter((p) => /as\s+unknown\s+as\s+SpendFacts/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
