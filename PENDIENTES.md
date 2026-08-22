# PENDIENTES — TCG HUNT

Lista viva de lo que **falta** en el producto. Cuando algo se cierra, se mueve a «Hecho
(referencia)» al final o se borra. Añade nuevos como `P-#`. Última limpieza: **2026-08-22**.

---

## Abiertos

### P-28 · Los dos carritos no concuerdan en «Vender»
- **Observado por el humano (2026-08-22):** en `/buylist` (Vender), el header dice **«CARRITO 1»** y
  el botón flotante abajo muestra **«5»** — dos contadores que no coinciden.
- **Hipótesis (confirmar en código al arrancar):** son **dos carritos distintos** — el del header es
  el de **compra (tienda)** y el flotante es el de **venta (cotizador/buylist)**; coexisten en la
  misma pantalla y confunden.
- **A decidir al arreglar:** ¿ocultar el carrito de tienda dentro del flujo de Vender, o etiquetarlos
  claro (Comprar vs Vender) para que no se lean como el mismo? Si en cambio resultan ser el MISMO
  carrito descontado, es un bug de estado compartido a sincronizar.
- **Roles:** frontend (diagnóstico del estado del carrito) → ux-ui si hay decisión de presentación.

### P-29 · Baja rápida de inventario (falta el equivalente a «Alta rápida» para restar)
- **Observado por el humano (2026-08-22):** no hay forma **rápida** de **reducir** la cantidad cuando
  tienes menos piezas. Existe «Alta Rápida» para sumar, pero para bajar hay que ir **pieza por pieza**
  (INV-000012, INV-000011…).
- **Qué falta:** una **baja rápida** desde el drawer del Master Set (p. ej. «−cantidad» o dar de baja
  N piezas de un golpe), con la misma simplicidad del alta. Refinamiento de P-19 (que cerró el alta
  rápida + publicar todo, pero **no** la baja rápida).
- **Roles:** frontend (+ backend si falta endpoint de baja por cantidad); money-safe (baja no inventa
  precios).

