import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MissingReason,
  PreparationItemStatus,
  PaymentRefundKind,
  PaymentRefundStatus,
  ManualRefundStatus,
  AcquisitionType,
  Finish,
  GradingCompany,
  Locale,
  PendingPriceContext,
  PendingPriceReason,
  ProductType,
  RawCondition,
  SealedCondition,
  SealedGroupKind,
  SealedSubtype,
  ReplacementCaseSource,
  ShippedRefundReason,
  SpendAlertKind,
  SpendAlertSeverity,
} from '@prisma/client';
import {
  ACQUISITION_TYPE_VALUES,
  FINISH_VALUES,
  GRADING_COMPANY_VALUES,
  LOCALE_VALUES,
  PENDING_PRICE_CONTEXT_VALUES,
  PENDING_PRICE_REASON_VALUES,
  PRODUCT_TYPE_VALUES,
  SEALED_CONDITION_VALUES,
  SEALED_GROUP_KIND_VALUES,
  SEALED_SUBTYPE_VALUES,
  REPLACEMENT_CASE_SOURCE_VALUES,
  MISSING_REASON_VALUES,
  PREPARATION_ITEM_STATUS_VALUES,
  PAYMENT_REFUND_KIND_VALUES,
  PAYMENT_REFUND_STATUS_VALUES,
  MANUAL_REFUND_STATUS_VALUES,
  SPEND_ALERT_KIND_VALUES,
  SPEND_ALERT_SEVERITY_VALUES,
} from '../src/common/enum-values';
// v2.1.9 (D4): `RawCondition` es CLASE R — ya NO se deriva. Vive literal en `business-rules.ts`.
import { ACCEPTED_RAW_CONDITIONS, ACCEPTED_SHIPPED_REFUND_REASONS } from '../src/common/business-rules';
// `H3-d`: un candado de código mira CÓDIGO. Ver el docstring del helper.
import { stripComments } from './helpers/strip-comments';

/**
 * v2.1.8 — **un enum se declara UNA vez, y su declaración espeja el schema.**
 *
 * ### El bug que lo motivó
 * `SealedSubtype` tiene **siete** valores; había **ocho listas de cinco a mano** y `upc`/`collection`
 * quedaron fuera de todas. El dueño **sí vende UPC** y no podía: no se podía capturar la pieza, no se
 * podía filtrar en la tienda, el filtro de la bóveda **mentía en silencio**, y el spread salía siempre
 * al fallback del 25 % porque `PUT /admin/pricing/sealed-spreads` devolvía 422 para `upc`.
 *
 * ### Qué vigila este archivo, y por qué así
 * Añadir dos strings a ocho listas habría cerrado **ese** bug dejando la **clase** abierta. Estos
 * tests cierran la clase en dos direcciones:
 *
 *  1. **Paridad**: cada lista derivada == los valores del enum de Prisma. Si mañana alguien añade un
 *     octavo subtipo al schema y no regenera, esto falla.
 *  2. **Residuo**: **ninguna lista literal** de esos valores sobrevive en `src/`. Sin esto, la paridad
 *     pasaría verde mientras un `@IsIn(['box', ...])` olvidado sigue rechazando al cliente — que es
 *     exactamente la situación que había.
 *
 * Es la misma doctrina del candado de arquitectura del eje de venta y de `DisplayBp`: convertir una
 * disciplina en algo que sostiene la máquina.
 */

/**
 * v2.1.9 (S49-P4, seguridad) — **el ANCLA. Sin esto la paridad era una tautología.**
 *
 * La versión anterior afirmaba `Object.values(prismaEnum) === Object.values(prismaEnum)`: `derived`
 * ES el `Object.values` del mismo enum, así que el test **no podía fallar**. Un valor nuevo en
 * cualquier enum del schema pasaba en VERDE y quedaba **auto-aceptado en la API** — el `@IsIn` se
 * ensanchaba solo, el filtro público empezaba a admitirlo y ningún test lo notaba. El único ancla
 * real era el `toHaveLength(7)` de `SealedSubtype`, y era accidental (se escribió para fijar ESE bug).
 *
 * Aquí va la lista ESPERADA de cada enum, escrita a mano. Añadir un valor al schema **rompe este
 * archivo a propósito**, y quien lo arregle tiene que decidir —conscientemente— tres cosas que el
 * espejo automático decidía por él:
 *   1. ¿el valor nuevo debe aceptarse en los `@IsIn` públicos?
 *   2. ¿hay reglas de negocio con listas propias que NO son el enum completo? (ver `UserStatus` y
 *      `ACCEPTED_RAW_CONDITIONS` — decisiones de producto, no espejos del schema);
 *   3. ¿hay pricing / filtros / spreads que necesiten calibración para el valor nuevo?
 *
 * Es el mismo criterio que ya rige en `enum-values.ts`: derivar es correcto **mientras** alguien
 * confirme que el enum completo ES la regla. Este test es el sitio donde se confirma.
 */
