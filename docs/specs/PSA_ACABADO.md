# PSA-ACABADO — estimado «si se gradea» por carta, grado y ACABADO (HECHOS 2026-11-09, opción B)

Zona de dinero (pricing). Sustituye ARCHITECTURE §4.38a «el estimado por grado es por carta y NO se cruza con el acabado» (archivo en `docs/archive/`). Diseño: arquitecto; construcción: backend + frontend; gates: qa + seguridad-lead.

## 0. Medido en código (2026-11-09, diagnóstico de backend; nada ejecutado)
- Hoy el estimado se guarda por carta+grado: `pokemonpricetracker-bulk.provider.ts:215` (`GradedEstimateSourceRow` sin acabado), `:1187-1300` (`parseGradedEntry` lee `ebay.salesByGrade.psaN`), `price-ingest.service.ts:2110` (`persistGradedEstimateReference(cardId, grado…)`), `pricing.service.ts:3003` (`finish = 'normal'`). Tope ×raw en `common/graded-estimate.ts:469`; la lista M2 compara esa cifra contra el raw de CADA acabado (24/65 «múltiplo excesivo»; Gengar Perfect Order #50 holo y reverse con la misma cifra).
- `PriceReference` YA tiene `finish` dentro de su única (`schema.prisma:1432`: cardId, productType, gradeKey, finish, capturedDate, cardProductId, source). **La clave no necesita columna nueva**: el escritor graded solo escribía `finish='normal'`.
- **NO MEDIDO:** si PokemonPriceTracker entrega ventas graded separadas por acabado (sin llave en el sandbox). Ver §3 (tarea de medición).

## 1. Clave y migración (a)
- Clave del estimado: `(cardId, productType='graded', gradeKey='graded:PSA:N', finish ∈ acabados reales de la carta, refKind='graded_estimate', capturedDate, …)`. Un acabado nunca lee ni hereda la cifra de otro.
- Migración ADITIVA `…_psa_finish_scope`: `PriceReference.estimateFinishScoped BOOLEAN NOT NULL DEFAULT false`. El escritor nuevo la fija en `true` en `create` Y en `update` (regla de `refKind`). Sin backfill, sin DELETE, sin tocar precios publicados.
- Filas viejas (`estimateFinishScoped=false`, `refKind='graded_estimate'`; todas con `finish='normal'`):
  - **Automáticas** (`isManualOverride=false`): dejan de LEERSE (ficha, rejilla, vitrina, gancho de grading, M2). No se borran en la migración; el barrido las borra al escribir las nuevas de esa carta+grado, en la MISMA transacción (patrón del DELETE v1.50.3-d: todas las de la clave y naturaleza). Una carta sin barrido nuevo queda «sin estimado» (seguro: sin cifra antes que cifra repetida).
  - **Manuales** (`isManualOverride=true`, afirmación humana por carta y grado): siguen valiendo SOLO para el acabado principal de la carta (el que usa la ficha por omisión) y se marcan «heredada» en M2 hasta que el staff las recapture por acabado. Caducan como siempre (`manualFreshnessDays`).
- Lecturas: todo lector filtra `estimateFinishScoped=true OR (manual heredada ∧ finish=acabado principal)`; el predicado vive en UN helper junto a `MONEY_REF_WHERE`.
- Reversa: revertir el código; las filas nuevas (`finish≠normal` o `scoped=true`) quedan inertes; las viejas siguen en la tabla. Ninguna cifra publicada de venta cambia (el estimado es informativo, no dinero de venta).

## 2. Proveedor sin separación por acabado (b)
- `parseGradedEntry` devuelve `finishScope: 'per_finish' | 'card_level'`. Regla:
  - `per_finish` ⇒ una fila por (carta, grado, acabado) con la muestra de ESE acabado; `minSampleCount` y el tope ×raw se evalúan por acabado contra el raw VIGENTE de ese mismo acabado (`PriceReference` raw/NM, mismo `finish`).
  - `card_level` (o duda) ⇒ **solo si la carta tiene UN acabado real** (un único `finish` entre los `set_base` vendibles; sellos y ligas no cuentan) se escribe para ese acabado. Carta de 2+ acabados ⇒ **«sin estimado»**: no se escribe ninguna fila, el resultado del escaneo de carta lleva `lastOutcome='no_finish_split'` (valor nuevo del enum `GradedCardScanOutcome`, aditivo) y se cuenta en el resumen del barrido. La regla NUNCA reparte una cifra de carta entre acabados.
- Sin raw vigente del acabado ⇒ no se escribe (no hay contra qué validar el tope) y la carta cae en la lista M2 con motivo `NO_RAW`.
- El staff puede capturar un estimado manual por acabado (§4); eso es afirmación humana y sí puede cubrir los acabados que el proveedor no separa.
- Sin dato local ⇒ la ficha oculta el bloque «Estimado PSA» de ese acabado (sin 0, sin «—» inventado).

## 3. Tarea de medición (devops/backend con llave; NO la hace el arquitecto)
Llamada real a PokemonPriceTracker con `includeEbay=true` para (1) Slowking, Prismatic Evolutions #19 y (2) Gengar, Perfect Order #50. Registrar en `docs/STATUS.md` (sin la llave, sin cuerpo completo): ¿`ebay.salesByGrade` viene por acabado (otra clave, otro objeto por variante) o solo por carta? ¿cuántos créditos costó? Resultado ⇒ fija si el caso general es `per_finish` o `card_level`. Hasta medirlo, el código se escribe para ambos y el valor por omisión es `card_level` (la opción segura). Prueba de humo: Gengar #50 holo y reverse NO deben salir con la misma cifra salvo que el proveedor las dé iguales por separado.

## 4. Lecturas y escrituras (c) — ver API_CONTRACT §M2/catalog
- Ficha `GET /catalog/cards/:cardId` y `gradingHighlight`: `GradedEstimateDTO` suma `finish: Finish`; `gradedEstimates` viene por acabado y el front muestra el del acabado elegido; acabado sin estimado ⇒ sin bloque.
- M2 lista de revisión `GET /admin/pricing/graded-estimates/review`: la fila ya trae `finish` (del listing); `psa10MxnCents/psa9MxnCents` pasan a ser los del MISMO `finish`; el tope ×raw se compara contra el raw de ese acabado; motivos suman `NO_RAW` y `LEGACY_MANUAL` (heredada); `NO_FINISH_SPLIT` solo en el resumen.
- `PUT`/`POST` manual (`/admin/pricing/override` con `intent:'graded_estimate'`) suma `finish` OBLIGATORIO; `DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue` suma query `finish` OBLIGATORIO (sin él ⇒ 400 `VALIDATION_ERROR`, `details.field='finish'`); borra solo las filas de esa clave y acabado.
- Promoción de grading («Joyas para gradear», gate de upside en PSA 9): el costo y el upside se calculan con el estimado Y el raw del MISMO acabado de la pieza; sin estimado de ese acabado ⇒ no se promociona (jamás se cae al de otro acabado).

## 5. Después de publicar (d) — AUTOMÁTICO (regla AUTO; `AUTO_CATALOGO.md` §C–D)
El siguiente `price-ingest` (≤12 h) recalcula solo, priorizando cartas sin fila por acabado, dentro del tope diario de créditos. Mientras tanto las cartas automáticas quedan «sin estimado» (§1), no con la cifra vieja. El botón «Actualizar precios PSA ahora» es atajo OPCIONAL (si ya existe se queda; si no, no se crea). Cifras automáticas que fallen cotas duras: cuarentena automática (AUTO_CATALOGO §D).

## 6. Pruebas (mutar ⇒ rojo)
PSA-B1 Gengar #50 con `per_finish` ⇒ dos filas con cifras distintas; B2 `card_level` + 2 acabados ⇒ 0 filas y `no_finish_split`; B3 `card_level` + 1 acabado ⇒ 1 fila en ese acabado; B4 tope ×raw usa el raw del mismo acabado (raw holo 10× que raw reverse); B5 fila vieja automática no se lee y se borra al escribir la nueva (misma tx); B6 manual heredada vale solo para el acabado principal; B7 segunda corrida ⇒ 0 duplicados; B8 migración no mueve ningún `priceMxnCents`; B9 DELETE sin `finish` ⇒ 400 y con `finish` no borra el otro acabado; B10 gancho de grading sin estimado del acabado ⇒ no promociona. PSA-F1 ficha cambia el estimado al cambiar el acabado y oculta si no hay; F2 M2 muestra `finish` y motivo; F3 captura/retiro manual envían `finish`.

## 7. Riesgos
Si el proveedor es `card_level` (probable por el diagnóstico), la mayoría de cartas multi-acabado quedará «sin estimado» hasta captura manual: el volumen de «Joyas para gradear» baja. Es el costo de no inventar cifras (decisión del dueño). Créditos del barrido: no suben (la misma llamada por carta). Concurrencia: el barrido ya es de un solo vuelo; el borrado de filas viejas y la escritura nueva van en la misma transacción `Serializable` con reintento.