### P-30 · Publicación ÚNICA por carta (con stock), no una publicación por cada copia
- **Observado por el humano (2026-08-22):** al publicar, cada copia física genera una **publicación
  separada** en el catálogo (Tropius aparece ×3: «01/02/03 Tropius · Pitch Black #1 · MX$15»).
- **Qué debe ser:** **una sola publicación por carta/variante**, con **cantidad/stock**, que se queda
  **viva mientras haya inventario** y se agota cuando el stock llega a 0 — no N publicaciones para N
  copias repetidas.
- **Alcance:** modelo de listing agrupado por (carta, variante, condición) con stock; afecta
  storefront (catálogo/home) y el «publicar» de inventario. Money-safe: solo publica lo que tiene
  precio.
- **Roles:** arquitecto (modelo/contrato del listing con stock) → backend + frontend.

### P-31 · Exportar inventario a Excel con un botón
- **Pedido del humano (2026-08-22):** un botón en M1 que descargue el inventario a **Excel (.xlsx)**.
- **Por definir:** columnas (carta, set, #, acabado, condición, cantidad, costo, precios
  mercado/compra/venta, folio, ubicación…), y si exporta todo o el filtro/set actual.
- **Roles:** backend (endpoint de export) + frontend (botón + descarga).

### P-32 · Valor del «set destacado» en el home está mal (muestra el ETB, no la suma de las cartas)
- **Observado por el humano (2026-08-22, ya comentado antes):** el bloque «Pitch Black · Valor de
  mercado» del home muestra **MX$15,756.32 con +157,463%** — cifra absurda. Está tomando el valor del
  **ETB (sellado)**, no la **suma del valor de mercado de las cartas del set**.
- **Contexto:** es la «gráfica pública de valor de set» (estaba anotada como *hecha y desplegada,
  falta encenderla con datos*, runbook `DEVOPS_NOTES §17`). Esta observación la afina: además de
  datos, **la fuente del cálculo está mal** (ETB en vez de Σ cartas) y el % de cambio es irreal.
- **Roles:** backend (corregir la fuente del valor del set = Σ referencias de mercado de las cartas,
  y el cálculo del % de cambio) + devops (encender datos/serie histórica).

### P-23 · Vender «meta decks» completos (bundles ready-to-play) — investigación hecha, falta aterrizar
- **Idea del humano:** apartado «Compra tu deck» — publicar los decks meta del mes como bundle
  completo, armados con nuestras cartas sueltas.
- **✅ Investigación hecha (2026-08-22):** meta Estándar post-rotación (Dragapult ex/Dusknoir el #1;
  Clefairy Box campeón NAIC; Slowking, Mega Lucario, Gholdengo; budget Crustle / Team Rocket's
  Mewtwo). Al jugador competitivo NO le importa la variante (juega la más barata legal; evitar reverse
  combadas). Pricing: suma de singles propios + premium 8–15% con desglose transparente, nunca con
  descuento; incluir energías básicas. Hueco de mercado claro en MX. Modelar como kit/BOM sobre
  `inventory` con stock verificado antes de mostrar «disponible».
- **⚠ Timing:** lanzar DESPUÉS de Worlds 2026 (28–30 ago), con el meta post-Worlds. Cadencia: revisión
  mensual (Limitless), overhaul en la rotación de abril.
- **Preguntas de producto a definir con el humano:** ¿deck solo si el inventario surte la lista
  completa o se permite parcial? ¿precio = suma de singles con ajuste o fijo por arquetipo? ¿energías
  básicas/fundas incluidas? ¿se actualiza al rotar el meta?
- **Roles:** product-owner aterriza con el humano → arquitecto/backend/frontend cuando esté definido.
- **Depende de:** inventario profundo de sueltas + precios sanos (ya listo); se conecta con los
  bounties (P-22, ya en prod) para comprar lo que falta para completar decks.

### Pendiente del humano · Razón social para el footer
- El footer de producción aún dice **«[RAZÓN SOCIAL PENDIENTE]»**. Falta que el humano dé la razón
  social para `footer.legalEntity` (check pre-existente del rebrand P-21). Solo dato del humano; el
  cableado i18n ya está.

---

## Retirados / obsoletos

### ~~P-6 · El proveedor de precios de PAGA (PPT) no escribe precios~~ — OBSOLETO (2026-08-22)
- Superado por el rediseño de esta sesión: **TCGCSV es ahora la fuente primaria** de estructura y
  precio por variante (M-31…M-35); PPT quedó como **fallback**. El adapter de PPT ya no es el camino
  crítico de precios, así que el bug del request mal formado dejó de bloquear. Si algún día se
  reactiva PPT como primario, retomar el diagnóstico original (request `GET /api/prices?setId=…`).

---

## Hecho (referencia breve — todo en producción)

- **Fix de variantes/precios de raíz (esta sesión):** modelo 1 carta ↔ N productos por productId
  exacto, TCGCSV fuente única de estructura+precio por variante, FX Banxico, PPT fallback, catálogo
  canónico de rarezas, «Unificar rarezas», refresh solo-TCGCSV por-set y batch, limpieza del panel
  admin M2 (M-31…M-36). Fantasma `normal` muerto por construcción.
- **P-27** · Sets multi-parte combinados (Celebrations = 50) — en producción. *(Pendientes menores:
  P27-D2 el cotizador aún no combina; P27-D3 validar y activar los pares Shiny Vault — ver
  `TECH_DEBT.md`.)*
- **Streams A/B/C** (catálogo y precios, inventario Master Set, cotizador v2), **P-1–P-5** (flujo de
  alta M1), **P-11–P-22, P-24, P-25** (gating, consola de precios, alta/baja rápida base, gradeadas,
  top bounties, desglose de valor, pestaña sellado), **P-21** (rebrand TCG HUNT + switch de dominio a
  tcghunt.mx), **P-26** (sellado como producto de primera clase). Todo con doble/triple veredicto y en
  producción.
