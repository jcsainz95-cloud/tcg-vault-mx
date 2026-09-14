import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './helpers/strip-comments';
import { GROUPED_LISTING_KEYS, GROUPED_LISTING_SUMMARY_KEYS, SEALED_GROUP_KEYS, SEALED_GROUP_SUMMARY_KEYS } from './helpers/dto-keys';

/**
 * ⭐⭐ **LA DERIVACIÓN DE `P` ESTÁ CABLEADA — la pieza 7 del censo `§M10-IVA.9.f`, medida por el
 * MISMO método con el que el arquitecto midió su ausencia.**
 *
 * ### Por qué este fichero existe
 * El censo del arquitecto (2026-09-14) midió la pieza 7 así, literal: *«`rg 'displayPriceCents'
 * backend/src` ⇒ **10 aciertos, TODOS dentro de `modules/settings/iva-transfer.ts`**. Cero usos fuera
 * de ese módulo. Es aritmética pura para el acuse; **nada del checkout la llama**»*.
 *
 * ⇒ **La medición inversa es el candado.** Si la derivación se desconectara —un refactor que
 * devuelva `L` en el DTO, un `ctx.ivaDials` que deje de pasarse, un catálogo que vuelva a emitir
 * `salePriceCents`— la vitrina diría `100` mientras el checkout cobra sobre `116`, **y nada
 * fallaría**: son dos cifras plausibles. *Es el segundo de los seis modos de falsedad que
 * `§M10-IVA.9.f.3` tabula, y el único que no produce ninguna excepción.*
 *
 * ⛔ **Esto NO sustituye a los candados aritméticos** (`IVA-1`, `IVA-2`, `IVA-4`): aquéllos miden qué
 * dinero sale; éste mide **que el dinero pase por ahí**. Hacen falta los dos: una aritmética
 * impecable que nadie llama es exactamente el estado que el censo encontró.
 */

const SRC = join(__dirname, '..', 'src');

function ficherosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return ficherosTs(full);
    if (!e.isFile() || !e.name.endsWith('.ts')) return [];
    return e.name.endsWith('.spec.ts') ? [] : [full];
  });
}

/** Ficheros de `src/` (sin pruebas) que MENCIONAN un símbolo en CÓDIGO (⛔ no en prosa). */
function ficherosQueMencionan(simbolo: string): string[] {
  return ficherosTs(SRC)
    .filter((f) => stripComments(readFileSync(f, 'utf8')).includes(simbolo))
    .map((f) => relative(SRC, f).split('\\').join('/'))
    .sort();
}

describe('⭐⭐ la pieza 7 — `displayPriceCents` SALIÓ del módulo del dial y llegó al dinero', () => {
  it('⭐⭐ el censo INVERSO: la derivación se usa en `common`, `catalog` y `orders`', () => {
    const ficheros = ficherosQueMencionan('displayPriceCents');
    // Antes del corte: **solo** `modules/settings/iva-transfer.ts`. Ahora tiene que estar donde se
    // hace el precio. Se asierta el conjunto EXACTO: si un módulo nuevo empieza a derivar precios
    // por su cuenta, esto se pone rojo y alguien tiene que mirarlo.
    expect(ficheros).toEqual([
      'common/money.ts',
      'modules/catalog/catalog.service.ts',
      'modules/catalog/sealed-catalog.service.ts',
      'modules/orders/orders.service.ts',
      'modules/settings/iva-transfer.ts',
    ]);
  });

  it('⭐⭐ y la ARITMÉTICA vive en UN solo sitio: `common/money.ts`', () => {
    // *Si el preview del acuse y el precio que se cobra salieran de dos funciones distintas, el
    // acuse del criterio 188 podría cuadrar contra una cifra que el checkout no produce.*
    const money = stripComments(readFileSync(join(SRC, 'common', 'money.ts'), 'utf8'));
    expect(money.match(/export function displayPriceCentsOf\(/g)).toHaveLength(1);
    // Y el módulo del dial la **re-exporta**, ⛔ no la redefine.
    const dial = stripComments(readFileSync(join(SRC, 'modules', 'settings', 'iva-transfer.ts'), 'utf8'));
    expect(dial).not.toMatch(/function displayPriceCentsOf\(/);
    expect(dial).toMatch(/export \{ displayPriceCentsOf, taxBaseCentsOf \};/);
  });

  it('⭐⭐ el CHECKOUT deriva: `orders.service.ts` tiene el único sitio y está aislado', () => {
    const orders = stripComments(readFileSync(join(SRC, 'modules', 'orders', 'orders.service.ts'), 'utf8'));
    // ⭐ UN solo sitio (`derivedSaleDecision`), y por eso *«la vitrina dice 100 y el checkout cobra
    // sobre 116» no puede ocurrir por olvido de UNA rama* — hay cuatro precedencias de precio.
    expect(orders.match(/displayPriceCentsOf\(/g)).toHaveLength(1);
    expect(orders).toContain('private derivedSaleDecision(');
    // Y `buildLines` —el cuerpo ÚNICO de las líneas de orden— pasa por él.
    expect(orders).toContain('this.derivedSaleDecision(await this.resolveSaleDecision(item), iva)');
  });

  it('⭐ el CATÁLOGO deriva en `toListingRow`, que es por donde pasa toda pieza del storefront', () => {
    const catalog = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'catalog.service.ts'), 'utf8'));
    expect(catalog.match(/displayPriceCentsOf\(/g)).toHaveLength(1);
    expect(catalog).toContain('private async toListingRow(');
    // ⛔ Y `toListingDTO` NO es un segundo camino: es un envoltorio del primero.
    expect(catalog).toContain('return (await this.toListingRow(item, ctx)).dto;');
  });

  it('⛔⛔ NADIE inventa un dial: sin `ctx.ivaDials` y sin `SettingsService`, el catálogo LANZA', () => {
    // Un `?? { ivaTransferPct: 100 }` de cortesía serviría el precio de la posición equivocada **sin
    // que nada fallara**. Es la misma clase que el `default` que lanza en `ivaIsIncluded`.
    const catalog = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'catalog.service.ts'), 'utf8'));
    const i = catalog.indexOf('private async ivaDialsOf(');
    expect(i).toBeGreaterThan(-1);
    const cuerpo = catalog.slice(i, catalog.indexOf('\n  }\n', i));
    expect(cuerpo).toContain('throw new Error(');
    expect(cuerpo).not.toMatch(/ivaTransferPct:\s*100/);
  });

  it('⭐ y los diales se izan UNA vez por petición (⛔ no por pieza dentro del bucle)', () => {
    const catalog = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'catalog.service.ts'), 'utf8'));
    const i = catalog.indexOf('private async fetchSellable(');
    const cuerpo = catalog.slice(i, catalog.indexOf('\n  }\n', i));
    // La lectura está ANTES del `for`, y dentro del bucle solo se pasa por contexto.
    expect(cuerpo.indexOf('await this.ivaDialsOf()')).toBeLessThan(cuerpo.indexOf('for (const item of items)'));
    expect(cuerpo).toContain('ivaDials,');
    // *Dos piezas de la misma rejilla derivadas con posiciones distintas del dial darían dos precios
    // que el cliente no puede comparar.*
  });
});

