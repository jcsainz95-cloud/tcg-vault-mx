# INE — «Umbral, luego bloqueo» — ESPECIFICACIÓN DE BORRADOR

> ⚠️⚠️ **ESTO ES UN BORRADOR, NO EL CONTRATO FINAL.** Lo escribe el **arquitecto** para revisión
> del dueño y de los tres veredictos (QA + techlead + seguridad). **No modifica `docs/API_CONTRACT.md`
> ni el código.** Cuando el dueño cierre las preguntas abiertas (§7), el arquitecto trasladará la
> regla acordada al contrato vivo (§M5-K / §5 códigos de error) y **solo entonces** backend implementa.
>
> **Rol:** arquitecto. **Fecha de redacción:** 2026-09-15. **Decisión del dueño que lo origina:**
> 2026-09-15 — *«umbral, luego bloqueo»*.

---

## 0. Resumen en una línea

Hoy un vendedor con **INE rechazada** puede crear una solicitud de venta de **cualquier monto**. El
dueño decide: por **debajo** de `INE_THRESHOLD_CENTS` se le sigue dejando vender; **al/por encima** del
umbral, la solicitud se **rechaza** si su identidad está **rechazada** (`kycStatus === 'rejected'`).

---

## 1. El hecho medido — por qué hoy pasa la puerta

Todo lo de esta sección está **medido** en el árbol actual (`HEAD bb239c0`), no recordado.

- **`createRequest` NUNCA compara `kycStatus`.** Medido en
  `backend/src/modules/buylist/buylist.service.ts` `createRequest` (~líneas **1351–1735**). La única
  puerta de identidad es `INE_REQUIRED`.
- **La puerta `INE_REQUIRED` solo mira PRESENCIA de imágenes, no el veredicto.** Medido en
  `buylist.service.ts:1621–1623`:
  ```ts
  const ineProvided = Boolean(
    (ineUploadKeys?.front && ineUploadKeys?.back) || (kyc?.ineFrontKey && kyc?.ineBackKey),
  );
  ```
  y `:1633–1646`:
  ```ts
  const ineRequired = quotedTotalCents >= ineThreshold || hasPendingLine;
  if (ineRequired && !ineProvided) {
    throw BusinessException.validation('INE_REQUIRED', 'INE required above threshold', {});
  }
  ```
  ⇒ Basta con que existan `ineFrontKey`/`ineBackKey` en el `KycProfile`. **El veredicto del admin no
  entra en la ecuación.**
- **Las keys de INE NO se borran al rechazar.** Medido en
  `backend/src/modules/admin/admin.service.ts:1110–1132` (`reviewKyc`/`upsert`): la rama de rechazo
  escribe `kycStatus:'rejected'`, `rejectionReason`, `reviewedAt`, `reviewedBy`, `verifiedAt:null` —
  y **NO toca `ineFrontKey`/`ineBackKey`**. Por eso una INE rechazada deja las imágenes en archivo y
  `ineProvided` sigue dando `true`.
- **El umbral ya existe y ya se lee.** Medido en `buylist.service.ts:1588`:
  `const ineThreshold = await this.settings.getNumber(SettingKey.INE_THRESHOLD_CENTS);`

**Conclusión:** hoy la puerta responde a la pregunta *«¿subiste una identificación?»* y no a *«¿tu
identificación fue aceptada?»*. La decisión del dueño añade la segunda pregunta, **solo sobre el umbral**.

---

## 2. ⚠️ COLISIÓN CON UNA DECISIÓN VIGENTE DEL CONTRATO — SE LEE PRIMERO

Esta regla **no cae en terreno virgen**. Hay una decisión **explícita y deliberada** en el contrato
vivo que dice lo contrario, y el arquitecto la pone delante porque cualquier implementación que la
ignore es una **regresión**, no una mejora.

- **`docs/API_CONTRACT.md:5378–5397` (§M5-K, D51):**
  > *«`kycStatus` NO es precondición de dinero en ningún endpoint —ni crear, ni ofertar, ni pagar—.»*

  El código `KYC_NOT_VERIFIED` fue **RETIRADO en v1.60 (D51) antes de implementarse**. La v1.59 iba a
  meter un término `kycStatus != 'verified'` en `pay-spei` y **se revirtió**.

