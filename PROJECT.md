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
> **ESTADO AL 2026-09-01 (9ª ronda del bloque v2.1 — CIERRE DE DOCUMENTACIÓN — LEER PRIMERO):**
> **No entra alcance nuevo, no se abre ninguna pregunta y no se toca ninguna regla vigente.** Esta ronda
> **formaliza como requisito de negocio las DOS decisiones que vivían solo en documentos del arquitecto**
> (**D41** y **D42** — era la **pregunta 31**, que el humano contestó: *sí, van en este documento*) y
> **cierra** el único punto que la 8ª ronda había dejado marcado como pendiente. Tres cosas:
> **(1) D42 — TRAS CANCELAR UNA OFERTA YA ENVIADA, EL PORTAL NO SE QUEDA MUDO.** Es **el hermano de pantalla
> del correo 5**. Si le mandamos *«cancelamos tu oferta»* y al entrar al portal **no ve rastro de nada**, la
> **pantalla contradice al correo** y el vendedor queda peor que antes de escribirle: con un correo que no
> puede confirmar en ningún lado. **El portal dice que hubo una oferta, que se canceló y CUÁNDO** —esos tres
> datos— **y nada más**: **el motivo interno no le concierne** (por qué la cancelamos es evaluación nuestra
> y vive en la bitácora, M10). **El contracaso NO cambia y se prueba junto**: la oferta que **solo esperaba
> autorización** **no deja rastro** —ahí el portal **sigue mudo**, porque esa oferta **nunca existió para
> él**—. **Un solo hecho —¿le llegó o no le llegó?— gobierna las tres consecuencias**: correo, reloj y
> pantalla. Ver **§P.3**, §P.11, criterio **176** y decisión **104**.
> **(2) D41 — EL COTIZADOR CONOCE EL MÍNIMO, Y SOLO EL MÍNIMO.** Para que el criterio **132(a)** se pueda
> cumplir —que la pantalla diga **cuánto falta** *antes* de intentar enviar—, el cotizador **necesita saber
> el mínimo de compra**: es un dial y no puede estar quemado en la pantalla. **Se publica ese dato y ningún
> otro**; en particular **la tarifa de envío NO se publica a ninguna superficie pública**. Así **D43 no
> depende de que el frontend se porte bien**: lo que no llega a la pantalla **no se puede pintar por error,
> ni hoy ni en un rediseño**. *(**D41 nació como una propuesta más amplia del arquitecto —publicar los
> diales al cotizador— que él mismo retiró; lo que queda vigente es esta versión acotada**: de los **dos
> diales de monto** (mínimo y tarifa), **solo el mínimo es público**.)* Ver **§E**, **§H**, criterio **177**
> y decisión **105**. *(**No cierra la pregunta 30**: los **términos** son otra superficie y siguen con su
> supuesto.)*
> **(3) «EN LA OFERTA: CORREO + PANTALLA» — CONFIRMADO POR EL HUMANO; deja de ser pendiente.** La 8ª ronda
> **señaló** que *«la resta vive SOLO en el correo»* **no puede leerse literal**, porque la **pantalla de
> aceptación** tiene que mostrar **los tres montos**: ahí es donde se acepta con sesión iniciada (§P.3) y
> **aceptar a ciegas sería peor que el problema que D43 resuelve**. **El humano confirma que esa lectura es
> la correcta**: se redacta **«en la oferta: correo + pantalla»** y **se retira la marca de pendiente**. **No
> cambia ningún texto** —ya estaba así en §H(2), §P.3 y el criterio 174(e)—: lo que cambia es que **deja de
> estar en observación**.
> **Preguntas: la 31 queda CERRADA.** Del ciclo del buylist siguen abiertas la **28**, la **29**, la **30** y
> la **32** (todas **no bloqueantes, con supuesto tomado**); los demás bloques de preguntas quedan **como
> estaban**. **No se abre ninguna nueva.**
>
> **ESTADO AL 2026-09-01 (8ª ronda del bloque v2.1 — CORRECTIVA FINAL DE DOCUMENTACIÓN — VIGENTE; solo su
> punto (1) de «lo que este documento SEÑALA» queda confirmado y cerrado por el bloque de arriba):**
> **una decisión del humano (D43)** y **una corrección de conteo** a la que llegaron por separado el
> **arquitecto** y **ux-ui**. **No entra alcance nuevo: entra precisión.** Tres cosas:
> **(1) LOS CORREOS OBLIGATORIOS DEL CICLO SON CINCO, NO CUATRO — y hay un caso que no manda NINGUNO.**
> Este documento venía contando **cuatro** y metía **tres desenlaces distintos dentro de uno solo**
> («expiración/cancelación»). **El conteo estaba mal y se corrige**: *«cancelamos nosotros tu oferta»* **no
> es** una expiración — **la solicitud sigue VIVA**, vuelve a la fila con sus 7 días hábiles completos
> (D38) y **nadie incumplió nada** —, así que mandarle un correo que dice *«se venció tu plazo»* **le imputa
> al vendedor un acto NUESTRO**. Es **literalmente el argumento de D33** —el que creó el correo de «no
> procederemos»— aplicado un nivel más abajo, y la respuesta tiene que ser la misma: **correo propio**.
> **Los CINCO son: (1) oferta, (2) recordatorio, (3) expiración, (4) «no procederemos», (5) «cancelamos la
> oferta».** Y **el caso que NO manda correo**: **cancelar una oferta que todavía esperaba autorización** —
> esa oferta **nunca existió para el vendedor**; contársela sería revelarle una decisión interna que jamás
> le concernió. Ver **§P.3** (tabla), §P.3.1, §P.5.1, §H, M5, «Fuera de alcance», criterios **16/142** y
> el criterio **173** (nuevo). **Hueco de documentación que esto destapa y se cierra aquí**: el criterio
> 16(b) —la oferta que vence sin respuesta— **nunca dijo que saliera correo**, aunque el ciclo llevaba
> desde la 2ª ronda contando uno de «expiración». **Sale correo**; no es alcance nuevo, es lo que
> «expiración» siempre cubrió.
> **(2) D43 — EL COTIZADOR DICE EL ENVÍO EN PALABRAS, NO EN CIFRAS.** Decisión del humano: el cotizador
> **no menciona ningún monto de envío** —**sin cifra, sin resta, sin neto estimado y sin expresar el
> faltante del mínimo en términos de envío**—; solo la **frase cualitativa** *«nosotros ponemos la guía y su
> costo se descuenta de lo que te pagamos»*. **La resta con los tres montos vive SOLO en la oferta**
> (correo + pantalla de aceptación), que es **autenticada** y usa la **tarifa congelada**. Razón: el
> cotizador **ya es indicativo** —los precios se mueven y puede que no compremos todas las líneas—, así que
> restarle un envío exacto es **precisión falsa**; y el neto del carrito era **sistemáticamente optimista**,
> porque el recorte del operador **solo quita líneas**: pintaba la **mejor** cifra posible, nunca la
> esperada. **⚠ EL CRITERIO 132 NO CAMBIA Y SIGUE VIGENTE ENTERO**: el **faltante del mínimo** (*«te faltan
> $120»*) **SÍ se pinta en el cotizador**, con sus **dos frentes (a) y (b) intactos** — **un faltante del
> mínimo no es un monto de envío**. Ver **§E**, **§H**, §P.3, §P.12, «Fuera de alcance» y criterios
> **174/175** (nuevos). **D43 supersede la parte del cotizador de D31**, no D31 entera: *«el envío siempre
> se deduce»* **se sigue diciendo en las tres superficies**; lo que sale del cotizador es **el número**.
> **(3) TRES TEXTOS AL CLIENTE, RATIFICADOS (uno con una acotación).** La **frase del cotizador** queda
> **ratificada literal**; la afirmación **«es una tarifa fija»** del correo de oferta queda **ratificada
> ACOTADA a esa oferta** —es fija **para esta operación**, no una lista de precios permanente: la tarifa es
> un **dial** (D31) y **«fija» no puede aparecer en ninguna superficie que no tenga una tarifa congelada
> detrás**, empezando por el cotizador—; y la **prohibición de presuponer conocimiento previo**
> («como ya sabías», «recuerda que») queda **ratificada para el correo de oferta y toda superficie anterior
> a él**, con la **excepción explícita del recordatorio**, que llega **después** y donde referirse al monto
> ya visto **sí es verdad**. Ver criterio **175** y decisiones **101–103**.
> **⚠ Lo que este documento SEÑALA y el humano debería mirar**: **(1)** *«la resta vive solo en el correo»*
> **no puede leerse literal** — la **pantalla de aceptación** tiene que mostrar los tres montos, porque
> **ahí es donde se acepta con sesión iniciada** (§P.3) y aceptar a ciegas sería peor que el problema que
> D43 resuelve; se redacta como **«en la oferta: correo + pantalla»**. **(2)** el **arquitecto tomó dos
> decisiones (D41, D42) que NO están en este documento** — ver **preguntas 30 y 31**.
> **⚠ LOS DOS SEÑALAMIENTOS QUEDAN CERRADOS EN LA 9ª RONDA** *(se conservan como historial)*: **(1)** el
> **humano confirmó** que la lectura correcta es **«en la oferta: correo + pantalla»** — **deja de ser
> pendiente**; **(2)** **D41 y D42 quedan formalizados como requisito de negocio en ESTE documento** (§E,
> §H, §P.3, criterios **176/177**, decisiones **104/105**), con lo que **la regla de conflicto vuelve a
> sostenerse**: `PROJECT.md` manda sobre ellas. **Pregunta 31 CERRADA.**
> **Preguntas: se abren la 30, la 31 y la 32** (las tres **no bloqueantes**, con supuesto tomado).
>
> **ESTADO AL 2026-09-01 (7ª ronda del bloque v2.1 — CORRECTIVA FINAL — histórico; superado por el bloque
> de arriba en lo que toca al conteo de correos y a lo que el cotizador dice del envío):** cuatro decisiones
> del humano (**D36–D40**) y **una corrección enrutada por el arquitecto**. La más importante **tapa un hueco
> BLOQUEANTE que nadie había visto**:
> **(D36/D37) EL CICLO NUNCA PEDÍA LA DIRECCIÓN DEL VENDEDOR.** Verificado: hasta esta ronda, **§P no
> mencionaba dirección, domicilio ni remitente en ningún punto**. Eso hacía que **D16 —«la guía la mandamos
> nosotros»— NO fuera ejecutable como estaba escrito**: no se puede comprar una etiqueta sin un **domicilio
> de origen**. **Se cierra así**: la dirección **se pide AL CREAR LA SOLICITUD**, junto con la CLABE —**no al
> aceptar**—; **se reusa la MISMA libreta de direcciones** que el cliente ya usa para recibir sus compras
> (**sin modelo nuevo, sin pantalla nueva, sin «domicilio de remitente» aparte**); **si ya tiene direcciones
> guardadas elige o confirma una, y si no tiene ninguna la captura**; y **sin dirección NO se crea la
> solicitud**. **Costo aceptado explícitamente por el humano**: también se le pide la dirección a gente a la
> que al final **no** le compraremos. Ver **§P.2.1** (nueva), §P.1, §P.3, §P.4, §E, M5 y criterio **170**.
> **(D38) EL RELOJ DE CADUCIDAD SÍ REINICIA AL CANCELAR UNA OFERTA — ⚠ CORRIGE LA 6ª RONDA.** Este documento
> había levantado la bandera y **el humano le dio la razón**: con el reloj corriendo *siempre* desde la
> creación, cancelar una oferta para **corregirla** podía hacer que la solicitud **caducara el mismo día en
> que volvía a la fila**, y el cliente recibía un *«no procederemos»* **por un error nuestro**. **Regla
> vigente: cancelar una oferta devuelve la solicitud a la fila con los 7 días hábiles COMPLETOS.** Con eso
> **«un plazo, un origen» queda SUPERADO** como regla vigente. **⚠ Riesgo NUEVO que esto abre y que este
> documento SEÑALA sin inventarle remedio**: cancelar y re-emitir **en bucle** podría alargar el plazo
> indefinidamente — **el candado, si hace falta, lo decide el arquitecto** (ver «Riesgos y banderas»).
> **(D39) HAY BOTÓN DE «DECLINAR AHORA».** También estaba señalado: si el operador decidía el día 1 que no
> compra, el cliente **esperaba 7 días hábiles** a que el barrido lo cerrara. Ahora **el operador puede
> cerrar la solicitud de inmediato**, con **el MISMO correo** de «no procederemos» y **el MISMO estado
> terminal** (`expirada` + motivo `no_offer`). **No es un desenlace nuevo: es el mismo, sin la espera.**
> Criterio **171**.
> **(D40) EL PISO DE NETO ES INCLUSIVO — confirmado, sin cambio.** Un neto de **exactamente MX$200 SÍ se
> puede emitir**. Ya estaba así redactado (criterio 167a); esta ronda **solo lo hace inequívoco** en §P.2,
> §P.3, §P.10 y §P.12.
> **(o.17 — corrección enrutada por el arquitecto) Los ejemplos numéricos de «neto MX$20 / neto MX$0» como
> desenlaces VÁLIDOS quedan corregidos.** La **regla** del criterio **158(c)** —el mínimo de compra **no** se
> re-aplica a la oferta— **sigue viva**; lo que cambió con D34 es el **ejemplo**. El del propio 158(c) ya
> estaba tachado; **las notas derivadas de §P.5.1 y §P.12 seguían leyéndose como vigentes** y **se corrigen
> aquí**. *(El arquitecto no las tocó a propósito: por la regla de conflicto, `PROJECT.md` manda sobre el
> contrato.)*
> Ver **§P.1, §P.2, §P.2.1, §P.3, §P.3.1, §P.4, §P.5.1, §P.9, §P.10, §P.11, §P.12**, **§E**, **§H**,
> **«Usuarios y roles»**, **«Fuera de alcance»**, **M5**, criterios
> **16/114/142/145/158/165/167/169** (corregidos), criterios
> **170–172** (nuevos) y decisiones **97–100**. **Preguntas: se abren la 28 y la 29** (ambas **no
> bloqueantes**, con supuesto tomado).
> **⚠ Dos cosas que este documento SEÑALA y el humano debería mirar antes de que el arquitecto cierre**:
> **(1)** la frase *«igual que hoy pasa con la CLABE»* **no describe lo que este documento dice hoy** —la
> **CLABE se pide en el paso de PAGO**, no al crear (criterio 14, §E, M6)—; **la dirección se redactó como él
> la decidió** y **la CLABE se dejó intacta** (**pregunta 29**). **(2)** la **libreta de direcciones** que
> D37 manda reusar **existe en este documento como MENCIÓN, no como requisito redactado** (§J la nombra al
> listar lo que el invitado no tiene): **no cambia ninguna decisión**, pero el arquitecto **la está heredando
> sin especificación**.
>
> **ESTADO AL 2026-09-01 (6ª ronda del bloque v2.1 — CORRECTIVA — histórico; superado por el bloque de
> arriba en lo que toca al reinicio del reloj y a la espera de 7 días para un «no»):** el **bloque v2.1
> (ciclo de adquisición del buylist, §P)** queda **CERRADO, sin preguntas abiertas propias**. Tres cierres:
> **(D34)** **SÍ hay piso: no se puede EMITIR una oferta cuyo NETO quede por debajo de MX$200** —el bloqueo
> vive **en la emisión**, no en el dial ni en la aceptación; el operador **compra más líneas o no oferta**—,
> con lo que la **pregunta 25 queda CERRADA** y **los diales del ciclo pasan de OCHO a NUEVE** (§P.10).
> **(D35)** el **objetivo del bounty por defecto es 2** («hasta tener 2 en inventario»): es el **default al
> dar de alta** y el valor con el que **se llenan los bounties viejos sin meta** —**no se desactivan**—,
> y **sigue siendo editable por bounty**; con eso la **pregunta 26 queda CERRADA**. **(Pregunta 27)** la
> resolvió el **arquitecto**: **se reutiliza el terminal `expirada`** y **el motivo se persiste en columna
> propia** (`no_offer` / `not_shipped`), así que **los estados terminales vuelven a ser CUATRO** —el
> requisito de negocio nunca fue «un estado nuevo», sino que **los dos desenlaces sean distinguibles**, y
> eso se cumple con el motivo—; además **sí caduca** una solicitud que tenga una oferta esperando
> autorización (**y el barrido anula esa oferta al hacerlo**) y ~~**el reloj NO reinicia** al cancelar una
> oferta emitida: **cuenta desde la creación de la solicitud**~~ *(**⚠ SUPERADO por D38, 7ª ronda: SÍ
> reinicia — 7 días hábiles completos**)*. **`caducada` como estado propio era un
> SUPUESTO de nombre de este documento y queda SUPERADO.** Ver **§P.1, §P.2, §P.3, §P.3.1, §P.5.1, §P.9,
> §P.10, §P.11, §P.12**, **§N.6**, **§H**, **M5/M10**, criterios **16/113/127/129/145/152/158/164/165**
> (corregidos), criterios **167–169** (nuevos) y decisiones **94–96**.
> ~~**⚠ Una consecuencia que este documento SEÑALA en vez de callar**: al no reiniciar el reloj tras cancelar
> una oferta, **una solicitud puede caducar el mismo día en que vuelve a la fila** si ya pasaron los 7 días
> hábiles desde su creación — se castiga al cliente por una corrección **nuestra**. Ver la bandera en
> «Riesgos y banderas» y la nota de §P.3.1.~~
> **⚠ SUPERADO en la 7ª ronda (D38): el humano le dio la razón a esa bandera.** **Cancelar una oferta
> devuelve la solicitud a la fila con los 7 días hábiles COMPLETOS**; el escenario descrito **ya no puede
> ocurrir**. La bandera se retira y **en su lugar queda otra**: el bucle cancelar/re-emitir.
>
> **ESTADO AL 2026-09-01 (4ª ronda del bloque v2.1 — CORRECTIVA Y ACOTADA — histórico; superado por el
> bloque de arriba en lo que toca a diales, terminales y preguntas 25/26/27):** el **bloque v2.1
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
> **`expirada`** (terminal) *(**⚠ 5ª ronda, D33: se suma un quinto — `caducada`**, terminal)* **⚠ 6ª ronda:
> NO se suma ninguno — la caducidad es `expirada` con motivo `no_offer`; **siguen siendo cuatro** estados
> nuevos y **cuatro terminales**.*
> **Doce decisiones cerradas del humano**: **(D1)** la oferta es **todo-o-nada** —
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
> desde el back-office (**M10**), no constantes en código *(**⚠ 5ª ronda: son TRES**, D33)*;
> **(D9)** el **precio de compra es el pactado en la
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
> el cotizador), y el cotizador dice **cuánto falta** («te faltan $120»); ~~**(D18b)** **umbral de guía
> MX$1,000**, **dial separado** del mínimo, con **tres bandas**: **&lt;$500 no se compra**, **$500–$1,000 se
> compra y el vendedor paga su envío como hoy**, **&gt;$1,000 se compra y la guía la ponemos nosotros**~~
> *(**⚠ D18b SUPERADA en la 5ª ronda por D31: se elimina el umbral, quedan DOS bandas y la guía va
> SIEMPRE**)*;
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
> cancela y se emite otra), los **correos obligatorios son tres** (oferta, recordatorio, expiración)
> *(**⚠ corregido en la 5ª ronda: son CUATRO** — D33 suma el de «no procederemos»; **⚠ corregido otra vez
> en la 8ª: son CINCO** — la **cancelación** sale del correo de expiración, §P.3, criterio 173)*,
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
> por solicitud** en el momento en que se fija— (P18); ~~**$500 y $1,000 son AMBOS inclusivos** *(esto
> **corrige** mi supuesto: exactamente **$1,000 SÍ lleva guía nuestra**)*~~ *(**⚠ 5ª ronda, D31: queda UN
> SOLO borde — MX$500 inclusivo; el de $1,000 quedó sin objeto**)* y **el mínimo NO se re-aplica tras
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
> **⚠ Este bloque quedó corregido por la 5ª ronda (D31–D33), que sigue abajo.**
> **Requisito v2.1 — QUINTA RONDA: UNA SOLA BANDA, EL OBJETIVO DEL BOUNTY OBLIGATORIO Y LA SOLICITUD QUE
> NADIE OFERTA CADUCA (2026-09-01, TRES DECISIONES CORRECTIVAS DEL HUMANO — D31, D32, D33):**
> **(D31) SE ELIMINA EL UMBRAL DE GUÍA — hay UNA SOLA BANDA.** El humano aclaró que **su intención siempre
> fue mandar la guía SIEMPRE**: el umbral de **MX$1,000** era **una propuesta de este documento que él nunca
> pidió**, y **queda eliminado**. **Desde el mínimo de MX$500, en TODA compra ponemos la guía y SIEMPRE se
> descuenta del importe a pagar.** Con eso **las tres bandas pasan a dos** —**menos de $500: no se crea la
> solicitud**; **$500 (inclusive) en adelante: se compra, ponemos la guía y se descuentan MX$180**— y la
> banda intermedia (*«de $500 a $1,000 el vendedor paga su envío»*) **se retira**. **Requisito de
> comunicación explícito del humano**: *«clarifica en todos lados que siempre se deduce del importe a
> pagar»* — debe decirse en el **cotizador**, en el **correo de oferta** y en los **términos**, y **no como
> letra chica**: en una oferta de **$500** los **$180** son el **36%**, el vendedor recibe **$320** y **tiene
> que verlo ANTES de aceptar**. El **dial «umbral de guía» se retira** (superado, con su razón) y la
> **validación cruzada del criterio 127 pierde su referente**: se **reformula** sobre la relación que sigue
> siendo cierta — **`tarifa de envío` < `mínimo de compra`** (**MX$180 < MX$500**) —, conservando la
> propiedad money-safe de que **una operación con TODO aprobado nunca deposita cero**. El humano **aceptó a
> ojos abiertos** que en el piso de $500 el envío pese **36%**; **ambos siguen siendo diales** y, si duele,
> se mueven. *(Con esto la **pregunta 24 queda CERRADA**: el margen que pedía decidir es **ninguno**.)*
> **(D32) El OBJETIVO del bounty pasa a ser OBLIGATORIO.** Este documento había señalado que una variante con
> **bounty vivo y sin objetivo** **nunca** pinta «no comprar», por más copias que acumule (D29 le da
> precedencia al bounty y el tope general de 10 no aplica). **El humano lo cierra**: dar de alta un bounty
> **exige capturar su objetivo** (*«hasta tener N en inventario»*). Con eso **el caso «bounty sin meta» deja
> de existir** y **el tope general siempre tiene con qué compararse**. **NO se construye panel de bounties**
> —el humano lo pidió y decidió dejarlo como **proyecto aparte**—: aquí **solo se exige el objetivo donde hoy
> se configuran**.
> **(D33) La solicitud que nadie oferta CADUCA a los 7 días hábiles.** Al re-anclar el barrido de 30 días
> —correcto: **`cotizada` ahora significa «esperando que NOSOTROS ofertemos»**, y cerrarla por **inacción
> nuestra** sería culpar al cliente— **quedó un hueco: nada cerraba ya una `cotizada`**, y un cliente podía
> esperar **indefinidamente** sin recibir respuesta de ningún tipo. **A los 7 días hábiles desde su creación,
> una solicitud que nadie ofertó caduca** y **sale un correo al cliente diciendo explícitamente que NO
> PROCEDEREMOS con la oferta** —no un *«no pudimos procesar»* vago: **debe saber a qué atenerse y que puede
> volver a cotizar cuando quiera**—. Se cuenta en **días hábiles**, por consistencia con D14. **Dos
> consecuencias que este documento escribe en vez de dejar mintiendo**: **(1)** es un **CUARTO correo
> obligatorio** —distinto de la expiración: no es *«aceptaste y no mandaste»*, es *«no procederemos»*—, así
> que **los correos del ciclo pasan de tres a CUATRO** (§P.3, §H, criterios 16/142 y la pregunta 6, que se
> había cerrado con «tres») *(**⚠ 8ª ronda: y de CUATRO a CINCO** — el mismo razonamiento, aplicado a la
> **cancelación**, que también decía una cosa falsa metida dentro del correo de expiración; §P.3, criterio
> **173**)*; **(2)** es **un dial más** — se fue el **umbral de guía** (D31) y entra este
> **plazo**, así que la tabla de §P.10 **vuelve a OCHO diales** *(**⚠ 6ª ronda, D34: pasan a NUEVE** — entra
> el **neto mínimo para emitir**, MX$200)*.
> **Además, tres puntos que el arquitecto dejó señalados y el humano ya resolvió**: **(a)** el **costo real
> de la etiqueta** **se puede capturar (opcional)** al confirmar el envío, con **fallback a la tarifa
> congelada de MX$180** si no se captura — **el P&L usa el real cuando existe y la tarifa cuando no**, y
> **lo que se le descuenta al vendedor NO cambia nunca** (sigue siendo la tarifa congelada, D25); esto
> **cierra la contradicción criterio 135 × D19** que este documento tenía abierta; **(b)** los **demás
> puntos del arquitecto** —quién cancela la guía, a qué estado vuelve una oferta cancelada, que `expirada`
> selle la fecha de cierre y la línea sin precio que aporta 0 al mínimo— **quedan como él los resolvió** y
> este documento **no los toca**; **(c)** ~~los **estados terminales pasan de cuatro a CINCO** con la
> caducidad~~ **⚠ SUPERADO en la 6ª ronda: siguen siendo CUATRO** — la caducidad es **`expirada` con motivo
> `no_offer`**, resolución de la pregunta 27 (§P.1, §P.9, M5, criterios 113/129/145/169).
> **⚠ Coherencia que este documento SEÑALA en vez de resolver en silencio**: al desaparecer la banda donde el
> vendedor pagaba su envío, **una oferta recortada por cherry-pick por debajo de MX$180 deposita MX$0 con
> TODO aprobado** —el mínimo **no se re-aplica a la oferta** (criterio 158c)—, cosa que antes no podía pasar
> en esa banda. La protección que queda es **informativa y sí existe**: el vendedor **ve el neto antes de
> aceptar** (D31) y puede decir que no. **Se abre la pregunta 25** por si el humano quiere además un **piso
> de neto** para emitir la oferta. *(**⚠ CERRADA en la 6ª ronda: SÍ lo quiere — MX$200 de neto, D34.**)* Ver **§P.3, §P.4, §P.10, §P.12** (corregidas), **§P.1, §P.2, §P.5, §P.6,
> §P.9, §P.11**, **§E**, **§H**, **§N.6**, **«Fuera de alcance»**, **M5/M10**, criterios
> **16/113/122/123/127/129/133/134/135/137/142/145/149/153/158** (corregidos), criterios **162–166**
> (nuevos) y decisiones **90–92**. **Preguntas: se CIERRA la 24; se abren la 25, la 26 y la 27.**
> **⚠ Este bloque quedó corregido por la 6ª ronda (D34–D35 + la resolución de la 27), que sigue abajo.**
> **Requisito v2.1 — SEXTA RONDA: PISO DE NETO PARA EMITIR, EL BOUNTY NACE CON META 2 Y LA CADUCIDAD ES UN
> MOTIVO, NO UN ESTADO (2026-09-01, DOS DECISIONES DEL HUMANO — D34, D35 — MÁS LA RESOLUCIÓN DE LA
> PREGUNTA 27 POR EL ARQUITECTO):**
> **(D34) SÍ hay piso, y es MX$200 de NETO.** Este documento había señalado (pregunta 25) que, con una sola
> banda, **un cherry-pick chico puede depositar MX$0 sin rechazar ninguna carta**: la validación
> `tarifa < mínimo` protege la **solicitud completa**, no la **oferta recortada**. **El humano lo cierra con
> un piso: no se puede EMITIR una oferta cuyo NETO sea menor a MX$200.** El operador **compra más líneas o
> no oferta**. **Dónde vive el bloqueo, dicho con precisión**: en la **emisión de la oferta** —**no** en el
> dial y **no** en la aceptación—. Los **diales no ven el recorte** que hizo el operador, y **el correo no
> debe llegar a mandarse**: no se trata de que el vendedor rechace una oferta ridícula, sino de que **esa
> oferta no exista**. **La aritmética que lo sostiene** *(el humano la puso sobre la mesa; se registra
> porque es lo que hace defendible el número)*: una solicitud cuesta **~$217** de operar —etiqueta **$180**
> más tiempo de operador—; comprando al **40% de referencia** hace falta un **bruto de ~$362** para que la
> operación **se pague sola**, lo que deja **~$182 de neto**. **MX$200 queda justo arriba** y exige un
> **bruto de ~$380**: **conserva el margen de cherry-pick sobre lotes grandes** sin permitir la oferta
> absurda. **No es un bloqueo nuevo**: el arquitecto ya había bloqueado el caso **`neto ≤ 0`**; **esto lo
> SUBE a MX$200**, es el mismo bloqueo con número. **Es un dial más**, así que la tabla de §P.10 pasa de
> **OCHO a NUEVE**. **Lo que NO cambia**: el **piso de cero** (criterio **152**) sigue existiendo como
> invariante **al pagar** —una oferta ya emitida cuyo bruto aprobado caiga por debajo del envío **sigue
> depositando MX$0 y nunca deuda**—; D34 gobierna **qué se puede emitir**, no **cuánto se paga**.
> **(D35) El objetivo del bounty por defecto es 2.** El humano fijó el número que faltaba en D32: **«hasta
> tener 2 en inventario»**. Es **(a)** el **valor por defecto** al dar de alta un bounty y **(b)** el valor
> con el que **se llenan los bounties viejos** que hoy no tienen meta — **NO se desactivan** ni se sacan de
> la vitrina *(esto **corrige el supuesto** que este documento había redactado, que los trataba como «sin
> bounty» hasta que alguien los editara)*. **Sigue siendo editable por bounty**: **2 es el default, no un
> tope rígido**. Con eso la **pregunta 26 queda CERRADA**.
> **(Pregunta 27 — resuelta por el ARQUITECTO, no por este documento):** decidió **reusar el estado terminal
> `expirada`** y **persistir el motivo en columna propia** (`no_offer` = nadie ofertó / `not_shipped` =
> aceptó y no mandó), **en vez de crear un quinto terminal**. **Su razón, que este documento adopta**: *un
> estado que se comporta idéntico a otro en todas las reglas —cierre, purga de INE, cuota, «no se revive»—
> **no es un estado, es un atributo**; pero **la causa sí importa** para el correo y **no es derivable**.*
> **Consecuencia: los estados terminales siguen siendo CUATRO** (`pagada`, `rechazada`, `expirada`,
> `abandonada`). **`caducada` como estado propio era un SUPUESTO de nombre de este documento y queda
> SUPERADO**; el **requisito de negocio no cambia ni un ápice**: los **dos desenlaces tienen que ser
> distinguibles** —**correos distintos** y **reportes que los separen**— y eso lo cumple el motivo.
> **Sus respuestas a los dos bordes del plazo**: **(b)** **SÍ** caduca aunque haya una oferta **esperando
> autorización**, y **el barrido ANULA esa oferta al hacerlo** *(supuesto confirmado, con el verbo
> explícito)*; **(c)** ~~el reloj **NO reinicia** al cancelar una oferta emitida — **cuenta desde la creación
> de la solicitud** *(**⚠ esto CORRIGE el supuesto** que este documento había redactado, que lo reiniciaba
> desde la cancelación)*~~ **⚠ REVERTIDO EN LA 7ª RONDA POR EL HUMANO (D38): el reloj SÍ se reinicia — la
> solicitud vuelve a la fila con los 7 días hábiles COMPLETOS.** El supuesto original de este documento
> resultó ser el vigente; **(a)** y **(b)** de la pregunta 27 **siguen intactas**.
> Ver **§P.1, §P.2, §P.3, §P.3.1, §P.5.1, §P.9, §P.10, §P.11, §P.12**, **§N.6**, **§H**, **«Fuera de
> alcance»**, **M5/M10**, criterios **16/113/127/129/145/152/158/164/165** (corregidos), criterios
> **167–169** (nuevos) y decisiones **94–96**.
> **Preguntas: se CIERRAN la 25, la 26 y la 27. El bloque v2.1 queda sin preguntas abiertas propias.**
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
  la plataforma ni ve back-office. *(NUEVO v2.1, D11)*: **el celular es un dato obligatorio de la cuenta** —
  se pide **al registrarse** y, si la cuenta no lo tiene (entró con **Google** o es una cuenta vieja con el
  campo vacío), **se le pide antes de dejarlo crear una solicitud de venta**. *(NUEVO 7ª ronda v2.1,
  **D36/D37**)*: **también necesita una DIRECCIÓN** para crear una solicitud de venta — **la misma libreta de
  direcciones con la que recibe sus compras**: **elige o confirma** una si ya tiene, **la captura** si no
  tiene ninguna, y **sin dirección no hay solicitud** (§P.2.1). *(NUEVO v2.1)*: en el buylist
  el cliente además **acepta o rechaza la oferta** que le mandamos por correo y, cuando deposita el paquete,
  **avisa que ya lo mandó** — un aviso que **detiene su reloj** pero **no** mueve el estado, porque **quien
  confirma el envío es el operador** (§P.4, §P.13). *(Actualizado 2ª ronda v2.1, D16/D20: el cliente **ya no
  captura la guía** — ~~arriba del umbral~~ **SIEMPRE** *(5ª ronda, D31)* **la ponemos nosotros** y **la
  captura el operador**; supersede D5.)* *(NUEVO 5ª ronda, D33: si **nadie oferta su solicitud en 7 días
  hábiles**, el cliente **recibe un correo diciéndole que no procederemos** y puede **volver a cotizar**.)*
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
  súper-admin), ni ver finanzas, ni editar diales. *(NUEVO 7ª ronda v2.1, **D39**)*: **puede DECLINAR una
  solicitud en el acto** —cerrarla sin esperar los 7 días hábiles, con el **mismo correo** de «no
  procederemos» y el **mismo estado terminal**—; **queda auditado quién declinó** (§P.2, criterio 171).
  *(7ª ronda, D36)*: **no captura la dirección del vendedor** — **la lee de la solicitud**, donde el propio
  vendedor la eligió al crearla (§P.2.1).

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
      *(El «con seguro» de esta línea y la etiqueta de checkout **«Envío (asegurado)» / «Shipping fee (insured)»**
      están **sin confirmar contra la paquetería** — ver **pregunta abierta 25**. **No confundir con la
      decisión 63**, que es sobre la **custodia** y ya está cerrada: ahí **no hay seguro** y la palabra está
      prohibida.)*
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
      se puede. *(**⚠ 8ª ronda, D43 — esto NO se toca**: el faltante del mínimo **se sigue pintando con su
      cifra**. Lo que sale del cotizador son **los montos de ENVÍO**, que es otra cosa; y **queda prohibido
      expresar este faltante en términos de envío** — §H, criterios 132 y 174.)* Es un **dial de M10**, ~~distinto del umbral de guía~~ **distinto de la tarifa de envío**
      *(5ª ronda, D31: **el umbral de guía ya no existe**; los dos diales de monto que quedan son el **mínimo**
      y la **tarifa**, y **una validación bloqueante los relaciona**: `tarifa < mínimo`, criterio 127)*.
      *(**⚠ 9ª ronda, D41** — de esos **dos diales de monto**, **el mínimo es el ÚNICO que la pantalla
      pública conoce**: el cotizador **necesita el mínimo vigente** para poder decir *«te faltan $120»* sin
      quemar el número en el código, y **no necesita —ni recibe— la tarifa de envío**. Ver §H y criterio
      **177**.)*
- [ ] ~~**El envío del vendedor lo ponemos nosotros desde MX$1,000** *(2ª ronda v2.1, D16/D18b; precisado en
      la 3ª, D25 + bordes)*: hay **tres bandas** por monto de la solicitud/oferta — **menos de $500: no se
      compra**; **de $500 (inclusive) a menos de $1,000: se compra y el vendedor paga su envío**, como hoy;
      **de $1,000 (inclusive) en adelante: se compra y la guía la mandamos nosotros**.~~
      **⚠ SUPERSEDED por D31 (5ª ronda)** — se conserva como historial. El **umbral de guía nunca fue un
      pedido del humano**: fue una propuesta de este documento. Ver el bullet siguiente.
- [ ] **SIEMPRE ponemos la guía y SIEMPRE se descuenta del importe a pagar** *(NUEVO 5ª ronda v2.1, **D31** —
      **supersede D18b**; ver §P.4 y §P.12)*: hay **una sola banda** por monto de la solicitud —
      **menos de MX$500: no se crea la solicitud**; **de MX$500 (inclusive) en adelante: se compra, la guía la
      mandamos nosotros y se descuenta del pago una tarifa fija de MX$180** (`bruto − envío = neto`),
      **congelada al ofertar** (D25). **No hay banda intermedia**: **no existe** ningún monto en el que el
      vendedor pague su propio envío. El **borde de MX$500 es inclusivo**. Quedan **dos diales separados** de
      M10 —**mínimo de compra** y **tarifa de envío del buylist**—; el **umbral de guía se retira**.
- [ ] **El descuento del envío se dice EN TODOS LADOS, y antes de aceptar** *(NUEVO 5ª ronda v2.1, **D31** —
      requisito de comunicación explícito del humano)*: **el cotizador**, el **correo de oferta** y los
      **términos** dicen, con todas sus letras, que **el envío lo ponemos nosotros y que SIEMPRE se deduce del
      importe a pagar**. **No es letra chica**: en una oferta de **MX$500** los **MX$180** son el **36%** —el
      vendedor recibe **MX$320**— y **tiene que verlo antes de aceptar**, no después. ~~En el **cotizador** la
      cifra aún no es una oferta, así que ahí se comunica **la regla y el monto de la tarifa**~~; en el **correo
      de oferta** se comunica **el cálculo exacto de esa operación** (bruto, envío y neto, §P.3).
      *(**⚠ ACOTADO por D43 (8ª ronda) y cerrado por D41 (9ª)** — se conserva el tachado como historial: en el
      **cotizador** se comunica **la regla y NADA del monto**; **la cifra de la tarifa no se pinta ahí y
      tampoco se le manda a esa pantalla**. **Lo que NO se movió**: la regla se sigue diciendo en las **tres
      superficies** y el vendedor sigue viendo el cálculo **antes de aceptar**. §H, criterios **174** y
      **177**.)*
- [ ] **Celular obligatorio para vender** *(NUEVO v2.1, D11)*: **no se puede crear una solicitud de venta sin
      un celular de contacto** en la cuenta. Si falta (cuenta creada con **Google** o cuenta vieja con el
      campo vacío), se pide **en ese momento** y la solicitud no avanza hasta capturarlo. Razón de negocio: el
      buylist es el flujo donde **hay dinero, plazos cortos y paquetes en tránsito** — necesitamos poder
      **llamar al vendedor** (ver D12 y §P.9).
- [ ] **Dirección del vendedor obligatoria para crear la solicitud** *(NUEVO 7ª ronda v2.1, **D36/D37**; ver
      §P.2.1)*: **no se puede crear una solicitud de venta sin una dirección de origen confirmada**. **Se pide
      AL CREAR la solicitud, junto con la CLABE** —**no al aceptar la oferta**— y **se reusa la MISMA libreta
      de direcciones** que el cliente ya usa para **recibir sus compras**: si **ya tiene direcciones
      guardadas**, **elige o confirma** una; si **no tiene ninguna**, **la captura ahí mismo**. **No hay
      modelo nuevo, ni pantalla nueva, ni «domicilio de remitente» aparte.** **Razón de negocio, y es
      bloqueante**: **la guía la ponemos nosotros** (D16/D31) y **una etiqueta no se puede comprar sin
      domicilio de origen** — sin este dato, D16 **no era ejecutable**. **El cliente recurrente no re-teclea
      nada.** *(**Costo aceptado explícitamente por el humano**: también se le pide la dirección a gente a la
      que al final **no** le compraremos.)*
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
- [ ] **El correo de oferta muestra TRES montos, SIEMPRE** *(NUEVO 2ª ronda v2.1, D16; **el «cuando aplica»
      se retira en la 5ª ronda por D31**)*: **bruto** (lo que valen las cartas que compramos), **envío** (la
      guía que ponemos nosotros — **en toda oferta, sin excepción**) y **neto** (`bruto − envío`), diciendo
      **explícitamente cuál se deposita**. ~~«cuando aplica»~~ — **ya no hay banda sin envío nuestro**, así
      que **no existe** la variante de correo con un solo monto. Prometer **$1,480** y depositar **$1,350**
      rompe justo la confianza que la oferta vinculante venía a construir. **Lo vinculante con el vendedor es
      el NETO.**
- [ ] **El cliente acepta y la guía sale después** *(Actualizado 2ª ronda v2.1, D16/D19/D20/D21; supersede
      D5, ver §P.4; **5ª ronda, D31: aplica a TODA oferta**)*: aceptar **no pone nada en camino**. **Al
      aceptar** el operador **compra la etiqueta a mano** (fuera del sistema), **captura su número** y **se la
      manda al vendedor**; el vendedor empaqueta, deposita el paquete y **avisa que ya lo mandó**; **el
      operador confirma el envío** y ahí la solicitud pasa a **`en_transito`**. Plazos: **2 días hábiles**
      para aceptar y **3 días hábiles** para que el paquete salga, **contados desde que la guía llega al
      vendedor** ~~(en la banda donde el envío lo paga él, desde la aceptación)~~ — **siempre desde la
      entrega de la guía**, porque **ya no hay banda donde él pague el envío** (D31). **Diales de M10**, ver
      §H.
- [ ] **La solicitud que nadie oferta CADUCA a los 7 días hábiles** *(NUEVO 5ª ronda v2.1, **D33**; ver
      §P.3.1)*: una solicitud **`cotizada`** que **nadie ofertó** en **7 días hábiles** desde su creación
      **caduca** y **sale un correo al cliente diciendo explícitamente que NO PROCEDEREMOS con la oferta**,
      invitándolo a **volver a cotizar cuando quiera**. Razón de negocio: **`cotizada` significa «esperando
      que NOSOTROS ofertemos»**, y dejar a alguien esperando indefinidamente **sin respuesta de ningún tipo**
      es peor que decirle que no. Es un **dial de M10** y se cuenta en **días hábiles** (D14).
      *(**7ª ronda, D39 — no hace falta esperar el plazo para decir que no**)*: **el operador puede cerrar la
      solicitud de inmediato** («**declinar ahora**»), con **el MISMO correo** de «no procederemos» y **el
      MISMO estado terminal**. **No es un desenlace nuevo: es el mismo, sin la espera.** El barrido sigue
      existiendo para las que **nadie tocó**.
      *(**7ª ronda, D38 — el reloj SÍ reinicia**)*: si una oferta emitida **se cancela**, la solicitud vuelve
      a la fila **con los 7 días hábiles COMPLETOS** — una corrección nuestra **no le gasta el plazo al
      cliente** (§P.3.1, criterio 172).
- [ ] Recepción física, verificación de condición y **pago (SPEI)** los opera el admin a mano (ver
      back-office M5), **conciliando contra la guía** capturada. *(Actualizado v2.1, D9)*: el **cherry-pick
      carta por carta ocurre AL OFERTAR**, no al recibir; **verificar tiene solo dos desenlaces** — la carta
      **llega en NM y se paga lo ofertado**, o **no llega en NM y se rechaza** (§P.5). **No hay repreciado
      al recibir.**
- [ ] **Mensaje explícito al vendedor — CUATRO ideas** *(actualizado v2.1; precisado en la 2ª ronda por
      D16; ampliado en la 4ª ronda por D30; **eran TRES y pasan a CUATRO en la 5ª ronda por D31**)*: el
      cotizador/solicitud, el correo de oferta y los términos comunican claramente que
      **(d) *(NUEVO 5ª ronda, D31; **⚠ ACOTADO en la 8ª por D43**)* el envío lo ponemos NOSOTROS en toda
      compra y su costo SIEMPRE se deduce del importe a pagar** ~~—**MX$180**, dicho **antes** de que
      aceptes y **no en letra chica**: en una oferta de $500 son el **36%** y recibes **$320**—~~
      **⚠ D43 (8ª ronda) — la IDEA se dice en las tres superficies; la CIFRA solo en la oferta**: en el
      **cotizador** esta idea va **en palabras y sin ningún número de envío** (ni la tarifa, ni el
      porcentaje, ni un neto estimado); **los MX$180, el 36% y el neto se ven en la oferta —correo y
      pantalla de aceptación—, que es donde el vendedor decide** y donde la tarifa **ya está congelada**
      (§H, §P.3, criterio **174**). **Lo que NO se movió**: sigue siendo obligatorio que lo vea **antes de
      aceptar** y **no en letra chica**. **Siguen siendo CUATRO ideas**: D43 **no quita ninguna**, cambia
      **dónde aparece el número de una de ellas**. Y que
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
      **estados terminales** *(**eran cuatro; la 5ª ronda los subió a CINCO; la 6ª los devuelve a CUATRO** —
      ver abajo)* **`pagada`**,
      **`rechazada`** (el cliente dice que no, o **no responde en el plazo**), **`expirada`** y
      **`abandonada`** (los 30 días de §H). ~~y **`caducada`** *(SUPUESTO de nombre — nadie la ofertó en 7
      días hábiles, D33; §P.3.1)*~~ **⚠ SUPERADO en la 6ª ronda (resolución de la pregunta 27 por el
      arquitecto)**: la caducidad **NO es un quinto estado**, es **`expirada` con motivo `no_offer`**
      —frente a `not_shipped`, que es *«aceptó y no mandó»*—, con el **motivo en columna propia**. **M5 tiene
      que mostrar el motivo**, no solo el estado: la cola y la ficha de solicitud **distinguen los dos
      desenlaces a simple vista**, y los **reportes los separan** (§P.1, §P.3.1, criterio 169).
      **Decisión carta por
      carta AL OFERTAR** (cherry-pick), **mesa de decisión con inventario a
      la vista** (stock propio + piezas en camino + sugerencia no bloqueante, §P.2), **envío del correo de
      oferta** (con **bruto / envío / neto**, D16), **autorización del súper-admin** para las ofertas del
      operador **por encima de su tope** (D13), **captura manual del número de guía** y **confirmación del
      envío** por el operador (D19/D20), **seguimiento de los dos plazos del vendedor en días hábiles** con
      **un recordatorio único por plazo** a un día hábil de vencer (D14/D23), **tarea de «cancelar guía no
      usada»** cuando una solicitud con guía emitida vence (D22), **cola de precio pendiente** y **conversión
      a inventario en un clic** al pagar. La cola muestra el **teléfono del vendedor** y permite ver **qué
      usuarios tienen cotizaciones vivas y cuántas** (§P.9).
      *(NUEVO 5ª ronda v2.1)*: se suman **(a)** el **barrido de caducidad** de solicitudes `cotizada` que
      **nadie ofertó en 7 días hábiles**, con su **correo de «no procederemos»** (D33) — es el **correo
      obligatorio número 4** del ciclo *(**⚠ 8ª ronda: el ciclo tiene CINCO correos, no cuatro** — §P.3,
      criterio 173)*; y **(b)** la **captura OPCIONAL del costo real de la etiqueta** al **confirmar
      el envío**, con **fallback a la tarifa congelada de MX$180** si no se captura (el P&L de M7 usa el real
      cuando existe). **Lo que se le descuenta al vendedor no cambia**: es siempre la tarifa congelada (D25).
      *(NUEVO 7ª ronda v2.1)*: se suman **(a)** la acción **«declinar ahora»** sobre una solicitud
      **`cotizada`** —**cierra la solicitud de inmediato** con el **MISMO correo** de «no procederemos» y el
      **MISMO estado terminal** (`expirada` + `no_offer`), **sin esperar los 7 días hábiles**; queda
      **auditada** con **quién declinó** (D39, criterio 171)—; y **(b)** la **dirección de origen del
      vendedor** —capturada **al crear la solicitud** (D36/D37, §P.2.1)— **a la vista del operador en la
      ficha**, porque es **el dato con el que compra la etiqueta**. **M5 no captura direcciones**: **muestra
      la que el vendedor eligió o confirmó** de su libreta.
      *(NUEVO 8ª ronda v2.1)*: **los correos obligatorios del ciclo son CINCO** (§P.3, tabla), y M5 es donde
      se dispara el quinto: al **cancelar una oferta YA ENVIADA** sale el correo **«cancelamos la oferta»**
      y la solicitud **vuelve a la fila con 7 días hábiles completos**; al **cancelar una oferta que todavía
      esperaba autorización** **no sale ningún correo y no se reinicia ningún reloj**. **La pantalla de
      cancelación tiene que decirle al operador cuál de las dos cosas va a pasar** —**si el vendedor se va a
      enterar o no**— **antes de que confirme**: es la diferencia entre corregir un número por dentro y
      mandarle una cancelación a alguien. **Ambas quedan auditadas** (quién canceló y cuándo). Criterio
      **173**.
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
      *(NUEVO 5ª ronda v2.1)*: el **gasto de envío del buylist** se registra con el **costo real de la
      etiqueta cuando el operador lo capturó** y con la **tarifa congelada de MX$180 cuando no** (*fallback*).
      **Nunca entra al costo de la pieza** (sigue siendo el **bruto ofertado**) y **nunca cambia el neto
      pagado al vendedor** — ver §H, §P.4 y criterios **135/149/166**.
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
      D8)* los **dos plazos del ciclo de buylist** *(**⚠ son TRES desde la 5ª ronda** — ver el bloque de D33
      más abajo)*: **plazo para aceptar la oferta** (default **2 días hábiles**) y **plazo para que el paquete
      salga** (default **3 días hábiles**). Ambos son **diales editables sin deploy y auditados**, no
      constantes en código.
      *(NUEVO 2ª ronda v2.1; **corregido en la 5ª**)*: se suman ~~cuatro~~ **tres** diales más, todos
      editables sin deploy y auditados — **mínimo de compra** (default **MX$500** *inclusivo*, D18),
      **tope de oferta del operador** (monto de **bruto** por encima del cual la oferta la **autoriza el
      súper-admin**, D13) y **tope general de piezas por variante** que dispara la sugerencia de «no comprar»
      (D15).
      ~~Y el **umbral de guía a nuestro costo** (default **MX$1,000** *inclusivo*, D18b).~~
      **⚠ RETIRADO en la 5ª ronda (D31): dial SIN OBJETO — no se implementa.** Ahora **la guía va SIEMPRE por
      nuestra cuenta** desde el mínimo, así que **no hay umbral que configurar** (§P.12).
      *(NUEVO 5ª ronda v2.1, **D33**)*: se suma el **plazo de caducidad de la solicitud sin oferta** (default
      **7 días hábiles**, contados desde la creación): pasado ese plazo sin que nadie oferte, la solicitud
      **caduca** —queda **`expirada` con motivo `no_offer`**, 6ª ronda— y sale el **correo de «no
      procederemos»**. Es **dial editable sin deploy y auditado**, y **se congela por solicitud** como los
      demás plazos (P18).
      *(NUEVO 6ª ronda v2.1, **D34**)*: se suma el **neto mínimo para EMITIR una oferta** (default
      **MX$200**). **No se puede emitir** una oferta cuyo **neto** (`bruto ofertado − tarifa de envío`) quede
      **por debajo de ese número**: el operador **compra más líneas o no oferta**. Es **dial editable sin
      deploy y auditado**, **se congela por solicitud** como los demás y **es el NOVENO dial del ciclo**
      (§P.10). **Ojo con dónde vive**: **no** es una validación entre diales de esta pantalla —**M10 no ve el
      recorte que hizo el operador**—; es un **bloqueo en la emisión** (§P.2, criterio 167). Lo que M10
      configura aquí es **el número**, no el momento.
      *(NUEVO 3ª ronda v2.1 — los números que faltaban, ya fijados por el humano; **corregido en la 4ª**)*:
      **tope de oferta del operador = MX$1,500** (D24), **tope general de piezas por variante = 10** (D29) y
      **tarifa de envío del buylist = MX$180** (D25; **distinta** del envío de retiro de MX$175). Se suma
      además el dial de **alerta de «ya lo mandé» sin confirmar** (default **5 días hábiles**, P17).
      ~~Y el **umbral de «recorte material» = 20%** del bruto, el que dispara la pregunta al vendedor en un
      rechazo parcial (D28).~~ **⚠ RETIRADO en la 4ª ronda (D30): dial SIN OBJETO — no se implementa** (§P.10).
      **La tabla completa de los ~~OCHO~~ NUEVE diales del ciclo vive en §P.10**, que es su origen único
      *(**6ª ronda, D34**: entra el **neto mínimo para EMITIR una oferta**, default **MX$200**).*
      *(3ª ronda, P18)*: **cada dial de plazo y la tarifa de envío se CONGELAN por solicitud** en el momento
      en que se fijan — cambiar el dial **solo afecta a las solicitudes nuevas** y **nunca** mueve una fecha
      o un monto ya comunicados por correo.
      *(validación entre diales — **reformulada en la 4ª ronda (D30) y RE-ANCLADA en la 5ª (D31)**)*: M10
      **impide** guardar una combinación donde la **tarifa de envío del buylist** sea **igual o mayor que el
      MÍNIMO DE COMPRA** —hoy **MX$180 < MX$500**—, porque el mínimo es **inclusivo** y ahí **la solicitud más
      chica que aceptamos, con TODO aprobado, depositaría MX$0** (§P.12, criterio 127).
      ~~4ª ronda: que la tarifa no fuera igual o mayor que el **umbral de guía** (**MX$1,000**).~~ **Ese dial
      dejó de existir con D31**, así que la validación se **re-ancla** en el dial que sí quedó. ~~Y antes de
      eso: que la tarifa no superara `umbral de guía × (1 − umbral de recorte material)` —hoy **$800**.~~
      **Esa fórmula citaba un dial que ya había dejado de existir.**
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
      incidente**, con **tope por carta configurable por el dueño** (M10). **NO hay seguro formal** del
      inventario en custodia (decisión **63**, 2026-09-01): la bóveda es **resguardo físico**, y esta reposición
      es una **obligación de la plataforma**, no una cobertura aseguradora. **Prohibido decir «asegurada» /
      «insured»** en cualquier superficie **que hable de la custodia** (verificable: **criterio 120**, que lista
      las exclusiones legítimas).
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
      D14/D21/D23; **ampliado en la 5ª ronda por D33**; ver §P)*: **antes** de que la carta viaje corren
      ~~otros **dos** plazos~~ **otros TRES plazos, distintos de los de arriba** *(el tercero, el de
      caducidad, lo agrega **D33** — y es **el único que corre contra NOSOTROS**)*:
      - **2 días hábiles para aceptar la oferta** (contados desde que **sale el correo** de oferta). **Sin
        respuesta en el plazo ⇒ la solicitud queda `rechazada`** (terminal) y la oferta deja de ser válida.
      - **3 días hábiles para que el paquete salga**, contados **desde que la guía llega al vendedor** (D21).
        ~~*(…y **desde la aceptación** cuando el envío lo paga él.)*~~ **⚠ Esa segunda mitad se RETIRA en la 5ª
        ronda (D31)**: **ya no existe** ninguna banda en la que el vendedor pague su envío, así que el reloj
        arranca **siempre con la entrega de la guía**. **Sin envío en el plazo ⇒ la oferta `expira`**, la
        solicitud **se cancela** y **se le notifica al vendedor**.
      - **7 días hábiles para que NOSOTROS ofertemos** *(NUEVO 5ª ronda, **D33**)*, contados **desde que se
        crea la solicitud**. **Sin oferta en el plazo ⇒ la solicitud CADUCA** —queda **`expirada` con motivo
        `no_offer`**, *6ª ronda*— y **sale un correo
        diciendo explícitamente que NO PROCEDEREMOS con la oferta**, invitando al cliente a **volver a
        cotizar cuando quiera**. **Es el único plazo del ciclo que corre contra NOSOTROS**, no contra el
        vendedor — por eso **no lleva recordatorio al cliente** (avisarle de un plazo que depende de nuestra
        carga de trabajo no le sirve de nada; ver §P.3.1).
        ~~*(**6ª ronda**: el reloj **cuenta SIEMPRE desde la creación de la solicitud** y **no se reinicia**
        si una oferta emitida se cancela — resolución del arquitecto a la pregunta 27, que **corrige el
        supuesto** que este documento había redactado. Ver la bandera de §P.3.1.)*~~
        **⚠ SUPERADO en la 7ª ronda (D38)**: **el reloj SÍ se reinicia al cancelar una oferta emitida** — la
        solicitud **vuelve a la fila con los 7 días hábiles COMPLETOS**. Sigue contando **desde la creación**
        mientras nadie cancele nada; lo que cambia es que **una cancelación nuestra le devuelve el plazo
        entero al cliente**, porque **el plazo corre contra NOSOTROS** y una corrección nuestra **no puede
        gastarle su tiempo a él** (§P.3.1, criterio 172).
      - **Un recordatorio, uno POR PLAZO DEL VENDEDOR** (D23): a **un día hábil** de vencer sale **un** correo
        de aviso, **una sola vez** — no en cada corrida del barrido. *(3ª ronda, respuesta a la pregunta 21:
        aplica a **cada uno de los dos plazos del vendedor** —aceptar y enviar—, así que en un ciclo puede
        haber **hasta dos** recordatorios, **nunca más de uno por plazo**.)* *(5ª ronda, D33: el **plazo de
        caducidad NO suma un tercer recordatorio** — es nuestro, no suyo.)*
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
- [ ] **Buylist — tres montos que no se mezclan: bruto, envío y neto** *(NUEVO 2ª ronda v2.1, D16;
      **5ª ronda, D31: aplica SIEMPRE**)*: ~~cuando la guía la ponemos nosotros~~ **en toda compra de
      buylist** —porque **la guía la ponemos siempre**—, el dinero del buylist se lee en **tres cifras** y
      **cada una tiene un papel distinto**:
      - **BRUTO** = lo que valen las cartas que compramos. Es el **costo de adquisición del inventario** (el
        que va al **costo de la pieza** y al **P&L por carta** de M7) y es el monto sobre el que se juzgan
        los **topes AML y el INE**.
      - **ENVÍO** = **MX$180** *(3ª ronda, D25 — dial de M10, **congelado al ofertar**)*. Es **gasto
        operativo del negocio**, **NO** forma parte del costo de la pieza. Si se mezclara con el costo, **el
        P&L por carta quedaría sucio** y dos piezas idénticas tendrían costos distintos según cuánto pesó el
        paquete en que llegaron. Es una **tarifa fija conocida al ofertar**, no lo que costó la etiqueta
        real: si la etiqueta sale **más cara la absorbemos**, si sale **más barata es margen nuestro**
        (§P.4). **No es el mismo dial** que la tarifa de envío de retiro (MX$175).
        *(NUEVO 5ª ronda — **el costo REAL de la etiqueta se puede capturar**; cierra la contradicción
        criterio 135 × D19)*: al **confirmar el envío**, el operador puede **capturar el costo real de la
        etiqueta**. **Es opcional**, y si no se captura **el gasto se registra con la tarifa congelada de
        MX$180** (*fallback*). **El P&L (M7) usa el real cuando existe y la tarifa cuando no.** **Lo que se
        le descuenta al vendedor NO cambia nunca**: sigue siendo **la tarifa congelada** (D25) — capturar el
        costo real **hace visible el margen o la pérdida del envío**, **no** mueve el neto de nadie.
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
- [ ] ~~**Buylist — mínimo de compra y umbral de guía: dos diales, tres bandas** *(2ª ronda v2.1, D18/D18b;
      bordes cerrados en la 3ª)*: **menos de MX$500 ⇒ no se crea la solicitud**; **de MX$500 (inclusive) a
      menos de MX$1,000 ⇒ se compra y el vendedor paga su envío**, como hoy; **de MX$1,000 (inclusive) en
      adelante ⇒ se compra y la guía la ponemos nosotros**. Los **dos bordes inclusivos**.~~
      **⚠ SUPERSEDED por D31 (5ª ronda)** — se conserva como historial. Ver el bullet siguiente.
- [ ] **Buylist — un mínimo, un dial de tarifa, UNA SOLA BANDA: siempre ponemos la guía y siempre se
      descuenta** *(NUEVO 5ª ronda v2.1, **D31** — **supersede D18b**; ver §P.12)*: **menos de MX$500 ⇒ no se
      crea la solicitud**; **de MX$500 (inclusive) en adelante ⇒ se compra, la guía la ponemos nosotros y se
      descuentan MX$180** del pago (`bruto − envío = neto`). **No hay banda intermedia**: **no existe** ningún
      monto en el que el vendedor pague su propio envío. **El borde de MX$500 es inclusivo** —exactamente
      $500 se compra **y lleva guía nuestra**—, **a favor del vendedor**. **El umbral de guía (MX$1,000) se
      retira como dial**; quedan **dos diales independientes**: **mínimo de compra** y **tarifa de envío del
      buylist** (mover uno **no** mueve el otro). El mínimo se **valida en el servidor**, no solo en el
      cotizador, y **gatea la creación de la solicitud, NO la oferta**: si tras el cherry-pick el bruto
      ofertado cae por debajo del mínimo, **la oferta sale igual** *(3ª ronda, respuesta a la pregunta 19 —
      **sin cambio**)*.
      **⚠ Consecuencia que se señala, no se esconde (5ª ronda)**: como el mínimo **no se re-aplica a la
      oferta** y ahora **el envío se descuenta siempre**, una oferta recortada por cherry-pick **por debajo de
      MX$180 deposita MX$0 aunque todo llegue en NM**. Antes eso no podía pasar, porque en esa zona el
      vendedor pagaba su propio envío. **Sigue sin haber deuda del vendedor** (el neto se topa en cero,
      criterio 152) y **el vendedor ve el neto ANTES de aceptar** (D31), así que puede rechazar. **Si el
      humano quiere además un piso de neto para siquiera emitir la oferta, es alcance nuevo** — **pregunta
      abierta 25**.
- [ ] **Buylist — el envío se deduce SIEMPRE, y se dice en todos lados antes de aceptar** *(NUEVO 5ª ronda
      v2.1, **D31** — requisito de comunicación explícito del humano; **⚠ ACOTADO en la 8ª ronda por D43 en
      lo que toca al COTIZADOR**)*: el **cotizador**, el **correo de
      oferta** y los **términos** dicen que **la guía la ponemos nosotros en toda compra** y que su costo
      **SIEMPRE se deduce del importe a pagar**. **No va como letra chica**: en una oferta de **MX$500** los
      **MX$180** son el **36%** —el vendedor recibe **MX$320**— y **debe verlo antes de aceptar**. *(El humano
      aceptó ese peso **a ojos abiertos**; **tarifa y mínimo siguen siendo diales** y, si duele, se mueven.)*
      ~~El **36%**, los **MX$180** y los **MX$320** se pintan en las tres superficies.~~ **⚠ CORREGIDO por
      D43 (8ª ronda): eso valía para el mensaje, no para las cifras.** **La REGLA se sigue diciendo en las
      tres superficies** —esa parte de D31 **no se toca**—; **los NÚMEROS solo viven en la oferta**. En el
      **cotizador** la regla se dice **en palabras y sin ninguna cifra de envío** (bullet siguiente).

- [ ] **Buylist — D43: EL COTIZADOR DICE EL ENVÍO EN PALABRAS; LOS TRES MONTOS VIVEN EN LA OFERTA** *(NUEVO
      8ª ronda v2.1, **D43** — decisión del humano; **acota D31**, no la revierte)*:
      **(1) En el cotizador**: se dice **la regla, en una frase cualitativa** —*«nosotros nos encargamos de
      la guía y su costo se descuenta del pago»*— y **NADA más sobre el envío**: **sin la cifra de la
      tarifa**, **sin la resta**, **sin neto estimado**, **sin porcentajes**, y **sin expresar el faltante
      del mínimo en términos de envío** (*«te faltan $120 para cubrir el envío»* queda **prohibido**: mezcla
      dos cosas que no son la misma y **miente sobre qué es el mínimo**).
      **(2) En la oferta —correo y pantalla de aceptación—**: van **los TRES montos** (bruto, envío, neto),
      **con la resta a la vista** y con **cuál se deposita** dicho explícitamente. **Sin cambio: D16/D31
      siguen íntegras ahí** (§P.3, criterio 134).
      **Por qué, dicho como requisito de negocio**: el cotizador **es indicativo y lo dice** —los precios se
      mueven y **puede que no compremos todas las líneas**—, así que restarle **un envío exacto** a un total
      que todavía no es un trato es **precisión falsa**: viste de vinculante una cifra que no lo es. Y hay
      una razón peor, y es la que decide: **ese neto del carrito era sistemáticamente OPTIMISTA**, porque el
      recorte del operador **solo puede quitar líneas** — la pantalla pintaba **la mejor cifra posible**,
      nunca la esperada, y fabricaba **exactamente la decepción** que la oferta vinculante existe para
      evitar. Una cifra que **solo puede empeorar** no es una estimación: es una promesa que no hicimos.
      **⚠ EL FALTANTE DEL MÍNIMO SE QUEDA, ENTERO — el criterio 132 NO cambia**: *«te faltan $120 para el
      mínimo de $500»* **sí se pinta en el cotizador**, con **sus dos frentes (a) y (b) exigidos tal cual**.
      **Un faltante del mínimo no es un monto de envío**: es una cifra sobre **las cartas del vendedor**, no
      sobre **nuestro servicio**, y sin ella un «no» seco lo manda a otro lado sin decirle qué le falta.
      **Quien lea este bullet y quiera retirar también la resta del faltante, está leyendo mal**: son dos
      restas distintas y solo una se va.
      **⚠ Consecuencia asumida, no escondida**: **el correo de oferta es la PRIMERA vez que el vendedor ve
      el monto del envío**. Eso obliga a que ese correo **no dé por sabido nada** (§P.3, criterio 175) y deja
      una pregunta de negocio abierta —¿se cae más gente cerca del mínimo?— que **se responde midiendo**, no
      repintando la resta: ver «Riesgos y banderas».

- [ ] **Buylist — D41: LA PANTALLA PÚBLICA CONOCE EL MÍNIMO, Y SOLO EL MÍNIMO** *(NUEVO 9ª ronda v2.1,
      **D41** — regla de negocio que **hace ejecutable a D43 y al criterio 132(a)**; **no es diseño de
      endpoint**, eso es del arquitecto y ya está resuelto)*:
      **(1) Qué SÍ sabe la pantalla pública**: el **mínimo de compra vigente** (**MX$500** hoy). Lo necesita
      para cumplir el criterio **132(a)** —decir **cuánto falta** *antes* de que el vendedor intente enviar
      la solicitud— **con el número correcto** y **sin quemarlo**: el mínimo es un **dial de M10** y el día
      que el negocio lo mueva, **la pantalla tiene que moverse con él**. Un mínimo escrito a mano en el
      frontend **es una promesa que caduca en silencio**.
      **(2) Qué NO sabe: la tarifa de envío.** **No se publica a ninguna superficie pública** —ni para
      pintarla, ni «por si acaso», ni escondida en el dato que viaja detrás de la pantalla—. Es **el mismo
      dial** que D43 sacó del cotizador, y **el resto de los diales de M10 tampoco se publican** (topes,
      plazos, piso de neto, sugerencias de la mesa): **son controles internos**.
      **Por qué, dicho como requisito de negocio y no como preferencia técnica**: **D43 no puede depender de
      que el frontend se porte bien**. Mientras la tarifa **llegue** a la pantalla, pintarla es **un
      descuido de una línea** —hoy, o en el rediseño de dentro de seis meses, o en un experimento de
      marketing— y **nadie lo notaría hasta que un vendedor lo vea**. **Lo que no llega, no se puede pintar
      por error.** Es la misma lógica con la que el mínimo **se valida en el servidor** y no solo en el
      cotizador (criterio 132b): **la superficie del cliente no se defiende sola**.
      **Lo que esto NO cambia**: la **regla en palabras** sigue diciéndose en el cotizador (D31/D43) —**decir
      que el envío se descuenta no requiere conocer su monto**—, y **los tres montos siguen viviendo en la
      oferta**, que es **autenticada** y usa la **tarifa congelada** de esa solicitud (§P.3, criterio 174e).
      *(**Alcance, para que no se lea de más**: este bullet habla del **cotizador y de las superficies
      públicas del buylist**. Los **términos** son otra superficie y su tratamiento sigue con el supuesto de
      la **pregunta abierta 30**.)*
- [ ] **Buylist — la solicitud que nadie oferta CADUCA a los 7 días hábiles** *(NUEVO 5ª ronda v2.1, **D33**;
      ver §P.3.1)*: **`cotizada` significa «esperando que NOSOTROS ofertemos»**. Si **nadie la oferta en 7
      días hábiles** desde su creación, la solicitud **caduca** (estado **terminal**) y **sale un correo al
      cliente diciendo explícitamente que NO PROCEDEREMOS con la oferta**, invitándolo a **volver a cotizar
      cuando quiera**. **No es un «no pudimos procesar tu solicitud» vago**: el cliente **debe saber a qué
      atenerse**. Es un **dial de M10**, se cuenta en **días hábiles** (D14) y **no lleva recordatorio al
      cliente** — es un plazo **nuestro**, no suyo.
- [ ] **Buylist — NINGÚN CORREO LE AFIRMA AL VENDEDOR UN HECHO QUE NO OCURRIÓ** *(NUEVO 8ª ronda v2.1 —
      regla transversal; **es la que fija el conteo en CINCO**, §P.3)*: los **correos obligatorios del ciclo
      son CINCO** —**oferta**, **recordatorio**, **expiración**, **«no procederemos»** y **«cancelamos la
      oferta»**—, y el reparto **no es de estilo: es de veracidad**. La regla que los gobierna es una sola:
      **un correo = un hecho**. De ella salen las tres consecuencias que hay que respetar:
      **(a)** **decirle «se venció tu plazo» a alguien cuyo plazo no venció es mentirle**, y decírselo cuando
      **el que canceló fuimos nosotros** es además **echarle la culpa** — por eso la cancelación tiene correo
      propio;
      **(b)** **dos caminos al mismo hecho comparten correo y texto** (el barrido y «declinar ahora» dicen lo
      mismo; los dos plazos del vendedor vencen igual): **al vendedor no le corresponde saber por cuál puerta
      entró la decisión** —eso es evaluación nuestra y vive en la bitácora—; y
      **(c)** **hay un caso en el que el correo correcto es NINGUNO**: cancelar una oferta **que nunca
      salió** —la que esperaba autorización—. **Escribirle sería contarle una decisión interna que jamás le
      concernió** y revelarle un control nuestro. **El silencio también es una decisión de comunicación**, y
      aquí es la correcta.
      **Aplica a los cinco, sin excepción, todo lo que este documento ya exigía «para los correos del
      ciclo»**: nada de **CLABE** (ni enmascarada), nada de **datos de terceros**, nada de **otras
      solicitudes**, nada de **cifras internas de la mesa** (posición, sugerencia, topes) y nada de
      **domicilio**. **La regla nunca dependió del número.**
      *(**⚠ 9ª ronda, D42 — la regla no se detiene en la bandeja**: **ninguna superficie del vendedor puede
      contradecir a otra**. Si el correo 5 le afirma que hubo una oferta y que la cancelamos, **el portal
      tiene que decir lo mismo** —hubo oferta, se canceló, y cuándo—; y donde **el correo correcto es
      ninguno**, **la pantalla correcta también es ninguna**. §P.3, criterio **176**.)*

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
- [ ] **El OBJETIVO del bounty es OBLIGATORIO** *(NUEVO 5ª ronda v2.1, **D32**; ver §P.2 y criterio 164)*:
      **no se puede dar de alta un bounty sin capturar su objetivo** (`bountyTargetQty` — *«hasta tener N en
      inventario»*). **Sin objetivo, no hay bounty**: el alta **no se guarda**.
      **El hueco que cierra**: la mesa de decisión le da **precedencia al bounty sobre el tope general de 10
      piezas** (D29), así que una variante con **bounty vivo y sin objetivo** **nunca** pintaría «no comprar»,
      **por muchas copias que acumule** — un techo de compra que **no existe**. Con el objetivo obligatorio,
      **el caso «bounty sin meta» deja de existir** y **siempre hay contra qué comparar la posición**.
      **Alcance mínimo, a propósito**: **solo se exige el objetivo donde hoy se configuran los bounties**.
      **NO se construye panel de bounties** — el humano lo pidió y decidió dejarlo como **proyecto aparte**
      (ver «Fuera de alcance»).
      ~~*(**SUPUESTO** — bounties **ya creados** sin objetivo: se les **exige el dato al editarlos** y,
      mientras no lo tengan, la mesa los trata como **«sin bounty» para efectos de la sugerencia** y aplica el
      **tope general de 10** —el lado seguro del error: preferimos frenar de más a comprar sin techo—. **No
      afecta el precio**: el bounty sigue ganando la precedencia de compra (§N.6). Ver **pregunta abierta
      26**.)*~~ **⚠ SUPUESTO SUPERADO por D35 (6ª ronda)** — ver el bullet siguiente. **No hay bounties
      tratados como «sin bounty»**, ni bounties sin meta esperando a que alguien los edite.
- [ ] **El objetivo por defecto es 2** *(NUEVO 6ª ronda v2.1, **D35**; cierra la pregunta 26; ver criterio
      168)*: el humano fijó el número — **«hasta tener 2 en inventario»**. Tres cosas, y nada más:
      **(a)** **es el valor por defecto al dar de alta** un bounty: el campo llega **prellenado con 2**,
      así que el objetivo sigue siendo **obligatorio** (D32) pero **deja de ser fricción**;
      **(b)** **es el valor con el que se llenan los bounties viejos** que hoy no tienen meta —**se les
      asigna 2 y siguen vivos**: **NO se desactivan**, **NO salen de la vitrina** y **NO cambian de
      precio**—;
      **(c)** **sigue siendo editable por bounty**: **2 es el default, no un tope rígido**. Un bounty puede
      pedir 1 o 20 si el dueño lo decide.
      **Por qué esto cierra el hueco de verdad**: con (b), **el caso «bounty sin meta» deja de existir
      también hacia atrás** —no solo para las altas nuevas—, así que la precedencia de §P.2 **siempre tiene
      un número contra el cual medir la posición** desde el día uno, sin depender de que alguien recuerde
      editar los viejos.
      *(**Nota**: **2 NO es un dial de M10** — es el **valor por defecto de un campo**, y el campo se edita
      bounty por bounty. Los **nueve diales del ciclo** siguen siendo los de §P.10.)*

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
> aparece un **mínimo de compra** (D18) y un ~~**umbral de guía** (D18b)~~ *(**⚠ retirado en la 5ª ronda por
> D31: la guía va SIEMPRE**)*; **ofertar se delega al operador hasta
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
> **Qué SÍ cambió en la 5ª ronda (D31–D33 — CORRECTIVA)**: **(D31)** **se elimina el umbral de guía**: la
> intención del humano **siempre fue mandar la guía SIEMPRE**, así que **las tres bandas pasan a dos** —
> **&lt;$500 no se crea la solicitud; de $500 en adelante se compra, ponemos la guía y SIEMPRE se descuenta**—
> y hay que **decirlo en el cotizador, en el correo de oferta y en los términos**, no en letra chica; el
> **dial «umbral de guía» se retira** y la **validación cruzada del criterio 127 se re-ancla** en
> **`tarifa de envío` < `mínimo de compra`** (**$180 < $500**). **(D32)** el **objetivo del bounty pasa a ser
> obligatorio** —con eso el «bounty sin meta» deja de existir y el tope de 10 siempre tiene con qué
> compararse—, **sin construir panel de bounties** (proyecto aparte). **(D33)** una solicitud que **nadie
> ofertó en 7 días hábiles CADUCA**, con un **correo que dice explícitamente que NO PROCEDEREMOS** — es el
> **CUARTO correo obligatorio** *(**⚠ 8ª ronda: el ciclo tiene CINCO** — criterio 173)* y **un dial más**,
> así que la tabla de §P.10 **vuelve a ocho diales** y los
> ~~**estados terminales pasan de cuatro a cinco**~~ *(**⚠ 6ª ronda: NO — siguen siendo CUATRO**; la
> caducidad es **`expirada` con motivo `no_offer`**)*. Se resuelve además el **costo real de la etiqueta**
> (captura **opcional**, *fallback* a la tarifa congelada). Ver **§P.3, §P.3.1, §P.4, §P.10, §P.12**.
> **SEXTA RONDA (D34–D35 + resolución de la pregunta 27 por el arquitecto)**: **(D34)** **no se puede EMITIR
> una oferta cuyo NETO sea menor a MX$200** —bloqueo **en la emisión**, no en el dial ni en la aceptación;
> el operador **compra más líneas o no oferta**—, así que la tabla de §P.10 pasa de **ocho a NUEVE diales**.
> **(D35)** el **objetivo del bounty tiene default 2** y **los bounties viejos se llenan con 2** (no se
> desactivan), **editable por bounty**. **(P27)** la **caducidad es un MOTIVO de `expirada`**
> (`no_offer` / `not_shipped`), **no un quinto estado**; **caduca aunque haya oferta esperando autorización**
> —**el barrido la anula**— y ~~**el reloj NO reinicia** al cancelar una oferta~~ *(**⚠ SUPERADO en la 7ª
> ronda por D38: SÍ reinicia**)*. Ver **§P.1, §P.2, §P.3.1, §P.10, §P.12, §N.6** y criterios **167–169**.
> **SÉPTIMA RONDA (D36–D40 + o.17) — el hueco bloqueante y dos correcciones que este documento había
> señalado**: **(D36/D37)** **el ciclo nunca pedía la DIRECCIÓN del vendedor** —verificado: **cero menciones
> de dirección, domicilio o remitente en toda la §P**—, así que **D16 «la guía la mandamos nosotros» no era
> ejecutable**: **no hay etiqueta sin domicilio de origen**. Se pide **al CREAR la solicitud**, junto con la
> CLABE, **reusando la MISMA libreta de direcciones** de las compras del cliente, y **sin dirección no se
> crea la solicitud** (**§P.2.1**, nueva). **(D38)** **cancelar una oferta devuelve la solicitud a la fila
> con los 7 días hábiles COMPLETOS** — **«un plazo, un origen» queda superado**; **riesgo nuevo señalado**:
> el bucle cancelar/re-emitir. **(D39)** existe **«declinar ahora»**: el operador **cierra la solicitud de
> inmediato** con el **mismo correo** y el **mismo estado terminal**, **sin la espera**. **(D40)** el **piso
> de neto es INCLUSIVO** —**MX$200 exactos SÍ se emiten**—, confirmado sin cambio. **(o.17)** se corrigen los
> **ejemplos de «neto MX$20/MX$0» que quedaban como válidos** en §P.5.1 y §P.12 (la **regla** del criterio
> 158c **no cambia**). Ver **§P.1, §P.2, §P.2.1, §P.3, §P.3.1, §P.4, §P.5.1, §P.10, §P.11, §P.12**, **§E**,
> **§H**, **M5/M6** y criterios **170–172**.
> **Alcance de esta feature**: el **ciclo** (decidir, comunicar, comprometer, **mandar la guía**, recibir,
> pagar y publicar), los **estados nuevos** *(cuatro en el primer pase; ~~**el terminal `caducada` de D33 es
> el quinto**~~ — **⚠ 6ª ronda: no hay quinto estado, hay un MOTIVO nuevo en `expirada`**)*, los **tres
> plazos** *(**eran dos**: se suma el de caducidad, D33)*, los ~~**CUATRO**~~ **CINCO correos** del
> ciclo *(**eran tres**: se suma el de «no procederemos», D33; **⚠ 8ª ronda: y el de «cancelamos la
> oferta», que estaba mal fusionado dentro del de expiración** — §P.3, criterio 173)*, la **mesa de
> decisión** del admin —**con el
> bloqueo de emisión por neto mínimo**, D34— y el
> **cierre hasta publicar**. *(**7ª ronda**: se suma el **dato que faltaba para que «mandar la guía» sea
> ejecutable** — la **dirección de origen del vendedor**, pedida **al crear la solicitud** y **reusando la
> libreta de direcciones que ya existe**; **no** es un modelo nuevo ni una pantalla nueva, D36/D37.)*
> **Fuera**: la **integración con paquetería** —la etiqueta se compra a mano,
> D19—, el **panel de bounties** (D32, confirmado en la 6ª) y **cualquier «libreta de remitentes» separada de
> la del comprador** (D37). El schema, el contrato, las plantillas de correo
> y el tratamiento visual los definen arquitecto y ux-ui; aquí solo se fija el **requisito de producto**.

**P.1 — Las ocho fases y los estados**

| # | Fase | Estado al terminar | Quién actúa | Qué cambia respecto a hoy |
|---|---|---|---|---|
| 1 | **Cotiza** | `cotizada` | Cliente | **Igual que hoy** (cotizador público, monto derivado server-side, §E) + **mínimo de MX$500** (D18). *(5ª ronda, D33)*: **caduca a los 7 días hábiles** si nadie la oferta (§P.3.1). *(**7ª ronda, D36/D37**)*: **aquí se piden la CLABE y la DIRECCIÓN de origen** —de la **libreta que ya existe**—, y **sin dirección no se crea la solicitud** (§P.2.1) |
| 2 | **Ofertamos** | `ofertada` | Súper-admin, **u operador hasta su tope** (D13) | **NUEVO** — se decide línea por línea y **sale el correo con desglose, bruto/envío/neto y fecha límite** |
| 3 | **El cliente acepta** | `aceptada` | Cliente | **NUEVO** — dijo que sí, pero **todavía no hay nada en camino** |
| 4 | **Sale el paquete** | `en_transito` | **Operador** (confirma el envío, D20) | **NUEVO** — **la guía la ponemos nosotros SIEMPRE** *(5ª ronda, D31 — ~~arriba del umbral~~)* y **se compra AL ACEPTAR** (D21) |
| 5 | **Recibimos** | `recibida` | Admin / operador | Igual que hoy, ahora **conciliando contra la guía** |
| 6 | **Verificamos** | `verificación` → `aprobada` | Admin / operador | Igual que hoy (**NM carta por carta**), con **dos desenlaces** (D9). *(4ª ronda, D30 — **corrige** lo que la 3ª ronda ponía aquí)*: un **rechazo parcial NO abre estado ni pregunta**; se paga **lo aprobado al precio ofertado** y las rechazadas se devuelven según §H (§P.5.1). **El ítem `ajustada` NO se usa en este ciclo** |
| 7 | **Pagamos** | `pagada` | Súper-admin | Igual que hoy (**SPEI**) + **se deposita el NETO** (D16), **nunca negativo** + **conversión a inventario** |
| 8 | **Publicamos** | pieza **a la venta** | Admin / operador | **NUEVO** — cerrar el ciclo: **ubicación + precio ⇒ publicada** |

- [ ] **Estados terminales — ~~son cuatro~~ ~~SON CINCO~~ SON CUATRO** *(actualizado 2ª ronda v2.1, cierra la
      pregunta 10; **la 5ª ronda (D33) los subió a cinco; la 6ª los devuelve a CUATRO** — resolución de la
      pregunta 27 por el arquitecto)*: **`pagada`** (el ciclo terminó bien), **`rechazada`** —el cliente dice
      que no, **o no responde en el plazo de aceptación** (D3)—, **`expirada`** —**dos causas**, ver el
      bullet siguiente— y **`abandonada`** —los **30 días** de §H con la carta ya en nuestras manos—.
      ~~y **`caducada`** *(NUEVO 5ª ronda, D33)*~~ **⚠ SUPERADO en la 6ª ronda: no es un estado.** Ninguna
      deja nada pendiente ni cartas comprometidas. **Todo lo que no es terminal es una «solicitud viva»**
      (§P.9).
- [ ] **`expirada` tiene DOS causas y el MOTIVO se guarda aparte** *(5ª ronda D33; **REDACTADO DE NUEVO en la
      6ª — resolución de la pregunta 27 por el arquitecto**)*: los **dos desenlaces siguen siendo distintos y
      **tienen que poder distinguirse**, pero **no son dos estados**:
      - **`expirada` + motivo `not_shipped`** = *«aceptaste y no mandaste»* — **el plazo era del vendedor**
        (D4);
      - **`expirada` + motivo `no_offer`** = *«no procederemos con la oferta»* — **el plazo era NUESTRO**
        (D33, §P.3.1). *(**7ª ronda, D39**: a este motivo se llega **por dos caminos y un solo desenlace** —
        **el barrido** a los 7 días hábiles, **o** el operador apretando **«declinar ahora»** el día 1—.
        **Mismo estado, mismo motivo, mismo correo**: el camino **no** se le comunica al cliente, porque para
        él **es la misma respuesta**. Lo que sí queda registrado —para auditoría y reportes— es **si lo cerró
        una persona o el barrido**, y **quién**.)*
      **El motivo se persiste en columna propia**, no se deriva ni se infiere. **Razón del arquitecto, que
      este documento adopta**: *un estado que se comporta **idéntico** a otro en todas las reglas —cierre,
      purga de INE, cuota, «no se revive»— **no es un estado, es un atributo**; pero **la causa sí importa**
      para el correo y **no es derivable**.*
      **El requisito de negocio NO cambia**: llevan **correos distintos**, significan cosas opuestas para el
      cliente y para los reportes, y **mezclarlas sería mentir en las dos**. Lo que cambia es **dónde vive la
      distinción**: en el **motivo**, no en el nombre del estado. **Toda superficie que muestre el desenlace
      —cola de M5, ficha de solicitud, portal del cliente y reportes de M9— muestra el MOTIVO, no solo el
      estado.**
      ~~*(**SUPUESTO** de nombre: uso **`caducada`**…)*~~ **⚠ Ese supuesto queda SUPERADO**: `caducada` era
      **un nombre que este documento inventó** mientras la pregunta 27 estaba abierta. **Pregunta 27
      CERRADA.**
- [ ] **Regla dura del ciclo**: **no se puede llegar a `en_transito` sin haber pasado por `ofertada` y
      `aceptada`**. Es la regla que impide que alguien pague un envío —o que nosotros compremos una guía—
      sin un sí de las dos partes (§H).
- [ ] **Una solicitud terminal NO se revive** *(cerrado por el humano — respuesta a la pregunta 2;
      **ampliado en la 5ª ronda por D33**; **precisado en la 6ª**)*: tras **`rechazada`**, **`expirada`**
      —**por cualquiera de sus dos motivos**— o **`abandonada`**, si el vendedor todavía quiere vender,
      **cotiza de nuevo**. **No se re-oferta sobre una
      solicitud terminal**: el mercado ya se movió y la oferta anterior era vinculante **solo mientras
      vivió**. *(El correo de caducidad **lo invita explícitamente** a volver a cotizar, D33.)*

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
- [ ] **El caso «bounty sin meta» YA NO EXISTE** *(NUEVO 5ª ronda, **D32**; cierra un hueco que este
      documento había señalado)*: la precedencia de arriba tenía una **rama sin techo** — una variante con
      **bounty vivo y sin objetivo** **nunca** pintaba «no comprar», por muchas copias que acumulara, porque
      el bounty desplaza al tope general y **no había con qué compararlo**. **El humano lo cierra haciendo
      OBLIGATORIO el objetivo del bounty** al darlo de alta (§N.6): **sin objetivo no hay bounty**. Con eso
      **la rama (a) siempre tiene un número contra el cual medir la posición**, y **el tope general de 10
      siempre tiene con qué compararse** en la rama (b).
      **Alcance mínimo, dicho explícitamente**: **no se construye panel de bounties** —el humano lo pidió y
      lo dejó como **proyecto aparte**—; aquí **solo se exige el objetivo donde hoy se configuran** (§N.6,
      «Fuera de alcance»).
      *(**6ª ronda, D35 — el número y el caso histórico**: el objetivo **por defecto es 2** («hasta tener 2
      en inventario»), y **los bounties viejos sin meta se llenan con 2** — **no se desactivan**. Con eso la
      rama (a) tiene número **también hacia atrás**, sin depender de que alguien edite los viejos. **Se cae
      el supuesto** que este documento tenía redactado —tratarlos como «sin bounty» hasta que se editaran—:
      **ningún bounty se comporta como «sin bounty»**. §N.6, criterio **168**.)*
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
- [ ] **PISO DE NETO: no se puede EMITIR una oferta cuyo neto quede por debajo de MX$200** *(NUEVO 6ª ronda,
      **D34**; cierra la pregunta 25; ver criterio 167)*: si tras el cherry-pick el **neto** —`bruto ofertado
      − tarifa de envío congelada`— **queda por debajo del piso**, la oferta **no se emite** y **el correo no
      se manda**. **El operador tiene dos salidas y ninguna más: comprar más líneas, o no ofertar.**
      **EL PISO ES INCLUSIVO** *(**7ª ronda, D40** — confirmado por el humano; **no cambia nada**, solo se
      dice sin ambigüedad)*: un neto de **exactamente MX$200 SÍ se puede emitir**. La condición de bloqueo es
      **`neto < MX$200`**, **no** `neto ≤ MX$200`. Es el **mismo criterio de borde** que el mínimo de compra
      (§P.12): **a favor del vendedor en el borde**.
      **Dónde vive el bloqueo, dicho con precisión** *(es la parte que se desincroniza si no se escribe)*:
      **en la EMISIÓN de la oferta**. **No** en el dial —**M10 no ve el recorte que hizo el operador**, así
      que la validación entre diales (criterio 127) **no puede cubrir este caso**— y **no** en la aceptación
      —**el correo no debe llegar a mandarse**: el punto **no** es que el vendedor rechace una oferta
      ridícula, es que **esa oferta no exista**—.
      **Por qué MX$200 y no otro número** *(la aritmética del humano, registrada porque es lo que lo hace
      defendible)*: una solicitud cuesta **~MX$217** de operar —**etiqueta MX$180** + tiempo de operador—;
      comprando al **40% de referencia**, para que la operación **se pague sola** hace falta un **bruto de
      ~MX$362**, que deja **~MX$182 de neto**. **MX$200 queda justo arriba** y exige un **bruto de ~MX$380**:
      **conserva el margen de cherry-pick sobre lotes grandes** —recortar una solicitud de $3,000 a $600
      sigue siendo perfectamente posible— **sin permitir la oferta absurda**.
      **No es un bloqueo nuevo, es el mismo con número**: el arquitecto ya había bloqueado el caso
      **`neto ≤ 0`**; **D34 lo sube a MX$200**.
      **Es un dial** (§P.10, el **noveno**), **se congela por solicitud** como los demás y **queda
      auditado**. **El rechazo dice por qué y con qué cifras** —bruto actual, envío, neto y cuánto falta—,
      igual que el cotizador le dice al vendedor cuánto le falta para el mínimo (§P.12): un "no" seco deja al
      operador adivinando.
      **⚠ Lo que D34 NO toca**: el **piso de cero al PAGAR** (criterio **152**) **sigue existiendo tal cual**.
      Son dos cosas distintas y conviven: **D34 gobierna qué se puede EMITIR** (mira el **bruto ofertado**,
      antes del correo); **el criterio 152 gobierna cuánto se PAGA** (mira el **bruto aprobado**, después de
      verificar). Una oferta emitida por **MX$400 de neto** de la que solo se aprueben **MX$100** de bruto
      **sigue depositando MX$0 y nunca deuda** — D34 **no** la rescata, y **no** pretende hacerlo: no se puede
      saber al ofertar qué va a llegar en NM.
- [ ] **Qué le pasa al cliente cuando el operador «no oferta» por el piso** *(NUEVO 6ª ronda — coherencia
      entre D34 y D33, que este documento escribe en vez de dejarla implícita)*: **no queda colgado**. Si el
      operador decide **no ofertar**, la solicitud sigue **`cotizada`** y **el barrido de caducidad la cierra
      a los 7 días hábiles** desde su creación (§P.3.1), con el **correo de «no procederemos»** que **ya es
      obligatorio**. **D34 y D33 encajan sin alcance nuevo**: el piso impide **la oferta mala**, y la
      caducidad garantiza que **igual haya respuesta**.
      *(**7ª ronda, D39 — y ya no tiene que esperar**: el operador que decide no ofertar **cierra la
      solicitud en el acto** con el mismo correo y el mismo estado terminal. El barrido pasa a ser **la red
      de seguridad**, no **la única salida**. Con eso el desenlace deja de ser *«correcto pero lento»* y pasa
      a ser **correcto y rápido**.)*
      ~~*(⚠ **Lo que este documento NO agrega, y se dice para que nadie lo asuma**: **no existe** un botón de
      *«declinar esta solicitud ahora»* que le ahorre al cliente los **7 días hábiles** de espera. **Sería
      alcance nuevo** y hay que pedirlo. Con lo decidido el desenlace es **correcto pero lento**: el cliente
      espera el plazo completo por una decisión que ya se tomó el día 1.)*~~
      **⚠ SUPERADO en la 7ª ronda (D39): el humano lo pidió y AHORA EXISTE.**
- [ ] **«DECLINAR AHORA»: el operador puede cerrar la solicitud el día 1** *(NUEVO 7ª ronda, **D39**; ver
      criterio 171)*: si el operador ya decidió que **no compra** —porque el piso de neto lo bloquea, porque
      no le interesa la mercancía, o por lo que sea—, **no tiene que esperar al barrido**: **cierra la
      solicitud en el acto**. **Y es exactamente el mismo desenlace, no uno nuevo**:
      **(a)** el **mismo correo** de *«no procederemos con la oferta»* que manda el barrido (D33), con la
      **misma invitación a volver a cotizar**;
      **(b)** el **mismo estado terminal**: **`expirada` con motivo `no_offer`** (§P.1) — **no** se inventa
      un estado, **ni** un motivo, **ni** un correo, **ni** un plazo;
      **(c)** las **mismas consecuencias**: terminal es terminal (no se re-oferta, §P.1), y si había una
      oferta **esperando autorización**, **se anula igual** que al caducar (criterio 145).
      **Lo único que cambia es CUÁNDO**: el cliente recibe su respuesta **el día 1 en vez del día 7**.
      **Queda auditado quién declinó** (M10). **El barrido no desaparece**: sigue cubriendo las solicitudes
      que **nadie tocó**, que son justo las que este plazo existe para cerrar.
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

**P.2.1 — La DIRECCIÓN del vendedor: se pide AL CREAR la solicitud y se reusa su libreta (D36/D37 — 7ª ronda;
NUEVA)**
> **El hueco que cierra, y por qué era BLOQUEANTE**: hasta esta ronda **el ciclo no pedía la dirección del
> vendedor en ningún punto** —verificado: **cero menciones de dirección, domicilio o remitente en toda la
> §P**—. Y sin embargo, desde **D16/D31**, **la guía la ponemos nosotros, siempre**. **No se puede comprar
> una etiqueta sin domicilio de origen**, así que **D16 no era ejecutable como estaba escrito**: en el paso
> 5 del camino feliz («el operador compra la guía a mano») **faltaba el dato con el que se compra**.
- [ ] **Se pide AL CREAR LA SOLICITUD, junto con la CLABE — NO al aceptar la oferta (D36)**: la dirección es
      **requisito de creación**, igual que el **celular** (D11) y el **mínimo de compra** (D18). **Sin
      dirección no se crea la solicitud.** Razón de negocio: **el dato tiene que estar antes de que exista
      nada que enviar**, y el momento de creación es el único en el que el vendedor **ya está capturando sus
      datos** — pedírselo al aceptar metería una fricción **en el peor momento**, cuando ya dijo que sí y lo
      único que espera es su guía.
- [ ] **Se reusa la MISMA libreta de direcciones que ya usa para RECIBIR sus compras (D37)**: **no hay modelo
      nuevo, no hay pantalla nueva y no hay «domicilio de remitente» aparte**. Es **la misma libreta**, usada
      en la otra dirección del envío. Razón: **es el mismo domicilio de la misma persona**; mantener dos
      libretas paralelas produce **dos verdades** sobre dónde vive el cliente y **obliga a mantener dos
      capturas** que se desincronizan.
      *(**⚠ Observación que este documento SEÑALA, no un pendiente del humano**: la **libreta de direcciones
      del comprador ya se da por existente** en este documento —**§J** la nombra al listar lo que el invitado
      **no** tiene («historial de pedidos, **direcciones guardadas**…»)— pero **nunca se redactó como
      requisito propio**: no hay una sección que diga qué campos tiene ni cómo se administra. **Hasta ahora no
      importaba**; con **D37 pasa a ser carga estructural** del buylist. **No cambia ninguna decisión** —el
      humano decidió reusarla, y se reusa—, pero **el arquitecto necesita saber que la está heredando de una
      mención, no de una especificación**.)*
- [ ] **Mismo patrón que la CLABE: elegir/confirmar si ya tiene, capturar si no tiene**:
      **(a)** si el cliente **ya tiene direcciones guardadas**, la pantalla le pide **elegir una** —o
      **confirmar** la que trae por defecto—; **el cliente recurrente no re-teclea nada**;
      **(b)** si **no tiene ninguna**, **la captura ahí mismo**, y **queda guardada en su libreta** —así
      sirve para su siguiente venta **y para su siguiente compra**;
      **(c)** **la dirección elegida queda ligada a esa solicitud**, para que **cambiar después la libreta no
      mueva** el domicilio de una solicitud ya viva *(**SUPUESTO**: es el mismo criterio de «congelar lo
      comunicado» que ya rige plazos y tarifa, §P.10/P18; ver **pregunta abierta 28**)*.
- [ ] **Aplican las mismas reglas de dirección que ya existen**: **solo México** (§D, criterio 31). Una
      dirección **fuera de México** no sirve para vender, igual que no sirve para recibir.
- [ ] **Costo aceptado a ojos abiertos por el humano**: **también se le pide la dirección a gente a la que al
      final NO le compraremos** —la solicitud puede caducar, el operador puede declinar (D39) o el piso de
      neto puede bloquear la oferta (D34)—. **Se acepta**: es **un campo más en una pantalla que el cliente
      ya está llenando**, y **la alternativa —pedirlo al aceptar— rompe el momento en que el vendedor ya se
      comprometió**. *(Implicación de datos personales: se guarda el domicilio de personas con las que nunca
      se cerró una operación. Ver «Riesgos y banderas».)*
- [ ] **Lo que este requisito NO hace**: **no** cambia el **mínimo de compra**, **no** cambia **quién paga el
      envío** (nosotros, siempre — D31), **no** agrega un dial, **no** agrega un correo y **no** agrega un
      estado. **Es un dato de entrada que faltaba**, no una fase nueva del ciclo.
- [ ] **⚠ CONTRADICCIÓN SEÑALADA — «igual que hoy pasa con la CLABE» no describe lo que este documento dice
      hoy** *(7ª ronda; se señala en vez de asumirla, y **no se cambia el comportamiento de la CLABE**)*: la
      decisión D36 se apoya en que **la CLABE ya bloquea la creación de la solicitud**. **En este documento
      no es así**: la **CLABE y el INE se piden en el PASO DE PAGO del buylist** —criterio **14**, §E, **M6**—,
      **no al crear**. Lo único que hoy bloquea la creación es el **celular** (D11), el **mínimo** (D18) y,
      desde ahora, la **dirección** (D36).
      **Qué se hizo con eso**: **la dirección se redacta como el humano la decidió** —**bloqueante al
      crear**—, y **la CLABE se deja EXACTAMENTE como está**, porque **moverla al momento de creación sería
      alcance nuevo** que él no pidió explícitamente (y tiene efectos: pedir datos bancarios antes de saber
      si le compramos, y una interacción con el KYC/INE que hoy vive en el pago).
      **Lo que el humano tiene que confirmar** —**pregunta abierta 29**—: **(a)** que era solo una analogía
      y la CLABE **se queda en el pago**; o **(b)** que también quiere **la CLABE al crear la solicitud**, en
      cuyo caso **hay que decidir qué pasa con el INE**, que hoy viaja con ella.
      *(**SUPUESTO tomado**: **(a)** — la CLABE **no se mueve**.)*

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
- [ ] **Los tres montos, sin letras chiquitas (D16; SIEMPRE, por D31)**: ~~cuando la guía la ponemos
      nosotros~~ **en toda oferta**, el correo dice **cuánto valen las cartas (bruto)**, **cuánto cuesta el
      envío que ponemos** y **cuánto se deposita (neto = bruto − envío)**. **La cifra que se anuncia como
      depósito es el NETO**, y es **la vinculante**. Un correo que anuncie **$1,480** y termine en un depósito
      de **$1,350** destruye exactamente la confianza que la oferta vinculante venía a construir — así que
      **la resta se enseña, no se esconde**.
      ~~En la banda donde **el vendedor paga su propio envío** (§P.12), el correo lleva **un solo monto** y
      **dice que el envío corre por su cuenta**.~~ **⚠ RETIRADO en la 5ª ronda (D31): esa banda ya no
      existe**, así que **no hay variante de correo con un solo monto** — **todos** los correos de oferta
      llevan los tres.
- [ ] **«SIEMPRE se deduce del importe a pagar», dicho donde el vendedor decide** *(NUEVO 5ª ronda, **D31** —
      requisito de comunicación explícito del humano)*: el correo de oferta **no puede limitarse a mostrar la
      resta**: tiene que **decir la regla** —*«el envío lo ponemos nosotros y su costo **siempre** se deduce
      de lo que te pagamos»*—, y **al mismo nivel visual que los montos**, no en un pie de página. Razón, con
      el número enfrente: en una oferta de **MX$500** los **MX$180** son el **36%** —el vendedor recibe
      **MX$320**— y **debe verlo ANTES de aceptar**. La misma frase va en el **cotizador** y en los
      **términos** (§E, §H): **tres superficies, mismo mensaje**.
      *(**⚠ Precisión de la 8ª ronda, D43 — lo que viaja a las tres superficies es la REGLA, no la cifra**:
      en el **cotizador** la frase va **sin ningún monto de envío** (§H, criterio 174). **Los MX$180, el 36%
      y el neto son de la oferta**, y por eso este bullet los exige **aquí**: es el documento donde el
      vendedor decide, y donde la tarifa ya está **congelada**. **Este bullet no pierde nada**; el que se
      acota es el del cotizador.)*
- [ ] **Hay ofertas que NO se emiten: el piso de neto de MX$200** *(NUEVO 6ª ronda, **D34**; la regla vive en
      §P.2, aquí se dice su efecto sobre el correo)*: **si el neto no llega a MX$200, el correo de oferta no
      se manda**. No existe una variante de correo que anuncie un depósito de **MX$20** ni de **MX$0**: esa
      oferta **no llega a existir**. **Es coherente con lo que este documento ya exigía en la otra punta** —
      el cotizador **no crea** una solicitud por debajo del mínimo (§P.12)—: **dos umbrales, dos momentos**,
      y en ninguno de los dos se manda un mensaje que no vale la pena mandar.
      **El borde, sin ambigüedad** *(7ª ronda, D40)*: **un neto de exactamente MX$200 SÍ produce correo** —el
      piso es **inclusivo**—. **MX$199 no.**
- [ ] **El correo anuncia la guía, pero la guía todavía no existe (D21)**: ~~en la banda con envío a nuestro
      costo~~ **en toda oferta** *(5ª ronda, D31)*, el correo de oferta dice que **el envío corre por nuestra
      cuenta** y que **la guía le llega al aceptar**. **No se compra etiqueta al ofertar**: solo se gasta
      etiqueta en quien **ya dijo que sí**.
      *(**7ª ronda, D36/D37**: el correo **también le recuerda desde qué dirección saldrá el paquete** —**la
      que él eligió o capturó al crear la solicitud**, §P.2.1— **y cómo cambiarla si se mudó**. Razón: es
      **el último momento razonable para corregirla**; después ya compramos la etiqueta con ese domicilio y
      **cambiarla cuesta una etiqueta**. **No es una captura nueva**: es **mostrar el dato que ya dio** y
      dejarlo corregir. *(**SUPUESTO** sobre hasta cuándo se puede corregir — ver **pregunta abierta 28**.)*)*
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
      **Hay dos plazos DEL VENDEDOR** —**aceptar** y **enviar**—, así que en un ciclo puede haber **hasta dos
      recordatorios**, **cada uno una sola vez**. No es *«un recordatorio en todo el ciclo»*: quien ya aceptó
      y está por perder la venta porque el paquete no sale **también merece el aviso**.
      *(5ª ronda, D33: el **tercer plazo** del ciclo —la **caducidad**— **no agrega un tercer recordatorio**,
      porque **corre contra nosotros**, no contra el vendedor. Avisarle *«ojo, nos falta un día para
      contestarte»* no le sirve de nada.)*
      ~~Los **correos obligatorios del ciclo son tres**: oferta, recordatorio y expiración/cancelación.~~
      ~~**⚠ CORREGIDO en la 5ª ronda (D33): son CUATRO** — **oferta**, **recordatorio**,
      **expiración/cancelación** y **«no procederemos» por caducidad** (§P.3.1).~~ El cuarto **no es una
      variante del tercero**: la expiración dice *«aceptaste y no mandaste»*; la caducidad dice *«no vamos a
      ofertarte»*. **Son mensajes opuestos y no se pueden fusionar.**
      *(**⚠ Precisión OBLIGATORIA de la 6ª ronda**: ahora que **los dos desenlaces comparten el estado
      `expirada`** (resolución de la pregunta 27), **el correo NO se elige por el estado: se elige por el
      MOTIVO** (`not_shipped` ⇒ expiración; `no_offer` ⇒ «no procederemos»). ~~**Siguen siendo CUATRO correos
      distintos**~~; compartir estado **no los fusiona**. Es justamente el riesgo que trae el modelado nuevo, y
      por eso se escribe: criterios **142**, **165c** y **169c**.)*
      **⚠ CORREGIDO EN LA 8ª RONDA: SON CINCO — ver el bullet siguiente, que es el origen único del
      conteo.** El tachado de arriba se conserva como historial; **lo que NO cambia** de él es la razón por
      la que el 4 es propio y la regla de que **el correo no se elige por el estado**.

- [ ] **LOS CINCO CORREOS OBLIGATORIOS DEL CICLO, Y EL CASO QUE NO MANDA NINGUNO** *(NUEVO 8ª ronda —
      **corrige el conteo de CUATRO a CINCO**; el diagnóstico lo levantaron por separado **ux-ui** y el
      **arquitecto**, y este documento lo ratifica y lo hace suyo)*:
      **La regla de conteo, para que nadie la vuelva a re-litigar: un correo = un HECHO que le afirmamos al
      vendedor.** Dos maneras de llegar al **mismo hecho** comparten correo y texto; dos **hechos distintos**
      no se fusionan aunque compartan estado, plazo o pantalla.

      | # | Correo | Quién lo dispara (el PRODUCTOR) | Qué le afirma al vendedor | Dónde queda la solicitud |
      |---|---|---|---|---|
      | **1** | **Oferta** | emitir la oferta, o autorizarla el súper-admin | *«te compramos esto a este precio si llega NM; el envío se descuenta; se te depositan $X»* | `ofertada` |
      | **2** | **Recordatorio** | el barrido, a **1 día hábil** de vencer **cada plazo del vendedor** (aceptar / enviar) | *«te queda un día»* | sin cambio |
      | **3** | **Expiración** | el barrido, por **cualquiera de los dos plazos DEL VENDEDOR**: no respondió, o aceptó y no mandó | *«un plazo TUYO venció y la operación se cerró»* | `rechazada` (no respondió) · `expirada` + `not_shipped` (no mandó) |
      | **4** | **«No procederemos»** | el **barrido de caducidad** (7 días hábiles) **o** el botón **«declinar ahora»** (D39) | *«no vamos a ofertarte; puedes volver a cotizar cuando quieras»* | `expirada` + `no_offer` |
      | **5** | **«Cancelamos la oferta»** *(NUEVO 8ª ronda)* | **nosotros**, al cancelar una oferta **YA ENVIADA** | *«la cancelamos NOSOTROS, no es nada de tu parte y tu solicitud sigue viva»* | vuelve a **`cotizada`** con **7 días hábiles completos** (D38) |
      | **—** | **NINGUNO** *(NUEVO 8ª ronda)* | cancelar una oferta que **todavía esperaba autorización** | **nada: esa oferta nunca existió para él** | vuelve a `cotizada`, **sin reiniciar reloj y sin correo** |

- [ ] **Por qué el 5 tiene que ser un correo propio, y no la «cancelación» que vivía dentro del 3** *(8ª
      ronda)*: el correo 3 **afirma un hecho que en este caso es FALSO** — que **un plazo del vendedor
      venció**. Cuando **cancelamos nosotros**, **no venció nada, no incumplió nadie y la solicitud NO se
      cerró**: sigue viva y vuelve a la fila. Mandarle el 3 **le imputa un incumplimiento que no existió**, y
      encima le esconde el único hecho que sí ocurrió: **que fuimos nosotros**. Y trae un daño extra que el
      caso del correo 4 no tenía: **el 3 lo invita a «cotizar de nuevo»**, y aquí eso lo manda a **duplicar
      una solicitud que sigue abierta** — nos ensucia la cola y lo confunde a él.
      **Es el mismo argumento con el que D33 creó el correo 4**, un nivel más abajo: *un correo que dice la
      cosa equivocada es peor que no escribir*. Fusionarlos **no era una simplificación: era el fallo
      esperando**.
- [ ] **Por qué el conteo sube a CINCO y no a SEIS** *(8ª ronda — la regla de conteo, aplicada)*: **el
      correo 3 se queda como UNO** aunque tenga dos productores, porque los dos afirman **el mismo hecho**
      —*«un plazo tuyo venció y esto se cerró»*— y **en los dos incumplió el vendedor**; cambia **cuál**
      plazo, y eso es **copy**, no un mensaje distinto. Es **exactamente el mismo trato que ya recibía el
      recordatorio**, que también cubre los dos plazos del vendedor con un solo correo. Y el **correo 4 sigue
      siendo UNO** aunque lo disparen el barrido y «declinar ahora» (D39): **mismo hecho, mismo texto** —al
      vendedor **no le corresponde** saber si le contestamos rápido o dejamos correr el reloj; eso es
      **evaluación nuestra** y vive en la bitácora.
      *(**Si alguna vez esos dos productores del 3 tuvieran que afirmar hechos distintos, serían SEIS** — y
      esa es una decisión de producto que **pasa por este documento**, no un detalle de plantillas.)*
- [ ] **El correo se elige por el PRODUCTOR, no por el estado ni por el motivo** *(8ª ronda — **amplía** la
      precisión de la 6ª ronda, que ya decía «por el motivo, no por el estado»)*: **el motivo de cierre
      tampoco alcanza**, y se demuestra por lo negativo: **queda vacío en dos de los tres desenlaces del
      antiguo correo 3** —«no respondió» deja la solicitud **`rechazada`** (el motivo solo se sella en
      `expirada`) y **la cancelación la deja `cotizada`**—, así que elegir por motivo **mandaría el mismo
      correo a los dos extremos opuestos del eje «¿quién falló?»**: al que no cumplió y al que no hizo
      absolutamente nada. **Lo que sí discrimina siempre es quién disparó el cierre.** *(Cómo se implementa
      —dónde vive ese discriminador— es del arquitecto; el requisito de negocio es que **ningún vendedor
      reciba un correo que describa un hecho que no ocurrió**.)*
- [ ] **Cancelar una oferta que ESPERABA AUTORIZACIÓN no manda ningún correo** *(NUEVO 8ª ronda — hueco que
      este documento no tenía escrito)*: una oferta que **no salió** porque estaba pendiente de autorización
      del súper-admin (D13, criterio 143) **nunca existió para el vendedor**. Si al cancelarla le
      escribiéramos, le estaríamos contando **que preparamos algo que él nunca supo que existía** y, de paso,
      revelándole **la existencia y el orden de magnitud de un control interno nuestro** (el tope del
      operador). **No se le manda nada**, y **tampoco se le reinicia el reloj** (§P.3.1): **el mismo hecho
      —que la oferta llegó o no llegó a sus manos— gobierna las dos consecuencias**, así que no pueden
      desincronizarse. **El barrido que anula una oferta pendiente al caducar tampoco manda el 5**: manda el
      **4**, que es el hecho real (*no procederemos*). Criterio **173**.

- [ ] **D42 — EL PORTAL NO SE QUEDA MUDO DESPUÉS DE UNA CANCELACIÓN: es el hermano de pantalla del correo 5**
      *(NUEVO 9ª ronda, **D42** — decisión que estaba **solo en documentos del arquitecto** y se formaliza
      aquí como **requisito de negocio**: es *«qué VE el vendedor cuando le cancelamos»*)*:
      **El hueco, dicho tal cual**: el correo 5 le afirma que **hubo una oferta y que la cancelamos
      nosotros**. Si entra a su portal y **no encuentra rastro de nada** —ni de la oferta ni de la
      cancelación—, **la pantalla contradice al correo**. Y entre las dos, **le va a creer a la pantalla**:
      queda con un correo que **no puede confirmar en ningún lado**, que es **exactamente la sensación de
      «me escribieron por error» o «esto es phishing»** — el daño que el correo 5 vino a evitar, reaparecido
      una pantalla después. **Un correo que no se puede verificar en el portal es medio correo.**
      **Qué muestra el portal, y es todo**: **(1)** que **hubo una oferta**, **(2)** que **se canceló** y
      **(3)** **la fecha** de esa cancelación.
      **Qué NO muestra**: **el motivo interno** —por qué la cancelamos es **evaluación nuestra** y vive en la
      **bitácora** (M10), igual que ya pasa con «por qué puerta entró la decisión» del correo 4—; y, **por la
      misma coherencia que ya exige el correo 5** (criterio 173a), **ningún texto de plazo vencido**, **ningún
      «venció»** y **ningún monto de la oferta cancelada** — repintar la resta de una oferta que ya no existe
      **es ofrecerle un trato que retiramos**.
      **Y no hace falta que diga «tu solicitud sigue viva» con esas palabras**: la solicitud **vuelve a
      `cotizada`** (D38) y **el portal ya pinta el estado** —*esperando nuestra oferta*—, que es el mismo que
      vio el día que la creó. **D42 no agrega una pantalla nueva ni un estado nuevo**: agrega **el rastro que
      faltaba** dentro del detalle de la solicitud que el vendedor ya tiene.
      **El contracaso NO cambia, y se prueba junto con este**: cancelar una oferta que **solo esperaba
      autorización** **no deja rastro en el portal** —igual que **no manda correo** y **no reinicia el
      reloj**—, porque **esa oferta nunca existió para él** y pintarla le revelaría **un control interno
      nuestro**. Es la misma regla de las otras dos consecuencias: **un solo hecho —¿le llegó o no le
      llegó?— gobierna las TRES** (correo, reloj y pantalla), así que **no pueden desincronizarse**.
      *(**Cómo se muestra** —dónde vive el rastro, qué componente lo pinta— **es del arquitecto y de ux-ui**;
      el requisito de negocio es que **ninguna superficie del vendedor contradiga a otra**.) Criterio
      **176**.*

**P.3.1 — La solicitud que nadie oferta CADUCA: nunca dejamos a alguien esperando sin respuesta (D33 — 5ª
ronda; NUEVA)**
> **El hueco que cierra, dicho tal cual**: al re-anclarse el barrido de 30 días —**correctamente**, porque
> **`cotizada` ahora significa «esperando que NOSOTROS ofertemos»** y cerrarla por **inacción nuestra** sería
> **culpar al cliente**— quedó un agujero: **nada cerraba ya una `cotizada`**. Un cliente podía cotizar,
> mandar su solicitud y **esperar indefinidamente sin recibir respuesta de ningún tipo**. Ese es el peor
> desenlace posible: **no es un no, es un silencio**.
- [ ] **A los 7 días hábiles desde su creación, una solicitud que nadie ofertó CADUCA** y queda **terminal**.
      El plazo se cuenta en **días hábiles** —misma definición única de §H (D14)— por consistencia con el
      resto del ciclo. Es **dial de M10** (§P.10) y **se congela por solicitud** (P18).
- [ ] **Sale un correo que dice que NO PROCEDEREMOS — con esas palabras, no con un rodeo**: el cliente recibe
      un correo que le dice **explícitamente que no vamos a proceder con la oferta**, y que **puede volver a
      cotizar cuando quiera**. **No sirve** un *«no pudimos procesar tu solicitud»* vago ni un
      *«seguimos revisando»*: el cliente **tiene que saber a qué atenerse**. Es el ~~**CUARTO**~~ **correo
      obligatorio número 4 de los CINCO** del ciclo (§P.3, tabla) *(**8ª ronda**: el conteo total subió a
      cinco; **este correo no cambió ni una palabra** — cambió el correo que estaba a su lado)*.
- [ ] **Este plazo corre contra NOSOTROS, y eso cambia dos cosas**: **(a)** **no lleva recordatorio al
      cliente** —avisarle de un plazo que depende de nuestra carga de trabajo no le sirve de nada—; y
      **(b)** **no se le reprocha nada al cliente**: la solicitud **no queda `rechazada`** (eso significaría
      que él dijo que no o que no respondió) **ni `expirada`** (eso significaría que aceptó y no mandó). **Es
      un desenlace nuestro y se llama como tal.**
- [ ] **La caducidad no se confunde con la expiración por no enviar** (§P.1): **correos distintos,
      significados opuestos**. Mezclarlas dejaría al cliente sin saber qué pasó y a los reportes sin poder
      separar *«se nos fue el tiempo»* de *«el vendedor no cumplió»* — que es exactamente la métrica que uno
      quiere vigilar.
      *(**6ª ronda — pregunta 27 CERRADA por el arquitecto**: ~~`caducada` como estado propio~~ **queda
      SUPERADO**. Es **`expirada` con motivo `no_offer`**, con el **motivo en columna propia**, frente a
      **`not_shipped`**. **El requisito de negocio es idéntico**: correos distintos y reportes que los
      separen. Lo único que cambia es **dónde vive la distinción**.)*
- [ ] **NO hay que esperar el plazo para decir que no: «declinar ahora» (D39 — 7ª ronda)**: el plazo de 7
      días hábiles es **el techo**, no **el procedimiento**. Si el operador ya sabe el **día 1** que no
      compra, **cierra la solicitud en el acto** y el cliente **recibe su respuesta ese mismo día**, con el
      **mismo correo de «no procederemos»** y el **mismo estado terminal** (`expirada` + `no_offer`, §P.2 y
      §P.1). **Hacer esperar a alguien siete días por una decisión ya tomada es exactamente el mismo daño
      que esta sección vino a evitar** —silencio en vez de respuesta—, solo que más corto. **El barrido no se
      va**: cubre las solicitudes que **nadie miró**. Criterio **171**.
- [ ] **Terminal es terminal, también aquí** (§P.1): sobre una solicitud que **caducó** —**por barrido o por
      «declinar ahora»**— **no se re-oferta**;
      si el vendedor sigue interesado, **cotiza de nuevo** (y el correo se lo dice).
- [ ] **Qué pasa con una oferta que estaba esperando autorización** *(~~SUPUESTO~~ **CONFIRMADO en la 6ª
      ronda por el arquitecto**)*: si el operador preparó una oferta arriba de su tope y **el súper-admin no
      la autorizó dentro del plazo**, **la solicitud caduca igual** —**el cliente sigue esperando, y el
      pendiente es nuestro**—; **el barrido ANULA esa oferta al caducar la solicitud**: sale de la cola de
      autorización y **ya no puede autorizarse después** (terminal es terminal, criterio 145). *(El verbo
      importa: no es que «quede huérfana en la cola», es que **el barrido la anula**.)*
      *(**8ª ronda — qué correo sale aquí, que este documento no había dicho**: sale el **4** («no
      procederemos»), **no** el 5 («cancelamos la oferta»). El hecho real para el vendedor es que **no vamos
      a ofertarle**; que hubiera una oferta anulada por dentro **es información nuestra, no suya** — §P.3,
      criterio **173**.)*
- [ ] ~~**Qué pasa si una oferta emitida se cancela y la solicitud vuelve a la fila** *(**⚠ SUPUESTO
      CORREGIDO en la 6ª ronda por el arquitecto**)*: el reloj de caducidad **vuelve a arrancar desde la
      cancelación**, **no** desde la creación original. **Regla vigente: el reloj NO se reinicia — cuenta
      SIEMPRE desde la creación de la solicitud.** Un solo origen, un solo reloj.
      **⚠ Consecuencia que este documento SEÑALA en vez de callar**: si la oferta se cancela **después** de
      que ya pasaron los 7 días hábiles desde la creación, la solicitud **caduca el mismo día en que vuelve a
      la fila** — el cliente recibe un *«no procederemos»* **por una corrección nuestra**, sin que nadie haya
      vuelto a mirar su solicitud. Es exactamente el escenario por el que este documento había supuesto lo
      contrario. **Se registra como bandera** (ver «Riesgos y banderas»), **no** como bloqueo: el arquitecto
      lo decidió y es coherente con *«un plazo, un origen»*; si al humano le parece injusto, **mover el
      arranque del reloj es una decisión de producto de una línea**.~~
      **⚠ TODO EL BULLET ANTERIOR QUEDA SUPERADO EN LA 7ª RONDA (D38).** Se conserva como historial. **El
      humano le dio la razón a la bandera**: era **injusto** que el cliente pagara una corrección nuestra.
      **También queda superado *«un plazo, un origen»*** donde este documento lo escribió como regla vigente.
- [ ] **CANCELAR UNA OFERTA DEVUELVE LA SOLICITUD A LA FILA CON LOS 7 DÍAS HÁBILES COMPLETOS (D38 — 7ª ronda;
      regla VIGENTE)**: cuando una oferta emitida **se cancela** —para corregirla, o por lo que sea—, la
      solicitud vuelve a estar **esperando nuestra oferta**, y **el plazo de caducidad arranca de nuevo,
      entero**, desde la cancelación.
      **Por qué, dicho como requisito de negocio**: **este plazo corre contra NOSOTROS** (bullet de arriba).
      Un plazo que corre contra nosotros **no puede consumirse con nuestros propios errores**. Si cancelamos
      al día 8 para corregir un número, el cliente **no puede recibir un «no procederemos» ese mismo día por
      una corrección nuestra** — sería **castigarlo por algo que él no hizo**, exactamente el mismo principio
      que ya sostiene §P.13 (*«un plazo del vendedor solo puede vencer por algo que dependa del vendedor»*),
      aplicado del otro lado del mostrador.
      **Qué NO cambia**: mientras **nadie cancele nada**, el reloj **cuenta desde la creación** como siempre
      (§P.10). El reinicio **no es automático ni periódico**: lo dispara **una acción nuestra**, la
      cancelación de una oferta **ya emitida**.
      **⚠ PRECISIÓN OBLIGATORIA DE LA 8ª RONDA — «ya emitida» quiere decir QUE LE LLEGÓ AL VENDEDOR, y de
      ahí cuelgan las DOS consecuencias a la vez**: cancelar una oferta **enviada** ⇒ **se reinicia el reloj
      Y sale el correo 5** («cancelamos la oferta», §P.3); cancelar una oferta que **solo esperaba
      autorización** ⇒ **ni reloj ni correo**, porque **para el vendedor no pasó nada** —esa oferta nunca
      existió para él— y **su solicitud lleva todo el tiempo esperando nuestra respuesta**, que es justo lo
      que este plazo mide. **Un solo hecho gobierna las dos consecuencias**, así que **no pueden
      desincronizarse**: *no hay reinicio silencioso*. Con eso, **el bucle silencioso** (preparar → cancelar
      → preparar → cancelar, sin que al vendedor le llegue nada) **queda cerrado de raíz**, y el riesgo del
      bullet siguiente se reduce al **bucle ruidoso**, donde **cada vuelta le cuesta al operador mandarle al
      vendedor una oferta vinculante y su cancelación**, con **las dos entradas en la bitácora**. Criterio
      **173**.
      **⚠ RIESGO NUEVO que esto abre, SEÑALADO aquí sin inventarle remedio** *(7ª ronda)*: **cancelar y
      re-emitir en bucle podría alargar el plazo indefinidamente** — cada cancelación regala 7 días hábiles
      más, y una solicitud podría quedarse viva para siempre sin que el cliente reciba nunca ni oferta ni
      «no procederemos». **Este documento NO decide el candado** (¿tope de cancelaciones? ¿un techo absoluto
      desde la creación? ¿solo alerta y auditoría?): **es una decisión de diseño y le toca al arquitecto**.
      Lo que **sí** es requisito de negocio y no se negocia: **el cliente no puede quedarse esperando
      indefinidamente** —es justo el hueco que §P.3.1 vino a cerrar (D33)—, así que **cualquier candado que
      se elija tiene que preservar eso**. Ver «Riesgos y banderas» y criterio **172**.

**P.4 — La guía la mandamos nosotros, SIEMPRE (D16, ~~D18b~~, D19, D20, D21, D22 — REESCRITA en la 2ª ronda,
supersede D5; **CORREGIDA en la 5ª por D31: se elimina el umbral**)**
> **Qué cambió respecto al primer pase**: el borrador decía que **el cliente capturaba la guía** y que
> **él pagaba el envío** (D5 + supuesto de la pregunta 5). El humano decidió lo contrario: **la guía la
> ponemos nosotros y se descuenta del pago**. Con eso **D5 queda sin efecto** —el vendedor ya no captura
> nada— y el envío deja de ser un costo invisible del vendedor para volverse **una línea de nuestro dinero**.
> **Qué cambió en la 5ª ronda (D31)**: la 2ª ronda había puesto ese trato **«arriba de un umbral»**
> (MX$1,000). **Ese umbral era una propuesta de este documento, no un pedido del humano**, y **queda
> eliminado**: **la guía va SIEMPRE**, desde el mínimo de MX$500.
- [ ] ~~**Arriba de MX$1,000, el envío corre por nuestra cuenta (D16/D18b)**: compramos la guía, se la
      mandamos al vendedor y **su costo se descuenta del pago**. De **$500 a $1,000**, **el vendedor paga su
      envío como hoy** y **no hay descuento**.~~ **⚠ SUPERSEDED por D31 (5ª ronda)** — historial.
- [ ] **SIEMPRE ponemos la guía y SIEMPRE se descuenta (D16/D31)**: en **toda** compra de buylist —**desde el
      mínimo de MX$500**— compramos la guía, se la mandamos al vendedor y **su costo se descuenta del pago**
      (`bruto − envío = neto`, §H). **No hay ningún monto en el que el vendedor pague su propio envío.**
      **Y se le dice antes de aceptar**, en el cotizador, en el correo de oferta y en los términos (§P.3).
- [ ] **El costo REAL de la etiqueta se puede capturar, y NO cambia lo que cobra el vendedor** *(NUEVO 5ª
      ronda; cierra la contradicción **criterio 135 × D19**)*: al **confirmar el envío**, el operador puede
      **capturar cuánto costó de verdad la etiqueta**. **Es opcional**; si no se captura, el gasto se registra
      con la **tarifa congelada** de MX$180 (*fallback*). **El P&L (M7) usa el real cuando existe y la tarifa
      cuando no** — así el margen o la pérdida del envío **deja de ser invisible** sin obligar a nadie a
      capturar un dato que a veces no tiene a la mano. **Lo que se le descuenta al vendedor NO cambia jamás**:
      es **la tarifa congelada al ofertar** (D25), porque el neto es **vinculante**. *(Coherente con D19: esto
      **no** es integración con paquetería — es **un campo que el operador escribe**.)*
- [ ] **La guía se compra AL ACEPTAR, no al ofertar (D21)**: **solo se gasta etiqueta en quien ya dijo que
      sí**. Ofertar a diez personas y comprar diez guías por adelantado sería tirar el dinero de las que
      digan que no. El correo de oferta solo **anuncia** que el envío va por nuestra cuenta.
- [ ] **La guía se compra CONTRA LA DIRECCIÓN QUE EL VENDEDOR DIO AL CREAR LA SOLICITUD (D36/D37 — 7ª
      ronda; el dato que faltaba para que este paso fuera ejecutable)**: el operador **no le pide el
      domicilio a nadie en este momento** ni lo busca por su cuenta — **lo tiene en la ficha de la solicitud
      desde el día 1** (§P.2.1, M5). **Sin ese dato este paso no existe**: una etiqueta **no se puede comprar
      sin domicilio de origen**, y ese era el hueco que hacía que **D16 no fuera ejecutable como estaba
      escrito**. La dirección **viaja en la solicitud**, no se re-captura, y **es la que el vendedor eligió o
      confirmó de su propia libreta**.
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
      depende de nosotros. ~~En la banda donde **él paga su envío**, el plazo corre **desde la aceptación**.~~
      **⚠ RETIRADO en la 5ª ronda (D31): esa banda ya no existe**, así que el reloj arranca **siempre con la
      entrega de la guía**, sin excepciones ni casos.
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
      **comprobante del pago** con el desglose de **qué se aprobó, a cuánto, qué se rechazó y por qué**.
      ~~Los **correos obligatorios del ciclo siguen siendo TRES** —oferta, recordatorio, expiración— *(la 3ª
      ronda llegó a proponer un cuarto; con D30 **no existe**)*.~~
      **⚠ Precisión de la 5ª ronda (D33): el rechazo parcial NO agrega ningún correo —eso sigue igual—, pero
      el conteo del ciclo SÍ cambió: son ~~CUATRO~~ CINCO** *(**8ª ronda**)*, porque **D33 suma el de «no
      procederemos» por caducidad** (§P.3, §P.3.1) **y la 8ª ronda saca la CANCELACIÓN a correo propio**.
      **El correo que la 3ª ronda proponía —el de *«¿continúas?»*— sigue sin existir**, y **ninguno de los
      dos que se sumaron es él**: los dos son **de otro momento y de otro sentido** —**antes de ofertar** el
      4 (porque el plazo que se venció fue **el nuestro**) y **antes de que el vendedor mande nada** el 5
      (porque **el que canceló fue nosotros**)—. **Sigue sin existir cualquier correo POSTERIOR a la
      verificación que le pida algo al vendedor.** Ver §P.3, tabla, y criterio **173**.
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
      ~~**La relación que SÍ sigue siendo cierta**: la **tarifa de envío** debe ser **estrictamente menor que
      el UMBRAL DE GUÍA** —**MX$180 < MX$1,000**—.~~ **⚠ RE-ANCLADA en la 5ª ronda (D31)**: **el umbral de
      guía también dejó de existir**, así que la validación se muda al dial que sí quedó.
      **Regla vigente (5ª ronda): la `tarifa de envío del buylist` debe ser ESTRICTAMENTE MENOR que el
      `mínimo de compra`** —hoy **MX$180 < MX$500**—. **La propiedad money-safe es la misma de siempre**: el
      mínimo es **inclusivo** (§P.12), así que **la solicitud más chica que aceptamos vale exactamente el
      mínimo**; si la tarifa lo igualara o lo superara, **una operación con TODO aprobado depositaría MX$0**,
      y le estaríamos ofreciendo a alguien un trato que **no le paga nada aunque cumpla perfecto**. Eso no es
      un piso de seguridad: es **una oferta rota**.
      *(La **pregunta 24** —cuánto colchón— **queda CERRADA por D31**: el humano **aceptó a ojos abiertos**
      que en el piso de $500 el envío pese **36%**, o sea **ningún colchón adicional**; la validación queda en
      **estrictamente menor**. **Tarifa y mínimo siguen siendo diales**: si duele, se mueven.)*
      ~~**⚠ Lo que esta validación NO cubre, y se dice en voz alta (5ª ronda)**: protege la **solicitud
      completa**, no la **oferta recortada**. Como el **mínimo no se re-aplica a la oferta** (criterio 158c),
      un cherry-pick puede dejar el **bruto ofertado por debajo de MX$180** y entonces **el neto es MX$0
      aunque todo llegue en NM**. Antes de D31 eso no podía pasar (ahí el vendedor pagaba su propio envío).
      **Sigue sin haber deuda del vendedor** (criterio 152) y **él ve el neto antes de aceptar** (D31), así
      que **puede rechazar** — pero si el humano quiere además un **piso de neto para siquiera emitir la
      oferta**, eso es **alcance nuevo**: **pregunta abierta 25**.~~
      **⚠ TODO ESE PÁRRAFO QUEDA SUPERADO — corrección de la 7ª ronda (o.17, enrutada por el arquitecto)**.
      Se conserva como historial porque explica **por qué existe D34**, pero **describe un desenlace que ya
      NO puede ocurrir**: con el **piso de neto de MX$200** (D34), **ninguna oferta con neto MX$0 —ni MX$20—
      llega a emitirse**, así que **el escenario «cherry-pick por debajo de MX$180 ⇒ neto MX$0 con todo
      aprobado» dejó de ser posible**. **Lo que SÍ sigue vigente de ese párrafo**: **la validación entre
      diales (`tarifa < mínimo`) efectivamente NO cubre la oferta recortada** —esa es su limitación real y no
      cambió— y **el mínimo de compra sigue sin re-aplicarse a la oferta** (criterio 158c, **regla intacta**).
      **Lo que ya no se puede citar como válido**: **cualquier ejemplo cuyo desenlace sea un neto de MX$20 o
      de MX$0 al EMITIR** — hoy eso **se bloquea**.
      **⚠ CERRADO en la 6ª ronda (D34): SÍ hay piso, y es MX$200 de NETO.** El hueco **no se tapa aquí** —la
      validación entre diales **sigue sin poder verlo**, porque **M10 no conoce el recorte del operador**—:
      se tapa **en la emisión de la oferta** (§P.2, criterio **167**). **Los dos mecanismos conviven y
      cubren cosas distintas**: `tarifa < mínimo` protege **la solicitud completa** *(«ninguna solicitud
      aceptable puede depositar cero si todo llega en NM»)*; el **piso de neto de MX$200** protege **la
      oferta recortada** *(«ninguna oferta se emite si no vale la pena para nadie»)*. **La pregunta 25 queda
      CERRADA.**
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
- [ ] **Qué cuenta como «solicitud viva»** *(cerrado por el humano — respuesta a la pregunta 10;
      **actualizado en la 5ª ronda por D33**; **CORREGIDO en la 6ª**)*: **todo lo que NO sea terminal**. Los
      **terminales ~~son cuatro~~ ~~son CINCO~~ **son CUATRO**: **`pagada`**, **`rechazada`**,
      **`abandonada`** y **`expirada`** —**con sus dos motivos**, `not_shipped` y `no_offer` (§P.1)—.
      ~~y **`caducada`**~~ **⚠ SUPERADO en la 6ª ronda: no es un estado, es un motivo.**
      Se define **por exclusión a propósito**: así, cualquier
      estado que se agregue después al ciclo **entra a la vista solo**, sin que haya que acordarse de
      actualizar una lista.
      *(**6ª ronda — la definición por exclusión se paga sola por partida doble**: la caducidad **ni siquiera
      necesitó entrar a la lista**, porque **no agregó un estado**. Una solicitud que caduca deja de contar
      como viva **por ser `expirada`**, sin que nadie toque nada.)*
- [ ] **Una solicitud `cotizada` es «viva» y tiene reloj (D33)**: mientras espera nuestra oferta **cuenta como
      viva** —el operador la ve y puede llamar al vendedor—, y **caduca a los 7 días hábiles** si nadie la
      oferta. **La cola de buylist es, entre otras cosas, la lista de gente a la que le debemos una
      respuesta.**
      *(**7ª ronda**: **D39** — de esa lista se puede salir **también contestando que no**, en el acto
      («declinar ahora»), sin agotar el plazo; y **D38** — si cancelamos una oferta, la solicitud **vuelve a
      la lista con su plazo completo**, porque **la deuda de respuesta vuelve a ser nuestra**.)*
- [ ] **El teléfono es dato de back-office**: **nunca** se muestra en superficie pública ni en la vista de
      seguimiento de un pedido (coherente con §J, que ya lo prohíbe explícitamente).

**P.10 — Diales del ciclo (D8; ampliado en la 2ª ronda, COMPLETADO en la 3ª, CORREGIDO en la 4ª, en la 5ª y
en la 6ª — origen único de los números)**
> **Esta tabla es el origen único de los NUEVE diales del ciclo.** El resto del documento —§E, §H, M5, M10,
> los criterios— **los cita, no los vuelve a enumerar**: las copias en prosa son las que se desincronizan,
> porque ningún test las mira. Tras la 3ª ronda **ninguno queda sin número**.
> **⚠ 7ª ronda (D36–D40): NO entra ni sale ningún dial — SIGUEN SIENDO NUEVE.** Se dice explícitamente
> porque es donde este documento se desincroniza: la **dirección del vendedor** (D36/D37) es **un dato de
> entrada**, no un dial; **«declinar ahora»** (D39) es **una acción**, no un dial; **D40** solo **fija el
> borde inclusivo** de un dial que ya existía; y **D38** cambia **cómo se cuenta** el plazo de caducidad
> —**se reinicia al cancelar una oferta**— **sin cambiar su número ni agregar otro**.
> **⚠ Corrección de la 6ª ronda (D34) — entra uno y no sale ninguno: pasan a NUEVE.** Entra el **«neto
> mínimo para EMITIR la oferta» (MX$200, D34)**. **Es el único dial del ciclo que NO se evalúa en la
> pantalla de diales ni en un barrido**: se evalúa **en la emisión de la oferta**, contra el resultado del
> cherry-pick del operador (§P.2, criterio 167). M10 configura **el número**; el **momento** es otro.
> **⚠ Corrección de la 4ª ronda (D30)**: eran **nueve**; el **«umbral de recorte material» (20%, D28)** queda
> **SIN OBJETO** —al no haber pregunta al vendedor, **no hay umbral que calibrar**— y **se retira de la
> tabla**. **Quedaron OCHO.** El dial no se «apaga» ni queda en 0: **deja de existir**.
> **⚠ Corrección de la 5ª ronda (D31 + D33) — se va uno y entra otro, así que SIGUEN SIENDO OCHO**: sale el
> **«umbral de guía a nuestro costo» (MX$1,000, D18b)**, **dial sin objeto** porque **la guía va SIEMPRE**
> (D31); entra el **«plazo de caducidad de la solicitud sin oferta» (7 días hábiles, D33)**. **La cuenta
> vuelve a OCHO**, con otra composición. *(**⚠ Superado por la 6ª ronda: son NUEVE** — ver abajo.)*
- [ ] Los ~~**dos**~~ **TRES plazos** son **diales editables desde M10**, **sin redeploy** y **auditados**:
      **plazo para aceptar** (default **2 días hábiles**), **plazo para que el paquete salga** (default
      **3 días hábiles**) y **plazo de caducidad de la solicitud sin oferta** (default **7 días hábiles**,
      **D33** — *el único que corre contra nosotros*). **No son constantes en código.**
- [ ] **Los diales se CONGELAN por solicitud** *(3ª ronda; cierra la pregunta 18 — supuesto confirmado y
      reforzado)*: **se respetan las fechas ya comunicadas**. Cada plazo **se congela en el momento en que se
      fija** para esa solicitud —cuando sale el correo de oferta, cuando se entrega la guía— y **cambiar el
      dial después solo afecta a las solicitudes NUEVAS**. No se acorta ni se alarga una fecha que ya está en
      la bandeja de alguien. Lo mismo aplica a la **tarifa de envío** (D25): la oferta lleva **la suya**,
      congelada. Vencerle una oferta a alguien **antes de la fecha que le escribimos** sería romper la palabra
      que la oferta vinculante venía a dar.
- [ ] **NUEVE diales del ciclo** *(3ª ronda: ya todos con número; **4ª ronda: eran nueve — D28 quedó sin
      objeto y se retiró**; **5ª ronda: sale el umbral de guía (D31) y entra el plazo de caducidad (D33) —
      siguieron siendo OCHO**; **6ª ronda: entra el neto mínimo para emitir (D34) y no sale ninguno — son
      NUEVE**)*, todos en M10, sin redeploy y auditados — tabla abajo.
- [ ] **Los diales de MONTO ahora son TRES, y responden a tres preguntas distintas** *(6ª ronda)*: el
      **mínimo de compra** (*«¿vale la pena esta operación?»*, se juzga **al crear la solicitud**), la
      **tarifa de envío del buylist** (*«¿cuánto cuesta traer las cartas?»*) y el **neto mínimo para emitir**
      (*«¿vale la pena esta OFERTA, después del recorte?»*, se juzga **al emitir**). **Mover uno no mueve a
      los otros**, y **cada uno se evalúa en su propio momento** — que es justamente lo que hacía falta:
      **un solo umbral en un solo momento** dejaba descubierto el segundo momento (§P.12, criterio 158c).
- [ ] ~~**Los dos umbrales de monto son independientes**: el **mínimo de compra** y el **umbral de guía**
      responden a preguntas distintas —*«¿vale la pena esta operación?»* y *«¿a partir de cuánto pago yo el
      envío?»*— y **mover uno no mueve el otro** (D18b).~~ **⚠ SUPERSEDED por D31 (5ª ronda)**: la segunda
      pregunta **ya no se hace** —**el envío lo pagamos siempre**—, así que **el umbral de guía desaparece**.
      **Los dos diales de monto que quedan** son el **mínimo de compra** y la **tarifa de envío del buylist**,
      y **siguen siendo independientes**: responden a *«¿vale la pena esta operación?»* y *«¿cuánto cuesta
      traer las cartas?»*, y **mover uno no mueve el otro** (aunque **una validación los relaciona**, bullet
      siguiente).
- [ ] **Una validación entre diales, no solo diales sueltos — REFORMULADA en la 4ª ronda y RE-ANCLADA en la
      5ª** (§P.5.1, criterio 127): ~~la **tarifa de envío** no puede superar
      `umbral de guía × (1 − umbral de pregunta)` —**$800**—~~ *(fórmula retirada: citaba el dial de D28)*;
      ~~ni ser **igual o mayor que el umbral de guía** —**MX$1,000**—~~ *(retirada en la 5ª: **ese dial
      también dejó de existir**, D31)*.
      **Regla vigente**: la **tarifa de envío del buylist** debe ser **estrictamente menor que el MÍNIMO DE
      COMPRA** —hoy **MX$180 < MX$500**—, porque el mínimo es **inclusivo** y **la solicitud más chica que
      aceptamos vale exactamente el mínimo**: si la tarifa lo igualara, **una operación con todo aprobado
      depositaría MX$0**. M10 debe **impedir** esa combinación, **no solo advertirla**.
      *(**Colchón: ninguno** —estrictamente menor—. **Cerrado por el humano en la 5ª ronda**: aceptó a ojos
      abiertos que en el piso de $500 el envío pese **36%**; con eso la **pregunta 24 queda cerrada**.)*
      *(**⚠ Lo que NO cubre**: la **oferta recortada por cherry-pick** puede quedar por debajo de la tarifa y
      depositar **MX$0** — se señalaba en §P.12 y §P.5.1 como **pregunta abierta 25**. **⚠ CERRADO en la 6ª
      ronda por D34**: eso lo cubre **otro dial y en otro momento** — el **neto mínimo para emitir**, en la
      **emisión**. **Esta validación no cambia**: sigue siendo `tarifa < mínimo`, bloqueante, en M10.)*

| Dial del ciclo | Default | Qué gobierna |
|---|---|---|
| **Plazo para aceptar la oferta** (D3/D14) | **2 días hábiles** | Sin respuesta ⇒ **`rechazada`** (§P.3). Se **congela** al enviar la oferta |
| **Plazo para que el paquete salga** (D4/D14/D21) | **3 días hábiles** | Sin envío ⇒ **`expirada`** (§P.4). Se **congela** al entregar la guía |
| **Plazo de caducidad de la solicitud sin oferta** (**D33**) | **7 días hábiles** | *(NUEVO 5ª ronda)* Sin que **nadie oferte**, la solicitud queda **`expirada` con motivo `no_offer`** *(6ª ronda — ~~`caducada`~~)* y sale el correo de **«no procederemos»** (§P.3.1). Se cuenta **desde la creación** y **se congela** ahí; ~~**NO se reinicia** si se cancela una oferta *(6ª ronda)*~~ **⚠ CORREGIDO en la 7ª ronda (D38): SÍ se reinicia — cancelar una oferta emitida devuelve la solicitud a la fila con los 7 días hábiles COMPLETOS** (§P.3.1, criterio 172). **Es el único plazo que corre contra NOSOTROS** y **no lleva recordatorio al cliente**. *(7ª ronda, D39: **no hace falta agotarlo** — el operador puede **declinar ahora** y cerrar la solicitud el día 1, con el mismo correo y el mismo estado terminal)* |
| **Mínimo de compra** (D18) | **MX$500** *(inclusivo)* | Por debajo, **no se crea la solicitud** (§P.12). **Desde él, la guía va por nuestra cuenta** (D31). Se juzga sobre el **total cotizado**, **al crear** |
| **Neto mínimo para EMITIR la oferta** (**D34**) | **MX$200** *(inclusivo)* | *(NUEVO 6ª ronda; **borde confirmado en la 7ª, D40**: **MX$200 exactos SÍ se emiten** — la condición de bloqueo es **`neto < 200`**)* Por debajo, **la oferta NO se emite y el correo NO se manda** — el operador **compra más líneas o no oferta** (§P.2). Se juzga sobre el **neto** (`bruto ofertado − tarifa congelada`), **al emitir**, contra el resultado del **cherry-pick**. **Único dial que NO se evalúa en M10 ni en un barrido.** **Sube a MX$200** el bloqueo de `neto ≤ 0` que ya existía. **No toca** el piso de cero al pagar (criterio 152) |
| ~~**Umbral de guía a nuestro costo** (D18b)~~ | ~~**MX$1,000** *(inclusivo)*~~ | **⚠ RETIRADO en la 5ª ronda (D31): dial SIN OBJETO.** **La guía la ponemos SIEMPRE**, desde el mínimo, así que **no hay umbral que configurar** (§P.4, §P.12). **No se implementa** |
| **Tope de oferta del operador** (D13/**D24**) | **MX$1,500** | Bruto por encima del cual la oferta **la autoriza el súper-admin** (§P.2). Incluye los **overrides** (D26) |
| **Tope general de piezas por variante** (D15/**D29**) | **10 piezas** | Dispara **«no comprar»** en cartas **sin bounty**; **nunca bloquea** (§P.2). *(5ª ronda, D32: con el **objetivo del bounty obligatorio**, **siempre hay contra qué comparar**; **6ª ronda, D35**: ese objetivo tiene **default 2** y **los bounties viejos se llenan con 2** — el default **NO es un dial de M10**, es el valor inicial de un campo editable por bounty, §N.6)* |
| **Tarifa de envío del buylist** (D16/**D25**) | **MX$180** | El **envío que se descuenta SIEMPRE** (D31) y que el correo de oferta anuncia; se **congela** al ofertar (§P.4). **Distinta** del envío de retiro (MX$175). **Es lo que se le descuenta al vendedor**, no necesariamente lo que costó la etiqueta (el costo real es **captura opcional**, 5ª ronda) |
| **Alerta de «ya lo mandé» sin confirmar** (**P17**) | **5 días hábiles** | Pasado ese tiempo, la solicitud se **destaca como alerta** en la cola de «por confirmar envío» (§P.13). **No expira nada** |
| ~~**Umbral de «recorte material»** (**D28**)~~ | ~~**20%** del bruto~~ | **⚠ RETIRADO en la 4ª ronda (D30): dial SIN OBJETO.** Gobernaba la pregunta *«¿continúas?»* del rechazo parcial; **al no haber pregunta, no hay umbral que calibrar** (§P.5.1). **No se implementa** |

**P.11 — Flujos críticos (base para el E2E de QA)**
> **Camino feliz — el ciclo completo, de cotizar a estar a la venta** *(actualizado 2ª ronda: el envío lo
> ponemos nosotros; **5ª ronda: una sola banda — el envío lo ponemos SIEMPRE**)*:
> 1. Un usuario con **celular en su cuenta** cotiza 3 cartas por **MX$1,200** (cualquier monto **desde el
>    mínimo de MX$500** sirve: **ya no hay umbral de guía**) y crea la solicitud — **eligiendo su CLABE y su
>    DIRECCIÓN de la libreta que ya usa para recibir compras** *(7ª ronda, D36/D37; si no tuviera ninguna, la
>    captura ahí)* → queda **`cotizada`**, la
>    pantalla le dice **que todavía no mande nada** y **ya le dice que el envío lo ponemos nosotros y que se
>    deduce de lo que se le paga** (D31) — *(**8ª ronda, D43**: **en palabras y sin ninguna cifra de envío**;
>    el único monto que ve aquí es **el valor de sus cartas**, y el **faltante del mínimo** cuando aplique)*.
> 2. El súper-admin (**o el operador, si el bruto cabe en su tope**) abre la **mesa de decisión** y ve, por
>    cada carta, **cuántas tiene** y **cuántas vienen en camino**, más la **sugerencia**. **Compra 2 líneas y
>    descarta 1.**
> 3. Manda la oferta → la solicitud queda **`ofertada`** y **sale el correo** con el **desglose (2 compradas,
>    1 no)**, los **tres montos (bruto, envío, neto)**, **cuál se deposita**, el aviso de que **la guía va por
>    nuestra cuenta** y la **fecha y hora límite**.
> 4. El cliente entra a su portal **con sesión** y **acepta el paquete completo** → **`aceptada`**. **Nada
>    está en camino todavía** (el conteo de "en camino" del admin **no se mueve**).
> 5. El operador **compra la guía a mano** —**con la dirección que el vendedor dio en el paso 1**, que ya
>    está en la ficha; **no se la pide a nadie** (7ª ronda, D36)—, **captura el número** y **se la manda al
>    vendedor**; ahí arranca el plazo de **3 días hábiles** para que el paquete salga.
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
> instrucciones de envío hasta que **hay oferta aceptada**. *(**Precisión de la 7ª ronda, para que D36 no se
> lea como una contradicción**: la «dirección» que **no** se muestra aquí es **la de destino y las
> instrucciones de envío** —lo que le diría al vendedor **a dónde mandar** y **cómo**—. La dirección que
> **sí** se capturó al crear la solicitud es **la SUYA, de origen**, y es un **dato de entrada**, no una
> instrucción de envío: **tenerla no lo habilita a mandar nada**.)*
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
> ~~**Flujo crítico — las tres bandas de monto y sus bordes (D18/D18b, bordes de la 3ª ronda):** una
> solicitud de **MX$300** no se crea; una de **MX$700** se crea y **el vendedor paga su envío** (correo con
> **un solo monto**); una de **MX$1,500** se crea y **la guía la ponemos nosotros**. Bordes: **$500 y $1,000
> inclusivos**.~~ **⚠ SUPERSEDED por D31 (5ª ronda)** — historial.
> **Flujo crítico — DOS bandas y UN borde (D18 + D31):** una solicitud de **MX$300** **no se crea** y el
> cotizador dice **cuánto falta**; una de **MX$700** se crea y **la guía la ponemos nosotros** (correo con
> **bruto MX$700, envío MX$180 y neto MX$520**); una de **MX$1,500** también (**bruto MX$1,500, envío MX$180,
> neto MX$1,320**). **El único borde, explícito: exactamente MX$500 SÍ se crea Y SÍ lleva guía nuestra**
> (correo con **bruto MX$500, envío MX$180, neto MX$320** — el **36%**, anunciado **antes** de aceptar).
> **Verificable por lo que NO existe**: **ningún** monto produce un correo de oferta con **un solo monto**, y
> **no hay** ningún dial de «umbral de guía» en M10.
>
> **Flujo crítico — el descuento se anuncia en las TRES superficies, antes de aceptar (D31; *acotado en la
> 8ª por D43*):** el
> **cotizador**, el **correo de oferta** y los **términos** dicen que **el envío lo ponemos nosotros y que
> siempre se deduce del importe a pagar**. Verificable en el caso que más duele: una oferta de **MX$500** —
> el vendedor **ve MX$320** como depósito **antes** de apretar «aceptar», no después. *(**⚠ 8ª ronda, D43**:
> lo que va a las tres superficies es **la regla**; **la cifra vive en la oferta**. Este flujo **sigue
> verificándose igual en su punto que importa** —los MX$320 antes de aceptar—, y **cambia solo dónde NO
> deben estar**: ver el flujo de D43 más abajo.)*
>
> **Flujo crítico — la solicitud que nadie oferta caduca (D33; *precisado en la 6ª ronda*):** una solicitud
> **`cotizada`** que **nadie ofertó** en **7 días hábiles** queda **`expirada` con motivo `no_offer`** y
> **sale el correo que dice que NO PROCEDEREMOS con la oferta** e invita a **volver a cotizar**. Verificable
> adelantando el reloj; verificable además que **los dos motivos de `expirada` se distinguen** —**correos
> distintos** y **motivo visible en la cola, en la ficha y en los reportes**—, que **no llega ningún
> recordatorio** por este plazo y que **ofertar después ya no funciona** (terminal es terminal).
> **Verificable el borde que resolvió el arquitecto**: una solicitud con **oferta esperando autorización**
> del súper-admin **caduca igual**, y **el barrido ANULA esa oferta** —después **no se puede autorizar**—.
>
> ~~**Flujo crítico — el reloj de caducidad no se reinicia (6ª ronda):** se cancela una oferta emitida y la
> solicitud vuelve a la fila; el reloj **sigue contando desde la creación original**, **no** desde la
> cancelación. Verificable en el caso incómodo: si al cancelar ya pasaron los **7 días hábiles** desde la
> creación, la solicitud **caduca ese mismo día**.~~ **⚠ SUPERSEDED por D38 (7ª ronda)** — historial.
>
> **Flujo crítico — el reloj de caducidad SÍ se reinicia al cancelar una oferta (D38, 7ª ronda):** se emite
> una oferta, se **cancela** al **día 8 hábil** para corregir un número, y la solicitud vuelve a la fila.
> **No caduca ese día**: arranca **un plazo nuevo y completo de 7 días hábiles** desde la cancelación.
> Verificable **en el caso que motivó la corrección**: al día siguiente de cancelar, la solicitud **sigue
> viva** y **el cliente NO recibió ningún «no procederemos»**. Verificable también el caso normal: **sin
> ninguna cancelación**, el reloj **cuenta desde la creación** como siempre (nada cambió ahí).
>
> **Flujo crítico — «declinar ahora»: la respuesta sale el día 1, no el día 7 (D39, 7ª ronda):** sobre una
> solicitud **`cotizada`** creada hoy, el operador aprieta **«declinar ahora»**. Verificable que el desenlace
> es **idéntico al del barrido**: la solicitud queda **`expirada` con motivo `no_offer`**, sale **el mismo
> correo de «no procederemos»** (con su invitación a volver a cotizar), **ofertar después ya no funciona** y
> **una oferta que estuviera esperando autorización se anula**. Verificable la diferencia, que es **solo el
> tiempo**: el cliente recibe el correo **ese mismo día**, **sin esperar los 7 días hábiles**. Verificable
> **por lo que NO aparece**: **ningún** estado nuevo, **ningún** motivo nuevo, **ningún** correo nuevo y
> **ningún** plazo nuevo. Verificable en la bitácora: **queda registrado quién declinó**, y se distingue de
> un cierre por barrido.
>
> **Flujo crítico — sin dirección no hay solicitud, y el recurrente no re-teclea (D36/D37, 7ª ronda):**
> **(1)** un vendedor **sin ninguna dirección guardada** llega al mínimo de MX$500 y **no puede crear la
> solicitud** hasta capturar una; al capturarla, **queda en su libreta** —la misma con la que recibe sus
> compras—. **(2)** el **mismo vendedor**, en su **segunda venta**, **no captura nada**: **elige o confirma**
> la que ya tiene. **(3)** un vendedor con **tres direcciones guardadas** **elige cuál usa**. **(4)** al
> aceptar la oferta, el operador compra la etiqueta **con esa dirección**, **sin pedírsela a nadie**.
> Verificable **por lo que NO existe**: **no hay** una libreta de «remitentes» separada de la del comprador,
> **no hay** pantalla nueva de domicilio y **no se pide la dirección al aceptar**. Verificable el borde ya
> vigente: una dirección **fuera de México** **no sirve** para vender (criterio 31).
>
> **Flujo crítico — LOS CINCO CORREOS, y el que NO sale (8ª ronda; criterio 173):** se montan **cuatro
> cierres distintos** sobre cuatro solicitudes y se leen **las cuatro bandejas**:
> **(1)** oferta enviada, el vendedor **no responde** en 2 días hábiles ⇒ queda **`rechazada`** y le llega
> **«tu plazo venció»**;
> **(2)** oferta aceptada, el **paquete no sale** en 3 días hábiles ⇒ **`expirada` + `not_shipped`** y le
> llega **«aceptaste y no mandaste»**;
> **(3)** oferta **enviada** que **nosotros cancelamos** ⇒ la solicitud **vuelve a `cotizada` y sigue viva**,
> le llega **«la cancelamos nosotros, tu solicitud sigue viva»** y **arranca un plazo nuevo de 7 días
> hábiles** (criterio 172);
> **(4)** oferta **pendiente de autorización** que **nosotros cancelamos** ⇒ **no le llega absolutamente
> nada** y **el reloj no se reinicia**.
> **Verificable por lo que NO pasa, que es donde estaba el defecto**: en **(3)** el vendedor **no recibe**
> ningún texto que diga *«venció»*, **ningún** plazo suyo, **ningún** monto de la oferta cancelada y
> **ninguna** invitación a «cotizar de nuevo» —duplicaría una solicitud abierta—; y en **(4)** **no aparece
> nada** en su bandeja **ni en su portal** que le revele que existió una oferta. **Los casos (3) y (4) se
> corren juntos**: es la misma acción con dos consecuencias opuestas, y probarlas por separado esconde
> justamente el riesgo.
>
> **Flujo crítico — el correo 5 y el portal dicen LO MISMO (D42, 9ª ronda; criterio 176):** se toma el caso
> **(3)** del flujo anterior —oferta **enviada** que **nosotros cancelamos**— y, **sin salir de la sesión del
> vendedor**, se abre **su solicitud en el portal**. Verificable que **la pantalla confirma el correo**:
> dice que **hubo una oferta**, que **se canceló** y **con qué fecha**, y el estado que muestra es el de una
> solicitud **viva y esperando nuestra oferta** (`cotizada`). Verificable **por lo que NO aparece**: **el
> motivo interno** de la cancelación, **ningún monto** de la oferta cancelada, **ninguna palabra de plazo
> vencido** y **ninguna acción** que lo invite a cotizar de nuevo. **Y el contracaso, en la misma corrida**:
> el caso **(4)** —oferta que solo esperaba autorización— **deja el portal exactamente igual que antes**:
> **cero rastro**. **Los dos se corren juntos, como el correo y el reloj**: es la **tercera consecuencia**
> del mismo hecho, y probarla sola esconde justo el riesgo de que se desincronice.
>
> **Flujo crítico — el cotizador dice el envío en palabras, y el mínimo con su cifra (D43, 8ª ronda;
> criterio 174):** un visitante arma un carrito de **MX$380**. Verificable **las dos cosas a la vez**:
> **(a)** la pantalla **dice «te faltan MX$120»** para el mínimo de MX$500 —**criterio 132(a), intacto**—; y
> **(b)** **en toda la pantalla no aparece ningún número de envío**: ni **MX$180**, ni un porcentaje, ni un
> «recibirías», ni una resta. Se completa el carrito a **MX$600** y se repite: sigue **sin cifras de envío**,
> con **el valor de las cartas como único monto** y **la frase cualitativa** debajo. Después se emite la
> oferta y **ahí sí** aparecen **los tres montos con la resta** (criterio 134), **iguales en el correo y en
> la pantalla de aceptación**. **Verificable por lo que NO existe**: **ninguna** frase que exprese el
> faltante del mínimo **en términos de envío**, y **ninguna** aparición de la palabra «fija» aplicada a la
> tarifa **fuera de la oferta** (criterio 175c).
>
> **Flujo crítico — la oferta que no vale la pena NO se emite (D34):** de una solicitud cotizada en
> **MX$3,000** el operador recorta hasta un **bruto de MX$300**; el neto sería **MX$120** ⇒ **la emisión se
> bloquea**, **el correo NO se manda** y el mensaje dice **por qué y cuánto falta**. El operador **agrega
> líneas** hasta un bruto de **MX$400** (neto **MX$220**) ⇒ **la oferta sale**. Verificable con los **tres
> bordes** contra el piso de **MX$200**: bruto **MX$379** (neto **MX$199**) ⇒ **no se emite**; bruto
> **MX$380** (neto **MX$200**) ⇒ **se emite** —**el piso es inclusivo**—; bruto **MX$381** (neto **MX$201**)
> ⇒ **se emite**. Verificable además **por lo que NO existe**: **ningún** correo de oferta anuncia un
> depósito de **MX$0** ni de **MX$20**, y el bloqueo **no se puede saltar** desde el servidor.
>
> **Flujo crítico — el piso de EMITIR y el piso de PAGAR son dos cosas distintas (D34 × criterio 152):** una
> oferta se emite legítimamente con **bruto MX$1,000 / neto MX$820**; al verificar solo se aprueban
> **MX$100** ⇒ **se deposita MX$0**, **sin deuda**. **D34 no rescata este caso y no pretende hacerlo**: al
> ofertar **no se puede saber qué va a llegar en NM**. Verificable que **las dos reglas conviven** y que
> **ninguna anula a la otra**.
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
> envío del buylist igual o mayor que el MÍNIMO DE COMPRA** (p. ej. **$500** o **$600** con mínimo de
> **$500**) → **NO se guarda** y el error dice **por qué** (criterio 127, **re-anclado por D31**); **buscar en
> M10 el dial de «umbral de recorte material»** → **no existe** (D28 quedó sin objeto); **buscar en M10 el
> dial de «umbral de guía»** → **no existe** (D31 lo dejó sin objeto) y **ninguna conducta del sistema depende
> de él**; **crear un bounty sin capturar su objetivo** → **no se guarda** (D32) —aunque en la práctica **el campo
> llega prellenado con 2**, D35—; **buscar un bounty vivo SIN objetivo** (viejo o nuevo) → **no existe
> ninguno**: a los viejos **se les asignó 2** y **siguen en la vitrina** (D35); **intentar ofertar sobre una
> solicitud que caducó** o **autorizar una oferta que el barrido anuló al caducar la solicitud** → **no
> funciona** (D33 + terminal es terminal); **intentar EMITIR una oferta cuyo neto quede por debajo de
> MX$200** —**incluyendo llegar ahí con un override manual** o **saltándose la pantalla y pegándole directo
> al servidor**— → **no se emite**, **el correo no se manda** y el error dice **por qué y cuánto falta**
> (D34, criterio 167); **buscar en M10 una validación que impida el neto bajo** → **no está ahí**: el dial
> existe, pero **el bloqueo vive en la emisión** (§P.2); **confirmar un envío SIN capturar el costo real de
> la etiqueta** →
> **se permite**, y el gasto del periodo se registra con la **tarifa congelada de MX$180** (*fallback*), sin
> que cambie **un peso** el neto del vendedor.
> *(**Añadidos de la 7ª ronda**)*: **usuario sin ninguna dirección guardada** → **no puede crear la
> solicitud** hasta capturar una, **ni saltándose el cotizador** (validación en servidor, igual que el
> mínimo y el celular); **dirección fuera de México** → **no se acepta** (criterio 31); **buscar una pantalla
> o libreta de «domicilio de remitente»** → **no existe**: es **la misma libreta** de las compras (D37);
> **que se le pida la dirección al ACEPTAR la oferta** → **no pasa**: ya se pidió al crear (D36); **cancelar
> una oferta emitida al día 8 hábil** → la solicitud **NO caduca ese día**, vuelve a la fila con **7 días
> hábiles completos** (D38); **declinar ahora** una solicitud `cotizada` → sale **el mismo correo** y el
> **mismo estado terminal** que el barrido, y después **no se puede ofertar** (D39); **emitir una oferta con
> neto de exactamente MX$200** → **SÍ se emite** (el piso es **inclusivo**, D40), y con **MX$199** → **no**.

**P.12 — Mínimo de compra y envío: DOS tramos, UNA SOLA BANDA de compra (D18; ~~D18b~~ **CORREGIDA en la 5ª
ronda por D31**)**
> **Por qué existe el mínimo**: cada solicitud cuesta lo mismo de operar —revisar, ofertar, recibir,
> verificar, pagar por SPEI y archivar— venga por **una carta o por mil**. Debajo de cierto monto, la
> operación **pierde dinero por definición**, y hacerla igual sale más caro que decir que no.
> **Qué cambió en la 5ª ronda (D31)**: **el umbral de guía se elimina**. Eran **tres bandas** porque este
> documento había propuesto un umbral que **el humano nunca pidió**; su intención **siempre fue mandar la
> guía SIEMPRE**. **La banda intermedia —donde el vendedor pagaba su propio envío— se retira.**

| Banda (total de la solicitud) | ¿Se compra? | ¿Quién paga el envío? | Qué ve el vendedor |
|---|---|---|---|
| **Menos de MX$500** | **NO** — no se crea la solicitud | — | El cotizador le dice **cuánto le falta** (*«te faltan $120»*) |
| **MX$500 (inclusive) en adelante** | Sí | **Nosotros, SIEMPRE** (se descuentan **MX$180**, D25) | Correo con **bruto / envío / neto**, **cuál se deposita** y la frase de que **el envío siempre se deduce** (D31) |
| ~~**De MX$500 (inclusive) a menos de MX$1,000**~~ | ~~Sí~~ | ~~**El vendedor**, como hoy~~ | **⚠ BANDA RETIRADA en la 5ª ronda (D31)** — se conserva como historial. **No existe** ningún monto en el que el vendedor pague su propio envío |

- [ ] **El mínimo aplica al TOTAL de la solicitud (D18)**, no por carta ni por línea: **una carta de $600
      pasa; mil cartas que suman $400, no**.
- [ ] **Se valida en el SERVIDOR, no solo en el cotizador (D18)**: el cotizador es superficie del cliente y
      se puede saltar. **Debajo del mínimo no se crea la solicitud**, punto — igual que el monto de compra se
      deriva server-side (SEC-A1).
- [ ] **El cotizador dice cuánto falta, no solo que no se puede (D18)**: *«te faltan $120 para llegar al
      mínimo de $500»*. Un "no" seco manda al vendedor a otro lado; un "te faltan $120" lo manda **a agregar
      otra carta**.
      *(**⚠ 8ª ronda, D43 — esta cifra SE QUEDA, y la frase tiene una forma prohibida**: se dice *«te faltan
      $120 **para el mínimo de $500**»* y **nunca** *«te faltan $120 **para cubrir el envío**»*. Lo segundo
      **reintroduce la tarifa por la puerta de atrás** y además **miente sobre qué es el mínimo**: el mínimo
      **no es el envío**, es el piso por debajo del cual **operar la solicitud pierde dinero** —la razón que
      abre esta sección—. Criterios **132** y **174**.)*
- [ ] **El cotizador NO menciona ningún monto de envío** *(NUEVO 8ª ronda, **D43**; ver §H, criterio 174)*:
      la tabla de arriba **se lee así**: en la columna «qué ve el vendedor», **la cifra del envío es de la
      OFERTA, no del cotizador**. En el cotizador va **la regla en palabras** —*«nosotros ponemos la guía y
      su costo se descuenta de lo que te pagamos»*— **sin tarifa, sin resta, sin neto estimado y sin
      porcentaje**. **El mínimo y su faltante no se tocan** (bullet anterior). **Los dos números conviven en
      la misma pantalla sin contradecirse** porque **uno es sobre sus cartas y el otro sobre nuestro
      servicio**, y solo el primero es exacto en ese momento.
- [ ] ~~**Los dos umbrales son diales SEPARADOS (D18b)**: el **mínimo de compra** y el **umbral de guía**
      viven en M10 como dos números independientes.~~ **⚠ SUPERSEDED por D31 (5ª ronda)**: **el umbral de guía
      se retira**. Los **dos diales de monto** que quedan son el **mínimo de compra** y la **tarifa de envío
      del buylist**; **mover uno no mueve el otro** (aunque **una validación bloqueante los relaciona**:
      `tarifa < mínimo`, criterio 127).
- [ ] **UN solo borde, y es INCLUSIVO** *(3ª ronda, pregunta 19; **simplificado en la 5ª por D31**)*:
      - **$500 inclusivo**: una solicitud de **exactamente MX$500 SÍ se crea** **y SÍ lleva guía nuestra**.
      - ~~**$1,000 inclusivo**: una oferta de exactamente MX$1,000 SÍ lleva guía nuestra.~~ **⚠ SIN OBJETO
        (D31): ya no hay segundo borde que definir.**
      Va **a favor del vendedor en el borde**, y ahora se explica en una sola frase: *«desde $500 te
      compramos, y el envío siempre lo ponemos nosotros y se descuenta»*.
- [ ] **Sobre qué monto se juzga el mínimo**: el **mínimo** se juzga sobre el **total cotizado** al crear la
      solicitud (es cuando aplica). ~~Y el **umbral de guía** sobre el **BRUTO ofertado**.~~ **⚠ SIN OBJETO
      (D31)**: **no hay nada que juzgar** para decidir si mandamos etiqueta — **siempre la mandamos**.
- [ ] **El mínimo NO se re-aplica a la oferta** *(3ª ronda; cierra la pregunta 19 — supuesto confirmado)*: el
      mínimo **gatea la creación de la solicitud, no la oferta**. ~~Si se cotizaron **$600** y tras el
      cherry-pick solo compramos **$200**, **la oferta sale igual**~~ *(**⚠ EJEMPLO superado en la 6ª ronda
      por D34**: ese caso da **neto MX$20** y **ya NO se emite**. **La regla sigue igual**; cámbiese el
      ejemplo por **se cotizaron $3,000 y tras el cherry-pick compramos $600** — neto **$420** —, que **sí
      sale**)*: ya gastamos el trabajo de revisar esa
      solicitud, y negarnos a comprar al final por **el mismo** umbral que se cumplió al entrar sería tirar
      ese trabajo **y** dejar al vendedor sin respuesta. **Un solo umbral por momento** *(~~«en un solo
      momento»~~ — **6ª ronda**: hay **dos momentos**, el de crear y el de emitir, **con umbrales distintos**;
      lo que sigue prohibido es **aplicar el mismo umbral dos veces**).*
      *(⚠ **Requisito retirado** de la 2ª ronda, se señala en vez de borrarlo: aquí decía que *«la mesa de
      decisión debe avisarlo»*. Era **alcance que yo había inventado** mientras la pregunta seguía abierta;
      con la respuesta del humano —«el mínimo no se re-aplica»— **no hay aviso obligatorio**. La mesa ya
      muestra el **bruto ofertado** en todo momento, así que el operador tiene la cifra a la vista.)*
      ~~*(⚠ **CONSECUENCIA de la 5ª ronda (D31), que este documento señaló en vez de resolver en
      silencio**: como ahora **el envío se descuenta SIEMPRE**, un bruto ofertado por debajo de **MX$180**
      produce un **neto de MX$0 aunque todas las cartas lleguen en NM** —el piso de cero, criterio 152—.
      **Antes de D31 eso no podía pasar** en esa zona de monto, porque ahí el vendedor pagaba su propio envío
      y **no había nada que descontarle**. **Lo que protege al vendedor sigue existiendo y es real**: **no
      queda debiendo nada** y **ve el neto antes de aceptar** (D31), así que **puede rechazar una oferta que
      no le paga nada**. **Lo que NO existe hoy** es un **piso de neto** que impida siquiera emitir esa
      oferta — eso sería **alcance nuevo**: **pregunta abierta 25**.)*~~
      **⚠ NOTA COMPLETA SUPERADA — corrección de la 7ª ronda (o.17, enrutada por el arquitecto)**. Se
      conserva como historial porque **es la razón por la que existe D34**, pero **su desenlace ya no puede
      ocurrir**: con el **piso de neto de MX$200**, **una oferta con bruto por debajo de MX$380 no se emite**,
      así que **no hay forma de que un cherry-pick produzca un neto de MX$0 —ni de MX$20— al EMITIR**.
      **Lo que sigue siendo cierto**: **el mínimo de compra no se re-aplica a la oferta** (la **regla** de
      (c), intacta) y **el vendedor nunca queda debiendo** (criterio 152). **Lo que ya no debe citarse como
      válido en ningún lado**: los ejemplos con **neto MX$20** o **neto MX$0** como ofertas que *«salen
      igual»*.
- [ ] **El mínimo no se re-aplica, PERO hay un segundo umbral en el segundo momento** *(NUEVO 6ª ronda,
      **D34**; cierra la pregunta 25 sin contradecir lo que el humano ya había decidido)*: la regla de arriba
      **sigue intacta** —el **mínimo de compra** gatea **la creación de la solicitud** y **no se vuelve a
      aplicar a la oferta**—. Lo que la 6ª ronda agrega es **otro umbral, con otro número y otra pregunta**:
      el **neto mínimo para EMITIR (MX$200)**, que se juzga **al emitir la oferta** (§P.2).
      **No es «volver a aplicar el mínimo»** y conviene decir por qué, porque se parecen: el **mínimo de
      compra** pregunta *«¿vale la pena abrir esta operación?»* y se mide sobre el **total cotizado**; el
      **piso de neto** pregunta *«¿vale la pena esta oferta, ya recortada?»* y se mide sobre el **neto**.
      Si el piso fuera «el mínimo otra vez» ($500), un cherry-pick legítimo de un lote grande **quedaría
      prohibido**; con **MX$200** —bruto de ~**MX$380**— **el cherry-pick sigue siendo posible** y lo único
      que se prohíbe es **la oferta que no se paga sola**.
      **Sigue habiendo un solo umbral por momento**: uno al crear, uno al emitir.
      **Los DOS bordes son INCLUSIVOS y van a favor del vendedor** *(7ª ronda, **D40** — confirmación del
      humano; **no cambia nada**, cierra la ambigüedad)*: una solicitud de **exactamente MX$500 SÍ se crea**
      y una oferta de **neto exactamente MX$200 SÍ se emite**. Las condiciones que bloquean son
      **`total < 500`** y **`neto < 200`**, nunca `≤`.
      *(**7ª ronda, o.17 — revisión de ejemplos**: se verificó que **ningún ejemplo vivo de este documento**
      presenta un **neto de MX$20 o de MX$0 al emitir** como desenlace válido. Los que había —en el propio
      criterio 158c, en §P.5.1 y aquí arriba— **quedaron tachados y marcados**. **La regla de 158(c) no se
      tocó**: lo único superado eran **los números del ejemplo**.)*

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
  *(Ojo — esta línea NO responde la **pregunta abierta 26**: lo que está fuera es la plataforma como
  **intermediaria** entre dos usuarios. Que **la plataforma COMPRE** una carta que ya está en la bóveda —el
  buylist sin el paso de envío— es **otra cosa** y está **sin decidir**. Hoy **no existe y no se promete**
  (decisión **64**, criterio **121**).)*
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
  v2.1, D16/D18b)**: ~~**arriba de MX$1,000**~~ **SIEMPRE, desde el mínimo de MX$500** *(actualizado 5ª ronda,
  **D31**: el umbral se elimina)*, **la guía la paga la plataforma** y se descuenta del pago
  (`bruto − envío = neto`). Lo que **sigue fuera** es la **integración con paquetería** (ver punto siguiente).
- **Que el vendedor pague su propio envío en alguna banda de monto** *(NUEVO 5ª ronda v2.1, **D31** — retira
  lo que la 2ª ronda había metido al alcance)*: **no existe**. **No hay** banda intermedia, **no hay** correo
  de oferta con un solo monto y **no hay** dial de «umbral de guía». **En toda compra ponemos la guía y su
  costo se deduce del importe a pagar**, y eso se dice en el cotizador, el correo de oferta y los términos.
- **Panel de bounties** *(NUEVO 5ª ronda v2.1, **D32**)*: **fuera de alcance por decisión explícita del
  humano** — lo pidió y decidió dejarlo como **proyecto aparte**. Lo único que entra aquí es **exigir el
  objetivo del bounty donde hoy se configuran** (§N.6). **No** hay pantalla nueva de gestión, ni tablero de
  bounties, ni reportes de avance contra objetivo.
- **Integración con paquetería en el buylist** *(2ª ronda v2.1, D19)*: la guía se **compra a mano y fuera del
  sistema**, y el operador **captura el número**. **No** hay compra automática de etiquetas, **ni** cotización
  de tarifas, **ni** rastreo en vivo, **ni** validación del número contra el transportista, **ni** cancelación
  automática de la etiqueta no usada (el sistema **deja la tarea** al operador, D22). **Es proyecto aparte.**
  El sistema **solo guarda y muestra** el número. Sigue aplicando el punto general de «Pagos y logística
  automatizados» de arriba.
  *(Precisión 5ª ronda)*: la **captura opcional del costo real de la etiqueta** (criterio 166) **NO es
  integración**: es **un campo que el operador escribe** al confirmar el envío. Sigue sin haber cotización de
  tarifas ni consulta al transportista.
- ~~**Recordatorios automáticos de los plazos del buylist** *(v2.1, SUPUESTO)*~~ — **REVERTIDO (2ª ronda
  v2.1, D23)**: **el recordatorio SÍ entra al MVP**. Es **uno solo**, a **un día hábil** de vencer y **una
  sola vez**, y **solo para los dos plazos DEL VENDEDOR**. ~~Los correos obligatorios del ciclo pasan a ser
  **tres**.~~ ~~**⚠ Actualizado en la 5ª ronda (D33): son CUATRO** — **oferta**, **recordatorio**,
  **expiración/cancelación** y **«no procederemos» por caducidad**.~~ **⚠ Actualizado otra vez en la 8ª
  ronda: son CINCO** — **oferta**, **recordatorio**, **expiración**, **«no procederemos»** y **«cancelamos
  la oferta»** (§P.3, criterio 173). Lo que **sigue fuera** es cualquier
  **secuencia** de recordatorios (más de uno por plazo, escalado, SMS o WhatsApp) y **cualquier recordatorio
  del plazo de caducidad**, que corre contra nosotros y no contra el vendedor.
- **Avisarle al vendedor de una oferta que nunca salió** *(NUEVO 8ª ronda v2.1)*: **no existe**. Cancelar
  una oferta que estaba **pendiente de autorización** **no manda ningún correo, ni una notificación, ni deja
  rastro en su portal**. **No es un olvido**: **esa oferta nunca existió para él**, y contársela sería
  revelarle **una decisión y un control internos** que jamás le concernieron. Si alguien lo propone, es
  **alcance nuevo** y hay que pedirlo con esa objeción resuelta (§P.3, criterio 173c).
- **Cifras de envío en el cotizador público** *(NUEVO 8ª ronda v2.1, **D43**)*: **no existen**. El cotizador
  **no muestra la tarifa, ni la resta, ni un neto estimado, ni un porcentaje, ni el faltante del mínimo
  expresado en términos de envío**. Dice **la regla en palabras** y **el faltante del mínimo con su cifra**
  (criterio 132, **intacto**), y nada más. Razón: el cotizador **es indicativo** y su neto era
  **sistemáticamente optimista** —el recorte del operador **solo quita líneas**—, así que era **la mejor
  cifra posible, nunca la esperada**. Si alguien quiere reponer la resta ahí, es **alcance nuevo** y tiene
  que resolver eso primero (§H, criterio 174).
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
- **Re-ofertar sobre una solicitud terminal** *(2ª ronda v2.1, respuesta a la pregunta 2; **corregido en la
  6ª**)*: `rechazada`, `expirada` —**con cualquiera de sus dos motivos**, `not_shipped` y `no_offer`— y
  `abandonada` son **terminales**. ~~y —*5ª ronda, D33*— **`caducada`**~~ **⚠ SUPERADO: no es un estado.**
  No se revive una solicitud ni se le emite una oferta nueva encima: el vendedor **cotiza de nuevo** *(y en
  el caso de la caducidad, el correo de «no procederemos» **se lo dice explícitamente**)*.
- **Emitir una oferta que no vale la pena** *(NUEVO 6ª ronda v2.1, **D34**)*: **no existe** ninguna vía para
  mandarle a alguien una oferta cuyo **neto quede por debajo de MX$200**. No es que el vendedor la reciba y
  la rechace: **no se emite**. El operador **compra más líneas o no oferta** (§P.2, criterio 167).
- **Panel de gestión de bounties** *(5ª ronda v2.1, D32; **confirmado en la 6ª**)*: sigue **fuera** — el
  humano lo dejó como **proyecto aparte**. **D35 no lo reabre**: fijar el **default en 2** y **llenar los
  bounties viejos con 2** se hace **donde hoy se configuran los bounties**, **sin pantalla nueva** ni
  tablero.
- **Editar una oferta ya enviada** *(2ª ronda v2.1, respuesta a la pregunta 3)*: no hay ventana de
  corrección. Si el admin se equivocó, **cancela y emite otra** (correo nuevo, plazo desde cero, auditado).
  ~~*(**Precisión de la 6ª ronda, para que «plazo desde cero» no se lea de más**: lo que arranca de cero es el
  **plazo de ACEPTACIÓN** de la oferta nueva. El **reloj de caducidad NO se reinicia** — sigue contando
  desde la **creación de la solicitud** (§P.3.1). Son dos relojes distintos.)*~~
  **⚠ CORREGIDO en la 7ª ronda (D38)**: **arrancan de cero los DOS relojes** — el **plazo de aceptación** de
  la oferta nueva **y** el **plazo de caducidad**, que vuelve a **7 días hábiles completos** al cancelar
  (§P.3.1, criterio 172). **Siguen siendo dos relojes distintos**; lo que cambió es que **la cancelación los
  reinicia a ambos**.
- **Aceptar una oferta desde un enlace anónimo** *(2ª ronda v2.1, respuesta a la pregunta 7)*: aceptar
  **exige sesión iniciada**. El enlace tokenizado de §J sirve para **mirar** un pedido de invitado, no para
  **comprometer dinero**.
- **Una libreta de «direcciones de remitente» separada de la del comprador** *(NUEVO 7ª ronda v2.1, **D37**)*:
  **no existe y no se construye**. La dirección con la que compramos la guía del buylist sale de **la misma
  libreta** que el cliente usa para **recibir sus compras** (§P.2.1). **No hay modelo nuevo, no hay pantalla
  nueva y no hay un «domicilio de remitente» aparte.** Si alguien lo propone, es **alcance nuevo** y hay que
  pedirlo con la razón resuelta: **es el mismo domicilio de la misma persona**, y dos libretas producen
  **dos verdades**.
- **Vender sin dirección** *(NUEVO 7ª ronda v2.1, **D36**)*: **no existe** ninguna vía para crear una
  solicitud de venta **sin una dirección de origen**. No es una advertencia ni un pendiente que se resuelva
  después: **es bloqueante en la creación**, igual que el **celular** (D11) y el **mínimo** (D18) — porque
  **sin domicilio no hay etiqueta**, y **la etiqueta la ponemos nosotros siempre** (D31).

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
- **Ciclo de adquisición del buylist** *(v2.1, §P; actualizado en la 2ª ronda por D13–D23; **6ª ronda**)*: el
  pipeline es
  `cotizada → ofertada → aceptada → en_transito → recibida → verificación → aprobada → pagada`, con **cuatro
  estados terminales** (**`pagada`, `rechazada`, `expirada`, `abandonada`**) ~~y —*5ª ronda, D33*—
  **`caducada`**~~ **⚠ 6ª ronda: siguen siendo CUATRO** — la **caducidad** es **`expirada` con motivo
  `no_offer`** (frente a `not_shipped`), con el **motivo en columna propia**; el requisito de negocio es que
  **los dos desenlaces sean distinguibles** (§P.1, criterio 169).
  **Nada llega a "en camino" sin
  oferta aceptada** ni sin que **el operador confirme el envío** (D20). El **precio ofertado es vinculante
  desde que sale el correo**; frente al vendedor lo vinculante es el **NETO** y el **costo de adquisición** es
  el **BRUTO** (el envío es **gasto operativo**, D16). Los ~~**dos**~~ **TRES plazos** —**2 días hábiles**
  para aceptar, **3 días hábiles** para que salga el paquete y **7 días hábiles para que NOSOTROS ofertemos**
  (*5ª ronda, D33*)— son **diales de M10** editables sin deploy y auditados, junto
  con el **mínimo de compra (MX$500)**, el **tope de oferta del operador**,
  el **tope de piezas por variante** y —*6ª ronda, D34*— el **neto mínimo para EMITIR una oferta
  (MX$200)**. ~~el **umbral de guía (MX$1,000)**~~ — **retirado (D31): dial sin
  objeto**. **Son NUEVE diales en total** (§P.10, origen único). La **guía la ponemos nosotros SIEMPRE** *(5ª ronda, D31 — ~~arriba del umbral~~)*, se compra **a
  mano y fuera del sistema** (**sin integración con paquetería**, D19) **al aceptar** (D21), y su **costo
  real es captura opcional** con *fallback* a la tarifa congelada. El **monto de cada
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
> **⚠ Actualización v2.1 — 5ª ronda (D31–D33):** el criterio **133** (tres bandas de monto) queda
> **SUPERSEDED** por el **162** (una sola banda) — **QA no verifica el 133**. Se **actualizan** los criterios
> **16, 113, 122, 123, 127, 129, 134, 135, 142, 145, 149, 153, 158, 159** y se agregan los **162–166**. **El
> 152 (invariante money-safe) NO se toca**, y **150/151/161** de la 4ª ronda **siguen vigentes tal cual**.
> **⚠ Actualización v2.1 — 6ª ronda (D34–D35 + resolución de la pregunta 27):** se **actualizan** los
> criterios **16, 113, 127, 129, 145, 152 (solo con una nota de alcance — el invariante NO cambia), 158,
> 164 y 165**, y se **agregan los 167–169**. **Los diales del ciclo pasan de OCHO a NUEVE** (criterio 127) y
> **los estados terminales vuelven a ser CUATRO** (criterio 169): `caducada` **no existe como estado** —QA
> no debe buscarlo—, la caducidad es **`expirada` con motivo `no_offer`**. **162/163 siguen vigentes tal
> cual.**

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
16. **Plazos del buylist — ~~los cuatro~~ LOS CINCO, y son de momentos distintos** *(actualizado v2.1,
    D3/D4/D8; en la 2ª ronda por D14/D21; en la 3ª por las respuestas a las preguntas 15/18/21; **corregido
    en la 4ª por D30**; y **CORREGIDO en la 5ª por D31/D33**)*:
    (a) *(sin cambio)* una **carta rechazada por no ser NM** da al usuario
    **7 días** para gestionar la devolución **a su costo**, y
    **a los 30 días** se considera **abandonada**; una carta **NM** abandonada **pasa a inventario** y una
    **no-NM** abandonada **NO entra al inventario vendible**;
    (b) *(nuevo; **⚠ COMPLETADO en la 8ª ronda — faltaba decir que sale correo**)* una solicitud
    **`ofertada`** sin respuesta del cliente en **2 días hábiles** queda
    **`rechazada`**, la oferta deja de ser válida **y se le notifica al vendedor por correo** (el **correo 3
    de expiración**, §P.3). *(**No es alcance nuevo**: el ciclo lleva desde la 2ª ronda contando un correo
    obligatorio de «expiración», y este es uno de sus dos productores. Lo que faltaba era **escribirlo aquí**
    — el frente (c) sí lo decía y el (b) no, y ese silencio se leía como «no sale nada». Un vendedor que
    recibió una **oferta vinculante** y no contestó **tiene que saber que se cerró**; dejarlo sin una
    palabra es el mismo hueco que D33 vino a cerrar del otro lado.)*;
    (c) *(nuevo)* una solicitud **`aceptada`** cuyo **paquete no salió** en **3 días hábiles** —contados
    **desde que la guía llega al vendedor**, ~~y **desde la aceptación** cuando lo paga él~~ *(**esa segunda
    mitad se retira en la 5ª ronda, D31: ya no hay banda donde él pague el envío**)*— queda **`expirada`**,
    se **cancela** y **se notifica al vendedor** por correo;
    (d) *(NUEVO 5ª ronda, **D33**; **corregido en la 6ª**)* una solicitud **`cotizada`** que **nadie ofertó**
    en **7 días hábiles** desde su creación queda **`expirada` con motivo `no_offer`** ~~`caducada`~~ y **le
    llega un correo que dice explícitamente que NO
    PROCEDEREMOS con la oferta**, invitándola a **volver a cotizar**. **Es el único plazo que corre contra
    NOSOTROS** y **no lleva recordatorio al cliente**; ~~**su reloj NO se reinicia** si se cancela una oferta
    —cuenta **desde la creación** (6ª ronda, criterio 169)~~ **⚠ CORREGIDO en la 7ª ronda (D38): su reloj SÍ
    se reinicia al cancelar una oferta emitida —la solicitud vuelve a la fila con los 7 días hábiles
    COMPLETOS— y cuenta desde la creación mientras nadie cancele nada** (criterio **172**). *(7ª ronda, D39:
    **no hace falta agotarlo para cerrar** — el operador puede **declinar ahora**, con el mismo correo y el
    mismo estado terminal, criterio **171**.)*
    Los **tres** plazos nuevos son **diales de M10** (criterio 127), se cuentan en **días hábiles** —**lunes
    a viernes, sin festivos oficiales de México, en `America/Mexico_City`** (criterios 141 y 154)— y se
    comunican al cliente **con fecha y hora explícitas**, no como "en 2 días". **Cada plazo se congela por
    solicitud** al fijarse (criterio 157); **los dos plazos DEL VENDEDOR llevan su propio recordatorio, una
    sola vez** (criterio 159) y **el de caducidad no lleva ninguno**.
    ~~**Siguen siendo CUATRO, y no cinco** *(4ª ronda, D30)*: la 3ª ronda había abierto la puerta a un quinto
    plazo —el de la pregunta *«¿continúas?»* del rechazo parcial (pregunta 23)—, que desaparece con D30.~~
    **⚠ Precisión de la 5ª ronda: AHORA SÍ SON CINCO, pero NO el quinto que D27 proponía.** El que D30 mató
    era *«pregúntale al vendedor si continúa, con las cartas ya en la bóveda»*; **el que D33 agrega es lo
    contrario**: un plazo **para nosotros**, que **obliga a responderle al cliente**. Verificable: **no
    existe** ninguna ruta que abra un plazo de respuesta **después de la verificación**, y **sí existe** un
    plazo que cierra una solicitud **antes de ofertar**.
    *(**⚠ 8ª ronda — CINCO plazos y CINCO correos NO son la misma lista, y confundirlas es fácil**: los
    plazos son **cinco** (7 y 30 días de devolución/abandono, 2 hábiles para aceptar, 3 hábiles para enviar,
    7 hábiles de caducidad) y los correos obligatorios también son **cinco**, pero **no se corresponden uno
    a uno**: el correo **3** cubre **dos** plazos —(b) y (c)— y el correo **5** («cancelamos la oferta»)
    **no cuelga de ningún plazo**: lo dispara **una acción nuestra**. El mapa correcto está en la tabla de
    **§P.3** y se verifica con el criterio **173**.)*
    Y el disparador *«falta de respuesta a un ajuste»* de §H **sigue sin ninguna ruta viva dentro del
    buylist**: D9 mató el repreciado y D30 retiró la re-confirmación, así que **el único caso vivo que activa
    los 7/30 días es la carta rechazada por no ser NM** (y cualquier pieza que el vendedor mande sin que se la
    hayamos comprado).

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

> **⚠️ AQUÍ EMPIEZAN LOS CRITERIOS 113–121 DEL HILO §O (gancho de grading).** *(nota de fusión, 2026-09-05)*
> Los números **113–121 existen DOS VECES** en esta lista: **estos**, del hilo **§O**, y los del hilo **§P**
> (ciclo de adquisición del buylist), que empiezan más abajo. Los dos bloques se numeraron **en paralelo**
> desde el 112 y **ninguno se renumeró** — los dos están citados por número desde `docs/` y los tests.
> **Para QA y para cualquiera que cite**: en el rango **113–121** el número **no basta**; se cita
> **`criterio 118 (§O)`** o **`criterio 118 (§P)`**. Fuera de ese rango no hay ambigüedad.
> Ver el aviso completo en «Decisiones tomadas». **Arreglar la numeración es decisión del humano /
> orquestador**, no de este documento.

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
120. **NUEVO — La custodia NUNCA se describe como «asegurada»** *(2026-09-01, decisión 63; **cierra la bandera
    legal del seguro de custodia**)*: **no hay póliza** sobre el inventario en bóveda, así que el producto
    describe la custodia **solo** con vocabulario de resguardo —«**resguardadas**», «**en bóveda**», «**kept
    safe**»— y **jamás** con vocabulario de seguro.
    **Verificación negativa, y es la que importa**: **cero apariciones** —en `messages/` ES y EN, en las
    **plantillas de correo** y en la **página de términos**— de una afirmación de cobertura **referida a la
    custodia**, es decir en el **home**, el **catálogo**, la **bóveda / Mi bóveda**, los **correos** al cliente
    y los **términos**. **El patrón a buscar es este, y está acotado a propósito** *(ver (e): la versión
    original marcaba «seguro» pelado y producía 5 falsos positivos)*:
    - **ES, familia de `asegurar`** — `asegurad\w*` (**asegurada/o/s**, **aseguradora**), **`aseguramos`**,
      **`aseguranza`**, **`póliza`**. Todas afirman cobertura en cualquier contexto: **fallan sin adjudicar**.
    - **ES, el sustantivo `seguro`, SOLO en posición de sustantivo** — precedido de **determinante o
      preposición** (`un/el/la/nuestro/su/con/sin seguro`) o seguido de **`contra`/`de`** (`seguro contra robo`,
      `seguro de custodia`). **`seguro` en posición de adjetivo (detrás del sustantivo: «envío seguro», «canal
      seguro») o de interjección (delante de «que»: «¿Seguro que…?») NO se marca** — no es una afirmación de
      cobertura, es otra palabra.
    - **EN** — **`insured`**, **`insurance`**, **`insurable`**.
    **(a) EXCLUSIONES — usos legítimos que describen un seguro REAL de un tercero, y que este criterio NO
    marca** *(sin esta lista el check produce falsos positivos y el siguiente QA lo ignora, que es como mueren
    los checks)*:
    1. La **etiqueta de envío del checkout** —«Envío (asegurado)» / «Shipping fee (insured)»— y el «con seguro»
       de §D: es la **paquetería**, otra fuente. *(Ojo: **sin confirmar**, ver **pregunta abierta 25**. Si el
       dueño responde que la guía no lo cubre, esa cadena **entra** a este criterio y sale de las exclusiones.)*
    2. Las **instrucciones de empaque del buylist** que piden al usuario **asegurar el paquete** que envía: es
       una **instrucción al usuario** sobre su propio envío, no una promesa de la plataforma.
    3. El **«retorno asegurado a México»** del desglose de **costo de gradeo** (§O.2.1): es **back-office /
       justificación de los escalones**, describe el envío de PSA y **no es copy de custodia**.
    4. El **copy legal del gancho de grading** (§O.5) y cualquier texto que **niegue** cobertura (p. ej. «no
       está asegurada»): **negar** no es afirmar.
    **(b) La regla que decide un caso dudoso**: si la frase le dice al cliente que **sus cartas en nuestra
    bóveda** están cubiertas por un seguro ⇒ **falla**. Si describe **el seguro de un tercero sobre un envío**
    ⇒ **pasa**.
    **(c)** Este criterio **no toca** la **responsabilidad por pérdida/daño en custodia** (reposición al precio
    de referencia con tope por carta, M10): esa obligación **existe y se sigue pudiendo afirmar** — lo que no
    se puede es **llamarla seguro**.
    **(d)** El criterio **se retira o se reescribe** el día que exista póliza contratada, y eso **reabre la
    decisión 63** (quién asegura, qué cubre, hasta qué monto) **antes** de volver a usar la palabra.
    **(e) ENMIENDA DEL 2026-09-01 tras la PRIMERA CORRIDA — por qué el patrón quedó así** *(QA reportó **5
    falsos positivos**: «Guía de envío **seguro**» ×3, «canal **seguro**», «¿**Seguro** que deseas eliminar…?»;
    ninguno afirma cobertura)*: se descartaron **las dos** salidas propuestas y se acotó el patrón.
    - **Por qué NO una exclusión (a)(5) para usos adjetivales**: obligaría a **adjudicar los mismos 5 hits a
      mano en cada pasada**. Este criterio dice en su propia (a) que eso **es como mueren los checks**; añadir
      una excepción interpretable sería aplicarse el defecto que denuncia.
    - **Por qué NO estrechar a `asegurad*` a secas** *(era la opción más barata, y es la que se rechaza con
      razón concreta)*: **dejaría ciega la comprobación al sustantivo `seguro`**, que es **la forma más natural
      de afirmar cobertura** —«tus cartas **tienen seguro**», «bóveda **con seguro** contra robo»— y que **este
      mismo documento usa en §D** («MX$175 por paquete (**con seguro**)»). También perdería **`aseguramos`**,
      que **no** casa con `asegurad*`. Un patrón que no atrapa la frase que el propio documento ya escribe no
      es un patrón, es un placebo.
    - **Lo que hace el patrón acotado**: elimina los **5** falsos positivos **mecánicamente, sin criterio
      humano** (ninguno lleva determinante/preposición delante ni «contra/de» detrás), y **no pierde ninguna
      forma que afirme cobertura**. **Cero adjudicación manual en corpus limpio** — si aparece un hit, es real.
    - **Si aun así aparece un caso ambiguo**, manda la regla **(b)**, y el caso **se anota aquí** en vez de
      resolverse en silencio en la corrida.
121. **NUEVO — Ninguna superficie promete VENDER DESDE LA BÓVEDA** *(2026-09-01, decisión 64)*: **esa capacidad
    no existe** —la bóveda no tiene acción de venta, **§E** está construido sobre que el vendedor **envía** la
    carta, y **«Consignación / marketplace C2C» está en Fuera de alcance**—, así que **prometerla es publicar
    algo falso**.
    **Verificación negativa**: **cero apariciones**, en `messages/` **ES y EN** y en cualquier superficie
    visible, de una promesa de **vender / monetizar / liquidar una carta que está en la bóveda sin sacarla**.
    El hit conocido es **`home.how.step3Body`** —«O las vendes desde la bóveda, sin moverlas» / «Or sell from
    the vault without moving a card»—; **retirarlo es trabajo de frontend ya instruido**, y este criterio es el
    que lo cierra.
    **(a)** Lo que **sí** se puede decir del paso 3 es lo que existe: la carta **se guarda** en la bóveda, se
    **retira** con envío, o se **vende a la plataforma por el flujo de buylist** —que **hoy exige enviarla**—.
    **(b)** Este criterio **no prejuzga** si la capacidad debe existir algún día: eso es la **pregunta abierta
    26**. **Se retira mientras no exista**; el día que exista, este criterio se retira con ella.

**Ciclo de adquisición del buylist — oferta, aceptación, guía y publicación (v2.1, §P)**

> **⚠️ AQUÍ REARRANCA LA NUMERACIÓN EN 113 — es el hilo §P, no una repetición del §O de arriba.**
> *(nota de fusión, 2026-09-05)* Los **113–177** de este bloque son los que citan `ARCHITECTURE.md`,
> `API_CONTRACT.md`, `DESIGN_SYSTEM.md`, `FRONTEND_NOTES.md` y las suites de tests del ciclo de buylist.
> **Se conservan intactos.** Los **113–121 del hilo §O** (arriba) también se conservan intactos.
> **En el rango 113–121 hay que decir de cuál se habla**: `criterio 118 (§P)` ≠ `criterio 118 (§O)`.
> De **122 en adelante** no hay ambigüedad: todos son de este bloque.

113. **El pipeline tiene las ocho fases y los estados nuevos** *(actualizado 2ª ronda; **corregido en la 5ª
    por D33** y **de nuevo en la 6ª por la resolución de la pregunta 27**)*: una solicitud recorre
    `cotizada → ofertada → aceptada → en_transito → recibida → verificación → aprobada → pagada`, y
    sus **estados terminales ~~son cuatro~~ ~~SON CINCO~~ SON CUATRO**: **`pagada`**, **`rechazada`**,
    **`expirada`** y **`abandonada`**. ~~y **`caducada`** *(nadie la ofertó en 7 días hábiles, D33)*~~
    **⚠ SUPERADO en la 6ª: la caducidad es `expirada` con motivo `no_offer`, no un quinto estado.**
    Verificable recorriendo el ciclo completo en el back-office y viendo el estado en cada paso, tanto en la
    vista del admin como en la del cliente. Verificable además que **los dos motivos de `expirada` se
    distinguen** —**motivo persistido en columna propia**, **visible en la cola de M5, en la ficha, en el
    portal del cliente y en los reportes de M9**, y **correos distintos**—, porque significan cosas opuestas:
    *«no vamos a ofertarte»* (`no_offer`) vs. *«aceptaste y no mandaste»* (`not_shipped`) — criterios 165 y
    **169**. Verificable **por lo que NO existe**: **no hay** un quinto estado terminal, y **el motivo no se
    infiere** de otros campos: **está guardado**.
114. **Nadie manda cartas sin un sí nuestro (regla dura)**: una solicitud **`cotizada`** u **`ofertada`**
    **no ofrece ninguna vía** —ni en el portal del cliente, ni en el back-office— para avisar «ya lo mandé»
    o marcarse en tránsito, y la pantalla del cliente **no muestra guía, instrucciones ni dirección de
    envío** hasta que la oferta está **aceptada**. Verificable: **no existe** ninguna secuencia de acciones
    que lleve una solicitud a **`en_transito`** sin haber pasado por **`ofertada` y `aceptada`**.
    *(**7ª ronda — precisión que evita un falso conflicto con D36**: lo que este criterio prohíbe mostrar es
    **la dirección de DESTINO y las instrucciones de envío**. La **dirección de ORIGEN del propio vendedor**
    **sí** existe desde la creación (criterio 170) — **es un dato que él dio**, no una instrucción para
    mandar cartas, y **no lo habilita a mandar nada**.)*
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
    D16/D19/D20; supersede D5; **5ª ronda, D31: aplica a TODA solicitud**)*: ~~en la banda con envío a
    nuestro costo~~ **en toda solicitud** —**la guía la ponemos siempre**—, **el portal del cliente NO tiene
    ningún campo para capturar paquetería ni número de rastreo**; el **operador** captura el número de la
    guía que compró a mano, **se la manda al vendedor**, y **al confirmar el envío** la solicitud pasa a
    **`en_transito`** — quedando registrado **quién lo hizo** (bitácora M10). El **número de guía es visible
    para las dos partes**.
123. **Plazo de envío: 3 días hábiles desde que la guía llega al vendedor, y expira con aviso (D4/D21)**: una
    solicitud **`aceptada`** cuyo paquete **no salió** en el plazo queda **`expirada`**, **se cancela** y
    **el vendedor recibe un correo** diciéndoselo. Verificable adelantando el plazo: el estado cambia solo y
    el correo sale; y verificable además que **el reloj arranca con la entrega de la guía**, no con la
    aceptación (una guía entregada **dos días después** de aceptar **corre el vencimiento dos días**).
    *(5ª ronda, **D31**: ese arranque es **el único que existe** — **no hay** ninguna solicitud cuyo plazo
    corra «desde la aceptación», porque **ya no hay banda donde el vendedor pague su envío**.)*
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
127. **Los diales del ciclo son editables y auditados (D8, ampliado 2ª ronda, completado en la 3ª,
    **corregido en la 4ª por D30**, **en la 5ª por D31/D33** y **en la 6ª por D34**)**: el súper-admin edita
    en **M10** los **NUEVE diales de §P.10** — plazo de aceptación (**2 días hábiles**), plazo de envío
    (**3 días hábiles**), **plazo de caducidad de la solicitud sin oferta (7 días hábiles — D33)**, mínimo de
    compra (**MX$500**), tope de oferta del operador (**MX$1,500**), tope de piezas por variante (**10**),
    tarifa de envío del buylist (**MX$180**), alerta de «ya lo mandé» sin confirmar (**5 días hábiles**) y
    **neto mínimo para EMITIR una oferta (MX$200 — NUEVO, D34)**.
    Cada cambio **surte efecto sin redeploy**, queda **auditado** (bitácora M10) y **aplica a
    solicitudes nuevas**. Verificable: **mover el mínimo de compra no mueve la tarifa de envío**, y **mover la
    tarifa del buylist (MX$180) no mueve la tarifa de envío de retiro (MX$175)** — son diales distintos.
    **Dos diales retirados, verificables por AUSENCIA**: **(a)** el **umbral de recorte material (20%, D28)**
    quedó **SIN OBJETO** en la 4ª ronda; **(b)** el **umbral de guía (MX$1,000, D18b)** queda **SIN OBJETO**
    en la 5ª (**D31**: la guía va **siempre**). Verificable porque **no existe** ninguno de los dos campos en
    M10 **ni ninguna conducta del sistema que dependa de ellos**. ~~**La cuenta se mantiene en OCHO** porque
    **salió el umbral de guía y entró el plazo de caducidad**.~~ **⚠ 6ª ronda: la cuenta sube a NUEVE** —
    entra el **neto mínimo para emitir** (D34) y **no sale ninguno**.
    **⚠ Dónde se evalúa cada dial, dicho aquí porque es lo que se implementa mal** *(6ª ronda)*: **ocho** de
    los nueve se evalúan en **barridos** o en **la propia pantalla de diales**; el **noveno —el neto mínimo
    para emitir— se evalúa en la EMISIÓN de la oferta** (criterio **167**). **M10 configura su número pero no
    lo valida contra nada**, porque **M10 no ve el recorte que hizo el operador**. Verificable: **no existe**
    en M10 ninguna validación cruzada que involucre al neto mínimo, **y sí existe** el bloqueo al emitir.
    **Validación entre diales — REFORMULADA en la 4ª, RE-ANCLADA en la 5ª** *(D30 → D31)*: ~~M10 rechaza una
    tarifa de envío mayor a `umbral de guía × (1 − umbral de recorte material)` (**MX$800**)~~; ~~M10 rechaza
    una tarifa **igual o mayor que el umbral de guía** (**MX$1,000**)~~ — **ambas fórmulas citan diales que
    dejaron de existir**. **Regla vigente: M10 rechaza guardar una `tarifa de envío del buylist` que sea
    IGUAL O MAYOR que el `mínimo de compra`.** Razón: el mínimo es **inclusivo** (criterio 158), así que **la
    solicitud más chica que aceptamos vale exactamente el mínimo**; si la tarifa lo igualara, **una operación
    con TODO aprobado depositaría MX$0** — una oferta que no paga nada aunque el vendedor cumpla perfecto.
    Verificable en M10 con **cuatro intentos** contra `mínimo = MX$500`: `tarifa = MX$180` ⇒ **guarda**;
    `tarifa = MX$499` ⇒ **guarda**; `tarifa = MX$500` (igual) ⇒ **NO guarda**; `tarifa = MX$600` (mayor) ⇒
    **NO guarda**, y el error dice **por qué**. La validación es **bloqueante**, no una advertencia, y aplica
    **en los dos sentidos** (bajar el **mínimo de compra** por debajo de la tarifa **también se rechaza**).
    *(**Colchón: ninguno.** **Pregunta 24 CERRADA en la 5ª ronda**: el humano aceptó a ojos abiertos que en el
    piso de MX$500 el envío pese **36%**.)*
    *(**⚠ Alcance de la garantía, dicho explícitamente**: esta validación protege la **solicitud completa**,
    **no** la **oferta recortada por cherry-pick** —el mínimo **no se re-aplica a la oferta**, criterio 158c—.
    Un bruto ofertado por debajo de MX$180 **sí** podía depositar MX$0 con todo aprobado; el vendedor **no
    queda debiendo** (criterio 152) y **ve el neto antes de aceptar** (criterio 163). ~~**Pregunta abierta
    25**.~~ **⚠ CERRADO en la 6ª ronda (D34)**: **ese hueco lo tapa el criterio 167**, no este. **Los dos
    conviven**: **127** = *«ninguna solicitud aceptable puede depositar cero si todo llega en NM»*;
    **167** = *«ninguna oferta se emite si su neto no llega a MX$200»*.)*
128. **Celular obligatorio en los tres puntos (D11)** *(⚠ **PRECISADO 2026-09-05**, a raíz de un hallazgo de
    QA: los tres incisos decían **dónde** se exige el celular pero no **a quién**, y esa ambigüedad se
    resolvió sola en la implementación. **Se precisa el sujeto; no se cambia el requisito.** Ver (f))*:
    **(a)** el **registro público con email/contraseña** **no se completa** sin celular. **El alta con Google
    NO se bloquea**: el **criterio 35** la ofrece como opción de primera clase y Google **no entrega
    teléfono**, así que esa cuenta **nace sin el dato a propósito** y la recoge el inciso **(c)**. *(Se dice
    explícito porque un «el registro no se completa» a secas **prohibiría el alta con Google**, que este
    documento sí quiere — «Usuarios y roles», comprador.)*
    **(b)** el **alta de usuario desde el back-office (M6)** **no se completa** sin celular **cuando la
    cuenta que se crea es de CLIENTE**. **Para cuentas de STAFF** —operador de bóveda, súper-admin— **el
    celular NO es obligatorio por D11**: D11 existe para **poder llamar al vendedor** (D12, criterio 129) y
    un miembro del staff **no vende, no aparece en la cola de buylist y no tiene CLABE, INE ni límites**.
    **M6 es el módulo del cliente** —ficha 360°, CLABE, INE, límites, bloquear, solicitudes de venta vivas—,
    así que **cliente es el sujeto que (b) siempre quiso nombrar**.
    **(c)** un usuario sin celular —incluido el que **entró con Google** y el que ya existía con el campo
    vacío— **no puede crear una solicitud de venta**: se le pide el dato **en ese momento** y, hasta
    capturarlo, la solicitud **no avanza**. Verificable con una cuenta de Google recién creada y con una
    cuenta preexistente sin teléfono.
    **(d) Cuál de los tres protege de verdad — se escribe para que nadie se equivoque al priorizar**: **el
    (c)**. Es el único que se evalúa **en el punto donde el dato hace falta**, y **cierra el conjunto**: **no
    existe camino a vender sin teléfono**, venga la cuenta de donde venga. **(a) y (b) son captura temprana,
    no la guarda**: hacen que el dato exista antes y quitan fricción después, pero **un hueco en (a) o en (b)
    NO abre un hueco de dinero**, porque (c) los recoge a todos. Incumplir (b) **sí es incumplir un criterio
    aceptado y hay que arreglarlo**, pero **no es agujero de dinero ni de seguridad**.
    **(e) Verificable, ahora que dice a quién**: crear desde M6 una cuenta de **cliente** sin celular
    **falla**; crear una de **staff** sin celular **procede**; y la de cliente creada **con** celular aparece
    con su teléfono en la **cola de buylist** (criterio 129).
    **(f) De dónde salió esta precisión, porque explica el incumplimiento**: QA reportó que el alta desde el
    back-office **se completa sin celular**, incumpliendo (b). La causa **no fue descuido**: el alta por admin
    es **una sola puerta para los tres roles** (`customer`, `vault_operator`, `super_admin`) y **nació antes
    que D11**; con un (b) que **no distinguía cliente de staff**, exigir el celular habría obligado a pedirle
    teléfono **también al staff**, que es algo que **nadie pidió y D11 no justifica**. Ante esa disyuntiva la
    implementación eligió **no exigirlo a nadie**. **La ambigüedad era de este documento y aquí queda
    cerrada**: **(b) obliga solo en la rama de cliente**. *(**El arreglo NO se hace aquí**: el contrato
    declara ese dato **opcional**, así que **PROJECT.md y el contrato se contradicen** y —regla de
    conflicto— **manda PROJECT.md**. La corrección **pasa primero por el arquitecto** (regla 9) y **es de
    otro work stream**; este criterio solo fija **qué tiene que valer**, no **cómo** se expresa en el
    contrato.)*
    **(g) Lo que este criterio NO decide, y no se asume**: si el celular debe pedirse al **staff** por alguna
    razón **distinta de D11** —contacto interno, 2FA, recuperación de cuenta— **es decisión del humano**, no
    de D11, y este documento **no la toma**. **Pregunta abierta 33.**
129. **Cotizaciones vivas y teléfono en la cola (D12)**: el back-office puede ver **qué usuarios tienen
    solicitudes de venta vivas** y **cuántas** tiene cada uno, y **el teléfono aparece en la propia cola de
    buylist** (sin abrir la ficha del usuario), de modo que el operador pueda **llamar**. **«Viva» = todo lo
    que NO es terminal**; los terminales son **`pagada`, `rechazada`, `abandonada`** y **`expirada`** —**con
    sus dos motivos**— *(actualizado 2ª ronda, respuesta a la pregunta 10; **la 5ª ronda (D33) había agregado
    un quinto; la 6ª lo retira: la caducidad es un MOTIVO de `expirada`, no un estado**)*. Verificable con dos
    usuarios con distinto número de solicitudes vivas: el conteo y el
    teléfono son correctos, y una solicitud en **cualquiera de los CUATRO estados terminales deja de contar**
    —incluida una que **caducó por no haberla ofertado** (`expirada` + `no_offer`)—.
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
    *(**⚠ NOTA DE LA 8ª RONDA — este criterio NO CAMBIA con D43, y se escribe porque ya hubo un intento de
    recortarlo por leer solo la mitad**: D43 saca del cotizador **los montos de ENVÍO**, no el **faltante
    del mínimo**. **Los dos frentes (a) y (b) siguen exigiéndose enteros**: (a) el cotizador **sigue
    diciendo cuánto falta, con la cifra** —*«te faltan $120»*—, y (b) el servidor **sigue rechazando** la
    solicitud que se salte el cotizador. **Un faltante del mínimo no es un monto de envío**: es una cifra
    sobre **las cartas del vendedor** y es **exacta**, no una estimación de nuestro servicio. Lo único que
    D43 prohíbe aquí es **expresar ese faltante en términos de envío** (*«te faltan $120 para cubrir el
    envío»*), que sería reintroducir la tarifa por la puerta de atrás **y además mentir sobre qué es el
    mínimo**. Ver criterio **174**.)*
133. ~~**Tres bandas de monto, con el envío en la banda correcta (D18b; bordes cerrados en la 3ª ronda)**: una
    solicitud de **MX$300** no se crea; una de **MX$700** se crea y **el vendedor paga su envío** (correo con
    un solo monto); una de **MX$1,500** se crea y **la guía la ponemos nosotros**. Bordes **$500 y $1,000,
    ambos inclusivos**.~~
    **⚠ SUPERSEDED por D31 (5ª ronda) — sustituido por el criterio 162. QA no verifica esta redacción**; se
    conserva como registro histórico. La banda intermedia **ya no existe**.
134. **El correo de oferta muestra los tres montos y dice cuál se deposita (D16)** *(⚠ **PRECISADO en la 4ª
    ronda por D30** — se señala la tensión en vez de dejarla latente; **AMPLIADO en la 5ª por D31**)*:
    ~~en la banda con envío a nuestro costo~~ **en TODA oferta, sin excepción** (D31), el correo contiene
    **bruto**, **envío** y **neto**, con **neto = bruto − envío** y una frase explícita de **cuál se
    deposita**. Verificable leyendo el correo: **con todas las cartas aprobadas**, la cifra anunciada como
    depósito **es exactamente** la que llega por SPEI — **no puede anunciar $1,480 y depositar $1,350**.
    Verificable además **por lo que NO existe** *(5ª ronda)*: **ningún** monto de oferta produce un correo con
    **un solo monto** — se prueba con una oferta de **MX$500** (la más chica posible), que **también** lleva
    los tres (**bruto 500 / envío 180 / neto 320**).
    **La tensión que abre D30, dicha en voz alta**: la oferta es **condicional a NM línea por línea**, así
    que **si se rechaza alguna carta el depósito SÍ es menor que el neto anunciado** (criterio 150). Eso **no
    contradice** este criterio, y la diferencia importa: **lo prohibido es que la cifra baje por decisión
    nuestra** —recalcular el envío, repreciar una línea, aplicar una comisión sorpresa (D2/D9/D25)—; **lo
    permitido, porque estaba escrito y aceptado, es que baje porque una carta no cumplió la condición**.
    Verificable con **dos casos**: **(a)** todo NM ⇒ **depósito idéntico** al anunciado; **(b)** una carta
    rechazada ⇒ el depósito baja **exactamente** el bruto de esa línea (**ni un peso más**), y el correo de
    oferta que él aceptó **ya decía** que esa línea estaba condicionada (criterio **161**).
135. **El envío NO entra al costo de la pieza (D16)** *(⚠ **CORREGIDO en la 5ª ronda** — la redacción
    anterior contradecía a **D19**, que no permitía conocer el costo real de la etiqueta)*: el **costo de
    inventario** de la carta comprada es el **BRUTO ofertado** de su línea, y el costo de la guía se registra
    como **gasto operativo**, no como costo de la pieza. Verificable en **M7**: dos piezas idénticas compradas
    por el mismo bruto **tienen exactamente el mismo costo** y el **mismo margen por carta**, sin importar en
    qué paquete llegaron; el envío aparece **como gasto del periodo**, en su propia línea.
    **Con qué cifra se registra ese gasto** *(5ª ronda, decisión del humano; **cierra la contradicción
    criterio 135 × D19**)*: **con el costo REAL de la etiqueta cuando el operador lo capturó** —**captura
    opcional** al confirmar el envío— **y con la tarifa congelada de MX$180 cuando no lo capturó**
    (*fallback*). Verificable con **tres solicitudes**: **(a)** costo real capturado **MX$260** ⇒ el gasto del
    periodo es **MX$260**; **(b)** costo real capturado **MX$120** ⇒ el gasto es **MX$120**; **(c)** sin
    captura ⇒ el gasto es **MX$180**. Verificable en las tres que **el neto pagado al vendedor es idéntico**
    (se descuenta **siempre la tarifa congelada**, criterio 149) y que **el costo de la pieza no se mueve** en
    ningún caso. ~~«una llegada en un paquete con envío caro y otra **sin envío nuestro**»~~ — **ese contraste
    ya no es construible (D31): el envío es nuestro en todas.**
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
142. **Recordatorio: uno, a un día hábil, una sola vez (D23)** *(**corregido en la 5ª ronda por D33**)*: a
    **un día hábil** de vencer sale **un** correo de recordatorio; **corriendo el barrido varias veces NO se
    manda otro**. Verificable ejecutando el barrido tres veces dentro de la ventana: **un solo correo**.
    ~~Los correos obligatorios del ciclo son **tres**: oferta, recordatorio y expiración/cancelación.~~
    ~~**⚠ CORREGIDO: son CUATRO** — **oferta**, **recordatorio**, **expiración/cancelación** y **«no
    procederemos» por caducidad** (D33, criterio 165).~~ **⚠ CORREGIDO OTRA VEZ EN LA 8ª RONDA: son CINCO**
    — **oferta**, **recordatorio**, **expiración**, **«no procederemos»** y **«cancelamos la oferta»**; la
    **cancelación sale de dentro del correo de expiración**, donde afirmaba un hecho falso. **El conteo y su
    verificación viven ahora en el criterio 173**, que es su origen único. Verificable además que el
    **recordatorio existe solo
    para los DOS plazos del vendedor** (aceptar y enviar) y que **el plazo de caducidad NO genera
    recordatorio** al cliente, porque **corre contra nosotros**, no contra él.
    *(**⚠ 6ª ronda — verificable explícitamente, porque el modelado nuevo lo pone en riesgo**: los dos
    últimos correos **comparten el estado `expirada`** y aun así **son distintos**. **El correo se elige por
    el MOTIVO**, no por el estado: `not_shipped` ⇒ expiración; `no_offer` ⇒ «no procederemos». Verificable
    con dos solicitudes ambas `expirada`: **llegan correos diferentes** y **ninguno recibe el del otro**.)*
    *(**⚠ 7ª ronda, D39 — «declinar ahora» NO agrega un correo nuevo**: ~~los obligatorios **siguen siendo
    CUATRO**~~ *(el conteo se corrigió a **CINCO** en la 8ª por otra razón, ajena a D39)*. Declinar dispara
    **el mismo correo de «no procederemos»** que el barrido, porque **es el mismo hecho**; el motivo
    coincide (`no_offer`) y el texto también. Verificable: **no existe** ninguna plantilla
    de correo específica de «declinado por el operador». **Esta parte de D39 no cambió.**)*
    *(**⚠ 8ª ronda — el discriminador se AMPLÍA: el correo se elige por el PRODUCTOR, no por el motivo**. La
    corrección de la 6ª ronda («por el motivo, no por el estado») **se queda corta**: el motivo **queda
    vacío en dos de los tres desenlaces** que el viejo correo 3 agrupaba —«no respondió» deja `rechazada` y
    la **cancelación** deja `cotizada`—, así que elegir por motivo **manda el mismo correo al que no cumplió
    y al que no hizo nada**. Verificable en el criterio **173**.)*
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
145. **Terminal es terminal: ni se re-oferta ni se edita (respuestas a las preguntas 2 y 3; **ampliado en la
    5ª ronda por D33**, **corregido en la 6ª**)**: sobre una solicitud **`rechazada`**, **`expirada`**
    —**por cualquiera de sus dos motivos**— o **`abandonada`** **no existe** ninguna acción de «re-ofertar»;
    y sobre una oferta **ya enviada** **no
    existe** ninguna acción de «editar». La única vía es **cancelar y emitir una oferta nueva** (correo nuevo,
    **plazo de aceptación** desde cero, **auditado** — ~~*el reloj de caducidad **NO** se reinicia, criterio
    169*~~ **⚠ CORREGIDO en la 7ª ronda (D38): el reloj de caducidad SÍ se reinicia, con 7 días hábiles
    completos; criterio 172**). Verificable: ambas acciones no existen en la UI **y** son rechazadas si
    se intentan directo contra el servidor. Verificable además el caso que abre D33: una oferta que estaba
    **pendiente de autorización** cuando la solicitud **caducó** **es anulada por el barrido**, **sale de la
    cola** y **ya no puede autorizarse** (criterio 165). *(7ª ronda: **lo mismo aplica si la solicitud se
    cerró con «declinar ahora»** — mismo estado terminal, mismas consecuencias; criterio 171.)*
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
149. **Tarifa de envío del buylist = MX$180, congelada al ofertar (D25)** *(**ampliado en la 5ª ronda**)*:
    ~~en la banda con envío a nuestro costo~~ **en toda oferta** (D31), el correo anuncia **MX$180** de envío
    y **esa misma cifra** es la que se descuenta al pagar. Verificable en tres frentes: **(a)** si la etiqueta
    real costó **MX$260**, el vendedor **sigue recibiendo el mismo neto** y la diferencia queda como **gasto
    nuestro**; **(b)** si costó **MX$120**, el neto **tampoco cambia** y la diferencia es **margen nuestro**;
    **(c)** **cambiar el dial en M10 después de enviar la oferta NO cambia** el descuento de esa oferta (va
    congelado). Verificable además que **MX$180 (buylist) y MX$175 (retiro) son diales distintos**: mover uno
    **no** mueve el otro.
    *(5ª ronda — **el costo real ahora sí se puede registrar**, y eso **no toca esta regla**)*: los casos
    **(a)** y **(b)** dejan de ser hipotéticos porque el operador **puede capturar el costo real** al
    confirmar el envío (criterio 166). Verificable que **capturarlo NO mueve el neto del vendedor ni un peso**
    — solo cambia **la cifra del gasto en M7** (criterio 135).
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
    *(**6ª ronda — este criterio NO se toca, y conviene decir por qué junto al 167**: **D34 gobierna qué se
    EMITE** —neto **ofertado** ≥ **MX$200**, criterio 167— y **el 152 gobierna cuánto se PAGA** —neto
    **aprobado**, con piso de cero—. **Son dos momentos y dos cifras**: una oferta legítima de neto **MX$820**
    puede terminar depositando **MX$0** si casi nada llega en NM, y **eso sigue siendo correcto**. **Ninguno
    de los dos anula al otro.**)*
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
    *(5ª ronda, **D32** — el caso (c) ya no tiene rama sin techo)*: como **el objetivo del bounty es
    obligatorio** (criterio 164), **no existe** ninguna carta con **bounty vivo y sin objetivo**, así que la
    rama (c) **siempre** tiene un número contra el cual medir la posición. Verificable **por lo que no se
    puede construir**: **no hay forma de dejar una variante sin ningún techo de sugerencia**.
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
158. **El borde del mínimo es inclusivo y el mínimo no se re-aplica (respuesta a la pregunta 19;
    **corregido en la 5ª ronda por D31**)**:
    **(a)** una solicitud de **exactamente MX$500 SÍ se crea** —**y SÍ lleva guía a nuestro costo**—;
    ~~**(b)** una oferta de **exactamente MX$1,000 SÍ lleva guía a nuestro costo**~~ **⚠ SIN OBJETO (D31):
    no hay segundo borde — la guía va SIEMPRE desde el mínimo**;
    **(c)** el **mínimo de compra no se re-aplica a la oferta** —**gatea la creación de la solicitud, no la
    oferta**—: si se cotizaron **MX$3,000** y tras el cherry-pick el **bruto ofertado** queda en **MX$600**,
    **la oferta sale igual** y **no hay bloqueo por ese motivo**; el correo anuncia **bruto MX$600 / envío
    MX$180 / neto MX$420**.
    ~~si se cotizaron **MX$600** y tras el cherry-pick el bruto queda en **MX$200**, la oferta sale igual…
    el correo anuncia **bruto MX$200 / envío MX$180 / neto MX$20**.~~ **⚠ EJEMPLO SUPERADO en la 6ª ronda
    (D34)**: ese caso **ya no se emite** —**neto MX$20 < piso MX$200**—. **La regla (c) NO cambió**: lo que
    cambió es que **ahora hay OTRO umbral, en OTRO momento** (criterio **167**). El mínimo sigue sin
    re-aplicarse; lo que gatea la emisión es el **neto mínimo**, que es **otro número y otra pregunta**.
    ~~*(⚠ **Consecuencia señalada, no resuelta en silencio (5ª ronda)**: con (c) llevado al extremo —bruto
    ofertado **por debajo de MX$180**— el **neto es MX$0 con todo aprobado**… Un **piso de neto para emitir
    la oferta** **no existe hoy** y sería **alcance nuevo** — **pregunta abierta 25**.)*~~
    **⚠ CERRADO en la 6ª ronda (D34): el piso de neto SÍ existe y es MX$200** (criterio 167). **Pregunta 25
    CERRADA.** Lo que sigue siendo cierto de la nota vieja: **no hay deuda del vendedor** (criterio 152) y
    **él ve el neto antes de aceptar** (criterio 163) — esas dos protecciones **no dependían del piso** y
    **siguen intactas**.
    *(**7ª ronda — o.17, corrección enrutada por el arquitecto, cerrada aquí**: la **regla de (c) NO cambia y
    sigue vigente** —el **mínimo de compra no se re-aplica a la oferta**—; **lo único superado era el
    EJEMPLO**, que citaba **bruto MX$200 ⇒ neto MX$20 ⇒ «la oferta sale igual»**, un caso que **hoy se
    bloquea** por el piso de D34. **El ejemplo vivo de (c) es el de MX$3,000 ⇒ MX$600 ⇒ neto MX$420**, que
    **sí se emite**. Se revisaron y corrigieron además **las notas derivadas** que seguían leyéndose como
    vigentes en **§P.5.1** y **§P.12**. **Verificable de aquí en adelante**: **ningún ejemplo del documento
    presenta un neto de MX$20 o de MX$0 como oferta emitible**.)*
159. **Recordatorio: uno POR PLAZO DEL VENDEDOR, cada uno una sola vez (respuesta a la pregunta 21;
    **precisado en la 5ª ronda por D33**: el **plazo de caducidad NO lleva recordatorio**, porque corre contra
    nosotros)**: hay **dos plazos del vendedor**
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

**Ciclo de adquisición del buylist — 5ª ronda (CORRECTIVA): una sola banda, el bounty con meta y la
solicitud que caduca (v2.1, D31–D33; §E/§H/§N.6/§P.1/§P.2/§P.3/§P.3.1/§P.4/§P.10/§P.12)**
> **⚠ Corregidos en la 5ª ronda**: el criterio **133** quedó **SUPERSEDED** (lo sustituye el **162**); el
> **127** cambió de referente (`tarifa < mínimo`); el **16**, **113**, **122**, **123**, **129**, **134**,
> **135**, **142**, **145**, **149**, **153** y **158** se actualizaron. **El 152 no se toca** (el neto sigue
> sin poder ser negativo) y **el 150/151/161 de la 4ª ronda siguen vigentes tal cual**.
162. **UNA SOLA BANDA: desde MX$500 compramos, ponemos la guía SIEMPRE y SIEMPRE se descuenta (D31 — sustituye
    al criterio 133)**: una solicitud de **MX$300** **no se crea** y el cotizador dice **cuánto falta**; **de
    MX$500 en adelante** la solicitud se crea, **la guía la ponemos nosotros** y el correo de oferta lleva
    **bruto / envío MX$180 / neto**. Verificable con **cuatro montos**: **MX$300** (no se crea), **MX$500**
    (se crea y lleva guía nuestra — **borde inclusivo**, neto **MX$320**), **MX$700** (neto **MX$520**) y
    **MX$1,500** (neto **MX$1,320**). Verificable **por lo que NO existe**: **(a)** **ningún** monto produce
    un correo de oferta con **un solo monto** ni con el aviso de *«el envío corre por tu cuenta»*; **(b)**
    **no existe** el dial **«umbral de guía»** en M10 (criterio 127) ni ninguna conducta que dependa de él;
    **(c)** **no existe** ninguna solicitud cuyo plazo de envío corra **«desde la aceptación»** en vez de
    **desde la entrega de la guía** (criterio 123).
163. **El descuento del envío se dice EN TODOS LADOS y ANTES de aceptar (D31 — requisito de comunicación
    explícito del humano)**: el **cotizador**, el **correo de oferta** y los **términos** dicen que **el envío
    lo ponemos nosotros y que su costo SIEMPRE se deduce del importe a pagar**. Verificable en las **tres
    superficies** y en el caso que más duele: en una oferta de **MX$500**, el vendedor **ve MX$320 como
    depósito, y la frase de que el envío se deduce, ANTES de apretar «aceptar»** — no en un correo posterior
    ni en un pie de página en letra chica. Verificable además que **la pantalla de aceptación muestra la
    misma información que el correo** (coherente con el criterio 161d) y que **la cifra anunciada es el
    NETO**, no el bruto (criterio 134).
    *(**⚠ ACOTADO en la 8ª ronda por D43 — este criterio NO se retira, se precisa qué se verifica en cada
    superficie**: lo que se verifica en **las tres** es **la FRASE** («el envío lo ponemos nosotros y
    siempre se deduce»). **Las CIFRAS —MX$180, MX$320, la resta— se verifican SOLO en la oferta** (correo y
    pantalla de aceptación); **en el cotizador se verifica su AUSENCIA** (criterio 174a). **El punto que más
    duele sigue intacto**: el vendedor ve **MX$320 antes de apretar «aceptar»**.)*
164. **El objetivo del bounty es OBLIGATORIO (D32)**: **no se puede guardar un bounty sin capturar su
    objetivo** (`bountyTargetQty`, §N.6). Verificable: **(a)** intentar crear un bounty **sin objetivo** ⇒
    **no se guarda** y el error dice por qué; **(b)** con el objetivo capturado, la mesa de decisión pinta
    **«no comprar»** al **alcanzar ese objetivo** (criterio 153c); **(c)** **no existe** ninguna variante con
    **bounty vivo y sin objetivo**, así que **ninguna carta queda sin techo de sugerencia**. Verificable
    también **lo que NO se construye**: **no hay panel de bounties** —el humano lo dejó como **proyecto
    aparte**—; el objetivo se exige **donde hoy se configuran los bounties**, sin pantalla nueva.
    ~~*(**SUPUESTO** — bounties **preexistentes** sin objetivo: se les exige el dato **al editarlos** y,
    mientras no lo tengan, la mesa los trata como **«sin bounty» para la sugerencia** (aplica el tope de 10);
    **el precio no cambia**. Ver **pregunta abierta 26**.)*~~ **⚠ SUPUESTO SUPERADO por D35 (6ª ronda)** —
    ver criterio **168**: **hay default (2)** y **los viejos se llenan con 2**, así que **ningún bounty se
    comporta como «sin bounty»** y **ninguno queda esperando a que alguien lo edite**.
165. **La solicitud que nadie oferta CADUCA a los 7 días hábiles, con un correo que dice que NO PROCEDEREMOS
    (D33; **corregido en la 6ª ronda**)**: una solicitud **`cotizada`** que **nadie ofertó** en **7 días
    hábiles** desde su creación queda **`expirada` con motivo `no_offer`** ~~`caducada`~~ (terminal) y **le
    llega un correo** que dice **explícitamente que no vamos a proceder con
    la oferta** e **invita a volver a cotizar cuando quiera**. Verificable en seis puntos:
    **(a)** adelantando el reloj: al día 6 hábil **sigue viva**, al día 7 hábil **caduca y sale el correo**;
    **(b)** el correo **no dice** *«no pudimos procesar tu solicitud»* ni deja la puerta a medio abrir: dice
    **que no procederemos**;
    **(c)** **el motivo `no_offer` se distingue del motivo `not_shipped`** —correos distintos y **motivo
    visible** en la cola, la ficha, el portal del cliente y los reportes— porque
    significan cosas opuestas (*«no vamos a ofertarte»* vs. *«aceptaste y no mandaste»*); ver criterio **169**;
    **(d)** **no llega ningún recordatorio** por este plazo (corre contra nosotros, no contra el vendedor);
    **(e)** el plazo es **dial de M10**, se cuenta en **días hábiles** (criterio 154), **se congela por
    solicitud** (criterio 157) y **queda auditado** (criterio 127);
    **(f)** **ofertar sobre una solicitud que caducó no funciona**, y una **oferta que estaba pendiente de
    autorización** cuando caducó **es ANULADA por el barrido**, sale de la cola y **ya no puede autorizarse**
    (criterio 145).
    *(**7ª ronda — dos correcciones que NO cambian este desenlace, solo cuándo y desde cuándo se llega a
    él**: **(1) D39** — al mismo estado terminal y al mismo correo **se llega también apretando «declinar
    ahora»**, sin esperar el plazo (criterio **171**); el punto **(a)** —el barrido a los 7 días hábiles—
    **sigue siendo verificable tal cual** para las solicitudes que nadie tocó. **(2) D38** — **el reloj SÍ se
    reinicia** si se cancela una oferta emitida, así que el conteo de **(a)** se verifica **sobre una
    solicitud sin cancelaciones** (criterio **172**).)*
    ~~*(**SUPUESTOS** señalados: el **nombre** `caducada` y el hecho de modelarla como estado propio…; que
    una solicitud **caduque aunque tenga una oferta esperando autorización**…; y que, si una oferta emitida
    se **cancela**, **el reloj arranque de nuevo desde la cancelación**. Ver **pregunta abierta 27**.)*~~
    **⚠ Los tres supuestos quedaron RESUELTOS en la 6ª ronda por el arquitecto (pregunta 27 CERRADA)**:
    **(1)** ~~estado propio~~ ⇒ **`expirada` + motivo en columna propia**; **(2)** caduca aunque haya oferta
    esperando autorización ⇒ **CONFIRMADO**, y **el barrido la anula**; **(3)** ~~el reloj reinicia desde la
    cancelación ⇒ **CORREGIDO: NO reinicia, cuenta desde la creación**~~ **⚠ REVERTIDO en la 7ª ronda por el
    humano (D38): el reloj SÍ se reinicia con 7 días hábiles COMPLETOS — el supuesto original de este
    documento resultó ser el vigente; criterio 172**. Ver criterios **169** y **172**.
166. **El costo real de la etiqueta: captura OPCIONAL, con fallback a la tarifa congelada (5ª ronda; cierra
    la contradicción criterio 135 × D19)**: al **confirmar el envío**, el operador **puede** capturar cuánto
    costó de verdad la etiqueta. Verificable en cuatro puntos:
    **(a)** **confirmar el envío SIN capturarlo se permite** —no es un campo obligatorio y **no bloquea** el
    flujo—, y el gasto del periodo se registra con la **tarifa congelada de MX$180**;
    **(b)** capturado **MX$260**, el **gasto en M7 es MX$260**; capturado **MX$120**, el gasto es **MX$120**
    (criterio 135);
    **(c)** en **los tres casos** el **neto pagado al vendedor es idéntico** —se descuenta **siempre la
    tarifa congelada**, criterio 149— y **el costo de la pieza no se mueve** (sigue siendo el **bruto
    ofertado**);
    **(d)** esto **no es integración con paquetería** (D19 intacta): **no hay** cotización de tarifas, ni
    compra automática, ni validación del número contra el transportista — **es un campo que el operador
    escribe**.

**Ciclo de adquisición del buylist — 6ª ronda (CORRECTIVA FINAL): piso de neto para emitir, bounty con meta
2 y la caducidad como motivo (v2.1, D34–D35 + resolución de la pregunta 27; §N.6/§P.1/§P.2/§P.3/§P.3.1/
§P.5.1/§P.9/§P.10/§P.11/§P.12)**
> **⚠ Corregidos en la 6ª ronda**: el **127** sube a **NUEVE diales** y aclara **dónde se evalúa cada uno**;
> el **16**, **113**, **129**, **145**, **158** y **165** dejan de hablar de `caducada` como estado; el
> **164** pierde su supuesto de bounties viejos. **El 152 NO se toca** (el piso de cero al pagar sigue
> intacto) y **el 162/163 de la 5ª ronda siguen vigentes tal cual**.
167. **PISO DE NETO: no se emite una oferta cuyo neto quede por debajo de MX$200 (D34 — cierra la pregunta
    25)**: al emitir, si el **neto** (`bruto ofertado − tarifa de envío congelada`) **no llega a MX$200**, la
    oferta **no se emite** y **el correo no se manda**. Verificable en siete puntos:
    **(a)** **los tres bordes**, con piso **MX$200** y tarifa **MX$180**: bruto **MX$379** (neto **MX$199**)
    ⇒ **no se emite**; bruto **MX$380** (neto **MX$200**) ⇒ **se emite** —**el piso es INCLUSIVO**—; bruto
    **MX$381** (neto **MX$201**) ⇒ **se emite**. *(**7ª ronda, D40 — CONFIRMADO por el humano, sin cambio**:
    un neto de **exactamente MX$200 SÍ se puede emitir**. La condición de bloqueo es **`neto < 200`**, **no**
    `neto ≤ 200`. Este criterio ya estaba bien redactado; la confirmación **solo elimina la ambigüedad** en
    §P.2, §P.3, §P.10 y §P.12, donde se decía «por debajo del piso» sin fijar el borde.)*;
    **(b)** **el correo NO se manda** en el caso bloqueado — verificable en la bandeja del vendedor, no solo
    en la pantalla del operador: **no existe** ningún correo de oferta que anuncie un depósito de **MX$0**
    ni de **MX$20**;
    **(c)** **el mensaje de rechazo dice por qué y cuánto falta** —bruto actual, envío, neto y la
    diferencia—, igual que el cotizador le dice al vendedor cuánto le falta para el mínimo (criterio 158);
    **(d)** **el bloqueo vive en la EMISIÓN**: **no** es una validación de M10 (criterio 127) **ni** de la
    aceptación. Verificable: la pantalla de diales **guarda MX$200 sin validarlo contra nada**, y **el
    bloqueo aparece al emitir**;
    **(e)** **no se puede saltar**: se rechaza también **directo contra el servidor**, y también cuando el
    neto baja del piso **por un override manual** (D26);
    **(f)** **es un dial** (§P.10, el noveno): editable en M10 sin redeploy, **auditado** y **congelado por
    solicitud**. Bajarlo a **MX$0** hace que **el bloqueo se comporte como el `neto ≤ 0` que ya existía** —
    **D34 es ese mismo bloqueo con número**, no uno nuevo;
    **(g)** **el cherry-pick sobre lotes grandes sigue siendo posible**: una solicitud cotizada en
    **MX$3,000** recortada a un bruto de **MX$600** (neto **MX$420**) **se emite sin fricción**. El piso
    **no** es «el mínimo de compra otra vez» (criterio 158c sigue vigente: el mínimo **no** se re-aplica).
    **Verificable que NO rompe el criterio 152**: una oferta emitida legítimamente (bruto **MX$1,000**, neto
    **MX$820**) de la que solo se aprueben **MX$100** al verificar **sigue depositando MX$0 sin deuda**.
    **D34 gobierna qué se EMITE; el 152 gobierna cuánto se PAGA. Conviven y ninguno anula al otro.**
168. **El objetivo del bounty tiene default 2, y los bounties viejos se llenan con 2 (D35 — cierra la
    pregunta 26)**: Verificable en cinco puntos:
    **(a)** al **dar de alta** un bounty, el campo de objetivo llega **prellenado con 2** («hasta tener 2 en
    inventario»); **sigue siendo obligatorio** (criterio 164): **borrarlo y guardar ⇒ no se guarda**;
    **(b)** **es editable**: guardar un bounty con objetivo **1** o **20** **funciona** — **2 es el default,
    no un tope rígido**;
    **(c)** los **bounties preexistentes sin objetivo** quedan con **objetivo 2**, y **siguen vivos**:
    **no se desactivan**, **no salen de la vitrina** (Home ni Vender) y **su precio no cambia**;
    **(d)** verificable **por lo que NO existe**: **ningún** bounty vivo sin objetivo, y **ningún** bounty
    tratado como «sin bounty» por la mesa de decisión — la rama (a) de la precedencia de §P.2 **siempre
    tiene número contra el cual medir la posición**, también para los viejos;
    **(e)** **no se construye panel de bounties** (criterio 164): el default y el llenado ocurren **donde hoy
    se configuran los bounties**, **sin pantalla nueva**. *(El **2 no es un dial de M10**: es el valor
    inicial de un campo editable por bounty.)*
169. **La caducidad es un MOTIVO de `expirada`, no un quinto estado — y los dos desenlaces se distinguen
    igual (resolución de la pregunta 27 por el arquitecto)**: los **estados terminales son CUATRO**
    (`pagada`, `rechazada`, `expirada`, `abandonada`) y **`expirada` lleva un motivo persistido en columna
    propia**: **`no_offer`** (nadie ofertó, D33) o **`not_shipped`** (aceptó y no mandó, D4). Verificable en
    cinco puntos:
    **(a)** **no existe** un quinto estado terminal en el modelo ni en ninguna pantalla;
    **(b)** **el motivo está guardado, no inferido**: dos solicitudes ambas `expirada` con motivos distintos
    **se distinguen sin mirar ningún otro campo**;
    **(c)** **los correos son distintos** —*«no procederemos con la oferta»* vs. *«aceptaste y no mandaste»*—
    y **cada uno sale con su motivo**, nunca cruzados;
    **(d)** **los reportes (M9) separan las dos causas**: se puede medir *«se nos fue el tiempo»* aparte de
    *«el vendedor no cumplió»* — que es la métrica que el negocio quiere vigilar; y las superficies que
    muestran el desenlace (**cola de M5, ficha de solicitud, portal del cliente**) **muestran el motivo**;
    **(e)** **ambas se comportan idéntico en todo lo demás**: cierre, **purga del INE**, **cuota/acumulados**
    y **«no se revive»** — que es exactamente la razón por la que no son dos estados.
    **Los dos bordes del plazo, verificables**: **(1)** una solicitud con **oferta esperando autorización**
    **caduca igual**, y **el barrido ANULA esa oferta** —después **no se puede autorizar** (criterio 145)—
    **[SIGUE VIGENTE]**;
    ~~**(2)** **el reloj de caducidad NO se reinicia** al cancelar una oferta emitida: **cuenta desde la
    creación de la solicitud**. Verificable en el caso incómodo: si al cancelar ya pasaron los **7 días
    hábiles** desde la creación, la solicitud **caduca ese mismo día**.
    *(⚠ Ese último comportamiento está **decidido y es el vigente**, pero **tiene un costo para el cliente** y
    queda registrado como **bandera** en «Riesgos y banderas» — **corrige** el supuesto contrario que este
    documento había redactado.)*~~
    **⚠ EL BORDE (2) QUEDA SUPERADO EN LA 7ª RONDA (D38): el reloj SÍ se reinicia.** El humano **le dio la
    razón a la bandera**. Lo que se verifica ahora está en el criterio **172**. **El resto de este criterio
    —los cinco puntos y el borde (1)— NO se toca**: la caducidad **sigue siendo un motivo de `expirada`**, no
    un quinto estado. *(7ª ronda, D39: al mismo estado y motivo se llega también por **«declinar ahora»**;
    el punto **(b)** —motivo guardado, no inferido— **cubre los dos caminos**, criterio 171.)*

**Ciclo de adquisición del buylist — 7ª ronda (CORRECTIVA FINAL): la DIRECCIÓN que faltaba, el reloj que sí
reinicia y el «no» que no hace esperar (v2.1, D36–D40 + o.17; §E/§H/§P.1/§P.2/§P.2.1/§P.3/§P.3.1/§P.4/
§P.5.1/§P.10/§P.11/§P.12/M5)**
> **⚠ Corregidos en la 7ª ronda**: el **16(d)**, el **145** y el **169(2)** dejan de decir que el reloj de
> caducidad no se reinicia; el **165** gana el camino de «declinar ahora»; el **158** cierra formalmente la
> corrección **o.17** del ejemplo numérico; el **167** fija el borde **inclusivo** sin cambiar la regla.
> **NO se tocan**: el **152** (piso de cero al pagar), el **150/151/161** (rechazo parcial y condición NM),
> el **162/163** (una sola banda y el descuento anunciado) ni el **168** (bounty con meta 2).
170. **La DIRECCIÓN del vendedor se pide AL CREAR la solicitud, reusando su libreta, y sin ella no hay
    solicitud (D36/D37 — 7ª ronda; cierra un hueco BLOQUEANTE)**: **no se puede crear una solicitud de venta
    sin una dirección de origen**. Verificable en siete puntos:
    **(a)** un usuario **sin ninguna dirección guardada** **no puede crear la solicitud** —el flujo se
    detiene y le pide capturarla— **ni siquiera saltándose el cotizador**: se valida **en el servidor**,
    igual que el mínimo (criterio 158) y el celular (criterio 128);
    **(b)** capturada, la dirección **queda en su libreta** — la **misma** que usa para **recibir compras**:
    verificable porque **aparece disponible en su siguiente checkout**, sin volver a capturarla;
    **(c)** un usuario **que ya tiene direcciones guardadas** **no captura nada**: **elige o confirma** una,
    y con **varias guardadas** puede **elegir cuál usa**;
    **(d)** **se pide AL CREAR, no al aceptar**: verificable en la pantalla de aceptación de la oferta, que
    **no** contiene ninguna captura de domicilio;
    **(e)** al **comprar la etiqueta** (§P.4), el operador **usa la dirección que ya está en la ficha de la
    solicitud** y **no se la pide a nadie**;
    **(f)** verificable **por lo que NO existe**: **ningún** modelo, libreta, pantalla ni campo de
    **«domicilio de remitente»** separado del de compras (D37);
    **(g)** aplican las reglas de dirección ya vigentes: **solo México** (criterio 31) — una dirección
    extranjera **no sirve para vender**, igual que no sirve para recibir.
    **Por qué es criterio propio y no un detalle**: **sin este dato, el requisito D16/D31 —«la guía la
    ponemos nosotros, siempre»— no se puede ejecutar**. Una etiqueta **no se compra sin domicilio de
    origen**.
171. **«DECLINAR AHORA»: el mismo desenlace, sin la espera (D39 — 7ª ronda)**: sobre una solicitud
    **`cotizada`**, el operador puede **cerrarla de inmediato**. Verificable en seis puntos:
    **(a)** la solicitud queda **`expirada` con motivo `no_offer`** — **el mismo estado y el mismo motivo**
    que produce el barrido (criterio 169), **sin estado nuevo ni motivo nuevo**;
    **(b)** sale **exactamente el mismo correo** de *«no procederemos con la oferta»*, con su **invitación a
    volver a cotizar** — **no es una variante ni un correo nuevo**: ~~los correos obligatorios del ciclo
    **siguen siendo CUATRO**~~ **declinar NO suma ningún correo** *(8ª ronda: el total del ciclo es **CINCO**
    por una razón ajena a D39 — criterios 142 y **173**)*;
    **(c)** el cliente lo recibe **el mismo día**, **sin esperar los 7 días hábiles**;
    **(d)** **terminal es terminal**: después **no se puede ofertar** (criterio 145), y si había una oferta
    **esperando autorización**, **se anula igual** que al caducar;
    **(e)** **queda auditado quién declinó** (M10), y en la bitácora y los reportes **se distingue un cierre
    por persona de un cierre por barrido** — **sin que esa distinción llegue al cliente**, para quien **es la
    misma respuesta**;
    **(f)** **el barrido sigue existiendo** y **sigue cerrando** las solicitudes que nadie tocó a los 7 días
    hábiles (criterio 165a): «declinar ahora» **no lo sustituye**.
172. **El reloj de caducidad SÍ se reinicia al cancelar una oferta emitida (D38 — 7ª ronda; ⚠ CORRIGE el
    criterio 169(2))**: cancelar una oferta **devuelve la solicitud a la fila con los 7 días hábiles
    COMPLETOS**. Verificable en cinco puntos:
    **(a)** **el caso que motivó la corrección**: se emite una oferta, se **cancela al día 8 hábil** y la
    solicitud vuelve a la fila ⇒ **NO caduca ese día**; el cliente **no recibe ningún «no procederemos»**, y
    la solicitud sigue viva con **7 días hábiles nuevos** contados **desde la cancelación**;
    **(b)** **el caso normal no cambió**: **sin ninguna cancelación**, el plazo se cuenta **desde la creación
    de la solicitud** (criterio 165a);
    **(c)** **el reinicio lo dispara una acción nuestra**, no el tiempo: **solo** la **cancelación de una
    oferta ya emitida** lo reinicia — **no** lo reinicia mirar la solicitud, ni prepararla, ni dejarla en la
    cola de autorización *(**⚠ 8ª ronda — se verifica JUNTO con el correo, porque es el mismo hecho**:
    cancelar una oferta **enviada** ⇒ **reinicia el reloj Y sale el correo 5**; cancelar una **pendiente de
    autorización** ⇒ **ni reloj ni correo**. **No existe el reinicio silencioso** — criterio 173c)*;
    **(d)** **se reinician los DOS relojes** al cancelar y re-emitir: el **plazo de aceptación** de la oferta
    nueva **y** el de caducidad;
    **(e)** **queda auditado** cada reinicio (quién canceló y cuándo), porque es **tiempo que le regalamos a
    una solicitud** y tiene que poderse revisar.
    **⚠ RIESGO NUEVO, SEÑALADO SIN REMEDIO INVENTADO**: **cancelar y re-emitir en bucle podría alargar el
    plazo indefinidamente**. **Este documento no fija el candado** —es **decisión del arquitecto**—, pero
    **sí fija el requisito de negocio que cualquier candado debe preservar**: **ningún cliente puede quedarse
    esperando indefinidamente sin oferta ni «no procederemos»** (es el hueco que §P.3.1 vino a cerrar).
    *(**⚠ 8ª ronda — el riesgo se ACOTA solo, sin candado nuevo**: como el reinicio **solo ocurre al cancelar
    una oferta que YA LE LLEGÓ al vendedor** (criterio 173), **cada vuelta del bucle le cuesta al operador
    mandarle una oferta vinculante y su cancelación**, con **dos entradas en la bitácora**. El bucle
    **silencioso** —preparar, cancelar, preparar, cancelar sin que al vendedor le llegue nada— **ya no
    reinicia nada**. Queda vivo el **bucle ruidoso**, que es *un operador portándose mal con testigos*, no
    un agujero anónimo.)*

**Ciclo de adquisición del buylist — 8ª ronda (CORRECTIVA FINAL DE DOCUMENTACIÓN): los CINCO correos y el
envío que se dice en palabras (v2.1, D43 + corrección de conteo; §E/§H/§P.3/§P.3.1/§P.5.1/§P.12/M5)**
> **⚠ Corregidos en la 8ª ronda**: el **16(b)** gana el correo que le faltaba; el **142** y el **171(b)**
> dejan de decir «cuatro». **El 132 NO se toca** —gana una nota defensiva, no un cambio— y **el 134, el 152,
> el 165, el 167, el 169, el 170 y el 172 siguen vigentes tal cual**.

173. **LOS CINCO CORREOS DEL CICLO — cada uno afirma un hecho VERDADERO, y hay un caso que no manda ninguno
    (8ª ronda; **⚠ CORRIGE el conteo de CUATRO a CINCO** del criterio 142)**: los correos obligatorios son
    **oferta**, **recordatorio**, **expiración**, **«no procederemos»** y **«cancelamos la oferta»**.
    Verificable en ocho puntos:
    **(a)** **el quinto existe y es propio**: cancelar una oferta **ya enviada** manda un correo que dice
    que **la cancelamos NOSOTROS**, que **no es nada de su parte** y que **su solicitud sigue viva**.
    Verificable **por lo que NO contiene**: **ni la palabra «venció»**, **ni ningún plazo del vendedor**,
    **ni ningún monto** de la oferta cancelada, **ni el motivo interno** por el que la cancelamos, **ni un
    CTA de «cotiza de nuevo»** —la solicitud **no está cerrada** y duplicarla ensucia la cola—;
    **(b)** **el correo de expiración NO se usa aquí**: verificable comparando las dos bandejas — al que
    **no respondió** le llega *«tu plazo venció»* y al que **le cancelamos** le llega *«la cancelamos
    nosotros»*, **y nunca al revés**;
    **(c)** **el silencio del caso que nunca salió**: cancelar una oferta que estaba **pendiente de
    autorización** **no manda absolutamente ningún correo** — verificable en la bandeja del vendedor (vacía)
    y **por lo que tampoco pasa**: **el reloj de caducidad no se reinicia** (criterio 172). **Las dos
    consecuencias se prueban juntas**, porque las gobierna el mismo hecho;
    **(d)** **el barrido que anula una oferta pendiente al caducar manda el correo 4**, no el 5 (criterio
    165f): verificable leyendo el correo — dice *«no procederemos»*, **no** *«cancelamos tu oferta»*;
    **(e)** **el correo NO se puede elegir por el estado ni por el motivo**, y se prueba por lo negativo:
    montar **tres cierres** —no respondió (`rechazada`), no envió (`expirada` + `not_shipped`) y cancelación
    (vuelve a `cotizada`)— y comprobar que **llegan tres textos distintos y correctos**. *(Si el sistema
    eligiera por motivo, el primero y el tercero recibirían el mismo, y son los dos extremos opuestos de
    «quién falló».)*;
    **(f)** **el conteo es CINCO y no seis**: **no existe** una plantilla distinta para «venció el plazo de
    aceptar» y «venció el plazo de enviar» **más allá del copy del plazo** —son **el mismo correo 3**, igual
    que los dos recordatorios son **el mismo correo 2**—, y **no existe** ninguna plantilla de «declinado
    por el operador» (criterio 171b);
    **(g)** **ningún correo del ciclo pide nada después de la verificación** (§P.5.1): verificable **por lo
    que no existe**;
    **(h)** **todo lo prohibido en los correos del ciclo aplica a los cinco**: **CLABE** (ni enmascarada),
    datos de terceros, montos de **otras** solicitudes, cifras internas de la mesa y **domicilio** — se
    verifica buscando esos datos **en los cinco**, no en cuatro.
    **Nota de alcance**: este criterio fija **qué correo sale y qué afirma**. **No fija cómo se implementa
    el discriminador** — eso es del arquitecto; el requisito de negocio es que **ningún vendedor reciba un
    correo que describa un hecho que no ocurrió**.

174. **D43 — EL COTIZADOR DICE EL ENVÍO EN PALABRAS, SIN CIFRAS; LA RESTA VIVE EN LA OFERTA (8ª ronda,
    decisión del humano; **acota D31**, **NO toca el criterio 132**)**: verificable en seis puntos:
    **(a)** en el **cotizador público**, con un carrito cualquiera, **no aparece ninguna cifra de envío**:
    ni la tarifa (**MX$180**), ni un **neto/«recibirías»/«te quedarían»** estimado, ni una **resta**, ni un
    **porcentaje**. **Se busca el número en toda la pantalla**, no solo en el bloque de dinero;
    **(b)** en su lugar aparece **la frase cualitativa** (criterio 175a), y **el único monto del bloque es
    el valor de las cartas**;
    **(c)** **⚠ el faltante del mínimo SIGUE PINTÁNDOSE, con su cifra**: con un carrito de **MX$380** la
    pantalla dice **«te faltan MX$120»** para el mínimo de **MX$500** — **criterio 132(a), intacto** — y
    **saltarse el cotizador sigue sin crear la solicitud** — **criterio 132(b), intacto**. **Este punto se
    verifica en la misma corrida que (a)**, a propósito: es el que impide recortar de más;
    **(d)** **el faltante nunca se expresa en términos de envío**: **no existe** en ninguna superficie
    pública la frase *«te faltan $X para cubrir el envío»* ni ninguna variante que ate el faltante a la
    guía;
    **(e)** en la **oferta** —**correo y pantalla de aceptación**— siguen apareciendo **los tres montos con
    la resta y cuál se deposita** (criterio 134, **sin cambio**), y **coinciden entre correo y pantalla**:
    el vendedor **no acepta a ciegas**;
    **(f)** **la tarifa que aparece en la oferta es la CONGELADA** de esa solicitud (P18), no la del dial
    del día: verificable moviendo el dial después de emitir y comprobando que **el correo, la pantalla y el
    depósito no se mueven**.

175. **LOS TRES TEXTOS AL VENDEDOR, RATIFICADOS (8ª ronda — son promesas de negocio, no decisiones de
    diseño)**: verificable en cinco puntos:
    **(a)** **la frase del cotizador (ES) es exactamente**: *«Nosotros ponemos la guía de envío y su costo
    se descuenta siempre de lo que te pagamos: tú no pagas nada de tu bolsillo. El monto exacto va en la
    oferta, antes de que aceptes.»* **RATIFICADA LITERAL**. Verificable además que **sus cuatro partes están
    y en ese orden**: quién pone la guía, **que se descuenta siempre**, que **no paga de su bolsillo** y
    **dónde verá el número**. La tercera parte **va después** de la segunda: al revés ancla en «gratis» y
    convierte la resta en una corrección incómoda. La versión **EN** dice lo mismo (paridad ES/EN);
    **(b)** **prohibido llamar «gratis», «sin costo» o «cortesía» al envío** —es la lectura falsa que la
    frase existe para impedir— **y prohibido calificarlo de «pequeño», «mínimo», «bajo» o «simbólico»**: en
    una cotización de **MX$500** la tarifa es el **36%**, y decidir por el vendedor cómo debe sentirse ante
    **un número que todavía no le enseñamos** no nos toca. *(«Mínimo» sigue siendo legítimo cuando nombra el
    **mínimo de compra**: ahí no califica la tarifa, nombra un umbral.)*;
    **(c)** **«es una tarifa fija», en el correo de oferta: RATIFICADA, con una acotación que es parte del
    requisito** — la afirmación es **verdadera y sostenible dentro de esa oferta**: la tarifa **no depende
    de cuántas cartas mande, ni del peso, ni del destino, ni del costo real de la etiqueta** (criterios
    149/166) y **está congelada** para esa solicitud (P18). **Lo que NO puede afirmar es permanencia**: la
    tarifa es un **dial** que el negocio puede mover (D31). Verificable en dos frentes: **(c.1)** en el
    correo, «fija» aparece **junto al monto de esa oferta** y **no** como una lista de precios de la
    plataforma (nada de *«nuestra tarifa es y será de $180»*); y **(c.2)** **«fija» NO aparece en ninguna
    superficie que no tenga una tarifa congelada detrás** — en particular **no aparece en el cotizador**,
    donde además no hay ninguna cifra (criterio 174a);
    **(d)** **prohibida toda fórmula que presuponga conocimiento previo en el correo de oferta**: **no
    contiene** «como ya sabías», «como sabes», «recuerda que» ni ninguna variante aplicada al monto del
    envío. **RATIFICADA, y la razón es que ahora sería FALSA**: con D43, **ese correo es la primera vez que
    el vendedor ve la cifra**. Verificable buscando esas fórmulas en el correo de oferta **y en toda
    superficie anterior a él**;
    **(e)** **la excepción, dicha para que nadie la aplique de más**: en el **recordatorio** (correo 2), que
    llega **después** de la oferta, referirse al monto **ya visto** **sí es verdad** y **no está
    prohibido** — lo que sigue prohibido ahí es **omitir la condición NM** y **poner el bruto en el asunto**.
    **La regla general es «no des por sabido lo que no dijiste»**, no una lista negra de palabras.

**Ciclo de adquisición del buylist — 9ª ronda (CIERRE DE DOCUMENTACIÓN): las dos decisiones que vivían fuera
de este documento (v2.1, D41 + D42; §E/§H/§P.3/§P.11)**
> **⚠ No se corrige ningún criterio anterior.** El **176** y el **177** son **nuevos** y **cuelgan de reglas
> que ya estaban**: el **176** es la **superficie** del criterio **173(a)** (correo 5) y el **177** es lo que
> hace **ejecutables a la vez** el **132(a)** y el **174(a)**. **El 132, el 134, el 172, el 173, el 174 y el
> 175 siguen vigentes tal cual.**

176. **D42 — TRAS CANCELAR UNA OFERTA ENVIADA, EL PORTAL LO DICE; TRAS CANCELAR UNA PENDIENTE, NO (9ª ronda;
    es el **hermano de pantalla del criterio 173a**)**: verificable en cinco puntos, y **los dos primeros se
    corren en la misma sesión en la que se lee el correo**:
    **(a)** **la pantalla confirma el correo**: cancelada una oferta **ya enviada**, el vendedor abre **su
    solicitud** y ve **los tres datos**: que **hubo una oferta**, que **se canceló** y **la fecha** de la
    cancelación;
    **(b)** **el estado que ve es el de una solicitud viva**: **`cotizada`** —*esperando nuestra oferta*—, el
    mismo que vio al crearla (criterio 172a). **No hace falta la frase «sigue viva»**: **el estado ya lo
    dice**;
    **(c)** **verificable por lo que NO aparece en esa pantalla**: **el motivo interno** de la cancelación,
    **ningún monto** de la oferta cancelada, **ninguna palabra de plazo vencido** —*«venció»*, *«expiró»*— y
    **ninguna acción** que lo empuje a cotizar de nuevo (duplicaría una solicitud abierta). *(Es **la misma
    lista** que el criterio **173(a)** exige en el correo 5: **las dos superficies afirman lo mismo, o el
    correo no sirve**.)*;
    **(d)** **el contracaso, en la misma corrida**: cancelar una oferta que **todavía esperaba autorización**
    **no deja NINGÚN rastro en el portal** —queda **idéntico a antes**—, igual que **no manda correo** y
    **no reinicia el reloj** (criterios **173c** y **172c**). **Los tres se prueban juntos**: es **un solo
    hecho —¿le llegó o no le llegó?— con TRES consecuencias**, y probarlas por separado esconde justo el
    riesgo de que se desincronicen;
    **(e)** **no hay pantalla nueva ni estado nuevo**: verificable **por lo que no existe** — el rastro vive
    **dentro del detalle de la solicitud que el vendedor ya tenía**, y **no aparece** ningún estado terminal
    ni ningún motivo nuevo en el modelo (criterio 169a).
    **Nota de alcance**: este criterio fija **qué ve y qué no ve el vendedor**. **Cómo se muestra** —dónde
    vive el rastro, qué componente lo pinta— es del **arquitecto** y de **ux-ui**; el requisito de negocio es
    que **ninguna superficie del vendedor contradiga a otra**.

177. **D41 — LA PANTALLA PÚBLICA CONOCE EL MÍNIMO Y SOLO EL MÍNIMO (9ª ronda; es lo que hace **ejecutables a
    la vez** el 132(a) y el 174(a))**: verificable en cuatro puntos:
    **(a)** **el mínimo es dato público y está vivo**: se **cambia el dial del mínimo en M10** (de **MX$500**
    a, por ejemplo, **MX$700**) y **el cotizador dice el faltante nuevo sin tocar código ni volver a
    desplegar**: con un carrito de **MX$380** pasa a decir **«te faltan MX$320»**. *(Si el número estuviera
    quemado en la pantalla este punto falla — y el criterio **132(a)** quedaría mintiendo el día que el
    negocio mueva el dial.)*;
    **(b)** **la tarifa de envío NO viaja a la pantalla pública**: verificable **por debajo del píxel** —no
    solo mirando la pantalla, que es lo que ya cubre el **174(a)**—: **lo que la superficie pública recibe no
    contiene la tarifa** (**MX$180**) **en ninguna forma**: ni como cifra, ni como porcentaje, ni como neto
    ya calculado, ni «guardada para uso futuro». **Se busca el valor, no la etiqueta**;
    **(c)** **tampoco viajan los demás diales internos**: **topes** (por solicitud y mensual), **plazos**,
    **piso de neto** y **cifras de la mesa** (posición, sugerencia) **no se publican** — **el mínimo es la
    excepción, y lo es porque el vendedor lo necesita para decidir antes de enviar**;
    **(d)** **la regla en palabras sigue estando**: quitar la tarifa **no quita el mensaje** — la frase
    cualitativa del criterio **175(a)** sigue en el cotizador. **Decir que el envío se descuenta no requiere
    saber cuánto es.**
    **Nota de alcance**: este criterio fija **qué sabe la pantalla pública y qué no**. **Por dónde llega ese
    mínimo** es del **arquitecto**; lo que este documento exige es que **D43 no dependa de que el frontend se
    porte bien**: **lo que no llega a la pantalla no se puede pintar por error**, ni hoy ni en un rediseño.

## Riesgos y banderas para el humano
> No bloquean el desarrollo técnico del MVP, pero deben resolverse antes de operar con público real.
- **Negocio — el vendedor cerca del mínimo se entera del ~36% HASTA el correo de oferta** *(NUEVA 8ª ronda,
  consecuencia directa de **D43**; objeción levantada por ux-ui y **asumida**)*: al sacar la cifra del
  cotizador, un vendedor que cotiza cerca de **MX$500** ve **MX$180 de envío por primera vez** en el momento
  en que decide. **Es el costo aceptado de no mentirle antes** —el neto del carrito era optimista por
  construcción—, pero puede traducirse en **rechazos y silencios concentrados en las ofertas chicas**.
  **Cómo se resuelve, y NO es repintando la resta**: **se mide** —tasa de rechazo y de no-respuesta **por
  tamaño de oferta**, mirando especialmente la franja pegada al mínimo— y, si duele, **se mueve el dial del
  mínimo de compra**, que ya existe en M10. **El problema, si aparece, no será la divulgación: será la
  proporción.** *(El dato ya se registra por solicitud; no hace falta instrumentación nueva. Si el humano
  quiere el reporte como pantalla, eso **sí** sería alcance nuevo.)*
- **Legal — custodia/depositario**: la bóveda implica guardar bienes de terceros. Validar con abogado la
  figura de **depositario**, el **contrato de custodia**, la responsabilidad por pérdida/daño y el **tope
  por carta**. ~~Definir si hay **seguro formal** del inventario en custodia.~~ — **RESUELTO (2026-09-01,
  decisión 63)**: **no hay seguro**; la bóveda es **resguardo físico**. Consecuencia vigente: **ninguna
  superficie puede decir «asegurada» / «insured»** (vocabulario admitido: resguardo/custodia). El resto de
  esta bandera —depositario, contrato, tope— **sigue abierto**.
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
- **Dinero — el envío gratis es una superficie de abuso nueva** *(2ª ronda v2.1, D16/D17; **AMPLIADO en la 5ª
  por D31**)*: ~~arriba del umbral~~ **en toda compra desde MX$500** *(5ª ronda, D31)* ponemos **una etiqueta a
  nuestro costo antes de ver la mercancía**, y si **todo se rechaza** la absorbemos
  (D17, decisión tomada y correcta para el vendedor honesto). El caso que hay que vigilar es el **vendedor
  repetido** que acepta ofertas, cobra la guía y manda cartas que **nunca pasan NM**: cada ciclo nos cuesta
  una etiqueta. **Estado tras la 4ª ronda**: la **parte de dinero** de la pregunta 16 quedó **cerrada**
  (~~D27/D28~~ **D30** + el **piso de cero** del criterio 152), pero **el límite anti-abuso NO se decidió**.
  *(D30 **no mueve este riesgo**: el costo del ciclo abusado sigue siendo **una etiqueta de MX$180**. Lo único
  que cambia es que **ya no existe** la variante en la que el abusivo, además, contesta que **no** y nos
  obliga a devolver todo.)*
  **⚠ Actualización de la 5ª ronda (D31) — el riesgo NO cambia de naturaleza, pero SÍ de tamaño**: al
  eliminarse el umbral, **la franja de MX$500 a MX$1,000 —que antes NO llevaba etiqueta nuestra— ahora sí la
  lleva**. El **costo por ciclo abusado sigue siendo una etiqueta de MX$180**, pero **hay más ciclos
  elegibles**, y en esa franja **la etiqueta pesa proporcionalmente más** (36% en el piso). Se registra
  **explícitamente** para que el humano lo tenga a la vista, porque **es consecuencia directa de una decisión
  suya y él ya la aceptó a ojos abiertos**.
  **⚠ Actualización de la 6ª ronda (D34) — el riesgo se ACOTA un poco, y por un lado que no se buscaba**:
  con el **piso de neto de MX$200**, **ninguna oferta chica llega a emitirse**, así que **cada ciclo abusado
  exige ahora un bruto de al menos ~MX$380** para que exista siquiera la oferta que le da derecho a la
  etiqueta. **No es una mitigación anti-abuso** —no se diseñó para eso y **no sustituye un tope**—, pero
  **sube el piso de esfuerzo** del abusivo. **El costo por ciclo abusado no cambia: una etiqueta de MX$180.**
  **Resolución
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
- ~~**Experiencia del cliente — el reloj de caducidad no perdona una corrección NUESTRA** *(NUEVO 6ª ronda
  v2.1; resolución de la pregunta 27 por el arquitecto)*: el reloj de **7 días hábiles** cuenta **desde la
  creación de la solicitud** y **no se reinicia** si cancelamos una oferta ya emitida. **Consecuencia real**:
  si nos equivocamos en una oferta, la cancelamos al día 8 y la solicitud vuelve a la fila, el cliente
  recibe un **«no procederemos»** *ese mismo día* — **castigado por un error nuestro**, sin que nadie haya
  vuelto a mirar su solicitud. **Es el comportamiento decidido**, y es coherente con *«un plazo, un
  origen»*; se registra **porque este documento había supuesto lo contrario** y porque el humano debería
  verlo antes de operar con público. **Mitigación de proceso, no de software**: cancelar una oferta emitida
  es **una acción de admin, no un evento automático**, así que quien cancela **puede** re-ofertar en el
  acto. **Si al humano le parece injusto, mover el arranque del reloj es una decisión de producto de una
  línea** — no un rediseño. **Bandera, no bloqueo.**~~
  **⚠ BANDERA RETIRADA en la 7ª ronda (D38): el humano le dio la razón y cambió la regla.** **Cancelar una
  oferta devuelve la solicitud a la fila con los 7 días hábiles COMPLETOS** (§P.3.1, criterio 172). **El
  escenario descrito ya no puede ocurrir** y **«un plazo, un origen» deja de ser la regla vigente**. Se
  conserva el texto como historial porque explica **de dónde salió la corrección**. **No hay acción pendiente
  del humano en esta bandera** — la sustituye la siguiente.
- **BANDERA NUEVA — el bucle cancelar/re-emitir puede alargar el plazo indefinidamente** *(NUEVO 7ª ronda
  v2.1, **D38**; este documento lo señala **sin inventarle remedio**, como se le pidió)*: al reiniciar el
  reloj con cada cancelación, **nada en el requisito impide que una solicitud se mantenga viva para siempre**
  a base de **cancelar y re-emitir en bucle** — cada vuelta regala **7 días hábiles** más, y el cliente
  podría **no recibir nunca ni oferta ni «no procederemos»**. **Es el reverso exacto del problema que D38
  vino a resolver**: antes el cliente perdía tiempo por un error nuestro; ahora podría perderlo por una
  indecisión nuestra.
  **Quién decide el remedio**: **el arquitecto**, si concluye que hace falta candado. Las formas obvias
  —**tope de cancelaciones por solicitud**, **techo absoluto contado desde la creación**, o **solo alerta y
  auditoría sin bloquear**— tienen implicaciones de diseño y **este documento no elige ninguna**.
  **Lo que sí es requisito de negocio y no se negocia** (§P.3.1, criterio 172): **ningún cliente puede
  quedarse esperando indefinidamente sin oferta y sin «no procederemos»** — es justo el hueco que D33 cerró,
  y **cualquier candado debe preservarlo**. **Mitigación que ya existe sin construir nada**: cancelar es
  **una acción de admin auditada** (criterio 172e), así que **el bucle se ve en la bitácora**.
  **Bandera, no bloqueo.**
- **Privacidad / datos personales — pedimos la DIRECCIÓN a gente a la que no le vamos a comprar** *(NUEVO 7ª
  ronda v2.1, **D36**; **el humano ya aceptó el costo operativo**, esto señala el **costo de datos**)*: al
  exigir la dirección **al crear la solicitud**, guardamos **el domicilio de personas con las que nunca se
  cerró una operación** — solicitudes que **caducan**, que el operador **declina** (D39) o cuya oferta **no
  se emite** por el piso de neto (D34). Es **la consecuencia directa y aceptada** de pedirlo temprano; se
  registra porque **toca la misma familia de riesgos** que el INE y el guest checkout: **aviso de privacidad**
  (¿le decimos para qué usamos el domicilio y qué pasa si no le compramos?), **retención** (¿cuánto tiempo se
  conserva la dirección de una solicitud que terminó en nada?) y **solicitudes de borrado**. **Atenuante
  real**: **no es un dato nuevo en la plataforma** —es **la misma libreta** que el cliente ya usa para
  recibir compras (D37)—, así que **no se crea un almacén nuevo de PII**; lo que cambia es **quién acaba
  teniendo una dirección guardada**. **Validar con el aviso de privacidad**, junto con los otros puntos de
  datos personales de esta lista. **Bandera, no bloqueo.**
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

> ### ⚠️ DOS HILOS DE DECISIÓN CON NUMERACIÓN SUPERPUESTA — LÉASE ANTES DE CITAR UN NÚMERO
> *(nota de fusión, 2026-09-05)* Esta sección junta el hilo **v2.1 · ciclo de adquisición del buylist** (que
> venía en la rama) con el hilo **v2.0 · gancho de grading** (que entró por `main`). **Los dos se numeraron
> en paralelo a partir del 55**, así que **ambos empiezan en 56**.
> **Los dos entran completos y con sus números originales: NO SE RENUMERÓ NADA.** Los números están citados
> desde el contrato, los tests, los informes de QA y este mismo documento; renumerar aquí, en mitad de una
> fusión, rompería referencias que otros roles están tocando en este momento.
> - **Qué queda ambiguo, dicho sin adornos**: en «Decisiones tomadas» los números **56–64 aparecen dos
>   veces**, y en «Criterios de aceptación» los números **113–121** también. **Un número a secas es ambiguo
>   en esos dos rangos, y solo en esos dos.**
> - **Cómo se cita mientras esto no se arregle**: **`decisión 60 (v2.0)`** vs. **`decisión 60 (v2.1)`**, y
>   **`criterio 118 (§O)`** vs. **`criterio 118 (§P)`**.
> - **Asimetría que conviene saber**: las decisiones **v2.1 tienen además la etiqueta estable `D1–D43`**, que
>   **no colisiona** — `docs/` ya las cita así (D33, D25, D2…). Las **v2.0 solo tienen número**, y
>   `ARCHITECTURE.md` / `FRONTEND_NOTES.md` las citan por número (*decisión 59*, *decisión 62*). **Al citar
>   una decisión v2.0, el sufijo `(v2.0)` no es opcional.**
> - **Orden de lectura**: primero el hilo **v2.1** (56–105, D1–D43), después el hilo **v2.0** (56–64), que
>   continúa la cuarta ronda de arriba. Está así porque **preservar el texto de los dos lados palabra por
>   palabra pesa más que el orden**.
> - **Qué falta y de quién es**: **renumerar y reordenar es UNA sola decisión pendiente**, y **no es de este
>   documento tomarla en silencio** — toca cuatro documentos de otros roles. Se enruta al humano /
>   orquestador. Regla de conflicto: **ante ambigüedad se pregunta, no se asume.**

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
63. **D8 — Los ~~dos~~ TRES plazos son DIALES editables** desde el back-office (**M10**), sin redeploy y
   auditados; no constantes en código. *(**Eran dos**; la **5ª ronda (D33)** suma el **plazo de caducidad de
   la solicitud sin oferta**, 7 días hábiles — §P.10.)*
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
   una oferta enviada el **viernes no vence el domingo**. Aplica a ~~los dos~~ **los TRES plazos del ciclo**
   *(5ª ronda, D33: el de **caducidad** también se cuenta en días hábiles, «por consistencia con D14»)*.
70. **D15 — Qué dispara el «no comprar»** *(responde la pregunta 9)*: la sugerencia se dispara cuando la
   posición alcanza el **objetivo del bounty** de la variante **o** un **tope general de piezas por
   variante**, ambos **configurables**. **Nunca bloquea** — D6 queda intacta.
   *(**Precisado por D29 (3ª ronda)**: el «o» pasa a ser **precedencia** —con bounty manda el bounty; sin
   bounty, el tope de **10**—. **Completado por D32 (5ª ronda)**: como **el objetivo del bounty es ahora
   obligatorio**, **no existe** la rama sin techo —bounty vivo sin meta— que este documento había señalado.)*
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
74. **⚠ D18b — SUPERADA por D31 (5ª ronda). El umbral de guía se elimina; su dial queda SIN OBJETO.**
   ~~**Umbral de guía: MX$1,000**, **dial SEPARADO** del mínimo. Quedan **tres bandas**: **&lt;$500 no se
   compra**; **$500–$1,000 se compra y el vendedor paga su envío** como hoy; **&gt;$1,000 se compra y
   nosotros ponemos la guía**.~~ **Motivo del retiro (decisión 90)**: **el humano nunca pidió ese umbral** —
   fue una propuesta de este documento—; **su intención siempre fue mandar la guía SIEMPRE**. Quedan **dos
   bandas** y **un solo borde** (**MX$500 inclusivo**), y **la validación cruzada del criterio 127 se
   re-ancla** en `tarifa de envío < mínimo de compra`. Ver §P.12 y criterio **162**.
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
   *(⚠ **CORREGIDO en la 5ª ronda por D33: son CUATRO** — se suma el de **«no procederemos» por caducidad**,
   que **no es una variante de la expiración**: la expiración dice *«aceptaste y no mandaste»*, la caducidad
   dice *«no vamos a ofertarte»*. Ver §P.3, §P.3.1 y criterios 142/165.)*
   **(P7)** **aceptar exige sesión** — **no hay enlace anónimo** de aceptación.
   **(P10)** **«solicitud viva» = todo lo que NO sea terminal**; **terminales**: **`pagada`, `rechazada`,
   `abandonada`, `expirada`** *(~~**⚠ 5ª ronda, D33: se suma `caducada` — son cinco**~~ — **⚠ 6ª ronda:
   SIGUEN SIENDO CUATRO**; la caducidad es un **motivo de `expirada`**, no un estado. La definición **por
   exclusión** no cambia, y esta vez **ni siquiera hubo nada que agregar**)*.
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
   ~~**⚠ Nota de coherencia REEMPLAZADA (4ª ronda)**: la garantía es que **el piso de cero nunca se activa en
   una operación con TODO aprobado**, porque la **tarifa de envío es estrictamente menor que el umbral de
   guía** (MX$180 < MX$1,000) y ese umbral es **inclusivo**.~~
   **⚠ Nota de coherencia RE-ANCLADA y ACOTADA (5ª ronda, D31)**: el **umbral de guía desapareció**, así que
   la garantía se ancla en el **mínimo de compra** — **la tarifa de envío es estrictamente menor que el
   mínimo** (**MX$180 < MX$500**) y el mínimo es **inclusivo**, de modo que **una SOLICITUD COMPLETA con todo
   aprobado nunca deposita cero**. **M10 protege esa relación con una validación bloqueante** (§P.10,
   criterio 127). **Lo que la garantía NO cubre y antes sí quedaba cubierto de hecho**: una **oferta recortada
   por cherry-pick** puede quedar por debajo de la tarifa y **depositar MX$0 con todo aprobado**, porque el
   mínimo **no se re-aplica a la oferta** (criterio 158c). Antes de D31 eso no podía ocurrir, porque en esa
   zona de monto **el vendedor pagaba su propio envío y no había nada que descontarle**. **El invariante de
   este bullet sigue intacto** —el neto **nunca es negativo** y **nunca hay cobro al vendedor**—; lo que
   cambia es que **el piso de cero ahora sí es alcanzable sin rechazo de cartas**. Se señala en §P.5.1, §P.10
   y §P.12, y se abre la **pregunta 25**. *(**⚠ CERRADA en la 6ª ronda por D34**: con el **piso de neto de
   MX$200 al EMITIR**, **esa oferta ya no llega a existir**. El invariante de este bullet **sigue intacto y
   sigue siendo necesario**: gobierna **el pago**, no la emisión — decisión **94**, criterios 152 y 167.)*
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
   *(⚠ **RE-ANCLADO en la 5ª ronda, D31**: el **umbral de guía dejó de existir**, así que la validación se
   muda al **mínimo de compra** — **MX$180 < MX$500** —, y la **pregunta 24 queda CERRADA**: el humano aceptó
   **sin colchón**.)*

**Decisiones v2.1 — quinta ronda del humano (2026-09-01; D31–D33, CORRECTIVAS; ver §E/§H/§N.6/§P.1/§P.2/
§P.3/§P.3.1/§P.4/§P.10/§P.11/§P.12):**
> Tres decisiones. Dos **retiran alcance que este documento había inventado** (el umbral de guía, y la rama
> del bounty sin techo) y una **cierra un hueco real** que dejó abierto el re-anclaje del barrido de 30 días.
90. **D31 — UNA SOLA BANDA: siempre mandamos la guía y siempre se descuenta. Se elimina el umbral de guía.**
   **Qué estaba mal (lo aclaró el humano)**: **su intención siempre fue mandar la guía SIEMPRE**. El umbral de
   **MX$1,000** (D18b) fue **una propuesta de este documento que él nunca pidió**.
   **Qué se decide**: **desde el mínimo de MX$500, en toda compra ponemos la guía y su costo SIEMPRE se
   descuenta del importe a pagar**. **Las tres bandas pasan a dos** y **la banda intermedia se retira**.
   **Requisito de comunicación, en sus palabras**: *«clarifica en todos lados que siempre se deduce del
   importe a pagar»* — en el **cotizador**, el **correo de oferta** y los **términos**, **y no como letra
   chica**: en una oferta de **$500** los **$180** son el **36%**, el vendedor recibe **$320** y **debe verlo
   antes de aceptar**.
   **Qué se RETIRA**: **(a)** el **dial «umbral de guía»** —**sin objeto**, §P.10—; **(b)** la **banda
   intermedia** de §P.12 y sus réplicas; **(c)** la **variante de correo de oferta con un solo monto**;
   **(d)** el arranque del plazo de envío *«desde la aceptación»*; **(e)** el **segundo borde inclusivo**
   (criterio 158b).
   **Efecto colateral resuelto**: la **validación cruzada del criterio 127** perdió su referente por segunda
   vez. **Se re-ancla**, no se retira: **`tarifa de envío` < `mínimo de compra`** (**$180 < $500**),
   conservando la propiedad money-safe de que **una operación con TODO aprobado nunca deposita cero**.
   **El humano aceptó a ojos abiertos el 36% en el piso**, así que **la pregunta 24 (cuánto colchón) queda
   CERRADA con «ninguno»**. **Ambos siguen siendo diales**: si duele, se mueven.
   **⚠ Lo que este documento SEÑALA y no resuelve solo**: la garantía cubre la **solicitud completa**, no la
   **oferta recortada por cherry-pick** (el mínimo no se re-aplica a la oferta, criterio 158c). **Pregunta
   abierta 25.**
91. **D32 — El objetivo del bounty pasa a ser OBLIGATORIO.**
   **El hueco que cierra (lo había señalado el 3er pase de este documento)**: la mesa le da **precedencia al
   bounty sobre el tope general de 10** (D29), así que una variante con **bounty vivo y SIN objetivo**
   **nunca** pintaba «no comprar», por más copias que acumulara — **una rama sin techo**.
   **Qué se decide**: **dar de alta un bounty exige capturar su objetivo** (*«hasta tener N en inventario»*).
   **Sin objetivo, no hay bounty.** Con eso **el caso «bounty sin meta» deja de existir** y el tope general
   **siempre tiene con qué compararse**.
   **Qué NO se construye**: **panel de bounties**. El humano lo pidió y **decidió dejarlo como proyecto
   aparte**; aquí **solo se exige el objetivo donde hoy se configuran** (§N.6, «Fuera de alcance»).
   ~~*(**SUPUESTO** — bounties preexistentes sin objetivo: se les exige el dato **al editarlos**; mientras no
   lo tengan, la mesa los trata como **«sin bounty» para la sugerencia** y aplica el tope de 10 —el lado
   seguro del error—, **sin tocar el precio**. **Pregunta abierta 26**.)*~~
   **⚠ SUPUESTO SUPERADO en la 6ª ronda por D35 (decisión 95)**: el objetivo tiene **default 2** y **los
   bounties viejos se llenan con 2** — **no se desactivan** y **ninguno se comporta como «sin bounty»**.
92. **D33 — La solicitud que nadie oferta CADUCA a los 7 días hábiles, con un correo que dice que NO
   PROCEDEREMOS.**
   **El hueco que cierra**: al re-anclarse el barrido de 30 días —**correctamente**, porque **`cotizada` ahora
   significa «esperando que NOSOTROS ofertemos»** y cerrarla por **inacción nuestra** sería **culpar al
   cliente**—, **quedó sin nada que cerrara una `cotizada`**. Un cliente podía **esperar indefinidamente sin
   respuesta de ningún tipo**.
   **Qué se decide**: a los **7 días hábiles desde la creación**, una solicitud que **nadie ofertó** **caduca**
   (terminal) y **sale un correo que dice explícitamente que NO PROCEDEREMOS con la oferta**, invitando al
   cliente a **volver a cotizar cuando quiera**. **Días hábiles**, por consistencia con **D14**.
   **Dos consecuencias que se escriben, no se dejan mintiendo**: **(1)** es el **CUARTO correo obligatorio**
   —los del ciclo pasan de **tres a cuatro** (§P.3, §H, criterios 16/142 y la **pregunta 6**, que se había
   cerrado con «tres»)— *(**⚠ 8ª ronda: y de cuatro a CINCO**, por el mismo tipo de error en el correo de
   expiración — decisión **101**, criterio **173**)*; **(2)** es **un dial más**: se fue el **umbral de guía** (D31) y entró este **plazo**,
   así que **§P.10 vuelve a OCHO diales** *(**⚠ 6ª ronda: NUEVE**, entra el neto mínimo para emitir, D34)*.
   ~~Además, **los estados terminales pasan de cuatro a cinco**.~~ *(**⚠ 6ª ronda: NO** — siguen siendo
   **CUATRO**; la caducidad es un **motivo de `expirada`**, decisión 96.)*
   **No lleva recordatorio al cliente**: es **el único plazo del ciclo que corre contra nosotros**, y avisarle
   de un plazo que depende de nuestra carga de trabajo no le sirve de nada.
   ~~*(**SUPUESTOS** señalados: el **nombre `caducada`** y modelarla como estado propio —el requisito real es
   que **sea distinguible de `expirada`**, porque significan cosas opuestas—; que **caduque aunque haya una
   oferta esperando autorización** —el cliente sigue esperando y el pendiente es nuestro—; y que, si una
   oferta emitida se **cancela**, el reloj **arranque de nuevo desde la cancelación**. **Pregunta abierta
   27**.)*~~
   **⚠ RESUELTOS en la 6ª ronda por el arquitecto (decisión 96, pregunta 27 CERRADA)**: **`expirada` +
   motivo en columna propia** (`no_offer` / `not_shipped`) —**los terminales siguen siendo CUATRO**—; **sí
   caduca** con oferta en cola **y el barrido la anula**; y ~~**el reloj NO reinicia**: cuenta **desde la
   creación**~~ **⚠ REVERTIDO en la 7ª ronda por el humano (D38): el reloj SÍ se reinicia — 7 días hábiles
   COMPLETOS al cancelar una oferta; decisión 98, criterio 172**.
   *(**7ª ronda, D39**: **este plazo ya no es la única salida** — el operador puede **declinar ahora** y
   cerrar la solicitud el día 1, con el **mismo correo** y el **mismo estado terminal**; decisión 99,
   criterio 171.)*
93. **Costo real de la etiqueta: captura OPCIONAL con fallback a la tarifa congelada** *(5ª ronda; resuelve un
   punto que el arquitecto había señalado y **cierra la contradicción criterio 135 × D19**)*: al **confirmar
   el envío**, el operador **puede** capturar cuánto costó la etiqueta. **Si no lo captura, el gasto se
   registra con la tarifa congelada de MX$180.** **El P&L (M7) usa el real cuando existe y la tarifa cuando
   no.** **Lo que se le descuenta al vendedor NO cambia jamás**: es la **tarifa congelada** (D25), porque **el
   neto es vinculante**. **No es integración con paquetería** (D19 intacta): es **un campo que el operador
   escribe**. Ver §H, §P.4 y criterios **135/149/166**.
   *(Los **demás puntos del arquitecto** —quién cancela la guía, a qué estado vuelve una oferta cancelada, que
   `expirada` selle la fecha de cierre y la línea sin precio que aporta 0 al mínimo— **quedan como él los
   resolvió**; este documento **no los toca**, y lo único que agrega es **cómo cuenta el reloj de caducidad**
   cuando una oferta se cancela, §P.3.1.)* ~~**⚠ Y en eso el arquitecto lo corrigió en la 6ª ronda: el reloj
   NO se reinicia — ver decisión 96.**~~ **⚠ Y en la 7ª ronda el HUMANO lo corrigió de vuelta (D38): el reloj
   SÍ se reinicia, con 7 días hábiles COMPLETOS — ver decisión 98 y criterio 172.** *(Vale la pena registrar
   el recorrido: este documento lo supuso así, el arquitecto lo corrigió, este documento **levantó la bandera
   en vez de callarla**, y el humano **le dio la razón a la bandera**.)*

**Decisiones v2.1 — sexta ronda del humano (2026-09-01; D34–D35, CORRECTIVAS FINALES, más la resolución de
la pregunta 27 por el arquitecto; ver §N.6/§P.1/§P.2/§P.3/§P.3.1/§P.5.1/§P.9/§P.10/§P.11/§P.12):**
> Dos decisiones del humano —ambas **fijan un número que faltaba**— y una resolución técnica que **simplifica
> el modelo sin tocar el requisito**. Con esto **el bloque v2.1 queda sin preguntas abiertas propias**.
94. **D34 — SÍ hay piso: no se puede EMITIR una oferta cuyo NETO sea menor a MX$200.**
   **La pregunta que cierra (la 25)**: este documento había señalado que, con **una sola banda**, un
   **cherry-pick chico** puede depositar **MX$0 sin rechazar ninguna carta** — la validación
   `tarifa < mínimo` protege **la solicitud completa**, no **la oferta recortada**.
   **Qué se decide**: **el operador compra más líneas o no oferta**.
   **Dónde vive el bloqueo, que es la mitad de la decisión**: en la **EMISIÓN de la oferta**. **No en el
   dial** —los diales **no ven el recorte** que hizo el operador, así que M10 no puede validarlo— y **no en
   la aceptación** —**el correo no debe llegar a mandarse**: el punto no es que el vendedor rechace una
   oferta ridícula, es que **esa oferta no exista**—.
   **La aritmética, registrada porque es lo que hace defendible el número** *(la puso el humano)*: una
   solicitud cuesta **~MX$217** de operar (**etiqueta MX$180** + tiempo de operador); comprando al **40% de
   referencia**, para que se **pague sola** hace falta un **bruto de ~MX$362**, que deja **~MX$182 de neto**.
   **MX$200 queda justo arriba** y exige un **bruto de ~MX$380**: **conserva margen de cherry-pick sobre
   lotes grandes** sin permitir la oferta absurda.
   **No es un bloqueo nuevo**: el arquitecto ya había bloqueado **`neto ≤ 0`**; **D34 lo SUBE a MX$200** —
   **el mismo bloqueo con número**.
   **Consecuencias**: **(1)** es **un dial más** ⇒ la tabla de §P.10 pasa de **OCHO a NUEVE**; **(2)** el
   **piso de cero al PAGAR (criterio 152) NO se toca** — D34 gobierna **qué se emite**, el 152 gobierna
   **cuánto se paga**; **(3)** el **mínimo de compra sigue sin re-aplicarse a la oferta** (criterio 158c):
   este es **otro umbral, con otro número, en otro momento**. Ver §P.2, §P.3, §P.10, §P.12 y criterio **167**.
95. **D35 — El objetivo del bounty por defecto es 2.**
   **El número que faltaba en D32**: *«hasta tener 2 en inventario»*.
   **Qué se decide, en tres piezas**: **(a)** es el **valor por defecto al dar de alta** un bounty —el campo
   llega prellenado, así que el objetivo **sigue siendo obligatorio pero deja de ser fricción**—; **(b)** es
   el valor con el que **se llenan los bounties viejos** sin meta — **NO se desactivan**, **no salen de la
   vitrina** y **no cambian de precio**—; **(c)** **sigue siendo editable por bounty**: **2 es el default, no
   un tope rígido**.
   *(**⚠ CORRIGE un supuesto de este documento**: yo había propuesto tratar a los bounties viejos como **«sin
   bounty» para la sugerencia** hasta que alguien los editara, y ofrecí «poner un objetivo por defecto» como
   alternativa que **explícitamente no recomendaba**. **El humano eligió esa alternativa y le puso número.**
   Con eso el caso «bounty sin meta» deja de existir **también hacia atrás**, sin depender de que nadie
   recuerde editar nada.)*
   **Qué NO se construye**: sigue **sin panel de bounties** (proyecto aparte). El default y el llenado
   ocurren **donde hoy se configuran**. **El 2 no es un dial de M10**: es el valor inicial de un campo.
   **Pregunta 26 CERRADA.** Ver §N.6, §P.2 y criterio **168**.
96. **Resolución de la pregunta 27 por el ARQUITECTO — la caducidad es un MOTIVO, no un quinto estado.**
   **Qué decidió**: **reusar el terminal `expirada`** y **persistir el motivo en columna propia**
   (**`no_offer`** / **`not_shipped`**), en vez de crear un quinto terminal.
   **Su razón, que este documento adopta**: *un estado que se comporta **idéntico** a otro en todas las
   reglas —cierre, purga de INE, cuota, «no se revive»— **no es un estado, es un atributo**; pero **la causa
   sí importa** para el correo y **no es derivable**.*
   **Consecuencia**: **los terminales siguen siendo CUATRO**. **`caducada` era un SUPUESTO de nombre de este
   documento y queda SUPERADO.** **El requisito de negocio no cambia**: los dos desenlaces **tienen que ser
   distinguibles** —correos distintos y reportes que los separen— y el motivo lo cumple.
   **Sus respuestas a los dos bordes del plazo**: **(a)** **SÍ** caduca aunque haya una oferta **esperando
   autorización**, y **el barrido ANULA esa oferta al hacerlo** *(supuesto **confirmado**, con el verbo
   explícito)*; **(b)** ~~el reloj **NO reinicia** al cancelar una oferta emitida — **cuenta desde la creación
   de la solicitud** *(**⚠ CORRIGE** el supuesto contrario que este documento había redactado)*.
   *(⚠ **Lo que este documento SEÑALA** sobre (b): una solicitud puede **caducar el mismo día en que vuelve a
   la fila** si ya pasaron los 7 días hábiles — **el cliente paga una corrección nuestra**. Queda como
   **bandera** en «Riesgos y banderas», no como bloqueo.)*~~
   **⚠ (b) REVERTIDO EN LA 7ª RONDA POR EL HUMANO (D38): el reloj SÍ se reinicia — 7 días hábiles COMPLETOS.**
   **La bandera cumplió su función**: el humano vio el escenario y **cambió la regla**. **(a) sigue intacta.**
   Ver decisión **98** y criterio **172**.
   **Pregunta 27 CERRADA.** Ver §P.1, §P.3.1, §P.9, M5 y criterios **113/129/145/165/169**.

**Decisiones v2.1 — séptima ronda del humano (2026-09-01; D36–D40, CORRECTIVAS FINALES, más la corrección
o.17 enrutada por el arquitecto; ver §E/§H/§P.1/§P.2/§P.2.1/§P.3/§P.3.1/§P.4/§P.5.1/§P.10/§P.11/§P.12/M5):**
> **Dos de estas decisiones nacieron de banderas que este documento levantó** (D38 y D39) y **una tapó un
> hueco bloqueante que nadie había visto** (D36/D37): **el ciclo nunca pedía la dirección del vendedor**, lo
> que hacía **inejecutable** el requisito de que la guía la ponemos nosotros.
97. **D36/D37 — La DIRECCIÓN del vendedor: se pide AL CREAR la solicitud y se reusa su libreta.**
   **El hueco que cierra, y era BLOQUEANTE**: **el ciclo nunca pedía la dirección del vendedor** —verificado:
   **cero menciones de dirección, domicilio o remitente en toda la §P** antes de esta ronda—. Y desde
   **D16/D31** **la guía la ponemos nosotros, siempre**. **Una etiqueta no se puede comprar sin domicilio de
   origen**, así que **D16 no era ejecutable como estaba escrito**: en el paso donde el operador «compra la
   guía a mano» **faltaba el dato con el que se compra**.
   **Qué decidió el humano, en cuatro piezas**: **(a)** se pide **AL CREAR la solicitud**, **junto con la
   CLABE** — **no al aceptar**; **(b)** se **reusa la MISMA libreta de direcciones** que el cliente ya usa
   para **recibir sus compras**: **sin modelo nuevo, sin pantalla nueva y sin «domicilio de remitente»
   aparte**; **(c)** **mismo patrón que la CLABE**: si ya tiene direcciones guardadas **elige o confirma**,
   si no tiene ninguna **la captura** — **el cliente recurrente no re-teclea nada**; **(d)** **sin dirección
   no se puede crear la solicitud**.
   **Costo aceptado explícitamente**: **también se le pide la dirección a gente a la que al final no le
   compraremos**.
   *(**⚠ Contradicción señalada, no asumida**: la frase de apoyo *«igual que hoy pasa con la CLABE»* **no
   describe lo que este documento dice hoy** — la **CLABE se pide en el paso de PAGO**, no al crear (criterio
   14, §E, M6). **La dirección se redacta como el humano la decidió**; **la CLABE se deja intacta** y se abre
   la **pregunta 29**.)*
   Ver **§P.2.1** (nueva), §P.1, §P.3, §P.4, §E, §H, M5 y criterio **170**.
98. **D38 — El reloj de caducidad SÍ reinicia al cancelar una oferta. ⚠ CORRIGE la 6ª ronda.**
   **De dónde salió**: **este documento lo señaló como bandera de riesgo** y **el humano le dio la razón**.
   Con el reloj corriendo siempre desde la creación, **cancelar una oferta para corregirla** podía hacer que
   la solicitud **caducara el mismo día en que volvía a la fila**, y el cliente recibía un *«no
   procederemos»* **por una corrección nuestra**.
   **Qué se decide**: **cancelar una oferta devuelve la solicitud a la fila con los 7 días hábiles
   COMPLETOS**. **Qué queda superado**: la regla *«un plazo, un origen»* donde este documento la escribió
   como vigente, y la **bandera** de la 6ª ronda, que se retira.
   **Qué NO cambia**: sin cancelaciones, el plazo se cuenta **desde la creación** como siempre.
   **⚠ Riesgo NUEVO que este documento SEÑALA sin inventarle remedio**: **cancelar y re-emitir en bucle
   podría alargar el plazo indefinidamente**. **El candado —si hace falta— lo decide el arquitecto**; el
   requisito de negocio que cualquier candado debe preservar es que **nadie se quede esperando
   indefinidamente**. Ver §P.3.1, §P.10, §H, «Riesgos y banderas» y criterio **172**.
99. **D39 — «Declinar ahora»: el operador puede cerrar la solicitud el día 1.**
   **De dónde salió**: **también lo señaló este documento** — si el operador decidía el día 1 que no compra,
   **el cliente esperaba 7 días hábiles** a que el barrido lo cerrara.
   **Qué se decide**: el operador **cierra la solicitud de inmediato**, con **el MISMO correo** de «no
   procederemos» y **el MISMO estado terminal** (`expirada` + `no_offer`). **No es un desenlace nuevo: es el
   mismo, sin la espera.** **No agrega** estado, motivo, correo ni plazo; **queda auditado quién declinó**;
   **el barrido sigue existiendo** para las solicitudes que nadie tocó. Ver §P.2, §P.3.1, §P.1, §E, M5 y
   criterio **171**.
100. **D40 — El piso de neto es INCLUSIVO. Confirmado, sin cambio.**
   **Qué confirmó el humano**: un neto de **exactamente MX$200 SÍ se puede emitir** — la condición de bloqueo
   es **`neto < 200`**, **no** `neto ≤ 200`. **Ya estaba redactado así** (criterio 167a); esta ronda **no
   cambia nada** y solo **elimina la ambigüedad** donde se decía «por debajo del piso» sin fijar el borde
   (§P.2, §P.3, §P.10, §P.12). **Mismo criterio de borde que el mínimo de compra**: **a favor del vendedor**.
   *(Corrección enrutada **o.17**, del mismo bloque: los **ejemplos** con **neto MX$20 / MX$0** como ofertas
   válidas quedan **corregidos**; la **regla del criterio 158(c) —el mínimo no se re-aplica a la oferta—
   sigue viva**. Ver §P.5.1, §P.12 y criterio 158.)*

**Decisiones v2.1 — octava ronda (2026-09-01; D43 + corrección de conteo enrutada por el arquitecto y por
ux-ui; ver §E/§H/§P.3/§P.3.1/§P.5.1/§P.12/M5 y criterios 173–175):**
> **No entra alcance nuevo.** Una es **decisión del humano** (D43) y las otras dos son **correcciones de
> documentación**: un conteo que este documento tenía mal y dos textos al cliente que había que ratificar.

101. **Los correos obligatorios del ciclo son CINCO, no cuatro. ⚠ CORRIGE a este documento.**
   **Qué estaba mal**: el correo 3 se llamaba *«expiración/cancelación»* y **metía tres desenlaces en uno
   solo**. Dos son del vendedor (no respondió; aceptó y no mandó) y el tercero **es nuestro**: cancelamos la
   oferta. Ese tercero **no es una expiración**: **no venció ningún plazo**, **no incumplió nadie** y **la
   solicitud sigue viva** —vuelve a la fila con 7 días hábiles completos (D38)—. Mandarle ahí un correo que
   dice *«se venció tu plazo»* **le imputa al vendedor un acto nuestro**, y su CTA de *«cotiza de nuevo»* lo
   manda a **duplicar una solicitud abierta**.
   **Qué se decide**: **la cancelación de una oferta YA ENVIADA tiene correo propio** —*«la cancelamos
   nosotros, no es nada de tu parte, tu solicitud sigue viva»*—. **Es el argumento con el que D33 creó el
   correo 4, un nivel más abajo**, así que la respuesta es la misma. **Los CINCO**: oferta, recordatorio,
   expiración, «no procederemos», «cancelamos la oferta».
   **Y un caso que NO manda ningún correo**: **cancelar una oferta que aún esperaba autorización**. Esa
   oferta **nunca existió para el vendedor**; escribirle sería contarle una decisión interna que jamás le
   concernió **y** revelarle un control nuestro. **De ahí cuelgan las dos consecuencias juntas**: **enviada
   ⇒ reinicia reloj + correo; pendiente de autorización ⇒ ni reloj ni correo.** Con eso el **bucle
   silencioso** de re-emisión **queda cerrado de raíz**.
   **La regla que evita que el conteo se vuelva a equivocar** (§H): **un correo = un HECHO que le afirmamos
   al vendedor**. Por eso **son cinco y no seis**: los dos plazos del vendedor comparten el correo 3 (mismo
   hecho, distinto plazo) igual que ya compartían el recordatorio, y los dos productores del 4 comparten
   texto (D39).
   **Y por eso el discriminador no puede ser el estado ni el motivo**: el motivo **queda vacío en dos de los
   tres desenlaces** que el viejo correo 3 agrupaba, así que **mandaría el mismo correo al que no cumplió y
   al que no hizo nada**. **Lo que discrimina es quién disparó el cierre.** *(Cómo se implementa es del
   arquitecto.)*
   **Hueco de documentación que esto destapa y se cierra**: el criterio **16(b)** nunca dijo que saliera
   correo al vencer el plazo de aceptación. **Sale** — no es alcance nuevo, es lo que «expiración» cubrió
   desde la 2ª ronda. Ver §P.3 (tabla, **origen único del conteo**), §H, M5, criterios **16/142/171** y el
   criterio **173** (nuevo). **Pregunta 6 RE-CERRADA por tercera vez.**

102. **D43 — El cotizador dice el envío EN PALABRAS; la resta con los tres montos vive en la OFERTA.**
   **Qué decide el humano**: el **cotizador no menciona ningún monto de envío** —**sin cifra, sin resta, sin
   neto estimado y sin expresar el faltante del mínimo en términos de envío**—; solo **la frase
   cualitativa**. **Los tres montos y la resta viven en la oferta**, que es **autenticada** y usa la
   **tarifa congelada**.
   **Sus razones, y la mejor no es la primera**: **(1)** el cotizador **ya es indicativo** —los precios se
   mueven y **puede que no compremos todas las líneas**—, así que restarle un envío exacto es **precisión
   falsa**; **(2)** *(argumento de ux-ui, y es el que decide)* ese neto era **sistemáticamente OPTIMISTA**,
   porque el recorte del operador **solo quita líneas**: la pantalla pintaba **la mejor cifra posible, nunca
   la esperada**, y fabricaba justo la decepción que la oferta vinculante existe para evitar.
   **Qué NO cambia — y se escribe fuerte porque ya hubo un recorte de más**: **el criterio 132 queda
   ENTERO**. El **faltante del mínimo** (*«te faltan $120»*) **SÍ se pinta en el cotizador**, con sus **dos
   frentes (a) y (b)**. **Un faltante del mínimo no es un monto de envío**: es una cifra **sobre las cartas
   del vendedor**, exacta, y sin ella un «no» seco lo manda a otro lado.
   **Qué acota de D31 y qué no**: **la REGLA sigue diciéndose en las tres superficies** (cotizador, oferta,
   términos) — eso de D31 **no se toca**; lo que sale del cotizador es **el número**.
   **Consecuencia asumida**: **el correo de oferta pasa a ser la primera vez que el vendedor ve la cifra del
   envío** — de ahí la decisión 103, y una bandera de negocio (medir, no repintar). Ver §E, §H, §P.3, §P.12,
   «Fuera de alcance» y criterios **132 (intacto) / 174**.

103. **Los tres textos al cliente: DOS ratificados literales y UNO ratificado con acotación.**
   **(a) La frase del cotizador — RATIFICADA LITERAL**: *«Nosotros ponemos la guía de envío y su costo se
   descuenta siempre de lo que te pagamos: tú no pagas nada de tu bolsillo. El monto exacto va en la oferta,
   antes de que aceptes.»* Hace **las dos cosas que tenía que hacer a la vez**: que sepa que **habrá un
   descuento** y que **no crea que ya sabe cuánto**. El orden importa: el alivio va **después** de la resta,
   nunca antes.
   **(b) «Es una tarifa fija» en el correo de oferta — RATIFICADA, ACOTADA A ESA OFERTA.** Es **verdadera y
   sostenible**: la tarifa **no depende del número de cartas, ni del peso, ni del destino, ni del costo real
   de la etiqueta**, y **está congelada** para esa solicitud. **Lo que el negocio NO puede prometer es
   permanencia**: es un **dial** y D31 dice expresamente que **si duele se mueve**. Por eso «fija» **solo
   puede aparecer donde haya una tarifa congelada detrás** —el correo y la pantalla de esa oferta— y
   **nunca** en el cotizador ni en una superficie que la presente como lista de precios.
   **(c) La prohibición de presuponer conocimiento previo — RATIFICADA**, y **la razón es que ahora sería
   falsa**: con D43, el correo de oferta **es la primera vez que ve la cifra**, así que «como ya sabías» o
   «recuerda que» **serían mentira educada**. Aplica al **correo de oferta y a toda superficie anterior**.
   **Excepción explícita, para que no se aplique de más**: en el **recordatorio**, que llega **después**,
   referirse al monto ya visto **sí es verdad**. **La regla general es «no des por sabido lo que no
   dijiste»**, no una lista negra de palabras. Ver criterio **175**.

**Decisiones v2.1 — novena ronda (2026-09-01; D41 + D42, formalización; ver §E/§H/§P.3/§P.11 y criterios
176–177):**
> **No entra alcance nuevo.** Esta ronda **no decide nada que no estuviera decidido**: **trae a este
> documento** las dos decisiones que vivían **solo en documentos del arquitecto**, porque **son requisito de
> negocio** y la **regla de conflicto** dice que `PROJECT.md` manda sobre el contrato. Cierra la **pregunta
> 31**.

104. **D42 — Tras cancelar una oferta YA ENVIADA, el portal del vendedor lo dice: hubo una oferta, se
   canceló, y cuándo.**
   **Qué se decide**: el portal muestra **esos tres datos y nada más**. **El motivo interno no se publica**
   —por qué cancelamos es **evaluación nuestra** y vive en la bitácora—, y **por coherencia con el correo 5**
   tampoco se pintan **montos de la oferta cancelada** ni **palabras de plazo vencido**.
   **Por qué es requisito de negocio y no diseño**: es **«qué VE el vendedor cuando le cancelamos»**. El
   correo 5 le afirma un hecho; **si el portal no lo confirma, la pantalla contradice al correo** y entre las
   dos **le va a creer a la pantalla**. Queda con un correo que no puede verificar en ningún lado —**la
   sensación exacta de «me escribieron por error» o «esto es phishing»**—, que es el daño que el correo 5
   vino a evitar, reaparecido **una pantalla después**. **Un correo que no se puede verificar en el portal es
   medio correo.**
   **Qué NO agrega**: **ninguna pantalla nueva, ningún estado nuevo, ningún motivo nuevo**. La solicitud
   **vuelve a `cotizada`** (D38) y el portal **ya pinta ese estado**: por eso **no hace falta escribir «sigue
   viva»**.
   **El contracaso queda pegado al caso, a propósito**: la oferta que **solo esperaba autorización** **no
   deja rastro** —**ni correo, ni reloj, ni pantalla**—. **Un solo hecho —¿le llegó o no le llegó?— gobierna
   las TRES consecuencias**, así que **no pueden desincronizarse**. Ver §P.3, §P.11 y criterio **176**.

105. **D41 — El cotizador conoce el mínimo de compra, y ningún otro dial. La tarifa de envío no se publica.**
   **Qué se decide**: la **pantalla pública** recibe **el mínimo vigente** —lo necesita para cumplir el
   criterio **132(a)**: decir **cuánto falta** *antes* de que el vendedor intente enviar, **con el número
   correcto** y **sin quemarlo**, porque el mínimo es un **dial** que el negocio puede mover— **y ningún otro
   dato del negocio**. En particular **la tarifa de envío NO se publica**.
   **Por qué la tarifa no, dicho como requisito**: **D43 no puede depender de que el frontend se porte
   bien**. Mientras la tarifa **llegue** a la pantalla, pintarla es **un descuido de una línea** —hoy, en un
   rediseño o en un experimento de marketing— y **nadie lo nota hasta que un vendedor lo ve**. **Lo que no
   llega, no se puede pintar por error.** Es la misma lógica por la que el mínimo **se valida en el
   servidor** y no solo en el cotizador (criterio 132b): **la superficie del cliente no se defiende sola**.
   **Historia, para que el número no confunda**: **D41 nació como una propuesta más amplia del arquitecto**
   —publicar los diales al cotizador— **que él mismo retiró**. Lo que queda vigente es **esta versión
   acotada**: de los **dos diales de monto** (mínimo y tarifa), **solo el mínimo es público**.
   **Qué NO cambia**: la **regla en palabras** sigue en el cotizador (D31/D43) —**decir que el envío se
   descuenta no requiere saber cuánto es**— y **los tres montos siguen en la oferta**. **No cierra la
   pregunta 30**: los **términos** son otra superficie. Ver §E, §H y criterio **177**.

---

> **↑ Termina el hilo v2.1 (buylist, 56–105 · D1–D43) · ↓ Reanuda el hilo v2.0 (gancho de grading), que
> venía de la «cuarta ronda» de más arriba.**
> **Los números 56–64 que siguen son del hilo v2.0 y NO son los mismos 56–64 de arriba.** Cítense como
> **`decisión NN (v2.0)`**. Ver el aviso de numeración al inicio del bloque v2.1.

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

63. **NO HAY SEGURO del inventario en custodia — la bóveda es resguardo físico, y la UI no puede decir
   «asegurada»** *(2026-09-01; **cierra la bandera legal «definir si hay seguro formal del inventario en
   custodia»** de «Riesgos y banderas para el humano»)*:

   - **Qué respondió el dueño, textual**: *«No hay seguro sino que están en lugar seguro»*. Se registra **sin
     suavizar**: **no existe póliza contratada** sobre las cartas en custodia. Lo que hay es un **lugar
     físicamente seguro**. **Resguardo ≠ cobertura aseguradora**, y eso es todo lo que se puede afirmar hoy.
   - **Consecuencia de producto — es la parte que importa**: **ninguna superficie puede afirmar que las cartas
     están «aseguradas» / «insured»**. Ni el **home**, ni el **catálogo**, ni la **bóveda**, ni los **correos**,
     ni los **términos**. El **vocabulario admitido es de resguardo/custodia** —«**resguardadas**», «**en
     bóveda**», «**kept safe**»— y **nunca** de seguro. Decir «asegurada» sin póliza es una **afirmación
     comercial falsa** sobre el manejo de bienes de terceros, del mismo tipo que el documento ya vigila en §O.5.
     **Esto se verifica, no solo se declara**: **criterio 120** (cero apariciones, con la lista de exclusiones
     legítimas). Una restricción que ningún gate recorre vuelve sola en tres meses.
   - **Estado**: el gate de QA del pase de copy del home detectó **5 cadenas i18n** que afirmaban lo contrario;
     **frontend las está corrigiendo ahora** (ES/EN). Este documento **se alinea con el producto corregido**,
     no al revés.
   - **Esto es una restricción de copy VIGENTE mientras no exista póliza**, no una preferencia de redacción. **El
     día que se contrate un seguro, esta decisión se REABRE antes de volver a usar la palabra**, y hay que
     responder tres cosas: **quién asegura**, **qué cubre** (¿pérdida? ¿daño? ¿robo?) y **hasta qué monto**
     (tope por carta / por evento). Sin esas tres, la palabra sigue prohibida.
   - **Lo que NO cambia**: la **responsabilidad por pérdida/daño en custodia** sigue siendo la ya definida —
     **reposición al precio de referencia del día del incidente con tope por carta configurable** (M10). Esa es
     una **obligación de la plataforma**, no un seguro, y **se sigue pudiendo afirmar** tal cual está redactada.
   - **Lo que esta decisión NO resuelve**: la etiqueta de envío **«Envío (asegurado)» / «Shipping fee
     (insured)»** dentro de la tarifa fija de MX$175 es **otro dato y otra fuente** (la paquetería, no la
     bóveda) y **no se toca por analogía** — ver **pregunta abierta 25**.

64. **«Vender desde la bóveda» NO existe: se retira la promesa del copy. Si debe existir algún día es del
   dueño** *(2026-09-01; hallazgo de QA en el re-gate del pase de copy del home)*:

   - **El hecho, que no admite discusión**: `home.how.step3Body` promete **«O las vendes desde la bóveda, sin
     moverlas»** / **«Or sell from the vault without moving a card»**, y **eso hoy es falso** por tres razones
     independientes: la **bóveda no tiene acción de venta**, **§E** (buylist) está construido sobre que el
     usuario **envía** la carta, y **«Consignación / marketplace C2C (cartas de terceros vendidas dentro de la
     bóveda)»** está listado en **Fuera de alcance**. **Frontend ya está retirando la frase** — no espera a
     nadie, porque una promesa falsa en el home no se queda en pantalla mientras se decide su futuro.
   - **Lo que esta decisión cierra**: **la promesa se retira del producto y del documento**, y **ninguna
     superficie puede volver a hacerla mientras la capacidad no exista** (verificable: **criterio 121**). Es el
     mismo patrón de la decisión 62: **el documento se alinea con el producto**, no al revés.
   - **Lo que esta decisión NO cierra, y no me corresponde cerrar**: **si la capacidad debe construirse**. Eso
     es **alcance nuevo con flujo de dinero** —la plataforma compraría una carta ya bajo su custodia— y por
     tanto **es del dueño**: ver **pregunta abierta 26**, con mi recomendación.
   - **Por qué se registra en vez de solo borrar la cadena** *(la razón de existir de esta entrada)*: la frase
     **suena bien y describe algo que el negocio hace parecer obvio** —la carta ya está autenticada y en
     nuestro poder—, así que **va a volver** si lo único que queda es un commit que la quitó. Queda escrito
     **qué se prometió, por qué era falso y quién decide su futuro**.

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
25. **¿El envío de MX$175 lleva SEGURO de verdad, y hasta qué monto?** *(NUEVA, 2026-09-01 — **no es de §O**;
    vive en esta lista porque es la **lista viva** de preguntas abiertas. **Enrutada a PO por el techlead** en la
    revisión del pase de copy del home, como **ítem propio** y no como nota al pie)*

    - **ESTADO: ABIERTA — PENDIENTE DE RESPUESTA DEL DUEÑO.** No tiene supuesto por defecto y **el PO no la
      asume**. Mientras no haya respuesta, **la cadena se queda exactamente como está**: a diferencia de la
      custodia, **aquí no hay un hecho que la contradiga**.
    - **QUIÉN RESPONDE: el dueño**, con el **dato contractual de la paquetería**. Es un **hecho verificable con
      el transportista**, no una decisión de producto ni de diseño — por eso ningún otro rol puede cerrarla.
    - **QUÉ SE PREGUNTA**: **(a)** ¿la tarifa contratada **incluye** cobertura del paquete? **(b)** ¿**hasta qué
      monto declarado**? (las cartas caras de este catálogo pueden rebasar por mucho el tope estándar de una
      guía). **(c)** ¿cubre **pérdida**, **daño**, o solo pérdida?
    - **CONTEXTO — por qué no se corrigió con las otras cinco**: la decisión **63** cerró que **la custodia no
      tiene seguro** y retiró la palabra de **5 cadenas**. Esta es la **sexta superficie que dice lo mismo**:
      el checkout cobra `shipments.shippingFee` con la etiqueta **«Envío (asegurado)» / «Shipping fee
      (insured)»** dentro de la tarifa fija de **MX$175**, respaldada por §D («**MX$175** por paquete (**con
      seguro**)»). **Es la misma clase de afirmación**; la **única** razón de no corregirla a la vez es que aquí
      **sí puede existir una póliza real** —la del transportista, que es **otra fuente** que la bóveda— y
      **nadie lo ha comprobado**.
    - **QUÉ SE HACE CON CADA RESPUESTA** *(las dos ramas, para que quien reciba la respuesta no tenga que
      volver a preguntar)*:
      - **«SÍ cubre»** ⇒ la cadena **se queda tal cual**, y **se documenta el tope**: monto máximo cubierto y
        qué cubre (pérdida/daño) quedan escritos en **§D** junto a la tarifa, y la **exclusión (a)(1) del
        criterio 120** deja de estar «sujeta a respuesta» y pasa a **exclusión firme con su dato**. **Si el tope
        es más bajo que el valor típico de un envío**, hay que decidir aparte si la etiqueta debe **acotarse**
        (p. ej. nombrar el límite) — eso **vuelve al PO**, no se resuelve aquí.
      - **«NO cubre»** —o el tope es tan bajo que la palabra engaña— ⇒ la cadena **tiene exactamente el mismo
        problema que las cinco anteriores**: (1) se le retira el «asegurado»/«insured» y queda **«Envío» /
        «Shipping fee»**; (2) se **corrige §D**; (3) **sale de la exclusión (a)(1) del criterio 120** y **entra**
        al alcance de ese criterio. **Ruta de la corrección**: es **copy de checkout** ⇒ rol **frontend**,
        stream **«Órdenes y dinero»**, con el mismo patrón ES/EN de la corrección del home.
26. **¿VENDER DESDE LA BÓVEDA es roadmap, o se descarta?** *(NUEVA, 2026-09-01 — es el resto que deja la
    **decisión 64**; **no bloquea nada**: la promesa falsa ya se está retirando del copy)*

    - **ESTADO: ABIERTA — PENDIENTE DE RESPUESTA DEL DUEÑO.** **No la cierro yo**: es **alcance nuevo con flujo
      de dinero**, y el documento ya tiene una línea de Fuera de alcance que la roza. **No hay supuesto por
      defecto que cambie el producto**: pase lo que pase, **hoy no se promete** (criterio 121).
    - **QUIÉN RESPONDE: el dueño.** Solo se le pide un **sí/no de intención**, no un diseño.
    - **QUÉ SE PREGUNTA**: el copy del home prometía que puedes **vender una carta desde la bóveda sin
      moverla**. ¿Es **algo que quieres construir** (⇒ candidata de roadmap, fase 2) o **algo que nunca
      quisiste** (⇒ se descarta y queda dicho, para que la frase no reaparezca en tres meses porque suena bien)?
    - **MI RECOMENDACIÓN COMO PO: candidata de roadmap, no descarte.** La razón es que **el flujo ya existe casi
      entero**: es el **buylist sin el paso de envío**. La carta ya está **en nuestro poder**, ya fue
      **verificada al ingreso**, ya es **NM confirmado** y su **titularidad es `settled`** — desaparecen justo
      las partes caras y riesgosas del buylist (recepción, verificación de condición, rechazo/devolución). Para
      el dueño es **inventario que se compra sin logística**, y para el cliente es **liquidez sin fricción**.
      Es la clase de función que **hace que la bóveda valga la pena** en vez de ser solo un almacén.
    - **PRECISIÓN QUE IMPORTA, PARA NO CONFUNDIRLA CON LO QUE ESTÁ FUERA DE ALCANCE**: lo de arriba **NO es
      consignación ni C2C**. En Fuera de alcance está «**cartas de terceros vendidas dentro de la bóveda**» —es
      decir, la plataforma como **intermediaria** entre dos usuarios—. Lo que recomiendo es que **la plataforma
      COMPRE** la carta, igual que en el buylist: **una sola contraparte, sin order-book, sin wallet**. Si el
      dueño quiere lo otro, eso **sigue fuera de alcance** y es otra conversación.
    - **LO QUE HABRÍA QUE RESOLVER SI DICE QUE SÍ** *(no lo asumo, lo enumero para que la respuesta venga
      completa)*: **(a)** ¿a qué precio —la **tarifa de buylist** vigente, o una **mejor** por ahorrarse la
      logística—?; **(b)** ¿aplican los **topes y el INE** del buylist (MX$3,000/solicitud, MX$10,000/mes) y el
      **soporte AML**, dado que sigue siendo un **pago SPEI a un particular**?; **(c)** ¿qué pasa con una carta
      con **titularidad `pending`** o dentro de la **ventana de disputa**?; **(d)** ¿el traspaso a inventario
      vendible es **inmediato**, al no haber envío que esperar? **Nada de esto se diseña hasta que haya un sí**,
      y el diseño es del **arquitecto**, no mío.
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
> segunda ronda (D13–D23)**, las **seis de la tercera (D24–D29)**, la **correctiva de la cuarta (D30)**, las
> **tres de la quinta (D31–D33)** y las **dos de la sexta (D34–D35)** están cerradas y ya redactadas en §P,
> §E, §H y §N.6; **no se re-litigan**.
> Abajo se conservan **las veintisiete preguntas con su desenlace** —qué se cerró, con qué decisión y si
> **corrigió** el supuesto que yo había tomado—.
>
> ## **ESTADO (2026-09-01, 7ª ronda — CORRECTIVA FINAL): las 27 anteriores siguen CERRADAS; se abren DOS nuevas (28 y 29), ninguna bloqueante.**
> **Lo que cerró esta ronda sin preguntar nada**: **(D36/D37)** la **dirección del vendedor** —el **hueco
> BLOQUEANTE** que hacía que **D16 no fuera ejecutable**: **no hay etiqueta sin domicilio de origen**—, que
> se pide **al crear la solicitud** **reusando la libreta que ya existe**; **(D38)** el **reloj de caducidad
> SÍ reinicia** al cancelar una oferta —**este documento lo había señalado como bandera y el humano le dio
> la razón**—; **(D39)** existe **«declinar ahora»**, mismo correo y mismo estado terminal **sin la espera**
> —**también señalado por este documento**—; **(D40)** el **piso de neto es inclusivo**, confirmado **sin
> cambio**. Y **(o.17)** se corrigieron los **ejemplos numéricos** de «neto MX$20 / MX$0» que quedaban como
> válidos (la **regla** del criterio **158(c)** **no cambió**).
> **Las DOS nuevas** salen de decisiones de la propia ronda: **(28)** el **alcance fino de la dirección**
> (congelado por solicitud, hasta cuándo se puede corregir) y **(29)** la **contradicción de la CLABE**
> —*«igual que hoy pasa con la CLABE»* **no describe lo que este documento dice hoy**—. **Ambas con supuesto
> tomado**, así que **no bloquean al arquitecto**.
> **⚠ Un supuesto de la 6ª ronda quedó CORREGIDO por el humano en la 7ª**: el **no-reinicio del reloj**
> (pregunta 27c). **Y el riesgo que abre D38 —el bucle cancelar/re-emitir— queda SEÑALADO sin remedio
> inventado**: el candado, si hace falta, lo decide el arquitecto.
>
> ## **ESTADO (2026-09-01, 6ª ronda — CIERRE CORRECTIVO — histórico; superado en lo que toca al reinicio del reloj): las 27 preguntas están CERRADAS. El bloque v2.1 NO tiene preguntas abiertas propias.**
> **Las tres que abrió la quinta ronda quedaron cerradas en la sexta**: **(25)** el humano puso **piso: neto
> mínimo de MX$200 para EMITIR** (**D34**) — la tabla de §P.10 pasa a **NUEVE diales**; **(26)** el humano
> fijó el **objetivo del bounty por defecto en 2** y **los viejos se llenan con 2, sin desactivarse**
> (**D35**); **(27)** la resolvió el **arquitecto**: **`expirada` + motivo en columna propia**
> (`no_offer` / `not_shipped`), así que **los terminales vuelven a ser CUATRO**, **sí caduca** con oferta en
> cola de autorización —**el barrido la anula**— y ~~**el reloj NO reinicia** al cancelar una oferta~~
> *(**⚠ REVERTIDO en la 7ª ronda por D38: SÍ reinicia, 7 días hábiles completos**)*.
> **Dos supuestos míos quedaron corregidos en esta ronda**: el **nombre/modelado `caducada`** y el
> **reinicio del reloj desde la cancelación**. **Uno más quedó corregido por D35**: tratar a los bounties
> viejos como «sin bounty».
>
> ## **ESTADO (2026-09-01, 5ª ronda — histórico): las 24 anteriores están CERRADAS; hay TRES nuevas, ninguna bloqueante.**
> Las **doce del primer pase**, las **diez de la segunda**, **la 23 de la tercera** y **la 24 de la cuarta**
> quedaron todas resueltas. **Ningún número de dinero sigue sin fijar**: tope de oferta del operador
> **MX$1,500**, tarifa de envío **MX$180**, tope de piezas por variante **10**, alerta de «ya lo mandé»
> **5 días hábiles**, **plazo de caducidad 7 días hábiles** *(NUEVO, D33)*, **mínimo MX$500 inclusivo — único
> borde**.
> ~~umbral de recorte material **20%**~~ — **retirado por D30: dial sin objeto** (§P.10).
> ~~umbral de guía **MX$1,000 inclusivo**~~ — **retirado por D31: dial sin objeto** (§P.10, §P.12).
>
> **La pregunta 23 quedó CERRADA POR ELIMINACIÓN (D30)**: preguntaba qué plazo tenía el vendedor para
> contestar *«¿continúas?»*, qué significaba su silencio y si llevaba recordatorio. **Ya no hay tal
> pregunta al vendedor**, así que **no hay plazo que fijar, ni semántica del silencio que decidir, ni
> recordatorio que agregar**. *(Ese hueco era, precisamente, una de las señales de que D27 estaba mal
> planteada.)*
>
> **La pregunta 24 quedó CERRADA en la 5ª ronda (D31)**: preguntaba **cuánto colchón** dejar entre la
> **tarifa de envío** y el **umbral de guía**. **Ese umbral ya no existe**, así que la validación se
> **re-ancló** en el **mínimo de compra** (**$180 < $500**) y el **colchón quedó decidido: ninguno** — el
> humano **aceptó a ojos abiertos** que en el piso de $500 el envío pese **36%**.
>
> **Se abren TRES preguntas nuevas (25, 26, 27)**, todas **no bloqueantes** y todas con **supuesto
> redactado**: **(25)** el **piso de cero ahora es alcanzable sin rechazo de cartas** —efecto colateral de
> quitar la banda intermedia—; **(26)** qué hacer con los **bounties ya creados sin objetivo**; **(27)** el
> **modelado y los bordes del nuevo plazo de caducidad**. **⚠ Las TRES quedaron CERRADAS en la 6ª ronda** —
> ver el bloque de estado de arriba y el desenlace de cada una abajo.
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
   la mandamos nosotros** ~~(arriba del umbral de D18b)~~ **SIEMPRE, desde el mínimo de MX$500** *(5ª ronda,
   **D31**: el umbral se elimina — **la respuesta se vuelve todavía más simple de lo que yo la había
   escrito**)* y **se descuenta del pago**. Esto además **deja sin efecto a D5**: el cliente **ya no captura**
   la guía.
6. ~~**¿Qué correos son obligatorios en el ciclo?**~~ → **CERRADA por D23; RE-CERRADA con otro número en la 5ª
   ronda por D33; ⚠ RE-CERRADA OTRA VEZ EN LA 8ª RONDA — es la TERCERA vez que este conteo cambia, y la
   razón siempre fue la misma: un correo que agrupaba hechos distintos.** ~~Son **tres**: oferta,
   recordatorio y expiración.~~ ~~**⚠ SON CUATRO**~~ **⚠ SON CINCO**: **oferta**,
   **recordatorio** (uno por plazo del vendedor, a un día hábil, una sola vez), **expiración**,
   **«no procederemos» por caducidad** (**D33**) y **«cancelamos la oferta»** (**8ª ronda**).
   **Lo que la 8ª ronda corrige, dicho corto**: la **cancelación** vivía **dentro** del correo de
   expiración, y ahí **afirmaba un hecho falso** —*«se venció tu plazo»* cuando **no venció nada** y **la
   solicitud sigue viva**—. Es **el mismo error que D33 arregló en el otro extremo**, así que la respuesta
   es la misma: **correo propio**. Y se cierra un caso que nunca se había preguntado: **cancelar una oferta
   que aún esperaba autorización NO manda ningún correo**. Ver §P.3 (tabla, origen único del conteo), §H y
   criterio **173**.
   *(**Nota de método, porque el patrón ya se repitió tres veces**: el conteo se equivoca cada vez que se
   agrupan correos **por el estado en que queda la solicitud** en lugar de **por el hecho que se le
   afirma al vendedor**. La regla que evita la cuarta vez está escrita en §H: **un correo = un hecho**.)* *(Residuo **CERRADO en la 3ª ronda**: el recordatorio es
   **uno POR PLAZO** —hasta dos en el ciclo, cada uno una sola vez—. ~~Nota: con **D27** puede aparecer **un
   tercer plazo**; ver pregunta 23.~~ **Corrección de la 4ª ronda**: con **D30 no hay tercer plazo ni cuarto
   correo**.)*
   **Corrección de la 5ª ronda (D33)**: **sí hay un tercer plazo y un cuarto correo**, pero **no los que D27
   proponía**. El de D27 era *«pregúntale al vendedor si continúa, con las cartas ya en la bóveda»*; **el de
   D33 es lo contrario**: un plazo **para nosotros**, que **nos obliga a responderle**. **El cuarto correo no
   es una variante de la expiración**: uno dice *«aceptaste y no mandaste»*, el otro dice *«no vamos a
   ofertarte»*. Ver §P.3, §P.3.1 y criterios **16/142/165**.
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
   ~~*(**Nota de la 5ª ronda, D33**: la lista pasa a **CINCO** con **`caducada`**…)*~~
   *(**⚠ Nota de la 6ª ronda**: la lista **NO pasó a cinco** — **siguen siendo CUATRO**. La caducidad es un
   **motivo de `expirada`**. **La definición por exclusión se pagó sola por partida doble**: no solo el
   desenlace nuevo entró sin tocar la lista, es que **ni siquiera hubo desenlace nuevo que agregar**.)*
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
   *(**Nota de la 5ª ronda, D31**: ese riesgo **crece de tamaño, no de naturaleza** — al eliminarse el umbral,
   **la franja de $500 a $1,000 ahora también lleva etiqueta nuestra**, así que **hay más ciclos elegibles**.
   El costo por ciclo sigue siendo **una etiqueta de MX$180**. **Sigue sin tope y sigue aceptado**; se
   actualiza la entrada de «Riesgos y banderas» para que el humano lo vea con el número nuevo.)*
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
   *(**Nota de la 5ª ronda, D31**: **la mitad del borde de $1,000 quedó SIN OBJETO** —ese umbral desapareció—,
   así que **queda un solo borde, el de $500**, y es **inclusivo en los dos sentidos**: **se crea la
   solicitud Y lleva guía nuestra**. **La otra mitad —que el mínimo no se re-aplica— sigue vigente**, y es
   justamente la que abrió la **pregunta 25** — **cerrada en la 6ª ronda por D34**: el mínimo **sigue sin
   re-aplicarse**, pero **hay otro umbral en otro momento**, el **neto mínimo para EMITIR (MX$200)**.)*
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

**Hueco que abrió la cuarta ronda (24) — CERRADO en la quinta:**
24. ~~**[ABIERTA] ¿Cuánto margen debe haber entre la TARIFA DE ENVÍO del buylist y el UMBRAL DE GUÍA?**~~ →
   **CERRADA en la 5ª ronda por D31 — y el referente de la pregunta desapareció junto con la respuesta.**
   La pregunta nació del efecto colateral de retirar D28: la validación del criterio **127** se había quedado
   sin fórmula y yo la reformulé contra el **umbral de guía**, dejando **el margen** por decidir.
   **Qué pasó**: **D31 eliminó el umbral de guía**, así que la validación se **re-ancló** en el dial que sí
   quedó — **`tarifa de envío del buylist` < `mínimo de compra`** (**MX$180 < MX$500**) — y **el margen quedó
   decidido: NINGUNO**. El humano **aceptó a ojos abiertos** que en el piso de $500 el envío pese **36%**
   (recibe **$320**), con la condición de que **se le diga al vendedor en todos lados y antes de aceptar**
   (D31). **Tarifa y mínimo siguen siendo diales**: si duele, se mueven.
   *(Lo que **sí** sobrevivió de esta pregunta, pero **con otra forma**, fue la **pregunta 25**: la validación
   protege la **solicitud completa**, no la **oferta recortada**. **Cerrada en la 6ª ronda por D34** — la
   oferta recortada la protege **otro dial en otro momento**: el **neto mínimo de MX$200 al EMITIR**.)*

**Huecos que abrió la quinta ronda (25, 26, 27) — LOS TRES CERRADOS EN LA SEXTA:**
25. ~~**[ABIERTA] ¿Debe haber un PISO DE NETO para siquiera emitir una oferta?**~~ → **CERRADA en la 6ª ronda
   por D34: SÍ, y es MX$200 de NETO. Mi supuesto («sin piso») quedó DESCARTADO.**
   **Lo que preguntaba**: con **una sola banda**, una oferta chica —por ejemplo **MX$200 de bruto** tras
   cherry-pick de una solicitud de MX$600— deposita **MX$20**, y una de **MX$150** deposita **MX$0** **aunque
   todas las cartas lleguen en NM**. La validación del criterio 127 (`tarifa < mínimo`) **no cubre ese caso**,
   porque **el mínimo no se re-aplica a la oferta** (criterio 158c, que **sigue vigente**).
   **Qué decidió el humano**: **no se puede EMITIR una oferta cuyo neto sea menor a MX$200.** **El operador
   compra más líneas o no oferta.**
   **Dónde vive el bloqueo** *(la parte que este documento se había perdido al plantear la pregunta)*: en la
   **EMISIÓN**, **no** en el dial —**los diales no ven el recorte del operador**— y **no** en la aceptación
   —**el correo no debe llegar a mandarse**—.
   **La aritmética que lo sostiene**: operar una solicitud cuesta **~MX$217** (etiqueta **MX$180** + tiempo);
   al **40% de referencia** hace falta un **bruto de ~MX$362** para que se pague sola (**~MX$182 de neto**).
   **MX$200 queda justo arriba** (bruto ~**MX$380**) y **conserva el margen de cherry-pick sobre lotes
   grandes**.
   **No es un bloqueo nuevo**: el arquitecto ya bloqueaba `neto ≤ 0`; **D34 lo sube a MX$200**.
   **Consecuencias**: **un dial más** ⇒ §P.10 pasa a **NUEVE**; **el criterio 152 no se toca** (el piso de
   cero al **pagar** sigue igual). Ver §P.2, §P.10, §P.12, decisión **94** y criterio **167**.
26. ~~**[ABIERTA] Los bounties YA creados sin objetivo, ¿qué pasa con ellos?**~~ → **CERRADA en la 6ª ronda
   por D35: el objetivo por defecto es 2, y con 2 se llenan los viejos. Mi supuesto quedó CORREGIDO.**
   **Lo que yo había supuesto**: exigirles el dato **al editarlos** y, mientras tanto, tratarlos como **«sin
   bounty» para la sugerencia** (aplicando el tope de 10). Ofrecí «poner un objetivo por defecto» como
   alternativa **que explícitamente no recomendaba** —*«un número inventado en un dial de compra es justo lo
   que este documento evita»*—.
   **Qué decidió el humano**: **esa alternativa, con número: 2.** *(Y la objeción se cae sola: **2 no es un
   número inventado por este documento, es el número del dueño**, y **no es un dial** — es el valor inicial
   de un campo editable por bounty.)*
   **Las tres piezas**: **(a)** **default 2 al dar de alta**; **(b)** **los viejos se llenan con 2** —**NO se
   desactivan**, siguen en la vitrina y **no cambian de precio**—; **(c)** **editable por bounty**: 2 es el
   default, **no un tope rígido**.
   **Qué gana**: el caso «bounty sin meta» deja de existir **también hacia atrás**, sin depender de que
   alguien recuerde editar los viejos, y **ningún bounty se comporta como «sin bounty»**. **Sigue sin haber
   panel de bounties.** Ver §N.6, §P.2, decisión **95** y criterio **168**.
27. ~~**[ABIERTA] Los bordes del plazo de caducidad (D33): modelado y reinicio del reloj.**~~ → **CERRADA en
   la 6ª ronda POR EL ARQUITECTO. De mis tres supuestos: uno DESCARTADO, uno CONFIRMADO, uno CORREGIDO.**
   **(a) ¿Estado propio o motivo?** **Mi supuesto (`caducada` como terminal propio) quedó DESCARTADO.**
   El arquitecto decidió **reusar `expirada`** y **persistir el motivo en columna propia** (**`no_offer`** /
   **`not_shipped`**). **Su razón, que este documento adopta**: *un estado que se comporta **idéntico** a otro
   en todas las reglas —cierre, purga de INE, cuota, «no se revive»— **no es un estado, es un atributo**;
   pero **la causa sí importa** para el correo y **no es derivable**.* **Los terminales vuelven a ser
   CUATRO**, y **el requisito de negocio que yo había escrito se cumple igual**: los dos desenlaces
   **distinguibles**, con **correos distintos** y **reportes que los separan**. *(Yo mismo había dicho que
   «si el arquitecto prefiere modelarlo como `expirada` + motivo, es su decisión» — lo prefirió.)*
   **(b) ¿Caduca con una oferta esperando autorización?** **Mi supuesto CONFIRMADO: SÍ** —el cliente sigue
   esperando y el pendiente es nuestro—, **y con el verbo explícito: el barrido ANULA esa oferta al hacerlo**,
   así que después **no puede autorizarse**.
   **(c) ¿Desde cuándo cuenta el reloj si se cancela una oferta emitida?** ~~**⚠ Mi supuesto quedó
   CORREGIDO.** Yo había escrito *«desde la cancelación»*; la regla vigente es **NO se reinicia: cuenta desde
   la creación de la solicitud**.
   **Lo que este documento señala sobre (c), en vez de callarlo**: es exactamente el escenario por el que yo
   había supuesto lo contrario — **una solicitud puede caducar el mismo día en que vuelve a la fila**, y el
   cliente recibe un *«no procederemos»* **por una corrección nuestra**. **Está decidido y es el vigente**;
   queda como **bandera** en «Riesgos y banderas» para que el humano lo vea. **Si le parece injusto, mover el
   arranque del reloj es una decisión de producto de una línea.**~~
   **⚠ REABIERTA Y RESUELTA AL REVÉS EN LA 7ª RONDA POR EL HUMANO (D38): el reloj SÍ se reinicia — la
   solicitud vuelve a la fila con los 7 días hábiles COMPLETOS.** **La bandera funcionó**: el humano vio el
   escenario, le pareció injusto y **movió el arranque del reloj**, que era exactamente la decisión «de una
   línea» que este documento había anticipado. **Mi supuesto original —«desde la cancelación»— resulta ser
   el vigente**; lo que quedó superado fue la resolución del arquitecto en este punto **y solo en este
   punto**: **(a)** *(motivo, no estado)* y **(b)** *(caduca con oferta en cola y el barrido la anula)*
   **siguen intactas**. **Riesgo nuevo, señalado sin remedio inventado**: el **bucle cancelar/re-emitir**.
   Ver §P.1, §P.3.1, §P.9, §P.10, decisiones **96** y **98**, y criterios **169** y **172**.

**Huecos que abrió la séptima ronda (28, 29) — LOS DOS ABIERTOS, ninguno bloqueante:**
28. **[ABIERTA — no bloqueante] La dirección de la solicitud: ¿se congela, y hasta cuándo se puede
   corregir?** *(nace de **D36/D37**, §P.2.1)*
   **Lo que la decisión del humano fijó sin ambigüedad**: **se pide al crear**, **se reusa la libreta de
   compras**, **elige/confirma o captura**, y **sin dirección no hay solicitud**. **Eso alcanza para
   construir.**
   **Lo que NO dijo, y este documento resolvió con supuesto**: **(a)** si la dirección **queda congelada en
   la solicitud** —de modo que **editar la libreta después no le mueva el domicilio a una solicitud viva**—;
   **(b)** **hasta qué momento** el vendedor puede **corregirla** (¿hasta aceptar? ¿hasta que compremos la
   etiqueta? ¿nunca, y se cancela la operación?); y **(c)** qué pasa si **se muda entre la creación y la
   aceptación** —hoy el correo de oferta se la muestra y le ofrece corregirla, pero **si ya compramos la
   etiqueta, cambiarla cuesta una etiqueta** (D22: la guía no usada hay que cancelarla).
   **SUPUESTOS tomados**: **(a)** **sí se congela por solicitud**, con el mismo criterio que ya rige plazos y
   tarifa (P18, §P.10); **(b)** **se puede corregir hasta que aceptamos comprar la etiqueta** —es decir,
   **hasta la aceptación**—, y después **es un caso de operación manual**, no un flujo del MVP.
   **Por qué no bloquea**: el **camino feliz** está completo y el dato existe desde el día 1; esto solo fija
   **el borde**. **Costo de equivocarse**: bajo y acotado a **una etiqueta**.
29. **[ABIERTA — no bloqueante] «Igual que hoy pasa con la CLABE»: ¿la CLABE se queda en el paso de PAGO, o
   también se mueve a la creación de la solicitud?** *(**contradicción señalada**, no asumida; nace de
   **D36**, §P.2.1)*
   **La contradicción, dicha tal cual**: la decisión D36 se apoya en que **la CLABE ya bloquea la creación de
   la solicitud**. **En este documento no es así**: la **CLABE y el INE se piden en el PASO DE PAGO del
   buylist** (criterio **14**, §E, **M6**). Lo único que hoy bloquea la creación es el **celular** (D11), el
   **mínimo** (D18) y, desde esta ronda, la **dirección** (D36).
   **Qué se hizo**: **la dirección se redactó como el humano la decidió** (bloqueante al crear) y **la CLABE
   se dejó EXACTAMENTE como está**, porque moverla **sería alcance nuevo** que él no pidió explícitamente.
   **Qué debe confirmar el humano**: **(a)** era **solo una analogía** y la CLABE **se queda en el pago**
   —**supuesto tomado**—; **o (b)** también quiere **la CLABE al crear la solicitud**, y entonces hay que
   decidir **qué pasa con el INE**, que hoy viaja con ella (se pide **sobre el tope**, en el pago, y **se
   verifica contra el nombre de la CLABE**).
   **Por qué importa aunque no bloquee**: si la respuesta es **(b)**, cambia **cuándo se piden datos
   bancarios** —antes de saber si le compramos— y **toca el flujo de KYC/AML**, que es de los pocos con
   implicación legal. Si es **(a)**, **no hay nada que hacer**: el documento ya está correcto.

**Los tres huecos de la octava ronda (30–32) — con supuesto tomado; ⚠ la 31 quedó CERRADA en la 9ª ronda,
la 30 y la 32 siguen abiertas:**
30. **[ABIERTA — no bloqueante] ¿Los TÉRMINOS publican la cifra del envío, o también la dicen en palabras?**
   *(nace de **D43**, §H)*
   **El hueco**: D43 saca la cifra **del cotizador** y la deja **en la oferta**. Pero D31 manda decir la
   regla en **tres** superficies, y la tercera son **los términos**. Si los términos publican
   **«MX$180»**, entonces *«el correo de oferta es la primera vez que ve la cifra»* —el argumento con el que
   ese correo repite el monto y tiene prohibido dar nada por sabido— **es cierto solo en la práctica**, no
   por construcción.
   **Supuesto tomado**: los términos **dicen la regla** («el envío lo ponemos nosotros y su costo siempre se
   deduce») **y no publican la tarifa como cifra**, por coherencia con D43 y porque **la tarifa es un dial**
   —publicarla la vuelve una promesa que después hay que mantener o corregir—.
   **Qué confirmar**: **(a)** los términos van sin cifra —supuesto—; **o (b)** sí llevan la cifra, y
   entonces hay que decir **cómo se etiqueta** para que no se lea como precio garantizado (*«tarifa vigente,
   sujeta a cambio; la que aplica a tu venta es la de tu oferta»*).
   **Por qué no bloquea**: en los dos casos **el cotizador y la oferta quedan igual**; solo cambia una página
   estática.
31. ~~**[ABIERTA — no bloqueante] Hay DOS decisiones del arquitecto (D41 y D42) que NO están en este
   documento.**~~ **[CERRADA en la 9ª ronda — el humano contestó: SÍ, van en este documento]**
   *(hallazgo de la 8ª ronda)*
   **Respuesta**: **las dos se formalizan como requisito de negocio aquí**. **D42** —*«tras cancelar una
   oferta ya enviada, el portal dice que hubo una oferta, que se canceló y cuándo; el motivo interno no»*—
   queda en **§P.3**, **§P.11** y el criterio **176** (decisión **104**). **D41 NO estaba muerto**: lo que
   murió fue **la propuesta amplia** del arquitecto (publicar los diales); **queda vigente su versión
   acotada** —*«el cotizador conoce el mínimo y solo el mínimo; la tarifa de envío no se publica»*— en
   **§E**, **§H** y el criterio **177** (decisión **105**). **El supuesto que este documento había tomado
   —«no se formalizan aquí» y «D41 se da por muerto»— queda SUPERADO.** *(Se conserva el texto original
   abajo como historial.)*
   **Qué pasa**: la numeración de decisiones del ciclo llega a **D40** aquí, y el bloque nuevo entra como
   **D43**. Los números **D41** y **D42** existen en documentos del arquitecto —**D41** fue una propuesta
   suya que él mismo retiró (publicar diales al cotizador), y **D42** resuelve que **el portal del vendedor
   no se quede mudo después de cancelarle una oferta**—.
   **Por qué importa**: **D42 es requisito de negocio, no diseño** —es *«qué ve el vendedor cuando le
   cancelamos»*—, y es **el hermano de pantalla del correo 5** que esta ronda acaba de crear. Si vive solo en
   documentos del arquitecto, **este documento no manda sobre él**, que es justo lo contrario de la regla de
   conflicto.
   ~~**Supuesto tomado**: **no se formalizan aquí** —no me los pediste y **inventar su alcance sería peor**—,
   y **D41 se da por muerto** (superado por D43).~~ **⚠ SUPERADO en la 9ª ronda: se formalizan las dos, y
   D41 vive acotado.**
   ~~**Qué confirmar**: ¿quieres que **D42 se redacte como requisito en este documento** —«tras una
   cancelación, el portal del vendedor dice qué pasó y que su solicitud sigue viva»—, o lo dejas como
   decisión de diseño del arquitecto? *(Si lo quieres aquí, es **una ronda corta**: el hecho ya está
   decidido y el correo 5 ya lo afirma; faltaría solo la superficie.)*~~ **⚠ CONTESTADO: va en este
   documento, y fue exactamente «una ronda corta» — solo se agregó la superficie.**
32. **[ABIERTA — no bloqueante] ¿El correo 5 debe decir algo sobre QUÉ SIGUE, o basta con «tu solicitud
   sigue viva»?** *(nace del correo nuevo, §P.3)*
   **El hueco**: el correo 5 tiene **prohibido** el CTA de «cotiza de nuevo» (duplicaría una solicitud
   abierta) y **prohibido** el motivo interno de la cancelación. Queda entonces sin decir **cuándo** vuelve a
   saber de nosotros.
   **Supuesto tomado**: dice **que la volvemos a revisar** y lleva a **ver su solicitud**, **sin prometer una
   fecha**. Prometer *«te contestamos en 7 días hábiles»* **sería exponerle nuestro plazo interno de
   caducidad**, y ese plazo **corre contra nosotros**: convertirlo en promesa pública cambia su naturaleza.
   **Qué confirmar**: ¿te sirve el supuesto, o prefieres que el correo **sí le dé un horizonte**?
   **Por qué no bloquea**: es **una frase** del mismo correo, en cualquiera de las dos versiones.

**Hueco abierto al fusionar (33) — nace del hallazgo de QA sobre el criterio 128(b):**
33. **[ABIERTA — no bloqueante] ¿El alta de STAFF debe pedir celular por alguna razón que no sea D11?**
   *(nace de precisar el **criterio 128(b)**, 2026-09-05)*
   **El hueco**: el alta desde el back-office es **una sola puerta para los tres roles** (`customer`,
   `vault_operator`, `super_admin`). **D11 solo justifica el celular del CLIENTE** —existe para **poder
   llamar al vendedor** (D12)—, así que el criterio 128(b) quedó precisado a **la rama de cliente**. Pero eso
   **no responde** si el staff debe dar teléfono por **otro** motivo: **contacto interno**, **2FA** o
   **recuperación de cuenta**. Ninguno de los tres es D11 y **ninguno está decidido en este documento**.
   **Supuesto tomado**: **NO se le exige** celular al staff. Motivo: **exigir un dato que ningún requisito
   usa es fricción sin beneficio**, y **«Usuarios y roles» no describe ninguna pantalla de alta de staff** —
   inventarle reglas sería inventar alcance.
   **Qué confirmar**: **(a)** te sirve el supuesto —el celular es **obligatorio solo para clientes**—; **o
   (b)** quieres que el staff también lo dé, y entonces hay que decir **para qué** (de ahí sale si es
   obligatorio, si se valida y si se puede cambiar solo).
   **Por qué no bloquea**: **el (c) del criterio 128 ya cierra el hueco de negocio** —nadie llega a vender
   sin teléfono— y **ninguna cuenta de staff vende**. Es un dato de conveniencia interna, no de dinero.
