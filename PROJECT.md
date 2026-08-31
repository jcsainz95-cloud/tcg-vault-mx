# PROJECT.md — TCG HUNT — Marketplace TCG con Bóveda (Pokémon, México)

> **Marca (nombre comercial): TCG HUNT.** Es el nombre que se usa en la **interfaz, la comunicación y los
> términos**. «Marketplace TCG con Bóveda» es solo el título descriptivo del proyecto, no una marca.
>
> **Fuente de verdad verificable — no copies el literal, lee la clave.** La marca vive en la clave i18n
> **`common.brand.name`** (ES y EN) y el dominio en **`common.brand.domain`** (**`tcghunt.mx`**). Si algún
> día este documento y esas claves discrepan, **manda la clave** y se corrige este documento — **nunca al
> revés**. Ningún rol debe cambiar una cadena de marca en el producto citando este párrafo como autoridad:
> la autoridad es el valor de la clave, y este párrafo solo dice **dónde leerlo**.
>
> **Marca ≠ razón social — no son intercambiables.**
> - **Marca** = `common.brand.name` = **TCG HUNT**. Es lo que el usuario lee: UI, copy, correos, títulos,
>   metadata de archivos que genera la plataforma.
> - **Razón social** = `common.footer.legalEntity`, hoy **pendiente de carga** (el pie la omite hasta que
>   exista). Es la **entidad legal que responde**, y se usará donde haga falta identificarla (deslindes,
>   términos, facturación). Una marca no es sujeto de obligaciones; la razón social sí.
>
> **Nota histórica (2026-08-31):** «TCG Vault MX» fue un **nombre interno de trabajo** que este documento
> llegó a declarar por error como nombre comercial. **Nunca fue la marca de cara al usuario** y queda
> **retirado**: no debe aparecer en interfaz, copy, correos, dominios, metadata de archivos generados ni
> documentación. Cualquier cadena «TCG Vault MX» que siga viva en `docs/` o en código es un **residuo a
> corregir**, no una fuente válida.
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
> `override manual > spread por presentación > spread global de respaldo > sin precio
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
> **Requisito v2.0 — VALOR ESTIMADO SI SE GRADEA («gancho de grading») (2026-08-23, ACTUALIZADO
> 2026-08-28; BORRADOR del product-owner sobre DECISIONES YA TOMADAS por el humano — EN REVISIÓN solo por el
> texto del disclaimer y los huecos menores):** en la tienda se muestra, sobre una carta **raw**, **el precio
> de la carta + cuánto vale estimado en PSA 10 y en PSA 9**. Es un **gancho comercial** (cita del humano: *«si
> compras esta que no vale mucho sin gradear y la gradeas podría valer tanto más, y que se animen a comprar más
> mis cartas»*) y es **estrictamente un estimado ilustrativo con disclaimer**: **NUNCA** un precio de venta,
> una oferta ni una promesa de grado. Decisiones cerradas del humano: **(1) cuatro superficies**
> *(actualizado 2026-08-31: eran tres)* —**ficha**, **badge** en las tejas de Compra, **vitrina «Joyas para
> gradear»** en el home y **burbuja en el carrusel «Piezas destacadas del catálogo»** del home; **las dos
> secciones del home se conservan**, el humano las quiere **ambas**—, con la **superficie visible
> simplificada** *(actualización 2026-08-23: **fuera** el multiplicador, la ganancia calculada y toda
> comparativa; cita: «solo bajemos el precio y desplegamos "en PSA 10 vale tanto"», y confirmó que **quiere los
> dos grados**)*; **(2) gate de ROI sobre PSA 9** (no sobre PSA 10) con la fórmula
> `estimadoPSA9 >= (precioVentaRaw + gradingCost) × (1 + minUpsidePct)`, que *(actualización 2026-08-23)* pasa
> a ser **criterio de curaduría interno**: la **ficha** muestra los estimados **siempre que haya dato**, y
> las **superficies de promoción** —teja de Compra, vitrina y **destacadas**— **solo** llevan cifra en cartas
> que pasan el gate, **ordenadas la
> vitrina por mayor ganancia neta sobre PSA 9**; **el resultado del cálculo nunca se expone al cliente**; y
> **dos diales configurables** — **`gradingCostTiers`**, una **tabla de escalones** valor de carta → costo de
> gradeo *(actualización 2026-08-23: sustituye al costo plano de MX$600; PSA cobra por nivel de servicio según
> valor declarado y el costo debe incluir **envío internacional y retorno a México**, ver §O.2.1)*, y
> `minUpsidePct` default **30%**; **(3) FUENTE AUTOMÁTICA** *(actualización 2026-08-28 — **supersede el
> arranque manual-first**)*: el estimado se alimenta **automáticamente desde PokemonPriceTracker** (proveedor
> **ya contratado**), que **no valúa nada**: entrega **ventas cerradas reales de eBay agrupadas por grado**
> (`ebay.salesByGrade`, con **número de ventas de la muestra, mediana, promedio y fecha de la última venta**).
> El **override manual del admin se conserva** como respaldo y para **curar cartas concretas**, con la
> **máxima precedencia**; **(4) la cifra SÍ se pinta en la REJILLA de Compra, en la VITRINA del home y en el
> carrusel de DESTACADAS** *(nuevo 2026-08-28; destacadas añadido 2026-08-31)*, pero **condicionada a un GATE
> DE CONFIANZA**: el número debe ser **fresco**, de
> **origen confiable** (override manual, o dato automático con **muestra suficiente de ventas**) y
> **coherente en magnitud**. La **ficha no aplica la coherencia de magnitud con la misma dureza** —informa lo
> que hay—: solo las **superficies de promoción** exigen confianza (**§O.7**). **En destacadas la burbuja se
> suma sin curar el carrusel** (mismas tejas, mismo orden por precio descendente) y, como ese carrusel lista
> **las cartas más caras** —las que más costo de gradeo cargan—, es **esperable que muestre pocas cifras o
> ninguna**: eso **no es un defecto** (§O.3);
> **(5) GUARDA DE DINERO** *(nuevo 2026-08-28)*: se **bloquea capturar un estimado** de un grado cuando esa
> carta ya tiene una **pieza real de ese grado publicada** en inventario —comparten la **misma fila de
> precio**, así que un «estimado» capturado a mano **movería el precio de venta real del slab** (**§O.8**).
> **Money-safe (regla dura):** una cifra que no existe **no se dibuja**, y sin gate cumplido el badge/entrada
> de vitrina **no se renderiza** — nunca **$0**, nunca un guion, y en un argumento de venta **ni siquiera
> «pendiente»**. Todo se deriva **server-side** (SEC-A1), **reforzado** porque el cliente ya ni recibe los
> insumos del cálculo. **Disclaimer completo = nota al pie** con **llamada (asterisco)** junto a la cifra, más
> un **micro-aviso mínimo adyacente** («ilustrativo» + «no evaluamos esta carta») *(decisión del PO, ver §O.5
> y pregunta abierta 12)*. **Desambiguación de alcance:** «Grading propio o integración directa con PSA/CGC»
> (Fuera de alcance) se refiere a **gradear cartas / verificar slabs nosotros**, **NO** a **mostrar estimados
> de valor por grado**, que **sí** entran al MVP. **PriceCharting sigue fuera.** **Disclaimer:** el humano
> pidió que sea **súper enfático en que es información ilustrativa y que NO refleja el estado de nuestras
> cartas** (no inspeccionamos ni pre-evaluamos la pieza que vendemos); texto ES/EN reescrito en **§O.5** y
> **aprobado por el dueño el 2026-08-31, sin revisión legal profesional** *(decisión 59; la revisión por
> abogado sigue **abierta** — pregunta abierta 1)*. La feature se entrega detrás de **un único interruptor**
> (`grading_hook_enabled`, semilla **apagado**) que **publica la afirmación comercial y autoriza el gasto en
> el mismo acto** *(decisión 60)*. Ver **§O** (nueva), §A, «Fuentes de precio», criterios **97–117**,
> decisiones **40–60** y las **preguntas abiertas v2.0** al final.
> **Requisito v2.0 — PRECIO PURO POR VALOR DE MERCADO (2026-08-24, DECISIONES DEL HUMANO YA TOMADAS —
> LOCKED, P-48):** el dueño detectó cartas publicadas a **MX$1.31 / MX$3.71** creyendo tener un **piso de
> MX$15**. La causa raíz fue doble: (a) una regla con `mode: 'fixed'` está **documentada como PISO** —y el
> editor de M2 la etiqueta literalmente **«Piso (MX$)»**— pero se implementa como **precio absoluto** (nunca
> se compara contra el mercado), y (b) el eje de **acabado** no consulta la regla del tier de su rareza, así
> que una variante sin regla propia cae al **`%` de respaldo**. Tras verlo, el humano **amplió el alcance**:
> en vez de parchar los dos ejes, **se retiran la rareza y el acabado del pricing** y el precio pasa a
> depender **solo del valor de mercado**, con **UNA curva** por eje:
> **`venta = redondeo↑( max( piso , mercado × markup(mercado) ) )`** y
> **`compra = max( bin , mercado × pct(mercado) )`**, con `markup` que **baja** conforme sube el valor y
> `pct` de compra que **sube**, ambos **interpolados** entre puntos de quiebre (nunca escalonados).
> Desaparecen los **5 tiers**, el **mapa rareza→tier**, las **reglas por acabado** y la distinción
> **`fixed` vs `pct`** como modos excluyentes. **La rareza no sale del sistema: sale del PRICING y entra a la
> VALIDACIÓN** — una carta de rareza **premium** que aterrice **en el piso** **no se publica** (cola de precio
> pendiente, se escala al dueño), que es el guardarraíl que sustituye al invariante `premium ⇒ pct`. Se suman
> **bounty revalidado contra la regla vigente** (un bounty por debajo de la tarifa estándar deja de ser
> bounty), la **escalera de redondeo hacia arriba** ($5 bajo $200 · $10 bajo $500 · $25 arriba) y la
> **instrumentación** de cada venta y cada compra (mercado del día, precio final, qué lo determinó, acabado y
> bracket). Se conserva la regla de que **el «Valor de mercado» solo se muestra cuando el mercado fijó el
> precio**. **Entrega: UN SOLO CAMBIO con etapas verificables y UN SOLO DEPLOY** — el paso intermedio
> («`fixed` pasa a ser piso» conservando tiers y reglas por acabado) **ya no se entrega por separado**, porque
> la curva **elimina el modo `fixed`** y ese código se tiraría; sigue siendo cierto como **comportamiento
> objetivo**, no como fase. **El negocio TODAVÍA NO ESTÁ EN VIVO**: no hay exposición viva que proteger, ni
> ventas ni cotizaciones reales afectadas. Ver **§N** (nueva), §A, §E.1, §M (superseded), criterios **79–96**
> y las **Decisiones (v2.0, P-48)** al final. **Bloque LOCKED — listo para el arquitecto.** Dos reglas
> money-safe quedaron **cerradas por el humano** (ya no son supuestos): **sin dato de mercado ⇒ «precio
> pendiente»** —no se publica ni se cotiza, el piso **no** gana (§N.2)— y el **guardarraíl aplica a los DOS
> ejes** (§N.5).
> **Decisión del dueño 2026-08-24 — SELLADO: son SIETE presentaciones, no cinco (`upc` 18 % · `collection`
> 22 %):** el dueño **confirmó que vende UPC** (Ultra Premium Collection) y **eligió los dos spreads que
> faltaban**: **`upc` = 18 %** (es la pieza más grande y cara del catálogo ⇒ mismo % que `box`) y
> **`collection` = 22 %** (comparable a un ETB ⇒ mismo % que `etb`). Salió a la luz porque un hueco de
> validación hacía que **no se pudiera capturar una pieza UPC en inventario** ni **fijarle precio** desde M2
> —ambas presentaciones caían al **global de respaldo (25 %)**, un número que nadie eligió para la pieza más
> cara que vendemos—; el hueco **ya está corregido**. Lo que faltaba era de **propiedad del documento**: los
> dos números vivían solo en `docs/API_CONTRACT.md` §M2 y en la semilla del código, mientras **§K seguía
> enumerando cinco**. Por la **regla de conflicto** (*PROJECT manda sobre el contrato*), el contrato no puede
> ser el **origen** de un número de negocio: debe **citarlo**. Con esta revisión **§K es el origen único** de
> la tabla de spreads y enuncia el **criterio que la ordena — «ítem más chico ⇒ % mayor»**; el resto del
> documento **deja de enumerar presentaciones a mano** y apunta a §K (las copias en prosa son las que se
> desincronizan, porque ningún test las mira). Tabla completa: **box 18 · etb 22 · bundle 25 · tin 30 ·
> blister 35 · upc 18 · collection 22**, global de respaldo **25**. **No se cambia ningún número ni el
> criterio** — esta revisión solo los **registra donde les toca**. Se cierran además dos cosas que salieron
> del mismo hilo: **(a) regla de negocio firme** — *toda presentación nueva llega con spread elegido a
> propósito, nunca cae al global en silencio* (era supuesto; el dueño lo confirmó, y es lo que evita repetir
> lo del UPC vendiéndose meses al 25 % porque nadie lo eligió); y **(b) corrección de REDACCIÓN de la
> fórmula**: donde el documento decía `mercado × spread` ahora dice **`mercado × (1 + spread)`** — el spread
> es un **markup ARRIBA del mercado** (caja de mercado MX$2,000 al 18 % ⇒ **MX$2,360**, no MX$360). **Eso NO
> cambió en agosto de 2026**: el código y el contrato siempre lo hicieron así; era taquigrafía heredada de
> v1.6 en el texto, y se corrige porque este documento manda sobre el contrato. La **fórmula queda con origen
> único en §K** y sus citas la referencian en vez de repetirla. Ver **§K**, criterios **3e/18/57/60/60b** y
> **decisiones 35/35b/35c/35d**.
> Este documento manda sobre el contrato y sobre el código (ver `CLAUDE.md` › Regla de conflicto).

## Idea en una frase
**TCG HUNT** es un marketplace de cartas Pokémon (TCG) en México que vende **cartas individuales** con
**precio de mercado visible** y una **BÓVEDA/CUSTODIA**: la plataforma guarda físicamente las
cartas compradas —autenticadas y con condición garantizada— y las envía solo cuando el usuario
lo pide, para completar colecciones sin envíos innecesarios.

## Problema que resuelve
Completar una colección de cartas hoy implica compras dispersas, envíos repetidos y caros, dudas
de autenticidad/condición y precios opacos. Este marketplace resuelve:
- **Precio real y transparente**: el precio de venta se **deriva del valor de mercado** de la carta (§N) y la
  ficha muestra ese **valor de referencia de mercado** *(actualizado v2.0: se muestra **cuando el mercado fue
  lo que fijó el precio**; en la zona de **piso** no se muestra, porque ahí el mercado no explica el precio —
  §N.7)*.
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
      muestra convertido a MXN, refresco diario. **Actualizado v2.0 (§N)**: el **precio de venta** deja de
      derivarse de reglas por rareza/acabado y pasa a la **curva por valor de mercado** (§N.1), y el bloque
      **"Valor de mercado" solo se muestra cuando el precio publicado lo determinó el MERCADO**; si lo
      determinó el **piso** o un **override manual**, **no se muestra** (§N.7). Fuente según tipo de producto
      (ver "Fuentes de precio" en Restricciones técnicas):
      - **raw / singles**: TCGPlayer "Market Price" vía **pokemontcg.io**.
      - **gradeadas (PSA/CGC)**: **PokemonPriceTracker** o **PokeTrace** (free tier), con **override
        manual del admin** siempre disponible como respaldo.
      - **sellado** *(actualizado v1.6)*: **precio de venta DERIVADO del precio de mercado de TCGCSV** (vía
        el mapeo curado existente), con la precedencia money-safe `override manual > spread por presentación >
        spread global de respaldo > sin precio ⇒ no se publica (PRICE_PENDING)` (fórmula en §K).
        TCGCSV es la **base del precio del sellado** (ya no "solo informativa"); el **override manual** sigue
        siendo la máxima precedencia. Ver §K. *(Supersede la decisión previa "sellado = precio manual".)*
- [ ] Tipos de producto vendibles: **gradeadas (PSA/CGC)** (el **slab** es la garantía: se muestra
      **empresa + grado + número de certificado**, verificable en la web de la graduadora; se captura
      `certNumber`), **producto sellado** (sets cerrados: booster box, ETB, bundle, tin, blister, **UPC**
      —Ultra Premium Collection— y colección; las **siete presentaciones** están en §K) y
      **raw en Near Mint (NM)** (**estándar de condición propio**, sin foto). **La ficha usa la imagen de
      catálogo de pokemontcg.io**; el producto no lleva fotos propias.
- [ ] **Venta de producto sellado** *(actualizado v1.6, ver §K)*: se vende en Compra con **precio de venta
      DERIVADO** de la referencia TCGCSV por spread (precedencia `override manual > spread por presentación >
      spread global > PRICE_PENDING`, fórmula en §K); es **solo venta** (plataforma→cliente, **sin
      buylist de sellado**); **sin rareza**, pero **con condición propia** (default Mint, opción "Detalle
      menor en caja"; visible al comprador y **sin efecto en el precio**). Como en Compra solo se lista lo que
      tiene precio, un sellado en **PRICE_PENDING** (sin override y sin spread aplicable) **no se publica**.
- [ ] Solo se prician las cartas **que tenemos en bóveda** (no el catálogo completo), con **cache diario**,
      para que los free tier alcancen.
- [ ] Cartas sin precio en la web de referencia: quedan en estado **"precio pendiente"** en
      adquisición/buylist/back-office y **NO se publican en Compra** hasta que el dueño les fija precio a
      mano (el comprador nunca ve "precio pendiente").
- [ ] **Valor estimado si se gradea — «gancho de grading»** *(NUEVO v2.0, ver §O)*: sobre una carta **raw**
      publicada, la tienda muestra **el precio de la carta + cuánto vale estimado en PSA 10 y en PSA 9**, en
      **cuatro superficies** *(actualizado 2026-08-31)*: **ficha**, **badge en las tejas de Compra**,
      **vitrina «Joyas para gradear» en el home** y **burbuja en el carrusel «Piezas destacadas del catálogo»
      del home** (las dos secciones del home **se conservan**: el humano quiere las dos).
      **Solo eso: sin multiplicador, sin ganancia calculada, sin comparativa** *(simplificación 2026-08-23)*.
      Es un **estimado ilustrativo con disclaimer obligatorio** —**nunca** un precio de venta ni una promesa de
      grado—. El **gate de ROI sobre PSA 9** (§O.2) es **criterio de curaduría interno**: la **ficha** muestra
      lo que haya, y las **superficies de promoción** (teja de Compra, vitrina y destacadas) solo llevan cifra
      en cartas que pasan el gate. **La cifra SÍ se pinta en la
      rejilla, en la vitrina y en destacadas** *(2026-08-28 / 2026-08-31)*, pero solo si además **supera el gate de confianza** (§O.7):
      dato **fresco**, de **origen confiable** y **coherente en magnitud**. **Money-safe**: una cifra que no
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
      - **⚠ SUPERSEDED por §N (v2.0)**: la cotización **ya no depende de la rareza ni del acabado**. El
        cotizador sigue igual como **flujo** (el vendedor elige carta y captura acabado, la condición sigue
        fija en NM), pero el monto sale de la **curva de compra** `max(bin, mercado × pct(mercado))` sobre el
        **precio de mercado del acabado cotizado**. El acabado **sigue capturándose** porque define **de qué
        variante** se toma el mercado (§N.4).
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
> **⚠ SUPERSEDED por §N (v2.0, LOCKED):** el precio de compra **ya no depende de la rareza ni del acabado**.
> Desaparecen la tabla por rareza, los tiers, las reglas por acabado y la distinción `fixed`/`pct`: queda
> **una curva por valor de mercado** (`compra = max(bin, mercado × pct(mercado))`, §N.1). Lo único que
> **sobrevive** de esta sección es el principio money-safe de **«sin dato ⇒ precio pendiente, jamás MX$0 ni
> precio inventado»** y la **derivación server-side** (SEC-A1). Se conserva abajo como **registro histórico**
> de por qué el sistema llegó a donde está.
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
        *(Retirado en v2.0, §N.1: el modo `fixed` desaparece; su papel lo toma el **bin único de compra**
        —un solo valor global, no por rareza ni por acabado— dentro de `max(bin, mercado × pct(mercado))`.)*
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
      spread por presentación > spread global > PRICE_PENDING`, fórmula en §K), **override manual** de
      precio siempre disponible (máxima precedencia), **editor de spreads del sellado por presentación**
      (**las siete presentaciones** + el global de respaldo; la tabla y sus valores viven en **§K**, que es su
      origen único), **cache diario**, **tipo de cambio USD→MXN con colchón**
      configurable, y **editor de la curva de precio por valor de mercado** *(v2.0, §N.3 — supersede el editor
      «por rareza / por tier»)*: **tabla de puntos de quiebre** de venta y compra donde el dueño puede
      **agregar, mover y borrar** renglones, más **piso**, **bin** y **escalera de redondeo**, con las
      **validaciones** de §N.3. **Sync de catálogo** desde la fuente de referencia (pokemontcg.io):
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
> **⚠ Actualizado por §N (v2.0):** el acabado **deja de tener regla de precio propia** — el mapeo «acabado →
> regla de buylist» de esta sección queda **superseded** por la **curva por valor de mercado** (§N.1), y
> `finishRules` se retira. **Todo lo demás de §I sigue VIGENTE**: el acabado sigue siendo la **identidad de la
> variante** (inventario, overrides, bounties, `availableFinishes`, ficha, bóveda, filtros y captura en el
> cotizador), y el **precio de mercado por acabado** se sigue usando — es precisamente el **`mercado` que
> alimenta la curva**. **No se elimina el acabado del modelo** (§N.4).
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
> **Qué es**: el **producto sellado** (booster box, ETB, bundle, tin, blister, **UPC**, colección — las
> **siete presentaciones** de la tabla de spreads, abajo) se consolida aquí con las
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
      HUNT? Escríbenos a **contacto@tcghunt.mx** con fotos y lo cotizamos."* Es un enlace de correo,
      **no** un flujo dentro de la app. *(Corregido 2026-08-31: el call-out usa `contacto@tcghunt.mx`. La
      versión anterior de este documento decía `contacto@tcgvaultmx.com` y afirmaba que las disputas vivían en
      otro dominio (`tcgvault.mx`) y que **ambos eran correctos y no se unificaban**: eso era falso. **Todos
      los buzones están en el único dominio `tcghunt.mx`** — ver decisión 36.)*

**Precio de venta derivado (money-safe, server-side)** — ⚠️ **ORIGEN ÚNICO de la fórmula**
> **La fórmula y la precedencia se definen AQUÍ una sola vez.** El resto del documento nombra la
> **precedencia** (qué regla gana) y **apunta a §K** para la aritmética; **no la repite**. Una fórmula de
> dinero copiada quince veces es la próxima contradicción esperando — es la misma razón por la que la tabla
> de spreads también tiene un solo origen.

- [ ] El **precio de venta del sellado** se **deriva del precio de mercado de TCGCSV** (vía el **mapeo curado**
      ya existente entre nuestro producto sellado y el ítem de TCGCSV) con esta **precedencia** estricta:
      1. **override manual** del admin (máxima precedencia; siempre disponible),
      2. **spread por presentación** ⇒ `precio = mercado × (1 + spread)` con el spread de su presentación
         (**tabla de spreads**, abajo),
      3. **spread global de respaldo** ⇒ `precio = mercado × (1 + global)`, cuando no aplica un spread por
         presentación,
      4. **sin precio** ⇒ el ítem queda en **PRICE_PENDING** y **NO se publica** en Compra.
- [ ] **El spread es un MARKUP ARRIBA del mercado, no una fracción del mercado.** Con `box` al **18 %**, una
      caja cuyo mercado es **MX$2,000** se vende en **MX$2,360** (`2,000 × 1.18`) — **no** en MX$360. Es la
      misma semántica que el markup de venta de las cartas, y es **distinta** de la del buylist (donde el `%`
      sí es "% de la referencia", §E.1).
      > **📌 Corrección de REDACCIÓN, no de semántica (2026-08-24, autorizada por el dueño).** Hasta esta
      > fecha §K y sus citas escribían la fórmula como `mercado × spread`, que leída al pie significa
      > `mercado × 0.18` — es decir, **vender la caja a MX$360**. Era **taquigrafía heredada de la redacción
      > de v1.6**: el código (`money.ts`) y el contrato (`API_CONTRACT §M2`, *"markup % ARRIBA de mercado"*)
      > **siempre** hicieron `mercado × (1 + spread)`. **NO cambió ningún precio, ni el markup, ni la
      > matemática en agosto de 2026**: lo único que cambió es que el documento rector ahora **dice** lo que
      > el sistema **siempre hizo**. Se corrige porque `PROJECT.md` manda sobre el contrato (`CLAUDE.md` ›
      > Regla de conflicto), así que una fórmula mal escrita aquí es la versión que gana.
- [ ] **TCGCSV es la BASE del precio del sellado** (deja de ser "solo informativa"). Este cambio **aplica
      únicamente al sellado**; el precio de **cartas sueltas (raw/singles)** sigue calculándose como hoy
      (pokemontcg.io/TCGPlayer + markup) y **TCGCSV no se usa como su fuente**.
- [ ] El precio derivado se **calcula server-side** (no se toma del cliente), consistente con la protección
      anti-manipulación existente (SEC-A1).

**Spreads configurables por presentación (ConfigSetting)** — ⚠️ **ORIGEN ÚNICO de estos números**
> Esta tabla es **la fuente de verdad** de los spreads del sellado. El contrato (`API_CONTRACT §M2`) y la
> semilla del código **la citan**; no la originan. Cualquier otra mención en este documento debe **apuntar
> aquí** en vez de volver a enumerar las presentaciones: las copias en prosa se desincronizan porque
> ningún test las mira (fue exactamente lo que pasó con `upc` y `collection`, ver abajo).

- [ ] Los spreads son **diales configurables** (ConfigSetting, editables sin deploy y auditados en M10),
      **uno por presentación** más un **global de respaldo**. Son **siete presentaciones** (no cinco).
      **Semillas** (editables por el dueño en M2), en esta tabla:

| Presentación | Spread semilla | Origen |
|---|---|---|
| `box` (booster box) | **18 %** | v1.6 (2026-08-19) |
| `etb` (Elite Trainer Box) | **22 %** | v1.6 (2026-08-19) |
| `bundle` | **25 %** | v1.6 (2026-08-19) |
| `tin` (lata) | **30 %** | v1.6 (2026-08-19) |
| `blister` | **35 %** | v1.6 (2026-08-19) |
| **`upc`** (Ultra Premium Collection) | **18 %** | **decisión del dueño, 2026-08-24** (= `box`) |
| **`collection`** (caja/set de colección) | **22 %** | **decisión del dueño, 2026-08-24** (= `etb`) |
| **global de respaldo** | **25 %** | v1.6 (2026-08-19) |

