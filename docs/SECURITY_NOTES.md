# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-10-26).** Último veredicto: **APROBADO** sobre **`2f5a59c0f1bf063e47e104b084e02036ac381456`**
> (release «Códigos de descuento v1.110.3–v1.112.1 · evento de prueba de Meta · aviso de privacidad con la medición»).
> Críticas 0 · Altas 0 en el delta. **DSC-1 del pentester: CERRADA** (decisión del dueño, implementada y medida).
> **Encender la medición: NO APROBADO todavía.** Lo frena hoy MKT-F2-3 (la puerta de build y el backend lo hacen cumplir) y,
> además, este pase abre **SEC-MED-1** (Media, solo aplica al encender): la URL completa con `?q=` llega a Google y a Meta.
> Lo heredado sigue en «Registro vigente»: **P-RL-1**, **CL-1** (CSP en `report-only`, sin aceptación escrita del dueño), **BL-42**.

---

# VEREDICTO BLUE TEAM — **Release «Códigos de descuento / evento de prueba de Meta / aviso con la medición»** · SHA **`2f5a59c0f1bf063e47e104b084e02036ac381456`** · 2026-10-26 · seguridad

> ## VEREDICTO: ✅ **APROBADO** sobre `2f5a59c0`, sin condiciones (con la medición APAGADA)
> **0 críticas · 0 altas · 1 media nueva que solo aplica al encender (SEC-MED-1) · 1 baja aceptada (SEC-DSC-QA7) · 3 info.**
> El pase del pentester sobre `c421de13` (0/0/0, 1 baja, 2 info) queda consolidado. **DSC-1 está CERRADA en `2f5a59c0`.**
> El endpoint `POST /admin/measurement/meta-test-event` **pasa** la revisión que pide ARCHITECTURE §14.11.
> La puerta de encendido muerde. Lo que promete el aviso **se cumple en el servidor**, pero **no del todo en el navegador** (SEC-MED-1).

## Procedencia (O-9 / O-14)
- **Copia del árbol ENTERO** anclada al sha: `git archive 2f5a59c0 | tar -x` en `scratchpad/seg-rel4/tree/`. El árbol vivo estaba en
  `2f5a59c0` y limpio (`git rev-parse HEAD`, `git status --short` = 0 líneas). `node_modules` de backend por enlaces, salvo `@prisma`,
  `prisma` y `.prisma`, que copié para correr `prisma generate` **en la copia**. Sin BD (Postgres no responde en :5432 y no hay docker), sin
  navegador (QA y tester-e2e tenían el suyo), sin credenciales, sin tocar producción. Load entre 10 y 15 con 4 CPU. Las pruebas que corrí son
  deterministas, así que la carga no cambia el resultado. **La copia está borrada**; los logs quedan en `scratchpad/seg-rel4/logs/`.
- ⚠️ **Operativo:** el cliente Prisma del árbol vivo está **viejo** (`grep -c countedCodeHashes backend/node_modules/.prisma/client/index.d.ts` = 0;
  24 tras `generate`). Sin regenerar, 5 suites caen **por tipos, no por conducta**.
- **Alcance:** el delta `c421de13..2f5a59c0` (123 ficheros) y el pase del pentester sobre `c421de13` (`docs/PENTEST_NOTES.md`, commit `237d9751`).
  `origin/production` = `bf7d2281`: M-92 **no** está en su árbol (`git ls-tree origin/production backend/prisma/migrations/ | grep -c m92` ⇒ 0).
- **[MEDIDO] Suites:** `npx jest test/discounts test/measurement` ⇒ **17/17 suites, 268/268 pruebas**.
- **[MEDIDO] DSC-1** con una prueba mía solo en la copia (`DiscountsService` real, doble de Prisma): el mismo `not_applicable` 12× cuenta **1**; otro
  código suma 1; `invalid` suma siempre; al 5.º, `blockedUntil` ⇒ **verde**.
- **[MEDIDO] Mutaciones** sobre la copia, restauradas con `.bak`. `diff -rq backend/src` contra el árbol vivo sale vacío. N=1 cada una porque son
  deterministas:

| Mutación | Qué reintroduce | Resultado |
|---|---|---|
| M1 sin la línea `counted.includes(codeHash) ⇒ return` | sin deduplicar: re-cotizar el mismo código bloquea | **rojo solo en mi prueba**; las 101 de `test/discounts*` siguen verdes |
| M2 `quoteOutcome` sin `recordFailure` en `not_applicable` | **DSC-1 tal cual** (el quote no cuenta) | **0 rojas** en `test/discounts*` |
| M7 `countingAttempts` sin la rama `DISCOUNT_CODE_NOT_APPLICABLE` | DSC-1 en la sesión | **0 rojas** en `test/discounts*` |
| M3 `redactMetaText` sin quitar el token literal | token de CAPI en la respuesta y la bitácora | **2/16 rojas** (C-B13) |
| M4 `user_data` con `client_ip_address` | dato personal hacia Meta | **3/16 rojas** (C-B12) |
| M5 límite con `>` en vez de `>=` | 6 envíos por hora | **1/16 roja** (C-B14) |
| M6 `TEST_EVENT_CODE_RE = /^.*$/s` | inyección en `test_event_code` | **2/16 rojas** |

  **Lectura de M1/M2/M7:** el candado de DSC-1 vive **solo** en la integración (`test/integration/discounts.e2e-spec.ts:583,911-1000`, DCO-B9 ampliada),
  que necesita Postgres. Lo leí, pero **NO lo corrí**. Las pruebas puras no lo cubren: lo registro como SEC-DSC-I1 (info), no como hueco.
