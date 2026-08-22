# PENDIENTES — TCG HUNT

Lista viva de lo que **falta** en el producto. Cuando algo se cierra, se mueve a «Hecho
(referencia)» al final o se borra. Añade nuevos como `P-#`. Última limpieza: **2026-08-22**.

---

## Listo en `main` — esperando «publica» (NO en producción aún)

Doble veredicto por-stream aprobado; mergeado a `main` (Cluster 1 `8edf046`, Cluster 2 `f41ef56`).
Se despliega a producción solo cuando el humano diga **«publica»**.

- **P-28** · Los dos carritos no concuerdan en «Vender» → el botón de carrito de **tienda** se oculta
  dentro del flujo de Vender (`/buylist`), en desktop y móvil.
- **P-29** · Baja rápida de inventario → «baja rápida» de N piezas de un golpe desde el drawer del
  Master Set (`note` obligatoria + motivo enum), selección server-side, guarda atómica, rastro triple,
  idempotencia por `batchKey`. Money-safe (solo transiciona status).
- **P-31** · Exportar inventario a Excel → botón en M1, `.xlsx` (una fila por folio, solo dinero
  almacenado, celda vacía nunca 0).
- **P-32** · Valor del «set destacado» en el home → Σ de referencias de mercado de las cartas base
  (excluye deck_exclusive/promo), % con baseline de cobertura; muere el +157,463%.
- **P-33** · Quitar el selector de «proveedor de respaldo» de Ingesta de precios → retirado del panel
  M2; PPT queda fijo como respaldo en la precedencia del backend.

---

## Abiertos

