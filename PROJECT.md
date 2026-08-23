# PROJECT.md — TCG Vault MX — Marketplace TCG con Bóveda (Pokémon, México)

> **Nombre comercial / marca:** **TCG Vault MX**. Es el nombre que se usa en la interfaz, la
> comunicación y los términos. "Marketplace TCG con Bóveda" es solo el título descriptivo del proyecto.
>
> Estado: borrador para aprobación del humano. Las decisiones previas siguen cerradas, PERO el **requisito
> v1.3 (precio de buylist por rareza)** introduce **preguntas abiertas pendientes de respuesta** (ver la
> sección al final). Lo único no fijado del alcance previo son las **metas de lanzamiento N/X/Y/Z**, que el
> humano define al momento de lanzar (no bloquean el desarrollo).
> **Actualización 2026-08-14**: incorporadas 8 decisiones de alcance aprobadas (raw solo NM +
> nomenclatura/política, sección "Compra" con inventario propio, rarezas modernas y filtro de set con año,
> venta de sellado con precio manual *(superado por v1.6: precio derivado por spread)*, gráfica de tendencia del portafolio, login con Google, sync de
> catálogo 2024+ con backfill).
> **Simplificación v1.2 (2026-08-14, aprobada por el humano)**: el producto **no lleva fotos propias** en
> ningún lado — se usa la **imagen de catálogo remota de pokemontcg.io**; se elimina la captura de "fotos
> verificadas de anverso/reverso" como mecanismo de condición/disputa. **Gradeadas**: el slab es la
> garantía (empresa + grado + `certNumber`, verificable en la graduadora). **Disputas de condición**: la
> evidencia se envía **por correo a soporte** (no hay subida de foto en la app). **KYC buylist**: el INE **SÍ
> se almacena** como **imagen cifrada en R2 con retención** (`INE_RETENTION_DAYS`, default **180**), pedido en
> el paso de pago del buylist sobre el tope y verificado contra el nombre de la CLABE; la **CLABE sigue cifrada
> en BD**. **Object storage (R2): DENTRO del alcance del MVP, pero acotado SOLO al INE del buylist** (`kyc_ine`);
> no hay fotos de producto/inventario ni de disputa. Ver decisiones 20–25.
> **Corrección v1.2.1 (2026-08-14, aprobada por el humano)**: se **revierte SOLO la parte del INE** de la
> v1.2 — el **INE del buylist vuelve a almacenarse** (imagen cifrada en **R2** con retención
> `INE_RETENTION_DAYS`, default 180, como en v1.1) para soporte AML del pago SPEI a particulares, y el
> **object storage / R2 vuelve al alcance del MVP acotado SOLO al INE** (`kyc_ine`). **Todo lo demás de la
> v1.2 permanece intacto** (producto sin fotos, gradeadas = empresa+grado+`certNumber`, raw NM sin foto,
> disputa por correo a soporte, CLABE cifrada en BD).
> **Requisito v1.3 (2026-08-16, EN REVISIÓN por el humano — reabre preguntas):** el pago del buylist deja de
> calcularse por **3 categorías hardcodeadas** (común/reverse/EX+) y pasa a una **tabla de precio por rareza
> oficial de Pokémon**, donde **cada rareza** tiene una regla **fijo (MX$)** o **porcentaje (% de la
> referencia)**, **editable desde el back-office (M2)**. Ver §E.1 (nueva), M2, criterios 12/12b/12c/18 y la
> sección **"Preguntas abiertas — precio de buylist por rareza (v1.3)"** al final. **Este bloque tiene
> preguntas abiertas pendientes**; el resto del documento sigue cerrado.
> **Requisito v1.4 (2026-08-16, decisiones del humano YA tomadas):** las cartas se distinguen ahora por
> **acabado/versión** (normal, reverse holo, holofoil, 1st edition…) en **toda la cadena** (Compra, cotizador
> de buylist, inventario/bóveda, valuación de portafolio y precio de buylist). Hoy el modelo NO distingue
> acabados (1 fila `Card`, un solo `rarity`, sin `finish`) y los precios por acabado de `tcgplayer.prices`
> **se descartan al importar**. Se decide: (1) modelar el acabado en **todo** el alcance (cotizador,
> inventario/bóveda, portafolio y Compra); (2) el acabado **mapea a una regla existente** de la tabla por
> rareza de M2 (reverse holo → regla "Reverse Holo"; holo → "Holo"/base; normal → regla de la rareza base) y,
> para reglas de **porcentaje**, usa el **precio de mercado de ESE acabado**; (3) el monto se **deriva siempre
> server-side** (SEC-A1); (4) filas históricas sin acabado → default **normal**. Además: **alta de inventario
> por set** en M1 usando el **catálogo real** (no cartas mock) y **origen del inventario** por item
> (`owner_contribution` vs `client_purchase`) capturado al dar de alta, que afecta finanzas/portafolio
> (costo/P&L). Ver §I (nueva), §A, §C, §E, §E.1, M1, M2, §G, criterios 37–44 y las **preguntas abiertas v1.4**
> al final. **Este bloque tiene preguntas abiertas pendientes**; los defaults preservan el comportamiento
> actual y no bloquean el arranque si el humano los autoriza.
> **Requisito v1.5 — GUEST CHECKOUT (2026-08-18, decisiones del humano YA tomadas):** se puede **comprar sin
> crear cuenta**. Tres decisiones cerradas (no se re-litigan): (1) el invitado **solo puede elegir envío
> directo a domicilio** — **guardar en bóveda REQUIERE cuenta**, y eso es deliberado: la bóveda es el
> **gancho de registro**; si el invitado intenta elegir bóveda se le ofrece **crear cuenta ahí mismo**
> (upsell in-situ, **no** un error); (2) **correo obligatorio** y **seguimiento por enlace tokenizado**
> (token firmado y expirable, enviado por correo); (3) **reclamo post-compra**: al completar la compra se le
> ofrece crear cuenta con ese mismo correo y el pedido **pasa a su historial**. Ver **§J** (nueva), §B, §C,
> "Usuarios y roles", criterios **45–56** y las **preguntas abiertas v1.5** al final. **Quedan dos huecos
> pendientes** (qué pasa si el correo del invitado **ya tiene cuenta** y el **plazo de expiración** del
> enlace); el resto del bloque está decidido.
> **Requisito v1.6 — SELLADO (producto cerrado): SOLO VENTA + precio derivado (2026-08-19, decisiones del
> humano YA tomadas):** el work stream de **Sellado** cerró un spec que **SUPERSEDE** dos decisiones previas
> de este documento. (1) **Actualizado: el precio del sellado deja de ser "manual-único" y pasa a DERIVADO
> por spread sobre precio de mercado; TCGCSV pasa de "solo informativa" a ser la BASE del precio de venta del
> sellado (vía el mapeo curado existente) — decisión del PO, ago-2026.** La precedencia money-safe es:
> `override manual > (mercado × spread por presentación) > (mercado × spread global de respaldo) > sin precio
> ⇒ no se publica (PRICE_PENDING)`. El override manual sigue disponible como **máxima precedencia**. Esto
> **SOLO aplica al sellado**: para **cartas sueltas (raw/singles) nada cambia** (TCGCSV sigue sin usarse como
> fuente de su precio). (2) **El sellado es SOLO VENTA** (plataforma→cliente): **no se compra sellado a
> clientes por la plataforma**; **no hay buylist de sellado**. En la ventana de sellado hay un call-out
> `mailto` para revender fuera de la app. (3) El sellado gana **condición propia** (default Mint, opción
> "Detalle menor en caja"; visible al comprador, **no altera el precio**), **destino igual que cartas**
> (recibir/`direct_ship` o bóveda/`vault`), **pestaña "Sellado"** en bóveda del cliente y en la vista admin,
> y **entra en la valuación y tendencia del portafolio**. Dos diferenciadores quedan **cableados pero
> apagados** (feature-flag off): **tendencia de valor del sellado** y **"avísame cuando vuelva" (restock)**.
> Ver **§K** (nueva), §A, §C, §H, M1/M2/M5, "Fuentes de precio", criterios **2/3e/18** (actualizados) y
> **57–64** (nuevos), y las **decisiones v1.6** al final. **Este bloque está cerrado y aprobado por el
> humano**; solo quedan supuestos menores marcados `SUPUESTO (confirmar con PO)`.
> **Requisito v1.7 — SETS MULTI-PARTE / MASTER SET COMBINADO (2026-08-22, BORRADOR del product-owner, EN
> REVISIÓN por el humano — P-27):** un set de aniversario/especial que en pokemontcg.io vive como **dos
> set-ids** (el principal + su subset con id propio, p. ej. **Celebrations** `cel25` + **Classic Collection**
> `cel25c`) se muestra hoy como **dos sets separados**, así que Celebrations aparece con **25 cartas cuando
> son 50**. No falta data (ambas partes están importadas); es **modelo/presentación**. Se decide (defaults del
> PO, marcados para aprobación del humano): mostrar el set multi-parte como **UN master set combinado** (padre
> + subset en el mismo binder, con separador/etiqueta para la parte del subset), de forma **NO destructiva**
> (cada carta CONSERVA su set-id de origen; **precio, inventario y bóveda no cambian a nivel de dato** — solo
> la **vista** agrupa), gobernada por un **mapa padre→subset explícito y extensible** que arranca con
> Celebrations y cubre el patrón (Shiny Vault con id propio: Shining Fates `swsh45sv`, Hidden Fates `sma`,
> etc.). Ver **§L** (nueva), §A, §C, §F/M1–M2, criterios **65–72** y las **preguntas abiertas v1.7** al final.
> **Alcance acotado: SOLO presentación/agrupación del master set; FUERA de alcance re-llavear identidad o
> mover precios/inventario.** Los defaults no bloquean el arranque si el humano los autoriza.
> **Requisito v1.9 — PRICING POR TIERS (2026-08-22, DECISIONES DEL HUMANO YA TOMADAS — LOCKED, P-34;
> supersede el borrador v1.8):** el editor de precios pasa de pedir **una regla por CADA rareza canónica**
> (~30 tras el sync: Common 5326, Uncommon 4888, Rare 2562, Rare Holo 1617, … hasta Rare ACE, Amazing Rare,
> Mega Hyper Rare) a **una regla por `tier`**, con un **mapa rareza canónica → tier**. Decisiones cerradas del
> humano: **(1) 5 tiers** — **T0 Bulk, T1 Uncommon/Reverse, T2 Rare/Holo, T3 Premium/Chase, T4 Ultra/Grail**.
> **(2) T2 Rare/Holo = PORCENTAJE bajo del mercado** (default **25%**, ajustable), **NO fijo** — esto **CAMBIA
> el comportamiento vigente** (antes Rare/Rare Holo caían al bin fijo de bulk) y es un **cambio intencional**;
> money-safe: un `pct` sin referencia de mercado → **precio pendiente, nunca $0** (igual que los demás tiers
> `pct`). **(3) Rarezas «SIN MAPEAR» → premium** (cierra el bug money-losing): **Mega Hyper Rare** (alias de
> **Hyper Rare**) → **T4**; **`MEGA_ATTACK_RARE`** → nueva canónica premium → **T3**; **Black White Rare** →
> nueva canónica premium → **T3**. **(4) Los tiers aplican a AMBOS ejes de dinero: COMPRA (buylist) y VENTA**
> (un mismo mapa rareza→tier, dos juegos de valores). **(5)** Resto de defaults como se propusieron (T0
> **$0.50** fijo, T1 **$1.50** fijo, T3 **40%**, T4 **40%**; el eje **acabado/`finish`** sigue siendo eje
> aparte; el **mapa rareza→tier es EDITABLE por el dueño** desde M2). Ver **§M** (finalizada), §E.1, §I, M2,
> criterios **73–78** y las **Decisiones (v1.9, P-34)** al final. **Alcance acotado: SOLO la TAXONOMÍA de
> precios (agrupar rarezas en tiers y cerrar el catálogo); el schema y el contrato del editor los diseña el
> arquitecto; NO cambia la matemática fijo/% ni la precedencia money-safe de compra/venta más allá del cambio
> intencional de T2 a `pct`.** **Bloque LOCKED — listo para el arquitecto.** Los defaults reproducen el
> comportamiento vigente salvo el cambio intencional de T2.
> **Requisito v2.0 — VALOR ESTIMADO SI SE GRADEA («gancho de grading») (2026-08-23, BORRADOR del
> product-owner sobre DECISIONES YA TOMADAS por el humano — EN REVISIÓN solo por el texto del disclaimer y los
> huecos menores):** en la tienda se muestra, sobre una carta **raw**, **el precio de la carta + cuánto vale
> estimado en PSA 10 y en PSA 9**. Es un **gancho comercial** (cita del humano: *«si compras esta que no vale
> mucho sin gradear y la gradeas podría valer tanto más, y que se animen a comprar más mis cartas»*) y es
> **estrictamente un estimado ilustrativo con disclaimer**: **NUNCA** un precio de venta, una oferta ni una
> promesa de grado. Decisiones cerradas del humano: **(1) tres superficies** —**ficha**, **badge** en las tejas
> de Compra y **vitrina «Joyas para gradear»** en el home—, con la **superficie visible simplificada**
> *(actualización 2026-08-23: **fuera** el multiplicador, la ganancia calculada y toda comparativa; cita: «solo
> bajemos el precio y desplegamos "en PSA 10 vale tanto"», y confirmó que **quiere los dos grados**)*;
> **(2) gate de ROI sobre PSA 9** (no sobre PSA 10) con la fórmula
> `estimadoPSA9 >= (precioVentaRaw + gradingCost) × (1 + minUpsidePct)`, que *(actualización 2026-08-23)* pasa
> a ser **criterio de curaduría interno**: la **ficha** muestra los estimados **siempre que haya dato**, y
> **teja y vitrina** —donde promocionamos activamente— **solo** llevan cartas que pasan el gate, **ordenadas la
> vitrina por mayor ganancia neta sobre PSA 9**; **el resultado del cálculo nunca se expone al cliente**; y
> **dos diales configurables** — **`gradingCostTiers`**, una **tabla de escalones** valor de carta → costo de
> gradeo *(actualización 2026-08-23: sustituye al costo plano de MX$600; PSA cobra por nivel de servicio según
> valor declarado y el costo debe incluir **envío internacional y retorno a México**, ver N.2.1)*, y
> `minUpsidePct` default **30%**; **(3) arranque MANUAL-FIRST** *(actualización 2026-08-23)*: **fase 1** con
> valores PSA **fijados a mano** por el admin vía el override manual existente, y **fase 2 (bloqueada)** con
> ingest automático desde **PokemonPriceTracker** (proveedor **ya contratado**) una vez confirmado el payload
> en staging — **el comportamiento visible al usuario es idéntico en ambas fases**. **Money-safe (regla dura):**
> una cifra que no existe **no se dibuja**, y sin gate cumplido el badge/entrada de vitrina **no se renderiza** —
> nunca **$0**, nunca un guion, y en un argumento de venta **ni siquiera «pendiente»**. Todo se deriva
> **server-side** (SEC-A1), **reforzado** porque el cliente ya ni recibe los insumos del cálculo.
> **Disclaimer completo = nota al pie** con **llamada (asterisco)** junto a la cifra, más un **micro-aviso
> mínimo adyacente** («ilustrativo» + «no evaluamos esta carta») *(decisión del PO, ver §N.5 y pregunta abierta
> 12)*. **Desambiguación de alcance:** «Grading propio o integración directa con PSA/CGC»
> (Fuera de alcance) se refiere a **gradear cartas / verificar slabs nosotros**, **NO** a **mostrar estimados
> de valor por grado**, que **sí** entran al MVP. **PriceCharting sigue fuera.** **Disclaimer:** el humano
> pidió que sea **súper enfático en que es información ilustrativa y que NO refleja el estado de nuestras
> cartas** (no inspeccionamos ni pre-evaluamos la pieza que vendemos); texto ES/EN reescrito en **§N.5**,
> pendiente de su visto bueno final. Ver **§N** (nueva), §A, «Fuentes de precio», criterios **79–92**,
> decisiones **40–52** y las **preguntas abiertas v2.0** al final.
> Este documento manda sobre el contrato y sobre el código (ver `CLAUDE.md` › Regla de conflicto).

## Idea en una frase
**TCG Vault MX** es un marketplace de cartas Pokémon (TCG) en México que vende **cartas individuales** con
**precio de mercado visible** y una **BÓVEDA/CUSTODIA**: la plataforma guarda físicamente las
cartas compradas —autenticadas y con condición garantizada— y las envía solo cuando el usuario
lo pide, para completar colecciones sin envíos innecesarios.

## Problema que resuelve
Completar una colección de cartas hoy implica compras dispersas, envíos repetidos y caros, dudas
de autenticidad/condición y precios opacos. Este marketplace resuelve:
- **Precio real y transparente**: cada carta muestra un precio de referencia de mercado (commodity).
- **Cero envíos innecesarios**: las cartas compradas viven en la bóveda; el usuario acumula y pide
  el retiro cuando le conviene, pagando un solo envío.
- **Confianza**: cada carta se autentica una vez al ingresar a la bóveda; se garantiza autenticidad
  y condición. **Gradeadas (PSA/CGC)**: el **slab** es la garantía (empresa + grado + número de certificado
  verificable en la graduadora). **Raw**: **estándar de condición propio en Near Mint (NM)**. No se usan
  fotos propias: la ficha muestra la **imagen de catálogo de pokemontcg.io**.
- **Portafolio visible**: el usuario ve el valor de su colección en custodia, valuado a mercado.

## Usuarios y roles de la app
- **Invitado (comprador sin cuenta)** *(NUEVO v1.5)*: navega **Compra** y **compra sin registrarse**,
  dando **correo obligatorio** y dirección de envío. **Solo puede elegir envío directo a domicilio**: la
  **bóveda requiere cuenta** (si la intenta elegir, se le ofrece crear cuenta ahí mismo). No tiene sesión,
  historial ni portafolio: da seguimiento a **su pedido** mediante un **enlace tokenizado** que recibe por
  correo. No puede vender (buylist), no ve bóveda ni back-office. Tras la compra puede **crear cuenta con el
  mismo correo** y **reclamar el pedido** para que pase a su historial (ver §J).
- **Comprador (usuario final / cliente)**: se registra (email/contraseña o **Google**), navega la sección
  **Compra** (nuestro inventario a la venta), compra cartas, ve su bóveda y el valor de su portafolio (con
  **gráfica de tendencia**), pide retiros/envíos y crea solicitudes de venta (buylist). No opera dinero de
  la plataforma ni ve back-office.
- **Súper-admin (dueño del negocio)**: acceso total al back-office (M1–M10). Es el único que
  **toca dinero que sale** (pagos SPEI de buylist, reembolsos), edita configuración/diales y ve
  finanzas. Fija precios "pendientes" a mano. En el MVP, el negocio ES el admin.
- **Operador de bóveda**: rol de back-office limitado. Opera M1 (inventario/bóveda), M4
  (retiros/envíos) y M5 (buylist) **hasta la etapa de verificación**. **No** toca dinero,
  configuración ni finanzas. Toda su actividad queda en bitácora.

## Funcionalidades del MVP

### A. Compra / storefront (comprador)
> La superficie pública donde el usuario compra se llama **"Compra"** (antes "Catálogo"): muestra
> **NUESTRO inventario publicado a la venta** (no un catálogo abstracto de todas las cartas existentes).
- [ ] Sección **Compra** navegable con búsqueda y filtros sobre el inventario propio en venta:
      **set con año de lanzamiento** (ej. "Surging Sparks (2024)"), **rareza** (incluidas rarezas modernas:
      Art/Illustration Rare, Special Illustration Rare, Full Art, Alternate Art, Trainer Gallery, Character
      Rare, Radiant, etc.), **tipo de producto** (raw, gradeadas, sellado), **condición** y **acabado/versión**
      (Normal, Reverse Holo, Holofoil, 1st Edition; ver §I). La ficha de un raw muestra **su acabado** y valúa
      con el **precio de mercado de ese acabado**.
- [ ] **Regla de Compra — solo se lista lo que tiene precio**: en Compra SOLO aparece inventario con
      **precio de venta fijado**; **NUNCA se muestra "precio pendiente" al comprador**. El estado "precio
      pendiente" vive únicamente en adquisición/buylist/back-office, no en Compra.
- [ ] **Condición del raw = solo Near Mint (NM)** en todo el marketplace (ver §H): el filtro de condición
      para raw refleja únicamente NM; el **sellado** **no lleva rareza**, pero **sí lleva condición propia**
      *(actualizado v1.6)* — default **Mint**, opción **"Detalle menor en caja"**, visible al comprador y
      **sin efecto en el precio** (ver §K).
- [ ] Ficha de carta que distingue **dos valores**: (a) el **valor de referencia/mercado** (la referencia
      del día, es lo que se muestra como "valor de mercado" y se usa para valuar portafolio) y (b) el
      **precio de venta** = **referencia + markup configurable** (dial en M10). El valor de referencia se
      muestra convertido a MXN, refresco diario. Fuente según tipo de producto (ver "Fuentes de precio" en
      Restricciones técnicas):
      - **raw / singles**: TCGPlayer "Market Price" vía **pokemontcg.io**.
      - **gradeadas (PSA/CGC)**: **PokemonPriceTracker** o **PokeTrace** (free tier), con **override
        manual del admin** siempre disponible como respaldo.
      - **sellado** *(actualizado v1.6)*: **precio de venta DERIVADO del precio de mercado de TCGCSV** (vía
        el mapeo curado existente), con la precedencia money-safe `override manual > (mercado × spread por
        presentación) > (mercado × spread global de respaldo) > sin precio ⇒ no se publica (PRICE_PENDING)`.
        TCGCSV es la **base del precio del sellado** (ya no "solo informativa"); el **override manual** sigue
        siendo la máxima precedencia. Ver §K. *(Supersede la decisión previa "sellado = precio manual".)*
- [ ] Tipos de producto vendibles: **gradeadas (PSA/CGC)** (el **slab** es la garantía: se muestra
      **empresa + grado + número de certificado**, verificable en la web de la graduadora; se captura
      `certNumber`), **producto sellado** (sets cerrados: booster box, ETB, bundle, tin, blister…) y
      **raw en Near Mint (NM)** (**estándar de condición propio**, sin foto). **La ficha usa la imagen de
      catálogo de pokemontcg.io**; el producto no lleva fotos propias.
