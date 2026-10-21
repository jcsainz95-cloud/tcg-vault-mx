/**
 * C-F8 × C-B10 (v1.106, §MKT.H.4) — las DOS implementaciones de `measurementItemOf` (navegador y servidor) dan el mismo
 * resultado. Cada una ya se prueba contra la tabla del contrato; esta prueba ejecuta LA DEL BACKEND (en un proceso aparte: el
 * código del frontend no importa el backend) y compara sobre la tabla MÁS una rejilla de casos fuera de ella
 * (con/sin `cardId`, `sealedProductId` string/null/''/ausente, con/sin set, raw/graded/sealed, nombre nulo). Así una
 * divergencia fuera de la tabla también se pone roja. Accesorios fuera: solo existen en el servidor.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measurementItemOf as browserItemOf, type MeasurementItemFacts } from './item';

// La gemela del servidor corre en un PROCESO de Node aparte (Node ≥ 22.18 quita los tipos de un `.ts` sin dependencias
// de ejecución, como `measurement-item.ts`): ni `tsc` del frontend recorre el backend (`@prisma/client`) ni Vite
// tiene que servir un fichero de fuera de su raíz.
const SERVER_ITEM = resolve(__dirname, '../../../../backend/src/modules/measurement/measurement-item.ts');
const RUNNER = "const m = await import(process.env.SERVER_ITEM_URL); let s = ''; for await (const c of process.stdin) s += c; " +
  "process.stdout.write(JSON.stringify(JSON.parse(s).map((f) => m.measurementItemOf(f))));";

function serverItems(cases: unknown[]): unknown[] {
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', RUNNER], {
    input: JSON.stringify(cases),
    env: { ...process.env, SERVER_ITEM_URL: pathToFileURL(SERVER_ITEM).href },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`no pude ejecutar measurementItemOf del servidor (rc ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const CONTRACT = readFileSync(resolve(__dirname, '../../../../docs/API_CONTRACT.md'), 'utf8');

function contractFacts(): MeasurementItemFacts[] {
  const m = CONTRACT.match(/<!-- MKT-ITEM-ID:start -->([\s\S]*?)<!-- MKT-ITEM-ID:end -->/);
  if (!m) throw new Error('marcadores MKT-ITEM-ID no encontrados');
  return m[1]
    .split('\n')
    .filter((l) => l.startsWith('| `{'))
    .map((l) => JSON.parse(/`([^`]*)`/.exec(l)![1]));
}

function grid(): MeasurementItemFacts[] {
  const out: MeasurementItemFacts[] = [];
  const ABSENT = Symbol('absent');
  for (const cardId of ['sv3-1', '', ABSENT] as const)
    for (const productType of ['raw', 'graded', 'sealed'] as const)
      for (const sealedProductId of ['sp-9', null, '', ABSENT] as const)
        for (const setName of ['Obsidian Flames', '', ABSENT] as const)
          for (const name of ['ETB Obsidian Flames', null] as const) {
            const f: Record<string, unknown> = { productType, name };
            if (cardId !== ABSENT) f.cardId = cardId;
            if (sealedProductId !== ABSENT) f.sealedProductId = sealedProductId;
            if (setName !== ABSENT) f.setName = setName;
            out.push(f as MeasurementItemFacts);
          }
  return out;
}

describe('C-F8 × C-B10 · navegador y servidor dan el mismo item', () => {
  const cases = [...contractFacts(), ...grid()];

  it(`los ${cases.length} casos (tabla del contrato + rejilla) coinciden`, () => {
    expect(cases.length).toBeGreaterThan(200);
    const server = serverItems(cases);
    expect(server).toHaveLength(cases.length);
    const diffs = cases
      .map((f, i) => ({ f, browser: browserItemOf(f), server: server[i] }))
      .filter((d) => JSON.stringify(d.browser) !== JSON.stringify(d.server));
    expect(diffs).toEqual([]);
  });
});
