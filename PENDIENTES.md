# PENDIENTES — TCG HUNT

Lista viva de lo que **falta** en el producto. Cuando algo se cierra, se mueve a «Hecho
(referencia)» al final o se borra. Añade nuevos como `P-#`. Última limpieza: **2026-08-22**.

---

## Listo en `main` — esperando «publica»

Doble veredicto por-stream aprobado; mergeado a `main` (`6c5763b`). Se despliega a producción con «publica».

- **Endurecimiento inventario/sellado (2026-08-23, doble veredicto QA+techlead APROBADO + E2E ciclo completo):**
  El gate E2E pre-publicación (stack levantado, 63+ capturas) verificó operativo de punta a punta: comprar
  (settle certificado por suite de integración con webhook Stripe firmado; pago real staging-only), vender
  (buylist con CLABE cifrada), **admin intake→publicar** (venta→SPEI→inventario a costo real→«N+1 en stock»),
  y **subir sellado**→publicar→visible en Compra. Cierres: **BLOQ-1** (el alta por lote perdía el costo de
  compra → P&L; ya persiste), **BLOQ-2/2a/2b** (regresión «Tropius» muerta en M1›Sellado, «Mis piezas» y
  cola M2), **BLOQ-3** (el binder cuenta solo singles; el sellado no infla conteos), **IMP-1** (alta sellado
  sin dead-end vía `effectiveMarketCents` gateado), **IMP-2** (badge en vivo), **IMP-A** (cotizador ya no
  crashea por cantidad absurda), **IMP-B** (M5 deja convertir tras pagar), **IMP-C** (el override manual del
  sellado sobrevive al dial off; bucle roto), **IMP-D** (el **T2=25%** de P-34 entra en vigor vía reshape de
  datos), y la **cola M2 del sellado a 1 sola fila resoluble** por pieza. Contratos **v1.41/v1.42/v1.43**,
  **migración M-40** (`PendingPriceEntry.sealedProductId`, aditiva). Money-safe en todo el recorrido (sin
  precio → pendiente, nunca $0). *(Deuda no bloqueante anotada: D-1 cascada display duplicada, D-2
  `resolveAnchorCardId` duplicado money-adjacent, D-3 saneo de pendientes legacy.)*

- **Deuda saldada (2026-08-23, doble veredicto QA+techlead APROBADO):** backend H-P38-4 (upsert atómico
  del sync sellado), P-34 H5 (`mega`/`blackwhite` premium), P-34 H4 (invariante premium→pct testeado),
  **P-30 H2 cierre completo** (productores y consumidores comparten `variantKey()` + guard de round-trip);
  frontend H-P38-5 (alta sellado sin `cardId` falso), Cotizador H1/H3/H4 (layout CSS, sombreado «En el
  carrito» en teja separada, doc drift). Todo display/UX/refactor, money-safe, sin cambio de contrato.
  *(Deuda aún diferida: MK-D6, FE-2 «desde $X», DEUDA-tiers-3, P-30 H3, P-34 H3, SB-D3 (~6 sitios
  hand-rolled de otros módulos), deps + hardening auth B-1/B-2/B-5, re-seed snapshots, M-1 aceptado.)*

- **P-38** · **Módulo `SealedProduct`** (cura raíz de SB-D5): descarga presentaciones por set (ETB/UPC/
  Booster Bundle/box/blíster), alta = **seleccionar** con identidad real (adiós «Tropius sealed»), sync
  **1 set→N grupos** (absorbe promos/colecciones), precio en vivo + **manual** (vault_operator, auditado),
  soft-delete. **Migración M-39 + backfill** que cura el ETB→Tropius. Cascada de display cableada en
  Compra/Bóveda (H-P38-1). Contrato v1.39.1. *(Deuda no-bloqueante H-P38-2..6 en TECH_DEBT; precio manual
  por vault_operator marcado para fase de seguridad por release.)*
- **P-37** · IVA a **un solo dial**: se retira `STRIPE_FEE_IVA_PCT`; el gross-up de Stripe deriva de
  `IVA_PCT/100` (idéntico al centavo). Contrato v1.40. Money-safe.
- **P-41** · cotizador del home surtía `pageSize:5` (Pitch Black quedaba fuera) → **pageSize 20 + «ver
  más»**; + **orden global por `set.releaseDate desc`** (sets nuevos primero, ya no uuid aleatorio).
