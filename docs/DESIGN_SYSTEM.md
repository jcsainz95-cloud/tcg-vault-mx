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
> **Revisión del humano (2026-08-31), incorporada — la burbuja entra también al carrusel «Piezas
> destacadas del catálogo» → nueva §22.6b.** El gancho pasa de **tres** superficies a **cuatro**: la
> vitrina «Joyas para gradear» **se conserva tal cual** y el carrusel del home **suma** la cifra. No es un
> copiar-pegar: `FeaturedCarousel` **no usa `CatalogTile`** —tiene teja propia, con dos anatomías (una
> grande de 400px y una chica de 268px) y **sin CTA que absorba la altura**—, así que §22.6b define dónde
> entra la burbuja en cada una, con qué forma de copy y cómo se comporta la retícula en el **caso
> disparejo**, que aquí es **el normal**: el carrusel ordena por **precio descendente** y el gate de ROI
> castiga precisamente a las caras, así que lo esperable es **cero o una-dos burbujas entre ocho**.
> Decisión de fondo: **la numeración mono roja `01 · 02 · 03` (§20.3) y la burbuja no coexisten** — si el
> carrusel pinta al menos una cifra, la numeración desaparece **de toda la pista** (no tile a tile): junto
> a un monto, un número de dos dígitos se lee como *ranking de oportunidades*, que es la afirmación que §O
> prohíbe, y sería un **tercer rojo** en una teja de 160px. **Cero tokens nuevos, cero claves i18n nuevas,
> cero componentes nuevos**: el badge de §22.5 se reutiliza con un `surface` de tres valores enumerados
> que solo elige **qué forma de copy ya ratificada** se usa y **en qué breakpoint**, y que **no puede**
> apagar el micro-aviso (R3 sigue intacta).
>
> **Añadido v2.3 (2026-08-31) — el gancho pasa a UN SOLO dial: los dos avisos de M10 → ver §22.13.**
> `ARCHITECTURE.md` §4.38(r) (rev v1.51-one-dial) colapsa los dos interruptores en `gradingHookEnabled`
> (M-46): el mismo dial gobierna **exhibición Y obtención**. Como el dial **ya no significa lo mismo en
> cada sentido**, el aviso de M10 pasa de **uno** a **dos**: **al encender**, publica una afirmación
> comercial **y** abre una llave de gasto (proveedor de paga, con un techo de créditos **que aún nadie ha
> medido**, y escribe precios) — `Banner warning`, con la consecuencia nueva en una entradilla que se lee
> aunque nadie lea el párrafo; **al apagar**, deja de publicar **y** deja de actualizar, con la **escalera
> de remedios** en el texto para que nadie apague la feature entera por una carta mal capturada —
> `Banner info`, **sin color**, porque el apagado es el botón de pánico y no puede dar miedo. **Ninguna
> superficie del storefront cambia** (§22.0–§22.12 intactas) y sigue **cero tokens nuevos, cero
> componentes nuevos y cero cambios de contrato**.
>
> **Corregido v2.4 (2026-08-31) — el aviso de encendido deja de afirmar la cifra de créditos como si
> estuviera medida: §22.13(d) y §22.13(d.1).** La v2.3 escribía *«hasta {credits} créditos al día
> ({maxCards} × {perCard} × {runs})»* **sin calificador**, y esa aritmética supone que el proveedor cobra
> **por carta en alcance**. No es lo que hace la petición: manda `fetchAllInSet=true`, o sea pide **el set
> entero**, y `ingestMaxCardsPerRun` acota las cartas **en alcance**, no las **devueltas**
> (`ARCHITECTURE.md` §4.38(r.3.1.0), **factor de amplificación `A`**). Si PPT cobra por carta devuelta, el
> techo real es `1 000 × A` — con 250 cartas en 20 sets de 200, **16 000/día** sobre una cuota de 20 000:
> la diferencia entre gastar el **5 %** y el **80 %** del plan del dueño. **Nadie lo ha medido**, y por eso
> el `COSTE MEDIDO` de §4.38(r.3.1.1) es la precondición viva del primer encendido (A-1). El copy pasa a
> **separar lo que sabemos** (cuántas cartas suyas entran) **de lo que no sabemos** (cómo factura el
> proveedor), dice que **la primera corrida lo mide**, y deja **previsto** el texto medido (`onMeasured`)
> para que publicar la cifra real sea **cambiar un selector, no reescribir el aviso**. Además: el máximo de
> `ingestMaxCardsPerRun` baja de **5 000 a 1 000** (I8, contrato **v1.51-a**) y **GU-9 quedó cerrada** (el
> dueño aceptó los 60 días de antigüedad del dato automático). Sigue **cero tokens nuevos, cero componentes
> nuevos y cero cambios de contrato** — con **una petición abierta** al arquitecto para poder encender
> `onMeasured` (§22.12 nº14).
>
> **Corregido v2.5 (2026-08-31) — dos punteros que apuntaban a la nada: §22.14 (nueva) y §22.13(d)/(e).**
> El aviso decía que el tope se edita **«en M2 · Catálogo y precios»** y que un grado entero se quita **«de
> "grados" en M2»**. Verificado contra el código: **M2 no dibuja ninguno de los dos** —
> `GradedEstimatesSection.tsx` pinta escalones, margen mínimo y frescura, y **read-only** los grados y los
> diales de confianza; `ingestMaxCardsPerRun` no aparece ni en la UI ni en el payload del `PUT`. Es la
> **misma familia** que el defecto de la v2.4: aquélla afirmaba un número no medido, ésta manda al dueño a
> un sitio donde **no puede hacer lo que la pantalla le dice**. Salidas: **el tope gana campo real en M2**
> (**§22.14**, con su aviso de créditos calificado según (d.1) y rango `[1, 1000]`) porque es **la única
> palanca que el aviso ofrece frente al gasto**; **el escalón de «grados» se retira** del aviso de apagado,
> porque no es accionable por el dueño y la propia regla de (e) ya decía que sólo se nombran los que sí lo
> son. Los otros tres punteros del texto **se verificaron y son ciertos**: `gancho-revision`,
> «margen mínimo» y «Actualizar precios ahora». Sigue **cero tokens nuevos, cero componentes nuevos y cero
> cambios de contrato**.
>
> **Añadido v2.6 (2026-08-31) — rotación automática del carrusel de destacadas (P-49) → ver §23.**
> Decisión **del dueño**, tomada tras oír la recomendación contraria del frontend. §23 no la re-litiga: la
> diseña, y **resuelve los tres hechos** que el frontend puso sobre la mesa. (1) La doctrina de §17.3
> —«el movimiento no decorativo se lee como carga»— se **matiza y se hace explícita**: se separan
> *movimiento-de-estado* (prohibido, sigue igual) de *movimiento-de-presentación* (permitido **solo** bajo
> las cuatro condiciones de §23.1, la primera de las cuales es que **nunca coexista con un skeleton**).
> (2) La nota 2 de §20.16 («el carrusel degrada a scroll-snap nativo sin JS») **se corrige**: el JS pasa a
> ser obligatorio **para rotar**, no para leer — el marcado servido sigue siendo una pista de scroll-snap
> estática y **ése es el estado inicial**, no un fallback (§23.8). (3) `prefers-reduced-motion` deja de
> depender de la regla CSS global (que solo anula duraciones y **no cubre** ni el scroll suave por JS ni un
> temporizador): la regla pasa a ser **no moverse en absoluto** y se verifica en la lógica del componente
> (§8.2, §23.7). La decisión que bloqueaba el código —**dónde vive el control de pausa**— se resuelve en
> **§23.4**: no es una tercera flecha, es un **conmutador mono pegado al H2** (el hueco estructural del
> kicker), en el mismo sitio en las tres anchuras. Regla dura heredada del frontend y **no negociable**:
> **rota la ventana, nunca el rol de teja líder** (§23.2). **Cero tokens nuevos, cero cambios de contrato,
> cero datos nuevos.**

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
- **Movimiento reducido — el alcance real de la regla global (precisión v2.6).** La regla de `globals.css`
  **solo anula duraciones y retardos de CSS**. Por construcción **no cubre** tres cosas, y las tres existen
  en este sistema: (a) el **scroll suave por JS** (`scrollTo/scrollBy({behavior:'smooth'})`, que no es una
  transición CSS), (b) los **temporizadores** (`setInterval`/`setTimeout` que desplazan algo solos) y
  (c) las animaciones por `requestAnimationFrame`. Por lo tanto:
  > **Regla: con `prefers-reduced-motion: reduce` la regla es NO MOVERSE EN ABSOLUTO, nunca «moverse más
  > lento».** Todo movimiento originado en JS se apaga en la **lógica del componente**, no en la hoja de
  > estilo: los temporizadores **no arrancan**, y el scroll iniciado por el usuario (flechas, «ir a») pasa a
  > `behavior: 'auto'` (salto instantáneo, que es movimiento **cero** y no una animación corta).
  - La preferencia se **escucha en vivo** (`matchMedia(...).addEventListener('change')`), no se lee una sola
    vez al montar: activarla en el sistema operativo debe detener el movimiento **en ese momento**, sin
    recargar.
  - Un control cuyo único trabajo es **detener** un movimiento que ya no ocurre **no se renderiza** (§23.7):
    un botón «Pausar» sobre contenido quieto es una afirmación falsa, y deshabilitado sería ruido.

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

#### 17.3a Movimiento — las dos categorías (matiz v2.6, obligatorio leer antes de animar nada)

Hasta la v2.5 este documento decía, en la práctica, **«en este sistema el movimiento se lee como carga»**
(aquí arriba: «no animar la mira como spinner»; §18.4: «feedback al agregar: SIN animación — una mira/pulso
animado se confunde con carga, §17.3»). Esa doctrina **sigue en pie**, pero estaba enunciada de más: prohíbe
por igual dos cosas que no son la misma. Se precisa, y la precisión es normativa.

| | **Movimiento-de-estado** (prohibido, sin excepciones) | **Movimiento-de-presentación** (permitido solo donde este documento lo autorice) |
|---|---|---|
| Qué comunica | «El sistema está trabajando / algo pasó» | «Aquí hay más contenido del que cabe» |
| Forma | En el sitio, sin desplazamiento: pulso, giro, brillo, latido, shimmer | **Traslación** de un contenedor a una posición de reposo |
| Final | **No tiene.** Es indefinido por definición: un spinner nunca resuelve | **Tiene.** Cada tramo termina en una composición quieta y legible |
| Ciclo de trabajo | Continuo (100 % del tiempo en marcha) | **Casi todo el tiempo quieto** (§23.3: ≈ 7 % en marcha) |
| Dónde vive | **Dentro** del elemento que carga o que responde (skeleton con la forma de la teja, spinner dentro del botón) | **Sobre el contenedor** ya resuelto; nunca dentro de un elemento que carga |
| Ejemplos | Mira animada como spinner, pulso al agregar al carrito, latido en un precio | La rotación del carrusel de destacadas (§23) |

**Las cuatro condiciones que hacen legítimo un movimiento-de-presentación.** Solo si se cumplen **las
cuatro**; si falla una, vuelve a ser movimiento prohibido:

1. **No coexiste jamás con un estado de carga.** No arranca hasta que el contenido está resuelto y las
   imágenes visibles han cargado (§23.3). Esto elimina de raíz la lectura «la página sigue trabajando»:
   no puede confundirse con carga algo que, por construcción, **nunca ocurre mientras hay carga**.
2. **Traslada, no palpita.** Desplazamiento lateral con destino y llegada. Prohibidos el fundido, el
   `cross-fade`, el zoom, el `scale` y cualquier cosa que no sea mover la ventana.
3. **Reposo dominante.** El elemento está quieto la inmensa mayoría del tiempo y cada reposo es una
   composición completa y legible (nada cortado por el borde izquierdo).
4. **Es interrumpible y el control está a la vista** (§23.4), y **no existe** con `prefers-reduced-motion`
   (§8.2, §23.7).

**Lo que NO cambia:** §18.4 sigue exactamente igual — el **feedback de una acción** (agregar al carrito,
guardar, cobrar) **no se anima nunca**. Ahí la pregunta del usuario es «¿funcionó?», y la ambigüedad se paga
con dinero; el canal sigue siendo el contador, el renglón `role="status"` y el estado del botón. Tampoco
cambia la prohibición de animar la mira. La marca no se mueve; el contenido, donde §23 lo autoriza, sí.

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
**+ conmutador de reproducción pegado al H2 (§23.4)** ⟷ link muted «Ver todo el catálogo» +
**flechas cuadradas**.

> ⚠️ **Desde 2026-08-31 (v2.6, P-49) esta pista ROTA SOLA.** La cadencia, el control de pausa, la máquina
> de estados, el final de pista, `prefers-reduced-motion` y el anuncio a lectores de pantalla están en
> **§23**, no aquí. Lo que §20.3 define abajo —flechas, pista, anatomía de las dos tejas, numeración— **no
> cambia ni un píxel**: §23 es aditiva. Las dos únicas costuras con esta sección son (a) el conmutador
> nuevo, que entra **por la izquierda**, pegado al H2, y **no toca el grupo de la derecha**, y (b) el
> reparto de responsabilidades del movimiento: **las flechas siguen moviendo una «página»** con su paso y
> su apagado en los extremos tal cual; **la rotación mueve exactamente una teja** (§23.3).

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
  - ⚠️ **Condicional desde 2026-08-31 (§22.6b-c):** si el carrusel muestra **alguna cifra del gancho de
    grading**, la numeración **desaparece de toda la pista** (no teja a teja). Junto a un monto, un ordinal
    se lee como *ranking de oportunidades* —lo que §O prohíbe— y sería un tercer elemento de acento en la
    teja. Sin cifras en la pista, §20.3 se aplica **tal cual**, numeración incluida.
- **Contenido:** solo piezas publicadas con precio (regla dura §7.1); la selección «destacadas» es
  curaduría o criterio de negocio, nunca placeholders.
- **Gancho de grading (§22.6b):** las tejas de este carrusel pueden llevar la **burbuja del estimado**
  («En PSA 10 vale ≈ MX$…») como **último bloque** de la teja, bajo una regla de 1px, con su **micro-aviso
  visible** obligatorio. La anatomía por teja (grande y chica), la forma del copy en cada ancho y el
  comportamiento de la pista cuando solo algunas tejas la llevan están **en §22.6b**, no aquí.

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
   (arbitrary values, no tokens); el estado del cotizador de la home se comparte con `/buylist` (§18),
   no se duplica.
   - **Corrección v2.6 (P-49) — lo que decía esta nota sobre el carrusel ya no es cierto tal cual.**
     Decía: *«el carrusel debe degradar a scroll-snap nativo sin JS»*. Con la rotación automática (§23) el
     JS pasa a ser **obligatorio para rotar**. Lo que ahora es cierto, y sustituye a la frase anterior:
     > **Sin JS (y antes de hidratar) el carrusel es una pista de scroll-snap nativa que NO rota**, con
     > sus ocho tejas completas y legibles y su desplazamiento táctil/de rueda intacto. Ese estado **no es
     > un fallback degradado: es el estado inicial** del componente, del que la rotación solo sale hacia
     > arriba, y solo tras hidratar. Lo que requiere JS es **rotar, las flechas y el conmutador de pausa**
     > — y las tres cosas **no se pintan si no funcionan** (§23.8), así que no queda ningún control muerto
     > ni ningún movimiento sin freno. El **contenido nunca depende del JS.**
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
> publicada en Compra, mostrar **cuánto valdría si se gradeara PSA 10 / PSA 9**, en **cuatro superficies**:
> **bloque de valores** junto al precio en la **ficha**, **badge** en la teja de Compra, **vitrina «Joyas
> para gradear»** en el home y —desde la revisión del 2026-08-31— el **carrusel «Piezas destacadas del
> catálogo»** del home (§22.6b). *(Donde el texto de §22 diga «las tres superficies» por arrastre, léase
> «las cuatro»: el carrusel es **rejilla** a todos los efectos —ver la nota de vocabulario de §22.0— y no
> relaja ninguna regla.)*
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
> **Revisión del humano (2026-08-31) — cuarta superficie: el carrusel «Piezas destacadas del catálogo».**
> La burbuja del gancho debe aparecer **también** en el carrusel del home, **conservando** la vitrina
> «Joyas para gradear»: las dos superficies **conviven**. No hay artboard nuevo; se resuelve en **§22.6b**
> con las piezas ya ratificadas. Lo que obliga a diseñar (y no a copiar) es que `FeaturedCarousel` tiene
> **teja propia**, no `CatalogTile`: dos anatomías distintas, sin CTA, sin `mt-auto`, y con la numeración
> mono roja de §20.3 encima. Las tres decisiones que salen de ahí —**dónde** entra la burbuja en cada
> teja, **cómo** cabe el micro-aviso en la chica y **qué pasa con la numeración**— viven en §22.6b.
>
> **Revisión del arquitecto (2026-08-31) — UN SOLO DIAL (`gradingHookEnabled`, M-46; `ARCHITECTURE.md`
> §4.38(r), rev v1.51-one-dial).** Los dos interruptores del gancho se colapsan en uno: el mismo dial
> gobierna **exhibición Y obtención**. El dueño tenía razón y la simplificación **no se disculpa** — el
> segundo interruptor **nunca se dibujó en el panel**, así que no era gobernable; se documenta y se sigue.
> Lo que sí cambia para el diseño es que **el dial ya no significa lo mismo en cada sentido**, y por eso el
> aviso de M10 pasa de **uno** a **dos**: **§22.13**. **Cero tokens nuevos, cero componentes nuevos, cero
> cambios de contrato**, y **ninguna superficie del storefront se toca**: §22.0–§22.12 y las reglas R1–R6
> quedan intactas. El colapso cambia **cuándo hay dato**, no cómo se pinta.
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

**Vocabulario — qué significa «rejilla» en §22 (nota de la revisión 2026-08-31).** R3, R4, R5 y R6 hablan
de dos categorías, no de tres componentes: **ficha** (superficie de **información**) y **rejilla**
(superficie de **promoción**). Desde el 2026-08-31 la rejilla tiene **tres** miembros y la regla se lee
igual en todos:

| Categoría | Superficies | Regla | Sección |
|---|---|---|---|
| **Ficha** (informa) | ficha de carta | pinta **lo que haya**; sin gate de ROI y sin la cota de magnitud | §22.3 |
| **Rejilla** (promociona) | teja de Compra · vitrina «Joyas para gradear» · **carrusel «Piezas destacadas»** | llega **ya filtrada** por el backend: gate de ROI **y** gate de confianza (R6) | §22.5 · §22.6 · **§22.6b** |

Donde el texto anterior de §22 diga «teja y vitrina» o «badge y vitrina», **léase «las tres superficies de
rejilla»**. El carrusel **no estrena ninguna excepción**: mismo dato (`gradingHighlight` del
`GroupedListingSummaryDTO`), mismo componente de badge, mismo micro-aviso obligatorio, misma nota al pie de
página, misma ausencia total ante cualquier hueco. Lo único propio del carrusel es **cómo entra la burbuja
en una teja con otra anatomía** (§22.6b).

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
   - **En páginas con varias superficies (el home, desde §22.6b), el regreso apunta a la PRIMERA que de
     verdad pintó cifra**, no a una fija: vitrina «Joyas para gradear» si existe; si no, el carrusel
     «Piezas destacadas». Un ancla fija a una sección que hoy puede no renderizarse deja el enlace de
     regreso apuntando a la nada — y ese es exactamente el caso normal del carrusel (§22.6b). La sección
     de destino lleva su `scroll-mt-[calc(var(--app-header-h,0px)+16px)]` como ya lo lleva la vitrina.
4. `prefers-reduced-motion`: sin `scroll-behavior: smooth` (§8.2).

**(b) La nota al pie — dónde vive y cómo se compone.**

**Una sola nota por página**, aunque la página muestre veinte cifras. Ubicación por superficie, siempre
**al final del contenido y antes del footer de marca** (§20.10) — el footer es un colofón, no un
contenedor de contenido:

| Página | La nota va… | Se renderiza si… |
|---|---|---|
| **Ficha de carta** | después de las pestañas Descripción/Condición | el bloque §22.3 se renderizó |
| **Compra (catálogo)** | después del paginador (§20.12) | **la página actual** muestra ≥ 1 badge; al paginar se reevalúa |
| **Home** | después de la última vitrina (antes de la banda de tinta del buylist) | el home muestra **≥ 1 cifra**, venga de **la vitrina «Joyas para gradear» o del carrusel «Piezas destacadas»** — la condición es la **unión** de ambas fuentes (§22.6b) |

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

**`surface` — el ÚNICO eje configurable del badge (añadido 2026-08-31 por §22.6b).** El mismo
`GradingEstimateBadge` sirve a las **tres superficies de rejilla**. Como sus tejas tienen anchos fijos
distintos, la forma larga del copy no cabe en todas al mismo breakpoint, y **el breakpoint de viewport no
predice el ancho de la teja** en el carrusel (la teja chica mide 160px hasta `lg`, aunque el viewport ya
sea `sm`). Se resuelve con **un prop enumerado de tres valores**, no con `className` ni con tamaños libres:

| `surface` | Dónde | Forma de la cifra | Tamaño de la cifra |
|---|---|---|---|
| `'grid'` *(default)* | teja de Compra (§22.5) y vitrina (§22.6) | `figureShort` `<sm` · **`figure`** `≥sm` | 11px · 12px `sm+` |
| `'featuredLead'` | teja **grande** del carrusel (§22.6b) | `figureShort` `<lg` · **`figure`** `≥lg` | 11px · 12px `lg+` |
| `'featuredRest'` | tejas **chicas** del carrusel (§22.6b) | **`figureShort` siempre** | 11px · 12px `lg+` |

- **Qué NO puede hacer este prop, y es normativo:** no apaga el micro-aviso, no lo acorta, no lo cambia de
  familia ni de tamaño, no cambia la regla superior, no suprime la llamada `*` y no baja ningún piso
  tipográfico (§22.4d). Lo único que elige es **cuál de las dos formas de copy ya ratificadas** se pinta y
  **a partir de qué breakpoint** — dos variantes que ya existían para móvil, no copy nuevo (§22.11).
- **Añadir un cuarto valor es una decisión de diseño, no de implementación.** Si aparece una superficie con
  otro ancho, se especifica aquí primero. Un `surface` libre —o un `figureForm` que acepte cualquier
  cosa— reabriría por la puerta de atrás la posibilidad de una variante «ligera» sin aviso, que es
  exactamente lo que R3 prohíbe.
- **La cifra no crece con la teja.** `featuredLead` vive en una teja de 400px con un precio de 25px y aun
  así mantiene **12px**: el tamaño del estimado es función de **su categoría** (dinero operativo, §22.1),
  no del tamaño del contenedor. Efecto colateral deseable: en la teja grande la distancia con el precio
  real es **mayor** que en Compra (25 vs 12px ≈ 2.1× frente a 17 vs 12px ≈ 1.4×), así que R2 se cumple con
  más margen, no con menos.

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
- **Sin numeración mono roja** — y desde 2026-08-31 esto **ya no es una regla local de la vitrina**. La
  redacción original citaba la numeración de §20.3 («Piezas destacadas») **por contraste**: allá es
  orientadora, aquí implicaría un *ranking de mejores oportunidades* —la afirmación que §O prohíbe— y sería
  un segundo rojo. Con la burbuja entrando también al carrusel, el contraste **se cae**: la misma
  numeración quedaría junto a la misma cifra. Se **generaliza a invariante del sistema** y se traslada a
  §22.6b: **numeración y cifra estimada no coexisten en ninguna superficie**. Para la vitrina no cambia
  nada (nunca tuvo números); para el carrusel, la numeración es ahora **condicional a nivel de pista**
  (§22.6b, «La numeración»).
- **«Ver todas»:** se omite **mientras el contrato no exponga un filtro/orden de elegibles** — no se enlaza
  a una vista que no filtra lo que promete. Solicitud anotada en §22.12.
- **Vacío / error:** la sección **no se renderiza** (ni encabezado, ni kicker, ni regla superior) y, si no
  queda ninguna cifra en el home, **tampoco se renderiza la nota al pie** de esa página (R3.3).
- **Carga — excepción ratificada a §8.1:** esta vitrina **no pinta skeleton**. Aparece ya resuelta o no
  aparece. Un skeleton reservaría espacio para una promesa comercial que puede no existir, y produciría el
  salto de layout exacto que R4 quiere evitar. Se prefiere **prefetch/SSR**; si se resuelve en cliente, el
  estado de carga es **nada**. (El resto de vitrinas conserva su skeleton de §18.6 sin cambios.)

### 22.6b Carrusel «Piezas destacadas del catálogo» — la cuarta superficie (revisión 2026-08-31)

> **Qué decidió el humano:** la burbuja del gancho («En PSA 10 vale ≈ MX$…») aparece **también** en el
> carrusel del home, **conservando** la vitrina «Joyas para gradear» (§22.6). Las dos superficies
> **conviven** en la misma página; ninguna sustituye a la otra.

**Por qué esto se diseña y no se copia.** `FeaturedCarousel` **no usa `CatalogTile`**: tiene teja propia,
con **dos anatomías** distintas —la **grande** (primera pieza) y las **chicas** (resto)—, **sin CTA**, sin
el `mt-auto` que en Compra absorbe las diferencias de altura, con la **numeración mono roja** de §20.3
encima y con **anchos fijos que no siguen al viewport** (la teja chica mide 160px aunque el viewport ya sea
`sm`). La rejilla de Compra y la vitrina sí comparten `CatalogTile` —por eso la vitrina heredó el badge sin
tocar nada—; el carrusel no. Cuatro cosas hay que resolver, y son las cuatro que siguen.

**El contexto que manda sobre todo lo demás: aquí el caso disparejo es el NORMAL.** El carrusel ordena por
**precio descendente** (las 8 más caras) y el **gate de ROI castiga precisamente a las caras**: cuanto más
alto el raw, más difícil que el estimado lo justifique (R6 exige además `psa10 > raw`). Lo esperable es
**cero burbujas**, y cuando las haya, **una o dos entre ocho**. Todo §22.6b está dimensionado para eso: la
pista tiene que verse **bien** con siete tejas sin cifra y una con cifra, y **igual de bien** con ocho sin
ninguna. La ausencia **no es un estado degradado** — es el estado por defecto de esta superficie.

**(a) Teja GRANDE (primera pieza, `surface="featuredLead"`).**

