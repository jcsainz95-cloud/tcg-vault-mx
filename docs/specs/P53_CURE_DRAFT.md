# P-53 · Cura del ritmo de escritura de `PriceReference` — BORRADOR DE DISEÑO

> **Rol:** arquitecto. **Estado:** borrador para triple veredicto (QA + techlead + seguridad) y decisión del dueño.
> **Base medida:** `origin/production` = `187b1d40` (HOY, 2026-09-17). Cada afirmación de estado lleva su `fichero:línea`.
> **Alcance:** SOLO diseño. No toca `backend/src/`. Enruta la implementación a **backend** (módulos `catalog`, `pricing`) con el protocolo «plano + prueba que falla».
> **Regla que manda:** si algo de este borrador choca con el código medido, gana el código y se anota. Ver §0.

---

## 0 · Qué medí, y las tres correcciones al contexto de arranque

El orquestador midió sobre `origin/production` y su diagnóstico de causa raíz es **correcto**. Al leer el código encontré **tres matices que cambian el diseño** y que aquí mandan sobre el enunciado original (regla «gana lo que leo»):

### 0.1 · CORRECCIÓN money-critical: «el valor cambió» se mide sobre `priceUsdCents`, NO sobre `priceMxnCents`
El escritor de singles calcula `priceMxnCents = usdToMxnCents(marketUsdCents, fx.rate, fx.bufferPct)` (`card-product-resolver.service.ts:217`), con `fx.rate` = tipo de cambio Banxico **del día**. El USD puede no moverse y aun así `priceMxnCents` **cambia a diario** porque el peso se mueve. **Consecuencia dura:** si el predicado «cambió» se define sobre `priceMxnCents` (como sugería la idea 4 del arranque, «priceUsdCents/priceMxnCents/fx»), **no se colapsaría casi ninguna fila** y la cura no recortaría disco. ⇒ El predicado de cambio se define sobre **`priceUsdCents`** (la señal de mercado cruda del proveedor). La deriva de FX **no es** un cambio de precio de carta: es una conversión derivada.

### 0.2 · CONFIRMACIÓN de que congelar `priceMxnCents` es inocuo para las lecturas vivas
Toda lectura viva recompone MXN desde `priceUsdCents × FX vigente` vía `PricingService.liveMxnCents` (`pricing.service.ts:719-725`): el `priceMxnCents` almacenado es **solo fallback** cuando no hay FX, `priceUsdCents` es null, o la fila es override manual. Lo usan `getReference`/`getReferencesBatch`/valuación de bóveda/cotizador/admin (`pricing.service.ts:784,862,916,973,1062,1617`; `master-set.service.ts:763`). ⇒ **Dejar `priceMxnCents` congelado en la fila del último cambio NO afecta ninguna cotización ni valuación viva** — recomponen desde el USD, que sí conservamos vigente. El ÚNICO consumidor del `priceMxnCents` almacenado de una fila de singles es la rama histórica `asOf` de `computeSetValue` (`set-value.service.ts:232`), y esa rama solo la invoca el job del snapshot diario con `asOf = hoy` (`set-value.service.ts:332`). Ver §4.

### 0.3 · CORRECCIÓN de alcance: `stale()` gobierna la ruta GRADED, disjunta de singles
El gate de frescura `isStaleByOrigin`/`isStaleRef`/`usable()` (`graded-estimate.ts:818-880`, consumido en `pricing.service.ts:1604`) se aplica **solo a los estimados graded** (`gradeKey = graded:PSA:N`). El precio de **singles de mercado** (`gradeKey = raw:NM`, `source = tcgcsv_singles`) que alimenta valor de set / cotizador **NO pasa hoy por ningún gate `stale()`** — es «la referencia vigente más reciente», sin caducidad (`set-value.service.ts:184-214`). Los dos conjuntos son **disjuntos por `gradeKey`**.
⇒ La «trampa STALE» del arranque (un precio confirmado-sin-cambio se vería rancio) **no muerde a la ruta de singles hoy**. Pero el cambio normativo `stale() := evidenceDate ?? capturedDate` **sí se hace igual**, por dos razones: (a) cierra la deuda ya planificada **M43-D2** (`TECH_DEBT.md:400-406`), y (b) inmuniza por construcción cualquier extensión futura de la cura (p.ej. a graded) y cualquier superficie de frescura de singles que llegue a existir. Es seguro porque toda fila sin `evidenceDate` cae a `capturedDate` (comportamiento idéntico). Ver §3.