- [ ] **Venta de producto sellado** *(actualizado v1.6, ver §K)*: se vende en Compra con **precio de venta
      DERIVADO** de la referencia TCGCSV por spread (precedencia `override manual > mercado × spread por
      presentación > mercado × spread global > PRICE_PENDING`); es **solo venta** (plataforma→cliente, **sin
      buylist de sellado**); **sin rareza**, pero **con condición propia** (default Mint, opción "Detalle
      menor en caja"; visible al comprador y **sin efecto en el precio**). Como en Compra solo se lista lo que
      tiene precio, un sellado en **PRICE_PENDING** (sin override y sin spread aplicable) **no se publica**.
- [ ] Solo se prician las cartas **que tenemos en bóveda** (no el catálogo completo), con **cache diario**,
      para que los free tier alcancen.
- [ ] Cartas sin precio en la web de referencia: quedan en estado **"precio pendiente"** en
      adquisición/buylist/back-office y **NO se publican en Compra** hasta que el dueño les fija precio a
      mano (el comprador nunca ve "precio pendiente").
- [ ] **Valor estimado si se gradea — «gancho de grading»** *(NUEVO v2.0, ver §N)*: sobre una carta **raw**
      publicada, la tienda muestra **el precio de la carta + cuánto vale estimado en PSA 10 y en PSA 9**, en
      **tres superficies**: **ficha**, **badge en las tejas** y **vitrina «Joyas para gradear» en el home**.
      **Solo eso: sin multiplicador, sin ganancia calculada, sin comparativa** *(simplificación 2026-08-23)*.
      Es un **estimado ilustrativo con disclaimer obligatorio** —**nunca** un precio de venta ni una promesa de
      grado—. El **gate de ROI sobre PSA 9** (§N.2) es **criterio de curaduría interno**: la **ficha** muestra
      lo que haya, y **teja y vitrina** solo llevan cartas que pasan el gate. **Money-safe**: una cifra que no
      existe **no se dibuja** (ni **$0**, ni guion, ni «pendiente»). No aplica a **gradeadas** ni a **sellado**.
- [ ] Registro/login de usuario **por email/contraseña o con Google** (ver Restricciones técnicas).

### B. Compra y checkout (Stripe)
- [ ] **Comprar NO exige cuenta** *(v1.5)*: el checkout ofrece **"continuar como invitado"** además de
      iniciar sesión/registrarse. El invitado solo puede elegir **envío directo a domicilio**; el **destino
      bóveda requiere cuenta**. Reglas completas, flujos y límites en **§J**.
- [ ] Carrito y checkout con **Stripe**. El **precio de venta** que se cobra es **referencia + markup**
      (el markup es un dial configurable en M10); el "valor de mercado" mostrado sigue siendo la referencia.
- [ ] Precios en catálogo/ficha se muestran **sin IVA**.
- [ ] **Costo de procesamiento trasladado al comprador**: línea visible y desglosada en el checkout.
- [ ] **IVA 16% desglosado como línea aparte** en el checkout; el total cobrado lo incluye.
- [ ] **Facturación (CFDI) manual por correo en el MVP** (sin timbrado con PAC, eso es fase 2): en el
      checkout y/o FAQ/términos se muestra un **mensaje** indicando que **para solicitar factura el cliente
      debe enviar un correo con sus datos fiscales**. El IVA cobrado se guarda para M7 Finanzas.
- [ ] Al pagar, la carta comprada entra a la **bóveda del usuario** con titularidad `pending` **cuando el
      comprador tiene cuenta y eligió destino bóveda**. En una **compra de invitado** (§J) no hay bóveda: la
      carta queda **reservada al pedido** y se prepara para **envío directo**.
- [ ] Cuando el pago se liquida, la titularidad pasa a `settled`.
- [ ] **Sin wallet de saldo**: el dinero se liquida por transacción; la plataforma no guarda saldo del usuario.
- [ ] **Ventas finales — sin reembolso voluntario**: una vez comprada una carta **no hay reembolso** a
      solicitud del cliente, ni estando en bóveda ni ya enviada. Esta política aplica a **todos los tipos de
      producto sin excepción** (raw, sellado y gradeadas). El **checkout muestra un aviso explícito** de
      "ventas finales, sin reembolso salvo carta dañada/equivocada o error de la plataforma", con enlace a la
      **página de términos/políticas**.
- [ ] **Excepción 1 — disputa de condición**: si la carta **llega/está dañada o equivocada**, aplica la
      **disputa de condición** (ventana de **7 días contados desde la entrega del envío** —cuando paquetería
      marca "entregado"—). **La evidencia se envía por correo a soporte** (no hay subida de foto en la app).
      La resolución usa: para **gradeadas**, el **grado y número de certificado** del slab (verificable en la
      graduadora); para **raw NM**, el **estándar/política de condición propio**. Si procede, el
      **súper-admin compensa recomprando al precio pagado** y el **cliente conserva la carta** (NO se exige
      devolución; el envío de regreso no es requisito para compensar).
- [ ] **Excepción 2 — error de la plataforma (siempre se reembolsa)**: un **error nuestro** —por ejemplo, un
      **cobro duplicado** o **inventario fantasma** (compra de una carta de la que nunca tuvimos existencia
      real en bóveda)— **siempre se reembolsa**. NO es "arrepentimiento del comprador": es la **corrección de
      un error propio** y no está sujeto a la ventana de 7 días ni a la evidencia de la disputa de
      condición. El **súper-admin ejecuta el reembolso** para restituir el cobro indebido.
- [ ] **Contracargo bancario ≠ reembolso**: se aclara al cliente (en términos/FAQ) que un **contracargo** es
      un proceso que puede iniciar **con su banco de forma independiente**, distinto de la política de
      reembolsos de la plataforma.
- [ ] **Contracargo**: revierte la carta al inventario de la plataforma y refleja el estado de la orden.

### C. Bóveda y portafolio (comprador)
- [ ] **La bóveda es exclusiva de usuarios con cuenta** *(v1.5)*: un invitado **no puede** guardar en bóveda
      ni ver portafolio. Es una decisión de producto, no una limitación técnica: la bóveda es el **gancho de
      registro** y el checkout la usa como upsell para convertir invitados en usuarios (§J).
- [ ] Vista de "Mi bóveda": todas las cartas en custodia del usuario, con su estado de titularidad, **su
      acabado/versión** (Normal, Reverse Holo, Holofoil, 1st Edition; ver §I) y la **imagen de catálogo de
      pokemontcg.io**; con **ordenamiento por set y por valor**.
- [ ] **Pestaña "Sellado" en "Mi bóveda"** *(v1.6, ver §K)*: el producto cerrado en custodia se lista en su
      propia pestaña (la vista admin también la gana) y **suma a la valuación y a la tendencia del portafolio**,
      valuado a su **precio de referencia derivado de TCGCSV** (o su override).
- [ ] **Valor del portafolio** calculado contra el precio de referencia del **acabado específico** de cada
      item (TCGPlayer, MXN, refresco diario); el **sellado** aporta con su **precio derivado de TCGCSV**
      (o su override) *(v1.6)*.
- [ ] **Gráfica de tendencia del valor del portafolio** en "Mi bóveda", **estilo acciones**, con rangos
      **5d / 15d / 1m / 3m / 6m / 1a / YTD / Máx**, que muestra si el portafolio **crece o decrece** en el
      tiempo. (Requisito de producto; el **snapshot diario** que la alimenta lo implementa backend.)
- [ ] Cartas del portafolio sin precio en la web → **"precio pendiente"**, escaladas al dueño para fijar a mano.
- [ ] **Almacenamiento gratis y sin límite explícito en el MVP** (sin tope de meses ni de cartas). En los
      términos se declara únicamente el **derecho genérico de la plataforma a cobrar custodia en fase 2**.

### D. Retiro / envío (comprador)
- [ ] Solicitud de retiro de una o varias cartas de la bóveda (**sin mínimo de cartas**).
- [ ] **Tarifa fija de envío pagada por el comprador**: **MX$175** por paquete (con seguro), configurable en M10.
- [ ] **Envío/retiro solo nacional (todo México)** en el MVP; internacional queda fuera de alcance.
- [ ] Solo se pueden retirar cartas con titularidad **`settled`**.
- [ ] Ejecución de guía **manual** en el MVP (el admin/operador captura el número de guía).

### E. Buylist — compra de raw a usuarios (cotizador público + solicitud)
- [ ] **Cotizador público**: el usuario elige carta y, entre los **acabados disponibles de esa carta**
      (derivados de `tcgplayer.prices`; ver §I), **captura cuál vende** (Normal, Reverse Holo, Holofoil, 1st
      Edition); la **condición es fija en Near Mint (NM)**, único grado que compramos. Ve una cotización
      automática **por acabado**: el acabado selecciona la **regla de rareza** aplicable y el **precio de
      mercado de ese acabado** (mapeo en §I). Se calcula con la **tabla de precio por rareza**
      configurable desde el back-office (ver **§E.1** y **M2**). El monto por rareza usa **rarezas oficiales de
      Pokémon** (las de pokemontcg.io) y cada rareza aplica una regla **fijo (MX$)** o **porcentaje (% de la
      referencia)**. **Valores por defecto** (editables por el dueño; preservan el comportamiento actual):
      - **Common**: **MX$0.50** (regla **fijo**)
      - **Reverse Holo**: **MX$1.50** (regla **fijo**)
      - **EX o superior** (Rare Holo EX/GX/V/VMAX/VSTAR, Ultra Rare, Illustration Rare, Special Illustration
        Rare, Hyper Rare, Secret Rare, etc.): **40% del precio de referencia** (regla **porcentaje**)
- [ ] **Política de compra NM-only (enfatizada)**: "Solo compramos cartas en **Near Mint (NM)**; si al
      recibir/verificar no está en NM, no se compra." Visible en el **cotizador**, la **guía de envío** y los
      **términos**. Carta recibida no-NM → **rechazo (no se paga)** → devolución según plazos (§H: 7 días,
      **a costo del usuario**; abandono a 30 días); una carta **abandonada no-NM NO entra al inventario
      vendible**.
- [ ] Crear una **solicitud de venta** a partir de la cotización.
- [ ] Cartas sin precio en la web → **cola de "precio pendiente"** para que el dueño las fije.
- [ ] Recepción física, verificación de condición, aprobación/ajuste y **pago (SPEI)** los opera el
      admin a mano (ver back-office M5). El dueño **decide carta por carta** (cherry-pick).
- [ ] **Mensaje explícito de "pago tras recepción"**: el cotizador/solicitud y los términos comunican
      claramente al vendedor que **el pago se realiza DESPUÉS de que recibimos y verificamos la carta**
      (no por adelantado), alineado con el pipeline `recibida → verificación → aprobada → pagada`.
- [ ] **Guía de empaque/envío seguro** visible en el flujo de buylist **antes de crear la solicitud**:
      sugiere proteger la carta con **sleeve** y **top loader**, sobre rígido, sobre acolchado, etc.,
      para minimizar daños en tránsito y disputas; incluye la **política NM-only** (solo compramos Near Mint).
- [ ] **Límites anti-fraude/KYC** (defaults configurables en M10): tope por solicitud **MX$3,000** y por
      mes **MX$10,000**; pago solo por SPEI a una cuenta **a nombre del propio usuario**; **INE** requerido
      cuando se supera el tope. El **INE se pide en el paso de pago del buylist** (sobre el tope), se
      **verifica contra el nombre de la CLABE** y su **imagen se almacena cifrada en R2 con retención**
      (`INE_RETENTION_DAYS`, default **180**); la **CLABE se guarda cifrada en BD**.
      (Ver soporte AML en "Riesgos y banderas para el humano".)

### E.1 Precio de buylist por rareza (configurable desde admin) — NUEVO (v1.3)
> **Superseded por §M (v1.9, LOCKED):** el editor pasa de «una regla por **rareza**» a «una regla por **tier**»
> con un mapa rareza→tier (compra y venta). Lo de abajo describe la mecánica `fixed`/`pct` y money-safe que
> **sigue vigente** (el `tier` solo decide qué regla aplica a qué rareza); para la taxonomía final ver §M.
> Reemplaza el esquema de **3 categorías internas hardcodeadas** (común / reverse holo / EX+) por una
> **tabla de precio por rareza** editable desde el back-office. Objetivo del humano: (1) usar las **rarezas
> oficiales de Pokémon** (las que trae pokemontcg.io) en vez de 3 categorías internas, y (2) que el **monto a
> pagar por cada rareza sea un campo configurable desde el admin**, sin tocar código.
- [ ] **Regla por rareza (fijo o porcentaje)**: para **cada rareza** la tabla define una regla con **dos
      naturalezas posibles**, ambas editables desde admin:
      - **FIJO (MX$)**: monto fijo en pesos (caso bulk). **No requiere** precio de referencia → siempre cotiza.
      - **PORCENTAJE (% de la referencia de mercado)**: se paga un % del **precio de referencia** del día. Si
        la carta **no tiene referencia** → queda **"precio pendiente"** y se escala al dueño (comportamiento
        actual; nunca se descarta).
      - Motivación: un **monto fijo no tiene sentido para rarezas de alto valor** (una carta cara vale un % de
        mercado, no un fijo); por eso las rarezas altas usan **porcentaje**.
- [ ] **Defaults por rareza (preservan el comportamiento actual; el dueño puede ajustar cada uno)**:
      - **Bulk = FIJO**: Common **MX$0.50**, Reverse Holo **MX$1.50**.
      - **Holo / EX+ y superiores = PORCENTAJE**: Rare Holo, Rare Holo EX/GX/V/VMAX/VSTAR, Ultra Rare,
        Illustration Rare, Special Illustration Rare, Hyper Rare, Secret Rare, etc. → **40% de la referencia**.
      - *(SUPUESTO: el seed de defaults reproduce EXACTAMENTE el resultado de hoy — Common $0.50 fijo, Reverse
        Holo $1.50 fijo, cualquier otra rareza = 40% de la referencia. La clasificación fijo/% de rarezas
        intermedias como **Uncommon** y **Rare** (no-holo) queda pendiente de confirmación del humano; ver
        preguntas abiertas.)*
- [ ] **Fuente de rarezas = catálogo sincronizado + fallback** (recomendado): la lista de rarezas a
      configurar se **deriva de las rarezas distintas presentes en el catálogo ya sincronizado** (`Card.rarity`),
      para que el dueño solo configure **las que realmente existen**. Para una **rareza nueva o no listada**
      (aparece tras un sync) se aplica una **regla de fallback configurable** (default **% de la referencia**,
      mismo valor que EX+) para **no bloquear** la cotización de cartas sin regla explícita.
      *(SUPUESTO: el fallback es "% default" y NO deja la carta en "precio pendiente" por sí solo; solo cae en
      "precio pendiente" si además falta la referencia. Alternativa a decidir por el humano: que una rareza sin
      regla quede en "precio pendiente" hasta que el dueño la configure. Ver preguntas abiertas.)*
- [ ] **Dónde se edita = M2 (Catálogo y precios)** (recomendado, por ser pricing; no M10): editor con una fila
      por rareza — **rareza → regla (fijo/%) + valor** — editable **sin deploy** y **auditado** (bitácora M10).
      Reemplaza la **tabla rareza→categoría del buylist** actual.
- [ ] **Compatibilidad / migración**: la nueva tabla **reemplaza** el mapeo de 3 categorías (`RARITY_MAP` +
      categorías común/reverse/EX+), pero el **seed inicial reproduce el comportamiento de negocio vigente**
      (defaults de arriba) para **no romper cotizaciones en curso**. Se mantiene la **derivación server-side**
      del monto: el precio a pagar se calcula en el backend a partir de la **rareza real de la carta**, nunca
      del DTO del cliente (no se debilita la protección anti-manipulación existente).
- [ ] **Interacción con el acabado (v1.4, ver §I)**: la cotización se calcula **por acabado**. El acabado
      elegido determina **cuál regla de esta tabla aplica** (reverse holo → "Reverse Holo"; holo → "Holo"/base;
      normal → rareza base) y, para reglas de **porcentaje**, **cuál precio de referencia se usa** (el del
      acabado específico, `tcgplayer.prices[acabado].market`). El backend valida que el acabado sea uno de los
      **realmente disponibles** de la carta y **deriva el monto server-side** (SEC-A1). Una carta con regla de
      **porcentaje** cuyo **acabado no tiene precio de referencia** cae en **"precio pendiente"** (igual que hoy;
      las de regla **fijo** siempre cotizan).

### F. Back-office / herramienta de administración (M1–M10) — parte central del MVP
Principio: cada objeto (carta física, orden, solicitud, envío, disputa) es una **cola con estados**.
- [ ] **M1 — Inventario y bóveda**: alta de items **sin foto propia** (se usa la **imagen de catálogo de
      pokemontcg.io**; para **gradeadas** se captura **empresa + grado + `certNumber`**), ubicación
      jerárquica tipo **CAJA/FILA/SLOT**, **folio legible por item** (ej. `INV-000123`), estados,
      **mover con historial**, marcar **pérdida/daño**.
  - [ ] **Alta por set contra el catálogo REAL (v1.4)**: el flujo de alta es **elegir set** (dropdown de sets,
        con año) → **buscar la carta real del catálogo sincronizado** dentro del set → **elegir carta** →
        **elegir acabado** entre los disponibles de esa carta (ver §I). **Debe usar el catálogo real
        sincronizado, NO las cartas mock** que se usan hoy (que muestran muy pocas). El item queda ligado a la
        carta de catálogo y a un **acabado** concreto.
  - [ ] **Origen del inventario (v1.4)**: cada `InventoryItem` registra un **origen** capturado al dar de alta:
        **`owner_contribution`** (aportación en especie del dueño, costo = referencia × % configurable, default
        70%; ver §G) o **`client_purchase`** (comprada a un cliente vía buylist, costo = lo pagado en el
        buylist). El origen determina el **costo** del item y por tanto afecta **finanzas/P&L** (M7) y la base
        de costo del portafolio de inventario. La conversión de buylist a inventario (M5) marca el origen como
        `client_purchase` automáticamente.
- [ ] **M2 — Catálogo y precios**: **sync de precios** de las cartas en bóveda desde las fuentes según tipo
      (pokemontcg.io para raw/singles; PokemonPriceTracker/PokeTrace para gradeadas; **sellado con precio de
      venta DERIVADO de TCGCSV por spread** *(actualizado v1.6, ver §K)* — precedencia `override manual >
      mercado × spread por presentación > mercado × spread global > PRICE_PENDING`), **override manual** de
      precio siempre disponible (máxima precedencia), **editor de spreads del sellado por presentación**
      (box/etb/bundle/tin/blister + global; ver §K), **cache diario**, **tipo de cambio USD→MXN con colchón**
      configurable, y **editor de precio de buylist por rareza** (una fila por rareza oficial: **regla fijo/%
      + valor**, ver §E.1; reemplaza la antigua tabla rareza→categoría). **Sync de catálogo** desde la fuente de referencia (pokemontcg.io):
      por defecto importa **sets de 2024 en adelante** y permite **backfill** de colecciones anteriores por
      **lotes automatizados** + **importación puntual** de sets; captura las **rarezas modernas** (Art/
      Illustration Rare, Special Illustration Rare, Full Art, Alternate Art, Trainer Gallery, Character Rare,
      Radiant, etc.), los **acabados disponibles por carta y su precio de mercado por acabado** (llaves de
      `tcgplayer.prices`: `normal`, `holofoil`, `reverseHolofoil`, `1stEdition*`; **hoy se descartan** y ahora
      **deben conservarse**, ver §I) y el **año de lanzamiento del set** para alimentar los filtros de Compra. El proveedor de
      precios es **intercambiable (`PricingProvider`)** para poder subir a un plan de pago sin tocar el resto
      del sistema. Distingue **valor de referencia/mercado** (para mostrar y valuar portafolio) del **precio
      de venta** (= referencia + **markup configurable**, ver M10).
- [ ] **M3 — Ventas / órdenes**: estados `pending / settled / fallida / reembolsada / contracargo`,
      **desglose con línea de Stripe**, **reembolso**.
- [ ] **M4 — Retiros / envíos**: cola `solicitado → picking → guía → enviado → entregado`,
      **lista de picking por ubicación**, **captura de guía**, solo sobre cartas `settled`.
- [ ] **M5 — Buylist**: pipeline `cotizada → recibida → verificación → aprobada → pagada`,
      **decisión carta por carta**, **cola de precio pendiente**, **conversión a inventario en un clic**.
- [ ] **M6 — Usuarios / KYC ligero**: **ficha 360°** del usuario, **CLABE** (guardada **cifrada en BD**),
      **INE** (imagen **almacenada cifrada en R2 con retención** `INE_RETENTION_DAYS`, default 180; verificado
      contra el nombre de la CLABE), límites, **bloquear**.
- [ ] **M7 — Finanzas**: **P&L** (ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia),
      **valor de inventario a referencia vs costo**, **valor en custodia de clientes**, **IVA cobrado
      registrado** (para conciliación/CFDI), **export CSV**.
- [ ] **M8 — Disputas**: registro de disputa con **evidencia recibida por correo a soporte** (no hay
      subida de foto en la app); resolución por **grado/cert** (gradeadas) o **estándar NM** (raw), y
      **recompra al precio pagado** como remedio (carta dañada/equivocada, ventana de **7 días desde la
      entrega del envío**, **sin exigir devolución**; solo súper-admin). El **reembolso por error de la
      plataforma** (cobro duplicado / inventario fantasma) se ejecuta en **M3** (no requiere disputa ni ventana).
- [ ] **M9 — Reportes mínimos**: métricas de lanzamiento + **export**.
- [ ] **M10 — Config y bitácora**: **diales editables sin deploy** + **auditoría global** (quién / qué / cuándo).
      Diales con **valores por defecto** (todos configurables): **markup de precio de venta** (% sobre la
      referencia), tarifa de envío **MX$175**, % de aportación en especie **70%**, IVA **16%**, tope de
      buylist **MX$3,000/solicitud** y **MX$10,000/mes**, umbral de **INE = el tope**, **retención del INE**
      `INE_RETENTION_DAYS` (default **180**), **tope de reposición por carta** (definido por el dueño), tipo
      de cambio USD→MXN con colchón, selección de **`PricingProvider`** por tipo de producto.
- [ ] **Dashboard** con ~8 tarjetas: ganancia del periodo, ventas, cola de trabajo, valor de inventario,
      valor en custodia, buylist del periodo, salud de datos, progreso de lanzamiento.
- [ ] **Roles del back-office**: súper-admin (todo) y operador de bóveda (M1, M4, M5 hasta verificación;
      sin dinero/config/finanzas). **Regla de oro**: el dinero que sale solo lo toca el súper-admin;
      todo queda en bitácora.
- [ ] **Panel responsive** operable desde móvil para el flujo de bóveda/verificación (**sin captura de
      fotos**: el producto no lleva fotos propias; se identifica por catálogo/`certNumber`).

### G. Inventario inicial (operación de arranque)
- [ ] Alta del **inventario propio**: colección del humano + adquisiciones con presupuesto.
- [ ] **Costo por carta propia** = precio de referencia del día × **% configurable** (default **70%**),
      **editable**, registrado como **"aportación en especie"** (origen **`owner_contribution`**, ver M1/§I).
      Para inventario proveniente de buylist el origen es **`client_purchase`** y el costo es **lo pagado al
      cliente** (no el 70%).

### H. Reglas de negocio transversales (aplican a varios módulos)
- [ ] **Estándar de condición del raw = solo Near Mint (NM)**: en TODO el marketplace (Compra, tienda,
      inventario, filtros, buylist) el raw se opera **únicamente en NM**; se **eliminan** los grados
      LP/MP/HP/DMG. Gradeadas (PSA/CGC) conservan su condición por slab; el **sellado** tiene su **propia
      condición** (default Mint / "Detalle menor en caja", sin efecto en precio; ver §K) *(actualizado
      v1.6)*. Nomenclatura legible:
      **NM = "Casi nueva (Near Mint)"**, descripción: *"Como nueva; a lo mucho imperfecciones mínimas.
      Bordes limpios y superficie sin rayones notorios."* (la versión en inglés espeja el texto). Este es el
      **estándar de condición propio** de la plataforma (antes solo se mencionaba NM sin definirlo).
- [ ] **Sin fotos propias — imagen de catálogo remota**: el producto **no lleva fotos propias** en ningún
      módulo (Compra, ficha, bóveda, back-office). La imagen que se muestra es la **imagen de catálogo de
      pokemontcg.io** (remota). No hay subida de archivos ni almacenamiento de imágenes en el MVP.
- [ ] **Gradeadas (PSA/CGC) — el slab es la garantía**: para gradeadas la condición no depende de foto; se
      muestra **empresa (PSA/CGC) + grado + número de certificado**, **verificable en la web de la
      graduadora**. Se captura `certNumber` en el alta de inventario.
- [ ] **Política de compra NM-only**: "Solo compramos cartas en **Near Mint (NM)**; si al recibir/verificar
      no está en NM, no se compra." Visible en el **cotizador de buylist**, la **guía de envío** y los
      **términos**. No-NM al recibir → **rechazo (no pago)** → devolución según plazos (7 días, **a costo del
      usuario**; abandono a 30 días); **una carta abandonada no-NM NO entra al inventario vendible**.
- [ ] **Titularidad en bóveda**: `pending → settled`; retiro solo sobre `settled`; contracargo revierte al inventario.
- [ ] **Regla general de valuación**: toda carta se valúa contra la web de referencia; si no hay precio,
      se marca **"precio pendiente"** y se **escala al dueño** (aplica a buylist, inventario y portafolio).
      Nunca se descarta una carta por falta de dato.
- [ ] **Responsabilidad por pérdida/daño en custodia**: reposición al **precio de referencia del día del
      incidente**, con **tope por carta configurable por el dueño** (M10). Seguro formal = bandera legal, no
      bloquea MVP técnico.
- [ ] **Ventas finales (sin reembolso voluntario)**: toda compra es **final**; no hay reembolso a solicitud
      del cliente, ni con la carta en bóveda ni ya enviada. Aplica a **todos los tipos de producto sin
      excepción** (raw, sellado y gradeadas). Las **dos únicas excepciones** son la disputa de condición
      (carta dañada/equivocada) y el error de la plataforma (cobro duplicado / inventario fantasma), descritas
      abajo. Esta política se comunica en el **checkout** y en la **página de términos/políticas**.
- [ ] **Disputas de condición (carta dañada o equivocada)**: vía de compensación por error de condición.
      **La evidencia se envía por correo a soporte** (no hay subida de foto en la app). La resolución usa,
      para **gradeadas**, el **grado y número de certificado** del slab (verificable en la graduadora), y
      para **raw NM**, el **estándar/política de condición propio**. Decide el admin/súper-admin dentro de una
      **ventana de 7 días contados desde la entrega del envío** (cuando paquetería marca "entregado"); si
      procede, remedio = **recompra al precio pagado**, y el **cliente conserva la carta** (NO se exige
      devolución; el envío de regreso no es requisito para compensar).
- [ ] **Error de la plataforma (siempre se reembolsa)**: un error propio —**cobro duplicado** o **inventario
      fantasma** (venta de una carta sin existencia real en bóveda)— **siempre se reembolsa**. No es
      arrepentimiento del comprador sino corrección de un error nuestro; **no aplica la ventana de 7 días ni la
      evidencia de la disputa de condición**. Lo ejecuta el **súper-admin** (reembolso en M3).
- [ ] **Contracargo bancario (independiente)**: el cliente puede iniciar un **contracargo con su banco** por
      su cuenta; es un proceso ajeno a la política de reembolsos de la plataforma y se maneja según la regla
      de contracargo (revierte la carta al inventario y refleja el estado de la orden).
- [ ] **Buylist — plazos y devolución**: sin respuesta del usuario a un ajuste, o **carta rechazada por no
      estar en NM**: **7 días** para gestionar la devolución (**a costo del usuario**); **abandono a 30
      días**. Una carta **NM** abandonada **pasa a inventario**; una carta **no-NM** abandonada **NO entra al
      inventario vendible** (se segrega/descarta, nunca se pone a la venta).

### I. Acabado / versión de carta (transversal — NUEVO v1.4)
> Una misma carta del catálogo puede existir en **varios acabados** (versiones de impresión). Hoy el modelo
> guarda **una sola fila `Card` con un solo `rarity`** y **descarta** los precios por acabado de
> `tcgplayer.prices` al importar. Se introduce el concepto de **acabado (finish)** como atributo transversal
> del inventario/venta/valuación, SIN diseñar aquí el schema (eso es del arquitecto).
- [ ] **Acabados soportados = los que expone `tcgplayer.prices` de pokemontcg.io**: las llaves reales son
      `normal`, `holofoil`, `reverseHolofoil`, `1stEditionNormal`, `1stEditionHolofoil` (y ocasionalmente
      `unlimitedHolofoil`). Se agrupan en acabados de negocio legibles: **Normal**, **Reverse Holo**,
      **Holofoil (Holo)** y **1st Edition** (Normal/Holo). Los acabados **disponibles por carta** se derivan de
      las llaves presentes en `tcgplayer.prices` de esa carta (no toda carta tiene todos los acabados).
      *(SUPUESTO: se soportan exactamente esas llaves; `1st Edition` se trata como acabado propio. Ver
      preguntas abiertas v1.4.)*
- [ ] **Precio de mercado por acabado**: cada acabado tiene su **propio precio de referencia** (el
      `tcgplayer.prices[acabado].market` que hoy se descarta). La valuación (portafolio, venta, buylist) usa el
      precio del **acabado específico** del item, no un precio único por carta.
- [ ] **Mapeo acabado → regla de buylist (decidido, reusa la tabla por rareza de M2, §E.1)**: el acabado
      selecciona **qué regla aplica** y **qué precio de mercado** se usa:
      - **Reverse Holo** → regla **"Reverse Holo"** de la tabla.
      - **Holofoil (Holo)** → regla **"Holo"** (o la de la **rareza base** si esa rareza ya es holo).
      - **Normal** → regla de la **rareza base** de la carta.
      - Para reglas de **porcentaje**, el % se aplica sobre el **precio de mercado de ESE acabado**.
      - *(SUPUESTO: `1st Edition` (Normal/Holo) mapea a la misma regla que su acabado equivalente (Normal/Holo)
        usando el precio de mercado de la llave `1stEdition*`. Falta confirmar si el humano quiere una regla
        propia para 1st Edition. Ver preguntas abiertas v1.4.)*
- [ ] **Derivación server-side (SEC-A1)**: el acabado que el cliente envía en el cotizador se usa solo para
      **elegir de entre los acabados realmente disponibles** de esa carta; el **monto a pagar y el precio de
      mercado se derivan SIEMPRE en el backend** a partir del acabado validado y de la regla de rareza, **nunca**
      del monto/precio que venga en el DTO del cliente (no se debilita la protección anti-manipulación).
- [ ] **Filas históricas / default**: todo `Card`/`InventoryItem` sin acabado explícito se trata como
      **`normal`** (backfill de datos existentes a `normal`).
- [ ] **Presencia transversal del acabado**: el acabado se muestra y opera en **Compra** (filtro y ficha),
      **cotizador de buylist** (el vendedor captura cuál vende), **inventario/bóveda** (se captura al alta y se
      muestra), **valuación de portafolio** (usa el precio del acabado) y **back-office** (M1/M2/M5).

### J. Guest checkout — comprar sin crear cuenta (transversal — NUEVO v1.5)
> **Qué es**: cualquier visitante puede completar una compra en **Compra** sin registrarse, dando únicamente
> **correo** y **dirección de envío nacional**. **Por qué**: hoy el registro obligatorio es la mayor fricción
> antes del pago —especialmente en la primera compra, donde el usuario todavía no confía en la plataforma—.
> Quitarlo sube la conversión sin canibalizar el registro, porque **la bóveda (el diferenciador del producto)
> sigue exigiendo cuenta**: el invitado que quiere acumular cartas, valuar su portafolio o pagar un solo
> envío **tiene que registrarse**. El registro deja de ser un peaje de entrada y pasa a ser el **premio**:
> se ofrece donde tiene valor (al elegir bóveda y al terminar la compra), no antes de pagar.
> **Alcance de esta feature**: checkout del storefront + vista pública de seguimiento; en backend toca
> `orders`, `payments`, `shipments` (y `disputes` en lo que aplique al invitado). **No** cambia el catálogo,
> el buylist ni la bóveda.

**Qué puede hacer un invitado**
- [ ] **Navegar Compra y comprar sin cuenta**: el checkout ofrece explícitamente **"continuar como
      invitado"** junto a "iniciar sesión" / "crear cuenta"; ninguna de las tres opciones es un callejón sin
      salida y el carrito se conserva al cambiar entre ellas.
- [ ] **Correo obligatorio y validado**: se pide un correo en el checkout de invitado, con **validación de
      formato** y **confirmación** de que es correcto antes de pagar (es el único canal de contacto y de
      seguimiento del pedido). Sin correo válido no se puede pagar.
- [ ] **Único destino disponible: envío directo a domicilio nacional** con la **tarifa fija de envío** (§D,
      default MX$175). Aplican las mismas reglas de §D: solo direcciones en **México**.
- [ ] **Mismo precio, mismos impuestos, mismas políticas** que un usuario con cuenta: precio de venta =
      referencia + markup, **línea de costo de procesamiento**, **IVA 16% desglosado**, aviso de **ventas
      finales**, enlace a términos y el mensaje de **factura CFDI manual por correo**. Comprar como invitado
      **no** cambia condiciones comerciales.
- [ ] **Seguimiento de su pedido por enlace tokenizado** (ver abajo).
- [ ] **Disputa de condición y errores de plataforma**: aplican **igual** que a un usuario con cuenta
      (ventana de **7 días desde la entrega**, evidencia **por correo a soporte** citando el **número de
      pedido**; recompra al precio pagado o reembolso según §H). El invitado **no necesita cuenta** para
      abrir una disputa. *(SUPUESTO: la compensación por recompra a un invitado se ejecuta como **reembolso
      por el monto pagado** —no hay bóveda ni saldo donde abonarlo—; ver preguntas abiertas v1.5.)*

**Qué NO puede hacer un invitado**
- [ ] **No puede guardar en bóveda** (decisión de producto, ver §C). Si intenta elegir "guardar en bóveda",
      **no se muestra un error**: se muestra un **upsell in-situ** que explica el beneficio (acumular
      cartas, un solo envío, portafolio valuado) y permite **crear cuenta sin salir del checkout**,
      **conservando el carrito y los datos ya capturados**; al crear la cuenta, el destino bóveda queda
      disponible y el flujo continúa donde estaba. También puede **descartar** el upsell y seguir con envío
      directo.
- [ ] **No puede vender (buylist)**, ni acceder a cotizador con solicitud, portafolio, gráfica de tendencia,
      historial de pedidos, direcciones guardadas ni back-office.
- [ ] **No puede consultar pedidos que no sean el suyo**: no existe ninguna pantalla pública de "buscar mi
      pedido" por número de pedido o por correo. **El único acceso es el enlace tokenizado** que llegó al
      correo (ver nota de seguridad).

**Seguimiento por enlace tokenizado**
- [ ] Al confirmarse el pago, la plataforma envía al correo del invitado un **correo de confirmación** con
      el **resumen del pedido** y un **enlace de seguimiento** que contiene un **token firmado y expirable**
      ligado a **ese** pedido.
- [ ] La **vista pública de seguimiento** muestra: número de pedido, estado (`pagado → preparando → guía →
      enviado → entregado`), **número de guía** cuando existe, artículos comprados y el total pagado.
- [ ] **Expiración**: el enlace **caduca**. *(SUPUESTO: vigencia de **90 días** desde la creación del
      pedido, suficiente para cubrir entrega + ventana de disputa de 7 días; por confirmar — ver preguntas
      abiertas v1.5.)* Con el token **expirado o inválido**, la página muestra un mensaje neutro y ofrece
      **reenviar un enlace nuevo al correo del pedido**; el reenvío **no confirma ni niega** que el pedido
      exista y está **limitado por frecuencia**. El token también puede reenviarse desde soporte.
- [ ] **Reclamar el pedido no requiere el enlace vigente**: si el enlace ya caducó, el invitado siempre
      puede crear cuenta con el mismo correo y recuperar el pedido por la vía de reclamo (ver abajo).

**Reclamo post-compra (conversión a cuenta)**
- [ ] En la **pantalla de confirmación de compra** y en el **correo de confirmación** se ofrece
      **crear cuenta con el mismo correo** ("guarda tu pedido y tus próximas compras en tu bóveda").
- [ ] Al crear la cuenta con **ese mismo correo**, el pedido de invitado **se vincula** a la cuenta y
      **aparece en su historial de pedidos**, con su estado y su seguimiento ya dentro de la sesión.
- [ ] El reclamo **no cambia el pedido**: no altera el destino (sigue siendo envío directo), ni el precio,
      ni las políticas ya aplicadas. Un pedido de invitado **ya enviado o entregado** también puede
      reclamarse (queda en el historial como pedido cerrado).
- [ ] El pedido solo puede reclamarse **una vez**; un pedido ya vinculado a una cuenta no puede vincularse
      a otra.
- [ ] **Si el correo del invitado YA tiene cuenta**: el checkout **no revela** que ese correo está
      registrado (evitar enumeración de usuarios) y **la compra como invitado se permite normalmente**.
      *(SUPUESTO: el pedido **no se vincula en silencio**; queda como pedido de invitado y se ofrece al
      titular **reclamarlo explícitamente** cuando inicia sesión con ese correo —o desde el enlace de
      seguimiento—, para que nadie pueda inyectar pedidos al historial de un tercero escribiendo su correo.
      **Este punto necesita decisión del humano** — ver preguntas abiertas v1.5.)*

**Nota de seguridad a nivel producto (el enlace es una puerta sin contraseña)**
- [ ] El enlace de seguimiento **sustituye a una contraseña**: quien lo tenga ve el pedido. Por eso la vista
      pública debe ser **de datos mínimos**: **no** muestra la dirección completa (a lo mucho ciudad/estado y
      los últimos dígitos del CP), **no** muestra datos de pago más allá de "pagado con tarjeta terminación
      ****", **no** muestra el correo completo ni el teléfono, y **no** permite ninguna acción sensible
      (cambiar dirección, cancelar, pedir reembolso, ver otros pedidos).
- [ ] **Prohibido enumerar pedidos**: no debe existir forma de listar o adivinar pedidos ajenos —ni por
      número de pedido secuencial, ni por correo, ni probando tokens—. El acceso es **solo por token no
      adivinable** y **acotado a un pedido**.
- [ ] El **reenvío de enlace** y el **reclamo de pedido** deben tener **límite de frecuencia** y **respuesta
      neutra** (mismo mensaje exista o no el pedido/correo), para que no sirvan como oráculo de "este correo
      compró aquí".
- [ ] *(El **cómo** —tipo de token, firma, rotación, rate limiting, cabeceras— lo define el arquitecto y lo
      audita la fase de seguridad; aquí solo se fija el requisito de producto.)*

#### J.1 Flujos críticos (base para el E2E de QA)
> **Camino feliz — compra como invitado con envío directo:**
> 1. Un visitante **sin sesión** entra a **Compra**, abre la ficha de una carta publicada y la agrega al
>    carrito.
> 2. En el checkout elige **"continuar como invitado"** (no inicia sesión ni se registra).
> 3. Captura **correo válido** y **dirección de envío nacional**; el sistema valida el formato del correo y
>    que la dirección sea de México.
> 4. Ve el desglose: subtotal, **costo de procesamiento**, **IVA 16%**, **envío MX$175** y total; ve el
>    aviso de **ventas finales** y el mensaje de **factura por correo**.
> 5. Paga con **Stripe** con éxito.
> 6. Llega a la **confirmación** con su **número de pedido** y la oferta de **crear cuenta con ese correo**.
> 7. **Recibe el correo** de confirmación con el **enlace de seguimiento tokenizado**.
> 8. Abre el enlace y ve el **estado del pedido** (datos mínimos, sin acciones sensibles).
> 9. El admin/operador captura la **guía**; el invitado **vuelve a abrir el mismo enlace** y ve el estado
>    actualizado con el número de guía.
> 10. El invitado **crea cuenta con el mismo correo** y el pedido **aparece en su historial**.
>
> **Flujo crítico — upsell de bóveda (conversión):** invitado en checkout intenta elegir **"guardar en
> bóveda"** → ve el **upsell** (no un error) → **crea cuenta sin perder el carrito** → ahora sí puede elegir
> bóveda → paga → la carta entra a **su bóveda** con titularidad `pending`.
>
> **Flujos negativos que QA debe cubrir:** correo con formato inválido bloquea el pago; dirección fuera de
> México rechazada; token **manipulado/inválido** no da acceso; token **expirado** muestra mensaje neutro y
> ofrece reenvío; enlace de un pedido **no da acceso a otro** (cambiar el identificador no expone nada);
> un pedido **ya reclamado** no puede vincularse a una segunda cuenta.

### K. Sellado (producto cerrado) — venta con precio derivado (transversal — NUEVO v1.6)
> **Qué es**: el **producto sellado** (booster box, ETB, bundle, tin, blister…) se consolida aquí con las
> decisiones cerradas del work stream de Sellado (2026-08-19). **SUPERSEDE** dos decisiones previas del
> documento: (1) "sellado = precio manual único" → ahora el precio es **derivado por spread**; (2) "TCGCSV
> solo informativa" → ahora TCGCSV es la **base del precio de venta del sellado** (solo del sellado; para
> cartas sueltas no cambia nada). No se rediseña aquí el schema ni el proveedor de precios (eso es del
> arquitecto); aquí solo se fija el requisito de producto.

