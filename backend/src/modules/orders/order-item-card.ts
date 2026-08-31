import { GradingCompany, Prisma, ProductType, RawCondition } from '@prisma/client';

/**
 * §5.2 (ARCHITECTURE, v1.51-b) — DOCTRINA DEL SNAPSHOT CONGELADO, en tipos.
 *
 * Este archivo declara la forma que durante meses viajó como `object` / `"card": {}`: un blob sin
 * forma en el backend y un `CardDTO` mentiroso en el front. Esa grieta —y no «una línea olvidada»—
 * es la causa raíz del hueco gris de la miniatura. Aquí se cierra: la clase (F) y la clase (P)
 * quedan en tipos distintos, y el compilador puede cazar la próxima divergencia.
 *
 *  - clase (F) HECHO CONGELADO  → `FrozenCardFacts`  → SE PERSISTE en `OrderItem.cardSnapshot`.
 *  - clase (P) PRESENTACIÓN     → `imageSmallUrl`    → NO se persiste; se resuelve EN LECTURA.
 */

/**
 * Clase (F) — los OCHO hechos de la compra que se congelan en `OrderItem.cardSnapshot` al cobrar.
 * **Es exactamente lo que hoy se persiste; esta declaración NO cambia el contenido del JSON.**
 *
 * ⛔ **Prohibido añadir aquí cualquier campo de PRESENTACIÓN** (imagen, arte, etiquetas legibles,
 * traducciones). Si el campo nuevo responde «se ve distinto» a la pregunta de §5.2.2, no es (F):
 * va a la proyección de lectura de abajo. En particular **`imageSmallUrl` NO pertenece a este
 * tipo** — congelar una URL de un CDN de tercero congela una cadena, no unos bytes (§5.2.3-3).
 *
 * Los tipos reflejan la realidad de las columnas de origen (`InventoryItem`): `rawCondition`,
 * `gradingCompany` y `gradeValue` son nullables en BD y se congelan tal cual (`null` en las líneas
 * que no aplican); `setName` es `undefined` si la carta no tenía set al congelar.
 */
export type FrozenCardFacts = {
  cardId: string;
  name: string;
  setName?: string;
  number: string;
  productType: ProductType;
  rawCondition?: RawCondition | null;
  gradingCompany?: GradingCompany | null;
  gradeValue?: string | null;
};

/**
 * Lo que se LEE de la columna JSON de una orden ya cobrada. Es `Partial` a propósito: el histórico
 * lo escribieron versiones anteriores del código y `Json` no garantiza esquema. Ninguna clave se
 * inventa ni se re-deriva (§5.2.4: «el pedido dice lo que decía cuando se pagó»).
 */
export type PersistedCardFacts = Partial<FrozenCardFacts>;

/**
 * `OrderItemCardDTO` (API_CONTRACT §4, v1.51-b) — la forma que viaja POR EL CABLE en las tres
 * superficies de líneas de compra (`POST /checkout/quote`, `POST /checkout/guest/quote`,
 * `GET /orders/:orderId`). Vive SOLO en memoria: no es lo que se persiste.
 *
 * **NO es un `CardDTO`**: sin `id`, `externalId`, `imageLargeUrl`, `rarity`, `supertype`,
 * `availableFinishes`… Son los 8 hechos congelados + `imageSmallUrl` resuelta.
 */
export type OrderItemCardDTO = FrozenCardFacts & { imageSmallUrl: string | null };

/**
 * ⛑️ **T-2 (v1.51-e) — la forma de la TERCERA superficie, `GET /orders/:orderId`, DECLARADA.**
 *
 * Las dos cotizaciones cruzan `toOrderItemPreviews(...)`, con retorno anotado. El HISTÓRICO —que es la
 * superficie con la garantía **más débil**, porque lee de una columna `Json` que escribieron versiones
 * anteriores del código— era la única que proyectaba EN LÍNEA, dentro de un `return` de ~25 claves y
 * sin anotación: su tipo real era inferido y no se contrastaba con nada.
 *
 * Este alias es esa frontera, dicha con exactitud: **`PersistedCardFacts`** (o sea `Partial`, porque un
 * blob histórico puede no traer las ocho claves) **+ `imageSmallUrl` siempre presente**, que es lo único
 * que la lectura sí puede garantizar porque lo resuelve ella misma.
 *
 * **M-2 (QA, v1.51-e):** el alias se llamaba `HistoricOrderItemCardDTO` y el contrato v1.51-c lo nombra
 * `HistoricalOrderItemCardDTO`. Divergencia puramente nominal (§5.2.9 lo marca opcional/sin puerta), pero
 * un nombre que no existe en el contrato hace que quien lo busque no lo encuentre. Alineado.
 *
 * ⚠️ **No es `OrderItemCardDTO`, y esa diferencia es DELIBERADA, no un descuido**: el contrato describe
 * las ocho claves como presentes, y para el histórico incompleto eso solo se puede prometer con una
 * tolerancia que **norma el arquitecto** (T-3, ya enrutado — regla 9). Aquí se declara lo que el código
 * de verdad produce; no se ensancha el contrato por cuenta propia ni se finge una garantía que la
 * columna no da.
 */
