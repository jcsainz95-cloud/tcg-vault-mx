# DESIGN_SYSTEM.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **ux-ui**. Fuente de verdad del **look & feel** y de los **tokens de diseño**.
> El frontend (Next.js 14 + Tailwind) implementa este documento; no lo contradice.
> Manda `PROJECT.md` sobre el contrato y sobre este documento; este documento define solo lo visual/UX,
> nunca datos, contrato ni arquitectura.
> Estado: **v1.1** (MVP + alcance 2026-08-14). Fecha: 2026-08-14. Branch: `claude/tcg-cards-marketplace-oijthj`.
> Origen: **creado desde cero** (no hubo entrega previa de Claude Design). Si más adelante el humano
> comparte un prototipo de Claude Design, este documento se re-codifica a partir de esos tokens.
>
> **Novedades v1.1 (superficies nuevas de PROJECT/CONTRATO v1.1):** condición raw **solo NM** con
> nombre legible + tooltip (§7.2b), sección **"Compra"** (renombra "Catálogo") con su vitrina y
> `ListingCard` (§7.1), **filtros de Compra** con facetas de rareza/set-con-año/tipo/precio (§7.16),
> **tarjeta de SELLADO** (§7.1b), **gráfica de tendencia del portafolio** estilo acciones (§7.17), y
> **botón "Continuar con Google"** (§6.7). El sistema base (índigo/ámbar sobre slate, Inter, AA,
> i18n ES/EN) **no cambia**; estas secciones se apoyan en los mismos tokens.

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

### 6.7 Botón social "Continuar con Google" (`GoogleSignInButton`) — v1.1
Alternativa a email/contraseña en las pantallas de **login** y **registro** (`POST /auth/google`).
- **Ubicación y jerarquía:** debajo del formulario de email, separado por un divisor **"o / or"**
  (línea + label centrado, `text-xs muted`). El email/contraseña sigue siendo la acción primaria
  (botón `primary`); Google es una alternativa con igual peso visual pero estilo neutro (no compite
  como CTA de marca ni usa el ámbar).
- **Estilo:** botón de ancho completo (`w-full`), alto `lg` (48px) para objetivo táctil cómodo, radio
  `md`, **fondo `--color-surface`** con **borde `--color-border-strong`** y **texto `--color-text`**
  (variante `secondary` del §6.1). Contenido centrado: **logo "G" multicolor oficial de Google** (SVG,
  ~18–20px, se muestra igual en claro y oscuro, no se recolorea) + gap 8px + label **"Continuar con
  Google" / "Continue with Google"**. Respeta las guías de marca de Google (no alterar el logo ni usar el
  índigo de fondo).
- **Consistencia de marca:** es el único botón que introduce color externo (el logo G); por eso se
  mantiene sobre superficie neutra para no chocar con la paleta índigo/ámbar. En modo oscuro, fondo
  `surface`, borde `border-strong`, texto claro; el logo G conserva sus colores (contraste suficiente
  sobre `surface`).
- **Estados obligatorios:** hover (fondo `surface-2`), focus-visible (anillo `--shadow-focus`), active
  (`scale-[.98]`), disabled (opacidad 45%), **loading** (spinner reemplaza al logo, label "Conectando…",
  `aria-busy=true`, bloquea doble envío mientras se verifica el ID token server-side). Errores
  (`GOOGLE_TOKEN_INVALID`, `GOOGLE_EMAIL_UNVERIFIED`) se muestran como banner/inline `danger` con copy
  traducido (`error.GOOGLE_TOKEN_INVALID`, `error.GOOGLE_EMAIL_UNVERIFIED`), nunca solo toast.
- **Accesibilidad:** es un `<button>` real con label textual (no solo el icono); `aria-label` redundante
  no necesario. El logo G va `aria-hidden`. Orden de tabulación: campos → botón primario → divisor →
  botón Google. Anuncio de estado con `aria-live` durante "Conectando…".
- **Nota post-login:** cuando `authProvider=google` y aún no hay contraseña, la pantalla de cuenta
  **oculta "cambiar contraseña"** y ofrece "Crear contraseña" (coherente con el contrato v1.1).

