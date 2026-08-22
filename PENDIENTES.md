# PENDIENTES — TCG HUNT

Lista viva de lo que **falta** en el producto. Cuando algo se cierra, se mueve a «Hecho
(referencia)» al final o se borra. Añade nuevos como `P-#`. Última limpieza: **2026-08-22**.

---

## Listo en `main` — esperando «publica» (NO en producción aún)

Doble veredicto por-stream aprobado (QA + techlead); mergeado a `main`. Se despliega a producción
solo cuando el humano diga **«publica»**.

- **P-35** · Alta dedicada de producto **SELLADO** con imagen de API → flujo `SealedAddFlow` de 2 pasos
  en M1 (grid de productos sellados del set con imagen real, NO singles), endpoint
  `GET /admin/inventory/sealed-catalog`, alta reusando `items/batch` con mapeo TCGCSV (nace mapeada,
  valúa en el acto), allowlist de host anti-XSS. Retirado el sellado del buscador de cartas. Money-safe.
  Migración **M-37** (3 columnas nullable). Contrato **v1.36**.
- **P-34** · Pricing por **tiers** (5 tiers en vez de ~30 rarezas) → `common/pricing-tiers.ts`,
  `TieredRuleSet` + `buildEffectiveRuleSet`, editor M2 (5 filas buy+sell + asignador rareza→tier),
  invariante premium→pct (422). Sin-mapear corregidas a premium (fix de dinero). **T2 Rare/Holo a 25%**
  (decisión del humano). Aplica a compra y venta. Sin DDL (M-38 = seed/data). Contrato **v1.37.1**.
  *(Bandera: Uncommon sube compra $0.50→$1.50 al ir en T1 — reversible sin código; ver ARCHITECTURE §4.33g.)*
- **H9** · Guardarraíl: el sellado ya no aparece en la ficha/listado público de **singles** (P-35 lo
  volvía determinista en la carta ancla). Cura de raíz pendiente en SB-D5 (entidad `SealedProduct`).
  *(Deuda: reconciliar el contrato de `/catalog/cards` + `facets` re: sealed — se coordina con el rediseño.)*

**Backfill post-deploy (devops):** correr `POST /admin/catalog/unify-rarities` tras publicar P-34 para
re-derivar `Card.rarityCanonical` de las canónicas nuevas (divergencia solo cosmética del editor; la
cotización ya es correcta). Documentar en el runbook.

---

## Abiertos

### P-30 · Publicación ÚNICA por carta (con stock), no una publicación por cada copia
- **Observado por el humano (2026-08-22):** al publicar, cada copia física genera una **publicación
  separada** en el catálogo (Tropius aparece ×3: «01/02/03 Tropius · Pitch Black #1 · MX$15»).
- **Qué debe ser:** **una sola publicación por carta/variante**, con **cantidad/stock**, viva
  **mientras haya inventario** y agotada cuando el stock llega a 0 — no N publicaciones para N copias.
- **Alcance:** modelo de listing agrupado por (carta, variante, condición) con stock; afecta storefront
  (catálogo/home) y el «publicar» de inventario. Money-safe: solo publica lo que tiene precio.
- **Relación:** toca la misma zona storefront que el **rediseño** en curso y que H9/SB-D5 — coordinar
  para no reescribir el catálogo dos veces.
- **Roles:** arquitecto (modelo/contrato del listing con stock) → backend + frontend. **Grande**
  (toca schema/contrato + storefront + inventario): diseño primero, coordinado con el rediseño.

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
