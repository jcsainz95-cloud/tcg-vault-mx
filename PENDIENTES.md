# PENDIENTES — TCG HUNT

> **Cómo se usa (regla O-5):** un pendiente **afirma su fecha de medición o no afirma nada**. Antes de enrutar
> trabajo a partir de uno, **se re-mide** (el comando o `fichero:línea` de la columna «Comprobación» es por dónde
> empezar). Lo cerrado se mueve a `HISTORIAL.md`; los hechos del negocio viven en `HECHOS.md`.
> Última limpieza: **2026-09-11** (orquestador, tras publicar `c13f417`). Cuerpos de los ítems: **verbatim**, sin reescribir.

## Índice de abiertos (re-medido 2026-09-11 ~03:20 UTC por la sesión 2 sobre `17ce9a9`, tres agentes de solo lectura; «—» = el cuerpo no lo dice)

> Sesión 2, 2026-09-11: se re-midió **cada fila** contra el árbol (O-5). Punteros a línea corregidos donde envejecieron.
> Cerrado en código en esta re-medición: **P-46** (fix `47c97c1`, dentro de `c13f417`; falta solo la verificación en producción, ver fila).
> Frentes abiertos por esta sesión el 2026-09-11: **«Andamiaje de CI»** (devops) y **Stream A** (ux-ui + arquitecto → backend + frontend), en `claude/tcg-hunt-orchestration-2`.