- [ ] **Criterio que ordena la tabla (enunciado, para ubicar cualquier presentación futura): «ítem más chico
      ⇒ % mayor».** El orden `box 18 < etb 22 < bundle 25 < tin 30 < blister 35` no es arbitrario: en una
      pieza **grande y cara** un porcentaje gordo se vuelve un **monto absoluto** que mata la venta; en una
      pieza **barata** hace falta un porcentaje mayor para que el margen absoluto **pague el manejo y el
      envío**. De ahí salen los dos valores nuevos: un **UPC** es la pieza **más grande y cara** del
      catálogo ⇒ va con `box` (**18 %**); una **`collection`** es comparable a un **ETB** ⇒ va con `etb`
      (**22 %**).
- [ ] **`upc` y `collection` — decisión del dueño del 2026-08-24 (el dueño SÍ vende UPC).** Se registran
      aquí porque hasta v1.6 este documento solo enumeraba **cinco** presentaciones, y esas dos **caían al
      global de respaldo (25 %) por omisión** — un número que nadie eligió para la pieza más cara del
      catálogo. Peor: por un hueco de validación **no se podía capturar una pieza UPC en inventario** ni
      **fijarle spread** desde M2. El hueco ya está corregido; lo que faltaba era que la **decisión de
      negocio** viviera en este documento y no solo en el contrato y el seed.
- [ ] **REGLA DE NEGOCIO (firme, confirmada por el dueño el 2026-08-24) — toda presentación nueva llega con
      spread elegido a propósito; NUNCA cae al global en silencio.** Agregar una presentación al catálogo
      **incluye elegirle su spread**: es parte del alta, no un paso opcional. El **global de respaldo es una
      EXCEPCIÓN explícita**, no el destino de lo que nadie pensó — solo aplica a una pieza **sin presentación**
      o a una regla que el dueño **retiró deliberadamente**.
      > **Por qué es regla y no recomendación (razón del dueño):** es exactamente lo que evita que se repita
      > lo del **UPC**, que llevaba **meses vendiéndose al 25 %** porque **nadie lo eligió** — el default
      > silencioso no se ve, no duele y no avisa. **La máquina ya lo sostiene**: backend ancló la cobertura de
      > **todos** los `SealedSubtype` con un test, así que un subtipo nuevo **rompe el test** y obliga a
      > elegirle spread a propósito. Regla y máquina ya coinciden; esto solo lo deja escrito en el documento
      > rector.
      *(SUPUESTO: las etiquetas legibles en español de cada presentación —"lata", "caja de colección"— son
      del sistema de diseño/UI, no de este documento; aquí solo se fija la llave y su spread.)*
- [ ] **📌 Nota para ux-ui (próximo ciclo, no bloquea) — choque de nomenclatura con «Collection».** La palabra
      tiene **dos acepciones no relacionadas** en este producto y ambas van a querer llamarse "Colección" en
      pantalla: (a) **`collection`**, la **presentación sellada** de esta tabla (una caja/set de colección,
      spread 22 %), y (b) **"Classic Collection"** de **§L**, que es un **subset de cartas** de un master set
      multi-parte (Celebrations `cel25c`). Son cosas distintas —producto cerrado vs. agrupación de catálogo— y
      un filtro o etiqueta ambigua las confundiría. Que ux-ui les fije nombres visibles distintos en el
      siguiente ciclo; aquí solo queda anotado el riesgo.

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
> **⚠ SUPERSEDED COMPLETO por §N (v2.0, LOCKED).** Los **5 tiers**, el **mapa rareza→tier**, las **reglas por
> acabado** y los modos **`fixed`/`pct`** **se retiran**: el precio pasa a depender **solo del valor de
> mercado** (§N.1). El invariante money-safe de esta sección (**`premium ⇒ pct`**, M.4) queda **sin sentido**
> y lo **sustituye el guardarraíl de §N.5**: una carta de rareza **premium** que aterrice en el **piso** **no
> se publica** (cola de precio pendiente). Lo que **sobrevive**: la rareza **canónica** (`rarity-catalog.ts`)
> y su marca `premium` siguen existiendo como **dato del catálogo** —se usan para el **guardarraíl**, filtros
> y presentación—, **pero ya no calculan precio**. Los **criterios 73–78** quedan **superseded** por los
> **79–96**. Esta sección se conserva como **registro histórico** de la taxonomía previa.
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
> **⚠ Retirado en v2.0 (§N.1)**: esta tabla de tiers **desaparece**. Ninguno de sus valores (T0 $0.50, T1
> $1.50, T2 25%, T3/T4 40%) sobrevive: los sustituyen el **piso único**, el **bin único** y las **curvas de
> `markup` y `pct`** por valor de mercado (§N.2).
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

### N. Precio puro por valor de mercado (transversal — v2.0, P-48, LOCKED)
> **Qué es**: el precio de una carta pasa a depender **solo de su valor de mercado**. Se **retiran del
> pricing la rareza y el acabado**: ya no hay dos ejes, ni precedencia entre ejes, ni mapa de ~30 rarezas → 5
> tiers, ni `finishRules`. Desaparece también la distinción **`fixed` vs `pct`** como modos excluyentes:
> queda **UNA curva** por eje de dinero. **§M (tiers) y la tabla por rareza de §E.1 quedan superseded.**
> **Contexto**: el dueño vio cartas publicadas a **MX$1.31** y **MX$3.71** creyendo tener un **piso de
> MX$15**. Causa doble: (a) `mode: 'fixed'` está documentado como **PISO** y el editor de M2 lo etiqueta
> **«Piso (MX$)»**, pero se comporta como **precio absoluto** —devuelve el valor configurado y **nunca lo
> compara contra el mercado**—; y (b) el eje de **acabado** no consulta la regla del tier de su rareza, así
> que una variante sin regla propia cae al **`%` de respaldo** y el piso ni siquiera participa. Efecto vivo:
> una **Common** que vale $400 se **vende en $15** y en **buylist se paga $0.50**; y una carta barata se
> publica en **$1.31** aunque haya un piso configurado. El invariante «premium ⇒ `pct`» (§M.4) no tapa nada de
> esto, porque **Common no es premium**.
> **Por qué se amplió el alcance**: parchar los dos ejes (hacer que `fixed` sea piso de verdad) **arregla solo
> la mitad** y deja en pie la complejidad que produjo el error. La curva por valor de mercado elimina la clase
> entera de bugs: no hay reglas que resolver, no hay ejes que se pisen, no hay rarezas sin mapear.
> **El negocio todavía NO está en vivo**: no hay ventas ni cotizaciones de clientes reales afectadas, así que
> **no hay exposición viva que proteger**, no se requiere migración de dinero ni comunicación a clientes, y
> **no hace falta entregar el paso intermedio por separado** (ver N.9).
> **Alcance de esta feature**: la **matemática del precio** de **cartas sueltas** (raw **y gradeadas**) en sus
> dos ejes de dinero (venta y compra/buylist), el **editor** que la configura, el **guardarraíl** de
> validación, la **revalidación del bounty**, la **regla de visibilidad** del valor de mercado en la ficha, y
> la **instrumentación** de cada operación. El **cómo** (schema, migración, nombres de campos, forma del
> contrato) lo define el **arquitecto**.

**N.0 — Principio de sesgo de error (gobierna toda decisión de precio, presente y futura)**
- [ ] **Precio de más = venta perdida (recuperable); precio de menos = carta perdida (irrecuperable).** Una
      carta publicada cara no se vende hoy y se puede rebajar mañana; una carta vendida barata o comprada
      barata **ya no vuelve**. Por eso **toda regla de precio se sesga hacia el primer error**: ante empate o
      duda entre dos precios, gana el más alto en venta y el más alto en compra. Este principio es **norma de
      producto**, no una preferencia estética: cualquier regla futura de pricing debe poder justificarse
      contra él.

**N.1 — La curva única: el precio sale del valor de mercado (LOCKED)**
> Un solo cálculo por eje, sin rareza, sin acabado, sin tiers y sin modos excluyentes:
>
>     venta  = redondeo↑( max( piso , mercado × markup(mercado) ) )
>     compra =            max( bin  , mercado × pct(mercado)    )
>
- [ ] **`markup(mercado)` BAJA conforme sube el valor** (margen grueso en cartas baratas, delgado en cartas
      caras) y **`pct(mercado)` de compra SUBE** (se paga proporcionalmente más por lo que vale más).
- [ ] **Interpolación obligatoria, nunca escalones**: entre dos puntos de quiebre el valor se **interpola**
      (lineal). **Prohibido** un tramo plano/escalonado: un escalón produce **saltos de precio** entre dos
      mercados casi iguales y, **arriba de ~$25 de mercado, es matemáticamente imposible sin vender por
      debajo del mercado**. Los tramos **antes del primer punto y después del último** sí son planos (se
      extiende el valor del extremo).
- [ ] **El piso y el bin son ÚNICOS y globales**: **un** piso de venta y **un** bin de compra para todo el
      catálogo de cartas — **no** por acabado, **no** por rareza, **no** por tier. El humano **aceptó
      explícitamente** que quitar el piso diferenciado por acabado cuesta **~2% de utilidad** y **no vale su
      complejidad**.
- [ ] **El redondeo hacia arriba aplica SOLO a la venta** (N.2). La **compra no se redondea**.
- [ ] **Derivación server-side (SEC-A1) intacta**: el mercado y el precio se derivan **siempre en el backend**
      a partir del dato real de la variante; **nunca** del DTO del cliente.
- [ ] **Money-safe**: el precio **jamás se inventa**. **Sin dato de mercado no hay curva y no hay piso: la
      variante queda en «precio pendiente»** (N.2), y el **guardarraíl** de N.5 cubre el caso del dato **malo**
      (presente pero corrupto).
- [ ] *(Comportamiento objetivo que esta curva absorbe)*: el **piso es piso de verdad** (el `max` lo garantiza
      en los dos ejes) y **la compra sube donde el mercado supera el bin** —una Common de $400 deja de
      recibir $0.50—. Eso **ya no se entrega como fase aparte**: llega dentro de la curva (N.9).

**N.2 — Diales iniciales y escalera de redondeo (LOCKED; son DIALES, no constantes de código)**
> Todos estos valores son **calibrables desde admin** (N.3), **en MXN**, y **arrancan** así:

| Dial | Valor inicial |
|---|---|
| **Piso de venta** | **MX$25** (único, global) |
| **Curva de `markup` (venta)** | **1.60×** hasta **$25** de mercado → **baja lineal** hasta **1.15×** en **$80** → **1.15×** de ahí en adelante |
| **Bin de compra** | **MX$1** (único, global) |
| **Curva de `pct` (compra)** | **30%** hasta **$25** → **40%** en **$100** → **50%** en **$500** → **50%** de ahí en adelante |
| **Redondeo↑ de venta (decisión 5)** | múltiplo de **$5** por debajo de **$200** · **$10** por debajo de **$500** · **$25** de ahí en adelante |

- [ ] **El paso de $5 llega hasta $200, no hasta $100** *(decisión 5, corrección explícita)*: con la escalera
      anterior, un mercado de **$86** producía **$100** y uno de **$87** producía **$110** — un **brinco
      injustificado** por cruzar el umbral. Con $5 hasta $200, **$87 ⇒ $105**.
- [ ] **Ejemplos de referencia (con los diales iniciales; sirven de prueba de mesa)**:
      mercado **$1.14 ⇒ venta $25** (gana el piso) · **$25 ⇒ $40** · **$50 ⇒ $70** (markup interpolado
      ≈1.3955 ⇒ 69.77 ⇒ ↑$5) · **$80 ⇒ $95** (92 ⇒ ↑$5) · **$86 ⇒ $100** · **$87 ⇒ $105**.
      Compra: mercado **$0.50 ⇒ $1** (gana el bin) · **$10 ⇒ $3** · **$25 ⇒ $7.50** · **$100 ⇒ $40** ·
      **$300 ⇒ $135** (pct interpolado 45%) · **$500 ⇒ $250**.
- [ ] *(SUPUESTO — confirmar, ver preguntas abiertas v2.0)*: **la banda de redondeo la decide el monto de
      venta ANTES de redondear**, y se elige **una sola vez** (si el redondeo cruza el umbral, no se
      re-evalúa). Bandas: `< $200` ⇒ $5; `$200 ≤ x < $500` ⇒ $10; `≥ $500` ⇒ $25.
- [ ] **SIN DATO DE MERCADO ⇒ «PRECIO PENDIENTE» (LOCKED — decidido por el humano, money-safe):** si la
      variante **no tiene precio de mercado**, **no se publica y no se cotiza**. **El piso NO gana**: sin
      mercado no hay curva, y el piso **no** actúa como precio de respaldo. La variante entra a la **cola de
      precio pendiente** y se **escala al dueño**, en venta **y** en compra. **Nunca MX$0, nunca un precio
      inventado.**
- [ ] **Por qué el piso no puede rescatar a una carta sin dato** *(razón que gobierna, conviene tenerla
      escrita)*: el único filtro que quedaría para atrapar el error sería el **guardarraíl**, y el guardarraíl
      **se apoya en la rareza** — justamente **el proxy malo que este cambio retira del pricing**. Atraparía
      una **Secret Rare** con dato corrupto, pero **no** una **Common de $400 sin dato**, que se publicaría
      **al piso de $25**. Eso sería **reabrir el hueco exacto que esta feature cierra** (§N contexto: la
      Common de $400 vendida en $15). Por eso el respaldo ante la **ausencia** de dato es **detenerse**, no
      poner un número.
- [ ] **Ojo con la diferencia (no confundir los dos casos)**: **dato AUSENTE ⇒ precio pendiente** (esta
      regla); **dato PRESENTE pero malo** (aplanado, absurdo, demasiado bajo) ⇒ la curva sí calcula y puede
      aterrizar en el **piso**, y ahí es donde actúa el **guardarraíl** de N.5.

**N.3 — La tabla de puntos se edita desde admin (LOCKED — requisito explícito del humano)**
- [ ] **Agregar, mover y borrar renglones**: el súper-admin administra los **puntos de quiebre** de las dos
      curvas (`markup` de venta y `pct` de compra) desde el back-office: puede **añadir** un punto nuevo,
      **moverlo** (cambiar su mercado o su valor) y **borrarlo**. **NO es una estructura fija de N puntos**:
      la curva es tan fina o tan gruesa como el dueño quiera.
- [ ] **Sin redeploy y auditado** (M10), como el resto de los diales; un cambio **repricia** todo lo afectado
      en el siguiente cálculo.
- [ ] **Validaciones que el sistema debe imponer al guardar** (money-safe; si algo falla, **no se guarda** y
      el error dice **qué punto** lo rompe):
      - la **curva de venta resultante es monótona creciente** — más mercado **nunca** produce menos precio;
      - la **compra siempre queda por debajo de la venta** en todo el rango;
      - **ningún precio de venta cae por debajo del mercado**.
- [ ] También son editables el **piso**, el **bin** y la **escalera de redondeo**.

**N.4 — Qué sale del pricing y qué NO se toca (leer con cuidado)**
- [ ] **Sale del pricing: la RAREZA.** Ningún cálculo de precio la consulta. **No desaparece del sistema**:
      la rareza canónica y su marca `premium` siguen existiendo como **dato del catálogo** y se usan para el
      **guardarraíl** (N.5), los **filtros** y la **presentación**.
- [ ] **Sale del pricing: el ACABADO.** Ya no existe una **regla de precio por acabado** (`finishRules`).
      **⚠ El acabado NO se elimina del modelo**: sigue siendo la **identidad de la variante**. Siguen siendo
      **por acabado** el **inventario**, los **overrides**, los **bounties** y `availableFinishes`, y la ficha
      y la bóveda **siguen mostrando** el acabado. Lo único que desaparece es que el acabado **tenga regla de
      precio propia**. *(Se redacta así de explícito para que nadie interprete «el acabado sale del pricing»
      como «bórrese el acabado del modelo».)*
- [ ] **Aplica igual a raw y a GRADEADAS** (confirmado por el humano): misma curva, mismo piso, mismo bin. El
      **slab** sigue siendo la garantía de condición (§H) y la **fuente** de su precio de mercado sigue siendo
      la suya (§«Fuentes de precio»); lo que cambia es **cómo se convierte ese mercado en precio**.
- [ ] **El SELLADO NO cambia**: conserva su **spread por presentación** (§K) — precedencia `override manual >
      spread por presentación > spread global > PRICE_PENDING`, con **la fórmula y las semillas de §K** (las
      **siete** presentaciones + global de respaldo). El sellado **no entra a la curva**.
- [ ] **Tampoco cambian**: el resto de §K, la **bóveda/portafolio** y su valuación (§C), el **cotizador** como
      flujo (§E), la política de **«precio pendiente»** (§H) ni la **derivación server-side** (SEC-A1).

**N.5 — Guardarraíl: la rareza sale del pricing y entra a la VALIDACIÓN (LOCKED)**
> Sustituye al invariante **`premium ⇒ pct`** de §M.4, que con la curva **queda sin sentido** (ya no hay
> modos). Sin guardarraíl, **un dato de mercado malo en una carta cara la vendería al piso**, que es
> exactamente la **pérdida irreversible** que el principio de N.0 manda evitar.
- [ ] **Regla — aplica a los DOS EJES (LOCKED, confirmado por el humano; ya no es supuesto)**: si una carta
      de **rareza premium** (catálogo canónico de rarezas) **aterriza en el piso o en el bin**:
      - **VENTA**: **no se publica** — entra a la **cola de precio pendiente** y se **escala al dueño**;
      - **COMPRA**: **no se cotiza** — misma cola, mismo escalado (ofrecer el bin de $1 por una chase es
        **pagar de menos = carta perdida**, la pérdida irreversible de N.0).
      En ambos casos se libera cuando el **siguiente barrido** corrija el dato de mercado (o el dueño fije el
      precio a mano).
- [ ] **Por qué funciona**: que una chase resuelva al **piso/bin** solo puede significar que **su dato de
      mercado está mal** (aplanado, absurdo o demasiado bajo). El guardarraíl convierte un error de dinero
      silencioso en una **cola visible**.
- [ ] **Qué NO cubre el guardarraíl (por eso existe la regla de N.2)**: el caso del **dato ausente**. El
      guardarraíl **se apoya en la rareza**, que es el **proxy malo** que este cambio retira del pricing:
      atraparía una Secret Rare con dato corrupto, pero **dejaría pasar una Common de $400 sin dato**
      publicándola al piso. Por eso la **ausencia** de dato se resuelve **antes**, con «**precio pendiente**»
      para **todas** las rarezas (N.2), y el guardarraíl solo se ocupa del **dato presente pero malo**.
- [ ] **Volumen esperado**: medido sobre un **master set completo**, ≈ **3 cartas de 333**. **No es una alarma
      ruidosa** y por eso puede bloquear publicación y cotización sin entorpecer la operación.

**N.6 — Precedencia, override y bounty revalidado (decisión 4, LOCKED)**
- [ ] **Precedencia de VENTA**: `override por pieza > override de variante > curva (piso / mercado) >
      precio pendiente`.
- [ ] **Precedencia de COMPRA**: `bounty válido > override de compra > curva (bin / mercado) >
      precio pendiente`.
- [ ] **El override manual de compra SIGUE SIENDO ABSOLUTO**: puede quedar **por debajo** de la regla vigente
      —es una **decisión deliberada del admin** para esa variante— y **NO se convierte en piso**. Lo mismo
      aplica a los overrides de venta.
- [ ] **Qué es el bounty (contexto de negocio)**: es la **sección de ofertas** del dueño para **animar a la
      gente a vender**. Vive en la **escala de COMPRA** (30–50% del mercado) y por definición está **siempre
      por debajo del mercado**: **nunca se compara contra el mercado**, solo **contra la regla de compra**.
      Ya existe (variante + cupo `bountyTargetQty` + vitrina en Home y en Vender + precedencia #1 en compra +
      guard `BOUNTY_BELOW_RULE` al crear).
- [ ] **El hueco que se cierra**: hoy `BOUNTY_BELOW_RULE` se valida **solo al crear**. Si después **sube el
      mercado** y la regla estándar **rebasa** al bounty, la «oferta» publicada **paga MENOS que la tarifa
      normal** y aun así **sigue publicada y ganando la precedencia**.
- [ ] **Regla nueva**: un bounty **por debajo de la regla vigente deja de ser bounty**:
      - **no aplica en la cotización** (se paga la regla estándar),
      - **no se publica en la vitrina** (ni Home ni Vender),
      - **genera alerta en el binder** para que el dueño lo actualice.
      Se valida **al CREAR, al COTIZAR y al PUBLICAR** (las tres, no solo la primera).
- [ ] **Efecto buscado**: **el número publicado es exactamente lo que se paga**, y **todo lo que aparece en la
      vitrina es por definición mejor que la tarifa estándar**.

**N.7 — «Valor de mercado» solo se muestra cuando el mercado fijó el precio (decisión 2, LOCKED)**
- [ ] **Regla (solo lado VENTA)**: en la ficha de producto, el bloque **«Valor de mercado»**
      - **se muestra** si el precio publicado lo determinó el **mercado**;
      - **NO se muestra** si el precio publicado lo determinó el **piso** (el piso ganó el `max`) **ni** si lo
        determinó un **override**.
- [ ] **Por qué**: en zona de piso el mercado **no fue lo que produjo el precio**, así que el número **no
      explica nada**. Con un piso alto, mostrar «venta $25 / mercado $1.14» publica un **múltiplo de 22×**
      sin informar al comprador.
- [ ] **No se muestra = no aparece**: nada de mostrarlo en cero, tachado, atenuado o como «—». El bloque
      **desaparece** de la ficha; el precio de venta queda como el único número de esa zona.
- [ ] **Aplica SOLO a la ficha** (respuesta del humano): la **ficha de carta** (Compra) y la **ficha/ventana
      de sellado**. Las **tejas y listados no muestran** valor de mercado hoy **y no van a mostrarlo**. Para
      el **sellado**, la regla se traduce así: precio derivado por **spread sobre mercado** ⇒ **se muestra**;
      precio fijado por **override manual** ⇒ **no se muestra** (§K).
- [ ] **Empate ⇒ se muestra**: si `piso == mercado × markup`, el precio se considera **determinado por el
      mercado** y el valor de mercado **sí** se muestra. (Desempate fijado para que la regla sea determinista
      y verificable.)
- [ ] **La señal la produce el backend — `priceBasis` (respuesta del humano: SÍ se necesita)**: el sistema
      **registra y expone server-side qué determinó el precio**, con estos valores:
      **`mercado` / `piso` / `override` / `bounty` / `pendiente`**. La UI **no infiere** nada comparando
      números en pantalla: **obedece** ese dato. Es lo que hace **visible el guardarraíl** (N.5) y lo que
      permite **detectar pisos mal calibrados** desde el back-office. *(El nombre exacto y la forma del campo
      los define el arquitecto.)*
- [ ] **Qué NO cambia**:
      - el **cotizador de buylist** sigue **sin** mostrar valor de mercado (solo lo menciona en el
        subtítulo) — **no se toca**;
      - la **bóveda / portafolio del cliente NO cambia**: ahí el cliente ve el **valor de mercado de lo que ya
        posee**, y eso es correcto y deseable (valuación, gráfica de tendencia y §C intactos);
      - una carta en **«precio pendiente»** sigue **sin publicarse** en Compra (§A) y el comprador **nunca**
        ve ese estado — y bajo la curva llegan ahí **dos casos**: **sin dato de mercado** (N.2, cualquier
        rareza) y **premium aterrizando en el piso/bin** (N.5);
      - el **precio cobrado** no cambia por esta regla: es una regla de **presentación**, no de dinero.

**N.8 — Instrumentación: medir para poder calibrar (requisito nuevo, LOCKED)**
> **Por qué**: hoy **no se puede contestar «¿qué tan rápido rota cada bracket?»**, y ese es justamente el dato
> que falta para **calibrar la curva con realidad en vez de con supuestos**. Los valores de N.2 son un punto
> de partida informado, no una verdad: sin medición no hay forma de saber si el 1.60× de la banda baja frena
> las ventas o si el 1.15× de la banda alta deja utilidad en la mesa.
- [ ] **Cada VENTA y cada COMPRA registran**: **mercado del día**, **precio final**, **qué lo determinó**
      (`priceBasis`, N.7), **acabado** y **bracket de mercado**.
- [ ] El registro debe permitir **agregar por bracket** para responder preguntas de rotación y margen
      («cuánto vendí, a qué velocidad y con qué margen en cada bracket»), y es la entrada de la **calibración
      futura** de la curva.
- [ ] Es un **requisito de producto**, no una métrica de vanidad: sin él, cada ajuste de la curva vuelve a ser
      una corazonada.

**N.9 — Entrega: UN SOLO CAMBIO, con etapas verificables (LOCKED)**
- [ ] **No se despliegan por separado** el paso intermedio («`fixed` pasa a ser piso real en los dos ejes»,
      conservando tiers y reglas por acabado) ni la regla de visibilidad. **Se funden con la curva en un solo
      cambio con etapas verificables y UN SOLO DEPLOY.**
- [ ] **Por qué**: (a) **no hay exposición viva que proteger** —el negocio no está en vivo—, y (b) la curva
      **elimina el modo `fixed` por completo**, así que el código del paso intermedio **se tiraría**. Sigue
      siendo cierto como **comportamiento objetivo** (el piso es piso; la compra sube donde el mercado supera
      el bin), pero **deja de ser una fase entregable**.
- [ ] **Se retira del producto (sin residuos)**: los modos **`fixed`/`pct`** como reglas excluyentes, los **5
      tiers**, el **mapa rareza→tier**, las **reglas por acabado** (`finishRules`) y la **pantalla de M2** que
      los editaba — junto con su **texto falso** («Sin regla propia, el acabado hereda la del tier de su
      rareza» y el placeholder «Hereda tier»), que **desaparece con la pantalla** en vez de corregirse. En su
      lugar queda el **editor de la tabla de puntos** (N.3).
- [ ] **Migración de datos y cambio de contrato**: los hay, y los diseña el **arquitecto**. Como no hay dinero
      vivo, la migración **no requiere ventana de riesgo**; sí requiere que el **catálogo quede repriciado por
      completo** antes de publicar (ninguna variante puede quedar con precio calculado con la lógica vieja).

**N.10 — Fuera de alcance de v2.0**
- [ ] **Sellado por curva**: el sellado conserva su spread por presentación (§K). Migrarlo a la curva sería
      otra decisión.
- [ ] **Piso o bin diferenciados por acabado**: **descartado explícitamente por el humano** (cuesta ~2% de
      utilidad y no vale su complejidad). No se implementa «por si acaso».
- [ ] **Curvas distintas por rareza, por acabado o por set**: la rareza y el acabado **salieron** del pricing;
      volver a meterlos por otra puerta contradice la decisión.