---

## 7. Componentes — dominio

### 7.1 Card de carta (`CardTile` / `ListingCard`) — pieza central
Consume `ListingDTO` (`{ card, productType, rawCondition?, sealedSubtype?, gradingCompany?, gradeValue?,
referenceValue, salePriceCents?, sellable }`). Anatomía (vertical):
1. **Imagen** de la carta `aspect-[5/7]`, con skeleton al cargar. Overlay superior-izquierda: badge de
   **condición/grado/tipo** (§7.2b, deriva de `productType`); superior-derecha: badge de **estado de
   titularidad** (solo en contexto bóveda).
2. **Nombre** (EN, `text-sm/base` semibold, 1–2 líneas con `line-clamp`; envuelto en `lang="en"`).
3. **Set + número** (`text-xs muted`, EN). En Compra se sugiere sufijar el año del set entre paréntesis
   cuando ayuda ("Surging Sparks · 2024") reutilizando el `year` de facetas.
4. **Price tag** (§7.3): en **Compra** siempre precio MXN grande (`salePriceCents`) + "sin IVA" + fecha
   de referencia. En **bóveda** muestra el valor de referencia; solo ahí puede aparecer "Precio
   pendiente".
5. Acción contextual: en Compra botón `accent`/`primary` "Agregar"/"Comprar"; en bóveda, botón
   `secondary` "Retirar" (deshabilitado si `pending`).

> **Regla dura de Compra (jerarquía + confianza):** la vitrina de Compra lista **solo inventario
> publicado con precio** (`sellable=true`, `salePriceCents != null`); el `ListingCard` en Compra
> **NUNCA** renderiza el estado "precio pendiente" ni `$0`/`—`. La cifra siempre está presente. El
> orden de lectura del card prioriza: imagen → nombre → **precio** → CTA; el badge de tipo/condición es
> secundario (esquina). El "valor de mercado/referencia" es informativo y va en `text-xs muted` bajo el
> precio de venta (ver §7.3), sin competir con la cifra de venta.

Badge de **titularidad**: `pending` (warning) / `settled` (success), con icono candado abierto/cerrado.

Estados del card:
- normal / hover (eleva a `shadow-md`, imagen `scale-[1.02]` sutil) / focus-visible (anillo en todo el
  card, es un enlace) / skeleton (imagen + 3 barras). El estado "no vendible / precio pendiente" **solo
  existe en contexto bóveda**, nunca en Compra.
- Variante **compacta horizontal** para listas de bóveda, checkout, picking y colas admin: miniatura
  56×78, nombre + folio + estado en fila.

### 7.1b Variante SELLADO del `ListingCard` (`productType=sealed`)
El sellado (booster box, ETB, bundle, tin, blister) es una línea de venta distinta y su tarjeta se
lee diferente:
- **Sin** badge de condición ni de rareza (el sellado no lleva `rawCondition`/grade/rareza).
- Badge único **"Sellado / Sealed"** (tono `info`, icono `package`/caja de lucide) en la esquina
  superior-izquierda, y **subtipo** derivado de `sealedSubtype` como segundo pill neutro cuando existe:
  "Booster Box", "ETB", "Bundle", "Tin", "Blister" (etiquetas localizadas por `status.sealedSubtype.*`;
  el dato del subtipo es un enum del contrato, no se traduce el producto en sí).
- **Imagen**: si la foto del producto sellado no es 5:7 (las cajas son más cuadradas), el mismo contenedor
  `aspect-[5/7]` la centra con `object-contain` sobre fondo `surface-2` (no recortar la caja). El badge
  "Sellado" desambigua que no es un single.
- **Precio**: siempre visible (`salePriceCents`, precio manual del admin en MXN) + "sin IVA"; como en todo
  Compra, el sellado sin precio no se publica, así que la tarjeta nunca aparece sin cifra.
- Nombre/set en EN igual que el resto; no se muestra número de carta cuando no aplica.

