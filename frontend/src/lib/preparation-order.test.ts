import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sortPreparationItems } from './preparation-order';
import type { LocationView, PreparationItemDTO } from '@/types/contract';

/**
 * **§M4P-ORDER (contrato v1.78.3) — los 7 casos se leen DEL CONTRATO, ⛔ nunca se transcriben.**
 *
 * El contrato lo dice con todas las letras: *«cada lado asevera contra ELLA, ⛔ nunca contra el otro
 * lado»*, y *«una suite que transcriba la tabla a mano **es una tercera fuente** y reintroduce el
 * defecto que esta cláusula cierra»*. Precedente del repo para este patrón exacto:
 * `backend/test/enum-values-parity.spec.ts` y `sell-request-states.spec.ts` leen `API_CONTRACT.md`.
 *
 * Por eso aquí **no hay ninguna expectativa escrita a mano**: el fichero se parsea y de él salen la
 * entrada y la salida de cada caso.
 */

const CONTRACT = join(process.cwd(), '..', 'docs', 'API_CONTRACT.md');

interface Caso {
  n: number;
  entrada: { id: string; label: string | null }[];
  salida: string[];
}

/** `∅` = `{kind:'unassigned'}`; `␣` = espacio literal dentro de la etiqueta (§M4P-ORDER). */
function parseCasos(texto: string): Caso[] {
  const casos: Caso[] = [];
  for (const linea of texto.split('\n')) {
    const m = /^\s*M4P-ORDER-CASE (\d+) \| IN: (.+?) \| OUT: (.+?)\s*$/.exec(linea);
    if (!m) continue;
    casos.push({
      n: Number(m[1]),
      entrada: m[2].split(',').map((tok) => {
        const [id, raw] = tok.split('=');
        return { id: id.trim(), label: raw === '∅' ? null : raw.replace(/␣/g, ' ') };
      }),
      salida: m[3].split(',').map((s) => s.trim()),
    });
  }
  return casos;
}

const CASOS = parseCasos(readFileSync(CONTRACT, 'utf8'));

function item(id: string, label: string | null): PreparationItemDTO {
  const currentLocation: LocationView = label === null ? { kind: 'unassigned' } : { kind: 'assigned', label };
  return {
    shipmentItemId: id,
    inventoryItemId: `inv-${id}`,
    folio: `INV-${id}`,
    quantity: 1,
    card: { name: 'X', setName: 'Y', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: null },
    currentLocation,
  };
}

const orden = (c: Caso) => sortPreparationItems(c.entrada.map((e) => item(e.id, e.label))).map((i) => i.shipmentItemId);

describe('§M4P-ORDER · orden por ubicación, aseverado contra el CONTRATO', () => {
  /*
   * Anti-vacuidad: si el ancla se moviera o el formato cambiara, `CASOS` quedaría vacío y todos los
   * `it.each` desaparecerían **en verde**. El contrato declara SIETE y exige que 3 y 4 existan.
   */
  it('el bloque del contrato se encuentra y trae los 7 casos (⛔ sin él, esta suite no mide nada)', () => {
    expect(CASOS).toHaveLength(7);
    expect(CASOS.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it.each(CASOS.map((c) => [c.n, c] as const))('caso %i', (_n, caso) => {
    expect(orden(caso)).toEqual(caso.salida);
  });

  /**
   * ⭐⭐ **EL CANARIO QUE EL CONTRATO DEJA A DEBER A QUIEN CABLEE.** §M4P-ORDER dice que los casos 3 y
   * 4 discriminan `localeCompare` de la comparación por unidades de código, pero marca esa
   * expectativa como **razonada, ⛔ NO MEDIDA**, y añade: *«un caso que no puede fallar es peor que
   * no tenerlo»*. Aquí se mide: con `localeCompare` esos dos casos **tienen que salir al revés**.
   */
  it('canario · los casos 3 y 4 SÍ discriminan: con `localeCompare` dan el orden contrario', () => {
    const conLocaleCompare = (c: Caso) =>
      c.entrada
        .slice()
        .sort((a, b) => {
          if (a.label === null && b.label === null) return 0;
          if (a.label === null) return 1;
          if (b.label === null) return -1;
          return a.label.localeCompare(b.label);
        })
        .map((e) => e.id);

    for (const n of [3, 4]) {
      const caso = CASOS.find((c) => c.n === n)!;
      expect(conLocaleCompare(caso), `el caso ${n} no discrimina nada`).not.toEqual(caso.salida);
    }
  });

  /**
   * **Guarda de residuo** (§M4P-ORDER punto 2, patrón `sell-request-states.spec.ts`): la regresión
   * aquí es alguien escribiendo **la línea obvia**. Se mide sobre el FUENTE, con los comentarios
   * despojados, para que la prosa que explica la prohibición no dispare el candado.
   */
  it('guarda de residuo · `localeCompare`/`Intl.Collator` no reaparecen en el comparador', () => {
    const fuente = readFileSync(join(process.cwd(), 'src', 'lib', 'preparation-order.ts'), 'utf8');
    const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(sinComentarios).toContain('sortPreparationItems');
    expect(sinComentarios).not.toMatch(/localeCompare|Intl\.Collator/);
  });
});