**Nada de esto contradice la causa raíz:** el ritmo de 28,559 filas/día viene de `upsertVariantPrice` (`card-product-resolver.service.ts:192-234`), una fila por (carta, producto, acabado) **por día**, se mueva o no el USD.

---

## 1 · El modelo de dos fechas (normativo)

| Campo | Semántica | Avanza cuando… | `null` cuando… |
|---|---|---|---|
| `capturedDate` (`@db.Date`, ya existe, `schema.prisma:1032`) | Fecha en que el **VALOR** (`priceUsdCents`) se capturó/cambió. Es el «desde cuándo rige este valor». | El `priceUsdCents` cambia respecto de la fila vigente ⇒ fila nueva. | nunca (NOT NULL). |
| `evidenceDate` (`@db.Date?`, ya existe, `schema.prisma:1061`) | Fecha en que el proveedor **CONFIRMÓ** el valor (el barrido corrió y volvió a ver ese USD). Es el «visto por última vez». | Cada día que corre el barrido y confirma el valor, cambie o no. | vía **manual** (la afirmación es del humano; su `capturedDate` ES su evidencia) y filas legadas pre-cura (backfill, §5). |

**Invariante:** para toda fila, `evidenceDate == null` ó `evidenceDate >= capturedDate`. El barrido nunca retrocede una `evidenceDate`.

`refKind` sigue **fuera** de la `@@unique` (`schema.prisma:1041-1045,1064`) y no cambia. `evidenceDate` **tampoco** entra a la `@@unique`: es un atributo mutable de la fila del último cambio.

---

## 2 · El escritor de singles (write-on-change) — reemplazo de `upsertVariantPrice`

**Sitio único:** `card-product-resolver.service.ts:192-234` (`upsertVariantPrice`, `source = tcgcsv_singles`, `productType = 'raw'`, `gradeKey = 'raw:NM'`, `refKind = market`). Es el **único** escritor que cambia. Pseudocódigo normativo:

```
upsertVariantPrice(cardId, cardProductId, finish, marketUsdCents, fx):
  today := today()                                   // fecha de negocio, misma convención @db.Date
  key0 := { cardId, productType:'raw', gradeKey:'raw:NM', finish, cardProductId }   // clave SIN capturedDate

  // 1) Fila VIGENTE = la más reciente de esa (carta,producto,acabado). MONEY-REF-EXEMPT
  //    (lectura de la clave de un escritor, no de candidatas de precio).
  current := priceReference.findFirst({ where: key0, orderBy: { capturedDate: 'desc' } })

  // 2) Override manual manda (§4.27f) — idéntico a hoy: no se clobbea, no se toca evidenceDate.
  if current?.isManualOverride: return

  // 3) ¿El VALOR (USD) es el mismo que la fila vigente? → confirmar, NO insertar.
  if current != null AND current.refKind == market
       AND current.priceUsdCents == marketUsdCents
       AND current.fxBufferPct == fx.bufferPct:            // ver nota (b)
    if current.evidenceDate == null OR current.evidenceDate < today:
      priceReference.update({ where:{id:current.id}, data:{ evidenceDate: today } })   // 0 filas nuevas
    return

  // 4) Cambió (o no había fila, o la vigente es estimado): fila NUEVA del día.
  priceMxnCents := usdToMxnCents(marketUsdCents, fx.rate, fx.bufferPct)
  priceReference.create({ data: {
     ...key0, capturedDate: today, evidenceDate: today,
     source:'tcgcsv_singles', priceUsdCents: marketUsdCents, fxRate: fx.rate,
     fxBufferPct: fx.bufferPct, priceMxnCents, isManualOverride:false, refKind: market } })
```

