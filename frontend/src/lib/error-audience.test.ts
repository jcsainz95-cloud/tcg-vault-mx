import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import type { AdminBuylistDTO } from '@/types/contract';
import {
  AUDIENCE_SENSITIVE_ERROR_CODES,
  DESIGN_SYSTEM_26_ERROR_CODES,
  DESIGN_SYSTEM_27_LOT1_ERROR_CODES,
  DESIGN_SYSTEM_27_LOT2_PENDING_ERROR_CODES,
  ERROR_SCOPE_AUDIENCE,
  errorMessageKeys,
  resolveErrorAudience,
  STREAM_B_ERROR_CODES,
  STREAM_B_ERROR_VARIANTS,
  STREAM_B_RETIRED_COPY_KEYS,
} from './error-audience';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN_SYSTEM §26 — «el destinatario manda». LOS CANDADOS.
 *
 * El defecto: `useErrorMessage` resolvía **por código a secas**, así que el `422 INE_REQUIRED` que
 * v1.58 hizo alcanzable desde `POST /admin/buylist/:id/offer` le decía al OPERADOR que subiera
 * **su** INE. **Hoy nada fallaba si el copy y su destinatario divergían — que es exactamente la
 * razón por la que divergieron.**
 *
 * Estos candados miden tres cosas distintas, y ninguna se tapa con otra:
 *   1. **EXISTENCIA** — que las claves de §26 estén en los DOS catálogos (si falta una, el operador
 *      lee el inglés crudo del servidor: prohibición 7).
 *   2. **SIGNIFICADO** — que la variante de operador **no le hable como si fuera el sujeto** de la
 *      regla (prohibiciones 1 y 2). Una variante que existe pero repite el «tú» del vendedor pasa
 *      cualquier candado de existencia y **no arregla nada**.
 *   3. **CABLEADO** — que toda pantalla de `(admin)` declare su audiencia. Sin esto, las dos
 *      anteriores estarían verdes con el mecanismo desconectado.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

function value(catalog: unknown, path: string): string | undefined {
  const found = path
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], catalog);
  return typeof found === 'string' ? found : undefined;
}

const CATALOGS: [string, unknown][] = [
  ['es', es],
  ['en', en],
];

describe('§26 · EXISTENCIA: los siete códigos y sus variantes están en los dos catálogos', () => {
  it.each(CATALOGS)('%s traduce los SIETE códigos de §26 (nunca el inglés del servidor)', (locale, catalog) => {
    const keys = new Set(keyPaths(catalog));
    const missing = DESIGN_SYSTEM_26_ERROR_CODES.filter((code) => !keys.has(`error.${code}`));
    expect(missing, `${locale}: sin copy base para ${missing.join(', ')}`).toEqual([]);
  });

  it.each(CATALOGS)('%s tiene la variante `_OPERATOR` de cada código de DOS destinatarios', (locale, catalog) => {
    const keys = new Set(keyPaths(catalog));
    const missing = AUDIENCE_SENSITIVE_ERROR_CODES.filter(
      (code) => !keys.has(`error.${code}_OPERATOR`),
    );
    expect(missing, `${locale}: sin variante de operador para ${missing.join(', ')}`).toEqual([]);
  });

  it.each(CATALOGS)('%s: la variante de operador NO es una copia de la base', (locale, catalog) => {
    // Si alguien «añade la clave» duplicando el texto del vendedor, el candado de existencia pasa
    // y el operador sigue leyendo el mensaje equivocado. Esto es lo que impide ese atajo.
    for (const code of AUDIENCE_SENSITIVE_ERROR_CODES) {
      const base = value(catalog, `error.${code}`);
      const operator = value(catalog, `error.${code}_OPERATOR`);
      expect(operator, `${locale}: falta error.${code}_OPERATOR`).toBeDefined();
      expect(operator, `${locale}: error.${code}_OPERATOR repite la cadena del vendedor`).not.toBe(base);
    }
  });
});