- **[MEDIDO]** En las líneas añadidas: formas de clave (`sk_live_`, `rk_live_`, `whsec_`, `AKIA…`, PEM, `EAA…`) = 0; `dangerouslySetInnerHTML`/`$…RawUnsafe` = 0; `check-secret-defaults.sh` rc 0.
  Sin cambios en `package*.json`/lockfiles ⇒ sin `npm audit` (exposición = PRE-P3/PRE-P4).
- **NO MEDIDO por mí:** las suites de frontend (`measurement-gate*.test.ts`, `next-config-measurement-gate.test.ts`, `MetaTestEventBlock.test.tsx`,
  `frontend-never-sums-discount.test.ts`) y `scripts/check-measurement-publish-gate.sh`. El árbol vivo no tiene `frontend/node_modules`, así que
  los leí y no los ejecuté. Tampoco medí el 403 en vivo del endpoint de Meta para otro rol, ni la configuración real de GA4 y del píxel en sus consolas.

## 1. Consolidación del pentester (`docs/PENTEST_NOTES.md`, pase `c421de13`)

| Vector | Su resultado | Mi lectura en `2f5a59c0` | Estado |
|---|---|---|---|
| **DSC-1** (Baja) · `not_applicable` confirma que el código existe y no cuenta | decisión del dueño | **CERRADA.** El dueño eligió «Decir motivo y contar» (`HECHOS.md`, fila «Códigos de descuento: un código vigente que no aplica cuenta como intento», 2026-10-26). Quote: `discounts.service.ts` `quoteOutcome` ⇒ `recordFailure(keys, now, ev.row.code)`. Sesión de invitado, de bóveda y retiro: `countingAttempts` ⇒ `recordFailure(keys, now, code)` **fuera** de la tx deshecha (`guest-checkout.service.ts:596`, `orders.service.ts:1712`, `shipments.service.ts:682`). Se deduplica por HMAC del código y ventana (`countedCodeHashes`, `domainHmac('dsc-throttle:code:')`; el texto del código no se guarda en claro). `details` mínimos: `DESTINATION` ⇒ `{}` (`money.ts` `discountOf`), `MIN_SUBTOTAL` solo `missingCents` (ya no `minSubtotalCents`), `ZERO_DISCOUNT` ⇒ `{}`. Lo midió mi prueba; el candado del repo está en la integración (ver M2/M7) | ✅ **cerrada** |
| DSC-2 (Info) · el tope por cliente se esquiva con otro correo o con `+alias` | riesgo aceptado §DSC.5(a) | Sigue igual (`evaluate` compara `customerEmail` literal). Aceptado: registro B | ✅ aceptado |
| DSC-12 (Info) · tiempo de respuesta del camino inválido | mitigado | `NIL_CODE_ID` sigue en `evaluate`. Con DSC-1 cerrada, los dos caminos además **escriben** lo mismo (`recordFailure`) | ✅ aceptado |
| DSC-3…DSC-11 · el cliente no fija importes; BigInt; `FOR UPDATE`; reembolso no revive el uso; retiro MX$0; 21 rutas `super_admin`; Prisma parametrizado; CSV; un código por pedido | verificado-seguro | El delta los conserva: `applyInTx` mantiene `evaluate(…, {lock:true})` + `reserve` dentro de la tx; `$queryRaw`/`$executeRaw` siguen con plantilla (parametrizados); `orderId @unique` sin cambio | ✅ |

## 2. Revisión del delta con lente de dinero (códigos de descuento)

- **`quoteOutcome` / `applyInTx`: una sola orquestación, sin camino que se salte la validez.** El quote **no aparta** nada
  (`evaluate` con `lock:false`) y responde `rate_limited`, `invalid`, `not_applicable` o `applied`. La sesión pasa por `openAttempt`
  (429 antes de tocar nada), luego `applyInTx` **después** de la puerta por cliente y de la sustitución, con `FOR UPDATE` de la fila del
  código y el `now` de la tx. Cualquier fallo lanza 422 y **deshace** orden, uso y PI. El candado de fuente TL-DSC-4
  (`discounts-v1103.pure.spec.ts:190-203`) prohíbe llamar a `evaluate`/`recordFailure`/`reserve` fuera de `discounts/`. Lo cobrado sigue
  saliendo de `applied.priced.breakdown`, calculado en el servidor.
- **`ZERO_DISCOUNT` (precedencia 8).** Un `%` o un monto que rinde `D = 0` ya no aparta un uso sin beneficio. Eso importaba en los lotes de un
  solo uso: antes se podía «quemar» un código ajeno con un carrito que no lo aprovechaba. Va **después** de `TOTAL_BELOW_MINIMUM`, sin
  `details`, y cuenta como intento (deduplicado). La vista previa del admin devuelve `{0,0,false}` (`admin-discounts.service.ts:269-271`).
- **Pago tardío por `DiscountRedemption` (I-7).** «¿Lleva código?» ya no se deduce de `discountCents > 0 ∨ shippingWaivedCents > 0`, sino de la
  fila (`consumeOrderRedemption` busca por `orderId`; sin fila, cero escrituras). Así no queda un uso apartado sin consumir por un importe 0.
  Se quitó la `tx`: la única escritura es `updateMany … where {id, status: <leído>}`, un CAS atómico. Si pierde una carrera, `count = 0` ⇒
  `consumed:false`, sin doble consumo. La rama sigue con **cero** escrituras sobre orden, piezas o avisos (`payments.service.ts:289-298`).
  `mailDiscountOf` y los tres detalles leen del mismo lector (`orderDiscountOf`): un hecho, un sitio.
