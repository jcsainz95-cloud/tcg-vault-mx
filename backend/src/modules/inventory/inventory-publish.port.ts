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
 * ### Un método, no dos
 * Los dos disparadores hacen **la misma pregunta** —*«¿esto ya se puede publicar?»*—; lo que difiere
 * es **la CAUSA, no la petición**. Dos métodos serían **dos caminos hacia adentro**, y el segundo
 * nacería copiando al primero.
 *
 * ### Forma
 * **En lote** (ids de pieza), **idempotente**, y **sin efecto sobre lo no publicable**: llamarlo de
 * más es un **no-op**. Devuelve **qué pasó por pieza**, para que el llamador pueda registrar el
 * resultado **sin re-derivar** la regla.
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

export interface InventoryPublishPort {
  /**
   * ⚠️ **«Reevalúa estas piezas», no «publícalas».** Sin estado destino, sin precio, sin `status`.
   * Idempotente, en lote y **best-effort desde el punto de vista del llamador**: no lanza por una
   * pieza — el resultado por pieza es la respuesta.
   */
  reevaluateForPublication(inventoryItemIds: string[]): Promise<PublishReevaluationResult[]>;
}
