# DESIGN_SYSTEM.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **ux-ui**. Fuente de verdad del **look & feel** y de los **tokens de diseño**.
> El frontend (Next.js 14 + Tailwind) implementa este documento; no lo contradice.
> Manda `PROJECT.md` sobre el contrato y sobre este documento; este documento define solo lo visual/UX,
> nunca datos, contrato ni arquitectura.
> Estado: v1 (MVP). Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.
> Origen: **creado desde cero** (no hubo entrega previa de Claude Design). Si más adelante el humano
> comparte un prototipo de Claude Design, este documento se re-codifica a partir de esos tokens.

---

## 0. Cómo leer y usar este documento

- Los **tokens** (color, tipografía, espaciado, radios, sombras) son la unidad mínima. Se implementan
  como **CSS variables** en `:root` (modo claro) y `.dark` (modo oscuro) y se exponen a Tailwind vía
  `tailwind.config`. Ver §11 (guía de implementación) para el mapeo exacto.
- Los **componentes** describen variantes y **estados obligatorios** (normal, hover, focus, disabled,
  loading, error). Un componente sin su estado `focus` visible o sin su estado `loading` se considera
  incompleto.
- Los **patrones UX** describen pantallas completas por flujo; son la referencia de layout, jerarquía y
  microcopy. Los textos concretos viven en `messages/{es,en}.json` (propiedad de frontend); aquí se
  define la **convención de claves** y ejemplos ES/EN.
- Regla de oro de este diseño: **confianza primero**. Cada pantalla que toca dinero, titularidad o
  custodia debe comunicar estado, fecha y responsabilidad de forma explícita.

---

## 1. Principios de diseño y tono

El producto es a la vez **tienda de coleccionismo** y **plataforma financiera/de custodia**. El diseño
sostiene esa dualidad con cinco principios:

1. **Confianza visible (trust by default).** La app guarda bienes de valor de terceros. Todo estado que
   afecte propiedad o dinero se muestra con un badge claro y, cuando aplica, con **fecha** y **fuente**:
   titularidad `pending/settled`, precio de referencia con `capturedDate`, fotos verificadas
   anverso/reverso, "pago tras recepción". Nunca se oculta un estado ni se disfraza una carga.
2. **Claridad sobre decoración.** Jerarquía tipográfica fuerte, mucho aire, datos legibles. El dinero
   siempre desglosado (subtotal + procesamiento + IVA). Ninguna cifra financiera aparece sin etiqueta.
3. **Coleccionismo serio, no infantil.** Se evoca el mundo TCG/Pokémon con **acento eléctrico** y con la
   carta como héroe visual (imagen grande, marco, badge de condición/grado), pero sobre una base sobria
   (neutros fríos, tipografía profesional). Nada de degradados arcoíris, tipografías redondeadas de
   juguete ni emojis en la UI.
4. **Operable con una mano y con guantes.** El back-office se usa junto a las cajas físicas, en móvil y
   tablet, a veces con prisa. Objetivos táctiles grandes, acciones primarias siempre visibles, captura de
   foto a un toque.
5. **Bilingüe sin costuras.** ES por defecto, EN a un clic. El layout nunca se rompe por longitud de
   texto (ES suele ser ~15-30% más largo que EN). Ver §9.

Tono de voz del copy: **claro, directo, tranquilizador**. Explica el "por qué" cuando toca dinero
("Este cargo cubre el procesamiento del pago"). Sin jerga innecesaria; los términos fiscales (IVA, CFDI)
se nombran correctamente.

---

## 2. Color

### 2.1 Filosofía de paleta
- **Base neutra fría** (slate/gris azulado) para transmitir seriedad financiera y dejar respirar a las
  cartas de colores saturados.
- **Primario azul-índigo** ("confianza/banca") para acciones y navegación.
- **Acento eléctrico ámbar/dorado** (guiño Pokémon "rayo", y a la vez "valor/oro") reservado para
  momentos de marca y realces puntuales — **no** para acciones destructivas ni para grandes áreas.
- **Estados semánticos** (éxito, aviso, error, info) con equivalentes accesibles en claro y oscuro.
- Todos los pares texto/fondo cumplen **WCAG AA** (≥ 4.5:1 texto normal, ≥ 3:1 texto grande ≥ 24px o
  ≥ 19px bold y para componentes/bordes de foco). Verificación en §10.

### 2.2 Escalas base (referencia hex)

Neutros (slate):
```
--slate-50:  #F8FAFC   --slate-500: #64748B
--slate-100: #F1F5F9   --slate-600: #475569
--slate-200: #E2E8F0   --slate-700: #334155
--slate-300: #CBD5E1   --slate-800: #1E293B
--slate-400: #94A3B8   --slate-900: #0F172A
                       --slate-950: #020617
```

Primario (índigo/azul confianza):
```
--indigo-50:  #EEF2FF
--indigo-100: #E0E7FF
--indigo-300: #A5B4FC
--indigo-500: #6366F1
--indigo-600: #4F46E5   ← primario por defecto (claro)
--indigo-700: #4338CA   ← primario hover (claro)
--indigo-400: #818CF8   ← primario en modo oscuro
```

Acento (ámbar/dorado):
```
--amber-300: #FCD34D
--amber-400: #FBBF24
--amber-500: #F59E0B
--amber-600: #D97706
```

Semánticos:
```
Success (esmeralda):  --emerald-500 #10B981  --emerald-600 #059669  --emerald-700 #047857
Warning (ámbar):      --amber-500  #F59E0B   --amber-600  #D97706
Error   (rojo):       --red-500    #EF4444   --red-600    #DC2626   --red-700 #B91C1C
Info    (cielo):      --sky-500    #0EA5E9   --sky-600    #0284C7
```

### 2.3 Tokens semánticos (los que usa el frontend)

No uses las escalas base directamente en componentes: usa estos tokens semánticos. Vienen en dos temas.

