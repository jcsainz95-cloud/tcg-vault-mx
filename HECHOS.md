# HECHOS — TCG HUNT

> **Qué es este fichero:** lo que el dueño ya estableció y **no se vuelve a preguntar**, más los hechos de
> infraestructura **medidos** (con fecha y cómo). Toda sesión lo lee al arrancar, antes que `PENDIENTES.md`.
> Se edita solo cuando el dueño cambia un hecho o una medición nueva lo refuta (regla O-2). Un hecho sin fecha
> ni fuente no entra aquí: va a `PENDIENTES.md` como «NO MEDIDO».
>
> Última revisión: 2026-09-11 (orquestador, sesión 2: añadida la decisión sobre la contraseña temporal). Origen: sección «HECHOS DEL NEGOCIO» de `PENDIENTES.md`, movida aquí.

> Esta sección existe porque el orquestador preguntó **cinco veces** lo mismo. Un hecho que el dueño ya
> estableció y que un agente vuelve a preguntar **le gasta su tiempo y le hace repetirse**. Antes de
> preguntarle cualquier cosa, se lee esta lista (regla **O-6**).

| Hecho | Establecido | Consecuencia operativa |
|---|---|---|
| **La tienda SIEMPRE ha estado en modo prueba de Stripe. NO se ha transaccionado dinero real. Se pasa a modo real cuando cierre todo.** | 2026-09-10 (repetido 5 veces por el humano) | `STRIPE_SECRET_KEY = sk_test_…` en producción **es correcto y deliberado**. ⛔ NO es una emergencia, NO hay ventas perdidas, NO se revierte. El cambio a `sk_live_…` —y el `whsec_` del endpoint de modo real, que es **distinto**— es un paso del **cierre**, no de hoy. |
| **No hay staging. Solo producción.** | 2026-09-10 | ⛔ No se piden credenciales de staging. El blanco de seguridad es **local**. |
| **Las claves de PRUEBA de Stripe YA ESTÁN en los secrets de GitHub** (`STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_PUBLISHABLE_KEY`), desde el **2026-09-07**. | 2026-09-10, con captura | ⛔ **NO se le vuelven a pedir.** El gate de dinero **puede correr**. Ver el error de medición abajo. |
| **El repositorio es PÚBLICO.** | briefing original | Ningún secreto, ni de mentira, puede vivir en el árbol. |
| **La contraseña temporal (reseteo por el admin) OBLIGA a cambiarla antes de dejar operar.** Decisión textual: «Que obligue a cambiarla». | 2026-09-11 (sesión 2, al presentarle P-75) | `mustChangePassword` pasa de aviso sin consecuencia a **bloqueo**: el contrato define el guard y el error (`docs/API_CONTRACT.md`, Stream A); el frontend lleva al usuario a la pantalla de cambio y no le deja esquivarla. No se vuelve a preguntar. |
| **La verificación de identidad (KYC) es un acto del dueño, no del operador.** Decisión textual (2026-09-11): «solo yo las veo, con motivo de rechazo, y quita los topes pero siempre quiero poderlas verificar para checar con dirección de envío». | 2026-09-11 (sesión 2, al medir que nadie puede abrir una INE) | (a) Las imágenes de INE las ve **solo el super administrador**, nunca el operador de bóveda. (b) Rechazar exige **motivo**, y el motivo le llega al cliente para que vuelva a subirla. (c) Los **topes dejan de mostrarse al cliente** (pantalla y mensaje de error): son política interna. (d) La vista de revisión muestra la INE **junto al nombre y las direcciones del cliente**, para cotejar identidad contra destino de envío. No se re-pregunta. |
| **Las compras a BÓVEDA entran en «Pedidos a preparar» con su propia cubeta, y el cajón se propone «junto a sus otras cartas».** Palabras del dueño: «falta la parte de separar los pedidos que van a las bóvedas de los clientes, hay que meterlo; si no, físicamente cómo sabemos cómo y cuándo qué mover». Sobre el cajón eligió la opción (b) de `PROJECT.md §S.6`. | 2026-09-24 (sesión 4, al revisar la PR #62) | (a) La cubeta bóveda **se construye** (rama `claude/m4-boveda`; money zone: diseño → 3 veredictos). (b) El sistema propone el cajón donde **ya están las demás cartas de ese cliente**; cliente nuevo ⇒ sin propuesta, el operador elige la primera vez. (c) ⛔ **El apellido NO decide ningún cajón**: se descartan pedir apellido paterno, tomar el penúltimo y que el operador elija siempre. La pregunta paterno/materno **deja de estar abierta**. No se re-pregunta. |
| **Bóveda — lo físico es del dueño; el sistema dice de quién es y qué debe haber.** Palabras del dueño (2026-09-25), al preguntarle por muebles y numeración: «no te preocupes por eso, solo necesito que me digas nombre y apellido»; por cajones compartidos: «yo me encargo del aspecto físico». Aviso al cliente al guardar: **no**. Deshacer «preparado» si se marcó mal: **sí**. Antes (2026-09-24/25): un cliente = un cajón; espacio infinito; palomear y colocar juntos. | 2026-09-25 (sesión 4, preguntas P-B, P-C, P-E y «deshacer preparado» de `docs/API_CONTRACT.md §M4-VAULT.9`) | (a) La pantalla nombra al cliente por **nombre y apellido** en primer plano (el correo queda como desempate entre homónimos). (b) El sistema **no** vigila muebles, numeración ni cajones compartidos: ni `422` de exclusividad ni cambio de unicidad de etiquetas. (c) Sin aviso al cliente al colocar. (d) Existe un verbo para **deshacer «preparado»** mientras la colocación siga pendiente. Siguen con su valor por defecto, sin preguntar: envío antes de guardar = permitido (como hoy); cliente que vació su bóveda = cuenta como nuevo. No se re-pregunta. |
| **El operador puede ver la dirección completa del cliente (con calle) en «Pedidos a preparar».** Palabras del dueño: «sí, el operador puede ver la dirección». | 2026-09-25 (sesión 4, condición 1 de la PR #62, pedida por seguridad) | La tarjeta por pedido muestra la dirección completa de envío al rol operador. Cierra la condición 1 de la PR #62. No se re-pregunta. |
| **Imagen de cada deck de Meta Battle Decks: la portada que usa Limitless; y con dos nombres manda el primero.** Pedido del dueño (2026-09-25): «en las imágenes hay que poner la EX representativa del deck», «no cualquier carta en los decks». Decisiones (2026-09-28): cuando no se encuentra la carta principal (no está en catálogo, o deck tipo «Basic Box») ⇒ **usar la portada de Limitless**; deck con dos Pokémon donde solo el segundo es ex («Alakazam Mew») ⇒ **el primero nombrado**. | 2026-09-28 (sesión 4, tras el veredicto de QA de `claude/arreglos-rapidos`) | (a) La imagen sale de la carta que Limitless usa como portada (`leader-image`), casada con nuestro catálogo; requiere diseño del arquitecto (toca schema o contrato). (b) La regla por nombre queda de respaldo y prioriza el **primer** Pokémon nombrado, sea ex o no. (c) La elección manual del admin sigue ganando. No se re-pregunta. |
| **Preparar pedidos de ENVÍO — decisiones tras la auditoría del recorrido del operador.** (1) Si al preparar un envío **falta una carta o viene dañada**: «Reembolsar solo esa carta» — el pedido sigue con las demás, se reembolsa lo pagado por esa carta y se avisa al cliente. (2) **Quién reembolsa**: «También el operador» (queda registrado quién). (3) **Cancelar un envío pagado a mano: NO existe** — «no se puede cancelar, ¿estamos dando la opción?»; se **quita** el botón «Cancelar» del operador en envíos pagados; se conservan las cancelaciones automáticas (pago fallido, contracargo). (4) Nombre de la sección: «Pedidos por preparar». | 2026-09-29 (sesión 4, tras la auditoría E2E del operador sobre production a2da420) | Zona de dinero (reembolso parcial; el operador pasa a poder mover dinero ⇒ cambia la política `@MoneyOut` hoy solo super_admin — revisión de seguridad obligatoria). Diseño del arquitecto y tres veredictos. No se re-pregunta. |
| **Preparar envíos — respuestas a D-1..D-4 del diseño §M4-SHIP (2026-09-29).** D-1 importe de la carta faltante en un envío: «$314.58: la carta más su parte de la comisión». D-2 carta faltante en un RETIRO de bóveda: «En teoría no debe pasar este caso y la buscamos reemplazar; déjame el botón de lo que vale en el mercado por si no la conseguimos». D-3 tope del operador en 24 h: «MX$5,000». D-4 carta faltante en una compra A BÓVEDA: «Tenemos que generar un apartado para estos casos porque puedo buscarla y reemplazar». | 2026-09-29 (sesión 4) | (a) Envío directo: reembolso de la carta con su parte de comisión (default del diseño). (b) Faltantes de BÓVEDA (retiro y compra a bóveda) NO se reembolsan automáticamente: van a un **apartado «por reponer»** donde el dueño busca otra copia y la sustituye; en el retiro, un botón para reembolsar **al valor de mercado** si no se consigue. (c) Tope operador 24 h = MX$5,000 (dial). No se re-pregunta. |
| **«Por reponer» — respuestas a D-5..D-10 (2026-09-29).** (a) «Dañada» se trata igual que «faltante» en todos los flujos («la carta que tenemos está dañada es el mismo caso para cuando falta»). (b) Monto del reembolso en casos de BÓVEDA (retiro y compra a bóveda) cuando no se consigue reponer: **lo captura el dueño** («yo busco lo que vale y capturo»), no se calcula solo. (c) Si ese monto supera lo que queda del cobro en Stripe: «se genera un reembolso que haga lo SPEI manual yo; tenemos que aventarlos a una cubeta nueva» ⇒ lista nueva de reembolsos manuales por SPEI que el dueño paga y marca como pagados. (d) Retiro con carta por reponer: esperar y mandar todo junto. (e) Plazo para reponer: **7 días**, luego el caso se marca vencido y avisa en el tablero; nada se reembolsa solo. (f) D-8 y D-10 no preguntadas: quedan los defaults (el operador puede reponer; solo el dueño reembolsa desde «Por reponer»; sin aviso al cliente al abrir un caso de compra a bóveda). | 2026-09-29 (sesión 4) | Cambia §M4-SHIP v1.80.1: el reembolso de caso pasa de «mercado automático / lo pagado» a **monto capturado por super_admin**, acotado; excedente sobre el cobro ⇒ cubeta SPEI manual. No se re-pregunta. |
| **Reembolsos manuales (SPEI) — D-11 y D-12 (2026-09-29).** D-11 al marcar pagada una transferencia: «Solo marcar si se realizó y quién» (sin clave de rastreo obligatoria ni comprobante). D-12 topes contra errores de dedo: «Sí, así» — más de 2× max(pagado, mercado) ⇒ volver a escribir el monto; más de 5× ⇒ bloqueado (el 5 es ajuste). | 2026-09-29 (sesión 4) | `ManualRefund` pagado = marca + actor + fecha; clave de rastreo y nota opcionales. No se re-pregunta. |
| **Reembolsos de operador — D-13 y D-14 (2026-09-29).** D-13 cómo se entera el dueño de cada reembolso de operador: «Solo verlo en el panel» (sin correo AVA-1). D-14 botón para abrir «Por reponer» desde inventario: «Por ahora no». | 2026-09-29 (sesión 4) | Se retira el correo interno AVA-1 del diseño; queda la sección de reembolsos por operador y el contador del tablero. No se re-pregunta. |

## ⚠️ ERROR DE MEDICIÓN DEL EQUIPO — «los tres flujos de dinero nunca se han ejecutado»

**Es FALSO, y lo afirmamos cinco pases seguidos.** Lo midió el orquestador el 2026-09-10:

- Run **`34477885121`** (`e2e-real.yml`, nocturno, 2026-09-10 12:38 UTC, sobre `main` = `5f05b08`): **success**.
  - Paso 4 «Preflight Stripe — clasificar las claves de PRUEBA por su FORMA» → **success**
  - Paso 15 «**Playwright smoke — flujos críticos (REAL)**» → **success**
  - Variable de salida del job: **`MONEY_SKIPPED:` (vacío)** ⇒ **no se saltó nada**.

⇒ **Los flujos de dinero SÍ corren, y corrieron hoy, con las claves reales de prueba.**

**Causa del error, y es la lección:** QA y devops corrieron `scripts/stripe-test-key-preflight.sh` **en la máquina local**, donde `STRIPE_TEST_SECRET_KEY` sencillamente no está definida — los secrets de GitHub **solo existen dentro de un runner de Actions**. El script contestó «secret NO configurado en GitHub», que es lo único que podía contestar, y **el equipo entero leyó una medición local como si fuera una medición de GitHub**. El orquestador la relayó al humano cinco veces sin comprobarla.

> **Es la regla O-1 al revés:** no afirmé un estado sin medirlo — **acepté la medición de otro sin comprobar
> que medía lo que decía medir**. Un preflight corrido en el sitio equivocado no dice «no hay clave»: dice
> «aquí no la veo».

**Lo que SÍ está pendiente, y es otra cosa:** ese run fue sobre **`main`**, no sobre el candidato. Correr
`e2e-real.yml` contra la rama es lo que certifica los tres flujos **de este release** — lanzado por el
orquestador el 2026-09-10.

- **La rama que despliega es `production`, no `main`** (medido 2026-09-11 con la API de deployments de GitHub:
  los commits de `production` —`e117441`, `538ab51`, `f04f2dc`— reciben deployment **Production** (Vercel) y
  **«marvelous-kindness / production»** (Railway); los de `main` —`5f05b08`, `3b36f19`— solo reciben **Preview**
  de Vercel). Fusionar a `main` **no publica**; `git push origin production` **sí**. Resuelve la contradicción entre
  `docs/DEVOPS_NOTES.md:2280` (decía `main`) y `:3313` (decía `production`): gana `:3313`. `vercel.json` construye
  ambas ramas, por eso `main` genera una vista previa. Árbol de `production` == árbol de `main` (`git diff` vacío).

- **Tres roles del equipo no pueden commitear nunca, por diseño de sus herramientas** (medido 2026-09-11:
  `.claude/agents/` — `arquitecto`, `ux-ui` y `product-owner` tienen Read/Grep/Glob/Write/Edit y **no** Bash;
  `backend`, `frontend`, `devops`, `qa`, `techlead`, `pentester` y `seguridad` sí la tienen). Consecuencia
  operativa para el orquestador: cuando uno de esos tres entrega, **su trabajo queda suelto en el árbol y el
  commit lo lanza el orquestador**, con `git commit -- <sus rutas>` y un mensaje que diga que lo escribió el
  agente y que el orquestador lo verificó. No es un incumplimiento de O-10 por parte del agente: es que no
  tiene la herramienta. Esperar su commit es esperar algo que no puede ocurrir.

## La tienda NUNCA ha procesado una venta real (dueño, 2026-09-14)

Establecido por el dueño, literal: **«no hay pedidos viejos, la tienda no ha procesado ninguna venta
real»**. No se re-pregunta.

**Por qué está aquí y no en PENDIENTES:** borra de un plumazo una clase entera de restricciones de
diseño que este proyecto ha estado respetando.

- **El escalonado «deploy 1 / deploy 2» del IVA pierde su motivo.** El código dice literalmente que
  bajo `IVA_EXCLUSIVE` «el P&L queda bit a bit el de hoy» (`common/money.ts:492`) y que la rama
  `IVA_INCLUSIVE` «en el deploy 1 es INALCANZABLE» (`admin.service.ts:452`). Esa cautela existe para
  no mover el desglose de pedidos ya cobrados. **Si no hay pedidos cobrados, no hay nada que no mover.**
- **La pregunta «¿qué pasa con los pedidos viejos?» deja de existir.** No hay migración de datos, no
  hay dos convenciones conviviendo en el historial, no hay factura emitida con un desglose que
  contradiga el nuevo.
- **Toda ficha que diga «cuidado con los pedidos vivos» hay que re-medirla** antes de enrutar trabajo
  desde ella (O-5).

⚠️ **Lo que este hecho NO dice:** no dice que la columna `Order.priceConvention` sobre, ni que el
escalonado fuera un error. Dice que **su restricción ya no aplica**. Que el diseño siga siendo el
correcto es una pregunta abierta, no una conclusión — y es exactamente lo que el dueño pidió revisar:
*«puede que ya no sirva»*.

**Medido por el orquestador el 2026-09-14**, sobre `ce7017b`, para acompañar el hecho:
`priceConvention` es NOT NULL y sin `@default` en `schema.prisma:1160`; **siete** sitios de producción
la escriben y **los siete** ponen `IVA_EXCLUSIVE`; **cero** escriben `IVA_INCLUSIVE`; no existe dial en
`settings` que la cambie; y el frontend **no conoce** ni `ivaIncluded` ni `priceConvention`
(`grep` ⇒ 0 fuera de pruebas).
