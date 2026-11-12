# API_CONTRACT_ALTA_LIGA.md — anexo de API_CONTRACT.md (UX-ALTA-LIGA-2, opción A; HECHOS 2026-11-12)

Convenciones de `API_CONTRACT.md` §0 y §IDS (`/api/v1`, centavos MXN, errores `{error:{code,message,details}}`, `Idempotency-Key` opcional). Zona `inventory` ⇒ gates qa + seguridad-lead + tester-e2e. Detalle de decisión: `docs/DECISIONES.md` §ALTA-LIGA-2.

## 1. Qué cambia para el dueño
En el panel de alta rápida (`VariantDrawer`/`QuickAddSection`), la fila «Versión» ofrece siempre «+ Versión de liga». Elige tipo de sello, etiqueta opcional y acabado; la versión nace y queda seleccionada. Idioma sigue en su fila de siempre (no es parte del producto).

## 2. Crear versión de liga manual
**POST `/admin/inventory/cards/:cardId/versions`** · staff (`vault_operator` o `super_admin`, mismo permiso que `attach`).
Request: `{ stampType: "prize_pack"|"league"|"championship"|"prerelease"|"staff"|"event_promo", stampLabel?: string, finish: "normal"|"reverse_holo"|"holofoil"|"first_edition_holofoil" }`
- `stampLabel`: opcional, se recorta, 1..40 caracteres, sin control ni HTML; null/vacío ⇒ sin etiqueta. Llave de duplicado = `(cardId, stampType, etiqueta normalizada: minúsculas, sin acentos, espacios colapsados)`.
- Idioma NO viaja aquí: es propiedad de la pieza (`language` del alta), las combinaciones EN/ES se generan solas.
Response 201 (nueva) o 200 (ya existía o se amplió el acabado):
`{ created: boolean, finishAdded: boolean, stamp: {type, label|null, productId:int(<0), manual:true}, finishes: Finish[], combos: VersionComboDTO[] /* solo las de este stamp */ }`
Reglas:
1. **Producto**: `CardProduct kind=stamped` con `tcgplayerProductId` sintético NEGATIVO (secuencia `manual_product_id_seq`, decrece desde -1; nunca choca con TCGCSV). Manual ⇔ `productId < 0`; sin columna nueva. `sourceGroupId` null. Migración aditiva: la secuencia y la unicidad de la llave; si el índice por expresión con acentos no es viable, columna nullable `CardProduct.stampLabelNorm` + índice único parcial `(cardId, stampType, coalesce(stampLabelNorm,''))` WHERE `tcgplayerProductId < 0` (decide backend; única excepción a «sin columna nueva»).
2. **Idempotencia / duplicados**: misma llave ⇒ misma versión (200 `created:false`); si el acabado es nuevo se AÑADE a `finishes` (`finishAdded:true`). Doble clic o dos operadores a la vez: advisory lock por llave + índice único; nunca dos productos.
3. **Guardia contra duplicar lo real**: si la carta ya tiene candidata o producto real (productId>0) del mismo `stampType` ⇒ 409 `USE_EXISTING` con `details.candidates|stamps` (la UI las ofrece/ata con el `attach` de siempre).
4. **Precio (HECHOS 2026-11-12)**: mientras el producto no tenga `PriceReference` propia, la VENTA de cualquier pieza de esa versión = precio de la carta normal (sin sello) del mismo idioma y acabado; la COMPRA sugerida = `buySuggestedCents` de esa combinación normal (**por confirmar por el dueño**). Se resuelve en UN solo punto del decisor de precios (`sale-decision`), para que el panel, el cajón, el catálogo y el checkout vean la misma cifra. Si la carta normal tampoco tiene mercado ⇒ `unavailableReason:"no_market"` y `PRICE_PENDING` como hoy. No toca ningún precio existente.
5. **Límites**: ≤ 20 altas manuales por usuario por hora (429 `RATE_LIMITED`).
Errores: 404 `CARD_NOT_FOUND`; 400 `VALIDATION_ERROR` (`details.field`); 422 `FINISH_NOT_AVAILABLE` (acabado fuera de los de la carta); 409 `USE_EXISTING`; 403 si `customer`/`supplier`; 429.
Auditoría: `AuditLog` `inventory.manual_version_created` / `inventory.manual_version_finish_added` con `{actorId, cardId, productId, stampType, label, finish}`.

## 3. Cómo aparece en `GET /admin/inventory/cards/:cardId/versions`
Respuesta actual (`combos`, `candidates`) más:
- `canAddManual: boolean` (true para staff en toda carta; false solo si no es carta suelta). **La fila «Versión» (`ids-capture.ts:192`) se muestra cuando `stamps>0 || candidates>0 || canAddManual`**: siempre sale el botón.
- `stamp` de cada combo suma `manual: boolean`; `productId` negativo si manual.
- Cada combo suma `priceSource: "own_market"|"inherited_base"|null` (`inherited_base` ⇒ la UI muestra «precio de la normal»; `null` sin precio). `baseReferenceMxnCents` sigue siendo la referencia usada.
- `stampTypes: StampType[]` (para poblar el selector).
Tras el POST el front vuelve a pedir el GET (o usa `combos` de la respuesta) y preselecciona el stamp+finish nuevo; el alta (`POST …/items/batch` con `cardProductId` = `productId` negativo) no cambia de contrato. `cardProductId` negativo se acepta solo si el producto existe y es de esa carta (si no, 422 `INVALID_VERSION` existente).

## 4. Fusión con el producto real (AUTO, sin acción del dueño)
- Dispara: el sync diario / `import-tcgcsv-set` / `attach` cuando crea o ata un producto real (productId>0) `stamped` para la carta; job idempotente `manual-version-merge` también corre diario.
- Detección: misma carta + mismo `stampType` y, si ambos tienen etiqueta, la etiqueta normalizada coincide. Si hay UN solo manual del mismo tipo y el real no tiene etiqueta distinta ⇒ se fusiona.
- Efecto (una transacción serializable): las `InventoryItem` reapuntan `cardProductId` del manual al real; `finishes` = unión; se borra el manual; auditoría `inventory.manual_version_merged {from, to, items}`. Las piezas conservan su costo de compra; su precio de venta pasa solo al mercado real (el cambio es automático por ser precio dinámico, no se reescribe nada).
- Duda (≥ 2 manuales del mismo tipo, etiquetas distintas, o real ambiguo): NO se fusiona, el manual sigue con precio heredado y se audita `inventory.manual_version_merge_skipped {reason}` (cuarentena automática; sin lista para el dueño). Idempotente: segunda corrida ⇒ 0 cambios.

## 5. Para frontend / backend (resumen)
Frontend: botón siempre visible; formulario tipo+etiqueta+acabado; reutilizar el flujo de `attach`; mostrar `priceSource`; manejar 409 `USE_EXISTING`. Backend: endpoint, secuencia+índice (migración aditiva), fallback de precio en `sale-decision`, `canAddManual/priceSource/stampTypes/manual` en `CardVersionsResponse`, job de fusión, auditoría, throttle. Pruebas: doble alta ⇒ 1 producto; 2 usuarios en paralelo; fusión con piezas vendidas y en bóveda; fallback sin mercado en la normal; `customer` 403; 0 precios existentes cambian.