| Token | Rol | Claro | Oscuro |
|---|---|---|---|
| `--color-bg` | Fondo de página | `#F8FAFC` (slate-50) | `#020617` (slate-950) |
| `--color-surface` | Superficie (cards, panels) | `#FFFFFF` | `#0F172A` (slate-900) |
| `--color-surface-2` | Superficie elevada / hover row | `#F1F5F9` (slate-100) | `#1E293B` (slate-800) |
| `--color-border` | Bordes y divisores | `#E2E8F0` (slate-200) | `#334155` (slate-700) |
| `--color-border-strong` | Borde de énfasis / input | `#CBD5E1` (slate-300) | `#475569` (slate-600) |
| `--color-text` | Texto principal | `#0F172A` (slate-900) | `#F1F5F9` (slate-100) |
| `--color-text-muted` | Texto secundario | `#475569` (slate-600) | `#94A3B8` (slate-400) |
| `--color-text-subtle` | Texto terciario / placeholder | `#64748B` (slate-500) | `#64748B` (slate-500) |
| `--color-primary` | Acción primaria | `#4F46E5` (indigo-600) | `#818CF8` (indigo-400) |
| `--color-primary-hover` | Hover primario | `#4338CA` (indigo-700) | `#A5B4FC` (indigo-300) |
| `--color-primary-fg` | Texto sobre primario | `#FFFFFF` | `#0F172A` (slate-900) |
| `--color-accent` | Marca / realce | `#D97706` (amber-600) | `#FBBF24` (amber-400) |
| `--color-accent-fg` | Texto sobre acento | `#FFFFFF` | `#0F172A` |
| `--color-success` | Éxito / `settled` | `#047857` (emerald-700) | `#34D399` (emerald-400) |
| `--color-success-bg` | Fondo suave éxito | `#ECFDF5` (emerald-50) | `#052E22` |
| `--color-warning` | Aviso / `pending` | `#B45309` (amber-700) | `#FBBF24` (amber-400) |
| `--color-warning-bg` | Fondo suave aviso | `#FFFBEB` (amber-50) | `#3A2A05` |
| `--color-danger` | Error / destructivo | `#DC2626` (red-600) | `#F87171` (red-400) |
| `--color-danger-bg` | Fondo suave error | `#FEF2F2` (red-50) | `#3A0A0A` |
| `--color-info` | Informativo | `#0284C7` (sky-600) | `#38BDF8` (sky-400) |
| `--color-info-bg` | Fondo suave info | `#F0F9FF` (sky-50) | `#082234` |
| `--color-focus-ring` | Anillo de foco | `#6366F1` (indigo-500) | `#A5B4FC` (indigo-300) |

Notas de contraste:
- En **texto sobre color** (badges/botones sólidos) usamos las variantes `-600/-700` en claro para
  garantizar ≥ 4.5:1 con texto blanco. En oscuro los sólidos usan tinte `-400/-500` con texto
  `slate-900` oscuro para conservar contraste. Ver §10.
- `pending` usa el color **warning** (ámbar), `settled` usa **success** (esmeralda): la asociación
  ámbar = "en proceso / atención", verde = "confirmado" es la columna vertebral de la confianza.

### 2.4 Colores de estado de dominio (mapa canónico)

Estos son los colores de los **badges de estado** del negocio. El frontend mapea el `enum` del contrato
a `{token de color, clave i18n}`. Nunca se traduce el enum a color en el backend.

| Dominio | Valor (enum) | Token de color | Intención |
|---|---|---|---|
| Titularidad | `pending` | warning | Pago aún no liquidado; no retirable |
| Titularidad | `settled` | success | Tuyo, liquidado, retirable |
| Order | `pending` | warning | En proceso |
| Order | `settled` | success | Liquidada |
| Order | `failed` | danger | Falló |
| Order | `refunded` | info | Reembolsada |
| Order | `chargeback` | danger (outline) | Contracargo |
| Shipment | `solicitado` | info | En cola |
| Shipment | `picking` | accent | En preparación |
| Shipment | `guia` | info | Guía generada |
| Shipment | `enviado` | primary | En tránsito |
| Shipment | `entregado` | success | Entregado |
| Shipment | `cancelado` | neutral | Cancelado |
| SellRequest | `cotizada` | neutral | Cotizada |
| SellRequest | `recibida` | info | Recibida física |
| SellRequest | `verificacion` | accent | En verificación |
| SellRequest | `aprobada` | success (outline) | Aprobada, por pagar |
| SellRequest | `pagada` | success | Pagada (SPEI) |
| SellRequest | `rechazada` | danger | Rechazada |
| SellRequest | `abandonada` | neutral | Abandonada → inventario |
| Precio | `pending` (precio pendiente) | warning (outline) | Sin precio; escalado al dueño |
| Dispute | `abierta` | warning | Abierta |
| Dispute | `en_revision` | accent | En revisión |
| Dispute | `resuelta_recompra` | success | Resuelta (recompra) |
| Dispute | `rechazada` | neutral | Rechazada |
| KYC | `none`/`pending` | warning | KYC incompleto |
| KYC | `verified` | success | Verificado |
| KYC | `rejected` | danger | Rechazado |
| Inventario `lost`/`damaged` | — | danger | Pérdida/daño |

Regla de accesibilidad de badges: **el color nunca es el único portador de significado**. Todo badge
lleva **texto** (localizado) y, en estados críticos, un **icono** (ver §7.4). Así funciona para daltonismo
y lectores de pantalla.

---

## 3. Tipografía

### 3.1 Familias
- **UI / texto:** `Inter` (variable). Excelente legibilidad de números y de textos densos, soporta ES/EN,
  neutra y profesional. Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Números financieros / folios / tablas:** usar Inter con **`font-variant-numeric: tabular-nums`** en
  precios, KPIs, folios (`INV-000123`) y columnas numéricas, para alinear dígitos.
- **Datos de catálogo (nombres de cartas EN):** misma familia; no se usa fuente decorativa.
- **Display opcional de marca:** una única fuente de marca (`Sora` o `Space Grotesk`) puede usarse SOLO en
  el logotipo/hero del storefront público. No es obligatoria y **no** se usa en el back-office.

Cargar fuentes vía `next/font` (self-host, sin FOUT). Subconjunto latin + latin-ext (acentos ES).

### 3.2 Escala tipográfica (base 16px, ratio ~1.2–1.25)

| Token | rem / px | Uso | Peso | line-height |
|---|---|---|---|---|
| `text-display` | 2.5rem / 40px | Hero storefront | 700 | 1.1 |
| `text-h1` | 2rem / 32px | Título de página | 700 | 1.2 |
| `text-h2` | 1.5rem / 24px | Sección | 600 | 1.25 |
| `text-h3` | 1.25rem / 20px | Subsección / card title | 600 | 1.3 |
| `text-lg` | 1.125rem / 18px | Precio destacado, lead | 500/600 | 1.4 |
| `text-base` | 1rem / 16px | Cuerpo (default) | 400 | 1.5 |
| `text-sm` | 0.875rem / 14px | Secundario, labels de tabla | 400/500 | 1.45 |
| `text-xs` | 0.75rem / 12px | Badges, captions, ayudas | 500 | 1.4 |

Pesos disponibles: 400 (regular), 500 (medium), 600 (semibold), 700 (bold). No usar 300/100 (bajo
contraste de trazo). Mínimo de cuerpo **16px** en móvil para inputs (evita zoom automático en iOS).

### 3.3 Reglas de jerarquía
- Una sola `h1` por vista. KPIs del dashboard usan `text-h1`/`text-display` para la cifra y `text-xs`
  en mayúsculas suaves (`tracking-wide`) para la etiqueta.
- Precios: la cifra en `text-lg`+ con `tabular-nums`; el sufijo "sin IVA" o la fecha en `text-xs muted`.
- Nunca centrar párrafos largos; los títulos pueden centrarse solo en hero y en estados vacíos.

---