**Notas de diseño (cada una con su porqué):**
- **(a) Por qué `create` y no `upsert`:** la `@@unique` incluye `capturedDate`. En un día de cambio, `capturedDate = today` es nuevo ⇒ no colisiona. En un día sin cambio no insertamos nada ⇒ no hay clave que colisione. El `upsert` por-día actual **es justo lo que genera la fila diaria**; se elimina.
- **(b) `fxBufferPct` entra al predicado de igualdad; `fxRate` NO.** El colchón es un dial de negocio: si cambia, el MXN cotizado cambia ⇒ es un cambio real ⇒ fila nueva (conservador, money-safe). El `fxRate` es deriva diaria de FX y se recompone en lectura (§0.2) ⇒ **no** dispara fila nueva. Excluir `fxRate` del predicado es lo que hace que la cura recorte disco (§0.1).
- **(c) La fila vigente conserva su `priceMxnCents`/`fxRate` del día del cambio.** No se reescriben en el día-sin-cambio (§0.2 lo hace inocuo). Solo avanza `evidenceDate`.
- **(d) Concurrencia:** el `set-price-sync` corre secuencial por set (un job); no hay dos escritores del mismo `key0` a la vez. Si se paraleliza en el futuro, `findFirst`+`create` sin lock puede dejar dos filas del mismo `capturedDate`+valor — inocuo (la dedup de §6 las colapsa) y nunca money-unsafe (ambas son el mismo valor de mercado). Se documenta como cota conocida.

---

## 3 · `stale()` en TODOS sus llamadores

**Cambio normativo:** el predicado mide contra **`evidenceDate ?? capturedDate`**, no contra `capturedDate` sola. La cota (decisión 61, `freshnessDays ≤ 60`; `graded_estimate_freshness_days = 30`) **NO se toca** — cambia QUÉ FECHA se mide, no el umbral.

**Firma base** (`graded-estimate.ts:774`): `isStaleEstimate(dateStr, today, freshnessDays)` **no cambia** — sigue recibiendo un string. La regla `evidenceDate ?? capturedDate` se aplica **en el punto donde se extrae la fecha de la fila**. Enumeración de llamadores y qué cambia en cada uno:

| Llamador | Fichero:línea | Qué recibe hoy | Qué debe recibir | Efecto |
|---|---|---|---|---|
| `isStaleRef` (wrapper con input completo) | `graded-estimate.ts:818-824` | `e.capturedDate` | `e.evidenceDate ?? e.capturedDate` | `GradedEstimateInput` gana campo `evidenceDate?: string \| null`. |
| `isStaleByOrigin` (wrapper por-fila) | `graded-estimate.ts:839-852` | `capturedDate` param | añadir param `evidenceDate?: string\|null`; medir `evidenceDate ?? capturedDate` | punto único de verdad. |
| `getGradedEstimatesBatch` (ruta graded de lectura) | `pricing.service.ts:1604` | `r.capturedDate.toISOString()` | `(r.evidenceDate ?? r.capturedDate).toISOString()` + `select: { evidenceDate:true }` | graded: hoy `evidenceDate=null` ⇒ **idéntico**. |
| `usable()` (helper compartido) | `graded-estimate.ts:873,979` | vía `isStaleRef` | vía `isStaleRef` (hereda) | idéntico. |
| Gate de ESCRITURA graded (parser) | `pokemonpricetracker-bulk.provider.ts:1274` | `evidenceDate` (ya, del proveedor) | **sin cambio** | ya mide contra evidencia; es el otro lado del criterio 109. |

**Seguridad del cambio:** hoy `evidenceDate` es `null` en el 100% de las filas (`TECH_DEBT.md:402`), así que `evidenceDate ?? capturedDate === capturedDate` ⇒ **cero cambio de comportamiento el día del despliegue**. El comportamiento nuevo solo emerge para filas de **singles** que el escritor de §2 empiece a confirmar (y singles no pasa por `stale()` hoy, §0.3) y para filas **graded** si en un futuro se cablea su `evidenceDate` (§8, opcional). La ruta manual: `isManualOverride ⇒ evidenceDate = null ⇒ cae a capturedDate`, que es exactamente lo que el criterio 109 pide para manual (`graded-estimate.ts:846-849`). **`isBetterRef` y §4.27f-2 no se tocan** (el filtro de rancio vive fuera del comparador).

---

## 4 · Impacto en las series de valor (portafolio y sets) — «no se fabrican puntos»

**Hallazgo clave que desactiva el miedo:** las series **no son «una fila de `PriceReference` por día»**. Son tablas de snapshot dedicadas que un cron llena a diario y relee:
- **`SetValueSnapshot`** — un punto/día/set, escrito por `snapshotFeaturedSet` (`set-value.service.ts:319-343`), leído por `valueHistory` (`:250-259`). Cron `set-value-snapshot` `15 7 * * *` (`scheduler.service.ts:163`).
- **`PortfolioSnapshot`** — un punto/día/usuario, escrito por `PortfolioSnapshotJobService` (`portfolio-snapshot.service.ts:51-72`), reutilizando `VaultService.holdings()`.