const EXPECTED_ENUM_VALUES: Record<string, readonly string[]> = {
  SealedSubtype: ['blister', 'box', 'bundle', 'collection', 'etb', 'tin', 'upc'],
  SealedCondition: ['minor_box_damage', 'mint'],
  Finish: ['first_edition_holofoil', 'holofoil', 'normal', 'reverse_holo'],
  ProductType: ['graded', 'raw', 'sealed'],
  GradingCompany: ['CGC', 'PSA'],
  AcquisitionType: ['aportacion_en_especie', 'buylist', 'compra'],
  Locale: ['en', 'es'],
  // ⭐ `D-EQ-2` (v1.73) — los TRES que estaban transcritos a mano en un filtro de query. Entran aquí
  // porque entrar aquí **es** lo que les da la tercera banda: la que ya falló dos veces
  // (`PriceSource` sin `tcgcsv_singles`, `SealedSubtype` sin `upc`) fue siempre schema ↔ CONTRATO, y
  // nadie comparaba esas dos. `PendingPriceContext` ni siquiera TENÍA línea canónica en el contrato
  // hasta v1.73 (`rg PendingPriceContext docs/API_CONTRACT.md` ⇒ 0), así que su paridad a tres
  // bandas **no podía correr** — no es que pasara: es que no existía.
  PendingPriceReason: ['no_market', 'premium_at_floor'],
  PendingPriceContext: ['buylist', 'catalog', 'inventory', 'portfolio'],
  SealedGroupKind: ['promo_collection', 'set_main'],
  // v1.80.1 (M-61, §M4-SHIP.15.8): filtro `?source=` de `GET /admin/replacement-cases` ⇒ clase E.
  ReplacementCaseSource: ['vault_purchase', 'withdrawal'],
  // ⭐ v1.80.7.1 (§4.37 «una sola declaración», QA IMP-2): los cinco que `src/` VALIDA y derivaba por su cuenta.
  MissingReason: ['damaged', 'not_found'],
  PreparationItemStatus: ['missing', 'pending', 'picked'],
  PaymentRefundKind: ['case_refund', 'item_missing', 'order_full', 'order_remaining', 'shipment_fee'],
  PaymentRefundStatus: ['failed', 'requested', 'submitted', 'succeeded'],
  ManualRefundStatus: ['cancelled', 'paid', 'pending'],
  // 💰 D2g (§M4-SHIP.19.31.1 bandas 1–2): `?kind=` / `?severity=` de `GET /admin/spend-alerts` — los 22 tipos (AG-1…AG-22).
  SpendAlertKind: [
    'buylist_manual_price',
    'cancel_refund_missing',
    'carrier_extra_charge',
    'chargeback',
    'label_after_address_fix',
    'label_cap_blocked',
    'label_cap_warning',
    'label_charge_drift',
    'label_charged_unexplained',
    'label_costly_choice',
    'label_not_shipped',
    'label_reissue_loop',
    'operator_refund_cap',
    'owner_account_changed',
    'parcel_problem',
    'parcel_returned',
    'provider_balance_low',
    'psa_credits',
    'shrinkage',
    'staff_control_by_non_owner',
    'stuck_refund',
    'super_admin_money_out',
  ],
  SpendAlertSeverity: ['digest', 'immediate'],
};

/** Los enums de Prisma de clase E, por nombre (para el `it.each` de tres bandas). */
const PRISMA_ENUMS: Record<string, Record<string, string>> = {
  SealedSubtype,
  SealedCondition,
  Finish,
  ProductType,
  GradingCompany,
  AcquisitionType,
  Locale,
  PendingPriceReason,
  PendingPriceContext,
  SealedGroupKind,
  ReplacementCaseSource,
  MissingReason,
  PreparationItemStatus,
  PaymentRefundKind,
  PaymentRefundStatus,
  ManualRefundStatus,
  SpendAlertKind,
  SpendAlertSeverity,
};

