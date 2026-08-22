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
>
> **Añadido v1.5 (guest checkout) → ver §15.** Comprar **sin cuenta**: bifurcación de identidad en el
> checkout, formulario de invitado, **upsell de bóveda in-situ** (panel inline, nunca un error),
> confirmación con **reclamo post-compra** y **vista pública de seguimiento por enlace tokenizado** con
> **estado neutro** de token inválido/expirado. **No introduce tokens nuevos** de color/tipografía ni
> cambia ninguna sección previa: §15 es aditiva y reutiliza los componentes existentes.
>
> **Añadido v1.6 (Stream B — Inventario M1 operable) → ver §16.** M1 reorganizado en pestañas
> **Master Set (default) · Sellado · Gradeadas** con «Piezas» demovida a **drill-down** (P-17), tarjetas de
> valor del inventario (P-24), **consola de tres precios** mercado/compra/venta en la teja de variante
> (P-18), **alta rápida** de dos caminos Compra/Aportación + «Publicar todo» (P-19), **distintivo visual de
> acabado** `FinishMark` (adelanto de P-14, lenguaje compartido con Stream C) y la teja/badge **Bounty**
> admin + vitrina pública «Top Bounties» (P-22). §16 es aditiva; introduce **un único elemento gráfico
> nuevo** (la banda de acabado, §16.6 — incluida la ÚNICA superficie con gradiente permitida del sistema) y
> **cero tokens nuevos** de color/tipografía.
>
> **Añadido v1.7 (P-21 — identidad TCG HUNT) → ver §17.** Rebrand de marca: el sitio pasa a llamarse
> **TCG HUNT** (dominio `tcghunt.mx`) con **logo de mira/crosshair** en degradado **rojo `#B31217` → vino
> `#4A0D0D`**, reconstruido en **SVG vectorial** a partir de la referencia de alta resolución del humano
> (§17.1: lockup completo, solo-mira, glifo micro y variante para fondo oscuro). Cambio de paleta: se
> **conserva la base editorial papel/tinta** y el **bermellón `#B44B3A` se retira**: el **rojo TCG HUNT
> `#B31217` asume todos sus roles** (accent, warning, danger, anillo de foco — mismo nombre de tokens,
> nuevo valor; contraste sobre papel **sube** de 4.65:1 a **6.2:1**, §17.2). El degradado del logo se suma
> como **segunda y última excepción de gradiente** (junto a la banda reverse §16.6): nunca en superficies
> ni botones. El badge BOUNTY (§16.7b) adopta el **glifo micro oficial de la mira** en lugar del
> `crosshair` de lucide. La marca visible cambia; **el nombre interno del repo/proyecto (`tcg-vault-mx`) y
> las rutas técnicas NO cambian** (§17.4). Wordmark en **Montserrat 700** (`--font-brand`, `next/font`).
>
> **Corrección v1.7.1 (fidelidad del logo — cotejo del humano contra el original) → §17.1 reescrita.**
> La reconstrucción v1.7 simplificaba de más: el original es una **retícula de mira de rifle (scope
> reticle)**, no una cruz corrida sobre círculos. Cambios: (1) la **cruz es SEGMENTADA** — cuatro líneas
> independientes que atraviesan los anillos por **huecos** y **nunca pisan nada**; todas terminan dentro
> del anillo interior dejando **espacio libre antes del punto central**; la horizontal **izquierda es la
> más larga** y la vertical **superior sobresale más que la inferior**. (2) Los **anillos se dibujan como
> 4 arcos** con **gap angular en los 4 cardinales** (~12° exterior, ~20° interior) por donde pasan las
> líneas. (3) El **punto central hueco queda aislado** — nada lo toca. (4) El **wordmark ahora es
> dominante**: casi tan ancho como las horizontales de la mira, con ".mx" alineado al borde derecho del
> wordmark. (5) El degradado del conjunto pasa a **diagonal** `#B31217` (arriba/izquierda) → `#4A0D0D`
> (abajo/derecha), con el wordmark en **vino casi plano** (rampa corta `#6E1013→#4A0D0D`). Las 4
> variantes (lockup, solo-mira, oscura, micro) se corrigen; el **glifo micro** conserva la cruz
> segmentada pero **omite los huecos de los anillos** (no leen a 16–20px, §17.1d). Se ajustan tamaños
> mínimos y reglas de uso derivadas (§17.3): solo-mira mínimo **28px** (antes 24px).
>
> **Añadido v1.8 (Stream C — Cotizador v2, P-14 + P-16) → ver §18.** El cotizador público (`/buylist`)
> se redistribuye para que las cartas se vean **grandes como en el binder de inventario**: el **carrito
> lateral fijo de 360px desaparece** y se convierte en **drawer flotante** (sheet lateral en desktop /
> bottom sheet en móvil) disparado por un **FAB con contador**; la grilla recupera todo el ancho y
> adopta **exactamente la densidad del binder M1** (2→3→4→5 columnas). El **distintivo de variante**
> (P-14) se replica en el cotizador **reutilizando el `FinishMark`/`FinishBand` de §16.6 tal cual**
> (mismo componente, mismos tokens): banda de 3px en la teja del cotizador y marca banda+etiqueta en
> cada línea del carrito y del resumen de envío. §18 es aditiva: **cero tokens nuevos**, cero elementos
> gráficos nuevos (la banda ya existía) y **sin cambio de contrato** (los datos ya existen).
>
> **Ratificación v1.8.1 (2026-08-21, QA Stream C) → §18.4a, §18.6, §18.10.** Dos desviaciones
> conscientes de la implementación se adoptan como spec: (1) **QA-C1** — el `aria-label` del FAB usa
> el formato **`{count} carta(s)`** en lugar del plural natural ICU («3 cartas»), por consistencia
> con la convención i18n del catálogo (sin ICU); exigir ICU habría implicado cambiar la convención
> del proyecto por una cadena solo-aria — desproporcionado. (2) **QA-C2** — los **skeletons con la
> retícula final** de §18.6 se generalizan a **todos los modos del binder** (quoter, inventario M1
> §16 y bóvedas): retícula compartida, un solo código de carga, y el skeleton honesto es mejor
> patrón que el spinner en cualquier modo. Sin cambios visuales nuevos ni tokens nuevos.
>
> **Corrección v1.8.2 (2026-08-21, cierre Stream C — TL-C1) → §4.5 nueva, §18.1.** Se formaliza la
> variable de layout **`--app-header-h`** (altura real del header sticky, expuesta por cada shell y
> consumida por componentes compartidos con elementos sticky, fallback `0px`), nacida en la ronda de
> corrección TL-C1 y hasta ahora documentada solo en FRONTEND_NOTES. Regla derivada: **no se
> hardcodean alturas de header en componentes compartidos.** Sin tokens visuales nuevos.
>
> **Añadido v1.9 (reorganización del panel M2 — catálogo/precios) → ver §19.** El panel de M2
> (`M2View.tsx`) acumulaba **9 acciones de import/precio** en pilas planas de botones `secondary`
> idénticos, sin jerarquía: el operador no distinguía lo que **siempre funciona** (TCGCSV, local) de
> lo que **depende de una fuente que se cae** (pokemontcg.io). §19 reorganiza esas acciones en tres
> grupos con jerarquía visible — **Datos (rápido · TCGCSV)** destacado arriba, **Catálogo (cartas
> nuevas · fuente de catálogo)** con aviso de dependencia, y **Avanzado** (colapsable, plegado) —,
> añade el mantenimiento one-shot **«Unificar rarezas»** anclado al editor de reglas por rareza,
> **retira** la acción legacy «Lanzar sync de precios (bóveda)» y el `rarity-map` muerto, y **reencuadra
> el selector de proveedor** para que refleje que **TCGCSV es el primario** y el dial elige solo el
> **respaldo**. §19 es **aditiva**: **cero tokens nuevos** (reusa reglas/aire de §4.3, botones de §6.1,
> patrones de §8, colapsable/`<details>` semántico), no cambia el contrato de datos y solo reordena,
> reetiqueta y agrupa acciones ya existentes. Una solicitud abierta al arquitecto (señal de salud de
> la fuente de catálogo) queda anotada como **no bloqueante** (§19.9).
>
> **Añadido v2.0 (makeover del storefront — dirección 1a «Conservadora», Claude Design) → ver §20.**
> Primera entrega formal de **Claude Design** codificada en este documento: el humano aprobó los
> artboards 1a (home 1280 + 390) y 2a–2e (Comprar, Vender, Ficha, Carrito, Mi bóveda) y §20 extrae de
> ellos los **patrones nuevos** del storefront: hero de home a **2 columnas** con panel **Cotizador**
> embebido, carrusel **«Piezas destacadas»** con numeración mono roja, banda **«Producto sellado»**
> sobre pozo con tejas horizontales, vitrina **«Cartas gradeadas»** 3:5 con chip de grado, los
> **distintivos de stock** («Queda 1» / «N en stock» / «Último») con regla money-safe, la tabla
> condicional de **bounties**, los **pasos numerados** con regla superior de tinta, la **banda oscura
> CTA de buylist** con etiqueta vertical, el **footer mono de una línea**, la navegación del header
> con **subrayado rojo 1px** en el link activo, un **paginador sobrio** para catálogo/pedidos y las
> jerarquías **móviles a 390px**. §20 es **aditiva y cero tokens nuevos**: todo se compone con la
> paleta §2/§17 (tinta `#1A1A18`, rojo TCG HUNT `#B31217`, verde vivo `#4A7345`), las reglas §4.3 y
> las tres familias §3. Refina una convención tipográfica (precios display en sans 500 `tabular-nums`,
> dinero operativo en mono — §20.14) sin tocar contrato ni flujos.

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

### 4.5 Variable de layout `--app-header-h` — contrato shell ↔ componentes compartidos (v1.8.2)

Los shells de la app tienen headers sticky de **altura variable** (padding responsivo, wrap del
menú, banner ocasional). Cualquier componente compartido que necesite un elemento sticky propio
debe anclarse **debajo del header real**, sin conocer al shell que lo hospeda. El mecanismo es una
única variable CSS, ya vigente desde la corrección TL-C1 del Stream C:

| | Regla |
|---|---|
| **Nombre** | `--app-header-h` (px). Es un **contrato de layout**, no un token visual: no se mapea en `tailwind.config`, se consume con arbitrary value. |
| **Quién la define** | **Cada shell/layout con header sticky**, y solo él. Hoy: `StorefrontHeader` mide su altura real (`ResizeObserver`) y la expone en su **padre inmediato** (el wrapper del layout del storefront), limpiándola al desmontar. Si el `AdminShell` (u otro shell futuro) necesita un sticky análogo debajo de su header, expone **esta misma variable con este mismo nombre** en su propio wrapper — no inventa otra. |
| **Quién la consume** | **Componentes compartidos con elementos sticky** que viven bajo un shell. Hoy: la barra de filtros del `MasterSetBinder` (modo quoter, §18.1) con `lg:top-[var(--app-header-h,0px)]`. |
| **Fallback** | **`0px` siempre** (`var(--app-header-h, 0px)`): en un shell sin header sticky —o que no la defina— el elemento se pega arriba y nada se rompe. |
| **Prohibición** | **NUNCA se hardcodea la altura de un header en un componente compartido** (nada de `top-[72px]` ni equivalentes): la altura real es responsiva y propiedad del shell. Un `top-0` en un sticky compartido bajo header también es un bug (queda tapado, TL-C1). |

> **Nota futura (no se diseña aquí):** el **scrim de overlays** (`rgba(26,26,24,.55)` de Modal y
> `SellCartDrawer`) hoy vive hardcodeado por componente; la deuda **SC-D1** (TECH_DEBT) propone
> unificarlo como token **`bg-scrim`** al consolidar el shell de diálogo. Es el compañero natural de
> este mismo viaje de unificación shell ↔ compartidos; cuando ese trabajo se agende, ux-ui definirá
> el token aquí (nombre a coordinar: `--color-scrim` → `bg-scrim`).

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

---

## 15. Guest checkout — comprar sin cuenta (v1.5)

> **Alcance:** patrones de UX/UI de la feature **guest checkout** (`PROJECT.md` §J, §J.1, criterios
> **45–56b**). Sección **aditiva**: no modifica ninguna decisión previa, **no introduce tokens nuevos** de
> color/tipografía/espaciado y reutiliza los componentes ya existentes. Todo lo que aquí se define se pinta
> con la paleta papel/tinta/bermellón (§2), la tipografía de §3, radios 0 / sombras 0 (§4) y el anillo de
> foco bermellón (§8.2).
>
> **Decisiones de producto cerradas que este diseño acata (no se re-litigan):** (1) el invitado **solo**
> tiene envío directo nacional — la **bóveda exige cuenta** y al elegirla se muestra **upsell, nunca un
> error**; (2) **correo obligatorio y confirmado**, seguimiento por **enlace tokenizado**; (3) al terminar
> se ofrece **crear cuenta con el mismo correo** (reclamo post-compra).
>
> **Dos superficies de seguridad en esta sección.** La **vista pública de seguimiento** (§15.6) y el
> **estado neutro de token** (§15.7) son *puertas sin contraseña*: su copy y su lista de datos visibles son
> **normativos**. El frontend no los "mejora" ni los adapta; cualquier cambio pasa por **ux-ui + seguridad**.

### 15.1 Principios propios de esta feature

1. **Ninguna de las tres vías es un callejón sin salida** (criterio 46). Invitado, iniciar sesión y crear
   cuenta conviven en la **misma ruta** y se puede ir y volver entre ellas sin perder nada.
2. **El registro es premio, no peaje.** Se ofrece donde tiene valor (al elegir bóveda y al confirmar la
   compra), nunca como requisito para pagar y nunca con culpa. **Prohibido el confirmshaming**: no existe
   copy tipo "No, prefiero pagar envío siempre" ni "No quiero cuidar mis cartas". El botón de salida del
   upsell siempre está redactado en **positivo** ("Seguir con envío a domicilio").
3. **Datos mínimos por defecto.** Todo lo que se muestre en una página accesible sin sesión debe justificar
   su presencia. Ante la duda, **se omite** (`PROJECT.md` §J dice "a lo mucho…", así que mostrar **menos**
   siempre cumple).
4. **Mismo trato comercial.** El invitado ve el **mismo desglose** y los **mismos avisos** que un usuario con
   cuenta (criterio 48b). No hay precio de invitado, ni aviso rebajado, ni políticas distintas.
5. **Un solo canal.** El correo del invitado es su único acceso al pedido; el diseño lo trata con la
   gravedad de una contraseña: se lee de vuelta y se confirma antes de pagar (§15.3).

### 15.2 Bifurcación de identidad (`CheckoutIdentityGate`) — criterio 46

**Ubicación y forma: bloque inline en la parte superior de la columna izquierda del checkout**, sobre los
renglones del carrito, **en la misma ruta `/checkout`** (no es modal, no es intersticial, no es otra ruta).

*Por qué inline y no modal ni ruta aparte:* (a) el `AmountBreakdown` y los artículos siguen visibles a la
derecha (el motivo de la compra nunca desaparece); (b) al no cambiar de ruta, el estado del carrito no se
desmonta y el criterio 46 se cumple **por construcción**, no por una salvaguarda; (c) el botón "atrás" del
navegador no expulsa al usuario del checkout.

Anatomía (todo separado por **reglas**, sin cajas de color, §2.1):
- `eyebrow` mono: `IDENTIDAD` / `IDENTITY`.
- `h2` serif: "¿Cómo quieres continuar?" / "How do you want to continue?".
- **Tres opciones apiladas**, cada una: botón de ancho completo, alto `lg` (48px) + una línea de apoyo
  `text-sm muted` debajo, separadas por regla de 1px. En `lg+` pueden ir en 3 columnas iguales; en móvil
  siempre apiladas.
- Línea de cierre, mono `text-[11px] muted`, **siempre visible**: "Tu carrito se conserva en cualquiera de
  las tres." / "Your cart is kept in all three."

**Jerarquía visual — igual dignidad, una sola acción por defecto:**

| Vía | Variante de botón | Tamaño / área táctil | Apoyo |
|---|---|---|---|
| **Continuar como invitado** | `primary` (tinta, relleno) | `lg`, ancho completo | "Solo necesitas tu correo y tu dirección." |
| **Iniciar sesión** | `secondary` (borde, papel) | `lg`, ancho completo | "Tus direcciones y tu bóveda te esperan." |
| **Crear cuenta** | `secondary` (borde, papel) | `lg`, ancho completo | "Guarda tus cartas en la bóveda y paga un solo envío." |

**Justificación de la jerarquía (decisión de diseño):** "continuar como invitado" es la **acción primaria**
porque es la vía de **menor compromiso** y el objetivo declarado de la feature es quitar el peaje antes de
pagar; poner el registro primero reintroduce exactamente la fricción que se quiere eliminar. **La igualdad
de dignidad se garantiza por geometría, no por color:** las tres opciones comparten **mismo alto, mismo
ancho, misma escala tipográfica, mismo peso de label y misma área táctil**; la única diferencia es
**relleno vs. borde**, que es el vocabulario normal de "primaria/secundaria" del sistema (§6.1). Ninguna de
las tres es un enlace pequeño, texto gris ni está debajo del pliegue. El **gancho de la bóveda** se enuncia
una vez, en la línea de apoyo de "crear cuenta", sin repetirse ni presionar.

**Comportamiento (reglas normativas para frontend):**
- Elegir una vía **expande su panel debajo** (patrón *disclosure*: `aria-expanded` + `aria-controls`); el
  gate se colapsa a un renglón con la vía elegida y un botón **"Cambiar" / "Change"** siempre disponible.
- **Iniciar sesión y crear cuenta se renderizan inline** (reusando `AuthForm` y `GoogleSignInButton` §6.7),
  **no navegan** a `/login` ni `/register`. Si por alguna razón técnica hubiera navegación, debe llevar
  `returnTo=/checkout` y **jamás** limpiar el carrito.
- **Ningún cambio de vía borra datos:** el correo y la dirección ya capturados como invitado siguen en el
  estado del checkout aunque el usuario vaya a "iniciar sesión" y vuelva. Regla: el estado del formulario de
  invitado vive por encima del gate, no dentro del panel.
- Tras iniciar sesión/registrarse, el gate desaparece y el checkout pasa al flujo con cuenta **sin recargar
  la ruta**; el carrito y el desglose se re-cotizan, no se reinician.
- **El invitado nunca ve `EmailNotVerifiedNotice`** (§ checkout actual): esa notificación es de usuarios con
  sesión. **No hay verificación de correo previa al pago** (criterio 45).

**Accesibilidad:** el gate es `<section aria-labelledby>` con su `h2`; las tres opciones son `<button>`
reales; al expandir un panel, el foco se mueve al **encabezado del panel** (`tabIndex={-1}`), no al primer
campo, para que el lector anuncie el contexto; "Cambiar" devuelve el foco al botón de la vía elegida.

### 15.3 Formulario de invitado (`GuestCheckoutForm`) — criterios 47, 48b

Composición de componentes existentes (`Input` §6.2, `Select` §6.3, `Banner` §7.5); **no es un componente
base nuevo**. Dos grupos separados por regla, con `eyebrow` mono cada uno.

**Grupo 1 — `CONTACTO` / `CONTACT` (el campo más importante de la feature)**
- Un solo campo: **Correo electrónico** — `type="email"`, `inputmode="email"`,
  `autocomplete="email"`, `spellcheck=false`, label visible (nunca solo placeholder), 16px mínimo en móvil.
- Ayuda debajo (`text-xs muted`, siempre presente, no solo en error): "Es el único canal de tu pedido: ahí
  te llegan la confirmación y el enlace de seguimiento." / "It's the only channel for your order: your
  confirmation and tracking link go there."
- **Validación de formato**: en `blur` y al intentar pagar. Error inline en bermellón con `aria-invalid`,
  `aria-describedby`, y el campo recibe foco desde el resumen de errores. **Correo vacío o inválido bloquea
  el pago** (criterio 47).
- **Sugerencia de erratas (no bloqueante):** ante dominios típicos mal escritos (`gmial.com`, `hotmial.com`,
  `outlok.com`), nota `text-xs` con acción: "¿Quisiste decir **{sugerencia}**?" + botón `link` "Sí,
  corregir". Es una sugerencia, **nunca** rechaza el correo.
- **Confirmación de que el correo es correcto (requisito de PROJECT §J):** se resuelve con **lectura de
  vuelta + casilla obligatoria**, no con un segundo campo.
  - Justo encima del botón de pago: `Checkbox` (§6.4) **no pre-marcada** con el correo **completo en mono**:
    "Confirmo que **{email}** es correcto. Es el único canal para dar seguimiento a mi pedido." /
    "I confirm that **{email}** is correct. It's the only way to track my order."
  - Mientras no esté marcada, el botón de pago está **deshabilitado con explicación textual** (§15.9).
  - Si el usuario **edita el correo**, la casilla se **desmarca automáticamente** y se anuncia con
    `aria-live="polite"`.
  - **Rechazado a propósito: un segundo campo "confirma tu correo".** Se copia/pega en el 95% de los casos
    (no detecta nada), duplica la fricción justo antes de pagar y no muestra el dato para revisarlo. La
    lectura de vuelta sí obliga a **leer** la cadena exacta que recibirá el correo.
- **Prohibido:** consultar al backend si ese correo tiene cuenta, cambiar el estilo del campo, mostrar
  avatar/"bienvenido de nuevo" o cualquier pista de existencia (**criterio 56 — no enumeración**). El campo
  se comporta idéntico exista o no la cuenta.

**Grupo 2 — `ENVÍO` / `SHIPPING` (dirección nacional)**
- Mismos campos y validaciones que el formulario de dirección ya existente (línea 1, línea 2 opcional,
  colonia, ciudad, estado, CP, teléfono opcional), en su versión **anónima**: sin "guardar dirección", sin
  alias, sin "predeterminada" (no hay cuenta donde guardar).
- **País fijo México**, mostrado como texto no editable con `eyebrow` "PAÍS" (mismo tratamiento que hoy).
  Una dirección fuera de MX se rechaza con el `Banner danger` de `error.ADDRESS_NOT_MX` (criterio 31/48b).
- CP: `inputmode="numeric"`, `maxlength` 5, `tabular-nums`.
- Teléfono: **opcional**, con ayuda "Solo lo usa la paquetería para entregar." Regla dura: **el teléfono
  nunca aparece en la vista pública de seguimiento** (§15.6).
- **Destino de la compra** (`FulfillmentChoice`): ver §15.4. Va **después** del envío, porque el upsell
  necesita que el usuario ya haya invertido esfuerzo (efecto dotación) y porque tras crear cuenta la
  dirección capturada no se pierde.

**Resumen de errores al intentar pagar:** si hay campos inválidos, se pinta arriba del formulario un bloque
`role="alert"` con "Revisa {n} campo(s)" y una lista de enlaces al campo correspondiente; el foco va al
bloque. Esto sustituye a hacer scroll a ciegas.

**Desglose y avisos (idénticos al checkout con cuenta, criterio 48b):** `AmountBreakdown` (§7.12) con
**subtotal sin IVA · costo de procesamiento · IVA 16% · envío (MX$175, del dial, nunca hardcodeado) ·
total**, más las tres notas al margen ya existentes (ventas finales con enlace a términos, factura CFDI por
correo, "qué pasa después del pago"). No se añade ni se quita ninguna.

**Móvil:** el resumen del `aside` colapsa a una **barra inferior sticky** con total + botón de pago
(`accent`, alto 48px, área táctil ≥44px), y un botón "Ver desglose" que despliega el `AmountBreakdown`
completo. El total nunca aparece sin acceso a su desglose (§7.12).

### 15.4 Selector de destino y **upsell de bóveda in-situ** (`VaultUpsellPanel`) — criterio 48

Este es **el momento de conversión más importante del producto**; el diseño lo trata como una oferta, no
como un permiso denegado.

**Selector de destino (`FulfillmentChoice`)** — grupo de radios (§6.4) con dos opciones, visible para
invitados y para usuarios con cuenta por igual:

| Opción | Micro-etiqueta mono | Estado para invitado |
|---|---|---|
| **Envío a mi domicilio** / Home delivery | `+ MX$175` | seleccionada por defecto |
| **Guardar en mi bóveda** / Keep in my vault | `REQUIERE CUENTA` / `REQUIRES ACCOUNT` | **seleccionable** (no deshabilitada, no oculta, sin candado rojo) |

La micro-etiqueta "REQUIERE CUENTA" en mono muted es **honestidad previa, no una barrera**: evita la
sorpresa sin impedir el clic. **Prohibido**: `disabled`, `aria-disabled`, candado bermellón, tooltip de
error, `Banner danger` o cualquier tratamiento que lea como "no puedes".