- **`API_CONTRACT.md:1216` (tabla E):** `kycStatus` es *«anotación de back-office SIN CONSECUENCIA. No
  gatea creación, ni emisión, ni pago»*, con la advertencia de que **`'verified'` no significa que se
  haya verificado nada** (tras D51 no existe acto de verificación en el sistema).

- **`API_CONTRACT.md:1217–1220` — LA NORMA QUE HABILITA ESTE MISMO BORRADOR:**
  > *«ninguna regla nueva se cuelga de `kycStatus` sin pasar por el arquitecto (regla 9)… un enum con
  > un valor llamado `verified` es una invitación permanente a construirle encima una regla.»*

  **Este documento ES ese paso por el arquitecto.** El dueño tiene todo el derecho a cambiar D51; lo
  que la norma exige es que el cambio sea consciente y quede escrito, no que sea imposible.

- **`PROJECT.md` criterio 183(a)** verifica **por ausencia**: *«una solicitud sobre el umbral, con INE
  en archivo y sin que nadie haya marcado nada, se oferta y se paga»*. **Ver §7-P2:** este criterio
  choca de frente con la variante *«exijo verificada»* y **NO** con la variante *«bloqueo solo lo
  rechazado»* — la distinción es la pregunta abierta central.

**Qué implica para el trabajo:** la implementación **modifica D51 / §M5-K**. El arquitecto deberá
reescribir §M5-K y la fila `kycStatus` de la tabla E, y actualizar/retirar el criterio 183(a) de
`PROJECT.md`, **antes** de que backend toque código. Este borrador **no** hace ese cambio; lo señala.

> ✅ **Lo que la nueva regla NO reabre:** la **pregunta 40** (*«¿de dónde sale el nombre del titular de
> la CLABE?»*, cerrada con «no existe fuente») **NO se toca**. Aquella mataba el cotejo **INE ↔ nombre
> del titular**. La regla nueva gatea sobre el **veredicto del admin (`kycStatus`)**, que ya existe y no
> necesita el nombre del titular. Por eso esta regla **es implementable** donde `KYC_NOT_VERIFIED` no lo
> era: son controles distintos aunque suenen parecido.

---

## 3. La regla exacta (propuesta)

Sea `total = quotedTotalCents` (bruto cotizado, mismo que ya usan el mínimo, los topes y el umbral INE),
y `T = INE_THRESHOLD_CENTS`. **Borde: alineado con el umbral INE existente**, que es `>=` (inclusivo:
exactamente el umbral cuenta como «sobre el umbral»).

| Situación | `total < T` | `total >= T` |
|---|---|---|
| `kycStatus === 'rejected'` | **sin cambio** → se deja crear | **RECHAZA** (código nuevo, ver §3.1) |
| `kycStatus ∈ {none, pending}` | sin cambio | **VER §7-P2** (depende de la pregunta abierta) |
| `kycStatus === 'verified'` | sin cambio | sin cambio → se deja crear |

**Regla base (la que el dueño ya decidió, sin ambigüedad):**

> Por **debajo** de `T`: comportamiento actual intacto (montos chicos se dejan vender aunque la INE esté
> rechazada). **Al/por encima** de `T`: la solicitud se **rechaza si `kycStatus === 'rejected'`**.

**La parte que el dueño aún NO cerró** (§7-P2): si al/por encima de `T` basta con *«no rechazada»*
(bloquea solo `rejected`) o se exige *«verificada»* (bloquea también `none`/`pending`). Este borrador
**recomienda la variante conservadora «solo rechazada»** por §7-P2, pero la decisión es del dueño.

### 3.1 Código de error y mensaje

Dos opciones; el arquitecto **recomienda la (A)** por trazabilidad y porque no ensucia la semántica de
`INE_REQUIRED` (que hoy significa *«no hay imágenes»*, no *«la revisión salió mal»*).