- **P-42** · cotizador: **carrito fijo a la derecha** en desktop (sticky) + **sombreado** «En el carrito».
- **P-43** · click en la carta → **pop-up de detalle** con imagen grande (cierra por backdrop + Esc).
- **P-44** · **rareza** visible en tejas de catálogo/cotizador/ficha/binder admin+bóveda.
- **P-39/P-40** · foto HD en el featured/ficha + etiqueta de **acabado**.
- **P-36** · stepper de baja rápida: botones disabled ya no se ven «encendidos» al hover.

**Al publicar (devops/Railway) — runbook en `DEVOPS_NOTES.md §29`, orquestado por `scripts/post-deploy.sh`
(idempotente; el paso 4 es opt-in y PARA si `publish-all` falla, conservando el cuerpo para diagnóstico):**
1. `prisma migrate deploy` → **M-39** (SealedProduct) + **M-40** (`PendingPriceEntry.sealedProductId`) +
   **M-41** (P-48: `pricing_curve`, `priceBasis`, `PendingPriceEntry.reason`, instrumentación), todas aditivas.
2. `ts-node prisma/backfill-m39-sealed-product.ts` — cura ETB→Tropius (idempotente).
3. `unify-rarities` — cosmético del editor M2. **Ya NO es prerrequisito de nada**: el guardarraíl premium
   usa `isPremiumCanonicalRarity()`, que acepta rareza cruda o canónica (verificado por devops).
4. **Cut-over P-48 (`RUN_PUBLISH_ALL=1`, opt-in)** — `publish-all` re-resuelve el precio con la curva.
   NO es migración de dinero: el precio de venta se resuelve en lectura, así que repriciar es re-resolver,
   nunca un `UPDATE` masivo. Idempotente por `batchKey` (default `p48-cutover-v2.0`).
5. **Diagnóstico de la cola por razón** — `no_market` vs `premium_at_floor`. Línea base esperada ≈3 de
   cada 333 (`ARCHITECTURE §4.36.9c-3`). Si `premium_at_floor` sube con `no_market` plano ⇒ piso mal
   calibrado; si suben los dos ⇒ feed degradado y **no** hay que tocar el piso.
6. *(D-3, no bloqueante)* si aparecen filas de sellado huérfanas en la cola M2 de altas previas al fix →
   barrido puntual (deuda backend registrada).
7. Por cada set: «Sincronizar» trae presentaciones (requiere egress real a `tcgcsv.com`).

> **Los cinco settings retirados por P-48 quedan INERTES, sin `DELETE`** (`sales_price_rules`,
> `buylist_price_rules`, `pricing_tier_map`, `sales_price_fallback_pct`, `buylist_price_fallback_pct`).
> Es deliberado: borrar config en el mismo paso que cambia la matemática mata el diagnóstico y el rollback
> barato. Ojo con `sealed_spread_fallback_pct`: **se parece pero NO es una de las cinco** — el sellado sigue
> vivo y fuera de la curva.
>
> **Orden entre releases (decisión del humano, pendiente):** `main` va adelante con **P-47** (flip a
> `tcgcsv_singles`), que cambia la **fuente** del mercado; P-48 cambia la **matemática** que se le aplica.
> Encender ambos en la misma ventana deja indiagnosticable cualquier movimiento de precio. Devops recomienda
> serializar.
> **Antes del deploy:** snapshot/PITR de la Postgres de prod (única vía de rollback fino del dinero del paso 3).
> **Rollback:** migraciones aditivas → redeploy del commit anterior; backfills idempotentes/no destructivos.

---

## Abiertos

### Infraestructura · Disco de la base de datos (2026-09-01)

#### P-53 · 💾 El disco de Postgres se llena por el ritmo de escritura del historial de precios — MITIGADO, falta la cura
- **Detectado por el humano:** alerta de Railway «High Volume Usage — postgres-volume is at 77% capacity».
- **✅ Mitigación aplicada (humano, 2026-09-01):** volumen ampliado. **El reloj de saturación se detuvo.**
  Queda pendiente anotar el tamaño nuevo y rehacer la proyección con él.
