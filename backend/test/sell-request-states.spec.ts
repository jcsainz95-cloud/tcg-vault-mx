import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SellRequestStatus } from '@prisma/client';
import {
  isPayableSellRequest,
  isTerminalSellRequestStatus,
  SELL_REQUEST_COMMITTED_STATES,
  SELL_REQUEST_IN_TRANSIT_STATES,
  SELL_REQUEST_LIVE_STATES,
  SELL_REQUEST_NON_COMMITTING_STATES,
  SELL_REQUEST_PAYABLE_STATES,
  SELL_REQUEST_TERMINAL_STATES,
  SELL_REQUEST_VERIFYING_STATES,
} from '../src/common/sell-request-states';
import { SELL_REQUEST_TERMINAL_STATES as REEXPORTED } from '../src/modules/buylist/buylist-reject.constants';
import { variantKey, variantPositionKey } from '../src/common/variant-key';

/**
 * v1.51 (M-46, ARCHITECTURE §4.39c) — **EL RADIO DEL ENUM: los NUEVE sitios, cerrados.**
 *
 * M-46 añade cuatro valores a `SellRequestStatus` y había **nueve** listas de literales que
 * codificaban a mano un subconjunto. **Ninguna fallaba en compilación** (todas dentro de un
 * `in`/`notIn`/`includes`), así que la única forma de que no vuelvan a aparecer es un test que las
 * busque **como texto** en `src/` — igual que el guard de residuo de `enum-values-parity.spec.ts`.
 */

const SRC = join(__dirname, '..', 'src');

/** Lee todos los `.ts` de `src/` (sin specs). */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Contenido de `src/`, archivo por archivo, con su ruta relativa. */
const SOURCES: { path: string; text: string }[] = sourceFiles().map((p) => ({
  path: p.slice(SRC.length + 1),
  text: readFileSync(p, 'utf8'),
}));