/** Las listas DERIVADAS que consume `src/`, por nombre. */
const DERIVED_VALUES: Record<string, readonly string[]> = {
  SealedSubtype: SEALED_SUBTYPE_VALUES,
  SealedCondition: SEALED_CONDITION_VALUES,
  Finish: FINISH_VALUES,
  ProductType: PRODUCT_TYPE_VALUES,
  GradingCompany: GRADING_COMPANY_VALUES,
  AcquisitionType: ACQUISITION_TYPE_VALUES,
  Locale: LOCALE_VALUES,
  PendingPriceReason: PENDING_PRICE_REASON_VALUES,
  PendingPriceContext: PENDING_PRICE_CONTEXT_VALUES,
  SealedGroupKind: SEALED_GROUP_KIND_VALUES,
  ReplacementCaseSource: REPLACEMENT_CASE_SOURCE_VALUES,
  MissingReason: MISSING_REASON_VALUES,
  PreparationItemStatus: PREPARATION_ITEM_STATUS_VALUES,
  PaymentRefundKind: PAYMENT_REFUND_KIND_VALUES,
  PaymentRefundStatus: PAYMENT_REFUND_STATUS_VALUES,
  ManualRefundStatus: MANUAL_REFUND_STATUS_VALUES,
  SpendAlertKind: SPEND_ALERT_KIND_VALUES,
  SpendAlertSeverity: SPEND_ALERT_SEVERITY_VALUES,
};