**Solo venta (no se compra sellado a clientes)**
- [ ] El sellado es **solo venta** (plataforma→cliente). **No hay buylist de sellado**: la plataforma **no
      compra** producto cerrado a clientes por la app. El **cotizador y el pipeline de buylist siguen siendo
      solo para raw (§E)**.
- [ ] En la **ventana/ficha de sellado** hay un **call-out `mailto`**: *"¿Quieres revender tu sellado a TCG
      Vault MX? Escríbenos a **contacto@tcgvaultmx.com** con fotos y lo cotizamos."* Es un enlace de correo,
      **no** un flujo dentro de la app. *(Confirmado por el PO, ago-2026: el call-out de reventa usa
      `contacto@tcgvaultmx.com` (dominio `tcgvaultmx.com`); las disputas siguen en `soporte@tcgvault.mx`
      (dominio `tcgvault.mx`). Son propósitos y dominios distintos; ambos son correctos y no se unifican.)*

**Precio de venta derivado (money-safe, server-side)**
- [ ] El **precio de venta del sellado** se **deriva del precio de mercado de TCGCSV** (vía el **mapeo curado**
      ya existente entre nuestro producto sellado y el ítem de TCGCSV) con esta **precedencia** estricta:
      1. **override manual** del admin (máxima precedencia; siempre disponible),
      2. **mercado × spread por presentación** (spread según box/etb/bundle/tin/blister),
      3. **mercado × spread global de respaldo** (cuando falta el spread por presentación),
      4. **sin precio** ⇒ el ítem queda en **PRICE_PENDING** y **NO se publica** en Compra.
- [ ] **TCGCSV es la BASE del precio del sellado** (deja de ser "solo informativa"). Este cambio **aplica
      únicamente al sellado**; el precio de **cartas sueltas (raw/singles)** sigue calculándose como hoy
      (pokemontcg.io/TCGPlayer + markup) y **TCGCSV no se usa como su fuente**.
- [ ] El precio derivado se **calcula server-side** (no se toma del cliente), consistente con la protección
      anti-manipulación existente (SEC-A1).

**Spreads configurables por presentación (ConfigSetting)**
- [ ] Los spreads son **diales configurables** (ConfigSetting, editables sin deploy y auditados en M10),
      **uno por presentación** más un **global de respaldo**. **Semillas** (editables por el dueño):
      **box 18%**, **etb 22%**, **bundle 25%**, **tin 30%**, **blister 35%**, **global 25%**.

**Condición del sellado (no altera el precio)**
- [ ] El sellado tiene **condición propia** (independiente del NM del raw y del slab de gradeadas): **default
      Mint**, con opción **"Detalle menor en caja"**. Es **visible al comprador** en la ficha/bóveda y **NO
      altera el precio** (es informativa del estado de la caja). El sellado **no tiene rareza**.

**Destino, bóveda y portafolio**
- [ ] El **destino del sellado comprado es igual que el de las cartas**: **recibir** (envío directo,
      `direct_ship`) o **dejar en bóveda** (`vault`). Aplican las mismas reglas de §B/§C/§D (bóveda requiere
      cuenta; invitado solo envío directo, §J).
- [ ] La **bóveda del cliente** y la **vista admin** ganan una **pestaña "Sellado"** que lista el producto
      cerrado en custodia. El sellado **entra en la valuación y en la gráfica de tendencia del portafolio**
      (§C), valuado contra su precio de referencia derivado (o su override).

**Diferenciadores cableados pero apagados (encender después)**
- [ ] Dos capacidades quedan **implementadas pero detrás de feature-flag apagado** por defecto, para
      encenderse más adelante sin nuevo desarrollo: (a) **tendencia de valor del sellado** (histórico/serie
      del precio del ítem sellado) y (b) **"avísame cuando vuelva" (restock)** — aviso al cliente cuando un
      sellado agotado vuelve a haber en inventario. En el MVP **no están activas para el usuario final**.

### L. Sets multi-parte / Master Set combinado (transversal — NUEVO v1.7, P-27)
> **Qué es**: algunos sets de Pokémon —típicamente ediciones de aniversario o especiales— se publican en
> pokemontcg.io como **dos (o más) set-ids distintos**: un **set principal** y uno o varios **subsets con id
> propio**. El caso testigo es **Celebrations (25 aniversario)**: principal **`cel25`** (25 cartas) + la
> **Classic Collection `cel25c`** (25 cartas, reprints tipo Charizard Base Set) = **50 cartas** que el
> coleccionista percibe como **un solo set**. Hoy nuestro catálogo los importa como **dos sets separados**, así
> que Celebrations muestra **25 y no 50**. El problema **no es de datos** (ambas partes están importadas) sino
> de **modelo/presentación**: no existe relación padre↔subset ni agrupación de display. Nuestro código actual
> solo maneja subsets que son un **prefijo dentro del mismo set-id** (Trainer Gallery/Galarian Gallery/etc.),
> **no** subsets que son un **set-id independiente**.
> **Es un patrón, no un caso único**: afecta a varios sets (Celebrations Classic Collection; "Shiny Vault"
> con id propio como Shining Fates `swsh45sv` o Hidden Fates `sma`; etc.). Por eso se resuelve con un **modelo
> general** (mapa padre→subset), no con un parche para Celebrations.
> **Alcance de esta feature**: **SOLO presentación/agrupación** del master set en las vistas (storefront,
> inventario/Master Set de M1, bóveda). **NO** re-llavea la identidad de las cartas ni mueve precios,
> inventario o bóveda. No se diseña aquí el schema ni el contrato (eso es del arquitecto); aquí solo se fija el
> requisito de producto.

**Decisiones-por-defecto del PO (marcadas para aprobación del humano)**
- [ ] **(D1) Un set multi-parte se muestra como UN solo master set combinado** *(SUPUESTO — confirmar con el
      humano)*: el set principal y su(s) subset(s) se presentan **juntos en el mismo binder**. Para Celebrations
      esto significa **50 cartas en un solo binder** (`cel25` + `cel25c`), no dos sets de 25. Alternativa que el
      humano puede preferir: **sets separados pero enlazados** (cada uno con su binder, con un vínculo visible
      "ver Classic Collection"). El default es **combinado**.
- [ ] **(D2) NO destructivo — cada carta conserva su set-id de origen** *(SUPUESTO — confirmar con el humano)*:
      la agrupación es **solo de vista**. Cada carta sigue perteneciendo a su set-id real (`cel25` o `cel25c`);
      **el precio de referencia, el inventario y la bóveda no cambian a nivel de dato** — no se re-llavea, no se
      re-mapea, no se mueve dinero. **Money-safe por diseño**: la vista de master set **agrupa**, nunca reescribe
      la identidad ni la valuación de la carta.
- [ ] **(D3) Mapa padre→subset explícito y extensible** *(SUPUESTO — confirmar con el humano)*: la relación se
      declara en un **mapa/tabla de pares padre→subset** que **arranca con Celebrations** (`cel25` → `cel25c`) e
      **identifica el patrón** para Shiny Vault y similares (candidatos a validar: Shining Fates `swsh45` →
      `swsh45sv`; Hidden Fates `sm115` → `sma`). Debe ser **fácil añadir nuevos pares** sin tocar código de
      presentación. *(SUPUESTO: los pares concretos más allá de Celebrations los confirma el humano/arquitecto
      contra el catálogo real; el default entrega Celebrations funcionando y el mecanismo listo para el resto.
      Ver preguntas abiertas v1.7.)*
- [ ] **(D4) Nombre del master set = el del principal; el subset se etiqueta** *(SUPUESTO — confirmar con el
      humano)*: el set combinado se llama como el **principal** ("Celebrations"); las cartas del subset se
      muestran **agrupadas y etiquetadas** (p. ej. **"Classic Collection"**) con un **separador/encabezado
      visual** dentro del binder, para que el coleccionista distinga la parte del subset sin perder que todo es
      "Celebrations".
- [ ] **(D5) Completitud/"esperadas" del master set = suma de las partes** *(SUPUESTO — confirmar con el
      humano)*: el conteo de **cartas esperadas** y el porcentaje de completitud del master set se calculan
      sobre **la suma de ambas partes** (Celebrations = **50**), de modo que "cubiertas/esperadas · %" refleje
      las 50, no 25.

**Presencia transversal de la agrupación**
- [ ] **Storefront (Compra)** *(§A)*: el filtro/navegación por set y la vista de set del master reflejan el set
      combinado (Celebrations = 50); las cartas del subset aparecen agrupadas y etiquetadas. Se respeta la
      **Regla de Compra**: solo se lista inventario con precio; la agrupación **no** publica cartas sin precio.
- [ ] **Inventario / Master Set (M1)** *(§F)*: la vista Master Set del back-office agrupa padre + subset en un
      binder con separador, y el conteo "cubiertas/esperadas · %" se calcula sobre las 50. El drill-down a piezas
      físicas (folio, ubicación, estado; P-17) **no cambia**: cada pieza sigue ligada a su carta de catálogo real.
- [ ] **Bóveda y portafolio del cliente** *(§C)*: si el cliente tiene cartas de ambas partes, se muestran bajo
      el mismo master set; **la valuación del portafolio no cambia** (cada carta se sigue valuando con el precio
      de referencia de su acabado/su set-id real; §I). La agrupación es de presentación, no de cálculo.
- [ ] **Sync de catálogo (M2)** *(§F)*: el sync sigue importando cada set-id como hoy (`cel25` y `cel25c` como
      entidades reales); la **agrupación se aplica en la capa de presentación** a partir del mapa padre→subset.
      Añadir un par nuevo al mapa **no** requiere re-llavear ni re-importar cartas.

**Casos borde (a cubrir explícitamente)**
- [ ] **Subset importado sin su principal**: si existe `cel25c` pero **no** `cel25` (o viceversa), el master set
      **no revienta**: se muestra lo que haya. *(SUPUESTO: se muestra la(s) parte(s) presente(s) bajo el nombre
      del principal si el principal está definido en el mapa; si falta la parte principal, el subset se muestra
      como su propio set —comportamiento actual— hasta que su principal exista. Confirmar con el humano.)*
- [ ] **Set con más de 2 partes**: el mapa padre→subset debe admitir **un principal con varios subsets** (N
      partes), no solo pares 1:1. El conteo de completitud suma **todas** las partes mapeadas.
- [ ] **Carta que existe en ambas partes / colisión de numeración**: como cada carta conserva su set-id de
      origen (D2), **no hay colisión de identidad**; dentro del binder combinado el separador por subset evita
      ambigüedad de numeración (dos cartas "#20" pueden coexistir, una por parte). *(SUPUESTO: el orden dentro del
      binder es principal primero, luego cada subset en su bloque etiquetado; confirmar con el humano.)*
- [ ] **Inventario/precio de una carta del subset**: sigue operando por su **set-id real** (`cel25c`); publicar,
      priciar, comprar/vender o retirar esa carta **no depende** de la agrupación de master set (money-safe: la
      vista nunca es la fuente de verdad del inventario ni del precio).

### M. Pricing por tiers — agrupar rarezas en peldaños (transversal — v1.9, P-34, LOCKED)
> **Qué es**: reemplazar «**una regla por cada rareza**» por «**una regla por cada `tier`**» y un **mapa
> rareza canónica → tier**. Hoy el editor de M2 (§E.1) muestra una fila por cada rareza distinta del catálogo
> sincronizado (~30 tras el sync); el dueño tiene que configurar 30 reglas. Con tiers configura **5** y cada
> rareza «hereda» la regla de su tier. **Por qué**: para el dueño es más fácil pricear pensando en 5 familias
> de valor («bulk», «uncommon/reverse», «rare/holo», «chase», «grail») que en 30 nombres de rareza.
> **Estado**: **decisiones del humano tomadas y cerradas (LOCKED)** — el número de tiers, sus valores, el mapa,
> el cierre de las rarezas sin mapear y el alcance compra+venta están fijados (ver **Decisiones (v1.9, P-34)**
> al final). **Qué NO cambia** (crítico, money-safe): la **naturaleza de una regla sigue siendo `fixed` (MX$) o
> `pct` (% de la referencia de mercado)** exactamente como §E.1; el `tier` solo dice **qué regla aplica a qué
> rareza**. La **precedencia de compra** (bounty > override > regla/tier > fallback) y la de **venta**
> (override por pieza > override variante > regla/tier > fallback) **no se tocan**; el **eje de acabado**
> (`finish`: normal/reverse_holo/holofoil/1st-ed) **sigue siendo un eje aparte** (ver §I). **Único cambio
> intencional de comportamiento**: **T2 (Rare/Holo) pasa de bin fijo a `pct` bajo de mercado** (ver M.1).
> **Alcance de esta feature**: la **taxonomía** (definir los tiers y el mapa) + el **editor** de M2. **No** se
> diseña aquí el schema ni el contrato del editor (eso es del arquitecto tras esta aprobación); aquí se fija el
> requisito de producto y el mapa aprobado por el humano.

**M.1 — Tiers de precio (LOCKED: 5 tiers, valores por defecto fijados por el humano)**
> **5 tiers (T0–T4)**, aprobados por el humano. Los tiers no-premium **T0–T1** agrupan lo que hoy es
> `premium:false` de bin fijo (bulk); **T2** agrupa Rare/Rare Holo pero **ya no es bin fijo: es `pct` bajo de
> mercado** (cambio intencional, ver abajo); los premium **T3–T4** son % de mercado. Así **ninguna rareza
> premium/chase puede caer nunca a un bin fijo barato** (se preserva el fix de dinero de Fase 0.1). Salvo T2,
> los **valores por defecto reproducen el comportamiento actual** (bulk fijo $0.50/$1.50, chase 40%); el
> humano puede cambiar cada valor sin tocar código.

| Tier | Nombre | `premium` | Regla por defecto (COMPRA/buylist) | Racional |
|---|---|---|---|---|
| **T0** | **Bulk** | no | **FIJO MX$0.50** | Cartas de relleno; no vale la pena mirar mercado. Preserva Common $0.50. |
| **T1** | **Uncommon / Reverse** | no | **FIJO MX$1.50** | Uncommon y reverse/promo de bajo valor. Preserva Reverse Holo $1.50. |
| **T2** | **Rare / Holo** | no | **PORCENTAJE 25% del mercado** *(default bajo, ajustable)* | **LOCKED — cambio intencional**: Rare y Rare Holo dejan de cotizar al **bin fijo** y pasan a un **`pct` bajo** para no infravalorar cartas de banda intermedia. Money-safe: sin referencia de mercado ⇒ **precio pendiente, nunca $0** (igual que T3/T4). |
| **T3** | **Premium / Chase** | sí | **PORCENTAJE 40% del mercado** | El grueso de las chase (ex/V/GX/Ultra/Illustration…). Preserva el 40% vigente. |
| **T4** | **Ultra / Grail** | sí | **PORCENTAJE 40% del mercado** | La cima (Special Illustration, Hyper, Secret, Gold). **LOCKED en 40%** (igual que T3); queda como tier propio por si el dueño luego quiere diferenciarlo sin tocar código. |

> **Cambio intencional de comportamiento (T2)**: antes de v1.9, Rare y Rare Holo eran `premium:false` y
> cotizaban al **bin fijo de bulk**. A partir de v1.9 el humano decidió que **T2 use `pct` bajo (default 25%)**.
> Esto **NO** es un bug ni una regresión: es una decisión de negocio para que la banda intermedia se pague a
> mercado. La money-safety se mantiene: si el `pct` de T2 no tiene referencia de mercado, la carta cae en
> **«precio pendiente»** (nunca $0, nunca bin fijo).
> **Alcance compra + venta (LOCKED)**: la misma taxonomía de tiers aplica a **AMBOS** la tabla de **COMPRA**
> (buylist, `pct` = «% de la referencia») y la de **VENTA** (`computeSalePriceForRarity`, §A/M2, donde `pct` =
> «markup ARRIBA de mercado»). Es **un** mapa rareza→tier compartido con **dos juegos de valores por tier**
> (compra vs. venta). Los valores por defecto de venta los define el arquitecto/backend reproduciendo el
> markup vigente por rareza; el eje de tiers no cambia esa matemática.

**M.2 — Mapa rareza canónica → tier (LOCKED; TODAS las canónicas de `common/rarity-catalog.ts`, v1.29)**
> Cubre las **26 rarezas canónicas** hoy en el catálogo. El `premium` mostrado es el DATO vigente del catálogo;
> el tier respeta ese `premium` (no-premium ⇒ T0–T2, premium ⇒ T3–T4). **El mapa es EDITABLE por el dueño**
> desde M2 (decisión del humano): el dueño puede reasignar una rareza a otro tier sin tocar código; el seed
> arranca con este mapa. La money-safety no depende de que el dueño no se equivoque: el invariante de
> refinamiento estricto (ninguna `premium:true` en un tier de bin fijo) se valida server-side (ver M.4).

| Rareza canónica | `premium` (hoy) | Tier propuesto |
|---|---|---|
| Common | no | **T0 Bulk** |
| Uncommon | no | **T1 Uncommon/Reverse** |
| Reverse Holo | no | **T1 Uncommon/Reverse** |
| Promo | no | **T1 Uncommon/Reverse** *(default; los promos varían, el dueño puede reasignar en M2)* |
| Rare | no | **T2 Rare/Holo** |
| Rare Holo | no | **T2 Rare/Holo** |
| Double Rare | sí | **T3 Premium/Chase** |
| Ultra Rare | sí | **T3 Premium/Chase** |
| Illustration Rare | sí | **T3 Premium/Chase** |
| Rare Holo EX | sí | **T3 Premium/Chase** |
| Rare Holo GX | sí | **T3 Premium/Chase** |
| Rare Holo V | sí | **T3 Premium/Chase** |
| Rare Holo VMAX | sí | **T3 Premium/Chase** |
| Rare Holo VSTAR | sí | **T3 Premium/Chase** |
| Rare Holo LV.X | sí | **T3 Premium/Chase** |
| Rare Prime | sí | **T3 Premium/Chase** |
| Rare BREAK | sí | **T3 Premium/Chase** |
| LEGEND | sí | **T3 Premium/Chase** |
| Amazing Rare | sí | **T3 Premium/Chase** |
| Radiant Rare | sí | **T3 Premium/Chase** |
| Shiny Rare | sí | **T3 Premium/Chase** |
| Trainer Gallery Rare Holo | sí | **T3 Premium/Chase** |
| Rare ACE | sí | **T3 Premium/Chase** *(default; el dueño puede subirla a T4 en M2 si quiere pagar más)* |
| Special Illustration Rare | sí | **T4 Ultra/Grail** |
| Hyper Rare | sí | **T4 Ultra/Grail** |
| Secret Rare | sí | **T4 Ultra/Grail** |
| Gold Rare | sí | **T4 Ultra/Grail** |

