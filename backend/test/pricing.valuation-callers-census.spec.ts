import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/strip-comments';
import { countIdentUses, identCensus, methodBody } from './helpers/ident-census';

/**
 * v1.80.1 (API_CONTRACT §M2-SK **SK-5**, candado **VK-6**) — **censo CERRADO de quién toca la llave de
 * COLA.**
 *
 * `tryBuildGradeKey`/`tryGradeKeyFor` devuelven `'sealed'` para TODO sellado — es la llave de **cola**
 * (SK-2) y por eso NO se cambió. El defecto de SK-5 fue que cinco lectores de **patrimonio** la usaban
 * como llave de **precio**. La cura es `PricingService.valuationKeyFor`/`valuationCentsOf`; este censo
 * es lo que impide **esquivarla**: un fichero nuevo que llame a la llave de cola —o uno de la lista que
 * gane una llamada más— pone esto rojo hasta que alguien lo añada **con su razón escrita**.
 *
 * Cuenta **apariciones del identificador en CÓDIGO** (comentarios fuera, con el autómata compartido
 * `helpers/strip-comments.ts`), no solo llamadas con paréntesis: `arr.map(this.pricing.tryGradeKeyFor)`
 * también es usarla, y un `import` también se cuenta porque es el primer síntoma de un llamador nuevo.
 *
 * ⛔ Los lectores de patrimonio de SK-5 **no pueden estar en la lista**: `vault.service.ts`
 * (holdings, holdingDetail, `/vault/sealed`), `admin-vaults.service.ts` (`GET /admin/vaults`) y
 * `admin.service.ts` (custodyValue, ownedItemRefs, inventoryValue). Ahí se valúa con `valuationKeyFor`.
 */

const SRC = join(__dirname, '..', 'src');
const IDENT = /\b(?:tryGradeKeyFor|tryBuildGradeKey)\b/g;

/**
 * Nº de apariciones de la llave de cola en el CÓDIGO (sin comentarios) de un texto fuente.
 * v1.80.2.2: el recorrido y el conteo viven en `helpers/ident-census.ts` (patrón VK-6 compartido con
 * BC-9(b) y el candado de `quoteAcquisitionFromCurve`); aquí solo queda la regex de ESTE censo.
 */
export function countQueueKeyUses(source: string): number {
  return countIdentUses(source, IDENT);
}

function census(): Record<string, number> {
  return identCensus(SRC, IDENT);
}

/**
 * D-1: llave de variante interpolada A MANO — cuatro `${…}` unidos por `|` dentro de una plantilla.
 * Es la forma exacta que `common/variant-key.ts` centralizó (P-30 H2) y que los lectores repetían.
 */
const MANUAL_KEY = /\$\{[^}]*\}\|\$\{[^}]*\}\|\$\{[^}]*\}\|\$\{[^}]*\}/g;
export function countManualKeys(code: string): number {
  return (code.match(MANUAL_KEY) ?? []).length;
}

/**
 * LA LISTA CERRADA. Cada entrada: nº de apariciones en código + **por qué puede usar la llave de cola**.
 * Leídas una a una el 2026-09-28 (backend, lectura de código; NO MEDIDO por HTTP salvo donde se dice).
 */