**Dónde va:** **debajo de toda la fila de datos**, como último bloque de la teja y **a todo el ancho de la
teja** (no dentro de la columna derecha del precio). Orden de lectura obligatorio, idéntico al de §22.5:
**nombre → set/# → acabado → precio real → stock → estimado → micro-aviso**. Separado por la misma **regla
de 1px `--color-border`** con `mt-2.5 pt-2.5`.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                  ARTE (400px de ancho)                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
Charizard ex                                   MX$ 4,800.00   ← serif 26px  ⟷  precio sans 25px
OBSIDIAN FLAMES · #223                            QUEDA 1     ← mono 11px muted ⟷ stock (§20.6)
Holofoil
──────────────────────────────────────────────────────────    ← border-t 1px --color-border (ancho completo)
En PSA 10 vale ≈ MX$ 29,000.00                                ← mono 12px tinta, tabular (`figure`, lg+)
Ilustrativo; no evaluamos esta carta.*                        ← sans 11px muted + llamada accent 13px
```

- **A todo el ancho y alineado a la izquierda, aunque el precio esté a la derecha.** La columna derecha del
  precio es estrecha y va `text-right`; meter ahí una cifra `nowrap` de ~275px la reventaría, y el
  micro-aviso —que es **prosa**— quedaría en bandera derecha a dos renglones, que se lee mal y contradice
  §22.4c (es prosa, no una etiqueta). Abajo y a la izquierda, bajo una regla que cruza los 400px, el bloque
  se lee como **pie de foto de la teja**, que es exactamente su rango.
- **La regla superior hace el trabajo de R2.** Es lo que dice «lo de abajo es otra cosa». Es la misma
  gramática de §20.8 y la misma que ya usa el badge de Compra: cero cajas, cero fondos, cero color.
- **Copy:** `figure` («En PSA 10 vale ≈ …») a partir de **`lg`**, donde la teja mide 400px;
  **`figureShort`** («PSA 10 ≈ …») por debajo, donde mide **236px** y la forma larga en EN («At PSA 10 it
  is worth ≈ MX$ 999,999.00», ~274px a 12px mono) **no cabe**. Nótese que el corte es **`lg`, no `sm`**:
  aquí el ancho de la teja no lo fija el viewport sino el carrusel (por eso existe el prop `surface`).
- **Sin fecha, sin chip punteado, sin eyebrow** — igual que en Compra (§22.5). La fecha vive en la ficha.
- **La teja grande será rara vez la que lleve burbuja**, porque es **la más cara de las ocho** y es la que
  peor le va al gate. Se especifica igual y con el mismo cuidado: cuando ocurra, es la superficie más
  visible del home.

**(b) Tejas CHICAS (resto, `surface="featuredRest"`).**

**Dónde va:** **después del `StockBadge`**, como último elemento de la teja, con la misma regla de 1px y el
mismo `mt-2.5 pt-2.5`. Aquí el espacio manda, y el orden de las decisiones fue: **primero cabe el aviso,
después la cifra** (R3.4 al pie de la letra).

```
┌────────────────────────┐
│                        │
│   ARTE (160–268px)     │
│                        │
└────────────────────────┘
03  Umbreon VMAX              ← numeración: ver (c) — DESAPARECE si esta pista pinta cifras
EVOLVING SKIES · #215
Reverse Holo
MX$ 1,950.00
QUEDA 1
────────────────────────      ← border-t 1px --color-border
PSA 10 ≈ MX$ 29,000.00        ← mono 11px (12px lg+), tinta, tabular  (`figureShort`, SIEMPRE)
Ilustrativo; no evaluamos     ← sans 11px muted; 2 renglones a 160px, 1 a 268px
esta carta.*                     la llamada (*) cierra la frase, accent 13px
```

- **`figureShort` en todos los breakpoints, sin excepción.** La teja chica mide 268px en su mejor momento y
  la forma larga en EN pide ~274px: **no cabe ni a `lg`**, y una cifra `nowrap` que desborda es peor que
  una forma corta. `figureShort` mide ~152px (11px) / ~166px (12px) incluso con `MX$ 999,999.00`, así que
  entra con holgura hasta en los 160px del móvil.
- **La condicionalidad no se pierde por usar la forma corta.** La cargan el glifo `≈` y el **micro-aviso
  inmediato**, exactamente como ya se ratificó para el móvil de Compra (§22.5). Sigue **prohibido**
  «PSA 10: MX$ 29,000.00» — dos puntos afirman, `≈` estima.
- **El micro-aviso cabe, y esta es la cuenta.** Sans 11px, ES 36 car. / EN 43 car. (§22.11): **2 renglones a
  160px** en ambos idiomas, **1 renglón a 268px** en ES y **1–2 en EN**. Nunca llega a 3. Es decir: en el
  carrusel **R3.4 no se dispara nunca por espacio**, así que no hay que elegir entre aviso y cifra. Si
  alguna vez se disparara —copy más largo, idioma nuevo, teja más estrecha— **lo que se quita es la
  cifra**, jamás el aviso, jamás un renglón del aviso, jamás un `line-clamp`.
- **Piso de 11px, también aquí** (§22.4d). La teja chica es la superficie más apretada del sistema y aun así
  el aviso **no baja de 11px** ni a 390px. Encoger el aviso «para que quepa» está prohibido; la salida
  legítima es quitar la cifra.
- **Coste en altura (cuantificado y aceptado):**

| Teja | Ancho | Micro-aviso | Alto del bloque |
|---|---|---|---|
| Grande, `lg+` | 400px | 1 renglón (ES y EN) | **~46px** |
| Grande, `<lg` | 236px | 1 renglón ES · 2 EN | ~46–58px |
| Chica, `lg+` | 268px | 1 renglón ES · 1–2 EN | **~46–58px** |
| Chica, móvil | 160px | 2 renglones (ES y EN) | **~70px** |

  El coste **solo lo pagan las tejas elegibles**, que aquí son una o dos entre ocho. Y a diferencia de la
  rejilla de Compra, **no compite con un CTA**: la teja del carrusel termina en el badge.

**(c) La numeración `01 · 02 · 03` — decisión y por qué.**

§22.6 citaba la numeración de §20.3 **por contraste** («allá es orientadora; aquí implicaría un ranking de
oportunidades»). Ese contraste **deja de existir** en cuanto el carrusel muestra la cifra: quedarían el
número rojo y el monto **en la misma teja**. Hay que decidir, y la decisión es:

> **La numeración y la cifra estimada NO coexisten. Si el carrusel pinta al menos una cifra, la numeración
> desaparece de TODA la pista** —de las ocho tejas, no solo de las que llevan burbuja—. Si ninguna teja es
> elegible (el caso normal), el carrusel es **exactamente §20.3 de hoy**, numeración incluida.

Las cuatro razones, en orden de peso:

1. **`03` junto a un monto se lee como *ranking de oportunidad*.** Es literalmente la afirmación que §O
   prohíbe y por la que §22.6 dejó la vitrina sin números. Que en §20.3 el número sea decorativo y
   `aria-hidden` no protege de nada: el lector vidente no ve el `aria-hidden`, ve un ordinal rojo encima de
   un «vale ≈ MX$29,000». Peor aún aquí, porque la pista **sí está ordenada por dinero** (precio desc), así
   que la lectura «están rankeadas por valor» es correcta para el precio y **falsa** para el estimado.
2. **Presupuesto de rojo.** §22.10 nº3 tolera **dos** elementos de acento por teja —`StockBadge` y el
   asterisco de 6px— y ahí traza la raya. La numeración sería el **tercero**, en una teja de 160px, y el
   único de los tres sin significado semántico (es decorativo por definición). El acento en este sistema es
   escaso a propósito (§17.2).
3. **Quitarla teja por teja rompe la alineación de la pista.** El número vive en la **fila del título**
   (`flex items-baseline gap-2`) antes del nombre: si desaparece solo en las tejas con burbuja, **el nombre
   de esas tejas arranca ~20px a la izquierda** que el de las vecinas, en una fila de tejas por lo demás
   idénticas. Eso sí se lee como error de maquetación. Todo-o-nada por pista mantiene **todos los nombres
   alineados al borde izquierdo de su teja**, que es como se ve hoy.
4. **Una secuencia con hueco (`01 02 __ 04`) señala a la teja sin número.** Y como el hueco coincidiría
   siempre con la burbuja, acabaría **subrayando** la pieza promocionada — el efecto contrario al buscado.

**Cómo se implementa la condicionalidad, sin que se convierta en un parpadeo.** La pista se decide **una
vez, con los datos ya resueltos**, con el mismo predicado que gobierna todo lo demás
(`pageHasGradingFigures(featured)`): o hay numeración en las ocho, o no la hay en ninguna. **Nunca** se
renumera para «tapar» el hueco (`01 02 03` saltándose la teja de la burbuja sería mentir sobre la
posición), **nunca** se sustituye el número por otro glifo, y **nunca** queda un espacio reservado donde
estaba. Mientras el carrusel está cargando no se pinta numeración provisional que luego desaparezca: la
pista aparece resuelta (§8.1 sigue aplicando al **skeleton de la teja**, que no cambia — lo que no existe
es un skeleton **del badge**, R4).

**Lo que NO se hizo, y por qué:** *no* se repintó la numeración de rojo a muted (sería tocar la piel
ratificada de §20.3 para todo el sitio por un caso minoritario), *no* se movió el número a otra posición
(no hay ninguna en la que un ordinal deje de leerse como ordinal), y *no* se quitó la numeración de forma
permanente del carrusel (cuando no hay burbujas no hay nada que reconciliar, y el elemento es parte del
makeover aprobado).

**La rotación automática (§23) NO afecta a nada de (c).** Es consecuencia directa de la regla dura de §23.2
(*rota la ventana, nunca el rol*): la rotación **no reordena el DOM**, así que `02` sigue siendo la segunda
teja del DOM en todo momento, la mire el usuario o no. El predicado sigue siendo `pageHasGradingFigures`,
**evaluado una sola vez** con los datos ya resueltos, y su resultado **no puede cambiar por desplazarse**.
En consecuencia queda **prohibido**: renumerar según lo visible («1 = la primera teja a la vista»), usar la
numeración como **indicador de posición o de progreso** de la rotación, resaltar el número de la teja que
acaba de entrar, y **añadir puntos, barras o cualquier paginador** al carrusel (§23.13 nº2 — duplicaría el
trabajo del número, sería un tercer rojo e implicaría «páginas» que en un scroller continuo no existen).

**(d) El caso disparejo — la retícula no se descuadra, y hay que saber por qué.**

Con una o dos burbujas entre ocho, la pista tiene tejas de alturas distintas. **No se compensa nada.** Es
correcto y es invisible, por construcción:

- **El badge es el ÚLTIMO elemento de las dos tejas.** Nada de lo que está encima —arte, nombre, renglón
  mono, acabado, precio, stock— se mueve un píxel por su presencia. Las **ocho imágenes siguen alineadas
  por su borde superior**, que es el eje que el ojo usa en una pista horizontal, y todas las líneas de
  texto siguen cayendo en las mismas alturas de teja a teja.
- **Lo único que difiere es el borde inferior de la teja, que no está dibujado.** No hay caja, ni fondo, ni
  regla de cierre (§2.1, §4.3): una teja más larga se lee como **una teja con más contenido**, no como una
  desalineada. Este sistema puede permitírselo precisamente porque no dibuja cajas.
- **Prohibido compensar:** nada de `min-height` en la teja, nada de `mt-auto` inventado, nada de espacio
  reservado, nada de una regla o un guion en las tejas sin cifra «para que igualen», nada de un skeleton
  del badge. Todo eso es exactamente el hueco que R4 prohíbe, y aquí además convertiría la ausencia —el
  caso normal— en un elemento de UI.
- **La pista crece de alto lo que crezca la teja más alta** (~46–70px según breakpoint) y ese aire cae
  **debajo** de las tejas cortas. Se acepta tal cual. No se recorta el `pb` del scroller para compensarlo,
  ni se cambia el tamaño de las flechas ni el `snap`.
- **Prohibido reordenar la pista para agrupar las tejas con burbuja** (ni al principio, ni «las elegibles
  primero»). El orden del carrusel es **precio descendente** y es un hecho del catálogo; reordenarlo por
  elegibilidad lo convertiría en una **curaduría de oportunidades** —una segunda vitrina encubierta— y
  filtraría el criterio del gate por la vía del orden (R5). Si un día se quiere esa lista, ya existe y se
  llama «Joyas para gradear».

**(e) El encabezado del carrusel NO cambia.** Sigue siendo **«Piezas destacadas del catálogo»** con su link
«Ver todo el catálogo» y sus flechas (§20.3). **Prohibido** añadirle kicker, subtítulo, o cualquier mención
al gradeo, al estimado o a la oportunidad. El carrusel **no es** una vitrina de gancho: es la pista de las
piezas más caras, en la que **algunas** piezas resultan llevar además una cifra estimada. En cuanto el
encabezado nombrara el gancho, la pista entera pasaría a **afirmar** algo sobre sus ocho piezas —incluidas
las seis o siete que no califican— y eso sería falso. El kicker de la salvedad («ILUSTRATIVO · NO
EVALUAMOS LA PIEZA») pertenece a la vitrina (§22.6), donde **todas** las tejas llevan cifra; aquí no
aplica, y su trabajo lo hace el micro-aviso de cada teja, que es el que §O.5 exige de todos modos.

> **Precisión v2.6 (§23.4a), para que (e) no se lea mal:** lo que (e) prohíbe es **kicker de contenido** —
> cualquier texto que **afirme algo sobre las piezas** de la pista. Eso sigue prohibido, literalmente y sin
> excepciones. El **conmutador de reproducción** que §23.4 coloca junto al H2 ocupa ese **hueco
> estructural**, pero no afirma nada sobre ninguna pieza: nombra el **comportamiento del estante**
> («PAUSAR» / «REANUDAR» / «REPETIR»). Mismo sitio, otro rol. El encabezado sigue **sin** kicker, **sin**
> subtítulo y **sin** una sola palabra sobre gradeo, estimados u oportunidad.

**(f) Convivencia con la vitrina «Joyas para gradear» — las dos, en la misma página.**

- **La vitrina se conserva íntegra** (§22.6): mismo encabezado, mismo kicker, mismas 8 tejas, misma
  excepción de skeleton. El carrusel **no la sustituye ni la duplica**: son dos superficies con **dos
  criterios de orden distintos** —el carrusel ordena por **precio**, la vitrina por **curaduría del
  servidor** (`sort=grading_showcase`)— y eso es lo que las hace legítimas a la vez.
- **Una carta puede salir en las dos, con su burbuja en ambas. No se deduplica.** Filtrar en el cliente la
  pieza que ya salió arriba (o abajo) alteraría lo que el servidor curó, abriría un hueco en una pista
  ordenada por precio y haría que el contenido de una sección dependiera de la otra. Se deja tal cual: que
  una pieza cara además califique es un hecho, no un error de maquetación.
- **Una sola nota al pie para todo el home** (§22.4b), al final del contenido y antes de la banda de tinta
  del buylist. Dos superficies con cifras **no** son dos notas.
- **El orden de la página no cambia:** carrusel (arriba, tras el hero) … vitrina (abajo, tras Gradeadas) …
  nota al pie. La nota sigue estando **después de la última cifra** de la página, que es lo que exige el
  patrón.

**(g) Acoplamiento con la nota al pie (R3.3) — la trampa de esta entrega.**

Hasta hoy el home hospedaba la nota **si y solo si la vitrina se renderizaba**. Con el carrusel como cuarta
superficie eso deja de ser suficiente y se vuelve un **fallo silencioso**: en el caso normal —vitrina vacía,
una burbuja en el carrusel— la página no hospedaría la nota, y como toda cifra es *fail-closed* sin nota
(R3.3), **el carrusel no pintaría ninguna burbuja y nadie vería un error**. Regla:

> **La condición de la nota al pie del home es la UNIÓN de sus superficies:** se renderiza si **la vitrina o
> el carrusel** muestran al menos una cifra. El mismo booleano gobierna las dos cosas (nota + contexto que
> habilita las cifras), y se deriva **del mismo predicado** para ambas fuentes — nunca de una regla copiada
> ni de «si la vitrina existe».

Corolarios que el frontend debe cumplir:

- **La lista del carrusel se comparte** entre la sección que decide hospedar la nota y el propio carrusel
  (misma consulta, deduplicada por su `queryKey`), igual que ya se hace con la vitrina. Dos consultas
  distintas podrían divergir y volver a abrir el fallo silencioso.
- **El ancla de regreso** de la nota apunta a la **primera superficie que de verdad pintó cifra**: vitrina
  si existe, si no el carrusel (§22.4a). El carrusel necesita para eso un `id` propio y su
  `scroll-mt-[calc(var(--app-header-h,0px)+16px)]`, como ya lo tiene la vitrina.
- **Nada de esto es un caso raro que se pueda dejar para después:** dado el gate, «vitrina vacía + carrusel
  con una burbuja» es un estado **frecuente**, no un borde.

**(h) Accesibilidad propia del carrusel** (además de §22.9, que no cambia):

- **La teja del carrusel es un `<a>` que envuelve todo**, a diferencia de la de Compra. En consecuencia el
  badge queda **dentro** del enlace y su texto pasa a formar parte del **nombre accesible** de la teja: el
  lector anuncia nombre, set, precio, stock, **la cifra y el micro-aviso completo**. Eso es **deseable** y
  cumple §22.5 («el `aria-label` de la teja incluye el micro-aviso»). Por lo tanto: **prohibido ponerle un
  `aria-label` al enlace de la teja**, porque sustituiría el contenido y **borraría el aviso** del árbol de
  accesibilidad — que es justo el defecto bloqueante que §22.4c corrigió.
- **La llamada `*` aquí NO es enlace** (`variant="plain"`): no se anida un ancla dentro del ancla de la
  teja. El acceso al texto largo es doble, como en Compra: la nota al pie de esa misma página y la ficha, a
  un clic de la teja.
- **El glifo `≈` va `aria-hidden`** con su lectura en prosa, y **la numeración sigue `aria-hidden`** cuando
  se pinta (§20.3): no forma parte del nombre accesible de la teja, ni antes ni ahora.
- **Orden de DOM = orden visual = orden de lectura**: precio real → estimado → micro-aviso. El badge no es
  focuseable.

**(i) Qué NO hacer en esta superficie** (además de §22.10, que aplica entero):

1. **No** mover la burbuja a la columna del precio de la teja grande, ni alinearla a la derecha, ni ponerla
   sobre el arte, ni antes del precio real.
2. **No** dejar la numeración roja en una teja que muestra cifra, ni quitarla solo en esas tejas, ni
   renumerar para tapar el hueco.
3. **No** cambiar el encabezado del carrusel ni añadirle kicker, subtítulo o mención al gradeo.
4. **No** reordenar, agrupar ni «subir» las tejas elegibles; el orden es precio descendente.
5. **No** igualar alturas: sin `min-height`, sin espacio reservado, sin regla ni guion de relleno en las
   tejas sin cifra, sin skeleton del badge.
6. **No** deduplicar contra la vitrina, ni condicionar una sección a la otra.
7. **No** usar la forma larga del copy en la teja chica (desborda), ni encoger la cifra por debajo de 11px,
   ni truncarla, ni abreviar el monto.
8. **No** derivar el hospedaje de la nota al pie solo de la vitrina (§22.6b-g).
9. **No** convertir el carrusel en una segunda vitrina de gancho por acumulación de pequeños cambios: si
   algún día se quiere eso, se diseña como tal y se decide en `PROJECT.md`, no aquí.

### 22.7 Estados — qué se renderiza y qué no

**Las superficies no se filtran igual — y hay TRES ejes independientes.** Es la consecuencia
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

**La columna «Teja» gobierna las TRES superficies de rejilla** (teja de Compra, vitrina y carrusel «Piezas
destacadas», §22.0/§22.6b): el dato que las tres leen es el mismo (`gradingHighlight` del
`GroupedListingSummaryDTO`, ya gateado) y el predicado de render es el mismo. La columna «Vitrina» dice si
la carta **entra en la lista curada** de §22.6, que es una pregunta distinta —de **pertenencia a esa
sección**— y no aplica al carrusel: al carrusel se entra por **precio**, y una vez dentro, la burbuja se
pinta o no exactamente con la regla de la columna «Teja».

| Situación (evaluada **server-side**, §O.4) | Ficha | Teja (incl. carrusel) | Vitrina |
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
- **Verificación visual — siete estados que son correctos y suelen reportarse como bugs:**
  1. Carta no elegible y carta elegible producen tejas **idénticas** salvo el bloque del badge; sin
     diferencia de altura reservada, sin borde extra.
  2. **Ficha con bloque pero carta sin badge** (gate no cumplido): **normal y esperado**.
  3. **Ficha con bloque de una sola cifra** (solo PSA 10, o solo PSA 9): **normal y esperado**, y en ambos
     casos sin badge ni entrada de vitrina.
  4. **Ficha con bloque y sin badge, con el gate CUMPLIDO** (la cifra no pasó el filtro de confianza, R6):
     **normal y esperado**, e **indistinguible** del caso 2 en pantalla.
  5. **Carrusel «Piezas destacadas» con CERO burbujas**: **el caso normal**, no un fallo de datos. Ordena
     por precio descendente y el gate castiga a las caras (§22.6b). Un carrusel entero sin cifras es la
     expectativa por defecto.
  6. **Carrusel con UNA teja con burbuja y siete sin ella, de alturas distintas**: **normal y esperado**.
     Las ocho imágenes siguen alineadas por arriba; el borde inferior no está dibujado (§22.6b-d). No es un
     descuadre y **no se compensa**.
  7. **Carrusel sin numeración `01 · 02 · 03`**: **normal y esperado** siempre que la pista muestre al
     menos una cifra — es la regla de §22.6b-c, todo-o-nada por pista. Lo que **sí** es un defecto es ver
     numeración y burbuja **en la misma pista**, o un hueco en la secuencia.

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
| **Carrusel — teja grande** (§22.6b) | 236px hasta `lg`, **400px** desde `lg`. Copy largo **solo desde `lg`**; entre `sm` y `lg` sigue en `figureShort` 11px | 236px, `figureShort` **11px**, micro-aviso 1 renglón (ES) / 2 (EN); ~46–58px de bloque |
| **Carrusel — teja chica** (§22.6b) | 160px hasta `lg`, **268px** desde `lg`. **`figureShort` siempre**; 12px desde `lg`, micro-aviso 1 renglón (ES) | 160px, `figureShort` **11px**, micro-aviso **2 renglones** (ES y EN); **~70px** de bloque |
| **Numeración del carrusel** | presente **solo si la pista no muestra ninguna cifra** (§22.6b-c) | igual — la regla es por pista, no por breakpoint |

Reglas de resistencia a cifras largas: todas las cifras llevan `tabular-nums` + `whitespace-nowrap`; la
**etiqueta** es la que envuelve, nunca la cifra. Probar con `MX$ 999,999.00` en ES a 390px: la celda debe
seguir cabiendo con la etiqueta en dos líneas. Si aun así la cifra chocara, baja un escalón de tamaño —
**jamás** se trunca un monto ni se abrevia a «2.9k».

**Precisión de la regla en el badge (2026-08-31, derivada de §22.6b).** En el badge la cifra no va sola: va
dentro de una **frase** («En PSA 10 vale ≈ MX$ 29,000.00»). El `whitespace-nowrap` pertenece **al monto**,
no a la frase entera: el **monto nunca se parte** —`MX$ 29,` / `000.00` sería un defecto de dinero— pero la
frase **sí puede envolver** antes de él si el ancho aprieta. Poner el `nowrap` en el párrafo completo
convierte cualquier estrechez en **desbordamiento fuera de la teja**, que es peor que un segundo renglón y
además es invisible en revisión hasta que aparece un monto grande. Aplica a las tres superficies de
rejilla; en el carrusel es lo que garantiza que ni siquiera un `MX$ 999,999.00` se salga de los 160px.

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
- **Si la teja entera es un `<a>` que envuelve el badge** (el carrusel, §22.6b-h), el nombre accesible del
  enlace **incluye la cifra y el micro-aviso**, y así debe ser. Corolario duro: **prohibido `aria-label` en
  ese enlace** — sustituiría el contenido y borraría el aviso del árbol de accesibilidad, reintroduciendo
  el bloqueante que §22.4c corrigió.
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
    bóveda, portafolio, cotizador de buylist ni back-office financiero. §22 vive **solo** en la ficha, la
    teja de Compra, la vitrina «Joyas para gradear» y el carrusel «Piezas destacadas» del home (§22.6b).
    La lista es **cerrada**: sumar una quinta superficie es una decisión del humano, no de implementación.
15. **No** delatar **por qué** una carta no se promociona: ni marca, ni versalita, ni tinta atenuada, ni
    `title`, ni `data-*` que distinga «gate no cumplido» de «cifra no confiable» (R5, R6). Y **no** inventar
    un distintivo sin cifra («Gradeable», «Candidata PSA») como premio de consolación cuando la cifra no es
    confiable: la teja se queda **exactamente como hoy** (R4). Tampoco **rotular el estimado con una
    versalita de `priceBasis`** (§22.3): un estimado no tiene base de precio.
16. **No** dejar convivir una **numeración ordinal** con una cifra estimada en la misma superficie —ni la
    `01 · 02 · 03` mono roja de §20.3, ni ninguna otra—, **ni** quitarla solo en las tejas con burbuja,
    **ni** renumerar para tapar el hueco (§22.6b-c). Junto a un monto, un ordinal es un *ranking de
    oportunidades*, y sería además el tercer rojo de la teja.
17. **No** volver «promoción» una superficie que no lo es: **no** reordenar, agrupar ni adelantar las tejas
    elegibles en el carrusel, **no** nombrar el gancho en su encabezado, kicker o subtítulo, y **no**
    deduplicarlo contra la vitrina (§22.6b-d/e/f). El carrusel es la pista de las piezas **más caras**; que
    alguna lleve cifra es un hecho de esa pieza, no una promesa de la sección.
18. **No** ampliar el prop `surface` del badge (§22.5) con valores no especificados aquí, ni sustituirlo
    por tamaños libres, `className` de tipografía o un `figureForm` abierto: es el único eje configurable
    y su lista de valores es **cerrada por diseño**, porque es la puerta por la que volvería a colarse una
    variante «ligera» sin micro-aviso.

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
- **El carrusel «Piezas destacadas» (§22.6b) NO añade ni una clave.** Reutiliza tal cual
  `catalog.gradingBadge.{figure,figureShort,microNotice,approx}` y `catalog.gradingNote.*`; lo único que
  cambia entre superficies es **cuál de las dos formas ya existentes** se pinta y a qué breakpoint
  (prop `surface`, §22.5). Tampoco se toca `home.featuredTitle` / `featuredTitleShort`: el encabezado del
  carrusel no menciona el gancho (§22.6b-e). Si alguien propone una clave nueva para esta superficie, es
  señal de que se está inventando copy que §22 no autoriza.
- *Retiradas respecto a versiones anteriores de §22*: `rawLabel`, `rawNote`, `gainNote`, `basisLine`,
  `costTierNote`, `caveatMicro`, `srDisclaimer`, `gridNote`, `provenance`, `gradingBadge.eyebrow`.
- **Las claves del back-office NO viven aquí.** §22.11 es **storefront**. El copy del dial de M10 —etiqueta,
  nota persistente y los **dos** avisos del dial único— está en **§22.13(j)**, bajo `admin.m10.dials.*`, y
  ahí consta también qué claves quedan **retiradas** (`admin.m10.dials.gradedEstimates.*`).

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

**Notas añadidas por la revisión del 2026-08-31 (carrusel «Piezas destacadas», §22.6b):**

9. **Arquitecto / backend — VERIFICACIÓN, no cambio de contrato (la más importante de esta revisión).**
   §22.6b **no pide nada nuevo**: el carrusel ya consume `GET /catalog/cards` con `sort=price_desc` y
   recibe `GroupedListingSummaryDTO`, que es exactamente donde v1.50.2 puso `gradingHighlight`. Pero todo
   §22.6b depende de un supuesto que **el diseño no puede verificar y no debe asumir**: que
   `gradingHighlight` se emite en **cualquier** respuesta de `/catalog/cards`, y **no solo** cuando se pasa
   `?gradingHighlight=true`. La tabla de coste del contrato (+2 queries con el dial `on` en
   `/catalog/cards`, sin el filtro) sugiere que sí, pero **hay que confirmarlo explícitamente**. Si
   resultara que el campo solo se computa con el filtro activo, el carrusel **nunca** mostraría una burbuja
   y —peor— el fallo sería **silencioso** (la teja se vería exactamente como hoy, que es lo que R4 manda
   cuando no hay dato). No es un cambio de contrato: es una confirmación, o en el peor caso un ajuste de
   emisión en backend. **Ninguna otra cosa se pide al contrato.**
10. **Frontend — lo que §22.6b sí exige tocar, y el orden en que conviene hacerlo.** (a) El badge gana el
    prop **`surface`** de tres valores cerrados (§22.5) — la teja de Compra y la vitrina se quedan en el
    default `'grid'` y **no cambian**; (b) el `whitespace-nowrap` pasa del párrafo **al monto** (§22.8), lo
    que también endurece la teja de Compra; (c) las dos tejas del carrusel montan el badge **como último
    elemento**, la grande a ancho completo bajo la fila de datos y la chica tras el `StockBadge`; (d) la
    **numeración del carrusel se vuelve condicional a nivel de pista** (§22.6b-c), decidida con el mismo
    predicado que las cifras; (e) **la condición de la nota al pie del home pasa a ser la unión** vitrina ∪
    carrusel (§22.6b-g) y la lista del carrusel se **comparte** con quien decide hospedarla — este punto es
    el que, si se omite, hace que la feature «no funcione» sin que nada falle a la vista; (f) el carrusel
    gana un `id` y su `scroll-mt` para poder ser destino del enlace de regreso. **Nada de esto abre la
    puerta a variantes del micro-aviso**: sigue siendo un componente único, no configurable (§22.10 nº13).
11. **Product-owner — la nota de ceguera de banner (§22.12 nº2) sube un escalón, sin cambiar la regla.**
    Con la cuarta superficie, el home puede mostrar el mismo micro-aviso en **dos secciones distintas** de
    la misma página (vitrina y carrusel) además de la nota al pie. **La regla no se toca y el diseño la
    implementa entera**: `PROJECT.md` §O.5 manda y el aviso va en todas. Se deja constancia, igual que en
    el nº2, de que la repetición sigue siendo el punto que —si alguna vez se revisa— debe decidir **PO +
    legal**, nunca una optimización de layout. Mitigantes que ya operan aquí: el carrusel muestra **una o
    dos** cifras entre ocho por efecto del gate, así que en la práctica el home rara vez pintará más de
    tres avisos en total. **Nada que ratificar de copy: §22.6b no introduce texto nuevo** (§22.11).
12. **Product-owner — el carrusel NO se convierte en superficie curada, y conviene que quede escrito.**
    §22.6b lo trata como lo que es —las 8 piezas más caras, algunas de las cuales resultan llevar cifra— y
    prohíbe expresamente reordenarlo por elegibilidad o nombrar el gancho en su encabezado (§22.10 nº17).
    Si en algún momento el negocio quiere que el carrusel del home promocione **oportunidades de gradeo**,
    eso es un **requisito distinto** (cambia el criterio de una sección existente) y debe entrar por
    `PROJECT.md`, no por una edición de este documento.

**Notas añadidas por la revisión del 2026-08-31 (dial único, §22.13):**

13. **Frontend — lo que §22.13 exige tocar (y nada más).** (a) **Renombrar** el grupo de claves y la
    etiqueta del dial (§22.13j); (b) montar el **segundo** `Banner` con la matriz de visibilidad de
    §22.13(c) —hoy solo existe el de encendido—; (c) leer `ingestMaxCardsPerRun` reutilizando
    `getGradedEstimateConfig` y la query key `['graded-estimates-config']` **que M2 ya usa** — es una query
    read-only más en M10, **no un cambio de contrato**— y caer a `onNoFigures` si no está disponible;
    (d) declarar `{perCard}` y `{runs}` como constantes en **un solo módulo**, nunca repartidas por el copy
    ni por dos componentes; (e) dar un `id` (`gancho-revision`) y su `scroll-mt` a la sección de la **lista
    de revisión** de M2, para que el enlace del aviso de apagado tenga destino real. Sin (e) el aviso
    manda a una página que no lleva a ningún sitio, que es la forma más silenciosa de que la escalera de
    remedios no se use. **Añadido v2.4:** (f) reescribir el valor de `…gradingHook.{on,onNoFigures,note}` y
    añadir `…gradingHook.onMeasured` en ES **y** EN (§22.13d/j); (g) añadir al **mismo módulo único** de (d)
    el selector `costBasis`, que hoy devuelve `'estimated'` fijo; (h) **cambiar la aserción del test** que
    hoy fija `/1[.,\s]?000 créditos al día/` por la frase condicional completa (§22.13k m) — mientras esa
    aserción exista, el copy corregido **no puede pasar CI sin tocarla**, así que va en el mismo cambio.

**Notas añadidas por la corrección del 2026-08-31 (v2.5 — punteros que apuntaban a la nada):**

15. **Frontend — §22.14 completa, y es lo que hace verdad el aviso.** (a) Pintar `ingestMaxCardsPerRun` en
    `GradedEstimatesSection`, en **bloque propio** bajo la retícula de margen/frescura (§22.14b);
    (b) añadirlo al payload del `PUT` —hoy `save()` manda solo tres campos— y validar `[1, 1000]` entero en
    cliente, money-safe (vacío ≠ 0), con `rangeError`; (c) montar el `Banner` de créditos con
    `warnTitleUp`/`warnTitleDown`/`warn` (§22.14c), **reutilizando `grading-hook-cost.ts`**, nunca una
    aritmética propia; (d) claves nuevas `admin.m2.gradedEstimates.ingestCap.*` en ES **y** EN;
    (e) retirar del aviso de apagado el escalón de «grados» (§22.13e) — **es copy, no código**, pero cae en
    el mismo `messages/`. **Cero componentes nuevos, cero tokens nuevos, cero cambios de contrato**
    (`GradedEstimateConfigInput.ingestMaxCardsPerRun` ya es opcional, `contract.ts:2598`).
    **Orden de envío:** (e) y el copy de §22.13 pueden ir solos; **el puntero «se edita en M2» sólo es
    verdad con (a)–(c) dentro** — si (a)–(c) se difieren, aplica el **plan B** de §22.13(d).
16. **QA — el check que decide si esto bloquea.** El defecto no es «falta un campo»: es que **el aviso de
    consentimiento nombra un remedio que no existe**. Con §22.14 en el mismo stream, el check es
    §22.14(f)(f): guardar el tope en M2 mueve la cifra del aviso de M10. Sin §22.14, el check es que el
    aviso **no** diga «se edita en M2» (plan B). **Cualquiera de las dos cierra el hallazgo; la tercera
    —dejar el texto como está— no.**
17. **Techlead / product-owner — el editor de «grados» queda fuera, y conviene que conste.** Se encontró en
    la misma pasada: `grades` y `highlightGrades` son **read-only** en M2 (párrafo `text-xs muted`), igual
    que `manualFreshnessDays`, `maxRawMultiple`, `minSampleCount` y `sourceStat` — éstos ya con deuda
    registrada (**F-19**). El aviso de apagado dejó de nombrarlos (§22.13e), así que **ninguna pantalla
    promete hoy algo que no se pueda hacer**. Darles editor es **una feature nueva** con invariantes propios
    (`highlightGrades ⊆ grades`) y entra por `PROJECT.md`. Si PO la quiere, §22 le da sitio: sería un bloque
    hermano del de §22.14 en la misma sección.
14. **Arquitecto / product-owner — una petición abierta y dos constancias.** Hasta v2.3, §22.13 no necesitaba
    ningún dato que el contrato no cubriera: el dial está en `SettingsDTO` (`gradingHookEnabled`) y el tope
    en `GradedEstimateConfigDTO` (`ingestMaxCardsPerRun`). **La v2.4 abre una petición, y es la única.**
    - **Petición (no bloqueante para implementar hoy): un canal para el COSTE MEDIDO.** §22.13(d) define
      `onMeasured`, el texto que publica la cifra **medida** en vez de la nominal. Su fuente —la línea
      `[VEREDICTO-PSA] COSTE MEDIDO:` de la sonda y su transcripción a `DEVOPS_NOTES.md`
      (`ARCHITECTURE.md` §4.38r.3.1.1)— **no existe en ningún DTO**, así que la pantalla no puede
      verificarla y `onMeasured` queda dormido. Si el arquitecto quiere que el aviso llegue a decir la
      verdad medida, hace falta que `GET /admin/pricing/graded-estimates` (o donde él decida) exponga
      **coste medido por día + fecha de la medición**. **No lo pide este documento como bloqueante** y
      **ux-ui no diseña el DTO**: se anota para que la decisión sea suya y no una improvisación del
      frontend el día del encendido. Mientras tanto, el aviso dice explícitamente que **no está medido**,
      que es la verdad.
    - Constancia (i): la **corrección de A-1** (§4.38r.3.1.0/.1) ya está aplicada al copy — el aviso **ya no
      afirma «1 000 créditos al día» como hecho**. El **presupuesto medido** que §4.38(r.3.1.1) manda
      publicar en `DEVOPS_NOTES.md` sigue siendo lo que da veracidad a la cifra; cuando exista, el copy
      cambia **por selector e interpolación**, no por edición (§22.13d.1).
    - Constancia (ii): el disclaimer de §O.5 **ya está aprobado por el dueño** (2026-08-31, con la marca
      corregida a **TCG HUNT** en ES y EN), así que el aviso **ya no dice que falte su visto bueno** —
      decirlo sería publicar en pantalla algo falso. Lo único que el aviso conserva de esa idea es que **no
      ha habido revisión legal profesional**, y **esa cláusula se retira el día que un abogado revise el
      texto**: es de PO/legal avisar cuándo. **La v2.4 no la toca.**
    - Constancia (iii): **GU-9 cerrada** (el dueño aceptó los **60 días** de antigüedad máxima del dato
      automático, §4.38r.3.1.2 nº3). Se revisó §22.13 completa: **ninguna superficie de M10 presentaba la
      frescura como decisión pendiente**, así que no hubo nada que retirar. La única mención está en la nota
      persistente (f), como ajuste editable en M2, y sigue siendo correcta.

---

### 22.13 El dial único del gancho en M10 — dos avisos, uno por sentido (v2.5, `ARCHITECTURE.md` §4.38r)

> **Corrección v2.5 (2026-08-31) — todos los punteros del copy, verificados uno por uno contra el código.**
> Un aviso que nombra un control **tiene que poder llevarte a él**. Estado tras la revisión:
>
> | Puntero del copy | ¿Existe? | Evidencia | Acción |
> |---|---|---|---|
> | «lista de revisión» → `/admin/m2#gancho-revision` | ✅ | `GradedEstimateReviewSection.tsx:318` (`id`) + su test | ninguna |
> | «margen mínimo» en M2 | ✅ | `GradedEstimatesSection.tsx:234` (`Input`) | ninguna |
> | «Actualizar precios ahora» en M2 | ✅ | `admin.m2.priceIngest.trigger`, botón real | ninguna |
> | «el tope se edita en M2» | ❌ | no se pinta ni se manda en el `PUT` | **§22.14: M2 gana el campo** |
> | «un grado entero se quita de "grados" en M2» | ❌ | párrafo read-only, sin editor | **se retira del copy (e)** |

