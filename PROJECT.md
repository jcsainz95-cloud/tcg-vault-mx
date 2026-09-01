# PROJECT.md — TCG Vault MX — Marketplace TCG con Bóveda (Pokémon, México)

> **Nombre comercial / marca:** **TCG Vault MX**. Es el nombre que se usa en la interfaz, la
> comunicación y los términos. "Marketplace TCG con Bóveda" es solo el título descriptivo del proyecto.
>
> **ESTADO AL 2026-09-01 (4ª ronda del bloque v2.1 — CORRECTIVA Y ACOTADA — LEER PRIMERO):** el **bloque v2.1
> (ciclo de adquisición del buylist, §P)** sigue **CERRADO y listo para el arquitecto**, con **una corrección
> de raíz**: **D27 y D28 quedan SUPERADAS por D30**. El rechazo parcial **ya no le pregunta nada al
> vendedor**; en su lugar, **la oferta se declara CONDICIONAL a Near Mint línea por línea en el propio correo
> de oferta**, y el vendedor acepta **ese** trato —con su riesgo incluido— **antes de que compremos la
> etiqueta y antes de que empaque nada**. Al verificar **no cambia el trato**: se cumple una condición ya
> escrita y aceptada, así que **no hay nada que re-preguntar**. Consecuencias: **desaparecen** la
> re-confirmación, el uso del ítem **`ajustada`** en este ciclo y el **umbral de «recorte material» del
> 20%** —**D28 queda SIN OBJETO** y los diales del ciclo pasan de **nueve a OCHO** (§P.10)—, y la **pregunta
> abierta 23 queda CERRADA por eliminación** (no hay plazo nuevo, ni semántica del silencio, ni recordatorio
> que fijar). **Las dos protecciones al vendedor NO se tocan**: **el neto nunca es negativo** (criterio
> **152**) y **si se rechaza TODO, absorbemos el envío** (D17, criterio **140**). El **criterio 127** se
> **reformula** (su fórmula citaba el dial que dejó de existir) y abre **una pregunta nueva, no bloqueante:
> la 24**. Los **bloques anteriores** (v1.3, v1.4, v1.5, v1.7 y los dos v2.0) **conservan sus propias
> preguntas abiertas históricas**, todas con **defaults marcados que no bloquean el arranque**; los bloques
> **v1.6, v1.9 y v2.0/P-48 están LOCKED**. Lo único no fijado del alcance son las **metas de lanzamiento
> N/X/Y/Z**, que el humano define al momento de lanzar.
>
> **ESTADO AL 2026-08-31** *(3ª ronda — histórico; superado por la línea de arriba en lo que toca a
> D27/D28 y al dial del 20%; el resto sigue vigente)*: el bloque v2.1 quedó cerrado con **D1–D29** decididas,
> **los cuatro números de dinero fijados** (tope de oferta del operador **MX$1,500**, tarifa de envío del
> buylist **MX$180**, tope de piezas por variante **10**, umbral de recorte material **20%**), el **rechazo
> parcial** resuelto *(como se resolvió ahí quedó superado)* y las **22 preguntas abiertas cerradas**, más
> **una nueva no bloqueante (la 23)** con default redactado.
>
> Estado *(histórico, superado por la línea de arriba)*: borrador para aprobación del humano. Las decisiones
> previas siguen cerradas, PERO el **requisito
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
> una oferta ni una promesa de grado. Decisiones cerradas del humano: **(1) tres superficies** —**ficha**,
> **badge** en las tejas de Compra y **vitrina «Joyas para gradear»** en el home—, con la **superficie visible
> simplificada** *(actualización 2026-08-23: **fuera** el multiplicador, la ganancia calculada y toda
> comparativa; cita: «solo bajemos el precio y desplegamos "en PSA 10 vale tanto"», y confirmó que **quiere los
> dos grados**)*; **(2) gate de ROI sobre PSA 9** (no sobre PSA 10) con la fórmula
> `estimadoPSA9 >= (precioVentaRaw + gradingCost) × (1 + minUpsidePct)`, que *(actualización 2026-08-23)* pasa
> a ser **criterio de curaduría interno**: la **ficha** muestra los estimados **siempre que haya dato**, y
> **teja y vitrina** —donde promocionamos activamente— **solo** llevan cartas que pasan el gate, **ordenadas la
> vitrina por mayor ganancia neta sobre PSA 9**; **el resultado del cálculo nunca se expone al cliente**; y
> **dos diales configurables** — **`gradingCostTiers`**, una **tabla de escalones** valor de carta → costo de
> gradeo *(actualización 2026-08-23: sustituye al costo plano de MX$600; PSA cobra por nivel de servicio según
> valor declarado y el costo debe incluir **envío internacional y retorno a México**, ver §O.2.1)*, y
> `minUpsidePct` default **30%**; **(3) FUENTE AUTOMÁTICA** *(actualización 2026-08-28 — **supersede el
> arranque manual-first**)*: el estimado se alimenta **automáticamente desde PokemonPriceTracker** (proveedor
> **ya contratado**), que **no valúa nada**: entrega **ventas cerradas reales de eBay agrupadas por grado**
> (`ebay.salesByGrade`, con **número de ventas de la muestra, mediana, promedio y fecha de la última venta**).
> El **override manual del admin se conserva** como respaldo y para **curar cartas concretas**, con la
> **máxima precedencia**; **(4) la cifra SÍ se pinta en la REJILLA de Compra y en la VITRINA del home**
> *(nuevo 2026-08-28)*, pero **condicionada a un GATE DE CONFIANZA**: el número debe ser **fresco**, de
> **origen confiable** (override manual, o dato automático con **muestra suficiente de ventas**) y
> **coherente en magnitud**. La **ficha no aplica la coherencia de magnitud con la misma dureza** —informa lo
> que hay—: solo la rejilla y la vitrina, que son **superficie de promoción**, exigen confianza (**§O.7**);
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
> cartas** (no inspeccionamos ni pre-evaluamos la pieza que vendemos); texto ES/EN reescrito en **§O.5**,
> pendiente de su visto bueno final — y **la feature se entrega detrás de feature-flag APAGADO hasta que ese
> texto quede aprobado**. Ver **§O** (nueva), §A, «Fuentes de precio», criterios **97–112**, decisiones
> **40–55** y las **preguntas abiertas v2.0** al final.
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
> **Requisito v2.1 — CICLO DE ADQUISICIÓN DEL BUYLIST: OFERTAMOS ANTES DE QUE NOS MANDEN NADA (2026-08-31,
> BORRADOR del product-owner sobre DECISIONES DEL HUMANO YA TOMADAS — D1–D12):** hoy el buylist **no decide
> qué compra**. El cliente cotiza, la solicitud nace **`cotizada`** y el siguiente paso que existe es la
> **recepción física**: entre esos dos puntos no hay **estado**, ni **oferta**, ni **correo**, ni **guía**.
> Consecuencia: **el cliente paga un envío sin que le hayamos dicho que sí**, y nosotros descubrimos qué
> compramos **cuando el paquete ya está en la mesa** —con inventario propio eso además es **comprar a
> ciegas**: el admin no ve **ni una cifra de stock** al decidir—. En el otro extremo, **publicar existe pero
> está desconectado**: la pieza convertida a inventario nace **sin ubicación física y sin precio**, y **nada
> la empuja a la venta** (no hay auto-publicación ni cola de pendientes de publicar). Se cierra el ciclo en
> **ocho fases** —**cotiza → ofertamos → acepta → manda la guía → recibimos → verificamos → pagamos →
> publicamos**— con **cuatro estados nuevos**: **`ofertada`**, **`aceptada`**, **`en_transito`** y
> **`expirada`** (terminal). **Doce decisiones cerradas del humano**: **(D1)** la oferta es **todo-o-nada** —
> el cliente ve el **desglose línea por línea** de qué compramos y qué no, pero **acepta o rechaza el paquete
> completo**; **no hay aceptación parcial**—; **(D2)** el **precio ofertado es vinculante desde que sale el
> correo** y **no se reprecia al recibir**; **(D3)** **2 días** para aceptar, **sin respuesta ⇒ rechazada**;
> **(D4)** **3 días** desde la aceptación para capturar paquetería y guía, **sin guía ⇒ expirada**, se
> cancela y **se le notifica**; **(D5)** **la guía la captura el cliente** desde su portal, con el **admin
> como respaldo**; **(D6)** al ofertar, el admin ve por **cada carta** **cuántas tiene en inventario y
> cuántas vienen en camino**, más una **sugerencia de comprar / no comprar** que **NUNCA bloquea** —la
> decisión es del operador, **línea por línea**—; **(D7)** **producto separado**: se cura el hueco de
> identidad por el que **promos y exclusivos de deck** entran a inventario **indistinguibles del set base**
> (sin eso, las cifras de la mesa de decisión mienten); **(D8)** los **dos plazos son diales editables**
> desde el back-office (**M10**), no constantes en código; **(D9)** el **precio de compra es el pactado en la
> oferta, y punto** —**fuente única** del costo de adquisición—, así que **verificar tiene solo dos
> desenlaces**: **llega en NM y se paga lo ofertado**, o **no llega en NM y se rechaza**; **desaparece el
> repreciado**; **(D10)** el **precio de VENTA queda FUERA de este alcance**: lo resuelve la **curva de
> pricing que ya existe** (§N) al publicar; **(D11)** **celular obligatorio** en **tres puntos** —**registro**,
> **alta de usuario por admin** y **antes de crear una solicitud de venta**— (el tercero cubre a quien entró
> con **Google** y a las cuentas viejas con teléfono vacío); **(D12)** el back-office debe **ver qué usuarios
> tienen cotizaciones vivas, con conteo, y poder llamarlos** (el **teléfono viaja en la cola de buylist**).
> Ver **§P** (nueva), §E, §H, «Usuarios y roles», M1/M5/M6/M10, criterios **15/16/25/33** (actualizados) y
> **113–131** (nuevos), decisiones **56–67** y las **preguntas abiertas v2.1** al final. **Alcance acotado:
> el CICLO de adquisición (decidir, comunicar, comprometer, recibir y cerrar hasta publicar); NO cambia la
> matemática del precio (§N), ni la política NM-only (§H), ni los topes/KYC del buylist.** **Este bloque
> tiene supuestos marcados y preguntas abiertas**; el humano debe confirmarlos antes de pasar al arquitecto.
> **⚠ Este bloque quedó parcialmente superado por la 2ª ronda (D13–D23), que sigue abajo**: el **envío del
> vendedor SÍ entra al alcance** (D16 deja sin efecto a D5) y los plazos pasan a **días hábiles** (D14).
> **Requisito v2.1 — SEGUNDA RONDA: EL ENVÍO LO PONEMOS NOSOTROS (2026-08-31, ONCE DECISIONES NUEVAS DEL
> HUMANO — D13–D23; corrigen supuestos del primer pase):** al revisar el borrador, el humano cerró once
> huecos y **corrigió cuatro supuestos**. El cambio de fondo es **D16**: **la guía de envío del vendedor la
> mandamos NOSOTROS** y su costo **se descuenta del pago**. Eso **deja sin efecto a D5** (ya no es el cliente
> quien captura la guía) y parte el dinero del buylist en **tres montos que ahora conviven**: **bruto**
> (lo que valen las cartas), **envío** y **neto** (`bruto − envío`, lo que se deposita). Las reglas que lo
> gobiernan: **lo VINCULANTE con el vendedor es el NETO** —el correo de oferta debe mostrar **los tres
> montos** y decir **cuál se deposita**, porque prometer $1,480 y depositar $1,350 rompe exactamente la
> confianza que la oferta vinculante venía a construir—; el **costo de adquisición del inventario sigue
> siendo el BRUTO** (el envío es **gasto operativo**, no costo de la pieza: mezclarlos ensucia el P&L por
> carta); y los **topes AML/INE se juzgan sobre el BRUTO** (el valor comprometido), aunque el **SPEI salga
> por el neto**. Alrededor de eso: **(D13)** **el operador SÍ puede ofertar hasta un tope de monto**
> —arriba de ese tope la oferta la **autoriza el súper-admin**—, reusando la mecánica de topes que el buylist
> ya tiene *(corrige el supuesto de «solo súper-admin»)*; **(D14)** los plazos se cuentan en **días HÁBILES**,
> no naturales —una oferta enviada el viernes **no vence el domingo**— *(corrige el supuesto de días
> naturales)*; **(D15)** la sugerencia de **«no comprar»** se dispara cuando la posición alcanza el
> **objetivo del bounty** de esa variante **o** un **tope general de piezas por variante**, ambos
> configurables, y **nunca bloquea** (D6 intacta); **(D17)** si al verificar **se rechaza todo**,
> **absorbemos el envío**: sin cobranza al vendedor y **sin saldo negativo**; **(D18)** **mínimo de compra
> MX$500** sobre el **total de la solicitud** —sea una carta o mil—, validado **en el servidor** (no solo en
> el cotizador), y el cotizador dice **cuánto falta** («te faltan $120»); **(D18b)** **umbral de guía
> MX$1,000**, **dial separado** del mínimo, con **tres bandas**: **&lt;$500 no se compra**, **$500–$1,000 se
> compra y el vendedor paga su envío como hoy**, **&gt;$1,000 se compra y la guía la ponemos nosotros**;
> **(D19)** la guía se genera **A MANO** —el operador la compra fuera del sistema y **captura el número**—:
> **no hay integración con paquetería** y eso es **proyecto aparte**, el sistema solo **guarda y muestra**;
> **(D20)** **el operador** es quien marca **«en tránsito»**, al confirmar el envío; **(D21)** la guía se
> compra **AL ACEPTAR, no al ofertar** —solo se gasta etiqueta en quien ya dijo que sí—, el correo de oferta
> **anuncia** que el envío corre por nuestra cuenta y que la guía **llega al aceptar**, y los **3 días de D4
> corren desde que la guía LLEGA al vendedor**, no desde que aceptó; **(D22)** la etiqueta debe ser
> **cancelable o reembolsable**, y una solicitud que **vence con guía emitida** deja la tarea **«cancelar
> guía no usada»** en la cola del operador; **(D23)** **SÍ hay recordatorio** —**uno solo**, a **un día
> hábil** de vencer y **una sola vez**, no en cada corrida del barrido— *(revierte la decisión del primer
> pase de dejar los recordatorios fuera de alcance)*. Se **cierran además seis preguntas abiertas** del
> primer pase: **no se re-oferta** sobre una solicitud terminal, **no se edita** una oferta ya enviada (se
> cancela y se emite otra), los **correos obligatorios son tres** (oferta, recordatorio, expiración),
> **aceptar exige sesión** (no hay enlace anónimo), **«solicitud viva» = todo lo que NO sea terminal**
> (terminales: **pagada, rechazada, abandonada, expirada**) y la **ubicación NO se exige al convertir**
> —bloquear la conversión atoraría el pago— pero la pieza sin ubicación **sale señalada** en la cola de
> pendientes de publicar. **Riesgo conocido que queda registrado (D20 × D4)**: si el vendedor deposita el
> paquete el día 3 y el operador no lo confirma hasta el día 4, el barrido expiraría una solicitud donde el
> vendedor **sí cumplió**; la dirección aprobada es **separar el reloj del estado** (§P.13). Ver **§P.4,
> §P.12, §P.13** (nuevas/reescritas), §E, §H, «Usuarios y roles», M1/M5/M6/M10, criterios **16/25/113/116/
> 119/121/122/123/125/127/129** (actualizados) y **132–146** (nuevos), decisiones **68–80** y las **preguntas
> abiertas v2.1** al final (con el estado de cierre de cada una). **Siguen abiertas** la pregunta **11** y
> las **nuevas 13–22**, de las cuales **cinco mueven dinero** (13, 14, 16, 20 y 22). **Una de ellas es una
> tensión interna que este documento NO resuelve en silencio**: **D16 pide que el correo de oferta muestre el
> envío**, pero **D21 compra la etiqueta después de mandar ese correo** — se propone descontar una **tarifa
> configurable congelada al ofertar** y se marca como supuesto (§P.4, pregunta 20).
> **⚠ Este bloque quedó cerrado por la 3ª ronda (D24–D29), que sigue abajo**: los cuatro números están
> fijados, el rechazo parcial está decidido y las diez preguntas abiertas quedaron resueltas.
> **Requisito v2.1 — TERCERA RONDA: LOS CUATRO NÚMEROS QUE FALTABAN Y EL RECHAZO PARCIAL (2026-08-31, SEIS
> DECISIONES NUEVAS DEL HUMANO — D24–D29; con ellas se CIERRA el bloque v2.1):** el humano fijó **los cuatro
> números** que bloqueaban el ciclo y **decidió el caso que faltaba** —qué pasa cuando al verificar se
> rechazan **solo algunas** cartas—. **(D24)** **tope de oferta del operador = MX$1,500** de **bruto**; por
> encima de ese monto la oferta **requiere autorización del súper-admin** *(descarta el default money-safe de
> MX$0 que yo había propuesto)*. **(D25)** **tarifa de envío del buylist = MX$180**, **congelada al ofertar**
> — **es la resolución de la tensión D16×D21** que este documento había señalado sin resolver, y es la salida
> correcta **justo por la razón que se dio**: si la etiqueta real sale **más cara la absorbemos**, si sale
> **más barata es margen nuestro**, y así **el neto sigue siendo vinculante**. Es un **dial**, y es
> **distinto** de la tarifa de envío de retiro (MX$175). **(D26)** **override manual al ofertar: SÍ** — el
> operador puede fijar a mano el monto de una línea **dentro de su tope**, con **motivo obligatorio** y
> **auditado** (quién, cuánto y por qué). **(D29)** **tope general de piezas por variante = 10**: cuando la
> **posición** de esa variante —**stock + verificando + tránsito + comprometido**— llega a **10 piezas** y la
> carta **NO tiene bounty**, la mesa pinta **«no comprar»**; **sigue sin bloquear** (D6 intacta).
> **⚠ D27 y D28 quedaron SUPERADAS por D30 (4ª ronda) — se conservan aquí como historial, no como
> requisito**: ~~**(D27)** **rechazo PARCIAL: se le pregunta al vendedor si quiere continuar** con la
> operación **antes de pagar**, **reusando el flujo de ajuste que ya existe** (ítem `ajustada` + plazo +
> aceptar/rechazar del cliente) — **no es un mecanismo nuevo** y **no es aceptación parcial**: sigue siendo
> **todo-o-nada sobre el paquete reducido** (D1 intacta). **(D28)** **solo se pregunta si el bruto aprobado
> cae MÁS de 20%** respecto al bruto ofertado; por debajo de ese umbral **se procede y se paga**, y el
> **correo de rechazo por carta que ya existe** lo mantiene informado —preguntar por una común de $2 en una
> oferta de $1,480 es **fricción pura**—; **el umbral es un dial**. Si el vendedor **dice que no**, corre la
> **devolución de §H** (7 días a su costo, abandono a 30) **pero el envío de ida lo absorbemos nosotros**: el
> rechazo fue **decisión nuestra** (coherente con D17).~~
> Y se fija el **INVARIANTE money-safe** que faltaba —**este SÍ sigue vigente y no lo toca D30**—: **el NETO
> NUNCA puede ser negativo** — si el bruto aprobado queda por debajo de la tarifa de envío (ofertaste $1,480,
> apruebas $100, envío $180 ⇒ −$80), el neto **se topa en cero** y **la diferencia la absorbemos**; **jamás se
> le cobra al vendedor por habernos mandado cartas** (criterio **152**). Se cierran además **las siete
> preguntas restantes**: **el inventario ya capturado se corrige a MANO** —ninguna migración adivina— (P11,
> supuesto confirmado); **el tope de compromiso mensual suma BRUTOS** (misma base que AML/INE) y **el
> acumulado de dinero pagado se mide en NETOS** (lo que salió por SPEI) — **dos medidas distintas que
> conviven** (P14); **«día hábil» = lunes a viernes, sin festivos oficiales de México, en
> `America/Mexico_City`** (P15); **un «ya lo mandé» sin confirmar se destaca como ALERTA a los 5 días
> hábiles** (dial) en la cola de «por confirmar envío», y **no infla el conteo de «en camino»** porque no
> mueve el estado (P17); **bajar un plazo en M10 no toca las fechas ya comunicadas** —el plazo se **congela
> por solicitud** en el momento en que se fija— (P18); **$500 y $1,000 son AMBOS inclusivos** *(esto
> **corrige** mi supuesto: exactamente **$1,000 SÍ lleva guía nuestra**)* y **el mínimo NO se re-aplica tras
> el cherry-pick** —gatea la **creación de la solicitud**, no la oferta— (P19); y el **recordatorio es UNO POR
> PLAZO**, cada uno **una sola vez** (P21).
> **⚠ Dos contradicciones señaladas, NO resueltas en silencio**: **(a)** ~~D27 **reusa el flujo de ajuste**
> que D9 había dado por desaparecido, y el criterio **124** decía que en verificación *«no existe ajustar»* —
> se **acota, no se borra**: lo que D9 mató fue **repreciar una línea** (**ningún monto unitario se mueve
> jamás**), y lo que D27 trae es **confirmar un alcance reducido**, que es otra cosa~~ — **contradicción
> DISUELTA por D30 (4ª ronda)**: sin re-confirmación, el ciclo de buylist **no usa `ajustada` en ningún
> punto** y el criterio **124** vuelve a ser cierto **sin acotación**; **(b)** D29 **amplía la
> definición de «posición»** que gobierna el tope (**stock + verificando + tránsito + comprometido**) frente
> al *«stock + en camino»* que yo había escrito, y **convierte el «o» de D15 en una precedencia** (**con
> bounty manda el bounty; el tope general de 10 solo aplica sin bounty**) — la definición de **«en camino»
> que se MUESTRA** (solo `en_transito`, criterio 116) **no cambia**: son dos preguntas distintas, *«¿qué
> viaja?»* y *«¿de cuántas copias ya soy responsable?»*. Ver **§P.2, §P.4, §P.5, §P.6, §P.10, §P.12, §P.13**
> (actualizadas), §E, §H, M5/M10, criterios **16/124/127/133/144** (actualizados) y **147–160** (nuevos), y
> decisiones **81–88**. ~~**Queda UNA pregunta abierta nueva (23)**, creada por D27: **qué plazo tiene el
> vendedor para contestar «¿continúas?», qué significa su silencio y si ese plazo lleva recordatorio** — con
> default propuesto y **no bloqueante para el arquitecto**.~~ **⚠ La pregunta 23 quedó CERRADA POR
> ELIMINACIÓN en la 4ª ronda (D30)**: sin re-confirmación no hay plazo que fijar.
> **⚠ Este bloque quedó corregido por la 4ª ronda (D30), que sigue abajo.**
> **Requisito v2.1 — CUARTA RONDA: LA OFERTA ES CONDICIONAL DESDE EL PRINCIPIO, NO SE RE-PREGUNTA AL FINAL
> (2026-09-01, UNA DECISIÓN CORRECTIVA DEL HUMANO — D30; supersede D27 y deja D28 SIN OBJETO):** el humano
> detectó que **D27 estaba mal planteada de raíz** y la corrigió. **El error**: preguntarle al vendedor
> *«¿quieres continuar?»* cuando se rechazan algunas cartas llega **en el peor momento posible** — **ya
> compramos la etiqueta y ya tenemos sus cartas en la bóveda**. Ninguna respuesta es buena: si dice que no
> hay que devolver todo y comernos el envío de ida; si no contesta, quedan **cartas ajenas atoradas sin
> regla clara**. Y encima obligaba a **inventar un plazo nuevo** (justo la pregunta 23 que quedó abierta).
> **(D30)** **la condición va al FRENTE, no la pregunta al final**: **la oferta es condicional por
> naturaleza y eso se DECLARA en el correo de oferta**. El correo dice, **línea por línea**: *«compramos
> estas N cartas a estos precios, **siempre que lleguen en Near Mint**; la que no llegue en NM **no se
> compra** y **se te devuelve**»*. El vendedor **acepta ese trato —con su riesgo incluido— antes de que
> compremos la etiqueta y antes de que empaque nada**. Después, al verificar, **el trato no cambió**: se
> cumplió una condición **que ya estaba escrita y aceptada**, así que **no hay nada que re-preguntar**. Esto
> **encaja con lo que este documento ya exigía**: la política **solo-NM** es requisito central y visible en
> el **cotizador**, la **guía de envío** y los **términos** (§H) — D27 le montaba **una segunda confirmación
> encima a un trato que ya era condicional**. **Qué pasa cuando algunas cartas fallan NM**: se rechazan
> **una por una** con el **correo por carta que ya existe**, se paga **lo aprobado al precio ofertado** y las
> rechazadas siguen la **regla de devolución vigente** de §H (**7 días a su costo**, **abandono a 30**).
> **Sin estado nuevo, sin plazo nuevo, sin pregunta.** **Lo que NO se toca**: **el neto nunca es negativo**
> (criterio **152**) y **si se rechaza TODO, absorbemos el envío** (D17, criterio **140**). **Efecto
> colateral resuelto**: la validación entre diales del criterio **127** citaba
> `umbral de guía × (1 − umbral de pregunta)`; **al desaparecer el umbral de pregunta esa fórmula perdió
> base** y se **reformula** con la relación que sigue siendo cierta —**la tarifa de envío debe ser
> estrictamente menor que el umbral de guía**, para que **ninguna oferta con todo aprobado pueda depositar
> MX$0**— (marcado `SUPUESTO`, **pregunta abierta 24**, no bloqueante). Ver **§P, §P.1, §P.3, §P.5.1
> (reescrita), §P.6, §P.10, §P.11** (actualizadas), **§E**, **§H**, **«Fuera de alcance»**, **M5/M10**,
> criterios **16/124/127/150/151** (corregidos), criterio **161** (nuevo — el correo declara la condición por
> línea) y decisión **89**. **Preguntas: la 6, la 16 y la 23 se re-anotan; se abre la 24.**
> Este documento manda sobre el contrato y sobre el código (ver `CLAUDE.md` › Regla de conflicto).

## Idea en una frase
**TCG Vault MX** es un marketplace de cartas Pokémon (TCG) en México que vende **cartas individuales** con
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
  la plataforma ni ve back-office. *(NUEVO v2.1, D11)*: **el celular es un dato obligatorio de la cuenta** —
  se pide **al registrarse** y, si la cuenta no lo tiene (entró con **Google** o es una cuenta vieja con el
  campo vacío), **se le pide antes de dejarlo crear una solicitud de venta**. *(NUEVO v2.1)*: en el buylist
  el cliente además **acepta o rechaza la oferta** que le mandamos por correo y, cuando deposita el paquete,
  **avisa que ya lo mandó** — un aviso que **detiene su reloj** pero **no** mueve el estado, porque **quien
  confirma el envío es el operador** (§P.4, §P.13). *(Actualizado 2ª ronda v2.1, D16/D20: el cliente **ya no
  captura la guía** — arriba del umbral **la ponemos nosotros** y **la captura el operador**; supersede D5.)*
- **Súper-admin (dueño del negocio)**: acceso total al back-office (M1–M10). Es el único que
  **toca dinero que sale** (pagos SPEI de buylist, reembolsos), edita configuración/diales y ve
  finanzas. Fija precios "pendientes" a mano. En el MVP, el negocio ES el admin. *(NUEVO v2.1)*: decide qué
  se compra y **emite ofertas de buylist sin tope**; además **autoriza** las ofertas del operador que
  **rebasan el tope** de éste (§P.2, D13). El **celular es obligatorio** también en el **alta de usuario que
  él hace desde el back-office** (D11).
- **Operador de bóveda**: rol de back-office limitado. Opera M1 (inventario/bóveda), M4
  (retiros/envíos) y M5 (buylist) **hasta la etapa de verificación**. **No** toca dinero,
  configuración ni finanzas. Toda su actividad queda en bitácora. *(Actualizado 2ª ronda v2.1, D13 — corrige
  el supuesto del primer pase de que ofertar era exclusivo del súper-admin)*: **SÍ puede emitir ofertas de
  buylist hasta un tope de monto** (dial de M10, sobre el **bruto** de la oferta); **por encima del tope la
  oferta no sale sola: la autoriza el súper-admin**. Además **compra la guía a mano y captura su número**
  (D19), **confirma el envío** y marca **«en tránsito»** (D20). Sigue sin poder **pagar** (el SPEI es del
  súper-admin), ni ver finanzas, ni editar diales.

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
      **tres superficies**: **ficha**, **badge en las tejas** y **vitrina «Joyas para gradear» en el home**.
      **Solo eso: sin multiplicador, sin ganancia calculada, sin comparativa** *(simplificación 2026-08-23)*.
      Es un **estimado ilustrativo con disclaimer obligatorio** —**nunca** un precio de venta ni una promesa de
      grado—. El **gate de ROI sobre PSA 9** (§O.2) es **criterio de curaduría interno**: la **ficha** muestra
      lo que haya, y **teja y vitrina** solo llevan cartas que pasan el gate. **La cifra SÍ se pinta en la
      rejilla y en la vitrina** *(2026-08-28)*, pero solo si además **supera el gate de confianza** (§O.7):
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
- [ ] Crear una **solicitud de venta** a partir de la cotización. *(Actualizado v2.1, §P)*: la solicitud nace
      **`cotizada`** y **NO autoriza a enviar nada** — es una **petición de compra, no un trato cerrado**. El
      vendedor **no manda cartas ni paga envío** hasta que recibe **nuestra oferta por correo** y la
      **acepta**. La pantalla de confirmación lo dice con todas sus letras: *"aún no nos mandes nada;
      te vamos a escribir con lo que compramos y a qué precio"*.