### 7.2 Badge / Pill (`Badge`)
- Formas: **soft** (fondo `-bg` + texto `-color`, default) y **outline** (borde + texto, para estados
  "en proceso" o secundarios como `chargeback`, `aprobada`, precio pendiente).
- Tamaño `text-xs`, `px-2 py-0.5`, `radius-full`, peso 500. Siempre con **texto**; icono opcional 12–14px.
- Mapeo de color por estado en §2.4. Componente recibe `{status, domain}` y resuelve token + clave i18n.

### 7.2b Badge de condición / grado / tipo (`ConditionBadge`) — v1.1 (raw solo NM)
Deriva de `productType` y ocupa la esquina superior-izquierda del `ListingCard` y de la ficha. En v1.1
el raw se opera **únicamente en Near Mint**; **ya no existen** LP/MP/HP/DMG.

| `productType` | Contenido del badge | Tono | Icono |
|---|---|---|---|
| `raw` (`rawCondition=NM`) | **"Casi nueva (NM)"** · EN **"Near Mint (NM)"** | **success suave** (`success-bg` + `success`), estilo *soft* | escudo/check-circle |
| `graded` | `PSA 10` / `CGC 9.5` (de `gradingCompany`+`gradeValue`) | `accent` | escudo (autenticidad) |
| `sealed` | "Sellado / Sealed" + subtipo (§7.1b) | `info` | package/caja |

**NM — nombre legible + tooltip accesible (regla nueva):**
- El badge muestra el **nombre legible** completo, **no** el código pelón "NM". Formato: `Casi nueva (NM)`
  en ES y `Near Mint (NM)` en EN. En contenedores muy estrechos (card compacto de bóveda) puede colapsar a
  la pill "NM" **pero** conservando el nombre completo en `aria-label` y `title`.
- La **descripción del estándar propio** vive en un **tooltip/`title`**: *"Como nueva; a lo mucho
  imperfecciones mínimas. Bordes limpios y superficie sin rayones notorios."* (EN espeja el texto). El
  tooltip aparece en hover y en focus del badge (el badge es focuseable, `tabindex="0"`).
- **Accesibilidad:** el badge lleva `aria-label` con nombre + descripción (ej.
  `aria-label="Condición: Casi nueva (Near Mint). Como nueva; a lo mucho imperfecciones mínimas…"`), de
  modo que el lector de pantalla lo anuncie sin depender del `title` hover. No usar solo color: el texto
  legible ya porta el significado. El icono es decorativo (`aria-hidden`).
- **Tono elegido para NM:** verde suave (success-bg) — NM es el **único** grado y es un estándar de
  confianza/"garantía de condición"; el verde suave lo alinea con la semántica de "verificado" sin gritar
  como un badge sólido. No usar el ámbar de `pending` (NM no es un estado pendiente). Cumple AA (§10:
  `success #047857` sobre `success-bg #ECFDF5` ≈ 6.3:1).
- Las claves i18n del nombre y la descripción viven en `catalog.condition.nm.{label,desc}` (propiedad de
  frontend); la API **no** envía el label legible, solo el enum `NM` (ver contrato v1.1).

### 7.3 Price tag (`PriceTag`) — precio de venta vs. referencia; "precio pendiente"
- **En Compra (precio de venta):** la cifra principal es `salePriceCents` → `MX$ 1,250.00` en
  `text-lg semibold tabular-nums`; debajo `text-xs muted` "sin IVA · 13 ago 2026". Opcionalmente, en
  segunda línea `text-xs muted`, el **valor de mercado/referencia** (`referenceValue.referenceMxnCents`)
  con etiqueta "Valor de mercado" + icono info y tooltip "Precio de referencia de mercado, actualizado a
  diario" (fecha = `capturedDate` localizada). El valor de mercado nunca compite tipográficamente con el
  precio de venta.
- **En bóveda (valor):** la cifra es el valor de referencia (`referenceValue`), pues el portafolio se valúa
  a referencia, no a precio de venta.