- [ ] **Calibración automática de la curva** a partir de la instrumentación (N.8): en v2.0 el dato **se
      recolecta** y la calibración es **manual** (el dueño mueve los puntos). Un ajuste automático sería fase
      posterior.
- [ ] **Convertir el override manual en piso**: descartado (N.6) — el override es absoluto por diseño.

### O. Valor estimado si se gradea — «gancho de grading» (transversal — NUEVO v2.0)
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
> buylist. Ver **§O.5** (disclaimer) y «Fuera de alcance».
> **Alcance de esta feature**: la **presentación** en el storefront (ficha, tejas de Compra, y en el home la
> **vitrina «Joyas para gradear»** y el carrusel **«Piezas destacadas del catálogo»**) más la
> **derivación server-side** del estimado, de su **confianza** y de su **elegibilidad**. **No** cambia el
> precio de venta, el buylist, la bóveda, el inventario ni el P&L. El schema, el contrato y el caching los
> diseña el arquitecto; aquí solo se fija el requisito de producto. *(Nota operativa: la arquitectura va en
> `docs/ARCHITECTURE.md` **§4.38**, el contrato de API en **v1.50** y su seed en **M-42**; el tratamiento
> visual, en `docs/DESIGN_SYSTEM.md` **§22**.)*
> **Estado de entrega — UN SOLO INTERRUPTOR, APAGADO DE FÁBRICA** *(actualizado 2026-08-31, M-46)*: la
> feature se entrega **cableada pero apagada** por defecto. Mientras esté apagada, ninguna de las cuatro
> superficies muestra cifra estimada **y el barrido no pide ni escribe ninguna**.
>
> **§O nunca normó los on/off, así que esto no cambia ningún requisito: lo deja escrito.** Antes había **dos**
> interruptores separables (publicar / traer datos); el dueño pidió **dos veces** que fuera **uno solo** y lo
> reafirmó tras oír la objeción. Hoy es **uno** (`grading_hook_enabled`), y de ahí sale la consecuencia que
> este documento debe declarar:
> - **Encender es un acto de gasto.** El **mismo `PUT`** que publica la afirmación comercial **autoriza gasto
>   contra un proveedor de paga**. Publicar y gastar **dejaron de ser separables**.
> - **Cuánto.** Con los topes sembrados, hasta **~1 000 créditos/día**. **`ingestMaxCardsPerRun` es lo único
>   que hay entre el `PUT` y la factura**, y los créditos gastados **no se recuperan al apagar**.
> - **Qué se pierde.** Deja de existir la posibilidad de **«traer datos automáticos con la tienda callada»**:
>   ya no es un estado expresable. El modelo pasa de **retener-y-aprobar** a **detectar-y-retirar** — la cifra
>   se escribe ya filtrada, se inspecciona en la lista de revisión y, si está mal, **se borra**. Es una
>   **pérdida real** y queda declarada, no disimulada.
>
> Ver **decisión 60** y criterios **116–117**. *(El detalle técnico del dial único lo fija el arquitecto en
> `docs/ARCHITECTURE.md` **§4.38(r)**, contrato **v1.51-one-dial**; el copy de la pantalla, `DESIGN_SYSTEM.md`
> **§22.13**. Aquí solo se fija el requisito de producto.)*
>
> **Estado del disclaimer (§O.5) — la precisión importa**: el texto está **aprobado por el dueño**
> (2026-08-31, condicionado a la corrección de marca a **TCG HUNT**, ya aplicada). Lo que **NO** existe es
> **revisión legal profesional**: esa parte sigue **abierta** y está **a nombre del dueño** (con su abogado),
> ver **pregunta abierta 1**. Encender ya **no** está bloqueado por la aprobación del texto.
> **Relación con §N (precio puro)**: son bloques distintos y **no se pisan**. §N fija **dinero real** (el
> precio publicado sale de la curva por valor de mercado); §O es **presentación** y **consume** ese precio
> publicado como `precioVentaRaw` sin alterarlo nunca.

**O.1 — Dónde aplica (alcance del producto)**
- [ ] Aplica **solo a cartas raw (singles)** de nuestro inventario **publicado en Compra** — es decir, con
      **precio de venta fijado** (se respeta la **Regla de Compra**, §A: lo que no tiene precio no se lista, y
      esta feature **no** publica nada que hoy no se publique). Bajo §N eso significa que una variante en
      **«precio pendiente»** (§N.2 / §N.5) **nunca** llega al gancho: no está publicada.
- [ ] **No aplica a gradeadas** (ya tienen grado real: el slab con empresa + grado + `certNumber` es el dato,
      §H) **ni a sellado** (§K).
- [ ] **Grados cubiertos en el MVP: PSA 10 y PSA 9, únicamente.** Otras graduadoras (CGC/BGS/TAG) y otros
      grados (PSA 8 o menos) quedan **fuera de alcance**.
- [ ] El estimado se muestra en **MXN**, con el mismo tratamiento de conversión y **refresco diario** del
      resto de precios (§A / «Fuentes de precio»), y **solo para las cartas que ya priciamos** (las que están
      en bóveda/inventario), para no romper los límites del proveedor.

**O.2 — Gate de ROI sobre PSA 9 = CRITERIO DE CURADURÍA INTERNO (ACTUALIZADO 2026-08-23)**
> **Qué hace el gate**: decide **qué cartas promocionamos activamente**, no qué se le enseña al cliente.
> Selecciona las cartas en las que el comprador **gana incluso en el peor caso razonable** —que la carta salga
> **PSA 9** en vez de PSA 10—, comparando el estimado de **PSA 9** contra **lo que le cuesta la jugada
> completa** (lo que paga por la carta raw **más** lo que le costará gradearla), con un **margen mínimo**.
> **Cambio de papel (decisión del humano, 2026-08-23)**: el gate **ya no condiciona que se vea el gancho**;
> ahora **gobierna la curaduría de las superficies de promoción**. Cita del humano: *«calcúlalo para que
> podamos ponerlo en la sección de destacado algo que valga la pena»*. Concretamente:
> - **Ficha de carta** → los estimados se muestran **siempre que haya dato**, **sin** condicionar al gate. Es
>   información para quien **ya está viendo esa carta**; no le estamos vendiendo la idea, se la estamos dando.
> - **Teja de catálogo, vitrina del home y carrusel «Piezas destacadas»** *(destacadas añadido 2026-08-31)* →
>   la cifra aparece **SOLO si el gate se cumple** *(y, desde 2026-08-28, solo si además **supera el gate de
>   confianza** de §O.7)*. Son las superficies donde **promocionamos activamente**, y ahí solo entra lo que
>   **de verdad vale la pena**. *(Matiz de destacadas: el gate decide **qué teja lleva burbuja**, no qué cartas
>   contiene el carrusel ni en qué orden — ver §O.3 (4).)*
> **El resultado del cálculo NUNCA se expone al cliente**: ni la ganancia neta, ni el escalón de costo
> aplicado, ni un multiplicador, ni el margen. El gate vive **entero del lado del servidor** y su única huella
> visible es **qué cartas aparecen** en teja/vitrina, **en qué orden** y **qué teja de destacadas lleva
> burbuja**. Esto **refuerza SEC-A1**: el cliente
> ya ni siquiera recibe los insumos del cálculo, así que no hay nada que manipular.

- [ ] **Fórmula de curaduría** (se evalúa **server-side** y **no se expone**, ver §O.4):

```
gradingCost   =  costo del ESCALÓN cuyo rango contiene el valor declarado de la carta   (tabla §O.2.1)

promocionable ⇔  estimadoPSA9  ≥  (precioVentaRaw + gradingCost) × (1 + minUpsidePct)
                 Y  la cifra supera el GATE DE CONFIANZA de §O.7

gananciaNeta  =  estimadoPSA9 − (precioVentaRaw + gradingCost)      ← SOLO para ordenar la vitrina;
                                                                      NUNCA se muestra al cliente
```

> **La matemática del gate no cambió** respecto a la decisión original del humano: sigue siendo «el comprador
> debe ganar incluso saliendo PSA 9», y `gradingCost` se sigue **resolviendo por escalones** (§O.2.1). Lo que
> cambió *(2026-08-23)* es **para qué sirve el resultado**: antes decidía si se veía el gancho; ahora decide
> **qué se promociona y en qué orden**. Lo que se suma *(2026-08-28)* es que la **calidad del dato** también
> condiciona la promoción (§O.7): un número que no es confiable **no se promociona aunque pase el ROI**.

- [ ] **Dos diales configurables por el admin** (editables **sin deploy** y **auditados** en M10):

| Dial | Qué representa (lenguaje de producto) | Default |
|---|---|---|
| `gradingCostTiers` | **Tabla de escalones**: rangos de **valor declarado** de la carta → **costo de gradeo estimado en MXN**. Imita cómo cobra **PSA**, que cobra **por nivel de servicio según el valor declarado**: entre más vale la carta, más caro sale gradearla. Ver **§O.2.1**. | ver tabla §O.2.1 |
| `minUpsidePct` | **Margen mínimo** que le debe quedar al comprador **por encima** del costo total para que **valga la pena promocionar** esa carta. Debajo de eso, la ganancia es tan chica que no justifica ponerla en portada. | **30%** |

**O.2.1 — Tabla de escalones del costo de gradeo (`gradingCostTiers`) — ACTUALIZADO 2026-08-23**
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
      money-safe de §O.4; jamás se asume costo $0 ni se cae a un default silencioso).
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
- [ ] *(Nota para el arquitecto — no es decisión de producto: el patrón que se citaba antes, el editor de
      **tiers de rareza** (`GET/PUT /admin/pricing/tiers`), **se retira** con §N —criterio 96—, así que ya no
      sirve de referencia. El patrón vivo equivalente es el **editor de la tabla de puntos de la curva**
      (§N.3, criterio 86): tabla editable por admin, sin redeploy, validada y auditada. Se **sugiere reusar
      ese** —mismo estilo de endpoint, validación y auditoría— en vez de inventar uno nuevo. La decisión de
      diseño es del arquitecto.)*

- [ ] **El PSA 10 es el premio mayor, no el juez**: el PSA 10 es la cifra que ilusiona y se muestra en la
      ficha, pero **lo que decide si promocionamos la carta es exclusivamente el PSA 9**.
      **Racional de producto (por qué el gate NO es sobre PSA 10)**: si promocionáramos con base en PSA 10, un
      cliente al que le **salga PSA 9** —el resultado más común— podría **perder dinero** después de pagar la
      carta y el gradeo. Eso **quema la reputación de la tienda** y convierte el gancho en una queja. Con el
      gate sobre **PSA 9**, casi cualquier resultado razonable le deja ganancia, y el PSA 10 es upside extra.
- [ ] **Sin estimado de PSA 9 no se promociona**: si existe estimado de **PSA 10** pero **no** de **PSA 9**, la
      carta **no se promociona en ninguna superficie de promoción** —no entra a la teja de la rejilla ni a la
      vitrina, y **su teja en destacadas no lleva burbuja**— (no se infiere, no se interpola, no se aproxima el
      PSA 9 a partir del PSA 10). *(En la **ficha** sí puede mostrarse el PSA 10 que sí existe — ver §O.3.)*
- [ ] *(SUPUESTO: el cálculo usa el **precio de venta raw sin IVA** —el mismo número que ve el comprador en la
      ficha, §B— y **no** incluye el envío de la carta ni el IVA en `precioVentaRaw`. Confirmar con el humano
      si quiere una curaduría aún más conservadora incluyendo esos conceptos; ver preguntas abiertas v2.0.)*

**O.3 — Las cuatro superficies (SIMPLIFICADAS — ACTUALIZADO 2026-08-31)**
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
> **Cierre 2026-08-28 — la cifra SÍ se pinta en rejilla y vitrina**: dejaba de estar en duda si esas dos
> superficies llevaban **el número** o solo el enlace. Llevan **el número**, con una condición: en ellas la
> cifra **tiene que ser confiable** (§O.7). Son **superficie de promoción**; la ficha es **superficie
> informativa** y por eso su listón es distinto.
> **Cambio de alcance 2026-08-31 — de TRES superficies a CUATRO: entra «Piezas destacadas del catálogo»**.
> El humano pidió la burbuja **también en el carrusel de destacadas del home**, **conservando** la vitrina
> «Joyas para gradear»: **quiere las dos**. No es alcance nuevo inventado ahora — **es lo que había pedido
> desde el principio** *(cita: «en home ponemos alguna burbuja… sobre las destacadas»)* y que se resolvió
> entregando una **vitrina aparte** en su lugar. Esta actualización **alinea el producto con lo pedido**: la
> vitrina **se conserva tal cual** (no se toca su contenido, su orden ni su regla de no renderizarse vacía) y
> **se suma** la burbuja en las tejas del carrusel de destacadas.
> **Convención de lectura (importante para todo §O)**: **«superficies de promoción» = rejilla de Compra +
> vitrina «Joyas para gradear» + carrusel «Piezas destacadas»**. Las tres exigen **el gate de ROI (§O.2) y el
> gate de confianza (§O.7)**. La **ficha** es la única **superficie informativa**: informa lo que haya. Donde
> este documento diga «teja y vitrina» refiriéndose a promoción, **se lee incluyendo también destacadas**.

- [ ] **(1) Ficha de carta** *(§A)* — la superficie informativa. Muestra **únicamente**:
      - el **precio de venta de la carta** (el que ya se muestra hoy, sin cambio),
      - el **estimado PSA 10**,
      - el **estimado PSA 9**,
      - **NINGUNA FECHA** *(RESUELTO 2026-08-31, **decisión 62**; cierra la pregunta abierta **18**)*.
        **Esta línea prometía la «fecha de la última venta observada» y esa promesa SE RETIRA, no se
        implementa.** Nunca se construyó y **no se puede** cumplir hoy: **`evidenceDate` no se persiste**, así
        que al leer sólo existe la **fecha de captura de la fila**, que puede ir hasta **30 días adelantada**
        respecto de la venta que respalda la cifra. El dueño eligió la opción **(b): no mostrar fecha** para el
        dato automático. **La ficha no muestra fecha junto a los estimados.**
        *(**Ojo — esto SÍ es trabajo pendiente de frontend, no el estado actual**: hoy el bloque de estimados
        **sí pinta una fecha**, el eyebrow `catalog.gradingEstimate.updatedAt` = **«ESTIMADO · {date}»**,
        alimentado por `oldestCapturedDate()` sobre el `capturedDate` de `GradedEstimateDTO.estimate`.
        **Retirarlo es el cambio que esta decisión ordena** — ver criterio **119**.)*
        *(Reversible: si algún día se cablea `evidenceDate` —deuda viva tras la decisión **61**—, mostrar la
        **fecha real de la venta** vuelve a estar sobre la mesa. «No mostramos fecha» es la respuesta a **no
        tener** el dato honesto, **no** una prohibición permanente de diseño.)*
        *(**Caso override manual — NO resuelto por esta decisión**: esta línea también prometía, para un
        override, «la fecha en que el admin lo fijó». La pregunta 18 se formuló sólo sobre el **dato
        automático**, así que **no se extiende** el «no» al override por cuenta propia; pero hoy es
        **inimplementable tal cual**, porque el cliente **no puede distinguir** un override de un dato
        automático —`source` se **omite siempre** por contrato— y el bloque pinta **una sola fecha** para
        todas sus cifras. Ver pregunta abierta **24**.)*
      - la **llamada al disclaimer** (asterisco) y su **nota al pie** (§O.5).
      **Nada calculado**: sin multiplicador, sin diferencia, sin ganancia, sin costo de gradeo, sin
      comparativa. **No está condicionada al gate de ROI**: si hay dato, se muestra.
      **Si solo existe uno de los dos grados**, se muestra **el que exista** *(SUPUESTO: es información, no
      promoción; ver preguntas abiertas v2.0)*.
- [ ] **(2) Rejilla de Compra — badge con la cifra en la teja** *(§A)* — superficie de **promoción**: aparece
      **solo en cartas que pasan el gate de ROI** (§O.2) **y el gate de confianza** (§O.7). Badge compacto que
      **muestra el estimado PSA 10**.
      *(SUPUESTO de copy, **aún sin ratificar por el dueño** — **pregunta abierta 4**, abierta:
      **«En PSA 10 vale ≈ MX$X»**; en móvil, **«PSA 10 ≈ MX$X»**. Distinto del disclaimer de §O.5, que **sí**
      está aprobado. Ya visible en producción; no bloquea.)*
      Lleva su **micro-aviso + llamada al pie** (§O.5). Las tejas que **no** pasan se ven **exactamente
      como hoy**: **no hay badge vacío, tachado ni en gris**.
- [ ] **(3) Vitrina en el home: «Joyas para gradear»** — superficie de **campaña**: solo cartas que **pasan
      ambos gates**, **publicadas y disponibles**, cada una con su teja + badge (con la cifra) y enlace a su
      ficha.
      **Orden: por mayor `gananciaNeta` sobre PSA 9** (el escenario **realista**, no el optimista) — así lo
      primero que ve el visitante es lo que mejor sostiene el argumento aun en el caso conservador.
      **El criterio de orden es interno: la cifra que ordena NUNCA se muestra ni se envía al cliente.**
      *(SUPUESTO: hasta **8** cartas; ver preguntas abiertas v2.0.)*
      **Si ninguna carta pasa, la vitrina completa NO se renderiza** (no aparece vacía, ni con
      placeholder, ni con «próximamente»).
- [ ] **(4) Carrusel del home «Piezas destacadas del catálogo»** *(NUEVA 2026-08-31)* — superficie de
      **promoción**: las tejas del carrusel llevan el **mismo badge con la cifra** que la rejilla de Compra
      (**estimado PSA 10**), y **solo** en las cartas que pasan **el gate de ROI** (§O.2) **y el gate de
      confianza** (§O.7). Mismo listón que la rejilla, por la misma razón: es una **superficie donde
      promocionamos**, no donde informamos.
      *(Copy: el **mismo** del badge de la rejilla — **«En PSA 10 vale ≈ MX$X»**, en móvil **«PSA 10 ≈ MX$X»**;
      **SUPUESTO de copy que el dueño todavía no ha ratificado**, igual que el de la rejilla — **pregunta
      abierta 4**, que sigue **abierta**. No se inventa un texto distinto para esta superficie.
      **Precisión 2026-08-31 (M-46)**: esto **no** es lo mismo que el disclaimer. El **disclaimer de §O.5 sí
      está aprobado** por el dueño (decisión 59); **el copy del badge no**. Y ya **no es hipotético**: con la
      exhibición encendida en producción, este texto **ya se está mostrando** sobre un supuesto del PO. No
      bloquea —es copy, no una afirmación legal nueva: la carga legal la lleva el disclaimer, que sí está
      aprobado— pero **sube de prioridad**: conviene que el dueño lo ratifique o lo cambie.)*
      Lleva su **micro-aviso + llamada al pie** (§O.5); el home ya lleva **una** nota al pie que cubre todas
      las cifras de la página (vitrina y destacadas incluidas).
      **Lo que esta superficie NO cambia (crítico)**: el gancho **no cura ni reordena** el carrusel. «Piezas
      destacadas» **sigue siendo lo que es hoy** —las cartas **más caras** del inventario publicado, ordenadas
      por **precio descendente**— y **sus tejas siguen siendo las mismas**. El gancho **solo añade la burbuja**
      a las tejas que califican. Es la **diferencia de fondo con la vitrina**: la vitrina la **construye** el
      gate (contenido y orden); el carrusel **ya existe** y el gate solo decide **qué teja lleva burbuja**.
      **Las tejas que no califican se ven exactamente como hoy**: sin badge vacío, tachado, en gris ni
      placeholder.
      **Si NINGUNA teja califica, el carrusel se renderiza igual que hoy** —simplemente **sin ninguna
      burbuja**—. Aquí **no** aplica la regla de «no renderizar» de la vitrina: el carrusel de destacadas
      **existe con independencia del gancho** y quitarlo rompería el home.
      **Convive con la vitrina, no la sustituye**: son **dos secciones distintas** del home y **ambas se
      conservan**. Una misma carta **puede aparecer en las dos** —con su cifra en ambas— y **no se deduplica**:
      la vitrina responde a «lo que mejor conviene gradear» y el carrusel a «lo más caro del catálogo»; que
      coincidan es normal y no es un defecto.
- [ ] **ADVERTENCIA DE EXPECTATIVA — es probable que destacadas muestre POCAS burbujas o NINGUNA**
      *(NUEVA 2026-08-31; expectativa de negocio, NO es un defecto)*: «Piezas destacadas» ordena por **precio
      descendente**, así que contiene **las cartas más caras** del inventario. El gate de ROI compara la
      ganancia contra el **costo de gradeo**, que **sube por escalones de valor** (§O.2.1: de **$50,001 en
      adelante ⇒ $12,000**). Es decir: **justo las cartas que llenan este carrusel son las que tienen el listón
      más alto**, y por diseño **son las que menos suelen calificar**. Consecuencia esperada: **este carrusel
      puede mostrar muy pocas cifras, o ninguna, durante largos periodos** — y eso es el sistema **funcionando
      como debe**, no un fallo de implementación.
      **Qué implica para cada rol**: **QA no debe reportar como defecto** un carrusel de destacadas sin
      burbujas (el defecto sería lo contrario: una burbuja en una teja que **no** pasa los gates, o una teja
      con hueco/placeholder). Y el **humano debe saber** que si quiere más presencia de la burbuja ahí, las
      palancas son **de negocio, no de código**: bajar `minUpsidePct`, revisar los **valores por defecto de los
      escalones** (§O.2.1) o cambiar el criterio con que se arma «destacadas» —esto último **fuera del alcance
      de §O**, sería un cambio del home y hay que pedirlo aparte.
- [ ] **Regla transversal — el cálculo no se filtra**: en **ninguna** de las cuatro superficies se muestra (ni se
      envía al cliente en el payload) la **ganancia neta**, el **escalón de costo aplicado**, el
      **multiplicador**, el **margen**, el **flag de elegibilidad**, el **tamaño de la muestra de ventas** ni
      los **umbrales de confianza**. Lo único observable desde fuera es **qué cartas aparecen**, **en qué
      orden** y **qué teja de destacadas lleva burbuja**.
- [ ] **Bilingüe (§ i18n, criterio 32)**: todos los textos de las cuatro superficies —incluidos el micro-aviso y
      la nota al pie— existen en **español e inglés**, con default español. Los **datos del catálogo** siguen
      en inglés.

**O.4 — Money-safe y derivación server-side (regla dura, no negociable)**
> Esta feature es **un argumento de venta**, así que la regla money-safe se aplica **más estricta que en
> ningún otro lado**: en una promesa comercial no se muestra un hueco. El precedente es el fast-follow de
> seguridad que cerró el **«$0 latente»** — un $0 o un guion en un gancho de venta es peor que no mostrar nada.

- [ ] **Ausencia total de render ante cualquier hueco**: **una cifra que no existe no se dibuja**. Si falta un
      estimado, **esa cifra no aparece**; si no falta ninguno pero falta el precio de venta, la carta ni
      siquiera está publicada (§A). **Nunca** se muestra **$0**, **nunca** un guion (`—`), **nunca** un rango
      inventado, y —a diferencia de otros módulos— **ni siquiera «precio pendiente»**: el estado «pendiente» es
      un concepto de back-office, no algo que se le enseñe al comprador.
- [ ] **Regla por superficie** *(actualizada 2026-08-31)*:
      **Ficha** → se muestra **lo que haya** (PSA 10 y/o PSA 9), **sin** depender del gate de ROI y con el
      listón de confianza **más bajo** (§O.7).
      **Rejilla, vitrina y carrusel de destacadas** *(las tres superficies de promoción)* → **solo** si se
      cumplen **el gate de ROI y el de confianza**; si falla cualquiera, o si falta cualquier insumo (PSA 9,
      precio, escalón, muestra), **no se renderiza el badge ni la entrada de vitrina** — y **sin dejar rastro
      visual**. En **destacadas**, «no renderizar» significa **la teja se ve exactamente como hoy, sin
      burbuja**: la teja **sigue estando** (el carrusel no es curado por el gate).
- [ ] **Sin escalón, no se promociona**: si el valor de la carta **no cae en ningún escalón** de
      `gradingCostTiers` (tabla vacía, con huecos o mal editada), la carta **no pasa el gate** y por tanto
      **no se promociona en ninguna superficie de promoción** (sin badge en rejilla, fuera de la vitrina, sin
      burbuja en destacadas). **Jamás** se asume costo **$0** ni se cae a un default silencioso — un costo
      de gradeo subestimado es exactamente lo que haría que promocionáramos una carta en la que el comprador
      pierde dinero. *(La **ficha** no se ve afectada: ahí el estimado es información, no promoción.)*
- [ ] **Curaduría y montos derivados server-side (SEC-A1) — REFORZADO**: el backend evalúa ambos gates y ordena
      la vitrina a partir del precio de venta real, los estimados reales, la **tabla de escalones real**, la
      **muestra real de ventas** y los diales reales. El cliente **recibe únicamente la lista ya curada y
      ordenada, más las cifras que se pintan** (PSA 10 / PSA 9). **No recibe los insumos del cálculo** —ni
      `gradingCost`, ni `minUpsidePct`, ni `minSalesSample`, ni `maxGradedMultiple`, ni el tamaño de la
      muestra, ni la ganancia neta, ni un flag de elegibilidad—, así que **no hay nada que manipular**: un DTO
      alterado no puede meter una carta a la vitrina, cambiar su posición ni alterar una cifra. *(Simplificar
      la superficie visible (§O.3) **redujo la superficie de ataque**: menos datos expuestos, menos que
      proteger.)*
- [ ] **El estimado no toca dinero real**: **no** modifica el precio de venta (§A/§B/§N), **no** entra en la
      **valuación ni en la tendencia del portafolio** (§C), **no** afecta la **cotización de buylist** (§E/§M),
      **no** afecta el **costo/P&L de M7** y **no** cambia el **valor de inventario**. Es una **capa de
      presentación** alimentada por precios de referencia, igual que cualquier otro precio mostrado. El caso
      límite en que **sí** podría tocar dinero real —el estimado escribiendo sobre el precio de un slab
      publicado— está cerrado en **§O.8**.
- [ ] *(SUPUESTO — desambiguación con §N.7: el bloque «**Valor de mercado**» de la ficha y el bloque del
      **estimado por grado** son **cosas distintas**. La regla de visibilidad de §N.7 (mostrar «Valor de
      mercado» solo si `priceBasis = mercado`) **gobierna solo ese bloque** y **no** condiciona al gancho de
      grading, que se rige por §O.7. Confirmar de paso con el humano.)*
- [ ] **Frescura del dato**: un estimado **rancio deja de mostrarse** (mejor callar que presumir un número
      viejo en una promesa comercial). El umbral y cómo se mide están en **§O.7**.

