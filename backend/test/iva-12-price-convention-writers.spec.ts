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
 * ## ⚠️⚠️ ESTADO MEDIDO HOY (2026-09-14, sobre `HEAD = fc2295f` + este pase) — LÉELO ANTES DE CREER EL VERDE
 *
 * **El censo da CINCO escritores vivos.** No están corregidos en este pase, y **no es un descuido**:
 *
 *  1. **Están fuera de este módulo.** Viven en `modules/orders` (×3, `guest-checkout` incluido),
 *     `modules/payments` (×1) y `modules/shipments` (×1). Este pase tiene alcance
 *     `modules/settings` + `test/`.
 *  2. ⛔⛔ **Y, sobre todo, cambiar el literal NO ES la conversión: sería un DEFECTO DE DINERO.**
 *     Medido: `rg "displayPriceCents" backend/src` ⇒ **0**. La derivación de `P` (§M10-IVA.3/.4) **no
 *     existe todavía**, así que hoy `subtotalCents` **no lleva el IVA dentro**. Etiquetar esa misma
 *     fila como `IVA_INCLUSIVE` haría que `netRevenueCents()` devolviera `subtotal − iva` = **8400**
 *     donde el criterio **191** exige **10000**: el P&L **no reventaría, MENTIRÍA**, y `IVA-1`
 *     quedaría en rojo. *Un reporte que revienta se arregla; uno que miente se cree.*
 *
 * ⇒ **Lo que este fichero hace hoy es lo único honesto que puede hacer: un TRINQUETE.** El censo
 * está **fijado por fichero y por cuenta**, así que:
 *  - un escritor **NUEVO** (fichero nuevo, o uno más en un fichero ya listado) ⇒ **ROJO**;
 *  - un escritor que **desaparece** ⇒ **ROJO** hasta que se baje la cuenta aquí, que es lo que
 *    obliga a que el cierre de `IVA-12` pase por este fichero y no ocurra «sin querer»;
 *  - **`IVA-12` sólo está CERRADO cuando `ESCRITORES_PENDIENTES` es `{}`**, y eso lo dice el último
 *    `it` de este bloque, no un comentario.
 *
 * *Un candado que exime lo que hoy incumple y no lo dice se convierte en una lista blanca. Éste lo
 * dice, cuenta las piezas, y no deja que crezcan.*
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
 * ⛔ **Esta tabla NO se actualiza para «arreglar el rojo».** Sólo baja cuando un escritor se
 * convierte de verdad —es decir, cuando la derivación de `P` (§M10-IVA.3/.4) ya esté y la fila nazca
 * con el IVA dentro—, y sólo puede llegar a `{}`.
 */
const ESCRITORES_PENDIENTES: Readonly<Record<string, number>> = {
  'src/modules/orders/guest-checkout.service.ts': 1,
  'src/modules/orders/orders.service.ts': 2,
  'src/modules/payments/payments.service.ts': 1,
  'src/modules/shipments/shipments.service.ts': 1,
};

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
    expect(porFichero(censo, 'reader')).toEqual({ 'src/common/money.ts': 1 });

    const money = readFileSync(join(SRC, 'common', 'money.ts'), 'utf8');
    const i = money.indexOf('export function netRevenueCents(');
    expect(i).toBeGreaterThan(-1);
    // ⚠️ `'\n}\n'` y no `'\n}'`: lo segundo corta en el `}` del OBJETO DE PARÁMETROS —`}): number {`—
    // y deja fuera el `switch` entero, o sea un recorte que no contiene lo que se quiere medir.
    const cuerpo = money.slice(i, money.indexOf('\n}\n', i));
    expect(cuerpo).toContain("case 'IVA_EXCLUSIVE':");
    expect(cuerpo).toContain("case 'IVA_INCLUSIVE':");
    // ⛔ El `default` LANZA, y eso es la funcionalidad: un `?? row.subtotalCents` o un
    // `: 'IVA_EXCLUSIVE'` de cortesía haría que una fila sin convención se interprete en silencio.
    expect(cuerpo).toMatch(/default:\s*\n?\s*throw new Error\(/);
  });

  it('⭐⭐ `IVA-12` estará CERRADO cuando esta tabla esté VACÍA — y hoy NO lo está', () => {
    // Este `it` es el marcador de estado, y está escrito para que **cambie de bando solo**: el día
    // que la conversión aterrice y `ESCRITORES_PENDIENTES` quede en `{}`, la primera aserción se
    // cae y quien la arregle tiene que borrar la segunda a mano. ⛔ No hay forma de cerrar `IVA-12`
    // sin pasar por aquí, que es el punto.
    const pendientes = Object.values(ESCRITORES_PENDIENTES).reduce((a, b) => a + b, 0);
    expect(pendientes).toBe(5);
    expect(pendientes).toBeLessThanOrEqual(5); // ⛔ TRINQUETE: nunca sube. Sólo baja, y sólo a 0.
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
    expect(porFichero(sitios, 'writer')).not.toEqual(ESCRITORES_PENDIENTES);
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
    // Y por tanto NO cuadra con el trinquete, que censa UNO en ese fichero ⇒ rojo.
    expect(porFichero(sitios, 'writer')['src/modules/payments/payments.service.ts']).not.toBe(
      ESCRITORES_PENDIENTES['src/modules/payments/payments.service.ts'],
    );
  });

  it('m7 — el censo real NO es vacío: si el escáner se rompiera, el trinquete quedaría verde por ceguera', () => {
    // La mutación realista sobre el instrumento es que deje de encontrar nada (un `walkTs` que no
    // recorre, un patrón que no casa). Ese fallo daría VERDE al trinquete, que es el peor de los
    // verdes. Aquí se afirma que el censo real tiene contenido y de las dos clases.
    const censo = censoDeConvencion(SRC, BASE);
    expect(censo.length).toBeGreaterThanOrEqual(6);
    expect(censo.some((s) => s.kind === 'writer')).toBe(true);
    expect(censo.some((s) => s.kind === 'reader')).toBe(true);
  });
});