describe('⭐⭐ la pieza 9 — `salePriceCents` DESAPARECIÓ de la superficie pública (§M10-IVA.3)', () => {
  it('⭐⭐ los cuatro DTOs públicos llevan los tres campos, y ⛔ NO `salePriceCents`', () => {
    for (const claves of [GROUPED_LISTING_KEYS, GROUPED_LISTING_SUMMARY_KEYS]) {
      expect(claves).toContain('displayPriceCents');
      expect(claves).toContain('ivaIncluded');
      expect(claves).toContain('ivaRatePct');
      expect(claves).not.toContain('salePriceCents');
    }
    for (const claves of [SEALED_GROUP_KEYS, SEALED_GROUP_SUMMARY_KEYS]) {
      // ⚠️ En sellado el NOMBRE se conserva (`fromPriceCents`, semántica «desde») — es la excepción
      // que el contrato declara. Lo que impide que un front sin migrar pinte la mentira son los dos
      // campos nuevos, que son REQUERIDOS: omitirlos no compila.
      expect(claves).toContain('fromPriceCents');
      expect(claves).toContain('ivaIncluded');
      expect(claves).toContain('ivaRatePct');
      expect(claves).not.toContain('salePriceCents');
    }
  });

  it('⭐ el rename NO es cosmético: un front que no migró **no compila**', () => {
    // *Dejar el mismo nombre cambiando su significado es el defecto de D54 un nivel más abajo, y
    // además un front que no migrara seguiría pintando la mentira sin que nada fallara.* Aquí se
    // asierta lo que sostiene esa garantía: el campo viejo **no existe** en el tipo.
    const catalog = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'catalog.service.ts'), 'utf8'));
    const i = catalog.indexOf('export interface ListingDTO {');
    const cuerpo = catalog.slice(i, catalog.indexOf('\n}\n', i));
    expect(cuerpo).toContain('displayPriceCents?: number;');
    expect(cuerpo).not.toMatch(/\bsalePriceCents\b/);
  });

  it('⭐ el ADMIN sigue viendo `L`: `PROJECT §Q.5` («no se convierte en superficie solo-con-IVA»)', () => {
    // El diagnóstico de curaduría de graduadas es `/admin/*` y su `salePriceCents` **es el precio de
    // lista**, porque es donde se toma la decisión de margen y el margen es `L`.
    const catalog = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'catalog.service.ts'), 'utf8'));
    expect(catalog).toContain('salePriceCents: g.listPriceCents');
  });

  it('⭐⭐ y el GATE de curaduría razona sobre `L`, ⛔ nunca sobre `P`', () => {
    // Meterle el precio con impuesto dentro movería el umbral `salePrice × maxRawMultiple` un `t·r`
    // hacia arriba **sin que nadie decida moverlo**: los estimados PSA son cifras de MERCADO, sin IVA.
    const catalog = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'catalog.service.ts'), 'utf8'));
    const usos = catalog.match(/rawSalePriceCents: [a-zA-Z.]+/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(3);
    for (const u of usos) expect(u).toMatch(/listPriceCents$/);
  });
});