Estos jobs **siguen corriendo a diario** con o sin la cura ⇒ **la serie sigue teniendo su punto por día; no se deja de fabricar ningún punto y no se inventa ninguno**. El forward-fill ya existe: `computeSetValue` toma «la referencia vigente MÁS RECIENTE con `capturedDate <= asOf`» (`set-value.service.ts:157-214`, `orderBy capturedDate desc`), que es **exactamente** leer la fila vigente por fecha sin inventar valores. Con una fila por CAMBIO en vez de por día, `computeSetValue` devuelve **el mismo resultado** sobre los mismos datos (la fila del último cambio sigue siendo la más reciente `<= asOf`).

### 4.1 · La ÚNICA regresión real, y su arreglo de una línea (money-critical)
`snapshotFeaturedSet` llama `computeSetValue(set.id, asOfDate = today())` **con `asOf`** (`set-value.service.ts:332`), y la rama `asOf` usa `r.priceMxnCents` **congelado** (`:232`). Hoy eso equivale a la FX del día porque el ingest reescribe la fila cada día con la FX de hoy. **Con la cura, el día-sin-cambio no reescribe la fila** ⇒ el snapshot leería el `priceMxnCents` congelado en la FX del último cambio de USD ⇒ **la serie de valor del set dejaría de seguir la FX diaria**.

**Arreglo (normativo, backend):** el punto de HOY es un valor VIVO, no histórico. El job debe computarlo con **FX viva**. Dos formas equivalentes:
- **(preferida)** `snapshotFeaturedSet` llama `computeSetValue(set.id)` **sin `asOf`** ⇒ rama `liveMxnCents` (`:232`, recompone MXN desde USD × FX viva). El punto del día queda idéntico al comportamiento actual.
- (alternativa) mantener `asOf` pero forzar recomputación viva para `asOf == today`.

Justificación de que es correcto: `computeSetValue(asOf)` **solo** se invoca con `asOf = hoy` (único llamador: `:332`); no existe reconstrucción de fechas pasadas. La rama congelada `asOf` queda como código para un uso que hoy no ocurre; se puede conservar o marcar como no-usada. Los puntos **históricos** ya escritos en `SetValueSnapshot` **no se recomputan** ⇒ la cura no reescribe la historia.

### 4.2 · Enumeración de sitios lectores y qué cambia en cada uno

| Sitio lector | Fichero:línea | Lee | ¿Cambia con la cura? |
|---|---|---|---|
| `computeSetValue` (valor vivo y snapshot) | `set-value.service.ts:173-237` | ref vigente más reciente `<= asOf` | **Sí, mínimo:** el job que lo llama pasa a FX viva (§4.1). El algoritmo de selección es idéntico. |
| `valueHistory` / `featuredSetHistory` / `setHistoryById` | `set-value.service.ts:244-317` | `SetValueSnapshot` (tabla dedicada) | **No** (relee snapshots ya escritos). |
| `PortfolioSnapshotJobService` | `portfolio-snapshot.service.ts:51-72` | `VaultService.holdings()` | **No, si `holdings()` usa `liveMxnCents`** (recompone FX viva). ⚠️ backend **verifica** que `holdings()` no lea `priceMxnCents` congelado de refs raw; el indicio dice que sí recompone (`master-set.service.ts:763` «`getReferencesBatch` YA aplica `liveMxnCents`»). Si NO, aplicar el mismo arreglo de §4.1. |
| `hasRecentIngest` (catch-up al boot) | `price-ingest.service.ts:453-465` | `PriceReference.capturedDate >= ayer` | **Sí, ROMPE si no se arregla.** Ver §4.3. |
| `sealedValueHistory` (gráfica de sellado) | `sealed-catalog.service.ts:369-413` | `PriceReference` crudo, un punto/`capturedDate` | **No** — el escritor de **sellado NO se toca** (§7). Asume una fila/día y la sigue teniendo. |
| Cotizador / valuación / admin | `pricing.service.ts:784,862,916,973,1062`; `master-set.service.ts` | `liveMxnCents` desde `priceUsdCents` | **No** (recomponen FX; el USD vigente se conserva, §0.2). |

