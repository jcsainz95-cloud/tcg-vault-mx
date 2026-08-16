# DESIGN_SYSTEM.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **ux-ui**. Fuente de verdad del **look & feel** y de los **tokens de diseño**.
> El frontend (Next.js 14 + Tailwind) implementa este documento; no lo contradice.
> Manda `PROJECT.md` sobre el contrato y sobre este documento; este documento define solo lo visual/UX,
> nunca datos, contrato ni arquitectura.
> Estado: **v1.3** (rediseño 5a "papel/tinta/bermellón" — sin look de IA). Fecha: 2026-08-16. Branch: `claude/rediseno-5a-pantallas`.
> Origen: **codificado a partir del rediseño 5a implementado en `frontend/`** (dirección de arte
> aprobada por el humano). No hubo entrega formal de Claude Design; los tokens de este documento se
> **extraen de los valores reales** de `frontend/src/app/globals.css`, `frontend/tailwind.config.ts` y
> `frontend/src/app/[locale]/layout.tsx`. Este documento es la fuente de verdad versionada de esos tokens.
>
> **Novedades v1.3 (rediseño 5a — identidad "editorial de papel", tema único claro):**
> - **Nueva paleta papel/tinta/bermellón:** se retira la filosofía índigo/ámbar/slate. La base es **papel**
>   `#F4F1EA` (fondo y superficie), **pozo** `#EFEBE2` (superficie elevada), **tinta** `#1A1A18` (texto y
>   acción primaria), secundario `#6E695E`, **bermellón** `#B44B3A` (único acento de marca + foco + estados
>   de atención) y **verde** `#4E7A49` (éxito). El papel *es* la marca (§2).
> - **Tema único claro — se elimina el modo oscuro** de todo el sistema (no hay `.dark`, ni `ThemeToggle`,
>   ni `darkMode:'class'`): el papel no tiene equivalente oscuro. Se retiran las columnas/tablas de oscuro.
> - **Tipografía editorial self-hosted por `next/font`:** **Zen Old Mincho** (serif display, títulos),
>   **Archivo** (sans, UI) y **JetBrains Mono** (mono, toda cifra/folio/estado/etiqueta) (§3).
> - **Radios 0 y sombras 0 como decisión de estilo:** el sistema se apoya en **reglas** (líneas) y **aire**,
>   no en cajas ni relieve. **Excepción de accesibilidad:** el **anillo de foco** (bermellón 2px) sobrevive
>   a "sombras 0" y es obligatorio (§4.2, §4.3, §8.2).
> - **Regla de estado ratificada = color + texto (versalitas):** el estado se cifra en **texto mono en
>   versalitas** siempre visible (LIQUIDADA, PENDIENTE, EN PROCESO) del color de su tono; el color es
>   redundante, no portador. **El icono deja de ser requisito** en críticos (§2.4, §7.4, §11.4). Cambio
>   **aprobado por el humano** (look editorial minimalista), no un descuido; accesibilidad preservada por
>   texto + `aria-label` + foco visible + contraste AA.
> - **Ficha técnica en retícula = `ListingSpec` (`Raw · NM · Acabado` en mono):** en Compra y bóveda la
>   calidad se representa por defecto como un **renglón mono** (`RAW · NM · HOLOFOIL`, `GRADED · PSA 9 ·
>   CERT 84213307`, `SELLADO · ETB`), con el nombre completo del estándar en `aria-label`/`title`; la
>   etiqueta legible ("Casi nueva (NM)") vive en la **ficha de detalle** (`ConditionBadge`). Decisión de
>   diseño **ratificada** (§7.2b).
>
> **Base v1.1/v1.2 vigente (sin cambios de comportamiento):** condición raw **solo NM** (§7.2b), sección
> **"Compra"** con `ListingCard` y **filtros** (§7.1, §7.16), **tarjeta de SELLADO** (§7.1b), **gráfica de
> tendencia del portafolio** (§7.17), **botón "Continuar con Google"** (§6.7), **sin fotos de producto**
> (imagen de catálogo remota), **gradeada = empresa+grado+`certNumber`** (§7.2c), **disputa por correo**
> (§7.11), **único uploader = INE** (§7.10). Lo que cambia en v1.3 es la **piel** (paleta, tipografía,
> radios, sombras) y la **regla de badges/NM**, no los flujos ni el contrato.

---

## 0. Cómo leer y usar este documento

- Los **tokens** (color, tipografía, espaciado, radios, sombras) son la unidad mínima. Se implementan
  como **CSS variables** en `:root` (**tema único claro**; no hay `.dark`) y se exponen a Tailwind vía
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
   titularidad `pending/settled`, precio de referencia con `capturedDate`, condición/grado (raw NM o
   **empresa+grado+certificado** en gradeadas), "pago tras recepción". Nunca se oculta un estado ni se
   disfraza una carga. **No hay fotos propias del producto** (v1.2): la confianza se apoya en la imagen de
   catálogo de pokemontcg.io + el estándar NM + el `certNumber` verificable en la graduadora.
2. **Claridad sobre decoración.** Jerarquía tipográfica fuerte, mucho aire, datos legibles. El dinero
   siempre desglosado (subtotal + procesamiento + IVA). Ninguna cifra financiera aparece sin etiqueta.
3. **Coleccionismo serio, no infantil.** Se evoca el mundo TCG/Pokémon con la **carta como héroe visual**
   (imagen grande de catálogo) sobre una base **editorial de papel**: la personalidad la dan la textura de
   papel, la tinta y un único acento bermellón usado con avaricia. **Tipografía profesional, nada de
   tipografías de juguete:** el display es un **serif mincho** (`Zen Old Mincho`) — una serif de imprenta,
   sobria y de voz culta, no una redondeada infantil; su seriedad editorial es precisamente lo que aleja el
   producto del "look de IA" y del arcoíris. Nada de degradados arcoíris, tipografías redondeadas de juguete
   ni emojis en la UI.
4. **Operable con una mano y con guantes.** El back-office se usa junto a las cajas físicas, en móvil y
   tablet, a veces con prisa. Objetivos táctiles grandes, acciones primarias siempre visibles, alta de
   item **sin cámara** (se identifica por catálogo y, en gradeadas, por `certNumber`; sin fotos de producto,
   v1.2). La única captura que queda es la imagen del **INE** en el flujo de KYC del buylist.
5. **Bilingüe sin costuras.** ES por defecto, EN a un clic. El layout nunca se rompe por longitud de
   texto (ES suele ser ~15-30% más largo que EN). Ver §9.

Tono de voz del copy: **claro, directo, tranquilizador**. Explica el "por qué" cuando toca dinero
("Este cargo cubre el procesamiento del pago"). Sin jerga innecesaria; los términos fiscales (IVA, CFDI)
se nombran correctamente.

---

## 2. Color

### 2.1 Filosofía de paleta — papel, tinta y bermellón
- **El papel ES la marca.** La base es un **papel cálido** `#F4F1EA`: fondo *y* superficie comparten el
  mismo tono (no hay "tarjetas blancas flotando"). La superficie elevada es un **pozo** un punto más oscuro
  `#EFEBE2`. La sensación es de página impresa sobria, no de dashboard de SaaS.
- **La tinta es la acción.** El texto y la **acción primaria** son la misma **tinta** `#1A1A18` (casi negra,
  ligeramente cálida). No hay "azul de banca": la jerarquía la da el contraste tinta/papel y el aire, no el
  color. El texto secundario es `#6E695E`.
- **Un solo acento, usado con avaricia: bermellón** `#B44B3A`. Es el sello de marca, el color del **anillo
  de foco** y el de los **estados de atención** (aviso/error). No se usa para grandes áreas ni para adornar.
- **Verde de imprenta** `#4E7A49` para **éxito/`settled`** (único color "positivo" del sistema).
- **Neutro cálido** `#9A6C57` disponible para acentos terciarios muy puntuales (no semántico).
- **Sin rellenos de color en estados:** un estado es **texto mono en versalitas coloreado sobre papel**, así
  que los `*-bg` semánticos son **`transparent`** a propósito (§2.3). El sistema separa con **reglas**
  (líneas), no con cajas de color.
- **Tema único claro.** No hay equivalente oscuro del papel; **no existe modo oscuro** (§0, §11).
- Todos los pares texto/fondo esenciales cumplen **WCAG AA** (≥ 4.5:1 texto normal, ≥ 3:1 texto grande y
  para componentes/anillo de foco). Verificación en §10.

### 2.2 Valores base (referencia hex — los reales de `globals.css`)

Papel y tinta (la escala del sistema):
```
--paper:        #F4F1EA   (fondo y superficie)
--well:         #EFEBE2   (superficie elevada / hover row / placeholder de imagen)
--ink:          #1A1A18   (texto principal + acción primaria)
--ink-hover:    #000000   (hover de la acción primaria)
--ink-muted:    #6E695E   (texto secundario y terciario/placeholder)
```