> **Corrección v2.4 (2026-08-31) — A-1, el único bloqueante vivo del primer encendido.** El aviso de
> encendido **afirmaba una cifra que nadie ha medido**. Se corrige en **(d)**, con la regla de redacción que
> lo gobierna en **(d.1)**, la prohibición correspondiente en **(h)** y la verificación en **(k)**. El aviso
> de **apagado (e)**, la nota **(f)**, la etiqueta **(g)**, la matriz **(c)** y el contraste **(i)** no
> cambian salvo donde se indica. **Este § sigue siendo la única fuente del copy de M10.**

> **Qué cambió.** El gancho pasa de **dos** interruptores a **uno** (`gradingHookEnabled`, M-46): el mismo
> dial gobierna **exhibición Y obtención**. El dueño tenía razón —el segundo **nunca se dibujó en el
> panel**, así que la única forma de tocarlo era `curl`—, y este § **no se disculpa por la simplificación**:
> la da por buena y diseña lo único que ahora hace falta, que es **decir la verdad en los dos sentidos**.
> Todo lo de §22.0–§22.12 (storefront) queda **intacto**: aquí solo se escribe el back-office de M10.
>
> **Cero componentes nuevos** (`Banner` §7.5 + `Switch` §6, ya montados en M10) y **cero tokens nuevos**
> (R1 sigue rigiendo). **Cero cambios de contrato.**

#### 22.13(a) Por qué DOS textos y no uno

El dial dejó de ser simétrico, y esa asimetría —dictaminada en §4.38(r.2)— es la que ordena todo lo demás:

| Sentido | Qué pasa de verdad | Qué tiene que hacer el texto | Variante |
|---|---|---|---|
| **Encender** | Publica una afirmación comercial **y** empieza a pedir datos a un proveedor **de paga**: consume créditos y escribe precios. **Una** escritura, dos consecuencias | Que **el gasto sea imposible de pasar por alto** — es la consecuencia nueva, la que nadie espera | **`Banner warning`** |
| **Apagar** | Deja de publicar **y** deja de actualizar. Una escritura, dos consecuencias, **ninguna peligrosa** | Que el dueño **no apague la feature entera por una carta mal capturada**: enseñarle la escalera de remedios | **`Banner info`** |

**Regla:** *el aviso lo elige el **sentido del cambio**, no el estado del dial.* Un solo texto tendría que
advertir y tranquilizar a la vez, y no haría ninguna de las dos cosas. El encendido es hoy un **acto de
dinero** (§4.38r.3) y el apagado es el **botón de pánico** que el gancho no tenía: tratarlos igual sería
describir mal el producto.

#### 22.13(b) Anatomía y ubicación — se reescribe lo que ya existe

Los dos avisos son **el mismo `Banner` de §7.5** que M10 ya monta bajo la retícula de diales, en su
contenedor, **después de la nota persistente** (f) y **antes** del botón «Guardar»:

- Icono a la izquierda, **título** semibold, cuerpo. **Sin relleno de color** — icono y texto sobre papel,
  mismo tratamiento que el aviso de §21.9c.
- **Cuerpo en tinta**, no muted: es prosa que hay que leer. La muted queda para el icono, la regla y la
  línea de bitácora.
- **Las cifras de créditos van en mono `tabular-nums`** (§20.14, voz del dinero operativo): son una cuenta,
  no una frase. Es el mismo criterio que separa precio de estimado en el storefront, aplicado aquí.
- **El calificador viaja con la cifra, y con el mismo peso visual.** La condicional que la califica
  («si cobra por petición…», «medido el {measuredOn}») va en **la misma frase, mismo tamaño, misma tinta**
  que el número: nunca muted, nunca `text-xs`, nunca entre paréntesis al final del párrafo, nunca en un
  `title`/tooltip. Una cifra en mono destaca sola; degradar su calificador la deja **leyéndose como un
  hecho**, que es exactamente el defecto que (d.1) corrige.
- **Los dos avisos nunca coexisten:** el estado efectivo es uno solo.

#### 22.13(c) Matriz de visibilidad y ARIA

«Efectivo» = el borrador si el dueño tocó el switch; si no, el valor guardado.

| Guardado | Efectivo | Qué se pinta | `role` |
|---|---|---|---|
| `off` | `off` | solo la **nota persistente** (f) | — |
| `off` | `on` (**lo acaba de encender**) | **Aviso de encendido** (d) | **`alert`** |
| `on` | `on` | **Aviso de encendido** (d), como recordatorio de estado | `status` |
| `on` | `off` (**lo acaba de apagar**) | **Aviso de apagado** (e) | `status` |

- **`alert` solo en el flip a `on`:** ese es el momento de leerlo, **no después de guardar**. Es la conducta
  que M10 ya tiene y se conserva, ahora con más razón: el flip es lo que autoriza el gasto.
- **El aviso de encendido está redactado en presente de estado** («Con este dial encendido, la tienda
  muestra… y el barrido pide…») para servir **igual** como advertencia previa y como recordatorio
  permanente. **Un solo texto, dos usos**: no hay variante por momento, y así no puede desincronizarse una
  con la otra.
- **El aviso de apagado no sube a `alert`.** Interrumpir a quien está tomando la decisión segura es ruido.
- **El banner no roba el foco:** lo conserva el switch, para poder revertir con la misma tecla.

#### 22.13(d) Copy del ENCENDIDO — publica **y** gasta (cuánto, **medido o no**)

**Tres entradillas, tres ideas, y la tercera es la que faltaba:** *publica* → *gasta* → **cuánto**. El cuerpo
es **un solo texto** con **tres variantes** que se diferencian **únicamente en el tercer bloque** (el de
«cuánto»); todo lo demás es literal idéntico entre las tres. La variante la elige `costBasis` (d.1).

| Clave | Cuándo se pinta |
|---|---|
| `on` | **Por defecto y hoy siempre.** Hay tope de M2, **no hay coste medido** |
| `onMeasured` | Hay tope de M2 **y** hay coste medido del entorno (§4.38r.3.1.1) — **previsto, dormido hasta que exista la fuente** |
| `onNoFigures` | **No** hay tope de M2 (cargando, error, sin permiso) |

**Título y línea de bitácora — comunes a las tres variantes** (el título no lleva cifra, así que **sigue
siendo verdad también cuando el coste esté medido**; no se toca en v2.4):

| Clave | ES | EN |
|---|---|---|
| `onTitle` | Encendido: publica cifras **y** consume créditos | On: publishes figures **and** spends credits |
| `audit` | Solo súper-admin · queda en bitácora. | Super-admin only · recorded in the audit log. |

**`on` — cuerpo completo (variante sin medir). ES:**

> **Publica.** Con este dial encendido, la tienda muestra cifras estimadas de PSA 10 / PSA 9 sobre cartas sin
> gradear, con su disclaimer (aprobado por el dueño; sin revisión legal profesional): es una afirmación
> comercial de la tienda. **Y gasta.** El mismo dial autoriza al barrido diario a pedir esas cifras a un
> proveedor **de paga** y a escribir precios estimados. **Cuánto gasta, todavía nadie lo ha medido.** Lo que
> sí sabemos es el alcance: el barrido mira hasta **{maxCards} cartas tuyas** por corrida, **{runs} corridas
> al día** (ese tope se edita en M2 · Catálogo y precios). Lo que no sabemos es **cómo factura el
> proveedor**: si cobra por petición, el techo son **{credits} créditos al día** ({maxCards} × {perCard} ×
> {runs}); si cobra por carta devuelta, cada petición pide el **set entero**, el barrido paga **todas** las
> cartas de cada set que toque y la factura puede ser **varias veces** esa cifra. **La primera corrida lo
> mide**; hasta entonces, {credits} es un techo bajo un supuesto, no un presupuesto. Los créditos gastados
> no se recuperan al apagar. No cambia ningún precio de venta, valuación ni cotización: cambia lo que la
> tienda afirma **y lo que cuesta**.

**`on` — EN:**

> **It publishes.** With this dial on, the storefront shows estimated PSA 10 / PSA 9 figures for ungraded
> cards, with its disclaimer (approved by the owner; not reviewed by a lawyer): it is a commercial claim by
> the store. **And it spends.** The same dial lets the daily sweep ask a **paid** provider for those figures
> and write estimated prices. **How much it spends has not been measured yet.** What we do know is the
> scope: the sweep looks at up to **{maxCards} of your cards** per run, **{runs} runs a day** (that cap is
> edited in M2 · Catalog and pricing). What we do not know is **how the provider bills**: if it charges per
> request, the ceiling is **{credits} credits a day** ({maxCards} × {perCard} × {runs}); if it charges per
> returned card, each request asks for the **whole set**, the sweep pays for **every** card in each set it
> touches, and the bill can be **several times** that figure. **The first run measures it**; until then,
> {credits} is a ceiling under an assumption, not a budget. Credits spent are not recovered by turning it
> off. It changes no sale price, valuation or quote: it changes what the store claims — **and what it
> costs**.

**`onMeasured` — idéntico a `on` salvo el tercer bloque, que pasa de hipótesis a medición:**

| | ES | EN |
|---|---|---|
| Bloque «cuánto» | **Cuánto gasta, ya está medido.** El barrido mira hasta **{maxCards} cartas tuyas** por corrida, **{runs} corridas al día**, y la corrida medida el {measuredOn} gastó a razón de **{credits} créditos al día**. Es una medición, no un supuesto: si cambia el tope, el inventario o el proveedor, vuelve a medirse. | **How much it spends has been measured.** The sweep looks at up to **{maxCards} of your cards** per run, **{runs} runs a day**, and the run measured on {measuredOn} spent at a rate of **{credits} credits a day**. That is a measurement, not an assumption: if the cap, the inventory or the provider changes, it gets measured again. |

**`onNoFigures` — idéntico a `on` salvo el tercer bloque, sin ninguna cifra:**

| | ES | EN |
|---|---|---|
| Bloque «cuánto» | **Cuánto gasta, todavía nadie lo ha medido.** Consume créditos en cada corrida. El tope que fijaste en M2 · Catálogo y precios acota **cuántas cartas tuyas mira** el barrido, **no cuántas te cobra el proveedor**: cada petición pide el set entero. Cuánto cuesta de verdad lo mide la primera corrida. | **How much it spends has not been measured yet.** It consumes credits on every run. The cap you set in M2 · Catalog and pricing limits **how many of your cards** the sweep looks at, **not how many the provider bills you for**: each request asks for the whole set. What it really costs is measured by the first run. |

- **Las tres entradillas —«Publica.» / «Y gasta.» / «Cuánto gasta…»— son el mecanismo, no adorno.** Es el
  mismo recurso de §22.4b (entradilla en tinta 500 dentro del párrafo) y garantiza que **las consecuencias
  se lean aunque nadie lea el párrafo**. Se marcan con **rich text de next-intl** (`<b>…</b>`), nunca
  partiendo la frase en dos claves ni concatenando (§9.4). La tercera entradilla es nueva en v2.4: sin ella,
  «cuánto» quedaba dentro de la segunda y **se leía como un dato cerrado**.
- **Los números se interpolan; no se hardcodean** — convención del sistema («del dial, nunca hardcodeado»,
  §15). `{maxCards}` = `ingestMaxCardsPerRun` (M2, `GET /admin/pricing/graded-estimates`); `{perCard}` y
  `{runs}` son las constantes de coste del proveedor y de cadencia del cron, declaradas por frontend en
  **un solo módulo**; `{credits}` llega **ya multiplicado** (ICU no multiplica).
- **Lo que dan los topes de hoy.** `250 × 2 × 2 = 1 000` créditos/día **bajo el supuesto «por petición»**.
  El máximo que un solo `PUT` puede autorizar bajó de **5 000 a 1 000** (I8, contrato **v1.51-a**,
  §4.38r.3.4), así que el peor caso nominal por `PUT` es **4 000**/día y ya no 20 000 — pero **eso es antes
  del factor de amplificación `A`**, que ningún dial acota. **Estrechar el tope no acota la factura**, y el
  copy no debe insinuar que sí: por eso `onNoFigures` dice explícitamente qué acota el tope y qué no.
- **«ese tope se edita en M2 · Catálogo y precios» — el puntero sólo puede viajar con §22.14.** Hoy M2
  **no dibuja el campo** (verificado: `GradedEstimatesSection.tsx` no lo pinta ni lo manda en el `PUT`), así
  que esa frase manda al dueño a un sitio donde no puede hacer lo que la pantalla le dice. **La salida
  elegida es que el sitio exista** (§22.14), no suavizar la frase. Regla de envío, sin ambigüedad:
  - **Si §22.14 entra en el mismo stream:** el texto de arriba queda **tal cual** y **no se toca nada** — el
    puntero pasa a ser verdad el día que el campo se pinta. Es la salida preferida.
  - **Plan B, sólo si QA bloquea el merge y §22.14 se difiere:** la frase entre paréntesis se sustituye por
    **ES** «(ese tope es un ajuste del servidor y **hoy no se puede cambiar desde el panel**)» · **EN**
    «(that cap is a server setting and **cannot be changed from the panel today**)», y §22.14 pasa a
    `TECH_DEBT` como **deuda con fecha**. Es peor producto —le dice al dueño que no tiene palanca— pero es
    **verdad**, que es el mínimo no negociable. Al entrar §22.14, esa cláusula **se borra** y vuelve el
    puntero: es una sustitución de una cláusula entre paréntesis, no una reescritura del aviso.
  - **Lo que NO es salida:** dejar el puntero y anotar la diferencia en un documento. Un aviso que describe
    una pantalla que no existe es exactamente el defecto que §22.13 entera existe para no cometer.
- **El aviso nunca espera a un número.** Si la config de M2 no está disponible (cargando, error, permiso),
  se pinta `onNoFigures`, que conserva **las tres** ideas. Es la doctrina de **R3.4 llevada al back-office**:
  **cede la cifra, nunca el aviso** — y, desde v2.4, **cede la cifra antes que el calificador**.
- **`audit` es la última línea del banner**, mono 11px muted. §7.6 ya lo exige a las acciones de dinero
  saliente («Solo súper-admin · queda en bitácora»); aquí aplica porque **encender es** una acción de
  dinero.