**M.3 — Cierre de las rarezas «SIN MAPEAR» (unmapped) — LOCKED (corrección de dinero)**
> Hoy estas caen como `unmapped` (pass-through Title-case) y su tier lo decide `premiumByPattern` (red por
> patrón). **Dos de ellas son money-LOSING hoy** porque el patrón NO las reconoce como premium y las manda al
> bin fijo barato de bulk. El humano **cerró los tres casos** (añadir alias/canónica + tier premium); esto es
> una **corrección de dinero**: dejan de cotizar al bin de bulk.

| Rareza cruda (SIN MAPEAR) | Verdicto `premiumByPattern` HOY | Riesgo hoy | Decisión LOCKED: canónica → tier |
|---|---|---|---|
| **Mega Hyper Rare** | **premium=sí** (contiene «hyper») | OK (cae a fallback %) | **alias de Hyper Rare** → **T4 Ultra/Grail** |
| **`MEGA_ATTACK_RARE`** (valor crudo, snake_case) | **premium=NO** (sin substring ni token v/ex/gx) | **⚠ money-losing**: hoy cotiza al **bin fijo de bulk** | **nueva canónica premium** (p. ej. «Mega Rare») → **T3 Premium/Chase**. **Corrige el bug**: deja de cotizar al bin de bulk. También se **normaliza el valor crudo** (viene en snake_case sin pasar por normalize). |
| **Black White Rare** | **premium=NO** (sin match) | **⚠ money-losing**: hoy cotiza al **bin fijo de bulk** | **nueva canónica premium** «Black White Rare» → **T3 Premium/Chase**. **Corrige el bug**: deja de cotizar al bin de bulk. |

> **Política de cierre (LOCKED)**: estos tres casos quedan fijados. **Puede haber más** rarezas `unmapped` en
> el catálogo real; el **barrido definitivo** (recorrer TODAS las rarezas distintas presentes tras el sync y
> asignarles canónica+tier) lo ejecuta el arquitecto/backend contra los datos reales al implementar, aplicando
> esta misma política (una `unmapped` premium por patrón nunca cae a T0–T2 de bin fijo; ver M.4). Esto **no es
> un hueco de producto** que bloquee al arquitecto: es una tarea de implementación con la política ya fijada.

**M.4 — Money-safe (invariante que NO cambia)**
- [ ] **Rareza sin tier explícito → tier por defecto = regla `pct` de fallback** (`BUYLIST_PRICE_FALLBACK_PCT`,
      default 40% del mercado), **NUNCA $0 y NUNCA el bin fijo de bulk**. Una rareza nueva de un set futuro
      entra `unmapped` y cotiza por el fallback % hasta que se le asigne tier (mismo comportamiento predecible y
      auditable que hoy, R-5).
- [ ] **Refinamiento estricto de `premium`**: el mapa rareza→tier debe respetar el `premium` del catálogo
      canónico —ninguna rareza `premium:true` puede mapear a un tier de bin fijo—, para preservar el fix de
      Fase 0.1 (una chase jamás cotiza al bin barato de bulk). **Nota v1.9**: con T2 ahora en `pct`, los únicos
      tiers de **bin fijo** son **T0 y T1**; T2–T4 son `pct`. El invariante aplica igual (una `premium:true`
      nunca puede caer en T0/T1). Este invariante se valida server-side aunque el mapa sea editable por el dueño.
- [ ] **`pct` sin referencia de mercado → «precio pendiente»** (se escala al dueño), igual que §E.1; jamás se
      inventa ni se descarta el precio. **Aplica explícitamente a T2 (Rare/Holo)**, que a partir de v1.9 es
      `pct`: una Rare/Rare Holo sin precio de mercado del acabado queda **pendiente, nunca $0**.
- [ ] **Derivación server-side (SEC-A1) intacta**: el tier se resuelve en backend desde la **rareza real** de la
      carta (`Card.rarityCanonical`) y el acabado validado, nunca del DTO del cliente. Aplica a **compra y
      venta** por igual (el mismo mapa rareza→tier alimenta ambos ejes de dinero).

**M.5 — Editor (M2) y presencia (LOCKED)**
- [ ] **Editor por tier en M2** *(§E.1, evoluciona)*: la tabla de M2 pasa de «una fila por rareza» a «una fila
      por **tier**» (tier → regla `fixed/%` + valor), **para compra Y para venta** (dos juegos de valores por
      tier, un solo mapa). Editable **sin deploy** y **auditado** (M10).
- [ ] **Mapa rareza→tier EDITABLE por el dueño** (decisión del humano, Opción B): además de editar la regla de
      cada tier, el dueño puede **reasignar una rareza a otro tier** desde M2. El backend valida el invariante
      de refinamiento estricto (M.4) en cada cambio, de modo que una edición no pueda mandar una rareza premium
      a un tier de bin fijo. Todo cambio queda **auditado** (M10).
- [ ] **Compatibilidad / migración**: el seed de tiers y del mapa **reproduce el comportamiento vigente para
      T0/T1/T3/T4** (bulk fijo $0.50/$1.50, chase 40%); **T2 arranca en `pct` 25%** (cambio intencional, NO
      preserva el bin fijo anterior). Las reglas por-rareza actuales se migran a su tier; las tres rarezas
      `unmapped` (M.3) se seedan a su canónica+tier premium.

### N. Valor estimado si se gradea — «gancho de grading» (transversal — NUEVO v2.0)
> **Qué es**: sobre una carta **raw** publicada en Compra, la tienda muestra **cuánto valdría esa misma carta
> si se gradeara PSA 10 o PSA 9**, comparado con su **precio de venta raw actual**.
> **Por qué (comercial)**: es un **argumento de venta**, pedido así por el humano — *«si compras esta que no
> vale mucho sin gradear y la gradeas podría valer tanto más, y que se animen a comprar más mis cartas»*.
> Convierte inventario raw barato o de rotación lenta en una **historia de upside** («esta cuesta MX$120; si
> sale PSA 10 vale MX$1,900»), sube el ticket promedio y da una razón para volver al catálogo, **sin bajar
> precios ni regalar margen**.
> **Qué NO es (crítico, legal-comercial)**: es un **estimado informativo con disclaimer**. **No** es un precio
> de venta, **no** es una oferta, **no** es una promesa de que la carta obtenga ese grado, **no** es un
> compromiso de recompra, y **no** se usa para valuar el portafolio, fijar el precio de venta ni cotizar
> buylist. Ver **N.5** (disclaimer) y «Fuera de alcance».
> **Alcance de esta feature**: la **presentación** en el storefront (ficha, tejas de Compra, home) más la
> **derivación server-side** del estimado y de su **elegibilidad**. **No** cambia el precio de venta, el
> buylist, la bóveda, el inventario ni el P&L. El schema, el contrato y el caching los diseña el arquitecto;
> aquí solo se fija el requisito de producto. *(Nota operativa para el arquitecto: el contrato de API va en
> **v1.43**.)*

**N.1 — Dónde aplica (alcance del producto)**
- [ ] Aplica **solo a cartas raw (singles)** de nuestro inventario **publicado en Compra** — es decir, con
      **precio de venta fijado** (se respeta la **Regla de Compra**, §A: lo que no tiene precio no se lista, y
      esta feature **no** publica nada que hoy no se publique).
- [ ] **No aplica a gradeadas** (ya tienen grado real: el slab con empresa + grado + `certNumber` es el dato,
      §H) **ni a sellado** (§K).
- [ ] **Grados cubiertos en el MVP: PSA 10 y PSA 9, únicamente.** Otras graduadoras (CGC/BGS/TAG) y otros
      grados (PSA 8 o menos) quedan **fuera de alcance**.
- [ ] El estimado se muestra en **MXN**, con el mismo tratamiento de conversión y **refresco diario** del
      resto de precios (§A / «Fuentes de precio»), y **solo para las cartas que ya priciamos** (las que están
      en bóveda/inventario), para no romper los límites del proveedor.

**N.2 — Gate de ROI sobre PSA 9 = CRITERIO DE CURADURÍA INTERNO (ACTUALIZADO 2026-08-23)**
> **Qué hace el gate**: decide **qué cartas promocionamos activamente**, no qué se le enseña al cliente.
> Selecciona las cartas en las que el comprador **gana incluso en el peor caso razonable** —que la carta salga
> **PSA 9** en vez de PSA 10—, comparando el estimado de **PSA 9** contra **lo que le cuesta la jugada
> completa** (lo que paga por la carta raw **más** lo que le costará gradearla), con un **margen mínimo**.
> **Cambio de papel (decisión del humano, 2026-08-23)**: el gate **ya no condiciona que se vea el gancho**;
> ahora **gobierna la curaduría de las superficies de promoción**. Cita del humano: *«calcúlalo para que
> podamos ponerlo en la sección de destacado algo que valga la pena»*. Concretamente:
> - **Ficha de carta** → los estimados se muestran **siempre que haya dato**, **sin** condicionar al gate. Es
>   información para quien **ya está viendo esa carta**; no le estamos vendiendo la idea, se la estamos dando.
> - **Teja de catálogo y vitrina del home** → aparecen **SOLO si el gate se cumple**. Son las superficies donde
>   **promocionamos activamente**, y ahí solo entra lo que **de verdad vale la pena**.
> **El resultado del cálculo NUNCA se expone al cliente**: ni la ganancia neta, ni el escalón de costo
> aplicado, ni un multiplicador, ni el margen. El gate vive **entero del lado del servidor** y su única huella
> visible es **qué cartas aparecen** en teja/vitrina y **en qué orden**. Esto **refuerza SEC-A1**: el cliente
> ya ni siquiera recibe los insumos del cálculo, así que no hay nada que manipular.

- [ ] **Fórmula de curaduría** (se evalúa **server-side** y **no se expone**, ver N.4):

```
gradingCost   =  costo del ESCALÓN cuyo rango contiene el valor declarado de la carta   (tabla N.2.1)

promocionable ⇔  estimadoPSA9  ≥  (precioVentaRaw + gradingCost) × (1 + minUpsidePct)

gananciaNeta  =  estimadoPSA9 − (precioVentaRaw + gradingCost)      ← SOLO para ordenar la vitrina;
                                                                      NUNCA se muestra al cliente
```

> **La matemática del gate no cambió** respecto a la decisión original del humano: sigue siendo «el comprador
> debe ganar incluso saliendo PSA 9», y `gradingCost` se sigue **resolviendo por escalones** (N.2.1). Lo que
> cambió *(2026-08-23)* es **para qué sirve el resultado**: antes decidía si se veía el gancho; ahora decide
> **qué se promociona y en qué orden**.

- [ ] **Dos diales configurables por el admin** (editables **sin deploy** y **auditados** en M10):

| Dial | Qué representa (lenguaje de producto) | Default |
|---|---|---|
| `gradingCostTiers` | **Tabla de escalones**: rangos de **valor declarado** de la carta → **costo de gradeo estimado en MXN**. Imita cómo cobra **PSA**, que cobra **por nivel de servicio según el valor declarado**: entre más vale la carta, más caro sale gradearla. Ver **N.2.1**. | ver tabla N.2.1 |
| `minUpsidePct` | **Margen mínimo** que le debe quedar al comprador **por encima** del costo total para que **valga la pena promocionar** esa carta. Debajo de eso, la ganancia es tan chica que no justifica ponerla en portada. | **30%** |

**N.2.1 — Tabla de escalones del costo de gradeo (`gradingCostTiers`) — ACTUALIZADO 2026-08-23**
> **Por qué escalones y no un costo plano** *(decisión del humano; corrige el supuesto anterior de MX$600
> plano)*: **PSA cobra por nivel de servicio según el valor declarado** de la carta. Un costo plano se queda
> **corto justo en las cartas caras**, que es donde el comprador arriesga más dinero — y el gate saldría
> **optimista precisamente donde más duele**. Con escalones, una carta cara tiene que superar un costo de
> gradeo mayor para ganarse el gancho.
> **Qué incluye cada escalón (importante)**: no es solo la cuota de PSA. Cada escalón cubre el **costo total
> puerta a puerta para un comprador en México**: **cuota de PSA + envío internacional (México → EE. UU.) +
> retorno asegurado a México + logística/manejo**. Omitir el envío internacional volvería el gate optimista
> otra vez: para un mexicano ese costo es **real y significativo**, muchas veces comparable a la propia cuota.

| # | Valor declarado de la carta (MXN) | Costo de gradeo estimado (MXN) |
|---|---|---|
| 1 | hasta **$2,000** | **$700** |
| 2 | **$2,001 – $5,000** | **$1,100** |
| 3 | **$5,001 – $10,000** | **$1,800** |
| 4 | **$10,001 – $20,000** | **$3,000** |
| 5 | **$20,001 – $50,000** | **$6,000** |
| 6 | **de $50,001 en adelante** *(escalón final abierto)* | **$12,000** |

- [ ] **Cobertura total sin huecos**: la tabla debe cubrir **todo el rango de valores** de forma **contigua**
      (el límite superior de un escalón es el inicio del siguiente) y **terminar en un escalón abierto**
      («de X en adelante»). **Ningún valor de carta puede quedarse sin escalón**: si por una edición del admin
      quedara un hueco o la tabla estuviera vacía, la carta **no es elegible** y **no se muestra nada** (regla
      money-safe de N.4; jamás se asume costo $0 ni se cae a un default silencioso).
- [ ] **Qué valor se usa para buscar el escalón** *(SUPUESTO, conservador)*: el **valor declarado = el estimado
      PSA 10** de la carta. Es lo que un comprador declararía a la graduadora y es el **escenario más caro**,
      así que empuja a la carta al **escalón más alto posible** → costo mayor → **gate más estricto**. Confirmar
      con el humano si prefiere usar el **estimado PSA 9** o el **precio de venta raw** (ambos darían un gate
      más permisivo).
- [ ] **Los valores por defecto de la tabla son un SUPUESTO revisable por el humano**: son cifras de arranque
      razonables y deliberadamente **conservadoras** (mejor sobreestimar el costo que prometer de más), pero el
      dueño debe validarlas contra lo que realmente le cuesta gradear hoy —cuotas vigentes de PSA, su
      transportista y el tipo de cambio— y ajustarlas desde el admin **sin deploy**.
- [ ] **Editable y auditado**: el admin puede **añadir, quitar y editar escalones** (rango + costo) desde el
      back-office; el cambio surte efecto **sin redeploy**, queda **auditado** (M10) y **recalcula el conjunto
      de cartas elegibles**.
- [ ] *(Nota para el arquitecto — no es decisión de producto: en el proyecto **ya existe un patrón de tabla de
      escalones configurable por admin**, el de **tiers de rareza** (`GET/PUT /admin/pricing/tiers`, §4.33 del
      contrato). Se **sugiere reusar ese patrón** —mismo estilo de endpoint, validación y auditoría— en vez de
      inventar uno nuevo. La decisión de diseño es del arquitecto.)*

- [ ] **El PSA 10 es el premio mayor, no el juez**: el PSA 10 es la cifra que ilusiona y se muestra en la
      ficha, pero **lo que decide si promocionamos la carta es exclusivamente el PSA 9**.
      **Racional de producto (por qué el gate NO es sobre PSA 10)**: si promocionáramos con base en PSA 10, un
      cliente al que le **salga PSA 9** —el resultado más común— podría **perder dinero** después de pagar la
      carta y el gradeo. Eso **quema la reputación de la tienda** y convierte el gancho en una queja. Con el
      gate sobre **PSA 9**, casi cualquier resultado razonable le deja ganancia, y el PSA 10 es upside extra.
- [ ] **Sin estimado de PSA 9 no se promociona**: si existe estimado de **PSA 10** pero **no** de **PSA 9**, la
      carta **no entra** a teja ni a vitrina (no se infiere, no se interpola, no se aproxima el PSA 9 a partir
      del PSA 10). *(En la **ficha** sí puede mostrarse el PSA 10 que sí existe — ver N.3.)*
- [ ] *(SUPUESTO: el cálculo usa el **precio de venta raw sin IVA** —el mismo número que ve el comprador en la
      ficha, §B— y **no** incluye el envío de la carta ni el IVA en `precioVentaRaw`. Confirmar con el humano
      si quiere una curaduría aún más conservadora incluyendo esos conceptos; ver preguntas abiertas v2.0.)*

**N.3 — Las tres superficies (SIMPLIFICADAS — ACTUALIZADO 2026-08-23)**
> **Decisión del humano (cita textual)**: *«no hay que mostrarlo así mejor. Solo pongamos cuánto vale en
> PSA 10… nos quitamos talacha de calcularlo… solo bajemos el precio y desplegamos "en PSA 10 vale tanto"»*.
> Preguntado explícitamente por el PSA 9, confirmó que **quiere los dos grados**.
> **Lo que el cliente ve, en total**: el **precio de la carta** + los **valores estimados PSA 10 y PSA 9**.
> **Nada más.** **Se elimina** el multiplicador («×6»), la **diferencia/ganancia calculada**, el **costo de
> gradeo mostrado**, el **margen** y cualquier **comparativa** o narrativa de rendimiento.
> **Por qué es mejor** (y no solo más simple): (a) le quita a la tienda la **talacha de calcular y explicar**;
> (b) **baja el riesgo legal** —una cifra de referencia es un dato; una ganancia calculada se parece mucho a
> una promesa—; (c) el número **habla solo**: si la carta cuesta MX$120 y el PSA 10 vale MX$1,900, el
> comprador saca su propia conclusión sin que nosotros se la afirmemos.

- [ ] **(1) Ficha de carta** *(§A)* — la superficie informativa. Muestra **únicamente**:
      - el **precio de venta de la carta** (el que ya se muestra hoy, sin cambio),
      - el **estimado PSA 10**,
      - el **estimado PSA 9**,
      - la **fecha del último refresco** del estimado,
      - la **llamada al disclaimer** (asterisco) y su **nota al pie** (N.5).
      **Nada calculado**: sin multiplicador, sin diferencia, sin ganancia, sin costo de gradeo, sin
      comparativa. **No está condicionada al gate**: si hay dato, se muestra.
      **Si solo existe uno de los dos grados**, se muestra **el que exista** *(SUPUESTO: es información, no
      promoción; ver preguntas abiertas v2.0)*.
- [ ] **(2) Badge en las tejas del catálogo (Compra)** *(§A)* — superficie de **promoción**: aparece **solo en
      cartas que pasan el gate** (N.2). Badge compacto con el **estimado PSA 10**.
      *(SUPUESTO de copy, para aprobación: **«En PSA 10 vale ≈ MX$X»**; en móvil, **«PSA 10 ≈ MX$X»**.)*
      Lleva su **micro-aviso + llamada al pie** (N.5). Las tejas que **no** pasan el gate se ven **exactamente
      como hoy**: **no hay badge vacío, tachado ni en gris**.
- [ ] **(3) Vitrina en el home: «Joyas para gradear»** — superficie de **campaña**: solo cartas que **pasan el
      gate**, **publicadas y disponibles**, cada una con su teja + badge y enlace a su ficha.
      **Orden: por mayor `gananciaNeta` sobre PSA 9** (el escenario **realista**, no el optimista) — así lo
      primero que ve el visitante es lo que mejor sostiene el argumento aun en el caso conservador.
      **El criterio de orden es interno: la cifra que ordena NUNCA se muestra ni se envía al cliente.**
      *(SUPUESTO: hasta **8** cartas; ver preguntas abiertas v2.0.)*
      **Si ninguna carta pasa el gate, la vitrina completa NO se renderiza** (no aparece vacía, ni con
      placeholder, ni con «próximamente»).
- [ ] **Regla transversal — el cálculo no se filtra**: en **ninguna** de las tres superficies se muestra (ni se
      envía al cliente en el payload) la **ganancia neta**, el **escalón de costo aplicado**, el
      **multiplicador**, el **margen** ni el **flag de elegibilidad**. Lo único observable desde fuera es
      **qué cartas aparecen** y **en qué orden**.
- [ ] **Bilingüe (§ i18n, criterio 32)**: todos los textos de las tres superficies —incluidos el micro-aviso y
      la nota al pie— existen en **español e inglés**, con default español. Los **datos del catálogo** siguen
      en inglés.

**N.4 — Money-safe y derivación server-side (regla dura, no negociable)**
> Esta feature es **un argumento de venta**, así que la regla money-safe se aplica **más estricta que en
> ningún otro lado**: en una promesa comercial no se muestra un hueco. El precedente es el fast-follow de
> seguridad que cerró el **«$0 latente»** — un $0 o un guion en un gancho de venta es peor que no mostrar nada.

- [ ] **Ausencia total de render ante cualquier hueco**: **una cifra que no existe no se dibuja**. Si falta un
      estimado, **esa cifra no aparece**; si no falta ninguno pero falta el precio de venta, la carta ni
      siquiera está publicada (§A). **Nunca** se muestra **$0**, **nunca** un guion (`—`), **nunca** un rango
      inventado, y —a diferencia de otros módulos— **ni siquiera «precio pendiente»**: el estado «pendiente» es
      un concepto de back-office, no algo que se le enseñe al comprador.
- [ ] **Regla por superficie** *(actualizada 2026-08-23)*:
      **Ficha** → se muestra **lo que haya** (PSA 10 y/o PSA 9), **sin** depender del gate.
      **Teja y vitrina** → **solo** si el gate se cumple; si no se cumple, o si falta cualquier insumo del gate
      (PSA 9, precio, escalón), **no se renderiza el badge ni la entrada de vitrina** — y **sin dejar rastro
      visual**.
- [ ] **Sin escalón, no se promociona**: si el valor de la carta **no cae en ningún escalón** de
      `gradingCostTiers` (tabla vacía, con huecos o mal editada), la carta **no pasa el gate** y por tanto **no
      entra a teja ni a vitrina**. **Jamás** se asume costo **$0** ni se cae a un default silencioso — un costo
      de gradeo subestimado es exactamente lo que haría que promocionáramos una carta en la que el comprador
      pierde dinero. *(La **ficha** no se ve afectada: ahí el estimado es información, no promoción.)*
- [ ] **Curaduría y montos derivados server-side (SEC-A1) — REFORZADO**: el backend evalúa el gate y ordena la
      vitrina a partir del precio de venta real, los estimados reales, la **tabla de escalones real** y los
      diales reales. El cliente **recibe únicamente la lista ya curada y ordenada, más las cifras que se
      pintan** (PSA 10 / PSA 9). **Ya no recibe los insumos del cálculo** —ni `gradingCost`, ni `minUpsidePct`,
      ni la ganancia neta, ni un flag de elegibilidad—, así que **no hay nada que manipular**: un DTO alterado
      no puede meter una carta a la vitrina, cambiar su posición ni alterar una cifra. *(Simplificar la
      superficie visible (N.3) **redujo la superficie de ataque**: menos datos expuestos, menos que proteger.)*
- [ ] **El estimado no toca dinero real**: **no** modifica el precio de venta (§A/§B), **no** entra en la
      **valuación ni en la tendencia del portafolio** (§C), **no** afecta la **cotización de buylist** (§E/§M),
      **no** afecta el **costo/P&L de M7** y **no** cambia el **valor de inventario**. Es una **capa de
      presentación** alimentada por precios de referencia, igual que cualquier otro precio mostrado.
- [ ] **Frescura del dato** *(SUPUESTO)*: un estimado con más de **30 días** sin refresco se considera
      **rancio** y **deja de mostrarse** (mejor callar que presumir un número viejo en una promesa comercial).
      Confirmar el umbral con el humano; ver preguntas abiertas v2.0.

**N.5 — Disclaimer (ES / EN) — BORRADOR PARA APROBACIÓN DEL HUMANO — ACTUALIZADO 2026-08-23**
> **Este texto es una propuesta del product-owner y requiere aprobación explícita del humano** (idealmente con
> revisión legal, ver «Riesgos y banderas»).
> **Tono pedido por el humano (2026-08-23)**: *«súper enfático que es información ilustrativa, que no refleja
> el estado de nuestras cartas»*. El objetivo es que **nadie pueda alegar después que se le prometió algo** —
> pero sin convertirlo en un muro de letra chiquita ilegible: tiene que poder leerlo un comprador normal.
> **El punto nuevo y más importante** (que el borrador anterior NO cubría): el estimado es un dato de mercado
> **genérico de esa carta**, y **NO es una evaluación de la pieza concreta que estamos vendiendo** — no hemos
> inspeccionado ni pre-evaluado su condición, centrado, superficie ni bordes para efectos de gradeo. Una carta
> raw de nuestro inventario puede perfectamente tener defectos que **jamás** sacarían PSA 10.
> **Los seis elementos obligatorios** del texto: (1) es **información ilustrativa / de referencia de
> mercado**, no una valuación de nuestra carta; (2) **no refleja ni evalúa el estado de la carta que
> vendemos** (no la inspeccionamos ni opinamos sobre qué grado obtendría); (3) **no garantizamos ningún
> grado** —lo determina PSA de forma independiente y puede ser **mucho menor**, o la carta puede no ser
> elegible—; (4) **no es oferta, ni garantía de precio, ni compromiso de recompra**; (5) **no gradeamos ni
> intermediamos el gradeo**: costo, envío y tiempos corren por cuenta del comprador; (6) los **precios de
> mercado cambian a diario** y el estimado puede quedar desactualizado.

- [ ] **Versión completa (ficha de carta) — ES** *(borrador)*:
      > **INFORMACIÓN ILUSTRATIVA. NO ES UNA VALUACIÓN DE ESTA CARTA.**
      >
      > Las cifras de **PSA 10 / PSA 9** son un **dato de referencia de mercado** sobre **ese modelo de carta
      > ya gradeado por terceros**. Se muestran para ilustrar cómo se comporta el mercado, **nada más**.
      >
      > **NO reflejan ni evalúan el estado de la carta que estás comprando.** **No** hemos inspeccionado,
      > medido ni pre-evaluado esta pieza para efectos de gradeo —ni su centrado, ni su superficie, ni sus
      > bordes, ni sus esquinas— y **no opinamos sobre qué grado obtendría**. Vendemos esta carta como **raw
      > (sin gradear) en Near Mint** según nuestro propio estándar de condición, que es **una cosa distinta**
      > de un grado de PSA.
      >
      > **NO garantizamos ningún grado.** El grado lo determina **PSA**, de forma **independiente** y bajo sus
      > propios criterios. El resultado **puede ser muy inferior** al que aquí se ilustra, y la carta **puede
      > incluso no ser elegible** para gradeo. **Gradear es una apuesta y el riesgo es enteramente tuyo.**
      >
      > **Esto no es una oferta, ni una garantía de precio, ni un compromiso de recompra** por parte de TCG
      > Vault MX. Si mandas la carta a gradear y el resultado no es el que esperabas, **no hay reembolso,
      > compensación ni devolución por ese motivo** (aplica nuestra política de ventas finales).
      >
      > **TCG Vault MX no gradea cartas ni intermedia el servicio de gradeo.** La **cuota de PSA, el envío
      > internacional, el retorno a México, los seguros y los tiempos de espera corren por tu cuenta**.
      >
      > **Los precios de mercado cambian todos los días** y este estimado puede quedar desactualizado en
      > cualquier momento.