const ALLOWED: Record<string, { n: number; why: string }> = {
  'modules/pricing/pricing.types.ts': {
    n: 1,
    why: 'DEFINICIÓN de `tryBuildGradeKey` (la llave de cola; `sealed` ⇒ `\'sealed\'` por diseño, SK-2).',
  },
  'modules/pricing/pricing.service.ts': {
    n: 4,
    why:
      'Import + definición del envoltorio `tryGradeKeyFor` + su cuerpo (`return tryBuildGradeKey`) + la rama ' +
      'raw/graduada de `valuationKeyFor` (la PUERTA de ' +
      'SK-5: el sellado sale antes por su propia rama y nunca llega a la llave de cola).',
  },
  'modules/catalog/catalog.service.ts': {
    n: 4,
    why:
      'Grid/storefront de singles: el lote de referencias trata el sellado aparte (`sealedMarketGradeKeyForItem`), ' +
      'los overrides de variante filtran `!== sealed`, `lookupKeysOf` es clave de agrupación/variante (el ' +
      'sellado resuelve su ref por `refFromBatch`, rama propia) y `buildListing` solo la usa en la rama no-sellada.',
  },
  'modules/orders/orders.service.ts': {
    n: 1,
    why: 'Checkout: el sellado retorna antes por `getSealedMarketRef` + gate; la llamada es la rama raw/graduada.',
  },
  'modules/inventory/inventory.service.ts': {
    n: 4,
    why:
      'Import + publicación (lote con rama sellada propia; `derivePublishSalePrice` retorna antes para sellado) + ' +
      're-publicación por variante (casa filas con la clave de COLA — uso legítimo). ⭐ v1.80.2.2 (errata ' +
      '«séptimo lector», `M2-SK-5-7`): el export .xlsx YA NO está aquí — `exportGradeKey` se retiró y ' +
      '`exportInventoryXlsx` valúa por la PUERTA (aserción por método abajo).',
  },
  'modules/inventory/inventory-position.adapter.ts': {
    n: 1,
    why: 'CONTEO de posición por variante (buylist), no valuación: la clave es de variante/cola.',
  },
  'modules/inventory/master-set.service.ts': {
    n: 2,
    why: '`resolveBuyables` del binder: el `where` excluye `productType:\'sealed\'`.',
  },
  'modules/inventory/sealed-graded.service.ts': {
    n: 1,
    why: 'Pestaña de slabs: siempre `productType:\'graded\'` literal; jamás produce `\'sealed\'`.',
  },
  'modules/buylist/buylist.service.ts': {
    n: 1,
    why: 'Contador de bounty en el pago (clave de VARIANTE, no de precio); solo lleva `productType`+`rawCondition`.',
  },
  'modules/pricing/price-ingest.service.ts': {
    n: 2,
    why: 'Barrido de cola del ingest: el `where` acota a `productType:\'raw\'`.',
  },
  'jobs/price-sync.service.ts': {
    n: 2,
    why:
      'Job `price-sync` (v1.80.8.4, §M2 `M2-VQ`): (1) clave de la `PriceReference` que refresca por pieza ' +
      '(sellado ⇒ `\'sealed\'`; ya NO escala a la cola); (2) `queueKeyOfItem` del barrido VQ, que casa ' +
      'filas `reason IS NULL` de VENTA con la clave de COLA de las piezas vendibles de plataforma. ' +
      'Uso de COLA que SK-2 preserva (no valúa patrimonio).',
  },
};

/** Los lectores de patrimonio de SK-5. ⛔ Ninguno puede aparecer en el censo. */
const SK5_READERS = [
  'modules/vault/vault.service.ts',
  'modules/vault/admin-vaults.service.ts',
  'modules/admin/admin.service.ts',
];

