# PENDIENTES — TCG HUNT

> **Cómo se usa (regla O-5):** un pendiente **afirma su fecha de medición o no afirma nada**. Antes de enrutar
> trabajo a partir de uno, **se re-mide** (el comando o `fichero:línea` de la columna «Comprobación» es por dónde
> empezar). Lo cerrado se mueve a `HISTORIAL.md`; los hechos del negocio viven en `HECHOS.md`.
> Última limpieza: **2026-09-15** (orquestador, sesión 2, cierre; ver sección nueva abajo). Cuerpos de los ítems históricos: **verbatim**, sin reescribir.

## ✅ PUBLICADO #38 (2026-09-17) — producción `187b1d40`

El dueño fusionó `claude/orq4-integracion-verificada → production` (camino de un botón). **Producción contiene los
6 arreglos** (medido: la rama consolidada es ancestro de `origin/production`). ⚠️ **`main` quedó atrás en contenido**
(esperado): las ramas nuevas se basan en `origin/production`. Sincronizar `main` es higiene pendiente (el orquestador
no puede empujar a `main`; se hace en un PR `production→main` o el dueño lo hace).

**Verificar en tienda (post-publicación):** (1) rechazar INE ⇒ buylist bloqueado hasta re-subir; (2) «Precio ofertado»
muestra el cotizado; (3) sellado en cola M1 muestra su nombre; (4) pedido muestra la calle.

## 🔴 S3-SELLADO-M1 — racimo de problemas del SELLADO en M1 (dueño en su tienda, 2026-09-17; parcial medido por el orquestador)

El dueño, probando M1 → pestaña **Sellado** en producción, reportó (con capturas) cuatro cosas del sellado. Stream *Inventario y vault* (módulo `inventory`, frontend `(admin)/admin/m1`). Es zona de dinero ⇒ el arreglo de código va con los **3 veredictos**.

- **(A) «Agregué un booster bundle y no sale» — CAUSA MEDIDA + arreglada (display).** No falló ni se envió: **el botón «Dar de alta» estaba deshabilitado en silencio**. Producto sin mercado ⇒ «Aportación» deshabilitada ⇒ solo «Comprar»; «Comprar» con precio pagado **vacío** ⇒ `priceInvalid` ⇒ CTA `disabled` **sin decir por qué** (`QuickAdd.tsx:100,107-108,319,351`; el aviso solo salía con texto en el campo, `:295`). No hubo POST. **Con precio de compra válido SÍ se crea** (`in_stock`, `inventory.service.ts:614-631`), cae en «Listas para publicar» (`missing:['price']`) y aparece en el set. ✅ **Arreglado en rama** `claude/investiga-sellado-m1` (`d31a77d0`): el CTA apagado ahora muestra el motivo. **Unblock inmediato del dueño: capturar el PRECIO PAGADO.** 🔒 **Decisión del dueño (2026-09-17): NO se publica suelto — los arreglos de display (A muestra motivo, C subtipo en drawer, rama `claude/investiga-sellado-m1`) se ENTREGAN JUNTO CON M11.** El build de M11 debe incorporarlos (mismos ficheros `QuickAdd.tsx`/`VariantDrawer.tsx`).
- **(B) Editar / quitar de publicado el sellado — SÍ existe hoy, es discoverabilidad.** ✅ **Medido**: «Ver piezas» (`SealedTab.tsx:355`) abre el `VariantDrawer` con editar precio (`:424-431`), publicar (`:593-604`) y **despublicar** (`:419-422,582-591`); `PATCH …/items/:id` cableado. **No falta mecanismo — «Ver piezas» no suena a «editar».** UX/rótulo (ver E). No tocado.
- **(C) Formato/subtipo — NO se pierde en datos; faltaba en una vista. Parcial arreglado.** ✅ Medido: el alta lo persiste (`inventory.service.ts:782`) y el detalle del set lo pinta (`SealedTab.tsx:284-285`). Faltaba en el encabezado del `VariantDrawer` → ✅ **arreglado** (`d31a77d0`, ahora «SELLADO · BUNDLE»). ⛔ Falta también en la cola «Listas para publicar» (`PendingPublishRowDTO` sin `sealedSubtype`, `contract.ts:2741-2766`) ⇒ **contrato+backend → gates**.
- **(D) Sellado «SIN PRECIO DE MERCADO» — CORREGIDO (dueño lo refutó, O-2): el precio EXISTE pero el DIAL lo apaga.** El dueño ve «referencia informativa (última conocida) MX$601.72» y que **no lo deja meter como aportación**. Medido: `gateSealedMarketCents(ref, sourceOn)` (`pricing.service.ts:1763`) devuelve `null` para precio de **fuente automática** cuando el dial **`sealed_price_source` está `off`** (seed off, «hasta el flip» — `scheduler.service.ts:209`, `sealed-price-ingest.service.ts:31,57`). Sin precio efectivo ⇒ aportación deshabilitada (la UI lo dice: «captura el precio manual de arriba para habilitarla»). **Excepción medida:** un **override manual** (`source='manual'`, «FIJAR PRECIO») **sobrevive al dial** y sí habilita aportación (`pricing.service.ts:1774`). ⛔ **NO MEDIDO: estado vivo del dial en prod** (no alcanzo la BD; consistente con `off`). **Salidas:** (a) inmediato/seguro: capturar «PRECIO DE MERCADO MANUAL (FIJAR PRECIO)» por pieza; (b) encender `sealed_price_source` = decisión money global ⇒ **es uno de los dials que van en la pantalla `M-Sellado` (E)**; su encendido va por revisión. (P-46 = por qué Chaos Rising no tiene fila de fuente, sigue aparte.)
- **Para gates (backend):** falta la prueba del **alta de sellado por COMPRA exitosa** (`inventory.sealed-product-alta.spec.ts:390`: los casos `'compra'` eran todos rechazos 422). + (C-cola) + (D).

- **(E.2) DUEÑO APROBÓ CONSTRUIR M11 funcional + P-46 (2026-09-17): «dale a las dos que quede funcional ese apartado».** Alcance ampliado para que el sellado TRAIGA precios desde M11: (a) botón **«Traer precios ahora»** (reusa `POST /admin/jobs/sealed-price-ingest`, ya existe — `admin-jobs.controller.ts:217`); (b) **vista de estado por set**: con precio / emparejado sin precio / SIN emparejar; (c) **mapeo manual** de un set a su grupo TCGCSV (escape de P-46 cuando el emparejador por nombre falla — el ingest ya acepta `{groupId}` acotado). **P-46** (emparejador `tcgcsv-group-match.ts`, prefijo «SV08:») se arregla para que emparejen solos; el mapeo manual lo hace funcional aunque el matcher falle. ⚠️ **Egress a tcgcsv.com BLOQUEADO aquí (O-17):** el jalón real de precios solo corre en producción; construyo botón+vista+mapeo y el fetch en vivo lo dispara el dueño. Money ⇒ **3 veredictos**. Secuencia: arquitecto amplía diseño → backend+frontend → gates.
- **(E.1) Decisiones del dueño (2026-09-17) para `M-Sellado` (propuesta `M11`):** (D-2) **editar los 6 dials de sellado AQUÍ**, un solo lugar; **DECIDIDO por el dueño (2026-09-17): SÍ sacarlos de M2/M10** — M11 es el único editor de esos dials (arquitecto diseña la migración). (D-3) **dar control en pantalla al interruptor maestro `sealed_price_source`** (hoy sin UI en ningún lado). (D-4) **operador de bóveda publica; super-admin toca los dials**. (D-5) **convive con la pestaña Sellado de M1 por ahora** (no la sustituye aún). (D-1 número: default `M11`; D-6 alcance: completo). Los 6 dials medidos por el PO: `sealed_price_source` (maestro, `settings.constants.ts:118`), `pricing_provider_sealed` (`:106`, M10), `sealed_value_trend` (`:144`), `sealed_restock_alerts` (`:145`), `sealed_spread_pct_by_subtype` (`:139`, M2), `sealed_spread_fallback_pct` (`:140`, M2). Borrador de alcance: `docs/specs/M_SELLADO_SCOPE_DRAFT.md` (rama `claude/po-m-sellado-draft`, `a65e4cbf`). **Siguiente:** arquitecto diseña → backend+frontend → 3 veredictos.
- **(E) DECIDIDO por el dueño (2026-09-17): pantalla dedicada de Admin para el sellado.** Textual: «Dale un apartado en ADMIN M algo y ahí mete todo lo necesario para controlar la **ventana de publicación**. Tienes que **respetar todo el tema de pricing**. En esa misma pantalla **mueve los dials de pricing de sellado** para tenerlos a la mano.» ⇒ **Nueva pantalla `M-Sellado`** que consolide: alta + editar + publicar/despublicar + ver formato/precio (reusa lo ya medido: `VariantDrawer`, `SealedTab`, `PATCH …/items/:id`) **y** los **dials de pricing de sellado** (identificar cuáles: fuente/`gateSealedMarketCents`, provider — ver M10). Es FUNCIÓN money-touching ⇒ **product-owner (alcance) → arquitecto (diseño/contrato) → backend+frontend → 3 veredictos**. NO se construye a ciegas.

**Dueño:** backend (A, B-back, D) · frontend (B-ui, C) · **product-owner → arquitecto (E, la sección dedicada)**. **Comprobación:** reproducir el alta y las vistas contra el arnés. | 2026-09-17 (dueño lo vivió; A/C no medidos, B/D parcial medido por el orquestador) | capturas del dueño; `inventory.controller.ts:549`; `ItemDetailModal.tsx`; `VariantDrawer.tsx:419`; `inventory.service.ts:576,663,734`

## ✅ M11 · Sellado — LISTA PARA PUBLICAR (2026-09-17) — rama `claude/m11-final`

**ENTREGADO `claude/m11-final` (`d42c0c6d`, base `origin/production`, 36 ficheros +2784/−40, CERO migraciones).** Los 3 filtros satisfechos: techlead APROBADO-c/deuda, seguridad APROBADO-CON-CONDICIONES (0 crít/0 alto), QA — su ÚNICO bloqueante (`C-EQ-1`/eje `state`) CERRADO y verde (backend agente 311/311; árbol final byte-idéntico a esa rama). **O-9 del orquestador sobre el árbol final:** tsc limpio, M11 vitest 28/28, candado de rol MUERDE (mutación `if(false)` ⇒ 1/3 falla), composición verificada (backend==fix-be, frontend==fix-fe). Compare: `production...claude/m11-final`. Deuda diferida (no bloquea): SB-YEAR1 (arquitecto §8), N+1 sealed-price-status, SEC-M11-3/4/5, y el S3-local del CI (devops, ambiental, NO de M11). ⚠️ Jalón real de precios = prod (tcgcsv bloqueado aquí). 

Diseño (arquitecto): `docs/specs/M11_SELLADO_DESIGN_DRAFT.md` (rama `claude/arch-m11-precios`). **Construido:** backend `claude/be-m11-sellado` (`c059c4e9`, unit 5337/5337, canarios muerden; integración la corre QA) + frontend `claude/fe-m11-sellado` (`185a4ddc`, vitest 1877/1877, paridad es/en 3043=3043, incluye los display fixes de sellado). **Integración:** `claude/m11-integracion` = `fafe7461` (be+fe disjuntos, merge limpio; 33 ficheros, +2402/−29). **Veredictos sobre `fafe7461`:** techlead **APROBADO-con-deuda**; seguridad **APROBADO-CON-CONDICIONES** (0 crít/0 alto; SECURITY_NOTES en `claude/sec-m11` `8009a612`); **qa RECHAZADO** por UN bloqueante: BLOQUEANTE-1 = el `@Query('state')` del nuevo endpoint es un eje enum NO registrado en el censo `C-EQ-1` (familia EQ-D1) ⇒ 1 roja de integración (975/976). QA verde en todo lo demás (unit 5337/5337, front 1877/1877, smoke HTTP 10/10, 403 por rol confirmados, canarios de dinero muerden). **En arreglo (pasada única):** `claude/m11-fix-be` (registrar eje `state` + canario emparejador IMPORTANTE-3 + tx SEC-M11-1) y `claude/m11-fix-fe` (reforzar canario de rol IMPORTANTE-2 + alinear nombre DTO). Luego re-integro y re-corro QA. Deuda diferida (no bloquea): N+1 de sealed-price-status, SEC-M11-3/4/5.
- **Endpoints nuevos:** `GET /admin/inventory/sealed-price-status`, `PUT .../sealed-sets/:setId/set-main-group` (reemplaza), `DELETE .../groups/:groupId` (unlink). + `sealedSubtype` en `PendingPublishRowDTO`. + P-46-bis (matcher del sellado reusa `matchTcgcsvGroupByName` con política estricta).
- **A vigilar en los gates:** cambio de conducta sin prueba (mismo nombre+año distinto ⇒ `null`); 403 por rol ejercitados por HTTP; contrato mirror (`sealedPriceSource`/`sealedValueTrend`/`sealedRestockAlerts` + enums nuevos) coherente entre `API_CONTRACT.md` y `contract.ts`.
- ⚠️ **Jalón real de precios = solo prod** (tcgcsv bloqueado aquí); el dueño enciende el maestro + «traer precios» tras publicar.

## ✅/🔧 S3-INE-PII — NO hay fuga; la X roja del CI es un hueco de SIEMBRA/ALMACENAMIENTO (devops). Corregido 2026-09-17

⚠️ **Falsa alarma del orquestador, corregida (O-2).** Yo inferí una posible fuga de la ruta de INE en `/admin/users`
leyendo **una anotación del CI** («K-2 rojo»), sin correr la prueba. Un agente backend levantó el **stack sembrado**
y midió sobre `origin/production` (`187b1d40`): **NO hay fuga.** `/admin/users` y `/admin/users/:id` devuelven
`ineOnFile: boolean` (sí/no), **nunca** la object-key; hay 3 listas blancas que lo impiden
(`admin.service.ts:841-849`, `:96-120`+`:410-440`, `:500-607`). Candado K-2 ya puesto en producción (commits
`c80bc267`, `bec269b6`, ancestros de prod). Medido: `kyc-ine-links.e2e-spec.ts` §M6-K **23/23 verde, K-2 verde 3/3**.
- **Lo que SÍ está roto (otra cosa, dueño devops):** en la 1ª corrida SIN sembrar el bucket, falla **1** test —**G-3**,
  no K-2— porque la **imagen del fixture no estaba en el object storage** (`kyc-ine-links…:515`; el seed la sube en
  `seed-e2e.ts:1070-1122` pero ante `S3_ENDPOINT` ausente/`PutObject` fallido deja filas sin objetos). Es
  entorno/siembra bajo `STRICT`, **no** una fuga. ⛔ **NO MEDIDO: por qué el runner del CI no siembra el bucket.**
  Cierra: devops hace que el runner suba las imágenes de fixture (o re-siembra) ⇒ `backend-e2e` en verde.
- **Consecuencia #38:** la X roja que vimos al fusionar **no era un defecto de código** ni lo introdujo #38. Publicar
  estuvo bien. Dueño ahora: **devops** (siembra/almacenamiento del CI).

## 🟡 P-53 · cura — DISEÑO listo (arquitecto, 2026-09-17), pendiente implementar + 3 gates

Borrador en `docs/specs/P53_CURE_DRAFT.md` (rama `claude/arch-p53-cure`, SHA `62d83c7f`, basada en `origin/production`).
Diseño: escribir fila de precio **solo cuando `priceUsdCents` cambia** (no MXN — el MXN deriva de la FX diaria); días
sin cambio solo avanzan `evidenceDate`; `stale() := evidenceDate ?? capturedDate` (seguro: hoy `evidenceDate=null` ⇒
cero cambio de conducta al desplegar; cierra deuda M43-D2). Series de valor: intactas (snapshots dedicados con
forward-fill, «no se fabrican puntos»); un arreglo de 1 línea para que el snapshot de set use FX viva (§4.1); y
`hasRecentIngest` debe pasar a leer `evidenceDate` o re-dispara el barrido en cada boot (§4.3). Incluye poda/dedup
SEGURA del mes acumulado (§6, con ventana+respaldo, sus propios 3 gates). CA-1..10 + pruebas T-1..10.
**Decisiones para el dueño (§13):** (1) confirmar que la gráfica de valor de set siga con FX diaria (recom. sí, queda
idéntica); (2) autorizar ventana+respaldo para la poda; (3) ¿cerrar frescura graded «al pie de la letra» ahora o
después (no urge). **Siguiente:** backend implementa (protocolo plano+prueba) → 3 veredictos. Dueño: backend
(`catalog`+`pricing`, zona compartida serializada) → qa+techlead+seguridad. | 2026-09-17 (diseño medido sobre prod) |
`docs/specs/P53_CURE_DRAFT.md`; `card-product-resolver.service.ts:217`; `pricing.service.ts:719-725`



**Rama consolidada:** `claude/orq4-integracion-verificada` (SHA `051e50cd`, árbol `4c85d57f`). Base = `origin/main`
(cuyo árbol es **idéntico** al de `production` — medido 2026-09-16). Integra **6 arreglos**, merge limpio, **sin
conflicto**, **sin cambios de BD** (cero migraciones). Verificado por el orquestador: paridad i18n es/en 2980=2980,
JSON válido, árbol del push idéntico al de la integración medida. Solo 3 ficheros compartidos entre ramas (contrato
+ i18n), todos coherentes.

| Rama | Qué cambia (llano) | Dinero | Verificación |
|---|---|---|---|
| `fix-ine-threshold-block` | Al rechazar una INE, el buylist queda **bloqueado** hasta re-subir (revierte D51) | **SÍ (lógica)** | **3 veredictos** (qa+techlead+seguridad) |
| `fix-bounty-prefill` | El campo «Precio ofertado» **muestra** el precio de mercado cotizado (display; no siembra override) | módulo buylist (display) | orquestador; test-guarda: sin tocar ⇒ emite derivado sin override |
| `fix-sealed-m1-display` | La cola de publicación pinta el **nombre del sellado**, no la carta ancla (P-79c) | módulo inventory (display) | orquestador; passthrough, test-guarda |
| `fix-envio-dir` | M4 muestra la **calle** del pedido | admin (display) | orquestador 1844/1844 |
| `ux-pulido` | Acento de estado «aceptada», badge INE, nota post-pago en checkout | frontend | orquestador |
| `fix-eqd1` | 4 filtros de query no-dinero a `parseEnumFilter` (400 fuera de dominio) | no-dinero | orquestador; ver ficha EQ-D1 |

**Publicar (2 fusiones en GitHub, mismo despliegue final):** (1) PR `claude/orq4-integracion-verificada → main`
(genera Preview de Vercel); (2) PR `main → production` (#38) → **publica**. Rollback: revertir la fusión #38 (sin BD
que deshacer). Seguimiento no bloqueante: E2E de concurrencia de INE cierra por CI; copy de `KYC_REJECTED` en
DESIGN_SYSTEM (ux-ui, menor).

⛔ **El orquestador NO puede empujar a `main`/`production`** (candado «Production Deploy» del entorno). El botón es
del dueño.

## Sesión 2 (2026-09-14/15) — pendientes vivos al traspasar

