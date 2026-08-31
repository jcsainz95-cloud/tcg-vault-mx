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
 * Cerrojo de compilación: si la proyección deja de producir el `OrderItemCardDTO` del contrato
 * (p. ej. alguien borra `imageSmallUrl` o cambia su tipo), esto **no compila**. Es el guardián que
 * faltaba cuando el retorno era `object`.
 */
export type ResolvedIsContractShape = OrderItemCardDTO extends ReturnType<
  typeof resolveOrderItemCard<FrozenCardFacts>
>
  ? true
  : never;
export const RESOLVED_IS_CONTRACT_SHAPE: ResolvedIsContractShape = true;

/**
 * Lee los hechos congelados de la columna `Json` sin re-derivar nada. Un blob ausente o con forma
 * inesperada (no-objeto) rinde `{}`: se sirve lo que haya, jamás un hecho inventado.
 */
export function readFrozenCardFacts(value: Prisma.JsonValue | null | undefined): PersistedCardFacts {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as PersistedCardFacts;
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