- [ ] **Mínimo de compra: MX$500** *(NUEVO 2ª ronda v2.1, D18; ver §P.12)*: **por debajo del mínimo NO se
      crea la solicitud**. El mínimo se juzga sobre el **TOTAL de la solicitud** —da igual si es **una carta
      o mil**—, se **valida en el servidor** (no solo en el cotizador, que es superficie del cliente y se
      puede saltar) y el cotizador **dice cuánto falta** para alcanzarlo (*«te faltan $120»*), no solo que no
      se puede. Es un **dial de M10**, distinto del umbral de guía.
- [ ] **El envío del vendedor lo ponemos nosotros desde MX$1,000** *(NUEVO 2ª ronda v2.1, D16/D18b;
      **precisado en la 3ª ronda, D25 + bordes**; ver §P.4 y §P.12)*: hay **tres bandas** por monto de la
      solicitud/oferta — **menos de $500: no se compra**; **de $500 (inclusive) a menos de $1,000: se compra y
      el vendedor paga su envío**, como hoy; **de $1,000 (inclusive) en adelante: se compra y la guía la
      mandamos nosotros**, descontando del pago una **tarifa fija de MX$180** (`bruto − envío = neto`),
      **congelada al ofertar**. **Los dos bordes son inclusivos.** Los tres umbrales —mínimo, umbral de guía y
      tarifa— son **diales separados** de M10.
- [ ] **Celular obligatorio para vender** *(NUEVO v2.1, D11)*: **no se puede crear una solicitud de venta sin
      un celular de contacto** en la cuenta. Si falta (cuenta creada con **Google** o cuenta vieja con el
      campo vacío), se pide **en ese momento** y la solicitud no avanza hasta capturarlo. Razón de negocio: el
      buylist es el flujo donde **hay dinero, plazos cortos y paquetes en tránsito** — necesitamos poder
      **llamar al vendedor** (ver D12 y §P.9).
- [ ] Cartas sin precio en la web → **cola de "precio pendiente"** para que el dueño las fije.
- [ ] **Ofertamos antes de que nos manden nada** *(NUEVO v2.1, ver §P.2–§P.3)*: el admin abre la solicitud en
      una **mesa de decisión** que le muestra, **por cada carta**, **cuántas tiene en inventario** y
      **cuántas vienen en camino**, más una **sugerencia de comprar / no comprar** que **nunca bloquea**;
      **decide línea por línea** qué compra y qué no (**cherry-pick al ofertar**) y **manda al cliente un
      correo con el desglose y el precio**. La oferta es **todo-o-nada** (el cliente ve qué queda fuera, pero
      **acepta o rechaza el paquete completo**) y **es vinculante desde que sale el correo**. *(2ª ronda,
      D13; **número fijado en la 3ª ronda, D24**)*: la emite el **súper-admin sin tope** o el **operador
      hasta MX$1,500 de bruto**; por encima de ese monto, **la autoriza el súper-admin** antes de salir.
      *(3ª ronda, D26)*: el operador **también puede fijar el monto de una línea a mano** (override de
      compra), **dentro de su mismo tope**, con **motivo obligatorio** y **auditado**; si el override empuja
      el bruto arriba del tope, la oferta **pasa a autorización** como cualquier otra.
- [ ] **El correo de oferta muestra TRES montos** *(NUEVO 2ª ronda v2.1, D16)*: **bruto** (lo que valen las
      cartas que compramos), **envío** (la guía que ponemos nosotros, cuando aplica) y **neto**
      (`bruto − envío`), diciendo **explícitamente cuál se deposita**. Prometer **$1,480** y depositar
      **$1,350** rompe justo la confianza que la oferta vinculante venía a construir. **Lo vinculante con el
      vendedor es el NETO.**
- [ ] **El cliente acepta y la guía sale después** *(Actualizado 2ª ronda v2.1, D16/D19/D20/D21; supersede
      D5, ver §P.4)*: aceptar **no pone nada en camino**. En la banda con guía nuestra, **al aceptar** el
      operador **compra la etiqueta a mano** (fuera del sistema), **captura su número** y **se la manda al
      vendedor**; el vendedor empaqueta, deposita el paquete y **avisa que ya lo mandó**; **el operador
      confirma el envío** y ahí la solicitud pasa a **`en_transito`**. Plazos: **2 días hábiles** para
      aceptar y **3 días hábiles** para que el paquete salga, **contados desde que la guía llega al
      vendedor** (en la banda donde el envío lo paga él, desde la aceptación). **Diales de M10**, ver §H.
- [ ] Recepción física, verificación de condición y **pago (SPEI)** los opera el admin a mano (ver
      back-office M5), **conciliando contra la guía** capturada. *(Actualizado v2.1, D9)*: el **cherry-pick
      carta por carta ocurre AL OFERTAR**, no al recibir; **verificar tiene solo dos desenlaces** — la carta
      **llega en NM y se paga lo ofertado**, o **no llega en NM y se rechaza** (§P.5). **No hay repreciado
      al recibir.**
- [ ] **Mensaje explícito al vendedor — TRES ideas, no dos** *(actualizado v2.1; precisado en la 2ª ronda por
      D16; **ampliado en la 4ª ronda por D30**)*: el cotizador/solicitud, el correo de oferta y los términos
      comunican claramente que
      **(a) solo compramos lo que te ofertamos por correo, y el NETO que anunciamos es el que se deposita**
      (no se recalcula al recibir; **lo único que puede reducirlo es que una línea no cumpla la condición NM
      de (c)** — nunca un recálculo nuestro, criterio 134),
      **(b) el pago se realiza DESPUÉS de que recibimos y verificamos la carta** (nunca por adelantado),
      alineado con el pipeline
      `cotizada → ofertada → aceptada → en_transito → recibida → verificación → aprobada → pagada`, y
      **(c) *(NUEVO 4ª ronda, D30)* la compra de CADA línea está condicionada a que esa carta llegue en Near
      Mint** — *«compramos esta carta a $X **siempre que llegue en NM**; la que no llegue en NM **no se
      compra** y **se te devuelve**»*. Es **parte del trato que el vendedor acepta**, no un aviso posterior:
      por eso, si al verificar se rechaza alguna, **se paga lo aprobado y no se le vuelve a preguntar nada**
      (§P.5.1).
- [ ] **Guía de empaque/envío seguro** visible en el flujo de buylist **antes de crear la solicitud**:
      sugiere proteger la carta con **sleeve** y **top loader**, sobre rígido, sobre acolchado, etc.,
      para minimizar daños en tránsito y disputas; incluye la **política NM-only** (solo compramos Near Mint).
      *(Actualizado v2.1; precisado en la 2ª ronda)*: la misma guía se repite **donde de verdad se usa** — en
      el **correo/pantalla de aceptación** y en el **correo con el que le mandamos su guía de envío** —,
      porque ese es el momento en que el vendedor empaqueta. Es **información**, no un paso bloqueante.
- [ ] **Límites anti-fraude/KYC** (defaults configurables en M10): tope por solicitud **MX$3,000** y por
      mes **MX$10,000**; pago solo por SPEI a una cuenta **a nombre del propio usuario**; **INE** requerido
      cuando se supera el tope. El **INE se pide en el paso de pago del buylist** (sobre el tope), se
      **verifica contra el nombre de la CLABE** y su **imagen se almacena cifrada en R2 con retención**
      (`INE_RETENTION_DAYS`, default **180**); la **CLABE se guarda cifrada en BD**.
      (Ver soporte AML en "Riesgos y banderas para el humano".)
      *(Actualizado 2ª ronda v2.1, D16 — cierra el supuesto del primer pase)*: los topes se evalúan **en los
      dos momentos** (al cotizar y al ofertar), y el monto que los gobierna —y que gobierna el **KYC/INE**—
      es el **BRUTO OFERTADO**, es decir **el valor comprometido con el vendedor**, no el neto que sale por
      SPEI. Razón: el envío que descontamos es **gasto nuestro**, no una compra más chica; si el tope se
      juzgara sobre el neto, bastaría con un envío caro para **colar una operación por debajo del umbral de
      INE**. **El SPEI se ejecuta por el NETO; el tope y el INE se juzgan por el BRUTO.**
      *(3ª ronda, respuesta a la pregunta 14 — supuesto confirmado y precisado)*: el **tope MENSUAL también
      suma BRUTOS**, por la misma razón (es un **tope de compromiso**, misma base que AML/INE). En paralelo,
      el **acumulado de dinero pagado** —el que reporta M7— se mide en **NETOS**, porque es **lo que
      realmente salió por SPEI**. **Son dos medidas distintas y ambas conviven**; no se sustituyen.

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
  - [ ] **Cola de "pendientes de publicar" (NUEVO v2.1, §P.7)**: una pieza que entra a inventario y **todavía
        no está a la venta** (le falta **ubicación física**, **precio de venta**, o ambos) **no se queda
        invisible**: aparece en una **cola de trabajo** que dice **qué le falta**, y **sale de la cola sola**
        en cuanto tiene las dos cosas. Cerrar esa cola es lo que convierte una compra en **inventario
        vendible**. Aplica a **toda** pieza nueva, venga del buylist o del alta manual. *(2ª ronda v2.1)*: la
        **ubicación NO se exige al convertir** —exigirla atoraría el pago—, pero la pieza que llega **sin
        ubicación** sale **señalada** en la cola, para que se vea de un golpe cuál es la que falta ubicar.
  - [ ] **Auto-publicación (NUEVO v2.1, §P.7)**: cuando una pieza tiene **ubicación** y **precio de venta**,
        **se publica sola** en Compra — sin que nadie tenga que acordarse de apretar un botón. Se respeta la
        **Regla de Compra** (§A): lo que está en **«precio pendiente»** **no se publica**.
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
- [ ] **M5 — Buylist** *(pipeline ampliado en v2.1, §P)*: pipeline
      `cotizada → ofertada → aceptada → en_transito → recibida → verificación → aprobada → pagada`, con
      **estados terminales** **`pagada`**, **`rechazada`** (el cliente dice que no, o **no responde en el
      plazo**), **`expirada`** (aceptó pero **el paquete no salió en el plazo**) y **`abandonada`** (los 30
      días de §H). **Decisión carta por carta AL OFERTAR** (cherry-pick), **mesa de decisión con inventario a
      la vista** (stock propio + piezas en camino + sugerencia no bloqueante, §P.2), **envío del correo de
      oferta** (con **bruto / envío / neto**, D16), **autorización del súper-admin** para las ofertas del
      operador **por encima de su tope** (D13), **captura manual del número de guía** y **confirmación del
      envío** por el operador (D19/D20), **seguimiento de los dos plazos en días hábiles** con **un
      recordatorio único por plazo** a un día hábil de vencer (D14/D23), **tarea de «cancelar guía no usada»**
      cuando una solicitud con guía emitida vence (D22), **cola de precio pendiente** y **conversión a
      inventario en un clic** al pagar. La cola muestra el **teléfono del vendedor** y permite ver **qué
      usuarios tienen cotizaciones vivas y cuántas** (§P.9).
      *(NUEVO 3ª ronda v2.1; **corregido en la 4ª**)*: se suman **(a)** la **cola de ofertas pendientes de
      autorización** del súper-admin (las del operador por encima de **MX$1,500**, D24), **(b)** el
      **override manual de línea al ofertar** con **motivo obligatorio** (D26) y **(c)** la cola de **«por
      confirmar envío»**, donde un **«ya lo mandé» sin confirmar** se **destaca como alerta** a los **5 días
      hábiles** (P17).
      ~~**(SUPERSEDED, 4ª ronda D30)** la **confirmación de rechazo parcial** cuando el bruto aprobado cae
      **más de 20%**, reusando el flujo de ajuste (ítem `ajustada` + plazo + aceptar/rechazar, D27/D28).~~
      **M5 NO lleva pantalla ni cola de re-confirmación**: un rechazo parcial se resuelve **rechazando carta
      por carta y pagando lo aprobado** (§P.5.1).
- [ ] **M6 — Usuarios / KYC ligero**: **ficha 360°** del usuario, **CLABE** (guardada **cifrada en BD**),
      **INE** (imagen **almacenada cifrada en R2 con retención** `INE_RETENTION_DAYS`, default 180; verificado
      contra el nombre de la CLABE), límites, **bloquear**. *(v2.1, D11)*: el **celular es obligatorio en el
      alta de usuario que hace el admin**, y la ficha 360° muestra **el teléfono** y **las solicitudes de
      venta vivas** del usuario.
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
      de cambio USD→MXN con colchón, selección de **`PricingProvider`** por tipo de producto, y *(NUEVO v2.1,
      D8)* los **dos plazos del ciclo de buylist**: **plazo para aceptar la oferta** (default **2 días
      hábiles**) y **plazo para que el paquete salga** (default **3 días hábiles**). Ambos son **diales
      editables sin deploy y auditados**, no constantes en código.
      *(NUEVO 2ª ronda v2.1)*: se suman cuatro diales más, todos editables sin deploy y auditados —
      **mínimo de compra** (default **MX$500** *inclusivo*, D18), **umbral de guía a nuestro costo** (default
      **MX$1,000** *inclusivo*, D18b; **dial separado** del mínimo), **tope de oferta del operador** (monto de
      **bruto** por encima del cual la oferta la **autoriza el súper-admin**, D13) y **tope general de piezas
      por variante** que dispara la sugerencia de «no comprar» (D15).
      *(NUEVO 3ª ronda v2.1 — los números que faltaban, ya fijados por el humano; **corregido en la 4ª**)*:
      **tope de oferta del operador = MX$1,500** (D24), **tope general de piezas por variante = 10** (D29) y
      **tarifa de envío del buylist = MX$180** (D25; **distinta** del envío de retiro de MX$175). Se suma
      además el dial de **alerta de «ya lo mandé» sin confirmar** (default **5 días hábiles**, P17).
      ~~Y el **umbral de «recorte material» = 20%** del bruto, el que dispara la pregunta al vendedor en un
      rechazo parcial (D28).~~ **⚠ RETIRADO en la 4ª ronda (D30): dial SIN OBJETO — no se implementa** (§P.10).
      **La tabla completa de los OCHO diales del ciclo vive en §P.10**, que es su origen único.
      *(3ª ronda, P18)*: **cada dial de plazo y la tarifa de envío se CONGELAN por solicitud** en el momento
      en que se fijan — cambiar el dial **solo afecta a las solicitudes nuevas** y **nunca** mueve una fecha
      o un monto ya comunicados por correo.
      *(validación entre diales — **reformulada en la 4ª ronda, D30**)*: M10 **impide** guardar una
      combinación donde la **tarifa de envío del buylist** sea **igual o mayor que el umbral de guía** —hoy
      **MX$180 < MX$1,000**—, porque el umbral es **inclusivo** y ahí **una operación con TODO aprobado
      depositaría MX$0** (§P.5.1, criterio 127). ~~Antes decía: que la tarifa no supere
      `umbral de guía × (1 − umbral de recorte material)` —hoy **$800**—, porque ahí el piso de cero podría
      activarse **sin haberle preguntado al vendedor**.~~ **Esa fórmula citaba un dial que dejó de existir.**
- [ ] **Dashboard** con ~8 tarjetas: ganancia del periodo, ventas, cola de trabajo, valor de inventario,
      valor en custodia, buylist del periodo, salud de datos, progreso de lanzamiento.
- [ ] **Roles del back-office**: súper-admin (todo) y operador de bóveda (M1, M4, M5 hasta verificación;
      sin dinero/config/finanzas). **Regla de oro**: el dinero que sale solo lo toca el súper-admin;
      todo queda en bitácora. *(Actualizado 2ª ronda v2.1, D13 — corrige el supuesto del primer pase)*:
      **emitir una oferta de buylist compromete un pago vinculante (D2)**, así que se gobierna **con la misma
      mecánica de topes que el resto del buylist**: el **operador puede ofertar hasta un tope de monto**
      (dial de M10, sobre el **bruto**) y **por encima de ese tope la oferta la autoriza el súper-admin**.
      **El pago (SPEI) sigue siendo exclusivo del súper-admin, sin tope ni delegación.**
      *(3ª ronda v2.1, D24/D26)*: el tope del operador es **MX$1,500**, y **dentro de ese mismo tope** puede
      además **fijar a mano el monto de una línea** (override de compra) con **motivo obligatorio** y
      auditado. **El override no es una puerta trasera al tope**: si empuja el bruto arriba de MX$1,500, la
      oferta **pasa a autorización** igual que cualquier otra.
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
      *(NUEVO 4ª ronda v2.1, **D30**)*: se agrega una **cuarta superficie, y es la que manda** — el **correo
      de oferta**, donde la condición se declara **LÍNEA POR LÍNEA** y **forma parte del trato que el vendedor
      acepta** (§P.3). En las otras tres es **información**; en el correo de oferta es **la condición del
      contrato**. Por eso un rechazo por no-NM **no requiere volver a preguntarle nada**: **ya lo aceptó**.
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
      *(Nota v2.1, D9)*: estos **dos plazos no cambian** — son de un momento distinto (**la carta ya está en
      nuestras manos**). Lo que cambia es el **disparador**: con el precio ofertado ya vinculante **ya no hay
      "ajuste" al recibir**, así que el caso que los activa en la práctica es la **carta rechazada por no ser
      NM** (y cualquier pieza que el vendedor mande sin habérsela comprado).
      *(Nota 4ª ronda, D30 — **confirma y cierra** la anterior)*: el disparador *«sin respuesta del usuario a
      un ajuste»* queda **sin ninguna ruta viva dentro del buylist**. La 3ª ronda lo había **reactivado** con
      la pregunta del rechazo parcial (D27); **D30 la retira**, así que **el único disparador real es la carta
      rechazada por no ser NM** (más la pieza no comprada). Se conserva la frase por si otro flujo la usa,
      pero **el ciclo de buylist ya no la ejerce** — criterio **16**.
- [ ] **Buylist — plazos del ciclo de adquisición** *(NUEVO v2.1, D3/D4/D8; actualizado 2ª ronda por
      D14/D21/D23; ver §P)*: **antes** de que la carta viaje corren **otros dos plazos, distintos de los de
      arriba**:
      - **2 días hábiles para aceptar la oferta** (contados desde que **sale el correo** de oferta). **Sin
        respuesta en el plazo ⇒ la solicitud queda `rechazada`** (terminal) y la oferta deja de ser válida.
      - **3 días hábiles para que el paquete salga**, contados **desde que la guía llega al vendedor** (D21)
        cuando el envío lo ponemos nosotros, y **desde la aceptación** cuando el envío lo paga él. **Sin
        envío en el plazo ⇒ la oferta `expira`**, la solicitud **se cancela** y **se le notifica al
        vendedor**.
      - **Un recordatorio, uno POR PLAZO** (D23): a **un día hábil** de vencer sale **un** correo de aviso,
        **una sola vez** — no en cada corrida del barrido. *(3ª ronda, respuesta a la pregunta 21: aplica a
        **cada uno de los dos plazos**, así que en un ciclo puede haber **hasta dos** recordatorios, **nunca
        más de uno por plazo**.)*
      - **Los plazos se cuentan en DÍAS HÁBILES** (D14), no naturales: una oferta enviada el **viernes no
        vence el domingo**. Al cliente se le comunican siempre con **fecha y hora explícitas**, nunca como
        "en 2 días".
      - **Definición de «día hábil»** *(3ª ronda, respuesta a la pregunta 15 — supuesto confirmado)*:
        **lunes a viernes**, **excluyendo los festivos oficiales de México**, en zona horaria
        **`America/Mexico_City`** (la misma que el proyecto ya usa para fechas). **El sábado NO cuenta**,
        aunque algunas paqueterías operen. Es **una sola definición** y la usan **todos** los plazos del
        ciclo, el barrido, los recordatorios y las fechas que se le escriben al cliente — para que la fecha
        del correo y la del barrido **sean siempre la misma**.
      Ambos plazos son **diales editables desde M10** (D8), **no constantes en código**, y su cambio queda
      **auditado**. **Cada plazo se congela por solicitud** en el momento en que se fija: cambiar el dial
      **no toca las fechas ya comunicadas** *(3ª ronda, respuesta a la pregunta 18)*.
- [ ] **Buylist — nadie manda cartas sin un sí nuestro** *(NUEVO v2.1, regla dura)*: una solicitud **no puede
      llegar a "en camino" sin haber pasado por `ofertada` y `aceptada`**. El vendedor **no paga envío** hasta
      tener por escrito **qué le compramos y a cuánto**. Si aun así manda algo por su cuenta, esa pieza **no
      está comprada**: se trata como carta no adquirida y aplican los plazos de devolución de arriba.
- [ ] **Buylist — el precio ofertado es el precio pagado** *(NUEVO v2.1, D2/D9)*: el monto de la oferta es
      **vinculante desde que sale el correo** y es la **fuente única del costo de adquisición** de esa pieza
      (el que se usa como **costo** del inventario y en el **P&L de M7**). **No se reprecia al recibir**, ni
      hacia arriba ni hacia abajo: verificar solo decide **si la carta es NM o no**.
- [ ] **Buylist — tres montos que no se mezclan: bruto, envío y neto** *(NUEVO 2ª ronda v2.1, D16)*: cuando
      la guía la ponemos nosotros, el dinero del buylist se lee en **tres cifras** y **cada una tiene un
      papel distinto**:
      - **BRUTO** = lo que valen las cartas que compramos. Es el **costo de adquisición del inventario** (el
        que va al **costo de la pieza** y al **P&L por carta** de M7) y es el monto sobre el que se juzgan
        los **topes AML y el INE**.
      - **ENVÍO** = **MX$180** *(3ª ronda, D25 — dial de M10, **congelado al ofertar**)*. Es **gasto
        operativo del negocio**, **NO** forma parte del costo de la pieza. Si se mezclara con el costo, **el
        P&L por carta quedaría sucio** y dos piezas idénticas tendrían costos distintos según cuánto pesó el
        paquete en que llegaron. Es una **tarifa fija conocida al ofertar**, no lo que costó la etiqueta
        real: si la etiqueta sale **más cara la absorbemos**, si sale **más barata es margen nuestro**
        (§P.4). **No es el mismo dial** que la tarifa de envío de retiro (MX$175).
      - **NETO** = `max( 0 , bruto − envío )`. Es **lo que se deposita** por SPEI y **lo vinculante frente al
        vendedor**: es la cifra que él aceptó y la que espera ver en su cuenta. **Nunca es negativo.**
      El **correo de oferta muestra las tres** y dice **cuál se deposita** (§P.3).
- [ ] **Buylist — dos medidas del dinero que conviven** *(NUEVO 3ª ronda v2.1; respuesta a la pregunta 14)*:
      el **tope de compromiso** —por solicitud **y el mensual**— y el **umbral de INE** se miden en
      **BRUTOS** (es el **valor comprometido**, misma base que los topes AML); el **acumulado de dinero
      pagado** se mide en **NETOS** (es **lo que salió por SPEI**). **Son dos preguntas distintas y las dos
      tienen que existir**: si el tope mensual sumara netos, un envío caro **iría bajando el acumulado** y
      alguien podría **pasar el tope sin que se note**; si el acumulado de caja sumara brutos, **M7
      reportaría una salida de dinero que nunca ocurrió**.
- [ ] **Buylist — el envío nunca genera deuda del vendedor** *(NUEVO 2ª ronda v2.1, D17)*: si al verificar
      **se rechaza todo**, **el envío lo absorbemos nosotros**. **No se le cobra al vendedor**, **no queda
      saldo negativo**, no se descuenta de una venta futura y no se retiene nada. El neto de una solicitud
      **nunca puede ser negativo**: el peor caso para el vendedor es **cobrar $0** por una compra que no se
      concretó, no **deber dinero**.
- [ ] **Buylist — INVARIANTE MONEY-SAFE: el NETO nunca es negativo** *(NUEVO 3ª ronda v2.1; ver §P.5.1 y
      criterio 152)*: el depósito es **`max( 0 , bruto aprobado − envío )`**. Si el bruto aprobado queda por
      **debajo** de la tarifa de envío (ofertamos $1,480, aprobamos $100, envío $180 ⇒ −$80), **el neto se
      topa en cero** y **la diferencia la absorbemos**. **Jamás se le cobra a un vendedor por habernos
      mandado cartas**: no hay cargo, ni saldo negativo, ni retención contra operaciones futuras. Aplica al
      **rechazo total y al parcial**, y **no admite excepciones ni overrides**.
- [ ] **Buylist — LA OFERTA ES CONDICIONAL A NM, LÍNEA POR LÍNEA, Y ESO SE DECLARA EN EL CORREO** *(NUEVO 4ª
      ronda v2.1, **D30** — **supersede D27/D28**; ver §P.3 y §P.5.1)*: el correo de oferta **no ofrece un
      paquete a secas**. Declara, **en cada línea comprada**, **«compramos esta carta a $X, siempre que
      llegue en Near Mint»**, y declara **qué pasa con la que no cumpla**: **no se compra**, **no se paga** y
      **se devuelve** con los plazos de arriba (**7 días a costo del vendedor**, **abandono a 30 días**). El
      vendedor **acepta ese trato —con su riesgo incluido— antes de que compremos la etiqueta y antes de
      empacar nada**.
- [ ] **Buylist — rechazo PARCIAL: se paga lo aprobado, SIN preguntar nada** *(NUEVO 4ª ronda v2.1, **D30**;
      ver §P.5.1)*: si al verificar se rechazan **solo algunas** cartas, **cada una se rechaza
      individualmente** con el **correo de rechazo por carta que ya existe**, **lo aprobado se paga al precio
      ofertado** (neto = `max(0, bruto aprobado − envío)`) y **las rechazadas siguen la regla de devolución de
      arriba**. **No hay pregunta, no hay estado nuevo, no hay plazo nuevo**, **cualquiera que sea el tamaño
      del recorte**. Razón: **al verificar no cambió el trato** —**se cumplió una condición ya escrita y
      aceptada**—, así que no hay nada que re-preguntar. **Intactas**: **el neto nunca es negativo** (bullet
      de arriba, criterio 152) y **si se rechaza TODO, absorbemos el envío** (D17).
      ~~**⚠ SUPERSEDED — lo que decía la 3ª ronda (D27/D28)**: si el bruto aprobado caía **más de 20%** se le
      **preguntaba al vendedor si quería continuar** antes de pagar, reusando el flujo de ajuste (ítem
      `ajustada` + plazo + aceptar/rechazar); si decía que no, corría la devolución **con el envío de ida
      absorbido por nosotros**, y el **umbral del 20% era un dial** de M10.~~ **Retirado**: esa pregunta
      llegaba **con la etiqueta ya comprada y las cartas ya en la bóveda**, donde **ninguna respuesta era
      buena**, y **obligaba a inventar un plazo nuevo**. El **dial del 20% queda sin objeto** (§P.10).
- [ ] **Buylist — mínimo de compra y umbral de guía: dos diales, tres bandas** *(NUEVO 2ª ronda v2.1,
      D18/D18b; **bordes cerrados en la 3ª ronda**; ver §P.12)*: **menos de MX$500 ⇒ no se crea la
      solicitud**; **de MX$500 (inclusive) a menos de MX$1,000 ⇒ se compra y el vendedor paga su envío**,
      como hoy; **de MX$1,000 (inclusive) en adelante ⇒ se compra y la guía la ponemos nosotros**,
      descontando **MX$180** del pago. **Los dos bordes son inclusivos** —exactamente $500 se compra y
      exactamente $1,000 lleva guía nuestra—, ambos **a favor del vendedor**. Los dos umbrales son **diales
      independientes** (mover uno **no** mueve el otro) y el mínimo se **valida en el servidor**, no solo en
      el cotizador. **El mínimo gatea la creación de la solicitud, NO la oferta**: si tras el cherry-pick el
      bruto ofertado cae por debajo del mínimo, **la oferta sale igual** *(3ª ronda, respuesta a la pregunta
      19)*.

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
      Vault MX? Escríbenos a **contacto@tcgvaultmx.com** con fotos y lo cotizamos."* Es un enlace de correo,
      **no** un flujo dentro de la app. *(Confirmado por el PO, ago-2026: el call-out de reventa usa
      `contacto@tcgvaultmx.com` (dominio `tcgvaultmx.com`); las disputas siguen en `soporte@tcgvault.mx`
      (dominio `tcgvault.mx`). Son propósitos y dominios distintos; ambos son correctos y no se unifican.)*

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
> **Alcance de esta feature**: la **presentación** en el storefront (ficha, tejas de Compra, home) más la
> **derivación server-side** del estimado, de su **confianza** y de su **elegibilidad**. **No** cambia el
> precio de venta, el buylist, la bóveda, el inventario ni el P&L. El schema, el contrato y el caching los
> diseña el arquitecto; aquí solo se fija el requisito de producto. *(Nota operativa: la arquitectura va en
> `docs/ARCHITECTURE.md` **§4.38**, el contrato de API en **v1.50** y su seed en **M-42**; el tratamiento
> visual, en `docs/DESIGN_SYSTEM.md` **§22**.)*
> **Estado de entrega — FEATURE-FLAG APAGADO**: la feature se entrega **cableada pero apagada** por defecto y
> **solo se enciende cuando el humano apruebe el texto legal del disclaimer** (§O.5). Mientras el flag esté
> apagado, ninguna de las tres superficies muestra cifra estimada.
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
> - **Teja de catálogo y vitrina del home** → aparecen **SOLO si el gate se cumple** *(y, desde 2026-08-28,
>   solo si además la cifra **supera el gate de confianza** de §O.7)*. Son las superficies donde
>   **promocionamos activamente**, y ahí solo entra lo que **de verdad vale la pena**.
> **El resultado del cálculo NUNCA se expone al cliente**: ni la ganancia neta, ni el escalón de costo
> aplicado, ni un multiplicador, ni el margen. El gate vive **entero del lado del servidor** y su única huella
> visible es **qué cartas aparecen** en teja/vitrina y **en qué orden**. Esto **refuerza SEC-A1**: el cliente
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
      carta **no entra** a teja ni a vitrina (no se infiere, no se interpola, no se aproxima el PSA 9 a partir
      del PSA 10). *(En la **ficha** sí puede mostrarse el PSA 10 que sí existe — ver §O.3.)*