- **(A) Código nuevo `KYC_REJECTED` (recomendado).** `422`, familia validación.
  - `details: {}` **VACÍO**, por la misma doctrina de `INE_REQUIRED` (§M6-K.5 / v1.69): **el umbral no
    viaja al vendedor** — ni `thresholdCents`, ni «te faltan $X». Una frase, no un dial (patrón D43).
  - Mensaje interno (el copy final lo redacta **ux-ui** en `DESIGN_SYSTEM`, no aquí): algo como
    *«Tu identificación fue rechazada; corrígela para continuar con ventas de este monto.»*
  - **PII:** el mensaje **NO incluye `rejectionReason`** (ver §4.3). El vendedor ya lo consulta por su
    ruta propia: `GET /users/me/kyc` devuelve `rejectionReason` **si y solo si** `kycStatus==='rejected'`
    (`API_CONTRACT.md:7138`, medido en `users.service.ts:341–343`). **Un solo emisor del motivo.**

- **(B) Reusar `INE_REQUIRED` con `details.reason`.** p.ej. `{ reason: 'rejected' }`. Más barato en
  contrato pero **sobrecarga** un código que hoy significa una sola cosa; el front tendría que ramificar
  por `reason` y se pierde la métrica limpia de «cuántas se frenan por rechazo vs. por falta de imagen».
  **No recomendado**, pero es opción del dueño (§7-P3).

---

## 4. Dónde engancha en `createRequest`

### 4.1 La cascada actual (medida, `buylist.service.ts` comentarios ~1333–1345, código ~1369–1647)

```
1. RAW-ONLY (graded/sealed abortan)      :1369
2. PHONE_REQUIRED                        :1382
3. PICKUP_ADDRESS_REQUIRED / NOT_FOUND   :1396–1406
   ... CLABE (formato / nombre / fallback) ...
   ... cotización server-side de las N líneas → quotedTotalCents ...
4. BUYLIST_MINIMUM_NOT_MET               :1567   (necesita el TOTAL, por eso va aquí)
5. BUYLIST_LIMIT_EXCEEDED (per_request)  :1592
   INE_REQUIRED (umbral)                 :1633–1647   ← la nueva guarda va JUNTO a ésta
   ... upsert KYC + purga de INE sustituida ...
   per_month (dentro de tx serializable) :1684
   create                                :1693
```

### 4.2 Ubicación exacta de la nueva guarda

La guarda `KYC_REJECTED` va **inmediatamente contigua a la puerta `INE_REQUIRED`** (después de la
existente, sobre el mismo `ineRequired`/`total`), porque **comparte exactamente el mismo gate: el total
sobre el umbral**. Esbozo (ilustrativo, **no** es el diff — lo escribe backend):

```ts
// (existente, :1633–1647)
const ineRequired = quotedTotalCents >= ineThreshold || hasPendingLine;
if (ineRequired && !ineProvided) {
  throw BusinessException.validation('INE_REQUIRED', 'INE required above threshold', {});
}

// (NUEVO — misma condición de umbral, veredicto en vez de presencia)
if (ineRequired && kyc?.kycStatus === 'rejected') {
  throw BusinessException.validation('KYC_REJECTED', 'Identity was rejected; cannot sell above threshold', {});
}
```

**Notas de orden y money-safety (deben respetarse):**

- **Va DESPUÉS de `INE_REQUIRED`, no antes.** `INE_REQUIRED` es el mensaje más accionable para el 99%
  (*«sube tu INE»*); `KYC_REJECTED` es para quien ya subió y le fue rechazada. Si ambas fueran ciertas
  (no debería: un rechazado tiene keys ⇒ `ineProvided=true` ⇒ no dispara `INE_REQUIRED`), gana el
  mensaje que el vendedor puede resolver. **En la práctica son mutuamente excluyentes** dado el hecho de
  §1 (rechazado ⇒ tiene imágenes), pero el orden lo deja explícito.
- **`kyc` ya está leído** (`:1372`, `const kyc = await this.prisma.kycProfile.findUnique(...)`, por el
  `userId` autenticado). **La guarda no añade ninguna query nueva** ni toca PII de otro usuario.
- **Va ANTES del `upsert` de KYC (:1664) y ANTES de la tx serializable (:1680).** Igual que las otras
  puertas: si va a fallar, que falle antes de escribir nada y antes de abrir la transacción de dinero.

---

## 5. Money-safety y los 3 veredictos — qué debe cerrar cada gate

