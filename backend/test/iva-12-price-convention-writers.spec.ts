import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  ConventionSite,
  censoDeConvencion,
  clasificarConvencion,
} from './helpers/price-convention-writers';

/**
 * ⭐⭐ **`IVA-12` — EL CANDADO DE «UN SOLO DESPLIEGUE», ESCRITO POR LO NEGATIVO.**
 * (v1.74 / **D56**; `API_CONTRACT §M10-IVA.9.d`, `ARCHITECTURE §4.55`, criterio **214**.)
 *
 * **Lo que el contrato pide, literal:** *«tras el despliegue **ningún camino escribe
 * `IVA_EXCLUSIVE`**; `rg "IVA_EXCLUSIVE" backend/src` no devuelve ningún ESCRITOR, solo el lector
 * (el `switch` de `money.ts`) y fixtures/pruebas. **Rojo en cuanto reaparezca un escritor, aunque
 * ese día los números cuadren.**»*
 *
 * ## ⭐⭐ ESTADO MEDIDO HOY (2026-09-14, el corte D56 completo) — **`IVA-12` CERRADO**
 *
 * **El censo da CERO escritores de `IVA_EXCLUSIVE`.** Los cinco que había —`orders` ×3
 * (`guest-checkout` incluido), `payments` ×1, `shipments` ×1— **se convirtieron**, y se convirtieron
 * **junto con el bloque entero**, no cambiando un literal:
 *
 *  1. La **derivación de `P`** existe (`money.displayPriceCentsOf`, cableada en
 *     `catalog.toListingRow` y en `orders.derivedSaleDecision`) ⇒ `subtotalCents` **lleva el IVA
 *     dentro**, así que la etiqueta `IVA_INCLUSIVE` **es verdadera** sobre esas filas.
 *  2. Los cinco escriben ahora **`PRICE_CONVENTION_OF_NEW_ROWS`**, una sola constante, en vez de
 *     cinco literales. ⛔ La columna **sigue sin `DEFAULT` de BD**: un camino que olvide estamparla
 *     sigue reventando con violación de `NOT NULL` (`IVA-3(e)`).
 *
 * ⚠️⚠️ **POR QUÉ ESTO NO SE PODÍA HACER ANTES, y queda escrito porque es la lección:** cambiar el
 * literal **sin** la derivación habría hecho que `netRevenueCents()` restara un IVA **que nunca
 * estuvo dentro** — `8400` donde el criterio **191** exige `10000`. El P&L **no habría reventado:
 * habría MENTIDO.** *Una columna de convención no cambia el dinero: DESCRIBE el dinero. Mover al
 * testigo no mueve el hecho.*
 *
 * ⇒ **El TRINQUETE se queda, y ahora en su posición final: `{}`.** Sigue midiendo las tres
 * direcciones —un escritor nuevo, uno de más en un fichero, una forma sin clasificar— y sigue siendo
 * el único sitio por el que se puede reabrir `IVA_EXCLUSIVE` como escritura.
 */

const BASE = join(__dirname, '..');
const SRC = join(BASE, 'src');

/**
 * ⭐⭐ **EL TRINQUETE: los escritores de `IVA_EXCLUSIVE` que quedan vivos, por FICHERO.**
 *
 * ⚠️ **Por fichero y no por `fichero:línea` a propósito.** Los números de línea se mueven con
 * cualquier edición ajena del mismo fichero (medido en este pase: `shipments.service.ts` pasó de
 * `:236` a `:247` mientras otro trabajo tocaba ese fichero). Un trinquete que se pone rojo porque
 * alguien añadió un comentario **enseña a actualizar la lista sin mirar**, que es justo lo que un
 * trinquete no puede permitirse.
 *
 * ⛔ **Esta tabla NO se actualiza para «arreglar el rojo».** Sólo bajaba cuando un escritor se
 * convertía de verdad —es decir, con la derivación de `P` ya cableada y la fila naciendo con el IVA
 * dentro—, y **ya llegó a `{}`**. ⛔ A partir de aquí **solo puede subir por un defecto**: cualquier
 * entrada nueva significa que una fila volvió a nacer bajo la convención vieja.
 */
const ESCRITORES_PENDIENTES: Readonly<Record<string, number>> = {};

function porFichero(sitios: readonly ConventionSite[], kind: ConventionSite['kind']) {
  const m: Record<string, number> = {};
  for (const s of sitios) if (s.kind === kind) m[s.file] = (m[s.file] ?? 0) + 1;
  return m;
}