describe('CLASE E — paridad a TRES BANDAS: schema.prisma ⇄ enum-values.ts ⇄ contrato', () => {
  /**
   * v2.1.9 (D4) — **la tercera banda es la que fallaba.**
   *
   * La versión anterior comparaba `Object.values(e)` contra `Object.values(e)`: una tautología que
   * **no podía fallar**. Pero aunque hubiera comparado bien dos bandas, habría seguido sin ver el
   * fallo REAL que ocurrió DOS veces: `PriceSource` sin `tcgcsv_singles` y `SealedSubtype` sin
   * `upc`/`collection` — en ambos casos la **línea canónica del contrato** era la desfasada, y nadie
   * la comparaba con nada. El contrato manda sobre el código (CLAUDE.md), así que una discrepancia
   * ahí no es cosmética: es la especificación diciendo una cosa y el sistema haciendo otra.
   */
  const CONTRACT = readFileSync(join(__dirname, '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');

  /** Lee la línea canónica `Nombre = a | b | c` del bloque «Enums (fuente de verdad)» del contrato. */
  function contractValues(name: string): string[] {
    const line = new RegExp(`^${name}\\s+=\\s+(.+)$`, 'm').exec(CONTRACT);
    if (!line) throw new Error(`El contrato no declara el enum ${name} en su línea canónica`);
    return line[1]
      .replace(/\/\/.*$/, '') // comentario de la misma línea
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  const NAMES = Object.keys(EXPECTED_ENUM_VALUES);

  it.each(NAMES)('%s · banda 1 — el enum de Prisma == el conjunto APROBADO (ancla humana)', (name) => {
    // Sin este ancla, «paridad» era `x === x`: un valor nuevo en el schema pasaba VERDE y quedaba
    // auto-aceptado en la API. Romper aquí es el punto: obliga a decidir.
    expect(Object.values(PRISMA_ENUMS[name]).sort()).toEqual([...EXPECTED_ENUM_VALUES[name]].sort());
  });

  it.each(NAMES)('%s · banda 2 — la lista derivada que consume `src/` == el enum', (name) => {
    expect([...DERIVED_VALUES[name]].sort()).toEqual(Object.values(PRISMA_ENUMS[name]).sort());
  });

  it.each(NAMES)('%s · banda 3 — la línea CANÓNICA del contrato == el enum', (name) => {
    expect(contractValues(name).sort()).toEqual(Object.values(PRISMA_ENUMS[name]).sort());
  });

  it('SealedSubtype trae los SIETE, incluidos `upc` y `collection` (el bug exacto)', () => {
    expect(SEALED_SUBTYPE_VALUES).toContain('upc');
    expect(SEALED_SUBTYPE_VALUES).toContain('collection');
    expect(SEALED_SUBTYPE_VALUES).toHaveLength(7);
  });

  it('el schema en DISCO es la fuente: se lee `schema.prisma` y se compara contra la lista', () => {
    // Cierra el hueco de que Prisma Client esté REGENERADO pero desfasado del schema en disco.
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const block = /enum SealedSubtype \{([\s\S]*?)\}/.exec(schema)![1];
    const fromSchema = block
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 0);
    expect(fromSchema.sort()).toEqual([...SEALED_SUBTYPE_VALUES].sort());
  });
});

/**
 * ⭐ v1.80.7.1 (§0 nota, §4.37; QA IMP-2 sobre `c20451f`) — **LA TERCERA BANDA ES UNIVERSAL.** La banda que falló
 * (`VaultPlacementCancelReason` sin `full_refund`, `RefundBasis` fantasma, `ManualRefund*` y `MovementReason` sin
 * línea) es schema ↔ CONTRATO, y esa NO depende de que el código derive el enum: corre sobre TODO `enum X {…}` de
 * `schema.prisma`. Un enum sin línea canónica en §0 es rojo salvo que esté en `SIN_LINEA_CANONICA` con razón.
 * Las bandas 1-2 (ancla humana + `enum-values.ts`) siguen solo sobre los que `src/` valida.
 */
describe('BANDA 3 UNIVERSAL — todo enum de `schema.prisma` ⇄ su línea canónica de §0 (v1.80.7.1)', () => {
  /** Enums del schema que, por decisión del arquitecto (v1.80.7.1), NO tienen línea canónica en §0. */
  const SIN_LINEA_CANONICA: readonly string[] = [
    'NameSource',
    'PriceConvention',
    'PriceRefKind',
    'CardProductKind',
    'PendingPriceStatus',
    'MetaDeckSource',
    'MetaCardGroup',
    'MetaMatchStatus',
  ];
  const SCHEMA = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const CONTRACT = readFileSync(join(__dirname, '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');
  const LINES = CONTRACT.split('\n');

  /** Todos los `enum X { … }` del schema EN DISCO, con sus valores (sin comentarios ni `@@`). */
  function schemaEnums(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const m of SCHEMA.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      out[m[1]] = m[2]
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '').trim())
        .filter((l) => l.length > 0 && !l.startsWith('@@'));
    }
    return out;
  }

  /** La línea `X = a | b …` de §0, con sus continuaciones (`  | c | d`), o `null` si no existe. */
  function contractLine(name: string): string[] | null {
    const i = LINES.findIndex((l) => new RegExp(`^${name}\\s+=\\s+`).test(l));
    if (i < 0) return null;
    let text = LINES[i].replace(/^\w+\s+=\s+/, '');
    for (let j = i + 1; j < LINES.length && /^\s+\|/.test(LINES[j]); j += 1) text += ` ${LINES[j]}`;
    return text
      .replace(/\/\/.*$/, '')
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  const ENUMS = schemaEnums();
  const NAMES = Object.keys(ENUMS).sort();

  it('el schema tiene enums y el parser los ve todos (⛔ un parser vacío sería verde por omisión)', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(50);
    expect(ENUMS.SealedSubtype).toEqual(expect.arrayContaining(['upc', 'collection']));
  });

  it('los enums SIN línea canónica son EXACTAMENTE `SIN_LINEA_CANONICA` (ni uno más, ni uno menos)', () => {
    const sinLinea = NAMES.filter((n) => contractLine(n) === null);
    expect(sinLinea.sort()).toEqual([...SIN_LINEA_CANONICA].sort());
  });

  it.each(NAMES.filter((n) => !SIN_LINEA_CANONICA.includes(n)))('%s · la línea canónica de §0 == el enum del schema en disco', (name) => {
    const fromContract = contractLine(name);
    if (!fromContract) throw new Error(`El contrato no declara ${name} y no está en SIN_LINEA_CANONICA`);
    expect(fromContract.sort()).toEqual([...ENUMS[name]].sort());
  });
});