- **Pending (SOLO bóveda / back-office, NUNCA Compra):** en lugar de cifra, pill `warning outline`
  "Precio pendiente / Price pending" + `text-xs muted` "Lo fijaremos pronto". En portafolio se excluye del
  total y se marca (`pendingPriceCount`). **En Compra este estado no puede ocurrir** (el contrato excluye
  del listado los items sin precio); si por una carrera un item deja de ser vendible, el checkout lo
  bloquea (`422 PRICE_PENDING`), no el card.
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
- **Sparkline opcional (v1.1):** el StatCard de "valor de portafolio" (bóveda) puede embeber un
  mini-sparkline con el color de tendencia y el delta como subtítulo (signo+flecha), reutilizando
  `GET /vault/portfolio/history` (§7.17). Su alternativa textual es el propio delta del card.

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
- **Storefront header:** logo, buscador, nav (**Compra**, Buylist, Mi bóveda, Mis órdenes), `LocaleToggle`,
  cuenta/carrito. Sticky. En móvil: logo + buscador + menú hamburguesa + carrito; nav en drawer.
  > **v1.1 — rótulo "Compra":** el ítem antes llamado "Catálogo" se rotula **"Compra / Shop"** en toda la
  > UI (clave `nav.shop`). La **ruta técnica se mantiene** (`/catalog/cards` en el contrato); el cambio es
  > solo de etiqueta visible. Los breadcrumbs (§6.6) usan "Compra › Set › Carta".
- **Admin shell:** sidebar izquierdo (desde `lg`) con módulos **M1–M10** agrupados
  (Operación: M1, M4, M5, M8 · Catálogo/Precios: M2 · Ventas/Finanzas: M3, M7, M9 · Admin: M6, M10),
  dashboard arriba. Topbar con contexto (rol actual, buscador global de folio/usuario, `LocaleToggle`,
  usuario). En `< lg`: sidebar colapsa a drawer + barra inferior con accesos rápidos (Dashboard, Colas,
  Cámara/alta rápida). Item activo resaltado con barra `--color-primary` + fondo `surface-2`.
- Los módulos no permitidos para el rol (operador: M2/M3-refund/M7/M10…) **no se muestran** o aparecen con
  candado y tooltip; el intento bloqueado del contrato (`403 MONEY_OUT_FORBIDDEN`) se refleja con banner.

### 7.16 Filtros de Compra (`ShopFilters`) — v1.1
Barra/panel de filtros de la vitrina de Compra. Se alimenta de `GET /catalog/facets` (rareza, sets con
año, tipos, subtipos de sellado, rango de precio) y aplica sobre `GET /catalog/cards`
(`?setId&rarity&productType&condition&minPriceCents&maxPriceCents&sealedSubtype&sort`).
- **Layout:** en `lg+` panel lateral izquierdo (sticky, ~240–280px) junto al grid; en `< lg` botón
  "Filtros" que abre un **bottom sheet** (§7.6) con las mismas facetas y un conteo de resultados en el
  botón de aplicar. Los filtros activos se muestran como **chips removibles** (§7.7) sobre el grid, más un
  "Limpiar filtros".
- **Sincronización con URL:** cada faceta se refleja en query params para compartir/volver; el estado
  vacío de resultados usa el patrón "Ninguna carta coincide + Limpiar filtros" (§8.1).

**a) Rareza — taxonomía abierta con muchas categorías modernas (patrón anti-saturación).**
La lista de rareza es **abierta** (espeja pokemontcg.io tal cual; incluye Illustration Rare, Special
Illustration Rare, Art Rare, Full Art, Alternate Art, Trainer Gallery, Character Rare, Radiant, EX/GX/V/
VMAX/VSTAR, Secret/Rainbow, etc.) y puede tener decenas de valores. Para que sea **escaneable** sin
saturar:
- **No** volcar 40 chips sueltos. Usar un **Combobox multi-select con búsqueda** (§6.3): campo "Buscar
  rareza…" + lista virtualizada con checkboxes; el trigger muestra el conteo ("Rareza · 3").