### 4.3 · `hasRecentIngest` — arreglo obligatorio (fail-open operativo si se omite)
`hasRecentIngest` (`price-ingest.service.ts:453-465`) responde «¿corrió el barrido de mercado?» buscando una fila **no-manual** de mercado con `capturedDate >= ayer`. **Con la cura, un barrido que confirma precios sin cambios NO escribe ninguna fila con `capturedDate` de hoy** ⇒ `hasRecentIngest` devolvería `false` ⇒ el catch-up del boot **re-dispararía el barrido creyendo que nunca corrió** (bucle de trabajo inútil, o peor, doble escritura).
**Arreglo (normativo):** la pregunta correcta es «¿el barrido **confirmó** algo hoy/ayer?», que es exactamente `evidenceDate`. Cambiar el `where` a `{ evidenceDate: { gte: since }, isManualOverride: false, ...MONEY_REF_WHERE }`. (Las filas manuales tienen `evidenceDate = null` y ya se excluyen por `isManualOverride:false`; las legadas pre-cura tienen `evidenceDate=null` pero `since` es hoy/ayer, así que solo cuentan filas recién confirmadas.)

---

## 5 · Migración / backfill

- **DDL:** **NO hace falta.** Las dos columnas ya existen (`refKind` y `evidenceDate`, migración `v1.50.3-f`, `schema.prisma:1049,1061`; `TECH_DEBT.md:402`). Cero ventana de migración de schema.
- **Backfill de `evidenceDate` — OBLIGATORIO y money-critical (ésta es la trampa que el arranque señaló).** Tras la cura, la fila de singles que sobrevive a la dedup (§6) tendrá `capturedDate` = día del último cambio de USD (puede ser de hace semanas) y `evidenceDate = null`. Si `stale()` (o cualquier superficie de frescura futura) la lee con `evidenceDate ?? capturedDate`, vería `capturedDate` viejo ⇒ **RANCIA** aunque el barrido la confirme a diario. Para evitarlo, el backfill fija, **en la fila más reciente de cada `key0`** (singles, no-manual, market): `evidenceDate := max(capturedDate del run de valor idéntico)`. Dado que el barrido corrió a diario, ese `max` es «ayer/hoy» ⇒ la fila queda fresca. Se ejecuta **dentro** del mismo paso que la dedup (§6), que ya calcula ese `max`.
- **Orden de despliegue seguro:** (1) desplegar el código nuevo (escritor §2 + `stale()` §3 + `hasRecentIngest` §4.3 + snapshot §4.1) — desde ese instante deja de crecer; (2) correr backfill+dedup (§6) para reclamar el mes acumulado. Entre (1) y (2), el sistema es correcto pero el disco aún trae la basura vieja (no urge; el reloj ya se detuvo).

---

## 6 · Poda / dedup de filas redundantes ya acumuladas (money-critical, con sus 3 veredictos)

**Ahora SÍ aplica** (a diferencia de septiembre): hay ~1 mes de filas redundantes de singles. Objetivo: recuperar espacio **sin borrar ningún punto de cambio real** ni romper ninguna serie.

### 6.1 · Predicado exacto
Alcance: SOLO filas **de singles de mercado** — `source = 'tcgcsv_singles'` **AND** `productType='raw'` **AND** `gradeKey='raw:NM'` **AND** `refKind = market` **AND** `isManualOverride = false`. (Excluye manual, graded, sellado, y cualquier `refKind` no-market.)

Agrupar por `key0 = (cardId, productType, gradeKey, finish, cardProductId)`, ordenar por `capturedDate` asc. Un **run** es una secuencia **contigua** de filas con el mismo `(priceUsdCents, fxBufferPct)`. Para cada run `[f0, f1, …, fk]` (f0 = el más antiguo, el punto de cambio):
- **CONSERVAR `f0`** y fijar `f0.evidenceDate := fk.capturedDate` (la última confirmación de ese valor).
- **BORRAR `f1 … fk`.**

Es decir: se colapsa cada run de valor idéntico a **su primera fila** (el cambio), preservando `capturedDate` como «desde cuándo rige» y trasladando la última confirmación a `evidenceDate`. **Cada punto de cambio de USD sobrevive como una fila propia.**