> Medidos por el orquestador de la sesión 2. Estado del árbol al cerrar: `origin/production` = `a108abf`
> (avisos + IVA **publicados**, PR #36 fusionado por el dueño); `origin/main` = `bb239c0` (+ logout + fix de
> precios, **sin publicar**; requieren **PR #37** nuevo porque el #36 ya se cerró); rama de trabajo
> `claude/tcg-hunt-orchestration-4` (docs actualizados). Detalle completo en `TRASPASO.md`.

| ID | Qué | Dueño | Medido el | Comprobación |
|---|---|---|---|---|
| **S2-VERCEL** | «Se generan demasiadas versiones». Cada push a `main`/`production` = un deployment; se acumulan (no rompen nada). `vercel.json` ya salta las ramas de trabajo. Vías: purgar deployments viejos (dueño, en Vercel) + `ignoreCommand` que no construya en cambios solo-`*.md`. Egress a Vercel bloqueado desde el entorno. **Primer encargo de la sesión 3.** | devops · dueño | 2026-09-15 | `vercel.json` (`ignoreCommand`); dashboard de Vercel |
| **S2-PUBLICAR** | Logout (SEC-CR-1) + fix de precios están en `main` sin publicar. Abrir **PR #37** `main→production` (el #36 ya se fusionó). | orquestador · dueño (botón) | 2026-09-15 | `git log origin/production..origin/main` = `bb239c0 e4439fd 05ca459` |
| **S2-PRUEBAS** | Las 15 pruebas del dueño en su tienda (dinero, IVA, correos, campana, logout, precios). En curso. Acompañarlo; las 5 que mandan primero. | orquestador · dueño | 2026-09-15 | historial sesión 2 (lista de 15) |
| **S2-BOTON** | 🔴 Botón de pago **gris** (dinero). Causas: `paymentInProgress` (sesión) o `payBlockedReason` (invitado: bóveda/upsell/email). Falta el **texto bajo el botón** (§15.9) que el dueño debe copiar. | frontend | 2026-09-15 (esperando dato del dueño) | `CheckoutView.tsx:381`; `GuestCheckoutView.tsx:183,439` |
| **S2-COMISION** | (a) **Desglosar** la comisión de Stripe en la pantalla del dial (hoy «Total que paga el comprador» mezcla IVA + comisión; el 124.69 está medido y es correcto: 116 + 8.69). (b) **Decisión del dueño SIN cerrar:** trasladar la comisión (paga 124.69) vs absorberla (paga 116). | ux-ui → frontend · dueño (decisión) | 2026-09-15 | `IvaTransferSection.tsx`; `iva-transfer.ts` (`grossUpTotal`) |
| **S2-RL1** | 🔒 **P-RL-1** (Alta, heredada, abierta). Login se rodea rotando `X-Forwarded-For`. Ya publicado. Se cierra con 6 peticiones a producción **en ventana autorizada** — el dueño dijo **«no la midas aún»**. Tracker = entrada **más a la derecha**. Corrección a devops: `edge-xff-probe.sh` dice «penúltima», es la última. | seguridad · dueño (ventana) | 2026-09-15 | `actor-throttler.guard.ts`; `main.ts` (`trust proxy`) |
| **S2-PRECIOS22** | 🃏 Fix rescata con certeza S&V, Sword & Shield, XY, Pokémon GO, Pokémon Futsal. **Evolutions** sigue pending a propósito (ambiguo). **22 sin medir** (egress a `tcgcsv.com` bloqueado, 403): se miden en prod con **`POST /admin/catalog/refresh-variants-all`** + re-correr la consulta SQL. Los que sigan sin precio → **mapeo explícito por id** (arquitecto→backend), no ensanchar el matcher. | dueño (re-precia) → arquitecto → backend | 2026-09-15 | `card-product-resolver.service.ts`; `tcgcsv-group-match.ts` |

## Sesión 3 (2026-09-15) — nuevos, medidos por el orquestador

> Salidos de las pruebas del dueño en su tienda (S2-PRUEBAS) y su acompañamiento.

| ID | Qué | Dueño | Medido el | Comprobación |
|---|---|---|---|---|
| **S3-ACABADO** | 🎨 **Diferenciar el ACABADO de cara al CLIENTE en el catálogo.** Hoy el cliente ve la MISMA carta repetida (medido en la tienda del dueño: *Passho Berry* #184 y *Technical Machine: Fluorite* #188 aparecen dos veces — NORMAL y REVERSE HOLO) y solo un textito bajo la imagen las distingue («RAW · NM · ACABADO», `CatalogTile.tsx:71-83`). **Propuesta del dueño:** reusar el color por acabado que **YA existe** (`FinishBand`, §16.6: reverse_holo→rojo, holofoil→azul, «fuente única del color») pero **no como una línea, sino como un MARCO que encasille la teja** de esa variante, + una **leyenda visible** que diga qué significa cada color. **Sin cerrar el diseño: se pelotea con el dueño.** | ux-ui (§16.6/§7.2b) → frontend · dueño (afina) | 2026-09-15 | `frontend/src/app/[locale]/(storefront)/catalog/CatalogTile.tsx:71-83`; `frontend/src/components/domain/FinishMark.tsx` (`FinishBand`); `docs/DESIGN_SYSTEM.md §16.6` |
| **S3-GUEST-LINK** | 🔗 **El enlace de seguimiento del correo de invitado falla a los minutos de comprar** (reportado por el dueño con captura, pedido TCG-000012). El diseño dice que ese enlace dura **90 días** (`GUEST_TRACKING_TTL_DAYS=90`, emitido con `rotate:false` en `sendConfirmation`), así que morir en minutos NO es lo esperado. Hipótesis (NO confirmada, sin acceso a prod): rotación (`sendTrackingLink` con `rotate:true` revoca los previos — «solo el último funciona»), o bug. **Pendiente de reproducir:** que el dueño pruebe el enlace MÁS NUEVO del correo; si también muere al instante ⇒ bug real a backend. | orquestador (reproduce) → backend | 2026-09-15 (leído en código; **prod NO MEDIDA**) | `backend/src/modules/orders/guest-order-mail.service.ts` (`sendConfirmation` vs `sendTrackingLink`); `guest-checkout.service.ts:331` (`track`, INVALID/EXPIRED/REVOKED); `guest-checkout.constants.ts` (TTLs 90d vs 120min) |
| **S3-SPAM** | ✉️ **El correo transaccional cae en «no deseado»** (medido: captura del dueño, Hotmail marcó el AV/confirmación como spam). No es bug de código; es **reputación/entregabilidad del dominio** (SPF/DKIM/DMARC del remitente `no-reply@tcghunt.mx`). | devops · dueño (DNS del dominio) | 2026-09-15 | registros DNS del dominio; config del proveedor de correo |
| **S3-ENVIO-DIR** | 🔴 **La dirección capturada NO se despliega — regla del dueño: aunque el navegador autocomplete, la info debe verse.** Dos frentes: **(a) Admin/M4:** la pantalla de envíos pinta nombre · ciudad · estado · CP · teléfono pero **omite `line1`/`line2`/`neighborhood`** (calle, número ext/int, colonia): `M4View.tsx:284-294` no los renderiza. El dato SÍ está guardado (`AddressSnapshotDTO.line1` obligatorio) ⇒ **arreglo de frontend puro**, el operador no puede enviar sin ver la calle. **(b) Checkout/cliente:** el pago se BLOQUEA sin dirección (medido, `GuestCheckoutView.tsx:199` + `guest-validation.ts:109-113`), así que en TCG-000012 la calle se capturó — muy probablemente por **autocompletado del navegador**, que el dueño vivió como «no me la pidió». **Requisito nuevo del dueño:** la dirección de envío debe **mostrarse y confirmarse ANTES de pagar aunque se autocomplete** (riesgo real: autocompletar en silencio una dirección vieja ⇒ envío a dirección equivocada). **Pendiente de medir por el dueño:** compra de invitado en **incógnito** (sin autocompletado) para ver si el campo de calle aparece; si NO ⇒ bug del formulario además del de despliegue. No toca dinero; bloqueante para operar. | frontend · ux-ui (confirmación en checkout) | 2026-09-15 (código medido; incógnito NO MEDIDO) | `M4View.tsx:284-294`; `GuestCheckoutView.tsx:199`; `guest-validation.ts:109-113`; `contract.ts:1155-1161` (`AddressSnapshotDTO`) |
| **S3-ACEPTADA-COLOR** | 🎨 **Del lado del cliente, «ACEPTADA» sale en ROJO; el dueño la quiere en VERDE** para que se vea claro que puede continuar (captura: «Compras y ventas → Ventas → Mis solicitudes»). ⚠️ **Hoy es DELIBERADO:** `status-map.ts:64` mapea `aceptada` a tono `accent` (rojo), y el comentario `:59` dice que `ofertada` y `aceptada` comparten `accent` **a propósito** (`DESIGN_SYSTEM §23.1a-b`). ⇒ No es bug accidental: es **cambio de diseño** que pide el dueño (aceptada = positivo = verde/success). Reconciliar §23.1a-b (¿por qué compartían accent? — la versalita ya da el segundo canal a11y). ux-ui decide → frontend aplica. No toca dinero. | ux-ui (§23.1a-b) → frontend | 2026-09-15 | `frontend/src/lib/status-map.ts:59,64`; `docs/DESIGN_SYSTEM.md §23.1a-b` |
| **S3-BUYLIST-RECHAZO** | 🟠 **En la mesa de decisión (M5) no hay opción clara para RECHAZAR una oferta/pieza** (hallado por el dueño: «no tengo opción de cómo rechazar esta oferta»). Medido: las líneas **no marcadas** viajan como `skip` **al EMITIR** (`BuylistDecisionDesk.tsx:296-299`; «No entra en esta oferta», `es.json:958-959`), y el sistema tiene el concepto de rechazo (`do_not_buy` `:174`, «Rechazar la oferta» `es.json:967`, pestaña «Piezas rechazadas»). PERO desde la mesa **EMITIR OFERTA se bloquea si no hay ninguna línea marcada para comprar** ⇒ **rechazar TODAS no tiene camino**, y no hay botón explícito de «rechazar esta pieza» visible. Falta exponer el rechazo (por pieza y rechazar-todo). | ux-ui → frontend (+ backend si falta endpoint) | 2026-09-15 | `frontend/src/app/[locale]/(admin)/admin/m5/BuylistDecisionDesk.tsx:174,296-299`; `frontend/messages/es.json:958-959,967` |
| **S3-NOOFFER-OFF** | 🔌 **La solicitud no se auto-canceló porque la regla está APAGADA por un interruptor** (dueño corrigió la lectura: la regla es el plazo de 7 días sin oferta = rechazo de la plataforma, D33). Medido: existe como **«regla 7» del barrido** — una `cotizada` que nadie ofertó en **7 días HÁBILES** ⇒ `expirada`/`no_offer` + correo «no procederemos» + anula la oferta pendiente (`buylist-sweep.service.ts:36`). El barrido corre a diario (cron `'0 8 * * *'`). ⚠️ **Pero la regla 7 NACE APAGADA** por el flag `buylist_no_offer_expiry_enabled` (seed `off`, B-4, `:38`) — por eso no cerró la solicitud. Además cuenta **días hábiles**, no naturales (8→15 sep quizá no llega a 7 hábiles aunque estuviera encendida). **NO es bug: es un interruptor apagado a propósito.** DECISIÓN DEL DUEÑO: ¿encender `buylist_no_offer_expiry_enabled`? Auto-rechaza solicitudes ⇒ toca cliente; encender debe ser deliberado. | **dueño (decide encender)** · devops/config | 2026-09-15 | `backend/src/jobs/buylist-sweep.service.ts:36,38`; flag `buylist_no_offer_expiry_enabled`; `backend/src/common/business-days` |
| **S3-BOUNTY-PRECIO** | 🔴💰 **En la mesa de decisión (M5), un item de BOUNTY llega con precio ofertado = MX$0.01 (MANUAL) en vez del precio con que se cotizó** (hallado por el dueño; captura: Morpeko ex, Pitch Black #117, bounty 0/2). Medido en la pantalla: **«Derivado por la curva» = $1,500 (correcto)** pero **«Ofertamos» = $0.01 MANUAL** y el input «Precio ofertado» = 0.01. El dueño puso un precio al crear el bounty y **ese precio no llega** a la mesa; el ofertado cae a 1 centavo. **RIESGO DE DINERO:** ofertar $0.01 por una carta de $1,500. ⚠️ **NO MEDIDO el mecanismo exacto** (por qué 0.01 en bounty: ¿offeredPriceCents=1 guardado al crear el bounty?, ¿default de front?, ¿sugerencia de backend?) — hay que trazarlo. Ficheros de entrada: `BuylistDecisionDesk.tsx` (input ofertado; `isBounty` :193; `derived` :499), `decision-desk.ts:35` (amount = derivedPriceCents). Buylist/pricing = dinero ⇒ arquitecto/backend + triple veredicto. ⛔ Mientras: NO enviar ofertas de bounty sin corregir el monto a mano. | arquitecto → backend (+ frontend) | 2026-09-15 (pantalla medida; mecanismo NO trazado) | `frontend/src/app/[locale]/(admin)/admin/m5/BuylistDecisionDesk.tsx:193,499`; `m5/decision-desk.ts:35`; backend buylist (creación de bounty / offeredPriceCents) |
| **S3-BUYLIST-INE** | 🔴 **En «Crear solicitud de venta» (buylist), un usuario con INE RECHAZADA ve «Tu INE ya está en archivo; no necesitas volver a subirlo»** (verde), cuando debería ver que fue rechazada + re-subirla (hallado por el dueño). Medido: `BuylistKycForm.tsx:494` gatea el mensaje verde SOLO por `ineOnFile`; el banner de rechazo (`:503-504`, `kycStatus==='rejected' && rejectionReason`) vive SOLO en la rama `else` (ineOnFile falso). Con INE rechazada pero archivo aún presente (`ineOnFile:true`), gana `:494` y el rechazo **nunca se muestra**. **Fix frontend:** `ineOnFile` no debe ganar sobre `kycStatus==='rejected'`. ⚠️ **Medir aparte (posible AML):** ¿el backend BLOQUEA una solicitud de venta si `kycStatus` está rechazado? Si no, no es solo cosmético → arquitecto/backend. Toca identidad/venta. | frontend (display) · medir guard backend | 2026-09-15 | `frontend/src/components/domain/BuylistKycForm.tsx:494` vs `:503-504` |
| **S3-ORDEN-CONV** | 🔤 **Simplificar la convención de orden en admin (idea del dueño, a explorar).** Hoy los reportes de admin muestran el **UUID críptico** en vez del número amigable que el cliente YA recibe: `M7View.tsx:68` pinta `o.orderId` (uuid) en «IVA cobrado»; el número legible `TCG-000123` ya existe (`orders.service.ts:665`, `nextOrderNumber`). **Idea del dueño (solo idea, explorar cómo):** iniciales del nombre + número de pedido (p.ej. `JC · TCG-000012`). Aplicar una referencia **legible y CONSISTENTE** en TODO admin (IVA, pedidos a preparar/picking, envíos, órdenes). Ojo: invitado no tiene nombre de cuenta ⇒ iniciales del destinatario. Definir la convención (product-owner/arquitecto) y aplicarla (frontend, y backend si se persiste). No toca dinero. | product-owner → arquitecto → frontend | 2026-09-15 | `frontend/src/app/[locale]/(admin)/admin/m7/M7View.tsx:68`; `backend/src/modules/orders/orders.service.ts:665` |
| **S3-BOVEDA-CLARIDAD** | 🧭 **En la compra de cuenta registrada, dejar CLARÍSIMO que va directo a la bóveda** (medido: el dueño se quedó pensando «¿y dónde envío?»). El comportamiento es correcto y así se queda (registrado ⇒ a bóveda, el envío se pide después, todo junto). Pero la promesa hoy solo aparece **arriba bajo el título** (`es.json:448`/`475`), **no** en la **columna de resumen** de la derecha (`CheckoutView.tsx:338-341`) ni en el **pop-up de pago** (`StripePaymentModal`), que es donde el ojo está al momento de pagar. Reforzar el mensaje «va a tu bóveda» en el resumen y quizá en el pop-up. Copy/ubicación ⇒ ux-ui → frontend. No toca dinero. | ux-ui → frontend | 2026-09-15 | `frontend/src/app/[locale]/(storefront)/checkout/CheckoutView.tsx:338-341`; `frontend/messages/es.json:448,475`; `components/domain/StripePaymentModal.tsx` |
| **S3-CORREO-FORMATO** | 🎨 **Los correos transaccionales se ven «a la antigua» — deben tomar el formato visual de la página** (medido: captura del dueño del correo de confirmación de TCG-000012, HTML plano sin la identidad del sitio). Alcance: todas las plantillas — confirmación/seguimiento de invitado (`backend/src/modules/orders/mail/guest-order.templates.ts`), los avisos AV-1…AV-11 (`backend/src/modules/orders/mail/order-notice.templates.ts`) y las de auth (`backend/src/modules/mail/mail.templates.ts`). ux-ui define el diseño del correo según `DESIGN_SYSTEM` (con el ojo puesto en las limitaciones de HTML de correo: CSS inline, layout por tablas, compatibilidad entre clientes) → backend implementa el HTML. NO toca dinero; es marca/experiencia. | ux-ui → backend | 2026-09-15 | `backend/src/modules/orders/mail/guest-order.templates.ts`; `order-notice.templates.ts`; `backend/src/modules/mail/mail.templates.ts`; `docs/DESIGN_SYSTEM.md` |
| **S3-PICKING-CARTA** | 🔴 **La lista de picking no dice QUÉ carta mandar** (medido). `pickingColumns` (`M4View.tsx:185-188`) pinta solo **ubicación · folio · envío(id)**; el `PickingListEntryDTO` (`contract.ts:1211-1216`) trae `shipmentId/inventoryItemId/folio/location` y **ningún nombre/set/número de carta**. El operador no puede identificar el producto a empacar. Requiere **añadir la identidad de carta al DTO** (arquitecto → backend, regla 9) y luego pintarla (frontend). Bloqueante para operar. | arquitecto → backend + frontend | 2026-09-15 | `M4View.tsx:185-188`; `contract.ts:1211-1216` (`PickingListEntryDTO`) |

### Avances nocturnos (2026-09-15, madrugada) — construidos por agentes, verificados por el orquestador

**Ramas empujadas (listas para PR del dueño; NADA publicado, no tocan `main` ni el PR #37):**
- `claude/fix-envio-dir` — **S3-ENVIO-DIR**: M4 ya muestra la calle (`line1`/`line2`/`neighborhood`, helper `streetOf`), +i18n es/en, +test. Diff revisado por el orq.; frontend 1844/1844.
- `claude/ux-pulido` — **S3-ACEPTADA-COLOR** (accent→success), **S3-BUYLIST-INE visual** (el rechazo gana a «en archivo», +test de regresión), **S3-BOVEDA-CLARIDAD** (nota en el resumen). Diff revisado; 1844/1844.
- `claude/arch-drafts` — borradores `docs/specs/PEDIDOS_A_PREPARAR_CONTRACT_DRAFT.md` + `docs/specs/EQ_D1_FILTER_CLASS_DRAFT.md` (contrato vivo intacto).

**Hallazgos medidos (re-verificados por el orquestador; dinero/identidad):**
- 🔴 **S3-BUYLIST-INE es MÁS que visual (AML):** `createRequest` (`backend/src/modules/buylist/buylist.service.ts:1351-1735`) **NO compara `kycStatus`** ⇒ un vendedor con INE **rechazada puede crear la solicitud de venta** (la puerta de INE mira presencia de imágenes, no el veredicto). Verificado por el orq. (kycStatus no aparece en el cuerpo). **Backend/arquitecto + 3 veredictos.** (El arreglo visual ya va en `claude/ux-pulido`; el de backend falta.)
- 🟡 **S3-BOUNTY-PRECIO: NO reproducible en el código de hoy.** «Ofertamos» == «Derivado» salvo que el operador teclee; el override nace `{}` y solo lo escribe el usuario (`BuylistDecisionDesk.tsx:246,488`); Darkrai $3,000 vs la otra $1,500 es correcto por diseño (efectividad del bounty). ⇒ Probablemente se tecleó el 0.01, o el sitio corría un build más viejo que `main`, o modo mock. **Falta repro del dueño** (SellRequest + fila `VariantPriceOverride` + SHA de prod + si tecleó). No se construyó fix.
- 🔴💰 **S3-OVERRIDE-ZERO (NUEVO):** el override de precio en emisión acepta **$0** (`backend/src/modules/buylist/dto/buylist.dto.ts:207`, `@Min(0)`) ⇒ se podría emitir una oferta a $0.00, saltándose la regla >0. Endurecer a >0 con prueba RED. Backend + 3 veredictos.
- ⚪ **P-92:** intermitente **NO reproducido 10/10** con el binario local de vitest. Salvedad: el `npm ci` de frontend fue frágil (a veces dejó devDeps incompletas) — eso podría ser el verdadero «intermitente» y **conecta con P-87** (arnés de pruebas).

**Decisiones del dueño (2026-09-15 AM):**
- **S3-BOUNTY-PRECIO → NO es bug (el dueño tecleó el 0.01).** Cambio pedido: el campo «Precio ofertado» de la mesa (M5) debe **pre-llenarse con el precio de mercado con que se cotizó** (derivado/bounty), para que el operador CONFIRME en vez de teclear en blanco (así no se cuela un 0.01). ⚠️ Diseño: el pre-llenado NO debe contar como override manual salvo que se cambie (respetar `decision-desk.ts:48` `amount !== derivedPriceCents`). Ruta: ux-ui/arquitecto → frontend. En construcción (rama `claude/fix-bounty-prefill`).
- **S3-BUYLIST-INE (backend/AML) → decisión: «umbral, luego bloqueo».** Montos chicos: dejar vender aunque la INE esté rechazada. **Al/por encima de `INE_THRESHOLD_CENTS`** (`buylist.service.ts:1588`): exigir identidad VÁLIDA (no rechazada) — hoy la puerta (`INE_REQUIRED`) solo mira presencia de imágenes, no el veredicto. Ruta: **arquitecto** (regla/contrato) → backend + 3 veredictos (identidad/dinero). Borrador en `claude/arch-ine-threshold`. **CONFIRMADO por el dueño 2026-09-15:** SÍ al cambio (revierte D51/§M5-K para este caso — bloquea sobre el veredicto del admin, no cotea nombres, así que NO reabre la pregunta 40); bloquea **solo `rejected`** (no toca `none`/`pending`); código nuevo `KYC_REJECTED` (422); filas legacy sin motivo → texto genérico. **HECHO** en rama `claude/fix-ine-threshold-block` (contrato §M5-K.6 + tabla E + PROJECT 183(a) + guarda `buylist.service.ts:1663` `KYC_REJECTED` + prueba). **Verificado por el orq. (O-9):** control 8/8; mutación limpia (`false &&`) ⇒ solo el caso (a) rojo, (b)/(c) verdes ⇒ la prueba muerde. **3 VEREDICTOS CERRADOS (2026-09-16, sobre SHA `85069923`):** QA APROBADO C/COND (núcleo verde 320/5317, canario muerde 3/3; única condición: concurrencia E2E NO MEDIBLE aquí sin Postgres → CI en el PR; QA midió que NO hay TOCTOU ⇒ riesgo bajo), techlead APROBADO C/COND (condición documental **cerrada** por el arquitecto en `3c3b8214`, solo `docs/API_CONTRACT.md` +21, código intacto), seguridad APROBADO (sin críticos/altos, sin pentester). **Rama `claude/fix-ine-threshold-block` LISTA para el botón del dueño**; la única condición viva (concurrencia) la cierra CI. Falta copy de `KYC_REJECTED` en DESIGN_SYSTEM (ux-ui, menor). Bounty-prefill: **hecho** en `claude/fix-bounty-prefill` (solo display; verificado por el orq.).

### Sellado — re-medido por el orq. (2026-09-16) · CORRIGE la re-medición nocturna (punteros viejos)
Diseño completo en rama `claude/arch-sealed` (`docs/specs/SELLADO_FIX_DESIGN_DRAFT.md`).
- **P-79(a) → 🟢 YA RESUELTO en `main`** (verificado por el orq.): `frontend/src/app/[locale]/(admin)/admin/m1/SealedAddFlow.tsx:167-172` keyea el precio en `effectiveMarketCents` (autoritativo, gateado por `sealedPriceSource`), NUNCA en `marketRef` (`:173` = solo sugerencia). La re-medición nocturna lo marcó 🔴 por un puntero envejecido — **queda cerrado, nada que hacer.**
- **P-79(c) → 🔴 ABIERTO, DISPLAY (no dinero)** (verificado): `PendingPublishRowDTO` (`contract.ts:2741`) trae `card`/`productType` pero **NO** `sealedProductName` (los `sealedProductName` de `:2391/:3181` son OTROS DTOs). La cola M1 pinta la carta ancla. Arreglo aditivo: contrato (add field) → backend (proyección, la columna `InventoryItem.sealedProductName` ya existe) → frontend (`sealedProductName ?? card.name`).
- **P-83 → 🟡 DECISIÓN DEL DUEÑO (💰):** la colisión de precio está **confinada al camino LEGACY sin mapeo**; toda alta vigente nace mapeada (`SealedProduct.tcgplayerProductId Int @unique NOT NULL`; alta sin mapeo se rechaza 422). Arquitecto recomienda **(B)** prohibir alta sin mapeo + curar legacy (no toca schema, 0 lectores nuevos, riesgo local) sobre **(A)** columna `sealedProductId` en `PriceReference` (cambio de schema, redundante para los mapeados, ~9 lectores de dinero). **Falta conteo en prod:** piezas sealed con `tcgplayerProductId IS NULL` (query en el borrador) — si es 0, (B) es casi gratis. **✅ DUEÑO ELIGIÓ (B) el 2026-09-16.** Query que corre el dueño: `SELECT count(*) FROM "InventoryItem" WHERE "productType"='sealed' AND "tcgplayerProductId" IS NULL;`. Con ese número: si 0 → solo cerrar la puerta de alta sin mapeo (backend, 💰, 3 veredictos); si >0 → + guion de curación legacy (patrón P-79d, lo corre el dueño). P-79(c) display: en construcción (rama `claude/fix-sealed-m1-display`). **✅ CONTEO PROD = 0 (dueño, 2026-09-16):** cero piezas sealed sin mapeo ⇒ **no hay curación legacy.** Queda solo el remate: guard explícito que RECHACE alta de sellado sin `tcgplayerProductId` hacia adelante (hoy el sin-mapeo se maneja seguro `inventory.service.ts:591-592` pero no se prohíbe; count 0 lo hace de bajo riesgo). Backend + 3 veredictos (dinero). Follow-up chico.

## Índice de abiertos (re-medido 2026-09-11 ~03:20 UTC sobre `17ce9a9`; **actualizado 2026-09-11 ~08:30 UTC tras fusionar Stream A + andamiaje de CI a `main`**; «—» = el cuerpo no lo dice)

> Sesión 2, 2026-09-11: se re-midió **cada fila** contra el árbol (O-5). Punteros a línea corregidos donde envejecieron.
> Cerrado en código en esta re-medición: **P-46** (fix `47c97c1`, dentro de `c13f417`; falta solo la verificación en producción, ver fila).
> Frentes abiertos por esta sesión el 2026-09-11: **«Andamiaje de CI»** (devops) y **Stream A** (ux-ui + arquitecto → backend + frontend), en `claude/tcg-hunt-orchestration-2`.

| ID | Qué | Dueño | Medido el | Comprobación (por dónde empezar) |
|---|---|---|---|---|
| **Stream A** | La cuenta del cliente — **PUBLICADO en `production` el 2026-09-11 18:25 UTC** (`c8bee65`, merge `--no-ff` de `main`; autorizado por el dueño). Medido por el orquestador el 2026-09-11 ~19:00 UTC: el run `34633179107` «Deploy (staging -> prod)» terminó **success**, con `dast-release` verde sobre ese mismo SHA (autoprueba del canario + escaneo del stack efímero, sin bloqueantes); el resto de los trabajos se **saltó a propósito** (`secrets-gate` ⇒ `ready=false`: no hay secrets de CD, publican las integraciones nativas Vercel/Railway). **NO MEDIDO**: que el sitio vivo sirva estas pantallas — desde este contenedor la política de red rechaza `www.tcghunt.mx` y la API de Railway (`CONNECT tunnel failed, 403`); lo cierra el dueño abriendo `/es/account` y `/es/admin/account`, o habilitando esos hosts en la política del entorno. Antes fue: **FUSIONADO en `main` el 2026-09-11** (merge de `claude/tcg-hunt-orchestration-2`, 79 commits; QA + techlead aprobados; cuerpos de P-57/P-73/P-75/P-55 en `HISTORIAL.md`). **Pendiente de RELEASE**: fase de seguridad (pentester + seguridad) sobre `main`; conteo `SELECT count(*) FROM "User" WHERE "mustChangePassword"` en producción antes de publicar el guard (checklist `ARCHITECTURE.md` §4.47.10.4); guard + endpoint en el mismo deploy | orquestador → pentester → seguridad → devops | 2026-09-11 | `git log origin/main --oneline -3`; `docs/ARCHITECTURE.md` §4.47.10.4 |
| **Stream B** | ✅ **FUSIONADO en `main` el 2026-09-11 21:00 UTC** (`5d2c62b`, merge `--no-ff` de 72 commits). **NO publicado**: `production` sigue en `c8bee65`. Doble veredicto cerrado: **QA** APROBADO CON CONDICIONES (ratificado) y **techlead** con dos bloqueantes, las dos **cerradas y verificadas por el orquestador sobre copia**, no aceptadas de informe — COND-1 (copia limpia 7/7; con el `catch` ensanchado, **2 rojas en 3/3**, y caen exactamente las de «cualquier otro código propaga») y COND-2 (candado rc=0 y **canario 11/11**). Verificación propia sobre copia **completa** del árbol: backend **282 suites / 4631 pruebas** y frontend **153 ficheros / 1715 pruebas**, ambas verdes y **coincidentes con lo que midieron los agentes por separado**. CI de la rama verde en `c5ff58a` (run 34646575742). Entra también, **solo en papel**, el frente de identidad: diseño §34 v4.2.1 y contrato v1.69 con `ARCHITECTURE` §4.49, **sin código**. **PENDIENTE PARA PUBLICAR: fase de seguridad completa** (pentester + seguridad) — toca dinero, así que son **tres** veredictos. Residuales abiertos que salieron de este cierre: **P-80** (Stripe dentro de la tx, acotado no eliminado), **P-81** (§M5-S), **P-82** (dos ventas simultáneas ⇒ 500), **SB-D6**, **RSV-L1**, **FE-SB-4**, **DO-D11**. | orquestador → pentester → seguridad → devops | **2026-09-11 21:00 UTC (orquestador, verificado a mano)** | `git log --oneline -1 main` = `5d2c62b`; `git rev-parse production` = `c8bee65` |
| **P-78** | ✅ **CONSTRUIDO Y FUSIONADO en `main` el 2026-09-12 01:20 UTC** (`8aeec21`, merge `--no-ff` de 26 commits). **NO publicado**: `production` sigue en `efe65f5`. Doble veredicto cerrado: **QA** APROBADO CON CONDICIONES (ninguna bloquea la fusión) y **techlead** APROBADO CON CONDICIONES con **R-1 bloqueante cerrada y verificada por el orquestador a mano** (cero proyecciones por resto en `admin.service.ts`, `getUser` con `select` acotado, candado de **conjunto de claves** contra el contrato para los dos roles y con columnas intrusas en el fixture). **QA recorrió el ciclo completo contra el stack levantado con navegador real**: el cliente sube, el operador ve las dos caras (`naturalWidth = 16`, el PNG del fixture es 16×10 ⇒ **se pinta de verdad, no es un marco vacío**), rechaza con motivo, y el cliente lee ese motivo textual en su cuenta con el botón de volver a subir. Los **doce candados de §M6-K medidos uno a uno contra el stack vivo**, incluido el tope por actor (12 llamadas, misma sesión, cabecera rotatoria ⇒ `429` en la 11.ª). **PENDIENTE PARA PUBLICAR: fase de seguridad completa** — toca dinero **y datos personales**, así que son tres veredictos; el pentester arrancó el 2026-09-12 sobre `8aeec21`. Residuales: **A5** (columna y filtro de estado en el listado, del arquitecto — sin él nadie se entera de que hay una INE esperando), las cuatro salvaguardas `mockOnly` cuyo motivo caducó con el sembrado de `bec269b` (frontend), y D-1 (la llave de subida es un texto libre del cliente ⇒ `ineOnFile` es un hecho **afirmado por el cliente**). | orquestador → pentester → seguridad → devops | **2026-09-12 01:20 UTC (orquestador, verificado a mano)** | `git log --oneline -1 main` = `8aeec21`; `git rev-parse origin/production` = `efe65f5` |
| **P-79** | 🔴 **El sellado: tres defectos distintos que el dueño vive como uno** (reporte con captura 2026-09-11 sobre `c8bee65`; **medido por el orquestador el 2026-09-11 ~19:30 UTC**, fichero:línea verificados a mano, no relayados). **(c) Lo que él VE — la cola de M1 no sabe pintar sellado.** `frontend/src/app/[locale]/(admin)/admin/m1/PendingPublishQueue.tsx:139-141` imprime siempre `setName · number · finish`; **`grep -c productType` en ese fichero = 0**: no hay rama de sellado. Y aunque la hubiera, **el DTO no trae con qué pintarlo** (`frontend/src/types/contract.ts:2581-2599` y la proyección `backend/src/modules/inventory/inventory.service.ts:1803-1821` no llevan `sealedProductName`). El `Weedle · 1` y el `Spinarak · 1` **no son su producto convertido en carta**: son la **carta ancla** del set, que el sellado usa solo para satisfacer una columna obligatoria y que el propio código declara «deja de ser identidad» (`inventory.service.ts:820-829`, `resolveAnchorCardId`, menor `numberPrefix/numberSort`). En la base el `productType: 'sealed'` y el `sealedProductId` **están intactos** — se pierde solo en la pantalla. La cola de **M2 sí ramifica bien** (`m2/sections/PendingQueueSection.tsx:35`): a M1 nunca se le hizo ese trabajo. Dueños: **arquitecto** (el DTO necesita `sealedProductName` ⇒ cambio de contrato, regla 9) → **backend** (proyección) + **frontend** (rama de sellado). **(d) Por qué poner precios en M2 NO SIRVE — la llave divergente del alta por LOTE.** El alta **single** escala el pendiente con `sealedMarketGradeKey(tcgplayerProductId)` = `sealed:tcg:<id>` (`inventory.service.ts:586-590`), pero el alta **por lote** —que es la que dispara `SealedAddFlow` y por tanto **la que usa la app publicada**— pasa `r.gradeKey` tal cual (`inventory.service.ts:1144-1155`), y `gradeKey` para sellado es **la constante `'sealed'`** (`backend/src/modules/pricing/pricing.types.ts:682-684`). La publicación, en cambio, lee por `sealedMarketGradeKeyForItem(item)` = `sealed:tcg:<id>` (`inventory.service.ts:1557`). **Se escribe en una llave y se lee de otra**, así que el precio fijado en M2 es ilegible para la publicación y la pieza vuelve a la cola: el bucle exacto que él describe. Las dos llaves existen a propósito (`'sealed'` es la del override manual, §4.19d); el defecto es que el camino de lote escala el **pendiente de mercado** bajo la llave del **override manual**. Agravante: con `tcgplayerProductId` nulo, `:1557` ni siquiera consulta referencia (`gk ? … : undefined`) ⇒ ilegible por construcción. **Es dinero y no está escrito en ningún pendiente previo.** Dueño: **backend**. **(b) El MX$1,300.00 repetido: la promesa se cumple, el diseño lo empuja.** Medido: **ningún** camino copia `acquisitionCostCents` a `listPriceCents` (40 hits, todos COGS/valuación); el único write en alta es `inventory.service.ts:1067` (`dto.listPriceCents ?? null`) y el alta por lote no lo manda. Pero **publicar un sellado EXIGE precio manual**: `frontend/src/app/[locale]/(admin)/admin/m1/ItemDetailModal.tsx:64-66` (`sealedNeedsPrice`) bloquea si no hay `listPriceCents`. O sea: el producto **obliga al operador a inventar el número** que la cola promete no capturar. Lo más probable es que el 1,300 lo tecleara él, empujado por (d). **NO MEDIDO**: el `listPriceCents` real de INV-001944/945, que exige consulta a la base de producción. **(a) El precio de mercado no jala al capturar** = **P-69, re-medido hoy y VIGENTE sin tocar**: `sealedPriceSource` sigue con **0 consumos** en `frontend/src` (el único hit es un comentario, `SealedAddFlow.tsx:167`), y el paso 1 sigue keyeándose en `product.marketRef` sin gatear (`SealedProductPicker.tsx:217`) mientras el paso 2 usa el autoritativo (`SealedAddFlow.tsx:172`). Escalón previo: **P-46** (set sin grupo TCGCSV ⇒ sellado sin `tcgplayerProductId` ⇒ sin mercado) — **Chaos Rising, uno de los dos sets de su captura, está nombrado literalmente en esa fila**, y P-46 sigue **sin verificar en producción**. **Cobertura: NO EXISTE, y por eso pasó inadvertido.** `backend/test/inventory.sealed-product-alta.spec.ts:146-152` sólo prueba `aportacion_en_especie`; los casos con `'compra'` (`:327`) son rechazos. `inventory.pending-publish.spec.ts:34,66` usa sólo `productType: 'raw'`. `PendingPublishQueue.test.tsx` idem. Playwright no da de alta ningún sellado. Y la asimetría de (d) es invisible porque `inventory.sealed-product-alta.spec.ts:196` fija la llave correcta **sobre `createItem` (single)**, no sobre el lote que usa la app. **Dinero ⇒ triple veredicto.** Orden propuesto: (d) primero —es el que rompe el ciclo—, luego (c), luego (a)/P-69. No se enruta hasta que Stream B fusione: (c) y (d) tocan `inventory` y el contrato, zonas que ahora mismo no están libres. | backend (d) · arquitecto → backend + frontend (c) · frontend + backend (a) | **2026-09-11 ~19:30 UTC (orquestador, verificado a mano)** | `inventory.service.ts:1144-1155` vs `:586-590` vs `:1557`; `pricing.types.ts:682-684`; `PendingPublishQueue.tsx:139-141` (`grep -c productType` = 0); `ItemDetailModal.tsx:64-66` |
| **P-80** | ⚠️ **Stripe vive DENTRO de la transacción del checkout y retiene su conexión toda la latencia del proveedor** — mecanismo **medido, real y reproducible** por backend el 2026-09-11 (`cae1fc1`, contra Postgres real con el pool de CI, doble de Stripe con retardo inyectable, N=6 sustituciones concurrentes de clientes distintos): con 2 s de latencia **6/6 en 201, 0 timeouts, 3/3 tiradas**; con 12 s, **5/6 en 201 y 1/6 en `500` «Timed out fetching a new connection from the connection pool (timeout: 10, limit: 5)», 3/3 tiradas**. A la escala que pidió QA **no se manifiesta**, y la propiedad de dinero aguanta en los dos casos (cero piezas con dos órdenes `pending`). **Acotado, no eliminado**: el SDK de Stripe traía `timeout` por defecto de **80 s**, **2,6× el `timeout: 30_000` de la transacción** — o sea que el proveedor decidía cuánto duraba nuestra transacción. Backend lo fijó en **8 s**, así que el peor caso (1 intento + 2 reintentos) son 24 s y la transacción siempre gana al SDK. Pero con 24 s de conexión retenida, **un N suficientemente alto sigue agotando el pool**. **Sacar la cancelación de Stripe fuera de la transacción es cambio de diseño y NO lo toca backend** (regla 9): «cancelar antes de crear» es justo lo que impide que dos intentos de pago cobren la misma pieza (`ARCHITECTURE.md` §4.48.2). **Dinero ⇒ triple veredicto.** | **arquitecto** (decide el diseño) → backend | 2026-09-11 (medido por backend, mecanismo verificado con proporciones) | `backend/test/integration/stripe-in-tx-pool.e2e-spec.ts`; `backend/src/modules/payments/stripe.service.ts` (`TIMEOUT_MS`); `docs/ARCHITECTURE.md` §4.48.2 |
| **DO-D2** | ⚠️ **La comprobación de cierre de DO-D2 no se puede cumplir mientras falten los cinco secrets de CD** (medido por devops el 2026-09-11 sobre el run `34633179107`): los jobs `promote-production-*` nunca llegan a evaluar `blocking=false` porque `secrets-gate` emite `ready=false` y todo lo demás cuelga por `needs`. No es un fallo nuevo — los deploys reales van por las integraciones nativas — pero **exige una decisión del dueño**: activar el CD por Actions cargando `RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` y `PROD_BASE_URL`, **o** declarar que esos jobs sobran y retirarlos. **No es una petición al dueño todavía** (O-6): se le plantea cuando haya que cerrar DO-D2, no antes. | HUMANO (decide) · devops (ejecuta) | 2026-09-11 | `docs/TECH_DEBT.md` DO-D2; `docs/DEVOPS_NOTES.md` §57.4 |
| **P-81** | ⚠️ **§M5-S tiene una tercera rama que el contrato no nombra** (desviación **preexistente**, hecha legible por backend el 2026-09-11, no introducida por Stream B). El contrato dice «terminal ∨ `closedAt ≠ null` ⇒ `CONFLICT`; **en otro caso** ⇒ `INVALID_TRANSITION`». La rama de la **carrera** (dos operadores tocan el mismo paso a la vez) cae en «otro caso» por la letra, pero el código responde `CONFLICT` desde v1.68. Backend solo añadió `details.reason: 'CONCURRENT_UPDATE'` y un aviso al registro para que deje de mentir; **zanjarla es del contrato**: o pasa a `INVALID_TRANSITION`, o se declara `CONFLICT` con su `reason` escrito. | **arquitecto** | 2026-09-11 (medido por backend; desviación verificada contra el contrato) | `backend/src/modules/buylist/buylist.service.ts` (`throwStepRejected`); `docs/API_CONTRACT.md` §M5-S |
| **RSV-L1** | ⚠️ **La rama legada `reservedByOrderId IS NULL` sigue en TRES sitios** (`reservation.ts:39-44`, `payments.service.ts:642-650`, `guest-checkout.service.ts:435-445`), medido con `grep` el 2026-09-11. Deuda registrada, **no bloqueante**. Su cierre tiene **dos mitades y las dos hacen falta**: que la cuenta `SELECT count(*) … WHERE reservedByOrderId IS NULL` sea **0 en producción** (hoy **NO MEDIDA** — es del cierre de release, necesita ventana) **y** que los tres sitios se retiren. Retirarlos antes de que la cuenta sea 0 rompería reservas vivas. | backend (retira) · orquestador/humano (mide la cuenta) | 2026-09-11 (árbol medido; producción NO MEDIDA) | `docs/TECH_DEBT.md` RSV-L1 |
| **P-82** | 🔴 **Dos peticiones de venta simultáneas del MISMO vendedor devuelven `500`** (`write conflict or deadlock`), hallado por frontend el 2026-09-11 mientras cableaba el E2E real. Dos `POST /buylist/requests` a la vez del mismo vendedor revientan en `buylist.service.ts:1637`. Un `500` no es un error de negocio: el cliente no sabe qué pasó ni si su petición entró. Falta decidir el desenlace correcto (serializar, o `409` declarado en el contrato) — si es lo segundo, pasa por **arquitecto** antes. | backend (arquitecto si toca contrato) | 2026-09-11 (hallado por frontend contra el stack real; **el orquestador NO lo ha reproducido**) | `backend/src/modules/buylist/buylist.service.ts:1637` |
| **SB-D6** | ⚠️ **El correo del invitado vive en `sessionStorage` y nadie lo ha bendecido ni prohibido**. Medido por frontend: **sin él, recargar la página PODA la reserva propia del invitado** — o sea que el apaño sostiene una promesa del contrato (§4-R.3) sin estar declarado en él. Decidir: se bendice y se escribe, o se prohíbe y se sustituye. Frontend **no lo tocó**, que es lo correcto (regla 9). Junto con esto: **§4-R se queda sin gate real** mientras no exista una vía declarada para tener un pedido `pending` **reservado** sin Stripe — hoy `POST /checkout/session` devuelve `503` sin clave y el pedido queda `failed` con la reserva liberada, así que el flujo no se puede probar de punta a punta. | **arquitecto** → frontend/backend | 2026-09-11 (medido por frontend contra el stack real) | `docs/API_CONTRACT.md` §4-R.3; `docs/TECH_DEBT.md` FE-SB-1 |
| **FE-SB-4** | ⚠️ **Los E2E `@real` corrieron contra el frontend horneado del stack, no contra el árbol de la rama** (medido por frontend: el backend solo admite `CORS allow-list: http://localhost:3000`). Ninguna aserción `@real` toca código que frontend cambió hoy, pero **no está medido** que sus cambios corran contra el backend real. Es una limitación del arnés, no del código. | devops | 2026-09-11 | `docs/TECH_DEBT.md` FE-SB-4 |
| **P-79 (d)** | ✅ **ARREGLADO EN CÓDIGO el 2026-09-11** (`d3b2543`): los tres caminos que escalan el pendiente de precio de un sellado piden ahora la llave a **un único constructor**, así que no pueden volver a divergir. Backend encontró un **tercer** camino con el mismo defecto que no estaba en mi diagnóstico (`adjustFound`, «encontrada», `inventory.service.ts:2745`). Mutaciones: devolver cada uno de los tres a `r.gradeKey` ⇒ **rojo 3/3** en los tres. Suite 282/4638 (desde 4631). **PERO el arreglo cura las altas NUEVAS; las filas ya escritas con la llave equivocada siguen ahí.** ⚠️ **NO MEDIDO y es del dueño**: cuántas son en producción. Backend dejó las tres consultas `SELECT` exactas en `docs/BACKEND_NOTES.md` y **no escribió ninguna migración de datos**, que es lo correcto. Dato que quita ambigüedad: `SealedProduct.tcgplayerProductId` es **NOT NULL**, así que **toda** entrada pendiente con `sealedProductId` tenía llave de mercado disponible ⇒ **todas son erróneas**, no hay que decidir caso por caso. La consulta (C) cuenta **el dinero ya tecleado que quedó ilegible**: son precios a **recuperar**, no a borrar. | HUMANO (autoriza ventana y decide migración) · backend (ejecuta) | 2026-09-11 (árbol medido; **producción NO MEDIDA**) | `docs/BACKEND_NOTES.md`, sección P-79(d), consultas A/B/C |
| **P-83** | ⚠️ **La llave `'sealed'` no distingue un producto de otro, y eso bloquea el arreglo del último eslabón** (`inventory.service.ts:1557`, el `gk ? … : undefined` que deja el override ilegible cuando no hay mapeo). Backend lo dejó **explicado y sin tocar**, que es lo correcto, con tres mediciones: **(1)** `PriceReference` **no tiene** columna `sealedProductId` (sí la tiene `PendingPriceEntry`), así que dos sellados no mapeados anclados a la misma carta **comparten fila** — leerla valuaría un ETB con el precio de un blíster; **(2)** el precio derivado de publicación **no se persiste** (el storefront re-resuelve en lectura) y el mismo patrón está en `catalog.service.ts:614`, `sealed-catalog.service.ts:128`, `vault.service.ts:372` y `admin.service.ts:944`, así que arreglarlo **solo** en la publicación cambiaría un bucle por un **precio fantasma**, que es peor; **(3)** el fallback sí tiene precedente, pero solo en una **valuación agregada** (`admin.inventoryValue()`), no en un precio de venta al cliente. Dos opciones planteadas por backend, **decide el arquitecto** (schema + contrato, regla 9): dar identidad a `PriceReference` con fallback simétrico en **todos** los lectores, o prohibir el alta de sellado sin mapeo y curarlo en M2 antes. | **arquitecto** → backend | 2026-09-11 (medido por backend, tres mediciones citadas) | `inventory.service.ts:1557`; `schema.prisma` (`PriceReference`); `docs/BACKEND_NOTES.md` sección P-79(d) |
| **SEC-SB-1 / C9** | ✅ **ARREGLADO EN CÓDIGO el 2026-09-11** (`dbb8e46`), y **el hallazgo resultó MÁS ANCHO de lo que decían los dos informes de seguridad**. Backend confirmó al equipo azul con medición propia (la migración M-53 no lleva ni un `UPDATE`, así que en el instante del despliegue **toda** pieza reservada nació sin dueño, tuviera diez minutos o seis semanas) y aportó lo que ninguno de los dos había visto: el filtro del barrido legado **no era «bóveda sí, envío directo no»**, era `guestEmail IS NOT NULL`. O sea que **un usuario CON CUENTA tampoco se barría, en sus dos modos de entrega**. El hueco era toda orden `pending` de un usuario registrado. Mutaciones **3/3 rojas** en las tres (quitar la cobertura nueva, quitar el plazo, quitar el estado), y cada una cae exactamente donde debe. No suelta lo que tiene dueño vivo: exige `pending`, fuera de plazo de pago, y que el intento de pago quede cancelado. ⚠️ **NO MEDIDO y es del dueño**: cuántas piezas están atascadas hoy en producción — consultas (A) y (B) en `docs/BACKEND_NOTES.md` §SEC-SB-1.4, para ventana autorizada. **Efecto en RSV-L1**: su contador antes **solo bajaba a mano**, ahora baja solo para tres de las cuatro clases; la cuarta (pieza sin orden `pending`) no la drena nadie, pero backend midió que no debería existir en producción porque **ningún camino de la aplicación borra una orden**. | backend (hecho) · HUMANO (ventana para contar) | 2026-09-11 (código medido; **producción NO MEDIDA**) | `docs/BACKEND_NOTES.md` §SEC-SB-1; `backend/test/integration/vault-legacy-reservation-sweep.e2e-spec.ts` |
| **INFRA-SMOKE** | ⚠️ **La suite `infra-smoke` está roja en la línea base, no por el cambio de nadie** (medido por backend el 2026-09-11 al correr sus gates sobre copia limpia): el S3 local responde `200/204` donde el spec espera `403`. Falla **igual sin los ficheros del agente**, así que no es regresión: es el arnés. | devops | 2026-09-11 (medido en línea base) | correr `infra-smoke` sobre `HEAD` limpio |
| **MEDICIÓN-PROD 2026-09-12** | ✅ **Los cuatro conteos de producción, corridos por el DUEÑO en la consola de Railway con un rol de solo lectura que creó él** (`tcg_readonly`, SELECT sobre seis tablas). Resultados: **(1) piezas `reserved` con `reservedByOrderId IS NULL` = 0**; **(2) expedientes con INE = 1, de los cuales con llave de forma NO canónica = 0**; **(3) pendientes de sellado escalados con la llave genérica y con `sealedProductId` = 5**; **(4) `PriceReference` con `gradeKey='sealed'` e `isManualOverride` = 4**. **Qué cierra cada uno:** (1) cierra la **primera mitad de RSV-L1** —su condición de retiro era exactamente ese conteo a 0— y cierra **C8** de `SEC-SB-1`: **no hay inventario atascado que rescatar**, el arreglo del barrido queda como preventivo. (2) **cierra la decisión que yo había escalado al dueño sobre migración de datos de `SEC-PII-1`**: la compuerta rota **nunca se explotó**, la única llave existente salió de nuestro presign ⇒ **no hace falta backfill, ni re-pedir documentos, ni marcar filas**. (3) y (4) son el residuo de **P-79(d)**, y son **pequeños y reparables**: nueve filas en total. ⚠️ **Lo que estos números NO dicen** (O-1): (2) mide la **forma** de la llave, no que el objeto exista en R2 — eso exige `HeadObject`, que desde el entorno del orquestador **no se puede correr** (medido: solo sale TCP 443, la conexión a Postgres y a S3 por otros puertos está bloqueada). Con **un solo** expediente, el riesgo residual es despreciable. | orquestador (mide) · backend (repara 3 y 4) | **2026-09-12 ~05:00 UTC (corrido por el dueño, leído por el orquestador)** | consola de Railway, servicio Postgres; consultas en este mismo commit |
| **P-79 (d) · DIAGNÓSTICO** | ⏸️ **Esperando que el DUEÑO corra la marcha en seco.** El guion está escrito, ensayado y commiteado (`8f8c35c`, `backend/prisma/data-repair/20260912_p79d_llave_de_precio_del_sellado.sql`), con su reversa hermana. **Verificado por el orquestador**: abre transacción en la línea 66 y **termina en `ROLLBACK`** ⇒ tal como está, **enseña y no escribe**. Cuatro escrituras, todas dentro de esa transacción. Ensayo del agente sobre base desechable con las cuatro variantes: **3/3**. ⚠️ **NO MEDIDO, y es el punto**: el guion **nunca ha corrido contra los datos reales**, así que **cómo se reparten las 4 filas de precio entre los cuatro veredictos (se corrige / ambigua / sin candidato / colisión) es desconocido**. El PASO 1 **es la medición**, no un trámite. Las 5 de la cola sí se reparan enteras sin ambigüedad (`SealedProduct.tcgplayerProductId` es `NOT NULL`). **Ya no crece**: el arreglo se publicó el 2026-09-12 en `9050d59`, así que el defecto dejó de escribir filas nuevas. Las nueve viejas siguen. **Aplicar toca dinero ⇒ triple veredicto** antes de cambiar la última palabra del fichero. | **HUMANO** (corre el paso 1) → orquestador enruta según el resultado | 2026-09-12 (guion medido; **reparto real NO MEDIDO**) | `backend/prisma/data-repair/`, PASO 1 |
| **P-84** | ✅ **CERRADO Y PUBLICADO en tu tienda el 2026-09-13** (`05ded16`, solicitud #33). Los seis ejes daban `500` — **medido por QA por HTTP**, no leído: la ficha decía «rutas NO ejecutadas» y ninguno estaba protegido aguas arriba. Doble veredicto APROBADO (QA + techlead), ninguna condición bloqueante. Verificado por mí sobre copia del árbol ENTERO: control 291/291 · 4782/4782; dos mutaciones **3/3 rojas** cada una. Dejó abiertas: **P-89** (catálogo, cerrado después), **P-90** (el censo) y `D-EQ-2`. | — (cerrado) | 2026-09-13 (publicado y verificado) | `05ded16`; PR #33 |
| **P-85** | ⚠️ **El back-office tiene DOS contratos opuestos para el mismo parámetro de paginación** (techlead, 2026-09-12). `GET /admin/orders` y `GET /admin/buylist` contestan **`400`** a `pageSize=0` o `pageSize=abc` (`common/admin-list-filters.ts:8-10`, que dice literal «NUNCA se silencia con un clamp»); `GET /admin/users` contesta **`200` con 20**. Y la expresión de acote está **copiada 18 veces en 11 ficheros** mientras el helper validado ya existe en `common/`. Un paginador compartido en el frontend no puede fiarse de ninguna de las dos. La pregunta a decidir es **una**: ¿el back-office valida o acota? Una respuesta, no dos. ⛔ `A5` **no cambia nada** mientras tanto, a propósito. | **arquitecto** (conducta de endpoints publicados, regla 9) | 2026-09-12 (medido por techlead) | `common/admin-list-filters.ts:122-127` vs `admin.controller.ts:151` |
| **P-86** | ⚠️ **Cuatro maneras distintas de validar un enum de query, y la doctrina del proyecto ya dice que eso es la clase abierta** (techlead, 2026-09-12). Medido: **167 `@Query()` sueltos en 18 ficheros** y **un solo DTO de query** en todo el backend (`buylist.dto.ts:314-318`) ⇒ **este endpoint no era el rezagado, era la norma**; y el `ValidationPipe` global corre con `forbidNonWhitelisted: false`, así que un DTO **tampoco** habría cazado el parámetro ignorado. `assertEnumFilter` (`admin.service.ts:66-74`) es la **cuarta** copia del mismo helper; la deuda **H3** ya pide mover `validateEnum` a `common/` y debe nombrar también estos sitios para que la consolidación no deje tres. ⛔ Techlead **no pide extraerlo ahora**: con un solo llamador sería abstracción prematura. Y `UpdateKycDto.kycStatus` (`admin.controller.ts:30`) tiene su lista **a mano y sin clasificar** E-o-R, mientras su vecino de ocho líneas más abajo dedica diecisiete a explicar por qué la suya no se deriva. Ese `@IsIn` es **lo único** que separa un string crudo de Prisma en `admin.service.ts:1127`. | backend (clasifica y engancha a H3) · arquitecto si resulta derivable | 2026-09-12 (medido por techlead) | `docs/TECH_DEBT.md` H3; `backend/src/common/enum-values.ts:33-37` |
| **P-89** | ✅ **CERRADO Y FUSIONADO a `main` el 2026-09-13** (`3c1bd1e`). Catálogo público migrado al validador único: **6/6 ejes** conformes por HTTP **sin token** (QA: 24/24 en el borde), **cero `as never`**, H3 mitad-del-enum cerrada (4→2→0 copias). Doble veredicto APROBADO, ninguna condición bloqueante. QA cerró `N-P89-2`: **ninguna pantalla podía emitir un valor de solo espacios** — el defecto era alcanzable solo por la API pública directa, no por la tienda. ⛔ **NO PUBLICADO**: está en `main`, no en `production`. Su condición de cierre (el censo §0-Q) la cerró el arquitecto en `2e40a8b`. | — (cerrado, sin publicar) | 2026-09-13 (fusionado y verificado) | `3c1bd1e`; `2e40a8b` |
| **P-90** | 🔴 **El censo que se declara «VIGENTE» está desfasado en 12 de sus 14 filas, y le faltan al menos dos ejes — uno en una pantalla de DINERO** (techlead, veredicto de P-89, 2026-09-13; **verificado por el orquestador** leyendo los ficheros). **(a) El censo miente en las dos direcciones.** `docs/API_CONTRACT.md:4977` se rotula «CENSO VIGENTE … se actualiza cuando cambie», y sigue marcando **⛔ «crudo a Prisma»** los seis ejes que P-84 cerró (`:4981-4986`) y **✅ «conforme»** el catálogo citando `catalog.service.ts:1129-1133`, líneas que hoy son **un comentario** (`:4992-4994`). `rg P-89 docs/API_CONTRACT.md` ⇒ **0**. **Y el contrato manda sobre el código** (regla de conflicto): el documento normativo afirma defecto de lo arreglado y conformidad de lo que se midió falso. Es la misma clase que abrió P-89, un nivel más arriba — **tercera repetición en tres días**. **(b) Dos enums de Prisma en query FUERA del censo, con el defecto exacto que P-89 acaba de cerrar.** `GET /admin/pricing/pending?context=` (`pricing.controller.ts:246-252`): `''` pasa el `!== undefined`, no está en la lista ⇒ **lanza**, y lanza **`422`** (`BusinessException.validation`) donde §0-Q ratifica **`400`**. `GET /admin/pricing/bounties?finish=` (`admin-bounties.controller.ts:102-108`): `''` ⇒ **`400`** donde §0-Q fila 1 manda **`200`**. ⚠️ **`pending` es la cola de precios pendientes: pantalla de dinero.** Lo que lo delata: en el mismo controlador, `state` (`:88`) y `sort` (`:112`) **sí** descartan el vacío y `finish` no — nadie decidió eso. **NO MEDIDO por HTTP**: los tres lo hemos leído, ninguno lo ha ejecutado. Cierra: la misma suite que P-89 ya escribió, apuntada a esas dos rutas. | **arquitecto** (censo §0-Q, **bloquea el cierre de P-89**) · backend (`H3-d`: los dos ejes de pricing) | 2026-09-13 (leído por techlead y por mí; **no ejecutado**) | `API_CONTRACT.md:4977,4981-4994`; `pricing.controller.ts:246-252`; `admin-bounties.controller.ts:88,102-108,112` |
| **P-91** | ⚠️ **«Contra mocks se ve bien» era FALSO — y yo se lo conté al dueño** (frontend, `D-EQ-3`, 2026-09-13; **verificado por el orquestador**). `docs/API_CONTRACT.md:7066` afirma que el filtro de sellado en la rejilla de singles «contra **mocks** **sí devuelve tejas**, así que la pantalla se ve bien en desarrollo y vacía contra el servidor». **Medido por frontend renderizando `CatalogView` en modo mock con `?productType=sealed`: `tejas=0`, `vacío=true`, «Sin resultados» — IDÉNTICO al servidor real.** Causa: los fixtures sí traen sellado (`fixtures.ts:551,562`), pero `groupMockListings` **ya filtra aguas abajo** — `fixtures.ts:721` deja pasar solo `raw|graded` (paridad H9). Verificado por mí en esa línea. **El mock NO miente aquí.** Qué cambia y qué no: cae el *argumento de urgencia* que yo repetí al dueño; **sigue en pie entero el orden** (frontend primero, backend después: si el servidor responde `400` antes, el enlace pasa de «vacío» a «roto»). Es la misma clase que P-89/P-90 — afirmación obtenida leyendo, usada como medida — **quinta vez en tres días**. Deriva: (a) **arquitecto** corrige `:7066`; (b) **ux-ui**: `DESIGN_SYSTEM §7.16(c)` sigue describiendo el filtro de tipo como «Todo · Raw · Graded · Sellado» con sub-filtro, y contradice al contrato v1.73 y al código; (c) **arquitecto**: queda medida su «PREGUNTA ABIERTA» de `:7170` — con sellado publicado, `GET /catalog/facets` **sí** anuncia `productTypes:["sealed"…]` y `sealedSubtypes:["box"]` que la rejilla ya no acepta (inerte hoy: cero consumidores en el front). | arquitecto (a, c) · ux-ui (b) | 2026-09-13 (medido por frontend con navegador y en modo mock; re-verificado por mí en `fixtures.ts:721`) | `API_CONTRACT.md:7066,7170`; `fixtures.ts:721`; `DESIGN_SYSTEM §7.16(c)` |
| **P-92** | ⚠️ **La suite de frontend tiene una roja intermitente que nadie ha identificado** (orquestador, 2026-09-13). Medido por mí sobre copia del árbol ENTERO en `431e03a`: **5 tiradas ⇒ 4 verdes (1754/1754, exit 0) y 1 con una sola roja (1753/1754)**. ⛔ **NO MEDIDO: cuál prueba.** Fallo de mi medición — corrí la primera tirada con `--silent` y perdí el nombre; las cuatro siguientes salieron verdes y no volvió a aparecer. No lo introdujo `D-EQ-3` (su mutación da **3/3 rojas** limpias y el control **1754/1754**). Una intermitente ~20% en una suite que es gate **no distingue «el candado sirve» de «tuve suerte»** (O-3). Cierra: 10 tiradas capturando el nombre del fichero, y el arreglo al rol dueño de esa prueba. | orquestador (identificar) → rol dueño | 2026-09-13 (proporción medida 4/5; **prueba NO identificada**) | `frontend/`; copia en `431e03a` |
| **P-93** | ✅ **CERRADO (`EQ-D0`, 2026-09-13; verificado por el orquestador el 2026-09-16).** La bóveda del cliente ya no ignora los filtros: `vault.service.ts` migró a `parseEnumFilter` (`sealedSubtype`/`condition`/`sort`) con `switch` exhaustivo — fuera de dominio ⇒ `400`, el orden ya no clampa. Verificado por mí leyendo `vault.service.ts:358-361` (usa `parseEnumFilter`, `SEALED_SUBTYPE_VALUES`/`SEALED_CONDITION_VALUES`). Cubre los 4 ejes de cliente + los 3 gemelos de `/admin/vaults/:id/sealed`. ⛔ **NO MEDIDO si está PUBLICADO en `production`** — el arreglo está en el árbol de trabajo. | — (cerrado) | 2026-09-13 (cierre) · re-verificado 2026-09-16 | `vault.service.ts:358-361`; ficha `EQ-D0` en `docs/TECH_DEBT.md:7166` |
| **EQ-D1** | 🟡 **22 ejes de dominio cerrado que el registro no conocía → 12 abiertos** (backend, `C-EQ-1`, 2026-09-13; batch 1 el 2026-09-16). **Trinquete `C-EQ-1`: 22 → 16** (la bóveda `EQ-D0` pagó 6) **→ 12** (este batch pagó 4). **Batch 1 (rama `claude/fix-eqd1` @ f34e6ec3, no-dinero, verificado por el orquestador — usa `parseEnumFilter`, cero ficheros de dinero tocados):** `?kind=` (envíos), `?scope=` (auditoría), `?sort=` de los **dos catálogos públicos** (`/catalog/cards`, `/catalog/sealed`) — cada uno con su fila §0-Q escrita por el arquitecto (contrato v1.77) y sus 7 propiedades verdes en el censo. Agente reportó integración 45/45·976/976, censo 303/303, mutación muerde 4/303. **Quedan 12**, con la clase YA decidida para todos los `?sort=`/`?range=` (§0-Q v1.77): **migrar código, no decidir**. Los 3 de DINERO —`?report=` ×2 (finanzas: devuelve OTRO informe) y `graded-estimates/review?reason=`— exigen los **tres veredictos** al migrarse. Resto: `?range=` ×4 (clamp silencioso a `1m`), `?sort=` ×4 (master-sets + `/admin/vaults`), `?sealedSubtype=` de `/catalog/cards` (se **retira**, ver `EQ-D3`). | backend (migrar los 12; DINERO → 3 gates) | batch 1: 2026-09-16 (verificado por mí, listo para revisión) | `claude/fix-eqd1` @ f34e6ec3 (`compare/main...claude/fix-eqd1`); `docs/TECH_DEBT.md` ficha `EQ-D1` |
| **P-94** | 🔴 **AL RECHAZAR UNA IDENTIDAD NO SE LE AVISA AL CLIENTE POR NINGÚN CANAL** (hallado por el DUEÑO revisando en su tienda, 2026-09-13; **medido por el orquestador**). Medido: el sistema entero tiene **cuatro** plantillas de correo —`Verify your email` / `Verifica tu correo` y `Reset your password` / `Restablece tu contraseña`— y **cero** de KYC (`grep -rn kyc backend/src/modules/mail/` ⇒ **0**). No hay centro de notificaciones (`grep -rli notification` en `backend/src/modules` y `frontend/src/app` ⇒ **0 ficheros**). ⇒ El cliente **solo se entera si entra al portal por su cuenta**. El dueño confirmó que ahí sí se ve («del lado del cliente sí se ve la INE rechazada y pide volverla a subir»), así que el estado llega — pero **nadie lo empuja**. Un rechazo silencioso con motivo escrito es un motivo que nadie lee. **El lazo SÍ cierra** (medido, `users.service.ts:444`): resubir la INE devuelve `kycStatus` a `pending`. Lo que falta es el aviso, no el circuito. | **product-owner** (alcance: correo y/o portal) → arquitecto → backend+frontend | 2026-09-13 (medido por el orquestador; el dueño lo vivió) | `backend/src/modules/mail/mail.templates.ts` (4 subjects, 0 de KYC); `users.service.ts:444` |
| **P-95** | ⚠️ **Se puede rechazar la misma identidad N veces seguidas sin que el cliente haya hecho nada** (hallado por el DUEÑO: «rechacé dos veces en menos de un min»; **medido por el orquestador**). Medido en `admin.service.ts`: el `upsert` usa `where: { userId }` y `update: decision` **sin mirar el estado actual** — valida el motivo (3–500 chars, obligatorio) pero **no comprueba si ya estaba rechazado**. Cada rechazo re-sella `reviewedAt`/`reviewedBy` y **genera una fila de auditoría**. ⚠️ **Hoy es inofensivo por el motivo equivocado: porque P-94 no manda nada.** En el momento en que exista el correo, esto son **N correos de rechazo en un minuto** a alguien que no ha podido contestar. **El orden importa: la guarda entra CON el aviso, o antes — nunca después.** Decisión de producto, no de implementación: ¿rechazar sobre rechazado es error, es no-op, o es una corrección legítima del motivo? El dueño lo planteó como «bloquear el status». | **product-owner** (decide) → arquitecto → backend | 2026-09-13 (medido: sin guarda de estado) | `backend/src/modules/admin/admin.service.ts` (`upsert`, `where: {userId}`, `update: decision`) |
| **P-96** | 🟢 **CENTRO DE AVISOS — encargo del DUEÑO, 2026-09-13. Alcance dicho por él, verbatim.** ⛔ **No es un correo de rechazo: es el sistema entero.** Sus palabras: *«Quiero correo y que haya también en el portal para notificar, no solo esto sino también todos los avisos que mandamos que valgan la pena. Es lo primero que ve un cliente cuando entra a su cuenta: qué cambios hubo. Tal vez en la bóveda, falta su KYC — que ahí se le notifique. Cambios en su solicitud de lo que nos vende, etc.»* **Dos canales** (correo **y** portal), **dominio abierto de eventos** (no solo KYC), y una tesis de producto suya que manda sobre el diseño: **el aviso es lo PRIMERO que ve el cliente al entrar a su cuenta**, no una campanita escondida. Eventos que él nombró: **bóveda**, **KYC pendiente/rechazado**, **solicitud de venta**. El «etc.» es suyo: el catálogo de eventos lo define el product-owner y lo aprueba él. **Absorbe P-94** (no se avisa por ningún canal; medido: 4 plantillas de correo en todo el sistema, 0 de KYC, 0 ficheros de notificaciones) y **condiciona P-95** (se puede rechazar N veces: la guarda entra **con** el aviso o antes, nunca después — hoy es inofensivo solo porque no se manda nada). ⛔ **Bloqueado por O-14 hasta que QA y techlead entreguen**: `PROJECT.md` lo leen **10 suites** (medido), así que el product-owner no puede escribir mientras un gate mide. | **product-owner** (catálogo de eventos + canales, borrador para el dueño) → arquitecto → backend+frontend | 2026-09-13 (alcance del dueño; **nada medido de implementación**) | `mail.templates.ts` (4 subjects, 0 de KYC); `grep -rli notification` ⇒ 0 |
| **O-14-b** | ⚠️ **`CLAUDE.md` NO es un fichero libre: lo leen 4 suites** (orquestador, 2026-09-13, medido al auto-auditarme). `backend/test/sell-request-states.spec.ts`, `backend/test/enum-values-parity.spec.ts`, `frontend/src/lib/mock/admin-bounties-mock.test.ts`, `frontend/src/lib/mock/fx-contract-mirror.test.ts`. Escribir mis propias reglas **mientras un gate mide** movería el suelo bajo sus pies igual que lanzar construcción — que es exactamente lo que O-14 prohíbe. **Medido a favor:** `PENDIENTES.md` **no lo lee ninguna suite**, así que mis commits de índice durante los gates de hoy eran seguros; y `91d4318` (O-14/O-15 en `CLAUDE.md`) se commiteó con **cero gates vivos**. No hubo incumplimiento — pero el hueco estaba abierto. Cierre: añadir la frase a O-14 la próxima vez que se toque `CLAUDE.md` **sin gates corriendo**. | orquestador | 2026-09-13 (medido) | `grep -rln CLAUDE.md backend/test frontend/src` ⇒ 4 ficheros |
| **P-97** | ⚠️ **M8 · Disputas se ve como una pantalla ROTA cuando simplemente está vacía** (hallado por el DUEÑO con captura, 2026-09-13; **medido por el orquestador**). Medido: `M8View.tsx:87` hace `(query.data ?? []).map(...)` **sin rama de vacío** ⇒ con cero disputas la pantalla pinta **el título y nada más**. Su hermana M4 sí la tiene y el dueño la vio en la misma sesión («Sin envíos con ese filtro», «Nada que preparar por ahora»), así que el contraste es visible y la incoherencia también. **Segundo hallazgo del mismo vistazo:** `getAdminDisputes()` (`frontend/src/lib/api.ts:4079`) **no acepta ningún argumento y no manda query**, y `M8View.tsx` **no tiene control de filtro**. El dueño lo dijo exacto: *«en disputas no hay nada que filtrar»*. El backend sí expone `?status=` — o sea que el eje existe en la API y **no existe en la pantalla**. | **frontend** (estado vacío) · ux-ui (si el filtro debe existir) | 2026-09-13 (medido por el orquestador sobre la captura del dueño) | `M8View.tsx:87`; `frontend/src/lib/api.ts:4079` |
| **O-14-c** | 🔴 **MIS INSTANTÁNEAS DE SEGURIDAD LE ROMPIERON LA MEDICIÓN A UN AGENTE — y lo detectó él, no yo** (orquestador, 2026-09-14). A mitad del pase de `D-AVISO-2` commiteé `64a70f7` («wip … NO verificada») **con el arreglo del agente dentro**. Él hizo la ablación —restaurar el código defectuoso para comprobar que su candado muerde— con `git show HEAD:<fichero>`, y `HEAD` **ya era mi instantánea con el arreglo**: salió **verde 10/10** y estuvo a punto de concluir que «la ventana depende de la carga». Falso. Lo rehízo con el **sha literal** y obtuvo el rojo real. Su frase, que es la regla: ***«Una ablación vale lo que vale el sha que restaura; nunca `HEAD` en árbol compartido.»*** ⚠️ **La clase:** O-14 dice que mientras un gate mide, el **árbol** es su instrumento. Esto añade el recurso que no contemplaba: **el HISTORIAL también lo es**. Un commit mío sobre trabajo ajeno en vuelo mueve el suelo de toda ablación que se ancle en `HEAD`. ⚠️ **Y el contexto que lo hace difícil:** las instantáneas las hago porque un gancho de la sesión exige el árbol limpio en cada parada, y porque un contenedor reciclado pierde el trabajo entero (O-10). **No es que sobren: es que tienen un coste que no estaba medido y ahora sí.** Mitigación inmediata, ya aplicada en los encargos: **todo encargo que pida ablación o mutación dice que se ancle en un SHA literal, nunca en `HEAD`**. Pendiente de decidir: si además conviene que las instantáneas vayan a una rama aparte en vez de a la rama de trabajo. **NO MEDIDO:** cuántas otras mediciones del día se anclaron en `HEAD` y pueden estar contaminadas por la misma causa. | **orquestador** | 2026-09-14 (medido por el agente de `D-AVISO-2`; verificado por mí en el historial: `64a70f7` precede a `dd3522b` y contiene el arreglo) | `git log --oneline 64a70f7 dd3522b`; `docs/BACKEND_NOTES.md` §BE-AV2 |
| **O-5-bis** | 🔴 **DOS de las TRES preguntas «abiertas» que le llevé al dueño YA ESTABAN CONTESTADAS — él me lo dijo, yo lo medí, y tenía razón** (orquestador, 2026-09-14). Él escribió: *«Checa bien mis respuestas, según yo ya respondí esas.»* **Medido:** **(86)** qué le pasa al pedido y a la bóveda en un contracargo está decidido en `PROJECT.md` en **cuatro sitios** (`:1477` «revierte la carta al inventario y refleja el estado de la orden»; `:2129` «contracargo revierte al inventario»; `:6868-6869`; `:7029` `contracargo` es estado vivo de M3). **No había nada que decidir.** **(87)** los seis motivos de rechazo **ya están en su pantalla y él los usó esta semana** — `KycRejectDialog.tsx:20` y `frontend/messages/es.json` («No se alcanza a leer…», «Falta una de las dos caras de la INE.», «La foto no es de una INE.»…). Pedirle que aprobara lo que ya usaba. **Solo la 85 (redacción de la regla de canal) nació de verdad después de sus respuestas, y no cambia ni un correo.** ⚠️ **La clase:** el product-owner levantó la 86 y el arquitecto la arrastró **sin re-medir si ya estaba contestada**, y **yo se la relayé al dueño DOS VECES sin comprobarlo** — es O-5 incumplida por mí al relayar, igual que O-15 nació de relayar una proporción ajena. *Una pregunta que afirma que algo no está decidido es una afirmación de estado, y O-1 le aplica entera.* Cierra: antes de llevarle una pregunta al dueño, `grep` del término en `PROJECT.md` y en `HECHOS.md`, y la pregunta cita esa medición o no se hace (O-6). | **orquestador** | 2026-09-14 (medido por mí tras su refutación; él tenía razón) | `PROJECT.md:1477,2129,6868-6869,7029`; `KycRejectDialog.tsx:20`; `frontend/messages/es.json` |
| **P-98** | ⚠️ **En ESPAÑOL, un importe NEGATIVO pierde el «MX» — helper compartido de DINERO** (hallado por **frontend** al construir la pantalla del dial de IVA, 2026-09-14; **medido por el orquestador**). `frontend/src/lib/format.ts:16` normaliza con `.replace(/^\$/, 'MX$')`, anclado en `^`: con signo delante el ancla **no coincide** y el símbolo se queda en `$`. Medido por mí ejecutando `Intl.NumberFormat` con los mismos parámetros: `es` `-690` ⇒ Intl `"-$6.90"` ⇒ normalizado **`"-$6.90"`** (pierde `MX`); `es` `690` ⇒ `"MX$6.90"` ✅; `en` `-690` ⇒ `"-MX$6.90"` ✅. ⚠️ **Solo en español, que es el idioma del dueño y el de su tienda**, y `$` a secas se lee como dólar. Alcance **NO MEDIDO**: cuántas superficies muestran hoy un importe negativo. ⛔ **Frontend NO lo arregló a propósito y con criterio**: es superficie de dinero de media app y había dos agentes backend escribiendo el mismo árbol (O-12); compuso el signo localmente (`signedMoneyCents`, `−` U+2212) para su pantalla y lo enrutó. Cierra: arreglar la normalización para que no dependa del ancla, con prueba de los cuatro casos de arriba. | **frontend** (dueño de `frontend/src/lib/`) | 2026-09-14 (medido por el orquestador ejecutando `Intl`, no leyendo) | `frontend/src/lib/format.ts:16`; `node -e` con los cuatro casos `es/en × ±690` |
| **O-1-bis** | 🔴 **MIS PASOS DE REVISIÓN ERAN IMPOSIBLES DE EJECUTAR, y la severidad que le conté al dueño estaba inflada** (orquestador, 2026-09-13, medido tras las capturas del dueño). Le di como pasos de verificación *«pega `?status=banana` en la barra de direcciones de M3/M4/M8/M1»*. **Medido: ninguna de esas pantallas lee la barra de direcciones** — `grep useSearchParams` en `m3`, `m4` ⇒ **cero**; `m1` solo lee `?tab=`. El frontend manda `status` desde su **desplegable**, que solo ofrece valores válidos (el dueño lo vio: *«en retiros es una dropdown list, no se puede tipear»*). ⇒ **Los pasos 1 a 6 de la lista no podían hacerse.** Y peor: repetí en tres cuerpos de solicitud de fusión que el `500` de P-84 era *«disparable desde la barra de direcciones por cualquiera con sesión de admin»*. **Para esas cuatro pantallas es falso**: hace falta llamar a la API directamente (`NEXT_PUBLIC_API_BASE_URL`, otro host), no escribir en la barra del navegador. El defecto era real y el arreglo correcto; **la vía de explotación que describí, no**. ⚠️ **Lo que SÍ se sostiene y no se toca:** P-89 (catálogo) es **público y sin sesión**, y eso lo medí yo por HTTP — esa severidad era correcta. | orquestador (corregir la lista y el relato) | 2026-09-13 (medido: `useSearchParams` ⇒ 0 en m3/m4) | `m3`,`m4` sin `useSearchParams`; `api.ts:3995,1229` mandan `status` desde el desplegable |
| **P-87** | 🔴 **La base de datos compartida de integración está sucia y produce 15 rojas FALSAS** (QA, 2026-09-12, y es la **segunda vez** que esa trampa produce un reporte falso en este proyecto). Medido: sobre `tcg_marketplace` compartida, **3 suites / 15 pruebas en rojo** con errores del tipo `Expected "Av. E2E 123" / Received "Calle Nueva 456"` — residuo de sesiones anteriores en `buylist`/`pricing`/`graded`. Sobre **base virgen** (`tcg_qa_a5`): **34/34 suites, 509/509, exit 0**. Ya produjo antes el reporte de «3 rojos preexistentes» que la propia QA refutó. Cierre: que `test:integration` **cree base efímera**, o un `--fresh-db` documentado; comprobación = **dos corridas seguidas sobre la misma base salen verdes**. | **devops** | 2026-09-12 (medido por QA, las dos configuraciones) | `backend/package.json` (`test:integration`); `scripts/stack-native.sh` |
| **Stream C** | El disco (P-53) | backend | 2026-09-11 | ídem |
| H1 | Protección de ramas `main`/`production` (required checks `ci-ok`/`sast-ok`/`e2e-ok`; ruleset JSON en `docs/DEVOPS_NOTES.md` §56.8). Consecuencia: un push directo solo pasa si el SHA ya tiene los 3 checks verdes — **DECISIÓN DEL DUEÑO**. **Evidencia NUEVA 2026-09-13 (medida por el orquestador):** la publicación `9050d59` (PR #31, el KYC) **salió a producción con CI en ROJO y nadie lo vio** — run `34692360680`, job `format-mix` en `failure` ⇒ `ci-ok` en `failure`. Sin protección de ramas, un check rojo **no impide publicar**: solo lo impide que alguien lo mire. La publicación siguiente (`d6b31cb`) salió verde en los tres (`34737215436`/`34737215437`/`34737215464`), así que la condición está cerrada — pero **el agujero que la dejó pasar no**. | HUMANO (decide) · devops (activa) | **2026-09-13** (re-medido: rulesets sigue `[]`; + el caso real de `9050d59`) | `GET /repos/…/rulesets` → `[]`; run `34692360680` job `format-mix`=failure, `ci-ok`=failure |
| **P-88** | ⚠️ **Un formateador automático ad-hoc mezcló reformateo con lógica en un fichero de dinero, y el candado que lo caza salió rojo sin dueño** (orquestador, 2026-09-13). Medido sobre el run `34692360680` (publicación `9050d59`): `check-format-mix.sh` marcó `backend/src/modules/admin/admin.controller.ts` — **128 líneas de cambio real** escondidas entre cientos de líneas de reformateo. Eso es exactamente lo que BL-27 existe para impedir: **el gate de seguridad y el techlead revisan POR DIFF**, y una línea de dinero entre cientos de reformateo no se ve. **El candado hizo su trabajo** (se puso rojo, con el fichero exacto); lo que falló fue que **nadie miró la roja** (⇒ H1). **Estado hoy:** el fichero ya quedó formateado, así que `d6b31cb` salió **verde** en `format-mix` — la mezcla no se repite. Queda abierto **por qué** pasó: `npm run lint` **no corre prettier** (el `extends: ['prettier']` de eslint apaga las reglas de formato a propósito), así que nada impide que un agente vuelva a pasar un prettier ad-hoc. Cierra: que el encargo a los agentes prohíba el formateo ad-hoc, o que el candado corra **antes** del commit, no después del push. | orquestador (encargo) · devops (si se mueve el candado) | 2026-09-13 (medido sobre el run real) | `scripts/check-format-mix.sh`; run `34692360680` job `format-mix`; `docs/DEVOPS_NOTES.md` §36 |
| DO-D4 | `dast-release` en `report_only: true` hasta que **seguridad** lo suba a bloqueante; caduca el **2026-10-06** (job `dast-report-only-expiry` pone rojo CI) | seguridad (decide) · devops | 2026-09-11 | `grep -c 'report_only: true' .github/workflows/deploy.yml` |
| Deuda gates 2026-09-11 | Fichas nuevas con comprobación de cierre: backend BE-82..87, frontend GA-D1..D7, devops DO-D1..D10 (incl. DO-D2/DO-D3: se cierran con el primer push real a `production`) | rol dueño de cada ficha | 2026-09-11 | `docs/TECH_DEBT.md` bloques «… · 2026-09-11 · gates …» |
| Arquitecto (post-A) | Peticiones abiertas del stream: `orderNumber` en `OrderSummaryDTO`/`OrderDetailDTO` (hoy la columna PEDIDO muestra UUID contra backend real); `customer {id,name,email}` en fila de M4; BE-82 (`details.field` en «ausente» requiere `exceptionFactory`); preguntas §4.47.9 al dueño (allowlist de `PATCH /users/me`, edición de nombre por admin, correos del buylist con nombre derivado) | arquitecto → backend/frontend | 2026-09-11 | `docs/FRONTEND_NOTES.md` §68.4; `docs/ARCHITECTURE.md` §4.47.9 |
| P-IVA-INCL | Precio con IVA incluido, sin línea aparte. **DEPLOY 2 SÍ está especificado** en contrato (§M10-IVA.6, `docs/API_CONTRACT.md:17107-17121`); falta implementarlo y la decisión de «cómo se muestra» | product-owner → arquitecto → frontend+backend | 2026-09-11 | `AmountBreakdown.tsx:82`, `orders.service.ts:592` (`IVA_EXCLUSIVE`); cero escritores de `IVA_INCLUSIVE` en producción |
| P-BL | Stream buylist v1.59/v1.60: **1 de 7 cerrado** (`legalName`, `admin.service.ts:47,55-68`). §M5-D abierto (las 4 estructuras siguen); §M5-A **desalineado**: backend emite `scope: per_request`/`per_request_offer` (`buylist.service.ts:1585,3587`) y el frontend ya los retiró (`error-audience.ts:42`); §M5-I, boundary, BL-42, D50 abiertos | backend (arquitecto para D50) | 2026-09-11 | `grep -n BUYLIST_CAP_PER_REQUEST_CENTS backend/src/modules/settings/settings.constants.ts` → `:77,289,949,1058`; `HISTORIAL.md:110-166` |
| P-53 | Disco: `PriceReference` una fila/producto/día; `evidenceDate` **ni se escribe ni se lee** (9/9 hits son el DTO de un proveedor) | backend | 2026-09-11 | `backend/src/modules/catalog/card-product-resolver.service.ts:201,218-233`; `schema.prisma:967` |
| P-56 | Wishlist (money-critical) — cero rastro en el árbol | arquitecto → backend+frontend | 2026-09-11 | `grep -rni wishlist backend/src frontend/src docs` → 0; falta alcance (product-owner) |
| P-58 | «Marcar recibida»: el botón vive **solo en `cotizada`** (el paso equivocado, `M5View.tsx:991`), no «en cualquier estado»; el servidor sí acepta desde cualquier estado vivo (`buylist.service.ts:5492` → `liveRequestWhere()` `:5654`) | frontend (mitad 1) · arquitecto → backend | 2026-09-11 | `buylist.service.ts:5492,5654`; `M5View.tsx:991-1001` |
| P-59 | La reserva no conoce a su dueño: `where` sin eje de usuario/sesión; invitado ni escribe titularidad | arquitecto → backend | 2026-09-11 | `orders.service.ts:431,436`; `guest-checkout.service.ts:141`; TTL `guest-checkout.constants.ts:43` |
| P-60 | Entregabilidad: falta DMARC | **HUMANO** (DNS) | — | registro DMARC en el DNS de `tcghunt.mx` |
| P-61 | Catálogo de Vender se ve chico: carrito lateral fijo de 360 px en escritorio; drawer solo móvil | ux-ui → frontend | 2026-09-11 | `BuylistView.tsx:323,350-352,386-387` |
| P-65 | Fotos 5–10 s: los cuatro eslabones siguen en serie; cuál pesa NO MEDIBLE sin levantar la app | frontend; arquitecto si toca API | 2026-09-11 | `(storefront)/page.tsx:1`; `(storefront)/_home/FeaturedCarousel.tsx:708`; `CardImage.tsx:72-78` |
| P-66 | Panel de admin: **8 de 9 puntos abiertos** (B2 requiere navegador); ni el copy «beta cerrada» aprobado por el dueño se corrigió (`es.json:2539`) | ux-ui → frontend | 2026-09-11 | cuerpo del ítem; `git diff --stat 9ff373f..HEAD -- "(admin)"` = solo M10 y M2 |
| P-67 | Inventario de datos para analytics — no existe doc ni sección | arquitecto/backend → product-owner | 2026-09-11 | `ls docs/`; `grep -rni analytics docs/ PROJECT.md` → 0 |
| P-68 | FX: modo por defecto = centinela `legacy`; lo decide `fx_manual_override_rate`; fallback duro 18 | devops (consulta) · backend | 2026-09-11 | `fx-mode.ts:285-293` (antes `:157`), `:56,380`; `fx.service.ts:153-154,340` (antes `:85`); la SQL vive solo en el cuerpo |
| P-69 | Precio de mercado se pierde entre paso 1 y 2 al subir sellado; `sealedPriceSource` viaja y nadie lo consume | backend/frontend | 2026-09-11 | `SealedAddFlow.tsx:172`; `sealed-product.service.ts:65` (antes `:63`); `grep sealedPriceSource SealedAddFlow.tsx` → 0 |
| P-70 | Decks Meta — **bloqueante CAMBIÓ**: `pricing-iva-v2.1` ya tiene cuerpo (= `PROJECT.md` §Q / D54, `:5708-5714`); encadenado a P-IVA-INCL DEPLOY 2 publicado | product-owner → … | 2026-09-11 | `docs/specs/DECKS_META_V1.md:14`; `money.ts:379` (antes `:374`); `API_CONTRACT.md:17109` |
| P-71 | Código corto del set: `ptcgoCode` se guarda y **nadie lo lee** (cero en `frontend/src` y en el contrato) | backend (ingesta) + frontend | 2026-09-11 | `schema.prisma:510` (antes `:497`); `catalog-sync.service.ts:1294,1304` (antes `:918`) |
| P-72 | «SIN PRECIO RESOLUBLE» dice dos cosas: el DTO de la cola no lleva `pendingReason` (`contract.ts:2396-2414`); copy único `es.json:1232` | frontend + arquitecto | 2026-09-11 | `pricing.service.ts:877`; `pricing-curve.ts:566-574`; `inventory.service.ts:359-360` |
| P-46 | Sincronizar sellado «0 presentaciones»: **CERRADO EN CÓDIGO** (`47c97c1`, dentro de `c13f417`: match tolerante al prefijo, `sealed-product.service.ts:777-798`). **Falta verificar en producción** (sync de Pitch Black / Chaos Rising) y el follow-up de frontend (guiar al linker cuando da 0). Singles siguen sin el arreglo (`card-product-resolver.service.ts:225-238`) | HUMANO/orquestador (verificar) · frontend (follow-up) | 2026-09-11 | correr la sync en producción y contar presentaciones |
| Razón social | Footer imprime «TCG HUNT · tcghunt.mx · © 2026» sin placeholder (`layout.tsx:58-65`, `footer.ts:13-18`); falta el dato del dueño | **HUMANO** | 2026-09-11 | `es.json:11` / `en.json:11` |
| Seguridad · release A | **Veredicto 2026-09-11 sobre `abecf73`: APROBADO CON CONDICIONES para modo prueba; dinero real BLOQUEADO** por: **C6** (devops + humano: en ventana autorizada, 6 logins a prod con `X-Forwarded-For` rotatorio ⇒ 429 al 6.º, 6/6, y anotar cabeceras reales tras el edge de Railway), **C7** (backend: throttle por identidad — login/google/register por email, change-password por userId — y test que fije `trust proxy=1`), **C2-bis** (devops: retirar `report_only: true` de `dast-release` ≤ 2026-09-25), **P-GL-2** (devops: exención de gitleaks por valor, no por ruta `docs/*.md`/`security/*`), **P-SEED-1** (backend: `assertSeedTarget` rechaza `?host=`/`options` de libpq), **S-NAT-1** (devops: `secrets.env` a 0600), **P-REDIR-1** (frontend: `safeNext` rechaza `\`/`%5C`). Rutas de backend ocupadas por Stream B: enrutar C7/P-SEED-1 al cerrar B | devops · backend · frontend · humano (C6) | 2026-09-11 | `docs/SECURITY_NOTES.md` bloque superior; `docs/PENTEST_NOTES.md` bloque superior |
| Seguridad C3 | Condición C3 del veredicto (humano/QA: `gh run view 34538020057 --log \| grep -m1 "Smoke (real) specs:"` con `checkout`, `guest-checkout`, `shipments`). **C1, C2 (parte medible), C4 y C5 cerradas en `main` el 2026-09-11** (ver `HISTORIAL.md` → «FUSIONADO … Stream A + andamiaje de CI»); C2 residual **cerrado el 2026-09-11** (medido por el orquestador): el primer push a `production` (`c8bee65`) disparó el `dast-release` real y salió **verde** — run `34633179107`, trabajos «Autoprueba del candado (canario vulnerable)» y «DAST contra el stack efímero», ambos `success`; queda solo DO-D3 | humano (C3) · devops (DO-D2) | 2026-09-11 | `docs/SECURITY_NOTES.md:237-249`; `docs/TECH_DEBT.md` DO-D2 |
---

# SIGUIENTE RELEASE — «LA CUENTA DEL CLIENTE» (aprobado por el humano, 2026-09-10)

### Añadidos 2026-09-11 02:35 UTC (durante la publicación de `c9ba265`)

- **P-IVA-INCL · Precio con IVA incluido, sin línea aparte (`IVA_INCLUSIVE`).** Decisión del dueño 2026-09-11:
  «ponlo como pendiente». Hoy el cliente ve «MXN sin IVA» en catálogo y una línea «IVA 16%» en checkout
  (`frontend/src/components/ui/AmountBreakdown.tsx:82`, `frontend/messages/es.json:315`); M-50 ya deja cada
  pedido marcado con su convención (`orders.service.ts:586`, `guest-checkout.service.ts:163`). Falta: el
  DEPLOY 2 de M-50 (contrato §M10-IVA) — decisión de product-owner/arquitecto sobre cómo se muestra, y
  frontend+backend. **Dinero ⇒ triple veredicto.** No medido: qué dice el contrato hoy sobre DEPLOY 2.

> Arranca **en cuanto se publique el release actual**. Tres work streams **disjuntos** por el mapa de
> módulos de `CLAUDE.md`, así que corren **en paralelo** sin pisarse. Una sesión = un stream = una rama.

## 🥇 Stream A — «La cuenta del cliente» (el principal)
> ✅ **FUSIONADO en `main` el 2026-09-11** (sesión 2; QA + techlead aprobados; 79 commits). Lo de abajo se conserva verbatim como alcance del stream. Falta el **release**: fase de seguridad + checklist de despliegue (`ARCHITECTURE.md` §4.47.10.4).
**Módulos:** backend `auth`, `users`, `settings`, `mail` · frontend `(auth)` y perfil.
**Rama sugerida:** `claude/cuenta-del-cliente`

| Pendiente | Qué le pasa hoy al cliente |
|---|---|
| **P-57(a)** | **No existe pantalla de perfil.** No puede ver ni cambiar correo, direcciones, facturación ni estado de verificación. ⭐ **El servidor YA lo expone todo** (`GET`/`PATCH /users/me`, direcciones, facturación, KYC): **falta solo la pantalla.** |
| **P-57(b)** | ⭐⭐ **Cada compra de invitado no reclamada en el momento se queda FUERA DE LA BÓVEDA PARA SIEMPRE.** El mecanismo existe entero y bien hecho; `GET /orders/claimable` **no lo consume nadie**. Ubicación decidida con el humano: aviso **en la bóveda** y en pedidos. |
| **P-73** | Entrar con Google **inventa un nombre** que nadie puede corregir, y los envíos salen **sin destinatario**. |
| **P-75** | Se le dice *«debes cambiar tu contraseña»* **y no hay dónde hacerlo**. El ciclo no cierra. |
| **P-55** | Arma el carrito de venta, inicia sesión, **y lo pierde**. |

**Por qué juntos y por qué primero:** son cinco síntomas de **una sola ausencia** —no hay «mi cuenta»—, y
P-57(b) cuesta bóvedas todos los días. La bóveda es la propuesta de valor.

## 🥈 Stream B — «Lo que se rompe con el dinero»
**Módulos:** backend `orders`, `shipments` · frontend `(storefront)` pedidos.
**Rama sugerida:** `claude/ordenes-pacto`

| Pendiente | Qué |
|---|---|
| **P-58** | 🔴 «Marcar recibida» se ofrece desde **cualquier estado** — se salta el pacto con el vendedor. |
| **P-59** | La reserva propia **bloquea el reintento del mismo cliente**. |

## 🥉 Stream C — «El disco»
**Módulos:** backend `pricing` · devops.
**Rama sugerida:** `claude/disco-pricing`

**P-53** — 28,559 filas/día (~13 MB/día) que en su mayoría **no cambian nada**. La cura está
identificada y no se ha implementado: la columna **`evidenceDate`** existe en el esquema y **nadie la
escribe ni la lee** — es el sitio para distinguir «el precio no cambió» de «el proveedor no respondió».
⚠️ Antes de tocar, re-medir: `sealed-catalog.service.ts:334` (gráfica por ventana) y
`hasRecentIngest()` (`price-ingest.service.ts:344`) **sí dependen** de que haya filas de hoy.

---

## ⛔ Lo que NO entra, y por qué

- **P-70 · Decks Meta.** Funcionalidad nueva y grande. **Su propio spec exige correr sola**, sin nada que
  toque `money.ts` ni el contrato. Mezclarla con arreglos hace que un problema en cualquiera detenga a
  los dos. **Va sola, después.** ⚠️ Y arrastra un bloqueante ya verificado: el spec cita
  `pricing-iva-v2.1`, que **no existe en este repo** — hay que preguntarle al humano qué es antes de
  arrancar.
- **P-60 · DMARC.** No es un release: son **diez minutos del humano** en el panel de su dominio. Sin eso
  los correos siguen cayendo en spam.
- **`D-GT-1` / `§M2-GT`** (el grupo TCGCSV de un set): techlead lo dejó fuera del release actual **en
  primera posición del siguiente**, serializado. **Cruza dos streams y toca dinero** ⇒ el orquestador lo
  serializa **antes** de que A, B o C toquen `catalog`/`pricing`/`inventory`, y va con triple veredicto.

## Zonas compartidas — serializar, no paralelizar
`backend/src/common/`, `backend/src/config/`, `backend/prisma/` (schema), `frontend/src/components/`,
`frontend/src/lib/`, `frontend/src/hooks/`, `docs/API_CONTRACT.md`. **Un solo stream a la vez**, y todo
cambio de contrato o de schema pasa por el arquitecto primero (regla 9).
⚠️ Aviso concreto: **A y B comparten `frontend/src/lib/verdict.ts` y `components/ui/VerdictNotice.tsx`**
si alguno toca avisos de resultado. Y **A toca `shipments` en P-73** (el destinatario), que es módulo de
**B** ⇒ **serializar ese punto**: lo hace A, y B no entra a `shipments` hasta que aterrice.

---

## Abiertos — cuerpos (verbatim)

### Infraestructura · Disco de la base de datos (2026-09-01)

#### P-53 · 💾 El disco de Postgres se llena por el ritmo de escritura del historial de precios — MITIGADO, falta la cura
- **Detectado por el humano:** alerta de Railway «High Volume Usage — postgres-volume is at 77% capacity».
- **✅ Mitigación aplicada (humano, 2026-09-01):** volumen ampliado. **El reloj de saturación se detuvo.**
  Queda pendiente anotar el tamaño nuevo y rehacer la proyección con él.
- **Medición real en producción (solo lectura, consola de Railway):**
  | Dato | Valor |
  |---|---|
  | Disco usado / disponible | 317 MB de 434 MB (75%) |
  | `pgdata/base` (datos) | 171 MB |
  | `pgdata/pg_wal` (bitácora) | **145 MB — 46% de lo ocupado** |
  | Base de datos completa | 148 MB |
  | `PriceReference` | **101 MB — 68% de la base** |
  | Filas de `PriceReference` | 222,614 (2026-08-17 → 2026-09-01, 16 días) ⇒ ~476 B/fila |
- **Causa raíz (confirmada por consulta, NO por hipótesis):** el **ingest de singles de TCGCSV** escribe
  **una fila por producto por día**, se muevan o no los precios. El 2026-08-28 el ritmo saltó de **2,062 a
  ~28,570 filas/día (×14)** y lleva 5 días sostenido — es el nuevo estado estable, no un pico.
  Desglose del día 2026-09-01: `tcgcsv_singles/raw:NM/market` **28,559** · `pokemonpricetracker/graded:PSA:10`
  12 · `graded:PSA:9` 6.
  ⚠ **Corrección registrada:** el orquestador atribuyó primero el salto al pipeline PSA. **Era falso** —
  el PSA aporta 18 filas de 28,577. La causa es el ingest de singles.
- **Proyección que motivó la ampliación:** ~13 MB/día contra 107 MB libres ⇒ saturación ≈ **2026-09-09**.
  Con el disco lleno Postgres **deja de aceptar escrituras** (sin pedidos, sin altas, sin capturas de
  inventario) y compactar la tabla exige espacio libre ≈ su propio tamaño (101 MB): esperar cerraba la
  puerta al arreglo, no solo al servicio.
- **⚠ Una política de retención por antigüedad NO resuelve esto.** El historial completo son 16 días: hoy
  «conservar 90 días» no borraría ni una fila. El problema es el **ritmo diario**, no la basura vieja.
  (El orquestador propuso retención antes de medir; queda anotado para no repetir el camino.)
- **Lo que sí queda por hacer:**
  - **(devops) Acotar el WAL.** 145 MB de bitácora con **cero replication slots** (verificado: la consulta a
    `pg_replication_slots` devolvió 0 filas ⇒ no hay fuga). Es Postgres con los valores de fábrica,
    dimensionados para un disco mucho mayor. Bajar `max_wal_size` recupera del orden de **100 MB**. Requiere
    reinicio de Postgres ⇒ **con respaldo y ventana**, no en caliente.
  - **(arquitecto → backend) Escribir menos por día.** Palanca de fondo: hoy se guarda una fila diaria por
    carta **aunque el precio no se haya movido**, y la mayoría no se mueve. Escribir solo ante cambio recorta
    el volumen de forma drástica.
    🔴 **Money-critical:** toca qué tan **fresco** se considera un precio (`capturedDate`/`evidenceDate`,
    `stale()`) y roza la regla «no se fabrican puntos» de las series del portafolio y de los sets. Mal hecho,
    una carta se queda con precio viejo **sin que nada avise**. Pasa por el **arquitecto** (regla 9) y exige
    **triple veredicto (QA + techlead + seguridad)** antes de producción.
  - **(devops) Vigilancia.** Hoy nos enteramos por la alerta de Railway al 77%. Falta un aviso propio del
    crecimiento del disco y del ritmo de filas/día, para no volver a descubrirlo a 8 días del tope.
- **Consultas de diagnóstico (solo lectura) para repetir la medición:** tamaño por tabla vía
  `pg_total_relation_size`; `du -sh /var/lib/postgresql/data/pgdata/*`; `pg_replication_slots`;
  `SELECT "capturedDate", count(*) FROM "PriceReference" GROUP BY 1 ORDER BY 1 DESC`.


### Encontrado por el humano en producción (2026-09-08, tras publicar el ciclo de compra)

#### P-56 · ⭐ WISHLIST del cliente — «dime qué buscas y te la consigo» — pedido por el humano
- **La idea:** el cliente arma una **lista de deseos** con las cartas que anda buscando. La plataforma
  le hace saber que **podría conseguírsela a cierto porcentaje por encima del mercado**.
- **Por qué es más que una lista:** hoy solo sabes qué te compran de lo que YA tienes. La wishlist te
  dice **qué te comprarían si lo tuvieras** — es tu demanda insatisfecha, medida, y hoy es invisible.
- **⚠️ Conecta con los bounties, y ése es el valor real.** El bounty es *«pago X por esta carta»*
  (oferta); la wishlist es *«alguien la quiere»* (demanda). **Una alimenta a la otra**: N clientes
  buscando la misma variante es exactamente la señal para levantar un bounty. Diseñar las dos sin
  mirarse sería construir dos mitades de lo mismo.
- **🔴 Money-critical, y no es obvio:** *«te la consigo a X% sobre mercado»* es **un compromiso de
  precio con el cliente**. Hay que decidir si es vinculante, cuánto dura, qué pasa si el mercado se
  mueve entre la promesa y la entrega, y cómo se cruza con la escalera de redondeo y el tope de
  compra. Pasa por **arquitecto** (regla 9) y exige **triple veredicto**.
- **Preguntas para el humano, sin asumir:** ¿el porcentaje es un dial global, por rareza, o por
  carta? ¿la promesa caduca? ¿se avisa al cliente cuando la conseguimos, y con qué plazo para que
  responda? ¿la wishlist es privada o alimenta un ranking público («las más buscadas»)?
- **Rol dueño:** arquitecto (diseño) → backend + frontend. **Sin empezar hasta que el humano cierre
  el alcance.**

#### P-58 · 🔴 «Marcar recibida» se ofrece desde CUALQUIER estado — se salta el pacto
- **Encontrado por el humano** mirando la pantalla; **seguridad lo había visto por el código** en su
  pase y lo dejó anotado. Dos caminos independientes, mismo hallazgo.
- **Medido:** la guarda de `receive` (`buylist.service.ts:5488`) es `liveRequestWhere()` — solo exige
  que la solicitud no esté cerrada, **no que esté en el paso correcto**. Y la interfaz ofrece el
  botón desde el paso 1.
- **Por qué importa, y no es cosmético:** desde **«Cotizada»** marcar recibida salta al paso 5 **sin
  que exista precio pactado ni aceptación del vendedor** — acabas con las cartas de alguien sin
  acuerdo. Desde **«Ofertada»** es peor: **le cierra la ventana al vendedor**, que ya no puede
  aceptar ni declinar.

- **⚠️⚠️ ANTES DE TOCAR LA GUARDA — LEER ESTO (medido 2026-09-08, y contradice la cura obvia).**
  La guarda **NO está floja por descuido: está por EXCLUSIÓN a propósito**, y el porqué está escrito
  en el bloque de documentación de `receive`. Los hechos que dejó quien la escribió:
  - **La mesa dispara los verbos EN CADENA.** En el incidente que originó la guarda, `receive` y
    `verify` se ejecutaron seguidos tras `confirm-shipment`, y **la bitácora real muestra
    `receive`→`verify` con 20 ms de diferencia**. No es un caso teórico: es cómo se trabaja.
  - Su regla, textual: *«Una guarda que rompe el trabajo legítimo del día siguiente no es más segura:
    es la que alguien acaba desactivando.»* Misma dirección que el **criterio 129** (estados vivos
    por complemento): olvidarse falla hacia el lado seguro.
  - El segundo término, `closedAt: null`, **no es redundante** aunque lo parezca: ya hubo en la base
    filas con `closedAt` sellado y estado no-terminal, y sobre ésas el término de estado por sí solo
    dejaba pasar la transición. *Una guarda no puede apoyarse en el invariante que el bug rompió.*
  ⇒ **Apretar a «solo desde el estado X» sin más inventaría una máquina de estados que la mesa no
  usa, y rompería la operación real.** Quien lo intente sin leer ese bloque va a romper algo que hoy
  funciona y a creer que lo arregló.

- **Cómo se cierra bien, en dos mitades separables:**
  1. **La barata y sin riesgo (hacer ya):** que **la interfaz no ofrezca el botón donde no toca**.
     Eso quita el 100% del camino accidental —que es como lo encontró el humano— **sin tocar la
     guarda del servidor**. Rol: **frontend**.
  2. **La de fondo (decisión, no parche):** ¿desde qué estados es legítimo `receive`? Lo decide el
     **arquitecto**, y con las dos evidencias delante: el agujero del pacto **y** el encadenamiento
     de 20 ms de la mesa. Si de ahí sale una guarda más apretada, la escribe **backend**.
- **Rol dueño:** frontend (mitad 1, ya) · arquitecto → backend (mitad 2, con la evidencia de arriba).

#### P-59 · 🛑 La reserva propia bloquea el reintento del mismo cliente
- **Encontrado por el humano:** se le congeló el pago, reintentó, y **la carta ya no estaba** —
  la había reservado su propio intento fallido.
- **Medido:** el inventario se reserva **60 minutos** (`GUEST_ORDER_RESERVATION_TTL_MIN`) y un
  barrido cada 15 minutos libera lo no pagado. **No se pierde nada** — pero el cliente espera hasta
  una hora por un pago que se le cayó, y ve «no disponible» sin explicación.
- **Lo correcto:** que el mismo cliente/sesión **recupere su propia reserva** al reintentar, en vez
  de chocar contra ella. **Rol dueño:** arquitecto → backend.

#### P-60 · ✉️ Entregabilidad del correo: falta DMARC y el dominio es nuevo
- **Medido:** el correo de la oferta **se mandó y se entregó** (Resend: `Delivered`) — y **cayó en
  spam** en Hotmail. No es defecto de código: es reputación. `tcghunt.mx` tiene 17 días y **dos
  correos en 15 días**; SPF y DKIM verificados, **DMARC ausente**.
- **⚠️ Por qué urge más de lo que parece:** el correo de **verificación de cuenta** es la puerta de
  entrada — sin verificar, el sistema **bloquea comprar y vender**. Si ese correo cae en spam, el
  usuario nuevo se va y **nadie se entera**.
- **Acción (humano/devops):** registro TXT `_dmarc` con `v=DMARC1; p=none; rua=mailto:…` (modo
  observación, sin riesgo); marcar los correos como «no es spam»; el volumen hace el resto.

#### P-61 · 🖼️ El catálogo de Vender se ve chico — carrito a pop-up
- **Propuesta del humano:** mover el carrito a un pop-up y usar ese espacio para mostrar las cartas
  más grandes, como en el inventario de admin.
- **⚠️ Restricción que el diseño debe respetar:** ese panel carga hoy **dos cosas que no pueden
  esconderse**: la llamada a **iniciar sesión** (es donde el vendedor descubre que necesita cuenta) y
  el mensaje de que **la guía la ponemos nosotros y no paga nada de su bolsillo** (responde la duda
  que frena al vendedor primerizo). Hay que **reubicarlas**, no solo mover el carrito.
- **Rol dueño:** ux-ui → frontend.


#### P-65 · 🖼️ Las fotos tardan 5–10 s en aparecer — reportado por el humano
- **Medido en el código (no supuesto): no es una causa, son cuatro eslabones EN SERIE.**
  1. **La home y el catálogo son pantallas de cliente** (`'use client'` + TanStack Query en
     `frontend/src/app/[locale]/(storefront)/page.tsx`). Antes de que exista siquiera la *dirección*
     de la primera foto hay que: bajar el HTML → bajar y arrancar el JavaScript → preguntar al
     backend → recibir respuesta. **La foto empieza a bajarse en el cuarto viaje, no en el primero.**
  2. **La teja líder del carrusel pide la imagen HD** (`FeaturedCarousel.tsx:708`,
     `imageLargeUrl` → `_hires.png` de pokemontcg.io: cientos de KB, frente a las ~40–60 KB de la
     chica). Es justo la imagen que decide cuándo el visitante siente que «ya cargó la página».
  3. **Las fotos no pasan por nosotros.** Todas se piden directo a `images.pokemontcg.io` con `<img>`
     plano (`components/ui/CardImage.tsx`): ni las redimensionamos, ni las convertimos a formato
     moderno, ni las guardamos en caché propia. Cada visitante paga el viaje al servidor del
     proveedor, con su latencia y el peso original.
     - ⚠️ **CORRECCIÓN (2026-09-08, mía).** Aquí decía que *«el único sitio del front que usa el
       optimizador de Next es el logo de expansión (`SetPlate.tsx`)»*. **Es falso.** Lo deduje de que
       un `grep` de `next/image` devolvía ese fichero — y **la coincidencia era un COMENTARIO** que
       dice literalmente *«sin next/image»*. **No hay una sola línea de `next/image` en el frontend**:
       todas las imágenes son `<img>` crudo (Nivel B, `ARCHITECTURE §4.41.7`). Propagué el error a un
       encargo de seguridad y ahí hizo ver un riesgo más pequeño de lo que era; lo cazó el agente al
       verificar en vez de ejecutar. **La lección: un `grep` dice dónde aparece un texto, no qué hace
       el código.**
  4. Las demás van en `lazy` y eso **está bien** — no es ahí donde se van los segundos.
- **Lo que NO pude medir desde aquí, y decide cuál es la cura:** este contenedor tiene bloqueada la
  salida a internet (`tcghunt.mx` e `images.pokemontcg.io` devuelven 403 en el proxy), así que **no
  sé cuál de los cuatro eslabones se lleva los segundos**. La distinción no es un detalle: si el que
  tarda es el backend (Railway despertando, o la consulta de catálogo), optimizar imágenes **no
  arregla nada**.
  - **Dato que el humano da en un minuto:** F12 → pestaña **Red** → recargar → decir (a) cuánto tarda
    la llamada al backend y (b) cuánto tarda la primera foto. Con eso se sabe qué atacar.
- **Palancas, de más barata a más cara** (todas reales, ninguna aplicada):
  - **(a)** usar la imagen chica también en la teja líder — una línea, ahorra cientos de KB en la
    imagen que marca el tiempo percibido;
  - **(b)** servir las fotos por el optimizador de Next/Vercel (redimensiona + WebP + caché en el
    borde) — cambio acotado en `CardImage`. ⚠️ consume cuota de Vercel, **que ya está al 75%**;
  - **(c)** pintar la primera pantalla en el servidor, para que la foto empiece a bajar en el primer
    viaje y no en el cuarto — cambio grande: es rediseñar cómo carga la home;
  - **(d)** copiar las fotos a almacenamiento propio (R2) y servirlas desde ahí — quita la
    dependencia del tercero; es un proyecto aparte.
- **Cruce:** (b) y (d) tocan `remotePatterns` de `frontend/next.config.mjs`, hoy abierto a
  `hostname: '**'` (cualquier host) — mismo terreno que la deuda **M47-R1**.
- **Rol dueño:** frontend para (a) y (b); arquitecto si se va a (c) o (d).
  **Antes de tocar nada: la medición del navegador.**

#### P-66 · 🧟 Dar una vuelta al panel de administración — ✅ DIAGNOSTICADO (ux-review, 2026-09-08) · **VEREDICTO: RECHAZADO**
- **Pedido del humano:** *«siento que tenemos varios zombies ahí que no nos ayudan, o temas de navegabilidad»*.
- **Cómo se midió:** bundle de producción con mocks recompilado sobre `9ff373f`, recorrido en Chromium a
  **1280×800 y 390×844**, como `super_admin` y como `vault_operator`. Lo no medido va marcado como tal.

##### 🔴 Bloqueantes
- **B1 · M5 (Buylist) enseña TODO lo que existe, no lo que toca ahora.** **Diez pestañas en dos barras
  apiladas** (4 «colas del ciclo» + 6 de estado) y dos jerarquías en la misma pantalla. En «Verificando»,
  una solicitud de 3 cartas pinta **14 botones**; con 4 solicitudes es una pared, y **«Pagar por SPEI»
  —dinero— queda al fondo**. La única pista de qué toca ahora va en 11 px. Y la lista de solicitudes
  empieza a **≈660 px en escritorio y ≈880 px en móvil** (bajo el pliegue): esto es, literalmente, lo que
  el humano llamó *«súper escondidas»*. **Rol:** ux-ui → frontend.
  - ⚠️ **P-58 confirmado y precisado:** «Marcar recibida» **no es una fuga** — está cableado a `status ===
    'cotizada'` **a propósito**, o sea exactamente al paso donde no debería estar.
- **B2 · Tres pantallas DESBORDAN en 390 px** (medido, `scrollWidth − innerWidth`): **M5 +419 px**
  (la página se renderiza a 809 px: hay que hacer scroll lateral para llegar a «AUTORIZAR Y MANDAR»),
  **M1 +89 px**, **M2 +35 px**. Las tres se saltan `DataTable`, que **sí** colapsa a tarjetas. *(Bounties
  ya no desborda: 0 px, verificado.)* **Rol:** frontend. ⚠️ **Si el humano no usa el teléfono, baja a
  importante** — es la pregunta 1 de abajo.
- **B3 · Las pantallas de dinero hablan en identificadores, no en personas.** M3 y M4 pintan `u-777`,
  `u-778` como «usuario»: para saber a quién le vendió hay que ir a M6 con el id en la cabeza. M10 pinta
  `u-admin`/`SUPER_ADMIN`/`settings.update`; M6 pinta `CUSTOMER`/`VAULT_OPERATOR`. **§9.2 del sistema de
  diseño dice «nunca se pinta el enum crudo».** ⭐ **M5 ya lo resolvió** (nombre + correo + enlace a la
  ficha): la cura existe en el mismo panel. **Rol:** frontend; arquitecto+backend si M3 necesita el DTO.

##### 🟠 Importantes
- **I1 · Zombies confirmados** *(no se retira nada sin producto y sin el humano)*: **M9 Reportes** — de sus
  tres secciones, **dos son las mismas de M7** (mismo rango de fechas, **los mismos tres botones de
  exportar, misma función**); lo único propio son 4 tarjetas cuyo subtítulo dice *«Avance de la beta
  cerrada frente a las metas N/X/Y/Z»* (álgebra en pantalla, y «beta cerrada» estando en producción).
  Y la **tarjeta «Progreso de lanzamiento» del dashboard está INERTE POR CONSTRUCCIÓN**: pinta «Meta
  pendiente» **sin condición**, y su DTO ni siquiera tiene metas ⇒ con los mismos datos, M9 dice 42 % y el
  dashboard dice «Meta pendiente». **Los mismos cuatro contadores aparecen en tres sitios.**
  **Rol:** product-owner decide → ux-ui redacta → frontend cablea.
- **I2 · La navegación rotula por código, y el código no sirve para nada.** Los códigos **no llevan orden**
  (M1, Bóvedas, M4, M5, M8 / M2 / M3, M7, M9 / M6, M10) y **tres destinos no tienen código**: no ordenan ni
  identifican, solo **desplazan el nombre 5 caracteres a la derecha en 12 filas**. El rótulo del menú y el
  título de la página **difieren en 6 de 12**. Las solicitudes de venta se llaman **«Buylist»** en el menú
  y **«Solicitudes de venta»** en M6 — *el humano las buscó por su nombre y no las encontró*. La etiqueta
  «SÚPER» sale en **7 de 12 filas** también para el súper-admin, que es el único que la ve.
  **Rol:** ux-ui → frontend.
- **I3 · M2 es UNA página de 7.986 px, 11 secciones y 61 botones**, con una barra pegajosa
  («GUARDAR CURVA») fija al pie **desde el primer scroll**: quien está en «Tipo de cambio» ve un botón que
  no le corresponde. **Rol:** ux-ui / frontend.
- **I4 · M8 le habla al dueño como si fuera el cliente** («Envía **tu** evidencia por correo… citando **tu**
  número de orden») y **no tiene estado vacío**: con cero disputas queda en blanco. **Rol:** frontend.
- **I5 · El sistema de diseño afirma seis cosas que el panel NO cumple** — buscador global en el topbar
  (no existe), barra inferior en móvil (no existe), la lista de grupos de §7.15 (desactualizada), tarjetas
  del dashboard clicables + semáforo + barras (no existen), colapso a tarjetas en `<md` (falso fuera de
  `DataTable`), y **objetivos táctiles ≥44 px** (medido en el topbar: 15×25, 111×17, 101×16).
  **Misma clase que los ocho tachones de D52: o se implementan o ux-ui las retira.**
- **I6 · M3 muestra su única acción como lo más llamativo:** «REEMBOLSAR» en bermellón sólido —dinero que
  sale— sin detalle de orden, sin enlace al envío ni al comprador.

##### ✅ Lo que está bien y NO se toca
Foco de teclado visible · M1 cumple §16.1 · **Bóvedas de clientes y Bounties son las dos pantallas más
limpias del panel** · **M4 tiene estado vacío y acciones acotadas por estado — es el patrón que le falta a
M5** · los enlaces de «Cola de trabajo» del dashboard sí llevan a su módulo.

##### ❓ No medido, y hace falta
Volumen real de datos (colas con decenas de filas cambian la lectura de M5 y M3), si las metas de M9 están
fijadas **en producción**, y **el uso real de cada destino**. Hay 12 preguntas cortas para el humano en el
reporte; las cuatro que más cambian el trabajo: **¿entra desde el teléfono?** (decide si B2 bloquea),
**¿fijó las metas N/X/Y/Z?** (decide si M9 es zombie), **¿entra alguien más al panel?** (decide el trato de
roles) y **¿cómo le llama a M5?**.


##### ✅ Respuestas del humano (2026-09-08) — reordenan el trabajo
| Pregunta | Respuesta | Qué cambia |
|---|---|---|
| ¿Entra desde el teléfono? | **No, solo computadora** | ⬇️ **B2 (las tres pantallas que desbordan en 390 px) BAJA a deuda registrada.** No se gasta tiempo ahí ahora. Se anota con su medición para el día que use el móvil o entre un operador que sí |
| ¿Las metas `N/X/Y/Z`? | **No existen — y quiere una pestaña de analytics de verdad, pero primero saber qué datos hay** | ➡️ **M9 NO se retira: es la semilla.** Nace **P-67** (inventario de datos). Sí se corrige ya el «beta cerrada» |
| ¿Alguien más en el panel? | **Todavía no, pero pronto** | Se optimiza para él primero, **sin cerrarle la puerta al operador**. La etiqueta «SÚPER» en 7 de 12 filas **no se quita**: pronto informará |
| ¿Qué usó la última semana? | **M3 · Ventas** y **M10 · Config** (⛔ **no** M8, **no** M9) | ⬆️ **B3 sube**: M3 es de uso real y le enseña `u-777` en vez del comprador. ⬆️ M10 (el ensayo de ingeniería dentro del formulario). ⬇️ **M8 baja** — no lo usó, y lo más probable es que sea porque **no ha habido disputas**, no porque sobre: es una pantalla que espera, no un zombie |

##### 🎯 Orden de trabajo resultante
1. **B1 · M5 en computadora** — la pantalla que más usa, diez pestañas y catorce botones por solicitud.
2. **B3 · M3 y M10** — identificadores en vez de personas, en pantallas de uso diario.
3. **P-67** — el inventario de datos, que desbloquea la pestaña de analytics.
4. **I2 · los rótulos del menú** — barato y se nota todos los días.
5. **I1 (dashboard)** — la tarjeta de progreso inerte: se quita o se conecta.
6. ⬇️ **B2 (móvil)**, **I4 (M8)** — deuda registrada, con su medición, para cuando toque.

#### P-67 · 📊 Inventario de datos para analytics — «¿qué podemos medir hoy?» — pedido por el humano
- **Lo que dijo, literal (2026-09-08):** *«SÍ me interesa generar una tab de analytics y reportes, sin
  embargo creo falta saber bien qué datos están disponibles para ver si hay que crear track de algo y
  elegir de lo que hay.»*
- **La pregunta es la correcta y va PRIMERO.** Diseñar un tablero antes de saber qué se puede medir es
  cómo nacieron las metas `N/X/Y/Z`: un marco de reporte sin datos detrás que lleva meses enseñando
  «Meta sin fijar». **No se diseña ninguna pantalla hasta que este inventario exista.**
- **Qué hay que producir** — un documento que el humano pueda leer y elegir, no una lista de tablas:
  1. **Lo que YA se guarda y se puede reportar hoy**, en lenguaje de negocio (qué se vendió, a quién, a
     qué precio, con qué margen, cuánto se pagó en compras, qué inventario hay y cuánto vale, KYC,
     disputas, retiros). Con **la granularidad real** (¿por día? ¿por pieza? ¿por set?) y **desde cuándo
     hay historia** — un dato que empieza el mes pasado no sirve para una tendencia anual.
  2. **Lo que se guarda pero NO es reportable todavía** y qué faltaría para que lo fuera.
  3. **Lo que NO se guarda y habría que empezar a registrar** (el «crear track de algo» que él nombra),
     con el costo de empezar a hacerlo y **desde cuándo tendría historia** — porque lo que se empieza a
     registrar hoy no tiene pasado.
  4. ⚠️ **Las trampas conocidas**, que ya nos mordieron: el P&L del tablero suma un campo a secas
     mientras el control antilavado usa una cascada con respaldo; y `PriceReference` escribe ~28.559
     filas/día (P-53) — cualquier reporte histórico de precios se apoya en esa tabla.
- **Cómo se hace, y en qué orden:** un pase de **lectura** (arquitecto o backend, sin escribir código)
  que produzca el inventario → el **humano elige** qué quiere ver → **product-owner** aterriza el
  alcance → recién entonces arquitecto/ux-ui/frontend.
- **Cruce con P-66:** de las tres secciones de **M9 Reportes**, dos son **idénticas a M7**; lo único
  propio son las tarjetas de `N/X/Y/Z`. ⇒ **M9 no se retira todavía: es la semilla de este trabajo.**
  Lo que sí se corrige ya es que hable de «beta cerrada» estando en producción.
- **Rol dueño:** arquitecto/backend (inventario, solo lectura) → product-owner → ux-ui → frontend.

#### P-68 · 💱 Una consulta de UNA fila antes de publicar el interruptor del tipo de cambio (I-1)
- **El escenario, en lenguaje de dinero:** existe un estado en el que **publicar el interruptor de FX,
  sin que nadie apriete nada, movería los precios ~5 %** (de 19.00 a 18.00, el fallback duro). Es
  exactamente el movimiento que el acuse de confirmación existe para impedir — y ahí ocurriría sin un
  solo clic. QA lo clasificó como **«no aceptable sin decisión explícita del humano»**.
- **Qué lo dispara, verificado en el código** (`backend/src/common/fx-mode.ts:157` y
  `backend/src/modules/pricing/fx.service.ts:85`), no supuesto:
  1. Al desplegar, la fila `fx_rate_mode` todavía no existe (o vale el centinela `"legacy"`), así que
     `resolveFxMode()` **infiere** el modo en lugar de leerlo. Esa inferencia corre **una sola vez por
     entorno** y deja de correr en cuanto un humano toca el interruptor.
  2. La inferencia mira **un solo valor**: el ajuste `fx_manual_override_rate`.
     - Si **tiene número** ⇒ resuelve `manual` ⇒ rige ese número. **Nada se mueve.** ✅
     - Si está **vacío/nulo** ⇒ resuelve `auto` ⇒ rige la última fila `FxRate` de origen **`banxico`**,
       y si no hay ninguna, el **fallback duro de 18**. ⚠️ Ahí está el −5 %.
- ⚠️ **Corrección a lo que dije antes:** dije que «el 19.0000 puesto» protege producción. Es cierto
  **solo si ese 19.0000 vive en el ajuste `fx_manual_override_rate`**. La pantalla de admin escribe
  las dos cosas a la vez (`setManual()` guarda el ajuste **y** una fila `FxRate` de origen `manual`),
  así que si el número se puso por la pantalla, está protegido. Pero **la fila `FxRate` manual NO rige
  nunca** (I-FX5, es solo traza forense): si ese 19.0000 llegó por un script o una migración vieja y
  el ajuste quedó vacío, la protección **no existe**. No es una cosa que se pueda razonar desde el
  código: **depende de un valor que solo está en la base de producción.**
- **La cura, y ya está escrita: UNA consulta de solo lectura que emite su propio veredicto.**
  Se corre en **cada entorno** (staging y producción) antes de promover. No modifica nada.

  ```sql
  SELECT
    COALESCE((SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_rate_mode'), '(no existe)') AS modo_guardado,
    COALESCE((SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate'), '(vacio)') AS tasa_manual,
    (SELECT count(*) FROM "FxRate" WHERE source = 'banxico') AS filas_banxico,
    CASE
      WHEN (SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_rate_mode') IN ('auto','manual')
        THEN 'SEGURO — el modo esta puesto explicitamente, publicar no lo cambia'
      WHEN (SELECT "valueJson" FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate') IS NOT NULL
       AND (SELECT "valueJson" FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate') <> 'null'::jsonb
        THEN 'SEGURO — hay tasa manual guardada: al publicar resuelve a MANUAL y rige ese numero'
      ELSE 'PELIGRO — sin modo y sin tasa manual: al publicar resuelve a AUTOMATICO'
    END AS veredicto;
  ```

- ⭐ **La consulta SE PUEDE PONER EN ROJO — verificado por el orquestador (2026-09-09), no supuesto.**
  Se probó contra una base desechable en los tres estados, porque una consulta que solo sabe decir
  «seguro» no sirve de nada, igual que un candado que no puede ponerse rojo:
  | Estado sembrado | Veredicto que emitió |
  |---|---|
  | `fx_rate_mode = 'auto'` | ✅ SEGURO — el modo está puesto explícitamente |
  | sin fila de modo, **con** `19.0` guardado | ✅ SEGURO — resuelve a MANUAL y rige ese número |
  | sin fila de modo y **sin** tasa manual | 🔴 **PELIGRO** — resuelve a AUTOMÁTICO |
- **Qué hacer con cada resultado:** `SEGURO` ⇒ se publica sin riesgo. `PELIGRO` ⇒ **no se publica**
  hasta fijar el modo a mano (o guardar la tasa manual), y entonces se vuelve a correr.
- **Rol dueño:** devops (la consulta previa al deploy) · backend (la tercera fixture FX-6 que cubre el
  estado) · arquitecto (declarar el riesgo residual si se decide publicar sin la consulta).
- **Estado:** ⛔ **BLOQUEA el merge del interruptor de FX** hasta que el humano decida.


#### P-70 · 🃏 Stream `decks-meta-v1` — el spec del humano, en espera de arrancar
- **Entregado por el humano el 2026-09-09**, con instrucción explícita: *«después de que publiques quiero
  que empieces con esto»*. Guardado **verbatim** en `docs/specs/DECKS_META_V1.md`; nadie lo edita.
- **Qué es:** una sección «Decks Meta» que traiga los 10 decks del meta de Limitless TCG, con precio en
  pesos, disponibilidad real por carta y un botón «Agregar las disponibles», más descuento de bundle
  (5 % con 60/60, 3 % con las *core* completas), job semanal, correo «Qué cambió» y reporte de faltantes.
- **Cómo arranca, según el propio spec:** sesión 1 es **solo diseño, sin código de producto** — modelo de
  datos, las dos preguntas bloqueantes de arquitectura, el diseño del job, y el diff propuesto de
  `API_CONTRACT.md`, todo para **revisión del arquitecto**. Por el paso 0 de `CLAUDE.md`, antes va
  **product-owner** aterrizándolo a `PROJECT.md`.
- 🔴 **BLOQUEANTE QUE HAY QUE RESOLVER ANTES, y no es del spec: `pricing-iva-v2.1` NO EXISTE en este
  repo.** Lo verifiqué: cero ocurrencias de ese nombre en `docs/` y en `PROJECT.md`. Y lo que sí verifiqué
  del estado real: `backend/src/common/money.ts:374` calcula `iva = round(subtotal × ivaPct/100)` — o sea
  que **hoy el motor devuelve base y apila el IVA después**, que es exactamente el estado que el spec dice
  que hay que resolver antes de publicar la sección (*«si el motor sigue devolviendo base con IVA apilado
  después, el descuento y el total del bundle salen mal»*). ⇒ **Hay que preguntarle al humano** si
  `pricing-iva-v2.1` es trabajo de otro contexto, si es un stream por abrir aquí, o si lo que existe bajo
  otro nombre (P-37, contrato v1.40) ya lo cubre. **No se asume.**
- ⚠️ **Su propia regla de exclusión:** *«corre solo; no se abre en paralelo con `pricing-iva-v2.1` ni con
  ningún stream que toque `money.ts` o el contrato»*. El stream de FX que se acaba de cerrar tocaba las
  dos cosas, así que **esperar al merge era correcto** — ya está hecho.
- **Zonas compartidas que va a tocar:** catálogo, carrito/checkout (la línea de descuento),
  `API_CONTRACT.md`, `prisma/schema`, jobs programados y correo transaccional. Por la regla de oro, **solo
  un stream a la vez** puede tocarlas.

#### P-72 · 💸 «SIN PRECIO RESOLUBLE» dice DOS cosas opuestas con la misma frase — ✅ DIAGNOSTICADO (2026-09-10)
- **Reportado por el humano** con captura, y luego el dato que lo desatascó: *«me sale con precio de mercado
  en inventario»*.
- **Veredicto: NO es que el inventario mienta.** Las dos pantallas leen **la misma tabla, con la misma clave
  por-acabado, con los mismos predicados** — las dos llaman a `PricingService.getReferencesBatch`
  (`pricing.service.ts:877`), sin ningún fallback entre acabados: `finish` entra al `where` (`:892`) y a la
  clave del `Map` (`:884`). **Un holofoil sin fila NUNCA hereda la del normal.**
- ⭐ **La causa, con nombre: el guardarraíl `premium_at_floor`.** Verificado en
  `backend/src/common/pricing-curve.ts:566`. Su comentario dice literal: *«Una carta de rareza canónica
  premium que aterriza en el PISO NO se publica ni se cotiza: **su dato de mercado está mal (ausente,
  aplanado o absurdo)**»*. Las dos piezas son `ex` premium; el piso es **MX$25.00** (`pricing-curve.ts:111`,
  `floorCents: 2500`, dial editable). ⇒ **Tienen mercado, es implausiblemente bajo, y el sistema lo retiene
  a propósito.**
- 🔬 **La prueba que cierra el caso sin mirar la base:** el alta de `aportacion_en_especie`
  (`inventory.service.ts:739-755`) **exige referencia con el `finish` REAL de la pieza** y lanza 422
  `PRICE_PENDING` si falta — la pieza **no se crea**. ⇒ **Si INV-001201 y INV-001202 existen, el 9 de
  septiembre había mercado para su clave exacta.** No pudieron nacer de otro modo. Y las `PriceReference`
  **no caducan**.
- ✅ **Los siete a MX$25.00: es el piso, y NO disimulan nada.** Mi hipótesis queda **refutada por código**:
  una carta **sin** mercado **no puede** salir al piso — `pricing-curve.ts:476` la manda a `pending`, e
  `inventory.service.ts:1615` lo dice con todas las letras (*«el PISO NO gana — decisión LOCKED»*). ⇒ Los
  siete **sí tienen mercado**, solo que ≲ MX$15.62. Son bulk (Dustox, Charmander, Charmeleon, Spidops), y
  están en la cola por **UBICACIÓN**, no por precio. **Nueve piezas, un fenómeno, dos desenlaces por rareza:
  los siete se publican porque no son premium; las dos no porque sí lo son.**
- 🔴 **EL DEFECTO REAL, y es de pantalla:** `PendingPublishRowDTO` **no lleva la razón**
  (`inventory.service.ts:1805-1822`: hay `priceBasis`, `missing`, `pendingPriceEntryId`… y ninguna `reason`).
  ⇒ La cola de M1 **no distingue «no hay mercado» de «hay mercado y lo estoy reteniendo»**, y las dice con
  la misma frase. **Por eso el humano y yo leímos lo mismo de dos hechos opuestos.** La razón **sí** existe
  y **sí** se persiste (`:1516`), y **M2 sí la pinta** (`PendingQueueSection.tsx:116-126`), igual que el
  binder con su marcador `·!` (`VariantPriceConsole.tsx:120`). **Solo M1 la pierde.**
- 🔴 **Y la asimetría que más me preocupa, que no estaba anotada:** el guardarraíl vive **solo en el eje de
  venta/compra** (`decideSalePrice`). **El alta NO pasa por él** ⇒ `inventory.service.ts:761` **ya usó ese
  mismo número sospechoso para valuar la aportación**. **El eje de venta se negó a publicar con ese dato, y
  el eje de costo ya lo había aceptado.**
- ✅ **Acción disponible hoy, y sigue siendo la correcta — pero por otra razón que la que dije:** el sync
  TCGCSV `tcgcsv_singles` de **JOURNEY TOGETHER** (per-acabado, gana por precedencia,
  `pricing.service.ts:904`). **No porque falte el precio: porque el que hay es malo.**
##### ⭐ Por qué «corrí el sync y no pasó nada» (diagnosticado 2026-09-10)
- 🔴 **No hay UN sync: hay CUATRO acciones en M2, y el botón obvio NO ESCRIBE NINGÚN PRECIO.**
  Verificado por el orquestador en `catalog-sync.service.ts:784`:
  ```ts
  if (firstImport || opts.force === true) { await this.runCardProductResolver(...); }
  ```
  **«Re-sincronizar»** (el botón de la fila) manda `sync` **sin `force`** (`useCatalogSync.ts:139`). JOURNEY
  TOGETHER ya está importado ⇒ **el resolver ni se invoca, no se escribe una sola `PriceReference`** — y el
  banner responde *«Sync encolado: 1 set(s)»*, **que parece éxito**.
  | Botón | ¿Escribe precio per-acabado? |
  |---|---|
  | **«Re-sincronizar»** (fila) | ⛔ **NO escribe ningún precio** |
  | **«Variantes + precios»** (fila) | ✅ **SÍ, siempre** — `catalog-sync.service.ts:330`, `void force` |
  | «Actualizar precios ahora» | ⚠️ solo si el dial lo permite |
  | «Sync completo» (menú «…») | ✅ fase 1; fase 2 depende del dial |
- 🔴 **Causa #2, independiente y también viva: el barrido diario NO puede tocar un holofoil hoy.** El
  proveedor lo elige el dial `price_provider`, y el seed es **`pokemontcg_io`** (`settings.constants.ts:307`).
  Ponerlo en `tcgcsv_singles` es **la Parte 4 de `P-47`, «(después, devops)», que sigue SIN MARCAR COMO
  HECHA**. Con PPT y la Parte 1 ya en producción, **solo se escribe la impresión primaria** ⇒ para la clave
  holofoil no se escribe fila nueva y la vieja sobrevive. **Un sync que corre, reporta bien, y
  estructuralmente no puede tocar ese acabado.**
- **Refutada la hipótesis de que el sync respeta la fila vieja:** los dos escritores son **upsert
  incondicional** (`card-product-resolver.service.ts:197`, `pricing.service.ts:2186`). El **único** freno es
  un **override manual**, que además gana en la lectura para siempre. ⇒ **Si alguien puso un override
  manual bajo en esas claves, ningún sync lo moverá jamás.** No se puede descartar leyendo.
- **Refutado el cruce con `P-46`:** sellado y singles resuelven el grupo TCGCSV por **caminos distintos**
  (`sealed-product.service.ts:777` vs `card-product-resolver.service.ts:209`), así que el bug del prefijo de
  P-46 **no alcanza a singles**.
- ✅ **LA ACCIÓN QUE SÍ CIERRA EL CASO, sin depender de ninguna incógnita:**
  **M2 → «Cola de precio pendiente» → pestaña «Venta (inventario)» → las dos filas → «Fijar precio» →
  teclear el MERCADO real en pesos → «Guardar precio».** Escribe una referencia **manual**, cuyo tier es
  **absoluto y durable** (`pricing.service.ts:361`), **ningún sync futuro la pisa**, y el endpoint
  **re-dispara la publicación** al guardar. ⚠️ Se teclea **el mercado, no el precio de venta**; para salir
  del piso tiene que ser **> MX$15.62**.
- ⛔ **Lo que NO va a poder hacer, y hay que decírselo antes:** en el binder, el campo **«Fijar mercado»
  solo aparece cuando NO hay mercado** (`VariantPriceConsole.tsx:431`, `marketRefCents != null`). **Estas dos
  SÍ tienen** ⇒ verá el número y su fecha, **sin campo para corregirlo**. El único sitio es el modal de M2.
- 🔬 **El dato que decide qué hipótesis queda viva, y solo se ve en pantalla: LA FECHA del mercado.**
  M1 → binder → teja del **holofoil** → cajón → «Precios» → renglón «Mercado» (monto · fecha).
  **Fecha ≠ día del sync** ⇒ el sync no escribió esa clave. **Fecha = día del sync y monto sigue bajo** ⇒
  TCGCSV reporta ese número y **solo el override manual lo arregla**.
- ⚠️ **Trampa de pantalla que hay que avisarle:** tras «Variantes + precios», si el set **no resuelve su
  grupo**, el banner sale **VERDE** con **todo en cero** — el estado «parcial» solo se activa con
  `!tcgcsvReachable || pending > 0` (`CatalogSyncSection.tsx:282`). **Que lea los NÚMEROS, no el color.**
- 🔴 **Y lo que ninguna pantalla enseña, que es justo lo que falta: la FUENTE de la fila vigente.** El
  historial por fecha/fuente existe (`GET /admin/pricing/card/:cardId`) y hasta hay cliente en
  `lib/api.ts:3859`, pero **ningún componente lo consume**. ⇒ Desde la interfaz **no se distingue** «la
  escribió tcgcsv hoy» de «es un residuo aplanado de PPT de agosto» ni de «es un override manual».

- **Rol dueño:** **frontend + arquitecto** (que la cola de M1 lleve la razón) · **arquitecto** (si el
  guardarraíl debe cubrir el eje de costo) · **backend** (P-47 parte 3, que cura el dato de origen).

##### Hallazgos de paso del mismo diagnóstico, sin pendiente propio
- 🔴 **La forma (A) que yo temía SÍ EXISTE, en otra familia de piezas.** `loadPublishPricingCtx:1406` solo
  usa `getReferencesBatch`, que **excluye** las filas de `promo`/`deck_exclusive` (`BASE_CARD_REF_WHERE`,
  `pricing.service.ts:150`). Existe la hermana que sí las lee (`getReferencesByCardProductBatch`, `:937`) y
  **nadie la llama desde publicación**, mientras el binder **sí** las pinta (`MasterSetBinder.tsx:346`).
  ⇒ Para una **promo o deck-exclusive**, el binder enseña mercado y la publicación dice «sin precio
  resoluble». **No aplica a estas dos**, pero es real.
- 🔴 **El alta de aportación acepta un mercado de `0`.** `getReference` marca `status:'priced'` para
  cualquier fila (`pricing.service.ts:782`, sin filtro `> 0`) y el candado solo comprueba `!= null`
  (`:741`) ⇒ `computeAportacionCostCents(0, pct) = 0`. El resto del sistema **sí** trata `<= 0` como
  pendiente. Una aportación puede quedar **valuada en MX$0**.

#### P-71 · 🔤 Mostrar el código corto del set junto a las imágenes — pedido por el humano
- **Lo que dijo, literal (2026-09-09):** *«quiero que en los sets cuando estamos viendo las imagenes
  pongamos el codigo chico que viene en las cartas perfect order POR, pitch plack PF etc»*.
- **Qué es:** la sigla corta impresa en la propia carta (**POR**, **PF**, …), que es como los jugadores
  y las listas de deck identifican el set. No es el nombre largo del set: es el código que aparece en el
  cartón y el que se teclea al buscar.
- ⭐ **NOTICIA BUENA, verificada en el código: el dato YA EXISTE y YA SE ESTÁ GUARDANDO.**
  - Columna `CardSet.ptcgoCode String?` — `backend/prisma/schema.prisma:497`.
  - La **puebla sola** el barrido de catálogo desde pokemontcg.io:
    `backend/src/modules/catalog/catalog-sync.service.ts:918` y `:928`, leyendo
    `pokemontcg-io.client.ts:20`.
  - ⇒ **No hay que capturar nada a mano, ni migrar, ni pedirle el dato a un proveedor nuevo.**
- 🔴 **Lo que falta, y es todo lo que falta: NADIE LO LEE.** Grep sobre `backend/src/`: las únicas tres
  ocurrencias son las de la escritura. **No viaja en ningún DTO** y no aparece en
  `frontend/src/types/contract.ts`. El dato está en la base y muere ahí.
- **Trabajo real:** publicarlo en el DTO del set/carta (**arquitecto**, porque es cambio de contrato —
  regla 9), emitirlo (**backend**) y pintarlo (**frontend** + **ux-ui** para dónde y con qué jerarquía).
  Es de los pendientes más baratos de la lista **si el contrato lo permite**.
- ⚠️ **Lo que hay que medir antes de prometerlo:** cuántos sets tienen `ptcgoCode` **no nulo** en
  producción. La columna es opcional y el proveedor no siempre lo trae — sobre todo en sets viejos o en
  promocionales. **Si falta, se omite; NUNCA se inventa una sigla ni se pone un guion que parezca un
  código.** Es la misma regla que ya aplicamos al precio: sin dato, no se finge.
- **Cruce con P-70 (`decks-meta-v1`):** ese stream resuelve las cartas de una lista **por set code +
  número**, y su propio spec lo dice. ⇒ este pendiente y aquél **usan el mismo dato**, así que conviene
  que el mismo pase decida cómo se publica, en vez de exponerlo dos veces con dos formas distintas.
- **Estado:** anotado, sin diagnosticar más allá de lo verificado arriba. Sin rol dueño asignado hasta
  que el arquitecto diga cómo entra al contrato.

#### P-69 · 📦 El precio de mercado se pierde entre el paso 1 y el paso 2 al subir sellado — reportado por el humano
- **Lo que dijo, literal (2026-09-09):** *«subiendo producto sellado me aparece el precio de mercado, en la
  siguiente pagina dice que no tiene el precio y no puedo ponerle como aportacion»*. Con captura.
- **El síntoma, con el dato de la captura:** en el diálogo «Agregar producto sellado», **paso 1 de 2 ·
  ELIGE PRODUCTO**, con el set *Phantasmal Flames (2025)*, la tarjeta seleccionada
  («Phantasmal Flames Elite Trainer Box») muestra **`MX$2,981.67 MERCADO`**. En el **paso 2**, ese
  **mismo** producto aparece **sin precio**, y por eso **no se puede registrar como «aportación»**.
- ⚠️ **Lo que hace esto distinto de «falta un precio»:** el paso 1 **sí sabe** distinguir los dos casos, y
  lo hace bien — la cabecera dice *«25 presentaciones · 23 con precio · 2 pendientes de precio»* y otra
  tarjeta muestra **`SIN PRECIO DE MERCADO`** en rojo. Así que no es que el catálogo no tenga el dato:
  **es que los dos pasos no coinciden sobre el mismo producto.** Uno de los dos miente.
- **Por qué importa y no es cosmético:** bloquea **meter inventario**, que es la operación diaria del
  negocio. Y si el que miente resultara ser el **paso 1**, sería peor que el síntoma reportado — el dueño
  estaría viendo un número en el que confía para decidir cuánto paga.
- **Hipótesis a descartar CON CÓDIGO, ninguna confirmada todavía:** (a) dos fuentes distintas — el paso 1
  pinta un campo del listado y el paso 2 lo vuelve a pedir por otra ruta; (b) el acabado/variante — el
  precio del paso 1 cuelga de una variante y el paso 2 pregunta por otra (⚠️ regla dura del proyecto:
  **nunca se copia el precio de un acabado a otro**); (c) se pierde el identificador entre pasos;
  (d) semántica de omisión — el paso 2 lee «ausente» como «sin precio» cuando significa «no pedido»;
  (e) una condición extra del paso 2 (frescura, moneda, fila de referencia de hoy).
- **Segunda pregunta abierta:** ¿el bloqueo de «aportación» sin precio es **regla de negocio deliberada**
  (no se aporta lo que no está valuado) o efecto colateral? Si es deliberada, la regla está bien y el bug
  es solo que el precio se pierde.
- **Estado:** ✅ **DIAGNOSTICADO (2026-09-09). El que miente es el PASO 1.**
- **La causa, medida en código:** son **dos campos distintos que viajan en la MISMA respuesta del MISMO
  endpoint** — no se pierde ningún id, no se re-pide nada, no hay acabado de por medio.
  - **Paso 1** pinta `SealedProductDTO.marketRef` (`SealedProductPicker.tsx:216-217`): lectura **viva/caché
    de TCGCSV**, **sin gatear** por el dial y **sin respaldo en una fila `PriceReference`**.
  - **Paso 2** pinta `SealedProductDTO.effectiveMarketCents` (`SealedAddFlow.tsx:172`): el mercado
    **autoritativo**, ya pasado por `gateSealedMarketCents` (`pricing.service.ts:1763-1780`) con el dial
    `sealedPriceSource`.
  - ⇒ **El paso 2 dice la verdad: es lo que el backend aceptaría. El paso 1 enseña un número que el
    backend rechazaría** — inerte a efectos de dinero: no valúa la aportación, no publica, no fija venta.
- ⚠️ **Y es una regresión conocida a medio aplicar:** este es el mismo «dead-end de IMP-1» que se corrigió
  en v1.41 (`BACKEND_NOTES.md:14867-14884`, `FRONTEND_NOTES.md:8121-8145`, con test de regresión en
  `SealedAddFlow.test.tsx:221-257`). **Ese arreglo se aplicó al paso 2 y NO al paso 1.** La teja del picker
  se quedó en la semántica vieja — y `DESIGN_SYSTEM.md:3212-3213` todavía la respalda así, o sea que la
  especificación también quedó desalineada con la doctrina.
- **El bloqueo de «aportación» NO es el bug — es regla deliberada y correcta.** «Aportación» es
  `acquisitionType:'aportacion_en_especie'` con `pct:100`: el dueño no paga la pieza y el sistema le
  acredita un costo **valuado contra la referencia de mercado**. Sin referencia no hay número con el que
  acreditarla, y `inventory.service.ts:729-761` responde `422 PRICE_PENDING` en vez de valuar en $0. Eso es
  la doctrina money-safe funcionando. **El bug es que el paso 1 promete un valor que el backend no
  reconoce, y el operador llega al paso 2 sin entender por qué se le cerró la puerta.**
- **Agravante medido:** `SealedProductListResponse.sealedPriceSource` **ya llega al frontend**
  (`sealed-product.service.ts:63`, `:246`) y **el flujo no lo usa en ninguna parte**. El dato para
  explicarle al operador «la fuente automática está apagada, estos números son informativos» ya está en la
  respuesta, sin consumir.
- **El arreglo — rol dueño principal: `frontend`.**
  1. `SealedProductPicker.tsx:216-217`: la teja se keyea en `product.effectiveMarketCents`, igual que el
     paso 2. Con eso los dos pasos coinciden **por construcción** y desaparece el número que engaña.
  2. Si se quiere conservar el informativo, que sea **explícitamente secundario** (otra etiqueta, no
     «MERCADO»), nunca el número principal de la teja. ⛔ Y jamás $0: sin valor va «—» o «pendiente».
  3. `SealedProductPicker.tsx:219-226`: el `aria-label` arrastra el mismo error para lectores de pantalla.
  4. Consumir `sealedPriceSource === 'off'` para un aviso honesto **en el paso 1**.
- **Secundario, `backend` (no es la causa de esta captura, pero cierra la misma familia):** unificar el
  ancla del ingest con la del listado/alta (`sealed-price-ingest.service.ts:134-147` vs
  `sealed-product.service.ts:260` e `inventory.service.ts:822`). Es la deuda **D-2** de
  `TECH_DEBT.md:4519`, y es el **único** camino por el que el paso 2 diría «sin precio» con el dial
  encendido y precio ya ingerido. Y `pricedCount` (`sealed-product.service.ts:417-418`) cuenta hoy la
  fuente **sin gatear**: o cuenta gateado, o se renombra.
- **Lo que NO se pudo medir desde el código y hay que mirar en la instalación:** el valor real del dial
  `sealedPriceSource` (`GET /admin/settings`), si el job `sealed-price-ingest` ha corrido, y si esa ETB
  tiene fila `PriceReference` bajo el ancla del set. La hipótesis que explica la captura entera sin
  residuos es **dial en `off`** (el seed es `'off'`, `settings.constants.ts:294`), pero **es inferencia,
  no medición**.
- ⚠️ **Encender el dial NO cierra este pendiente:** aunque se prenda, el paso 1 seguiría mintiendo en
  cualquier producto sin fila. El arreglo de frontend hace falta igual.
- **Work stream:** inventario y vault — **distinto** del stream de FX que está en curso, así que no compite
  por las mismas rutas.

### Encontrado en pruebas post-publicación (2026-08-23)


#### P-46 · Sincronizar sellado devuelve «0 presentaciones»: el set no resuelve grupo TCGCSV (prod)
- **Reportado por el humano:** al Sincronizar sellado de **Pitch Black (2026)** (y Chaos Rising) sale «0
  presentaciones». **El botón SÍ funciona** — la sync corre.
- **Causa raíz (logs prod 2026-08-23):** `sealed-products/sync: set Pitch Black ... **sin grupo resoluble
  (ni curado ni name-match)** → nada que sincronizar (money-safe: no se adivina)`. El set no está vinculado
  a su **grupo de TCGCSV** (`tcgcsvGroupId`): ni curado a mano ni por name-match. Sin grupo no hay
  presentaciones que bajar. (Egress a tcgcsv.com OK — no hubo 502/UPSTREAM.)
- **Causa confirmada (name-match backend):** `matchScore` en `sealed-product.service.ts:777` usa
  `normalizeSetName` sobre el nombre directo, pero TCGCSV nombra los grupos con **prefijo de código**
  («SV08: Pitch Black» → `sv08pitchblack`) vs el catálogo local («Pitch Black» → `pitchblack`) → no empatan
  → 0.5 < umbral 0.9 → no auto-resuelve. Ya existe `setNameCandidates` (ppt-set-mapper:145) que quita ese
  prefijo, pero `matchScore` no la usa. **Afecta a CUALQUIER set con prefijo en TCGCSV** (no solo Pitch Black).
- **Fix (EN CURSO, backend):** `matchScore` tolerante al prefijo (reusa `setNameCandidates`) para que los
  matches legítimos suban a ≥0.9 y auto-resuelvan; **conserva** la salvaguarda «≥0.9 Y único en el tope →
  si empate, null (no adivina)». Con tests. Money-safe.
- **Workaround inmediato (humano, super_admin):** M1 → Sellado → «Agregar producto sellado» → elegir set →
  enlace «Curar/vincular grupo» (`SealedGroupLinker`) → elegir el candidato de TCGCSV (aparece con confianza
  media) → «Vincular» → re-sync automático baja las presentaciones.
- **Follow-up (frontend, no bloqueante):** UX del modal cuando la sync da 0 por «sin grupo resoluble» —
  guiar explícitamente al linker en vez de solo mostrar «0 presentaciones».


### Pendiente del humano · Razón social para el footer — ⚠️ LA NOTA ANTERIOR ERA FALSA (corregida 2026-09-08)
- **Lo que decía esta nota:** «el footer de producción aún dice [RAZÓN SOCIAL PENDIENTE]». **Medido: es
  falso.** El footer **ya omite la línea** y nunca ha enseñado el placeholder.
- **Por qué:** `resolveLegalEntity` (`frontend/src/app/[locale]/(storefront)/footer.ts`) devuelve `null`
  ante vacío, espacios o cualquier valor **entre corchetes** — y el valor real es `[Razón social
  pendiente]` / `[Legal entity pending]`. Hay tres tests que lo fijan
  (`footerLegalEntity.test.ts`). El footer publica «TCG HUNT · tcghunt.mx · © {año}», sin nada colgando.
- **Lo único que sigue pendiente**, y es dato del humano, no código: **cuál es la razón social**. El día
  que la dé, se pone en `common.footer.legalEntity` **sin corchetes** y aparece sola, sin desplegar código
  nuevo. *(El humano pidió el 2026-09-08 que «no salga de momento» — ya se cumple por construcción.)*
- ⚠️ **Lección:** esta nota afirmaba un estado de producción que nadie había medido, y llevaba semanas
  mandando a alguien a arreglar algo que ya estaba bien. Misma clase que los ocho tachones de D52.

---


## Nuevas ideas (aún NO en construcción — falta aterrizar con el humano)

### Idea · «Hunter Pulls» — mini-foro de pulls de la comunidad
- **Idea del humano (2026-08-22):** un **mini-foro** muy sencillo donde la gente pueda **subir qué pull
  hizo con nosotros** (posts con foto/descripción) y otros puedan **comentar**. Todo muy simple.
- **Requisito duro:** solo participan **usuarios registrados con nosotros** (postear y comentar exige
  cuenta). Encaja con el lenguaje de marca «cacería» (TCG HUNT 🎯).
- **Por aterrizar con product-owner:** alcance mínimo (post = imagen + texto corto + carta/set
  opcional; comentarios planos; sin votos/hilos anidados al inicio); moderación (¿quién aprueba?,
  reporte de abuso); qué se puede subir (¿ligado a una compra/pedido real con nosotros o libre?);
  privacidad/derechos de imagen; anti-spam básico.
- **Roles:** product-owner (aterriza) → arquitecto (modelo posts/comentarios + moderación + storage de
  imágenes) → backend + frontend + ux-ui. Nuevo módulo (community/social).

### Idea · Vender «meta decks» completos (bundles ready-to-play) — investigación hecha, falta aterrizar
- **Idea del humano:** apartado «Compra tu deck» — publicar los decks meta del mes como bundle completo,
  armados con nuestras cartas sueltas.
- **✅ Investigación hecha (2026-08-22):** meta Estándar post-rotación (Dragapult ex/Dusknoir el #1;
  Clefairy Box campeón NAIC; Slowking, Mega Lucario, Gholdengo; budget Crustle / Team Rocket's Mewtwo).
  Al jugador competitivo NO le importa la variante (juega la más barata legal; evitar reverse combadas).
  Pricing: suma de singles propios + premium 8–15% transparente, nunca con descuento; incluir energías
  básicas. Hueco de mercado claro en MX. Modelar como kit/BOM sobre `inventory` con stock verificado.
- **⚠ Timing:** lanzar DESPUÉS de Worlds 2026 (28–30 ago), con el meta post-Worlds.
- **Preguntas de producto:** ¿deck solo si el inventario surte la lista completa o parcial? ¿precio =
  suma de singles con ajuste o fijo por arquetipo? ¿energías/fundas incluidas?
- **Roles:** product-owner aterriza con el humano → arquitecto/backend/frontend cuando esté definido.

---