- **Agrupar** las rarezas en familias legibles con encabezados dentro del desplegable (grupos sugeridos,
  solo presentación — el valor enviado a la API es la rareza cruda): *Comunes/estándar* (Common, Uncommon,
  Rare, Reverse Holo, Holo Rare), *Ultra/EX+* (EX, GX, V, VMAX, VSTAR, Ultra Rare), *Ilustración/Arte*
  (Illustration Rare, Special Illustration Rare, Art Rare, Full/Alternate Art, Trainer Gallery, Character
  Rare), *Especiales* (Radiant, Shiny, Secret/Rainbow, Gold). La tabla de agrupación es de **presentación
  del front** (un mapa rareza→grupo en i18n/config del front, con fallback "Otras" para valores no
  mapeados), nunca cierra la taxonomía ni depende del backend.
- Mostrar las **rarezas más frecuentes primero** (las facetas ya vienen filtradas a inventario publicado,
  así que solo aparecen rarezas que existen a la venta) y una sección colapsable "Ver todas". Chips de
  selección activa aparecen arriba (removibles).
- Accesibilidad: `role="listbox"`/`option` con teclado, cada opción con checkbox etiquetado; el grupo con
  `aria-label`. El buscador filtra por texto en cualquier idioma de la etiqueta visible (el valor cruo EN
  se conserva para la query).

**b) Set con año (`SetFilter`).** Combobox con búsqueda sobre `facets.sets`; cada opción se muestra como
**"Surging Sparks (2024)"** (nombre EN del set + año entre paréntesis, derivado de `releaseDate`). Orden
**por año descendente** (los sets más nuevos arriba), tal como los entrega el contrato. Muchos sets →
buscador obligatorio; opción de agrupar por año como encabezados dentro del desplegable. El año es un
realce sutil (`text-xs muted`), el nombre es el texto principal.

**c) Tipo de producto (`ProductTypeFilter`).** Segmented control o chips de selección múltiple:
**Todo · Raw (NM) · Graded · Sellado**. Al elegir "Raw", la condición está implícita en **NM** (único
valor; se muestra como sublabel "Casi nueva (NM)", no como un segundo filtro con varias opciones). Al
elegir "Sellado", aparece un sub-filtro opcional de **subtipo** (box/ETB/bundle/tin/blister) alimentado
por `facets.sealedSubtypes`; graded y sellado **no** ofrecen filtro de rareza/condición.

**d) Precio (`PriceRangeFilter`).** Rango `minPriceCents`–`maxPriceCents` con dos inputs `MX$` (prefijo,
`inputmode="decimal"`, `tabular-nums`) y/o slider dual; los límites por defecto vienen de `facets.price`
(`minCents`/`maxCents`). Validación: min ≤ max; se envía en centavos.

**e) Orden (`sort`).** Select con `price_asc | price_desc | newest` (etiquetas "Precio: menor a mayor",
"Precio: mayor a menor", "Novedades"). Separado de las facetas, alineado a la derecha sobre el grid.

### 7.17 Gráfica de tendencia del portafolio (`PortfolioTrendChart`) — v1.1, estilo acciones
Vive en "Mi bóveda". Consume `GET /vault/portfolio/history?range=…` → `{ range, points: PortfolioPointDTO[],
change: { absMxnCents, pct, direction } }`. Es la superficie más "financiera" de la app; prioriza legibilidad
del dato y accesibilidad sobre el adorno.

**Anatomía (arriba → abajo):**
1. **Encabezado de valor:** valor actual grande (`text-h1 tabular-nums`, último `valueMxnCents`) +
   **delta** del rango en `text-sm`: signo + flecha + monto + porcentaje, p. ej. **"▲ +MX$ 31,200 (+6.09 %)"**.
   El delta usa color de tendencia (ver abajo) **y** signo/flecha (nunca solo color). `direction=flat` →
   sin flecha, tono neutro, "Sin cambios".
2. **Toggle de rangos** (`RangeToggle`): segmented control / fila de chips **5d · 15d · 1m · 3m · 6m · 1a ·
   YTD · Máx** (mapea a `5d|15d|1m|3m|6m|1y|ytd|all`). El activo con fondo `--color-primary` + `primary-fg`;
   los inactivos `ghost`. Scrollable horizontal en móvil (8 rangos no caben); cada chip ≥ 44px táctil, con
   `aria-pressed`. Default **1m**.
