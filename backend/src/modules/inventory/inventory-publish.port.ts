import { Finish, ProductType } from '@prisma/client';

/**
 * `inventory-publish.port.ts` (v1.51.18, **BL-25**, ARCHITECTURE §4.39m.5) — **el disparo de
 * publicación que cruza de fuera hacia `inventory`.**
 *
 * ### ⚠️⚠️ NO ES UN PUERTO DE ESCRITURA: ES UN PUERTO DE **DISPARO**
 * El llamador dice ***«estas piezas pudieron cambiar: REEVALÚALAS»***, **jamás «publícalas»**. Por eso
 * la firma **no acepta estado destino, ni precio, ni `status`**: no hay nada que un llamador pueda
 * pasar que altere la decisión. La decisión y la escritura ocurren **enteras dentro de `inventory`**,
 * detrás de su pipeline de siempre (`assertPublishableGuards` + `resolvePublishSalePrice` +
 * `claimListed`).
 *
 * **Eso PRESERVA el dictamen de §4.39f en vez de romperlo.** Lo que cruza la frontera es una
 * **notificación**, no una **autoridad**: un llamador con un bug —o malicioso— **no puede publicar una
 * pieza impublicable**, porque las guardas están del otro lado. *No se exporta la capacidad de
 * escribir inventario; se exporta la capacidad de PEDIRLE a `inventory` que haga su trabajo.*
 *
 * ### UN CUERPO, DOS ENTRADAS (v1.51.19, §4.39m.8)
 * Los dos disparadores hacen **la misma pregunta** —*«¿esto ya se puede publicar?»*—; lo que difiere
 * es **la CAUSA, no la petición**. Por eso hay **un solo cuerpo** de intento de publicación.
 *
 * Pero **el disparador (c) NO PUEDE nombrar piezas**: cuando el precio de una variante se vuelve
 * resoluble, quien lo sabe (`pricing`) conoce **una clave de variante**, no ids de inventario. De ahí
 * la **segunda entrada**, `reevaluateVariantsForPublication`, que **resuelve la clave a ids y
 * desemboca en el MISMO cuerpo**. *Es un ADAPTADOR delante del cuerpo único, no una copia* — lo que
 * la regla protegía (dos implementaciones del intento de publicación) **sigue sin ocurrir**.
 *
 * ⚠️ **Y la resolución vive DENTRO de `inventory`, no en el llamador.** `gradeKey` **no es columna de
 * `InventoryItem`**: se deriva de `productType`/`rawCondition`/`gradingCompany`/`gradeValue`. Un
 * `where` que la reconstruyera sería **una segunda definición de la clave de variante dentro de una
 * consulta**, sobre el mismo dinero — *una copia de la regla, no la salida de la regla* (§4.39m.6).
 * Se filtra **en memoria**, con la función de su dueño, del lado de `inventory`. **Ni SQL ni DDL.**
 *
 * ### Forma
 * **En lote** (ids de pieza **o** claves de variante), **idempotente**, y **sin efecto sobre lo no
 * publicable**: llamarlo de más es un **no-op**. Devuelve **qué pasó por pieza**, para que el llamador
 * pueda registrar el resultado **sin re-derivar** la regla.
 *
 * ⚠️ **El lote no es un detalle de rendimiento: es lo que disuelve el fan-out.** El barrido de precios
 * pasa **el conjunto que REALMENTE cambió en UNA llamada**, nunca N llamadas ni «todas las variantes
 * del set» — *repreciar algo que no se movió no vuelve publicable a nadie*. El troceado, si hace
 * falta, es **del job** (§4.15c: robusto, idempotente, reanudable), y **un trozo perdido cae en
 * `pending-publish`**.
 *
 * ### ⚠️ Best-effort, y la ÚNICA razón que lo sostiene — hay que leerla porque es la que lo sostiene
 * Se invoca **post-commit** y su fallo **no revierte nada**: *la conversión NO puede fallar porque la
 * publicación falle* — bloquear el pago al vendedor porque no pudimos poner una carta a la venta
 * invierte las prioridades (mismo argumento que hace opcional la ubicación, §4.39m.3).
 *
 * Eso es aceptable **solo** porque **un disparo perdido no deja la pieza invisible: la deja en
 * `GET /admin/inventory/pending-publish`**, que es una cola que un operador trabaja.
 * **⚠️ LA COLA ES LA RED ⇒ `pending-publish` NO SE RETIRA NI SE ESTRECHA SIN SUSTITUIR LA RED.** *El
 * día que alguien «optimice» esa cola, este puerto pasa a ser **fail-silent sobre inventario pagado y
 * no vendible** — que es exactamente el defecto INV-P1 que la fase 8 vino a cerrar.*
 *
 * ⚠️ **Contraste con `INVENTORY_POSITION_PORT`, que NO es best-effort:** allí el fallo produce
 * `position: null` + `positionUnavailable: true` porque **no hay red** — un `0` inventado empujaría a
 * comprar de más. *No se copia la conducta de un puerto al otro por analogía: se copia la pregunta
 * «¿qué pasa si esto se pierde?».*
 *
 * ### Consumidores: DOS, y solo dos
 * `buylist` (disparador **a**, al convertir) y `pricing` (disparador **c**, cuando el precio se vuelve
 * resoluble). ⛔ **El disparador (b) —fijar/mover ubicación— NO usa el puerto**: es una operación de
 * `inventory` **sobre sí mismo**, y meterla por aquí sería darle la vuelta al módulo **para llamar a
 * su propia puerta**.
 *
 * ### ⚠️⚠️ EL CONSUMIDOR DE (c) TIENE QUE SER UNA **HOJA** DEL GRAFO — NUNCA `PricingService`
 * `InventoryService` **ya depende de `PricingService`**. Un `PricingService` que consumiera este
 * puerto cerraría **`Pricing → PORT → Inventory → Pricing`**. ⛔ **Y `forwardRef` está PROHIBIDO para
 * esto**: *un ciclo que se «arregla» con `forwardRef` sigue siendo un ciclo*, y aquí además **uniría
 * los dos módulos de dinero** justo por la frontera que §4.39f existe para mantener abierta.
 * Los consumidores válidos son **hojas**: el **job/servicio de ingesta** del barrido y el **handler
 * del override** de M2.
 *
 * Lo **declara y provee `inventory`** (dueño del dato), igual que el de posición. *Dos puertos, dos
 * direcciones, una regla: el que sabe hacer el trabajo lo expone; el que lo necesita lo pide.*
 */