describe('§26.6 · SIGNIFICADO: al operador no se le habla como si fuera el sujeto de la regla', () => {
  /**
   * Prohibición 1. Se buscan las formas concretas del defecto medido —«tu INE», «superas el
   * tope»— y no un «tú» genérico: el copy de operador **sí** lo tutea («llámalo», «compra menos»),
   * y prohibir el tuteo entero pondría rojo un texto correcto. Lo prohibido es el «tú» que apunta
   * al VENDEDOR.
   */
  const SUBJECT_CONFUSION: [string, RegExp][] = [
    ['es', /\b(tu|tus)\s+(INE|identificaci[óo]n)\b|\bsuperas\b|\bnecesitas\s+subir\b/i],
    ['en', /\byour\s+(INE|ID)\b|\byou\s+exceed\b|\byou\s+need\s+to\s+upload\b/i],
  ];

  it.each(SUBJECT_CONFUSION)(
    '%s: ninguna variante `_OPERATOR` acusa al operador de incumplir la regla',
    (locale, forbidden) => {
      const catalog = locale === 'es' ? es : en;
      const offenders = AUDIENCE_SENSITIVE_ERROR_CODES.map(
        (code) => [`error.${code}_OPERATOR`, value(catalog, `error.${code}_OPERATOR`) ?? ''] as const,
      ).filter(([, text]) => forbidden.test(text));
      expect(offenders.map(([k]) => k)).toEqual([]);
    },
  );

  it.each(SUBJECT_CONFUSION)(
    '%s: y el candado NO está mirando al vacío — la cadena del VENDEDOR sí usa esa forma',
    (locale, forbidden) => {
      // Anti-vacuidad: si el patrón dejara de reconocer el defecto (o si las claves cambiaran de
      // nombre), esto se pone rojo antes de que el candado de arriba apruebe por no encontrar nada.
      const catalog = locale === 'es' ? es : en;
      expect(forbidden.test(value(catalog, 'error.INE_REQUIRED') ?? '')).toBe(true);
    },
  );

  it('prohibición 2: el UMBRAL DE INE no se interpola en ninguna cadena de operador', () => {
    // `thresholdCents` es cumplimiento **sobre un tercero**: no acota la acción del operador y sí
    // añade superficie (§M5-A.7 lo omite a propósito del `details` de la emisión).
    for (const [locale, catalog] of CATALOGS) {
      const operatorStrings = keyPaths(catalog)
        .filter((k) => k.startsWith('error.') && k.includes('_OPERATOR'))
        .map((k) => [k, value(catalog, k) ?? ''] as const);
      expect(operatorStrings.length, `${locale}: no se encontró ninguna cadena de operador`).toBeGreaterThan(0);
      const offenders = operatorStrings
        .filter(([, text]) => /\{threshold[A-Za-z]*\}|umbral de INE|INE threshold/i.test(text))
        .map(([k]) => k);
      expect(offenders, `${locale}: umbral de INE en cadena de operador`).toEqual([]);
    }
  });

  it('las tres cadenas viejas desaparecieron de los dos catálogos (§26.8.2)', () => {
    for (const [locale, catalog] of CATALOGS) {
      const all = keyPaths(catalog).map((k) => value(catalog, k) ?? '');
      // La cota «cotizado × 2» ya no se nombra dentro del ciclo de oferta… y la cadena que la
      // nombraba era una sola para los dos casos.
      expect(all.filter((v) => /cotizado × 2|quoted × 2/.test(v)), locale).toEqual([]);
    }
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ **EL CANDADO QUE LEE EL DOCUMENTO** (DESIGN_SYSTEM §26 y §27, sus tablas de copy)
 *
 * Los candados de arriba miden que las claves **existan** y que **no digan lo prohibido**. Ninguno
 * mira si el texto es **el que ux-ui escribió**: la primera vez las once cadenas se verificaron
 * «carácter por carácter» **a mano**, y una verificación manual no vuelve a correr nunca. Es la
 * misma clase de defecto que el servidor falso de `isPayable`: *lo que no está atado al documento
 * se desincroniza en cuanto el documento cambia.*
 *
 * Éste **parsea las dos secciones** y exige que cada fila de copy cableada esté en los DOS
 * catálogos, **literal**. Se pone rojo cuando ux-ui reescriba una cadena, cuando alguien retoque
 * el catálogo por su cuenta y —como acaba de pasar con `ITEMS_NOT_DECIDED`— cuando aparezca una
 * fila nueva que este release se comprometió a cablear.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DESIGN_SYSTEM_PATH = join(__dirname, '..', '..', '..', 'docs', 'DESIGN_SYSTEM.md');

/**
 * Una sección de primer nivel del sistema de diseño, entera. **§27 es la continuación directa de
 * §26** (misma convención de claves, mismas reglas duras, mismas prohibiciones), así que el
 * candado las lee **a las dos**: si el copy de errores se reparte en más secciones y el candado
 * mira solo una, vuelve a haber cadenas normativas que nadie compara con nada.
 */
function designSystemSection(number: number): string {
  const doc = readFileSync(DESIGN_SYSTEM_PATH, 'utf8');
  const heading = `\n## ${number}. `;
  const start = doc.indexOf(heading);
  expect(start, `no se encontró §${number} en ${DESIGN_SYSTEM_PATH}`).toBeGreaterThan(-1);
  const rest = doc.indexOf('\n## ', start + heading.length);
  return doc.slice(start, rest === -1 ? undefined : rest);
}

/**
 * Las filas de copy de §26: `| \`error.CLAVE\` | ES | EN |`.
 *
 * ⚠️ **§26.5 es OPCIONAL por decisión de ux-ui** (*«No son obligatorias. Se implementan solo si
 * frontend ya tiene el `DETAILED_ERRORS` cableado para ese código»*), así que sus filas se marcan
 * y se exigen **solo si están**. Lo que NO es opcional para ellas es la paridad y la literalidad:
 * una cadena a medio cablear —en `es` y no en `en`, o con el texto retocado— es peor que no
 * tenerla.
 */
function copyRows(section: string): { key: string; es: string; en: string; optional: boolean }[] {
  const rows: { key: string; es: string; en: string; optional: boolean }[] = [];
  let optional = false;
  for (const raw of section.split('\n')) {
    const heading = raw.match(/^### 26\.(\d+)/);
    if (heading) optional = heading[1] === '5';
    const row = raw.match(
      /^\|\s*`(error\.[A-Za-z0-9_.]+)`([^|]*)\|([^|]*)\|([^|]*)\|\s*$/,
    );
    if (!row) continue;
    const [, key, tag, es, en] = row;
    // ⚠️ Dos formas de «esta fila no trae texto»: la marca `*(opcional…)*` del propio documento y
    // la fila de REFERENCIA CRUZADA («*(ver §27.1.1…)*»), que repite una clave ya definida arriba.
    if (/^\s*\*\(/.test(es)) continue;
    rows.push({
      key,
      es: es.trim(),
      en: en.trim(),
      optional: optional || /opcional/i.test(tag),
    });
  }
  return rows;
}

/**
 * ⭐ **§34.12 SUPERSEDE a §26 para las claves que P-78 reescribió** (`error.INE_REQUIRED`), y el
 * candado tiene que saberlo o se pone rojo protegiendo la cadena vieja — que era exactamente el
 * defecto de v1.68: *una cifra de tope en un mensaje al cliente* (decisión (c) del dueño).
 *
 * ⚠️ **No se hard-codea la cadena nueva: se lee del documento.** La tabla «Cambian de valor» de
 * §34.12 tiene cuatro columnas (`clave | antes | ahora ES | ahora EN`) y de ahí salen las dos que
 * se exigen. Así el candado sigue atado al documento por los dos lados: si ux-ui reescribe el copy
 * nuevo, este test cae igual que caía con §26.
 *
 * ⏸️ **Las filas marcadas con `⏸️` se saltan a propósito**: §34.9 recortó el alcance de
 * `error.BUYLIST_LIMIT_EXCEEDED` **con motivo escrito** (esa superficie de error es de Stream B y
 * QA la está midiendo contra v1.68.1). Exigirla aquí obligaría a cambiar bajo los pies de quien
 * está midiendo — que es justo lo que el contrato prohíbe.
 */
function supersededCopyRows(): Map<string, { es: string; en: string }> {
  const section = designSystemSection(34);
  const map = new Map<string, { es: string; en: string }>();
  for (const raw of section.split('\n')) {
    const row = raw.match(
      /^\|\s*`(error\.[A-Za-z0-9_.]+)`([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/,
    );
    if (!row) continue;
    const [, key, tag, , esNow, enNow] = row;
    if (tag.includes('⏸️')) continue;
    map.set(key, { es: esNow.trim(), en: enNow.trim() });
  }
  return map;
}

describe('§26/§27 · LITERALIDAD: el copy del catálogo es el que dice DESIGN_SYSTEM, carácter por carácter', () => {
  // ⚠️ Se lee DENTRO de cada test (memoizado), no en el cuerpo del `describe`: si una sección se
  // renombra o se mueve, se quiere un test ROJO con su mensaje y no una suite que ni colecciona.
  let cached: { section: string; rows: ReturnType<typeof copyRows> } | null = null;
  const read = () => {
    cached ??= (() => {
      const section = designSystemSection(26) + designSystemSection(27);
      return { section, rows: copyRows(section) };
    })();
    return cached;
  };
  /** Las que este release se comprometió a cablear: §26 entera + el LOTE 1 de §27. */
  const WIRED = [...DESIGN_SYSTEM_26_ERROR_CODES, ...DESIGN_SYSTEM_27_LOT1_ERROR_CODES] as string[];
  const isWired = (key: string) =>
    WIRED.some((code) => key === `error.${code}` || key.startsWith(`error.${code}_`));

  it('el parser encuentra de verdad las tablas de §26/§27 (anti-vacuidad)', () => {
    const { rows } = read();
    // Sin esto, un cambio de formato en el documento dejaría `rows` vacío y **todas** las
    // comprobaciones de abajo pasarían sin mirar nada.
    expect(rows.length, 'no se parseó ninguna fila de copy de §26').toBeGreaterThanOrEqual(11);
    expect(rows.filter((r) => !r.optional).length).toBeGreaterThanOrEqual(11);
    expect(rows.map((r) => r.key)).toContain('error.INE_REQUIRED_OPERATOR');
    // Y el contenido es copy de verdad, no una celda de encabezado o un guion.
    for (const row of rows) {
      expect(row.es.length, `${row.key}: ES vacío en el documento`).toBeGreaterThan(20);
      expect(row.en.length, `${row.key}: EN vacío en el documento`).toBeGreaterThan(20);
    }
  });

  it('cada cadena NORMATIVA de lo CABLEADO está en `es` y en `en`, exactamente como la escribió ux-ui', () => {
    const { rows } = read();
    const superseded = supersededCopyRows();
    // Anti-vacuidad del superseder: §34.12 reescribe al menos `error.INE_REQUIRED`. Si el parser
    // dejara de encontrar su tabla, las claves de P-78 se compararían contra la cadena VIEJA y el
    // candado protegería la cifra que el dueño mandó retirar.
    expect(superseded.get('error.INE_REQUIRED')?.es, '§34.12 no trae el copy nuevo de INE_REQUIRED').toBeTruthy();
    const required = rows.filter((r) => !r.optional && isWired(r.key));
    // Anti-vacuidad: si `isWired` dejara de reconocer las claves, esto no compararía nada.
    expect(required.length).toBeGreaterThanOrEqual(11);
    for (const row of required) {
      const expected = superseded.get(row.key) ?? { es: row.es, en: row.en };
      const source = superseded.has(row.key) ? '§34.12' : '§26';
      expect(value(es, row.key), `es: ${row.key} no coincide con DESIGN_SYSTEM ${source}`).toBe(expected.es);
      expect(value(en, row.key), `en: ${row.key} no coincide con DESIGN_SYSTEM ${source}`).toBe(expected.en);
    }
  });

  it('todo lo demás se cablea ENTERO o nada: nunca a medias, nunca retocado', () => {
    // Cubre las opcionales (§26.5, §27.1.2) **y** el LOTE 2 pendiente: en cuanto alguien meta una
    // de esas cadenas en un catálogo, tiene que ser la del documento y estar en los dos idiomas.
    const { rows } = read();
    for (const row of rows.filter((r) => r.optional || !isWired(r.key))) {
      const wired = value(es, row.key) !== undefined || value(en, row.key) !== undefined;
      if (!wired) continue;
      expect(value(es, row.key), `es: ${row.key} cableada a medias o retocada`).toBe(row.es);
      expect(value(en, row.key), `en: ${row.key} cableada a medias o retocada`).toBe(row.en);
    }
  });

  /**
   * ⚠️ **EL INVENTARIO DEL LOTE 2** (§27.2): copy normativo escrito, cableado pendiente. Falla por
   * los dos lados —si §27 deja de declarar un código, o si alguien le mete copy sin actualizar el
   * inventario— para que un pendiente no pueda quedarse en «ya lo haremos» sin que nada lo diga.
   */
  it.each(DESIGN_SYSTEM_27_LOT2_PENDING_ERROR_CODES)(
    '`%s` sigue pendiente de cableado, y §27 lo declara (el inventario no miente)',
    (code) => {
      const { section } = read();
      expect(
        section.includes(code),
        `${code} ya no aparece en §26/§27: quítalo de DESIGN_SYSTEM_27_LOT2_PENDING_ERROR_CODES.`,
      ).toBe(true);
      for (const [locale, catalog] of CATALOGS) {
        expect(
          value(catalog, `error.${code}`),
          `${locale}: ${code} ya tiene copy en el catálogo — muévelo del LOTE 2 pendiente a la ` +
            'lista de cableados (y añade su `_OPERATOR` si el código llega a los dos destinatarios).',
        ).toBeUndefined();
      }
    },
  );
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * **STREAM B · los dos códigos que se resolvían EN LA VISTA** (hallazgo SB-D5/I3 del techlead).
 *
 * `409 INVALID_TRANSITION` (§M5-S) lo armaba `M5View` a mano —incluido su propio rótulo de
 * estado— y `409 PAYMENT_IN_PROGRESS` (§4-R.2) leía su copy de `checkout.retry.*`. Ninguno de los
 * dos pasaba por `error.*`, así que **ningún candado los miraba**: ni existencia, ni paridad es/en,
 * ni «no lo resuelvas otra vez en la pantalla siguiente».
 *
 * Estos tres candados miden cosas distintas y ninguno tapa al otro:
 *   1. EXISTENCIA y PARIDAD — base y variantes en los DOS catálogos, con texto de verdad.
 *   2. CABLEADO — la variante `_WITH_DETAILS` sin entrada en `DETAILED_ERRORS` sería copy muerto:
 *      se lee el fuente de `QueryState` y se exige la entrada.
 *   3. NO-REGRESO — las claves viejas no vuelven a existir (si vuelven, vuelve la copia).
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('Stream B · `INVALID_TRANSITION` y `PAYMENT_IN_PROGRESS` viven en el catálogo, no en la vista', () => {
  it.each(CATALOGS)('%s: base y variantes, en los dos catálogos y con texto de verdad', (locale, catalog) => {
    for (const code of STREAM_B_ERROR_CODES) {
      const base = value(catalog, `error.${code}`);
      expect(base, `${locale}: falta error.${code}`).toBeDefined();
      expect(base!.length, `${locale}: error.${code} vacío`).toBeGreaterThan(20);
      for (const variant of STREAM_B_ERROR_VARIANTS[code] ?? []) {
        const text = value(catalog, `error.${variant}`);
        expect(text, `${locale}: falta error.${variant}`).toBeDefined();
        expect(text!.trim().length, `${locale}: error.${variant} vacío`).toBeGreaterThan(0);
      }
    }
  });

  it('es y en no son la misma cadena (una traducción a medias es un catálogo a medias)', () => {
    for (const code of STREAM_B_ERROR_CODES) {
      expect(value(es, `error.${code}`), `error.${code} sin traducir`).not.toBe(
        value(en, `error.${code}`),
      );
    }
  });

  it('`INVALID_TRANSITION` está CABLEADO en `DETAILED_ERRORS` (su `_WITH_DETAILS` no es copy muerto)', () => {
    // Se lee el fuente porque la tabla es un objeto privado de `QueryState`: lo que importa es que
    // el código tenga entrada, no cómo la escriba.
    const src = readFileSync(join(__dirname, '..', 'components', 'ui', 'QueryState.tsx'), 'utf8');
    const table = src.slice(src.indexOf('const DETAILED_ERRORS'));
    expect(table.length, 'no se encontró DETAILED_ERRORS en QueryState.tsx').toBeGreaterThan(100);
    expect(/^\s{2}INVALID_TRANSITION: \(/m.test(table)).toBe(true);
    // Anti-vacuidad: el mismo patrón reconoce una entrada que SÍ existía desde antes.
    expect(/^\s{2}ITEMS_NOT_DECIDED: \(/m.test(table)).toBe(true);
  });

  it('las claves viejas NO vuelven: el copy de estos códigos no se resuelve en la pantalla', () => {
    for (const [locale, catalog] of CATALOGS) {
      const offenders = STREAM_B_RETIRED_COPY_KEYS.filter((k) => value(catalog, k) !== undefined);
      expect(offenders, `${locale}: copy de error de vuelta en la vista: ${offenders.join(', ')}`).toEqual([]);
    }
  });

  it('y ninguna VISTA arma el mensaje por su cuenta (ni `M5View`, ni el aviso del checkout)', () => {
    // El código se sigue MIRANDO en las vistas —para elegir qué afordancia pintar— pero el TEXTO
    // sale del catálogo. Lo que este candado prohíbe es volver a traducir el código en la vista.
    const files = [
      join(__dirname, '..', 'app', '[locale]', '(admin)', 'admin', 'm5', 'M5View.tsx'),
      join(__dirname, '..', 'app', '[locale]', '(storefront)', 'checkout', 'CheckoutRetryNotice.tsx'),
    ];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const offenders = STREAM_B_RETIRED_COPY_KEYS.filter((k) => {
        // La COLA tras el namespace con el que la vista abría sus traducciones
        // (`useTranslations('admin.m5.transition')` ⇒ `t('verb.receive')`). Se usa la cola y no la
        // hoja porque `receive`/`verify` son TAMBIÉN los rótulos legítimos de los dos botones de
        // M5 (`t('receive')`): prohibir la hoja pondría rojo un texto correcto.
        const tail = k.replace(/^(admin\.m5\.transition|checkout\.retry)\./, '');
        // ⚠️ `checkout.retry` SIGUE siendo un namespace legítimo de esa pantalla (sus afordancias:
        // «Ver pedido», «Reintentar en un momento»), así que aquí solo se prohíbe la CLAVE. El
        // namespace `admin.m5.transition` sí se prohíbe entero: no tenía más inquilinos que este
        // copy de error.
        return (
          new RegExp(`\\(\\s*['\`]${tail.replace('.', '\\.')}['\`]`).test(src) ||
          src.includes("useTranslations('admin.m5.transition')")
        );
      });
      expect(offenders, `${file}: sigue resolviendo copy de error en la vista`).toEqual([]);
    }
  });
});

describe('§26.2 · el SELECTOR: `code` + discriminador → destinatario', () => {
  it('`BUYLIST_LIMIT_EXCEEDED` se decide por `details.scope`', () => {
    const seller = resolveErrorAudience('BUYLIST_LIMIT_EXCEEDED', { scope: 'per_month' }, 'operator');
    const operator = resolveErrorAudience('BUYLIST_LIMIT_EXCEEDED', { scope: 'per_month_offer' }, undefined);
    // El servidor manda sobre la superficie: sabe qué puerta disparó.
    expect(seller).toBe('seller');
    expect(operator).toBe('operator');
  });

  it('`INE_REQUIRED` se decide por la FORMA de `details` (petición 1 al arquitecto)', () => {
    expect(resolveErrorAudience('INE_REQUIRED', { thresholdCents: 300000 }, 'operator')).toBe('seller');
    expect(
      resolveErrorAudience('INE_REQUIRED', { sellRequestId: 'sr-1', grossCents: 340000 }, undefined),
    ).toBe('operator');
  });

  it('sin discriminador manda la SUPERFICIE; sin superficie, no hay audiencia (se pinta la base)', () => {
    // `PICKUP_ADDRESS_LOCKED` no tiene discriminador en `details`: su desdoble es por ruta.
    expect(resolveErrorAudience('PICKUP_ADDRESS_LOCKED', undefined, 'operator')).toBe('operator');
    expect(resolveErrorAudience('PICKUP_ADDRESS_LOCKED', {}, undefined)).toBeUndefined();
  });

  it('los scopes RETIRADOS (v1.59/D47) no se traducen: caen a la superficie, y a la base si no hay', () => {
    // §26.2: «no se les escribe copy; si el front los recibe, es un hallazgo para QA».
    expect(ERROR_SCOPE_AUDIENCE).not.toHaveProperty('per_request');
    expect(ERROR_SCOPE_AUDIENCE).not.toHaveProperty('per_request_offer');
    expect(
      resolveErrorAudience('BUYLIST_LIMIT_EXCEEDED', { scope: 'per_request_offer' }, undefined),
    ).toBeUndefined();
  });

  it('el ORDEN de las claves es normativo: destinatario primero, base después', () => {
    expect(errorMessageKeys('INE_REQUIRED', 'operator')).toEqual([
      'error.INE_REQUIRED_OPERATOR',
      'error.INE_REQUIRED',
    ]);
    expect(errorMessageKeys('INE_REQUIRED', 'seller')).toEqual(['error.INE_REQUIRED']);
    expect(errorMessageKeys('INE_REQUIRED', undefined)).toEqual(['error.INE_REQUIRED']);
  });
});

describe('§26.3 · el HUECO DECLARADO de `APPROVED_PRICE_CAP_EXCEEDED` (petición 2 al arquitecto)', () => {
  it('la cadena del ciclo EXISTE en los dos catálogos, aunque hoy no se pueda elegir', () => {
    // Se cablea el texto porque es normativo; lo que no se cablea es el SELECTOR. Ver el trip-wire
    // de abajo y `docs/FRONTEND_NOTES.md` §50.
    for (const [locale, catalog] of CATALOGS) {
      expect(
        value(catalog, 'error.APPROVED_PRICE_CAP_EXCEEDED_OFFER_CYCLE'),
        `${locale}: falta la variante del ciclo de oferta`,
      ).toBeTruthy();
    }
  });

  it('y la base NO explica la cota retirada («cotizado × 2» sigue siendo cierta FUERA del ciclo)', () => {
    // El defecto era afirmar el `× 2` **siempre**. Fuera del ciclo la cota relativa sí aplica
    // (`relativeCapApplies: !inOfferCycle`), así que la base la nombra con propiedad; la del ciclo
    // no la menciona ni para negarla (§26.3).
    expect(value(es, 'error.APPROVED_PRICE_CAP_EXCEEDED')).toMatch(/doble de lo cotizado/);
    expect(value(es, 'error.APPROVED_PRICE_CAP_EXCEEDED_OFFER_CYCLE')).not.toMatch(/doble|× 2/);
  });
});

/**
 * ⚠️ **TRIP-WIRE del hueco declarado.** `inOfferCycle` lo decide el backend con
 * `sellRequest.offerSentAt != null` (`buylist.service.ts:6202`), y **`AdminBuylistDTO` no lleva
 * `offerSentAt`**: la pantalla no puede evaluar el selector de §26.3 sin inventarse un sustituto
 * (`offerState === 'sent'` **no** es equivalente — una oferta cancelada tiene `offerSentAt` sellado
 * y `offerState: 'cancelled'`). Por eso hoy se pinta la base, que es lo que §26.3 manda mientras
 * tanto.
 *
 * El día que el DTO gane el campo —o que `details` gane `bound`/`inOfferCycle`, que es la petición
 * 2 al arquitecto—, **esta línea deja de compilar** y obliga a cablear la variante en vez de
 * dejarla muerta en el catálogo. *Un hueco declarado sin trip-wire es un hueco que se olvida.*
 */
// ⚠️ Es un candado de TIPO puro (no ejecuta nada): `@ts-expect-error` falla cuando el error
// desaparece, o sea **cuando el campo aparezca**.
// @ts-expect-error — `offerSentAt` NO existe en `AdminBuylistDTO` (a propósito, ver arriba).
type _OfferSentAtIsNotAvailableToTheScreen = AdminBuylistDTO['offerSentAt'];

/**
 * Todos los `.ts`/`.tsx` de PRODUCCIÓN bajo un directorio (sin tests).
 */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) productionSources(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe('§26 · CABLEADO: toda pantalla de back-office declara a quién le habla', () => {
  const ADMIN_ROOT = join(__dirname, '..', 'app', '[locale]', '(admin)');
  const sources = productionSources(ADMIN_ROOT).map((f) => [f, readFileSync(f, 'utf8')] as const);
  const callers = sources.filter(([, src]) => /useErrorMessage\(/.test(src));

  it('la búsqueda encuentra de verdad las pantallas de admin que resuelven errores', () => {
    // Anti-vacuidad: si alguien mueve el grupo de rutas o renombra el hook, este candado dejaría
    // de mirar nada y aprobaría en silencio — el modo de fallo exacto que esta sesión persigue.
    expect(callers.length).toBeGreaterThanOrEqual(20);
  });

  it('NINGUNA pantalla de `(admin)` llama a `useErrorMessage()` sin declarar su audiencia', () => {
    // Un `useErrorMessage()` pelado en back-office resuelve con el copy del VENDEDOR: es el
    // defecto de §26 esperando a que alguien añada la pantalla número 26.
    const offenders = callers
      .filter(([, src]) => /useErrorMessage\(\s*\)/.test(src))
      .map(([file]) => file.replace(ADMIN_ROOT, '(admin)'));
    expect(
      offenders,
      `pantallas de admin sin audiencia declarada: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