Acento y semánticos (una tinta por rol, sin escalas):
```
--vermillion:   #B44B3A   (acento de marca + foco + warning + danger)
--green:        #4E7A49   (success / settled)
--neutral-warm: #9A6C57   (acento terciario no semántico)
--info:         #6E695E   (informativo = misma tinta que el texto muted; sin color propio)
```

Reglas (los únicos separadores del sistema; sobre papel, no son texto):
```
--rule:         rgba(26,26,24,0.16)   (bordes y divisores)
--rule-strong:  rgba(26,26,24,0.32)   (borde de énfasis / input / regla "quiet")
```

Paneles de tinta (hero de auth y sidebar del back-office — bloque oscuro sobre papel claro):
```
--ink-panel:    #1A1A18   fondo del panel
--on-ink:       #F4F1EA   texto sobre tinta (papel)
--on-ink-muted: #8A857A   texto secundario sobre tinta
--on-ink-nav:   #A39D91   labels de navegación sobre tinta
--on-ink-rule:  rgba(244,241,234,0.14)   reglas sobre tinta
```

### 2.3 Tokens semánticos (los que usa el frontend) — tema único claro

No uses los valores base directamente en componentes: usa estos tokens semánticos. **Un solo tema (claro).**

| Token | Rol | Valor |
|---|---|---|
| `--color-bg` | Fondo de página | `#F4F1EA` (papel) |
| `--color-surface` | Superficie (cards, panels) | `#F4F1EA` (papel — igual que el fondo) |
| `--color-surface-2` | Superficie elevada / hover row | `#EFEBE2` (pozo) |
| `--color-border` | Bordes y divisores (regla) | `rgba(26,26,24,0.16)` |
| `--color-border-strong` | Borde de énfasis / input | `rgba(26,26,24,0.32)` |
| `--color-text` | Texto principal | `#1A1A18` (tinta) |
| `--color-text-muted` | Texto secundario | `#6E695E` |
| `--color-text-subtle` | Texto terciario / placeholder | `#6E695E` |
| `--color-primary` | Acción primaria | `#1A1A18` (tinta) |
| `--color-primary-hover` | Hover primario | `#000000` |
| `--color-primary-fg` | Texto sobre primario | `#F4F1EA` (papel) |
| `--color-accent` | Marca / realce | `#B44B3A` (bermellón) |
| `--color-accent-fg` | Texto sobre acento | `#F4F1EA` (papel) |
| `--color-success` | Éxito / `settled` | `#4E7A49` (verde) |
| `--color-success-bg` | Fondo suave éxito | `transparent` |
| `--color-warning` | Aviso / `pending` | `#B44B3A` (bermellón) |
| `--color-warning-bg` | Fondo suave aviso | `transparent` |
| `--color-danger` | Error / destructivo | `#B44B3A` (bermellón) |
| `--color-danger-bg` | Fondo suave error | `transparent` |
| `--color-info` | Informativo | `#6E695E` |
| `--color-info-bg` | Fondo suave info | `transparent` |
| `--color-neutral-warm` | Acento terciario no semántico | `#9A6C57` |
| `--color-focus-ring` | Anillo de foco (§4.3, §8.2) | `#B44B3A` (bermellón) |
| `--color-ink` / `--color-on-ink` | Panel de tinta / texto sobre él | `#1A1A18` / `#F4F1EA` |
| `--color-on-ink-muted` | Texto secundario sobre tinta | `#8A857A` |
| `--color-on-ink-nav` | Labels de nav sobre tinta | `#A39D91` |
| `--color-on-ink-rule` | Regla sobre tinta | `rgba(244,241,234,0.14)` |

Notas de contraste y semántica:
- **Warning y danger comparten el bermellón** (`#B44B3A`): en una paleta de una sola tinta de atención, el
  "en proceso" y el "error" se distinguen por el **texto en versalitas** (PENDIENTE vs. RECHAZADA), no por
  matices de color. `settled` usa **verde** `#4E7A49`. La asociación verde = "confirmado", bermellón =
  "atención" es la columna vertebral de la confianza.
- **`info` no tiene color propio:** usa la tinta muted `#6E695E` (lo informativo no compite con el acento).
- **Los `*-bg` son `transparent`:** cualquier `Badge` "soft" heredado pierde la caja de color y conserva
  solo el texto coloreado. Es intencional (sin rellenos, §2.1).

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

Regla de accesibilidad de badges (v1.3 — **ratificada, cambio aprobado por el humano**):
**estado = color + texto (versalitas), siempre visible.** El color nunca es el único portador de
significado; el **segundo canal obligatorio es la etiqueta en versalitas** (mono, `uppercase`) que se pinta
siempre — LIQUIDADA, PENDIENTE, EN PROCESO, RECHAZADA — de modo que el color queda **redundante, no
portador**. **El icono deja de ser requisito** en estados críticos (antes lo era, §7.4): en la dirección
editorial 5a los badges son texto, no pastillas con icono. Esto es un **cambio de regla deliberado y
aprobado**, no un descuido; la accesibilidad se preserva por **texto en versalitas + `aria-label` + foco
visible + contraste AA** (§10). El icono queda **opcional/decorativo** (`aria-hidden`).

---

## 3. Tipografía

### 3.1 Familias — tres trabajos distintos (self-hosted por `next/font`)
Tres familias, cada una con un trabajo claro. Se cargan **self-hospedadas vía `next/font/google`** en
`[locale]/layout.tsx` (sin petición a Google en runtime, sin FOUT), exponiendo las variables
`--font-serif`/`--font-sans`/`--font-mono` que consume `tailwind.config.ts`. Subconjunto `latin`.

- **Display / títulos (serif):** **`Zen Old Mincho`** (pesos 400/500/600). Serif de imprenta *mincho* que
  da la **voz editorial** de la dirección 5a: sobria, culta, "de página impresa". Se usa en `h1–h4` (por
  defecto peso **400**, no bold — el serif ya tiene voz). Fallback: `Georgia, "Times New Roman", serif`.
  > **Coherencia con el principio "tipografía profesional, nada de juguete" (§1.3):** un mincho es una serif
  > de imprenta seria, lo opuesto a una redondeada infantil o a la neutralidad genérica de "look de IA". Su
  > seriedad editorial *es* lo que profesionaliza el producto; no contradice el principio, lo encarna.
- **UI / texto (sans):** **`Archivo`** (pesos 400/500/600/700). Grotesca de rejilla, excelente para UI
  densa, botones, labels y cuerpo. Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- **Cifras / folios / estados / etiquetas (mono):** **`JetBrains Mono`** (pesos 400/500). Es el **portador
  del dato**: toda cifra, folio (`INV-000123`), precio, badge de estado (versalitas), `eyebrow` y etiqueta
  técnica van en mono con **`tabular-nums`** para alinear dígitos en columna (el sitio se lee como una tabla
  de precios). Fallback: `ui-monospace, Menlo, monospace`.
- **Datos de catálogo (nombres de cartas EN):** familia sans (`Archivo`); no se usa fuente decorativa.

### 3.2 Escala tipográfica (base 16px)

Los tamaños de título viven en `tailwind.config.ts` (`fontSize.display/h1/h2/h3`) y usan **peso 400** con la
serif (la voz la da la familia, no el bold).

| Token | rem / px | Familia | Uso | Peso | line-height |
|---|---|---|---|---|---|
| `text-display` | 2.5rem / 40px | serif | Hero / titular | 400 | 1.1 |
| `text-h1` | 2rem / 32px | serif | Título de página | 400 | 1.1 |
| `text-h2` | 1.5rem / 24px | serif | Sección | 400 | 1.2 |
| `text-h3` | 1.25rem / 20px | serif | Subsección / card title | 400 | 1.25 |
| `text-lg` | 1.125rem / 18px | sans | Lead | 500/600 | 1.4 |
| `text-base` | 1rem / 16px | sans | Cuerpo (default) | 400 | 1.5 |
| `text-sm` | 0.875rem / 14px | sans | Secundario, labels | 400/500 | 1.45 |
| `text-xs` | 0.75rem / 12px | sans | Captions, ayudas | 500 | 1.4 |
| `eyebrow` | 10px | **mono** | Etiqueta de sección (`uppercase`, `tracking 0.18em`) | 500 | 1 |
| badge / cifra | 11px+ | **mono** | Estados en versalitas, precios, folios | 400/500 | 1 |

