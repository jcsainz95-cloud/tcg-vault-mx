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

**Al publicar (devops/Railway) — runbook en `DEVOPS_NOTES.md §27`, orquestado por `scripts/post-deploy.sh`
(idempotente; PARA si el reshape detecta BD de precios editada a mano):**
1. `prisma migrate deploy` → **M-39** (SealedProduct) + **M-40** (`PendingPriceEntry.sealedProductId`), aditivas.
2. `ts-node prisma/backfill-m39-sealed-product.ts` — cura ETB→Tropius (idempotente).
3. `ts-node prisma/backfill-p34-tiered-pricing.ts` — **reshape de tiers T2=25%** (money-crítico; si imprime
   «⚠ ACCIÓN REQUERIDA» → PARAR y escalar al humano para el mapeo a mano).
4. `unify-rarities` (cosmético del editor M2, pendiente de P-34).
5. *(D-3, no bloqueante)* si aparecen filas de sellado huérfanas en la cola M2 de altas previas al fix →
   barrido puntual (deuda backend registrada).
6. Por cada set: «Sincronizar» trae presentaciones (requiere egress real a `tcgcsv.com`).
> **Antes del deploy:** snapshot/PITR de la Postgres de prod (única vía de rollback fino del dinero del paso 3).
> **Rollback:** migraciones aditivas → redeploy del commit anterior; backfills idempotentes/no destructivos.

---

## Abiertos

### Encontrado en pruebas post-publicación (2026-08-23)

#### P-46 · El botón «Sincronizar» del alta de sellado no descarga presentaciones (prod)
- **Reportado por el humano:** en «Agregar producto sellado», al elegir un set (ej. **Pitch Black 2026**)
  sale «Aún no descargamos las presentaciones de este set» con «0 presentaciones · 0 con precio · 0
  pendientes». El botón **SINCRONIZAR** **no funciona** (no descarga nada). Sin presentaciones no se puede
  dar de alta sellado por selección.
- **Contexto:** la sync pega a `POST /admin/inventory/sealed-products/sync` → tcgcsv.com. En el E2E local
  degradaba **limpio** (502 UPSTREAM por el proxy del sandbox que bloquea tcgcsv.com). En **prod** hay que
  determinar por qué no jala: (a) ¿Railway tiene **egress real a tcgcsv.com**?, (b) ¿qué **error** sale en
  los logs al pulsar Sincronizar?, (c) ¿el botón **dispara** la llamada (Network) o no hace nada (frontend)?
- **Rol:** por confirmar según los logs — **devops** (egress/config de red) y/o **backend** (endpoint sync)
  y/o **frontend** (si el botón no dispara). Diagnóstico primero.

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
