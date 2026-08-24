import {
  AcquisitionType,
  Finish,
  GradingCompany,
  Locale,
  ProductType,
  RawCondition,
  SealedCondition,
  SealedSubtype,
} from '@prisma/client';

/**
 * enum-values.ts — **los valores de cada enum, DERIVADOS del schema. Se declaran UNA vez.**
 *
 * ### Por qué existe (v2.1.8 — el dueño vende UPC y no podía)
 * `SealedSubtype` tiene **siete** valores en el schema (`box etb bundle tin blister upc collection`),
 * pero había **ocho listas de cinco escritas a mano**, y `upc`/`collection` quedaron fuera de todas.
 * El efecto no fue uniforme, y ahí está lo instructivo:
 *
 * | sitio | efecto |
 * |---|---|
 * | `@IsIn` del catálogo público | filtrar por UPC ⇒ **400** |
 * | `validateEnum` del catálogo de sellado | mismo rechazo |
 * | filtro de la **bóveda** | **el filtro se ignora en SILENCIO**: el cliente pide sus UPC y recibe todo su sellado |
 * | `@IsIn` del alta de inventario (×4) | **no se podía ni capturar** una pieza UPC |
 * | `SEALED_SUBTYPE_KEYS` de spreads | **422**: el dueño no puede calibrar el spread de UPC ⇒ cae al fallback del 25 % |
 *
 * El de la bóveda es el peor: **no falla, MIENTE**. «Se ignoran silenciosamente los valores que no
 * matchean» es un diseño correcto para basura desconocida — pero aquí el valor **existe en el
 * schema**, así que el silencio escondía un bug en vez de tolerar entrada inválida. Y el de spreads
 * es dinero: un UPC es pieza grande, comparable a una box (18 %) o un ETB (22 %), y estaba saliendo
 * al 25 % sin que el dueño pudiera ajustarlo.
 *
 * ### Por qué DERIVAR y no «añadir dos strings»
 * Añadir `upc`/`collection` a ocho listas cierra **este** bug y **deja la clase abierta**: el próximo
 * valor del enum se cae por el mismo agujero. Derivarlo del enum de Prisma —que es el espejo del
 * schema— convierte una disciplina en algo que **la máquina sostiene**, igual que el candado de
 * arquitectura del eje de venta o el tipo opaco `DisplayBp`.
 *
 * Prisma genera para cada enum un objeto en RUNTIME además del tipo, así que `Object.values(...)` es
 * la lista canónica y no puede desincronizarse del schema por construcción.
 *
 * ### ⚠️ Estas listas son el enum COMPLETO
 * Solo va aquí lo que debe ser **todo** el enum. Un `@IsIn` que a propósito acepta un **subconjunto**
 * (p. ej. `UserStatus` en `PATCH /admin/users/:id/status`, que acepta `active|blocked` pero **no**
 * `deleted`, porque ese lo fija el `DELETE`) **NO** se deriva de aquí: se deja explícito en su sitio,
 * porque su lista es una **decisión de producto**, no un espejo del schema. Confundir las dos cosas
 * haría que derivar rompiera una regla de negocio.
 */

/** Los 7 subtipos de producto sellado. */
export const SEALED_SUBTYPE_VALUES = Object.values(SealedSubtype);

/** Condición del sellado (`mint` | `minor_box_damage`). */
export const SEALED_CONDITION_VALUES = Object.values(SealedCondition);

/** Acabados de una carta (identidad de variante, §4.22). */
export const FINISH_VALUES = Object.values(Finish);

/** `raw` | `graded` | `sealed`. */
export const PRODUCT_TYPE_VALUES = Object.values(ProductType);

/** Condiciones de carta suelta (hoy solo `NM`). */
export const RAW_CONDITION_VALUES = Object.values(RawCondition);

/** Graduadoras soportadas. */
export const GRADING_COMPANY_VALUES = Object.values(GradingCompany);

/** Origen de una pieza en el inventario. */
export const ACQUISITION_TYPE_VALUES = Object.values(AcquisitionType);

/** Idiomas de la plataforma. */
export const LOCALE_VALUES = Object.values(Locale);