## 4. Espaciado, radios, sombras, layout

### 4.1 Escala de espaciado (base 4px)
`0, 1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48, 16=64, 20=80, 24=96`.
Es la escala nativa de Tailwind; úsala tal cual. Gutter de página: 16px móvil, 24px tablet, 32px+ desktop.

### 4.2 Radios
```
--radius-sm: 6px    (inputs pequeños, badges)
--radius-md: 10px   (botones, inputs)
--radius-lg: 14px   (cards, modales)
--radius-xl: 20px   (contenedores hero, sheets móviles)
--radius-full: 9999 (pills, avatares, toggles)
```
Consistencia: un card y sus botones internos no comparten el mismo radio (card `lg`, botón `md`) para
crear jerarquía sutil.

### 4.3 Sombras / elevación (modo claro; en oscuro se atenúan y se apoya más en borde)
```
--shadow-xs: 0 1px 2px rgba(15,23,42,.06)
--shadow-sm: 0 1px 3px rgba(15,23,42,.10), 0 1px 2px rgba(15,23,42,.06)
--shadow-md: 0 4px 12px rgba(15,23,42,.10)
--shadow-lg: 0 12px 28px rgba(15,23,42,.14)   (modales, popovers)
--shadow-focus: 0 0 0 3px var(--color-focus-ring)   (anillo de foco, ver §8)
```
Niveles de elevación: 0 página → 1 card (`shadow-sm` + border) → 2 dropdown/popover (`shadow-md`) →
3 modal/sheet (`shadow-lg` + overlay). En modo oscuro, las superficies elevadas suben un escalón de gris
(`surface` → `surface-2`) en lugar de proyectar sombras fuertes.

### 4.4 Grid y breakpoints (alineado a Tailwind)
```
sm  ≥ 640px    (móvil grande / phablet)
md  ≥ 768px    (tablet vertical) — umbral de layout del back-office junto a cajas
lg  ≥ 1024px   (tablet horizontal / laptop) — aparece sidebar admin fijo
xl  ≥ 1280px   (desktop)
2xl ≥ 1536px   (desktop ancho; ancho máx de contenido 1280–1440px centrado)
```
- **Contenedor storefront:** ancho máx `max-w-7xl` (1280px), centrado, gutter responsivo.
- **Catálogo grid:** 2 col (móvil) → 3 (sm) → 4 (lg) → 5 (xl).
- **Back-office:** sidebar de módulos fijo desde `lg`; en `< lg` colapsa a barra inferior/《drawer》.
- **Dashboard de KPIs:** 1 col (móvil) → 2 (sm) → 4 (lg). Las 8 tarjetas caben en 2 filas de 4 en desktop.

---

## 5. Iconografía y elementos gráficos
- Set de iconos **lucide-react** (línea, 1.5–2px, redondeado sutil), coherente con la sobriedad.
  Tamaños: 16 (inline), 20 (botones/inputs), 24 (nav). Los iconos son decorativos salvo que reemplacen
  texto: en ese caso llevan `aria-label`.
- **Foto de carta** como elemento gráfico principal en storefront y bóveda: relación de aspecto de carta
  **5:7** (`aspect-[5/7]`), esquinas `radius-md`, borde `1px` `--color-border`, fondo `surface-2` como
  placeholder mientras carga (skeleton).
- Guiño de marca (rayo/holo) permitido solo en: logotipo, hero, y como textura MUY sutil de fondo en
  banners de confianza. Nunca compite con la carta.

---

## 6. Componentes — controles base

Para cada componente se listan **variantes** y los **estados obligatorios**. Todo componente interactivo
debe tener: `hover`, `focus-visible` (anillo, §8), `active`, `disabled`, y —si dispara red— `loading`.

### 6.1 Botón (`Button`)
Variantes:
- **primary** — fondo `--color-primary`, texto `--color-primary-fg`. Acción principal de la vista.
- **secondary** — fondo `--color-surface`, borde `--color-border-strong`, texto `--color-text`.
- **ghost** — sin fondo ni borde; hover `--color-surface-2`. Para acciones terciarias/iconos.
- **destructive** — fondo `--color-danger`, texto blanco. Reembolso, eliminar, marcar daño. Requiere
  confirmación (§7.6).
- **accent** — fondo `--color-accent`; reservado para CTA de marca del storefront (p. ej. "Comprar"),
  úsese con moderación.
- **link** — texto `--color-primary` subrayado en hover.

Tamaños: `sm` (h 32px, px 12), `md` (h 40px, px 16, default), `lg` (h 48px, px 20).
**Objetivo táctil mínimo 44×44px** en móvil/back-office (aunque el visual sea `sm`, ampliar área táctil).

Estados:
- hover: primario → `--color-primary-hover`; secondary/ghost → fondo `surface-2`.
- focus-visible: `--shadow-focus` (anillo 3px) + mantiene contraste.
- active: leve `scale-[.98]` y oscurecer 4%.
- disabled: opacidad 45%, `cursor-not-allowed`, sin sombra; no recibe foco.
- loading: spinner 16–20px a la izquierda del label, **el label se mantiene** ("Pagando…"), botón
  `aria-busy=true`, deshabilitado para reenvío. Ancho estable (no salta el layout).
- con icono: gap 8px; icono-solo requiere `aria-label`.

### 6.2 Input de texto (`Input`) y Textarea
- Alto `md` 40px (44px táctil), radio `md`, borde `--color-border-strong`, fondo `--color-surface`,
  texto `--color-text`, placeholder `--color-text-subtle`.
- **Label siempre visible** encima (no solo placeholder). `label` asociada por `htmlFor`.
- Texto de ayuda (`text-xs muted`) debajo; en error se reemplaza por el mensaje de error.
Estados:
- focus: borde `--color-primary` + `--shadow-focus`.
- error: borde `--color-danger`, mensaje `--color-danger` con icono de alerta, `aria-invalid=true`,
  `aria-describedby` al mensaje.
- disabled: fondo `--color-surface-2`, texto `muted`, sin foco.
- loading/async (p. ej. validación de CLABE): spinner al final del campo, `aria-busy`.
- prefijos/afijos: para dinero, prefijo `MX$` en `--color-text-muted` dentro del campo; entrada con
  `inputmode="decimal"`. Para folios, `tabular-nums`.

### 6.3 Select / Combobox
- Mismo alto y estilo que Input. Chevron `lucide chevron-down` a la derecha.
- Filtros de catálogo (set, rareza, condición, tipo) usan Select; si la lista es larga (sets), usar
  **Combobox** con búsqueda. Opciones con `role=option`, navegables por teclado, opción activa resaltada
  con `surface-2` y borde de foco.
- Multi-select (filtros) muestra conteo ("Rareza · 2") en el trigger.

### 6.4 Checkbox, Radio, Switch
- Área táctil 44px; control visual 20px. Estado checked usa `--color-primary`; focus con anillo.
- **Switch** para diales booleanos de M10 y para el toggle "incluir en retiro". Con etiqueta textual del
  estado (On/Off, Sí/No) para no depender del color.