- **Medición real en producción (solo lectura, consola de Railway):**
  | Dato | Valor |
  |---|---|
  | Disco usado / disponible | 317 MB de 434 MB (75%) |
  | `pgdata/base` (datos) | 171 MB |
  | `pgdata/pg_wal` (bitácora) | **145 MB — 46% de lo ocupado** |
  | Base de datos completa | 148 MB |
  | `PriceReference` | **101 MB — 68% de la base** |
  | Filas de `PriceReference` | 222,614 (2026-08-17 → 2026-09-01, 16 días) ⇒ ~476 B/fila |
- **Causa raíz (confirmada por consulta, NO por hipótesis):** el **ingest de singles de TCGCSV** escribe
  **una fila por producto por día**, se muevan o no los precios. El 2026-08-28 el ritmo saltó de **2,062 a
  ~28,570 filas/día (×14)** y lleva 5 días sostenido — es el nuevo estado estable, no un pico.
  Desglose del día 2026-09-01: `tcgcsv_singles/raw:NM/market` **28,559** · `pokemonpricetracker/graded:PSA:10`
  12 · `graded:PSA:9` 6.
  ⚠ **Corrección registrada:** el orquestador atribuyó primero el salto al pipeline PSA. **Era falso** —
  el PSA aporta 18 filas de 28,577. La causa es el ingest de singles.
- **Proyección que motivó la ampliación:** ~13 MB/día contra 107 MB libres ⇒ saturación ≈ **2026-09-09**.
  Con el disco lleno Postgres **deja de aceptar escrituras** (sin pedidos, sin altas, sin capturas de
  inventario) y compactar la tabla exige espacio libre ≈ su propio tamaño (101 MB): esperar cerraba la
  puerta al arreglo, no solo al servicio.
- **⚠ Una política de retención por antigüedad NO resuelve esto.** El historial completo son 16 días: hoy
  «conservar 90 días» no borraría ni una fila. El problema es el **ritmo diario**, no la basura vieja.
  (El orquestador propuso retención antes de medir; queda anotado para no repetir el camino.)
- **Lo que sí queda por hacer:**
  - **(devops) Acotar el WAL.** 145 MB de bitácora con **cero replication slots** (verificado: la consulta a
    `pg_replication_slots` devolvió 0 filas ⇒ no hay fuga). Es Postgres con los valores de fábrica,
    dimensionados para un disco mucho mayor. Bajar `max_wal_size` recupera del orden de **100 MB**. Requiere
    reinicio de Postgres ⇒ **con respaldo y ventana**, no en caliente.
  - **(arquitecto → backend) Escribir menos por día.** Palanca de fondo: hoy se guarda una fila diaria por
    carta **aunque el precio no se haya movido**, y la mayoría no se mueve. Escribir solo ante cambio recorta
    el volumen de forma drástica.
    🔴 **Money-critical:** toca qué tan **fresco** se considera un precio (`capturedDate`/`evidenceDate`,
    `stale()`) y roza la regla «no se fabrican puntos» de las series del portafolio y de los sets. Mal hecho,
    una carta se queda con precio viejo **sin que nada avise**. Pasa por el **arquitecto** (regla 9) y exige
    **triple veredicto (QA + techlead + seguridad)** antes de producción.
  - **(devops) Vigilancia.** Hoy nos enteramos por la alerta de Railway al 77%. Falta un aviso propio del
    crecimiento del disco y del ritmo de filas/día, para no volver a descubrirlo a 8 días del tope.
- **Consultas de diagnóstico (solo lectura) para repetir la medición:** tamaño por tabla vía
  `pg_total_relation_size`; `du -sh /var/lib/postgresql/data/pgdata/*`; `pg_replication_slots`;
  `SELECT "capturedDate", count(*) FROM "PriceReference" GROUP BY 1 ORDER BY 1 DESC`.

### Encontrado en pruebas post-publicación (2026-08-23)

#### P-47 · 💰 El mercado se aplana a todos los acabados (normal = reverse holo = holofoil) — EN CURSO
- **Reportado por el humano:** en el binder, Normal/Reverse Holo/Holofoil de la misma carta muestran el
  **mismo MERCADO** (Dartrix 1.14=1.14; Luxray reverse 2.47=holofoil 2.47). El proveedor manda precio
  distinto por acabado; se está aplanando.