### 6.2 · Por qué es seguro (invariantes)
- **No se borra ningún cambio:** dos runs distintos = dos valores de USD distintos = dos filas conservadas. La serie de «valor vigente por fecha» (`computeSetValue` forward-fill) es **idéntica** antes y después, porque para todo `asOf` la fila más reciente `<= asOf` conserva el mismo `priceUsdCents` (y el forward-fill recompone MXN en vivo).
- **Historia congelada intacta:** `SetValueSnapshot`/`PortfolioSnapshot` **no se recomputan** ⇒ los puntos ya dibujados no se mueven.
- **Sellado intacto:** el predicado excluye `productType='sealed'`; `sealedValueHistory` no ve un solo cambio.
- **Manual intacto:** excluye `isManualOverride`.

### 6.3 · Verificación (los 3 veredictos miden esto, sobre copia/staging, nunca en caliente)
- **Predicado de conteo (antes):** `SELECT count(*)` del alcance 6.1 y del subconjunto borrable (`f1…fk`). Es el ahorro esperado (~28k/día × días acumulados menos los cambios reales).
- **Predicado de invariante de serie (el que muerde):** para una muestra de sets, `computeSetValue(set, asOf)` para varios `asOf` del rango **produce el mismo total** con la tabla podada que con la tabla completa (comparación sobre copia). Y el `SetValueSnapshot` recomputado para hoy es idéntico bit a bit al que produce el escritor nuevo (§ pruebas T-8).
- **Predicado de no-pérdida de cambios:** `count(DISTINCT (cardId, cardProductId, finish, priceUsdCents-en-secuencia))` no cambia (los puntos de cambio conservados == los distintos valores contiguos previos).
- **Ejecución:** en **lotes** (por set o por rango de `capturedDate`) para no bloquear la tabla; medir espacio con `pg_total_relation_size('"PriceReference"')` antes/después; y **`VACUUM (o el equivalente gestionado de Railway)`** para devolver el espacio al disco (borrar filas no reduce el fichero por sí solo). Requiere ventana con respaldo (money-critical), coordinado con **devops** (que además baja `max_wal_size`, P-53 tarea devops).
- **Precedente de borrado seguro en el repo:** `graded-estimates.controller.ts:508` (`deleteMany` acotado) ya existe como patrón de poda con `where` explícito.

⚠️ **Triple veredicto obligatorio** (QA + techlead + seguridad) sobre el SHA de la rama de implementación, antes de correr la poda en producción.

---

## 7 · Alcance: por qué la cura toca SOLO singles

| Escritor | Fichero:línea | `refKind`/tipo | Filas/día (medido `PENDIENTES.md:174`) | ¿Cambia? |
|---|---|---|---|---|
| Singles de mercado | `card-product-resolver.service.ts:192-234` | raw:NM market, tcgcsv_singles | **28,559** | **SÍ** (§2). |
| Graded PSA | `pricing.service.ts:~2400` (`persistGradedEstimateReference`) | graded:PSA:N | 18 | **No** (opcional §8). |
| Sellado de mercado | `pricing.service.ts:~2240` | sealed market | pocas | **No** — su lector `sealedValueHistory` asume 1 fila/`capturedDate` (`sealed-catalog.service.ts:399/413`); convertirlo exigiría reescribir ese lector a forward-fill. Volumen despreciable ⇒ no vale el riesgo. |
| Override manual | `pricing.service.ts:2500-2569` (`persistManualOverride`) | market/estimate, isManualOverride | mínimas | **No**. |

Concentrar la cura en el escritor que aporta el **99.9%** del volumen es la decisión de menor riesgo y mayor recorte.

---

## 8 · Extensión OPCIONAL (separada, no requerida para el disco): cablear `evidenceDate` en graded
La deuda **M43-D2** (`TECH_DEBT.md:400-406`) pide, para cerrar el criterio 109 **al pie de la letra** (hoy vía cota conservadora `≤ 60 d` aceptada por el dueño, decisión 61): (a) `persistGradedEstimateReference` persiste la `evidenceDate` que el parser **ya trae** (`pokemonpricetracker-bulk.provider.ts:234,1291`), y (b) `stale()` mide contra `evidenceDate ?? capturedDate` — que **este diseño ya hace en §3**. Si el dueño quiere el cierre exacto, (a) es un añadido pequeño y **separable** de la cura de disco. **No bloquea P-53** y **no toca** `graded_estimate_freshness_days` (se queda en 30; ver `TECH_DEBT.md:406`). Se ofrece; no se asume.