Pesos disponibles: serif 400/500/600 · sans 400/500/600/700 · mono 400/500. No usar 100/200/300 (bajo
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

### 4.2 Radios — **cero (decisión de estilo deliberada)**
```
--radius-sm: 0px    --radius-md: 0px    --radius-lg: 0px    --radius-xl: 0px    --radius-full: 0px
```
**Todos los radios son 0.** En Tailwind, incluso `rounded-full`/`rounded-2xl` se mapean a `0px`
(`tailwind.config.ts`). Es una **decisión de estilo** de la dirección 5a, no un descuido: el sistema es
**esquinas rectas de imprenta**; las cartas (arte 5:7) y los bloques de tinta se leen como recortes de
papel. No introducir esquinas redondeadas en ningún componente (ni avatares, ni pills, ni sheets).

### 4.3 Sombras / elevación — **cero, salvo el anillo de foco**
```
--shadow-xs: none    --shadow-sm: none    --shadow-md: none    --shadow-lg: none
--shadow-focus: 0 0 0 2px var(--color-focus-ring)   ← EXCEPCIÓN de accesibilidad (ver §8.2)
```
**Sin sombras ni relieve.** La profundidad la dan el **aire** y las **reglas** (líneas), no el
`box-shadow`. La jerarquía de superficies se resuelve subiendo un escalón de tono (`surface` papel →
`surface-2` pozo) y con reglas de 1px, nunca con drop-shadows. Niveles: 0 página → 1 bloque (regla +
tono `surface-2`) → 2 dropdown/popover (regla + tono) → 3 modal/sheet (overlay de tinta + regla).

> **Excepción de accesibilidad — el anillo de foco NO se elimina.** `--shadow-focus` (bermellón, 2px)
> **sobrevive a la regla "sombras 0"** porque no es decoración: es el indicador de foco visible exigido por
> WCAG (§8.2). Se implementa como `outline: 2px solid var(--color-focus-ring); outline-offset: 2px`
> (`:focus-visible` global) y como `boxShadow.focus` en Tailwind para componentes que lo necesiten. Es la
> **única** "sombra"/outline permitida del sistema.

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
- **Imagen de carta** como elemento gráfico principal en storefront y bóveda: es SIEMPRE la **imagen de
  catálogo remota de pokemontcg.io** (`CardDTO.imageSmallUrl`/`imageLargeUrl`); **no hay fotos propias del
  producto** (v1.2). Relación de aspecto de carta **5:7** (`aspect-[5/7]`), **esquinas rectas (radio 0)**,
  borde `1px` `--color-border` (regla), fondo `surface-2` (pozo) como placeholder mientras carga (skeleton). Como es una URL
  remota, tratar `loading=lazy`, `alt` con el nombre EN de la carta y **fallback** si la imagen remota no
  carga (placeholder con nombre/set, nunca un roto). No se sube ni almacena ninguna imagen de producto.
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
- Forma: **segmented control** de dos segmentos `ES | EN` (**radio 0**), el activo con fondo
  `--color-primary` (tinta) y texto `--color-primary-fg` (papel); el inactivo `ghost`. Ancho fijo por segmento (no salta
  al cambiar). En móvil puede colapsar a un botón con icono globo + código actual (`ES ▾`).
- Accesibilidad: `role="group"` con `aria-label="Idioma / Language"`; cada segmento es un botón
  `aria-pressed`. Cambia `next-intl` locale y persiste en `User.locale` vía `PATCH /users/me` cuando hay
  sesión; si no, en cookie/localStorage. El `<html lang>` se actualiza.
- Regla: el toggle **no** traduce datos de catálogo (nombres/sets siguen en inglés); solo la UI.

### 6.6 Tabs, Breadcrumbs, Pagination
- **Tabs:** subrayado inferior de 2px `--color-primary` en el activo; texto `muted` en inactivos.
  Teclado: flechas + `aria-selected`. Usados en ficha de carta (Descripción/Condición) y M6 ficha
  360°. **La ficha ya no tiene pestaña "Fotos"** (v1.2): la imagen es la de catálogo de pokemontcg.io y no
  hay fotos propias del producto.
- **Breadcrumbs:** solo storefront (Catálogo › Set › Carta) para SEO/orientación; separador `/`, último
  no enlazado (`aria-current=page`).
- **Pagination:** patrón `{ page, pageSize, total }` del contrato; botones prev/next 44px + selector de
  página. En móvil, "Cargar más" o paginación compacta.

### 6.7 Botón social "Continuar con Google" (`GoogleSignInButton`) — v1.1
Alternativa a email/contraseña en las pantallas de **login** y **registro** (`POST /auth/google`).
- **Ubicación y jerarquía:** debajo del formulario de email, separado por un divisor **"o / or"**
  (línea + label centrado, `text-xs muted`). El email/contraseña sigue siendo la acción primaria
  (botón `primary`); Google es una alternativa con igual peso visual pero estilo neutro (no compite
  como CTA de marca ni usa el bermellón).
- **Estilo:** botón de ancho completo (`w-full`), alto `lg` (48px) para objetivo táctil cómodo, **radio 0**,
  **fondo `--color-surface`** (papel) con **borde `--color-border-strong`** y **texto `--color-text`**
  (variante `secondary` del §6.1). Contenido centrado: **logo "G" multicolor oficial de Google** (SVG,
  ~18–20px, no se recolorea) + gap 8px + label **"Continuar con Google" / "Continue with Google"**. Respeta
  las guías de marca de Google (no alterar el logo).
- **Consistencia de marca:** es el único botón que introduce color externo (el logo G); por eso se
  mantiene sobre superficie de **papel** para no chocar con la paleta tinta/bermellón. El logo G conserva
  sus colores oficiales (contraste suficiente sobre el papel `--color-surface`).
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
certNumber?, referenceValue, salePriceCents?, sellable }`). La **imagen es siempre la de catálogo de
pokemontcg.io** (`card.imageSmallUrl`/`imageLargeUrl`); **no hay fotos propias del producto** (v1.2).
Anatomía (vertical):
1. **Imagen** de catálogo `aspect-[5/7]`, con skeleton al cargar. **Sobre el arte SOLO va lo imprescindible
   con scrim de alto contraste** (regla anti-empalme, §7.2b): en contexto **bóveda**, el badge de
   **titularidad** en la esquina superior-derecha (chip con scrim). El badge de **calidad**
   (condición/grado/tipo) **NO se monta suelto sobre el arte**: por defecto vive en la **fila de info bajo
   la imagen** (paso 3b); el único que puede quedarse en el arte es el **chip de grado** de gradeada, y solo
   con scrim (§7.2b).
2. **Nombre** (EN, `text-sm/base` semibold, 1–2 líneas con `line-clamp`; envuelto en `lang="en"`).
3. **Set + número** (`text-xs muted`, EN). En Compra se sugiere sufijar el año del set entre paréntesis
   cuando ayuda ("Surging Sparks · 2024") reutilizando el `year` de facetas.
3b. **Fila de calidad (bajo la imagen, fuera del arte):** `ConditionBadge` (§7.2b) — raw `Casi nueva (NM)`,
   gradeada `PSA 10 · #12345678`, o `Sellado + subtipo`. Es la **ubicación por defecto** de la calidad, para
   que nunca se pierda sobre arte claro/oscuro.
4. **Price tag** (§7.3): en **Compra** siempre precio MXN grande (`salePriceCents`) + "sin IVA" + fecha
   de referencia. En **bóveda** muestra el valor de referencia; solo ahí puede aparecer "Precio
   pendiente".
5. Acción contextual: en Compra botón `accent`/`primary` "Agregar"/"Comprar"; en bóveda, botón
   `secondary` "Retirar" (deshabilitado si `pending`).

> **Regla dura de Compra (jerarquía + confianza):** la vitrina de Compra lista **solo inventario
> publicado con precio** (`sellable=true`, `salePriceCents != null`); el `ListingCard` en Compra
> **NUNCA** renderiza el estado "precio pendiente" ni `$0`/`—`. La cifra siempre está presente. El
> orden de lectura del card prioriza: imagen → nombre → **calidad (fila bajo la imagen)** → **precio** →
> CTA; el badge de calidad es secundario y va **fuera del arte** (§7.2b), no montado sobre la imagen. El
> "valor de mercado/referencia" es informativo y va en `text-xs muted` bajo el precio de venta (ver §7.3),
> sin competir con la cifra de venta.

Badge de **titularidad**: `pending` (bermellón) / `settled` (verde), como **texto en versalitas**
(PENDIENTE / LIQUIDADA); el color es redundante y el icono es opcional (`aria-hidden`), no requisito (§2.4).

Estados del card:
- normal / hover (sin sombra — leve `scale-[1.02]` de la imagen y/o regla de énfasis) / focus-visible
  (anillo bermellón en todo el
  card, es un enlace) / skeleton (imagen + 3 barras). El estado "no vendible / precio pendiente" **solo
  existe en contexto bóveda**, nunca en Compra.
- Variante **compacta horizontal** para listas de bóveda, checkout, picking y colas admin: miniatura
  56×78, nombre + folio + estado en fila.

