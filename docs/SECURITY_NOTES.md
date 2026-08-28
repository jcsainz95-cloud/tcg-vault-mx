# SECURITY_NOTES.md — Seguridad (blue team) · consolidación y veredicto

<!-- ════════════════════════════════════════════════════════════════════════════════════════
     GATE DE RELEASE — FUSIÓN pricing-v2 × P-47 (2026-08-28) — se antepone. Todo lo anterior
     (v2.1.9, v2.1.7/v2.1.8, P-48, histórico) se conserva íntegro abajo.
     ════════════════════════════════════════════════════════════════════════════════════════ -->

# GATE DE RELEASE · FUSIÓN curva v2 × tcgcsv_singles (P-47) · 2026-08-28 · seguridad (blue team)

> **Árbol auditado:** `integration/pricing-v2-merge`, HEAD **`1268e7a`** (merge --no-ff), **working
> tree limpio**. **Insumo:** `docs/PENTEST_NOTES.md` (pase v2.1.7/v2.1.8) + re-verificación v2.1.9 +
> revisión del delta de fusión. **Modo:** estático dirigido sobre el árbol fusionado + `npm audit`.
> Los commits que el handoff marcó «sin gate» (`d8c4625`, `1885b4a`, `a05a819`) son **ancestros del
> gate v2 `7aa2081`** y SÍ fueron atacados por el pentester; re-verificados en el árbol fusionado. El
> delta genuinamente nuevo es **la fusión** (integración P-47 provider × curva v2).

## 0. VEREDICTO: ✅ APROBADO-CON-CONDICIONES · gate CERRADO con condiciones

| | |
|---|---|
| **Críticos / Altos abiertos** | **0 / 0** ⇒ el criterio de rechazo del DoD no se dispara. |
| **Medias abiertas** | **1** — **S49-M2** (aceptada con disparador duro). |
| **Bajas / Info** | S49-B3 · candado `no-raw-entity` (gap estructural) · R2 · R4 · deps (2 moderate). |
| **Cerradas y verificadas en la fusión** | R1 · S49-M1 · S49-M1-R · R3/D1 (techo de curva) · D2 (§N.7 en el emisor). |
| **¿La fusión P-47×curva introdujo algo nuevo?** | **NO.** El eje de precios sigue money-safe. |

**Mínimo para APROBADO limpio:** cerrar **S49-M2** + extender el candado `no-raw-entity-response.spec.ts`.
**Disparador DURO de S49-M2:** se cierra **ANTES de que la plataforma almacene el primer RFC/CLABE/INE de
un usuario real** (antes de abrir buylist/facturación a clientes reales). Hoy la BD no tiene ni un dato
fiscal/bancario real ⇒ la condición se cumple para desplegar staging/prod sin PII real.

## 1. Hallazgo abierto que condiciona el gate
### S49-M2 · [Media · ABIERTO] · `GET /admin/orders` publica la fila `Order` cruda (con `billingSnapshot`: `rfcEnc` cifrado + metadato fiscal) al `vault_operator`
- Confirmado: `admin-orders.controller.ts:@Get()` hace `findMany` **sin `select`** y devuelve la fila entera.
  La ruta hermana `:id` SÍ proyecta (`billingSnapshot:null`) y `getUser` oculta `billingProfile` (SEC-A4) → es bug, no diseño.
- El RFC viaja **cifrado** (AES-256-GCM); lo que sale en claro es metadato fiscal; sin vector anónimo/customer, sin dinero ⇒ **Media**.
- **Dueño:** backend (proyectar el listado como el detalle) + arquitecto (declarar si `billingSnapshot` es visible a `vault_operator`).

## 2. Fusión P-47 × curva — eje de precios money-safe (verificado)
- Dial `PRICE_PROVIDER` `super_admin`-only; validador restringe a 3 valores; `PRICING_CURVE` fuera de `SETTING_DTO_MAP` (única puerta = `PUT /admin/pricing/curve`, super_admin).
- `reconcilePublishedPrices` llavea por `cardId|productType|gradeKey|finish`; sin mercado → `pendingReason`/cola (nunca `$0`); respeta override manual por pieza; mismo seam `decideSalePrice` que publicación/checkout. `ingestSinglesForSet` upsertea referencia per-acabado respetando `isManualOverride`.
- `source`/`isManualOverride` solo server-side; omitidos en `PriceInfo` público; solo en `vault_operator+`.
- Techo de cordura curva (R3/D1) CERRADO: `MAX_CURVE_CONSTANT_CENTS = 200_000` acota `floorCents`/`binCents`.

## 3. Deuda de seguridad aceptada (no bloqueante)
- **S49-B3** (Baja) — `buylist.service.ts` `itemDTO` devuelve `card` cruda (catálogo público, sin secretos). Dueño: backend.
- **Candado `no-raw-entity`** (Baja/Info) — el barrido no ve spread `{...row}` ni `include:` crudo. Dueño: backend.
- **R2** (Baja) — `POST /buylist/quote` `@Public` emite `priceBasis`+precio (ratificado en contrato, throttled). Dueño: backend+arquitecto.
- **R4** (Baja/Info) — filas crudas sin PII en back-office/recurso propio. Dueño: backend.
- **Deps** (Media) — backend prod `npm audit`: 2 moderate (`@nestjs/core`, exige bump a NestJS 11), 0 high/critical. Dueño: devops.

## 4. Banderas para el humano
1. Antes de operar con dinero real: pentest de tercero + bug bounty.
2. El disparador de S49-M2 es de negocio: el día que entre el primer RFC/CLABE/INE real, esa ruta pasa de deuda a incidente de privacidad.
3. Custodia/PII (INE/CLABE/RFC): pendiente validación legal de retención y contrato de custodia (no es decisión de ingeniería).

— SEGURIDAD (blue team / AppSec), 2026-08-28 (gate de release fusión pricing-v2 × P-47) · persistido por el orquestador

---


<!-- ════════════════════════════════════════════════════════════════════════════════════════
     RE-VERIFICACIÓN DE CIERRE v2.1.9 (2026-08-24) — se antepone. Todo lo anterior
     (pase v2.1.7/v2.1.8 y el histórico) se conserva íntegro abajo.
     ════════════════════════════════════════════════════════════════════════════════════════ -->

# RE-VERIFICACIÓN DE CIERRE · v2.1.9 · 2026-08-24 · seguridad (blue team)

> **Qué es esto:** NO es un pase nuevo. Es la comprobación **acotada** de que lo que dictaminé en el
> gate de release (`7aa2081`, árbol hasta `455fb8a`) quedó efectivamente cerrado en el árbol final
> **`005a610`** (5 commits de código: `be4cc71`, `ed160c9`, `82b03df`, `64c6ad7`, `005a610`).
> **Modo:** esta vez **con mutación autorizada** — el stack estaba libre, así que disparé los PoC que
> escriben (los que la vez pasada quedaron marcados *[no verificado en vivo — colisión con QA]*).
> **Restauración:** curva de precios restaurada byte a byte (`floorCents 2500 / binCents 100`,
> comparación JSON idéntica), `Order.billingSnapshot` devuelto a `NULL`, `BillingProfile`/`KycProfile`
> de prueba borrados, `SellRequest` de prueba eliminadas, recuentos verificados. **Lo único que dejo
> a propósito son 2 filas de `AuditLog`** con mi referencia `SEC-REVERIF-001`: la bitácora es
> append-only y borrar de ella para "limpiar" es peor práctica que el rastro.
> **Nota de higiene del entorno:** entre las 23:49 y 23:52 otra corrida (E2E) tocó la misma BD
> (`InventoryItem` 260→290, `ShipmentRequest` 101→116, `AuditLog` con `order.chargeback_inventory`
> que yo no disparé). **No contamina estos resultados** — cada PoC crea y lee su propio dato en la
> misma ventana de segundos —, pero lo digo porque el entorno no estaba tan quieto como se me indicó.

---

## 0. VEREDICTO DE CIERRE

# ✅ APROBADO CON ACEPTACIONES

| | |
|---|---|
| **Las dos Medias que acepté con disparador** | **CERRADAS las dos** (R1 y S49-M1), verificadas **en vivo**. La aceptación con disparador **ya no aplica**: se puede borrar del expediente. |
| **¿Los arreglos introdujeron algo nuevo?** | **NO.** Cero hallazgos nuevos causados por los fixes (§6). |
| **¿Queda algo abierto de la misma clase?** | **SÍ: 2 Medias.** No las introdujeron los arreglos — **son sitios que los arreglos no alcanzaron, y que ni el pentester ni yo habíamos encontrado**. Confirmadas en vivo (§3). |
| **Críticos / Altos abiertos** | **0 / 0** ⇒ el criterio de rechazo del DoD *(«sin hallazgos críticos/altos abiertos»)* **no se dispara**. |

**Mínimo para pasar a APROBADO limpio (sin aceptaciones):** cerrar **S49-M1-R** y **S49-M2** (§3.1,
§3.2) y **extender el candado** `no-raw-entity-response.spec.ts` al patrón que hoy no ve (§4). Son
tres cambios en tres archivos; el patrón correcto ya existe en el mismo repo.

**Disparador DURO que traspaso a las dos Medias abiertas** (idéntico al que acepté antes, no uno
nuevo y más laxo): **se cierran ANTES de que la plataforma almacene la primera CLABE, INE o RFC de un
usuario real** — es decir, antes de abrir buylist o facturación a clientes reales. Fuera de esa
condición: **RECHAZADO**.

### ⚠️ Alcance EXACTO de este veredicto (leerlo antes de citarlo)

Este veredicto cubre el commit **`005a610`** y **solo** ese árbol. Al cerrar esta re-verificación el
**árbol de trabajo ya NO es `005a610`**: hay **15 archivos modificados sin commitear** (y 3 sin
seguimiento), entre ellos **`backend/src/common/pricing-curve.ts`** —el fichero de dinero que acabo de
certificar—, `pricing.controller.ts`, `settings/settings.constants.ts`, `frontend/src/lib/api.ts` y
`frontend/src/types/contract.ts`. Lo digo porque un veredicto que se cita sobre un árbol distinto del
que se auditó es peor que no tenerlo.

- **Lo que sí revisé de ese pendiente, porque toca lo que acabo de certificar:** el cambio a
  `MAX_CURVE_CONSTANT_CENTS` **aprieta** el techo (1 000 000 → **200 000**, MX$2,000). Es **más
  restrictivo**, así que D1 sigue cerrada *a fortiori*: todo lo que el techo viejo bloqueaba, el nuevo
  también, y `sanitizePricingCurve` sigue compartiendo validador con el `PUT`.
- **Lo que NO revisé y NO está cubierto:** el resto del pendiente, en particular **D3-b** en
  `pricing.controller.ts` (merge parcial de `sealed-spreads` con semántica `null` = retiro, y un
  **`@Allow()` que sustituye a `@IsNumber` en `fallbackPct`** delegando la validación a un validador a
  mano). Es un cambio en la **validación de un dial de precio**: entra por el gate normal
  (QA → techlead → seguridad) antes de desplegar. **No lo firmo aquí.**
- **Mi evidencia en vivo sí corresponde a `005a610`:** el backend que interrogué (PID 12024,
  `ts-node` sin watch, arrancado a las 23:18) nunca se reinició durante la ventana, así que servía el
  código de `005a610`, no el pendiente en disco.

---

## 1. Las dos Medias del veredicto anterior — **CERRADAS** (verificado en vivo)

### R1 · `PATCH /admin/users/:id/kyc` — **CERRADA** ✅

PoC de mi propio reporte, disparado contra `:3099` con token `super_admin` del seed:

```
PATCH /api/v1/admin/users/<id>/kyc  {"kycStatus":"verified","capPerRequestCents":500000}   → 200
{ id, userId, legalName, kycStatus, capPerRequestCents, capPerMonthCents,
  verifiedBy, verifiedAt, createdAt, updatedAt, ineOnFile:false }
PROHIBIDOS ENCONTRADOS: NINGUNO
```

**Fuera:** `clabeEnc`, **`clabeHmac`**, `rfcEnc`, `ineFrontKey`, `ineBackKey`. El `select`
(`ADMIN_KYC_SELECT`, `admin.service.ts:31-52`) es lista blanca **en BD** ⇒ el blind index ni se lee;
`toAdminKycDTO` (`:59-96`) reduce el INE a booleano. Es la solución que pedí, no un parche.
Fijado por test (`test/no-raw-entity-response.spec.ts:227-235` verifica que se pide `select`).

### S49-M1 · `SellRequest.clabeSnapshotEnc` — **CERRADA en las cinco rutas** ✅

Backend tiene razón en que eran **cinco**, no cuatro: se me escapó la salida **idempotente** de
`pay-spei` (`return req` del `findUnique`), que es el camino más barato de todos — basta re-postear
el pago, sin transición. Flujo completo ejercitado en vivo (crear solicitud → recibir → verificar →
pagar → re-pagar → responder), con `clabeSnapshotEnc` **presente en BD** (`has_enc = t`) para que el
test no pase por vacío:

| Ruta | Rol usado | HTTP | `clabeSnapshotEnc` | `closedAt` / `paidBy` |
|---|---|---|---|---|
| `POST /admin/buylist/:id/receive` | **vault_operator** | 201 | **ausente** | admin: presente (correcto) |
| `POST /admin/buylist/:id/verify` | **vault_operator** | 201 | **ausente** | admin: presente (correcto) |
| `POST /admin/buylist/:id/pay-spei` (transición) | super_admin | 201 | **ausente** | — |
| `POST /admin/buylist/:id/pay-spei` (**re-post idempotente**) | super_admin | 201 | **ausente** | — |
| `POST /buylist/requests/:id/respond` `decline` | customer | 200 | **ausente** | **ambos ausentes** ✅ |
| `POST /buylist/requests/:id/respond` `accept` | customer | 200 | **ausente** | **ambos ausentes** ✅ |
| `GET /buylist/requests/:id` (`getMine`) | customer | 200 | **ausente** | **ambos ausentes** ✅ |
| `GET /admin/buylist/:id` (`adminGet`) | **vault_operator** | 200 | **ausente** (sale `clabeMasked`, que es lo normado) | admin: presente (correcto) |

Control de dinero re-verificado de paso: `pay-spei` con token `vault_operator` ⇒ **403
`MONEY_OUT_FORBIDDEN`**. La CLABE en claro sigue saliendo **solo** por `reveal-clabe`.

**Conclusión:** las dos Medias que acepté están cerradas. **La aceptación con disparador que registré
en `7aa2081` ya no aplica y queda sin efecto.**

---

## 2. Los siete sitios que encontró backend y no estaban en ningún barrido — verificados ✅

Los dos que interesaban, comprobados:

- **`disputes.service.ts` `listMine`/`getMine`** — cerrados. Hoy hay **dos** proyecciones por
  audiencia (`toDisputeDTO` cliente / `toAdminDisputeRow` back-office, `:12-68`): el cliente ya no
  recibe `resolvedBy` (uuid del súper-admin que resolvió) ni `repurchaseOrderId` ni `userId`.
  Backend tiene razón en el diagnóstico de por qué se escapó: mi lista y la del pentester citaban
  `resolve` (admin) porque el grep encontraba `return this.prisma.dispute.update(`; `listMine` era
  `const data = await …; return { data }` — **el mismo patrón indirecto**, invisible al mismo grep.
- **`shipments.service.ts` `withAdminKind`** — cerrado (`toAdminShipmentRow`, `:26-56`). Y el
  diagnóstico es el correcto y es el más valioso de todo este delta: `...row` **es** una entidad
  cruda **disfrazada**, y ningún barrido de `return prisma.X` la delata. Comprobado que la lista
  blanca no perdió columnas: cubre **todos** los escalares de `ShipmentRequest`.

Los otros cinco (`inventory` update/move/mark/getItem/createLocation, `users` addresses,
`buylist` itemDecision, `pricing`/`catalog-sync`/`guest-checkout`/`jobs` marcados
`PROJECTION-EXEMPT`) verificados por lectura + respuesta viva. `GET /users/me/addresses` ya devuelve
`AddressDTO` (sin `userId`/`createdAt`/`updatedAt`). **Ninguna lista blanca perdió columnas** frente
al schema (comparé columna a columna: `ShipmentRequest`, `InventoryItem`, `VaultLocation`,
`SellRequest`, `Dispute` están completas; lo único deliberadamente fuera son las cuatro columnas
LEGACY de `SellRequestItem`, que nada consume).

---

## 3. Tercera pasada — buscando el patrón **disfrazado** (spread / helper / `include`)

Backend acertó al señalar que el patrón que buscábamos no detectaba el disfraz. Volví a barrer
**buscando eso**: spread de fila (`...row`/`...safe`/`...rest`), asignar-y-devolver, `Object.assign`,
y **relaciones de `include:` devueltas crudas dentro de una respuesta proyectada**. Aparecieron dos
sitios de la **misma clase y la misma severidad** que S49-M1 — **ninguno introducido por los
arreglos; los dos son anteriores y ninguno de los tres barridos (pentester, el mío, el de backend)
los había tocado.**

### 3.1 · S49-M1-R · [**Media**] · `GET /admin/users/:id` devuelve `sellRequests[]` **crudas**, con `clabeSnapshotEnc`, y llega al **vault_operator**

- **Ubicación:** `backend/src/modules/admin/admin.service.ts:288-302` — `include: { … sellRequests:
  { take: 20 }, orders: { take: 20 }, addresses: true, disputes: { take: 20 } }` y luego
  `const { passwordHash: _pw, ownedItems: _ownedRaw, ...safe } = user;` + `return { ...safe, … }`.
  La cabecera se filtra por **lista negra de dos campos**; **las relaciones no se tocan**.
- **PoC (en vivo, con una solicitud de venta real del seed):**

```
GET /api/v1/admin/users/<id>   Authorization: Bearer <vault_operator>       → 200
  .sellRequests[0] keys: [... "clabeSnapshotEnc" ...]
  clabeSnapshotEnc = "v1:IFt9OZHgjtWOYPxD:9ORvGnhquXCjcDvshZg6EA==:JWXhJuqhAfWFA2E…"
```

- **Por qué es exactamente S49-M1:** mismo dato (blob AES-256-GCM de la CLABE del vendedor), misma
  frontera de rol cruzada (`PROJECTION-EXEMPT` no aplica: esto es una respuesta HTTP), misma norma
  violada (`API_CONTRACT.md:5728`: «**nunca** el snapshot cifrado»). Y es **la misma ruta** cuya
  proyección de KYC el equipo usó como modelo de lo correcto para arreglar R1 — el `kycProfile` está
  impecable y la relación de al lado publica el ciphertext bancario.
- **De regalo, en la misma respuesta:** `orders[]` crudas (`guestEmail`, `paymentMethodLast4`,
  `stripePaymentIntentId`, `billingSnapshot`), `addresses[]` crudas y `disputes[]` crudas — o sea el
  **`toAddressDTO`/`toDisputeDTO` recién creados se saltan por esta puerta**.
- **Severidad Media** (idéntico criterio que S49-M1): ciphertext, no PII en claro; sin vector anónimo;
  sin impacto de dinero; pero cruza una segregación de funciones **diseñada a propósito** y
  contradice el contrato.
- **Rol dueño:** **backend** (proyectar las cuatro relaciones; `toAdminSellRequestDTO` ya existe y es
  literalmente la respuesta) + **arquitecto** (declarar el `Res` de §M6: el contrato dice que la ficha
  «incluye `sellRequests` (20)» y **no dice con qué forma** — la misma causa raíz que R1).

### 3.2 · S49-M2 · [**Media**] · `GET /admin/orders` publica `Order.billingSnapshot` —con `rfcEnc` y los datos fiscales— al **vault_operator**

- **Ubicación:** listado admin de órdenes (`@Controller('admin/orders')` +
  `@Roles(vault_operator, super_admin)`, `admin-orders.controller.ts:21-22`). `billingSnapshot` se
  escribe en `orders.service.ts:491-521` como **la fila `BillingProfile` entera**
  (`to_jsonb(BillingProfile)`), o sea `rfcEnc` + `razonSocial` + `regimenFiscal` + `usoCfdi` +
  `postalCode` + `email`.
- **PoC (en vivo; reproduje el dato escribiendo en la orden exactamente el mismo valor que escribe
  `orders.service.ts:521`, y lo revertí después):**

```
GET /api/v1/admin/orders?pageSize=100   Authorization: Bearer <vault_operator>   → 200
  data[].billingSnapshot = {"id":"765fab03…","email":"facturacion@e2e.local",
    "rfcEnc":"v1:aNPN+rUdkpBWHhsR:T9qZnWOvL5T+ZxtdU8LU1g==:WrbKso0cfyN6cOdH4Q==",
    "usoCfdi":"G03","postalCode":"01000","razonSocial":"SEC REVERIF SA","regimenFiscal":"601"}
```

- **Lo que lo convierte en hallazgo y no en diseño — hay DOS contraejemplos en el propio sistema:**
  1. `GET /admin/orders/**:id**` (la ruta hermana, mismo controller) **sí** proyecta: devolvió
     `billingSnapshot: null` con el dato presente en BD. El **detalle** está bien; el **listado** no.
  2. `AdminService.getUser` decide explícitamente `billingProfile: null` para el operador y lo
     documenta: *«Perfil de facturación (RFC/datos fiscales): **oculto al operador**»* (SEC-A4). El
     listado de órdenes reparte por la ventana lo que la puerta cierra.
- **Severidad Media, y digo también el argumento contrario para que se pueda discrepar con datos:**
  el dato realmente protegido —el **RFC**— viaja **cifrado**, igual que la CLABE de S49-M1 ⇒ no es
  «PII en claro» en el sentido fuerte que yo mismo fijé como criterio de rechazo. Lo que sí sale en
  claro (`razonSocial`, `regimenFiscal`, `usoCfdi`) es **metadato fiscal**, y `email`/`postalCode`
  ese rol **ya los ve** legítimamente (`seller`/`owner` en buylist y bóveda; `addressSnapshot` para
  el picking). Marginal real: la razón social y el régimen. ⇒ **Media**, no Alta.
- **Rol dueño:** **backend** (proyectar el listado como ya hace el detalle) + **arquitecto**
  (declarar si `billingSnapshot` es visible para `vault_operator`; hoy hay dos respuestas escritas y
  se contradicen).

### 3.3 · S49-B3 · [**Baja**] · El `card` del buylist es la fila `Card` cruda — **y el tipo declarado dice lo contrario**

- **Ubicación:** `buylist.service.ts:966-1004` — la firma declara `card: { id: string; name: string;
  number: string } | null` y el cuerpo hace `card: i.card`. Como TypeScript es **estructural**, un
  objeto más ancho pasado por variable **satisface** ese tipo: el tipo describe lo que se *usa*, no
  lo que se *emite*.
- **PoC (en vivo, `GET /buylist/requests/:id` con token `customer`):**

```
.items[].card keys: availableFinishes, catalogFinishes, createdAt, externalId, id, imageLargeUrl,
  imageSmallUrl, name, number, numberPrefix, numberSort, pricedFinishesSnapshot, rarity,
  rarityCanonical, setId, structuralFinishes, subtypes, supertype, tcgplayerId
```

- **Impacto:** bajo — el catálogo es público. Lo que sale de más es **instrumentación interna**
  (`pricedFinishesSnapshot`, `catalogFinishes`, `structuralFinishes`, `rarityCanonical`,
  `tcgplayerId`), no secretos. **Lo que importa es la lección:** este es el disfraz **más peligroso
  de todos** porque hay un tipo declarado al lado que da falsa tranquilidad — es B-1 al revés.
  Aparece igual en `GET /admin/buylist`, `GET /admin/buylist/:id` y `GET /admin/inventory/items`
  (`...relations` en `inventory.service.ts:1722`: `card`, `location`, `movements` crudas).
- **Rol dueño:** **backend** (reusar `toCardDTO`, que ya existe y es lo que el contrato llama `CardDTO`).

### 3.4 · Info · Coherencias menores que dejo anotadas, sin severidad

- **`getUser` sigue emitiendo `ineFrontKey`/`ineBackKey` al `super_admin`** mientras el `PATCH` recién
  arreglado ya no lo hace. El comentario del fix de R1 afirma dar «el mismo trato que `getUser`»: no
  es exacto, el `PATCH` es **más estricto**. Como verifiqué en el pase anterior que `presignGet` **no
  tiene ningún llamador**, esas object keys no le sirven hoy a nadie ⇒ conviene igualar `getUser` a
  la nueva proyección. → **backend**.
- **`frontend/src/lib/api.ts:3355-3357`** declara que `updateUserKyc` devuelve `AdminUserDetailDTO`;
  el backend devuelve ahora el KYC proyectado. **No rompe nada** (M6 ignora la respuesta y hace
  `invalidateQueries`), pero el tipo miente. → **frontend** + **arquitecto** (declarar el `Res`).
- **`backend/prisma/seed-e2e.ts` no tiene guardia de entorno.** `npm run seed:synthetic` contra
  cualquier `DATABASE_URL` crea `admin@e2e.local` / `Admin123!` con rol **`super_admin`**. Hoy solo
  lo invocan `e2e.yml` y `e2e-real.yml` contra BD efímeras del runner (verificado), así que el riesgo
  es **error de operador**, no una ruta abierta. Una guardia (`NODE_ENV`/host de la BD) cuesta cinco
  líneas. Pre-existente, no de este delta. → **backend**.

---

## 4. Juicio del candado nuevo (`backend/test/no-raw-entity-response.spec.ts`)

**Veredicto: la capa de comportamiento es buena; la capa estructural NO cierra la clase — y lo
demuestro, no lo opino.**

**Lo que está bien, y es mejor de lo que pedí:** los 13 tests de comportamiento pasan una fila que
**sí** trae el secreto y afirman sobre el **JSON serializado** (`expect(JSON.stringify(res)).not
.toMatch(/"v1:[^"]+"/)`), o sea detectan el blob aunque cambie el ciphertext; el mock de Prisma
**ignora los `select`** a propósito, así que el test solo pasa si la proyección está en el código; y
el segundo test del barrido (`:319-322`) verifica que el patrón vigilado **existe** en la base, que
es justo la lección del candado tautológico de enums. Eso está bien pensado.

**Lo que no cierra — evasión demostrada:** el barrido busca `return [await] prisma.<modelo>.<op>(`.
Eso deja fuera, por construcción, **los tres disfraces que este mismo release descubrió**:

| Patrón que NO ve | Ejemplo vivo hoy |
|---|---|
| asignar y devolver (`const x = await prisma…; return x`) | era el de `disputes.listMine` |
| **spread de fila** (`return { ...row }`) | `admin.service.ts:313` — **§3.1, fuga viva** |
| **relación de `include:` devuelta cruda** dentro de un objeto proyectado | `sellRequests[]`, `orders[]` en §3.1; `card`/`location`/`movements` en §3.3 |
| `select:` **en cualquier parte** del statement cuenta como lista blanca (`:303`) | un `select` anidado dentro de un `include` marcaría como seguro un `return` de fila cruda |

**La prueba de que esto importa, y es la frase que quiero que quede:**

```
$ npx jest test/no-raw-entity-response.spec.ts
Tests: 13 passed, 13 total        ← VERDE

$ curl -H "Authorization: Bearer <vault_operator>" .../admin/users/<id> | jq '.sellRequests[0].clabeSnapshotEnc'
"v1:IFt9OZHgjtWOYPxD:9ORvGnhquXCjcDvshZg6EA==:JWXhJuqhAfWFA2E…"     ← FUGA VIVA
```

**Un candado verde sobre una norma falsa es peor que no tener candado**: convierte una afirmación
verificable en una creencia, y es exactamente lo que hará que nadie vuelva a mirar. Es la misma
crítica que hice al test de paridad de enums (S49-B1), y el equipo la aplicó bien ahí (`business-rules.ts`
+ la clase E/R es una respuesta seria); aquí falta aplicarla a su propio candado.

**Lo mínimo para que el candado sostenga la clase** (→ **backend**): (a) barrer también
`const x = await prisma…` seguido de `return x` / `...x`; (b) prohibir `include:` en cualquier
`findX` cuyo resultado alcance un `return` sin proyección explícita — la relación es el nuevo
`return prisma.X`; (c) exigir que el `select:` que exime esté en el **nivel raíz** del statement, no
en cualquier parte de él.

---

## 5. D2 (visibilidad §N.7 en el emisor) y D1 (techo de la curva) — verificados ✅

### D2 · `referenceMxnCents` viaja **si y solo si** `priceBasis === 'market'` — confirmado en vivo, anónimo

| Superficie pública (sin token) | Resultado |
|---|---|
| `GET /catalog/cards` (rejilla) | claves = `card, currency, finish, gradeKey, productType, rawCondition, representativeInventoryItemId, salePriceCents, stockCount` — **sin `priceBasis`, sin `referenceValue`** ✅ |
| `GET /catalog/listings/:id` — **el PoC literal del pentester** | `priceBasis:"override"` ⇒ `referenceValue: {"status":"priced"}` — **el número desapareció** ✅ |
| idem con `priceBasis:"market"` | `referenceValue: {status, referenceMxnCents:100000, capturedDate}` — **no se apagó funcionalidad** ✅ (la otra dirección del `iff`, que es donde se rompen estas cosas) |
| `GET /catalog/cards/:cardId` (ficha + `units[]`) | ambos obedecen el mismo `iff` ✅ |
| `GET /catalog/sealed` (rejilla) | sin stock sellado en el entorno; cubierto por `toGroupSummaryDTO` + `test/catalog.market-visibility-emitter.spec.ts` (que además quita `priceSource`, del que `priceBasis` se deriva — el detalle que se pasa por alto) |
| `GET /catalog/facets`, `/buylist/cards`, `/buylist/bounties`, `/checkout/guest/quote`, `value-history` | **cero** señales de precio internas ✅ |

**Único residuo, y es el de siempre (R2, Baja, sin cambio):** `POST /buylist/quote` y `/quote/batch`
(**@Public**) siguen emitiendo `priceBasis` **y** `referencePrice.priceMxnCents`. Está **ratificado
por contrato** (`API_CONTRACT.md:2004-2008`) y, a diferencia de la rejilla, **está acotado**:
`@Throttle` 60/min y 12/min×50 ⇒ ~600 cotizaciones/min por IP frente a las **30 000 filas/min** que
permitía la rejilla. O sea: el arreglo no solo cerró el PoC, **redujo el canal de cosecha masiva en
dos órdenes de magnitud**. No lo reabro.

El test que lo fija (`catalog.market-visibility-emitter.spec.ts`, 296 líneas) es de los buenos:
prueba el `iff` **en las dos direcciones**, sobre el **JSON serializado** y a los dos niveles; y
`test/helpers/dto-keys.ts` deriva las claves esperadas de la interfaz con
`Record<keyof T, true>` ⇒ añadir un campo al DTO y no declararlo **no compila**. Eso sí cierra clase.

### D1 · `floorCents`/`binCents ∈ [0, 1 000 000]` — bloquea en **PUT**, en **preview** y **en lectura** ✅

```
PUT  /admin/pricing/curve  floorCents=2 000 000            → 422 "sale.floorCents must be an integer in [0, 1000000]"
PUT  …                     binCents=2 000 000              → 422 "buy.binCents must be an integer in [0, 1000000]"
PUT  …                     floorCents=2 000 000 000 000 000 (el caso exacto de QA) → 422
POST /admin/pricing/curve/preview  (los tres borradores)    → 422, mismo código y mismo `details`
PUT  …                     floorCents=1 000 000 (el borde)  → 200  (intervalo cerrado, coherente con el mensaje)
```

**Y el hueco de la vez pasada está cerrado**: inyecté la curva envenenada **directamente en BD**
(saltándome el `PUT`) y la lectura **no la sirve** — `sanitizePricingCurve` llama al **mismo**
`validatePricingCurve` (`pricing-curve.ts:1190-1194`), así que cae al seed:

```
UPDATE ConfigSetting … floorCents = 2000000000000000        (BD envenenada)
GET /admin/pricing/curve      → floorCents: 2500            (seed; NO sirve lo almacenado)
GET /catalog/cards (anónimo)  → 115000 / 575000 / 60000     (la vitrina NO se satura)
```

Curva restaurada y comparada byte a byte con el respaldo (`IDENTICA: True`).

---

## 6. ¿Los arreglos rompieron algo? — **No** (era mi preocupación principal)

Es mucha proyección nueva en seis módulos, y el riesgo real no es la fuga sino **el contrario**: una
lista blanca que quita un campo que el cliente necesita y rompe un flujo en silencio. Lo verifiqué
por cuatro vías independientes:

1. **Cobertura de columnas:** comparé cada lista blanca contra el `schema.prisma`, columna a columna.
   `ShipmentRequest`, `InventoryItem`, `VaultLocation`, `SellRequest`(admin), `Dispute`(admin) están
   **completas**; lo único fuera son las 4 columnas LEGACY de `SellRequestItem` y los campos internos
   deliberados (`closedAt`/`paidBy` en la vista de cliente).
2. **Consumidores reales:** `grep` en todo `frontend/src` de los campos retirados (`closedAt`,
   `paidBy`, `resolvedBy`, `repurchaseOrderId`, `orderItemId`, `ruleMode/ruleValue/ruleSource`,
   `address.userId/createdAt`) ⇒ **cero usos**. El único consumidor de la respuesta cambiada de R1
   (M6) la **ignora** y refresca por query.
3. **Compilación:** `tsc --noEmit` **backend: 0 errores**, **frontend: 0 errores**. Los tipos propios
   (`GroupedListingSummaryDTO`, `SealedGroupSummaryDTO`, `CardDTO`, `ListingDTO`, `HoldingDTO`) hacen
   que emitir de más o de menos **no compile**, que es el candado correcto.
4. **Suite unitaria completa:** `185 suites / 2089 tests / 100 % verde`.

Además comprobé que la trimming de D2 **no alcanza** a bóveda/portafolio ni a admin: `vault.service`
llama `toPublicPriceInfo(ref)` **sin** basis (§N.7 los excluye) y las superficies admin usan la
referencia sin recortar. Verificado en vivo: `GET /vault/holdings` conserva `referenceValue`.

**Conclusión: 0 hallazgos nuevos introducidos por los arreglos.**

---

## 7. Banderas para el humano (sin cambios de fondo; las repito porque siguen vigentes)

1. **Antes de operar con dinero real:** pentest de tercero + bug bounty. Esta fase es interna y
   gray-box; tres barridos independientes sobre la **misma** clase de fallo dejaron **dos** sitios
   vivos — eso es exactamente el argumento para una mirada externa, no contra ella.
2. **El disparador de las dos Medias es de negocio, no técnico:** hoy no hay ni una CLABE, RFC o INE
   real en la BD. El día que entre la primera, estas dos rutas pasan de «deuda» a «incidente de
   privacidad». Que alguien del negocio ponga fecha a ese día.
3. **Custodia y PII (INE/CLABE/RFC):** sigue pendiente la validación **legal** de retención y de
   contrato de custodia. No es una decisión de ingeniería.
4. **Higiene del entorno de pruebas:** el stack compartido se usó por dos actores a la vez durante
   esta ventana. Para el gate de seguridad conviene una BD dedicada y desechable (como usó el
   pentester), no la que corre la E2E.

---
<!-- ════════════════════════════════════════════════════════════════════════════════════════
     PASE v2.1.7 / v2.1.8 — GATE DE RELEASE (2026-08-24) — se antepone; el contenido
     histórico (P-48/v2.0, P-38, v1.28, Stream C, etc.) se conserva íntegro abajo.
     ════════════════════════════════════════════════════════════════════════════════════════ -->

# PASE v2.1.7 / v2.1.8 — GATE DE RELEASE · 2026-08-24 · VEREDICTO de seguridad

> **Rol:** seguridad (blue team / AppSec). Consolido el pase red team «PASE v2.1.7 / v2.1.8 — RELEASE»
> de `docs/PENTEST_NOTES.md`, lo cruzo contra el código con criterio propio, **añado lo que el red team
> no miró** y emito el veredicto de la fase de seguridad del **gate de release**. **NO corrijo código:**
> cada hallazgo lleva rol dueño (`CLAUDE.md`).
> **Árbol auditado:** delta `5bd1975..e78ced2` (15 commits) en `claude/card-pricing-rules-2e537m`.
> Durante el pase entró `455fb8a`, que es **solo `docs/PENTEST_NOTES.md`** — `git diff --stat
> e78ced2..455fb8a` = 1 archivo de docs, **cero código**. Así que el árbol de código que audité **es** el
> que se despliega.
> **Por qué corre otra vez:** mi veredicto anterior cubría hasta `5bd1975` y devops revocó por eso la
> certificación de DoD (`docs/DEVOPS_NOTES.md` §29.11-bis). Éste es el pase **por release** sobre el
> árbol final, como manda la «Cadencia de gates» de `CLAUDE.md`.
> **Modo:** revisión **estática dirigida** del delta + **barrido exhaustivo de proyecciones** en todo
> `backend/src/modules/` + `npm audit` + barrido de secretos + **peticiones GET de lectura** contra el
> stack vivo (`:3099`).
> **⚠️ Restricción de esta corrida (declarada, no disimulada):** QA estaba ejecutando la suite Playwright
> completa contra ese mismo stack, así que **no muté nada** — cero `POST`/`PUT`/`PATCH` que escriba, cero
> `psql` de escritura, no se reinició el stack, no se corrió ninguna suite. Todo lo que habría exigido
> mutar va marcado **[no verificado en vivo — colisión con QA]** y se sostiene en lectura de código.
> **Fuentes normativas:** `PROJECT.md` (§N.7, §H, §E, «Usuarios y roles») · `docs/API_CONTRACT.md` ·
> regla de conflicto de `CLAUDE.md`: **PROJECT manda sobre el contrato, el contrato manda sobre el código.**

---

## 0. VEREDICTO

# ✅ APROBADO CON ACEPTACIONES

**Hallazgos CRÍTICOS abiertos: 0. Hallazgos ALTOS abiertos: 0.** El criterio de rechazo del DoD
(*«sin hallazgos críticos/altos abiertos»*) **no se dispara**. La fase de seguridad del gate de release
**pasa**.

| Severidad | # abiertos | IDs |
|---|---|---|
| **Crítica** | **0** | — |
| **Alta** | **0** | — |
| **Media** | **2** | **R1** (pentester, confirmado) · **S49-M1** (nuevo, mío) |
| **Baja** | **5** | **R2** (pentester, *reclasificado a Baja*) · **R3** (confirmado) · **R4** (confirmado, *ampliado*) · **S49-B1** (nuevo) · **S49-B2** (nuevo) |
| Info / higiene | 4 | S49-I1 … S49-I4 |
| **Carryover abierto** | 5 | S48-B3 (residual) · S48-I1 · S48-I2 · S48-I3 · S48-I4 · + deps/Int32/MS-1/MS-4/B-1/B-2/B-5/throttler |
| **CERRADOS en este delta** | **6** | **S48-M1** · **S48-B1** · **S48-B2** · **S48-B4** · **S48-B5** · mitad de **S48-B3** |

### Disposición de cada MEDIA (sin ambigüedad, como pide el gate)

| ID | Disposición | Justificación registrada |
|---|---|---|
| **R1** — `PATCH /admin/users/:id/kyc` devuelve `KycProfile` cruda (`clabeEnc`, **`clabeHmac`**, `rfcEnc`, `ineFrontKey`, `ineBackKey`) | **SE ACEPTA FORMALMENTE**, con **disparador DURO** | `super_admin`-only. Un `super_admin` **ya puede** obtener la CLABE en claro por `reveal-clabe` (auditado), así que la escalada marginal *para ese actor* es pequeña; el riesgo real es **exposición incidental** (logs HTTP, memoria del navegador, telemetría, sesión admin comprometida) y la **pérdida de auditoría** de la correlación por blind index. No hay vector anónimo ni de rol menor a texto claro. ⇒ Media, aceptable con disparador. **Disparador: se cierra ANTES de que la plataforma almacene la primera CLABE o INE de un usuario real** (= antes de abrir el buylist a vendedores reales). Fuera de esa condición, **RECHAZADO**. |
| **S49-M1** — `SellRequest.clabeSnapshotEnc` viaja crudo en 4 rutas, dos de ellas alcanzables por **`vault_operator`** | **SE ACEPTA FORMALMENTE**, con **disparador DURO** | Es **ciphertext** AES-256-GCM con IV aleatorio por operación (`pii-crypto.service.ts`), o sea **no correlacionable** e ilegible sin `PII_ENCRYPTION_KEY`. No hay divulgación de PII en claro. Pero **viola una norma explícita del contrato** y cruza una frontera de rol deliberada. ⇒ Media, aceptable con disparador. **Mismo disparador que R1**, y se cierra en el mismo cambio (mismo archivo, mismo patrón). Fuera de esa condición, **RECHAZADO**. |

### Recomendación de ingeniería (NO cambia el veredicto — lo digo aparte a propósito)

**Recomiendo corregir R1 y S49-M1 antes de desplegar**, y lo separo del veredicto para que nadie tenga
que adivinar dónde acaba la norma y dónde empieza mi opinión. El argumento no es de severidad, es de
**coste/beneficio y de coherencia**:

1. **El coste es una cláusula `select` / un destructuring** — y la versión correcta **ya existe en el
   mismo archivo**, a 140 líneas de distancia (`admin.service.ts:246-300` para R1;
   `buylist.service.ts:933` y `:1073` para S49-M1). No hay que diseñar nada.
2. **Este release declara cerrada exactamente esta clase.** El mensaje de `cc96d87` dice *«ningún
   endpoint devuelve una entidad Prisma directamente»* y `406ab41` audita la regla. Desplegar con R1 y
   S49-M1 abiertos deja esa afirmación **falsa en `docs/` y en los comentarios del código**, que es peor
   que el bug: convierte una norma verificable en una creencia.
3. **Es un negocio de custodia con PII de INE/CLABE.** La minimización de datos no es cosmética aquí.

### Lo que HARÍA RECHAZAR este gate (y no ocurre)

- Un hallazgo crítico o alto abierto — **no hay ninguno**.
- Que alguna de las dos Medias fuera alcanzable **anónimamente** o produjera **PII en claro** para un rol
  que no deba verla — **no**: R1 es `super_admin` y S49-M1 entrega ciphertext.
- Que la derivación de enums hubiera **ensanchado** una validación de dinero o de autorización — la
  verifiqué valor por valor contra el schema: **no ensanchó nada** (§2.1).
- Que el delta hubiera tocado auth, pagos, cripto de PII, uploads, CORS/headers o el schema —
  **diff CERO** en los ocho, verificado (§4.1).

---

## 1. Hallazgos del pentester, consolidados con mi criterio

### R1 · [**Media**, CONFIRMADO] · `PATCH /admin/users/:id/kyc` devuelve la entidad `KycProfile` cruda

**Confirmo el hallazgo por lectura de código; mantengo Media.**

- **Ubicación:** `backend/src/modules/admin/admin.service.ts:378-403` (`updateUserKyc` →
  `return this.prisma.kycProfile.upsert({…})` **sin `select`**). Ruta:
  `backend/src/modules/admin/admin.controller.ts:123-124` (`@Patch(':id/kyc')` + `@Roles(super_admin)`),
  que devuelve `res` tal cual.
- **Qué sale exactamente** (columnas de `KycProfile`, `prisma/schema.prisma`): `rfcEnc`, `clabeEnc`,
  **`clabeHmac`**, `ineFrontKey`, `ineBackKey`, `legalName`, `capPerRequestCentsOverride`,
  `capPerMonthCentsOverride`, `verifiedBy`.
- **Prueba de que es bug y no diseño — la refuerzo:** la ruta hermana `getUser`
  (`admin.service.ts:246-300`) **borra a propósito** `clabeEnc`/`rfcEnc`/`clabeHmac` y reduce el INE a
  un booleano `ineOnFile` **incluso para `super_admin`**, y da al `vault_operator` una proyección aún
  más reducida. Y `PUT /users/me/kyc` (la versión del cliente, `users.service.ts:166-183`) **también**
  proyecta: termina en `return this.getKyc(userId)`, enmascarado. O sea: **el sistema tiene tres
  implementaciones del mismo dato y dos están bien**. La tercera es la que este release no miró.
- **Contrato:** `docs/API_CONTRACT.md:5795` declara el **Req** de este endpoint y **no dice nada del
  Res**. Ése es precisamente el mecanismo que el release identifica como causa raíz: cuando el contrato
  calla, la forma de la API la define el **schema**, y cada migración se vuelve un cambio de contrato
  silencioso. Va también al **arquitecto**.
- **Lo que me importa de verdad, y lo separo del resto:** el que duele es **`clabeHmac`**, no el INE.
  - El **blind index** es un HMAC-SHA256 **determinista** sobre la CLABE normalizada
    (`pii-crypto.service.ts`), diseñado para el match «a nombre propio» y para detectar CLABE compartida
    entre cuentas **sin descifrar**. Está indexado en BD (`@@index([clabeHmac])`). Es exactamente el
    tipo de valor que **nunca debe salir del servidor**: quien lo tenga puede (a) **correlacionar
    cuentas** fuera de la ruta auditada `reveal-clabe`, y (b) si algún día se filtra `PII_HMAC_KEY`,
    **forzar el espacio de CLABEs offline** (18 dígitos con estructura bancaria conocida es un espacio
    perfectamente atacable).
  - Las **keys de S3 del INE** son, en cambio, **menos graves de lo que suenan** — y lo verifiqué:
    `uploads.service.ts:134` expone `presignGet`, pero **no tiene NINGÚN llamador en todo `src/`**
    (`grep -rn "presignGet" src/` ⇒ solo la definición). **No existe hoy un endpoint que convierta una
    key de INE en una URL descargable.** La key sola no abre la imagen sin credenciales directas de
    R2/S3. Lo digo para que la remediación se priorice por el HMAC, no por el INE.
- **Impacto:** confidencialidad de PII bancaria + degradación de un control anti-fraude. **Sin impacto
  de dinero, sin escalada de privilegio, sin vector anónimo.**
- **[no verificado en vivo — colisión con QA]:** el PoC exige un `PATCH` que escribe. El pentester lo
  disparó `[LIVE]` en su ventana; yo lo sostengo en código.
- **Rol dueño:** **backend** (proyectar con la misma lista blanca que `getUser`) + **arquitecto**
  (declarar el `Res` de esta ruta en el contrato).

---

### R2 · [Media → **BAJA**] · §N.7 se aplica solo en el cliente: `referenceValue` + `priceBasis` viajan a anónimo

**Mantengo mi arbitraje del pase anterior (S48-B2) y lo ratifico: la mayor parte de R2 NO es un
hallazgo de seguridad, es una decisión de producto/contrato ya tomada. Pero el pentester tiene razón en
que algo sobrevive, y este release lo hizo MÁS ancho, no menos.**

**Lo que descarto, por escrito y no por criterio:**
1. **`priceBasis` en DTO público — lo EXIGE `PROJECT.md` §N.7:** *«La señal la produce el backend —
   `priceBasis` … el sistema registra y expone server-side qué determinó el precio … La UI no infiere
   nada: obedece ese dato»*, y §N.7 se autodefine como regla **de presentación**: *«el precio cobrado no
   cambia por esta regla»*. Un requisito de producto no puede ser a la vez la fuga.
2. **`referenceValue` sin recortar — lo norma el contrato**, `docs/API_CONTRACT.md:1929-1931`:
   *«`referenceValue` SIGUE viajando en el DTO aunque no se muestre: el mismo DTO alimenta superficies
   admin y de valuación … stripearlo por endpoint haría que `PriceInfo` significara cosas distintas
   según la ruta»*. Y `:2711-2713` lo repite en la ficha. Por la regla de conflicto, **el contrato manda
   sobre el código**.
3. **El PoC del cotizador (`priceBasis:"floor"` al vendedor) está ratificado** en
   `docs/API_CONTRACT.md:2004-2008`, que anticipa **literalmente** el argumento del pentester y lo
   resuelve: *«es para la LÓGICA del cliente … NO para RENDERIZARLO AL VENDEDOR … Decisión ratificada»*.
4. **El control de presentación está IMPLEMENTADO**, no prometido: `CardDetailView.tsx:218`
   (`showMarketValue = primary?.priceBasis === 'market'`), y `PriceBasisTag` solo aparece en superficies
   admin. Lo verifiqué en el pase anterior y el delta no lo tocó.
5. **La mitad que era hallazgo de verdad YA SE CERRÓ.** `toPublicPriceInfo`
   (`pricing.service.ts:184-191`) construye `PriceInfo` **por lista blanca** y deja fuera `source` e
   `isManualOverride`. **Verificado EN VIVO por mí** (GET anónimo de lectura, sin mutar nada):
   `GET /catalog/cards` devuelve `"referenceValue":{"status":"priced","referenceMxnCents":100000,
   "capturedDate":"2026-08-24"}` — **sin `source`, sin `isManualOverride`**. **S48-B2 CERRADO.**

**Lo que SÍ sobrevive, y es mío, no del pentester:**

- **(a) El argumento del contrato ya no se sostiene técnicamente.** La razón escrita para no recortar es
  *«stripearlo por endpoint haría que `PriceInfo` significara cosas distintas según la ruta»*. Pero
  **v2.1.6 hizo exactamente eso**: `toPublicPriceInfo` **ya** hace que `PriceInfo` signifique cosas
  distintas en superficie anónima vs admin, y el propio código lo celebra como doctrina (*«un DTO es
  CERRADO»*). El contrato no está mal por su conclusión; está mal por su **premisa**, y conviene que el
  arquitecto lo reescriba antes de que alguien lo cite como precedente para no proyectar otra cosa.
- **(b) Este delta AMPLIÓ la superficie anónima, no la redujo.** `d8c4625` añade `priceBasis` al
  `GroupedListingDTO` y al `SealedGroupDTO` (`catalog.service.ts:558`,
  `sealed-catalog.service.ts:156`). **Antes del delta, la REJILLA no lo emitía; ahora sí** — lo confirmé
  en vivo. Y §N.7 acota su propio alcance a **«SOLO fichas»** (`API_CONTRACT.md:2714-2716`: *«`GET
  /catalog/cards` (tejas/listados) no muestra valor de mercado hoy y no va a mostrarlo»*). O sea: el
  endpoint de **rejilla**, que es el masivamente scrapeable, ahora carga una señal que **su propia regla
  dice que no necesita**. Es corrección legítima de una desviación código↔contrato (el contrato lo
  declara en `GroupedListingDTO`), pero el efecto lateral es real.
- **(c) `priceBasis:"override"` reemplaza el canal que S48-M2 cerró.** Se retiró `isManualOverride` de
  `PriceInfo` por publicar *«un mapa scrapeable de qué cartas llevan precio fijado a mano»* — y
  `priceBasis === "override"` dice **exactamente lo mismo**, en el mismo DTO, al mismo anónimo. El fix
  cerró el campo y dejó el canal equivalente.

**Riesgo de negocio, dicho explícitamente (es lo que se me pidió que nombrara):** un **scraper
anónimo**, sin cuenta, puede construir por carta y a escala de catálogo: (1) la **referencia de mercado
interna** (`referenceMxnCents`), (2) el **precio de venta** (`salePriceCents`), y por tanto el
**múltiplo de markup exacto**, (3) **qué cartas llevan override manual** (`priceBasis:"override"` — o
sea dónde el feed falló o dónde el dueño decidió desviarse a mano) y (4) **qué cartas tocaron el piso**
(`priceBasis:"floor"` — o sea qué es bulk para nosotros). Un competidor con eso sabe dónde estamos
caros, dónde estamos ciegos y dónde no queremos vender. **Sin coste de entrada:** `GET /catalog/cards`
es `@Public`, no tiene `@Throttle` propio (cae al global de `300 req/min`,
`app.module.ts:38`) y admite `pageSize=100` (`catalog.controller.ts:56`) ⇒ **hasta 30 000 filas/minuto
por IP**, y el throttler es **in-memory**, así que con N réplicas el techo se multiplica por N.

**Severidad: BAJA** (no Media). Es confidencialidad de **metadato operativo de negocio**: no hay dinero,
no hay integridad, no hay PII, no hay escalada. Y `referenceMxnCents` deriva de fuentes **públicas**
(TCGplayer/PPT × FX), así que la revelación marginal es el **flag**, no el número.

**Remediación mínima que propongo (y es más barata que «separar el DTO por superficie»):** no hace falta
bifurcar `PriceInfo`. Basta con **no emitir `priceBasis` en la REJILLA** (`GET /catalog/cards`,
`GET /catalog/sealed`), donde §N.7 declara que no se usa, y conservarlo en la **ficha**
(`GET /catalog/cards/:cardId`, `GET /catalog/listings/:id`, `GET /catalog/sealed/:id`), que es donde la
regla vive. Eso corta el canal de scraping masivo sin tocar la regla de visibilidad ni el front.

- **Rol dueño:** **arquitecto** (decidir y **normar**: alcance de `priceBasis` por superficie + corregir
  la premisa obsoleta de `API_CONTRACT.md:1929-1931`) → luego **backend** (implementar lo que decida).

---

### R3 · [**Baja**, CONFIRMADO] · `sale.floorCents` / `buy.binCents` sin cota superior en el validador de la curva

**Confirmado por lectura de código. Mantengo Baja, y añado el análisis de impacto que faltaba.**

- **Ubicación:** `backend/src/common/pricing-curve.ts:748-757` (`floorCents`: solo `!isInt || < 0`) y
  `:759-767` (`binCents`: idem). **La asimetría es real y verificable en el mismo bloque V3:**
  `marketCents` → `> MAX_CENTS_CURVE` (`:774`), `multiplierBp` → `MULTIPLIER_BP_MAX = 1_000_000`
  (`:137`), `pctBp` → `PCT_BP_MAX = 10_000` (`:138`). **Las dos constantes que fijan piso y bin son las
  únicas sin techo** en un módulo cuyo comentario de cabecera se declara *money-safe*.
- **Impacto, desglosado por eje (esto lo añado yo):**
  - **Eje de VENTA:** `floorCents` astronómico ⇒ todo el catálogo aterriza en el piso ⇒ `clampCents`
    lo recorta a `MAX_CENTS = 2 147 483 647` (~MX$21.4M) ⇒ **nada se vende**. Es **denegación de
    negocio**, no pérdida de dinero. Y si alguien intentara comprar, el agregado desborda `Int32` en
    `Order.totalCents` ⇒ 500 (**MS-2**, carryover del pase v1.6, sigue abierto).
  - **Eje de COMPRA:** `binCents` astronómico ⇒ toda cotización sale astronómica ⇒ **el tope AML por
    solicitud la rechaza antes de crear nada** (`buylist.service.ts`, `BUYLIST_LIMIT_EXCEEDED`), y desde
    **AML-1** el tope mensual se re-verifica **también al pagar** (`:1617-1642`). **El dinero saliente
    está acotado por dos controles independientes** ⇒ el daño es denegación del buylist, no sobrepago.
  - **V7 (`bin < floor`) no ayuda:** como el pentester señala, se cumple trivialmente subiendo también
    el piso, porque **ninguno de los dos tiene techo**.
- **Por qué Baja y no Media:** exige `super_admin` (o escritura directa en BD), no hay atacante externo,
  y `sanitizePricingCurve` protege la **lectura** (una curva inválida cae al seed, §3.3 del pase
  anterior). Es un **typo de dedos gordos** en un módulo de dinero, no un vector.
- **Rol dueño:** **backend** (cota superior simétrica con el resto de V3).

---

### R4 · [Baja/Info, CONFIRMADO — y **AMPLIADO**] · La regla «ningún endpoint devuelve entidad Prisma» no está uniformemente aplicada

**Confirmo los 8 sitios que lista el pentester y coincido en su severidad (ninguno lleva PII ni
secretos). Pero la respuesta a la pregunta del encargo — «¿el barrido está completo?» — es NO.**
El barrido exhaustivo que hice está en **§2.1**, y encontró **11 sitios más**, uno de los cuales es
**Media** (S49-M1). El patrón que el pentester detectó es correcto; su inventario no lo es.

- **Sitios de R4 que confirmo, y por qué se quedan en Baja/Info:**
  `shipments.service.ts:564` (`setTracking`), `disputes.service.ts:152,163` (`resolve`),
  `inventory.service.ts:1642,1659,1678` (`update`/`moveItem`/`markItem`), `users.service.ts:81,91`
  (`address`). Los cuatro primeros son back-office con `@Roles(vault_operator, super_admin)`; los datos
  «sensibles» que arrastran (`InventoryItem.acquisitionCostCents`/`acquisitionPct` = margen interno;
  `ShipmentRequest.addressSnapshot` = dirección del cliente) **ya los ve ese rol por su función**
  (captura el coste al dar de alta, lee la dirección para hacer el picking). `users.service.ts` devuelve
  al usuario **su propia** dirección. **Sin fuga sensible; sí contraejemplos de una norma que el release
  declara universal.**
- **Rol dueño:** **backend**.

---

### Info del pentester · «el patrón de derivación auto-acepta valores futuros de enum»

**El pentester tiene razón en que es un riesgo de proceso, y me pidieron juzgarlo. Lo elevo a hallazgo
propio con análisis: ver S49-B1 (§2.2).** Respuesta corta a la pregunta del encargo — *«¿basta el test de
paridad?»*: **no, y por una razón estructural, no por descuido.**

---

## 2. Hallazgos NUEVOS de esta revisión

### 2.1 · S49-M1 · [**Media**] · El `clabeSnapshotEnc` del buylist viaja crudo en 4 rutas — dos de ellas alcanzables por `vault_operator`

**Es la misma clase que R1, en el módulo que el barrido del red team no cubrió, y contradice una norma
EXPLÍCITA del contrato.**

- **Ubicación (4 sitios, 1 archivo):**

  | Ruta | Rol | Sitio |
  |---|---|---|
  | `POST /admin/buylist/:id/receive` | **`vault_operator`** + `super_admin` | `buylist.service.ts:1109-1113` (`receive`), controller `admin-buylist.controller.ts:93-104` (devuelve `res`) |
  | `POST /admin/buylist/:id/verify` | **`vault_operator`** + `super_admin` | `buylist.service.ts:1121-1125` (`verify`), controller `:106-117` |
  | `POST /admin/buylist/:id/pay-spei` | `super_admin` (`@MoneyOut`) | `buylist.service.ts:1652` (`return tx.sellRequest.findUnique(...)`), controller `:196-214` |
  | `POST /buylist/requests/:id/respond` | **`customer`** (su propia solicitud) | `buylist.service.ts:947-950` y `:957-960`, controller `buylist.controller.ts:79-86` |

  Los roles del controller admin son de clase: `admin-buylist.controller.ts:21`
  (`@Roles(Role.vault_operator, Role.super_admin)`).

- **Qué sale:** la fila `SellRequest` completa ⇒ **`clabeSnapshotEnc`** (blob AES-256-GCM de la CLABE
  del vendedor), más `speiReference`, `paidBy` (id del admin que pagó), `ineRequired`/`ineProvided` y
  **`closedAt`**.

- **Prueba de que es bug y no diseño — es la más fuerte de todo el pase, porque el patrón correcto está
  en el MISMO archivo:**
  - `buylist.service.ts:933` — `getMine` (cliente): `const { clabeSnapshotEnc: _enc, items, ...rest } = req;`
  - `buylist.service.ts:1073` — `adminGet` (admin): `const { clabeSnapshotEnc: _enc, user, items, ...safe } = req;`
  - `buylist.service.ts:753-763` — `createRequest`: proyecta a `{ sellRequestId, status, quotedTotalCents, ineRequired, items }`.
  - `buylist.service.ts:1417` — `rejectRequest`: **usa `adminGet`** para responder, o sea proyecta.
  **Cuatro cuerpos lo hacen bien y cuatro lo hacen mal, en el mismo servicio.**

- **Norma del contrato que se viola, literal** (`docs/API_CONTRACT.md:5728`, sobre
  `GET /admin/buylist/:id`): *«La CLABE del vendedor se expone **enmascarada** como `clabeMasked`
  (`****1234`); **nunca** el snapshot cifrado ni la CLABE en claro. Para pagar, el súper-admin usa
  `reveal-clabe`»*, y `:5731`: *«[`reveal-clabe`] es el **ÚNICO** punto del contrato que devuelve la
  CLABE en claro; cada llamada queda registrada en `AuditLog`»*. El diseño construyó **tres** capas para
  esa CLABE — cifrado en reposo, `@MoneyOut()` + `super_admin` en `reveal-clabe`, y bitácora por
  llamada — y estas cuatro rutas la sacan **sin ninguna de las tres**.

- **Y además viola un invariante documentado en el propio schema:** `prisma/schema.prisma`, sobre
  `SellRequest.closedAt`: *«Campo INTERNO de cumplimiento: **NO se expone en DTOs de cliente**»*.
  `POST /buylist/requests/:id/respond` lo devuelve al **cliente**.

- **Impacto, honesto y acotado:**
  - **NO hay divulgación de PII en claro.** `PiiCryptoService` usa AES-256-GCM con **IV aleatorio de 12
    bytes por operación** (lo verifiqué en `pii-crypto.service.ts`), así que el ciphertext **no es
    correlacionable** entre solicitudes y es ilegible sin `PII_ENCRYPTION_KEY` (que en no-local es
    obligatoria de 32 bytes, con fail-fast al arrancar — bien construido).
  - **Lo que sí pasa:** (1) se **cruza una frontera de rol** que el sistema construyó a propósito
    — `PROJECT.md` dice del operador *«No toca dinero, configuración ni finanzas»*, y `getUser` le da
    una proyección **sin CLABE ni INE**; (2) el ciphertext de una **cuenta bancaria** sale del límite de
    la BD hacia navegadores, logs de proxy/CDN, telemetría de errores del front y cualquier captura de
    tráfico — que es justo lo que el cifrado en reposo existe para evitar; (3) si `PII_ENCRYPTION_KEY`
    se rota mal o se filtra alguna vez, todo ese ciphertext capturado se vuelve **descifrable offline**.
  - **Sin impacto de dinero** (el SPEI sigue siendo `@MoneyOut()` + `super_admin` + auditado; `paySpei`
    paga contra el snapshot cifrado de la propia solicitud, con transición atómica).
- **Por qué Media y no Alta:** no hay PII en claro, no hay escalada de privilegio, no hay vector anónimo
  ni de `customer` sobre datos ajenos (el IDOR del buylist está cerrado: `respond` verifica
  `req.userId !== userId` ⇒ 404, y el pentester lo confirmó `[LIVE]`).
  **Por qué no Baja:** cruza una frontera de rol *diseñada*, contradice dos normas escritas (contrato +
  schema) y toca la PII más sensible del sistema junto con el INE.
- **[no verificado en vivo — colisión con QA]:** las 4 rutas son `POST` que **escriben** (transición de
  estado). No las disparé. Sostenido en lectura de código, con el patrón correcto del mismo archivo como
  control.
- **Rol dueño:** **backend** (proyectar las 4 rutas — el destructuring de `:933`/`:1073` ya es la
  respuesta) + **arquitecto** (declarar el `Res` de `receive`/`verify`/`pay-spei`/`respond` en el
  contrato, que hoy solo declara el efecto).

#### El barrido exhaustivo — respuesta completa a «¿el barrido de R4 está completo?»

Método: `grep` de `return [await] (this.prisma|tx).<modelo>.<op>(` en **todo** `backend/src/modules/`
(excluyendo `*.spec.ts`) **más** un segundo barrido programático para el patrón indirecto
(`const x = await prisma…` … `return x;` dentro de 40 líneas), que es el que se le escapa a un grep
simple. **23 + 12 = 35 sitios candidatos**, clasificados uno por uno por *qué lleva la entidad* y *quién
la recibe*:

| Sitio | Entidad | ¿Llega al cliente? | Clasificación | Estado |
|---|---|---|---|---|
| `admin.service.ts:385` | `KycProfile` | Sí, `super_admin` | **PII + blind index + keys S3** | **R1 · Media · ABIERTO** |
| `buylist.service.ts:1109` `receive` | `SellRequest` | Sí, **`vault_operator`** | **PII cifrada (CLABE)** | **S49-M1 · Media · ABIERTO** |
| `buylist.service.ts:1121` `verify` | `SellRequest` | Sí, **`vault_operator`** | **PII cifrada (CLABE)** | **S49-M1 · ABIERTO** |
| `buylist.service.ts:1652` `paySpei` | `SellRequest` | Sí, `super_admin` | **PII cifrada (CLABE)** | **S49-M1 · ABIERTO** |
| `buylist.service.ts:947,957` `respond` | `SellRequest` | Sí, **`customer`** | **PII cifrada propia + `closedAt` interno** | **S49-M1 · ABIERTO** |
| `buylist.service.ts:1213,1268` `itemDecision` | `SellRequestItem` | Sí, back-office | Pricing interno (`priceBasis`, `marketBracket`) — sin PII | Baja (clase R4) |
| `buylist.service.ts:1604` `paySpei` idempotente | `SellRequest` | Sí, `super_admin` | Mismo que arriba | **S49-M1** |
| `shipments.service.ts:564` `setTracking` | `ShipmentRequest` | Sí, back-office | `addressSnapshot` (el rol ya la ve para picking) | Baja (R4) |
| `shipments.service.ts:492` `transition` | `ShipmentRequest` | Sí, back-office | Idem | Baja (R4, **no listado por el pentester**) |
| `disputes.service.ts:152,163` `resolve` | `Dispute` | Sí, back-office | `resolvedBy`, `resolution` — sin PII | Baja (R4) |
| `disputes.service.ts:79` `getMine` | `Dispute` | Sí, **`customer`** | Su propia disputa + `resolvedBy` (id de admin) | Info (**no listado**) |
| `inventory.service.ts:1642,1659,1678` | `InventoryItem` | Sí, back-office | `acquisitionCostCents` (margen) — el rol lo captura | Baja (R4) |
| `inventory.service.ts:1594` `getItem` | `InventoryItem`+relaciones | Sí, back-office | Idem | Info (**no listado**) |
| `inventory.service.ts:2293` `createLocation` | `VaultLocation` | Sí, back-office | Sin dato sensible | Info (**no listado**) |
| `users.service.ts:81,91` `address` | `Address` | Sí, **dueño** | Su propia dirección | Info (R4) |
| `catalog-sync.service.ts:816` | `CardSet` | Sí, `super_admin` | Catálogo público | **No es hallazgo** |
| `set-value.service.ts:150` | `CardSet` | Interno | — | **No es hallazgo** |
| `pricing.service.ts:453` | `CardProduct` | Interno (helper) | — | **No es hallazgo** |
| `orders.service.ts:159,509` · `guest-checkout.service.ts:142,291` · `shipments.service.ts:44` · `buylist.service.ts:753,1549` | `Order`/`InventoryItem`/`Address`/`SellRequest` | **NO** — helpers internos; el borde HTTP **sí** proyecta | — | **Verificado limpio** |

**Conclusión del barrido:** el patrón que el release cerró (`updateUserStatus`) y el que R4 documenta son
**correctos pero incompletos**. El inventario real es de **~17 rutas**, con **dos niveles**: las que
llevan **PII** (R1 + S49-M1, 5 rutas → Media) y las que llevan back-office/margen (12 rutas → Baja/Info).
Y el borde HTTP **sí** está bien resuelto en `orders`/`guest-checkout`/`payments`, lo cual confirma que
esto es negligencia local por módulo, no un fallo de arquitectura.

**Recomendación estructural para el techlead/backend (no es hallazgo, es cómo cerrar la CLASE):** cerrar
sitio por sitio deja la clase abierta otra vez — exactamente el argumento que `enum-values.ts` usa para
sí mismo. El equivalente aquí es un **test de forma que la máquina sostenga**: (a) anotar cada handler con
su tipo de DTO declarado, como ya se hizo con `GroupedListingDTO`/`SealedGroupDTO`
(`catalog.service.ts:75-107`, `sealed-catalog.service.ts:20-45`), lo que convierte el fallo en error de
`tsc`; y/o (b) un test que recorra `src/modules/**` y falle ante `return … prisma.<modelo>.<op>(` sin
`select`, con lista de excepciones explícita — el mismo patrón que `enum-values-parity.spec.ts` ya usa
para detectar «residuo».

---

### 2.2 · S49-B1 · [**Baja**] · La derivación de enums del schema convierte cada valor futuro en un ensanchamiento automático de la API — y el test de paridad **no puede** detectarlo

**Éste es el eje que se me pidió juzgar como riesgo de proceso. Mi veredicto: el control existe pero es
parcial, y el test de paridad es estructuralmente incapaz de cerrarlo.**

**Primero, lo que verifiqué y NO es un problema (el delta es limpio):** comparé valor por valor cada
lista derivada contra su `enum` del schema. **La derivación no ensanchó ninguna validación hoy**, salvo
la ampliación **deliberada y documentada** de `SealedSubtype` (+`upc`, +`collection`), que es una
corrección de producto — el dueño vende UPC y no podía. Los otros siete enums ya estaban completos en
las listas a mano. **Cero ensanchamiento no intencional.** Coincido con el pentester.

**El problema es de proceso, y es real:**

- **Qué hace el test de paridad** (`backend/test/enum-values-parity.spec.ts:58`):
  `expect([...derived].sort()).toEqual(Object.values(prismaEnum).sort())` sobre
  `derived = Object.values(prismaEnum)`. **Es una tautología en tiempo de ejecución.** Su valor real es
  el tercer test (`:67-76`), que lee `schema.prisma` del disco y detecta *Prisma Client desfasado del
  schema* — pero **solo para `SealedSubtype`**.
- **Por qué eso NO cierra el riesgo:** el test afirma que la lista **debe ser igual** al enum. Si mañana
  alguien añade un octavo valor al schema, el test **sigue verde** y el valor queda **auto-aceptado** en
  todas las superficies que derivan de él, **sin ninguna decisión por endpoint**. Lo que detectaría el
  ensanchamiento es lo **contrario** de un test de paridad: un **test de oro** que fije los valores
  esperados, de modo que añadir uno ponga el test en **rojo** y obligue a una decisión explícita
  (actualizar el golden **es** la decisión).
- **Hoy hay UN solo cortafuegos, y es accidental:** `enum-values-parity.spec.ts:64`
  (`expect(SEALED_SUBTYPE_VALUES).toHaveLength(7)`) sí se pone en rojo con un octavo subtipo. **Es el
  único de los ocho enums con anclaje de cardinalidad.** Los otros siete —`Finish`, `ProductType`,
  `RawCondition`, `GradingCompany`, `AcquisitionType`, `SealedCondition`, `Locale`— se ensanchan **en
  silencio**.
- **Dónde eso importa, en orden de riesgo:**
  1. **`RawCondition` — el caso grave, y es exactamente la trampa que el propio archivo advierte.**
     Hoy `enum RawCondition { NM }`, un solo valor. El delta cambió `@IsIn(['NM'])` por
     `@IsIn(RAW_CONDITION_VALUES)` en **cuatro** DTOs de inventario
     (`inventory.dto.ts:74,155,244,293`). Pero *«raw = solo Near Mint»* **no es un espejo del schema:
     es una decisión de producto de `PROJECT.md` §H** (*«en TODO el marketplace … se **eliminan** los
     grados LP/MP/HP/DMG»*), repetida en §A y §E como política NM-only del buylist. El docstring de
     `common/enum-values.ts` establece la regla correcta —*«Un `@IsIn` que a propósito acepta un
     subconjunto … NO se deriva de aquí … porque su lista es una decisión de producto, no un espejo del
     schema»*— y **excluye `UserStatus` por eso**, pero **incluye `RawCondition`**, que está en la misma
     categoría. Añadir `LP` al schema mañana **auto-abriría la captura de inventario a cartas no-NM**
     sin que nadie lo decidiera y sin que ningún test se ponga en rojo.
  2. **`AcquisitionType`** determina la **base de coste** del item (`owner_contribution` vs
     `client_purchase`, `PROJECT.md` §G/M1) y por tanto el P&L de M7. Un valor nuevo se auto-acepta en
     el alta (`inventory.dto.ts:89,165,254`) **sin regla de coste asociada**.
  3. **`ProductType`** enruta la resolución de precio (raw/graded/sealed tienen tres caminos distintos).
     Un cuarto valor auto-aceptado en filtros públicos y en el alta llegaría a `resolveSalePrice` sin
     camino propio.
  4. `Finish`, `GradingCompany`, `SealedCondition`, `Locale`: impacto bajo (peor caso, `pending`
     money-safe o un label sin traducir).
- **Severidad: Baja.** Es **latente** — hoy no hay ni un solo valor de enum que ensanche nada, y el
  disparador exige un cambio de schema, que pasa por migración y por el **arquitecto** (regla 9 de
  `CLAUDE.md`, `prisma/` es zona compartida). No hay vector de atacante. Pero es un control de
  autorización de entrada que pasó de *explícito por endpoint* a *implícito por schema*, y eso merece
  quedar escrito antes de que alguien lo descubra con una migración.
- **Qué propongo (respuesta directa a «¿basta el test de paridad o hace falta algo en contrato/CI?»):**
  1. **Sacar `RawCondition` de `enum-values.ts`** y devolverlo a `@IsIn(['NM'])` explícito con
     referencia a `PROJECT.md` §H — **misma decisión que ya se tomó con `UserStatus`**. *(backend)*
  2. **Anclar la cardinalidad de los ocho** (`toHaveLength(n)`), que es el golden mínimo y ya existe
     para uno. Convierte «añadir un valor al schema» en un test rojo, que es la señal que hoy falta.
     *(backend)*
  3. **Regla en el contrato:** que `docs/API_CONTRACT.md` declare que **añadir un valor a un enum de
     schema es un cambio de contrato** y exige pasar por el arquitecto **con decisión por superficie**
     (público / back-office / interno). Hoy el contrato ya lista los enums (§DTOs) pero no dice **quién
     autoriza ampliarlos**. *(arquitecto)*
  4. **CI:** el gate de SAST ya corre por PR; añadir a la plantilla de PR de migraciones un ítem
     «¿este cambio añade valores de enum? → decisión por endpoint documentada». *(devops)*
- **Rol dueño:** **arquitecto** (norma de contrato) + **backend** (1 y 2) + **devops** (4).

---

### 2.3 · S49-B2 · [**Baja**] · Los tres endpoints públicos de listado hacen escaneo completo sin cota y paginan **en memoria**

**Eje que el pentester declaró fuera de alcance (no hizo pruebas de carga). Lo encontré leyendo el
código de la superficie anónima.**

- **Ubicación:**
  - `backend/src/modules/catalog/catalog.service.ts:169-176` — `fetchSellable` hace
    `prisma.inventoryItem.findMany({ where, include: { card: { include: { set: true } } } })` **sin
    `take`**.
  - `catalog.service.ts:610-627` — `listCards` construye **todos** los grupos, filtra por precio,
    ordena y **luego** hace `groups.slice(start, start + pageSize)` **en la app**.
  - `catalog.service.ts:635` — `facets()` llama al **mismo** `fetchSellable` sobre `publishedWhere()`
    (sin el filtro de singles), o sea el catálogo publicado **entero**.
  - `catalog/sealed-catalog.service.ts:82-87` + `listSealed` (`:224-226`) — patrón idéntico para el
    sellado.
- **Rutas afectadas (las tres `@Public`, sin `@Throttle` propio):** `GET /catalog/cards`,
  `GET /catalog/facets`, `GET /catalog/sealed`.
- **Por qué importa:** el coste de cada petición **anónima** crece **linealmente con el inventario
  publicado total** y es **independiente de `pageSize`** — pedir `pageSize=1` cuesta lo mismo que pedir
  100. Con el límite global de `300 req/min` por IP (`app.module.ts:38`) y **storage in-memory** (el
  propio comentario `:37` lo admite ⇒ con N réplicas el techo efectivo se multiplica por N), es una
  **amplificación barata**: una petición HTTP trivial dispara un escaneo de tabla + hidratación de
  `card`+`set` + agrupación + orden en el heap de Node.
- **Severidad: Baja, HOY.** El catálogo del cut-over es pequeño (≈333 cartas según el runbook de
  `post-deploy.sh`), el negocio **no está en vivo** y el throttler global acota. **No lo inflo.**
- **Disparador para dejar de ser Baja:** cuando el inventario publicado pase de unos pocos miles de
  piezas, **o** antes de la primera campaña que traiga tráfico anónimo real. Es la misma clase que
  **S48-B3** (`pricingBrackets` sin `take`), con la diferencia de que aquélla es `super_admin` y ésta es
  **anónima**.
- **[no verificado en vivo]:** medir tiempos contra el seed E2E (3 grupos) no probaría nada, y una
  prueba de carga habría colisionado con la corrida de QA. Verificado en código.
- **Rol dueño:** **backend** (paginar en la BD, o cachear la agrupación) + **arquitecto** (si paginar en
  BD obliga a cambiar el significado de `total` = nº de grupos, es cambio de contrato).

---

### 2.4 · Info / higiene (no son hallazgos)

- **S49-I1 · Las listas derivadas se exportan como arrays MUTABLES compartidos.**
  `common/enum-values.ts` exporta `Object.values(...)` sin `as const` ni `Object.freeze`, y
  `buylist/dto/buylist.dto.ts:22` guarda un **alias** (`const FINISHES = FINISH_VALUES`), no una copia.
  Cada `@IsIn(...)` retiene **la misma referencia**. Un `push()` en cualquier punto del proceso
  ensancharía **todas** las validaciones de la app a la vez. Hoy nadie muta (lo verifiqué), y
  `SEALED_SUBTYPE_KEYS` y los `new Set(...)` sí copian. Es defensa en profundidad barata en un archivo
  cuya tesis es *«que la máquina lo sostenga»*: `Object.freeze(Object.values(X))`. *Backend.*
- **S49-I2 · `LOCALE_VALUES` es un export muerto.** Declarado en `enum-values.ts` y verificado por el
  test de paridad, pero **cero llamadores** en `src/`. Un allowlist que nadie usa se pudre. *Backend.*
- **S49-I3 · `variant-controls.service.ts:46` mantiene su propio `Object.values(Finish)`** en vez de
  importar `FINISH_VALUES`. Es derivado (no puede desincronizarse del schema), pero es la **segunda
  declaración** de la lista, justo lo que `enum-values.ts` existe para eliminar — y el test de residuo
  no lo detecta porque no es una lista literal. *Backend.*
- **S49-I4 · El reporte del pentester no estaba en el árbol cuando audité `e78ced2`.** Llegó en
  `455fb8a`, **transcrito por el orquestador** porque el rol `pentester` no tiene `Write`/`Edit` en esta
  sesión. Que el rol dueño de `docs/PENTEST_NOTES.md` **no pueda escribir su propio archivo** es una
  brecha de tooling con consecuencia de **cadena de custodia**: el informe de red team pasa por un
  intermediario. No pongo en duda el contenido (lo crucé contra el código y cuadra), pero la fila 4 del
  DoD («`docs/` al día») depende de que esto no vuelva a pasar. *devops (config de roles).*

---

## 3. Re-verificación de MIS hallazgos previos (pase P-48 / v2.0)

Los verifiqué uno por uno contra el código de `e78ced2`. **No los di por cerrados porque alguien lo
diga en un commit.**

| ID | Sev. previa | Estado | Evidencia verificada por mí |
|---|---|---|---|
| **S48-M1** — el cierre de la cola de pendientes es agnóstico del eje | Media | ✅ **CERRADO** | `pricing.service.ts:1071-1101`: `closePendingForVariant` ahora recibe `context` y el `where` discrimina por razón — `no_market`/`null` cierran desde cualquier eje (invariante v1.26 intacto), **`premium_at_floor` solo desde el `context` que la abrió**. Era mi única Media abierta. **El seed E2E lo ejercita con datos reales** (`prisma/seed-e2e.ts`, `E2E_CARDS.floorpremium` con mercado MX$10 ⇒ venta en piso / compra en mercado). |
| **S48-B1** — cadena de prototipos evade el allowlist de `PUT /admin/settings` | Baja (disparador duro) | ✅ **CERRADO, y mejor de lo que pedí** | `settings.service.ts:98` usa `Object.prototype.hasOwnProperty.call`; las escrituras van en `$transaction`; la **auditoría entra DENTRO de la misma transacción** vía callback `auditWithin` (mi punto 1); y encontraron un tercer agujero que yo no vi: el acumulador `errors` era `{}`, donde `errors['__proto__'] = …` **no crea propiedad** y el error se perdía en silencio ⇒ ahora `Object.create(null)` (`:95`). |
| **S48-B2** — `isManualOverride` a clientes anónimos | Baja | ✅ **CERRADO — verificado EN VIVO** | `toPublicPriceInfo` (`pricing.service.ts:184-191`) construye por **lista blanca**. `GET /catalog/cards` anónimo (lectura, sin mutar) ⇒ `referenceValue` solo con `status`/`referenceMxnCents`/`capturedDate`. Aplicado en `catalog:385`, `sealed-catalog:159`, `vault:160,321,393`. ⚠️ **Residual: el canal equivalente sigue abierto vía `priceBasis:"override"`** — ver R2(c). |
| **S48-B3** — reporte de brackets sin cota ni validación de fechas | Baja | 🟡 **MITAD CERRADA** | ✅ La validación de fechas está: `admin.service.ts:19-24` — `range()` ahora rechaza fecha inválida y rango invertido con **422 con el campo señalado** (antes `Invalid Date` → 500). ❌ **La cota sigue sin estar:** `admin.service.ts:825` y `:846` siguen con `findMany` **sin `take`** y agregación en memoria. Sigue en deuda aceptada. |
| **S48-B4** — líneas pendientes suman $0 a los topes AML | Baja (disparador duro) | ✅ **CERRADO** | **AML-1**: `buylist.service.ts:1617-1642` — `paySpei` re-verifica el **tope mensual sobre el dinero que SALE** (`approvedTotalCents ?? quotedTotalCents`), leyendo el override de KYC del vendedor, **dentro de una transacción `Serializable`** (cierra también la carrera de dos `pay-spei` concurrentes del mismo vendedor, que era el bypass clásico). Era justo el hueco residual que reporté. |
| **S48-B5** — escritura en la cola antes de topes/INE y fuera de la tx | Baja | ✅ **CERRADO** | `buylist.service.ts:766-777`: las llamadas a `settlePendingForVariant` se movieron **fuera del bucle de ítems y DESPUÉS del commit** de la transacción `Serializable`, con la justificación money-safe escrita (*«perder una escalada es recuperable; escribir la cola por una solicitud que NO se creó, no»*). Una solicitud que termina en 422 ya no deja rastro en la cola del dueño. |
| **S48-I1** — default fail-open del parámetro del guardarraíl | Info | ⚠️ **ABIERTO** | `pricing/variant-pricing.ts:86` sigue con `rarityCanonical: string \| null = null`. Sin exposición hoy (los dos llamadores lo pasan). Deuda. |
| **S48-I2** — `json()` sin `limit` explícito | Info | ⚠️ **ABIERTO** | `main.ts:53` sigue `app.use(json())` sin `limit`. Acotado de facto por el default de 100 kB de Express. Deuda. |
| **S48-I3** — `ADMIN_JWT` de post-deploy · **S48-I4** — fallback silencioso de la curva | Info | ⚠️ **ABIERTOS** | `scripts/` no cambió en el delta. Deuda de **devops**. |
| **Nit 422→401 del guard** | Contrato | ✅ **CERRADO** | `common/guards/jwt-auth.guard.ts:44` — `new BusinessException('UNAUTHENTICATED', 401, …)`. Verificado además que **no abre nada**: el guard sigue fijando `algorithms: ['HS256']` (`:52`), verificando `status` y `tokenVersion` **contra la BD** en cada request (`:60-71`), y `req.user.role` viene del **token firmado**. Comprobé que **no existe ninguna ruta que cambie el `role` de un usuario**, así que no hay ventana de rol obsoleto; y bloquear surte efecto inmediato porque el `status` se relee de BD. |

**Balance:** de mis 6 hallazgos accionables del pase anterior, **5 cerrados y 1 a medias**. Es el mejor
ciclo de remediación del proyecto y lo dejo escrito.

---

## 4. Lo que verifiqué yo (defensa) — positivos con evidencia

### 4.1 · Las superficies críticas **no se tocaron** — diff CERO, verificado, no supuesto

`git diff --stat 5bd1975..e78ced2` sobre cada ruta: **`backend/src/modules/auth/`, `payments/`,
`shipments/`, `disputes/`, `uploads/`, `users/`, `common/crypto/`, `common/decorators/`, `src/main.ts`,
`src/app.module.ts` y `prisma/schema.prisma` ⇒ salida vacía.**

Consecuencias que puedo afirmar como **hecho** y no como esperanza:

- **Sin cambio de schema ⇒ sin migración nueva ⇒ sin riesgo de datos.** `M-41` sigue siendo la única
  migración por delante de `origin/main`, como dice devops en §29.11-bis.
- **JWT / argon2 / rotación / revocación por `tokenVersion` / logout: intactos.**
- **Verificación de firma del webhook de Stripe, idempotencia por `event.id`, reserva atómica
  anti-doble-venta, manejo de contracargo/reembolso: intactos.**
- **Cripto de PII intacta** — y la revisé de nuevo por S49-M1: AES-256-GCM, **IV aleatorio de 12 bytes
  por operación**, authTag de 16, formato versionado `v1:iv:tag:ct`, HMAC con **clave dedicada**
  (`PII_HMAC_KEY`) y **fail-fast obligatorio** en no-local para ambas claves, con exigencia de 32 bytes.
  Está bien construida.
- **Retención de INE intacta** (`jobs/ine-retention.service.ts`, dial `INE_RETENTION_DAYS`=180 anclado a
  `SellRequest.closedAt`), y la **purga en borrado de cuenta** funciona en **ambos** modos
  (`admin.service.ts:502` `purgeIne` antes de decidir hard/soft; el soft-delete anula
  `clabeEnc`/`clabeHmac`/`rfcEnc`/`legalName`/`ineFrontKey`/`ineBackKey`, `:509-528`).
- **CORS / cabeceras / pipes sin regresión:** `helmet()` (`main.ts:42`), `enableCors` con **allow-list**
  y **nunca `origin: true`** (`:61-62`), `ValidationPipe({ whitelist: true })` (`:56`),
  `trust proxy` (`:39`), body raw solo para el webhook de Stripe (`:48`).
- **Rate-limiting sin regresión y bien calibrado donde importa:** global 300/min
  (`app.module.ts:38`), y `@Throttle` endurecido en lo sensible — `login`/`register`/`google` **5/min**,
  `forgot-password` **10/hora**, `reset-password` 10/min, `verify-email` 10/hora, checkout de invitado
  **5/hora**, `resend-link` **3/hora**, `restock-subscriptions` 5/min. *(Carryover: el storage sigue
  in-memory ⇒ multiplicado por réplicas.)*

**Traducción para el gate:** este release **no puede** haber roto autenticación, dinero saliente,
transporte ni PII, porque **no tocó ese código**. Lo que reviso es lo que sí tocó: proyecciones, enums,
un guard de código de estado y DTOs de catálogo.

### 4.2 · La derivación de enums: verificada valor por valor

Comparé las ocho listas contra `prisma/schema.prisma`. `SealedSubtype` pasa de 5 (a mano) a **7**
(`+upc +collection`) — **ampliación deliberada, de producto, documentada**. Las otras siete no cambian
ni un valor. **Cero ensanchamiento no intencional.** El riesgo es de futuro (S49-B1), no de hoy.

### 4.3 · Los DTO tipados son un **control de seguridad**, no solo higiene

`GroupedListingDTO` (`catalog.service.ts:75-107`) y `SealedGroupDTO`
(`sealed-catalog.service.ts:20-45`) pasan de objeto literal a **interfaz declarada**. Eso convierte
«omitir un campo del contrato» en error de `tsc`. Lo anoto como positivo de seguridad porque es
**exactamente el mecanismo que propongo en §2.1 para cerrar la clase de R1/S49-M1**: la forma de la
respuesta deja de depender de la disciplina y pasa a depender del compilador. Ojalá se extienda a las
17 rutas del barrido.

### 4.4 · `toPriceHistoryEntry` — la remediación correcta, hecha bien

`pricing.service.ts` introduce **una** proyección por **lista blanca** para `PriceReference`, usada por
`GET /admin/pricing/card/:cardId` y por `POST /admin/pricing/override`
(`pricing.controller.ts:225`, `:254`). Antes ambas devolvían la fila cruda (`id`, `fxRate`,
`fxBufferPct`, `cardProductId`, `createdAt`). Y la decisión de **sí** emitir `isManualOverride` aquí
—superficie `super_admin` de auditoría, donde la procedencia **es** la pregunta— es el criterio
correcto y está razonado en el código: *«la pregunta correcta nunca es ¿este campo es sensible? sino
¿es sensible PARA QUIEN LEE ESTA RUTA?»*. **Suscribo la regla.**

### 4.5 · `useMocks` pasa a opt-in — corrección de seguridad real

`frontend/src/lib/config.ts:19` pasa de `!== 'false'` (encendido por defecto) a `=== 'true'`. Antes, un
build de producción sin `NEXT_PUBLIC_USE_MOCKS=false` servía **fixtures en silencio**: precios e
inventario falsos, sin un solo error en pantalla. Es un **default que fallaba hacia el lado inseguro**
en una app que muestra precios de dinero. **Buen fix.**

### 4.6 · Dependencias y secretos (corrido hoy)

- `npm audit --omit=dev`: **backend 2 moderate, 0 high, 0 critical** (`@nestjs/core`
  GHSA-36xv-jgw5-4q75, arrastra `@nestjs/platform-express`; el fix exige salto mayor a NestJS 11) ·
  **frontend prod 0 vulnerabilidades**. **Sin cambio** — carryover de devops.
- **Secretos:** barrido de patrones (`sk_live`/`sk_test`/`pk_live`/`AKIA…`/`BEGIN … PRIVATE KEY`/
  `whsec_`/`xox…`/`ghp_`) + asignaciones tipo `secret|token|password|api_key = "…"` sobre **todos** los
  archivos del delta ⇒ **cero credenciales**. Lo único que aparece son **placeholders** de
  `.env.example` (`sk_test_CHANGE_ME`) y menciones en docs.
- **`.env` fuera del repo:** `git ls-files | grep .env` ⇒ **solo `.env.example`**; `.gitignore:3-10`
  cubre `.env`, `.env.local`, `.env.*.local`, `.env.development/production/test` con `!.env.example`.
- **`dump.rdb`:** `6cc72d6` lo añade a `.gitignore:59`. Verifiqué que **nunca estuvo commiteado**
  (`git log --all -- dump.rdb` ⇒ vacío) y que el archivo en disco solo contiene **metadata de BullMQ**
  (`bull:tcg-daily:repeat`), sin secretos ni PII. **Higiene correcta, cerrada.**

### 4.7 · Autorización y superficie pública

- **33 `@Public()` en 29 rutas**, enumeradas y contrastadas contra el contrato: catálogo de lectura,
  auth (con throttle duro), checkout/seguimiento de invitado, cotizador de buylist, `health` y el
  webhook de Stripe. **Ninguna ruta nueva se hizo pública en este delta**, y ninguna toca dinero
  saliente ni back-office.
- **Dinero saliente intacto:** los tres `@MoneyOut()` siguen donde deben — refund
  (`admin-orders.controller.ts`), `reveal-clabe` y `pay-spei` (`admin-buylist.controller.ts:79-80`,
  `:196-197`), todos `super_admin` y auditados.
- **Filtro global de excepciones sin fuga:** `common/filters/all-exceptions.filter.ts` — una excepción
  no controlada **loguea el stack del lado servidor** y responde
  `{ error: { code: INTERNAL, message: 'Internal server error', details: {} } }`. **Sin stack, sin
  mensaje de Prisma, sin nombres de tabla.**

---

## 5. No verificado / fuera de alcance (dicho, no asumido)

Mantengo la disciplina del equipo: **prefiero una brecha escrita que una garantía inventada.**

- **No muté el estado del sistema.** QA corría la suite Playwright completa contra el mismo stack.
  Solo hice **GET** de lectura. Concretamente **[no verificado en vivo — colisión con QA]**: el PoC de
  R1 (`PATCH .../kyc`), los cuatro de S49-M1 (`receive`/`verify`/`pay-spei`/`respond`), el de R3
  (`PUT /admin/pricing/curve`) y el `POST /buylist/quote` anónimo. Los cuatro primeros están
  **confirmados por lectura de código** con el patrón correcto del mismo archivo como control; R3 y el
  quote los disparó el pentester `[LIVE]` en su ventana y **crucé su resultado contra el código**.
- **No corrí ninguna suite de tests** (habría colisionado con QA). El verde de la suite lo emite **QA**,
  no yo.
- **No corrí DAST ni el gate SAST de CI** en esta sesión.
- **No hice pruebas de carga** — por eso S49-B2 va como Baja verificada en código, sin número medido.
- **Concurrencia y carreras: no ejercitadas.** Mi juicio sobre si son ajenas al delta: **webhook de
  Stripe, reserva de checkout, `convert-to-inventory`** ⇒ genuinamente **fuera** (diff cero en
  `payments/` y `shipments/`; `reserveItems` no aparece en el diff). **Tope mensual del buylist** ⇒ ya
  **no** es hueco: **AML-1** lo cierra con `Serializable` en el punto de pago (§3).
- **No re-audité** la matemática de la curva ni la cobertura de tests (QA y techlead ya lo hicieron).
  Mi lente fue **authz, manipulación, fuga, PII y abuso de flujo**.
- **`pokemontcg.io` sin egress (403)** ⇒ precios STALE es **esperado en este entorno**, no hallazgo.
- **El throttler multi-instancia sigue sin verificarse** (storage in-memory, `app.module.ts:38`).
  Carryover de devops.

---

## 6. Deuda de seguridad ACEPTADA (no bloqueante) — con disparador

| ID | Tema | Impacto | Disparador para abordarla | Dueño |
|---|---|---|---|---|
| **R1** | `PATCH /admin/users/:id/kyc` devuelve `KycProfile` cruda (`clabeHmac`, `clabeEnc`, keys INE) | Fuga del **blind index** (correlación de CLABEs sin auditar; forzable offline si se filtra `PII_HMAC_KEY`) + exposición incidental en logs/navegador | **DURO: antes de que se almacene la primera CLABE/INE real** (= antes de abrir el buylist a vendedores reales). **Recomendado: antes de desplegar.** | **backend** + arquitecto |
| **S49-M1** | `clabeSnapshotEnc` crudo en `receive`/`verify`/`pay-spei`/`respond` | Ciphertext de cuenta bancaria fuera del límite de BD, hacia **`vault_operator`** y `customer`; viola contrato (`API_CONTRACT.md:5728`) y el invariante de `closedAt` del schema | **DURO: el mismo que R1** (se cierran en el mismo cambio, mismo archivo). **Recomendado: antes de desplegar.** | **backend** + arquitecto |
| **R2** | `priceBasis` + `referenceValue` a anónimo; `priceBasis` **nuevo** en la rejilla | Inteligencia de pricing scrapeable (markup por carta, qué lleva override, qué tocó piso) a 30 000 filas/min | Al primer indicio de scraping competitivo, **o** en la próxima revisión de `PriceInfo`/§N.7 por el arquitecto. Remediación mínima en §1-R2. | **arquitecto** → backend |
| **R3** | `floorCents`/`binCents` sin cota superior | Typo de `super_admin` rompe el pricing del catálogo (venta) o bloquea el buylist (compra). Money-out acotado por AML | Junto con cualquier otro toque a `pricing-curve.ts`; **antes de operar con dinero real** si se quiere simetría money-safe completa | **backend** |
| **R4** | 12 rutas de back-office devuelven fila cruda (sin PII) | Si mañana se añade una columna sensible al schema, se **auto-publica** | Con el cierre de R1/S49-M1 (mismo cambio) o con el test de forma de §2.1 | **backend** |
| **S49-B1** | Enums derivados: valor futuro del schema = ensanchamiento automático de la API | Latente. `RawCondition` es el caso grave (rompería la política NM-only de `PROJECT.md` §H sin test rojo) | **Antes de la próxima migración que añada un valor de enum** — y sacar `RawCondition` ya, por ser decisión de producto | **arquitecto** + backend + devops |
| **S49-B2** | Escaneo completo sin cota + paginación en memoria en 3 endpoints `@Public` | Disponibilidad; amplificación barata desde tráfico anónimo | Cuando el inventario publicado pase de unos miles de piezas, **o** antes de la primera campaña con tráfico real | **backend** (+ arquitecto si cambia `total`) |
| **S48-B3** (residual) | `pricingBrackets` sin `take` ni paginación (fechas **ya** validadas) | Disponibilidad (OOM/500 en reporte admin) | Cuando el histórico supere decenas de miles de líneas, o si el reporte se automatiza | **backend** |
| S49-I1 · S49-I2 · S49-I3 | Arrays de enum mutables compartidos · `LOCALE_VALUES` muerto · segunda declaración de `FINISH_VALUES` | Higiene / defensa en profundidad | Junto con S49-B1 (mismo archivo) | **backend** |
| S49-I4 | El rol `pentester` no puede escribir `docs/PENTEST_NOTES.md` | Cadena de custodia del informe de red team | Antes del próximo pase de seguridad | **devops** |
| S48-I1 · S48-I2 · S48-I3 · S48-I4 | Fail-open del guardarraíl · `json()` sin `limit` · `ADMIN_JWT` de post-deploy · fallback silencioso de la curva | Ver pase P-48 | Sin cambio | backend / devops |
| **Carryover** | `@nestjs/core` 2 moderate (salto mayor a Nest 11) · Int32 en columnas de dinero + **MS-2** (agregados sin clamp) · MS-1/MS-4/MS-5 (idempotency-key en shipments/refund, H1 sin espejo en shipment, `?? ''` del webhook secret) · B-1 timing de `forgot-password` · B-2 linking de Google a cuentas privilegiadas · B-5 token en query-string · throttler in-memory | Ver pases v1.5/v1.6 | **Sin cambio en este pase** (superficies no tocadas — diff cero) | devops / backend / frontend / arquitecto |

---

## 7. Banderas para el humano

1. **Pentest de tercero + bug bounty ANTES de mover dinero real. Lo repito y lo subo de tono.** Este
   pase y el del red team son **internos**, y el mío fue **estático + solo lecturas** por la colisión con
   QA. Un negocio de **custodia de bienes ajenos** con **INE y CLABE** y **dinero saliente por SPEI**
   amerita una revisión externa con target vivo y **sin restricción de mutación** antes de la primera
   operación con pesos reales. **No bloquea este release; es prerrequisito del go-live comercial.**
2. **Validación legal de custodia y PII (México).** Retención de INE (180 días), cifrado de CLABE,
   umbral y topes AML: la implementación técnica está donde debe y **este delta no la tocó**, pero los
   **plazos y umbrales son decisiones jurídicas, no de ingeniería**. Un abogado debe ratificarlos.
   **Añado un ángulo nuevo, de S49-M1:** que el ciphertext de una cuenta bancaria salga hacia el rol
   `vault_operator` puede tener lectura de **minimización de datos** bajo la LFPDPPP, además de la
   técnica. Vale la pena preguntarlo.
3. **Las dos Medias tienen una fecha, no una intención.** R1 y S49-M1 quedan aceptadas **solo mientras
   el sistema no guarde PII real**. En el momento en que se capture la primera CLABE o el primer INE de
   un vendedor de verdad, **la aceptación caduca y el veredicto pasa a RECHAZADO** hasta que se cierren.
   Es una decisión del humano **cuándo** abrir el buylist; lo que no es negociable es que esas dos cosas
   ocurran en ese orden.
4. **Cuentas de back-office y Google (carryover B-2, sin cambio).** El linking de Google alcanza cuentas
   `super_admin`. Con dinero real, la seguridad del SPEI pasa a depender también de la seguridad de una
   cuenta de Gmail. Decisión del humano: **MFA obligatorio en back-office**, o restringir el linking a
   `role=customer`.
5. **El árbol se movió otra vez durante este pase** — `455fb8a`, aunque esta vez fue **solo docs** y lo
   verifiqué. Es el patrón que devops describe en §29.11-bis. **Mi veredicto vale para el código de
   `e78ced2`**; si entra **una sola línea** de `backend/src` o `frontend/src` después, este veredicto
   **deja de cubrir el árbol que se despliega** y hay que re-abrir el gate. No es burocracia: dos de los
   hallazgos de este pase (R1 y S49-M1) existen precisamente porque un cambio arregló un endpoint y pasó
   de largo por su vecino de archivo.

---

## 8. Ruteo por rol dueño (resumen accionable)

- **backend** — **R1** (proyectar `updateUserKyc` con la lista blanca de `getUser`) · **S49-M1**
  (proyectar las 4 rutas de `SellRequest`; el destructuring de `buylist.service.ts:933`/`:1073` es la
  respuesta) · **R4** (las 12 restantes del barrido de §2.1) · **R3** (cota superior a
  `floorCents`/`binCents`) · **S49-B1** (sacar `RawCondition` de `enum-values.ts`; anclar cardinalidad
  de los ocho) · **S49-B2** (paginar en BD) · **S48-B3 residual** (`take` + paginación) · S48-I1 ·
  S48-I2 · S49-I1/I2/I3. **Y el fix estructural que cierra la clase:** anotar cada handler con su DTO
  declarado (como `GroupedListingDTO`) y/o un test de residuo tipo `enum-values-parity.spec.ts`.
- **arquitecto** — **R2** (decidir y **normar** el alcance de `priceBasis` por superficie; corregir la
  premisa obsoleta de `API_CONTRACT.md:1929-1931`, que `toPublicPriceInfo` ya invalidó) · **S49-B1**
  (norma: «añadir un valor a un enum de schema **es** cambio de contrato y exige decisión por
  superficie») · **R1 / S49-M1** (declarar el `Res` de `PATCH /admin/users/:id/kyc`,
  `receive`/`verify`/`pay-spei`/`respond` — hoy el contrato solo declara el efecto, y ése es el
  mecanismo raíz de toda esta familia) · carryover Int32/`BigInt`.
- **devops** — **S49-I4** (dar `Write` al rol `pentester` sobre su propio archivo) · S48-I3 (`ADMIN_JWT`
  efímero) · S48-I4 (alerta sobre `[MONEY]`) · S48-I2 (`json({ limit })`) · carryover: bump a NestJS 11,
  throttler con storage compartido, ítem de enums en la plantilla de PR de migraciones.
- **frontend** — **nada nuevo, y con un positivo:** el fail-safe de `useMocks` (§4.5) es una corrección
  de seguridad real. **Verifiqué que la regla §N.7 se cumple** (`CardDetailView.tsx:218`) y que
  `PriceBasisTag` no aparece en superficies de cliente. Carryover **B-5** (token en query-string) sigue
  abierto.

---
---

<!-- ════════════════════════════════════════════════════════════════════════════════════════
     PASE P-48 / v2.0 — «precio puro por valor de mercado» (2026-08-24) — se antepone;
     el contenido histórico (P-38, v1.28, Stream C, etc.) se conserva íntegro abajo.
     ════════════════════════════════════════════════════════════════════════════════════════ -->

# PASE P-48 / v2.0 — la CURVA de precios · 2026-08-24 · VEREDICTO de seguridad

> **Rol:** seguridad (blue team / AppSec). Consolido el pase red team de `docs/PENTEST_NOTES.md`
> («PASE v2.0 / P-48», commit `6657196`), lo cruzo contra el código con criterio propio, añado lo que
> encontré yo y emito el **tercer veredicto** del DoD. **NO corrijo código:** cada hallazgo lleva rol dueño.
> **Delta revisado:** `586f736..HEAD` (44 commits) en la rama `claude/card-pricing-rules-2e537m`.
> **Modo:** revisión **estática dirigida** del delta + **ejecución de las puras del pricing con `ts-node`**
> (`resolveSaleFromCurve`/`resolveBuyFromCurve`/`resolvePendingReason` contra `DEFAULT_PRICING_CURVE`)
> + `npm audit` + barrido de secretos sobre los archivos tocados. **NO levanté el stack HTTP**: los
> `[LIVE]` son del pentester — los tomo como dados y los **cruzo con el código**, no los re-disparo.
> **Fuentes normativas:** `PROJECT.md` §N.7/§N.8 · `docs/ARCHITECTURE.md` §4.36 · `docs/API_CONTRACT.md`
> (`v2.0-pricing-curve` … `v2.1.5`). Regla de conflicto de `CLAUDE.md`: PROJECT manda sobre el contrato,
> el contrato manda sobre el código. La apliqué literalmente para juzgar P48-M1 (ver §2).

## 0. VEREDICTO

# ✅ APROBADO

**0 hallazgos Críticos · 0 Altos.** El DoD exige que no queden críticos ni altos abiertos: se cumple.
Las superficies nuevas de dinero (editor de curva, dry-run, guardarraíl, bounty revalidado,
instrumentación) llegaron **bien construidas**, y las tres garantías que más me preocupaban las verifiqué
una por una y **siguen en pie**: SEC-A1 (rareza derivada en servidor, y solo bloquea — nunca fija monto),
dinero saliente `super_admin`-only y auditado, e invariantes V1–V9 **imponiéndose también en LECTURA**,
que es lo que cierra cualquier vía de escritura alterna (§3.3).

| Severidad | # abiertos (P-48) | IDs |
|---|---|---|
| **Crítica** | 0 | — |
| **Alta** | 0 | — |
| **Media** | 1 | S48-M1 (nuevo, mío) |
| **Baja** | 5 | S48-B1 (=P48-B1) · S48-B2 (=P48-M1 **reclasificado**) · S48-B3 · S48-B4 · S48-B5 |
| Info / higiene | 4 | S48-I1 … S48-I4 |

**Mínimo necesario para aprobar: ya cumplido** (cero críticos/altos). Lo que **haría RECHAZAR** este gate:
que S48-M1 resultara borrar también entradas del eje de compra con dinero de por medio (no lo hace: el
bloqueo del guardarraíl es de ejecución y sobrevive; lo que se pierde es la señal), o que apareciera un
camino de escritura de curva que evadiera V1–V9 en lectura (no existe). **Distinto es el gate de dinero
real**: §5 lista lo que debe cerrarse antes de operar con pesos de verdad, y no es lo mismo que aprobar
este release.

---

## 1. Hallazgo NUEVO de esta revisión

### S48-M1 · [Media] · El cierre de la cola de pendientes es **agnóstico del eje**, pero `premium_at_floor` **no lo es**: un cliente puede borrar en silencio el aviso del guardarraíl de VENTA
- **Categoría:** integridad de un control de seguridad / abuso de flujo por tercero.
- **Ubicación:**
  - `backend/src/modules/pricing/pricing.service.ts:934-947` — `closePendingForVariant` cierra por clave
    `(cardId, productType, gradeKey, finish, cardProductId, sealedProductId, status:'open')`, **sin eje y sin
    razón**. El comentario `:930-932` justifica el agnosticismo: *«la `PriceReference` es COMPARTIDA por
    clave, así que si el mercado resolvió, resolvió para las dos caras»*.
  - `backend/src/modules/pricing/pricing.service.ts:957-988` — `settlePendingForVariant(null, …)` delega ahí.
  - **Disparador alcanzable por cliente:** `backend/src/modules/buylist/buylist.service.ts:638-648`
    (`createRequest` llama al seam por CADA línea con el `pendingReason` del **eje de COMPRA**).
  - **Origen de la entrada:** `backend/src/modules/inventory/inventory.service.ts:1200-1222`
    (`publish-all`/`bulk-publish` escala con el veredicto del **eje de VENTA**).
- **Por qué el argumento del comentario ya no se sostiene:** era cierto con **una sola** razón
  (`no_market`, que sí depende únicamente de la `PriceReference` compartida). v2.0 introdujo una **segunda**
  razón, `premium_at_floor`, que **no** se deriva del dato compartido sino de comparar ese dato contra
  constantes **distintas por eje** — `sale.floorCents` (2500) vs `buy.binCents` (100). Sobre el mismo
  mercado, un eje puede decir `floor` y el otro `market`.
- **Evidencia (ejecuté las puras reales contra el `DEFAULT_PRICING_CURVE` sembrado, rareza canónica
  premium `Secret Rare`):**

  | mercado | VENTA | razón venta | COMPRA | razón compra |
  |---|---|---|---|---|
  | 200 c | `2500` · `floor` | `premium_at_floor` | `100` · `floor` | `premium_at_floor` |
  | **1000 c** | `2500` · **`floor`** | **`premium_at_floor`** | `300` · **`market`** | **`null`** |
  | **1500 c** | `2500` · **`floor`** | **`premium_at_floor`** | `450` · **`market`** | **`null`** |
  | 1900 c | `3500` · `market` | `null` | `570` · `market` | `null` |

- **PoC (encadenado, sin HTTP):** carta de rareza premium con mercado ≈ MX$10 → el dueño corre
  `publish-all` (el runbook de cut-over de ESTE release lo manda, `scripts/post-deploy.sh` paso 4) → la
  pieza **no se publica** y entra a la cola con `reason='premium_at_floor'`. Después **cualquier cliente
  autenticado y con correo verificado** manda esa misma variante en un `POST /buylist/requests`: el eje de
  compra resuelve `basis='market'` ⇒ `pendingReason=null` ⇒ `settlePendingForVariant(null, …)` ⇒ la entrada
  del **eje de venta** queda `status='resolved'`, `resolvedAt=now()`, **indistinguible de una resolución
  legítima** (no se registra quién ni por qué la cerró).
- **Impacto:** se pierde el **aviso**, no el **bloqueo**. El guardarraíl se re-evalúa en cada lectura y
  en cada intento de publicación (`decideSalePrice` sigue devolviendo `pending`), así que la pieza no se
  vende barata y la entrada se **re-abre** al siguiente `publish-all`. Lo que se degrada es la razón de ser
  del mecanismo, escrita en el propio código (`pricing-curve.ts:508`): *«convierte un error de dinero
  silencioso en una COLA VISIBLE»*, y `resolvePendingReason` documenta que `no_market` **se cura sola** pero
  `premium_at_floor` **necesita que el dueño mire**. Es justo la clase que un tercero puede limpiar. Sin
  movimiento de dinero, sin PII, sin escalada de privilegio.
- **Por qué Media y no Alta:** no hay pérdida de dinero ni evasión de un control de ejecución, y el
  disparador exige cuenta autenticada + correo verificado. **Por qué no Baja:** el control afectado es el
  que P-48 introdujo *como* red de seguridad del dinero, el borrado es silencioso y no auditado, y el
  escenario es el del cut-over de este mismo release (≈3 entradas por cada 333 cartas según §4.36.9c-3 —
  una población chica, o sea que perder una es proporcionalmente caro).
- **Rol dueño:** **backend** (que el cierre respete el eje/razón: no dejar que una resolución de compra
  cierre una entrada abierta por venta) + **arquitecto** (decidir si la cola es por-eje — toca schema y
  contrato, zona compartida ⇒ pasa por él antes, regla 9).

---

## 2. Hallazgos del pentester, consolidados con mi criterio

### S48-B2 (= **P48-M1**) · [Media → **BAJA**, alcance reducido] · `PriceInfo.isManualOverride` viaja a clientes anónimos y **no está declarado en el contrato**

**Mi juicio independiente: la mayor parte de P48-M1 la DESCARTO como hallazgo; sobrevive una porción
pequeña y concreta.** El pentester marcó el matiz con honestidad y pidió arbitraje. Aquí está.

**Lo que descarto, y por qué (no es «lo aceptaron», es que está mandado por escrito):**
1. **`priceBasis` en DTO público — NO es fuga.** `PROJECT.md:1140-1145` (§N.7) lo **exige**: *«La señal la
   produce el backend — `priceBasis` … el sistema registra y expone server-side qué determinó el precio …
   La UI no infiere nada: obedece ese dato»*. Y §N.7 se autodefine como regla **de presentación**:
   *«el precio cobrado no cambia por esta regla: es una regla de presentación, no de dinero»*
   (`PROJECT.md:1155`). Un requisito de producto no puede ser a la vez la fuga.
2. **`referenceValue` sin recortar por `basis` — NO es una desviación.** `API_CONTRACT.md:1830-1832` lo
   norma explícitamente: *«`referenceValue` SIGUE viajando en el DTO aunque no se muestre: el mismo DTO
   alimenta superficies admin y de valuación … stripearlo por endpoint haría que `PriceInfo` significara
   cosas distintas según la ruta»*. Por la regla de conflicto, el contrato manda sobre el código y PROJECT
   no lo contradice (§N.7 acota su alcance a **la ficha**, `PROJECT.md:1133-1137`).
3. **El PoC del cotizador (`priceBasis:"floor"` al vendedor) — ratificado por contrato.**
   `API_CONTRACT.md:2004-2008` anticipa **literalmente** el argumento del pentester: *«`priceBasis` de ESTE
   payload es para la LÓGICA del cliente … NO para RENDERIZARLO AL VENDEDOR … sería … filtrar la
   calibración interna: “piso”/“mínimo” le dice al vendedor que su carta tocó el bin. Decisión ratificada»*.
4. **Y el control de presentación está IMPLEMENTADO, no prometido — lo verifiqué:**
   `frontend/src/app/[locale]/(storefront)/catalog/[cardId]/CardDetailView.tsx:218`
   (`showMarketValue = primary?.priceBasis === 'market'`), y `PriceBasisTag` **solo** aparece en superficies
   admin (`VariantPriceConsole.tsx:427,459,501` y `curve/CurvePreview.tsx:253,266`) — cero usos de cara al
   cliente.
5. **`referencePrice` al vendedor ya se pinta a propósito y es PREVIO a P-48:**
   `SellCartContents.tsx:184-187` («Valor de referencia», `frontend/messages/es.json:636`), **sin cambios en
   el delta**; lo que P-48 hizo ahí fue **quitar** la fila «Regla aplicada». O sea: el cambio **redujo** lo
   que el vendedor ve, no lo amplió.
6. `source` y `capturedDate` **sí** están declarados en `PriceInfo` (`API_CONTRACT.md:1762`).

**Lo que SÍ sobrevive como hallazgo (y esto el contrato no lo cubre):**
- **`isManualOverride` no está en el `PriceInfo` del contrato.** `API_CONTRACT.md:1762` declara
  `PriceInfo = { status, referenceMxnCents?, source?, capturedDate? }` — **cuatro** campos. El backend emite
  un quinto: `backend/src/modules/pricing/pricing.service.ts:335`, `:378`, `:430` (y el tipo lo declara en
  `:151-160`). Es un **discriminante interno** nacido en v1.43 para el gate H-1 del sellado, y llega a
  endpoints `@Public` (`GET /catalog/cards`, `/catalog/cards/:id`, `/catalog/listings/:id`).
- **Impacto:** un observador anónimo obtiene, **por carta y a escala de catálogo**, el mapa de qué cartas
  tienen precio **fijado a mano por el admin**. Es inteligencia operativa del negocio; no es dinero, no es
  integridad, no es PII, y el `referenceMxnCents` de al lado deriva de fuentes públicas (TCGplayer/PPT ×
  FX), así que el margen de revelación adicional es el flag, no el número.
- **Precedencia:** es **carryover de v1.43**, no lo introdujo P-48; este pase lo saca a la luz.
- **Severidad: Baja.** Confidencialidad de metadato operativo, sin efecto en dinero.
- **Rol dueño:** **backend** (no proyectar `isManualOverride` fuera de las superficies admin) +
  **arquitecto** (ratificarlo en `PriceInfo` o retirarlo; hoy el código emite un campo que el contrato no
  declara, y eso es lo que hay que cerrar de una forma o de otra).

### S48-B1 (= **P48-B1**) · [**Baja**, confirmado, **alcance ampliado**] · Clave de cadena de prototipos evade el allowlist de `PUT /admin/settings` → 500, escritura parcial **y sin registro en la bitácora**
- **Confirmo la causa raíz por lectura de código.** `backend/src/modules/settings/settings.service.ts:71-99`
  hace `SETTING_DTO_MAP[dtoKey]` sobre un **objeto literal** (`settings.constants.ts:296`), así que
  `__proto__`/`constructor`/`toString` devuelven miembros heredados **truthy** y el rechazo «unknown setting
  key» no dispara; `SETTING_VALIDATORS[settingKey]` sale `undefined` (no valida) y la clave no-string llega
  al `upsert` de Prisma. **Habilitador adicional que añado:** el controller declara
  `@Body() body: Record<string, unknown>` (`settings.controller.ts:28`) — **sin clase DTO**, así que el
  `ValidationPipe({whitelist:true})` de `main.ts:56` no tiene contra qué recortar y **toda** clave del body
  entra al servicio.
- **Lo que añado al hallazgo (dos cosas que no estaban):**
  1. **Se rompe la bitácora, no solo la atomicidad.** `settings.controller.ts:32-41` audita **después** de
     que `update()` retorne; la excepción salta el `audit.log`, así que el dial que **sí** se persistió
     (`ivaPct:7` en el PoC del pentester) queda **sin entrada en `AuditLog`**. Para un endpoint que gobierna
     IVA, comisiones de Stripe, **topes AML del buylist** y el **umbral de INE**, una mutación silenciosa y
     no repudiable es peor que el 500.
  2. **La promesa «todo o nada» del comentario `:58-63` es falsa en general, no solo con `__proto__`.**
     `update()` **no abre `$transaction`**: valida todo y luego escribe en un bucle de `upsert` sueltos
     (`:92-99`). Cualquier fallo a mitad (caída de BD, timeout) deja escritura parcial.
- **Mantengo Baja:** es `super_admin`-gated (`settings.controller.ts:12-13`), no hay prototype pollution
  real (`JSON.parse` crea `__proto__` como propiedad de datos), no hay escalada. Pero con **disparador
  duro**: cerrarlo antes de operar con dinero real (§5) — el registro de cambios de configuración de dinero
  es control de cumplimiento en un negocio de custodia, no cosmética.
- **Rol dueño:** **backend** (`Object.hasOwn`/`Map`/`Object.create(null)`; envolver las escrituras en
  `$transaction`; auditar **antes** o dentro de la transacción; y de paso, una clase DTO en el `@Body`).

---

## 3. Lo que verifiqué yo (defensa) — y lo que encontré de paso

### 3.1 SEC-A1 con la firma nueva del seam: **intacto**
`rarityCanonical` entra al guardarraíl **siempre desde la BD**, en los cuatro seams:
`catalog.service.ts:313`, `buylist.service.ts:408`, `inventory.service.ts:1203`,
`variant-controls.service.ts:336` — todos `item.card.rarityCanonical ?? item.card.rarity`. La columna solo
la escribe el **sync de catálogo** (admin), derivada con `normalizeRarity`
(`catalog-sync.service.ts:119-120`, `:899`); **ningún DTO de cliente la acepta**. Y el diseño está protegido
por tipos, no por disciplina: `decideSalePrice` declara `rarityCanonical` **obligatoria a propósito**
(`pricing.service.ts:1372-1376`), y `premiumFloorGuard` (`pricing-curve.ts:515-517`) devuelve un veredicto,
**nunca centavos** — la rareza solo puede **suprimir** el precio, jamás fijarlo. **Ningún camino deja que el
cliente influya en el veredicto.**
- **Excepción de higiene → S48-I1** (abajo): `composeVariantPricing` sí tiene un default fail-open.

### 3.2 Dinero saliente: **no se movió**
`git diff 586f736..HEAD` tiene **diff cero** en `backend/src/modules/payments/`, `shipments/`, `disputes/`,
`auth/`, `users/`, `uploads/`, `common/crypto/`, `common/guards/`, `common/decorators/`, `main.ts` y
`app.module.ts`. Los tres `@MoneyOut()` siguen donde deben (`admin-orders.controller.ts:212` refund;
`admin-buylist.controller.ts:80` reveal-clabe, `:197` pay-spei) y `MoneyOutGuard` **audita el intento
bloqueado antes de lanzar el 403**. `paySpei` (`buylist.service.ts:1549-1585`) paga contra el
`clabeSnapshotEnc` **cifrado de la propia solicitud del usuario**, con transición atómica
(`updateMany` + `count===1`) e idempotencia si ya está `pagada`. **CLABE cifrada, INE con retención y SPEI a
cuenta propia: caminos no tocados por este cambio** — lo digo como hecho verificado por diff, no como
suposición.

### 3.3 V1–V9 como control de seguridad: **no hay vía de escritura que los evada**
Audité las cuatro vías posibles:

| Vía | ¿Pasa por V1–V9? | Evidencia |
|---|---|---|
| `PUT /admin/pricing/curve` | **Sí, completo** | `pricing.controller.ts:260-263` usa `collectCurveViolations(dto)[0]` ⇒ rechaza **cualquier** infracción, bloqueante o no |
| `PUT /admin/settings` | **No alcanza la clave** | `PRICING_CURVE` no está en `SETTING_DTO_MAP` (`settings.constants.ts:296-325`) ⇒ 422 |
| `prisma/seed.ts` | Constante, `create-only` | `seed.ts:43-49` (`update: {}`, no pisa lo editado) con `DEFAULT_PRICING_CURVE`, cuya validez asegura la suite (`pricing-curve.spec.ts:256`, `:748`) |
| Backfill / import / migración | **No existe** | `backfill-p34-tiered-pricing.ts` **borrado**; `migration.sql` de M-41 es aditiva pura; `post-deploy.sh` **no escribe curva** (lo declara en su cabecera) |
| **Edición directa en BD** | **Cubierta en LECTURA** | `loadPricingCurve` (`pricing.service.ts:590-600`) → `sanitizePricingCurve` (`pricing-curve.ts:1143-1151`) → `validatePricingCurve` = `collectCurveViolations(...)[0]` = **V1–V9 íntegros** ⇒ cae al seed |

**Conclusión fuerte:** los invariantes se imponen **también al leer**, así que **ninguna** vía de escritura
—incluido acceso directo a la BD— puede poner en producción una curva que pierda dinero. Es la decisión de
diseño más sólida del cambio y quiero dejarla escrita.
**Salvedad honesta:** el fallback es **silencioso** salvo un `logger.error('[MONEY] …')`
(`pricing.service.ts:594-597`). No hay alerta, ni señal de health, ni aviso en el back-office. Quien
corrompa (o fat-fingueé) la fila cambia **toda la política de precios a la curva semilla** y nadie se entera
salvo leyendo logs → **S48-I4**, dueño devops.

### 3.4 Instrumentación (§N.8): la asimetría venta/compra está **bien resuelta del lado del comprador**
El contrato manda que la instrumentación sea **solo back-office** en el eje de venta
(`API_CONTRACT.md:5911-5916`: *«La línea del pedido del CLIENTE … NO cambia»*). **Se cumple:**
`orders.service.ts:773-777` proyecta únicamente `inventoryItemId`/`card`/`unitPriceCents`, y el IDOR está
cerrado (`:758`, `order.userId !== userId` ⇒ 403). Del lado de compra, `SellItemDTO` **sí** declara
`marketMxnCents`/`priceBasis`/`marketBracket` (`API_CONTRACT.md:5905-5907`) y `itemDTO`
(`buylist.service.ts:836-840`) los emite al vendedor en `listMine`/`getMine`: **conforme al contrato**, pero
es una asimetría deliberada que conviene que el arquitecto reconfirme, porque el razonamiento de §N.7
(«no le digas al vendedor que su carta tocó el fondo») aplica **más** al vendedor que al comprador. Lo dejo
como **bandera**, no como hallazgo: está declarado y no lo voy a inventar como fuga.

### 3.5 Hallazgos menores propios

**S48-B3 · [Baja] · El reporte de instrumentación carga TODAS las líneas en memoria, sin cota ni paginación.**
`backend/src/modules/admin/admin.service.ts` (`pricingBrackets`, `:766-838`): dos `findMany` **sin `take`**
y con rango de fechas **opcional**; sin `from`/`to` trae **todos** los `OrderItem` de órdenes liquidadas y
**todos** los `SellRequestItem` de solicitudes pagadas, y agrega en memoria de la app. Además `range()`
(`admin.service.ts:19-22`) **no valida** las fechas: `new Date('basura')` → `Invalid Date` → Prisma lanza →
500. `super_admin`-only ⇒ solo disponibilidad (un reporte descuidado tumba la API para todos), sin dinero.
**Dueño: backend** (cota + paginación, y validar `from`/`to`).

**S48-B4 · [Baja] · P-48 amplía el conjunto de líneas que suman $0 a los topes AML del buylist.**
El guardarraíl nuevo hace que `premium_at_floor` devuelva `quotedPriceCents=null` en el eje de compra
(`buylist.service.ts:409`), y una línea sin monto **suma 0** a `quotedTotalCents`
(`buylist.service.ts:649`), que es la base del **tope por solicitud** (`:679`), del **tope mensual**
(`:736`) y del **umbral de INE** (`:700`). Antes de P-48 esa carta cotizaba por regla de rareza y **sí**
contaba. **Controles compensatorios que verifiqué y funcionan:** cualquier línea pendiente **fuerza INE**
(`:699-705`, Fase 0.3), y la aprobación está acotada por `assertApprovedPriceWithinCap`
(`:1094-1111`) — que además **cierra el carryover B-4** del pase v1.5. **Hueco residual:** ese tope es el
**por solicitud**; el **mensual nunca se re-verifica** contra `approvedTotalCents`, así que lo aprobado por
encima de lo cotizado no vuelve a topar en el mes. No es un bypass automático (exige aprobación humana ítem
por ítem y el SPEI sigue siendo `super_admin`), pero **es una consecuencia real del delta sobre un control
AML** y por eso la reporto en vez de darla por «fuera de alcance».
**Dueño: backend** (re-chequear el tope mensual al aprobar/pagar) + **humano/arquitecto** (política AML, §4).

**S48-B5 · [Baja] · `createRequest` escribe y cierra la cola ANTES de los topes, del gate de INE y fuera de la transacción.**
`settlePendingForVariant` se llama **dentro del bucle de ítems** (`buylist.service.ts:638`), mientras que el
tope por solicitud está en `:679`, el gate de INE en `:701` y la transacción `Serializable` en `:733`. Una
solicitud que termina en **422** ya dejó (o cerró) entradas en la cola del dueño. La dedupe por variante
(`pricing.service.ts:895-901`) acota el volumen y `context='buylist'` registra procedencia, así que el techo
es bajo — pero es una escritura de tercero en una cola de back-office que ocurre **antes** de que se validen
las puertas que el endpoint documenta. Es el mismo call-site que S48-M1. **Dueño: backend.**

### 3.6 Info / higiene (no son hallazgos)
- **S48-I1 · Default fail-open en el parámetro del guardarraíl.**
  `backend/src/modules/pricing/variant-pricing.ts:86` — `composeVariantPricing(…, rarityCanonical = null)`:
  un llamador que lo **omita** obtiene `premiumFloorGuard → 'ok'` en silencio (nunca `premium_at_floor`).
  Hoy **los dos** llamadores lo pasan (`variant-controls.service.ts:336`,
  `master-set.service.ts:813-818`), así que no hay exposición. Contrasta con `decideSalePrice`, donde el
  campo es **obligatorio a propósito** por esta misma razón. Recomiendo volverlo obligatorio. *Backend.*
- **S48-I2 · El `PUT` de la curva persiste claves extra dentro de los puntos y no acota su número.**
  `normalizePricingCurve` (`pricing-curve.ts:1125-1138`) reconstruye el **nivel superior** pero copia los
  objetos-punto por referencia, así que `{marketCents, multiplierBp, loQueSea}` se guarda verbatim en el
  JSON; y V1 exige `≥1` punto **sin techo**. Inerte (los lectores solo leen campos conocidos; `JSON.parse`
  no contamina prototipos) y acotado en la práctica por el límite de 100 kB por defecto de `json()`
  (`main.ts:53`, sin `limit` explícito). `super_admin`-only. *Backend / devops (fijar `limit` explícito).*
- **S48-I3 · `ADMIN_JWT` del post-deploy.** `scripts/post-deploy.sh` lo pasa por `curl -H` (visible en el
  `argv` del proceso); el script **nunca lo imprime** y **enmascara** el `DATABASE_URL` (`:80`), y
  `publish-all` exige **opt-in explícito** (`RUN_PUBLISH_ALL=1`) — higiene correcta. La observación es de
  ciclo de vida: si ese JWT se guarda como variable persistente de Railway se vuelve una **credencial
  `super_admin` permanente** fuera del flujo de auth. *devops (TTL corto, emitir y desechar por corrida).*
- **S48-I4 · El fallback money-safe de la curva no alerta.** Ver §3.3. *devops (alerta sobre `[MONEY]`).*
- **Nits del pentester (falta de token → 422 en vez de 401; `preview` → 201 en vez de 200):** confirmo que
  son **contrato, no seguridad**. *Backend.*

### 3.7 Defensas confirmadas (verificadas por mí, no solo heredadas)
1. **Authz de las superficies nuevas.** `@Roles(super_admin)` a nivel clase (`pricing.controller.ts:124`) y
   **ninguna** ruta de curva la debilita ni lleva `@Public` (grep: solo `:124` y `:462` en todo el archivo);
   `RolesGuard` es estricto y **sin jerarquía** (`roles.guard.ts`, `!required.includes(user.role)` → 403).
   El reporte de brackets también es `super_admin` (`admin.controller.ts:248-251`) y valida `axis`
   (`:264-275`).
2. **El `preview` no autoriza nada.** `previewCurve` (`pricing.service.ts:618-649`) solo lee/computa; la
   autoridad del dinero es el `PUT`, que **re-valida desde cero** (`pricing.controller.ts:260`). Coincido
   con el pentester y lo confirmo en código.
3. **Sin superficie SQL nueva:** cero líneas `$queryRaw*` **añadidas** en todo el delta del backend;
   `orders.service.ts:283` sigue con tagged template sin entrada de cliente.
4. **Publicación atómica:** `claimListed` (`inventory.service.ts:1242-1256`) transiciona con `updateMany` +
   allowlist de estado en el mismo UPDATE ⇒ TOCTOU cerrado, anti doble-venta intacto.
5. **Migración M-41: aditiva, nullable, sin PII** (3 enums + 8 columnas + 1 índice; nada de
   email/nombre/CLABE/INE/dirección). Confirmo el positivo #6 del pentester leyendo el `.sql`.
6. **Cotas de dinero en los overrides por variante:** entero positivo `≤ MAX_CENTS`
   (`variant-controls.service.ts:69-71`), y el gate del bounty se endureció de `<` a `<=` contra la curva
   vigente (`:295-317`).
7. **Cabeceras/CORS/pipes sin regresión:** `helmet()` (`main.ts:42`), allow-list de CORS nunca `origin:true`
   (`:61-62`), `ValidationPipe({whitelist:true})` (`:56`), `trust proxy` (`:39`) — **diff cero** en el delta.
8. **Dependencias (corrido hoy):** backend runtime **2 moderate, 0 high, 0 critical** (`@nestjs/core`
   GHSA-36xv-jgw5-4q75, arrastra `@nestjs/platform-express`; el fix exige salto mayor a NestJS 11) ·
   frontend prod **0 vulnerabilidades**. **Secretos:** barrido sobre **todos** los archivos cambiados del
   delta ⇒ **cero** credenciales hardcodeadas.

---

## 4. No verificado / fuera de mi alcance (dicho, no asumido)

Esta es la disciplina que el equipo viene arrastrando y la mantengo: **prefiero una brecha escrita que una
garantía inventada.**

- **No levanté el stack HTTP.** Mi pase es estático + ejecución de las funciones **puras** del pricing con
  `ts-node`. Todo `[LIVE]` de este documento es del pentester; lo crucé contra el código, **no lo re-disparé**.
- **Concurrencia y carreras: NO probadas.** Mi juicio sobre si son ajenas al delta, que es lo que se me pidió:
  - **Webhook de Stripe (forja/replay) y reserva de checkout (doble gasto): genuinamente FUERA.**
    No es una opinión: `backend/src/modules/payments/` tiene **diff cero** en `586f736..HEAD` y `reserveItems`
    no aparece en el diff de `orders.service.ts`. El pentester acierta.
  - **Tope mensual de buylist: NO está fuera.** El eje de compra se reescribió entero y el cambio toca
    **qué suma al tope** (S48-B4), aunque la transacción `Serializable` (`buylist.service.ts:733-757`) siga
    idéntica byte a byte. La **carrera** en sí sigue **sin probarse**; lo que reporto es el cambio de
    *superficie*, no una carrera nueva.
- **SSRF: sin vector nuevo.** El dry-run es CPU puro sobre aritmética entera y no agrega ningún fetch
  server-side desde input del cliente. Coincido con el pentester.
- **No corrí DAST ni el gate SAST de CI** en esta sesión.
- **No verifiqué el throttler en multi-instancia.** Sigue con storage **in-memory**
  (`app.module.ts:38`, el propio comentario `:37` lo admite) ⇒ en N réplicas el límite efectivo se multiplica
  por N. Carryover de devops, no del delta.
- **No re-audité** la matemática de la curva ni la cobertura de tests (QA y techlead ya la aprobaron; mi
  lente fue authz, manipulación, fuga y abuso de flujo).

---

## 5. Deuda de seguridad ACEPTADA (no bloqueante) — con disparador

| ID | Tema | Impacto | Disparador para abordarla | Dueño |
|---|---|---|---|---|
| S48-B1 | Bypass de allowlist + escritura parcial **sin auditar** en `PUT /admin/settings` | No repudio de cambios de config de dinero (IVA, fees, topes AML, umbral INE) | **Antes de operar con dinero real** (control de cumplimiento en custodia/AML) | backend |
| S48-B2 | `isManualOverride` no declarado, visible a anónimos | Inteligencia operativa (qué cartas llevan precio fijado a mano) | Al primer indicio de scraping competitivo, o en la próxima revisión de `PriceInfo` por el arquitecto | backend + arquitecto |
| S48-B3 | Reporte de brackets sin cota ni validación de fechas | Disponibilidad (OOM/500 en un reporte admin) | Cuando el histórico supere unas decenas de miles de líneas, o antes si el reporte se automatiza | backend |
| S48-B4 | Líneas pendientes suman $0 a los topes AML | El tope mensual puede sub-contar lo realmente pagado | **Antes de operar con dinero real** (es un control AML) | backend + humano |
| S48-B5 | Escritura en la cola antes de topes/INE y fuera de la tx | Ruido de tercero en una cola de back-office | Junto con S48-M1 (mismo call-site) | backend |
| S48-I1 | Default fail-open del parámetro del guardarraíl | Latente (hoy cero llamadores expuestos) | Al añadir un tercer llamador de `composeVariantPricing` | backend |
| S48-I2 | Claves extra y puntos sin techo en la curva | Basura persistida; coste CPU acotado por el body limit | Al fijar `limit` explícito en `json()` | backend/devops |
| S48-I3 | `ADMIN_JWT` de post-deploy | Credencial `super_admin` potencialmente permanente | Antes del primer deploy a producción con dinero real | devops |
| S48-I4 | Fallback silencioso de la curva | Cambio de toda la política de precios sin aviso | Con el primer alerting real de la plataforma | devops |
| **Carryover** | `@nestjs/core` 2 moderate (salto mayor) · Int32 en columnas de dinero (`MAX_CENTS`) · MS-1/MS-4/MS-5 (idempotency-key de shipments/refund, H1 sin espejo en shipment, `?? ''` del webhook secret) · B-1 timing forgot-password · B-2 linking Google a cuentas privilegiadas · B-5 token en query-string · throttler in-memory | Ver pases v1.5/v1.6 | Sin cambio en este pase (superficies no tocadas) | devops / backend / frontend / arquitecto |

**Carryover CERRADO en este delta (lo verifiqué):** **B-4 del pase v1.5** (`approvedPriceCents` del buylist
sin cota, fijable por `vault_operator`) ⇒ **cerrado** por `assertApprovedPriceWithinCap`
(`buylist.service.ts:1094-1111`), que aplica `min(quoted × factor, cap AML)` en `approve` **y** en `adjust`.

---

## 6. Banderas para el humano

1. **Pentest de tercero + bug bounty antes de mover dinero real.** Este pase y el del red team son
   internos y **estáticos en su mayor parte**. Un negocio de **custodia de bienes ajenos** con PII
   sensible (INE, CLABE) y dinero saliente por SPEI amerita una revisión externa con target vivo antes
   de la primera operación con pesos reales. No es un bloqueo de este release; es un prerrequisito del
   go-live comercial.
2. **Validación legal de custodia y PII (México).** Retención de INE, cifrado de CLABE, umbral y topes
   AML: la implementación técnica está donde debe (y este cambio **no la tocó**), pero **los umbrales y
   plazos son decisiones jurídicas, no de ingeniería**. Que un abogado los ratifique — en particular a la
   luz de **S48-B4**: hoy una línea sin cotizar **no consume tope mensual**, y ésa es una decisión con
   lectura regulatoria, no solo de producto.
3. **Cut-over de P-48: revisen la cola después de publicar.** El runbook (`post-deploy.sh` paso 5) ya
   manda mirar `counts.premium_at_floor` (≈3 por cada 333 cartas). Con **S48-M1** abierto, esa lectura
   hay que tomarla **inmediatamente después del `publish-all`** y no días más tarde: la actividad normal
   de vendedores puede haber cerrado entradas legítimas en el intervalo.
4. **Asimetría comprador/vendedor de la instrumentación (§3.4).** El comprador no ve `marketMxnCents`;
   el vendedor **sí**, en sus propias solicitudes. Está en el contrato y lo respeto, pero merece un «sí,
   a propósito» explícito del arquitecto y del PO, porque el razonamiento de §N.7 apunta al revés.
5. **Cuentas de back-office y Google.** Carryover B-2: el linking de Google alcanza cuentas
   `super_admin`. En el momento en que exista dinero real, la seguridad del SPEI pasa a depender de la
   seguridad de una cuenta de Gmail. Decisión del humano: MFA obligatorio en back-office, o restringir el
   linking a `customer`.

---

## 7. Ruteo por rol dueño (resumen accionable)

- **backend:** S48-M1 (cierre de cola por eje) · S48-B1 (allowlist + transacción + auditar antes) ·
  S48-B2 (no proyectar `isManualOverride` en público) · S48-B3 (cota y validación en el reporte) ·
  S48-B4 (re-chequeo del tope mensual al aprobar/pagar) · S48-B5 (orden de gates en `createRequest`) ·
  S48-I1 (parámetro obligatorio) · S48-I2 · nits de contrato (401/200).
- **arquitecto:** S48-M1 (¿la cola es por eje? schema + contrato) · S48-B2 (`PriceInfo`: ratificar o
  retirar `isManualOverride`) · §3.4 (asimetría de instrumentación) · carryover Int32/`BigInt`.
- **devops:** S48-I3 (`ADMIN_JWT` efímero) · S48-I4 (alerta sobre `[MONEY]`) · S48-I2 (`json({limit})`) ·
  carryover: bump a NestJS 11, throttler con storage compartido.
- **frontend:** nada nuevo en este pase. **Lo verifiqué y cumple** la regla de visibilidad §N.7
  (`CardDetailView.tsx:218`) y no expone `priceBasis` en superficies de cliente. Carryover B-5 sigue abierto.

---
---

<!-- ════════════════════════════════════════════════════════════════════════════════════════
     PASE P-38 — SealedProduct + precio manual de sellado (2026-08-23) — se antepone;
     el contenido histórico (v1.28, Stream C, etc.) se conserva íntegro abajo.
     ════════════════════════════════════════════════════════════════════════════════════════ -->

# PASE P-38 — Precio manual de sellado (fix `d408769`) · 2026-08-23 · VEREDICTO de seguridad

> **Rol:** seguridad (blue team / AppSec). Consolido el RE-TEST del pentester (`docs/PENTEST_NOTES.md`,
> «RE-TEST FOCALIZADO — P-38 … fix d408769») contra el código, valido cada cierre con mi propio análisis
> y emito veredicto. **NO corrijo código:** cada residual se rutea a su rol dueño.
> **Modo:** revisión **estática** dirigida de `inventory.service.ts`, `pricing.service.ts`,
> `audit.service.ts`, `dto/inventory.dto.ts` + suite jest del pentester (verde: 50/50 specs de sellado,
> 321/321 en inventory+pricing+audit). Sin stack HTTP vivo → live-fire por endpoint = [PoC-pendiente-DAST].
> **Commit revisado:** `d408769` (H-1 atomicidad + H-2 exigir sealedProductId + M-2 cap acquisitionPct).

## 0. Resumen ejecutivo

**Los 2 ALTOS (H-1, H-2) y el M-2 del path de precio manual de sellado están CERRADOS y lo confirmo por
revisión independiente. SIN Críticos ni Altos abiertos. → VEREDICTO: APROBADO.** El patrón deferred-write
del override es atómico y sin camino residual de auto-commit; el gate de identidad por `sealedProductId`
validado impide anclar dinero a un productId arbitrario del cliente; las cotas anti-overflow/anti-abuso
están en su lugar. El `tx?` opcional añadido a `pricing.manualOverride`/`audit.log` no abrió otro hueco.

| Severidad | # ABIERTO (P-38) | Estado |
|---|---|---|
| **Crítica** | 0 | — |
| **Alta** | 0 | **H-1 y H-2 CERRADOS** (verificados en código + tests) |
| **Media** | 0 nuevos | **M-2 CERRADO**; M-1 (residual de negocio) = **riesgo aceptado-auditado**; deps = carryover |
| **Baja** | 0 nuevos | L-1/L-2 previos sin cambio (abiertos, no bloqueantes) |

## 1. Cierres verificados (revisión estática independiente)
- **H-1 (atomicidad) CERRADO:** `resolveSealedMarketForAlta` solo valida y devuelve descriptor;
  `applySealedManualOverride(ov, actorUserId, tx)` exige `tx` y escribe override+audit dentro de la tx;
  `createItem`/`batchCreate` envuelven creación+override en `$transaction` con el override **tras** crear la
  pieza; `pricing.manualOverride`/`audit.log` usan `tx ?? this.prisma` en **ambas** escrituras. Sin huérfano.
- **H-2 (identidad) CERRADO:** gate `manualMarketMxnCents != null && sealedProductId == null → 422`;
  `sealedProductId` solo no-null desde `SealedProduct` activo; ids sueltos del cliente ignorados (SEC-A1).
- **M-2 CERRADO:** `@Max(MAX_APORTACION_PCT=100)` en las 3 DTO (cierra también R-2 de v1.28).
- El `tx?` opcional no debilitó otros llamadores (`PricingController.override` conserva auto-commit).
- Higiene (no hallazgo): `manualMarketMxnCents` sin `@Min` a nivel DTO; el gate de servicio `>0` lo cubre.

## 2. M-1 residual — RIESGO ACEPTADO-AUDITADO
Decisión del humano (v1.39.1): precio manual de sellado por `vault_operator+`. Aceptado con controles
compensatorios verificados (H-1/H-2 cerrados, `@Max(100M)`, `@Max(100)` acquisitionPct, `>0`, «solo llena
hueco null / jamás pisa mercado vivo», auditoría `inventory.sealed_manual_market`, sin cash-out — el dinero
saliente sigue siendo money-out `super_admin`). **Endurecimiento recomendado (no bloqueante):** banda de
cordura relativa al mercado comparable + revisión periódica del log de overrides; elevar a 4-ojos ante
primer indicio de abuso. Dueño: backend (banda) / seguridad (monitoreo).

## 3. Carryover no bloqueante (0 críticos/altos) — ruteado
deps `@nestjs/core` (Media, devops), L-1 imagen display sin sanitizar (backend/frontend), L-2 dial off
reescribe override (backend), B-1 timing forgot-password (backend), B-2 linking Google a privilegiadas
(backend), B-5 token en query-string (frontend), R-3 lectura de estrategia por vault_operator (diseño),
MS-1/MS-2 idempotency shipments/refund (backend), B-3 Int32 (arquitecto).

## 4. Banderas para el humano
- **Pre-dinero-real (no bloqueante de P-38):** DAST en staging autorizado del alta de sellado por HTTP
  (con/ sin `sealedProductId`, y fallo de BD a mitad del `$transaction` verificando cero override huérfano)
  + concurrencia de checkout de sellado único. Antes de operar dinero real a escala: pentest de tercero.
- **PII/custodia:** validaciones legales de custodia + INE/CLABE (AML SPEI) siguen siendo bandera legal del
  humano; P-38 no las toca.

## 5. VEREDICTO DE SEGURIDAD de P-38 — **APROBADO**
0 Críticos · 0 Altos · 0 Medios nuevos · 0 Bajos nuevos. Umbral DoD cumplido (sin críticos/altos abiertos).
**Mínimo para mantener el APROBADO:** ningún cambio futuro reintroduce escritura del override fuera de la tx,
ni acepta `manualMarketMxnCents` sin `sealedProductId` validado, ni retira las cotas `@Max`. Cualquier
cambio a `inventory`/`pricing`/`audit` o al contrato re-abre este gate.

— SEGURIDAD (blue team / AppSec), 2026-08-23

<!-- ════════════════════════════════════════════════════════════════════════════════════════
     PASE v1.28 — RELEASE (2026-08-21) — se antepone; el contenido histórico se conserva íntegro abajo.
     ════════════════════════════════════════════════════════════════════════════════════════ -->

# PASE v1.28 — RELEASE (Streams A v1.27 + B v1.28/v1.28.1 + P-21 rebrand) · 2026-08-21 · VEREDICTO de seguridad

> **Rol:** seguridad (blue team / AppSec). Consolido `docs/PENTEST_NOTES.md` (sección «PASE v1.28 — RELEASE», 2026-08-21) contra el código de `main` (rama `claude/backend-e2e-payment-fixtures-77mo4t`). Reviso la defensa, valido/refuto cada hallazgo ofensivo con mi propio análisis, y emito veredicto. **NO corrijo código:** cada hallazgo se enruta a su **rol dueño**.
> **Modo:** revisión **estática** de código (lectura dirigida) + `npm audit --omit=dev` + `git grep` de secretos/patrones + `git ls-files`. Sin stack vivo (Docker daemon ausente, Postgres `:5432` no responde) → los vectores que exigen webhook/checkout/concurrencia real quedan **[PoC-pendiente-de-target — DAST]**; los verificados por lectura = **[Verificado-estático]**.
> **Alcance del release:** superficie NUEVA — M-30 `variant-controls` (consola de precios compra/venta/bounty), `publish-all` (P-19), bounty P-22, aportación a valor de mercado (P-19), precedencias de precio, rebrand P-21 (`envOr`/`MAIL_FROM`/CORS/guardia DAST por host) + **regresión** de los guardarraíles de dinero (H1/H2/H3, MoneyOutGuard, firma Stripe, KYC/INE cifrado) tras los tres streams.

## 0. Resumen ejecutivo del pase

**La superficie NUEVA de dinero llegó money-safe y bien autorizada. SIN hallazgos Críticos ni Altos.** Cada camino de dinero nuevo (variant-controls, publish-all, bounty) **deriva el precio server-side**, gatea la **escritura** tras `@Roles(super_admin)`, es **idempotente** (guardia `count===1` en `$transaction`) y **auditado**; la precedencia `bounty > override > regla > PRICE_PENDING` **jamás inventa un precio** (devuelve `null`/pending, nunca $0/negativo), y los overrides buy/sell/bounty pasan por `assertCents` (entero, `>0`, `<= MAX_CENTS` Int32) ⇒ sin negativos, overflow ni moneda distinta de MXN. El rebrand P-21 **no abrió superficie** (CORS sigue en allow-list, `envOr` sanea sin interpolar input de usuario, guardia DAST decide por host).

**Consolidación de los 3 hallazgos del pentester (R-1, R-2, R-3): los CONFIRMO todos [Verificado-estático], con la severidad final que el red team asignó.** Ninguno es bloqueante: R-1 es Media de dependencias (carryover, no alcanzable), R-2 y R-3 son Bajas de defensa-en-profundidad **acotadas al rol back-office** (`vault_operator`), sin cash-out, sin overflow de columna, sin fuga de PII. **Ratifico R-3 como aceptación de diseño** (la lectura de estrategia de precios por `vault_operator` es consistente con ARCHITECTURE §4.26b; recomiendo omitir `pricing.buy`/`bounty` para ese rol como endurecimiento no bloqueante).

**Regresión de dinero: sin debilitamiento tras los tres streams.** Verifiqué en código: orden de guards correcto (`app.module.ts:66-70`), MoneyOutGuard global con `@MoneyOut()` en refund/pay-spei/recompra, firma Stripe `constructEvent`, idempotencia por `event.id`, reserva atómica anti doble-venta, KYC/INE AES-256-GCM + HMAC, sin `$queryRawUnsafe` con input de cliente, sin secretos hardcodeados ni `.env` versionado.

**→ VEREDICTO: APROBADO** (0 críticos / 0 altos abiertos; deuda Media/Baja aceptada y ruteada — ver §4/§6).

| Severidad | # ABIERTO (release) | Estado |
|---|---|---|
| **Crítica** | 0 | — |
| **Alta** | 0 | — |
| **Media** | 1 | R-1 (deps `@nestjs/core`, carryover, no alcanzable — aceptada, dueño devops) |
| **Baja** | 2 | R-2 (`acquisitionPct` sin `@Max`), R-3 (lectura de estrategia de precios a `vault_operator`) — aceptadas |
| **Info/positivo** | 8 | R-4 … R-11 (defensas de la superficie nueva, verificadas) |

## 1. Consolidación de hallazgos del pentester — validación independiente

Cada hallazgo cruzado contra el código; coincido con el red team en los tres.

### R-1 (Media) — Deps: 2 `moderate` de `@nestjs/core` (carryover M-1) · **CONFIRMADO · aceptado**
- **Mi verificación:** corrí `npm audit --omit=dev` en `backend/` (2026-08-21): **2 moderate, 0 high, 0 critical** — `@nestjs/core <=11.1.17` **GHSA-36xv-jgw5-4q75** (Improperly Neutralizes Special Elements / Injection), que arrastra `@nestjs/platform-express`; `fix` = bump mayor a `@nestjs/core@11.2.1` (**breaking**). frontend prod: sin cambios (histórico: 0 vulns).
- **Alcanzabilidad:** el aviso corresponde a la inyección SSE ya analizada en revs previas; `git grep` histórico de `@Sse|MessageEvent|text/event-stream` en `backend/src` = 0 coincidencias → **el backend no expone SSE → no alcanzable**. Sin cambio en el release.
- **Decisión:** **aceptado como deuda no bloqueante** (Media por herramienta, efectiva Baja por no-alcanzable). **Dueño: devops.** **Disparador:** próxima ventana de mantenimiento de deps, o **antes** de introducir cualquier endpoint SSE; gate `npm audit` en CI/SAST ya previsto.

### R-2 (Baja) — `acquisitionPct` sin `@Max` en las 3 DTO de alta/ajuste · **CONFIRMADO · aceptado**
- **Mi verificación (leída):** `backend/src/modules/inventory/dto/inventory.dto.ts` — `CreateItemDto:59`, `BatchInventoryItemInput:113`, `AdjustmentFoundItemInput:187` declaran `@IsOptional() @IsInt() @Min(0) acquisitionPct?` **sin `@Max`**. Contrasta con `listPriceCents` (misma DTO) que sí lleva `@Max(MAX_LIST_PRICE_CENTS)`. Consumo: `inventory.service.ts` → `computeAportacionCostCents` (`common/money.ts` = `clampCents(round(ref*pct/100))`).
- **Análisis de impacto:** un `pct` gigante satura el costo-base a `MAX_CENTS` (~MX$21.47M) vía `clampCents` — **recorte silencioso, sin log/AuditLog** (misma clase que MS-3 histórico). Alimenta costo/P&L/valuación (StatCards). **No es cash-out** (el costo-base no sale de la caja; el dinero saliente sigue siendo money-out super_admin), **no** desborda columna (clampCents lo contiene en Int32), y requiere **rol back-office** (`vault_operator`). Es variante de B-4 histórico.
- **Decisión:** **aceptado como deuda no bloqueante (Baja).** **Dueño: backend** (añadir `@Max` razonable — p.ej. `@Max(10000)` = 100.00% con 2 decimales, o el tope de negocio — + emitir alerta/AuditLog al recortar en `computeAportacionCostCents`). **Disparador:** al endurecer el flujo de inventario/aportación, o antes de reportes financieros con datos de escala.

### R-3 (Baja) — El binder scope `platform` expone la CONSOLA de estrategia de precios (buy override + bounty) al `vault_operator` · **CONFIRMADO · aceptado (ratificación de diseño)**
- **Mi verificación (leída):** `GET /admin/inventory/master-sets/:setId` → `masterSetBinder` (`inventory.controller.ts:74-77`) llama `masterSetService.binder(setId)` **sin scope** → default `{ kind: 'platform' }` (`master-set.service.ts:408`). El controller es `@Roles(Role.vault_operator, Role.super_admin)` (`:45-46`). En scope `platform` el binder adjunta `pricing?` por variante (`master-set.service.ts:472-478`, `includePricing = scope.kind === 'platform'`), que compone `buy.overrideCents/effectiveCents` y el bloque `bounty` vía `composeVariantPricing`. **La ESCRITURA sí está blindada** super_admin-only (`PricingController @Roles(Role.super_admin)`, `pricing.controller.ts:106`); lo que fuga es la **LECTURA** de márgenes de compra/bounty a un rol de bóveda.
- **Análisis de impacto:** sin PII, sin cash-out, sin escalada de privilegio (el `vault_operator` no puede escribir precios/overrides/bounty). Es exposición de **inteligencia de negocio** (estrategia de compra) a un rol que opera M1/M4/M5-hasta-verificación. Consistente con el diseño del binder platform (ARCHITECTURE §4.26b), pero el principio de mínima exposición sugiere omitir `pricing.buy`/`bounty` para `vault_operator`.
- **Decisión:** **RATIFICO como aceptable** (Baja, defensa-en-profundidad). No bloquea. **Endurecimiento recomendado (no bloqueante): backend** omite `pricing.buy` y `pricing.bounty` (dejando `sell`/`market` si aplica) cuando el actor es `vault_operator`, o el arquitecto confirma explícitamente que la estrategia de compra es visible para ese rol por diseño. **Disparador:** antes de dar de alta operadores de bóveda que NO deban ver márgenes de compra, o al segregar M1 de la estrategia de pricing.

## 2. Regresión de guardarraíles de dinero/PII — SIN debilitamiento (re-verificado en código)

Verifiqué que los tres streams (A v1.27 + B v1.28/v1.28.1 + P-21) **no** introdujeron regresión en los guardarraíles previos. Coincido con R-11 del pentester.

| Guardarraíl | Evidencia (mi lectura) | Estado |
|---|---|---|
| **Orden de guards** | `app.module.ts:66-70` — throttle → JwtAuth → Roles → EmailVerified → **MoneyOut** (global). | OK |
| **Money-out solo super_admin** | `@MoneyOut()` en `admin-orders.controller.ts:212` (refund), `admin-buylist.controller.ts:80` (pay-spei) y `:197` (reveal/recompra); `MoneyOutGuard` global → rol != super_admin = 403 auditado. | OK |
| **Firma webhook Stripe** | `stripe.service.ts:172-174` — `constructEvent(payload, signature, secret)`; `onModuleInit` (`:35`) fail-fast si falta `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`. Fallback `?? ''` = falla-cerrada (MS-5 histórico, sin cambio). | OK |
| **Idempotencia webhook** | Guardia atómica por `event.id` (P2002); borra marcador y re-lanza si el handler falla (histórico I-4, intacto). | OK |
| **Reserva atómica anti doble-venta** | `reserveItems`/`claimListed` `updateMany` guardado por estado vendible + `count===1`; `publish-all` (`inventory.service.ts`) selecciona solo `platform`+`in_stock`. | OK |
| **Precio server-side (SEC-A1)** | variant-controls/publish-all/bounty derivan de reglas + referencia de BD; el DTO del cliente aporta solo IDs. `assertCents` (`variant-controls.service.ts:68-76`) rechaza no-entero/`<=0`/`>MAX_CENTS`. | OK |
| **Bounty count idempotente** | `countBountyAcquisitionsTx` en la MISMA `$transaction` del pago, guardia `count===1`; re-POST/replay ve `pagada` y no re-cuenta (`buylist.service.ts:1287-1388`); filtro B-1 `notIn ['rechazada','abandonada']`. | OK |
| **KYC/INE cifrado** | `pii-crypto.service.ts` — AES-256-GCM (`createCipheriv`) formato `v1:iv:tag:ct` + blind index HMAC-SHA256; enmascarado por defecto incl. super_admin (histórico I-5). | OK |
| **Sin inyección SQL** | Sin `$queryRawUnsafe` con input de cliente (único uso = literal de secuencia). Prisma parametriza el resto. | OK |

## 3. Revisión AppSec propia — más allá del red team

Ítems que revisé por mi cuenta (no solo validar al pentester):

- **Manejo de secretos:** `git grep` de patrones `secret|password|api-key|token = "…"` en `backend/src` + `frontend/src` = **sin secretos hardcodeados**. `git ls-files` = **ningún `.env` versionado** (solo `.env.example` de devops). Los secretos se leen por `ConfigService`/`process.env`; `env.validation.ts` (histórico) exige entropía ≥32 en no-local. **OK.**
- **CORS (rebrand P-21):** `main.ts:15-21` `resolveCorsOrigins()` construye allow-list desde `APP_BASE_URL`, **nunca `origin:true`**, fallback fail-closed a localhost. El rebrand a dos dominios no relajó la política. **OK.**
- **Superficie de correo del rebrand (`envOr`/`MAIL_FROM`):** `mail/mail-env.util.ts:15-18` — `envOr` hace `trim` y trata vacío/blanco como ausente devolviendo el fallback; **no interpola input de usuario** en el `from`/headers; el envío es por **API JSON de Resend** (sin concatenación SMTP → sin header injection). **OK.**
- **Guardia DAST por host (rebrand):** `security/scripts/_guard.sh` — `_dast_host_from_url` extrae el host correctamente (quita esquema, **userinfo `##*@`**, path/query/fragment); la exención es por **prefijo del host** `staging.*`, no substring de la URL → `https://tcghunt.mx/staging-x` y `?env=staging` **NO bypasean** el bloqueo de prod. Requiere `ALLOW_PROD_DAST=1` explícito para prod. **OK** (coincido con R-10).
- **Authz de escritura de la consola de precios:** `PricingController` y `variant-controls` PUT = `@Roles(Role.super_admin)` (`pricing.controller.ts:106,182`) — la estrategia de precios/bounty **solo la escribe super_admin**. La lectura por `vault_operator` (R-3) es la única fuga, ya consolidada. **OK.**
- **Validación de entrada de la superficie nueva:** DTOs de publish-all/batch con `@IsIn`/`@IsString`/`@ArrayMaxSize(200)`/`@Max(MAX_BATCH_QTY)`; `ValidationPipe({whitelist:true})` global (histórico) → sin mass-assignment. Único hueco de cota: `acquisitionPct` (R-2). **OK salvo R-2.**

## 4. Hallazgos priorizados por severidad (release)

- **Crítica:** ninguno.
- **Alta:** ninguno.
- **Media:** ninguno **remediable dentro del alcance de código de este release**. R-1 es Media de dependencias (bump mayor breaking, no alcanzable) → deuda aceptada (§6).
- **Baja:** R-2 (`acquisitionPct` sin `@Max`, backend), R-3 (lectura de estrategia de precios a `vault_operator`, backend/diseño) → aceptadas (§6).

## 5. Banderas para el humano (antes de operar con dinero real)

- **Pentest de tercero + programa de bug bounty ANTES del go-live con dinero real.** Todo el guardarraíl de dinero de este release (reserva atómica, idempotencia del webhook, firma real de Stripe, H1 con eventos forjados, carrera de dos `pay-spei`, replay de `batchKey` en publish-all) está **verificado solo en estático**. Falta la prueba con firmas reales y concurrencia — ver «Pendiente de DAST en vivo» en `PENTEST_NOTES.md` (pase v1.28).
- **DAST contra staging autorizado, obligatorio antes de promover a prod** (la guardia por host ya bloquea prod sin `ALLOW_PROD_DAST=1`). Requiere que devops habilite staging (Docker/Postgres/R2) — hoy no levantable localmente.
- **KMS / secret manager en producción:** `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `JWT_*`, `STRIPE_*` y `S3_*` desde secret manager (no `.env` ni imagen), con rotación; confirmar que ningún secreto aparece en logs/errores.
- **Validaciones legales de custodia/PII (INE/CLABE):** figura de depositario, contrato de custodia, base legal del tratamiento del INE almacenado (`INE_RETENTION_DAYS`), derecho de supresión frente a los snapshots económicos retenidos (`Order.billingSnapshot`/`SellRequest.clabeSnapshotEnc`, ver histórico rev v1.5 §B.2). Confirmar con abogado/contador.

## 6. Deuda de seguridad aceptada (no bloqueante) — con dueño y disparador

| ID | Deuda | Sev | Impacto | Dueño | Disparador |
|---|---|---|---|---|---|
| **R-1** | `@nestjs/core` GHSA-36xv-jgw5-4q75 (2 moderate) sin parchar (fix = major breaking) | Media (efectiva Baja) | Ninguno hoy (backend sin SSE → aviso no alcanzable) | **devops** | Antes de introducir SSE, o en la próxima ventana de mantenimiento de deps; gate `npm audit` en CI. |
| **R-2** | `acquisitionPct` sin `@Max` (3 DTO) → costo-base saturable con recorte silencioso | Baja | Costo/P&L/valuación inflables por `vault_operator`; no cash-out, no overflow de columna | **backend** | Al endurecer inventario/aportación, o antes de reportes financieros a escala. Añadir `@Max` + alerta al recortar. |
| **R-3** | Binder platform expone `pricing.buy`/`bounty` (estrategia de compra) a `vault_operator` (lectura) | Baja | Fuga de inteligencia de negocio a rol de bóveda; sin PII/cash-out/escalada | **backend** / diseño | Antes de operadores que NO deban ver márgenes de compra; o ratificar por diseño. |

**Carryover histórico (sigue como deuda de revs previas, no re-abierto por este release):** MS-1 (idempotency-key de cliente en shipments/refund — arquitecto/backend), MS-3/MS-4/MS-5 (clamp silencioso / H1 en shipment / `constructEvent ?? ''` — backend), B-2 (linking Google a back-office — backend), B-5 (token en query-string — frontend), S-1..S-7 (stream sellado — backend/arquitecto/devops), B-3/S-B2 (dinero en `Int` 32-bit — arquitecto). Todos con dueño y disparador en las secciones históricas de abajo. Ninguno Crítico/Alto; ninguno bloquea este release.

## 7. VEREDICTO DE SEGURIDAD DEL RELEASE

**APROBADO.**

- **0 hallazgos Críticos o Altos ABIERTOS** → no se cumple la condición de RECHAZO del DoD.
- La superficie NUEVA de dinero (variant-controls M-30, publish-all P-19, bounty P-22, aportación a mercado) llegó **money-safe**: precio server-side, escritura super_admin-only, idempotente (`count===1`), auditada, `assertCents` (entero `>0` `<=MAX_CENTS`), precedencia que nunca inventa precio.
- **Regresión de dinero/PII sin debilitamiento** tras los tres streams (§2): MoneyOutGuard, firma/idempotencia Stripe, reserva atómica, KYC/INE AES-256-GCM, sin inyección, sin secretos hardcodeados.
- Los 3 hallazgos del pentester (**R-1, R-2, R-3**) **CONFIRMADOS** con mi propio análisis y **aceptados como deuda no bloqueante** con dueño y disparador (§6). R-3 **ratificado** como aceptación de diseño con endurecimiento recomendado.
- **Mínimo para mantener la aprobación / previo a producción con dinero real:** ejecutar la **fase dinámica (DAST + pentest de tercero) contra staging autorizado** (hoy no levantable) y provisión de secret manager. Nada de eso bloquea el veredicto de código estático de este release.

**Ruteo por rol dueño (follow-up, no bloqueante):** backend → R-2 (`@Max` + alerta), R-3 (omitir `pricing.buy`/`bounty` para `vault_operator` si no es diseño); devops → R-1 (bump NestJS + gate audit), habilitar staging para DAST; humano → pentest de tercero + bug bounty + validaciones legales de custodia/PII antes de dinero real.

---

<!-- ════════════════════════════════════════════════════════════════════════════════════════
     PASE money-safety-hardening (rev v1.6) — se antepone; el contenido histórico se conserva íntegro abajo.
     ════════════════════════════════════════════════════════════════════════════════════════ -->

# PASE v1.6 — money-safety-hardening (2026-08-20) · VEREDICTO de seguridad

> **Rol:** seguridad (blue team). Consolido `docs/PENTEST_NOTES.md` (sección «PASE v1.6 — money-safety-hardening») contra el código de la rama `claude/money-safety-hardening` (`git diff main`). Reviso y reporto; **NO corrijo**. Cada hallazgo se enruta a su **rol dueño**.
> **Modo:** revisión **estática** de código + ejecución de la suite de specs money-safety (8 archivos, **38 tests, todos PASS**). Sin stack vivo (Docker/Postgres ausentes) → vectores que exigen webhook/checkout real = **[PoC-pendiente-de-target — DAST]**; verificados por lectura/tests = **[Verificado en código]**.
> **Cronología:** el pentester escribió sus notas **ANTES** de la remediación de **MS-2**. He **re-verificado MS-2 en el código y con tests** (no asumido) — ver abajo.

## 0. Resumen ejecutivo del pase

Los **5 endurecimientos de dinero (H1, H2, H3, BE-26, BE-27) CUMPLEN** y quedan **[Verificado en código]** con tests. El único hallazgo **Media** que el pentester dejó abierto en la superficie de esta rama, **MS-2** (overflow de agregados `*Cents` que se persisten en `Order`), **YA FUE REMEDIADO por backend y lo confirmo CERRADO** en dos capas con evidencia y tests.

Tras la remediación de MS-2 **no queda ningún hallazgo Crítico ni Alto ABIERTO** en el alcance de esta rama. Los residuales son **defensa-en-profundidad / cobertura asimétrica** (MS-1 Media out-of-scope, MS-3/MS-4/MS-5 Baja), todos **aceptados como deuda** con dueño y disparador.

**→ VEREDICTO: APROBADO** (con la deuda Media/Baja aceptada y ruteada; ver §5).

| Severidad | # ABIERTO (en alcance de rama) | Estado |
|---|---|---|
| **Crítica** | 0 | — |
| **Alta** | 0 | — |
| **Media** | 1 | MS-1 (aceptada: fuera de alcance de esta rama, follow-up arquitecto/backend) |
| **Baja** | 3 | MS-3, MS-4, MS-5 (aceptadas, defensa-en-profundidad) |
| **Media — CERRADO este pase** | (MS-2) | **remediado + verificado + tests** |

## 1. MS-2 — estado: **CERRADO** (re-verificado en código + tests, no asumido)

**Hallazgo original (pentester, Media):** `clampCents` (BE-27) acotaba el precio **unitario** pero **no** los **agregados** (`totalCents`/`ivaCents`/`processingFeeCents`) que se persisten en `Order.*Cents` (`Int` = Int32). Un agregado > `MAX_CENTS` reventaría al persistir (excepción Postgres = **DoS del checkout**), justo el fallo que BE-27 decía prevenir, movido del unitario al agregado.

**Remediación verificada (backend), dos capas:**
- **Capa pura (choke point):** `backend/src/common/money.ts:518-534` — `grossUpTotal` **LANZA** `Error('total exceeds MAX_CENTS …')` cuando `total > MAX_CENTS`. Como **todo** breakdown (cart / shipment / direct-ship) deriva su `totalCents` de `grossUpTotal`, y `total >= base >= subtotal` (y `>= iva`, `>= processingFee`), un total representable **garantiza** que **todos** los `*Cents` de la `Order` caben en Int32. **Nunca se clampa el agregado** (recortar = subcobro): se rechaza.
- **Capa de negocio (fuente única):** `backend/src/modules/orders/orders.service.ts:382-394` — `representableOrThrow()` traduce ese throw a `BusinessException.validation('AMOUNT_TOO_LARGE')` → **422**, y **re-lanza tal cual** cualquier otro `Error` (mala config de fee = 500 legítimo; no lo enmascara). Nuevo código `AMOUNT_TOO_LARGE` en `backend/src/common/error-codes.ts:55`.
- **Cableado en las DOS rutas que persisten `Order`:**
  - Bóveda: `orders.service.ts:411` — `createSession` envuelve `computeCartBreakdown` en `representableOrThrow`.
  - Invitado (direct_ship): `backend/src/modules/orders/guest-checkout.service.ts:443-445` — `breakdownFor` envuelve `computeDirectShipBreakdown` en `orders.representableOrThrow` (fuente única compartida). El `quote` read-only NO entra por esta ruta (no persiste).
- **Tests (ejecutados, PASS):** `backend/src/common/be27-aggregate-overflow.spec.ts` (grossUpTotal lanza `/MAX_CENTS/` y `/not representable/i`; total legítimo ≤ MAX_CENTS) y `backend/src/modules/orders/be27-aggregate-overflow.spec.ts` (`representableOrThrow` → `AMOUNT_TOO_LARGE`/422; no enmascara otros `Error`).

**Conclusión:** MS-2 **CERRADO**. Baja de «Media abierta» a **remediada**. La observación money-safe del pentester (jamás clampar un agregado en silencio) se respetó: el fix **rechaza**, no recorta.

## 2. Validación de los 5 endurecimientos (defensa)

Todos **[Verificado en código]**; cruce con el hallazgo del pentester = **coincido**.

- **H1 — CUMPLE.** `payments.service.ts:112-136` — antes de liquidar, asevera `pi.amount === order.totalCents && pi.currency === 'mxn'`; mismatch → `logger.error` + `audit.log('order.settle_amount_mismatch')` y **retorna sin liquidar** (200; el marcador de idempotencia queda). El check está **antes** del branch, así que cubre **bóveda** (`:144`) y **direct_ship** (`:140`). Firma del webhook (`constructEvent`) + idempotencia atómica por `event.id` (P2002, `handleEvent:44-95`, con borrado del marcador si el handler lanza) **intactas**. Coincido con el pentester: la ruta de **shipment** (`:171-179`) **no** valida monto/moneda → **MS-4 (Baja, aceptada)**.
- **H2 — CUMPLE.** `orders.service.ts:342` — `const idem = \`pi-order-${params.orderId}\`` **siempre** server-side; el parámetro `idempotencyKey` fue **eliminado** de `attachPaymentIntent`, de `orders.createSession` y de `guest.createSession`. Los controllers **ya no leen** el header: `orders.controller.ts` y `guest-orders.controller.ts` quitaron `@Headers('idempotency-key')`. El header del cliente se **ignora** por completo en orders/guest.
- **H3 — CUMPLE.** `orders.service.ts:203-206` — `nextOrderNumber` usa **tagged-template** `$queryRaw\`SELECT nextval('order_number_seq') …\`` (parametrizado); ya no hay `$queryRawUnsafe`. `git grep` de `queryRawUnsafe|executeRawUnsafe` no deja superficie `Unsafe` con entrada de cliente (coincido con MS-6/Info del pentester).
- **BE-26 — CUMPLE.** `orders.service.ts:58-62` (rama sellado) y `:76-80` (rama rareza) — `salePriceOf` rechaza `salePriceCents == null || <= 0` con `PRICE_PENDING`. Ninguna línea de session puede entrar a $0/negativa. Coincido con MS-7/Info.
- **BE-27 — CUMPLE.** `settings.constants.ts:175` — `FIXED_CENTS_MAX = 100_000_000` acota `fixed` en `isValidBuylistRule`/`isValidSalesRule` (puerta de config). `money.ts` — `clampCents`/`MAX_CENTS` en los unitarios + el **throw de agregado** de `grossUpTotal` (ver §1). El clamp unitario es red de última instancia; la **señal fuerte** vive en el throw del agregado y en los validadores (coincido con la decisión MS-3).

## 3. Hallazgos priorizados por severidad (ABIERTO, en alcance de rama)

- **Crítica:** ninguno.
- **Alta:** ninguno.
- **Media:** ninguno **dentro del alcance de esta rama** que quede sin remediar (MS-2 cerrado). MS-1 es Media pero **fuera de alcance por decisión del orquestador** → va a Deuda aceptada (§4).

## 4. Deuda de seguridad aceptada (no bloqueante) — con dueño y disparador

- **MS-1 (Media) — homólogo de H2/H1 en la ruta de ENVÍO y en el REFUND admin.** `backend/src/modules/shipments/shipments.service.ts:170` (`const idem = idempotencyKey ?? \`pi-shipment-${shipment.id}\``, header propagado desde el controller) y `backend/src/modules/orders/admin-orders.controller.ts:234` (`idempotencyKey ?? \`refund-${order.id}\``) **aún aceptan la idempotency-key del cliente** — la misma clase que H2 cerró en orders/guest, en otra ruta. **Verificado que sigue así** en el código. **FUERA DEL ALCANCE de esta rama por decisión del orquestador.** Severidad Media (no Alta): las keys server-side son `pi-shipment-<id>`/`refund-<order>` con ids CUID no adivinables; el riesgo real es interferencia/colisión con reintentos propios, no robo. En el refund el rol es `super_admin` (`@MoneyOut`, auditado). **Dueño:** arquitecto (follow-up) → backend. **Disparador:** al abrir el work stream de envíos/refund, o antes de operar dinero real, aplicar el patrón H2 (ignorar header, derivar siempre server-side) a ambas rutas.
- **MS-3 (Baja) — `clampCents` recorta en silencio, sin log/auditoría** (`money.ts:30-32`). Decisión aceptada (Opción A): `money.ts` es módulo **puro** (sin infra), por lo que la señal fuerte de importe fuera de rango vive en (1) los validadores de settings y (2) el **throw del agregado** en `grossUpTotal` (mapeado a `AMOUNT_TOO_LARGE`), ambos visibles y accionables. Con config legítima el clamp unitario no debería dispararse nunca. **Dueño:** backend. **Disparador:** si se quiere telemetría del recorte, emitirla en el caller que persiste (fuera del módulo puro).
- **MS-4 (Baja) — H1 no cubre la ruta de liquidación de ENVÍO** (`payments.service.ts:171-179`): el bloque de shipment avanza `solicitado → picking` **sin** asertar `pi.amount`/`pi.currency`. **[PoC-pendiente-de-target]** — no explotable sin bypass de la firma (el PI de shipment lo crea el servidor con el monto correcto). **Dueño:** backend. **Disparador:** si se introduce una fuente de eventos menos confiable, o al endurecer envíos, espejar la aserción H1 aquí.
- **MS-5 (Baja) — `constructEvent` usa `STRIPE_WEBHOOK_SECRET ?? ''`** (`stripe.service.ts:173`): **falla-cerrada** (secret vacío ⇒ `constructEvent` lanza, rechaza toda firma) y `onModuleInit` (`:33-43`) hace **fail-fast** si falta el secret en no-local. No explotable; se registra como fragilidad. **Dueño:** backend/devops. **Disparador:** al tocar la config de Stripe, exigir el secret explícito en vez del fallback a cadena vacía.

> **Nota (carryover histórico, fuera del foco de dinero de esta rama):** siguen abiertas como deuda de revs previas M-1 (2 avisos moderate `@nestjs/core`, devops), B-2/B-1-Google (linking OAuth a back-office, backend), B-4 (`approvedPriceCents` sin cota, backend), B-5 (token en query-string, frontend), S-1..S-7 (stream sellado). Ver secciones históricas abajo. No bloquean este pase.

## 5. Banderas para el humano

- **Antes de operar con dinero real:** ejecutar un **pentest de tercero + DAST en staging autorizado** — los guardarraíles de dinero (reserva atómica anti doble-venta, idempotencia del webhook, firma real de Stripe, H1 con eventos forjados) están **verificados solo en estático**; falta la prueba con firmas reales y carrera de concurrencia. Ver «Pendiente de DAST» en `PENTEST_NOTES.md`.
- **MS-1 es una brecha de simetría en el camino del dinero saliente** (envíos = usuario normal; refund = super_admin). Aunque aceptada como out-of-scope, **cerrarla antes de dinero real** es recomendable: es la misma clase que H2 ya juzgó digna de fix.

## 6. VEREDICTO

**APROBADO.**

- **MS-2 (única Media abierta en la superficie de esta rama) → CERRADO**, verificado en código y con tests (§1).
- **0 hallazgos Críticos o Altos ABIERTOS** → no se cumple la condición de RECHAZO.
- Deuda residual **Media (MS-1, out-of-scope) + Baja (MS-3/MS-4/MS-5)** aceptada, con dueño y disparador anotados (§4).
- La suite money-safety corre en verde (**38/38 PASS**): H1, H2, H3, BE-26, BE-27 y el fix de MS-2.

**Ruteo por rol dueño (follow-up, no bloqueante):** arquitecto → MS-1 (propagar patrón H2 a shipments/refund); backend → MS-3/MS-4; backend/devops → MS-5; humano → pentest de tercero + DAST antes de dinero real.

---

<!-- ═══════════════════════ FIN PASE v1.6 · debajo: contenido histórico conservado ═══════════════════════ -->

> **Rol:** seguridad (blue team). Reviso la defensa, **valido/consolido** los hallazgos del
> `pentester` (`docs/PENTEST_NOTES.md`) contra el código y emito el **VEREDICTO**. No corrijo
> código: cada hallazgo se enruta al **rol dueño**.
> **Alcance de esta revisión (rev v1.3):** **re-verificación del endurecimiento de producción**
> que estaba enrutado como deuda (S-M1, S-M2, S-B3, S-B4). Backend implementó: CORS allow-list,
> `helmet`, `algorithms` JWT fijados al firmar y verificar, validación de env **siempre**, y
> allow-list de content-type + límite de tamaño en el presign `kyc_ine`. Verifico que **cierran**
> los hallazgos y que **no introdujeron regresión** en los guardarraíles de dinero/PII.
> **Modo:** revisión **estática** de código + `npm audit` + ejecución de `test/uploads.presign.spec.ts`.
> Sin stack vivo (R2/Railway aún sin configurar) → vectores que exigen instancia = **[PoC pendiente
> de target — DAST]**; verificados por lectura/tests = **[Verificado en código]**.
> **Fecha:** 2026-08-15 (rev **v1.3**, endurecimiento de producción). Blanco autorizado: staging/local.

---

## 0. Resumen ejecutivo (rev v1.3)

El **endurecimiento de producción** que quedó enrutado como deuda en la rev v1.2.1 fue
implementado por **backend** y **cierra** los hallazgos abiertos de transporte/auth/uploads.
Todo verificado en código y con tests corriendo:

- **S-M2 (CORS) — CERRADO.** `main.ts` ya **NO** usa `origin: true`. `resolveCorsOrigins()`
  construye una **allow-list** desde `APP_BASE_URL` (lista separada por comas) con
  `credentials: true`. **Fallback fail-closed**: si falta `APP_BASE_URL`, solo devuelve orígenes
  de dev local (`http://localhost:3000`, `http://localhost:5173`) — **jamás un comodín**.
- **S-B4 (helmet / algorithms / env) — CERRADO.** `helmet()` aplicado en `main.ts:29`.
  JWT con `algorithm:'HS256'` al **firmar** (`auth.service.ts:47,54`) y `algorithms:['HS256']` al
  **verificar** (`jwt-auth.guard.ts:37`, `auth.service.ts:183`) → algorithm-confusion cerrado en
  defensa en profundidad. `env.validation.ts` valida **siempre** (no solo en prod) para todo
  entorno no-local, con **chequeo de entropía** (≥32 chars) de los secretos JWT.
- **S-B3 (presign) — CERRADO (con residuo Bajo aceptado).** `uploads.service.ts` fuerza
  allow-list `image/*` (rechaza HTML/PDF/octet-stream con 422) **siempre**, y aplica límite de
  tamaño (`KYC_UPLOAD_MAX_BYTES`, default 10 MiB) fijándolo en la firma (`ContentLength`) cuando el
  cliente lo declara; `presignGet` sirve el INE con `Content-Disposition: attachment`. 12/12 tests
  de `test/uploads.presign.spec.ts` **pasan**. Residuo Bajo: el tope de tamaño solo se **fija en la
  firma si el cliente envía `contentLength`** (ver S-B3 abajo).
- **S-M1 (deps runtime) — MITIGADO.** `npm audit --omit=dev` en `backend/` pasó de **6 moderate a
  2 moderate** (0 high / 0 critical). Las cadenas `gaxios→uuid` (buffer bounds) y `file-type` (DoS
  parser) **se resolvieron**. Las 2 restantes son el **mismo** aviso de `@nestjs/core`
  (**CVE-2026-35515, SSE injection, moderate**) que **no es alcanzable** en este código (ver S-M1).

**No hay hallazgos Críticos ni Altos abiertos.** Guardarraíles de dinero/PII **sin regresión**
(verificados en §2). El resto de la deuda (S-B1, S-B2) sigue **aceptada con disparador** (§5).

**VEREDICTO (revisión de código estático): APROBADO.** La **fase dinámica (DAST/pentester contra
staging)** queda **pendiente y NO aprobada a ciegas** porque R2/Railway aún no están configurados
(§6). No se promueve a producción sin ella.

| Severidad | # | IDs / estado |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 1 | S-M1 (**mitigado 6→2 moderate**; residuo no-alcanzable, aceptado) |
| Baja | 3 | S-B1 (aceptada), S-B2 (aceptada), S-B3 (**cerrado**, residuo Bajo aceptado) |
| Cerrados esta rev | 3 | **S-M2 (CORS)**, **S-B4 (helmet/algorithms/env)**, **S-B3 (presign)** |

---

## 1. Endurecimiento de producción — verificación por hallazgo (rev v1.3)

### S-M2 — CORS restringido a allow-list — **CERRADO · [Verificado en código]**
- `backend/src/main.ts:15-23` (`resolveCorsOrigins`) + `:47-50` — `app.enableCors({ origin:
  corsOrigins, credentials: true })`. **Ya no existe `origin: true`.**
- **Fallback evaluado (requisito del encargo):** sin `APP_BASE_URL`, devuelve **solo**
  `['http://localhost:3000','http://localhost:5173']`. **No abre a `*`** ni refleja el `Origin` del
  request → **fail-closed**. En staging/prod `APP_BASE_URL` debe fijarse; si se omitiera por error,
  el efecto es que CORS **bloquea** al frontend legítimo (rompe, no expone). Comportamiento seguro.
- **Nota de robustez (no bloqueante):** `env.validation.ts` **no** exige `APP_BASE_URL` en no-local;
  una omisión en staging degrada silenciosamente a orígenes localhost. Recomendación menor para
  **devops/backend**: añadir `APP_BASE_URL` a las env requeridas no-locales o loguear WARN explícito
  (ya se loguea la allow-list resultante en `:50`). No es hueco de seguridad.

### S-B4 — helmet + algorithms JWT + validación de env — **CERRADO · [Verificado en código]**
- **helmet:** `main.ts:29` `app.use(helmet())` (CSP default, HSTS, noSniff, frameguard, etc.).
- **algorithms fijados (algorithm-confusion):**
  - Firma: `auth.service.ts:47` (access) y `:54` (refresh) → `algorithm: 'HS256'`.
  - Verificación: `jwt-auth.guard.ts:37` y `auth.service.ts:183` (refresh) → `algorithms: ['HS256']`.
  - Efecto: `alg:none` y confusión RS↔HS quedan cerradas de forma explícita (antes dependía del
    comportamiento de la lib; ahora es defensa en profundidad afirmativa).
- **Validación de env SIEMPRE:** `env.validation.ts` cableada en `app.module.ts:31`
  (`ConfigModule.forRoot({ validate: validateEnv })`). Corre en **todo** arranque; en cualquier
  entorno **no-local** (incluye staging) exige `DATABASE_URL`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y **rechaza secretos JWT
  débiles** (<32 chars). En local no aborta (para no romper dev/CI sin secretos reales) — patrón
  consistente con seed/pii-crypto. Correcto.

### S-B3 — Presign `kyc_ine`: allow-list de content-type + tamaño — **CERRADO (residuo Bajo aceptado) · [Verificado en código + tests]**
- **Allow-list de content-type — efectiva y SIEMPRE:** `uploads.service.ts:67-74` normaliza a
  minúsculas y exige prefijo `image/`; rechaza `text/html`, `application/pdf`,
  `application/octet-stream` con **422 VALIDATION_ERROR**. **No se puede subir contenido arbitrario
  (HTML/binario) al bucket.** La extensión de la key se deriva del tipo ya validado (`:98`).
- **Límite de tamaño — efectivo cuando el cliente declara `contentLength`:** `:79-95` valida
  `0 < contentLength ≤ maxBytes` (default 10 MiB, dial `KYC_UPLOAD_MAX_BYTES`) y **fija
  `ContentLength` en la firma** (`:104`) → S3/MinIO rechaza el PUT si el cuerpo no coincide
  exactamente. El tope no depende solo de la buena fe del cliente **para ese caso**.
- **Servir sin ejecución:** `presignGet` (`:126-135`) fuerza `ResponseContentDisposition:
  'attachment'` → aunque un objeto fuera HTML, no se renderiza inline; y sale por GET prefirmado de
  vida corta (300 s) desde bucket **privado**.
- **Tests:** `test/uploads.presign.spec.ts` — **12/12 PASS** (ejecutado esta sesión): acepta
  `kyc_ine`+`image/*`, rechaza `inventory_photo`/`dispute_claim`/otros, rechaza no-imagen, valida
  tope por defecto y `KYC_UPLOAD_MAX_BYTES`, rechaza `contentLength` no positivo.
- **Residuo Bajo (aceptado, §5):** el tope de tamaño **solo se fija en la firma si el cliente envía
  `contentLength`** (campo opcional en el DTO). Si el cliente lo **omite**, la firma no lleva
  `ContentLength` y podría subir un archivo grande (abuso de almacenamiento) — el **content-type
  sigue restringido a `image/*`**, así que no hay subida de HTML/binario ni XSS. Impacto: abuso de
  storage, no ejecución. Cierre sugerido junto con la config de bucket en prod: exigir
  `contentLength` obligatorio o aplicar límite del lado de infra (policy de bucket). **Rol dueño:**
  **backend** (hacer `contentLength` obligatorio) + **devops** (límite/bucket privado en R2).

### S-M1 — Dependencias runtime backend — **MITIGADO (6→2 moderate) · residuo no-alcanzable, aceptado · [Verificado]**
- `npm audit --omit=dev` esta sesión: **2 moderate, 0 high, 0 critical** (antes 6 moderate). Las
  cadenas `gaxios→uuid` (buffer bounds, tocaba el login Google) y `file-type` (DoS parser) **ya no
  aparecen** → resueltas.
- **Las 2 restantes son el mismo aviso:** `@nestjs/core`/`@nestjs/platform-express` →
  **GHSA-36xv-jgw5-4q75 / CVE-2026-35515** (SSE injection, **moderate**, CVSS 6.3). Precondición de
  explotación: la app debe **usar SSE** y mapear datos influenciados por el usuario a los campos
  `type`/`id` de un `MessageEvent`. **`git grep` de `@Sse|SseStream|MessageEvent|text/event-stream`
  en `backend/src` → sin coincidencias.** El backend **no expone SSE** → el aviso **no es
  alcanzable** en este código.
- **Fix disponible solo con breaking change** (`@nestjs/core@11.2.1`, salto 10→11); instalado hoy:
  **10.4.22**. Dado que **no es alcanzable**, se **acepta** como deuda no bloqueante con disparador:
  bumpear a NestJS 11 (o al parche 11.1.18+) en la próxima ventana de mantenimiento, y **antes** de
  introducir cualquier endpoint SSE.
- **Severidad efectiva:** Baja (aviso Media no alcanzable). **Rol dueño:** **devops** (bump NestJS
  11 + gate `npm audit` en CI/SAST). Frontend: `critical`/`high` **solo en devDependencies**
  (`vitest`/`vite`), no van al bundle prod — sin cambio.

---

## 2. Guardarraíles previos — SIN regresión (re-verificado en código, v1.3)

El endurecimiento tocó `main.ts`, `auth.service.ts`, `jwt-auth.guard.ts`, `env.validation.ts` y
`uploads/*`; **no** tocó pagos, órdenes, buylist ni PII. Re-chequeados:

| Guardarraíl | Evidencia | Estado |
|---|---|---|
| **Reserva atómica anti doble-venta** | `orders.service.ts` — `updateMany` guardado por estado vendible + `count!==1 → ITEM_UNAVAILABLE` en `$transaction`. | OK |
| **Webhook Stripe: firma** | `stripe.service.ts` — `constructEvent(payload, sig, STRIPE_WEBHOOK_SECRET)`; raw body preservado en `main.ts:35-39` (intacto tras añadir helmet). | OK |
| **Webhook Stripe: idempotencia** | `payments.service.ts` — `ProcessedStripeEvent` guardia atómica (P2002 no-op); si el handler falla borra la marca y re-lanza. | OK |
| **Money-out solo super_admin** | `money-out.guard.ts` — rol != `super_admin` → `403 MONEY_OUT_FORBIDDEN` + audita. reveal-clabe/pay-spei/refund/recompra. | OK |
| **PII cifrada/enmascarada** | `schema.prisma` `*Enc`/`*Hmac`; enmascarado por defecto incl. `super_admin`; `reveal-clabe` único CLABE en claro (money-out + auditado); `vault_operator` proyección reducida. | OK |
| **Retención INE** | `jobs/ine-retention.service.ts` — purga objeto + limpia `ineFrontKey/ineBackKey` pasado `INE_RETENTION_DAYS`. | OK |
| **Login Google server-side** | `google-token-verifier` + `auth.service.ts` — firma/aud/iss/exp + `email_verified`; `role` siempre server-side. Firma JWT con `algorithm:'HS256'`. | OK |
| **Enum. por temporización login** | `auth.service.ts:95-101` — `argon2.verify` siempre contra `DUMMY_PASSWORD_HASH`; throttle 5/min. | OK |
| **Sync catálogo anti-inyección/SSRF** | `catalog-sync.service.ts` `SET_ID_PATTERN`; host fijo + `encodeURIComponent`. | OK |
| **Portfolio/holdings sin IDOR** | `userId` desde JWT (`@CurrentUser`), nunca de parámetro. | OK |
| **Presign solo kyc_ine** | `uploads.service.ts:57-62` — cualquier otro `purpose` → 422; controlador `@Roles(customer,vault_operator,super_admin)`. | OK |

---

## 3. Estado de todos los hallazgos (histórico consolidado)

| ID | Tema | Rev anterior | **Estado v1.3** | Rol dueño |
|---|---|---|---|---|
| S-M1 | Deps runtime backend | Media abierta (6 moderate) | **Mitigado** (2 moderate; residuo SSE no-alcanzable, **aceptado**) | devops |
| S-M2 | CORS `origin:true` + credentials | Media abierta | **CERRADO** (allow-list `APP_BASE_URL`, fallback fail-closed) | backend ✔ |
| S-B1 | Linking Google a cuentas back-office | Baja aceptada | **Aceptada** (sin cambio; disparador §5) | backend |
| S-B2 | Dinero en `Int` 32-bit | Baja aceptada | **Aceptada** (sin cambio; disparador §5) | arquitecto/backend |
| S-B3 | Presign sin allow-list tipo/tamaño | Baja abierta (reducida) | **CERRADO** (allow-list `image/*` + tope; residuo Bajo aceptado) | backend ✔ |
| S-B4 | helmet / algorithms / env prod-only | Baja abierta | **CERRADO** (helmet + HS256 fijo + env siempre + entropía) | backend ✔ |

---

## 4. Mínimo para aprobar producción (dinero/PII reales)

La parte **estática** de código ya **no bloquea** (0 críticos/altos; S-M2/S-B3/S-B4 cerrados). Para
la **promoción a producción** faltan, ahora, elementos de **infra y fase dinámica**:

1. **Fase dinámica (DAST) contra staging** — **PENDIENTE, obligatoria.** No ejecutable hoy (R2/
   Railway sin configurar). Debe correr CORS cross-origin real, abuso de presign con bucket real,
   concurrencia de checkout/buylist, y el escaneo ZAP/nuclei. **[devops habilita staging → pentester
   ejecuta DAST].**
2. **S-M1 (deps)** — bump NestJS a 11.1.18+/11.2.x + gate `npm audit` en CI **[devops]**. No
   alcanzable hoy, pero cerrarlo antes de exponer o de añadir SSE.
3. **S-B3 (residuo)** — `contentLength` obligatorio en el presign **[backend]** + **bucket INE
   privado en R2** con límite de tamaño a nivel de policy **[devops]**.
4. **Config env de staging/prod** — `APP_BASE_URL`, secretos fuertes (≥32) desde secret manager,
   `S3_*` reales; confirmar que ningún secreto aparece en logs **[devops]**.

S-B1 y S-B2 quedan como **deuda aceptada con disparador** (§5).

---

## 5. Deuda de seguridad aceptada (no bloqueante, con disparador)

| ID | Deuda | Impacto | Disparador |
|---|---|---|---|
| S-M1 | `@nestjs/core` CVE-2026-35515 (SSE injection) sin parchar (fix = major 10→11) | Ninguno hoy (backend no usa SSE) | Antes de introducir cualquier endpoint SSE, o en la próxima ventana de mantenimiento de deps. |
| S-B1 | Linking Google a cuentas back-office | Traslada seguridad de cuentas privilegiadas a Google | Antes de alta de cualquier back-office con email @gmail, o al habilitar más operadores. |
| S-B2 | Dinero en `Int` 32-bit | Overflow de integridad en agregados > ~MX$21.47M | Antes de que portafolios/P&L/custody agregados se acerquen a MX$21M, o antes de operar a escala. |
| S-B3 (residuo) | Tope de tamaño del presign solo se fija si el cliente envía `contentLength` | Abuso de almacenamiento (no ejecución: content-type ya restringido a `image/*`) | Cerrar junto con bucket INE privado en R2: `contentLength` obligatorio + límite de policy. |

---

## 6. Banderas para el humano (antes de operar con dinero real)

- **DAST/pentest dinámico contra staging — PENDIENTE Y OBLIGATORIO.** Esta rev es **estática/caja
  blanca**. Los vectores **[PoC pendiente de target — DAST]** (CORS cross-origin real, abuso de
  presign contra bucket real, concurrencia de checkout/buylist, DoS por deps) **no** se pudieron
  validar porque **R2/Railway aún no están configurados**. No se aprueba a ciegas: en cuanto haya
  staging autorizado, **devops habilita el entorno y pentester ejecuta el DAST** (ZAP/nuclei +
  scripts de concurrencia) antes de la promoción a producción.
- **Pentest de tercero + programa de bug bounty** antes del go-live con dinero real.
- **KMS / secret manager en producción**: `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `JWT_*`, `STRIPE_*`
  y `S3_*` del bucket de INE desde un secret manager (no `.env` ni imagen); rotación; sin secretos
  en logs/errores. `env.validation.ts` ya rechaza el arranque no-local sin secretos y secretos JWT
  débiles, pero la **provisión** del secret manager es de devops.
- **Validaciones legales de custodia/PII (INE/CLABE)**: figura de depositario, contrato de custodia,
  seguro del inventario, base legal de tratamiento del **INE almacenado**, retención
  `INE_RETENTION_DAYS`, acceso y borrado al vencer, y CLABE cifrada. Confirmar con contador/abogado.
- **Correo de evidencia de disputa** (`DISPUTE_EVIDENCE_CONTACT`, default `soporte@tcgvault.mx`) es
  **placeholder por confirmar por el humano**; debe apuntar a un buzón real monitoreado.
- **Cierre de infra (devops)**: bucket INE **privado** + lifecycle de retención + límite de tamaño;
  retirar el prefijo público muerto `inventory_photo/` del compose (config muerta, no hueco);
  `APP_BASE_URL` y secretos fuertes en staging/prod.

---

## 7. VEREDICTO

**Revisión de código estático: APROBADO.**

El **endurecimiento de producción** implementado por backend **cierra** los hallazgos que estaban
abiertos:
- **S-M2 (CORS): CERRADO** — allow-list desde `APP_BASE_URL`, `credentials:true`, **sin `origin:true`**
  y **fallback fail-closed** (nunca `*`).
- **S-B4 (helmet/algorithms/env): CERRADO** — `helmet()`, `HS256` fijado al **firmar y verificar**,
  validación de env **siempre** con chequeo de entropía de secretos JWT.
- **S-B3 (presign kyc_ine): CERRADO** — allow-list `image/*` (siempre) + límite de tamaño +
  `Content-Disposition: attachment`; **12/12 tests pasan**. Queda un **residuo Bajo aceptado** (tope
  de tamaño solo se fija si el cliente declara `contentLength`; content-type ya bloquea no-imagen).
- **S-M1 (deps): MITIGADO** — `npm audit --omit=dev` **6→2 moderate**; las 2 restantes son la SSE
  injection de `@nestjs/core` **no alcanzable** (backend sin SSE), **aceptada** con disparador.

**0 Críticos / 0 Altos abiertos** → no procede RECHAZO. Lo abierto es **1 Media mitigada/aceptada
(S-M1)** y **deuda Baja aceptada (S-B1, S-B2, residuo S-B3)**, nada bloqueante para la parte
estática ni para staging.

**PENDIENTE (no aprobado a ciegas): fase dinámica (DAST/pentester contra staging)** — bloqueada
hoy porque **R2/Railway no están configurados**. Es **requisito previo a producción**: devops
habilita staging y pentester ejecuta el DAST; recién entonces se re-emite veredicto para el
gate de promoción a prod.

**Enrutamiento restante:** **devops** → S-M1 (bump NestJS 11 + gate `npm audit`), habilitar staging
para DAST, bucket INE privado + límite de tamaño, `APP_BASE_URL`/secret manager; **backend** →
residuo S-B3 (`contentLength` obligatorio), (opc.) S-B1; **arquitecto/backend** → S-B2 (`BigInt`).
Nada vuelve a backend como bloqueante: los tres hallazgos que le tocaban (S-M2, S-B3, S-B4) están
**cerrados y verificados**.

---

# ANEXO rev v1.4 (2026-08-16) — Bloque nuevo: cotizador público + sync-all + admin M2/M6/M7/M9/M10

> **Alcance:** 3 endpoints backend nuevos (`GET /buylist/cards`, `GET /buylist/sets`,
> `POST /admin/catalog/sync-all`) + vistas admin de frontend (M2/M6/M7/M9/M10 y cotizador).
> **Modo:** revisión **estática** de código + `npm audit --omit=dev` + lectura de tests
> (`test/buylist-catalog.spec.ts`). Sin stack vivo → DAST sigue **pendiente** (§6).

## A.0 Resumen del bloque

El bloque nuevo llegó **endurecido**. Los tres endpoints backend tienen authz/throttle/auditoría
correctos y **no filtran datos sensibles**; las vistas admin son **defensa en profundidad** sobre un
backend que sigue siendo la autoridad. **0 Críticos / 0 Altos.** No hay hallazgos nuevos que
bloqueen. `npm audit` **sin cambios** (2 moderate, mismo aviso SSE no alcanzable).

## A.1 `GET /buylist/cards` y `GET /buylist/sets` (públicos) — **OK · [Verificado en código + tests]**
- **Anti-scraping:** `buylist-catalog.controller.ts:21,41` — `@Throttle({ ttl:60s, limit:60 })`,
  más estricto que el global de 300/min. `@Public()` (sin sesión, por diseño del cotizador).
- **Sin fuga de datos sensibles:** `searchAllCards`/`listSetsWithImportedCards`
  (`catalog.service.ts:241-293`) proyectan **solo catálogo público** vía `toCardDTO` (id,
  externalId, name, number, rarity, supertype, subtypes, setId/Name, imágenes) y set
  (id/name/series/releaseDate/year). **No** tocan `InventoryItem`, precios internos, costo, ni PII
  (test `buylist-catalog.spec.ts` afirma `inventoryItem.findMany` **no** se llama y que el DTO
  **no** trae `sellable`/`salePriceCents`). CardDTO ya era superficie pública en "Compra".
- **Validación de query / DoS:** `pageSize` acotado a `Math.min(100, …)` y `page` a `Math.max(1,…)`
  con `parseInt` tolerante (`controller.ts:34-36`). `setId`/`rarity`/`q` entran como filtros
  **parametrizados** de Prisma (`where.setId`, `where.rarity`, `contains … mode:'insensitive'`) →
  **sin SQLi**. Residuo trivial: `q` sin longitud máxima (ILIKE `%q%`); impacto nulo dado el tope de
  página + throttle. No es hallazgo.

## A.2 `POST /admin/catalog/sync-all` — **OK · [Verificado en código]**
- **Authz:** `AdminCatalogController` es `@Roles(Role.super_admin)` a nivel de clase; sin `@Public`,
  así que `JwtAuthGuard`→`RolesGuard` (globales, `app.module.ts:60-62`) exigen sesión y rol
  super_admin (rol tomado del JWT, nunca del cuerpo). `RolesGuard` niega con 403 FORBIDDEN.
- **Auditoría:** `admin-catalog.controller.ts:64-72` registra `catalog.sync_all` con `actorUserId`,
  `actorRole` y `{jobId,setsQueued,remaining}`.
- **Anti-abuso (single-flight):** `catalog-sync.service.ts:118,150-160` — flag `syncAllRunning`
  evita barridos paralelos; retorna 202 de inmediato (fire-and-forget). Upsert idempotente por
  `externalId` → re-llamar reanuda sin duplicar.
- **Sin SSRF/inyección:** el barrido itera sets **remotos** (`s.id` de pokemontcg.io, no del
  usuario); `getCardsBySet` usa `encodeURIComponent(\`set.id:${setId}\`)` + **host fijo**
  `https://api.pokemontcg.io/v2` (`pokemontcg-io.client.ts:47,72`). `sync-all` no acepta ningún
  parámetro del cliente. `sync`/`backfill` conservan `SET_ID_PATTERN`/`DATE_PATTERN`.
- **Nota multi-instancia (no bloqueante):** `syncAllRunning` y el throttler son **in-memory por
  proceso**. En despliegue multi-instancia, el single-flight y el rate-limit solo protegen por
  instancia (dos réplicas podrían disparar un barrido cada una). Los upserts idempotentes evitan
  corrupción; solo se duplica carga hacia pokemontcg.io. **Rol dueño: devops** (store compartido
  Redis para throttler + coordinación de jobs al escalar; ya anotado en `app.module.ts:34-35`).

## A.3 M6 Usuarios (frontend) — enmascarado PII + guardas — **OK · [Verificado en código]**
- **PII enmascarada:** `M6View.tsx:231-233` renderiza **solo** `currentKyc.clabeMasked` /
  `rfcMasked` (y `ineOnFile` booleano). El tipo `contract.ts:544-556` **no** define CLABE/RFC en
  claro → el frontend no tiene forma de exponer PII completa; el backend enmascara por defecto incl.
  super_admin (verificado §2, sin regresión). No hay INE keys ni datos KYC crudos en el DTO.
- **Guarda de rol:** `m6/page.tsx` envuelve `M6View` en `SuperAdminOnly`. La vista (y sus `useQuery`)
  **solo monta** si `isSuperAdmin` → no hay fetch prematuro de la ficha 360°.
- **Observación (no seguridad, para frontend/product):** el contrato permite a `vault_operator` ver
  M6 con **proyección reducida** (backend `AdminUsersController` = `@Roles(vault_operator,
  super_admin)`), pero la UI lo **bloquea por completo** con `SuperAdminOnly`. Es **más estricto**
  que el backend (safe: nunca expone de más), pero divergencia funcional respecto al contrato §M6.
  No es hueco de seguridad; se anota para que frontend/product decidan si operador debe ver la
  proyección reducida en UI.

## A.4 M7 Finanzas / M9 Reportes / M10 Config (frontend) — solo super_admin — **OK**
- `m7|m9|m10/page.tsx` envuelven la vista en `SuperAdminOnly`; la vista (con sus `useQuery`) solo
  monta para super_admin → sin fetch de finanzas/config para roles no autorizados. Backend autoridad:
  `AdminFinanceController`/`AdminReportsController` = `@Roles(super_admin)`
  (`admin.controller.ts:97,137`). `SuperAdminOnly` es **defensa de UI** (comentario propio lo
  reconoce), no sustituye al backend.
- **Export CSV (M7/M9):** `admin.service.exportCsv` (`admin.service.ts:233-246`) emite **solo
  valores numéricos (cents), IDs (CUID) y enums de estado** — **sin campos de texto libre
  controlados por el usuario** (no nombres de carta/usuario) → **sin vector de CSV formula
  injection**. Endpoints super_admin. `Content-Disposition: attachment`. OK.

## A.5 `npm audit --omit=dev` (backend) — **SIN CAMBIO**
- Esta sesión (2026-08-16): **2 moderate, 0 high, 0 critical** — el mismo aviso `@nestjs/core` /
  `@nestjs/platform-express` (GHSA-36xv-jgw5-4q75 / CVE-2026-35515, SSE injection). `git grep`
  de `@Sse|SseStream|MessageEvent|text/event-stream` en `backend/src` → **0 coincidencias**: el
  backend **no expone SSE**, aviso **no alcanzable**. Estado idéntico a v1.3 (S-M1, aceptado con
  disparador). El bloque nuevo **no** agregó dependencias con avisos.

## A.6 VEREDICTO del bloque nuevo

**Revisión de código estático (bloque cotizador + sync-all + admin M2/M6/M7/M9/M10): APROBADO.**
- 0 Críticos / 0 Altos. Endpoints públicos con throttle propio y **sin fuga** de inventario/precio/
  PII; `sync-all` super_admin + auditado + single-flight + sin SSRF; vistas admin gatadas
  (defensa en profundidad) con backend como autoridad; PII sigue enmascarada; `npm audit` sin cambio.
- **No hay hallazgos nuevos bloqueantes.** Deuda previa **sin cambio** (S-M1 aceptada; S-B1/S-B2 y
  residuo S-B3 aceptados con disparador, §5). Nota multi-instancia (A.2) → **devops** al escalar.
- **PENDIENTE, no aprobado a ciegas:** la **fase dinámica (DAST/pentester contra staging)** sigue
  bloqueada por infra (R2/Railway sin configurar). Requisito previo a producción (§6). En cuanto haya
  staging, ejecutar CORS cross-origin real, abuso de throttle del cotizador (scraping),
  concurrencia de `sync-all` multi-instancia y ZAP/nuclei.

---

# ANEXO rev v1.5 (2026-08-16) — Bloque v1.3.1: reset-password admin, borrado híbrido, revocación de sesiones, precio por rareza, M2 buylist-rules/rarities

> **Alcance:** superficies nuevas del bloque v1.3.1: `POST /admin/users/:id/reset-password`,
> `DELETE /admin/users/:id` (hard/soft), revocación por `tokenVersion` en `JwtAuthGuard` + auth,
> precio de buylist por **rareza** (`common/money.ts` `quoteAcquisition` + `buylist.service.ts`),
> y los endpoints M2 `PUT/GET /admin/pricing/buylist-rules` y `GET /admin/pricing/rarities`.
> **Modo:** revisión **estática** de código + `npm audit --omit=dev`. Sin stack vivo → DAST sigue
> **pendiente** (§6). Blanco autorizado: staging/local.

## B.0 Resumen del bloque
Bloque **endurecido**. Los cinco focos del encargo se verificaron **OK en código**; **0 Críticos /
0 Altos**. `npm audit --omit=dev` **sin cambio** (2 moderate, mismo aviso SSE `@nestjs/core` **no
alcanzable** — 0 coincidencias de `@Sse|MessageEvent|text/event-stream` en `backend/src`). No hay
hallazgos nuevos bloqueantes. Deuda previa sin cambio (S-M1 aceptada; S-B1/S-B2/residuo S-B3
aceptados, §5).

## B.1 Reset de contraseña admin — **OK · [Verificado en código]**
- **AuthZ:** `admin.controller.ts:99-113` `@Roles(super_admin)` a nivel de método (además del
  `@Roles(vault_operator, super_admin)` de clase → el método restringe a super_admin). `RolesGuard`
  global es la autoridad.
- **Temp password nunca persistida en claro ni logueada:** `admin.service.ts:171-190` genera
  `randomBytes(18).toString('base64url')` (144 bits de entropía), la **hashea con argon2** y persiste
  **solo el hash**. `git grep tempPassword` → únicamente generación/hash/retorno; **no** aparece en
  logger, AuditLog ni respuesta persistida. La **única exposición** es el cuerpo de la respuesta HTTP
  (una vez). El AuditLog (`controller.ts:104-111`) registra `user.reset_password` con actor+target,
  **sin** before/after → la contraseña **no** entra a la bitácora.
- **Revocación de sesiones:** `tokenVersion: { increment: 1 }` (`:186`) invalida access/refresh
  previos (ver B.3). `mustChangePassword: true` fuerza cambio en el próximo login.
- **Cuenta borrada:** rechaza reset sobre `status==='deleted'` con `USER_DELETED` (`:174-176`).

## B.2 Borrado híbrido hard/soft — **OK · [Verificado en código]** (1 residuo Bajo + 1 bandera legal)
- **CANNOT_DELETE_SELF:** `admin.service.ts:214-216` → `409` si `id===actorUserId`. **Antes** de
  cualquier lectura/escritura. Idempotente sobre cuentas ya `deleted` (`:224-226`).
- **Purga de INE en R2 en AMBOS modos:** `purgeIne` (`:238`) corre antes de decidir hard/soft →
  el dato de máxima sensibilidad se elimina siempre.
- **Hard (sin transacción):** solo cuando NO hay filas económicas (`orders+sellRequests+shipments+
  disputes+ownedItems === 0`, `:228-235`) → `user.delete` con cascada (KYC/Billing/Address/Snapshot).
- **Soft (transacción):** anonimización **efectiva** de PII directa — `kycProfile` pone a `null`
  `clabeEnc/clabeHmac/rfcEnc/legalName/ineFrontKey/ineBackKey` (`:249-259`); `billingProfile`,
  `address` y `portfolioSnapshot` se **eliminan** (`:263-265`); `user` reescribe
  `email=deleted+<uuid>@anon.invalid`, `name='Usuario eliminado'`, `phone/avatarUrl/googleId/
  passwordHash=null` y `tokenVersion++` (`:266-281`). No quedan restos de PII **directa** en las
  tablas de perfil. Auditado con `{mode}` únicamente (`controller.ts:123-130`), sin volcar PII.
- **Bandera legal (no bloqueante, para el humano):** por diseño (PROJECT "conserva filas económicas
  por integridad legal") las filas retenidas conservan **snapshots** que pueden contener PII:
  `Order.billingSnapshot` (JSON del perfil fiscal — `rfcEnc` cifrado, pero nombre/razón social y
  domicilio fiscal pueden ir en claro dentro del JSON) y `SellRequest.clabeSnapshotEnc` (CLABE
  **cifrada**). El `userId` se conserva (seudonimización). **No es defecto de código** — es la
  retención económica documentada — pero el **derecho de supresión (LFPDPPP)** no alcanza a esos
  snapshots. Debe confirmarse con abogado/contador la base legal y el plazo de retención (se suma a
  la bandera de PII de §6). **Rol dueño (si se decide minimizar):** backend/arquitecto.
- **Residuo Bajo (aceptado):** en **hard delete**, `purgeIne` traga el error de R2 (lo loguea,
  `:199-201`) y continúa con `user.delete`; si el borrado del objeto R2 falla, la fila y las
  `ineFrontKey/ineBackKey` se pierden por cascada → **objeto INE huérfano** en el bucket con las
  keys perdidas (el job de retención ya no lo alcanza). Impacto: dato cifrado huérfano, no expuesto
  (bucket privado). **Disparador:** cerrar con lifecycle/retención a nivel de bucket en R2
  **[devops]**; opcional, reordenar para exigir purga R2 antes del delete **[backend]**.

## B.3 Revocación de sesiones (`tokenVersion`) — **OK · [Verificado en código]**
- **Guard:** `jwt-auth.guard.ts:52-63` — tras verificar la firma (HS256 fijo, `:45`), consulta
  `User.status` + `tokenVersion` y rechaza con `401` si `!user || status∈{blocked,deleted} ||
  payload.tv !== user.tokenVersion`. Un reset/soft-delete (que hacen `tokenVersion++`) invalida
  **todos** los access tokens vivos de inmediato.
- **Refresh:** `auth.service.ts:190-199` aplica la **misma** guardia (status + `tv`) → un refresh
  con versión previa ya no renueva.
- **Login / Google:** `login` (`:111-113`) y `google` (`:139-141`, `:176-178`) rechazan
  `blocked`/`deleted` con `USER_BLOCKED` (mismo code, sin revelar motivo). El account-linking de
  Google también corta en cuentas `blocked/deleted` antes de enlazar. Los tokens nuevos embeben el
  `tv` vigente (`issueTokens`, `:46`).
- **Nota (no seguridad):** el guard añade **un `findUnique` por request autenticado**. Correcto para
  revocación inmediata; a escala, considerar cache corto. No es hueco.

## B.4 Precio de buylist por rareza (SEC-A1) — **OK · [Verificado en código]**
- **Derivación server-side:** `money.ts:66-89` `quoteAcquisition(rarity, ref, rules, fallbackPct)`
  resuelve la regla por **exact match sobre `Card.rarity`**; `buylist.service.ts:116,122,131` toma
  `card.rarity` de la carta real (`prisma.card.findUnique`), **no** del DTO. El cliente ya **no**
  envía `category` (`:17` comentario + DTO). Un DTO malicioso **no puede inflar** `quotedTotalCents`.
- **fixed** no depende de referencia (siempre cotiza); **pct** sin referencia → `precio_pendiente`
  + escala al dueño (`:123-124`) — no se descarta ni se paga de más. Regla aplicada snapshotea
  `rarity/ruleMode/ruleValue/ruleSource` para auditoría.

## B.5 Endpoints M2 buylist-rules / rarities — **OK · [Verificado en código]**
- **AuthZ:** `PricingController` (`pricing.controller.ts:50-51`) `@Roles(super_admin)` a nivel de
  clase → `buylist-rules` (GET/PUT), `rarities`, `rarity-map` heredan super_admin.
- **Validadores:** `PUT buylist-rules` (`:144-176`) llama `validateBuylistRules` +
  `validateFallbackPct` (`settings.constants.ts:100-124`): `fixed → entero ≥ 0` (centavos),
  `pct → número en [0,100]`, `fallbackPct → [0,100]`; error → `422 VALIDATION_ERROR`. No se pueden
  meter reglas absurdas (negativos, pct>100, mode inválido).
- **Auditoría:** registra `pricing.buylist_rules.update` con **before/after** (`:168-174`). Surte
  efecto sin redeploy (persistido en `ConfigSetting`). `rarities` (`:183-203`) solo lee catálogo
  (`groupBy rarity`) + reglas; sin fuga de datos sensibles.

## B.6 `npm audit --omit=dev` (backend) — **SIN CAMBIO**
- Esta sesión (2026-08-16): **2 moderate, 0 high, 0 critical** — mismo aviso `@nestjs/core` /
  `@nestjs/platform-express` (GHSA-36xv-jgw5-4q75 / CVE-2026-35515, SSE injection). `git grep` de
  `@Sse|SseStream|MessageEvent|text/event-stream` en `backend/src` → **0 coincidencias** → **no
  alcanzable**. Idéntico a v1.3/v1.4 (S-M1, aceptado con disparador; fix = major NestJS 10→11).

## B.7 VEREDICTO del bloque v1.3.1

**VEREDICTO seguridad (revisión estática): APROBADO.**
- **0 Críticos / 0 Altos.** Reset-password (super_admin, argon2, temp password nunca
  logueada/persistida en claro/auditada, `tokenVersion++`), borrado híbrido (CANNOT_DELETE_SELF,
  INE purgado en ambos modos, anonimización efectiva de PII directa, auditado), revocación por
  `tokenVersion` (guard + login/google/refresh rechazan viejos/`deleted`/`blocked`), precio por
  rareza server-side (SEC-A1 intacto) y endpoints M2 (super_admin + auditados + validadores
  pct[0,100]/fixed≥0) están **correctos**.
- **Deuda/banderas no bloqueantes:** bandera legal sobre PII en snapshots económicos retenidos
  (`Order.billingSnapshot` / `SellRequest.clabeSnapshotEnc`) frente al derecho de supresión — a
  validar con abogado; residuo Bajo del INE huérfano en hard delete si falla la purga R2 (cerrar con
  lifecycle de bucket, devops). S-M1/S-B1/S-B2/residuo S-B3 sin cambio (§5).
- **PENDIENTE, no aprobado a ciegas:** la **fase dinámica (DAST/pentester contra staging)** sigue
  bloqueada por infra (R2/Railway sin configurar). Requisito previo a producción (§6): abuso de
  reset/delete concurrente, revocación de sesión en caliente, y ZAP/nuclei.

---

# C. Revisión v1.4-finance — Costo real de paquetería en el P&L (M-16)

> **Fecha:** 2026-08-16. **Modo:** revisión estática de código + lectura de migración M-16
> (working tree, SIN commitear). **Alcance:** `shipments.dto.ts`, `shipments.service.ts`,
> `admin-shipments.controller.ts`, `admin.service.ts` (`pnl()`/`exportCsv()`), `schema.prisma` +
> migración `20260816140000_m16_shipping_cost`, y el frontend M4 (`M4View.tsx`, `api.ts`,
> `contract.ts`). Blanco autorizado: código y staging/local.

## C.0 Resumen — 0 Críticos / 0 Altos; 1 Media (fuga de margen), 2 Bajas aceptadas

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 1 | **SEC-C1** (fuga de `shippingCostCents` a endpoints de cliente) |
| Baja | 2 | SEC-C2 (sin `@Max` / overflow Int32), SEC-C3 (SoD: `vault_operator` escribe insumo del P&L) |

## C.1 Autorización — CORRECTA (verificado en código)
- `POST /admin/shipments/:id/tracking` → `AdminShipmentsController` con
  `@Roles(vault_operator, super_admin)` a nivel de clase (`admin-shipments.controller.ts:13`).
  Un `customer` NO alcanza la captura de `shippingCostCents`. Consistente con el modelo M4.
- `GET /admin/finance/pnl` → `@Roles(super_admin)` a nivel de clase
  (`admin/*.controller.ts:136-137`). El P&L es **solo super_admin**. `GET /admin/reports`
  (exportCsv) también `@Roles(super_admin)` (`:176-177`). Correcto.
- El campo NO es "dinero saliente": es un registro contable de costo ya pagado al carrier
  fuera de banda, no un movimiento de fondos. Que NO pase por `MoneyOutGuard` es correcto.

## C.2 Integridad financiera — CORRECTA en el eje de entrada
- `shippingCostCents` SOLO se escribe vía el endpoint admin (`setTracking`,
  `shipments.service.ts:262-274`). Un cliente NO puede inyectarlo: el `ValidationPipe` global
  (`main.ts:43`, `whitelist:true`) descarta campos no declarados en los DTO de cliente
  (`CreateShipmentDto`/`ShipmentQuoteDto` no incluyen el campo). No hay vía de manipulación del
  P&L por el cliente.
- Validación `@IsOptional @IsInt @Min(0)` (`shipments.dto.ts:24`): bloquea negativos (no se puede
  inflar `profitCents` con un costo negativo) y no-enteros. `pnl()` **resta**
  `shippingCostCents` (`admin.service.ts:325`); un negativo habría inflado la ganancia — el `@Min(0)`
  lo cierra. Correcto.
- Idempotencia/editabilidad: si se re-captura tracking omitiendo el costo, `setTracking` NO toca la
  columna (spread condicional `:273`) y la auditoría registra `res.shippingCostCents` (valor
  **persistido real**, no el DTO) → el log refleja el estado verdadero. Correcto.

## C.3 Auditoría — CORRECTA
- `admin-shipments.controller.ts:73-84` registra `actorUserId`, `actorRole`, `action`
  (`shipment.tracking`), `entityId` y `after.shippingCostCents` = valor persistido. Quién + qué +
  (timestamp del AuditLog) quedan trazados. Bien.

## C.4 Mass assignment / migración — SIN vector
- `whitelist:true` en el pipe global neutraliza mass-assignment de entrada.
- Migración M-16: `ADD COLUMN "shippingCostCents" INTEGER NOT NULL DEFAULT 0` — aditiva,
  `@default(0)` cubre filas históricas sin backfill; no abre vector.

## SEC-C1 (Media) — Fuga de `shippingCostCents` (dato de margen) a endpoints de CLIENTE
- **Vector:** Exposición de dato interno de negocio (margen) a usuario autenticado no-admin.
- **Ubicación:** `shipments.service.ts:158-165` (`listMine` → `GET /shipments`) y `:167-174`
  (`getMine` → `GET /shipments/:id`) devuelven la **fila Prisma cruda** de `ShipmentRequest`, que
  tras M-16 incluye `shippingCostCents`. **No hay `ClassSerializerInterceptor` ni `@Exclude` en el
  código** (grep = 0) ni `select`/proyección → la respuesta JSON al cliente **incluye el costo real
  que la plataforma paga al carrier**. El cliente ya ve `shippingFeeCents` (lo que paga), de modo que
  puede **derivar el margen de envío de la plataforma** para sus propios envíos.
- **Contradice el contrato:** el propio DTO/migración/`contract.ts` declaran el campo "**Interno
  (no se expone al cliente)**" (`shipments.dto.ts:22`, `contract.ts` `ShipmentTrackingRequest`). El
  frontend no lo pinta, pero la API sí lo entrega (visible en Network/llamada directa).
- **Alcance/impacto:** limitado a los **propios** envíos del cliente (`getMine`/`listMine` filtran por
  `userId`; sin harvest masivo, sin PII, sin escalada, sin fraude de fondos). Solo aparece en envíos
  con costo ya capturado (default 0). Nota: `processingFeeCents` (fee Stripe) **ya se fuga por el
  mismo mecanismo** — M-16 suma a esa superficie un campo declarado explícitamente interno.
- **Severidad:** **Media** (info disclosure de dato de margen; no bloqueante por política, pero
  incumple una garantía explícita del contrato → debe cerrarse antes de operar con clientes reales).
- **Rol dueño:** **backend** — proyectar la salida de `listMine`/`getMine` con `select` explícito que
  excluya `shippingCostCents` (idealmente también `processingFeeCents`) o introducir un
  `ClassSerializerInterceptor` + DTO de respuesta con `@Exclude`. (No lo corrige seguridad.)

## SEC-C2 (Baja, aceptada con disparador) — `@Min(0)` sin `@Max` + `Int32` de 32 bits
- **Ubicación:** `shipments.dto.ts:24` (`@Min(0)` sin `@Max`) + `schema.prisma:525`
  (`shippingCostCents Int`). Un `vault_operator` puede capturar un valor absurdo por error;
  valores hasta ~MX$21.47M/envío distorsionan el P&L en silencio, y > 2^31 desbordan el `Int` de
  Postgres (error de escritura). Insumo de **rol confiable** + **auditado** → riesgo Bajo.
- **Rol dueño:** **backend** (cota superior razonable por envío). Se enlaza con el hallazgo del
  pentester **B-2** (evaluar `BigInt` para agregados de dinero) — mismo dueño/decisión.

## SEC-C3 (Baja, aceptada) — Segregación de funciones: `vault_operator` escribe insumo del P&L
- `vault_operator` puede fijar `shippingCostCents`, que alimenta el P&L (solo-lectura de
  `super_admin`). Puede reducir la ganancia reportada inflando el costo. Mitigado: cada captura es
  **auditada** (quién/cuándo/valor) y el P&L lo revisa `super_admin`. Consistente con el modelo M4
  (el operador ya es dueño de envíos/guías). Residuo Bajo aceptado; decisión de producto si se desea
  SoD más estricta. **Rol dueño:** backend/producto (opcional).

## C.5 VEREDICTO v1.4-finance: **APROBADO**
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7). Autorización,
  integridad de entrada, auditoría y anti-mass-assignment del cambio son **correctas**.
- **Condición de cierre (no bloqueante por severidad, pero exigible antes de GA con clientes
  reales):** cerrar **SEC-C1** (dejar `shippingCostCents` fuera de las respuestas de cliente) para
  honrar la garantía del contrato "no se expone al cliente". Ruteado a **backend**.
- **Deuda aceptada:** SEC-C2 (cota `@Max`/`BigInt`, junto a B-2) y SEC-C3 (SoD) con disparador.
- **Bandera para el humano:** verificar que ningún tablero/exportación de cliente ni logs de acceso
  reflejen el margen expuesto por SEC-C1 mientras no se proyecte la salida.

---

## C.6 RE-VERIFICACIÓN (2026-08-16) — SEC-C1 y SEC-C2 tras corrección de backend (working tree, sin commitear)

> **Modo:** revisión estática + ejecución de `test/shipments.tracking-cost.spec.ts` (**12/12 PASS**).
> **Alcance:** `shipments.service.ts` (`toClientShipment`/`listMine`/`getMine`/`adminList`/`adminGet`),
> `dto/shipments.dto.ts` (`@Max`), cruce con `API_CONTRACT §5` y `§M4`.

### SEC-C1 — Fuga de `shippingCostCents` a endpoints de CLIENTE — **CERRADO** ✔ · [Verificado en código + tests]
- **Proyector allowlist:** `shipments.service.ts:166-185` `toClientShipment()` construye el objeto de
  salida con una **allowlist explícita** de 14 campos declarados para el comprador (id, status,
  addressSnapshot, shippingFeeCents, ivaCents, processingFeeCents, totalCents, carrier, trackingNumber,
  requestedAt, pickingAt, shippedAt, deliveredAt, items). **No es denylist/omit**: un campo interno
  futuro del modelo NO se filtra por accidente. Robusto.
- **`shippingCostCents` fuera:** NO está en la allowlist → la salida de cliente ya **no** incluye el
  costo interno del carrier. Test `getMine`/`listMine` afirman `not.toHaveProperty('shippingCostCents')`.
- **`stripePaymentIntentId` también fuera:** confirmado — la allowlist lo excluye (antes se fugaba por la
  fila cruda); test afirma `not.toHaveProperty('stripePaymentIntentId')`. Reduce superficie adicional. Bien.
- **`processingFeeCents` DENTRO — decisión correcta por contrato §5:** `API_CONTRACT.md:153-154,311,340`
  define `BreakdownDTO = { subtotalCents, ivaCents, ivaRatePct, processingFeeCents, totalCents, currency }`
  y el comprador **ya lo ve** en el breakdown de `quote`/`create` (es un **cargo que el comprador paga**
  vía gross-up, no margen interno). Mantenerlo en la proyección de envío es **consistente**, no una fuga.
  Confirmado correcto.
- **Aplicado a ambos endpoints de cliente:** `listMine` (`GET /shipments`, `:193` → `rows.map(toClientShipment)`)
  y `getMine` (`GET /shipments/:id`, `:202`). Cubierto.
- **ADMIN sin romper:** `adminList` (`:207-221`) y `adminGet` (`:223-230`) devuelven la **fila cruda**
  (con `shippingCostCents`); `AdminShipmentsController` es `@Roles(vault_operator, super_admin)`. La
  funcionalidad admin (P&L/costos) se conserva. El `POST /:id/tracking` sigue auditando `res.shippingCostCents`.
- **Sin vector nuevo:** `getMine` mantiene el chequeo de ownership **antes** de proyectar
  (`:201` `if (!shipment || shipment.userId !== userId) throw notFound()`); el proyector no altera authz.
  Test "getMine still enforces ownership (404 for another user)" lo cubre. `listMine` filtra por `userId`.
  Ningún otro endpoint de cliente reintroduce el campo.

### SEC-C2 — Tope `@Max` / overflow Int32 — **CERRADO** ✔ · [Verificado en código + tests]
- **Cota aplicada:** `dto/shipments.dto.ts:7,30` — `SHIPPING_COST_MAX_CENTS = 100_000_00` (MX$100,000 en
  cents) con `@IsOptional() @IsInt() @Min(0) @Max(SHIPPING_COST_MAX_CENTS)`. El tope (10,000,000) está
  **muy por debajo** del máximo de Int32/Postgres (2,147,483,647) → sin overflow y sin distorsión silenciosa
  del P&L por captura absurda. Holgado para el costo real de un envío.
- **Test de frontera:** cubre boundary (acepta `SHIPPING_COST_MAX_CENTS`, rechaza `+1`), además de
  negativos y no-enteros. `test/shipments.tracking-cost.spec.ts` — **12/12 PASS** (ejecutado esta sesión).
- **Enrutamiento previo (S-B2/B-2 `BigInt`):** sigue como **deuda aceptada** para agregados de dinero a
  escala (§5). El `@Max` cierra el vector por-envío de SEC-C2; no sustituye la decisión de `BigInt` para
  agregados, que es de arquitecto/backend.

### Estado y veredicto de la re-verificación
| ID | Sev. original | Estado v1.4-finance | Estado tras corrección |
|---|---|---|---|
| SEC-C1 | Media (info disclosure de margen) | Abierto (condición de cierre pre-GA) | **CERRADO** ✔ (allowlist `toClientShipment`) |
| SEC-C2 | Baja (aceptada c/disparador) | Aceptada | **CERRADO** ✔ (`@Max` + tests) |

**VEREDICTO v1.4-finance (re-emitido): APROBADO — se mantiene.**
- **0 Críticos / 0 Altos.** SEC-C1 (única Media del bloque) y SEC-C2 quedan **cerrados y verificados en
  código + tests**; la corrección **no introdujo vector nuevo** (ownership intacto, admin no roto, allowlist
  robusta ante campos futuros, `stripePaymentIntentId` también protegido).
- **Nada vuelve a backend como bloqueante** por este bloque. Queda solo **SEC-C3** (SoD: `vault_operator`
  captura el costo) como **deuda Baja aceptada** con disparador (auditado + P&L revisado por super_admin) —
  decisión de producto, no bloqueante.
- **Sin cambio** en las banderas globales: la **fase dinámica (DAST contra staging)** sigue pendiente y es
  requisito previo a producción (§6); pentest de tercero + validación legal de custodia/PII antes del
  go-live con dinero real.

---

## rev v1.5-auth-email (2026-08-16) — Verificación de correo + recuperación self-service

> **Rol:** seguridad (blue team). **Alcance de esta revisión:** feature de correo v1.5 en el **working
> tree, SIN COMMITEAR** — verificación de email + recuperación de contraseña por token (Resend). Archivos:
> `auth-token.service.ts`, `auth.service.ts`, `auth.controller.ts`, `dto/auth.dto.ts`, `modules/mail/*`,
> `guards/email-verified.guard.ts`, `guards/jwt-auth.guard.ts`, `schema.prisma` (AuthToken), migración M-17,
> `config/env.validation.ts` y pantallas de auth del frontend.
> **Modo:** revisión **estática** de código (sin stack vivo). Vectores que exigen instancia = **[PoC
> pendiente de target — DAST]**; verificados por lectura = **[Verificado en código]**.
> **Nota:** `docs/PENTEST_NOTES.md` es del pase v1.1 y **no cubre** la feature v1.5 (posterior). Esta sección
> es revisión blue-team propia de la superficie nueva; no duplica hallazgos del pentester.

### 0. Resumen ejecutivo

La feature v1.5 **llega bien construida** y con los controles correctos en su núcleo. Confirmados **[Verificado
en código]**:
- **Tokens:** el claro es **32 bytes CSPRNG** (`crypto.randomBytes(32).toString('base64url')`, **no**
  `Math.random`); en BD vive **solo el SHA-256** (`hashAuthToken`), nunca el claro; el token viaja **solo por
  correo** (no en respuestas API ni en logs de app). Consumo **atómico de un solo uso**: `consume()` hace
  `updateMany({ where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })`
  y exige `count>0` **antes** de resolver el `userId` → cierra la carrera de doble-uso (dos requests con el
  mismo token: solo una obtiene `count=1`). **TTL correctos y server-side:** verif 24h / reset 1h
  (`AUTH_TOKEN_TTL_MS`), validados por `expiresAt > now` en el propio `updateMany`. **Rotación:** al emitir
  (`issue()`) se invalidan los previos no usados del mismo tipo (`updateMany usedAt=now`) → solo el último
  link vale.
- **Gating server-side REAL y no evadible:** `EmailVerifiedGuard` es `APP_GUARD` global, corre **después** de
  `JwtAuthGuard` (que puebla `req.user.emailVerified` **leyéndolo fresco de BD** en cada request) y **antes**
  de `MoneyOutGuard` (orden declarado en `app.module.ts:63-67`). `@RequireEmailVerified()` está aplicado en
  los **exactos 3 endpoints** del contrato: `POST checkout/session` (`orders.controller.ts:22`),
  `POST shipments` (`shipments.controller.ts:21`) y `POST buylist/requests` (`buylist.controller.ts:24`). Los
  `*/quote` read-only **no** se bloquean (correcto). Un `customer` sin verificar **no** puede crear
  orden/envío/sell-request por llamada directa a la API → `403 EMAIL_NOT_VERIFIED`. **No hay bypass por UI.**
- **Anti-enumeración:** `forgot-password` responde **SIEMPRE 200** (`{ ok: true }` incondicional en
  `auth.service.ts:217`); `verify-email/resend` es **autenticado y sin body** (usa `req.user`, cero
  enumeración). Login mantiene la mitigación de timing con `DUMMY_PASSWORD_HASH`. El frontend
  (`ForgotPasswordView.tsx`) muestra **mensaje genérico** siempre y solo distingue `429`.
- **Reset de contraseña:** **misma política** que registro (`ResetPasswordDto.password @MinLength(8)`);
  `tokenVersion: { increment: 1 }` → **revoca sesiones vivas** (verificado en `jwt-auth.guard.ts:61` y
  `refresh` :361: rechazan `tv` previo); `emailVerified=true` tras reset (el clic prueba control del inbox,
  decisión de producto documentada). **No** devuelve tokens: el usuario re-inicia sesión. Consumo atómico.
- **Adaptador Resend:** API key **desde env** (`RESEND_API_KEY`, `mail.module.ts:24`), **no hardcodeada** y
  **no logueada** (solo se loguea `error.name/message`). El **link se ancla a `APP_BASE_URL`**
  (`buildFrontendLink`, server-side config) — **no** al `Host`/header de la request → **sin host-header
  injection** en el link. El token se `encodeURIComponent`. `env.validation` exige `RESEND_API_KEY` en
  no-local (Noop solo en dev/CI).
- **Rate-limiting:** `forgot-password` 3/h/IP (`@Throttle` ctrl) **+ tope 3/h/email** en servicio
  (`countIssuedLastHour`, cuenta por `createdAt` — no evadible por rotación de token); `resend` 3/h/usuario
  (servicio) + 10/h/IP backstop; `verify-email`/`reset-password` 10/min/IP (token de 256 bits → no
  fuerza-brutable). Defensa suficiente contra spam de correos y abuso.

**Hallazgos nuevos:** **0 Críticos / 0 Altos.** Un solo defecto de código real (inyección en plantilla HTML,
**Baja**) y tres endurecimientos de defensa-en-profundidad (**Baja**). Nada bloqueante para la feature v1.5.

| Severidad | # (v1.5) | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 4 | S15-B1 … S15-B4 |
| Info/positivo | — | ver §0 |

### 1. Hallazgos priorizados

#### S15-B1 (Baja) — Inyección HTML en el cuerpo del correo: `name` del usuario sin escapar · [Verificado en código]
- **Ubicación:** `backend/src/modules/mail/mail.templates.ts:41,43,51,53,65,67,75,77` — el `name` del usuario
  se interpola **sin escapar** en el HTML (`<p>Hola ${name}:</p>` / `Hi ${name},`) y en el `text`. El `name`
  viene de `RegisterDto.name` (`@IsString() @MinLength(1)`, **sin sanitización**).
- **Evidencia/PoC:** registrar con `name = '<img src=x onerror=alert(1)>'` (o markup arbitrario) inyecta ese
  HTML en el cuerpo del correo de verificación/reset. **Impacto acotado:** el correo se envía **solo a la
  propia dirección del usuario** (`user.email`), por lo que es esencialmente self-injection, y los clientes de
  correo modernos neutralizan `<script>`/`onerror`. No obstante es un defecto de inyección real (el brief lo
  pide explícito) y habilita HTML/estilos/enlaces arbitrarios en un correo con la marca **TCG Vault MX**
  (potencial abuso de reputación / plantilla de phishing con dominio propio si el `name` se reusara en correos
  a terceros a futuro). El `link` **sí** es seguro (server-built + `encodeURIComponent`).
- **Rol dueño:** **backend** (escapar HTML de `name` —y de cualquier dato de usuario— antes de interpolarlo en
  la plantilla; p. ej. un `escapeHtml()` en `mail.templates.ts`, o validar `name` con allow-list en el DTO).

#### S15-B2 (Baja) — Enumeración por temporización en `forgot-password` · [Verificado en código]
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:195-218`.
- **Evidencia:** con email **inexistente** el método retorna casi inmediato; con email **existente y activo**
  ejecuta escrituras en BD (`issue`) y **`await` del envío por Resend** (llamada de red) antes de responder.
  Aunque la respuesta HTTP es idéntica (200), la **latencia** difiere de forma medible → canal de
  enumeración. **Mitigantes:** rate-limit 3/h/IP (solo ~3 muestras/hora por IP) y que el registro **ya**
  filtra existencia vía `409 EMAIL_TAKEN` (canal preexistente, aceptado). Riesgo residual bajo.
- **Rol dueño:** **backend** (opcional, defensa-en-profundidad: mover el envío a un flujo asíncrono/desacoplado
  del request, o normalizar el tiempo de respuesta, para que exista/no-exista tarden igual).

#### S15-B3 (Baja) — Token en la URL: posible fuga por Referer/historial · [Verificado en código]
- **Ubicación:** links `${APP_BASE_URL}/<locale>/verify-email|reset-password?token=<claro>`
  (`auth.service.ts:71`); pantallas `VerifyEmailView.tsx` / `ResetPasswordView.tsx` reciben el token del query.
- **Evidencia:** el token en claro viaja en el query string (inevitable: el link debe ser clicable desde el
  correo), pero puede quedar en historial del navegador, logs de servidor/proxy y en cabeceras `Referer` hacia
  recursos de terceros que cargue la página. **Mitigantes fuertes:** un solo uso + TTL corto (reset 1h) +
  rotación reducen la ventana. Práctica estándar de la industria; residual bajo.
- **Rol dueño:** **frontend** (defensa-en-profundidad: `history.replaceState` para retirar `?token=` de la URL
  tras consumirlo, y/o `Referrer-Policy: no-referrer` en estas rutas).

#### S15-B4 (Baja) — `reset-password` no revalida el estado de la cuenta al consumir · [Verificado en código]
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:225-251` (`resetPassword`).
- **Evidencia:** `forgot-password` solo emite token a cuentas `active` (:198), pero `resetPassword` **no**
  recomprueba `status` al consumir. Un token emitido mientras la cuenta estaba `active` y usado **después** de
  pasar a `blocked`/`deleted` re-fijaría `passwordHash` y `emailVerified=true`. **No es escalable a acceso:**
  `login`/`refresh`/`jwt-auth.guard` siguen rechazando `blocked`/`deleted` por estado, así que **no** se
  reactiva la cuenta ni se obtiene sesión. Impacto: escritura de estado inútil sobre una cuenta inhabilitada.
  Residual muy bajo.
- **Rol dueño:** **backend** (recomprobar `status === active` dentro de `resetPassword` antes de aplicar el
  cambio; simetría con `forgotPassword`).

### 2. Deuda de seguridad aceptada (no bloqueante, con disparador)
- **S15-B2/B3/B4** se aceptan como **deuda Baja** con los disparadores indicados (defensa-en-profundidad).
  **Disparador de revisión:** antes del go-live con dinero real y/o en el pase **DAST** contra staging (medir
  timing de `forgot-password`, revisar fuga de token por Referer en el borde).
- **S15-B1** (inyección HTML en plantilla) **se recomienda cerrar antes de GA**: es un fix de una línea
  (escape) y elimina una clase de inyección; se enruta a **backend** pero no bloquea el veredicto por su
  impacto acotado (self-targeting).
- **`register` sigue revelando existencia vía `409 EMAIL_TAKEN`** — canal de enumeración clásico ya aceptado
  en pases previos (Info). Sin cambio.
- **Pendientes de infra ajenos a v1.5** (siguen abiertos, de pases previos): **PENTEST M-1** dependencias
  vulnerables (Media, **devops** — incluye la cadena de red de Resend/gaxios a revisar en el próximo
  `npm audit`) y la deuda **BigInt** de agregados de dinero (arquitecto/backend). No pertenecen a esta feature.

### 3. Banderas para el humano
- **Pentest de tercero + bug bounty antes de operar con dinero real**: se mantiene la bandera global. La
  recuperación de contraseña y el gating de dinero son superficie crítica; conviene validación externa antes
  del go-live transaccional.
- **Fase dinámica (DAST contra staging) pendiente**: confirmar timing de anti-enumeración, rate-limits reales
  (por IP tras el proxy/borde — verificar que el `trust proxy`/IP real llega bien al `ThrottlerGuard`) y la no
  fuga de tokens por logs de borde. Requisito previo a prod.
- **Entregabilidad/seguridad de correo (SPF/DKIM/DMARC de `tcgvaultmx.com`)**: es **devops**; si el correo de
  verificación no llega, los usuarios quedan sin poder desbloquear compra/venta/retiro (impacto de negocio, no
  de confidencialidad). Confirmar dominio verificado en Resend.
- **Validaciones legales de custodia/PII (INE/CLABE)**: sin cambios; siguen vigentes de pases previos.

### 4. VEREDICTO — feature v1.5-auth-email: **APROBADO**
- **0 Críticos / 0 Altos / 0 Medios** en la superficie nueva v1.5. Los controles de núcleo (tokens
  hash-only/CSPRNG/atómicos/rotados, gating server-side no evadible, anti-enumeración, rate-limiting, revocación
  de sesiones por `tokenVersion`, key/link sin fuga ni host-injection) están **correctamente implementados y
  verificados en código**.
- **Condición de aprobación cumplida:** el criterio de RECHAZO es "hay hallazgos críticos o altos abiertos" —
  **no los hay**. Las 4 Bajas (S15-B1..B4) se aceptan como deuda con disparador y se enrutan a su rol dueño
  (**backend** S15-B1/B2/B4, **frontend** S15-B3); **ninguna** bloquea.
- **Recomendación no bloqueante:** cerrar **S15-B1** (escape HTML del `name`) en esta misma entrega por ser
  trivial. El resto puede abordarse en el endurecimiento previo a GA / pase DAST.
- **Mínimo para mantener la aprobación:** que no se introduzcan cambios que debiliten el consumo atómico del
  token, el gating server-side o el anti-enumeración de `forgot-password`.

---

# rev v1.6-pentest-consolidacion (2026-08-16) — Consolidación del pase gray-box del pentester (PENTEST_NOTES v1.5)

> **Rol:** seguridad (blue team). **Insumo:** `docs/PENTEST_NOTES.md` **pase v1.5** (red team, gray-box
> estático; 0 Críticas / 0 Altas / 1 Media / 5 Bajas / 6 Info). **Trabajo de esta rev:** validar cada
> hallazgo del pentester contra el código, **reconciliar** con mis IDs previos (no duplicar), confirmar que
> no hay críticos/altos abiertos y emitir **VEREDICTO**.
> **Modo:** revisión **estática** de código + `npm audit --omit=dev` + `git grep` (ejecutados esta sesión).
> Sin stack vivo (Docker/Postgres/Redis no levantables; egress al dominio real denegado por política) →
> vectores dinámicos = **[pendiente de DAST contra staging]**, NO son fallos. Blanco autorizado: código +
> staging/local.

## D.0 Resumen — concuerdo con el pentester: 0 Críticas / 0 Altas abiertas

Validé los 6 hallazgos del pentester en el código. **Todos confirmados en su ubicación** (ninguno es falso
positivo), y **todas** las severidades del pentester son correctas. **Cuatro de los seis ya estaban en mi
registro** con otro ID → los reconcilio, no los duplico. Uno es **nuevo** para mi registro (B-4). Además,
detecto que un hallazgo mío previo (**S15-B4**) fue **corregido** por backend desde la última rev.

| Pentest | Sev. | Mi ID (reconciliado) | Validación en código | Estado | Rol dueño |
|---|---|---|---|---|---|
| **M-1** | Media | **= S-M1** | `npm audit --omit=dev` = 2 moderate (mismo aviso `@nestjs/core` GHSA-36xv-jgw5-4q75); `git grep @Sse\|MessageEvent\|text/event-stream` en `src` = **0** | **Aceptada** (no alcanzable: sin SSE) | devops |
| **B-1** | Baja | **= S15-B2** | `auth.service.ts:198-204`: `await mail.sendPasswordReset` **solo** si existe+`active` | **Aceptada** | backend |
| **B-2** | Baja | **= S-B1** | `auth.service.ts:309-331`: linking por email verificado a cualquier cuenta local; `role` **nunca** del token (`:340` fija `customer` solo en altas) | **Aceptada** | backend |
| **B-3** | Baja | **= S-B2 / SEC-C2** | `schema.prisma:393` `listPriceCents Int?` sin cota; múltiples `*Cents Int` | **Aceptada** | arquitecto (+backend) |
| **B-4** | Baja | **NUEVO = S-B5** | `buylist.dto.ts:42` `@Min(0)` **sin `@Max`**; `buylist.service.ts:428` sin cota vs `quotedPriceCents`/AML | **Aceptada** | backend |
| **B-5** | Baja | **= S15-B3** | `auth.service.ts:71` `buildFrontendLink` arma `?token=<claro>` | **Aceptada** | frontend |

## D.1 Validación por hallazgo (confirmo/ajusto severidad)

### M-1 (Media) — `@nestjs/core` moderate — **CONFIRMADO · severidad efectiva Baja (no alcanzable) · Aceptada**
- **Reconcilia con mi S-M1** (rev v1.3, §5). `npm audit --omit=dev` esta sesión: **2 moderate, 0 high, 0
  critical** — ambos son el mismo aviso `@nestjs/core`/`@nestjs/platform-express` (GHSA-36xv-jgw5-4q75 /
  CVE-2026-35515, **SSE injection**). Fix = `@nestjs/core@11.2.1`, **breaking** (hoy `^10.4`).
- **¿Explotable en nuestra superficie o teórico?** **Teórico/no alcanzable.** La precondición es exponer
  **SSE** y mapear entrada de usuario a `type`/`id` de un `MessageEvent`. `git grep -E
  "@Sse|SseStream|MessageEvent|text/event-stream"` en `backend/src` → **0 coincidencias**. El backend **no
  expone SSE** → el aviso no es alcanzable en este código.
- **Decisión (según el encargo):** **se acepta con disparador**, no se agenda bump ciego. Coincido con el
  pentester: el salto mayor 10→11 tiene riesgo de regresión que no se justifica por un aviso inalcanzable.
  **Disparador:** bump a NestJS 11.1.18+/11.2.x **antes** de introducir cualquier endpoint SSE, o en la
  próxima ventana de mantenimiento de deps con regresión de la suite. **Rol dueño: devops** (bump + gate
  `npm audit` en CI/SAST, ya previsto).

### B-1 (Baja) — Oráculo de timing en `forgot-password` — **CONFIRMADO · = S15-B2 · Aceptada**
- **Reconcilia con mi S15-B2** (rev v1.5-auth-email, §1). **No lo duplico.** Confirmado en
  `auth.service.ts:195-218`: ruta **asimétrica** — email inexistente → un solo `findUnique` y `return`;
  email existente+`active` → `countIssuedLastHour` + `tokens.issue` + **`await mail.sendPasswordReset`
  (round-trip a Resend)** + `audit.log`. La respuesta es **siempre 200** (`:217`, correcto), pero la
  **latencia** delata existencia.
- **Severidad correcta (Baja).** **Impacto reducido:** `register` ya enumera por `409 EMAIL_TAKEN`
  (`:111-113`) — canal directo preexistente y aceptado; el timing solo confirma lo que register ya expone.
- **Rol dueño: backend** (envío fire-and-forget/cola para igualar latencia, o retardo constante).
- **Nota DAST:** medir la asimetría de latencia real requiere target vivo → §D.4.

### B-2 (Baja) — Google-linking alcanza cuentas privilegiadas — **CONFIRMADO · = S-B1 · Aceptada**
- **Reconcilia con mi S-B1** (§3/§5). **No lo duplico.** Confirmado en `auth.service.ts:308-331`: el linking
  enlaza el `googleId` a **cualquier** cuenta local con el mismo email **verificado**, **sin excluir
  back-office** (`super_admin`/`vault_operator`).
- **Evaluación del riesgo real (según el encargo):**
  - **¿El role se re-deriva server-side?** **Sí.** El `role` **nunca** se lee del token de Google; se
    conserva el de BD y `:340` fija `customer` **solo** en altas nuevas. **No hay escalada de privilegios**
    por el token: un atacante no puede convertirse en admin vía Google.
  - **¿Un atacante con el Google del email de un admin podría tomar la cuenta?** **Solo si** (a) existe una
    cuenta back-office cuyo email es una cuenta Google **y** (b) el atacante controla esa cuenta Google (con
    `email_verified=true`). En ese caso obtendría tokens con el rol de BD de esa cuenta **sin** conocer su
    contraseña argon2. Es decir: **traslada** la seguridad de la cuenta privilegiada a la seguridad de su
    cuenta Google (phishing OAuth / falta de MFA). El linking exige `email_verified=true` y corta en
    `blocked`/`deleted` (`:312-314`), lo que acota el vector.
- **Severidad correcta (Baja)**, condicionada a que un back-office use email @gmail. **Rol dueño: backend**
  (restringir login/linking Google a `role=customer`, o exigir MFA en back-office; documentar si se permite).

### B-3 (Baja) — Dinero en `Int` 32-bit — **CONFIRMADO · = S-B2 / SEC-C2 · Aceptada para MVP**
- **Reconcilia con mi S-B2** (§5) y **SEC-C2** (bloque C, ya cerrado el vector *por-envío* con `@Max`, no la
  decisión de agregados). **No lo duplico.** Confirmado: `schema.prisma:393` `listPriceCents Int?` **sin
  `@Max` en el DTO**; múltiples `*Cents Int` en órdenes/inventario/agregados (máx 2^31-1 ≈ **MX$21.47M**).
- **¿Aceptable para MVP con topes actuales o se agenda?** **Aceptable para MVP.** Los flujos de entrada de
  usuario están acotados muy por debajo del límite: buylist **MX$3,000/solicitud** y **MX$10,000/mes** (topes
  AML de M10), envío capado a **MX$100,000** (SEC-C2 `@Max`). El riesgo es en **agregados** de P&L /
  portafolio / custody que sumen > ~MX$21.47M — no explotable por atacante externo, pero rompería features de
  dinero con datos legítimos grandes. **No bloquea el MVP;** se **agenda** la migración a `BigInt`.
- **Rol dueño: arquitecto** (decisión `BigInt` para agregados = cambio de schema/contrato) **+ backend**
  (cota `@Max` razonable en `listPriceCents`, análoga al `@Max` ya aplicado en `shippingCostCents`).
- **Disparador:** antes de que cualquier agregado (portafolio/P&L/custody) se acerque a MX$21M, o antes de
  operar a escala.

### B-4 (Baja) — `approvedPriceCents` sin cota, fijable por `vault_operator` — **CONFIRMADO · NUEVO = S-B5 · Aceptada**
- **Nuevo en mi registro** (asigno **S-B5**). Confirmado en dos puntos:
  - `buylist/dto/buylist.dto.ts:42` — `@IsOptional() @IsInt() @Min(0) approvedPriceCents?` **sin `@Max`** y
    **sin** validación contra `quotedPriceCents` ni contra el tope AML.
  - `buylist.service.ts:417-441` (`itemDecision`) — `data.approvedPriceCents = approvedPriceCents ??
    item.quotedPriceCents ?? 0`, sin cota. El endpoint `PATCH /admin/buylist/items/:itemId/decision`
    (`admin-buylist.controller.ts:87-103`) hereda `@Roles(vault_operator, super_admin)` de la clase (`:15`)
    y **no** es `@MoneyOut` → un **`vault_operator`** puede aprobar un monto arbitrario.
- **Mitigaciones existentes (verificadas):**
  - El **desembolso** `POST /admin/buylist/:id/pay-spei` **es `@MoneyOut()`** (`:122-123`) → **solo
    `super_admin`** vía `MoneyOutGuard`. El operador **no saca dinero**.
  - La decisión **queda auditada**: `admin-buylist.controller.ts:94-101` registra `buylist.item.<decision>`
    con `actorUserId`/`actorRole` y `after.approvedPriceCents`.
- **Análisis:** No es fraude de fondos por sí solo (segregación de funciones: el `super_admin` es quien paga),
  pero el monto que el super_admin termina pagando lo pudo **inflar** el operador, y no hay tope automático
  que lo frene si el pago se ejecuta sin re-verificar. Requiere **colusión o descuido** del super_admin.
  Es una brecha de **defensa en profundidad** en un flujo de dinero. **Severidad correcta: Baja.**
- **Rol dueño: backend** (cota superior en `approvedPriceCents`, p. ej. `≤ quotedPriceCents × factor`, o
  re-chequear el tope AML al aprobar/pagar; SoD reforzada).

### B-5 (Baja) — Token en query-string — **CONFIRMADO · = S15-B3 · Aceptada**
- **Reconcilia con mi S15-B3** (rev v1.5, §1). **No lo duplico.** Confirmado en `auth.service.ts:63-72`
  (`buildFrontendLink`): arma `${origin}/${locale}/(verify-email|reset-password)?token=<claro>`. El token en
  claro viaja como **query param** (inevitable para ser clicable desde el correo).
- **Severidad correcta (Baja).** **Mitigantes fuertes verificados:** un-solo-uso atómico (`consume()`
  `updateMany` con guardia `usedAt:null`), TTL corto (reset 1h), rotación de previos → un token filtrado por
  Referer/historial **ya no sirve** tras consumirse. Práctica estándar; riesgo residual bajo.
- **Rol dueño: frontend** (`history.replaceState` para retirar `?token=` tras consumir + `Referrer-Policy:
  no-referrer` en las rutas de auth). El backend ya acepta el token por body/POST; el link es lo que expone.
- **Nota DAST:** confirmar fuga real por `Referer` requiere frontend en vivo → §D.4.

## D.2 Cierre detectado desde mi última rev — S15-B4 (reset-password revalida estado) — **CERRADO** ✔
- En la rev v1.5 dejé **S15-B4** abierto (Baja): `resetPassword` no recomprobaba `status` al consumir el
  token. **Backend lo corrigió:** `auth.service.ts:237-240` ahora hace `findUnique` y **rechaza con
  `USER_BLOCKED`** si `!user || status !== active` **antes** de fijar `passwordHash`. Simetría con
  `forgotPassword` (que solo emite a `active`) y con `login`. **Verificado en código.** El pentester no lo
  reporta (correcto: ya no es hallazgo). Lo registro como cierre.

## D.3 Contraste con las defensas positivas del pentester (I-1…I-6) — concuerdo
Revisé de forma independiente los positivos que el pentester marca [Verificado en código] y **concuerdo** con
todos, consistente con mi §2 y anexos previos: tokens de correo CSPRNG/SHA-256/un-solo-uso atómico/rotados
(I-1, mi rev v1.5 §0); `EmailVerifiedGuard` server-side no evadible en los 3 endpoints de dinero (I-2, mi rev
v1.5 §0); montos derivados server-side en checkout y buylist —SEC-A1— con reserva atómica anti doble-venta
(I-3, mi §2 y B.4); webhook Stripe firma + idempotencia atómica + "procesado solo tras éxito" (I-4, mi §2);
money-out solo super_admin + IDOR/BOLA scoped por JWT + PII cifrada/enmascarada (I-5, mi §2); sin inyección
SQL / mass-assignment / secretos hardcodeados (I-6, mi §2 y A.4). **Sin regresión.**

## D.4 Pendiente de DAST en vivo (NO es fallo — agendar contra staging autorizado)
Coincido con la lista del pentester (PENTEST_NOTES §"Pendiente de DAST"). No ejecutable hoy (sin Docker/
Postgres/Redis; egress al dominio real denegado). Cuando exista **staging autorizado**, devops habilita y
pentester ejecuta (ZAP baseline/full + nuclei + scripts propios):
1. **Concurrencia real:** doble-checkout de pieza única (reserva atómica), doble `convert-to-inventory`
   (índice único P2002), bypass del tope mensual de buylist (`$transaction` Serializable). Guardias en código;
   falta probar la carrera real.
2. **Webhook Stripe con firmas reales:** replay del mismo `event.id`, firma inválida, eventos forjados de
   refund/dispute; confirmar idempotencia y "procesado solo tras éxito".
3. **Rate-limit efectivo** en `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` y cotizador;
   validar el `ThrottlerGuard` in-memory y su **debilidad en multi-instancia sin Redis** (store compartido).
4. **B-1 timing:** medir la asimetría de latencia de `forgot-password` entre emails existentes/inexistentes.
5. **B-5 Referer:** cargar `verify-email`/`reset-password` y observar fuga del token por `Referer`/historial.
6. **CORS** cross-origin real contra la allow-list; **abuso de presign** (subir objeto que exceda el tope /
   content-type no imagen y confirmar rechazo de S3/MinIO).

## D.5 Deuda de seguridad aceptada (no bloqueante) — consolidada tras este pase

| ID (seguridad) | = Pentest | Deuda | Impacto | Disparador | Rol dueño |
|---|---|---|---|---|---|
| S-M1 | M-1 | `@nestjs/core` SSE injection sin parchar (fix = major 10→11) | Ninguno hoy (sin SSE) | Antes de cualquier endpoint SSE, o próxima ventana de deps | devops |
| S-B1 | B-2 | Google-linking alcanza back-office | Traslada seguridad de cuentas privilegiadas a Google | Antes de alta de back-office con email @gmail; o exigir MFA back-office | backend |
| S-B2 | B-3 | Dinero en `Int` 32-bit (agregados) | Overflow de integridad > ~MX$21.47M | Antes de que agregados se acerquen a MX$21M / operar a escala | arquitecto (+backend) |
| S-B5 | B-4 | `approvedPriceCents` sin `@Max`/cota AML, fijable por operador | Monto inflado que el super_admin podría pagar sin re-check (SoD/DiD) | Cerrar antes de GA con buylist a volumen; cota + re-check AML al pagar | backend |
| S15-B2 | B-1 | Timing en `forgot-password` | Enumeración por canal lateral (ya expuesta por `409` de register) | Endurecimiento previo a GA / pase DAST | backend |
| S15-B3 | B-5 | Token en query-string | Fuga potencial por Referer/historial (mitigada por single-use+TTL) | Endurecimiento previo a GA / pase DAST | frontend |
| SEC-C3 | — | SoD: `vault_operator` escribe insumo del P&L (`shippingCostCents`) | Costo inflado reduce ganancia reportada (auditado) | Decisión de producto | backend/producto |

Cerrados/mitigados vigentes (no reabren): S-M2 (CORS), S-B4 (helmet/HS256/env), S-B3 (presign, residuo Bajo
aceptado), SEC-C1 (fuga de margen), SEC-C2 (`@Max` shipping), **S15-B4 (reset revalida estado)** ✔,
S15-B1 (escape HTML de `name` en plantilla — recomendado cerrar; no bloqueante).

## D.6 Banderas para el humano (antes de operar con dinero real)
- **Fase dinámica (DAST/pentester contra staging) — PENDIENTE Y OBLIGATORIA, no aprobada a ciegas.** Todo
  este pase (pentester + esta consolidación) es **caja gris estática**; los vectores §D.4 exigen staging
  (R2/Railway aún sin configurar). Requisito previo a la promoción a producción.
- **Pentest de tercero + programa de bug bounty** antes del go-live con dinero real (superficie de pagos,
  money-out y recuperación de contraseña).
- **KMS/secret manager en producción** para `JWT_*`, `STRIPE_*`, `PII_*` y `S3_*`; rotación; sin secretos en
  logs/errores. `env.validation.ts` ya rechaza arranque no-local sin secretos y con secretos JWT débiles; la
  **provisión** del secret manager es de devops.
- **Validaciones legales de custodia/PII (INE/CLABE):** figura de depositario, contrato de custodia, base
  legal del INE almacenado, retención `INE_RETENTION_DAYS`, derecho de supresión frente a PII en snapshots
  económicos retenidos (`Order.billingSnapshot`/`SellRequest.clabeSnapshotEnc`). Confirmar con abogado/contador.
- **MFA para back-office** si alguna cuenta privilegiada usa email Google (cierra el riesgo real de B-2/S-B1).

## D.7 VEREDICTO — consolidación del pase pentest v1.5

**VEREDICTO seguridad (revisión estática de código): APROBADO.**

- **Concuerdo con el conteo del pentester: 0 Críticas / 0 Altas abiertas.** Validé los 6 hallazgos en el
  código: **todos reales** (ningún falso positivo), **todas las severidades correctas**. El criterio de
  RECHAZO (`CLAUDE.md` §7: hay críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Lo abierto es 1 Media no alcanzable (M-1/S-M1, sin SSE) + 5 Bajas**, todas **aceptadas con disparador y
  rol dueño** (§D.5). Cuatro ya estaban en mi registro (reconciliadas, no duplicadas); una es nueva (B-4 →
  **S-B5**). Además **S15-B4 quedó CERRADO** por backend desde la última rev.
- **Ruteo por rol dueño:**
  - **devops** → M-1 (bump NestJS 11 + gate `npm audit`), habilitar staging para DAST, bucket INE privado +
    límite de policy, store Redis para throttler multi-instancia, `APP_BASE_URL`/secret manager.
  - **backend** → B-1/S15-B2 (timing forgot-password), B-2/S-B1 (política linking Google/MFA back-office),
    B-4/S-B5 (cota `approvedPriceCents` + re-check AML), B-3 parcial (`@Max` en `listPriceCents`),
    S15-B1 (escape HTML del `name`, recomendado).
  - **arquitecto** → B-3/S-B2 (decisión `BigInt` para agregados de dinero — cambio de schema/contrato).
  - **frontend** → B-5/S15-B3 (limpiar token de la URL + `Referrer-Policy` en páginas de auth).
- **DoD de seguridad:** **APROBABLE** en la parte estática (sin críticos/altos; bajas/media aceptadas y
  registradas). **Condición previa a producción (no bloquea el DoD estático, sí la promoción a prod):**
  ejecutar la **fase dinámica (DAST) contra staging** (§D.4) — hoy imposible por falta de infra, **no** por
  un hallazgo. En cuanto haya staging autorizado se re-emite veredicto para el gate de promoción a prod.
- **Mínimo para mantener la aprobación:** no debilitar los guardarraíles verificados (reserva atómica,
  idempotencia/firma del webhook, money-out solo super_admin, gating `EmailVerifiedGuard` server-side,
  consumo atómico de tokens, PII cifrada/enmascarada, derivación server-side de montos SEC-A1).

---

## E. Revisión AppSec — feature de acabado / *finish* v1.6-finish (M-18) — SIN COMMITEAR

> **Rol:** seguridad (blue team). **Alcance:** feature de acabado/finish en el working tree (aún sin
> commitear; `git status` = M-18 + ~40 archivos). **Foco:** integridad financiera **SEC-A1** — que el
> acabado no abra un vector para pagar de más/menos en cotización, compra, buylist o valuación.
> **Modo:** revisión **estática de código** (sin stack vivo; Docker/Postgres ausentes, igual que el
> pentester). Verificados por lectura = **[Verificado en código]**; dinámicos = **[pendiente DAST]**.
> **Fecha:** 2026-08-16 (rev **v1.6-finish**). Blanco autorizado: código + staging/local.
> **Nota:** el pase v1.5 del pentester **no** cubre esta feature (su foco fue correo M-17); esta sección
> es la consolidación blue-team de la superficie nueva de finish. No duplica los hallazgos B-1…B-5/M-1.

### E.0 Resumen ejecutivo

**SEC-A1 se mantiene INTACTO con el acabado.** El monto de cotización/compra/valuación se deriva
**siempre server-side** de `(Card.rarity, finish)` — la rareza de la BD (`Card.rarity` vía `findUnique`) y
el `finish` **validado** contra `Card.availableFinishes` — nunca de un precio/categoría/monto del cliente.
El enum `Finish` (Prisma + `@IsIn` en los DTOs) acota los valores a los **4 canónicos**; la `availableFinishes`
por carta es la **lista blanca**; un acabado fuera de ella se **bloquea 422 FINISH_NOT_AVAILABLE** en los
**tres** puntos de entrada (quote, request, alta de inventario). **Sin nueva superficie de inyección/SSRF** en
el import (host fijo, `setId` regex, `encodeURIComponent`, derivación de acabados solo desde llaves conocidas).

**No hay hallazgos Críticos ni Altos en esta feature.** Lo abierto es **defensa en profundidad / consistencia**
(2 Bajas, ligadas a la ya conocida S-B5/B-4). El resto son defensas verificadas (positivas).

| Severidad (feature finish) | # |
|---|---|
| Crítica | 0 |
| Alta | 0 |
| Media | 0 |
| Baja | 2 (S16-B1, S16-B2) |
| Info/positivo | 5 (S16-I1…I5) |

### E.1 Defensas verificadas (positivo) — SEC-A1 con acabado

**S16-I1. Derivación server-side del monto por (rareza, acabado) — [Verificado en código].**
- Cotizador: `buylist.service.ts:58-95` (`publicQuote`) → `quoteAcquisitionForFinish(card.rarity, f, ref, rules, fallbackPct)` (`money.ts:155-167`). La `rarity` sale de `card` (`findUnique`, :64); el `finish` se valida (:67); la referencia del `pct` es la del **acabado** (`getReference(cardId, productType, gradeKey, f)`, :71). El DTO **nunca** aporta precio/monto/regla.
- Solicitud: `buylist.service.ts:152-179` — misma derivación por item; `quotedTotalCents` se **acumula server-side** (:166), imposible de inflar desde el DTO. La regla aplicada se **snapshotea** (rarity/ruleMode/ruleValue/ruleSource/finish, :167-178) para auditoría.
- Resolver determinista: `ruleKeyCandidates` (`money.ts:114-126`) mapea `finish→ruleKey` sin entrada del cliente; `reverse_holo→["Reverse Holo"]`, `holofoil/1st→isHoloRarity?[rarity,"Holo"]:["Holo"]`, `normal→[rarity]`.

**S16-I2. `FINISH_NOT_AVAILABLE` validado server-side en las 3 rutas, no evadible por API directa — [Verificado en código].**
- Quote: `assertFinishAvailable(card, finish)` (`buylist.service.ts:44-55`, llamado en :67).
- Request: mismo guard por item (`buylist.service.ts:156`).
- Alta de inventario M1: `resolveFinish(dto, card.availableFinishes)` (`inventory.service.ts:110-122`, llamado en :39).
- La validación vive en el **servicio** (no en el front) → una llamada directa a la API no la evade. Un acabado inexistente/arbitrario cae en **422**, **no** en el fallback (el fallback solo aplica a un acabado *válido y disponible* sin regla explícita, resolviéndose a `BUYLIST_PRICE_FALLBACK_PCT`). Bloquea los tres vectores del brief: (a) forzar fallback/regla arbitraria, (b) reclamar un acabado con market más alto, (c) evadir por API directa.

**S16-I3. Enum acotado a los 4 valores canónicos — [Verificado en código].**
- Prisma `enum Finish { normal reverse_holo holofoil first_edition_holofoil }` (`schema.prisma:58-63`); columnas `Card.availableFinishes Finish[] @default([normal])` (:356), `InventoryItem.finish` (:412), `PriceReference.finish` (:463), `SellRequestItem.finish` (:628).
- DTOs: `@IsIn(FINISHES)` en `PublicQuoteDto`/`RequestItemDto` (`buylist.dto.ts:15,23,31`), `CreateItemDto.finish` (`inventory.dto.ts:24`), `OverrideDto.finish` (`pricing.controller.ts`). `ValidationPipe({whitelist:true})` (`main.ts:43`) descarta cualquier campo extra (p. ej. un `price`/`category`/`amountCents` malicioso) → **sin mass-assignment**.
- **Default seguro para filas históricas:** sin re-sync, `availableFinishes = [normal]` (default de schema + guard `?? ['normal']` en `assertFinishAvailable`/`resolveFinish`/`toCardDTO`) → hasta el re-sync **solo `normal` es cotizable/dable de alta**; el resto → 422. No hay degradación insegura.

**S16-I4. Snapshot y propagación de acabado consistentes; no mutable entre cotización y aprobación — [Verificado en código].**
- `SellRequestItem.finish` se fija en `createRequest` (validado, :156-172) y se **propaga** intacto a `InventoryItem.finish` al convertir (`convertToInventory`, `buylist.service.ts:525`), bajo la misma guardia de aprobación (`itemStatus==='aprobada'`, :505) e índice único `sourceSellRequestItemId` (anti doble-conversión, :514-560).
- `itemDecision` (:461-486) **no** toca `finish` → el acabado no se puede cambiar tras cotizar para alterar el precio. Checkout (`orders.service.salePriceOf`) usa `item.finish` de la **BD** + `inventoryItemIds` del DTO: el comprador **no** puede manipular el acabado para pagar menos.
- Valuación (portafolio/custody/inventario/P&L) usa `item.finish` de la BD en todos los consumidores: `vault.service.ts:157,161`, `admin.service.ts:347,366`, `orders.service.ts:28`, `price-sync.service.ts:50`.

**S16-I5. Import/sync sin inyección/SSRF nueva — [Verificado en código].**
- `deriveAvailableFinishes` (`pricing.types.ts:31-41`) solo mapea las **4 llaves conocidas** de `tcgplayer.prices` (`TCG_KEY_TO_FINISH`) e **ignora** las demás; ausente/vacío → `[normal]`. El provider lee `prices[FINISH_TO_TCG_KEY[finish]].market` (llave del acabado pedido), con guarda `typeof market==='number' && >0` (`pokemontcg-io.provider.ts:45-49`).
- Host **fijo** `https://api.pokemontcg.io/v2` (no configurable, anti-SSRF), `setId` validado con `SET_ID_PATTERN` antes de interpolar y `encodeURIComponent(`set.id:${setId}`)` (`pokemontcg-io.client.ts:48-49,97-101`; `catalog-sync.service.ts:11,82`). Dato externo de pokemontcg.io tratado como no confiable: `rarity` es String libre parametrizado por Prisma (sin `$queryRaw`), carta inválida se **omite** sin abortar el barrido (:281-319).

### E.2 Hallazgos (Bajas — defensa en profundidad / consistencia)

**S16-B1. La ruta de buylist (quote/request) no fuerza `finish=normal` para `graded`/`sealed` (inconsistencia con el alta y el contrato).**
- **Vector:** consistencia de regla de negocio en flujo de dinero (no explotable a pago).
- **Ubicación:** `buylist.service.ts:67,156` — `assertFinishAvailable` valida el `finish` contra `availableFinishes` **sin importar** `productType`. En cambio el alta de inventario **sí** fuerza `normal` para no-raw (`inventory.service.ts:111`, `resolveFinish`), y el contrato dice "graded/sealed → finish=normal" (API_CONTRACT §DTOs, ARCHITECTURE §3.7).
- **Análisis:** un `POST /buylist/quote|requests` con `productType=graded|sealed` y `finish=reverse_holo|holofoil` (si la carta lo tiene en `availableFinishes`) seleccionaría la regla de ese acabado (p. ej. "Reverse Holo" fijo). **No rompe SEC-A1** (sigue derivado server-side) ni produce sobrepago real: el buylist es **NM-only** y el desembolso (`pay-spei`) ocurre **solo tras recepción física + verificación** por `super_admin` (money-out, auditado), que confirma el acabado físico. Peor caso: un **estimado** espurio que el operador rechaza en verificación.
- **PoC [Verificado en código; sin impacto de pago]:** cotizar graded/sealed con finish no-normal disponible → estimado por regla del acabado; no hay ruta automática a SPEI sin verificación física.
- **Impacto:** Bajo (consistencia; el pago está físicamente verificado y server-derivado).
- **Rol dueño:** **backend** (forzar `finish='normal'` para `productType!=='raw'` en `publicQuote`/`createRequest`, espejando `resolveFinish`).

**S16-B2. El precio aprobado no se re-deriva contra el acabado físicamente verificado (extiende B-4/S-B5).**
- **Vector:** segregación de funciones / integridad del monto a pagar en buylist (defensa en profundidad).
- **Ubicación:** `buylist.service.ts:470-472` — `itemDecision('approve')` fija `approvedPriceCents = approvedPriceCents ?? item.quotedPriceCents ?? 0`. El `quotedPriceCents` se computó del acabado **declarado por el vendedor** en la cotización; al aprobar **no** se re-deriva `quoteAcquisitionForFinish` contra el acabado **físicamente verificado**, ni hay cota (esto es exactamente el eje de **B-4 / S-B5**, ahora con la dimensión de acabado).
- **Análisis / mitigación existente:** cherry-pick manual carta por carta, NM-only, `pay-spei` **solo `super_admin`** (`@MoneyOut`, auditado). El operador debe cotejar acabado físico vs declarado antes de aprobar; hoy es control **manual**, no de código.
- **Impacto:** Bajo (SoD + auditoría + verificación física mitigan; requiere descuido/colusión). Consolida con **S-B5**: la cota/re-check de `approvedPriceCents` debería **re-derivar por el acabado verificado**.
- **Rol dueño:** **backend** (al aprobar/pagar: re-derivar el monto por el acabado verificado y/o acotar `approvedPriceCents ≤ quotedPriceCents×factor`, y re-chequear el tope AML — unifíquese con S-B5).

### E.3 Deuda de seguridad aceptada (feature finish) — no bloqueante

| ID | Deuda | Impacto | Disparador | Rol dueño |
|---|---|---|---|---|
| S16-B1 | Buylist no fuerza `normal` en graded/sealed | Consistencia; sin sobrepago (verificación física) | Antes de GA del buylist; alinear con `resolveFinish` | backend |
| S16-B2 | Aprobado no re-derivado por acabado verificado | SoD/DiD; mitigado por money-out + verificación manual | Cerrar junto con S-B5 (cota + re-check AML al aprobar/pagar) | backend |

### E.4 Banderas para el humano (específicas de la feature)
- **Re-sync obligatorio del catálogo tras desplegar M-18** (API_CONTRACT changelog v1.6-finish): hasta poblarse `availableFinishes` + precios por acabado, las cartas históricas quedan en `[normal]` (comportamiento seguro, pero cotización limitada a normal). Confirmar que el re-sync corre en la ventana de deploy.
- Reafirmo las banderas D.6 vigentes (pentest de tercero + bug bounty antes de dinero real; validaciones legales de custodia/PII INE/CLABE). La feature de finish **no** altera la superficie de PII/money-out.

### E.5 VEREDICTO — feature de acabado / finish v1.6-finish

**VEREDICTO seguridad (revisión estática): APROBADO.**

- **0 Críticas / 0 Altas** en la feature de finish. **SEC-A1 intacto**: monto siempre derivado server-side de `(Card.rarity, finish)` validado contra `Card.availableFinishes`; DTOs solo aceptan `finish` (enum de 4 valores), sin precios; `ValidationPipe(whitelist)` descarta extras; enum Prisma + lista blanca acotan los valores; `FINISH_NOT_AVAILABLE` server-side en quote/request/alta, no evadible por API directa; snapshot de acabado consistente y propagado sin mutación entre cotización y aprobación; import sin inyección/SSRF nueva.
- **Lo abierto son 2 Bajas** (S16-B1 consistencia; S16-B2 = eje de B-4/S-B5 con dimensión de acabado), **aceptadas con disparador y rol dueño** (backend). El criterio de RECHAZO de `CLAUDE.md` §7 (críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Mínimo para mantener la aprobación:** no debilitar los guardarraíles verificados en S16-I1…I5 (derivación server-side por rareza+acabado, validación `availableFinishes`, snapshot/propagación de `finish`, host fijo + `setId` regex del import). Al cerrar **S-B5** (cota/re-check de `approvedPriceCents`), **incluir la re-derivación por el acabado físicamente verificado** (S16-B2).
- **Condición previa a producción (no bloquea el DoD estático):** ejecutar la **fase dinámica (DAST) contra staging** para los vectores de concurrencia/pago ya listados en §D.4 (doble-conversión, reserva atómica, tope mensual) — ahora también **carrera de conversión con `finish`** — más el **re-sync M-18** confirmado en el deploy.

---

## Revisión v1.7-admin-users (E: alta de usuarios por rol · F: historial/auditoría por usuario)

> **Rol:** seguridad (blue team). **Alcance:** features **v1.7-admin-users** en el working tree **SIN commitear**
> (`git status`: `admin.controller.ts`, `admin.service.ts`, `audit.service.ts`, controllers/services de
> buylist/shipments/disputes con `?userId=`, DTOs, `M6View.tsx`, `lib/api.ts` + specs nuevos). Sensibles:
> creación de cuentas, asignación de rol, lectura de auditoría/PII.
> **Modo:** revisión **estática** de código (sin stack vivo: sin Docker/Postgres, igual que el pentester).
> Verificados por lectura = **[Verificado en código]**; los dinámicos = **[pendiente de DAST]**.
> **Insumo:** `docs/PENTEST_NOTES.md` (pase v1.5) — el pentester **no** cubrió esta feature (es posterior a su
> pase); esta sección es revisión **propia** del blue team sobre el delta v1.7. **Fecha:** 2026-08-16.

### V17.1 Foco 1 — Escalada de privilegios (POST /admin/users) — [Verificado en código] SIN hallazgo

- **super_admin-only efectivo, no evadible.** `AdminUsersController` tiene `@Roles(vault_operator, super_admin)`
  a nivel clase, pero `createUser` lleva `@Roles(super_admin)` a nivel método (`admin.controller.ts:66`). El
  `RolesGuard` resuelve con `reflector.getAllAndOverride(ROLES_KEY, [getHandler(), getClass()])`
  (`roles.guard.ts:17-20`): **el método gana sobre la clase** → el POST exige `super_admin`. Orden de guards
  global correcto: `JwtAuthGuard → RolesGuard → EmailVerifiedGuard → MoneyOutGuard` (`app.module.ts:63-67`),
  con `req.user.role` poblado desde BD. Un `vault_operator` → **403 FORBIDDEN** (no puede crear usuarios ni
  auto-promoverse). No es money-out (correcto: no toca dinero saliente).
- **`role` desde enum validado, no manipulable.** El rol se valida en el servicio contra la lista blanca
  `[customer, vault_operator, super_admin]` (`admin.service.ts:79-83`), **no** se lee de token ni de otra
  fuente; valor fuera de la lista → **422 VALIDATION_ERROR**.
- **Creación de `super_admin` auditada.** El controller registra `action:'user.create'`, `entityType:'User'`,
  `entityId=res.user.id`, con `after` **solo metadatos no sensibles** (`role, emailVerified, authProvider,
  mustChangePassword`) — **sin password** (`admin.controller.ts:72-85`).
- **Sin regresión en el registro público.** El diff **no toca** `auth.service.ts`; `register`/`google` siguen
  forzando `role:customer` (confirmado por pentester I-6). No hay ruta de auto-alta a rol privilegiado.

### V17.2 Foco 2 — Manejo de credenciales — [Verificado en código] SIN hallazgo

- **argon2 + CSPRNG.** Password provista o autogenerada se hashea con `argon2.hash` (`admin.service.ts:114`).
  La autogeneración usa `randomBytes(18).toString('base64url')` (**CSPRNG**, no `Math.random`;
  `admin.service.ts:104`), mismo generador que el reset M-15.
- **`tempPassword` una sola vez, nunca persistida en claro ni auditada.** Se devuelve en la respuesta **solo si
  se autogeneró** (`...(autogenerated ? { tempPassword } : {})`, `:154`); si el admin la provee, **no** se
  devuelve. El `after` del `user.create` **no** contiene password/hash; `reset-password` audita solo el hecho
  (actor/target/acción), sin la temporal (`admin.controller.ts:176-184`). El shape público de `user` **excluye
  `passwordHash`** (`:142-152`).
- **Frontend:** `M6View.tsx` mantiene la temporal **solo en memoria**, la muestra una vez y ofrece copiar al
  portapapeles; **sin** `console.log` ni `localStorage`. (El mock de `lib/api.ts:createAdminUser` usa
  `Math.random` para simular la temporal, pero es **rama mock de test**, nunca la ruta real — ver V17.7/Info.)

### V17.3 Foco 3 — Fuga de PII en auditoría (GET /admin/users/:id/audit) — [Verificado en código] SIN hallazgo

- **`before`/`after` NUNCA se exponen.** `audit.service.ts:listForUser` usa un `select` explícito
  (`id, actorUserId, actorRole, action, entityType, entityId, createdAt`) que **no** incluye `before`/`after`
  (`audit.service.ts:96-105`). Estos campos pueden traer PII/estado y quedan fuera de la proyección.
- **`ip` condicionado a `super_admin`.** El `ip` solo se agrega al `select` cuando `role===super_admin`
  (`...(isSuperAdmin ? { ip: true } : {})`, `:104`); el `vault_operator` **ni lo selecciona de BD** (no viaja).
- **404 si el usuario no existe** (`:79-80`); `scope` normalizado a `target|actor|both` en el controller con
  default `target` (`admin.controller.ts:108-112`); paginación acotada (`pageSize ≤ 100`).

### V17.4 Foco 4 — IDOR / filtros `?userId=` (buylist/shipments/disputes) — [Verificado en código] SIN hallazgo

- Los 4 endpoints de listado admin (`/admin/buylist`, `/admin/shipments`, `/admin/disputes`, y `/admin/orders`
  reusado por el front) mantienen `@Roles(vault_operator, super_admin)` a nivel clase. El `?userId=` **solo
  agrega una cláusula `where.userId`** al listado ya paginado (`buylist.service.ts`, `shipments.service.ts`,
  `disputes.service.ts`, ramas `if (userId) where.userId = userId`). **No** hay bypass de guard: un no-admin
  no alcanza estos endpoints (RolesGuard → 403). Un `vault_operator` **ya** podía listar todo sin el filtro →
  el filtro **no amplía** su superficie (solo acota). No es IDOR.
- **Proyección PII por rol intacta:** el cambio es puramente un filtro `where`; **no** modifica el `select`/DTO
  de esos listados (buylist/disputes/shipments) → la proyección PII previa (pentester I-5) se mantiene.

### V17.5 Foco 5 — Whitelist / mass-assignment — [Verificado en código] SIN hallazgo

- `CreateAdminUserDto` declara **solo** `email, name, role, password?, phone?, locale?` (`admin.controller.ts:27-34`).
  `ValidationPipe({whitelist:true})` global **descarta** cualquier campo extra del body (`status`,
  `emailVerified`, `tokenVersion`, `mustChangePassword`, `googleId`, `authProvider`…). Defensa redundante: el
  servicio `createUser` **solo lee** los 6 campos permitidos (firma tipada), así que aunque el whitelist fallara,
  los campos sensibles **no** se leen del body.
- **El server fija los campos de confianza:** `emailVerified:true`, `authProvider:'local'`, `status` (default de
  columna) y `mustChangePassword` (derivado de `autogenerated`) los pone el servicio, **no** el cliente
  (`admin.service.ts:118-131`).

### V17.6 Foco 6 — Enumeración (409 EMAIL_TAKEN) — Info / aceptable

- `createUser` mapea `P2002` a **409 EMAIL_TAKEN** (`admin.service.ts:134-136`), revelando existencia de email.
  **Aceptable:** endpoint **admin-only** (`super_admin`), es back-office; el operador legítimamente necesita
  saber si el email ya existe. Consistente con el canal de enumeración ya existente en `register`
  (pentester B-1). **Sin acción bloqueante.**

### V17.7 Hallazgos priorizados de esta feature

| ID | Sev | Descripción | Ubicación | Rol dueño |
|---|---|---|---|---|
| V17-I1 | Info | 409 EMAIL_TAKEN enumera email en endpoint admin-only (aceptable en back-office) | `admin.service.ts:134-136` | — (aceptado) |
| V17-I2 | Info | Password provista por admin sin `@Max`/política de complejidad (solo `MinLength 8`, paridad con `register`); `mustChangePassword=false` cuando el admin la provee (por diseño) | `admin.service.ts:106-112` | backend (opcional) |
| V17-I3 | Info | Mock del front (`createAdminUser`) genera la temporal con `Math.random` — **solo rama mock/test**, jamás la ruta real (backend usa CSPRNG). Sin impacto en producción | `frontend/src/lib/api.ts:createAdminUser` | frontend (higiene) |
| V17-Obs | Obs | `getUser` (pre-existente, **fuera del delta v1.7**) hace `...safe` y expone al back-office campos como `googleId`/`tokenVersion`/`mustChangePassword`. No introducido por esta feature; se anota para depuración futura de la ficha | `admin.service.ts:203,240` | backend (deuda menor, no v1.7) |

**No hay hallazgos Críticos ni Altos ni Medios ni Bajos nuevos en el delta v1.7-admin-users.** Los ítems son
Info/observación aceptados con disparador.

### V17.8 Banderas para el humano

- **Reafirmo** las banderas vigentes: pentest de **tercero** + **bug bounty** antes de operar con **dinero real**;
  validaciones **legales** de custodia y **PII (INE/CLABE)**. La feature v1.7 **no** altera la superficie de
  money-out ni de INE/CLABE (crea cuentas sin KYC; el KYC sigue su flujo aparte).
- **Poder de `super_admin`:** el alta permite crear otros `super_admin` (por diseño). Queda **auditado**
  (`user.create`), pero se recomienda al humano **revisar periódicamente** el `AuditLog` de `user.create`/
  `user.delete`/`user.reset_password` y considerar **MFA** para cuentas de back-office (se cruza con pentester
  B-2: linking Google alcanza cuentas privilegiadas).
- **DAST pendiente en staging** (no ejecutable aquí, sin stack vivo): confirmar 403 real de `vault_operator`
  contra `POST /admin/users`, `PATCH .../kyc|status`, `DELETE`, `reset-password`; y que `GET .../audit` no
  devuelve `ip` para `vault_operator` ni `before/after` para ningún rol.

### V17.9 VEREDICTO — v1.7-admin-users

**VEREDICTO seguridad (revisión estática): APROBADO.**

- **0 Críticas / 0 Altas / 0 Medias / 0 Bajas** en el delta v1.7-admin-users. Los 6 focos de seguridad quedan
  **[Verificado en código]**: (1) escalada de privilegios cerrada (super_admin-only efectivo por override de
  `@Roles` + guard global, rol desde enum validado, alta de super_admin auditada, sin regresión del registro
  público→customer); (2) credenciales argon2 + CSPRNG, `tempPassword` una-vez y **fuera** del AuditLog;
  (3) auditoría por usuario sin `before/after` y con `ip` solo para super_admin; (4) `?userId=` sin IDOR ni
  bypass de guard, proyección PII intacta; (5) sin mass-assignment (whitelist + campos de confianza server-side);
  (6) enumeración admin-only aceptable.
- El criterio de RECHAZO de `CLAUDE.md` §7 (críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Mínimo para mantener la aprobación:** no debilitar los guardarraíles verificados (override `@Roles(super_admin)`
  en `createUser`; `after` de auditoría sin password; `select` de `listForUser` sin `before/after` y `ip`
  condicional; whitelist del DTO). **Antes de GA con dinero real**, ejecutar la fase **DAST** de V17.8 contra
  staging autorizado.

---

## V18 — Revisión LIGERA rediseño 5a (rama `claude/rediseno-5a-pantallas`, 2026-08-16)

**Alcance:** solo-frontend, 51 archivos (49 en `frontend/` + 2 docs), delta `main...HEAD`
(+2696 / -2191). Cambios de **capa de presentación**: tokens de color/tipografía, `tailwind.config.ts`,
`globals.css`, componentes `ui/` y `domain/`, shells/headers. **No** añade endpoints, **no** toca auth,
datos, dinero ni el contrato de API. Objetivo: confirmar que no hay superficie de seguridad nueva.

### V18.1 Verificaciones (todas [Verificado en código])
1. **XSS / inyección de markup:** `grep` sobre `frontend/src/` → **0** ocurrencias de
   `dangerouslySetInnerHTML`, `eval(`, `new Function`, `innerHTML`, `<script>`. El delta no introduce
   ninguna. Todo texto dinámico se renderiza como hijo JSX (auto-escapado por React).
2. **Fuentes / recursos remotos y CSP:** las tipografías migran a **`next/font/google`** (`Archivo`,
   `JetBrains_Mono`, `Zen_Old_Mincho`) en `frontend/src/app/[locale]/layout.tsx`. `next/font` **auto-hospeda**
   los archivos en build-time y los sirve desde el propio origen (variables `--font-serif/-sans/-mono`); **no**
   hay fetch en runtime a `fonts.googleapis.com`/`gstatic`/CDN externo → **no evade la CSP**. `grep` de
   `fonts.googleapis|gstatic|cdn.|http://` en `frontend/src/` → **0** matches.
3. **Exposición de datos nuevos en cliente:** sin cambios en `lib/` (`git diff --name-only` no lista
   `frontend/src/lib/*` → `useCart` **intacto**). `AuthForm.tsx` y `GoogleSignInButton.tsx` son cambios
   **visuales**: sin nuevos `token/secret/client_id/fetch/window/localStorage/process.env`. No se filtran
   tokens/PII/secretos que antes no estuvieran.
4. **Carrito en header (`StorefrontHeader`) / `ListingSpec`:** el header solo importa el `useCart` existente
   y pinta el `count` (número). `ListingSpec` construye `line = parts.join(' · ')` desde **claves i18n** +
   datos de carta (`grade`, `certNumber`, `rawCondition`) y los usa como texto JSX y en `title`/`aria-label`;
   React escapa tanto hijos como valores de atributo → **sin inyección vía nombre/condición de carta**.
5. **`localStorage`:** las únicas apariciones en el delta son (a) la **eliminación** de `ThemeToggle`
   (tema único claro) y (b) el patrón ya existente de `useCart` (líneas de carrito locales, sin credenciales).
   No hay almacenamiento nuevo de datos sensibles.

### V18.2 VEREDICTO — rediseño 5a
**Rev rediseño 5a — sin superficie de seguridad nueva. APROBADO para el registro.**
- **0 Críticas / 0 Altas / 0 Medias / 0 Bajas** en el delta 5a. Es capa de presentación pura: sin endpoints,
  sin auth/datos/dinero/contrato, sin recursos remotos no confiables, sin nuevas rutas de XSS.
- El criterio de RECHAZO de `CLAUDE.md` §7 (críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Mínimo para mantener la aprobación:** conservar `next/font` self-hosted (no reintroducir `<link>` a CDN de
  fuentes que requiera relajar la CSP) y no pasar datos de carta por `dangerouslySetInnerHTML`. El veredicto
  de seguridad global del proyecto sigue gobernado por las secciones previas (auth/dinero/PII), inalteradas por 5a.

---

## rev v1.6 — Ronda B deuda backend (2026-08-16): scheduler + jobs manuales + tope `approvedPriceCents`

**VEREDICTO: APROBADO** (revisión estática) — 0 Críticos / 0 Altos / 0 Medios.

- **B-4 / S-B5 (tope `approvedPriceCents`) → CERRADO.** Doble capa: DTO `@Max(MAX_APPROVED_PRICE_CENTS=1_000_000)` (rechaza el PoC `99999999` con 400) + server-side `assertApprovedPriceWithinCap = min(quotedPriceCents×2, buylist_cap_per_request_cents)` en `itemDecision` (approve/adjust) → `422 APPROVED_PRICE_CAP_EXCEEDED`. Desembolso SPEI sigue `@MoneyOut` super_admin + auditado, usa el monto capado como base de costo. Un `vault_operator` ya no aprueba montos arbitrarios.
- **ine-retention (borrado de PII):** predicado seguro — no purga con solicitudes abiertas (`openCount>0 → skip`); solo tras `INE_RETENTION_DAYS` desde el cierre; borra objeto R2 + nulifica keys BD; corre diario + disparo manual super_admin.
- **`/admin/jobs/*`:** super_admin-only (guards globales) + auditados; el operador no dispara borrado de PII ni sweeps; sin dinero saliente.
- **Sweeps:** solo mutan estados no-monetarios; no liberan dinero ni saltan el gating de aprobación a inventario (una `abandonada` deja ítems en `cotizada`, y `convertToInventory` exige `aprobada`).

**Hallazgos no bloqueantes:**
- **SEC-D1 (Baja, con disparador):** INE huérfano en el bucket si `deleteObject` de R2 falla (las keys se nulifican igual). Cerrar con lifecycle/retención a nivel de bucket R2 [devops]; opcional reordenar para purgar R2 antes de nulificar [backend]. Mismo patrón que B.2.
- **SEC-D2 (Baja):** `closureDate` aproxima el cierre por `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)`; para `rechazada`/`abandonada` cae en `createdAt` → puede purgar algo antes que "N días desde el cierre real". Minimización de datos (a favor), no incidente. Precisión: añadir `closedAt` explícito [backend/arquitecto].
- **SEC-D3 (Info, no seguridad):** `SellRequest.approvedTotalCents` se LEE en P&L/dashboard pero NUNCA se escribe → la tarjeta "buylist del periodo" suma 0/null. Bug de reporte financiero [backend]: poblar `approvedTotalCents` al aprobar/pagar o derivarlo de `SellRequestItem.approvedPriceCents`.

**Pendiente heredado (no bloquea DoD estático):** fase DAST contra staging (concurrencia real de sweeps/decision/pay-spei; scheduler multi-instancia con Redis compartido). Confirmar con legal el plazo/anclaje de retención de INE (LFPDPPP).

---

## rev v1.8-ronda-c — Enriquecimiento M-19 + cierre de vectores de dinero/PII iniciados en Ronda B (2026-08-16)

> **Alcance:** contrato `v1.8-ronda-c` (commit `857f10b`, aditivo) + backend/frontend **sin commitear
> en el working tree**. Focos del encargo: SEC-A1 (`approvedTotalCents` RB-6 + `referenceValue`),
> dinero saliente (cap `approvedPriceCents` + override RB-3), retención INE (`closedAt` → SEC-D2),
> `POST /admin/pricing/override` con `finish`, auditoría RB-1/RB-2, superficie del contrato
> (`finish`/`referenceValue`/`productType`/`closedAt`).
> **Modo:** revisión **estática** de código + migración M-19 + ejecución de la batería Ronda C
> (`buylist.ronda-c`, `buylist.approved-price-cap`, `ine-retention`, `pricing.finish-pending`,
> `buylist-sweep.closedat`, `admin-jobs.controller`) → **28/28 PASS**. Sin stack vivo → DAST sigue
> pendiente (§6). El insumo del pentester (`PENTEST_NOTES.md`, pase v1.5) no cubre M-19; este anexo
> lo complementa con verificación directa del delta.

### RC.0 Resumen — 0 Críticos / 0 Altos / 0 Medios; 1 Baja informativa; cierra SEC-D2 y SEC-D3

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 1 | **SEC-E1** (edge case pre-existente de selección de `lastClosed`; no introducido por Ronda C) |
| Cerrados esta rev | 2 | **SEC-D2** (retención anclada a `closedAt`), **SEC-D3** (`approvedTotalCents` server-side) |

### RC.1 SEC-A1 — montos server-side (RB-6 + `referenceValue`) — **OK · [Verificado en código + tests]**
- **`approvedTotalCents` (RB-6): derivado, nunca del cliente.** Solo lo escribe
  `BuylistService.recomputeApprovedTotal` (`buylist.service.ts:564-579`) como **SUMA** de
  `SellRequestItem.approvedPriceCents` (`aggregate _sum`), invocado tras **cada** `itemDecision`
  (`:557`). Si ningún ítem tiene monto aprobado → `null` (distingue "sin aprobar" de "aprobado en
  cero"). `grep approvedTotalCents backend/src` → escritura **únicamente** ahí; el resto son lecturas
  (P&L `admin.service.ts:679,703`, DTO de respuesta `buylist.service.ts:410`). **Ningún DTO de
  cliente lo acepta**; `ValidationPipe({whitelist:true})` descartaría un intento de inyectarlo.
- **`referenceValue` en `AdminUserOwnedItemRef` (BE-10): de `PriceReference`, no de input.**
  `admin.service.ts:306-326` hace **lectura batch** `prisma.priceReference.findMany({ where:{cardId:{in:…}} })`
  y mapea por clave `(cardId|productType|gradeKey|finish)` a un `PriceInfo` (`priced`/`pending`).
  El valor es la referencia de mercado del **acabado específico** del ítem; no proviene del cuerpo de
  la petición ni es PII. La proyección es del propio usuario objetivo de la ficha 360°.

### RC.2 Dinero saliente — cap `approvedPriceCents` + override AML (RB-3) — **OK · [Verificado]**
- **Cap vigente (Ronda B, sin regresión):** DTO `@Max(MAX_APPROVED_PRICE_CENTS)` (`buylist.dto.ts:63`)
  + server-side `assertApprovedPriceWithinCap = min(quotedPriceCents×2, amlCap)` en approve/adjust
  (`buylist.service.ts:537-546`). Excedente → `422 APPROVED_PRICE_CAP_EXCEEDED`.
- **RB-3 (override honrado): AMPLÍA solo dentro de límites que fija el super_admin.** `itemDecision`
  resuelve `amlCap = kyc.capPerRequestCentsOverride ?? dial global` (`:527-532`), misma fuente que
  `createRequest` (`:184-187`). **El override lo setea SOLO el super_admin** vía
  `PATCH /admin/users/:id/kyc` (`admin.controller.ts:122-123`, `@Roles(super_admin)` a nivel de método,
  auditado `user.kyc.update`). Un `vault_operator` **no puede** modificarlo (ve M6 en proyección
  reducida, sin escritura de KYC) → **no puede elevar su propio techo de aprobación ni evadir el tope
  AML**; queda acotado a lo que el super_admin autorizó, y sigue sujeto a la cota relativa
  `quoted×2`. El **desembolso** SPEI (`pay-spei`) permanece `@MoneyOut` super_admin + auditado.
- **Residuo (no nuevo):** el override no tiene `@Max` (`admin.controller.ts:13`, solo `@Min(0)`) → un
  super_admin podría fijar un tope por-solicitud arbitrariamente alto; para ítems en `precio_pendiente`
  (sin `quotedPriceCents`) el cap efectivo colapsa a ese override. Actor confiable + auditado +
  desembolso super_admin ⇒ **Bajo**, ya cubierto por la deuda **S-B2/B-4** (Int32/cotas de dinero).
  Sin cambio de severidad.

### RC.3 Retención INE (LFPDPPP) — `closedAt` → **cierra SEC-D2 · [Verificado en código + tests]**
- **El predicado de seguridad NO cambia** (`ine-retention.service.ts:44-79`): `openCount>0 → continue`
  (INE aún necesaria); exige `lastClosed`; `closureDate(lastClosed) > cutoff → continue`. Solo entonces
  purga objeto R2 + nulifica `ineFrontKey/ineBackKey`.
- **El cambio ANCLA el corte al cierre REAL, no lo adelanta.** `closureDate` (`:87-100`) devuelve
  `req.closedAt` si existe; `closedAt` se sella **solo** en transiciones **terminales** server-side
  (`pagada`/`rechazada`/`abandonada`: `buylist.service.ts:367,681`, `buylist-sweep.service.ts:32,46`).
  Para `rechazada`/`abandonada`, el fallback anterior (`max(paidAt,approvedAt,verifiedAt,receivedAt,
  createdAt)`) subestimaba el cierre (caía en `createdAt`) → purgaba **antes**; `closedAt` es la fecha
  real de rechazo/abandono, **posterior** → el cambio **retrasa** el borrado hacia el cierre efectivo
  (más conservador, mejor cumplimiento). **No adelanta el borrado en ningún caso.**
- **Fallback legacy seguro:** filas previas a M-19 (`closedAt=null`) caen al cálculo por timestamps de
  estado — comportamiento idéntico al anterior, sin borrar de más. Migración M-19 = columna nullable,
  sin backfill. Test `ine-retention.spec.ts` cubre ambos caminos (28/28 PASS).
- **SEC-D2 (que yo había levantado en rev v1.6): CERRADO.**

### RC.4 `POST /admin/pricing/override` con `finish` — **OK · [Verificado en código]**
- **Sigue super_admin-only y auditado:** `PricingController` `@Roles(super_admin)` a nivel de clase
  (`pricing.controller.ts:54`); audita `pricing.override` / `entityType:PriceReference`, ahora con
  `finish` en `after` (`:86-92`).
- **`finish` validado contra enum cerrado:** DTO `@IsIn(['normal','reverse_holo','holofoil',
  'first_edition_holofoil'])` + tipo `Finish` (`:26-27`). **No** acepta acabado arbitrario (evita crear
  filas `PriceReference`/pendientes con un `finish` fuera de dominio). Default `normal` si se omite.
- **Resolver un pendiente por acabado NO abre bypass — lo CIERRA.** `manualOverride`
  (`pricing.service.ts:216-221`) ahora incluye `finish` en el `updateMany.where` que marca
  `resolved`. Antes el `where` omitía `finish`: un override de `normal` cerraba **también** el
  pendiente de `holofoil` de la misma carta → un acabado podía quedar "resuelto" con la referencia de
  **otro** acabado. El fix segrega la cola por acabado (`escalatePending` propaga `finish` a la clave
  de dedupe y a la fila creada, `:164-189`; `buylist.service.ts:164` y `pricing.service.ts:124`). Es un
  **endurecimiento** de la integridad de precios, no un vector nuevo. Test `pricing.finish-pending.spec.ts`
  PASS.

### RC.5 Auditoría (RB-1/RB-2) — **OK · [Verificado en código]**
- **Taxonomía uniforme:** `jobs.portfolio_snapshot` → `jobs.portfolio_snapshot.run`
  (`admin-jobs.controller.ts:38`), alineado con el resto de jobs `jobs.<name>.run`.
- **`entityType`/`entityId` en TODA la auditoría de jobs** (`Job`/`<nombre-job>`, `:39-40,55-56,70-71,
  85-86,100-101`) → paridad con los disparos M2. Los `/admin/jobs/*` siguen super_admin-only (guards
  globales) + auditados.
- **Decisiones de dinero auditadas:** `itemDecision` audita `after.approvedPriceCents`
  (`admin-buylist.controller.ts:102`); `pricing.override` incluye `finish`; `pay-spei`/`refund`/
  `reveal-clabe` siguen `@MoneyOut` + auditados (sin regresión, §2).

### RC.6 Superficie del contrato — sin fuga de PII ni datos ajenos — **OK · [Verificado]**
- **`closedAt` es interno:** no aparece en ningún DTO de cliente ni en `contract.ts`; solo se escribe
  server-side y lo lee `ine-retention`. Confirmado por grep (`schema.prisma:619` + escrituras server).
- **`AdminUserOwnedItemRef` (finish/referenceValue/productType):** vive en la ficha 360° admin
  (`AdminUsersController` `@Roles(vault_operator,super_admin)`); expone la referencia de mercado del
  acabado del ítem **del propio usuario objetivo**, no de terceros, y **no** añade CLABE/RFC/INE. La
  proyección PII reducida para `vault_operator` sigue intacta (§2, sin regresión). `finish`/`productType`
  ya eran superficie pública ("Compra"). Sin exposición nueva de PII.
- **`PendingPriceEntry.finish`:** cola interna de back-office (super_admin M2), no cliente.

### SEC-E1 (Baja, informativa) — selección de `lastClosed` por `createdAt`, no por cierre más reciente
- **Ubicación:** `ine-retention.service.ts:56-58` — `findFirst({ …status∈CLOSED, orderBy:{createdAt:'desc'} })`.
- **Observación:** ancla la retención a la solicitud cerrada **creada** más recientemente; si un usuario
  tuvo una solicitud creada antes pero cerrada después (p. ej. una `pagada` de verificación larga junto a
  una `rechazada` rápida posterior por `createdAt`), el ancla podría caer en un `closedAt` anterior al de
  la solicitud realmente cerrada al último → purga algo **antes** del cierre efectivo de esa otra.
- **No es introducido por Ronda C:** la selección `orderBy createdAt desc` es **pre-existente**; Ronda C
  solo mejoró `closureDate`. Sentido de riesgo = minimización de datos anticipada (a favor de privacidad),
  no exposición; impacto AML = perder evidencia unos días antes en un caso multi-solicitud poco común.
- **Severidad:** **Baja / informativa**. **Rol dueño:** **backend** — anclar a
  `max(closedAt)` sobre las solicitudes cerradas (u `orderBy closedAt desc`) en vez de `createdAt`.
  No bloqueante; se registra junto a la bandera legal de retención (§6).

### RC.7 VEREDICTO — rev v1.8-ronda-c

**VEREDICTO seguridad (revisión estática + tests): APROBADO.**

- **0 Críticos / 0 Altos / 0 Medios.** SEC-A1 intacto y **reforzado**: `approvedTotalCents` (RB-6) y
  `referenceValue` (BE-10) se derivan/leen server-side, nunca del cliente. El cap de dinero saliente
  sigue vigente y RB-3 honra el override **solo** dentro de límites que fija el super_admin (un
  `vault_operator` no evade el tope AML). La retención de INE **no borra antes de tiempo** — `closedAt`
  ancla al cierre real y **retrasa** (no adelanta) el borrado; el fallback legacy preserva el
  comportamiento previo. `POST /admin/pricing/override` sigue super_admin-only + auditado, `finish` con
  enum cerrado, y la cola por-acabado **cierra** un vector de precio cruzado (endurecimiento). Auditoría
  RB-1/RB-2 uniforme. Contrato aditivo sin fuga de PII ni datos ajenos; `closedAt` interno confirmado.
  Migración M-19 aditiva/nullable, sin backfill. **28/28 tests Ronda C PASS.**
- **Cierra dos hallazgos que blue team había abierto en rev v1.6:** **SEC-D2** (retención imprecisa) y
  **SEC-D3** (`approvedTotalCents` nunca escrito).
- **Deuda/banderas sin cambio:** S-M1 (SSE no alcanzable), S-B1 (linking Google back-office), S-B2/B-4
  (Int32/cotas de dinero, incl. override sin `@Max`), residuo S-B3 (`contentLength`), SEC-D1 (INE
  huérfano si falla R2), bandera legal de PII en snapshots económicos y de retención LFPDPPP. Nuevo:
  **SEC-E1** (Baja informativa, backend), no bloqueante.

**¿Puede ir a main?** **SÍ.** No hay hallazgos **Críticos ni Altos** abiertos en Ronda C → no procede
RECHAZO (`CLAUDE.md` §7). Basta la revisión de código para el merge a `main`.

**Condición para operar con DINERO REAL (no para el merge):** la **fase dinámica (DAST/pentester contra
staging)** sigue **PENDIENTE Y OBLIGATORIA** antes de producción con dinero/PII reales (heredada, §6; hoy
bloqueada por infra: R2/Railway sin configurar, sin stack local levantable). Debe cubrir concurrencia real
de `itemDecision`/`recomputeApprovedTotal`/`pay-spei`, el job de retención bajo carga, y ZAP/nuclei. En
este entorno no hay staging atacable; queda en backlog del humano pre-dinero-real. La revisión estática de
Ronda C **no** la sustituye pero **no** la bloquea para el merge.

---

# ANEXO rev v1.9-set-chart (2026-08-16) — Gráfica pública de valor de set (M-20, commit f3926ed)

> **Rol:** seguridad (blue team). Reviso la superficie nueva de `v1.9-set-chart` (ya commiteada,
> `f3926ed`): endpoint **público** nuevo, **fetch externo** a pokemontcg.io, **jobs desatendidos** y
> **agregación de precios**. Consolido con el pentester (`PENTEST_NOTES.md` v1.5: 0 crít/0 alto; el
> bloque nuevo no altera su conteo) y emito veredicto. **Modo:** revisión **estática** de código
> (`set-value.service.ts`, `catalog.controller.ts`, `set-price-sync.service.ts`,
> `set-value-snapshot.service.ts`, `admin-jobs.controller.ts`, `scheduler.service.ts`,
> `pricing.service.ts`, `pokemontcg-io.provider.ts`, `schema.prisma`, migración M-20). Egress a
> pokemontcg.io **bloqueado** en esta sesión → sin DAST en vivo. Blanco autorizado: staging/local.

## SC.0 Resumen — 0 Críticos / 0 Altos / 0 Medios

El bloque llegó **endurecido y aditivo**. No hay dinero saliente ni PII nuevos. Los dos endpoints
públicos exponen **solo valor agregado de mercado** de un set (dato de catálogo ya público), sin tocar
inventario, costo, holdings ni PII. El fetch externo usa **host FIJO** no influenciable por el cliente.
La agregación (SEC-A1) se deriva **siempre** de `PriceReference` real; nada viene del cuerpo del cliente.
Los jobs son idempotentes, gated por `REDIS_URL`, sin efecto sobre dinero/PII/bóveda. Los disparos admin
son **super_admin + auditados**. **Un (1) hallazgo Bajo nuevo** (throttle) + **una (1) nota informativa**,
ninguno bloqueante.

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 1 | **SEC-F1** (endpoints públicos de la gráfica sin `@Throttle` propio) |
| Info | 1 | SEC-F2 (`:id` sin validación de formato — sin impacto real) |

## SC.1 Endpoint público — **OK · [Verificado en código]**
- `GET /catalog/featured-set/value-history` y `GET /catalog/sets/:id/value-history` son `@Public()`
  (`catalog.controller.ts:73-84`). **Sin PII ni datos internos:** la respuesta es
  `SetValueHistoryResponse` = `SetRefDTO` (id LOCAL del CardSet, name, series, releaseDate — todo ya
  público vía `GET /catalog/sets`) + `points[]` (`date`, `valueMxnCents`, `pricedCardCount`) + `change`
  (`set-value.service.ts:12-39,187-207`). **No** toca `InventoryItem`, costo, `listPriceCents`, holdings,
  usuarios ni PII. Es **valor agregado de mercado del set** (SUM de referencias públicas TCGPlayer), no el
  valor de nuestro inventario ni del portafolio de ningún usuario.
- **`:id` (endpoint por set):** `setHistoryById` hace `prisma.cardSet.findUnique({ where:{ id } })`
  (`:232-236`) → **parametrizado por Prisma (sin SQLi)**; no existente → `BusinessException.notFound()`
  = **404 correcto**. El `id` **no** arma ninguna URL externa ni query cruda. Ver SEC-F2 por la ausencia
  de validación de formato (sin impacto).
- **Enumeración:** un `:id` válido solo confirma la existencia de un `CardSet`, que **ya es enumerable**
  por el público vía `GET /catalog/sets`. No revela inventario, tenencia ni precio interno → **sin
  superficie nueva de valor para un atacante**.

## SC.2 Fetch externo (SSRF) — **OK · [Verificado en código]**
- `set-price-sync` precia el set **carta por carta** vía `PricingService.syncCardPrice` →
  `PokemonTcgIoProvider.fetchPrice`, que arma la URL con **host FIJO**
  `https://api.pokemontcg.io/v2/cards/${externalId}` (`pokemontcg-io.provider.ts`). El host **no** es
  configurable por request; `externalId` proviene del **registro `Card` de la BD**, no de input del
  cliente. **Ningún input de cliente** llega a la URL: los endpoints públicos solo LEEN la BD
  (`SetValueSnapshot`/`PriceReference`), no disparan fetch.
- `HOME_FEATURED_SET_ID` es un **id de catálogo** (externalId pokemontcg.io) que se resuelve a un
  `CardSet` local por `findUnique({ where:{ externalId } })` (`set-value.service.ts:82-88`); **no** es una
  URL ni se concatena a una. Si no resuelve → warn + fallback determinista (no rompe, no sale a red
  arbitraria).
- Consistente con el guardarraíl ya verificado del sync de catálogo (`SET_ID_PATTERN` + host fijo +
  `encodeURIComponent`, §2 tabla). **Sin SSRF nuevo.**

## SC.3 SEC-A1 (integridad de precios) — **OK · [Verificado en código]**
- `computeSetValue(setId, asOf)` (`set-value.service.ts:134-169`) suma **`PriceReference.priceMxnCents`
  real** filtrado por `productType='raw'`, `gradeKey='raw:NM'`, `finish='normal'` y toma la vigente más
  reciente por carta. **No acepta montos del cliente** (sus únicos parámetros son `setId` interno y una
  fecha). Cartas sin precio se **excluyen** del total (no se inventa) y solo se **cuentan** en
  `totalCardCount` → **sin fabricación de datos**.
- **Sin backfill inventado:** migración M-20 es `CREATE TABLE` puro, **sin** seed/backfill; la serie
  arranca hoy y crece con el snapshot diario (`set-value-snapshot.service.ts`). Confirmado en el SQL.
- El snapshot público (`SetValueSnapshot.totalValueMxnCents`) lo escribe **solo** el job server-side
  (`snapshotFeaturedSet`, `:240-263`); no hay endpoint que permita al cliente fijar/inflar el valor.

## SC.4 `escalate=false` — **OK · [Verificado en código]**
- El flag es un parámetro de `syncCardPrice` (`pricing.service.ts:103,133-135`) cuyo **único efecto** es
  **no** crear `PendingPriceEntry` cuando una carta del set no tiene precio. **No** toca money-out,
  reserva de venta, tope AML, buylist ni SEC-A1. Los flujos de bóveda/buylist conservan el default
  `escalate=true` (nunca se descarta una carta). Correcto: es anti-inundación de la cola de pendientes
  al preciar un set completo de marketing, no un bypass de control de dinero.

## SC.5 Jobs desatendidos — **OK · [Verificado en código]**
- **Idempotencia:** `set-price-sync` usa el cache diario de `syncCardPrice` (findUnique por clave
  compuesta con `capturedDate=today` → no re-escribe) ; `set-value-snapshot` hace **UPSERT** por
  `@@unique([setId, asOfDate])` (`set-value.service.ts:253-257`). Re-correr un día no duplica ni corrompe
  otras series (el where siempre acota `setId`+`asOfDate`).
- **Gated `REDIS_URL`:** el scheduler no programa nada sin Redis (`scheduler.service.ts:49-57`); orden duro
  FX → `set-price-sync` (30 6) → `portfolio-snapshot` → `set-value-snapshot` (15 7). Sin efectos sobre
  dinero/PII/bóveda: solo leen `Card`/`PriceReference` y escriben `PriceReference`/`SetValueSnapshot`.
- **Nota multi-instancia (heredada, no bloqueante):** sin single-flight distribuido, dos réplicas podrían
  preciar el set en paralelo; los upserts idempotentes evitan corrupción, solo se duplica carga hacia
  pokemontcg.io. Ya anotado para **devops** (Redis compartido) en A.2/§6.

## SC.6 Disparos admin — **OK · [Verificado en código]**
- `POST /admin/jobs/set-price-sync` y `/set-value-snapshot` viven en `AdminJobsController`
  `@Roles(Role.super_admin)` a nivel de clase (`admin-jobs.controller.ts:21-23`), sin `@Public`, bajo los
  guards globales `JwtAuthGuard`→`RolesGuard` (`app.module.ts:64-65`) → sesión + rol tomado del JWT (nunca
  del cuerpo); un no-super_admin → 403. **Auditados:** ambos registran `jobs.set_price_sync.run` /
  `jobs.set_value_snapshot.run` con `actorUserId`, `actorRole`, `entityType/entityId` y `after`
  (`:112-142`). Correcto.

## SC.7 Superficie / fuga de existencia-valor — dictamen **Bajo/aceptable**
- El público expone el **valor de mercado agregado de un set Pokémon** (dato derivable de fuentes
  públicas de precios: es información de mercado, no propia). No revela cuántas cartas del set tenemos, ni
  su valor en nuestro inventario, ni holdings de usuarios. **Riesgo de inteligencia competitiva: bajo y
  aceptable** — es, por diseño, un "gancho de mercado" público (hero de la home). Se dictamina **aceptado**.

## SEC-F1 (Baja) — Endpoints públicos de la gráfica sin `@Throttle` propio
- **Vector:** anti-scraping / abuso de lectura no autenticada.
- **Ubicación:** `catalog.controller.ts:73-84` — `featured-set/value-history` y `sets/:id/value-history`
  son `@Public()` y **solo** cubiertos por el `ThrottlerGuard` global (300/min), a diferencia del
  cotizador (`buylist-catalog.controller.ts`) que fija `@Throttle({ttl:60,limit:60})`. El resto de
  `CatalogController` (cards/facets/sets) tampoco lo tiene, así que es consistente con lo ya aprobado.
- **Impacto:** bajo — el dato es agregado, público y de bajo costo (2 queries, sin N+1, sin fetch externo
  en la ruta de lectura). El riesgo es scraping/DoS ligero, mitigado parcialmente por el throttle global.
- **Rol dueño:** **backend** (añadir `@Throttle` por-endpoint acorde al resto de superficie pública, si se
  quiere paridad con el cotizador). **No bloqueante.**

## SEC-F2 (Info) — `:id` sin validación de formato en `sets/:id/value-history`
- `@Param('id')` entra sin `@IsCuid`/regex; se usa **solo** como `where:{ id }` en `findUnique` de Prisma
  (parametrizado). Un id no-CUID simplemente da 404. **Sin SQLi, sin enumeración nueva** (sets ya
  públicos). Se anota como defensa en profundidad menor; **no es hallazgo** ni requiere acción.

## SC.8 VEREDICTO — rev v1.9-set-chart

**VEREDICTO seguridad (revisión estática): APROBADO.**

- **0 Críticos / 0 Altos / 0 Medios.** Endpoint público sin PII ni datos internos (solo valor agregado de
  mercado + ref de set ya público), 404 correcto y `:id` parametrizado; fetch externo con **host FIJO** no
  influenciable por el cliente (sin SSRF nuevo); **SEC-A1 intacto** (valor siempre derivado server-side de
  `PriceReference` real, sin backfill fabricado); `escalate=false` sin bypass de dinero/pendientes; jobs
  idempotentes, gated `REDIS_URL`, sin efecto sobre dinero/PII/bóveda; disparos admin **super_admin +
  auditados**; migración M-20 aditiva sin backfill.
- **Deuda nueva no bloqueante:** **SEC-F1** (Baja, backend: `@Throttle` propio en la gráfica pública) +
  **SEC-F2** (Info, sin acción). Deuda/banderas previas **sin cambio** (S-M1 SSE no alcanzable; S-B1
  linking Google; S-B2/B-4 Int32/cotas de dinero; residuo S-B3; SEC-D1 INE huérfano; bandera legal PII en
  snapshots económicos; nota multi-instancia de jobs → devops).

**¿Puede ir a main?** **SÍ.** No hay hallazgos **Críticos ni Altos** abiertos en v1.9-set-chart → no
procede RECHAZO (`CLAUDE.md` §7). La revisión **estática basta para el merge a `main`**: el cambio es
aditivo, sin dinero saliente ni PII nuevos, sin superficie que exija DAST en vivo específico (no hay fetch
disparado por el cliente ni entrada que arme la URL externa). El egress bloqueado a pokemontcg.io en esta
sesión **no** impide dictaminar, porque el fetch es server-side con host fijo y ya está cubierto por los
guardarraíles estáticos verificados.

**Condición para DINERO REAL (no para el merge):** se mantiene la **fase dinámica (DAST contra staging)**
como **PENDIENTE Y OBLIGATORIA** antes de producción (heredada, §6). Para este bloque en concreto, cuando
haya staging, conviene validar: throttle/scraping de la gráfica pública (SEC-F1) y el rate-limit del
`set-price-sync` contra pokemontcg.io en multi-instancia. Nada de eso bloquea el merge a `main`.

---

## SC.9 VEREDICTO — SAST-1 (endurecimiento cripto GCM en PII) · commit `8f21f50`

> **Rev:** v1.10-sast-gcm. **Fecha:** 2026-08-16. **Rama:** `claude/git-repo-review-c67xyk`.
> **Alcance:** verificación del fix del hallazgo REAL que destapó el gate SAST (semgrep
> `javascript.node-crypto.security.gcm-no-tag-length`) en `backend/src/common/crypto/pii-crypto.service.ts`.
> **Insumo:** `PENTEST_NOTES.md` §PII + `TECH_DEBT.md` SAST-1. **Modo:** revisión estática + reproducción
> del vector con `node:crypto` + ejecución de `test/pii-crypto.spec.ts` (10/10 verde). Endurecimiento puro
> de defensa en profundidad sobre PII (CLABE/RFC/INE); **sin dinero saliente** en el cambio.

**VEREDICTO seguridad: APROBADO.** 0 Críticos / 0 Altos / 0 Medios abiertos. Puede ir a `main`.

Verificación punto por punto (lo pedido):

1. **Cierra el vector real — SÍ.** Reproduje en `node:crypto` que el path viejo
   (`createDecipheriv('aes-256-gcm', key, iv)` **sin** `authTagLength`) **acepta y descifra** un authTag
   truncado a 12 bytes (OpenSSL permite tags GCM más cortos → autenticidad debilitada, riesgo de forja
   sobre el ciphertext `v1:iv:tag:ct` almacenado en BD). El código nuevo (`decrypt`, `:129-131`) valida
   `tag.length !== 16` **antes** de `setAuthTag` y lanza, de modo que un tag ≠ 16B **jamás** llega al
   verificador. Para el caso legítimo la verificación GCM **queda intacta**: el tag de 16B se pasa a
   `setAuthTag` y `decipher.final()` sigue lanzando ante ciphertext/tag manipulados (test "detecta
   manipulación del authTag" sigue verde). Vector **cerrado**.

2. **Retrocompatibilidad — SÍ, sin ruptura de datos.** Reproduje: dato cifrado por el path **viejo**
   (sin `authTagLength`) produce un tag de **16 bytes** vía `getAuthTag()`, y descifra **idéntico** con el
   path **nuevo** (`authTagLength: 16`). Motivo: `getAuthTag()` de AES-256-GCM **siempre** devolvió 16B,
   así que todo registro existente ya cumple `tag.length === 16` y pasa el guard. El formato serializado
   (`v1:iv:tag:ct`, base64 por campo), el `VERSION`, el IV de 12B y las claves **no cambian**. Cero
   migración de datos requerida.

3. **Sin oráculo / side-channel — OK (residuo Bajo, no explotable).** El mensaje `'Malformed PII
   ciphertext'` es **idéntico** para tag-mal-formado (longitud ≠ 16) y para payload-mal-formado
   (`parts.length !== 4` / versión), así que no distingue el motivo al atacante. Timing: el guard de
   longitud lanza **antes** de trabajo cripto, luego un tag de longitud incorrecta responde algo más
   rápido que un tag de 16B-pero-incorrecto — pero esa diferencia **solo revela la longitud del tag que
   el propio atacante envió** (dato que ya controla); **no filtra** nada del secreto ni del tag correcto.
   La comparación real del tag GCM la hace OpenSSL en tiempo constante. Side-channel **no explotable**;
   dictamen **Bajo, aceptado sin acción**.

4. **Sin regresión — confirmado.** El formato serializado y las claves no cambian. El **blind index**
   (`blindIndex`/`clabeBlindIndex`, HMAC-SHA256) y `blindIndexEquals` (`timingSafeEqual`) **no se tocan**
   (diff limitado a `encrypt`/`decrypt` + constante `TAG_BYTES`). Tests de blind index (determinismo,
   normalización, comparación en tiempo constante, dependencia de clave) **verdes**. Guardarraíles de
   dinero/PII previos (enmascaramiento por defecto, `reveal-clabe` money-out+auditado, INE huérfano)
   **sin cambio** — el commit no toca controllers ni superficie de red.

5. **¿Suficiente? — SÍ.** El fix resuelve la causa raíz de la regla semgrep (fija `authTagLength: 16` en
   ambos `createCipheriv`/`createDecipheriv`) y **añade** el guard de longitud como cinturón-y-tirantes.
   No queda nada abierto del hallazgo. Nota menor (defensa en profundidad, **no bloqueante, sin owner de
   acción**): la robustez sigue dependiendo de que el authTag no se corrompa en BD; la integridad GCM ya
   lo cubre y el guard de longitud lo refuerza — no se requiere endurecimiento adicional.

**Estado del hallazgo:** **SAST-1 — CERRADO/RESUELTO.** Se retira de deuda abierta; queda como registro
histórico en `TECH_DEBT.md`. Reproducción y tests: `backend/test/pii-crypto.spec.ts` (10/10),
verificación del vector legacy vs. nuevo con `node:crypto` en esta sesión.

**¿Puede ir a `main`?** **SÍ.** No hay Críticos/Altos abiertos (`CLAUDE.md` §7). Cambio retrocompatible,
sin dinero saliente ni PII nueva expuesta, solo endurecimiento interno. La **fase dinámica (DAST contra
staging)** heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea
este merge. El veredicto **QA** sobre este commit (toca PII/cripto) sigue su curso en paralelo; este
dictamen cubre **solo** la dimensión de seguridad.

---

# D. Revisión v1.11-ola1-wiring — Wiring del panel de admin (dinero + PII)

> **Rev:** v1.11-ola1-wiring. **Fecha:** 2026-08-17. **Rama:** `claude/git-repo-review-c67xyk`.
> **Alcance:** commits `751d637` (backend Tier 0: `escalatePending(finish)` + `pendingQueue`
> con `include card+set`) y `e8591d3` (frontend: wire M5 buylist end-to-end, M3 refund, M8
> disputas, M4 envíos admin, M1 picker; `api.ts` + `contract.ts` + i18n). Superficie sensible:
> **dinero saliente** (pay-SPEI, refund, decisión de buylist con cap, recompra de disputa) y
> **PII** (revelar CLABE en claro).
> **Insumo:** `PENTEST_NOTES.md` v1.5 (I-3 SEC-A1, I-5 money-out/PII) + este código.
> **Modo:** revisión **estática** de código (frontend `M5View.tsx`, `QueryState.tsx`, `api.ts`,
> `api-client.ts`; backend `admin-buylist.controller.ts`, `buylist.service.ts`, `buylist.dto.ts`,
> `pricing.service/controller.ts`, `all-exceptions.filter.ts`, `money-out.guard.ts`). Sin stack
> vivo → DAST sigue **pendiente** (§6). Es **wiring de UI** sobre endpoints ya endurecidos; **no
> hay nueva lógica de dinero**.

## D.0 Resumen — 0 Críticos / 0 Altos / 0 Medios. APROBADO, puede ir a `main`

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 0 nuevos (1 nota de higiene, no hallazgo) | — |

Los seis focos del encargo se verificaron **OK en código**. El wiring respeta la regla de oro:
**el backend es la autoridad**; el cliente solo dispara endpoints y no deriva ni impone montos ni
autorización. La **revisión estática BASTA** para este bloque: no introduce lógica de dinero nueva
ni superficie de red nueva (todos los endpoints ya existían y estaban endurecidos/auditados); solo
cablea UI → API. Los vectores dinámicos (concurrencia real de pay-SPEI/refund, idempotencia con
llamadas reales) ya estaban en la lista **[pendiente de DAST]** y no cambian con este commit.

## D.1 SEC-A1 / dinero server-side — **OK · [Verificado en código]**
- **Buylist decisión (`adjust`/`approve`):** el frontend manda `approvedPriceCents`
  (`M5View.tsx:373-378`, `pesosToCents` → **centavos enteros** vía `Math.round(n*100)`, `:30-36`),
  pero el **cap lo impone el backend**: `ItemDecisionDto` valida `@Min(0) @Max(1_000_000)`
  (`buylist.dto.ts:63`, primera línea, rechazo 400 al PoC `99999999`) **y**
  `BuylistService.assertApprovedPriceWithinCap` (`buylist.service.ts:493-510`) aplica la cota fina
  server-side: `min(quotedPriceCents × 2, capAML)` — con `capAML` = `kyc.capPerRequestCentsOverride`
  o dial global (`:530-532`) — y lanza **422 `APPROVED_PRICE_CAP_EXCEEDED`** (`:504-508`). El
  cliente **no** puede saltarse el cap: aunque mande un monto arbitrario, el server lo rechaza. El
  modal muestra ese error real **dentro** del modal (`M5View.tsx:115`, `setAdjustError`). Confirmado.
- **pay-SPEI:** el body es **solo** `{ speiReference }` (`api.ts` `paySpeiBuylist`), sin monto — el
  server paga `approvedTotalCents` derivado de la suma de `approvedPriceCents` aprobados
  (`buylist.service.ts:564-575`). **Refund:** body **solo** `{ reason }`
  (`api.ts` `refundOrder`), sin monto — el server reembolsa contra el cargo Stripe original.
  **Recompra de disputa:** body `{ resolution, note }` (`resolveDispute`), sin monto. Ningún flujo
  de dinero saliente acepta un importe arbitrario del cliente. Confirmado.

## D.2 Revelar CLABE (PII) — **OK · [Verificado en código]**
- **Bajo demanda + efímero:** `revealBuylistClabe` es una **mutation** (no query) precisamente para
  que la CLABE en claro **NO** entre al cache de react-query (`M5View.tsx:146-154`, comentario
  explícito). Se guarda **solo** en estado local de la vista `revealed` (`:60`), nunca en estado
  global/localStorage/query-cache. Se descarta al **ocultar** (`setRevealed(null)`, `:315`) y —
  higiene— **al registrar el pago SPEI** (`:166`). No hay `console.log`/logger de la CLABE en el
  frontend. Confirmado.
- **Endpoint super_admin + auditado server-side:** `GET /admin/buylist/:id/reveal-clabe` con
  `@Roles(Role.super_admin) @MoneyOut()` (`admin-buylist.controller.ts:48-50`) y `audit.log`
  `buylist.reveal_clabe` con actor/rol/entidad (`:52-60`). Es el ÚNICO endpoint que devuelve CLABE
  en claro; el resto enmascara (verificado sin regresión en §2). El `disabled={!isSuperAdmin}` del
  botón (`M5View.tsx:322`) es **cosmético**; la autoridad es el guard server-side. Confirmado.

## D.3 Doble cobro / doble reembolso — **OK · [Verificado en código]**
- **Idempotency-Key estable:** pay-SPEI envía `Idempotency-Key: pay-spei-${id}` (`api.ts`
  `paySpeiBuylist`) y refund `Idempotency-Key: refund-${orderId}` (`api.ts` `refundOrder`). La clave
  es **estable por solicitud/orden**: un reintento del mismo pago/refund reusa la misma clave → el
  backend no duplica el asiento. Correcto (la eficacia real de la deduplicación bajo concurrencia se
  valida en DAST, ya listado §6, sin cambio). Nota: la clave es determinística por recurso, que es
  el diseño correcto para "un pago por solicitud" (no un UUID por click). Confirmado.

## D.4 Autorización — **OK · [Verificado en código]**
- Los guards son **server-side y globales**: `MoneyOutGuard` (`money-out.guard.ts:32-44`, rol ≠
  `super_admin` → **403 `MONEY_OUT_FORBIDDEN`** auditado) sobre `reveal-clabe`/`pay-spei`/`refund`/
  recompra; `@Roles` en controllers (`AdminBuylistController` = `vault_operator+`, con
  `reveal-clabe`/`pay-spei` estrechados a `super_admin`). El wiring **no puede** saltarlos: el
  cliente ocultar/deshabilitar botones (`isSuperAdmin`, `canPay`, `M5View.tsx:194-195,322,333`) es
  **cosmético**, no un control de seguridad — una llamada directa a la API la corta el guard. El
  código lo reconoce explícitamente (comentarios en M5View y en `SuperAdminOnly`, §A.4). **No se
  asume seguridad en el cliente.** Confirmado.

## D.5 Fuga en errores (`useErrorMessage`) — **OK · [Verificado en código]**
- `useErrorMessage` (`QueryState.tsx:23-32`) traduce `errorCode` del contrato a copy i18n; si no hay
  copy, cae al **`ApiClientError.message` real del backend** (para no ocultar topes AML al operador).
  **Dictamen: seguro.** El filtro global (`all-exceptions.filter.ts`) **nunca** devuelve stack ni
  detalle interno en `message`: (a) `BusinessException` → mensaje curado del dominio
  (`:25-31`); (b) `HttpException` → mensaje de la lib / validación class-validator (`:34-47`);
  (c) **cualquier excepción no controlada → `500` con `message: 'Internal server error'` genérico y
  el stack se loguea SOLO server-side** (`:50-53`). Por tanto lo máximo que `useErrorMessage` puede
  pintar es un mensaje de negocio controlado (p. ej. "Approved price exceeds the allowed cap"),
  nunca stack/PII/IDs internos de infraestructura. Confirmado.
  - **Nota (no hallazgo, defensa en profundidad):** el filtro copia `details` = objeto crudo de la
    `HttpException` al cuerpo (`:45`); `useErrorMessage` **no** lo renderiza (solo `message`), así que
    no hay fuga por la UI. Si en el futuro se pintara `details`, revisar que no arrastre datos. Sin
    acción para este bloque.

## D.6 Backend Tier 0 (`751d637`) — **OK · [Verificado en código]**
- **`pendingQueue` con `include card+set`:** el endpoint `GET /admin/pricing/pending` es
  `@Controller('admin/pricing') @Roles(Role.super_admin)` (`pricing.controller.ts:53-54,72-74`) —
  **solo super_admin**. El `include` expone `card{id,name,number,setName}` + `cardName`
  (`pricing.service.ts:pendingQueue`), que es **catálogo público** (ya es superficie pública en
  "Compra"); **no** añade PII, precios internos, costo de adquisición ni datos de otros usuarios.
  El `map` proyecta explícitamente solo esos 4 campos de card (no derrama la fila `Card` completa).
  No expone nada que no deba en un endpoint admin. Confirmado.
- **`escalatePending(...finish)`:** propagar el `finish` resuelto a la cola es una corrección de
  **exactitud funcional** (M-19: cola por acabado), **sin efecto de seguridad** — no toca authz,
  dinero saliente ni PII. Confirmado.

## D.7 VEREDICTO — v1.11-ola1-wiring: **APROBADO**
- **0 Críticos / 0 Altos / 0 Medios abiertos** → aprobable por política (`CLAUDE.md` §7). SEC-A1
  intacto (montos derivados/validados server-side; cap 2×/AML impuesto por el backend, no por el
  cliente); CLABE revelada bajo demanda, efímera, sin persistencia/log/cache y con endpoint
  super_admin+money-out+auditado; idempotencia estable en pay-SPEI/refund; autorización 100%
  server-side (UI cosmética); `useErrorMessage` no filtra detalle interno (500 genérico + stack solo
  en log); `pendingQueue` (super_admin) solo expone catálogo público.
- **¿Basta la revisión estática?** **SÍ** para este bloque: es wiring UI→API sin lógica de dinero
  nueva ni endpoints nuevos; toda la superficie de red ya estaba endurecida y auditada. Los vectores
  dinámicos (concurrencia/idempotencia con tráfico real) ya estaban en la lista **[pendiente de
  DAST]** (§6) y **no** los altera este commit.
- **Sin hallazgos que enrutar.** Deuda previa sin cambio (S-M1 aceptada; S-B1/S-B2/residuo S-B3 y
  banderas legales de PII, §5-§6). La **fase dinámica (DAST contra staging)** heredada sigue
  **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea este merge.
- **¿Puede ir a `main`?** **SÍ.**

---

# E. Revisión Ola 2 — Gestión de inventario M1 (commit `a72f6e6`) · rama `claude/git-repo-review-c67xyk`

> **Alcance:** wiring de UI a la gestión de inventario M1 del operador — tabla con filtros +
> paginación, detalle por pieza con historial, publicar/retirar de venta (`listPriceCents` manual),
> mover, marcar perdida/dañada, y gestor de ubicaciones. Toca **dinero** (precio de venta al
> publicar) y **estado de bienes en custodia** (perdida/dañada → responsabilidad/reposición).
> **Modo:** revisión **estática** de código (diff `a72f6e6` + endpoints backend ya existentes).
> El commit es **frontend-only** (12 archivos: `frontend/` + `docs/FRONTEND_NOTES.md` + `docs/TECH_DEBT.md`);
> **no toca `backend/`** — los endpoints M1 ya existían y estaban endurecidos.
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## E.0 Resumen — **0 Críticos / 0 Altos / 0 Medios / 0 Bajos nuevos**

El commit es **wiring puro UI→endpoints M1 ya endurecidos**. No introduce endpoints nuevos, ni
lógica de dinero saliente, ni superficie de red nueva. Todos los guards de rol son **server-side y
globales**; la UI es cosmética. **SEC-A1 intacto.** Sin regresión en dinero/PII.

## E.1 SEC-A1 / precio de venta (`listPriceCents`) — **OK · [Verificado en código]**
- **Es entrada MANUAL legítima del operador**, no una derivación que el server deba calcular. El
  operador captura el precio en **pesos** y el cliente lo convierte a centavos con `Math.round(Number(price)*100)`
  (`ItemDetailModal.tsx:61`); se envía como `listPriceCents` en `PATCH /admin/inventory/items/:id`.
  Es el **precio de venta** (override manual) — exactamente lo que PROJECT.md §A/§B autoriza al
  admin a fijar (sellado con precio manual; markup sobre referencia). El comentario del código lo
  reconoce: *"precio de venta MANUAL (override), no una derivación en cliente (SEC-A1)"* (`:57-59`).
- **La valuación de REFERENCIA sigue server-side.** El cliente **nunca** envía ni puede manipular
  `referenceValue`: lo recibe del server (display-only, `PriceTag mode="reference"`, `:169-176`) y
  el backend lo deriva vía `PricingService.getReference(...)` (`inventory.service.ts:48`). El DTO de
  entrada (`UpdateItemDto`) solo acepta `status/listPriceCents/certNumber/gradeValue/sealedSubtype`
  (`inventory.dto.ts:42-49`) — **no** hay campo de referencia/costo manipulable por el cliente.
- **Invariantes validadas en el backend, no en el cliente:**
  - Sellado exige `listPriceCents` para publicar — el cliente lo pre-bloquea (`sealedNeedsPrice`,
    `:64-65`, botón `disabled`) pero es **cosmético**; el gate real está en el servicio (escalado a
    "precio pendiente" si falta, `inventory.service.ts:72-83`).
  - Gradeada publicada exige `certNumber` no vacío — revalidado en el **UPDATE** (no solo en alta):
    `updateItem` recomputa el estado resultante y lanza `422 VALIDATION_ERROR` si queda `listed` sin
    cert (`inventory.service.ts:240-252`). Un `PATCH` no puede publicar una gradeada sin certificado.
  - `@Min(0)` en `listPriceCents` (`inventory.dto.ts:47`) vía `ValidationPipe({whitelist:true})`.
- **Residuo (sin cambio, ya registrado):** `listPriceCents` sin `@Max` — es el pentest **B-3**
  (dinero en `Int` 32-bit + cota superior), ya en §5 como **Baja aceptada** enrutada a
  arquitecto/backend. Entrada confiable (super_admin/operador), no explotable por externo; este
  commit **no** lo agrava. **Sin acción para este bloque.**

## E.2 Marcar perdida/dañada — **OK · [Verificado en código]**
- **Endpoint admin + auditado server-side.** `POST /admin/inventory/items/:id/mark` cuelga de
  `InventoryController` con `@Roles(Role.vault_operator, Role.super_admin)` a nivel de clase
  (`inventory.controller.ts:18-19`) → enforced por el `RolesGuard` **global**
  (`app.module.ts:65`, `APP_GUARD`). El controlador **audita siempre**: `audit.log` con
  `action: inventory.mark_${dto.mark}`, actor, rol, entidad y `after:{note}` (`:109-117`).
- **Nota obligatoria a nivel de DTO.** `MarkItemDto.note` es `@IsString()` **sin** `@IsOptional`
  (`inventory.dto.ts:56-59`) → una llamada directa sin nota es **422**. El cliente además
  deshabilita el botón con `markNote.trim() === ''` (`ItemDetailModal.tsx:325`), pero eso es
  **redundante/cosmético**: la obligatoriedad la impone el backend. La nota queda registrada en el
  `InventoryMovement` (`reason: lost|damaged`, `note`, `actorUserId`, `inventory.service.ts:279-288`)
  **y** en el audit-log.
- **Nota de negocio (no hallazgo):** marcar perdida/dañada dispara la **responsabilidad de reposición**
  (PROJECT.md §H, tope por carta configurable en M10). El `mark` en sí **no** ejecuta dinero saliente
  (no hay reembolso/pago aquí); la reposición/compensación es un flujo aparte (M3/M8) ya restringido a
  `super_admin` por `MoneyOutGuard`. Correcto que un `vault_operator` pueda marcar el estado físico
  pero **no** sacar dinero.

## E.3 Autorización de las 6 acciones — **OK · [Verificado en código]**
- Las 6 (list tabla / detalle / publicar-retirar / mover / marcar / ubicaciones) cuelgan del mismo
  `InventoryController` con `@Roles(vault_operator, super_admin)` de clase — **todas** protegidas
  server-side por la cadena de guards globales `JwtAuthGuard → RolesGuard → EmailVerifiedGuard →
  MoneyOutGuard` (`app.module.ts:63-67`). El `RolesGuard` corta con `403 FORBIDDEN` si el rol no
  está en la lista (`roles.guard.ts:25-27`).
- **El cliente no asume seguridad:** el gating de la UI (`canPublish`/`canUnlist`/`canOperate` por
  estado del item, `ItemDetailModal.tsx:122-124`; botones `disabled`) es **conveniencia visual**, no
  control de acceso. Una llamada directa a cualquiera de los 6 endpoints la corta el guard. Consistente
  con el patrón ya dictaminado en §A.4/§D.4 (botones cosméticos, autoridad server-side).

## E.4 Fuga de datos — **OK · [Verificado en código]**
- **Detalle admin-only, sin PII de cliente de más.** `GET /admin/inventory/items/:id`
  (`getItem`, `inventory.service.ts:219-230`) incluye `card{+set}`, `location` y `movements`. El
  `InventoryItem` de bóveda es `ownerType: 'platform'` y el `include` **no** trae relación de
  usuario/cliente, CLABE, INE ni RFC. El historial (`InventoryMovementDTO`) expone `actorUserId`
  (id de **staff** que ejecutó el movimiento, no un cliente) + `note` (texto del operador) +
  ubicaciones/estados — **sin PII de comprador**. La UI tampoco pinta `actorUserId`
  (`ItemDetailModal.tsx:340-367`). Endpoint tras `@Roles(vault_operator, super_admin)`.
- **`useErrorMessage` no filtra internos.** Sin cambio respecto a §D.5: traduce `errorCode`; si no
  hay copy, cae al `message` **curado** del backend; el `all-exceptions.filter` devuelve `500`
  genérico para excepciones no controladas (stack solo en log server-side). Lo máximo que puede
  pintar es un error de negocio (`PRICE_PENDING`, `FINISH_NOT_AVAILABLE`, `VALIDATION_ERROR`), nunca
  stack/PII. Confirmado.

## E.5 ¿Lógica de dinero o superficie de riesgo nueva? — **NO**
- El único dinero es `listPriceCents` (override manual, §E.1) — ya existía como campo y flujo. **No**
  hay endpoints nuevos, **no** hay dinero saliente, **no** hay `$queryRaw`, **no** hay nuevos campos
  de entrada sensibles (los DTOs `Update/Move/Mark/CreateLocation` están acotados por `IsIn/IsString/@Min`).
  El refactor de `paginate<T>`/`mockJobId`/`mockTempPassword` toca **solo ramas mock** (deuda techlead
  Ola 1) — sin efecto en producción. Las nuevas queries de filtro usan **Prisma parametrizado**
  (`listItems`, `inventory.service.ts:199-216`), con `pageSize` **capado a 100** server-side
  (`inventory.controller.ts:59`) → sin abuso de paginación.

## E.6 VEREDICTO — Ola 2 M1 (`a72f6e6`): **APROBADO**
- **0 Críticos / 0 Altos / 0 Medios / 0 Bajos nuevos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **SEC-A1 intacto:** `listPriceCents` es override manual legítimo del operador; la **referencia** de
  mercado se deriva/valida **server-side** y el cliente no puede manipularla. Invariantes
  (sellado exige precio, gradeada publicada exige cert) impuestas por el backend.
- **Perdida/dañada:** endpoint `vault_operator+`, **auditado**, nota **obligatoria** en DTO; el estado
  físico lo mueve el operador pero el dinero saliente sigue vetado (`MoneyOutGuard` → `super_admin`).
- **Autorización 100% server-side** en las 6 acciones (guards globales); UI cosmética. Sin fuga de
  PII en el detalle; `useErrorMessage` sin regresión.
- **¿Basta la revisión estática?** **SÍ** para este bloque: es wiring UI→endpoints M1 preexistentes y
  endurecidos, sin lógica de dinero nueva ni superficie de red nueva. Los vectores dinámicos
  (concurrencia, idempotencia, rate-limit con tráfico real) ya están en la lista **[pendiente de DAST]**
  (§6) y **no** los altera este commit.
- **Deuda previa sin cambio:** B-3/S-B3 (`listPriceCents` sin `@Max`, dinero en `Int` 32-bit) sigue
  **aceptada con disparador** enrutada a arquitecto/backend; **no** bloquea este merge. Banderas
  legales de custodia/PII (§6) siguen abiertas para el humano, sin cambio.
- **¿Puede ir a `main`?** **SÍ.**

---

# F. Revisión Fase 0 — Epic de precios / cierre del bypass del umbral INE (commit `ebb4dee`) · rama `claude/git-repo-review-c67xyk`

> **Alcance:** Fase 0 del epic de precios. Foco de seguridad: (0.3) cierre del **bypass del umbral
> INE / topes AML** vía líneas `precio_pendiente`; (0.1) **gate premium** del clasificador de rareza
> que corrige la **subcotización** de chase sin abrir money-out; y verificación de que **SEC-A1**
> (montos derivados/validados server-side) sigue intacto, incluida la **regresión positiva B-4**
> (cap de aprobación).
> **Modo:** revisión **estática** de código (buylist/pricing/money) cruzada con `docs/PENTEST_NOTES.md`.
> Sin stack vivo (R2/Railway sin configurar) → los vectores de concurrencia siguen **[pendiente de
> DAST]** (§6). **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## F.0 Resumen — **0 Críticos / 0 Altos**; 1 Media + 2 Bajas abiertas (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 1 | **F-1** — contabilidad AML mensual no re-cuenta ítems que fueron `precio_pendiente` |
| Baja | 2 | **F-2** — allowlist `isPremiumRarity` finita (chase antiguas subcotizan); **F-3** — dedup de `escalatePending` no atómico |

## F.1 Bypass del umbral INE — **CERRADO · [Verificado en código]**
- **El hueco (pentest):** un ítem `precio_pendiente` suma **0** a `quotedTotalCents`, que es la base
  del tope por-solicitud, el tope mensual y el **umbral INE**. Un cliente podía enviar una carta CARA
  **sin referencia** → sumaba $0 → no se le exigía INE ni topaba contra los caps AML.
- **El cierre:** `buylist.service.ts:221-227` — `hasPendingLine = itemsData.some(i => i.itemStatus
  === 'precio_pendiente')` y `ineRequired = quotedTotalCents >= ineThreshold || hasPendingLine`. Si
  hay **≥1 línea pendiente**, se **EXIGE INE** (`INE_REQUIRED`, 422) por decisión conservadora: la
  incertidumbre del monto se trata como potencialmente por encima del umbral. **Solo endurece**; no
  debilita ningún control existente. Confirmado en código.

## F.2 Gate premium (Fase 0.1) — corrige subcotización SIN abrir money-out — **OK · [Verificado en código]**
- `common/money.ts:149` `isPremiumRarity(rarity)` + `:177-184`: una rareza **premium/chase** SIEMPRE
  cotiza por **su propia regla** (o fallback pct) y **NUNCA** cae al bin "Holo" ni a un plano de menor
  valor. Corrige el **bug de dinero** por el que una holo premium sin "holo" en el string resolvía a
  una referencia más barata (**subcotización** = la plataforma pagaba de menos, o el precio de venta
  quedaba bajo). El fix mueve el precio **hacia arriba** para el chase — **no** abre un vector de
  dinero saliente: la cotización sigue siendo **entrada al server** derivada de `Card.rarity` real, no
  del DTO (**SEC-A1 intacto**, §F.3). Sin impacto de authz ni de desembolso.

## F.3 SEC-A1 y regresión positiva B-4 — **INTACTOS · [Verificado en código]**
- **SEC-A1:** los montos se derivan de la **rareza real** de la carta (`prisma.card` server-side),
  no del cliente; el DTO no transporta `category`/precio manipulable. Sin cambio respecto a §B.4.
- **B-4 → MITIGADO (regresión positiva):** `assertApprovedPriceWithinCap`
  (`buylist.service.ts:510`, invocado en approve/adjust `:556,562`) topa la aprobación a
  **min(quotedPriceCents × 2, capAML)** → `422 APPROVED_PRICE_CAP_EXCEEDED`. Un `vault_operator` no
  puede aprobar montos arbitrarios; el desembolso SPEI sigue `@MoneyOut` **super_admin + auditado** y
  usa el monto **capado** como base de costo. Ya registrado como cerrado (S-B5, §1247); se re-confirma
  intacto tras la Fase 0.

## F-1 (Media, abierta con disparador) — Contabilidad AML mensual no re-cuenta lo que fue `precio_pendiente`
- **Ubicación:** `buylist.service.ts:294-307` (`monthUsedCentsTx`).
- **Descripción:** el acumulado mensual agrega `_sum: { quotedTotalCents }` de las `SellRequest` del
  mes. Un ítem que entró como `precio_pendiente` aportó **0** al `quotedTotalCents` **persistido** de
  su solicitud; cuando luego se **resuelve/aprueba** con un `approvedTotalCents` > 0, ese monto real
  **no** vuelve a sumarse al acumulado mensual (el agregado sigue leyendo `quotedTotalCents`, no
  `approvedTotalCents`). Un cliente que reparta cartas caras como pendientes puede, en teoría, **quedar
  por debajo del tope mensual AML medido** aunque el dinero efectivamente desembolsado lo supere.
- **Por qué NO es bloqueante (compensado, defensa en capas):** (1) **INE-con-pendiente** ya exige
  identificación ante cualquier línea pendiente (§F.1) → no hay anonimato; (2) el **cap por-solicitud**
  (`BUYLIST_LIMIT_EXCEEDED`, `:201-207`) sigue acotando cada solicitud; (3) **money-out** de la
  recompra está tras `@MoneyOut` **super_admin + auditado** (revisión humana del desembolso). El
  faltante es de **medición contable AML**, no un money-out sin control.
- **Rol dueño:** **backend** — que el acumulado mensual cuente el **monto efectivo** (usar
  `approvedTotalCents` cuando exista, o re-imputar al resolver el pendiente). **Disparador: abrir
  ticket a backend ANTES de operar con dinero real / volumen que dispare reportes AML/PLD.**

## F-2 (Baja, abierta con disparador) — Allowlist `isPremiumRarity` finita → chase antiguas subcotizan
- **Ubicación:** `common/money.ts:149` (`isPremiumRarity`).
- **Descripción:** la allowlist premium cubre el set moderno (V/VMAX/VSTAR/EX/GX/Illustration/Ultra/
  Double Rare, etc.) pero **no** rarezas chase **antiguas** (Shining, Prime, LEGEND, BREAK, ACE
  SPEC...). Esas caen al camino no-premium y pueden **subcotizar** (referencia más baja de la debida).
- **Impacto:** **subcotización** (la plataforma paga/vende de menos) — **no** hay money-out inflado ni
  fuga; es pérdida de exactitud de precio, no un hueco de dinero saliente. Se prefiere sobre-incluir.
- **Rol dueño:** **backend/arquitecto** — extender la allowlist (o mover a catálogo de rarezas
  configurable). **Disparador:** al incorporar inventario/buylist de sets vintage relevantes.

## F-3 (Baja, abierta con disparador) — Dedup de `escalatePending` no atómico → duplicados bajo concurrencia
- **Ubicación:** `pricing.service.ts:189-195` — `findFirst({... status:'open'})` **y luego**
  `create(...)`, sin `@@unique` en `PendingPriceEntry` (`schema.prisma`).
- **Descripción:** patrón **read-then-write** sin unicidad a nivel de BD: dos escalaciones concurrentes
  del mismo `(cardId, productType, gradeKey, finish)` pueden ambas ver "no open" y crear **dos**
  entradas pendientes duplicadas.
- **Impacto:** ruido en la cola de precios pendientes (el operador resuelve dos veces la misma carta);
  **sin** efecto de dinero saliente, authz ni PII. Solo higiene de datos.
- **Rol dueño:** **backend** (+ **arquitecto** por el schema) — añadir `@@unique` parcial sobre
  `(cardId, productType, gradeKey, finish)` para `status='open'` (o upsert idempotente). **Disparador:**
  antes de exponer el buylist a concurrencia real / múltiples réplicas.

## F.4 Banderas para el humano (Fase 0)
- **Compliance/legal AML-PLD:** validar la **política AML** implementada — (a) exigir **INE ante
  cualquier línea pendiente** (§F.1) y (b) la **contabilidad mensual actual** (§F-1, que hoy mide sobre
  `quotedTotalCents`). Confirmar con compliance que el umbral, los topes y la medición efectiva
  cumplen la normativa de PLD antes de operar con dinero real.
- **DAST de concurrencia de buylist — PENDIENTE (heredado, obligatorio antes de prod):** mantener en la
  cola de DAST los vectores de **carrera de `escalatePending`** (F-3) y **carrera del cap mensual**
  (`monthUsedCentsTx` bajo tráfico concurrente, ya cubierto por el aislamiento SERIALIZABLE en código
  pero sin validación dinámica). Ejecutar en cuanto haya **staging autorizado** (§6).

## F.5 VEREDICTO — Fase 0 (epic de precios, `ebb4dee`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Bypass del umbral INE CERRADO** (`ineRequired = quotedTotalCents >= umbral || hayLíneaPendiente`,
  `buylist.service.ts:221-227`). **SEC-A1 intacto**; el **gate premium (0.1)** corrige la
  subcotización de chase **sin** abrir money-out. **Regresión positiva:** **B-4 mitigado** por
  `assertApprovedPriceWithinCap` (aprobación topada a **min(quoted × 2, capAML)**).
- **Abiertos NO bloqueantes (con disparador):** **F-1 (Media)** contabilidad AML mensual sobre
  `quotedTotalCents` en vez del monto efectivo — compensado por INE-con-pendiente + cap por-solicitud +
  money-out super_admin auditado; **abrir ticket a backend ANTES de operar con dinero real / volumen
  AML**. **F-2 (Baja)** allowlist premium finita (subcotización de chase antiguas), dueño
  backend/arquitecto. **F-3 (Baja)** dedup de `escalatePending` no atómico (duplicados bajo
  concurrencia), dueño backend + arquitecto (schema).
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y banderas legales de custodia/PII
  (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)** heredada sigue
  **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea esta Fase 0.
- **¿Puede ir a `main`?** **SÍ.**

---

# G. Revisión Fase 1 — catálogo priceado + job 2×/día (commit `a6a79df`) · rama `claude/git-repo-review-c67xyk`

> **Alcance:** Fase 1 del epic de precios (diseño v1.12-catalog-pricing). Focos de seguridad:
> (1.1) priceado de **TODO el catálogo** durante `catalog-sync` (`PricingService.persistMarketReference`
> + `catalog-sync.service.persistMarketReferences`); (1.2) **`publicQuote` de vuelta a READ-ONLY**
> (cierra **BE-16**: el endpoint anónimo ya no escribe en la cola de trabajo); (1.3) **job
> `catalog-price-sync` 2×/día** (BullMQ repeatable, `syncAll force:true`) + disparo manual
> `POST /admin/jobs/catalog-price-sync`. Verifico authz/auditoría, integridad de dinero (FX/market/
> override), manejo de la API key y anti-abuso.
> **Modo:** revisión **estática** de código cruzada con `docs/PENTEST_NOTES.md`. Sin stack vivo
> (R2/Railway sin configurar) → concurrencia sigue **[pendiente de DAST]** (§6).
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## G.0 Resumen — **0 Críticos / 0 Altos**; 2 Bajas abiertas (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 2 | **G-1** — TOCTOU en `persistMarketReference` (guard `isManualOverride` no atómico); **G-2** — `catalog-price-sync` sin `@Throttle` propio (single-flight mitiga) |

## G.1 Cierres / positivos verificados — **[Verificado en código]**
- **BE-16 CERRADO — `publicQuote` read-only.** `buylist.service.ts:58-102`: el cotizador público
  **elimina** la escalada a `PendingPriceEntry` que la Fase 0 había agregado; si el acabado sigue
  `precio_pendiente`, el quote lo **reporta sin escribir nada** (`:76-82`). Un endpoint público/
  anónimo **ya no escribe** en la cola de trabajo del dueño → se cierra la superficie de abuso
  (enumerar cartas inflaba la cola). La escalada queda **solo** en el flujo autenticado
  `createRequest` (`:170-172`, `POST /buylist/requests`), sin cambio. **SEC-A1 intacto**: rareza +
  acabado se derivan server-side de `Card.rarity`/acabados reales, no del DTO (`:66-75`).
- **`POST /admin/jobs/catalog-price-sync` — authz + auditoría + single-flight.**
  `admin-jobs.controller.ts:22-23` `@Roles(Role.super_admin)` a **nivel de clase** (sin `@Public`;
  `JwtAuthGuard`→`RolesGuard` globales son la autoridad, rol del JWT nunca del body). El endpoint
  (`:148-161`) audita `jobs.catalog_price_sync.run` con `actorUserId`/`actorRole`/`entityType:'Job'`/
  `entityId`. **Anti-loop / single-flight:** `catalog-price-sync.service.ts:31` invoca
  `syncAll({force:true})`, protegido por `catalog-sync.service.ts:234` (`if
  (this.syncAllStatus.running)` → retorna sin solapar). Idempotente por `externalId` / clave día-
  acabado.
- **Integridad de dinero — sin vector de manipulación por el cliente.**
  - `persistMarketReference` (`pricing.service.ts:210-256`) **respeta el override manual**: lee la
    fila del día y si `existing?.isManualOverride` hace **skip** (`:228-230`) → el override del admin
    (§4.1) nunca es pisado por el flujo automático (salvo la carrera de G-1, abajo).
  - **FX legítimo:** el `market` (USD) proviene **solo** de `tcgplayer.prices` ya descargado de
    pokemontcg.io (`catalog-sync.service.ts:416-428`), **sin input de usuario**; la conversión
    USD→MXN usa el snapshot de `FxService` (Banxico) cargado **una vez por corrida** más el colchón,
    o el override del admin — **nunca** un valor del request.
  - **Descarta `market <= 0`:** `catalog-sync.service.ts:424-425` (`if (market == null || market <=
    0) continue`) → una carta/acabado sin market **no** crea referencia ni escala pendiente (no
    inunda la cola, no siembra precios en 0). Montos en **centavos enteros** (`Math.round(market*100)`,
    `:426`).
- **API key fuera de logs.** `pokemontcg-io.client.ts:56-58` toma `POKEMONTCG_IO_API_KEY` de
  `ConfigService` y la envía **solo** en el header `X-Api-Key`; los `logger.warn` (`:79-80`) registran
  únicamente path + status HTTP, **nunca** la clave. **Backoff 429 respetado:** `:73-80` reintenta
  ante 429/5xx honrando `Retry-After` (o backoff exponencial) → no aborta el sync ni martillea la API.

## G-1 (Baja, abierta con disparador) — TOCTOU en `persistMarketReference` (guard `isManualOverride` no atómico)
- **Ubicación:** `pricing.service.ts:228-231` — `findUnique(where:key)` **y luego**
  `upsert(...)`, con el guard `if (existing?.isManualOverride) return;` **entre** ambas operaciones
  (patrón read-then-write, no atómico).
- **Descripción:** si un **override manual** del admin sobre el mismo `(cardId,'raw','raw:NM',finish,
  hoy)` ocurre concurrentemente con una corrida de `catalog-sync`, el sync pudo leer la fila
  **antes** del override (`isManualOverride=false` o inexistente) y luego el `upsert` la reescribe con
  `source:'pokemontcg_io'` + `isManualOverride:false` (`:247-254`), **pisando** el override del día.
- **Impacto:** un precio de referencia manual del admin podría quedar sobrescrito por el market
  automático **solo bajo carrera del mismo día**. Es **integridad de precio de referencia** (afecta
  cotización), no un money-out sin control: el desembolso SPEI sigue tras `@MoneyOut` super_admin +
  auditado, y la aprobación está topada por `assertApprovedPriceWithinCap` (B-4). Ventana estrecha
  (override manual y corrida de sync en paralelo el mismo día). **Baja.**
- **Rol dueño:** **backend** — cerrar con escritura atómica que preserve el override, p. ej.
  `updateMany({ where:{ ...key, isManualOverride:false }, data:{...} })` (o upsert condicionado), de
  modo que la fila con `isManualOverride=true` nunca sea alcanzada por el update. **Registrado como
  BE-22.** **Disparador:** antes de operar con dinero real / concurrencia real (múltiples réplicas o
  admin editando mientras corre el job 2×/día).

## G-2 (Baja/Info, abierta con disparador) — `POST /admin/jobs/catalog-price-sync` sin `@Throttle` propio
- **Ubicación:** `admin-jobs.controller.ts:148-161` (endpoint) — sin decorador `@Throttle` propio; se
  apoya en el throttler global.
- **Descripción:** cada disparo lanza un re-sync completo (`syncAll force:true`) que hace un `getSets`
  contra pokemontcg.io y reprocesa todo el catálogo. Sin un `@Throttle` específico, un super_admin
  podría dispararlo repetidamente. **Mitigado** por el **single-flight** (`syncAllStatus.running` →
  las llamadas solapadas retornan sin trabajar) y por ser un endpoint **super_admin + auditado**, así
  que el riesgo es de **carga hacia pokemontcg.io / consumo de rate-limit**, no de authz ni de dinero.
- **Impacto:** Bajo/Info — presión sobre la API externa y el rate-limit; sin efecto de authz, PII ni
  money-out. El backoff 429 del cliente amortigua.
- **Rol dueño:** **devops/backend** — añadir `@Throttle` propio (o cooldown) al disparo manual y, al
  escalar a multi-instancia, mover single-flight/throttler a store compartido (Redis) para coordinar
  entre réplicas. **Registrado como BE-23.** **Disparador:** al exponer el panel admin a operación
  real / despliegue multi-réplica.

## G.3 Banderas para el humano (Fase 1)
- **Pentest de tercero + programa de bug bounty ANTES de operar con dinero real** (heredado,
  obligatorio). Sigue vigente para todo el epic de precios.
- **DAST contra staging — PENDIENTE, obligatorio antes de prod.** Sumar a la cola de DAST los
  vectores de esta fase: **concurrencia del single-flight / re-sync del catálogo** (dos réplicas
  disparando `syncAll` en paralelo; carrera de G-1 override-vs-sync el mismo día) y el **webhook de
  Stripe** (firma/idempotencia bajo carga). Ejecutar en cuanto haya staging autorizado (§6).
- **Licencia / contrato de datos de la fuente de precios.** Validar la **base legal/comercial** de
  usar `market` de **pokemontcg.io / TCGplayer** como **precio de referencia** para una operación de
  **custodia comercial** (compra/venta con dinero real): términos de uso, atribución y si el uso
  comercial de esos precios está permitido. Confirmar con legal antes del go-live.

## G.4 VEREDICTO — Fase 1 (catálogo priceado + job 2×/día, `a6a79df`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Positivos verificados:** `publicQuote` **read-only** (BE-16 CERRADO; escalada solo en
  `createRequest` autenticado); `POST /admin/jobs/catalog-price-sync` **super_admin + auditado +
  single-flight**; **integridad de dinero** (`persistMarketReference` respeta `isManualOverride`; FX
  de Banxico/override, nunca del request; market solo de pokemontcg.io sin input de usuario; descarta
  `market<=0`; centavos enteros); **API key** por header desde config, fuera de logs; **backoff 429**
  respetado.
- **Abiertos NO bloqueantes (con disparador):** **G-1 (Baja)** TOCTOU en `persistMarketReference`
  (`pricing.service.ts:228-231`) → override manual concurrente del mismo día podría ser pisado;
  mitigación `updateMany WHERE isManualOverride=false`; dueño **backend** (**BE-22**). **G-2
  (Baja/Info)** `catalog-price-sync` sin `@Throttle` propio (single-flight mitiga); dueño
  **devops/backend** (**BE-23**).
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y las banderas legales de
  custodia/PII (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)**
  heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea esta
  Fase 1.
- **¿Puede ir a `main`?** **SÍ.**

---

# H. Revisión Fase 3a — rediseño del cotizador buylist (commit `10d5205`) · frontend

> **Alcance:** Fase 3a del rediseño del cotizador buylist (frontend). Focos de seguridad:
> (H.1) el front solo **muestra** estimados/totales y **no** envía montos/rareza del cliente en
> `createRequest` (SEC-A1 desde la superficie de UI); (H.2) el atajo CLABE "Usar mi ****1234"
> (aislamiento del flag + descarte en `api.ts`); (H.3) gating P-11 intacto (la UI comunica, el
> backend decide). Cruzado con `docs/PENTEST_NOTES.md`.
> **Modo:** revisión **estática** de código (frontend). Sin stack vivo → concurrencia/DAST sigue
> **[pendiente de DAST]** (§6).
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## H.0 Resumen — **0 Críticos / 0 Altos**; 1 Baja + 1 Info (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 1 | **H-1** — fan-out del auto-quote (~`pageSize` POST /buylist/quote por búsqueda) |
| Info | 1 | **H-2** — todo depende del flag build-time `NEXT_PUBLIC_USE_MOCKS` |

## H.1 Positivos verificados — **[Verificado en código]**
- **SEC-A1 intacto en la superficie de UI.** El front **solo muestra** estimados/totales derivados;
  `createRequest` **NO** envía montos ni rareza del cliente — el backend deriva todo server-side de
  `Card.rarity`/acabados reales (consistente con §B.4/§F.3/§G.1). Un DTO manipulado desde el cliente
  no puede inflar el total; el cotizador es informativo y el backend sigue siendo la autoridad de
  precio.
- **Atajo CLABE "Usar mi ****1234" — doblemente aislado.** `clabeShortcutAvailable = !!clabeMasked
  && config.useMocks`: el atajo **solo** aparece en modo mocks. En modo real, el flag
  `useClabeOnFile` se **descarta en `api.ts`** antes de salir a la red → contra el backend real se
  **exige la CLABE de 18 dígitos**, sin bypass del flujo KYC/AML. No hay vía por la que el atajo de
  UI evite la captura/verificación de CLABE real.
- **Gating P-11 intacto.** La UI **comunica** el estado (habilitado/deshabilitado) pero **el backend
  decide**; la vista no es la autoridad de autorización. Defensa en profundidad correcta (patrón
  consistente con las vistas admin gatadas de §A.3/§A.4).

## H-1 (Baja, abierta con disparador) — Fan-out del auto-quote por resultado
- **Descripción:** el auto-quote dispara ~`pageSize` `POST /buylist/quote` por búsqueda (una por
  resultado de la página). **Mitigado** por cache/dedupe + throttle (300/min): las llamadas repetidas
  se sirven de cache y el throttler global acota el ritmo. El riesgo es de **carga/eficiencia** de
  red, no de authz, PII ni money-out.
- **Impacto:** Bajo — amplificación de peticiones al endpoint de quote; sin efecto de seguridad de
  dinero/datos. El endpoint de quote es de solo-lectura (no escribe en la cola de trabajo tras el
  cierre de BE-16, §G.1).
- **Rol dueño:** **frontend/arquitecto** — se **cierra con el batch quote de Fase 3b** (una sola
  llamada por página). **Disparador:** al implementar Fase 3b / antes de exponer el cotizador a
  tráfico real.

## H-2 (Info, abierta con disparador) — Todo depende del flag build-time `NEXT_PUBLIC_USE_MOCKS`
- **Descripción:** el aislamiento del atajo CLABE y del modo mocks depende del flag **build-time**
  `NEXT_PUBLIC_USE_MOCKS`. Si se compilara el bundle de producción con el flag mal puesto, la UI
  entraría en modo mocks. **Mitigación de defensa en profundidad:** aunque el flag fallara, `api.ts`
  descarta `useClabeOnFile` en el path real y el backend exige la CLABE de 18 dígitos → no hay bypass
  KYC/AML por sí solo; el impacto sería de comportamiento de UI, no de money-out.
- **Rol dueño:** **devops** — **verificar `NEXT_PUBLIC_USE_MOCKS=false` en el gate de build de prod**
  (checar en el pipeline de CI/SAST antes de promover el bundle). **Disparador:** en cada build de
  producción.

## H.3 Carryover (heredado, fuera de alcance de esta fase)
- **B-5 (token en query-string) sigue ABIERTO.** Dueño **frontend**. No es parte del rediseño del
  cotizador de Fase 3a; se mantiene en seguimiento hasta que frontend lo cierre. No bloquea esta fase.

## H.4 VEREDICTO — Fase 3a (rediseño del cotizador buylist, `10d5205`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Positivos verificados:** **SEC-A1** en la UI (el front solo muestra estimados/totales;
  `createRequest` no envía montos/rareza del cliente); **atajo CLABE doblemente aislado**
  (`clabeShortcutAvailable = !!clabeMasked && config.useMocks`; `useClabeOnFile` descartado en
  `api.ts` en modo real; backend exige CLABE de 18 dígitos, sin bypass KYC/AML); **gating P-11
  intacto** (UI comunica, backend decide).
- **Abiertos NO bloqueantes (con disparador):** **H-1 (Baja)** fan-out del auto-quote
  (~`pageSize` POST /buylist/quote por búsqueda; mitigado por cache/dedupe + throttle 300/min), dueño
  **frontend/arquitecto**, **se cierra con el batch quote de Fase 3b**; **H-2 (Info)** dependencia del
  flag build-time `NEXT_PUBLIC_USE_MOCKS`, dueño **devops** (verificar `=false` en el gate de prod).
- **Carryover:** **B-5** (token en query-string) sigue abierto, dueño **frontend**, fuera de alcance.
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y banderas legales de
  custodia/PII (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)**
  heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea Fase 3a.
- **¿Puede ir a `main`?** **SÍ.**

---

# I. Revisión Fase 2 — precio de venta por rareza (commits `fba6486` + `fee3c19`) · backend + frontend

> **Alcance:** Fase 2 del epic de precios — **precio de venta** derivado por **rareza** (`Card.rarity`)
> + **acabado** (`InventoryItem.finish`) server-side, endpoints admin `sales-rules`/`sales-rarities`,
> validador de reglas, `publishedWhere` relajado y reserva atómica anti doble-venta. Cruzado con
> `docs/PENTEST_NOTES.md`.
> **Modo:** revisión **estática** de código. Sin stack vivo → concurrencia de checkout sigue
> **[pendiente de DAST]** (§6).
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## I.0 Resumen — **0 Críticos / 0 Altos**; 2 Bajas abiertas (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 2 | **I-1 / B-6** — orden a $0 por `fixed:0` (`salePriceOf` no rechaza `<=0`); **I-2 / B-7** — `fixed` sin cota superior → overflow Int32 |

## I.1 Positivos verificados — **[Verificado en código]**
- **SEC-A1 en el precio de venta.** El precio de venta se **deriva server-side** de `Card.rarity` +
  `InventoryItem.finish`; el **comprador no influye** en el monto. El checkout solo transporta
  `inventoryItemIds` → un DTO manipulado no puede fijar/rebajar el precio. Consistente con la
  derivación server-side de las fases previas (SEC-A1).
- **Endpoints `sales-rules` / `sales-rarities` — super_admin + auditados.** La escritura de reglas de
  precio de venta está restringida a **super_admin** y **auditada** (mismo patrón que M2 buylist-rules
  de §B.5). El comprador nunca alcanza estos endpoints.
- **Validador robusto.** El validador **rechaza NaN / Infinity / negativos** → no se pueden sembrar
  reglas absurdas que rompan el cálculo del precio de venta.
- **`publishedWhere` relajado NO expone custodia de clientes.** El relajamiento mantiene
  **`ownerType:'platform'` intacto** → solo se publica/vende inventario **de la plataforma**; el
  inventario en **custodia de clientes** no se expone a la venta pública. Sin fuga de custodia.
- **Reserva atómica anti doble-venta — intacta.** El guardarraíl de reserva atómica (`updateMany`
  guardado por estado vendible + `count!==1 → ITEM_UNAVAILABLE` en `$transaction`, §2) **sigue
  intacto** tras el cambio de precio por rareza. Sin regresión de doble-venta.

## I-1 / B-6 (Baja, abierta con disparador) — Orden a $0 por regla `fixed:0`
- **Descripción:** `salePriceOf` **no rechaza** precios `<= 0`. Una regla de venta con `fixed:0`
  (sembrada por super_admin, por error) produciría un precio de venta de **$0** → orden a $0. El
  insumo proviene de un **rol confiable** (super_admin) y **auditado**, y el validador ya bloquea
  negativos, pero **no** el cero.
- **Impacto:** Bajo — venta a $0 solo si un super_admin fija `fixed:0`; sin fuga de PII ni money-out
  descontrolado, pero pérdida directa de inventario/valor si ocurre. Es endurecimiento de integridad
  financiera.
- **Rol dueño:** **backend** — recomendación: **`fixed >= 1`** en el validador **+ rechazar `<= 0`**
  en `salePriceOf`. **Endurecer ANTES de operar con dinero real.** (Coincide con **B-6** del
  pentest.)

## I-2 / B-7 (Baja, abierta con disparador) — `fixed` sin cota superior → overflow Int32
- **Descripción:** el campo `fixed` de las reglas de venta **no tiene cota superior**; un valor
  suficientemente grande desborda el `Int` de 32 bits de Postgres al calcular/persistir el precio.
  Extiende **B-3** del pentest (dinero en `Int` 32-bit / falta de `@Max`) al nuevo campo de reglas de
  venta.
- **Impacto:** Bajo — insumo de **rol confiable** (super_admin) + **auditado**; distorsión/overflow
  del precio de venta, no un money-out saliente sin control.
- **Rol dueño:** **backend** — cota superior razonable (`@Max`) en `fixed`; se enlaza con **B-3/S-B2**
  (evaluar `BigInt` para agregados de dinero) — mismo dueño/decisión. **Endurecer antes de dinero
  real.**

## I.2 VEREDICTO — Fase 2 (precio de venta por rareza, `fba6486` + `fee3c19`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Positivos verificados:** **SEC-A1** (precio de venta derivado server-side de `Card.rarity` +
  `InventoryItem.finish`; el comprador no influye; checkout solo lleva `inventoryItemIds`); endpoints
  `sales-rules`/`sales-rarities` **super_admin + auditados**; validador **rechaza NaN/Infinity/
  negativos**; `publishedWhere` relajado **NO** expone custodia de clientes (`ownerType:'platform'`
  intacto); **reserva atómica anti doble-venta intacta**.
- **Abiertos NO bloqueantes (con disparador):** **I-1 / B-6 (Baja)** orden a $0 por `fixed:0`
  (`salePriceOf` no rechaza `<=0`; recomendación `fixed>=1` + rechazar `<=0`), dueño **backend**,
  **endurecer antes de dinero real**; **I-2 / B-7 (Baja)** `fixed` sin cota superior → overflow Int32
  (extiende B-3), dueño **backend**.
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y banderas legales de
  custodia/PII (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)**
  heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea Fase 2.

## I.3 Banderas para el humano (Fases 3a + 2)
- **DAST / pentest de tercero PENDIENTE antes de dinero real** (heredado, obligatorio): en particular
  **concurrencia de checkout** (reserva atómica bajo carga), **webhook de Stripe** (firma/idempotencia)
  y **rate-limit del cotizador** (fan-out H-1 / abuso del auto-quote). Ejecutar en cuanto haya staging
  autorizado (§6).
- **Decidir B-6 / B-7 como endurecimiento previo a producción:** rechazar precio de venta `<= 0`
  (`fixed >= 1`) y fijar cota superior a `fixed` (junto con la decisión `BigInt` de B-3/S-B2). Dueño
  **backend**; endurecer antes de operar con dinero real.
- **¿Puede ir a `main`?** **SÍ** (ambas fases: 3a y 2).

---

# ANEXO rev v1.6 (2026-08-19) — Work stream «Sellado / Venta de producto cerrado»

> **Rama:** `claude/sellado-producto-cerrado` (HEAD actual). **Modo:** revisión **estática** de
> código (blue team) + consolidación del pase **PENTEST §"Pase v1.6"** (red team). Sin stack vivo
> (Docker/Postgres/Redis ausentes) → vectores que exigen runtime = **[PoC pendiente de DAST]**;
> confirmados por lectura = **[Verificado en código]**. **Foco del PO:** ruta de dinero/autoprecio
> del sellado + puerta pública del restock por correo. Superficie nueva: `catalog/*` (sellado),
> `pricing.*`, `common/money.ts`, `vault.service.ts`, `admin-vaults.*`, migración M-28,
> `settings.constants.ts`.

## S.0 Resumen ejecutivo del stream

La **ruta de dinero/autoprecio del sellado se validó SÓLIDA** y sin regresión. El precio de venta se
resuelve por un **único** camino server-side (`PricingService.resolveSealedSalePrice` =
`gateSealedMarketCents` + pura `computeSealedSalePrice`), **compartido** por grid, ficha, catálogo,
Compra (`orders.salePriceOf`), bulk-publish y valuación de bóveda ⇒ **precio mostrado == precio
cobrado**. El DTO del cliente **nunca** aporta precio; `listPriceCents`/`sealedSubtype`/`ref` salen de
BD y los spreads de `ConfigSetting`. El **gate money-safe fail-closed está intacto**: seed
`sealed_price_source='off'` (`sourceOn = value==='tcgcsv'` ⇒ mercado **inerte**; sin override>0 ⇒
`PRICE_PENDING`, no se publica), `override<=0` se ignora (nunca se vende gratis/bajo mercado),
spreads capados `[0,1000]`, `listPriceCents @Max 100_000_000`, y `GET/PUT /admin/pricing/sealed-spreads`
= `@Roles(super_admin)` **auditado before/after** (no editables por `PUT /admin/settings`). **0
Críticas / 0 Altas.**

El riesgo real del stream vive en la **puerta pública del restock** (S-1: sin consentimiento/dedup/
`@@unique` → email-bomb diferido + bloat de BD) y en el **grid público sin cota de paginación en BD**
(S-2: DoS anónimo). Ambos hoy **atenuados** (S-1 tras flag `sealed_restock_alerts=off`; S-2 vivo pero
con throttle global por IP). **Consolido los 5 hallazgos del pentester; todos se confirman en código;
ajusto S-4 a Info y elevo S-7 (userId inerte) a Baja** porque debilita el control anti-abuso de S-1.

| Severidad final (blue team) | # | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 2 | S-1 (condicionada al flag), S-2 |
| Baja | 3 | S-3, S-5, **S-7 (elevado desde Info)** |
| Info/positivo | 3 | **S-4 (bajado desde Baja)**, S-6, S-8 |

## S.1 Tabla consolidada — hallazgos del stream (validados vs. código)

| ID | Hallazgo | Sev. pentester | **Sev. final** | Estado | Rol dueño | Evidencia [Verificado en código] |
|---|---|---|---|---|---|---|
| **S-1** | Restock público: correo sin opt-in/consentimiento + sin dedup + sin `@@unique` → email-bomb diferido + bloat | Media (→Alta con flag on) | **Media** hoy / **Alta al encender el flag** | **REMEDIAR-ANTES-DE-FLAG** (bloqueante para encender `sealed_restock_alerts`) | **backend** + **arquitecto** (`@@unique`) + **devops** (mantener flag off) | `sealed-catalog.service.ts:269-331` acepta `email` arbitrario (solo regex), `create` sin buscar previa; migración M-28 `SealedRestockSubscription` sin `@@unique` (solo 3 índices no-únicos); `sealed-restock-notify.service.ts:87-101` envía **1 correo por fila** pendiente |
| **S-2** | `GET /catalog/sealed` (público) sin `take`/`skip` en BD: carga toda la tabla sellada+joins en memoria por request → DoS | Media | **Media** | **REMEDIAR** (no bloqueante por severidad; cerrar antes de GA/escala) | **backend** | `sealed-catalog.service.ts:47-52` `findMany` sin `take`; `listSealed:168-171` pagina con `.slice()` en memoria; `catalog.controller.ts:72-73` `@Public` **sin `@Throttle` propio** (sus hermanos `value-history`/`featured-set` sí llevan 60/min) |
| **S-3** | Correo restock: `productName` interpolado en HTML sin `escapeHtml` | Baja | **Baja** | Aceptada (remediar con S-1) | **backend** | `sealed-restock-notify.service.ts:113` `<strong>${productName}</strong>` sin escapar; `productName = card.name` (fuente catálogo/import, no input directo del atacante) |
| **S-4** | `value-history` sin filtro `ownerType`/`status` → serie de mercado de cualquier pieza sellada por id | Baja | **Info** (bajada) | Aceptada | **backend** | `sealed-catalog.service.ts:223-224` `findFirst({id, productType:'sealed'})` sin `status/ownerType` (vs. `sealedDetail:178-182` que sí). Datos = **precio de mercado TCGCSV público** (no PII, no precio de venta, no dueño) + endpoint **feature-flagged off** ⇒ bajada a Info |
| **S-5** | Restock: oráculo de temporización residual pese a 202 neutro | Baja | **Baja** | Aceptada | **backend** | `sealed-catalog.service.ts:299-330` ruta asimétrica (anclar Card real ⇒ `findFirst`+`findUnique`+`create`); existencia de sellado ya es en gran parte pública vía grid/ficha |
| **S-7** | `@CurrentUser('id')` inerte en ruta `@Public` → suscripciones siempre `userId=null` | Info | **Baja** (elevada) | Aceptada (remediar con S-1) | **backend** | `catalog.controller.ts:114` inyecta `userId?` pero `JwtAuthGuard` hace `return true` en `@Public` sin poblar `req.user` ⇒ `userId` siempre `undefined`. **Elevado a Baja**: impide un rate-limit/ownership por-usuario y por tanto **refuerza S-1** (toda suscripción queda anónima) |
| **S-6** | Feature-flags gateados server-side; micro-leak `FEATURE_DISABLED` vs 404 genérico | Info | **Info** | Aceptada | backend (opc.) | `sealed-catalog.service.ts:220,279` verifican el dial ANTES de tocar datos ⇒ **no bypassable**. Micro-fuga cosmética |
| **S-8** | Positivo — integridad de precio del sellado + authz sin regresión | Info+ | **Info+** | Confirmado | — | Resolver único server-side + gate fail-closed + spreads capados/auditados + IDOR scoped (ver S.2) |

## S.2 Ruta de dinero / autoprecio del sellado — VERIFICADA sin regresión (blue team)

- **Resolver único server-side (SEC-A1):** `pricing.service.ts:223-236` `resolveSealedSalePrice` =
  `gateSealedMarketCents(ref, sourceOn)` (`:206-210`) + pura `computeSealedSalePrice`
  (`money.ts:339-363`). Precedencia `override>0 > mercado×spread(subtype) > mercado×spread(global) >
  PRICE_PENDING`. El **mismo cuerpo** lo usan grid (`sealed-catalog.service.ts:72`), ficha, catálogo,
  **checkout** (`orders.service.ts:54-61`), bulk-publish y valuación de bóveda ⇒ **no hay discrepancia
  mostrado-vs-cobrado**. El cliente solo manda **ids**; ningún precio del DTO entra al cálculo.
- **Gate money-safe fail-closed INTACTO:** seed `sealed_price_source='off'`
  (`settings.constants.ts:100`); `sourceOn = value==='tcgcsv'` (`pricing.service.ts:172`) ⇒ con `off`
  el mercado TCGCSV queda **inerte** y el sellado solo se vende con **override>0**; sin override y sin
  mercado ⇒ `PRICE_PENDING` (no se publica). `override<=0` se trata como ausente
  (`money.ts:346-349`) ⇒ nunca se vende gratis ni bajo mercado por captura degenerada.
- **Diales capados y segregados:** `listPriceCents @Min(0) @Max(100_000_000)` en los 5 DTOs de alta/
  publicación (`inventory.dto.ts:61,70,113,131,167`); spreads `[0, 1000]` + subtype allow-listed
  (`settings.constants.ts:243-271`); `GET/PUT /admin/pricing/sealed-spreads` = `@Roles(super_admin)`
  con auditoría **before/after** (`pricing.controller.ts:78,344-386`); los spreads **NO** son editables
  por `PUT /admin/settings` (fuera de `SETTING_DTO_MAP`).
- **Sin doble-venta:** reserva atómica de checkout con `updateMany` guardado por estado vendible +
  `count===1` (patrón previo, sin regresión).
- **AuthZ/IDOR del sellado:** `GET /vault/sealed` scoped por `@CurrentUser('id')`;
  `GET /admin/vaults/:userId/sealed` = `@Roles(vault_operator, super_admin)` con proyección **sin
  CLABE/RFC/INE** (`admin-vaults.service.ts`). Sin lectura cruzada cliente-a-cliente. El sellado **no**
  introdujo superficie de money-out.

## S.3 Condiciones de gate (qué bloquea, qué se acepta con registro)

**BLOQUEANTE para encender `sealed_restock_alerts` (S-1) — antes del flip del dial DEBE cerrarse
TODO lo siguiente:**
1. **Titularidad/consentimiento del correo** — exigir **double opt-in** (token de confirmación, como
   el módulo de correo M-17) **o** restringir `email` al de la **sesión autenticada** (no aceptar
   email arbitrario de terceros). **[backend]**
2. **`@@unique(email, tcgplayerProductId, cardId, sealedSubtype, sealedCondition)`** en
   `SealedRestockSubscription` + **dedup** antes del `create` (idempotencia). **[arquitecto** (schema)
   **+ backend]**
3. **Cap de correos por víctima/producto** en el job de notificación (colapsar N filas a 1 envío) y
   escapar HTML del `productName` (**S-3**). **[backend]**
4. **Ligar la suscripción a un usuario** cuando haya sesión — corregir **S-7** (`@CurrentUser('id')`
   inerte en ruta `@Public`) para habilitar rate-limit/ownership por-usuario. **[backend]**
5. **devops:** mantener `sealed_restock_alerts=off` (y `sealed_value_trend=off`) hasta que backend/
   arquitecto confirmen 1-4; el flip queda gated por esta nota.

**ACEPTADO CON REGISTRO (no bloquea el cierre del stream):**
- **S-2 (DoS de paginación)** — **abierto y vivo** (el grid es público aunque el autoprecio esté off).
  No bloquea por severidad (Media, 0 Crit/Alta), pero **backend debe** paginar en BD (`take`/`skip` o
  cota dura + caché corta) y añadir `@Throttle` por IP al endpoint, **en paridad con sus hermanos**,
  **antes de GA/operar a escala**. Atenuante actual: throttler global por IP (in-memory/por instancia,
  débil en multi-instancia sin Redis — ver carryover devops).
- **S-3, S-4, S-5, S-6, S-7** — deuda de bajo riesgo con disparador (S-3/S-7 se cierran junto con S-1).
- **Carryover de dependencias:** `@nestjs/core`/`@nestjs/platform-express` **2 moderate**
  (GHSA-36xv-jgw5-4q75 / CVE-2026-35515, SSE injection) — **no específico del stream**, **no
  alcanzable** (backend sin SSE; `git grep @Sse|MessageEvent|text/event-stream` = 0). Sigue aceptado
  con disparador (bump a NestJS 11 en ventana de mantenimiento). **[devops]** No se infla: sin cambio
  respecto a rev v1.3-v1.5.

## S.4 Banderas para el humano (sellado)

- **No encender `sealed_restock_alerts` en producción** hasta cerrar S-1 (1-4 de §S.3). Es la única
  condición que **escala a Alta** si se ignora: convierte la plataforma en amplificador de spam a
  terceros usando su **reputación de envío** (riesgo de blacklist del dominio) + bloat de BD no acotado.
- **Antes de operar con dinero real** (transversal, ya en §6): **pentest de tercero + bug bounty**;
  **DAST contra staging** para los vectores [PoC pendiente de DAST] del stream — carga real de S-2,
  amplificación de S-1 con flag on, y timing de S-5.
- **Legal/PII:** sin superficie nueva de PII en el sellado (grid/ficha/valuación no exponen datos de
  dueño; admin-vaults sin CLABE/RFC/INE). El correo de restock guarda `email` de terceros **sin
  consentimiento verificado** ⇒ cerrar S-1 también por higiene de datos personales antes de operar.

## S.5 DoD de seguridad (CLAUDE.md) — verificación

- **Sin hallazgos Críticos/Altos abiertos:** **CUMPLE.** 0 Crit / 0 Alta en el stream (y en el
  histórico consolidado). S-1 es Media hoy (fail-closed por flag off); su escalada a Alta es
  **condicional y prevenida** por el gate de §S.3 (flag off + remediación previa al flip).
- **Aceptados registrados en este documento:** S-2 (remediar antes de GA), S-3/S-4/S-5/S-6/S-7
  (deuda con disparador), carryover `@nestjs/core` (aceptado, no alcanzable). Registrados arriba.

## S.6 Ruteo por rol dueño (stream Sellado)
- **backend:** S-1 (opt-in/dedup/cap), S-2 (paginar en BD + `@Throttle`), S-3 (escapar HTML), S-4
  (alinear `where` con `sealedDetail`), S-5 (igualar ruta de trabajo), S-7 (userId inerte).
- **arquitecto:** S-1 (`@@unique` en `SealedRestockSubscription` — cambio de schema/migración).
- **devops:** mantener `sealed_restock_alerts=off` y `sealed_value_trend=off` hasta cerrar S-1;
  carryover `@nestjs/core` (bump NestJS 11 + gate `npm audit` en CI); Redis para throttler multi-instancia.

## S.7 VEREDICTO del stream «Sellado»

**VEREDICTO seguridad (revisión estática, blue team): APROBADO-CON-CONDICIONES.**

- **0 Críticos / 0 Altos abiertos** ⇒ **no procede RECHAZO** (CLAUDE.md DoD). El stream **puede
  cerrar/mergear** con los aceptados registrados en este documento.
- La **ruta de dinero/autoprecio del sellado** está **verificada sin regresión**: resolver único
  server-side, gate money-safe fail-closed (`sealed_price_source='off'`), sin inyección de precio por
  el cliente, spreads capados/auditados/segregados (super_admin), sin doble-venta y sin IDOR nuevo.
- **CONDICIÓN VINCULANTE (S-1):** `sealed_restock_alerts` **DEBE permanecer `off`** en prod; encender
  el flag **sin** cerrar antes double opt-in/ownership + `@@unique`+dedup + cap de correos + S-7
  (§S.3, puntos 1-4) **reabre este veredicto como RECHAZO** (S-1 escala a Alta). devops no flipea el
  dial sin visto bueno de backend/arquitecto.
- **CONDICIÓN DE CIERRE PRE-GA (S-2):** no bloquea el merge por severidad, pero backend **debe**
  paginar en BD + `@Throttle` el grid público **antes de GA/escala**.
- **Deuda aceptada con disparador:** S-3/S-4/S-5/S-6/S-7 y carryover `@nestjs/core` (no alcanzable).
- **PENDIENTE (no aprobado a ciegas):** **DAST contra staging** para los vectores runtime del stream
  (carga real S-2, amplificación S-1 con flag on, timing S-5), en línea con el gate de promoción a prod.

---

# ANEXO 2026-08-19 — Stream `pulido-precios-display` (FX al vuelo + N-15 displayFinishes)

> **Rol:** seguridad (blue team). **Rama:** `claude/pulido-precios-display`. **Insumo:** `docs/PENTEST_NOTES.md`
> (ronda del stream: 0 Críticos / 0 Altos; 2 Bajos FX-B1/FX-B2, dueño backend). **Modo:** revisión estática
> de código + ejecución de los tests de seguridad (`fx-override`, `settings.validation`, `fx.buffer`). Sin
> stack vivo (Docker/Postgres/Redis ausentes) → vectores runtime = **[PoC pendiente de DAST en staging]**.
> **Blanco autorizado:** staging/local. **Foco pedido:** verificar con lente de seguridad el fix `b3270b3`
> de backend (FX-B1/FX-B2) y confirmar que N-15 `displayFinishes` no introduce vector de dinero.

## D.0 Resumen del stream

El stream de pulido tocó **dinero** en dos frentes: (1) FX "al vuelo" en el cotizador READ-ONLY (el
pentester ya verificó que órdenes/buylist congelan snapshot; solo el cotizador usa FX viva) y (2) N-15
`displayFinishes` (supresión display-only del acabado espurio). El pentester no halló Críticos ni Altos;
reportó **2 Bajos** (super_admin-only) en el dial `fx_manual_override_rate`. **Backend ya aplicó el fix en
`b3270b3`.** Verifico ese fix y confirmo los positivos. **0 Críticos / 0 Altos abiertos en el stream.**

| Severidad | # | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Baja | 2 | **FX-B1**, **FX-B2** — ambos **RESUELTOS en `b3270b3`** (verificado en código + tests) |
| Info/positivo | 4 | I-D1 … I-D4 |

## D.1 FX-B1 (cota superior del override) — **RESUELTO en `b3270b3` · [Verificado en código + tests]**
- **Hallazgo (pentester):** `fx_manual_override_rate` sin cota superior → un override absurdo (p.ej. `1e9`)
  inflaba la valuación USD y podía desbordar la columna `Int priceMxnCents` (~2.1e9) en el job `price-ingest`
  (excepción Prisma = DoS de la ingesta). Explotable **solo** por `super_admin`, por eso Bajo.
- **Fix verificado:** `backend/src/modules/settings/settings.constants.ts:280` — nueva
  `MAX_FX_MANUAL_OVERRIDE_RATE = 1000`; `:289-293` helper `validateFxManualOverrideRate` acepta `null` o
  número **finito** en `(0, 1000]` (rechaza `0`, negativos, `NaN`, `Infinity` y todo lo `> 1000`).
- **(b) La cota 1000 evita el overflow:** el peor caso legítimo de valuación queda muy por debajo de `2^31`
  (tipo de cambio real MXN/USD ~15-25; 1000 deja ~40-65x de holgura pero acota el desbordamiento). El vector
  del pentester (`1e9`) queda cerrado: `validateFxManualOverrideRate(1e9)` → error, no persiste. Mismo patrón
  que `SALES_PCT_MAX` / `SEALED_SPREAD_PCT_MAX`, ya aprobados.
- **Tests:** `fx-override-validation.spec.ts` — **12/12 PASS** (ejecutado esta sesión): acepta el techo,
  rechaza `techo+1` y `1e9`, rechaza `0`/negativos/`NaN`/`Infinity`, el mensaje nombra el rango.

## D.2 FX-B2 (validación asimétrica en dos puertas) — **RESUELTO en `b3270b3` · [Verificado en código + tests]**
- **Hallazgo (pentester):** el mismo dial se validaba distinto en `/admin/fx` (`@IsInt @Min(1)`) vs
  `/admin/settings` (`>0`, sin techo) → superficie inconsistente; una puerta más permisiva que la otra.
- **(a) Ambas puertas aplican AHORA el mismo rango `(0, 1000]`:**
  - `PUT /admin/settings` → `SettingsService.update` (`settings.service.ts:73`) corre `SETTING_VALIDATORS`;
    `settings.constants.ts:320` cablea `[FX_MANUAL_OVERRIDE_RATE] = validateFxManualOverrideRate` (el test
    `expect(gate).toBe(validateFxManualOverrideRate)` lo afirma por identidad de referencia).
  - `PUT /admin/fx` → `FxController.setManual` (`pricing.controller.ts:432-435`) llama el **mismo** helper
    `validateFxManualOverrideRate(dto.rate)` antes de escribir; `FxDto.rate` pasó a `@IsOptional @IsNumber`
    (`:46`) — el rango [min, MAX] lo impone el helper compartido, no el decorador. La puerta ya **no** queda
    más permisiva (antes `@Min(1)` sin techo; ahora rechaza `>1000` y admite fraccional válido).
- **Defensa en profundidad (bonus):** `FxController.setManual` → `FxService.setManual` → `settings.update`,
  que **re-valida** `fxManualOverrideRate` con el mismo `SETTING_VALIDATORS`. Aunque se saltara el check del
  controller, la escritura del override pasa por el validador una segunda vez. Doble candado en la ruta `/admin/fx`.
- **(c) Sin regresión money-safe:** override normal (`18`, `18.5`, `20.123456`) y `null` (borra el override)
  siguen aceptándose (tests `acepta un tipo de cambio realista y fraccional`, `acepta null`); `bufferPct`
  solo (sin pinnear la tasa) sigue funcionando (`acepta solo bufferPct sin pinnear la tasa`). Fraccional es
  correcto porque `FxRate.rate` es `Decimal(12,6)`.
- **(d) Sin otras puertas de escritura del dial sin el helper:** `git grep` de
  `fxManualOverrideRate|FX_MANUAL_OVERRIDE_RATE|fx_manual_override_rate` → los **únicos** escritores son
  `SettingsService.update` (vía SETTING_VALIDATORS) y `FxService.setManual` (invocado solo por
  `FxController.setManual`, ya validado). Ambos controllers son `@Roles(super_admin)`
  (`pricing.controller.ts:411` FxController, `:84` PricingController) + auditados (`fx.override`).
- **Tests:** cubierto por los 12 de `fx-override-validation.spec.ts` (incluye los 3 casos de `/admin/fx` que
  afirman "rechaza sobre el techo SIN escribir" con `setManualSpy not toHaveBeenCalled`).

## D.3 Positivos verificados (confirmo los del pentester)
- **I-D1 — Degradación segura ante fallo FX:** `fx.service.ts:89-122` `refreshFromBanxico` en fallo/`!ok`/
  tasa `<=0`/`NaN` cae a `getCurrent()` (override o último `FxRate`), y el fallback duro (`:58`) es una tasa
  conservadora (18) — nunca 0/NaN. `getCurrent` solo toma el override si `Number(override) > 0` (`:37`). Un
  fallo de FX **no** rompe el pricing ni fuerza market≤0.
- **I-D2 — Sin movimiento retroactivo:** órdenes/buylist congelan snapshot; solo el **cotizador READ-ONLY**
  usa FX viva (verificado por el pentester; sin superficie de escritura de dinero desde el cotizador).
- **I-D3 — N-15 `displayFinishes` NO es vector de dinero · [Verificado en código]:** `computeDisplayFinishes`
  (`common/card-order.ts:100-103`) es **display-only**, garantiza `displayFinishes ⊆ availableFinishes`,
  orden canónico y **nunca vacío** (salvaguarda → `availableFinishes`). La whitelist **SEC-A1** sigue siendo
  `Card.availableFinishes`: `buylist.service.ts:82-92` (`assertFinishAvailable`) valida el `finish` pedido
  contra `card.availableFinishes` (NO contra `displayFinishes`) → fuera de la lista `422 FINISH_NOT_AVAILABLE`;
  el mismo patrón en `inventory.service.ts:177` y money-derivación server-side. Suprimir un acabado del
  render **no** lo saca de la whitelist de cotización ni permite cotizar un acabado no priceado como si lo
  fuera. La completitud X/Y del master-set sigue contando sobre `availableFinishes` (universo intacto).
- **I-D4 — AuthZ super_admin efectiva + auditoría:** `FxController`/`PricingController` = `@Roles(super_admin)`;
  toda escritura del dial FX / spreads queda en `AuditLog` (`fx.override`, before/after en spreads). Un
  `vault_operator`/`customer` → 403. Consistente con "el dinero/config solo lo toca super_admin".

## D.4 Pendiente de DAST (heredado del pentester, no ejecutable aquí)
Sin stack levantable (Docker/Postgres/Redis ausentes). Agendar contra staging autorizado, en línea con el
gate de promoción a prod (SAST por PR + DAST staging):
1. **FX al vuelo bajo carga:** confirmar que el cotizador READ-ONLY con FX viva no expone inconsistencia de
   precio mostrado vs. cobrado (el cobro usa snapshot congelado; el cotizador es informativo).
2. **Overflow real de `price-ingest`:** con la cota 1000 ya no debería alcanzarse `2^31`; validar en un run
   real que un override en el techo (1000) no desborda ningún agregado `Int` (enlaza con la deuda S-B2/`Int`
   32-bit de agregados — **arquitecto**, `BigInt`).
3. **Carryover de deuda del proyecto (sin cambio):** `@nestjs/core` GHSA-36xv-jgw5-4q75 (SSE injection, **no
   alcanzable**, backend sin SSE) — devops, bump NestJS 11; S-B2 (`Int` 32-bit agregados) — arquitecto.

## D.5 Deuda de seguridad aceptada / banderas (sin cambio respecto a revs previas)
- **Aceptada con disparador:** S-M1 (`@nestjs/core` no alcanzable), S-B1 (linking Google a back-office),
  S-B2 (`Int` 32-bit en agregados de dinero), residuo S-B3 (`contentLength` del presign). Ver §5.
- **Banderas para el humano (§6, vigentes):** DAST/pentest de tercero + bug bounty **antes de operar con
  dinero real**; KMS/secret manager en prod; validaciones legales de custodia/PII (INE/CLABE, retención
  LFPDPPP). El fix de este stream no altera estas banderas.

## D.6 VEREDICTO — stream `pulido-precios-display`

**APROBADO** (revisión de código estático + tests).

- **0 Críticos / 0 Altos abiertos.** Los **2 Bajos** del pentester (FX-B1, FX-B2, super_admin-only) están
  **RESUELTOS en `b3270b3`** y verificados: (a) ambas puertas (`/admin/settings` y `/admin/fx`) rechazan el
  valor absurdo con el **mismo** rango `(0, 1000]` vía `validateFxManualOverrideRate`; (b) la cota 1000 cierra
  el overflow de `Int priceMxnCents`; (c) sin regresión money-safe (override `18`/`20.5` y `null`=borrar
  siguen OK, `bufferPct`-solo OK); (d) no quedan otras puertas de escritura del dial sin el helper. Tests:
  `fx-override-validation.spec.ts` **12/12 PASS**; regresión `settings.validation` + `fx.buffer` **26/26 PASS**.
- **N-15 `displayFinishes` NO introduce vector de dinero:** es supresión display-only; la whitelist SEC-A1
  sigue siendo `availableFinishes` y el monto se deriva server-side.
- **Cumple el DoD de seguridad del stream:** sin hallazgos críticos/altos abiertos; los Bajos quedan
  registrados como resueltos. **No hay bloqueadores de merge.**
- **PENDIENTE (no aprobado a ciegas), no bloqueante del stream:** la **fase dinámica (DAST contra staging)**
  sigue condicionada a que devops habilite el entorno (R2/Railway); es requisito del gate de promoción a
  **producción**, no del merge del stream. Deuda previa del proyecto sin cambio (S-M1/S-B1/S-B2).

---

## Anexo 2026-08-20 — Stream `claude/buylist-ordenes` P-4 (cierre de solicitud a `rechazada`)

> Revisión blue-team (solo lectura + tests) del entregable **P-4 (TOCA DINERO — buylist/SPEI)**.
> Cambio: auto-transición a terminal `rechazada` (`maybeAutoRejectRequest`, efecto de `itemDecision('reject')`)
> + endpoint nuevo `POST /admin/buylist/:id/reject` (`rejectRequest`). Contrato: API_CONTRACT §M5 v1.24;
> ARCHITECTURE §4.18(f)(g). Superficie evaluada: dinero/máquina de estados, autz, idempotencia/atomicidad,
> auditoría, PII. Tests `buylist.security` 6/6 PASS; `buylist.request-reject` cubre f/g (409/422/404/idempotencia).

### Resultado por eje
- **Máquina de estados / dinero — OK.** Guard «no pisar terminal» correcto en ambos caminos: `updateMany` con
  `status: { notIn: ['pagada','rechazada','abandonada'] }` (nunca reescribe una `pagada`/`abandonada` ni re-sella
  una `rechazada`) y, en `rejectRequest`, además guardas explícitas previas (`409 CONFLICT` para `pagada`/
  `abandonada`, `200` idempotente para `rechazada`). No se puede evadir control de dinero/AML: una solicitud
  `rechazada` **no** es pagable — `paySpei` exige `status ∈ {aprobada, verificacion}` + `verifiedAt` (línea 1115),
  así que el cierre no abre ruta de pago. Consistencia de dinero: el cierre solo dispara cuando **cero** ítems
  quedan no-rechazados; con todos los ítems `rechazada`, BL-1 (`recomputeApprovedTotal` excluye `rechazada`,
  línea 831-838) deja `approvedTotalCents=null/0` → coherente. Criterio 16: el cierre NO convierte a inventario
  ni vuelve vendible ninguna carta (efecto único = `status`+`closedAt`); `convertToInventory` sigue siendo acción
  manual e independiente. `convertida_inventario` correctamente tratado como ítem vivo (no auto-rechaza mixtas).
- **Autorización — OK.** El endpoint hereda `@Roles(vault_operator, super_admin)` de la clase; guards globales
  confirmados (`app.module.ts`: `JwtAuthGuard`+`RolesGuard`+`MoneyOutGuard` como `APP_GUARD`). Correcto **sin
  `@MoneyOut`**: el cierre no mueve dinero saliente. Un cliente/rol menor no alcanza la ruta. IDOR N/A: `:id` sin
  scoping de propietario es correcto para back-office (paridad con `receive`/`verify`/`paySpei`).
- **Idempotencia — OK** en el caso nominal (guardas de estado + `updateMany` count-guard heredado del patrón
  `paySpei`). Ver LOW-1 para el borde concurrente.
- **Auditoría — OK con matiz.** `action: 'buylist.reject'` registra actor/rol/entidad/`reason` en `after`. El
  path `transitioned=false` (idempotente / ya `rechazada`) NO re-audita: aceptable — no hay cambio de estado que
  trazar; no genera hueco de trazabilidad de dinero (el dinero no se movió en ninguna rama de este endpoint).
- **PII — OK.** `reason` es texto interno del operador (opcional, `@MaxLength(500)`), va solo a `AuditLog.after`,
  NO se persiste en `SellRequest`, NO se expone al cliente ni a correo (no hay correo en este flujo). La respuesta
  es `adminGet` → enmascara CLABE (`clabeMasked`), descarta `clabeSnapshotEnc` y el join `User` crudo.
  `details.nonRejectedItemStatuses` devuelve únicamente valores del enum `SellItemStatus` (sin datos sensibles).
- **Regresión reject por-ítem — sin hallazgos.** Idempotencia del reject por-ítem intacta; BL-1 preservado.

### Hallazgos (todos Bajos — no bloqueantes)
- **LOW-1 (Media-baja) — Precondición no atómica con la transición (TOCTOU) · dueño: BACKEND.**
  En `rejectRequest` y en `maybeAutoRejectRequest` el chequeo «¿quedan ítems vivos?» (`count`/`findMany`) y el
  `updateMany` son round-trips separados; el count-guard del `updateMany` solo protege la **terminalidad del
  status**, NO el invariante «todos los ítems rechazados». Un `itemDecision('approve')` concurrente sobre el
  último ítem (que no cambia el `status` de la solicitud) puede intercalarse y dejar la solicitud en `rechazada`
  con un ítem `aprobada` vivo y `approvedTotalCents > 0` — estado inconsistente `approvedTotalCents` vs `status`.
  **Impacto acotado:** NO fuga dinero (una `rechazada` no es pagable por el guard de `paySpei`), NO evade AML, NO
  vuelve vendible la carta. Es inconsistencia de datos / ruido de auditoría, recuperable. **Mitigación sugerida
  (backend):** envolver `itemDecision(reject)`+recompute+auto-reject y el `rejectRequest` en `$transaction`
  (aislamiento serializable, como ya hace `createRequest` SEC-A2), o re-verificar dentro del `where` del
  `updateMany`. **Deuda aceptada con disparador:** abordar antes de habilitar operación concurrente multi-operador
  sobre la misma solicitud.
- **LOW-2 (Baja) — Desalineación doc↔código: «mismo transaction boundary» no implementado · dueño: BACKEND.**
  ARCHITECTURE §4.18(f) afirma que la re-evaluación corre «en el mismo transaction boundary que el cambio de
  ítem» para que «un ítem rechazado y una solicitud atorada no puedan coexistir tras un commit exitoso». El código
  ejecuta `update(item)` → `recomputeApprovedTotal` → `sendItemRejectedMail` → `maybeAutoRejectRequest` como
  awaits secuenciales SIN `$transaction`. Un fallo/caída entre el update del ítem y `maybeAutoRejectRequest`
  reproduce exactamente el estado atorado del bug P-4. No es explotable (no hay atacante), pero rompe el
  invariante documentado. **Acción:** implementar la transacción (converge con LOW-1) o corregir el doc.
- **LOW-3 / INFO (pre-existente, NO introducido por P-4) — `closedAt` en DTO de cliente · dueño: BACKEND.**
  `getMine` (buylist.service.ts:525) hace spread `...rest` y expone `closedAt` al cliente dueño de la solicitud.
  Es un timestamp interno (no PII, no CLABE). Ya se filtraba antes de este diff (`respond('decline')` y `paySpei`
  ya sellaban `closedAt`); P-4 solo aumenta cuántas solicitudes lo tienen poblado. `listMine` sí proyecta campos
  explícitos y NO lo incluye. Se registra por completitud; **no es regresión del stream**. Sugerencia: proyectar
  campos explícitos en `getMine` (paridad con `listMine`) si se quiere ocultar el timestamp.

### Banderas para el humano
- Requisito de gate money-real ya vigente en este documento (pentest de tercero + DAST/staging antes de operar
  con dinero real) **sigue aplicando**; P-4 no lo altera.

### VEREDICTO — **APROBADO**
0 Críticos / 0 Altos abiertos. Los guards de terminalidad, la separación de `@MoneyOut`, la derivación server-side
de montos (BL-1) y la no-exposición de CLABE/PII están correctos y con tests verdes (`buylist.security` 6/6,
`buylist.request-reject` cubre f/g). Los **3 Bajos** (LOW-1 TOCTOU, LOW-2 doc↔código, LOW-3 `closedAt` pre-existente)
se **aceptan como deuda con disparador** y se enrutan a **backend**; ninguno bloquea el merge del stream. Mínimo para
mantener el APROBADO: no habilitar operación concurrente multi-operador sobre la misma solicitud sin cerrar LOW-1.

---

## Anexo 2026-08-20 — stream `claude/buylist-ordenes` P-5 (superficie de filtros de lista admin, v1.25)

**Rol:** seguridad (blue team). **Alcance FOCALIZADO:** SÓLO los filtros NUEVOS de v1.25 (`q`, `from`, `to`,
`minCents`, `maxCents`, CSV de `status`, paginación) sobre `GET /admin/buylist` (§M5) y `GET /admin/orders` (§M3).
P-5 es paginación + filtros de **LECTURA** — NO mueve dinero. **No re-audité P-4** (ya aprobado).
**Archivos revisados:** `backend/src/common/admin-list-filters.ts`;
`backend/src/modules/buylist/{admin-buylist.controller.ts, buylist.service.ts (adminList)}`;
`backend/src/modules/orders/admin-orders.controller.ts (list)`;
`frontend/src/lib/{api.ts, api-client.ts}`; `frontend/.../admin/m5/M5View.tsx`, `.../m3/M3View.tsx`.
**Tests:** `npx jest buylist.security` → **6/6 verdes**.

### Ejes evaluados

1. **Inyección — OK.** Todos los filtros producen fragmentos `where` de Prisma **parametrizados**
   (`contains`/`in`/`gte`/`lte`); no hay `$queryRaw` ni interpolación de SQL crudo en toda la superficie.
   `status` valida cada token del CSV contra `SellRequestStatus` (buylist) → 400 `VALIDATION_ERROR`
   (`details.invalidStatus`) antes de tocar Prisma. `q` va como parámetro de `LIKE`, no como regex, por lo que
   **no hay ReDoS**. Límite de longitud de `q` = 200 chars (`ADMIN_LIST_MAX_Q_LENGTH`) → 400 si excede.
   Frontend serializa vía `URL.searchParams.set` (encoding correcto), sin construcción manual de query string.

2. **Fuga de PII / alcance de `q` — OK.** El OR de `q` busca SÓLO sobre campos NO sensibles:
   buylist = `SellRequest.id` + `user.name` + `user.email`; orders = `orderNumber` + `guestEmail` + `userId`
   (exacto) + `user.name` + `user.email`. **NUNCA** sobre CLABE / RFC / INE / snapshot cifrado / `paymentMethodLast4`.
   La CLABE cifrada no participa en ningún `where` de estos listados y sigue exclusiva del reveal auditado
   (`@MoneyOut`, super_admin). v1.25 **no añade campos nuevos** a la respuesta de ninguno de los dos listados
   (el shape es idéntico al de P-4): buylist `adminList` mantiene **proyección explícita** (`id, userId, seller{id,
   name,email}, status, quotedTotalCents, approvedTotalCents, createdAt, items`) — limpia; orders conserva su
   spread previo `...o` (ver INFO-1, pre-existente).

3. **IDOR / enumeración — OK.** Ambos endpoints están bajo `@Roles(vault_operator, super_admin)` a nivel de clase.
   Los filtros (`userId`, `q`, montos, fechas, `status`) **sólo REDUCEN** el conjunto que el rol ya puede listar;
   ninguno amplía el alcance ni permite alcanzar objetos fuera de la autorización de rol. No hay proyección
   reducida por rol en estos listados (vault_operator y super_admin ven el mismo shape, por diseño §M3/§M5), así
   que no existe fuga por diferencial de rol dentro de la superficie de filtros. El filtro por monto/fecha/`q` no
   habilita ninguna enumeración nueva más allá de lo que el rol ya puede listar sin filtros.

4. **DoS / validación — OK con deuda aceptada.** `parseAdminListFilters` acota `pageSize ≤ 100`
   (`ADMIN_LIST_MAX_PAGE_SIZE`), exige `page`/`minCents`/`maxCents` enteros (`page ≥ 1`, cents `≥ 0`), fechas
   ISO-8601 parseables, y `maxCents ≥ minCents` — todo inválido → 400, nunca clamp silencioso. No hay
   amplificación patológica: el peor caso es un table-scan acotado por `take ≤ 100`. Ver LOW-A2 (índice diferido).

### Hallazgos

- **INFO-1 (Informativo · pre-existente, NO introducido por P-5) — `GET /admin/orders` list hace spread `...o`
  de la fila completa · dueño: BACKEND.** `admin-orders.controller.ts:97` retorna `data.map((o) => ({ ...o, ... }))`,
  lo que incluye columnas sensibles de `Order` (`paymentMethodLast4`, `paymentMethodBrand`, `stripePaymentIntentId`,
  `stripeChargeId`, `billingSnapshot`, `shippingAddressSnapshot`) en cada fila del listado. **Origen: commit `e94a077`
  (guest checkout, v1.21 / P-4), NO v1.25** — `git log -S` confirma que el spread precede al stream P-5, que sólo
  añadió filtros y no tocó el shape. Fuera del alcance focalizado y ya cubierto por la aprobación de P-4; se registra
  por completitud (paralelo a LOW-3 del anexo P-4). **Sugerencia de hardening (no bloqueante):** migrar la list a
  proyección explícita con `select` (como sí hace `buylist.adminList`) para no exponer snapshots/last4/IDs de Stripe
  en la cola. **No es regresión de P-5.**

- **LOW-A1 (Baja) — `contains` de Prisma no escapa metacaracteres de `LIKE` (`%`, `_`) · dueño: BACKEND.**
  Prisma 5.20 no escapa `%`/`_` en `contains`; un `q` con esos caracteres actúa como comodín de `LIKE`
  (ensancha el match). **Impacto acotado:** sólo altera la semántica de coincidencia DENTRO del conjunto que el
  rol admin ya puede listar sin filtro — **no evade la autorización de rol ni exfiltra datos fuera de alcance**, y
  no hay SQLi ni ReDoS. Efecto real: búsqueda más amplia de lo previsto y un scan algo mayor. **Sugerencia:**
  escapar `%`/`_`/`\` en `q` antes del `contains` si se quiere match literal. **Deuda aceptable para MVP**
  (superficie admin-only, sin escalamiento de privilegios).

- **LOW-A2 (Baja) — Índice `@@index([status, createdAt])` diferido → riesgo de disponibilidad · dueño: BACKEND/DEVOPS.**
  Con `orderBy: createdAt desc` + filtros por `status`/rango y sin ese índice, los listados hacen sort/scan
  secuencial que crece con el volumen. **Aceptable para MVP** (tráfico admin bajo, `take ≤ 100`). **Disparador:**
  crear el índice (y evaluar índice trigram/`pg_trgm` para las columnas de `contains`) antes de que las colas
  `SellRequest`/`Order` superen decenas de miles de filas o antes de exponer estos listados a carga sostenida.

- **INFO-2 (Informativo) — Sin validación `from ≤ to` en el rango de fechas.** `admin-list-filters.ts` valida
  `maxCents ≥ minCents` pero NO exige `to ≥ from`; un rango invertido devuelve conjunto vacío. **No es vuln**
  (no fuga ni DoS); simple inconsistencia de UX/validación. Opcional alinear con la regla de cents.

### VEREDICTO P-5 — **APROBADO**

0 Críticos / 0 Altos abiertos en la superficie de filtros v1.25. Los cuatro ejes (inyección, PII/alcance de `q`,
IDOR/enumeración, DoS/validación) están correctos: Prisma parametrizado, `q` sobre campos no sensibles con tope de
200 chars, filtros que sólo reducen el conjunto autorizado por rol, y validación estricta → 400 con `pageSize ≤ 100`.
Tests `buylist.security` 6/6 verdes. Los hallazgos abiertos son **2 Bajos** (LOW-A1 comodines de `LIKE`, LOW-A2
índice diferido) + **2 Informativos** (INFO-1 spread `...o` pre-P-4, INFO-2 `from≤to`), **todos deuda aceptable con
disparador** y enrutados a **backend/devops**; ninguno bloquea el merge de P-5. **Mínimo para mantener el APROBADO:**
no ampliar el OR de `q` a columnas sensibles (CLABE/RFC/INE/last4/snapshots) y crear el índice de LOW-A2 antes de
escalar el volumen de las colas.
## P-1 · Gate SEGURIDAD (blue-team) — Reglas de precio de VENTA por rareza (M2) — 2026-08-20

**Alcance revisado:** `frontend/.../admin/m2/M2View.tsx` + `M2View.test.tsx` (working tree, rama
`claude/precios-variantes-masterset`). Ruta backend de guardado/validación: `pricing.controller.ts`
`putSalesRules` (264–305), `settings.constants.ts` `validateSalesRules`/`isValidSalesRule` (211–230),
aplicación en `money.ts` `computeSalePriceForRarity` (279–305).

### VEREDICTO: **RECHAZAR** — hay 1 hazard de dinero residual (rutable a frontend).

**Los DOS hazards originales SÍ quedan cerrados (confirmado):**
- **100× sobreprecio:** el `value` del borrador ahora es TEXTO CRUDO; el cast ocurre solo al guardar.
  "12.50" → `pesosToCents("12.50")` = `Math.round(12.5*100)` = **1250 centavos exactos** (M2View.tsx:65–68,
  379). Sin 100×. El decimal sobrevive tecla-a-tecla (value literal, M2View.tsx:957). Test lo cubre.
- **Corrupción por flip de modo:** al cambiar fixed↔pct el value se resetea a `''` (M2View.tsx:958–962,
  el `onChange` del `<select>` de modo pone `value: ''`). 500¢ ya no se vuelve 500% ni 15% → $0.15. Test lo cubre.

**Clamps cliente vs servidor:** fixed → `Math.max(0, pesosToCents())` (entero ≥ 0; `pesosToCents` usa
`Math.round` → siempre entero) ≡ servidor `isInt && >=0` (settings.constants.ts:214). pct →
`Math.min(1000, Math.max(0, Number()||0))` ≡ `SALES_PCT_MAX=1000` (215). Servidor SIGUE siendo la autoridad
(`validateSalesRules` en el PUT → 422, controller 275–276). Ni NaN ni fuera-de-rango llegan a persistir.

**Merge money-safe INV-1:** intacto — `rules: { ...salesRules.data.rules, ...draftRules }` (M2View.tsx:383)
preserva claves no tocadas; solo las rarezas editadas se sobreescriben. Sin secretos/keys en el diff. Sección
buylist (`ruleDraft`/`setRuleDraft`, líneas 809–827) NO tocada — usa estado separado.

### HALLAZGO (bloqueante) — S-P1-1 · Cero silencioso persiste como precio de VENTA MX$0 (regalo)

Entradas multi-punto ("1.2.3", "12..5") y campo VACÍO se coercionan a **0** al guardar y persisten como
regla válida-pero-errónea:
- Sanitizador `replace(/[^0-9.]/g,'')` (M2View.tsx:961) **permite múltiples puntos** → el crudo llega como "1.2.3".
- En guardado: fixed → `pesosToCents("1.2.3")` → `Number("1.2.3")`=NaN → devuelve **0** (M2View.tsx:67, 379);
  pct → `Number("1.2.3")||0` → **0** (381). Vacío "" → mismo camino → 0.
- Servidor NO lo atrapa: `isValidSalesRule` acepta fixed value 0 (entero ≥ 0, settings.constants.ts:214);
  no hay 422.
- Impacto: `computeSalePriceForRarity` con fixed value 0 → `{ salePriceCents: 0, status: 'priced' }`
  (money.ts:291–293) → cartas listadas a **MX$0.00 (regalo)**. Alcanzable por typo ordinario (borrar campo +
  Guardar, o doble punto). El fix, al dejar el campo vacío en vez de re-normalizar a "0", hace esta ruta MÁS
  fácil de disparar que el código previo.

**Fix exacto (frontend):** (a) sanitizar el crudo a UN solo punto decimal en el `onChange` (M2View.tsx:961),
descartando el 2º punto en adelante; y (b) NO coercionar vacío/NaN a 0 en el guardado — omitir el borrador
vacío o bloquear Guardar con validación cuando una regla tocada quede vacía/NaN, en vez de persistir 0.
Apoyarse en el 422 del servidor NO basta: 0 es un `fixed` legal, el servidor no puede distinguir el regalo.

---

### RE-GATE (blue-team) — 2026-08-20 — S-P1-1 **RESUELTO** · VEREDICTO: **APROBAR**

El rol frontend aplicó el fix. Re-revisión del working tree (`M2View.tsx`, `M2View.test.tsx`,
`messages/en.json`, `messages/es.json`). Las tres capas exigidas están presentes y correctas:

1. **Saneo a un solo punto (fuente):** nuevo `sanitizeDecimalInput` (M2View.tsx:75–80) corre en CADA
   `onChange` del input de valor (M2View.tsx:991). Conserva solo el 1er punto y descarta los siguientes.
   Traza: `"1.2.3"`→`"1.23"`, `"12..5"`→`"12.5"` (también en pegado). Ningún crudo multi-punto llega al
   borrador. El sanitizador viejo `replace(/[^0-9.]/g,'')` fue eliminado del onChange.
2. **Sin cero silencioso al guardar (defensa en profundidad):** `isSaveableRuleValue` (M2View.tsx:86–90)
   rechaza `""`/`"."`/`"1.2.3"` (NaN) y acepta `"12.50"`/`"0.5"/"5"`. `salesDraftInvalid` (M2View.tsx:391)
   DESHABILITA Guardar (M2View.tsx:1019) y muestra Banner de advertencia (M2View.tsx:1008–1010). Además el
   bucle de guardado OMITE (`continue`) toda regla no guardable (M2View.tsx:406) — una regla omitida conserva
   el valor del servidor en el merge, NUNCA persiste `{fixed,0}`. No existe ruta que persista un 0 silencioso
   desde vacío/mal formado.
3. **Hazards originales siguen cerrados:** 100× — el `value` es texto crudo, casteo solo al guardar
   (`pesosToCents("12.50")`=1250¢); flip de modo resetea `value:''` (M2View.tsx:976). Servidor sigue siendo
   la autoridad (`validateSalesRules`→422, controller 275). Clamps cliente ≡ servidor (fixed entero ≥0 vía
   `Math.round`; pct `Math.min(1000,Math.max(0,·))` ≡ `SALES_PCT_MAX=1000`).
4. **Sin nuevo hazard:** el helper no introduce bypass; valores legítimos siguen guardables. Las claves i18n
   añadidas (`salesRules.invalidValue` en en/es) son cadenas estáticas sin interpolación — sin inyección i18n.
   Nota (no bloqueante, fuera de alcance de S-P1-1): un `"0"` tecleado explícitamente sí es guardable como
   `fixed 0`; es una acción deliberada del admin (no coerción silenciosa), ya era posible y el servidor lo
   acepta como legal.
5. **Alcance:** solo archivos frontend; Sección 4 buylist (`ruleDraft`/`setRuleDraft`, estado separado) NO
   tocada; sin cambios en backend ni secretos. Tests añadidos cubren decimal/vaciado/multi-punto/`.`/Guardar
   deshabilitado.

**Resolución:** S-P1-1 cerrado. Fix ref: `sanitizeDecimalInput` (M2View.tsx:75–80), `isSaveableRuleValue`
(86–90), `salesDraftInvalid` (391) + Guardar deshabilitado (1019) + Banner (1008–1010), guarda del bucle
(406). Gate P-1 (money-touch) **APROBADO** por SEGURIDAD.


---

## 2026-08-20 — Gate SEGURIDAD (blue-team): bundle precios-variantes-masterset `4c9219f..HEAD` (v1.26)

Alcance: 4 commits tras el P-1 ya aprobado — TCGCSV variant detection (§4.24a), ④ publish-gated-on-price,
P-6 cola en 2 buckets, P-2 market-ref en tile M1, P-7 reprice+publish. Diff + servicios backend + contrato
v1.26 revisados. **VEREDICTO: APPROVE-WITH-CONDITIONS** (2 items low-sev a registrar; ningún money-hazard
introducido por este bundle).

### Money-safety (los 7 puntos) — verificados

1. **Publish nunca lista a 0/sin precio — CONFIRMADO.** `inventory.service.ts` bulkPublish, ambas ramas
   (raw ~L554 / sealed ~L520): `sale.salePriceCents == null` → `pricing.escalatePending(...,'inventory',...)`
   + `throw PRICE_PENDING` (línea `ok:false`, la pieza NO se publica, conserva su status). Idempotente por
   `(cardId,productType,gradeKey,finish,status='open')`. No hay ruta que publique con precio 0/ausente.
2. **P-7 `refreshCardPrices` FAIL-CLOSED — CONFIRMADO** (`pricing.service.ts` ~L515). `if (!(row.marketCents
   > 0)) continue` (nunca 0/negativo); `row.currency==='USD' && fx==null → continue` (sin FX no se inventa
   MXN); proveedor que revienta → `catch`→`continue` (money-safe, intenta el siguiente); `dailyLimited` del
   PPT corta el barrido. Cotas: `MAX_FRESH_REPRICE_CARDS=50` (caller) + `maxFreshCards=100` (PPT, defensa en
   profundidad). Un fallo total deja la carta `pending` → el caller cae a la ref ALMACENADA o al gate ④. El
   wrapper en bulkPublish (`try/catch`, warn) garantiza que el reprecio NUNCA tumba la publicación.
3. **P-2 expone la REFERENCIA de mercado cruda, null→"—" no $0 — CONFIRMADO.** `master-set.service.ts`
   ~L440 usa `getReferencesBatch` (gradeKey `raw:NM`, acabado base) → `liveMxnCents` (recompute FX vigente,
   la MISMA ruta que valúa la bóveda). Solo `status==='priced'` produce centavos; `pending`/ausente →
   `marketReferenceMxnCents=null`. La clave de lookup `…|raw:NM|${universe[0]}` coincide con el `finish`
   consultado (`baseFinishOf = expectedFinishes(...)[0] === universe[0]`), así que un desajuste solo caería
   a "—" (dirección segura). Front (`MasterSetBinder.tsx`): `null` → `marketPendingShort` ("—"), nunca $0.
4. **Estructura ≠ precio — CONFIRMADO.** `structural-finish-resolver.service.ts` escribe SOLO
   `Card.structuralFinishes` (whitelist de qué variantes EXISTEN) y llama `FinishReconciler.reconcile`;
   grep confirma CERO escrituras a `PriceReference`/`priceMxnCents` en el resolver y en el reconciler. Una
   fila TCGCSV con `marketPrice:null` sigue aportando estructura; `subTypeName` desconocido se OMITE
   (`deriveStructuralFinishes`, anti-invención, nunca se atribuye a `normal`). Una carta no joineada conserva
   su valor previo. Sin `PriceReference`, la variante sigue `pending` (no se fabrica precio).
5. **`manualOverride` context-agnóstico — evaluado, aceptable.** Comparte `PriceReference` por
   `(cardId,productType,gradeKey,finish)` entre contextos: un override desde el bucket VENTA escribe la ref
   `raw:NM` que la valuación de COMPRA/buylist también lee. Es by-design/documentado (una mejor ref de
   mercado beneficia ambos flujos; no es corrupción). COMPRA es READ-ONLY en nuestro código: el endpoint
   `pending?context=buylist` solo lee, y no hay NINGUNA escritura nueva a buylist/orders en el diff.
6. **SSRF/egress y secretos — CONFIRMADO.** `TcgcsvHttpClient` mantiene el patrón anti-SSRF: host FIJO
   `https://tcgcsv.com/tcgplayer`, `pokemonCategoryId=3` constante, `assertValidGroupId` (entero positivo)
   antes de interpolar, `redirect:'error'`, timeout 15s, `Accept: application/json`, sin API key.
   `TcgcsvCatalogClient` hereda todo sin duplicar. P-7: PPT usa API key de env (`client.apiKey()`, NUNCA
   logueada) + `tcgplayerId` de BD; pokemontcg.io fresh usa host hardcodeado + `externalId` de BD. Ningún
   host/URL controlado por el usuario; ningún secreto logueado ni hardcodeado (los `logger.warn` emiten
   status/ids, no claves).
7. **Authz/audit — CONFIRMADO, sin regresión.** `PricingController` `@Roles(super_admin)` a nivel clase
   cubre `pending?context=` y `override`. `InventoryController` `@Roles(vault_operator, super_admin)` cubre
   `bulk-publish` (repriceFresh). El query `?context=` se valida ESTRICTO contra el enum `PendingPriceContext`
   → 422 si es inválido (sin enumeración/leak). Sin nuevos endpoints sin guard.

**P-1 (S-P1-1) intacto:** `sanitizeDecimalInput` (M2View.tsx) presente y aplicado al input de reglas de
venta. NINGÚN input de precio TOCADO por este bundle reintroduce el multi-punto/cero-silencioso.

### Condiciones a registrar (low-sev — NO bloquean; ningún money-hazard nuevo de este bundle)

- **L1 (frontend + backend, pre-existente, ELEVADO por P-6) — input de override de la cola VENTA sin
  saneo decimal.** El input de precio del override de pendientes (`M2View.tsx` ~L1427) usa
  `onChange={e=>setOverridePriceValue(e.target.value)}` SIN `sanitizeDecimalInput`, y `pesosToCents`
  (M2View.tsx:67) castea NaN→**0** (`Number("1.2.3")`=NaN). El `OverrideDto` backend acepta
  `@IsInt() @Min(0)` → **admite 0**. El submit solo bloquea `overridePriceValue===''`. P-6 dirige ahora al
  operador a ESTE input como la ruta de resolución-y-publicación de los pendientes `context=inventory`, así
  que un multi-punto por dedo gordo podría fijar una referencia manual de $0 y publicar a $0. No lo introduce
  textualmente este diff (fuera del alcance estricto `4c9219f..HEAD`), por eso se registra en vez de
  rechazar. **Fix rutado:** frontend → aplicar `sanitizeDecimalInput` al `onChange` del override (paridad con
  el input de reglas de venta); backend → endurecer `OverrideDto.priceMxnCents` a `@Min(1)`.
- **L2 (backend, low) — `PokemonTcgIoProvider.fetchFreshForCards` sin timeout ni `redirect:'error'`.** El
  `fetch` a `https://api.pokemontcg.io/v2/cards/${externalId}` (host hardcodeado, `externalId` de BD → sin
  SSRF) carece del `AbortController`/timeout y `redirect:'error'` que sí tiene `TcgcsvHttpClient`; un upstream
  colgado podría estancar una request de publicación con `repriceFresh`. **Fix rutado:** backend → añadir
  timeout + `redirect:'error'` (paridad con el cliente TCGCSV).

**Gate SEGURIDAD (money-touch): APPROVE-WITH-CONDITIONS.** Registrar L1/L2; ninguna es hazard de dinero
introducida por este bundle. — SEGURIDAD (blue-team)

---

# PASE Stream C (cotizador v2, P-14+P-16) + buzones i18n — VEREDICTO BLUE TEAM · 2026-08-21

> **Rol:** seguridad (blue team / AppSec). **Alcance:** DELTA `git diff origin/production..HEAD`
> (rama `release/stream-c-mailboxes`). **Modo:** revisión estática de código (sin stack vivo:
> Docker/Postgres ausentes). **Insumo primario:** pase «PASE Stream C» del pentester en
> `docs/PENTEST_NOTES.md` (0C/0A/0M/0B, 3 Info). Este pase consolida solo el DELTA nuevo; el
> release v1.28 (Streams A+B+rebrand P-21) ya tiene veredicto APROBADO más arriba en este mismo
> archivo y SEC-A1 se apoya en esa revisión previa.

## 0. Confirmación del alcance (verificado por mí, no asumido)

`git diff --name-only origin/production..HEAD` → **21 archivos, 100% frontend + docs**. Cero
cambios en `backend/`, `backend/prisma/` (schema) y `docs/API_CONTRACT.md`
(`git diff --name-only … | grep -E '^(backend/|docs/API_CONTRACT|docs/ARCHITECTURE)'` → **NONE**).
Corolario de seguridad: **ningún guard, DTO, ruta, migración ni contrato de dinero cambió en este
delta**. La superficie server-side (autenticación, autorización, MoneyOutGuard, firma Stripe,
idempotencia, cifrado PII, re-cotización de buylist) es **byte-idéntica** a la ya aprobada en
v1.28. Toda la revisión de este delta es, por tanto, de **frontend**: integridad del payload,
XSS y gating de cliente.

## 1. Integridad del dinero — CONFIRMADO limpio (coincido con el pentester)

- **El carrito no manda precios.** Verifiqué `useSellCart.ts:123-135`: `requestItems` se construye
  con **exactamente** `{ cardId, productType, rawCondition, finish }` por ítem — no hay campo de
  monto/categoría/precio. El tipo destino `BuylistRequestItem` (`BuylistKycForm.tsx:26-31`, archivo
  **NO tocado** por el delta) tampoco tiene campo de dinero. El comentario del propio código lo
  documenta: *"NO se envían precios ni categorías (SEC-A1: el backend re-deriva el monto)"*.
- **El estimado es solo display.** `totalEstimatedCents` (`useSellCart.ts:109-112`) suma
  `quote.quote.quotedPriceCents ?? 0` únicamente para mostrarlo; nunca se serializa al submit.
  Las líneas `precio_pendiente` NO aportan al total y se explican aparte (`:113-119`), sin
  MX$0.00 silencioso. `SellCartContents.tsx:225` marca el total como ESTIMADO en la UI.
- **Cantidad saneada en el borde.** `setQuantity` (`useSellCart.ts:80-83`):
  `Number.isFinite(q) ? Math.max(1, Math.floor(q)) : 1` → sin cantidades negativas/fraccionarias/NaN.
- **Sin estado persistido manipulable.** El carrito vive en `useState` (`:68`); la única aparición
  de `localStorage` en el módulo es `window.localStorage.clear()` en un archivo **de test**
  (`BuylistView.test.tsx:48`), no en runtime. No hay superficie de tampering por storage.

**Veredicto integridad de dinero:** el delta **no crea** ninguna frontera de confianza nueva ni
debilita la existente. Inyectar `cardId`/`finish`/`quantity` arbitrarios en el carrito es inocuo:
la elegibilidad y el monto se resuelven server-side (batchQuote → `NOT_FOUND` /
`FINISH_NOT_AVAILABLE`; `POST /buylist/requests` re-cotiza). **Coincido con Info-1 del pentester.**

## 2. SEC-A1 sigue vigente — CONFIRMADO

SEC-A1 (el backend re-cotiza y decide INE/tope server-side) es la garantía sobre la que descansa
la limpieza de este delta. La verifiqué por **ausencia de cambio**: el diff no toca
`backend/src/modules/buylist/` (confirmado: `git diff --stat … -- backend/src/modules/buylist/`
→ vacío), ni `orders`/`payments`, ni el schema, ni el contrato. Los endpoints consumidos
(`POST /buylist/quote/batch`, `POST /buylist/requests`, `GET /buylist/requests`, `.../respond`)
ya existían y pasaron el gate de seguridad en v1.28 (ver secciones previas: I-3 SEC-A1, tope
mensual en `$transaction` Serializable, `quoteAcquisition` derivando de la rareza real). **SEC-A1
no fue modificado y permanece en vigor.**

## 3. XSS en los componentes nuevos — CONFIRMADO sin hallazgo

- Grep `dangerouslySetInnerHTML|innerHTML|eval\(|new Function|document.write` sobre todo el módulo
  buylist y los componentes nuevos (`SellCartDrawer`, `SellCartFab`, `SellCartContents`,
  `MyRequestsSection`, `StorefrontHeader`) → **0 coincidencias en runtime**.
- `StorefrontHeader.tsx:65`: `--app-header-h` se escribe con `${el.offsetHeight}px` — un **número**
  del layout, no dato de usuario. Los `href` de navegación (`:79-87`) vienen de un **arreglo
  estático** de literales, no de input. **Coincido con Info-2.**
- Todo dato de catálogo (nombre, número, rareza, folio) se renderiza como **children JSX**
  (auto-escapado por React). Sin sink de HTML crudo.

## 4. Autorización en cliente (gating P-11) — CONFIRMADO sin regresión

- `SellCartContents.tsx:228-244`: sin sesión (`sellReq.ready && !sellReq.isAuthenticated`) el botón
  de envío se **sustituye** por CTAs de login/registro; no hay `onSubmit` disponible.
- `SellCartContents.tsx:247-255`: con sesión, el botón está `disabled` si
  `cart.length === 0 || !sellReq.canSubmit`; correo no verificado → `sellReq.emailBlocked` deshabilita
  y explica el motivo (`:256-264`).
- `MyRequestsSection.tsx:37,41`: la query `GET /buylist/requests` corre con
  `enabled: ready && isAuthenticated` — no se consulta sin sesión.
- Insisto en el matiz correcto: este gating es **UX**; el bloqueo real es server-side
  (`EmailVerifiedGuard` + `JwtAuthGuard` desde BD, I-2 de v1.5). El delta **no altera** ese guard.
  **Coincido: sin regresión.**

## 5. Buzones i18n @tcghunt.mx — CONFIRMADO sin superficie

`messages/{es,en}.json` (18 líneas cada uno): solo literales `@tcgvaultmx.com → @tcghunt.mx` +
renombrado de claves de carrito. Strings estáticos; ninguno interpola dato de usuario → sin
inyección. El cambio de dominio de correo **no toca** el envío server-side (Resend por API JSON,
sin SMTP header injection — R-9/v1.28). **Info-3 (higiene):** la existencia y monitoreo de los
buzones @tcghunt.mx (Email Routing + prueba real) fue **confirmada por el humano el 2026-08-21**.

## 6. Consolidación de hallazgos del pentester (Stream C)

| ID | Severidad | Descripción | Ubicación | Estado / Dueño |
|---|---|---|---|---|
| Info-1 | Info | cardId/finish/quantity arbitrarios en carrito son inocuos: elegibilidad y monto server-side (batchQuote / requests re-cotiza) | `useSellCart.ts:123-135` | Frontera correcta (SEC-A1). **Sin acción.** Aceptado. |
| Info-2 | Info | `--app-header-h` desde `offsetHeight` (número); nav `href` de arreglo estático | `StorefrontHeader.tsx:65,79-87` | Sin superficie. **Sin acción.** Aceptado. |
| Info-3 | Info | Higiene: confirmar buzones @tcghunt.mx existen y monitoreados | `messages/{es,en}.json` | **HECHO por el humano** (2026-08-21). Cerrado. |

Ningún hallazgo del delta requiere ruteo a un rol dueño para corrección: los 3 Info son
frontera-correcta o higiene ya resuelta. **No hay falsos positivos que refutar ni severidades que
corregir al alza** — mi revisión independiente confirma el conteo del pentester (0/0/0/0, 3 Info).

## 7. Deuda de seguridad heredada (NO introducida por este delta — solo recordatorio de estado)

Las Medias/Bajas de releases previos siguen abiertas y **fuera del alcance de este delta**
(no las toca ni las agrava), ya registradas y aceptadas arriba: **R-1** (2 moderate `@nestjs/core`
GHSA-36xv-jgw5-4q75 → devops, bump a NestJS 11), **B-2** (linking Google a cuentas privilegiadas),
**B-3** (columnas de dinero en `Int32`), **MS-1/MS-2** (idempotency-key en shipments/refund;
agregados sin `clampCents`), **R-2/R-3** (cotas de `acquisitionPct`; lectura de estrategia por
`vault_operator`). Ninguna es Crítica/Alta → ninguna bloquea. Disparador de re-priorización:
cuando se agende la ventana de DAST en staging autorizado y el bump mayor de NestJS.

## 8. Banderas para el humano

- **Pre-dinero-real (recordatorio, no bloqueante de este delta):** antes de operar con dinero real
  a escala, ejecutar la batería **DAST en staging autorizado** que el pentester dejó pendiente
  (concurrencia de reserva atómica, firma Stripe con eventos reales, rate-limit efectivo
  multi-instancia con Redis) y considerar **pentest de tercero + bug bounty**. No es del alcance
  del cotizador v2, pero es la condición de madurez para el flujo de dinero completo.
- **PII/custodia (recordatorio):** validaciones legales de custodia de bienes y manejo de INE/CLABE
  (retención, AML SPEI) siguen siendo bandera legal del humano; este delta no las toca.

## 9. VEREDICTO DE SEGURIDAD del delta Stream C — **APROBADO**

**0 Críticos · 0 Altos · 0 Medios · 0 Bajos · 3 Info** (frontera-correcta / higiene resuelta).
Umbral DoD (sin Críticos/Altos abiertos) **CUMPLIDO**. Confirmo, por revisión estática independiente,
las cuatro garantías del delta: (1) el carrito de venta envía solo
`{cardId, productType, rawCondition, finish}` sin precios; (2) **SEC-A1 intacto** (backend re-cotiza
y decide INE/tope — no está en el diff); (3) **cero XSS** en los componentes nuevos; (4) gating P-11
sin regresión (bloqueo real server-side). El diff es 100% frontend/docs y **no debilita ningún guard
de dinero**.

**Mínimo para mantener el APROBADO:** no introducir en el frontend ninguna vía que envíe montos al
backend por las rutas de buylist (mantener el payload sin precios); cualquier cambio futuro a
`backend/src/modules/buylist/`, `orders`, `payments` o al contrato re-abre el gate server-side.

— SEGURIDAD (blue team / AppSec), 2026-08-21

---

# VEREDICTO DE SEGURIDAD — RELEASE lote inventario/sellado (`920260e..29a5e97`) · 2026-08-23
> Autor: seguridad (blue team / AppSec). Insumo: `PENTEST_NOTES.md` › «PASE RELEASE — lote inventario/sellado … 2026-08-23» (0 críticos, 0 altos).
> Modo: revisión estática del diff + verificación por lectura de código (sin stack vivo; los ítems de runtime quedan para DAST en staging). Gate de deploy: regla 10 (tercer veredicto).

## 1. Consolidación de hallazgos (pentester + revisión AppSec)

| ID | Sev | Área | Ubicación | Estado verificación | Rol dueño | Clasificación |
|---|---|---|---|---|---|---|
| N-0 | Media | deps (carryover) | `@nestjs/core ^10.4.4` (GHSA-36xv-jgw5-4q75) | **Confirmado**: `npm audit --omit=dev` = 2 moderate, 0 high/critical | devops | no-bloqueante-aceptado |
| N-1 | Baja | money ($0 latente) | `inventory.dto.ts:90,157`; gate `pricing.service.ts:663` | **Confirmado**: sin `@Min`; gate compara `== null`, no `<=0`. **Inalcanzable hoy** (guard servicio `:580` `>0` + endpoint `OverrideDto @Min(1)` `:52`) | backend | a-corregir-antes-de-prod (recomendado) |
| N-2 | Baja | money (overflow P&L) | `inventory.dto.ts:70,146` | **Confirmado**: `acquisitionCostCents` sin `@Max`; insider `vault_operator`, sin cash-out | backend / arquitecto (BigInt agregados) | a-corregir-antes-de-prod (recomendado) |
| N-3 | Baja | resolución pendientes | `pricing.service.ts:1099-1102` | **Confirmado**: `updateMany` sin `sealedProductId`. Alcance = sellado **legacy** `gradeKey='sealed'`, solo endpoint standalone `super_admin` | backend | no-bloqueante-aceptado |
| N-5 | Info/negocio | override «sticky» | `sourceRank:96` / `gateSealedMarketCents:664` | **Confirmado y RATIFICADO** | — | ratificado (sin acción) |

### Re-verificación de los 2 ALTOS de P-38 (H-1/H-2) — siguen CERRADOS
- **H-1 (atomicidad):** `applySealedManualOverride:611` exige `tx`; `createItem`/`batchCreate` envuelven el override en `$transaction`; `manualOverride` usa `db = tx ?? this.prisma`. **No reaparece.**
- **H-2 (anclaje sin `sealedProductId`):** doble-guardia `resolveCreation:396` + `resolveSealedMarketForAlta:549-554` → 422. **No reaparece.**
- **IMP-C**: nace por el mismo camino validado (sealedProductId + `>0` + `@Max 100M` + auditoría + tx); `gateSealedMarketCents` resolver ÚNICO ⇒ storefront == checkout. **No reabre H-1/H-2.**
- **IDOR/fuga sellado:** holdings/`/vault/sealed`/binder scoped por `ownerUserId` del JWT (check `!== userId → FORBIDDEN` en `detail`). Cola M2 `super_admin`-only. **Sin IDOR ni fuga.**

## 2. Ratificación de N-5 (override «sticky») — RATIFICADO como diseño
Money-safe e intención de diseño (PROJECT.md §K: override manual = máxima precedencia). Un override es precio humano explícito `>0`, rol-restringido (`vault_operator+`, auditado) y `super_admin` para limpiarlo. Un dato pegajoso nunca degrada a precio inseguro. Matiz operativo (no de seguridad): `isBetterRef` prioriza `capturedDate`, así que un tcgcsv más nuevo puede ganar al día siguiente.

## 3. Clasificación de N-1/N-2 (money-adjacent)
DoD se RECHAZA solo con críticos/altos abiertos → **0/0 → umbral no se activa**. N-1 y N-2 **NO bloquean**; recomendación AppSec fuerte: fast-follow inmediato (fixes triviales). N-0/N-3 = deuda aceptada con disparador (§ notas). 

## 4. Banderas para el humano
- Agendar **DAST en staging** (alta sellado + dial off por HTTP; fallo de BD a mitad de `$transaction`; override legacy `gradeKey='sealed'`; authz negativa en tiers/spreads; N-2 costo gigante) antes de volumen de dinero real; considerar pentest de tercero + bug bounty.
- Carryover no del lote (no bloquean): B-1, B-2, B-5, R-3, JWT en localStorage. Registrados.
- Custodia/PII sin regresión: CLABE/RFC/INE AES-256-GCM + enmascarado; el sellado no introdujo money-out ni PII.

## 5. VEREDICTO: **APROBADO-CON-CONDICIONES** (gate de seguridad VERDE)
- «publica» NO bloqueado: 0 críticos, 0 altos; H-1/H-2 cerrados. Umbral DoD CUMPLIDO.
- Condiciones (post-deploy, no bloquean promoción): (1) N-1/N-2 en fast-follow backend o aceptadas-registradas con disparadores; (2) N-0 en backlog devops (NestJS 11); (3) DAST en staging agendado antes de volumen real.
- Mínimo para APROBADO liso: cerrar N-1 y N-2.

_Nota de orquestación (2026-08-23): N-1/N-2/N-3 cerradas en fast-follow backend ANTES del deploy (commit `5fe3cac`, suite 170/1670 verde). **N-2** `@Max` en `acquisitionCostCents` (overflow P&L cerrado). **N-1 substancia** el gate `gateSealedMarketCents` rechaza `<=0` ($0 latente cerrado). **N-3** el resolver acepta `sealedProductId` en el `where`. **N-1 parte 1** (`@Min(1)` en el DTO) deliberadamente NO aplicada: contradiría el contrato (`≤0 → 422 VALIDATION_ERROR`, regla de negocio ya entregada por el guard de servicio); el $0 lo cierra el gate. N-0 (deps) queda en backlog devops; DAST staging agendado antes de volumen real. (Persistido por el orquestador; el agente seguridad no tiene Write.)_

— SEGURIDAD (blue team / AppSec), 2026-08-23

---

**[SEC — hotfix `trust proxy`, commit `6e21a0c`, 2026-08-23] — APROBADO para prod.**
`app.set('trust proxy', 1)` en `backend/src/main.ts`. Topología: Railway, 1 salto de edge, sin Cloudflare/dominio custom delante del backend (DEVOPS §23.2/§25.3). `1` = confianza de mínimo salto → `req.ip` = IP real anexada por el edge; el `X-Forwarded-For` del cliente se ignora → **no spoofeable** (a diferencia de `true`/nº alto). Restaura la discriminación por-IP del `ThrottlerGuard` (corrige el cubo global que agotaba `forgot-password 3/h` → 429 fantasma que impedía enviar el correo de recuperación) y da IP real a `AuthToken.requestIp`, `order-access-token.requestIp` y a la auditoría `money_out.blocked` (`money-out.guard.ts:40`). Sin consumidores de `req.secure/protocol/hostname`/cookies → sin efectos colaterales. Sin hallazgos críticos/altos; no bloquea deploy.
**Deuda de seguridad aceptada (no bloqueante):** throttler in-memory por instancia. Hoy `numReplicas: 1` (railway.json) → límite por-IP correcto. **Disparador:** antes de `numReplicas > 1`, migrar throttler a store Redis compartido (`REDIS_URL` disponible). Dueño: backend (TECH_DEBT v15-D3 / §5).
**Dependencia de topología:** si devops inserta otro proxy delante del backend, ajustar el nº de saltos de `trust proxy` (anotado en `main.ts`). (Persistido por el orquestador; el agente seguridad no tiene Write.)

— SEGURIDAD (blue team / AppSec), 2026-08-23 (hotfix trust proxy)

---

## Revisión de seguridad FOCALIZADA — P-47 parte 3 (`TcgcsvSinglesBulkPriceProvider`, commit `73f0fa4`) · 2026-08-23 · VEREDICTO **APROBADO-CON-CONDICIONES**

> **Rol:** seguridad (blue team / AppSec). Revisión estática del nuevo provider de precios singles por-acabado (TCGCSV) y su path de ingesta dedicado (`ingestSinglesForSet`), con lente de dinero. **NO corrijo código:** los dos residuales se rutean a su rol dueño (backend / arquitecto). (Persistido por el orquestador; el agente seguridad no tiene Write.)

**Superficie revisada:** `tcgcsv-singles-bulk.provider.ts` (nuevo), `price-ingest.service.ts` (`ingestSinglesForSet`, guard `provider.source==='tcgcsv_singles'`, `providerFor`), `pricing.service.ts` (`persistMarketReference`, `sourceRank`/`isBetterRef`), `settings.constants.ts` (`PRICE_PROVIDER_VALUES`).

**El código nuevo es money-safe:** identidad de carta 100% server-side (join por `CardProduct.tcgplayerProductId`, solo lectura); autz al dial `PRICE_PROVIDER` restringida a `super_admin`; validación de precio (omite `null`/`≤0`/negativo/`NaN` → nunca $0, nunca copia entre acabados); precedencia no subvertible por dato externo (el atacante no controla `sourceRank`). El path lean no colapsa acabados (sin FinishReconciler en él).

**El merge es SEGURO por ser inerte:** el seed `PRICE_PROVIDER='pokemontcg_io'` deja el provider TCGCSV singles apagado en prod; el código no escribe dinero hasta que se flipe el dial. Por eso el merge NO bloquea deploy.

**Dos condiciones ANTES de flipar `PRICE_PROVIDER=tcgcsv_singles` en prod (esa es la activación real de dinero):**
- **P47-1 (MEDIA, backend):** `market` externo no se valida con `Number.isFinite` ni cota superior. Un `Infinity`/finito-gigante se clampa en silencio a `MAX_CENTS` (~MX$21.4M) sin alerta. Añadir `Number.isFinite` + cota de cordura + `logger.warn`/AuditLog al clampar (en `tcgcsv-singles-bulk.provider.ts`, tramo `market→cents`).
- **P47-2 (ALTA, arquitecto→backend):** durabilidad cross-day del override manual. `isBetterRef` ordena `capturedDate` ANTES de `sourceRank`, así que una fila `tcgcsv_singles` del día siguiente puede ganarle a un override manual (`cardProductId=null`). Con P-47 convirtiendo `tcgcsv_singles` en escritor DIARIO, el matiz operativo se vuelve riesgo sistémico. Requiere dictamen del arquitecto sobre §4.27f (el override manual debe ganar independientemente de la fecha) + fix backend.

**Condición del gate:** el merge es seguro (código inerte por el seed); las dos condiciones (P47-2 confirmado/corregido + P47-1 acotado) deben cerrarse **antes de flipar `PRICE_PROVIDER=tcgcsv_singles` en prod**. Sin críticos/altos abiertos en el código mergeado.

— SEGURIDAD (blue team / AppSec), 2026-08-23 (P-47 parte 3)

---

## P-47 parte 3 — Veredicto de CIERRE de condiciones (blue team / AppSec)
**Rama:** `fix/variant-composition-regression` · **Fecha:** 2026-08-24 · **Modo:** gray-box estático
**Contexto:** verificación de cierre de las 2 condiciones del veredicto previo APROBADO-CON-CONDICIONES,
requisito para flipar `PRICE_PROVIDER=tcgcsv_singles` en prod.

### VEREDICTO: NO-CERRADAS — RECHAZADO para el flip
Queda **1 hallazgo ALTO abierto** (P47-2). No se habilita `PRICE_PROVIDER=tcgcsv_singles` en prod
hasta cerrarlo y re-verificar (independiente de los veredictos de QA y techlead).

### P47-1 (MEDIA) — commit 03f0e02 — CERRADA
`backend/src/modules/pricing/providers/tcgcsv-singles-bulk.provider.ts`.
- `MAX_SANE_MARKET_USD=50_000`; `!Number.isFinite(market)` → fila OMITIDA (:132-135); `market > cota` →
  OMITIDA + `logger.warn(productId/finish/market)` (:142-150). Todo `continue` antes de `rows.push`.
- Verificado: un dato externo corrupto (Infinity/NaN/finito-gigante) NO puede clavar un precio; la celda
  queda «—»/PRICE_PENDING (nunca $0, nunca copia otro acabado); `marketCents` ≤ 5M c (sin overflow Int32);
  la cota es visible (warn) en el caso realista. Objetivo money-safe cumplido.
- Deuda menor ACEPTADA (Baja, observabilidad): el caso `!Number.isFinite` se omite SIN warn (solo la
  sobre-cota audita). No bloquea: se OMITE (no se clampa) y JSON no produce Infinity/NaN nativos.
  Disparador: si a futuro entra un feed que compute valores no finitos, añadir warn simétrico. Dueño: backend.

### P47-2 (ALTA) — commit b16f03d + dictamen §4.27f-2/v1.46 — NO CERRADA (ALTA, abierta)
`backend/src/modules/pricing/pricing.service.ts`.
- La MITAD del fix es correcta: `isBetterRef` iza el tier manual sobre `capturedDate` (:131-133); un manual
  gana siempre a un automático; `isManualOverride`/`source` son server-side (el atacante no los controla;
  el bulk persiste `isManualOverride:false`); entre automáticas gana la fresca (sin regresión).
- HUECO (capa de lectura, no reconciliada con el nuevo comparador): `getReference` (:307-312) y
  `getReferenceByCardProduct` (:350-355) leen `orderBy capturedDate desc` con `take:32`
  (`SAME_DAY_REF_CANDIDATES`). El override manual se escribe con `capturedDate=today()` FIJO (:1100-1120)
  y no se re-fecha; el barrido diario `tcgcsv_singles` crea ~1 fila automática/día para la misma clave y
  NO hay poda de `PriceReference`. Tras ~32 días la fila manual cae fuera del top-32 → `pickBestRef` no la
  ve → el feed diario VUELVE a pisar el precio humano, en silencio.
- Impacto: regresión money-safe sobre el control humano de precio, alcanzable en operación normal (el flip
  ES un barrido diario), sin atacante y sin alerta. Incumple el criterio de P47-2 («gana SIEMPRE / durable
  cross-day / revocable solo por otro manual o limpieza super_admin»): válido al día +1, roto al día +32.
- Evidencia adicional: el comentario de `SAME_DAY_REF_CANDIDATES` (:74-81) aún afirma que solo pueden ganar
  las filas del día más reciente (invariante que P47-2 invalidó). Asimetría: `getReferencesBatch` (:387-398)
  NO lleva `take` (sí es durable) → la misma variante puede valuarse distinto según qué método la lea.
- Dueño: **backend** (garantizar que toda fila `isManualOverride=true` de la clave esté siempre entre las
  candidatas de `getReference`/`getReferenceByCardProduct`, consistente con `getReferencesBatch`; p. ej.
  pin/segundo fetch del manual o quitar el `take`). **arquitecto** (reconciliar §4.27f-2/v1.46 y el comentario:
  la durabilidad manual depende también de la capa de lectura, no solo del comparador).

### Mínimo para APROBAR el flip
1. Cerrar P47-2: la lectura de referencia base y por-producto DEBE incluir siempre el override manual de la
   clave (los 3 métodos consistentes), y re-verificar con un caso de >32 días de barrido diario.
2. Re-emitir veredicto de cierre de seguridad = CERRADAS.
3. QA y techlead también aprobando. P47-1 ya no bloquea.

### Bandera para el humano
- Antes de operar el autoprecio diario con dinero real, agendar el DAST/E2E pendiente que ejercite la
  durabilidad del override manual a lo largo del horizonte de acumulación (no solo el día siguiente).

— SEGURIDAD (blue team / AppSec), 2026-08-24 (P-47 cierre: NO-CERRADAS, ALTA P47-2 abierta)

---

### P47-2 (ALTA) — Durabilidad cross-day del override manual en la capa de lectura — CERRADA (v1.47)

- **Estado:** CERRADA ✅ · verificado por seguridad (blue team) sobre commit `330f0b4` (dictamen arquitecto §4.27f-3 / v1.47).
- **Hallazgo original:** `getReference`/`getReferenceByCardProduct` leían candidatas con `take:32`
  (`SAME_DAY_REF_CANDIDATES`). Tras ~32 barridos diarios `tcgcsv_singles` para la misma clave, el override
  manual (con `capturedDate` fijo antiguo) caía fuera de la ventana y `pickBestRef` nunca lo veía → el feed
  automático pisaba el precio humano en silencio (money-losing). Asimetría con los caminos batch (sin cap).
- **Fix verificado (backend):**
  - `pricing.service.ts` — `getReference` (L332-344) y `getReferenceByCardProduct` (L384-402) hacen DOS
    lecturas en paralelo: bloque reciente CAPADO (`take:32`, solo tier automático) + lectura DIRIGIDA de
    manuales (`MANUAL_REF_PREDICATE = OR[isManualOverride:true, source:'manual']`) **sin cota de fecha ni
    `take`**, unidas antes de `pickBestRef`. El `AND` con `BASE_CARD_REF_WHERE` no excluye el manual
    (`manualOverride()` escribe `cardProductId=null`).
  - `isBetterRef` (L149-166) iza el tier manual ABSOLUTO por encima de `capturedDate` (durable cross-day).
  - `admin.service.ts` `ownedItemRefs` (L307-325) — `findMany` sin `take` + reduce con `isBetterRef`
    (antes «primera vista» por fecha).
  - Consistencia confirmada en los cinco consumidores (getReference, getReferenceByCardProduct,
    getReferencesBatch, getSeparateProductsByCard, ownedItemRefs).
- **Sin nuevo vector:** `source`/`isManualOverride` siguen server-side; `OverrideDto` no los expone; endpoint
  `@Roles(super_admin)` + auditado; el bulk escribe `isManualOverride:false`. Sin suplantación de «manual».
- **Regresión:** entre automáticas gana la fresca; lecturas filtradas por `finish` (sin copia entre acabados);
  sin $0.
- **Tests (13/13 verde):** `pricing.manual-override-durable-cross-day.spec.ts` (escenario >32 días + control
  negativo), `admin.owned-item-refs.manual-override.spec.ts`, `pricing.getreference-determinism.spec.ts`.
- **Rol dueño:** backend (ya remediado). No requiere acción adicional.

**Sin hallazgos críticos/altos abiertos en el eje de precios/dinero de esta rama.** Por parte de seguridad,
queda HABILITADO (junto con QA + techlead) el flip `PRICE_PROVIDER=tcgcsv_singles`.

— SEGURIDAD (blue team / AppSec), 2026-08-24 (P-47 cierre: CERRADAS, flip habilitado por seguridad)
