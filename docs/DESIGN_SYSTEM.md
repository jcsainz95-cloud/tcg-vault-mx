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
> nuevo** (la banda de acabado, §16.6) y **cero tokens nuevos** de color/tipografía.
> *(Actualización posterior: la banda de acabado colorea ESTRICTAMENTE por `finish` con colores planos —
> reverse=rojo, holofoil=azul, 1ed=tinta — y ya no lleva gradiente; añade el token de azul
> `--color-finish-holo`. Ver §16.6.)*
>
> **Añadido v1.7 (P-21 — identidad TCG HUNT) → ver §17.** Rebrand de marca: el sitio pasa a llamarse
> **TCG HUNT** (dominio `tcghunt.mx`) con **logo de mira/crosshair** en degradado **rojo `#B31217` → vino
> `#4A0D0D`**, reconstruido en **SVG vectorial** a partir de la referencia de alta resolución del humano
> (§17.1: lockup completo, solo-mira, glifo micro y variante para fondo oscuro). Cambio de paleta: se
> **conserva la base editorial papel/tinta** y el **bermellón `#B44B3A` se retira**: el **rojo TCG HUNT
> `#B31217` asume todos sus roles** (accent, warning, danger, anillo de foco — mismo nombre de tokens,
> nuevo valor; contraste sobre papel **sube** de 4.65:1 a **6.2:1**, §17.2). El degradado del logo se suma
> como **única excepción de gradiente** del sistema (la banda reverse de §16.6 pasó a rojo sólido y ya no es
> gradiente): nunca en superficies ni botones. El badge BOUNTY (§16.7b) adopta el **glifo micro oficial de la mira** en lugar del
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
> **Añadido v1.10 (P-35) → evolucionado v1.39 (P-38 — entidad `SealedProduct`) → ver §16.8a.** La pestaña
> «Sellado» de M1 estrena un **flujo dedicado de 2 pasos** (`SealedAddFlow`): **paso 1 = presentaciones
> selladas del set** (con imagen y nombre reales, **no singles**), **paso 2 = `QuickAddSection` §16.5 tal
> cual** (cantidad + Comprar/Aportación) más subtipo y condición. **P-38 (contrato v1.39.1) evoluciona el
> paso 1**: cada presentación es una entidad real (`SealedProduct`) persistida por un **sync**, no un ancla a
> single (cura del bug ETB→«Tropius · SIN MAPEO»). Cuatro cambios de UI: (1) el paso 1 se parte en **DOS
> SECCIONES por `origin`** — «Del set» (`set_main`) y «Promos/colecciones» (`promo_collection`); (2) la teja
> gana **subtipos `UPC` y `collection`** + **badge «Principal»**; (3) estado **«Sincronizar»** (`needsSync`)
> con CTA `super_admin` + curación de grupos promo (`SealedGroupLinker`); (4) **input de precio MANUAL
> auditado** (`vault_operator+`, v1.39.1) SOLO cuando `marketRef` es null — reemplaza el «capturar sin
> catálogo» de P-35. Money-safe intacto: **`SIN PRECIO DE MERCADO`** (nunca 0 ni inventado) y aportación
> bloqueada sin mercado vivo o manual. **Aditiva: cero tokens nuevos** (reusa Modal/Combobox/Select/Input/
> Banner/EmptyState/QueryState/Switch/skeleton §18.6). La solicitud abierta de P-35 (catálogo por `setId` +
> mapear-al-crear) **quedó resuelta** en §4.34/contrato v1.39.1.
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
>
> **Añadido v2.1 (curva de precio por valor de mercado — P-48) → ver §21.** *(Es el «v2.0» de
> `PROJECT.md` §N / `ARCHITECTURE.md` §4.36; aquí se numera **v2.1** porque v2.0 ya nombra el makeover
> del storefront.)* El precio de las cartas sueltas pasa a depender **solo del valor de mercado**, con
> **una curva por eje** editable como **tabla de puntos de longitud variable**. §21 define: (1) el
> **editor de M2** que sustituye a las pantallas de reglas por rareza y por tier — fila de punto,
> agregar/mover/borrar sin fragilidad (**mover = cambiar el mercado, no arrastrar**), constantes
> **piso**/**mínimo de compra**/**escalera de redondeo**, el **momento y la forma** de los errores
> V1–V9 (nada al teclear · campo al `blur` · **cruzados como `422` al guardar, sin guardar nada**) y
> un **previsualizador obligatorio** (probeta con memoria de cálculo + tabla de referencia; curva
> dibujada recomendada); (2) la regla de que el bloque **«Valor de mercado» desaparece** cuando
> `priceBasis !== "market"`, con la **recomposición de la retícula sin hueco** (el divisor es de la
> posición, no de la celda; la fila del dinero ocupa el ancho completo) en ficha de carta y de
> sellado; (3) la **alerta de bounty rebasado** (`BOUNTY REBASADO`, sin glifo de mira) y el
> **guardarraíl visible** (`·!`) en el binder de M1, más el mapa canónico **`priceBasis` → versalitas**
> (`MERCADO/PISO/MANUAL/BOUNTY/PENDIENTE`) que sustituye a `REGLA`/`FALLBACK`. §21 **enmienda** §7.3
> (se retira el «Valor de mercado» opcional de las tejas), §16.3, §16.7, §19.5 (re-hogar de «Unificar
> rarezas») y **retira** el copy falso «Piso (MX$)» / «Hereda tier» con su pantalla. **Cero tokens
> nuevos**; no hubo entrega de Claude Design para esta feature.
>
> **Añadido v2.2 (§O de PROJECT — «Valor estimado si se gradea», gancho de grading) → ver §22.**
> *(Numeración: al fusionar con `main`, la **curva de precio P-48** ya ocupaba **§21** y la etiqueta
> **v2.1** en producción, así que esta entrega pasa a **§22 / v2.2**. Es el mismo requisito, hoy **§O**
> de `PROJECT.md`; solo cambia el número de sección.)* Tres superficies nuevas sobre la piel vigente:
> **bloque de valores PSA 10 / PSA 9** junto al precio en la ficha, **badge de estimado** en la teja de
> Compra y **vitrina «Joyas para gradear»** en el home. Sin artboard de Claude Design: §22 se **compone
> íntegramente con lo ya ratificado** (celda `Fact` de la ficha, `PriceTag` §7.3, chip de grado sin cert
> §7.2c/§16.9, patrón `Shelf` §20.5, reglas §4.3, `--app-header-h` §4.5) y **no pide ni una
> modificación** a componentes existentes.
> **Revisión del humano (2026-08-23), incorporada — dos cambios que definen la sección:**
> **(1) Fuera la aritmética.** Se retiran de la UI la comparativa de tres columnas, el multiplicador, la
> ganancia en MXN y el costo de gradeo del escalón: la ficha muestra **el precio y, junto a él, los dos
> valores estimados**, y nada más. El **cálculo de ROI no desaparece — deja de mostrarse**: vive
> server-side y ahora solo **filtra** qué cartas llevan badge y cuáles entran en la vitrina (**R5**: el
> cliente nunca ve el cálculo). Consecuencia de diseño: se **retira el crescendo tipográfico** (era el
> recurso narrativo de una comparativa que ya no existe, e insinuaría la aritmética retirada) y toda la
> distinción precio↔estimado la carga **R2** sola — mono vs sans, más chico, y en un contenedor separado
> que **no contiene ningún precio real**.
> **(2) El disclaimer pasa a nota al pie.** Patrón editorial de **llamada + nota**: asterisco en
> `--color-accent` pegado a la etiqueta de la cifra (uno por superficie, nunca por cifra, con **texto
> accesible** que sustituye al glifo para lectores de pantalla) y **texto completo al final de la misma
> página**, una sola nota por página, visible sin interacción, con salto y **regreso** por teclado
> (`tabindex="-1"` + `scroll-margin-top` sobre `--app-header-h`). Sobrevive el mejor recurso del
> tratamiento anterior: **entradilla en negrita por párrafo**, que vuelve escaneables los seis puntos de
> §O.5. **La nota al pie NO sustituye al aviso adyacente:** junto a **cada** cifra va también un
> **micro-aviso visible** con las dos ideas obligatorias («ilustrativo» + «no evaluamos esta carta»), en
> las tres superficies — §O.5 lo exige y marca su ausencia como **defecto bloqueante**, porque una nota al
> pie protege menos que un aviso adyacente si el comprador nunca baja. Para que quepa en la teja, **el
> badge pierde el eyebrow** y el condicional se incorpora a la cifra («En PSA 10 vale ≈ MX$X»), y el
> micro-aviso se pinta en **sans 11px** (prosa, más estrecha que la mono): coste **+16px en escritorio,
> +28px en móvil**, aceptado y cuantificado *(y hoy casi nulo: §21.8f retira de la teja la línea «Valor
> de mercado», que la encoge ~16px — ver §22.5)*. **R3 se reformula** en tres capas acopladas: toda cifra
> lleva **micro-aviso visible** y **llamada**, toda página con cifras renderiza su **nota completa**, y
> las cuatro se renderizan **bajo la misma condición** — si no cabe el aviso, no se muestra la cifra.
> Sigue prohibido `<details>`, acordeón, modal, tooltip, `sr-only` como único portador, o mandar el texto
> a términos como único acceso. Money-safe intacto (§O.4): sin dato **no se renderiza nada** — ni $0, ni
> guion, ni «pendiente», ni skeleton que reserve el hueco. **Aditiva: cero tokens nuevos** de color y
> tipografía y cero elementos gráficos nuevos.
> **Revisión del humano (2026-08-28), incorporada — la rejilla lleva la cifra, pero solo si es
> confiable.** De las tres opciones del mock de rejilla, el humano eligió **mostrar el monto** en la teja
> del catálogo y en la vitrina (no el distintivo sin número), **con una condición**: en la rejilla la
> cifra solo aparece si el número es **confiable** —**fresco**, de **origen confiable** (override manual,
> o dato automático con **muestra suficiente de ventas**) y **coherente en magnitud** (la cota es
> `psa10 > precio raw`; se descarta si sale **≤ raw**)—. La **ficha no aplica la coherencia con la misma
> dureza**: informa lo que hay. Solo la **rejilla**, que es superficie de **promoción**, exige confianza.
> Se traduce en la regla dura **R6** (§22.0) y en un **estado nuevo** en §22.7 —«hay cifra y pasa el gate
> de ROI, pero no es confiable» ⇒ **ficha sí, teja y vitrina no**—, **indistinguible en pantalla** del
> caso «no pasa el gate», y así debe ser (R5). Sigue **cero tokens nuevos**.
>
> **Añadido v2.3 (§P de PROJECT — ciclo de adquisición del buylist: ofertar, aceptar, guía y publicar)
> → ver §23.** El buylist deja de ir de `cotizada` directo a la recepción física y gana **oferta
> vinculante → aceptación → guía → tránsito**. §23 define lo que le toca al diseño: **(1) los CUATRO
> correos del ciclo** —oferta, recordatorio, expiración/cancelación y «no procederemos»— con su
> jerarquía, su tono y sus **prohibiciones**, empezando por la que sostiene todo el trato: la
> **condición NM declarada línea por línea, pegada al dinero**, y los **tres montos** (bruto / envío /
> **neto**) con el neto como **única cifra vinculante y única cifra que puede viajar en el asunto**;
> **(2)** ~~el **aviso del descuento de envío en el cotizador**, resuelto como **aritmética ya hecha**
> («recibirías ≈ MX$ 320») dentro del bloque de dinero~~ **⚠ SUPERADO en v2.3.1 (D43) — ver abajo**;
> **(3)** los **cuatro estados nuevos** (`ofertada`, `aceptada`, `en_transito`, `expirada`) en el mapa
> canónico §2.4 —con **`expirada` pintando su MOTIVO, no su estado**, porque sus dos causas significan
> cosas opuestas— y el **`PipelineStepper` de OCHO pasos** con la rama de error como **cierre terminal**,
> no como paso; **(4)** la **mesa de decisión** del admin: **cinco cifras por línea** leídas en dos
> tiempos —un titular `POSICIÓN n/m` y una **tira de cuatro sumandos ordenada por confianza**, con una
> **regla vertical** que separa lo que está en la casa de lo que no, y la **prohibición dura de sumar
> «en camino» con «comprometido»**— más una **sugerencia que informa y nunca preselecciona**;
> **(5)** el estado **`positionUnavailable`**: cuando no se pudo contar, **desaparece la tira entera y
> aparece una frase** — prohibidos el `0`, el `—`, el `?`, la celda vacía y el skeleton eterno.
> §23 es **aditiva**: **cero tokens nuevos** de color y tipografía, cero elementos gráficos nuevos, y
> **una sola pieza de medio nuevo** (la plantilla de correo, §23.4, que traduce papel/tinta a HTML de
> correo con **fallbacks de sistema como diseño real**). Sin entrega de Claude Design para esta feature:
> se compone con lo ya ratificado (`Badge` §7.2, `Banner` §7.5, `DataTable` §7.7, `PipelineStepper`
> §7.9, `AmountBreakdown` §7.12, barra sticky §21.6, reglas §4.3, `--app-header-h` §4.5).
>
> **Corrección v2.3.1 (2026-09-01 — D43, decisión del humano; pase correctivo acotado sobre §23).**
> **El cotizador deja de hablar de montos de envío.** Se retiran del carrito la línea de envío, la resta y
> el neto estimado (`RECIBIRÍAS ≈`), y en su lugar va **una nota de servicio sin cifras**: *«Nosotros
> ponemos la guía de envío y su costo se descuenta siempre de lo que te pagamos: tú no pagas nada de tu
> bolsillo. El monto exacto va en la oferta, antes de que aceptes.»* Razón: **el cotizador es indicativo por
> construcción** —los precios se mueven y puede que no compremos todas las líneas—, así que restarle un
> envío exacto es **precisión falsa**; peor aún, el neto que pintaba era **sistemáticamente optimista**
> (el cherry-pick solo quita líneas), o sea que fabricaba la decepción que R1 existe para evitar. **La resta
> con los tres montos vive solo en la oferta** (correo §23.4.2 + portal §23.5), que es autenticada y usa la
> tarifa **congelada**. **El faltante para el mínimo se queda** (criterio 132), ahora **solo y sin nada de
> envío al lado**. Consecuencia asumida y trabajada: **el correo de oferta es la primera vez que el vendedor
> ve el monto del envío** ⇒ ese correo **repite la cifra del envío en la prosa** (no solo en la tabla), el
> preheader deja de decir «el envío lo ponemos nosotros» **sin** «y se descuenta», y queda prohibida toda
> fórmula que presuponga conocimiento previo («como ya sabías»). Alcance: §23.0 (precisión de R1), **§23.3
> reescrita**, §23.4.2, §23.4.3, §23.4.7, §23.5b/c/d, §23.9, §23.10, §23.11, §23.12 (tres claves retiradas,
> una nueva) y §23.13. **Sigue sin tokens nuevos, sin componentes nuevos y con paridad ES/EN.** La objeción
> de UX —el vendedor cerca del mínimo se entera del ~36% hasta el correo— queda **registrada en §23.3l**,
> con su mitigación de producto: **medir**, y si duele, **mover el dial del mínimo**, no repintar la resta.
>
> **Corrección v2.3.2 (2026-09-01 — barrido de copy vivo tras D16/D31/D43; §23.14 nueva).**
> El primer pase de frontend dejó tres textos **que seguían contando el trato viejo** en pantallas vivas, y
> el barrido de esta versión encontró **cuatro más**. La cabeza de todo es la misma: **D16/D31 cambió quién
> pone el envío y ningún texto anterior a esa decisión se revisó.** Lo que cambia: **(1)** la guía de
> empaque deja de mandar al vendedor a **comprar y asegurar su propia guía** —bajo D16 pagaría **dos
> veces**— y de paso pierde la ambigüedad de llamarse «Guía de envío seguro» en la misma página donde
> «guía» ya significa **la etiqueta que ponemos nosotros**; **(2)** el cotizador del **home** deja de
> rotular su total con «Te pagamos» —un rótulo que **promete depósito** sobre una cifra que no lo es— y
> **entra a §23.3g** como tercera superficie de cotizador; **(3)** `buylist.trustShipping`, que el frontend
> dejó **como recorte**, se **retira**: lo que le quedaba ya estaba dicho **palabra por palabra** dos
> párrafos arriba, y la mitad que faltaba **no puede vivir ahí** porque ese bloque es `muted` y §23.3c
> prohíbe el `muted` para esta regla. Del barrido salen además **dos contradicciones de dinero con D2/D9**
> (`estimateNote` y `trustValidity` seguían prometiendo que **el monto final se confirma al verificar**,
> cuando la oferta es **vinculante y no se reprecia**) y **una de D16** (`buylist.created` invitaba a
> **mandar el paquete** sin nuestra guía). **Cero tokens, cero componentes nuevos, cero cifras nuevas**: es
> un pase **solo de copy y de dónde se pinta**, y **D43 sigue intacta** (ninguna cadena nueva lleva una
> cifra de envío). Alcance: §7.13 reescrita, §23.3c-bis y §23.3g (fila nueva), §23.12 y **§23.14 nueva**.
>
> **Corrección v2.3.3 (2026-09-01 — dictamen del arquitecto sobre `ARCHITECTURE §4.39(n)`).**
> **Los correos del ciclo son CINCO, no cuatro, y «3c» deja de existir.** §23.4.4 trataba la **cancelación
> de la oferta por nuestra parte** como tercera variante del correo 3; **es un correo propio** porque
> **deja la solicitud `cotizada` y VIVA**, mientras 3a y 3b dejan terminales. **El texto ratificado no
> cambia una letra**: cambia de número, pasa a **§23.4.4-bis** y —**lo que de verdad importaba**— sale del
> prefijo que mentía: ~~`expiry.cancelledByUs.*`~~ ⇒ **`offerCancelled.*`**. *Un número mal puesto se nota;
> un prefijo que miente se propaga, porque no se lee: se autocompleta* — y `expiry.*` empujaba cada edición
> futura hacia «se te venció», que es **la frase prohibida** en ese correo. Se corrigen además todas las
> referencias cruzadas al conteo viejo dentro de §23 (§23.0, §23.4.0, §23.4.7, §23.13.2/6/8, §23.14.7).
> **Segunda resolución, en dirección contraria: `buylist.adjust.*` NO se retira** — es **inalcanzable para
> el ciclo nuevo pero necesaria para la cohorte heredada en vuelo**; su retiro va **con gate, no con
> fecha**. De ahí sale una regla que este documento adopta: *el copy de un flujo que se apaga se retira
> cuando **termina su última instancia viva**, no cuando el flujo deja de crearse.* **Cero cambios de
> diseño visual, cero tokens, cero redacción nueva.**
>
> **Corrección v2.3.4 (2026-09-01 — falso positivo levantado por frontend al implementar §23.14).**
> **Se recalibra la regla de QA 2 de §23.14.6**, que marcaba **`buylist.quote.shippingNote`** —la cadena
> **normativa** de §23.3d, citada literal en el mock-up de §23.3c— porque buscaba `te pagamos` / `we pay
> you` exigiendo **«cero coincidencias»** sobre `buylist.quote.*`. El patrón no era el problema: **la
> forma de la regla sí**. El criterio real es más fino —*rótulo que promete depósito **sobre una suma***— y
> `shippingNote` **no es un rótulo ni cuelga de una suma**: es prosa, y «lo que te pagamos» es **el
> referente del descuento**, sin el cual la frase no dice de dónde se descuenta. La regla pasa a
> **(2a)** aserción positiva —el rótulo del total resuelve a `buylist.quote.money.cardsValue` y a ninguna
> otra clave— **(2b)** `grep` acotado a **claves de rótulo de monto** y **(2c)** lista de **supervivientes
> esperados**, que es el patrón que la regla 1 **ya usaba bien** con `grading.*`. Se añade la convención
> a la cabecera de §23.14.6. **Cero cambios de copy, de diseño y de claves**: solo cambia cómo se verifica.
> *Motivo por el que se corrige algo cosmético: una regla que da falsos positivos se deja de correr, y esta
> protege la distinción **rótulo vs. prosa / suma vs. tarifa unitaria** que costó dos rondas fijar.*
>
> **Corrección v2.3.5 (2026-09-01 — dos rótulos de M5 levantados por frontend; §23.8a nueva).**
> **§23.8 tenía un hueco:** especificó **las cuatro colas** de M5 pero **nunca las PESTAÑAS DE ETAPA**, así
> que al crecer el enum el frontend tuvo que **inventar un rótulo** para que tres estados no desaparecieran
> de la pantalla — y lo declaró como decisión suya. **§23.8a llena el hueco y le da a M5 el eje que le
> faltaba: el rótulo dice DE QUIÉN ES EL PENDIENTE** («Por + verbo» cuando es nuestro; de quién depende
> cuando no lo es). Cambian **tres** rótulos y sus claves: **(1)** ~~«Por recibir»~~ ⇒ **«Por ofertar»**,
> porque §23.1a ratificó que `cotizada` significa **«te debemos una respuesta»** y **ahí no hay nada que
> recibir** — el rótulo viejo induce a **esperar** en la única cola donde corre un plazo de 7 días hábiles
> **en contra nuestra**; **(2)** ~~«Ciclo de oferta»~~ ⇒ **«Con el vendedor»** —**la estructura del
> frontend se RATIFICA** (una pestaña y no tres, y `aceptada` jamás bajo un rótulo de «en camino»,
> criterio 156); lo que cambia es la jerga interna por la pregunta operativa—; y **(3)** hallazgo del
> barrido: ~~«Rechazadas»~~ ⇒ **«Piezas rechazadas»**, porque esa pestaña lista **ítems** mientras
> `rechazada` es **un estado de solicitud** que vive en «Cerradas» — **la misma palabra con dos
> significados en la misma pantalla**. Se dejan intactas «Verificando», «Por pagar» y «Cerradas».
> **Es la tercera vez en este ciclo que el defecto es el mismo** —`expiry.*`, «Guía de envío seguro» y
> ahora «Por recibir»—: **un nombre que sobrevive al cambio de significado**. **Cero tokens, cero
> componentes, cero cambios de dato.**
>
> **Corrección v2.3.6 (2026-09-01 — errata de conteo levantada por frontend; regla nueva en §23.12).**
> §23.14.6-3bis decía **«los DIEZ valores de `SellRequestStatus`»**: son **ONCE**. El texto y la tabla de
> §23.8a **siempre repartieron once** (1+3+2+1+4) — mentía **el número suelto**. **El origen es una
> distinción real que no estaba nombrada:** §23.12 lista **diez** claves bajo `status.sellRequest.*` y
> **ahí el diez es correcto**, porque `expirada` **se rotula por su motivo** (§23.1d) y no tiene clave en
> ese espacio. **El diez viajó del sitio donde era cierto al sitio donde no lo es.** No era cosmético: el
> número vivía **dentro de una regla de verificación**, así que un test escrito contra «diez» habría
> dejado **un estado sin comprobar** — y esa regla existe justamente porque un estado sin pestaña **no
> falla ni avisa, desaparece del back-office**. *Una regla de QA con el número mal deja pasar el caso que
> vino a cazar.* Se corrige el dígito y, sobre todo, **se nombra la distinción donde nace** (§23.12:
> «rótulos de estado ≠ estados», con las cuatro magnitudes — 11 estados · 10 claves · 3 de motivo · 4
> terminales) y **se marca §2.4 como no-contable**, que es el otro sitio donde `expirada` ocupa tres filas.
> **Regla adoptada:** *toda afirmación de cobertura se escribe contra el **enum del contrato**, nunca
> contra el número de claves i18n ni de filas de una tabla de color; y si el número y la enumeración
> discrepan, **manda la enumeración**.* **Cero cambios de copy, de claves y de diseño.**
>
> **Corrección v2.3.7 (2026-09-01 — el PORTAL DEL VENDEDOR existe; §23.5g y §23.5h nuevas).**
> La pantalla a la que apunta el correo de oferta **era un 404** y ya no lo es. §23.5 cubría **la oferta
> viva y los cierres**, pero **no** el rechazo confirmado, la oferta incompleta, el 404 neutro ni la puerta
> de sesión: el frontend los construyó, **declaró** las claves que tuvo que nombrar y escribió el EN.
> **Se ratifica el espacio `buylist.offer.*` completo** (inventariado por fin en §23.12) **con tres
> correcciones**: **(C1)** `offer.deadline` decía que la oferta *«se cancela sola»* y **«cancelar» es
> desde v2.3.3 el verbo del correo 5** —lo que hacemos NOSOTROS—; una oferta que muere por silencio
> **vence**. **(C2)** el diálogo de rechazar gana **el neto y la condición**: R2 no admite excepción y es
> el último instante en que el vendedor puede saber qué suelta — con una lista de prohibiciones para que
> informar no se convierta en presionar. **(C3)** el diálogo de aceptar **se reenmarca** (*«La condición es
> la misma para cada carta: {condition}»*) para que **el singular del servidor se pueda CITAR** en vez de
> reescribirse: *cuando un texto del servidor no encaja en el marco de la UI, **se cambia el marco, no se
> duplica el texto**.* Se ratifican el **aviso de oferta incompleta** (R2 hasta el final: sin montos, sin
> plazo, sin acciones), el **404 neutro** atado a la doctrina de §15.7 —con la precisión que lo hace
> seguro: **la puerta de sesión se resuelve por la SESIÓN, nunca por una consulta**, o es un oráculo— y la
> **frase neutra de `rechazada`**, con el reparto `rejectedNow`/`noLongerActive` que solo usa la neutra
> donde la ignorancia es real.
> **§23.5h decide la prosa duplicada: se PERMITE como puente y NO es bloqueante**, porque omitirla sería
> una **regresión de producto** (§23.5b: el portal es el único sitio donde la resta se relee) y duplicarla
> es una **deuda de mantenimiento** — con tres condiciones: **el correo es la fuente**, **verbatim
> verificado** y **la clave se borra** cuando el servidor mande la prosa. Se afina además la verificación
> del teaser del home: **«presente» no era el requisito, «visible» sí** (la nota está en el DOM pero
> `hidden` a 390px). **Tres peticiones al arquitecto en §23.13.9**, y una es de dinero: **una oferta
> inmostrable puede consumirle el plazo al vendedor** y vencerle por un fallo nuestro.
>
> **Corrección v2.3.8 (2026-09-01 — dos decisiones de pantalla, y una rectificación mía).**
> **(1) RECTIFICACIÓN: el defecto del teaser a 390px NO existía.** En v2.3.7 escribí como hecho que la nota
> estaba «en el DOM pero `hidden`». **Es falso**: hay una nota visible en los dos anchos y **§23.14.2a
> estaba cumplida desde el principio**. Lo que fallaba era **la medición** — el home monta el panel **dos
> veces** (por diseño, §23.3g fila 0) **con el mismo identificador**, y la comprobación miraba la copia de
> escritorio. La regla afinada se queda y **gana la mitad que faltaba**: si el diseño manda dos montajes,
> **una comprobación que no desambigüe cuál mira no está midiendo la pantalla**. *Acepté un hallazgo sin
> preguntar cómo se midió y lo escribí en la fuente de verdad; **un diagnóstico falso se propaga igual que
> un nombre falso**. La corrección se deja visible, no se borra.*
> **(2) DOS notas de envío a la vez ⇒ §23.3g-bis: EXACTAMENTE UNA visible por pantalla.** Autoricé las dos
> instancias **por separado y nunca las miré juntas** — el error clásico de especificar por reglas y no por
> pantallas. Se resuelve por construcción con el criterio que sale de por qué existe cada una: **gana la
> más cercana a la decisión**, y la cabecera **solo se monta cuando el carrito no está visible**, que era
> su única razón de ser. Dos párrafos idénticos de cuatro líneas no refuerzan: **son la firma de un error
> de render**.
> **(3) EL TOTAL QUE NO EXPLICA SU PROPIA ARITMÉTICA — §23.3h reescrita + §23.3f-bis nueva.** Con líneas en
> `precio_pendiente`, el bloque decía *«TE FALTAN MX$500… Agrega otra carta»* frente a **un carrito de 999
> cartas**. Un **test E2E** vio el total en cero y **concluyó que el cotizador no sumaba**: *si alguien que
> conoce el sistema se confunde, el vendedor se confunde seguro — y él no abre un issue, cierra la
> pestaña.* Es **R7 aplicada al total**: *un cero que significa «todavía no lo he calculado» no es un
> cero*. §23.3h lo tenía bien **por línea** y le faltaba **el agregado**. Ahora: la explicación se pinta
> **una vez** en el bloque de dinero con `{count}` (y **se retira** la línea repetida por ítem, que con
> cientos de líneas era ruido), dice **qué pasa con esas cartas** para que el vendedor **no las borre**, y
> **el consejo cambia**: `addPricedCard` en vez de `addAnother`, porque «agrega otra carta» ahí es **una
> cinta de correr** — mil cartas más del mismo set siguen sumando cero. **Cero tokens, cero componentes;
> una clave nueva y una que cambia de contenido y de sitio.**

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
| `--color-finish-reverse` | Banda de acabado `reverse_holo` (§16.6) | `var(--color-accent)` (rojo de marca, `#B31217`) |
| `--color-finish-holo` | Banda de acabado `holofoil` (§16.6) | `#1F5C8F` (azul acero) |
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
| SellRequest | `cotizada` | neutral | Cotizada — **esperando NUESTRA oferta** (v2.3, §23.1) |
| SellRequest | **`ofertada`** | **accent** | **Oferta vinculante enviada; el reloj es del vendedor** (v2.3) |
| SellRequest | **`aceptada`** | **accent** | **Dijo que sí; todavía no viaja nada** (v2.3) |
| SellRequest | **`en_transito`** | **primary** | **Un paquete viaja de verdad** (v2.3) |
| SellRequest | `recibida` | info | Recibida física |
| SellRequest | `verificacion` | accent | En verificación |
| SellRequest | `aprobada` | success (outline) | Aprobada, por pagar |
| SellRequest | `pagada` | success | Pagada (SPEI) |
| SellRequest | `rechazada` | danger | Rechazada |
| SellRequest | **`expirada` + `not_shipped`** | **danger** | **Aceptó y el paquete no salió** (v2.3 — se pinta el MOTIVO) |
| SellRequest | **`expirada` + `no_offer`** | **neutral** | **No procedimos con la oferta** (v2.3 — se pinta el MOTIVO) |
| SellRequest | **`expirada` + `null`** | **neutral** | **Fallback legacy: nunca acusa** (v2.3, §23.1) |
| SellRequest | `abandonada` | neutral | Abandonada → inventario |
| SellOffer (admin) | **`pending_authorization`** | **accent (outline)** | **Preparada, esperando al súper-admin — JAMÁS en superficie de cliente** (v2.3) |
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

> **⚠ Excepción de mapeo introducida en v2.3 (§23.1): `expirada` NO tiene un color propio, tiene DOS.**
> Es el único valor de enum del sistema cuyo **color y cuya versalita se eligen por un segundo campo**
> (`expiredReason`), porque sus dos causas significan **cosas opuestas para el vendedor**: una dice que él
> incumplió y la otra dice que **nosotros** no respondimos. Pintar las dos igual —o peor, pintar las dos
> con el rojo de `rechazada`— **acusaría de incumplimiento a alguien a quien nunca le ofertamos**. La
> regla derivada, que vale para toda superficie (cola de M5, ficha, portal del vendedor y reportes):
> **se pinta el motivo, no el estado**, y cuando el motivo falta se cae al **fallback neutro**, nunca al
> acusatorio. Ver §23.1.
>
> **⚠ Consecuencia de conteo (v2.3.6) — esta tabla NO sirve para contar estados.** Por la excepción de
> arriba, `expirada` ocupa **tres filas** aquí y **cero claves** en `status.sellRequest.*`: las filas de
> `SellRequest` en esta tabla **no son** los valores del enum. **Cualquier afirmación de cobertura**
> —particiones, mapas totales, `switch` exhaustivos, reglas de QA— **se escribe contra el enum del
> contrato, nunca contra el número de filas de esta tabla ni contra el número de claves i18n.** El desfase
> ya causó una errata real; la regla y sus cuatro magnitudes están en **§23.12 («rótulos de estado ≠
> estados»)**.

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
> **⚠ Enmendado por §21.8f (v2.1, P-48).** La **segunda línea opcional «Valor de mercado» de las tejas de Compra
> queda RETIRADA**: tejas y listados **no muestran** valor de mercado. El mercado vive **solo en la ficha** y solo
> cuando `priceBasis === "market"` (§21.8). En **bóveda/portafolio** este componente **no cambia**.
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
  - Buylist: ~~`cotizada → recibida → verificación → aprobada → pagada`~~ **⚠ SUPERSEDED por §23.2 (v2.3):
    son OCHO pasos** — `cotizada → ofertada → aceptada → en_transito → recibida → verificación → aprobada
    → pagada`. Las terminales (`rechazada`, `expirada` **con su motivo**, `abandonada`) **no son pasos**:
    son un **cierre** que trunca la cadena (§23.2). La **fase 8 «publicar» tampoco es un paso** — es vida
    de la pieza en inventario, no de la solicitud.
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

### 7.13 Guía de EMPAQUE (`SafeShippingGuide`) — buylist · **reescrita v2.3.2 (D16/D31)**

> **⚠ El componente cambia de tema, no solo de texto.** Nació cuando **el vendedor compraba su propio
> envío**; bajo **D16/D31 la guía (la etiqueta) la ponemos nosotros, siempre**. Un componente que sigue
> enseñando a **comprar y asegurar** una etiqueta le cuesta dinero real al vendedor. Lo que queda de él es
> lo único que sigue siendo suyo: **cómo empaca**. El copy normativo está en **§23.14.1**.

- **Qué es:** cuatro pasos de **empaque** (funda → top loader → sobre/caja rígida → **la etiqueta que le
  mandamos**), visible **antes** de crear la solicitud (PROJECT/AC 34). Menciona explícitamente **sleeve**
  y **top loader**, y **su `intro` lleva la política NM-only** — así **AC 34 se cumple en toda instancia
  del componente**, incluido el **modal**, que hoy no tiene el bloque NM-only al lado.
- **⚠ Se retira la palabra «guía» del título y del enlace.** En la misma página conviven dos «guías»: el
  **manual** y **la etiqueta que ponemos nosotros** (§23.3d). El título pasa a **«Cómo empacar tus
  cartas» / "How to pack your cards"** (claves `safeShipping.title` y `buylist.shippingGuideLink`, que
  **tienen que decir lo mismo**: el enlace, el título del modal y el `h2` de la sección inline salen de
  ahí). *No es cosmético: «Guía de envío seguro» junto a «Nosotros ponemos la guía de envío» se lee como
  «la etiqueta segura», que es exactamente el malentendido que D16 puede producir.*
- **El paso 4 es una regla de dinero, no un consejo.** Dice **quién pone la etiqueta**, **que su costo se
  descuenta** y **qué NO debe hacer el vendedor** (comprar, asegurar, mandar antes de tenerla). Los tres
  van juntos: ver la regla de §23.14.3 —**una cadena que viaja sola no puede decir «ponemos la guía» sin
  «y se descuenta»**—, y este componente **viaja solo** (modal sin contexto de dinero, y §P lo repite en
  el correo de aceptación y en el de la etiqueta).
- **Sin cifras.** D43 alcanza a este componente: **ningún paso lleva monto, rango ni porcentaje de envío**.
- **Formato (sin cambios):** retícula editorial `01–04` — regla superior, numeral mono en `accent`, título
  `text-sm` medium en tinta, cuerpo `text-[13px]` muted. **Sin cajas, sin iconos, sin rellenos.** `columns`
  = 2 (modal, con CTA «Ya lo entendí») · 4 (sección inline al pie de `/buylist`).
- **El alto de fila NO se fija y el paso 4 no se trunca.** Es el cuerpo más largo de los cuatro (§23.14.1)
  y en `lg:grid-cols-4` ocupa ~2 líneas más que sus vecinos. **Prohibidos `line-clamp`, «ver más» y altura
  fija**; si en algún ancho no cupiera, se corrige el contenedor, nunca el texto (misma doctrina §23.12).
- Semántica: `<ol>` con un `<li>` por paso (ya lo es); el numeral es `aria-hidden` (decorativo, el orden lo
  da la lista). Si algún día lleva ilustraciones, con `alt` descriptivo.

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
  /* Bandas de acabado (§16.6) — color ESTRICTAMENTE por finish, nunca por rareza */
  --color-finish-reverse: var(--color-accent); /* rojo de marca sólido, #B31217 */
  --color-finish-holo: #1F5C8F;                /* azul acero */
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
  finish: { reverse: 'var(--color-finish-reverse)', holo: 'var(--color-finish-holo)' },
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
| Buylist cotizador | `POST /buylist/quote` · `GET /buylist/quote-policy` | BuylistQuoter, Banner PAY_AFTER_RECEIPT, SafeShippingGuide, PriceTag, **nota de servicio del envío — sin cifras (§23.3, v2.3.1/D43)** + faltante del mínimo |
| Buylist solicitud | `POST /buylist/requests` | KYC/CLABE inputs, **IneUploader** (único uploader, §7.10), topes (Banner límite), **selector de dirección de origen (§23.3j)** |
| **Buylist — responder la oferta** (v2.3) | `GET /buylist/requests/:id`, `POST …/offer-response` | **PipelineStepper de 8 pasos (§23.2)**, bloque de condición NM, AmountBreakdown de 3 montos, plazo, Aceptar `primary` / Rechazar `secondary` (§23.5) |
| **M5 — mesa de decisión** (v2.3) | `GET /admin/buylist/:id/decision-table`, `POST …/offer` | **Tira de posición de 4 sumandos + titular `POSICIÓN n/m` (§23.6)**, sugerencia en prosa, override + motivo, **barra sticky de totales**, `SIN CONTEO` (§23.7) |
| **M5 — colas del ciclo** (v2.3) | `/admin/buylist/queues/*` | DataTable ×4: por autorizar (con «muere el»), por confirmar envío (con `ALERTA`), guías por cancelar, vendedores vivos (con teléfono) — §23.8 |
| **M5 — pestañas de etapa** (v2.3.5) | `GET /admin/buylist` (+ `…/rejected-items`) | Seis pestañas, **partición TOTAL de `SellRequestStatus`**: Por ofertar · Con el vendedor · Verificando · Por pagar · Cerradas · Piezas rechazadas — **§23.8a** |
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

> **⚠ Enmendado por §21.9 (v2.1, P-48).** El patrón (compacto en la teja + edición en el panel) **no cambia**, pero:
> (a) `source` ya no es `rule|fallback` sino `PriceBasis` ⇒ el mapa de versalitas pasa a
> **`MERCADO/PISO/MANUAL/BOUNTY/PENDIENTE`** (§21.9a); (b) se añaden los sufijos **`·P`** (ganó el piso/el mínimo) y
> **`·!`** (retenida por el guardarraíl, §21.9b); (c) «Sugerido (regla)» → **«Sugerido (curva)»** y «Restablecer a
> regla» → **«Restablecer a la curva»** (§21.9e).

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

**Convención de color de banda — ESTRICTAMENTE por `finish` (v-actual, implementada y desplegada).** El
color de la banda depende **solo** del `finish`, **nunca** de la rareza ni de la composición de variantes.
Cada acabado tiene UN color plano y estable (un mismo `reverse_holo` se ve idéntico en toda la app, sin
variar a lo ancho de la teja):

| `finish` | Banda (3px, borde superior de la casilla/teja) | Etiqueta mono (`text-[10px] uppercase tracking-[0.18em]`) |
|---|---|---|
| `normal` | **Sin banda** (el borde base `--color-border` de 1px) | `NORMAL` en `--color-text-muted` |
| `reverse_holo` | **Rojo sólido** `var(--color-finish-reverse)` (= rojo de marca `#B31217`) | `REVERSE` en `--color-text` |
| `holofoil` | **Azul sólido** `var(--color-finish-holo)` (`#1F5C8F`, azul acero) | `HOLO` en `--color-text` |
| `first_edition_holofoil` | **Sólida tinta** `var(--color-ink)` (`#1A1A18`) | `1ED HOLO` en `--color-text` |

- **Por qué rojo sólido en reverse (cambio):** antes la banda de reverse era un gradiente cálido 90°
  (`#9A6C57 → #B44B3A`, marrón→bermellón) que variaba a lo ancho de la teja y leía inconsistente entre
  superficies. Se sustituyó por **rojo de marca plano** (`--color-finish-reverse`, alias de
  `--color-accent`). Con esto **la banda reverse ya NO es un gradiente**: la única excepción de gradiente
  que queda en el sistema es el logo/lockup (§17.2).
- **`--color-finish-holo` (`#1F5C8F`) es token nuevo:** no existía azul en la paleta. Es el ÚNICO azul del
  sistema y vive **exclusivamente** como banda de acabado `holofoil`; no se usa para estados, enlaces,
  bordes ni fondos (la semántica de atención sigue siendo el rojo, §2.4). Se ratifica el valor tal cual.
- **Accesibilidad:** la banda es decorativa (`aria-hidden`); el significado lo porta la **etiqueta**,
  presente SIEMPRE (nunca banda sin texto), + `aria-label` de la casilla: `Pikachu ex, reverse holo, 3
  piezas`. Contraste de la banda sobre papel `#F4F1EA`: rojo `#B31217` ~6.2:1, azul `#1F5C8F` ~6.2:1, tinta
  ~15:1 — todas ≥ 3:1 (componente UI, §10). Las etiquetas usan tinta/muted (AA de texto).
- **Rojo/azul es un par seguro para daltonismo** (protanopía/deuteranopía/tritanopía): rojo y azul no se
  confunden en ninguno de los tipos comunes y además difieren en tono y luminancia. Aun así el color
  **nunca** es el único diferenciador: el refuerzo textual en versalitas (`REVERSE HOLO` / `HOLOFOIL` /
  `1ED HOLO` / `NORMAL`) + el `aria-label` localizado cumplen el «no-solo-color» (§2.4) en toda superficie.
- **Dónde:** en toda teja/casilla que represente UNA variante (binder M1, cotizador, drill-down header,
  Top Bounties). En fichas de detalle basta el `ListingSpec` (§7.2b); la banda es para retículas.
- La etiqueta NO se traduce distinto por locale (`REVERSE`/`HOLO` son términos del hobby); el `aria-label`
  sí se localiza (`reverse holo` / `holofoil` legibles).

### 16.7 Bounty (P-22) — consola admin + vitrina pública «Top Bounties»

> **⚠ Enmendado por §21.9c/d (v2.1, P-48).** El bounty se **revalida contra la curva vigente** al crear, al cotizar
> y al publicar: un bounty por debajo —**o igual**— de la tarifa vigente **deja de aplicar** y **desaparece de la
> vitrina**. Dos consecuencias en esta sección: (a) el copy de la validación pasa de «mayor o **igual** al sugerido»
> a **«mayor que la tarifa vigente»** (el empate ahora se rechaza); (b) el badge de la teja gana el estado
> **`BOUNTY REBASADO`** (sin glifo de mira) y el bloque del drill-down gana el aviso con las dos cifras. Detalle en
> §21.9c/d.

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
- Estado vacío de la pestaña: `Sin producto sellado en inventario.` + CTA **`Agregar sellado`** (§16.8a — el
  flujo dedicado, NO el buscador de cartas).

### 16.8a Alta de producto SELLADO — flujo dedicado (P-35 → **evolucionado en P-38**)

> **Evolución P-38 (contrato v1.39.1, ARCHITECTURE §4.34) — `SealedProduct` es una entidad real.** En P-35
> el paso 1 leía una **descarga en vivo** de la fuente TCGCSV keyeada por grupo, y cada sellado se anclaba a
> un single representativo del set (bug ETB→«Tropius #1 · sealed · SIN MAPEO»). P-38 **cura de raíz**: cada
> presentación (ETB, **UPC**, Booster Bundle, box, tin, blíster, **collection**) es una **fila persistida**
> (`SealedProduct`) con identidad propia, descargada por un **sync**. Cambian **cuatro** cosas de UI y **nada
> más** del patrón:
> 1. El paso 1 ya **no** es un grid único: se parte en **DOS SECCIONES por `origin`** — «Del set»
>    (`set_main`) y «Promos/colecciones» (`promo_collection`) — **decisión del humano v1.39.1**.
> 2. La teja gana **subtipos nuevos** (`UPC`, `collection`) y un **badge «Principal»**.
> 3. Aparece el estado **«Sincronizar»** (`needsSync`) cuando el set aún no tiene catálogo descargado, más el
>    flujo de **enlazar un grupo promo/colección**.
> 4. El fallback money-safe deja de ser «capturar sin catálogo» y pasa a ser un **input de precio MANUAL**
>    auditado, disponible para **`vault_operator+`** (decisión del humano v1.39.1), SOLO cuando `marketRef`
>    es null.
>
> La fuente ahora es `GET /admin/inventory/sealed-products?setId=&q?&origin?&principalOnly?`
> (`SealedProductListResponse = { set, needsSync, groups: SealedSetGroupDTO[], data: SealedProductDTO[] }`);
> el alta sigue reusando `POST /admin/inventory/items/batch` con **`sealedProductId`** (el backend deriva
> identidad, imagen, nombre y subtipo, y congela el snapshot ⇒ la pieza nace «ETB Surging Sparks», no
> Tropius). **Aditivo: cero tokens nuevos** — reusa Modal/Combobox/Select/Input/Banner/EmptyState y las pills
> de subtipo/condición (§7.1b, §2.4).

> **Problema que corrigió P-35 (contexto):** la pestaña «Sellado» caía en el **modal buscador de CARTAS**
> (`AddItemModal` sobre singles de pokemontcg.io); al elegir Tipo=Sellado devolvía **singles** (Tropius,
> Grubbin…). Un ETB, un booster box o un blíster **no son cartas**: son productos. Este flujo los trata como
> lo que son. Se conserva la **decisión estructural** de P-35 (elegir un PRODUCTO, no un single; reusar
> `QuickAddSection` §16.5 para el «cómo se da de alta»); P-38 solo sustituye la fuente por la entidad real.

**Disparadores (todos abren el MISMO flujo, `SealedAddFlow`):**
1. CTA `Agregar sellado` en el **header de la pestaña Sellado** (índice §16.8), siempre visible (junto al
   buscador), variante `primary`. Es el camino principal — no depende de que ya exista inventario.
2. CTA del **estado vacío** de la pestaña y del estado vacío de un **detalle de set** sin el grupo buscado.
3. Acción `Agregar otra presentación` dentro del **detalle de set** (§16.8): abre el flujo con el set
   **precargado**, saltando el paso 1.

**Contenedor:** modal ancho (§7.6, radio 0, overlay de tinta, focus-trap, `Esc` cierra) o, en `< md`, sheet
casi a pantalla completa. Es un **asistente de 2 pasos** con un stepper textual mono arriba
(`PASO 1 DE 2 · ELIGE PRODUCTO` → `PASO 2 DE 2 · CANTIDAD Y ORIGEN`); nunca cambia de layout entre pasos
(reserva de alto estable, §9.4). Botón `Atrás` (ghost) vuelve al paso 1 conservando la selección.

**Paso 0 — Set (solo si no viene precargado).** Reusa el **Combobox de sets con año** (§6.3, mismo de
`AddItemModal`: `Surging Sparks (2024)`), buscable. Al elegir set se llama a `sealed-products?setId=` y se
puebla el paso 1 con sus **secciones**. Sin set elegido, el paso 1 muestra el placeholder
`Elige un set para ver su producto sellado.`

**Paso 1 — Presentaciones del set en DOS SECCIONES — `SealedProductPicker`.**
El campo `origin` de cada `SealedProductDTO` **particiona** la lista en dos secciones apiladas (nunca dos
grids sueltos sin encabezado). El orden entre secciones es fijo: **«Del set» primero, «Promos/colecciones»
después** — lo principal arriba. Cada sección es un `<section>` con un encabezado propio (`<h3>` mono
versalitas + contador) y su propio `role="listbox"`; la selección es **única en todo el paso** (una sola
teja activa entre ambas secciones, un solo `sealedProductId` viaja al paso 2).

- **Sección «Del set»** (`origin=set_main`) — encabezado `DEL SET · {n}`, subcopy `text-xs muted`
  `Box, ETB, UPC y bundles de {set}.` Contiene el grupo principal del set. **Orden interno** por el contrato
  (§4.34c): **principales primero** (`isPrincipal desc`), luego `sortOrder` canónico
  (`upc=0, etb=1, box=2, bundle=3, tin=4, blister=5, collection=6`), luego `name`. Es decir, box/ETB/UPC/
  bundle encabezan; tins/blísters/colecciones sueltas del mismo grupo caen después.
- **Sección «Promos/colecciones»** (`origin=promo_collection`) — encabezado `PROMOS Y COLECCIONES · {n}`,
  subcopy `text-xs muted` `Blísters, tins y colecciones promo (incl. Mega Evolution).` Mismo orden interno.
  Aquí caen los productos de los grupos `promo_collection` enlazados al set (§4.34b). **Nunca** aparecen
  singles promo (el sync los descarta; la frontera es del backend).
- **Grid dentro de cada sección:** mismas tejas, densidad 2 col (móvil) → 3 (sm) → 4 (lg); flechas +
  `Home/End` navegan **dentro** de la sección, `Tab` salta entre secciones. Foco visible (anillo de acento,
  §8.2), `aria-selected`.
- **Buscador `q`** (`Input` §6.2) **arriba de ambas secciones**: filtra por nombre en las dos a la vez
  (envía `q` al endpoint). Si el filtro deja una sección vacía, esa sección colapsa a su micro-vacío (abajo),
  la otra permanece.
- **Toggle `Solo principales`** (`Switch`/checkbox, mapea `principalOnly=true`): oculta las secundarias
  (tin/blíster/collection) en ambas secciones para el operador que solo mete cabeceras. Off por defecto.

**Teja `SealedProductTile` (una fila de `SealedProduct`) — anatomía:**
- **Imagen real del producto** (`imageUrl` de la API, validada server-side contra el host allowlist): contenedor
  `aspect-[5/7]` con `object-contain` sobre **pozo** `surface-2` (las cajas son más cuadradas que una carta y
  **no se recortan**, §7.1b). `alt` = nombre; **fallback** honesto si la remota no carga o `imageUrl` es null:
  bloque pozo con el `cleanName` centrado en mono (nunca un roto, §5).
- **Nombre** (`text-sm` medium, `lang="en"`, `line-clamp-2`): `Surging Sparks Elite Trainer Box`. Muestra
  `cleanName` si viene; si no, `name`.
- **Pill de subtipo** (§7.1b, tono `info`, mono versalitas) — set ampliado P-38:
  `ETB` / `UPC` / `BOX` / `BUNDLE` / `TIN` / `BLISTER` / `COLLECTION` (labels `status.sealedSubtype.*`). Si
  `subtypeInferred=true` la pill lleva un punto/afijo tenue (`·`) con `title=Subtipo inferido, revisable` —
  señal honesta de que es heurística, curable en el paso 2. **`UPC`** y **`COLLECTION`** son los tonos nuevos;
  reusan el mismo estilo de pill (sin color nuevo).
- **Badge «Principal»** (`isPrincipal=true`): micro-pill `outline` discreta en la esquina de la imagen
  (`PRINCIPAL`, mono, `text-[10px]`), redundante con el orden pero útil cuando el operador escanea. Las
  secundarias no llevan badge.
- **Referencia de mercado (money-safe):** renglón mono `tabular-nums` bajo el nombre, leído de
  `marketRef: PriceInfo | null`. Con precio (`status:"priced"`, `referenceMxnCents`): `MX$ 1,250.00` en
  `text-muted` con sufijo `MERCADO`. **Sin precio** (`marketRef` null **o** `status:"pending"`): pill
  **`SIN PRECIO DE MERCADO`** (warning outline, §2.4) — **jamás `MX$ 0.00` ni un precio inventado** (§7.5,
  regla de dinero). La teja **sigue seleccionable** (se puede comprar y, en P-38, fijar precio manual en el
  paso 2; lo único que se bloquea sin precio es la *aportación* directa).
- **Selección:** una sola teja activa (borde `--color-border-strong` + fondo `surface-2` + check §7.1). Al
  elegir, `Continuar` (primary) se habilita y avanza al paso 2 (Enter en la teja también avanza).

**Estados del paso 1:**
- **Carga:** por cada sección, grid de skeletons con la retícula final (§18.6 — imagen pozo + 2 barras), no
  spinner. El encabezado de sección se muestra como barra skeleton.
- **`needsSync:true` (catálogo aún no descargado) — estado «Sincronizar»:** cuando la respuesta trae
  `data:[]` **y** `needsSync:true`, el paso 1 NO muestra un vacío mudo: pinta un **`EmptyState` de acción**
  con icono neutro, título `Aún no descargamos las presentaciones de este set.` y copy
  `Sincroniza el catálogo de sellado desde la fuente para ver ETB, UPC, bundles y promos.` Debajo:
  - **CTA `Sincronizar` (primary)** — visible **solo a `super_admin`** (el sync es `super_admin`). Dispara
    `POST /admin/inventory/sealed-products/sync { setId }`. Entra en **estado cargando** (botón con spinner +
    label `Sincronizando…`, el modal no se cierra); al volver relee `sealed-products` y las secciones se
    pueblan. Resultado en banner `success` con el resumen honesto del `SealedSyncResultDTO`:
    `12 presentaciones · 9 con precio · 3 pendientes de precio` (usa `productsUpserted`, `pricedCount`,
    `pendingPriceCount`; **nunca** presenta las pendientes como 0, las nombra «pendientes»). Si el sync falla
    (`502 UPSTREAM_ERROR`): banner `danger` `No pudimos sincronizar (fuente TCGCSV no disponible). Reintenta
    en un momento.` + `Reintentar`.
  - **Para `vault_operator`** (que no puede sincronizar): el mismo `EmptyState` **sin** el CTA, con copy
    `Este set aún no tiene catálogo de sellado. Pídele a un administrador que lo sincronice.` (no botón muerto,
    no falso permiso). El operador no queda bloqueado del todo: conserva el input de precio manual una vez que
    exista al menos un producto que elegir; sin catálogo, no hay teja que capturar (es honesto).
- **Enlazar un grupo promo/colección (curación, `super_admin`):** cuando la sección «Promos/colecciones»
  está vacía pero el operador sabe que faltan (p. ej. los blísters de Mega Evolution viven en otro grupo
  TCGCSV), un enlace secundario bajo la sección `Falta un grupo de promos/colecciones…` abre un
  **sub-panel de curación** (`SealedGroupLinker`): lista de candidatos de
  `GET /admin/inventory/sealed-products/sync/candidates?setId=` (`TcgcsvGroupCandidateDTO`) como filas con
  **nombre del grupo**, `publishedOn`, un **medidor de confianza** (`matchScore` → barra/etiqueta
  `Coincidencia alta/media/baja`, orientativa, nunca una cifra cruda sola) y estado `Ya enlazado` cuando
  `alreadyLinked`. Cada candidato no enlazado tiene botón `Enlazar como promo/colección`
  (`POST /admin/inventory/sealed-sets/:setId/groups { tcgplayerGroupId, kind:"promo_collection" }`) que, al
  volver, dispara un sync del set y repuebla las secciones. Es **curación** — visible solo a `super_admin`;
  para `vault_operator` el enlace no existe. Money-safe: enlazar/sincronizar **jamás** fija precio.
- **Vacío legítimo tras sync** (el set realmente no tiene sellado en la fuente): `EmptyState`
  `Este set no tiene producto sellado en la fuente.` + nota `text-xs muted`
  `Si crees que falta un grupo (promos/colecciones), revisa los candidatos.` (enlace al `SealedGroupLinker`,
  solo `super_admin`). No es un error.
- **Error de la fuente al listar precios live (`502 UPSTREAM_ERROR`):** el listado de productos **sigue
  visible** (los `SealedProduct` son persistidos), solo la `marketRef` live cae a «SIN PRECIO DE MERCADO»;
  banner `warning` no bloqueante `No pudimos leer precios de mercado en vivo; se muestran las últimas
  referencias conocidas o “sin precio”.` No se cae el alta.

**Paso 2 — Cantidad y origen — REUSA `QuickAddSection` §16.5 + controles de sellado + precio manual.**
Bajo un **resumen fijo** del producto elegido (miniatura 56×78 `object-contain` + nombre + pills subtipo/
referencia + badge «Principal» si aplica), se pinta:
- **Subtipo** (`Select` §6.3, opciones `box | etb | upc | bundle | tin | blister | collection`, labels
  `status.sealedSubtype.*`): **prellenado** con el subtipo del producto; editable (útil sobre todo si venía
  `subtypeInferred`). Requerido. *(Nota: el backend deriva el subtipo del `SealedProduct`; este control
  refleja/permite corregir el snapshot de la pieza.)*
- **Condición del sellado** (`Select` §6.3, `mint | minor_box_damage`, labels `status.sealedCondition.*`):
  default `Mint`; helper `text-xs muted` `sealedConditionHint` (no afecta el precio, §K de PROJECT).
- **`QuickAddSection` §16.5 tal cual:** stepper de **Cantidad** (default 1, mín 1) + las dos tarjetas-radio
  **`Comprar` / `Aportación`** con su CTA `Dar de alta al inventario`. Reglas money-safe heredadas:
  - **Comprar:** input de dinero (precio pagado por pieza). Para sellado el `buyEffectiveCents` es `null`, así
    que abre vacío con helper `Sin sugerido — captura el precio pagado.` La compra con precio capturado
    SIEMPRE es válida (con o sin mercado).
  - **Aportación:** muestra la **referencia de mercado** del producto como valor no editable. Si el mercado
    resuelto es `null`, la tarjeta se **deshabilita** con el pill `PRECIO PENDIENTE` **a menos que** el
    operador fije el **precio manual** (abajo), que la rehabilita usando ese valor. Money-safe: nunca se
    valúa una aportación sin un mercado explícito (vivo o manual).

**Precio MANUAL money-safe (P-38) — `SealedManualMarketField`.**
Aparece en el paso 2 **SOLO cuando** `marketRef` del producto es `null`/`pending` (sin mercado vivo ni
cacheado) **y** el usuario es **`vault_operator+`** (decisión del humano v1.39.1 — el operador de bóveda opera
el alta; no se restringe a `super_admin`). Anatomía y reglas:
- Bloque enmarcado (`surface-2`, borde `warning` sutil) bajo la referencia, con encabezado
  `PRECIO DE MERCADO PENDIENTE` (mono versalitas) y copy honesto:
  `Esta presentación no tiene precio de mercado. Puedes fijarlo manualmente para valuar la aportación.`
- **Input de dinero** (`Input` money §6.2, `tabular-nums`) etiquetado `Precio de mercado manual (MX$)`,
  **abierto vacío** — **jamás prellenado con 0 ni con un sugerido inventado** (§7.5). Mapea a
  `manualMarketMxnCents` de la línea del batch. Validación de UI: **`> 0`** (helper de error
  `Debe ser mayor a 0.` en `error`; el backend responde `422 VALIDATION_ERROR` si `≤ 0`).
- **Aviso de auditoría** (`text-xs muted`, con micro-icono):
  `Es un override auditado: queda registrado a tu nombre y alimenta la valuación de esta pieza.` (refleja
  `AuditLog inventory.sealed_manual_market`). Sin ánimo de fricción, pero explícito: el operador sabe que
  **queda huella**.
- **Opcional, no forzado:** si el operador **no** lo llena, la línea se envía sin `manualMarketMxnCents` y el
  backend la deja **`422 PRICE_PENDING`** (curable después). La UI lo anticipa con un helper bajo el CTA:
  `Sin precio manual, la aportación quedará pendiente de precio.` Así la consecuencia money-safe es
  **visible**, no silenciosa. *(La **compra** con precio pagado no necesita este campo; sigue siendo válida.)*
- **Cuando SÍ hay mercado vivo, este campo NO se muestra** — el override manual solo llena el hueco `null`,
  **nunca pisa un mercado ya resuelto** (el backend responde `422 MANUAL_MARKET_NOT_ALLOWED` si se intentara;
  la UI simplemente no ofrece el campo en ese caso).

**Resultado por-ítem (§16.5b):** banner `success` con los folios (`3 piezas dadas de alta · INV-000210 a
INV-000212`) o banner `danger` sticky `role="alert"` con la causa por línea (`PRICE_PENDING`,
`SEALED_PRODUCT_NOT_FOUND`, etc.). Tras el éxito, el flujo ofrece `Agregar otra presentación` (vuelve al
paso 1 con el set intacto) o `Cerrar` (refresca el detalle del set §16.8, resaltando las filas nuevas 3s).

**Qué se retira / cambia respecto a P-35:**
- El **camino de respaldo «Capturar sin catálogo de producto»** (mini-form manual anclado al single del set)
  **se retira**: era money-unsafe (nacía «SIN MAPEO»). Su función la cubren ahora el **estado «Sincronizar»**
  (para poblar el catálogo) y el **precio manual auditado** (para la pieza sin mercado). Ya no se etiqueta un
  single como sellado desde este flujo.
- El paso 1 deja de ser un **grid único** en vivo; es **dos secciones** sobre datos persistidos.
- `AddItemModal` (buscador de cartas) sigue **sin** ofrecer `productType=sealed` (decisión P-35 intacta). El
  alta de sellado vive **solo** en `SealedAddFlow`.
- El estado vacío de la pestaña (§16.8) conserva su CTA `Agregar sellado`.

**Accesibilidad (resumen):** stepper anunciado (`aria-current` en el paso activo); **dos** `listbox`
etiquetados (`aria-label="Del set"` / `"Promos y colecciones"`), `option`s navegables por flechas + `Home/End`
dentro de cada uno, foco visible, `aria-selected`, `aria-label` por teja que incluye subtipo y estado de
precio (`Surging Sparks Elite Trainer Box, ETB, principal, sin precio de mercado`); secciones como
`<section>` con `<h3>` real (jerarquía de encabezados, no solo estilo); imágenes con `alt` = nombre + fallback
textual; el CTA `Sincronizar`, el `SealedGroupLinker` y el `SealedManualMarketField` **solo se renderizan
cuando el rol los habilita** (nada de botones muertos ni foco trampa); todos los `Select`/`Input` con `label`
visible y `htmlFor`; el input de precio manual anuncia su error con `aria-describedby`; `Continuar` se
deshabilita sin selección. Orden de tabulación: set → buscador → toggle principales → sección «Del set» →
sección «Promos/colecciones» → (curación, si super_admin) → Continuar → (paso 2) subtipo → condición →
cantidad → tarjetas de origen → precio manual (si aplica) → CTA. Objetivos táctiles ≥ 44px. Dinero con `Intl`
+ `tabular-nums` (§9.3); nunca `MX$ 0.00` como marcador.

**Componentes reutilizados vs nuevos:**
| | Componente | Origen |
|---|---|---|
| **Reusa** | `QuickAddSection` (cantidad + Comprar/Aportación + resultado por-ítem) | §16.5 (P-19) |
| **Reusa** | `SealedAddFlow` (asistente de 2 pasos), `SealedProductTile` (evolucionada con UPC/collection + badge principal) | §16.8a (P-35) |
| **Reusa** | `Modal`/sheet, `Combobox` de sets, `Select`, `Input` money, `Banner`, `EmptyState`, `QueryState`, `Switch`, skeleton de retícula | §6, §7.6, §18.6 |
| **Reusa** | Tratamiento de imagen de sellado (`aspect-[5/7]` + `object-contain` sobre pozo + fallback) y pills subtipo/condición | §7.1b, §2.4 |
| **Nuevo (P-38)** | `SealedProductPicker` (dos secciones por `origin`, reemplaza el grid único) | P-38 |
| **Nuevo (P-38)** | Estado «Sincronizar» (`EmptyState` de acción + resumen del `SealedSyncResultDTO`) | P-38 |
| **Nuevo (P-38)** | `SealedGroupLinker` (curación de grupos promo/colección, `super_admin`) | P-38 |
| **Nuevo (P-38)** | `SealedManualMarketField` (precio manual auditado, `vault_operator+`, solo si `marketRef` null) | P-38 |

**Coordinación con el contrato (resuelto en v1.39.1 — sin solicitudes abiertas):**
La solicitud abierta de P-35 (endpoint de catálogo por `setId` + mapear-al-crear con `tcgplayerProductId`)
**quedó resuelta** por el arquitecto en §4.34 / contrato v1.39.1: `GET /admin/inventory/sealed-products`
entrega la identidad persistida por `setId` con `imageUrl`, `subtype` (incl. `upc`/`collection`),
`isPrincipal`, `origin` y `marketRef: PriceInfo | null`; el alta por `sealedProductId` deriva identidad y
congela snapshot server-side. **No hay dato ni pantalla que el contrato no cubra.** Únicas notas de diseño
(no bloqueantes, informativas):
1. **Precio manual por `vault_operator`** — la decisión del humano (v1.39.1) abre el input de dinero al
   operador de bóveda. El diseño lo hace **auditado y visible** (aviso de huella + validación `>0` + nunca 0).
   Queda **marcado para la fase de seguridad por release** (pentester + seguridad), como pide §4.34d: input de
   dinero por rol operador — verificar que solo llene el hueco `null`, `>0`, auditado, sin pisar mercado vivo.
2. **`GET /admin/inventory/sealed-catalog` (P-35) queda DEPRECADO**; el flujo ya no lo consume. Si en algún
   punto el front todavía lo llamara en transición, el shape money-safe no cambia.

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
- **P-35 — alta de sellado dedicada:** `admin.sealedAdd.{title,step1,step2,back,continue,pickSet,pickSetPlaceholder,gridLabel,searchProducts,marketRef,noMarket,noProducts,noProductsHint,upstreamError,retry,subtype,condition,addAnother,close}` (el paso 2 reusa las claves `admin.quickAdd.*` ya existentes; subtipo/condición reusan `status.sealedSubtype.*` / `status.sealedCondition.*`). *(Retiradas en P-38: `fallbackLink,fallbackNotice,fallbackProductName` — el camino «capturar sin catálogo» se elimina.)*
- **P-38 — `SealedProduct` (entidad real):**
  - Secciones por `origin`: `admin.sealedAdd.section.{fromSet,fromSetSub,promoCollection,promoCollectionSub}` · `admin.sealedAdd.principalOnly` (toggle) · `admin.sealedAdd.principalBadge`
  - Subtipos nuevos: `status.sealedSubtype.{upc,collection}` (además de `box,etb,bundle,tin,blister`) · `admin.sealedAdd.subtypeInferredHint`
  - Estado sincronizar: `admin.sealedAdd.sync.{title,body,cta,loading,resultSummary,pendingNote,error,retry,notAllowed}` (resumen usa `SealedSyncResultDTO`: `productsUpserted/pricedCount/pendingPriceCount`)
  - Curación de grupos promo: `admin.sealedAdd.linker.{title,open,candidateName,confidence.high,confidence.mid,confidence.low,alreadyLinked,linkCta,empty}`
  - Precio manual money-safe: `admin.sealedAdd.manualMarket.{eyebrow,body,label,mustBePositive,auditNotice,pendingIfEmpty}`
  - Errores nuevos: `error.SEALED_PRODUCT_NOT_FOUND`, `error.MANUAL_MARKET_NOT_ALLOWED`
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
4. **Catálogo de producto sellado para el alta dedicada (P-35, §16.8a) — ✅ RESUELTO en P-38 (v1.39.1).**
   La solicitud (endpoint de catálogo por `setId` + mapear-al-crear con `tcgplayerProductId`) quedó atendida
   por el arquitecto en ARCHITECTURE §4.34 / contrato v1.39.1: la entidad **`SealedProduct`** persiste la
   identidad por set; `GET /admin/inventory/sealed-products?setId=` (`vault_operator+`) la lista con `imageUrl`,
   `subtype` (incl. `upc`/`collection`), `isPrincipal`, `origin` y `marketRef: PriceInfo | null` (null honesto);
   el alta por `sealedProductId` deriva identidad y congela snapshot server-side (la pieza nace «ETB …», no
   Tropius). **SB-D5 se cura de raíz.** Nota de seguimiento única: el **precio manual por `vault_operator`**
   (decisión del humano v1.39.1) es un input de dinero por rol operador → queda **marcado para la fase de
   seguridad por release** (input auditado, `>0`, solo llena hueco null, no pisa mercado vivo). Ver §16.8a.

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
- **El degradado `#B31217→#4A0D0D` es la ÚNICA excepción de gradiente** del sistema. Vive
  **exclusivamente** en el logo/lockup. Nunca en botones, fondos, textos de UI ni bordes. *(Actualización:
  la banda reverse de §16.6 dejó de ser gradiente y pasó a **rojo sólido** `var(--color-finish-reverse)`
  (=`#B31217`); ya no cuenta como excepción de gradiente. El logo es ahora el único gradiente permitido.)*
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

1. **`FinishBand` arriba de la teja** (primer elemento, encima del arte), idéntica a `BinderTile`,
   coloreada ESTRICTAMENTE por `finish` (§16.6):
   - `normal` → sin banda (borde base).
   - `reverse_holo` → rojo sólido `var(--color-finish-reverse)` (`#B31217`).
   - `holofoil` → azul sólido `var(--color-finish-holo)` (`#1F5C8F`).
   - `first_edition_holofoil` → sólida tinta `var(--color-ink)` (`#1A1A18`).
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
- **Sin gradientes nuevos:** la ÚNICA excepción de gradiente es el logo (§17.2); la banda reverse (§16.6)
  ya es rojo sólido. El FAB, el drawer y las tejas no llevan degradado.

### 18.8 Accesibilidad (además de §8.2)

- **Contraste (bandas de acabado, §16.6):** banda reverse (rojo `#B31217`) sobre papel 6.2:1; banda
  holofoil (azul `#1F5C8F`) sobre papel ~6.2:1; banda 1ed (tinta) ~15:1 — todas ≥ 3:1 (componente UI).
  Par **rojo/azul seguro para daltonismo** + refuerzo textual (`REVERSE HOLO`/`HOLOFOIL`), «no-solo-color».
  accent `#B31217` sobre papel 6.2:1; FAB tinta/papel ~15:1; badge contador papel-sobre-accent 6.2:1
  (§17.2). Nada más que re-verificar en §10.
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

> **⚠ Enmendado por §21 (v2.1, P-48) en la zona de editores de precio.** Los editores de **reglas por rareza**
> (Sección 4 buylist / Sección 5 venta) y de **tiers + mapa rareza→tier** **se retiran** y los sustituye el
> **editor de la curva** (§21.1). En consecuencia: (a) las referencias de §19.1 a «Reglas buylist / Reglas venta»
> se leen como «**Curva de precio**»; (b) **«Unificar rarezas» (§19.5) cambia de anfitrión** — se ancla al nuevo
> bloque «Salud del catálogo de rarezas» y su microcopy se corrige (§21.7b). **Todo lo demás de §19 sigue vigente
> tal cual**: la jerarquía de los grupos Datos / Catálogo / Avanzado, el reencuadre del selector de proveedor
> (§19.7), estados y accesibilidad **no cambian**.

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

---

## 21. Curva de precio por valor de mercado (v2.1 — P-48): editor de puntos, «Valor de mercado» condicional y bounty rebasado

> **Procedencia:** `PROJECT.md` **§N (v2.0, LOCKED)** · `docs/ARCHITECTURE.md` **§4.36** · `docs/API_CONTRACT.md`
> rev **`v2.0-pricing-curve`** (§M2 «Curva de precio por VALOR DE MERCADO», `PricingCurveDTO`, `PriceBasis`,
> `VariantPricingDTO`).
> **Numeración:** en la secuencia propia de este documento esta entrega es **v2.1**, porque **v2.0 ya nombra el
> makeover del storefront (§20)**. No son la misma entrega; el «v2.0» de PROJECT/ARCHITECTURE es esta §21.
> **Origen: NO hubo entrega de Claude Design para esta feature.** Es una pantalla de back-office nacida del
> contrato, más dos reglas de presentación en superficies ya diseñadas. Por eso §21 **no inventa lenguaje**:
> extiende el vigente — papel/tinta (§2), Zen Old Mincho + Archivo + JetBrains Mono (§3), **reglas y aire en vez
> de cajas y sombras** (§4.3), **cifras y estados en mono versalitas** (§2.4, §3.1, §20.14) y **cero rellenos de
> color en estados** (§2.3). **Cero tokens nuevos**, cero elementos gráficos nuevos.

### 21.0 Qué entra, qué se retira y qué NO se toca

**Entra (tres superficies):**

| # | Superficie | Qué es |
|---|---|---|
| 1 | **M2 › Curva de precio** (`super_admin`) | **Editor de la tabla de puntos** de longitud variable — dos curvas (venta y compra) + **piso**, **bin** y **escalera de redondeo**, con validación al guardar y **previsualización** del efecto (§21.1–§21.7) |
| 2 | **Ficha de carta y ficha/ventana de sellado** (público) | El bloque **«Valor de mercado» desaparece** cuando el mercado no fijó el precio, y la retícula de datos **se recompone sin hueco** (§21.8) |
| 3 | **Binder de M1** (`super_admin` / lectura `vault_operator`) | **Alerta de bounty rebasado** y **guardarraíl visible** (rareza premium en el piso/bin) en la teja y en el drill-down (§21.9) |

**Se retira del diseño (con su pantalla, no se corrige — §N.9):** el editor de **reglas por rareza**, el editor de
**tiers + mapa rareza→tier**, el eje de **reglas por acabado** y el par de modos **`fijo` / `porcentaje`**. Con ellos
se va el **texto falso** que causó P-48: la etiqueta **«Piso (MX$)»** sobre un campo que era **precio absoluto**, el
placeholder **«Hereda tier»** y el hint «Sin regla propia, el acabado hereda la del tier de su rareza».
**Regla dura de esta sección: ninguna etiqueta puede prometer un comportamiento que el sistema no tiene.** Si un
campo se llama «piso», el número **tiene** que ser un piso.

**No se toca:** el **sellado** conserva su editor de **spreads por presentación** (§16.8, §K) — su precio antes y
después es idéntico; la **bóveda/portafolio** del cliente y su gráfica de tendencia (§7.17); el **cotizador**
(§7.14, §18) como flujo; los **overrides manuales**, que siguen siendo absolutos; y toda la piel de §2–§4.

> **El sesgo de error gobierna la pantalla (PROJECT §N.0).** *Precio de más = venta perdida (recuperable); precio
> de menos = carta perdida (irrecuperable).* Se traduce a diseño en cuatro decisiones concretas de §21: (a) **nada
> se guarda solo** — la pantalla es un borrador con guardado explícito y diff confirmable; (b) **el previsualizador
> es obligatorio**, porque una tabla de puntos no dice cuánto sale una carta; (c) **el error no interrumpe mientras
> se teclea**, para que nadie aprenda a ignorarlo; (d) **lo que dejó de aplicar se dice, no se calla** (el bounty
> rebasado y la pieza retenida por el guardarraíl tienen estado propio y visible).

---

### 21.1 M2 › Curva de precio — anatomía de la pantalla (`PricingCurveEditor`)

Reemplaza, **en el mismo lugar** que ocupaban los editores retirados dentro de la zona «editores de reglas de
precio» de M2 (§19.1), a: Reglas de buylist, Reglas de venta, Precios por tier y Asignación de rarezas a tiers.
Consume `GET`/`PUT /api/v1/admin/pricing/curve` (`PricingCurveDTO`).

```
┌ CURVA DE PRECIO ─────────────────────────────────────────────┬──────────────────────────┐
│ h2 serif  «Curva de precio»                                  │  ┌ PROBAR UN MERCADO ──┐ │
│ lead text-sm muted (§21.1a)                                  │  │  (§21.5a)           │ │
│                                                              │  │  sticky en ≥ xl     │ │
│ ── CONSTANTES ─────────────────────────────────────────────  │  └─────────────────────┘ │
│   Piso de venta [MX$ 25.00]   Mínimo de compra [MX$ 1.00]    │  ┌ TABLA DE REFERENCIA ┐ │
│                                                              │  │  (§21.5b)           │ │
│ ── VENTA ──────────────────────────────────────────────────  │  └─────────────────────┘ │
│   tabla de puntos  (§21.2)                    [+ Agregar]    │  ┌ LA CURVA (opcional) ┐ │
│   ── REDONDEO ↑ (solo venta) ── escalera (§21.3c)            │  │  (§21.5c)           │ │
│                                                              │  └─────────────────────┘ │
│ ── COMPRA ─────────────────────────────────────────────────  │                          │
│   tabla de puntos  (§21.2)                    [+ Agregar]    │                          │
└──────────────────────────────────────────────────────────────┴──────────────────────────┘
┌ barra de guardado (sticky abajo) ──────────────────────────────────────────────────────┐
│  2 CAMBIOS SIN GUARDAR                                     Descartar   [Guardar curva] │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Layout:** dos columnas en `≥ xl` (editor 2fr / previsualizador 1fr, el previsualizador **sticky** anclado con
  `top-[var(--app-header-h,0px)]`, §4.5); una sola columna apilada por debajo, con el previsualizador **entre las
  dos curvas y la barra de guardado** (nunca al final de un scroll largo).
- **Orden VENTA → REDONDEO → COMPRA, no alfabético ni «compra primero».** Es el orden del invariante: la compra
  vive **debajo** de la venta en todo el dominio, así que leer de arriba a abajo enseña la regla. El **redondeo
  anida dentro de VENTA** porque solo aplica a ese eje (la compra **no se redondea**).
- **Separadores:** cada bloque abre con `eyebrow` mono (`CONSTANTES` / `VENTA` / `REDONDEO ↑` / `COMPRA`) sobre una
  **regla superior** de 1px (`--color-border`) y `<section role="group" aria-labelledby>` (mismo patrón §19.1). Sin
  cajas, sin sombras, sin fondos de bloque.
- **Rol:** todo el editor es `super_admin`. Para `vault_operator` **no se renderiza** (no es «campos deshabilitados»:
  la curva es dinero de los dos lados). El resto de M2 no cambia de permisos.

**(a) Lead de la pantalla (microcopy normativo — sustituye a todos los subtítulos de los editores retirados):**

- **ES:** «El precio sale **solo del valor de mercado** de cada carta. La **rareza** y el **acabado** ya no
  intervienen en el cálculo. Cada curva es una lista de puntos que tú defines: entre dos puntos el valor se
  **interpola en línea recta**; antes del primero y después del último se mantiene **plano**. Los cambios surten
  efecto **sin publicar de nuevo** y quedan en bitácora.»
- **EN:** «Price comes **only from each card's market value**. **Rarity** and **finish** no longer take part in the
  math. Each curve is a list of points you define: between two points the value is **interpolated in a straight
  line**; before the first and after the last it stays **flat**. Changes take effect **without republishing** and
  are logged.»

**(b) Nota al pie fija del editor** (misma familia que §16.3b), `text-xs muted`, siempre visible:
«Al guardar, el catálogo se repricia en el siguiente cálculo · los precios manuales (override) no se tocan ·
queda en bitácora.»

**(c) Unidades: el contrato habla en centavos y puntos base; la pantalla, en pesos, `×` y `%`.**
**Nunca se muestran `marketCents`, `multiplierBp` ni `pctBp` crudos**, ni siquiera en `title`, `aria-label` o
mensajes de error. La conversión vive en la capa de formato (como `formatMoneyCents`, §9.3):

| Campo del DTO | En pantalla | Formato |
|---|---|---|
| `marketCents` | **Mercado** | `MX$ 25.00` — input dinero con prefijo `MX$` (§6.2), `inputmode="decimal"` |
| `multiplierBp` (venta) | **Multiplicador** | `1.60×` — input numérico con sufijo `×`, **2 decimales**, mínimo `1.00` |
| `pctBp` (compra) | **Pago** | `30%` — input numérico con sufijo `%`, **0–100**, hasta 2 decimales |
| `floorCents` / `binCents` | **Piso de venta** / **Mínimo de compra** | `MX$ 25.00` / `MX$ 1.00` |
| `rounding[].uptoCents` / `.stepCents` | **Hasta** / **Escalón** | `MX$ 200.00` / `MX$ 5.00`; la última banda dice `EN ADELANTE` |

- El input **no reformatea mientras se teclea** (solo al `blur`), para que escribir `1.6` no se convierta en algo
  distinto a media pulsación. Todas las cifras con `tabular-nums`.
- **Voz tipográfica:** este es **dinero operativo** (columnas que se comparan y se suman) ⇒ **mono**, 11–14px,
  según §20.14. No se usa el registro «precio display» sans aquí.

---

### 21.2 La fila de punto: agregar, mover y borrar sin que se sienta frágil (`CurvePointsTable`)

Anatomía de la tabla de una curva (es un `<table>` real, §7.7; **no** una lista de tarjetas):

```
        MERCADO        MULTIPLICADOR     VENTA A ESE MERCADO
PLANO ANTES
        [MX$   25.00]  [ 1.60 ×]         MX$ 40.00                     [Quitar]
        [MX$   80.00]  [ 1.15 ×]         MX$ 95.00                     [Quitar]
PLANO DESPUÉS
                                          + Agregar punto
```

| Columna | Tipo | Notas |
|---|---|---|
| **Gutter de posición** | texto mono 10px versalitas, `--color-text-muted` | `PLANO ANTES` en la **primera** fila y `PLANO DESPUÉS` en la **última** — explican los tramos planos de los extremos, que es la primera pregunta que hace la tabla («¿por qué una carta de MX$1 usa el 1.60×?»). `NUEVO` en una fila agregada y aún no guardada |
| **Mercado** | input dinero | El valor del punto de quiebre |
| **Multiplicador** (venta) / **Pago** (compra) | input `×` / `%` | El valor que se interpola |
| **Resultado a ese mercado** | **derivado, solo lectura** | Fondo `--color-surface-2` (pozo) para leerse como no editable — es una **superficie**, no un relleno de estado (§4.3). Venta = precio final **con piso y redondeo aplicados**; compra = pago final **con el mínimo aplicado**. Si ganó la constante, la celda añade la versalita **`PISO`** (§21.9a) |
| **Acción** | botón icono 44px | `Quitar` (`aria-label` «Quitar el punto de MX$ 80.00») |

**(a) Mover un punto = cambiar su mercado. No hay arrastrar y soltar.**
El orden **no es un dato que el dueño edite**: se deriva de `marketCents` (el servidor ordena y rechaza duplicados).
Un asa de arrastre sugeriría que el orden es independiente del valor —y en una pantalla de dinero, una fila que
cambia de sitio con el ratón es exactamente la clase de gesto que produce un error que nadie recuerda haber hecho.
- La tabla **reordena al `blur`** del campo Mercado, **nunca mientras se teclea**.
- Tras reordenar, la fila movida conserva el **foco** y recibe un **realce breve** de 1.2 s: regla izquierda de 2px
  en `--color-accent` que se desvanece (o aparece sin transición con `prefers-reduced-motion`, §8.2). Sin este
  realce el dueño pierde de vista su propia fila.
- El cambio de posición se anuncia con `aria-live="polite"`: «El punto de MX$ 120.00 quedó en la posición 3 de 4.»

**(b) Agregar un punto es, por definición, neutro.**
`+ Agregar punto` (botón `secondary` `sm`, ancho de la tabla) añade una fila **al final, en edición, con el foco en
Mercado**. Al confirmar el mercado (`blur`), el valor se **rellena solo con el valor interpolado de la curva actual
en ese mercado**, y la fila se ordena en su sitio.
- **Por qué se prerrellena:** un punto colocado **sobre** la curva vigente no cambia **ningún** precio. Así,
  «agregar un punto» es una operación segura por construcción y el dueño solo asume riesgo cuando **mueve** el
  valor. El helper lo dice: «Se colocó sobre la curva actual: todavía no cambia ningún precio.» / «Placed on the
  current curve: it doesn't change any price yet.»
- La fila nueva lleva la versalita `NUEVO` en el gutter hasta que se guarda.
- Si el mercado queda vacío o repetido, la fila **no se ordena**: se queda al final marcada (§21.4).

**(c) Borrar: inmediato, reversible dentro del borrador.**
No hay modal de confirmación por fila — sería un peaje en una tabla de N filas y enseñaría a confirmar sin leer. La
red de seguridad real es que **nada de esta pantalla toca dinero hasta «Guardar curva»**:
- Al quitar una fila aparece, al pie de esa curva, una línea mono `text-[11px]`:
  `Punto de MX$ 80.00 eliminado · **Deshacer**` (`Deshacer` es un botón `link`). Persiste hasta que se guarda, se
  descarta el borrador o se elimina otro punto (entonces se apila hasta 3 y luego se resume: `3 puntos eliminados ·
  Deshacer el último`).
- **No se puede quedar sin puntos:** con una sola fila, `Quitar` está **deshabilitado** con el motivo en `title`
  **y** `aria-describedby`: «Una curva necesita al menos un punto.» (es el invariante V1 hecho control, §21.4).

**(d) Marca de campo modificado.** Un input cuyo valor difiere del guardado gana una **regla izquierda de 2px**
`--color-accent` y, debajo, `text-xs muted`: `Antes: 1.15×`. Es el diff **en el sitio del cambio**, sin tachados
(§16.3b ya descartó el tachado como recurso) y sin rellenos de color.

**(e) Lo que la tabla NO hace:** no numera las filas (el índice del array es un detalle del contrato, no un dato del
dueño), no permite editar dos curvas a la vez en un mismo formulario parcial (el `PUT` reemplaza el objeto
completo) y no ofrece «duplicar punto» ni plantillas: cada punto es una decisión de dinero, no un elemento de lista.

---

### 21.3 Constantes: piso, mínimo de compra y escalera de redondeo

**(a) Piso de venta y Mínimo de compra (`CurveConstantsRow`)** — dos inputs de dinero en una fila de dos columnas
separada por regla, **arriba de las dos curvas**, porque gobiernan a las dos.

| | Etiqueta | Ayuda (`text-xs muted`, obligatoria) |
|---|---|---|
| `sale.floorCents` | **Piso de venta** | ES: «Ninguna carta se publica por debajo de este precio, aunque su mercado sea menor.» · EN: «No card is listed below this price, even if its market value is lower.» |
| `buy.binCents` | **Mínimo de compra** | ES: «Nunca pagamos menos que esto, aunque el porcentaje dé menos.» · EN: «We never pay less than this, even if the percentage yields less.» |

> **Estas dos ayudas son el antídoto de P-48 y no son opcionales.** El campo anterior decía «Piso (MX$)» y se
> comportaba como precio absoluto. La ayuda ahora **describe el comportamiento** («no se publica por debajo»,
> «nunca pagamos menos»), no el rol abstracto. Si algún día el comportamiento cambia, cambia el texto — no al revés.

- Bajo el **Piso de venta**, segunda línea `text-xs muted` que conecta el dial con su consecuencia operativa:
  «Una carta de **rareza premium** que aterrice en el piso **no se publica**: pasa a la cola de precio pendiente
  para que revises su mercado.» (es el guardarraíl, §21.7c/§21.9b).
- El **Mínimo de compra** debe quedar por debajo del **Piso de venta** (invariante V7); si no, el servidor rechaza
  al guardar y ambos campos se marcan (§21.4).

**(b) La escalera de redondeo ↑ (`RoundingLadderTable`)** — anidada dentro del bloque VENTA, con `eyebrow`
`REDONDEO ↑ (SOLO VENTA)`:

```
        HASTA              ESCALÓN
        [MX$  200.00]      [MX$   5.00]      [Quitar]
        [MX$  500.00]      [MX$  10.00]      [Quitar]
        EN ADELANTE        [MX$  25.00]
                            + Agregar banda
```

- **La última banda no tiene input de «Hasta»:** se pinta la versalita fija `EN ADELANTE` (`uptoCents: null`). Así
  el estado inválido «ninguna banda abierta» o «dos bandas abiertas» **no se puede expresar** desde la UI. Es la
  mitad barata de V8 resuelta por construcción; la otra mitad (fronteras múltiplo del escalón inferior) la valida
  el servidor.
- `Quitar` deshabilitado en la última banda y cuando solo queda una.
- Ayuda del bloque (`text-xs muted`): ES «El precio de venta se redondea **hacia arriba** al siguiente múltiplo del
  escalón de su banda. La banda la decide el precio **antes** de redondear y no se vuelve a evaluar. La compra
  **no** se redondea.» · EN «The sale price is rounded **up** to the next multiple of its band's step. The band is
  chosen by the price **before** rounding and is not re-evaluated. Buy prices are **not** rounded.»

---

### 21.4 Validación V1–V9: **cuándo** aparece el error y **qué forma** tiene

> **Principio de la pantalla:** *mientras se teclea no hay errores; el previsualizador enseña el problema en pesos;
> el servidor lo nombra al guardar.* El editor **no reimplementa** los invariantes cruzados para adelantarse al
> `422`: si el cliente inventara un rechazo que el servidor no haría, el dueño dejaría de confiar en la pantalla —
> y la autoridad del dinero es el backend (SEC-A1).

**(a) Los tres momentos.**

| Momento | Qué se valida ahí | Forma | ¿Bloquea guardar? |
|---|---|---|---|
| **Mientras se teclea** | **nada** | ninguna. Sin rojo, sin sacudidas, sin reformateos | no |
| **Al salir del campo (`blur`)** | lo que **un solo control** puede afirmar de sí mismo: tipos y rangos (**V3**), `multiplicador ≥ 1.00×` (**V4**), `pago` en 0–100%, `escalón ≥ MX$0.01` y `hasta` creciente (parte de **V8**) | error inline de §6.2: borde `--color-danger`, mensaje debajo, `aria-invalid` + `aria-describedby` | no lo impide, pero el botón lo advierte (ver (d)) |
| **Al salir del campo, nivel tabla** | **V2** duplicado: dos puntos con el mismo mercado (tras reordenar quedan **adyacentes**) | ambas filas marcadas con la misma sub-fila de mensaje | no |
| **Al guardar (`PUT` → `422`)** | los **cruzados**: **V1**, **V5** (monotonía de **venta**), **V9** (monotonía de **compra**), **V6** (compra bajo venta), **V7** (bin bajo piso) y la condición fina de **V8** | resumen anclado + marcas por punto (ver (b)) | **nada se guardó**: la curva vigente sigue viva |

**(b) La forma del error al guardar.** El contrato entrega `code` + `details: { axis, index, marketCents, … }`; el
diseño lo convierte en **tres marcas coordinadas**:

1. **Resumen anclado arriba del editor** — `Banner` `danger` (§7.5, sin relleno: texto e icono sobre papel),
   `role="alert"`, **recibe el foco** al llegar la respuesta. Título fijo, en los dos idiomas, sin ambigüedad:
   **«No se guardó nada.»** / **«Nothing was saved.»** Cuerpo = una frase por infracción (tabla (c)) y, por cada
   punto culpable, un botón `link` **«Ir al punto de MX$ 80.00»** que enfoca el primer input de esa fila y la lleva
   a la vista.
2. **La(s) fila(s) culpables** — regla izquierda de 2px `--color-danger`, `aria-invalid="true"` en sus inputs y una
   **sub-fila** a todo el ancho de la tabla con el mensaje en mono `text-[11px]` `--color-danger`. Los errores de
   **tramo** (V5 y V9 —las dos monotonías— y V6) marcan **los dos extremos** y escriben el mensaje bajo el segundo,
   nombrando los dos mercados.
   Los **cruzados de eje** (V6, V7) marcan la fila/el campo en **las dos** caras; el mensaje inline vive en el eje
   que indica `details.axis` y el resumen es el que cuenta la historia completa.
3. **El previsualizador** (§21.5) resalta el tramo o el mercado implicado, para que el error se **vea en pesos** y
   no solo se lea en prosa.

**(c) Copy por código (ES / EN). Frases, no álgebra: el dueño no lee `multiplierBp`.**

| Código `422` | ES | EN |
|---|---|---|
| `CURVE_EMPTY` | «La curva de {venta\|compra} se quedó sin puntos. Agrega al menos uno.» | «The {sale\|buy} curve has no points left. Add at least one.» |
| `DUPLICATE_BREAKPOINT` | «Hay dos puntos en el mismo mercado (MX$ {m}). Cambia uno o quita el repetido.» | «Two points share the same market (MX$ {m}). Change one or remove the duplicate.» |
| `SALE_BELOW_MARKET` | «El punto de MX$ {m} vendería **por debajo del mercado**. El multiplicador de venta nunca puede bajar de **1.00×**.» | «The MX$ {m} point would sell **below market**. The sale multiplier can never go under **1.00×**.» |
| `SALE_CURVE_NOT_MONOTONIC` | «Entre MX$ {m0} y MX$ {m1} el precio de venta **baja** cuando el mercado sube. Sube el multiplicador de MX$ {m1} o baja el de MX$ {m0}.» | «Between MX$ {m0} and MX$ {m1} the sale price **drops** as market goes up. Raise the MX$ {m1} multiplier or lower the MX$ {m0} one.» |
| `BUY_CURVE_NOT_MONOTONIC` **(V9)** | «Entre MX$ {m0} y MX$ {m1} **pagarías menos** aunque el mercado suba. Sube el pago de MX$ {m1} o baja el de MX$ {m0}.» | «Between MX$ {m0} and MX$ {m1} **you would pay less** even though market goes up. Raise the MX$ {m1} pay or lower the MX$ {m0} one.» |
| `BUY_ABOVE_SALE` | «En MX$ {m} pagarías **{pct}%** y venderías a **{mult}×**: la compra alcanza a la venta. Baja el pago de ese tramo.» | «At MX$ {m} you would pay **{pct}%** and sell at **{mult}×**: buying catches up with selling. Lower the pay for that stretch.» |
| `BIN_ABOVE_FLOOR` | «El **mínimo de compra** (MX$ {bin}) no puede alcanzar al **piso de venta** (MX$ {floor}).» | «The **buy minimum** (MX$ {bin}) cannot reach the **sale floor** (MX$ {floor}).» |
| `ROUNDING_LADDER_INVALID` | «La escalera de redondeo no es válida: cada frontera debe ser **múltiplo exacto** del escalón de la banda anterior (con escalón de MX$5, la frontera puede ser MX$200, no MX$203).» | «The rounding ladder is invalid: each boundary must be an **exact multiple** of the previous band's step (with a MX$5 step, the boundary can be MX$200, not MX$203).» |
| `VALIDATION_ERROR` (rango/tipo) | se muestra **en el campo**, no en el resumen (§6.2) | idem |

- **Las dos monotonías son gemelas y su copy lo refleja** (V5 venta / V9 compra): mismo esqueleto —diagnóstico en
  una frase + remedio nombrando los dos puntos— y misma marca de tramo. Cambia el verbo, porque cambia el daño:
  en venta el precio **baja**; en compra **pagarías menos**. El error **no explica por qué importa** (eso vive en
  este documento y en §N.0): un mensaje de guardado tiene que ser corto y accionable.
- **`PREMIUM_RARITY_FIXED_TIER` se retira** junto con su copy: su invariante ya no existe.
- Cualquier otro fallo (`403`, `5xx`, red) usa el patrón genérico de §8.1 con «Reintentar»; **nunca** se deja la
  pantalla insinuando que algo se guardó a medias.

**(d) Limpieza de marcas.** Editar cualquier campo de una fila marcada **borra la marca de esa fila** (optimismo
local). El **resumen** permanece hasta el siguiente intento de guardar o hasta `Descartar` — desaparecerlo antes
haría creer que el problema se resolvió sin haberlo comprobado. Si hay errores **de campo** pendientes, el botón
`Guardar curva` sigue habilitado pero la barra muestra en mono accent: `HAY CAMPOS SIN CORREGIR`; al pulsarlo, el
foco salta al primero (no se envía).

**(e) Invariante ≠ aviso: V9 y la «lectura de la curva» conviven y NO son lo mismo.**
Son dos cosas distintas que pueden ser ciertas **a la vez sobre la misma curva**, y la pantalla tiene que dejar
claro cuál es cuál. La regla que las separa es de una línea: **invariante = dinero; aviso = intención.**

| | **V9 `BUY_CURVE_NOT_MONOTONIC`** | **Aviso «lectura de la curva» (§21.5b)** |
|---|---|---|
| Qué afirma | **Pagas menos por más mercado** — el **pago absoluto** baja | El **porcentaje** de compra baja (o el multiplicador de venta sube) |
| Naturaleza | **Invariante de dinero.** Una carta que no se compra se pierde igual que una vendida barata (§N.0) | **Preferencia de negocio** (§N.1): margen grueso abajo, pago mayor arriba |
| Momento | solo **al guardar** (`422` del servidor) | **en vivo**, mientras se edita |
| Dónde | resumen anclado + filas marcadas en el editor + tramo en la curva dibujada | al pie de la **tabla de referencia**, en el panel de previsualización |
| Tono | `--color-danger`, `role="alert"`, recibe el foco | mono `--color-text-muted`, `role="status"`, sin icono y **nunca en rojo** |
| Efecto | **bloquea**: no se guarda nada | **no bloquea nada**, nunca deshabilita `Guardar` |

- **Por qué V9 no exige que el pct suba** (decisión del arquitecto, y este documento la respeta): bajar el
  porcentaje en un tramo es **legítimo** mientras el pago absoluto siga subiendo. Convertir esa preferencia en un
  rechazo del sistema le quitaría al dueño una palanca válida — y le enseñaría a pelearse con la pantalla.
- **Ejemplo que dispara los dos** (es el contraejemplo real de QA): `$25 ⇒ $12.50` · `$80 ⇒ $16.53` ·
  `$100 ⇒ $10.00`. El **aviso** aparece en cuanto se teclea, porque el pct cae (50% → 20.66% → 10%); **V9** llega
  al guardar, y solo por el tramo **$80 → $100**, donde el pago absoluto baja. El tramo `$25 → $80` **no** es un
  error: el pct cae pero el pago sube.
- **Nunca se sustituyen, se resumen ni se contagian.** Si coinciden, se muestran **los dos**, cada uno en su sitio
  y con su tono. **Prohibido teñir el aviso de rojo** o darle icono de error cuando V9 esté presente: si el aviso
  aprendiera a verse como un error, la próxima vez que aparezca solo —que es el caso normal y legítimo— se leería
  como un fallo del que nadie tiene que hacer nada. Es la misma disciplina de §2.4: cada estado dice **una** cosa.
- **Dónde se ve V9 antes de guardar:** en la columna derivada **«Compra a ese mercado»** (§21.2), donde el pago
  absoluto aparece **descendiendo** de una fila a la siguiente. Es coherente con la tesis de §21.4: *el
  previsualizador enseña el problema en pesos; el servidor lo nombra al guardar.*

---

### 21.5 Previsualización: la tabla de puntos es abstracta, el peso no

> **Requisito de producto, no adorno.** El dueño no puede calibrar lo que no ve. Los diales de §N.2 son «un punto
> de partida informado, no una verdad» — la pantalla tiene que responder «¿cuánto sale una carta de MX$50?» sin
> que nadie multiplique de cabeza. **Dos capas son obligatorias (a y b); la tercera (c) es recomendada.**

**(a) La probeta — `CurveProbe` (obligatoria).** Un input de mercado y el resultado, **vigente contra borrador**:

```
┌ PROBAR UN MERCADO ───────────────────────────────────┐
│  Mercado   [ MX$   50.00 ]                           │
│                          VIGENTE      BORRADOR       │
│  VENTA                 MX$ 70.00     MX$ 75.00  +5.00│
│                          MERCADO       MERCADO       │
│  COMPRA                MX$ 16.67     MX$ 17.33  +0.66│
│                          MERCADO       MERCADO       │
│  ────────────────────────────────────────────────────│
│  Venta: 50.00 × 1.4409 = 72.05 → ↑ MX$ 75.00 (paso $5)│
│  Compra: 50.00 × 34.67% = 17.33 (mínimo MX$ 1.00)    │
└──────────────────────────────────────────────────────┘
```

*(Ejemplo con los diales de §N.2 y un borrador que subió el punto de venta de MX$80 de `1.15×` a `1.25×` y el de
compra de MX$25 de `30%` a `32%`. La **memoria de cálculo describe siempre la columna BORRADOR**, que es la que el
dueño está decidiendo; con la curva vigente ese mismo mercado daría `50.00 × 1.3955 = 69.77 → ↑ MX$ 70.00`.)*

- **Dos columnas siempre:** `VIGENTE` (la curva guardada, tal como la devolvió el último `GET`/`PUT`) y `BORRADOR`
  (lo que hay en pantalla). La diferencia se pinta a la derecha en mono con signo; **sin color** si es 0, en
  `--color-text` si cambia (no verde/rojo: subir un precio de venta no es «bueno» ni «malo» por sí mismo).
- **Bajo cada cifra, el `priceBasis` en versalitas** (`MERCADO` / `PISO`) con el mapa canónico de §21.9a. Es la
  misma señal que después gobierna la ficha pública: aquí el dueño ve **qué determinó** el precio.
- **La memoria de cálculo es obligatoria** (las dos últimas líneas): multiplicador o porcentaje aplicado, producto
  **antes** de redondear, comparación con la constante y **paso de redondeo usado**. Es lo que convierte la
  pantalla en algo auditable a ojo. Cuando gana la constante se escribe así:
  `Venta: 1.14 × 1.6000 = 1.82 · el piso MX$ 25.00 gana → MX$ 25.00`.
- Cuando el resultado de venta resuelve en `PISO`, se añade `text-xs muted`: «Aquí el mercado no explica el precio:
  en la ficha **no se muestra** el valor de mercado, y una carta **premium** en esta zona **no se publica**.» Esa
  frase ata, en un solo lugar, el dial (§21.3a), la regla de visibilidad (§21.8) y el guardarraíl (§21.9b).
- Estado inicial: precargada con **MX$ 50.00**. Sin mercado escrito, la probeta muestra su estado vacío
  («Escribe un valor de mercado para ver qué precio sale»), nunca ceros.

**(b) La tabla de referencia — `CurveReferenceTable` (obligatoria).** Una tabla impresa de precios: es la forma más
natural de este sistema («el sitio se lee como una tabla de precios», §3.1).

- **Filas =** los mercados de la **prueba de mesa normativa** (ARCHITECTURE §4.36.1: `1.14 · 10 · 25 · 50 · 80 ·
  86 · 87 · 100 · 300 · 500`) **∪** el mercado de **cada punto** de las dos curvas del borrador. Deduplicadas y
  ordenadas ascendentes.
- **Columnas:** `MERCADO` · `VENTA VIGENTE` · `VENTA BORRADOR` · `COMPRA VIGENTE` · `COMPRA BORRADOR`. Las celdas
  que cambian llevan la cifra en `--color-text` y el delta mono a su lado; las que no cambian, `--color-text-muted`.
- **Es también el test de aceptación del previsualizador:** con los diales iniciales de §N.2, la tabla debe
  reproducir **exactamente** las cifras de la prueba de mesa (`$87 ⇒ $105`, no `$110`). QA lo verifica ahí.
- **Lectura de la curva (aviso, nunca error):** si los multiplicadores de venta **suben** con el mercado, o los
  porcentajes de compra **bajan**, la tabla añade al pie un bloque con **eyebrow mono `LECTURA DE LA CURVA`** y una
  línea mono muted: «La curva va al revés de lo previsto: el margen debería ser **grueso abajo y delgado arriba** en
  venta, y el pago **mayor arriba** en compra.» Es una observación de **intención de negocio** (§N.1), **no** un
  invariante: `role="status"`, **nunca** en rojo, **nunca** con icono de error y **no bloquea nada**.
  > **El eyebrow no es decorativo: es lo que impide confundirlo con un error.** El aviso tiene **nombre y casa
  > fijos** (`LECTURA DE LA CURVA`, al pie de esta tabla); ningún error de validación lleva ese rótulo ni vive aquí.
  > **No confundir con V9 `BUY_CURVE_NOT_MONOTONIC`**, que sí es dinero y sí bloquea: que el **pct baje** es
  > legítimo mientras el **pago absoluto suba**. Los dos pueden ser ciertos a la vez sobre la misma curva — tabla
  > comparativa y ejemplo trabajado en **§21.4e**.

**(c) La curva dibujada — `PricingCurveChart` (recomendada, no bloqueante para el primer entregable).**
Reutiliza el lenguaje de §7.17/§7.18: SVG, línea de 1.5–2px, **sin relleno**, ejes como reglas, etiquetas mono.

- **Eje Y = precio final en MXN. Eje X = mercado, en escala logarítmica**, con marcas en
  `3 · 10 · 25 · 80 · 300` — que son exactamente las fronteras del `MarketBracket` fijo de la instrumentación
  (§4.36.7c). Así el gráfico de calibración y el reporte `GET /admin/reports/pricing-brackets` **hablan del mismo
  eje**, y comparar «cuánto rota cada bracket» con «qué hace mi curva ahí» es inmediato.
- **Cuatro trazos:** venta del borrador (tinta, sólida, **con su escalera** — la venta se dibuja como escalonada
  porque eso es lo que se cobra); compra del borrador (tinta, 1px, punteada); la curva **guardada** en muted
  punteado detrás (para ver el cambio); y la **identidad `venta = mercado`** en muted 1px punteado, que hace
  visible el invariante «nunca por debajo del mercado».
- **Piso y mínimo** como reglas horizontales rotuladas en mono (`PISO MX$25`, `MÍN. MX$1`). Los puntos de quiebre
  son marcas de 4px sobre su trazo; al pasar el foco/ratón muestran su `title` (`MX$80 · 1.15×`).
- **Tramo con error** (tras un `422` de V5, **V9** o V6): se dibuja en `--color-danger` sobre el **trazo de su
  eje** —venta o compra, para que se vea de cuál de las dos curvas se habla— y su marca lleva el mismo mensaje.
- **Alternativa textual obligatoria:** la tabla (b) **es** la alternativa accesible del gráfico; el `<svg>` va con
  `role="img"` + `aria-label` de resumen y `aria-describedby` apuntando a la tabla (mismo patrón que §7.17).

**(d) De dónde salen los números del previsualizador.** El borrador se calcula **en el cliente** con la matemática
normativa de ARCHITECTURE §4.36.1 (interpolación, `max` con la constante, escalera sin re-evaluar banda); la columna
`VIGENTE` se calcula con **el objeto guardado** que devolvió el servidor. Reglas duras: (1) el previsualizador
**jamás** decide un precio real — es lectura, no dinero; (2) tras un `PUT 200`, el editor **re-siembra** su curva
vigente con la respuesta del servidor, no con su propio borrador; (3) la prueba de mesa de §4.36.1 es un test
obligatorio del frontend. *(Solicitud abierta al arquitecto para eliminar la duplicación de la fórmula: §21.13.1.)*

---

### 21.6 Guardar: borrador explícito, diff legible y bitácora (`CurveSaveBar` + `CurveDiffDialog`)

**(a) Barra de guardado sticky** al pie del editor (no del viewport completo; convive con la barra de M2):
- Izquierda, mono versalitas: `SIN CAMBIOS` (muted) · `2 CAMBIOS SIN GUARDAR` (accent) · `HAY CAMPOS SIN CORREGIR`
  (accent) · `NO SE GUARDÓ` (danger, tras un `422`, hasta el siguiente cambio).
- Derecha: `Descartar` (`ghost`, pide confirmación si hay cambios) y **`Guardar curva`** (`primary`). Con
  `SIN CAMBIOS` el botón está deshabilitado con motivo en `aria-describedby`.
- **Salir con cambios sin guardar** dispara confirmación (guard de navegación + `beforeunload`). Es dinero: el
  descarte silencioso no es una opción.

**(b) Diálogo de confirmación (§7.6) — es aquí donde el cambio se lee en palabras.** Se abre siempre, incluso con
un solo cambio: el `PUT` reemplaza **toda** la curva y repricia el catálogo entero.

```
Guardar la curva de precio

  VENTA    · punto MX$ 80.00 · multiplicador  1.15× → 1.25×
  VENTA    · punto MX$ 200.00 AGREGADO · 1.10×
  COMPRA   · punto MX$ 25.00 · pago  30% → 32%
  PISO     · MX$ 25.00 → MX$ 30.00

  Efecto en precios (5 de 12 mercados de referencia cambian):
    MERCADO      VENTA               COMPRA
    MX$  10.00   MX$ 25.00 → 30.00   MX$  3.00 →  3.20
    MX$  50.00   MX$ 70.00 → 75.00   MX$ 16.67 → 17.33
    …y 3 más

  Al guardar, el catálogo se repricia en el siguiente cálculo: cambia el precio
  publicado de las cartas y lo que ofrece el cotizador de compra. Los precios
  manuales (override) no se tocan.

  Solo súper-admin · queda en bitácora.
                                              Cancelar   [ Guardar curva ]
```

- El **diff** es mono, una línea por cambio, con `eje · punto · campo · antes → después`. Nunca un JSON.
- La **tabla de impacto** es la tabla de referencia (§21.5b) reducida a las filas que cambian, tope 5 + «y N más».
- CTA `primary` (no `destructive`: guardar no destruye nada; lo que exige cuidado es su alcance, y eso lo comunica
  el diff). La nota «Solo súper-admin · queda en bitácora» es la de §7.6 para acciones de dinero.

**(c) Después de guardar.** `200` ⇒ toast «Curva de precio guardada.» (§7.5), la barra vuelve a `SIN CAMBIOS`, la
columna `VIGENTE` del previsualizador se re-siembra con la respuesta y se invalidan las consultas de precios de M1/M2
(binder y cola de pendientes) para que el efecto sea visible sin recargar. **No hay «publicar de nuevo»:** el precio
de venta se resuelve en lectura; decirle al dueño que republique sería mentirle sobre el modelo.

---

### 21.7 El resto de M2 alrededor del editor

**(a) Lo que desaparece del panel.** Con los editores retirados se van sus bloques completos (título, subtítulo,
tablas, selectores de modo y textos de fallback). **No queda hueco**: el editor de la curva ocupa esa zona, entre la
cola de precio pendiente / FX / proveedor (§19.7) y los spreads del sellado (§16.8), que **no se tocan**.

**(b) «Unificar rarezas» cambia de casa (enmienda §19.5).** La acción estaba anclada al **editor de reglas por
rareza**, que ya no existe. Su nuevo anfitrión es el bloque **«Salud del catálogo de rarezas»**
(`GET /admin/pricing/rarities`, re-propositado): una `DataTable` (§7.7) de solo lectura con `Rareza canónica ·
Premium · Mapeada · Cartas`, ordenada por cartas desc.
- El *information scent* de §19.5 se conserva intacto: el remedio sigue junto al síntoma (la lista fragmentada), solo
  que la lista ya no es un editor de precios sino la vista que **respalda el guardarraíl**.
- **El microcopy se corrige, porque «no cambia precios» ya no lo cuenta todo.** Añadir a la ayuda y al cuerpo del
  modal: ES «**No cambia ningún precio**, pero sí puede cambiar **qué cartas quedan retenidas** por el guardarraíl,
  porque este mira la rareza premium.» · EN «It **changes no price**, but it can change **which cards are held** by
  the guardrail, since the guardrail looks at premium rarity.» El resto del copy de §19.5 se mantiene.
- Subtítulo del bloque: ES «Las rarezas ya **no fijan precios**. Se conservan para filtros, presentación y para el
  guardarraíl que retiene una carta premium cuando su precio cae al piso.» · EN «Rarities **no longer set prices**.
  They remain for filters, presentation and for the guardrail that holds a premium card when its price falls to the
  floor.»

**(c) Cola de precio pendiente: dos motivos, un filtro (`admin.m2.pending`).** La cola ahora recibe entradas de dos
orígenes distintos que **se arreglan de forma distinta**, así que se distinguen a la vista:

| `reason` | Versalita | Significado para el dueño | Qué lo resuelve |
|---|---|---|---|
| `no_market` | `SIN MERCADO` (muted) | No hay dato de precio de esa variante | El siguiente barrido, **solo**. No requiere que nadie mire |
| `premium_at_floor` | `PREMIUM EN EL PISO` (accent) | Hay dato y **parece equivocado**: una carta premium resolvió al piso o al mínimo | **Requiere mirarla**: revisar el mercado o fijar precio a mano |
| *(ausente, filas históricas)* | `—` | — | — |

- Columna `Motivo` en la tabla + **filtro** en la barra superior (`Todos` / `Sin mercado` / `Premium en el piso`)
  mapeado a `?reason=`. El filtro es chip removible (§7.7).
- **Encabezado con conteo por motivo**, mono: `12 SIN MERCADO · 3 PREMIUM EN EL PISO`. El segundo número es la
  señal de calibración del piso: si crece mucho, el piso está mal puesto (o el dato de mercado está roto), y ese es
  justo el diagnóstico que §N.5 quiere hacer visible.
- Subtítulo actualizado (ES): «Variantes sin precio publicable, escaladas para revisarlas. El comprador nunca ve
  este estado. **Sin dato de mercado no se publica ni se cotiza** — el piso no rellena el hueco.»

---

### 21.8 «Valor de mercado» que desaparece — ficha de carta y ficha de sellado

**(a) La regla (contrato de UI, no interpretación).** El bloque **«Valor de mercado»** se muestra **si y solo si
`priceBasis === "market"`** del grupo/pieza cuyo precio se está pintando. Con `floor`, `override`, `bounty` o
`pending` **no se renderiza**: ni en cero, ni tachado, ni atenuado, ni «—», ni con `visibility:hidden`.
- **La UI obedece, no infiere.** Está **prohibido** decidirlo comparando `referenceValue` contra `salePriceCents`.
  Que `referenceValue` siga viajando en el DTO **no autoriza a pintarlo** (el mismo DTO alimenta superficies de
  admin y de valuación).
- **Empate ⇒ se muestra:** el backend ya resuelve el desempate emitiendo `market`; el front no lo re-evalúa.
- **Cuál `priceBasis` manda:** el del **mismo grupo cuyo precio ocupa el bloque** — hoy `listings[0]` (la
  publicación más barata, la del «desde»). Si el bloque cambiara de grupo, el basis cambia con él: **nunca** se
  mezcla el precio de un grupo con el mercado de otro. Los renglones de «Ejemplares disponibles» **no** muestran
  mercado (no cambian).
- **Precio pendiente:** con `priceBasis === "pending"` la celda de venta ya pinta su estado propio (§7.3) y el
  bloque de mercado **tampoco** aparece — es el mismo mecanismo, sin excepción.
- **Alcance:** ficha de carta (`/catalog/[cardId]`) y ficha/ventana de sellado (`/sellado/[inventoryItemId]`).
  **No cambian** la bóveda/portafolio (ahí el cliente ve el mercado de **lo que ya posee**, y eso es correcto), el
  cotizador (§7.14, §18: nunca mostró mercado) ni las tejas/listados.

**(b) Cómo se recompone la retícula sin dejar hueco.** Hoy la ficha pinta cuatro celdas hermanas en una retícula de
2 columnas con reglas (`Precio de venta` · `Valor de mercado` · `Condición` · `Acabado`), y el divisor izquierdo
está **atado a la celda** («Valor de mercado» y «Acabado» lo llevan escrito). Quitar una celda con esa estructura
produce exactamente lo que hay que evitar: una regla que muere a media fila y un divisor heredado por quien no le
toca. Tres reglas normativas:

1. **Primero la lista, después la retícula.** Se construye la lista de **hechos visibles** evaluando `priceBasis`;
   la retícula se pinta **sobre esa lista ya filtrada**. Un hecho oculto **no existe** (no hay celda vacía).
2. **El divisor es de la posición, no del hecho.** `border-b` en toda celda; `border-l` **solo** en las celdas que
   no abren fila (par en la lista filtrada, en `≥ sm`). **Prohibido** hardcodear `sm:border-l` en un hecho concreto.
3. **La fila del dinero nunca queda coja.** Si «Valor de mercado» no está, la celda «Precio de venta» **ocupa la
   fila completa** (`sm:col-span-2`).

```
CON mercado (4 hechos)                    SIN mercado (3 hechos)
┌───────────────────┬───────────────────┐ ┌───────────────────────────────────────┐
│ PRECIO DE VENTA   │ VALOR DE MERCADO  │ │ PRECIO DE VENTA                       │
│ MX$ 1,250.00      │ MX$ 980.00        │ │ MX$ 25.00                             │
│ sin IVA           │ 20 ago 2026       │ │ sin IVA                               │
├───────────────────┼───────────────────┤ ├───────────────────┬───────────────────┤
│ CONDICIÓN         │ ACABADO           │ │ CONDICIÓN         │ ACABADO           │
│ Casi nueva (NM)   │ Reverse Holo      │ │ Casi nueva (NM)   │ Reverse Holo      │
└───────────────────┴───────────────────┘ └───────────────────┴───────────────────┘
   2 filas de 2 — rectángulo cerrado         1 fila de dinero + 1 fila de 2 — también cerrado
```

**Ficha de sellado:** el mismo mecanismo con dos hechos (`Desde` + `Valor de mercado`) ⇒ cuando el precio viene de
un **override manual**, queda **una sola celda a fila completa**. Con precio derivado por spread, se muestran las dos.

**(c) Nada crece para compensar.** La cifra de venta **conserva** su tamaño (30px sans 500, §20.13/§20.14), su peso
y su posición; no se agranda, no se centra, no gana etiqueta nueva. Dos fichas del mismo set deben leerse con la
misma jerarquía, tengan o no bloque de mercado. **El hueco no se rellena con nada**: ni un «precio fijo», ni un
sello, ni una explicación de por qué no está el mercado (§N.7: el bloque simplemente no aparece).

**(d) La nota al pie cambia con el bloque.** El párrafo `card.referenceExplainer` habla hoy del valor de mercado
**y** describe el modelo viejo («referencia + margen»). Queda **doblemente equivocado**. Dos variantes, elegidas por
la misma condición que el bloque:

| Caso | ES | EN |
|---|---|---|
| **Con** bloque de mercado | «El **valor de mercado** es la referencia del día con la que valuamos las cartas. El **precio de venta** se calcula a partir de ella.» | «**Market value** is the day's reference we value cards with. The **sale price** is derived from it.» |
| **Sin** bloque de mercado | «El **precio de venta** es el precio publicado de esta carta, sin IVA.» | «The **sale price** is this card's listed price, before tax.» |

La variante «sin bloque» **no menciona** el mercado ni insinúa que falte algo: no hay nada que explicar.

**(e) Sin salto de layout.** Durante la carga, el esqueleto de la ficha pinta la fila de dinero como **una sola
celda a ancho completo** (la parte invariable) y añade la celda de mercado solo cuando llegan los datos. Así nunca
se ve aparecer un bloque que después se retira (§8.1: los esqueletos respetan el layout final; el layout final aquí
es el que no depende del dato).

**(f) Enmienda a §7.3 (`PriceTag`).** La segunda línea **opcional** «Valor de mercado» en las tejas de Compra queda
**retirada**: tejas y listados **no muestran** valor de mercado y no van a mostrarlo. §7.3 se lee, a partir de aquí,
así: en Compra el `PriceTag` pinta **solo** el precio de venta + «sin IVA»; el mercado vive **exclusivamente** en la
ficha y solo bajo la regla (a). En bóveda/portafolio, el `PriceTag` sigue **igual** (ahí la cifra **es** el valor de
referencia y no depende de `priceBasis`).

**(g) Qué NO es esta regla.** No cambia el precio que se cobra (es presentación), no oculta el estado «precio
pendiente» donde ya vivía (bóveda/back-office, §7.3) y no toca la valuación del portafolio.

---

### 21.9 Binder de M1: bounty rebasado y guardarraíl visible

**(a) Mapa canónico `priceBasis` → versalitas (nuevo, compartido).** Es la traducción única del enum del contrato;
la usan la consola compacta, el drill-down, el previsualizador de §21.5 y la cola de pendientes. Sustituye al par
`REGLA` / `FALLBACK`, que ya no existe.

| `priceBasis` | Versalita ES / EN | Tinta | Sufijo en la consola compacta (§16.3a) |
|---|---|---|---|
| `market` | `MERCADO` / `MARKET` | `--color-text-muted` | *(ninguno — el caso normal no grita)* |
| `floor` | `PISO` / `FLOOR` | `--color-text` (peso 500) | **`·P`** |
| `override` | `MANUAL` / `MANUAL` | `--color-text` (peso 500) | **`·M`** *(sin cambio)* |
| `bounty` | `BOUNTY` / `BOUNTY` | `--color-accent` | **`·B`** *(sin cambio, solo compra)* |
| `pending` | `PENDIENTE` / `PENDING` | `--color-accent` | *(la cifra es `—`, §16.3a)* |

- **`·P` es nuevo y necesario:** «el piso ganó» es justo lo que el dueño necesita ver para detectar un **piso mal
  calibrado**, y es la causa de que la ficha pública **no** muestre el mercado. Su `title`/`aria-label`:
  «Determinado por el piso — el mercado no explica este precio» (compra: «Determinado por el mínimo de compra»).
- **Un solo rótulo por valor del enum** (`PISO` también en el eje de compra, donde la constante se llama «mínimo»):
  el nombre visible espeja el contrato y la desambiguación va en el nombre accesible. Dos rótulos para un mismo
  valor invitan a que alguien invente un sexto estado.

**(b) Guardarraíl: marcador de retención `·!`.** Cuando `pricing.{buy|sell}.premiumAtFloor === true`, el renglón de
ese eje en la consola compacta gana el sufijo **`·!`** en `--color-accent`, y **no** se pinta `·P` (la retención
implica el piso; la causa va en el nombre accesible):
- `title` / `aria-label` venta: «No se publica: rareza premium que aterrizó en el piso. Está en la cola de precio
  pendiente para revisar su mercado.»
- `title` / `aria-label` compra: «No se cotiza: rareza premium que aterrizó en el mínimo de compra.»
- En el **drill-down** (§16.3b) la fila afectada muestra la versalita `PISO` en la columna de fuente **y** una línea
  bajo la tabla: «Retenida por el guardarraíl · **Ver en la cola de pendientes**» (enlace a M2 con
  `?reason=premium_at_floor`). Es la única acción: **el guardarraíl no se apaga desde aquí**.
- La casilla del binder **no** cambia de color ni gana relleno: el marcador de dos caracteres y el texto bastan
  (§2.4). Con ≈3 casos por cada 333 cartas, gritar sería peor que informar.

**(c) Bounty rebasado — una oferta que dejó de serlo.** Con `bounty.enabled === true` y `bounty.effective === false`
el bounty **no aplica al cotizar** y **no se publica** en la vitrina; si nadie lo dice, el dueño ve simplemente que
su `·B` desapareció. **Se dice en tres sitios, todos donde ya trabaja:**

1. **Badge de la teja (enmienda §16.7b).** El badge `BOUNTY` pasa a tener **dos estados de texto**:

   | Estado | Badge | Glifo de mira | Tinta |
   |---|---|---|---|
   | `enabled && effective` | `BOUNTY` | **sí** (`HuntMark` micro, §17.1d, `aria-hidden`) | `--color-accent` |
   | `enabled && !effective` | **`BOUNTY REBASADO`** / `BOUNTY OUTBID` | **no** — se retira: ya no es una caza activa | `--color-accent` |

   El **texto** es el portador (§2.4): los dos estados comparten el rojo de atención y se distinguen por la palabra,
   igual que `PENDIENTE` vs `RECHAZADA`. La ausencia del glifo es el refuerzo, no el canal. `aria-label` de la
   casilla: «Bounty rebasado: la tarifa estándar paga más que tu oferta.» En columnas estrechas la etiqueta
   **envuelve a dos líneas** antes que truncarse (§9.4).

2. **Consola compacta (§16.3a).** El renglón `COMPRA` muestra la cifra de la **curva** (que es lo que realmente se
   paga) **sin** `·B`. No se añade un cuarto renglón: el badge ya porta el aviso y la teja tiene que seguir
   leyéndose de un vistazo.

3. **Drill-down › bloque «Bounty» (§16.7a) — aquí están los números y el remedio.** Sobre los controles del bounty
   aparece un aviso `Banner` `warning` (§7.5: icono + texto sobre papel, **sin relleno**), `role="status"`:

   ```
   BOUNTY REBASADO
   Tu oferta MX$ 900.00  ·  tarifa vigente MX$ 950.00
   Mientras esté por debajo, se paga la tarifa vigente y la carta no aparece
   en «Top Bounties». Súbelo por encima de MX$ 950.00 o apágalo.
   ```

   - Las dos cifras son `bounty.priceCents` y `bounty.curveQuoteCents`, en mono con `tabular-nums`.
   - **Sin acciones nuevas:** se resuelve con los controles que ya están (el input de precio o el switch). No se
     ofrece «subir automáticamente»: cuánto pagar es una decisión del dueño, no un botón.
   - Si `curveQuoteCents` es `null` (la curva no resuelve), **no hay aviso**: ahí el bounty explícito sigue siendo
     efectivo por diseño.

**(d) Corrección de copy en las validaciones del bounty (enmienda §16.7a).** El helper y el error decían «mayor o
**igual** al sugerido»; el contrato ahora **rechaza el empate** (`priceCents ≤ curveQuoteCents`). Copy nuevo:
- Helper dinámico: ES «Debe ser **mayor** que la tarifa vigente (MX$ 950.00).» · EN «It must be **higher** than the
  current rate (MX$ 950.00).»
- `422 BOUNTY_BELOW_RULE`: ES «Un bounty tiene que pagar **más** que la tarifa vigente (MX$ 950.00). Con el mismo
  importe no sería una oferta.» · EN «A bounty must pay **more** than the current rate (MX$ 950.00). At the same
  amount it wouldn't be an offer.»
- El helper de premium sobre la regla conserva su forma, con el nombre nuevo: «Premium sobre la **curva**: +MX$
  125.00 (+14%)»; sin curva resoluble: «Sin tarifa de curva — el bounty es el precio explícito.»
- `BOUNTY_PRICE_REQUIRED` no cambia.

**(e) Renombres derivados en la consola de precios (enmienda §16.3b).** «La regla» ya no existe como concepto:
- Columna **«Sugerido (regla)» → «Sugerido (curva)»**; helper del campo «Sugerido por regla: MX$ 875.00» →
  «Sugerido por la curva: MX$ 875.00».
- Enlace **«Restablecer a regla» → «Restablecer a la curva»**; su toast «Override retirado — vuelve a regir la
  regla.» → «Override retirado — vuelve a regir la curva.»
- Fuente del efectivo: se sustituye `REGLA`/`FALLBACK` por el mapa de (a).
- El resto de §16.3b (patrón compacto en teja + edición en el panel, permisos, validaciones, nota al pie) **no
  cambia**.

**(f) Sin aviso proactivo.** Decisión del humano, explícita: **basta el binder**. No se diseña correo, push, toast
global ni tarjeta de dashboard para el bounty rebasado ni para el guardarraíl. La vitrina pública tampoco necesita
diseño nuevo: el backend ya filtra los no efectivos y §16.7c ya manda **no renderizar** la sección cuando no queda
ninguno.

---

### 21.10 Accesibilidad (además de §8.2)

- **Tablas de puntos:** `<table>` con `<caption>` (visualmente oculta) «Puntos de la curva de venta», `<th scope>`
  en la cabecera y **un `<label>` por celda-input** (`aria-label` «Mercado del punto 2», «Multiplicador del punto
  2»). La columna derivada usa `<td>` normal, no input deshabilitado.
- **Reordenar al `blur`** se anuncia con `aria-live="polite"` (§21.2a). El foco **nunca** se pierde: sigue a la fila.
- **Borrar** anuncia el resultado y expone el `Deshacer` como botón real en el orden de tabulación inmediatamente
  posterior a la tabla.
- **Errores:** resumen `role="alert"` que recibe foco; inputs con `aria-invalid` + `aria-describedby` al mensaje;
  los mensajes de tramo se asocian a **los dos** inputs implicados.
- **Motivos de deshabilitado siempre anunciados** (`title` **y** `aria-describedby`): último punto, última banda,
  `Guardar` sin cambios.
- **Previsualizador:** la probeta anuncia el resultado con `aria-live="polite"` al terminar de escribir (debounce),
  no en cada tecla. El gráfico opcional es `role="img"` con `aria-describedby` a la tabla de referencia.
- **Ficha pública:** al desaparecer el bloque «Valor de mercado» **no** queda ningún nodo con texto vacío ni
  `aria-hidden` sobre una celda fantasma. La retícula filtrada es la que se anuncia.
- **Binder:** los marcadores `·P`, `·M`, `·B`, `·!` son texto, no iconos; llevan `title` **y** forman parte del
  `aria-label` del renglón («Precio de venta: 25 pesos, determinado por el piso, retenida: no se publica»).
- **Sin color como único canal en ninguna de las tres superficies:** basis, retención, bounty rebasado y motivo de
  pendiente son **palabras en versalitas**.
- **Objetivos táctiles ≥ 44×44** en `Quitar`, `Agregar punto`, `Agregar banda` y el `Deshacer`.

### 21.11 Contraste (verificación) — **cero pares nuevos**

Todo §21 se compone con pares ya verificados en §10, §17.2 y §20.15:

| Par usado en §21 | Ratio | Veredicto |
|---|---|---|
| Tinta `#1A1A18` sobre papel `#F4F1EA` (cifras, inputs, tablas) | ~15.5:1 | AA/AAA |
| Tinta `#1A1A18` sobre pozo `#EFEBE2` (**columna derivada**) | ~14.7:1 | AA/AAA |
| Muted `#6E695E` sobre papel / sobre pozo (etiquetas, `MERCADO`, ayudas) | ~4.8:1 / ~4.6:1 | AA |
| Rojo `#B31217` sobre papel (`·!`, `·B`, `BOUNTY REBASADO`, `PREMIUM EN EL PISO`, mensajes de error) | 6.2:1 | AA |
| Rojo `#B31217` sobre pozo (marcas en la columna derivada) | 5.9:1 | AA |
| Regla 1–2px `--color-border` / `--color-danger` / `--color-accent` (marcas de fila) | UI ≥ 3:1 | ok |
| Anillo de foco rojo sobre papel / pozo | 6.2:1 / 5.9:1 | AA (≥3:1 UI) |

La **columna derivada sobre pozo** es la única superficie tintada que introduce §21: es un **escalón de superficie**
(§4.3), no un relleno de estado — los estados siguen siendo texto sin caja (§2.4).

### 21.12 i18n — claves nuevas y retiradas (propiedad de frontend)

**Nuevas — enums compartidos (convención `status.<dominio>.<enum>`, §9.2):**
- `status.priceBasis.{market,floor,override,bounty,pending}` → `MERCADO/PISO/MANUAL/BOUNTY/PENDIENTE`.
- `status.pendingReason.{no_market,premium_at_floor}` → `SIN MERCADO / PREMIUM EN EL PISO`.
- `status.bounty.{active,outbid}` → `BOUNTY / BOUNTY REBASADO`.

**Nuevas — editor (`admin.m2.curve.*`):**
- `title`, `lead`, `footerNote`
- `constants.{floorLabel,floorHint,floorGuardrailHint,binLabel,binHint}`
- `sale.{title,marketCol,multiplierCol,resultCol}` · `buy.{title,marketCol,payCol,resultCol}`
- `point.{flatBefore,flatAfter,new,add,addedNeutralHint,remove,removeAria,removeLastDisabled,undoRemoved,
  reorderAnnounce,previousValue}`
- `rounding.{title,uptoCol,stepCol,openBand,add,remove,hint}`
- `preview.{probeTitle,probeMarketLabel,current,draft,empty,saleMath,buyMath,floorWinsNote,
  referenceTitle,referenceHint,shapeTitle,shapeHint,chartTitle,chartAria}` — `shapeTitle` = el eyebrow
  **`LECTURA DE LA CURVA`** que le da nombre y casa al aviso no bloqueante (§21.5b / §21.4e)
- `save.{noChanges,dirty,fieldErrors,notSaved,discard,discardConfirm,submit,submitting,saved,leaveConfirm}`
- `diff.{title,body,impactTitle,impactMore,effectNote,auditNote,cta}`
- `errors.{CURVE_EMPTY,DUPLICATE_BREAKPOINT,SALE_BELOW_MARKET,SALE_CURVE_NOT_MONOTONIC,BUY_CURVE_NOT_MONOTONIC,
  BUY_ABOVE_SALE,BIN_ABOVE_FLOOR,ROUNDING_LADDER_INVALID,summaryTitle,goToPoint}`
  *(`BUY_CURVE_NOT_MONOTONIC` = V9, rev `v2.1.4-buy-monotonic`; código propio, no una generalización del de venta,
  para no tocar el copy de `SALE_CURVE_NOT_MONOTONIC` ya cerrado.)*

**Nuevas — alrededores y binder:**
- `admin.m2.rarityHealth.{title,subtitle,canonicalCol,premiumCol,mappedCol,cardCountCol}` (+ se **conserva**
  `admin.m2.unifyRarities.*` de §19.5, con `hint`/`confirmBody` corregidos, §21.7b).
- `admin.m2.pending.{reasonCol,filterLabel,filterAll,countsByReason,subtitle}` *(subtítulo reescrito)*.
- `admin.m1.bounty.{outbidTitle,outbidBody,outbidYours,outbidCurrent,mustBeHigherHint}` y los mensajes corregidos
  de `error.BOUNTY_BELOW_RULE`.
- `admin.m1.priceConsole.{suggestedCurve,resetToCurve,resetToast,heldByGuardrail,seeInPendingQueue}`.
- `card.referenceExplainer` pasa a **dos claves**: `card.referenceExplainerWithMarket` y
  `card.referenceExplainerNoMarket` (§21.8d). Idéntico para la ficha de sellado si usa clave propia.

**Retiradas (con sus pantallas):** `admin.m2.buylistRules.*`, `admin.m2.salesRules.*`, `admin.m2.tierRules.*`,
`admin.m2.tierMap.*` — **incluidos** `tierRules.inheritPlaceholder` («Hereda tier»), `tierRules.finishHint`,
`*.modeLabel.*`, `*.fallback*` y `error.PREMIUM_RARITY_FIXED_TIER`. **No se corrigen: se van con la pantalla**
(§N.9).

Recordatorio §9.4: `BOUNTY REBASADO`, `PREMIUM EN EL PISO` y `NO SE GUARDÓ` son ~30–40% más largos que su versión
EN; las cabeceras de columna del editor deben poder envolver, y los badges de la teja envuelven a dos líneas antes
que truncar.

### 21.13 Notas para otros roles (derivadas del diseño; ninguna bloquea)

1. **Arquitecto — dry-run de la curva (recomendado).** El previsualizador (§21.5) obliga hoy a **reimplementar en el
   cliente** la matemática de §4.36.1. Funciona y es verificable (la prueba de mesa es su test), pero duplica
   fórmula de dinero fuera del backend. Un `POST /admin/pricing/curve/preview` que reciba **el borrador** + una
   lista de mercados y devuelva `{ market, sale: {cents, basis, roundingStepCents, rawCents}, buy: {cents, basis} }`
   dejaría el previsualizador **exacto por construcción** y quitaría la duplicación. **El diseño está pensado para
   funcionar sin él.**
2. **Arquitecto / product-owner — impacto del cambio antes de guardar (deseable).** El diálogo de §21.6b muestra el
   efecto sobre **mercados de referencia**, no sobre el inventario real, porque el contrato no expone «cuántas
   publicaciones cambian de precio con esta curva». Un conteo (aunque sea aproximado y por bracket) haría del diff
   una decisión con volumen. Sin él, el diseño es veraz: habla de precios, no de piezas.
3. **Product-owner — reporte «overrides por debajo de la curva» (ya anotado en ARCHITECTURE §4.36.9c-5).** Tras el
   cut-over pueden quedar overrides fijados creyendo en la etiqueta falsa «Piso (MX$)». Hoy el dueño puede
   compararlos **variante por variante** en el binder (`suggestedCents` vs `overrideCents`); una lista dedicada sería
   una mejora de UX real. **Fuera de alcance de v2.1**, pero es la superficie natural donde §21.9e ya deja las piezas.
4. **Frontend — dónde vive la fórmula.** Si se implementa el previsualizador en cliente (mientras no exista (1)), la
   matemática debe estar en **un solo módulo puro y testeado** contra la prueba de mesa de §4.36.1, nunca repartida
   entre componentes. Es el equivalente frontal de la regla «un solo lector de la curva» del backend.
5. **QA visual sugerido:** (a) ficha de una carta en zona de **piso** ⇒ el bloque «Valor de mercado» **no está en el
   DOM** y la retícula no deja media fila; (b) ficha de sellado con **override** ⇒ una sola celda a fila completa;
   (c) teja de Compra ⇒ **ningún** valor de mercado en ningún estado; (d) editar la curva con un punto que rompa
   **V5** (venta) y otro que rompa **V9** (compra) ⇒ en ambos casos `422`, resumen con foco, **dos** filas marcadas
   del eje correcto y **nada guardado** (recargar devuelve la curva anterior); (e) bounty válido → subir el mercado
   ⇒ el badge dice `BOUNTY REBASADO`, la carta desaparece de «Top Bounties» y el drill-down muestra las dos cifras;
   (f) variante premium en el piso ⇒ `·!` en el renglón de venta y entrada en la cola con motivo
   `PREMIUM EN EL PISO`; (g) los diez mercados de la prueba de mesa dan en la tabla de referencia exactamente las
   cifras de §4.36.1; (h) **curva de compra `$25⇒$12.50 · $80⇒$16.53 · $100⇒$10.00`** ⇒ el aviso
   `LECTURA DE LA CURVA` aparece **en vivo** (muted, sin bloquear) y, al guardar, **V9** marca **solo** el tramo
   `$80 → $100` en rojo: los dos conviven, ninguno se pinta como el otro (§21.4e).

---

## 22. Valor estimado si se gradea — «gancho de grading» (v2.2, §O de PROJECT)

> **Numeración (resultado de la fusión con `main`).** Esta entrega nació como **§21/v2.1** y pasa a
> **§22 / v2.2**: la **curva de precio por valor de mercado (P-48)** ya ocupaba §21, ya está en producción
> y las referencias vivas de §7.3, §16.3, §16.7 y §19 apuntan a ese §21. Todas las referencias internas de
> esta sección se reescribieron a **§22.x**. El requisito de origen no cambió de contenido, solo de letra:
> **§N → §O de `PROJECT.md`** (el disclaimer es hoy **§O.5**), con el contrato en **v1.50**.
>
> **Qué es:** el tratamiento visual del requisito **§O de `PROJECT.md`** — sobre una carta **raw**
> publicada en Compra, mostrar **cuánto valdría si se gradeara PSA 10 / PSA 9**, en **tres superficies**:
> **bloque de valores** junto al precio en la **ficha**, **badge** en la teja de Compra y **vitrina «Joyas
> para gradear»** en el home.
>
> **Revisión del humano (2026-08-23) — dos cambios que reescriben §22.3–§22.5:**
> 1. **Fuera la aritmética.** *«No hay que mostrarlo así mejor. Solo pongamos cuánto vale en PSA 10… nos
>    quitamos talacha de calcularlo… solo bajemos el precio y desplegamos "en PSA 10 vale tanto"»*, y —
>    preguntado por el PSA 9— **sí quiere los dos grados**. El bloque de la ficha se reduce a **el precio de
>    la carta y, junto a él, los dos valores estimados**. **Se retiran de toda la UI** la comparativa de
>    tres columnas, el multiplicador, la ganancia en MXN y el costo de gradeo del escalón. **El cálculo de
>    ROI NO desaparece del sistema: deja de mostrarse.** Sigue vivo server-side y ahora solo decide **en qué
>    cartas aparece el badge y qué cartas entran en la vitrina**. El cliente **nunca** ve el cálculo.
> 2. **El disclaimer pasa a nota al pie.** *«El completo solo hagamos referencia con un asterisco donde
>    ponemos el tag y hasta abajo de la página lo ponemos»*. Patrón clásico de **llamada + nota al pie de
>    imprenta**, no un widget: §22.4 lo trata como tipografía.
>
> **Revisión del humano (2026-08-28) — la rejilla muestra el monto, pero solo si el número es confiable.**
> De las tres opciones del mock, el humano eligió **la que lleva la cifra** a la teja del catálogo y a la
> vitrina (no el distintivo sin número), **con una condición**: en la rejilla la cifra solo aparece si el
> número es **confiable** —**fresco**, de **origen confiable** (override manual, o dato automático con
> **muestra suficiente de ventas**) y **coherente en magnitud**—. La **ficha no aplica la coherencia con la
> misma dureza**: informa lo que hay. Solo la rejilla —superficie de **promoción**— exige confianza. Se
> traduce en la regla dura **R6** (§22.0) y en un **estado nuevo** en §22.7.
>
> **Origen:** **no hay entrega de Claude Design** para esta feature. §22 se construye **desde cero sobre la
> piel ya aprobada**: no inventa una identidad para el gancho, la **compone** con piezas ya ratificadas
> (`Fact` de la ficha, `PriceTag` §7.3, chip de grado sin cert §7.2c/§16.9, `Shelf` §20.5, reglas §4.3,
> `--app-header-h` §4.5, distintivo mono §20.6). Es deliberado: una feature comercial es exactamente donde
> un sistema editorial se rompe si se le añade "un color de oferta". Tras la revisión, §22 **no pide ni una
> sola modificación** a componentes existentes.
>
> **Qué NO es (y el diseño tiene que decirlo solo):** no es un precio de venta, no es una oferta, no es una
> promesa de grado y **no es una afirmación sobre el estado de nuestra pieza** — no hemos pre-evaluado la
> carta. Todo el tratamiento visual de §22 está subordinado a esa frase.
>
> **Nota de tokens:** los valores vigentes de `--color-accent` / `--color-warning` / `--color-danger` /
> `--color-focus-ring` son los de **§17.2** (`#B31217`, rojo TCG HUNT), no los que aún lista la tabla de
> §2.3 (`#B44B3A`, bermellón retirado). §22 **solo referencia el token semántico**, nunca un hex.

### 22.0 Alcance y las seis reglas duras

- **Alcance:** presentación en storefront de un dato **ya evaluado y derivado server-side** (§O.4,
  SEC-A1). §22 no define datos, no cambia contrato, no toca precio de venta, portafolio ni buylist.
- **Aplica solo a raw publicado.** Nunca en gradeadas (ya tienen grado real, §7.2c) ni en sellado (§7.1b).

| # | Regla dura de §22 | Por qué |
|---|---|---|
| **R1** | **Cero tokens nuevos** de color y tipografía. Las **cifras** del gancho no tienen color propio: se pintan en tinta y muted. El acento (`--color-accent`) tiene **un solo empleo** en §22: la **llamada de la nota al pie** —el asterisco— y su repetición como marcador de la nota. **Nunca** colorea una cifra, una etiqueta ni un fondo. | Un "verde de dinero" o un "rojo de oferta" convertiría un estimado informativo en una promesa comercial (§2.1). El asterisco es la excepción legítima: en este sistema el rojo es el color de **atención** (§2.4/§17.2), y la llamada no adorna el dinero — es el asa de la advertencia. Un glifo de ~6px es «avaricia» en sentido literal. |
| **R2** | **El estimado nunca habla con la voz del precio real.** El precio de venta es **sans 500** (precio display, §20.14); **todo estimado por grado es mono** (dinero operativo) y, en cada superficie, **menor** que el precio de venta que lo acompaña. Corolario reforzado tras la revisión: **el bloque de estimados no contiene ningún precio real** — no repite el precio de venta dentro de sí. | La confusión precio↔estimado es el riesgo legal-comercial nº 1, y ahora R2 carga **sola** con la distinción (ya no hay comparativa que la explique). Se resuelve con familia tipográfica, tamaño y separación física, no con una advertencia extra. |
| **R3** | **Micro-aviso adyacente + llamada + nota al pie — las tres, siempre.** (1) **Toda cifra estimada lleva, VISIBLE y adyacente, un micro-aviso con las DOS ideas obligatorias** de §O.5: **«ilustrativo»** + **«no evaluamos esta carta»**. Visible significa **pintado en pantalla para un comprador vidente**: un `sr-only`, un `title` o un tooltip **no cuentan**. (2) **Toda cifra lleva además su llamada visible** (el asterisco), anclada al micro-aviso. (3) **Toda página que renderice al menos una cifra renderiza su nota al pie completa**, en esa misma página, sin interacción. (4) **Micro-aviso, llamada, cifra y nota se renderizan bajo la MISMA condición**: si la página no puede hospedar la nota, no puede mostrar la cifra; si no cabe el micro-aviso, **no se muestra la cifra**. (5) La nota **no** vive tras `<details>`, acordeón, modal, tooltip, ni en otra página **como único acceso**, ni en el footer de marca (§20.10). (6) Nada de esto es configurable: **no existe prop, variante ni breakpoint que apague el micro-aviso**. | *Corregida (QA, bloqueante).* La versión anterior dejaba el micro-aviso en `sr-only` apoyándose en la nota al pie; `PROJECT.md` §O.5 lo prohíbe expresamente y marca **«una cifra sin llamada/micro-aviso es un defecto bloqueante»**. El argumento de producto manda y es correcto: **una nota al pie protege menos que un aviso adyacente si el comprador nunca baja**, y en el **listado de Compra** y en la **vitrina del home** eso es exactamente lo normal — se ve la cuadrícula y se hace clic sin llegar jamás al pie. Las dos ideas retenidas son las que desactivan el reclamo «me prometieron»; el resto del disclaimer sí puede vivir al pie. |
| **R4** | **Ausencia total ante cualquier hueco** (§O.4): sin dato, dato rancio o —en badge y vitrina— gate no cumplido o **cifra no confiable** (R6) ⇒ **no se renderiza nada**. Ni `$0`, ni `—`, ni «precio pendiente», ni caja vacía, ni encabezado huérfano, ni **skeleton** que reserve el hueco. La teja se ve **exactamente como hoy**. | En un argumento de venta, un hueco es peor que el silencio (precedente: fast-follow de seguridad del «$0 latente»). Nótese que §22 **excluye** aquí el `PendingPriceLabel` de §7.3 a propósito. |
| **R5** | **El cálculo no se muestra, en ninguna superficie.** Ni el costo de gradeo, ni `minUpsidePct`, ni la ganancia en MXN, ni el multiplicador, ni un porcentaje de rendimiento, ni la palabra «gate». Tampoco **el criterio de confianza** de R6: ni la muestra, ni el origen, ni la cota de magnitud. Todo eso vive **solo server-side**, decidiendo elegibilidad de badge y vitrina. | *Nueva, cambio 1.* Lo que el humano quitó no es solo la talacha de calcularlo: es la **promesa implícita** que carga un número de ganancia. Un estimado se defiende como dato de mercado; una ganancia calculada se lee como oferta. Y un sello de «confianza» sería lo mismo por la puerta de atrás: convertiría la ausencia de sello en una acusación. |
| **R6** | **La rejilla solo promociona cifras confiables.** En **teja y vitrina** la cifra se pinta solo si el número es **confiable**: **fresco**, de **origen confiable** (**override manual** del dueño, o **dato automático con muestra suficiente de ventas** gradeadas) y **coherente en magnitud** (la cota es **`psa10 > precio raw`**: se descarta si el estimado PSA 10 sale **≤ el raw publicado**; y también si es **absurdamente mayor**, que ya es dato roto). La **ficha informa lo que hay** y **no** aplica la coherencia con la misma dureza. Se evalúa **server-side** y **nunca** se explica en pantalla (R5): una cifra suprimida por confianza es **indistinguible** de una suprimida por el gate de ROI. | La rejilla es **promoción**: ahí un número que no se sostiene es una promesa que no se sostiene, y el comprador la ve sin contexto y sin haber pedido nada. La ficha es **información**: quien la abrió ya está mirando esa carta, y esconderle un dato que existe sería paternalista. Y un PSA 10 **por debajo del raw** no es un gancho débil — es la prueba de que **no hay gancho**: promocionarlo sería anunciar lo contrario de lo que promete la vitrina. La cota mira **hacia abajo** a propósito: el fallo típico —un valor en **dólares escrito como pesos**— aterriza **por debajo**, no por encima. |

### 22.1 Las dos voces del dinero aplicadas al gancho (matiz de §20.14)

§20.14 fijó dos registros; el gancho vive **siempre en el segundo** y nunca sube de tamaño al primero:

| Cifra | Familia / peso | Tamaño en ficha | Tamaño en teja / vitrina |
|---|---|---|---|
| **Precio de venta raw** (dato real, §7.3) | **Sans 500** `tabular-nums` | 30px (celda existente, **fuera** del bloque) | 15px móvil / 17px `sm+` (sin cambio) |
| **Estimado PSA 10** | **Mono** `tabular-nums`, tinta | **22px** (el premio mayor, §O.3) | 11px móvil / 12px `sm+` |
| **Estimado PSA 9** | **Mono** `tabular-nums`, tinta | **17px** | — (no cabe; vive en la ficha) |
| ~~Precio raw dentro del bloque~~ | — | **retirado** (R2: el bloque no contiene precios reales) | — |
| ~~Ganancia y multiplicador~~ | — | **retirados** (R5) | **retirados** (R5) |

**El crescendo se retira — y esta es la justificación explícita.** La versión anterior de §22 ordenaba tres
cifras en rampa (17 → 20 → 26px, izquierda a derecha) para que **el crecimiento tipográfico contara el
argumento**. Con la comparativa fuera, esa rampa **ya no describe nada**: no hay tres términos, no hay
progresión de valor que narrar y —lo decisivo— **insinuaría visualmente la aritmética que el humano acaba
de quitar** (R5). Un recurso narrativo sin narración que sostener es decoración, y decoración que promete.
Se sustituye por lo mínimo suficiente:

- **Dos cifras del mismo tipo, jerarquizadas solo lo justo:** PSA 10 a **22px** y PSA 9 a **17px**. La
  diferencia existe porque §O.3 pide que **PSA 10 sea el premio mayor**, pero es un escalón **dentro de una
  misma categoría** (dos valores de referencia), no un salto entre categorías. **PSA 10 va primero** por
  orden de lectura: el énfasis lo carga la posición tanto como el tamaño.
- **Toda la distinción precio↔estimado la carga R2, sola:** familia (**sans vs mono**), tamaño (30px vs
  22px), y **separación física** — el bloque de estimados es un contenedor aparte, con su propia **regla de
  tinta** y su propio eyebrow, y **no contiene ningún precio real**. Esa última parte es la novedad: antes
  el raw vivía dentro del bloque como término de comparación; ahora su presencia solo podría confundir.
- Sigue funcionando **en escala de grises y en impresión**, que es la prueba que este sistema se
  autoimpone.

### 22.2 Chip de grado **hipotético** — variante de `GradedCertChip` (§7.2c) sin cert

El grado que se muestra aquí **no es de una pieza física**: no hay slab, no hay `certNumber`, no hay
graduadora que consultar. Se reutiliza el **chip de grado sin cert** ya ratificado para la lista de
gradeadas del admin (§16.9) — no se inventa componente — con **un solo diferenciador**:

| | Grado **real** (pieza gradeada) | Grado **hipotético** (§22) |
|---|---|---|
| Contenido | `PSA 10 · CERT 12345678` (o chip + cert, §20.5) | `PSA 10` **sin cert, jamás** |
| Borde | `1px solid var(--color-primary)` (tinta, §20.5) | **`1px dashed var(--color-border-strong)`** |
| Texto | mono 10px 500, tracking `0.1em`, tinta | idéntico |
| Compañía | siempre visible (`PSA`/`CGC`/…) | siempre visible; el MVP solo cubre **PSA** (§O.1) |
| `aria-label` | «Gradeada PSA, grado 10, certificado …» | **«Grado hipotético: PSA 10. Esta carta no está gradeada.»** |

- **Por qué punteado:** el sistema ya usa el trazo punteado para «valor no realizado» (el **costo base**
  del `PortfolioTrendChart`, §7.17/§10). El borde continuo de tinta significa *verificable*; el punteado,
  *hipotético*. Es un **segundo canal no cromático** (no es un token: `border-style` no lo es) que evita el
  peor malentendido posible — creer que la carta viene en slab.
- **Nunca aparece solo:** el chip siempre va precedido del condicional en la etiqueta de su celda
  (**«SI SALE»** / **«IF IT GRADES»**). Un chip `PSA 10` suelto está **prohibido** en superficies de raw.
- **Nunca sobre el arte** (§7.2b): el chip hipotético vive bajo la imagen o en la retícula de datos.
- En la **teja** no se usa el chip (a 171px el borde punteado no lee): ahí el grado es texto mono plano
  dentro de la frase condicional (§22.5).

### 22.3 Bloque de la ficha — `GradingEstimateBlock`

Dos cifras de referencia, junto al precio. Nada más. *(El nombre cambia respecto a la versión anterior:
ya no hay «upside» que nombrar.)*

**Dónde va — decisión revertida a propósito:** en la columna derecha de la ficha (`CardDetailView`),
**inmediatamente después de la nota `referenceExplainer`** y **antes** de «Ejemplares disponibles». Vuelve
a subir junto al precio, que es donde el gancho vende.

- **La razón para bajarlo desapareció.** Se movió al cierre de la ficha porque el disclaimer de siete
  párrafos sepultaba el CTA de compra (~450px en móvil). Con el aviso convertido en **nota al pie**, el
  bloque mide **~120px**: cabe entre el precio y los ejemplares sin empujar nada relevante.
- **Donde vende.** El comprador que abre la ficha ya vio la cifra en la teja; encontrarla otra vez a la
  altura del precio —y no al final, después de todo— es lo que la convierte en argumento de compra en vez
  de en apéndice.
- **Prosa de por medio, a propósito.** Queda **después** del `referenceExplainer` y no pegado a la retícula
  de precio: ese párrafo separa las dos zonas de dinero y evita que el ojo lea cuatro celdas de importes
  seguidas. Es la aplicación literal de R2: mono, más chico, y **separado**.
- **El ancla no se movió con §21.8.** El párrafo `referenceExplainer` tiene desde P-48 **dos variantes**
  (con y sin «Valor de mercado», §21.8d), pero **existe en las dos**, así que la posición del bloque es
  estable tanto si la ficha muestra el mercado como si no. Y cuando el bloque de mercado no se renderiza,
  la fila del dinero ocupa el ancho completo (§21.8b-3): el gancho sigue llegando **después de la prosa**,
  nunca pegado a la retícula de precio.

**Anatomía (`≥sm`):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  regla de tinta 1px (border-t border-text)
VALOR ESTIMADO SI SE GRADEA            ESTIMADO · 22 AGO 2026   ← eyebrows enfrentados (§20.2.1);
                                                                   la LLAMADA (*) NO va aquí: cierra
                                                                   el micro-aviso de abajo (§22.4a)
┌────────────────────────────┬────────────────────────────┐
│ SI SALE ⌐PSA 10⌐           │ SI SALE ⌐PSA 9⌐            │  ← eyebrow + chip hipotético punteado (§22.2)
│ MX$ 2,900.00               │ MX$ 1,450.00               │  ← mono tabular 22px / 17px, tinta
└────────────────────────────┴────────────────────────────┘
Cifra ilustrativa de mercado (lo que se ha pagado por esa carta  ← MICRO-AVISO de la ficha (§22.4c):
ya gradeada por terceros). No evaluamos el estado de esta carta     sans 12px / 1.6, muted, ancho
ni garantizamos ningún grado; el gradeo y su costo corren por       completo, con las DOS ideas en
tu cuenta.*                                                          tinta 500 y la llamada al final
```

**Composición — cero componentes nuevos y cero modificaciones:**
- Las dos celdas son **la misma celda `Fact`** de la ficha, en un **contenedor propio**
  (`grid border-t border-text sm:grid-cols-2`, `mt-7`). Se reutiliza **la celda, no la retícula**:
  - **No se reutiliza `FactGrid`** (§21.8b). `FactGrid` es el contenedor de los **hechos de precio** y fija
    su propia regla superior (`border-t border-border`) y su propio `mt`; el bloque del gancho necesita
    **regla de tinta** (`border-t border-text`), que es su único énfasis. Pedirle a `FactGrid` una prop de
    tono sería **modificar un componente existente** —justo lo que §22 se prohíbe— y, peor, emparentaría
    visualmente dos retículas que deben leerse como **categorías distintas** (R2).
  - **Sí se copia su lógica de divisor, que es normativa:** **el divisor es de la posición, no del hecho**
    (§21.8b-2). Lo lleva la celda que **no abre fila** (`sm:border-l sm:pl-7` aplicado **por posición**,
    nunca hardcodeado en «la celda de PSA 9»). Con una sola cifra —caso normal, §22.7— la celda ocupa la
    fila completa y **no queda ningún `sm:border-l` huérfano**: la regla que P-48 introdujo para la ficha
    resuelve de fábrica el caso que §22.7 ya exigía a mano.
  - En móvil apilan solas, que es el comportamiento nativo de `Fact`.
  > *Con esto desaparecen las dos únicas modificaciones que §22 pedía a `Fact`* (la variante `row` y el
  > `leading-[1.5]` del `note`): al no haber tercera columna ni `note` que envuelva, **el componente se usa
  > tal cual está escrito hoy**.
- La **regla superior es de tinta** (`border-text` 1px, no `border`): es el único énfasis del bloque y
  sustituye a la caja que este sistema no permite (§2.1, §4.3). Misma gramática que los pasos de §20.8.
- **Sin título serif.** El eyebrow + la regla de tinta ya anuncian el bloque, y un `h2` serif aquí chocaría
  con el `h2` de «Ejemplares disponibles» que viene justo debajo. Menos jerarquía, más claridad.
- **El bloque no contiene ningún precio real** (R2): ni repetido, ni citado, ni tachado.
- **Nunca dentro de la retícula de precio existente — y ahora hay que decirlo más fuerte.** Desde §21.8b la
  ficha arma su retícula sobre una **lista de hechos ya filtrada** (`FactSpec[]`), así que **añadir el
  estimado como un hecho más es literalmente una línea de código**. Queda **prohibido empujar el estimado a
  esa lista**: «SI SALE PSA 10» como quinta celda pondría un estimado en **el mismo contenedor y el mismo
  rango** que «Precio de venta» y «Valor de mercado». Mismo grid = misma categoría. El bloque del gancho
  tiene **contenedor propio, siempre**.
- **El estimado nunca lleva versalita de `priceBasis`** — ni el mapa `MERCADO`/`PISO`/`MANUAL`/`BOUNTY`/
  `PENDIENTE` de §21.9a, ni el componente `PriceBasisTag`. Un estimado **no tiene base de precio**: no lo
  fijó el mercado, ni un piso, ni un override; **no es un precio del sistema**. Rotularlo con la misma
  versalita que un precio real lo disfrazaría de precio real (R2). `PriceBasisTag` vive en superficies de
  **back-office** (§21.9a) y no entra aquí.

**Contenido — completo (lo que hay que mostrar es poco, y eso es la mejora):**

| Elemento | Dónde | Tratamiento |
|---|---|---|
| Estimado **PSA 10** (el premio mayor, §O.3) | celda 1 | mono **22px** tinta + chip hipotético en la etiqueta |
| Estimado **PSA 9** | celda 2 | mono **17px** tinta + chip hipotético en la etiqueta |
| **Fecha del último refresco** | eyebrow derecho | mono 10px muted, fecha localizada (§9.3) |
| **Micro-aviso** (obligatorio, R3) | ancho completo, bajo la retícula | **sans 12px / 1.6 muted**, 2–3 líneas; carga **las dos ideas** de §O.5 con las frases clave en **tinta 500**, y cierra con la **llamada `*`** |
| **Llamada de la nota al pie** (`*`) | **al final del micro-aviso** | §22.4a |
| ~~Ganancia, multiplicador, costo de gradeo~~ | — | **retirados** (R5) |

**Corrección (QA, bloqueante): el micro-aviso sustituye al «renglón de procedencia».** La versión anterior
decía *«Valores de mercado de esa carta ya gradeada por terceros. No hemos evaluado esta pieza.»* — cargaba
la idea 2 pero **no la idea 1**, y §O.5 anticipa ese fallo con todas sus letras: *«un micro-aviso que solo
diga "estimado de mercado" no cumple este requisito»*. La procedencia **no se pierde**: se conserva como
inciso dentro del micro-aviso, que ahora hace **tres** trabajos en un solo párrafo —de dónde sale la cifra,
que es **ilustrativa** y que **no evaluamos esta carta**—. La ficha tiene sitio de sobra, así que aquí se usa
la **versión corta completa** de §O.5, no la ultra-corta de la teja (§22.4c).

**Las dos ideas van en tinta 500 dentro del párrafo muted** — mismo recurso de entradilla que usa la nota al
pie (§22.4b): son lo único destacado, así que se leen de un vistazo aunque nadie lea el párrafo entero.

### 22.4 Llamada y nota al pie — el disclaimer como tipografía de imprenta

Los textos ES/EN son **propiedad de product-owner** y están redactados en **§O.5** (titular en mayúsculas +
seis párrafos; más una versión corta que carga dos ideas obligatorias: **ilustrativo** y **no evaluamos el
estado de esta carta**). §22 define **el tratamiento**, que tras la revisión del humano es el de una
**nota al pie editorial**: **llamada junto a la etiqueta de la cifra → texto completo al final de la
página**.

> **Por qué encaja tan bien aquí.** La nota al pie es un mecanismo **de imprenta**, y este sistema es una
> piel de imprenta (§1.3, §2.1): reglas, versalitas, mono para el dato, cero cajas. El aviso deja de ser un
> parche de UI y pasa a ser una **convención de página** que el lector ya conoce de un libro o de un
> contrato bien compuesto. Resuelve además, de un plumazo, los dos problemas que la versión anterior de
> §22 arrastraba: el muro de siete párrafos en medio de la ficha y los ~52px de micro-aviso por teja.

**(a) La llamada (`*`) — una por superficie, nunca por cifra.**

| | Regla |
|---|---|
| **Glifo** | `*` en **mono**, **`--color-accent`**, `text-[13px]`, `vertical-align: super` con `line-height: 0` (no altera la caja de línea). Único empleo del acento en §22 (R1). |
| **Dónde se ancla** | **Al final del micro-aviso** (§22.4c), **una vez por superficie** y no repetida en cada cifra. *(Corrección QA: antes se anclaba al eyebrow. Con el micro-aviso restaurado, el asterisco pertenece ahí — es lo que convierte el aviso abreviado en «hay más abajo», que es literalmente para lo que sirve una llamada. Además es el copy que propone §O.5: «Ilustrativo; no evaluamos esta carta.\*»)* Prácticamente: una página de catálogo con 20 tejas tiene 20 asteriscos, no 40. |
| **Nunca** | Pegada a un **precio real** (desviaría la nota al dato equivocado), sobre el arte, ni dentro de una cifra (`MX$ 2,9*00`). |
| **Tamaño mínimo** | No baja de 13px en ninguna superficie — el asterisco es **más grande que el texto que lo rodea**, a propósito: es la única señal visible de que hay aviso. |
| **Contraste** | Acento sobre papel **6.2:1** (§17.2/§20.15) — muy por encima del mínimo, y nunca portador único (ver semántica). |

**Semántica de la llamada — un asterisco suelto es basura para un lector de pantalla.** Marcado:

- La llamada es un `<sup>` con el glifo `aria-hidden` **más** un texto accesible que diga **qué es**:
  basta *«Ver nota al pie»*. **No hace falta que duplique las dos ideas**, porque el **micro-aviso que la
  precede es texto real** y el lector de pantalla ya lo anunció (§22.4c). Lo prohibido es el `*` desnudo:
  quien navega por audio **nunca debe oír "asterisco"** y nada más.
- **En la ficha la llamada ES un enlace** (`<a href="#nota-estimado">`) con ese texto como `aria-label`,
  `padding: 0 4px` para agrandar el blanco de golpeo y anillo de foco estándar (§8.2).
- **En la teja y en la vitrina la llamada NO es un enlace**: la teja entera ya es un enlace y no se anidan
  anclas. Ahí es `<sup>` con su texto accesible, y el acceso al texto largo es doble: la nota al pie **de
  esa misma página** (abajo) y la ficha, a un clic de la teja.

**Salto y regreso (la parte que casi siempre se hace mal):**

1. La nota tiene `id="nota-estimado"`; su encabezado lleva `tabindex="-1"` para que el foco **aterrice de
   verdad** al saltar (sin eso, el navegador mueve el scroll pero no el foco, y el lector de pantalla se
   queda arriba).
2. `scroll-margin-top: calc(var(--app-header-h, 0px) + 16px)` en la nota — reutiliza la variable de layout
   de **§4.5** para que el header sticky no tape el encabezado al aterrizar. Nada de `top` hardcodeado.
3. La nota cierra con un **enlace de regreso**: `↩ Volver al valor estimado`, mono 11px muted, apuntando al
   `id` de la llamada. El viaje es de ida **y de vuelta**; una nota al pie sin regreso deja al usuario
   varado al final de la página.
4. `prefers-reduced-motion`: sin `scroll-behavior: smooth` (§8.2).

**(b) La nota al pie — dónde vive y cómo se compone.**

**Una sola nota por página**, aunque la página muestre veinte cifras. Ubicación por superficie, siempre
**al final del contenido y antes del footer de marca** (§20.10) — el footer es un colofón, no un
contenedor de contenido:

| Página | La nota va… | Se renderiza si… |
|---|---|---|
| **Ficha de carta** | después de las pestañas Descripción/Condición | el bloque §22.3 se renderizó |
| **Compra (catálogo)** | después del paginador (§20.12) | **la página actual** muestra ≥ 1 badge; al paginar se reevalúa |
| **Home** | después de la última vitrina | la vitrina «Joyas para gradear» se renderizó |

Composición — banda de ancho completo, `border-top: 1px solid var(--color-border)`, `padding: 28px 0 36px`
(24/28 en móvil), con el `gutter` del sitio:

```
─────────────────────────────────────────────────────────────────  border-t 1px regla
* NOTA SOBRE EL VALOR ESTIMADO SI SE GRADEA            ← marcador accent + eyebrow mono 10px muted

INFORMACIÓN ILUSTRATIVA. NO ES UNA VALUACIÓN DE ESTA CARTA.   ← mono 12px 500 uppercase, TINTA

No reflejan ni evalúan el estado de la carta que estás…       ← sans 13px / 1.7 muted,
No garantizamos ningún grado. El grado lo determina PSA…         cada párrafo abre con
No es una oferta ni un compromiso de recompra. Si mandas…        ENTRADILLA en tinta 500;
No gradeamos ni intermediamos el gradeo. La cuota de PSA…        10px entre párrafos;
Los precios de mercado cambian todos los días…                   medida máx. ~720px

↩ Volver al valor estimado                                    ← mono 11px muted
```

- **El marcador repite la llamada** (`*` en accent) al abrir la nota: es lo que hace que el lector
  reconozca a qué asterisco corresponde. Es la convención de imprenta, y aquí también es el ancla visual.
- **Se conserva el recurso de las entradillas.** Cada párrafo abre con su frase-titular en **tinta peso
  500** («No garantizamos ningún grado.», «No es una oferta…», «No gradeamos ni intermediamos…»), de modo
  que los seis puntos obligatorios de §O.5 se **barren en cinco segundos sin leer una línea de cuerpo**.
  Era la mejor parte del tratamiento anterior y sobrevive intacta al cambio de ubicación.
- **Sin caja, sin fondo, sin regla al margen.** La nota se delimita por su **regla superior** y por estar
  al final de la página; el `rule-note` de 2px al margen (§20.0) es para notas **embebidas en una columna
  de contenido**, no para una banda a ancho completo. El acento ya está presente en el marcador.
- **Sin numerar y sin viñetas:** párrafos con entradilla, no un articulado de contrato.
- **Pisos tipográficos:** cuerpo **13px** y titular **12px**; **nunca** menos, en ningún viewport. (Ver (c).)
- **Semántica:** `<section id="nota-estimado" aria-labelledby="nota-estimado-titulo">`; el encabezado es un
  `h2` visualmente eyebrow. Si el proyecto adopta roles DPUB, `role="doc-endnote"` es correcto aquí.

**(c) El micro-aviso adyacente — obligatorio junto a CADA cifra (R3.1).**

> **Corrección de un bloqueante de QA.** La versión anterior de §22 retiraba el micro-aviso visible de la
> teja y lo dejaba en `sr-only`, apoyándose en la nota al pie. **`PROJECT.md` §O.5 lo prohíbe** y lo marca
> como **defecto bloqueante**. El razonamiento de producto es correcto y prevalece: **una nota al pie
> protege menos que un aviso adyacente si el comprador nunca baja**, y en el listado de Compra y en la
> vitrina del home eso es lo normal. `sr-only` no es «visible». Se restaura.

**Dos longitudes, según lo que quepa con dignidad** (ambas cargan **las dos ideas**; ninguna es opcional):

| Variante | Dónde | Tipografía | Longitud |
|---|---|---|---|
| **Corta** (versión corta de §O.5, con la procedencia como inciso) | **ficha** (§22.3) | **sans 12px / 1.6** muted, con las dos ideas en **tinta 500**; llamada `*` al cierre | ~190 car. ES · 2–3 líneas |
| **Ultra-corta** (variante que §O.5 prevé «donde no cabe la anterior») | **teja** y **vitrina** (§22.5, §22.6) | **sans 11px / 1.4** muted; llamada `*` al cierre | **≤ 46 car.** · 1–2 líneas |

- **Sans, no mono.** El micro-aviso es **prosa abreviada**, no una etiqueta ni un dato: le corresponde la
  voz sans (§3.1), igual que al cuerpo de la nota al pie. Además la sans es ~20% más estrecha que la mono al
  mismo cuerpo, que es justo lo que hace que quepa en una teja. *(Es el único cambio de voz respecto a la
  versión anterior, y va en la dirección correcta: mono era un error de clasificación.)*
- **Piso propio de 11px** en la teja —por encima del piso general de 10px del sistema— porque es la única
  prosa que hay que **leer** dentro de una retícula. No baja de ahí ni en 390px.
- **Nunca se trunca, nunca lleva ellipsis, nunca colapsa a una sola idea.** Si no cabe en dos renglones,
  **no se muestra la cifra** (R3.4). El aviso no es lo que cede.
- **Nunca es `sr-only`, `title` ni tooltip.** Esos son **complementos**, jamás el portador (R3.1).

**(d) Piso tipográfico propio — regla del sistema (se mantiene).** El aviso, en cualquiera de sus formas y
en cualquier viewport, **no baja de 10px** (llamadas y etiquetas), **11px** (micro-aviso de teja) ni **13px
de cuerpo** (la nota). Es la **única familia de texto del sistema con suelo propio**: §20.6 permite bajar
los distintivos de stock a 9px en móvil; **el aviso no**. Si hubiera que elegir entre encoger el aviso y
quitar la cifra, **se quita la cifra**.

**(e) Lo que la nota al pie NO relaja.** El patrón mueve el texto largo; **no** lo esconde, no lo hace
opcional y **no sustituye al micro-aviso**:

| Sigue prohibido | Por qué |
|---|---|
| `<details>`, acordeón, modal, tooltip, «leer más», scroll interno con altura fija | Un aviso que exigió un clic admite la réplica «nunca lo abrí»; y un `<details>` cerrado no entra en la impresión, no aparece en el `Ctrl+F` del navegador y puede no exponerse en el árbol de accesibilidad. La nota al pie **está renderizada**: es contenido real de la página, encontrable, imprimible y copiable. |
| Mandar el texto **solo** a términos/FAQ | «Otra página» sí es un salto que el usuario puede no dar. La nota vive en **la misma página** que la cifra (R3). Reflejar además el texto en términos es recomendable (§O.5), pero **como copia, no como único acceso**. |
| Meter la nota dentro del footer de marca (§20.10) | Ese footer es un colofón de una línea; hospedar ahí el aviso lo disfrazaría de letra chiquita legal genérica, que es justo lo contrario de lo que se busca. |
| Renderizar la cifra sin que la página renderice la nota | R3.(3): mismo condicional para ambos. |
| **Sustituir el micro-aviso adyacente por la llamada** | R3.(1) y §O.5: *«una cifra sin llamada/micro-aviso es un defecto bloqueante»*. La llamada dice **que hay un aviso**; el micro-aviso **es** el aviso. |

### 22.5 Badge de la teja de Compra — `GradingEstimateBadge`

> **CORREGIDO — bloqueante de QA.** La versión anterior retiraba el micro-aviso visible («lo cubre el
> `sr-only` + la nota al pie»). QA capturó del DOM real `ESTIMADO SI SE GRADEA*` / `PSA 10 ≈ MX$29,000.00`
> y **ningún aviso visible para un comprador vidente**. `PROJECT.md` §O.5 lo marca como **defecto
> bloqueante** y manda sobre el diseño (regla de conflicto de `CLAUDE.md`). **Se restaura**, y a cambio se
> rediseña el badge para que quepa con dignidad.

> **Opción ratificada por el humano (mock de tres opciones, 2026-08-28).** Entre mostrar **el monto**,
> mostrar un **distintivo sin cifra** («Gradeable», «Candidata PSA») o no llevar nada a la rejilla, el
> humano eligió **el monto**: la teja del catálogo y la vitrina llevan **la cifra**. Un distintivo sin
> número no es el gancho —no dice cuánto— y obliga a entrar a la ficha para saber si vale la pena. **A
> cambio, la cifra en la rejilla exige confianza** (R6, §22.7): si el número no es confiable, la teja se ve
> **exactamente como hoy**, sin distintivo de repuesto.

**Dónde va en la teja** (`CatalogTile`): **después** del precio de venta y del `StockBadge`, **antes** del
CTA. Nunca sobre el arte (§7.2b) y **nunca por encima del precio real**: el orden de lectura obligatorio es
**precio real → estimado → micro-aviso → CTA**. Va separado por una **regla de 1px `--color-border`** con
`mt-2.5 pt-2.5`: la regla es la que dice «lo de abajo es otra cosa».

**Anatomía — dos renglones lógicos, no tres:**

```
──────────────────────────────────────────  ← border-t 1px --color-border
En PSA 10 vale ≈ MX$ 29,000.00              ← CIFRA con el condicional INCORPORADO
                                               mono 12px sm+ / 11px móvil, tinta, tabular-nums, nowrap
                                               (móvil: «PSA 10 ≈ MX$ 29,000.00»)
Ilustrativo; no evaluamos esta carta.*       ← MICRO-AVISO (R3.1) sans 11px/1.4 muted,
                                               1 renglón desde ~200px, 2 a 171px;
                                               la LLAMADA (*) cierra la frase, accent 13px
```

**Cómo se hizo que quepa: el eyebrow desaparece, no el aviso.**

El problema real nunca fue el aviso: era que la teja llevaba **tres** renglones (eyebrow + cifra + aviso) y
dos de ellos decían lo mismo. La palabra «ESTIMADO» del eyebrow y la palabra «Ilustrativo» del micro-aviso
son **la misma idea 1**. Como §O.5 exige que las dos ideas vivan **en el micro-aviso**, lo que sobra es el
eyebrow:

- **Se retira el eyebrow `ESTIMADO SI SE GRADEA`** y su condicional se **incorpora a la propia cifra**:
  «**En PSA 10 vale ≈ MX$ 29,000.00**» (`sm+`) / «**PSA 10 ≈ MX$ 29,000.00**» (móvil). Es exactamente el
  copy que propone §O.3(2), lee mejor como gancho y **ahorra un renglón entero**.
- **La condicionalidad no se pierde:** la carga la preposición «En…» + el `≈` + el micro-aviso inmediato,
  que es una salvaguarda mucho más fuerte que un eyebrow. Sigue **prohibido** «PSA 10: MX$ 29,000.00».
- **El micro-aviso pasa a sans 11px** (§22.4c): ~20% más estrecho que la mono al mismo cuerpo, y es la voz
  que le corresponde por ser prosa. Eso es lo que hace que **quepa en un solo renglón en escritorio**.

**Coste en altura — cuantificado, y aceptado:**

| Ancho de teja | Micro-aviso | Alto del bloque | Δ vs. versión sin aviso |
|---|---|---|---|
| **~215px** (catálogo `xl`, 5 col) | 1 renglón (ES) | **~46px** | **+16px** |
| **~200px** (`lg`, 4 col) | 1–2 renglones (2 en EN) | ~46–62px | +16 a +32px |
| **171px** (móvil, 2 col) | 2 renglones | **~58px** | **+28px** |

**Y el coste bajó solo, por §21.8f.** La enmienda de P-48 **retira de las tejas de Compra la segunda línea
opcional «Valor de mercado»** (§7.3, §21.8f): la teja **encoge ~16px** en todos los breakpoints. En
escritorio eso **absorbe casi por completo** los +16px del micro-aviso —la teja queda prácticamente a la
altura que tenía antes de esta feature— y en móvil el saldo neto baja de +28px a **~+12px**. El coste ya
era aceptable cuando se declaró aceptado; ahora es casi nulo. *(No es una licencia para gastarlo en otra
cosa: el espacio recuperado se queda en **aire**, no en un elemento nuevo.)*

**Es un coste aceptado, no un defecto** (§O.5 lo declara explícitamente: *«el costo es una línea de
texto»*). Y es **menor que los ~70px** que costaría conservar el eyebrow además del aviso. Tres cosas lo
hacen soportable: (1) el bloque **solo aparece en tejas elegibles**, que en **fase 1 son las que el dueño
cura a mano** (§O.6) — una página de catálogo tendrá unas pocas, no veinte; (2) el CTA sigue alineado abajo
por el `mt-auto` que ya tiene la teja, así que **la retícula no se desalinea**; (3) el aviso es la única
prosa del bloque, en muted, bajo una regla: se lee como **pie de foto de la cifra**, no como un banner
repetido.

**Resto de reglas del badge:**

- La cifra es **PSA 10**; si no existe, **no hay badge** (§22.7) — jamás se sustituye por otro grado.
- **Sin caja, sin icono, sin flecha, sin fecha.** El único elemento gráfico es la regla superior; el único
  color, el asterisco. La fecha vive en la ficha, a un clic.
- **Sin chip punteado en la teja:** a 171px el borde punteado no lee (§22.2); aquí el grado es texto plano
  dentro de la frase.
- Convive con el `StockBadge` (§20.6) sin competir: el de stock es **texto rojo o verde**; el gancho es
  **tinta + prosa muted + un asterisco rojo de 6px**, en renglones distintos separados por una regla.
- **Acceso al texto completo, dos vías:** la **nota al pie de esa misma página** y la **ficha** (la teja
  entera es un enlace). No se anida un segundo enlace; el `aria-label` de la teja incluye el micro-aviso.
- El micro-aviso es **texto real**, no `aria-label`: el `sr-only` desaparece porque **ya no hace falta** —
  lo que se ve es lo que se lee.

### 22.6 Vitrina del home «Joyas para gradear» — `GradingGemsShelf`

Reutiliza el patrón `Shelf` (§20.5 / `_home/GradedShelf`) **tal cual**, con las tejas de Compra:

- **La vitrina muestra el monto, igual que la teja** (opción ratificada, §22.5) y **con la misma exigencia
  de confianza** (R6): se compone de tejas **ya filtradas por gate Y por confianza**. Una carta puede tener
  su ficha llena de cifras y **no aparecer aquí**; es lo normal, no una omisión.
- **Cada teja de la vitrina lleva su propio micro-aviso visible** (§22.4c, ultra-corta), igual que en el
  catálogo y por la misma razón: §O.5 señala la **vitrina del home** como el caso donde el visitante «ve
  el carrusel y hace clic sin llegar jamás al pie». Es la superficie donde el aviso adyacente **más** hace
  falta, no menos. La teja de la vitrina es la de Compra **sin ninguna variación** (§22.5), micro-aviso
  incluido: no existe una variante «de vitrina» más ligera.
- **Encabezado:** `title` serif 22/29px **«Joyas para gradear»** + **`kicker`** eyebrow mono
  **«ILUSTRATIVO · NO EVALUAMOS LA PIEZA»** — el kicker, que en Gradeadas lleva «PSA · BGS · CGC», aquí se
  gasta en la salvedad. *(Con el micro-aviso por teja restaurado, el kicker pasa a ser **refuerzo, no
  garantía**: puede simplificarse si PO lo prefiere, pero **no puede sustituir** al micro-aviso de ninguna
  teja — R3.1.)*
- **`subtitle`** (14px muted): el argumento comercial, en condicional y sin superlativos («Cartas sin
  gradear cuyo valor de mercado **ya gradeadas** es muy superior»). **Prohibido** copy tipo «gana X»,
  «inversión segura», «garantizado», y **prohibido nombrar el criterio de selección** —«margen mínimo»,
  «ROI», «vale la pena», «dato confiable»— porque sería contar el cálculo con palabras (R5).
- **La nota al pie va al final de la página del home** (§22.4b), **no** dentro del shelf. Si el shelf se
  renderiza, la nota se renderiza (R3.3); si el home no muestra ninguna cifra, no hay nota.
- **Retícula:** hasta **8** cartas (§O.3), ya **filtradas y ordenadas por el backend** — el gate de ROI y el
  filtro de confianza deciden **qué entra**, y el cliente recibe la lista resuelta sin ver ni un número del
  cálculo (R5). `grid-cols-2` (móvil, **4 visibles**) → `sm:grid-cols-3` → `lg:grid-cols-4` (las 8 en dos
  filas). Cada entrada es la **teja de Compra con su badge** (§22.5), sin variación.
- **Sin numeración mono roja.** La de §20.3 («Piezas destacadas») es orientadora; aquí implicaría un
  *ranking de mejores oportunidades*, que es justo la afirmación que §O prohíbe. Y sería un segundo rojo.
- **«Ver todas»:** se omite **mientras el contrato no exponga un filtro/orden de elegibles** — no se enlaza
  a una vista que no filtra lo que promete. Solicitud anotada en §22.12.
- **Vacío / error:** la sección **no se renderiza** (ni encabezado, ni kicker, ni regla superior) y, si no
  queda ninguna cifra en el home, **tampoco se renderiza la nota al pie** de esa página (R3.3).
- **Carga — excepción ratificada a §8.1:** esta vitrina **no pinta skeleton**. Aparece ya resuelta o no
  aparece. Un skeleton reservaría espacio para una promesa comercial que puede no existir, y produciría el
  salto de layout exacto que R4 quiere evitar. Se prefiere **prefetch/SSR**; si se resuelve en cliente, el
  estado de carga es **nada**. (El resto de vitrinas conserva su skeleton de §18.6 sin cambios.)

### 22.7 Estados — qué se renderiza y qué no

**Las tres superficies no se filtran igual — y hay TRES ejes independientes.** Es la consecuencia
estructural del cambio 1 (el cálculo dejó de mostrarse y pasó a **seleccionar**) y de la condición que el
humano puso al elegir el monto para la rejilla (R6).

| Eje | Qué decide | Ficha | Teja / vitrina |
|---|---|---|---|
| **Existencia y frescura del dato** | qué cifras hay | pinta **lo que haya** | — |
| **Gate de ROI** (§O.2) | si la carta **merece** promoción | **no aplica** | **decide si aparece** |
| **Confianza de la cifra** (R6) | si el número **se sostiene** como promoción | **no aplica con la misma dureza**: informa lo que hay | **decide si aparece** |

- La **ficha es información**: muestra **lo que haya (PSA 10 y/o PSA 9) y NO depende del gate** (§O.3(1),
  §O.4 «Regla por superficie»). Contrato v1.50: *«PSA 10 sin PSA 9 emite un arreglo de un elemento»*.
- La **teja y la vitrina son promoción**: llegan **ya filtradas** por el backend (§O.4) — por gate **y** por
  confianza. El cliente nunca ve el criterio, solo su resultado (R5).

**Qué es «confiable» (R6) — tres comprobaciones, todas server-side:**

| # | Comprobación | Rejilla (teja / vitrina) | Ficha |
|---|---|---|---|
| 1 | **Fresca** — dentro del umbral de frescura (§O.4) | exige | **exige igual**: un dato rancio no se pinta en ninguna superficie *(regla vieja, sin cambio)* |
| 2 | **Origen confiable** — **override manual** del dueño, o **dato automático con muestra suficiente** de ventas gradeadas | exige | **no exige**: pinta lo que el backend emita |
| 3 | **Coherente en magnitud** — la cota es **`psa10 > precio raw`**; se descarta si sale **≤ raw** (y también si es **absurdamente mayor**) | exige | **no la aplica con la misma dureza**: informa lo que hay |

- **La frescura es la única de las tres que también gobierna la ficha.** Un dato rancio no es «lo que hay»:
  es un dato caducado, y ahí manda R4.
- **La cota mira hacia abajo, y esa es la dirección correcta.** El fallo real que hay que atrapar es un
  **valor en dólares escrito como pesos**, que aterriza **por debajo** del raw, no por encima: por eso el
  guardarraíl operativo es `psa10 > raw`. El techo por arriba («absurdamente mayor») existe, pero es un
  caso distinto —**dato roto**, no un hecho de mercado— y la recomendación de diseño es que el backend
  **no lo emita en ninguna superficie** (entonces aplica R4 y la ficha tampoco lo pinta). Anotado en §22.12.
  Lo que la ficha **sí** sigue mostrando es el PSA 10 **≤ raw**: es información real y verdadera, aunque no
  sirva de gancho.
- **Nada de esto se explica en pantalla.** Sin «dato provisional», sin asterisco extra, sin tinta atenuada,
  sin `title` que insinúe baja confianza: la cifra se pinta **igual que cualquier otra** o **no se pinta**.
  Un indicador de confianza sería el cálculo contado con palabras (R5).

| Situación (evaluada **server-side**, §O.4) | Ficha | Teja | Vitrina |
|---|---|---|---|
| PSA 10 + PSA 9, dato fresco, **gate cumplido**, cifra **confiable** | **Bloque, dos cifras** (§22.3) | **Badge** con PSA 10 (§22.5) | Entra |
| PSA 10 + PSA 9, dato fresco, **gate NO cumplido** | **Bloque, dos cifras** (la ficha no está gateada) | **Nada** | No entra |
| Cifras frescas, **gate cumplido**, pero **cifra NO confiable** (origen sin muestra suficiente, o `psa10 ≤ raw` / absurdamente mayor) | **Bloque, lo que haya** (§22.3) | **Nada** | No entra |
| **Solo PSA 10** (sin PSA 9) | **Bloque, una cifra** (PSA 10) | **Nada** — el gate se evalúa sobre PSA 9 y sin él la carta **no es elegible** (§O.2) | No entra |
| **Solo PSA 9** (sin PSA 10), gate cumplido | **Bloque, una cifra** (PSA 9) | **Nada** — el badge pinta el **estimado PSA 10** (§O.3(2)); sin esa cifra no hay badge, y **jamás se sustituye por otra** | No entra |
| **Sin ningún estimado** | **Nada** | Nada | No entra |
| **Dato rancio** (> umbral de frescura, §O.4) | Nada | Nada | No entra |
| Carta no publicada / sin precio de venta | Nada (no hay ficha vendible) | La teja no existe | No entra |
| Producto **gradeado** o **sellado** | Nunca | Nunca | Nunca |
| Ninguna carta elegible en el sitio | — | — | **La vitrina entera no existe** |
| La página no puede hospedar la nota al pie | **Nada** (R3.3) | Nada | No se renderiza |

**Un solo grado disponible = comportamiento NORMAL y especificado de la ficha, no una contingencia.**
*(Corrección: la versión anterior de §22.7 exigía los dos grados. Era **arrastre** de cuando el bloque era
una comparativa de tres términos, donde faltar un término sí la rompía. Con dos cifras **independientes**
no hay nada que se rompa, y `PROJECT.md` §O.3(1)/§O.4 y el contrato v1.50 coinciden en «se muestra lo que
haya». Manda `PROJECT.md`; esta sección se alinea.)* Cómo se pinta:

- La retícula **colapsa a una columna a ancho completo** (`grid-cols-1`): el `Fact` ausente sencillamente
  no se renderiza, y **no queda media retícula vacía** ni un `sm:border-l` huérfano. Con el divisor
  **posicional** de §22.3 esto sale solo: la única celda abre fila, y quien abre fila no lleva divisor.
- **La cifra solitaria toma el tamaño de cabecera** —22px (20px en móvil)— **sea PSA 10 o PSA 9**. El
  escalón 22/17 de §22.1 existe para **ordenar dos pares**; con un solo par no hay nada que ordenar, y
  dejarla en 17px la haría parecer un resto de algo que falta.
- **La etiqueta nombra el grado que es** (`SI SALE PSA 9`) con su chip hipotético, así que una ficha de un
  solo grado **nunca es ambigua**: no hay que explicar cuál falta, porque no se insinúa que falte.
- **Nada indica la ausencia del otro grado.** Sin «—», sin celda gris, sin «PSA 10: sin dato», sin nota que
  lo mencione. La regla money-safe se aplica al hueco igual que a la cifra: **una cifra que no existe no se
  dibuja, y tampoco se anuncia que no existe** (§O.4).
- Todo lo demás del bloque es idéntico: eyebrow, fecha, **micro-aviso**, llamada `*` y nota al pie. El
  aviso **no se abrevia** por haber una cifra menos (R3).

**Suprimida por confianza = comportamiento NORMAL, e indistinguible del gate — a propósito.** Una carta con
el gate **cumplido** cuya cifra no es confiable (R6) y una carta que simplemente **no pasa el gate**
producen **exactamente el mismo píxel**: ficha con su bloque, teja sin badge, ausencia en la vitrina. **No
hay forma de distinguirlas en pantalla, y no debe haberla** (R5: el cliente no ve el criterio, ni el de ROI
ni el de confianza). Para QA, en concreto: **ver el bloque en la ficha y no ver el badge en la teja NO es un
bug**; no hay que buscar una marca diferenciadora en el DOM —no existe— ni pedir un `data-*` que la exponga,
que sería filtrar el criterio al cliente (SEC-A1). La única forma legítima de saber por cuál de las dos
razones no se promociona una carta es **mirar el lado servidor**.

Reglas generales que siguen aplicando:

- **«Nada» significa nada:** sin encabezado, sin regla superior huérfana, sin `<hr>`, sin celda vacía, sin
  espacio reservado y **sin el `PendingPriceLabel` de §7.3** — que sí es correcto en bóveda y back-office,
  pero está **prohibido** aquí (§O.4: «ni siquiera "pendiente"»).
- **Verificación visual — cuatro estados que son correctos y suelen reportarse como bugs:**
  1. Carta no elegible y carta elegible producen tejas **idénticas** salvo el bloque del badge; sin
     diferencia de altura reservada, sin borde extra.
  2. **Ficha con bloque pero carta sin badge** (gate no cumplido): **normal y esperado**.
  3. **Ficha con bloque de una sola cifra** (solo PSA 10, o solo PSA 9): **normal y esperado**, y en ambos
     casos sin badge ni entrada de vitrina.
  4. **Ficha con bloque y sin badge, con el gate CUMPLIDO** (la cifra no pasó el filtro de confianza, R6):
     **normal y esperado**, e **indistinguible** del caso 2 en pantalla.

### 22.8 Móvil 390px

**El riesgo bajó mucho.** La retícula de tres cifras —lo que más amenazaba con romperse a 390px— ya no
existe: quedan **dos cifras que apilan solas** en el comportamiento nativo de `Fact`, sin variantes ni
props nuevas. Lo que queda por especificar es poco:

| Superficie | `≥sm` (640px+) | `<sm` (390px) |
|---|---|---|
| **Retícula del bloque** | 2 celdas `Fact` en fila, con el divisor **posicional** en la que no abre fila (§22.3) | **2 celdas apiladas** (label arriba, cifra debajo) — comportamiento nativo de `Fact`, sin variante `row` |
| **Tamaños** | PSA 10 **22px** · PSA 9 **17px** | PSA 10 **20px** · PSA 9 **16px** |
| **Chip hipotético** | en la etiqueta de la celda | igual; si la etiqueta envuelve, el chip baja a segunda línea, **nunca se recorta** |
| **Micro-aviso de la ficha** | 2 líneas, sans 12px | 3 líneas, sans 12px (**no encoge**, §22.4d) |
| **Badge de teja** | cifra 12px («En PSA 10 vale ≈ …») + micro-aviso sans 11px en 1 renglón | cifra **11px** («PSA 10 ≈ …») + micro-aviso sans 11px en **2 renglones**; ~58px de bloque (§22.5) |
| **Llamada `*`** | 13px accent | **13px accent** — no encoge nunca; es la señal del aviso |
| **Nota al pie** | banda a ancho completo, cuerpo 13px, medida ~720px | igual, `padding` 24/28px; **cuerpo sigue en 13px** |
| **Vitrina** | 4 columnas × 2 filas | 2 columnas, **4 tejas visibles** |

Reglas de resistencia a cifras largas: todas las cifras llevan `tabular-nums` + `whitespace-nowrap`; la
**etiqueta** es la que envuelve, nunca la cifra. Probar con `MX$ 999,999.00` en ES a 390px: la celda debe
seguir cabiendo con la etiqueta en dos líneas. Si aun así la cifra chocara, baja un escalón de tamaño —
**jamás** se trunca un monto ni se abrevia a «2.9k».

### 22.9 Accesibilidad y contraste

**Contraste — sin pares nuevos.** §22 no introduce ningún par que §10 / §17.2 / §20.15 no hayan verificado:

| Par usado en §22 | Ratio | Veredicto |
|---|---|---|
| Tinta `#1A1A18` sobre papel (todas las cifras del bloque y del badge) | ~15.5:1 | AA/AAA |
| Muted `#6E695E` sobre papel (eyebrows, **micro-aviso**, cuerpo de la nota) | ~4.8:1 | AA ✓ (incluye el micro-aviso de 11px) |
| Muted sobre pozo `#EFEBE2` (si una superficie cae sobre banda de pozo) | ~4.6:1 | AA ✓ |
| **`--color-accent` `#B31217` sobre papel — la llamada `*` y su marcador** | **6.2:1** | **AA ✓ (texto pequeño)**, y nunca portador único |
| `--color-border-strong` del chip punteado (borde de UI) | — | trazo de UI, acompañado siempre de texto |
| Anillo de foco `--color-focus-ring` sobre papel/pozo | 6.2 / 5.9:1 | AA (≥3:1 UI) |

**Reglas de accesibilidad propias del gancho:**
- **Ninguna cifra depende del color**, por construcción: todas van en tinta. El único elemento coloreado es
  la llamada, y **el color no es su significado**: lo porta su texto accesible.
- **La llamada nunca se anuncia como «asterisco»** (§22.4a): glifo `aria-hidden` + texto accesible. Con el
  micro-aviso restaurado ese texto puede ser mucho más corto —«Ver nota al pie»— porque **las dos ideas ya
  están en el texto visible que lo precede**: el lector de pantalla las oye igual, en orden, sin
  duplicación. Lo prohibido sigue siendo un `*` desnudo en el árbol de accesibilidad.
- **El micro-aviso es texto real, nunca `aria-label`.** Es la corrección de fondo del bloqueante: lo que se
  ve y lo que se oye son **el mismo texto**, que es la forma más robusta de accesibilidad que existe.
- **Salto y regreso operables por teclado** (§22.4a): la llamada de la ficha es un enlace real con foco
  visible; el encabezado de la nota tiene `tabindex="-1"` para recibir el foco; la nota cierra con enlace
  de regreso al punto de partida. Nadie queda varado al final de la página.
- **El grado hipotético se anuncia como hipotético** (§22.2): `aria-label` «Grado hipotético: PSA 10. Esta
  carta no está gradeada.»
- **Glifo `≈`:** `aria-hidden`, con la lectura en prosa («aproximadamente»). Es el único glifo que queda —
  `×` y `+` desaparecieron con el multiplicador y la ganancia (R5).
- **Semántica:** el bloque es `<section aria-labelledby>` apuntando a su eyebrow; la retícula de cifras
  lleva `aria-describedby` → `id` de la nota al pie (asociación redundante para que la ayuda técnica pueda
  leer el aviso completo desde la cifra, sin navegar).
- **Orden de tabulación y de DOM = orden visual** (precio real → estimado + llamada → CTA). El badge de la
  teja **no es focuseable** (no es interactivo; la teja entera ya es un enlace) — no se anida un control
  dentro del link.
- **Sin información solo-hover:** el `title` es siempre redundante del texto visible, nunca su única vía.
- El estimado **no se anuncia con `aria-live`**: no es un cambio de estado, es contenido estático.

### 22.10 Qué NO hacer (lista de prohibiciones — esta feature es donde el sistema se rompe)

1. **No** crear un color de «oferta», «ganancia», «upside» ni un verde de dinero. No hay token nuevo.
2. **No** usar `--color-success` para la ganancia: el verde del sistema significa *confirmado/liquidado*
   (§2.4); una ganancia hipotética no está confirmada.
3. **No** usar `--color-accent` para una cifra, una etiqueta, un fondo o un borde del gancho. Su **único**
   papel en §22 es la **llamada `*` y su marcador en la nota** (R1). Un segundo elemento rojo en la teja
   además del `StockBadge` sería ruido sin significado (§17.2); un glifo de 6px no lo es.
4. **No** meter el bloque ni el badge en una **caja**, pastilla, panel con relleno, borde de color, sombra,
   relieve o gradiente (§2.1, §4.2, §4.3, §16.6/§17 sobre gradientes).
5. **No** poner el badge **sobre el arte** (§7.2b) ni añadir icono de flecha ascendente, gráfica, cohete,
   fuego, estrella ni emoji (§1.3).
6. **No** tachar ni atenuar el precio raw para "hacer ver" el estimado: no es un descuento y el precio de
   venta es el dato real de la pantalla.
7. **No** mostrar **ninguna pieza del cálculo** (R5): ni ganancia en MXN, ni multiplicador («≈ ×6»), ni
   porcentaje de rendimiento, ni costo de gradeo, ni `minUpsidePct`, ni lenguaje de instrumento financiero
   («+312% de retorno», «ROI», «rendimiento anualizado»). El ROI **solo** filtra badge y vitrina.
8. **No** mostrar un chip `PSA 10` sin el condicional ni sin el borde punteado (§22.2).
9. **No** mostrar el estimado más grande que el precio de venta de la misma pantalla, ni en la voz sans del
   precio display, **ni meter un estimado en la misma retícula que un precio real** (R2) — en concreto, **no
   empujarlo como un `FactSpec` más** a la lista de hechos de la ficha (§22.3).
10. **No** renderizar «pendiente», `—`, `$0`, un rango inventado, un skeleton persistente ni un encabezado
    de sección vacío cuando falte el dato (R4).
11. **No** esconder la nota tras hover, tap, `<details>`, acordeón, modal, scroll interno con altura fija o
    «ver términos» como **único** acceso; **no** llevarla a otra página; **no** meterla en el footer de
    marca; **no** bajarla de 13px de cuerpo ni de 10px en ninguna superficie; y **no** dejar una cifra en
    una página cuya nota al pie no se renderice (R3, §22.4b, §22.4d).
12. **No** dejar la llamada sin texto accesible, ni repetirla cifra por cifra, ni pegarla a un precio real
    (§22.4a).
13. **No** mostrar una cifra estimada sin su **micro-aviso adyacente VISIBLE con las dos ideas** (R3.1).
    En concreto: **no** dejarlo solo en `sr-only`, `title` o tooltip; **no** recortarlo a una sola idea;
    **no** truncarlo; **no** apagarlo por breakpoint, por densidad de retícula ni por prop. `PROJECT.md`
    §O.5: *«una cifra sin llamada/micro-aviso es un defecto bloqueante»*. Si no cabe, **se quita la cifra**.
14. **No** llevar el estimado a superficies de dinero real: carrito, checkout, correos de confirmación,
    bóveda, portafolio, cotizador de buylist ni back-office financiero. §22 vive **solo** en ficha, teja de
    Compra y vitrina del home.
15. **No** delatar **por qué** una carta no se promociona: ni marca, ni versalita, ni tinta atenuada, ni
    `title`, ni `data-*` que distinga «gate no cumplido» de «cifra no confiable» (R5, R6). Y **no** inventar
    un distintivo sin cifra («Gradeable», «Candidata PSA») como premio de consolación cuando la cifra no es
    confiable: la teja se queda **exactamente como hoy** (R4). Tampoco **rotular el estimado con una
    versalita de `priceBasis`** (§22.3): un estimado no tiene base de precio.

### 22.11 i18n — claves nuevas (propiedad de frontend)

Convención §9.2, ES de referencia y EN obligatorio (§O.3 exige el disclaimer en ambos idiomas):

- `catalog.gradingEstimate.{eyebrow,updatedAt,ifGradesLabel,psa10Label,psa9Label,microNotice}` — `eyebrow`
  es «VALOR ESTIMADO SI SE GRADEA»; **`microNotice`** es el **micro-aviso corto de la ficha** (§22.4c), que
  sustituye a la clave `provenance` de la versión anterior.
- `catalog.gradingBadge.{figure,figureShort,microNotice}` — **`figure`** lleva el condicional incorporado
  («En PSA 10 vale ≈ {amount}») y **`figureShort`** es su forma móvil («PSA 10 ≈ {amount}»);
  **`microNotice`** es el **micro-aviso ultra-corto** (≤ 46 car., §22.4c). *(Se retira `eyebrow`: el
  condicional vive ahora en la cifra, §22.5.)*
- `catalog.gradingNote.{callSr,label,headline,p1,p2,p3,p4,p5,back}` — la nota al pie:
  - **`callSr`** = texto accesible de la llamada. Con el micro-aviso visible delante basta con «Ver nota al
    pie»; **no** debe duplicar las dos ideas, que ya se anuncian como texto real.
  - `label` = eyebrow del encabezado de la nota; `headline` = titular mono en versalitas; `p1…p5` = **una
    clave por párrafo** (imprescindible para el tratamiento de §22.4b); `back` = enlace de regreso.
  - Las **entradillas en negrita** se marcan con **rich text de next-intl** (`<b>…</b>` con
    `b: (c)=><strong>`), **nunca** partiendo la frase en dos claves ni concatenando (§9.4). Los dos
    `microNotice` usan el mismo mecanismo para poner **las dos ideas en tinta 500**.
- `catalog.gradingEstimate.hypotheticalGradeAria` — «Grado hipotético: {company} {grade}. Esta carta no
  está gradeada.»
- `home.gradingGems.{title,kicker,lead}` (sin `viewAll` mientras no exista el filtro, §22.6).
- **No hay clave para la confianza** (R6): no se rotula, no se explica y no se traduce lo que no se pinta.
- *Retiradas respecto a versiones anteriores de §22*: `rawLabel`, `rawNote`, `gainNote`, `basisLine`,
  `costTierNote`, `caveatMicro`, `srDisclaimer`, `gridNote`, `provenance`, `gradingBadge.eyebrow`.

**Textos propuestos para los dos `microNotice` (ES/EN)** — punto de partida tomado del propio §O.5; PO
ratifica. Las **negritas** marcan las dos ideas obligatorias, que van en tinta 500 (§22.4c):

| Clave | ES | EN |
|---|---|---|
| `gradingBadge.microNotice` (teja y vitrina) | **Ilustrativo**; **no evaluamos esta carta**.\* | **Illustrative**; **we haven't assessed this card**.\* |
| `gradingEstimate.microNotice` (ficha) | **Cifra ilustrativa** de mercado (lo que se ha pagado por esa carta ya gradeada por terceros). **No evaluamos el estado de esta carta** ni garantizamos ningún grado; el gradeo y su costo corren por tu cuenta.\* | **Illustrative** market figure (what that card has sold for once graded by third parties). **We have not assessed this card's condition** and guarantee no grade; grading and its cost are on you.\* |

Notas §9.4: el `microNotice` del badge mide **36 car. en ES y 43 en EN** — **EN es el más largo**, caso
poco común: dimensionar la teja por el **máximo de ambos** (2 renglones a 171px en los dos idiomas, 1
renglón desde ~200px en ES y ~240px en EN). «SI SALE PSA 10» / «IF IT GRADES PSA 10» tiene el mismo sesgo.
El cuerpo de la nota es el texto más largo del sistema: debe poder envolver sin tocar tamaños.

### 22.12 Notas a otros roles (ninguna bloquea el diseño)

1. **Product-owner — §O.3 y §O.5 quedaron desalineados con lo que el humano aprobó (SOLICITUD, la más
   importante).** Los dos cambios de la revisión contradicen texto vigente de `PROJECT.md`, y el diseño
   **no puede** editarlo (regla de propiedad). Hay que actualizar:
   - **§O.3, viñeta (1)**: la ficha ya **no** muestra «el upside frente al raw (diferencia en MXN y
     multiplicador)» ni «el costo de gradeo usado en el cálculo — el escalón aplicado». **Ambos se
     retiran** por instrucción del humano (R5). El costo del escalón se queda **sin superficie donde
     mostrarse**: existía solo para justificar la aritmética que ya no se pinta.
   - *(§O.5 ya no está desalineada: la regla de presentación de `PROJECT.md` —micro-aviso adyacente
     **además** de la llamada— es correcta y §22 se corrigió para cumplirla. Ver el punto 2.)*
   - Los **criterios de aceptación 79–92** que mencionen upside, multiplicador o escalón visible deben
     revisarse a la luz de lo anterior.
2. **Product-owner — ratificación del micro-aviso, y la recomendación que ux-ui deja por escrito.**
   El micro-aviso adyacente **está restaurado y especificado** (§22.4c, §22.5, §22.6): §O.5 manda y el
   documento se alineó. Quedan dos cosas de PO:
   - **Ratificar los textos** de `gradingBadge.microNotice` y `gradingEstimate.microNotice` (tabla de
     §22.11; el ultra-corto es literalmente el que propone §O.5) y el de `callSr`.
   - **Decidir, con revisión legal, si el micro-aviso de la teja se mantiene en las retículas densas.**
     Ux-ui lo implementa como está mandado, pero deja constancia del riesgo que ve, para que quien lo
     acepte lo haga informado: **la repetición idéntica del mismo aviso en muchas tejas de una misma
     pantalla tiende a volverlo invisible** (ceguera de banner), así que la protección *real* que aporta
     la enésima repetición decrece, mientras el coste de retícula se paga entero *(hoy ya casi nulo en
     escritorio, §22.5)*. *No es una objeción a mostrarlo* —el argumento de §O.5 sobre el comprador que
     nunca baja al pie es sólido y decisivo—, sino una nota para que, si alguna vez se plantea recortarlo,
     la decisión salga de **PO + legal** y no de una optimización de layout. **Mientras no haya esa
     ratificación explícita, manda `PROJECT.md`: el micro-aviso va, en las tres superficies.** El diseño
     mitiga lo que puede: economía de palabras (36 car.), voz de prosa en sans para que se lea distinto de
     las etiquetas, y aparición **solo en tejas elegibles** —en fase 1, las que el dueño cura a mano
     (§O.6)—, de modo que una página típica tenga unas pocas, no veinte.
3. **Product-owner — longitud del disclaimer (recomendación, no bloqueo).** El texto de §O.5 (titular +
   seis párrafos) **se puede tratar**: §22.4b lo hace escaneable con entradillas y, al vivir al pie, ya no
   estorba a nadie. La recomendación se mantiene pero **baja de prioridad**: si la revisión legal pudiera
   podarlo a titular + cuatro párrafos, se leería más; con el patrón de nota al pie ya no es urgente.
4. **Ficha con un solo grado — RESUELTO, ya no es una solicitud abierta.** `PROJECT.md` §O.3(1)/§O.4 y el
   contrato v1.50 fijan «se muestra lo que haya»; §22.7 estaba desalineada (arrastre de la comparativa) y
   **se corrigió**: es el **comportamiento normal y especificado** de la ficha, con su forma de una sola
   columna. Queda como supuesto abierto en `PROJECT.md` solo la **confirmación del humano**; el diseño ya
   está definido para ambas respuestas —si el humano prefiriera exigir los dos grados, se elimina un
   estado, no se rediseña nada.
5. **Arquitecto — datos que §22 necesita del contrato (v1.50), ACTUALIZADO.** Se **reduce** lo que el
   cliente debe recibir, que es la mejor noticia de esta revisión:
   - **Sí:** estimado **PSA 10** y **PSA 9** en centavos MXN, **fecha de refresco**, y un **booleano de
     elegibilidad ya resuelto** (o, mejor, listados ya filtrados) para badge y vitrina.
   - **Ya no hace falta exponer:** ganancia, multiplicador, costo de gradeo del escalón ni su etiqueta
     legible. **Recomendación de seguridad:** que el contrato **no los exponga en el storefront** — lo que
     no viaja al cliente no se puede filtrar en un DTO ni pintar por error (SEC-A1). El ROI se queda
     íntegramente del lado del servidor.
   - Si algún insumo no llega, aplica R4 y no se pinta nada.
5-bis. **Arquitecto / backend — la confianza (R6) se resuelve server-side, igual que el gate.** El cliente
   debe recibir **listados ya filtrados** (o, en su defecto, un **booleano de elegibilidad ya resuelto**)
   para badge y vitrina, que combine **gate de ROI + confianza**. El storefront **no** debe recibir el
   tamaño de la muestra, el origen del dato, los umbrales ni ninguna señal de confianza: lo que no viaja no
   se puede pintar por error (SEC-A1), y una señal de confianza en el DTO acabaría dibujada. **Dos notas de
   dato:** (a) la cota operativa es **`psa10 > precio raw`** —mira hacia abajo porque el fallo típico, un
   valor en dólares escrito como pesos, aterriza por debajo—; (b) el estimado «absurdamente mayor» es **dato
   roto**, no un hecho de mercado: mejor **no emitirlo en absoluto**, y así R4 lo tapa en todas las
   superficies, ficha incluida.
6. **Arquitecto — orden/filtro de elegibles:** la vitrina del home necesita el listado **ya filtrado por
   el gate** (y por confianza) y ordenado (cap 8). Además, para ofrecer un «Ver todas» honesto en §22.6
   haría falta un **filtro/orden de elegibles** en `GET /catalog/cards`. Mientras no exista, la vitrina
   **omite** el enlace (no se enlaza a una vista que no filtra lo que promete).
7. **Frontend:** §22 **no pide ninguna modificación** a componentes existentes. Cambios que trae esta
   corrección respecto a lo ya implementado: (a) **el badge pierde el eyebrow** y gana la cifra con el
   condicional incorporado (`figure` / `figureShort`) más el **micro-aviso visible** en `<p>` real —el
   `sr-only` del badge **se elimina**, ya no aporta—; (b) **la ficha cambia `provenance` por
   `microNotice`** (versión corta completa, dos ideas en tinta 500); (c) la **llamada `*` se mueve** del
   eyebrow al final del micro-aviso. **Y tras la fusión con P-48:** (d) el bloque reutiliza **`Fact`, no
   `FactGrid`**, con el divisor **posicional** (§22.3) — `FactGrid` conserva su regla `border-border` y su
   `mt-9`, y **no** se le añade prop de tono; (e) **no** se empuja el estimado a la lista `FactSpec[]` de la
   ficha; (f) el estimado **no** lleva `PriceBasisTag`. Lo demás sigue igual: la nota se pinta **una clave
   por párrafo con rich text** (§22.11), nunca como un solo string; el salto usa `tabindex="-1"` +
   `scroll-margin-top` con `--app-header-h` (§4.5), no `top` hardcodeado; la llamada es enlace **solo** en la
   ficha (en la teja sería un ancla anidada); y la excepción de skeleton de §22.6 es intencional
   (prefetch/SSR preferido).
8. **QA visual sugerido:** (a) carta elegible vs. no elegible → tejas idénticas salvo el bloque del badge,
   **sin diferencia de altura reservada**; (b) subir `minUpsidePct` hasta que la carta deje de calificar →
   desaparecen **badge y entrada de vitrina**, **el bloque de la ficha permanece** (§22.7 — es el
   comportamiento correcto, no un bug) y el precio de venta no cambia; (**c-bis, el que falló**) **toda
   cifra estimada del DOM tiene, en su mismo contenedor, un micro-aviso VISIBLE con las dos ideas** —
   comprobar en las tres superficies con CSS activo y `sr-only` ignorado a propósito: si al ocultar los
   `sr-only` desaparece el aviso, **es el bloqueante otra vez** (R3.1, §O.5); (c) **ninguna cifra de
   estimado en una página cuyo DOM no contenga la nota al pie**, y ninguna cifra sin su llamada (R3); (d) 390px: las
   dos celdas apiladas, sin scroll horizontal ni monto truncado, probado con `MX$ 999,999.00` en ES;
   (e) la nota **nunca** por debajo de 13px de cuerpo, **visible sin interacción** —sin `<details>`, sin
   «leer más», sin scroll interno— y **encontrable con `Ctrl+F`**; (f) el salto lleva el **foco** (no solo
   el scroll) al encabezado de la nota, sin que el header sticky lo tape, y el enlace de regreso devuelve
   al punto de partida; (g) EN completo, incluida la nota y el texto accesible de la llamada; (h) **cero
   apariciones** de ganancia, multiplicador, costo de gradeo o porcentaje en todo el storefront (R5),
   incluido el payload de red; (i) el estimado **no aparece** en carrito, checkout, correos, bóveda ni
   buylist; (j) lector de pantalla: la llamada **no** se anuncia como «asterisco» sino con su texto, y el
   chip anuncia «grado hipotético»; (k) **cifra no confiable** —forzar muestra insuficiente, o un PSA 10 por
   debajo del precio raw— con el gate **cumplido** ⇒ desaparecen **badge y entrada de vitrina**, **el bloque
   de la ficha permanece** y el precio de venta no cambia; y la teja resultante es **idéntica** a la de una
   carta que no pasa el gate — si aparece cualquier marca que las distinga, **eso** sí es el bug (R5/R6);
   (l) ficha con `priceBasis !== "market"` (sin bloque «Valor de mercado», §21.8) ⇒ el bloque del gancho
   **sigue en su sitio**, después del `referenceExplainer` en su variante «sin mercado», y su retícula no
   hereda ningún divisor de la retícula de precio.

---

## 23. Ciclo de adquisición del buylist — ofertar, aceptar, guía y publicar (v2.3, §P de PROJECT)

> **Origen:** **no hubo entrega de Claude Design** para esta feature. §23 se genera desde cero sobre la piel
> ya ratificada (papel/tinta, radio 0, sombras 0 salvo el anillo de foco, las tres familias, cifras en mono
> con `tabular-nums`) y **no introduce ni un token de color ni un tamaño tipográfico nuevo**.
> **Normativo:** `PROJECT.md` §P (v2.1, aprobado, ocho fases y 40 decisiones) y `ARCHITECTURE.md` §4.39
> (v1.51.3) + `API_CONTRACT.md` v1.51. Donde este documento y `PROJECT.md` difieran, **manda PROJECT**;
> lo que aquí se decide es **cómo se ve y cómo se lee**, nunca el dato ni la regla.
> **Dónde se juega la feature:** en la **confianza del vendedor**. Es una persona que va a meter cartas de
> valor en un sobre y esperar dinero. Todo el diseño de esta sección sale de una sola frase de §P:
> *«un correo que anuncie $1,480 y termine en un depósito de $1,350 destruye exactamente la confianza que la
> oferta vinculante venía a construir»*.

### 23.0 Alcance y las SIETE reglas duras

**Qué diseña §23:** los **cinco correos** del ciclo (§23.4 — *eran cuatro hasta v2.3.3; la cancelación se
separó, ver §23.4.4-bis*), la **nota de servicio del envío** en el
cotizador (§23.3 — **sin cifras, v2.3.1/D43**; ~~el aviso con la resta hecha~~ quedó superado), los
**cuatro estados nuevos** y el **stepper de ocho pasos** (§23.1, §23.2), la
**pantalla del vendedor** que espeja el correo (§23.5), la **mesa de decisión** del admin (§23.6), el
**tratamiento del conteo ausente** (§23.7) y las **colas nuevas de M5** (§23.8).

**Qué NO diseña §23** *(se dice para que nadie lo dé por hecho)*: la **curva de compra** (§21 la cubre), la
**consola de precios** de M1/M2, la **cola de precio pendiente**, la **cola de pendientes de publicar** más
allá de su enlace desde M5 (fase 8 vive en M1, §16), la **integración con paquetería** (no existe: la guía
se compra a mano y se captura), y **ningún panel de bounties** (proyecto aparte del humano).

| # | Regla dura | Por qué existe |
|---|---|---|
| **R1** | **El NETO manda.** De los tres montos, el **neto** es el único vinculante frente al vendedor y **el único que puede aparecer solo**: en un **asunto** de correo, en un **preheader**, en un titular, en una notificación o en un resumen de una línea. **El bruto NUNCA aparece sin el envío y el neto al lado.** | El daño que este ciclo existe para evitar es *«dije $1,480 y llegaron $1,350»*. Un asunto que anuncia el bruto **es** ese daño, escrito antes de que el vendedor abra nada |
| **R2** | **La condición viaja pegada al dinero.** Toda superficie que muestre un **monto ofertado** —correo 1, correo 2, portal, confirmación de aceptación— muestra en el **mismo bloque** la condición NM. Sin excepción y **sin versión "limpia"** del recordatorio | La condición **es** lo que el vendedor acepta (D30). Un recordatorio que repite la cifra sin la condición convierte la condición en letra chica **por omisión** |
| **R3** | **Un correo por HECHO, no por camino.** Dos rutas que producen el mismo hecho comparten correo **palabra por palabra**; dos hechos distintos **no se fusionan** aunque compartan estado técnico | `expirada`/`no_offer` sale por barrido **o** por «declinar ahora»: al vendedor no le corresponde saber cuál (§4.39n). Y `not_shipped` vs `no_offer` comparten `status` pero afirman **cosas opuestas** |
| **R4** | **Ninguna cifra del ciclo se calcula en el cliente.** Montos, plazos, faltantes, umbrales y veredictos **llegan resueltos** del servidor y la UI los **renderiza** | Dos implementaciones de «día hábil» dan dos fechas; una constante `20000` en el front se desincroniza **en silencio** la primera vez que alguien mueve el dial (criterio 154, §4.39g) |
| **R5** | **La sugerencia informa; no bloquea, no preselecciona, no cambia de tamaño.** El servidor **no** valida la oferta contra ella y la UI tampoco | D6 es explícita. Endurecerla «por prudencia» **contradice PROJECT** (§4.39g). Y un default gobernado por la sugerencia es un bloqueo blando |
| **R6** | **«En camino» y «comprometido» NO se suman jamás.** No existe subtotal, paréntesis, `+`, barra de progreso apilada ni etiqueta común que los agrupe en una cifra | Tienen **confianza distinta** y esa distinción **es** el punto de la pantalla. *«Contar promesas como inventario es exactamente el error que esta pantalla existe para evitar»* (§P.2) |
| **R7** | **Un conteo ausente NO es un número.** Cuando el conteo no se pudo obtener, **desaparece la tira entera** y aparece una **frase**. Prohibidos `0`, `—`, `–`, `?`, `N/D`, celda vacía, gris de placeholder y skeleton permanente | Un cero que significa «no pude contar» *«es peor que no mostrar nada, porque se ve confiable»* y **empuja a comprar de más** (§P.8, §4.39f) |

> **⚠ Precisión de R1 (v2.3.1, D43) — sin ella, §23.3 parecería violar la regla.** **R1 gobierna el dinero
> de la OFERTA**, que es el único vinculante: ahí, y solo ahí, existen «bruto», «envío» y «neto», y ahí el
> bruto nunca puede aparecer sin los otros dos. **El total del cotizador NO es un bruto**: es una cotización
> **indicativa** sobre cartas que quizá no compremos, y por D43 **no tiene envío ni neto al lado** — por eso
> el cotizador **no lo llama bruto, no lo presenta como base de una resta y no lo rotula como pago**
> (§23.3c). Lejos de debilitar R1, D43 la refuerza: **la primera cifra que el vendedor ve rotulada como "lo
> que recibes" es el NETO**, en el asunto del correo 1 (§23.4.7).

---

### 23.1 Los cuatro estados nuevos — y el único enum que se pinta por su MOTIVO

**(a) Mapa canónico ampliado** (enmienda de §2.4; la tabla de §2.4 ya lo recoge). Versalitas ES/EN,
`text-[11px]` mono `uppercase tracking-[0.06em]`, **sin caja** (los `*-bg` son `transparent`, §2.3):

| Estado | Versalita ES / EN | Token | Qué significa para quien lo lee |
|---|---|---|---|
| `cotizada` | `COTIZADA` / `QUOTED` | neutral (`--color-text-muted`) | **Cambia de sentido en v2.3**: ya no es «llegó y algún día se verá», es **«te debemos una respuesta»** |
| **`ofertada`** | `OFERTADA` / `OFFER SENT` | `accent` | Hay una **oferta vinculante** afuera y **el reloj es del vendedor** |
| **`aceptada`** | `ACEPTADA` / `ACCEPTED` | `accent` | Dijo que sí. **Nada viaja todavía** |
| **`en_transito`** | `EN TRÁNSITO` / `IN TRANSIT` | `primary` (tinta) | Un paquete **viaja de verdad** |
| **`expirada` + `not_shipped`** | `SIN ENVÍO` / `NOT SHIPPED` | `danger` | **Aceptó y el paquete no salió** |
| **`expirada` + `no_offer`** | `NO PROCEDIÓ` / `NOT PURSUED` | neutral | **Nosotros no ofertamos.** No hay incumplimiento de nadie |
| **`expirada` + `null`** | `EXPIRADA` / `EXPIRED` | neutral | **Fallback legacy.** Nunca acusa |
| `pending_authorization` (`offerState`, **admin-only**) | `POR AUTORIZAR` / `NEEDS APPROVAL` | `accent` **outline** | Preparada, esperando al súper-admin. **El correo no ha salido** |

**(b) `accent` para `ofertada` y para `aceptada`, a propósito — y por qué `aceptada` NO es verde.**
El verde del sistema significa *«ya ocurrió y no depende de nadie»* (`settled`, `aprobada`, `pagada`).
`aceptada` es **lo contrario**: es un sí con un reloj corriendo y **sin una sola carta en la casa**. Pintarla
verde le diría al operador «esto ya está» sobre la fase con más riesgo del ciclo. Los dos estados comparten
tinta y **se distinguen por la palabra** (§2.4), que es la regla vigente; el discriminador operativo
—**cuál vence antes**— lo da el plazo en mono junto al badge, no un matiz de color.

**(c) `en_transito` en `primary` (tinta) — hereda el token de `Shipment.enviado`.** Es el mismo hecho del
mundo físico visto desde el otro lado del mostrador; usar otro tono inventaría una segunda gramática para
«va en camino».

**(d) ⚠ `expirada` se pinta por su MOTIVO. Es la única excepción del sistema y es obligatoria.**
`expiredReason` no es un detalle: es lo que decide **el color, la versalita, el copy y el correo**.

- **Regla:** el mapa de badges recibe `{domain:'sellRequest', status, expiredReason}` y resuelve
  `status==='expirada'` **por el motivo**. Un mapa que resuelva solo por `status` **es un defecto**, no una
  simplificación.
- **Fallback obligatorio y su dirección:** motivo `null`/desconocido ⇒ **neutral + `EXPIRADA`**, jamás la
  versión acusatoria. *En un desenlace ambiguo, el sistema no acusa al cliente.* Es la misma doctrina
  money-safe de §7.3 (`—` antes que `$0`), aplicada a la reputación en vez de al dinero.
- **Alcance:** cola de M5, ficha de solicitud, portal del vendedor, reportes de M9 y cualquier export.
  «Toda superficie que muestre el desenlace muestra el MOTIVO» (§P.1).

**(e) El «ya lo mandé» NO es un estado y no se pinta como badge.** Detiene el **reloj** del vendedor sin
mover el **estado** (§P.13). Se representa como **renglón mono bajo el badge**, no como segundo badge:

```
EN ESPERA DE ENVÍO                    ← badge de `aceptada`
PAQUETE REPORTADO · 2 sep, 4:10 p. m. ← renglón mono `text-[11px]` muted, SIN color de estado
```

- Un segundo badge invitaría a leerlo como estado y a **contarlo como inventario en camino**, que es
  exactamente lo prohibido (§P.13, criterio 156).
- En la **cola del operador** («por confirmar envío») el mismo renglón, **pasados 5 días hábiles**
  (`alert: true`), pasa a `--color-accent` con la palabra `ALERTA` delante. **No cambia el estado, no expira
  nada**: el pendiente es nuestro y el remedio es hacerlo visible.

---

### 23.2 `PipelineStepper` de OCHO pasos — y la rama de error que no es un paso

**(a) El mapa.** Enmienda §7.9:

```
1 COTIZADA → 2 OFERTADA → 3 ACEPTADA → 4 EN TRÁNSITO → 5 RECIBIDA → 6 VERIFICACIÓN → 7 APROBADA → 8 PAGADA
```

**La fase 8 de `PROJECT.md` («publicamos») NO es el paso 8 del stepper.** El stepper describe la vida de la
**solicitud**, que termina en `pagada`; publicar es vida de la **pieza** en inventario. En una solicitud
`pagada` el admin ve, bajo el stepper, un enlace `Ver las N piezas en la cola de publicación` (M1, §16) —
así el ciclo se cierra sin mentir sobre a quién pertenece el paso.

**(b) Layout — ocho pasos no caben horizontales en cualquier ancho.**

| Breakpoint | Orientación | Etiquetas |
|---|---|---|
| **≥ `xl` (1280)** | horizontal, 8 nodos, conector de 1px | versalita completa bajo el nodo |
| **`lg`–`xl`** | horizontal **compacto**: nodos con número, etiqueta **solo del paso actual** | los demás nodos exponen su etiqueta en `title` + `aria-label` |
| **< `lg` y SIEMPRE en el portal del vendedor** | **vertical**, con **fecha y hora** por paso completado | versalita + timestamp mono |

> **El portal del vendedor usa SIEMPRE la vertical con timestamps**, incluso en escritorio. No es una
> concesión de espacio: el vendedor no está leyendo un pipeline, está leyendo **el historial de su venta**, y
> ese objeto se lee de arriba abajo como un rastreo de paquetería.

**(c) Estados de nodo** (§7.9 sin cambios): completado (tinta, regla continua), **actual**
(`aria-current="step"`, tinta peso 500 + anillo), pendiente (regla `--color-border`, etiqueta muted).
**Cero rellenos de color**; el conector completado es tinta de 1px, el pendiente es regla.

**(d) La rama de error es un CIERRE, no un noveno paso.** Al llegar a una terminal el stepper **trunca**:
se pintan los pasos realmente completados y, en lugar del siguiente nodo, un **cierre** con regla superior
de tinta, la versalita del **motivo** (§23.1d) y la fecha:

```
COTIZADA ✓ ── OFERTADA ✓ ── ACEPTADA ✓ ──┐
                                          └─ SIN ENVÍO · 5 sep 2026
```
```
COTIZADA ✓ ──┐
              └─ NO PROCEDIÓ · 5 sep 2026
```

- **Prohibido** pintar los pasos no alcanzados como «fallidos», tacharlos o ponerles ✗. En `no_offer` el
  vendedor **no falló nada**; una cadena de cruces le imputaría un incumplimiento visual que el correo 4
  tiene prohibido decir con palabras.
- **Prohibido** pintar el cierre `no_offer` en `danger`. Su token es **neutral** (§23.1d).
- `rechazada` por no responder ⇒ cierre en `danger` con versalita `RECHAZADA` colgando de `OFERTADA`.
- `abandonada` ⇒ cierre neutral colgando del último paso físico alcanzado.

**(e) Accesibilidad.** `<ol>` con un `<li>` por paso; `aria-current="step"` en el actual; el cierre es un
`<li>` con `aria-label` completo («Cerrada el 5 de septiembre de 2026: no procedimos con la oferta»). El
color **nunca** es el único indicador: versalita + timestamp + `aria-label`.

---

### 23.3 El envío en el cotizador — una NOTA DE SERVICIO, sin cifras (v2.3.1 · D43)

> **⚠ Sección reescrita el 2026-09-01 por decisión del humano (D43).** Lo que v2.3 pedía aquí —**la resta
> hecha y enseñada** dentro del bloque de dinero del carrito— queda **SUPERADO**. Se conserva en **(a)**,
> marcado y sin borrar, porque el contraste entre las dos versiones **es** la lección. **Lo vigente empieza
> en (b).** Si algo de §23 sigue asumiendo que el vendedor vio una cifra de envío antes de la oferta, manda
> esta sección.

**(a) ⚠ SUPERADO — la «aritmética ya hecha» de v2.3. NO IMPLEMENTAR.**

> ```
> ┌ TU COTIZACIÓN ────────────────────────────────┐   ⚠ SUPERADO por D43 — NO IMPLEMENTAR
> │ 3 cartas                                      │
> │ Valor de tus cartas              MX$ 500.00   │
> │ Envío que ponemos nosotros     − MX$ 180.00   │
> │ ───────────────────────────────────────────   │
> │ RECIBIRÍAS ≈                     MX$ 320.00   │
> └───────────────────────────────────────────────┘
> ```
> Quedan retirados: ~~la línea de envío~~, ~~la regla de la resta~~, ~~`RECIBIRÍAS ≈`~~, ~~el neto
> estimado~~ y ~~la aparición conjunta de envío + neto al cruzar el mínimo~~.

**Por qué se retira** (tres razones, y la segunda no estaba en v2.3):

1. **El cotizador ya es indicativo.** Los precios se mueven y **puede que no compremos todas las líneas**.
   Restarle un envío exacto a un número que de todas formas va a cambiar es **precisión falsa**: le sugiere
   al vendedor un neto que **nadie se comprometió a pagar**. La resta pertenece al único documento donde los
   números son vinculantes.
2. **⚠ Y el neto del cotizador era sistemáticamente OPTIMISTA.** El cherry-pick solo **quita** líneas: el
   bruto de la oferta es **≤** el total del carrito, y el neto también. `RECIBIRÍAS ≈ MX$ 320` no era una
   aproximación centrada, era **la mejor cifra posible** — es decir, fabricaba con nuestras propias manos la
   decepción *«dije $500 y llegaron menos»* que **R1** existe para evitar. El `≈` no salvaba eso: un `≈` se
   lee como «más o menos esto», no como «esto o menos».
3. **Nota de proceso, y me toca a mí:** **D31 nunca pidió cifras en el cotizador.** Pide que el cotizador
   diga «con todas sus letras» que **ponemos la guía** y que **siempre** se deduce del pago. Los tres montos
   en el carrito fueron una **amplificación de este documento** — el mismo patrón por el que D31 tuvo que
   retirar el umbral de MX$1,000 que *«nunca fue un pedido del humano»*. **D43 no contradice D31: le quita
   la amplificación.** El requisito de comunicar el descuento sigue vivo y esta sección lo cumple.

**(b) La decisión vigente (D43).** El cotizador **no menciona ningún monto de envío**: **sin cifra, sin
resta, sin neto estimado, sin porcentaje**, y **sin expresar el faltante del mínimo en términos de envío**.
Solo una **frase cualitativa**. La resta con los tres montos vive **exclusivamente en la oferta** —correo
(§23.4.2) y portal (§23.5)—, autenticada y armada server-side con la tarifa **congelada**.

> **⚠ Consecuencia que hay que decir en voz alta, porque cambia el peso de otra pantalla:** **el correo de
> oferta es ahora la PRIMERA vez que el vendedor ve el monto del envío.** Ya no confirma algo que vio en el
> carrito: es **información nueva, en el momento exacto en que decide**. Ver §23.4.2 (enmienda v2.3.1) y la
> objeción registrada en (l).

**(c) La forma: es una NOTA DE SERVICIO, no una advertencia y no letra chica.**
No es un banner de aviso —eso ya se rechazó en v2.3 y **sigue rechazado**— ni una nota al pie. Es **un hecho
del trato**, redactado como se redacta un hecho del trato: prosa corta, en tinta, **dentro del bloque de
dinero**, con el mismo rango visual que la información de servicio de un pedido («llega en 3 días»).

| Rechazado | Por qué |
|---|---|
| **`Banner warning`** («Ojo: se descuenta el envío») | Un banner de atención sobre un trato que es **bueno** para el vendedor lo enmarca como problema. Y los banners se ignoran: la ceguera que §22.12 ya documentó |
| **Asterisco + nota al pie / `<details>` / tooltip / acordeón** | Es la definición de letra chica que §P.3 prohíbe. Y un tooltip **no existe en táctil**. La frase no se esconde: es corta **porque** tiene que estar a la vista |
| **Porcentaje («−36%»)** | Invita a discutir el porcentaje en vez de leer el trato, y **cambia con cada carrito**. Sin cifras **y sin porcentajes** |
| **Un renglón de envío con `—`, `?` o «según la oferta»** | Un hueco con forma de monto **se lee como monto** (misma doctrina que R7 y que §7.3). Si no hay cifra, **no hay renglón**: el bloque de dinero del cotizador tiene **exactamente un monto** |
| **La cifra «solo en los requisitos de venta» o «solo en el FAQ del cotizador»** | Cumplimiento por reubicación. El panel de requisitos y el paso de crear **son el cotizador**. D43 no admite una puerta lateral |

```
┌ TU COTIZACIÓN ────────────────────────────────┐
│ 3 cartas                                      │
│ Valor de tus cartas              MX$ 500.00   │  ← el ÚNICO monto del bloque
│                                               │
│ Nosotros ponemos la guía de envío y su costo  │  ← sans text-sm, TINTA (no muted),
│ se descuenta siempre de lo que te pagamos:    │    sin icono, sin caja, sin regla
│ tú no pagas nada de tu bolsillo. El monto     │    que la separe del monto
│ exacto va en la oferta, antes de que aceptes. │
└───────────────────────────────────────────────┘
```

- **Vive dentro del bloque de dinero**, separada del monto **solo por aire** (escala §4.1, ~`12px`). Ni
  regla, ni caja, ni pozo: un escalón de superficie la convertiría en «aviso» y (c) ya explicó por qué no.
- **En tinta `--color-text`, `text-sm`** — nunca muted: §10 prohíbe el muted para información esencial, y
  D31 exige esta regla «al mismo nivel visual que los montos».
- **Siempre visible —desde el carrito vacío, no desde la primera carta—** y **con el mismo texto por encima
  y por debajo del mínimo**. Que se lea **antes** de agregar nada es justamente el punto: el trato se explica
  cuando todavía no cuesta nada cambiar de opinión.
  Al no llevar cifras **no depende de ningún estado**: no aparece, no desaparece, no se mueve. Eso mata de
  raíz una clase entera de bugs que v2.3 sí tenía (el bloque que se materializaba al cruzar el mínimo).
- **El total se rotula por lo que es:** `Valor de tus cartas`. **Prohibidos** `Total a recibir`, `Tu pago`,
  `Ganarías` o cualquier rótulo que prometa depósito (§7.3: money-safe también es no prometer).
- **No es una región `aria-live`.** Es copy estático; anunciarla en cada cambio del carrito la convertiría
  en ruido y, peor, en alarma.

**(c-bis) La regla que faltaba: un TOTAL rotulado no promete depósito; un precio POR CARTA sí puede decir
«Pagamos» (v2.3.2).** §23.3c prohibía `Total a recibir`, `Tu pago` y `Ganarías`, pero lo hacía **como lista
de ejemplos**, y por eso `home.quoter.wePay` («Te pagamos») sobrevivió al pase de D43 en otra pantalla. La
regla, ahora en forma general y verificable:

| Superficie | ¿Puede rotularse como pago? | Por qué |
|---|---|---|
| **El TOTAL de un bloque de dinero del cotizador** (carrito, panel de escritorio, teaser del home, resumen del paso de crear) | **NO.** Solo `buylist.quote.money.cardsValue` — «Valor de tus cartas» / "Value of your cards" | Ese total **es la suma de las cartas**, no lo que se deposita: le falta la resta del envío y le sobran las líneas que quizá **no compremos** (§23.3a.2). Rotularlo «Te pagamos» **es** el daño *«dije $500 y llegaron menos»*, escrito antes de que exista una oferta |
| **El precio de UNA carta** (teja de bounty, línea del carrito, ficha) | **SÍ**, `Pagamos` / "We pay" | Nombra una **tarifa por pieza**, no un importe a depositar. El descuento del envío es **por solicitud**, no por carta, así que no hay resta que omitir. `home.bounties.wePay` y `buylist.bounties.wePay` **se quedan como están** |

- **Prueba de una línea:** *si el número es una **suma**, su rótulo no puede contener un verbo de pago.*
  ES: `pagamos`, `te pagamos`, `recibes`, `ganas`, `depositamos`. EN: `we pay you`, `you get`, `you'd
  receive`, `payout`. **Sobre un precio unitario, esos verbos sí se permiten.**
- **Un solo string para el rótulo del total.** Las tres superficies usan **la misma clave**,
  `buylist.quote.money.cardsValue`, aunque vivan en namespaces distintos. Un `home.quoter.cardsValue`
  duplicado es exactamente el mecanismo por el que este rótulo se desincronizó la primera vez.

**(d) La redacción, ES y EN — cuatro movimientos, y el orden es normativo.**
La frase tiene que lograr **dos cosas a la vez**: que el vendedor **sepa que habrá un descuento** antes de
crear la solicitud, y que **no crea que ya sabe cuánto**. Ahí se juega todo el patrón.

| # | Movimiento | ES | EN | Qué hace |
|---|---|---|---|---|
| 1 | **Quién pone la guía** | «Nosotros ponemos la guía de envío» | "We provide the shipping label" | Encuadra el hecho como **servicio**, no como cobro |
| 2 | **La resta, nombrada y sin condición** | «y su costo se descuenta siempre de lo que te pagamos» | "and its cost is always deducted from what we pay you" | **Anuncia el descuento.** `siempre` / `always` cierra la lectura «quizá solo en algunos casos» |
| 3 | **El alivio, DESPUÉS de la resta** | «: tú no pagas nada de tu bolsillo» | ": you pay nothing out of pocket" | Impide leerlo como castigo. Va **después**, nunca antes |
| 4 | **La cita con el número** | «El monto exacto va en la oferta, antes de que aceptes.» | "The exact amount is in the offer, before you accept." | **Impide creer que ya sabe cuánto** y dice **dónde y cuándo** lo sabrá |

**Texto completo (normativo; PO ratifica, §23.13.6):**
- **ES** — *«Nosotros ponemos la guía de envío y su costo se descuenta siempre de lo que te pagamos: tú no
  pagas nada de tu bolsillo. El monto exacto va en la oferta, antes de que aceptes.»*
- **EN** — *"We provide the shipping label and its cost is always deducted from what we pay you: you pay
  nothing out of pocket. The exact amount is in the offer, before you accept."*

**Por qué el orden 2 → 3 es normativo.** Invertido («no pagas nada de envío, y su costo se descuenta…») la
primera cláusula **ancla en "gratis"** y la segunda se lee como una corrección incómoda. La resta se nombra
primero **porque es la noticia**; el alivio es el matiz, no el titular.

**Por qué el movimiento 4 es el que sostiene el patrón.** Convierte un **hueco de información** en una
**cita**: no dice «hay un descuento que no te decimos», dice «**el número exacto te llega antes de que te
comprometas**». Es la misma doctrina de §7.3 y de R7 aplicada al copy: cuando no hay número, se dice **qué
va a pasar con el número** — jamás se insinúa uno. Sin el movimiento 4 la frase es honesta pero deja al
vendedor **rellenando el hueco con su propia estimación**, que es la peor de las cifras posibles: la que se
inventó él.

**(e) Prohibiciones del cotizador — la lista es cerrada y es verificable de un `grep`:**

| Prohibido | Por qué |
|---|---|
| **Cualquier cifra de envío**: `MX$ 180`, `180`, `~200`, `$0` | D43. Y `$0` sería mentira: sí hay costo, lo pagamos y se descuenta |
| **Rangos** («entre $150 y $200», «alrededor de $180», «aprox.») | Un rango **es** una cifra, con menos precisión y la misma promesa implícita |
| **Adjetivos de tamaño aplicados a la tarifa**: «pequeño», «mínimo», «bajo», «simbólico», «razonable», «apenas», «solo» | **Es un juicio que no nos toca.** En una cotización de MX$500 la tarifa es el **36%**: llamarla «pequeña» es decidir por el vendedor cómo debe sentirse ante un número que **todavía no le enseñamos**. *(La palabra «mínimo» sigue siendo legítima donde nombra el **mínimo de compra** —«el mínimo de MX$500»—: ahí no califica la tarifa, nombra un umbral.)* |
| **Porcentajes** | Igual que las cifras, y además cambia con cada carrito |
| **`RECIBIRÍAS`, `NETO ESTIMADO`, `TE QUEDARÍAN`, `≈` sobre un neto** | Es la resta por otro nombre |
| **Expresar el faltante del mínimo en términos de envío** («te faltan $120 para cubrir el envío») | Reintroduce la cifra **y** miente sobre qué es el mínimo: el mínimo **no es** el envío |
| **«comisión», «cargo», «penalización», «retención», «descuento por manejo»** | No es ninguna de esas cosas. Es **la guía que ponemos nosotros** |
| **«gratis», «sin costo», «cortesía», «envío gratis»** | Es exactamente la lectura falsa que el movimiento 2 viene a impedir |
| **«como ya sabes», «recuerda que»** | El vendedor **no lo sabía**. Presuponer conocimiento es la versión educada de mentir |

**(f) El mínimo se queda — solo, y sin nada de envío al lado.**
El faltante es **un monto legítimo del cotizador**: es una cifra sobre **sus** cartas, no sobre nuestro
servicio, y sin ella un «no» seco manda al vendedor a otro lado (criterio 132, que **no cambia**).

```
┌ TU COTIZACIÓN ────────────────────────────────┐
│ 2 cartas                                      │
│ Valor de tus cartas              MX$ 380.00   │
│                                               │
│ TE FALTAN MX$ 120.00 para el mínimo de        │
│ MX$ 500.00.  Agrega otra carta.               │
│                                               │
│ Nosotros ponemos la guía de envío y su costo  │  ← la MISMA frase, sin cambios
│ se descuenta siempre de lo que te pagamos:    │
│ tú no pagas nada de tu bolsillo. El monto     │
│ exacto va en la oferta, antes de que aceptes. │
└───────────────────────────────────────────────┘
```

- **Queda retirada la regla de v2.3** que ataba la aparición del envío al cruce del mínimo («aparecen
  juntos, en el mismo instante»): **ya no hay nada de envío que aparezca**. Al cruzar el mínimo lo único que
  cambia es que **el faltante desaparece**.
- El faltante y el mínimo son `details.shortfallCents` y `minimumRequestCents` **del servidor** (R4). La
  **puerta manda sobre la pantalla**: si el `422 BUYLIST_MINIMUM_NOT_MET` trae otro mínimo, se repinta con
  el del error.
- La transición al cruzar el mínimo sigue anunciándose con **`aria-live="polite"`**, y **el anuncio ya no
  menciona envío ni neto**: *«Ya alcanzaste el mínimo de MX$ 500.00.»*

**(f-bis) ⚠ Con líneas sin precio, «Agrega otra carta» es el consejo EQUIVOCADO (v2.3.8).**
Con 999 cartas en `precio_pendiente`, el bloque decía *«TE FALTAN MX$ 500.00 para el mínimo de MX$ 500.00.
**Agrega otra carta.**»* mientras el vendedor miraba **un carrito lleno**. Aritméticamente impecable; como
consejo, **una cinta de correr**: puede agregar mil cartas más del mismo set y **seguir en cero**.

**Es peor que confuso — es una instrucción que no puede funcionar.** Y el daño se acumula con el de (h):
el mensaje se lee como *«tu carrito está casi vacío»* justo cuando está lleno.

**La corrección: el consejo cambia cuando hay líneas sin precio.** No el faltante —ese es correcto y se
queda—, **solo la acción sugerida**:

| Estado | Qué se pinta |
|---|---|
| Falta para el mínimo, **sin** líneas sin precio | faltante + mínimo + **`minimum.addAnother`** — «Agrega otra carta.» *(sin cambios)* |
| Falta para el mínimo, **con** líneas sin precio | faltante + mínimo + **`minimum.addPricedCard`** — **«Agrega una carta que ya tenga precio.»** La explicación del **por qué** ya está encima, en `pendingLine.note` (§23.3h), y **no se repite aquí** |

| Clave | ES | EN |
|---|---|---|
| **`minimum.addPricedCard`** *(nueva)* | Agrega una carta que ya tenga precio. | Add a card that already has a price. |

- **«que ya tenga precio»**, no «con precio»: el **«ya»** dice que las otras **también lo tendrán**, y
  evita partir el carrito en cartas buenas y cartas malas. Coherente con la segunda frase de (h).
- **El faltante NO cambia de cifra ni de redacción.** Sigue siendo `details.shortfallCents` del servidor
  (R4) y sigue siendo **legítimo** (criterio 132): es una cifra sobre **sus** cartas.
- **Prohibido** convertir el faltante en una explicación («te faltan MX$500 porque tus cartas no tienen
  precio»): mezcla dos hechos en una cifra y **la cifra deja de ser verificable**. Dos frases, dos trabajos:
  **(h)** explica **por qué el total es ese**, **(f-bis)** dice **qué hacer**.
- El anuncio `aria-live` al cruzar el mínimo **no cambia**.

**(g) Dónde se dice la regla, actualizado.** D31 exige tres superficies —**cotizador, correo de oferta y
términos**—; **las tres siguen diciéndola**, y lo que cambia es **quién puede llevar la cifra**. El cotizador
ocupa dos filas porque son dos pantallas (carrito y paso de crear); el **correo de oferta** es la cuarta fila
y vive en §23.4.2:

| Superficie | Cuándo | Qué muestra | ⚠ |
|---|---|---|---|
| **0. Teaser del cotizador en el HOME** (`HomeQuoterPanel`) — **NUEVA v2.3.2** | **siempre**, en las **dos** instancias (columna del hero y sección móvil) y **con o sin líneas** | la frase de (d), **misma clave y mismo texto**; el total rotulado `cardsValue` (c-bis) | **NO cuelga de `withTrust`**: esa banda **no se pinta en móvil**, y móvil es donde vende la mayoría. Va en el **cuerpo del panel**, entre el bloque de dinero y el enlace «Continuar mi cotización» |
| **1. Carrito del cotizador** (`SellCartDrawer` / panel fijo de escritorio, §18.4) | **siempre, incluso con el carrito vacío** | el bloque de (c): **un monto** (cuando hay líneas) + la frase de (d) | El `SellRequirementsPanel` del propio drawer **también es cotizador**: tampoco lleva cifras de envío |
| **1-bis. Cabecera de `/buylist`** (bajo `payAfterReceipt`) — **NUEVA v2.3.2** | siempre | la frase de (d), **misma clave**, en **tinta `text-sm`** (no `muted`, no `rule-note`) | En **móvil el carrito es un drawer cerrado**: sin esta instancia, un vendedor puede recorrer toda la página sin leer la regla. **Sustituye** al retirado `buylist.trustShipping` (§23.14.2) |
| **2. Paso de crear la solicitud** | antes del botón que crea | la **misma frase, carácter por carácter** + la condición NM + la dirección de origen elegida | Es el último momento antes de comprometer cartas: **misma frase, no una versión resumida** |
| **2-bis. Guía de empaque, paso 4** (`SafeShippingGuide`, §7.13) — **NUEVA v2.3.2** | siempre que se pinte el componente (modal, sección inline, y los correos de §P) | **su propia redacción corta** (§23.14.1): quién pone la etiqueta + **que se descuenta** + qué no hacer | **Única excepción al «misma frase»**, y está acotada: es una **celda de retícula de ~13px**, no un bloque de dinero. Lo que **no** puede omitir es la resta (§23.14.3) |
| **3. Términos** (`offer.terms`, render del backend) | con la oferta | la regla **en prosa y CON la cifra congelada** | **Los términos NO son el cotizador**: viajan con la oferta, son autenticados y ahí el número **sí** es vinculante |
| **4. Correo de oferta** (§23.4.2) | al emitir | la regla en prosa **con el envío Y el neto nombrados**, junto a la tabla de los tres montos | **Es la primera vez que el vendedor ve la tarifa** (v2.3.1). Ver la decisión 8 de §23.4.2 |

> **⚠ Por qué la fila 0 entra y no es una amplificación (la pregunta correcta, después de §23.3a.3).** El
> panel del home **se rotula a sí mismo «Cotizador»**, cotiza contra `POST /buylist/quote` y enseña un
> total: **es el cotizador**, y es **la primera pantalla de dinero de todo el embudo**. D31 pide que la
> regla se diga **en el cotizador**; incluirlo es **cumplimiento literal**. Lo que en v2.3 fue
> amplificación fue meter **cifras**, y esta fila **no mete ninguna** (la frase es estática, §23.3k: no
> depende de ningún dato, no se esqueletiza, no puede fallar). Dejarlo fuera sería dibujar la frontera de
> D31 alrededor de **las superficies que yo ya había documentado** — que es, exactamente, el mecanismo por
> el que estos tres textos sobrevivieron.

**(g-bis) ⚠ EXACTAMENTE UNA nota visible por pantalla (v2.3.8).** La tabla de (g) dice **dónde puede** ir
la nota; le faltaba decir **cuántas se ven a la vez**. A 1280px `/buylist` acabó mostrando **dos párrafos
idénticos de cuatro líneas** —cabecera y panel fijo del carrito—, porque autoricé cada fila por separado y
**nunca miré las dos juntas**.

**La regla:** *en cualquier pantalla y a cualquier ancho, la nota se ve **una vez**: ni cero, ni dos.*

**Y el criterio de desempate sale solo de por qué existe cada instancia — gana la más cercana a la
decisión:**

| Situación | Quién pinta | Por qué |
|---|---|---|
| **Carrito visible de forma persistente** (escritorio: panel fijo lateral) | **el bloque de dinero** | Es donde está el monto. La cabecera **no se monta**: su única razón de ser era cubrir el caso contrario |
| **Carrito NO visible** (móvil: drawer cerrado) | **la cabecera** | Es literalmente el motivo por el que la fila 1-bis existe: sin ella se recorre la página entera sin leer la regla |
| **Drawer abierto** (móvil) | **el bloque de dinero** del drawer | Tapa la página; la de la cabecera no está a la vista |
| **Paso de crear** | **el suyo** | Es el último momento antes de comprometer cartas (fila 2) |

- **Esto NO contradice §23.3c** («no aparece, no desaparece, no se mueve»): esa prohibición es sobre el
  **estado del carrito** —vacío/lleno, bajo/sobre el mínimo—, no sobre el **layout**. La invariante que
  ahora se pide es **más fuerte y más simple de comprobar**: *siempre visible exactamente una vez*, en vez
  de *al menos una vez*.
- **Por qué dos copias idénticas sí son un defecto**, aunque el texto sea correcto: dos párrafos iguales
  a 600px de distancia y con el mismo peso visual son **la firma de un error de render** — el vendedor no
  concluye «esto es importante», concluye «esta página está rota». Y repetir **no** refuerza: es la misma
  ceguera que §23.3c ya invocó para rechazar el banner.
- **Comprobable en una línea:** contar los nodos **visibles** de `BuylistShippingNote` en cada ancho ⇒
  **exactamente 1**. Ver §23.14.6-6, que ya exige medir **visibilidad efectiva** y **desambiguar la
  instancia**.

**(h) Líneas sin precio (`precio_pendiente`) — ⚠ REESCRITO v2.3.8: el problema no era la línea, era el
TOTAL.**

> **La evidencia, y es de las mejores que ha dado este proyecto.** Un **test E2E** agregó cartas de un set
> sin precios, vio el total en cero y **concluyó que el cotizador no sumaba**. No sumaba **porque no
> debía** — pero **nada en pantalla lo decía**. *Si alguien que conoce el sistema saca esa conclusión, un
> vendedor con 999 cartas la saca seguro.* Y el vendedor no puede abrir un issue: cierra la pestaña.
>
> **El diagnóstico, en una frase:** *una pantalla aritméticamente correcta que no explica su propia
> aritmética le enseña al usuario que está rota.* Es **R7 aplicada al total**: R7 dice que **un conteo
> ausente no es un número**; aquí el espejo es que **un total de cero que significa «todavía no lo he
> calculado» no es un cero**. §23.3h ya lo tenía bien **por línea** (`SIN PRECIO`, nunca `MX$ 0.00`); lo
> que faltaba era **decirlo del agregado**, que es lo único que el vendedor mira cuando tiene 999 líneas.

**Por línea:** aportan **0** al total. Versalita **`SIN PRECIO`** (`accent`, §7.3) **sin monto**.
**Nunca `MX$ 0.00`**, nunca excluidas en silencio.

- **⚠ Se RETIRA la línea muted por ítem** (*«Todavía no tiene precio; no suma a tu total.»*). Con carritos
  de cientos de líneas, repetir la misma explicación N veces **es ruido, no información**, y empuja hacia
  abajo lo único que hay que leer. **La etiqueta se repite; la explicación, no.** *(Es el mismo criterio
  por el que §23.4.3 prohíbe que el recordatorio repita el desglose.)*

**En el bloque de dinero, UNA vez:** siempre que haya al menos una línea sin precio, se pinta
**`buylist.quote.pendingLine.note`** —independiente del mínimo, del total y de si falta algo—:

| | ES | EN |
|---|---|---|
| **`pendingLine.note`** | {count, plural, one {# carta todavía no tiene precio, así que no suma al total} other {# cartas todavía no tienen precio, así que no suman al total}}. Las cotizamos a mano y te las incluimos en la oferta. | {count, plural, one {# card has no price yet, so it doesn't count toward the total} other {# cards have no price yet, so they don't count toward the total}}. We quote those by hand and include them in your offer. |

- **La segunda frase no es relleno: es la que evita que el vendedor las borre del carrito.** Sin ella,
  «no suman» se lee como «no las queremos», y la reacción racional es **quitarlas** — perdiendo justo las
  cartas que más trabajo nos costó catalogar. Dice **qué pasa con ellas**, que es la doctrina de §23.3d
  movimiento 4 aplicada aquí: *cuando no hay número, se dice qué va a pasar con el número*.
- **En tinta `text-sm`**, no muted: §10 prohíbe el muted para información esencial, y esta explica **por
  qué el total no es lo que el vendedor esperaba**.
- **No lleva ningún monto** ⇒ §23.3c sigue intacta: el bloque de dinero tiene **exactamente un monto**
  (más el faltante y el mínimo cuando aplican, §23.3f). Un conteo de cartas **no es un monto**.
- **Si TODAS las líneas están sin precio**, el total **no se pinta `MX$ 0.00`**: se pinta la versalita
  `SIN PRECIO` en lugar de la cifra (regla ya viva en el carrito) **y esta nota debajo**.

**(i) NO hay casilla de «entiendo el descuento» al crear la solicitud — y con D43 menos que nunca.**
El acto vinculante es **aceptar la oferta** (§23.5), y ahí sí hay confirmación, con el número enfrente.
Pedir consentimiento aquí produce dos daños: fricción donde no protege, y la falsa impresión de que el trato
ya está cerrado. **Y ahora se agrega un tercero, decisivo:** una casilla que dice «entiendo el descuento»
sobre un monto que **deliberadamente no estamos mostrando** extrae consentimiento **de algo desconocido** —
es el patrón oscuro que este ciclo entero existe para no cometer. **Si alguien propone la casilla como
compensación por D43, la respuesta es no.**

**(j) La dirección de origen, en el mismo paso.** Se pide **al crear** (D36/D37), con el patrón de la
libreta que ya existe: si tiene direcciones guardadas, **`Select` con la predeterminada preseleccionada**
(el recurrente no teclea nada); si no tiene ninguna, el formulario de alta inline, y queda en su libreta.
Sin dirección **el botón de crear está apagado con `aria-describedby`** apuntando al motivo — nunca un
botón mudo (§15.9). Copy de por qué: *«La necesitamos para imprimir la guía que te vamos a mandar.»*
`422 PICKUP_ADDRESS_REQUIRED` / `PICKUP_ADDRESS_NOT_FOUND` se pintan inline en el campo, no como toast.

**(k) Dependencia de datos: D43 la vuelve casi cero.**

| Dato | ¿Lo necesita el cotizador? | Qué pasa si no llega |
|---|---|---|
| La **frase** de (d) | **No necesita ningún dato.** Es copy estático de `messages/{es,en}.json` | No puede fallar. **No se esqueletiza, no se condiciona, no espera al servidor** |
| `minimumRequestCents` (`GET /buylist/quote-policy`, D41) | **Sí**, para el faltante | **No se pinta el faltante y no se inventa ningún mínimo.** El CTA sigue vivo: la puerta real es el `422` del servidor, que trae el mínimo autoritativo y repinta |
| `shippingFeeCents` | **⚠ Ya NO.** Ninguna superficie pública lo consume | — (ver **§23.13.1-bis**: se propone retirarlo del DTO público) |

La regla 1 de §11.4 aplicada al dinero (R4) sigue en pie: **ninguna cifra de estas se hardcodea**. Lo que
cambia es que **la cifra que más riesgo de hardcodeo tenía —la tarifa— ya no se pinta en ningún lado
público**, así que el riesgo desaparece por construcción, no por disciplina.

**(l) Objeción registrada (obligación de representar a quien usa esto).**
**Acepto D43** y creo que la razón que la sostiene es correcta —y en (a.2) le agregué un argumento que la
refuerza—. Queda **una reserva acotada**, para que esté escrita y se pueda medir:

- **La reserva:** el vendedor que cotiza **cerca del mínimo** decide crear la solicitud, captura su
  dirección y espera, sin saber que la deducción puede ser **~36%** de lo que está viendo. Lo descubre en el
  correo. **No pierde dinero ni cartas** —puede decir que no, y ese es el punto que baja la gravedad—, pero
  **sí pierde tiempo y confianza**, y nosotros perdemos el trato con una oferta ya emitida.
- **Lo que NO propongo:** volver a pintar la cifra en el cotizador. Ya vimos en (a.2) que el neto de esa
  pantalla es optimista por construcción; enseñarlo sería peor.
- **Lo que propongo, y es de producto, no de diseño (§23.13.6-bis.b):** **medir el rechazo por tamaño de
  oferta.**
  Si las ofertas chicas se rechazan sistemáticamente después del correo, el problema **no** es la
  divulgación: es **la proporción**. Y la proporción se arregla con **un dial** —subir el mínimo de compra
  para que la tarifa nunca sea una tajada brutal—, no con más letra en una pantalla indicativa.

---

### 23.4 Los CINCO correos del ciclo

> Los correos son **el documento donde se cierra el trato**. `PROJECT.md` §P.3 los pone al mismo nivel que
> una pantalla: la oferta **es** el correo. Aquí se define la **estructura, la jerarquía y el tono**; el
> texto vive en las plantillas locales del módulo `buylist` (`buylist-mail.templates.ts`, bilingüe por
> `User.locale`) y el **render es del backend**. La **redacción es de ux-ui** y se ratifica con PO.
>
> **⚠ v2.3.3 — SON CINCO, y «3c» ya no existe. Manda `ARCHITECTURE §4.39(n)`.** §23.4.4 trataba la
> **cancelación de la oferta por nuestra parte** como una tercera variante del correo 3. **Es un correo
> propio, el 5**, y el argumento no es de jerarquía documental sino de hechos: **3a y 3b dejan la solicitud
> en un estado TERMINAL; la cancelación la deja `cotizada` y VIVA**, de vuelta en la fila con 7 días
> hábiles completos (D38). Agruparlos era precisamente lo que **R3** prohíbe —*un correo por HECHO, no por
> camino*— aplicado al revés: no fusioné dos caminos del mismo hecho, **fusioné dos hechos distintos**.
> **El texto que escribí para «3c» es correcto y no se redacta nada nuevo**: cambia de número, de
> subsección (**§23.4.4-bis**) y —lo que de verdad importa— **de prefijo de clave** (§23.12).
>
> *(Nota de formato: §23.4 es la **única** sección del documento con cuatro niveles de encabezado. Son nueve
> bloques hermanos —el medio, el esqueleto y los cinco correos con sus asuntos— y meterlos como negritas
> dentro de un solo `###` los volvería inencontrables. No es un desliz.*
> **La numeración `23.4.N` NO sigue al número del correo** y por eso el 5 entra como **§23.4.4-bis** en
> lugar de renumerar `.5/.6/.7`: hay referencias cruzadas vivas a esas tres subsecciones dentro y fuera de
> §23, y **renumerarlas para ganar una coincidencia estética habría roto punteros reales**.)*

#### 23.4.0 El medio: papel y tinta en HTML de correo

El correo no es la app y no puede fingir que lo es. Restricciones asumidas como **parte del diseño**:

| | Norma |
|---|---|
| **Ancho** | **600px** máximo, **una sola columna**, tablas para layout, estilos **inline**. Ningún `flex`, ningún `grid` |
| **Tipografía** | **Se diseña con los fallbacks, no con las webfonts.** Ningún cliente serio carga `Zen Old Mincho`/`Archivo`/`JetBrains Mono` de forma fiable. Pilas declaradas: serif `Georgia, 'Times New Roman', serif` · sans `Archivo, Arial, Helvetica, sans-serif` · mono `'JetBrains Mono', Consolas, Menlo, monospace`. **El correo tiene que verse correcto en Georgia/Arial/Consolas**; si carga la webfont, mejora, no cambia |
| **Color** | Los **mismos valores** de §2.2/§17.2 (papel `#F4F1EA`, pozo `#EFEBE2`, tinta `#1A1A18`, muted `#6E695E`, rojo `#B31217`, verde `#4E7A49`), **aplanados**: las reglas translúcidas se sustituyen por su equivalente sólido sobre papel — `--color-border` ⇒ **`#D1CFC8`**, `--color-border-strong` ⇒ **`#AEACA7`**. **No son tokens nuevos**: es el mismo valor sin canal alfa, porque `rgba` en bordes no es fiable en Outlook |
| **Radios y sombras** | **0 y 0**, igual que en la app. Un correo con esquinas redondeadas no es este producto |
| **Modo oscuro del cliente** | `<meta name="color-scheme" content="light">` + `supported-color-schemes: light` y **`bgcolor` explícito en cada `td`**. El sistema no tiene modo oscuro (§2.1) y aquí no se inventa uno. **Ningún significado depende del fondo** |
| **Imágenes** | **Solo el wordmark** (PNG del lockup, ≤ 240px de ancho, con `alt="TCG HUNT"`). **Cero imágenes de carta**, cero iconos-imagen, **cero imágenes de fondo**: el correo tiene que decir todo lo que dice **con las imágenes bloqueadas**, que es el estado por defecto de la mitad de las bandejas |
| **Parte de texto plano** | **OBLIGATORIA** (`multipart/alternative`) y con **el mismo contenido sustantivo**: los tres montos, la condición por línea y el plazo. Un correo de dinero sin parte de texto es un correo que algunos clientes muestran mutilado |
| **Prohibido en los CINCO** | **CLABE** (ni enmascarada), datos de terceros, montos de otras solicitudes, **cualquier cifra interna de la mesa** (posición, sugerencia, tope del operador, cuánto inventario tenemos), teléfono del vendedor, y cualquier enlace que **ejecute** una acción sin sesión. **En el correo 5 se añade `offerCancelReason`**: el motivo de la cancelación es de la bitácora, no del vendedor |

#### 23.4.1 Esqueleto común

```
┌──────────────────────────────────────────────────────────┐  ← papel #F4F1EA, 600px
│  TCG HUNT                                                │  wordmark, 24px alto
│  ──────────────────────────────────────────────────────  │  regla #AEACA7 1px
│  EYEBROW EN VERSALITAS · FOLIO BL-000123                 │  mono 10px, tracking .18em, muted
│                                                          │
│  Titular en serif                                        │  Georgia 26px/1.15, tinta, peso 400
│                                                          │
│  Cuerpo en sans, 15px/1.55, tinta.                       │
│  …                                                       │
│  ──────────────────────────────────────────────────────  │  regla #D1CFC8
│  BLOQUES (condición · líneas · montos · plazo)           │
│  ──────────────────────────────────────────────────────  │
│  [ CTA ]                                                 │  botón tinta, texto papel, radio 0, 44px alto
│  https://… (URL en texto, mono 12px muted)               │  para clientes que no pintan botones
│  ──────────────────────────────────────────────────────  │
│  TCG HUNT · tcghunt.mx · Este correo se envió a nombre…  │  mono 11px muted, UNA línea (§20.10)
└──────────────────────────────────────────────────────────┘
```

- **Un solo CTA por correo.** Si hace falta un segundo destino, va como **enlace de texto** en el cuerpo.
- **Jerarquía tipográfica idéntica a la app**: serif para el titular, sans para prosa, **mono para toda
  cifra, folio, fecha, versalita y etiqueta**. `tabular-nums` en toda columna de dinero.
- **Folio siempre visible** en el eyebrow: es la llave con la que el vendedor va a escribir a soporte.

#### 23.4.2 CORREO 1 — LA OFERTA (el crítico)

**Orden de bloques, y el orden es la decisión.** La condición va **antes** de los montos y **dentro** de
cada línea; los montos van **antes** del CTA; el plazo va **pegado** al CTA.

```
OFERTA DE COMPRA · BL-000123

Te compramos 2 de tus 3 cartas                        ← serif 26px

Esta oferta es condicional y así funciona:            ← sans 15px tinta
compramos cada carta al precio de abajo SIEMPRE
QUE LLEGUE EN NEAR MINT.
──────────────────────────────────────────────────────
COMPRAMOS (2)                                         ← mono 10px versalitas muted

 Charizard VMAX                                       ← sans 15px tinta 500
 SWSH03 · 020/189 · RAW · NM · HOLOFOIL               ← mono 11px muted
 siempre que llegue en Near Mint        MX$ 840.00    ← ⚠ condición y monto EN LA MISMA LÍNEA
 ····································· regla punteada #D1CFC8 ·····
 Pikachu VMAX
 SWSH04 · 044/185 · RAW · NM · NORMAL
 siempre que llegue en Near Mint        MX$ 180.00
──────────────────────────────────────────────────────
NO COMPRAMOS (1)                                      ← mono 10px versalitas muted

 Snorlax V                                            ← sans 15px, tinta muted
 SWSH02 · 141/192 · RAW · NM · NORMAL   No entra en esta oferta
──────────────────────────────────────────────────────
QUÉ PASA SI UNA CARTA NO LLEGA EN NEAR MINT           ← bloque sobre POZO #EFEBE2, regla arriba y abajo
 No se compra, no se paga y te la devolvemos: tienes
 7 días para gestionar la devolución, a tu costo, y a
 los 30 días se considera abandonada.
 Rechazar una carta NO cancela la compra de las demás
 y NO cambia el precio de ninguna: las que sí lleguen
 en Near Mint se pagan al precio de esta oferta.
──────────────────────────────────────────────────────
 Valor de las 2 cartas                  MX$ 1,020.00  ← mono, tabular-nums, alineadas a la derecha
 Envío que ponemos nosotros           − MX$   180.00
 ─────────────────────────────────────────────────    ← regla de TINTA 1px (la única del correo)
 SE TE DEPOSITAN                        MX$   840.00  ← mono 22px peso 500, tinta

 Nosotros ponemos la guía de envío. Su costo,          ← sans 15px TINTA (no muted)
 MX$ 180.00, es una tarifa fija y SIEMPRE se            ⚠ v2.3.1: la prosa nombra
 descuenta de lo que te pagamos: tú no pagas            TAMBIÉN el envío, no solo
 nada de tu bolsillo. La cifra que se te                el neto (ver decisión 8)
 deposita es MX$ 840.00.
──────────────────────────────────────────────────────
 Tienes hasta el miércoles 3 de septiembre de 2026,   ← sans 15px; la fecha en mono 500
 6:00 p. m. (2 días hábiles). Si no respondes antes
 de esa hora, la oferta se cancela sola.

        [  Ver y responder la oferta  ]               ← botón tinta / texto papel

 Entrarás con tu cuenta: esta oferta no se acepta      ← sans 13px muted
 desde un enlace del correo.
──────────────────────────────────────────────────────
 Al aceptar te mandamos la guía; el paquete sale
 desde: Av. Central 123, Col. Centro, 06000 CDMX.
 Si te mudaste, corrígela desde tu cuenta antes de
 aceptar.
 Solo compramos lo que está en esta oferta, a estos
 precios. El pago se hace DESPUÉS de recibir y
 verificar tus cartas.
```

**Las OCHO decisiones que sostienen este correo** *(eran siete; la 8 entra en v2.3.1 con D43)*:

1. **La condición está EN LA LÍNEA, no en una leyenda.** `terms.perLineConditionLabel` se pinta en cada
   línea comprada, en **tinta** (no muted), **en el mismo renglón que el monto**, alineada a la izquierda
   contra el monto a la derecha. Es imposible leer el precio sin barrer la condición.
   *Se rechaza* el asterisco por línea con nota al final: es letra chica.
   *Se asume el coste* de repetirla N veces (ceguera por repetición, el mismo riesgo que §22.12.2), y se
   mitiga como allí: **frase cortísima** (≤ 34 caracteres en ES, ≤ 30 en EN) y **un solo bloque destacado**
   con la consecuencia, que es donde vive el detalle. Repetir una frase corta pegada al dinero cuesta poco;
   **omitirla en la línea que sí se lee cuesta el trato**.
2. **El bloque de consecuencia va sobre POZO** (`#EFEBE2`) con regla arriba y abajo. Es el **único** bloque
   con tono de fondo del correo: el sistema no usa rellenos para estados, pero sí escalones de superficie
   para jerarquía (§4.3), y esta es la información que el vendedor tiene que poder encontrar de un vistazo
   cuando dentro de dos semanas le rechacemos una carta.
3. **«NO COMPRAMOS» se lista, con nombre y sin monto.** El criterio 118 exige decir qué **no** compramos.
   **Prohibido `MX$ 0.00`** en esas líneas: cero es un precio y aquí no hay precio. Y **prohibido explicar
   por qué** no se compró (es deliberación interna).
4. **Los tres montos, con el neto tipográficamente dominante y la resta visible.** La única **regla de
   tinta** del correo va encima del neto. El signo `−` es texto. El neto es la cifra más grande del correo
   **y la única en 22px**: el bruto y el envío comparten cuerpo (15px mono) para que ninguno compita.
5. **La regla del descuento se escribe, no solo se resta** (D31), en **tinta y al lado de los montos**, y
   **repite en prosa el envío y el neto** («Su costo, MX$ 180.00… La cifra que se te deposita es
   MX$ 840.00»): quien lee en diagonal la tabla y quien lee la prosa se llevan **los mismos números**.
   *(Ampliado en v2.3.1 — antes la prosa solo repetía el neto; ver la decisión 8.)*
6. **Plazo con fecha, hora, día de la semana y «días hábiles» entre paréntesis.** Nunca «en 2 días». La
   fecha llega **ya resuelta** del servidor (R4). Se dice **qué pasa si no responde** — que la oferta se
   cancela sola — porque el silencio también es una decisión y debe estar informada.
7. **El CTA lleva al portal y lo dice.** «Entrarás con tu cuenta: esta oferta no se acepta desde un enlace
   del correo» convierte una restricción de seguridad en una **señal de seriedad**. No existe enlace
   tokenizado de aceptación.
8. **⚠ NUEVA (v2.3.1, D43) — este correo es la PRIMERA vez que el vendedor ve el monto del envío.** Ya no
   confirma nada que haya visto en el carrito (§23.3): **introduce un número nuevo en el momento en que
   decide**. La consecuencia de diseño es una sola y es de **redundancia de canal**: **la cifra del envío se
   dice DOS VECES —en la tabla y en la prosa—**, igual que el neto. Antes bastaba con que la prosa repitiera
   el neto, porque el envío era un recordatorio; **un número que se estrena no puede vivir en una sola
   celda**, que es justo la celda que se salta quien lee en diagonal. Se añade `es una tarifa fija`: es un
   hecho de `PROJECT.md` (§P, D31) y **quita la sospecha** de un cargo variable calculado a nuestro gusto —
   sin pedir disculpas y sin vender el descuento. *(Redacción sujeta a ratificación de PO, §23.13.6.)*

**Lo que se revisó con esa lente y se decidió NO cambiar** *(v2.3.1 — se escribe para que nadie lo
«mejore» después)*:

| Se consideró | Decisión | Por qué |
|---|---|---|
| **Subir los montos por encima de la condición**, ya que el envío es información nueva | **NO** | R2 manda: la condición se lee **antes** del dinero y **dentro** de cada línea. Un correo que abre con la resta convierte el trato en una factura |
| **Darle más peso tipográfico a la línea del envío** para que el número nuevo se note | **NO** | Si el envío compite con el neto, el vendedor se va con **la cifra equivocada en la cabeza**. La resta ya tiene dos canales visuales: la **regla de tinta** y el signo `−`. Al envío se le da el segundo canal **en la prosa**, que no cuesta jerarquía |
| **Poner el envío en el asunto o en el preheader** «ya que es nuevo» | **NO — lo prohíbe R1** | El asunto sigue llevando **solo el neto**, y con D43 esa regla vale más que antes: **la primera cifra que este vendedor ve en su vida sobre esta venta es la que efectivamente va a recibir**, rotulada «se te depositan» |
| **Explicar por qué cobramos envío**, o disculparse por el descuento | **NO** | El correo **informa un hecho del trato**; justificarlo lo vuelve negociable y sugiere que nos parece caro |
| **Un bloque «esto no te lo habíamos dicho»** | **NO** | Nombrar el hueco lo agranda. La frase del cotizador ya prometió que el monto exacto venía aquí; **cumplirla en silencio es la forma correcta de cumplirla** |

**Prohibiciones específicas del correo 1:**
`MX$ 0.00` en cualquier línea · el bruto en el asunto o en el preheader (**R1**) · porcentajes · una
condición en pie de página en vez de por línea · botones de «aceptar» / «rechazar» **dentro del correo** ·
cualquier cifra de la mesa de decisión · prometer la guía como si ya existiera («tu guía está lista»: no se
compra al ofertar, D21) · **⚠ (v2.3.1) cualquier fórmula que PRESUPONGA conocimiento previo del envío** —
«como ya sabías», «como te habíamos dicho», «recuerda que», «el descuento habitual», «te confirmamos el
envío de siempre»—: con D43 **es falso**, y un correo de dinero que le dice al vendedor que ya sabía algo
que nunca vio **le enseña a desconfiar de todo lo demás que ese correo afirma**.

#### 23.4.3 CORREO 2 — EL RECORDATORIO (uno por plazo, una sola vez)

**Dos variantes de la misma plantilla**, porque son el mismo hecho (*«te queda un día»*) con acciones
distintas. **No** se convierten en dos correos: el esqueleto, el tono y el bloque congelado son idénticos.

| Variante | Cuándo | Qué pide | Qué muestra además |
|---|---|---|---|
| **2a — aceptar** | 1 día hábil antes de `offerAcceptDeadlineAt` | responder la oferta | el **bloque congelado** (abajo) + CTA al portal |
| **2b — enviar** | 1 día hábil antes de `shipDeadlineAt` | que el paquete salga | **paquetería + número de guía** en mono, + CTA «Ya lo mandé» al portal |

**El bloque congelado — tres renglones y nada más:**

```
TU OFERTA · BL-000123
 2 cartas, siempre que lleguen en Near Mint     ← ⚠ R2: el recordatorio NO se limpia de la condición
 SE TE DEPOSITAN                  MX$ 840.00
 Vence el miércoles 3 de septiembre, 6:00 p. m.
```

- **⚠ R2 aplicada aquí es la regla que más fácil se rompe.** La tentación de un recordatorio es ser
  «ligero» y quedarse con la cifra. Un correo que repite **MX$ 840.00** sin decir «siempre que lleguen en
  Near Mint» **degrada la condición a letra chica por omisión** y es exactamente lo que D30 vino a impedir.
  Va en **una línea corta**, junto al conteo de cartas.
- **No se vuelve a listar el desglose.** Un recordatorio que repite la tabla completa se lee como **una
  oferta nueva** y arruina la propiedad más valiosa del ciclo: que hay **una** oferta y **no se edita**.
  Enlace: «Ver el desglose completo» → portal.
- **Mismos números, congelados.** Si el recordatorio muestra un monto o una fecha distintos de los del
  correo 1, es un **defecto bloqueante**, no una discrepancia menor.
- **⚠ Revisado con la lente de D43 (v2.3.1) y NO cambia.** El bloque congelado sigue llevando **solo el
  neto**, sin la resta. Es correcto por partida doble: el neto es **el único monto vinculante** (R1) y es
  **el único que el vendedor necesita para decidir** si acepta; y repetir la resta en un recordatorio lo
  convertiría en una **oferta nueva** (la propiedad que este ciclo más protege: hay **una** oferta y **no se
  edita**). El envío ya se estrenó en el correo 1 y se puede releer, completo, en el portal — al que este
  correo enlaza con «Ver el desglose completo». **La divulgación es del correo 1 + el portal; el
  recordatorio no la repite ni la sustituye.**
- **Una sola vez por plazo** (el barrido corre varias veces). Es regla de backend; la nota se deja aquí
  porque un segundo recordatorio idéntico **destruye la credibilidad del primero**.
- **2b lleva el número de guía en mono seleccionable**, y el texto dice qué hacer si **ya** lo mandó:
  *«Si ya lo depositaste, avísanos desde tu cuenta y detenemos el reloj.»* — es la salida de §P.13 y evita
  que alguien pierda su venta por una demora nuestra.
- **No hay recordatorio del plazo de caducidad** (los 7 días hábiles nuestros). Correcto por diseño:
  avisarle al vendedor de un plazo que depende de nuestra carga de trabajo no le sirve de nada.

#### 23.4.4 CORREO 3 — EXPIRACIÓN (⚠ DOS productores, y los dos son terminales)

> **⚠ v2.3.3 — esta subsección tenía TRES variantes y ahora tiene DOS.** La tercera (~~3c~~, «la cancelamos
> nosotros») **salió de aquí** y es el **correo 5** (§23.4.4-bis). El criterio de corte es el estado que
> deja: **3a y 3b cierran la solicitud; la cancelación la devuelve viva a la fila.** ~~3c~~ **no vuelve a
> nombrarse en §23**; si aparece en algún sitio, es una referencia sin actualizar.

Dos productores distintos con el **mismo hecho de fondo** (*«se te venció un plazo y la solicitud queda
cerrada»*) y dos acciones distintas ⇒ **una plantilla, dos variantes**. Es exactamente el reparto que pide
**R3**: se fusiona lo que comparte hecho, **no** lo que comparte estado técnico.

| Variante | Productor | Estado que deja | Hecho que afirma | ⚠ |
|---|---|---|---|---|
| **3a — no respondiste** | barrido regla 1 | `rechazada` (**terminal**) | *«el plazo para responder terminó»* | — |
| **3b — no salió el paquete** | barrido regla 2 | `expirada` + `not_shipped` (**terminal**) | *«aceptaste y el paquete no salió en el plazo»* | — |

**Esqueleto compartido:** eyebrow + titular serif + **dos párrafos** (qué pasó · qué sigue) + **bloque de
estado** (folio, fecha del cierre, versalita del desenlace) + CTA. **Sin montos** ni siquiera en 3b, donde
el monto ya no se va a pagar y mencionarlo solo duele: **ninguna de las dos variantes lleva montos.**

**Copys (ES, con EN en §23.12):**

- **3a** — Titular: «Tu oferta venció». Cuerpo: *«El plazo para responder terminó el {fecha} y la oferta ya
  no es válida. No se compró ninguna carta y no tienes nada pendiente.»* + *«Si sigues queriendo vender,
  puedes cotizar de nuevo cuando quieras.»* CTA: **Cotizar de nuevo**.
- **3b** — Titular: «Se venció el plazo para enviar tu paquete». Cuerpo: *«Aceptaste la oferta el {fecha} y
  el paquete no salió antes del {fecha límite}, así que cerramos la solicitud. Si la guía que te mandamos
  sigue sin usar, ya no es válida.»* + la misma invitación. **Hechos y fechas, cero adjetivos**: ni
  «lamentablemente», ni «no cumpliste», ni «desafortunadamente».

#### 23.4.4-bis CORREO 5 — CANCELAMOS LA OFERTA (⚠ el único desenlace que NO cierra nada)

> **Era la «variante 3c» hasta v2.3.3.** El **texto no cambia una letra** —está ratificado y es correcto—;
> cambian **el número, la subsección y el prefijo de su clave**. Se separa por dictamen del arquitecto
> (`ARCHITECTURE §4.39(n)`, v1.51.4), y la razón vale la pena escribirla porque es una regla, no un caso:
> **lo que agrupa correos es el HECHO y su desenlace, nunca el productor ni el `status`.**

| | Correo 5 |
|---|---|
| **Productor** | **uno solo**: `POST /admin/buylist/:id/offer/cancel` sobre una oferta **`sent`** |
| **Estado que deja** | **`cotizada` — NO es terminal**: vuelve a la fila con **7 días hábiles completos** (D38) |
| **Hecho que afirma** | *«cancelamos la oferta; no es nada de tu parte, y tu solicitud sigue viva»* |
| **Quién falló** | **nadie**, y menos el vendedor: es **un acto nuestro** (típicamente, corregir un número mal puesto) |
| **⚠** | Un texto de «se venció tu plazo» aquí es **FALSO** y **culpa al vendedor de un acto NUESTRO** |

**Por qué NO podía quedarse dentro del correo 3** (tres razones, y la tercera es la operativa):

1. **Contradice el hecho.** El correo 3 afirma *«esto se acabó»*; el 5 afirma *«esto sigue, y te
   escribiremos otra vez»*. Son **instrucciones opuestas** para el vendedor: uno le dice que vuelva a
   cotizar, el otro que **no** lo haga.
2. **Contradice el estado.** 3a/3b sellan `closedAt`; el 5 deja la solicitud abierta. Una plantilla que
   comparte «bloque de estado» entre desenlaces terminales y no terminales **pinta un cierre que no
   ocurrió** — y §23.2d ya trunca el stepper en un cierre para los terminales.
3. **Y por eso el CTA es otro.** «Cotizar de nuevo» sobre una solicitud **viva** manda al vendedor a
   **duplicarla**. El 5 dice **«Ver mi solicitud»**. Un CTA equivocado no es un matiz de tono: **crea
   trabajo basura en la cola de M5**.

**Copy (ES, con EN en §23.12) — sin cambios respecto de la ~~3c~~ ratificada:**

- Titular: «Cancelamos la oferta que te mandamos». Cuerpo: *«La oferta del {fecha} ya no es válida:
  **la cancelamos nosotros**. No es nada de tu parte.»* + *«Tu solicitud sigue viva y volvemos a revisarla;
  te escribiremos con una oferta nueva o con nuestra respuesta.»* **CTA: Ver mi solicitud** (no «cotizar de
  nuevo»: la solicitud **no** está cerrada).

**Prohibido en el correo 5:** la palabra **«venció»**, **cualquier plazo del vendedor**, **cualquier monto**
(los de la oferta cancelada se limpian de la fila y **no se resucitan para el correo**), el **motivo interno**
(`offerCancelReason` es de la bitácora) y el **CTA de volver a cotizar**.

> **⚠ Y el correo 5 NO lo manda el barrido.** Cuando el barrido anula una oferta al caducar la solicitud,
> el hecho real es *«no procederemos»* ⇒ sale el **correo 4**. **Un productor por correo, y el 5 tiene
> exactamente uno** (`ARCHITECTURE §4.39(n)`). Un `catch` que mande el 5 desde el barrido le diría al
> vendedor que su solicitud sigue viva **el día que la cerramos**.

> **Deuda de pantalla que este correo sigue teniendo (no la resuelve el renumerado):** tras la cancelación
> el portal se queda **mudo** —`offer` vuelve a `null`— y el vendedor no ve rastro de la oferta que sí
> recibió. **La pantalla contradice al correo.** La petición al arquitecto sigue abierta en **§23.13.3**.

#### 23.4.5 CORREO 4 — «NO PROCEDEREMOS» (nadie ofertó, o el operador declinó)

El más corto y el más fácil de arruinar. Su trabajo es **cerrar sin acusar y sin explicar**.

```
TU SOLICITUD DE VENTA · BL-000123

No vamos a proceder con la oferta                     ← serif 26px

Sobre tu solicitud BL-000123: no vamos a proceder
con la oferta.

No hay nada pendiente de tu parte: no mandes ninguna
carta, no se generó ninguna guía y no nos debes nada.

Los precios se mueven todo el tiempo. Puedes volver
a cotizar cuando quieras.

        [  Cotizar de nuevo  ]
```

**Las seis prohibiciones, y cada una tiene una razón:**

| Prohibido | Por qué |
|---|---|
| **Decir POR QUÉ no ofertamos** (carga de trabajo, precio, inventario, «no nos interesa esta carta») | *No procederemos* es la información completa que le corresponde. Explicar abre una negociación que no existe y filtra criterio interno |
| **Cualquier referencia al TIEMPO transcurrido** («después de revisar tu solicitud», «tras 7 días», «perdón por la demora») | Delata **por qué camino** se cerró —barrido o «declinar ahora»— y §4.39(n) lo prohíbe: *un correo por hecho, no por camino*. Además «revisamos y decidimos» roza la prohibición de explicar |
| **Cualquier MONTO** (ni el total cotizado) | Nombrar MX$1,200 junto a «no procederemos» se lee como *«te íbamos a pagar esto y no lo hicimos»*. La cotización **nunca fue vinculante** |
| **Fórmulas vagas**: «no pudimos procesar tu solicitud», «seguimos revisando», «tu solicitud no fue seleccionada» | §P.3.1 las descarta por nombre. El cliente **tiene que saber a qué atenerse**; un eufemismo lo deja esperando |
| **Culpar o insinuar incumplimiento** | Es el motivo entero por el que este correo existe separado del 3 |
| **Disculparse de un modo que invente una causa** | Una cortesía neutra es aceptable; «perdón por la demora» no lo es (ver fila 2) |

**Y la propiedad que lo hace verificable:** el correo 4 **no menciona ningún plazo**. Si en el texto aparece
una fecha límite, un «7 días» o un «venció», el correo está mal.

#### 23.4.6 (c) vs (d): la tabla que impide fusionarlos

| | **Correo 3b — expiración** | **Correo 4 — no procederemos** |
|---|---|---|
| Estado técnico | `expirada` | **el mismo**: `expirada` |
| Motivo | `not_shipped` | `no_offer` |
| **Quién falló** | **el vendedor** (aceptó y no envió) | **nadie** — nosotros no ofertamos |
| ¿Hubo oferta? | **sí** | **no**, y decir que sí sería mentir |
| Menciona plazos | **sí** (el suyo) | **NUNCA** |
| Menciona montos | no | **NUNCA** |
| Tono | factual, sin adjetivos | factual, cerrado, con puerta abierta |
| CTA | Cotizar de nuevo | Cotizar de nuevo |
| Versalita en el portal | `SIN ENVÍO` (danger) | `NO PROCEDIÓ` (neutral) |

> **⚠ La selección de plantilla es por MOTIVO, no por estado** (`not_shipped` ⇒ 3b; `no_offer` ⇒ 4).
> Un `switch (status)` que caiga en el correo 3 por defecto **le imputa un incumplimiento a alguien a quien
> nunca le ofertamos**. Es el riesgo que trae compartir `status` y por eso se escribe aquí también.

#### 23.4.7 Asuntos y preheaders

**Regla R1 aplicada:** el **único monto** que puede aparecer en un asunto o preheader es el **neto**.

| # | Asunto ES | Asunto EN |
|---|---|---|
| 1 | `Tu oferta: se te depositan MX$ 840.00 · vence el 3 sep, 6:00 p. m.` | `Your offer: MX$ 840.00 deposited to you · expires Sep 3, 6:00 PM` |
| 2a | `Te queda 1 día hábil para responder tu oferta` | `1 business day left to respond to your offer` |
| 2b | `Te queda 1 día hábil para enviar tu paquete` | `1 business day left to ship your package` |
| 3a | `Tu oferta venció` | `Your offer expired` |
| 3b | `Se venció el plazo para enviar tu paquete` | `The shipping deadline passed` |
| 4 | `No procederemos con tu solicitud de venta` | `We won't be proceeding with your sell request` |
| **5** *(era ~~3c~~)* | `Cancelamos la oferta que te mandamos` | `We cancelled the offer we sent you` |

> **⚠ El asunto del 5 es el único de los cierres que NO puede empezar por «Tu oferta venció…».** Se lee
> entero antes de abrir nada: **«Cancelamos»** pone el sujeto de la acción **en nosotros** en la primera
> palabra, en los dos idiomas. Es la misma doctrina de §23.1d —*en un desenlace ambiguo el sistema no acusa
> al cliente*— aplicada a la bandeja de entrada, que es donde más gente se queda.

**Preheader del correo 1** (texto oculto, primera línea que ve la bandeja) — **⚠ corregido en v2.3.1**:
ES *«Compramos 2 de tus 3 cartas, siempre que lleguen en Near Mint. La guía la ponemos nosotros y se
descuenta.»* · EN *"We'll buy 2 of your 3 cards, provided they arrive Near Mint. We provide the label and
deduct it."*
**El preheader del correo 1 lleva la condición** — es la primera superficie del trato y no puede omitirla.

> **⚠ Por qué se corrigió** (v2.3.1, D43): ~~«El envío lo ponemos nosotros» / «Shipping is on us»~~ decía
> **la mitad buena** del hecho y omitía la resta. Cuando el vendedor ya había visto la aritmética en el
> carrito, esa media frase era taquigrafía inofensiva; **ahora es la primera cosa que lee sobre el envío en
> todo el ciclo**, y «lo ponemos nosotros» a secas se lee como **«gratis»**. **Regla derivada, válida en
> todo el sistema: donde aparezca «ponemos la guía», viaja «y se descuenta».** Las dos mitades no se
> separan nunca — ni en un preheader, ni en un asunto, ni en una notificación, ni en un tuit.
> **Única excepción, y es aparente:** el **rótulo de la fila de la tabla de montos** del correo/portal
> (`Envío que ponemos nosotros  − MX$ 180.00`) puede ser corto **porque la resta está a la vista** — signo
> `−`, regla de tinta y neto debajo hacen literalmente lo que la frase diría. La regla protege a la frase
> **suelta**, no al renglón de una aritmética visible.
> El asunto **no cambia**: sigue llevando **solo el neto**, que es la cifra rotulada con lo que de verdad
> recibe (R1).

---

### 23.5 Portal del vendedor: la pantalla tiene que decir **exactamente** lo mismo que el correo

**(a) Regla de espejo.** El correo y la pantalla se pintan del **mismo `SellOfferPublicDTO`** y del mismo
`offer.terms`. **La UI no calcula ninguno de los tres montos, ni el plazo, ni la resta** (R4). Si la pantalla
y el correo dicen números distintos, **se rompe todo el ciclo**, no una pantalla.

**(b) Anatomía** (bajo el `PipelineStepper` vertical, §23.2):
la **condición en un bloque sobre pozo** (mismo texto del correo) → la lista de líneas **compradas** con su
condición por línea → las **no compradas** sin monto → el `AmountBreakdown` de los tres montos con el neto
destacado → el plazo con fecha y hora → **dos acciones**.

- **⚠ v2.3.1 (D43): el portal es el único sitio donde el vendedor puede RELEER la resta.** El correo la
  estrena y el recordatorio no la repite (§23.4.3), así que aquí el `AmountBreakdown` de los **tres** montos
  es **obligatorio** y va acompañado de la **misma frase en prosa del correo**, con el envío y el neto
  nombrados —no una versión abreviada, no solo el neto—. Un portal que muestre únicamente `SE TE DEPOSITAN`
  deja al vendedor **sin ningún lugar donde volver a ver de dónde salió**, salvo un correo que quizá borró.

**(c) Las dos acciones, y su jerarquía deliberada:**

| Acción | Variante | Por qué |
|---|---|---|
| **Aceptar la oferta** | `primary` (tinta, relleno), ancho completo en móvil | Es la acción esperada |
| **Rechazar la oferta** | `secondary` (regla + texto), **nunca `destructive`** | Rechazar es **legítimo**. Pintarlo en rojo lo convierte en un error del usuario y presiona a aceptar. El rojo del sistema es de **atención**, no de castigo |

- **Confirmación al aceptar** (§7.6, es dinero): repite **el neto** y **la condición**, y el botón dice el
  verbo con el monto: **«Aceptar y recibir mi guía»**. Sin cuenta atrás, sin urgencia artificial.

  > **⚠ v2.3.7 — la frase se REENMARCA para que la condición se pueda CITAR en vez de reescribir.**
  > Aquí decía *«…2 cartas por MX$ 840.00, **siempre que lleguen** en Near Mint»* —plural—, pero el
  > servidor manda `offer.perLineCondition` **en singular** («siempre que **llegue** en Near Mint»), porque
  > es **la condición de una línea** (§23.12). El frontend detectó el desajuste y **citó verbatim** en vez
  > de fabricar una segunda redacción. **Esa decisión se ratifica y es la correcta**: *la condición es
  > exactamente lo que el vendedor acepta (D30); tener DOS redacciones de ella —una en el correo y otra en
  > el diálogo— es el defecto que R2 existe para impedir, y una discordancia gramatical es un coste
  > cosmético al lado de eso.*
  > **Pero no hay que pagar ni el coste cosmético:** el problema era **mi marco**, que forzaba el plural.
  > Se cambia el marco para que **el singular del servidor encaje bien**:
  >
  > | | ES | EN |
  > |---|---|---|
  > | ~~Antes~~ | ~~«Aceptas que te compremos 2 cartas por MX$ 840.00, siempre que lleguen en Near Mint»~~ | ~~"…provided they arrive Near Mint"~~ |
  > | **Ahora** | «Aceptas que te compremos {count, plural, one {# carta} other {# cartas}} por {netAmount}. **La condición es la misma para cada carta: {condition}.**» | "You accept that we buy {count, plural, one {# card} other {# cards}} from you for {netAmount}. **The condition is the same for every card: {condition}.**" |
  >
  > Con «cada carta» / "every card" el singular citado **lee correcto con cualquier conteo**, y la cita
  > sigue siendo **una sola fuente**. El mismo marco se usa en el diálogo de rechazar (§23.5g-c), en
  > pasado: *«La condición **era** la misma para cada carta»*.
  > **Regla general que se lleva de aquí:** *cuando un texto del servidor no encaje en el marco de la UI,
  > **se cambia el marco, no se duplica el texto**.*
  *(**Revisado con la lente de D43 y NO cambia:** el diálogo se abre **a 200px del bloque de los tres
  montos**, y R1 autoriza expresamente al **neto** a viajar solo. Meterle la resta convertiría el último
  clic en una re-lectura del trato — y el sitio para leer el trato es la pantalla, no el diálogo que la
  tapa.)*
- **`aria-live="polite"`** al resolver; el resultado sustituye el bloque de acciones por el estado nuevo.
- **NO existen casillas por línea.** El todo-o-nada se demuestra **por lo que no está** (§P.11): la lista es
  de solo lectura, sin `checkbox`, sin «quitar esta carta».
- **`409 OFFER_EXPIRED` / `OFFER_NOT_PENDING`** se pintan como **banner persistente** con el estado real,
  no como toast: el vendedor acaba de intentar comprometer dinero.

**(d) Antes de que exista oferta**, la pantalla **no muestra guía, ni nuestra dirección, ni instrucciones de
envío**, y **no ofrece** ninguna vía para decir «ya lo mandé» (criterio 114). Muestra: sus cartas, **su
propia dirección de origen** (que es suya y tiene que poder verificarla), una frase clara —*«Todavía no
mandes nada. Te escribimos con nuestra oferta.»*— y **la nota de servicio del envío de §23.3d, palabra por
palabra y SIN CIFRAS**.

> **⚠ Corrección v2.3.1 (D43).** Aquí decía «el aviso de descuento de §23.3», que en v2.3 era **el bloque
> con la resta**. Sería un error doble pintarlo: (1) D43 lo prohíbe en toda superficie previa a la oferta, y
> (2) **antes de la oferta no existe tarifa congelada**, así que cualquier cifra que apareciera aquí sería
> **la del dial de hoy**, capaz de no coincidir con la que se le ofertará mañana. La regla es limpia:
> **antes de la oferta, la frase; desde la oferta, los tres montos.** El portal **cambia de idioma sobre el
> dinero exactamente en el mismo instante** en que sale el correo 1 — que es el instante en que el número
> deja de ser un dial y pasa a ser un compromiso.

**(e) La dirección de origen, con su ventana de corrección.** Mientras `guideSentAt === null`, junto a la
dirección va **«Cambiar»** (`PATCH …/pickup-address`, elige otra de su libreta). Cuando ya hay guía, el
enlace **desaparece** y en su lugar: *«Ya imprimimos la guía con esta dirección.»* — sin botón, porque no
hay remedio self-service (§23.13.4).

**(f) Cierre terminal.** Con la solicitud cerrada, la pantalla muestra el mismo mensaje que el correo, no un
resumen genérico:

| Desenlace | Qué se muestra | ⚠ |
|---|---|---|
| `pagada` | los tres montos, la fecha del SPEI y el desglose de aprobadas/rechazadas | — |
| `rechazada` | **⚠ CORREGIDO v2.3.7:** ~~«La oferta venció el {fecha}»~~ ⇒ **«Esta oferta ya no está vigente.»** + CTA cotizar de nuevo | **`rechazada` tiene DOS causas y el DTO no las distingue**: el vendedor **pulsó rechazar**, o el barrido cerró por silencio. Decirle «venció» a quien **decidió** le niega su propio acto — es el mismo error que separó el correo 5 del 3. Ver §23.5g(e) |
| `expirada`+`not_shipped` | «Se venció el plazo para enviar» + CTA cotizar de nuevo | — |
| `expirada`+`no_offer` | «No procedimos con la oferta» + CTA cotizar de nuevo | **⚠ Se OCULTA el total cotizado y toda cifra.** Una lista de cartas con «MX$ 1,200» al lado de «no procedimos» se lee como una deuda. Se listan las cartas **sin montos** |
| `abandonada` | el estado y a quién escribir | — |

---

### 23.5g Los estados del portal que §23 NO cubría (v2.3.7)

> **Contexto.** El portal era un **404** hasta este pase — la pantalla a la que apunta el correo de oferta
> no existía. §23.5 especificó **la oferta viva y los cierres**, pero **no** el rechazo confirmado, la
> oferta incompleta, el 404 ni la puerta de sesión. El frontend los construyó y **declaró** las claves que
> tuvo que nombrar. **Aquí se ratifican, con tres correcciones.**

**(a) ✅ Se ratifica el espacio de claves `buylist.offer.*` y su EN.** El inventario completo está en
§23.12. Revisado contra R1, R2, R4 y D43: **ningún asunto ni titular lleva el bruto**, la condición viaja
con todo monto, **la UI no calcula nada** y no hay ninguna cifra de envío fuera de la oferta. `grossLabel`,
`shippingLabel` y `netLabel` coinciden con los del correo; `shippingLabel` («Envío que ponemos nosotros»)
es la **excepción autorizada** de §23.4.7 — renglón corto **porque la resta está a la vista**.

**(b) ⚠ CORRECCIÓN 1 — `offer.deadline` dice «se cancela sola», y «cancelar» ya significa otra cosa.**
Tras v2.3.3, **«cancelar» es el verbo del correo 5: lo que hacemos NOSOTROS**. Una oferta que muere por
silencio **vence** (correo 3a, titular «Tu oferta venció»). Que la misma palabra nombre *«nosotros la
retiramos»* y *«se te acabó el plazo»* reintroduce, en la pantalla, la fusión que acabamos de deshacer en
los correos.

| | ES | EN |
|---|---|---|
| ~~Antes~~ | ~~«…Si no respondes antes de esa hora, la oferta **se cancela sola**.»~~ | ~~"…the offer **cancels itself**."~~ |
| **Ahora** | «Tienes hasta el {deadline} (hora del centro de México). Si no respondes antes de esa hora, **la oferta vence** y ya no podremos comprarte a este precio.» | "You have until {deadline} (Mexico City time). If you don't respond before then, **the offer expires** and we won't be able to buy at this price anymore." |

**(c) ⚠ CORRECCIÓN 2 — el diálogo de RECHAZAR necesita el neto y la condición, y R2 no admite excepción.**
El frontend escribió un cuerpo sin montos. Es defendible —evita presionar— pero **choca con R2 por el lado
contrario**: en cuanto el diálogo nombre el neto, la condición es obligatoria; y **el neto tiene que estar**,
porque este es el último instante en que el vendedor puede saber **qué está soltando**. La línea entre
*informar* y *presionar* no está en decir el número: **está en el tono**.

| Clave | ES | EN |
|---|---|---|
| `confirmRejectTitle` | Confirma que rechazas | Confirm that you decline |
| **`confirmRejectBody`** | **Vas a rechazar la oferta de {netAmount} por {count, plural, one {# carta} other {# cartas}}. La condición era la misma para cada carta: {condition}. Es definitivo: no podemos reactivarla y, si cambias de opinión, tendrías que cotizar de nuevo.** | **You are about to decline the offer of {netAmount} for {count, plural, one {# card} other {# cards}}. The condition was the same for every card: {condition}. This is final: we cannot reactivate it and, if you change your mind, you would have to request a new quote.** |
| `confirmRejectCta` | Rechazar la oferta | Decline the offer |

**Prohibido en este diálogo** —y la lista es el motivo por el que se escribe aquí—: **«¿Estás seguro?»**,
cualquier cuenta atrás, **cualquier reencuadre del beneficio** («estás dejando ir…», «piénsalo»), el botón
de rechazar en `destructive` (§23.5c: rechazar **es legítimo**) y **un segundo CTA de aceptar dentro del
diálogo**. La salida es **«Cancelar»** —volver atrás—, nunca un embudo de aceptación. *Un diálogo de
confirmación que argumenta ya no confirma: negocia.*

**(d) La oferta INCOMPLETA — el único estado donde la pantalla se niega a pintar.** Cuando la oferta llega
sin términos o con líneas sin decisión, **no se pinta ni un monto, ni el plazo, ni las acciones**: solo el
aviso. Es **R2 llevada hasta el final** —si no podemos mostrar la condición completa, no mostramos el
dinero— y por eso **ese texto es lo único que el vendedor ve**. **Se ratifica el copy del frontend**, que
acierta en lo difícil: **no culpa a nadie, dice qué NO vamos a hacer y por qué, y da dos salidas**.

| Clave | ES | EN |
|---|---|---|
| `incompleteTitle` | No podemos mostrarte la oferta completa | We can't show you the full offer |
| `incompleteBody` | Nos falta parte del desglose de esta oferta, así que no la mostramos a medias ni te dejamos aceptarla. Revisa el correo que te mandamos o escríbenos a {email}. | Part of this offer's breakdown is missing, so we won't show it half-way and we won't let you accept it. Check the email we sent you or write to us at {email}. |

- **Mandar al correo es correcto y no es una excusa:** el correo **es el documento vinculante** (§23.4) y
  lleva el desglose completo. Es la única superficie que **sigue siendo verdad** cuando la proyección falla.
- **Prohibido**: pintar el neto «aunque sea», un `AmountBreakdown` a medias, el plazo, el botón de aceptar
  en `disabled` (§15.9: un botón apagado y mudo es peor que ausente) y **cualquier código de error**.
- **⚠ Riesgo que el copy NO puede resolver y que se enruta al arquitecto (§23.5g-f):** si el reloj del
  vendedor sigue corriendo mientras la oferta es inmostrable, **le vence un plazo por un fallo nuestro** —
  justo lo que §P.13 prohíbe. **El texto no promete nada sobre el plazo** (correcto), pero el problema es
  real y es de contrato.

**(e) El 404 neutro y la puerta de sesión — se ratifican, y se atan a la doctrina que ya existe.**
Esto es **§15.7 aplicado al buylist**: *una sola pantalla para todos los fallos*. Token inexistente,
solicitud de otro, solicitud borrada, 401/403/404/410 ⇒ **el mismo texto, el mismo layout**. El frontend
**no ramifica por código de estado**, que es lo correcto: cualquier diferencia visible convierte la pantalla
en un **oráculo** de qué solicitudes existen.

| Clave | ES | EN |
|---|---|---|
| `notFoundTitle` | No encontramos esta solicitud | We couldn't find this request |
| `notFoundBody` | Revisa el enlace del correo, o entra con la cuenta con la que creaste la solicitud. | Check the link in your email, or sign in with the account you used to create the request. |
| `loginTitle` | Entra con tu cuenta para ver tu oferta | Sign in to see your offer |
| `loginBody` | Entrarás con tu cuenta: esta oferta no se acepta desde un enlace del correo. | You will sign in with your account: this offer is not accepted from an email link. |

> **⚠ Precisión que decide si esto es seguro o es un oráculo: la puerta de sesión se resuelve por la SESIÓN,
> nunca por una consulta.** Si `loginTitle` se pintara **después** de comprobar que la solicitud existe, la
> pantalla diría *«existe, identifícate»* frente a *«no existe»* — y eso **es** el oráculo, con otro
> vestido. **Sin sesión ⇒ puerta de sesión, siempre, sin mirar el id.** Con sesión y sin acceso ⇒ el 404
> neutro. **Prohibido** además: repetir el folio en pantalla, nombrar a otra cuenta, y que el texto cambie
> entre «no existe» y «no es tuya».

**(f) La frase neutra de `rechazada` — ratificada, y con el reparto que la hace correcta.**
El DTO no dice **quién** cerró: si el vendedor pulsó rechazar o si el barrido cerró por silencio. §23.5f
decía «La oferta venció el {fecha}» **para las dos**, y a quien **decidió** eso le niega su propio acto.

| Clave | Cuándo | ES | EN |
|---|---|---|---|
| `rejectedNow` | **justo después** de la acción — aquí **sí sabemos** que rechazó, porque acabamos de hacerlo | Rechazaste la oferta. | You declined the offer. |
| `noLongerActive` | **en una visita posterior** — aquí **no sabemos** por qué se cerró | Esta oferta ya no está vigente. | This offer is no longer active. |

- **El reparto es la parte buena de la solución**, y es del frontend: la frase neutra solo se usa donde la
  ignorancia es real. **No se degrada la información que sí tenemos.**
- **No lleva fecha**, y no le hace falta: el **cierre del stepper** ya pinta versalita + fecha (§23.2d).
  Repetirla obligaría a redactar una causa que no conocemos.
- **Es una solución puente, no el destino.** Con el discriminador en el contrato, `rechazada` vuelve a
  hablar claro y **cada causa recupera su frase**. **Petición al arquitecto en §23.13.9.**

**(g) Detalles menores ratificados, para que nadie los «corrija» después:**

| Clave | Veredicto |
|---|---|
| `acceptedNow` («Te mandamos la guía por correo») | **Correcto.** Es **secuencia logística**, no afirmación de coste ⇒ **no** le aplica la regla de §23.14.3, igual que a `buylist.created`. Y además la resta está en pantalla, a un scroll |
| `reject` = «Rechazar» ES / "Decline" EN | **Correcto**, y la asimetría es deliberada: ES ya usa «Declinar» para **la acción del admin** (§23.8) y **ningún usuario ve las dos superficies**. "Decline" es más suave que "Reject", que sonaría a juzgar sus cartas |
| `preOfferTitle` + `preOfferBody` | **Ajuste menor:** hoy repiten «Todavía no mandes nada» en los dos. **Título:** «Todavía no mandes nada» · **Cuerpo:** «Te escribimos con nuestra oferta.» Leídos juntos dan la frase de §23.5d **exacta**, sin eco |
| `cancelledBanner` | **Ratificado** — es §23.13.3 implementada, y el texto coincide con el que pedí. **Sin monto de la oferta cancelada**, como se pidió |
| `closedNoOffer` | **Ratificado**, con el recordatorio de §23.5f: en ese desenlace **se ocultan el total cotizado y toda cifra**. Las cartas se listan **sin montos** |

---

### 23.5h ⚠ La prosa duplicada — decisión: SE PERMITE como puente, con tres condiciones

> **Es la pregunta correcta y la respuesta no es obvia**, así que va con su razonamiento. El frontend
> **copió `offer.ruleParagraph`** —la prosa del descuento con `{shippingAmount}` y `{netAmount}`— al
> catálogo i18n, porque **solo existía dentro de la plantilla del correo** y §23.5b **obliga** al portal a
> llevarla. Lo declaró como *«la única copia de copy que este pase se vio obligado a crear»*.

**Veredicto: NO es bloqueante. Se permite, y por qué la alternativa era peor.**

Las opciones reales eran tres, y dos son inaceptables:

| Opción | Consecuencia |
|---|---|
| **Portal sin la prosa**, solo el `AmountBreakdown` | **Viola §23.5b explícitamente.** Bajo D43 el portal es **el único sitio donde el vendedor puede releer la resta**: el correo la estrena y el recordatorio no la repite. Sin prosa, quien borró el correo **se queda sin ningún lugar donde ver de dónde salió el neto** |
| **Bloquear el portal** hasta que el servidor mande la prosa | El portal era **un 404** al que apunta el correo de oferta. Bloquear = **seguir mandando ofertas vinculantes a una página que no existe** |
| **Duplicar el string** *(elegida)* | Riesgo de **deriva** entre dos catálogos. Es un coste de **mantenimiento**, no una regresión para el vendedor |

**La distinción que decide:** *omitir la prosa sería una **regresión de producto**; duplicarla es una
**deuda de mantenimiento**.* No son la misma clase de problema, y este documento no cambia lo primero por
lo segundo. **Y la duplicación es visible y está declarada** — que es exactamente lo contrario del patrón
que este ciclo lleva persiguiendo, donde el daño venía de textos **que nadie sabía que existían**.

**Las tres condiciones, y son obligatorias mientras dure el puente:**

1. **La plantilla del correo es la FUENTE; el i18n es el ESPEJO.** Si divergen, **manda el correo** — es el
   documento vinculante (§23.4). Toda edición de esa prosa **se hace primero en la plantilla** y después se
   copia. **Prohibido «mejorar» la copia del portal por su cuenta**: dos redacciones de la misma regla de
   dinero es el defecto, no la solución.
2. **Verbatim, carácter por carácter, en ES y EN**, incluidos los dos placeholders. La comprobación (f) de
   §23.13.8 —*«correo vs portal coinciden carácter por carácter»*— **se amplía a la prosa del descuento**,
   que hasta hoy solo cubría montos, plazo y condición. **Es el único guardarraíl real que hay hoy**, y se
   dice sin adornos: *el guardián de esta copia es una revisión, no un test.*
3. **Cuando el servidor mande la prosa, la clave i18n SE BORRA — no se deja de reserva.** Un *fallback*
   superviviente es exactamente cómo un texto viejo vuelve a producción (la lección de `expiry.*` y de las
   tres claves retiradas de §23.12). **Cero coexistencia.**

**Y el límite del permiso, para que no se generalice:** esto vale **para esta prosa y por este motivo** —
una regla de dinero que el diseño **obliga** a mostrar en dos medios y que hoy **solo un medio produce**.
**No autoriza a duplicar copy en general**, y menos a duplicar **la condición** o **la consecuencia**: esas
el portal las pinta **verbatim del servidor**, que es lo que el frontend ya hizo bien y **es la razón por
la que el vendedor lee en pantalla el mismo texto que aceptó en el correo**.

---

### 23.6 La mesa de decisión (admin, M5) — cinco cifras leídas en dos tiempos

> **El problema de diseño, dicho sin rodeos:** por cada línea hay que enseñar **cinco números** —en
> inventario, verificando, en tránsito, comprometido y el objetivo— y una sugerencia, sobre una solicitud
> que puede tener 40 líneas. Volcados sin jerarquía son **un tablero de aeropuerto**: 200 cifras que nadie
> lee. Y hay una restricción que no se puede negociar: **«en camino» y «comprometido» no se suman jamás**
> (R6), porque tienen confianza distinta y esa distinción **es** el valor de la pantalla.

**(a) La decisión: una cifra que decide, cuatro que la explican.**

```
POSICIÓN 9/10  TOPE          ← primer tiempo: UNA cifra, mono 15px, y su umbral como denominador
EN INVENTARIO 5  VERIFICANDO 1 │ EN CAMINO 1  COMPROMETIDO 2
                                 ↑ segundo tiempo: los cuatro sumandos, en orden de confianza
```

- **Primer tiempo — `POSICIÓN 9/10`.** Es `position.total` sobre el **objetivo** (la quinta cifra:
  `bountyTargetQty` o el tope general), con la versalita de **qué regla manda** (`BOUNTY` / `TOPE`). El
  operador lee **una** fracción y sabe dónde está. El quebrado es honesto también al pasarse: con bounty,
  `3/2` dice «ya te pasaste» sin necesidad de explicarlo.
- **Se llama POSICIÓN, no «inventario».** Contesta *«¿de cuántas copias ya soy responsable?»*, que incluye
  dinero comprometido. Llamarla «tengo» sería mentir.
- **Segundo tiempo — la tira de cuatro.** Siempre los **cuatro**, siempre en el **mismo orden**, siempre en
  las **mismas posiciones** de la retícula.

**(b) Cómo se impide que el ojo sume «en camino» + «comprometido» (R6):**

| Mecanismo | Cómo |
|---|---|
| **Una regla vertical de 1px** (`--color-border-strong`) entre `VERIFICANDO` y `EN CAMINO` | Es la frontera **está en la casa / todavía no está**. Es el único separador del sistema (§4.3) y aquí carga significado |
| **Encabezados de grupo reales** | En la cabecera de la tabla, `<th colspan="2" scope="colgroup">`: **`EN NUESTRAS MANOS`** (inventario + verificando) y **`TODAVÍA NO`** (en camino + comprometido). El lector de pantalla anuncia el grupo antes de cada cifra |
| **Gradiente de confianza por PESO, no por contraste** | `EN INVENTARIO` y `VERIFICANDO` en tinta **500**; `EN CAMINO` y `COMPROMETIDO` en tinta **400**. **Las cuatro cifras van en `--color-text`**: la confianza **no se codifica bajando el contraste** — un número que decide una compra es información esencial y §10 prohíbe el muted para eso |
| **Prohibiciones explícitas** | **No** existe subtotal, `+`, paréntesis «(3 por llegar)», barra apilada, ni etiqueta que agrupe las dos. El **único** lugar donde los cuatro se suman es `POSICIÓN`, y esa palabra **no significa inventario** |

**(c) Cómo se leen 5×N cifras sin marearse: alineación de columna.**
La tira es una **retícula de anchos fijos** (`grid-template-columns` con tracks fijos), mono con
`tabular-nums`, números **alineados a la derecha dentro de su celda**. Con eso las cuatro cifras forman
**cuatro columnas verticales perfectas** a lo largo de toda la solicitud: el operador escanea *hacia abajo*
una columna («¿de cuáles tengo muchas?») en vez de leer 40 renglones. Es la propiedad que hace que el sitio
«se lea como una tabla de precios» (§3.1) aplicada a la pantalla más densa del producto.

**(d) Dos densidades:**

| Densidad | Dónde | Etiquetas |
|---|---|---|
| **Cómoda** (default, y **la única** en `< lg`) | siempre | cada cifra lleva su etiqueta en la celda (`EN INVENTARIO 5`) |
| **Compacta** (opcional, `≥ lg`) | solicitudes largas | las etiquetas suben **una sola vez** a la cabecera (`<th scope="col">` reales) y las filas quedan con los **cuatro números** + el titular |

En `< md` la fila colapsa a **card** (§7.7): identidad, montos, y la tira **en dos renglones de dos**,
conservando la regla como separador horizontal entre los dos grupos.

**(e) Anatomía completa de la línea** (banda de dos renglones, no una fila de tabla de 9 columnas):

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ☑  Charizard VMAX                                    Cotizado         MX$ 900.00   │
│    SWSH03 · 020/189 · RAW · NM · HOLOFOIL            Ofertamos        MX$ 840.00   │
│                                                      MERCADO                       │
│    POSICIÓN 9/10 TOPE   EN INVENTARIO 5  VERIFICANDO 1 │ EN CAMINO 1  COMPROMET. 2 │
│    Sugerencia: no comprar — la posición llegó al tope de 10 piezas por variante.    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **`Cotizado` vs `Ofertamos`**: dos montos con etiqueta, nunca uno solo. El derivado sale de la curva
  **vigente al ofertar**, no se hereda de la cotización — y cuando difieren del cotizado, esa diferencia es
  precisamente lo que el operador necesita ver.
- **`priceBasis`** se pinta con el mapa canónico de §21.9a (`MERCADO/PISO/MANUAL/BOUNTY/PENDIENTE`), sin
  inventar rótulos nuevos.
- **Línea sin precio** (`derivedPriceCents === null`): versalita `SIN PRECIO` en `accent`, **sin monto**,
  casilla **desmarcada y bloqueada** hasta que se ponga override. Nunca `MX$ 0.00` (§7.3, §N.2).
- **Override:** input de dinero con prefijo `MX$` (§6.2) + **motivo obligatorio** (`Textarea`, 3–500). Sin
  motivo el guardado no procede: `422 OVERRIDE_REASON_REQUIRED` se pinta **inline en el campo del motivo**.
  Con override, la línea gana la versalita `MANUAL` y bajo el input, en `text-xs muted`:
  *«Derivado por la curva: MX$ 812.00»* — la cifra que se pisó **se sigue viendo**.
- **Después de emitir, la mesa es de solo lectura.** El override vive **solo antes** del correo (D2). Los
  inputs se renderizan como texto plano, igual que §16.3b hace con el operador.

**(f) La sugerencia que informa sin imponer.**

```
Sugerencia: no comprar — la posición llegó al tope de 10 piezas por variante.
Sugerencia: comprar — 1 de 10.
Sugerencia: no comprar — ya tienes 3 y el bounty buscaba 2.
Sugerencia: no comprar — tope general (10). Este bounty no tiene objetivo; se está midiendo con el tope.
```

| Decisión | Forma |
|---|---|
| **Es una frase en prosa, no un semáforo** | Una pastilla verde/roja a la izquierda de la fila se lee como **permiso**. Una frase se lee como **opinión**. La diferencia es exactamente D6 |
| **Asimétrica a propósito** | `do_not_buy`: la palabra **«no comprar»** en `--color-accent` peso 500, el resto en muted. `buy`: **todo muted, sin color, sin negrita**. Un consejo que dice «adelante» no necesita interrumpir; uno que dice «para» sí |
| **Siempre explica con cifras** | qué regla se disparó (`bounty_target` / `variant_cap`) y contra qué número (criterio 144). Una sugerencia sin su porqué no es revisable |
| **Ocupa el mismo espacio en los tres veredictos** | La fila **no cambia de alto** entre `buy`, `do_not_buy` y `none`. Si la fila salta al cambiar el veredicto, el operador aprende a temerle |
| **NUNCA gobierna el default de la casilla** | Ver (g) |
| **NUNCA apaga un control** | Ver (h) |

**(g) El default de la casilla, y por qué NO lo decide la sugerencia.**
Toda línea **con precio resoluble** nace **marcada como «comprar»**; la línea **sin precio** nace
desmarcada (no se puede ofertar sin monto). El punto de partida es **la solicitud tal como llegó** —lo que
el vendedor pidió vender—, y el cherry-pick es **quitar**. Si el default siguiera a la sugerencia,
«no comprar» se convertiría en un **bloqueo blando**: la inercia haría el trabajo que D6 le prohíbe hacer al
sistema. Contrapesos contra la inercia contraria (marcar todo por comodidad): el **contador y los tres
montos viven siempre a la vista** en la barra inferior (i), y hay acciones en lote **«Marcar todas» /
«Quitar todas»** para que quitar sea tan barato como poner.

**(h) ⚠ Qué SÍ apaga el botón de emitir y qué NO — la distinción que evita que alguien «endurezca» la mesa.**

| Señal | ¿Apaga «Emitir»? | Por qué |
|---|---|---|
| `suggestion.verdict === "do_not_buy"` | **NO. Nunca. Ni con confirmación extra** | El servidor **no** la valida (§4.39g). Endurecerla contradice `PROJECT.md` |
| `totals.netBelowMinimum` | **SÍ** | El servidor responde `422 OFFER_NET_BELOW_MINIMUM`. Dejar el botón vivo es prometer una acción que va a fallar |
| `pickupAddressMissing` | **SÍ** | Ídem: `422 PICKUP_ADDRESS_MISSING` |
| `positionUnavailable` | **NO** | Se puede ofertar sin conteo; lo que falta es el **consejo**, no el permiso (§23.7) |
| `requiresAuthorization` | **NO** — pero **cambia la etiqueta del botón** | Ver (i) |

**(i) Barra de totales sticky** (patrón §21.6, anclada con `--app-header-h` §4.5 al scroll):

```
──────────────────────────────────────────────────────────────────────────────────
 2 de 3 líneas    BRUTO MX$ 1,020.00  −  ENVÍO MX$ 180.00  =  SE DEPOSITA MX$ 840.00
 Previsualización · se congela al emitir                        [ Emitir oferta ]
──────────────────────────────────────────────────────────────────────────────────
```

| Estado | Qué cambia |
|---|---|
| **Normal** | como arriba. El nombre `SE DEPOSITA` es el **mismo** del correo: el operador ve la cifra con la etiqueta con la que la va a leer el vendedor |
| **`netBelowMinimum`** | botón apagado + texto asociado por `aria-describedby`: *«No se puede emitir: el depósito quedaría en MX$ 120.00 y el mínimo es MX$ 200.00. Agrega MX$ 80.00 de bruto, o no ofertes.»* Los tres números son `minimumNetCents`, `netCents` y `grossShortfallCents` **del servidor** (R4). Nunca un botón apagado y mudo |
| **`requiresAuthorization`** | el botón cambia de verbo: **«Enviar a autorización»**, con la nota *«El correo no sale hasta que el súper-admin la autorice.»* Un botón que dice «Emitir» y en realidad encola **miente sobre lo que va a pasar** |
| **`pickupAddressMissing`** | botón apagado + *«Falta la dirección de origen del vendedor. Llámalo (tienes su teléfono en la cola) para que la capture desde su cuenta.»* — se dice **el remedio**, no solo el problema |
| **Emitida** | la barra se sustituye por el resumen congelado + `Cancelar oferta` (§7.6, con la consecuencia escrita: *«se le manda el correo de cancelación y la solicitud vuelve a la fila con 7 días hábiles completos»*) |

- **Confirmación al emitir** (§7.6, dinero comprometido): repite **líneas, tres montos y plazo**, y el botón
  dice *«Emitir la oferta y mandar el correo»*. **No** se señala en ese diálogo cuántas líneas iban contra la
  sugerencia: eso sería la fricción que D6 prohíbe, colada por la puerta de atrás.
- **`aria-live="polite"`** sobre los totales: cambian con cada casilla.

**(j) Aviso de previsualización.** Bajo la barra, `text-xs muted` permanente:
*«Estas cifras se calculan con la curva y los diales de ahora. Lo vinculante se congela al emitir.»*

---

### 23.7 El conteo que no se pudo hacer (`positionUnavailable`) — R7

> **Por qué merece tratamiento propio:** un `0` que en realidad significa «no pude contar» **se ve
> confiable** y empuja a comprar de más. Es el mismo fallo que §7.3 resuelve en el dinero (nunca `$0` para
> «precio pendiente») aplicado al inventario, y aquí el daño es capital mal puesto.

**(a) Qué se pinta:** **la tira desaparece completa** —los cuatro sumandos **y** el titular `POSICIÓN n/m`—
y en su lugar va **una frase**:

```
    SIN CONTEO   No pudimos contar el inventario de esta carta.
    Sin sugerencia — falta el conteo.
```

- **`SIN CONTEO`**: versalita mono `text-[11px]` en `--color-accent`. Es el segundo canal (§2.4).
- **La frase en `text-xs` TINTA**, no muted: es información esencial para una decisión de dinero y §10
  prohíbe el muted para eso.
- **El titular tampoco se pinta.** Ni siquiera el denominador: un `—/10` invita a leerlo como `0/10`.
- La sugerencia se sustituye por *«Sin sugerencia — falta el conteo»* y **jamás** se infiere un veredicto.

**(b) Lista de prohibiciones — esta es la casilla donde el sistema se rompe:**

| Prohibido | Por qué |
|---|---|
| **`0`** | El fallo entero |
| **`—` / `–`** | En este sistema el em dash ya significa **«precio pendiente»** (§16.3a). Reusarlo aquí colisiona con una semántica de dinero y, peor, **se lee como cero** |
| **`?`, `N/D`, `n/a`, `-`** | Parecen valores. Un valor desconocido no es un valor |
| **Celda vacía** | Indistinguible de un cero mal renderizado |
| **Gris de placeholder / opacidad** | Bajar el contraste no comunica «falta el dato», comunica «esto importa menos» |
| **Skeleton que se queda** | Un skeleton promete que el dato viene. Si no viene, **miente indefinidamente** |
| **Tooltip como único portador** | No existe en táctil ni para el lector de pantalla |

**(c) El contraste con el cero real, que es la prueba de que el diseño funciona:**

| Caso | Qué se ve | Cómo se distingue |
|---|---|---|
| **Cero real** (`stock: 0`) | `EN INVENTARIO 0` — un dígito en su columna, tinta, **con la tira completa y el titular `POSICIÓN 0/10`** | **Hay retícula y hay número** |
| **Sin conteo** | **no hay retícula**: hay una versalita y una frase de prosa | **No ocupa columna: ocupa una oración** |

La distinción no es un matiz de glifo ni de tono: es **presencia de estructura numérica vs ausencia total de
ella**. Se reconoce a un metro de la pantalla y sobrevive a una captura en blanco y negro.

**(d) Nivel de pantalla.** Si **alguna** línea llega con `positionUnavailable`, sobre la tabla aparece un
`Banner` `warning` (§7.5, sin relleno) con `role="status"`:
*«No pudimos contar el inventario de {n} de {N} cartas. Puedes ofertar igual, pero lo harás sin ver cuántas
copias tenemos.»* + **Reintentar**. **No bloquea nada** (§23.6h).

**(e) La línea sigue siendo operable.** Montos, override y casilla funcionan con normalidad, y
`totals` sigue siendo válido (depende de montos, no del conteo). Lo que falta es el **consejo**, no el
permiso.

---

### 23.8 Colas nuevas de M5 y «declinar ahora»

> **⚠ v2.3.5 — §23.8 tenía un HUECO y el frontend lo tapó con criterio propio.** Esta sección especificó
> **las cuatro colas** (vistas con acción propia) pero **nunca las PESTAÑAS DE ETAPA** de M5, que son otra
> cosa: la partición total de `SellRequestStatus` en la pantalla principal. Al crecer el enum en cuatro
> valores, el frontend tuvo que inventar un rótulo (`ciclo`) **para que tres estados no desaparecieran de
> la pantalla**, y lo declaró como decisión suya. Hizo bien las dos cosas: **taparlo** y **decirlo**.
> **§23.8a llena el hueco.**

#### 23.8a Las pestañas de ETAPA de M5 — el eje es DE QUIÉN ES EL PENDIENTE

**El criterio de rotulación, que es lo que faltaba.** M5 es una **cola de trabajo**, así que sus pestañas
tienen que contestar **«¿qué me toca?»**, no «¿en qué estado está el registro?». De ahí sale un eje único:

| Eje | Qué significa | Forma del rótulo |
|---|---|---|
| **El pendiente es NUESTRO** | hay una acción que solo nosotros podemos hacer, y normalmente **hay un reloj corriendo en contra nuestra** | **«Por + verbo»** — nombra la acción |
| **El pendiente NO es nuestro** | ya hicimos lo que nos tocaba; aquí solo se **mira** | nombra **de quién depende**, nunca la acción |

**Mapa normativo (enmienda: §23.8 antes no lo tenía).**

| Pestaña | Estados | Rótulo ES / EN | Pendiente |
|---|---|---|---|
| **1** | `cotizada` | **«Por ofertar» / "To offer"** ⚠ *(era «Por recibir» / "To receive")* | **NUESTRO** — y con el reloj de caducidad de 7 días hábiles (D33) corriendo en contra |
| **2** | `ofertada` · `aceptada` · `en_transito` | **«Con el vendedor» / "With the seller"** ⚠ *(era «Ciclo de oferta» / "Offer cycle")* | **NO nuestro** — monitoreo |
| **3** | `recibida` · `verificacion` | «Verificando» / "Verifying" — **sin cambio** | NUESTRO |
| **4** | `aprobada` | «Por pagar» / "To pay" — **sin cambio** | NUESTRO |
| **5** *(transversal)* | `pagada` · `rechazada` · `abandonada` · `expirada` | «Cerradas» / "Closed" — **sin cambio** | ninguno |
| **6** *(transversal, ítems)* | *ítems* rechazados, no solicitudes | **«Piezas rechazadas» / "Rejected items"** ⚠ *(era «Rechazadas» / "Rejected")* | ninguno |

**(a) «Por recibir» ⇒ «Por ofertar» — el rótulo describía lo que el estado ya NO significa.**
**§23.1a lo dice con todas sus letras:** `cotizada` *«cambia de sentido en v2.3: ya no es "llegó y algún día
se verá", es **"te debemos una respuesta"»***. El rótulo se quedó anclado al modelo viejo, en el que el
vendedor mandaba el paquete primero y nosotros lo recibíamos. **Hoy en esa pestaña no hay nada que
recibir**: hay **gente esperando nuestra oferta**.

- **El daño es operativo, no cosmético.** «Por recibir» le dice al operador *«espera un paquete»* —una
  postura pasiva— cuando lo que esa cola contiene es **un pendiente nuestro con un plazo de 7 días hábiles
  corriendo en contra**, al final del cual la solicitud **caduca sola** y al vendedor le llega un *«no
  procederemos»* que **nadie decidió**. Un rótulo que induce a esperar es, literalmente, el
  comportamiento que hace que ese correo salga.
- **Es el mismo patrón que ya cacé dos veces**: `expiry.*` en un correo donde no expiraba nada (§23.12) y
  «Guía de envío seguro» donde «guía» ya significaba otra cosa (§7.13). **Un nombre sobrevive al cambio de
  significado y sigue empujando a quien lo lee hacia el modelo mental viejo.** Es, con diferencia, la forma
  más común de deuda de copy en este proyecto — y la más barata de arreglar.
- **La clave también se renombra:** `admin.m5.tabs.por_recibir` ⇒ **`admin.m5.tabs.por_ofertar`**. Misma
  doctrina que `offerCancelled.*`: *el número mal puesto se nota, el nombre que miente se propaga*.
  *(El discriminante TypeScript `M5OpTab` y el mapa `M5_STATUS_TAB` son código y los decide frontend; la
  recomendación es que **acompañen**, porque ese mapa es justamente lo que alguien lee para decidir dónde
  vive un estado nuevo.)*

**(b) La pestaña agrupada — se RATIFICA la estructura, se corrige el rótulo.**
**Las dos decisiones del frontend eran correctas y quedan normadas:**

1. **UNA pestaña y no tres.** Los tres estados son **monitoreo desde esta cola**; las colas con acción
   propia (por autorizar, por confirmar envío, guías por cancelar) son **vistas aparte** (§23.8). Tres
   pestañas sin acción invitarían a buscar un botón que no existe en ninguna.
2. **`aceptada` NUNCA bajo un rótulo que diga «en camino».** Aceptar **no mueve nada** (criterio 156,
   §23.1e) y el único estado que significa «un paquete viaja» es `en_transito`. **Esta restricción sigue
   en pie con el rótulo nuevo** y es la que descarta a la mitad de los candidatos.

**Por qué «Ciclo de oferta» no se queda**, aunque no esté mal: **(i)** es **jerga interna** —nombra una
fase de nuestro proceso, no un estado del trabajo del operador—; y **(ii)** es **impreciso por el borde**:
`en_transito` ya no es «el ciclo de la oferta», la oferta se aceptó dos pasos antes. **«Con el vendedor»**
contesta la pregunta operativa (*¿de quién depende?*), es verdad en los tres —su respuesta, su decisión de
enviar, su paquete— y **no se puede leer como «hay cartas llegando»**, que era el riesgo real.

> **⚠ Concesión consciente, para que no parezca descuido:** en `en_transito` el paquete lo tiene **la
> paquetería**, no el vendedor. Se acepta porque **el fallo caro es el contrario** —creer que hay cartas en
> casa cuando no las hay— y porque **la fila desambigua sola**: dentro de la pestaña, cada solicitud lleva
> su badge (`OFERTADA` / `ACEPTADA` / `EN TRÁNSITO`, §23.1a). **La pestaña agrupa; el badge precisa.**
> Y las llamadas al vendedor **no se sacan de aquí**: salen de la cola «vendedores con solicitudes vivas»
> (§23.8), que existe justo para eso.

**(c) «Rechazadas» ⇒ «Piezas rechazadas» — hallazgo del barrido: una MISMA palabra con dos significados en
la MISMA pantalla.** Esta pestaña es **transversal y NO contiene solicitudes**: consume
`GET /admin/buylist/rejected-items` y lista **ítems** (cartas/piezas) rechazados por no llegar en NM. Pero
`rechazada` es **también un estado de solicitud** —el del vendedor que **no respondió la oferta**
(§23.4.4-3a)— y ese vive en **«Cerradas»**.

- **Consecuencia:** un operador que busca *«las solicitudes que se rechazaron»* pulsa **«Rechazadas»** y
  encuentra **cartas**. Y las solicitudes que buscaba están en otra pestaña, con la misma palabra pintada
  en su badge. **Es una misnavegación garantizada, no hipotética.**
- **El arreglo nombra el objeto**, que es lo que faltaba: **«Piezas rechazadas» / "Rejected items"** —
  «piezas» es el término que ya usan M1 y el inventario, y **cubre raw, sellado y gradeadas**, mientras que
  «cartas» dejaría fuera al sellado. Clave: `admin.m5.tabs.rechazadas` ⇒ **`admin.m5.tabs.piezas_rechazadas`**.

**(d) Lo que NO se toca, y por qué se dice** (misma disciplina que §23.14.5: un barrido que cambia de más
hace daño nuevo):

| Pestaña | Veredicto |
|---|---|
| **«Verificando»** | **Se queda.** D16/D31/D33 no la tocaron y sigue siendo cierta: agrupa `recibida` + `verificacion`, o sea *«está en casa y hay que revisarlo»*. Es un gerundio entre rótulos «Por X», pero **describe bien el trabajo real** — y §23.6 ya usa «EN NUESTRAS MANOS» para ese mismo tramo |
| **«Por pagar»** | **Se queda.** Nombra la acción y el pendiente es nuestro: encaja en el eje sin cambiar una letra |
| **«Cerradas»** | **Se queda.** Los cuatro terminales, y `expirada` entre ellos. **Ojo:** su contenido incluye solicitudes con badge `RECHAZADA`, `SIN ENVÍO` y `NO PROCEDIÓ` (§23.1d) — el **motivo** lo pinta la fila, no la pestaña |

**(e) Accesibilidad y forma (§6.6, sin novedades).** Las pestañas son `role="tablist"` con
`aria-selected`; **el rótulo es el único portador del significado** (ningún color distingue una pestaña de
otra). Longitudes para el dimensionado (§9.4): la más larga es **«Piezas rechazadas» (17)** vs "Rejected
items" (14); en la fila 2, ES y EN empatan a 15. **La barra se dimensiona por ES.**

---

**Las CUATRO colas** (vistas con acción propia, distintas de las pestañas de (a)-(d)).
Todas reutilizan `DataTable` (§7.7) con su colapso a card en `< md`. **El teléfono viaja en la cola** (D12):
columna `Vendedor` con nombre + teléfono en mono seleccionable, **jamás en superficie pública**.

| Cola | Columnas clave | Tratamiento propio |
|---|---|---|
| **Ofertas por autorizar** | vendedor · preparó · **bruto** · tope · exceso · **`caducityAt`** | La columna **«Muere el»** con la fecha en mono; a ≤ 1 día hábil, en `--color-accent` con la versalita `CADUCA HOY/MAÑANA`. *Una cola cuyas filas se mueren sin avisar se trabaja a ciegas* |
| **Por confirmar envío** | vendedor · «ya lo mandé» el · guía · días esperando · plazo | `alert: true` (> 5 días hábiles) ⇒ versalita `ALERTA` en accent. **No expira ni mueve nada** (§23.1e) |
| **Guías por cancelar** | vendedor · paquetería · **número de guía** · abierta el · por qué se cerró (**estado + motivo**, §23.1d) | **No desaparece sola**: solo sale con «Guía cancelada». Copy del vacío: *«Ninguna guía pendiente de cancelar»* (positivo) |
| **Vendedores con solicitudes vivas** | vendedor · **teléfono** · cuántas vivas · la más antigua · último estado | Es *«la lista de gente a la que le debemos una respuesta»*. El orden por defecto es **la más antigua primero** |

**«Declinar ahora» (D39).** Vive en la ficha de la solicitud `cotizada`, como acción **`secondary`**
(no `destructive`: no estamos destruyendo nada del cliente, estamos contestándole), y abre confirmación
§7.6 porque **es terminal y manda un correo**:

```
Declinar esta solicitud
Se cierra la solicitud y se le manda el correo de «no procederemos».
No se puede reabrir ni volver a ofertar; si el vendedor sigue interesado,
tendrá que cotizar de nuevo.
Motivo (interno, queda en bitácora) [                          ]
                                        [ Cancelar ]  [ Declinar y avisarle ]
```

- El **motivo es interno** y así se rotula: *«El vendedor no lo verá.»* El correo 4 tiene **prohibido** decir
  por qué (§23.4.5).
- **El desenlace es idéntico al del barrido** y el diseño no lo distingue en ninguna superficie de cliente:
  mismo estado, mismo motivo, mismo correo. La distinción (`declinedBy`) vive **solo** en la bitácora y en
  reportes.

---

### 23.9 Estados de carga, vacío y error (obligatorios, §8.1)

| Superficie | Loading | Vacío | Error |
|---|---|---|---|
| **Mesa de decisión** | skeleton **con la retícula final** (§18.6): identidad, dos montos y **la tira de cuatro**, para que no salte al llegar el dato | no aplica (una solicitud siempre tiene líneas) | `Banner danger` + Reintentar. **Si falla el conteo, NO es error de pantalla**: es §23.7 |
| **Colas de M5** | filas skeleton | mensaje positivo («Nada pendiente aquí») | banner + reintentar |
| **Portal, oferta** | skeleton del bloque de montos con **la altura final** | — | banner persistente con el estado real |
| **Cotizador** | ya definido en §18.6. **La nota de servicio del envío (§23.3d) se pinta desde el primer render**: es copy estático, no espera a ningún dato y **no se esqueletiza** | «Tu cotización está vacía» — **con la nota igualmente visible**: el trato se explica antes de que haya carrito | inline. **Si falla `quote-policy`**: no se pinta el faltante, no se inventa mínimo, **la nota sigue ahí** y el CTA sigue vivo (la puerta es el `422` del servidor) |

**Regla money-safe del skeleton:** ningún skeleton reserva el hueco de una cifra que puede **no existir**
(§22 R4 aplicada aquí): la tira de posición se esqueletiza porque **siempre** hay respuesta —número o
`positionUnavailable`—, pero el bloque de montos del portal **no se esqueletiza si no hay oferta**.
**⚠ Y el bloque de dinero del cotizador no reserva altura para ninguna línea de envío ni de neto** (v2.3.1,
D43): esas líneas **no existen en ningún estado**, así que un skeleton que las dibuje estaría prometiendo
una cifra que jamás va a llegar — la misma mentira que §23.7 prohíbe en la tira de posición.

---

### 23.10 Accesibilidad (además de §8.2)

- **La tira de posición es una tabla real.** `<th colspan="2" scope="colgroup">` para los dos grupos
  (`EN NUESTRAS MANOS` / `TODAVÍA NO`) y `<th scope="col">` para cada sumando. El lector de pantalla anuncia
  **el grupo antes del número**, que es exactamente la distinción que R6 protege.
- **`aria-label` completo del titular:** «Posición 9 de 10: 5 en inventario, 1 en verificación, 1 en camino,
  2 comprometidas. Regla: tope general.»
- **`positionUnavailable`:** el texto es **texto real**, no `aria-label` sobre un guion. La versalita
  `SIN CONTEO` + la frase se leen tal cual.
- **Ningún control apagado y mudo:** `netBelowMinimum`, `pickupAddressMissing` y «sin dirección para crear»
  llevan siempre `aria-describedby` al texto que explica y da el remedio (§15.9).
- **Orden de tabulación** en la mesa: casilla → override → motivo → siguiente línea → barra de totales →
  emitir. La barra sticky va al final del DOM y no rompe el orden.
- **`aria-live="polite"`** en: totales de la mesa, cruce del mínimo en el cotizador, resultado de aceptar o
  rechazar. **`assertive`** solo para errores de emisión y de aceptación (dinero).
  **⚠ v2.3.1 (D43):** el anuncio del cruce del mínimo **ya no menciona envío ni neto** (*«Ya alcanzaste el
  mínimo de MX$ 500.00»*), y **la nota de servicio del envío NO va dentro de una región live**: es texto
  permanente, y repetirlo en cada cambio del carrito lo volvería ruido para quien navega con lector de
  pantalla. Se lee **una vez, en su orden del DOM** —inmediatamente después del monto—, que es exactamente
  donde lo lee quien mira.
- **Táctil ≥ 44px** en casillas de la mesa (se usa junto a las cajas, a veces con prisa) y en las dos
  acciones del portal.
- **Correo:** tablas de layout con `role="presentation"`; la tabla de montos **no** es presentacional (lleva
  encabezados); `alt` en el wordmark; **contraste verificado con las imágenes bloqueadas**; nada de texto
  dentro de imágenes.
- **`prefers-reduced-motion`:** la barra sticky y los cambios de totales sin transición.

---

### 23.11 Contraste (verificación) — **cero pares nuevos**

Todo lo que §23 usa ya está verificado en §10 y §17.2:

| Uso en §23 | Par | Ratio | Cumple |
|---|---|---|---|
| Cifras de posición, montos, titulares | tinta `#1A1A18` / papel `#F4F1EA` | ~15.5:1 | AA/AAA |
| Bloque de consecuencia del correo | tinta / pozo `#EFEBE2` | ~14.7:1 | AA/AAA |
| Etiquetas, eyebrows, notas al pie | muted `#6E695E` / papel | ~4.8:1 | AA |
| `SIN CONTEO`, `SIN PRECIO`, `no comprar`, `ALERTA`, `CADUCA HOY`, badges `ofertada`/`aceptada` | accent `#B31217` / papel | ~6.2:1 | AA |
| Los mismos sobre pozo | accent / pozo | ~5.9:1 | AA |
| Botón «Emitir» / CTA del correo | papel sobre tinta | ~15.5:1 | AA/AAA |
| Badge `pagada` / pasos completados | verde `#4E7A49` / papel | ~4.4:1 | AA borde — **la versalita es el portador** (§2.4) |
| Anillo de foco | accent / papel · pozo | ~6.2:1 · ~5.9:1 | AA (≥3:1 UI) |
| Reglas del correo (aplanadas) | `#D1CFC8` y `#AEACA7` sobre papel | UI decorativa | ok — **es el mismo token sin canal alfa**, no un token nuevo |

**Reglas derivadas de esta sección:**
1. **El muted no porta ninguna cifra ni ningún estado de §23.** Las cuatro cifras de la posición, la frase de
   `SIN CONTEO` y **la nota de servicio del envío del cotizador** (§23.3d, v2.3.1) van en **tinta**. El muted
   queda para etiquetas y notas. **Con D43 esta regla pesa más, no menos:** la nota es ahora **lo único** que
   el vendedor lee sobre el envío antes de la oferta — degradarla a muted la convertiría en la letra chica
   que §P.3 prohíbe, por la puerta del color.
2. **`warning` y `danger` comparten el rojo**, así que `SIN ENVÍO` (danger) y `ALERTA` (warning) se
   distinguen **por la palabra**, nunca por el matiz.
3. **`no_offer` es neutral a propósito.** Es el único desenlace del ciclo que **no** puede llevar rojo:
   pintarlo de atención acusaría a quien no falló.

---

### 23.12 i18n — claves nuevas (propiedad de frontend) y paridad ES/EN

Convención §9.2. **Todo lo de §23 existe en los dos idiomas** (el proyecto tiene test de paridad); los
**correos** se eligen por `User.locale`.

**Estados y stepper**
- `status.sellRequest.{cotizada,ofertada,aceptada,en_transito,recibida,verificacion,aprobada,pagada,rechazada,abandonada}`
  — **DIEZ claves para ONCE estados, y no es un olvido.**
- `status.sellRequestExpiry.{not_shipped,no_offer,unknown}` — **tres**, incluido el fallback neutro.

> **⚠ RÓTULOS DE ESTADO ≠ ESTADOS (v2.3.6). Nombrada aquí porque este es el sitio donde nace el desfase.**
> `SellRequestStatus` tiene **ONCE** valores, pero `status.sellRequest.*` tiene **DIEZ** claves: **`expirada`
> no tiene rótulo propio en ese espacio** porque **se pinta por su MOTIVO** —`status.sellRequestExpiry.*`,
> la única excepción del sistema y obligatoria (§23.1d)—. Sumando los dos espacios hay **13 rótulos** para
> **11 estados**, porque `expirada` aporta **tres**.
>
> | Se cuenta… | Cuántos | Dónde vale |
> |---|---|---|
> | **Estados** (`SellRequestStatus`) | **11** | particiones, mapas totales, `switch` exhaustivos, **reglas de QA** |
> | **Claves de `status.sellRequest.*`** | **10** | inventario i18n, test de paridad |
> | **Claves de `status.sellRequestExpiry.*`** | **3** | idem |
> | **Terminales** | **4** (`pagada`·`rechazada`·`abandonada`·`expirada`) | «Cerradas», `isTerminal` |
>
> **La regla:** *cuando cuentes, di **qué** estás contando.* Un «diez» a secas es ambiguo entre dos
> magnitudes distintas de esta misma feature, y **ya viajó una vez** — de aquí, donde era cierto, a
> §23.14.6-3bis, donde dejaba **un estado sin verificar**. **Ninguna afirmación de cobertura (particiones,
> mapas totales, reglas de QA) se escribe contra el conteo de CLAVES**: se escribe contra el **enum del
> contrato**, que es la fuente. Si el número y la enumeración discrepan, **manda la enumeración** — es lo
> que pasó aquí: la tabla de §23.8a estaba bien y el dígito estaba mal.
  ES `SIN ENVÍO` / `NO PROCEDIÓ` / `EXPIRADA`; EN `NOT SHIPPED` / `NOT PURSUED` / `EXPIRED`.
- `status.offerState.pending_authorization` — `POR AUTORIZAR` / `NEEDS APPROVAL` (**admin-only**).
- `buylist.stepper.{1..8}.label` + `buylist.stepper.closed.{rechazada,not_shipped,no_offer,abandonada}`.
- `buylist.shipDeclared.{label,at}` — `PAQUETE REPORTADO`.

**Cotizador (§23.3)** — **⚠ reescrito en v2.3.1 (D43)**
- `buylist.quote.money.cardsValue` — el **único** rótulo de monto del bloque («Valor de tus cartas» /
  "Value of your cards"). **Prohibido** cambiarlo por uno que prometa pago (§23.3c).
- **`buylist.quote.shippingNote`** — **la frase completa de §23.3d, UNA sola clave** (es **un párrafo**; el
  patrón «una clave por párrafo» de §22.11 se cumple, no se trocea en cuatro para «armarla»: trocearla
  invitaría a que alguien pinte solo el movimiento 1 y se pierda la resta).
  **ES:** «Nosotros ponemos la guía de envío y su costo se descuenta siempre de lo que te pagamos: tú no
  pagas nada de tu bolsillo. El monto exacto va en la oferta, antes de que aceptes.»
  **EN:** "We provide the shipping label and its cost is always deducted from what we pay you: you pay
  nothing out of pocket. The exact amount is in the offer, before you accept."
  **Sin placeholders**: esta clave **no admite `{amount}`** — si alguien le añade uno, es el bug de D43.
- `buylist.quote.minimum.{shortfall,minimumIs,addAnother,reachedAnnounce}` — con `{amount}` interpolado,
  nunca concatenado. `reachedAnnounce` es el `aria-live` del cruce (§23.10) y **no nombra envío ni neto**.
  - **⚠ v2.3.8 — clave NUEVA: `buylist.quote.minimum.addPricedCard`** («Agrega una carta que ya tenga
    precio.» / "Add a card that already has a price."). **Sustituye a `addAnother` cuando hay líneas sin
    precio** (§23.3f-bis). `addAnother` **se queda** para el caso normal: son **dos consejos, no dos
    redacciones del mismo** — con carrito lleno de pendientes, «agrega otra carta» es una **cinta de
    correr**.
- `buylist.quote.pendingLine.{label,note}` — **⚠ v2.3.8: `note` CAMBIA de contenido y de sitio.** `label`
  sigue siendo la versalita **`SIN PRECIO`** por línea. `note` **deja de pintarse por ítem** (con 999
  líneas era ruido) y pasa a pintarse **UNA vez en el bloque de dinero**, con **`{count}` interpolado** y
  la frase que dice **qué pasa con esas cartas** («las cotizamos a mano y te las incluimos en la oferta») —
  sin ella, «no suman» se lee como «no las queremos» y el vendedor **las borra**. Texto normativo ES/EN en
  §23.3h.
  **Sigue SIN IMPLEMENTARSE desde v2.3** *(alcance confirmado a frontend: `label` + `note` + `addPricedCard`)*.
- `buylist.request.address.{label,why,change,printed,missing}`.
- **⚠ CLAVES RETIRADAS (no se implementan; si ya existen, se borran):**
  ~~`buylist.quote.money.shippingOnUs`~~ (el rótulo de la línea de envío), ~~`buylist.quote.money.youWouldGet`~~
  (`RECIBIRÍAS ≈`) y ~~`buylist.quote.money.rule`~~ (sustituida por `shippingNote`, que **no es la misma
  frase**: la nueva incorpora la cita con el número). **El test de paridad ES/EN debe quedar en verde con
  las tres ausentes en los dos idiomas** — una clave viva en un solo idioma es el modo típico en que una
  cifra retirada reaparece en producción.
- **⚠ v2.3.2 — dos claves MÁS se retiran y dos se REUSAN fuera de su namespace (§23.14):**
  - ~~`home.quoter.wePay`~~ («Te pagamos» / "We pay you") — **retirada de los dos catálogos**. El total del
    teaser del home se rotula con **`buylist.quote.money.cardsValue`**, la misma clave del carrito. **No se
    crea un duplicado en `home.*`** (§23.3c-bis).
  - ~~`buylist.trustShipping`~~ — **retirada de los dos catálogos**. Su mitad falsa ya la había borrado
    frontend; la que quedaba **duplicaba `buylist.nmOnlyBody`** y su hueco **no podía llenarse ahí** (bloque
    `muted`, prohibido por §23.3c). Ver §23.14.2b.
  - **`buylist.quote.shippingNote` se reusa en dos superficies nuevas** —el teaser del home y la cabecera de
    `/buylist`— **sin cambiar una letra** y **sin clave nueva**. Es el mismo párrafo, sin placeholders.
  - **Cambian de contenido, no de nombre:** `safeShipping.{title,intro,step3Body,step4Title,step4Body}`,
    `buylist.shippingGuideLink`, `buylist.estimateNote`, `buylist.trustValidity`, `buylist.created`; y
    **opcionales** (PO decide): `buylist.subtitle`, `home.sellBody`. **Textos normativos en §23.14.1 y
    §23.14.4.**
  - **Longitud (§9.4):** en `safeShipping.step4Body` **EN es más largo que ES** (≈155 vs ≈146) y es **el
    cuerpo más largo de la retícula 01–04**: la fila **no lleva alto fijo, ni `line-clamp`, ni «ver más»**.

**Correos (`buylist.mail.*`)** — una clave **por párrafo** (nunca un solo string; §22.11 sentó el patrón):
- `offer.{subject,preheader,eyebrow,headline,conditionIntro,buyGroup,skipGroup,skipLabel,consequenceTitle,consequenceBody,grossLabel,shippingLabel,netLabel,ruleParagraph,deadlineParagraph,cta,ctaNote,guideParagraph,addressParagraph,closingParagraph}`
- **⚠ v2.3.1 (D43) — DOS claves del correo 1 cambian de CONTENIDO, ninguna de nombre:**
  - `offer.ruleParagraph` gana **dos interpolaciones**: `{shippingAmount}` **y** `{netAmount}` (antes solo
    el neto). ES: *«Nosotros ponemos la guía de envío. Su costo, {shippingAmount}, es una tarifa fija y
    siempre se descuenta de lo que te pagamos: tú no pagas nada de tu bolsillo. La cifra que se te deposita
    es {netAmount}.»* · EN: *"We provide the shipping label. Its cost, {shippingAmount}, is a flat fee and
    is always deducted from what we pay you: you pay nothing out of pocket. The amount deposited to you is
    {netAmount}."* **Los dos montos llegan resueltos del servidor** (R4) y son los **congelados** de la
    oferta, no los diales de hoy.
  - `offer.preheader` incorpora la resta (§23.4.7). **Regla de sistema, con el alcance que le da §23.4.7:**
    ninguna cadena **que viaje sola** —preheader, asunto, notificación, la nota del cotizador— puede decir
    «ponemos la guía» / "we provide the label" **sin** su «y se descuenta» / "and deduct it", **en ninguno de
    los dos idiomas**. Dentro del correo o del portal, donde la tabla de los tres montos está a la vista, un
    párrafo logístico como `offer.guideParagraph` («al aceptar te mandamos la guía…») **sí** puede hablar de
    la guía sin repetir la resta: ahí la aritmética ya está en pantalla.
- `offer.perLineCondition` — **la frase corta por línea** («siempre que llegue en Near Mint» / «provided it
  arrives Near Mint»). ≤ 34 car. ES, ≤ 30 EN.
- `reminder.accept.{subject,headline,body,cta}` · `reminder.ship.{subject,headline,body,guideLabel,alreadyShipped,cta}`
  · `reminder.frozen.{cards,net,deadline}` (el bloque congelado, compartido).
- `expiry.noResponse.{subject,headline,p1,p2,cta}` · `expiry.notShipped.{subject,headline,p1,p2,cta}` —
  **DOS variantes del correo 3**, no tres (§23.4.4).
- `notPursued.{subject,headline,p1,p2,p3,cta}` — el correo 4. **Sin ninguna clave de plazo, monto ni motivo.**
- **⚠ v2.3.3 — `offerCancelled.{subject,headline,p1,p2,cta}` — el correo 5. CAMBIA DE PREFIJO, no de texto.**
  ~~`expiry.cancelledByUs.*`~~ **se retira de los dos catálogos**; el contenido se mueve **carácter por
  carácter** a `offerCancelled.*`. **Este renombre es el punto importante del pase, más que el número.**

  > **Por qué el prefijo importaba más que el número.** Un correo mal numerado **se nota**: alguien lee la
  > tabla y lo corrige. **Un prefijo que miente se propaga**, porque no se lee — se autocompleta. Quien
  > abra `expiry.cancelledByUs` dentro de seis meses leerá **«expiración»** antes de leer el texto, y la
  > deriva natural de ese texto es hacia «se te venció», que es **exactamente la frase prohibida** en este
  > correo (§23.4.4-bis): la que **culpa al vendedor de un acto nuestro**. El árbol de claves es
  > documentación que el editor lee **primero y sin querer**; si el nodo padre afirma un hecho falso, cada
  > edición futura empuja el texto hacia la mentira. **El nombre viejo deja de existir: cero coexistencia.**

  > **Y por qué `expiry.noResponse` y `expiry.notShipped` SÍ se quedan** —para que el renombre no se
  > sobre-aplique—: en las dos **venció un plazo de verdad** (`offerAcceptDeadlineAt`, `shipDeadlineAt`) y
  > las dos lo dicen en su titular («Tu oferta venció»). El prefijo **describe su hecho**. Que `noResponse`
  > deje `rechazada` en vez de `expirada` es un detalle de la máquina de estados, no del hecho que el
  > vendedor lee. **`cancelledByUs` era el único donde no expiró nada.**

  > **`offerCancelled` no es un nombre inventado: es el vocabulario del propio contrato** —`offerCancelledAt`,
  > `POST …/offer/cancel`, `offerCancelReason`—. Una clave de correo que nombra **el mismo evento que el
  > schema** no se puede desincronizar por descuido, que es justo lo que le pasó a la anterior.

**Portal del vendedor (`buylist.offer.*`) — ⚠ NUEVAS en el documento (v2.3.7, §23.5g).**
Existían en el catálogo desde el pase del portal pero **§23.12 no las inventariaba**; se ratifican aquí.
**El espacio de claves y el EN quedan aprobados**, con **tres correcciones** y **un ajuste menor**:

- **Oferta viva:** `offer.{eyebrow,headline,conditionIntro,buyGroup,skipGroup,skipLabel,consequenceTitle,grossLabel,shippingLabel,netLabel,ruleParagraph,deadline,cardsTitle}`
- **Acciones y confirmaciones:** `offer.{accept,reject,confirmAcceptTitle,confirmAcceptBody,confirmAcceptCta,confirmRejectTitle,confirmRejectBody,confirmRejectCta}`
- **Resultados y cierres:** `offer.{acceptedNow,rejectedNow,acceptedOn,noLongerActive,quoteAgainCta,closedNotShipped,closedNoOffer,closedAbandoned,closedPaid,cancelledBanner}`
- **Antes de la oferta:** `offer.{preOfferTitle,preOfferBody}`
- **Estados de excepción:** `offer.{incompleteTitle,incompleteBody,notFoundTitle,notFoundBody,loginTitle,loginBody}`
- **Navegación:** `offer.{viewRequestCta,backToBuylist}`

| ⚠ | Clave | Qué cambia |
|---|---|---|
| **C1** | `offer.deadline` | ~~«la oferta **se cancela** sola»~~ ⇒ **«la oferta vence»**. Tras v2.3.3 «cancelar» es **el verbo del correo 5** (lo que hacemos nosotros); una oferta que muere por silencio **vence** (§23.5g-b) |
| **C2** | `offer.confirmRejectBody` | Gana **`{netAmount}`, `{count}` y `{condition}`**. R2 no admite excepción: si el diálogo nombra el neto, la condición va con él — y el neto **tiene que estar** (§23.5g-c) |
| **C3** | `offer.confirmAcceptBody` | Se **reenmarca** para poder **citar** el singular del servidor: *«…por {netAmount}. La condición es la misma para cada carta: {condition}.»* (§23.5c) |
| **m** | `offer.preOfferBody` | Deja de repetir el título: **cuerpo = «Te escribimos con nuestra oferta.»** (§23.5g-g) |

> **⚠ `offer.ruleParagraph` es una COPIA DECLARADA de `buylist.mail.offer.ruleParagraph`, no una clave
> nueva.** Mismo texto, mismos dos placeholders, en ES y EN. **La plantilla del correo es la fuente; el
> i18n es el espejo**, y cuando el servidor mande la prosa **esta clave se borra, no se deja de reserva**.
> Decisión completa, con sus tres condiciones y el motivo por el que **no es bloqueante**, en **§23.5h**.

**Mesa de decisión (`admin.buylist.desk.*`)**
- `position.{title,ofTotal,groupInHouse,groupNotYet,stock,verifying,inTransit,committed,rule.bounty,rule.cap,aria}`
- `position.unavailable.{tag,text,noSuggestion,banner,retry}` — `SIN CONTEO`.
- `suggestion.{buy,doNotBuy,none,reasonCap,reasonBounty,legacyBountyNote}`
- `totals.{lines,gross,shipping,net,preview,emit,emitForApproval,authNote}`
- `totals.belowMinimum` — con `{netAmount}`, `{minimumAmount}`, `{shortfallAmount}` interpolados.
- `pickupAddressMissing.{text,remedy}` · `decline.{action,title,body,reasonLabel,reasonHint,confirm}`
- `queues.{pendingAuth,pendingShipment,pendingGuide,liveSellers}.*` + `queues.diesOn`, `queues.alert`.

**Pestañas de etapa de M5 (`admin.m5.tabs.*`) — ⚠ NUEVAS en el documento (v2.3.5, §23.8a).**
Existían en el catálogo pero **§23 nunca las especificó**; se normalizan aquí. **Dos cambian de rótulo Y de
clave; tres no se tocan.**

| Clave | Antes | Ahora | Nota |
|---|---|---|---|
| ~~`por_recibir`~~ ⇒ **`por_ofertar`** | «Por recibir» / "To receive" | **«Por ofertar» / "To offer"** | El rótulo describía lo que `cotizada` **ya no significa** (§23.1a). **Se renombra la clave**, no solo el texto |
| ~~`ciclo`~~ ⇒ **`con_vendedor`** | «Ciclo de oferta» / "Offer cycle" | **«Con el vendedor» / "With the seller"** | Rótulo puesto por frontend ante el hueco de §23.8. **La estructura se ratifica**; cambia el nombre |
| `verificando` | «Verificando» / "Verifying" | **sin cambio** | — |
| `por_pagar` | «Por pagar» / "To pay" | **sin cambio** | — |
| `cerradas` | «Cerradas» / "Closed" | **sin cambio** | — |
| ~~`rechazadas`~~ ⇒ **`piezas_rechazadas`** | «Rechazadas» / "Rejected" | **«Piezas rechazadas» / "Rejected items"** | Colisionaba con el **estado** `rechazada` de solicitud, que vive en «Cerradas» (§23.8ac) |

- **Las dos claves viejas se retiran de los dos catálogos** (paridad estricta: `por_recibir`, `ciclo` y
  `rechazadas` **no existen en ES ni en EN**). Misma doctrina que `offerCancelled.*`: **cero coexistencia**.
- **Longitudes (§9.4):** la más larga es **«Piezas rechazadas» (17)** vs "Rejected items" (14) ⇒ **la barra
  se dimensiona por ES**. En `con_vendedor`, ES y EN empatan a 15.

**Notas de longitud (§9.4)**
- `EN NUESTRAS MANOS` (17) vs `IN OUR HANDS` (12) y `COMPROMETIDO` (12) vs `COMMITTED` (9): **ES es el más
  largo en toda la tira** ⇒ los tracks de la retícula se dimensionan por ES y **no** se re-miden por idioma,
  para que la alineación de columnas de §23.6c sea la misma en los dos.
- `SE TE DEPOSITAN` (15) vs `DEPOSITED TO YOU` (16): **aquí EN es más largo**. La celda de la etiqueta del
  neto se dimensiona por el **máximo de ambos**.
- Las versalitas de estado **envuelven a dos líneas antes que truncarse** en columnas estrechas.
- **Prohibido concatenar** para armar montos o plazos: interpolación con `{amount}` / `{date}`.
- **`buylist.quote.shippingNote` (v2.3.1):** ~163 caracteres en ES y ~155 en EN ⇒ **4 líneas** en el drawer
  de 400px y **3–4** en el paso de crear. El bloque de dinero **no lleva alto fijo** y la nota **no se
  trunca, no lleva `line-clamp`, no lleva «ver más»**: es corta a propósito **para caber entera**. Si en
  algún ancho no cupiera, se corrige el contenedor, **nunca el texto**.

---

### 23.13 Notas a otros roles (solicitudes derivadas del diseño)

1. **✅ CERRADA — «el cotizador es PÚBLICO y necesita dos números de M10».** *(Se conserva el texto original
   abajo, tachado, porque el modo en que se cerró importa.)* **Se resolvió al revés de como este documento
   lo planteó: el humano quitó el requisito (D43) en vez de construir la superficie.** El cotizador **ya no
   muestra ninguna cifra de envío** (§23.3 reescrita). El diagnóstico era correcto —hardcodear estaba
   prohibido— pero **la conclusión de que había que exponer la tarifa era mía, no de `PROJECT.md`**: D31
   pedía *decir la regla con todas sus letras*, no *hacer la resta*. **Sin deuda pendiente por este punto.**
   > ~~**⚠ Arquitecto — el cotizador es PÚBLICO y necesita dos números que hoy solo viven en M10 (la más
   > importante).** §23.3 exige mostrar **la tarifa de envío** y **el mínimo de compra** *antes* de crear la
   > solicitud… **Petición:** que la respuesta del quote (o del batch) eche los dos montos, o que exista un
   > endpoint público de configuración del buylist.~~
   **1-bis. ⚠ Arquitecto — consecuencia directa: `shippingFeeCents` se quedó sin consumidor público.**
   `GET /buylist/quote-policy` (v1.51.4, D41) se creó **para** este requisito y expone
   `{ minimumRequestCents, shippingFeeCents }`. Con D43, **`minimumRequestCents` sigue siendo necesario**
   (el faltante del mínimo se queda, criterio 132) pero **`shippingFeeCents` ya no lo consume ninguna
   pantalla pública**. **Petición: retirarlo del DTO público.** El argumento es del propio contrato — *«se
   publica un dial **solo si** la pantalla pública lo necesita para no mentir sobre el dinero»*: hoy ninguna
   lo necesita. Y hay un beneficio de diseño que vale más que la limpieza: **si el número no llega al
   navegador, D43 deja de depender de la disciplina del frontend y pasa a ser imposible de violar por
   accidente.** Un dial publicado y sin uso es una cifra esperando a que alguien la pinte. **Decisión del
   arquitecto; no bloquea nada** (el frontend simplemente no lo lee).
2. **✅ CERRADA (v2.3.3) — «el correo 3 tiene TRES productores y uno de ellos NO es terminal».**
   **El arquitecto resolvió el fondo, no la forma: la cancelación es un CORREO PROPIO, el 5**
   (`ARCHITECTURE §4.39(n)`, v1.51.4), con **un solo productor**. §23 se alinea en v2.3.3: ~~3c~~ deja de
   existir, el texto **no cambia una letra** y nace **§23.4.4-bis**. **La petición original —«confirmar que
   la plantilla se selecciona por productor»— queda sin objeto**: si cada hecho tiene su plantilla, no hay
   nada que discriminar en tiempo de render.
   **⚠ Y la parte que sí quedó como trabajo mío, porque era el riesgo real:** la clave se llamaba
   `expiry.cancelledByUs.*`. **El número mal puesto se nota; el prefijo que miente se propaga** — quien lo
   edite dentro de seis meses leerá «expiración» antes que el texto, y la deriva natural es hacia «se te
   venció», la frase **prohibida** en este correo. Pasa a **`offerCancelled.*`** (§23.12), que es el
   vocabulario del propio contrato. **Lección de proceso, y me toca a mí:** agrupé dos hechos opuestos
   **porque compartían `status`** — exactamente lo que **R3** prohíbe, aplicado al revés de como lo escribí.
   > ~~**Petición:** confirmar que la plantilla del correo 3 se selecciona por **productor**, o formalizar
   > las tres variantes en el contrato.~~
3. **⚠ Arquitecto — tras una cancelación, el portal del vendedor se queda mudo.** Al cancelar se **limpian**
   los campos de la oferta y `offer` vuelve a `null`: el vendedor que acaba de recibir el **correo 5** entra a
   su cuenta y **no ve rastro** de la oferta que sí recibió, ni del hecho de que la cancelamos. La pantalla
   contradice el correo. **Petición:** un dato mínimo en la proyección de cliente (p. ej.
   `lastOfferCancelledAt`) que permita pintar *«Te mandamos una oferta y la cancelamos el {fecha}; estamos
   revisando tu solicitud otra vez»*. **No** se pide el monto de la oferta cancelada — eso sí conviene que
   desaparezca.
4. **Arquitecto — corregir la dirección después de la guía no tiene remedio self-service.** `PATCH
   …/pickup-address` exige `guideSentAt IS NULL`. §23.5e pinta *«Ya imprimimos la guía con esta
   dirección»* **sin botón**, que es honesto pero deja al vendedor sin salida en la app. Si se quiere una,
   sería un canal de contacto (no una edición). **No bloquea el diseño**; se registra.
9. **⚠ Arquitecto — TRES peticiones del portal (v2.3.7), y la segunda puede cobrarle un plazo al vendedor.**
   **(a) Que el servidor mande la prosa del descuento.** Hoy `offer.ruleParagraph` **solo existe en la
   plantilla del correo**, y §23.5b **obliga** al portal a mostrarla (bajo D43 es el único sitio donde la
   resta se puede releer). El frontend tuvo que **duplicarla** en i18n. **Permitido como puente** con tres
   condiciones (§23.5h), pero **la solución correcta es que viaje resuelta en el DTO**, como ya viajan la
   condición y la consecuencia — que el portal **sí** pinta verbatim. Con eso, la copia **se borra**.
   **(b) ⚠ Un discriminador para `rechazada`.** El DTO no dice si cerró **el vendedor** (pulsó rechazar) o
   **el barrido** (silencio). Son **hechos distintos** —exactamente la distinción que obligó a separar el
   correo 5 del 3— y sin el dato la pantalla **solo puede decir una frase neutra** (§23.5g-e). No es un
   fallo del frontend: es **información que no llega**. Con un `closedBy` (o equivalente), cada causa
   recupera su frase y **dejamos de decirle «venció» a quien decidió**.
   **(c) ⚠ La oferta INCOMPLETA puede quemarle el plazo al vendedor — y esto sí es de dinero.** Si la
   oferta llega sin términos o con líneas sin decisión, el portal **se niega a pintarla** y el vendedor
   **no puede aceptar** (§23.5g-d, R2 hasta el final). **Pero el reloj de aceptación sigue corriendo.**
   Resultado posible: la oferta **vence por un fallo NUESTRO de proyección**, y al vendedor le llega el
   correo 3a diciéndole que **no respondió**. Es literalmente lo que §P.13 prohíbe —*un plazo del vendedor
   solo puede vencer por algo que dependa del vendedor*— y es la misma injusticia que motivó D38.
   **El copy no puede taparlo**: una pantalla que prometiera «no te preocupes por el plazo» estaría
   mintiendo si el barrido no lo respeta. **Petición:** que una oferta inmostrable **no consuma plazo**, o
   que se detecte y se re-emita. **Lo señalo, no lo asumo.**
5. **Arquitecto — el bucle cancelar/re-emitir necesita ser visible aunque no se tape.** `PROJECT.md` §P.3.1
   deja el candado en manos del arquitecto. Desde UX: **cada cancelación manda un correo**, así que el
   vendedor no queda en silencio, pero **sí puede quedar en un limbo indefinido**. **Petición mínima:** que
   la cola de M5 y la ficha expongan **cuántas veces se ha reiniciado el reloj** (o la fecha del primer
   `createdAt` junto a `caducityAt`), para que el operador vea el bucle. Sin dato, el diseño no puede
   mostrarlo.
6. **PO — ratificar textos.** `offer.perLineCondition`, el bloque `consequence`, los **dos** titulares del
   correo 3, el del **correo 5** y los tres párrafos del correo 4. Son el **documento vinculante** del
   ciclo; ux-ui propone la redacción, PO (y quien haga la revisión legal de los términos) la ratifica.
   *(v2.3.3: el titular del correo 5 **ya estaba ratificado como «3c»** — cambió de número y de clave, no de
   texto. **No hay que volver a ratificarlo**; se lista para que el inventario cuadre.)*
   **⚠ Se añaden tres textos de v2.3.1 (D43), y los tres son sensibles:** **(a)**
   `buylist.quote.shippingNote` en ES y EN —**la única cosa que el vendedor lee sobre el envío antes de
   comprometer sus cartas**, §23.3d—; **(b)** el `offer.ruleParagraph` ampliado, en particular la
   afirmación **«es una tarifa fija»** (sale de `PROJECT.md` §P/D31 — *«una tarifa fija de MX$180»*— y
   **conviene que PO confirme que se puede afirmar así frente al cliente**); **(c)** el preheader corregido
   del correo 1.
   **6-bis. ⚠ PO — dos encargos que solo se pueden cerrar del lado de producto.**
   **(a) Formalizar D43 en `PROJECT.md`.** La decisión llegó a este pase por la vía del orquestador y
   `PROJECT.md` todavía no la registra: el bullet de D31 *«el descuento del envío se dice EN TODOS LADOS»*
   sigue en pie —**y esta sección lo cumple**—, pero conviene que diga explícitamente que **en el cotizador
   se dice sin cifras** y que **la resta con los tres montos vive solo en la oferta**. Sin ese renglón, el
   próximo que lea D31 y el criterio 132 va a reconstruir la resta del carrito **creyendo que corrige un
   olvido**. *(Recordatorio de la regla de conflicto: manda `PROJECT.md`; este documento se alinea, no al
   revés.)*
   **(b) Medir lo que D43 traslada al correo** — es la mitigación que propuse en §23.3l, y es de producto:
   **tasa de rechazo y de silencio por tamaño de oferta**, mirando en especial las ofertas cerca del mínimo,
   donde la tarifa fija pesa **~36%**. Si esas ofertas se caen sistemáticamente **después** del correo, el
   problema **no es la divulgación** (enseñar en el cotizador un neto optimista sería peor, §23.3a.2): es
   **la proporción**, y se corrige **con el dial del mínimo de compra**, que ya existe en M10. Es un
   experimento barato: el dato ya se registra por solicitud.
7. **Frontend — qué hay que tocar y qué no.** **No** se pide ningún componente nuevo. Se **extienden** dos:
   (a) `PipelineStepper` — ocho pasos, tres orientaciones (§23.2b) y **cierre terminal** en vez de noveno
   nodo; (b) el mapa de badges — recibe `{status, expiredReason}` y resuelve `expirada` **por el motivo**,
   con fallback neutro. Todo lo demás se compone: `Badge` §7.2, `Banner` §7.5, `DataTable` §7.7,
   `AmountBreakdown` §7.12, `Select`/`Input`/`Textarea` §6.2–6.3, barra sticky §21.6, skeletons §18.6.
   **La plantilla de correo es medio nuevo**, con su propia hoja de reglas (§23.4.0) y **su parte de texto
   plano obligatoria**.
   **⚠ v2.3.1 (D43) — lo que cambia para frontend, y es sobre todo trabajo que se BORRA:** en el cotizador
   se retiran **la línea de envío, la regla de la resta y el neto estimado** (y sus tres claves i18n,
   §23.12); el bloque de dinero queda con **un monto, el faltante cuando aplique y una frase estática**; el
   cotizador **deja de leer `shippingFeeCents`** (solo necesita `minimumRequestCents`, y sabe vivir sin él,
   §23.3k); el portal **antes de la oferta** pinta la frase, **no** el bloque de la resta (§23.5d). En el
   correo 1, la prosa pasa a interpolar **dos** montos. **Cero componentes nuevos y cero tokens nuevos**,
   igual que el resto de §23.
8. **QA visual sugerido.**
   (a) **Correo 1 con imágenes bloqueadas y sin webfonts**: los tres montos, la condición por línea y el
   plazo siguen legibles; el neto es la cifra más grande. **⚠ v2.3.1: la cifra del envío aparece DOS veces
   —tabla y prosa— y el neto también**; el correo **no contiene** «como ya sabías», «recuerda que» ni
   ninguna fórmula que presuponga que el vendedor ya conocía la tarifa.
   (b) **Ningún asunto ni preheader del sistema contiene el bruto** (R1) — buscar el bruto en **los cinco**.
   (c) **Ningún correo que mencione un monto ofertado omite la condición NM** (R2) — incluido el
   recordatorio.
   (d) **El correo 4 no contiene**: ninguna fecha límite, ningún monto, ninguna palabra de causa, ninguna
   referencia al tiempo transcurrido.
   (d-bis) **⚠ v2.3.3 — el correo 5, y es la prueba más barata del renumerado.** `grep` de `venció` /
   `expired` / `deadline` sobre la plantilla del **5** en ES y EN ⇒ **cero coincidencias**; **cero montos**;
   su CTA dice **«Ver mi solicitud»** y **no** «Cotizar de nuevo». Y la prueba de la clave: **el prefijo
   `expiry.cancelledByUs` no existe en ninguno de los dos catálogos** (el test de paridad debe quedar en
   verde con la clave **ausente en ES y EN**); el contenido vive en **`offerCancelled.*`**.
   (d-ter) **Cancelar una oferta `sent` manda el 5; el barrido al caducar manda el 4.** Forzar los dos
   caminos y comprobar que **no se cruzan**: un 5 disparado por el barrido le diría al vendedor que su
   solicitud sigue viva **el día que la cerramos**.
   (e) `expirada` con los **dos** motivos: correos distintos, versalitas distintas, **colores distintos**, y
   el `no_offer` **sin ningún rojo**; con `expiredReason` forzado a `null`, cae al fallback neutro y **no**
   al acusatorio.
   (f) **Correo vs portal**: los tres montos, el plazo y la condición coinciden **carácter por carácter**.
   (g) **Mesa**: forzar `positionUnavailable` en una línea ⇒ desaparece la tira **y el titular**, aparece
   `SIN CONTEO` + frase en tinta, la sugerencia dice «sin conteo», y **el botón de emitir sigue vivo**;
   compararla con una línea de `stock: 0`, que sí muestra retícula y `POSICIÓN 0/10`.
   (h) **Buscar en todo el DOM de la mesa** un subtotal, un `+` o un paréntesis que agrupe `en camino` con
   `comprometido` (R6): si aparece, es el bug.
   (i) **Sugerencia `do_not_buy`**: la casilla se puede marcar, el botón emite y **no** aparece ninguna
   confirmación extra; la fila **no cambia de alto** entre los tres veredictos.
   (j) `netBelowMinimum` y `pickupAddressMissing` apagan el botón **con texto asociado**; ninguno apagado y
   mudo.
   (k) `requiresAuthorization` ⇒ el botón dice **«Enviar a autorización»**, no «Emitir».
   (l) **⚠ REESCRITA (v2.3.1, D43) — el cotizador no dice ninguna cifra de envío, en NINGÚN estado.**
   Es la prueba más barata de todo §23 y se corre con un `grep` sobre el DOM y sobre `messages/{es,en}.json`:
   　(l.1) En el **carrito, el panel de requisitos de venta y el paso de crear**, en **ES y EN**, por debajo
   y por encima del mínimo, con líneas `SIN PRECIO` y con el carrito vacío: **el único `MX$` que aparece es
   el valor de las cartas y, cuando aplique, el faltante y el mínimo**. Cero coincidencias de `180`, de
   `RECIBIRÍAS` / `YOU'D GET`, de `%`, y de «envío/shipping» seguido de dígitos.
   　(l.2) La **frase de servicio es idéntica carácter por carácter** en las dos superficies del cotizador,
   **y no cambia** al cruzar el mínimo (ni de texto, ni de posición, ni de tamaño).
   　(l.3) **El faltante sigue vivo** («te faltan MX$120 para el mínimo de MX$500») y **no menciona envío**.
   　(l.4) **Con `GET /buylist/quote-policy` caído**: no hay faltante, **no hay mínimo inventado**, la frase
   sigue ahí y el CTA sigue habilitado (la puerta es el `422` del servidor).
   　(l.5) **Las tres claves retiradas no existen en ninguno de los dos idiomas** y el test de paridad pasa.
   　(l.6) **Rastro de la primera divulgación:** recorrer todo lo que el vendedor ve **antes** del correo 1
   —cotizador, paso de crear, correo de alta si lo hubiera, portal en `cotizada`— y verificar que **ninguna
   superficie contiene la tarifa**. La primera aparición del monto del envío en todo el ciclo debe ser el
   **correo 1**.
   (m) **EN completo** en las **cinco** plantillas, en la tira de posición y en las colas; la alineación de
   las cuatro columnas de la tira es idéntica en ES y EN.
   (n) 390px: la tira colapsa a dos renglones de dos **conservando el separador de grupos**; ningún monto
   truncado con `MX$ 999,999.00`.

---

### 23.14 Barrido de copy vivo — las superficies que seguían contando el trato viejo (v2.3.2)

> **Por qué existe esta sección.** §23 diseñó **el ciclo nuevo**. Lo que **no** hizo —y es un fallo de este
> documento, no del frontend— fue **auditar el copy que ya estaba en pantalla**. D16/D31 cambió **quién
> pone el envío**; todo texto escrito antes de esa decisión quedó sospechoso por defecto, y tres de ellos
> sobrevivieron al pase de D43 **porque §23 no los nombraba**. El frontend los encontró al implementar y
> **no los tocó** (el copy es de ux-ui); aquí se resuelven, y el barrido completo encontró **cuatro más**.
>
> **La lección, escrita para que se pueda aplicar la próxima vez:** *cuando una decisión cambia **quién
> paga algo**, el entregable no es la pantalla nueva — es **la lista de todo lo que afirmaba lo
> contrario**.* §23.3g ahora es esa lista y por eso gana filas en vez de notas al pie.

**Índice de lo que cambia.** «Contradicción viva» = un vendedor podía leerlo **hoy** y actuar mal.

| # | Clave | Superficie donde se pinta | Clase | Choca con |
|---|---|---|---|---|
| 1 | `safeShipping.step4Title` · `step4Body` | modal del hero de `/buylist` · sección inline al pie · (§P: correo de aceptación y correo de la etiqueta) | **Contradicción viva — la más cara** | **D16/D31** |
| 2 | `safeShipping.intro` | idem | **Contradicción de dominio** + hueco de **AC 34** | §H / AC 34 |
| 3 | `safeShipping.title` · `buylist.shippingGuideLink` | enlace del hero · título del modal · `h2` de la sección inline | **Ambigüedad creada por D16** | D16/D31 |
| 4 | `safeShipping.step3Body` | idem | Mejora (rescata contenido del paso 4 viejo) | — |
| 5 | `home.quoter.wePay` | teaser del cotizador del home (**dos instancias**: columna del hero y sección móvil) | **Contradicción viva — promete depósito** | §23.3c / D31 |
| 6 | `buylist.trustShipping` | bloque de confianza al pie de `/buylist` | **Recorte + duplicado** ⇒ **retirada** | D16/D31 y `nmOnlyBody` |
| 7 | `buylist.estimateNote` | bloque de dinero del carrito (`SellCartContents`) | **Contradicción viva de dinero** | **D2/D9** |
| 8 | `buylist.trustValidity` | pie de `/buylist` **y** resumen del paso de crear | **Contradicción viva de dinero** | **D2/D9** |
| 9 | `buylist.created` | aviso `role="status"` tras crear la solicitud | **Contradicción viva — invita a enviar sin guía** | **D16** / §P.4 |
| 10 | `buylist.subtitle` · `home.sellBody` | `h1` de `/buylist` · banda CTA «Vender mis cartas» del home | Mejora **opcional** (no contradice) | — |

**Y lo que el barrido confirmó que NO se toca** (§23.14.5): `home.bounties.wePay`, `buylist.bounties.wePay`,
`nmOnlyBody`, `payAfterReceipt`, `trustPayment`, `cartFooterNote` y **todo** el envío del **comprador**
(`withdrawals.*`, `checkout.*`) — que es **otro eje de dinero** y no lo toca D16.

---

#### 23.14.1 La guía de empaque — el daño era mayor que el paso 4

**Diagnóstico paso por paso.** Se revisaron los siete strings del componente. **Tres estaban mal, y solo
uno se había reportado.**

| String | Veredicto | Razón |
|---|---|---|
| `title` / `shippingGuideLink` | **Cambia** | «Guía de envío seguro» convive en la misma página con «Nosotros ponemos **la guía** de envío». Dos referentes para la misma palabra, y uno de ellos es **una etiqueta que cuesta dinero** |
| `intro` | **Cambia** | Habla de **«disputas»**, que es el remedio del **comprador** (§legal, 7 días desde la entrega) y **no existe** del lado del vendedor: su riesgo es que **la carta no se compre** y **la devolución le cueste**. Además, **AC 34 exige la política NM-only en la guía** y el **modal no la tenía** (vive suelta en la página, que el modal tapa) |
| `step1Title/Body` (funda) | **Intacto** | Es empaque puro. AC 34 exige la palabra **sleeve/funda**: se conserva |
| `step2Title/Body` (top loader) | **Intacto** | Igual. AC 34 exige **top loader**: se conserva |
| `step3Title` | **Intacto** | — |
| `step3Body` | **Cambia (mejora)** | Hereda el **«anota tu número de solicitud»** que se pierde al reescribir el paso 4. Es información útil de recepción y no tenía por qué morir con el trato viejo |
| `step4Title/Body` | **Se reescribe entero** | *«Asegura por el valor cotizado»* ⇒ bajo D16 **el vendedor paga dos veces por lo mismo**. Es la única línea del producto que le **cuesta dinero real** a quien la obedece |
| `understood` | **Intacto** | — |

**Copy normativo (ES y EN — paridad estricta; PO ratifica, §23.14.7).**

| Clave | ES | EN |
|---|---|---|
| `safeShipping.title` | Cómo empacar tus cartas | How to pack your cards |
| `buylist.shippingGuideLink` | Cómo empacar tus cartas | How to pack your cards |
| `safeShipping.intro` | Solo compramos cartas en Near Mint. Empácalas bien: la que no llegue en NM no se compra, y la devolución corre por tu cuenta. | We only buy Near Mint cards. Pack them well: a card that doesn't arrive NM isn't bought, and the return is at your cost. |
| `safeShipping.step1Title` | *(sin cambio)* Funda blanda | *(unchanged)* Soft sleeve |
| `safeShipping.step1Body` | *(sin cambio)* Cada carta en su funda, nunca suelta ni pegada a otra. | *(unchanged)* Every card in its own sleeve, never loose or stuck to another. |
| `safeShipping.step2Title` | *(sin cambio)* Top loader rígido | *(unchanged)* Rigid top loader |
| `safeShipping.step2Body` | *(sin cambio)* La funda entra en un top loader; así la carta no se dobla. | *(unchanged)* The sleeve goes into a top loader so the card can't bend. |
| `safeShipping.step3Title` | *(sin cambio)* Sobre o caja rígida | *(unchanged)* Rigid mailer or box |
| `safeShipping.step3Body` | Sobre burbuja para pocas cartas, caja con relleno para lotes; adentro, una hoja con tu número de solicitud. | Bubble mailer for a few cards, padded box for larger lots; inside, a sheet with your request number. |
| **`safeShipping.step4Title`** | **La guía la ponemos nosotros** | **We provide the label** |
| **`safeShipping.step4Body`** | **Al aceptar la oferta te mandamos la guía y su costo se descuenta de tu pago. Tú no compras ni aseguras nada, y no mandas el paquete hasta tenerla.** | **When you accept the offer we send you the label and its cost is deducted from your payment. You buy and insure nothing, and you don't ship until you have it.** |
| `safeShipping.understood` | *(sin cambio)* Ya lo entendí | *(unchanged)* Got it |

**Las cuatro decisiones del paso 4, y por qué cada una está donde está:**

1. **El título nombra al responsable, no a la acción.** «La guía la ponemos nosotros» / "We provide the
   label" corrige el error en el **encabezado**, que es lo único que se lee en una retícula de cuatro
   columnas si el vendedor va rápido. Un título como «Envío» habría dejado el arreglo escondido en el
   cuerpo.
2. **La resta va en la misma frase que el ofrecimiento** (§23.14.3). No se puede partir en «te mandamos la
   guía» aquí y «se descuenta» en otro lado: **este componente viaja solo** —el modal no tiene un bloque
   de dinero al lado, y `PROJECT.md` §P lo repite dentro de dos correos—.
3. **Las tres prohibiciones son la parte operativa**, y están en orden de coste: **comprar** (paga dos
   veces), **asegurar** (paga dos veces, y es lo que decía el texto viejo **con todas sus letras**),
   **mandar antes de tener la etiqueta** (`PROJECT.md`: *«si aun así manda algo por su cuenta, esa pieza
   **no está comprada**»* — el peor desenlace posible del ciclo).
4. **Sin cifras.** D43 alcanza aquí: ni monto, ni rango, ni «tarifa baja», ni `$0`. Y **sin «gratis»**: el
   envío **no es gratis**, es **nuestro y descontado** (§23.3e).

> **Nota de tiempo verbal, porque el componente se pinta en dos momentos.** «Al aceptar la oferta…» /
> "When you accept the offer…" funciona **antes** de que exista oferta (lo que va a pasar) y **después** de
> aceptarla (lo que está pasando). Un texto en pasado («ya te mandamos la guía») rompería el uso de AC 34,
> que es **antes de crear la solicitud**.

---

#### 23.14.2 Las dos superficies de dinero: el teaser del home y el recorte de `/buylist`

**(a) `home.quoter.wePay` — RETIRADA. La decisión es que el rótulo deje de prometer, Y que la superficie
entre a §23.3g.** El encargo daba las dos salidas como alternativas; **se toman las dos**, porque
resuelven cosas distintas:

| Qué | Decisión |
|---|---|
| **El rótulo** | `home.quoter.wePay` **se retira de los dos catálogos** y el total pasa a rotularse con **`buylist.quote.money.cardsValue`** — la **misma clave** que ya usan el carrito y el resumen del paso de crear. **No se crea `home.quoter.cardsValue`**: un segundo string con el mismo significado es el mecanismo exacto por el que este rótulo se desincronizó |
| **La superficie** | El teaser **entra a §23.3g como fila 0** y pinta la **nota de servicio** (`buylist.quote.shippingNote`, componente `BuylistShippingNote` ya existente), **sin cifras** (D43 intacta) |

- **Por qué el rótulo solo no bastaba.** Con «Valor de tus cartas» el teaser deja de **mentir**, pero sigue
  siendo **la primera pantalla de dinero del embudo** y **no dice el trato**. D31 pide la regla **en el
  cotizador**, y este panel **se llama «Cotizador»** en su propio `eyebrow`.
- **Por qué la nota sola no bastaba.** Un total rotulado «Te pagamos» **con** una nota que dice que se
  descuenta el envío es **peor** que cualquiera de los dos solos: el rótulo afirma un depósito y la nota lo
  desmiente en el mismo bloque. El vendedor se queda con el número grande.
- **Dónde va la nota, exactamente:** en el **cuerpo del panel**, después del bloque de dinero (o del estado
  vacío) y **antes** del enlace «Continuar mi cotización». **⚠ Fuera del bloque `withTrust`**, que **no se
  renderiza en móvil** (`withTrust={false}` en la sección de 390px). Una regla de dinero que solo existe en
  escritorio **no es una regla**.
- **Se renderiza siempre**, con cero líneas y con líneas, igual que en el carrito: la nota **no depende de
  ningún dato** (§23.3k) y por tanto **no se esqueletiza, no aparece, no desaparece y no se mueve**.
- El rótulo se pinta con `.eyebrow` (mono, versalitas) en el teaser y en el carrito, y en sentence-case en
  el resumen del paso de crear. **Es el mismo string**; la caja alta la pone el CSS, **nunca el catálogo**.

**(b) `buylist.trustShipping` — RETIRADA. El remanente no es el texto final, y tampoco necesita redacción
propia: necesita desaparecer.**

El frontend hizo lo correcto al borrar la cláusula falsa y **no inventar copy**. Lo que sobrevivió —*«Si una
carta se rechaza por no estar en NM, la devolución corre por tu cuenta (7 días).»*— no se queda, por **dos**
razones independientes, y cualquiera de las dos bastaría:

1. **Ya está dicho, dos párrafos arriba, en la misma página y con más detalle.** `buylist.nmOnlyBody`:
   *«Si al recibir y verificar la carta no está en NM, **no se compra**: se devuelve si deseas (**a tu
   costo, 7 días**) o se considera abandonada a los 30 días.»* El remanente es un **eco degradado** de su
   propio vecino: dice menos y ocupa un párrafo. Nadie lo habría escrito así a propósito — que es
   exactamente lo que el encargo sospechaba.
2. **Y su hueco original —quién pone el envío— NO puede llenarse ahí.** Ese bloque es
   `text-[13px] text-muted`. §23.3c es explícita: la regla de D16 va **en tinta, `text-sm`, nunca `muted`**,
   porque D31 la quiere *«al mismo nivel visual que los montos»* y **no en letra chica**. Reescribir
   `trustShipping` para que contara el trato nuevo habría **cumplido la letra y roto la norma**: la regla
   más importante del ciclo, degradada a gris de 13px, debajo de todo.

**Qué queda en su lugar** (dos movimientos, **cero strings nuevos**):

- **La nota de servicio sube a la cabecera de `/buylist`** (§23.3g, fila **1-bis**): `BuylistShippingNote`
  justo debajo de `payAfterReceipt`, en **tinta `text-sm`**, sin `rule-note`, sin caja. **Motivo decisivo:
  en móvil el carrito es un drawer cerrado**, así que hoy un vendedor puede recorrer `/buylist` entera —
  hero, bounties, binder, políticas, guía de empaque— **sin leer nunca la regla del envío**. La cabecera es
  el sitio donde ya viven los hechos del trato y es lo primero que se ve.
- **El bloque de confianza del pie baja a dos párrafos**: `trustPayment` y `trustValidity` (este último
  reescrito, §23.14.4). El bloque **no pierde información**: la del envío subió y la del NM ya estaba
  arriba.

> **⚠ CORREGIDO (v2.3.8) — aquí dije que la repetición era aceptable. Vista en pantalla, no lo es.**
> A 1280px `/buylist` muestra **dos párrafos idénticos de cuatro líneas** a la vez (cabecera + panel fijo
> del carrito). Autoricé cada instancia **por separado** y **nunca miré las dos juntas**, que es el error
> clásico de especificar por reglas y no por pantallas. La regla nueva está en **§23.3g-bis: EXACTAMENTE
> UNA nota visible por pantalla**, y la resuelve por construcción.
> *Lo que sí sigue en pie de lo que escribí: **dos redacciones distintas de la misma regla** sería un
> defecto mucho peor que dos copias idénticas. La corrección va de **cuántas se ven**, no de cuál es el
> texto — que sigue siendo uno solo.*

---

#### 23.14.3 La regla de «la cadena que viaja sola», con su frontera dibujada

§23.12 la enunció para los correos. Se **eleva a regla de sistema** y se le pone el límite que faltaba,
porque sin límite habría obligado a meter la resta en cadenas donde no cabe ni hace falta:

> **Toda cadena que afirme que el envío corre por nuestra cuenta debe decir, en la misma cadena, que su
> costo se descuenta de lo que se le paga al vendedor — en ES y en EN.**
> Aplica a: asuntos, preheaders, notificaciones, la nota del cotizador, **el paso 4 de la guía de empaque**
> y cualquier `title`/`aria-label` que resuma el trato.

| Caso | ¿Tiene que llevar la resta? | Por qué |
|---|---|---|
| «Nosotros ponemos la guía de envío» (nota del cotizador, teaser, cabecera) | **Sí** | Es una **afirmación sobre quién paga**. Sola, promete un beneficio y esconde su costo |
| **Paso 4 de la guía de empaque** | **Sí** | Viaja en un **modal sin dinero al lado** y dentro de **dos correos** (§P). Por eso su cuerpo lleva «y su costo se descuenta de tu pago» aunque sea una celda de 13px |
| `offer.guideParagraph` («al aceptar te mandamos la guía…») | **No** | La **tabla de los tres montos está en la misma pantalla**. La aritmética ya está a la vista (§23.12) |
| **«Primero aceptas la oferta y después te llega la guía»** (`buylist.created`, §23.14.4) | **No** | Es una **secuencia**, no una afirmación de coste: no dice quién paga, no promete nada y no se puede leer como beneficio. **La regla muerde sobre las afirmaciones de coste, no sobre la logística** |

**Y su recíproca, que es la que falló aquí:** *ninguna cadena puede afirmar que **el vendedor** pone,
compra, asegura o cubre el envío hacia nosotros.* **Cero excepciones** — la única cosa que sigue siendo
suya es **la devolución de una carta rechazada por no ser NM (7 días)**, que **no cambió** y que se dice
en **`nmOnlyBody`** y en la **`intro`** de la guía de empaque, en ningún otro sitio.

---

#### 23.14.4 Lo que el barrido encontró de más (fuera de los tres reportados)

> **Estas cuatro no salen de D16/D31 sino de D2/D9 y de §P.4.** Se resuelven aquí porque **dos de ellas
> son párrafos hermanos de los textos que sí me tocaba tocar** (`trustValidity` comparte `<div>` con
> `trustShipping`) y dejarlas habría producido un bloque donde **el párrafo nuevo dice una cosa y el de
> abajo la contraria** — exactamente el defecto que este pase viene a cerrar.

**(a) `buylist.estimateNote` — contradicción viva de dinero (bloque de dinero del carrito).**

- **Dice hoy:** *«El total es un ESTIMADO. **El monto final lo confirma la plataforma cuando recibimos y
  verificamos tus cartas.**»* / "…The final amount is confirmed by the platform when we receive and verify
  your cards."
- **Por qué está mal, y es grave:** señala **el momento equivocado** e implica **repreciado**. Bajo
  **D2** el precio ofertado es **vinculante desde que sale el correo** y bajo **D9** *«verificar tiene solo
  dos desenlaces: llega en NM y se paga lo ofertado, o no llega en NM y se rechaza»*. Este texto le dice al
  vendedor que **el número puede moverse después de que él ya mandó las cartas** — que es la ansiedad exacta
  que §23 existe para matar, y además **regala** la mejor promesa del producto.
- **Lo que sí es cierto y no estaba dicho:** el total es indicativo **porque los precios se mueven** *y*
  **porque puede que no compremos todas las líneas** (§23.3a.2 identificó justamente ese cherry-pick como
  la razón por la que un neto en el cotizador sería optimista). Decirlo es lo honesto.

| | ES | EN |
|---|---|---|
| **Nuevo** | El total es un ESTIMADO: los precios se mueven y puede que no compremos todas las líneas. Lo firme te lo mandamos en la oferta. | The total is an ESTIMATE: prices move and we may not buy every line. The firm amount comes to you in the offer. |

*No cierra con «antes de que aceptes» a propósito: `shippingNote` está en el mismo bloque y ya termina así.
Dos frases con la misma cola se leen como una plantilla, no como dos hechos.*

**(b) `buylist.trustValidity` — la misma contradicción, en dos sitios.** Se pinta en el pie de `/buylist`
**y** en el resumen del paso de crear. Dice *«el monto final se confirma con los precios vigentes al
verificar tus cartas»*: mismo error que (a).

| | ES | EN |
|---|---|---|
| **Nuevo** | La cotización es un estimado con los precios de hoy. El precio vinculante es el de la oferta que te mandamos por correo, y ese precio ya no se mueve cuando recibimos tus cartas. | The quote is an estimate at today's prices. The binding price is the one in the offer we email you, and that price does not move when we receive your cards. |

> **⚠ Precisión deliberada: se dice «el PRECIO no se mueve», no «el total no cambia».** El total **sí**
> puede bajar, porque **una carta que no llegue en NM no se compra ni se paga** (D1/D9). Escribir «el monto
> no cambia» sería una promesa falsa del otro lado. Lo que nunca se mueve es **el precio unitario
> ofertado**, y eso es lo que dice la frase. La condición NM está a la vista en `nmOnlyBody`, arriba.

**(c) `buylist.created` — contradicción viva con D16: invita a mandar el paquete.**

- **Dice hoy:** *«¡Solicitud creada! **Te avisaremos cuando recibamos tu carta.**»* / "…We'll let you know
  when we receive your card."
- **Por qué está mal:** se pinta **justo después de crear la solicitud**, que es el momento exacto en que
  el vendedor decide qué hacer con sus cartas. «Cuando recibamos tu carta» **se lee como una instrucción de
  enviarla** y **se salta el ciclo entero** (oferta → aceptación → etiqueta). Un vendedor que la obedezca
  manda un paquete **sin nuestra guía**, y `PROJECT.md` es tajante: *«si aun así manda algo por su cuenta,
  esa pieza **no está comprada**»*. Es la única de las siete que puede terminar en **cartas de valor
  viajando fuera del trato**.

| | ES | EN |
|---|---|---|
| **Nuevo** | ¡Solicitud creada! Te mandaremos una oferta por correo. No mandes tus cartas todavía: primero aceptas la oferta y después te llega la guía. | Request created! We'll email you an offer. Don't ship your cards yet: first you accept the offer, then the label reaches you. |

- **Sin plazos.** No dice «en 7 días hábiles»: ese reloj es **nuestro**, y §23.4.3 ya razona que anunciarle
  al vendedor un plazo que depende de nuestra carga de trabajo no le sirve de nada.
- **Sin cifras** y **sin la resta** — es una secuencia, no una afirmación de coste (§23.14.3).

**(d) `buylist.subtitle` y `home.sellBody` — mejora OPCIONAL, no contradicción. Decide PO.**

Ambas dicen **«Tú envías, nosotros autenticamos y pagamos»**. Estrictamente **sigue siendo cierto** (el
vendedor lleva el paquete al mostrador), así que **no se marca como contradicción**. Pero en el `h1` de
`/buylist` la frase queda **a dos líneas** de «Nosotros ponemos la guía de envío», y en una estructura de
tres tiempos *«tú X, nosotros Y y Z»* el primer tiempo se lee como **su parte del gasto** — o sea que
**nos quita el mejor argumento del producto** y siembra la duda que la nota tiene que deshacer.

| Clave | ES propuesto | EN propuesto |
|---|---|---|
| `buylist.subtitle` | Cotizamos tu lista con el valor de mercado del día. Nosotros autenticamos y te pagamos por SPEI. | We quote your list at the day's market value. We authenticate and pay you by bank transfer. |
| `home.sellBody` | Cotizamos tu lista con el valor de mercado del día. Nosotros autenticamos y pagamos. | We quote your list at the day's market value. We authenticate and pay. |

> **Por qué NO se propone «Te mandamos la guía, autenticamos y pagamos»**, que sería la versión lucida: es
> una cadena que **viaja sola** y diría «ponemos la guía» **sin** «y se descuenta» ⇒ §23.14.3 lo prohíbe, y
> la resta **no cabe** en un subtítulo sin arruinarlo. **La regla tiene dientes también contra el copy que
> nos favorece**, y se registra aquí como ejemplo. La salida correcta es **quitar el reparto**, no
> reclamar el mérito a medias.

---

#### 23.14.5 Lo que NO se toca (lista cerrada, para que nadie lo «arregle» de más)

| Clave / familia | Por qué se queda | ⚠ |
|---|---|---|
| `home.bounties.wePay` · `buylist.bounties.wePay` («Pagamos» / "We pay") | Es un **precio por carta**, no una suma: nombra una **tarifa**, y el envío se descuenta **por solicitud** (§23.3c-bis) | Si alguien las «corrige» a `cardsValue`, la teja de bounty deja de decir qué hace y el barrido habrá causado un daño nuevo |
| `buylist.nmOnlyTitle` / `nmOnlyBody` | La devolución de una carta rechazada por no ser NM **sigue corriendo por cuenta del vendedor (7 días)**. **D16 no la tocó** | Es el **único** «a tu costo» legítimo del flujo del vendedor. Ver §23.14.3 |
| `buylist.payAfterReceipt` · `buylist.cartFooterNote` · `buylist.trustPayment` | *«El pago se realiza después de recibir y verificar tus cartas»* **sigue siendo cierto**: el pago ocurre tras la verificación; lo que **no** ocurre es **repreciar** | No confundir *cuándo se paga* (cierto) con *cuándo se fija el monto* (la oferta) — la distinción que arregla (a) y (b) |
| `home.bounties.subtitle` · `buylist.bounties.subtitle` | Misma frase, mismo motivo | — |
| `withdrawals.*`, `checkout.*`, `shipmentStage.*` (envío del **comprador**) | Es **el otro eje de dinero**: ahí el comprador **sí** paga su envío y su seguro. D16 gobierna **el envío del vendedor hacia nosotros**, nada más | `withdrawals.shippingFee` («Tarifa de envío (con seguro)») es **legítima**; un `grep` de «envío» que la marque está mal calibrado |
| `grading.*` («el gradeo y su costo corren por tu cuenta») | Es el **gancho de grading** (§22), otro dominio y otra decisión | — |
| `safeShipping.step1*` / `step2*` / `understood` | Empaque puro; además **AC 34 exige** las palabras *sleeve/funda* y *top loader* | Si se reescriben «por consistencia», se puede romper AC 34 |

---

#### 23.14.6 Verificación (QA visual · barato y `grep`-able)

> **Convención de las reglas de esta sección (v2.3.4, tras un falso positivo real).** Una regla `grep`
> **nunca se escribe como «cero coincidencias» sobre un catálogo entero**. Se escribe de una de estas dos
> formas, y las dos son a prueba de falsos positivos:
> **(i) aserción positiva** —*«este rótulo resuelve a esta clave y a ninguna otra»*— que además atrapa
> variantes que nadie previó; o **(ii) patrón acotado por el ROL de la clave** (rótulo de monto, asunto de
> correo…) **+ la lista de supervivientes esperados**, como hace la regla 1 con `grading.*`.
> **Motivo:** *una regla que da falsos positivos se deja de correr*, y una regla que no se corre no protege
> nada. Si un `grep` marca una cadena que este documento declara normativa, **el defecto es del `grep`**.

1. **`grep` de la afirmación prohibida** en `messages/{es,en}.json`: `cubres`, `tú cubres`, `por tu cuenta`,
   `a tu costo`, `you cover`, `at your cost`, `on you`. **Toda coincidencia superviviente debe estar en**
   `nmOnlyBody`, `safeShipping.intro`, `grading.*` o el eje del comprador. **Cualquier otra es el bug.**
2. **La promesa de depósito sobre una suma — ⚠ REGLA RECALIBRADA (v2.3.4).**
   > **La versión anterior de esta regla estaba mal y hay que decir por qué.** Pedía *«`grep` de `Te
   > pagamos` / `We pay you` ⇒ **cero coincidencias** en `buylist.quote.*`»*, y eso marca
   > **`buylist.quote.shippingNote`**, que dice «se descuenta siempre de **lo que te pagamos**» / "deducted
   > from **what we pay you**" **en los dos idiomas**. Es decir: **marcaba la cadena normativa que §23.3d
   > acababa de bendecir**, y que este documento **cita literal en su propio mock-up** de §23.3c. También
   > marcaba `buylist.subtitle` ES («te pagamos por SPEI»), que es prosa.
   > **El defecto no es el patrón sino la FORMA de la regla:** usaba un **absoluto** («cero coincidencias»)
   > donde el criterio real es **fino** —*rótulo que promete depósito **sobre una suma***—, y
   > `shippingNote` **no es un rótulo y no cuelga de una suma**: es prosa explicativa, y «lo que te
   > pagamos» es justo **el referente del descuento** (movimiento 2 de §23.3d). *La regla de QA se acota al
   > copy; **el copy nunca se retuerce para satisfacer un `grep`**.*
   > **Y la forma correcta ya estaba escrita una regla más arriba:** la 1 **nombra a sus supervivientes
   > esperados** (`nmOnlyBody`, `grading.*`…) en vez de exigir cero — por eso la 1 **sí** aguanta que
   > `grading.*` diga «on you». Esta se reescribe con ese mismo patrón, más una aserción positiva.

   **2a — Aserción POSITIVA (whitelist; es la que no puede dar falsos positivos, y la que de verdad
   protege la regla).** En las **tres** superficies de cotizador —teaser del home, carrito/panel fijo y
   resumen del paso de crear—, el **rótulo hermano de la cifra total** resuelve a
   **`buylist.quote.money.cardsValue` y a ninguna otra clave**. Es una lista blanca de **una** entrada: si
   mañana aparece un rótulo nuevo sobre una suma, **falla por construcción**, sin depender de que alguien
   haya previsto el verbo que use.
   **2b — El `grep` negativo, ACOTADO A CLAVES DE RÓTULO** (nunca sobre el catálogo entero): buscar
   `pagamos`, `recibes`, `ganas`, `depositamos`, `we pay`, `you get`, `you'd receive`, `payout`
   **solo en las claves que se pintan como rótulo de un monto** — es decir, `buylist.quote.money.*` y la
   clave del rótulo del total del teaser. **Ahí sí: cero coincidencias.**
   **2c — Supervivientes ESPERADOS fuera de ese ámbito** (si el `grep` se corre ancho, estas tres salen y
   **son correctas**; marcarlas es señal de que el `grep` está mal acotado, igual que con
   `withdrawals.shippingFee` en §23.14.5):

   | Coincidencia legítima | Por qué se queda |
   |---|---|
   | **`buylist.quote.shippingNote`** (ES «lo que te pagamos» · EN "what we pay you") | **Normativa e intocable** (§23.3d). Es **prosa**, no rótulo, y la frase **necesita** ese referente: sin él, «su costo se descuenta» no dice **de dónde** se descuenta |
   | `home.bounties.wePay` · `buylist.bounties.wePay` | **Precio por carta**, no una suma (§23.3c-bis) |
   | `buylist.subtitle` ES («te pagamos por SPEI») | **Prosa del `h1`**, no rótulo de monto. *(Si PO acepta la mejora opcional de §23.14.4d, desaparece sola; si no, **se queda y es correcta**.)* |

   > **Por qué se gasta tinta en esto:** *una regla de QA que da falsos positivos se deja de correr*, y en
   > cuanto se deja de correr **muere la distinción que protege** — que aquí es exactamente la que costó
   > dos rondas fijar: **rótulo vs. prosa, suma vs. tarifa unitaria**. Una regla que grita al ver la cadena
   > que el sistema acaba de bendecir **entrena a ignorarla**.
3. **Paridad estricta:** `home.quoter.wePay` y `buylist.trustShipping` **no existen en NINGUNO de los dos
   catálogos**. Una clave viva en un solo idioma es el modo típico en que un texto retirado revive.
   **v2.3.5:** lo mismo para `admin.m5.tabs.{por_recibir,ciclo,rechazadas}` ⇒ sustituidas por
   `{por_ofertar,con_vendedor,piezas_rechazadas}` (§23.8a).
3-bis. **Pestañas de M5 — aserción positiva (patrón (i) de la convención de arriba).** El mapa
   `estado → pestaña` es **total**: los **ONCE** valores de `SellRequestStatus` tienen pestaña —
   `cotizada` en **«Por ofertar»**, los **tres** del tramo (`ofertada`/`aceptada`/`en_transito`) en **«Con
   el vendedor»**, los **dos** de casa (`recibida`/`verificacion`) en «Verificando», `aprobada` en «Por
   pagar» y los **cuatro** terminales en «Cerradas» ⇒ **1+3+2+1+4 = 11**. *Un estado sin pestaña **no
   falla, no avisa y desaparece del back-office**: por eso la comprobación es una partición total, no un
   `grep`.*
   > **⚠ ERRATA CORREGIDA (v2.3.6) — aquí decía «los DIEZ valores», y el número importaba.** Son **once**
   > (`ARCHITECTURE`/contrato §Enums manda, y `SellRequestStatus` los lista). **El texto y la tabla de
   > §23.8a siempre repartieron once**; el que mentía era **el número suelto**. Y el origen es exactamente
   > la distinción de la nota de abajo: **§23.12 lista DIEZ claves bajo `status.sellRequest.*` y ahí el diez
   > es correcto**, porque `expirada` **se rotula por su motivo** (§23.1d) y no tiene clave en ese espacio.
   > **El diez viajó del sitio donde era cierto al sitio donde no lo es.**
   > **Por qué no era una errata cosmética:** el número vivía **dentro de una regla de verificación**, así
   > que un test escrito contra «diez» habría dejado **un estado sin comprobar** — y la regla existe
   > precisamente porque un estado sin pestaña **no falla ni avisa**. *Una regla de QA con el número mal
   > deja pasar justo el caso que vino a cazar.* Es la cuarta vez en este ciclo que el defecto es **un
   > nombre o un número que sobrevive a su significado**; la diferencia es que esta vez estaba **en el
   > detector**, no en el copy.
   Y una comprobación de lectura, barata: **la palabra «recibir/receive» no aparece en ninguna pestaña**, y
   **«Rechazadas» a secas tampoco** — si aparece, volvió la colisión con el estado `rechazada`.
4. **Guía de empaque, los dos montajes** (modal `columns=2` y sección inline `columns=4`), en ES y EN:
   el paso 4 dice **quién pone la etiqueta**, **que se descuenta** y **las tres prohibiciones**; **no**
   aparece ninguna forma de `asegura`/`insure` como instrucción al vendedor; el `intro` menciona **Near
   Mint**; los pasos 1 y 2 siguen diciendo **funda/sleeve** y **top loader** (AC 34).
5. **La palabra «guía» en `/buylist`:** el enlace, el título del modal y el `h2` inline dicen **«Cómo
   empacar tus cartas»**. La palabra «guía» **solo** aparece donde significa **la etiqueta**.
6. **Teaser del home, las DOS instancias** — ⚠ **REGLA AFINADA (v2.3.7): «presente» NO es el requisito;
   el requisito es VISIBLE.** En `lg` (columna del hero) **y** en 390px (sección propia,
   `withTrust={false}`), con **cero cartas** y con cartas, en ES y EN, el total se rotula **«Valor de tus
   cartas»** y la nota **se lee en pantalla**.
   > **⚠ RECTIFICACIÓN (v2.3.8) — el defecto que motivó esta afinación NO EXISTÍA.** En v2.3.7 escribí
   > aquí que *«a 390px la nota está en el DOM pero `hidden`»*. **Es falso y se corrige en el sitio**:
   > medido con navegador real, **hay una nota visible en los dos anchos** y **§23.14.2a estaba cumplida
   > desde el primer día**. Lo que fallaba era **la medición**: el home monta el panel del cotizador **dos
   > veces** —columna del hero y sección móvil, §23.3g fila 0— **con el mismo identificador**, y la
   > comprobación cogía **la copia de escritorio**, que a 390px está oculta *por diseño*.
   > **La regla afinada se queda igual y sigue valiendo** (visibilidad efectiva, no presencia en el DOM),
   > pero **no hay nada que arreglar en la pantalla**. Y la afinación gana una segunda mitad, que es la que
   > de verdad faltaba: **el diseño MANDA dos montajes**, así que **una comprobación que no desambigüe cuál
   > mira no está midiendo la pantalla, está midiendo un nodo cualquiera**. Se verifica **la instancia
   > visible en ese viewport**, nunca «la primera que aparezca».
   > *Lección, y me toca a mí por partida doble: acepté un hallazgo sin pedir cómo se había medido, y lo
   > escribí en el documento como hecho. **Un diagnóstico falso en la fuente de verdad se propaga igual que
   > un nombre falso** — que es justo lo que esta sección persigue. La corrección se deja **visible**, no
   > se borra.*
   **Si a algún ancho no se ve ninguna nota, es el bug** (§23.14.2a).
7. **`/buylist` — la nota se ve EXACTAMENTE UNA VEZ, a todos los anchos (§23.3g-bis, v2.3.8).**
   Contar los nodos **visibles** de `BuylistShippingNote` ⇒ **1**, ni 0 ni 2:
   　(7.1) **390px, drawer cerrado** ⇒ la de **la cabecera**. Recorrer la página entera y confirmar que la
   regla del envío **se lee sin abrir el carrito**.
   　(7.2) **390px, drawer abierto** ⇒ la del **bloque de dinero**.
   　(7.3) **1280px** (panel fijo lateral) ⇒ la del **bloque de dinero**, y **la cabecera NO la monta**.
   *Antes de v2.3.8 este caso daba **2** y nadie lo había mirado, porque cada instancia estaba autorizada
   en una sección distinta.*
8. **Líneas sin precio — el carrito explica su propia aritmética (§23.3h / §23.3f-bis, v2.3.8).**
   Con un carrito de **muchas** líneas en `precio_pendiente`, en ES y EN:
   　(8.1) La explicación aparece **UNA sola vez**, en el bloque de dinero, con el **conteo** interpolado —
   **no** una vez por ítem. Cada línea lleva su versalita **`SIN PRECIO`** y **ningún `MX$ 0.00`**.
   　(8.2) La nota dice **qué pasa con esas cartas** («las cotizamos a mano y te las incluimos en la
   oferta»). *Sin esa frase el vendedor las borra, que es el peor desenlace posible de esta pantalla.*
   　(8.3) **Con faltante + pendientes**, el consejo es **«Agrega una carta que ya tenga precio»**, nunca
   «Agrega otra carta». **Sin** pendientes, sigue siendo «Agrega otra carta».
   　(8.4) **Con TODAS las líneas sin precio**: el total **no es `MX$ 0.00`** —es la versalita— y la
   pantalla **explica por qué**. *Este es el caso exacto que hizo que un test E2E concluyera que el
   cotizador no sumaba.*
   　(8.5) El bloque sigue teniendo **exactamente un monto** (más faltante y mínimo si aplican): el conteo
   de cartas **no es un monto** y no introduce uno.
8. **D43 sigue intacta tras este pase:** repetir la prueba **(l.1)** y **(l.6)** de §23.13.8 sobre las
   cadenas **nuevas** — ninguna contiene un monto, un rango ni un porcentaje de envío; la **primera**
   aparición de la tarifa en todo el ciclo sigue siendo **el correo 1**.
9. **El aviso de solicitud creada** no contiene «recibamos tu carta» ni ningún plazo, y **sí** contiene la
   instrucción de **no enviar todavía**.
10. **Bloque de dinero del carrito:** `estimateNote` y `shippingNote` conviven **sin decir lo mismo** y
    **sin terminar igual**; ninguna de las dos afirma que el monto se confirma al verificar.

---

#### 23.14.7 Notas a otros roles (derivadas de este barrido)

1. **PO — ratificar siete textos, y tres son sensibles.** Todo §23.14.1 y §23.14.4 es **copy del trato**.
   Los tres que conviene mirar con calma: **(a)** `safeShipping.step4Body`, porque **sustituye una
   instrucción que le costaba dinero al vendedor** y ahora afirma la resta en una celda pequeña; **(b)**
   `estimateNote`, porque **admite en voz alta que puede que no compremos todas las líneas** —es honesto y
   está respaldado por §23.3a.2, pero es una frase que un negocio puede querer matizar—; **(c)**
   `buylist.created`, porque **le dice explícitamente al vendedor que no mande nada todavía**.
   El punto **(d)** de §23.14.4 (`subtitle`/`sellBody`) es **opcional** y no bloquea nada.
2. **✅ RESUELTA (v2.3.3) — `buylist.adjust.*` NO se retira: sobrevive a una COHORTE.**
   Yo lo planteé como *«¿vive o muere?»* y **la pregunta estaba mal formulada**. El arquitecto la corrigió:
   para el **ciclo nuevo** ese flujo es **inalcanzable por construcción** (D9/D30), pero **las solicitudes
   heredadas que estén en vuelo el día del cut-over lo necesitan** — retirar ese copy ese día dejaría a un
   vendedor **sin poder cobrar algo que ya le prometimos**.
   **Lo que aprendo y dejo escrito como regla de este documento:** *el copy de un flujo que se apaga no se
   retira cuando el flujo deja de crearse, sino cuando **la última instancia viva termina**.* Un catálogo
   de i18n **sirve a los datos que existen**, no al diseño vigente; borrar una clave es una **migración de
   datos disfrazada de limpieza de texto**. Esa es la diferencia con las claves de §23.14: `wePay` y
   `trustShipping` se retiran **hoy** porque **nada las necesita** —no hay cohorte detrás de un rótulo—,
   mientras que `adjust.*` tiene registros esperándola.
   **Estado:** se queda **tal cual, sin reescribir**, y **frontend ya tiene instrucción de no tocarla**. Su
   retiro va **con gate, no con fecha** (depende de cuándo se haga el cut-over), y el gate lo expresa el
   arquitecto. **Este documento no le pone plazo.**
3. **✅ CERRADA (v2.3.3) — el conteo de correos: son CINCO y «3c» no existe.**
   Manda `ARCHITECTURE §4.39(n)`, y **el argumento es de hechos, no de jerarquía documental**: la
   cancelación deja la solicitud **`cotizada` y viva**, mientras 3a y 3b dejan **terminales**. **No es una
   variante del 3 — es otro desenlace.** §23 queda alineada: §23.4 dice **CINCO**, la cancelación es
   **§23.4.4-bis / correo 5**, y **el texto no cambió una letra** (estaba bien; era renumerar).
   **Lo que sí era un defecto real y no el número: el prefijo de la clave.** ~~`expiry.cancelledByUs.*`~~ ⇒
   **`offerCancelled.*`** (§23.12). *Un número mal puesto se nota; **un prefijo que miente se propaga**,
   porque no se lee — se autocompleta.* **Frontend/backend: el nombre viejo deja de existir, sin
   coexistencia**, y el test de paridad debe pasar con la clave **ausente en los dos idiomas**.
   **Y la lección que me llevo, porque es de método:** agrupé dos hechos opuestos **porque compartían
   `status`**. Es literalmente lo que **R3** prohíbe (*un correo por HECHO, no por camino*), aplicado al
   revés de como yo mismo lo escribí — la misma trampa que §23.4.6 documenta para `expirada`, en la que caí
   **una subsección más arriba**.
4. **Frontend — qué hay que tocar, y es poco.** **Cero componentes nuevos.** (i) `SafeShippingGuide`: solo
   copy (§7.13 reescrita para que el componente no vuelva a contar el trato viejo). (ii) `HomeQuoterPanel`:
   cambiar el rótulo a la clave compartida y montar `BuylistShippingNote` **en el cuerpo del panel, fuera
   de `withTrust`**. (iii) `BuylistView`: montar `BuylistShippingNote` bajo `payAfterReceipt` y **borrar el
   `<p>` de `trustShipping`** (el bloque queda con dos párrafos). (iv) `SellCartContents`: solo copy.
   **Ninguna clave nueva se crea**; se **retiran dos** (`home.quoter.wePay`, `buylist.trustShipping`) y se
   **reutilizan dos que ya existen** (`buylist.quote.money.cardsValue`, `buylist.quote.shippingNote`).
5. **Backend — recordatorio, no petición.** `PROJECT.md` §H manda repetir la guía de empaque **en el correo
   de aceptación y en el de la etiqueta**. Cuando esas plantillas se escriban, **el paso 4 va con su
   resta** (§23.14.3): ahí la cadena viaja **sin** ninguna tabla de montos al lado.
7. **✅ Frontend — ALCANCE CONFIRMADO para el siguiente pase (v2.3.8).** Sí, adelante, y es **pequeño**:
   **(a)** implementar por fin `buylist.quote.pendingLine.{label,note}` — pendiente desde v2.3 — con la
   `note` **reescrita**: **una sola vez en el bloque de dinero**, con `{count}`, en **tinta `text-sm`**, y
   **sin** la línea repetida por ítem (§23.3h); **(b)** la clave nueva
   `buylist.quote.minimum.addPricedCard`, que **sustituye a `addAnother` solo cuando hay líneas sin
   precio** (§23.3f-bis); **(c)** montar la nota del envío **condicionada al layout** para que se vea
   **exactamente una vez** (§23.3g-bis) — la cabecera **no se monta** cuando el carrito es panel fijo.
   **Cero componentes nuevos.** `BuylistShippingNote` ya existe; lo que cambia es **dónde se monta**.
   **Y una petición de testabilidad, que es tuya y sale del falso positivo de v2.3.7:** el home monta el
   panel del cotizador **dos veces por diseño**; **dales identificadores distinguibles**. No es cosmético —
   con el mismo id, cualquier comprobación futura vuelve a medir el nodo equivocado, y esa fue la causa de
   que yo escribiera un defecto inexistente en este documento.
6. **Frontend — pestañas de M5 (v2.3.5, §23.8a).** Tres rótulos y tres claves:
   `por_recibir`⇒`por_ofertar`, `ciclo`⇒`con_vendedor`, `rechazadas`⇒`piezas_rechazadas`, con las viejas
   **borradas de los dos catálogos**. **Tu estructura se ratifica sin cambios** —una pestaña para el tramo
   y `aceptada` fuera de todo rótulo de «en camino»—: lo que cambia es el texto, no el mapa. El
   discriminante `M5OpTab` y `M5_STATUS_TAB` son **tuyos**; la recomendación es que **acompañen el
   renombre**, porque ese mapa es exactamente lo que alguien lee para decidir dónde vive el próximo estado
   nuevo — y un `por_recibir` ahí dentro seguirá diciendo «esto es la cola de paquetes» mucho después de
   que la pestaña diga otra cosa. **Y gracias por dejar el hueco declarado en vez de taparlo en silencio:**
   así se pudo arreglar el rótulo *y* la sección que faltaba, en vez de solo uno de los dos.