describe('⛔⛔ criterio 209 — `ivaTransferPct` NO viaja a ninguna superficie de cliente', () => {
  it('⭐⭐ el censo de EMISIONES: dónde `ivaTransferPct` es una LLAVE de objeto y no una lectura', () => {
    // ⚠️ **El censo se hace sobre `ivaTransferPct:` (la LLAVE), ⛔ no sobre el símbolo.** Es la
    // diferencia que decide: `dials.ivaTransferPct` es una **lectura** del dial para derivar un
    // precio —legítima en cualquier sitio— mientras que `ivaTransferPct:` dentro de un objeto es lo
    // que **viaja en una respuesta o se escribe en una fila**. *Un censo que no distingue leer de
    // emitir da rojo por el uso correcto y enseña a ensanchar la lista.*
    const emisores = ficherosTs(SRC)
      .filter((f) => /ivaTransferPct:/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .sort();
    // ⛔ Ni `catalog`, ni `vault`, ni `buylist`, ni ninguna plantilla de correo. *Que el cliente
    // pueda leer qué fracción absorbemos es una FUGA COMERCIAL de la misma clase que v2.1.6 cerró
    // retirando `source`/`isManualOverride` de lo público.*
    expect(emisores).toEqual([
      'common/money.ts', // el tipo `IvaDials`
      'modules/orders/guest-checkout.service.ts', // la COLUMNA de la fila
      'modules/orders/orders.service.ts', // la COLUMNA de la fila
      'modules/settings/iva-transfer.ts', // el DTO de la puerta (`/admin/*`)
      'modules/settings/settings.controller.ts', // la ruta `/admin/*` y su bitácora
      'modules/settings/settings.service.ts', // la puerta
    ]);
  });

  it('⛔ y en `orders` aparece SOLO como columna que se escribe, nunca en un DTO de respuesta', () => {
    for (const f of ['orders.service.ts', 'guest-checkout.service.ts']) {
      const src = stripComments(readFileSync(join(SRC, 'modules', 'orders', f), 'utf8'));
      const usos = src.match(/ivaTransferPct:[^,;\n]*/g) ?? [];
      expect(usos.length).toBe(1);
      // La única forma admitida: `ivaTransferPct: ivaDials.ivaTransferPct` dentro de un `create`.
      for (const u of usos) expect(u).toMatch(/^ivaTransferPct: ivaDials\.ivaTransferPct/);
    }
  });

  it('⛔⛔ y NINGÚN módulo de superficie de CLIENTE lo emite (catálogo, bóveda, buylist, envíos)', () => {
    for (const mod of ['catalog', 'vault', 'buylist', 'shipments', 'disputes', 'users']) {
      const dir = join(SRC, 'modules', mod);
      for (const f of ficherosTs(dir)) {
        expect(stripComments(readFileSync(f, 'utf8'))).not.toMatch(/ivaTransferPct:/);
      }
    }
  });

  it('⛔ ninguna plantilla de correo lo menciona (§4.55.4, `C-AV-9`)', () => {
    const mails = ficherosTs(join(SRC, 'modules')).filter((f) => f.includes('/mail/'));
    expect(mails.length).toBeGreaterThan(3); // control: el barrido encuentra plantillas
    for (const f of mails) {
      expect(stripComments(readFileSync(f, 'utf8'))).not.toContain('ivaTransferPct');
    }
  });
});

/** ⭐ **EL CANARIO** — el instrumento (un censo por fichero) no es ciego. */
describe('⭐ canario del censo: encuentra lo que hay y no cuenta la prosa', () => {
  it('m1 — el barrido recorre de verdad (más de 100 ficheros de producción)', () => {
    expect(ficherosTs(SRC).length).toBeGreaterThan(100);
  });

  it('⭐⭐ m2 — un símbolo que SOLO aparece en un comentario ⛔ no cuenta', () => {
    // Es la mutación que haría un censo ingenuo: `money.ts` y `admin.service.ts` **explican en prosa**
    // la derivación y el dial. Si el instrumento mirara texto crudo, el conjunto exacto saldría más
    // grande y alguien «arreglaría» el test ensanchando la lista. Aquí se prueba con fuente sintética.
    expect(stripComments('// displayPriceCents va aquí\nconst x = 1;\n')).not.toContain('displayPriceCents');
    expect(stripComments('/* ivaTransferPct */\nconst y = 2;\n')).not.toContain('ivaTransferPct');
  });

  it('m3 — y un símbolo en CÓDIGO sí cuenta (si no, el censo sería vacío y verde por ceguera)', () => {
    expect(stripComments('const displayPriceCents = 1;\n')).toContain('displayPriceCents');
    expect(ficherosQueMencionan('displayPriceCents').length).toBeGreaterThan(0);
  });
});