- [ ] **Versión completa (ficha de carta) — EN** *(borrador)*:
      > **ILLUSTRATIVE INFORMATION ONLY. THIS IS NOT AN APPRAISAL OF THIS CARD.**
      >
      > The **PSA 10 / PSA 9** figures are **market reference data** for **that card model as graded by third
      > parties**. They are shown to illustrate how the market behaves — **nothing more**.
      >
      > **They do NOT reflect or evaluate the condition of the card you are buying.** We have **not**
      > inspected, measured or pre-screened this specific copy for grading purposes — not its centering, not
      > its surface, not its edges, not its corners — and **we offer no opinion on what grade it would
      > receive**. We sell this card as **raw (ungraded) Near Mint** under our own condition standard, which
      > is **a different thing** from a PSA grade.
      >
      > **We guarantee no grade whatsoever.** The grade is determined by **PSA**, **independently** and under
      > its own criteria. The result **may be far below** what is illustrated here, and the card **may not
      > even be eligible** for grading. **Grading is a gamble and the risk is entirely yours.**
      >
      > **This is not an offer, not a price guarantee, and not a buy-back commitment** by TCG Vault MX. If you
      > send the card in for grading and the result is not what you hoped for, **there is no refund,
      > compensation or return on that basis** (our final-sale policy applies).
      >
      > **TCG Vault MX does not grade cards and does not broker grading services.** **PSA fees, international
      > shipping, return shipping to Mexico, insurance and turnaround times are entirely on you.**
      >
      > **Market prices change every day** and this estimate may become outdated at any time.

> **Dónde vive este texto completo** *(actualizado 2026-08-23)*: **al pie de la página**, referenciado con una
> **llamada (asterisco)** junto a cada cifra. Ver «Regla de presentación» abajo.

- [ ] **Versión corta / micro-aviso (junto a la cifra: badge y bloque de ficha) — ES** *(borrador)*:
      > *Cifra **ilustrativa** de mercado. **No evaluamos el estado de esta carta** ni garantizamos ningún
      > grado; el gradeo y su costo corren por tu cuenta.*
      > *(Variante ultra-corta para el badge, donde no cabe la anterior: **«Ilustrativo; no evaluamos esta
      > carta.\***».)*