- [ ] *(SUPUESTO: el cálculo usa el **precio de venta raw sin IVA** —el mismo número que ve el comprador en la
      ficha, §B— y **no** incluye el envío de la carta ni el IVA en `precioVentaRaw`. Confirmar con el humano
      si quiere una curaduría aún más conservadora incluyendo esos conceptos; ver preguntas abiertas v2.0.)*

**O.3 — Las tres superficies (SIMPLIFICADAS — ACTUALIZADO 2026-08-28)**
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

- [ ] **(1) Ficha de carta** *(§A)* — la superficie informativa. Muestra **únicamente**:
      - el **precio de venta de la carta** (el que ya se muestra hoy, sin cambio),
      - el **estimado PSA 10**,
      - el **estimado PSA 9**,
      - la **fecha del dato** —para el dato automático, la **fecha de la última venta observada**; para un
        override manual, la fecha en que el admin lo fijó (§O.6),
      - la **llamada al disclaimer** (asterisco) y su **nota al pie** (§O.5).
      **Nada calculado**: sin multiplicador, sin diferencia, sin ganancia, sin costo de gradeo, sin
      comparativa. **No está condicionada al gate de ROI**: si hay dato, se muestra.
      **Si solo existe uno de los dos grados**, se muestra **el que exista** *(SUPUESTO: es información, no
      promoción; ver preguntas abiertas v2.0)*.
- [ ] **(2) Rejilla de Compra — badge con la cifra en la teja** *(§A)* — superficie de **promoción**: aparece
      **solo en cartas que pasan el gate de ROI** (§O.2) **y el gate de confianza** (§O.7). Badge compacto que
      **muestra el estimado PSA 10**.
      *(SUPUESTO de copy, para aprobación: **«En PSA 10 vale ≈ MX$X»**; en móvil, **«PSA 10 ≈ MX$X»**.)*
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
- [ ] **Regla transversal — el cálculo no se filtra**: en **ninguna** de las tres superficies se muestra (ni se
      envía al cliente en el payload) la **ganancia neta**, el **escalón de costo aplicado**, el
      **multiplicador**, el **margen**, el **flag de elegibilidad**, el **tamaño de la muestra de ventas** ni
      los **umbrales de confianza**. Lo único observable desde fuera es **qué cartas aparecen** y **en qué
      orden**.
- [ ] **Bilingüe (§ i18n, criterio 32)**: todos los textos de las tres superficies —incluidos el micro-aviso y
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
- [ ] **Regla por superficie** *(actualizada 2026-08-28)*:
      **Ficha** → se muestra **lo que haya** (PSA 10 y/o PSA 9), **sin** depender del gate de ROI y con el
      listón de confianza **más bajo** (§O.7).
      **Rejilla y vitrina** → **solo** si se cumplen **el gate de ROI y el de confianza**; si falla cualquiera,
      o si falta cualquier insumo (PSA 9, precio, escalón, muestra), **no se renderiza el badge ni la entrada
      de vitrina** — y **sin dejar rastro visual**.
- [ ] **Sin escalón, no se promociona**: si el valor de la carta **no cae en ningún escalón** de
      `gradingCostTiers` (tabla vacía, con huecos o mal editada), la carta **no pasa el gate** y por tanto **no
      entra a teja ni a vitrina**. **Jamás** se asume costo **$0** ni se cae a un default silencioso — un costo
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

**O.5 — Disclaimer (ES / EN) — BORRADOR PARA APROBACIÓN DEL HUMANO — ACTUALIZADO 2026-08-23**
> **Este texto es una propuesta del product-owner y requiere aprobación explícita del humano** (idealmente con
> revisión legal, ver «Riesgos y banderas»). **Hasta que esa aprobación llegue, la feature permanece detrás de
> un feature-flag APAGADO.**
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
> íntegro—: cambia **dónde vive**, no qué dice. El **tratamiento visual** lo diseña **ux-ui**
> (`docs/DESIGN_SYSTEM.md` **§22**); aquí solo se fija la **regla de producto**.

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
> **Lo que NO cambia para el usuario**: mismas tres superficies, mismo gate de ROI, mismo disclaimer, mismas
> reglas money-safe, mismo feature-flag apagado hasta la aprobación legal.

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

- [ ] **Prueba 1 — FRESCO**: la cifra debe caer dentro de la **ventana de frescura de 30 días** (umbral **sin
      cambio**). *(SUPUESTO sobre cómo se mide)*: para el **dato automático**, la ventana se mide contra la
      **fecha de la última venta de la muestra** —esa es la frescura que de verdad importa: la antigüedad de la
      **evidencia de mercado**, no la fecha en que jalamos el archivo—; para un **override manual**, contra la
      fecha en que el admin lo fijó. Confirmar con el humano; ver preguntas abiertas v2.0.
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

- [ ] **Aplicación por superficie — el punto de la decisión**:
      **Rejilla de Compra y vitrina del home** *(promoción)* → exigen **las tres pruebas** **y** el gate de ROI
      (§O.2). Si falla cualquiera, la teja se ve **exactamente como hoy** y la carta **no entra** a la vitrina:
      sin badge vacío, sin $0, sin guion, sin rastro visual.
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
      gate viajan al cliente. Lo único observable desde fuera es **qué cartas llevan cifra en la rejilla y
      cuáles no**.

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
> 3. Un visitante entra al **home** y ve la vitrina **«Joyas para gradear»** con esa carta **y su cifra**.
> 4. Entra a **Compra** y ve la **teja con el badge y la cifra** (estimado PSA 10 + micro-aviso + llamada), y
>    la página lleva su **nota al pie completa**.
> 5. Abre la **ficha** y ve **solo**: el **precio de la carta**, el **estimado PSA 10**, el **estimado PSA 9**,
>    la **fecha del dato**, el **micro-aviso** y la **llamada al pie**. **No ve** multiplicador, ganancia,
>    costo de gradeo, tamaño de muestra ni comparativa alguna.
> 6. Cambia el idioma a **inglés** y todos esos textos —micro-aviso y nota al pie incluidos— salen en inglés.
>
> **Flujo crítico — la curaduría protege al comprador:** el admin sube `minUpsidePct` (o el estimado PSA 9
> baja) de modo que la carta **deja de pasar el gate de ROI** → al recargar, **desaparecen el badge y su
> entrada en la vitrina** sin dejar rastro visual (ni hueco, ni $0, ni «pendiente»); **la ficha sigue mostrando
> sus estimados** (ahí no aplica el gate de ROI) y **el precio de venta de la carta no cambió**.
>
> **Flujo crítico — el gate de confianza filtra basura:** tres cartas con dato automático —una con **muestra
> por debajo de `minSalesSample`**, otra con **PSA 10 por debajo de su precio raw** (el caso del importe en
> dólares tratado como pesos) y otra con **PSA 10 por encima de `maxGradedMultiple`** (el cero de más)—
> **no aparecen en rejilla ni en vitrina**. Las dos últimas **sí siguen informándose en su ficha** y **sí
> aparecen en la lista de revisión** del back-office.
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
> **Flujos negativos que QA debe cubrir:** carta **sin estimado PSA 9** (aunque tenga PSA 10) → **no entra** a
> teja ni vitrina, pero **la ficha sí muestra el PSA 10**; carta **sin dato y sin override** → no muestra cifra
> en ninguna superficie; carta **gradeada** y **sellado** → nunca muestran cifra estimada; **cero cartas
> promocionables** → la vitrina del home **no se renderiza**; **tabla de escalones vacía o con hueco** → la
> carta no se promociona y **nunca** se asume costo $0; **payload inspeccionado desde el cliente** → **no
> contiene** ganancia neta, escalón de costo, `minUpsidePct`, `minSalesSample`, `maxGradedMultiple`, tamaño de
> muestra ni flag de elegibilidad (SEC-A1); **DTO manipulado** → no mete cartas a la vitrina, no cambia el
> orden ni las cifras; **estimado rancio** (última venta de más de 30 días) → no se muestra; **PSA 9 mayor que
> el PSA 10** → no se promociona; **feature-flag apagado** → ninguna superficie muestra cifra; **página con
> cifra estimada pero sin nota al pie**, o **cifra sin llamada/micro-aviso** → defecto **bloqueante**.

### P. Ciclo de adquisición del buylist — ofertar, aceptar, guía y publicar (transversal — NUEVO v2.1)
> **Qué es**: el buylist deja de ser *«el cliente cotiza y algún día llega un paquete»* y pasa a ser un
> **ciclo cerrado de ocho fases**, en el que **decidimos qué compramos ANTES de que el vendedor gaste un peso
> en envío**, y en el que la carta comprada **no se detiene** hasta quedar **a la venta**.
> **El problema que resuelve**: hoy la solicitud nace **`cotizada`** y el siguiente paso que existe es la
> **recepción física**. Entre esos dos puntos **no hay nada**: ni estado, ni oferta, ni correo, ni guía. Eso
> produce tres daños a la vez:
> 1. **El vendedor paga un envío sin que le hayamos dicho que sí** — mala experiencia, y una discusión
>    garantizada el día que rechacemos algo que **ya viajó**.
> 2. **Compramos a ciegas** — descubrimos qué compramos **cuando el paquete ya está en la mesa**, y el admin
>    decide **sin ver una sola cifra de inventario**: no sabe si ya tiene ocho copias de esa carta ni si
>    vienen tres más en camino. Con inventario propio, eso es capital mal puesto.
> 3. **Lo comprado se queda a medio camino** — la pieza entra a inventario **sin ubicación y sin precio**, y
>    **nada la empuja a la venta**: pagamos por mercancía y la dejamos parada.
> **Qué NO es**: **no** cambia **cómo se calcula** el dinero (sigue siendo la curva de §N), **ni** la política
> **NM-only** (§H), **ni** los **montos de los topes/KYC** del buylist. Tampoco es una negociación: el cliente
> **acepta o rechaza**, **no contraoferta** (D1).
> **Qué SÍ cambió en la 2ª ronda (D13–D23)**: **el envío entra al alcance**. Arriba del umbral **la guía la
> ponemos nosotros** y **se descuenta del pago** (D16), lo que parte el dinero en **bruto / envío / neto**;
> aparece un **mínimo de compra** (D18) y un **umbral de guía** (D18b); **ofertar se delega al operador hasta
> un tope** (D13); los plazos pasan a **días hábiles** (D14) y ganan un **recordatorio** (D23). Los **topes
> AML no cambian de monto**: solo se fija que se juzgan sobre el **bruto**.
> **Qué SÍ cambió en la 3ª ronda (D24–D29)**: se fijan **los números** que faltaban —tope de oferta del
> operador **MX$1,500** (D24), tarifa de envío **MX$180** congelada al ofertar (D25), tope de piezas por
> variante **10** (D29) y ~~umbral de recorte material **20%** (D28)~~—, se habilita el **override manual al
> ofertar** dentro del tope y con motivo (D26), y se decide el **rechazo PARCIAL**: ~~**se le pregunta al
> vendedor si quiere continuar** reusando el flujo de ajuste que ya existe (D27)~~. Se fija además el
> **invariante money-safe** que faltaba: **el neto nunca es negativo**.
> **Qué SÍ cambió en la 4ª ronda (D30 — CORRECTIVA)**: el **rechazo parcial se resuelve al revés**. **D27 y
> D28 quedan SUPERADAS**: no se le pregunta nada al vendedor **porque la oferta ya es CONDICIONAL y eso se
> declara en el correo, línea por línea** —*«compramos estas N a estos precios, siempre que lleguen en Near
> Mint; la que no llegue en NM no se compra y se te devuelve»*—. El vendedor acepta ese trato **antes de que
> compremos la etiqueta y antes de empacar**; al verificar **no cambió el trato**, **se cumplió una condición
> ya aceptada**. Con eso desaparecen la re-confirmación, el uso de `ajustada` en este ciclo y el **umbral del
> 20%** (**dial sin objeto**: los del ciclo pasan de **nueve a ocho**), y **la pregunta 23 se cierra por
> eliminación**. **Intactas**: el **piso de cero** (criterio 152) y **D17** (rechazo total ⇒ absorbemos el
> envío). Ver **§P.3** y **§P.5.1**.
> **Alcance de esta feature**: el **ciclo** (decidir, comunicar, comprometer, **mandar la guía**, recibir,
> pagar y publicar), los **cuatro estados nuevos**, los **dos plazos**, los **tres correos** del ciclo, la
> **mesa de decisión** del admin y el **cierre hasta publicar**. **Fuera**: la **integración con paquetería**
> —la etiqueta se compra a mano, D19—. El schema, el contrato, las plantillas de correo y el tratamiento
> visual los definen arquitecto y ux-ui; aquí solo se fija el **requisito de producto**.

**P.1 — Las ocho fases y los estados**

| # | Fase | Estado al terminar | Quién actúa | Qué cambia respecto a hoy |
|---|---|---|---|---|
| 1 | **Cotiza** | `cotizada` | Cliente | **Igual que hoy** (cotizador público, monto derivado server-side, §E) + **mínimo de MX$500** (D18) |
| 2 | **Ofertamos** | `ofertada` | Súper-admin, **u operador hasta su tope** (D13) | **NUEVO** — se decide línea por línea y **sale el correo con desglose, bruto/envío/neto y fecha límite** |
| 3 | **El cliente acepta** | `aceptada` | Cliente | **NUEVO** — dijo que sí, pero **todavía no hay nada en camino** |
| 4 | **Sale el paquete** | `en_transito` | **Operador** (confirma el envío, D20) | **NUEVO** — arriba del umbral **la guía la ponemos nosotros** (D16) y **se compra AL ACEPTAR** (D21) |
| 5 | **Recibimos** | `recibida` | Admin / operador | Igual que hoy, ahora **conciliando contra la guía** |
| 6 | **Verificamos** | `verificación` → `aprobada` | Admin / operador | Igual que hoy (**NM carta por carta**), con **dos desenlaces** (D9). *(4ª ronda, D30 — **corrige** lo que la 3ª ronda ponía aquí)*: un **rechazo parcial NO abre estado ni pregunta**; se paga **lo aprobado al precio ofertado** y las rechazadas se devuelven según §H (§P.5.1). **El ítem `ajustada` NO se usa en este ciclo** |
| 7 | **Pagamos** | `pagada` | Súper-admin | Igual que hoy (**SPEI**) + **se deposita el NETO** (D16), **nunca negativo** + **conversión a inventario** |
| 8 | **Publicamos** | pieza **a la venta** | Admin / operador | **NUEVO** — cerrar el ciclo: **ubicación + precio ⇒ publicada** |

- [ ] **Estados terminales — son cuatro** *(actualizado 2ª ronda v2.1; cierra la pregunta 10)*: **`pagada`**
      (el ciclo terminó bien), **`rechazada`** —el cliente dice que no, **o no responde en el plazo de
      aceptación** (D3)—, **`expirada`** —aceptó pero **el paquete no salió en el plazo** (D4)— y
      **`abandonada`** —los **30 días** de §H con la carta ya en nuestras manos—. Ninguna deja nada pendiente
      ni cartas comprometidas. **Todo lo que no es terminal es una «solicitud viva»** (§P.9).
- [ ] **Regla dura del ciclo**: **no se puede llegar a `en_transito` sin haber pasado por `ofertada` y
      `aceptada`**. Es la regla que impide que alguien pague un envío —o que nosotros compremos una guía—
      sin un sí de las dos partes (§H).
- [ ] **Una solicitud terminal NO se revive** *(cerrado por el humano — respuesta a la pregunta 2)*: tras
      **`rechazada`**, **`expirada`** o **`abandonada`**, si el vendedor todavía quiere vender, **cotiza de
      nuevo**. **No se re-oferta sobre una solicitud terminal**: el mercado ya se movió y la oferta anterior
      era vinculante **solo mientras vivió**.

**P.2 — La mesa de decisión: qué compro, con el inventario a la vista (D6)**
> El punto de esta fase es simple: **el admin no debería decidir una compra sin saber cuánto de eso ya
> tiene**. Ocho copias en la caja y tres más en camino es una razón perfectamente buena para no comprar la
> novena — y hoy esa información **no está en la pantalla donde se decide**.
- [ ] **Por cada línea de la solicitud** (carta + acabado, §I) la mesa muestra, como mínimo:
      **(a)** qué pidió vender el cliente y **cuánto se cotizó**;
      **(b)** **cuántas piezas de esa misma carta tenemos en inventario**;
      **(c)** **cuántas vienen en camino** (piezas de otras solicitudes ya **`en_transito`**);
      **(d)** una **sugerencia legible de comprar / no comprar**.
- [ ] **"En camino" tiene una definición única** *(actualizado 2ª ronda, D20)*: son las piezas de solicitudes
      **`en_transito`**, es decir aquellas cuyo **envío confirmó el operador**. **No cuentan** ni una
      solicitud **`aceptada`**, ni una con **guía ya emitida**, ni una con **«ya lo mandé» del vendedor**
      (§P.13) — porque **ninguna de las tres es un paquete viajando**. Contar promesas como inventario es
      exactamente el error que esta pantalla existe para evitar.
- [ ] **La sugerencia NUNCA bloquea (D6)**: es una **recomendación**, no un permiso. El admin puede **comprar
      una línea que la sugerencia desaconseja** y **no comprar una que la sugerencia aconseja**, sin fricción
      adicional. **La decisión es del operador, línea por línea.**
- [ ] ~~**Qué dispara el «no comprar» (D15)** *(cierra la pregunta 9)*: la sugerencia se pone en «no comprar»
      cuando la **posición de esa variante** —**stock + en camino**— alcanza **cualquiera** de estos dos
      umbrales: **(a)** el objetivo del bounty, **(b)** un tope general de piezas por variante.~~
      **⚠ SUPERSEDED por D29 (3ª ronda)** — el texto se conserva como historial. Ver el bullet siguiente: la
      **posición** se cuenta más ancha y los dos umbrales dejan de ser un «o» para volverse una
      **precedencia**.
- [ ] **Qué dispara el «no comprar» — versión vigente (D15 + D29)** *(3ª ronda; cierra la pregunta 9 con el
      número que faltaba)*: la mesa pinta **«no comprar»** según esta **precedencia**, no según un «o»:
      **(a) Si la carta TIENE bounty (`bountyTargetQty`, §N.6): manda el bounty.** La sugerencia se pone en
      «no comprar» cuando la posición **alcanza el objetivo del bounty** — ya llegamos a las piezas que
      salimos a buscar, y seguir pagando precio de oferta por más es pagar de más. **El tope general NO
      aplica mientras haya bounty vivo**: salir a buscar una carta y frenarla a las 10 sería contradecirnos
      solos.
      **(b) Si la carta NO tiene bounty: manda el tope general de piezas por variante, default 10 (D29).**
      Es el techo de cuántas copias de una misma pieza queremos tener paradas.
- [ ] **Qué cuenta como «posición» para el tope (D29)** *(⚠ AMPLÍA lo que decía el bullet superseded, que
      hablaba de «stock + en camino»; se señala en vez de cambiarlo en silencio)*: la posición de una variante
      son **cuatro sumandos**, no dos — **stock** (piezas en inventario) **+ verificando** (recibidas, aún en
      verificación) **+ tránsito** (solicitudes `en_transito`) **+ comprometido** (líneas ya **ofertadas o
      aceptadas** que todavía no salieron). Razón: el tope existe para responder **«¿de cuántas copias ya soy
      responsable?»**, y una línea que ya oferté **es dinero comprometido** (D2: la oferta es vinculante),
      aunque todavía no sea un paquete viajando.
      **Esto NO cambia la cifra de «en camino» que se MUESTRA** (§P.2 (c) y criterio 116): esa sigue contando
      **solo `en_transito`**, porque responde a otra pregunta —**«¿qué viaja de verdad?»**— y ahí sí sería
      mentir contar promesas. **Dos preguntas, dos números, ambos a la vista.**
- [ ] **El tope y el bounty son diales, y la sugerencia sigue siendo solo una sugerencia**: al alcanzarlos
      **no se bloquea nada** (D6 intacta), la mesa simplemente **lo dice** y explica **por qué** (qué regla se
      disparó —bounty o tope general— y con qué cifras, desglosando los cuatro sumandos), para que el operador
      decida con el dato a la vista.
- [ ] **Cherry-pick AL OFERTAR**: el admin marca **línea por línea** qué compra y qué no. Lo que resulta de
      esa decisión **es la oferta**.
- [ ] **Quién puede emitir la oferta (D13)** *(cierra la pregunta 1 — corrige el supuesto de «solo
      súper-admin» del primer pase)*: ofertar **compromete un pago vinculante** (D2), así que se gobierna con
      la **misma mecánica de topes** que ya usa el buylist para el dinero:
      - el **súper-admin oferta sin tope**;
      - el **operador oferta hasta MX$1,500** *(D24, 3ª ronda — el número que faltaba; **descarta** el default
        money-safe de MX$0 que este documento había propuesto)*, **dial de M10**, medido sobre el **BRUTO** de
        la oferta —el valor comprometido, no el neto que sale por SPEI (D16)—;
      - **por encima del tope, la oferta NO sale sola**: queda **pendiente de autorización** y **el
        súper-admin la autoriza** (y con eso se emite). **El correo solo sale con la autorización.**
        *(Mecánica confirmada por D24: el humano dijo que arriba del tope la oferta **«requiere autorización
        del súper-admin»** —o sea **espera en cola**—, no que el operador tenga prohibido prepararla.)*
      **Quién preparó la oferta y quién la autorizó quedan registrados por separado** en la bitácora (M10).
      **El pago sigue siendo exclusivo del súper-admin**, sin tope ni delegación.
- [ ] **El monto de cada línea se deriva server-side** (SEC-A1) de la **curva de compra vigente** (§N.1)
      **al momento de ofertar** — no se toma del cliente ni se hereda ciegamente de la cotización.
- [ ] **Override manual al ofertar: SÍ, dentro del tope y con motivo (D26)** *(3ª ronda; cierra la pregunta
      22)*: sobre una línea concreta, **el operador puede fijar el monto a mano** —el **override de compra**
      de §N—, y la regla que lo gobierna es la misma que gobierna ofertar: **tiene que caber en su tope**
      (D24). Un override es, en los hechos, **ofertar un número a mano**, así que **no puede ser una puerta
      trasera al tope**: si el override empuja el **bruto** por encima de MX$1,500, la oferta **queda
      esperando la autorización del súper-admin** igual que cualquier otra. El **súper-admin lo aplica sin
      tope**.
      **Queda auditado con tres datos, no dos** (M10): **quién**, **cuánto** (monto derivado por la curva vs.
      monto fijado a mano) y **por qué** — el **motivo es obligatorio**: sin motivo, no hay override. Es lo
      que convierte un número a mano en una **decisión revisable** en vez de en una cifra huérfana.
- [ ] **El override es lo único que puede rescatar una línea en «precio pendiente»**: una carta sin dato de
      mercado (§N.2) **no se oferta con una cifra inventada**, pero **sí** puede ofertarse si alguien —dentro
      de su tope— **le pone precio a mano con motivo**. La otra salida sigue siendo **dejarla fuera de la
      oferta**.
- [ ] **Después del correo no hay override** (D2): el override vive **solo antes de emitir la oferta**. Una
      vez enviado el correo el monto **no se mueve** —ni al recibir, ni al verificar, ni por autorización
      posterior—. **D9 sigue intacta: no existe repreciar una línea.**
- [ ] **Money-safe — una línea sin dato de mercado no se oferta con un número inventado**: si la carta está
      en **«precio pendiente»** (§N.2), o **se le fija precio a mano** antes de ofertar —con el override de
      D26: dentro del tope, con motivo y auditado—, o esa línea **queda fuera de la oferta** (que es una
      opción legítima: el desglose le dirá al cliente que esa no se la compramos). **Nunca** se oferta
      **MX$0** ni una cifra de respaldo.
- [ ] **Las cifras que se muestran cuentan la carta correcta**: los conteos de (b) y (c) se hacen sobre la
      **identidad real de la pieza** — ver **§P.8 (producto separado)**. Un conteo que mezcla una promo con
      su versión del set base **es peor que no mostrar nada**, porque se ve confiable.

**P.3 — La oferta, el correo y la aceptación (D1, D2, D3; AMPLIADA en la 4ª ronda por D30 — la oferta es
condicional a NM línea por línea)**
- [ ] **Todo-o-nada (D1)**: el cliente **ve el desglose completo** —qué compramos, a cuánto, y **qué NO
      compramos**— pero **acepta o rechaza el paquete entero**. **No hay aceptación parcial**, no hay
      casillas por línea y **no hay contraoferta**. Razón: media compra deja al vendedor mandando un paquete
      por un monto que ya no es el que aceptó, y nos deja conciliando dos verdades distintas.
- [ ] **El correo de oferta lleva, como mínimo**: el **desglose línea por línea** (comprada / no comprada y su
      monto), **la condición NM declarada POR LÍNEA** (bullet siguiente, D30), **los TRES montos** (**bruto**,
      **envío** y **neto**) con **cuál se deposita** dicho explícitamente, la **fecha y hora límite para
      aceptar**, el **enlace para responder**, el recordatorio de la **política NM-only** (§H) y el **mensaje
      al vendedor de dos ideas** (§E): *solo compramos lo ofertado, a ese precio* y *el pago ocurre después de
      recibir y verificar*.
- [ ] **LA OFERTA ES CONDICIONAL Y ESO SE DECLARA AQUÍ, LÍNEA POR LÍNEA (D30 — 4ª ronda; supersede D27)**:
      el correo **no ofrece un paquete a secas**; ofrece un paquete **sujeto a una condición escrita**. Cada
      línea comprada dice, con todas sus letras, **«compramos esta carta a $X, siempre que llegue en Near
      Mint»**, y el correo dice **qué pasa con la que no cumpla**: **no se compra**, **no se paga** y **se te
      devuelve** según los plazos de §H (**7 días para gestionar la devolución, a tu costo**; **abandono a los
      30 días**). También dice lo que **NO** pasa: **no se reprecia** —no existe *«te ofrecí $400 pero te pago
      $250»*— y **no se cancela la compra de las demás**: **las que sí lleguen en NM se pagan al precio
      ofertado**, aunque otras se rechacen.
- [ ] **Por qué la condición va al FRENTE y no se re-pregunta al final (D30)**: el vendedor acepta **ese**
      trato —**con su riesgo incluido**— **antes de que compremos la etiqueta y antes de que empaque nada**.
      Cuando después se rechaza una carta por no ser NM, **el trato no cambió**: se **cumplió una condición
      que ya estaba escrita y aceptada**. Por eso **no hay nada que re-preguntar** y **no existe ninguna
      segunda confirmación** en el ciclo. Preguntar *«¿quieres continuar?»* después llegaría en el **peor
      momento posible** —etiqueta ya comprada, cartas ya en la bóveda—, donde **ninguna respuesta es buena**.
- [ ] **Es coherente con lo que este documento ya exigía**: la política **solo-NM** ya es requisito central y
      **visible en el cotizador, en la guía de envío y en los términos** (§H). Lo que D30 agrega no es una
      política nueva: es **hacerla explícita en el documento vinculante** —el correo de oferta— **y por
      línea**, que es donde el vendedor decide si acepta.
- [ ] **Los tres montos, sin letras chiquitas (D16)**: cuando la guía la ponemos nosotros, el correo dice
      **cuánto valen las cartas (bruto)**, **cuánto cuesta el envío que ponemos** y **cuánto se deposita
      (neto = bruto − envío)**. **La cifra que se anuncia como depósito es el NETO**, y es **la vinculante**.
      Un correo que anuncie **$1,480** y termine en un depósito de **$1,350** destruye exactamente la
      confianza que la oferta vinculante venía a construir — así que **la resta se enseña, no se esconde**.
      En la banda donde **el vendedor paga su propio envío** (§P.12), el correo lleva **un solo monto** y
      **dice que el envío corre por su cuenta**.
- [ ] **El correo anuncia la guía, pero la guía todavía no existe (D21)**: en la banda con envío a nuestro
      costo, el correo de oferta dice que **el envío corre por nuestra cuenta** y que **la guía le llega al
      aceptar**. **No se compra etiqueta al ofertar**: solo se gasta etiqueta en quien **ya dijo que sí**.
