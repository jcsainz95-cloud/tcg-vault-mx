import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codigoDe } from '@/test/strip-comments';
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
        /*
         * ⚠️ **`indexOf` y ⛔ no `split('=')` desestructurado** (M-QA2, QA): con `split` una etiqueta
         * que contuviera `=` se truncaría en el primer signo — y **solo en este lado**, porque el
         * parser de backend ya usa `indexOf`. Dos lectores del mismo bloque que lo leen distinto es
         * la clase de divergencia que §M4P-ORDER existe para cerrar. Hoy ninguna etiqueta lleva `=`;
         * el arreglo es una línea y quita la asimetría antes de que importe.
         */
        const corte = tok.indexOf('=');
        const id = tok.slice(0, corte).trim();
        const raw = tok.slice(corte + 1);
        return { id, label: raw === '∅' ? null : raw.replace(/␣/g, ' ') };
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

    /*
     * ⭐ **M-QA3 (QA) — la anti-vacuidad tiene que cubrir el DATO, no solo la CUENTA.** El caso 7
     * existe para morder a quien meta un `trim()`, y todo su poder está en el **espacio literal**
     * (`␣` en el contrato). Contar siete casos no lo protege: si un re-formato del documento se
     * comiera ese carácter, el caso 7 **seguiría estando** y **dejaría de morder, en verde**. El
     * parser de backend ya lo exige; aquí faltaba. *Una anti-vacuidad que solo cuenta filas no ve
     * una fila vaciada.*
     */
    const caso7 = CASOS.find((c) => c.n === 7)!;
    expect(
      caso7.entrada.some((e) => e.label?.startsWith(' ')),
      'el caso 7 perdió su espacio literal y ya no puede morder a un `trim()`',
    ).toBe(true);
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
    /*
     * ⚠️⚠️ **Aquí había una reimplementación A MANO del limpiador v1, y es una clase que este repo
     * ya erradicó** (§77 de mis propias notas: **107 ficheros y ≥413 líneas** que un candado no
     * miraba). `strip-comments.ts:11` cita ese literal **verbatim** como el defecto que existe para
     * reemplazar — y mi copia era **peor que la v1 canónica**, porque le faltaba el guard
     * `(^|[^:])` y se comía todo lo que siguiera a un `//` dentro de una cadena.
     *
     * **El modo de fallo no es rojo, es CEGUERA PARCIAL CON VERDE:** un `not.toMatch` pasa **por
     * vacuidad** si el limpiador se come la región, y mi único control era un ancla **de fichero**
     * (`toContain('sortPreparationItems')`, que es la firma exportada y sobrevive a que se borre
     * todo el cuerpo). *(QA intentó cegarla con un bloque fantasma y **no lo consiguió** —siguió
     * mordiendo, 3 rojas—, así que no era un hueco demostrado. Se cambia igual: la clase está
     * cerrada y yo abrí una instancia nueva.)*
     *
     * Ahora: el limpiador **canónico** —que le pregunta al escáner de TypeScript qué es trivia, ⛔ no
     * una heurística nuestra, y que trae su propio control de no-ceguera— y un ancla **DENTRO del
     * cuerpo**, ⛔ no la firma.
     */
    const codigo = codigoDe(join(process.cwd(), 'src', 'lib', 'preparation-order.ts'));

    // Ancla de REGIÓN: estas tres líneas viven dentro del comparador. Si el limpiador se comiera el
    // cuerpo, esto se pone rojo en vez de pasar en vacío.
    expect(codigo).toContain('locationSortKey(a.currentLocation)');
    expect(codigo).toContain('if (ka < kb) return -1;');
    expect(codigo).toContain('if (kb === null) return -1;');

    /*
     * **M-QA1 (QA) — simetría con la guarda de backend: cota de líneas VIVAS.** `codigoDe` ya trae su
     * propio control de no-ceguera, así que esto es cinturón sobre tirantes; entra igual porque es
     * una línea y porque la asimetría entre las dos guardas era justo lo que QA no podía explicar.
     */
    expect(codigo.split('\n').filter((l) => l.trim() !== '').length).toBeGreaterThan(20);

    expect(codigo).not.toMatch(/localeCompare|Intl\.Collator/);
  });
});
