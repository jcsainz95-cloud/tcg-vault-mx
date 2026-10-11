# BORRADOR — Regla común para los ejes de query de dominio cerrado (EQ-D1)

**Proyecto:** TCG HUNT · tcghunt.mx
**Rol que escribe:** arquitecto
**Fecha:** 2026-09-15
**Estado:** ⚠️ **BORRADOR PARA REVISIÓN del dueño / orquestador. NO es contrato vivo.** No toca
`docs/API_CONTRACT.md` (§0-Q) ni código. Propone la **regla de clase** que la ficha `EQ-D1` de
`docs/TECH_DEBT.md` deja explícitamente al arquitecto («⛔ *la clase la decide el arquitecto (regla
9)*»).
**Contexto:** deuda `EQ-D1` en `docs/TECH_DEBT.md` (§«Los 22 ejes de query de DOMINIO CERRADO que §0-Q
no registra — ⭐ 16 abiertos»). Descubierta por el candado `C-EQ-1`
(`backend/test/integration/enum-query-axes.e2e-spec.ts`).

---

## 1. El problema, en una frase

Hay **~16 ejes de query** de **dominio cerrado** (un `@Query` que solo admite un conjunto fijo de
valores) que, ante un valor **fuera de dominio**, **no responden 400: lo tragan en silencio** — o lo
ignoran (devuelven la lista sin filtrar) o lo **clampan** (devuelven una lista *distinta* de la
pedida). Es **la misma familia** del bug de bóveda/INE ya cerrado (`EQ-D0`, `A5`): un filtro que
miente sin avisar. `§0-Q` de `API_CONTRACT.md` ya lo prohíbe; lo que falta es **aplicar la regla a
estos ejes**, y para eso hay que **decidir su clase** (E o R) uno por uno.

## 2. El patrón que ya existe — no se inventa nada

La cura ya está escrita y probada. **No se propone un mecanismo nuevo**, se propone **extender el
existente**:

- **`backend/src/common/enum-filter.ts`** — dos funciones:
  - `parseEnumFilter(field, raw, allowed, opts?)` — la puerta completa de `§0-Q`:
    - ausente / `null` / vacío tras `trim()` ⇒ `undefined` (**no filtra**, `200`).
    - token exacto del dominio ⇒ el token.
    - **cualquier otra cosa** (incluido `' pending'` con espacios) ⇒ **`400 VALIDATION_ERROR`** con
      `details.{field, allowed}` (y `value` acotado a 64 chars **solo** donde ya se emitía —
      `echoValue`, que **no es punto de extensión**).
  - `assertEnumFilter(...)` — la mitad para cuando el valor ya se sabe presente (token de CSV,
    parámetro de ruta).
- Ya migrados a este helper (medido, verde): los 6 de `P-84`, los 6 del catálogo (`P-89`) y los 6 de
  la bóveda (`EQ-D0`). El trinquete de `C-EQ-1` bajó **22 → 16**.

**La regla común, por tanto, es literalmente:** *cada eje pendiente pasa su valor por
`parseEnumFilter` con la `allowed` correcta; el resto (400, forma de `details`, cota del eco) sale
gratis y ya está probado.* Lo único que **no** decide el helper es **de dónde sale `allowed`** — esa
es la decisión de clase, y es lo único que este borrador tiene que resolver por eje.

## 3. La regla de comportamiento (la misma para TODOS los ejes)

> **Un eje de query de dominio cerrado o FILTRA por un valor del dominio, o responde `400`. Lo que
> tiene PROHIBIDO es tragarse el valor en silencio (ignorarlo o clamparlo a un default).**

Desglosada contra `§0-Q`:

1. **Ausente / vacío** (`''`, `' '`, `'\t'` tras `trim()`) ⇒ **no filtra**, `200`. Es la intención
   «muéstrame todo» (un `<select>` en «Todas» manda vacío). ⛔ Nunca `400` por vacío.