### 7.1b Variante SELLADO del `ListingCard` (`productType=sealed`)
El sellado (booster box, ETB, bundle, tin, blister) es una línea de venta distinta y su tarjeta se
lee diferente:
- **Sin** badge de condición ni de rareza (el sellado no lleva `rawCondition`/grade/rareza).
- Badge único **"Sellado / Sealed"** (tono `info`, icono `package`/caja de lucide) en la **fila de calidad
  bajo la imagen** (paso 3b de §7.1, no montado sobre el arte), y **subtipo** derivado de `sealedSubtype`
  como segundo pill neutro cuando existe: "Booster Box", "ETB", "Bundle", "Tin", "Blister" (etiquetas
  localizadas por `status.sealedSubtype.*`; el dato del subtipo es un enum del contrato, no se traduce el
  producto en sí).
- **Imagen**: es la **imagen de catálogo remota** de pokemontcg.io (v1.2, sin fotos propias). Si no es 5:7
  (las cajas son más cuadradas), el mismo contenedor `aspect-[5/7]` la centra con `object-contain` sobre
  fondo `surface-2` (no recortar la caja). El badge "Sellado" desambigua que no es un single.
- **Precio**: siempre visible (`salePriceCents`, precio manual del admin en MXN) + "sin IVA"; como en todo
  Compra, el sellado sin precio no se publica, así que la tarjeta nunca aparece sin cifra.
- Nombre/set en EN igual que el resto; no se muestra número de carta cuando no aplica.

### 7.2 Badge / Pill (`Badge`)
- Formas: **soft** (fondo `-bg` + texto `-color`, default) y **outline** (borde + texto, para estados
  "en proceso" o secundarios como `chargeback`, `aprobada`, precio pendiente).
- **Texto mono en versalitas** (`text-[11px] uppercase tracking-[0.06em]`), **sin caja** en `soft` (radio 0);
  `outline` conserva una regla de 1px. Siempre con **texto**; icono opcional (`aria-hidden`).
- Mapeo de color por estado en §2.4. Componente recibe `{status, domain}` y resuelve token + clave i18n.

### 7.2b Ficha técnica y condición — `ListingSpec` (retícula) + `ConditionBadge` (ficha) — v1.3
Deriva de `productType`. El raw se opera **únicamente en Near Mint** (ya no existen LP/MP/HP/DMG).

**Representación por defecto en retícula = `ListingSpec` (`Raw · NM · Acabado` en mono) — decisión ratificada.**
En la **retícula de Compra y de bóveda** la calidad se representa por defecto como un **único renglón mono en
versalitas**, no como una fila de pastillas: `RAW · NM · HOLOFOIL`, `GRADED · PSA 9 · CERT 84213307`,
`SELLADO · ETB`. Es la ubicación por defecto (`ListingSpec`, `text-[11px]` mono `uppercase`, `text-text`).
Se lee más rápido, alinea como una tabla técnica y **no compite con el arte**, que es lo que debe mandar en
la retícula. **Esto es una decisión de diseño ratificada** (no una excepción para contenedores estrechos):

- **Nombre completo del estándar en `aria-label`/`title`.** El renglón abrevia la condición a `NM` para no
  romper la retícula; el estándar legible viaja en `title` **y** `aria-label`:
  `"Casi nueva (NM) — Como nueva; a lo mucho imperfecciones mínimas…"`. Así el lector de pantalla lo anuncia
  sin depender del hover y la sigla nunca queda "cifrada" sin explicación (accesibilidad preservada).
- **Etiqueta legible en la ficha de detalle.** La etiqueta completa **"Casi nueva (NM)" / "Near Mint (NM)"**
  se pinta en la **ficha de detalle** con `ConditionBadge` (§7.2b tabla), que sí tiene hueco para ella. El
  renglón mono es para retículas; el badge legible es para la ficha.

`ConditionBadge` (ficha de detalle) sigue derivando de `productType`:

| `productType` | Contenido | Tono | Segundo canal |
|---|---|---|---|
| `raw` (`rawCondition=NM`) | **"Casi nueva (NM)"** · EN **"Near Mint (NM)"** | **success** (verde `#4E7A49`, `bg` transparente) | texto en versalitas + `aria-label` con descripción del estándar |
| `graded` | **`PSA 10 · CERT 12345678`** (`gradingCompany`+`gradeValue`+`certNumber`) → `GradedCertChip` | `accent` (bermellón) | texto (empresa+grado+cert) + `aria-label` |
| `sealed` | "Sellado / Sealed" + subtipo (§7.1b) | `info` (muted) | texto + subtipo |

El `Badge` (§7.2) es **texto mono en versalitas** del color de su tono, **sin caja** (los `*-bg` son
`transparent`, §2.3); `outline` conserva una regla de 1px solo para lo que debe frenar la lectura
(p. ej. `PRECIO PENDIENTE`). El icono es opcional (`aria-hidden`), ya no requisito (§7.4).

**Chip sobre el arte (scrim) — cuando exista, usa TINTA, no color:**
La representación por defecto (renglón mono bajo la imagen) hace que **normalmente no haga falta** montar
nada sobre el arte. Si un contexto refuerza la autenticidad o la titularidad **encima** de la imagen, se usa
un **chip con scrim sólido de tinta**, nunca texto/pill translúcido:
   - **Fondo:** **tinta opaca `#1A1A18` (~92% de opacidad)**, texto **papel `#F4F1EA`**. Este par
     papel/tinta da **~15:1 (AA/AAA)** **independiente del arte** (el scrim opaco tapa la imagen debajo).
     **Radio 0**, `px-2 py-0.5`. Sin translúcidos, sin degradados, sin depender del color del arte.
   - **Posición:** esquina superior; en bóveda la titularidad va superior-derecha.
   - **Tamaño:** `text-[11px]` mono peso 500–600, `uppercase`; icono opcional 12–14px `aria-hidden`.
   - **Contenido gradeada:** `PSA 10 · CERT 12345678` (en estrecho colapsa a `PSA 10`, con el cert completo
     en el renglón/ficha; el `aria-label` siempre lleva empresa+grado+cert).
   - **Consistencia:** el badge de **titularidad** sobre el arte sigue la misma regla de **scrim de tinta**
     (`#1A1A18/92` + texto papel), nunca pill translúcido ni relleno de color semántico sobre el arte.

### 7.2c Chip de gradeada — empresa + grado + certificado (`GradedCertChip`) — v1.2
La condición de una gradeada **no depende de foto**: el slab es la garantía. El chip muestra los **tres
datos verificables**: **empresa + grado + número de certificado**.
- **Formato canónico:** **`PSA 10 · #12345678`** (o `CGC 9.5 · #01234567`). Empresa+grado en peso 600; el
  `· #<certNumber>` en el mismo chip, `tabular-nums`, para que el número se lea/copie. `certNumber` viene de
  `ListingDTO.certNumber` (string; el contrato lo marca requerido para publicar una gradeada).
- **Dónde:** en la **fila de info** del card (default) y de forma destacada en la **ficha** (junto al
  nombre); opcionalmente el chip de grado (sin el cert) puede ir sobre el arte con scrim (§7.2b regla 2).
- **Ficha — cert verificable:** en la ficha, el `certNumber` se presenta con la etiqueta "Certificado /
  Certificate" y, si el humano confirma URL de verificación de la graduadora, como **enlace** ("Verificar
  en PSA/CGC", `target=_blank`, `rel=noopener`); mientras no haya URL confirmada, es **texto copiable** con
  botón "Copiar" (no inventar la URL). Solicitud registrada al arquitecto/PO en el resumen.
- **Accesibilidad:** `aria-label="Gradeada PSA, grado 10, certificado 12345678"`; el `·` es decorativo. No
  depender del color (`accent`): el texto ya porta empresa+grado+cert.
- **Tono:** `accent` (bermellón, autenticidad/valor). Sobre el arte usa el scrim de **tinta** de §7.2b (no
  el bermellón directo, que no garantiza AA sobre arte claro).

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
- **Tono elegido para NM:** **verde** (`success #4E7A49`, texto sobre papel; `bg` transparente) — NM es el
  **único** grado y es un estándar de confianza/"garantía de condición"; el verde lo alinea con la semántica
  de "verificado". No usar el bermellón de atención (NM no es un estado pendiente ni de error). Cumple AA
  (§10: verde `#4E7A49` sobre papel `#F4F1EA` ≈ 4.4:1, con el texto en versalitas como portador principal).
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

### 7.4 Iconos de estado semántico — **RETIRADO como requisito (v1.3); opcional/decorativo**
> **Cambio de regla aprobado por el humano (dirección 5a):** el icono **ya no es el segundo canal obligatorio**
> en estados críticos. El segundo canal ahora es el **texto en versalitas** siempre visible (§2.4). En la
> piel editorial 5a los badges son **texto mono**, no pastillas con icono. Este mapa queda **retirado como
> requisito** y solo es una guía **opcional** para cuando un icono decorativo aporte (siempre `aria-hidden`,
> nunca reemplazando al texto):
- success/`settled` → check / candado cerrado (opcional).
- warning/`pending` → reloj / candado abierto (opcional).
- danger → alert-triangle (opcional).
- info → info-circle (opcional).
- accent/en proceso → package (envío) (opcional).

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
- Modal centrado (desktop) / **bottom sheet** (móvil), **radio 0**, overlay de tinta `rgba(26,26,24,.5)`.
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