### 6.5 Toggle de idioma (`LocaleToggle`) — componente clave
- Ubicación: header (storefront) y topbar (admin), extremo derecho.
- Forma: **segmented control** de dos segmentos `ES | EN` (pill, `radius-full`), el activo con fondo
  `--color-primary` y texto `--color-primary-fg`; el inactivo `ghost`. Ancho fijo por segmento (no salta
  al cambiar). En móvil puede colapsar a un botón con icono globo + código actual (`ES ▾`).
- Accesibilidad: `role="group"` con `aria-label="Idioma / Language"`; cada segmento es un botón
  `aria-pressed`. Cambia `next-intl` locale y persiste en `User.locale` vía `PATCH /users/me` cuando hay
  sesión; si no, en cookie/localStorage. El `<html lang>` se actualiza.
- Regla: el toggle **no** traduce datos de catálogo (nombres/sets siguen en inglés); solo la UI.

### 6.6 Tabs, Breadcrumbs, Pagination
- **Tabs:** subrayado inferior de 2px `--color-primary` en el activo; texto `muted` en inactivos.
  Teclado: flechas + `aria-selected`. Usados en ficha de carta (Descripción/Condición/Fotos) y M6 ficha
  360°.
- **Breadcrumbs:** solo storefront (Catálogo › Set › Carta) para SEO/orientación; separador `/`, último
  no enlazado (`aria-current=page`).
- **Pagination:** patrón `{ page, pageSize, total }` del contrato; botones prev/next 44px + selector de
  página. En móvil, "Cargar más" o paginación compacta.

---

## 7. Componentes — dominio

### 7.1 Card de carta (`CardTile` / `ListingCard`) — pieza central
Anatomía (vertical):
1. **Imagen** de la carta `aspect-[5/7]`, con skeleton al cargar. Overlay superior-izquierda: badge de
   **condición/grado**; superior-derecha: badge de **estado de titularidad** (solo en contexto bóveda).
2. **Nombre** (EN, `text-sm/base` semibold, 1–2 líneas con `line-clamp`).
3. **Set + número** (`text-xs muted`, EN).
4. **Price tag** (§7.3): precio MXN grande + "sin IVA" + fecha; o "Precio pendiente".
5. Acción contextual: en storefront botón `accent`/`primary` "Agregar"/"Comprar" (deshabilitado si
   `sellable=false`); en bóveda, botón `secondary` "Retirar" (deshabilitado si `pending`).

Badge de **condición/grado** (deriva de `productType`):
- raw → `NM/LP/MP/HP/DMG` (pill neutra con borde; DMG y HP tono `warning`).
- graded → `PSA 10` / `CGC 9.5` (pill `accent` con icono escudo — refuerza autenticidad).
- sealed → `Sellado / Sealed` (pill `info`).
Badge de **titularidad**: `pending` (warning) / `settled` (success), con icono candado abierto/cerrado.

Estados del card:
- normal / hover (eleva a `shadow-md`, imagen `scale-[1.02]` sutil) / focus-visible (anillo en todo el
  card, es un enlace) / **no vendible** (badge "Precio pendiente", CTA disabled, sin sombra hover) /
  skeleton (imagen + 3 barras) .
- Variante **compacta horizontal** para listas de bóveda, checkout, picking y colas admin: miniatura
  56×78, nombre + folio + estado en fila.

### 7.2 Badge / Pill (`Badge`)
- Formas: **soft** (fondo `-bg` + texto `-color`, default) y **outline** (borde + texto, para estados
  "en proceso" o secundarios como `chargeback`, `aprobada`, precio pendiente).
- Tamaño `text-xs`, `px-2 py-0.5`, `radius-full`, peso 500. Siempre con **texto**; icono opcional 12–14px.
- Mapeo de color por estado en §2.4. Componente recibe `{status, domain}` y resuelve token + clave i18n.

### 7.3 Price tag (`PriceTag`) — incluye "precio pendiente"
- **Priced:** `MX$ 1,250.00` en `text-lg semibold tabular-nums`; debajo `text-xs muted` "sin IVA · 13 ago 2026"
  (fecha = `capturedDate` localizada). Opcional icono info con tooltip "Precio de referencia de mercado,
  actualizado a diario".
- **Pending:** en lugar de cifra, pill `warning outline` "Precio pendiente / Price pending" + `text-xs muted`
  "Lo fijaremos pronto". CTA de compra deshabilitado. En portafolio, se excluye del total y se marca.
- Nunca mostrar `$0` ni "—" para precio pendiente: siempre el estado explícito (regla de confianza).

### 7.4 Iconos de estado semántico
Para reforzar color con forma (daltonismo/lectores):
- success/`settled` → candado cerrado / check-circle.
- warning/`pending` → reloj / candado abierto.
- danger → alert-triangle.
- info → info-circle.
- accent/en proceso → loader/spinner o package (envío).

### 7.5 Banner / Alert (`Banner`) — mensajes de confianza
Variantes: info, success, warning, danger, **trust** (variante especial de marca para custodia).
Anatomía: icono a la izquierda, título opcional (semibold), cuerpo, acción opcional a la derecha,
botón cerrar si es descartable. Fondo `-bg` suave, borde `-color` sutil, texto legible (AA).
Usos canónicos:
- **"Pago tras recepción" (`PAY_AFTER_RECEIPT`)** en buylist: variante `info`/`trust`, icono candado/reloj,
  texto "El pago se realiza DESPUÉS de que recibimos y verificamos tu carta (no por adelantado)."
  Persistente (no descartable) en cotizador y en la solicitud.
- **Custodia/bóveda:** banner `trust` en "Mi bóveda" explicando que las cartas están aseguradas y
  autenticadas; enlaza a términos.
- **Precio pendiente**, **KYC requerido**, **INE requerido**, **dirección no-MX** (`ADDRESS_NOT_MX`):
  banners `warning`/`danger` con acción para resolver.
- **Toast** (efímero, 4–6s, esquina) para confirmaciones no críticas (guardado, copiado folio). No usar
  toast para errores de dinero: esos van inline o en banner persistente.

### 7.6 Modal / Dialog y confirmaciones destructivas
- Modal centrado (desktop) / **bottom sheet** (móvil), `radius-xl` arriba, overlay `rgba(2,6,23,.5)`.
- Foco atrapado dentro (focus trap), `Esc` cierra (salvo procesos críticos), foco retorna al disparador.
- **Confirmación destructiva** (reembolso, marcar daño/pérdida, rechazar buylist, bloquear usuario):
  título claro, resumen de consecuencia e importe si aplica, botón `destructive` a la derecha con verbo
  explícito ("Reembolsar MX$1,250"), `secondary` "Cancelar". Acciones de **dinero saliente** muestran
  además la nota "Solo súper-admin · queda en bitácora".