- [ ] **Versión corta / micro-aviso (junto a la cifra: badge y bloque de ficha) — EN** *(borrador)*:
      > ***Illustrative** market figure. **We have not assessed this card's condition** and guarantee no
      > grade; grading and its cost are on you.*
      > *(Ultra-short variant for the badge: **«Illustrative; we haven't assessed this card.\***».)*

**Regla de presentación — PATRÓN DE NOTA AL PIE (ACTUALIZADO 2026-08-23)**
> **Decisión del humano (cita textual)**: *«El completo solo hagamos referencia con un asterisco donde ponemos
> el tag y hasta abajo de la página lo ponemos»*. **El texto completo NO se poda** —el humano lo quiso
> íntegro—: cambia **dónde vive**, no qué dice. El **tratamiento visual** lo diseña **ux-ui**; aquí solo se
> fija la **regla de producto**.

- [ ] **Llamada + nota al pie**: **toda cifra estimada** (PSA 10 o PSA 9, en cualquier superficie) lleva una
      **llamada visible** (asterisco) junto a ella, y la **página que la contiene** lleva el **texto completo
      del disclaimer al pie**. La llamada y su nota deben estar **vinculadas** (que se pueda llegar del
      asterisco al texto).
- [ ] **Ninguna página huérfana**: **ninguna página que muestre una cifra estimada puede carecer de su nota al
      pie completa**, y **ninguna cifra estimada puede carecer de su llamada**. Aplica a las tres superficies:
      **home** (vitrina), **listado de Compra** (tejas) y **ficha**. Si una página muestra varias cifras, basta
      **una** nota al pie que las cubra todas.
- [ ] **DECISIÓN DE PRODUCTO — se conserva un micro-aviso junto a la cifra, ADEMÁS de la llamada**: la llamada
      al pie **no sustituye** a las dos ideas obligatorias. Junto a la cifra (en el badge y en el bloque de la
      ficha) va un **micro-aviso mínimo** que carga **«ilustrativo»** + **«no evaluamos esta carta»**, y el
      asterisco lleva al texto completo.
      *(SUPUESTO de copy, para aprobación — ES: **«Ilustrativo; no evaluamos esta carta.\***» · EN:
      **«Illustrative; we haven't assessed this card.\***».)*
      **Argumento de la decisión**: una nota al pie **protege menos que un aviso adyacente** si el comprador
      **nunca baja** — y en la **vitrina del home** y en el **listado de Compra** eso es lo normal: el
      visitante ve un carrusel o una cuadrícula y hace clic sin llegar jamás al pie de página. Las dos ideas
      que retenemos son **exactamente las que desactivan el reclamo «me prometieron»**: que la cifra es
      ilustrativa y que **no opinamos sobre esta pieza**. Todo lo demás del disclaimer (grado no garantizado,
      no es oferta, costos por cuenta del comprador, precios cambian) **sí** puede vivir al pie sin pérdida
      práctica, porque son matices de algo que el micro-aviso ya encuadró. El costo es **una línea de texto
      chiquita**; el beneficio es que **no dependemos de que el usuario haga scroll** para estar cubiertos.
      *(Si el humano prefiere prescindir del micro-aviso y dejar solo la llamada, es una decisión suya —
      conviene que la tome con revisión legal, porque debilita la cobertura en home y listado.)*
- [ ] **La versión corta / micro-aviso debe cargar las dos ideas clave**: que es **ilustrativo** y que **no
      evaluamos esta carta**. Un micro-aviso que solo diga «estimado de mercado» **no cumple** este requisito.
- [ ] **El texto completo es el mismo en todas las páginas** (no hay versiones recortadas por superficie) y
      existe en **ES y EN** (criterio 32).
- [ ] *(SUPUESTO: el disclaimer se muestra **en línea** junto a la cifra, no solo en términos/FAQ. Se
      recomienda además reflejar el mismo texto en la **página de términos/políticas**; confirmar con el
      humano y con revisión legal.)*

**N.6 — Fuente del dato: la feature arranca MANUAL-FIRST (ACTUALIZADO 2026-08-23)**
> **Contexto**: la **verificación técnica del proveedor** (doctrina P-6) concluyó que **hoy no se puede
> construir el ingest automático**: los precios PSA **sí existen** en PokemonPriceTracker, pero (a) exigen un
> **parámetro extra que duplica el consumo de créditos**, (b) el **formato exacto del payload no está
> confirmado** —la documentación del proveedor se contradice a sí misma— y (c) **falta saber** si el dato viene
> en el **barrido por set** o exige **una petición por carta** (lo que cambia por completo el costo de
> operarlo). Por eso la feature se entrega en **dos fases**.
> **Lo importante para producto: el comportamiento visible al usuario es IDÉNTICO en ambas fases.** Cambia **de
> dónde sale el número**, no lo que ve el comprador: mismas tres superficies, mismo gate, mismo disclaimer,
> mismas reglas money-safe. **Todos los criterios de aceptación (79–92) deben poder verificarse en fase 1.**

- [ ] **FASE 1 — lo que se entrega ahora (manual-first)**: la feature **completa** —las tres superficies, el
      gate de ROI, los escalones de costo, el disclaimer, la i18n y las reglas money-safe— funcionando con
      valores **PSA 10 / PSA 9 fijados manualmente por el admin**. Se usa el **override manual de precio que
      YA existe** (`POST /admin/pricing/override`, que ya escribe exactamente las filas necesarias): **no hay
      que construir mecanismo de captura nuevo**. En la práctica, **el humano cura a mano sus cartas gancho**:
      elige las piezas que quiere empujar y les fija sus valores PSA. Es coherente con el espíritu de la
      feature —el gancho es **curaduría comercial**, no un barrido masivo del catálogo.
- [ ] **FASE 2 — ingest automático (posterior, BLOQUEADA)**: alimentar los valores PSA automáticamente desde
      **PokemonPriceTracker** (proveedor **ya contratado**; API key gestionada en el entorno de despliegue,
      Railway). **Está bloqueada** hasta **confirmar el formato real del payload** mediante una **observación
      del operador en staging** (con la key real, mirando la respuesta cruda del proveedor). Hasta que eso
      ocurra, **no se construye el ingest** — no se codifica contra una documentación que se contradice.
- [ ] **Precedencia (vale en ambas fases)**: **override manual del admin > estimado automático del proveedor
      (cuando exista) > sin dato ⇒ no se renderiza** (N.4). El override manual es **siempre** la máxima
      precedencia, también después de encender el ingest.
- [ ] **Nunca se inventa un dato**: en fase 1, una carta **sin override manual** simplemente **no muestra
      cifra estimada** en ninguna superficie. No se infiere, no se aproxima, no se interpola desde el precio
      raw ni desde el otro grado.
- [ ] **Pasar de fase 1 a fase 2 no requiere rediseño de producto**: es un cambio de **origen del dato**. Las
      superficies, el gate, los diales, el disclaimer y los criterios de aceptación **no cambian**.
- [ ] **PriceCharting sigue fuera del MVP** (sin cambio respecto a «Fuera de alcance»).

**N.7 — Flujos críticos (base para el E2E de QA) — verificables en FASE 1 (manual-first)**
> **Camino feliz — el gancho hace su trabajo:**
> 1. El admin tiene publicada en Compra una carta **raw** con precio de venta fijado, y **le fija a mano** sus
>    valores **PSA 10 y PSA 9** con el override manual existente (fase 1, N.6).
> 2. Los valores **pasan el gate** con los diales por defecto (**escalón de costo** que corresponda a esa carta
>    según N.2.1 + `minUpsidePct` 30%) → la carta queda **promocionable**.
> 3. Un visitante entra al **home** y ve la vitrina **«Joyas para gradear»** con esa carta.
> 4. Entra a **Compra** y ve la **teja con badge** (estimado PSA 10 + micro-aviso + llamada), y la página lleva
>    su **nota al pie completa**.
> 5. Abre la **ficha** y ve **solo**: el **precio de la carta**, el **estimado PSA 10**, el **estimado PSA 9**,
>    la **fecha de refresco**, el **micro-aviso** y la **llamada al pie**. **No ve** multiplicador, ganancia,
>    costo de gradeo ni comparativa alguna.
> 6. Cambia el idioma a **inglés** y todos esos textos —micro-aviso y nota al pie incluidos— salen en inglés.
>
> **Flujo crítico — la curaduría protege al comprador:** el admin sube `minUpsidePct` (o el estimado PSA 9
> baja) de modo que la carta **deja de pasar el gate** → al recargar, **desaparecen el badge y su entrada en la
> vitrina** sin dejar rastro visual (ni hueco, ni $0, ni «pendiente»); **la ficha sigue mostrando sus
> estimados** (ahí no aplica el gate) y **el precio de venta de la carta no cambió**.
>
> **Flujo crítico — los escalones encarecen las cartas caras:** dos cartas con el **mismo múltiplo** de upside
> pero **valores muy distintos** (una de ~MX$1,500 y otra de ~MX$60,000) resuelven **escalones diferentes**
> (MX$700 vs MX$12,000) → la cara necesita **mucho más** upside para promocionarse. Verificable construyendo
> el caso en que la barata **sí** entra a la vitrina y la cara **no**.
>
> **Flujo crítico — orden de la vitrina:** con tres cartas promocionables de **ganancia neta sobre PSA 9**
> distinta, la vitrina las lista **de mayor a menor ganancia neta** — verificable **por el orden**, ya que la
> cifra que ordena **no se muestra ni viaja al cliente**.
>
> **Flujos negativos que QA debe cubrir:** carta **sin estimado PSA 9** (aunque tenga PSA 10) → **no entra** a
> teja ni vitrina, pero **la ficha sí muestra el PSA 10**; carta **sin estimado alguno** (caso normal en fase
> 1) → no muestra cifra en ninguna superficie; carta **gradeada** y **sellado** → nunca muestran cifra
> estimada; **cero cartas promocionables** → la vitrina del home **no se renderiza**; **tabla de escalones
> vacía o con hueco** → la carta no se promociona y **nunca** se asume costo $0; **payload inspeccionado desde
> el cliente** → **no contiene** ganancia neta, escalón de costo, `minUpsidePct` ni flag de elegibilidad
> (SEC-A1); **DTO manipulado** → no mete cartas a la vitrina, no cambia el orden ni las cifras; **estimado
> rancio** (más de 30 días) → no se muestra; **página con cifra estimada pero sin nota al pie**, o **cifra sin
> llamada/micro-aviso** → defecto **bloqueante**.

## Fuera de alcance (por ahora — fase 2 o posterior)
- **Consignación / marketplace C2C** (cartas de terceros vendidas dentro de la bóveda).
- **Order-book / trading instantáneo** (compra/venta digital tipo bolsa dentro de la bóveda).
- **Wallet de saldo** para usuarios (el dinero se liquida por transacción).
- **Pagos y logística automatizados** (guías automáticas, pagos SPEI automáticos): en MVP son manuales.
- **Grading propio o integración directa con PSA/CGC** *(alcance ACLARADO en v2.0 — ver §N)*: lo que queda
  fuera es **gradear cartas nosotros**, **ofrecer o intermediar el servicio de gradeo**, **enviar cartas del
  cliente a PSA/CGC**, y **verificar slabs por integración** (API de submission o de verificación de
  certificados; el `certNumber` se verifica **a mano** en la web de la graduadora, §H).
  **Esta exclusión NO cubre mostrar estimados informativos de valor por grado**: el **valor estimado si se
  gradea** (**§N**, PSA 10 / PSA 9) es una **función de presentación de precios de mercado** —igual que
  cualquier otro precio de referencia que ya mostramos— y **SÍ está DENTRO del MVP**. Mostrar cuánto vale una
  carta gradeada ≠ gradearla.
- **App móvil nativa** (el panel es web responsive; no hay captura de fotos porque el producto no lleva
  fotos propias).
- **Object storage / bucket de archivos (p. ej. R2) — uso para fotos de producto y de disputa**: **fuera del
  MVP**. No hay fotos de producto/inventario (se usa la imagen de catálogo remota de pokemontcg.io) ni subida
  de evidencia de disputa (llega por correo a soporte). El object storage **sí está dentro del MVP pero
  acotado SOLO al INE del buylist** (`kyc_ine`, imagen cifrada con retención; ver Restricciones técnicas). La
  **CLABE** no usa object storage por ser un **número cifrado en BD**, no un archivo.
- **Timbrado de CFDI con PAC / facturación automática**: en el MVP la factura es **manual por correo**
  (el cliente envía sus datos fiscales); el timbrado automatizado con PAC es fase 2.
- **Cobro de almacenamiento en bóveda** (derecho genérico declarado en términos, pero no se cobra en MVP).
- **Envío/venta internacional**: el MVP es **solo nacional (México)**; internacional es fase 2.
- **PriceCharting**: **no se usa en el MVP**. Las fuentes free + override manual cubren singles/gradeadas, y
  el **precio del sellado se deriva de TCGCSV por spread** *(actualizado v1.6, ver §K — supersede el uso
  previo de PriceCharting como fuente de mercado del sellado)*. PriceCharting queda como **opción futura** si
  se decide.
- **Bóveda para invitados** *(v1.5)*: guardar en custodia **requiere cuenta**, por decisión de producto (la
  bóveda es el gancho de registro). No se contempla ninguna variante de "bóveda temporal sin cuenta".
- **Buylist / venta como invitado** *(v1.5)*: vender cartas a la plataforma sigue exigiendo cuenta (hay
  KYC, CLABE y pagos SPEI de por medio). El invitado solo compra.
- **Cambios internos al módulo de correo (`mail`)** *(v1.5)*: el guest checkout **usa** el envío de correo
  existente (confirmación + enlace de seguimiento); rediseñar plantillas, proveedor o infraestructura de
  correo queda fuera de este alcance.
- **Historial/portafolio para invitados** *(v1.5)*: un invitado ve **un** pedido por su enlace; no hay
  "mis pedidos" sin cuenta ni consulta de pedidos por correo.
- ~~**Plan de pago de proveedor de precios** (~$9.99/mes): no se contrata en MVP~~ — **SUPERADO (v2.0,
  2026-08-23, confirmado por el humano)**: **PokemonPriceTracker YA está contratado** y su API key vive en el
  entorno de despliegue (Railway). El `PricingProvider` intercambiable sigue siendo el mecanismo para cambiar
  de proveedor sin tocar el resto del sistema. *(Lo que sí sigue fuera del MVP es el **ingest automático** de
  valores PSA: está en **fase 2** y bloqueado hasta confirmar el payload del proveedor en staging — ver §N.6.)*
- **Compra/buylist de sellado a clientes** *(v1.6)*: el sellado es **solo venta**; la plataforma **no**
  compra producto cerrado a clientes por la app (solo el call-out `mailto` para cotizar por fuera). Un
  buylist de sellado sería fase 2 si se decide.
- **Tendencia de valor del sellado y "avísame cuando vuelva" (restock) ACTIVOS** *(v1.6)*: quedan
  **cableados pero apagados** en el MVP (feature-flag off); encenderlos para el usuario final es posterior.
- **Fuente de mercado del sellado distinta de TCGCSV** *(v1.6)*: en el MVP la base del precio del sellado es
  **TCGCSV**; PriceCharting u otras fuentes son opción futura, no MVP.
- **Re-llavear la identidad de las cartas de sets multi-parte** *(v1.7, §L)*: **fuera de alcance**. La
  agrupación de master set es **solo presentación**; cada carta conserva su set-id de origen (`cel25` /
  `cel25c`). No se fusionan set-ids, no se reasignan cartas a un set "sintético", no se re-importa el catálogo
  y **no se mueven precio, inventario ni bóveda** a otra llave. Cualquier consolidación de identidad a nivel de
  dato (un solo set-id real para las 50) sería un cambio de modelo posterior, no este MVP.
- **Auto-detección de pares padre→subset** *(v1.7, §L)*: en el MVP el mapa padre→subset es **curado/explícito**
  (se declara y se extiende a mano). Inferir automáticamente qué set-ids son subset de cuál (por naming, fecha
  o heurística) queda fuera de alcance.
- **Vender el servicio de gradeo** *(v2.0, §N)*: **no** ofrecemos, cobramos ni intermediamos el gradeo de
  cartas; **no** recibimos cartas para mandarlas a PSA, **no** hay "manda tu carta a gradear con nosotros", ni
  ahora ni como upsell del checkout. El gancho **solo informa** un valor estimado.
- **Garantizar el grado** *(v2.0, §N)*: la plataforma **no promete** que una carta obtenga PSA 10, PSA 9 ni
  ningún grado, y **no** ofrece compensación, recompra ni devolución si el grado obtenido resulta menor al
  estimado mostrado. El estimado **no crea ningún derecho** para el comprador (ver disclaimer, N.5).
- **Integración con PSA (o cualquier graduadora) para enviar/verificar cartas** *(v2.0, §N)*: sin API de
  submission, sin seguimiento de envíos a la graduadora, sin verificación automática de `certNumber`. El slab
  se sigue verificando **a mano** en la web de la graduadora (§H).
- **PriceCharting como fuente del estimado por grado** *(v2.0, §N)*: **sigue fuera del MVP** (sin cambio
  respecto al punto de PriceCharting de arriba). La fuente del estimado es **PokemonPriceTracker** + **override
  manual del admin**.
- **Otras graduadoras y otros grados** *(v2.0, §N)*: el MVP cubre **solo PSA 10 y PSA 9**. **CGC / BGS / TAG**
  y los grados **PSA 8 o menores** quedan fuera; añadirlos es fase 2.
- **Estimado por grado en gradeadas y en sellado** *(v2.0, §N)*: el gancho es **solo para raw**. Una carta ya
  gradeada tiene grado real (el slab) y el sellado no se gradea.
- **Usar el estimado por grado como dinero real** *(v2.0, §N)*: el estimado **nunca** alimenta el precio de
  venta, la valuación/tendencia del portafolio, la cotización de buylist, el costo de inventario ni el P&L de
  M7. Es exclusivamente presentación.
- **Historial / gráfica de tendencia del valor gradeado** *(v2.0, §N)*: en el MVP se muestra el **estimado del
  día**, no una serie histórica del precio PSA 10/9. Es fase 2 si se decide.
- **Calculadora interactiva de ROI de gradeo** *(v2.0, §N)*: el comprador **no** ajusta parámetros (costo de
  gradeo, grado objetivo, cantidad) desde la tienda. Los diales son **del admin** y el cálculo es
  **server-side**; una calculadora para el cliente sería fase 2.

## Restricciones y preferencias técnicas
> Registradas como datos/preferencias del humano; el stack y la arquitectura los decide el arquitecto.
- **Pagos**: **Stripe**; **sin balance/saldo** de dinero en la plataforma (liquidación por transacción).
- **Impuestos**: precios mostrados **sin IVA**; **IVA 16%** se desglosa como **línea aparte en checkout** y
  se incluye en el total. **Facturación CFDI manual por correo** en el MVP (sin PAC): el cliente solicita
  factura enviando sus datos fiscales; el IVA cobrado se guarda para M7.
- **Precio de venta vs valor de mercado**: el **valor de referencia/mercado** (mostrado y usado para valuar
  portafolio) es la referencia del día; el **precio de venta** que se cobra es **referencia + markup
  configurable** (dial en M10).
- **Fuentes de precio (MVP = 100% free tier)**, tras un **`PricingProvider` intercambiable**:
  | Tipo de producto | Fuente primaria | Respaldo |
  |---|---|---|
  | raw / singles | TCGPlayer "Market Price" vía **pokemontcg.io** | override manual del admin |
  | gradeadas (PSA/CGC) | **PokemonPriceTracker** (free 100/día) o **PokeTrace** (free 250/día) | override manual del admin |
  | sellado *(actualizado v1.6, §K)* | **precio DERIVADO de TCGCSV** (mercado × spread por presentación) vía mapeo curado | **override manual del admin** (máxima precedencia); sin spread aplicable ⇒ **PRICE_PENDING** (no se publica) |
  - Solo se prician las cartas **en bóveda** (no el catálogo completo) + **cache diario**, para que el free
    tier alcance. **PriceCharting no se usa en el MVP.** **TCGCSV es fuente de precio SOLO del sellado**; para
    raw/singles no cambia nada (sigue pokemontcg.io/TCGPlayer).
- **Fuente del valor estimado por grado (§N, v2.0) — MANUAL-FIRST**: en **fase 1** el estimado **PSA 10 /
  PSA 9** lo **fija a mano el admin** con el **override manual de precio que ya existe**
  (`POST /admin/pricing/override`); el humano **cura sus cartas gancho**. En **fase 2** (posterior,
  **bloqueada**) se alimentará automáticamente desde **PokemonPriceTracker** —proveedor **ya contratado**, API
  key en el **entorno de despliegue (Railway)**, no en el repositorio—, **condicionado a confirmar el formato
  real del payload mediante observación del operador en staging** (la documentación del proveedor se
  contradice, el dato exige un parámetro que duplica el consumo de créditos y no se sabe si viene en el
  barrido por set o requiere una petición por carta). El **override manual conserva la máxima precedencia** en
  ambas fases y **el comportamiento visible al usuario es idéntico**. **PriceCharting sigue fuera del MVP.**
  El estimado es **presentación**: no alimenta precio de venta, portafolio, buylist ni P&L.
- **Diales del gancho de grading (§N, v2.0)**: **`gradingCostTiers`** —**tabla de escalones** rango de valor
  declarado → costo de gradeo en MXN, imitando el cobro por nivel de servicio de PSA e **incluyendo envío
  internacional y retorno a México** (defaults en N.2.1, **SUPUESTO revisable**)— y **`minUpsidePct`** (default
  **30%**). Ambos **editables sin deploy** y **auditados**. *(SUPUESTO: viven en **M10 (Config y bitácora)**
  con el resto de diales; alternativa razonable es M2 por ser pricing. Confirmar; ver preguntas abiertas
  v2.0.)* *(Nota para el arquitecto: ya existe un patrón de tabla de escalones configurable —tiers de rareza,
  `GET/PUT /admin/pricing/tiers`, §4.33— que conviene reusar.)*
- **Valuación de portafolio del usuario**: base en las fuentes anteriores, en **MXN**, **refresco diario**.
- **Alcance geográfico**: **solo nacional (todo México)** en el MVP; internacional es fase 2.
- **Plataforma bilingüe ES/EN (i18n)**: toda la **UI/plataforma** (todos los textos de la aplicación) debe
  estar disponible en **español e inglés**, con **default español** y toggle a inglés.
- **Datos del catálogo en inglés**: esto aplica **solo a los datos de las cartas** (nombres y sets vienen en
  inglés desde pokemontcg.io y **no se traducen**). No contradice el punto anterior: la **UI sí es bilingüe**,
  los **datos del catálogo** permanecen en inglés.
- **Panel de administración responsive**, operable desde móvil, **sin captura de fotos** (el producto no
  lleva fotos propias).
- **Sin fotos propias / imagen de catálogo remota**: no se guardan imágenes de producto; la ficha usa la
  **imagen de catálogo de pokemontcg.io** (URL remota). No hay subida de archivos de producto ni de evidencia
  de disputa. **Object storage / bucket (p. ej. R2): DENTRO del MVP pero acotado SOLO al INE del buylist**
  (`kyc_ine`, imagen cifrada con retención; ver punto de KYC). La **CLABE** del buylist **no depende de object
  storage** por ser un **número cifrado en BD**, no un archivo.
- **Gradeadas (PSA/CGC)**: se persiste **empresa + grado + `certNumber`**; el slab (verificable en la
  graduadora) es la garantía de condición, sin foto propia.
- **KYC del buylist — INE almacenado (soporte AML)**: el **INE se pide en el paso de pago del buylist** (sobre
  el tope) y su **imagen se almacena cifrada en R2 con retención** (`INE_RETENTION_DAYS`, default **180**),
  **verificada contra el nombre de la CLABE**. La **CLABE sigue guardándose cifrada en la base de datos** (sin
  cambio). Ver bandera AML en "Riesgos y banderas para el humano".
- **Política de reembolsos — VENTAS FINALES**: no hay reembolso voluntario tras la compra (en bóveda o
  enviada); aplica a **todos los tipos de producto sin excepción** (raw, sellado y gradeadas). **Dos
  excepciones**: (1) **disputa de condición** por carta **dañada/equivocada** (ventana de **7 días contados
  desde la entrega del envío** —paquetería marca "entregado"—, **evidencia por correo a soporte**; resolución
  por **grado/cert** en gradeadas o **estándar NM** en raw) → el súper-admin **recompra al precio pagado** y
  el **cliente conserva la carta** (sin devolución); (2) **error
  de la plataforma** (**cobro duplicado** o **inventario fantasma**) → **siempre se reembolsa**, sin ventana
  de 7 días ni evidencia de disputa, porque es corrección de un error propio y no arrepentimiento del
  comprador. Un
  **contracargo bancario** es un proceso independiente que el cliente inicia con su banco. El **checkout debe
  mostrar el aviso** y debe existir una **página de términos/políticas** con el texto completo.
- **Correo de evidencia / soporte de disputas**: la evidencia de una disputa de condición se envía por
  **correo a un buzón de soporte** (no hay subida de foto en la app). Correo de contacto:
  **soporte@tcgvault.mx** *(Confirmado por el PO, ago-2026: disputas sigue en `soporte@tcgvault.mx` (dominio
  `tcgvault.mx`); es un dominio distinto del `contacto@tcgvaultmx.com` del call-out de reventa y ambos son
  correctos)*. Debe aparecer en términos/FAQ
  y en el flujo de disputa.
- **Pago de buylist**: solo **SPEI** a cuenta a nombre del propio usuario (sin otros métodos). La **CLABE**
  se guarda **cifrada en BD**; el **INE se almacena cifrado en R2 con retención** (`INE_RETENTION_DAYS`,
  default 180) y se **verifica contra el nombre de la CLABE**.
- **Condición del raw — solo Near Mint (NM)**: el raw se opera **únicamente en NM** en todo el marketplace
  (se eliminan LP/MP/HP/DMG). NM se presenta como **"Casi nueva (Near Mint)"** con descripción del estándar
  propio; gradeadas y sellado no cambian.
- **Autenticación**: registro/login por **email/contraseña** (actual) **o inicio de sesión con Google**
  (OAuth) como alternativa; ambos disponibles.
- **Sync de catálogo**: se puebla desde la fuente de referencia (pokemontcg.io) trayendo por defecto **sets
  de 2024 en adelante**, con **backfill** de colecciones anteriores por **lotes automatizados** + importación
  puntual. Debe capturar **rarezas modernas** y el **año de lanzamiento del set** para los filtros de Compra.
- **Sección de compra = "Compra"** (antes "Catálogo"): muestra el **inventario propio publicado** a la venta;
  solo se lista lo que tiene **precio de venta fijado** (nunca "precio pendiente" al comprador).
- **Precio del sellado** *(actualizado v1.6, §K)*: **DERIVADO del precio de mercado de TCGCSV** por spread,
  con precedencia `override manual > mercado × spread por presentación > mercado × spread global >
  PRICE_PENDING`. Spreads configurables (ConfigSetting, M10): box 18% / etb 22% / bundle 25% / tin 30% /
  blister 35% / global 25%. **Solo venta (sin buylist de sellado)**; **condición propia** (default Mint /
  "Detalle menor en caja") **sin efecto en el precio**. *(Supersede "sellado = precio manual" y "TCGCSV solo
  informativa" — decisión del PO, ago-2026.)*
- **Branch de trabajo**: `claude/tcg-cards-marketplace-oijthj`.
- Stack, base de datos y despliegue: **a decisión del arquitecto** (nada predefinido por el humano).

## Criterios de aceptación
> QA usa esto como checklist. Cada criterio debe ser verificable.

**Catálogo y precio**
1. En la sección **Compra**, un visitante navega **nuestro inventario publicado a la venta** y filtra por
   **set con año de lanzamiento** (ej. "Surging Sparks (2024)"), **rareza** (incluidas rarezas modernas:
   Art/Illustration Rare, Special Illustration Rare, Full Art, Alternate Art, Trainer Gallery, Character
   Rare, Radiant, etc.), **tipo de producto** (raw, gradeadas, sellado) y **condición**.
1b. En **Compra** solo aparece inventario con **precio de venta fijado**; **nunca** se muestra "precio
   pendiente" al comprador (ese estado vive solo en adquisición/buylist/back-office).
2. Una ficha muestra el precio de referencia en MXN (sin IVA) según la fuente que corresponde a
   su tipo de producto —pokemontcg.io para raw/singles; PokemonPriceTracker/PokeTrace para gradeadas (con
   override manual como respaldo); el **sellado** lleva **precio de venta DERIVADO de TCGCSV por spread**
   *(actualizado v1.6)* con la precedencia `override manual > mercado × spread por presentación > mercado ×
   spread global > PRICE_PENDING`—, con fecha del último refresco; el refresco (cache diario) ocurre al menos
   una vez al día y solo cubre las cartas/ítems en bóveda.
2b. La ficha de Compra muestra la **imagen de catálogo de pokemontcg.io** (remota) y **no muestra fotos
   propias** de la carta; no existe subida de imágenes de producto en ningún flujo del MVP.
2c. Una carta **gradeada (PSA/CGC)** muestra **empresa + grado + número de certificado** (verificable en la
   web de la graduadora); el alta de inventario **captura y persiste `certNumber`** y la condición de la
   gradeada no depende de foto.
3. Una carta sin precio en la web de referencia queda en estado **"precio pendiente"** en
   adquisición/buylist/back-office y **NO se publica en Compra** (el comprador no la ve) hasta que el dueño
   le fija precio a mano; entonces puede publicarse a la venta.
3b. La ficha/catálogo distingue el **valor de referencia/mercado** del **precio de venta**; el precio de
   venta cobrado equivale a **referencia + markup** con el markup tomado del dial de M10, mientras el valor
   mostrado como "de mercado" y el usado para valuar portafolio siguen siendo la referencia.
3c. El **raw se opera únicamente en Near Mint (NM)** en toda la plataforma (Compra, inventario, buylist,
   filtros); **no existen** grados LP/MP/HP/DMG. La condición NM se presenta como **"Casi nueva (Near
   Mint)"** con la descripción del estándar propio ("Como nueva; a lo mucho imperfecciones mínimas. Bordes
   limpios y superficie sin rayones notorios."), y su versión en inglés espeja el texto. Gradeadas y sellado
   no cambian.
3d. El **cotizador de buylist, la guía de envío y los términos** muestran la política **"Solo compramos en
   NM"**; una carta recibida que **no es NM** se **rechaza (no se paga)** y se devuelve según plazos (7 días,
   **a costo del usuario**; abandono a 30 días), y una carta **abandonada no-NM NO entra al inventario
   vendible**.
3e. El **producto sellado** (booster box, ETB, bundle, tin, blister…) se vende en Compra con **precio de venta
   DERIVADO de TCGCSV por spread** *(actualizado v1.6, ver §K y criterios 57–64)*: la precedencia es `override
   manual > mercado × spread por presentación > mercado × spread global > PRICE_PENDING`, y un ítem en
   **PRICE_PENDING** (sin override y sin spread aplicable) **no se publica**. El sellado es **solo venta (sin
   buylist)**, **no lleva rareza**, y **sí lleva condición propia** (default Mint / "Detalle menor en caja",
   visible y sin efecto en el precio).

**Compra y bóveda**
4. Un comprador puede pagar con Stripe; el checkout muestra una **línea explícita de costo de
   procesamiento trasladado** y una **línea explícita de IVA 16%** (además del subtotal), y el total
   cobrado incluye ambas.
5. Tras un pago exitoso, la carta aparece en la bóveda del comprador con titularidad `pending` y
   cambia a `settled` cuando el pago se liquida.
6. Un usuario NO tiene saldo/wallet en ninguna vista; todo se maneja por transacción.
7. Un contracargo mueve la carta afectada de la bóveda del usuario de vuelta al inventario de la
   plataforma y la orden queda en estado `contracargo`.
7b. El **checkout muestra el aviso de "ventas finales, sin reembolso salvo carta dañada/equivocada o error
   de la plataforma"** (con enlace a los términos), y **existe una página de términos/políticas** que
   describe la política completa: ventas finales aplicables a todos los tipos de producto (raw, sellado y
   gradeadas), la excepción de disputa de condición (ventana de 7 días contados desde la entrega del envío,
   recompra al precio pagado con el cliente conservando la carta), la excepción de error de la plataforma
   (cobro duplicado / inventario fantasma se reembolsan siempre) y la aclaración de que el contracargo
   bancario es un proceso independiente ante el banco del cliente.
7c. Un **cobro duplicado** o una **compra sin inventario real** (inventario fantasma) **se reembolsa**: el
   súper-admin puede ejecutar el reembolso en M3 sin depender de la ventana de 7 días ni de la evidencia de
   disputa, y la orden queda en estado `reembolsada`.

**Portafolio**
8. "Mi bóveda" lista las cartas del usuario y muestra un **valor total de portafolio** en MXN,
   consistente con el precio de referencia diario; las cartas "precio pendiente" se identifican y no
   rompen el cálculo (se excluyen o marcan claramente).
8b. "Mi bóveda" muestra una **gráfica de tendencia del valor del portafolio** estilo acciones, con rangos
   seleccionables **5d / 15d / 1m / 3m / 6m / 1a / YTD / Máx**, que indica si el portafolio **crece o
   decrece** en el periodo (alimentada por un snapshot diario del backend).

**Retiro / envío**
9. Un usuario puede solicitar el retiro de 1 o más cartas `settled` sin mínimo de cantidad, **a cualquier
   dirección nacional (México)**; el sistema cobra una **tarifa fija de envío** (default **MX$175**,
   tomada de M10) al comprador antes de generar la solicitud.
10. Una carta `pending` NO puede incluirse en una solicitud de retiro.
11. El admin/operador puede capturar un número de guía y la solicitud avanza por los estados
    `solicitado → picking → guía → enviado → entregado`.

**Buylist**
12. El cotizador público devuelve la cotización según la **tabla de precio por rareza** (§E.1): aplica la
    **regla configurada por rareza** —**fijo (MX$)** o **porcentaje (% de la referencia)**— y con el **seed
    por defecto** reproduce el comportamiento actual: **Common = MX$0.50 (fijo)**, **Reverse Holo = MX$1.50
    (fijo)**, **EX o superior = 40% de la referencia (porcentaje)**.
12b. El **súper-admin edita en M2** la regla y el valor de **cada rareza** (fijo/% + monto) y el cambio
    **surte efecto sin redeploy** y queda **auditado** en la bitácora (M10); una rareza con regla **fijo** cotiza
    **sin** necesidad de referencia, y una con regla **porcentaje** cotiza como % de la referencia del día.
12c. La lista de rarezas configurables se **deriva del catálogo sincronizado** (rarezas distintas en `Card`);
    una **rareza no listada** aplica la **regla de fallback configurable** (default % de la referencia) y **no
    bloquea** la cotización *(sujeto a confirmación del humano — ver preguntas abiertas)*.
13. Una carta de buylist con regla de **porcentaje** pero **sin precio de referencia** entra a la **cola de
    precio pendiente** y no se cotiza automáticamente hasta que el dueño fija su precio (las de regla **fijo**
    siempre cotizan).
14. El sistema bloquea solicitudes que excedan el **tope por solicitud** (default MX$3,000) o el **tope
    mensual** (default MX$10,000) del usuario, exige **INE** cuando se supera el tope configurado, y solo
    permite registrar pago SPEI a una CLABE a nombre del propio usuario. El **INE se pide en el paso de pago
    del buylist** (sobre el tope), su **imagen se almacena cifrada en R2 con retención** (`INE_RETENTION_DAYS`,
    default 180) y se **verifica contra el nombre de la CLABE**; la **CLABE se guarda cifrada en BD**.
15. En el pipeline de buylist el dueño puede **aceptar carta por carta** (cherry-pick), ajustar o
    rechazar, y una carta aprobada se **convierte a inventario en un clic**.
16. Una solicitud de buylist sin respuesta del usuario a un ajuste (o una **carta rechazada por no ser NM**)
    da al usuario **7 días** para gestionar la devolución **a su costo**; **a los 30 días** se considera
    abandonada. Una carta **NM** abandonada **pasa a inventario**; una carta **no-NM** abandonada **NO entra
    al inventario vendible**.

**Back-office (M1–M10) y roles**
17. En M1, cada item físico tiene **folio legible** (ej. `INV-000123`), **ubicación CAJA/FILA/SLOT** y un
    **historial de movimientos**; se puede marcar pérdida/daño. El alta es **sin foto propia** (usa la
    imagen de catálogo de pokemontcg.io) y, para **gradeadas**, captura **empresa + grado + `certNumber`**.
18. En M2 se puede sincronizar precios de las cartas en bóveda desde la fuente que corresponde a cada tipo
    (pokemontcg.io para raw/singles; PokemonPriceTracker/PokeTrace para gradeadas; el **sellado** se pricia
    **derivado de TCGCSV por spread** *(actualizado v1.6)*), hacer **override manual** siempre (máxima
    precedencia), **editar los spreads del sellado por presentación** (box/etb/bundle/tin/blister + global),
    y configurar el **tipo de cambio USD→MXN con colchón**, el **editor de precio de buylist por rareza**
    (regla fijo/% + valor, ver §E.1) y el **`PricingProvider`** por tipo de producto.
19. En M3 una orden refleja los estados `pending/settled/fallida/reembolsada/contracargo` con desglose
    que incluye la **línea de Stripe**, y el súper-admin puede emitir un **reembolso**.
20. En M4 existe una **lista de picking ordenada por ubicación**.
21. En M7 el P&L calcula **ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia**, muestra
    **valor de inventario (a referencia y a costo)**, **valor en custodia de clientes** y el **IVA cobrado**
    (para conciliación/CFDI), con **export CSV**.
22. En M8, ante una disputa de condición (carta dañada/equivocada, dentro de la ventana de **7 días contados
    desde la entrega del envío** —cuando paquetería marca "entregado"—), la **evidencia se recibe por correo
    a soporte** (no hay subida de foto en la app); la resolución se apoya en el **grado/número de certificado**
    (gradeadas) o el **estándar NM** (raw). El admin puede ejecutar la **recompra al precio pagado** como
    remedio; la ejecución **no exige devolución de la carta** (el cliente la conserva) y solo la realiza el
    súper-admin.
23. En M10 existe una **bitácora de auditoría global** (quién/qué/cuándo) y los **diales/config se editan
    sin necesidad de redeploy**.
24. El **dashboard** muestra las ~8 tarjetas definidas (ganancia del periodo, ventas, cola de trabajo,
    valor de inventario, valor en custodia, buylist del periodo, salud de datos, progreso de lanzamiento).
25. Un **operador de bóveda** puede operar M1, M4 y M5 hasta verificación, pero **no** puede acceder a
    finanzas (M7), configuración (M10) ni ejecutar pagos/reembolsos; el intento queda registrado y bloqueado.
26. **Ninguna** acción de dinero saliente (pago SPEI de buylist, reembolso) puede ejecutarla otro rol que
    no sea el **súper-admin**.
27. El panel de administración es **responsive** y operable desde un dispositivo móvil en el flujo de
    ingreso/verificación de bóveda; **no hay captura ni subida de fotos** (el producto no lleva fotos propias:
    se identifica por catálogo y, en gradeadas, por `certNumber`).

**Inventario inicial**
28. El alta de una carta propia calcula su costo como **precio de referencia del día × % configurable**
    (default **70%**), el % es editable, y el registro queda marcado como **"aportación en especie"**.

**Transversal — valuación**
29. En cualquier módulo (buylist, inventario, portafolio), una carta sin precio en la web nunca se
    descarta: se marca "precio pendiente" y se **escala al dueño** para fijarlo a mano.
30. El checkout (y/o FAQ/términos) muestra el mensaje **"para factura, enviar correo con datos fiscales"**,
    el **IVA 16% sigue desglosado** en el checkout, y el IVA cobrado queda disponible en M7 para
    conciliación (sin timbrado automático con PAC en el MVP).
31. La aplicación **rechaza direcciones de envío/retiro fuera de México** (solo nacional en el MVP).

**Idioma / i18n**
32. El usuario puede **cambiar el idioma de la interfaz entre español e inglés** (default español) y
    **todos los textos de la aplicación** se muestran en el idioma elegido (los datos del catálogo
    permanecen en inglés por diseño).

**Buylist — messaging y guía**
33. El cotizador/solicitud de buylist muestra claramente el mensaje de que el **pago ocurre tras la
    recepción y verificación** de la carta (no por adelantado).
34. Existe una **guía de empaque/envío seguro** accesible desde el flujo de buylist que menciona
    explícitamente **sleeve** y **top loader**, e incluye la **política NM-only** (solo compramos Near Mint).

**Autenticación**
35. El usuario puede **registrarse/iniciar sesión con email/contraseña** o **con Google** (ambas opciones
    disponibles).

**Catálogo — población y sincronización**
36. El sistema **puebla el catálogo desde la fuente de referencia** trayendo por defecto **sets de 2024 en
    adelante**, y permite **backfill** de colecciones anteriores mediante **lotes automatizados** e
    **importación puntual** de sets específicos; los sets importados traen **rareza (incl. modernas)** y
    **año de lanzamiento** para los filtros de Compra.

**Acabado / versión de carta (v1.4)**
37. El **sync de catálogo conserva los acabados por carta y su precio de mercado por acabado** desde
    `tcgplayer.prices` (`normal`, `holofoil`, `reverseHolofoil`, `1stEdition*`); estos precios **ya no se
    descartan**. Los **acabados disponibles de una carta** se derivan de las llaves presentes en esa carta.
38. En el **cotizador de buylist**, al elegir una carta el vendedor **ve los acabados disponibles** de esa
    carta y **captura cuál vende**; la cotización se calcula **por acabado**: el acabado determina la **regla
    de rareza** (reverse holo → "Reverse Holo"; holo → "Holo"/base; normal → rareza base) y, para reglas de
    **porcentaje**, se aplica sobre el **precio de mercado de ese acabado**. El **monto se deriva server-side**
    (SEC-A1) y el backend valida que el acabado sea uno de los disponibles de la carta.
39. En **M1**, el alta de inventario se hace **contra el catálogo real sincronizado** (elegir set → buscar
    carta real → elegir carta → **elegir acabado**), **no** contra cartas mock; el item queda ligado a la carta
    de catálogo y a un **acabado** concreto.
40. Cada `InventoryItem` registra un **origen** capturado al alta: **`owner_contribution`** (costo = referencia
    × %, default 70%) o **`client_purchase`** (costo = lo pagado en buylist). La **conversión de buylist a
    inventario** marca el origen como `client_purchase` con el costo pagado, y el origen se refleja en el
    **costo/P&L de M7**.
41. La **ficha de Compra y "Mi bóveda"** muestran el **acabado/versión** del item y valúan con el **precio de
    mercado del acabado específico** (no un precio único por carta); "Mi bóveda" permite **ordenar por set y por
    valor**. El **filtro de Compra** incluye **acabado** (Normal, Reverse Holo, Holofoil, 1st Edition).
42. Toda carta/ítem **sin acabado explícito** (filas históricas) se trata como **`normal`** (default), sin
    romper valuación ni listados.
43. Una carta de buylist con regla de **porcentaje** cuyo **acabado seleccionado no tiene precio de referencia**
    entra a la **cola de "precio pendiente"** (igual que hoy); las de regla **fijo** siempre cotizan.
44. El **precio y el monto por acabado nunca se toman del DTO del cliente**: se **derivan siempre server-side**
    a partir del acabado validado, la rareza real y la regla configurada (no se debilita la protección
    anti-manipulación existente, SEC-A1).

**Guest checkout — comprar sin cuenta (v1.5)**
45. Un visitante **sin sesión** completa una compra de punta a punta (carrito → checkout de invitado → pago
    Stripe exitoso → confirmación con número de pedido) **sin crear cuenta**, y al terminar **no existe
    ninguna cuenta nueva** ni sesión iniciada. La orden queda registrada como **pedido de invitado** con su
    correo y su dirección de envío.
46. El checkout ofrece las tres vías —**continuar como invitado**, **iniciar sesión**, **crear cuenta**— y
    **cambiar entre ellas no vacía el carrito** ni pierde los datos ya capturados.
47. El correo es **obligatorio y validado**: un correo con **formato inválido** (o vacío) **impide avanzar
    al pago** con un mensaje claro; el correo capturado es exactamente el que recibe la confirmación y el
    enlace de seguimiento.
48. Un invitado **solo puede elegir envío directo a domicilio nacional**: la opción **"guardar en bóveda"
    no completa la compra sin cuenta**, y al intentarla se muestra un **upsell** (mensaje de beneficio +
    "crear cuenta") **y nunca un error**. Desde ese upsell el invitado **crea cuenta sin salir del
    checkout**, **conserva el carrito**, y tras registrarse el destino **bóveda queda disponible** y el
    flujo continúa; si descarta el upsell, sigue con envío directo.
48b. El checkout de invitado muestra **el mismo desglose y los mismos avisos** que el de un usuario con
    cuenta: subtotal sin IVA, **costo de procesamiento**, **IVA 16%**, **envío fijo (default MX$175)**,
    aviso de **ventas finales** con enlace a términos y mensaje de **factura CFDI manual por correo**; el
    precio de venta cobrado es el mismo (referencia + markup) que para un usuario registrado. Una dirección
    **fuera de México** se rechaza (criterio 31).
49. Tras el pago exitoso el invitado **recibe en su correo** un mensaje de confirmación con el **resumen del
    pedido**, el **número de pedido** y un **enlace de seguimiento** con token; la **pantalla de
    confirmación** muestra el número de pedido y la **oferta de crear cuenta con ese mismo correo**.
50. Abriendo el **enlace de seguimiento** (sin iniciar sesión) el invitado ve el **estado del pedido**
    (`pagado → preparando → guía → enviado → entregado`), los artículos y el total pagado; cuando el
    admin/operador **captura la guía**, al reabrir **el mismo enlace** aparece el **número de guía** y el
    estado actualizado.
51. La vista pública de seguimiento es de **datos mínimos**: **no** muestra la dirección completa (a lo mucho
    ciudad/estado y CP parcial), **no** muestra datos de pago más allá de la **terminación de tarjeta**,
    **no** muestra el correo completo ni el teléfono, y **no ofrece ninguna acción sensible** (cambiar
    dirección, cancelar, reembolsar, ver otros pedidos).
52. **Un token da acceso a un solo pedido**: un token **manipulado, inventado o de otro pedido** **no**
    concede acceso (respuesta neutra, sin filtrar si el pedido existe), y **no existe** ninguna pantalla ni
    endpoint público que permita **listar o buscar pedidos** por número de pedido, por correo o por
    iteración de identificadores.
53. Un **token expirado** muestra un mensaje neutro y ofrece **reenviar un enlace nuevo al correo del
    pedido**; el reenvío responde **lo mismo exista o no el pedido/correo** y está **limitado por
    frecuencia** (intentos repetidos se bloquean/atenúan), de modo que no funcione como oráculo para saber
    si un correo compró en la plataforma.
54. **Reclamo post-compra**: si el invitado **crea cuenta con el mismo correo** de su pedido, ese pedido
    **aparece en su historial** con su estado y seguimiento dentro de la sesión, **sin cambiar** destino,
    precio ni políticas del pedido. Funciona también con el pedido **ya enviado/entregado**.
55. Un pedido **solo puede reclamarse una vez**: un pedido ya vinculado a una cuenta **no** puede vincularse
    a una segunda cuenta, y el intento se rechaza (y queda registrado).
56. Si el correo del invitado **ya tiene cuenta**, el checkout **no revela** que ese correo está registrado
    y **permite completar la compra como invitado**; el pedido **no se agrega en silencio** al historial de
    esa cuenta: requiere el **reclamo explícito** del titular tras iniciar sesión *(sujeto a confirmación
    del humano — ver preguntas abiertas v1.5)*.
56b. Un invitado puede abrir una **disputa de condición** o reportar un **error de plataforma** con las
    **mismas reglas** que un usuario con cuenta (ventana de **7 días desde la entrega**, evidencia **por
    correo a soporte** citando su **número de pedido**); no se le exige crear cuenta para ser atendido ni
    compensado.

**Sellado (producto cerrado) — v1.6**
57. El **precio de venta del sellado** se **deriva de TCGCSV** con la precedencia exacta: **(a)** si hay
    **override manual**, gana el override; **(b)** si no, **mercado × spread de la presentación**
    (box/etb/bundle/tin/blister); **(c)** si no hay spread por presentación, **mercado × spread global**;
    **(d)** si no hay ninguno, el ítem queda en **PRICE_PENDING**. El precio se calcula **server-side** (no
    se toma del cliente).
58. Un sellado en **PRICE_PENDING** (sin override y sin spread/mercado aplicable) **no aparece en Compra**;
    en cuanto adquiere precio (override o spread × mercado) puede publicarse.
59. El cambio de **base de precio a TCGCSV aplica SOLO al sellado**: el precio de un **raw/single** o de una
    **gradeada** **no** cambia por esto (siguen sus fuentes actuales), verificable comparando que la fuente
    de precio de una carta suelta sigue siendo pokemontcg.io/TCGPlayer y no TCGCSV.
60. El **súper-admin edita en M2** los **spreads del sellado por presentación** (semillas box 18% / etb 22%
    / bundle 25% / tin 30% / blister 35% / global 25%); el cambio **surte efecto sin redeploy**, queda
    **auditado** (M10) y **recalcula** el precio derivado de los sellados afectados (salvo los que tengan
    override).
61. El **sellado es solo venta**: **no existe** flujo de **buylist de sellado** (ni cotizador ni pipeline);
    la **ficha/ventana de sellado muestra el call-out `mailto`** para revender (a `contacto@tcgvaultmx.com`),
    que es un enlace de correo y **no** un flujo dentro de la app.
62. Un sellado tiene **condición propia** (default **Mint**, opción **"Detalle menor en caja"**) **visible
    al comprador** en ficha y bóveda; cambiar la condición **no cambia el precio**. El sellado **no expone
    rareza**.
63. Al comprar un sellado, el comprador con cuenta puede elegir **recibir** (envío directo) o **dejar en
    bóveda**; la **bóveda del cliente y la vista admin muestran una pestaña "Sellado"**, y el sellado en
    bóveda **suma al valor total del portafolio y a su gráfica de tendencia** (§C).
64. La **tendencia de valor del sellado** y el **"avísame cuando vuelva" (restock)** están **cableados pero
    apagados** (feature-flag off): **no** son accesibles para el usuario final en el MVP, y **activarlos no
    requiere nuevo desarrollo** (solo encender el flag).

**Sets multi-parte / Master Set combinado — v1.7 (P-27)**
65. **Celebrations se muestra como un solo master set de 50 cartas** en un **único binder**: las 25 de `cel25`
    (principal) y las 25 de `cel25c` (Classic Collection) aparecen juntas; no hay dos sets separados de 25.
66. Las cartas de la **Classic Collection** aparecen **agrupadas y etiquetadas** (p. ej. "Classic Collection")
    con un **separador/encabezado visual** dentro del binder; el master set conserva el **nombre del principal**
    ("Celebrations").
67. El conteo de **completitud del master set es sobre la suma de las partes**: "cubiertas / esperadas · %"
    muestra **esperadas = 50** para Celebrations (no 25), tanto en storefront como en el Master Set de M1.
68. **No destructivo, money-safe**: cada carta **conserva su set-id de origen** (`cel25` / `cel25c`); el
    **precio de referencia, el inventario y la bóveda de cualquier carta no cambian** por la agrupación —
    verificable comparando que el precio, el folio y la titularidad de una carta de `cel25c` son idénticos
    antes y después de activar el master set combinado. La agrupación **nunca** reescribe identidad ni valuación.
69. La relación padre→subset vive en un **mapa explícito y extensible**: agregar un nuevo par (p. ej. Shiny
    Vault de Shining Fates o Hidden Fates) **no requiere tocar código de presentación** ni re-importar el
    catálogo; basta declarar el par y las vistas lo agrupan.
70. **Caso borde — más de 2 partes**: un principal con **N subsets** se agrupa correctamente en un solo master
    set y su completitud suma **todas** las partes mapeadas.
71. **Caso borde — subset sin su principal**: si solo está importada una de las partes, la vista **no falla**:
    muestra la(s) parte(s) presente(s) sin romper el conteo *(comportamiento exacto sujeto a confirmación del
    humano — ver preguntas abiertas v1.7)*.
72. **Operación por set-id real intacta**: publicar, priciar, comprar/vender, retirar o mover al inventario una
    carta del subset sigue operando por su **set-id real** (`cel25c`) y **no depende** de la vista de master
    set; la agrupación es solo de presentación y nunca es la fuente de verdad del inventario o del precio.

**Pricing por tiers — v1.9 (P-34, LOCKED)**
73. El editor de precios de M2 gestiona **una regla por `tier`** (**5 tiers**: T0 Bulk, T1 Uncommon/Reverse, T2
    Rare/Holo, T3 Premium/Chase, T4 Ultra/Grail), no una por rareza: al abrir el editor tras un sync con ~30
    rarezas, el dueño configura **5 reglas** (una por tier) y **cada rareza hereda la regla de su tier**, sin
    tener que llenar 30 filas. El editor gestiona los tiers **tanto para compra (buylist) como para venta** (dos
    juegos de valores, un mismo mapa rareza→tier).
74. Existe un **mapa rareza canónica → tier** que cubre **todas** las rarezas canónicas del catálogo, **editable
    por el dueño** desde M2 (puede reasignar una rareza a otro tier). Cambiar la regla de un tier **repricia
    todas** las rarezas mapeadas a ese tier (verificable: subir el % del tier «Chase» cambia la cotización de
    todas sus rarezas a la vez).
75. **Refinamiento estricto de `premium` (money-safe)**: ninguna rareza `premium:true` del catálogo mapea a un
    tier de **bin fijo** (a partir de v1.9 solo **T0 y T1** son bin fijo; T2–T4 son `pct`); toda chase resuelve
    por un tier de **% de mercado** o por el fallback %. Verificable: una Illustration/Ultra/Double Rare (y las
    ex/V/GX) **nunca** cotiza a un bin fijo. El invariante se valida **aunque el dueño edite el mapa** (una
    reasignación que mandaría una rareza premium a T0/T1 es rechazada).
76. **Rarezas «SIN MAPEAR» cerradas (corrección de dinero)**: **Mega Hyper Rare** queda como **alias de Hyper
    Rare → T4**; **`MEGA_ATTACK_RARE`** y **Black White Rare** quedan como **nuevas canónicas premium → T3** (y
    cualquier otra `unmapped` detectada en el catálogo real se cierra con la misma política). En particular
    **`MEGA_ATTACK_RARE`** y **Black White Rare** —que hoy el patrón trata como no-premium— **dejan de cotizar
    al bin fijo de bulk** (fix de dinero verificable: antes bin fijo barato, después `pct` premium).
77. **Money-safe — `pct` sin referencia**: cualquier tier `pct` (T2, T3, T4) o el **fallback** sin precio de
    mercado del acabado deja la carta en **«precio pendiente»** y la escala al dueño — **nunca $0, nunca bin
    fijo**. Verificable en particular para **T2 (Rare/Holo)**: una Rare sin market price queda pendiente, no en
    $0. Una rareza **sin tier asignado** (nueva tras un sync) cotiza por el **tier por defecto = `pct` de
    fallback** con la misma regla.
78. **Comportamiento preservado salvo el cambio intencional de T2**: con el **seed por defecto**, la cotización
    de una carta de **T0/T1/T3/T4** es **idéntica** a la de antes de introducir tiers (bulk $0.50/$1.50 fijo,
    chase 40%); **T2 (Rare/Rare Holo) cambia a propósito** de bin fijo a **`pct` 25% del mercado** (verificable:
    una Rare/Rare Holo que antes cotizaba al bin fijo ahora cotiza al 25% de su referencia, y sin referencia cae
    en «precio pendiente»). La derivación del monto sigue siendo **server-side** desde la rareza real (SEC-A1),
    en compra y en venta.

**Valor estimado si se gradea — «gancho de grading» — v2.0**
> **Nota de verificación (v2.0)**: todos los criterios de este bloque **deben poder verificarse en FASE 1
> (manual-first)**, con los valores PSA fijados a mano por el admin (N.6). El ingest automático es fase 2 y
> **no cambia ninguno** de estos criterios.

> **Nota de verificación 2 (actualización 2026-08-23)**: el cálculo del gate **ya no se pinta**, así que estos
> criterios se verifican por **presencia/ausencia** (qué carta aparece en qué superficie), por **orden** (el de
> la vitrina) y por **inspección del payload** (que no viajen los insumos del cálculo) — **no** comparando
> cifras derivadas en pantalla.

79. **El gate decide QUÉ SE PROMOCIONA (curaduría), no qué se ve**: una carta raw publicada entra a **teja y
    vitrina** **si y solo si** `estimadoPSA9 ≥ (precioVentaRaw + gradingCost) × (1 + minUpsidePct)`, con
    `gradingCost` = **escalón** que corresponde a esa carta (criterio 92) y `minUpsidePct` default **30%**.
    Verificable con dos cartas límite: una que pasa **por poco** (**aparece** el badge / entra a la vitrina) y
    otra **justo por debajo** (**no aparece**). En **ambos casos la ficha muestra sus estimados**, porque la
    ficha **no depende del gate**. El **PSA 10 no interviene**: una carta con PSA 10 altísimo pero PSA 9 que no
    pasa el gate **no se promociona**.
80. **Sin estimado PSA 9 no se promociona, pero la ficha sí informa**: una carta con estimado **PSA 10** pero
    **sin** estimado **PSA 9** **no entra** a teja ni a vitrina; **su ficha sí muestra el PSA 10**. El sistema
    **no infiere ni interpola** el PSA 9 a partir del PSA 10.
81. **Ficha: solo precio + los dos estimados (verificación de AUSENCIA)**: la ficha de una carta raw con dato
    muestra **exactamente**: el **precio de venta de la carta**, el **estimado PSA 10**, el **estimado PSA 9**,
    la **fecha del último refresco**, el **micro-aviso** y la **llamada al pie** (criterio 85). Y **NO muestra**
    —en ninguna forma— **multiplicador**, **diferencia/ganancia**, **porcentaje de rendimiento**, **costo de
    gradeo**, **escalón aplicado** ni **comparativa**. Verificable buscando en la página renderizada la
    ausencia de esos elementos.
82. **Badge en las tejas de Compra**: una teja de carta que **pasa el gate** muestra el badge con el
    **estimado PSA 10** (más micro-aviso y llamada); una teja que **no pasa** se ve **exactamente igual que
    hoy** —**sin** badge vacío, tachado, en gris ni con placeholder—.
83. **Vitrina «Joyas para gradear»: contenido y ORDEN**: el home muestra una vitrina con cartas que **pasan el
    gate**, **publicadas y disponibles**, **ordenadas de mayor a menor ganancia neta sobre PSA 9**. Verificable
    con tres cartas de ganancia neta conocida y distinta: **aparecen en ese orden**. La **cifra que ordena no
    se muestra ni viaja al cliente** (criterio 89). Si **ninguna carta pasa el gate**, la **vitrina completa no
    se renderiza** (no aparece vacía, ni con placeholder, ni con «próximamente»).
84. **Money-safe — una cifra que no existe no se dibuja**: si falta un estimado, **esa cifra no aparece**; si
    falta el PSA 9, el precio o el escalón, la carta **no se promociona**. En **ninguna** superficie aparece
    **$0**, un **guion (`—`)**, un rango inventado ni el texto **«precio pendiente»**. Verificable inspeccionando
    el HTML entregado: **no hay contenedor vacío ni skeleton permanente**.
85. **Disclaimer — patrón de llamada + nota al pie, con micro-aviso adyacente**: verificable en las **tres**
    superficies (home, listado de Compra, ficha):
    (a) **toda cifra estimada** lleva una **llamada visible** (asterisco) y un **micro-aviso** junto a ella que
    carga las dos ideas obligatorias — **«ilustrativo»** y **«no evaluamos esta carta»**;
    (b) **toda página que muestre al menos una cifra estimada** contiene el **texto completo del disclaimer al
    pie**, y la llamada **lleva** a ese texto;
    (c) el **texto completo es el mismo** en todas las páginas (sin versiones recortadas) y afirma
    explícitamente los **seis** elementos: es **información ilustrativa**, **no evalúa la carta que vendemos**
    (no inspeccionada ni pre-evaluada), **no garantiza ningún grado** (lo determina PSA y puede ser mucho
    menor), **no es oferta/garantía de precio/recompra**, **no gradeamos ni intermediamos** (costo, envío y
    tiempos por cuenta del comprador) y los **precios cambian a diario**;
    (d) todo lo anterior existe en **ES y EN** y cambia con el toggle de idioma (criterio 32).
    **Una página con cifra estimada y sin nota al pie, o una cifra sin llamada/micro-aviso, es un defecto
    bloqueante.**
86. **Diales editables sin deploy y auditados**: el súper-admin edita la **tabla de escalones**
    (`gradingCostTiers`) y `minUpsidePct`; el cambio **surte efecto sin redeploy**, queda **auditado** en la
    bitácora (M10) y **recalcula qué se promociona** (verificable: subir `minUpsidePct` de 30% a un valor alto,
    o encarecer un escalón, **vacía la vitrina y quita los badges**, **sin tocar ningún precio de venta** y
    **sin alterar lo que muestran las fichas**).
87. **Solo raw**: una carta **gradeada (PSA/CGC)** y un **producto sellado** **nunca** muestran cifra estimada
    ni badge, y **nunca** entran a la vitrina, en ninguna superficie.
88. **Fase 1 manual-first**: la feature funciona **de punta a punta con valores PSA fijados a mano** por el
    admin (override manual existente): el admin fija PSA 10 / PSA 9 a una carta raw publicada, la **ficha los
    muestra**, y —**si pasa el gate**— la carta aparece además en **teja y vitrina**. Una carta **sin override**
    **no muestra cifra estimada** en ninguna superficie (caso normal en fase 1) y **jamás** se muestra una
    cifra inferida, aproximada, interpolada o de respaldo inventada. Cuando exista el **ingest automático**
    (fase 2), el **override manual conserva máxima precedencia** y **el comportamiento visible no cambia**.
89. **El cálculo NO se filtra al cliente (SEC-A1 reforzado)**: inspeccionando la **respuesta del servidor** que
    alimenta home, listado y ficha, **no aparecen** la **ganancia neta**, el **escalón / costo de gradeo**,
    `minUpsidePct`, ni un **flag de elegibilidad**: solo las **cifras que se pintan** (PSA 10 / PSA 9) y la
    **lista ya curada y ordenada**. En consecuencia, un **DTO manipulado** desde el cliente **no puede** meter
    una carta a la vitrina, **cambiar su posición** ni **alterar una cifra**.
90. **El estimado no contamina el dinero real**: activar o desactivar esta feature **no cambia** el **precio
    de venta** de ninguna carta, el **valor ni la tendencia del portafolio** (§C), la **cotización de buylist**
    (§E/§M), el **costo de inventario** ni el **P&L de M7** — verificable comparando esos valores con la
    feature encendida y apagada.
91. **Frescura del estimado**: un estimado con más de **30 días** sin refresco **deja de mostrarse** en las
    tres superficies (y la carta deja de promocionarse) *(umbral sujeto a confirmación del humano — ver
    preguntas abiertas v2.0)*.
92. **Costo de gradeo por ESCALONES (no plano)**: el `gradingCost` del gate se **resuelve por tabla de
    escalones** (`gradingCostTiers`, N.2.1) según el **valor de la carta**, imitando cómo cobra PSA por nivel
    de servicio. Como el costo **no se muestra**, se verifica por **efecto en la curaduría**:
    (a) **dos cartas de valor muy distinto resuelven escalones distintos** —con upside proporcional
    equivalente, la **barata entra** a la vitrina y la **cara no**, porque su escalón es mucho más caro—;
    (b) la tabla **cubre todo el rango sin huecos** y su **último escalón es abierto** («de X en adelante»),
    así que **ninguna carta, por cara que sea, se queda sin escalón**;
    (c) si el valor de la carta **no cae en ningún escalón** (tabla vacía o mal editada), la carta **no se
    promociona** y **no se asume costo $0** ni un default silencioso;
    (d) el costo del escalón **incluye envío internacional y retorno a México** además de la cuota de PSA —lo
    que se refleja en que los defaults **no son la cuota pelona de PSA**—;
    (e) el súper-admin puede **añadir/quitar/editar escalones** sin redeploy, con **auditoría** (M10) y
    **recálculo** de qué se promociona.

## Riesgos y banderas para el humano
> No bloquean el desarrollo técnico del MVP, pero deben resolverse antes de operar con público real.
- **Legal — custodia/depositario**: la bóveda implica guardar bienes de terceros. Validar con abogado la
  figura de **depositario**, el **contrato de custodia**, la responsabilidad por pérdida/daño y el **tope
  por carta**. Definir si hay **seguro formal** del inventario en custodia.
- **Fiscal — buylist**: comprar cartas a particulares y pagar por SPEI tiene implicaciones fiscales
  (comprobación, retenciones, límites). Validar con contador; los topes por solicitud/mes y el requisito
  de INE son mitigaciones iniciales, no una postura fiscal completa.
- **AML / KYC — INE almacenado (soporte AML)**: el **INE se almacena como imagen cifrada en R2 con retención**
  (`INE_RETENTION_DAYS`, default 180), pedido en el paso de pago del buylist sobre el tope y verificado contra
  el nombre de la CLABE. Esto da **soporte documental / control AML** para el pago SPEI a particulares.
  **Validar con contador/abogado** el **periodo de retención** adecuado, la **base legal de tratamiento** del
  documento de identidad y las **obligaciones de protección de datos personales** (guarda, acceso y borrado al
  vencer la retención). La **CLABE se sigue guardando cifrada en BD** (sin cambio).
- **Fiscal — IVA/CFDI**: cobrar IVA 16% obliga a **emitir CFDI** y a manejar régimen fiscal, RFC del
  cliente y timbrado (PAC). En el MVP la factura es **manual por correo** (el cliente envía sus datos
  fiscales) y solo se **registra el IVA cobrado**; el **timbrado automatizado con PAC es fase 2**. Validar
  con contador el flujo de facturación, los plazos de emisión y el cumplimiento de esta modalidad manual.
- **ToS de las APIs de precio**: revisar los **términos de uso de pokemontcg.io / TCGPlayer**,
  **PokemonPriceTracker** y **PokeTrace** para confirmar que está permitido mostrar precios de referencia y
  valuar portafolios comercialmente, bajo qué atribución y **respetando los límites de rate del free tier**
  (100/día y 250/día respectivamente); el diseño ya mitiga esto priciando solo la bóveda + cache diario.
- **Privacidad / datos personales — compras de invitado** *(v1.5)*: el guest checkout guarda **correo y
  dirección de una persona sin cuenta**, y el **enlace de seguimiento es un acceso sin contraseña**. Validar
  (a) el **aviso de privacidad** que se muestra al invitado antes de pagar, (b) **cuánto tiempo** se retienen
  los datos de un pedido de invitado que nunca se reclama y (c) cómo atiende la plataforma una **solicitud de
  borrado** de esos datos sin romper la contabilidad de la orden (M7) ni la ventana de disputa.
- **Fraude / contracargos sin cuenta** *(v1.5)*: comprar sin registro baja la fricción también para el
  fraude con tarjeta (no hay historial de usuario ni correo verificado). El **contracargo** ya está cubierto
  operativamente (revierte inventario y estado de orden), pero conviene definir con el humano si quiere
  algún **límite comercial** para invitados (p. ej. monto máximo por pedido de invitado) — hoy **no se
  impone ninguno** (ver preguntas abiertas v1.5).
- **Fiscal/legal — valuación en MXN a mercado**: confirmar que mostrar valor de portafolio a clientes no
  crea expectativa contractual de recompra a ese valor (más allá del remedio de recompra ya definido).
- **Legal/publicidad — el gancho de grading es una afirmación comercial** *(v2.0, §N)*: mostrar «si la gradeas
  podría valer X» en una **página de venta** es publicidad sobre un **resultado incierto que depende de un
  tercero (PSA)**. Riesgo de **publicidad engañosa** ante PROFECO si el comprador entiende el estimado como
  promesa. Mitigaciones ya incorporadas: gate conservador sobre **PSA 9** (N.2), **disclaimer obligatorio en
  toda superficie** (N.5) y **exclusión explícita de garantía de grado** (Fuera de alcance). **Validar con
  abogado**: (a) que el **texto del disclaimer** (borrador en N.5) sea suficiente y esté también en
  **términos/políticas**, (b) que el estimado **no cree derecho** a compensación si el grado sale menor, y (c)
  que el uso de la marca **«PSA»** para nombrar el grado en la UI sea un **uso descriptivo/nominativo
  admisible** y no sugiera afiliación, aval o asociación con PSA.
- **Comercial — expectativa del cliente y soporte** *(v2.0, §N)*: aunque legalmente esté cubierto, un cliente
  que compre por el gancho y **saque PSA 8** volverá a soporte. Conviene decidir el **guion de respuesta** y
  confirmar que la política de **ventas finales** (§H) aplica sin excepción a este caso —el estimado **no** es
  una de las dos excepciones de reembolso—; hoy el documento asume que **no** crea ninguna excepción nueva.
- **ToS del proveedor del estimado por grado** *(v2.0, §N)*: revisar los **términos de PokemonPriceTracker**
  para confirmar que está permitido **mostrar públicamente** valores de mercado de cartas gradeadas **con fines
  comerciales** dentro de una tienda, bajo qué **atribución** y con qué **límites de rate/caching** (el diseño
  ya mitiga priciando solo lo que está en bóveda + cache diario).

## Métricas de éxito del MVP / definición de "lanzado"
El MVP se considera "lanzado" cuando, en una **beta cerrada**, se cumple en un periodo de **30–60 días**:
- **N** usuarios activos en la beta cerrada. *(N: PENDIENTE de fijar por el humano.)*
- **X** ventas completadas (pago `settled`). *(X: PENDIENTE de fijar por el humano.)*
- **Y** solicitudes de buylist aprobadas y pagadas. *(Y: PENDIENTE de fijar por el humano.)*
- **Z** retiros enviados sin disputa. *(Z: PENDIENTE de fijar por el humano.)*
- El back-office opera el ciclo completo (compra → bóveda → retiro y cotización → recepción → pago) sin
  intervención fuera de la herramienta.

## Decisiones tomadas (antes preguntas abiertas)
> Las 9 preguntas del borrador previo quedaron resueltas por el humano y ya están integradas arriba.
> Se conservan aquí como registro de decisión.
1. **Impuestos/IVA** → precios **sin IVA**; **IVA 16%** como línea aparte en checkout, incluido en el total;
   **factura CFDI manual por correo** en el MVP (timbrado con PAC = fase 2), registrando IVA en M7.
2. **Alcance geográfico** → **solo nacional (todo México)** en MVP; internacional es fase 2.
3. **Almacenamiento en bóveda** → **sin límite explícito** en MVP; solo se declara en términos el derecho
   genérico a cobrar custodia en fase 2.
4. **Fuentes de precio** → MVP 100% free: pokemontcg.io (raw/singles) + PokemonPriceTracker/PokeTrace
   (gradeadas) + override manual; solo se prician cartas en bóveda con cache diario;
   **PriceCharting fuera del MVP**; `PricingProvider` intercambiable para escalar a plan de pago. *(ACTUALIZADO
   por v1.6 / decisión 34: el **sellado** se pricia **derivado de TCGCSV por spread** —no por
   PokemonPriceTracker/PokeTrace ni manual—; ver §K. Para raw/singles no cambia nada.)*
5. **Tarifa de envío** → default **MX$175** (configurable en M10).
6. **Costo de aportación en especie** → default **70%** (configurable).
7. **Topes de buylist** → **MX$3,000/solicitud**, **MX$10,000/mes**, **INE sobre el tope** (configurables).
8. **Tope de reposición por carta** → **configurable por el dueño** en M10.

**Decisiones post-arquitectura:**
9. **Precio de venta** → **referencia + markup configurable** (dial en M10); el "valor de mercado" mostrado
   y la valuación de portafolio siguen usando la **referencia** pura.
10. **Facturación CFDI** → **manual por correo** en el MVP (sin timbrado con PAC); IVA sigue desglosado en
   checkout y registrado en M7; timbrado automático = fase 2.
11. **Nombre comercial / marca** → **TCG Vault MX** (nombre usado en UI, comunicación y términos).
12. **Política de reembolsos** → **VENTAS FINALES** para **todos los tipos de producto** (raw, sellado,
   gradeadas): sin reembolso voluntario tras la compra. **Dos excepciones**: (a) disputa de condición por
   carta dañada/equivocada (ventana de **7 días contados desde la entrega del envío**, **evidencia por correo
   a soporte** —ver decisión 22) con **recompra al precio pagado y el cliente conserva la carta** (sin
   devolución); (b) **error de la plataforma** (cobro duplicado / inventario fantasma) → **siempre se
   reembolsa**, sin ventana ni evidencia de disputa. El contracargo bancario es un proceso independiente ante
   el banco del cliente. El checkout muestra el aviso y hay página de términos.

**Decisiones de alcance del 2026-08-14 (7 cambios aprobados por el humano):**
13. **Condición del raw = solo NM** en todo el marketplace (se eliminan LP/MP/HP/DMG); nomenclatura "Casi
   nueva (Near Mint)" + estándar propio definido; política **NM-only** en buylist (no-NM → rechazo /
   devolución a costo del usuario; abandono no-NM no entra a inventario vendible).