| ID | Qué | Dueño | Medido el | Comprobación (por dónde empezar) |
|---|---|---|---|---|
| **Stream A** | La cuenta del cliente (P-57 + P-73 + P-75 + P-55; P-66 después, mismo módulo frontend) — **EN CURSO sesión 2** | ux-ui → frontend · arquitecto → backend | 2026-09-11 | ver sección «SIGUIENTE RELEASE»; todo abierto, cero backend salvo P-75 (endpoint) y P-73-B (esquema) |
| **Stream B** | Lo que se rompe con el dinero (P-58, P-59, P-68, disputas) | arquitecto → backend | 2026-09-11 | ídem; P-58/P-59 re-medidos abajo |
| **Stream C** | El disco (P-53) | backend | 2026-09-11 | ídem |
| P-IVA-INCL | Precio con IVA incluido, sin línea aparte. **DEPLOY 2 SÍ está especificado** en contrato (§M10-IVA.6, `docs/API_CONTRACT.md:17107-17121`); falta implementarlo y la decisión de «cómo se muestra» | product-owner → arquitecto → frontend+backend | 2026-09-11 | `AmountBreakdown.tsx:82`, `orders.service.ts:592` (`IVA_EXCLUSIVE`); cero escritores de `IVA_INCLUSIVE` en producción |
| P-GL-FP | gitleaks: causa **abierta** (`security/gitleaks.toml:75-81` sin `paths` de los canarios); síntoma **latente** (verde en `17ce9a9` porque el rango del push ya no incluye `5f0928f`/`88c48c7`) — **EN CURSO devops** | devops | 2026-09-11 | run rojo `34554095125`; secretos falsos en `check-secret-defaults-canary.sh:355,375,498` y `check-stripe-webhook-failclosed-canary.sh:200,274,298` |
| P-CI | «Andamiaje de CI»: **8 de 11 abiertos** (#1, #2, #6, #11 cerrados). `check-candidate-checks.sh` **reproducido roto**: `node: Argument list too long` con 47 check-runs y **emite el diagnóstico falso** «sin check-runs» — **EN CURSO devops** | devops | 2026-09-11 | `docs/DEVOPS_NOTES.md:10634-10680` (§55.5); `scripts/check-candidate-checks.sh:47-54`; ramas sin protección (`/rulesets` = `[]`) |
| P-BL | Stream buylist v1.59/v1.60: **1 de 7 cerrado** (`legalName`, `admin.service.ts:47,55-68`). §M5-D abierto (las 4 estructuras siguen); §M5-A **desalineado**: backend emite `scope: per_request`/`per_request_offer` (`buylist.service.ts:1585,3587`) y el frontend ya los retiró (`error-audience.ts:42`); §M5-I, boundary, BL-42, D50 abiertos | backend (arquitecto para D50) | 2026-09-11 | `grep -n BUYLIST_CAP_PER_REQUEST_CENTS backend/src/modules/settings/settings.constants.ts` → `:77,289,949,1058`; `HISTORIAL.md:110-166` |
| P-53 | Disco: `PriceReference` una fila/producto/día; `evidenceDate` **ni se escribe ni se lee** (9/9 hits son el DTO de un proveedor) | backend | 2026-09-11 | `backend/src/modules/catalog/card-product-resolver.service.ts:201,218-233`; `schema.prisma:967` |
| P-55 | Carrito de venta se pierde al iniciar sesión — **DIAGNOSTICADO sin levantar la app**: vive en memoria (`useSellCart.ts:106`, sin storage) y el login manda a `/` sin `next` — **EN CURSO Stream A** | frontend | 2026-09-11 | `(storefront)/buylist/useSellCart.ts:106`; contraste `lib/cart.ts:5,31`; `AuthForm.tsx:48-50` |
| P-56 | Wishlist (money-critical) — cero rastro en el árbol | arquitecto → backend+frontend | 2026-09-11 | `grep -rni wishlist backend/src frontend/src docs` → 0; falta alcance (product-owner) |
| P-57 | La cuenta del cliente: (a) sin ruta de perfil, backend completo; (b) `getClaimableOrders` (`api.ts:4855`) sin ningún llamador; (c) menú con 5 entradas (no 7), ventas sin entrada — **EN CURSO Stream A** | ux-ui → frontend · backend | 2026-09-11 | `users.controller.ts:24-83`; `orders.controller.ts:61`; `StorefrontHeader.tsx:88-99` |
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
| P-73 | Google inventa el nombre (`auth.service.ts:339`; **cura barata**: `PATCH /users/me` ya acepta `name`, `users.dto.ts:12`); retiros de bóveda sin destinatario (`Address` sin nombre) — **EN CURSO Stream A** (B toca `shipments`: serializado con Stream B) | ux-ui → frontend · arquitecto → backend | 2026-09-11 | `shipments.service.ts:183-191,405`; `schema.prisma:482-498`; `guest-checkout.dto.ts:44` |
| P-75 | Cambiar la propia contraseña: ni endpoint (`auth.controller.ts`, 9 rutas) ni pantalla; `mustChangePassword` sin guard; el aviso solo dice «Continuar» — **EN CURSO Stream A**; **decisión del dueño pendiente**: ¿bloquear o solo avisar? | arquitecto (endpoint) → backend + frontend | 2026-09-11 | `AuthForm.tsx:109-116,21-23`; `auth.service.ts:249`; `admin.service.ts:746` |
| P-77 | DAST: cron/dispatch/call/push a `devops/dast-**`; checkout sin `ref:`; **nadie lo invoca**; 6 runs, todos push a `devops/dast-p77`; ahora el cron sí vive en `main` (=`17ce9a9`) pero mira `main`, no lo publicado — **EN CURSO devops** | devops | 2026-09-11 | `security-dast.yml:63,65,80,97,141,190,303`; `deploy.yml:424-438` (`dast-staging` inerte) |
| P-46 | Sincronizar sellado «0 presentaciones»: **CERRADO EN CÓDIGO** (`47c97c1`, dentro de `c13f417`: match tolerante al prefijo, `sealed-product.service.ts:777-798`). **Falta verificar en producción** (sync de Pitch Black / Chaos Rising) y el follow-up de frontend (guiar al linker cuando da 0). Singles siguen sin el arreglo (`card-product-resolver.service.ts:225-238`) | HUMANO/orquestador (verificar) · frontend (follow-up) | 2026-09-11 | correr la sync en producción y contar presentaciones |
| Razón social | Footer imprime «TCG HUNT · tcghunt.mx · © 2026» sin placeholder (`layout.tsx:58-65`, `footer.ts:13-18`); falta el dato del dueño | **HUMANO** | 2026-09-11 | `es.json:11` / `en.json:11` |
| Seguridad C1–C5 | **Todas abiertas.** C1: script solo `${VAR:-}` (`check-secret-defaults.sh:208,283`), `FORMA_SECRETO` sin PASS/PIN/PEPPER; C2 ≡ P-77; C3 no medible desde el árbol; C4: `gitleaks.toml:65` sin estrechar, sin canario; C5: el instrumento está roto (ver P-CI) — C1/C2/C4/C5 **EN CURSO devops** | devops / backend / humano (C3) | 2026-09-11 | `docs/SECURITY_NOTES.md:237-249` |
| Node 20 EOL | **10 sitios** en Node 20 (8 `node-version` en workflows + 2 Dockerfiles); sin `engines` ni `.nvmrc`; `gitleaks-action@v2`; runners dejan Node 20 el **2026-09-16** — **EN CURSO devops** | devops | 2026-09-11 | `ci.yml:140,182,214`, `e2e.yml:274,426`, `e2e-real.yml:286`, `security-sast.yml:137`, `security-scheduled.yml:73`, `Dockerfile.backend:22`, `Dockerfile.frontend:22` |
---

# SIGUIENTE RELEASE — «LA CUENTA DEL CLIENTE» (aprobado por el humano, 2026-09-10)

### Añadidos 2026-09-11 02:35 UTC (durante la publicación de `c9ba265`)

- **P-IVA-INCL · Precio con IVA incluido, sin línea aparte (`IVA_INCLUSIVE`).** Decisión del dueño 2026-09-11:
  «ponlo como pendiente». Hoy el cliente ve «MXN sin IVA» en catálogo y una línea «IVA 16%» en checkout
  (`frontend/src/components/ui/AmountBreakdown.tsx:82`, `frontend/messages/es.json:315`); M-50 ya deja cada
  pedido marcado con su convención (`orders.service.ts:586`, `guest-checkout.service.ts:163`). Falta: el
  DEPLOY 2 de M-50 (contrato §M10-IVA) — decisión de product-owner/arquitecto sobre cómo se muestra, y
  frontend+backend. **Dinero ⇒ triple veredicto.** No medido: qué dice el contrato hoy sobre DEPLOY 2.
- **P-GL-FP · gitleaks pinta rojo `main`/`production` por los scripts-canario (falso positivo).** Medido
  2026-09-11 02:18 UTC: run `34554095125` (SAST sobre `main`, push `c9ba265`), 9 hallazgos, **los 9 en
  `scripts/check-secret-defaults-canary.sh` (8) y `scripts/check-stripe-webhook-failclosed-canary.sh` (1)** —
  secretos falsos por construcción. En la rama sale verde porque escanea 1 commit; en `main` escaneó el rango
  de 20 (`--log-opts ... 88c48c7^..c9ba265`). Dueño: **devops**. Arreglo: allowlist **por ruta** de los
  canarios en `security/gitleaks.toml` `[allowlist] paths` (NO ensanchar regex — ver S-GL-1 de seguridad, que
  pide lo contrario: estrechar `sk_test_`). Verificar con gitleaks v8.24.3 (la versión de la action) sobre el
  mismo rango. Entra en el stream «andamiaje de CI».

> Arranca **en cuanto se publique el release actual**. Tres work streams **disjuntos** por el mapa de
> módulos de `CLAUDE.md`, así que corren **en paralelo** sin pisarse. Una sesión = un stream = una rama.

## 🥇 Stream A — «La cuenta del cliente» (el principal)
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

#### P-57 · 👤 LA CUENTA DEL CLIENTE — el hueco más grande, y son tres cosas del mismo frente
Encontrado por el humano probando en producción. Las tres se sirven juntas o ninguna funciona bien.

- **(a) No existe pantalla de perfil.** Verificado: no hay ninguna ruta de perfil ni de cuenta. El
  cliente **no puede ver ni cambiar** su correo, sus direcciones, sus datos de facturación ni el
  estado de su verificación. **El servidor YA lo expone todo** (`GET`/`PATCH /users/me`, direcciones,
  facturación, KYC): falta solo la pantalla. ⚠️ Consecuencia medida: `PHONE_REQUIRED` bloquea vender
  y el contrato manda «pedir el dato y reintentar» — **sin perfil no había dónde**, así que una
  cuenta de Google quedaba bloqueada sin salida (paliado con captura inline en el diálogo de venta).
- **(b) Los pedidos de invitado no se pueden reclamar desde la cuenta.** El mecanismo existe entero y
  está bien hecho (prueba de titularidad = correo verificado; el enlace de seguimiento sirve para
  LEER, nunca para APROPIARSE; `GET /orders/claimable` no es un oráculo). Pero **solo se ofrece en la
  confirmación de compra y en el seguimiento público**: si el cliente cierra esa pestaña, **no hay
  pantalla que se lo vuelva a ofrecer**. `GET /orders/claimable` **no lo consume nadie**.
  ⇒ Cada compra de invitado no reclamada en el momento **se queda fuera de la bóveda para siempre**,
  y la bóveda es la propuesta de valor. **Dónde ponerlo (decidido con el humano):** aviso en **la
  bóveda** (es donde se nota la ausencia) **y** en pedidos (los enviados a domicilio nunca pasan por
  la bóveda). Que desaparezca al reclamar y que no aparezca vacío.
- **(c) La navegación está partida en siete.** Hoy el menú tiene catálogo, compra, sellado, vender,
  órdenes, envíos y bóveda — y **las solicitudes de venta no están**: solo se llega por dentro de
  Vender o por el correo. Propuesta del humano, que suscribo: **consolidar** compras + ventas +
  estado de solicitudes en un solo sitio, y **mover los retiros a la bóveda** (un retiro es una
  acción sobre la bóveda). ⚠️ Matiz de nombre: «orden» se lee como *compra*; si ahí van las ventas,
  hacen falta **pestañas explícitas** o un nombre neutro, o el vendedor no las busca ahí.
- ⭐ **v2026-09-10 — `P-73` le añade munición al apartado (a), medida:** el nombre de una cuenta de Google
  no solo falta, **el sistema lo FABRICA** con el trozo del correo antes de la arroba
  (`auth.service.ts:339`), **nadie puede corregirlo** —ni el cliente ni el admin— y se ve en **16 sitios**,
  entre ellos **10 correos al cliente** y **los buscadores del back-office**. ⇒ La pantalla de perfil deja
  de ser «comodidad para el cliente» y pasa a ser **la única cura de un dato inventado que hoy es
  permanente**. Sube de prioridad dentro de este pendiente.
- ⭐ **v2026-09-10 — `P-75` ENTRA AQUÍ por decisión del humano** (*«ligalo al perfil de usuario que
  necesitamos ahi mismo lo atacamos»*): **cambiar la propia contraseña** es una sección de esta pantalla.
  ⚠️ **Y rompe el «cero backend» de este pendiente:** el endpoint **no existe** — `auth.controller.ts` solo
  tiene `forgot-password` y `reset-password`, que consume un token **del correo**. Hay que crear «cambiar la
  mía con la actual», y eso es **contrato nuevo ⇒ pasa por el arquitecto** (regla 9).
  ⚠️ **Y amplía el alcance a un rol que este pendiente no contemplaba:** el **operador de bóveda** aterriza
  en `/admin` y **nunca pisa el storefront** (`AuthForm.tsx:22`), y el panel **no tiene zona de «mi cuenta»**.
  Una pantalla de perfil solo en el storefront **no lo alcanza**. Decidir antes de empezar: una compartida
  para los dos, o también en el panel.
- **Rol dueño:** ux-ui (rediseño de navegación) → frontend. **Cero backend PARA (a), (b) y (c)** — los
  endpoints existen. **`P-75` sí trae backend y contrato.**

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

#### P-73 · 👤 Entrar con Google: un nombre inventado que nadie puede corregir, y envíos SIN destinatario
- **Lo que preguntó (2026-09-10):** *«cuando ingresan con google puede que no venga el telefono ni el nombre
  completo que hacemos»*. Era pregunta **preventiva**; el diagnóstico encontró **dos problemas vivos hoy**.

##### 🔴 A · El sistema FABRICA un nombre, y es irreparable
- `backend/src/modules/auth/auth.service.ts:339` — `name: identity.name ?? email.split('@')[0]`. Si Google no
  manda el nombre, se inventa uno con el trozo del correo antes de la arroba. **Verificado literal.**
- ⚠️ **Es la regla dura del proyecto rota de frente:** «nunca se inventa un dato» — el equivalente de mostrar
  `$0` en vez de `—`. Y peor que un `$0`, porque **parece real**: la columna queda indistinguible de un nombre
  tecleado por el usuario, sin marca de que sea derivado.
- 🔴 **No se puede corregir por ninguna vía. Medido:** no existe pantalla de perfil (`frontend/src/app/[locale]/`
  solo tiene `(admin)`, `(auth)`, `(storefront)` y `pedido`); el único llamador de `updateMe` es
  `BuylistKycForm.tsx:234` y **manda solo `phone`**; y el admin tampoco puede — `admin.service.ts` expone
  `createUser`, `updateUserKyc`, `updateUserStatus` y reset de contraseña, **ninguna toca `User.name`**.
- **Dónde se ve ese nombre inventado — 16 sitios medidos:** al menos **10 correos al cliente**
  (`mail.templates.ts:70,72,97,99`; `buylist.service.ts:4358,4383,5392,6681`; `buylist-sweep.service.ts:129,177,250,443`)
  y **6 superficies de back-office** (`buylist.service.ts:2455,5186`; `admin-vaults.service.ts:55`;
  `master-set.service.ts:587`; `admin.service.ts:426`; `users.service.ts:74,92`).
- ⭐ **Y es criterio de BÚSQUEDA del operador** (`API_CONTRACT.md:12025` y `:13817`): buscar «Juan Pérez» **no
  encuentra** a quien el sistema bautizó «jcsainz95».
- ✅ **La facturación NO se ve afectada:** el CFDI sale de `BillingProfile` (razón social y RFC propios),
  `User.name` no entra.

##### 🔴 B · NINGÚN envío de usuario con sesión lleva destinatario — y no es cosa de Google
- `shipments.service.ts:183-192` escribe el `addressSnapshot` con **ocho campos** y **ninguno es un nombre**.
  No puede haberlo: `Address` (`schema.prisma:482-498`) **no tiene columna de nombre**.
- ⇒ `shipments.service.ts:405`, `recipientName: snapshot.recipientName ?? undefined`, evalúa a **`undefined`
  en TODO retiro de bóveda**.
- **El checkout de invitado SÍ lo pide** y es obligatorio (`guest-checkout.dto.ts:44`). ⇒ **la asimetría es
  literal**, y el contrato la razona como si fuera intencional (`API_CONTRACT.md:6803`: *«el invitado no tiene
  `User.name`»*) — pero **la implicación de que para el usuario con sesión `User.name` cumple ese papel NO
  ESTÁ IMPLEMENTADA en ninguna línea.** Es una premisa del contrato que el código no honra.
- ✅ **Desmentido lo que yo temía:** el paquete **no** sale a nombre de «jcsainz95». `User.name` no se copia a
  ningún snapshot de envío (verificado por los tres constructores y por grep). Sale **sin nombre**.
- **No hay integración con paquetería:** `carrier` y `trackingNumber` los teclea un operador
  (`admin-shipments.controller.ts:74-75`). ⚠️ **No confirmado:** de dónde saca el operador el destinatario —
  la pantalla M4 **no pinta la dirección ni ningún nombre** (`M4View.tsx`, grep sin resultados; muestra el
  `userId` crudo en `:201`), aunque el `addressSnapshot` sí viaja en el payload.

##### El teléfono: ya estaba gestionado, y no es hueco de Google
- `User.phone` es opcional y **el registro local tampoco lo exige** (`auth.dto.ts:17-18`).
- **Buylist es el flujo que lo necesita sin domicilio, y ya tiene puerta:** `buylist.service.ts:1366-1378`
  lanza `PHONE_REQUIRED`, con el caso nombrado en el comentario (`:1321`): *«las cuentas de Google y las
  viejas la tienen vacía ⇒ vendedores incontactables»*. Remedio en línea en `BuylistKycForm.tsx:302`.
- ⚠️ **Son dos teléfonos distintos** y el código lo dice (`buylist.service.ts:4447`): el de la **etiqueta** es
  `Address.phone`; `User.phone` es *«el nuestro, para llamarle»*.
- **No confirmado:** disputas y verificación.

##### ✅ Lo que está bien y no hay que tocar
El **enlace** de una cuenta local con Google **no pisa el nombre existente** (`auth.service.ts:315-322`
escribe solo `googleId`, `emailVerified` y `avatarUrl`, y este último respeta el que ya había).

- ⚠️ **CRUCE OBLIGATORIO CON P-57 — el humano me lo recordó y yo debí cruzarlo antes de abrir esto.**
  `P-57(a)` ya tenía anotado que **no existe pantalla de perfil**, con el caso de Google nombrado y todo
  («una cuenta de Google quedaba bloqueada sin salida, paliado con captura inline»). Y `CLAUDE.md:49` ya
  lista **«perfil»** como superficie del work stream *Cuentas y acceso*. ⇒ **No es un frente nuevo.**
  **El apartado A de aquí NO se trabaja por separado: es munición para `P-57(a)`.**
- **Lo que este pendiente SÍ añade y `P-57` no tenía** — por eso no lo fusiono del todo:
  1. El nombre no está *ausente*: **está INVENTADO**, y eso es peor porque parece real.
  2. **Tampoco el admin puede corregirlo** — `P-57(a)` decía «el cliente no puede»; medido, **nadie** puede.
  3. **Los 16 sitios** donde se ve, incluidos los **buscadores del operador**.
  4. ⭐ **Todo el apartado B**, que no está en `P-57` y **no es un problema de la cuenta del cliente**:
     ningún envío de usuario con sesión lleva destinatario. Eso vive en el domicilio y en el envío, no en
     el perfil, así que **sobrevive aunque `P-57` se cierre entero**.
- **Rol dueño:** **A** → se pliega a `P-57` (ux-ui → frontend; **cero backend**, los endpoints existen).
  **B** → product-owner aterriza el qué (¿el destinatario vive en `Address` o se pide por envío?) →
  arquitecto (es cambio de contrato y de esquema) → backend + frontend.
- **Prioridad:** **B afecta a todos los clientes con cuenta, no solo a los de Google.** Es el más grande de los
  dos y el que el caso de Google solo hizo visible.


#### P-75 · 🔑 «Debes cambiarla» — y no hay dónde. El ciclo del reset no cierra — reportado por el humano
- **Lo que dijo (2026-09-10):** *«el tema es que dentro de la plataforma no hay lugar donde el operador
  cambie la contraseña»*. **Tiene razón, y verifiqué que es peor que un hueco.**
- 🔴 **La plataforma le PIDE al usuario algo que no le deja hacer.** Medido de punta a punta:
  1. El admin resetea → temporal de alta entropía + `mustChangePassword: true` (`admin.service.ts:733`).
  2. El usuario entra y ve un aviso, textual (`messages/es.json:929`): *«Iniciaste sesión con una contraseña
     temporal. **Debes cambiarla** para proteger tu cuenta.»*
  3. El único botón del aviso dice **«Continuar»** (`AuthForm.tsx:113`, `redirectByRole`) — **lo lleva a su
     destino y ya. No hay ningún enlace a cambiarla.**
  4. **No existe la pantalla.** `frontend/src/app/[locale]/(auth)/` contiene **solo** `login`, `register`,
     `forgot-password`, `reset-password` y `verify-email`. Ninguna es «cambiar mi contraseña estando dentro».
  5. **Y tampoco existe el endpoint.** `auth.controller.ts` solo expone `POST /auth/forgot-password` (`:90`)
     y `POST /auth/reset-password` (`:99`), **que consume un token que llega por CORREO**. No hay ninguna
     ruta de «cambiar la mía con la actual».
- ⚠️ **`mustChangePassword` NO BLOQUEA NADA.** Grep sobre `backend/src/modules/auth/` y `backend/src/common/`:
  **ningún guard lo lee**. Solo se escribe (`admin.service.ts`) y se limpia al usar el enlace del correo
  (`auth.service.ts:249`). ⇒ El operador **no queda atrapado** — puede seguir usando la temporal
  indefinidamente. **Es una advertencia sin consecuencia.**
- **El único camino real hoy:** cerrar sesión → «olvidé mi contraseña» → **esperar el correo** → enlace.
  Absurdo para alguien que **ya está dentro**, y peor para un **operador** cuyo correo puede ser compartido
  o de empresa — y si no tiene acceso a ese buzón, **no hay camino ninguno**.
- ⚠️ **Corrección a lo que le dije al humano.** Le dije que el reset era «mejor de lo que pediste». **La
  parte del reset sí es buena** —alta entropía, el súper-admin nunca conoce la definitiva, revoca sesiones—
  **pero el ciclo no cierra**, y eso yo no lo verifiqué antes de afirmarlo. Él lo cazó.
- 🔗 **Cruce con `P-57(a)`:** «cambiar mi contraseña» es una sección natural de **la pantalla de perfil que
  no existe**. Pero ⚠️ **no basta con plegarlo ahí**: `P-57` es del **cliente**, y esto lo necesita el
  **operador**, que ni siquiera navega por el storefront. Hay que decidir si la pantalla es una sola para
  todos o si el panel de admin necesita la suya.
- ✅ **DECISIÓN DEL HUMANO (2026-09-10): se ataca DENTRO de `P-57`.** Sus palabras: *«ligalo al perfil de
  usuario que necesitamos ahi mismo lo atacamos»*. ⇒ **No es un frente aparte**: «cambiar mi contraseña» es
  una sección de la pantalla de perfil, y las dos se construyen en el mismo pase.
- 🔴 **PERO hay un hecho medido que el diseño tiene que resolver ANTES de empezar, o se descubre tarde:**
  - El operador de bóveda **aterriza en `/admin` y nunca pisa el storefront** — `AuthForm.tsx:22`:
    `role === 'super_admin' || role === 'vault_operator' ? '/admin' : '/'`.
  - Y **el panel de admin NO TIENE ninguna zona de «mi cuenta»**: `frontend/src/app/[locale]/(admin)/admin/`
    contiene `m1`…`m10`, `vaults` y el tablero. **Nada más.**
  - ⇒ **Una pantalla de perfil colgada del storefront NO la alcanza el operador.** Hay que decidir: **una
    sola pantalla compartida** a la que lleguen los dos, **o** la sección de cuenta también en el panel.
    **Es decisión de arquitectura + ux-ui, no de implementación.**
- **Rol dueño:** **arquitecto** (el endpoint no existe: es contrato nuevo — «cambiar la propia contraseña
  con la actual», con su política de revocación de sesiones — **y dónde vive la pantalla para los dos
  roles**) → **backend** → **frontend** + ux-ui (que el aviso del login **enlace ahí** en vez de decir
  «Continuar»).
- **Y una decisión para el humano:** ¿`mustChangePassword` debe **seguir sin bloquear** —una advertencia—
  o debe **forzar de verdad** el cambio antes de dejar operar? Lo segundo es lo que el texto promete hoy.

#### P-77 · 🔴 La mitad del gate de seguridad nunca ha corrido: **no hay staging** — ABIERTO (medido por el orquestador, 2026-09-10)

**Dato del humano (2026-09-10):** *«no tengo staging, solo producción»*.

**Lo que eso significa, medido en los workflows (no supuesto):**

| Verificación | Cuándo corre | Estado real |
|---|---|---|
| **CI** (unitarios + contrato) | cada push y PR (`ci.yml`) | ✅ corre de verdad |
| **SAST** (revisa el código) | cada push y PR (`security-sast.yml`) | ✅ corre de verdad |
| **E2E con mocks** | cada push y PR (`e2e.yml`) | ✅ corre de verdad |
| **E2E real** | nocturno 08:00 UTC + manual (`e2e-real.yml`) | ⚠️ levanta stack propio |
| **DAST** (ataca la app corriendo) | semanal, lunes 06:00 UTC (`security-scheduled.yml`) | 🔴 **apunta a staging ⇒ sin blanco** |
| **Pipeline de deploy entero** (`deploy.yml`) | 🔴 **solo `workflow_dispatch`, y `secrets-gate` lo salta si faltan secrets** | 🔴 **nunca corre** |

`deploy.yml:36-38` lo dice literal: *«CD por GitHub Actions DESACTIVADO por defecto… los deploys reales van por
integraciones NATIVAS Vercel/Railway (push-to-deploy)»*. ⇒ **Todo el tramo de staging es decorativo**: el gate de
procedencia (`staging-serves-head`), el DAST (`dast-staging`) y el flamante gate de paridad de proveedor
(`staging-provider-parity`, `D-PP-2`) **cuelgan de un pipeline apagado que apunta a un entorno inexistente**.

**Consecuencia contra el DoD de `CLAUDE.md`:** el DoD exige que *«el gate de seguridad (SAST + DAST staging) y el
harness E2E estén cableados en CI»*. **La mitad SAST se cumple; la mitad DAST nunca ha corrido contra nada.**
Publicar hoy va `main` → `production` → vivo, **sin entorno intermedio**.

⚠️ **Esto NO invalida la fase de seguridad ya aprobada.** `CLAUDE.md` autoriza como blanco **«staging (o local)»**, y
el pentester trabajó sobre el código y sobre local. Lo que falta es el **DAST automático y recurrente**, no la
revisión humana.

**Tres salidas, y la barata es la buena:**
- **(A) Crear un staging de verdad** en Railway + Vercel. Es lo que el pipeline asume. Cuesta dinero y
  mantenimiento, y duplica la base de datos.
- **(B) ⭐ DAST contra un stack efímero levantado en el propio CI.** Ya existen las piezas: `scripts/stack-native.sh`
  y `e2e-real.yml` levantan la plataforma completa. Apuntar el DAST ahí es gratis, no necesita credenciales de
  ningún entorno vivo, y **cumple el DoD por la vía «o local»** que `CLAUDE.md` ya autoriza. También vuelve
  ejecutable el gate de paridad de `D-PP-2` sin los secrets que el dueño no puede dar.
- **(C) Aceptar y registrar** que el DAST no corre, con la deuda escrita en `SECURITY_NOTES.md`.

**Recomendación del orquestador: (B).** Enrutar a **devops**. No urge —no hay incidente— pero mientras no se haga,
`D-PP-2` y el gate de procedencia son candados que **no se pueden poner rojos**, y un candado así no es un candado.

**Consecuencia inmediata que SÍ se cierra hoy:** los secrets `STAGING_ADMIN_EMAIL` / `STAGING_ADMIN_PASSWORD` que
devops pidió al humano **quedan sin objeto**. No se crean. Si se creara un usuario admin apuntando a producción para
satisfacerlos, sería exactamente lo que la guarda anti-producción del script existe para impedir.


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

#### P-55 · 🛒 El carrito de venta NO sobrevive al inicio de sesión — reportado por el humano
- **Síntoma:** el cliente arma su carrito en el cotizador **sin haber iniciado sesión**; al entrar a su
  cuenta para mandar la solicitud, **el carrito se pierde** y tiene que rehacerlo.
- **Por qué importa, y no es cosmético:** el cotizador es la puerta de entrada del vendedor. Rehacer el
  carrito es fricción **justo en el paso donde ya decidió vendernos**, y el abandono ahí se lleva la
  venta entera. Es el mismo patrón que ya se curó del lado de la compra con el checkout de invitado.
- **Estado:** **pendiente, sin diagnosticar.** No se ha medido si el carrito vive en memoria, en
  `localStorage`, o si se pierde por el remonte del árbol tras autenticar.
- **Rol dueño:** frontend (y arquitecto si resulta que hay que persistirlo server-side).
- **Aplazado por decisión del humano**: lo reportó y pidió explícitamente dejarlo anotado.

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