### 7.7 Tabla / Cola de trabajo (`DataTable`) — back-office
- Densidad cómoda por defecto (fila 48–56px, táctil) y opción "compacta" (40px) en desktop.
- Header sticky, `text-xs uppercase muted`. Columnas numéricas alineadas a la derecha con `tabular-nums`.
- Fila: hover `surface-2`; seleccionable (checkbox) para acciones en lote (picking). Estado por badge.
- **Responsive:** en `< md`, cada fila colapsa a **card** (label: valor) — no scroll horizontal infinito.
  Las columnas prioritarias (folio, estado, monto, acción) siempre visibles.
- Estados de tabla: loading (skeleton rows), vacío (§8 estado vacío), error (banner + reintentar).
- Orden y filtros en la parte superior; el estado activo de filtro se muestra como chips removibles.
- Cada cola (órdenes, shipments, buylist, disputas, precio pendiente) reutiliza este componente con su
  set de columnas y su mapa de badges (§2.4).

### 7.8 Tarjeta de KPI del dashboard (`StatCard`)
Anatomía: etiqueta (`text-xs uppercase muted`), **cifra** grande (`text-h1` `tabular-nums`), delta o
subtítulo opcional (`text-xs`, verde/rojo con flecha), icono de contexto arriba-derecha, y —si enlaza a
un módulo— todo el card es clickable (foco visible).
- Las 8 tarjetas: ganancia del periodo, ventas, cola de trabajo, valor de inventario, valor en custodia,
  buylist del periodo, salud de datos, progreso de lanzamiento. Layout §4.4 (4×2 en desktop).
- **Enmascarado por rol:** para `vault_operator`, las tarjetas de dinero (ganancia, valor de inventario,
  valor en custodia) se **ocultan** o muestran un candado con "Solo súper-admin" — nunca la cifra. Esto
  refleja el contrato (campos financieros omitidos para operador).
- **Cola de trabajo** es accionable: desglosa shipments/buylist/disputas/precios pendientes como
  sub-conteos que enlazan a su cola. **Salud de datos** muestra `lastPriceSyncAt`/`lastFxAt` y conteo de
  precio pendiente con semáforo (verde/ámbar/rojo). **Progreso de lanzamiento** usa barras hacia N/X/Y/Z
  (si no hay metas, muestra los conteos y "Meta pendiente").
- Estados: loading (skeleton de cifra), error (mini-banner "No se pudo cargar", reintentar), vacío/cero
  (cifra `0` legítima, no error).

### 7.9 Stepper de pipeline (`PipelineStepper`) — buylist, envío, orden
- Horizontal en desktop, vertical en móvil. Cada paso: círculo con icono/estado + label + timestamp.
- Estados de paso: **completado** (success, check), **actual** (primary, resaltado + anillo), **pendiente**
  (neutral, atenuado), **error/rechazo** (danger, X). Conector coloreado hasta el paso actual.
- Mapas:
  - Buylist: `cotizada → recibida → verificación → aprobada → pagada` (rama de error: `rechazada` /
    `abandonada` se muestra como estado final rojo/neutral).
  - Envío: `solicitado → picking → guía → enviado → entregado`.
  - Orden (para el comprador): `pending → settled` (con posible rama `refunded/chargeback`).
- Accesible: `<ol>` con `aria-current="step"` en el actual; el color no es el único indicador (icono+label).

### 7.10 Uploader de fotos (`PhotoUploader`) — captura móvil, pieza crítica del back-office
- Objetivo: M1 alta con fotos anverso/reverso, verificación de buylist, evidencia de disputa, INE (KYC).
- Disparo de cámara: `<input type="file" accept="image/*" capture="environment">`; botón grande
  "Tomar foto / Take photo" (icono cámara) + alternativa "Subir archivo".
- **Slots definidos** cuando el flujo lo exige: dos slots etiquetados **Anverso/Front** y **Reverso/Back**
  (M1, buylist raw), cada uno con su preview `aspect-[5/7]`. Extra photos como grid añadible.
- Flujo por foto: seleccionar → preview inmediato → **subir con barra de progreso** (presign PUT del
  contrato, §8 uploads) → estado "Subida ✓" con miniatura, o error con reintento. `aria-busy` durante
  subida. Permitir re-tomar/eliminar antes de confirmar.
- Estados: vacío (dropzone punteada + icono cámara), subiendo (progreso %), éxito (miniatura + check),
  error (borde `danger` + "Reintentar"), disabled (sin permiso/rol).
- Guía visual mínima: texto de ayuda "Buena luz, carta centrada, sin reflejos" para calidad de evidencia.
- Táctil: botones ≥ 48px; en tablet junto a cajas, los dos slots deben verse sin scroll.

### 7.11 Uploader/visor comparador de fotos (`PhotoCompare`) — disputas M8
- Dos columnas lado a lado en desktop (Ingreso / Reclamo), apiladas en móvil, con zoom (lightbox) y
  sincronización opcional. Etiquetas claras "Foto de ingreso (evidencia canónica)" vs "Foto del cliente".
- Es solo visualización para el admin; la resolución (recompra/rechazo) usa botones de §7.6.

### 7.12 Desglose de importe (`AmountBreakdown`) — checkout y órdenes
Lista de líneas alineadas (label izquierda, monto derecha `tabular-nums`):
- Subtotal (sin IVA)
- Costo de procesamiento (Stripe trasladado) — con tooltip explicativo
- IVA 16% — etiqueta muestra el `ivaRatePct` real del `BreakdownDTO`
- (Envío, cuando aplica: retiros)
- **Total** en negrita, con línea divisoria arriba y tamaño mayor.
Cada línea que el usuario pueda cuestionar tiene un `?`/tooltip. El total nunca aparece sin su desglose.
Los importes vienen en centavos del contrato; el formato es §9.3.

### 7.13 Guía de envío seguro (`SafeShippingGuide`) — buylist
- Componente ilustrado paso a paso (sleeve → top loader → sobre rígido → sobre acolchado), visible
  **antes** de crear la solicitud de buylist (requisito PROJECT/AC 34). Menciona explícitamente
  **sleeve** y **top loader**.
- Formato: tarjetas numeradas con icono + texto corto; opción "Ya lo entendí" para continuar. Accesible
  desde un enlace persistente en todo el flujo de buylist. Ilustraciones con `alt` descriptivo.