describe('SK-5 · VK-6 — censo cerrado de la llave de COLA (`tryGradeKeyFor`/`tryBuildGradeKey`)', () => {
  const actual = census();

  it('la lista de ficheros y el nº de usos es EXACTAMENTE la cerrada (un llamador nuevo ⇒ rojo)', () => {
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([f, { n }]) => [f, n]));
    expect(actual).toEqual(expected);
  });

  it.each(SK5_READERS)('%s (lector de patrimonio) NO usa la llave de cola', (f) => {
    expect(ALLOWED[f]).toBeUndefined();
    expect(countQueueKeyUses(readFileSync(join(SRC, f), 'utf8'))).toBe(0);
  });

  it('cada entrada lleva su razón escrita', () => {
    for (const [f, { why }] of Object.entries(ALLOWED)) {
      expect({ f, len: why.trim().length > 20 }).toEqual({ f, len: true });
    }
  });

  it('los lectores de patrimonio pasan por la PUERTA (`valuationKeyFor` + `valuationCentsOf`)', () => {
    for (const f of SK5_READERS) {
      const code = stripComments(readFileSync(join(SRC, f), 'utf8'));
      expect({ f, key: /\bvaluationKeyFor\(/.test(code), cents: /\bvaluationCentsOf\(/.test(code) }).toEqual({
        f,
        key: true,
        cents: true,
      });
    }
  });

  /**
   * ⭐ v1.80.2.2 (errata «séptimo lector», `M2-SK-5-7`) — aserción POR MÉTODO: `inventory.service.ts`
   * sigue en la lista (publicación/re-publicación usan la llave de cola con razón), pero el cuerpo de
   * `exportInventoryXlsx` es un lector de patrimonio y NO puede usarla: valúa por la puerta de SK-5.
   */
  it('exportInventoryXlsx (séptimo lector) tiene 0 usos de la llave de cola y pasa por la PUERTA', () => {
    const src = readFileSync(join(SRC, 'modules/inventory/inventory.service.ts'), 'utf8');
    const body = methodBody(stripComments(src), 'async exportInventoryXlsx(');
    expect(body.length).toBeGreaterThan(200); // el ancla existe y el cuerpo no está vacío
    expect(countQueueKeyUses(body)).toBe(0);
    expect(/\bvaluationKeyFor\(/.test(body)).toBe(true);
    expect(/\bvaluationCentsOf\(/.test(body)).toBe(true);
    // `exportGradeKey` (la llave propia del export) se retiró: ni definición ni llamada en el fichero.
    expect(/\bexportGradeKey\b/.test(stripComments(src))).toBe(false);
    // D-1 / D-4 (abajo) también aplican al séptimo lector.
    expect(countManualKeys(body)).toBe(0);
    expect(/\bvariantKey\(/.test(body)).toBe(true);
    expect(/\bsealedSourceOnFor\(/.test(body)).toBe(true);
    expect(/\bloadSealedSpreads\b/.test(body)).toBe(false);
  });

  /**
   * ⭐ v1.80.2.2 — **D-1 (techlead, Media)**: los lectores de SK-5 llaveaban a mano el `Map` del lote
   * (`${cardId}|${productType}|${gradeKey}|${finish}`) mientras el PRODUCTOR (`getReferencesBatch`)
   * llavea con `variantKey()`. Si `variantKey` cambia de forma, un lector a mano deja de encontrar su
   * fila y el patrimonio cae a `pending` EN SILENCIO (ningún error: solo un número más bajo). Candado:
   * en los lectores hay CERO llaves de cuatro componentes a mano y SÍ `variantKey(`; y el productor
   * sigue llaveando con `variantKey(` — así productor y consumidor no pueden divergir por forma.
   */
  it('D-1 · los lectores de patrimonio llavean el lote con `variantKey(` y NUNCA a mano (0 llaves `a|b|c|d` interpoladas)', () => {
    for (const f of SK5_READERS) {
      const code = stripComments(readFileSync(join(SRC, f), 'utf8'));
      expect({ f, manual: countManualKeys(code), variantKey: /\bvariantKey\(/.test(code) }).toEqual({
        f,
        manual: 0,
        variantKey: true,
      });
    }
    const producer = methodBody(
      stripComments(readFileSync(join(SRC, 'modules/pricing/pricing.service.ts'), 'utf8')),
      'async getReferencesBatch(',
    );
    expect(/\bvariantKey\(/.test(producer)).toBe(true);
    expect(countManualKeys(producer)).toBe(0);
  });

  /**
   * ⭐ v1.80.2.2 — **D-4 (techlead, Baja)**: «el dial del sellado, una vez por petición y solo si hay
   * sellado» estaba copiado seis veces (`items.some(sealed) ? (await loadSealedSpreads()).sourceOn :
   * false`). Ahora vive UNA vez en `PricingService.sealedSourceOnFor(items)`; los lectores de SK-5 no
   * leen `loadSealedSpreads` directamente.
   */
  it('D-4 · los lectores de patrimonio izan el dial con `sealedSourceOnFor(` y NO con `loadSealedSpreads`', () => {
    for (const f of SK5_READERS) {
      const code = stripComments(readFileSync(join(SRC, f), 'utf8'));
      expect({ f, direct: /\bloadSealedSpreads\b/.test(code), helper: /\bsealedSourceOnFor\(/.test(code) }).toEqual({
        f,
        direct: false,
        helper: true,
      });
    }
  });

  describe('CANARIO — el escáner muerde (y no vigila prosa)', () => {
    const vaultSrc = readFileSync(join(SRC, 'modules/vault/vault.service.ts'), 'utf8');

    it('una llamada a `tryGradeKeyFor` inyectada en vault.service.ts SE VE', () => {
      const mutated = vaultSrc.replace(
        /async holdings\(userId: string\) \{/,
        (m) => `${m}\n    const __canary = this.pricing.tryGradeKeyFor({ productType: 'sealed' });`,
      );
      expect(mutated).not.toBe(vaultSrc); // el ancla existe: la mutación se aplicó de verdad
      expect(countQueueKeyUses(mutated)).toBe(countQueueKeyUses(vaultSrc) + 1);
    });

    it('una referencia SIN paréntesis (`.map(this.pricing.tryGradeKeyFor)`) también se ve', () => {
      expect(countQueueKeyUses('xs.map(this.pricing.tryGradeKeyFor);')).toBe(1);
    });

    it('la misma palabra en un COMENTARIO no cuenta', () => {
      expect(countQueueKeyUses('// antes: this.pricing.tryGradeKeyFor(item)\n/* tryBuildGradeKey(x) */\nconst a = 1;')).toBe(0);
    });

    it('D-1 · una llave a mano inyectada en vault.service.ts SE VE; la misma en un comentario, NO', () => {
      const line = '    const __k = refs.get(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`);';
      const inject = (s: string) => vaultSrc.replace(/async holdings\(userId: string\) \{/, (m) => `${m}\n${s}`);
      const mutated = inject(line);
      expect(mutated).not.toBe(vaultSrc);
      const base = countManualKeys(stripComments(vaultSrc));
      expect(countManualKeys(stripComments(mutated))).toBe(base + 1);
      expect(countManualKeys(stripComments(inject(`    // ${line.trim()}`)))).toBe(base);
      // Tres componentes no son la llave de variante (no se confunde con otras plantillas).
      expect(countManualKeys('`${a}|${b}|${c}`')).toBe(0);
    });
  });
});