**Formato del upsell: panel inline que se expande justo debajo de la opción elegida.** No es modal, no es
un paso nuevo, no es una ruta.

*Justificación (decisión de diseño explícita):*
- **Modal (descartado):** tapa el carrito y el total —justo la evidencia de valor que motiva registrarse—,
  atrapa el foco, obliga a una decisión de "cerrar" que se lee como rechazar el producto, y en móvil ocupa
  la pantalla completa como si fuera una alerta. Un modal comunica *interrupción*; aquí no hubo error.
- **Paso separado (descartado):** viola literalmente "crear cuenta **sin salir del checkout**" (criterio 48)
  e introduce la transición donde más riesgo hay de perder carrito y datos capturados.
- **Panel inline (elegido):** mantiene visibles artículos, total y la dirección ya escrita; la salida
  ("Seguir con envío a domicilio") queda a un clic y en el mismo bloque; el registro ocurre a 200px de donde
  el usuario ya estaba mirando; en móvil se comporta como un bloque más del flujo, sin capa encima.

**Anatomía del panel** (papel sobre pozo `surface-2` + regla superior de énfasis `border-strong`; **sin
sombra, radio 0**):
1. `eyebrow` mono `BÓVEDA` / `VAULT`.
2. `h3` serif: "Guarda tus cartas en la bóveda" / "Keep your cards in the vault".
3. **Tres beneficios**, uno por renglón, separados por regla fina, cada uno en una sola línea
   (`text-sm`, cifra en mono):
   - "Acumula cartas y paga **un solo envío** — te ahorras **MX$175** cada vez que no envías." *(la cifra
     sale del dial de envío de la cotización; si no está disponible, se omite el paréntesis, nunca se
     inventa)*
   - "Ve el **valor de tu colección** actualizado a diario."
   - "Custodia con **autenticidad y condición garantizadas**."