- **Causa raíz (money-adjacent):** display y clave `PriceReference` SÍ son por-acabado (sin fallback). El
  aplanamiento ocurre en la **ingesta**: el provider primario `PokemonPriceTrackerBulkProvider` en modo
  `fetchPrintings` (`pokemonpricetracker-bulk.provider.ts:268-295`, `mapEntry` rama forced `:560-564`) lee el
  `market` de **nivel carta** en las 3 pasadas → escribe el mismo precio a normal/reverse_holo/holofoil. La
  API v2 de PPT no varía el market por `?printing=`. Test que enmascara: `fix-ppt.spec.ts:84-109` (hardcodea
  3 markets distintos). Fuente correcta por-acabado = **TCGCSV `tcgcsv_singles`** (per subTypeName), con
  precedencia sobre PPT, pero solo corre en refresh/import, no en el barrido diario.
- **Parte 1 (HECHO, en prod `9c3eb3e`):** PPT ya no copia el market a las 3 impresiones — solo escribe la
  impresión primaria real; los demás acabados quedan pendiente/«—», nunca el precio de otro. Test corregido.
- **Parte 2 (contrato v1.44, arquitecto):** el barrido diario reprecio **por-acabado** desde TCGCSV
  `tcgcsv_singles` (separando estructura import/--force de precio diario); apagar `fetchPrintings` de PPT;
  §4.25a-2 corregida; §4.35 nueva.
- **Parte 3 (EN CURSO, backend):** implementar el provider/job `TcgcsvSinglesBulkPriceProvider` (precio
  por-acabado keyed por `cardProductId`, FX, respeta overrides), registrarlo como primario del barrido, PPT
  LIST fallback. Money-critical → **triple veredicto (QA+techlead+seguridad) antes de desplegar**.
- **Parte 4 (después, devops):** `PRICE_PROVIDER=tcgcsv_singles` + `POKEMONPRICETRACKER_FETCH_PRINTINGS=false`
  + orden del scheduler + runbook `--force` por set nuevo (tras merge de backend, NO en paralelo).
- **Mitigación mientras tanto:** el refresh/sync TCGCSV por set (per-acabado, gana sobre PPT) da los precios
  correctos por acabado ya.


#### P-46 · Sincronizar sellado devuelve «0 presentaciones»: el set no resuelve grupo TCGCSV (prod)
- **Reportado por el humano:** al Sincronizar sellado de **Pitch Black (2026)** (y Chaos Rising) sale «0
  presentaciones». **El botón SÍ funciona** — la sync corre.
- **Causa raíz (logs prod 2026-08-23):** `sealed-products/sync: set Pitch Black ... **sin grupo resoluble
  (ni curado ni name-match)** → nada que sincronizar (money-safe: no se adivina)`. El set no está vinculado
  a su **grupo de TCGCSV** (`tcgcsvGroupId`): ni curado a mano ni por name-match. Sin grupo no hay
  presentaciones que bajar. (Egress a tcgcsv.com OK — no hubo 502/UPSTREAM.)
- **Causa confirmada (name-match backend):** `matchScore` en `sealed-product.service.ts:777` usa
  `normalizeSetName` sobre el nombre directo, pero TCGCSV nombra los grupos con **prefijo de código**
  («SV08: Pitch Black» → `sv08pitchblack`) vs el catálogo local («Pitch Black» → `pitchblack`) → no empatan
  → 0.5 < umbral 0.9 → no auto-resuelve. Ya existe `setNameCandidates` (ppt-set-mapper:145) que quita ese
  prefijo, pero `matchScore` no la usa. **Afecta a CUALQUIER set con prefijo en TCGCSV** (no solo Pitch Black).
- **Fix (EN CURSO, backend):** `matchScore` tolerante al prefijo (reusa `setNameCandidates`) para que los
  matches legítimos suban a ≥0.9 y auto-resuelvan; **conserva** la salvaguarda «≥0.9 Y único en el tope →
  si empate, null (no adivina)». Con tests. Money-safe.
- **Workaround inmediato (humano, super_admin):** M1 → Sellado → «Agregar producto sellado» → elegir set →
  enlace «Curar/vincular grupo» (`SealedGroupLinker`) → elegir el candidato de TCGCSV (aparece con confianza
  media) → «Vincular» → re-sync automático baja las presentaciones.
- **Follow-up (frontend, no bloqueante):** UX del modal cuando la sync da 0 por «sin grupo resoluble» —
  guiar explícitamente al linker en vez de solo mostrar «0 presentaciones».