- **Corrección de hecho (2026-08-31, disclaimer).** La versión anterior de este aviso decía que el texto
  legal *«todavía NO tiene el visto bueno del dueño (ni revisión legal)»*. **El dueño lo aprobó** —en la
  misma sesión, con la marca corregida a **TCG HUNT**— así que esa frase **se retira**: escribirla hoy sería
  **publicar en pantalla algo falso**, en la pantalla que precisamente existe para que nadie encienda esto a
  ciegas. Se conserva lo único que sigue siendo verdad, **«sin revisión legal profesional»**, y esa cláusula
  **se cae el día que un abogado revise el disclaimer** (§22.12 nº14). **La v2.4 no la afloja**: las tres
  variantes la llevan literal.
- **GU-9 está cerrada y este § nunca la mencionó.** El dueño aceptó los **60 días** de antigüedad del dato
  automático (§4.38r.3.1.2 nº3). Se revisó §22.13 entera: **no hay ninguna frase que presente la frescura
  como decisión pendiente** — (f) solo la nombra como un ajuste editable en M2, que sigue siendo cierto. No
  hay nada que retirar, y queda constancia de que se buscó.

#### 22.13(d.1) La regla de calificación — lo que sabemos, lo que no, y quién lo resuelve

**Norma.** *Mientras el coste no se haya medido en el entorno que se enciende, el aviso **no puede presentar
ninguna cifra de créditos sin decir, en la misma frase, bajo qué supuesto vale y qué la pondría en duda**.*

Por qué, con los hechos delante (`ARCHITECTURE.md` §4.38r.3.1.0, verificado contra el código que corre):

| | Qué es | Estado |
|---|---|---|
| `{maxCards}` cartas por corrida, `{runs}` corridas al día | **Alcance**: cuántas cartas **nuestras** entran. Sale de un dial que el dueño edita | ✅ **Lo sabemos** |
| `{perCard}` créditos por carta | Tarifa publicada del proveedor | ✅ Lo sabemos |
| **Qué cuenta el proveedor para cobrar** — cartas *en alcance* o cartas *devueltas* | La petición manda `fetchAllInSet=true`: pide **el set entero**. `ingestMaxCardsPerRun` acota el alcance, **no** lo devuelto. `A = devueltas / en alcance ≥ 1`, y **ningún dial lo acota** | ❌ **NO lo sabemos** |
| `{credits}` = `{maxCards} × {perCard} × {runs}` | **Solo vale si se cobra por petición.** Si se cobra por carta devuelta, el techo es `{credits} × A` — 250 cartas en 20 sets de 200 dan `A = 16` ⇒ **16 000/día** frente a una cuota de 20 000 | ⚠️ **Hipótesis** |

**El error que esto corrige no es de estilo: es de clase.** Una consecuencia **observable** del
comportamiento del proveedor estaba escrita como si fuera una **decisión nuestra**. Y la pantalla donde
estaba escrita es, literalmente, **la que existe para que nadie encienda esto a ciegas**: era el peor sitio
posible para un número inventado. La diferencia entre los dos regímenes es la diferencia entre gastar el
**5 %** y el **80 %** de la cuota diaria del dueño — no es un matiz de redacción.

**Cómo se redacta la calificación (y por qué no basta con «aproximadamente»).**

| Recurso | Veredicto |
|---|---|
| «aproximadamente **{credits}**», «~{credits}», «hasta unos {credits}» | ❌ **Prohibido.** Sugiere **error de redondeo** sobre un número correcto. El error posible es de **un factor de 16**, no de un decimal, y su causa no es la precisión sino **un supuesto de facturación sin observar** |
| «puede variar», «estimado», «orientativo» | ❌ Insuficiente por lo mismo: no dice **qué** puede variar ni **quién** lo resuelve |
| **Nombrar los dos regímenes, decir cuál asume la cuenta y decir que la primera corrida lo dirime** | ✅ **Es la forma exigida.** El dueño no tiene que creerse un número: tiene que poder decidir **con la incertidumbre a la vista y con la salida a la vista** |

**Y la cifra no se borra.** Se consideró quitarla y dejar solo «consume créditos»: **se rechaza**. Un aviso
de gasto sin orden de magnitud no permite decidir, y el dueño sí sabe cuántas cartas suyas entran — ocultarle
la mitad que **sí** conocemos sería el error simétrico. Se publica **con su supuesto pegado**.

**Selector `costBasis` — cómo se enciende el texto medido sin reescribir nada.**

```
costBasis = 'measured'   ⇒ onMeasured   (hay coste medido del entorno + fecha)
costBasis = 'estimated'  ⇒ on           (hay tope de M2, no hay medición)  ← hoy, siempre
(sin tope de M2)         ⇒ onNoFigures  (gana sobre las dos anteriores)
```

- El selector vive en **el mismo módulo único** donde ya viven `{perCard}` y `{runs}` (§22.12 nº13d). Hoy
  devuelve `'estimated'` **de forma fija**, porque no hay fuente: el `COSTE MEDIDO` de §4.38(r.3.1.1) vive
  en el log de la sonda y en `DEVOPS_NOTES.md`, **no en ningún DTO**.
- **Las tres variantes se traducen y se montan ahora**, aunque `onMeasured` no se pinte todavía. Es
  deliberado: el día que el número medido exista, publicarlo es **cambiar un selector**, no reabrir el copy
  de una pantalla de consentimiento con prisa. Un aviso reescrito con prisa es cómo se coló el defecto que
  este § corrige.
- **Qué falta para encenderlo** — no lo decide ux-ui: hace falta que el coste medido llegue al frontend por
  un canal del contrato. **Solicitud abierta al arquitecto/PO en §22.12 nº14.** Hasta entonces, `onMeasured`
  **no se pinta** — y **no** se rellena a mano desde un `.env`, un literal ni una constante «temporal»: eso
  sería volver a afirmar como medido algo que la pantalla no puede verificar.

#### 22.13(e) Copy del APAGADO — deja de publicar **y** de actualizar

El trabajo de este texto es **la puntería, no el miedo**: el dial es el **último escalón** (§4.38r.5), y sin
decirlo el dueño apagará la feature entera por una carta mal capturada.

| Clave | ES | EN |
|---|---|---|
| `offTitle` | Apagar también deja de actualizar | Turning it off also stops updating |
| `off` | **Para las dos cosas a la vez.** Mientras esté apagado, la tienda no muestra ninguna cifra estimada y el barrido no pide ni escribe ninguna: no se gasta un crédito y los datos automáticos dejan de refrescarse. **Para una cifra concreta, este no es el remedio.** Una cifra rara se borra en la lista de revisión; si lo que sobra es la promoción, sube el margen mínimo en M2 y la ficha sigue informando. Apágalo cuando la duda sea de fondo: cambió el proveedor o las cifras dejaron de ser de fiar. Al reencender, la siguiente corrida repone las cifras automáticas; si tienes prisa, «Actualizar precios ahora» en M2. | **It stops both at once.** While off, the storefront shows no estimated figure and the sweep neither requests nor writes any: not a credit is spent, and automatic data stops being refreshed. **For one specific figure, this is not the remedy.** A wrong figure is deleted from the review list; if what’s excessive is the promotion, raise the minimum upside in M2 and the card page keeps informing. Turn it off when the doubt is systemic: the provider changed, or the figures are no longer trustworthy. When you turn it back on, the next run restores the automatic figures; if you’re in a hurry, “Refresh prices now” in M2. |

- **Un solo enlace.** «lista de revisión» / «review list» va envuelta en el chunk `<review>…</review>` de
  next-intl y se pinta como `<a>` a `/admin/m2#gancho-revision` (§9.4: la frase **no** se parte en dos
  claves ni se concatena). El otro escalón se nombra **por su control** («margen mínimo»), que es como se
  llama en M2: dos enlaces compitiendo convertirían el aviso en un menú.
- **Corrección v2.5 — el escalón de «grados» SE RETIRA, porque tampoco existe.** La versión anterior decía
  *«un grado entero se quita de "grados" en M2»*. **En M2 los grados son un párrafo read-only**, no un
  control: `GradedEstimatesSection.tsx` los pinta con `server.grades.join(' · ')` dentro de un
  `<p class="text-xs text-muted">`, y no hay editor en ninguna pantalla (verificado en todo `(admin)/`).
  Era **el mismo defecto** que el del tope (§22.14), en el escalón de en medio. La regla que el propio (e)
  ya declaraba —*«la pantalla muestra los tres escalones que el dueño puede accionar solo»*— resuelve el
  caso sin inventar nada: si no lo puede accionar solo, **no es un escalón**, así que la escalera pasa a
  **dos**, y los dos están verificados (`gancho-revision` existe con su ancla y su test; `minUpside` es un
  `Input` real).
- **Editar los grados NO se pide aquí.** A diferencia del tope, los grados **no son la palanca del gasto**
  ni nada que el aviso prometa como remedio ya. Ponerles editor es una feature con sus propios invariantes
  (`highlightGrades ⊆ grades`, gate siempre evaluado en PSA 9) y **entra por `PROJECT.md`**, no por una
  edición de este documento. Queda anotado para PO/techlead en §22.12 nº15.
- **La escalera va en prosa, no en tabla ni en viñetas.** Se lee en cinco segundos en el momento exacto de
  la duda, y una tabla dentro de un `Banner` es un componente nuevo disfrazado. La escalera completa
  —incluida la sonda, que es de devops— vive en `ARCHITECTURE.md` §4.38(r.5); la pantalla muestra **los
  escalones que el dueño puede accionar solo** — desde v2.5, **dos**, y ni uno más del que no pueda.
- **Cita el label literal del botón que existe** («Actualizar precios ahora» / «Refresh prices now»,
  `admin.m2.priceIngest.trigger`): un aviso que nombra un botón inexistente es peor que no decir nada.
- **Sin cifra de horas.** El «≤ 12 h» de §4.38(r.5) es la cadencia del cron, no un dato de pantalla: «la
  siguiente corrida» es verdad hoy y lo seguirá siendo si el cron cambia.
- **No promete que apagar arregle nada.** Dice qué detiene y qué no; el rancio al reencender se explica por
  su remedio (la corrida siguiente), no como advertencia.

#### 22.13(f) La nota persistente — siempre visible, bajo la retícula de diales

`text-xs muted`, sin banner: es contexto, no aviso. Reescribe la nota que ya existe.

| Clave | ES | EN |
|---|---|---|
| `note` | Un solo interruptor gobierna el gancho: encendido, la tienda publica las cifras estimadas **y** el barrido diario las trae de un proveedor de paga; apagado, no publica ninguna **y** tampoco actualiza ninguna. Los escalones de costo de gradeo, el margen mínimo, la frescura y el tope de cartas por corrida se editan en M2 · Catálogo y precios, junto con la lista de revisión — que es la herramienta para una cifra concreta. Ese tope acota **cuántas cartas tuyas mira** el barrido, no cuántas te cobra el proveedor. | A single switch governs the hook: on, the storefront publishes the estimated figures **and** the daily sweep fetches them from a paid provider; off, it publishes none **and** updates none. Grading cost tiers, minimum upside, freshness and the per-run card cap are edited in M2 · Catalog and pricing, along with the review list — the tool for a single figure. That cap limits **how many of your cards** the sweep looks at, not how many the provider bills you for. |

La nota carga **la versión de una línea** de las dos ideas, para que estén presentes **también cuando el
dial está apagado y no hay ningún banner**: es lo que impide que el dueño descubra la escalera solo en el
momento de apagar.

**Corregido v2.5 — «los grados» sale de la lista de lo editable.** La nota los enumeraba junto a los
escalones y el margen mínimo, y **no son editables en ninguna pantalla** (párrafo read-only en M2,
§22.13e). El tope **sí se queda** en la lista: §22.14 lo hace verdad. Si §22.14 se difiere (plan B de (d)),
el tope sale de esta enumeración **también aquí** — la nota y el banner no pueden decir cosas distintas.

**Añadido v2.4 — la última frase.** La nota es el sitio donde el dueño lee qué hace el tope de M2 **cuando
va a editarlo**, que es justo cuando puede creer que está fijando un presupuesto. La frase es **verdad
permanente** (no caduca cuando se mida el coste) y **no lleva ninguna cifra**, así que no compite con el
banner ni hay que mantenerla en dos sitios. **No** se le añade nada sobre regímenes de cobro: eso es del
aviso de encendido, y una nota persistente con la duda entera dentro se convierte en un segundo banner.

#### 22.13(g) Etiqueta del dial

`dials.labels.gradingHookEnabled` — ES **«Gancho de grading — publica y trae datos»** · EN **«Grading hook —
publishes and fetches data»**.

La etiqueta es lo primero que se lee junto al switch; que cargue **las dos** consecuencias es la advertencia
más barata del panel. Sustituye a `gradedEstimatesEnabled` («Valor estimado si se gradea (gancho)»), que
solo nombraba la mitad — el mismo defecto de nombre que §4.38(r.1) corrigió en la `SettingKey`.

#### 22.13(h) Prohibiciones

| Prohibido | Por qué |
|---|---|
| **Modal de confirmación para encender** | Se consideró y **se rechaza**. Ya hay dos actos deliberados (el flip, con su aviso `role="alert"` en pantalla, y el guardado explícito), y el banner **sigue ahí mientras decides**, que es más de lo que consigue un modal: el clic reflejo de un modal protege menos que un texto que no se va. Además introduciría un patrón que M10 no usa para ningún otro dial. |
| **Cualquier fricción extra en el APAGADO** (modal, «escribe APAGAR», doble confirmación) | El apagado es el **botón de pánico** que el gancho no tenía (§4.38r.2). Poner fricción en la dirección segura se paga en el peor momento posible. |
| **Pintar el apagado en `warning`/`danger`** (rojo) | Convertiría en «peligroso» el remedio correcto de la duda sistémica. `info` es **tinta muted sin color propio** (§2.3): informa, no alarma. |
| **Ocultar el aviso de encendido porque falta el número de créditos** | Para eso existe `onNoFigures`. Cede la cifra, nunca el aviso. |
| **Afirmar una cifra de créditos sin su calificador en la misma frase** | Es el defecto que la v2.4 corrige (d.1). El techo nominal supone que se cobra **por petición**; si se cobra por carta devuelta, la petición pide el **set entero** y el gasto real puede ser **varias veces** mayor. Escribirla desnuda es enseñarle al dueño una hipótesis con cara de medición, **en la pantalla que existe para que no encienda a ciegas**. |
| **Calificarla solo con «aproximadamente», «~», «estimado» o «puede variar»** | Sugiere imprecisión de redondeo. El rango del error es un **factor**, no un decimal, y la causa es un **supuesto de facturación sin observar** (d.1). |
| **Degradar el calificador** (muted, `text-xs`, paréntesis final, `title`/tooltip, «ver detalles») | La cifra va en mono y destaca sola; si su condición se lee más floja, el conjunto **se lee como un hecho**. Misma doctrina que R3: un texto que exigió un clic admite la réplica «nunca lo abrí». |
| **Presentar `ingestMaxCardsPerRun` (ni su máximo de 1 000) como si acotara el gasto** | Acota las cartas **en alcance**, no las **devueltas**. Ningún dial acota el factor de amplificación. Decir «bajamos el tope, ya está acotado» crea una falsa sensación de cobertura — lo advierte §4.38(r.3.4) con esas palabras. |
| **Pintar `onMeasured` con un número que no venga de una medición del entorno** (literal, `.env`, constante «temporal») | Sería exactamente el defecto original, con la palabra «medido» encima. Sin fuente en el contrato, `onMeasured` **no se pinta** (d.1). |
| **Repetir aquí el disclaimer completo de §O.5** | El disclaimer es del **storefront** (§22.4). M10 solo dice que encender **lo publica**. |
| **Decir que el disclaimer no está aprobado** | **Ya lo está** (§22.12 nº14). Una pantalla que afirma lo contrario de lo que el producto hace es exactamente el defecto que este § existe para no cometer. |
| **Rotular estados que ya no existen** («parcial», «solo ingest», «modo prueba», «traer sin publicar») | Con un dial esos estados **no son expresables** (§4.38r.6.4). Nombrarlos en pantalla reabre el defecto que el dueño pidió cerrar. |
| **Que el color sea el único canal** del estado | El switch lleva su texto «Encendido/Apagado» (`dials.onOff`) y el título del banner dice qué pasa (§2.4). |
| **Ofrecer «apagar» como acción dentro del banner de encendido** | El control es el switch que está justo arriba. Un botón de apagado dentro del aviso duplica la palanca y desalinea el borrador con el guardado. |

#### 22.13(i) Accesibilidad y contraste — todo con pares ya verificados (§10, §17.2/§20.15)

| Elemento | Par | Ratio | Cumple |
|---|---|---|---|
| Cuerpo de los dos avisos | tinta `#1A1A18` sobre papel `#F4F1EA` | ~15.5:1 | AA/AAA |
| Línea `audit` (mono 11px) | muted `#6E695E` sobre papel | ~4.8:1 | AA |
| Icono/borde del aviso de **encendido** | accent `#B31217` sobre papel (§17.2) | ~6.2:1 | AA |
| Icono/borde del aviso de **apagado** | `--color-info` = muted `#6E695E`, fondo `transparent` | ~4.8:1 | AA |
| Enlace `<review>` + anillo de foco | accent sobre papel (§8.2) | ~6.2:1 | AA (≥3:1 UI) |

- **Cero tokens nuevos**: el aviso de apagado no estrena color porque `info` **no tiene color propio**.
- `role="alert"` **solo** en el flip a `on`; `status` en los demás (§22.13c).
- El enlace es un `<a>` real con objetivo táctil **≥ 44×44**; su destino lleva
  `scroll-margin-top: calc(var(--app-header-h,0px) + 16px)` (§4.5), como la nota al pie de §22.4a —
  aterrizar bajo un header sticky es el fallo clásico de este patrón.
- Los avisos son **texto renderizado**: nunca `title`, `tooltip` ni `<details>`. Misma doctrina que R3 en el
  storefront, aplicada al back-office — un aviso que exigió un clic admite la réplica «nunca lo abrí».
- El cambio de banner al mover el switch **no anima** y **no desplaza** el botón «Guardar» fuera de vista en
  móvil: el aviso crece hacia abajo, el botón queda debajo del aviso, no encima.

#### 22.13(j) i18n — claves nuevas y retiradas (propiedad de frontend)

- **Nuevas:** `admin.m10.dials.labels.gradingHookEnabled` ·
  `admin.m10.dials.gradingHook.{note,onTitle,on,onMeasured,onNoFigures,audit,offTitle,off}`.
- **Retiradas:** `admin.m10.dials.labels.gradedEstimatesEnabled` ·
  `admin.m10.dials.gradedEstimates.{note,warningTitle,warning}`.
- **Cambia en v2.4 (reescritura de valor, no de nombre):** `…gradingHook.on` y `…gradingHook.onNoFigures`
  (nuevo bloque «cuánto», (d)) · `…gradingHook.note` (frase final, (f)). **Nueva en v2.4:**
  `…gradingHook.onMeasured`, con **un placeholder más**, `{measuredOn}` (fecha ya formateada por el
  frontend; el ICU no formatea aquí para no duplicar la política de fechas de §9.3). Las claves
  `onTitle`, `audit` y la etiqueta del dial **no cambian**.
- **Cambia en v2.5:** `…gradingHook.off` (se retira el escalón de «grados», §22.13e) y `…gradingHook.note`
  (se retira «los grados» de la enumeración, §22.13f). **`onTitle`, `audit` y `offTitle` siguen intactas.**
  **Claves nuevas fuera de M10:** `admin.m2.gradedEstimates.ingestCap.{label,hint,warnTitleUp,warnTitleDown,warn,rangeError}`
  (§22.14c) — son de M2, no del grupo `gradingHook`, porque viven en la pantalla que edita, no en la que
  consiente.
- **El grupo se renombra a `gradingHook`** por la misma razón por la que §4.38(r.1) renombró la `SettingKey`:
  **el significado cambió, así que el nombre cambia**. Mantener un nombre viejo sobre semántica nueva es el
  mecanismo exacto por el que esta feature ya acumuló divergencias en silencio.