export type HistoricalOrderItemCardDTO = PersistedCardFacts & { imageSmallUrl: string | null };

/** Lo MÍNIMO que hace falta de la fila `Card` para resolver la clase (P). Nada más se consulta. */
export type CardImageSource = { imageSmallUrl: string | null };

/** `select` canónico de la consulta batcheada. Exportado para que no se reinvente por ahí. */
export const CARD_IMAGE_SELECT = { id: true, imageSmallUrl: true } as const;

/**
 * §5.2.5 — LA regla de resolución, en un solo cuerpo. Un único camino: `imageSmallUrl` **jamás**
 * se lee del JSON (ni aunque algún día alguien la escriba ahí); siempre sale de la fila `Card`
 * unida por el `cardId` congelado.
 *
 * `null` es un RESULTADO LEGÍTIMO (la fila `Card` ya no existe, o su columna `String?` es nula):
 * el front pinta su placeholder, no es error y no bloquea nada. La clave está **SIEMPRE presente**
 * (shape estable, misma norma que `unavailableItems: []`).
 *
 * ⛔ Nunca inventar la URL por plantilla ni derivarla del `externalId`: solo se sirve lo que la
 * columna contenga.
 */
export function resolveOrderItemCard<F extends PersistedCardFacts>(
  facts: F,
  card: CardImageSource | null | undefined,
): F & { imageSmallUrl: string | null } {
  return { ...facts, imageSmallUrl: card?.imageSmallUrl ?? null };
}

/**
 * **IGUALDAD de tipos, invariante y en las dos direcciones.** `A extends B ? 1 : 2` comparado consigo
 * mismo dentro de una función genérica es la forma canónica de preguntar «¿A y B son EL MISMO tipo?»
 * sin que la asignabilidad (que es unidireccional y tolerante) conteste que sí por la puerta de atrás.
 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : never;

/**
 * ⛑️ **T-1 (v1.51-e) — CERROJO DE COMPILACIÓN, ahora de verdad.**
 *
 * ### Lo que había, y por qué era peor que nada
 * La aserción era `OrderItemCardDTO extends ReturnType<…>`: **asignabilidad en UNA sola dirección**.
 * El comentario juraba que «si alguien borra `imageSmallUrl` o cambia su tipo, esto no compila», y el
 * techlead enumeró tres formas de romperlo sin que se enterase: **borrar** la clave compila, hacerla
 * **opcional** compila, y **ensancharla** a `string | null | undefined` compila. Solo cazaba el
 * estrechamiento y las propiedades extra. Un guardián que no guarda, con un comentario que jura que sí,
 * es peor que no tenerlo: el siguiente mantenedor confía y no mira.
 *
 * ### Lo que hay ahora, dicho exactamente
 * `Equals<A, B>` es **igualdad de tipos**, no asignabilidad, así que la aserción cubre:
 *  · que la proyección produzca **todas** las claves de `OrderItemCardDTO` y **ninguna de más**;
 *  · que `imageSmallUrl` exista, sea **requerida** (no opcional) y tenga **exactamente**
 *    `string | null` (ni estrechada a `string`, ni ensanchada con `undefined`).
 *
 * Las tres roturas del techlead se comprobaron una a una contra este helper: las tres NO compilan.
 * Lo que este cerrojo **no** cubre —y no se afirma que cubra— es lo que viaja por el cable en tiempo de
 * ejecución: eso lo fijan los tests de las tres superficies, no el compilador.
 */
export type ResolvedIsContractShape = Equals<
  OrderItemCardDTO,
  ReturnType<typeof resolveOrderItemCard<FrozenCardFacts>>