describe('CLASE R — `RawCondition` expresa una REGLA, no el schema (D4, §4.37)', () => {
  /**
   * v2.1.9 (D4) — `RawCondition` se reclasifica de E a R y **sale de `enum-values.ts`**.
   *
   * La pregunta que decide la clase: *si mañana el schema gana `LP`, ¿el alta de inventario y el
   * cotizador deben aceptarlo **solos**?* La respuesta es **no**: `PROJECT.md` §H (LOCKED) dice que
   * «el raw se opera ÚNICAMENTE en NM» y §E que «si al recibir/verificar no está en NM, no se
   * compra». Derivar la lista del enum BORRARÍA esa regla el día que el enum crezca — y en las dos
   * puntas de dinero a la vez (se publicarían cartas no-NM y se cotizarían para compra).
   *
   * Los dos tests que el contrato exige para una clase R: **lista exacta** y **subconjunto** del enum.
   */
  it('lista EXACTA: el marketplace acepta `NM` y nada más (PROJECT §H)', () => {
    expect([...ACCEPTED_RAW_CONDITIONS]).toEqual(['NM']);
  });

  it('SUBCONJUNTO del enum de Prisma: la regla no puede aceptar algo que la BD no sabe guardar', () => {
    const schemaValues = Object.values(RawCondition) as string[];
    for (const accepted of ACCEPTED_RAW_CONDITIONS) {
      expect(schemaValues).toContain(accepted);
    }
    // Y es un subconjunto PROPIO o igual: nunca más ancho que el schema.
    expect(ACCEPTED_RAW_CONDITIONS.length).toBeLessThanOrEqual(schemaValues.length);
  });

  it('`enum-values.ts` ya NO exporta `RAW_CONDITION_VALUES` (no se puede derivar por accidente)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'common', 'enum-values.ts'), 'utf8');
    expect(src).not.toMatch(/export const RAW_CONDITION_VALUES/);
  });

  /**
   * ### ⚠️ Este candado vigilaba PROSA, y por eso tenía lista blanca (techlead, `P-89` → `H3-d`)
   * Corría la regex sobre el **fichero entero**, así que un **comentario** lo disparaba. La prueba de
   * que el defecto era real son las dos líneas que hubo que quitar de aquí:
   *
   * ```ts
   * if (f.endsWith(join('common', 'business-rules.ts'))) return false; // ahí VIVE la regla
   * if (f.endsWith(join('common', 'enum-values.ts'))) return false;    // ahí vive el porqué (comentario)
   * ```
   *
   * Ninguno de los dos ficheros tenía el patrón **en código**: `business-rules.ts:13,39` y
   * `enum-values.ts:53` lo mencionan **en prosa**, explicando justamente esta regla. *«Cada fichero que
   * quiera explicar la regla tiene que pedirle permiso al test»* — y la exención era del fichero
   * **entero**, así que un `RAW_CONDITION_VALUES` de verdad dentro de `business-rules.ts` habría
   * pasado sin que nada sonara. El candado era, a la vez, **demasiado sensible** (prosa) y
   * **demasiado ciego** (los dos ficheros que más importan).
   *
   * Se arregla como ya lo hacía su hermano de abajo (`offenders()`): **mirando código, no texto**.
   * Cero lista blanca. El canario (`scripts/check-enum-parity-lock-canary.sh`) demuestra las dos
   * mitades: que **sigue mordiendo** un `@IsIn` que derive la condición del enum, y que **ya no
   * muerde** un comentario que lo mencione.
   */
  it('ningún `@IsIn` de `src/` deriva la condición del enum de Prisma', () => {
    const SRC = join(__dirname, '..', 'src');
    const walkAll = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return walkAll(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
      });
    const offenders = walkAll(SRC).filter((f) =>
      /Object\.values\(RawCondition\)|RAW_CONDITION_VALUES/.test(stripComments(readFileSync(f, 'utf8'))),
    );
    expect(offenders.map((f) => f.replace(SRC, 'src'))).toEqual([]);
  });
});