- **Longitudes (§9.4):** el cuerpo de encendido pasa en v2.4 de ~600 a **~980 caracteres en ES** (~960 EN)
  por el bloque «cuánto»; `onMeasured` mide ~800/~790 y `onNoFigures` ~780/~770; el de apagado sigue en
  ~570/~560. Es, con diferencia, el texto más largo del panel de M10: **debe envolver sin tocar tamaños** y
  el banner **no lleva alto fijo, ni scroll interno, ni truncado**. En 390px ocupa varias pantallas de alto
  y está bien: es un aviso de gasto, no una etiqueta. **Crecer no es el defecto** — el defecto era caber
  diciendo algo falso.
- ES es la referencia y **EN es obligatorio** (§9.2): un aviso de gasto que solo existe en un idioma es un
  aviso que alguien no leerá.

#### 22.13(k) QA visual sugerido

(a) Con el dial guardado en `off`, la pantalla muestra **solo la nota**: ningún banner, ningún hueco
reservado. (b) Mover el switch a `on` **sin guardar** ⇒ aparece el aviso de encendido con `role="alert"`, y
revertir el switch lo **retira** sin dejar rastro. (c) Con el dial guardado en `on`, el mismo texto sigue
visible como `status` — **no** desaparece tras guardar. (d) Mover el switch a `off` estando guardado en `on`
⇒ aparece el aviso de apagado, **en muted, sin rojo**. (e) Los dos avisos **nunca** se ven a la vez.
(f) Forzar el fallo de `GET /admin/pricing/graded-estimates` ⇒ el aviso de encendido **sigue apareciendo**
en su variante `onNoFigures` (si desaparece, es el bloqueante), **y ese texto no insinúa que el tope acote el
gasto**. (g) La cifra de créditos se mueve al cambiar
`ingestMaxCardsPerRun` en M2 — si no se mueve, está hardcodeada. (h) El enlace de la lista de revisión
**aterriza en la sección**, con su encabezado visible bajo el header sticky. (i) EN completo en los dos
avisos, la nota y la etiqueta. (j) Lector de pantalla: al encender se **anuncia** el aviso; al apagar se
anuncia sin interrumpir. (k) **Cero apariciones** de la frase «no tiene el visto bueno del dueño» en
`messages/`.

**Añadido v2.4 — la verificación de la calificación (es la que faltaba, y la que un test estaba impidiendo):**

(l) **Ninguna cifra de créditos aparece sin su condición en la misma frase.** Se comprueba a ojo en pantalla
y por búsqueda en `messages/`: cada `{credits}` de `on` va acompañado de «si cobra por petición» / «if it
charges per request», y el párrafo dice «La primera corrida lo mide» / «The first run measures it».
(m) **El test del frontend no puede fijar la cifra desnuda.** La aserción vigente
`/1[.,\s]?000 créditos al día/` de `M10View.test.tsx` **fija la falsedad y la protege**: se sustituye por una
que exija **la frase condicional completa** (cifra **+** régimen de cobro **+** «la primera corrida lo mide»).
*Un test que fija un número sin su calificador convierte un error de producto en un invariante de CI* — es el
mismo mecanismo por el que este defecto sobrevivió a una revisión. (n) **`onMeasured` sin fuente no se
pinta:** forzar `costBasis = 'measured'` en el módulo de coste **cambia el texto al medido sin editar ni una
cadena** (si hay que reescribir algo, el previsto no está previsto), y **fuera de esa prueba manual el
selector devuelve `'estimated'`**. (o) **Búsqueda negativa en `messages/`:** cero apariciones de
«aproximadamente {credits}», «~{credits}» o «{credits} créditos al día» sin condicional delante.
(p) El calificador se renderiza con **la misma tinta y el mismo tamaño** que el resto del cuerpo: si se ve
más claro o más pequeño que la cifra, es un fallo de (b).

**Añadido v2.5 — cada puntero, contra el producto (no contra un documento):**

(q) **Todo control que el copy nombre se abre y se usa.** Con el aviso delante: el enlace de la lista de
revisión lleva a la sección, «margen mínimo» existe como campo en M2, «Actualizar precios ahora» es un botón
real, y —con §22.14— «el tope» es un campo editable. **Si un nombre del copy no se puede seguir hasta un
control, el copy está mal, no el producto.** (r) **Cero apariciones de «grados» como remedio** en
`admin.m10.dials.gradingHook.{off,note}` de `messages/`: mientras no exista editor, nombrarlo es prometer
una palanca inexistente. (s) Guardar el tope en M2 **mueve la cifra del aviso de M10** sin recargar
(§22.14f f) — es el mismo check por los dos lados, y es el que demuestra que la palanca y el aviso son la
misma feature.

---

### 22.14 El tope de cartas por corrida en M2 — la palanca que el aviso promete (v2.5, 2026-08-31)

> **Por qué existe este §.** El aviso de §22.13(d) dice que el tope **«se edita en M2 · Catálogo y
> precios»**. **M2 no dibuja ese campo.** Verificado contra el código que corre, no contra otro documento:
> `GradedEstimatesSection.tsx` pinta escalones, `minUpsidePct`, `freshnessDays` y **dos párrafos read-only**
> (`confidenceDials`, `grades`) — `ingestMaxCardsPerRun` **no aparece**, ni en un `Input` ni en el payload
> del `PUT` (`save()` manda solo `gradingCostTiers`, `minUpsidePct`, `freshnessDays`). En todo el frontend
> la clave sale **una vez** en un fixture de test y **una vez** en `M10View.tsx:218`, que la **lee**.
>
> **La falla es de la misma familia que la que corrigió la v2.4, y en el mismo párrafo.** Aquélla afirmaba
> un número que nadie había medido; ésta manda al dueño a un sitio **donde no puede hacer lo que la pantalla
> le acaba de decir que haga**. Y no es un puntero cualquiera: es **la única palanca que el propio aviso le
> ofrece frente al gasto** — un dueño que lee el techo, quiere bajarlo antes de encender, va a M2 y no
> encuentra nada.

#### 22.14(a) La decisión: **M2 gana el campo** (opción 1), no se ablanda el copy

Se evaluaron las dos salidas y **se elige que el sitio exista**, no que el texto lo esquive:

| Salida | Coste | Veredicto |
|---|---|---|
| **(1) M2 dibuja el campo** | un `Input`, su validación `[1, 1000]`, un campo más en el payload y **un aviso de créditos nuevo** (redactado abajo) | ✅ **Elegida** |
| (2) Ajustar el copy a que hoy no se puede | casi cero | ❌ Solo como **plan B** de QA (c) |

**Las tres razones, en orden de peso:**

1. **Es el dial del dinero.** `ARCHITECTURE.md` §4.38(r.3) lo declara **«la única cota entre un `PUT` y la
   factura del proveedor»**. Que la única cota no tenga campo mientras `minUpsidePct` y `freshnessDays`
   —que no gastan un peso— sí lo tienen, es la asimetría exactamente al revés.
2. **El dueño ya rechazó este defecto una vez, en esta misma feature.** El gancho tenía dos interruptores y
   el segundo **nunca se dibujó**: la única forma de tocarlo era `curl`. Eso costó el rediseño a dial único
   (**M-46**, §4.38r.1). Dejar la palanca de gasto en el mismo estado —editable «por contrato», invisible en
   el panel— es **enviar el mismo bug otra vez, una pantalla más allá**.
3. **El aviso ya lo prometió.** Un consentimiento que ofrece un remedio inexistente no es un consentimiento
   informado: es un formalismo. Corregir el copy hacia abajo lo arreglaría **para el documento** y lo
   dejaría roto **para el dueño**.

**No hay cambio de contrato:** `GradedEstimateConfigInput.ingestMaxCardsPerRun` ya es opcional
(`contract.ts:2598`) y el `PUT` acepta campos parciales. **Verificado.**

#### 22.14(b) Dónde vive dentro de la sección del gancho de M2

La sección tiene hoy tres bloques (escalones · `minUpsidePct` + `freshnessDays` en retícula de 2 · párrafos
read-only). El tope **no entra en la retícula de dos columnas**: entra en un **bloque propio**, separado por
regla (`border-t border-border pt-4`), **debajo** de esa retícula y **encima** de los párrafos read-only.

**Por qué bloque propio y no una tercera celda.** Los dos vecinos son **gates de publicación**: deciden qué
se enseña. Éste decide **qué se gasta**. §7.6 ya separa las acciones de dinero saliente del resto del
formulario, y meterlo como tercera celda lo haría leerse como **un ajuste más de presentación** — que es,
literalmente, cómo se llegó hasta aquí. Encabezado `h3 text-sm font-semibold`, igual que «Escalones».

| Elemento | Spec |
|---|---|
| `Input` | `type="text" inputMode="numeric"`, `className="w-32"`, `label` = `ingestCap.label`. Mismo componente y mismo ancho que `freshnessDays` — **cero componentes nuevos** |
| Ayuda | `text-xs text-muted` bajo el input (`ingestCap.hint`), como los otros dos |
| Aviso de créditos | `Banner` §7.5 **dentro del bloque**, inmediatamente bajo la ayuda. Solo cuando el borrador difiere del valor guardado (d) |
| Estado guardado | **Sin cifra de créditos.** El bloque en reposo enseña el tope y su ayuda, nada más |

**El estado en reposo no lleva créditos a propósito.** El techo permanente ya se le enseña al dueño en el
aviso de M10, que es **la pantalla del consentimiento y del estado**; M2 es **la pantalla de la edición**, y
aquí la cifra tiene que aparecer **en el momento en que el número cambia**, que es cuando decide. Es la misma
doctrina de §22.13(c): *el aviso lo elige el momento del cambio*. Repetir el techo en reposo en las dos
pantallas crea dos sitios que mantener y ninguno que mande.

#### 22.14(c) Copy — etiqueta, ayuda y el aviso de créditos (I8-B2 del techlead)

| Clave (`admin.m2.gradedEstimates.ingestCap.*`) | ES | EN |
|---|---|---|
| `label` | Tope de cartas por corrida | Per-run card cap |
| `hint` | Cuántas cartas tuyas mira el barrido en cada corrida (1–1 000). Acota **el alcance**, no lo que el proveedor te cobra. | How many of your cards the sweep looks at on each run (1–1,000). It limits **scope**, not what the provider bills you. |
| `warnTitleUp` | Estás subiendo el techo de gasto | You are raising the spending ceiling |
| `warnTitleDown` | Estás bajando el techo de gasto | You are lowering the spending ceiling |
| `warn` | Con **{maxCards} cartas** por corrida y **{runs} corridas al día**, el techo son **{credits} créditos al día** si el proveedor cobra por petición; si cobra por carta devuelta, cada petición pide el **set entero** y la factura puede ser **varias veces** esa cifra. Nadie lo ha medido todavía: la primera corrida lo mide. Guardar no cobra nada — se cobra en la siguiente corrida, y solo si el gancho está **encendido** en M10. | With **{maxCards} cards** per run and **{runs} runs a day**, the ceiling is **{credits} credits a day** if the provider charges per request; if it charges per returned card, each request asks for the **whole set** and the bill can be **several times** that figure. Nobody has measured it yet: the first run measures it. Saving costs nothing — the charge happens on the next run, and only if the hook is **on** in M10. |
| `rangeError` | Un número entero entre 1 y 1 000. | A whole number between 1 and 1,000. |

- **El aviso hereda la regla de calificación de §22.13(d.1) sin excepción.** Mismos dos regímenes, misma
  frase «la primera corrida lo mide», mismo `{credits}` calculado por el **mismo módulo único**
  (`grading-hook-cost.ts`) que ya usa M10. **Una sola aritmética en el producto**: si esta pantalla derivara
  la suya, en la siguiente revisión dirían cosas distintas.
- **La última frase —«Guardar no cobra nada»— es la que hace este aviso útil y no alarmista.** Sin ella, un
  `Banner` de gasto al editar un número sugiere que el clic en «Guardar» mueve dinero, y el efecto es que el
  dueño **no toca el tope**: justo lo contrario de lo que este § persigue. Y es verdad verificable: el ingest
  corre por cron y sale antes de pedir nada si el gancho está apagado.
- **Nombra M10 porque el interruptor está allí**, y M2 ya tiene el espejo read-only del maestro
  (`masterSwitch` + `masterSwitchHint`) justo arriba: el puntero **existe en pantalla**. Verificado.
- **`warnTitleUp` / `warnTitleDown`:** el cuerpo es el mismo; cambia el título. **Subir** usa
  `Banner variant="warning"`, **bajar** usa `variant="info"`. El color **no es el único canal** (§2.4): el
  título dice la dirección. **Cero tokens nuevos** — `warning` es el rojo de marca vía `--color-accent` y
  `info` es muted sin color propio (§2.3).
- **El aviso NO bloquea el guardado.** No es un error: es información en el momento de decidir. Lo único que
  bloquea es el rango, con `rangeError` en el propio `Input` (patrón ya vigente en la sección).
- **`role="status"`, nunca `alert`.** El dueño está tecleando en su propio borrador; interrumpir un campo
  numérico en cada pulsación con una región asertiva es hostil con lector de pantalla. Mismo criterio que el
  aviso de apagado de §22.13(c).

#### 22.14(d) Estados y validación

| Estado | Qué se pinta |
|---|---|
| En reposo (borrador = guardado) | Input + `hint`. **Sin banner** |
| Borrador > guardado | Banner `warning`, título `warnTitleUp`, cuerpo `warn` con el valor **del borrador** |
| Borrador < guardado | Banner `info`, título `warnTitleDown`, mismo cuerpo |
| Fuera de `[1, 1000]` o vacío | `rangeError` en el `Input`, **guardado bloqueado**, y el banner **no muestra cifra** (no se calcula un techo con un número inválido) |
| Config no disponible | El bloque entero no se pinta — lo cubre el `QueryState` que ya envuelve la sección |

- **Rango `[1, 1000]`** — I8, contrato **v1.51-a**. **Nunca 5 000**: ese valor quedó fuera del contrato y
  escribirlo en un `placeholder`, en un ejemplo o en un test es reintroducirlo por la puerta de atrás.
- **Entero.** Se valida en cliente para **prevenir** el 422, no para sustituirlo: la fuente de verdad sigue
  siendo el servidor, y un 422 se muestra tal cual (patrón ya vigente en la sección).
- **Money-safe:** campo vacío **no se guarda como 0** ni como el default. Mismo criterio S-P1-1 que el costo
  de gradeo — aquí un 0 no sería un cobro, sería un ingest que no mira nada, pero la dirección del fallo debe
  ser explícita, no accidental.

#### 22.14(e) Prohibiciones

| Prohibido | Por qué |
|---|---|
| Meterlo como tercera celda de la retícula «margen mínimo / frescura» | Lo iguala visualmente a dos diales que no gastan (b). |
| Pintar la cifra de créditos en reposo | Duplica el techo en dos pantallas; el estado es de M10, la edición es de M2 (b). |
| Que el banner bloquee «Guardar» | No es un error. Bloquear la única palanca de contención es el peor resultado posible. |
| Cifra de créditos **sin su calificador** | §22.13(d.1) aplica **igual** aquí. Es la misma cifra y la misma incertidumbre. |
| Derivar el cálculo en esta pantalla | Un solo módulo, el de M10. Dos aritméticas divergen. |
| Mostrar **5 000** en cualquier sitio (placeholder, ayuda, ejemplo, test) | Fuera del contrato desde v1.51-a. |
| Un `confirm()` o modal al subir el tope | La sección no usa ese patrón para ningún otro dial, y guardar **no cobra**: la fricción iría en el sitio equivocado. |

#### 22.14(f) QA visual

(a) El campo **existe y se ve** en M2, en su bloque propio bajo la retícula. (b) Teclear un valor mayor ⇒
banner `warning` con el título de subida y la cifra **del borrador**, no la guardada. (c) Teclear uno menor
⇒ banner `info`, título de bajada. (d) Volver al valor guardado ⇒ el banner **desaparece**. (e) `0`, vacío,
`1001` o `5000` ⇒ `rangeError` y «Guardar» deshabilitado; **sin cifra de créditos en pantalla**. (f) Guardar
⇒ el número nuevo aparece en **el aviso de M10** sin recargar (misma `queryKey` `['graded-estimates-config']`
que la sección ya usa — la invalidación existente lo cubre). **Este es el check que cierra el círculo: la
palanca que el aviso promete mueve la cifra que el aviso enseña.** (g) EN completo. (h) Lector de pantalla:
el banner se anuncia **sin** interrumpir la escritura. (i) Búsqueda en `messages/`: cero apariciones de
`5000`/`5 000` en las claves del gancho.

---

## 23. Rotación automática del carrusel de destacadas (v2.6 — P-49)

> **Procedencia:** decisión **del dueño** (P-49), tomada **después** de oír el análisis del frontend, que
> recomendó no hacerlo. La decisión está tomada y esta sección **no la re-litiga**. Pero los tres argumentos
> del frontend eran **hechos**, no opiniones, y un hecho no se resuelve ignorándolo: §23.1 reconcilia la
> doctrina de movimiento de §17.3, §23.8 corrige la nota 2 de §20.16 y §23.7 cierra el hueco real de
> `prefers-reduced-motion`. Superficie afectada: **una** (`FeaturedCarousel`, el estante «Piezas destacadas
> del catálogo» de la home, §20.3). **Cero tokens nuevos, cero componentes de dominio nuevos, cero datos
> nuevos, cero cambios de contrato ni de arquitectura.**

### 23.0 Las siete reglas duras

Si una sola de estas siete se incumple, la entrega está mal aunque «se vea bien»:

| # | Regla | Dónde |
|---|---|---|
| R1 | **Rota la VENTANA, nunca el ROL.** El DOM del carrusel es inmutable: la teja líder sigue siendo la teja 1, con su imagen HD, su `priority` y su anatomía propia. Lo que se mueve es el `scrollLeft` de la pista | §23.2 |
| R2 | **La rotación nunca coexiste con un estado de carga.** No arranca hasta que la consulta resolvió y la imagen de la teja líder cargó. Nada de rotar sobre skeletons | §23.1, §23.3 |
| R3 | **El control de pausa está SIEMPRE visible** mientras haya rotación posible — nunca oculto tras `hover`, nunca solo en `focus`, nunca dentro de un menú | §23.4 |
| R4 | **`prefers-reduced-motion` ⇒ movimiento CERO.** No «más lento», no «sin easing»: el temporizador no arranca y el scroll por JS es instantáneo | §23.7, §8.2 |
| R5 | **La intervención del usuario gana para siempre** (en esa visita). Nada de reanudar solo tras N segundos | §23.5 |
| R6 | **Un solo paso por tic: una teja**, aterrizando en su punto de `snap`. Ningún reposo deja una teja cortada por el **borde izquierdo** | §23.3 |
| R7 | **Sin clones, sin bucle infinito, sin rebobinado animado.** La pista hace **una pasada** y se detiene; volver al inicio es una acción **del usuario** | §23.6 |

### 23.1 Reconciliación con §17.3 — por qué este movimiento no es el movimiento prohibido

El argumento del frontend era exacto: **§17.3 establece que en este sistema el movimiento no decorativo se
lee como estado de carga** (por eso la mira no gira y por eso agregar al carrito no anima nada, §18.4). Un
carrusel rotando en la primera pantalla, encima de imágenes que están cargando, se leería como «la página
sigue trabajando». No se ignora: se resuelve en dos movimientos.

**Primero, se precisa la doctrina.** §17.3a (nuevo) separa **movimiento-de-estado** (pulso, giro, brillo: en
el sitio, indefinido, dentro del elemento que carga — **prohibido, sin excepciones**) de
**movimiento-de-presentación** (traslación de un contenedor con destino y llegada, sobre contenido ya
resuelto). La doctrina no se debilita: se enuncia con precisión. §18.4 y la prohibición de animar la mira
**siguen intactas**.

**Segundo, se paga el precio de la excepción.** Este carrusel cumple las cuatro condiciones de §17.3a, y las
dos primeras son las que desactivan literalmente el argumento:

1. **Nunca coexiste con carga (R2).** No hay ningún instante en que el usuario vea a la vez un skeleton y un
   desplazamiento. La confusión que §17.3 teme requiere **simultaneidad**, y aquí es imposible por
   construcción. Concretamente: mientras `QueryState` pinta el skeleton **no hay rotación**, y la rotación
   tampoco arranca en el mismo fotograma en que la pista aparece — media un reposo de **7 s** (§23.3) en el
   que la home está **completamente quieta**. Lo primero que ve cualquiera es una página en reposo.
2. **Traslada, no palpita.** Un spinner no tiene destino; esto sí, y cada llegada es una composición
   completa. El ojo lee «el estante pasó de página», no «el sistema está pensando».
3. **Reposo dominante:** ≈ 0,55 s de movimiento por cada 7,55 s ⇒ **≈ 7 % del tiempo**. Un indicador de
   carga está en marcha el 100 %. Es una diferencia de categoría, no de grado.
4. **Es interrumpible, con el freno a la vista** (§23.4), **acotada** (una sola pasada, §23.6) y
   **inexistente** con movimiento reducido (§23.7).

**Y hay una diferencia que ninguna condición captura pero que sostiene todo lo anterior:** un indicador de
carga aparece **donde el usuario acaba de pedir algo** (el botón que pulsó, la teja que se está pintando).
Este movimiento ocurre en un estante **que el usuario no ha tocado**, con contenido ya resuelto delante. El
contexto desambigua antes que la forma.

> **Consecuencia normativa:** ésta es la **única** excepción de movimiento-de-presentación del sistema y
> está autorizada **solo aquí**. No es un precedente para animar transiciones de página, aparición de tejas,
> gráficas, banners ni ningún otro estante (Sellado, Gradeadas, Bounties, «Joyas para gradear» **no rotan**).
> Cualquier otro caso vuelve a §17.3a y debe pasar por ux-ui.

### 23.2 Qué se mueve y qué NO — la ventana, nunca el rol (R1)

**Restricción dura, heredada del análisis del frontend y no negociable.** La teja líder **no es solo más
ancha**: usa `imageLargeUrl` (las demás la chica, a propósito), lleva `priority`/`fetchpriority=high` porque
es **la candidata a LCP de la home**, y tiene otra tipografía (serif 26px vs. 16px), otra disposición
(nombre y precio en fila `justify-between`, no apilados) y otro `surface` del badge de grading
(`featuredLead` vs. `featuredRest`, §22.6b).

> **Regla: el contenido NO rota entre tejas. La rotación desplaza la ventana sobre una pista inmutable.**

Lo que esto prohíbe, y por qué cada cosa:

| Prohibido | Qué pasaría |
|---|---|
| Que la teja 2 «ascienda» a líder en el tic | Cada tic **remaquetaría dos tejas** (400px⟷268px, serif 26⟷16, fila⟷columna) y **dispararía una descarga HD nueva cada 7 s**. Ocho descargas de ~734×1024 en la primera pantalla, en cascada |
| Clonar tejas para simular un bucle | Duplica `key`s, duplica el **nombre accesible** de cada teja (que en esta pista incluye la cifra del gancho y el micro-aviso, §22.6b-h) y rompe «orden de DOM = orden de lectura» |
| Reordenar el array entre tics | Mismo efecto que lo anterior + rompe el orden **precio descendente**, que es un hecho del catálogo (§22.6b-i nº4) |
| Mover `priority` de teja en teja | Varias `fetchpriority=high` compitiendo: retrasa justo a la que importa |

**Lo que sí ocurre:** la teja líder está en su sitio (primera de la pista) y, según avanza la ventana, sale
por el borde izquierdo como cualquier otra. Eso **no** es «perder el rol»: sigue siendo la teja 1, con su HD
ya descargada, y vuelve a entrar intacta si el usuario retrocede o pulsa «Repetir». El LCP se mide en la
carga, muy antes del primer tic.

**Corolario de implementación (nivel diseño, no código):** el único estado que la rotación escribe es la
**posición de scroll**. Si un tic obliga a re-renderizar una teja, el diseño se está implementando mal.

### 23.3 Cadencia — 7 s, **una teja**, ≈ 550 ms

**Cuánto dura el reposo: 7 segundos.** No es un número redondo elegido al azar; sale de contar lo que hay
que leer en la teja que **entra**:

| Qué se lee en una teja | Coste |
|---|---|
| Nombre serif (2–3 palabras, en inglés) + renglón mono `SET · #NNN` + acabado + precio + distintivo de stock | ≈ 12 palabras ⇒ **≈ 3,6 s** a ~200 ppm de lectura silenciosa |
| Adquirir la imagen (el arte es el héroe, §5: la mirada va primero ahí) | **≈ 0,8 s** |
| Burbuja del gancho cuando la teja la lleva (cifra + micro-aviso, §22.6b) | **≈ 1,2 s** |
| Margen de seguridad (ES es ~25 % más largo que EN, §9.4) | **≈ 1,4 s** |
| **Reposo total** | **7 s** |

Dos notas sobre ese 7:
- **Está deliberadamente por encima del umbral de 5 s de WCAG 2.2.2**, que es lo que hace **obligatorio** el
  mecanismo de pausa. La alternativa —bajar de 5 s para «librarse» del requisito— sería más rápida que la
  lectura y peor para todo el mundo. Se elige leer bien y pagar el control (§23.4).
- **El reposo inicial es también de 7 s**, contados desde que la rotación se vuelve posible (§23.8). Nadie
  ve moverse nada durante los primeros 7 s de vida del estante.

**Cuánto avanza: exactamente UNA teja (R6).** No una «página».

- Si avanzara una página (≈ 0,8 × ancho de la pista, que es lo que hacen las flechas), en `lg` cambiarían
  **~3,5 tejas de golpe**: prácticamente todo lo visible. El usuario tendría que **releerlo todo cada 7 s**,
  y los 7 s están calibrados para **una** teja nueva, no para tres y media. Ése es exactamente el patrón de
  cartel publicitario que la gente aprende a ignorar.
- Con una teja por tic el usuario **conserva el contexto**: 3 de 4 tejas visibles siguen ahí, entra una
  nueva por la derecha, sale una por la izquierda. La pista «respira»; no «cambia de anuncio».
- **Las flechas no cambian** (§20.3): siguen moviendo una página. Es correcto que difieran — la flecha es una
  orden explícita («llévame lejos»), el tic es un ofrecimiento («mira, hay más»).

**Cómo avanza:** una sola traslación continua, con salida suave (`ease-out`), de **≈ 550 ms**
(≈ 296px en `lg` = teja 268 + gap 28; ≈ 176px en móvil = 160 + 16). El `scroll` suave nativo del navegador
es aceptable y **no** se le superpone ninguna transición CSS. Requisitos visuales del aterrizaje:

- **Aterriza en el punto de `snap` de la teja entrante** (destino calculado desde el `offsetLeft` de la
  teja, no `scrollBy(ancho × 0,8)`). Un tic que termina a mitad de teja deja **media teja cortada por el
  borde izquierdo**, y eso no es una composición: es un error de maquetación.
- Media teja cortada por el **borde derecho** es correcto y deseable — es la señal de «hay más».
- **Ni un solo tic acumulado.** Si la rotación estuvo suspendida (pestaña oculta, puntero encima, fuera de
  pantalla), al reanudar **no se recuperan** los tics perdidos: se reinicia el reposo de 7 s. Un carrusel
  que «se pone al día» de golpe es el peor movimiento posible en este sistema.

**Cuándo puede arrancar (R2) — las cuatro precondiciones, todas:**
1. El componente está **hidratado** (§23.8).
2. La consulta **resolvió** y hay ≥ 1 teja (nada de rotar en `isLoading` ni en `isError` ni en vacío).
3. La **imagen de la teja líder ha cargado** (`load`), o han pasado **3 s** desde que se resolvió el dato —
   lo que ocurra antes. El tope evita que una imagen remota lenta deje el estante muerto para siempre.
4. Ha pasado el **reposo inicial de 7 s**.

### 23.4 El control de reproducción — **la decisión que bloqueaba el código**

Es obligatorio: **WCAG 2.2.2 (nivel A)** exige un mecanismo para pausar cualquier movimiento automático que
dure más de 5 s. La pregunta era **dónde vive**, porque la fila de §20.3 está definida al píxel (H2 29px ⟷
link «Ver todo el catálogo» ⟷ dos flechas de 38px / 32px) y **por debajo de `sm` esa fila ya sacrifica el
link por falta de sitio**. Un tercer control no cabe ahí.

#### 23.4a La decisión

> **El control NO es una tercera flecha. Es un conmutador de texto mono, pegado al H2, en el hueco
> estructural del *kicker* (§20.5) — a la IZQUIERDA de la fila, en las tres anchuras.**

Tres razones, en orden de peso:

1. **No es de la misma familia que las flechas.** Las flechas son **navegación** (mueven la ventana un paso).
   El conmutador es **el estado del estante entero**. Tres cuadrados idénticos de 32px obligarían a **leer
   el glifo** para distinguir «atrás / adelante / pausa»; hoy la forma sola basta. Mezclar categorías en un
   grupo degrada las dos: se pierde la lectura instantánea de las flechas y se disfraza de flecha algo que
   no lo es.
2. **El lado izquierdo es el lado libre en las tres anchuras** (medidas abajo), y es el lado donde vive el
   **nombre** del estante. «Destacadas · PAUSAR» se lee como lo que es: *este estante, este comportamiento*.
   Junto a las flechas, en cambio, se leería como una tercera dirección.
3. **Orden de tabulación correcto y gratis.** Al ir pegado al H2 es el **primer control del carrusel** y
   precede en el DOM tanto a las flechas como a la pista. Quien llega con teclado se topa con el freno
   **antes** que con lo que se mueve, que es justo lo que pide 2.2.2.

**Es texto, no icono solo.** Un icono de pausa aislado es reconocible pero ambiguo en su efecto («¿pausa qué,
el vídeo que no hay?»). La palabra lo dice; el glifo lo acelera. Y el sistema ya habla en mono-versalitas:
no se inventa un lenguaje.

**Conciliación con §22.6b-e (que prohíbe kicker en este encabezado):** esa prohibición es sobre **kicker de
contenido** — cualquier texto que **afirme algo sobre las piezas** (gradeo, estimados, oportunidad) y que
convertiría el carrusel en una vitrina de gancho. Sigue vigente **literalmente**. El conmutador no afirma
nada sobre ninguna pieza: nombra el **comportamiento del estante**. Ocupa el mismo hueco estructural, no el
mismo rol semántico. **Sigue prohibido** cualquier otro kicker, subtítulo o mención al gradeo en esta fila.

#### 23.4b Anatomía, al mismo nivel de detalle que §20.3

Elemento: `<button type="button">` (nunca un `<div>` con `onClick`, nunca un `<a>`).

| Propiedad | móvil (< 640) | `sm` (640–1023) | `lg` (≥ 1024) |
|---|---|---|---|
| Posición | Pegado al H2, **a su derecha**, mismo grupo flex | igual | igual |
| Separación al H2 (`gap`) | **12px** | **12px** | **16px** |
| Alineación vertical | `align-items: baseline` con el H2 (idéntico al kicker de §20.5) | igual | igual |
| Glifo | lucide `Pause`/`Play`/`RotateCcw`, **12px**, `strokeWidth 1.5`, `aria-hidden` | 12px | **14px** |
| Separación glifo⟷palabra | **6px** | 6px | **6px** |
| Palabra | mono **10px**, peso 500, `letter-spacing .18em`, `text-transform: uppercase` (clase `.eyebrow`, §20.15: **el texto fuente va en caja normal**, las versalitas las pone el CSS) | igual | igual |
| Color en reposo | **tinta `--color-text` `#1A1A18`** (glifo y palabra) | igual | igual |
| Ancho reservado del bloque | **`min-width: 80px`** (cubre la más larga de las tres etiquetas en ES, `REANUDAR` ≈ 62px + glifo + gap). El ancho **no cambia** al cambiar de estado: la fila no baila | igual | igual |
| Alto visual | ≈ 12px (una línea mono) | igual | ≈ 14px |
| Área táctil | **44×44px mínimo**, obtenida con un **pseudo-elemento** (`::after`, `inset: -16px -8px`), **no con `padding`** | igual | igual |
| Borde, fondo, radio, sombra | **ninguno** (§4.2, §4.3) | — | — |

- **Por qué pseudo-elemento y no `padding`:** el `padding` agrandaría la caja visual y, con `outline-offset:
  2px`, el anillo de foco dibujaría un rectángulo de 44px de alto alrededor de un texto de 12px — un halo
  desproporcionado en una fila donde el resto de los focos son ajustados. Con `::after` el área táctil crece
  y **el anillo sigue ciñendo la etiqueta**.
- **La expansión no puede solaparse con nada:** 8px por lado contra un `gap` de 12/16px al H2 ⇒ nunca pisa
  el título ni el link. Es un requisito verificable (§23.14 f).

#### 23.4c Estados (todos obligatorios)

| Estado | Glifo | Palabra (ES / EN) | Piel | Nombre accesible |
|---|---|---|---|---|
| **Reproduciendo** (rotando) | `Pause` (dos barras) | **PAUSAR** / PAUSE | Tinta, sin subrayado | «Pausar la rotación automática» |
| **Pausado** (por el usuario) | `Play` (triángulo) | **REANUDAR** / RESUME | Tinta, sin subrayado | «Reanudar la rotación automática» |
| **Terminado** (pista en el extremo, §23.6) | `RotateCcw` | **REPETIR** / REPLAY | Tinta, sin subrayado | «Repetir desde el principio» |
| **Hover** | igual al estado actual | igual | **Subrayado de 1px** en tinta (mismo lenguaje que `EditorialLink`, §20.0); `cursor: pointer` | — |
| **Focus-visible** | igual | igual | **Anillo `--color-focus-ring` 2px, `outline-offset: 2px`** (§8.2), ciñendo la etiqueta | — |
| **Disabled** | **no existe** | — | — | — |
| **Loading** | **no existe** | — | — | — |
| **Suspensión por hover/foco/fuera de pantalla** | **no cambia nada** (silenciosa, §23.5) | — | — | — |

- **Nunca `disabled` y nunca `loading`.** Si no hay rotación posible, el control **no se renderiza**
  (§23.4d): un freno apagado junto a algo quieto es ruido, y junto a algo que se mueve es un fallo de A.
- **Regla de nombre en la etiqueta (WCAG 2.5.3):** el nombre accesible **empieza por la palabra visible**
  («**Pausar** la rotación automática»). Quien dicta por voz «pausar» activa el control. Prohibido un
  `aria-label` que no contenga la palabra visible.
- **Cambio de estado = cambio de etiqueta visible y accesible** (patrón APG de carrusel). **No se usa
  `aria-pressed`**: «presionado» es ambiguo para un par pausa/reproducción (¿presionado significa pausado o
  sonando?), y APG resuelve este control cambiando el nombre, no el estado de conmutación.

#### 23.4d Cuándo el control NO se renderiza

En los cinco casos, **no hay rotación**, así que no hay nada que frenar y el control desaparece entero (no
deshabilitado, no invisible: ausente):

1. `prefers-reduced-motion: reduce` (§23.7).
2. Antes de hidratar / sin JS (§23.8).
3. La pista **no desborda** (todas las tejas caben: nada que rotar; las dos flechas ya se apagan hoy).
4. Estados de carga, error o vacío del estante (`QueryState`): no hay pista.
5. Una sola teja.

Su aparición/desaparición **no mueve nada más de la fila**: entra a la derecha del H2, dentro del grupo
izquierdo, y el grupo derecho está anclado por `justify-between`. Ni el título ni el link ni las flechas se
desplazan un píxel.

#### 23.4e Presupuesto de la fila — la cuenta en las tres anchuras

Lo que había que demostrar es que el control **cabe sin tocar el grupo derecho**. Medidas en ES (el idioma
largo, §9.4), con el H2 corto (`featuredTitleShort` = «Destacadas») por debajo de `lg`, como ya hace §20.11:

| Anchura | Grupo izquierdo | Grupo derecho | Suma + `gap` | Disponible | Holgura |
|---|---|---|---|---|---|
| **móvil 390** | «Destacadas» serif 22px ≈ **118** + 12 + **80** = **210** | link **oculto** + flechas 32+8+32 = **72** | ≈ **298** | 390 − 2×20 de `gutter` = **350** | **≈ 52px** |
| **`sm` 640** | ≈ **210** | «Ver todo el catálogo» ≈ **145** + 16 + **72** = **233** | ≈ **459** | 640 − 2×24 = **592** | **≈ 133px** |
| **`lg` 1024+** | «Piezas destacadas del catálogo» serif 29px ≈ **400** + 16 + **84** = **500** | ≈ 145 + 22 + 38+8+38 = **251** | ≈ **773** | contenedor ≈ **1200** | **≈ 427px** |

- **La anchura crítica es móvil**, y la holgura es de ~52px. A **360px** siguen sobrando ~22px. Por debajo
  de 360px la fila **envuelve a dos líneas**, que es exactamente lo que ya hace hoy (`flex-wrap`), y lo hace
  bien: como el conmutador **pertenece al grupo del título**, al envolver baja el par completo
  «título + conmutador» arriba y «link + flechas» abajo. **Nunca** queda el conmutador huérfano junto a las
  flechas, y **nunca** se separa del estante que nombra.
- **Prohibido resolver la estrechez quitando la palabra** y dejando el glifo solo en móvil: sería, otra vez,
  un tercer cuadrado ambiguo, y justo en la anchura donde menos contexto hay.

### 23.5 Máquina de estados — suspensión temporal vs. pausa permanente

Dos niveles, y no se mezclan. Ésta es la distinción que evita que el carrusel pelee con el usuario.

**Nivel 1 — SUSPENSIÓN (temporal, silenciosa, reversible sola).** El modo sigue siendo «reproduciendo»; el
temporizador simplemente no corre. El control **no cambia** de etiqueta, glifo ni piel. Causas:

| Causa | Se reanuda cuando |
|---|---|
| **Puntero encima** de la sección (`pointerenter`, incluye encabezado y pista) | El puntero sale |
| **Foco de teclado dentro** de la sección (conmutador, flechas, pista, cualquier teja) | El foco sale de la sección |
| **Menos del 50 % de la pista visible** en el viewport | Vuelve a estar visible |
| **Pestaña oculta** (`visibilityState !== 'visible'`) | La pestaña vuelve al frente |

- **Es silenciosa a propósito.** El puntero está en la pista, a cientos de píxeles del conmutador: cambiar
  la etiqueta allá arriba sería un parpadeo que nadie ha pedido y que además **mentiría sobre el modo** (no
  se ha pausado nada; se está esperando). Al reanudar se **reinicia el reposo de 7 s** completo: nunca hay
  un tic inmediato al retirar el ratón.
- **La pausa por foco no es solo accesibilidad.** Sin ella, tabular por las tejas mientras la pista rota
  produce una pelea: el navegador desplaza para traer el foco a la vista y el temporizador desplaza en
  sentido contrario; el foco se pierde de la pantalla. Es un defecto funcional, no un detalle de A11y.
- **La pista es un tope de tabulación con nombre.** Si lleva `tabindex="0"` para poder desplazarla con
  teclado (recomendado), debe llevar además `role="group"` y `aria-label` propio (§23.9): un tope de foco
  anónimo es peor que no tenerlo.

**Nivel 2 — PAUSA PERMANENTE (para el resto de la visita, hasta que el usuario reanude).** El modo cambia a
«pausado» y el control pasa a **REANUDAR**. Causas — todas son **actos deliberados** del usuario:

| Causa | Nota |
|---|---|
| Pulsar **PAUSAR** | Obvio |
| **Swipe / arrastre** sobre la pista | — |
| **Rueda / trackpad** horizontal sobre la pista | — |
| Pulsar una **flecha** (§20.3) | Así flechas y rotación no se disputan la pista |
| **Cualquier desplazamiento de la pista que el carrusel no haya originado** — incluido el que provoca el navegador al tabular a una teja fuera de pantalla | Regla general que cubre los casos que nadie enumeró |
| Llegar a la sección por **ancla** (`#piezas-destacadas`, el regreso de la nota al pie del gancho, §22.4a) | Quien llega por el ancla viene a **inspeccionar algo concreto**. Que la ventana se le mueva bajo los ojos es el peor momento posible. **No se rebobina**: solo se detiene |

> **Decisión: la intervención pausa PARA SIEMPRE, no «durante N segundos» (R5).** Reanudar solo tiene un
> camino: que el usuario lo pida. Un carrusel que se reactiva a los 5–10 s le arranca al usuario el control
> que acababa de tomar; es el comportamiento que hace que la gente odie los carruseles, y además convierte
> el cumplimiento de 2.2.2 en algo formal (existe el botón) en vez de real (el usuario manda). El coste —que
> alguien pause sin querer y no vuelva a ver rotación— es **barato**: el contenido sigue ahí entero y las
> flechas siguen funcionando. El coste contrario no lo es.

**Transiciones completas:**

```
                 ┌──────────── REANUDAR ────────────┐
                 │                                  │
   (arranque)    ▼        PAUSAR / intervención     │
  ─────────► REPRODUCIENDO ───────────────────► PAUSADO
                 │  ▲                               ▲
   suspensión ───┘  └─── fin suspensión             │
   (hover/foco/                                     │ flecha «anterior»
    fuera de vista/                                 │ o desplazamiento
    pestaña oculta)                                 │
                 │                                  │
                 │ llega al extremo derecho         │
                 ▼                                  │
             TERMINADO ──── REPETIR ──► (vuelve al inicio y REPRODUCIENDO)
                 └──────────────────────────────────┘
```

### 23.6 Al llegar al final — **una pasada y para** (R7)

> **Decisión: la rotación hace UNA sola pasada. Al llegar al extremo derecho se detiene. No hay bucle
> automático.** Volver al inicio es una acción del usuario: el conmutador pasa a **REPETIR**.

Cuatro razones:

1. **Coherencia con lo que ya hay.** Hoy las flechas se apagan en los extremos (§20.3) y no hay vuelta. Un
   bucle automático introduciría un concepto —«la pista da la vuelta»— que **contradice** el apagado de las
   flechas en el mismo componente: la flecha «siguiente» diría «no hay más» mientras el carrusel demuestra
   lo contrario cada 7 s.
2. **El rebobinado es el peor movimiento posible en este sistema.** Volver al inicio son ~2 000px. Animado
   es un barrido de página entera que se lee como fallo o como carga (justo lo que §17.3 teme). Instantáneo
   es un salto que se lee como error. No hay tercera forma decente.
3. **La alternativa habitual —clonar tejas para un bucle infinito— está prohibida por R1** (§23.2):
   duplicaría nombres accesibles que aquí incluyen la cifra del gancho y su micro-aviso.
4. **Acota el movimiento total.** Siete tics ⇒ **≈ 49 s** y la home queda **completamente quieta** para
   siempre. El movimiento perpetuo en la primera pantalla es el verdadero irritante; una pasada única
   cumple el objetivo (revelar que hay más de lo que cabe) y se retira.

Detalles:

- **`TERMINADO` es el mismo predicado que apaga la flecha «siguiente»** (`canNext === false`). Se alcanza
  igual si la rotación llegó sola o si el usuario llegó con las flechas: un solo criterio, cero
  discrepancias.
- **REPETIR** devuelve la pista a `scrollLeft = 0` **de forma instantánea** (sin animación — es acción
  explícita del usuario, y aquí sí es la opción correcta por lo dicho en el punto 2), y arranca una pasada
  nueva con su reposo inicial de 7 s.
- Si desde `TERMINADO` el usuario pulsa la flecha «anterior» o desplaza hacia atrás, el estado pasa a
  **PAUSADO** (no vuelve a rotar solo): manda la regla de intervención (§23.5).

### 23.7 `prefers-reduced-motion` — **cero movimiento** (R4)

El frontend verificó que la regla global de `globals.css` **solo neutraliza duraciones de CSS**: no cubre ni
el scroll suave por JS ni un temporizador. Es cierto, y por eso esto se resuelve en la **lógica del
componente**. Con la preferencia activa:

| Qué | Comportamiento |
|---|---|
| Temporizador de rotación | **No arranca.** No es «arranca y salta»: no existe |
| Conmutador de reproducción | **No se renderiza** (§23.4d): no hay nada que pausar |
| Flechas de §20.3 | **Siguen funcionando**, pero con `behavior: 'auto'` — **salto instantáneo**, no desplazamiento suave |
| Ancla de regreso de la nota al pie | `scroll-behavior` instantáneo, igual criterio |
| Resto del estante (tejas, imágenes, badges) | Idéntico. **No se degrada contenido**: la preferencia quita movimiento, no información |

- **Prohibido «moverse más lento»**, «moverse sin `easing`», «rotar cada 15 s en vez de cada 7» o cualquier
  otra media tinta. La preferencia significa *no me muevas la pantalla*, no *muévemela con calma*.
- **Se escucha en vivo** (§8.2): activar la preferencia en el sistema operativo detiene la rotación en ese
  momento y hace desaparecer el conmutador, sin recargar. Desactivarla **no** rearranca la rotación de golpe
  a mitad de visita: se reanuda con su reposo inicial de 7 s.
- **`prefers-reduced-motion` gana sobre todo lo demás**, incluida una eventual preferencia guardada del
  usuario. No hay ajuste en la app que la anule.

### 23.8 Sin JS y antes de hidratar — el estado inicial, no un fallback

Esto **corrige** la nota 2 de §20.16, que decía que el carrusel debía degradar a scroll-snap nativo sin JS.

| Momento | Qué hay |
|---|---|
| **Marcado servido / sin JS** | Pista de **scroll-snap nativa** con las ocho tejas completas. Se desplaza con el dedo, con la rueda y con la barra. **No rota.** **No se pintan** ni las flechas ni el conmutador |
| **Hidratado** | Aparecen flechas y conmutador. La rotación aún **no** arranca (faltan las precondiciones de §23.3) |
| **Precondiciones cumplidas + 7 s de reposo** | Primer tic |

Regla que lo sostiene: **ningún control del carrusel se pinta si no puede funcionar.** Así no queda nunca un
botón muerto, y —lo importante para 2.2.2— **no puede existir movimiento sin freno**: ambos nacen del mismo
JS, en el mismo momento. El **contenido nunca depende del JS**; lo que depende del JS es rotar, y rotar es
un extra que se suma sobre una pista que ya funcionaba.

### 23.9 Anuncio a lectores de pantalla — patrón APG de carrusel

Para que el frontend no improvise, esto es normativo:

**(a) La región.** La `<section>` del estante (la que ya pinta `Shelf`) lleva:
- `aria-roledescription="carrusel"` / `"carousel"` — **localizado**, clave i18n propia (§23.12). Con su
  `aria-label` ya existente, el lector anuncia «Piezas destacadas del catálogo, carrusel».
- Su `aria-label` **no cambia** y **no menciona** la rotación (§22.6b-e sigue vigente).

**(b) La pista.** `id` propio, y **`aria-live` conmutando**:
- `aria-live="off"` **mientras la rotación está corriendo de verdad**.
- `aria-live="polite"` **en cuanto no corre**: pausada, terminada, suspendida por foco o por puntero, o con
  movimiento reducido. Se ata a *«¿está corriendo el temporizador ahora mismo?»*, **no al modo** — así el
  caso que importa (usuario de teclado navegando por la pista, que la suspende) queda siempre en `polite`.
- Si la pista es focuseable (`tabindex="0"`), además `role="group"` + `aria-label` propio (§23.5).

> **Honestidad sobre `aria-live` aquí:** esta pista es un **scroller con las ocho tejas presentes en el
> DOM**; nada se añade ni se quita al rotar. Por lo tanto, en esta implementación **la región viva no tiene
> nada que anunciar**. Se especifica igualmente porque es el patrón correcto, cuesta cero y protege el día
> que alguien introduzca contenido dinámico. **Pero no es el canal de estado**: el canal de estado es (c).
> Quien implemente esto **no debe dar por hecho** que el usuario de lector de pantalla se entera de algo por
> el `aria-live`.

**(c) El canal de estado real: una línea `role="status"` visualmente oculta**, propiedad del carrusel, vacía
por defecto. Emite **solo** en dos transiciones, ambas **no solicitadas** por el usuario:
- La rotación **termina la pasada**: «Fin de las piezas destacadas.»
- La rotación **se pausa por intervención** (swipe, rueda, flecha, ancla): «Rotación automática pausada.»

**No emite** cuando el usuario pulsa el conmutador (el cambio de nombre accesible del botón ya lo dice, y
duplicarlo es hablar dos veces), **no emite** en suspensiones por hover/foco/visibilidad (sería charlatana y
además la suspensión no es un cambio de modo), y **nunca** es `assertive` (§8.2 reserva `assertive` para
errores de pago).

**(d) Lo que NO cambia de §22.6b-h:** la teja sigue siendo un `<a>` que envuelve todo y **sigue prohibido**
ponerle `aria-label` (borraría del árbol de accesibilidad la cifra y el micro-aviso). La numeración sigue
`aria-hidden`. El glifo del conmutador va `aria-hidden` (la palabra es el portador, §2.4).

**(e) Teclado.** El conmutador es el **primer** control del carrusel en orden de tabulación (§23.4a),
activable con `Enter` y `Espacio` por ser un `<button>` real. No se le asigna atajo global.

### 23.10 La numeración `01 · 02 · 03` — la rotación no la toca

Consecuencia directa de R1: **la rotación no reordena el DOM**, así que `02` sigue siendo la segunda teja del
DOM la mire quien la mire. La regla «todo o nada por pista» de §20.3 y §22.6b-c sigue **exactamente igual**,
con el mismo predicado (`pageHasGradingFigures`) evaluado **una sola vez** con los datos resueltos: un
resultado que **no puede cambiar por desplazarse**. Prohibido renumerar según lo visible, usar el número
como indicador de progreso de la rotación, o resaltar la teja que acaba de entrar. Detalle completo y
prohibiciones en §22.6b-c.

### 23.11 Contraste — **cero pares nuevos**

| Par | Ratio | Veredicto |
|---|---|---|
| Tinta `#1A1A18` sobre papel `#F4F1EA` (palabra y glifo del conmutador, reposo y hover) | **~15,5:1** (§10) | AA/AAA ✓ (texto pequeño y componente UI) |
| Anillo de foco rojo `#B31217` sobre papel (foco del conmutador) | **6,2:1** (§17.2, §20.15) | AA ✓ (≥ 3:1 para UI) |
| Subrayado de hover, tinta 1px sobre papel | ~15,5:1 | ✓ (redundante con el `cursor`, no es el único canal) |

- **El glifo nunca es el único portador**: la palabra (PAUSAR / REANUDAR / REPETIR) está siempre presente
  (§2.4). Quien no distinga dos barras de un triángulo a 12px lee la palabra.
- **Cero tokens de color nuevos, cero tamaños tipográficos nuevos** (mono 10px = `.eyebrow`, ya en uso).
- El conmutador **no usa acento**: el rojo del carrusel está presupuestado (§22.10 nº3) y un control de
  reproducción no es información de dominio.

### 23.12 i18n — claves nuevas (propiedad de frontend)

Convención `home.featured.*` (§20.16). ES de referencia; EN a cargo de frontend (§9):

| Clave | ES | EN | Nota |
|---|---|---|---|
| `home.featured.playback.pause` | `Pausar` | `Pause` | Visible; versalitas por CSS |
| `home.featured.playback.resume` | `Reanudar` | `Resume` | Visible |
| `home.featured.playback.replay` | `Repetir` | `Replay` | Visible |
| `home.featured.playback.pauseAria` | `Pausar la rotación automática` | `Pause the automatic rotation` | **Debe empezar por la palabra visible** (WCAG 2.5.3) |
| `home.featured.playback.resumeAria` | `Reanudar la rotación automática` | `Resume the automatic rotation` | idem |
| `home.featured.playback.replayAria` | `Repetir desde el principio` | `Replay from the beginning` | idem |
| `home.featured.roledescription` | `carrusel` | `carousel` | `aria-roledescription` |
| `home.featured.trackAria` | `Piezas destacadas — pista desplazable` | `Featured pieces — scrollable track` | Solo si la pista es focuseable |
| `home.featured.status.paused` | `Rotación automática pausada.` | `Automatic rotation paused.` | `role="status"` |
| `home.featured.status.ended` | `Fin de las piezas destacadas.` | `End of featured pieces.` | `role="status"` |

Recordatorio §9.4: `REANUDAR` es la etiqueta larga en ES y es la que fija el `min-width: 80px` del bloque
(§23.4b). Si alguna traducción futura la supera, **se sube el `min-width`**; **nunca** se trunca, se abrevia
ni se elimina la palabra.

### 23.13 Qué NO hacer

| # | Prohibido | Por qué |
|---|---|---|
| 1 | Un **tercer cuadrado** de 32/38px en el grupo de las flechas | Mezcla navegación con estado; obliga a leer glifos donde hoy basta la forma; y es la anchura que no da (§23.4a, §23.4e) |
| 2 | **Puntos, barras o paginador** bajo la pista | Duplica el trabajo de la numeración, sería un tercer acento e implica «páginas» que en un scroller continuo no existen (§22.6b-c) |
| 3 | **Clonar tejas** / bucle infinito / reordenar el array | R1: duplica nombres accesibles (que aquí llevan la cifra y el micro-aviso) y rompe orden DOM = orden de lectura (§23.2) |
| 4 | Que el **contenido rote entre tejas** y la 2 ascienda a líder | Remaqueta dos tejas por tic y dispara descargas HD sucesivas (§23.2) |
| 5 | Esconder el control de pausa tras `hover`, tras `focus`, o dentro de un menú | R3: 2.2.2 exige un mecanismo **disponible**, y en táctil no hay `hover` |
| 6 | **Rebobinado animado** al inicio | ~2 000px de barrido: la lectura «cargando/roto» que §17.3 teme (§23.6) |
| 7 | **Tics acumulados** al reanudar tras una suspensión | Un salto de varias tejas de golpe es indistinguible de un fallo (§23.3) |
| 8 | Rotar **fuera de pantalla** o con la pestaña oculta | Mueve el contenido a espaldas del usuario y gasta batería sin que nadie mire |
| 9 | **Reanudar solo** tras N segundos de la intervención del usuario | R5: le arranca el control al usuario justo después de que lo tomó (§23.5) |
| 10 | Con `prefers-reduced-motion`: rotar más lento, sin `easing`, o «solo un poco» | R4: la preferencia es *no me muevas la pantalla* (§23.7) |
| 11 | **Fundido, `cross-fade`, zoom o `scale`** entre tejas | Solo traslación (§17.3a, condición 2) |
| 12 | Arrancar la rotación **sobre skeletons** o antes de que cargue la imagen líder | R2, y es la condición que desactiva el argumento de §17.3 (§23.1) |
| 13 | Cambiar el paso, el apagado en los extremos o el tamaño de las **flechas** de §20.3 | §23 es aditiva; §20.3 no se toca |
| 14 | Que la suspensión por hover/foco **cambie la etiqueta** del conmutador | Parpadeo remoto y mentira sobre el modo (§23.5) |
| 15 | Añadir **kicker, subtítulo o mención al gradeo** al encabezado | §22.6b-e sigue vigente literalmente; el conmutador ocupa el hueco, no el rol |
| 16 | Extender la rotación a **otros estantes** (Sellado, Gradeadas, Bounties, «Joyas para gradear») | §23.1: la excepción está autorizada **solo aquí** |
| 17 | Un ajuste en la app que **anule** `prefers-reduced-motion` | La preferencia del sistema gana siempre (§23.7) |

### 23.14 QA visual sugerido

(a) **Reposo inicial:** cargar la home y cronometrar — nada se mueve durante los primeros **7 s**, y no se
mueve nada **mientras haya skeletons**. (b) **Paso:** un tic mueve **una** teja y ninguna teja queda cortada
por el **borde izquierdo** en reposo. (c) **Hover:** dejar el puntero sobre la pista ⇒ se detiene; el
conmutador **no cambia**; al retirarlo pasan **7 s** completos antes del siguiente tic (no un tic inmediato).
(d) **Foco:** tabular por las tejas ⇒ la pista no se mueve sola y **el foco nunca sale de la pantalla**.
(e) **Intervención:** un swipe o una flecha ⇒ el conmutador pasa a **REANUDAR** y **no vuelve a rotar solo**
(esperar ≥ 30 s). (f) **La fila, en 390 / 640 / 1024 y en ES y EN:** el conmutador cabe, no envuelve por
encima de 360px, no pisa el H2 ni el link, y su área táctil mide ≥ 44×44 sin solaparse con nada.
(g) **Movimiento reducido:** activar la preferencia del sistema **en caliente** ⇒ la rotación se detiene al
momento, el conmutador **desaparece**, y las flechas pasan a saltar sin animación. (h) **Sin JS:** las ocho
tejas se leen y la pista se desplaza; **no hay** flechas ni conmutador ni movimiento. (i) **Final:** dejar
correr la pasada ⇒ al llegar al extremo se detiene, la flecha «siguiente» queda apagada y el conmutador dice
**REPETIR**; pulsarlo vuelve al inicio y reanuda. (j) **Lector de pantalla:** la sección se anuncia como
«carrusel»; el botón anuncia su nombre nuevo al pulsarlo; al terminar la pasada se oye «Fin de las piezas
destacadas» **una sola vez**. (k) **Numeración:** con la pista rotando, `01·02·03` **no cambia de teja** y no
se resalta ninguna. (l) **Gancho:** con una teja con burbuja, la rotación no altera ni la burbuja, ni el
micro-aviso, ni la regla todo-o-nada de la numeración, ni las alturas dispares (§22.6b-d). (m) **Rendimiento:**
en el panel de red, **cero descargas de imagen nuevas** provocadas por los tics. (n) **Pestaña oculta:**
cambiar de pestaña 1 min y volver ⇒ la pista está donde se dejó (sin tics acumulados).

### 23.15 Notas a otros roles (ninguna bloquea)

1. **Product-owner:** P-49 no está registrado en `PROJECT.md`. Este documento lo referencia como decisión del
   dueño; convendría anotarlo con su criterio de aceptación (por ejemplo: *«el carrusel de destacadas rota
   solo, con control de pausa visible, y no se mueve con `prefers-reduced-motion`»*) para que QA tenga contra
   qué verificar. **No bloquea el diseño ni la implementación.**
2. **Arquitecto:** **nada que pedir.** La rotación no necesita ningún dato nuevo, ningún campo nuevo, ningún
   endpoint y ningún cambio de `API_CONTRACT.md`: se alimenta de la misma consulta compartida que ya usa el
   carrusel (§22.6b-g). Se deja constancia explícita porque la regla 9 obliga a escalar cualquier necesidad de
   contrato, y aquí **no la hay**.
3. **Frontend:** el hueco estructural existe pero hoy `Shelf.kicker` acepta solo `string`; ampliarlo a
   `ReactNode` (o añadir un slot hermano `titleAdjacent`) es la vía limpia y **no altera ninguna otra
   pantalla** — el kicker de Gradeadas (§20.5) sigue siendo texto. Segundo apunte: el destino del tic debe
   calcularse desde el `offsetLeft` de la teja entrante, no con `scrollBy(clientWidth × 0,8)` (que es el paso
   de las **flechas**), o se incumple R6.
4. **QA:** los checks (g) y (h) de §23.14 —movimiento reducido en caliente y sin JS— son los dos que un
   E2E olvida por defecto y son precisamente los dos hechos que el frontend levantó. Merecen caso propio.
5. **Techlead:** §23.1 crea **una excepción nominal y acotada** a la doctrina de movimiento de §17.3. Está
   deliberadamente cerrada a una superficie (§23.13 nº16). Si aparece una segunda petición de movimiento en
   el sistema, **no se resuelve citando §23**: vuelve a ux-ui.