### 7.10 Uploader de foto del INE (`IneUploader`) — ÚNICO uploader del sistema (v1.2)
> **Alcance v1.2:** este es el **único** uploader que queda en toda la app. Sirve **solo** para la **imagen
> del INE** en el flujo de **KYC del buylist** (`POST /uploads/presign` con `purpose="kyc_ine"`). **Se
> eliminan** las fotos de producto/inventario (M1 se da de alta **sin cámara**, imagen de catálogo remota) y
> la evidencia de disputa (va **por correo a soporte**, §7.11). No existe otro flujo de subida.
- Objetivo: capturar **INE anverso/reverso** del vendedor cuando la buylist supera el tope (KYC/AML). El INE
  se sube a **bucket privado cifrado con retención** (`INE_RETENTION_DAYS`); nunca es público.
- Disparo de cámara: `<input type="file" accept="image/*" capture="environment">`; botón grande
  "Tomar foto / Take photo" (icono cámara) + alternativa "Subir archivo".
- **Dos slots** etiquetados **Anverso/Front** y **Reverso/Back** del INE, cada uno con su preview.
- Flujo por foto: seleccionar → preview inmediato → **subir con barra de progreso** (presign PUT del
  contrato, §8 uploads) → estado "Subida ✓" con miniatura, o error con reintento. `aria-busy` durante
  subida. Permitir re-tomar/eliminar antes de confirmar.
- Estados: vacío (dropzone punteada + icono cámara), subiendo (progreso %), éxito (miniatura + check),
  error (borde `danger` + "Reintentar"), disabled (sin permiso/rol).
- **Aviso de privacidad (obligatorio):** junto al uploader, nota `text-xs muted` "Tu INE se guarda cifrado y
  se elimina tras el periodo de retención; se usa solo para verificar el pago." (dato sensible; §8.2).
- Guía visual mínima: texto de ayuda "Buena luz, documento centrado, datos legibles".
- Táctil: botones ≥ 48px; los dos slots deben verse sin scroll en móvil.

### 7.11 Disputa por correo (`DisputeEvidenceContact`) — reemplaza al comparador de fotos (v1.2)
> **Eliminado:** el componente **`PhotoCompare`/comparador de fotos** de disputas (ingreso vs. reclamo)
> **ya no existe** — el producto no tiene fotos propias de ingreso y el cliente no sube foto de reclamo.
- **Flujo de disputa del cliente (`POST /disputes`):** el cliente elige el ítem entregado y escribe una
  **descripción** (`Textarea`, §6.2). **No hay uploader.** En su lugar, un **panel de contacto de evidencia**
  (variante `Banner info`, §7.5) explica: *"Envía tus fotos y evidencia por correo a **soporte@tcgvault.mx**
  citando tu número de orden/disputa."* con el correo como **enlace `mailto:`** y botón **"Copiar correo"**.
  El correo `soporte@tcgvault.mx` viene de `evidenceContact` en la respuesta del contrato (**placeholder por
  confirmar por el humano**; no hardcodear si el contrato lo entrega). Se muestra también en términos/FAQ.
- Tras crear la disputa se muestra el `PipelineStepper` de disputa y el `deadlineAt` (ventana de 7 días
  desde la entrega); mensaje claro "Tu evidencia por correo debe llegar antes de {fecha}".
- **Back-office M8 (admin):** el detalle de disputa **no tiene comparador de fotos**. Muestra: descripción
  del cliente, `evidenceContact` (el correo, para el admin cotejar el hilo), y —para **gradeadas**— el
  **chip empresa+grado+`certNumber`** (§7.2c, verificable en la graduadora) como base de resolución; para
  **raw NM**, el **estándar/política de condición propio**. La imagen del ítem es la de catálogo. La
  resolución (recompra al precio pagado / rechazo) usa botones de §7.6 (recompra = money-out, súper-admin).

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

**Colores de tendencia (verde sube / bermellón baja) con AA sobre papel:**
- **Sube (`direction=up`):** usar el token **success** (verde `#4E7A49`) para línea, área y delta. Cumple AA
  sobre papel (§10; el delta se lee además como texto con signo/flecha).
- **Baja (`direction=down`):** usar el token **danger** (bermellón `#B44B3A`). AA verificado en §10.
- **Plano (`flat`):** `--color-text-muted` (`#6E695E`).
- **No depender solo del color (crítico para daltonismo):** el delta **siempre** incluye **signo (+/−) y
  flecha (▲/▼)**; el encabezado nombra la dirección en texto ("subió"/"bajó"/"sin cambios" en el resumen
  accesible). La línea puede además variar el estilo si se desea (sólida up / con marcadores down), pero el
  signo+flecha es el portador primario.

**Tipografía de ejes y cifras:** mono (`JetBrains Mono`) con `tabular-nums` en todas las cifras (encabezado,
ejes, tooltip); etiquetas de eje `text-xs muted`; encabezado de valor `text-h1` (serif); delta en mono peso 500.

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

### 7.18 Gráfica pública de valor de set — hero de la home (`FeaturedSetGlance`) — v1.9-set-chart
Panel derecho del hero (`(storefront)/page.tsx`, columna **"TU BÓVEDA"**), **rama del visitante ANÓNIMO**.
Hoy sin sesión ese panel solo muestra 3 líneas de confianza + "Entrar", así que el cliente a atraer **no ve
ninguna gráfica**. Esta sección define el gancho: una **gráfica de MERCADO del "set destacado"** (valor real
del set en el tiempo), como espejo público del `PortfolioGlance` que ve el usuario con sesión. Consume
`GET /api/v1/catalog/featured-set/value-history?range=1m` → `SetValueHistoryResponse` (§API_CONTRACT
v1.9-set-chart). **Es la misma familia visual que §7.17 — NO se inventa un lenguaje nuevo:** reutiliza la
cifra grande tabular, el `Delta` (signo+flecha+color de tendencia) y el `Sparkline` desnudo del componente
`PortfolioTrendChart.tsx` (los sub-componentes `Delta`/`Sparkline` ya existen y son reutilizables).

**Regla de conmutación del panel (qué ve cada quién):**
- **Con sesión:** se mantiene **exactamente** el `PortfolioGlance` personal + "valor por set" como está hoy
  (§7.17). Esta sección **no toca** la rama autenticada.
- **Sin sesión (anónimo):** la **gráfica de mercado del set destacado ENCABEZA el panel** (es el gancho, va
  arriba, en el mismo hueco donde el usuario con sesión ve su cifra) y **debajo se conservan 1–2 líneas de
  confianza** + el enlace "Entrar". Decisión de gancho: el dato de mercado real **atrae** (muestra que los
  precios son vivos y verificables); las 3 líneas de confianza se **podan a 2** (custodia + precio real; la de
  autenticación puede omitirse por espacio) para no empujar el CTA fuera de la vista. El enlace "Entrar"
  permanece anclado al pie (`mt-auto`), sin cambios.

**Anatomía (arriba → abajo), reusando §7.17:**
1. **Cabecera del panel:** se conserva la fila existente `eyebrow` **"TU BÓVEDA / YOUR VAULT"** a la izquierda
   y **"MXN · sin IVA"** a la derecha (coherente con toda la home; el valor es referencia de mercado sin IVA).
2. **Sub-encabezado del set:** el **nombre del set** (`set.name`, de catálogo, en inglés, `lang="en"`, NO se
   traduce) como rótulo `font-serif`/`text-text`, con una **etiqueta `eyebrow`** debajo/al lado tipo **"Valor de
   mercado · Set destacado" / "Market value · Featured set"**. Deja claro que es **referencia de mercado**, no
   un precio de venta ni una promesa de "valor del set completo" (el total suma solo cartas priceadas —
   `pricedCardCount`; ver microcopy de nota).
3. **Cifra grande del valor actual:** último `points[].valueMxnCents`, con el **mismo estilo que §7.17 /
   `PortfolioGlance`**: `tabular` `text-[32px]…lg:text-[41px]` `font-medium` `tracking-[-0.02em] text-text`.
   Con `points: []` (serie recién sembrada) la cifra puede faltar → ver "Estado honesto".
4. **Delta de tendencia:** reutiliza el componente `Delta` con `change` del DTO — signo **+/−**, flecha
   **▲/▼**, monto y `(±% )`, p. ej. **"▲ +MX$ 34,700 (+2.70 %)"**; color sube = success verde `#4E7A49`
   (token vivo `#4a7345`), baja = danger bermellón `#B44B3A`, plano = `#6E695E` con "Sin cambios". **Nunca solo
   color:** signo+flecha son el portador primario (daltonismo), idéntico a §7.17.