export const INVENTORY_PUBLISH_PORT = 'INVENTORY_PUBLISH_PORT';

/**
 * Qué pasó con UNA pieza en la reevaluación. Es **informativo**: el llamador lo registra, no decide
 * con ello — si decidiera, la autoridad habría cruzado la frontera igual.
 *
 * - `published` — pasó el pipeline completo y quedó `listed`.
 * - `already_listed` — ya estaba a la venta; el disparo fue un no-op (idempotencia).
 * - `missing_location` — sin ubicación: no se publica **y no se escala nada** (el hueco es de
 *   captura, no de mercado; escalar ensuciaría la cola de M2 con piezas cuyo precio sí resuelve).
 * - `price_pending` — sin precio resoluble. **Escaló a la cola de M2** ⇒ es un *pendiente visible*.
 * - `not_publishable` — status de origen no publicable, no es de plataforma, o perdió una carrera
 *   contra un checkout. **Correcto y esperado**; nunca se fuerza.
 * - `not_found` — la pieza no existe (llamada tardía o id inválido).
 */
export type PublishReevaluationOutcome =
  | 'published'
  | 'already_listed'
  | 'missing_location'
  | 'price_pending'
  | 'not_publishable'
  | 'not_found';

export interface PublishReevaluationResult {
  inventoryItemId: string;
  outcome: PublishReevaluationOutcome;
  /** Lo que le falta, con el MISMO vocabulario que `pending-publish` (§11): una sola forma de decirlo. */
  missing: ('location' | 'price')[];
  /** Deep-link a la cola de precio pendiente de M2, cuando el disparo la abrió o la encontró abierta. */
  pendingPriceEntryId?: string;
}