- [ ] **Precio vinculante desde que sale el correo (D2)**: a partir de ese instante el monto ofertado **no se
      mueve** — ni porque el mercado cambie, ni al recibir, ni al verificar. Es **nuestra palabra por
      escrito**. *(Precisión de la 2ª ronda, D16: **lo vinculante frente al vendedor es el NETO**, que es la
      cifra que él aceptó; el **bruto** es lo vinculante **hacia adentro** —es el costo de adquisición de la
      pieza y la base de los topes AML—. Las dos quedan congeladas al enviar el correo.)*
      *(⚠ **Precisión de la 4ª ronda, D30 — tensión señalada, no dejada latente**: «vinculante» significa que
      **ningún monto se mueve por decisión nuestra**. **No** significa que el depósito no pueda ser menor si
      **una carta no cumple la condición NM que el propio correo declara** (§P.5.1, criterios 134/150/161):
      ahí no baja **el precio**, baja **el número de líneas compradas**, y eso **el vendedor lo aceptó por
      escrito**. Lo que sigue prohibido sin excepción: **recalcular el envío, repreciar una línea, o descontar
      cualquier cosa que no estuviera en el correo**.)*
- [ ] **Una oferta enviada NO se edita** *(cerrado por el humano — respuesta a la pregunta 3)*: si el admin
      se equivocó, **cancela y emite una nueva** —el cliente recibe un correo nuevo, el plazo **vuelve a
      empezar** y todo queda **auditado** (M10)—. No hay "corregir un número" sobre una oferta que el
      vendedor ya tiene en su bandeja.
- [ ] **Aceptar o rechazar se hace en el portal del cliente, CON SESIÓN INICIADA** *(cerrado por el humano —
      respuesta a la pregunta 7)*: el correo **lleva** a esa pantalla, pero la respuesta **no se ejecuta
      desde un enlace anónimo** — aceptar compromete dinero de las dos partes, y un correo reenviado no puede
      convertirse en una aceptación válida. **No existe enlace tokenizado de aceptación** (a diferencia del
      seguimiento de invitado de §J, que solo **muestra**).
- [ ] **El monto no viaja en la respuesta del cliente** (SEC-A1): aceptar es **aceptar la oferta que está
      guardada**, no mandar un número. Un cliente que manipule la respuesta **no puede cambiar** lo ofertado.
- [ ] **Plazo de 2 días hábiles para aceptar (D3/D14)**: pasado el plazo **sin respuesta**, la solicitud queda
      **`rechazada`** y la oferta deja de ser válida. Se cuenta en **días hábiles** —una oferta enviada el
      **viernes no vence el domingo**—, es **dial de M10** (D8) y se comunica **en el correo y en la
      pantalla** con **fecha y hora explícitas** (no "en 2 días").
- [ ] **Un recordatorio, uno POR PLAZO (D23)** *(cierra la pregunta 6; alcance cerrado en la 3ª ronda —
      respuesta a la pregunta 21, supuesto confirmado)*: a **un día hábil** de vencer, al vendedor le llega
      **un** correo recordándole que su plazo está por caducar. **Se manda una sola vez por plazo**: el
      barrido corre varias veces y **no puede** volver a mandarlo en cada corrida.
      **Hay dos plazos** —**aceptar** y **enviar**—, así que en un ciclo puede haber **hasta dos
      recordatorios**, **cada uno una sola vez**. No es *«un recordatorio en todo el ciclo»*: quien ya aceptó
      y está por perder la venta porque el paquete no sale **también merece el aviso**.
      Los **correos obligatorios del ciclo son tres**: **oferta**, **recordatorio** y
      **expiración/cancelación**.

**P.4 — La guía la mandamos nosotros (D16, D18b, D19, D20, D21, D22 — REESCRITA en la 2ª ronda; supersede D5)**
> **Qué cambió respecto al primer pase**: el borrador decía que **el cliente capturaba la guía** y que
> **él pagaba el envío** (D5 + supuesto de la pregunta 5). El humano decidió lo contrario: **arriba del
> umbral, la guía la ponemos nosotros y se descuenta del pago**. Con eso **D5 queda sin efecto** —el
> vendedor ya no captura nada— y el envío deja de ser un costo invisible del vendedor para volverse
> **una línea de nuestro dinero**.
- [ ] **Arriba de MX$1,000, el envío corre por nuestra cuenta (D16/D18b)**: compramos la guía, se la mandamos
      al vendedor y **su costo se descuenta del pago** (`bruto − envío = neto`, §H). De **$500 a $1,000**,
      **el vendedor paga su envío como hoy** y **no hay descuento** (§P.12).
- [ ] **La guía se compra AL ACEPTAR, no al ofertar (D21)**: **solo se gasta etiqueta en quien ya dijo que
      sí**. Ofertar a diez personas y comprar diez guías por adelantado sería tirar el dinero de las que
      digan que no. El correo de oferta solo **anuncia** que el envío va por nuestra cuenta.
- [ ] **La tensión D16×D21 está RESUELTA: tarifa fija de MX$180, congelada al ofertar (D25)** *(3ª ronda;
      cierra la pregunta 20)*: **D16** pide que el **correo de oferta muestre el envío y el neto**, pero
      **D21** compra la etiqueta **después** de mandar ese correo — al ofertar **todavía no sabemos cuánto
      costó**. La salida decidida es la única que preserva lo que D16 vino a construir: **se descuenta una
      tarifa de envío conocida de antemano —MX$180— y esa cifra se CONGELA en el momento de enviar la
      oferta**.
      - Si la etiqueta real sale **más cara**, **absorbemos la diferencia** (gasto operativo).
      - Si sale **más barata**, **la diferencia es margen nuestro**.
      - **En ningún caso se recalcula el descuento después de mandar la oferta.** Si el descuento pudiera
        moverse tras la aceptación, **el neto dejaría de ser vinculante** y volveríamos exacto al problema del
        **«$1,480 que llegan como $1,350»**.
      **Es un dial de M10** (D8), editable sin redeploy y auditado; **cambiarlo no toca las ofertas ya
      enviadas** —cada una lleva su tarifa congelada— (P18, §P.10).
- [ ] **MX$180 (buylist) y MX$175 (retiro) son DOS diales distintos**: se parecen y **no son el mismo
      número**. La **tarifa de envío de retiro** (§D, M10) es lo que **le cobramos al comprador** por
      mandarle su carta; la **tarifa de envío del buylist** es lo que **nos descontamos** por traer la del
      vendedor. **Mover uno no mueve el otro**, y unificarlos «porque se parecen» rompería dos flujos a la
      vez.
- [ ] **La guía se genera A MANO y fuera del sistema (D19)**: el operador la compra con la paquetería que
      use y **captura el número** en la solicitud. **No hay integración con paquetería** —ni compra
      automática, ni cotización, ni rastreo en vivo, ni validación del número contra el transportista— y
      **eso es proyecto aparte, fuera de este alcance**. **El sistema solo guarda y muestra**: el número
      queda visible para el vendedor (para que pueda usarlo) y para el operador (para **conciliar** al
      recibir).
- [ ] **Quién marca «en tránsito»: el operador (D20)**: la solicitud pasa a **`en_transito`** cuando **el
      operador confirma el envío**. Ni la compra de la guía ni el aviso del vendedor mueven ese estado por sí
      solos. *(Ver §P.13: por eso el **reloj** y el **estado** se separan — el vendedor tiene un **«ya lo
      mandé»** que **detiene su plazo** sin mover el estado, para que **nadie pierda su venta por una demora
      nuestra**.)*
- [ ] **Plazo de 3 días hábiles para que el paquete salga (D4/D14/D21)**, contados **desde que la guía llega
      al vendedor** —no desde que aceptó—: sería injusto correrle el reloj mientras espera una etiqueta que
      depende de nosotros. En la banda donde **él paga su envío**, el plazo corre **desde la aceptación**.
      Sin envío en el plazo, la oferta **`expira`**, la solicitud **se cancela** y **se le notifica al
      vendedor** por correo. El plazo es **dial de M10** (D8) y se comunica con **fecha y hora explícitas**.
- [ ] **Guía emitida que no se usó: hay que cancelarla (D22)**: la etiqueta que compramos debe ser
      **cancelable o reembolsable** —es un **requisito para elegir con qué paquetería trabajamos**, no un
      detalle operativo—, y cuando una solicitud **con guía emitida** vence o se cancela, el sistema **deja
      la tarea «cancelar guía no usada» en la cola del operador**, con el número a la vista. Una etiqueta
      comprada y olvidada es **dinero tirado que nadie ve**.
- [ ] **Aceptar no pone nada en camino.** Para el negocio —y para los conteos de la mesa de decisión
      (§P.2)—, **una carta solo «viene en camino» cuando la solicitud está `en_transito`**. Ni una solicitud
      **`aceptada`**, ni una con **guía emitida**, ni una con **«ya lo mandé»** del vendedor cuentan como
      inventario en camino: **contar promesas como stock** es exactamente el error que esta pantalla existe
      para evitar.

**P.5 — Recepción y verificación: dos desenlaces, no tres (D9)**
- [ ] **Recibir concilia contra la guía**: el operador ve **qué debía llegar** (las líneas **ofertadas**) y
      marca **qué llegó**. Una línea ofertada que **no llega** simplemente **no se paga**.
- [ ] **Verificar sigue siendo carta por carta y sigue siendo NM** (§H). Lo que cambia es que ya **no hay un
      tercer camino**: los desenlaces son exactamente **dos**:
      - **Llega en NM** ⇒ **aprobada** y **se paga lo ofertado** (D2/D9).
      - **No llega en NM** ⇒ **rechazada**: no se paga y se devuelve según los plazos de §H (**7 días a costo
        del usuario**, **abandono a 30 días**).
- [ ] **Desaparece el repreciado al recibir**: no existe "te ofrecí $400 pero te pago $250". Si la carta no
      cumple, **se rechaza**; si cumple, **se paga lo pactado**. Esto es lo que hace que el precio de la
      oferta pueda ser la **fuente única del costo de adquisición**.
- [ ] **Piezas que llegan sin haber sido compradas**: si el vendedor mete en el paquete algo que **no
      ofertamos**, **no está comprado**. Se registra y aplican los plazos de devolución de §H.
- [ ] **Si se rechaza TODO, el envío lo absorbemos nosotros (D17)**: cuando ninguna carta pasa la
      verificación, el vendedor **no cobra nada** y **tampoco debe nada**. **No se le cobra el envío**, **no
      queda saldo negativo**, no se le retiene ni se le descuenta de una operación futura. Pusimos la guía
      apostando a que la mercancía era NM; **esa apuesta es nuestra**. *(El costo de esa guía es **gasto
      operativo** y se registra como tal, §H.)*

**P.5.1 — Rechazo PARCIAL: se paga lo aprobado, sin preguntar nada (D30 — 4ª ronda; CORRIGE D27/D28, que
quedan SUPERADAS; cierra la pregunta 16)**
> **El hueco que cerraba**: D17 resolvió el **rechazo total** (lo absorbemos) y D9 resolvió la **línea
> individual** (NM se paga, no-NM se rechaza). Faltaba el caso de en medio: **rechazamos algunas y aprobamos
> otras**.
> **Cómo se cierra de verdad (D30)**: **no con una pregunta al final, sino con una condición al frente**. El
> paquete que el vendedor aceptó **ya venía condicionado a NM línea por línea** (§P.3, D30): *«compramos
> estas N a estos precios, siempre que lleguen en Near Mint; la que no llegue en NM no se compra y se te
> devuelve»*. Cuando al verificar se rechaza una carta, **el paquete no cambió de trato**: **se cumplió una
> condición que ya estaba escrita y aceptada**. Por eso el rechazo parcial **no abre ningún flujo nuevo**.
>
> **⚠ SUPERSEDED — lo que decía la 3ª ronda (D27/D28) y por qué se retiró.** *(Se conserva como historial;
> no es requisito.)* ~~Decía que si el bruto aprobado caía **más de 20%** se le **preguntaba al vendedor si
> quería continuar** antes de pagar, **reusando el flujo de ajuste** (ítem `ajustada` + plazo +
> aceptar/rechazar), y que si decía que no corría la devolución de §H con **el envío de ida absorbido por
> nosotros**.~~
> **Razón del retiro (el humano, 4ª ronda)**: esa pregunta **llegaba en el peor momento posible** — **ya
> compramos la etiqueta y ya tenemos sus cartas en la bóveda**. **Ninguna respuesta era buena**: si decía
> que **no**, había que **devolver todo y comernos el envío de ida**; si **no contestaba**, quedaban
> **cartas ajenas atoradas sin regla clara**. Además **obligaba a inventar un plazo nuevo** —exactamente la
> **pregunta abierta 23**, que con esto queda **cerrada por eliminación**—. Y era **redundante**: le montaba
> **una segunda confirmación encima a un trato que ya era condicional**, cuando la política **solo-NM** ya
> es requisito central y visible en el **cotizador**, la **guía de envío** y los **términos** (§H).
- [ ] **Regla vigente — se rechaza carta por carta y se paga lo aprobado, al precio ofertado (D30)**: cuando
      al verificar **algunas** cartas no llegan en NM, cada una se **rechaza individualmente** con el **correo
      de rechazo por carta que YA EXISTE** —sin mecanismo nuevo—, y **lo aprobado se paga al precio
      ofertado**. **No hay pregunta, no hay estado nuevo, no hay plazo nuevo, no hay segunda confirmación.**
- [ ] **Las rechazadas siguen la regla de devolución VIGENTE de §H, sin excepción**: **7 días** para
      gestionar la devolución **a costo del vendedor** y **abandono a los 30 días**; una carta **no-NM
      abandonada NO entra al inventario vendible**. Es **la misma regla de siempre**, aplicada al mismo
      supuesto de siempre (**carta rechazada por no ser NM**) — no una regla especial del rechazo parcial.
- [ ] **Ningún monto se mueve, ni hacia arriba ni hacia abajo (D9 intacta)**: las cartas aprobadas se pagan
      **exactamente al bruto que decía su línea en la oferta**. Rechazar una carta **no reprecia** a las
      otras, **no cancela** la compra de las otras y **no reabre** ninguna negociación.
- [ ] **Sigue siendo TODO-O-NADA en el único punto donde eso significa algo: al ACEPTAR (D1 intacta)**: el
      vendedor dijo sí o no **al paquete completo con su condición**, **antes** de mandar nada. Después de
      eso **no elige líneas** —nunca hubo aceptación parcial y sigue sin haberla—, y **tampoco se le pide que
      vuelva a elegir**.
- [ ] **Qué se le comunica, entonces**: los **correos de rechazo por carta** (los que ya existen) y el
      **comprobante del pago** con el desglose de **qué se aprobó, a cuánto, qué se rechazó y por qué**. Los
      **correos obligatorios del ciclo siguen siendo TRES** —oferta, recordatorio, expiración— *(la 3ª ronda
      llegó a proponer un cuarto; con D30 **no existe**)*.
- [ ] **La contradicción con D9 quedó DISUELTA, no acotada (D30)** *(⚠ corrige lo que decía la 3ª ronda)*:
      ~~D27 introducía un «ajuste de ALCANCE» que obligaba a **acotar** el criterio 124 (que decía que en
      verificación *«no existe ajustar»*).~~ Sin re-confirmación, **el ciclo de buylist no usa el ítem
      `ajustada` en NINGÚN punto** y el criterio **124 vuelve a ser cierto sin acotación**: en la pantalla de
      verificación **no existe** campo de monto, **ni** repreciar, **ni** contraofertar, **ni** ajustar.
      **La verificación tiene dos desenlaces por carta (NM / no-NM) y la solicitud no gana ningún tercer
      camino.**
- [ ] **Cómo se paga un rechazo parcial (sin cambio en el dinero respecto a la 3ª ronda)**: se deposita el
      **neto de lo aprobado** — **`max( 0 , bruto aprobado − envío )`** — y el ciclo **continúa normal**
      (§P.6): conversión a inventario de las aprobadas, con **costo = su bruto ofertado**. Lo único que
      desapareció es **la espera y la pregunta**: el SPEI **ya no queda detenido** por una respuesta que
      nunca debió pedirse.
- [ ] **Las dos protecciones al vendedor NO se tocan (D30 las deja intactas a propósito)**:
      **(a)** **el NETO nunca es negativo** —piso de cero, criterio **152**, bullet de abajo—; y
      **(b)** **si se rechaza TODO, absorbemos el envío entero** —**D17**, §P.5, criterio **140**—: el
      vendedor **cobra $0 y no debe nada**.
      **Ninguna de las dos depende de que se le pregunte algo**, así que retirar la pregunta **no le quita
      ninguna protección**.
- [ ] **INVARIANTE MONEY-SAFE — el NETO nunca puede ser negativo**: si el **bruto aprobado queda por debajo
      de la tarifa de envío** (ofertamos $1,480, aprobamos $100, envío $180 ⇒ −$80), el neto **se topa en
      cero** y **la diferencia la absorbemos**. **Jamás se le cobra al vendedor por habernos mandado cartas**:
      no hay cargo, no hay saldo negativo, no hay retención contra operaciones futuras. **El peor caso posible
      para un vendedor es cobrar $0 — nunca deber.** Criterio **152**.
- [ ] **⚠ La validación entre diales, REFORMULADA (D30 — el efecto colateral de retirar D28)**: ~~la 3ª ronda
      decía que «cuando el piso de cero se activa, ya le preguntamos», y protegía esa propiedad exigiendo que
      la **tarifa de envío** no superara `umbral de guía × (1 − umbral de pregunta)` —hoy
      `$1,000 × 80% = $800`—.~~ **Al desaparecer el umbral de pregunta, esa fórmula se quedó sin base**: cita
      un dial que **ya no existe**, y la propiedad que protegía **ya no es la relevante** —el vendedor **no
      necesita que se le pregunte**, porque **aceptó la condición NM por línea antes de mandar nada** (§P.3).
      **La relación que SÍ sigue siendo cierta entre los diales que quedan** es más simple: **la tarifa de
      envío debe ser ESTRICTAMENTE MENOR que el umbral de guía** —hoy **MX$180 < MX$1,000**—. Razón de
      negocio: el umbral de guía es **inclusivo** (§P.12), así que **la oferta más chica que puede llevar
      envío a nuestro costo vale exactamente el umbral**; si la tarifa lo igualara o lo superara, **una
      operación con TODO aprobado depositaría MX$0**, y le estaríamos ofreciendo a alguien un trato que **no
      le paga nada aunque cumpla perfecto**. Eso no es un piso de seguridad: es **una oferta rota**.
      *(**SUPUESTO**: elijo **estrictamente menor, sin colchón adicional** —el mínimo defendible—. Si el
      humano prefiere un margen (p. ej. que la tarifa no pase de la mitad del umbral), ese número lo fija él;
      ver **pregunta abierta 24**, no bloqueante.)*
      **Sigue siendo una validación BLOQUEANTE de la pantalla de diales (M10), no una nota al pie** —
      criterio **127**.

**P.6 — Pago y conversión a inventario (actualizado 2ª ronda por D16; CORREGIDO en la 4ª por D30)**
- [ ] **Se paga por SPEI el NETO de lo aprobado** —`max( 0 , bruto aprobado − envío )`— y **solo lo ejecuta
      el súper-admin** (regla de oro de §F, sin cambio). **El neto NUNCA es negativo** (D17 + invariante de
      §P.5.1): se **topa en cero** y **la diferencia la absorbemos**.
- [ ] **⚠ El pago NO espera ninguna confirmación del vendedor (D30 — corrige D27/D28)**: ~~la 3ª ronda decía
      que con una caída de **más de 20%** del bruto **no se ejecutaba el SPEI** hasta que el vendedor
      confirmara que quería continuar.~~ **SUPERADO**: la oferta **ya era condicional a NM línea por línea**
      y el vendedor **ya aceptó ese trato antes de mandar nada** (§P.3, D30). Un **rechazo parcial NO detiene
      el pago**: se paga **lo aprobado**, **con cualquier tamaño de recorte**, en cuanto termina la
      verificación (§P.5.1). **No hay umbral, no hay espera, no hay pregunta.**
- [ ] **Los topes/KYC/INE se juzgan sobre el BRUTO** (§E, D16): el valor comprometido con el vendedor es lo
      que importa para AML, aunque **lo que sale por SPEI sea el neto**. Descontar el envío **no baja** una
      operación por debajo del umbral de INE.
- [ ] **Dos medidas del dinero del buylist que conviven, y no se mezclan** *(3ª ronda; cierra la pregunta
      14)*: el **tope de compromiso** —por solicitud y **el mensual**— se mide en **BRUTOS**, porque es el
      **valor comprometido** y es la **misma base que los topes AML/INE**; el **acumulado de dinero pagado**
      se mide en **NETOS**, porque es **lo que de verdad salió por SPEI**. **Son dos preguntas distintas** —
      *«¿cuánto me comprometí con esta persona?»* y *«¿cuánto dinero salió?»*— y **ambas tienen que existir**:
      si el tope mensual sumara netos, un envío caro **iría bajando el acumulado** y un usuario podría pasar
      el tope **sin que se note**; y si el acumulado de caja sumara brutos, **M7 reportaría una salida de
      dinero que nunca ocurrió**.
- [ ] **La conversión a inventario usa el BRUTO como costo**: origen **`client_purchase`** y **costo = el
      bruto ofertado de esa línea** (§G/M1), que es **lo que valió la carta**. **El envío NO entra al costo
      de la pieza**: es **gasto operativo** del periodo (§H, M7). Mezclarlos ensuciaría el **P&L por carta**
      —dos piezas idénticas tendrían costos distintos según el paquete en que llegaron— y volvería inútil el
      margen por pieza que M7 existe para mostrar.

**P.7 — Publicar: cerrar el ciclo (D10)**
> Comprar bien y dejar la carta en una caja sin precio es comprar mal. Esta fase existe para que **ninguna
> pieza adquirida se quede invisible**.
- [ ] **Una pieza recién convertida NO está a la venta**: le faltan **dos cosas concretas** — **ubicación
      física** (CAJA/FILA/SLOT, M1) y **precio de venta**.
- [ ] **Cola de "pendientes de publicar"** (M1): toda pieza a la que le falte una de las dos aparece en una
      **cola de trabajo que dice qué le falta**, y **sale sola** cuando ya no le falta nada. La cola es
      **visible en el dashboard** como parte de la cola de trabajo del back-office.
- [ ] **Auto-publicación**: **ubicación + precio ⇒ publicada** en Compra, sin depender de que alguien se
      acuerde de apretar un botón. Se respeta la **Regla de Compra** (§A): lo que está en **«precio
      pendiente»** **no se publica** y el comprador **nunca** ve ese estado.
- [ ] **El precio de venta NO se decide aquí (D10)**: lo fija la **curva por valor de mercado** (§N.1) con su
      precedencia money-safe. **Este ciclo no captura precios de venta a mano** ni "hereda" el precio de
      compra como precio de venta. Si no hay dato de mercado, la pieza queda en **«precio pendiente»** y se
      escala al dueño (§N.2) — **es un pendiente visible, no una carta perdida**.
- [ ] **La ubicación NO se exige al convertir** *(cerrado por el humano — respuesta a la pregunta 12)*: se
      **ofrece** en el mismo paso de conversión para no obligar a un segundo viaje al sistema, pero **no es
      obligatoria ahí**. **Bloquear la conversión por falta de ubicación atoraría el flujo de pago**, y el
      pago al vendedor no puede depender de que ya sepamos en qué caja va la carta. A cambio, **la pieza sin
      ubicación sale SEÑALADA** en la cola de pendientes de publicar: se ve de un golpe cuáles están
      esperando **ubicación** y cuáles esperan **precio**.

**P.8 — Producto separado: que las cifras no mientan (D7)**
> **El hueco**: hoy las **promos** y los **exclusivos de deck** entran a inventario **indistinguibles de la
> versión del set base**. Eso rompe **dos cosas a la vez**: **(a)** los conteos de la mesa de decisión (§P.2)
> —"tengo 8" cuando en realidad tengo 5 de una y 3 de otra que valen distinto—, y **(b)** la publicación y la
> valuación, porque se prician como si fueran la misma pieza.
- [ ] **Cada pieza queda ligada a la impresión exacta que es**: una **promo** y un **exclusivo de deck** son
      **producto separado** de la versión del set base — en el **cotizador**, en el **inventario**, en los
      **conteos** de la mesa de decisión y en la **publicación**.
- [ ] **Sin esto, D6 no se sostiene**: una sugerencia de compra basada en un conteo que mezcla identidades
      **es peor que no dar sugerencia**, porque el operador la creería.
- [ ] **No se re-llavea nada** *(coherente con §L, que sigue vigente)*: la identidad sale del **catálogo ya
      sincronizado** —la pieza real que el vendedor eligió— y **no** se fusionan ni se inventan set-ids.
- [ ] **Lo ya capturado se corrige A MANO (cerrado por el humano — respuesta a la pregunta 11; el supuesto
      era correcto)**: las filas de inventario que hoy están capturadas **sin el eje de producto separado** se
      **reclasifican manualmente desde M1**. **No hay migración automática**, y la razón es de negocio:
      **ninguna migración puede adivinar** si aquella pieza era la promo o la del set base, y una migración
      que adivina **produce cifras que se ven confiables y no lo son** — que es exactamente el daño que §P.8
      existe para evitar. Es trabajo de captura, no de software.

**P.9 — Poder llamar al vendedor: celular obligatorio y cotizaciones vivas (D11, D12)**
- [ ] **Celular obligatorio en TRES puntos (D11)**:
      **(1)** al **registrarse**;
      **(2)** en el **alta de usuario que hace el admin** desde el back-office (M6);
      **(3)** **antes de crear una solicitud de venta** — este tercero es el que **cubre los huecos reales**:
      quien entró con **Google** y las **cuentas viejas** con el campo vacío. Sin celular, **no hay
      solicitud**.
- [ ] **Cotizaciones abiertas a la vista (D12)**: el back-office puede ver **qué usuarios tienen solicitudes
      de venta vivas**, **cuántas** tiene cada uno, y **llamarlos** — el **teléfono viaja en la cola de
      buylist**, no hay que ir a buscarlo a la ficha del usuario.
- [ ] **Qué cuenta como «solicitud viva»** *(cerrado por el humano — respuesta a la pregunta 10)*: **todo lo
      que NO sea terminal**. Los **terminales son cuatro**: **`pagada`**, **`rechazada`**, **`abandonada`** y
      **`expirada`**. Se define **por exclusión a propósito**: así, cualquier estado que se agregue después
      al ciclo **entra a la vista solo**, sin que haya que acordarse de actualizar una lista.
- [ ] **El teléfono es dato de back-office**: **nunca** se muestra en superficie pública ni en la vista de
      seguimiento de un pedido (coherente con §J, que ya lo prohíbe explícitamente).

**P.10 — Diales del ciclo (D8; ampliado en la 2ª ronda, COMPLETADO en la 3ª, CORREGIDO en la 4ª — origen
único de los números)**
> **Esta tabla es el origen único de los OCHO diales del ciclo.** El resto del documento —§E, §H, M5, M10,
> los criterios— **los cita, no los vuelve a enumerar**: las copias en prosa son las que se desincronizan,
> porque ningún test las mira. Tras la 3ª ronda **ninguno queda sin número**.
> **⚠ Corrección de la 4ª ronda (D30)**: eran **nueve**; el **«umbral de recorte material» (20%, D28)** queda
> **SIN OBJETO** —al no haber pregunta al vendedor, **no hay umbral que calibrar**— y **se retira de la
> tabla**. **Quedan OCHO.** El dial no se «apaga» ni queda en 0: **deja de existir**.
- [ ] Los **dos plazos** son **diales editables desde M10**, **sin redeploy** y **auditados**: **plazo para
      aceptar** (default **2 días hábiles**) y **plazo para que el paquete salga** (default **3 días
      hábiles**). **No son constantes en código.**
- [ ] **Los diales se CONGELAN por solicitud** *(3ª ronda; cierra la pregunta 18 — supuesto confirmado y
      reforzado)*: **se respetan las fechas ya comunicadas**. Cada plazo **se congela en el momento en que se
      fija** para esa solicitud —cuando sale el correo de oferta, cuando se entrega la guía— y **cambiar el
      dial después solo afecta a las solicitudes NUEVAS**. No se acorta ni se alarga una fecha que ya está en
      la bandeja de alguien. Lo mismo aplica a la **tarifa de envío** (D25): la oferta lleva **la suya**,
      congelada. Vencerle una oferta a alguien **antes de la fecha que le escribimos** sería romper la palabra
      que la oferta vinculante venía a dar.
- [ ] **OCHO diales del ciclo** *(3ª ronda: ya todos con número; **4ª ronda: eran nueve — D28 quedó sin
      objeto y se retiró**)*, todos en M10, sin redeploy y auditados — tabla abajo.
- [ ] **Los dos umbrales de monto son independientes**: el **mínimo de compra** y el **umbral de guía**
      responden a preguntas distintas —*«¿vale la pena esta operación?»* y *«¿a partir de cuánto pago yo el
      envío?»*— y **mover uno no mueve el otro** (D18b).
- [ ] **Una validación entre diales, no solo diales sueltos — REFORMULADA en la 4ª ronda** (§P.5.1,
      criterio 127): ~~la **tarifa de envío** no puede superar `umbral de guía × (1 − umbral de pregunta)`
      —hoy **$1,000 × 80% = $800**—; si lo hiciera, el **piso de cero** podría activarse **sin haberle
      preguntado al vendedor**.~~ **Esa fórmula citaba un dial que dejó de existir** (D28) y se retira.
      **Regla vigente**: la **tarifa de envío del buylist** debe ser **estrictamente menor que el umbral de
      guía** —hoy **MX$180 < MX$1,000**—, porque el umbral es **inclusivo** y **la oferta más chica con envío
      a nuestro costo vale exactamente el umbral**: si la tarifa lo igualara, **una operación con todo
      aprobado depositaría MX$0**. M10 debe **impedir** esa combinación, **no solo advertirla**.
      *(**SUPUESTO**: sin colchón adicional — ver pregunta abierta **24**.)*