---

## 9 · Criterios de aceptación exactos

- **CA-1.** Día 2, mismo `priceUsdCents` (y mismo `fxBufferPct`) que la fila vigente ⇒ **0 filas nuevas**; la fila vigente avanza su `evidenceDate` a hoy; `capturedDate` y `priceMxnCents` sin tocar.
- **CA-2.** `priceUsdCents` cambia ⇒ **1 fila nueva** con `capturedDate = evidenceDate = today`; la anterior queda intacta (su `evidenceDate` = el día en que dejó de confirmarse).
- **CA-3.** Solo la FX del día se movió (mismo USD) ⇒ **0 filas nuevas** (CA-1); las cotizaciones/valuaciones vivas siguen reflejando la FX de hoy (recomputan desde USD).
- **CA-4.** Override manual vigente en `key0` ⇒ el escritor de singles **no escribe ni bump-ea `evidenceDate`** (§4.27f respetado).
- **CA-5.** Precio confirmado hoy pero cuyo valor no cambia desde hace 40 días ⇒ `evidenceDate = hoy` ⇒ **NO stale** con `freshnessDays = 30/60` (el trap del arranque, resuelto vía §3+§5).
- **CA-6.** `hasRecentIngest` devuelve `true` tras un barrido que confirmó precios **sin** escribir filas nuevas (mide `evidenceDate`, §4.3).
- **CA-7.** La serie de valor de un set (`computeSetValue` para varios `asOf`) es **idéntica** antes y después del cambio de escritor **sobre los mismos datos**; y **idéntica** antes y después de la poda (§6).
- **CA-8.** El punto de `SetValueSnapshot` de HOY tras la cura == el que producía el escritor viejo el mismo día con la misma FX (§4.1: FX viva).
- **CA-9.** La poda no cambia el número de puntos de cambio distintos por `key0` (§6.2), ni reduce filas fuera del alcance 6.1 (sellado/graded/manual intactos).
- **CA-10.** El día del despliegue (antes de que corra ningún barrido nuevo), con `evidenceDate = null` en todas las filas, **cero cambio de comportamiento** en `stale()`/frescura/series.

## 10 · Lista de pruebas que backend debe escribir (deben FALLAR si el diseño se implementa mal)

Protocolo del proyecto: el modelo fuerte escribe la prueba que falla; el barato la hace pasar. Estas son el contrato.

1. **T-1 (escritor, día idéntico):** dos corridas con el mismo USD ⇒ `count(PriceReference where key0) == 1` y `evidenceDate == día2`. **Falla** si sigue insertando fila por día.
2. **T-2 (escritor, cambio):** corrida con USD distinto ⇒ 2 filas; `capturedDate` distintos; la vieja con `evidenceDate` == su último día de confirmación.
3. **T-3 (solo FX):** mismo USD, `fx.rate` distinto ⇒ 1 fila (no nueva); `evidenceDate` avanza; `liveMxnCents` con FX nueva refleja el MXN nuevo.
4. **T-4 (manual no clobber):** fila manual vigente ⇒ el escritor de singles no la toca (ni `evidenceDate`).
5. **T-5 (`stale` con evidencia):** fila con `capturedDate` = hace 40 d y `evidenceDate` = hoy ⇒ `isStaleByOrigin/isStaleRef` = `false` con `freshnessDays=30`. Y con `evidenceDate=null` (legada) ⇒ mide contra `capturedDate` (idéntico a hoy).
6. **T-6 (`hasRecentIngest`):** tras barrido que solo confirma (0 inserts) ⇒ `true`. **Falla** si sigue mirando `capturedDate`.
7. **T-7 (dedup segura):** fixture con runs de valor idéntico y ≥2 cambios reales ⇒ la poda deja exactamente 1 fila por run, `evidenceDate = max(capturedDate)` del run, y **conserva todos los cambios**. Cero filas fuera de alcance tocadas.
8. **T-8 (invariante de serie):** `computeSetValue(set, asOf)` para un set-fixture da el **mismo** total antes/después del cambio de escritor y antes/después de la poda; y el `SetValueSnapshot` de hoy es idéntico con FX viva.
9. **T-9 (sellado intacto):** `sealedValueHistory` de una pieza fixture es byte-idéntico antes/después (regresión de que no tocamos sellado).
10. **T-10 (canario de mutación):** reintroducir «insertar fila por día» (revertir §2) debe poner T-1/T-8 en rojo; reintroducir `capturedDate` en `hasRecentIngest` debe poner T-6 en rojo.