### 5.1 QA (funciona, y no se puede rodear)

- **Canario base (debe fallar hoy, pasar tras el cambio):** vendedor con `kycStatus='rejected'` + INE en
  archivo + `total >= T` ⇒ **`422 KYC_REJECTED`** y **la solicitud NO se crea** (0 filas en `SellRequest`).
- **No-regresión debajo del umbral:** mismo vendedor con `total < T` ⇒ **se crea** (comportamiento actual).
- **No-regresión de `verified`/`pending`/`none`:** según la variante que cierre el dueño (§7-P2), con su
  propio canario. Si es «solo rechazada», un `pending`/`none` sobre el umbral con INE en archivo **se
  crea** (esto es literalmente el criterio 183(a) actual — ver §7-P2).
- **Bypass por «precio pendiente» (C15 / §compliance, `:1624–1633`):** una línea `precio_pendiente` suma
  **0** a `quotedTotalCents`, así que un vendedor rechazado podría meter una carta cara **sin referencia**
  → total 0 → por debajo del umbral → **se colaría**. La guarda existente ya fuerza `ineRequired=true`
  cuando `hasPendingLine`. **La nueva guarda debe colgarse del MISMO `ineRequired`** (que ya incluye
  `|| hasPendingLine`), **no de `quotedTotalCents >= ineThreshold` a secas** — de lo contrario reabre el
  bypass que C15 cerró. Canario: rechazado + 1 línea `precio_pendiente` + total 0 ⇒ **`KYC_REJECTED`**.
- **Idempotencia / carrera:** la puerta es un `throw` puro sobre estado leído; no escribe. No hay estado
  que dejar a medias. **Sí** debe quedar **antes** de la tx serializable (§4.2) para no abortar dinero a
  mitad. QA mide N veces (O-3) el caso concurrente «dos solicitudes del mismo rechazado sobre el umbral»:
  ambas deben dar `KYC_REJECTED`, ninguna crear.

### 5.2 Techlead (bien hecho)

- **Un solo sitio** que decide «rechazado sobre umbral», contiguo a `INE_REQUIRED`; **cero queries
  nuevas** (reusa `kyc` de `:1372`). No duplicar la lectura del umbral (reusar `ineThreshold`/`ineRequired`).
- **No colgar más lógica del enum sin volver al arquitecto** (norma `:1217`). La guarda compara **un**
  valor (`'rejected'`), no una jerarquía.
- **Paridad documental:** el enum `KycStatus` y el nuevo código `KYC_REJECTED` deben quedar en
  `API_CONTRACT.md` §5 y, si aplica, en las suites de paridad (enums / códigos de error). §M5-K y la
  tabla E (`:1216`) se **reescriben**; criterio 183(a) de `PROJECT.md` se **retira o ajusta** (§7-P2).

### 5.3 Seguridad (blue team)

- **No filtra PII:** `KYC_REJECTED` lleva `details:{}` vacío; **nunca** `rejectionReason`, ni el nombre,
  ni el umbral. El motivo se lee solo por `GET /users/me/kyc` del **propio** usuario (autenticado).
- **No enumera umbral:** igual que `INE_REQUIRED` tras v1.69, la respuesta no imprime `T` ni deja
  inferirlo con una cifra derivada (nada de «te faltan $X para necesitar identidad»). Una frase.
- **No IDOR:** `kyc` se lee por el `userId` autenticado (`:1372`), nunca por uno del body.
- **No degrada controles existentes:** solo **endurece** (una puerta más). No toca `INE_REQUIRED`, ni los
  topes AML, ni el cierre C15.

---

## 6. Datos — qué ya existe y qué NO hace falta migrar

- ✅ **`KycProfile.kycStatus` existe.** Medido en `backend/prisma/schema.prisma:471`
  (`kycStatus KycStatus @default(none)`) con el enum `enum KycStatus { none pending verified rejected }`
  (`schema.prisma:305–310`).
- ✅ **Las keys de INE NO se borran al rechazar.** Medido en `admin.service.ts:1110–1132`: la rama de
  rechazo no toca `ineFrontKey`/`ineBackKey`. (Es la causa del comportamiento de §1.)
