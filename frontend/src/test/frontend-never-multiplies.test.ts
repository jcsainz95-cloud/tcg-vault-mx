import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analizarFuente, codigoDe, exigirQueConserveElCodigo } from './strip-comments';

/**
 * ⭐⭐⭐ **EL CANDADO DE LA REGLA QUE GOBIERNA TODO EL CORTE DEL IVA EN EL FRONT.**
 *
 * `API_CONTRACT §M10-IVA.3`, literal:
 *
 * > ⛔ **EL FRONTEND NUNCA MULTIPLICA.** `displayPriceCents` = la cifra que se pinta y la que se
 * > suma; **ya lleva el IVA dentro**.
 *
 * **Por qué se mide sobre el CÓDIGO FUENTE y no sobre un render**, que es la objeción razonable:
 * un IVA calculado en el cliente **no produce una pantalla rota**. Produce una pantalla que se ve
 * perfecta y cobra distinto de lo que el servidor cobra, en una fracción de los casos, por el
 * redondeo. *Un defecto que no se ve no se encuentra probando pantallas: se encuentra prohibiendo
 * la operación.*
 *
 * ⛔ Y se barre `src/` **entera**, no las pantallas de hoy: el riesgo es **la pantalla que alguien
 * escriba mañana**, con la mejor intención, para «completar» una cifra que le falta.
 */