>;
export const RESOLVED_IS_CONTRACT_SHAPE: ResolvedIsContractShape = true;

/**
 * T-2 — el MISMO cerrojo para la superficie del histórico: `HistoricalOrderItemCardDTO` tiene que ser
 * EXACTAMENTE lo que `resolveOrderItemCard` produce leyendo un blob `Partial`. Con esto las **tres**
 * superficies de líneas de compra cruzan una frontera declarada y verificada por el compilador.
 */
export type HistoricalIsResolvedShape = Equals<
  HistoricalOrderItemCardDTO,
  ReturnType<typeof resolveOrderItemCard<PersistedCardFacts>>
>;
export const HISTORICAL_IS_RESOLVED_SHAPE: HistoricalIsResolvedShape = true;

/**
 * ⛑️ **I1 — LA ALLOWLIST de los OCHO hechos, en un solo lugar.**
 *
 * Es la lista de claves que `readFrozenCardFacts` deja pasar de la columna `Json` hacia la respuesta.
 * `as const` + el cerrojo de abajo la atan a `FrozenCardFacts`: si alguien añade un noveno hecho al
 * tipo y olvida esta lista (o al revés), **no compila**.
 */
export const FROZEN_CARD_FACT_KEYS = [
  'cardId',
  'name',
  'setName',
  'number',
  'productType',
  'rawCondition',
  'gradingCompany',
  'gradeValue',
] as const;

/**
 * Cerrojo de compilación de la allowlist: las claves listadas son **exactamente** las de
 * `FrozenCardFacts`, ni una de menos (se dejaría de servir un hecho real) ni una de más.
 */
export type AllowlistIsFrozenFactKeys = Equals<
  (typeof FROZEN_CARD_FACT_KEYS)[number],
  keyof FrozenCardFacts
>;
export const ALLOWLIST_IS_FROZEN_FACT_KEYS: AllowlistIsFrozenFactKeys = true;

/**
 * Lee los hechos congelados de la columna `Json` sin re-derivar nada. Un blob ausente o con forma
 * inesperada (no-objeto) rinde `{}`: se sirve lo que haya, jamás un hecho inventado.
 *
 * ⛑️ **I1 (QA) — PROYECCIÓN por allowlist, no `passthrough`.** Antes esto era
 * `return value as PersistedCardFacts`: **lo que hubiera en la columna `Json` salía verbatim por el
 * cable**. Hoy el write path escribe exactamente ocho claves, así que no había fuga observable — pero
 * era un passthrough sin filtro desde un registro **dinero-adyacente** hacia una respuesta HTTP cuya
 * forma fija el contrato (§4). Un blob con `internalCostCents` o `__note` (escrito por un script, una
 * migración o una versión futura) se habría servido tal cual.
 *
 * **Por qué esto NO es «rellenar» (§5.2.2 / §5.2.9):** la doctrina prohíbe **completar lo ausente** —
 * inventar un hecho que el acta no registró. Aquí no se añade nada: se **proyecta** lo presente sobre
 * la forma declarada. Filtrar refuerza la doctrina, no la contradice.
 *
 * **Allowlist explícita, jamás un `omit` de lo conocido:** un `omit` falla **abierto** (una clave nueva
 * e imprevista pasaría); una allowlist falla **cerrada**.
 *
 * ⚠️ **`null` ≠ ausente se conserva intacto** (§5.2.9 / contrato §4): se copia la clave **si existe en
 * el blob**, con su valor tal cual — `rawCondition: null` sigue viajando como `null` con la clave
 * presente, y un `setName` que el blob no trae sigue **omitido**. La proyección no crea claves.
 */
export function readFrozenCardFacts(value: Prisma.JsonValue | null | undefined): PersistedCardFacts {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  const blob = value as Record<string, unknown>;
  const facts: Record<string, unknown> = {};
  for (const key of FROZEN_CARD_FACT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(blob, key)) facts[key] = blob[key];
  }
  return facts as PersistedCardFacts;
}

/**
 * §5.2.5 — los `cardId` DISTINTOS de una respuesta, para UNA sola consulta batcheada (prohibido el
 * N+1). Descarta los blobs sin `cardId` utilizable: esos resuelven a `imageSmallUrl: null`.
 */
export function distinctCardIds(facts: PersistedCardFacts[]): string[] {
  return [
    ...new Set(
      facts
        .map((f) => f.cardId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
}