14. **Sección "Compra"** (renombrada desde "Catálogo") = **inventario propio publicado**; solo se lista lo
   que tiene precio (nunca "precio pendiente" al comprador).
15. **Filtros de Compra**: set con **año de lanzamiento**, **rareza moderna** (Art/Illustration Rare, Special
   Illustration Rare, Full Art, Alternate Art, Trainer Gallery, Character Rare, Radiant, etc.) y **tipo**
   (incl. sellado).
16. **Venta de sellado** en Compra con **precio manual del admin en MXN** (sin condición/rareza; el admin
   fija precio antes de publicar; PriceCharting = fase 2). *(SUPERADO por v1.6 / decisiones 33–39: el precio
   del sellado es ahora **derivado de TCGCSV por spread**, el sellado **sí tiene condición propia** y es
   **solo venta**; ver §K.)*
17. **Gráfica de tendencia del portafolio** en "Mi bóveda" (rangos 5d/15d/1m/3m/6m/1a/YTD/Máx).
18. **Login con Google** como alternativa a email/contraseña.
19. **Sync de catálogo** desde la fuente de referencia: por defecto sets **2024+**, con **backfill** por
   lotes automatizados + importación puntual.

**Simplificación v1.2 (2026-08-14, 6 cambios aprobados por el humano):**
20. **Sin fotos propias en ningún lado** → el producto no lleva fotos propias; se usa la **imagen de catálogo
   de pokemontcg.io** (remota). Se **elimina** la captura de "fotos verificadas de anverso/reverso al ingreso"
   como mecanismo canónico de condición/disputa.
21. **Gradeadas (PSA/CGC)** → el **slab es la garantía**; se muestra **empresa + grado + número de
   certificado** (verificable en la web de la graduadora) y se captura **`certNumber`**.
22. **Disputas de condición** → la **evidencia se envía por correo a soporte** (no hay subida de foto en la
   app). Resolución: **gradeadas** por grado/cert; **raw NM** por el estándar/política. La política de
   **ventas finales** (recompra/compensación, el cliente conserva la carta, no revierte inventario) **no
   cambia** (ver decisión 12). El correo de evidencia se documenta como dato de contacto.
23. **KYC del buylist** → el **INE SÍ se almacena** como **imagen cifrada en R2 con retención**
   (`INE_RETENTION_DAYS`, default 180), pedido en el paso de pago sobre el tope y **verificado contra el nombre
   de la CLABE** (soporte AML). La **CLABE sigue guardándose cifrada en BD** (sin cambio). **Bandera para
   contador/abogado**: validar el **periodo de retención** y las obligaciones de protección de datos.
   *(Revierte la decisión v1.2 de "INE no almacenado", restaurando el comportamiento de v1.1.)*
24. **Object storage / R2 DENTRO del MVP pero acotado SOLO al INE del buylist** (`kyc_ine`) → hay bucket
   únicamente para la imagen del INE (cifrada, con retención); **NO** hay fotos de producto/inventario ni de
   evidencia de disputa. La **CLABE no usa R2** por ser un **número cifrado en BD**, no un archivo.
   *(Revierte la decisión v1.2 de "R2 fuera del MVP" solo para el INE.)*
25. **Raw** → sigue operándose **solo en NM** (estándar de condición propio, ahora explícitamente **sin
   foto**).

**Decisiones v1.4 (2026-08-16, tomadas por el humano):**
26. **Acabado/versión de carta en toda la cadena** → las cartas se distinguen por acabado (Normal, Reverse
   Holo, Holofoil, 1st Edition…) en Compra, cotizador, inventario/bóveda, valuación de portafolio y precio de
   buylist. Los precios por acabado de `tcgplayer.prices` (hoy descartados) se conservan. Ver §I.
27. **Precio por acabado = reusar la tabla por rareza de M2** → el acabado mapea a una regla existente
   (reverse holo → "Reverse Holo"; holo → "Holo"/base; normal → rareza base) y, para reglas de %, usa el precio
   de mercado de **ese acabado**. Monto derivado **server-side** (SEC-A1). Filas históricas → default `normal`.
28. **Alta de inventario por set contra el catálogo real (M1)** → set → carta real del catálogo → acabado;
   se abandona el uso de cartas mock.
29. **Origen del inventario por item** → `owner_contribution` (aportación 70%) vs `client_purchase` (comprada
   a cliente en buylist); capturado al alta, afecta costo/P&L (M7).

**Decisiones v1.5 — guest checkout (2026-08-18, tomadas por el humano):**
30. **Comprar sin cuenta, con envío directo únicamente** → el invitado puede completar la compra dando
   correo y dirección, pero **solo con envío a domicilio**. **Guardar en bóveda REQUIERE cuenta**: es una
   decisión deliberada de producto (la bóveda es el **gancho de registro**). En el checkout, elegir bóveda
   como invitado **no es un error**: dispara un **upsell in-situ** para crear cuenta sin perder el carrito.
   Ver §J.
31. **Correo obligatorio + seguimiento por enlace tokenizado** → se exige y valida un correo; el
   seguimiento del pedido se hace con un **enlace con token firmado y expirable** enviado por correo, que da
   acceso a **un solo pedido**, con **datos mínimos** y **sin acciones sensibles**. No hay consulta pública
   de pedidos por número ni por correo. Ver §J y criterios 49–53.
32. **Reclamo post-compra** → al completar la compra se ofrece **crear cuenta con el mismo correo**; al
   hacerlo, el pedido de invitado **pasa al historial** de esa cuenta (una sola vez, sin alterar el pedido).
   Ver §J y criterios 54–56.

**Decisiones v1.6 — sellado (producto cerrado) (2026-08-19, tomadas por el humano; SUPERSEDEN decisiones 4 y 16):**
33. **Precio del sellado = DERIVADO por spread** (ya no manual-único): precedencia `override manual >
   (mercado × spread por presentación) > (mercado × spread global de respaldo) > sin precio ⇒ PRICE_PENDING
   (no se publica)`. **Supersede** la parte de sellado de la decisión 4 ("sellado = precio manual") y la 16.
34. **TCGCSV = BASE del precio de venta del sellado** (ya no "solo informativa"), vía el **mapeo curado
   existente**. Aplica **solo al sellado**; para **raw/singles no cambia nada**.