5. **Sparkline desnudo:** la **polilínea** de `points` con el color de tendencia, reutilizando el `Sparkline`
   de §7.17 (1.5px, sin ejes, sin retícula, sin relleno, sin dot). Minimalismo 5a intacto (radios 0, sombras 0).
   Sin fila de rangos ni tabla (es un "glance", como `PortfolioGlance`); el rango es fijo **1m** (default del
   endpoint). Opcional: 1–2 líneas de confianza **debajo** de este bloque.

**Estado honesto — NO dibujar curva falsa (obligatorio):**
- **< 2 puntos** (`points.length < 2`; incluye el caso `points: []` de serie recién sembrada, y el caso de un
  único snapshot): el `Sparkline` **no se dibuja** (ya devuelve `null` con `< 2` puntos, mismo criterio que
  §7.17 — no fabricar una línea plana ni un cero engañoso). Se muestra la **cifra de hoy** si hay al menos 1
  punto (o se degrada al sub-encabezado si `points: []`), y un **microcopy** neutro `text-xs muted` bajo el
  delta. No es un error, no lleva banner `danger` ni iconografía de alarma.
- **Microcopy del estado "recopilando historial" (ES / EN):**
  - Título/línea corta: **"Recopilando historial"** / **"Collecting history"**.
  - Frase de apoyo (opcional, `text-sm muted`): **"La tendencia de este set aparecerá cuando tengamos un par
    de días de historia."** / **"This set's trend will appear once we have a couple of days of history."**
  - Con exactamente 1 punto (hay cifra de hoy pero no curva): se muestra la cifra + **"Recopilando historial"**
    (misma línea), reservando la curva para cuando haya ≥ 2 puntos.
- **`set: null`** (no hay ningún `CardSet` para graficar): el hero **degrada sin error** — se omite todo el
  bloque de gráfica y el panel anónimo cae a su forma previa (líneas de confianza + "Entrar"). Nunca mostrar
  un placeholder roto ni un cero.
- **Tendencia negativa:** estado **legítimo** (no error) — bermellón + ▼ + signo −, sin banners de alarma
  (idéntico a §7.17).
- **Cargando:** skeleton de la cifra + skeleton de la polilínea (~90px, como §7.17), sin spinner.
- **Error de carga:** el bloque de gráfica degrada silenciosamente a las líneas de confianza (el hero **no**
  puede quedar roto por un fallo de un endpoint público secundario); opcionalmente un mini "Reintentar"
  discreto. Prioridad: que el hero siempre renderice su promesa.

**Accesibilidad (no negociable):**
- **Foco visible intacto:** el enlace "Entrar" y cualquier control conservan el anillo `--shadow-focus` /
  `:focus-visible` bermellón (§8.2). Esta sección **no** introduce controles nuevos que puedan atrapar foco ni
  altera el orden de tabulación del panel.
- **La polilínea es decorativa:** el `Sparkline` va **`aria-hidden`** (se invoca con `summary=""`, igual que en
  `PortfolioGlance`, para no emitir un `role="img"` con `aria-label` vacío). **El `Delta` narra el cambio** en
  texto (signo+flecha+monto+%), que es el portador accesible del dato — el lector de pantalla anuncia la
  variación aunque no "vea" la curva. La **cifra** y el **nombre del set** son texto real, no imagen.
- **Contraste AA:** cifra/nombre en `text-text` sobre papel, delta en tokens success/danger/muted **ya
  verificados AA sobre papel en §10**; el microcopy en `text-muted` (`#6E695E`) cumple AA para texto. No se
  usa color como único canal (delta con signo+flecha; el nombre del set y "Valor de mercado" son texto).
- **Idioma:** el nombre del set va `lang="en"` (dato de catálogo no traducido); toda la UI alrededor
  (etiquetas, microcopy) es bilingüe ES/EN vía i18n, default español (coherente con la plataforma).

**Fuente de datos = REAL, nada fabricado:** la serie proviene del snapshot diario `SetValueSnapshot`
(precios de **pokemontcg.io**, jobs `set-price-sync` + `set-value-snapshot`), **crece a diario** y suma solo
cartas **priceadas** del set (`pricedCardCount`; las sin precio se excluyen, no se inventan). El set destacado
se resuelve **server-side** (`HOME_FEATURED_SET_ID` + fallback en cascada); el front **no** hardcodea id.
Coherente con SEC-A1: el valor se deriva en backend, el cliente solo lo pinta. Por eso el "estado honesto"
de arriba es una regla dura: si aún no hay ≥ 2 días de historia real, se dice "Recopilando historial" en vez
de simular una curva.

**Nota de referencia de mercado (microcopy opcional, `text-xs muted`):** para no prometer "valor del set
completo", se admite una nota tipo **"Referencia de mercado de las cartas con precio de este set."** /
**"Market reference for the priced cards in this set."** (refleja que `valueMxnCents` = suma de las priceadas,
no del set entero).

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
- **Foco visible SIEMPRE:** `:focus-visible` con **anillo bermellón** (`outline: 2px solid
  var(--color-focus-ring); outline-offset: 2px`, o `--shadow-focus` en componentes), contraste ≥ 3:1 con el
  fondo (§10). **Este anillo es la excepción de accesibilidad que sobrevive a "sombras 0" (§4.3):** aunque el
  sistema no usa sombras ni radios, el foco visible es obligatorio y no se elimina. Nunca `outline:none` sin
  sustituto.
- **Orden de tabulación** lógico y coherente con el orden visual; sin trampas de foco salvo en modales
  (focus trap intencional). Skip-link "Saltar al contenido" al inicio.
- **Labels:** todo control tiene label programática (`<label>`/`aria-label`). Iconos-botón con
  `aria-label`. Campos con error usan `aria-invalid` + `aria-describedby`.
- **Objetivos táctiles** ≥ 44×44px (back-office y móvil). Espaciado suficiente entre acciones.
- **Movimiento:** respetar `prefers-reduced-motion` (desactivar `scale`/transiciones no esenciales).
- **Contraste:** ver §10; se verifica sobre el papel (tema único claro).
- **Lectores de pantalla:** badges de estado exponen **texto en versalitas** (portador del significado, no
  el color); cambios asíncronos (subida de INE, resultado de cotización, errores) se anuncian con
  `aria-live="polite"` (o `assertive` para errores de pago).
- **Movimiento reducido:** `prefers-reduced-motion` desactiva animaciones/transiciones no esenciales
  (implementado en `globals.css`).

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

Pares principales verificados (ratio aprox. sobre el papel). **Tema único claro** (no hay tabla de oscuro).
Objetivo: texto normal ≥ 4.5:1, texto grande/UI/anillo de foco ≥ 3:1. Papel `#F4F1EA`, pozo `#EFEBE2`.

**Texto y acento sobre papel `#F4F1EA` (y pozo `#EFEBE2`):**
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Tinta `#1A1A18` sobre papel `#F4F1EA` | ~15.5:1 | AA/AAA |
| Tinta `#1A1A18` sobre pozo `#EFEBE2` | ~14.7:1 | AA/AAA |
| Muted `#6E695E` sobre papel `#F4F1EA` | ~4.8:1 | AA |
| Muted `#6E695E` sobre pozo `#EFEBE2` | ~4.6:1 | AA |
| Bermellón `#B44B3A` (accent/warning/danger) sobre papel | ~4.65:1 | AA (texto) |
| Verde `#4E7A49` (success/`settled`) sobre papel | ~4.4:1 | AA borde (texto en versalitas es el portador) |
| Regla `rgba(26,26,24,0.16)` sobre papel (no texto, UI) | ~1.3:1 | decorativo (ok) |
| Anillo de foco bermellón `#B44B3A` sobre papel | ~4.65:1 | AA (≥3:1 UI) |
| Anillo de foco bermellón `#B44B3A` sobre pozo `#EFEBE2` | ~4.4:1 | AA (≥3:1 UI) |

**Texto sobre relleno sólido (botón primario, chip de scrip, panel de tinta):**
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Papel `#F4F1EA` sobre primario/tinta `#1A1A18` (botón, scrim) | ~15.5:1 | AA/AAA |
| Papel `#F4F1EA` sobre accent/bermellón `#B44B3A` | ~4.64:1 | AA (texto) |
| `on-ink` papel `#F4F1EA` sobre panel de tinta `#1A1A18` | ~15.5:1 | AA/AAA |
| `on-ink-muted` `#8A857A` sobre panel de tinta `#1A1A18` | ~4.75:1 | AA |

**Scrim sobre el arte (§7.2b)** — chip de tinta opaca, independiente de la imagen:
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Papel `#F4F1EA` sobre scrim tinta `#1A1A18/92%` | ~15:1 | AA/AAA (independiente del arte) |