- **`countedCodeHashes` (HMAC).** Es una columna `TEXT[] NOT NULL DEFAULT '{}'`. Se vacía al abrir ventana nueva (`fresh ⇒ []`). Su tamaño
  está acotado por `discount_code_max_failures`, porque cada hash nuevo suma 1 y, al bloquear, el quote sale por `rate_limited` y la sesión
  por 429 **antes** de `recordFailure`. Es HMAC de dominio propio con `PII_HMAC_KEY`, como IP y correo: la tabla no revela qué códigos se
  probaron. El código que se compara es el normalizado, igual en quote (`ev.row.code`) y en sesión (`code`, la misma cadena por `findUnique`).
- **M-92 editada en su sitio** (`NOT NULL` en `productScopes`, `destinations` y `countedCodeHashes`). No está en `origin/production` (medido arriba),
  así que la producción la recibe ya corregida. Si algún staging o base local la aplicó antes, Prisma verá la suma de control cambiada:
  SEC-DSC-I2 (info, devops).
- **Residuo de DSC-1, dicho entero.** Con la decisión del dueño, el oráculo de existencia **sigue** (el cliente ve el motivo), pero ahora
  **cuesta un intento por código distinto**, igual que un código inválido. Su techo es el límite por IP/correo/usuario. En invitado, el
  atacante elige el correo, así que el techo real es el de la IP, y ese es justo el que **P-RL-1** puede dejar esquivar con
  `X-Forwarded-For`. No es nuevo: es P-RL-1 aplicado a códigos.

### QA menor (7) — la clave `email:` del límite · **SEC-DSC-QA7 · Baja · ACEPTADA**
**Lo que pasa** (lo confirmo por código): el quote de invitado acepta un `email` cualquiera y lo usa **para el límite y para el
por-cliente** (`guest-checkout.service.ts:324-329`).
- **(a) Bloquear a otro.** Con 5 quotes con código inválido y el correo de la víctima, `email:<hmac>` queda bloqueado 15 min. Mientras dure,
  la víctima recibe 429 **solo si usa un código**: comprar sin código no pasa por `openAttempt`. La IP del atacante se bloquea a la vez, así
  que mantener el bloqueo exige rotar IP (P-RL-1).
- **(b) Saber si un correo ya usó un código.** Con un código conocido que tenga `maxUsesPerCustomer`, el quote con el correo de la víctima da
  `invalid` si ya lo usó y `applied` si no. Revela que esa persona compró con ese código, que es un dato de relación comercial. Cada sonda
  cuesta un intento.
- **Por qué la acepto:** no mueve dinero ni deja usar un código de más. El bloqueo es de 15 min, no impide comprar y le cuesta lo mismo al
  atacante. La fuga (b) necesita conocer el correo y un código con tope por cliente. La alternativa (no evaluar el por-cliente en el quote)
  deja la misma fuga en la sesión, y ahí además cuesta una reserva. **Disparador para volver a abrirla** (dueño: backend; decide el arquitecto):
  (1) un código con tope por cliente publicado en redes, (2) una queja de «no me deja usar mi código», (3) más de 3 bloqueos `email:` en un día
  en `DiscountCodeThrottle`, o (4) P-RL-1 confirmado como esquivable (sin el tope por IP, (b) no tiene techo). Entonces: quitar el
  por-cliente del quote de invitado y llevar `email:` solo a la sesión.

## 3. `POST /admin/measurement/meta-test-event` (§MKT.H.12, D-MKT2-10) — revisión «antes de encender» de §14.11: **PASA**

| Lo que se pide | En el código | Estado |
|---|---|---|
| Solo `super_admin` | `@Roles(Role.super_admin)` **de clase** (`admin-measurement.controller.ts:21`). Sin `@Public`, sin `marketing:read`. Hay metadata, así que no aplica el modo «falla abierto» de S-M4P-A. La prueba de rol de la spec mira la metadata. **403 en vivo: NO MEDIDO** | ✅ (vivo NO MEDIDO) |
| 5 por hora | Global, contado sobre `AuditLog` (`measurement.meta_test_event`, 60 min móviles) **dentro** de una tx con `pg_advisory_xact_lock(86_120_002,1)`: dos envíos simultáneos no pasan los dos el 5.º. 400/409/422/429 ni cuentan ni se auditan. Lo fija M5 | ✅ |
| Token redactado | Va en el **cuerpo**, no en la URL (`metaEventsUrl`). La respuesta de Meta se lee hasta 64 KB y se reduce a una lista cerrada (`events_received`, `fbtrace_id`, `messages`≤5, `error.{code,subcode,type,message}`). Cada texto se **redacta antes de recortar** (literal ⇒ `[token]` y `access_token=…`). El log solo trae `status/http/version` y la bitácora no lleva el token. Lo fijan M3 y C-B13 | ✅ |
| Sin datos personales | `user_data` = un `fbp` sintético nuevo (`fb.1.<ms>.<10 dígitos al azar>`). No lleva `custom_data`, `external_id`, IP ni UA. `event_source_url` = origen de `APP_BASE_URL` + `/`. No lee pedidos ni usuarios. Lo fijan M4 y C-B12 | ✅ |
| SSRF / inyección en `testEventCode` | Lista cerrada de claves (`{testEventCode}` y nada más) y `^TEST[0-9]{3,10}$` tras `trim`, sin eco del valor en `details`. El host es fijo (`https://graph.facebook.com`), la versión fija (`v26.0`) y `pixelId` sale del entorno con `^\d{10,20}$` + `encodeURIComponent`. Nada del cliente toca la URL. Lo fija M6 | ✅ |
| Nada se guarda en el cliente | `MetaTestEventBlock.tsx`: código y resultado viven solo en el estado del componente. Sin `useMutation`/`useQuery` (caché), sin URL, sin `localStorage`/`sessionStorage`, sin `data-*`. Hay guarda síncrona contra el doble clic y React escapa `metaMessages`, sin HTML. Lo leí, **no** corrí su prueba | ✅ (prueba de front NO MEDIDA) |
| Salir a Meta sin el interruptor | Es a propósito, porque es lo que cierra MKT-F2-3. El riesgo queda acotado a 5/h, `super_admin`, ningún dato de cliente y un evento de prueba (`test_event_code`) que Meta no cuenta como conversión | ✅ aceptado |