35. **Spreads configurables por presentación** (ConfigSetting, M10): semillas **box 18% / etb 22% / bundle
   25% / tin 30% / blister 35% / global 25%** (editables, auditados).
36. **Sellado = solo venta** (plataforma→cliente): **sin buylist de sellado**; call-out `mailto`
   (`contacto@tcgvaultmx.com`) para revender fuera de la app.
37. **Condición del sellado**: default **Mint**, opción **"Detalle menor en caja"**; visible al comprador,
   **sin efecto en el precio**; el sellado **no lleva rareza**.
38. **Destino igual que cartas** (recibir/`direct_ship` o bóveda/`vault`), **pestaña "Sellado"** en bóveda
   del cliente y vista admin, y **entra en la valuación/tendencia del portafolio**.
39. **Diferenciadores cableados pero apagados** (feature-flag off): **tendencia de valor del sellado** y
   **"avísame cuando vuelva" (restock)**; se encienden después sin nuevo desarrollo.

**Decisiones v2.0 — gancho de grading (2026-08-23, tomadas por el humano):**
40. **Alcance completo, tres superficies**: **ficha** + **badge en las tejas de Compra** + **vitrina «Joyas
   para gradear» en el home**. No es una prueba en una sola pantalla. Ver §N.3. *(ACTUALIZADO 2026-08-23 — ver
   decisión 50: la ficha deja de ser un «bloque comparativo» y pasa a mostrar solo precio + PSA 10 + PSA 9.)*
41. **Gate de ROI sobre PSA 9, NO sobre PSA 10** — `estimadoPSA9 ≥ (precioVentaRaw + gradingCost) ×
   (1 + minUpsidePct)`. El **PSA 10 ilusiona pero no decide**. Racional: con el gate en PSA 10, a un cliente
   que saque PSA 9 podría **costarle dinero**, y eso quema la reputación de la tienda. Ver §N.2.
   *(ACTUALIZADO 2026-08-23 — ver decisión 51: el gate **cambia de papel**, de «se ve o no se ve el gancho» a
   **criterio de curaduría** de las superficies de promoción; la matemática no cambia.)*
42. **Dos diales configurables por el admin**: **`gradingCostTiers`** y `minUpsidePct` (default **30%**),
   editables **sin deploy** y **auditados**. *(ACTUALIZADO 2026-08-23 — ver decisión 46: el costo de gradeo
   pasó de escalar plano a **tabla de escalones**.)*
43. **Fuente = PokemonPriceTracker (ya contratado) + override manual del admin** como respaldo y máxima
   precedencia. **PriceCharting sigue fuera.** *(ACTUALIZADO 2026-08-23 — ver decisión 47: la feature arranca
   **manual-first**; el ingest automático es **fase 2** y está bloqueado.)* Ver §N.6.
44. **Estimado informativo con disclaimer, nunca un precio de venta ni una promesa de grado**; **money-safe
   extremo**: sin dato o sin gate cumplido, el bloque/badge **no se renderiza** — ni **$0**, ni guion, ni
   **«pendiente»** (en un argumento de venta no se muestra un hueco). Elegibilidad y montos **server-side**
   (SEC-A1). Ver §N.4 y §N.5.
45. **Desambiguación de alcance de grading**: «Grading propio o integración directa con PSA/CGC» (Fuera de
   alcance) significa **no gradeamos cartas ni verificamos slabs por integración**; **NO** prohíbe **mostrar
   estimados de valor por grado**, que **sí** entran al MVP. Mostrar cuánto vale una carta gradeada ≠
   gradearla.

**Decisiones v2.0 — correcciones tras la revisión del humano (2026-08-23):**
46. **Costo de gradeo POR ESCALONES, no plano** *(supersede la parte de costo de la decisión 42)*: el dial
   deja de ser un escalar y pasa a ser una **tabla de escalones configurable por admin** —rango de **valor
   declarado** → **costo de gradeo en MXN**— imitando cómo cobra **PSA** (por nivel de servicio según valor
   declarado). Debe **cubrir todo el rango sin huecos**, terminar en un **escalón abierto**, e **incluir la
   cuota de PSA + envío internacional + retorno a México**. Motivo: un costo plano se queda **corto en cartas
   caras** y el gate saldría **optimista justo donde el cliente pierde más**. El **gate de ROI no cambia**:
   solo cambia cómo se resuelve `gradingCost`. Defaults en **N.2.1**, marcados como **SUPUESTO revisable**.
47. **La feature arranca MANUAL-FIRST (fase 1) y el ingest automático es fase 2 bloqueada** *(matiza la
   decisión 43)*: la verificación técnica del proveedor (doctrina **P-6**) concluyó que **hoy no se puede
   construir el ingest** —parámetro extra que **duplica el consumo de créditos**, **formato de payload no
   confirmado** (documentación contradictoria) y **se desconoce** si el dato viene en el barrido por set o
   exige una petición por carta—. **Fase 1**: feature completa con valores PSA **fijados a mano** por el admin
   vía el **override manual existente** (`POST /admin/pricing/override`); el humano **cura sus cartas gancho**.
   **Fase 2**: ingest automático, **condicionado a una observación del operador en staging** que confirme el
   payload. **El comportamiento visible al usuario es idéntico en ambas fases** y **todos los criterios 79–92
   se verifican en fase 1**.
48. **Disclaimer súper enfático — «ilustrativo, no refleja el estado de nuestras cartas»** *(petición textual
   del humano; supersede el borrador anterior de N.5)*: el texto sube de tono a **inequívoco**, con un
   elemento nuevo que era el más importante y faltaba: el estimado es un dato de mercado **genérico de ese
   modelo de carta** y **NO evalúa la pieza concreta que vendemos** —no la hemos inspeccionado ni
   pre-evaluado (centrado, superficie, bordes, esquinas) y **no opinamos sobre qué grado obtendría**—. Los
   **seis elementos obligatorios** y los textos ES/EN (completo y corto) están en **§N.5**; la **versión corta**
   también debe cargar «ilustrativo» + «no evaluamos esta carta».
49. **Proveedor ya contratado — se cierra la contradicción del documento**: **PokemonPriceTracker está
   contratado** y su key vive en Railway; la línea de «Fuera de alcance» que decía que **no se contrata plan
   de pago de proveedor de precios en el MVP** queda **SUPERADA** y así está marcada.

**Decisiones v2.0 — simplificación de la superficie visible (2026-08-23, tercera ronda del humano):**
50. **Fuera el multiplicador y la comparativa** *(cita: «no hay que mostrarlo así mejor. Solo pongamos cuánto
   vale en PSA 10… nos quitamos talacha de calcularlo… solo bajemos el precio y desplegamos "en PSA 10 vale
   tanto"»; preguntado por el PSA 9, confirmó que **quiere los dos grados**)*: la superficie visible queda en
   **precio de la carta + estimado PSA 10 + estimado PSA 9**. **Se elimina** el multiplicador, la
   diferencia/ganancia calculada, el costo de gradeo mostrado, el margen y toda comparativa. Beneficio doble:
   **menos talacha** y **menos riesgo legal** (un dato de referencia no es una promesa de ganancia). Ver §N.3.
51. **El gate cambia de papel: de condición de render a CRITERIO DE CURADURÍA** *(cita: «calcúlalo para que
   podamos ponerlo en la sección de destacado algo que valga la pena»)*: el gate y la tabla de escalones
   (N.2.1) **se conservan íntegros**, pero ahora deciden **qué promocionamos**, no qué se enseña.
   **Ficha** → muestra los estimados **siempre que haya dato**, sin condicionar al gate. **Teja y vitrina** →
   **solo si el gate se cumple**. **Vitrina ordenada por mayor ganancia neta sobre PSA 9** (escenario
   realista, no optimista). **El resultado del cálculo NUNCA se expone al cliente** —ni ganancia, ni escalón,
   ni multiplicador, ni flag—; lo único observable es **qué cartas aparecen y en qué orden**. Esto **refuerza
   SEC-A1**: el cliente ya ni recibe los insumos del cálculo. Ver §N.2 y §N.3.
52. **Disclaimer completo = NOTA AL PIE, con llamada junto a la cifra** *(cita: «El completo solo hagamos
   referencia con un asterisco donde ponemos el tag y hasta abajo de la página lo ponemos»)*: **el texto
   completo NO se poda** —cambia dónde vive, no qué dice—. Regla de producto: **ninguna página que muestre una
   cifra estimada carece de su nota al pie completa** y **ninguna cifra carece de su llamada**.
   **Decisión del PO (con peso legal, para validar con el humano/abogado): se CONSERVA un micro-aviso mínimo
   junto a la cifra**, además de la llamada, cargando las dos ideas obligatorias («ilustrativo» + «no
   evaluamos esta carta»). Motivo: **la nota al pie protege menos que un aviso adyacente si el comprador nunca
   baja**, y en **home** y **listado** eso es lo normal. El resto del disclaimer sí vive al pie sin pérdida
   práctica. Ver §N.5.

## Único pendiente no bloqueante
- **Metas de lanzamiento N/X/Y/Z**: el humano las fija al momento de lanzar la beta cerrada (usuarios,
  ventas `settled`, buylist aprobadas/pagadas, retiros sin disputa, ventana 30–60 días). No bloquean el
  desarrollo del MVP.

## Preguntas abiertas — precio de buylist por rareza (v1.3)
> Este requisito (§E.1) está redactado con supuestos razonables para no bloquear. El humano debe confirmar o
> corregir los siguientes puntos antes de pasar al arquitecto. Los defaults propuestos preservan el
> comportamiento actual, así que el desarrollo puede arrancar con ellos si el humano lo autoriza.
1. **Defaults exactos por rareza — rarezas intermedias**: ¿confirmas que el seed inicial reproduce lo de hoy
   (Common $0.50 fijo, Reverse Holo $1.50 fijo, todo lo demás 40% de referencia)? En particular: **Uncommon**
   y **Rare (no-holo)** — ¿los quieres como **fijo tipo bulk** (¿qué monto, p. ej. $0.50?) o como **% de la
   referencia** (¿qué %)?
2. **Fallback de rareza no listada**: cuando aparezca una **rareza nueva** tras un sync y el dueño aún no le
   fijó regla, ¿prefieres (a) aplicar **% default** (ej. 40%) para no bloquear la cotización —recomendado—, o
   (b) dejar la carta en **"precio pendiente"** hasta que el dueño la configure? (Con (a), la carta solo cae en
   "precio pendiente" si además falta la referencia.)
3. **¿Un % global de referencia editable, o % por rareza?** El default propone **40% para todas las rarezas
   de porcentaje**, pero como cada fila es editable podrías fijar **% distinto por rareza** (ej. Illustration
   Rare 45%, Secret Rare 35%). ¿Quieres esa granularidad desde el MVP o basta un % común para todas las de
   porcentaje?
4. **Alcance de la tabla — ¿solo buylist?** Este precio por rareza es para la **compra al usuario (buylist)**.
   ¿Se queda acotado a buylist (recomendado) o esperas que afecte también otros cálculos (p. ej. costo de
   aportación en especie del inventario propio, hoy 70% de referencia)?
5. **Ubicación del editor**: propongo **M2 (Catálogo y precios)** por ser pricing. ¿De acuerdo, o lo prefieres
   en **M10 (Config)** junto a los demás diales?
6. **Monedas/límites de valores**: ¿algún **rango válido** por regla (ej. % entre 0–100, fijo ≥ $0) o **tope
   máximo** de pago por rareza que quieras imponer como salvaguarda?

## Preguntas abiertas — acabado / versión de carta (v1.4)
> Requisito §I redactado con las decisiones ya tomadas por el humano; quedan estos huecos menores. Los
> supuestos preservan el comportamiento actual y permiten arrancar si el humano los autoriza.
1. **Acabados soportados**: ¿confirmas que basta con soportar exactamente las llaves de `tcgplayer.prices`
   (`normal`, `holofoil`, `reverseHolofoil`, `1stEditionNormal`, `1stEditionHolofoil`, y `unlimitedHolofoil`
   si aparece), agrupadas como **Normal / Reverse Holo / Holofoil / 1st Edition**? ¿O quieres un catálogo de
   acabados distinto (p. ej. tratar `unlimitedHolofoil` como "Holofoil" sin distinguirlo)?
2. **Regla de buylist para 1st Edition**: no hay una regla "1st Edition" en la tabla por rareza. ¿La mapeamos
   a la misma regla que su acabado equivalente (1st Ed. Normal → Normal/base; 1st Ed. Holo → Holo) usando el
   precio de mercado de la llave `1stEdition*` **(SUPUESTO actual)**, o quieres una **regla propia** para 1st
   Edition (fijo/% distinto)?
3. **Regla "Holo" vs rareza base ya holo**: cuando la **rareza base ya es holo** (p. ej. "Rare Holo") y el
   acabado es Holofoil, ¿aplica la **regla de la rareza base** (recomendado, evita doble mapeo) o **siempre**
   la regla genérica "Holo"?
4. **Múltiples acabados del mismo item en Compra/bóveda**: ¿un `InventoryItem` es **siempre un acabado
   concreto** (recomendado; cada físico es una versión), y en Compra se listan como **entradas separadas por
   acabado**? Se asume que sí.
5. **Reverse Holo en cartas sin esa versión**: si el vendedor intenta cotizar un acabado que **esa carta no
   ofrece** (no está en `tcgplayer.prices`), ¿lo **bloqueamos** (solo se pueden elegir acabados disponibles,
   recomendado) o lo dejamos en "precio pendiente"?

## Preguntas abiertas — guest checkout (v1.5)
> Las **tres decisiones de producto** del guest checkout (solo envío directo + bóveda con cuenta y upsell;
> correo obligatorio + enlace tokenizado; reclamo post-compra) están **cerradas** y ya redactadas en §J.
> Lo que sigue son huecos de detalle; cada uno tiene un supuesto en el documento para no bloquear.
1. **El correo del invitado YA tiene cuenta (la más importante)**: el supuesto actual es **no revelar** que
   el correo está registrado (evitar enumeración), **permitir la compra como invitado** y dejar el pedido
   **sin vincular** hasta que el titular inicie sesión y lo **reclame explícitamente** (así nadie inyecta
   pedidos al historial de un tercero escribiendo su correo). Alternativas: (a) **vincular automáticamente**
   el pedido a la cuenta existente al momento del pago —más cómodo, pero permite ensuciar el historial
   ajeno—; (b) **pedir iniciar sesión** antes de continuar —revela que el correo existe y reintroduce la
   fricción que esta feature quiere eliminar—. ¿Confirmas el supuesto (reclamo explícito) o prefieres (a)/(b)?
2. **Vigencia del enlace de seguimiento**: el supuesto son **90 días** desde la creación del pedido (cubre
   entrega + los 7 días de ventana de disputa con margen). ¿Te sirve 90, prefieres 30, o "hasta X días
   después de entregado"?
3. **Reenvío del enlace**: ¿el invitado puede **auto-servirse** un enlace nuevo desde la página de "enlace
   expirado" (supuesto actual: sí, con respuesta neutra y límite de frecuencia), o prefieres que el reenvío
   **solo lo haga soporte** a petición?
4. **Compensación de una disputa a un invitado**: el supuesto es **reembolso del monto pagado** (no hay
   bóveda ni saldo donde abonar la recompra) manteniendo el resto de la política (§H: el cliente conserva la
   carta). ¿Confirmas?
5. **Límite comercial para pedidos de invitado**: hoy **no se impone ninguno** (mismo precio, mismos
   límites). ¿Quieres un **monto máximo por pedido de invitado** o restringir ciertos productos (p. ej.
   gradeadas caras o sellado de alto valor) para bajar exposición a contracargos?
6. **Datos del invitado en el back-office**: se asume que un **pedido de invitado se ve igual que uno con
   cuenta** en M3 (con etiqueta "invitado" y su correo), sin crear un usuario fantasma. ¿De acuerdo?
7. **Retención de datos del invitado no reclamado**: ¿cuánto tiempo conservamos correo y dirección de un
   pedido de invitado que nunca se convierte en cuenta? (Ligado a la bandera de privacidad; sin supuesto
   propuesto porque depende de la postura legal/fiscal.)
8. **Idioma del correo de seguimiento**: se asume que el correo sale en el **idioma que el invitado tenía
   activo** en la interfaz al comprar (ES por default). ¿De acuerdo?

## Preguntas abiertas — sets multi-parte / Master Set combinado (v1.7, P-27)
> Todas tienen un **default sensato** ya redactado en §L (marcado `SUPUESTO`), así que **no bloquean** el
> arranque; lo que sigue es lo que conviene que el humano confirme o ajuste.
1. **Combinado vs. separados-enlazados (la principal)**: el default es **UN master set combinado** (Celebrations
   = 50 en un binder, con separador para Classic Collection). ¿Lo confirmas, o prefieres **sets separados pero
   enlazados** (dos binders con vínculo "ver Classic Collection")?
2. **Etiqueta y separación del subset**: el default etiqueta el bloque del subset como **"Classic Collection"**
   con un separador visual, y ordena **principal primero, subset después**. ¿Te sirve ese texto y ese orden, o
   prefieres otra etiqueta/orden (p. ej. intercalar por número)?
3. **Qué pares entran al mapa en el MVP**: el default entrega **Celebrations** (`cel25`→`cel25c`) funcionando y
   el mecanismo listo. Para el patrón "Shiny Vault", ¿confirmas que quieres agrupar también **Shining Fates**
   (`swsh45`→`swsh45sv`) y **Hidden Fates** (`sm115`→`sma`) en este MVP, o los dejamos declarados para después?
   ¿Hay otros sets multi-parte que ya te consten (p. ej. subsets de promos/galerías con id propio)?
4. **Subset sin su principal**: el default es mostrar la parte presente bajo el nombre del principal si el
   principal está en el mapa; si falta la parte principal, el subset se muestra como su propio set hasta que su
   principal exista. ¿De acuerdo, o prefieres ocultar el subset hasta tener ambas partes?
5. **Completitud sobre 50 (o sobre lo importado)**: el default fija **esperadas = suma de las partes del mapa**
   (50 para Celebrations) aunque falte importar alguna carta. ¿Quieres que "esperadas" sea siempre el total
   oficial del set combinado, o el total efectivamente importado?
6. **Consolidación futura de identidad (fuera de este MVP)**: hoy es **solo presentación** y cada carta conserva
   su set-id real (money-safe). ¿Confirmas que **no** quieres, ni ahora ni pronto, fusionar los set-ids en una
   sola llave real (lo que implicaría re-llavear precio/inventario/bóveda)? Si algún día lo quieres, es un
   cambio de modelo aparte.

## Decisiones (v1.9, P-34) — pricing por tiers (LOCKED)
> El humano respondió las preguntas abiertas del borrador v1.8. Estas decisiones quedan **cerradas** y son la
> entrada para el arquitecto (schema + contrato del editor). Ninguna bloquea el arranque.
1. **Número de tiers → 5** (LOCKED): T0 Bulk, T1 Uncommon/Reverse, T2 Rare/Holo, T3 Premium/Chase, T4
   Ultra/Grail. Define el editor de M2 (5 filas de reglas por eje).
2. **Nombres de los tiers → los propuestos** (LOCKED): «Bulk / Uncommon-Reverse / Rare-Holo / Premium-Chase /
   Ultra-Grail».
3. **T2 (Rare / Holo) → PORCENTAJE bajo del mercado** (LOCKED): default **25%**, ajustable sin código. **NO
   fijo.** Es un **cambio intencional** de comportamiento (antes Rare/Rare Holo caían al bin fijo de bulk).
   Money-safe: `pct` sin referencia de mercado ⇒ **precio pendiente, nunca $0** (igual que T3/T4).
4. **Rarezas SIN MAPEAR → premium** (LOCKED, corrección de dinero): **Mega Hyper Rare → alias de Hyper Rare →
   T4**; **`MEGA_ATTACK_RARE` → nueva canónica premium → T3**; **Black White Rare → nueva canónica premium →
   T3**. `MEGA_ATTACK_RARE` y Black White Rare eran **money-losing** (el patrón las trataba como no-premium y
   cotizaban al bin fijo de bulk): con esto dejan de hacerlo. El **barrido de otras `unmapped`** del catálogo
   real es tarea de implementación (arquitecto/backend) con esta misma política; no es un hueco de producto.
5. **Eje acabado (`finish`) → sigue siendo eje aparte** (LOCKED): los tiers son para el eje **rareza**; el eje
   **acabado** (normal/reverse_holo/holofoil/1st-ed) no se «tieriza» y queda como está (§I).
6. **Tiers en compra Y venta** (LOCKED): un **mismo mapa rareza→tier** alimenta la tabla de **compra (buylist)**
   y la de **venta** (`computeSalePriceForRarity`), con **dos juegos de valores por tier** (en compra `pct` = %
   de la referencia; en venta `pct` = markup arriba de mercado).
7. **Mapa rareza→tier → EDITABLE por el dueño** (LOCKED, Opción B): además de editar la regla de cada tier, el
   dueño puede **reasignar una rareza a otro tier** desde M2. El backend valida el invariante de refinamiento
   estricto (M.4) en cada edición; todo cambio queda auditado (M10).
8. **T4 (Ultra/Grail) → 40%** (LOCKED): igual que T3 por ahora; queda como tier propio para poder subirlo luego
   sin código si el dueño quiere pagar más por Special Illustration/Hyper/Secret/Gold.

**Abierto (no bloquea al arquitecto):** ninguna decisión de producto queda pendiente. Lo único que resta es
**operativo/de implementación**: (a) el **barrido completo de rarezas `unmapped`** contra el catálogo real
(punto 4) y (b) los **valores por defecto de venta por tier** que reproduzcan el markup vigente (los fija
backend/arquitecto al implementar, sin decisión de producto adicional).

## Preguntas abiertas — gancho de grading (v2.0, §N)
> Las **decisiones de fondo están cerradas** (alcance de tres superficies, gate sobre PSA 9, los dos diales y
> sus defaults, la fuente del dato y la regla money-safe; ver decisiones 40–45). Lo que sigue son **el texto
> del disclaimer** —que necesita aprobación explícita— y **huecos menores**, todos con un supuesto ya
> redactado en §N para **no bloquear** al arquitecto.

1. **Texto del disclaimer (la más importante — es legal-comercial)** — *ACTUALIZADA 2026-08-23*: el humano
   pidió que fuera **«súper enfático que es información ilustrativa, que no refleja el estado de nuestras
   cartas»**, y §N.5 ya está **reescrita** con ese tono y con los **seis elementos obligatorios** (incluido el
   nuevo y más importante: **no evaluamos la condición de la pieza que vendemos**). **Falta tu visto bueno
   final** sobre el texto ES/EN ya redactado: ¿lo apruebas tal cual, lo ajustas, o lo pasas antes por
   **revisión legal**? ¿Quieres además que el mismo texto viva en la **página de términos/políticas**?
2. **Base de comparación del gate**: el supuesto es comparar contra el **precio de venta raw sin IVA** (el
   número que ya ve el comprador), **sin** sumar IVA ni envío al lado del costo. ¿Confirmas, o prefieres un
   gate **aún más conservador** que incluya IVA y/o el envío de MX$175 en `precioVentaRaw`?
3. ~~**Costo de gradeo plano vs. por nivel de servicio**~~ — **RESUELTA (2026-08-23)**: el humano eligió
   **escalones por valor declarado**. El costo plano de MX$600 queda **eliminado** del documento y sustituido
   por la tabla **`gradingCostTiers`** (**N.2.1**), que además debe **incluir envío internacional y retorno a
   México**. Ver decisión **46** y criterio **92**. *(Sub-pregunta que queda viva dentro de N.2.1: los
   **valores por defecto** de la tabla son un **SUPUESTO** y conviene que los valides contra lo que realmente
   te cuesta gradear hoy; y **qué valor se usa para buscar el escalón** —el supuesto es el **estimado PSA 10**,
   por ser el más conservador—.)*
4. **Copy del badge** — *ACTUALIZADA 2026-08-23*: tras quitar el multiplicador, el supuesto es
   **«En PSA 10 vale ≈ MX$X»** (y en móvil **«PSA 10 ≈ MX$X»**), alineado con tu frase *«desplegamos "en
   PSA 10 vale tanto"»*. ¿Te gusta ese texto o prefieres otro? *(Ya no se contempla mostrar multiplicador.)*
5. ~~**Cómo se expresa el upside en la ficha**~~ — **SIN OBJETO (2026-08-23)**: decidiste **no mostrar
   comparativa ni multiplicador**. La ficha muestra **precio + PSA 10 + PSA 9** y nada calculado. Ver decisión
   **50** y criterio **81**.
6. **Vitrina del home — tamaño**: el **orden ya está decidido** (mayor **ganancia neta sobre PSA 9**, criterio
   83). Lo que queda abierto es el **tamaño**: el supuesto es **hasta 8 cartas**. ¿Te sirve 8, prefieres otro
   número, o quieres además poder **fijar/curar a mano** alguna carta en la vitrina desde el admin?
7. **Umbral de frescura**: el supuesto es que un estimado con más de **30 días** sin refresco **deja de
   mostrarse**. ¿30 está bien, prefieres 7/14, o que se muestre siempre el último dato disponible con su fecha
   visible?
8. **Ubicación de los diales**: se propone **M10 (Config y bitácora)** junto al resto de diales; la alternativa
   es **M2 (Catálogo y precios)** por ser pricing. ¿Cuál prefieres?
9. ~~**PokemonPriceTracker ya contratado vs. «plan de pago fuera del MVP»**~~ — **RESUELTA (2026-08-23)**:
   confirmado por el humano — **el proveedor ya está contratado** y la key vive en Railway. La línea de «Fuera
   de alcance» quedó marcada como **SUPERADA** y el documento ya no se contradice. Ver decisión **49**.
   *(Ojo: esto **no** desbloquea el ingest automático, que sigue en **fase 2** por razones **técnicas**, no de
   contratación — ver §N.6 y decisión 47.)*
10. **¿El gancho puede convivir con «ventas finales»?** Se asume que el estimado **no crea ninguna excepción
    nueva** a la política de reembolsos (§H): si el cliente gradea y saca menos, **no hay compensación**.
    ¿Confirmas esa postura tal cual, o quieres algún gesto comercial discrecional documentado?
11. **Visibilidad para invitados**: se asume que el gancho es **público** (lo ve cualquier visitante sin
    sesión, igual que el precio). ¿De acuerdo, o lo quieres como beneficio de usuarios registrados para
    empujar el registro?
12. **¿Micro-aviso junto a la cifra, o solo la llamada al pie?** *(NUEVA, 2026-08-23 — decisión con peso
    legal)*: pediste que el disclaimer completo viva **al pie con un asterisco**. Yo **conservé además un
    micro-aviso mínimo junto a la cifra** («Ilustrativo; no evaluamos esta carta.\*») porque **la nota al pie
    protege menos que un aviso adyacente si el comprador nunca baja** — y en el **home** y el **listado** eso
    es lo normal. ¿Lo confirmas, o prefieres **solo el asterisco** sin micro-aviso? *(Si eliges solo el
    asterisco, conviene validarlo con abogado: es justo la cobertura que se debilita.)*
13. **Ficha con un solo grado disponible** *(NUEVA, 2026-08-23)*: si una carta tiene **PSA 10 pero no PSA 9**
    (o al revés), el supuesto es que **la ficha muestra el que exista** —es información, no promoción— aunque
    esa carta **no** pueda promocionarse en teja/vitrina. ¿De acuerdo, o prefieres que la ficha **exija los dos
    grados** para mostrar algo?