**Colores de tendencia del `PortfolioTrendChart` (§7.17)** — reutilizan tokens ya verificados:
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Sube `#4E7A49` (success) sobre papel `#F4F1EA` | ~4.4:1 | AA borde (línea UI + delta con signo/flecha) |
| Baja `#B44B3A` (danger) sobre papel `#F4F1EA` | ~4.65:1 | AA (línea UI + delta con signo/flecha) |
- La línea del chart es UI (≥ 3:1) y el delta se lee como **texto**; el color **nunca** es el único
  indicador: siempre acompaña signo (+/−) y flecha (▲/▼). Costo base usa `text-muted` punteado (no
  verde/bermellón).

Reglas derivadas:
- **El texto en versalitas es el portador del significado, no el color** (§2.4). Por eso el **verde de
  éxito** (~4.4:1, en el borde de AA para texto pequeño) es aceptable: nunca es el único canal — la etiqueta
  LIQUIDADA/NM en versalitas está siempre presente y la tinta principal (~15:1) domina la lectura.
- **Warning y danger comparten bermellón:** se distinguen por el texto (PENDIENTE vs. RECHAZADA), no por
  color.
- El texto `subtle`/placeholder (`#6E695E`) no se usa para información esencial (solo pistas).
- El logo "G" de Google sobre papel conserva sus colores oficiales (contraste suficiente; no se recolorea).
- Verificar cualquier token nuevo antes de introducirlo; no bajar de AA sin un segundo canal (texto).

---

## 11. Guía de implementación para el frontend (Tailwind + Next.js)

> El frontend implementa; aquí está el puente entre tokens y Tailwind. Ubicación sugerida:
> `frontend/src/app/globals.css` (variables) y `frontend/tailwind.config.ts` (mapeo). Estas rutas son
> propiedad de frontend; este documento solo especifica el contrato de tokens.

### 11.1 CSS variables (**tema único claro** — sin `.dark`)
```css
:root {
  /* Papel y pozos */
  --color-bg: #F4F1EA; --color-surface: #F4F1EA; --color-surface-2: #EFEBE2;
  /* Reglas: el único separador (sin cajas ni sombras) */
  --color-border: rgba(26,26,24,0.16); --color-border-strong: rgba(26,26,24,0.32);
  /* Tinta */
  --color-text: #1A1A18; --color-text-muted: #6E695E; --color-text-subtle: #6E695E;
  /* La acción primaria es tinta, no color */
  --color-primary: #1A1A18; --color-primary-hover: #000000; --color-primary-fg: #F4F1EA;
  /* Bermellón: sello de marca, usado con avaricia */
  --color-accent: #B44B3A; --color-accent-fg: #F4F1EA;
  /* Estados: texto coloreado sobre papel; los *-bg son transparent a propósito */
  --color-success: #4E7A49; --color-success-bg: transparent;
  --color-warning: #B44B3A; --color-warning-bg: transparent;
  --color-danger:  #B44B3A; --color-danger-bg:  transparent;
  --color-info:    #6E695E; --color-info-bg:    transparent;
  --color-neutral-warm: #9A6C57;
  /* Paneles de tinta (hero de auth, sidebar del back-office) */
  --color-ink: #1A1A18; --color-on-ink: #F4F1EA; --color-on-ink-muted: #8A857A;
  --color-on-ink-nav: #A39D91; --color-on-ink-rule: rgba(244,241,234,0.14);
  /* Foco (excepción de accesibilidad, §4.3/§8.2) */
  --color-focus-ring: #B44B3A;
  /* Radios: cero en todo el sistema */
  --radius-sm:0px; --radius-md:0px; --radius-lg:0px; --radius-xl:0px;
}
```
> **No hay bloque `.dark`.** El papel *es* la marca y no tiene equivalente oscuro. Tampoco existe
> `ThemeToggle`. `:focus-visible` global usa `outline: 2px solid var(--color-focus-ring); outline-offset:2px`.

### 11.2 tailwind.config (extracto de mapeo)
```ts
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
  'neutral-warm': 'var(--color-neutral-warm)',
  ink: 'var(--color-ink)', 'on-ink': 'var(--color-on-ink)',
  'on-ink-muted': 'var(--color-on-ink-muted)', 'on-ink-nav': 'var(--color-on-ink-nav)',
  'on-ink-rule': 'var(--color-on-ink-rule)',
},
// Radios 0: el sistema se apoya en reglas, no en cajas.
borderRadius: { none:'0px', sm:'0px', md:'0px', lg:'0px', xl:'0px', '2xl':'0px', full:'0px', DEFAULT:'0px' },
// Sombras 0, EXCEPTO el anillo de foco (excepción de accesibilidad, §4.3/§8.2).
boxShadow: { xs:'none', sm:'none', md:'none', lg:'none', none:'none', focus:'0 0 0 2px var(--color-focus-ring)' },
fontFamily: {
  serif: ['var(--font-serif)', 'Georgia', 'Times New Roman', 'serif'],   // Zen Old Mincho (títulos)
  sans:  ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'], // Archivo (UI)
  mono:  ['var(--font-mono)', 'ui-monospace', 'Menlo', 'monospace'],     // JetBrains Mono (cifras/estados)
},
fontSize: { display:['2.5rem',{lineHeight:'1.1',fontWeight:'400'}], h1:['2rem',{lineHeight:'1.1',fontWeight:'400'}],
  h2:['1.5rem',{lineHeight:'1.2',fontWeight:'400'}], h3:['1.25rem',{lineHeight:'1.25',fontWeight:'400'}] },
```
- **No `darkMode: 'class'`** — tema único claro.
- **Sin radios ni sombras**: los tokens de radio/sombra están fijados a `0px`/`none`; la **única excepción**
  es `boxShadow.focus` (anillo de foco bermellón, §4.3/§8.2).
- Fuentes self-hospedadas por `next/font` en `[locale]/layout.tsx` (variables `--font-serif/-sans/-mono`).
- Números: clase utilitaria `.tabular` → `font-variant-numeric: tabular-nums` para precios/folios/KPIs.

### 11.3 Estructura de componentes sugerida (no normativa)
Componentes base en `frontend/src/components/ui/` (Button, Input, Select, Badge, Banner, Modal, Table,
Tabs, LocaleToggle, StatCard, PipelineStepper, **IneUploader** (único uploader, solo INE §7.10),
GradedCertChip (§7.2c), PriceTag, CardTile, AmountBreakdown, SafeShippingGuide). **No** hay `PhotoCompare`
ni uploaders de producto (v1.2). Cada uno consume solo tokens semánticos (nunca hex crudos) y expone sus
estados.
Recomendado documentarlos con ejemplos (Storybook opcional; lo decide frontend/devops).

### 11.4 Reglas de oro para no romper el sistema
1. Nunca hex crudo en componentes: solo tokens/utilidades mapeadas.
2. Todo control interactivo: `focus-visible` (anillo bermellón, no eliminable), `disabled`, y `loading` si
   toca red.
3. Estado = color **+ texto (versalitas, siempre visible)**. **El icono ya NO es requisito** (v1.3, §2.4/§7.4);
   el segundo canal obligatorio es la etiqueta en versalitas. Nunca solo color.
4. Todo dato de dinero: `tabular-nums` (mono), formateado (§9.3), y con contexto (sin IVA / con desglose).
5. Diseñar contenedores para el texto ES (más largo) y probar ambos idiomas.
6. Objetivos táctiles ≥ 44px en móvil y back-office.

---

## 12. Mapa flujo → pantalla (referencia rápida para frontend)