### P-30 · Publicación ÚNICA por carta (con stock), no una publicación por cada copia
- **Observado por el humano (2026-08-22):** al publicar, cada copia física genera una **publicación
  separada** en el catálogo (Tropius aparece ×3: «01/02/03 Tropius · Pitch Black #1 · MX$15»).
- **Qué debe ser:** **una sola publicación por carta/variante**, con **cantidad/stock**, viva
  **mientras haya inventario** y agotada cuando el stock llega a 0 — no N publicaciones para N copias.
- **Alcance:** modelo de listing agrupado por (carta, variante, condición) con stock; afecta storefront
  (catálogo/home) y el «publicar» de inventario. Money-safe: solo publica lo que tiene precio.
- **Roles:** arquitecto (modelo/contrato del listing con stock) → backend + frontend. **Grande**
  (toca schema/contrato + storefront + inventario): sesión propia, después de P-28/P-32/P-33.

### P-31 · Exportar inventario a Excel con un botón
- **Pedido del humano (2026-08-22):** un botón en M1 que descargue el inventario a **Excel (.xlsx)**.
- **Por definir:** columnas (carta, set, #, acabado, condición, cantidad, costo, precios
  mercado/compra/venta, folio…), y si exporta todo o el filtro/set actual.
- **Roles:** backend (endpoint de export) + frontend (botón + descarga).

### P-32 · Valor del «set destacado» en el home está mal (muestra el ETB, no la suma de las cartas)
- **Observado por el humano (2026-08-22, ya comentado antes):** el bloque «Pitch Black · Valor de
  mercado» del home muestra **MX$15,756.32 con +157,463%** — cifra absurda. Está tomando el valor del
  **ETB (sellado)**, no la **suma del valor de mercado de las cartas del set**.
- **Contexto:** es la «gráfica pública de valor de set». La fuente del cálculo está mal (ETB en vez de
  Σ cartas) y el % de cambio es irreal.
- **Roles:** backend (fuente del valor del set = Σ referencias de mercado de las cartas + % correcto)
  + devops (encender datos/serie histórica, runbook `DEVOPS_NOTES §17`).

### P-33 · Quitar el selector de «proveedor de respaldo» de Ingesta de precios
- **Decisión del humano (2026-08-22): QUITARLO.** La ingesta («Actualizar precios ahora») se queda; el
  **selector de proveedor de respaldo** se **retira del panel** (M2). TCGCSV sigue primario y PPT queda
  fijo como único respaldo en la precedencia del backend (sin control en UI).
- **Roles:** frontend (retira el `Select` de proveedor + estado huérfano; el dial de settings queda
  con default PPT sin exponerlo).

### P-34 · Simplificar pricing a «tiers» en vez de una regla por cada rareza
- **Observado por el humano (2026-08-22):** tras sincronizar hay **~30 rarezas** en el editor de reglas
  (Common 5326, Uncommon 4888, Rare 2562, Rare Holo 1617, … Rare ACE, Amazing Rare). Poner una regla
  por cada una es demasiado: **«es más fácil si simplificamos para pricear»**.
- **Propuesta:** definir un set chico de **tiers de precio** (p. ej. Bulk/Common, Uncommon, Holo/Rare,
  Premium/Chase, Ultra) y **mapear cada rareza canónica → un tier**; el editor gestiona ~5 reglas por
  tier, no 30 por rareza. La bandera `premium` existente es un tier tosco de 2 → formalizar. Money-safe:
  rareza sin tier → tier por defecto (fallback), nunca 0.
- **Además:** hay rarezas **«SIN MAPEAR»** (Mega Hyper Rare, `MEGA_ATTACK_RARE` —valor crudo—, Black
  White Rare) que `normalizeRarity` no llevó a canónica; al definir tiers, cerrar el catálogo.
- **Roles:** product-owner (cuántos tiers + mapa rareza→tier con el humano) → arquitecto (modelo del
  tier + contrato del editor, cambia el shape de reglas) → backend + frontend. Evoluciona P-18 + el
  catálogo canónico (M-31). **Grande**: sesión propia con diseño primero.

### P-35 · Alta de producto SELLADO clara/simple, con imagen de API (no buscador de cartas)
- **Observado por el humano (2026-08-22):** en M1 → pestaña **Sellado**, el modal «Alta de carta en
  bóveda» **reutiliza el buscador de CARTAS**: al elegir Pitch Black + Tipo=Sellado, los RESULTADOS
  siguen mostrando **singles** (Tropius, Grubbin, Fomantis…) en vez de **productos sellados** (ETB,
  booster box, blíster). Confuso — no hay una forma clara de subir producto cerrado.
- **Qué falta:** un flujo **dedicado** de alta de sellado en la pestaña Sellado — listar los
  **PRODUCTOS SELLADOS del set** (ETB/booster box/blíster…), NO singles; rápido, claro y simple; y que
  **jale la imagen del producto desde una API** (TCGCSV/TCGplayer, ya mapeado M-23; pokemontcg.io no
  tiene sellado). Reglas simples de P-19 (cantidad + compra/aportación).
- **Relación:** P-25 dejó la pestaña Sellado, pero el **alta** sigue pasando por el modal de cartas.
  Money-safe: sellado sin precio de mercado (no mapeado a TCGCSV) → pendiente, nunca 0.
- **Roles:** ux-ui (flujo de alta de sellado) → backend (listar productos sellados del set + su imagen
  de API) + frontend. Módulo Inventario/sellado.

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

- **Fix de variantes/precios de raíz (esta sesión):** modelo 1 carta ↔ N productos por productId exacto,
  TCGCSV fuente única de estructura+precio por variante, FX Banxico, PPT fallback, catálogo canónico de
  rarezas, «Unificar rarezas», refresh solo-TCGCSV por-set y batch, limpieza del panel admin M2
  (M-31…M-36). Fantasma `normal` muerto por construcción.
- **P-27** · Sets multi-parte combinados (Celebrations = 50) — en producción. *(Menores: P27-D2 el
  cotizador aún no combina; P27-D3 validar y activar los pares Shiny Vault — ver `TECH_DEBT.md`.)*
- **Streams A/B/C**, **P-1–P-5**, **P-11–P-22, P-24, P-25**, **P-21** (rebrand + dominio tcghunt.mx),
  **P-26** (sellado). Todo con doble/triple veredicto y en producción.
