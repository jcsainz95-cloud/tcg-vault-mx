# PENDIENTES — TCG HUNT

Lista viva de lo que **falta** en el producto. Cuando algo se cierra, se mueve a «Hecho
(referencia)» al final o se borra. Añade nuevos como `P-#`. Última limpieza: **2026-08-22**.

---

## Listo en `main` — esperando «publica» (NO en producción aún)

Doble veredicto por-stream aprobado (QA + techlead); mergeado a `main`. Se despliega a producción
solo cuando el humano diga **«publica»**.

- **P-30** · Publicación **ÚNICA por carta con stock** (ya no una publicación por copia) → modelo de
  listing agrupado por `(cardId, productType, gradeKey, finish)` con `stockCount`, agregación en lectura
  **sin migración** (`GroupedListingDTO`, contrato **v1.38**). Una teja «N disponibles» en vez de N
  copias; add-to-cart por `units[]` cheapest-first (re-cotiza por pieza en checkout). Money-safe (precio
  de grupo = mínimo/«desde», sin precio → pendiente, nunca 0). Frontend adaptado **sobre el rediseño**
  (badge «Queda 1» para singles). Deuda: FE-2 «desde»/sin-IVA (ligada a H1) y H1-H4 backend en `TECH_DEBT`.
- **Rediseño makeover 1a del storefront** → nueva capa visual del catálogo/home/ficha (componentes
  `_shared/`, `StockBadge` con variante «Agotado», a11y/perf). Doble veredicto propio de su sesión.
  Deuda registrada MK-D1…MK-D9 en `TECH_DEBT`.

---

## Abiertos

### P-36 · Los botones +/− de «cantidad a dar de baja» no responden (Baja rápida, M1)
- **Observado por el humano (2026-08-23, prod):** en el panel «Baja rápida» del drawer del Master Set,
  el stepper «− 1 +» de CANTIDAD A DAR DE BAJA no cambia el número (captura: Tropius #1 RAW NM, «1 piezas
  disponibles»). A confirmar en diagnóstico: ¿bug real del stepper aun con >1 pieza, o topado a 1 pero se
  ve clickeable-muerto (debería verse deshabilitado)?, y si `removableCount` está mal calculado.
- **Roles:** frontend (`QuickRemove.tsx`, componente de P-29). Money-safe: nunca dar de baja más piezas
  de las realmente disponibles.

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