| Flujo (PROJECT) | Endpoints (CONTRATO) | Componentes clave |
|---|---|---|
| Home / hero (panel derecho) | con sesión `GET /vault/portfolio/history`; anónimo `GET /catalog/featured-set/value-history` | Con sesión **PortfolioGlance** + valor por set (§7.17); anónimo **FeaturedSetGlance** (gráfica pública del set destacado, §7.18) + 1–2 líneas de confianza + "Entrar" |
| Login / Registro | `POST /auth/login`,`/register`,`/google` | Inputs, Button primary, **GoogleSignInButton** (§6.7), divisor "o/or" |
| **Compra** (ex-Catálogo) | `GET /catalog/cards`, `/facets`, `/sets` | ListingCard (+ variante Sellado §7.1b), **ShopFilters** (§7.16), ConditionBadge NM, PriceTag, Pagination |
| Ficha de carta | `GET /catalog/cards/:id` | Imagen de catálogo (remota), Tabs (sin "Fotos"), ConditionBadge (NM §7.2b) / **GradedCertChip `PSA 10 · #…`** (§7.2c), PriceTag, CTA |
| Checkout | `POST /checkout/quote`,`/session` | AmountBreakdown (subtotal+fee+IVA), Stripe, Banner CFDI |
| Mi bóveda / portafolio | `GET /vault/holdings`, `/vault/portfolio/history` | CardTile compacto, badge titularidad, **PortfolioTrendChart** (§7.17), StatCard "valor portafolio" (+sparkline opcional), PriceTag pending |
| Retiro / envío | `POST /shipments/quote`,`/shipments` | Selección items settled, AmountBreakdown (envío+IVA), Address MX, PipelineStepper |
| Buylist cotizador | `POST /buylist/quote` | BuylistQuoter, Banner PAY_AFTER_RECEIPT, SafeShippingGuide, PriceTag |
| Buylist solicitud | `POST /buylist/requests` | KYC/CLABE inputs, **IneUploader** (único uploader, §7.10), topes (Banner límite) |
| Disputa | `POST /disputes` | Textarea descripción, **DisputeEvidenceContact** (correo `soporte@tcgvault.mx`, §7.11), PipelineStepper — **sin uploader** |
| Admin dashboard | `GET /admin/dashboard` | 8× StatCard (enmascarado por rol), cola de trabajo accionable |
| M1 Inventario | `/admin/inventory/*` | Alta **sin foto** (imagen de catálogo remota); para gradeada captura **`certNumber`**; folio, ubicación CAJA/FILA/SLOT, DataTable |
| M2 Precios/Catálogo | `/admin/pricing/*`, `/fx`, `/admin/catalog/sync`,`/backfill`,`/remote-sets` | Tabla precio pendiente, override manual, FX/colchón, rareza→categoría, sync/backfill de sets (super_admin) |
| M3 Órdenes | `/admin/orders/*` | DataTable, AmountBreakdown, refund destructivo (super_admin) |
| M4 Retiros | `/admin/shipments/*` | Cola, picking-list por ubicación, captura de guía, PipelineStepper |
| M5 Buylist | `/admin/buylist/*` | Pipeline, cherry-pick por item, convertir a inventario, pago SPEI (super_admin) |
| M6 Usuarios/KYC | `/admin/users/*` | Ficha 360° (Tabs), KYC, bloquear (destructivo) |
| M7 Finanzas | `/admin/finance/*` | StatCards financieros, tablas, export CSV (solo super_admin) |
| M8 Disputas | `/admin/disputes/*` | Descripción + `evidenceContact` (evidencia por correo), GradedCertChip para resolución, resolver recompra/rechazo — **sin comparador de fotos** |
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
9. **v1.2 — cobertura de shapes (sin cambios de contrato solicitados).** El diseño v1.2 se apoya en datos ya
   presentes: `ListingDTO.certNumber?` y el detalle de disputa con `evidenceContact` (`GET /admin/disputes/:id`)
   y `certNumber` para gradeadas. **No se requiere ampliar el contrato.** Dos solicitudes de confirmación al
   **product-owner/arquitecto** (no bloquean el diseño):
   - **(a) URL de verificación de certificado (PSA/CGC).** El §7.2c propone que el `certNumber` de la ficha
     sea un **enlace** a la página de verificación de la graduadora. Falta que el humano confirme la URL/patrón
     (p. ej. `psacard.com/cert/<n>`). **Mientras no se confirme, se muestra como texto copiable, no un enlace
     inventado.** No es campo de contrato (el front arma la URL con el `certNumber` existente).
   - **(b) Correo de soporte definitivo.** El flujo de disputa muestra **`soporte@tcgvault.mx`** como canal de
     evidencia; PROJECT.md y el contrato lo marcan **placeholder por confirmar por el humano**. El front debe
     tomar el valor de `evidenceContact` del contrato (no hardcodear) para que cambiarlo no toque UI.

---

## 14. Resumen de decisiones visuales (one-pager)

- **Origen:** codificado a partir del **rediseño 5a implementado en `frontend/`** (tokens reales de
  `globals.css`/`tailwind.config.ts`/`layout.tsx`); no hubo Claude Design formal.
- **Personalidad:** **editorial de papel** — coleccionismo serio + confianza financiera. **Papel** `#F4F1EA`
  (fondo y superficie), **tinta** `#1A1A18` (texto y acción primaria), **bermellón** `#B44B3A` (único acento
  + foco + atención), **verde** `#4E7A49` (éxito). Sin azul de banca, sin ámbar. **Tema único claro.**
- **Confianza como sistema:** titularidad `pending`(bermellón)/`settled`(verde), precio con fecha y fuente,
  "precio pendiente" explícito, banner persistente "pago tras recepción", guía de envío seguro con
  sleeve/top loader, gradeada = **empresa+grado+`certNumber`** verificable. **Estado = color + texto
  (versalitas)**; el icono ya no es requisito.
- **Tipografía:** **Zen Old Mincho** (serif, títulos, peso 400) / **Archivo** (sans, UI) / **JetBrains Mono**
  (mono, toda cifra/folio/estado/etiqueta, `tabular-nums`), self-hosted por `next/font`. Serif de imprenta =
  voz profesional, anti "look de IA" (§1.3).
- **Radios 0 y sombras 0 (decisión de estilo):** esquinas rectas, sin relieve; la profundidad la dan el aire
  y las **reglas** (líneas). **Excepción:** el **anillo de foco** bermellón (2px) sobrevive y es obligatorio.
- **Layout:** Tailwind breakpoints; catálogo grid 2→5; dashboard 8 KPIs en 4×2; back-office con sidebar de
  **tinta** M1–M10 (drawer en móvil); alta de inventario **sin cámara** (imagen de catálogo remota).
- **Bilingüe:** ES default + toggle EN (segmented control), enums y errorCodes traducidos por clave, datos
  de catálogo en inglés sin traducir, contenedores dimensionados para el texto ES (más largo).
- **Accesibilidad:** foco visible bermellón siempre (no eliminable), objetivos táctiles ≥ 44px, contraste AA
  verificado sobre el papel (§10), `aria-live` para procesos asíncronos, `prefers-reduced-motion`.
- **Tokens listos para implementar:** CSS variables (tema único claro) + mapeo Tailwind en §11; ya
  implementados en `frontend/` (este doc los codifica como fuente de verdad).
- **v1.1 (superficies nuevas):**
  - **Condición NM legible:** badge verde "Casi nueva (NM)" / "Near Mint (NM)" (texto sobre papel, sin caja)
    con descripción del estándar en tooltip/`title` + `aria-label`; sin LP/MP/HP/DMG (§7.2b).
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
- **v1.2 / v1.2.1 (simplificación):**
  - **Sin fotos de producto:** imagen SIEMPRE de catálogo de pokemontcg.io (remota); se eliminan
    captura/subida de fotos de producto y el CDN/prefijo `inventory_photo` (§5, §7.1, §7.10).
  - **Badge de calidad en retícula = `ListingSpec` (`Raw · NM · Acabado` en mono):** por defecto la calidad
    es un **renglón mono en versalitas** bajo la imagen (no pastillas), con el estándar legible en
    `aria-label`/`title` y la etiqueta "Casi nueva (NM)" en la ficha de detalle (§7.2b). Si algo se monta
    sobre el arte, usa **scrim de tinta `#1A1A18/92%` + texto papel** (~15:1, independiente del arte),
    **radio 0**. Nada translúcido sobre el arte.
  - **Gradeada = grado + certificado:** `GradedCertChip` **`PSA 10 · #12345678`** (empresa+grado+`certNumber`),
    verificable en la graduadora (§7.2c).
  - **Disputa por correo:** eliminado `PhotoCompare`; el flujo muestra el correo de soporte
    **`soporte@tcgvault.mx`** (placeholder) como canal de evidencia, sin uploader (§7.11).
  - **Único uploader = INE:** `IneUploader` para el INE del buylist (KYC/AML), bucket privado cifrado con
    retención; es la única subida de archivos del sistema (§7.10).
- **v1.3 (rediseño 5a — piel editorial "papel/tinta/bermellón"):**
  - **Paleta:** se retira índigo/ámbar/slate. Papel `#F4F1EA` (bg+surface), pozo `#EFEBE2`, tinta `#1A1A18`
    (texto+primario), muted `#6E695E`, bermellón `#B44B3A` (acento+foco+warning+danger), verde `#4E7A49`
    (success). `*-bg` de estados = `transparent` (§2).
  - **Tema único claro:** eliminado el modo oscuro completo (sin `.dark`, sin `ThemeToggle`, sin
    `darkMode:'class'`) — el papel es la marca (§0/§11/§14).
  - **Tipografía:** Zen Old Mincho (serif títulos) / Archivo (sans UI) / JetBrains Mono (mono cifras/estados),
    self-hosted por `next/font`; títulos peso 400 (§3).
  - **Radios 0 + sombras 0** como estilo; **anillo de foco bermellón 2px = excepción de accesibilidad** que
    sobrevive (§4.2/§4.3/§8.2).
  - **Regla de estado ratificada:** color + **texto en versalitas** (portador); **icono retirado como
    requisito** (§2.4/§7.4/§11.4). Cambio **aprobado por el humano**, accesibilidad preservada.
  - **`ListingSpec` (`Raw · NM · Acabado` en mono)** = representación por defecto en retícula; estándar en
    `aria-label`/`title`, etiqueta legible en la ficha. Decisión **ratificada** (§7.2b).
```