#### P-45 · Badge «N EN TOTAL» del binder muestra el total de la carta en cada acabado — EN CURSO
- Dar de alta 2 piezas de un acabado (ej. Spinarak NORMAL) pinta «2 EN TOTAL» también en la teja de otro
  acabado con 0 piezas (Reverse Holo). Solo display (el dato es correcto, el otro acabado está en 0). Fix
  frontend en curso: cada teja muestra el conteo de SU acabado. Money-safe.

### Pendiente del humano · Razón social para el footer
- El footer de producción aún dice **«[RAZÓN SOCIAL PENDIENTE]»**. Falta que el humano dé la razón
  social para `footer.legalEntity` (check del rebrand P-21). Solo dato del humano; el cableado ya está.

---

## Nuevas ideas (aún NO en construcción — falta aterrizar con el humano)

### Idea · «Hunter Pulls» — mini-foro de pulls de la comunidad
- **Idea del humano (2026-08-22):** un **mini-foro** muy sencillo donde la gente pueda **subir qué pull
  hizo con nosotros** (posts con foto/descripción) y otros puedan **comentar**. Todo muy simple.
- **Requisito duro:** solo participan **usuarios registrados con nosotros** (postear y comentar exige
  cuenta). Encaja con el lenguaje de marca «cacería» (TCG HUNT 🎯).
- **Por aterrizar con product-owner:** alcance mínimo (post = imagen + texto corto + carta/set
  opcional; comentarios planos; sin votos/hilos anidados al inicio); moderación (¿quién aprueba?,
  reporte de abuso); qué se puede subir (¿ligado a una compra/pedido real con nosotros o libre?);
  privacidad/derechos de imagen; anti-spam básico.
- **Roles:** product-owner (aterriza) → arquitecto (modelo posts/comentarios + moderación + storage de
  imágenes) → backend + frontend + ux-ui. Nuevo módulo (community/social).

### Idea · Vender «meta decks» completos (bundles ready-to-play) — investigación hecha, falta aterrizar
- **Idea del humano:** apartado «Compra tu deck» — publicar los decks meta del mes como bundle completo,
  armados con nuestras cartas sueltas.
