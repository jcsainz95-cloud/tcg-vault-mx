import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { stripComments } from './helpers/strip-comments';

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

/** Nº de apariciones de la llave de cola en el CÓDIGO (sin comentarios) de un texto fuente. */
export function countQueueKeyUses(source: string): number {
  return (stripComments(source).match(IDENT) ?? []).length;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function census(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walk(SRC)) {
    const n = countQueueKeyUses(readFileSync(f, 'utf8'));
    if (n > 0) out[relative(SRC, f).split(sep).join('/')] = n;
  }
  return out;
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
    n: 5,
    why:
      'Import + publicación (lote con rama sellada propia; `derivePublishSalePrice` retorna antes para sellado) + ' +
      're-publicación por variante (casa filas con la clave de COLA — uso legítimo) + export .xlsx ' +
      '(`exportGradeKey`). ⚠️ El export cae a `\'sealed\'` para sellado SIN mapeo: REPORTADO al arquitecto en ' +
      'BACKEND_NOTES SK-5, fuera del alcance de esta rev.',
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
    n: 1,
    why:
      'Job `price-sync`: sincroniza/ESCALA a la cola por clave de variante. Para sellado pide `\'sealed\'` — ' +
      'es el uso de COLA que SK-2 preserva (no valúa patrimonio).',
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
  });
});
