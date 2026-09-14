import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

  /** Quita comentarios: una prohibición no puede saltar por su propia documentación. */
  function soloCodigo(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  const ficheros = walk(ROOT)
    .filter((abs) => /\.(ts|tsx)$/.test(abs))
    .map((abs) => abs.slice(process.cwd().length + 1))
    // ⛔ Los tests SÍ pueden hacer la aritmética: es como se comprueba que la pantalla no la hace.
    .filter((rel) => !/\.test\.tsx?$/.test(rel))
    .filter((rel) => !SIMULADORES_DEL_SERVIDOR.includes(rel));

  it.each(PROHIBIDO)('⛔ ninguna pantalla hace: $porque', ({ patron }) => {
    const ofensores = ficheros.filter((rel) =>
      patron.test(soloCodigo(readFileSync(join(process.cwd(), rel), 'utf8'))),
    );
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
      .filter((rel) => /salePriceCents/.test(soloCodigo(readFileSync(join(process.cwd(), rel), 'utf8'))));
    expect(ofensores).toEqual(HUECO_DE_CONTRATO);
  });
});