2. **Token del dominio** ⇒ filtra por él.
3. **Fuera de dominio** (incluido un token válido con basura alrededor, `' pending'`) ⇒
   **`400 VALIDATION_ERROR`**, con `details.field` (obligatorio) y `details.allowed`. ⛔ El `trim()`
   decide si está *vacío*, **no** «arregla» el token: normalizar entrada en silencio es la misma
   familia de error que ignorar el filtro.
4. **⛔ Prohibido el clamp silencioso** (`§0-Q punto 6`): devolver una lista *ordenada/filtrada por un
   default* ante basura es devolver algo **distinto de lo pedido** sin decirlo. Aplica igual a
   `?sort=` y `?range=` que a los enums de estado.
5. **Forma del `details` congelada**: `{field, allowed}` (y `value` acotado **solo** donde ya se
   emitía). ⛔ Ninguna cuarta forma (`invalid`, `invalidStatus` fuera de su caso CSV declarado). El
   censo de `test/enum-filter.spec.ts` lo vigila.
6. **La cota del eco** (`ENUM_FILTER_ECHO_MAX = 64`) aplica **dondequiera que el valor del cliente se
   devuelva** (`message` y `details.value`), incluidos los `throw` inline que hoy no la pasan.

## 4. La decisión que el arquitecto DEBE tomar por eje: clase E vs clase R

`enum-filter.ts` lo dice: *«la lista `allowed` decide la CLASE, y la clase NO la decide este
fichero»*. La pregunta, **por endpoint**, es:

> *Si mañana alguien añade un valor a este enum en `schema.prisma`, ¿este endpoint debe aceptarlo
> automáticamente?*

- **Sí ⇒ clase E (Enum completo):** `allowed = Object.values(PrismaEnum)`. Es el caso de casi todo
  **filtro de lista del back-office**: existe para rebanar la tabla **entera**. Si el schema gana un
  estado y la lista está a mano, el operador recibe `400` filtrando por un estado que **existe de
  verdad** ⇒ el estado nuevo se vuelve invisible. Aquí clase R sería **peor** que E.
- **No / depende ⇒ clase R (subconjunto Restringido):** el endpoint acepta a propósito un
  **subconjunto** fijado por `PROJECT.md`/contrato. La lista se declara **literal** en
  `common/business-rules.ts` (o inline en su único call-site) **con la cláusula del contrato citada
  al lado**, y se pasa al mismo helper. Es el caso de los ejes con dominio dictado por el contrato
  (p.ej. `?sort` con su lista cerrada en `API_CONTRACT §3`, `?range` con sus 8 literales).

**Regla de pulgar propuesta:** *estado/tipo de una entidad en un listado admin ⇒ **E**; orden,
ventana temporal, o subconjunto que el contrato fija ⇒ **R**.*

## 5. Los ejes pendientes (los 16 abiertos de `EQ-D1`) con clase PROPUESTA

Tomados de la tabla de `EQ-D1` en `docs/TECH_DEBT.md` (medición 2026-09-13). **La clase de la
columna «propuesta» es la recomendación del arquitecto para revisión — no está aplicada.**

| Eje(s) | Conducta hoy | Clase propuesta | `allowed` propuesta |
|---|---|---|---|
| `GET /admin/shipments?kind=` | ignora en silencio (`if kind===…`) | **R** | subconjunto `{guest_direct_ship, vault_withdrawal}` fijado por §M4 (no es un enum de Prisma 1:1) |
| `GET /admin/users/:id/audit?scope=` | **clamp** a default `target` | **R** | subconjunto declarado del contrato de auditoría; clamp ⇒ `400` |
| `GET /admin/pricing/graded-estimates/review?reason=` | `400` con **4ª forma** (`details.invalid`) | E o R (según si el dominio = enum de Prisma) | **corregir la forma** a `{field, allowed}` vía helper — lo urgente aquí es la forma, no la clase |
| `?range=` ×4 (`/catalog/featured-set/value-history`, `/catalog/sealed/:id/value-history`, `/catalog/sets/:id/value-history`, `/vault/portfolio/history`) | **clamp** silencioso a `'1m'` | **R** | los **8 literales** del rango, declarados en contrato; clamp ⇒ `400` |
| `?sort=` ×6 (`/catalog/cards`, `/catalog/sealed`, `/admin/inventory/master-sets`, `/admin/vaults`, `/admin/vaults/:id/master-sets`, `/vault/master-sets`) | caen a su default | **R** | lista cerrada de cada endpoint, ya en `API_CONTRACT §3`; `§0-Q` aún **no declara** su dominio ⇒ hay que declararlo |
| `GET /catalog/cards?sealedSubtype=` | sigue vivo y filtrando | **N/A — RETIRAR** | **RETIRADO del contrato en v1.73**: la cura es **quitar el parámetro**, no validarlo (ver `EQ-D3`, cuya precondición YA se cumplió: frontend cerró `D-EQ-3`) |