3. **Área/línea del gráfico:** línea de 2px con relleno de área tenue (gradiente a transparente) del color de
   tendencia del rango. Sin cuadrícula pesada: gridlines horizontales sutiles (`--color-border`), sin bordes
   de eje gruesos. Tooltip/crosshair al hover/touch mostrando fecha localizada + valor (`tabular-nums`), y en
   teclado el punto activo se puede recorrer con flechas (`aria-live` anuncia fecha+valor).
4. **Ejes:** eje X con ~4–6 etiquetas de fecha (`text-xs muted`, formato §9.3, densidad según rango: días
   para 5d/15d, meses para 1a/Máx); eje Y con 3–4 marcas de valor abreviado (`MX$ 5.4k` etc.,
   `text-xs muted`, `tabular-nums`). Sin saturar de ticks.
5. **(Opcional) Línea de costo base:** si los puntos traen `costBasisMxnCents`, dibujar una **línea punteada
   neutra** (`--color-text-muted`, `stroke-dasharray`) como referencia; leyenda "Valor" vs "Costo base". No
   usar verde/rojo para el costo base (se reservan para tendencia). Es opcional y desactivable.

**Colores de tendencia (verde sube / rojo baja) con AA en claro y oscuro:**
- **Sube (`direction=up`):** usar el token **success** (claro `#047857`, oscuro `#34D399`) para línea, área
  y delta. Cumple AA sobre `bg`/`surface` (§10).
- **Baja (`direction=down`):** usar el token **danger** (claro `#DC2626`, oscuro `#F87171`). AA verificado
  en §10.
- **Plano (`flat`):** `--color-text-muted`.
- **No depender solo del color (crítico para daltonismo):** el delta **siempre** incluye **signo (+/−) y
  flecha (▲/▼)**; el encabezado nombra la dirección en texto ("subió"/"bajó"/"sin cambios" en el resumen
  accesible). La línea puede además variar el estilo si se desea (sólida up / con marcadores down), pero el
  signo+flecha es el portador primario.

**Tipografía de ejes y cifras:** Inter con `tabular-nums` en todas las cifras (encabezado, ejes, tooltip);
etiquetas de eje `text-xs muted`; encabezado de valor `text-h1`; delta `text-sm` peso 500.

**Estados obligatorios:**
- **Cargando:** skeleton con la forma del chart (rectángulo `aspect` + línea ondulada gris) + toggle de
  rangos ya interactivo; el encabezado muestra skeleton de cifra. No spinner a pantalla completa.
- **Vacío ("recopilando datos"):** cuando `points: []` (usuario sin snapshots todavía). Ilustración sobria +
  título **"Estamos recopilando datos / We're collecting data"** + 1 frase "Tu tendencia aparecerá cuando
  tengamos al menos un par de días de historia." No mostrar un chart en cero ni una línea plana falsa; no es
  un error. El encabezado muestra el valor actual del portafolio (de `holdings.portfolio`) si existe, con
  delta "Sin cambios".
- **Tendencia negativa:** es un estado **legítimo, no un error** — se pinta en rojo con ▼ y signo −, sin
  banners de alarma. El área en rojo tenue; nada de iconografía de "peligro" (esto es información, no un
  fallo).
- **Rango sin suficientes puntos:** si un rango corto (5d) tiene 0–1 puntos, mostrar el/los puntos como
  marcador(es) y una nota `text-xs muted` "Pocos datos en este rango" en vez de una línea engañosa.
- **`estimated`:** los puntos de backfill indicativo (`estimated: true`) se dibujan con la línea
  **punteada** y una nota de leyenda "Estimado" para no dar apariencia de dato medido real.
- **Error de carga:** mini-banner `danger` "No se pudo cargar la tendencia" + "Reintentar" (§8.1), sin
  romper el resto de "Mi bóveda".