## 4. Aviso de privacidad con la medición y puerta de encendido

**No se puede encender hoy, y lo medí por código:**
- **Frontend:** `ENCENDER_BLOCKERS` = `[MKT-F2-3]` (`measurement-gate.ts`). Con `NEXT_PUBLIC_MEASUREMENT_MODE=on`, `measurementGateProblems`
  añade «bloqueo de encendido abierto», `prebuild` corre `check:measurement` y el build cae (Vercel no publica un build fallido). Además,
  `next.config.mjs` lanza si la declaración falta o está mal formada, aunque alguien se salte `prebuild`. `check-measurement-publish-gate.sh`
  E5 distingue «solo bloqueos» de «problema del aviso». Ese script no lo corrí (sin `node_modules` de frontend).
- **Backend:** `BACKEND_ENCENDER_BLOCKERS` = `[MKT-F2-3]`. `MEASUREMENT_MODE=on` arranca en modo efectivo `off` y deja
  `MEASUREMENT_ENCENDER_BLOCKED`. MKT-F2-4 salió de las dos listas a la vez, con paridad (`measurement.encender-gate.spec.ts` verde, medido).
  Su `closedBy` (C-B11 contra Postgres) **NO lo medí**: lo afirma backend sobre `a05a6e68`.
- **El aviso:** `MEASUREMENT_DISCLOSURE` = `{version:'2026-10-medicion-1', approvedByOwnerOn:'2026-10-26', legalReviewOn:null,
  legalReviewWaivedByOwnerOn:'2026-10-23'}`, una sola fecha de revisión y la correcta (`HECHOS.md` 2026-10-23 y 2026-10-26). La frase vieja
  está a 0 en `privacidad.es.ts`, y los siete términos aparecen (`grep -c` ≥ 1 cada uno). Nueve frases-promesa del texto aprobado están
  literales en el aviso (`grep -cF` = 1 cada una).

**¿Se cumple lo que promete el aviso?**
| Promesa del aviso | Código | Estado |
|---|---|---|
| «No se envía nunca nombre, correo, teléfono, dirección, CP, tarjeta, CLABE, INE, RFC, `TCG-…`… **tampoco cifrados**» (servidor) | `measurement-bodies.ts`: lista cerrada. GA4 sin `user_id`/`user_data`/`ip_override`; CAPI con `user_data` = solo `fbp`/`fbc`; `transaction_id` = `Order.id` (uuid), no `orderNumber`. C-B3 verde | ✅ |
| «Desde nuestros servidores no les enviamos tu IP» | Ni `client_ip_address` ni `ip_override` (C-B3; M4 para el de prueba) | ✅ |
| «Solo lo necesario ⇒ GA4 recibe la compra con un id al azar; a Meta nada» | `clientIdOf`: sin analítica, `randomClientId` por evento. `meta_capi` solo si `measurementConsentAds === true` y hay `fbp`/`fbc` (`measurement.service.ts:180`). Sin respuesta al banner ⇒ 0 filas (`:177`) | ✅ |
| «Ids de Google y Meta se borran a los 7 días» (servidor) | `MEASUREMENT_TTL_MS = 7 d` y el drenador purga `MeasurementContext`/`Outbox` vencidos (`measurement-drain.service.ts:85-86`) | ✅ |
| «No hay medición en cuenta, bóveda, CLABE/INE (`/buylist/solicitud`), detalle de solicitudes, login, seguimiento, aviso» | Lista blanca `routes.ts`, sin `/buylist/:seg`, sin `/pedido`, `/orders` ni `/privacidad`. Navegación **dura** hacia lo excluido (`hard-navigation.ts`, C-F5). `goToSellRequestStep` usa `location.assign` | ✅ |
| «Card Show: solo GA4, sin Meta, sin formularios» | `UNLOCALIZED_POLICY['/card-show'] = {pixel:false, events:'page_view_only'}`, coincidencia exacta | ✅ |
| «Sin funciones de publicidad de Google» | `allow_google_signals:false`, `allow_ad_personalization_signals:false`, `consent` de anuncios `denied`. En consola: **NO MEDIDO** | ✅ código / consola NO MEDIDA |
| «Las páginas que visitas (**sin datos personales en la dirección**)» y «cuántos resultados da una búsqueda (**no lo que buscaste**)» | **No del todo: ver SEC-MED-1** | ❌ al encender |

### SEC-MED-1 · **Media** · aplica solo al ENCENDER · dueño: frontend (+ arquitecto, + dueño en la consola de GA4)
**Qué:** ARCHITECTURE §14.4 «URL que sale» pide que `page_location`, `page_referrer` **y la URL que ve el píxel** pasen por
`sanitizeMeasurementUrl`. En el código solo pasa en el **parámetro** del `page_view` (`track.ts:104-106`, `MeasurementProvider.tsx:151`).
- `gtag('config', id, …)` (`loader.ts:54-58`) no fija `page_location`. Para todo evento que no sea `page_view` (`search`, `view_item`,
  `add_to_cart`, `begin_checkout`…), gtag pone por defecto la URL **completa** del documento.