**O.5 — Disclaimer (ES / EN) — APROBADO POR EL DUEÑO, SIN REVISIÓN LEGAL PROFESIONAL — ACTUALIZADO 2026-08-31**
> **Estado (M-46, decisión 59) — las dos mitades, siempre juntas y sin suavizar:**
> **(1) APROBADO POR EL DUEÑO.** Este texto **dejó de ser un borrador**: el dueño lo aprobó el **2026-08-31**,
> condicionado a la corrección de marca a **TCG HUNT** (`common.brand.name`), **ya aplicada**. **Ya no
> mantiene la feature apagada** y **no requiere ninguna aprobación adicional para encenderse**.
> **(2) SIN REVISIÓN LEGAL PROFESIONAL.** **Ningún abogado lo ha revisado.** Eso sigue **abierto** y es **del
> dueño** (pregunta abierta 1); **no bloquea el encendido**. El día que un abogado lo revise, esta segunda
> mitad **se retira** de aquí y de la pantalla.
> **Prohibido** afirmar, aquí o en cualquier superficie, que este disclaimer **no está aprobado** o que le
> falta el visto bueno del dueño (criterio **117**; `DESIGN_SYSTEM.md` §22.13(h) con check de QA de **cero
> apariciones**). Producción ya muestra este texto con la exhibición **encendida**.
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
> **Nota de precisión (2026-08-28) — el texto no cambia, gana exactitud**: con la fuente automática de §O.6, la
> frase «**dato de referencia de mercado sobre ese modelo de carta ya gradeado por terceros**» deja de ser una
> aproximación cómoda y pasa a ser **literalmente exacta**: PokemonPriceTracker **no valúa nada**, entrega
> **ventas cerradas reales de eBay agrupadas por grado**. La cifra es, al pie de la letra, **lo que compradores
> reales pagaron por ese modelo ya gradeado por un tercero**. Esto **no modifica ni una palabra** del
> disclaimer aprobado abajo —solo lo vuelve más defendible—: seguimos sin evaluar la pieza que vendemos, que
> es exactamente lo que el texto dice.
> **Corrección de marca (2026-08-31)**: el texto decía «TCG Vault MX». La **marca es TCG HUNT**
> (`common.brand.name`), así que **el descargo dice TCG HUNT** en ES y EN. **Solo cambia el nombre**: ni una
> idea del texto se modifica. *(Cerrado el mismo día: el humano confirmó el renombrado y **todo PROJECT.md**
> —título, encabezado de marca, decisión 11 y direcciones de correo— quedó alineado a TCG HUNT / `tcghunt.mx`.
> Pregunta abierta 21 **cerrada**.)*
> **Marca vs. razón social — asunto abierto, con recomendación del PO**: el proyecto distingue **marca**
> (`common.brand.name` = **TCG HUNT**) de **razón social** (`common.footer.legalEntity`, hoy **pendiente de
> carga**; el pie la omite hasta que exista). **Hoy el descargo usa la marca**, igual que los términos
> (`legal.intro`), y eso es **coherente y suficiente para operar**. Pero este texto **deslinda
> responsabilidad** —no hay recompra, no se garantiza grado, el riesgo es del comprador—, y **quién deslinda
> es parte del deslinde**: una marca no es sujeto de obligaciones; la razón social sí. **Recomendación del
> PO** *(recomendación, NO decisión cerrada — tiene peso legal y la toma el humano, idealmente con su
> abogado)*: **el día que se cargue la razón social, el descargo debe nombrarla**, con el patrón
> **«TCG HUNT, marca operada por [Razón social]»** —así el comprador sigue leyendo el nombre que reconoce y
> el deslinde queda atado a la entidad que responde—, y **el mismo criterio se aplica a los términos**, para
> que no digan cosas distintas. **Lo que sí queda fijado ahora es el disparador de revisión**: cuando se
> cargue `common.footer.legalEntity`, **§O.5 se revisa obligatoriamente** (criterio 114). **La redacción
> definitiva la aprueba el humano** — ver pregunta abierta **20**. *(Actualizado 2026-08-31: el descargo
> **ya está aprobado por el dueño**, sin revisión legal profesional; lo que sigue abierto es la **revisión
> por abogado** —pregunta abierta 1— y **este punto de la razón social no bloquea** nada nuevo: entra en la
> misma revisión.)*

- [ ] **Versión completa (ficha de carta) — ES** *(aprobada por el dueño, decisión 59)*:
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
      > **Esto no es una oferta, ni una garantía de precio, ni un compromiso de recompra** por parte de
      > **TCG HUNT**. Si mandas la carta a gradear y el resultado no es el que esperabas, **no hay reembolso,
      > compensación ni devolución por ese motivo** (aplica nuestra política de ventas finales).
      >
      > **TCG HUNT no gradea cartas ni intermedia el servicio de gradeo.** La **cuota de PSA, el envío
      > internacional, el retorno a México, los seguros y los tiempos de espera corren por tu cuenta**.
      >
      > **Los precios de mercado cambian todos los días** y este estimado puede quedar desactualizado en
      > cualquier momento.

- [ ] **Versión completa (ficha de carta) — EN** *(aprobada por el dueño, decisión 59)*:
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
      > **This is not an offer, not a price guarantee, and not a buy-back commitment** by **TCG HUNT**. If you
      > send the card in for grading and the result is not what you hoped for, **there is no refund,
      > compensation or return on that basis** (our final-sale policy applies).
      >
      > **TCG HUNT does not grade cards and does not broker grading services.** **PSA fees, international
      > shipping, return shipping to Mexico, insurance and turnaround times are entirely on you.**
      >
      > **Market prices change every day** and this estimate may become outdated at any time.

> **Dónde vive este texto completo** *(actualizado 2026-08-23)*: **al pie de la página**, referenciado con una
> **llamada (asterisco)** junto a cada cifra. Ver «Regla de presentación» abajo.

- [ ] **Versión corta / micro-aviso (junto a la cifra: badge y bloque de ficha) — ES** *(§O.5 está aprobado;
      esta cadena corta y su permanencia siguen en **pregunta 12**)*:
      > *Cifra **ilustrativa** de mercado. **No evaluamos el estado de esta carta** ni garantizamos ningún
      > grado; el gradeo y su costo corren por tu cuenta.*
      > *(Variante ultra-corta para el badge, donde no cabe la anterior: **«Ilustrativo; no evaluamos esta
      > carta.\***».)*