/**
 * Quita comentarios de línea y de bloque. **Sin esto el guard sería inservible**: este repo documenta
 * los sets EN PROSA dentro de los docblocks (y este pase añadió varios), así que buscar el literal a
 * pelo daría positivo sobre la explicación de por qué el literal no debe existir.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const CODE = SOURCES.map((f) => ({ path: f.path, text: stripComments(f.text) }));

// ============================================================================================
describe('§4.39c — la FUENTE ÚNICA: composición de los subconjuntos', () => {
  it('los TERMINALES son CUATRO (criterio 113 / PROJECT §P.1) — `expirada` es el nuevo', () => {
    // ⚠️ ANCLA HUMANA. Es CLASE R: lo declara PROJECT, no el schema. Si mañana el enum gana un
    // estado, NO debe volverse terminal solo: romper aquí obliga a decidirlo.
    expect([...SELL_REQUEST_TERMINAL_STATES].sort()).toEqual([
      'abandonada',
      'expirada',
      'pagada',
      'rechazada',
    ]);
    expect(SELL_REQUEST_TERMINAL_STATES).toHaveLength(4);
  });

  it('LIVE ∪ TERMINAL == el enum completo, y LIVE ∩ TERMINAL == ∅', () => {
    // El test de contrato que exige §4.39c: «viva» se define POR EXCLUSIÓN (criterio 129), así que
    // un estado nuevo del schema entra SOLO a la cola del back-office.
    const todos = Object.values(SellRequestStatus).sort();
    const union = [...new Set([...SELL_REQUEST_LIVE_STATES, ...SELL_REQUEST_TERMINAL_STATES])].sort();
    expect(union).toEqual(todos);
    const interseccion = SELL_REQUEST_LIVE_STATES.filter((s) =>
      (SELL_REQUEST_TERMINAL_STATES as readonly string[]).includes(s),
    );
    expect(interseccion).toEqual([]);
  });

  it('los TRES estados nuevos no terminales entran a LIVE por complemento, sin tocar una línea', () => {
    expect(SELL_REQUEST_LIVE_STATES).toEqual(
      expect.arrayContaining(['ofertada', 'aceptada', 'en_transito']),
    );
    expect(SELL_REQUEST_LIVE_STATES).not.toContain('expirada');
  });

  it('NON_COMMITTING = TERMINAL − `pagada` (la que sí comprometió… y pagó)', () => {
    expect([...SELL_REQUEST_NON_COMMITTING_STATES].sort()).toEqual([
      'abandonada',
      'expirada',
      'rechazada',
    ]);
    expect(SELL_REQUEST_NON_COMMITTING_STATES).not.toContain('pagada');
    // ⚠️ Y `expirada` ESTÁ: es el cambio de conducta AML del pase — una oferta caducada deja de
    // quemarle la cuota mensual al vendedor.
    expect(SELL_REQUEST_NON_COMMITTING_STATES).toContain('expirada');
  });

  it('los subconjuntos del pipeline son valores REALES del enum (nada de strings sueltos)', () => {
    const todos = Object.values(SellRequestStatus) as string[];
    for (const set of [
      SELL_REQUEST_TERMINAL_STATES,
      SELL_REQUEST_COMMITTED_STATES,
      SELL_REQUEST_IN_TRANSIT_STATES,
      SELL_REQUEST_VERIFYING_STATES,
      SELL_REQUEST_PAYABLE_STATES,
    ]) {
      for (const s of set) expect(todos).toContain(s);
    }
    expect([...SELL_REQUEST_COMMITTED_STATES]).toEqual(['ofertada', 'aceptada']);
    // ⚠️ «En camino» es UN SOLO estado: lo que suma es la confirmación del OPERADOR (D20), no el
    // «ya lo mandé» del vendedor (criterios 138/156).
    expect([...SELL_REQUEST_IN_TRANSIT_STATES]).toEqual(['en_transito']);
    expect([...SELL_REQUEST_PAYABLE_STATES]).toEqual(['aprobada', 'verificacion']);
  });

  it('`isTerminalSellRequestStatus` coincide con el set, estado por estado', () => {
    for (const s of Object.values(SellRequestStatus)) {
      expect(isTerminalSellRequestStatus(s)).toBe(
        (SELL_REQUEST_TERMINAL_STATES as readonly string[]).includes(s),
      );
    }
  });

  it('la re-exportación de compat es el MISMO símbolo, no una segunda fuente (sitio 7)', () => {
    expect(REEXPORTED).toBe(SELL_REQUEST_TERMINAL_STATES);
  });
});

// ============================================================================================
describe('§4.39c — paridad a TRES BANDAS del enum: schema.prisma ⇄ Prisma ⇄ contrato', () => {
  const ROOT = join(__dirname, '..', '..');

  it('banda 1 — el enum de Prisma == el conjunto APROBADO (ancla humana)', () => {
    expect(Object.values(SellRequestStatus).sort()).toEqual(
      [
        'abandonada',
        'aceptada',
        'aprobada',
        'cotizada',
        'en_transito',
        'expirada',
        'ofertada',
        'pagada',
        'recibida',
        'rechazada',
        'verificacion',
      ].sort(),
    );
  });

  it('banda 2 — `schema.prisma` declara los MISMOS once valores', () => {
    const schema = readFileSync(join(ROOT, 'backend', 'prisma', 'schema.prisma'), 'utf8');
    const block = /enum SellRequestStatus \{([\s\S]*?)\}/.exec(schema);
    expect(block).not.toBeNull();
    const values = (block as RegExpExecArray)[1]
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 0);
    expect(values.sort()).toEqual(Object.values(SellRequestStatus).sort());
  });

  it('banda 3 — la línea canónica de `API_CONTRACT.md` declara los MISMOS once valores', () => {
    // El contrato manda sobre el código (CLAUDE.md): una discrepancia aquí no es cosmética, es la
    // especificación diciendo una cosa y el sistema haciendo otra. La declaración del contrato ocupa
    // DOS líneas (continúa con `| rechazada | abandonada | expirada`), así que se leen las de
    // continuación además de la primera.
    const contract = readFileSync(join(ROOT, 'docs', 'API_CONTRACT.md'), 'utf8');
    const m = /^SellRequestStatus\s+=\s+(.+(?:\n\s+\|.+)*)$/m.exec(contract);
    expect(m).not.toBeNull();
    const values = (m as RegExpExecArray)[1]
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join(' ')
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    expect(values.sort()).toEqual(Object.values(SellRequestStatus).sort());
  });
});

// ============================================================================================
describe('§4.39c — los NUEVE sitios: guard de RESIDUO (ninguno vuelve a codificar el set a mano)', () => {
  /**
   * Los literales que existían, sitio por sitio. Cada patrón es el **texto exacto** que había en el
   * código antes de M-46; si reaparece, este test lo señala **con nombre y apellido**.
   *
   * ⚠️ Este guard es la mitad que de verdad protege: la otra —«la constante compone bien»— ya pasa
   * arriba, y **pasaría igual** mientras un `notIn` olvidado siguiera con tres estados.
   */
  const RESIDUOS: { sitio: string; patron: RegExp; porQue: string }[] = [
    {
      sitio: '1 · ine-retention (PII/LFPDPPP)',
      patron: /\[\s*'pagada'\s*,\s*'rechazada'\s*,\s*'abandonada'\s*\]/,
      porQue:
        'con `expirada` fuera del set, una solicitud expirada cuenta ABIERTA para siempre y el INE NO SE PURGA NUNCA',
    },
    {
      sitio: '2+3 · acumulado mensual AML',
      patron: /notIn:\s*\[\s*'rechazada'\s*,\s*'abandonada'\s*\]/,
      porQue: 'una oferta EXPIRADA le seguiría quemando la cuota mensual al vendedor',
    },
    {
      sitio: '5 · workQueue del dashboard',
      patron: /\[\s*'cotizada'\s*,\s*'recibida'\s*,\s*'verificacion'\s*,\s*'aprobada'\s*\]/,
      porQue: 'subcuenta el pipeline: `ofertada`/`aceptada`/`en_transito` no aparecen en la cola',
    },
    {
      sitio: '8 · estado pagable de paySpei (DINERO SALIENTE)',
      patron: /\[\s*'aprobada'\s*,\s*'verificacion'\s*\]/,
      porQue:
        'estaba inline DOS veces en el mismo método (pre-check y guarda transaccional): pueden divergir en una edición',
    },
  ];

  it.each(RESIDUOS)('sitio $sitio — no queda ningún literal en `src/`', ({ patron, porQue }) => {
    const ofensores = CODE.filter((f) => patron.test(f.text)).map((f) => f.path);
    expect({ ofensores, porQue }).toEqual({ ofensores: [], porQue });
  });

  it('el set terminal SOLO se declara en `common/sell-request-states.ts` (sitio 7)', () => {
    // La declaración literal de los cuatro terminales existe UNA vez. En cualquier otro archivo es
    // una copia — la clase de bug que M-46 vino a cerrar, y que llevaba 147 commits anotada.
    const declaradores = CODE.filter((f) =>
      /'pagada'\s*,\s*'rechazada'\s*,\s*'abandonada'\s*,\s*'expirada'/.test(f.text),
    ).map((f) => f.path);
    expect(declaradores).toEqual(['common/sell-request-states.ts']);
  });

  it('los consumidores IMPORTAN la constante (no es que hayan borrado el filtro)', () => {
    // Guard simétrico del anterior: sin él, «no hay literal» se cumpliría también si alguien
    // hubiera borrado el `where` entero — que es peor que el literal viejo.
    const consumidores = [
      'jobs/ine-retention.service.ts',
      'common/buylist-aml.ts',
      'modules/admin/admin.service.ts',
      'modules/buylist/buylist.service.ts',
      'modules/buylist/buylist-reject.constants.ts',
    ];
    for (const path of consumidores) {
      const f = CODE.find((x) => x.path === path);
      expect(f).toBeDefined();
      expect(f?.text).toMatch(/sell-request-states/);
    }
  });

  it('sitio 6 — el reporte de brackets excluye las líneas `skip` SIN perder las `null`', () => {
    // Una línea que NO compramos no es una operación de compra. Pero `null` = línea PREVIA al ciclo
    // (el 100% de los datos de hoy) y TIENE que seguir contando: el predicado se escribe con un `OR`
    // explícito para no depender de cómo el ORM trata el `NULL` en un `not`.
    const admin = CODE.find((f) => f.path === 'modules/admin/admin.service.ts');
    expect(admin?.text).toMatch(
      /OR:\s*\[\s*\{\s*offerDecision:\s*null\s*\}\s*,\s*\{\s*offerDecision:\s*\{\s*not:\s*'skip'\s*\}\s*\}\s*\]/,
    );
  });

  it('sitio 9 — `isTerminal` se DERIVA server-side y viaja en las proyecciones', () => {
    // Existe para BORRAR la quinta copia del set, que vivía en el frontend (`M5View.tsx`). El front
    // no la sustituye por otra constante propia: el servidor le dice.
    const buylist = CODE.find((f) => f.path === 'modules/buylist/buylist.service.ts');
    const ocurrencias = (buylist?.text.match(/isTerminal: isTerminalSellRequestStatus\(/g) ?? [])
      .length;
    // Detalle (admin + cliente, vía la lista blanca compartida), listado de admin y listado propio.
    expect(ocurrencias).toBe(3);
  });

  it('sitio 10 — `isPayable` se DERIVA server-side y es ADMIN-ONLY (UNA sola emisión)', () => {
    // La SEXTA copia gobernaba el botón de PAGAR POR SPEI y replicaba **uno solo** de los dos
    // términos. `isPayable` la borra — pero **solo en la proyección de admin**: al vendedor le
    // anticiparía un depósito que aún puede no ocurrir. Que sea UNA emisión es la prueba de que no
    // se coló en las dos proyecciones de cliente (donde `isTerminal` sí va, y son tres).
    const buylist = CODE.find((f) => f.path === 'modules/buylist/buylist.service.ts');
    expect((buylist?.text.match(/isPayable: isPayableSellRequest\(/g) ?? []).length).toBe(1);
  });

  it('sitio 10 — `isPayableSellRequest` coincide con la constante Y exige `verifiedAt`', () => {
    for (const s of Object.values(SellRequestStatus)) {
      const enElSet = (SELL_REQUEST_PAYABLE_STATES as readonly SellRequestStatus[]).includes(s);
      // Con fecha: manda el set.
      expect(isPayableSellRequest({ status: s, verifiedAt: new Date() })).toBe(enElSet);
      // ⚠️ Sin fecha: NUNCA, ni siquiera en un estado del set. Éste es el término que el cliente no
      // replicaba, y por el que la UI ofrecía un pago que el servidor rechaza con 422.
      expect(isPayableSellRequest({ status: s, verifiedAt: null })).toBe(false);
    }
  });

  // NOTA: el guard de RESIDUO del estado pagable ya existe arriba (sitio 8) y discrimina por el
  // ORDEN del literal (`['aprobada','verificacion']`). No se añade otro: el set del AJUSTE VIVO
  // (`['verificacion','aprobada']`, `buylist-reject.constants.ts`) tiene **los mismos dos miembros y
  // otra regla**, y un guard que no distinguiera el orden los confundiría — declarando ofensor a un
  // literal legítimo. *Dos reglas que hoy coinciden en sus miembros no son la misma regla.*
});