- `fbq('track', …)` siempre manda la URL del documento (`dl`), y no hay forma de sanearla después.
- En las rutas medidas, el texto libre de la búsqueda va en la query: `/catalog?q=…` (`CatalogView.tsx:436`). Lo mismo pasa con cualquier
  parámetro que traiga un enlace de fuera.
- **Agravante, NO MEDIDO:** un flujo web nuevo de GA4 nace con la «medición mejorada» encendida, y su «búsqueda en el sitio» lee justo `q`
  como `search_term`. API_CONTRACT §MKT.H.10 no le pide al dueño apagarla.

**Evidencia:** lectura de código. El envío real **NO MEDIDO**, porque por encargo no usé navegador. Se mide con el C-F3 de Playwright (`on`,
terceros interceptados): buscar «pikachu» en `/es/catalog` y comprobar que ninguna petición a `google-analytics.com`/`facebook.com` lleva
`q=pikachu` en `dl`/`dl=`.

**Por qué no bloquea este release:** la medición está apagada y **no se puede encender** (sección 4). El impacto es incumplir una promesa del
aviso (el término buscado, que puede ser texto libre), no una fuga de PII de la tienda.

**Mínimo para cerrarla:**
1. Frontend: `page_location` saneado en `config` (y `gtag('set', {page_location})` en cada navegación medida). Para el píxel, o no cargarlo
   en una ruta con query no-UTM, o quitar `q` de la URL visible antes de cargar. Lo decide el arquitecto, porque toca §14.4.
2. Arquitecto: añadir a §MKT.H.10 «medición mejorada apagada (al menos búsqueda en el sitio, formularios y cambios de historial)».
3. **Candado:** una entrada `SEC-MED-1` en `ENCENDER_BLOCKERS` (frontend, con su ficha en `TECH_DEBT`; la paridad SEC-MKT-2 la exige). Así la
   puerta muerde sola aunque MKT-F2-3 se cierre antes. **Lo enruto ya**, para que la entrada exista **antes** de que el dueño mande el evento
   de prueba que cierra MKT-F2-3.

## 5. Hallazgos de este pase

| ID | Sev | Qué | Ubicación | Dueño | Disparador / cierre |
|---|---|---|---|---|---|
| **SEC-MED-1** | **Media** (al encender) | URL sin sanear en eventos que no son `page_view` y en el píxel; medición mejorada de GA4 | `loader.ts:54-58`, `track.ts`; §MKT.H.10 | frontend + arquitecto (+ dueño en consola) | Cierre: entrada en `ENCENDER_BLOCKERS` **ya**; arreglo + C-F3 con `?q=` antes de encender |
| SEC-DSC-QA7 | Baja (aceptada) | La clave `email:` del quote permite bloquear 15 min los códigos de un correo ajeno y saber si ya usó un código | `guest-checkout.service.ts:324-329` | backend (arquitecto decide) | Sección 2 |
| SEC-DSC-I1 | Info | El candado de DSC-1 vive solo en la integración (M1, M2 y M7 no los ve ninguna prueba pura) | `test/integration/discounts.e2e-spec.ts:583,911` | backend | Si la integración deja de correr en CI, o si `discounts.service.ts` pasa a `backend-lite` ⇒ una prueba pura como la mía |
| SEC-DSC-I2 | Info | M-92 editada en su sitio: suma de control distinta en una BD que ya la aplicó (staging o local) | `20261109120000_m92_discount_codes/migration.sql` | devops | El primer `migrate deploy` en staging que avise de modificación ⇒ recrear esa BD; producción no la tiene |
| SEC-MTE-1 | Info | `fetch` hacia Meta con `redirect:'follow'`: un 307/308 de Graph reenviaría el cuerpo con el token. Host fijo de Meta ⇒ teórico (clase PRE-P2) | `measurement-http.ts` | backend | El próximo toque del fichero |

## 6. VEREDICTO
### ✅ **APROBADO** sobre `2f5a59c0f1bf063e47e104b084e02036ac381456`, sin condiciones, para publicar **con la medición apagada**
- En el alcance (delta `c421de13..2f5a59c0` más el pase del pentester): **0 críticas y 0 altas**. La única Media (SEC-MED-1) solo existe al
  encender, y encender está bloqueado por dos puertas (build y backend) que leí y, en backend, medí.
- **DSC-1 cerrada**, según la decisión del dueño: medida con mi prueba. El candado del repo está en la integración (SEC-DSC-I1).
- El endpoint de Meta pasa la revisión de §14.11, con 4 mutaciones que lo muerden (M3–M6).
- **Encender la medición NO queda aprobado.** Mínimo: SEC-MED-1 cerrada (o al menos su entrada en `ENCENDER_BLOCKERS`), MKT-F2-3 cerrada
  por el evento de prueba, y el repaso de consola de §14.11 (GA4 sin Signals y sin medición mejorada; píxel sin coincidencia avanzada ni
  autoconfiguración). Ese repaso lo hace el dueño con su pantalla, y yo reviso la evidencia.

— SEGURIDAD (blue team / AppSec), 2026-10-26 · sha **`2f5a59c0f1bf063e47e104b084e02036ac381456`** · **APROBADO**

---

# Registro vigente — lo abierto y lo aceptado que sigue en pie (consolidado el 2026-10-26)