| Dial del ciclo | Default | Qué gobierna |
|---|---|---|
| **Plazo para aceptar la oferta** (D3/D14) | **2 días hábiles** | Sin respuesta ⇒ **`rechazada`** (§P.3). Se **congela** al enviar la oferta |
| **Plazo para que el paquete salga** (D4/D14/D21) | **3 días hábiles** | Sin envío ⇒ **`expirada`** (§P.4). Se **congela** al entregar la guía |
| **Mínimo de compra** (D18) | **MX$500** *(inclusivo)* | Por debajo, **no se crea la solicitud** (§P.12) |
| **Umbral de guía a nuestro costo** (D18b) | **MX$1,000** *(inclusivo)* | De ahí en adelante, **la guía la ponemos nosotros** (§P.4). **Dial separado del mínimo** |
| **Tope de oferta del operador** (D13/**D24**) | **MX$1,500** | Bruto por encima del cual la oferta **la autoriza el súper-admin** (§P.2). Incluye los **overrides** (D26) |
| **Tope general de piezas por variante** (D15/**D29**) | **10 piezas** | Dispara **«no comprar»** en cartas **sin bounty**; **nunca bloquea** (§P.2) |
| **Tarifa de envío del buylist** (D16/**D25**) | **MX$180** | El **envío que se descuenta** y que el correo de oferta anuncia; se **congela** al ofertar (§P.4). **Distinta** del envío de retiro (MX$175) |
| **Alerta de «ya lo mandé» sin confirmar** (**P17**) | **5 días hábiles** | Pasado ese tiempo, la solicitud se **destaca como alerta** en la cola de «por confirmar envío» (§P.13). **No expira nada** |
| ~~**Umbral de «recorte material»** (**D28**)~~ | ~~**20%** del bruto~~ | **⚠ RETIRADO en la 4ª ronda (D30): dial SIN OBJETO.** Gobernaba la pregunta *«¿continúas?»* del rechazo parcial; **al no haber pregunta, no hay umbral que calibrar** (§P.5.1). **No se implementa** |

**P.11 — Flujos críticos (base para el E2E de QA)**
> **Camino feliz — el ciclo completo, de cotizar a estar a la venta** *(actualizado 2ª ronda: el envío lo
> ponemos nosotros)*:
> 1. Un usuario con **celular en su cuenta** cotiza 3 cartas por **más de MX$1,000** y crea la solicitud →
>    queda **`cotizada`** y la pantalla le dice **que todavía no mande nada**.
> 2. El súper-admin (**o el operador, si el bruto cabe en su tope**) abre la **mesa de decisión** y ve, por
>    cada carta, **cuántas tiene** y **cuántas vienen en camino**, más la **sugerencia**. **Compra 2 líneas y
>    descarta 1.**
> 3. Manda la oferta → la solicitud queda **`ofertada`** y **sale el correo** con el **desglose (2 compradas,
>    1 no)**, los **tres montos (bruto, envío, neto)**, **cuál se deposita**, el aviso de que **la guía va por
>    nuestra cuenta** y la **fecha y hora límite**.
> 4. El cliente entra a su portal **con sesión** y **acepta el paquete completo** → **`aceptada`**. **Nada
>    está en camino todavía** (el conteo de "en camino" del admin **no se mueve**).
> 5. El operador **compra la guía a mano**, **captura el número** y **se la manda al vendedor**; ahí arranca
>    el plazo de **3 días hábiles** para que el paquete salga.
> 6. El vendedor deposita el paquete y aprieta **«ya lo mandé»** → **su reloj se detiene**, pero **el estado
>    no cambia**. El operador **confirma el envío** → **`en_transito`**, y **ahora sí** el conteo de "en
>    camino" de esa carta **sube** en la mesa de decisión de otras solicitudes.
> 7. Llega el paquete: el operador **concilia contra la guía**, marca **`recibida`** y **verifica**: las 2
>    cartas están **NM** → **`aprobada`** **al precio ofertado** (nadie repreció nada).
> 8. El súper-admin **paga por SPEI el NETO** → **`pagada`** y las piezas se **convierten a inventario** con
>    origen `client_purchase` y **costo = el BRUTO ofertado** (el envío se registra como **gasto operativo**,
>    no como costo de la carta).
> 9. Las piezas caen a la **cola de pendientes de publicar**; el operador les **captura ubicación**, la curva
>    de §N les **fija precio** y **se publican solas** en Compra. **Fin del ciclo.**
>
> **Flujo crítico — nadie manda cartas sin un sí:** una solicitud recién creada **no ofrece** ninguna forma de
> marcarse en tránsito ni de avisar «ya lo mandé»; la pantalla del cliente **no muestra** guía, dirección ni
> instrucciones de envío hasta que **hay oferta aceptada**.
>
> **Flujo crítico — el precio ofertado es el que se paga, y los tres montos cuadran:** entre la oferta y la
> recepción **el mercado se mueve** (arriba y abajo) y aun así **se deposita exactamente el NETO ofertado** y
> el **costo del inventario es exactamente el BRUTO ofertado**. Verificable comparando el correo de oferta
> contra el SPEI, contra el costo del item y contra el **P&L de M7** —donde el **envío aparece como gasto**,
> **no** dentro del costo de la carta.
>
> **Flujo crítico — la sugerencia no manda:** con una carta de la que ya tenemos varias copias y varias más en
> camino, la mesa sugiere **no comprar** y el admin **la compra igual, sin bloqueo**; y con una sugerencia de
> **comprar**, el admin **la descarta igual**. En ambos casos la oferta sale como el admin decidió.
>
> **Flujo crítico — nadie pierde su venta por una demora nuestra (§P.13):** el vendedor deposita el paquete
> **el último día del plazo** y aprieta **«ya lo mandé»**; el operador **no lo confirma hasta el día
> siguiente**. El barrido **NO expira** la solicitud, y al confirmarse queda **`en_transito`** normalmente.
>
> **Flujo crítico — las tres bandas de monto y sus bordes (D18/D18b, bordes de la 3ª ronda):** una solicitud
> de **MX$300** **no se crea** y el cotizador dice **cuánto falta**; una de **MX$700** se crea y **el vendedor
> paga su envío** (correo con **un solo monto**); una de **MX$1,500** se crea y **la guía la ponemos
> nosotros** (correo con **bruto MX$1,500, envío MX$180 y neto MX$1,320**). **Los dos bordes, explícitos:**
> **exactamente MX$500 SÍ se crea** y **exactamente MX$1,000 SÍ lleva guía nuestra**.
>
> **Flujo crítico — la oferta se acepta CON la condición NM escrita, línea por línea (D30):** el correo de
> oferta de las 2 cartas compradas dice, **en cada línea**, **«siempre que llegue en Near Mint»**, y dice
> **qué pasa si no llega**: **no se compra, no se paga y se devuelve** (7 días a su costo, abandono a 30).
> Verificable leyendo el correo **antes** de que exista guía: la condición está **en el documento que él
> acepta**, no en un aviso posterior.
>
> **Flujo crítico — rechazo parcial: se paga lo aprobado, sin preguntar nada (D30 — sustituye al flujo de
> D27/D28):** de una oferta de **MX$1,480** se aprueba solo **MX$900** (caída del **39%**) ⇒ **se paga**:
> se depositan **MX$720** (`900 − 180`), **sin ninguna pregunta al vendedor, sin estado `ajustada` y sin
> plazo nuevo**. Las cartas rechazadas salen con el **correo de rechazo por carta que ya existe** y corren
> los **7/30 días** de §H **a su costo**. Contraste obligatorio, para probar que **el tamaño del recorte es
> irrelevante**: de la misma oferta se aprueba **MX$1,300** (caída del **12%**) ⇒ **exactamente el mismo
> tratamiento**, se depositan **MX$1,120**. **No existe ningún umbral** que cambie el comportamiento.
>
> **Flujo crítico — el neto nunca es negativo:** de una oferta de **MX$1,480** se aprueba solo **MX$100** con
> **MX$180** de envío ⇒ el neto **se topa en MX$0** (no −$80), **no se genera ningún cargo** contra él, **no
> queda saldo negativo** y **la diferencia la absorbemos**. *(4ª ronda: esto ocurre **directamente al
> verificar** — ya no «tras la confirmación del vendedor», porque esa confirmación no existe.)*
>
> **Flujos negativos que QA debe cubrir:** cliente **no responde en 2 días hábiles** → la solicitud queda
> **`rechazada`** y aceptar después **ya no funciona**; **oferta enviada el viernes** → **no vence en fin de
> semana** (D14); **recordatorio** → llega **una sola vez** aunque el barrido corra varias veces (D23);
> cliente **acepta y el paquete no sale en 3 días hábiles** → la oferta **`expira`**, la solicitud **se
> cancela**, **le llega el correo** y **queda la tarea «cancelar guía no usada»** en la cola del operador
> (D22); intentar **re-ofertar** sobre una solicitud terminal → **no existe** esa vía; intentar **editar** una
> oferta ya enviada → **no existe** (solo cancelar y emitir otra); **aceptación parcial** (intentar aceptar
> solo algunas líneas) → **no existe** esa vía; intentar **aceptar sin sesión** desde un enlace → **no
> funciona**; **respuesta manipulada** con otro monto → el monto pagado **sigue siendo el ofertado**; carta
> que **llega no-NM** → **rechazada, no se paga** y corren los **7/30 días** de §H; **todo el paquete
> rechazado** → el vendedor **cobra $0**, **no debe nada** y **no queda saldo negativo** (D17); **rechazo
> parcial de CUALQUIER tamaño** (39% o 12%, da igual) → **se paga lo aprobado sin preguntar nada** y **no
> existe** ninguna pantalla, correo, estado ni plazo de *«¿quieres continuar?»* (D30); **intentar disparar el
> flujo `ajustada` en una solicitud de buylist** → **no existe** esa vía; **bruto aprobado por debajo del
> envío** → el neto **se topa
> en $0**, **nunca negativo** ni con cargo al vendedor; **operador** intentando ofertar **por encima de
> MX$1,500** —**incluyendo llegar ahí con un override manual**— → la oferta **queda esperando autorización**
> (D24/D26); **override sin motivo** → **no se guarda** (el motivo es obligatorio, D26); **carta con bounty
> vivo** cuya posición llega a **10** → la mesa **NO** pinta «no comprar» (manda el bounty, D29); **carta sin
> bounty** cuya posición llega a **10** → **sí** lo pinta, **sin bloquear**; **«ya lo mandé» sin confirmar 5
> días hábiles** → aparece **como alerta** en la cola, **sin expirar nada** (P17); **usuario sin
> celular** (cuenta de Google o cuenta vieja) → **no puede crear solicitud** hasta capturarlo; solicitud por
> **debajo del mínimo** → **no se crea** ni siquiera **saltándose el cotizador** (validación en servidor);
> pieza convertida **sin ubicación** o **sin precio** → **no aparece en Compra** y **sí aparece señalada** en
> la cola de pendientes de publicar diciendo **qué le falta**; carta en **«precio pendiente»** → **no se
> oferta con MX$0** ni se publica; **operador** intentando ofertar **por encima de su tope** → la oferta **no
> sale** y **queda esperando la autorización del súper-admin** (D13); **operador** intentando **pagar** →
> **bloqueado y registrado**; cambio de los **plazos o de los umbrales en M10** → surte efecto **sin
> redeploy**, queda **auditado** y **no acorta** fechas ya comunicadas; **intentar guardar en M10 una tarifa de
> envío del buylist igual o mayor que el umbral de guía** (p. ej. **$1,000** o **$1,200** con umbral de
> **$1,000**) → **NO se guarda** y el error dice **por qué** (criterio 127, D30); **buscar en M10 el dial de
> «umbral de recorte material»** → **no existe** (D28 quedó sin objeto).

**P.12 — Mínimo de compra y bandas de envío: tres tramos, dos diales (D18, D18b)**
> **Por qué existe el mínimo**: cada solicitud cuesta lo mismo de operar —revisar, ofertar, recibir,
> verificar, pagar por SPEI y archivar— venga por **una carta o por mil**. Debajo de cierto monto, la
> operación **pierde dinero por definición**, y hacerla igual sale más caro que decir que no.

| Banda (total de la solicitud) | ¿Se compra? | ¿Quién paga el envío? | Qué ve el vendedor |
|---|---|---|---|
| **Menos de MX$500** | **NO** — no se crea la solicitud | — | El cotizador le dice **cuánto le falta** (*«te faltan $120»*) |
| **De MX$500 (inclusive) a menos de MX$1,000** | Sí | **El vendedor**, como hoy | Correo de oferta con **un solo monto** y el aviso de que el envío corre por su cuenta |
| **MX$1,000 (inclusive) en adelante** | Sí | **Nosotros** (se descuentan **MX$180**, D25) | Correo con **bruto / envío / neto** y **cuál se deposita** |

- [ ] **El mínimo aplica al TOTAL de la solicitud (D18)**, no por carta ni por línea: **una carta de $600
      pasa; mil cartas que suman $400, no**.
- [ ] **Se valida en el SERVIDOR, no solo en el cotizador (D18)**: el cotizador es superficie del cliente y
      se puede saltar. **Debajo del mínimo no se crea la solicitud**, punto — igual que el monto de compra se
      deriva server-side (SEC-A1).
- [ ] **El cotizador dice cuánto falta, no solo que no se puede (D18)**: *«te faltan $120 para llegar al
      mínimo de $500»*. Un "no" seco manda al vendedor a otro lado; un "te faltan $120" lo manda **a agregar
      otra carta**.
- [ ] **Los dos umbrales son diales SEPARADOS (D18b)**: el **mínimo de compra** y el **umbral de guía** viven
      en M10 como dos números independientes. **Mover uno no mueve el otro.**
- [ ] **Los dos bordes son INCLUSIVOS** *(3ª ronda; cierra la pregunta 19 — **corrige mi supuesto**, que hacía
      estricto el umbral de guía)*:
      - **$500 inclusivo**: una solicitud de **exactamente MX$500 SÍ se crea**.
      - **$1,000 inclusivo**: una oferta de **exactamente MX$1,000 SÍ lleva guía nuestra**.
      Las dos van en el mismo sentido —**a favor del vendedor en el borde**— y así son fáciles de recordar y
      de explicar: *«desde $500 te compramos; desde $1,000 el envío va por nuestra cuenta»*.
- [ ] **Sobre qué monto se juzga cada umbral**: el **mínimo** se juzga sobre el **total cotizado** al crear la
      solicitud (es cuando aplica), y el **umbral de guía** sobre el **BRUTO ofertado** (es lo que sabemos
      cuando decidimos si mandamos etiqueta, y lo que el correo de oferta tiene que anunciar).
- [ ] **El mínimo NO se re-aplica a la oferta** *(3ª ronda; cierra la pregunta 19 — supuesto confirmado)*: el
      mínimo **gatea la creación de la solicitud, no la oferta**. Si se cotizaron **$600** y tras el
      cherry-pick solo compramos **$200**, **la oferta sale igual**: ya gastamos el trabajo de revisar esa
      solicitud, y negarnos a comprar al final por un umbral que se cumplió al entrar sería tirar ese trabajo
      **y** dejar al vendedor sin respuesta. **Un solo umbral, en un solo momento.**
      *(⚠ **Requisito retirado** de la 2ª ronda, se señala en vez de borrarlo: aquí decía que *«la mesa de
      decisión debe avisarlo»*. Era **alcance que yo había inventado** mientras la pregunta seguía abierta;
      con la respuesta del humano —«el mínimo no se re-aplica»— **no hay aviso obligatorio**. La mesa ya
      muestra el **bruto ofertado** en todo momento, así que el operador tiene la cifra a la vista.)*

**P.13 — El reloj y el estado no son lo mismo: nadie pierde su venta por una demora nuestra (riesgo conocido D20 × D4)**
> **El choque, dicho sin rodeos**: **D20** dice que quien marca **`en_transito`** es **el operador**, y
> **D4** dice que la solicitud **expira** si el paquete no sale en el plazo. Si el vendedor deposita su
> paquete **el día 3** y el operador **no lo confirma hasta el día 4**, el barrido **expiraría una solicitud
> donde el vendedor SÍ cumplió**. Sería castigarlo por **nuestra** demora — y en una operación donde **ya le
> compramos la guía**, además nos costaría dinero.
- [ ] **Requisito de negocio: un plazo del vendedor solo puede vencer por algo que dependa del vendedor.**
      Nuestra carga de trabajo **no puede cancelarle una venta**.
- [ ] **Se separan el reloj y el estado**:
      - el vendedor tiene un **«ya lo mandé»** que **DETIENE su reloj** pero **NO mueve el estado** — es su
        palabra, todavía sin confirmar;
      - **el operador confirma el envío**, y **eso** es lo que mueve la solicitud a **`en_transito`** (D20);
      - el **barrido solo expira** una solicitud si **no ocurrió ninguna de las dos cosas**.
- [ ] **Un «ya lo mandé» no cuenta como inventario en camino** (§P.2/§P.4): detiene el reloj, **no** suma a
      los conteos de la mesa de decisión. Es una promesa, no un paquete.
- [ ] **Un «ya lo mandé» sin confirmar se vuelve ALERTA a los 5 días hábiles** *(3ª ronda; cierra la pregunta
      17)*: la solicitud queda en la **cola del operador** («por confirmar envío») y, **pasado el dial**
      —default **5 días hábiles**, editable en M10—, **se destaca como alerta** en esa cola. **Eso es todo lo
      que pasa**: la alerta **no expira nada**, **no cancela nada** y **no mueve el estado**. El vendedor ya
      cumplió; el pendiente es **nuestro**, así que el remedio es **hacerlo visible**, no castigarlo.
- [ ] **La alerta no infla la cifra de «en camino»**: precisamente porque el «ya lo mandé» **no mueve el
      estado**, esa solicitud **sigue sin sumar** al conteo de la mesa de decisión (§P.2). El conteo se queda
      **corto, no inflado** —que es el lado seguro del error— y la alerta existe para que **alguien lo
      corrija pronto** en vez de que se quede corto indefinidamente.

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
- **Aceptación parcial de una oferta de buylist** *(v2.1, D1)*: la oferta es **todo-o-nada**. El cliente ve
  el desglose de qué compramos y qué no, pero **no puede aceptar solo algunas líneas**. Tampoco hay
  **contraoferta ni negociación** dentro de la app: la respuesta es **aceptar o rechazar**.
- **Repreciar al recibir / regatear la carta ya enviada** *(v2.1, D9)*: **desaparece del producto**. Verificar
  decide **si la carta es NM o no**, no cuánto vale hoy. No existe la vía "te ofrecí X pero te pago menos".
- **Fijar el precio de VENTA dentro del ciclo de buylist** *(v2.1, D10)*: el ciclo de adquisición **no
  captura precios de venta**. El precio al que se publica lo resuelve la **curva por valor de mercado**
  (§N.1) con su precedencia money-safe, igual que para cualquier otra pieza.
- ~~**Guías, etiquetas o envíos pagados por la plataforma en el buylist** *(v2.1)*~~ — **SUPERADO (2ª ronda
  v2.1, D16/D18b)**: **arriba de MX$1,000 la guía SÍ la paga la plataforma** y se descuenta del pago
  (`bruto − envío = neto`). Lo que **sigue fuera** es la **integración con paquetería** (ver punto siguiente).
- **Integración con paquetería en el buylist** *(2ª ronda v2.1, D19)*: la guía se **compra a mano y fuera del
  sistema**, y el operador **captura el número**. **No** hay compra automática de etiquetas, **ni** cotización
  de tarifas, **ni** rastreo en vivo, **ni** validación del número contra el transportista, **ni** cancelación
  automática de la etiqueta no usada (el sistema **deja la tarea** al operador, D22). **Es proyecto aparte.**
  El sistema **solo guarda y muestra** el número. Sigue aplicando el punto general de «Pagos y logística
  automatizados» de arriba.
- ~~**Recordatorios automáticos de los plazos del buylist** *(v2.1, SUPUESTO)*~~ — **REVERTIDO (2ª ronda
  v2.1, D23)**: **el recordatorio SÍ entra al MVP**. Es **uno solo**, a **un día hábil** de vencer y **una
  sola vez**. Los correos obligatorios del ciclo pasan a ser **tres**: **oferta**, **recordatorio** y
  **expiración/cancelación**. Lo que **sigue fuera** es cualquier **secuencia** de recordatorios (más de uno
  por plazo, escalado, SMS o WhatsApp).
- **Cobrarle el envío al vendedor cuando se rechaza todo** *(2ª ronda v2.1, D17)*: **no existe**. Si ninguna
  carta pasa la verificación, **absorbemos la guía**: no hay cobranza al vendedor, **no hay saldo negativo**,
  no se retiene contra operaciones futuras. **El neto de una solicitud nunca es negativo.**
- **Re-preguntarle al vendedor tras la verificación («¿quieres continuar?»)** *(NUEVO 4ª ronda v2.1, D30 —
  **retira lo que la 3ª ronda había metido al alcance**)*: **no existe**. Ni pantalla, ni correo, ni estado
  `ajustada`, ni plazo, ni recordatorio, ni umbral que lo dispare. **La condición NM se declara al ofertar,
  línea por línea, y el vendedor la acepta antes de mandar nada** (§P.3); después **no se re-confirma
  nada**. Si alguien vuelve a proponerlo, es **alcance nuevo** y hay que pedirlo explícitamente **con la
  objeción de D30 resuelta**: llega **con la etiqueta comprada y las cartas en la bóveda**, donde **ninguna
  respuesta del vendedor es buena**.
- **Re-ofertar sobre una solicitud terminal** *(2ª ronda v2.1, respuesta a la pregunta 2)*: `rechazada`,
  `expirada` y `abandonada` son **terminales**. No se revive una solicitud ni se le emite una oferta nueva
  encima: el vendedor **cotiza de nuevo**.
- **Editar una oferta ya enviada** *(2ª ronda v2.1, respuesta a la pregunta 3)*: no hay ventana de
  corrección. Si el admin se equivocó, **cancela y emite otra** (correo nuevo, plazo desde cero, auditado).
- **Aceptar una oferta desde un enlace anónimo** *(2ª ronda v2.1, respuesta a la pregunta 7)*: aceptar
  **exige sesión iniciada**. El enlace tokenizado de §J sirve para **mirar** un pedido de invitado, no para
  **comprometer dinero**.

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
  **soporte@tcgvault.mx** *(Confirmado por el PO, ago-2026: disputas sigue en `soporte@tcgvault.mx` (dominio
  `tcgvault.mx`); es un dominio distinto del `contacto@tcgvaultmx.com` del call-out de reventa y ambos son
  correctos)*. Debe aparecer en términos/FAQ
  y en el flujo de disputa.
- **Pago de buylist**: solo **SPEI** a cuenta a nombre del propio usuario (sin otros métodos). La **CLABE**
  se guarda **cifrada en BD**; el **INE se almacena cifrado en R2 con retención** (`INE_RETENTION_DAYS`,
  default 180) y se **verifica contra el nombre de la CLABE**.
- **Ciclo de adquisición del buylist** *(v2.1, §P; actualizado en la 2ª ronda por D13–D23)*: el pipeline es
  `cotizada → ofertada → aceptada → en_transito → recibida → verificación → aprobada → pagada`, con **cuatro
  estados terminales** (**`pagada`, `rechazada`, `expirada`, `abandonada`**). **Nada llega a "en camino" sin
  oferta aceptada** ni sin que **el operador confirme el envío** (D20). El **precio ofertado es vinculante
  desde que sale el correo**; frente al vendedor lo vinculante es el **NETO** y el **costo de adquisición** es
  el **BRUTO** (el envío es **gasto operativo**, D16). Los **dos plazos** —**2 días hábiles** para aceptar y
  **3 días hábiles** para que salga el paquete— son **diales de M10** editables sin deploy y auditados, junto
  con el **mínimo de compra (MX$500)**, el **umbral de guía (MX$1,000)**, el **tope de oferta del operador**
  y el **tope de piezas por variante**. La **guía la ponemos nosotros arriba del umbral**, se compra **a mano
  y fuera del sistema** (**sin integración con paquetería**, D19) **al aceptar** (D21). El **monto de cada
  línea se deriva server-side** (SEC-A1) de la curva de compra (§N.1) al momento de ofertar; **la aceptación
  del cliente no transporta el monto**.
- **Celular obligatorio en la cuenta** *(v2.1, D11)*: es dato requerido **al registrarse**, en el **alta de
  usuario por admin** y **antes de crear una solicitud de venta** (este último cubre las cuentas de **Google**
  y las cuentas viejas con el campo vacío). El **teléfono viaja en la cola de buylist** del back-office (D12)
  y **nunca** se expone en superficie pública (§J).
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
15. **Cherry-pick carta por carta — AL OFERTAR y al verificar** *(actualizado v2.1, D1/D9)*: el dueño decide
    **línea por línea qué compra** **en la fase de oferta** (antes de que el vendedor mande nada), y lo que
    resulta de esa decisión **es la oferta**. En la **verificación** la decisión carta por carta sigue
    existiendo, pero **solo tiene dos desenlaces**: **NM ⇒ aprobada y se paga lo ofertado**, o **no-NM ⇒
    rechazada**. **No existe repreciar/ajustar el monto al recibir.** Una carta aprobada se **convierte a
    inventario en un clic**. Verificable: en una solicitud de 3 líneas se ofertan 2 y se descarta 1; el correo
    y la pantalla del cliente muestran **las 3 con su desenlace**, y al recibir **no hay ninguna acción que
    cambie el monto** de una línea aprobada.
16. **Plazos del buylist — los cuatro, y son de momentos distintos** *(actualizado v2.1, D3/D4/D8; en la
    2ª ronda por D14/D21; en la 3ª por las respuestas a las preguntas 15/18/21; y **CORREGIDO en la 4ª por
    D30**)*:
    (a) *(sin cambio)* una **carta rechazada por no ser NM** da al usuario
    **7 días** para gestionar la devolución **a su costo**, y
    **a los 30 días** se considera **abandonada**; una carta **NM** abandonada **pasa a inventario** y una
    **no-NM** abandonada **NO entra al inventario vendible**;
    (b) *(nuevo)* una solicitud **`ofertada`** sin respuesta del cliente en **2 días hábiles** queda
    **`rechazada`** y la oferta deja de ser válida;
    (c) *(nuevo)* una solicitud **`aceptada`** cuyo **paquete no salió** en **3 días hábiles** —contados
    **desde que la guía llega al vendedor** cuando el envío lo ponemos nosotros, y **desde la aceptación**
    cuando lo paga él— queda **`expirada`**, se **cancela** y **se notifica al vendedor** por correo.
    Los dos plazos nuevos son **diales de M10** (criterio 127), se cuentan en **días hábiles** —**lunes a
    viernes, sin festivos oficiales de México, en `America/Mexico_City`** (criterios 141 y 154)— y se
    comunican al cliente **con fecha y hora explícitas**, no como "en 2 días". **Cada plazo se congela por
    solicitud** al fijarse (criterio 157) y **lleva su propio recordatorio, una sola vez** (criterio 159).
    **Siguen siendo CUATRO, y no cinco** *(4ª ronda, D30)*: la 3ª ronda había abierto la puerta a **un quinto
    plazo** —el de la pregunta *«¿continúas?»* del rechazo parcial (pregunta 23)—, que **desaparece con
    D30**. Y el disparador *«falta de respuesta a un ajuste»* de §H **vuelve a ser teórico dentro del
    buylist**: D9 mató el repreciado y D30 retiró la re-confirmación, así que **el único caso vivo que activa
    los 7/30 días es la carta rechazada por no ser NM** (y cualquier pieza que el vendedor mande sin que se la
    hayamos comprado). Verificable: **no existe** ninguna ruta que abra un plazo de respuesta después de la
    verificación.

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
    *(Actualizado 2ª ronda v2.1, D13 — corrige el supuesto del primer pase)*: **sí puede emitir ofertas de
    buylist hasta su tope de monto** y **capturar la guía y confirmar el envío**; **por encima del tope la
    oferta no sale**: queda **pendiente de autorización del súper-admin** (criterio 143). **Pagar sigue
    siendo exclusivo del súper-admin** (criterio 26).
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
33. **Mensaje al vendedor — las dos ideas** *(actualizado v2.1; precisado en la 2ª ronda por D16)*: el
    cotizador/solicitud, el **correo de oferta** y los **términos** muestran claramente **(a)** que **solo
    compramos lo que ofertamos por correo, y que el monto ofertado es el que se paga** —**el NETO anunciado
    es la cifra que se deposita**, y no se recalcula al recibir— y **(b)** que el **pago ocurre tras la
    recepción y verificación** de la carta (no por adelantado). Verificable: las dos frases están presentes
    en las tres superficies, en **ES y EN** (criterio 32).
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

> **Nota de verificación 1 (actualizada 2026-08-28)**: la fuente del estimado es el **ingest automático** de
> PokemonPriceTracker sobre `ebay.salesByGrade` (§O.6), con **override manual** como respaldo y máxima
> precedencia. QA puede montar cualquiera de estos criterios **con override manual** cuando necesite fijar
> valores exactos; el comportamiento visible es el mismo venga el número de donde venga.

> **Nota de verificación 2 (2026-08-23)**: el cálculo del gate **no se pinta**, así que estos criterios se
> verifican por **presencia/ausencia** (qué carta aparece en qué superficie), por **orden** (el de la vitrina)
> y por **inspección del payload** (que no viajen los insumos del cálculo) — **no** comparando cifras
> derivadas en pantalla.

> **Nota de verificación 3 (2026-08-28)**: la feature vive tras un **feature-flag apagado** hasta que el
> humano apruebe el texto legal (§O.5). QA verifica estos criterios **con el flag encendido** en el entorno de
> prueba, y verifica **además** que con el flag apagado **ninguna** superficie muestra cifra estimada.

97. **El gate decide QUÉ SE PROMOCIONA (curaduría), no qué se ve**: una carta raw publicada entra a **teja y
    vitrina** **si y solo si** `estimadoPSA9 ≥ (precioVentaRaw + gradingCost) × (1 + minUpsidePct)` —con
    `gradingCost` = **escalón** que corresponde a esa carta (criterio 110) y `minUpsidePct` default **30%**—
    **y además** la cifra supera el **gate de confianza** (criterio 111). Verificable con dos cartas límite:
    una que pasa **por poco** (**aparece** el badge / entra a la vitrina) y otra **justo por debajo** (**no
    aparece**). En **ambos casos la ficha muestra sus estimados**, porque la ficha **no depende del gate de
    ROI**. El **PSA 10 no interviene**: una carta con PSA 10 altísimo pero PSA 9 que no pasa el gate **no se
    promociona**.
98. **Sin estimado PSA 9 no se promociona, pero la ficha sí informa**: una carta con estimado **PSA 10** pero
    **sin** estimado **PSA 9** **no entra** a teja ni a vitrina; **su ficha sí muestra el PSA 10**. El sistema
    **no infiere ni interpola** el PSA 9 a partir del PSA 10.
99. **Ficha: solo precio + los dos estimados (verificación de AUSENCIA)**: la ficha de una carta raw con dato
    muestra **exactamente**: el **precio de venta de la carta**, el **estimado PSA 10**, el **estimado PSA 9**,
    la **fecha del dato**, el **micro-aviso** y la **llamada al pie** (criterio 103). Y **NO muestra** —en
    ninguna forma— **multiplicador**, **diferencia/ganancia**, **porcentaje de rendimiento**, **costo de
    gradeo**, **escalón aplicado**, **tamaño de la muestra de ventas** ni **comparativa**. Verificable buscando
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
103. **Disclaimer — patrón de llamada + nota al pie, con micro-aviso adyacente**: verificable en las **tres**
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
104. **Diales editables sin deploy y auditados** *(actualizado 2026-08-28)*: el súper-admin edita la **tabla de
    escalones** (`gradingCostTiers`), `minUpsidePct`, **`minSalesSample`** y **`maxGradedMultiple`**; el cambio
    **surte efecto sin redeploy**, queda **auditado** en la bitácora (M10) y **recalcula qué se promociona**
    (verificable: subir `minUpsidePct` de 30% a un valor alto, encarecer un escalón, o subir `minSalesSample`
    por encima de la muestra disponible, **vacía la vitrina y quita los badges**, **sin tocar ningún precio de
    venta** y **sin alterar lo que muestran las fichas**).
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
109. **Frescura del estimado** *(actualizado 2026-08-28)*: un estimado **rancio deja de mostrarse** en las tres
    superficies (y la carta deja de promocionarse). La antigüedad se mide contra la **fecha de la última venta
    observada** para el dato automático, y contra la **fecha de captura** para un override manual; el umbral
    es de **30 días** *(umbral y forma de medirlo sujetos a confirmación del humano — ver preguntas abiertas
    v2.0)*.
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

**Ciclo de adquisición del buylist — oferta, aceptación, guía y publicación (v2.1, §P)**
113. **El pipeline tiene las ocho fases y los cuatro estados nuevos** *(actualizado 2ª ronda)*: una solicitud
    recorre `cotizada → ofertada → aceptada → en_transito → recibida → verificación → aprobada → pagada`, y
    sus **estados terminales son cuatro**: **`pagada`**, **`rechazada`**, **`expirada`** y **`abandonada`**.
    Verificable recorriendo el ciclo completo en el back-office y viendo el estado en cada paso, tanto en la
    vista del admin como en la del cliente.
114. **Nadie manda cartas sin un sí nuestro (regla dura)**: una solicitud **`cotizada`** u **`ofertada`**
    **no ofrece ninguna vía** —ni en el portal del cliente, ni en el back-office— para avisar «ya lo mandé»
    o marcarse en tránsito, y la pantalla del cliente **no muestra guía, instrucciones ni dirección de
    envío** hasta que la oferta está **aceptada**. Verificable: **no existe** ninguna secuencia de acciones
    que lleve una solicitud a **`en_transito`** sin haber pasado por **`ofertada` y `aceptada`**.
115. **Mesa de decisión con el inventario a la vista (D6)**: al ofertar, por **cada línea** de la solicitud el
    admin ve **(a)** qué pidió vender el cliente y su monto, **(b)** **cuántas piezas de esa carta hay en
    inventario**, **(c)** **cuántas vienen en camino** y **(d)** una **sugerencia legible de comprar / no
    comprar**. Verificable con datos preparados: una carta con **3 en inventario** y **2 en camino** muestra
    exactamente esas dos cifras.
116. **"En camino" cuenta solo lo que de verdad viaja** *(actualizado 2ª ronda, D20)*: **NO** suman al conteo
    de "en camino" ni una solicitud **`aceptada`**, ni una con **guía emitida pero sin confirmar**, ni una
    con **«ya lo mandé» del vendedor**; **solo suma** cuando el **operador confirma el envío** y la solicitud
    queda **`en_transito`**. Verificable observando el conteo de esa carta en los **cuatro momentos**.
117. **La sugerencia NUNCA bloquea (D6)**: el admin puede **comprar una línea que la sugerencia desaconseja**
    y **descartar una que la sugerencia aconseja**, sin bloqueo, sin permiso extra y sin que el sistema
    cambie su decisión. Verificable en los dos sentidos: la oferta emitida contiene **exactamente** lo que el
    admin marcó.
118. **La oferta es todo-o-nada y sale por correo con desglose y precio (D1)**: al ofertar, el cliente recibe
    un **correo** con el **desglose línea por línea** (qué compramos y a cuánto; **qué no compramos**), el
    **total ofertado**, la **fecha y hora límite para aceptar** y el enlace para responder; y en su portal
    solo tiene **dos acciones: aceptar o rechazar el paquete completo**. Verificable: **no existe** ninguna
    vía —UI ni petición manipulada— para aceptar **solo algunas líneas**, ni para **contraofertar**.
119. **El precio ofertado es vinculante desde el correo y es el que se paga (D2/D9)** *(actualizado 2ª ronda,
    D16)*: entre el envío de la oferta y el pago, **cambiar el precio de mercado no cambia el monto**; el
    **SPEI pagado** es **exactamente el NETO ofertado**, y el **costo del item en inventario** —el que usa el
    **P&L de M7**— es **exactamente el BRUTO ofertado**. Verificable moviendo el mercado hacia arriba y hacia
    abajo entre ambos momentos y comparando el correo de oferta contra el pago y el costo. Además: al
    recibir/verificar **no existe ninguna acción** que modifique el monto de una línea aprobada.
120. **El monto no viaja del cliente al servidor (SEC-A1)**: aceptar una oferta es aceptar **la oferta
    guardada**; una **respuesta manipulada** con otro monto **no cambia** lo que se paga, y el intento queda
    **registrado**.
121. **Plazo de aceptación: 2 días hábiles (D3/D14)**: pasado el plazo **sin respuesta**, la solicitud queda
    **`rechazada`** y **aceptar después ya no funciona** (mensaje claro, sin efecto). Verificable adelantando
    el reloj/plazo: antes del vencimiento la aceptación funciona; después, no.
122. **La guía la ponemos y la captura el operador; el cliente ya no captura nada** *(REESCRITO 2ª ronda,
    D16/D19/D20; supersede D5)*: en la banda con envío a nuestro costo, **el portal del cliente NO tiene
    ningún campo para capturar paquetería ni número de rastreo**; el **operador** captura el número de la
    guía que compró a mano, **se la manda al vendedor**, y **al confirmar el envío** la solicitud pasa a
    **`en_transito`** — quedando registrado **quién lo hizo** (bitácora M10). El **número de guía es visible
    para las dos partes**.
123. **Plazo de envío: 3 días hábiles desde que la guía llega al vendedor, y expira con aviso (D4/D21)**: una
    solicitud **`aceptada`** cuyo paquete **no salió** en el plazo queda **`expirada`**, **se cancela** y
    **el vendedor recibe un correo** diciéndoselo. Verificable adelantando el plazo: el estado cambia solo y
    el correo sale; y verificable además que **el reloj arranca con la entrega de la guía**, no con la
    aceptación (una guía entregada **dos días después** de aceptar **corre el vencimiento dos días**).
124. **Verificación con dos desenlaces POR CARTA (D9)** *(la 3ª ronda lo había **ACOTADO** por D27; la **4ª
    ronda (D30) le devuelve su alcance COMPLETO**)*: una carta que llega **NM** se **aprueba y se paga lo
    ofertado**; una que **no** llega NM se **rechaza, no se paga** y corren los plazos de devolución de §H
    (**7 días a costo del usuario**, **abandono a 30 días**). Verificable: en la pantalla de verificación
    **no existe** ningún **campo de monto**, ni **repreciar**, ni **contraofertar**, **ni ajustar** —
    **ningún monto de línea se mueve jamás** y **la solicitud no gana ningún tercer camino**.
    ~~**Precisión de la 3ª ronda**: el criterio original decía además que no existe *«ajustar»*. Eso sigue
    siendo cierto **para el precio**, pero **D27 introduce un ajuste de ALCANCE** —cuando el bruto aprobado
    cae **más de 20%**, se le pregunta al vendedor si continúa, reusando el ítem **`ajustada`**—.~~
    **⚠ RETIRADA en la 4ª ronda (D30)**: sin re-confirmación, **el ciclo de buylist no usa `ajustada` en
    ningún punto** y la acotación **queda sin objeto**. Verificable también por lo negativo: **no existe**
    ninguna pantalla, correo, estado ni plazo que le pida al vendedor confirmar un alcance reducido después
    de verificar (criterio **150**).
125. **Cierre del ciclo: ubicación + precio ⇒ publicada** *(actualizado 2ª ronda, respuesta a la pregunta
    12)*: una pieza convertida a inventario **no aparece en Compra** mientras le falte **ubicación física** o
    **precio de venta**, **sí aparece** en la **cola de pendientes de publicar** indicando **qué le falta**,
    y **se publica sola** en cuanto tiene las dos cosas (sin acción manual de "publicar"). Además: **la
    conversión NO exige ubicación** —el pago al vendedor **nunca se frena** por eso— y la pieza que llega sin
    ubicación sale **señalada** en la cola. Verificable con tres piezas: una sin ubicación, una sin precio y
    una completa.
126. **El precio de venta lo fija la curva, no el ciclo de compra (D10)**: en todo el ciclo de buylist **no
    existe** ningún campo para capturar el **precio de venta** de la pieza, y el precio con el que se publica
    es el que produce la **curva por valor de mercado** (§N.1) con su precedencia. Una pieza **sin dato de
    mercado** queda en **«precio pendiente»**, **no se publica** y **se escala al dueño** — **nunca** hereda
    el precio de compra ni sale a la venta con MX$0.
127. **Los diales del ciclo son editables y auditados (D8, ampliado 2ª ronda, completado en la 3ª y
    **CORREGIDO en la 4ª por D30**)**: el súper-admin edita en **M10** los **OCHO diales de §P.10** — plazo de
    aceptación (**2 días hábiles**), plazo de envío (**3 días hábiles**), mínimo de compra (**MX$500**),
    umbral de guía (**MX$1,000**), tope de oferta del operador (**MX$1,500**), tope de piezas por variante
    (**10**), tarifa de envío del buylist (**MX$180**) y alerta de «ya lo mandé» sin confirmar (**5 días
    hábiles**). Cada cambio **surte efecto sin redeploy**, queda **auditado** (bitácora M10) y **aplica a
    solicitudes nuevas**. Verificable: **mover el mínimo de compra no mueve el umbral de guía**, y **mover la
    tarifa del buylist (MX$180) no mueve la tarifa de envío de retiro (MX$175)** — son diales distintos.
    **Eran nueve** *(4ª ronda)*: el **umbral de recorte material (20%, D28)** queda **SIN OBJETO** y **se
    retira** — verificable porque **no existe** ese campo en M10 ni ninguna conducta del sistema que dependa
    de él.
    **Validación entre diales — REFORMULADA, no retirada** *(4ª ronda, D30)*: ~~M10 **rechaza** guardar una
    tarifa de envío mayor a `umbral de guía × (1 − umbral de recorte material)` (hoy **MX$800**), porque ahí
    el piso de cero se activaría **sin haberle preguntado al vendedor**.~~ **Esa fórmula citaba el dial que
    dejó de existir**, así que se sustituye por la relación que **sigue siendo cierta entre los diales que
    quedan**: **M10 rechaza guardar una `tarifa de envío del buylist` que sea IGUAL O MAYOR que el `umbral de
    guía a nuestro costo`**. Razón: el umbral es **inclusivo** (criterio 158), así que **la oferta más chica
    con envío a nuestro costo vale exactamente el umbral**; si la tarifa lo igualara, **una operación con TODO
    aprobado depositaría MX$0** — una oferta que no paga nada aunque el vendedor cumpla perfecto. Verificable
    en M10 con **tres intentos**: `tarifa = MX$180` con `umbral = MX$1,000` ⇒ **guarda**; `tarifa = MX$999`
    ⇒ **guarda**; `tarifa = MX$1,000` (igual) y `tarifa = MX$1,200` (mayor) ⇒ **NO guarda**, y el error dice
    **por qué**. La validación es **bloqueante**, no una advertencia, y aplica **en los dos sentidos** (bajar
    el umbral de guía por debajo de la tarifa **también se rechaza**).
    *(**SUPUESTO** — pregunta abierta **24**: elijo **estrictamente menor, sin colchón**. Si el humano quiere
    margen (p. ej. `tarifa ≤ umbral / 2`), es un número que él fija.)*
128. **Celular obligatorio en los tres puntos (D11)**: **(a)** el registro **no se completa** sin celular;
    **(b)** el **alta de usuario desde el back-office** **no se completa** sin celular; **(c)** un usuario sin
    celular —incluido el que **entró con Google** y el que ya existía con el campo vacío— **no puede crear una
    solicitud de venta**: se le pide el dato **en ese momento** y, hasta capturarlo, la solicitud **no
    avanza**. Verificable con una cuenta de Google recién creada y con una cuenta preexistente sin teléfono.
129. **Cotizaciones vivas y teléfono en la cola (D12)**: el back-office puede ver **qué usuarios tienen
    solicitudes de venta vivas** y **cuántas** tiene cada uno, y **el teléfono aparece en la propia cola de
    buylist** (sin abrir la ficha del usuario), de modo que el operador pueda **llamar**. **«Viva» = todo lo
    que NO es terminal**; los terminales son **`pagada`, `rechazada`, `abandonada` y `expirada`**
    *(actualizado 2ª ronda, respuesta a la pregunta 10)*. Verificable con dos usuarios con distinto número de
    solicitudes vivas: el conteo y el teléfono son correctos, y una solicitud en **cualquiera de los cuatro
    estados terminales deja de contar**.
130. **El teléfono no se filtra al público**: el número **no aparece** en ninguna superficie pública (ficha,
    Compra, confirmación de pedido ni **vista de seguimiento por enlace tokenizado**, §J).
131. **Producto separado: promo y exclusivo de deck no se confunden con el set base (D7)**: una **promo** y un
    **exclusivo de deck** se capturan, cotizan, cuentan y publican como **producto distinto** de la versión
    del **set base**. Verificable: teniendo en inventario 3 piezas de la versión del set base y 2 de la promo
    de la misma carta, la mesa de decisión (criterio 115) **muestra el conteo separado** y **nunca** un único
    "5"; y publicar una **no** afecta el precio ni la ficha de la otra.

**Ciclo de adquisición del buylist — 2ª ronda: envío, mínimos y delegación (v2.1, D13–D23; §P.4/§P.12/§P.13)**
132. **Mínimo de compra MX$500, validado en el servidor (D18)**: una solicitud cuyo **total** queda por
    debajo del mínimo **no se crea**. Verificable en los dos frentes: **(a)** desde el cotizador, el botón de
    crear solicitud **no procede** y la pantalla dice **cuánto falta** (*«te faltan $120»*, con el número
    correcto); **(b)** **saltándose el cotizador** —mandando la solicitud directo al servidor— **tampoco se
    crea**. El mínimo se juzga sobre el **TOTAL** (una carta de $600 pasa; mil cartas que suman $400, no).
133. **Tres bandas de monto, con el envío en la banda correcta (D18b; bordes cerrados en la 3ª ronda)**: una
    solicitud de **MX$300** **no se crea**; una de **MX$700** se crea y **el vendedor paga su envío** (el
    correo de oferta lleva **un solo monto** y lo dice); una de **MX$1,500** se crea y **la guía la ponemos
    nosotros** (el correo lleva **bruto MX$1,500 / envío MX$180 / neto MX$1,320**). Verificable con una
    solicitud por banda **y con los dos bordes, que son AMBOS inclusivos**: **exactamente MX$500 SÍ se crea**
    y **exactamente MX$1,000 SÍ lleva guía nuestra** (criterio 158).
134. **El correo de oferta muestra los tres montos y dice cuál se deposita (D16)** *(⚠ **PRECISADO en la 4ª
    ronda por D30** — se señala la tensión en vez de dejarla latente)*: en la banda con envío a
    nuestro costo, el correo contiene **bruto**, **envío** y **neto**, con **neto = bruto − envío** y una
    frase explícita de **cuál se deposita**. Verificable leyendo el correo: **con todas las cartas
    aprobadas**, la cifra anunciada como depósito **es exactamente** la que llega por SPEI — **no puede
    anunciar $1,480 y depositar $1,350**.
    **La tensión que abre D30, dicha en voz alta**: la oferta es **condicional a NM línea por línea**, así
    que **si se rechaza alguna carta el depósito SÍ es menor que el neto anunciado** (criterio 150). Eso **no
    contradice** este criterio, y la diferencia importa: **lo prohibido es que la cifra baje por decisión
    nuestra** —recalcular el envío, repreciar una línea, aplicar una comisión sorpresa (D2/D9/D25)—; **lo
    permitido, porque estaba escrito y aceptado, es que baje porque una carta no cumplió la condición**.
    Verificable con **dos casos**: **(a)** todo NM ⇒ **depósito idéntico** al anunciado; **(b)** una carta
    rechazada ⇒ el depósito baja **exactamente** el bruto de esa línea (**ni un peso más**), y el correo de
    oferta que él aceptó **ya decía** que esa línea estaba condicionada (criterio **161**).
135. **El envío NO entra al costo de la pieza (D16)**: el **costo de inventario** de la carta comprada es el
    **BRUTO ofertado** de su línea, y el costo de la guía se registra como **gasto operativo**, no como costo
    de la pieza. Verificable en **M7**: dos piezas idénticas compradas por el mismo bruto, una llegada en un
    paquete con envío caro y otra sin envío nuestro, tienen **exactamente el mismo costo** y el **mismo
    margen por carta**; el envío aparece **como gasto del periodo**, en su propia línea.
136. **Topes y KYC sobre el BRUTO; SPEI por el NETO (D16)**: los **topes por solicitud y mensual** y el
    **umbral de INE** se evalúan sobre el **bruto ofertado**, mientras que el pago se ejecuta por el **neto**.
    Verificable con una oferta cuyo **bruto queda arriba del umbral de INE** y cuyo **neto queda abajo**:
    **el INE se sigue exigiendo**. Descontar el envío **no puede** colar una operación por debajo del umbral.
137. **La guía se compra AL ACEPTAR y es manual (D19/D21)**: mientras la solicitud está **`ofertada`** **no
    existe** ninguna guía asociada —ni comprada, ni reservada—; **al aceptar**, el operador **captura a mano**
    el número de la etiqueta que compró fuera del sistema. Verificable: **no hay** llamada a paquetería, **no
    hay** cotización de tarifas ni validación del número contra el transportista; el sistema **guarda y
    muestra** el número a las dos partes.
138. **El operador marca «en tránsito»; el «ya lo mandé» detiene el reloj sin mover el estado (D20/§P.13)**:
    el aviso del vendedor **no cambia el estado** y **no suma al conteo de "en camino"**, pero **sí detiene
    su plazo**; la solicitud pasa a **`en_transito`** **solo** cuando el **operador confirma el envío**.
    Verificable con el caso que motiva la regla: vendedor que avisa **el último día del plazo** y operador
    que confirma **al día siguiente** ⇒ la solicitud **NO expira**. *(Requisito de negocio: nadie pierde su
    venta por una demora nuestra.)*
139. **Guía emitida que no se usó deja tarea de cancelación (D22)**: cuando una solicitud **con guía emitida**
    **expira** o se cancela, aparece en la **cola del operador** la tarea **«cancelar guía no usada»** con el
    **número de guía** a la vista, y **no desaparece sola** hasta que alguien la marca. Verificable dejando
    vencer una solicitud con guía emitida.
140. **Rechazo total ⇒ absorbemos el envío, sin deuda del vendedor (D17)**: si **ninguna** carta pasa la
    verificación, el vendedor **cobra $0**, **no se le cobra el envío**, **no queda saldo negativo** ni cargo
    pendiente contra operaciones futuras. Verificable: tras el rechazo total, la cuenta del vendedor **no
    muestra ningún adeudo** y **no existe** ninguna acción de cobro; el costo de la guía queda como **gasto**
    en M7. **El neto de una solicitud nunca es negativo.**
141. **Los plazos corren en DÍAS HÁBILES (D14)**: una oferta enviada un **viernes** con plazo de **2 días
    hábiles** **no vence el domingo**; vence el **martes** equivalente. Verificable con fechas que cruzan
    **fin de semana** y **un festivo oficial**, comparando la fecha límite del correo con la del barrido: son
    **la misma**.
142. **Recordatorio: uno, a un día hábil, una sola vez (D23)**: a **un día hábil** de vencer sale **un**
    correo de recordatorio; **corriendo el barrido varias veces NO se manda otro**. Verificable ejecutando el
    barrido tres veces dentro de la ventana: **un solo correo**. Los correos obligatorios del ciclo son
    **tres**: **oferta**, **recordatorio** y **expiración/cancelación**.
143. **Tope de oferta del operador, con autorización del súper-admin (D13)**: el **operador** emite ofertas
    cuyo **bruto** cabe en su tope; una oferta **por encima del tope** **no sale** —el correo **no se manda**—
    y queda **pendiente de autorización**, y **al autorizarla el súper-admin** sale con el mismo contenido.
    La bitácora (M10) registra **quién la preparó** y **quién la autorizó**. Verificable con dos ofertas: una
    debajo del tope (sale sola) y una arriba (espera). El **súper-admin oferta sin tope** y **el SPEI sigue
    siendo solo suyo** (criterio 26).
144. **La sugerencia de «no comprar» tiene un criterio explícito y sigue sin bloquear (D15)** *(ACTUALIZADO
    en la 3ª ronda por D29 — cambia la **posición** y el «o» pasa a **precedencia**; ver criterio 153)*: la
    mesa marca **«no comprar»** según la **posición de la variante**, que ahora suma **stock + verificando +
    tránsito + comprometido** (no solo «stock + en camino»), y **dice qué regla se disparó y con qué cifras**,
    desglosando los cuatro sumandos. Verificable en los dos disparadores por separado; y en ambos casos **el
    admin puede comprar igual, sin bloqueo ni permiso extra** (criterio 117).
145. **Terminal es terminal: ni se re-oferta ni se edita (respuestas a las preguntas 2 y 3)**: sobre una
    solicitud **`rechazada`**, **`expirada`** o **`abandonada`** **no existe** ninguna acción de «re-ofertar»;
    y sobre una oferta **ya enviada** **no existe** ninguna acción de «editar». La única vía es **cancelar y
    emitir una oferta nueva** (correo nuevo, plazo desde cero, **auditado**). Verificable: ambas acciones no
    existen en la UI **y** son rechazadas si se intentan directo contra el servidor.
146. **Aceptar exige sesión iniciada (respuesta a la pregunta 7)**: el enlace del correo **lleva** al portal,
    pero la aceptación **solo se ejecuta con la sesión del dueño de la solicitud**. Verificable: abrir el
    enlace **sin sesión** no acepta nada (pide iniciar sesión), y **un tercero con el correo reenviado no
    puede aceptar** la oferta de otro.

**Ciclo de adquisición del buylist — 3ª ronda: los cuatro números y el rechazo parcial (v2.1, D24–D29;
§P.2/§P.4/§P.5.1/§P.6/§P.10/§P.12/§P.13)**
> **⚠ Corregidos en la 4ª ronda (D30)**: el criterio **150** se **reescribió por completo** (el rechazo
> parcial ya no pregunta nada), el **151** se **reformuló** (su premisa desapareció) y el **127** —de la
> tanda anterior— cambió de fórmula. **Los demás de esta tanda siguen vigentes tal cual**, incluido el
> **152**, que D30 **confirma y no toca**.
147. **Tope de oferta del operador = MX$1,500 de bruto (D24)**: una oferta preparada por el **operador** cuyo
    **bruto** es **MX$1,500 o menos** **sale sola** (el correo se manda); una de **MX$1,501 o más** **no
    sale** y queda en la **cola de pendientes de autorización** hasta que el **súper-admin la autorice**, y al
    autorizarla sale **con el mismo contenido**. Verificable con las **tres cifras de borde**: **$1,499**
    (sale), **$1,500** (sale — el tope es **inclusivo**) y **$1,501** (espera). La bitácora (M10) registra
    **quién la preparó** y **quién la autorizó**, por separado. El **súper-admin oferta sin tope**.
148. **Override manual al ofertar: dentro del tope, con motivo obligatorio y auditado (D26)**: el operador
    puede **fijar a mano** el monto de una línea al ofertar. Verificable en cuatro puntos: **(a)** guardar el
    override **sin motivo** **no se puede** (el motivo es un campo obligatorio); **(b)** la bitácora guarda
    **quién**, **el monto derivado por la curva**, **el monto fijado a mano** y **el motivo**; **(c)** un
    override que empuja el **bruto** por encima de **MX$1,500** manda la oferta a **autorización del
    súper-admin** —**no es una puerta trasera al tope**—; **(d)** **después de enviado el correo NO existe**
    ninguna acción de override sobre esa oferta (criterio 119 intacto).
149. **Tarifa de envío del buylist = MX$180, congelada al ofertar (D25)**: en la banda con envío a nuestro
    costo, el correo de oferta anuncia **MX$180** de envío y **esa misma cifra** es la que se descuenta al
    pagar. Verificable en tres frentes: **(a)** si la etiqueta real costó **MX$260**, el vendedor **sigue
    recibiendo el mismo neto** y la diferencia queda como **gasto nuestro**; **(b)** si costó **MX$120**, el
    neto **tampoco cambia** y la diferencia es **margen nuestro**; **(c)** **cambiar el dial en M10 después
    de enviar la oferta NO cambia** el descuento de esa oferta (va congelado). Verificable además que
    **MX$180 (buylist) y MX$175 (retiro) son diales distintos**: mover uno **no** mueve el otro.
150. **Rechazo parcial: se paga lo aprobado y NO se le pregunta nada al vendedor (D30 — 4ª ronda; sustituye
    por completo la redacción de D27/D28)**: cuando al verificar se rechazan **algunas** cartas, cada una se
    **rechaza individualmente** con el **correo de rechazo por carta que ya existe**, **lo aprobado se paga al
    precio ofertado** (neto = `max(0, bruto aprobado − envío)`) y **las rechazadas se devuelven** según §H
    (**7 días a costo del usuario**, **abandono a 30 días**). Verificable **por lo que NO existe**: **no hay**
    pantalla, correo, estado ni plazo de *«¿quieres continuar?»*; **el ítem `ajustada` no se usa en ninguna
    parte del ciclo de buylist**; y **no existe ningún umbral** —ni configurable ni en código— que cambie el
    comportamiento según el tamaño del recorte. Verificable **con dos casos que deben comportarse IGUAL**:
    oferta de **MX$1,480** con bruto aprobado de **MX$900** (caída del **39%**) ⇒ se depositan **MX$720** sin
    preguntar; y la misma oferta con bruto aprobado de **MX$1,300** (caída del **12%**) ⇒ se depositan
    **MX$1,120** sin preguntar. Verificable también que **ningún monto unitario cambia** (criterio 119 intacto)
    y que **el vendedor nunca eligió líneas** (criterio 118 intacto): lo único que aceptó, y ya lo aceptó, es
    **el paquete completo con su condición NM** (criterio **161**).
    ~~**Redacción anterior (3ª ronda, D27/D28), RETIRADA**: caída de más de 20% ⇒ el SPEI no se ejecutaba y se
    le preguntaba al vendedor si quería continuar (ítem `ajustada` + plazo + aceptar/rechazar); caída ≤20% ⇒
    se pagaba. Bordes: exactamente 20% no preguntaba, 20.01% sí.~~
151. **El vendedor NUNCA queda debiendo, en ningún desenlace de la verificación (D17 + invariante 152)**
    *(⚠ **REFORMULADO en la 4ª ronda**: la redacción anterior —«si el vendedor dice que no al recorte, el
    envío de ida lo absorbemos»— **perdió su premisa**, porque con D30 **no existe ningún «no» del vendedor**
    después de verificar. La **protección** que ese criterio defendía **no se pierde: se reexpresa sin citar
    un flujo que ya no existe**.)*: verificable que **en los tres desenlaces posibles** la cuenta del vendedor
    **no muestra ningún adeudo** y **no existe ninguna acción de cobro** contra él —
    **(a)** **todo aprobado** ⇒ cobra `bruto − envío`;
    **(b)** **rechazo PARCIAL** ⇒ cobra `max(0, bruto aprobado − envío)`, **sin cargo por las rechazadas** y
    **sin cargo por el envío**;
    **(c)** **rechazo TOTAL** ⇒ cobra **MX$0**, **no debe nada** y **absorbemos la guía completa** (D17,
    criterio 140).
    En **(b)** y **(c)** el costo de la guía aparece como **gasto** en M7, **nunca** como costo de la pieza ni
    como saldo del vendedor. **No existe** ninguna ruta —UI, petición manipulada, override o cambio de
    diales— que produzca un adeudo, una retención o un descuento contra operaciones futuras.
    ~~**Redacción anterior (3ª ronda)**: rechazada la continuación, no se paga nada, las cartas se devuelven
    según §H y el envío de ida NO se le cobra, porque el rechazo fue decisión nuestra.~~
152. **INVARIANTE MONEY-SAFE — el NETO nunca es negativo, y nunca se le cobra al vendedor**: el depósito es
    siempre **`max( 0 , bruto aprobado − envío )`**. Verificable con el caso límite: oferta de **MX$1,480**,
    bruto aprobado **MX$100**, envío **MX$180** ⇒ el neto es **MX$0**, **no −MX$80**; **no se genera ningún
    cargo, adeudo ni saldo negativo** contra el vendedor, **no se retiene** contra operaciones futuras y la
    diferencia queda como **gasto nuestro**. Verificable además que **no existe ninguna ruta** —UI, petición
    manipulada, override o ajuste de diales— que produzca un neto negativo o un cobro al vendedor de una
    solicitud de buylist. **El peor caso posible para un vendedor es cobrar $0, nunca deber.**
153. **Tope general de piezas por variante = 10, con precedencia del bounty (D29)**: la mesa pinta **«no
    comprar»** cuando la **posición** de la variante —**stock + verificando + tránsito + comprometido**—
    llega a **10** **y la carta NO tiene bounty**. Verificable en cuatro casos: **(a)** carta **sin bounty**
    con posición **9** ⇒ **no** lo pinta; **(b)** la misma con posición **10** ⇒ **sí** lo pinta y **dice por
    qué**, desglosando los cuatro sumandos; **(c)** carta **con bounty vivo** y posición **10** ⇒ **NO** lo
    pinta (manda el bounty), y sí lo pinta al **alcanzar el objetivo del bounty**; **(d)** en **todos** los
    casos el admin **puede comprar igual, sin bloqueo** (criterio 117). Verificable además que la posición
    **suma los cuatro sumandos** —una línea **ofertada y aceptada pero no enviada** **sí** cuenta para el
    tope— **sin** alterar la cifra de **«en camino» que se muestra**, que sigue contando **solo
    `en_transito`** (criterio 116).
154. **«Día hábil» tiene una definición única (respuesta a la pregunta 15)**: **lunes a viernes**, excluyendo
    los **festivos oficiales de México**, en zona horaria **`America/Mexico_City`**. **El sábado no cuenta.**
    Verificable: la **fecha límite del correo**, la que muestra **la pantalla del cliente**, la que usa el
    **barrido** y la que dispara el **recordatorio** son **exactamente la misma**, probado con un plazo que
    cruza **fin de semana** y otro que cruza **un festivo oficial**.
155. **Dos medidas del dinero del buylist, y ninguna sustituye a la otra (respuesta a la pregunta 14)**: el
    **tope por solicitud**, el **tope MENSUAL** y el **umbral de INE** se calculan sobre **BRUTOS**; el
    **acumulado de dinero pagado** que reporta **M7** se calcula sobre **NETOS**. Verificable con un usuario
    con varias solicitudes pagadas en el mes: el **acumulado que gobierna el tope** suma los **brutos**
    (descontar envíos **no** lo baja ni permite colarse bajo el tope) y el **reporte de caja** suma los
    **netos** (coincide **peso por peso** con los SPEI ejecutados).
156. **Un «ya lo mandé» sin confirmar se vuelve alerta a los 5 días hábiles (respuesta a la pregunta 17)**:
    pasado el dial (default **5 días hábiles**, editable en M10), la solicitud **se destaca como alerta** en
    la cola de **«por confirmar envío»**. Verificable que la alerta **no hace nada más**: **no expira**, **no
    cancela**, **no mueve el estado** y **no suma al conteo de «en camino»** (criterios 116 y 138 intactos).
157. **Los plazos se congelan por solicitud (respuesta a la pregunta 18)**: la fecha límite se **fija al
    comunicarse** —al enviar la oferta, al entregar la guía— y **un cambio posterior del dial en M10 no la
    mueve**, ni para acortarla ni para alargarla; **solo afecta a las solicitudes nuevas**. Verificable:
    con una oferta viva, bajar el plazo de 2 a 1 día **no adelanta** su vencimiento, y subirlo de 2 a 5
    **tampoco lo retrasa**; una solicitud creada **después** del cambio **sí** usa el valor nuevo. Aplica
    igual a la **tarifa de envío** congelada (criterio 149).
158. **Los bordes de las bandas son inclusivos y el mínimo no se re-aplica (respuesta a la pregunta 19)**:
    **(a)** una solicitud de **exactamente MX$500 SÍ se crea**; **(b)** una oferta de **exactamente MX$1,000
    SÍ lleva guía a nuestro costo**; **(c)** si se cotizaron **MX$600** y tras el cherry-pick el **bruto
    ofertado** queda en **MX$200**, **la oferta sale igual** —el mínimo **gatea la creación de la solicitud,
    no la oferta**— y **no hay bloqueo** por ese motivo.
159. **Recordatorio: uno POR PLAZO, cada uno una sola vez (respuesta a la pregunta 21)**: hay **dos plazos**
    (aceptar y enviar), así que un ciclo puede generar **hasta dos** recordatorios. Verificable: **(a)** una
    solicitud que recorre los dos plazos recibe **exactamente dos** correos de recordatorio, uno por plazo;
    **(b)** corriendo el barrido **tres veces** dentro de cada ventana **no se manda ninguno de más**;
    **(c)** el que llega es el del plazo **que está corriendo**, a **un día hábil** de vencer.
160. **El inventario ya capturado se corrige a mano; ninguna migración adivina (respuesta a la pregunta 11)**:
    la separación de identidad de **promos y exclusivos de deck** (D7, §P.8) **no se aplica retroactivamente
    de forma automática** a las filas ya capturadas: se **reclasifican manualmente desde M1**. Verificable:
    **no existe** ningún proceso, script ni botón que reasigne identidad de piezas históricas por inferencia;
    y **sí existe** en M1 la vía para corregir a mano la identidad de una pieza ya capturada, **quedando
    auditada** (M10).

**Ciclo de adquisición del buylist — 4ª ronda (CORRECTIVA): la condición va al frente, no la pregunta al
final (v2.1, D30; §E/§H/§P.3/§P.5.1/§P.6/§P.10/§P.11)**
161. **El correo de oferta declara la condición NM LÍNEA POR LÍNEA, y eso es lo que el vendedor acepta
    (D30)**: el correo de oferta contiene, **por cada línea comprada**, el texto de la condición —**«siempre
    que llegue en Near Mint»**— junto a su monto, y **una sola vez**, de forma destacada, **qué pasa con la
    que no cumpla**: **no se compra**, **no se paga** y **se devuelve** (7 días a costo del vendedor, abandono
    a 30 días). Verificable en cuatro puntos:
    **(a)** el correo de una oferta de **3 líneas** muestra la condición **en las 3**, no solo en un pie de
    página;
    **(b)** el correo dice explícitamente que **el rechazo de una línea NO cancela la compra de las demás** y
    que **no se reprecia ninguna** (D9);
    **(c)** ese correo sale **ANTES de que exista guía** —la etiqueta se compra al aceptar (D21)—, de modo que
    el vendedor **acepta la condición antes de que gastemos en envío y antes de que él empaque**;
    **(d)** la **pantalla de aceptación** muestra la misma condición que el correo, **palabra por palabra**:
    no se puede aceptar sin haberla tenido enfrente.
    Consecuencia verificable aguas abajo: **por eso** el rechazo parcial **no vuelve a preguntar nada**
    (criterio **150**).

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
  (§O.5), **exclusión explícita de garantía de grado** (Fuera de alcance) y **feature-flag apagado hasta la
  aprobación del texto**. *(Refuerzo 2026-08-28: con la fuente automática, la cifra son **ventas cerradas
  reales de eBay por grado**, no una valuación nuestra — el disclaimer describe la realidad al pie de la
  letra, lo que mejora la posición.)* **Validar con abogado**: (a) que el **texto del disclaimer** (borrador
  en §O.5) sea suficiente y esté también en **términos/políticas**, (b) que el estimado **no cree derecho** a
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
- **CONFLICTO CONOCIDO — D20 × D4: el reloj del vendedor contra nuestra carga de trabajo** *(2ª ronda v2.1,
  §P.13)*: **D20** pone la marca de **`en_transito`** en manos del **operador** y **D4** expira la solicitud
  si el paquete no sale en el plazo. Si el vendedor deposita **el día 3** y el operador **no confirma hasta
  el día 4**, el barrido expiraría una venta donde **el vendedor sí cumplió** —y, con guía nuestra, además
  perderíamos la etiqueta—. **Dirección aprobada, ya redactada como requisito de negocio en §P.13**: se
  **separa el reloj del estado** (el vendedor tiene un **«ya lo mandé»** que **detiene el reloj** sin mover
  el estado; el **operador confirma** y eso mueve a `en_transito`; el barrido **solo expira** si no hubo
  ninguna de las dos). **Mitigación DECIDIDA en la 3ª ronda (P17)**: un **«ya lo mandé» sin confirmar** se
  **destaca como alerta** en la cola de «por confirmar envío» a los **5 días hábiles** (dial de M10). La
  alerta **no expira ni cancela nada** —el pendiente es nuestro, no del vendedor—; solo lo **hace visible**.
  **Queda como riesgo residual aceptado**: mientras nadie confirme, el conteo de **«en camino»** de la mesa
  de decisión (§P.2) **se queda corto** y podríamos **comprar de más**. Es el **lado seguro del error**
  (corto, no inflado) y ahora tiene **quien lo levante**; **no hay acción pendiente del humano**.
- **Dinero — el envío gratis es una superficie de abuso nueva** *(2ª ronda v2.1, D16/D17)*: arriba del umbral
  ponemos **una etiqueta a nuestro costo antes de ver la mercancía**, y si **todo se rechaza** la absorbemos
  (D17, decisión tomada y correcta para el vendedor honesto). El caso que hay que vigilar es el **vendedor
  repetido** que acepta ofertas, cobra la guía y manda cartas que **nunca pasan NM**: cada ciclo nos cuesta
  una etiqueta. **Estado tras la 4ª ronda**: la **parte de dinero** de la pregunta 16 quedó **cerrada**
  (~~D27/D28~~ **D30** + el **piso de cero** del criterio 152), pero **el límite anti-abuso NO se decidió**.
  *(D30 **no mueve este riesgo**: el costo del ciclo abusado sigue siendo **una etiqueta de MX$180**. Lo único
  que cambia es que **ya no existe** la variante en la que el abusivo, además, contesta que **no** y nos
  obliga a devolver todo.)* **Resolución
  por omisión, registrada aquí a propósito**: **el MVP NO impone ningún tope de guías por usuario/periodo**;
  se **vigila a mano** al arrancar. **No se inventa alcance** para taparlo — es un riesgo **conocido,
  cuantificado (una etiqueta de MX$180 por ciclo abusado) y aceptado**. Si el humano prefiere un tope
  automático, es **alcance nuevo** y hay que pedirlo explícitamente.
- **Dinero — el envío absorbido en el rechazo parcial** *(3ª ronda v2.1; **actualizado en la 4ª: D30 +
  invariante del criterio 152**)*: con el **piso de cero**, una operación puede terminar con el vendedor
  cobrando **MX$0** y nosotros **de MX$180 abajo** más las cartas de regreso. Es la decisión correcta
  —**jamás se le cobra a alguien por habernos mandado cartas**— y su costo está acotado; se registra para que
  **M7 lo muestre como gasto** y no se descubra como sorpresa contable. *(4ª ronda: **el importe expuesto no
  cambia**; lo que cambia es que ese desenlace ahora ocurre **directamente al verificar**, sin esperar la
  respuesta de nadie.)*
- **Expectativa del vendedor — la condición NM tiene que leerse, no solo estar escrita** *(NUEVO 4ª ronda
  v2.1, D30)*: al retirar la re-confirmación, **todo el peso de la equidad recae en que el vendedor entendió
  la condición cuando aceptó**. El requisito ya la exige **por línea** en el correo y **palabra por palabra**
  en la pantalla de aceptación (criterio **161**), pero **cómo se redacta y se destaca ese texto es trabajo de
  ux-ui y del contenido legal**, no de software: un vendedor que se sienta sorprendido al recibir MX$720 de
  una oferta de MX$1,480 es **una disputa y una reseña mala**, aunque tengamos razón. **Bandera, no bloqueo**:
  conviene revisar la redacción de ese correo con quien vea los términos antes de operar con público.
- **Operativo/contractual — la etiqueta debe poder cancelarse** *(2ª ronda v2.1, D22)*: la regla de que
  **compramos guías cancelables o reembolsables** es una **restricción sobre con qué paquetería trabajamos**,
  no un ajuste de software. Conviene **confirmarla con la paquetería antes de operar**: si la etiqueta que
  compramos no se puede cancelar ni reembolsar, la tarea de la cola (criterio 139) queda sin efecto real y
  **cada oferta aceptada que no se envía es dinero perdido**.

## Métricas de éxito del MVP / definición de "lanzado"
El MVP se considera "lanzado" cuando, en una **beta cerrada**, se cumple en un periodo de **30–60 días**:
- **N** usuarios activos en la beta cerrada. *(N: PENDIENTE de fijar por el humano.)*
- **X** ventas completadas (pago `settled`). *(X: PENDIENTE de fijar por el humano.)*
- **Y** solicitudes de buylist aprobadas y pagadas. *(Y: PENDIENTE de fijar por el humano.)*
- **Z** retiros enviados sin disputa. *(Z: PENDIENTE de fijar por el humano.)*
- El back-office opera el ciclo completo (compra → bóveda → retiro y **cotización → oferta → aceptación →
  guía (nuestra) → envío confirmado → recepción → verificación → pago → publicación** *(actualizado 2ª ronda
  v2.1, §P)*) sin intervención fuera de la herramienta — salvo la **compra material de la etiqueta**, que por
  D19 se hace **fuera del sistema** a propósito.

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
   (`contacto@tcgvaultmx.com`) para revender fuera de la app.
37. **Condición del sellado**: default **Mint**, opción **"Detalle menor en caja"**; visible al comprador,
   **sin efecto en el precio**; el sellado **no lleva rareza**.
38. **Destino igual que cartas** (recibir/`direct_ship` o bóveda/`vault`), **pestaña "Sellado"** en bóveda
   del cliente y vista admin, y **entra en la valuación/tendencia del portafolio**.
39. **Diferenciadores cableados pero apagados** (feature-flag off): **tendencia de valor del sellado** y
   **"avísame cuando vuelva" (restock)**; se encienden después sin nuevo desarrollo.

**Decisiones v2.0 — gancho de grading (2026-08-23, tomadas por el humano):**
40. **Alcance completo, tres superficies**: **ficha** + **badge en las tejas de Compra** + **vitrina «Joyas
   para gradear» en el home**. No es una prueba en una sola pantalla. Ver §O.3. *(ACTUALIZADO 2026-08-23 — ver
   decisión 50: la ficha deja de ser un «bloque comparativo» y pasa a mostrar solo precio + PSA 10 + PSA 9.
   ACTUALIZADO 2026-08-28 — ver decisión 54: en rejilla y vitrina **se pinta la cifra**, condicionada al gate
   de confianza.)*
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
   dato**. Los criterios de este bloque son ahora los **97–112**.
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

**Decisiones v2.1 — ciclo de adquisición del buylist (2026-08-31, tomadas por el humano; D1–D12, ver §P):**
56. **D1 — La oferta es TODO-O-NADA**: el cliente ve el **desglose línea por línea** (qué compramos y qué no)
   pero **acepta o rechaza el paquete completo**. **No hay aceptación parcial** ni contraoferta. Razón: media
   compra deja al vendedor mandando un paquete por un monto que ya no es el que aceptó.
57. **D2 — El precio ofertado es VINCULANTE desde que sale el correo**: a partir de ese instante no se mueve
   —ni por el mercado, ni al recibir, ni al verificar—. Es nuestra palabra por escrito.
58. **D3 — Plazo de respuesta: 2 días**. Sin respuesta del cliente en el plazo, la solicitud queda
   **`rechazada`** y la oferta deja de ser válida. *(Precisado por **D14**: se cuentan en **días hábiles**.)*
59. **D4 — Plazo de guía: 3 días desde la aceptación** para capturar paquetería y número de rastreo. Sin guía
   en el plazo, la oferta **`expira`**, la solicitud **se cancela** y **se le notifica** al vendedor.
   *(Precisado por **D14/D21**: son **días hábiles** y corren **desde que la guía llega al vendedor**; lo que
   se espera ya no es «que capture la guía» sino **que el paquete salga**.)*
60. ~~**D5 — La guía la captura el CLIENTE** desde su portal, con el **admin como respaldo**~~ — **SIN EFECTO
   desde la 2ª ronda (D16/D19/D20)**: la guía **la ponemos nosotros**, la **compra y captura el operador**, y
   **el portal del cliente ya no tiene captura de guía**. Se conserva el texto original como historial:
   *«la guía la captura el CLIENTE desde su portal, con el admin como respaldo (para el vendedor que manda el
   número por otro canal); cuando la captura el admin, queda registrado quién fue»*.
61. **D6 — Recomendación de compra que NUNCA bloquea**: al ofertar, el admin ve por cada carta **cuántas
   tiene en inventario** y **cuántas vienen en camino**, más una **sugerencia de comprar / no comprar**. La
   sugerencia **informa**, no autoriza: **la decisión es del operador, línea por línea**.
62. **D7 — Producto separado**: se cura el hueco de identidad por el que **promos y exclusivos de deck**
   entran a inventario **indistinguibles del set base**. Sin esto, los conteos de la mesa de decisión (D6)
   mienten y la publicación/valuación tratan como igual lo que no lo es. Ver §P.8.
63. **D8 — Los dos plazos son DIALES editables** desde el back-office (**M10**), sin redeploy y auditados; no
   constantes en código.
64. **D9 — El precio de compra es el pactado en la oferta, y punto**: es la **fuente única del costo de
   adquisición**. Consecuencia directa: **verificar tiene solo dos desenlaces** —**NM ⇒ se paga lo ofertado**
   o **no-NM ⇒ se rechaza**—. **Desaparece el repreciado al recibir.**
65. **D10 — El precio de VENTA queda fuera de este alcance**: lo resuelve la **curva de pricing que ya
   existe** (§N.1) al publicar. El ciclo de adquisición **no captura precios de venta**.
66. **D11 — Celular obligatorio en tres puntos**: **al registrarse**, en el **alta de usuario por admin** y
   **antes de crear una solicitud de venta**. El tercero es el que cierra los huecos reales: las cuentas
   creadas con **Google** y las cuentas viejas con el campo vacío.
67. **D12 — Cotizaciones abiertas visibles y llamables**: el back-office debe poder ver **qué usuarios tienen
   solicitudes vivas y cuántas**, y **llamarlos** — el **teléfono viaja en la cola de buylist**.

**Decisiones v2.1 — segunda ronda del humano (2026-08-31; D13–D23, ver §P.4/§P.12/§P.13):**
> Estas once **corrigen cuatro supuestos** del primer pase. Donde una decisión nueva pisa a una vieja, se
> dice **cuál** y **por qué** — el historial no se borra.
68. **D13 — El operador SÍ puede ofertar, hasta un tope de monto** *(CORRIGE el supuesto de la pregunta 1:
   «solo el súper-admin»)*: ofertar compromete un pago vinculante, así que se gobierna **reusando la mecánica
   de topes que el buylist ya tiene**: el operador oferta hasta su tope (medido sobre el **BRUTO**) y **por
   encima lo autoriza el súper-admin**. El **pago SPEI sigue siendo exclusivo del súper-admin**.
69. **D14 — Los plazos se cuentan en DÍAS HÁBILES** *(CORRIGE el supuesto de la pregunta 4: días naturales)*:
   una oferta enviada el **viernes no vence el domingo**. Aplica a los dos plazos del ciclo.
70. **D15 — Qué dispara el «no comprar»** *(responde la pregunta 9)*: la sugerencia se dispara cuando la
   posición alcanza el **objetivo del bounty** de la variante **o** un **tope general de piezas por
   variante**, ambos **configurables**. **Nunca bloquea** — D6 queda intacta.
71. **D16 — LA GUÍA LA MANDAMOS NOSOTROS y se descuenta del pago** *(CORRIGE el supuesto de la pregunta 5 y
   DEJA SIN EFECTO a D5: el cliente ya no captura la guía)*. Consecuencias, todas cerradas:
   **(a)** el pago pasa a ser **`ofertado − envío = neto`**;
   **(b)** el **correo de oferta muestra los TRES montos** (bruto, envío, neto) y dice **cuál se deposita** —
   anunciar **$1,480** y depositar **$1,350** rompe la confianza que la oferta vinculante venía a construir;
   **(c)** **lo vinculante frente al vendedor es el NETO**, mientras que el **costo de adquisición del
   inventario sigue siendo el BRUTO** (lo que valió la carta): **el envío es gasto operativo y NO forma parte
   del costo de la pieza** — si se mezclan, **se ensucia el P&L por carta**;
   **(d)** los **topes AML/INE se juzgan sobre el BRUTO** (el valor comprometido) aunque **el SPEI salga por
   el NETO** *(refina la pregunta 8)*.
72. **D17 — Si al verificar se rechaza todo, absorbemos el envío**: **sin cobranza al vendedor** y **sin saldo
   negativo**. El peor caso para él es **cobrar $0**, nunca **deber**.
73. **D18 — Mínimo de compra: MX$500**: por debajo **no se crea la solicitud**. Aplica al **TOTAL** de la
   solicitud —**una carta o mil**—, se **valida en el servidor** (no solo en el cotizador) y el cotizador
   **dice cuánto falta** (*«te faltan $120»*).
74. **D18b — Umbral de guía: MX$1,000**, **dial SEPARADO** del mínimo. Quedan **tres bandas**: **&lt;$500 no
   se compra**; **$500–$1,000 se compra y el vendedor paga su envío** como hoy; **&gt;$1,000 se compra y
   nosotros ponemos la guía**.
75. **D19 — La guía se genera A MANO**: el operador la compra **fuera del sistema** y **captura el número**.
   **No hay integración con paquetería** y **no entra en este alcance** (es **proyecto aparte**). El sistema
   **solo guarda y muestra**.
76. **D20 — Quién marca «en tránsito»: el operador**, al **confirmar el envío**. *(Ver el conflicto con D4 y
   su resolución en §P.13 y en «Riesgos y banderas».)*
77. **D21 — La guía se compra AL ACEPTAR, no al ofertar**: solo se gasta etiqueta en quien **ya dijo que sí**.
   El correo de oferta **anuncia** que el envío corre por nuestra cuenta y que **la guía llega al aceptar**, y
   **los 3 días de D4 corren desde que la guía LLEGA al vendedor**, no desde que aceptó.
78. **D22 — Guía no usada**: la etiqueta debe ser **cancelable o reembolsable**, y el **vencimiento de una
   solicitud con guía emitida** deja la tarea **«cancelar guía no usada»** en la **cola del operador**.
79. **D23 — Recordatorio: SÍ va** *(REVIERTE la decisión del primer pase de dejar los recordatorios fuera de
   alcance — pregunta 6)*: **uno solo**, a **un día hábil** de vencer y **una sola vez** (no en cada corrida
   del barrido). Los correos obligatorios del ciclo pasan a ser **tres**: **oferta**, **recordatorio** y
   **expiración**.
80. **Cierre de seis preguntas abiertas del primer pase (respuestas del humano, 2026-08-31)**:
   **(P2)** **NO se re-oferta** sobre una solicitud rechazada o expirada — son **terminales**; si el cliente
   quiere, **cotiza de nuevo**.
   **(P3)** **NO se edita** una oferta ya enviada — se **cancela y se emite otra** *(el supuesto del primer
   pase era correcto)*.
   **(P6)** los **correos obligatorios son tres**: **oferta**, **recordatorio** (D23) y **expiración**.
   **(P7)** **aceptar exige sesión** — **no hay enlace anónimo** de aceptación.
   **(P10)** **«solicitud viva» = todo lo que NO sea terminal**; **terminales**: **`pagada`, `rechazada`,
   `abandonada`, `expirada`**.
   **(P12)** la **ubicación NO se exige al convertir** —bloquear la conversión por falta de ubicación
   **atoraría el flujo de pago**—, pero la pieza sin ubicación **sale señalada** en la cola de piezas listas
   para publicar.

**Decisiones v2.1 — tercera ronda del humano (2026-08-31; D24–D29, ver §P.2/§P.4/§P.5.1/§P.6/§P.10/§P.12):**
> Estas seis **fijan los cuatro números** que faltaban y **deciden el rechazo parcial**. Con ellas el bloque
> v2.1 queda cerrado. Donde una decisión pisa un supuesto previo, se dice **cuál** y **por qué**.
81. **D24 — Tope de oferta del operador: MX$1,500** *(fija el número que faltaba en D13 y **descarta** el
   default money-safe de **MX$0** que este documento había propuesto)*: medido sobre el **BRUTO**. Por encima
   de ese monto, **la oferta requiere autorización del súper-admin** —o sea **espera en cola**, no se bloquea
   en seco—, y la bitácora guarda **quién preparó** y **quién autorizó**. **Cierra la pregunta 13.**
82. **D25 — Tarifa de envío del buylist: MX$180, congelada al ofertar** *(**resuelve la tensión D16×D21** que
   este documento había señalado sin resolver)*: es la salida correcta **justo por la razón que se dio** —
   cualquier otra **rompe que el neto sea vinculante**. Si la etiqueta real sale **más cara, absorbemos la
   diferencia**; si sale **más barata, es margen nuestro**. **Es un dial** de M10, y es **distinto** de la
   tarifa de envío de retiro (**MX$175**). **Cierra la pregunta 20.**
83. **D26 — Override manual al ofertar: SÍ** *(cierra la pregunta 22)*: el operador puede **ajustar a mano el
   precio de una línea**, **dentro de su tope** (D24), y queda **auditado con tres datos**: **quién**,
   **cuánto** y **motivo obligatorio**. Un override es, en los hechos, **ofertar un número a mano**, así que
   **no puede saltarse el tope**: si empuja el bruto arriba de MX$1,500, la oferta **pasa a autorización**.
   El override existe **solo antes de emitir la oferta** — **D9 sigue intacta: no hay repreciado al recibir**.
84. **⚠ D27 — SUPERADA por D30 (4ª ronda). Se conserva como historial, no como requisito.**
   ~~**Rechazo PARCIAL: se le pregunta al vendedor si quiere continuar**, **antes de pagar**, y se
   **REUSA el flujo de ajuste que ya existe** (ítem **`ajustada`** + plazo + aceptar/rechazar del cliente):
   **no es un mecanismo nuevo**. **No es aceptación parcial** —sigue siendo **todo-o-nada sobre el paquete
   reducido**, D1 intacta— ni repreciado —**ningún monto unitario se mueve**, D9 intacta—: lo que se confirma
   es el **ALCANCE**. **Si dice que no**: corre la **devolución vigente de §H** (7 días a su costo, abandono
   a 30) **pero el envío de ida lo absorbemos nosotros**, porque **el rechazo fue decisión nuestra**
   (coherente con D17).~~ **Motivo del retiro (decisión 89)**: la pregunta llegaba **con la etiqueta ya
   comprada y las cartas ya en la bóveda**, donde **ninguna respuesta era buena**, y **obligaba a inventar un
   plazo nuevo**. **La pregunta 16 sigue cerrada en su parte de dinero**, ahora por **D30 + criterios
   150/151/152**.
85. **⚠ D28 — SIN OBJETO por D30 (4ª ronda). El dial del 20% se retira.**
   ~~**Qué cuenta como «material»: una caída de MÁS de 20% del bruto**: solo se pregunta si el **bruto
   aprobado** cae **más de 20%** respecto al **bruto ofertado**. Por debajo (o exactamente en el 20%) **se
   procede y se paga**, y el **correo de rechazo por carta que ya existe** lo mantiene informado.
   **Preguntar por una común de $2 en una oferta de $1,480 es fricción pura.** **El umbral es un dial.**~~
   **Motivo**: D28 existía **solo** para calibrar la pregunta de D27. **Sin pregunta, no hay umbral que
   calibrar.** Los diales del ciclo pasan de **nueve a ocho** (§P.10, criterio 127).
86. **D29 — Tope general de piezas por variante: 10** *(fija el número que faltaba en D15)*: cuando la
   **posición** de esa variante —**stock + verificando + tránsito + comprometido**— llega a **10 piezas** y
   la carta **NO tiene bounty**, se pinta la sugerencia de **«no comprar»**. **Sigue sin bloquear** (D6
   intacta). **⚠ Dos cambios que este documento señala**: **(a)** la **posición se cuenta más ancha** que el
   *«stock + en camino»* que yo había escrito —ahora incluye lo **comprometido** y lo que está **en
   verificación**—, sin alterar la cifra de **«en camino» que se muestra** (§P.2, criterio 116); **(b)** los
   dos disparadores de D15 dejan de ser un **«o»** y pasan a ser una **precedencia**: **con bounty manda el
   bounty**, y el tope general **solo aplica sin bounty**.
87. **INVARIANTE money-safe explícito — el NETO nunca puede ser negativo** *(3ª ronda; criterio 152)*: si el
   **bruto aprobado** queda por debajo de la **tarifa de envío** (ofertaste $1,480, apruebas $100, envío
   $180 ⇒ −$80), el neto **se topa en cero** y **absorbemos la diferencia**. **Jamás se le cobra al vendedor
   por habernos mandado cartas.** Aplica al **rechazo total y al parcial**, y **no admite excepciones**.
   **Este invariante lo confirma y lo deja intacto la 4ª ronda (D30).**
   ~~Nota de coherencia (3ª ronda): con los diales de hoy, el piso de cero **solo puede activarse en un caso
   donde ya le preguntamos** (llegar a él exige una caída >80%, muy por encima del 20% de D28).~~
   **⚠ Nota de coherencia REEMPLAZADA (4ª ronda)**: **ya no hay pregunta**, así que la garantía no es *«cuando
   el piso se activa, ya preguntamos»* sino ésta, más simple y **verificable con los diales que quedan**: **el
   piso de cero nunca se activa en una operación con TODO aprobado**, porque la **tarifa de envío es
   estrictamente menor que el umbral de guía** (MX$180 < MX$1,000) y ese umbral es **inclusivo**. **M10
   protege esa relación con una validación bloqueante** (§P.10, criterio 127).
88. **Cierre de las siete preguntas restantes (respuestas del humano, 2026-08-31, 3ª ronda)**:
   **(P11)** el **inventario ya capturado** sin eje de producto separado se corrige **a MANO**; **ninguna
   migración adivina** *(supuesto confirmado)*.
   **(P14)** el **tope de compromiso** (por solicitud y **mensual**) usa **BRUTOS** —es el valor
   comprometido, misma base que AML/INE—; el **acumulado de dinero pagado** usa **NETOS** —es lo que
   realmente salió por SPEI—. **Son dos medidas distintas y ambas conviven.**
   **(P15)** **«día hábil» = lunes a viernes**, excluyendo **festivos oficiales de México**, en zona horaria
   **`America/Mexico_City`** (la que el proyecto ya usa para fechas) *(supuesto confirmado; el sábado no
   cuenta)*.
   **(P17)** un **«ya lo mandé» sin confirmar** es un **dial**, default **5 días hábiles**; pasado eso la
   solicitud **se destaca como alerta** en la cola de «por confirmar envío». **No infla** la cifra de «en
   camino», porque el «ya lo mandé» **no mueve el estado** — solo **detiene el reloj**.
   **(P18)** **se respetan las fechas ya comunicadas**: el plazo **se congela por solicitud** en el momento en
   que se fija, y cambiar el dial **solo afecta a las solicitudes nuevas** *(supuesto confirmado y
   reforzado)*.
   **(P19)** **$500 inclusivo** (una solicitud de exactamente $500 **sí** se crea) y **$1,000 inclusivo** (una
   oferta de exactamente $1,000 **sí** lleva guía) *(**corrige** mi supuesto, que hacía **estricto** el umbral
   de guía)*; y si tras el cherry-pick el bruto ofertado cae por debajo del mínimo, **el mínimo NO se
   re-aplica**: **gatea la creación de la solicitud, no la oferta**.
   **(P21)** el recordatorio es **uno POR PLAZO**. Hay **dos plazos** (aceptar y enviar), así que puede haber
   **hasta dos** recordatorios en el ciclo, **cada uno una sola vez** *(supuesto confirmado)*.

**Decisiones v2.1 — cuarta ronda del humano (2026-09-01; D30, CORRECTIVA — supersede D27 y deja D28 sin
objeto; ver §E/§H/§P.3/§P.5.1/§P.6/§P.10/§P.11):**
> Una sola decisión, pero **corrige un planteamiento de raíz**, no un número. Se deja **explícito qué se
> retira, por qué, y qué NO se toca**.
89. **D30 — La oferta es CONDICIONAL desde el principio: la condición va al frente, no la pregunta al final.**
   **Qué estaba mal (lo detectó el humano)**: D27 preguntaba *«¿quieres continuar?»* cuando se rechazaban
   algunas cartas. Esa pregunta **llega en el peor momento posible** —**ya compramos la etiqueta y ya tenemos
   sus cartas en la bóveda**— y **ninguna respuesta es buena**: si dice que **no**, hay que **devolver todo y
   comernos el envío de ida**; si **no contesta**, quedan **cartas ajenas atoradas sin regla clara**. Encima
   **obligaba a inventar un plazo nuevo** (la pregunta abierta 23). Y era **redundante**: montaba **una
   segunda confirmación sobre un trato que ya era condicional**.
   **Qué se decide**: **la oferta es condicional por naturaleza y eso se DECLARA en el correo de oferta**,
   **línea por línea** — *«compramos estas N a estos precios, **siempre que lleguen en Near Mint**; la que no
   llegue en NM **no se compra** y **se te devuelve**»*. El vendedor acepta **ese** trato, **con su riesgo
   incluido**, **antes de que compremos la etiqueta y antes de empacar nada**. Al verificar **el trato no
   cambió**: se **cumplió una condición ya escrita y aceptada**, así que **no hay nada que re-preguntar**.
   **Encaja con lo que el documento ya exigía**: la política **solo-NM** ya era requisito central y visible en
   el cotizador, la guía de envío y los términos (§H); lo que D30 agrega es **hacerla explícita y por línea en
   el documento que el vendedor acepta**.
   **Qué pasa cuando algunas cartas fallan NM**: se rechazan **una por una** con el **correo por carta que ya
   existe**, se paga **lo aprobado al precio ofertado** y las rechazadas siguen la **regla de devolución
   vigente** (§H: 7 días a su costo, abandono a 30). **Sin estado nuevo, sin plazo nuevo, sin pregunta.**
   **Qué se RETIRA**: **(a)** el flujo de re-confirmación de §P.5.1 (**D27 superada**); **(b)** el uso del
   ítem **`ajustada`** en el ciclo de buylist; **(c)** el **dial del umbral de recorte material** (**D28 sin
   objeto**) — los diales del ciclo pasan de **nueve a ocho**; **(d)** el posible **cuarto correo** y **quinto
   plazo** del ciclo, que nunca llegaron a existir; **(e)** la **pregunta abierta 23**, **cerrada por
   eliminación**.
   **Qué NO se toca (a propósito)**: **el NETO nunca es negativo** (criterio **152**) y **si se rechaza TODO,
   absorbemos el envío** (**D17**, criterio **140**). **Ninguna de las dos dependía de la pregunta**, así que
   el vendedor **no pierde ninguna protección**. Tampoco se toca **D1** (todo-o-nada al aceptar), **D2** (el
   precio ofertado es vinculante) ni **D9** (no hay repreciado) — de hecho **D9 recupera su alcance completo**
   (criterio 124).
   **Efecto colateral que este documento había detectado y ahora resuelve**: la **validación entre diales**
   del criterio **127** citaba `umbral de guía × (1 − umbral de pregunta)` = **MX$800**. **Al desaparecer el
   umbral de pregunta esa fórmula se quedó sin base.** **Decisión: se REFORMULA, no se retira** —la propiedad
   money-safe merece protección, solo que la relevante es otra—: **la tarifa de envío del buylist debe ser
   estrictamente menor que el umbral de guía** (hoy **MX$180 < MX$1,000**), porque el umbral es **inclusivo**
   y si la tarifa lo igualara **una operación con todo aprobado depositaría MX$0**. *(**SUPUESTO**: sin
   colchón adicional — **pregunta abierta 24**, no bloqueante.)*

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
> Las **decisiones de fondo están cerradas** (alcance de tres superficies, gate sobre PSA 9, los dos diales y
> sus defaults, la fuente automática del dato, el gate de confianza, la guarda de dinero y la regla money-safe;
> ver decisiones 40–45 y 53–55). Lo que sigue son **el texto del disclaimer** —que necesita aprobación
> explícita y **mantiene la feature apagada** hasta que llegue— y **huecos menores**, todos con un supuesto ya
> redactado en §O para **no bloquear** al arquitecto.

1. **Texto del disclaimer (la más importante — es legal-comercial, y hoy es lo único que bloquea encender la
   feature)** — *ACTUALIZADA 2026-08-28*: el humano pidió que fuera **«súper enfático que es información
   ilustrativa, que no refleja el estado de nuestras cartas»**, y §O.5 ya está **reescrita** con ese tono y con
   los **seis elementos obligatorios** (incluido el nuevo y más importante: **no evaluamos la condición de la
   pieza que vendemos**). *(Novedad que juega a favor: al pasar a la fuente automática, la cifra son **ventas
   cerradas reales de eBay por grado**, así que la frase «dato de referencia de mercado sobre ese modelo ya
   gradeado por terceros» es ahora **literalmente exacta**. El texto **no cambió**; solo es más defendible.)*
   **Falta tu visto bueno final** sobre el texto ES/EN ya redactado: ¿lo apruebas tal cual, lo ajustas, o lo
   pasas antes por **revisión legal**? ¿Quieres además que el mismo texto viva en la **página de
   términos/políticas**? **Mientras no lo apruebes, el feature-flag sigue apagado.**
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
7. **Umbral de frescura y CONTRA QUÉ FECHA se mide** — *ACTUALIZADA 2026-08-28*: el umbral sigue siendo
   **30 días** (sin cambio). Lo que la fuente automática abre es **contra qué fecha** se mide: el supuesto es
   que para el **dato automático** se mide contra la **fecha de la última venta de la muestra** —la antigüedad
   de la **evidencia de mercado**, que es la que de verdad importa, no la fecha en que jalamos el archivo— y
   para un **override manual**, contra la fecha en que lo fijaste. ¿Confirmas? ¿Y 30 días te parece bien, o
   prefieres 7/14?
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
18. **¿Mostrar el número de ventas de la muestra?** *(NUEVA, 2026-08-28)*: hoy el supuesto es **NO** —el
    tamaño de la muestra es un insumo interno del gate y no se pinta ni viaja al cliente, para no ampliar la
    superficie visible que tú mismo mandaste simplificar—. Pero decir *«basado en 12 ventas reales»* sería una
    señal de credibilidad fuerte y coherente con el disclaimer. ¿Lo dejamos fuera (supuesto) o lo quieres?
19. **Carta con slab real publicado: ¿enlazar a la pieza en vez de callar ese grado?** *(NUEVA, 2026-08-28)*:
    cuando bloqueamos el estimado PSA 10 porque **ya tenemos una PSA 10 real a la venta**, la ficha del raw
    simplemente **no muestra ese grado**. Podría ser mejor negocio **enlazar a la pieza real** («¿la quieres ya
    gradeada? tenemos esta»). Hoy queda **fuera de alcance** por no inventar superficie nueva. ¿Te interesa
    para el MVP o lo dejamos para después?
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

## Preguntas abiertas — ciclo de adquisición del buylist (v2.1, §P)
> **Historial completo, con estado de cierre.** Las **doce decisiones originales (D1–D12)**, las **once de la
> segunda ronda (D13–D23)**, las **seis de la tercera (D24–D29)** y la **correctiva de la cuarta (D30)** están
> cerradas y ya redactadas en §P, §E y §H; **no se re-litigan**. Abajo se conservan **las veintitrés preguntas
> con su desenlace** —qué se cerró, con qué decisión y si **corrigió** el supuesto que yo había tomado— y se
> agrega **la única pregunta nueva (24)** que abrió la cuarta ronda.
>
> ## **ESTADO (2026-09-01, 4ª ronda — CIERRE CORRECTIVO): las 23 preguntas están CERRADAS.**
> Las **doce del primer pase**, las **diez de la segunda ronda** y **la 23 de la tercera** quedaron todas
> resueltas. **No queda ninguna pregunta abierta de las que bloqueaban**, y **ningún número de dinero sigue
> sin fijar**: tope de oferta del operador **MX$1,500**, tarifa de envío **MX$180**, tope de piezas por
> variante **10**, alerta de «ya lo mandé» **5 días hábiles**, bordes **$500 y $1,000 inclusivos**.
> ~~umbral de recorte material **20%**~~ — **retirado por D30: dial sin objeto** (§P.10).
>
> **La pregunta 23 quedó CERRADA POR ELIMINACIÓN (D30)**: preguntaba qué plazo tenía el vendedor para
> contestar *«¿continúas?»*, qué significaba su silencio y si llevaba recordatorio. **Ya no hay tal
> pregunta al vendedor**, así que **no hay plazo que fijar, ni semántica del silencio que decidir, ni
> recordatorio que agregar**. *(Ese hueco era, precisamente, una de las señales de que D27 estaba mal
> planteada.)*
>
> **Se abre UNA pregunta nueva (24)**, creada por el **efecto colateral** de retirar D28: la **validación
> entre diales** del criterio **127** citaba un dial que dejó de existir y hubo que **reformularla**. La
> pregunta es **cuánto margen** quiere el humano entre la **tarifa de envío** y el **umbral de guía**. **No
> bloquea al arquitecto** —va con default redactado y marcado como `SUPUESTO`— y con los valores de hoy
> (**MX$180 vs. MX$1,000**) **no cambia ninguna conducta**.
>
> **Un residuo que NO es pregunta, sino riesgo aceptado:** el **límite anti-abuso** de guías por
> usuario/periodo (segunda mitad de la pregunta 16) **no se decidió**, y la resolución registrada es **no
> imponerlo en el MVP** y vigilar a mano. Vive en «Riesgos y banderas», **no** como pregunta abierta, porque
> ponerlo sería **inventar alcance**. Si el humano lo quiere, hay que pedirlo.
> **Nota de la 4ª ronda sobre ese riesgo**: D30 **no lo empeora ni lo mejora** — el costo del ciclo abusado
> sigue siendo **una etiqueta de MX$180**. Lo único que cambia es que **ya no existe la posibilidad de que el
> vendedor abusivo se quede además con un «no» que nos obligue a devolver todo**.

**Las doce del primer pase — desenlace:**
1. ~~**¿Quién puede EMITIR una oferta?**~~ → **CERRADA por D13 — mi supuesto era INCORRECTO.** No es «solo el
   súper-admin»: **el operador oferta hasta un tope de monto** y **por encima autoriza el súper-admin**,
   reusando la mecánica de topes del buylist. *(Residuo **CERRADO en la 3ª ronda por D24**: el tope es
   **MX$1,500**.)*
2. ~~**¿Se puede RE-OFERTAR sobre una solicitud rechazada o expirada?**~~ → **CERRADA: NO.** Son
   **terminales**; si el cliente quiere, **cotiza de nuevo**. *(Supuesto confirmado.)*
3. ~~**¿Una oferta ya enviada se puede EDITAR?**~~ → **CERRADA: NO.** Se **cancela y se emite otra**.
   *(Supuesto confirmado.)*
4. ~~**¿Cómo se cuentan los plazos?**~~ → **CERRADA por D14 — mi supuesto era INCORRECTO.** Son **días
   HÁBILES**, no naturales: una oferta enviada el viernes **no vence el domingo**. *(Residuo **CERRADO en la
   3ª ronda**: «día hábil» = **lunes a viernes**, sin **festivos oficiales de México**, en
   **`America/Mexico_City`**.)*
5. ~~**¿Quién paga el envío del vendedor?**~~ → **CERRADA por D16 — mi supuesto era INCORRECTO.** **La guía
   la mandamos nosotros** (arriba del umbral de D18b) y **se descuenta del pago**. Esto además **deja sin
   efecto a D5**: el cliente **ya no captura** la guía.
6. ~~**¿Qué correos son obligatorios en el ciclo?**~~ → **CERRADA por D23 — REVIERTE lo que yo había dejado
   fuera de alcance.** Son **tres**: **oferta**, **recordatorio** (uno solo, a un día hábil, una sola vez) y
   **expiración**. *(Residuo **CERRADO en la 3ª ronda**: el recordatorio es **uno POR PLAZO** —hasta dos en el
   ciclo, cada uno una sola vez—. ~~Nota: con **D27** puede aparecer **un tercer plazo**; ver pregunta 23.~~
   **Corrección de la 4ª ronda**: con **D30 no hay tercer plazo ni cuarto correo** — los obligatorios
   **siguen siendo tres**.)*
7. ~~**¿Aceptar exige sesión iniciada?**~~ → **CERRADA: SÍ.** **No hay enlace anónimo de aceptación.**
   *(Supuesto confirmado.)*
8. ~~**¿Sobre qué monto se evalúan los topes y el INE?**~~ → **REFINADA y cerrada por D16**: se juzgan sobre
   el **BRUTO ofertado** —el valor comprometido—, mientras que el **SPEI sale por el NETO**. Descontar el
   envío **no baja** una operación por debajo del umbral de INE. *(Residuo **CERRADO en la 3ª ronda**: el
   **acumulado mensual del tope** suma **BRUTOS**, y en paralelo el **acumulado de dinero pagado** se mide en
   **NETOS**.)*
9. ~~**¿Qué dispara exactamente el "no comprar" de la sugerencia?**~~ → **CERRADA por D15** y **precisada por
   D29 (3ª ronda)**: ya **no es un «o»** sino una **precedencia** —**con bounty manda el objetivo del
   bounty**; **sin bounty manda el tope general, que es de 10 piezas**—, y la **posición** que se compara
   pasa a ser **stock + verificando + tránsito + comprometido**. **Nunca bloquea** (D6 intacta). *(Residuo del
   número **CERRADO**: **10**.)*
10. ~~**¿Qué cuenta como "solicitud viva"?**~~ → **CERRADA: todo lo que NO sea terminal.** Terminales:
   **`pagada`, `rechazada`, `abandonada`, `expirada`**. *(Nota: la respuesta **agrega `abandonada`** a la
   lista de terminales que yo había escrito; ya está reflejado en §P.1, M5 y el criterio 129.)*
11. ~~**Producto separado (D7) — ¿qué hacemos con lo ya capturado?**~~ → **CERRADA (3ª ronda): corrección
   MANUAL. Mi supuesto era CORRECTO.** Las filas ambiguas ya capturadas se **reclasifican a mano desde M1**;
   **ninguna migración adivina** cuál era cuál. Ver §P.8 y criterio **160**.
12. ~~**¿La ubicación física se captura al convertir?**~~ → **CERRADA: NO se exige al convertir** —bloquear la
   conversión por falta de ubicación **atoraría el flujo de pago**—, pero la pieza sin ubicación **sale
   señalada** en la cola de piezas listas para publicar. *(Supuesto confirmado y reforzado.)*

**Los diez huecos de la segunda ronda (13–22) — desenlace:**
13. ~~**¿De cuánto es el tope de oferta del operador, y qué pasa arriba del tope?**~~ → **CERRADA por D24 —
   mi default era DESCARTADO.** El tope es **MX$1,500** de bruto, no **MX$0**. Y la **mecánica queda
   confirmada**: arriba del tope la oferta **requiere autorización del súper-admin** —o sea **espera en
   cola**—, no se bloquea en seco. Ver §P.2, §P.10 y criterio **147**.
14. ~~**¿El acumulado MENSUAL del buylist suma brutos o netos?**~~ → **CERRADA: LAS DOS COSAS, para medidas
   distintas.** El **tope de compromiso** (por solicitud y **mensual**) y el **INE** usan **BRUTOS** —misma
   base que AML—; el **acumulado de dinero pagado** usa **NETOS** —lo que salió por SPEI—. **Son dos medidas
   y ambas conviven.** *(Mi supuesto era correcto para el tope; la respuesta agrega la segunda medida, que yo
   no había separado.)* Ver §H, §P.6 y criterio **155**.
15. ~~**¿Qué cuenta como "día hábil"?**~~ → **CERRADA: lunes a viernes**, excluyendo **festivos oficiales de
   México**, en zona horaria **`America/Mexico_City`** (la que el proyecto ya usa para fechas). **El sábado
   NO cuenta.** *(Supuesto confirmado, con la zona horaria hecha explícita.)* Ver §H y criterio **154**.
16. ~~**En un rechazo PARCIAL, ¿de dónde sale el envío? Y ¿ponemos límite al abuso?**~~ → **CERRADA en su
   parte de dinero — RE-CERRADA en la 4ª ronda por D30, con otra respuesta.**
   *(3ª ronda, **superada**)*: ~~**CERRADA por D27/D28 — mi supuesto era INCOMPLETO.** No basta con truncar el
   neto: **primero se le pregunta al vendedor si quiere continuar**, siempre que el bruto aprobado caiga
   **más de 20%** (D28), **reusando el flujo de ajuste existente**. Si dice que no, **el envío de ida lo
   absorbemos nosotros**.~~
   **(4ª ronda, vigente — D30)**: **sí bastaba con truncar el neto**, siempre que **la condición esté
   declarada al frente**. En un rechazo parcial: **se paga `max(0, bruto aprobado − envío)` sin preguntar
   nada**, porque la oferta ya era **condicional a NM línea por línea** y el vendedor **ya la aceptó** (§P.3).
   El **piso de cero que yo había supuesto SÍ se confirma** y sigue siendo un **invariante con criterio
   propio** (**152**); y **si se rechaza TODO**, el envío lo absorbemos entero (**D17**, criterio 140).
   *(O sea: mi supuesto original de la 2ª ronda era **más correcto de lo que la 3ª ronda concluyó** — le
   faltaba la pieza de comunicación, no la de dinero.)*
   **La segunda mitad (tope de guías anti-abuso) sigue SIN decidirse** y se registra como **riesgo aceptado
   sin tope en el MVP** — vive en «Riesgos y banderas», no aquí, porque imponerlo sería inventar alcance.
   Ver §P.5.1 y criterios **150/151/152/161**.
17. ~~**¿Cuánto puede vivir un "ya lo mandé" sin que el operador lo confirme?**~~ → **CERRADA: es un dial,
   default 5 días hábiles**, y pasado eso la solicitud **se destaca como alerta** en la cola de «por
   confirmar envío». **No expira ni cancela nada.** Y se confirma que **no infla la cifra de «en camino»**,
   porque el «ya lo mandé» **no mueve el estado** — solo **detiene el reloj**. Ver §P.13 y criterio **156**.
18. ~~**Al bajar un plazo en M10, ¿se respetan las fechas ya comunicadas?**~~ → **CERRADA: SÍ, se respetan.**
   El plazo **se congela por solicitud** en el momento en que se fija; cambiar el dial **solo afecta a las
   solicitudes nuevas**. *(Supuesto confirmado y reforzado: no solo «no acorta» — queda **congelado**, así
   que tampoco alarga.)* Ver §P.10 y criterio **157**.
19. ~~**Los bordes de las tres bandas, y el mínimo después del cherry-pick.**~~ → **CERRADA — mi supuesto
   estaba MITAD BIEN, MITAD MAL.** **$500 inclusivo** *(correcto)* **y $1,000 TAMBIÉN inclusivo**
   *(**incorrecto**: yo lo había hecho estricto — una oferta de exactamente $1,000 **SÍ lleva guía
   nuestra**)*. Y el mínimo **NO se re-aplica tras el cherry-pick**: **gatea la creación de la solicitud, no
   la oferta** *(supuesto confirmado; se retira de paso el «la mesa debe avisarlo» que yo había añadido)*.
   Ver §P.12 y criterio **158**.
20. ~~**¿Qué cifra de envío se descuenta, si la guía se compra DESPUÉS de ofertar?**~~ → **CERRADA por D25 —
   supuesto CONFIRMADO, con número.** Se descuenta una **tarifa fija de MX$180**, **congelada al ofertar**;
   si la etiqueta real sale **más cara la absorbemos**, si sale **más barata es margen nuestro**. El humano
   confirmó que **es la salida correcta justo por la razón que se dio**: cualquier otra **rompe que el neto
   sea vinculante**. Es un **dial**, y es **distinto** de la tarifa de retiro (MX$175). Ver §P.4 y criterio
   **149**.
21. ~~**El recordatorio de D23, ¿es uno por plazo o uno en todo el ciclo?**~~ → **CERRADA: UNO POR PLAZO.**
   Hay **dos plazos** (aceptar y enviar), así que puede haber **hasta dos** recordatorios en el ciclo, **cada
   uno una sola vez**. *(Supuesto confirmado.)* Ver §H, §P.3 y criterio **159**.
22. ~~**¿Quién puede aplicar un override manual de compra al ofertar?**~~ → **CERRADA por D26: SÍ, y el
   OPERADOR también.** Puede **ajustar a mano el precio de una línea dentro de su tope** (MX$1,500), con
   **motivo obligatorio** y **auditado** (quién, cuánto y por qué). *(Mi supuesto de «solo el súper-admin»
   quedó corregido; la condición de «dentro de su mismo tope» que yo había propuesto **sí** se confirma, y el
   **motivo obligatorio** es un requisito **nuevo** que el humano agregó.)* Ver §P.2 y criterio **148**.

**Hueco que abrió la tercera ronda (23) — CERRADO POR ELIMINACIÓN en la cuarta:**
23. ~~**[ABIERTA — no bloqueante] El plazo de la pregunta «¿continúas?» del rechazo parcial (D27).**~~ →
   **CERRADA POR ELIMINACIÓN (4ª ronda, D30). No se contestó: dejó de existir.**
   La pregunta pedía fijar **(a)** cuánto tiempo tenía el vendedor para contestar *«¿continúas?»*, **(b)** qué
   significaba su silencio y **(c)** si ese plazo llevaba recordatorio. **Con D30 no hay pregunta al
   vendedor**, así que **no hay plazo, ni semántica del silencio, ni recordatorio, ni cuarto correo** que
   definir. **Ninguno de los tres supuestos que yo había redactado llega al producto.**
   **Vale la pena registrar por qué**: este hueco era **la señal** de que D27 estaba mal planteada. Un
   requisito que, para poder implementarse, **obliga a inventar un plazo nuevo sobre cartas ajenas que ya
   están en nuestra bóveda**, y donde **el silencio del vendedor no tiene ninguna lectura buena**, no era un
   detalle pendiente: era el síntoma. La corrección (declarar la condición **al frente**) **elimina el
   síntoma y la causa a la vez**. Ver §P.5.1 y decisión **89**.
   ~~*(Supuestos que se habían redactado y que quedan sin efecto: (a) reusar el dial de «plazo para aceptar»,
   2 días hábiles; (b) silencio = «no continúo», con devolución 7/30 y envío de ida absorbido por nosotros;
   (c) sí lleva recordatorio, con lo que los correos obligatorios pasarían de tres a cuatro.)*~~

**Hueco NUEVO que abrió la cuarta ronda (24):**
24. **[ABIERTA — no bloqueante, no cambia ninguna conducta con los valores de hoy] ¿Cuánto margen debe haber
   entre la TARIFA DE ENVÍO del buylist y el UMBRAL DE GUÍA?** — Al retirar D28, la **validación entre
   diales** del criterio **127** se quedó sin fórmula: citaba `umbral de guía × (1 − umbral de pregunta)`
   (**MX$800**), y **el umbral de pregunta ya no existe**. **Reformulé la validación en vez de retirarla**,
   porque la propiedad money-safe que protege sigue siendo real, solo que es otra: **ninguna oferta debe poder
   depositar MX$0 cuando el vendedor cumple perfecto**.
   **SUPUESTO redactado**: **`tarifa de envío del buylist` < `umbral de guía a nuestro costo`**, **estricto y
   sin colchón** — hoy **MX$180 < MX$1,000**, con **holgura enorme**. Es el mínimo defendible: como el umbral
   es **inclusivo** (criterio 158), la **oferta más chica con envío a nuestro costo vale exactamente el
   umbral**, así que igualarlos produciría un depósito de **MX$0** con todo aprobado.
   **Lo que falta decidir es solo el margen**: ¿basta *«estrictamente menor»*, o el humano quiere un colchón
   explícito (p. ej. **la tarifa no puede pasar de la mitad del umbral**, o **el neto mínimo de una oferta en
   la banda con guía nuestra no puede bajar de MX$X**)?
   **Por qué no bloquea:** con los valores vigentes **ninguna de las variantes cambia nada** —la validación
   solo se activaría si alguien subiera la tarifa por encima de **MX$500–1,000**—, así que el arquitecto puede
   diseñar contra el default. **Por qué conviene contestarla:** define **qué tan cerca del absurdo** puede
   dejar el sistema que alguien mueva un dial de dinero.