- **✅ Investigación hecha (2026-08-22):** meta Estándar post-rotación (Dragapult ex/Dusknoir el #1;
  Clefairy Box campeón NAIC; Slowking, Mega Lucario, Gholdengo; budget Crustle / Team Rocket's Mewtwo).
  Al jugador competitivo NO le importa la variante (juega la más barata legal; evitar reverse combadas).
  Pricing: suma de singles propios + premium 8–15% transparente, nunca con descuento; incluir energías
  básicas. Hueco de mercado claro en MX. Modelar como kit/BOM sobre `inventory` con stock verificado.
- **⚠ Timing:** lanzar DESPUÉS de Worlds 2026 (28–30 ago), con el meta post-Worlds.
- **Preguntas de producto:** ¿deck solo si el inventario surte la lista completa o parcial? ¿precio =
  suma de singles con ajuste o fijo por arquetipo? ¿energías/fundas incluidas?
- **Roles:** product-owner aterriza con el humano → arquitecto/backend/frontend cuando esté definido.

---

## Retirados / obsoletos

### ~~P-6 · El proveedor de precios de PAGA (PPT) no escribe precios~~ — OBSOLETO (2026-08-22)
- Superado por el rediseño de esta sesión: **TCGCSV es ahora la fuente primaria** de estructura y precio
  por variante (M-31…M-35); PPT quedó como **fallback**. Si algún día se reactiva PPT como primario,
  retomar el diagnóstico original (request `GET /api/prices?setId=…`).

---

## Hecho (referencia breve — todo en producción)

- **P-30** publicación única por carta con stock (`GroupedListingDTO` v1.38, una teja «N disponibles»,
  add-to-cart por pieza, sin migración) + **rediseño makeover 1a** del storefront (nueva capa visual,
  `StockBadge` con «Agotado»/«Queda 1») — publicados a producción (`e258da0`). Deuda H1-H4/FE-2/MK-D1..D9
  en `TECH_DEBT`.
- **P-35** alta dedicada de sellado (imagen de API, M-37), **P-34** pricing por 5 tiers (editor M2,
  invariante premium→pct, T2 a 25%, fix de dinero de las sin-mapear; Uncommon compra $0.50→$1.50), **H9**
  sellado fuera de la vista de singles — publicados a producción (`75ef123`). *(Pendiente devops:
  `unify-rarities` post-deploy, solo cosmético del editor.)*
- **P-28** carritos que no concordaban en Vender, **P-29** baja rápida de inventario (idempotente,
  money-safe), **P-31** export de inventario a Excel, **P-32** valor del set = Σ cartas (muere el
  +157,463%), **P-33** quitar selector de proveedor de respaldo — publicados a producción (`fcb07e1`).
- **Fix de variantes/precios de raíz (esta sesión):** modelo 1 carta ↔ N productos por productId exacto,
  TCGCSV fuente única de estructura+precio por variante, FX Banxico, PPT fallback, catálogo canónico de
  rarezas, «Unificar rarezas», refresh solo-TCGCSV por-set y batch, limpieza del panel admin M2
  (M-31…M-36). Fantasma `normal` muerto por construcción.
- **P-27** · Sets multi-parte combinados (Celebrations = 50) — en producción. *(Menores: P27-D2 el
  cotizador aún no combina; P27-D3 validar y activar los pares Shiny Vault — ver `TECH_DEBT.md`.)*
- **Streams A/B/C**, **P-1–P-5**, **P-11–P-22, P-24, P-25**, **P-21** (rebrand + dominio tcghunt.mx),
  **P-26** (sellado). Todo con doble/triple veredicto y en producción.

## HANDOFF (2026-08-25) — Fusión curva v2 BLOQUEADA por límite de uso
**Estado:** cierre seguro de `claude/card-pricing-rules-2e537m` (curva v2) EN CURSO, detenido por límite de uso de la cuenta (reset Aug 28, 4pm UTC). **NADA desplegado; producción intacta** (`production`=c255692). P-47 por-acabado sigue vivo en prod.
**Plan ya decidido y documentado (no re-analizar):** ARCHITECTURE §4.36 + API_CONTRACT v1.49 «Dos capas de precio». Verificado: conviven POR-ACABADO; M-41 aditiva (no toca PriceReference).
**Regla de fusión:** CONSERVAR provider `tcgcsv_singles` (P-47, capa REFERENCIA) + ADOPTAR curva v2 (capa REGLA). Único conflicto de código: `price-ingest.service.ts` (v2 borra el provider → RECHAZAR ese borrado). Restaurar 6 banderas (§4.36): PRICE_PROVIDER_VALUES, enum PriceSource, seed, registro NestJS del provider, tests, .env.example.
**Resume:** rama `integration/pricing-v2-merge` (creada desde main 6ec0722). `git merge origin/claude/card-pricing-rules-2e537m`, resolver por §4.36, validar (tsc+jest+smoke per-acabado), re-gate (QA/techlead/seguridad del delta post-5bd1975 + fusión), snapshot BD (humano), deploy nativo Railway/Vercel, runbook post-deploy (UPC spreads PUT 18/22, cut-over por sets).
**Trigger activo:** routine "Publicar curva de precios v2" (trig_01Noh8euNXLdK5uRrkTBfYh7) sigue disparando — considerar pausarla hasta el reset.

## DESPLEGADO (2026-08-28) — Motor curva v2 a producción
`production`=96580c6 (main->production). Motor de precios v2 (curva por valor de mercado) CONSERVANDO P-47 por-acabado (tcgcsv_singles). Migración M-41 aditiva. Sin snapshot (decisión del humano, opción C). Gate de release verde: QA (2139 back + 679 front), techlead (APROBADO c/deuda), seguridad (APROBADO-CON-CONDICIONES, 0 crít/0 alto).
**Post-deploy pendiente:** (1) verificar salud + curva; (2) spreads UPC 18/22 vía PUT /admin/pricing/sealed-spreads (si no, venden 25%); (3) cut-over por sets (empezar chico).
**Deuda aceptada (no bloqueante):** S49-M2 media (disparador DURO: cerrar antes del 1er RFC/CLABE/INE real — hoy BD sin PII real); E2E completa contra stack vivo (no re-corrida sobre árbol fusionado; 3 smokes de dinero rojos solo por falta STRIPE key, aceptados); test de wiring singles→reconcile (techlead); bump NestJS 11 (2 moderate deps, devops); S49-B3/candado no-raw-entity/R2/R4 (bajas).