**Fichas hermanas que se trabajan por separado** (listadas aquí por completitud del censo, pero
NO son parte de los 16 de este borrador):
- `EQ-D0` (bóveda) — **cerrada**.
- `EQ-D0b` (`?report=` ×2 de exportación) — **Media-export**, ficha propia; caen a `inventory` en
  silencio ⇒ clase **R** (`{pnl, iva, inventory}`), `400` fuera de dominio.
- `EQ-D2` — 3 ejes que **sí** están en el registro pero incumplen (cota del eco / `?state=` repetible
  con `trim()` por token / `?sort=` de bounties). El de `?state=` **cambia de forma** (es repetible,
  no CSV ni escalar) ⇒ requiere decisión del arquitecto sobre su forma, no solo su clase.
- `EQ-D3` (backend) — la mitad backend de cerrar `?productType=`/`?sealedSubtype=` de `/catalog/cards`;
  **precondición cumplida**, se puede cerrar ya.
- `EQ-D4/D5/D6/D7` — agujeros del **descubrimiento** (`@Query` sin nombre, `@Sse/@Search`,
  `@Req().query`, flaky del step-guard), no ejes con clase pendiente.

## 6. Cómo se cierra cada eje (comprobación, tomada de `EQ-D1`)

Para cada eje, una vez decidida la clase:
1. Su stream migra el call-site a `parseEnumFilter` con la `allowed` de su clase (E ⇒
   `Object.values`; R ⇒ literal con cláusula citada).
2. El eje **sale de `SIN_CLASE_DECLARADA`** y entra al `REGISTRO` de
   `enum-query-axes.e2e-spec.ts`; sus **siete propiedades de `§0-Q`** salen verdes sin excepción.
3. El **trinquete** de `C-EQ-1` (`SIN_CLASE_DECLARADA.length ≤ 16`) **baja a mano** — y ese descenso
   se ve en la revisión (es el punto del trinquete: la entrada nº 17 obliga a subir el número
   explícitamente).

## 7. Dos decisiones de contrato que este borrador dispara (para el dueño/orquestador)

1. **`§0-Q` debe declarar el dominio de los `?sort=` y `?range=`.** Hoy `§0-Q punto 4` solo registra
   el de `bounties`. Migrarlos a clase R exige que su lista cerrada esté **en el contrato** (ya vive
   en `API_CONTRACT §3` como prosa; hay que promoverla a dominio declarado). Es cambio de contrato
   ⇒ decisión del arquitecto/dueño, no de un stream.
2. **`?kind=` y `?scope=` no son enums de Prisma 1:1.** Son subconjuntos semánticos (clase R) cuya
   `allowed` hay que **fijar literal** con su cláusula. Confirmar que el dominio propuesto
   (`{guest_direct_ship, vault_withdrawal}` para `kind`) es el correcto y completo.

**Nada de esto toca dinero.** Es coherencia de API (un filtro que miente ⇒ `400` honesto). El único
matiz de riesgo es el de `EQ-D0` ya cerrado: los ejes que hoy responden `200`-que-miente en pantalla
de **cliente** (no de operador) tienen prioridad — pero de los 16 restantes, el peor era el de
finanzas (`?report=`, ya en su ficha `EQ-D0b`); el resto son clamp de operador (molesto, no
peligroso).

---

*Fin del borrador. La clase por eje (§5) y las dos decisiones de contrato (§7) quedan a revisión del
dueño/orquestador antes de que cada stream migre su eje.*
