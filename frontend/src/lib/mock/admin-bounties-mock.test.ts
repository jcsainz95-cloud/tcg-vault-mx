import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mockAdminBounties,
  mockUpsertVariantControls,
  mockVariantControlsStore,
  variantControlsKey,
} from './fixtures';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import { BOUNTY_SORTS } from '@/app/[locale]/(admin)/admin/m2/bounties/bounty-view-model';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ **EL SERVIDOR FALSO NO PUEDE SER MÁS PERMISIVO QUE EL DE VERDAD** (§M2-B.1)
 *
 * ### El defecto que este archivo existe para que no vuelva
 * El rótulo del buscador decía **«Buscar carta o set»**, el `where` del endpoint compone
 * `card.OR = [{ name contains }, { number contains }]` —**el set NO entra**— y el servidor falso
 * buscaba **también por `setName`**. Las tres piezas juntas producen el peor modo de fallo posible
 * para esta pantalla en concreto:
 *
 * - en **desarrollo** y en las **46 pruebas de pantalla** funciona (el mock encuentra el set);
 * - contra el **servidor real** el operador teclea «Obsidian Flames», lee **«Ningún bounty
 *   coincide»** y concluye que ese set no tiene bounties.
 *
 * Es un **falso negativo silencioso en la única pantalla que existe para que ninguna fila
 * desaparezca sin avisar** — la misma ceguera que §28 vino a curar, entrando por la puerta del
 * filtro. Y el mock lo **tapaba**: solo fallaba donde nadie mira.
 *
 * ### La regla que sale de aquí, y que este archivo hace ejecutable
 * ***Un mock puede ser más POBRE que el servidor; nunca más permisivo ni distinto.***
 *
 * ### Por qué el ancla es el CONTRATO y no `backend/`
 * `CLAUDE.md`: *«el contrato manda sobre el código»*. Si se anclara en el `.ts` del backend, este
 * candado bendeciría cualquier deriva que el backend introdujera, y además ataría el frontend a la
 * forma interna de un `where` de Prisma. Anclado en §M2-B.1, el día que el arquitecto **amplíe `q`**
 * (regla 9) esto se pone rojo **por el sitio correcto**: dirá que el mock y el rótulo se han quedado
 * cortos, que es exactamente la conversación que hay que tener.
 *
 * ⚠️ **Falla CERRADO y a propósito.** Reescribir el bullet de `q` o el de `sort` en el contrato
 * puede ponerlo rojo sin que la norma cambie; el coste es leer el diff del contrato y re-bendecir.
 * El coste del modo de fallo contrario ya se pagó: una pantalla de dinero que promete una búsqueda
 * que no existe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONTRACT_PATH = join(__dirname, '..', '..', '..', '..', 'docs', 'API_CONTRACT.md');

/** El cuerpo de §M2-B.1, anclado en el **id de la sección**, jamás en un número de línea. */
function sectionM2B1(): string {
  const doc = readFileSync(CONTRACT_PATH, 'utf8');
  const open = doc.indexOf('<a id="M2-B1"></a>');
  expect(open, `no se encontró §M2-B.1 en ${CONTRACT_PATH}`).toBeGreaterThan(-1);
  const close = doc.indexOf('<a id="M2-B2"></a>', open);
  expect(close, 'no se encontró el final de §M2-B.1 (§M2-B.2)').toBeGreaterThan(open);
  return doc.slice(open, close);
}

/** El bullet que declara QUÉ busca `q`. Devuelve la frase tal cual, sin el `q` — de delante. */
function contractQSpec(): string {
  const line = sectionM2B1()
    .split('\n')
    .find((l) => l.trimStart().startsWith('-') && l.includes('`q` —'));
  expect(line, 'no se encontró el bullet de `q` en §M2-B.1').toBeTruthy();
  const spec = /`q`\s*—\s*([^.\n]+)/.exec(line!)?.[1];
  expect(spec, `no se pudo leer qué busca \`q\`: ${line}`).toBeTruthy();
  return spec!.trim();
}