describe('⭐⭐ `IVA-12(b)` — el censo de ESCRITORES de `IVA_EXCLUSIVE` en `backend/src`', () => {
  const censo = censoDeConvencion(SRC, BASE);

  it('⛔ NINGÚN escritor fuera del trinquete, y ninguno de más dentro de él', () => {
    // Rojo si aparece un fichero nuevo, si uno listado gana un escritor, o si pierde uno sin que
    // esta tabla baje. Las tres direcciones importan: la primera es la regresión, la tercera es lo
    // que impide que `IVA-12` se dé por cerrado sin que nadie lo escriba.
    expect(porFichero(censo, 'writer')).toEqual(ESCRITORES_PENDIENTES);
  });

  it('⛔ y ninguna aparición SIN CLASIFICAR: una forma nueva de escribir la convención es roja', () => {
    // *Si aparece una forma nueva —un `const C = "IVA_EXCLUSIVE"` y luego `priceConvention: C`—,
    // que la clasifique un humano y la escriba aquí, no que pase en silencio.*
    expect(censo.filter((s) => s.kind === 'unclassified')).toEqual([]);
  });

  it('⭐ `IVA-3` sigue mordiendo: el LECTOR conserva la rama `IVA_EXCLUSIVE` y el `default` LANZA', () => {
    // *`IVA-12` dice «lo nuevo nace bien»; `IVA-3` dice «lo viejo no se reinterpreta». Son dos
    // candados y hacen falta los dos.* Una fila ya cobrada tiene que seguir rindiendo lo mismo al
    // centavo, así que la rama del lector ⛔ NO se borra al cerrar `IVA-12`.
    //
    // ⭐⭐ **UNO, y sigue siendo uno.** `IVA-12(b)` nombra al lector en SINGULAR: *«solo el lector
    // (el `switch` de `money.ts`)»*. D56 podría haber metido tres switches más —el neto de
    // mercancía, el del envío, el del desglose— y el censo habría subido a cuatro. En vez de eso, el
    // switch vive en **`ivaIsIncluded`** y los demás **delegan**. *Cuatro sitios donde interpretar la
    // misma fila son cuatro sitios donde pueden interpretarla distinto.*
    expect(porFichero(censo, 'reader')).toEqual({ 'src/common/money.ts': 1 });

    const money = readFileSync(join(SRC, 'common', 'money.ts'), 'utf8');
    const i = money.indexOf('export function ivaIsIncluded(');
    expect(i).toBeGreaterThan(-1);
    // ⚠️ `'\n}\n'` y no `'\n}'`: lo segundo corta en el `}` del OBJETO DE PARÁMETROS —`}): number {`—
    // y deja fuera el `switch` entero, o sea un recorte que no contiene lo que se quiere medir.
    const cuerpo = money.slice(i, money.indexOf('\n}\n', i));
    expect(cuerpo).toContain("case 'IVA_EXCLUSIVE':");
    expect(cuerpo).toContain("case 'IVA_INCLUSIVE':");
    // ⛔ El `default` LANZA, y eso es la funcionalidad: un `?? false` o un `: 'IVA_EXCLUSIVE'` de
    // cortesía haría que una fila sin convención se interprete en silencio.
    expect(cuerpo).toMatch(/default:\s*\n?\s*throw new Error\(/);

    // ⭐ Y `netRevenueCents` ⛔ NO tiene switch propio: delega en el lector único.
    const j = money.indexOf('export function netRevenueCents(');
    expect(j).toBeGreaterThan(-1);
    const cuerpoNeto = money.slice(j, money.indexOf('\n}\n', j));
    expect(cuerpoNeto).toContain('ivaIsIncluded(row.priceConvention)');
    expect(cuerpoNeto).not.toContain('switch (');
  });

  it('⭐⭐ `IVA-12` está CERRADO: la tabla está VACÍA y los cinco escritores se convirtieron', () => {
    // Este `it` era el marcador de estado y **cambió de bando**, que es para lo que se escribió.
    // ⛔ Sigue siendo el único sitio por el que `IVA_EXCLUSIVE` puede volver a ser una escritura.
    const pendientes = Object.values(ESCRITORES_PENDIENTES).reduce((a, b) => a + b, 0);
    expect(pendientes).toBe(0);
    expect(ESCRITORES_PENDIENTES).toEqual({});
  });

  it('⭐⭐ y los CINCO escriben la MISMA constante, no cinco literales', () => {
    // `ARCHITECTURE §4.35a` documenta lo que cuesta que una decisión de dinero viva copiada en cinco
    // sitios (este proyecto ya pagó una). Aquí se asierta por el lado del código: los cinco caminos
    // de escritura nombran `PRICE_CONVENTION_OF_NEW_ROWS`.
    const escritores = [
      'src/modules/orders/orders.service.ts',
      'src/modules/orders/guest-checkout.service.ts',
      'src/modules/payments/payments.service.ts',
      'src/modules/shipments/shipments.service.ts',
    ];
    for (const f of escritores) {
      const src = readFileSync(join(BASE, f), 'utf8');
      expect(src).toContain('priceConvention: PRICE_CONVENTION_OF_NEW_ROWS');
      // ⛔ Y ninguno vuelve a clavar el literal nuevo a mano, que sería el mismo defecto con el
      // otro valor: cinco copias de `'IVA_INCLUSIVE'` esperando a que una se quede atrás.
      expect(src).not.toMatch(/priceConvention:\s*'IVA_INCLUSIVE'/);
    }
    // Y la constante vale lo que dice el criterio 214.
    const money = readFileSync(join(SRC, 'common', 'money.ts'), 'utf8');
    expect(money).toMatch(/PRICE_CONVENTION_OF_NEW_ROWS: PriceConvention = 'IVA_INCLUSIVE'/);
  });
});

/**
 * ⭐⭐ **EL CANARIO — reintroduce cada defecto sobre fuente sintética y exige el rojo.**
 * *Un candado sin canario no es un candado: es una esperanza.* Y este canario existe además porque
 * el instrumento **no es un parser**: lo que sostiene su alcance es esto, no su docstring.
 */
describe('⭐ canario de `IVA-12`: el instrumento MUERDE, y no es ciego', () => {
  it('m1 — un ESCRITOR nuevo en un fichero nuevo se ve (y rompería el trinquete)', () => {
    const sitios = clasificarConvencion(
      `await tx.order.create({ data: { totalCents: 1, priceConvention: 'IVA_EXCLUSIVE' } });`,
      'src/modules/nuevo/nuevo.service.ts',
    );
    expect(sitios.map((s) => s.kind)).toEqual(['writer']);
    // ⭐ Con el trinquete ya en `{}`, esta comparación es la que muerde: **cualquier** escritor
    // nuevo deja de cuadrar con el censo vacío.
    expect(porFichero(sitios, 'writer')).not.toEqual(ESCRITORES_PENDIENTES);
    expect(porFichero(sitios, 'writer')).toEqual({ 'src/modules/nuevo/nuevo.service.ts': 1 });
  });

  it('m2 — un escritor con `=` (variable) también es escritor', () => {
    const sitios = clasificarConvencion(
      `const priceConvention = 'IVA_EXCLUSIVE';`,
      'src/x.ts',
    );
    expect(sitios.map((s) => s.kind)).toEqual(['writer']);
  });

  it('m3 — un escritor partido en DOS líneas por el formateador se sigue viendo', () => {
    const sitios = clasificarConvencion(
      `data: {\n  priceConvention:\n    'IVA_EXCLUSIVE',\n}`,
      'src/x.ts',
    );
    expect(sitios.map((s) => s.kind)).toEqual(['writer']);
  });

  it('⭐⭐ m4 — el LECTOR NO se cuenta como escritor (si no, `IVA-3` y `IVA-12` se pelearían)', () => {
    const sitios = clasificarConvencion(
      `switch (row.priceConvention) {\n  case 'IVA_EXCLUSIVE':\n    return row.subtotalCents;\n}`,
      'src/common/money.ts',
    );
    expect(sitios.map((s) => s.kind)).toEqual(['reader']);
  });

  it('⭐⭐ m5 — un escritor COMENTADO ⛔ NO cuenta: un eje fantasma enseña a apagar el candado', () => {
    // El escáner mira CÓDIGO. Si mirara texto, la prosa de `money.ts` y de `admin.service.ts`
    // —que explican la convención— saldría como cinco escritores inventados, y el rojo por un
    // escritor **que no existe** es el que entrena a desactivar el candado.
    const sitios = clasificarConvencion(
      `// priceConvention: 'IVA_EXCLUSIVE',\n/* y aquí: priceConvention: 'IVA_EXCLUSIVE' */\nconst x = 1;`,
      'src/x.ts',
    );
    expect(sitios).toEqual([]);
  });

  it('⭐ m6 — una forma DESCONOCIDA sale `unclassified`, que también es rojo', () => {
    const sitios = clasificarConvencion(
      `const C = 'IVA_EXCLUSIVE';\nawait tx.order.create({ data: { priceConvention: C } });`,
      'src/x.ts',
    );
    expect(sitios.map((s) => s.kind)).toEqual(['unclassified']);
  });

  it('⭐⭐ m8 — DOS escritores en la MISMA línea cuentan DOS (la mutación que mató a la v1 del escáner)', () => {
    // **Medido, no supuesto.** La primera versión de este instrumento clasificaba LÍNEA a línea, y la
    // batería de mutación plantó un segundo escritor pegado a uno ya censado: el trinquete salió
    // **VERDE**. *Un candado que cuenta líneas mide el formateador, no el código.*
    const sitios = clasificarConvencion(
      `data: { priceConvention: 'IVA_EXCLUSIVE', otro: (() => { const priceConvention = 'IVA_EXCLUSIVE'; return priceConvention; })() }`,
      'src/modules/payments/payments.service.ts',
    );
    expect(sitios.map((s) => s.kind)).toEqual(['writer', 'writer']);
    expect(porFichero(sitios, 'writer')).toEqual({ 'src/modules/payments/payments.service.ts': 2 });
    // Y por tanto NO cuadra con el trinquete, que ya no censa NINGUNO en ese fichero ⇒ rojo.
    expect(ESCRITORES_PENDIENTES['src/modules/payments/payments.service.ts']).toBeUndefined();
  });

  it('m7 — el censo real NO es vacío: si el escáner se rompiera, el trinquete quedaría verde por ceguera', () => {
    // La mutación realista sobre el instrumento es que deje de encontrar nada (un `walkTs` que no
    // recorre, un patrón que no casa). Ese fallo daría VERDE al trinquete, que es el peor de los
    // verdes. Aquí se afirma que el censo real tiene contenido y de las dos clases.
    // ⚠️ **D56 cambió lo que este canario puede afirmar, y se dice en vez de aflojarlo.** Ya no hay
    // escritores en el árbol —ése es el punto de `IVA-12`—, así que «el censo real no es vacío» se
    // sostiene ahora sobre el LECTOR. La ceguera del instrumento se sigue matando: si `walkTs` no
    // recorriera, el lector tampoco aparecería y esto se pondría rojo.
    const censo = censoDeConvencion(SRC, BASE);
    expect(censo.some((s) => s.kind === 'reader')).toBe(true);
    expect(censo.filter((s) => s.kind === 'reader')).toHaveLength(1);
    // ⛔ Y ningún escritor: es la afirmación central de `IVA-12(b)`, dicha también aquí.
    expect(censo.filter((s) => s.kind === 'writer')).toEqual([]);
  });

  it('⭐⭐ m9 — el censo ⛔ NO mira los `.spec.ts` de `src/`, y el contrato lo dice', () => {
    // `IVA-12(b)`: *«solo el lector … y **fixtures/pruebas**»*. Un fixture que siembra una orden
    // histórica `IVA_EXCLUSIVE` —para probar que `IVA-3` la renderiza igual— tiene que llevar el
    // literal. **Medido:** `src/modules/orders/img-order-item-card.spec.ts` tiene escritores y el
    // censo real es `{}` ⇒ la exclusión está viva. Y es segura porque `tsconfig.build.json` excluye
    // `*.spec.ts`: no llegan a `dist/`, o sea no existen en el binario que sirve dinero.
    const fixture = join(SRC, 'modules', 'orders', 'img-order-item-card.spec.ts');
    const enFixture = clasificarConvencion(readFileSync(fixture, 'utf8'), 'x.spec.ts');
    expect(enFixture.filter((s) => s.kind === 'writer').length).toBeGreaterThan(0);
    expect(porFichero(censoDeConvencion(SRC, BASE), 'writer')).toEqual({});

    // ⭐ Y la exclusión NO se hereda al código de producción: el MISMO texto en un `.ts` normal sí
    // se censa. *Si el filtro se ensanchara a todo `.ts`, esta mitad se pondría roja.*
    const enProduccion = clasificarConvencion(
      `data: { priceConvention: 'IVA_EXCLUSIVE' }`,
      'src/modules/orders/orders.service.ts',
    );
    expect(enProduccion.map((s) => s.kind)).toEqual(['writer']);
  });
});