**Alternativa textual accesible (obligatoria):** el chart NO puede ser el único portador del dato. Junto
al `<svg>` (marcado `role="img"` con `aria-label` resumen) va un **resumen textual** para lectores de
pantalla (visible o `sr-only` según diseño): p. ej. *"Portafolio en el último mes: inicio MX$ 5,120.00
el 15 jul, cierre MX$ 5,432.00 el 14 ago. Subió MX$ 312.00 (+6.09 %)."* Se construye con el primer y
último `point` y el objeto `change`. Cambiar de rango actualiza este resumen con `aria-live="polite"`.
Opcional: un enlace "Ver como tabla" que despliega los puntos en una `DataTable` (fecha/valor) totalmente
navegable por teclado.

**Opcional — mini-sparkline en el `StatCard` de "valor de portafolio":** el `StatCard` de valor del
portafolio (§7.8) puede incluir un **sparkline** de ~30–60px de alto (rango corto, p. ej. 1m) con el color
de tendencia y el delta como subtítulo (mismo patrón signo+flecha). Es decorativo-informativo; su
alternativa textual es el propio delta del StatCard. Reutiliza `history` para no pedir datos extra.

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
- **Claves nuevas v1.1 (propiedad de frontend; la API no envía estos textos):**
  `catalog.condition.nm.label` ("Casi nueva (NM)" / "Near Mint (NM)"),
  `catalog.condition.nm.desc` (descripción del estándar NM en ES/EN),
  `status.sealedSubtype.{box,etb,bundle,tin,blister}`, `nav.shop` ("Compra"/"Shop"),
  `shop.filters.rarity.groups.*` (mapa de presentación rareza→grupo, con fallback "Otras"/"Other"),
  `portfolio.trend.*` (rangos, resumen accesible, "recopilando datos", "estimado", "costo base"),
  `auth.google.cta` ("Continuar con Google"/"Continue with Google"), `auth.divider.or` ("o"/"or"),
  `error.GOOGLE_TOKEN_INVALID`, `error.GOOGLE_EMAIL_UNVERIFIED`.
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

**Colores de tendencia del `PortfolioTrendChart` (§7.17)** — usan tokens ya verificados:
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Sube claro `#047857` (success) sobre `#FFFFFF` | ~6.3:1 | AA (línea/texto delta) |
| Baja claro `#DC2626` (danger) sobre `#FFFFFF` | ~4.9:1 | AA (línea/texto delta) |
| Sube oscuro `#34D399` sobre `#0F172A` | ~8.5:1 | AA/AAA |
| Baja oscuro `#F87171` sobre `#0F172A` | ~6.2:1 | AA/AAA |
- La línea del chart es UI (≥ 3:1) y además el delta se lee como **texto** (≥ 4.5:1), por eso se usan las
  variantes de token de texto, no los tintes `-500` puros. El color **nunca** es el único indicador:
  siempre acompaña signo (+/−) y flecha (▲/▼). Costo base usa `text-muted` punteado (no verde/rojo).

Reglas derivadas:
- **Accent (ámbar) con texto blanco** solo en tamaño grande/bold; para texto normal sobre ámbar, usar
  texto `slate-900`. Por eso los botones `accent` de CTA llevan label ≥ 16px semibold.
- El texto `subtle`/placeholder no se usa para información esencial (solo pistas), pues está en el borde
  de AA para texto pequeño.