> Cada fila dice **qué veredicto la midió por última vez**. Si no la re-medí hoy, lo dice. El detalle está en
> `git show 60250e90:docs/SECURITY_NOTES.md` (busca el ID); lo del veredicto `60250e90` en `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

## A. Abierto (no lo introduce este release; pesa porque la tienda ya cobra en real)
`HECHOS.md:16`, 2026-10-16: «LA TIENDA YA ESTÁ EN VIVO EN MODO REAL DE STRIPE», afirmado por el dueño y NO medido por el orquestador.

| ID | Sev | Qué | Dueño | Última medición | Cierre |
|---|---|---|---|---|---|
| **P-RL-1** | **Media** (era Alta antes de C7) | El tope por IP se puede esquivar rotando `X-Forwarded-For` si el edge de Railway pasa el valor del cliente. El tope **por cuenta** (C7: 5 intentos, y luego 429) sí protege el login (pentester, `c62621e6`). Queda la evasión del tope por IP en endpoints públicos: scraping (BMK-1) y DoS de la ruta de cobro (SB-B3). Clasifico Media, como en `c62621e6` §6. El pase `8e1b34d7` copió «Alta» de antes de C7 | devops | 2026-10-10: ronda con XFF rotatorio, 6×401 sin 429; **falta la ronda de control** (`HECHOS.md:168`) | C6 completo (§85.4 de `DEVOPS_NOTES`), con proporción N/N, en ventana autorizada por el dueño |
| **SEC-MED-1** | **Media** (al encender) | URL completa (con `?q=`) en eventos de GA4 que no son `page_view` y en el píxel; medición mejorada de GA4 sin apagar en §MKT.H.10. Detalle en el veredicto `2f5a59c0` §4 | frontend + arquitecto (+ dueño, consola) | `2f5a59c0`, 2026-10-26 (código; envío real NO MEDIDO) | Entrada `SEC-MED-1` en `ENCENDER_BLOCKERS` **antes** de cerrar MKT-F2-3; arreglo + C-F3 con `?q=` en verde |
| **CL-1** / SEC-HDR-2 / CSP-RO | **Media** | CSP en `report-only` (**[MEDIDO 2026-10-26]** `frontend/src/security/csp.ts:37`; `HECHOS.md` sigue sin fila de aceptación). Con la sesión en `localStorage`, un XSS daría una sesión de súper-admin de hasta 7 días. No se conoce ningún XSS (`grep dangerouslySetInnerHTML` = 0 en el pase `8e1b34d7`) | frontend + devops | `8e1b34d7`, 2026-10-10 (vuelta a report-only a propósito) | CSP en `enforce` según §14.3 de `DEVOPS_NOTES` + `check-csp-zap-parity.sh` rc 0. **O** el dueño lo acepta por escrito en `HECHOS.md` (hoy no hay esa fila: lo busqué) |
| **CL-3** | Media | Evidencias «antes de `sk_live_`»: C6, DAST `full` sellado sobre el sha de producción, C3 = 0, simulacro de restauración con las claves `PII_*` fuera de Railway | devops + dueño | `c62621e6` (2026-10-05); después **NO MEDIDO** | Los cuatro resultados en `DEVOPS_NOTES §85`, con fecha y sha |
| LIVE5-STRIPE | Media | La lógica de reembolso SPEI (`chargeState`, `to-manual`) solo se probó contra un doble de Stripe | backend + pentester | `8e1b34d7` | Pasada en Stripe modo prueba (CS-1…CS-6) |
| **BL-42** (caminos 1 y 3) | **Media** | INE sin ancla de purga ⇒ retención indefinida | backend + dueño | `c62621e6` | ⚠️ La primera solicitud ARCO, o la regla 7 encendida |
| S-M4P-A | Media | `RolesGuard` falla ABIERTO y el endpoint PII-denso de `admin-shipments` no tiene candado de regresión | backend | `5e6f2ee` (2026-09-22); después **NO MEDIDO** | El primero de: tocar ese controlador, darle el módulo al modelo barato, o el próximo release (**ya vencido**: lo re-enruto) |

**Cerrado desde la última consolidación (medido hoy):** CL-2 / P-GL-2 (`security/gitleaks.toml:193-230`: sin exención por ruta de `docs/`,
con canario). C-SEC-1/C-SEC-2/SEC-CS-C del Card Show: **anuladas**, porque se retiró el escaneo de patrocinador (`93a8f213`; el dueño dijo que no hay
nombre confidencial, `docs/specs/CARDSHOW_LANDING_ESTADO.md:146`). `scripts/check-ci-ok.sh --static` ⇒ rc 0 (29 jobs en `needs`).
C-SEC-3: los secretos del Card Show están documentados (`DEVOPS_NOTES.md:11-12`) y fallan cerrados en runtime; que estén cargados en Railway: **NO MEDIDO**.
MKT-TL2, SEC-MKT-1/2/3, CS-RT-1, C7, CL-2: cerrados.

## B. Deuda de seguridad aceptada (no bloquea) — impacto y disparador
| ID | Sev | Impacto aceptado | Disparador | Dueño |
|---|---|---|---|---|
| REL7-P1 / PRE-P3 / RL-DEP-1 | Media/Info | `@nestjs/core` GHSA-36xv (SSE); `@Sse` = 0. **Aceptado por el dueño** (`HECHOS.md:165`, 2026-10-10) | El primer `@Sse`, que el audit suba a alta, o Nest 11+ | devops |
| PRE-P4 / SEC-B62-2 | Info | Avisos altos o críticos solo en tooling de build o dev | La próxima actualización de dependencias | devops |
| SEC-MKT-4 (X2) | Info | Un insider con su propio pedido y un UTM inventado despeja el MX$ de otro en b1/b2 | El primer analista que no sea el dueño, o MX$ de b1-b3 en el export de `TIENDA_PANEL_TOKEN` | arquitecto → backend |
| MKT-INFO-1/2/3 | Info | XSS sin 2.ª barrera (= CL-1); un delegado `marketing_read` podría borrar anotaciones; el throttler multiplica por N con N instancias | CL-1; la primera ruta que conceda `marketing_read`; más de 1 instancia | frontend/devops; arquitecto; backend |
| SEC-CS90-1 | Baja | El contador del torneo sin *single-flight* | Más de 1 000 inscripciones, o p95 > 100 ms | backend |
| CS-RT-2/3/4/5 | Baja/Info | gmail↔googlemail; `/ir` y `/click` sin throttle propio; DNS de MX; timing teórico | Ver ficha (bombing por alias, crecimiento de `CardShowClick`) | backend |
| SEC-CS-E | Baja | El «To» interno con PII sale de la env `INTERNAL_RECIPIENTS` | Un segundo destinatario interno | backend/devops |
| Aviso del embed de Maps | Baja | El aviso de privacidad no menciona Google Maps | Antes de CSP `enforce`, o una revisión legal | product-owner + arquitecto |
| PNL-6 / PNL-7 | Baja | `/admin/finance` sin `no-store`; `Content-Disposition` con `report` sin sanear | El próximo stream en `modules/admin`, o un endpoint financiero fuera de `super_admin`+Bearer (ahí pasan a bloqueantes) | backend |
| SD-4 | Baja | El export `.xlsx` rotula el sellado con la carta ancla | La decisión del arquitecto sobre el rótulo | arquitecto → backend |
| LZ2-S1/S2/S3, LZ-S4 | Baja | Salida del ensayo B con PII; G-9 declarativa; pedidos previos al rastro | Antes de pegar salidas en el chat; cualquier retraso de B más allá de `sk_live_` | backend + dueño |
| SU-S2…S5 | Baja | Error de tecleo en el precio; pieza duplicada por reintento; host en `stderr`; re-publicar una retirada | El primer caso real; trabajo en idempotencia; script en CI; la decisión «retirada» | frontend/backend/arquitecto |
| AN-5 | Baja | `GET /admin/reports/sales*` sin acotar en memoria | >10 000 pedidos o >50 000 `OrderItem` en 366 días; un 5xx o p95 > 3 s; un segundo `super_admin` | backend |
| A-BSD-1, I-BSD-1 | Baja/Info | `label.pdf` con throttle por IP; domicilio retenido en `pickupAddressSnapshot` | Un 429 legítimo, >1 instancia, o `sk_live_` (**ya ocurrió: re-enruto a backend**); la política de retención | backend |
| RL-INFO-2 | Info | Sin tope monetario para `super_admin` (reembolsos a la tarjeta de origen) | Un segundo `super_admin`, 30 días con dinero real (**vence ~2026-11-15**, si el en vivo empezó el 2026-10-16) o un incidente ⇒ 2FA + re-autenticación | dueño, backend |
| RL-INFO-5, RL-SEC-2 | Info/Baja | 403/404 deja saber si un UUID existe; `@railway/cli@latest` y `vercel@latest` sin fijar | Tocar `getOrder`; **antes** de cargar `RAILWAY_TOKEN`/`VERCEL_TOKEN` | backend; devops |
| STF-P1, STF-S1, R69-1 | Baja | El handle del staff queda en `AuditLog`; un `super_admin` puede tomar la cuenta de otro; `reason` sin tope | ARCO de un ex-empleado; un segundo `super_admin` humano; el próximo cambio en `orders/dto` | backend / arquitecto |
| SEC-DIN-1/2, SSL-R1 | Baja | Mercado de otra caja en el export; alias que esquiva el guardarraíl; piezas atrapadas en `reserved` | El próximo llamador de COMPRA; el primer reembolso desde el panel de Stripe | backend (+ arquitecto) |
| S-M4P-B, M4P-1/2/5, S-M4P-C | Baja/Info | PII en la caché de disco del operador; fila corrupta tumba la cola; amplificación; ficha de dependencias | Ver ficha (equipo compartido, nuevo escritor de `fulfillmentMode`, paginar) | backend / devops |
| SEC-SHIP-B1…B14, M7 | Baja | `speiReference` no única; importes congelados solo por convención; tope por operador; reclamo y retiro (ver ficha) | El primer SPEI real (**B1: ya aplica con dinero real; re-enruto**); un segundo operador; el primer reembolso real de bóveda | arquitecto → backend |
| SEC-SDX-6…13, SDX-D-6/7/8/12/18/19, SDX-I-2/5 | Baja | Skydropx: carga cruda sin redactar ni retención; redacción por lista negra; orden de eventos; `delivered` irreversible | Ver ficha (el primer mes en producción para SDX-6, la primera disputa «no me llegó») | arquitecto → backend / devops |
| SEC-C7-RT/RDEG/OPT/SCRIPT, SEC-HDR-3 | Baja/Info | `refresh()` sin `typ`; candado que reaparece al volver Redis; `@Optional()`; el script no levanta C7; cookie `NEXT_LOCALE` | El siguiente pase de `auth`; un `warn` de `LoginAttemptStore`; usar el script en producción | backend |
| SEC-VLT-DL, VLT-2/3 | Baja | Interbloqueo recuperable del contracargo de bóveda; decisión del dueño; escritura de `User.role` | Un `40P01` en producción; cualquier escritura de `User.role` | backend |
| D-FX-1/2/3, PRE-P1, PRE-P2 | Baja | Borrar `fx_rate_mode` re-arma lo legacy; override sin `@Max`; fetch de Banxico sin `redirect:'error'` | Acceso auditado a la BD; ampliar el rol; el próximo toque de `fx.service.ts` | backend + devops |
| DSC-2, DSC-12 (pentest `c421de13`) | Info | Tope por cliente esquivable con otro correo o `+alias` (§DSC.5(a)); el tiempo del camino inválido está mitigado con `NIL_CODE_ID` | Un abuso medido de un código con tope por cliente | backend |
| SEC-DSC-QA7 | Baja | La clave `email:` del quote de invitado: bloquear 15 min los códigos de un correo ajeno y saber si ya usó un código (veredicto `2f5a59c0` §2) | Código con tope por cliente publicado en redes; queja «no me deja usar mi código»; >3 bloqueos `email:` al día; P-RL-1 confirmado | backend (arquitecto decide) |
| SEC-DSC-I1, SEC-DSC-I2, SEC-MTE-1 | Info | Candado de DSC-1 solo en la integración; M-92 editada en su sitio (staging o local); `fetch` a Meta sin `redirect:'error'` | La integración fuera de CI o `discounts` en `backend-lite`; un aviso de `migrate deploy` en staging; el próximo toque de `measurement-http.ts` | backend; devops; backend |
| BMK-1 | Info | El cotizador anónimo deja leer el mercado en lote | C6 sale mal, o un mercado propio | backend |
| REL7-P3 (R7-C2), SEG-R7-1 (R7-C3) | Baja | «Avísame» de sellados con correo ajeno; huecos menores del aviso de la lista de deseos | Una queja, >5 suscripciones a un correo al día, **o `sk_live_` (ya ocurrió ⇒ doble opt-in: re-enruto a backend)**; encender `wishlist_enabled` | backend; dueño |
| SB-B2/SEC-SB-3, SB-B4/REL-D, SB-B5, P-SEED-1, P-NAME-1/D-10, P-REDIR-1, P-BILL-DoS/D-9, D-2…D-7, D-11/PII-D | Baja/Info | 500 por serialización; deps moderadas; flood de firmas inválidas; `assertSeedTarget`; nombres sin escapar; `safeNext`; rotación de `PII_ENCRYPTION_KEY`; diales sin re-validar (ver SEC-ENV-3); throttler en memoria | Ver ficha. **D-6** (el DAST no escanea producción) ya está en su disparador «antes de dinero real» | backend / devops |
| SEC-OPS-1 | Baja (operativa, recurrente) | Un gate puede medir un binario que no es el sha auditado (le pasó dos veces). Lo vigilan `scripts/assert-serving-head.sh` y `scripts/check-provenance-gate.sh`, que citan «§9»: ese texto está en git (`git show 60250e90:docs/SECURITY_NOTES.md`) | Cualquier rojo de procedencia ⇒ se para y se mide sobre una copia con el sha verificado | devops |
| URL firmada de INE (120 s), residuo pre-M-55, candado C14 solo en integración, `forbidNonWhitelisted:false`, motivo verbatim, `NoopMailAdapter` | Baja/Info | Ver ficha (`da6a237`, `8f8c35c`) | Subir el TTL; un endpoint de dinero nuevo que confíe en el DTO; Noop en un entorno real | backend / devops |

## C. Banderas para el humano (el dueño)
1. **Ya cobras en real con la CSP en modo aviso (CL-1) y sin la ronda de control de C6 (P-RL-1).** Ninguna de las dos es nueva, pero el
   veredicto «listo-real» (`c62621e6`) las ponía **antes** de `sk_live_` y pedía, si cobrabas antes, que lo aceptaras por escrito en `HECHOS.md`.
   Esa fila no existe. O se cierran (frontend/devops), o lo aceptas tú y queda escrito.
2. Varios disparadores de deuda decían «antes de `sk_live_`» y **ya se cumplieron**: A-BSD-1, SEC-SHIP-B1 (SPEI duplicado), el doble
   opt-in de REL7-P3 y D-6. Hay que re-enrutarlos (backend/arquitecto/devops). No los introduce este release.
3. **Medición:** el aviso nuevo está aprobado y publicado apagado. Para encender faltan MKT-F2-3 (tu evento de prueba) **y** SEC-MED-1.
   Además, en la consola de GA4 hay que apagar la «medición mejorada» (al menos la búsqueda en el sitio). Te lo pedirá el orquestador con
   pasos de pantalla, cuando el arquitecto lo deje escrito en §MKT.H.10.
4. **RL-INFO-2:** el plazo de «30 días con dinero real» vence hacia el **2026-11-15**, contado desde el 2026-10-16 que declaraste en
   `HECHOS.md:16` (NO MEDIDO). Después tocan 2FA y re-autenticación para el súper-admin.
5. Siguen vigentes: pentest de un tercero + bug bounty (lo aceptaste para empezar, `HECHOS.md:71`; recomiendo contratarlo dentro de los
   primeros 30 días); revisión legal del aviso de privacidad provisional, de la custodia y de INE/CLABE (BL-42); y antes de encender la
   medición, revisión legal de GA4/Meta y decidir si un analista externo verá b1/b2 (SEC-MKT-4).

---

# Índice de veredictos anteriores

Los más recientes, del más nuevo al más viejo: `60250e90` (2026-10-25, Envío v2 regla A / buylist·solicitud / b5-b6; texto en
`git show 2f5a59c0:docs/SECURITY_NOTES.md`), `803c4298` (2026-10-23, MKT-TL2 R3b/R4), `af37ea5` (2026-10-21, Card Show M-90),
`e77b9612` (2026-10-19, Panel de Marketing / Medición Fase 2 apagada), `e454262` (2026-10-16, P&L), `c62621e6` (2026-10-05, «listo-real»).
Texto íntegro de los 81 anteriores: `git show 60250e90:docs/SECURITY_NOTES.md`; su tabla índice por fecha y sha: `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

_Changelog:_ 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender).