4. **Formulario de registro inline** (reusa `AuthForm` en modo compacto):
   - **Correo prellenado** con el que ya capturó (editable; si lo edita, la casilla de confirmación de
     §15.3 se desmarca).
   - Contraseña + `GoogleSignInButton` (§6.7) con el divisor "o / or". **No se pide nada más**: ni nombre,
     ni dirección de nuevo, ni teléfono.
   - Botón principal: **"Crear cuenta y guardar en bóveda"** / "Create account and keep in vault" —
     variante **`primary` (tinta)**, ancho completo. *No usa `accent`* a propósito: el bermellón ya está
     asignado al botón de pago de esta pantalla y dos acentos compitiendo diluyen ambos (§2.1, "acento con
     avaricia").
5. **Salidas, siempre visibles sin scroll dentro del panel:**
   - `link`/ghost: **"Seguir con envío a domicilio"** / "Continue with home delivery" → colapsa el panel y
     vuelve a seleccionar envío. Redacción en positivo, sin culpa.
   - `link`: **"Ya tengo cuenta"** / "I already have an account" → intercambia el formulario por el de
     login **dentro del mismo panel** (carrito y dirección intactos).

**Estados del panel:**
- *Abierto sin cuenta creada:* el destino queda en "bóveda (pendiente)". El **botón de pago se deshabilita**
  con nota textual asociada por `aria-describedby` (no solo `disabled`): "Para pagar, crea tu cuenta o elige
  envío a domicilio." / "To pay, create your account or choose home delivery." Tono **muted, no bermellón**:
  es una condición, no un error.
- *Enviando:* solo el botón del panel entra en `loading` (label persistente, §6.1); los datos ya capturados
  no se tocan y ningún otro control se bloquea.
- *Éxito:* el panel colapsa a un renglón mono en **verde**: `CUENTA CREADA · DESTINO: BÓVEDA` /
  `ACCOUNT CREATED · DESTINATION: VAULT`, anunciado con `aria-live="polite"`. El desglose **se re-cotiza**:
  la línea de envío desaparece y el total baja; se anuncia con una nota `text-xs muted` junto al desglose:
  "El envío ya no aplica: tus cartas quedan en la bóveda." El flujo **continúa donde estaba** (no vuelve
  arriba, no recarga).
- *Error de red:* mensaje inline en el panel + "Reintentar"; nunca se pierde el estado del checkout.
- *Correo ya registrado:* mensaje **neutro y accionable, sin afirmar existencia**: "No se pudo crear la
  cuenta con ese correo. Puedes **iniciar sesión** o **seguir como invitado**." / "We couldn't create an
  account with that email. You can **log in** or **continue as a guest**." Ambas salidas se ofrecen juntas
  para no convertir el mensaje en un oráculo (criterio 56).

**Accesibilidad del panel:** `role="region"` etiquetado por su `h3`; al abrirse el foco va al `h3`
(`tabIndex={-1}`) para que se lea el beneficio antes que los campos; `Esc` **no** descarta datos: devuelve
el foco al radio de destino sin cambiar la selección (la salida explícita es el botón "Seguir con envío a
domicilio"). Área táctil de radios y salidas ≥ 44px.

### 15.5 Confirmación de compra y reclamo post-compra (`GuestOrderConfirmation` + `AccountClaimOffer`) — criterios 49, 54, 55

Página editorial de una columna (`max-w-2xl`), en la línea de la pantalla "procesando" que ya existe.

**Bloque 1 — el pedido**
- `eyebrow` mono `PEDIDO CONFIRMADO` / `ORDER CONFIRMED`.
- `h1` serif: "Gracias por tu compra" / "Thank you for your order".
- **Número de pedido** en mono `text-h2` con botón **"Copiar"** (`ghost`, con `aria-live` de confirmación).
  Es la referencia que el invitado necesita para soporte y para una disputa (criterio 56b), así que se
  presenta como el dato dominante.
- Línea: "Te enviamos la confirmación y el **enlace de seguimiento** a **{correo completo}**." /
  "We sent your confirmation and **tracking link** to **{full email}**."
  > **Asimetría deliberada:** aquí se muestra el **correo completo**; en la vista pública de seguimiento
  > (§15.6) **no se muestra en absoluto**. Motivo: esta pantalla la ve **solo** quien acaba de pagar, en su
  > propio dispositivo, y es la **última oportunidad de detectar una errata** antes de depender del correo;
  > la de seguimiento vive detrás de una URL compartible y no debe filtrar identidad.
- Debajo, `text-xs muted`: "¿No es tu correo? Escríbenos a **{evidenceContact}** citando tu número de
  pedido." (`mailto:`, valor del contrato, nunca hardcodeado — §7.11).

**Bloque 2 — reclamo post-compra (`AccountClaimOffer`)**, separado por regla de énfasis:
- `eyebrow` mono `CREA TU CUENTA` / `CREATE YOUR ACCOUNT`.
- `h2` serif: "Guarda este pedido en tu cuenta" / "Save this order to your account".
- Cuerpo: "Crea tu cuenta con **{correo}** y este pedido aparecerá en tu historial con su estado y su
  seguimiento. En tus próximas compras podrás guardar cartas en la **bóveda**." / equivalente EN.
- Formulario mínimo: correo **prellenado y visible**, contraseña, o `GoogleSignInButton`. Botón `primary`
  ancho completo: **"Crear cuenta con este correo"** / "Create account with this email".
- Éxito → mensaje verde en versalitas `PEDIDO EN TU HISTORIAL` + enlace "Ver mis pedidos".
- **Segundo reclamo (criterio 55):** si el pedido ya está vinculado, mensaje **neutro** sin decir a quién:
  "No fue posible vincular este pedido." / "We couldn't link this order." + línea de soporte con el número
  de pedido. Nunca "ya pertenece a otra cuenta" (revela que existe otra cuenta con ese correo).
- **Correo ya registrado:** misma pauta neutra de §15.4 ("No se pudo crear la cuenta con ese correo. Si ya
  tienes una, inicia sesión para reclamar el pedido desde tu historial.").

**Bloque 3 — salidas**: `secondary` "Seguir comprando" → **Compra**. **No** se muestran enlaces a "Mis
órdenes" ni "Mi bóveda" (llevarían a un muro de sesión y leerían como error). Se repite en una línea el
recordatorio de factura CFDI citando el número de pedido y el enlace a términos.

**Regla de seguridad de esta pantalla:** la confirmación **no debe ser una URL adivinable que renderice el
pedido**. Se pinta desde el estado de la transacción recién completada; si necesita URL propia, debe usar
el **mismo token** que el seguimiento. Anotado como solicitud al arquitecto (§15.11).

### 15.6 Vista pública de seguimiento (`PublicOrderTracking`) — criterios 50, 51, 52 · **CRÍTICO**

> **Es una puerta sin contraseña: quien tenga el enlace, ve la página.** La regla rectora es
> **minimización**: la pantalla muestra lo estrictamente necesario para que el comprador sepa dónde está su
> pedido, y **nada** que sirva para suplantarlo, ubicarlo o contactarlo.

**Chrome reducido (obligatorio).** Cabecera con **logo + `LocaleToggle`** y nada más: sin buscador, sin
carrito, sin "Mi cuenta", sin nav a Bóveda/Buylist/Mis órdenes. Pie con enlace a términos y correo de
soporte. Motivo: la página no implica sesión y no debe ofrecer superficies que sugieran una.
La ruta se marca **`noindex, nofollow`** y con **`Referrer-Policy: no-referrer`** para que el token no viaje
en el `Referer` hacia terceros (requisito de diseño con implicación técnica; ver §15.11).

**Contenido visible — lista cerrada, en este orden:**

| # | Elemento | Detalle de presentación |
|---|---|---|
| 1 | **Número de pedido** | `eyebrow` `PEDIDO` + número en mono `text-h2` + botón "Copiar". Único identificador en pantalla. |
| 2 | **Estado** | `PipelineStepper` (§7.9): `pagado → preparando → guía → enviado → entregado`. Horizontal en `lg+`, vertical en móvil. Paso completado = verde + label en versalitas; actual = tinta + anillo + `aria-current="step"`; pendiente = muted. Fecha localizada bajo cada paso cumplido (§9.3). |
| 3 | **Guía** | Solo cuando existe: paquetería + número en mono + "Copiar". Si la URL de rastreo del carrier no está confirmada, **se muestra como texto copiable, no como enlace inventado** (misma regla que §7.2c). Sin guía todavía → el paso "guía" dice `PENDIENTE` en muted, no una caja vacía. |
| 4 | **Artículos** | Lista con imagen de catálogo (`CardImage`), nombre EN (`lang="en"`), set · número, `ListingSpec` y precio unitario. **Sin folio de inventario** (`INV-…`, dato interno). |
| 5 | **Total pagado** | `AmountBreakdown` en modo **solo lectura**: subtotal, procesamiento, IVA, envío, total. Es la misma información que ya recibió por correo. |
| 6 | **Pago** | **Una sola línea mono**: `TARJETA ···· 4242` / `CARD ···· 4242`. Nada más: sin titular, sin banco, sin fecha de expiración, sin `paymentIntent`. |
| 7 | **Envío (mínimo)** | **Ciudad y estado únicamente**: "Envío a Guadalajara, Jalisco". **Sin calle, sin número, sin colonia, sin CP, sin nombre del destinatario.** |
| 8 | **Frescura** | `text-xs muted` "Actualizado {hora}" + botón `ghost` "Actualizar" (refetch, acción de solo lectura). |

> **Nota sobre el CP.** `PROJECT.md` §J permite "**a lo mucho** ciudad/estado y los últimos dígitos del CP".
> El diseño elige el extremo conservador: **no mostrar CP**. Para el destinatario es información redundante
> (ya conoce su dirección) y en una página sin contraseña añade identificabilidad sin aportar valor. Si el
> product-owner prefiere mostrarlo, el máximo autorizado es **CP parcial enmascarado** (`CP ···45`); no se
> implementa hasta que lo pida explícitamente.

**Acciones permitidas — exactamente tres, todas no mutantes del pedido:**
1. **Copiar número de pedido.**
2. **"Reenviar el enlace a mi correo"** → abre el formulario neutro de §15.7 (misma respuesta neutra y mismo
   límite de frecuencia, aunque el token actual sea válido).
3. **"¿Un problema con tu pedido?"** → línea con `DisputeEvidenceContact` (§7.11): correo de soporte
   (`evidenceContact` del contrato) + instrucción de **citar el número de pedido**. Cubre la disputa de
   condición y el error de plataforma del invitado (criterio 56b) **sin** dar a la página ninguna acción que
   modifique nada.
4. *(Enlace secundario)* **"Crear cuenta y guardar este pedido"** → lleva a registro con la nota "Usa el
   mismo correo donde recibiste este enlace". **No prellena ni muestra el correo** (la página no lo conoce
   en pantalla). Cubre el reclamo aunque el enlace haya caducado.

**Prohibiciones explícitas (normativas — QA y seguridad las verifican como lista):** en esta vista **NO**
existen ni deben implementarse: dirección completa · nombre del destinatario · correo (ni completo ni
enmascarado) · teléfono · datos de pago más allá de la terminación · cancelar · cambiar dirección ·
solicitar reembolso · editar artículos · descargar factura · "ver mis otros pedidos" · buscador de pedidos ·
enlaces a otros pedidos · IDs internos (inventario, `orderId` crudo, `userId`) · cualquier formulario que
escriba en el pedido.

**Estados de la vista:** *loading* → skeleton que respeta el layout (stepper + filas de artículos); *error
de red* → `QueryState` con "Reintentar" (mensaje genérico, **sin** eco del `errorCode`); *token
inválido/expirado* → §15.7; *pedido reembolsado/contracargo* → el estado muestra la versalita
correspondiente y una línea "Consulta con soporte citando tu número de pedido", **sin** detalles del
proceso.

**Mapa de presentación del estado público** (reusa tokens de §2.4; el color es redundante, el portador es el
texto en versalitas):

| Estado | Versalitas ES / EN | Token de color |
|---|---|---|
| `pagado` | `PAGADO` / `PAID` | success (verde) |
| `preparando` | `PREPARANDO` / `PREPARING` | accent (bermellón) |
| `guia` | `GUÍA GENERADA` / `LABEL CREATED` | info (muted) |
| `enviado` | `ENVIADO` / `SHIPPED` | primary (tinta) |
| `entregado` | `ENTREGADO` / `DELIVERED` | success (verde) |
| `reembolsado` | `REEMBOLSADO` / `REFUNDED` | info (muted) |
| `cancelado` | `CANCELADO` / `CANCELLED` | neutral (muted) |

### 15.7 Token expirado o inválido (`TrackingLinkNeutralState`) — criterios 52, 53 · **superficie de seguridad**

**Regla número uno: una sola pantalla para todos los fallos.** Token expirado, token manipulado, token
inventado, token de otro pedido, pedido inexistente, pedido borrado → **exactamente el mismo componente,
el mismo texto, el mismo layout**. El frontend **no** ramifica por código de estado (401/403/404/410) ni
imprime el `errorCode`. Cualquier diferencia visible entre casos convierte la pantalla en un oráculo.

**Dos vías de reenvío — corrección arbitrada por el arquitecto (contrato §4-G.4 manda sobre el diseño).**
La versión inicial de §15.7 pedía **solo el correo**; queda **corregida**: el reenvío acepta **`{token}`**
**o** **`{correo + número de pedido}` juntos**, nunca el correo por sí solo.

> **Por qué (razón de seguridad, no de implementación):** un formulario de un único campo de correo es
> exactamente el **oráculo de enumeración que prohíbe el criterio 53** ("¿este correo compró aquí?") — el
> atacante no necesita leer la respuesta, le basta con que llegue (o no) un correo. Además convierte a la
> plataforma en un **emisor de correo hacia terceros**: escribiendo la dirección de otra persona se le
> provoca un envío. Exigir el **número de pedido** ata la petición a algo que solo tiene quien compró.
> **La neutralidad del copy no se relaja en absoluto:** la respuesta sigue siendo idéntica coincidan o no
> los datos, y el `429` sigue mostrando el mismo mensaje. Lo único que cambia es **qué campos se piden**.

| Vía | Cuándo | Qué pide la UI |
|---|---|---|
| **A — con token** | La URL trae un token (vigente, vencido o manipulado: la UI no lo sabe ni lo distingue) | **Ningún campo.** Un botón directo "Enviarme un enlace nuevo"; el token identifica el pedido. Es también la vía de la acción "Reenviar el enlace a mi correo" de §15.6. |
| **B — sin token** | No hay token, o el usuario pulsa **"No tengo el enlace"** | **Los dos campos juntos**: correo **y** número de pedido. Ninguno por separado habilita el envío. |

La vía B se revela con un *disclosure* ("No tengo el enlace", `aria-expanded`/`aria-controls`), no está
abierta por defecto: el caso común es llegar con un enlace caducado y bastar con el botón.

**Copy normativo (no editable sin ux-ui + seguridad):**

| Elemento | Español | English |
|---|---|---|
| Título (`h1` serif) | **Este enlace ya no funciona** | **This link no longer works** |
| Cuerpo | Por seguridad, los enlaces de seguimiento caducan. Podemos enviarte uno nuevo al correo con el que hiciste la compra. | For security, tracking links expire. We can send you a new one to the email you used for the purchase. |
| Botón (vía A y vía B) | Enviarme un enlace nuevo | Email me a new link |
| Disclosure a la vía B | No tengo el enlace | I don't have the link |
| Intro de la vía B | Escribe el correo con el que compraste y el número de pedido de tu confirmación. | Enter the email you used at checkout and the order number from your confirmation. |
| Label del campo correo | Correo con el que compraste | Email you used at checkout |
| Label del campo pedido | Número de pedido | Order number |
| Ayuda del campo pedido | Viene en tu correo de confirmación (por ejemplo, TCG-000123). | It's in your confirmation email (for example, TCG-000123). |
| Validación local (faltan datos) | Escribe el correo y el número de pedido para continuar. | Enter both the email and the order number to continue. |
| Respuesta (**siempre la misma**) | Si esos datos corresponden a un pedido, enviamos un enlace nuevo a ese correo. Revisa tu bandeja de entrada y la carpeta de spam. | If those details match an order, we've sent a new link to that email. Check your inbox and your spam folder. |
| Espera | Puedes volver a intentarlo en {seconds} s. | You can try again in {seconds}s. |
| Alternativa | ¿Prefieres tenerlo siempre a la mano? Crea tu cuenta con ese mismo correo y tu pedido aparecerá en tu historial. | Want it always at hand? Create an account with that same email and your order will appear in your history. |
| Soporte | ¿Necesitas ayuda? Escríbenos a {evidenceContact}. | Need help? Write to us at {evidenceContact}. |

Nota de redacción: el cuerpo y la respuesta están en **condicional** ("si esos datos corresponden a un
pedido") y **nunca en primera persona afirmativa** ("te enviamos tu enlace"), de modo que el texto no
confirma ni niega la existencia del pedido, del correo ni de la relación entre ambos. La vía A usa **la
misma** frase de respuesta que la vía B.

**Frases prohibidas** (ni en pantalla, ni en `alt`, ni en `title`, ni en consola): "pedido no encontrado",
"ese pedido no existe", "el correo no está registrado", "ese número de pedido no existe", "el correo y el
número de pedido no coinciden", "el número de pedido es incorrecto", "token inválido", "la firma no
coincide", "expiró hace N días", "ya te enviamos un enlace", "demasiados intentos **para ese correo**",
"no hay pedidos con ese correo". Tampoco se enuncia **la vigencia en días** del enlace: el copy es
**agnóstico al TTL** para no depender de la pregunta abierta de PROJECT v1.5 ni dar información de
temporización (sigue siendo válido tras acotar el token de checkout a 120 min y mantener el de seguimiento
en 90 días: ningún texto menciona plazos).

**Comportamiento del reenvío (normativo):**
- **Nunca se pide el correo solo.** Cualquier variante de un formulario de un único campo de correo está
  prohibida en esta pantalla y en cualquier otra superficie pública.
- El resultado se pinta **siempre igual**: mismo texto, mismo tratamiento visual **neutro** (tinta/muted,
  `Banner info`), **para la vía A y para la vía B por igual**. **Nunca verde de éxito** ni bermellón de
  error: el verde leería como "sí, existe".
- **Datos que no coinciden** (correo correcto + pedido ajeno, pedido inexistente, token manipulado) producen
  **exactamente la misma pantalla** que unos datos válidos: mismo mensaje, mismo enfriamiento, misma
  ausencia de detalle. La UI no distingue el motivo ni lo puede distinguir.
- El formulario se sustituye por el mensaje y el botón queda en **enfriamiento visible** con cuenta regresiva
  en mono. La cuenta regresiva es **idéntica** en todos los casos.
- **`429` (límite de frecuencia) muestra exactamente el mismo mensaje** que un envío correcto, solo con un
  enfriamiento mayor. Un mensaje distinto por rate-limit filtra que ese correo es "interesante".
- El botón entra en `loading` con **un mínimo de latencia visible constante** (skeleton/spinner con duración
  mínima) para que el usuario no distinga "encontrado" de "no encontrado" por el tiempo de respuesta. *(La
  igualación real de tiempos es responsabilidad del backend; la UI no debe delatarla.)*
- **Validación solo local:** formato de correo y presencia del número de pedido. **Ningún campo consulta al
  servidor** mientras se escribe (sin autocompletado, sin comprobación en `blur`, sin marcar un pedido como
  "existente"); el número de pedido **no** se valida contra ningún catálogo, solo que no esté vacío. Ambos
  campos deben estar llenos para habilitar el botón, con la nota textual de validación local asociada.

**Accesibilidad:** el `h1` recibe foco al montar (`tabIndex={-1}`) para que el lector anuncie el estado; el
disclosure "No tengo el enlace" mueve el foco al **primer campo** de la vía B al abrirse; los dos campos van
en un `<fieldset>` con `<legend>` (la intro de la vía B) y cada uno con `<label>` visible, `autocomplete`
adecuado (`email` en el correo; **ninguno** en el número de pedido) y, si falta alguno, `aria-invalid` +
`aria-describedby` a la nota de validación local; el mensaje de resultado va en `role="status"`
`aria-live="polite"` (no `assertive`: no es un error del usuario); la cuenta regresiva se anuncia **una sola
vez** al iniciar, no cada segundo (`aria-live="off"` en el contador, texto alternativo "Vuelve a intentarlo
en un minuto"). Ruta con `noindex`.

### 15.8 Correo de confirmación (nota de diseño; el módulo `mail` no cambia)

`PROJECT.md` deja fuera de alcance rediseñar plantillas de correo. Como referencia mínima para quien las
redacte: el correo debe contener **número de pedido**, **resumen de artículos**, **total**, el **enlace de
seguimiento** y la oferta de **crear cuenta con el mismo correo**; y **no** debe contener la dirección
completa ni datos de pago (un correo se reenvía y se filtra igual que una URL). Se pide el mismo criterio
de minimización de §15.6.

### 15.9 Accesibilidad — reglas específicas de guest checkout

- **Foco visible** bermellón en todos los controles nuevos (§8.2); ningún panel, disclosure ni sticky bar
  puede quitar el `outline`.
- **Orden de tabulación** = orden visual: gate → panel de la vía elegida → contacto → envío → destino
  (→ panel de upsell si está abierto) → confirmación de correo → pago. La barra sticky de móvil se coloca al
  final del DOM pero **no** rompe el orden porque es un duplicado accesible del botón de pago; si se
  duplica, el duplicado va `aria-hidden` y solo uno recibe foco.
- **Botones deshabilitados con explicación:** cada vez que el pago se bloquea (correo sin confirmar, destino
  bóveda sin cuenta, dirección inválida) hay un **texto asociado por `aria-describedby`**; nunca un botón
  apagado y mudo.
- **Anuncios asíncronos:** cotización recalculada, cuenta creada, correo desmarcado, resultado del reenvío →
  `aria-live="polite"`. Errores de pago → `aria-live="assertive"` (§8.2).
- **Etiquetas reales** en todos los campos (`<label htmlFor>`), `autocomplete` correcto en correo y
  dirección (ayuda enorme al invitado, que no tiene datos guardados).
- **Áreas táctiles ≥ 44px** en las tres opciones del gate, los radios de destino y las salidas del upsell.
- **`prefers-reduced-motion`**: la expansión de gate y upsell degrada a mostrar/ocultar sin animación.
- **Contraste:** esta sección **no introduce ningún par nuevo**. Todo lo usado ya está verificado en §10 —
  tinta sobre papel ~15.5:1 (números de pedido, guía, totales), muted `#6E695E` sobre papel ~4.8:1 y sobre
  pozo ~4.6:1 (ayudas y micro-etiquetas), bermellón ~4.65:1 (errores, anillo de foco), verde ~4.4:1 con
  **versalitas como portador** (pasos completados, "cuenta creada"), papel sobre tinta ~15.5:1 (botón
  primario del upsell), papel sobre bermellón ~4.64:1 (botón de pago). El texto muted **no** porta
  información esencial: las micro-etiquetas tipo `REQUIERE CUENTA` se acompañan siempre del texto del
  upsell al activarse.

### 15.10 Componentes: qué se reutiliza y qué es nuevo

**Se reutiliza tal cual (sin variantes nuevas):** `Button` (§6.1, variantes `primary`/`secondary`/`accent`/
`link`/`ghost`), `Input`/`Textarea` (§6.2), `Select` (§6.3), `Checkbox`/`Radio` (§6.4), `LocaleToggle`
(§6.5), `GoogleSignInButton` (§6.7), `Banner` (§7.5), `AmountBreakdown` (§7.12), `PipelineStepper` (§7.9),
`StatusBadge` (§2.4), `CardImage`, `ListingSpec` (§7.2b), `EmptyState`, `QueryState`, `Skeleton`,
`DisputeEvidenceContact` (§7.11), `AuthForm`, `StripePaymentModal`.

**Componentes nuevos propuestos (4 — solo donde no hay equivalente):**

| Componente | Por qué no hay equivalente | Ubicación |
|---|---|---|
| `CheckoutIdentityGate` | No existe ningún patrón de tres vías de identidad con estado persistente en la misma ruta. | `components/domain/` |
| `VaultUpsellPanel` | No hay panel de oferta inline; `Banner` es informativo y `Modal` está descartado por §15.4. | `components/domain/` |
| `PublicOrderTracking` (vista) + su chrome reducido | Toda vista actual asume header de storefront con sesión/carrito; esta exige un chrome propio y minimización de datos. | ruta pública + `components/layout/` |
| `TrackingLinkNeutralState` | El patrón de error de §8.1 (banner + `errorCode` + reintentar) es justo lo que **no** se puede hacer aquí: exige copy neutro, un solo mensaje para todos los fallos y enfriamiento visible. | `components/domain/` |

**Composiciones (no son componentes base nuevos):** `GuestCheckoutForm` (Input + campos de dirección ya
existentes), `FulfillmentChoice` (Radio group), `AccountClaimOffer` (AuthForm compacto + copy), usado tanto
en la confirmación como —en versión "solo enlace"— en la vista de seguimiento y en el estado neutro.

**Ningún token nuevo.** Cero colores, tipografías, radios, sombras o breakpoints añadidos.

### 15.11 i18n — claves nuevas (propiedad de frontend; el copy de seguridad es normativo)

- `checkout.identity.*` — `title`, `guest.cta`/`guest.hint`, `login.cta`/`login.hint`,
  `register.cta`/`register.hint`, `cartKept`, `change`.
- `checkout.guest.*` — `contactGroup`, `email.label`/`email.help`/`email.invalid`/`email.required`,
  `email.typoSuggestion`, `email.confirmCheckbox`, `shippingGroup`, `errorSummary`, `payBlocked.email`,
  `payBlocked.vault`, `payBlocked.address`.
- `checkout.destination.*` — `ship`, `vault`, `vault.requiresAccount`, `shipFeeHint`.
- `checkout.vaultUpsell.*` — `eyebrow`, `title`, `benefit.oneShipment`, `benefit.portfolio`,
  `benefit.custody`, `cta`, `dismiss`, `haveAccount`, `created`, `shippingRemoved`, `emailTakenNeutral`.
- `checkout.confirmation.*` — `eyebrow`, `title`, `orderNumber`, `copyOrderNumber`, `emailSentTo`,
  `wrongEmail`, `claim.*` (`eyebrow`, `title`, `body`, `cta`, `success`, `alreadyClaimedNeutral`),
  `keepShopping`, `cfdiReminder`.
- `track.*` — `orderLabel`, `statusLabel`, `itemsLabel`, `totalPaidLabel`, `trackingLabel`,
  `trackingPending`, `shipToLabel`, `paidWithCard`, `updatedAt`, `refresh`, `copyOrderNumber`,
  `troubleWithOrder`, `createAccountHint`.
- `track.neutral.*` — `title`, `body`, `emailLabel`, `submit`, `result`, `cooldown`, `claimAlternative`,
  `support`, `noLinkCta`, `manualIntro`, `orderNumberLabel`, `orderNumberHelp`, `incompleteForm`
  (los cinco últimos, de la **vía B** de §15.7: correo + número de pedido juntos).
  **Textos normativos: los de la tabla de §15.7, literales en ES y EN.**
- `status.tracking.*` — `paid`, `preparing`, `label`, `shipped`, `delivered`, `refunded`, `cancelled`
  (versalitas de §15.6).

**Reglas de i18n aplicables:** contenedores dimensionados para ES (§9.4) — "Continuar como invitado" y
"Crear cuenta y guardar en bóveda" son las cadenas largas a probar; dinero e importes con `Intl` y
`tabular-nums` (§9.3); el **número de pedido y la guía no se traducen ni se formatean** (mono, tal cual);
los nombres de cartas siguen en inglés con `lang="en"` (§9.2).

### 15.12 Notas para el arquitecto / product-owner (solicitudes derivadas del diseño)

No bloquean el diseño; el contrato aún **no** cubre guest checkout (§J es nuevo). Se listan como petición:

1. **Minimización en el servidor, no en la UI (la más importante).** El endpoint público de seguimiento debe
   **devolver únicamente** lo que §15.6 pinta: número de pedido, estado + timestamps, paquetería y guía,
   artículos (carta, set, número, acabado, precio unitario), desglose y total, `cardLast4`, y `city`/`state`.
   **No debe devolver** dirección completa, CP, nombre, correo, teléfono, `userId`, `orderId` interno ni
   folios de inventario. Ocultarlos en el front no basta: el payload es público.
2. **Cotización de invitado con línea de envío.** `checkout/quote` (o su equivalente de invitado) debe
   exponer el **envío** como línea del `BreakdownDTO` y el **destino** (`ship | vault`) para que el
   `AmountBreakdown` se re-cotice al crear cuenta desde el upsell (§15.4). La cifra de MX$175 del copy del
   upsell debe salir del dial, no del front.
3. **Número de pedido legible** (`TCG-000123` o similar) para mostrar y copiar; **no** es una credencial:
   debe ser inútil como vía de acceso (criterio 52).
4. **Confirmación no adivinable.** La pantalla de confirmación no debe renderizarse desde una URL con un id
   adivinable; o vive en estado de transacción, o usa el mismo token del seguimiento (§15.5).
5. **Reenvío de enlace:** respuesta **idéntica** exista o no el pedido, **límite de frecuencia** y
   **tiempos igualados** (el diseño ya iguala lo visible; la temporización es del backend) — criterio 53.
6. **Cabeceras de la ruta pública:** `noindex, nofollow` y `Referrer-Policy: no-referrer` (y que el token no
   quede en logs de acceso). Es una decisión de arquitectura/devops con consecuencia directa en el diseño.
7. **URL de rastreo de la paquetería:** si el contrato entrega `carrier` + un patrón de URL confiable, la
   guía se vuelve enlace; **si no, se queda como texto copiable** (misma política que el `certNumber`,
   §7.2c). Falta confirmación.
8. **Preguntas abiertas de PROJECT v1.5 que el copy ya evita.** (a) *TTL del enlace*: ningún texto menciona
   días, así que cambiar 90 días por otro valor **no obliga a retocar copy**; (b) *correo que ya tiene
   cuenta*: el diseño nunca lo revela y ofrece siempre las dos salidas (login / seguir como invitado), así
   que sirve para cualquiera de las dos resoluciones que elija el humano.
9. **`evidenceContact`**: la vista pública y la confirmación toman el correo de soporte del contrato (§7.11),
   nunca hardcodeado; sigue pendiente de confirmación del humano el valor definitivo.

---

## 16. Inventario M1 operable — Stream B (v1.6): pestañas, drill-down, consola de precios, alta rápida, acabados y bounties

> Fuente funcional: `ARCHITECTURE.md §4.26` (a–j) y `API_CONTRACT.md` v1.28. Las decisiones de producto ya
> están tomadas por el humano (P-17/18/19/20/22/24/25 en `PENDIENTES.md`); esta sección define SOLO el cómo
> se ve y se opera. Reutiliza tokens, tipografía y componentes existentes (§2–§8). Roles: `vault_operator`
> opera inventario; **precios y valor son de `super_admin`** (el front esconde, el guard impone — §16.2, §16.3).

### 16.0 Principios de esta pantalla

1. **El binder es el hub.** Todo lo operable de una variante (piezas, precios, alta, bounty) vive a UN clic
   de su casilla, en un mismo panel lateral. No hay pestaña "Piezas": la pieza física es un detalle de la
   variante, no una vista hermana.
2. **Dinero honesto siempre:** sin precio = «—» + estado explícito, nunca `$0` (§7.3). Todo resultado de
   lote es por-ítem (lección P-4/P-5): éxito con folios, fallo anclado con causa.
3. **Un lenguaje de acabado para toda la app:** el `FinishMark` (§16.6) nace aquí pero se define para ser
   idéntico en el cotizador público (Stream C, P-14/P-16) y en bóvedas. Admin y storefront no divergen.

### 16.1 Layout de M1 reorganizado (P-17)

Estructura vertical de la página `/admin/inventory` (gutter y grid §4.4):

1. **Header de módulo:** `h1` "Inventario" (serif) + a la derecha el **buscador por folio persistente**:
   `Input` mono, ancho 260px desktop (full-width bajo el título en `< md`), placeholder
   `Buscar folio (INV-000123)` con icono lupa. Está SIEMPRE visible en las tres pestañas.
   - Al enviar un folio válido: abre directamente el **drill-down** (§16.4) de la variante dueña de esa
     pieza, con la fila de la pieza resaltada (`surface-2`) y enfocada. Folio inexistente: mensaje inline
     bajo el input, `text-xs danger`: `No existe una pieza con ese folio.` (no toast).
2. **Tarjetas de valor (P-24, §16.2)** — solo `super_admin`; para `vault_operator` la fila se **omite por
   completo** (sin candados ni placeholders; coherente con el contrato, que no le sirve el dato).
3. **Toolbar de acciones:** derecha, botones `secondary`: `Publicar todo…` (§16.5c) y `Alta por lote`
   (abre el modal de alta masiva existente P-5, sin cambios). Izquierda: **Tabs** (§6.6):
   - **`Master Set`** (default al entrar) · **`Sellado`** (§16.8) · **`Gradeadas`** (§16.9).
   - La pestaña activa se refleja en la URL (`?tab=`) para volver del drill-down sin perder contexto.
4. **Contenido de la pestaña.** Master Set = el índice de sets + binder existente (v1.27), con las tejas de
   variante extendidas según §16.3/§16.6/§16.7.

**Qué desaparece:** la pestaña/vista de lista "Piezas". Sus capacidades (folio, estado, precio manual,
detalle, publicar, merma) se reubican ÍNTEGRAS en el drill-down (§16.4). No se pierde ninguna acción.

### 16.2 Tarjetas de valor del inventario (P-24) — `InventoryValueCards`

Consumen `GET /admin/finance/inventory-value` (breakdown v1.28). **Cuatro `StatCard`** (§7.8) en fila
(1 col móvil → 2 `sm` → 4 `lg`), en este orden con estas etiquetas (eyebrow mono uppercase):

| Card | Etiqueta | Cifra principal | Fuente |
|---|---|---|---|
| 1 | `VALOR TOTAL` | `atReferenceCents` top-level | total |
| 2 | `SUELTAS` | `breakdown.raw.atReferenceCents` | raw |
| 3 | `SELLADO` | `breakdown.sealed.atReferenceCents` | sealed |
| 4 | `GRADEADAS` | `breakdown.graded.atReferenceCents` | graded |

Anatomía por card: eyebrow → cifra a **mercado** (`text-h2` mono `tabular-nums`, `MX$ 128,450.00`) →
segunda línea `text-xs muted`: `Costo: MX$ 84,120.00` (`atCostCents`) → tercera línea SOLO si
`pendingPriceCount > 0`: `12 piezas sin precio` en `text-xs` **warning** (bermellón), que es enlace a la
cola de pendientes de M2 (`/admin/m2?context=inventory`). Con `pendingPriceCount = 0` la línea se omite.
- Estados: loading = skeleton de cifra; error = mini-banner "No se pudo cargar" + Reintentar; cero = `MX$ 0.00`
  legítimo (inventario vacío no es error).
- Regla de confianza: las piezas sin precio están EXCLUIDAS del total (así lo calcula el backend); la
  tercera línea existe justo para que esa exclusión sea visible, nunca silenciosa.

### 16.3 Consola de tres precios en la teja de variante (P-18) — `VariantPriceConsole`

Consume `MasterSetVariantDTO.pricing` (solo scope `platform`; si `pricing` no viene, la consola no se
renderiza — bóvedas de cliente jamás la ven). **Patrón elegido: compacto de solo-lectura en la teja +
edición completa en el panel drill-down.** La teja informa de un vistazo; el write (que es `super_admin` y
auditado) vive en el panel, donde hay espacio para sugerido/override/validación.

**(a) Bloque compacto en la teja** — bajo la fila de conteo de la casilla, TRES renglones mono
(`text-[11px]`, `tabular-nums`, cifras alineadas a la derecha, etiquetas `uppercase tracking-[0.06em]`
en `--color-text-muted`):

```
MERCADO   MX$ 1,250.00
COMPRA      MX$ 875.00 ·M
VENTA     MX$ 1,690.00
```

- `MERCADO` = `marketReferenceMxnCents` (P-15, ya en el binder). `COMPRA`/`VENTA` = `effectiveCents`.
- **Marcador de origen** (sufijo mono de 2 caracteres tras la cifra, con `title` + `aria-label`):
  - *(sin sufijo)* → `source: "rule" | "fallback"` (el caso normal no grita).
  - **`·M`** en tinta, peso 500 → `source: "override"` (`title`/`aria-label`: `Precio manual — pisa la regla`).
  - **`·B`** en **bermellón**, peso 500 → `source: "bounty"` (solo cara COMPRA; `title`: `Bounty activo`).
- **Sin precio:** la cifra es `—` (em dash, muted) y el renglón gana `title`/`aria-label`
  `Precio pendiente — sin referencia de mercado`. Nunca `$0` (§7.3). Si `source:"pending"` en COMPRA o
  VENTA la causa casi siempre es MERCADO en `—`: no se repite el aviso tres veces, basta el `—`.
- El bloque completo es `aria-hidden` NO: cada renglón lleva `aria-label` legible
  (`Precio de compra: 875 pesos, precio manual`). No hay edición inline en la teja (objetivo táctil y
  guardas de dinero viven en el panel).

**(b) Consola completa en el panel drill-down** (§16.4, sección "Precios") — tabla de 3 filas × 3 columnas:

| | Sugerido (regla) | Override | Efectivo |
|---|---|---|---|
| Mercado | — (no aplica) | *(acción "Fijar mercado" M2, solo graded/pendientes)* | `MX$ 1,250.00 · 20 ago 2026` |
| Compra | `MX$ 875.00` | input editable | `MX$ 875.00` + fuente |
| Venta | `MX$ 1,690.00` | input editable | `MX$ 1,690.00` + fuente |

- **Fuente del efectivo** como texto mono en versalitas junto a la cifra: `REGLA` / `MANUAL` / `BOUNTY` /
  `PENDIENTE` (este último en bermellón outline, §7.3). El color acompaña, el texto porta (§2.4).
- **Edición (solo `super_admin`;** para `vault_operator` los inputs se renderizan como texto plano
  — lectura sí, edición no): inputs de dinero con prefijo `MX$` (§6.2), `inputmode="decimal"`,
  vacío = sin override. Acciones: `Guardar precios` (`primary`, un solo submit para ambas caras vía
  `PUT /admin/pricing/variant-controls/:cardId/:finish`) y por campo un enlace
  `Restablecer a regla` (envía `null` explícito → limpia el override; visible solo si hay override).
- **Validación inline** (`aria-invalid` + mensaje §6.2): monto `≤ 0` → `El precio debe ser mayor a cero.`;
  error de servidor se pinta anclado arriba de la sección (patrón P-4).
- **Indicador de override activo:** cuando `overrideCents != null`, el label del campo gana el badge mono
  `MANUAL` en tinta y el sugerido se muestra tachado NO — se muestra como referencia:
  `Sugerido por regla: MX$ 875.00` en `text-xs muted` bajo el input. Quitar el override devuelve la cara a
  la regla al instante (así resuelve el backend; no hay que re-publicar — se puede decir en un toast:
  `Override retirado — vuelve a regir la regla.`).
- **Bounty** vive en esta misma consola: ver §16.7a.
- Guardado exitoso: toast `Precios de la variante guardados.` + refresh del binder. La consola muestra
  siempre la nota al pie `text-xs muted`: `Los cambios pisan lo que ve el cliente · queda en bitácora.`
  (misma familia de §7.6 dinero).

### 16.4 Drill-down de piezas (P-17) — `VariantDrawer`

**Disparador:** clic (o Enter) en la **casilla de variante** del binder. La casilla es un botón real
(`aria-haspopup="dialog"`, foco visible §8.2). Estado seleccionado de la casilla mientras el panel está
abierto: borde `--color-border-strong` + fondo `surface-2`.

**Contenedor:** panel lateral derecho (sheet) de **480px** en `≥ lg`; en `< lg`, bottom sheet a pantalla
casi completa (radio 0, overlay de tinta, focus trap, `Esc` cierra — §7.6). El binder queda visible detrás
en desktop (contexto espacial de "abrí esta casilla").

**Anatomía (orden vertical):**
1. **Header:** miniatura 56×78 de la carta + nombre (EN, `lang="en"`) + renglón `ListingSpec` (§7.2b)
   `RAW · NM · REVERSE HOLO` + `FinishMark` (§16.6) + botón cerrar (44px).
2. **CTA primario `Alta rápida`** — siempre visible bajo el header (no se scrollea): abre la sección de
   alta (§16.5) inline dentro del panel. Si la variante tiene **0 piezas**, el panel abre directamente con
   la sección de alta desplegada (estado vacío = invitación a dar de alta).
3. **Sección «Precios»** — la consola completa (§16.3b), colapsable (abierta por defecto para
   `super_admin`, colapsada para `vault_operator`).
4. **Sección «Piezas (N)»** — lista de copias físicas: `GET /admin/inventory/items?cardId=&finish=&productType=raw`
   (paginada). Cada fila (variante compacta §7.1, alto 48px):
   - **Folio** mono (`INV-000123`) — clic copia al portapapeles (toast `Folio copiado`).
   - **Estado** badge (§2.4): `EN STOCK` / `LISTADA` / `RESERVADA` / `PERDIDA`… texto versalitas.
   - **Precio manual por pieza** (`listPriceCents`): cifra mono o `—`; acción `Editar precio` (lápiz,
     `aria-label`) — inline input con las mismas validaciones §16.3b. Nota fija cuando hay override de
     variante: `El precio por pieza gana sobre el precio de la variante.` (`text-xs muted`, una sola vez
     como encabezado de columna con icono info).
   - **Menú de acciones por fila** (kebab, 44px): `Ver detalle` (historial/movimientos), `Publicar` /
     `Despublicar`, `Merma…` (abre confirmación destructiva §7.6 → `POST /admin/inventory/adjustments`,
     motivos `perdida | danada | error_captura`, nota obligatoria).
   - **Selección múltiple** (checkboxes) + barra de acciones de lote al pie: `Publicar selección (n)`
     (el "publicar piezas de esta carta" existente, sin cambios de contrato).
5. **Estados:** loading = 3 filas skeleton; error = banner danger + Reintentar; vacío = texto
   `Sin piezas de esta variante.` + el CTA de alta ya presente.

**La VENTA no existe aquí** (ratificado §4.26c): ninguna acción "vender" en el panel; solo checkout/M3.
Las bajas son merma por ajuste.

### 16.5 Alta rápida simplificada (P-19) — `QuickAddSection`

Vive dentro del `VariantDrawer` (§16.4.2). **Sin dropdown de acabado, sin ubicación, sin porcentaje:**
la variante viene de la casilla picada; el resto se eliminó por decisión del humano.

**(a) Formulario — exactamente tres controles:**
1. **Cantidad:** stepper `− [ 3 ] +` (botones 44px, input `inputmode="numeric"`, default 1, mín 1).
   Para gradeadas no aplica (el alta de PSA es otro flujo, §16.9).
2. **Adquisición:** dos tarjetas-radio grandes (una fila en desktop, apiladas en móvil; borde
   `--color-border`, seleccionada = borde `strong` + fondo `surface-2` + radio marcado):
   - **`Comprar`** — sublabel `Pagamos por pieza:` + input de dinero **prellenado** con
     `pricing.buy.effectiveCents` (editable, prefijo `MX$`). Helper `text-xs muted` bajo el input según la
     fuente: `Sugerido por regla` / `Precio manual activo` / `Precio bounty activo`. Si el efectivo es
     `null`, el input abre vacío con helper `Sin sugerido — captura el precio pagado.` (la compra con
     precio capturado SIEMPRE es válida).
   - **`Aportación`** — sublabel `Se registra a valor de mercado:` + la cifra **mostrada, no editable**:
     `MX$ 1,250.00` (mono). **Sin porcentaje visible en ninguna parte.**
     - Si `marketReferenceMxnCents == null`: la tarjeta se muestra **deshabilitada** (opacidad 45%, no
       recibe selección) con el pill `PRECIO PENDIENTE` (warning outline) y el texto
       `Sin valor de mercado — fija primero el precio de esta variante.` (para `super_admin`, con enlace a
       "Fijar mercado" de la consola §16.3b). Se preempta el error conocido; el servidor sigue siendo la
       autoridad (b).
3. **CTA:** botón `primary` full-width **`Dar de alta al inventario`** (mismo verbo ya ratificado), estado
   `loading` con label `Dando de alta…`, bloquea doble envío (`batchKey` idempotente por intento).

**(b) Resultado por-ítem (lote tolerante, lección P-4/P-5):** la respuesta de
`POST /admin/inventory/items/batch` se pinta DENTRO del panel, nunca solo un toast:
- **Éxito total:** banner `success` arriba de la sección: `3 piezas dadas de alta · INV-000201 a INV-000203`
  + la lista de piezas (§16.4.4) se refresca con las filas nuevas resaltadas 3s (`surface-2`).
- **Fallo (total o parcial):** banner `danger` **anclado arriba del panel, sticky, `role="alert"`,**
  con `scrollIntoView` + foco (patrón P-4 ratificado). Copy para `PRICE_PENDING`:
  `No se registró la aportación: esta variante no tiene valor de mercado. Fija el precio y vuelve a intentar.`
  En lote mixto, el banner resume `2 creadas · 1 rechazada` y debajo lista cada línea fallida con su causa
  traducida. Jamás silencio, jamás crear a ciegas.

**(c) «Publicar todo» — `PublishAllDialog`** (toolbar §16.1.3, disparador `secondary`):
1. **Confirmación (modal §7.6, verbo explícito):** título `Publicar todo el inventario`; cuerpo:
   `Se publicarán todas las piezas en stock que tengan precio resoluble.` + selector de alcance
   (Select §6.3): `Todo el inventario` (default) / `Solo este set` (el set abierto, si hay) /
   `Solo sellado` — mapea a `{ setId?, productType? }`. Nota fija `text-xs muted`:
   `Las piezas sin precio NO se publican: quedan en la cola de precios pendientes.` y la nota de dinero
   `Expone piezas a la venta · queda en bitácora.` Botones: `secondary` `Cancelar` / `primary`
   `Publicar todo`. *(No hay conteo previo: el contrato no tiene dry-run — ver §16.11; la honestidad va en
   el resultado, no en una estimación inventada.)*
2. **Resultado (el modal muta a resumen, no toast):** cuatro renglones mono `tabular-nums`:
   ```
   Publicadas          128
   Ya estaban listadas  40
   Sin precio           12   → Ver pendientes de precio
   Fallidas              0
   ```
   `Sin precio` > 0 pinta la cifra en **bermellón** y el enlace lleva a la cola M2
   (`/admin/m2?context=inventory`). `Fallidas` > 0 despliega el detalle por folio con causa (capado a 200
   por contrato; si se capó: `Se muestran las primeras 200 — el resto está en la cola de pendientes.`).
   Cierre con `secondary` `Entendido`. Reintento con el mismo `batchKey` = replay idempotente (el front
   muestra el resultado guardado con nota `Resultado de la corrida anterior (reintento idempotente).`).

### 16.6 Distintivo visual de acabado (adelanto P-14) — `FinishMark`

**Problema:** la imagen de catálogo es idéntica entre variantes; el acabado debe distinguirse de un
vistazo. **Solución: banda superior de 3px + etiqueta mono SIEMPRE visible** (doble canal: el color/banda
es redundante, el texto porta — regla §2.4). Se define UNA vez y se usa igual en el binder M1, el
cotizador (Stream C), bóvedas y storefront.

| `finish` | Banda (3px, borde superior de la casilla/teja) | Etiqueta mono (`text-[10px] uppercase tracking-[0.18em]`) |
|---|---|---|
| `normal` | **Sin banda** (el borde base `--color-border` de 1px) | `NORMAL` en `--color-text-muted` |
| `reverse_holo` | **Gradiente lineal 90°** `#9A6C57 → #B44B3A` (neutral-warm → bermellón) | `REVERSE` en `--color-text` |
| `holofoil` | **Sólida tinta** `#1A1A18` | `HOLO` en `--color-text` |
| `first_edition_holofoil` | Sólida tinta `#1A1A18` | `1ED HOLO` en `--color-text` |

- La banda de reverse es **la única superficie con gradiente permitida en todo el sistema** (guiño foil,
  §5 "guiño de marca"): dos tonos cálidos de la propia paleta, 3px, decorativa (`aria-hidden`). No es un
  "degradado arcoíris" (§1.3) ni un token nuevo.
- **Accesibilidad:** la banda es decorativa; el significado lo porta la **etiqueta**, presente SIEMPRE
  (nunca banda sin texto), + `aria-label` de la casilla: `Pikachu ex, reverse holo, 3 piezas`. Contraste de
  la banda sobre papel: tinta ~15:1, neutral-warm ~4.0:1, bermellón ~4.6:1 — todas ≥ 3:1 (componente UI,
  §10). Las etiquetas usan tinta/muted (AA de texto).
- **Dónde:** en toda teja/casilla que represente UNA variante (binder M1, cotizador, drill-down header,
  Top Bounties). En fichas de detalle basta el `ListingSpec` (§7.2b); la banda es para retículas.
- La etiqueta NO se traduce distinto por locale (`REVERSE`/`HOLO` son términos del hobby); el `aria-label`
  sí se localiza (`reverse holo` / `holofoil` legibles).

### 16.7 Bounty (P-22) — consola admin + vitrina pública «Top Bounties»

**(a) Edición en la consola (dentro de §16.3b, solo `super_admin`, solo variantes raw):** bloque «Bounty»
al pie de la consola:
- **Switch** (§6.4) `Marcar como bounty` con etiqueta de estado textual. Al activarlo se despliegan:
  - `Precio bounty` (input dinero, requerido): helper dinámico
    `Premium sobre la regla: +MX$ 125.00 (+14%)` (`bountyPriceCents − suggestedCents`; si el sugerido está
    pendiente: `Sin sugerido de regla — el bounty es el precio explícito.`).
  - `Cantidad objetivo (opcional)` (numérico ≥ 1), helper: `Al completarse, el bounty se apaga solo.`
  - Progreso cuando hay objetivo: barra fina + texto mono `2 de 3 conseguidas`.
- **Validaciones inline** (espejo del contrato): sin precio → `El bounty necesita un precio explícito.`
  (`BOUNTY_PRICE_REQUIRED`); precio < sugerido → `El precio bounty debe ser mayor o igual al sugerido por
  regla (MX$ 875.00).` (`BOUNTY_BELOW_RULE`).
- **Bounty completado** (`completedAt != null`): línea de estado `BOUNTY COMPLETADO · 21 ago 2026` en verde
  (versalitas) — informativa, no bloquea reactivar.
- Apagar el bounty (`enabled:false`) NO borra el contador; el copy del switch apagado con historial:
  `Bounty apagado · 2 conseguidas`.

**(b) Badge en la teja admin:** cuando `bounty.enabled`, la casilla del binder gana el badge mono
**`BOUNTY`** en **bermellón** (versalitas, sin caja §7.2) junto al conteo, con icono `crosshair` de lucide
16px `aria-hidden` a la izquierda (la mira: guiño al futuro TCG HUNT sin implementar el rebrand — el icono
es decorativo y removible). El renglón COMPRA de la consola compacta ya muestra `·B` (§16.3a).
> **Actualización v1.7 (P-21):** con el rebrand, el icono `crosshair` de lucide del badge BOUNTY (aquí y
> en el `BountyCard` §16.7c) **se sustituye por el glifo micro oficial de la mira TCG HUNT** (`HuntMark`
> micro, §17.1d) en `currentColor`, mismo tamaño (12–16px) y sigue siendo `aria-hidden`. El color del
> badge pasa a heredar el nuevo valor de `--color-accent` (`#B31217`, §17.2) sin cambiar de token.

**(c) Vitrina pública `/buylist` — `TopBountiesShelf` + `BountyCard`:** sección **arriba de la página
Vender, ANTES del selector de set**. Consume `GET /buylist/bounties` (cap 50; se pintan las primeras
8–12, fila con scroll horizontal en móvil / grid 4-col `lg`).
- **Encabezado de sección:** eyebrow mono `SE BUSCA` + `h2` serif `Top Bounties` + subtítulo `text-sm muted`:
  `Estas cartas las pagamos mejor. El pago se realiza después de recibir y verificar tu carta.` (la segunda
  frase mantiene el mensaje PAY_AFTER_RECEIPT de §7.5 — un precio alto no cambia la regla de confianza).
- **`BountyCard`** (variante del `CardTile` §7.1): imagen 5:7 con **chip de scrim de tinta** (§7.2b) en la
  esquina superior-izquierda: `☩ BOUNTY` (crosshair 12px `aria-hidden` + texto papel sobre tinta ~15:1);
  banda `FinishMark` del acabado; nombre EN; set·número; y el precio como héroe:
  - Etiqueta `text-xs muted` `Pagamos` + cifra `text-lg semibold tabular-nums` `MX$ 2,500.00` en **verde**
    (`--color-success` — dinero que TE pagamos, coherente con la semántica "positivo").
  - Si `remainingQty != null`: renglón mono `text-[11px]` en bermellón `QUEDAN 2` (motivacional; con
    `remainingQty` null se omite — nunca inventar escasez).
  - CTA `secondary` `Cotizar esta carta` → lleva al cotizador con la carta/variante precargada.
- Estados: skeleton (3 cards); **si no hay bounties activos la sección NO se renderiza** (nunca un shelf
  vacío en la home de Vender); error = se oculta la sección (es vitrina, no bloquea el flujo de venta).
- **En admin nada de esto cambia la cola:** el flujo de venta sigue siendo el normal (cotiza → solicitud →
  recepción → verificación → pago SPEI); el card no promete compra garantizada — por eso el copy es
  `Pagamos MX$…` + `QUEDAN N`, sin "reservado/garantizado".

### 16.8 Pestaña «Sellado» (P-25) — por set

Análoga al Master Set pero de **piezas selladas** (no hay catálogo de sellado): índice → detalle por set.
- **Índice** (`GET /admin/inventory/sealed-sets`): `DataTable` (§7.7) con columnas: Set (nombre + código),
  `Piezas` (`pieceCount`), `Listadas` (`listedCount`), `Valor de mercado` (`marketValueMxnCents` mono o
  `—`), y badge `N SIN MAPEO` (warning outline) cuando `unmappedCount > 0`. Buscador `q` arriba.
  Arriba a la derecha, SOLO `super_admin`: enlace `Cola de no mapeados (N)` (usa `unmappedTotal`) → vista
  M2 `sealed/unmapped`. Para `vault_operator` el enlace no existe; sus grupos sin mapeo se leen como
  `SIN PRECIO DE MERCADO`.
- **Detalle de set** (`GET /admin/inventory/sealed-sets/:setId`): lista de **grupos** (fila 56px):
  imagen ancla (`object-contain` sobre pozo, §7.1b) + `productName` + pills `Sellado` + subtipo (`ETB`,
  `Booster Box`… §7.1b) + condición (`MINT` / `DAÑO MENOR DE CAJA` versalitas §2.4) + conteos mono
  `3 en stock · 1 listada` + `sealedMarketRef` (cifra o `SIN PRECIO DE MERCADO` warning outline si
  `mapped=false`) + costo agregado (`super_admin`).
- **Acciones por grupo:** `Alta rápida` (MISMO `QuickAddSection` §16.5 — cantidad + Comprar/Aportación; la
  aportación usa `sealedMarketRef` como valor mostrado y su ausencia deshabilita la tarjeta igual que en
  §16.5a2), `Ver piezas` (drill-down §16.4 con `productType=sealed`; sin consola de precios P-18 — el
  sellado conserva su cadena H-1, solo precio manual por pieza), `Publicar` (bulk de sus folios).
- Estado vacío de la pestaña: `Sin producto sellado en inventario.` + CTA `Alta por lote` (el alta clásica
  admite tipo sellado).

### 16.9 Pestaña «Gradeadas» (P-20) — por carta + grado

Consume `GET /admin/inventory/graded` (agregado por carta × empresa × grado).
- **Lista** (`DataTable`, fila 56px): miniatura + nombre/set/número + **`GradedCertChip`-estilo de grado**
  `PSA 10` (accent §7.2c, SIN cert — el cert es de la pieza, no del grupo) + `Piezas` (count) +
  `Valor de mercado` + `Costo` (`super_admin`).
- **Valor de mercado por grado es MANUAL en este stream** (decisión v1.28): cifra mono con sufijo `·M`
  cuando existe (`title`: `Valor fijado manualmente`); sin valor → `SIN VALOR` (warning outline) y — solo
  `super_admin` — acción `Fijar valor…`: mini-form inline (input dinero + `Guardar`) que llama al override
  de mercado existente (`POST /admin/pricing/override`, `productType:"graded"`). Copy del helper:
  `Fija el valor de mercado de esta carta en este grado (p. ej. lo que se vende una PSA 10). Alimenta la
  valuación del inventario.`
- **Drill-down** por grupo (§16.4 con `productType=graded`): filas de pieza muestran además el
  **`certNumber`** completo (mono, copiable — §7.2c). Sin stepper de cantidad en alta (slab = pieza única).
- **CTA de pestaña `Agregar gradeada`** (también accesible como acción secundaria de la teja del Master
  Set, menú kebab `Agregar gradeada…`): formulario corto en modal — Empresa (Select: PSA/CGC/…), Grado,
  `Número de certificado` (mono, requerido para publicar), `Precio de compra` (dinero) → un solo
  `POST /admin/inventory/items` (qty 1 forzado). Resultado con folio, patrón §16.5b.
- Estado vacío: `Sin cartas gradeadas en inventario.` + CTA `Agregar gradeada`.

### 16.10 i18n — claves nuevas (propiedad de frontend)

- `admin.inventory.tabs.{masterSet,sealed,graded}` · `admin.inventory.folioSearch.{placeholder,notFound}`
- `admin.inventory.value.{total,raw,sealed,graded,cost,pendingCount}`
- `admin.pricing.console.{market,buy,sell,suggested,override,effective,source.rule,source.manual,source.bounty,source.pending,resetToRule,save,saved,overrideRemoved,pisaNota}`
- `admin.quickAdd.{title,qty,buy.label,buy.sublabel,buy.helper.rule,buy.helper.manual,buy.helper.bounty,buy.helper.none,contrib.label,contrib.sublabel,contrib.pendingBlocked,cta,loading,successSummary,pricePendingError,partialSummary}`
- `admin.publishAll.{title,body,scope.all,scope.set,scope.sealed,pendingNote,moneyNote,cta,result.published,result.alreadyListed,result.pendingPrice,result.failed,result.seePending,result.capped,result.replay,close}`
- `admin.drawer.{pieces,addQuick,pieceOverridesVariant,noPieces,folioCopied,editPrice,markLoss}`
- `admin.bounty.{toggle,price,premium,noSuggested,targetQty,targetHelper,progress,completed,offWithHistory,badge}`
- `buylist.bounties.{eyebrow,title,subtitle,wePay,remaining,cta}`
- `finish.{normal,reverse,holo,firstEdHolo}` (etiquetas del `FinishMark` — compartidas con Stream C)
- Errores nuevos: `error.BOUNTY_PRICE_REQUIRED`, `error.BOUNTY_BELOW_RULE` (con el copy de §16.7a).

Reglas: dinero con `Intl` + `tabular-nums` (§9.3); folios/certs en mono sin traducir; contenedores
dimensionados para ES (§9.4 — `Dar de alta al inventario` y `Publicar todo el inventario` son las cadenas
largas a probar).

### 16.11 Notas para el arquitecto / product-owner (no bloquean el diseño)

1. **Dry-run de `publish-all` (deseable, no requerido):** el pedido original de P-19 habla de una
   confirmación con "cuántas se publicarán / cuántas quedarán pendientes". El contrato v1.28 no tiene
   preview, así que el diseño pone la honestidad en el RESULTADO (§16.5c2) y la confirmación describe
   alcance y reglas. Si el humano quiere el conteo ANTES de ejecutar, se necesitaría un parámetro
   `dryRun:true` (misma selección, cero escrituras). Petición registrada, no asumida.
2. **`BountyCard` → cotizador precargado:** el CTA `Cotizar esta carta` asume que el cotizador acepta
   precarga de carta+finish por URL/estado. Si no existe, el CTA cae al set de la carta (degradación
   aceptable); confirmar con frontend/Stream C.
3. **`FinishMark` es la semilla de P-14 (Stream C):** el cotizador y el storefront deben reutilizar este
   componente tal cual (banda + etiqueta). Cualquier evolución (p. ej. efecto foil animado) se decide en
   Stream C sin romper la tabla de §16.6.

---

## 17. Identidad TCG HUNT (P-21, v1.7)

> **Qué es:** el rebrand de la marca visible. El sitio pasa de "TCG VAULT MX" a **TCG HUNT** (dominio
> `tcghunt.mx`). **Qué NO es:** un rediseño — la dirección editorial papel/tinta 5a (§1–§16) sigue intacta;
> cambia el **acento de color** (bermellón → rojo TCG HUNT) y se incorpora el **logo de mira**.
>
> **Origen:** reconstrucción vectorial fiel a la **referencia de alta resolución que compartió el humano**
> (imagen de chat, 2026-08-21; **cotejada por el humano el mismo día → corrección v1.7.1**): una
> **retícula de mira de rifle (scope reticle)** — dos anillos concéntricos **con huecos en los 4
> cardinales**, cruz **segmentada** en cuatro líneas independientes que atraviesan esos huecos y terminan
> antes del punto central (la izquierda mucho más larga; la superior sobresale más que la inferior),
> **punto central anillado aislado**, degradado rojo `#B31217` (arriba/izquierda) → vino `#4A0D0D`
> (abajo/derecha) en diagonal sobre el conjunto, wordmark "TCG HUNT" **ancho y dominante** en sans
> geométrica bold en vino casi plano, y ".mx" pequeño alineado al borde derecho del wordmark, sobre fondo
> blanco/claro. Cuando el humano suba el PNG original a `frontend/public/branding/`, se coteja el SVG
> contra él y se ajustan métricas finas (grosores, gaps angulares, tracking del wordmark) si hiciera
> falta — la geometría de esta sección es la fuente de verdad hasta entonces.

### 17.1 El logo — SVG oficial (fuente de verdad vectorial)

Anatomía de la retícula (`HuntMark`), común a todas las versiones — es una **mira de rifle (scope
reticle)**, y la regla de oro es que **ningún trazo pisa a otro**:
- **Dos anillos concéntricos** (stroke, sin relleno), proporción de radios ≈ 1 : 0.61, grosor de stroke
  aproximadamente igual entre ambos. Cada anillo se dibuja como **4 arcos** (`path` con arcos, no
  `circle`) dejando un **hueco (gap) centrado en cada punto cardinal** por donde pasa la cruz: gap
  angular **~12° en el anillo exterior** y **~20° en el interior** (más ángulo a menos radio para que el
  claro visual sea parejo y la línea pase con aire). Los arcos van con **cap plano (butt, el default)**:
  si llevaran `round` invadirían el hueco y tocarían la línea.
- **Cruz SEGMENTADA en cuatro líneas independientes** — nunca una línea corrida:
  - **Vertical superior:** baja desde muy arriba (sobresale mucho del anillo exterior), atraviesa ambos
    anillos por sus huecos y **termina dentro del anillo interior**, dejando un espacio claro antes del
    punto central.
  - **Vertical inferior:** empieza debajo del punto central (mismo espacio), atraviesa ambos huecos y
    sobresale por debajo del anillo exterior — **proyección externa más corta que la superior**.
  - **Horizontales: DOS segmentos.** El **izquierdo es el más largo** de los cuatro (viene desde muy
    lejos), atraviesa los huecos y termina antes del punto central; el **derecho** empieza después del
    punto central, atraviesa los huecos y se extiende lejos a la derecha (algo menos que el izquierdo).
  - Los **ocho extremos** de los cuatro segmentos con **`stroke-linecap="round"`**.
- **Punto central anillado AISLADO**: círculo pequeño con **centro hueco** (stroke grueso, el fondo se
  ve a través). Nada lo toca — hay aire entre el punto y los cuatro finales de línea.
- Sin rellenos, sin sombras (§4.3); radio 0 no aplica (el logo es la única pieza circular legítima del
  sistema — es un glifo, no un componente UI).
- **Degradados** (`userSpaceOnUse` para que todas las piezas compartan rampa): `huntGrad` **diagonal**
  arriba/izquierda → abajo/derecha para toda la retícula (stops `#B31217` 0% → `#4A0D0D` 100%), y
  `huntGradWm` para el wordmark: **rampa corta de vino** `#6E1013` → `#4A0D0D` (en el original el texto
  se ve vino oscuro casi plano con leve gradiente).

**(a) Versión completa — lockup principal (retícula + wordmark), fondo claro.** Composición apilada
fiel a la referencia: retícula arriba (segmento horizontal izquierdo el más largo), **wordmark ancho y
dominante** debajo — ocupa casi todo el ancho de las horizontales —, ".mx" alineado al borde derecho
del wordmark. Para el frontend: pegar como componente `<LogoTcgHunt />`; los `id` de gradiente llevan
prefijo por instancia si se monta más de una vez en la página (evitar `id` duplicados en el DOM).
Geometría de referencia: centro de retícula `(240,112)`, anillo exterior `r=56` (gap 12°/cardinal),
interior `r=34` (gap 20°/cardinal), claro alrededor del punto central = **18px** desde el centro por
los cuatro lados.

```svg
<svg viewBox="0 0 480 330" fill="none" xmlns="http://www.w3.org/2000/svg"
     role="img" aria-label="TCG HUNT — tcghunt.mx">
  <defs>
    <!-- degradado del conjunto: rojo arriba/izquierda → vino abajo/derecha (diagonal) -->
    <linearGradient id="huntGrad" gradientUnits="userSpaceOnUse"
                    x1="10" y1="8" x2="452" y2="198">
      <stop offset="0" stop-color="#B31217"/>
      <stop offset="1" stop-color="#4A0D0D"/>
    </linearGradient>
    <!-- wordmark: vino oscuro casi plano, leve gradiente -->
    <linearGradient id="huntGradWm" gradientUnits="userSpaceOnUse"
                    x1="0" y1="232" x2="0" y2="290">
      <stop offset="0" stop-color="#6E1013"/>
      <stop offset="1" stop-color="#4A0D0D"/>
    </linearGradient>
  </defs>

  <!-- RETÍCULA (centro 240,112) — cruz SEGMENTADA: nada pisa nada -->
  <!-- horizontal izquierda (la más larga): termina 18px antes del centro -->
  <line x1="10"  y1="112" x2="222" y2="112" stroke="url(#huntGrad)" stroke-width="7" stroke-linecap="round"/>
  <!-- horizontal derecha: empieza 18px después del centro -->
  <line x1="258" y1="112" x2="452" y2="112" stroke="url(#huntGrad)" stroke-width="7" stroke-linecap="round"/>
  <!-- vertical superior: sobresale mucho por arriba, termina dentro del anillo interior -->
  <line x1="240" y1="8"   x2="240" y2="94"  stroke="url(#huntGrad)" stroke-width="7" stroke-linecap="round"/>
  <!-- vertical inferior: más corta en proyección externa -->
  <line x1="240" y1="130" x2="240" y2="198" stroke="url(#huntGrad)" stroke-width="7" stroke-linecap="round"/>

  <!-- anillo exterior r=56: 4 arcos, gap de 12° centrado en cada cardinal (cap plano) -->
  <path d="M295.69 117.85 A56 56 0 0 1 245.85 167.69" stroke="url(#huntGrad)" stroke-width="7"/>
  <path d="M234.15 167.69 A56 56 0 0 1 184.31 117.85" stroke="url(#huntGrad)" stroke-width="7"/>
  <path d="M184.31 106.15 A56 56 0 0 1 234.15 56.31"  stroke="url(#huntGrad)" stroke-width="7"/>
  <path d="M245.85 56.31  A56 56 0 0 1 295.69 106.15" stroke="url(#huntGrad)" stroke-width="7"/>

  <!-- anillo interior r=34: 4 arcos, gap de 20° centrado en cada cardinal (cap plano) -->
  <path d="M273.48 117.90 A34 34 0 0 1 245.90 145.48" stroke="url(#huntGrad)" stroke-width="6.5"/>
  <path d="M234.10 145.48 A34 34 0 0 1 206.52 117.90" stroke="url(#huntGrad)" stroke-width="6.5"/>
  <path d="M206.52 106.10 A34 34 0 0 1 234.10 78.52"  stroke="url(#huntGrad)" stroke-width="6.5"/>
  <path d="M245.90 78.52  A34 34 0 0 1 273.48 106.10" stroke="url(#huntGrad)" stroke-width="6.5"/>

  <!-- punto central anillado (centro hueco) — AISLADO, nada lo toca -->
  <circle cx="240" cy="112" r="8" stroke="url(#huntGrad)" stroke-width="5.5"/>

  <!-- WORDMARK dominante: Montserrat 700 (--font-brand, §17.1e), casi el ancho de las horizontales -->
  <text x="240" y="278" text-anchor="middle"
        font-family="Montserrat, Archivo, system-ui, sans-serif"
        font-size="66" font-weight="700" letter-spacing="9"
        fill="url(#huntGradWm)">TCG HUNT</text>
  <!-- ".mx" abajo-derecha, alineado al borde derecho del wordmark, vino sólido -->
  <text x="452" y="312" text-anchor="end"
        font-family="Montserrat, Archivo, system-ui, sans-serif"
        font-size="24" font-weight="600" letter-spacing="0.5"
        fill="#4A0D0D">.mx</text>
</svg>
```

**(b) Versión solo-mira (`HuntMark`)** — avatar, topbar compacto, apple-touch. Cuadrada; misma
gramática de retícula (cruz segmentada + anillos con huecos + punto aislado); en lienzo cuadrado las
horizontales no pueden ser dramáticamente más largas, pero la izquierda sigue siendo la mayor y la
vertical superior sobresale más que la inferior:

```svg
<svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"
     role="img" aria-label="TCG HUNT">
  <defs>
    <linearGradient id="huntMarkGrad" gradientUnits="userSpaceOnUse" x1="1" y1="2" x2="124" y2="122">
      <stop offset="0" stop-color="#B31217"/><stop offset="1" stop-color="#4A0D0D"/>
    </linearGradient>
  </defs>
  <!-- cruz segmentada (centro 64,64; claro de 12px alrededor del punto) -->
  <line x1="1"  y1="64" x2="52" y2="64"  stroke="url(#huntMarkGrad)" stroke-width="8" stroke-linecap="round"/>
  <line x1="76" y1="64" x2="124" y2="64" stroke="url(#huntMarkGrad)" stroke-width="8" stroke-linecap="round"/>
  <line x1="64" y1="2"  x2="64" y2="52"  stroke="url(#huntMarkGrad)" stroke-width="8" stroke-linecap="round"/>
  <line x1="64" y1="76" x2="64" y2="122" stroke="url(#huntMarkGrad)" stroke-width="8" stroke-linecap="round"/>
  <!-- anillo exterior r=36: 4 arcos, gap 16°/cardinal -->
  <path d="M99.65 69.01 A36 36 0 0 1 69.01 99.65" stroke="url(#huntMarkGrad)" stroke-width="8"/>
  <path d="M58.99 99.65 A36 36 0 0 1 28.35 69.01" stroke="url(#huntMarkGrad)" stroke-width="8"/>
  <path d="M28.35 58.99 A36 36 0 0 1 58.99 28.35" stroke="url(#huntMarkGrad)" stroke-width="8"/>
  <path d="M69.01 28.35 A36 36 0 0 1 99.65 58.99" stroke="url(#huntMarkGrad)" stroke-width="8"/>
  <!-- anillo interior r=22: 4 arcos, gap 28°/cardinal -->
  <path d="M85.35 69.32 A22 22 0 0 1 69.32 85.35" stroke="url(#huntMarkGrad)" stroke-width="7"/>
  <path d="M58.68 85.35 A22 22 0 0 1 42.65 69.32" stroke="url(#huntMarkGrad)" stroke-width="7"/>
  <path d="M42.65 58.68 A22 22 0 0 1 58.68 42.65" stroke="url(#huntMarkGrad)" stroke-width="7"/>
  <path d="M69.32 42.65 A22 22 0 0 1 85.35 58.68" stroke="url(#huntMarkGrad)" stroke-width="7"/>
  <!-- punto central anillado, aislado -->
  <circle cx="64" cy="64" r="5" stroke="url(#huntMarkGrad)" stroke-width="4.5"/>
</svg>
```

**(c) Variante para fondo oscuro (paneles de tinta `#1A1A18`: hero de auth, sidebar admin, footer
oscuro).** El degradado original NO se usa sobre tinta: el vino `#4A0D0D` es ilegible (~1.4:1) y el rojo
`#B31217` queda en ~2.5:1 (< 3:1). La variante oscura **aclara la rampa** (`#F0685F` → `#D0362C`, ambos
≥ 3:1 sobre tinta, §17.2) y pinta el **wordmark en papel sólido** `#F4F1EA` (~15.5:1) — sobre oscuro la
identidad la porta la mira; el wordmark prioriza legibilidad:

```svg
<svg viewBox="0 0 480 330" fill="none" xmlns="http://www.w3.org/2000/svg"
     role="img" aria-label="TCG HUNT — tcghunt.mx">
  <defs>
    <linearGradient id="huntGradDark" gradientUnits="userSpaceOnUse" x1="10" y1="8" x2="452" y2="198">
      <stop offset="0" stop-color="#F0685F"/><stop offset="1" stop-color="#D0362C"/>
    </linearGradient>
  </defs>
  <!-- misma geometría que (a): cruz segmentada + anillos con huecos + punto aislado -->
  <line x1="10"  y1="112" x2="222" y2="112" stroke="url(#huntGradDark)" stroke-width="7" stroke-linecap="round"/>
  <line x1="258" y1="112" x2="452" y2="112" stroke="url(#huntGradDark)" stroke-width="7" stroke-linecap="round"/>
  <line x1="240" y1="8"   x2="240" y2="94"  stroke="url(#huntGradDark)" stroke-width="7" stroke-linecap="round"/>
  <line x1="240" y1="130" x2="240" y2="198" stroke="url(#huntGradDark)" stroke-width="7" stroke-linecap="round"/>
  <path d="M295.69 117.85 A56 56 0 0 1 245.85 167.69" stroke="url(#huntGradDark)" stroke-width="7"/>
  <path d="M234.15 167.69 A56 56 0 0 1 184.31 117.85" stroke="url(#huntGradDark)" stroke-width="7"/>
  <path d="M184.31 106.15 A56 56 0 0 1 234.15 56.31"  stroke="url(#huntGradDark)" stroke-width="7"/>
  <path d="M245.85 56.31  A56 56 0 0 1 295.69 106.15" stroke="url(#huntGradDark)" stroke-width="7"/>
  <path d="M273.48 117.90 A34 34 0 0 1 245.90 145.48" stroke="url(#huntGradDark)" stroke-width="6.5"/>
  <path d="M234.10 145.48 A34 34 0 0 1 206.52 117.90" stroke="url(#huntGradDark)" stroke-width="6.5"/>
  <path d="M206.52 106.10 A34 34 0 0 1 234.10 78.52"  stroke="url(#huntGradDark)" stroke-width="6.5"/>
  <path d="M245.90 78.52  A34 34 0 0 1 273.48 106.10" stroke="url(#huntGradDark)" stroke-width="6.5"/>
  <circle cx="240" cy="112" r="8" stroke="url(#huntGradDark)" stroke-width="5.5"/>
  <!-- wordmark en papel sólido (sobre tinta la identidad la porta la retícula) -->
  <text x="240" y="278" text-anchor="middle"
        font-family="Montserrat, Archivo, system-ui, sans-serif"
        font-size="66" font-weight="700" letter-spacing="9" fill="#F4F1EA">TCG HUNT</text>
  <text x="452" y="312" text-anchor="end"
        font-family="Montserrat, Archivo, system-ui, sans-serif"
        font-size="24" font-weight="600" letter-spacing="0.5" fill="#F0685F">.mx</text>
</svg>
```
La solo-mira oscura es la (b) con los stops de `#F0685F` → `#D0362C` (misma geometría segmentada).

**(d) Glifo micro (< 28px, v1.7.1) — `HuntMark` micro.** A 12–16px los dos anillos + punto hueco se
empastan y por debajo de ~28px los huecos de los anillos ya no se leen.
Versión simplificada monocroma (`currentColor`, sin gradiente — invisible a ese tamaño): **un solo
anillo + cruz SEGMENTADA + punto sólido**. **Simplificación explícita:** el micro **omite los huecos
del anillo** (un gap de 12–20° a 16px mide < 1px y no se lee; el anillo va cerrado y las líneas lo
cruzan en el mismo color, donde el solape es invisible), pero **conserva la cruz segmentada y el punto
aislado** — esa interrupción alrededor del centro sí lee a 16px y es la firma de la retícula. Es el
glifo que usan el badge **BOUNTY** (§16.7b, sustituye al `crosshair` de lucide) y cualquier uso inline
junto a texto:

```svg
<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- cruz segmentada: 4 segmentos, claro de 4px alrededor del punto; inferior más corta -->
  <line x1="0.75" y1="12" x2="8"  y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="16"  y1="12" x2="23.25" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="12"  y1="1"  x2="12" y2="8"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="12"  y1="16" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- anillo único CERRADO (simplificación micro: sin gaps) -->
  <circle cx="12" cy="12" r="6.5" stroke="currentColor" stroke-width="2"/>
  <!-- punto sólido aislado -->
  <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>
</svg>
```

**(e) Tipografía del wordmark — Montserrat 700 (`--font-brand`).** La referencia usa una sans geométrica
bold (estilo Montserrat/Poppins); se adopta **Montserrat, peso 700** (Google Font). Carga según la
convención del proyecto (§3.1 — self-hosted por `next/font/google` en `[locale]/layout.tsx`, subset
`latin`, sin petición runtime a Google):
```ts
const brand = Montserrat({ subsets: ['latin'], weight: ['700'], variable: '--font-brand' });
// añadir brand.variable a la clase del <html>, junto a --font-serif/--font-sans/--font-mono
```
- `--font-brand` es **exclusiva del wordmark/lockup** (componente Logo, header de correo, OG). NO entra
  en la escala tipográfica de §3: los títulos siguen en Zen Old Mincho y la UI en Archivo. Un peso, un uso.
- Fallback declarado en el propio SVG: `Montserrat, Archivo, system-ui, sans-serif` (si la variable no
  está montada, Archivo 700 es visualmente cercana y digna).
- **SVG fuera del DOM de Next** (favicon `.svg`, OG estático, correos): la fuente NO viaja → esos usos
  emplean la **solo-mira (b)/(d)** (sin texto) o un **raster exportado** del lockup. Cuando el humano
  suba el arte original, es deseable una versión del wordmark **convertida a paths** (outline) para usos
  standalone — anotado en §17.5.

### 17.2 Paleta del rebrand — el rojo TCG HUNT sustituye al bermellón

**Decisión (recomendada por ux-ui, criterio: un solo acento, §2.1):** se **conserva íntegra la base
editorial** papel/tinta/verde (`#F4F1EA`, `#EFEBE2`, `#1A1A18`, `#6E695E`, `#4E7A49`, `#9A6C57`) y el
**bermellón `#B44B3A` se retira: NO convive** con el rojo nuevo. Dos rojos cálidos casi iguales en una
paleta de "un solo acento usado con avaricia" serían ruido sin significado; el rojo TCG HUNT `#B31217`
**hereda todos los roles** del bermellón (accent, warning, danger, anillo de foco). Ventajas: cero tokens
semánticos nuevos que aprender, el cambio en frontend es **cambiar valores de CSS variables**, y el
contraste sobre papel **mejora** (6.2:1 vs 4.65:1). La filosofía de §2 no cambia una coma: solo cambia la
tinta del sello.

**Tokens que cambian de VALOR (mismo nombre):**
| Token | Antes (v1.3) | v1.7 |
|---|---|---|
| `--color-accent` | `#B44B3A` | **`#B31217`** (rojo TCG HUNT) |
| `--color-warning` | `#B44B3A` | **`#B31217`** |
| `--color-danger` | `#B44B3A` | **`#B31217`** |
| `--color-focus-ring` | `#B44B3A` | **`#B31217`** |
| `--vermillion` (base) | `#B44B3A` | se renombra **`--hunt-red: #B31217`** (alias `--vermillion` puede quedar apuntando al nuevo valor durante la transición) |

**Tokens NUEVOS de marca (uso restringido al logo y a la marca):**
```
--hunt-red:        #B31217   (acento de marca = nuevo valor de --color-accent)
--hunt-wine:       #4A0D0D   (extremo oscuro del degradado; texto de marca ".mx"; NO es token semántico)
--hunt-wine-up:    #6E1013   (extremo claro de la rampa corta del wordmark, §17.1a; solo marca)
--hunt-red-hover:  #8F0E12   (hover de botones accent / enlaces en accent; 8.3:1 sobre papel)
--hunt-red-up:     #F0685F   (extremo claro del degradado en variante oscura)
--hunt-red-deep:   #D0362C   (extremo oscuro del degradado en variante oscura)
--hunt-tint:       rgba(179,18,23,0.06)  (único tinte de fondo de marca permitido — ver regla abajo)
```
- **`--hunt-tint`** existe SOLO para el fondo del shelf «Top Bounties» (§16.7c) y piezas de marca
  (OG/correo) si el frontend lo necesita; **no** rompe la regla "sin rellenos de color en estados"
  (§2.1): los `*-bg` semánticos **siguen `transparent`**. Si no se usa, mejor.
- **El degradado `#B31217→#4A0D0D` es la SEGUNDA y última excepción de gradiente** del sistema (la
  primera: banda reverse §16.6). Vive **exclusivamente** en el logo/lockup. Nunca en botones, fondos,
  textos de UI ni bordes. La banda reverse de §16.6 pasa a `#9A6C57 → var(--color-accent)` (=`#B31217`)
  — misma regla, hereda el valor por token.
- **Guiño de marca (§5) actualizado:** la **mira** sustituye al "rayo/holo" como guiño permitido
  (logotipo, hero, textura sutil en banners de confianza). Mismo límite: nunca compite con la carta.
- **Semántica sin cambios:** verde = confirmado, rojo = atención (warning y danger se siguen
  distinguiendo por el **texto en versalitas**, §2.4). El rojo TCG HUNT es más saturado que el bermellón;
  la regla "usado con avaricia" es aún más importante — no ampliar su superficie de uso.

**Verificación de contraste WCAG AA (se añade a la tabla de §10):**
| Par | Ratio aprox. | Cumple |
|---|---|---|
| Rojo TCG HUNT `#B31217` sobre papel `#F4F1EA` (texto/badge/foco) | ~6.2:1 | AA (mejora vs bermellón 4.65:1) |
| `#B31217` sobre pozo `#EFEBE2` | ~5.9:1 | AA |
| Papel `#F4F1EA` sobre `#B31217` (botón accent) | ~6.2:1 | AA |
| Hover `#8F0E12` sobre papel | ~8.3:1 | AA/AAA |
| Vino `#4A0D0D` sobre papel (".mx", extremo del degradado) | ~13.8:1 | AA/AAA |
| Vino claro `#6E1013` sobre papel (extremo claro del wordmark, §17.1a) | ~10.6:1 | AA/AAA |
| Anillo de foco `#B31217` sobre papel / pozo | ~6.2:1 / ~5.9:1 | AA (≥3:1 UI) |
| `#B31217` sobre tinta `#1A1A18` | ~2.5:1 | ✗ **PROHIBIDO** → usar variante oscura |
| `#F0685F` sobre tinta (variante oscura, extremo claro) | ~5.7:1 | AA (gráfico/texto grande) |
| `#D0362C` sobre tinta (variante oscura, extremo oscuro) | ~3.5:1 | AA UI (≥3:1; es trazo de logo, no texto) |
| Wordmark papel `#F4F1EA` sobre tinta (variante oscura) | ~15.5:1 | AA/AAA |
- El **degradado claro** del lockup (a): la retícula (diagonal `#B31217→#4A0D0D`) va de 6.2:1 a 13.8:1
  sobre papel y el wordmark (rampa corta `#6E1013→#4A0D0D`) de ~10.6:1 a 13.8:1 — **todo el recorrido
  ≥ AA** (texto grande ≥ 3:1 sobra; también cumple 4.5:1 de texto normal).
- Ratificación §10: cualquier estado que hoy usa bermellón (PENDIENTE, RECHAZADA, precio pendiente,
  QUEDAN N…) **sube** de contraste al heredar `#B31217`; no hay regresiones.

### 17.3 Aplicación de marca

| Superficie | Qué va | Detalle |
|---|---|---|
| **Topbar storefront** (§7.15) | ≥`md`: lockup horizontal = solo-mira (b) 28px + "TCG HUNT" en `--font-brand` 700, 18–20px, **tinta sólida** `#1A1A18` (a tamaño topbar el wordmark no usa degradado; ver reglas). `<md`: **solo-mira 28px** (área táctil 44px). | El ".mx" NO va en topbar (ruido); vive en lockup completo y footer. Enlace a home con `aria-label="TCG HUNT — inicio"`. |
| **Topbar/sidebar admin** (panel de tinta) | Solo-mira **variante oscura** 28px + "TCG HUNT" en papel `#F4F1EA` (`--font-brand` 700, 14–16px). | El back-office comparte marca; sin ".mx". *(v1.7.1: sube de 24→28px — por debajo de 28px los huecos de los anillos no leen, ver tamaños mínimos.)* |
| **Favicon** | **Glifo micro (d)** en `#B31217` sólido, fondo transparente (`icon.svg`); PNG 16/32 derivados. **Apple-touch 180px:** solo-mira (b) con degradado sobre fondo papel `#F4F1EA`, margen = 12% del lienzo. | A 16px el gradiente y el doble anillo no leen: micro glifo obligatorio. |
| **OG image** (1200×630) | Fondo papel `#F4F1EA`; **lockup completo (a)** centrado (~60% del ancho, la horizontal de la mira respirando a ambos lados); abajo-derecha `tcghunt.mx` en mono `JetBrains Mono` 24px `#6E695E`. Nada más — sin fotos, sin cartas, sin degradados de fondo. | Composición estática exportada (el SVG con `<text>` no garantiza la fuente fuera del DOM: exportar a PNG con la fuente resuelta, §17.1e). |
| **Correos** (§15.8) | Header: lockup completo (a) como **PNG @2x** (~360px de ancho visual) sobre fondo papel, regla inferior 1px `--color-border`. Remitente visible: **"TCG HUNT"**. | El SVG no es fiable en clientes de correo → raster. Alt: `TCG HUNT — tcghunt.mx`. |
| **Login / auth** (§6.7, hero de tinta) | El hero del panel de tinta usa el **lockup variante oscura (c)**, centrado, ancho ~280–360px. En la columna del formulario (papel) puede repetirse la solo-mira (b) pequeña como sello. | Primera pantalla donde la marca nueva "se estrena": el degradado completo luce aquí. |
| **Footer legal** (storefront) | `TCG HUNT · tcghunt.mx · © 2026 [RAZÓN SOCIAL PENDIENTE — placeholder]` en mono `text-xs muted` + enlaces legales. | La razón social y si los textos legales cambian está **abierto con el humano** (P-21); el frontend deja la clave i18n `footer.legalEntity` con placeholder. |
| **Vitrina Top Bounties** (§16.7c) | El chip `☩ BOUNTY` y el badge admin usan el **glifo micro (d)**. El eyebrow `SE BUSCA` + la mira ahora son lenguaje de marca oficial ("cacería"). | Opcional: fondo del shelf en `--hunt-tint` (único uso permitido del tinte). |

**Reglas de uso (qué sí / qué no):**
- **Tamaños mínimos (v1.7.1):** lockup completo **160px** de ancho (por debajo, el ".mx", los huecos de
  los anillos y el punto anillado se pierden → usar solo-mira); solo-mira (b) **28px** (por debajo, los
  gaps de 16°/28° miden < 1px y la retícula se lee como anillos cerrados — se pierde la firma); por
  debajo de **28px**, siempre el glifo micro (d), que ya trae esa simplificación hecha.
- **Área de respeto:** alrededor de cualquier versión, espacio libre = **radio del anillo interior** de
  esa instancia (≈ 0.6× del radio exterior). La zona se mide desde el **bounding box completo**, es
  decir **incluyendo las líneas sobresalientes** de la cruz (la superior y la izquierda sobresalen más).
  Nada de texto, bordes ni iconos dentro de esa zona.
- **Wordmark con degradado** solo a tamaño de marca (cap height ≥ 18px: hero, login, OG, correo). En
  topbar y tamaños de UI, wordmark en **sólido** (tinta sobre papel; papel sobre tinta).
- **NO:** recolorear fuera de las variantes definidas (claro/oscuro/micro `currentColor`); no usar el
  degradado claro sobre fondos oscuros (2.5:1, tabla §17.2) ni el oscuro sobre papel; no montar el logo
  sobre el **arte de las cartas** (la carta es el héroe, §5); no rotar la mira (la cruz siempre
  ortogonal); no rellenar los anillos; **no cerrar los huecos de los anillos ni unir los segmentos de la
  cruz en una línea corrida** (salvo la simplificación de anillo del glifo micro, §17.1d — la cruz
  segmentada no se une NUNCA, en ningún tamaño); no añadir sombras/relieve (§4.3); no animar la mira como spinner
  (se confundiría con un estado de carga, §8.1); no reconstruir el wordmark en Zen Old Mincho ni en
  Archivo cuando `--font-brand` esté disponible; no estirar/condensar.
- El logo **no sustituye texto accesible**: donde el lockup sea el único contenido de un enlace, el
  `aria-label` porta "TCG HUNT" (+ destino). Las versiones decorativas (badge, guiños) van `aria-hidden`.

### 17.4 Copy de transición — cómo se nombra el sitio

- **Nombre de marca:** **"TCG HUNT"** — siempre en mayúsculas, con espacio, sin guion. Nunca "TcgHunt",
  "Tcg Hunt" ni "TCGHUNT". En prosa ES/EN se usa igual (no se traduce).
- **Dominio en textos:** **"tcghunt.mx"** en minúsculas (mono cuando aparece como dato: footer, correos).
  El lockup usa ".mx" como elemento gráfico; en prosa se escribe el dominio completo.
- **Metadata/SEO:** `<title>` patrón `TCG HUNT — {página}`; `og:site_name: "TCG HUNT"`. Claves i18n
  nuevas: `brand.name` ("TCG HUNT"), `brand.domain` ("tcghunt.mx"), `footer.legalEntity` (placeholder).
  Todas las apariciones actuales de "TCG VAULT MX" en `messages/{es,en}.json`, correos y PDFs/folios que
  nombren la marca migran a "TCG HUNT" (frontend y backend en sus rutas).
- **"Bóveda" no cambia:** *vault/bóveda* sigue siendo el nombre de la **función** de custodia ("Mi
  bóveda", `Vault`), no de la marca. El rebrand no renombra la feature.
- **El nombre interno NO cambia:** el repo/carpeta `tcg-vault-mx`, los paquetes, módulos
  (`backend/src/modules/vault`), rutas técnicas del contrato y la infra conservan su nombre. El rebrand
  es de **marca visible** (UI, correos, metadata, dominio), no de código. Renombrar el repo/infra es una
  decisión aparte del humano (registrada como abierta en `PENDIENTES.md` P-21).

### 17.5 Notas para otros roles (derivadas del diseño, no bloquean)

1. **Cotejo con el PNG original (humano → frontend):** cuando el PNG llegue a
   `frontend/public/branding/`, comparar lado a lado con §17.1a y ajustar en el SVG solo métricas finas
   (grosor de trazo, longitud de sobresalientes, **gaps angulares de los anillos**, claro alrededor del
   punto, tracking). Si difiere la geometría de fondo, ux-ui actualiza esta sección primero. *(v1.7.1:
   primer cotejo del humano ya aplicado — cruz segmentada, anillos con huecos, wordmark dominante.)*
2. **Wordmark en paths (deseable):** para favicon/OG/correo conviene una versión del lockup con el
   texto convertido a **outlines** (sin dependencia de fuente). Puede generarse desde este SVG con la
   fuente instalada; frontend la guarda junto al componente.
3. **Razón social / textos legales:** pendiente de confirmación del humano (¿cambia la entidad legal o
   solo la marca comercial?). Mientras: placeholder `footer.legalEntity`.
4. **Redirects y dominio** (`tcgvaultmx.com` → `tcghunt.mx`, DNS, CORS, Stripe): alcance de devops según
   P-21; sin impacto en este documento.
5. **§10:** la tabla de contraste de §17.2 se considera extensión normativa de §10; al implementarse el
   cambio de tokens, los pares de bermellón de §10 quedan sustituidos por los de `#B31217` (todos con
   ratio igual o mejor).

---

## 18. Cotizador v2 — Stream C (P-14 + P-16, v1.8)

> Fuente funcional: `PENDIENTES.md` P-14 y P-16 (pedido del humano, ya decidido). Pantalla:
> `/buylist` (`BuylistView.tsx`, storefront). Esta sección define SOLO layout y lenguaje visual:
> **no cambia el contrato** (todo el dato ya existe: `availableFinishes`, `finish` en cada línea,
> `POST /buylist/quote/batch`, `GET /buylist/bounties`) y **no introduce tokens nuevos**. Reutiliza
> §16.6 (`FinishMark`), §16.7c (Top Bounties), §17 (identidad TCG HUNT) y §7/§8 (componentes y
> patrones base).

### 18.0 Principios de esta pantalla

1. **La carta es la protagonista, con el tamaño del binder.** El diagnóstico de P-16 no es "imagen
   chica": es que el **carrito lateral fijo (360px) le come el ancho a la grilla**. La solución es de
   layout: el carrito deja de ser columna y pasa a **drawer flotante**; la grilla ocupa el 100% del
   ancho útil y usa la MISMA densidad que el binder de M1 (donde las cartas "se ven cómodas").
2. **Un solo lenguaje de variante en toda la app (P-14).** El distintivo Normal vs. Reverse Holo es el
   `FinishMark` de §16.6 **tal cual está implementado en inventario**
   (`frontend/src/components/domain/FinishMark.tsx`): banda de 3px + etiqueta mono. El cotizador NO
   inventa un tratamiento propio (ni fondo tenue, ni chip nuevo): **mismo componente, mismos tokens**.
   Cualquier evolución futura se hace en ese componente y aplica a admin y storefront a la vez.
3. **Dinero honesto, igual que siempre:** sin cotización = «Precio pendiente» / «—», **nunca MX$0.00**
   (§7.3); el monto lo deriva SIEMPRE el servidor (SEC-A1); el total del carrito con líneas pendientes
   explica lo que no suma.

### 18.1 Anatomía de la página (redistribución P-16)

Orden vertical de `/buylist` (el contenido no cambia; cambia la distribución del ancho):

1. **Header de página** (sin cambios): `h1` serif + subtítulo + nota PAY_AFTER_RECEIPT + enlace guía
   de envío.
2. **`TopBountiesShelf`** (§16.7c, sin cambios): arriba, antes del selector de set. Único lugar con
   `--hunt-tint` permitido.
3. **Barra de filtros, adelgazada:** al quitar el toggle textual del carrito (`Ocultar/Ver carrito`,
   sustituido por el FAB §18.4), la barra queda:
   - En `raw` (default): SOLO el `Select` de tipo de producto — el binder Master Set (mode="quoter")
     trae su propio «Buscar set» (índice) y, dentro del set, «Buscar carta» + filtro de acabado.
   - En `graded`/`sealed`: `Select` de set + búsqueda + `Select` de tipo (como hoy).
4. **Grilla a TODO el ancho** (§18.2): desaparece el `lg:grid-cols-[minmax(0,1fr)_360px]`; `<main>`
   es la única columna. **Padding inferior `pb-24` mínimo** en `<main>` para que el FAB nunca tape la
   última fila de tejas.
5. **Carrito = drawer flotante + FAB** (§18.4): overlay, no columna. El resto de la página (política
   NM-only, copy de confianza, «Mis solicitudes») no cambia.

**Dentro del set (quoter):** la fila de filtros locales del binder («Buscar carta» + acabado) se
vuelve **sticky** en `≥ lg` (fondo papel `--color-bg`, `border-b border-border`, `z` por debajo del
drawer): en sets de 200+ tejas grandes el usuario no debe scrollear de vuelta para filtrar. En
`< lg` scroll natural (el sticky + teclado móvil estorban más de lo que ayudan).
**Offset (corrección v1.8.2, TL-C1):** NO `top-0` — el `StorefrontHeader` es sticky opaco y lo
taparía. La barra se ancla con `lg:top-[var(--app-header-h,0px)]`, la variable de layout que el
shell expone con su altura real (contrato y reglas en **§4.5**; alturas hardcodeadas prohibidas).

### 18.2 Grilla y tamaño de teja (breakpoints)

**Regla: paridad exacta con el binder de inventario.** La retícula del quoter usa las mismas clases
que `MasterSetBinder` (que ya comparte — hoy el problema era solo el ancho disponible):

| Breakpoint | Columnas | Gap | Ancho de teja aprox. (contenedor lleno) |
|---|---|---|---|
| base (`< 640`) | 2 | `gap-x-6 gap-y-8` (24/32px) | ~150–170px |
| `sm ≥ 640` | 3 | idem | ~180–200px |
| `lg ≥ 1024` | 4 | idem | ~210–230px |
| `xl ≥ 1280` | 5 | idem | **~205–230px** (objetivo: ≥ 200px) |

- **No se añade columna en `2xl`** (mantener paridad con M1: la teja grande ES el objetivo, no meter
  más columnas). El grid plano de `graded`/`sealed` **se alinea a esta misma escala** (hoy llega a
  `2xl:grid-cols-6` con tejas chicas: se retira el `2xl:6` y el `md:4/xl:5` pasa a `lg:4/xl:5`).
- **Imagen:** `CardImage` (5:7, `object-contain`) a ancho completo de la teja — con la columna del
  carrito retirada, la imagen crece ~40% de área vs. hoy sin ningún cambio del componente.
- **Jerarquía dentro de la teja quoter** (de arriba a abajo, ver §18.3): banda `FinishBand` →
  arte → nombre (serif 15px, `lang="en"`) → `#número · ACABADO` (mono 10px, el acabado en
  `--color-text`) → **precio estimado como héroe secundario: sube de 13px a `text-[15px]`** mono
  `tabular-nums` en tinta (NO verde: el verde "pagamos" queda exclusivo del `BountyCard` §16.7c —
  aquí es un estimado, no una promesa destacada) → botón `Agregar` (`secondary`, `size="sm"`,
  full-width, anclado abajo con `mt-auto`).
- **«Cargar más»** del binder quoter: sin cambios (paginación interna hasta completar el set).

### 18.3 Distintivo de variante en la teja del cotizador (P-14)

**La teja del quoter adopta el `FinishMark` de §16.6 EXACTAMENTE como la teja del binder M1** (hoy el
`QuoterTile` no pinta la banda — esa es la brecha a cerrar):

1. **`FinishBand` arriba de la teja** (primer elemento, encima del arte), idéntica a `BinderTile`:
   - `normal` → sin banda (borde base).
   - `reverse_holo` → gradiente 90° `--color-neutral-warm → --color-accent` (`#9A6C57 → #B31217`).
   - `holofoil` / `first_edition_holofoil` → sólida tinta `#1A1A18`.
   La banda es decorativa (`aria-hidden`); **nunca banda sin texto**.
2. **La etiqueta textual** ya existe en el `TileHeader` compartido (`#4 · REVERSE HOLO`, mono 10px
   versalitas con el acabado en `--color-text`): es el canal portador (§2.4). No se duplica etiqueta:
   banda (canal color) + renglón del header (canal texto) = el mismo doble canal de §16.6.
3. **Prohibido** inventar tratamientos alternativos aquí: ni fondo tenue por acabado (rompería
   «sin rellenos de color en estados», §2.1), ni efecto foil animado, ni recolorear el arte. Si algún
   día se aprueba un efecto foil, se decide en `FinishMark` y aplica a TODAS las superficies (§16.11.3).
4. `aria-label` del botón `Agregar` (ya existente) sigue portando el acabado legible localizado:
   `Agregar Pikachu ex, reverse holo, MX$ 45.00`.
5. En `graded`/`sealed` no hay banda (cotizan siempre `normal` → §16.6: sin banda), coherente sin
   casos especiales.

### 18.4 Carrito flotante: `SellCartFab` + `SellCartDrawer` (P-16)

**El carrito deja de ser columna.** Contenido interno del carrito (requisitos de venta, líneas,
total, CTAs, «Vaciar») **sin cambios funcionales**; solo cambia el contenedor y las líneas ganan el
`FinishMark` (§18.5).

**(a) `SellCartFab` — disparador flotante:**
- `position: fixed`, esquina inferior derecha: `right: 20px; bottom: calc(20px +
  env(safe-area-inset-bottom))`. **56×56px** (≥ 44px táctil, §8.2), **radio 0** (§4.2), **sin
  sombra** (§4.3): fondo **tinta** `--color-ink`, icono `shopping-cart` de lucide 20px en papel
  `--color-on-ink` (contraste ~15:1), `border: 1px solid var(--color-border-strong)`.
- **Contador:** badge cuadrado sobrepuesto en la esquina superior derecha del FAB (min 20×20px),
  fondo `--color-accent` `#B31217`, cifra mono `tabular-nums` 11px en papel (6.2:1, AA §17.2); cap
  visual `99+`. Con carrito vacío el badge **se omite** (el FAB permanece: da acceso al panel de
  requisitos de venta).
- **Accesibilidad:** es un `<button>` con `aria-haspopup="dialog"`, `aria-expanded`, y `aria-label`
  dinámico: `Carrito de venta, {count} carta(s)` / `Carrito de venta, vacío` (el badge numérico es
  `aria-hidden`; la cifra viaja en el label). Foco visible obligatorio (anillo `--color-focus-ring`).
  > **Ratificado v1.8.1 (2026-08-21, QA-C1):** el formato es **`carta(s)`**, NO el plural natural
  > ICU («3 cartas») que ejemplificaba v1.8. Motivo: el catálogo i18n del proyecto no usa plural
  > ICU (el helper de E2E no lo resuelve y `cartCount` ya usa este estilo); exigir ICU solo para
  > esta cadena —que además es aria, invisible en pantalla— sería desproporcionado. Un lector de
  > pantalla lee «tres carta ese» o similar de forma perfectamente comprensible.
- **Feedback al agregar:** SIN animación (una mira/pulso animado se confunde con carga, §17.3). El
  contador cambia y el renglón `role="status"` existente (`addedLine`: «Agregada: … · Reverse Holo»)
  anuncia a lectores de pantalla. Agregar desde la grilla **NO abre el drawer** (no interrumpe el
  flujo de seguir cotizando); la excepción existente del CTA de `BountyCard` (intención explícita de
  vender ESA carta) sí lo abre, como hoy.

**(b) `SellCartDrawer` — el contenedor:**
- `≥ lg`: **sheet lateral derecho de 400px** (min 360 / max 440), alto completo, fondo papel,
  `border-l border-border-strong`, **overlay de tinta** (mismo scrim del Modal §7.6) sobre el resto;
  la grilla queda visible detrás (contexto). `< lg`: **bottom sheet** a casi pantalla completa
  (~92vh), mismo patrón del `VariantDrawer` §16.4.
- **Semántica de diálogo completa:** `role="dialog"`, `aria-modal="true"`,
  `aria-label="Carrito de venta (N)"`, **focus trap**, `Esc` cierra, clic en overlay cierra, botón
  cerrar (44px) arriba a la derecha; al cerrar, **el foco regresa al FAB**. Orden de tabulación
  interno: cerrar → requisitos → líneas → total → CTA enviar → vaciar.
- **Contenido (orden vertical, igual que hoy):** encabezado eyebrow `CARRITO DE VENTA` + conteo →
  `SellRequirementsPanel` → líneas (§18.5) → total estimado (+ nota de pendientes + nota de vigencia)
  → CTA `Enviar solicitud (N)` (accent) o CTAs de login/registro sin sesión → `Vaciar carrito`.
- Al **enviar con éxito**: el drawer se cierra, el `role="status"` de confirmación existente se
  muestra en página y el FAB vuelve a estado vacío.
- El drawer va **por encima** de la barra sticky de filtros y del FAB (z-index); nunca dos overlays a
  la vez (abrir el modal de solicitud cierra el drawer o se apila según el patrón de `Modal` actual —
  a criterio de frontend, pero solo un focus trap activo).

### 18.5 Distintivo de variante en las líneas del carrito (P-14)

Cada línea del carrito debe decir **de un vistazo** qué variante es, no solo con texto perdido en la
metadata:

- En la fila de metadata de la línea (`Estimado: MX$ 45.00 · ... · ×2`), el acabado en texto plano se
  sustituye por **`<FinishMark finish={l.finish} />`** (banda 3px + etiqueta mono `REVERSE`/`HOLO`/
  `NORMAL`, §16.6) alineado a la línea base de la fila. Es el MISMO componente compartido; cero
  markup nuevo. `normal` renderiza solo la etiqueta muted (sin banda), por lo que el ojo detecta las
  reverse/holo por la banda de color al escanear la lista.
- El `aria-label`/`title` del `FinishMark` ya porta el nombre legible localizado («reverse holo»).
- **Mismo tratamiento en el resumen del modal de solicitud** (la lista «qué cartas, cuánto» previa a
  confirmar): cada renglón usa `FinishMark` en lugar del texto `· Reverse Holo`. La decisión de venta
  se confirma viendo la variante con el mismo lenguaje con que se eligió.
- Recordatorio de identidad de línea (sin cambios): (cardId + productType + finish) — dos acabados de
  la misma carta son dos líneas, y ahora se distinguen visualmente entre sí.

### 18.6 Estados (obligatorios, §8.1)

| Estado | Tratamiento |
|---|---|
| **Cargando grilla** | Skeletons con la MISMA retícula final (§18.2): tejas 5:7 (imagen + 2 líneas + botón), 8–10 piezas. Sin spinners de página. **Ratificado v1.8.1 (2026-08-21, QA-C2):** este skeleton aplica a **TODOS los modos del binder** (quoter, inventario M1 §16 y bóvedas), no solo al quoter: la retícula es compartida, el skeleton honesto con el layout final es mejor patrón que un spinner en cualquiera de los modos, y mantener un solo código de carga evita divergencias. Ningún modo del binder usa spinner de página. |
| **Cargando estimados** (batch) | La teja se pinta completa con el precio en `…` muted y `Agregar` deshabilitado (como hoy); nunca bloquear la grilla entera por el batch. |
| **Sin set elegido** (raw) | El índice de sets del binder (ya existente) ES el estado inicial — no hay estado vacío artificial. |
| **Sin resultados** (búsqueda local o graded/sealed) | `EmptyState` (§8.1) con el copy existente. |
| **Precio pendiente** | Cifra `Precio pendiente` en accent en la teja (nunca `MX$ 0.00`); en carrito/total, el patrón honesto existente («—»/nota de pendientes). Ratifica §7.3. |
| **Error del batch de estimados** | Aviso inline con `Reintentar` sobre la grilla (patrón actual); las tejas quedan con `Agregar` deshabilitado, la grilla no se tumba. |
| **Error de carga de la grilla** | `QueryState` con reintento (patrón actual). |
| **Carrito vacío** | Drawer abre con `SellRequirementsPanel` + copy `cartEmpty` (el drawer vacío es útil: dice qué necesitas para vender). FAB sin badge. |

### 18.7 Coherencia de marca TCG HUNT (§17)

- **Cero tokens nuevos:** todo el rojo de esta pantalla es `--color-accent` (`#B31217`) heredado por
  token; la banda reverse ya lo hereda (§17.2). El FAB usa tinta/papel (la marca "usa el rojo con
  avaricia": el rojo queda para el badge contador, estados de atención y el badge BOUNTY).
- **Top Bounties** conserva su lenguaje (§16.7c + §17.3): chip `☩ BOUNTY` con `HuntMarkMicro`,
  precio «Pagamos» en verde, fondo `--hunt-tint` opcional. La grilla del cotizador NO adopta el
  tinte ni el glifo de mira: la jerarquía es shelf (cacería, destacado) > grilla (catálogo neutro).
- **Sin gradientes nuevos:** las dos únicas excepciones siguen siendo la banda reverse (§16.6) y el
  logo (§17.2). El FAB, el drawer y las tejas no llevan degradado.

### 18.8 Accesibilidad (además de §8.2)

- **Contraste (pares ya verificados, sin pares nuevos):** banda reverse sobre papel ≥ 4.0:1 (≥ 3:1
  UI, §16.6); accent `#B31217` sobre papel 6.2:1; FAB tinta/papel ~15:1; badge contador
  papel-sobre-accent 6.2:1 (§17.2). Nada que re-verificar en §10.
- **Targets:** FAB 56px; cerrar drawer 44px; steppers de cantidad del carrito conservan sus targets;
  el botón `Agregar` de la teja es full-width (≥ 44px de alto con `size="sm"` + padding — verificar
  en implementación; si `sm` queda < 44px de alto en táctil, subir a `min-h-[44px]`).
- **Aria del drawer:** ver §18.4b (dialog + trap + Esc + retorno de foco al FAB). El FAB anuncia
  estado por `aria-label` + `aria-expanded`; las adiciones se anuncian por el `role="status"`
  existente (no por el badge).
- **Doble canal de variante en TODA superficie:** nunca banda sin etiqueta (teja, carrito, resumen).
  El color jamás es el único diferenciador entre Normal y Reverse (§2.4, §16.6).
- **Orden de foco de la página:** header → bounties → filtros → grilla (tejas en orden de lectura) →
  secciones de confianza → «Mis solicitudes». El FAB, al ser `fixed` al final del DOM, debe quedar
  en el flujo de tabulación DESPUÉS del contenido principal o inmediatamente tras la barra de
  filtros — elegir UNA posición de DOM y mantenerla; no `tabindex` positivos.

### 18.9 Componentes: qué se comparte con inventario y qué es nuevo (para NO duplicar)

**Se REUTILIZAN tal cual (cero forks, cero copias):**

| Componente | Ruta | Uso en cotizador |
|---|---|---|
| `FinishMark` / `FinishBand` | `components/domain/FinishMark.tsx` | Banda en `QuoterTile` (§18.3) + marca en líneas de carrito y resumen del modal (§18.5). **El componente NO se toca.** |
| `MasterSetPanel` / `MasterSetBinder` (mode="quoter") + `TileHeader` | `components/master-set/` | La grilla misma; ya compartidos con M1. El cambio de §18.3 (añadir `FinishBand` al `QuoterTile`) vive DENTRO de `MasterSetBinder.tsx`, beneficiando solo al modo quoter (el `BinderTile` ya la tiene). |
| `CardImage` | `components/ui/CardImage.tsx` | Arte 5:7 de la teja (crece sola con la teja). |
| `TopBountiesShelf` / `BountyCard` | `components/domain/TopBountiesShelf.tsx` | Sin cambios (§16.7c). |
| `SellRequirementsPanel`, `BuylistKycForm`, `Button`, `Modal`, `EmptyState`, `QueryState`, `Skeleton`, `Input`, `Select` | varios | Sin cambios. |
| `HuntMarkMicro` | `components/domain/LogoTcgHunt.tsx` | Solo donde ya está (badge BOUNTY). |

**NUEVO en Stream C (frontend los crea):**

| Componente | Qué es |
|---|---|
| `SellCartFab` | Botón flotante fijo con contador (§18.4a). |
| `SellCartDrawer` | Contenedor drawer/bottom-sheet del carrito (§18.4b) — **envuelve** el contenido actual del `<aside>`, no lo reescribe. |

**Se MODIFICAN (sin cambiar su API pública):** `QuoterTile` (añade `FinishBand` + precio a 15px),
`BuylistView` (layout de una columna + monta FAB/drawer + `FinishMark` en líneas/resumen), grid plano
de graded/sealed (densidad §18.2). **Nada de esto toca contrato ni backend.**

### 18.10 i18n — claves nuevas (propiedad de frontend)

- `buylist.cartFab.{ariaWithCount,ariaEmpty}` — «Carrito de venta, {count} carta(s)» / «…, vacío»
  (formato `carta(s)` ratificado v1.8.1, ver §18.4a: convención del catálogo sin plural ICU).
- `buylist.cartDrawer.{ariaLabel,close}`.
- Se retiran del uso `buylist.cartHide` / `buylist.cartShow` (el toggle textual desaparece).
- Todo lo demás (etiquetas `finish.*` de §16.10, `quoterPending`, `addedLine`, copys del carrito) se
  reutiliza sin cambios. Recordatorio §9.4: `Carrito de venta, {count} carta(s)` en ES es la cadena
  larga del `aria-label`; no trunca nada visible (es aria).

### 18.11 Notas para otros roles (no bloquean el diseño)

1. **Sin solicitudes de contrato:** P-14/P-16 son 100% visuales/layout; ningún dato nuevo. (La nota
   §16.11.2 — precarga del cotizador desde `BountyCard` — ya quedó resuelta en Stream B vía el quote
   directo al carrito.)
2. **Bounty en la teja del quoter (deseable, NO requerido):** hoy la grilla del cotizador no sabe si
   una variante es bounty (el dato público vive solo en `GET /buylist/bounties`). Si algún día el
   quote público expone `source:"bounty"`, la teja podría ganar el badge `☩ BOUNTY` (§16.7b) y el
   precio en verde. Se registra como idea para product-owner/arquitecto; el diseño actual NO lo asume.
3. **QA visual sugerido:** verificar en 1280px (xl) que la teja quede ≥ 200px de ancho con el drawer
   cerrado, y que el FAB no tape la última fila (padding §18.1.4); smoke E2E de los flujos tocados:
   agregar desde teja → badge del FAB incrementa → drawer muestra la línea con su `FinishMark` →
   enviar solicitud sigue funcionando igual.

---

## 19. Reorganización del panel M2 — catálogo/precios (v1.9)

> Pantalla: `/admin/m2` (`frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx`, super_admin).
> Esta sección define SOLO **jerarquía, agrupación, etiquetas/microcopy, estados, confirmaciones y
> accesibilidad** de las **acciones de import/precio** del panel. **No cambia el contrato** (mismos
> endpoints, mismos DTOs), **no introduce tokens nuevos** (reusa §4.3 reglas+aire, §6.1 botones, §8
> patrones) y **no toca** los editores de reglas de precio (buylist §4, venta §5, spreads de sellado,
> FX, cola de precio pendiente) salvo para **anclar** ahí el nuevo «Unificar rarezas» (§19.5). Decisión
> del humano ya tomada: **limpieza «recomendada»**.

### 19.0 El problema (diagnóstico)

Hoy M2 apila **9 acciones de sync/import/precio** como botones `secondary` visualmente idénticos, sin
comunicar la distinción crítica para el operador: **qué funciona siempre** (TCGCSV / local, no dependen
de una fuente externa que se cae) vs. **qué depende de la fuente de catálogo** (pokemontcg.io, que puede
estar caída). El resultado es parálisis: ante «arreglar un set fantasma» el operador no sabe cuál de los
cuatro botones globales + tres por-set tocar. La reorganización cifra esa distinción en la **jerarquía
visual**.

**Mapa de las 9 acciones → código actual → destino v1.9:**

| # | Acción (hoy) | Handler en `M2View` | Fuente | Destino v1.9 |
|---|---|---|---|---|
| A | Actualizar precios ahora | `ingestMutation` (`priceIngest.trigger`) | TCGCSV prim. / PPT fallback | **Grupo 1 · Datos** — acción destacada (se queda arriba) |
| F | Refrescar variantes + precios de TODO (solo TCGCSV) | `refreshVariantsAllMutation` (`catalog.refreshVariantsAll`) | TCGCSV | **Grupo 1 · Datos** (global) |
| I | Variantes + precios (solo TCGCSV) por-set | `refreshVariantsMutation` (`catalog.refreshVariants`) | TCGCSV | **Grupo 1 · Datos** — acción **primaria por-fila** |
| D | Importar sets nuevos | `syncAllMutation` (`catalog.syncAll`) | pokemontcg.io | **Grupo 2 · Catálogo** (global) |
| G | Importar/Re-sincronizar por-set | `catalogSyncMutation` (`catalog.import`/`resync`) | pokemontcg.io | **Grupo 2 · Catálogo** — por-fila (secundaria) |
| C | Backfill (siguiente lote) | `backfillMutation` (`catalog.backfill`) | pokemontcg.io | **Grupo 2 · Catálogo** (global) |
| E | Re-sincronizar todo (forzar) | `syncAllForceMutation` (`catalog.syncAllForce`) | pokemontcg.io | **Grupo 3 · Avanzado** (colapsado) |
| H | Sync completo por-set | `fullSyncMutation` (`catalog.fullSync`) | pokemontcg.io + TCGCSV | **Grupo 3 · Avanzado** — overflow por-fila |
| B | Lanzar sync de precios (bóveda) | `syncMutation` (`sync.launch`) | legacy | **RETIRADO** (§19.6) |
| — | «Unificar rarezas» (NUEVO) | one-shot backfill `rarityCanonical` | local, sin red externa | **Anclado al editor de reglas por rareza** (§19.5) |
| — | `rarity-map` (muerto) | — | — | **RETIRADO** (§19.6) |

### 19.1 Jerarquía visual y layout de la zona de operaciones

La zona de operaciones de datos/catálogo se reordena en **tres bloques con peso decreciente**, separados
por **reglas** (líneas `--color-border`) y **aire**, no por cajas ni sombras (§4.3). El orden de lectura
es exactamente la escala de riesgo/frecuencia: lo seguro y frecuente arriba, lo peligroso y raro abajo y
oculto.

```
┌─ (se mantiene tal cual) ────────────────────────────────┐
│  h1  «Catálogo y precios»                               │
│  ▸ Actualizar precios ahora   [A · Button primary lg]   │  ← acción destacada, ya es primary
│    (progreso, avisos de límite diario…)                 │
├─ (editores de reglas de precio — SIN CAMBIOS de §19) ───┤
│  Cola precio pendiente · FX · Proveedor(§19.7) ·        │
│  Reglas buylist(+Unificar rarezas §19.5) · Reglas venta │
│  · Spreads de sellado                                    │
├─ GRUPO 1 · DATOS (rápido · TCGCSV) ─────────────────────┤  ← eyebrow + h2, borde superior
│  «Funcionan siempre; no dependen de fuentes externas»   │
│  [F · Refrescar variantes+precios de TODO] (secondary)  │
│  + tabla de sets (acción por-fila primaria = I)          │
├─ GRUPO 2 · CATÁLOGO (cartas nuevas · fuente de catálogo)┤  ← eyebrow + h2
│  ⚠ Banner: dependen de pokemontcg.io; si está caída…    │
│  [D · Importar sets nuevos] [C · Backfill] (secondary)   │
│  + acción por-fila secundaria en la misma tabla = G      │
├─ GRUPO 3 · AVANZADO  ▸ (colapsable, plegado) ───────────┤  ← <details> cerrado por defecto
│  [E · Re-sincronizar todo (forzar)]                      │
│  + overflow por-fila = H (Sync completo)                 │
└─────────────────────────────────────────────────────────┘
```

- **La acción destacada A no se toca:** sigue siendo el `Button` `primary` `lg` con `Zap` al tope del
  panel (§6.1). Es «lo que el operador hace a diario». Los grupos 1–3 viven **debajo** de los editores
  de precio, reemplazando la actual «Operaciones avanzadas» + «Sync de catálogo» + «Sync de bóveda».
- **Encabezado de grupo:** `eyebrow` mono (§3.2, `uppercase tracking-[0.18em]`) con el rótulo corto
  (`DATOS` / `CATÁLOGO` / `AVANZADO`) + `h2` serif con el título largo entre paréntesis, y un `text-sm
  muted` de una línea que explica la **garantía del grupo** (siempre funciona / depende de fuente / raro
  y pesado). El grupo se envuelve en `<section role="group" aria-labelledby>` para que el rótulo nombre
  al conjunto de botones.
- **Una sola tabla de sets, compartida por los grupos 1 y 2.** No se duplica la tabla: la fila de cada
  set expone sus acciones con jerarquía interna (§19.4). Los encabezados de grupo 1 y 2 preceden a la
  tabla; la tabla se ancla visualmente al grupo 1 (Datos) porque su acción **primaria por-fila es I**
  (la segura). G y H son secundaria/overflow en la misma fila.

### 19.2 Grupo 1 — «Datos (rápido · TCGCSV)» (destacado)

El grupo de mayor peso después de A. Comunica **confianza operativa**: estas acciones repueblan
variantes/acabados y precios desde **TCGCSV** y **no dependen de pokemontcg.io**, así que **funcionan
aunque la fuente de catálogo esté caída**. Es el camino recomendado para «arreglar un set fantasma»
(variantes/precios faltantes) sin bloquearse por una caída externa.

- **Rótulo:** eyebrow `DATOS` + h2 «Datos (rápido · TCGCSV)».
- **Subtítulo (microcopy, ES):** «Refrescan variantes, acabados y precios desde TCGCSV. **Funcionan
  siempre**, aunque la fuente de catálogo (pokemontcg.io) esté caída. Es lo que necesitas para reparar
  variantes o precios faltantes de un set ya importado.»
  **EN:** «Refresh variants, finishes and prices from TCGCSV. **Always work**, even if the catalog
  source (pokemontcg.io) is down. This is what you need to fix missing variants or prices on an already
  imported set.»
- **Acción global F** (`refreshVariantsAll`): `Button` `secondary` con `RefreshCw`. **Masiva →
  confirmación** (modal existente, §19.8). Barra de progreso `SyncProgress` (ya accesible, §8) debajo.
- **Acción por-fila I** (`refreshVariants`): es la **acción primaria de cada fila de set** (ver §19.4):
  primer botón, más a la vista. Requiere el set ya importado (si no, deshabilitado con motivo en
  `title`, como hoy: `SET_NOT_IMPORTED`).
- **Etiquetas cortas sugeridas** (el nombre largo satura): F → «Refrescar variantes + precios (todo)»,
  I → «Variantes + precios». El «(solo TCGCSV)» se mueve del botón al **subtítulo del grupo** (ya no
  hace falta repetirlo en cada botón: el grupo entero es TCGCSV).

### 19.3 Grupo 2 — «Catálogo (cartas nuevas · usa fuente de catálogo)»

Se **conserva** porque es el **único camino para crear cartas nuevas** (importar sets/cartas desde
pokemontcg.io), pero se de-enfatiza respecto al grupo 1 y se marca su dependencia externa de forma
inequívoca.

- **Rótulo:** eyebrow `CATÁLOGO` + h2 «Catálogo (cartas nuevas · usa fuente de catálogo)».
- **Aviso de dependencia (obligatorio):** `Banner` `variant="info"` **persistente** al inicio del grupo
  (no un error; es una advertencia de contexto). Microcopy ES: «Estas acciones traen **cartas nuevas**
  desde la fuente de catálogo (pokemontcg.io). Si la fuente está **caída o limitada**, pueden fallar o
  no traer nada — usa el grupo **Datos** para refrescar variantes y precios mientras tanto.» EN: «These
  actions import **new cards** from the catalog source (pokemontcg.io). If the source is **down or rate
  limited**, they may fail or import nothing — use the **Data** group to refresh variants and prices in
  the meantime.»
- **Degradación ante fuente caída (§8.1 error/vacío):** cuando una acción del grupo falla por fuente no
  disponible (hoy: 404/405 → `syncAllUnavailable`; timeouts/5xx → error real), el resultado se muestra
  como `Banner` `warning` **dentro del grupo** con copy que **reencamina al grupo Datos**
  («pokemontcg.io no respondió; los precios/variantes que sí puedes actualizar están en **Datos** ↑»).
  El `Banner` de error real (5xx/rate limit) mantiene su código/mensaje (§8.1). *La detección
  persistente «la fuente está caída» antes de intentar requiere una señal de salud del backend — ver
  §19.9, no bloqueante; hasta entonces la degradación es reactiva (al fallar).*
- **Acciones globales D y C:** `Button` `secondary`. D (`syncAll`, «Importar sets nuevos») con `Layers`;
  C (`backfill`, «Backfill (siguiente lote)») con `DownloadCloud`. Sin confirmación (no son
  destructivas: importan incrementos).
- **Acción por-fila G** (`catalogSync`, «Importar/Re-sincronizar»): **secundaria** en la fila (§19.4),
  después de I.

### 19.4 Acciones por-fila de la tabla de sets (jerarquía dentro de la fila)

La tabla de sets (`setColumns`) es **una sola** y sus tres acciones por-fila (I, G, H) se ordenan
reflejando los grupos, para que la fila «hable» la misma jerarquía que los bloques globales:

| Orden en la fila | Acción | Variante de botón | Grupo | Notas |
|---|---|---|---|---|
| 1.ª (primaria) | **I** «Variantes + precios» | `secondary` (peso visual alto: primera, con icono `RefreshCw`) | Datos | Deshabilitada si `!imported` (motivo en `title`). Es la reparación segura. |
| 2.ª | **G** «Importar / Re-sincronizar» | `secondary` (neutra) | Catálogo | Etiqueta según `imported`: «Importar» / «Re-sincronizar». |
| overflow | **H** «Sync completo» | dentro de menú **«Más ▾»** (o `ghost` con `aria-label`), rotulado como avanzado | Avanzado | Pesado y solapado con I; roto sin pokemontcg.io. Se saca del renglón principal para no invitar a usarlo por default. |

- **Por qué H a overflow y no a un `<details>` por fila:** una fila no puede colapsar cómodamente en una
  tabla densa; un **menú «Más»** por fila (patrón kebab, `aria-haspopup="menu"`, foco y flechas) esconde
  H sin romper la retícula y mantiene la promesa «Avanzado = plegado por defecto».
- **Serialización (sin cambios):** las tres acciones por-fila siguen serializadas entre sí y con los
  batches globales (`otherPerSetPending`, `batchBusy`); cualquiera en curso deshabilita las demás con el
  botón en `loading`. Ver §19.8.
- **Móvil (< md):** la fila colapsa a tarjeta apilada (patrón §16); I queda como botón full-width
  primario de la tarjeta, G debajo, H dentro del «Más».

### 19.5 «Unificar rarezas» — dónde va y microcopy

**Ubicación recomendada: anclado al editor de reglas de precio por rareza** (Sección 4 buylist /
Sección 5 venta), como una **acción de mantenimiento** en el encabezado de ese bloque — NO en el grupo
Datos.

- **Por qué ahí y no en Datos:** el «por qué» de esta acción solo se entiende **mirando la lista de
  rarezas fragmentada** del editor (varias filas que deberían ser una: «Rare Holo» / «rare holo» /
  variantes sin canonizar inflan el editor). El *information scent* correcto es colocar el remedio junto
  al síntoma. En el grupo Datos (sync masivo) el operador lo leería como «otro barrido» y no ataría su
  efecto —limpiar el editor— con la causa. Se **rechaza** la alternativa «grupo Datos» por eso, aunque
  técnicamente sea local/money-safe.
- **Forma:** botón `secondary` `sm` con icono `Layers`/`Wand` (decorativo, `aria-hidden`), rotulado
  **«Unificar rarezas»**, en la barra de encabezado del editor de reglas por rareza (junto al título de
  la Sección 4), con un `text-xs muted` de una línea al lado.
- **Confirmación (one-shot, money-safe):** modal ligero (§7.6) — no es destructivo pero **muta
  `rarityCanonical` en todo el catálogo**, así que se confirma para dejar claro el alcance.
- **Microcopy (ES):**
  - Botón: «Unificar rarezas»
  - Ayuda inline: «Agrupa las rarezas fragmentadas del catálogo en su forma canónica. **Acción única, no
    cambia precios.**»
  - Modal título: «Unificar rarezas del catálogo»
  - Modal cuerpo: «Reasigna la **rareza canónica** de todas las cartas para colapsar duplicados y
    variantes de escritura en una sola rareza. **Es una operación local de una sola pasada: no consulta
    fuentes externas y NO modifica ningún precio ni regla.** Después, el editor de reglas por rareza
    mostrará una fila por rareza real, sin duplicados.»
  - CTA: «Unificar rarezas» · Cancelar
  - Éxito (`Banner` success): «Rarezas unificadas. El editor ya refleja las rarezas canónicas.»
  - En curso: botón `loading` con label «Unificando…».
- **Microcopy (EN):** Button «Merge rarities» · Help «Groups fragmented catalog rarities into their
  canonical form. **One-time action, does not change prices.**» · Modal title «Merge catalog rarities» ·
  Body «Reassigns the **canonical rarity** of every card to collapse duplicates and spelling variants
  into a single rarity. **This is a local one-shot operation: it queries no external source and changes
  NO price or rule.** Afterwards the per-rarity rules editor shows one row per real rarity, without
  duplicates.» · CTA «Merge rarities» · Success «Rarities merged. The editor now reflects canonical
  rarities.»
- **Tras el éxito:** invalidar las queries del editor (`buylist-rarities`, `sales-rarities`) para que la
  lista se recomponga sin duplicados — el efecto visible que justifica el botón.

### 19.6 Retirados del panel

- **B «Lanzar sync de precios (bóveda)»** (`syncMutation` / `sync.launch`): **se elimina** la sección
  entera «Sync de precios de bóveda». Es legacy y redundante con **A** (que ya actualiza precios con
  TCGCSV primario). Retirar sus claves i18n `admin.m2.sync.*` (§19.10).
- **`rarity-map` (muerto):** desaparece cualquier resto del antiguo mapeo rareza→categoría/`rarityMap`
  del panel (superado por el editor de dos ejes v1.29). Retirar sus claves i18n si quedaran.
- Regla: al retirar B y `rarity-map`, **no** queda un hueco visual; los grupos 1–3 ocupan la zona que
  antes era «Operaciones avanzadas» + «Sync de bóveda» + «Sync de catálogo».

### 19.7 Selector de proveedor de precios — reencuadre

El `Select` actual (`priceProvider`, opciones `pokemontcg_io` / `pokemonpricetracker`) **da a entender
que la fuente de precios es pokemontcg.io/PPT**, cuando en realidad **TCGCSV es el primario** de la
ingesta (A) y el dial solo elige el **respaldo** (usado cuando TCGCSV no tiene precio / para gradeadas).
El reencuadre honesto:

- **No se oculta el selector** (el dial es real y necesario para el fallback/gradeadas), pero se
  **reetiqueta y contextualiza** para reflejar la precedencia verdadera.
- **Fila fija de primario (no editable):** encima del selector, una línea de solo lectura que muestra el
  primario inmutable: `eyebrow` «FUENTE PRIMARIA» + valor `TCGCSV` (mono) + `text-xs muted` «Siempre se
  intenta primero». Así el operador ve que TCGCSV manda, aunque no aparezca en el `Select`.
- **Reetiquetar el `Select`:** de «Proveedor de precios» → **«Proveedor de respaldo (fallback)»**.
- **Línea de precedencia** bajo el control (`text-xs muted`): «Precedencia: **TCGCSV (primario)** →
  respaldo: {selección} → override manual (máxima).» — coherente con la precedencia money-safe de
  PROJECT.md (§ Fuentes de precio) sin inventarla.
- **Microcopy (ES):** label «Proveedor de respaldo (fallback)» · hint «TCGCSV es la fuente primaria y
  siempre se usa primero; este proveedor solo cubre lo que TCGCSV no tenga (p. ej. gradeadas o cartas
  sin precio en TCGCSV).» **EN:** «Fallback price provider» · «TCGCSV is the primary source and is
  always tried first; this provider only covers what TCGCSV lacks (e.g. graded cards or cards without a
  TCGCSV price).»
- **Sin cambio de contrato:** el dial y sus valores no cambian; solo cambia cómo se **presenta** (label,
  fila de primario, línea de precedencia). Si más adelante se quisiera exponer TCGCSV como opción real
  del dial, es una **solicitud al arquitecto** (§19.9), no un cambio de diseño.

### 19.8 Estados, confirmaciones y feedback

- **Deshabilitado durante barridos:** se conserva la lógica actual (`catalogBusy` / `batchBusy` /
  `otherPerSetPending`): cualquier barrido global o por-set en curso deja las demás acciones
  `disabled` y la activa en `loading`; el `keep-alive` de sesión sigue atado a `catalogBusy`. En cada
  grupo, cuando algo corre, los botones de **otros** grupos también se deshabilitan (una operación de
  catálogo a la vez) con el motivo en `title`/`aria-describedby` («Espera a que termine el barrido en
  curso»).
- **Confirmaciones para acciones masivas (§7.6, modales ya existentes):**
  - **E «Re-sincronizar todo (forzar)»** — confirmación obligatoria (pesada; reprocesa todo el
    catálogo). Modal ya existe (`syncAllForceConfirm*`).
  - **F «Refrescar variantes + precios de TODO»** — confirmación obligatoria (masiva). Modal ya existe
    (`refreshVariantsAllConfirm*`).
  - **«Unificar rarezas»** — confirmación (§19.5), one-shot money-safe.
  - D, C, G, I: **sin** confirmación (incrementales o reparación segura acotada a un set).
- **Feedback honesto (sin cambios de §8.1):** progreso real (`SyncProgress`, `role="progressbar"`),
  resúmenes agregados con tono `warning` cuando algo quedó parcial (`setsFailed>0` / `pending>0`), lista
  de sets fallidos legible, avisos de límite diario del proveedor. Nada de «202 cosmético».
- **Estado vacío de la tabla de sets:** si no hay sets, `EmptyState` (§8.1) que invita a usar D
  «Importar sets nuevos» (grupo Catálogo) como primer paso.

### 19.9 Accesibilidad

- **Grupos como landmarks lógicos:** cada grupo es `<section role="group" aria-labelledby="…">` con el
  encabezado (eyebrow + h2) como etiqueta; el aviso de dependencia del grupo Catálogo va en `role=
  "status"` (no interrumpe).
- **Colapsable «Avanzado»:** implementar con `<details>`/`<summary>` nativo **plegado por defecto**
  (`aria-expanded` implícito, operable por teclado sin JS) o un botón con `aria-expanded`/`aria-controls`
  si se requiere animación; el foco entra al contenido al abrir. El rótulo `summary` deja claro el peso:
  «Avanzado — operaciones pesadas (re-sincronización completa)».
- **Menú «Más ▾» por-fila:** `aria-haspopup="menu"`, foco y navegación por flechas, `Esc` cierra, el
  foco vuelve al disparador; H dentro es un `menuitem` con label completo.
- **Botones icono-solo:** ninguno queda sin texto; los iconos de acción son decorativos (`aria-hidden`)
  salvo el kebab, que lleva `aria-label` «Más acciones para {set}».
- **Motivos de deshabilitado anunciados:** cuando I está deshabilitada por `!imported`, o cuando algo
  está bloqueado por un barrido, el motivo va en `title` **y** `aria-describedby` (no solo color/tooltip).
- **Contraste:** sin pares nuevos — todo reusa tinta/papel/accent ya verificados (§10). Los botones
  `secondary` sobre papel y los banners `info`/`warning` (texto coloreado sobre papel) cumplen AA.
- **Orden de tabulación:** A (arriba) → editores de precio → grupo Datos (F → tabla: por fila I → G →
  Más) → grupo Catálogo (D → C) → Avanzado (summary → E). Coherente con la jerarquía visual.

### 19.10 i18n — claves (propiedad de frontend)

Nuevas (`admin.m2.*`):
- `groups.data.{title,subtitle}` — «Datos (rápido · TCGCSV)» + garantía «funcionan siempre».
- `groups.catalog.{title,subtitle,sourceWarning,sourceDownReroute}` — título + aviso de dependencia +
  copy de reencaminar a Datos cuando la fuente falla.
- `groups.advanced.{summary,subtitle}` — rótulo del `<details>` (reutiliza/renombra `advancedOps.*`).
- `unifyRarities.{button,hint,confirmTitle,confirmBody,confirmCta,running,done}` (§19.5).
- `priceIngest.{primarySourceLabel,primarySourceValue,primarySourceHint,fallbackLabel,fallbackHint,
  precedenceHint}` — reencuadre del selector (§19.7). El label previo `providerLabel` pasa a
  `fallbackLabel`.
- Etiquetas cortas de botón: `catalog.refreshVariantsAllShort` («Refrescar variantes + precios (todo)»),
  `catalog.refreshVariantsShort` («Variantes + precios»), `catalog.fullSyncMenuItem` («Sync completo»),
  `catalog.rowMoreAria` («Más acciones para {name}»).

Retiradas:
- `admin.m2.sync.*` (sección de sync de bóveda B, §19.6) y cualquier clave `rarityMap`/`rarity-map`.

Recordatorio §9: los rótulos ES son ~15–30% más largos; los encabezados de grupo y los `summary` deben
envolver sin romper el layout (usar las etiquetas cortas de botón arriba para no desbordar la fila de la
tabla en `md`).

### 19.11 Notas para otros roles (no bloquean el diseño)

1. **Solicitud al arquitecto — señal de salud de la fuente de catálogo (deseable, no requerida):** hoy
   «pokemontcg.io está caída» solo se sabe **al fallar** una acción del grupo Catálogo (reactivo). Un
   indicador de salud (p. ej. `GET /admin/catalog/source-health` o un campo en el sync-status) permitiría
   **avisar/deshabilitar proactivamente** el grupo Catálogo y su banner antes de intentar. El diseño
   actual funciona sin él (degradación reactiva §19.3); si el arquitecto lo expone, el banner del grupo
   pasa de estático a estado real. Se registra como mejora para product-owner/arquitecto.
2. **Sin cambios de contrato ni de datos:** §19 solo reordena, reetiqueta y agrupa acciones y endpoints
   ya existentes; «Unificar rarezas» usa el backfill local de `rarityCanonical` (ya contemplado por el
   editor de dos ejes v1.29). Si «Unificar rarezas» necesitara un endpoint dedicado, es una solicitud a
   backend/arquitecto (el diseño no asume su forma, solo su efecto: money-safe, local, one-shot).
3. **QA visual sugerido:** (a) con pokemontcg.io simulada caída, verificar que A + grupo Datos (F, I)
   siguen operables y que el grupo Catálogo muestra el reencaminar a Datos; (b) que «Avanzado» arranca
   plegado y E solo aparece al expandir; (c) que «Unificar rarezas» no altera ningún precio (diff de
   reglas antes/después = 0) y colapsa duplicados del editor; (d) que ninguna acción global queda
   habilitada mientras otra corre.

---

## 20. Makeover del storefront — dirección 1a «Conservadora» (v2.0, Claude Design)

> **Origen:** artboards de **Claude Design** aprobados por el humano — «TCGHunt Home Makeover»
> (bloque **1a**, escritorio 1280 + móvil 390; la dirección 1b queda descartada) y «TCGHunt Comprar
> y Vender» (2a Comprar, 2b Vender, 2c Ficha de carta, 2d Carrito y pago, 2e Mi bóveda). Esta sección
> **codifica** esos artboards como spec versionada. Los nombres de cartas, precios, certs y conteos de
> los artboards son **placeholders**: aquí se documenta el patrón, nunca los datos.
>
> **Regla de composición:** §20 introduce **cero tokens nuevos**. Todo se construye con los tokens
> vivos de `globals.css` (§2.3 con los valores v1.7 de §17.2): tinta `--color-text`/`--color-primary`
> `#1A1A18`, rojo TCG HUNT `--color-accent`/`--color-danger`/`--color-warning` `#B31217`, verde
> `--color-success` (vivo `#4A7345`), papel `--color-bg`/`--color-surface` `#F4F1EA`, pozo
> `--color-surface-2` `#EFEBE2`, reglas `--color-border` / `--color-border-strong`, panel de tinta
> `--color-ink`/`--color-on-ink`/`--color-on-ink-muted`/`--color-on-ink-rule`. Radios 0 y sombras 0
> (§4.2–§4.3) intactos; anillo de foco rojo obligatorio (§8.2).

### 20.0 Alcance y relación con lo existente

- **Qué cambia:** la **composición** del storefront (home nueva + restyle de Comprar/Vender/Ficha/
  Carrito/Bóveda con estos mismos patrones). **Qué NO cambia:** flujos, contrato, datos, tokens.
- Los artboards 2a–2e aplican patrones ya especificados (grilla de catálogo §4.4/§7.1, `ListingSpec`
  mono §7.2b, tres precios y bounty §16, cotizador §18, portafolio §7.17) con la piel de §20; donde un
  artboard matiza una regla previa, se dice explícitamente aquí (§20.14 precios, §20.2 tabs/locale).
- **Micropatrones transversales del makeover** (aparecen en varios artboards, se nombran una vez):
  - **Link editorial subrayado rojo:** texto 11px peso 500 `uppercase` tracking `0.14em`, tinta, con
    `border-bottom: 1px solid var(--color-accent)` y `padding-bottom: 5–6px`. Es la acción secundaria
    de marca del storefront («Producto sellado», «Continuar mi cotización», «Ver la buylist completa»).
    Variante `muted` sin subrayado para links terciarios («Ver todo el catálogo»). Hover: el subrayado
    pasa a tinta o el texto a `--color-accent`; focus: anillo estándar.
  - **Nota al margen:** párrafo 13px `--color-text-muted` con `border-left: 2px solid
    var(--color-accent)` y `padding-left: 14–16px` para avisos de confianza («El pago se hace después
    de recibir y verificar…», «Todas las ventas son finales.»). Variante neutra con `border-left: 1px
    var(--color-border-strong)` para notas informativas sin urgencia (factura, envío desde bóveda).
  - **Eyebrow mono:** ya existente (§3.2) — 10px mono 500 `uppercase` tracking `0.18em` muted; el
    makeover lo usa como encabezado de TODA subsección («Cotizador», «Filtros», «Resumen», «Tu lista»).
  - **Placeholder de imagen:** mientras carga o falta imagen, fondo de rayas diagonales sutiles
    (`repeating-linear-gradient(135deg)` alternando pozo y un paso más oscuro) — es **textura de
    skeleton**, no un gradiente decorativo; no viola la regla de gradientes (§16.6/§17).

### 20.1 Navegación del header del storefront

Desktop (≥`lg`): barra de **74px**, `padding 0 32px`, `border-bottom` regla 1px.
1. **Marca** a la izquierda: mira SVG 28px (§17.1) + wordmark Montserrat 700 18px tracking `0.04em`
   `uppercase`.
2. **Nav** alineada a la derecha, gap 26px. Links: **11px, peso 500, `uppercase`, tracking `0.14em`**.
   - **Activo:** color tinta + `border-bottom: 1px solid var(--color-accent)` con `padding-bottom: 5px`.
   - **Inactivo:** `--color-text-muted`, border transparente (reserva el espacio; no salta al activar).
3. **Toggle de idioma — variante storefront:** texto **«ES / EN»** en mono 10px tracking `0.14em`
   muted; el locale activo en tinta, separador `/` muted. Es una **variante tipográfica** del
   `LocaleToggle` (§6.5): conserva su semántica (`role="group"`, `aria-pressed`, persistencia), cambia
   solo la piel (sin segmented control con fondo en el storefront). El admin conserva §6.5 tal cual.
4. **Carrito:** botón con `border: 1px solid var(--color-primary)`, `padding 9px 13px`, label 11px
   `uppercase` tracking `0.14em` + **contador mono `tabular-nums`**. Con carrito vacío muestra `0`
   (no se oculta). En checkout el header se simplifica: marca + rótulo mono «PAGO SEGURO · MXN SIN
   IVA» a la derecha (sin nav — menos fugas en el momento de pagar).

**Tabs de sección del storefront** (Cartas sueltas · Producto sellado · Gradeadas, artboard 2a): texto
12px 500 `uppercase` tracking `0.14em`, activo con **`border-bottom: 2px solid var(--color-accent)`**.
Matiz de §6.6: en el **storefront** el subrayado activo de tabs es **rojo** (coherente con la nav);
en el **back-office** sigue siendo tinta (§6.6 sin cambios). Las tabs de la bóveda (2e) usan texto
14px sin uppercase con subrayado 2px **tinta** — son navegación de contenido, no taxonomía de tienda.

Móvil (<`lg`): header de **60px**, `padding 0 16px`: marca (mira 28px + wordmark 16px) + carrito
compacto + **hamburguesa minimal** (dos reglas horizontales de 1px de tinta, 22px de ancho, gap 5px;
es un `<button>` con `aria-label` y área táctil 44px). La nav completa vive en el menú desplegado.
El header sigue exponiendo `--app-header-h` (§4.5).

### 20.2 Hero de home a 2 columnas — claim editorial + panel «Cotizador»

Grid desktop: **`1fr 392px`**, separadas por regla vertical 1px, `border-bottom` regla al cierre.

**Columna izquierda — claim editorial** (`padding: 52px 48px 44px 32px`):
1. Eyebrow mono («CARTAS POKÉMON · MÉXICO»).
2. **H1 serif** (Zen Old Mincho 400): **50px / line-height 1.14 / tracking −0.005em**, `max-width
   ~660px`, `text-wrap: pretty`. Tamaño de hero **solo para la home** (por encima de `text-display`
   40px de §3.2); se implementa con arbitrary value o extensión local del scale — no es token nuevo.
3. Lead 16px / 1.75 muted, `max-width ~470px`.
4. Fila de CTAs (gap 28px): **CTA primario de tinta** — bloque `#1A1A18`, texto papel, **54px de
   alto**, `padding 0 30px`, label 11px 500 `uppercase` tracking `0.18em` («Ver el catálogo») — +
   **link editorial subrayado rojo** secundario («Producto sellado»).
5. Fila «Sets buscados»: eyebrow mono + chips de texto 13px con `border-bottom` 1px
   `--color-border-strong` (links a facetas de set; los nombres EN llevan `lang="en"`). Solo sets
   reales con inventario — no decorar con sets vacíos.

**Columna derecha — panel Cotizador** (embebido, sin borde propio: lo delimitan las reglas del grid):
1. **Encabezado de panel:** fila `13px de padding vertical`, `border-bottom` regla, con dos eyebrows
   mono enfrentados: **«COTIZADOR»** ⟷ **«MXN · SIN IVA»**.
2. Título serif 26px («¿Cuánto vale lo que tienes?») + apoyo 14px muted.
3. **Input con botón integrado:** contenedor de **46px** con `border: 1px solid var(--color-primary)`
   (tinta, más fuerte que el input estándar §6.2 — es el CTA de la home); dentro, campo de búsqueda
   (placeholder muted, 14–16px) y, pegado al borde derecho, **botón «AÑADIR»** como bloque de tinta
   `align-self: stretch` (fondo `--color-primary`, texto papel, 10px 500 `uppercase` tracking
   `0.14em`). Un solo control compuesto: el foco visible envuelve el conjunto; el botón es `<button>`
   real. Conecta con el typeahead del cotizador §18 (mismos datos, mismo flujo).
4. **Lista de líneas:** filas `justify-between` con `padding 11px 0` y regla inferior — nombre de
   carta 13px (`lang="en"`) ⟷ **precio mono 12px `tabular-nums`**. Sin imagen: el panel es una
   tabla de papel. Máximo ~3 líneas visibles; más líneas viven en `/buylist`.
5. **Total:** fila final — eyebrow mono **«TE PAGAMOS»** ⟷ **cifra mono 19px `tabular-nums`**.
6. **Link editorial subrayado rojo** «Continuar mi cotización» → `/buylist` (lleva las líneas
   capturadas; el estado se comparte con el cotizador §18, no se duplica).
7. **Pie de confianza** anclado abajo (`margin-top: auto`): dos renglones 14px separados por reglas
   («Bóveda asegurada…», «Pago por transferencia en 24–48 h»).

**Estados del panel:** vacío = input + copy de invitación (sin lista ni total: no se inventan cifras
de ejemplo); con líneas = lista + total; precio pendiente en una línea = texto mono rojo «PENDIENTE»
en lugar de cifra (§16.4). El panel **nunca** muestra montos si no hay precios de buylist reales.

### 20.3 Carrusel «Piezas destacadas»

Encabezado de sección: fila `justify-between` — **H2 serif 29px** («Piezas destacadas del catálogo»)
⟷ link muted «Ver todo el catálogo» + **flechas cuadradas**.

- **Flechas:** botones cuadrados de **38px** (radio 0), `border: 1px solid`; **habilitada** = borde
  `--color-primary` (tinta) y glifo tinta; **deshabilitada/extremo** = borde `--color-border-strong`
  y glifo muted, `disabled` real. Área táctil ampliada a 44px. `aria-label` «Anterior»/«Siguiente».
- **Pista:** fila horizontal con gap 28px, `overflow` con scroll-snap (el carrusel degrada a scroll
  horizontal nativo sin JS).
- **Primera pieza — grande:** ancho **400px**, imagen **`aspect-[4/5]`** (encuadre editorial del arte;
  la 5:7 canónica §5 sigue siendo la norma fuera del hero del carrusel). Debajo, fila `justify-between`:
  nombre **serif 26px** + sublínea mono 11px muted (set · # · grado si aplica) ⟷ precio **25px sans
  500 `tabular-nums`** alineado a la derecha + distintivo de stock (§20.6).
- **Piezas siguientes:** ancho **268px**, imagen `aspect-[5/7]`. Anatomía: fila de título con
  **numeración mono roja de dos dígitos** (`01`, `02`… mono 10px `--color-accent`) + nombre serif
  16px; sublínea mono 11px muted; precio 17px sans 500 `tabular-nums`; distintivo de stock.
- La numeración es **decorativa/orientadora** (`aria-hidden`); el orden real lo da el DOM.
- **Contenido:** solo piezas publicadas con precio (regla dura §7.1); la selección «destacadas» es
  curaduría o criterio de negocio, nunca placeholders.

### 20.4 Sección «Producto sellado» — banda de pozo con tejas horizontales

Banda de ancho completo sobre **`--color-surface-2`** (pozo), delimitada por reglas arriba/abajo —
es el único bloque de la home con fondo distinto al papel (jerarquía por tono, §4.3).

- Encabezado: H2 serif 29px («Producto sellado») ⟷ link muted «Ver todo el sellado».
- **Tejas horizontales** en grid de **3 columnas** (gap 32px), cada teja con **`border-top: 1px solid
  var(--color-border-strong)`** y `padding-top: 18px`:
  1. **Thumb cuadrado de 88px** (la caja se centra con `object-contain` sobre el pozo, §7.1b — no se
     recorta).
  2. Columna de texto: **nombre serif 16px / 1.3** (`lang="en"`), **precio 16px sans 500
     `tabular-nums`**, **distintivo de stock** (§20.6).
- La teja completa es un link a la ficha; hover = leve énfasis de la regla superior (a tinta) y/o
  `scale-[1.02]` del thumb; focus = anillo en toda la teja.

### 20.5 Sección «Cartas gradeadas» — tejas 3:5 con chip de grado

- Encabezado: H2 serif 29px («Cartas gradeadas») + **kicker mono** al lado: eyebrow **«PSA · BGS ·
  CGC»**; a la derecha link muted «Ver todas las gradeadas». Debajo, apoyo 14px muted que ancla la
  confianza («Slab sellado, grado y número de certificado verificados…»).
- Grid de **4 columnas** (gap 32px). Anatomía de teja:
  1. Imagen del slab **`aspect-[3/5]`** (el slab es más alto que la carta 5:7; mismo tratamiento de
     placeholder/borde de §5).
  2. **Fila de certificación** (bajo la imagen, fuera del arte — regla §7.2b): **chip de grado** con
     `border: 1px solid var(--color-primary)` (tinta), `padding 4px 7px`, texto **mono 10px 500**
     tracking `0.1em` («PSA 9», «BGS 9.5», «CGC 9») + **número de cert** mono 10px muted
     («CERT 84021177» — dato real de `certNumber`, verificable; nunca placeholder).
  3. Nombre serif 16px (`lang="en"`), sublínea mono 11px muted (set · #).
  4. Precio 17px sans 500 `tabular-nums` + distintivo de stock (§20.6).
- El chip de grado de §20.5 es la forma vitrina del `ListingSpec` (§7.2b): en listas densas se sigue
  usando el renglón `GRADED · PSA 9 · CERT …`; en vitrina se separa chip + cert para jerarquía.

### 20.6 Distintivos de stock — y regla money-safe

Etiqueta **mono, `uppercase`, 10px (9px en móvil), tracking `0.10–0.12em`**, siempre texto plano
coloreado sobre el fondo (sin caja, §2.1). Cuatro formas:

| Distintivo | Color | Cuándo |
|---|---|---|
| **«QUEDA 1»** | `--color-accent` `#B31217` | La pieza es única (urgencia honesta) |
| **«N EN STOCK»** | `--color-success` (vivo `#4A7345`) | Existen N ≥ 2 copias reales equivalentes |
| **«ÚLTIMO»** | `--color-text-muted` `#6E695E` | Última unidad de un producto que tuvo varias (sellado) |
| **«AGOTADO»** | `--color-text-muted` `#6E695E` | Sellado con `availableCount: 0` (conteo real del backend) |

**Regla money-safe (dura):** el distintivo solo muestra **datos reales del backend**.
- En el **catálogo actual el modelo es 1 publicación = 1 copia**: el distintivo veraz por defecto es
  **«Queda 1»** (o ninguno). **Prohibido inventar agregados** («3 en stock») sumando publicaciones en
  el cliente o mostrando conteos que el contrato no expone.
- **«N EN STOCK»** solo se renderiza cuando el backend entrega un **conteo agregado real** (p. ej.
  stock de sellado o publicaciones agrupadas por variante equivalente). Mientras ese dato no exista
  en el contrato, la forma verde **no se usa en cartas sueltas**. *Solicitud anotada para
  arquitecto/product-owner:* si se quiere la forma agregada en singles, el contrato debe exponer el
  conteo por grupo equivalente (ver resumen final; no bloquea §20).
- **«ÚLTIMO»** requiere igualmente conteo real (stock de sellado que llegó a 1).
- El distintivo es **informativo**, no estado de dominio: no reemplaza a los badges de §2.4. Color +
  texto siempre (el color es redundante, §2.4). En `aria-label` de la teja se incluye el texto.

### 20.7 Tabla «Lo que más buscamos hoy» (bounties) — condicional

Sección de la home que **solo se renderiza si hay bounties activos** (mismo dato que «Top Bounties»
§16.7b; si la lista está vacía, la sección desaparece por completo — no hay estado vacío decorativo).

- Encabezado: H2 serif 29px ⟷ link muted «Ver la buylist completa»; apoyo 14px muted («…pagamos por
  encima del mercado. Precio del día, sin regateo.»).
- **Tabla en grid `2fr 1fr 1fr 1fr`** (gap 20px):
  - **Header row:** cuatro eyebrows mono muted — «CARTA», «CONDICIÓN», «PAGAMOS» (alineada a la
    derecha), «BUSCADAS» (derecha) — cerrada con **regla fuerte** (`--color-border-strong`).
  - **Filas** (`padding 15px 0`, regla 1px entre filas, `align-items: baseline`):
    1. Nombre **serif 17px** (`lang="en"`, carta · set · #).
    2. Condición en **mono 12px muted** («NM o mejor», «Cualquiera»).
    3. **Cifra mono 15px `tabular-nums`** alineada a la derecha (lo que se paga — dato real del
       bounty).
    4. Cantidad buscada **mono 12px `tabular-nums` muted**, derecha (se omite la celda si el bounty
       no define cupo).
- Semántica: es una tabla de datos → `<table>` real (o grid con `role="table"`/`row`/`cell`) con
  `<th scope="col">`; el orden de lectura coincide con el visual.
- Cada fila enlaza al flujo de cotización con esa carta precargada (patrón «Cotizar esta carta» §16.7b).

### 20.8 «Cómo funciona la bóveda» — pasos con regla superior de tinta

- Encabezado: H2 serif 29px + kicker eyebrow mono («CUSTODIA ASEGURADA»).
- **Grid de 3 pasos** (gap 40px), cada paso:
  1. **`border-top: 2px solid var(--color-primary)`** (tinta — la regla gruesa marca el paso) +
     `padding-top: 16px`.
  2. **Número mono rojo** (`01`, `02`, `03` — mono 11px `--color-accent`, `aria-hidden`; la secuencia
     real es una `<ol>`).
  3. Título **serif 20px**, cuerpo 14px / 1.7 muted.
- **Variante secundaria** (usada en «Guía de envío seguro», artboard 2b): 4 columnas, `border-top`
  **1px regla normal**, título en **sans 14px 500** en vez de serif — misma gramática, un escalón
  menos de jerarquía. Regla general: 2px tinta + serif para pasos de sección principal; 1px + sans
  para listas de pasos utilitarias.

### 20.9 Banda oscura CTA «Vender mis cartas»

Bloque de ancho completo sobre **panel de tinta** (`--color-ink` `#1A1A18`, §2.2), en grid
**`40px 1fr auto`**:

1. **Columna de etiqueta vertical (40px):** texto **«Buylist»** en serif 12px, `writing-mode:
   vertical-rl`, tracking `0.5em`, `uppercase`, color `--color-on-ink-muted` `#8A857A`; separada del
   contenido por regla `--color-on-ink-rule`. Es decorativa (`aria-hidden`).
2. **Contenido:** H2 serif 33px en `--color-on-ink` (papel) + apoyo 15px / 1.7 en `#A39D91`
   (`--color-on-ink-nav`), `max-width ~470px`.
3. **CTA:** botón **rojo** — fondo `--color-accent` `#B31217`, texto papel, **54px** de alto,
   `padding 0 32px`, label 11px 500 `uppercase` tracking `0.18em` («Cotizar mi lista»). Es de los
   poquísimos usos del rojo como **fondo** (variante `accent` §6.1); autorizado aquí porque es EL
   CTA de negocio de la home. Hover: oscurecer ~6% hacia el vino; focus: anillo rojo con
   `outline-offset` que lo despega del fondo oscuro (visible sobre tinta).

El mismo botón rojo de 54px es el **CTA de pago** del checkout («Pagar $X» — artboard 2d): rojo =
momento de dinero irreversible, siempre con el monto en el label (`tabular-nums`).

### 20.10 Footer mono minimal

Una sola línea, `padding 26px 32px` (20px en móvil), `border-top` regla:

- Todo en **mono 11px (10px móvil), `uppercase`, tracking `0.14em`, `--color-text-muted`**.
- Izquierda: `TCG HUNT · tcghunt.mx · © {año}` (el dominio en `text-transform: none`).
- Derecha: links legales («Términos», y los que apliquen) con el mismo estilo; hover = tinta;
  focus = anillo. En móvil se apilan o queda solo la línea de marca.
- Sin columnas, sin sitemap, sin redes decorativas: el footer es un **colofón de imprenta**. Contraste
  del muted sobre papel 4.9:1 (§10) — AA para este cuerpo.

### 20.11 Patrones móviles (390px)

Jerarquías compactas según los artboards móviles; mismas piezas, un escalón menos:

| Patrón | Desktop → Móvil |
|---|---|
| Header (§20.1) | 74px → **60px**; nav → hamburguesa; carrito compacto (`padding 8px 11px`) |
| Hero (§20.2) | 2 columnas → **apilado**: claim (H1 serif **31px / 1.22**) + CTA de tinta **a ancho completo (52px)**; el panel Cotizador baja como **sección propia** tras «Destacadas» (eyebrow «COTIZADOR» + título 23px + input 46px + 1–2 líneas + total 18px + link rojo) |
| Carrusel (§20.3) | pieza grande 400→**236px** (nombre serif 17px, precio 17px), resto 268→**160px** (serif 14px, precio 15px); flechas 38→**32px**; H2 22px («Destacadas») |
| Sellado (§20.4) | banda de pozo con **una teja** (thumb 70px, serif 14px) + eyebrow «SELLADO»; el resto vive en su vitrina |
| Gradeadas (§20.5) | **teja horizontal única**: slab 76×120 + chip de grado 9px + cert 9px + serif 15px + precio 15px; eyebrow «GRADEADAS» + link «Ver todas» |
| Bounties (§20.7) | tabla → **lista de 2 columnas**: nombre serif 14px ⟷ cifra mono 13px `tabular-nums` (sin columnas de condición/cupo; viven en `/buylist`) |
| Banda oscura (§20.9) | **sin etiqueta vertical**; H2 24px, CTA rojo a ancho completo (50px) |
| Footer (§20.10) | una línea 10px |
| Catálogo (2a móvil) | tabs con labels cortas («Sueltas»); barra de **«FILTROS n»** (botón con contador mono **rojo** de filtros activos) + orden; grilla 2 col; CTA «Añadir» 44px |
| Carrito (2d móvil) | líneas compactas (miniatura 64px); **total + CTA rojo** en bloque de pozo al final |
| Bóveda (2e móvil) | KPI 32px + delta; grilla 2 col de piezas con folio y estado mono |

Reglas fijas en móvil: cuerpo/inputs mínimo 16px (§3.2), objetivos táctiles 44px (los botones de
42–44px de los artboards cumplen; los de 40px amplían área táctil), distintivos de stock bajan a 9px
pero nunca menos.

### 20.12 Paginador sobrio (catálogo / pedidos)

El backend pagina a **20 por página**; los artboards muestran la forma compacta (`← 1 / 6 →`, 2a) y
aquí se define el patrón completo, coherente con las flechas del carrusel (§20.3):

- **Forma compacta (default, y única en móvil):** `[←] 1 / 6 [→]` centrado bajo la grilla —
  flechas **cuadradas de 38px con borde** (mismas reglas §20.3: habilitada = borde tinta; deshabilitada
  = borde `border-strong` + glifo muted + `disabled`), y en medio el indicador **mono 11px
  `tabular-nums` muted** «{página} / {total}».
- **Forma numerada (opcional, desktop con muchas páginas):** números de página en **mono 12px
  `tabular-nums`**, gap 12px; la página actual en tinta con `border-bottom: 1px solid
  var(--color-accent)` (mismo lenguaje que la nav §20.1) y `aria-current="page"`; el resto muted.
  Elipsis mono `…` no interactiva. Flechas cuadradas en los extremos.
- Accesibilidad: `<nav aria-label="Paginación">`; flechas con `aria-label`; área táctil 44px; tras
  cambiar de página el foco va al inicio de la lista de resultados y se anuncia «Página {n} de {m}»
  (`aria-live="polite"`). Con una sola página, el paginador **no se renderiza**.
- Sustituye la forma visual de §6.6 *Pagination* en el storefront (el patrón de datos
  `{page,pageSize,total}` del contrato no cambia); «Cargar más» sigue permitido en móvil donde ya
  exista.

### 20.13 Ficha, carrito y bóveda — matices del makeover (2c/2d/2e)

Sin flujo nuevo; tres matices visuales que el frontend debe respetar al re-pielar:

- **Ficha (2c):** retícula de datos en **celdas separadas por reglas** (grid 2 col con `border-left`/
  `border-bottom` 1px): «Precio de venta» (30px sans 500) vs «Valor de mercado» (30px + fecha de
  captura mono, §7.3) en celdas hermanas — nunca la referencia compite en tamaño con la venta en otra
  jerarquía. **Fila de certificado copiable:** caja con borde `border-strong`, texto mono
  `PSA 9 · CERT {n}` + acción mono roja «COPIAR» (con confirmación `aria-live` «Copiado»).
  **Ejemplares disponibles:** lista de filas con `ListingSpec` mono + precio + CTA por fila
  («Comprar» tinta / «En el carrito» outline / «No disponible» muted deshabilitado; el ejemplar sin
  precio muestra el aviso mono rojo de §16.4, nunca $0).
- **Carrito (2d):** líneas con miniatura 92×129 (5:7) o 92×92 (sellado), nombre serif 19px, spec mono
  muted, «Quitar» mono muted; resumen con desglose (subtotal / IVA 16% / procesamiento) en filas con
  reglas y **Total mono 26px**; CTA de pago **rojo** con monto (§20.9). El bloque «Guardar en mi
  bóveda» es lista de beneficios con reglas + nota al margen roja «Todas las ventas son finales.»
- **Bóveda (2e):** KPI del portafolio **44px sans 500 `tabular-nums`** + delta verde/rojo (§7.17);
  aviso mono rojo «{n} piezas con precio pendiente» si aplica; teja de pieza = imagen 5:7 + nombre
  serif 15px + `ListingSpec` mono + **folio mono** + fila precio ⟷ estado (LIQUIDADA verde /
  EN RETIRO rojo / PENDIENTE muted) + botón «Retirar» (outline tinta habilitado; outline débil +
  muted deshabilitado, con motivo en `title`/`aria-describedby`).

### 20.14 Refinamiento tipográfico v2.0 — dos voces para el dinero

El makeover matiza la regla «toda cifra en mono» (§3.1) con dos registros, ambos siempre con
`tabular-nums`:

| Registro | Familia / peso | Dónde |
|---|---|---|
| **Precio display** (etiqueta de precio de una pieza) | **Sans (Archivo) 500**, 15–30px | Tejas de vitrina, carrusel, ficha (venta/mercado), líneas de carrito, KPI del portafolio |
| **Dinero operativo** (columnas, totales, desgloses) | **Mono (JetBrains Mono)**, 11–26px | Líneas y total del cotizador, tabla de bounties, resumen del carrito («Total»), «Te pagamos», folios, certs |

Racional: el precio-etiqueta es *voz de la pieza* (convive con el serif del nombre); el dinero que se
suma, compara o liquida es *voz de registro* y se queda en mono. Los folios, certs, estados y
distintivos siguen siendo **siempre mono** (§3.1 sin cambios). Esta tabla es la referencia ante duda.

### 20.15 Accesibilidad y contraste (verificación de los pares que §20 usa)

Pares nuevos o intensamente usados (los demás ya están en §10/§17.2):

| Par | Ratio | Veredicto |
|---|---|---|
| Rojo `#B31217` sobre papel `#F4F1EA` (distintivos, números, links) | **6.2:1** (§17.2) | AA (texto pequeño ✓) |
| Rojo `#B31217` sobre pozo `#EFEBE2` (distintivos en banda sellado) | **5.9:1** | AA ✓ |
| Verde `#4A7345` sobre papel (N en stock, «Liquidada») | **4.9:1** | AA ✓ |
| Verde `#4A7345` sobre pozo | **4.6:1** | AA ✓ |
| Muted `#6E695E` sobre pozo (subtítulos en banda sellado) | **4.6:1** | AA ✓ |
| Papel sobre rojo `#B31217` (CTA rojo) | **6.2:1** | AA ✓ |
| Papel sobre tinta / on-ink-muted sobre tinta (banda oscura) | ≥ 6.4:1 | AA ✓ (ya en §10) |

Reglas de accesibilidad del makeover: numeración decorativa y etiqueta vertical `aria-hidden`
(§20.3, §20.8, §20.9); los distintivos de stock y estados son **texto**, el color es redundante
(§2.4); carrusel operable por teclado (flechas = botones reales, la pista es scrollable con
`tabindex` según implementación estándar); tabla de bounties con semántica de tabla (§20.7);
paginador con `aria-current` y anuncio de página (§20.12); foco visible rojo en TODO interactivo,
incluida la banda oscura (offset sobre tinta, §20.9); labels mono en `uppercase` vía
`text-transform` (el texto fuente conserva mayúsculas/minúsculas normales para lectores de pantalla).

### 20.16 i18n — claves nuevas (propiedad de frontend) y notas

Convención `home.*` / `storefront.*` (ES de referencia; EN a cargo de frontend, §9):
- `home.hero.{eyebrow,title,lead,ctaCatalog,ctaSealed,setsLabel}`
- `home.quoter.{title,lead,searchPlaceholder,add,payLabel,continue,trust1,trust2,pendingPrice}`
- `home.featured.{title,titleMobile,viewAll,prevAria,nextAria}`
- `home.sealed.{title,viewAll}` · `home.graded.{title,kicker,viewAll,lead,copyCert,copiedCert}`
- `home.bounties.{title,lead,viewAll,colCard,colCondition,colPay,colWanted}`
- `home.vaultSteps.{title,kicker,step1Title,step1Body,…}` (3 pasos)
- `home.sellBand.{label,title,lead,cta}`
- `stock.{lastOne,inStock,lastUnit,soldOut}` — «Queda 1» / «{n} en stock» / «Último» / «Agotado»
  (formato de `{n}` según
  convención del proyecto, sin ICU — §18.4a)
- `footer.{line,terms}` · `pagination.{pageOf,prevAria,nextAria,announce}`

Recordatorio §9: los labels uppercase con tracking ancho crecen ~25% en ES; los encabezados de panel
(«COTIZADOR» ⟷ «MXN · SIN IVA») deben poder envolver o truncar con `title` sin romper la fila.

**Notas a otros roles (no bloquean):**
1. **Arquitecto/product-owner — conteo agregado de stock (deseable):** para poder usar «N EN STOCK»
   en cartas sueltas, el contrato tendría que exponer el conteo real de publicaciones equivalentes
   por variante (§20.6). Hoy el diseño es veraz sin él («Queda 1»/omitir).
2. **Frontend:** el hero H1 50px y el aspect 4/5 de la pieza grande son valores del artboard
   (arbitrary values, no tokens); el carrusel debe degradar a scroll-snap nativo; el estado del
   cotizador de la home se comparte con `/buylist` (§18), no se duplica.
3. **QA visual sugerido:** (a) home sin bounties → la sección §20.7 no existe en el DOM; (b) ningún
   distintivo «N en stock» en singles mientras el contrato no exponga conteos; (c) foco visible
   recorrible por toda la home incluida la banda oscura; (d) móvil 390: sin scroll horizontal
   fantasma con el carrusel presente; (e) paginador ausente cuando `total ≤ pageSize`.