- **NM badge:** `success #047857` sobre `success-bg #ECFDF5` ≈ 6.3:1 (AA); en oscuro `#34D399` sobre
  `#052E22` cumple AA. El logo "G" de Google sobre `surface` conserva sus colores oficiales (contraste
  suficiente; no se recolorea).
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
| Login / Registro | `POST /auth/login`,`/register`,`/google` | Inputs, Button primary, **GoogleSignInButton** (§6.7), divisor "o/or" |
| **Compra** (ex-Catálogo) | `GET /catalog/cards`, `/facets`, `/sets` | ListingCard (+ variante Sellado §7.1b), **ShopFilters** (§7.16), ConditionBadge NM, PriceTag, Pagination |
| Ficha de carta | `GET /catalog/cards/:id` | Imagen grande, Tabs, ConditionBadge (NM + tooltip §7.2b), PriceTag, CTA |
| Checkout | `POST /checkout/quote`,`/session` | AmountBreakdown (subtotal+fee+IVA), Stripe, Banner CFDI |
| Mi bóveda / portafolio | `GET /vault/holdings`, `/vault/portfolio/history` | CardTile compacto, badge titularidad, **PortfolioTrendChart** (§7.17), StatCard "valor portafolio" (+sparkline opcional), PriceTag pending |
| Retiro / envío | `POST /shipments/quote`,`/shipments` | Selección items settled, AmountBreakdown (envío+IVA), Address MX, PipelineStepper |
| Buylist cotizador | `POST /buylist/quote` | BuylistQuoter, Banner PAY_AFTER_RECEIPT, SafeShippingGuide, PriceTag |
| Buylist solicitud | `POST /buylist/requests` | KYC/CLABE/INE inputs, PhotoUploader (INE), topes (Banner límite) |
| Disputa | `POST /disputes` | PhotoUploader (reclamo), PipelineStepper |
| Admin dashboard | `GET /admin/dashboard` | 8× StatCard (enmascarado por rol), cola de trabajo accionable |
| M1 Inventario | `/admin/inventory/*` | PhotoUploader anverso/reverso, folio, ubicación CAJA/FILA/SLOT, DataTable |
| M2 Precios/Catálogo | `/admin/pricing/*`, `/fx`, `/admin/catalog/sync`,`/backfill`,`/remote-sets` | Tabla precio pendiente, override manual, FX/colchón, rareza→categoría, sync/backfill de sets (super_admin) |
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
8. **v1.1 — cobertura de shapes (sin cambios de contrato solicitados).** Las superficies nuevas ya tienen
   los datos que necesitan: `ListingDTO` (`salePriceCents`, `sealedSubtype?`, `rawCondition="NM"`),
   `GET /catalog/facets` (`rarities` abiertas, `sets` con `year`, `sealedSubtypes`, `price`),
   `GET /vault/portfolio/history` (`points` con `costBasisMxnCents?`/`estimated?` y `change` con
   `direction`), `POST /auth/google`. **No se requiere ampliar el contrato.** Anotaciones menores no
   bloqueantes: (a) el **mapa rareza→grupo** de presentación de los filtros vive en el front (no en la API);
   si en el futuro se quisiera un agrupamiento canónico compartido, sería un dial de M10, no del contrato.
   (b) El **label y la descripción de NM** son i18n del front (confirmado por el contrato v1.1). (c) Para el
   sparkline del StatCard se reutiliza `portfolio/history` con rango corto; no hace falta endpoint nuevo.

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
- **v1.1 (superficies nuevas):**
  - **Condición NM legible:** badge verde suave "Casi nueva (NM)" / "Near Mint (NM)" con descripción del
    estándar en tooltip/`title` + `aria-label`; sin LP/MP/HP/DMG (§7.2b).
  - **Compra:** rótulo "Compra" (ruta `/catalog/cards` intacta); `ListingCard` con precio de venta como
    dato dominante; **nunca "precio pendiente" en Compra** (§7.1/§7.3).
  - **Sellado:** tarjeta sin condición/rareza, badge "Sellado" + subtipo, precio siempre (§7.1b).
  - **Filtros de Compra (§7.16):** rareza en Combobox multi-select agrupable/buscable (taxonomía abierta),
    set con año "(2024)" orden año desc, tipo (raw NM/graded/sellado + subtipo), precio; anti-saturación.
  - **Gráfica de portafolio (§7.17):** estilo acciones, verde↑/rojo↓ con signo+flecha (no solo color),
    toggle 5d/15d/1m/3m/6m/1a/YTD/Máx, estados cargando/vacío("recopilando datos")/negativo, resumen
    textual accesible; costo base y sparkline opcionales.
  - **Google (§6.7):** botón `secondary` full-width con logo G oficial, divisor "o/or", estados
    loading/error; consistente con marca (color externo solo en el logo).
```