/**
 * Identidad de la VARIANTE cuyo precio pudo volverse resoluble (§4.39m.8). Es la clave que conoce
 * `pricing`; **traducirla a piezas es trabajo de `inventory`**.
 *
 * ⚠️ `cardProductId` va incluido porque **una promo y la versión del set base son variantes
 * distintas** (D7 / §4.39d): resolver el precio de una **no** vuelve publicable a la otra.
 */
export interface VariantPublishRef {
  cardId: string;
  productType: ProductType;
  /** Clave DERIVADA en inventario (`buildGradeKey`); aquí llega tal cual la conoce `pricing`. */
  gradeKey: string;
  finish: Finish;
  /**
   * ⚠️⚠️ **TRES ESTADOS, y el `undefined` NO es `null`:**
   * - **ausente (`undefined`) ⇒ SIN RESTRICCIÓN** (cualquier producto de esa carta/acabado).
   * - **`null` ⇒ SOLO la variante del set base.**
   * - **número ⇒ solo ESE producto.**
   *
   * ⚠️⚠️ **Y AQUÍ HAY UNA TRAMPA REAL, verificada en el schema: `cardProductId` tiene DOS
   * IDENTIFICADORES DISTINTOS en este repo.**
   * - `InventoryItem.cardProductId` y `PendingPriceEntry.cardProductId` son **`Int`** = el
   *   **`tcgplayerProductId`**.
   * - `PriceReference.cardProductId` es **`String`** = el **uuid de `CardProduct`** (FK).
   *
   * **Este campo es el PRIMERO (el `Int` de TCGplayer)**, porque es contra lo que se empareja el
   * inventario. Un llamador que pasara el uuid de `PriceReference` **no casaría con nada** y el
   * disparo sería un **no-op silencioso que parece funcionar**. *Si no tienes el identificador
   * correcto, OMITE el campo* —sin restricción es la dirección segura: un disparo de más es un
   * no-op, uno de menos es una carta que se queda en la caja.
   */
  cardProductId?: number | null;
  /** Mismos tres estados. `InventoryItem.sealedProductId` es el uuid de `SealedProduct`. */
  sealedProductId?: string | null;
}

export interface InventoryPublishPort {
  /**
   * ⚠️ **«Reevalúa estas piezas», no «publícalas».** Sin estado destino, sin precio, sin `status`.
   * Idempotente, en lote y **best-effort desde el punto de vista del llamador**: no lanza por una
   * pieza — el resultado por pieza es la respuesta.
   */
  reevaluateForPublication(inventoryItemIds: string[]): Promise<PublishReevaluationResult[]>;

  /**
   * ⚠️ **Segunda ENTRADA al MISMO cuerpo** (§4.39m.8) — para el disparador (c), que **no puede
   * nombrar piezas**: solo conoce claves de variante. Resuelve las claves a ids **dentro de
   * `inventory`** (SELECT por las partes columnares + filtro en memoria por `gradeKey` derivado) y
   * llama a `reevaluateForPublication`.
   *
   * Sigue siendo un **disparo**: el llamador tampoco aquí puede expresar estado destino ni precio.
   * Devuelve el resultado **por pieza resuelta** — una variante sin piezas `in_stock` no produce
   * filas, que es el no-op esperado.
   */
  reevaluateVariantsForPublication(
    variants: VariantPublishRef[],
  ): Promise<PublishReevaluationResult[]>;
}
