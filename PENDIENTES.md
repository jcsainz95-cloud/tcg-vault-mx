# PENDIENTES — TCG HUNT

Lista viva de lo que **falta** en el producto. Cuando algo se cierra, se mueve a «Hecho
(referencia)» al final o se borra. Añade nuevos como `P-#`. Última limpieza: **2026-08-22**.

---

## Listo en `main` — esperando «publica»

- **P-36** · el stepper de «cantidad a dar de baja» ya no se ve muerto — botones `disabled` no se
  encienden al hover (`enabled:hover:`) + estado disabled evidente + `aria-disabled`. La lógica ya era
  correcta (la carta tenía 1 pieza → tope legítimo). QA aprobado.

---

## Abiertos

### P-37 · Redundancia del IVA en los diales de M10 (config)
- **Encontrado con el humano (2026-08-23):** `IVA_PCT` (16, %) y `STRIPE_FEE_IVA_PCT` (0.16, fracción)
  son el MISMO 16% de IVA en dos diales y dos formatos. Riesgo de drift money-unsafe (cambiar uno y no el
  otro rompe el gross-up de Stripe). → consolidar a un solo dial de IVA del que Stripe derive.
- **Roles:** arquitecto (DTO de settings) → backend + frontend. **Pendiente decisión del humano.**

### P-38 · Módulo de producto SELLADO robusto (cura de raíz de SB-D5) — **GRANDE, diseño primero**
- **Observado por el humano (2026-08-23, prod):** al dar de alta un **ETB** salió como **«Tropius #1 ·
  sealed»** y «SIN MAPEO». Causa raíz: el alta de P-35 es un puente mínimo que **ancla el sellado a una
  carta suelta representativa** (SB-D5) en vez de tener identidad propia de producto sellado.
- **Qué pide el humano (4 piezas):**
  1. **Módulo que descargue las presentaciones de sellado de cada set** (ETB, UPC, Booster Bundle, booster
     box, blíster…) desde TCGCSV como **entidades reales `SealedProduct`** (no ancladas a un single).
  2. **Alta = solo seleccionar** la presentación → entra al inventario con su identidad correcta.
  3. **Precio en vivo** al dar de alta (busca en la fuente en ese momento).
  4. **Fallback manual** si no encuentra precio.
- **Alcance:** nueva entidad `SealedProduct` + módulo de sync + contrato + schema + flujo de alta + pricing.
  Reemplaza el puente ancla-a-single de P-35. Money-safe: sin precio → pendiente/manual, nunca 0.
- **Roles:** arquitecto (modelo `SealedProduct` + sync + contrato/schema) → backend + frontend + ux-ui.
  **Grande**: diseño primero.

### P-39 · Foto de baja resolución en «Piezas destacadas» del home
- **Observado por el humano (2026-08-23, prod):** la imagen de la carta destacada en el home se ve de
  baja calidad. El backend ya expone `imageSmallUrl` **y** `imageLargeUrl`; el featured usa la chica.
- **Roles:** frontend — usar `imageLargeUrl` en el featured/vistas prominentes (grid denso puede seguir
  con la chica por perf). Sin cambio de backend.

### P-40 · Mostrar el tipo de acabado en las publicaciones
- **Pedido del humano (2026-08-23):** que las publicaciones (tejas del catálogo/home) muestren el
  **acabado** (Normal / Reverse Holo / Holofoil). El `GroupedListingDTO` ya trae `finish`; falta pintarlo.
- **Roles:** frontend — añadir la etiqueta de acabado a las tejas, respetando el visual del rediseño.

### P-41 · El Tropius de Pitch Black no aparece en el cotizador del home
- **Observado por el humano (2026-08-23, prod):** al buscar «tropius» en el cotizador (buylist) del home,
  salen Shining Fates/Cosmic Eclipse/Deoxys/Plasma Blast/Mysterious Treasures, **pero no el de Pitch
  Black** — que sí está en el catálogo. La búsqueda del cotizador filtra distinto que el catálogo.
- **Causa raíz (diagnosticada):** el mini-cotizador del home pide `pageSize: 5` (`HomeQuoter.tsx:66`).
  Los ~6 Tropius empatan por `name`; el desempate es `setId` = **uuid aleatorio** → cuáles 5 salen es
  arbitrario y Pitch Black cae en posición ≥6, fuera del corte. NO es frontera de sync/elegibilidad/índice.
- **Fix inmediato (frontend):** subir `pageSize` del home a 20 + «ver más en /buylist». **Va en el batch
  de cotizador (P-42/P-43).**
- **Mejora opcional (arquitecto → backend):** `CARD_ORDER_BY_GLOBAL` desempata por uuid; ordenar por
  `set.releaseDate desc` para priorizar sets nuevos/relevantes. Cambio de contrato (§6). **Pend. decisión.**

### P-42 · Cotizador: carrito de venta fijo a la derecha + sombrear cartas ya agregadas
- **Pedido del humano (2026-08-23, prod):** en el cotizador (Vender/buylist):
  1. Al picar una carta, el **carrito de venta se despliega y se queda FIJO a la derecha, a la par del
     grid** (no un drawer que se abre/cierra) — más funcional para ver qué metes y cuánto llevas.
  2. Tras agregar una carta al carro, **sombrear/destacar** esa carta en el grid para distinguir cuáles
     ya están agregadas.
- **Roles:** frontend (`BuylistView.tsx`, `SellCartContents.tsx`), respetando el visual del rediseño.
  Nota: encolado detrás de P-39/P-40 (comparten zona storefront + `messages`), para no pisar archivos.

### P-43 · Click en la carta → pop-up con detalle e imagen grande legible
- **Pedido del humano (2026-08-23, prod):** al hacer **click en la carta** (no en «AGREGAR»), abrir un
  **pop-up/modal** con más detalle: imagen más grande para que el **texto de la carta se lea**. Distinto
  de «AGREGAR» (que la mete al carrito). Aplica al grid del cotizador (y catálogo si aplica).
- **Cierre:** basta **click fuera del pop-up** (en el backdrop) para cerrarlo (+ Esc por a11y).
- **Roles:** frontend (modal de detalle, reusa `imageLargeUrl` de P-39). **Va junto con P-42** (misma
  interacción de la carta en el cotizador), respetando el design system del rediseño.
### P-44 · Mostrar la RAREZA en todas las vistas de binder/catálogo
- **Pedido del humano (2026-08-23, prod):** en todas las vistas de binder/catálogo, mostrar la **rareza**
  de la carta (Illustration Rare, Full Art, Special Illustration Rare, Hyper Rare…), no solo el acabado.
  Hoy las tejas muestran `#num · ACABADO` pero no la rareza.
- **Alcance:** catálogo storefront (`CatalogTile`), cotizador, ficha, binder admin (M1/Master Set). El
  `CardDTO` ya trae `rarity`; verificar que todas las tejas lo reciben (si alguna usa un DTO sin rareza,
  pequeño add de backend). Va con P-40 (misma familia de etiqueta en la teja).
- **Roles:** frontend (+ backend si falta exponer rarity en algún DTO). Respetar el visual del rediseño.

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