// ============================================================================================
describe('§4.39e — P-30 H2: `buylist` deja de interpolar la llave canónica a mano', () => {
  it('no queda NINGUNA interpolación `${…}|${…}|${…}|${…}` en el módulo buylist', () => {
    // Cuatro fuentes nuevas del ciclo se agrupan por esta familia de llaves: si una la construyera
    // distinto, las cifras de la mesa de decisión se desalinearían EN SILENCIO y el operador
    // compraría mal. El guard de `test/tech-debt-backend.spec.ts` fija el FORMATO; éste fija que
    // nadie lo reproduzca a mano.
    const ofensores = CODE.filter(
      (f) => f.path.startsWith('modules/buylist/') && /\$\{[^}]+\}\|\$\{/.test(f.text),
    ).map((f) => f.path);
    expect(ofensores).toEqual([]);
  });

  it('`buylist.service.ts` usa `variantKey()` en TODOS sus sitios de agrupación', () => {
    const buylist = CODE.find((f) => f.path === 'modules/buylist/buylist.service.ts');
    expect(buylist?.text).toMatch(/from '\.\.\/\.\.\/common\/variant-key'/);
    // ⚠️ El contrato (§4.39e) enumeraba DOS interpolaciones; en el código vivo eran CUATRO. Se
    // migraron las cuatro: cerrar dos de cuatro habría dejado la clase abierta.
    // v1.51 (M-46, §4.39g): la MESA DE DECISIÓN añade DOS consumidores más de la misma llave —el
    // lookup del override por línea y el de la referencia de set_base—, así que el censo pasa de 4 a
    // 6. Es un censo, no un tope: lo que NO puede subir nunca es el número de interpolaciones a mano
    // (el test de arriba, que es el que de verdad protege el invariante). Si esta cifra sube porque
    // alguien añadió un consumidor que USA el helper, se actualiza; si sube el otro, se corrige el
    // código.
    expect((buylist?.text.match(/variantKey\(/g) ?? []).length).toBe(6);
  });

  it('la POSICIÓN se llavea con `variantPositionKey()` — la canónica MÁS la identidad de producto', () => {
    // §4.39g: las CUATRO fuentes de la posición (inventario on-hand, verificando, en tránsito y
    // comprometido) usan ESTA función. Un conteo que mezcle una promo con su versión del set base
    // «es peor que no mostrar nada, porque el operador lo creería» (§P.8 / D7).
    const buylist = CODE.find((f) => f.path === 'modules/buylist/buylist.service.ts');
    expect(buylist?.text).toMatch(/variantPositionKey\(/);
    // Derivada, NO paralela: se construye SOBRE `variantKey()`, así que no puede divergir de ella.
    expect(variantPositionKey({ ...POSITION_PARTS, cardProductId: null })).toBe(
      `${variantKey(POSITION_PARTS)}|base`,
    );
    expect(variantPositionKey({ ...POSITION_PARTS, cardProductId: 42 })).toBe(
      `${variantKey(POSITION_PARTS)}|42`,
    );
    // El caso base es EXPLÍCITO (`base`), no una cadena vacía que se confunda con un id ausente.
    expect(variantPositionKey({ ...POSITION_PARTS, cardProductId: null })).not.toBe(
      `${variantKey(POSITION_PARTS)}|`,
    );
  });
});

const POSITION_PARTS = {
  cardId: 'c1',
  productType: 'raw',
  gradeKey: 'raw:NM',
  finish: 'holofoil',
} as const;