describe('CLASE R — `ShippedRefundReason` (💰 v1.80.8.6, M-62, §M4-SHIP.18.12): «solo no llegó o llegó en mala condición»', () => {
  // PROJECT §S.11.4 / HECHOS 2026-10-02 (SSL-R1). La lista es la REGLA del dueño, no un espejo del enum.
  it('lista EXACTA: `not_arrived` y `arrived_damaged`, y nada más', () => {
    expect([...ACCEPTED_SHIPPED_REFUND_REASONS]).toEqual(['not_arrived', 'arrived_damaged']);
  });

  it('SUBCONJUNTO del enum de Prisma (la regla no acepta lo que la BD no sabe guardar)', () => {
    const schemaValues = Object.values(ShippedRefundReason) as string[];
    for (const v of ACCEPTED_SHIPPED_REFUND_REASONS) expect(schemaValues).toContain(v);
    expect(ACCEPTED_SHIPPED_REFUND_REASONS.length).toBeLessThanOrEqual(schemaValues.length);
  });

  it('ningún DTO/servicio deriva el dominio del enum (`Object.values(ShippedRefundReason)` fuera de las pruebas)', () => {
    const offenders: string[] = [];
    const walkSrc = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) walkSrc(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
          if (/Object\.values\(\s*ShippedRefundReason\s*\)/.test(stripComments(readFileSync(p, 'utf8')))) offenders.push(p);
        }
      }
    };
    walkSrc(join(__dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('residuo — ninguna lista literal de estos enums sobrevive en `src/`', () => {
  const SRC = join(__dirname, '..', 'src');

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
    });
  }

  /**
   * Detecta un array/`IsIn`/`Set` literal que enumere ≥2 valores del enum. No basta con buscar `'upc'`:
   * lo que delata el patrón es **varios valores del mismo enum juntos**, que es una lista escrita a mano.
   */
  function offenders(values: readonly string[]): string[] {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      // `H3-d`: mismo `stripComments` que el candado de arriba. Éste ya quitaba `//` (por eso era «el
      // hermano bueno»), pero NO el comentario de bloque — y la prosa larga de este repo vive en
      // bloques. Unificarlos deja UNA definición de «esto es código», que es la misma lección que el
      // helper de enums: una conducta en dos sitios son dos conductas esperando a divergir.
      //
      // ⭐ Y al unificarlas, la ÚLTIMA lista blanca del fichero se quedó sin trabajo. Aquí decía
      //   `if (f.endsWith(join('common','enum-values.ts'))) continue; // ahí VIVE la declaración`
      // y era falso: lo que vive ahí en CÓDIGO es `Object.values(SealedSubtype)`, que no tiene ni un
      // literal y por tanto este detector nunca lo vio. Lo que lo disparaba era la **tabla de su
      // docstring** (`box etb bundle tin blister upc collection`). Medido al quitarla: **30/30
      // verdes**. Este fichero ya no exime a NADIE por su nombre.
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const line of src.split('\n')) {
        const code = line;
        if (!/\[|new Set/.test(code)) continue;
        const found = values.filter((v) => new RegExp(`['"\`]${v}['"\`]`).test(code));
        if (found.length >= 2) hits.push(`${f.replace(SRC, 'src')} :: ${line.trim().slice(0, 90)}`);
      }
    }
    return hits;
  }

  it('SealedSubtype: cero listas a mano (había OCHO)', () => {
    expect(offenders(SEALED_SUBTYPE_VALUES)).toEqual([]);
  });

  it('SealedCondition: cero listas a mano', () => {
    expect(offenders(SEALED_CONDITION_VALUES)).toEqual([]);
  });

  it('Finish, ProductType, GradingCompany y AcquisitionType: cero listas a mano', () => {
    expect(offenders(FINISH_VALUES)).toEqual([]);
    expect(offenders(PRODUCT_TYPE_VALUES)).toEqual([]);
    expect(offenders(GRADING_COMPANY_VALUES)).toEqual([]);
    expect(offenders(ACQUISITION_TYPE_VALUES)).toEqual([]);
  });

  /**
   * ⭐ `D-EQ-2` (v1.73) — **este detector encontró una copia que NADIE había nombrado.**
   *
   * El encargo traía tres enums que derivar (`?reason=`, `?context=`, `?origin=`). Al añadirlos al
   * detector de residuo apareció una **CUARTA** copia de `SealedGroupKind` que no estaba en ninguna
   * ficha: `@IsIn(['set_main','promo_collection'])` en el DTO de
   * `POST /admin/inventory/sealed-sets/:setId/groups` (`inventory/dto/inventory.dto.ts`). No era de
   * §0-Q —es **cuerpo**, no query (§0-Q punto 7)— pero sí de §4.37, y es el mismo mecanismo que dejó
   * a `upc`/`collection` fuera de ocho listas: *el que deriva el filtro y no el alta cierra la mitad
   * del bug y deja la otra esperando*.
   *
   * ⚠️ `PendingPriceContext` entra aquí aunque sus valores (`catalog`, `portfolio`, `buylist`,
   * `inventory`) son palabras comunes: medido el 2026-09-13, **cero falsos positivos** en `src/`. Si
   * mañana alguien escribe `['catalog','inventory']` para otra cosa, el rojo es legítimo — se resuelve
   * nombrando la constante, no apagando el detector.
   */
  it('`D-EQ-2` — PendingPriceReason, PendingPriceContext y SealedGroupKind: cero listas a mano', () => {
    expect(offenders(PENDING_PRICE_REASON_VALUES)).toEqual([]);
    expect(offenders(PENDING_PRICE_CONTEXT_VALUES)).toEqual([]);
    expect(offenders(SEALED_GROUP_KIND_VALUES)).toEqual([]);
  });
});