/** Los valores de `sort` que el contrato declara, en el orden en que los escribe. */
function contractSorts(): string[] {
  const line = sectionM2B1()
    .split('\n')
    .find((l) => l.trimStart().startsWith('- `sort` —'));
  expect(line, 'no se encontró el bullet de `sort` en §M2-B.1').toBeTruthy();
  return [...line!.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((v) => v !== 'sort');
}

const ALL = { page: 1, pageSize: 100 } as const;

// ===========================================================================
// 1 · `q` — el mock busca EXACTAMENTE lo que el endpoint busca
// ===========================================================================
describe('`q`: el servidor falso no busca por más campos que el servidor', () => {
  it('el CONTRATO declara `q` sobre nombre y número de carta, y NO sobre el set', () => {
    const spec = contractQSpec();
    expect(spec).toMatch(/nombre/i);
    expect(spec).toMatch(/número/i);
    // ⚠️ Si esto se pone rojo, el arquitecto AMPLIÓ `q`: entonces hay que ampliar el mock **y** el
    // rótulo, en ese orden. ⛔ Lo que no vale es ampliar el mock por su cuenta (regla 9).
    expect(spec, `§M2-B.1 declara ahora \`q\` sobre: «${spec}»`).not.toMatch(/\bsets?\b/i);
  });

  it('⭐ un `q` que SOLO casa con el nombre del set no devuelve nada (el falso negativo, al revés)', () => {
    // Las seis filas semilla de bounty viven en dos sets: `Base Set` y `Surging Sparks`. Ninguna
    // carta lleva esas palabras en su nombre ni en su número.
    const all = mockAdminBounties(ALL);
    expect(all.data.length).toBeGreaterThan(0);
    expect(all.data.some((r) => r.setName === 'Surging Sparks')).toBe(true);

    // Antes de este candado, esto devolvía 3 filas en el mock y 0 contra el servidor real.
    expect(mockAdminBounties({ ...ALL, q: 'Surging Sparks' }).data).toHaveLength(0);
    expect(mockAdminBounties({ ...ALL, q: 'sparks' }).data).toHaveLength(0);
    expect(mockAdminBounties({ ...ALL, q: 'Base Set' }).data).toHaveLength(0);
  });

  it('…y el nombre y el número de la carta SÍ casan (el mock no es más pobre de lo debido)', () => {
    const byName = mockAdminBounties({ ...ALL, q: 'latias' });
    expect(byName.data.map((r) => r.cardId)).toEqual(['c-latias-sir']);

    const byNumber = mockAdminBounties({ ...ALL, q: '242' });
    expect(byNumber.data.map((r) => r.cardId)).toEqual(['c-latias-sir']);
  });

  it('el filtro por set sigue existiendo, y es `setId` — que es OTRA cosa que `q`', () => {
    const bySet = mockAdminBounties({ ...ALL, setId: 'sv08' });
    expect(bySet.data.length).toBeGreaterThan(0);
    expect(bySet.data.every((r) => r.setId === 'sv08')).toBe(true);
  });

  it('⭐ el RÓTULO no promete más de lo que el contrato declara (ES y EN)', () => {
    // El defecto medido era exactamente éste: «Buscar carta o set» / «Search card or set».
    const esLabel = es.admin.m2.bounties.filters.searchLabel;
    const enLabel = en.admin.m2.bounties.filters.searchLabel;
    expect(contractQSpec()).not.toMatch(/\bsets?\b/i); // premisa del candado, explícita
    expect(esLabel.toLowerCase()).not.toMatch(/\bsets?\b/);
    expect(enLabel.toLowerCase()).not.toMatch(/\bsets?\b/);
    // Y sigue diciendo qué busca: un rótulo vacío no es la cura.
    expect(esLabel.toLowerCase()).toContain('carta');
    expect(enLabel.toLowerCase()).toContain('card');
  });
});

// ===========================================================================
// 2 · `sort` — las TRES opciones del `<Select>` existen en el servidor falso
// ===========================================================================
describe('`sort`: ninguna opción ofrecida puede ser inerte', () => {
  it('el `<Select>` ofrece exactamente los valores que declara §M2-B.1', () => {
    expect([...BOUNTY_SORTS]).toEqual(contractSorts());
  });

  it('⭐ `updatedAt` es distinto por fila — sin eso el orden por edición NO PUEDE EXISTIR', () => {
    const stamps = mockAdminBounties(ALL).data.map((r) => r.updatedAt);
    expect(stamps.length).toBeGreaterThan(2);
    // La versión anterior devolvía la MISMA constante en todas las filas: `updated_desc` era
    // indistinguible de cualquier otro orden y el `<Select>` ofrecía una opción que no hacía nada.
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it('⭐ `updated_desc` ordena por `updatedAt` descendente (y NO por precio)', () => {
    const rows = mockAdminBounties({ ...ALL, sort: 'updated_desc' }).data;
    const stamps = rows.map((r) => Date.parse(r.updatedAt));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));

    // El defecto era caer en el precio descendente: se exige que los dos órdenes DIFIERAN sobre el
    // mismo conjunto. Si alguien vuelve a fundir las ramas del `if`, esto es rojo.
    const byPrice = mockAdminBounties({ ...ALL, sort: 'price_desc' }).data.map((r) => r.cardId);
    expect(rows.map((r) => r.cardId)).not.toEqual(byPrice);
  });

  it('`price_desc` ordena por lo que PAGAMOS, descendente', () => {
    const prices = mockAdminBounties({ ...ALL, sort: 'price_desc' }).data.map(
      (r) => r.pricing.bounty?.priceCents ?? -1,
    );
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('`attention_first` (default) pone delante lo que cuesta dinero en silencio', () => {
    const rank: Record<string, number> = {
      rebasada: 0,
      invalida: 0,
      activa: 1,
      completada: 2,
      apagada: 3,
    };
    const ranks = mockAdminBounties(ALL).data.map((r) => rank[r.state]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // El default es el mismo con `sort` omitido y con `sort` explícito.
    expect(mockAdminBounties({ ...ALL, sort: 'attention_first' }).data.map((r) => r.cardId)).toEqual(
      mockAdminBounties(ALL).data.map((r) => r.cardId),
    );
  });

  it('una escritura mueve la fila al frente de `updated_desc` (`@updatedAt`, como en Prisma)', () => {
    const key = variantControlsKey('c-charizard', 'raw', 'raw:NM', 'holofoil');
    const before = mockVariantControlsStore.get(key)!.updatedAt;
    expect(mockAdminBounties({ ...ALL, sort: 'updated_desc' }).data[0]?.cardId).not.toBe('c-charizard');
    try {
      mockUpsertVariantControls('c-charizard', 'holofoil', {
        productType: 'raw',
        gradeKey: 'raw:NM',
        bounty: { enabled: true },
      });
      expect(mockAdminBounties({ ...ALL, sort: 'updated_desc' }).data[0]?.cardId).toBe('c-charizard');
    } finally {
      // El store es estado de módulo: se restaura para no fijar el orden de ejecución de nadie.
      mockVariantControlsStore.get(key)!.updatedAt = before;
    }
  });
});

// ===========================================================================
// 3 · La resta del avance se escribe UNA vez
// ===========================================================================
describe('`remainingQty`: un solo piso en 0, en un solo sitio', () => {
  it('nunca es negativo, y `targetQty: null` ⇒ `null` (jamás `0`)', () => {
    const key = variantControlsKey('c-pikachu-ir', 'raw', 'raw:NM', 'holofoil');
    const row = mockVariantControlsStore.get(key)!;
    const acquired = row.bountyAcquiredQty;
    const target = row.bountyTargetQty;
    try {
      // Sobre-adquirido: 4 de un objetivo de 3 es representable (y el borde que nombra el comentario).
      row.bountyAcquiredQty = (target ?? 0) + 1;
      const over = mockAdminBounties(ALL).data.find((r) => r.cardId === 'c-pikachu-ir')!;
      expect(over.progress.remainingQty).toBe(0);

      row.bountyTargetQty = null;
      const noTarget = mockAdminBounties(ALL).data.find((r) => r.cardId === 'c-pikachu-ir')!;
      expect(noTarget.progress.remainingQty).toBeNull();
    } finally {
      row.bountyAcquiredQty = acquired;
      row.bountyTargetQty = target;
    }
  });
});