describe('§M10-IVA.3 · ⛔ el frontend nunca multiplica', () => {
  const ROOT = join(process.cwd(), 'src');

  /**
   * ⭐ **Las únicas dos excepciones, y las dos están ARGUMENTADAS, no toleradas.**
   *
   * 1. **`src/lib/mock/fixtures.ts`** — *es el simulador del servidor*. Su trabajo es producir la
   *    cifra que el servidor produciría; clavarla sería el defecto del **criterio 196**. Su propio
   *    candado (`iva-inclusive-mock.test.ts`) la compara contra las tres filas del contrato.
   * 2. **`src/lib/api.ts`** — la réplica local del gross-up, que también es servidor falso. Misma
   *    razón y mismo candado.
   *
   * ⛔ **Ninguna pantalla está en esta lista, y ninguna debe entrar.** Añadir una ruta aquí es la
   * forma en que esta regla se pierde: quien lo haga tiene que escribir por qué, al lado.
   */
  const SIMULADORES_DEL_SERVIDOR = ['src/lib/mock/fixtures.ts', 'src/lib/api.ts'];

  /**
   * Las formas en que el IVA se cuela en un cliente. No es una lista de estilo: **cada patrón es una
   * manera concreta de reconstruir `P` o de deshacerlo**.
   */
  const PROHIBIDO: { patron: RegExp; porque: string }[] = [
    { patron: /[*/]\s*1\.16\b/, porque: 'multiplicar o dividir por 1.16 — el IVA al 16 % escrito a mano' },
    { patron: /\b1\.16\s*[*/]/, porque: 'el 1.16 como factor' },
    { patron: /ivaRatePct\s*\/\s*100/, porque: 'convertir la TASA en factor: el paso previo a aplicarla' },
    { patron: /1\s*\+\s*\w*[Ii]vaRate/, porque: 'construir (1 + r) para aplicarlo a un importe' },
    { patron: /\*\s*\(\s*1\s*\+/, porque: 'aplicar un factor (1 + algo) a un importe' },
    { patron: /ivaCents\s*[+-]\s*/, porque: 'sumar o restar el IVA a un importe de cliente' },
    { patron: /[+-]\s*\w*\.?ivaCents\b/, porque: 'usar el IVA como sumando: bajo IVA_INCLUSIVE no lo es' },
  ];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const abs = join(dir, name);
      return statSync(abs).isDirectory() ? walk(abs) : [abs];
    });
  }

  /**
   * Quita comentarios: una prohibición no puede saltar por su propia documentación.
   *
   * ### ⚠️ ESTE CANDADO ESTUVO CIEGO, y la ceguera se midió aquí (2026-09-14, sobre `0e22415`)
   *
   * Hasta hoy esta función era la v1 —`replace(bloque).replace(cola de línea)`— y **el orden la
   * cegaba**: un `//` que contuviera la secuencia de apertura de bloque abría un bloque que se
   * comía el fichero hasta el siguiente cierre. Medido sobre `src/` entera: **107 ficheros y ≥413
   * líneas de código que esta prohibición NO estaba mirando**, entre ellas la tabla de navegación
   * completa de `StorefrontHeader.tsx` (`:96-107`), cegada por el `/*` de
   * `(/buylist/requests/*)` en `:95`.
   *
   * ⚠️ *No se encontró ningún defecto escondido en esas 413 líneas* — lo que estaba roto era el
   * instrumento de la regla, no el producto. Pero un candado del que no se sabe qué mira no mide
   * nada: **`* 1.16` escrito en cualquiera de esas líneas habría pasado en verde.** El canario
   * (`strip-comments.test.ts`) lo demuestra inyectándolo en el fichero real.
   *
   * ⇒ Ahora delega en el limpiador único (`./strip-comments`), que además **comprueba por
   * contenido** que las N líneas de código del fichero siguen ahí antes de dejar mirar.
   */
  function soloCodigo(rel: string): string {
    return codigoDe(join(process.cwd(), rel), rel);
  }

  const ficheros = walk(ROOT)
    .filter((abs) => /\.(ts|tsx)$/.test(abs))
    .map((abs) => abs.slice(process.cwd().length + 1))
    // ⛔ Los tests SÍ pueden hacer la aritmética: es como se comprueba que la pantalla no la hace.
    .filter((rel) => !/\.test\.tsx?$/.test(rel))
    .filter((rel) => !SIMULADORES_DEL_SERVIDOR.includes(rel));

  it.each(PROHIBIDO)('⛔ ninguna pantalla hace: $porque', ({ patron }) => {
    const ofensores = ficheros.filter((rel) => patron.test(soloCodigo(rel)));
    expect(ofensores).toEqual([]);
  });

  /**
   * ⭐ **La mitad POSITIVA, y sin ella el candado de arriba es media medición:** prohibir la
   * aritmética no demuestra que el campo correcto se esté usando. Si mañana alguien retirara
   * `displayPriceCents` de las pantallas y volviera a pintar otra cosa, los siete patrones de arriba
   * seguirían verdes.
   */
  it('⭐ las superficies de venta consumen `displayPriceCents`, que es la cifra que se pinta', () => {
    const superficies = [
      'src/components/ui/PriceTag.tsx',
      'src/components/domain/ListingCard.tsx',
      'src/app/[locale]/(storefront)/catalog/CatalogTile.tsx',
      'src/app/[locale]/(storefront)/catalog/[cardId]/CardDetailView.tsx',
      'src/app/[locale]/(storefront)/_home/FeaturedCarousel.tsx',
      'src/app/[locale]/(storefront)/_home/GradedShelf.tsx',
    ];
    for (const rel of superficies) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, rel).toMatch(/displayPriceCents/);
    }
  });

  /**
   * ⭐⭐ **`salePriceCents` DESAPARECIÓ de la superficie pública, y eso se mide POR AUSENCIA.**
   *
   * §M10-IVA.3: *«`salePriceCents` NO se reinterpreta: DESAPARECE … un front que no migró no
   * compila»*. El compilador ya lo sostiene para el tipo, pero **no** para un `Record<string,
   * unknown>` ni para una pantalla nueva que lo declare por su cuenta.
   *
   * ⭐ En `/admin/*` **sigue siendo legítimo** (`PROJECT §Q.5`: *«el admin ve base, IVA, neto,
   * exhibido y dial»*), así que el barrido excluye el back-office **a propósito y con su razón**.
   */
  it('⛔ ninguna superficie de CLIENTE nombra ya `salePriceCents`', () => {
    /*
     * ⚠️⚠️ **LA ÚNICA EXCEPCIÓN, Y ES UN HUECO DEL CONTRATO — NO UNA CONCESIÓN.**
     *
     * `CellDrawer` pinta el CTA «Comprar MX$X» del binder a partir de
     * `MasterSetVariantDTO.buyable.salePriceCents`. Ese DTO es **superficie de cliente** —el propio
     * contrato lo dice: *«`buyable` SOLO scope cliente (iii)»*— pero **NO aparece en la tabla de
     * §M10-IVA.3**, que enumera seis DTOs y se deja éste.
     *
     * El **importe** ya es el correcto (`P`, para que el cajón del binder no sea la única superficie
     * de la tienda mostrando la base limpia); lo que sigue mal es **el nombre del campo**, y ese
     * nombre es del arquitecto. ⛔ `API_CONTRACT.md` no lo escribe el frontend.
     *
     * ⭐ **Se lista aquí EXPRESAMENTE, y con `toEqual`, para que el hueco no se olvide**: si aparece
     * un segundo ofensor, esto se pone rojo; y cuando el arquitecto renombre el campo, esta línea
     * se cae sola y hay que borrarla. *Una excepción silenciosa se vuelve la regla; una excepción
     * que hay que mantener a mano se paga cada vez que alguien la lee.*
     *
     * ⇒ **SOLICITUD AL ARQUITECTO**, registrada en `docs/FRONTEND_NOTES.md`:
     * `MasterSetVariantDTO.buyable.salePriceCents` → `displayPriceCents` (+ `ivaIncluded`,
     * `ivaRatePct`), igual que las otras seis filas de §M10-IVA.3.
     */
    const HUECO_DE_CONTRATO = ['src/components/master-set/CellDrawer.tsx'];
    const ofensores = ficheros
      .filter((rel) => rel.startsWith('src/app/[locale]/(storefront)/') || rel.startsWith('src/components/'))
      .filter((rel) => /salePriceCents/.test(soloCodigo(rel)));
    expect(ofensores).toEqual(HUECO_DE_CONTRATO);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⭐⭐⭐ **EL CANARIO DEL CANDADO DE ARRIBA — «un candado sin canario no está demostrado».**
 *
 * No se inventa un caso: se usa **el fichero real** y **la ventana real** que el limpiador v1
 * borraba (`StorefrontHeader.tsx:96-107`, cegada por el `/*` que lleva el comentario de `:95`), se
 * le mete dentro **el defecto que esta regla prohíbe** —multiplicar por 1.16— y se exige que el
 * candado lo vea.
 *
 * La comparación contra el v1 es la mitad que enseña: con el limpiador viejo **ese mismo defecto,
 * en ese mismo fichero, pasaba en VERDE**.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
/**
 * Los defectos que se reintroducen. Son **los patrones reales del candado**, no una muestra: cada
 * uno es una forma concreta de reconstruir `P` en el cliente.
 */
const PATRONES_DEL_CANARIO = [
  { defecto: '* 1.16', patron: /[*/]\s*1\.16\b/ },
  { defecto: '/ 1.16', patron: /[*/]\s*1\.16\b/ },
  { defecto: '* (1 + r)', patron: /\*\s*\(\s*1\s*\+/ },
  { defecto: '+ line.ivaCents', patron: /[+-]\s*\w*\.?ivaCents\b/ },
];

describe('§M10-IVA.3 · canario: el candado VE el código que el limpiador v1 borraba', () => {
  const CABECERA = 'src/components/layout/StorefrontHeader.tsx';
  const fuente = readFileSync(join(process.cwd(), CABECERA), 'utf8');

  /** El limpiador retirado, palabra por palabra, para poder medir contra él. */
  const v1 = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Mete una línea en el fichero real, justo dentro de la ventana que el v1 se comía. */
  function inyectarEnLa(linea: number, texto: string): string {
    const l = fuente.split('\n');
    l.splice(linea - 1, 0, texto);
    return l.join('\n');
  }

  it('⭐ el v1 NO veía la ventana 95-109: 12 líneas de código real fuera del alcance', () => {
    const limpio = v1(fuente);
    const { lineasConCodigo } = analizarFuente(fuente, CABECERA);
    const enLaVentana = lineasConCodigo.filter((n) => n >= 95 && n <= 109);
    /*
     * ⚠️ El v1 **no conserva la numeración** (220 líneas → 184), así que la pérdida no se puede
     * medir por índice: se mide por CONTENIDO, comprobando que la línea ya no existe como línea
     * en su salida.
     *
     * ⭐ **El número exacto, y por qué NO es 13:** en la ventana hay **13** líneas con código y el
     * v1 se las come **todas**; pero una de ellas (`:106`, `return (`) es texto que aparece
     * **igual en otro sitio** del fichero, así que por contenido solo se pueden DEMOSTRAR 12.
     * Se afirma lo demostrable.
     */
    const supervivientes = new Set(limpio.split('\n').map((l) => l.trim()));
    const perdidas = enLaVentana.filter((n) => !supervivientes.has(fuente.split('\n')[n - 1].trim()));
    expect(enLaVentana.length, 'líneas con código en la ventana').toBe(13);
    expect(perdidas.length, `el v1 borraba: ${perdidas.join(',')}`).toBe(12);
    expect(limpio.split('\n').length).toBeLessThan(fuente.split('\n').length);
    // Y lo que borraba era la navegación entera de la tienda, no adorno.
    expect(limpio).not.toContain("href: '/vault'");
    expect(limpio).not.toContain('<header ref={headerRef}');
  });

  it('⭐⭐ el limpiador nuevo SÍ ve esa ventana entera — la demostración del arreglo', () => {
    const { limpio, lineasConCodigo } = analizarFuente(fuente, CABECERA);
    const enLaVentana = lineasConCodigo.filter((n) => n >= 95 && n <= 109);
    expect(enLaVentana.length).toBe(13);
    for (const n of enLaVentana) {
      expect(limpio.split('\n')[n - 1].trim(), `${CABECERA}:${n}`).not.toBe('');
    }
    expect(limpio).toContain("href: '/vault'");
    expect(limpio).toContain('<header ref={headerRef}');
    // Y la numeración se conserva: un `:N` del candado sigue señalando la línea del fichero.
    expect(limpio.split('\n')).toHaveLength(fuente.split('\n').length);
  });

  it.each(PATRONES_DEL_CANARIO)(
    '⛔ con el limpiador NUEVO, `$defecto` inyectado en la ventana ciega se ve; con el v1 pasaba en verde',
    ({ defecto, patron }) => {
      // ⚠️ Se inyecta como ELEMENTO del array donde cae, no como sentencia suelta: un fichero que
      //    no parsea mediría el error de sintaxis, no el candado.
      const mutado = inyectarEnLa(100, `          { href: '/x', label: String(base ${defecto}) },`);
      // ROJO exigido: el candado de hoy lo caza.
      expect(patron.test(analizarFuente(mutado, CABECERA).limpio)).toBe(true);
      // Y la mitad que duele: el candado de ayer, NO.
      expect(patron.test(v1(mutado))).toBe(false);
    },
  );

  it('⛔ y el candado sigue sin castigar la PROSA: el mismo defecto en un comentario no cuenta', () => {
    const mutado = inyectarEnLa(100, '          // ejemplo para quien lea: base * 1.16 sería el defecto');
    expect(/[*/]\s*1\.16\b/.test(analizarFuente(mutado, CABECERA).limpio)).toBe(false);
  });

  it('⭐ el control POR CONTENIDO muerde el caso PARCIAL, no solo el fichero vacío', () => {
    // (a) el caso que el autor anterior blindó: vaciado TOTAL.
    expect(() => exigirQueConserveElCodigo(fuente, '', CABECERA)).toThrow(/se quedó ciego/i);
    // (b) ⭐ el que ocurre de verdad: PARCIAL. El v1 deja doscientas líneas y se come doce —
    //     `expect(src).toMatch(/export (function|const)/)` habría pasado tan campante.
    expect(() => exigirQueConserveElCodigo(fuente, v1(fuente), CABECERA)).toThrow(
      /se quedó ciego[\s\S]*StorefrontHeader/i,
    );
    // (c) y no grita con la salida buena.
    expect(() =>
      exigirQueConserveElCodigo(fuente, analizarFuente(fuente, CABECERA).limpio, CABECERA),
    ).not.toThrow();
  });
});