- ✅ **`INE_THRESHOLD_CENTS` existe y se lee** (`buylist.service.ts:1588`, `SettingKey.INE_THRESHOLD_CENTS`).
- ✅ **`kycStatus` ya se proyecta** al usuario (`GET /users/me/kyc`, `users.service.ts:320–343`;
  `GET /users/me`, `:88`) y al admin (`AdminKycProfileDTO`). No hay que exponer nada nuevo para la regla.

**Migración:** **NINGUNA nueva.** Todos los campos existen y se pueblan hoy. El cambio es puramente de
**lógica de negocio** en `createRequest` (un `if`) + contrato + copy. No hay DDL, no hay backfill.

> Único matiz de datos a decidir con el dueño (§7-P4): las filas **legacy** rechazadas **antes** de que
> existiera `rejectionReason` (M-54) tienen `kycStatus='rejected'` **sin motivo**. La regla las bloquea
> igual (correcto: la identidad está rechazada), pero el portal no tendrá un motivo que mostrarles; el
> copy debe tolerar `rejectionReason` ausente. **Sin migración**: es el mismo caso que ya maneja
> `GET /users/me/kyc` (`users.service.ts:339–343`).

---

## 7. Preguntas abiertas al dueño

- **P1 — El grande, y bloquea el arranque de backend.** Esta regla **modifica D51 / §M5-K**, que hoy dice
  *«`kycStatus` NO es precondición de dinero en ningún endpoint»*. ¿Confirmas que **quieres cambiar D51**
  para este caso concreto (crear solicitud sobre el umbral)? El arquitecto **no** reescribe el contrato
  vivo hasta tu sí explícito.

- **P2 — ¿«no rechazada» o «verificada»?** (la que el propio encargo dejó abierta)
  - **Variante «solo rechazada» (recomendada):** al/por encima de `T`, bloquea **solo** `kycStatus ===
    'rejected'`. Deja pasar `none`/`pending`/`verified`. **Ventaja:** **no** contradice el criterio
    183(a) de `PROJECT.md` (*«INE en archivo y sin que nadie haya marcado nada → se oferta y se paga»*),
    porque ese caso es `none`/`pending`, no `rejected`. Cambio mínimo, bloqueo quirúrgico.
  - **Variante «exijo verificada»:** al/por encima de `T`, exige `kycStatus === 'verified'` (bloquea
    también `none`/`pending`). **Cuidado:** esto **reinstaura de hecho** el control `KYC_NOT_VERIFIED`
    retirado en D51 **y contradice el criterio 183(a)** — además choca con la advertencia del contrato de
    que `'verified'` *«no significa que se haya verificado nada»* tras D51 (no hay acto de verificación
    real). Si eliges ésta, hay que **reintroducir un acto de verificación con significado** o aceptar que
    «verificado» sea solo «un admin le dio clic». Más caro y con más aristas.

- **P3 — Código de error:** ¿`KYC_REJECTED` nuevo (recomendado, métrica y semántica limpias) o reusar
  `INE_REQUIRED` con `details.reason='rejected'` (más barato en contrato, front ramifica)?

- **P4 — Legacy sin motivo:** las filas `rejected` anteriores a M-54 no tienen `rejectionReason`. Se
  bloquean igual; el portal muestra «rechazada» sin motivo. ¿OK, o quieres un texto genérico de respaldo
  (lo redactaría ux-ui)? (No requiere migración en ningún caso.)

---

## 8. Handoff (cuando el dueño cierre §7)

1. **Arquitecto:** reescribe `§M5-K` y la fila `kycStatus` de la tabla E en `API_CONTRACT.md`; declara el
   código de la §3.1 en §5; ajusta/retira criterio 183(a) en `PROJECT.md` (vía product-owner). *Zona
   compartida `API_CONTRACT.md` — un solo stream a la vez (regla de zonas compartidas).*
2. **ux-ui:** copy de `KYC_REJECTED` en `DESIGN_SYSTEM.md` (frase, sin cifra, sin PII).
3. **backend:** la guarda de §4.2 + prueba que falla (§5.1), en el stream **Catálogo y precios**
   (`buylist`).
4. **QA + techlead + seguridad:** los tres canarios de §5.