- [ ] **Versión corta / micro-aviso (junto a la cifra: badge y bloque de ficha) — EN** *(§O.5 está aprobado;
      esta cadena corta y su permanencia siguen en **pregunta 12**)*:
      > ***Illustrative** market figure. **We have not assessed this card's condition** and guarantee no
      > grade; grading and its cost are on you.*
      > *(Ultra-short variant for the badge: **«Illustrative; we haven't assessed this card.\***».)*

**Regla de presentación — PATRÓN DE NOTA AL PIE (ACTUALIZADO 2026-08-23)**
> **Decisión del humano (cita textual)**: *«El completo solo hagamos referencia con un asterisco donde ponemos
> el tag y hasta abajo de la página lo ponemos»*. **El texto completo NO se poda** —el humano lo quiso
> íntegro—: cambia **dónde vive**, no qué dice. El **tratamiento visual** lo diseña **ux-ui**
> (`docs/DESIGN_SYSTEM.md` **§22**); aquí solo se fija la **regla de producto**.

- [ ] **Llamada + nota al pie**: **toda cifra estimada** (PSA 10 o PSA 9, en cualquier superficie) lleva una
      **llamada visible** (asterisco) junto a ella, y la **página que la contiene** lleva el **texto completo
      del disclaimer al pie**. La llamada y su nota deben estar **vinculadas** (que se pueda llegar del
      asterisco al texto).
- [ ] **Ninguna página huérfana**: **ninguna página que muestre una cifra estimada puede carecer de su nota al
      pie completa**, y **ninguna cifra estimada puede carecer de su llamada**. Aplica a las cuatro
      superficies: **home** (**vitrina «Joyas para gradear»** y **carrusel «Piezas destacadas»**), **listado de
      Compra** (tejas) y **ficha**. Si una página muestra varias cifras, basta **una** nota al pie que las
      cubra todas — el **home** lleva **una sola** nota al pie que cubre **las dos** secciones, y esa nota debe
      aparecer **aunque la vitrina no se renderice**, si el carrusel de destacadas muestra al menos una cifra.
- [ ] **DECISIÓN DE PRODUCTO — se conserva un micro-aviso junto a la cifra, ADEMÁS de la llamada**: la llamada
      al pie **no sustituye** a las dos ideas obligatorias. Junto a la cifra (en el badge y en el bloque de la
      ficha) va un **micro-aviso mínimo** que carga **«ilustrativo»** + **«no evaluamos esta carta»**, y el
      asterisco lleva al texto completo.
      *(SUPUESTO de copy, para aprobación — ES: **«Ilustrativo; no evaluamos esta carta.\***» · EN:
      **«Illustrative; we haven't assessed this card.\***».)*
      **Precisión de estado (2026-08-31, M-46)**: esto **no contradice** la decisión 59. El **cuerpo del
      disclaimer de §O.5 SÍ está aprobado** por el dueño; lo que **no** ha sido ratificado por separado es
      **esta cadena corta** y la decisión estructural de **conservar el micro-aviso o quedarse solo con el
      asterisco** (**pregunta abierta 12**, abierta). No bloquea el encendido.
      **Argumento de la decisión**: una nota al pie **protege menos que un aviso adyacente** si el comprador
      **nunca baja** — y en el **home** (vitrina **y** carrusel de destacadas) y en el **listado de Compra**
      eso es lo normal: el
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

**O.6 — Fuente del dato: INGEST AUTOMÁTICO desde PokemonPriceTracker (REESCRITA 2026-08-28)**
> **Qué cambió y por qué**: la entrega original dejaba los valores PSA **capturados a mano** (fase 1
> manual-first) porque el formato del payload del proveedor no estaba confirmado. El humano preguntó *«¿no
> tenemos algo automático?»* y tiene razón: **PokemonPriceTracker ya está contratado y sí trae el dato**. El
> marco de dos fases con la fase 2 bloqueada **queda superseded**: la fuente es **automática desde el
> arranque**, con el **override manual conservado** como respaldo y como herramienta de curaduría.
> **Qué entrega exactamente el proveedor (importante para el disclaimer)**: **PPT no valúa nada**. No emite una
> opinión de valor, un índice ni un precio sugerido. Entrega **ventas cerradas reales de eBay agrupadas por
> grado** (`ebay.salesByGrade`), y de cada grado da: **número de ventas de la muestra**, **mediana**,
> **promedio** y **fecha de la última venta**. Eso es lo que hace que el disclaimer de §O.5 sea **exacto y no
> una aproximación**: la cifra es, literalmente, **lo que compradores reales pagaron por ese modelo ya
> gradeado por terceros** — no una valuación nuestra ni del proveedor.
> **Lo que NO cambia para el usuario**: mismas superficies *(las **cuatro** desde 2026-08-31, §O.3)*, mismo
> gate de ROI, mismo disclaimer, mismas
> reglas money-safe. *(Actualizado 2026-08-31, M-46: la coletilla «mismo feature-flag apagado hasta la
> aprobación legal» **se retira por falsa**. El disclaimer **ya está aprobado por el dueño** (decisión 59) y
> la **revisión legal profesional**, que sigue abierta, **no bloquea el encendido**. Además ya no hay dos
> flags: hay **un interruptor único** que al encenderse **publica y gasta** — decisión 60.)*

- [ ] **Fuente primaria — automática**: los valores **PSA 10 / PSA 9** se alimentan del ingest de
      **PokemonPriceTracker** sobre `ebay.salesByGrade` (proveedor **ya contratado**; API key gestionada en el
      **entorno de despliegue**, Railway, **nunca** en el repositorio).
- [ ] **Qué estadístico se publica** *(SUPUESTO)*: la **mediana** de la muestra de ese grado, **no** el
      promedio. La mediana **aguanta el outlier** (una venta atípica no arrastra la cifra) y es la elección
      money-safe para un número que va en portada. Confirmar con el humano; ver preguntas abiertas v2.0.
- [ ] **El override manual se conserva y manda**: sigue siendo la **máxima precedencia** y es la herramienta
      para **curar cartas concretas** —corregir un dato malo, empujar una pieza gancho o tapar un hueco del
      proveedor—. Precedencia completa:
      **override manual del admin > dato automático con muestra suficiente (§O.7) > sin dato ⇒ no se
      renderiza** (§O.4).
- [ ] **Nunca se inventa un dato**: una carta **sin dato automático y sin override** simplemente **no muestra
      cifra estimada** en ninguna superficie. No se infiere, no se aproxima, no se interpola desde el precio
      raw ni desde el otro grado, y **no se rellena con el promedio de nada**.
- [ ] **El dato del proveedor no se publica a ciegas**: todo valor automático pasa por el **gate de confianza**
      de §O.7 antes de poder promocionarse. Un ingest automático **sin** ese filtro sería peor que la captura
      manual, porque nadie está mirando cada número.
- [ ] **Guarda de escritura**: el ingest **no escribe** un estimado que caiga bajo el bloqueo de **§O.8** (grado
      con pieza real publicada). La pieza real manda **siempre**.
- [ ] **PriceCharting sigue fuera del MVP** (sin cambio respecto a «Fuera de alcance»).
- [ ] *(Nota operativa para el arquitecto — no es decisión de producto: siguen vivos dos asuntos de **costo de
      operación**, no de producto: el dato exige un **parámetro extra que duplica el consumo de créditos**, y
      hay que confirmar si llega en el **barrido por set** o exige **una petición por carta**. Eso condiciona
      el diseño del ingest y su caching, no el comportamiento visible. Lo que **sí** se despeja es el bloqueo
      anterior: **el formato del payload ya se conoce** — `ebay.salesByGrade`.)*

**O.7 — Confianza del dato: cuándo una cifra se puede PROMOCIONAR (NUEVA 2026-08-28)**
> **El problema que resuelve**: con fuente automática, nadie mira número por número. Una cifra puede llegar
> **vieja**, **apoyada en una sola venta rara**, o **sencillamente mal** (un cero de más, un importe en
> dólares tratado como pesos, las filas de dos grados intercambiadas). Publicar eso **en la rejilla o en la
> portada** es un argumento de venta sostenido por basura.
> **La regla de fondo, en una frase**: **la ficha informa, la rejilla promociona** — y **promocionar exige
> confianza**. Por eso el listón es distinto en cada superficie y **no** es una inconsistencia.
> **Todo esto se evalúa server-side y ninguno de sus insumos viaja al cliente** (extiende SEC-A1).

- [ ] **Prueba 1 — FRESCO** *(reescrito 2026-08-31 — **decisión 61**; ya **no es supuesto**, está resuelto)*:
      el umbral es **`graded_estimate_freshness_days` = 30** y **se aplica en dos momentos**, porque
      **`evidenceDate` no se persiste**: **al bajar** el dato se exige que la **última venta de la muestra**
      no pase de 30 días, y **al leerlo** se exige que la **fila** no lleve más de 30 días desde su
      **captura**. **Son dos relojes que se suman: el peor caso real es 60 días**, y el dueño **lo aceptó**.
      **El dial se queda en 30 — poner 60 ahí lo llevaría a 120.** Para un **override manual** hay **un solo
      reloj**: la fecha en que el admin lo fijó.
- [ ] **Prueba 2 — ORIGEN CONFIABLE**: la cifra debe venir de **una de dos** fuentes:
      (a) un **override manual del admin** —una persona lo puso a propósito—, o
      (b) un **dato automático con muestra suficiente**: al menos **`minSalesSample`** ventas cerradas de ese
      grado en la muestra del proveedor.
      **Dial nuevo `minSalesSample`, default 5** *(SUPUESTO revisable)*. Con muy pocas ventas la mediana deja
      de significar algo: una sola operación atípica la desplaza entera, y esa cifra acabaría en portada.
- [ ] **Prueba 3 — COHERENTE EN MAGNITUD**: la cifra tiene que ser creíble frente al precio raw publicado de la
      misma carta. Son **tres cotas complementarias, no redundantes** — cada una caza un error distinto, así
      que **ninguna se puede relajar** por creerla cubierta por otra:

| Cota | Regla | Qué error caza |
|---|---|---|
| **Inferior** *(invariante, no es dial)* | `estimadoPSA10 > precioVentaRaw` | El **error de unidades USD/MXN** y el **dato absurdo**. Un PSA 10 de **USD 60** capturado como pesos queda en **MX$60** frente a un raw de **MX$400**: la cifra aterriza **por debajo** del precio raw. Un PSA 10 que «vale» menos o igual que la carta sin gradear no es una oportunidad: es un dato roto. |
| **Superior** *(dial `maxGradedMultiple`, default **100×**, SUPUESTO)* | `estimadoPSA10 ≤ precioVentaRaw × maxGradedMultiple` | El **cero de más** (error de dedo al alza). Un múltiplo de upside enorme existe de verdad en cartas reales, así que la cota va holgada; lo que atrapa es el salto de orden de magnitud. |
| **Orden de grados** | `estimadoPSA10 ≥ estimadoPSA9` (cuando existen los dos) | Las **filas con el grado intercambiado**. Un PSA 9 que vale más que su PSA 10 es, en la práctica, un cruce de datos. |

- [ ] **Aplicación por superficie — el punto de la decisión** *(actualizada 2026-08-31)*:
      **Rejilla de Compra, vitrina del home y carrusel «Piezas destacadas»** *(promoción)* → exigen **las tres
      pruebas** **y** el gate de ROI (§O.2). Si falla cualquiera, la teja —de rejilla o de destacadas— se ve
      **exactamente como hoy** y la carta **no entra** a la vitrina: sin badge vacío, sin $0, sin guion, sin
      rastro visual.
      **Ficha** *(información)* → **informa lo que hay**. Aplican **frescura** y **origen confiable**; la
      **coherencia de magnitud NO se aplica con la misma dureza**: una cifra incoherente **no se oculta en la
      ficha**, pero **sí bloquea la promoción**.
- [ ] **Una cifra incoherente levanta alerta interna** *(SUPUESTO)*: cuando falla la prueba 3, la carta entra a
      una **lista de revisión en el back-office** para que el dueño la corrija con override o la descarte. Es
      la contrapartida de no ocultarla en la ficha: si decidimos seguir mostrándola, alguien tiene que
      enterarse. Confirmar con el humano; ver preguntas abiertas v2.0.
- [ ] **Diales nuevos, editables sin deploy y auditados** (M10, junto al resto):
      **`minSalesSample`** (default **5**) y **`maxGradedMultiple`** (default **100×**). La cota inferior
      (`PSA10 > raw`) y el orden de grados **no son diales**: son invariantes de producto.
- [ ] **Nada de esto se filtra**: ni el **tamaño de la muestra**, ni los **umbrales**, ni el **resultado** del
      gate viajan al cliente. Lo único observable desde fuera es **qué cartas llevan cifra en la rejilla y en
      destacadas, cuáles no, y qué cartas arma la vitrina**.

**O.8 — Guarda de dinero: un estimado NUNCA pisa el precio de una pieza real (NUEVA 2026-08-28)**
> **El invariante**: **un estimado jamás puede determinar el precio de venta de una pieza real.**
> **Por qué existe esta guarda**: el estimado por grado y el precio de un **slab real** de ese mismo grado
> **comparten la misma fila de precio** (carta + grado). Así que si el admin captura «PSA 10 ≈ MX$9,000» como
> **estimado** de una carta de la que **ya tenemos un PSA 10 publicado en inventario**, ese número **cambia el
> precio al que se está vendiendo el slab**. Es dinero real movido por una cifra ilustrativa — exactamente lo
> que §O.4 promete que no puede pasar.

- [ ] **Bloqueo duro de captura**: el back-office **rechaza** capturar o editar un **estimado** del grado **G**
      para una carta que tiene **al menos una pieza real de grado G publicada** en inventario. El error
      **explica el porqué** en lenguaje de negocio, no un código: *«Esta carta ya tiene una PSA 10 publicada.
      Ese precio es dinero real, no un estimado; para cambiarlo, edita el precio de la pieza.»*
- [ ] **Aplica igual al ingest automático** (§O.6): si el proveedor trae un valor para el grado G y existe una
      pieza real publicada de ese grado, **no se escribe**. La **pieza real manda siempre**.
- [ ] **El bloqueo no apaga el gancho** *(SUPUESTO)*: la carta raw sigue mostrando —y pudiendo promocionarse
      por— **el otro grado**, si ese otro grado sí tiene cifra y pasa sus gates.
- [ ] **Sentido inverso** *(SUPUESTO — complemento necesario, confirmar)*: si **después** se publica una pieza
      real de grado G y esa carta ya tenía un estimado de G, el estimado **deja de gobernar ese precio y deja
      de usarse** como estimado para ese grado. No puede quedar un estimado viejo determinando el precio de un
      slab que se está vendiendo.
- [ ] **Auditado** (M10): todo intento bloqueado —manual o del ingest— queda **registrado**, para que se vea si
      la guarda está saltando seguido y por qué.

**O.9 — Flujos críticos (base para el E2E de QA)**
> **Camino feliz — el gancho hace su trabajo:**
> 1. El admin tiene publicada en Compra una carta **raw** con precio de venta fijado (precio derivado de la
>    curva de §N), y el **ingest automático** (§O.6) trae sus valores **PSA 10 y PSA 9** desde
>    `ebay.salesByGrade` con **muestra suficiente**.
> 2. La cifra **pasa el gate de confianza** (§O.7: fresca, origen confiable, coherente en magnitud) y los
>    valores **pasan el gate de ROI** con los diales por defecto (**escalón de costo** que corresponda a esa
>    carta según §O.2.1 + `minUpsidePct` 30%) → la carta queda **promocionable**.
> 3. Un visitante entra al **home** y ve la vitrina **«Joyas para gradear»** con esa carta **y su cifra**;
>    si esa misma carta está además entre las **«Piezas destacadas del catálogo»**, su teja del carrusel
>    **también lleva la burbuja** (aparece en **las dos** secciones, sin deduplicar). El home lleva **una**
>    nota al pie que cubre ambas.
> 4. Entra a **Compra** y ve la **teja con el badge y la cifra** (estimado PSA 10 + micro-aviso + llamada), y
>    la página lleva su **nota al pie completa**.
> 5. Abre la **ficha** y ve **solo**: el **precio de la carta**, el **estimado PSA 10**, el **estimado PSA 9**,
>    el **micro-aviso** y la **llamada al pie**. **No ve** multiplicador, ganancia,
>    costo de gradeo, tamaño de muestra, comparativa **ni fecha del dato**
>    *(la fecha se retiró por la **decisión 62**; ver §O.3(1) y criterio **119**)*.
> 6. Cambia el idioma a **inglés** y todos esos textos —micro-aviso y nota al pie incluidos— salen en inglés.
>
> **Flujo crítico — la curaduría protege al comprador:** el admin sube `minUpsidePct` (o el estimado PSA 9
> baja) de modo que la carta **deja de pasar el gate de ROI** → al recargar, **desaparecen el badge de la
> rejilla, la burbuja de su teja en destacadas y su entrada en la vitrina** sin dejar rastro visual (ni hueco,
> ni $0, ni «pendiente»); **la teja de destacadas sigue estando en el carrusel** (solo perdió la burbuja);
> **la ficha sigue mostrando sus estimados** (ahí no aplica el gate de ROI) y **el precio de venta de la carta
> no cambió**.
>
> **Flujo crítico — destacadas: la burbuja se suma, no cura el carrusel** *(NUEVO 2026-08-31)*: con un
> carrusel de **«Piezas destacadas»** de 8 cartas donde **solo una** pasa ambos gates → el carrusel muestra
> **las mismas 8 tejas, en el mismo orden por precio descendente**, y **solo esa una** lleva burbuja. Con
> **cero** cartas que pasen, el carrusel se ve **exactamente como hoy**: **8 tejas, ninguna burbuja**, y **el
> carrusel NO desaparece** (a diferencia de la vitrina, que sí deja de renderizarse). *(Ver la advertencia de
> §O.3: por ordenarse por precio descendente, este escenario «ninguna burbuja» es **el esperado**, no un
> defecto.)*
>
> **Flujo crítico — el gate de confianza filtra basura:** tres cartas con dato automático —una con **muestra
> por debajo de `minSalesSample`**, otra con **PSA 10 por debajo de su precio raw** (el caso del importe en
> dólares tratado como pesos) y otra con **PSA 10 por encima de `maxGradedMultiple`** (el cero de más)—
> **no llevan cifra en rejilla ni en destacadas, ni entran a la vitrina**. Las dos últimas **sí siguen
> informándose en su ficha** y **sí aparecen en la lista de revisión** del back-office.
>
> **Flujo crítico — el estimado no puede mover dinero real:** una carta con un **PSA 10 real publicado**; el
> admin intenta capturarle un **estimado PSA 10** → **se rechaza con mensaje explicativo**, el **precio del
> slab queda idéntico** y el intento queda **auditado**. El ingest automático, con el mismo escenario,
> **tampoco escribe**.
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
> **Flujos negativos que QA debe cubrir:** carta **sin estimado PSA 9** (aunque tenga PSA 10) → **no se
> promociona en ninguna superficie de promoción** (sin badge en rejilla, fuera de la vitrina, sin burbuja en
> destacadas), pero **la ficha sí muestra el PSA 10**; carta **sin dato y sin override** → no muestra cifra
> en ninguna superficie; carta **gradeada** y **sellado** → nunca muestran cifra estimada; **cero cartas
> promocionables** → la vitrina del home **no se renderiza** **y el carrusel de destacadas sigue
> renderizándose sin ninguna burbuja** *(esto último **no es defecto** — ver §O.3)*; **tabla de escalones vacía o con hueco** → la
> carta no se promociona y **nunca** se asume costo $0; **payload inspeccionado desde el cliente** → **no
> contiene** ganancia neta, escalón de costo, `minUpsidePct`, `minSalesSample`, `maxGradedMultiple`, tamaño de
> muestra ni flag de elegibilidad (SEC-A1); **DTO manipulado** → no mete cartas a la vitrina, no cambia el
> orden ni las cifras; **estimado rancio** (fila con más de 30 días **desde su captura**; y muestra cuya última
> venta pase de 30 días **ni siquiera se ingiere** — dos relojes, peor caso 60 días **aceptado**, decisión 61)
> → no se muestra; **PSA 9 mayor que
> el PSA 10** → no se promociona; **feature-flag apagado** → ninguna superficie muestra cifra; **página con
> cifra estimada pero sin nota al pie**, o **cifra sin llamada/micro-aviso** → defecto **bloqueante**.

## Fuera de alcance (por ahora — fase 2 o posterior)
- **Consignación / marketplace C2C** (cartas de terceros vendidas dentro de la bóveda).
- **Order-book / trading instantáneo** (compra/venta digital tipo bolsa dentro de la bóveda).
- **Wallet de saldo** para usuarios (el dinero se liquida por transacción).
- **Pagos y logística automatizados** (guías automáticas, pagos SPEI automáticos): en MVP son manuales.
- **Grading propio o integración directa con PSA/CGC** *(alcance ACLARADO en v2.0 — ver §O)*: lo que queda
  fuera es **gradear cartas nosotros**, **ofrecer o intermediar el servicio de gradeo**, **enviar cartas del
  cliente a PSA/CGC**, y **verificar slabs por integración** (API de submission o de verificación de
  certificados; el `certNumber` se verifica **a mano** en la web de la graduadora, §H).
  **Esta exclusión NO cubre mostrar estimados informativos de valor por grado**: el **valor estimado si se
  gradea** (**§O**, PSA 10 / PSA 9) es una **función de presentación de precios de mercado** —igual que
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
  de proveedor sin tocar el resto del sistema. *(**Actualizado 2026-08-28**: el **ingest automático de valores
  PSA** —que en la redacción anterior quedaba en «fase 2 bloqueada»— **ENTRA al MVP**: el formato del payload
  ya se conoce (`ebay.salesByGrade`) y la fuente del gancho de grading pasa a ser **automática**, con override
  manual como respaldo — ver **§O.6**.)*
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
- **Vender el servicio de gradeo** *(v2.0, §O)*: **no** ofrecemos, cobramos ni intermediamos el gradeo de
  cartas; **no** recibimos cartas para mandarlas a PSA, **no** hay "manda tu carta a gradear con nosotros", ni
  ahora ni como upsell del checkout. El gancho **solo informa** un valor estimado.
- **Garantizar el grado** *(v2.0, §O)*: la plataforma **no promete** que una carta obtenga PSA 10, PSA 9 ni
  ningún grado, y **no** ofrece compensación, recompra ni devolución si el grado obtenido resulta menor al
  estimado mostrado. El estimado **no crea ningún derecho** para el comprador (ver disclaimer, §O.5).
- **Integración con PSA (o cualquier graduadora) para enviar/verificar cartas** *(v2.0, §O)*: sin API de
  submission, sin seguimiento de envíos a la graduadora, sin verificación automática de `certNumber`. El slab
  se sigue verificando **a mano** en la web de la graduadora (§H).
- **PriceCharting como fuente del estimado por grado** *(v2.0, §O)*: **sigue fuera del MVP** (sin cambio
  respecto al punto de PriceCharting de arriba). La fuente del estimado es **PokemonPriceTracker** (ingest
  automático sobre `ebay.salesByGrade`) + **override manual del admin**.
- **Otras graduadoras y otros grados** *(v2.0, §O)*: el MVP cubre **solo PSA 10 y PSA 9**. **CGC / BGS / TAG**
  y los grados **PSA 8 o menores** quedan fuera; añadirlos es fase 2.
- **Estimado por grado en gradeadas y en sellado** *(v2.0, §O)*: el gancho es **solo para raw**. Una carta ya
  gradeada tiene grado real (el slab) y el sellado no se gradea.
- **Usar el estimado por grado como dinero real** *(v2.0, §O)*: el estimado **nunca** alimenta el precio de
  venta, la valuación/tendencia del portafolio, la cotización de buylist, el costo de inventario ni el P&L de
  M7. Es exclusivamente presentación — y **§O.8** cierra el único caso en que podría dejar de serlo.
- **Historial / gráfica de tendencia del valor gradeado** *(v2.0, §O)*: en el MVP se muestra el **estimado del
  día**, no una serie histórica del precio PSA 10/9. Es fase 2 si se decide.
- **Calculadora interactiva de ROI de gradeo** *(v2.0, §O)*: el comprador **no** ajusta parámetros (costo de
  gradeo, grado objetivo, cantidad) desde la tienda. Los diales son **del admin** y el cálculo es
  **server-side**; una calculadora para el cliente sería fase 2.
- **Mostrar el tamaño de la muestra de ventas al comprador** *(v2.0, §O.7)*: el **número de ventas** que
  sostiene la cifra es un **insumo interno** del gate de confianza; no se pinta ni viaja al cliente. Exponerlo
  como señal de credibilidad sería ampliar la superficie visible y es otra decisión (ver preguntas abiertas).
- **Sellado por curva de valor de mercado** *(v2.0, §N.10)*: el **sellado conserva su spread por
  presentación** (§K: `override > spread por presentación > spread global > PRICE_PENDING`, con la fórmula y
  las semillas de **§K** — siete presentaciones + global). Migrarlo a la
  curva de §N sería **otra decisión**, no entra en v2.0.
- **Piso o bin diferenciados por acabado** *(v2.0, §N.10)*: **descartado explícitamente por el humano** —
  cuesta **~2% de utilidad** y **no vale su complejidad**. El piso de venta y el bin de compra son **únicos y
  globales**.
- **Curvas de precio distintas por rareza, acabado o set** *(v2.0, §N.10)*: la rareza y el acabado **salen del
  pricing** (§N.4); reintroducirlos como eje de precio por otra puerta contradice la decisión.
- **Calibración automática de la curva** *(v2.0, §N.10)*: en v2.0 la instrumentación (§N.8) **recolecta** el
  dato y el dueño **mueve los puntos a mano**. Que el sistema ajuste la curva solo es fase posterior.
- **Herencia «acabado → regla del tier de su rareza»** *(v2.0)*: **superada** — con la curva **no hay tier del
  cual heredar**; la pantalla que lo prometía se retira (§N.9).

## Restricciones y preferencias técnicas
> Registradas como datos/preferencias del humano; el stack y la arquitectura los decide el arquitecto.
- **Pagos**: **Stripe**; **sin balance/saldo** de dinero en la plataforma (liquidación por transacción).
- **Impuestos**: precios mostrados **sin IVA**; **IVA 16%** se desglosa como **línea aparte en checkout** y
  se incluye en el total. **Facturación CFDI manual por correo** en el MVP (sin PAC): el cliente solicita
  factura enviando sus datos fiscales; el IVA cobrado se guarda para M7.
- **Precio de venta vs valor de mercado**: el **valor de referencia/mercado** (mostrado y usado para valuar
  portafolio) es la referencia del día; el **precio de venta** que se cobra es **referencia + markup
  configurable** (dial en M10).
- **Precio de cartas = curva por valor de mercado** *(v2.0, §N.1, supersede el pricing por rareza/tier)*:
  `venta = redondeo↑(max(piso, mercado × markup(mercado)))` y `compra = max(bin, mercado × pct(mercado))`, con
  `markup` decreciente y `pct` creciente, **interpolados** entre puntos de quiebre (**nunca escalonados**).
  **Piso y bin únicos y globales** (no por rareza ni por acabado). Diales iniciales (MXN, calibrables):
  **piso $25**; **markup 1.60× ≤$25 → 1.15× en $80 → plano**; **bin $1**; **pct 30% ≤$25 → 40% en $100 → 50%
  en $500 → plano**; **redondeo↑ $5 <$200 · $10 <$500 · $25 arriba**. Aplica a **raw y gradeadas**; el
  **sellado no** (§K). La **rareza sale del pricing y entra a la validación** (§N.5) y el **acabado sigue
  siendo identidad de variante** aunque ya no tenga regla de precio (§N.4).
- **Tabla de puntos editable desde admin** *(v2.0, §N.3)*: se pueden **agregar, mover y borrar** renglones
  (no es una estructura fija de N puntos), sin redeploy y auditado; con **validaciones** que rechazan una
  curva de venta no monótona, una compra ≥ venta o un precio de venta por debajo del mercado.
- **`priceBasis` — qué determinó el precio** *(v2.0, §N.7)*: el backend **registra y expone**
  `mercado / piso / override / bounty / pendiente` por variante. Alimenta la regla de visibilidad, el
  guardarraíl y la detección de pisos mal calibrados; **no se infiere en el cliente**.
- **Visibilidad del «valor de mercado»** *(v2.0, §N.7)*: del lado de **venta** (**solo** ficha de carta y
  ficha de sellado; no tejas ni listados) el valor de mercado **solo se muestra cuando el mercado determinó
  el precio publicado**; si lo determinó el **piso** o un **override**, no se muestra. La **bóveda/portafolio
  del cliente no cambia** y el **cotizador de buylist tampoco**.
- **Bounty revalidado contra la regla vigente** *(v2.0, §N.6)*: un bounty por debajo de la regla de compra
  vigente **deja de ser bounty** (no aplica en cotización, no se publica, alerta en el binder); se valida
  **al crear, al cotizar y al publicar**. El **override manual de compra sigue siendo absoluto**.
- **Instrumentación de dinero** *(v2.0, §N.8)*: cada venta y cada compra registran **mercado del día, precio
  final, qué lo determinó, acabado y bracket de mercado**, para poder calibrar la curva con datos.
- **Fuentes de precio (MVP = 100% free tier)**, tras un **`PricingProvider` intercambiable**:
  | Tipo de producto | Fuente primaria | Respaldo |
  |---|---|---|
  | raw / singles | TCGPlayer "Market Price" vía **pokemontcg.io** | override manual del admin |
  | gradeadas (PSA/CGC) | **PokemonPriceTracker** (free 100/día) o **PokeTrace** (free 250/día) | override manual del admin |
  | sellado *(actualizado v1.6, §K)* | **precio DERIVADO de TCGCSV** (spread por presentación; fórmula en §K) vía mapeo curado | **override manual del admin** (máxima precedencia); sin spread aplicable ⇒ **PRICE_PENDING** (no se publica) |
  - Solo se prician las cartas **en bóveda** (no el catálogo completo) + **cache diario**, para que el free
    tier alcance. **PriceCharting no se usa en el MVP.** **TCGCSV es fuente de precio SOLO del sellado**; para
    raw/singles no cambia nada (sigue pokemontcg.io/TCGPlayer).
- **Fuente del valor estimado por grado (§O, v2.0) — INGEST AUTOMÁTICO + override manual** *(actualizado
  2026-08-28; supersede el arranque «manual-first»)*: el estimado **PSA 10 / PSA 9** se alimenta
  **automáticamente desde PokemonPriceTracker** —proveedor **ya contratado**, API key en el **entorno de
  despliegue (Railway)**, no en el repositorio—. El proveedor **no valúa nada**: entrega **ventas cerradas
  reales de eBay agrupadas por grado** (`ebay.salesByGrade`) con **número de ventas de la muestra, mediana,
  promedio y fecha de la última venta**; publicamos la **mediana** *(SUPUESTO)*. El **override manual de
  precio que ya existe** (`POST /admin/pricing/override`) se **conserva** como respaldo y para **curar cartas
  concretas**, y mantiene la **máxima precedencia**. Todo valor pasa por el **gate de confianza** de §O.7
  antes de poder promocionarse. **PriceCharting sigue fuera del MVP.** El estimado es **presentación**: no
  alimenta precio de venta, portafolio, buylist ni P&L —y **§O.8** bloquea el único caso en que podría hacerlo
  (capturar un estimado de un grado que ya tiene pieza real publicada)—.
- **Diales del gancho de grading (§O, v2.0)**: **`gradingCostTiers`** —**tabla de escalones** rango de valor
  declarado → costo de gradeo en MXN, imitando el cobro por nivel de servicio de PSA e **incluyendo envío
  internacional y retorno a México** (defaults en §O.2.1, **SUPUESTO revisable**)—, **`minUpsidePct`** (default
  **30%**) y, desde 2026-08-28, los dos del **gate de confianza**: **`minSalesSample`** (default **5**,
  SUPUESTO) y **`maxGradedMultiple`** (default **100×**, SUPUESTO). Todos **editables sin deploy** y
  **auditados**. *(SUPUESTO: viven en **M10 (Config y bitácora)** con el resto de diales; alternativa razonable
  es M2 por ser pricing. Confirmar; ver preguntas abiertas v2.0.)* *(Nota para el arquitecto: el patrón de
  tabla configurable que se citaba antes —tiers de rareza, `GET/PUT /admin/pricing/tiers`— **se retira** con
  §N (criterio 96); el patrón vivo equivalente es el **editor de la tabla de puntos de la curva** (§N.3,
  criterio 86).)*
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
  **soporte@tcghunt.mx** *(corregido 2026-08-31: decía `soporte@tcgvault.mx` y afirmaba que convivía con un
  segundo dominio; **no hay dos dominios** — todos los buzones son de `tcghunt.mx`, ver decisión 36)*. Debe
  aparecer en términos/FAQ
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
  con precedencia `override manual > spread por presentación > spread global > PRICE_PENDING`. Spreads
  configurables (ConfigSetting, M10), **uno por cada una de las siete presentaciones + global de respaldo**:
  la **fórmula** (`mercado × (1 + spread)`, markup arriba del mercado), la tabla de valores y el criterio que
  la ordena («ítem más chico ⇒ % mayor») viven en **§K**, que es su origen único. **Solo venta (sin buylist de sellado)**; **condición propia** (default Mint /
  "Detalle menor en caja") **sin efecto en el precio**. *(Supersede "sellado = precio manual" y "TCGCSV solo
  informativa" — decisión del PO, ago-2026.)*
- **Branch de trabajo**: `claude/tcg-cards-marketplace-oijthj`.
- Stack, base de datos y despliegue: **a decisión del arquitecto** (nada predefinido por el humano).

## Criterios de aceptación
> QA usa esto como checklist. Cada criterio debe ser verificable.
> **⚠ Actualización v2.0 (P-48):** los criterios que describen el precio por **rareza / tier / acabado** quedan
> **SUPERSEDED** por los **79–96** (§N, precio puro por valor de mercado): **12, 12b, 12c, 13**, la parte de
> *precio* de **38**, **43** y **73–78**. **QA no los verifica**; se conservan como registro histórico. De
> ellos **sigue vigente**: la **derivación server-side** (SEC-A1), el principio «**sin dato ⇒ precio
> pendiente, jamás MX$0 ni precio inventado**», y que el cotizador **captura el acabado** (ahora para saber
> **de qué variante** tomar el precio de mercado, no para elegir regla).

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
   *(actualizado v1.6)* con la precedencia `override manual > spread por presentación > spread global >
   PRICE_PENDING` (fórmula en §K)—, con fecha del último refresco; el refresco (cache diario) ocurre al menos
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
3e. El **producto sellado** (las **siete presentaciones** de §K: booster box, ETB, bundle, tin, blister, **UPC**
   y colección) se vende en Compra con **precio de venta
   DERIVADO de TCGCSV por spread** *(actualizado v1.6, ver §K y criterios 57–64)*: la precedencia es `override
   manual > spread por presentación > spread global > PRICE_PENDING` (fórmula en §K), y un ítem en
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
    precedencia), **editar los spreads del sellado de las siete presentaciones de §K + el global de respaldo**
    (ninguna presentación soportada puede quedar fuera del editor),
    y configurar el **tipo de cambio USD→MXN con colchón**, el **editor de la curva de precio por valor de
    mercado** *(v2.0, §N.3: tabla de puntos con agregar/mover/borrar + piso + bin + redondeo; supersede el
    editor por rareza/tier — ver criterios 86–87)* y el **`PricingProvider`** por tipo de producto.
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
    **override manual**, gana el override; **(b)** si no, el **spread de su presentación** (cualquiera de las
    **siete** de §K); **(c)** si no aplica un spread por presentación, el **spread global de respaldo**;
    **(d)** si no hay ninguno, el ítem queda en **PRICE_PENDING**. El precio se calcula **server-side** (no
    se toma del cliente) con la **fórmula de §K** — el spread es un **markup ARRIBA del mercado**.
    **Verificable**: en las vías derivadas (b) y (c) el precio publicado **nunca queda por debajo del precio
    de mercado** del ítem (con spread 0 quedaría exactamente en el mercado). Un **override** sí puede estar
    deliberadamente por debajo (p. ej. descontar una caja con detalle); las vías derivadas **no**.
58. Un sellado en **PRICE_PENDING** (sin override y sin spread/mercado aplicable) **no aparece en Compra**;
    en cuanto adquiere precio (override, o mercado + spread según §K) puede publicarse.
59. El cambio de **base de precio a TCGCSV aplica SOLO al sellado**: el precio de un **raw/single** o de una
    **gradeada** **no** cambia por esto (siguen sus fuentes actuales), verificable comparando que la fuente
    de precio de una carta suelta sigue siendo pokemontcg.io/TCGPlayer y no TCGCSV.
60. El **súper-admin edita en M2** los **spreads del sellado por presentación**, con **las semillas de la
    tabla de §K** (las **siete** presentaciones + global de respaldo); el cambio **surte efecto sin redeploy**,
    queda **auditado** (M10) y **recalcula** el precio derivado de los sellados afectados (salvo los que tengan
    override).
60b. **Las siete presentaciones son operables de punta a punta** *(añadido 2026-08-24 con la decisión del
    dueño sobre `upc`/`collection`)*: para **cada una** de las siete se puede (a) **dar de alta una pieza en
    inventario** y (b) **fijarle spread desde M2** sin que la operación sea rechazada. Verificable con `upc` y
    `collection`, que antes fallaban en ambas puntas (no se podían capturar y el guardado devolvía error), y
    cuyo precio caía al global de respaldo por omisión. Ninguna presentación soportada llega al global **por
    olvido**: el global queda para piezas **sin presentación** o para una regla **retirada a propósito** por el
    dueño.
61. El **sellado es solo venta**: **no existe** flujo de **buylist de sellado** (ni cotizador ni pipeline);
    la **ficha/ventana de sellado muestra el call-out `mailto`** para revender (a `contacto@tcghunt.mx`),
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

**Pricing por tiers — v1.9 (P-34)** · **⚠ SUPERSEDED por v2.0 (P-48): los criterios 73–78 NO se verifican.**
> Los tiers, el mapa rareza→tier y las reglas por acabado **se retiran** (§N). QA verifica en su lugar los
> **criterios 79–96**. Se conservan como registro histórico del comportamiento anterior.
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

**Precio puro por valor de mercado — v2.0 (P-48, LOCKED)**
79. **Curva de VENTA (money)**: el precio publicado de una carta es
    **`redondeo↑( max( piso, mercado × markup(mercado) ) )`**, con `markup` **interpolado** entre los puntos
    de la tabla. Verificable con los diales iniciales (§N.2): mercado **$1.14 ⇒ $25** (gana el piso) ·
    **$25 ⇒ $40** · **$50 ⇒ $70** · **$80 ⇒ $95**. El precio **no depende de la rareza ni del acabado**.
80. **Curva de COMPRA (money)**: la oferta de buylist es **`max( bin, mercado × pct(mercado) )`**, con `pct`
    **interpolado** y **sin redondeo**. Verificable con los diales iniciales: mercado **$0.50 ⇒ $1** (gana el
    bin) · **$10 ⇒ $3** · **$25 ⇒ $7.50** · **$100 ⇒ $40** · **$300 ⇒ $135** · **$500 ⇒ $250**. En particular,
    una **Common que vale cientos de pesos deja de recibir MX$0.50**.
81. **Interpolada, nunca escalonada**: entre dos puntos de quiebre el valor se **interpola**; **no existe
    ningún tramo escalonado** dentro del rango. Verificable barriendo el mercado peso a peso: **no hay saltos
    de `markup`/`pct`** entre dos mercados contiguos (solo los saltos del redondeo, criterio 82), y **ningún
    precio de venta queda por debajo del mercado** en ningún punto del rango.
82. **Escalera de redondeo hacia arriba (decisión 5)**: el precio de venta se redondea **hacia arriba** a
    múltiplo de **$5 por debajo de $200**, **$10 por debajo de $500** y **$25 de ahí en adelante**.
    Verificable en el brinco corregido: mercado **$86 ⇒ $100** y mercado **$87 ⇒ $105** (**no $110**). El
    redondeo aplica **solo a venta**; la **compra no se redondea**.
83. **Un solo piso y un solo bin**: piso de venta **$25** y bin de compra **$1**, **globales**. Verificable:
    **dos variantes de acabado distinto de la misma carta con el mismo mercado producen el mismo precio**, y
    dos cartas de **rarezas muy distintas** con el mismo mercado **cotizan idéntico** (en venta y en compra).
84. **La rareza y el acabado salen del pricing, pero el acabado NO sale del modelo**: ningún cálculo de precio
    consulta rareza, tier, mapa rareza→tier ni regla por acabado. Al mismo tiempo, **inventario, overrides,
    bounties y `availableFinishes` siguen siendo por acabado**, y ficha y bóveda **siguen mostrando** el
    acabado. Verificable: dar de alta dos piezas de acabados distintos sigue produciendo **dos variantes
    distinguibles**.
85. **Alcance: raw y gradeadas sí; sellado no**: la curva aplica igual a **raw** y a **gradeadas**. El
    **precio del sellado no cambia** — conserva `override > spread por presentación > spread global >
    PRICE_PENDING` con su fórmula y sus semillas (§K). Verificable comparando el precio de un sellado antes
    y después: **idéntico**.
86. **Tabla de puntos editable — agregar, mover y borrar**: el súper-admin puede **añadir** un punto de
    quiebre, **moverlo** y **borrarlo** en las curvas de venta y de compra desde el back-office, **sin
    redeploy** y **auditado** (M10); **no** es una estructura fija de N puntos. Cambiar un punto **repricia**
    lo afectado en el siguiente cálculo. También son editables **piso**, **bin** y **escalera de redondeo**.
87. **Validaciones de la tabla (money-safe)**: el sistema **rechaza guardar** una tabla que (a) produzca una
    **curva de venta no monótona creciente**, (b) deje la **compra ≥ venta** en algún punto del rango, o
    (c) permita un **precio de venta por debajo del mercado**; el error indica **qué punto** lo rompe.
    Verificable intentando guardar cada uno de los tres casos.
87b. **SIN DATO DE MERCADO ⇒ «PRECIO PENDIENTE», el piso NO rescata (money — LOCKED)**: una variante **sin
    precio de mercado** **no se publica y no se cotiza**, **sea cual sea su rareza**: entra a la **cola de
    precio pendiente** y se escala al dueño. Verificable en los **dos ejes**: una carta **Common** sin dato
    **no aparece en Compra a MX$25** (el piso **no** se usa como respaldo) y **no recibe cotización de MX$1**
    en el cotizador; en ningún caso se muestra **MX$0** ni un precio inventado. *(Razón: el guardarraíl del
    criterio 88 se apoya en la rareza —el proxy que este cambio retira del pricing— y **no atraparía** una
    Common de $400 sin dato; ver §N.2.)*
88. **Guardarraíl — premium en el piso/bin, en los DOS ejes**: si una carta de **rareza premium** (catálogo
    canónico) resuelve su precio **al piso** (venta) o **al bin** (compra) **teniendo dato de mercado**,
    **no se publica** y **no se cotiza**: entra a la **cola de precio pendiente** y se **escala al dueño**,
    hasta que un barrido posterior corrija el dato o el dueño fije el precio. Verificable forzando un mercado
    **presente pero absurdamente bajo** (aplanado, no ausente — ese caso es el 87b) en una
    Illustration/Ultra Rare: **no aparece en Compra**, **no se cotiza en el cotizador** y **sí aparece en la
    cola**. El volumen es **≈3 de 333** cartas de un master set completo (no debe ser una alarma ruidosa).
89. **Precedencia de precio (money-safe)**: venta = `override por pieza > override de variante > curva >
    pendiente`; compra = `bounty válido > override de compra > curva > pendiente`. El **override manual de
    compra sigue siendo ABSOLUTO**: puesto **por debajo** de la regla vigente, **paga exactamente ese monto**
    y **no** se levanta al nivel de la curva.
90. **Bounty revalidado contra la regla vigente (decisión 4)**: un bounty **por debajo de la regla de compra
    vigente** **deja de ser bounty**: **no aplica en la cotización** (se paga la regla), **no aparece en la
    vitrina** (ni Home ni Vender) y **genera alerta en el binder**. Se valida **al crear, al cotizar y al
    publicar** (hoy solo al crear). Verificable: crear un bounty válido, **subir el mercado** hasta que la
    regla lo rebase ⇒ desaparece de la vitrina, la cotización paga **la regla** y aparece **la alerta**.
91. **El número publicado es el que se paga**: para **todo** bounty visible en la vitrina, la cotización del
    cotizador es **exactamente ese monto** y es **estrictamente mayor** que la tarifa estándar de esa variante.
92. **`priceBasis` — qué determinó el precio**: el backend **registra y expone** por variante qué determinó el
    precio publicado: **`mercado` / `piso` / `override` / `bounty` / `pendiente`**. La UI y el back-office lo
    **consumen**; **no** se infiere en el cliente comparando cifras. Verificable en el contrato y en la
    respuesta de la API, y usable para **detectar pisos mal calibrados**.
93. **«Valor de mercado» solo si el mercado fijó el precio**: en la **ficha de carta** y en la **ficha de
    sellado**, el bloque «Valor de mercado» se muestra **solo** cuando `priceBasis = mercado` (en sellado:
    precio derivado por **spread**); si lo determinó el **piso** o un **override**, **no aparece** (ni en cero,
    ni tachado, ni «—»). Aplica **solo a la ficha**: tejas y listados no muestran mercado. **Empate**
    (`piso == mercado × markup`) cuenta como **mercado** y **sí** se muestra.
94. **Lo que NO cambia con la visibilidad**: (a) el **cotizador de buylist** sigue **sin** mostrar valor de
    mercado (solo la mención del subtítulo); (b) la **bóveda/portafolio del cliente** sigue mostrando el
    **valor de mercado** de lo que ya posee, con valuación y gráfica de tendencia **idénticas**; (c) una
    carta en **«precio pendiente»** sigue **sin publicarse** en Compra y el comprador **nunca** ve ese estado
    (los dos caminos a esa cola son los criterios **87b** y **88**); (d) el **precio cobrado no cambia** por
    esta regla (es presentación, no dinero).
95. **Instrumentación**: **cada venta y cada compra** registran **mercado del día**, **precio final**, **qué
    lo determinó** (`priceBasis`), **acabado** y **bracket de mercado**. Verificable: tras una venta y una
    compra existe el registro con los **cinco** campos, y permite **agregar por bracket** para responder
    «¿qué tan rápido rota cada bracket?».
96. **Retiro de lo viejo, sin residuos**: desaparecen del producto los modos **`fixed`/`pct`** como reglas
    excluyentes, los **5 tiers**, el **mapa rareza→tier** y las **reglas por acabado**, junto con la pantalla
    de M2 que los editaba y su **texto falso** («Sin regla propia, el acabado hereda la del tier de su
    rareza» / «Hereda tier»). Verificable: **no queda en la UI ninguna pantalla que pida una regla por
    rareza, tier o acabado**, el editor de precios es el de la **tabla de puntos** (criterio 86), y **ninguna
    variante conserva un precio calculado con la lógica vieja** tras el repricio completo del catálogo.

**Valor estimado si se gradea — «gancho de grading» — v2.0 (§O)**
> **Nota de numeración**: este bloque se numeraba **79–92** en su borrador. Como los criterios **79–96** ya
> están tomados por **§N (precio puro, LOCKED, en producción)**, se **renumera a 97–112**. El contenido de
> cada criterio no cambió por la renumeración; lo que cambió por decisión de producto está marcado.
> *(2026-08-31 se añaden los criterios **113** —burbuja en «Piezas destacadas», la cuarta superficie— y
> **114** —marca en el descargo y disparador de revisión por razón social—; el bloque va ahora de **97 a
> 114**.)*

> **Nota de verificación 1 (actualizada 2026-08-28)**: la fuente del estimado es el **ingest automático** de
> PokemonPriceTracker sobre `ebay.salesByGrade` (§O.6), con **override manual** como respaldo y máxima
> precedencia. QA puede montar cualquiera de estos criterios **con override manual** cuando necesite fijar
> valores exactos; el comportamiento visible es el mismo venga el número de donde venga.

> **Nota de verificación 2 (2026-08-23)**: el cálculo del gate **no se pinta**, así que estos criterios se
> verifican por **presencia/ausencia** (qué carta aparece en qué superficie), por **orden** (el de la vitrina)
> y por **inspección del payload** (que no viajen los insumos del cálculo) — **no** comparando cifras
> derivadas en pantalla.

> **Nota de verificación 3** *(2026-08-28; **reescrita 2026-08-31, M-46**)*: la feature vive tras **un solo
> interruptor**, apagado de fábrica. **Ya no está condicionado a aprobar el texto legal**: el disclaimer está
> **aprobado por el dueño** (decisión 59) y lo que queda abierto —la **revisión legal profesional**— **no
> bloquea el encendido**. QA verifica estos criterios **con el interruptor encendido** en el entorno de
> prueba, y verifica **además** que **apagado** ninguna superficie muestra cifra estimada **y** el barrido no
> pide ni escribe ninguna (**cero créditos**). **Aviso de dinero para QA** *(decisión 60, `ARCHITECTURE.md`
> §4.38(r.6.3))*: encender y apagar **gasta créditos reales**, así que el ciclo on/off **no se prueba** contra
> un entorno con credencial viva del proveedor — se prueba **sin credencial** o **con la sonda encendida**.

97. **El gate decide QUÉ SE PROMOCIONA (curaduría), no qué se ve** *(actualizado 2026-08-31: las superficies
    de promoción son **tres** — rejilla, vitrina y destacadas)*: una carta raw publicada lleva cifra en
    **teja de Compra**, entra a la **vitrina** y lleva **burbuja en su teja de destacadas** **si y solo si**
    `estimadoPSA9 ≥ (precioVentaRaw + gradingCost) × (1 + minUpsidePct)` —con
    `gradingCost` = **escalón** que corresponde a esa carta (criterio 110) y `minUpsidePct` default **30%**—
    **y además** la cifra supera el **gate de confianza** (criterio 111). Verificable con dos cartas límite:
    una que pasa **por poco** (**aparece** el badge / entra a la vitrina) y otra **justo por debajo** (**no
    aparece**). En **ambos casos la ficha muestra sus estimados**, porque la ficha **no depende del gate de
    ROI**. El **PSA 10 no interviene**: una carta con PSA 10 altísimo pero PSA 9 que no pasa el gate **no se
    promociona**.
98. **Sin estimado PSA 9 no se promociona, pero la ficha sí informa**: una carta con estimado **PSA 10** pero
    **sin** estimado **PSA 9** **no lleva cifra en ninguna superficie de promoción** (rejilla, vitrina ni
    destacadas); **su ficha sí muestra el PSA 10**. El sistema
    **no infiere ni interpola** el PSA 9 a partir del PSA 10.
99. **Ficha: solo precio + los dos estimados (verificación de AUSENCIA)** *(actualizado 2026-08-31 por la
    **decisión 62**: se retira «la fecha del dato» de la lista de lo que la ficha muestra)*: la ficha de una
    carta raw con dato muestra **exactamente**: el **precio de venta de la carta**, el **estimado PSA 10**, el
    **estimado PSA 9**, el **micro-aviso** y la **llamada al pie** (criterio 103). Y **NO muestra** —en
    ninguna forma— **multiplicador**, **diferencia/ganancia**, **porcentaje de rendimiento**, **costo de
    gradeo**, **escalón aplicado**, **tamaño de la muestra de ventas**, **comparativa** **ni fecha alguna
    junto a los estimados** (criterio **119**). Verificable buscando
    en la página renderizada la ausencia de esos elementos.
100. **La cifra SÍ se pinta en la rejilla de Compra** *(actualizado 2026-08-28)*: una teja de carta que pasa
    **el gate de ROI y el de confianza** muestra el badge **con el estimado PSA 10** (más micro-aviso y
    llamada); una teja que **falla cualquiera de los dos** se ve **exactamente igual que hoy** —**sin** badge
    vacío, tachado, en gris ni con placeholder—.
101. **Vitrina «Joyas para gradear»: la cifra, el contenido y el ORDEN** *(actualizado 2026-08-28)*: el home
    muestra una vitrina con cartas que pasan **ambos gates**, **publicadas y disponibles**, **cada una con su
    cifra visible** y **ordenadas de mayor a menor ganancia neta sobre PSA 9**. Verificable con tres cartas de
    ganancia neta conocida y distinta: **aparecen en ese orden**. La **cifra que ordena no se muestra ni viaja
    al cliente** (criterio 107). Si **ninguna carta pasa**, la **vitrina completa no se renderiza** (no aparece
    vacía, ni con placeholder, ni con «próximamente»).
102. **Money-safe — una cifra que no existe (o no es confiable) no se dibuja** *(actualizado 2026-08-28)*: si
    falta un estimado, **esa cifra no aparece**; si falta el PSA 9, el precio o el escalón, **o si la cifra no
    supera el gate de confianza**, la carta **no se promociona**. En **ninguna** superficie aparece **$0**, un
    **guion (`—`)**, un rango inventado ni el texto **«precio pendiente»**. Verificable inspeccionando el HTML
    entregado: **no hay contenedor vacío ni skeleton permanente**.
103. **Disclaimer — patrón de llamada + nota al pie, con micro-aviso adyacente** *(actualizado 2026-08-31)*:
    verificable en las **cuatro** superficies (home **vitrina**, home **destacadas**, listado de Compra,
    ficha):
    (a) **toda cifra estimada** lleva una **llamada visible** (asterisco) y un **micro-aviso** junto a ella que
    carga las dos ideas obligatorias — **«ilustrativo»** y **«no evaluamos esta carta»**;
    (b) **toda página que muestre al menos una cifra estimada** contiene el **texto completo del disclaimer al
    pie**, y la llamada **lleva** a ese texto — **incluido el caso en que la única cifra del home venga del
    carrusel de destacadas y la vitrina no se haya renderizado**;
    (c) el **texto completo es el mismo** en todas las páginas (sin versiones recortadas) y afirma
    explícitamente los **seis** elementos: es **información ilustrativa**, **no evalúa la carta que vendemos**
    (no inspeccionada ni pre-evaluada), **no garantiza ningún grado** (lo determina PSA y puede ser mucho
    menor), **no es oferta/garantía de precio/recompra**, **no gradeamos ni intermediamos** (costo, envío y
    tiempos por cuenta del comprador) y los **precios cambian a diario**;
    (d) todo lo anterior existe en **ES y EN** y cambia con el toggle de idioma (criterio 32).
    **Una página con cifra estimada y sin nota al pie, o una cifra sin llamada/micro-aviso, es un defecto
    bloqueante.**
104. **Diales editables sin deploy y auditados** *(actualizado 2026-08-28)*: el súper-admin edita la **tabla de
    escalones** (`gradingCostTiers`), `minUpsidePct`, **`minSalesSample`** y **`maxGradedMultiple`**; el cambio
    **surte efecto sin redeploy**, queda **auditado** en la bitácora (M10) y **recalcula qué se promociona**
    (verificable: subir `minUpsidePct` de 30% a un valor alto, encarecer un escalón, o subir `minSalesSample`
    por encima de la muestra disponible, **vacía la vitrina y quita los badges de la rejilla y las burbujas de
    destacadas**, **sin tocar ningún precio de venta**, **sin alterar lo que muestran las fichas** y **sin
    cambiar qué tejas contiene el carrusel de destacadas ni su orden**).
105. **Solo raw**: una carta **gradeada (PSA/CGC)** y un **producto sellado** **nunca** muestran cifra estimada
    ni badge, y **nunca** entran a la vitrina, en ninguna superficie.
106. **Fuente automática + override manual** *(REESCRITO 2026-08-28; supersede el criterio de «fase 1
    manual-first»)*: el estimado se alimenta **automáticamente** desde PokemonPriceTracker a partir de
    **ventas cerradas de eBay agrupadas por grado** (`ebay.salesByGrade`: número de ventas, mediana, promedio y
    fecha de la última venta), **sin intervención humana**. Verificable: (a) una carta raw publicada con
    muestra suficiente **muestra su cifra** sin que nadie la capture; (b) el **override manual del admin
    conserva la máxima precedencia** —fijado a mano sobre una carta que ya tenía dato automático, **gana el
    manual**—; (c) una carta **sin dato automático y sin override** **no muestra cifra estimada** en ninguna
    superficie; (d) **jamás** se muestra una cifra inferida, aproximada, interpolada desde el otro grado o de
    respaldo inventada.
107. **El cálculo NO se filtra al cliente (SEC-A1 reforzado)** *(ampliado 2026-08-28)*: inspeccionando la
    **respuesta del servidor** que alimenta home, listado y ficha, **no aparecen** la **ganancia neta**, el
    **escalón / costo de gradeo**, `minUpsidePct`, `minSalesSample`, `maxGradedMultiple`, el **tamaño de la
    muestra de ventas**, ni un **flag de elegibilidad**: solo las **cifras que se pintan** (PSA 10 / PSA 9) y
    la **lista ya curada y ordenada**. En consecuencia, un **DTO manipulado** desde el cliente **no puede**
    meter una carta a la vitrina, **cambiar su posición** ni **alterar una cifra**.
108. **El estimado no contamina el dinero real**: activar o desactivar esta feature **no cambia** el **precio
    de venta** de ninguna carta, el **valor ni la tendencia del portafolio** (§C), la **cotización de buylist**
    (§E/§M), el **costo de inventario** ni el **P&L de M7** — verificable comparando esos valores con la
    feature encendida y apagada.
109. **Frescura del estimado** *(reescrito 2026-08-31 por la **decisión 61**; supersede la redacción anterior,
    que describía un solo reloj contra la fecha de la última venta — eso **no es lo implementado**)*: un
    estimado **rancio deja de mostrarse** en las **cuatro** superficies (y la carta deja de promocionarse).
    El umbral vive en **`graded_estimate_freshness_days`, sembrado en `30`**, y **se aplica dos veces**:
    (a) **al ingerir**, contra la **fecha de la última venta de la muestra** (no se acepta evidencia de más de
    30 días); (b) **al leer**, contra la **fecha de captura de la fila** (a los 30 días de escrita se considera
    rancia), porque **`evidenceDate` no se persiste** y el lector no tiene la fecha de la venta.
    **Consecuencia verificable y ACEPTADA por el dueño: la evidencia detrás de una cifra visible puede tener
    hasta 60 días** (30 + 30). **El dial se verifica en `30`; el peor caso se verifica en `60`. Un dial en 60
    es un DEFECTO**, no el cumplimiento de este criterio. Para un **override manual** aplica **un solo reloj**:
    la **fecha en que el admin lo fijó**.
110. **Costo de gradeo por ESCALONES (no plano)**: el `gradingCost` del gate se **resuelve por tabla de
    escalones** (`gradingCostTiers`, §O.2.1) según el **valor de la carta**, imitando cómo cobra PSA por nivel
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
111. **NUEVO — Gate de confianza: solo se promociona una cifra confiable** (§O.7): una carta entra a **rejilla
    y vitrina** solo si su cifra es **fresca**, de **origen confiable** y **coherente en magnitud**.
    Verificable caso por caso, y en los tres casos la carta **no aparece en rejilla ni en vitrina**:
    (a) **muestra insuficiente** — dato automático con **menos de `minSalesSample` (default 5)** ventas en su
    grado;
    (b) **cota inferior — `estimadoPSA10 ≤ precioVentaRaw`** — es el caso del **error de unidades USD/MXN**
    (un PSA 10 de USD 60 capturado como pesos queda en MX$60 frente a un raw de MX$400, o sea **por debajo**)
    y el del dato absurdo;
    (c) **cota superior — `estimadoPSA10 > precioVentaRaw × maxGradedMultiple` (default 100×)** — es el caso
    del **cero de más**;
    (d) **orden de grados — `estimadoPSA9 > estimadoPSA10`** — filas con el grado intercambiado;
    (e) en los casos **(b), (c) y (d) la ficha SIGUE informando la cifra** (ahí la coherencia de magnitud no se
    aplica con la misma dureza) y la carta **aparece en la lista de revisión** del back-office;
    (f) **ningún insumo del gate** —tamaño de muestra, umbrales o resultado— **viaja al cliente**.
    Las cotas (b), (c) y (d) son **complementarias, no redundantes**: cada una caza un error distinto, así que
    ninguna puede relajarse por creerla cubierta por otra.
112. **NUEVO — Un estimado nunca pisa el precio de una pieza real** (§O.8): con una **PSA 10 real publicada**
    de la carta C, intentar capturar un **estimado PSA 10** para C **se rechaza** con un mensaje que explica el
    porqué en lenguaje de negocio, y **el precio publicado del slab es idéntico antes y después** del intento.
    Verificable además: (a) el **ingest automático** tampoco escribe ese valor cuando existe la pieza real;
    (b) el intento bloqueado queda **auditado** (M10); (c) el bloqueo es **por grado** — la misma carta sigue
    pudiendo mostrar y promocionar **el otro grado** si tiene cifra válida.
113. **NUEVO — Burbuja en «Piezas destacadas del catálogo» (cuarta superficie)** (§O.3 (4)): en el carrusel de
    destacadas del home, una teja **lleva la burbuja con el estimado PSA 10** (más micro-aviso y llamada)
    **si y solo si** esa carta pasa **el gate de ROI y el gate de confianza** —el **mismo listón que la
    rejilla**—. Verificable:
    (a) **el carrusel no se cura ni se reordena**: con las mismas cartas publicadas, **contiene las mismas
    tejas, en el mismo orden por precio descendente**, con la feature **encendida y apagada**;
    (b) una teja que **no** pasa los gates se ve **exactamente como hoy** — **sin** burbuja vacía, tachada, en
    gris ni placeholder;
    (c) con **cero** tejas que pasen, **el carrusel se sigue renderizando completo, sin ninguna burbuja**
    (**no** se aplica la regla de «no renderizar» de la vitrina, criterio 101);
    (d) **vitrina y destacadas coexisten** y una misma carta **puede llevar cifra en ambas** — **no** se
    deduplica ni se excluye de una por aparecer en la otra;
    (e) el **home lleva una sola nota al pie** que cubre las cifras de **ambas** secciones, y **aparece
    también** cuando la única cifra del home viene de destacadas;
    (f) el **copy y el micro-aviso son los mismos** que los de la rejilla (ES y EN, criterio 32);
    (g) **ningún insumo del gate viaja al cliente** en el payload que alimenta el carrusel (SEC-A1,
    criterio 107).
    **NOTA DE EXPECTATIVA PARA QA — un carrusel de destacadas SIN burbujas NO es un defecto**: destacadas
    lista **las cartas más caras**, que son las que caen en los **escalones de costo de gradeo más altos**
    (§O.2.1), así que **lo esperado es que califiquen pocas o ninguna**. El defecto sería lo contrario: una
    **burbuja en una teja que no pasa los gates**, un **hueco/placeholder**, o que el **carrusel desaparezca**.
114. **NUEVO — El descargo nombra a la MARCA hoy, y se revisa cuando exista la razón social** (§O.5): el texto
    del descargo (ES y EN) dice **«TCG HUNT»** —la marca, `common.brand.name`— y **no** «TCG Vault MX»;
    verificable en las cuatro superficies y en los dos idiomas. **Disparador de revisión obligatoria**: el día
    en que se cargue la **razón social** (`common.footer.legalEntity`, hoy pendiente), **§O.5 se revisa antes
    de dar por bueno el descargo**, con la recomendación del PO de nombrarla —patrón **«TCG HUNT, marca
    operada por [Razón social]»**— y aplicando **el mismo criterio a los términos** (`legal.intro`), para que
    no digan cosas distintas. **La redacción definitiva la aprueba el humano** (pregunta abierta 20); este
    criterio **no da por cerrada** esa redacción, solo **obliga a no olvidar la revisión**.
115. **NUEVO — La marca y el dominio son TCG HUNT / `tcghunt.mx` en TODA superficie visible** *(2026-08-31,
    decisión 58)*: **ninguna** superficie que el usuario vea o reciba contiene la cadena **«TCG Vault MX»** ni
    los dominios **`tcgvaultmx.com`** / **`tcgvault.mx`**. Cubre, como mínimo: UI y copy (ES y EN), correos
    transaccionales, términos y FAQ, y la **metadata de los archivos que genera la plataforma** (p. ej. autor
    de los Excel exportados). **Verificación**: la marca se lee de `common.brand.name` y el dominio de
    `common.brand.domain`; los buzones documentados (`contacto@`, `soporte@`, `facturacion@`, `buylist@`)
    resuelven todos a `tcghunt.mx`. **Este criterio se verifica contra el producto, no contra la
    documentación**: si un documento afirma otra marca, el documento está mal.
116. **NUEVO — Un solo interruptor, y la pantalla dice que encenderlo GASTA** *(2026-08-31, decisión 60)*:
    (a) existe **exactamente un** on/off para el gancho de grading; **no hay** ningún control, etiqueta ni
    estado que ofrezca «traer sin publicar», «solo ingest», «parcial» ni «modo prueba». (b) El aviso de
    **encendido** dice, en ES y EN, **las dos cosas**: que **publica** una afirmación comercial **y** que
    **gasta** créditos contra un proveedor **de paga**, con el **tope diario interpolado** (no hardcodeado) y
    la nota de que **los créditos no se recuperan al apagar**. (c) El aviso de **apagado** dice que también
    **deja de actualizar**. (d) Con el interruptor **apagado**: ninguna de las cuatro superficies muestra
    cifra estimada **y** el barrido **no pide ni escribe** ninguna — **cero créditos consumidos**.
    *(Nota para QA, del arquitecto §4.38(r.6.3): el **criterio 108** ya **no se verifica** encendiendo y
    apagando contra un entorno con credencial viva, porque eso **gasta dinero real**; se verifica **sin
    credencial del proveedor** o **con la sonda encendida**.)*
117. **NUEVO — El estado del disclaimer se enuncia con las dos mitades, siempre** *(2026-08-31, decisión 59)*:
    donde se mencione el estado legal del descargo, se lee **«aprobado por el dueño; sin revisión legal
    profesional»**. **Verificación negativa, y es la que importa**: **cero apariciones**, en `messages/` (ES y
    EN) y en cualquier superficie visible, de una afirmación de que **el disclaimer no está aprobado** o que
    **le falta el visto bueno del dueño** — la exhibición está **encendida en producción** con ese texto, así
    que decirlo sería publicar algo falso. **Este criterio se verifica contra el producto, no contra la
    documentación**: si un documento afirma que el disclaimer no está aprobado, **el documento está mal** y se
    corrige por el rol dueño de ese documento.
118. **NUEVO — El peor caso de 60 días está aceptado, y el dial sigue en 30** *(2026-08-31, decisión 61)*:
    (a) el seed de **`graded_estimate_freshness_days` es `30`** — si el entorno arranca con **60**, el criterio
    **falla** (eso sería un peor caso de **120**, el doble de lo aceptado); (b) una muestra cuya **última
    venta** sea de **más de 30 días** **no se ingiere**; (c) una fila con **más de 30 días desde su captura**
    **no se muestra** en ninguna de las cuatro superficies ni promociona la carta; (d) en consecuencia, existe
    un caso legítimo —fila capturada con evidencia de 30 días y leída 30 días después— en el que la cifra
    visible se apoya en una venta de **60 días atrás**: eso **NO es defecto**, es la decisión 61.
    **(e) GU-9 no se cuenta como bloqueante del primer `off → on`; A-1 (techo de créditos del banner) SÍ sigue
    contando** hasta que el arquitecto la cierre.
119. **NUEVO — Ninguna fecha junto a los estimados de la ficha** *(2026-08-31, decisión 62; **cierra la
    pregunta abierta 18**)*: en la **ficha** de una carta raw con estimados, **no se pinta fecha alguna**
    asociada al bloque de valor estimado —ni de la venta, ni de captura, ni «actualizado el …»—.
    **Verificación negativa, y es la que importa**: (a) el bloque de estimados **no renderiza** el eyebrow de
    fecha; (b) **cero apariciones** de la clave `catalog.gradingEstimate.updatedAt` en `messages/` **ES y EN**
    y en la página renderizada. **(c) Ojo, QA: HOY ESTE CRITERIO FALLA A PROPÓSITO** — el producto pinta
    **«ESTIMADO · {date}»** vía `oldestCapturedDate()`; **retirarlo es trabajo abierto de frontend**, y este
    criterio es el que lo cierra. **No es un defecto reportable contra otro rol**: es el pendiente que crea la
    decisión 62. **(d)** Este criterio **no toca** la frescura interna: los **dos relojes** del criterio 118
    siguen evaluándose **server-side** con la fecha de captura. Se retira lo que se **muestra**, no lo que se
    **mide**. **(e)** No aplica a la **fecha del precio de venta / valor de mercado** de la ficha (el `note`
    de `marketValue`, que es otro dato y otra fila): esa **se queda como está**.

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
- **Legal/publicidad — el gancho de grading es una afirmación comercial** *(v2.0, §O)*: mostrar «si la gradeas
  podría valer X» en una **página de venta** es publicidad sobre un **resultado incierto que depende de un
  tercero (PSA)**. Riesgo de **publicidad engañosa** ante PROFECO si el comprador entiende el estimado como
  promesa. Mitigaciones ya incorporadas: gate conservador sobre **PSA 9** (§O.2), **gate de confianza** que
  impide promocionar cifras poco sólidas o incoherentes (§O.7), **disclaimer obligatorio en toda superficie**
  (§O.5), **exclusión explícita de garantía de grado** (Fuera de alcance) y **un interruptor único apagado de
  fábrica**. *(Actualizado 2026-08-31: el texto del disclaimer está **aprobado por el dueño**, **sin revisión
  legal profesional** — el punto (a) de abajo sigue vivo y es exactamente esa revisión pendiente.)*
  *(Refuerzo 2026-08-28: con la fuente automática, la cifra son **ventas cerradas
  reales de eBay por grado**, no una valuación nuestra — el disclaimer describe la realidad al pie de la
  letra, lo que mejora la posición.)* **Validar con abogado**: (a) que el **texto del disclaimer** (§O.5,
  **aprobado por el dueño, sin revisión legal**) sea suficiente y esté también en **términos/políticas**, (b) que el estimado **no cree derecho** a
  compensación si el grado sale menor, y (c) que el uso de la marca **«PSA»** para nombrar el grado en la UI
  sea un **uso descriptivo/nominativo admisible** y no sugiera afiliación, aval o asociación con PSA.
- **Comercial — expectativa del cliente y soporte** *(v2.0, §O)*: aunque legalmente esté cubierto, un cliente
  que compre por el gancho y **saque PSA 8** volverá a soporte. Conviene decidir el **guion de respuesta** y
  confirmar que la política de **ventas finales** (§H) aplica sin excepción a este caso —el estimado **no** es
  una de las dos excepciones de reembolso—; hoy el documento asume que **no** crea ninguna excepción nueva.
- **ToS del proveedor del estimado por grado** *(v2.0, §O — MÁS RELEVANTE desde 2026-08-28)*: con el paso a
  **ingest automático**, dejamos de consumir el dato a mano y pasamos a **redistribuir sistemáticamente**
  derivados de `ebay.salesByGrade`. Revisar los **términos de PokemonPriceTracker** para confirmar que está
  permitido **mostrar públicamente** valores de mercado de cartas gradeadas **con fines comerciales** dentro de
  una tienda, bajo qué **atribución** y con qué **límites de rate/caching** (el diseño ya mitiga priciando solo
  lo que está en bóveda + cache diario). Confirmar también si la **atribución al proveedor** debe ser visible.

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
11. **Marca (nombre comercial)** → **TCG HUNT**, con **fuente de verdad en `common.brand.name`** y dominio
   **`tcghunt.mx`** (`common.brand.domain`). Es el nombre usado en UI, comunicación y términos. **Marca ≠
   razón social**: la razón social vive en `common.footer.legalEntity` (hoy pendiente de carga) y es la
   entidad que responde — ver el encabezado del documento.
   *(**Corregida el 2026-08-31, confirmada por el humano.** Esta decisión decía «TCG Vault MX», que era un
   **nombre interno de trabajo**, nunca la marca de cara al usuario. Ese literal queda **retirado**. Aviso a
   todos los roles: **no lo reintroduzcan** en producto ni en docs citando versiones viejas de este documento
   — hubo al menos un caso de una cadena correcta sustituida por la incorrecta usando esta línea como
   autoridad. La autoridad es la clave i18n, no el literal escrito aquí.)*
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
33. **Precio del sellado = DERIVADO por spread** (ya no manual-único): precedencia `override manual > spread
   por presentación > spread global de respaldo > sin precio ⇒ PRICE_PENDING (no se publica)`; la **fórmula**
   (markup arriba del mercado) vive en **§K**. **Supersede** la parte de sellado de la decisión 4 ("sellado =
   precio manual") y la 16.
34. **TCGCSV = BASE del precio de venta del sellado** (ya no "solo informativa"), vía el **mapeo curado
   existente**. Aplica **solo al sellado**; para **raw/singles no cambia nada**.
35. **Spreads configurables por presentación** (ConfigSetting, M10): semillas **box 18% / etb 22% / bundle
   25% / tin 30% / blister 35% / global de respaldo 25%** (editables, auditados). *(Ampliado el 2026-08-24:
   ver 35b — son **siete** presentaciones, no cinco. La tabla completa vive en §K.)*
35b. **`upc` 18% y `collection` 22%** (2026-08-24, **elegidos por el dueño**, que **confirmó que vende UPC**
   —Ultra Premium Collection—): un **UPC** es la pieza **más grande y cara** del catálogo ⇒ mismo % que
   **`box`**; una **`collection`** es comparable a un **ETB** ⇒ mismo % que **`etb`**. Se enuncia además el
   **criterio que ordena toda la tabla**: **«ítem más chico ⇒ % mayor»** (un % gordo sobre una pieza cara es
   un monto que mata la venta; una pieza barata necesita más % para que el margen pague manejo y envío).
   Hasta esta decisión ambas caían al **global de respaldo (25%)** por omisión, y por un hueco de validación
   **no se podía capturar una pieza UPC en inventario ni fijarle spread** desde M2 (ya corregido). Ver §K.
35c. **Toda presentación nueva llega con spread elegido a propósito — nunca cae al global en silencio**
   (2026-08-24, **confirmado por el dueño** como **regla de negocio firme**, ya no supuesto): elegir el
   spread es **parte del alta** de una presentación. El **global de respaldo queda como excepción explícita**
   (pieza sin presentación, o regla retirada a propósito), no como default de lo que nadie pensó. Razón: es
   lo que evita repetir lo del **UPC**, que llevaba **meses vendiéndose al 25 %** porque nadie lo eligió.
   Backend ya lo sostiene con un **test de cobertura de todos los `SealedSubtype`**. Ver §K.
35d. **Corrección de REDACCIÓN de la fórmula del spread — NO cambia ningún precio** (2026-08-24, autorizada
   por el dueño): el documento escribía `mercado × spread`, que leído al pie significa `mercado × 0.18`
   (vender una caja de MX$2,000 en **MX$360**). La fórmula real, **siempre** implementada así en `money.ts` y
   **siempre** bien descrita en `API_CONTRACT §M2` ("markup % ARRIBA de mercado"), es **`mercado × (1 +
   spread)`** ⇒ **MX$2,360**. Era **taquigrafía heredada de la redacción de v1.6**, no una decisión de
   negocio distinta. **En agosto de 2026 no cambió el markup, ni un precio, ni la matemática**: solo se
   corrigió el texto del documento rector, que por la regla de conflicto es la versión que gana. La fórmula
   queda con **origen único en §K** y las ~15 citas pasan a nombrar la **precedencia** y apuntar a §K.
36. **Sellado = solo venta** (plataforma→cliente): **sin buylist de sellado**; call-out `mailto`
   (`contacto@tcghunt.mx`) para revender fuera de la app.
   *(**Corregido el 2026-08-31**: decía `contacto@tcgvaultmx.com`, dominio que **no existe** en el producto.
   **Todos los buzones viven en el único dominio `tcghunt.mx`**: `contacto@` (reventa de sellado), `soporte@`
   (disputas y evidencia), `facturacion@` (CFDI) y `buylist@`. Queda **retirada** la afirmación anterior de
   que convivían dos dominios distintos y «ambos eran correctos»: era falsa.)*
37. **Condición del sellado**: default **Mint**, opción **"Detalle menor en caja"**; visible al comprador,
   **sin efecto en el precio**; el sellado **no lleva rareza**.
38. **Destino igual que cartas** (recibir/`direct_ship` o bóveda/`vault`), **pestaña "Sellado"** en bóveda
   del cliente y vista admin, y **entra en la valuación/tendencia del portafolio**.
39. **Diferenciadores cableados pero apagados** (feature-flag off): **tendencia de valor del sellado** y
   **"avísame cuando vuelva" (restock)**; se encienden después sin nuevo desarrollo.

**Decisiones v2.0 — gancho de grading (2026-08-23, tomadas por el humano):**
40. **Alcance completo, ~~tres~~ CUATRO superficies**: **ficha** + **badge en las tejas de Compra** + **vitrina
   «Joyas para gradear» en el home** + **burbuja en el carrusel «Piezas destacadas del catálogo» del home**.
   No es una prueba en una sola pantalla. Ver §O.3. *(ACTUALIZADO 2026-08-23 — ver
   decisión 50: la ficha deja de ser un «bloque comparativo» y pasa a mostrar solo precio + PSA 10 + PSA 9.
   ACTUALIZADO 2026-08-28 — ver decisión 54: en rejilla y vitrina **se pinta la cifra**, condicionada al gate
   de confianza. **ACTUALIZADO 2026-08-31 — ver decisión 56**: entra la **cuarta superficie**, destacadas, y
   **la vitrina se conserva**.)*
41. **Gate de ROI sobre PSA 9, NO sobre PSA 10** — `estimadoPSA9 ≥ (precioVentaRaw + gradingCost) ×
   (1 + minUpsidePct)`. El **PSA 10 ilusiona pero no decide**. Racional: con el gate en PSA 10, a un cliente
   que saque PSA 9 podría **costarle dinero**, y eso quema la reputación de la tienda. Ver §O.2.
   *(ACTUALIZADO 2026-08-23 — ver decisión 51: el gate **cambia de papel**, de «se ve o no se ve el gancho» a
   **criterio de curaduría** de las superficies de promoción; la matemática no cambia.)*
42. **Dos diales configurables por el admin**: **`gradingCostTiers`** y `minUpsidePct` (default **30%**),
   editables **sin deploy** y **auditados**. *(ACTUALIZADO 2026-08-23 — ver decisión 46: el costo de gradeo
   pasó de escalar plano a **tabla de escalones**.)*
43. **Fuente = PokemonPriceTracker (ya contratado) + override manual del admin** como respaldo y máxima
   precedencia. **PriceCharting sigue fuera.** *(ACTUALIZADO 2026-08-23 — ver decisión 47: la feature arranca
   **manual-first**; el ingest automático es **fase 2** y está bloqueado. **SUPERSEDED 2026-08-28 — ver
   decisión 53**: la fuente es **automática desde el arranque**; esta decisión 43 vuelve a leerse tal como se
   escribió originalmente.)* Ver §O.6.
44. **Estimado informativo con disclaimer, nunca un precio de venta ni una promesa de grado**; **money-safe
   extremo**: sin dato o sin gate cumplido, el bloque/badge **no se renderiza** — ni **$0**, ni guion, ni
   **«pendiente»** (en un argumento de venta no se muestra un hueco). Elegibilidad y montos **server-side**
   (SEC-A1). Ver §O.4 y §O.5.
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
   solo cambia cómo se resuelve `gradingCost`. Defaults en **§O.2.1**, marcados como **SUPUESTO revisable**.
47. ~~**La feature arranca MANUAL-FIRST (fase 1) y el ingest automático es fase 2 bloqueada**~~ —
   **SUPERSEDED 2026-08-28 por la decisión 53.** *(Se conserva como rastro de por qué se decidió así en su
   momento.)* La verificación técnica del proveedor (doctrina **P-6**) concluyó entonces que **no se podía
   construir el ingest** —parámetro extra que **duplica el consumo de créditos**, **formato de payload no
   confirmado** (documentación contradictoria) y **se desconocía** si el dato venía en el barrido por set o
   exigía una petición por carta—, así que se entregaba en **fase 1** con valores PSA **fijados a mano** por el
   admin vía el **override manual existente** (`POST /admin/pricing/override`). **Lo que cambió**: el humano
   preguntó *«¿no tenemos algo automático?»* y **el formato del payload ya se conoce** (`ebay.salesByGrade`),
   así que el bloqueo desaparece. De lo que quedaba vivo, **sigue vigente**: el **override manual** como
   respaldo y máxima precedencia, y que **el comportamiento visible al usuario no depende del origen del
   dato**. Los criterios de este bloque son ahora los **97–114**.
48. **Disclaimer súper enfático — «ilustrativo, no refleja el estado de nuestras cartas»** *(petición textual
   del humano; supersede el borrador anterior de §O.5)*: el texto sube de tono a **inequívoco**, con un
   elemento nuevo que era el más importante y faltaba: el estimado es un dato de mercado **genérico de ese
   modelo de carta** y **NO evalúa la pieza concreta que vendemos** —no la hemos inspeccionado ni
   pre-evaluado (centrado, superficie, bordes, esquinas) y **no opinamos sobre qué grado obtendría**—. Los
   **seis elementos obligatorios** y los textos ES/EN (completo y corto) están en **§O.5**; la **versión corta**
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
   **menos talacha** y **menos riesgo legal** (un dato de referencia no es una promesa de ganancia). Ver §O.3.
51. **El gate cambia de papel: de condición de render a CRITERIO DE CURADURÍA** *(cita: «calcúlalo para que
   podamos ponerlo en la sección de destacado algo que valga la pena»)*: el gate y la tabla de escalones
   (§O.2.1) **se conservan íntegros**, pero ahora deciden **qué promocionamos**, no qué se enseña.
   **Ficha** → muestra los estimados **siempre que haya dato**, sin condicionar al gate. **Teja y vitrina** →
   **solo si el gate se cumple**. **Vitrina ordenada por mayor ganancia neta sobre PSA 9** (escenario
   realista, no optimista). **El resultado del cálculo NUNCA se expone al cliente** —ni ganancia, ni escalón,
   ni multiplicador, ni flag—; lo único observable es **qué cartas aparecen y en qué orden**. Esto **refuerza
   SEC-A1**: el cliente ya ni recibe los insumos del cálculo. Ver §O.2 y §O.3.
52. **Disclaimer completo = NOTA AL PIE, con llamada junto a la cifra** *(cita: «El completo solo hagamos
   referencia con un asterisco donde ponemos el tag y hasta abajo de la página lo ponemos»)*: **el texto
   completo NO se poda** —cambia dónde vive, no qué dice—. Regla de producto: **ninguna página que muestre una
   cifra estimada carece de su nota al pie completa** y **ninguna cifra carece de su llamada**.
   **Decisión del PO (con peso legal, para validar con el humano/abogado): se CONSERVA un micro-aviso mínimo
   junto a la cifra**, además de la llamada, cargando las dos ideas obligatorias («ilustrativo» + «no
   evaluamos esta carta»). Motivo: **la nota al pie protege menos que un aviso adyacente si el comprador nunca
   baja**, y en **home** y **listado** eso es lo normal. El resto del disclaimer sí vive al pie sin pérdida
   práctica. Ver §O.5.

**Decisiones v2.0 — gancho de grading, cuarta ronda del humano (2026-08-28):**
53. **FUENTE AUTOMÁTICA desde PokemonPriceTracker** *(supersede la decisión 47; matiza la 43)*: el humano
   preguntó *«¿no tenemos algo automático?»* y tiene razón — el proveedor **ya se paga** y **sí trae el dato**.
   El estimado **PSA 10 / PSA 9** deja de capturarse a mano y se alimenta del **ingest automático** sobre
   **`ebay.salesByGrade`**. Dato relevante de producto: **PPT no valúa nada**; entrega **ventas cerradas reales
   de eBay agrupadas por grado**, con **número de ventas de la muestra, mediana, promedio y fecha de la última
   venta**. Eso hace que el disclaimer de §O.5 sea **exacto y no una aproximación**: la cifra es, literalmente,
   **lo que compradores reales pagaron por ese modelo ya gradeado por terceros**. El **override manual se
   conserva** como respaldo y para **curar cartas concretas**, con **máxima precedencia**. **El texto del
   disclaimer no cambia** —solo gana precisión—. Ver §O.6 y criterio **106**.
54. **LA CIFRA SÍ SE MUESTRA EN LA REJILLA Y EN LA VITRINA, condicionada a un GATE DE CONFIANZA** *(cierra la
   duda que quedaba abierta)*: rejilla de Compra y vitrina del home **pintan el número**, pero solo si es
   **confiable**: **fresco**, de **origen confiable** (override manual, o dato automático con **muestra
   suficiente de ventas**) y **coherente en magnitud**. La **ficha no aplica la coherencia de magnitud con la
   misma dureza**: **informa lo que hay**, porque es superficie **informativa**; solo la rejilla y la vitrina,
   que son **superficie de promoción**, exigen confianza. Las cotas de magnitud son **complementarias**: la
   **inferior** (`PSA10 > raw`) caza el **error de unidades USD/MXN** y el dato absurdo, la **superior**
   (`PSA10 ≤ raw × maxGradedMultiple`) caza el **cero de más**, y el **orden de grados** (`PSA10 ≥ PSA9`) caza
   las **filas con el grado intercambiado**. Ver §O.7 y criterio **111**.
55. **GUARDA DE DINERO — no se captura un estimado de un grado que ya tiene pieza real publicada**: el estimado
   por grado y el precio de un **slab real** de ese grado **comparten la misma fila de precio**, así que un
   «estimado» capturado a mano **movería el precio de venta real del slab**. Se **bloquea la captura** (y la
   escritura del ingest) del estimado del grado **G** cuando esa carta ya tiene **al menos una pieza real de
   grado G publicada** en inventario, con **mensaje explicativo** y **auditoría** del intento. **La pieza real
   manda siempre.** Ver §O.8 y criterio **112**.

**Decisiones v2.0 — gancho de grading, quinta ronda del humano (2026-08-31):**
56. **CUARTA SUPERFICIE: la burbuja también va en «Piezas destacadas del catálogo», y la vitrina SE CONSERVA**
   *(amplía la decisión 40)*: el humano pidió la burbuja **también** en el **carrusel de destacadas del home**
   **sin quitar** la vitrina «Joyas para gradear» — **quiere las dos**. **No es alcance nuevo**: lo había
   pedido **desde el principio** *(cita: «en home ponemos alguna burbuja… sobre las destacadas»)* y se entregó
   una **vitrina aparte** en su lugar; esta decisión **alinea el producto con lo pedido**. **Listón: el
   completo** —gate de **ROI** (§O.2) **y** gate de **confianza** (§O.7)—, porque destacadas es **superficie
   de promoción**, igual que la rejilla; la **ficha** sigue siendo la única superficie **informativa**.
   **Regla que la distingue de la vitrina**: el gate **no cura ni reordena** el carrusel —mismas tejas, mismo
   orden por **precio descendente**—, solo decide **qué teja lleva burbuja**; y si **ninguna** califica, el
   carrusel **se sigue renderizando sin burbujas** (la vitrina, en cambio, **no se renderiza**).
   **Expectativa asumida a ojos abiertos**: destacadas lista **las cartas más caras**, que caen en los
   **escalones de gradeo más altos** (§O.2.1, >$50k ⇒ $12,000), así que **es probable que muestre pocas cifras
   o ninguna**. Eso es el gate **funcionando**, no un fallo — queda escrito en §O.3 y en el criterio **113**
   para que **nadie lo reporte como defecto**. Ver §O.3 (4) y criterio **113**.
57. **El descargo dice «TCG HUNT» (marca), y se revisa el día que exista la razón social**
   *(corrección + criterio del PO)*: el texto de §O.5 decía «TCG Vault MX»; la **marca es TCG HUNT**
   (`common.brand.name`) y así queda en ES y EN — **solo cambia el nombre, ninguna idea del texto**.
   **Marca vs. razón social**: hoy el descargo usa la **marca**, igual que los términos, y eso es coherente y
   suficiente para operar. Pero el descargo **deslinda responsabilidad**, y **quién deslinda importa**: una
   marca no es sujeto de obligaciones. **El PO recomienda** que, **cuando se cargue** la razón social
   (`common.footer.legalEntity`), el descargo **la nombre** con el patrón **«TCG HUNT, marca operada por
   [Razón social]»**, aplicando el mismo criterio a los términos. **Lo que queda decidido ahora es el
   disparador de revisión obligatoria** (criterio **114**); **la redacción definitiva la aprueba el humano**
   (con su abogado si quiere) — **pregunta abierta 20**. *(Actualizado 2026-08-31, M-46: la justificación
   original de «no bloquea» —«el descargo entero ya estaba pendiente de aprobación y la feature sigue tras el
   flag apagado»— **ya no es cierta y se retira**. **Sigue sin bloquear**, pero por otra razón: el descargo
   **está aprobado por el dueño** (decisión 59) y la mención de la razón social entra en la **misma revisión
   legal profesional** que sigue abierta, la cual **no bloquea el encendido**.)*
58. **Renombrado completo a TCG HUNT y dominio único `tcghunt.mx`** *(2026-08-31, confirmado por el humano:
   «recuerda que somos TCGHUNT.mx cambia eso»)*: **«TCG Vault MX» era un nombre interno de trabajo** que este
   documento declaraba por error como nombre comercial. Queda **retirado de todo PROJECT.md** (título,
   encabezado, idea en una frase, decisión 11, criterios) y **todas las direcciones de correo** pasan al
   **único dominio `tcghunt.mx`** (se retiran los inexistentes `tcgvaultmx.com` y `tcgvault.mx`).
   **Lección que queda escrita, porque el daño ya salió del documento**: este documento llegó a afirmar algo
   del producto que el producto contradecía, y un rol **cambió una cadena correcta del producto por la
   incorrecta citando PROJECT.md como autoridad** (metadata de autor de los Excel generados). Por eso la
   marca y el dominio ahora se declaran **por su clave i18n verificable** (`common.brand.name`,
   `common.brand.domain`) y no por el literal: **ante discrepancia manda la clave**, y este documento se
   corrige contra el producto, nunca al revés. *(La corrección del Excel es del rol backend, no del PO.)*
59. **El disclaimer de §O.5 está APROBADO POR EL DUEÑO — y NO tiene revisión legal profesional**
   *(2026-08-31, aprobación dada en sesión)*: el dueño **aprobó el texto** ES/EN de §O.5, condicionado a la
   **corrección de marca a TCG HUNT** (decisión 58), que **ya se aplicó**. **Las dos mitades se escriben
   siempre juntas y no se suavizan**: **aprobado por el dueño**, **sin revisión legal profesional**. La
   segunda mitad **sigue abierta** y es **del dueño** (pregunta abierta 1). **Efecto**: la aprobación del
   texto **deja de ser el bloqueo para encender** la feature. **Prohibido afirmar que el disclaimer no está
   aprobado** en cualquier superficie o documento — producción ya muestra ese texto con la exhibición
   encendida, y `DESIGN_SYSTEM.md` §22.13(h) lo prohíbe en pantalla con un check de QA de **cero
   apariciones**. La cláusula «sin revisión legal profesional» **se retira el día que un abogado revise el
   texto**, y avisar de ese día es de **PO/legal**.
60. **UN SOLO INTERRUPTOR, y encenderlo es un ACTO DE GASTO** *(2026-08-31, M-46; el dueño lo pidió **dos
   veces** y lo **reafirmó tras oír la objeción**)*: el gancho de §O tenía **dos** interruptores (publicar /
   traer datos). Queda **uno** (`grading_hook_enabled`, semilla **apagado**). **§O nunca normó los on/off, así
   que esto no es un cambio de requisito: es dejarlo escrito en el documento que manda sobre el contrato.**
   Lo que queda normado aquí:
   - **El mismo `PUT` que publica la afirmación comercial autoriza gasto contra un proveedor de paga.**
     Publicar y gastar **ya no son actos separables**.
   - **Techo**: con los topes sembrados, hasta **~1 000 créditos/día**; **`ingestMaxCardsPerRun` es lo único
     que hay entre el `PUT` y la factura**. Los créditos gastados **no se recuperan al apagar**.
   - **Pérdida aceptada y declarada**: **se pierde** la posibilidad de **«traer datos automáticos con la
     tienda callada»** — ese estado **ya no es expresable**. El modelo pasa de **retener-y-aprobar** a
     **detectar-y-retirar**: la cifra se escribe **ya filtrada**, se **inspecciona** en la lista de revisión
     y, si está mal, **se borra**. Se acepta **porque las guardas de escritura no se relajan ni un punto**.
   *(Ejecución técnica: `ARCHITECTURE.md` §4.38(r), contrato v1.51-one-dial; copy: `DESIGN_SYSTEM.md` §22.13.
   Backend, frontend y ux-ui ya entregaron.)*
61. **La evidencia de mercado puede tener hasta 60 días en el peor caso — el dueño lo ACEPTA** *(2026-08-31;
   **cierra GU-9**, que estaba registrada como **bloqueante del primer encendido**)*:

   > ### ⚠️ ESTO NO ES UN CAMBIO DE CONFIGURACIÓN — NO ESCRIBAS 60 EN NINGÚN DIAL
   > El seed de **`graded_estimate_freshness_days` sigue siendo `30`, y no se toca.**
   > **`30` es precisamente el valor que produce el peor caso de 60 días.** El 60 es una **consecuencia
   > medida** de dejar el dial en 30, **no** un valor a capturar. Si alguien lee «aceptamos 60 días» y escribe
   > `60` en esa clave, **el peor caso se va a 120** — el doble de lo que el dueño aceptó.
   > **Regla de lectura: dial = 30. Peor caso observable = 60. Nunca al revés.**

   - **Por qué 30 en el dial da 60 en la calle — hay DOS relojes que se suman**, y ambos usan el mismo
     número `N`:
     1. **Reloj de bajada**: al ingerir, aceptamos una muestra cuya **última venta** sea de hasta **N días**
        atrás.
     2. **Reloj de lectura**: una vez escrita, la fila vive otros **N días** antes de que `stale()` la
        considere rancia.
     Con `N = 30`, una cifra puede publicarse apoyada en una venta de hace 30 días y seguir visible 30 días
     más: **30 + 30 = 60**.
   - **La causa técnica, en una línea**: **`evidenceDate` no se persiste**. La fecha de la venta se **conoce**
     al bajar el dato, se **usa para filtrar** y luego **se descarta**; el lector, sin esa fecha, sólo puede
     medir desde la **fecha de captura**. De ahí que haya dos relojes en vez de uno.
   - **Cómo se llegó a esta aceptación** *(se registra porque es lo que la hace válida: no fue un «ok»
     genérico)*: el dueño **pidió primero algo más estricto, «máximo una semana»**. Se le explicó que
     **poner 7 no da 7, da 14**, por los dos relojes de arriba. Preguntó **por qué el proveedor reporta 7 días
     después de la venta**, y se le **corrigió el modelo mental**: **no es retraso del proveedor** — es
     **cuánto lleva la carta sin venderse**. Una carta que se vende a diario tiene su última venta de ayer;
     una **cara y rara** puede tenerla de hace 6 días. Y eso **golpea justo a las cartas que este gancho
     destaca, que son las caras**. Se le ofreció además la alternativa de **cablear `evidenceDate`** para
     tener **un solo reloj** y un **7 real**. **Con todo eso delante, eligió 60.**
   - **Qué se desbloquea y qué NO**: **GU-9 deja de bloquear el primer `off → on`**. El **otro** bloqueante
     del encendido, **A-1** —el **techo de créditos que el banner afirma** (los «~1 000 créditos/día» de la
     decisión 60) **sin haberlo medido**—, **sigue vivo** y lo está cerrando el **arquitecto**. Encender sigue
     bloqueado por A-1.
   - **Cablear `evidenceDate` sigue siendo deuda técnica, no desaparece con esta decisión**: la columna **ya
     existe** (creada en **M-43**), pero el **escritor** y `stale()` **siguen sin cablear**, y así está anotado
     en `docs/TECH_DEBT.md`. Cablearla es lo que convertiría **dos relojes en uno** y permitiría un umbral
     real. Lo único que cambia hoy es que **ya no bloquea el encendido**.

62. **La ficha NO muestra fecha junto a los estimados — se retira la promesa, no se implementa**
   *(2026-08-31; **cierra la pregunta abierta 18**)*:

   - **Qué eligió el dueño**: de las tres opciones que se le presentaron —**(a)** mostrar la **fecha de
     captura** con etiqueta honesta, **(b)** **no mostrar fecha**, **(c)** **cablear `evidenceDate`** y mostrar
     la fecha real de la venta— eligió la **(b)**. **Lo eligió sin argumentar, y así se registra**: no se le
     atribuye aquí ningún razonamiento de UX ni de producto que no haya dado. Lo único que se puede afirmar
     del porqué es lo de abajo.
   - **Qué se corrige, y en qué dirección**: §O.3(1) prometía al comprador la **«fecha de la última venta
     observada»**. Eso **nunca se construyó** y **no es construible** hoy: **`evidenceDate` no se persiste**
     (causa técnica de los dos relojes de la **decisión 61**), así que esa fecha **no existe al momento de
     leer**. La resolución es **retirar la promesa del documento**, **no** implementarla. Es el documento el
     que se alinea con el producto.
   - **Es reversible y barata**: el día que se cablee `evidenceDate` —**deuda viva** tras la decisión 61,
     columna ya creada en M-43, escritor y `stale()` sin cablear— mostrar la **fecha real de la venta** vuelve
     a estar sobre la mesa, y además colapsaría los dos relojes en uno. **«No mostramos fecha» no es una
     prohibición permanente de diseño**: es la respuesta a no tener hoy un dato honesto que mostrar.
   - **CORRECCIÓN DE HECHO — esto NO es «lo que ya está construido»** *(se registra porque la decisión se
     tomó sobre la premisa contraria)*: se afirmó que la (b) no generaba trabajo porque la ficha ya no
     mostraba fecha y el DTO no exponía ninguna. **Ambas cosas son falsas**, verificado en la rama:
     1. `GradedEstimateDTO.estimate` es un `PriceInfo` y **lleva `capturedDate`**; el contrato lo declara
        **«SIEMPRE presente»** para el estimado (`frontend/src/types/contract.ts`).
     2. El bloque de estimados **pinta esa fecha hoy**: `GradingEstimateBlock.tsx` renderiza el eyebrow
        `catalog.gradingEstimate.updatedAt`, cuya copy en `frontend/messages/es.json` es
        **«ESTIMADO · {date}»**, alimentado por `oldestCapturedDate()` (que toma **la más antigua** de las
        cifras pintadas, por conservadurismo legal).
     **Consecuencia**: lo construido hoy se parece a la opción **(a)**, pero **sin** su etiqueta honesta —
     «ESTIMADO · 22 ago 2026» **no dice** que sea la fecha de **captura**, y un comprador puede leerla como la
     fecha de la **venta**, que es justo lo que no tenemos. Elegir (b) **sí genera trabajo**: **frontend** debe
     retirar ese eyebrow y su clave i18n (ES/EN). Ver criterio **119**.
   - **Lo que esta decisión NO resuelve** (y no se asume): si `capturedDate` debe **dejar de viajar** en
     `GradedEstimateDTO` una vez que nadie lo pinta —es superficie expuesta al cliente sin uso, del tipo que
     SEC-A1 vigila— es **decisión del arquitecto**, no de producto. Y el **override manual** sigue con su
     promesa de fecha en el aire: ver pregunta abierta **24**.

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

## Preguntas abiertas — gancho de grading (v2.0, §O)
> Las **decisiones de fondo están cerradas** (alcance de **cuatro** superficies *(actualizado 2026-08-31)*,
> gate sobre PSA 9, **el interruptor único** y
> sus defaults, la fuente automática del dato, el gate de confianza, la guarda de dinero y la regla money-safe;
> ver decisiones 40–45, 53–57 y **59–60**). **El texto del disclaimer ya NO está en esta lista: el dueño lo
> aprobó el 2026-08-31** (decisión 59) y **ya no mantiene la feature apagada**. Lo que sigue abierto de él es
> **solo la revisión legal profesional** (pregunta 1, reescrita). El resto son **huecos menores**, todos con un
> supuesto ya redactado en §O para **no bloquear** al arquitecto.

1. **Revisión LEGAL PROFESIONAL del disclaimer** — *REESCRITA 2026-08-31 (M-46). El texto **ya está
   aprobado**; lo que sigue abierto es otra cosa.* **La distinción es obligatoria y no se suaviza:**
   - **Aprobado por el dueño** — el texto ES/EN de §O.5 **tiene el visto bueno del dueño**, dado en la sesión
     del **2026-08-31** y condicionado a una **corrección de marca que ya se aplicó**: el descargo dice
     **TCG HUNT** (`common.brand.name`), no el nombre interno retirado. Ver **decisiones 58 y 59**.
   - **Sin revisión legal profesional** — **ningún abogado ha revisado ese texto.** Esa parte **sigue
     abierta** y está **a nombre del dueño** (es quien contrata y decide la revisión, idealmente junto con la
     pregunta **20**, la razón social). **Es lo único que queda vivo de esta pregunta.**

   **Consecuencia de estado, que es lo que este documento tenía atrasado:** la aprobación del texto **ya no
   bloquea encender la feature**. Producción tiene la exhibición **encendida** y el texto que se muestra **sí**
   tiene visto bueno del dueño; afirmar lo contrario sería describir mal el producto.

   **Prohibición explícita, alineada con la pantalla:** ni este documento ni ninguna superficie pueden afirmar
   que **el disclaimer no está aprobado**. `DESIGN_SYSTEM.md` **§22.13(h)** lo prohíbe en el copy de M10 y
   `FRONTEND_NOTES.md` fija un **check de QA que exige cero apariciones** de esa frase en `messages/`. La
   fórmula correcta, y la única, es **«aprobado por el dueño; sin revisión legal profesional»**.

   **Lo que te sigo preguntando** (nada de esto bloquea el encendido): (a) ¿pasas el texto por **abogado**, y
   cuándo? —el día que lo hagas, la cláusula «sin revisión legal profesional» **se retira** de pantalla y de
   este documento—; (b) ¿quieres que el **mismo texto** viva también en la **página de términos/políticas**?
   *(Contexto que juega a favor en esa revisión: con la fuente automática la cifra son **ventas cerradas
   reales de eBay por grado**, así que «dato de referencia de mercado sobre ese modelo ya gradeado por
   terceros» es **literalmente exacta**. El texto no cambió; solo es más defendible.)*
2. **Base de comparación del gate**: el supuesto es comparar contra el **precio de venta raw sin IVA** (el
   número que ya ve el comprador), **sin** sumar IVA ni envío al lado del costo. ¿Confirmas, o prefieres un
   gate **aún más conservador** que incluya IVA y/o el envío de MX$175 en `precioVentaRaw`?
3. ~~**Costo de gradeo plano vs. por nivel de servicio**~~ — **RESUELTA (2026-08-23)**: el humano eligió
   **escalones por valor declarado**. El costo plano de MX$600 queda **eliminado** del documento y sustituido
   por la tabla **`gradingCostTiers`** (**§O.2.1**), que además debe **incluir envío internacional y retorno a
   México**. Ver decisión **46** y criterio **110**. *(Sub-pregunta que queda viva dentro de §O.2.1: los
   **valores por defecto** de la tabla son un **SUPUESTO** y conviene que los valides contra lo que realmente
   te cuesta gradear hoy; y **qué valor se usa para buscar el escalón** —el supuesto es el **estimado PSA 10**,
   por ser el más conservador—.)*
4. **Copy del badge** — *ACTUALIZADA 2026-08-23*: tras quitar el multiplicador, el supuesto es
   **«En PSA 10 vale ≈ MX$X»** (y en móvil **«PSA 10 ≈ MX$X»**), alineado con tu frase *«desplegamos "en
   PSA 10 vale tanto"»*. ¿Te gusta ese texto o prefieres otro? *(Ya no se contempla mostrar multiplicador.)*
5. ~~**Cómo se expresa el upside en la ficha**~~ — **SIN OBJETO (2026-08-23)**: decidiste **no mostrar
   comparativa ni multiplicador**. La ficha muestra **precio + PSA 10 + PSA 9** y nada calculado. Ver decisión
   **50** y criterio **99**.
6. **Vitrina del home — tamaño**: el **orden ya está decidido** (mayor **ganancia neta sobre PSA 9**, criterio
   101). Lo que queda abierto es el **tamaño**: el supuesto es **hasta 8 cartas**. ¿Te sirve 8, prefieres otro
   número, o quieres además poder **fijar/curar a mano** alguna carta en la vitrina desde el admin?
7. ~~**Umbral de frescura y CONTRA QUÉ FECHA se mide**~~ — **RESUELTA (2026-08-31)**: el supuesto de esta
   pregunta —un **solo** reloj contra la fecha de la última venta— **era incorrecto respecto de lo
   implementado**. Como **`evidenceDate` no se persiste**, hay **dos** relojes que se suman (bajada + lectura),
   así que el dial de **30** produce un peor caso de **60 días**. El dueño pidió primero «máximo una semana»,
   se le explicó que **7 daría 14**, se le corrigió que el rezago **no es del proveedor sino de cuánto lleva la
   carta sin venderse** (lo que golpea justo a las cartas caras que este gancho destaca), se le ofreció
   **cablear `evidenceDate`** para tener un reloj único, y **con todo eso enfrente aceptó los 60**.
   **El dial `graded_estimate_freshness_days` se queda en `30`** — 60 ahí daría 120. Ver **decisión 61** y
   **criterio 118**. *(Cierra **GU-9** como bloqueante del primer encendido; **A-1 sigue vivo**.)*
8. **Ubicación de los diales**: se propone **M10 (Config y bitácora)** junto al resto de diales; la alternativa
   es **M2 (Catálogo y precios)** por ser pricing. ¿Cuál prefieres?
9. ~~**PokemonPriceTracker ya contratado vs. «plan de pago fuera del MVP»**~~ — **RESUELTA (2026-08-23)**:
   confirmado por el humano — **el proveedor ya está contratado** y la key vive en Railway. La línea de «Fuera
   de alcance» quedó marcada como **SUPERADA** y el documento ya no se contradice. Ver decisión **49**.
   *(ACTUALIZADO 2026-08-28: la nota que decía «esto **no** desbloquea el ingest automático, que sigue en fase
   2 por razones técnicas» **ya no aplica**. El ingest **sí se construye**: el formato del payload se conoce
   (`ebay.salesByGrade`) y la fuente pasa a ser automática — ver §O.6 y decisión **53**.)*
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
14. **Umbrales del gate de confianza** *(NUEVA, 2026-08-28 — son los dos números que deciden qué llega a
    portada)*: **`minSalesSample` = 5** ventas cerradas mínimas para publicar una cifra automática, y
    **`maxGradedMultiple` = 100×** el precio raw como techo de credibilidad. Los dos son **SUPUESTO** y
    **diales editables sin deploy**. Puse 5 y no 3 **a propósito**, del lado conservador: con tres ventas una
    sola operación atípica desplaza la mediana entera, y esa cifra acabaría en la portada. El costo de subirlo
    es que **entran menos cartas** al gancho. ¿Confirmas 5 y 100×, o prefieres otros valores?
15. **¿Mediana o promedio?** *(NUEVA, 2026-08-28)*: el proveedor entrega **las dos** por grado. El supuesto es
    publicar la **mediana**, porque **aguanta el outlier** —una venta rara no arrastra el número— y eso es lo
    money-safe para una cifra que va en portada. El promedio reaccionaría más rápido a un cambio real de
    mercado. ¿Mediana (supuesto) o promedio?
16. **Cifra incoherente en magnitud: ¿la ficha la muestra igual?** *(NUEVA, 2026-08-28 — es el matiz que tú
    mismo marcaste)*: dijiste que **la ficha no aplica la coherencia de magnitud con la misma dureza**, así que
    el supuesto es que **la ficha sigue mostrando** la cifra aunque sea incoherente (p. ej. un PSA 10 por
    debajo del precio raw), **sin promocionarla** y **levantando una alerta interna** para que la revises o la
    corrijas con override. La alternativa es **ocultarla también en la ficha**. ¿Confirmas el supuesto, o
    prefieres ocultarla en todos lados? *(Ojo: si la ficha la muestra, estamos publicando un número que
    sabemos que huele mal; la alerta interna es lo que compensa eso.)*
17. **Sentido inverso de la guarda de dinero** *(NUEVA, 2026-08-28)*: la decisión 55 bloquea **capturar** un
    estimado cuando ya hay pieza real publicada de ese grado. El caso simétrico —**publicar** un slab real de
    un grado que ya tenía estimado— tiene el mismo riesgo de dinero. El supuesto es que en ese momento el
    estimado **deja de gobernar ese precio y deja de usarse** para ese grado. ¿Confirmas?
18. ~~**¿Qué fecha muestra la ficha para el dato automático?**~~ — **RESUELTA (2026-08-31)**: el dueño eligió
    la **(b), no mostrar fecha**. §O.3(1) prometía la **fecha de la última venta observada**, algo que **nunca
    se construyó** y que **no es construible** hoy (**`evidenceDate` no se persiste**), así que la resolución
    es **retirar la promesa del documento**, no implementarla. **Reversible**: si se cablea `evidenceDate`
    (deuda viva tras la decisión 61), mostrar la fecha real vuelve a estar sobre la mesa.
    **Corrección de hecho**: se creyó que la (b) ya estaba construida; **no lo está** — el bloque pinta hoy
    **«ESTIMADO · {date}»** y `capturedDate` **sí viaja** en el DTO, así que la (b) **genera un cambio de
    frontend** (retirar ese eyebrow). Ver **decisión 62**, **criterio 119** y §O.3(1). *(Queda vivo el caso
    del **override manual** → pregunta **24**.)*
23. **¿Mostrar el número de ventas de la muestra?** *(NUEVA, 2026-08-28; **renumerada 2026-08-31** — estaba
    duplicada como «18», chocando con la pregunta de la fecha, que es la que conserva el 18 porque §O.3(1) ya
    la citaba así. Toma el **23** —número libre— y **se queda en su lugar** en la lista; la numeración 19–22
    **no se toca**, para no romper las referencias existentes)*: hoy el supuesto es **NO** —el
    tamaño de la muestra es un insumo interno del gate y no se pinta ni viaja al cliente, para no ampliar la
    superficie visible que tú mismo mandaste simplificar—. Pero decir *«basado en 12 ventas reales»* sería una
    señal de credibilidad fuerte y coherente con el disclaimer. ¿Lo dejamos fuera (supuesto) o lo quieres?
19. **Carta con slab real publicado: ¿enlazar a la pieza en vez de callar ese grado?** *(NUEVA, 2026-08-28)*:
    cuando bloqueamos el estimado PSA 10 porque **ya tenemos una PSA 10 real a la venta**, la ficha del raw
    simplemente **no muestra ese grado**. Podría ser mejor negocio **enlazar a la pieza real** («¿la quieres ya
    gradeada? tenemos esta»). Hoy queda **fuera de alcance** por no inventar superficie nueva. ¿Te interesa
    para el MVP o lo dejamos para después?
20. **¿El descargo debe nombrar la RAZÓN SOCIAL cuando la cargues, o basta la marca?** *(NUEVA, 2026-08-31 —
    tiene peso legal, por eso te la devuelvo)*: hoy §O.5 dice **«TCG HUNT»** (la marca, `common.brand.name`),
    igual que los términos. **Mi recomendación como PO**: el día que cargues la **razón social**
    (`common.footer.legalEntity`), que el descargo pase a decir **«TCG HUNT, marca operada por [Razón
    social]»** —lees el nombre que el cliente reconoce **y** queda claro **qué entidad** se está deslindando de
    no garantizar grado y de no recomprar—, con el **mismo criterio en los términos** para que no se
    contradigan. **Lo que ya dejé fijado es solo el disparador de revisión** (criterio **114**): cuando cargues
    la razón social, **§O.5 se revisa**. **La redacción final es tuya** (idealmente con tu abogado, junto con
    la **revisión legal profesional** del descargo — pregunta 1. *Ojo: el descargo **ya está aprobado por ti**;
    lo que queda pendiente es la revisión por abogado, no la aprobación*). ¿La quieres nombrada, o prefieres quedarte solo con la
    marca?
21. ~~**Renombrado de marca en el RESTO de PROJECT.md**~~ — **CERRADA (2026-08-31)**. El humano confirmó:
    «recuerda que somos TCGHUNT.mx cambia eso». **TCG HUNT sustituye a TCG Vault MX en todo el documento** y
    todos los correos pasan a `tcghunt.mx`. Aplicado en el título, el encabezado de marca, la idea en una
    frase, la **decisión 11**, la **decisión 36** y los criterios; registrado como **decisión 58**. **No
    requiere más respuesta.**
22. **«Piezas destacadas» casi siempre sin burbujas: ¿lo aceptas tal cual?** *(NUEVA, 2026-08-31 — es
    expectativa de negocio, no un hueco técnico)*: destacadas ordena por **precio descendente** y el costo de
    gradeo **sube por escalones** (§O.2.1), así que **las cartas más caras son las que menos califican**: es
    probable que ese carrusel muestre **pocas cifras o ninguna** buena parte del tiempo. Ya está escrito como
    comportamiento esperado (§O.3, criterio 113) para que QA no lo reporte como defecto. Si quieres **más
    presencia** de la burbuja ahí, las palancas son de negocio: **(a)** bajar `minUpsidePct`, **(b)** revisar
    los **valores por defecto de los escalones** —hoy son un supuesto conservador—, o **(c)** cambiar el
    criterio con que se arma «destacadas» (p. ej. mezclar precio con potencial de gradeo). **La (c) es un
    cambio del home, fuera del alcance de §O**: si la quieres, dilo y la aterrizo aparte. ¿Lo dejamos como
    está (supuesto) o mueves alguna palanca?
24. **¿Y la fecha del OVERRIDE MANUAL?** *(NUEVA, 2026-08-31 — es el resto que deja la decisión 62; **no
    bloquea el encendido**)*: la pregunta 18 se formuló sólo sobre el **dato automático**, y así se respondió,
    así que **no extiendo el «no mostrar fecha» al override por mi cuenta**. Pero §O.3(1) también prometía,
    para un override, **«la fecha en que el admin lo fijó»**, y eso **hoy es inimplementable tal como está
    contratado**: el cliente **no puede distinguir** un override de un dato automático —`source` se **omite
    siempre**, y es una garantía deliberada del contrato para que la fase manual y la automática sean
    indistinguibles— y el bloque pinta **una sola fecha** para todas las cifras que muestra. Las opciones:
    **(a)** **no mostrar fecha tampoco** en el override —el documento queda coherente con la (b) y **no cuesta
    nada**, porque es lo que resulta de retirar el eyebrow—; **(b)** mostrarla **solo** en overrides, lo que
    **exige exponer al cliente que esa cifra es manual** (rompe la indistinguibilidad que el contrato protege a
    propósito, y es un cambio de contrato que pasa por el **arquitecto**). **Mi supuesto por defecto, si no
    respondes, es la (a)**: es lo coherente con lo que acabas de decidir y lo único que no abre una superficie
    nueva. ¿Confirmas la (a) o quieres la (b)?
## Decisiones (v2.0, P-48) — precio puro por valor de mercado (LOCKED)
> Decisiones del humano **ya tomadas** en conversación (2026-08-24), a partir del hallazgo de cartas
> publicadas a **MX$1.31 / MX$3.71** con un supuesto piso de **MX$15**. Tras ver la causa raíz, el humano
> **amplió el alcance**: en vez de parchar los dos ejes existentes, **retira la rareza y el acabado del
> pricing**. Quedan **cerradas** y son la entrada para el arquitecto. **No se re-litigan.** El negocio
> **todavía no está en vivo**. Ver **§N** y criterios **79–96**.
1. **PRECIO PURO POR VALOR DE MERCADO** (LOCKED, §N.1 — la grande): el precio depende **solo del valor de
   mercado**. `venta = redondeo↑(max(piso, mercado × markup(mercado)))`;
   `compra = max(bin, mercado × pct(mercado))`. **Se retiran del pricing la rareza y el acabado**: no hay dos
   ejes, ni precedencia entre ejes, ni mapa de ~30 rarezas → 5 tiers, ni `finishRules`. **Desaparece la
   distinción `fixed` vs `pct`** como modos excluyentes: queda **una curva**.
2. **`markup` baja, `pct` de compra sube, ambos INTERPOLADOS** (LOCKED): nunca escalonados. Un escalón plano
   produce **saltos de precio** y, **arriba de ~$25 de mercado, es matemáticamente imposible sin vender por
   debajo del mercado**.
3. **Diales iniciales** (LOCKED, calibrables — §N.2): **piso $25** · **markup 1.60× hasta $25 → baja lineal a
   1.15× en $80 → 1.15× arriba** · **bin de compra $1** · **pct de compra 30% hasta $25 → 40% en $100 → 50%
   en $500 → 50% arriba**.
4. **Piso y bin ÚNICOS** (LOCKED): uno solo para todo el catálogo, **ya no por acabado**. El humano aceptó
   explícitamente que quitar el piso diferenciado por acabado **cuesta ~2% de utilidad y no vale su
   complejidad**.
5. **Escalera de redondeo hacia arriba** (LOCKED, **decisión 5**): **$5 bajo $200 · $10 bajo $500 · $25
   arriba**. El paso de $5 llega hasta **$200, no hasta $100**: así se corrige el **brinco injustificado de
   $100→$110** entre mercado $86 y $87 ($87 ⇒ **$105**). Solo aplica a **venta**.
6. **Tabla de puntos EDITABLE desde admin** (LOCKED, requisito explícito): se pueden **agregar, mover y
   borrar** renglones — **no** es una estructura fija de N puntos. **Validaciones**: curva de venta
   **monótona creciente**, **compra siempre menor que la venta**, y **ningún precio de venta por debajo del
   mercado**.
7. **Alcance** (LOCKED): aplica igual a **raw y a GRADEADAS**. El **SELLADO NO cambia** (conserva su spread
   por presentación, con la tabla de **§K**: siete presentaciones + global de respaldo). **El ACABADO SIGUE
   EXISTIENDO como identidad de variante** —inventario, overrides, bounties y `availableFinishes` siguen
   siendo por acabado—: lo único que desaparece es que el acabado tenga **regla de precio propia**.
8. **GUARDARRAÍL — la rareza sale del pricing y entra a la VALIDACIÓN, en los DOS EJES** (LOCKED, §N.5):
   sustituye al invariante `premium ⇒ pct`, que queda sin sentido. Si una carta de **rareza premium**
   aterriza en el **piso** (venta) o en el **bin** (compra) **teniendo dato de mercado**, **no se publica** y
   **no se cotiza**: cola de **precio pendiente** y escalado al dueño hasta que el siguiente barrido corrija
   el dato. Sin él, un dato malo en una carta cara la vendería al piso —o la compraría al bin—, la **pérdida
   irreversible**. **Los dos ejes quedaron confirmados por el humano** (ya no es supuesto). Volumen medido:
   **≈3 de 333** cartas de un master set (no es alarma ruidosa).
8b. **SIN DATO DE MERCADO ⇒ «PRECIO PENDIENTE»; el piso NO rescata** (LOCKED, §N.2 — money-safe): una
   variante **sin precio de mercado no se publica y no se cotiza**, **sea cual sea su rareza**. **El piso no
   es un precio de respaldo.** La razón que gobierna: el único filtro que quedaría sería el **guardarraíl**,
   que **se apoya en la rareza** —el **proxy malo** que este cambio retira del pricing—; atraparía una Secret
   Rare con dato corrupto pero **no** una **Common de $400 sin dato**, que se publicaría al piso de $25. Eso
   sería **reabrir el hueco exacto que la feature cierra**. Ante la **ausencia** de dato el sistema **se
   detiene**, no pone un número. *(No confundir: dato **ausente** ⇒ esta regla; dato **presente pero malo**
   ⇒ guardarraíl, decisión 8.)*
9. **BOUNTY revalidado contra la regla** (LOCKED, **decisión 4**, §N.6): un bounty **por debajo de la regla
   vigente deja de ser bounty** — no aplica en la cotización, no se publica en la vitrina y **genera alerta en
   el binder**. Se valida **al CREAR, al COTIZAR y al PUBLICAR** (hoy solo al crear). Efecto buscado: **el
   número publicado es exactamente lo que se paga**, y **todo lo de la vitrina es mejor que la tarifa
   estándar**. El bounty es la **sección de ofertas** del dueño: vive en la escala de **compra** (30–50% del
   mercado), **siempre por debajo del mercado**, y **nunca se compara contra el mercado, solo contra la
   regla**.
10. **El override manual de compra SIGUE SIENDO ABSOLUTO** (LOCKED): puede quedar **por debajo** de la regla
   —es decisión deliberada del admin— y **no se convierte en piso**.
11. **«Valor de mercado» solo cuando el mercado fijó el precio** (LOCKED, **decisión 2**, §N.7): si lo
   determinó el **mercado** ⇒ se muestra; si lo determinó el **piso** (o un **override**) ⇒ **no se muestra**.
   En zona de piso el mercado no produjo el precio («venta $25 / mercado $1.14» publica un múltiplo de 22×
   sin informar). **Solo ficha de carta y ficha de sellado**; tejas y listados **no** muestran mercado.
12. **`priceBasis` — registrar y exponer qué determinó el precio** (LOCKED): **mercado / piso / override /
   bounty / pendiente**. Es lo que hace **visible el guardarraíl** y permite **detectar pisos mal
   calibrados**.
13. **INSTRUMENTACIÓN** (LOCKED, §N.8): cada **venta** y cada **compra** registran **mercado del día**,
   **precio final**, **qué lo determinó**, **acabado** y **bracket de mercado**. Razón: hoy no se puede
   contestar **«¿qué tan rápido rota cada bracket?»**, y ese es el dato que falta para **calibrar la curva con
   realidad en vez de con supuestos**.
14. **Principio de sesgo de error** (LOCKED, §N.0): *precio de más = venta perdida (recuperable); precio de
   menos = carta perdida (irrecuperable)*. **Toda regla de precio se sesga hacia el primer error.** Gobierna
   las decisiones futuras de pricing, no solo esta.
15. **UN SOLO CAMBIO, UN SOLO DEPLOY** (LOCKED, §N.9): **ya no se despliegan por separado** las decisiones 1
   («`fixed` pasa a ser piso real») y 2 (visibilidad). Se **funden** con la curva en un cambio con **etapas
   verificables**. Razón: **no hay exposición viva que proteger** y la curva **elimina el modo `fixed` por
   completo**, así que ese código **se tiraría**. Siguen siendo ciertas como **comportamiento objetivo**, no
   como fase entregable. **La pantalla de M2 con el texto falso («Hereda tier») se retira con la lógica vieja**
   en vez de corregirse.

**Respuestas del humano a las preguntas abiertas de v2.0 (todas resueltas):**
1. **¿Qué `%` usa el lado de mercado de un `fixed`?** → **SUPERADA** por la decisión 1: ya no existen reglas
   `fixed` sin `%` propio. *(El supuesto era correcto para el diseño intermedio, que ya no se entrega solo.)*
2. **¿Overrides y bounty absolutos o piso?** → **Override ABSOLUTO; bounty con REVALIDACIÓN** (decisión 9/10).
   Verificado además que en **venta** el override sale por su propio retorno y nunca toca la rama `fixed`,
   mientras que en **compra** sí pasaba por la aplicación de la regla —ese era el riesgo real—. Con la curva
   la rama desaparece, pero **la distinción override/bounty se respeta explícitamente**.
3. **¿Piso universal más allá de `fixed`?** → **SUPERADA**: con la curva **no existe la distinción
   fixed/pct** y **el piso aplica a todo**.
4. **¿Herencia real acabado → tier?** → **SUPERADA**: el eje de acabado **desaparece del pricing**; **no hay
   tier del cual heredar**. El texto falso **se elimina junto con la pantalla vieja**.
5. **¿Ocultar mercado solo en ficha o también en tejas?** → **Solo ficha de carta y ficha de sellado.** Las
   tejas y listados **no muestran mercado hoy y no van a mostrarlo**.
6. **¿Señal de qué determinó el precio?** → **SÍ, se necesita** (decisión 12): `priceBasis` registrado y
   expuesto.

## Preguntas abiertas — precio puro por valor de mercado (v2.0, P-48)
> Las decisiones de v2.0 están **cerradas** y redactadas en §N; las 6 preguntas del borrador anterior quedaron
> **respondidas** (arriba). Lo que sigue son los **huecos que aparecieron al ampliar el alcance**. Las **dos
> primeras (las que movían dinero) YA ESTÁN RESUELTAS** por el humano y se conservan **con su respuesta** para
> dejar rastro de por qué se decidió así; **las tres restantes siguen abiertas** y tienen supuesto por defecto
> en §N, así que **no bloquean el arranque**.
1. ~~**¿Qué pasa cuando NO hay dato de mercado?**~~ → **RESUELTA (money, LOCKED): sin dato de mercado ⇒
   «PRECIO PENDIENTE»** — no se publica y no se cotiza, **el piso NO gana** (§N.2, decisión **8b**,
   criterio **87b**). *(Rastro: el borrador proponía lo contrario —«gana el piso / el bin»— por analogía con
   el `fixed` de hoy. **El humano lo cerró al revés**, y la razón es la que gobierna: el único filtro que
   quedaría sería el **guardarraíl**, que **se apoya en la rareza**, justo el **proxy malo** que este cambio
   retira del pricing. Atraparía una Secret Rare con dato corrupto pero **no** una **Common de $400 sin
   dato**, que se publicaría al piso de $25 — **reabriendo el hueco exacto que la feature cierra**. El
   argumento del borrador de «deja de vender bulk sin referencia» se descartó: vender barato lo que vale caro
   es la **pérdida irreversible** de N.0.)*
2. ~~**¿El guardarraíl aplica también a la COMPRA?**~~ → **RESUELTA: SÍ, aplica a los DOS EJES** (§N.5,
   decisión **8**, criterio **88**). Premium en el **piso** no se publica; premium en el **bin** no se
   cotiza. *(Rastro: estaba redactado solo sobre la publicación y se asumió la simetría; el humano la
   **confirmó explícitamente**, así que dejó de ser supuesto.)*
3. **¿Qué es un «bracket» para la instrumentación?** El dato pedido incluye **bracket de mercado**, pero los
   puntos de la curva son **editables** (se agregan, mueven y borran): si el bracket se define por los puntos
   vigentes, **la serie histórica deja de ser comparable** cada vez que muevas la curva. ¿Prefieres (a) una
   **escala de brackets fija e independiente** de la curva (p. ej. $0–25 / 25–80 / 80–200 / 200–500 / 500+),
   o (b) el bracket vigente al momento de la operación, **guardando también sus límites** para poder
   reconstruir la comparación?
4. **Detalles menores del redondeo** *(supuestos ya redactados en §N.2, confirmar de paso)*: la **banda** se
   elige por el **monto de venta antes de redondear** y **una sola vez** (si el redondeo cruza el umbral, no
   se re-evalúa); las fronteras son `< $200` ⇒ $5, `$200 ≤ x < $500` ⇒ $10, `≥ $500` ⇒ $25; y **todos los
   diales están en MXN**.
5. **¿La alerta del bounty por debajo de la regla necesita aviso activo?** El supuesto es que basta la
   **alerta en el binder** (visible cuando el dueño entra). ¿Quieres además un aviso proactivo (correo/
   dashboard) cuando un bounty publicado queda rebasado por la regla?