---

## 11 · Delta de contrato (`docs/API_CONTRACT.md`) — BORRADOR (no editar el normativo aún)
- **`GET /catalog/featured-set/value-history`, `GET /catalog/sets/:id/value-history`, `GET /vault/portfolio/history`, `GET /catalog/sealed/:id/value-history`:** **contrato sin cambios** (mismos campos, misma forma). La serie sigue siendo un punto/día. Se añade una **nota semántica**: el `valueMxnCents` del punto vivo recompone FX en cada lectura; los puntos históricos conservan la FX con que se snapshoteó (sin cambio respecto de hoy).
- **DTOs de estimado/preview** (`gradedEstimatePreview`, censo `?reason=STALE`): **sin cambios de forma.** `capturedDate` y `stale` siguen expuestos; internamente `stale` pasa a medirse contra `evidenceDate ?? capturedDate` (transparente al cliente; hoy idéntico porque `evidenceDate=null`).
- **Sin endpoints nuevos, sin campos nuevos en respuestas.** El cambio es de motor de escritura y de un predicado interno.

## 12 · Delta de `docs/ARCHITECTURE.md` — BORRADOR (no editar el normativo aún)
- **§4.12 / §4.12a (valor de set y su serie):** documentar que la serie NO depende de «una fila/día» de `PriceReference` sino del snapshot diario + forward-fill (`capturedDate <= asOf`), y que el punto vivo del snapshot usa **FX viva** (§4.1 de este borrador). Regla «no se fabrican puntos»: se conserva — el cron fabrica el punto/día leyendo la fila vigente; nunca inventa un valor.
- **§4.27 (escritura de referencias de singles):** reemplazar la descripción del `upsert` por-día por el **write-on-change** de §2 (predicado sobre `priceUsdCents` + `fxBufferPct`; `evidenceDate` avanza en confirmación).
- **§4.38m.2 (frescura / criterio 109):** `stale()` pasa a `evidenceDate ?? capturedDate` (§3); la cota `≤ 60 d` (decisión 61) intacta. Mueve M43-D2 de «pendiente (b)» a «hecho»; (a) graded queda opcional (§8).
- **§9 (Desviaciones detectadas):** anotar la cota de concurrencia del escritor (§2 nota d) y la rama `asOf` congelada de `computeSetValue` que queda sin llamador vivo (§4.1). Si backend confirma que `holdings()` recompone FX, no hay desviación en portafolio; si no, se registra y se arregla igual que §4.1.
- **§11 (migraciones):** **ninguna nueva** (columnas ya existen). Backfill de `evidenceDate` + poda (§5, §6) se registran como **operación de datos** con ventana y respaldo, no como migración de schema.

---

## 13 · Decisiones abiertas para el dueño (lenguaje llano)

1. **La gráfica de valor de un set, cuando el peso se mueve pero el precio en dólares no:** hoy la gráfica se mueve a diario con el tipo de cambio. Con la cura, si mantengo el arreglo de §4.1 (FX viva), **se sigue comportando exactamente igual** (se mueve con el peso). ¿Confirmas que quieres que la gráfica siga reflejando el tipo de cambio del día? (Recomiendo sí; es lo que hace hoy.)
2. **Limpieza del mes acumulado:** para recuperar el espacio que ya se gastó hay que borrar filas redundantes y compactar la tabla. Eso pide **una ventana con respaldo** (unos minutos, coordinado con devops, que de paso reduce el archivo de bitácora). ¿Autorizas esa ventana una vez que los tres veredictos aprueben?
3. **El cierre «al pie de la letra» de la frescura de las cartas graduadas (§8):** es un extra pequeño y separado del arreglo del disco. ¿Lo hacemos en el mismo release o lo dejamos para después? (No urge; la cota de 60 días que ya aceptaste sigue cubriéndonos.)

---

*Fin del borrador. Enrutar a backend (catalog, pricing) con protocolo plano+prueba; triple veredicto antes de producción; poda con ventana y respaldo coordinada con devops.*