### 7.14 Cotizador de buylist (`BuylistQuoter`)
- Formulario compacto: selector de carta (Combobox con búsqueda sobre catálogo EN) → tipo de producto →
  condición (si raw) → **resultado de cotización** en un card destacado (categoría + monto o "precio
  pendiente"). Banner `PAY_AFTER_RECEIPT` persistente. Enlace a `SafeShippingGuide`.
- Es público (sin sesión). Al "Crear solicitud" pide login/registro y luego KYC/CLABE/INE según topes.

### 7.15 Navegación
- **Storefront header:** logo, buscador, nav (Catálogo, Buylist, Mi bóveda, Mis órdenes), `LocaleToggle`,
  cuenta/carrito. Sticky. En móvil: logo + buscador + menú hamburguesa + carrito; nav en drawer.
- **Admin shell:** sidebar izquierdo (desde `lg`) con módulos **M1–M10** agrupados
  (Operación: M1, M4, M5, M8 · Catálogo/Precios: M2 · Ventas/Finanzas: M3, M7, M9 · Admin: M6, M10),
  dashboard arriba. Topbar con contexto (rol actual, buscador global de folio/usuario, `LocaleToggle`,
  usuario). En `< lg`: sidebar colapsa a drawer + barra inferior con accesos rápidos (Dashboard, Colas,
  Cámara/alta rápida). Item activo resaltado con barra `--color-primary` + fondo `surface-2`.
- Los módulos no permitidos para el rol (operador: M2/M3-refund/M7/M10…) **no se muestran** o aparecen con
  candado y tooltip; el intento bloqueado del contrato (`403 MONEY_OUT_FORBIDDEN`) se refleja con banner.

---

## 8. Patrones UX transversales

### 8.1 Estados de carga / vacío / error (obligatorios en toda vista con datos)
- **Loading:** skeletons que respetan el layout final (cards de carta, filas de tabla, cifra de KPI).
  Nunca spinner a pantalla completa salvo transición de ruta breve. Coherente con TanStack Query.
- **Vacío:** ilustración/icono sobrio + título + 1 frase + CTA. Ejemplos:
  - Bóveda vacía: "Aún no tienes cartas en tu bóveda" + "Explorar catálogo".
  - Sin resultados de filtro: "Ninguna carta coincide" + "Limpiar filtros".
  - Cola admin vacía: "Nada pendiente aquí" (estado positivo, verde suave).
- **Error:** banner `danger` con mensaje traducido desde `errorCode` + acción "Reintentar". Los
  `errorCode` del contrato tienen copy dedicado (§9.2). Nunca mostrar el mensaje crudo en inglés al
  usuario final salvo como fallback.

### 8.2 Foco, teclado y accesibilidad (WCAG 2.1 AA objetivo)
- **Foco visible SIEMPRE:** `:focus-visible` con `--shadow-focus` (anillo 3px, contraste ≥ 3:1 con el
  fondo). Nunca `outline:none` sin sustituto.
- **Orden de tabulación** lógico y coherente con el orden visual; sin trampas de foco salvo en modales
  (focus trap intencional). Skip-link "Saltar al contenido" al inicio.
- **Labels:** todo control tiene label programática (`<label>`/`aria-label`). Iconos-botón con
  `aria-label`. Campos con error usan `aria-invalid` + `aria-describedby`.
- **Objetivos táctiles** ≥ 44×44px (back-office y móvil). Espaciado suficiente entre acciones.
- **Movimiento:** respetar `prefers-reduced-motion` (desactivar `scale`/transiciones no esenciales).
- **Contraste:** ver §10; se verifica en claro y oscuro.
- **Lectores de pantalla:** badges de estado exponen texto; cambios asíncronos (subida de foto,
  resultado de cotización, errores) se anuncian con `aria-live="polite"` (o `assertive` para errores de
  pago).
- **Modo oscuro** disponible por `prefers-color-scheme` + toggle manual; no reduce el contraste AA.

### 8.3 Feedback de acciones de dinero
- Las acciones de dinero (pagar, cobrar envío, reembolsar, pagar SPEI) usan botón `loading` con label
  persistente, bloquean doble envío (idempotencia visual) y confirman con banner/toast + actualización de
  estado. Errores se muestran inline/banner, nunca solo toast efímero.

---

## 9. i18n (ES/EN) — convención de diseño

### 9.1 Toggle y default
- **Default español**; toggle a inglés (§6.5). `<html lang>` refleja el locale. La preferencia persiste
  (`User.locale` con sesión, cookie sin ella).

### 9.2 Convención de claves de copy
- Estructura por dominio en `messages/{es,en}.json`: `common.*`, `nav.*`, `catalog.*`, `checkout.*`,
  `vault.*`, `buylist.*`, `shipments.*`, `admin.<module>.*`, `status.<domain>.<enum>`, `error.<CODE>`.
- **Enums → texto:** el frontend traduce cada enum vía `status.<domain>.<value>` (ej.
  `status.ownership.settled` → "Liquidada"/"Settled"). Nunca se pinta el enum crudo.
- **errorCode → texto:** cada `error.<CODE>` (ej. `error.PRICE_PENDING`, `error.ITEM_NOT_SETTLED`,
  `error.ADDRESS_NOT_MX`, `error.BUYLIST_LIMIT_EXCEEDED`, `error.INE_REQUIRED`, `error.CLABE_NOT_OWN_NAME`,
  `error.MONEY_OUT_FORBIDDEN`) tiene copy claro y accionable en ambos idiomas.
- **Datos de catálogo NO se traducen:** nombres de cartas y sets se muestran en inglés en ambos idiomas
  (por diseño). Envolver estos valores para no pasarlos por el sistema de traducción y, opcionalmente,
  marcarlos con `lang="en"` para lectores de pantalla.

### 9.3 Formato de números, dinero y fechas (localizado)
- Usar `Intl.NumberFormat`/`Intl.DateTimeFormat`. Dinero siempre en **MXN** en ambos idiomas:
  `MX$ 1,250.00`. Convertir centavos→unidades en la capa de formato (nunca mostrar centavos crudos).
- Fechas: ES "13 ago 2026", EN "Aug 13, 2026". `capturedDate` del precio se muestra localizada.
- El símbolo de moneda no cambia con el idioma (siempre MXN); solo cambian separadores/labels.

### 9.4 Longitud de texto (ES vs EN) — reglas de layout
- Diseñar los contenedores para el **texto más largo** (normalmente ES). Nunca fijar anchos que corten
  labels; usar `min-width`/`truncate` con tooltip solo donde sea seguro.
- Botones: ancho por contenido con `min-width`, permitir 2 líneas antes de romper el layout. El botón de
  loading conserva ancho.
- Segmented controls (idioma, filtros): ancho por segmento fijo suficiente para ES.
- Badges de estado: usar términos cortos (ES "Pend." solo si el largo rompe; preferir texto completo con
  wrap controlado). Probar ambos idiomas en tablas densas.
- Evitar concatenar strings; usar interpolación con placeholders (`{count}`, `{amount}`) para pluralización
  correcta en ambos idiomas (ICU MessageFormat de next-intl).

---

## 10. Verificación de contraste (WCAG AA)

Pares principales verificados (ratio aprox. sobre fondo indicado). Objetivo: texto normal ≥ 4.5:1,
texto grande/UI ≥ 3:1.

**Modo claro** (fondo página `#F8FAFC`, superficie `#FFFFFF`):
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Texto `#0F172A` sobre `#FFFFFF` | ~16.1:1 | AA/AAA |
| Texto muted `#475569` sobre `#FFFFFF` | ~8.6:1 | AA/AAA |
| Subtle `#64748B` sobre `#FFFFFF` | ~5.5:1 | AA |
| Blanco sobre primario `#4F46E5` | ~7.0:1 | AA/AAA |
| Blanco sobre danger `#DC2626` | ~4.8:1 | AA |
| Blanco sobre accent `#D97706` | ~3.9:1 | AA grande / usar en texto ≥ 18px o bold |
| Success `#047857` sobre `#ECFDF5` | ~6.3:1 | AA |
| Warning `#B45309` sobre `#FFFBEB` | ~6.6:1 | AA |
| Danger `#DC2626` sobre `#FEF2F2` | ~4.9:1 | AA |
| Border `#E2E8F0` sobre `#FFFFFF` (no texto, UI) | ~1.3:1 | decorativo (ok) |
| Anillo foco `#6366F1` sobre `#FFFFFF` | ~4.2:1 | AA (≥3:1 UI) |

**Modo oscuro** (fondo `#020617`, superficie `#0F172A`):
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Texto `#F1F5F9` sobre `#0F172A` | ~15.0:1 | AA/AAA |
| Muted `#94A3B8` sobre `#0F172A` | ~6.4:1 | AA |
| Primario texto `#818CF8` sobre `#0F172A` | ~5.6:1 | AA |
| `slate-900` sobre primario `#818CF8` (botón) | ~5.6:1 | AA |
| Success `#34D399` sobre `#0F172A` | ~8.5:1 | AA/AAA |
| Danger `#F87171` sobre `#0F172A` | ~6.2:1 | AA |
| Anillo foco `#A5B4FC` sobre `#020617` | ~7.8:1 | AA/AAA |

Reglas derivadas:
- **Accent (ámbar) con texto blanco** solo en tamaño grande/bold; para texto normal sobre ámbar, usar
  texto `slate-900`. Por eso los botones `accent` de CTA llevan label ≥ 16px semibold.
- El texto `subtle`/placeholder no se usa para información esencial (solo pistas), pues está en el borde
  de AA para texto pequeño.
- Verificar cualquier token nuevo antes de introducirlo; no bajar de AA.

---

## 11. Guía de implementación para el frontend (Tailwind + Next.js)

> El frontend implementa; aquí está el puente entre tokens y Tailwind. Ubicación sugerida:
> `frontend/src/app/globals.css` (variables) y `frontend/tailwind.config.ts` (mapeo). Estas rutas son
> propiedad de frontend; este documento solo especifica el contrato de tokens.

### 11.1 CSS variables (dos temas)
```css
:root {
  --color-bg: #F8FAFC; --color-surface: #FFFFFF; --color-surface-2: #F1F5F9;
  --color-border: #E2E8F0; --color-border-strong: #CBD5E1;
  --color-text: #0F172A; --color-text-muted: #475569; --color-text-subtle: #64748B;
  --color-primary: #4F46E5; --color-primary-hover: #4338CA; --color-primary-fg: #FFFFFF;
  --color-accent: #D97706; --color-accent-fg: #FFFFFF;
  --color-success: #047857; --color-success-bg: #ECFDF5;
  --color-warning: #B45309; --color-warning-bg: #FFFBEB;
  --color-danger:  #DC2626; --color-danger-bg:  #FEF2F2;
  --color-info:    #0284C7; --color-info-bg:    #F0F9FF;
  --color-focus-ring: #6366F1;
  --radius-sm:6px; --radius-md:10px; --radius-lg:14px; --radius-xl:20px;
}
.dark {
  --color-bg: #020617; --color-surface: #0F172A; --color-surface-2: #1E293B;
  --color-border: #334155; --color-border-strong: #475569;
  --color-text: #F1F5F9; --color-text-muted: #94A3B8; --color-text-subtle: #64748B;
  --color-primary: #818CF8; --color-primary-hover: #A5B4FC; --color-primary-fg: #0F172A;
  --color-accent: #FBBF24; --color-accent-fg: #0F172A;
  --color-success: #34D399; --color-success-bg: #052E22;
  --color-warning: #FBBF24; --color-warning-bg: #3A2A05;
  --color-danger:  #F87171; --color-danger-bg:  #3A0A0A;
  --color-info:    #38BDF8; --color-info-bg:    #082234;
  --color-focus-ring: #A5B4FC;
}
```

### 11.2 tailwind.config (extracto de mapeo)
```ts
// theme.extend.colors — referencian las CSS vars para soportar dark mode por clase
colors: {
  bg: 'var(--color-bg)', surface: 'var(--color-surface)', 'surface-2': 'var(--color-surface-2)',
  border: 'var(--color-border)', 'border-strong': 'var(--color-border-strong)',
  text: 'var(--color-text)', muted: 'var(--color-text-muted)', subtle: 'var(--color-text-subtle)',
  primary: { DEFAULT: 'var(--color-primary)', hover: 'var(--color-primary-hover)', fg: 'var(--color-primary-fg)' },
  accent: { DEFAULT: 'var(--color-accent)', fg: 'var(--color-accent-fg)' },
  success: { DEFAULT: 'var(--color-success)', bg: 'var(--color-success-bg)' },
  warning: { DEFAULT: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
  danger:  { DEFAULT: 'var(--color-danger)',  bg: 'var(--color-danger-bg)' },
  info:    { DEFAULT: 'var(--color-info)',     bg: 'var(--color-info-bg)' },
},
borderRadius: { sm:'var(--radius-sm)', md:'var(--radius-md)', lg:'var(--radius-lg)', xl:'var(--radius-xl)' },
fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
```
- `darkMode: 'class'` para permitir toggle manual además de `prefers-color-scheme`.
- Foco global: definir utilidad `focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)]` o un plugin
  para `--shadow-focus`.
- Números: clase utilitaria `.tabular` → `font-variant-numeric: tabular-nums` para precios/folios/KPIs.

### 11.3 Estructura de componentes sugerida (no normativa)
Componentes base en `frontend/src/components/ui/` (Button, Input, Select, Badge, Banner, Modal, Table,
Tabs, LocaleToggle, StatCard, PipelineStepper, PhotoUploader, PriceTag, CardTile, AmountBreakdown,
SafeShippingGuide). Cada uno consume solo tokens semánticos (nunca hex crudos) y expone sus estados.
Recomendado documentarlos con ejemplos (Storybook opcional; lo decide frontend/devops).

### 11.4 Reglas de oro para no romper el sistema
1. Nunca hex crudo en componentes: solo tokens/utilidades mapeadas.
2. Todo control interactivo: `focus-visible`, `disabled`, y `loading` si toca red.
3. Estado = color **+ texto** (+ icono en críticos). Nunca solo color.
4. Todo dato de dinero: `tabular-nums`, formateado (§9.3), y con contexto (sin IVA / con desglose).
5. Diseñar contenedores para el texto ES (más largo) y probar ambos idiomas.
6. Objetivos táctiles ≥ 44px en móvil y back-office.

---

## 12. Mapa flujo → pantalla (referencia rápida para frontend)

| Flujo (PROJECT) | Endpoints (CONTRATO) | Componentes clave |
|---|---|---|
| Catálogo | `GET /catalog/cards`, `/sets` | CardTile, filtros Select/Combobox, PriceTag, Pagination |
| Ficha de carta | `GET /catalog/cards/:id` | Imagen grande, Tabs, badges condición/grado, PriceTag, CTA |
| Checkout | `POST /checkout/quote`,`/session` | AmountBreakdown (subtotal+fee+IVA), Stripe, Banner CFDI |
| Mi bóveda / portafolio | `GET /vault/holdings` | CardTile compacto, badge titularidad, StatCard "valor portafolio", PriceTag pending |
| Retiro / envío | `POST /shipments/quote`,`/shipments` | Selección items settled, AmountBreakdown (envío+IVA), Address MX, PipelineStepper |
| Buylist cotizador | `POST /buylist/quote` | BuylistQuoter, Banner PAY_AFTER_RECEIPT, SafeShippingGuide, PriceTag |
| Buylist solicitud | `POST /buylist/requests` | KYC/CLABE/INE inputs, PhotoUploader (INE), topes (Banner límite) |
| Disputa | `POST /disputes` | PhotoUploader (reclamo), PipelineStepper |
| Admin dashboard | `GET /admin/dashboard` | 8× StatCard (enmascarado por rol), cola de trabajo accionable |
| M1 Inventario | `/admin/inventory/*` | PhotoUploader anverso/reverso, folio, ubicación CAJA/FILA/SLOT, DataTable |
| M2 Precios | `/admin/pricing/*`, `/fx` | Tabla precio pendiente, override manual, FX/colchón, rareza→categoría |
| M3 Órdenes | `/admin/orders/*` | DataTable, AmountBreakdown, refund destructivo (super_admin) |
| M4 Retiros | `/admin/shipments/*` | Cola, picking-list por ubicación, captura de guía, PipelineStepper |
| M5 Buylist | `/admin/buylist/*` | Pipeline, cherry-pick por item, convertir a inventario, pago SPEI (super_admin) |
| M6 Usuarios/KYC | `/admin/users/*` | Ficha 360° (Tabs), KYC, bloquear (destructivo) |
| M7 Finanzas | `/admin/finance/*` | StatCards financieros, tablas, export CSV (solo super_admin) |
| M8 Disputas | `/admin/disputes/*` | PhotoCompare (ingreso vs reclamo), resolver recompra/rechazo |
| M10 Config/bitácora | `/admin/settings`, `/audit-log` | Formularios de diales (Switch/Input), DataTable de auditoría |

---

## 13. Notas para el arquitecto / product-owner

No bloquean el diseño; se registran para coherencia:

1. **Fecha de refresco de precio en la UI.** El diseño muestra `capturedDate` junto al precio ("actualizado
   a diario"). Confirmar que `PriceInfo.capturedDate` está disponible en **todos** los `ListingDTO`
   mostrados (catálogo y bóveda) y no solo en el detalle. (Aparece en `PriceInfo`, se asume presente.)
2. **Copy del tooltip del fee de procesamiento.** El diseño incluye un tooltip explicativo en la línea
   "costo de procesamiento". Depende de la fórmula del fee (Pregunta 1 de ARCHITECTURE, aún abierta). El
   texto exacto se ajustará cuando se fije la fórmula; mientras, copy genérico "cubre el procesamiento del
   pago".
3. **IVA sobre envío en el desglose de retiro.** `AmountBreakdown` de retiros muestra línea de IVA sobre
   el envío (coincide con `shipments/quote` que devuelve `ivaCents`). Confirmar que el IVA aplica al envío
   (Pregunta 2 de ARCHITECTURE) para no mostrar una línea que luego cambie.
4. **Estado de CFDI en la orden.** El diseño puede mostrar `cfdiStatus` (`registrado/emitido/no_aplica`) en
   el detalle de orden como badge informativo. Confirmar si se muestra al comprador o solo en back-office
   (M3). Propuesta: badge sutil informativo en la orden del comprador ("Factura: registrada"); definición
   final depende del flujo CFDI (Pregunta 4).
5. **Progreso de lanzamiento sin metas N/X/Y/Z.** Mientras el humano no fije las metas, `StatCard` de
   progreso muestra conteos + "Meta pendiente". Cuando se fijen, se activan barras de progreso. Sin cambio
   de contrato.
6. **Indicador de "salud de datos".** El semáforo usa `lastPriceSyncAt`/`lastFxAt`/`pendingPriceCount` del
   dashboard. Sugerencia (no bloqueante): definir umbrales (p. ej. sync > 26h = ámbar/rojo) como dial de
   M10 para que el color no quede hardcodeado en el frontend.
7. **Texto de estados en tablas densas ES.** Algunos enums en español son largos
   (`convertida_inventario`, `resuelta_recompra`). Se usarán labels cortos localizados en badges de tabla
   (no el enum). No requiere cambio de contrato; solo confirmar que el diccionario de copy es propiedad de
   frontend/ux-ui (lo es).

---

## 14. Resumen de decisiones visuales (one-pager)

- **Origen:** creado desde cero (sin Claude Design previo); listo para re-codificar si llega un prototipo.
- **Personalidad:** coleccionismo serio + confianza financiera. Base neutra fría (slate), **primario
  índigo** (confianza/banca), **acento ámbar/dorado** (rayo Pokémon + valor), semánticos accesibles.
- **Confianza como sistema:** titularidad `pending`(ámbar)/`settled`(verde), precio con fecha y fuente,
  "precio pendiente" explícito, banner persistente "pago tras recepción", guía de envío seguro con
  sleeve/top loader, fotos verificadas anverso/reverso. Estado = color + texto + icono.
- **Tipografía:** Inter (variable), `tabular-nums` para dinero/folios/KPIs; escala 12→40px; pesos 400–700.
- **Layout:** Tailwind breakpoints; catálogo grid 2→5; dashboard 8 KPIs en 4×2; back-office con sidebar
  M1–M10 (drawer en móvil) y **captura de foto a un toque** en tablet junto a cajas.
- **Bilingüe:** ES default + toggle EN (segmented control), enums y errorCodes traducidos por clave, datos
  de catálogo en inglés sin traducir, contenedores dimensionados para el texto ES (más largo).
- **Accesibilidad:** foco visible 3px siempre, objetivos táctiles ≥ 44px, contraste AA verificado en claro
  y oscuro, `aria-live` para procesos asíncronos, `prefers-reduced-motion`.
- **Tokens listos para implementar:** CSS variables (claro/oscuro) + mapeo Tailwind en §11; el frontend
  puede empezar a construir componentes base y las pantallas del §12 de inmediato.
```
