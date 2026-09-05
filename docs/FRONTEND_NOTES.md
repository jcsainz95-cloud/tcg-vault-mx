# FRONTEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **frontend**. Decisiones de implementación del cliente Next.js.
> Fecha: 2026-08-13. Branch: `claude/tcg-cards-marketplace-oijthj`.
> El contrato (`docs/API_CONTRACT.md`) y el sistema de diseño (`docs/DESIGN_SYSTEM.md`) mandan.

## §44 · El ciclo de compra entra al gate real: 23 pruebas que nadie corría, el `total` que se tiraba y un rótulo que prometía la regla del servidor (2026-09-02)

> **Renumerada de §27 a §44 al absorber `main` (2026-09-05).** La rama la había abierto como «§27»
> cuando §27 era el último número del fichero; `main` traía **§28…§43** ya escritas, así que «§27»
> pasó a resolver a **dos** secciones distintas. Se conserva arriba —el orden físico del fichero es
> el que había— y solo cambia el número. El §27 original (cierre del stream de grading, 2026-08-29)
> es el de más abajo y no se toca.

> Rama `claude/buylist-inventory-workflow-hdnls3`, sobre `235b7f9`. Tres encargos del cierre del
> stream: **(1)** taguear `@real` las pruebas de UI del ciclo ahora que la semilla tiene dato,
> **(2)** pintar el `total` de la cola de publicar (deuda **D5** del techlead) y **(3)** dejar de
> prometer la regla de días hábiles del servidor en `caducityTone`.

### 1. Los 23 casos del ciclo no los corría **nadie** — y por dos razones encadenadas

`buylist-offer.spec.ts` (6) y `admin.spec.ts` (17) no entraban al gate real por **dos** motivos que
se tapaban mutuamente:

1. **Ninguno llevaba `@real`.** En modo real `playwright.config.ts` filtra con `grep: /@real/`, así
   que el «verde» de esos dos archivos se medía **solo contra los fixtures del propio front**.
2. **Y aunque lo hubieran llevado, se habrían saltado:** todos abrían con `needsSeed(...)`, que es
   `test.skip(IS_REAL, …)`. La semilla no creaba **ninguna** `SellRequest`.

Con el seed de v1.51.20 (una `cotizada` y una `ofertada` con la oferta emitida, `netCents=32000`) el
dato existe. **Se tagearon 12 de los 23** — los que el seed satisface **y** que no dejan huella:

| Archivo | `@real` nuevos | Qué cubren |
|---|---|---|
| `buylist-offer.spec.ts` | **5** de 6 | los tres montos + condición NM + plazo con fecha; que no hay cherry-pick ni contraoferta; el estado **previo** a la oferta; el `404` neutro de una solicitud ajena; el CTA del correo sin sesión |
| `admin.spec.ts` | **7** de 17 | dashboard (la puerta); **mesa de decisión** ×2 (los cuatro sumandos separados · la sugerencia no bloquea); cola «vendedores vivos»; cola «listas para publicar»; «Piezas rechazadas» sin convertir; spreads de sellado (T-1) |

#### 1.a Lo que **no** se tagueó, y por qué (para que nadie lo lea como olvido)

- **`aceptar la oferta` — el único que se deja fuera a sabiendas.** **Consume** la oferta
  (`ofertada` → `aceptada`). El seed siembra **una sola**, compartida con los otros dos casos del
  archivo: tagueárlo los dejaría verdes-por-`skip` según **qué worker gane la carrera**
  (`fullyParallel: true`) y sin dato en **todas las corridas siguientes**. *Un caso destructivo
  sobre un dato singleton no es cobertura: es una bomba de relojería en el gate.* Sigue vivo contra
  los fixtures, que sí son reponibles. **Petición al backend abajo.**
- **Tres colas vacías** (`offers/pending-authorization`, `pending-shipment-confirmation`,
  `guides/pending-cancellation`): los endpoints **ya existen** (BL-28 los sacó del `404`), pero el
  seed no siembra filas — verificado contra el stack, `total: 0` en las tres. Se **reclasificaron de
  `mockOnly` a `needsSeed`**, que es la clasificación honesta: *«el test está bien, falta el dato»* es
  una petición accionable; *«esto solo corre con mocks»* esconde el hueco. (Además, «guías por
  cancelar» **confirma** la cancelación: contra el stack consumiría la fila.)
- **Dos casos de cherry-pick** (`admin.m5` aprobar/ajustar/rechazar por ítem): necesitan una
  solicitud en `recibida`/`verificacion`, y llegar ahí exige recorrer aceptar → guía → «ya lo mandé»
  → confirmar → recibir. Verificado: `GET /admin/buylist?status=verificacion` → `total: 0`.
- **M8 disputas:** `GET /admin/disputes` → `total: 0`.
- **Dos genuinamente mock-only:** el switcher «Ver como» (afordancia de demo; en real el rol lo dicta
  el JWT) y la fila `positionUnavailable` (estado fabricado).

#### 1.b Dos cambios de arnés que hacen falta para que el tag signifique algo

**(i) Se busca por ESTADO, nunca por POSICIÓN.** `openRequestWhere(page, …)` recorre «Mis
solicitudes» hasta encontrar la que el caso necesita. Antes, «sin oferta todavía» abría **la primera
fila** y se saltaba si traía oferta — lo que obligaba a que el orden de creación del seed fuera
normativo.

> ⚠️ **Y ese orden ya no se sostiene, con o sin mi cambio.** El propio subset `@real` **crea una
> `SellRequest` en cada corrida**: `buylist.spec.ts:680` (`@real vender`) hace `POST
> /buylist/requests` de verdad. Verificado en la BD tras una corrida: la fila más nueva es la del
> smoke, no la del seed. Es decir, **la primera corrida real rompe la invariante que el seed
> documenta como normativa** (`BACKEND_NOTES §v1.51.20`: *«el orden de creación es normativo […] la
> suite del portal exige que la primera fila no tenga oferta»*). Buscar por estado no es una
> preferencia de estilo: es lo que hace la suite **repetible**. *Una suite que depende del orden del
> seed mide el seed, no el producto.*

**(ii) No encontrar el dato es ROJO, no `skip`.** `openOfferedRequest`, `openPreOfferRequest` y
`openDesk` **lanzan** con un mensaje que dice qué falta y quién lo siembra. Un `skip` ahí solo podría
significar que el dato se perdió — exactamente lo que el gate tiene que gritar. `openDesk` dejó de
devolver `boolean` por el mismo motivo.

**(iii) Dos asserts se reescribieron contra el INVARIANTE, no contra el fixture** (era la condición
para poder taguearlos):

- **«vendedores con solicitudes vivas»:** afirmaba el literal `5555123456` y exigía que coexistieran
  una fila con teléfono y otra sin él — cierto solo en mocks. Ahora afirma lo que D12 protege y vale
  en los dos entornos: **cada fila resuelve la columna del teléfono** —el número **o** «Sin
  teléfono»— y **nunca la deja en blanco**. Un hueco es el fallo real: el operador no sabe si el
  vendedor no dio teléfono o si la pantalla se lo comió.
- **«listas para publicar»:** exigía que coexistieran una pieza sin ubicación y otra sin precio
  (contra el stack **todas** tienen precio resoluble). Ahora afirma los tres invariantes del caso:
  **cada fila dice qué le falta**, **nunca `MX$0.00`**, **ningún botón de publicar**.

### 2. D5 — el `total` de la cola de publicar (`PendingPublishQueue.tsx`)

El componente **descartaba** el `total` del servidor. La razón por la que eso importa es económica:
ese conteo **se paga con un barrido completo del inventario** —la precedencia de precio se evalúa
fila por fila en memoria (`BLC-D1`)— y **el único consumidor lo tiraba**. Se cobraba el barrido y no
se pintaba el resultado.

Se pinta junto al título. Dos decisiones:

- **Es `total`, no `data.length`.** La respuesta viene paginada (`pageSize: 20`); `data.length`
  contesta *«cuántas caben en esta página»*, que no es una pregunta que nadie tenga. Verificado
  contra el stack: `total: 13`.
- **`total` ausente NO se degrada a `data.length`.** Misma doctrina que `MissingCell` y que el conteo
  ausente de la mesa (§23.7): un número del tamaño de la página *se ve igual de confiable* que el
  bueno y **miente hacia abajo justo cuando la cola es grande**, que es cuando el número importa.
  Sin `total` no se pinta contador; las filas se listan igual.
- **El cero se dice con palabras** («Ninguna pendiente»), no como `0 pendientes`.

*(La paginación sigue sin construirse: el encargo era pintar el número, no construir la navegación.)*

### 3. `caducityTone` — un rótulo que prometía una regla que el front no tiene

`BuylistCycleQueues.tsx` rotulaba la función *«Un día hábil o menos»* y medía una **ventana rodante
de 24/48 horas**. Dos imprecisiones en direcciones distintas:

1. **Prometía la regla del servidor.** `caducityAt` lo deriva el backend con
   `addBusinessDays(offerIssueClockStartedAt ?? createdAt, buylistOfferIssueDeadlineBusinessDays)`:
   sabe de fines de semana y festivos, y **lanza** fuera de la cobertura de su calendario en vez de
   degradar. El front no tiene ese calendario y **no lo va a reimplementar** — es la prohibición que
   `formatDateTimeMx` ya declara (*el front no recalcula el plazo, solo lo formatea*). *Una segunda
   aritmética de días hábiles sería una segunda fecha límite.*
2. **Ni siquiera acertaba el copy visible.** A las 23:00, una fila que muere **mañana** a las 22:00
   cae dentro de las 24 h y se rotulaba **«Caduca hoy»**.

**Arreglo:** el tono se calcula sobre el **día del calendario en `America/Mexico_City`** —que es
exactamente lo que «hoy» y «mañana» significan para quien lee la cola— y el docblock dice qué mide,
qué **no** mide y que **la fecha completa con hora va siempre impresa al lado**. No se colgó de un
campo del servidor porque **no existe**: `PendingOfferAuthorizationRowDTO` trae `caducityAt` y nada
más (contrato §M5). No es un bug —es énfasis, no una puerta— pero el rótulo sí lo era.

> El fixture del unitario pasó de `Date.now() + 20 h` a `caducityOnMxDay(n)`: veinte horas caen hoy
> o mañana **según la hora a la que corra la suite**.

### 4. El código que revivió (BL-29): comprobado, no supuesto

La proyección admin pasó de 2 a 43 claves y la de cliente ganó `expiredReason`, `pickupAddress` y
`lastOfferCancelledAt`. Se verificó **contra el stack** que los nombres que el front lee existen tal
cual en la respuesta —`shipmentTrackingNumber`, `shipmentCarrier`, `expiredReason`,
`lastOfferCancelledAt`— porque el riesgo real no es que el campo no llegue: es que **llegue con otro
nombre y la rama siga muerta sin que nada falle**.

Los cuatro caminos que revivieron **estaban bien cableados** y tienen unitario que los fija:
`BuylistShipmentActions` (prefill de guía), `M5View`/`BuylistCycleQueues` (`StatusBadge` por
**motivo**, no por estado), y en el portal del vendedor `hideMoney` (`expirada ∧ no_offer` ⇒ ni una
cifra), el banner de cancelación (D42) y las tres frases de cierre. **No se pudieron observar vivos**:
el seed no llega a ningún estado terminal, cancelado ni enviado — ver la petición 2 de abajo.

### 5. Peticiones (no bloqueantes)

1. **Backend / seed — una solicitud `ofertada` DESECHABLE por corrida.** Es lo único que separa a
   `aceptar la oferta` del gate real. Alternativa equivalente: un endpoint de reset del escenario.
2. **Backend / seed — estados terminales y del tramo de envío.** Hoy no hay forma de ver vivos
   `expirada/no_offer`, `expirada/not_shipped`, `lastOfferCancelledAt` ni una guía capturada. Son
   exactamente las ramas que BL-29/BL-30 revivieron, y siguen cubiertas **solo** por unitarios.
3. **Backend / seed — filas para las tres colas vacías** (`pending-authorization`,
   `pending-shipment-confirmation`, `guides/pending-cancellation`) y una solicitud en
   `verificacion` (desbloquea los dos casos de cherry-pick). Los endpoints ya existen.
4. **Arquitecto — nada.** No hizo falta ningún campo ni endpoint fuera del contrato.

### 6. Verificación

```
npx tsc --noEmit            →  sin salida (limpio)
npm run lint                →  ✔ No ESLint warnings or errors
npm test                    →  Test Files 100 passed (100) · Tests 949 passed (949)
E2E mock (E2E_MOCK_PORT=3020, suite COMPLETA)
                            →  124 passed · 3 skipped · 0 failed
E2E real (E2E_BASE_URL=http://localhost:3000 E2E_REAL=1)
                            →  34 passed · 3 failed
```

Los **3 rojos de real son los smokes de dinero** (`checkout.spec.ts:57`, `guest-checkout.spec.ts:131`,
`shipments.spec.ts:30`): este entorno no tiene salida a Stripe (`CONNECT 403`) y están escritos para
ser rojos a propósito, no para saltarse. **Los 12 tests recién tagueados pasan los 12.**

> ⚠️ **El subset `@real` no se puede correr en otro puerto.** La allow-list de CORS del backend es
> `APP_BASE_URL=http://localhost:3000` y nada más, así que un frontend servido en :3010 recibe la
> página pero **ninguna** respuesta de la API: 34 de 37 rojos por el arnés, no por el producto.
> Corolario operativo: **para correr el gate sobre código recién tocado hay que reconstruir el
> artefacto de :3000**, no levantar uno al lado. `.gitignore` documenta la receta.

## §26 · El *breaking* de `intent`, la captura manual y la lista de revisión (contrato v1.50.2 / v1.50.3) — 2026-08-28

> Rama `claude/psa-graded-card-value-gmhv5u`, sobre `397db13`. Cierra el **bloqueante** del rechazo
> de QA + techlead, más el trabajo adicional de la rev **v1.50.3** del arquitecto.

### 1. El bloqueante: `intent` no existía **en el tipo**, así que nadie podía mandarlo

`POST /admin/pricing/override` empezó a exigir `intent` con `productType:"graded"`
(`422 GRADED_INTENT_REQUIRED`). El cliente no lo mandaba en ningún sitio — y no por descuido: el
campo **no existía en `PricingOverrideInput`**. Tres superficies vivas de dinero devolvían 422
contra el backend real: M1 › Gradeadas (la vía que el contrato llama *normativa* para el valor de
mercado por carta+grado), `VariantPriceConsole.fixMarket` con `productType="graded"` desde el cajón
de variante, y cualquier pendiente `graded` de la cola de M2.

**El arreglo no es «pasar el campo»: es que el compilador no deje NO pasarlo.**
`PricingOverrideInput` pasa de interfaz plana a **unión discriminada por `productType`**, la misma
técnica que `VariantPriceConsoleProps` ya usaba para exigir `gradeKey` en graded:

| Rama | Exige | Prohíbe |
|---|---|---|
| `{ productType: 'graded'; intent: PricingOverrideIntent }` | `intent` | — |
| `{ productType: 'raw' \| 'sealed'; intent?: never }` | — | `intent` (el contrato lo ignoraría) |

Con eso, **olvidar `intent` no compila**, y el fallo no puede repetirse por el mismo camino. Los
tres llamadores declaran **`market`**: los tres fijan el precio real de piezas publicadas. En
`PendingQueueSection` el `entry.productType` es `ProductType`, así que el body se arma **por rama**
en vez de con un spread — el compilador obliga a decidir, que es justo el punto.

`intent?: never` en raw/sealed es deliberado: el contrato dice que ahí «se ignora si viene», y un
campo que el servidor tira en silencio no debe poder escribirse.

### 2. El agujero de producto: **no existía UI capaz de mandar `graded_estimate`**

`grep -rn "intent" frontend/src` daba **cero**. La captura manual que §O.6 conserva como herramienta
de curaduría y respaldo del ingest era **inalcanzable desde el back-office**: el gancho dependía por
completo del ingest automático, que está apagado.

Nueva **Sección 5d de M2 · `GradedEstimateCaptureSection`** (`super_admin`, como todo M2):

- **Buscador de carta** sobre `GET /buylist/cards` (todo el catálogo, no solo lo publicado: la fila
  de estimado cuelga de `Card`, no del inventario).
- **Pre-vuelo** con `GET /admin/pricing/graded-estimates/preview` — endpoint que el cliente **no
  consumía** y que ya existía en contrato y backend. De ahí sale `publishedSlabGrades`: el grado con
  slab publicado se **deshabilita con el motivo a la vista**, antes de escribir.
- **Una petición por grado**, secuencial y tolerante: un `Promise.all` habría que abortarlo entero
  al primer 409 y perdería la escritura del grado legítimo. El grado que falla **conserva** lo
  tecleado; el que se guarda se limpia.
- **Money-safe:** campo vacío o `≤ 0` no se manda (no se publica una cifra de MX$0), y los campos
  vacíos no se tocan.

**Por qué el pre-vuelo no sustituye al 409.** Puede estar rancio (alguien publica un slab entre la
lectura y el guardado) y, sobre todo, `publishedSlabGrades` viaja **dentro de cada grupo raw**: una
carta sin grupo raw publicado no tiene de dónde sacarlo. En ese caso **no hay pre-vuelo** y el 409 es
la única guarda — por eso se muestra por grado, traducido y con sus `details`.

**La frontera con M1 › Gradeadas se dice en la UI, no solo en un comentario.** La misma fila la
escriben dos flujos con intenciones opuestas, así que cada superficie declara cuál es la suya: banner
`boundaryTitle`/`boundaryBody` en M2 y una línea visible (no `sr-only`, no `title`) en M1 ›
Gradeadas, más el `fixValueHelper` reescrito.

### 3. Traducciones de los códigos nuevos — y el `details` que sí se aprovecha

`GRADED_INTENT_REQUIRED`, `GRADED_ESTIMATE_SLAB_PUBLISHED`, `GRADING_SORT_REQUIRES_FILTER` y
`GRADED_CONFIG_INVALID` daban `null` en `messages/{es,en}.json` ⇒ el operador leía el volcado crudo
del backend (o el genérico).

Lo interesante es el **409**: trae `details` accionables (`publishedSlabCount`, `gradeKey`), y el
mensaje que §O.8 exige —«esta carta ya tiene N PSA 10 publicadas; eso es dinero real»— **necesita esa
cifra**. `useErrorMessage` gana una tabla `DETAILED_ERRORS`: si el código tiene variante
`error.<CODE>_WITH_DETAILS` **y** el backend mandó lo necesario, se usa el copy rico; si no, el copy
base. **Nunca** se pinta un placeholder crudo ni se inventa un número. El mapeo es explícito por
código, no mágico: un `t(key, details)` a ciegas renderizaría `{count}` en cuanto un backend dejara
de mandar el campo.

`gradeKey` deja de interpolarse a mano en cuatro sitios: `lib/gradeKey.ts`
(`buildGradedKey`/`parseGradedKey`/`gradeLabelFromKey`). Un `gradeKey` mal armado no falla
ruidosamente — **escribe otra fila**, y el síntoma aparece después y en otro sitio.

### 4. v1.50.3 · Lista de revisión (criterio 111(e)) — Sección 5e de M2

Es la **contrapartida** de §4.38(k.3): aceptamos no ocultar la cifra incoherente en la ficha *a
cambio* de que alguien pudiera revisarla. Sin la lista publicábamos el número malo **y** perdíamos la
señal. `preview` exige `cardId` («¿por qué **esta** carta?»); esto contesta «¿de qué cartas debo
sospechar?».

Las cuatro reglas que la UI **no** puede relajar, cada una con su test:

1. **Default = los tres motivos de coherencia.** `SLAB_PUBLISHED` entra por casilla opt-in: es
   accionable pero **no es un dato erróneo**, y por defecto ahogaría la señal. Se afirma sobre la
   **query real** (`reason=NOT_ABOVE_RAW,ABOVE_MAX_MULTIPLE,GRADE_ORDER_INVERTED`), no sobre un espía.
2. **`truncated` se pinta** como alerta con el conteo escaneado. Truncar en silencio produce la falsa
   confianza de «no hay nada que revisar», que es peor que no tener lista.
3. **Con la feature apagada la tabla sigue**, y se avisa. Si solo funcionara encendida, habría que
   **publicar las cifras malas para poder descubrirlas**.
4. **`409 GRADED_CONFIG_INVALID` no se degrada a lista vacía**: se muestra el error y **no** una tabla.

Cada fila explica **qué error suele haber detrás** (`NOT_ABOVE_RAW` → «suele ser un importe en
dólares capturado como pesos»), que es lo que la convierte en una acción y no en una etiqueta. El
«marcar como revisada» y los avisos proactivos se declaran **fuera de alcance en la propia pantalla**,
en vez de fingir que existen.

**No hizo falta patrón nuevo del sistema de diseño**: es `DataTable` + el mismo pager server-side de
M3/M5. No se inventó nada visual.

### 5. Seeds v1.50.3 y los cinco diales del gate de confianza

`GradedEstimateConfigDTO` estaba **desactualizado** respecto del contrato: le faltaban
`ingestEnabled`, `manualFreshnessDays`, `maxRawMultiple`, `minSampleCount`, `sourceStat` e
`ingestMaxCardsPerRun`. Se alinea el espejo y se corrigen los seeds del mock
(`manualFreshnessDays: null → 30`, `minSampleCount 5`, `maxRawMultiple 100`).

> **Rótulo (añadido 2026-08-31).** Lo de arriba describe el alineamiento de **v1.50.3**.
> `ingestEnabled` **ya no forma parte** de `GradedEstimateConfigDTO`: M-46 lo retiró al colapsar el
> gancho en un solo dial (**§31**).

El panel los **muestra read-only**: cambian lo que el operador ve —con 30 días un estimado capturado
a mano **caduca**, y `maxRawMultiple` es el tope contra el que la lista marca `ABOVE_MAX_MULTIPLE`— y
no había dónde consultarlos. **Editarlos** sigue siendo por API: cada uno trae su rango normativo
propio y meter cinco campos con validación en el pase que arregla el bloqueante habría mezclado dos
cosas. Deuda registrada como **F-20**.

### 6. La cobertura que ata el cuerpo de la petición al contrato

**El hueco estructural** que dejó pasar todo esto: los tests de las pantallas que fijan precio
**espían `api.overridePrice`** y afirman *que se llamó*. Nadie miraba **qué se manda**, así que el
*breaking* pasó la suite entera en verde mientras tres superficies de dinero devolvían 422.

`src/test/pricing-override-intent.test.tsx` cierra eso: `config.useMocks = false`, `fetch` **ruteado
por URL**, componentes reales, y se afirma el **body HTTP literal** de cada superficie —incluido que
raw manda `finish` y **ningún** `intent`, y que graded **omite** `finish`—. Más los dos códigos de
error nuevos vistos por el operador. 10 tests. La lista de revisión añade otros 7 con la misma
técnica sobre la **query**.

En E2E se añaden dos casos a `e2e/grading-estimate.spec.ts`: el bloqueo de §O.8 llegando al operador
**por grado** (PSA 10 se publica, PSA 9 rebota con su 409 traducido) y el default/opt-in de la lista
de revisión.

**Los mocks replican la guarda, no la esquivan:** `overridePrice` en modo mock aplica el mismo
`publishedSlabsForGradeKey` que el backend y lanza el 409 con sus `details`. Sin eso, Playwright
—que corre en mocks— no podía verificar de punta a punta el bloqueo que §O.8 exige.

### 7. Verde (números reales, esta rama)

`npx tsc --noEmit` ✓ 0 errores · `npx next lint` ✓ 0 warnings · `npx vitest run` **90 archivos /
751 tests, 751 passed** ✓ (734 → 751: **+17** de este pase) · `npx next build` ✓ (compilado + 62
páginas estáticas) · `npx playwright test e2e/grading-estimate.spec.ts` **11/11 passed** ✓ ·
**suite Playwright COMPLETA: 97/97 passed** ✓ — incluido `catalog.spec.ts`, que confirma una vez más
que **F-17 está muerto**.

> ⚠️ **Nota de arnés para QA/devops (no es un fallo de producto).** En este entorno había **otro
> `next dev` en el puerto 3000 levantado sin `NEXT_PUBLIC_USE_MOCKS`**, y `playwright.config.ts` usa
> `reuseExistingServer: !isCI` ⇒ Playwright **reutilizó ese server** y los 9 specs del gancho
> fallaron en bloque hablando con el backend real. Se corrió contra un server propio
> (`E2E_BASE_URL=http://localhost:3100 E2E_MOCKS=1`, build de producción). Un `next dev` reusado
> también se degradó tras varias recompilaciones (`<main>` vacío) y volvió a la normalidad al
> reiniciar: **para gates, `next build` + `next start`, no `next dev`**.

### 8. Para el arquitecto (no bloquea; nada se resolvió por cuenta propia)

1. **`publishedSlabGrades` es un hecho de CARTA que solo viaja dentro de `groups[]`.** Si la carta no
   tiene ningún grupo raw publicado, `groups: []` y el pre-vuelo **no puede avisar** del bloqueo
   INV-D, aunque el 409 sí llegue. Es exactamente el caso de curaduría interesante: carta con slab
   publicado y sin raw en venta. Si se quiere pre-vuelo completo, el sitio natural sería subir
   `publishedSlabGrades` a la **raíz** de `GradedEstimatePreviewResponse` (aditivo, sin romper nada).
   **No se ha asumido**: hoy la UI se apoya en el 409, que es la guarda autoritativa.
2. **La vitrina sigue sin «Ver todas»** (§22.6 / §22.12 nº6): no existe una vista de Compra filtrada
   por elegibles a la que enlazar sin mentir. Se mantiene omitido. *(Heredado de §25.)*

## §25 · Fusión del gancho de grading con `main` (pricing v2 / P-48) — 2026-08-28

> Merge de `origin/main` (curva de precio por valor de mercado, **ya en producción**) sobre la rama
> del gancho. Seis conflictos en `frontend/` + este documento. Fuente de verdad tras la fusión:
> contrato **v1.50 / v1.50.2**, `DESIGN_SYSTEM §22` (renumerado desde §21, que main ocupó con la
> curva) y `PROJECT §O` (criterios **97–112**, antes §N / 79–92).

### 1. El cambio de shape que desbloqueó todo: `gradingHighlight` se MUEVE al Summary

Main partió el DTO de singles en dos (**D2**): `GroupedListingDTO` es el de la **ficha** y
`GroupedListingSummaryDTO` el de la **rejilla** (catálogo + home), con lista blanca de campos —sin
`priceBasis` ni `referenceValue`—. Mi marcador de curaduría vivía en `GroupedListingDTO`, así que
**se caía de la rejilla en silencio**: la teja compilaba y no pintaba nunca.

El arquitecto resolvió (contrato **v1.50.2**) admitirlo en el Summary: D2 protege la *economía de
enumerar*, y ese argumento decae cuando existe un **enumerador público** del propio campo — y aquí
existe porque lo construimos a propósito (`?gradingHighlight=true&sort=grading_showcase`). Aplicado
en el cliente:

| Antes (v1.50) | Ahora (v1.50.2) |
|---|---|
| `GroupedListingDTO.gradingHighlight?` | **`GroupedListingSummaryDTO.gradingHighlight?`** |
| ficha podía leerlo en `listings[i]` | **derogado**: la ficha usa `gradedEstimates` de la raíz |

- `types/contract.ts`: el campo **se mueve** (no se duplica). Que sean dos tipos distintos es lo que
  hace que el compilador —y no una convención— cierre el camino derogado: releer el marcador desde
  `listings[i]` de la ficha ya no compila.
- Retipados contra el Summary: `_shared/grading/estimates.ts` (`badgeEstimatesOf`,
  `pageHasGradingFigures`), `GradingEstimateBadge.tsx` y `_home/GradingGemsShelf.tsx` (`gemsOf`).
- `lib/mock/fixtures.ts`: `groupMockListings()` queda como agrupador de la **ficha** y se añade
  **`groupMockSummaries()`**, que deriva del mismo agrupador el DTO de rejilla (quita las dos
  señales de precio de D2, añade el marcador). `getCatalog()` mock consume el segundo. Rejilla y
  ficha no pueden divergir en stock, precio ni representante porque salen de la misma función.
- El DTO de la **ficha** conserva `gradedEstimates` en la raíz, sin cambios: sigue **sin gatear**.

### 2. `Fact` extraída vs. `FactGrid` de main — el conflicto con miga

Main añadió a `CardDetailView` una `interface FactSpec` + una `FactGrid` **exactamente donde yo había
extraído la celda `Fact`** a `_shared/Fact.tsx`. Resolución:

- Se conservan **`FactSpec` y `FactGrid` de main** (arman la retícula de precio sobre la lista de
  hechos ya filtrada por `priceBasis`, §21.8b-1) y **se borra la `Fact` inline**: la celda vive en
  `_shared/Fact.tsx` y `FactGrid` la importa. Compatibilidad verificada campo por campo — `FactGrid`
  pasa `label` (string ⊂ `ReactNode`), `note?: string` y `className?: string`, que es exactamente lo
  que la celda extraída acepta. Cero cambio visual en la ficha.
- El bloque del gancho **reutiliza la celda, nunca `FactGrid`** (§22.3): `FactGrid` es el contenedor
  de los hechos de **precio** y fija su propia regla (`border-border`); el gancho necesita **regla de
  tinta** y debe leerse como **otra categoría** (R2). Pedirle una prop de tono a `FactGrid` sería
  modificar un componente existente, que es justo lo que §22 se prohíbe.
- **Divisor posicional (§21.8b-2, norma de main).** El bloque pasa de `i > 0` a **`i % 2 !== 0`**:
  el divisor es de la **posición**, no del hecho. Con `i > 0`, una tercera cifra —si el dial `grades`
  creciera— heredaría un `sm:border-l` **abriendo fila**, que es el bug exacto que esa norma cerró.
- **Prohibido** empujar el estimado como quinto `FactSpec` (mismo grid = misma categoría) y el
  estimado **nunca lleva versalita de `priceBasis`/`PriceBasisTag`**: un estimado no tiene base de
  precio. Ninguna de las dos cosas se hizo; quedan anotadas porque ahora son **una línea de código**.
- Bonus de §21.8f: main retira la línea «Valor de mercado» de las tejas de Compra ⇒ la teja **encoge
  ~16px** y el coste del micro-aviso (§22.5) queda casi nulo en escritorio. El espacio recuperado se
  queda en **aire**, no en un elemento nuevo.

### 3. Estado nuevo en la tabla de §22.7: fresca + gate cumplido + **no confiable**

Caso que antes no existía (**R6**): la ficha **sí** pinta el bloque, la teja y la vitrina **no**. Es
**indistinguible en el DOM** del caso «no pasa el gate de ROI» —y **debe** serlo (R5 / SEC-A1: el
criterio no se filtra al cliente)—. No se añadió marca, ni `data-*`, ni clase, ni tinta atenuada.
Cubierto como estado **correcto** en dos tests nuevos:

- `CardDetailView.test.tsx` — con un PSA 10 por **debajo** del raw (la cota inferior de R6: el error
  de USD capturado como MXN) la ficha informa igual, con su micro-aviso y su nota; se afirma que
  **ningún atributo del DOM** menciona confianza/gate/muestra y que el texto tampoco.
- `CatalogTile.test.tsx` — las dos causas de supresión producen el **mismo `outerHTML`**, y la teja
  no expone atributo alguno que nombre el criterio.

### 4. Mensajes (`messages/{es,en}.json`)

- Hunk 1: main **borra** `admin.m2.tierRules`/`tierMap` (los sustituye la curva) y añade
  `admin.m2.curve`. Resolución: **`curve` + `gradedEstimates`**, tirando `tierRules`/`tierMap`. El
  marcador de conflicto cortaba a media estructura, así que se resolvió por bloques completos y se
  verificó **con el JSON parseado**, no a ojo: **cero** claves de main perdidas, **cero** valores
  divergentes, y las claves de bounties que main añadió después intactas.
- Hunk 2: códigos de error disjuntos ⇒ se conservan **todos** (`CURVE_*`/`BUY_*`/`BIN_*` de main +
  `GRADING_TIERS_*` míos).
- Paridad ES/EN verificada por script: **2179 claves, cero asimetrías**, con 59 claves del gancho.

### 5. Renumeración aplicada

`§21.x → §22.x` y `§N.x → §O.x` **solo en los archivos del gancho**; los `§21` que el propio §22 cita
**hacia la curva de main** (§21.8/§21.8b-2/§21.8f, `PriceBasisTag` §21.9a) son **cruzados a
propósito** y se conservan. Igual con `§N` cuando habla de la curva (`fixtures.ts` seed de la curva,
bounty rebasado §N.6, `priceBasis` §N.7). Criterios de aceptación: **+18** (79–92 → 97–110); las
referencias a `criterio 84` de main (rareza que no interviene en el monto) **no** se tocaron.
Etiquetas de contrato `v1.44-graded-estimate` → **`v1.50`/`v1.50.2`**.

### 6. Verde tras la fusión (números reales, esta rama, modo mocks)

`npx tsc --noEmit` ✓ (0 errores) · `npx next lint` ✓ (0 warnings) · `npx vitest run` **88 archivos /
734 tests, 734 passed** ✓ · `npx next build` ✓ (compilado + 62 páginas estáticas) ·
`npx playwright test e2e/grading-estimate.spec.ts` **9/9 passed** ✓.
Adicional: `npx playwright test e2e/catalog.spec.ts` **13/13 passed** — el fallo **F-17** que se
arrastraba de `origin/main` **no reprodujo** en este entorno (mock mode); se deja la anotación de
`docs/TECH_DEBT.md` como está, porque no es mío ni lo toqué.

### 7. Para el arquitecto (no bloquea; ninguna se resolvió por cuenta propia)

1. ~~**Bullet contradictorio vivo en el contrato.**~~ **✅ CERRADO (2026-08-28).** El arquitecto lo
   derogó **explícitamente** en `API_CONTRACT.md:3004` («⛔ v1.50.2 — los `listings[i]` de esta
   respuesta NO traen `gradingHighlight`. *Este bullet decía lo contrario hasta v1.50.2 y queda
   DEROGADO*»). Ya no hay dos afirmaciones opuestas: el contrato dice una sola cosa y es la que el
   cliente implementó. **Nada que hacer en el cliente** — el tipo ya lo impide (`gradingHighlight`
   vive solo en `GroupedListingSummaryDTO`). Se deja tachado, no borrado, para que la petición no se
   reabra por olvido.
2. **La vitrina sigue sin «Ver todas»** (§22.6 / §22.12 nº6): no existe una vista de Compra filtrada
   por elegibles a la que enlazar sin mentir. Se mantiene omitido.

## §24 · «Valor estimado si se gradea» — gancho de grading (2026-08-23, contrato v1.50-graded-estimate / DESIGN_SYSTEM §22)

> Rama `claude/psa-graded-card-value-gmhv5u`. Implementa PROJECT §O (v2.0), contrato
> **v1.50-graded-estimate** y **DESIGN_SYSTEM §22**. Cambio **aditivo**: sin `gradedEstimates` /
> `gradingHighlight` en la respuesta, todas las superficies se ven **exactamente como hoy**.

### Piezas nuevas
| Archivo | Qué es |
|---|---|
| `(storefront)/_shared/grading/estimates.ts` | Predicados de render (`renderableEstimates`, `blockEstimatesOf`, `badgeEstimatesOf`, `pageHasGradingFigures`, `oldestCapturedDate`). **Única** fuente de verdad de «¿hay cifra que pintar?». |
| `(storefront)/_shared/grading/GradingFootnote.tsx` | `GradingFootnoteBoundary` (contexto + nota), `GradingNoteCall` (la llamada `*`) y la nota al pie. |
| `(storefront)/_shared/grading/GradingEstimateBlock.tsx` | Bloque de la ficha (§22.3). |
| `(storefront)/_shared/grading/GradingEstimateBadge.tsx` | Badge de la teja / vitrina (§22.5). |
| `(storefront)/_shared/grading/GradingMicroNotice.tsx` | **El micro-aviso adyacente visible** (§22.4c) + su llamada `*`. Único portador del aviso en las tres superficies. |
| `(storefront)/_shared/grading/HypotheticalGradeChip.tsx` | Chip de grado hipotético, borde punteado (§22.2). |
| `(storefront)/_home/GradingGemsShelf.tsx` | Vitrina «Joyas para gradear» + `useGradingGems()` (§22.6). |
| `(storefront)/_shared/Fact.tsx` | La celda `Fact` de la ficha, **extraída tal cual** de `CardDetailView` para reusarla en el bloque. Único ensanchamiento: `label` pasa de `string` a `ReactNode` (la etiqueta del gancho lleva el chip). Cero cambio visual. |

Tocados: `types/contract.ts` (espejo del contrato), `lib/api.ts` (`gradingHighlight` + `sort=grading_showcase`), `lib/mock/fixtures.ts`, `catalog/CatalogTile.tsx`, `catalog/CatalogView.tsx`, `catalog/[cardId]/CardDetailView.tsx`, `(storefront)/page.tsx`, `messages/{es,en}.json`.

### Cómo se resolvió el acoplamiento llamada ↔ nota (§22 R3.3) — lo importante
El requisito es que **un refactor no pueda dejar cifras huérfanas**. En vez de repetir la condición
en cada sitio, hay **un solo booleano por página** que hace **dos cosas a la vez**:

```tsx
<GradingFootnoteContext.Provider value={active ? anchors : null}>
  {children}
  {active && <GradingEstimateNote />}
</GradingFootnoteContext.Provider>
```

- **Toda** cifra (`GradingEstimateBlock`, `GradingEstimateBadge`) y la propia `GradingNoteCall`
  **exigen el contexto**: sin boundary activa devuelven `null`. Mover un badge a una página que no
  hospeda la nota **no produce una cifra sin aviso: produce nada** (fail-closed, la dirección
  correcta del error en una superficie comercial).
- El `active` de cada página se deriva **siempre** de los helpers de `estimates.ts`, nunca de una
  regla copiada: ficha `blockEstimatesOf(detail) !== null`; Compra
  `pageHasGradingFigures(catalogQuery.data?.data)` (se reevalúa al filtrar/paginar, §22.4b); home
  `pageHasGradingFigures(gemsOf(gems.data))` — la **misma** query que alimenta la vitrina, deduplicada
  por `queryKey`, así que vitrina y nota no pueden divergir.
- El `Provider` se renderiza **siempre** (solo conmuta su valor): cambiar el tipo de nodo al paginar
  desmontaría la vista y perdería el estado de filtros.
- Enlace de regreso: la boundary recibe `returnToId` (ficha → la llamada, que ahí **sí** es enlace;
  Compra → `#catalogo-resultados`; home → `#joyas-para-gradear`). Todos con
  `scroll-mt-[calc(var(--app-header-h,0px)+16px)]`, nada de `top` hardcodeado.
- Tests que lo fijan: `gradingEstimates.test.tsx` («fuera de una boundary activa, ninguna cifra se
  pinta»), `CatalogView.test.tsx` (página con badges ⇒ nota; pestaña Gradeadas ⇒ ni cifra ni nota) y
  `CardDetailView.test.tsx` (ficha con bloque ⇒ nota completa sin interacción).

### Iteración por `gradeValue`, nunca por índice
`GradedEstimateDTO[]` se recorre leyendo `gradeValue`/`gradingCompany`; **no hay ningún `[0]`** ni
supuesto de longitud. Añadir o quitar un grado (diales `grades` / `highlightGrades`) **no toca el
cliente**: el bloque pinta una celda por elemento y el badge un renglón por elemento. La única
lectura posicional es **tipográfica** (la primera cifra es el premio mayor, §O.3/§22.1), que es
justo lo que el diseño pide y no rompe si cambia el conjunto de grados.

### Colores y tipografía — cero tokens nuevos
- **Ningún hex literal** y **ningún token nuevo**. Solo utilidades ya mapeadas a tokens semánticos:
  `text-text`, `text-muted`, `border-border`, `border-border-strong`, `border-text`, `text-accent`.
  Por eso la trampa de §2.3 (que aún lista el bermellón retirado `#B44B3A` en vez del rojo TCG HUNT
  vigente) es inocua: `text-accent` resuelve a `--color-accent` en runtime.
- El acento tiene **un solo empleo**: la llamada `*` y su marcador en la nota (R1). Ninguna cifra,
  etiqueta, fondo o borde del gancho lleva color. Sin verde de dinero, sin rojo de oferta, sin cajas.
- Voz (R2): el precio de venta sigue en sans 500 30px; los estimados son **mono tabular** 22/17px
  (20/16 móvil) en un contenedor aparte con su regla de tinta, y **el bloque no contiene ningún
  precio real**.

### Money-safe
`renderableEstimates` descarta cualquier elemento sin `referenceMxnCents > 0` o con
`status !== 'priced'`, y devuelve **`null`** (no `[]`) cuando no queda nada — así es imposible
renderizar un contenedor vacío por descuido. Nunca `$0`, ni `—`, ni «pendiente», ni **skeleton**: la
vitrina del home es la excepción ratificada a §8.1 (aparece resuelta o no aparece).

### i18n
Claves nuevas bajo `catalog.gradingEstimate`, `catalog.gradingBadge`, `catalog.gradingNote` y
`home.gradingGems`, en ES y EN (el test de paridad las cubre). El disclaimer se pinta **una clave por
párrafo con rich text** (`<b>` → `<strong>`), jamás concatenando. Dos desviaciones deliberadas del
esquema de §22.11, ambas para poder copiar el texto aprobado **sin reescribirlo**:
- **`p1…p6`** (no `p1…p5`): el texto de PROJECT §O.5 tiene **seis** párrafos y el humano lo quiso
  íntegro; el diagrama de §22.4b omite el primero.
- **Sin `psa10Label` / `psa9Label`**: serían claves por grado cableado, que contradicen la regla de
  iteración del contrato. La etiqueta de celda es `ifGradesLabel` («SI SALE») + el chip, que ya
  compone «SI SALE PSA 10» para cualquier grado que mande el servidor.
- `catalog.gradingBadge.approx` es nueva y existe por accesibilidad: el glifo `≈` va `aria-hidden` y
  su lectura («aproximadamente») viaja en `sr-only` dentro del mismo `t.rich` (§22.9).

### Textos MARCADOR DE POSICIÓN (pendientes de PO — §22.12 nº2)
Los dos `microNotice` (`catalog.gradingBadge.microNotice`, `catalog.gradingEstimate.microNotice`) y
`catalog.gradingNote.callSr` usan **los textos propuestos por ux-ui en §22.11**, tomados a su vez de
§O.5. Son texto legal-comercial: los fija PO. Cambiarlos es editar `messages/{es,en}.json`, sin tocar
código.

> **Precisión de estado (añadida 2026-08-31).** El fondo sigue **vigente**: estas cadenas cortas **no**
> han sido ratificadas por separado (**pregunta abierta 12**), y eso **no bloquea el encendido**. Lo que
> se corrige es la redacción anterior —«idealmente con la misma revisión legal del disclaimer»—, que
> **presuponía una revisión legal que nunca hubo**. El estado real del cuerpo del disclaimer de §O.5 es
> **aprobado por el dueño; sin revisión legal profesional** (`PROJECT.md`, decisión 59).

### Un solo grado disponible — RESUELTO (ya no hay discrepancia)
La versión anterior de estas notas reportaba una discrepancia con §22.7 («falta un grado ⇒ nada» en
la ficha). **Ya no existe:** ux-ui alineó §22.7 con `PROJECT §O.3(1)/§O.4` y el contrato v1.50 —
«se muestra lo que haya»— y añadió la forma: con **una sola cifra la retícula colapsa a una
columna** a ancho completo. El código ya hacía lo primero y ahora hace también lo segundo (ver
«Ronda de corrección», D6). No queda nada abierto para PO/ux-ui por este punto.

### Mocks (`lib/mock/fixtures.ts`) — MOCK: pendiente de backend real
`mockGradedEstimatesByCardId` (ficha, sin gatear), `mockGradingShowcaseCardIds` (lista **ya curada y
ordenada** por el gate) y `mockGradingHighlightGrades` (dial del badge). El fixture **no calcula** el
gate ni la ganancia: reproduce el **resultado** que el servidor ya resolvió. Cobertura de estados:
Blastoise / Pikachu IR (bloque + badge + vitrina), Milotic FA (**bloque sí, badge no** — estado
normal de §22.7, no un bug), Eevee (un solo grado), Pikachu (sin estimados ⇒ nada).

### Verde (gate pre-publicación — primera entrega)
`tsc --noEmit` ✓ · `next lint` ✓ · `vitest run` **81 archivos / 653 tests** ✓ (33 nuevos) ·
`next build` ✓. Nota: `page.test.tsx` del home necesitó `useRouter`/`usePathname` en su mock de
`@/i18n/navigation` porque la vitrina reusa la teja de Compra.

## §24b · Gancho de grading · RONDA DE CORRECCIÓN tras el rechazo de QA (2026-08-23)

> Rama `claude/psa-graded-card-value-gmhv5u`. Cierra el **bloqueante de QA** (cifras estimadas sin
> aviso visible), el **IMPORTANTE-1** (cero cobertura Playwright), **D2** (el humano no podía
> encender ni configurar su propia feature) y la deuda **D5/D6/D7** del techlead. La raíz del
> bloqueante era de diseño y **ya venía corregida**: se implementa `DESIGN_SYSTEM §22` en su
> versión con el micro-aviso restaurado (commit `6569df6`).

### 1. El bloqueante: micro-aviso VISIBLE, no `sr-only` (R3, §22.4c)
Lo que QA capturó del DOM (`ESTIMADO SI SE GRADEA*` / `PSA 10 ≈ MX$29,000.00` **sin aviso visible**)
ya no se puede producir, porque el aviso dejó de ser un detalle de cada superficie y pasó a ser **un
componente propio, obligatorio y no configurable**: `GradingMicroNotice`.

- **`GradingMicroNotice` es el único portador del aviso** y **lleva la llamada `*` dentro**: aviso y
  llamada son inseparables por construcción. No tiene prop para apagarse, ni variante corta que
  pierda una idea, ni `truncate`/`line-clamp`. Fuera de una boundary de nota al pie devuelve `null`
  —el mismo fail-closed que la cifra—, así que **no puede existir cifra sin aviso ni aviso huérfano**.
- **La teja pierde el eyebrow** y su `sr-only`. «ESTIMADO» y «Ilustrativo» eran **la misma idea**, y
  §O.5 exige que las dos ideas vivan **en el micro-aviso**: lo que sobraba era el eyebrow. El
  condicional se incorporó a la cifra —`figure` «En PSA 10 vale ≈ {amount}» (`sm+`) y `figureShort`
  «PSA 10 ≈ {amount}» (móvil)—, con lo que el aviso **cabe sin añadir un tercer renglón**.
  Las dos longitudes se resuelven con `hidden sm:inline` / `sm:hidden` (el mismo patrón que ya usa el
  CTA de la teja): solo una se renderiza a la vez, así que **no hay texto duplicado** para el lector
  de pantalla.
- **La ficha cambia `provenance` por `microNotice`**: el renglón viejo cargaba «no evaluamos esta
  pieza» pero **no** «ilustrativo», y §O.5 anticipa ese fallo con todas sus letras. La procedencia se
  conserva como inciso dentro del aviso. La **llamada `*` se movió del eyebrow al final del aviso**
  (en la ficha es un enlace real al pie; en la teja, un `<sup>` — la teja entera ya es un enlace).
- **`callSr` se acorta a «Ver nota al pie.»** (§22.11): con el aviso visible delante, duplicar las
  dos ideas en el texto accesible las haría oírse dos veces seguidas.
- **i18n:** nuevas `catalog.gradingEstimate.microNotice`, `catalog.gradingBadge.{figure,figureShort,
  microNotice}`; retiradas `catalog.gradingEstimate.provenance` y `catalog.gradingBadge.eyebrow`.
  Las dos ideas van en **tinta 500** con rich text (`<b>`), nunca partiendo la frase en dos claves.

### 2. Deuda del techlead cerrada en código (D5, D6, D7)
- **D5 — la fecha ahora es la MÁS ANTIGUA.** `latestCapturedDate` → **`oldestCapturedDate`**. Un solo
  rótulo cubre todas las cifras del bloque: con PSA 10 de hoy y PSA 9 de hace 29 días, «hoy» estaría
  **afirmando de más** sobre un dato de casi un mes. La lectura conservadora coincide además con el
  criterio de frescura del backend.
- **D6 — la retícula colapsa con un solo grado.** `grid sm:grid-cols-2` pasa a
  `cn('grid', items.length > 1 && 'sm:grid-cols-2')`, tal como pide §22.7: sin media retícula vacía
  ni `sm:border-l` huérfano. El test nuevo verifica **la retícula**, no solo el texto.
- **D7 — nota obsoleta retirada.** La sección «Discrepancia REPORTADA» y el `⚠️` de
  `gradingEstimates.test.tsx` desaparecen: §22.7 ya está alineada y el código era correcto.

### 3. D2 — el dueño ya puede encender y configurar su feature (criterio 110(e))
- **M10 · interruptor maestro:** `gradedEstimatesEnabled` entra en `DIALS` como dial **`onOff`**
  (Select cerrado `off | on`, no texto libre) y viaja por el `PUT` parcial de siempre —**sin
  redeploy y auditado**—. Un dial ausente en la respuesta se lee **`off`** (fail-closed, como el seed).
- **La UI advierte lo que ese dial hace.** Encenderlo **publica una afirmación comercial**: al tocarlo
  y dejarlo encendido aparece un aviso `role="alert"` que lo dice, y que aclara que **no cambia ningún
  precio de venta, valuación ni cotización** (criterio 108). Hay además una nota permanente que remite
  a M2 para el resto de la config.

  > **RÓTULO DE ESTADO (añadido 2026-08-31) — lo de arriba describe el 2026-08-23 y quedó superado en
  > DOS puntos. Se conserva como historia, no como descripción vigente.**
  > **(1) La aprobación ya existe.** El copy de este aviso decía entonces que el disclaimer «aún espera
  > el visto bueno del humano». **Hoy esa frase sería falsa:** el dueño **aprobó el texto del disclaimer
  > de §O.5 el 2026-08-31** (`PROJECT.md`, decisión 59), **sin revisión legal profesional** — y esa
  > revisión **no bloquea el encendido**. `DESIGN_SYSTEM §22.13(h)` **prohíbe** afirmar que el disclaimer
  > no está aprobado, y §22.13(k) exige **cero apariciones** de esa frase en `messages/`.
  > **(2) El dial que se describe ya no existe.** `gradedEstimatesEnabled` fue **retirado** por M-46, que
  > colapsó el gancho en `gradingHookEnabled`; su aviso de encendido **ya no habla de aprobación
  > pendiente sino de GASTO**. La descripción vigente está en **§31** (copy corregido y su candado en
  > `i18n-parity.test.ts`, §31.2).
- **M2 · Sección 5c `GradedEstimatesSection`:** editor de los **escalones de costo de gradeo**, el
  **margen mínimo** y la **frescura**, con el `enabled` como **espejo read-only** de M10.
  **Los invariantes I1–I5 se cumplen por CONSTRUCCIÓN, no por regaño:** la tabla no pide `min` y `max`
  por fila —así es como se producen huecos y solapes—, pide **una frontera por escalón**; el `min` se
  **deriva** del `max` anterior, el primero es **0** y el último es **abierto**. No existe el campo que
  rompería la contigüidad. El último escalón **no se puede borrar** (I1) y el costo se valida contra
  **`≥ MX$0.01` y `≤ MX$100,000`** (I2): un costo en 0 promocionaría cartas en las que el comprador
  pierde dinero, así que **bloquea el guardado** en vez de viajar al servidor.
  La **fuente de verdad sigue siendo el backend**: los 422 (`GRADING_TIERS_EMPTY`,
  `..._NOT_CONTIGUOUS`, `..._NOT_OPEN_ENDED`) tienen copy propio en `error.*` y se muestran
  accionables, no como «error genérico».
- **API/mocks:** `getGradedEstimateConfig` / `updateGradedEstimateConfig` (`enabled` **nunca** se
  envía: se edita en M10) + `mockGradedEstimateConfig` con el seed de §O.2.1 en centavos.

### 4. Playwright — `e2e/grading-estimate.spec.ts` (IMPORTANTE-1)
Nueve smoke sobre las **tres superficies**, en modo mocks:

- **Con dato se pinta / sin dato no se pinta nada:** ficha de Blastoise (dos cifras), Eevee (un solo
  grado), Pikachu (sin estimados ⇒ ni bloque, ni nota, ni rastro), y Milotic ex —**ficha con bloque y
  teja sin badge**, el estado normal de §22.7 que suele reportarse como bug—.
- **El caso que QA pidió explícitamente:** se inyecta `.sr-only { display: none !important }` y se
  comprueba que **el aviso sigue visible** en ficha, teja y vitrina; en el listado y en el home se
  cuentan los avisos visibles contra las cifras, para que **ninguna quede huérfana en una retícula**.
- **D8 (techlead), aserción transversal:** `expectFigureImpliesFootnote` afirma **cifra ⇔ nota al
  pie** en cada escenario, en ambos sentidos (una nota huérfana también falla). La presencia de cifra
  se detecta por marcas que **solo** produce el gancho (el glifo `≈` y el eyebrow del bloque) y
  **nunca** por el micro-aviso: usarlo sería circular.
- El helper `src/test/grading.ts` hace lo mismo en unitarios (`sightedText` retira los `sr-only` del
  árbol antes de afirmar), así que el bloqueante está cubierto en los dos niveles.
- **Aviso:** `e2e/catalog.spec.ts:36` («tarjeta de SELLADO») **ya fallaba en `origin/main`**; se
  reconfirmó en esta rama y **no se tocó** (QA lo excluyó). Queda anotado como **F-17** en
  `docs/TECH_DEBT.md`.

### 5. Cero tokens nuevos (se mantiene)
Ni un hex, ni un token nuevo, ni una caja. El micro-aviso es **sans muted** (§22.4c: es prosa, no una
etiqueta) con las dos ideas en `text-text font-medium`; el acento sigue teniendo **un solo empleo**:
la llamada `*` y su marcador en la nota.

### Verde (gate de esta ronda)
`tsc --noEmit` ✓ · `next lint` ✓ (0 warnings) · `vitest run` **82 archivos / 671 tests** ✓ ·
`next build` ✓ · `playwright test e2e/grading-estimate.spec.ts` **9/9** ✓ ·
`playwright test e2e/catalog.spec.ts` **9 passed / 1 failed** (el fallo preexistente F-17).

## §22 · Home «Top Bounties» — de tabla a tarjetas con imagen (2026-08-28, `main`)

Cambio visual pedido por el dueño: la sección de bounties de la home (`_home/BountyBoard.tsx`,
montada en `page.tsx:128`) pasa de **tabla compacta** («Lo que más buscamos hoy») a **tarjetas con
imagen de la carta**, y se retitula **«Top Bounties»** para quedar consistente con la vitrina de
`/buylist` (`components/domain/TopBountiesShelf.tsx`).

- **i18n:** `home.bounties.title` → «Top Bounties» (es/en). Subtítulo se conserva (ya era coherente).
  Se **retiraron** las claves solo-tabla `colCard`/`colCondition`/`colWePay`/`conditionNm` y se
  añadieron `home.bounties.wePay` («Pagamos» / «We pay») y `home.bounties.badge` («Bounty») para la
  tarjeta. Verificado que `home.bounties.*` no lo comparte otra superficie (solo BountyBoard); la
  vitrina de `/buylist` vive en un namespace aparte, `buylist.bounties.*` (intacto).
- **Presentación:** el marco de estante (`_shared/Shelf.tsx`, título + «ver todo» → `/buylist`) se
  mantiene; el interior pasa a una rejilla `grid-cols-2 lg:grid-cols-4` de tarjetas que **reutilizan
  el lenguaje visual** de `TopBountiesShelf.BountyCard` (FinishBand + imagen `aspect-[5/7]` + chip
  ☩ BOUNTY sobre scrim de tinta + nombre serif + set·número mono + precio héroe verde «Pagamos»).
  No se reusó el componente `BountyCard` tal cual porque incluye el CTA «Cotizar esta carta» que
  necesita el cotizador de `BuylistView` (`onQuote`); en la home no hay cotizador, así que cada
  tarjeta es un `Link` a `/buylist` sin CTA muerto. Se evitó tocar `TopBountiesShelf` (regla: ya está
  bien). La imagen usa `alt={name}` (antes `alt=""` aria-hidden en la vitrina) porque aquí es el
  contenido accesible del enlace.
- **Sin fuga de demanda:** la tarjeta NO reintroduce `remainingQty`/`targetQty` (se quitaron a
  propósito en `e3f76e2`/`df50e60`/`965e9f2`). Confirmado por grep: la home no referencia
  `remainingQty`/`targetQty`/`colWanted` fuera de comentarios y del fixture de test.
- **Condicional intacto:** sin bounties o en error ⇒ la sección desaparece (misma regla de honestidad
  que la vitrina).
- **Tests:** nuevo `_home/BountyBoard.test.tsx` (4 casos): tarjetas con imagen + título «Top
  Bounties» + precio «Pagamos», enlace a `/buylist`, no-fuga de cantidades, y ocultamiento en
  vacío/error. `tsc --noEmit` ✓ · `vitest run` BountyBoard + TopBountiesShelf + home `page.test`
  verdes.

## §21 · P-48 (v2.0) — precio puro por valor de mercado: editor de la curva, «Valor de mercado» condicional y bounty rebasado (2026-08-24, rama `claude/card-pricing-rules-2e537m`)

> Etapa **E9** de `ARCHITECTURE §4.36.11`. Fuentes: `PROJECT §N` (LOCKED) · `API_CONTRACT`
> revs **`v2.0-pricing-curve`** y **`v2.1-curve-preview`** · `DESIGN_SYSTEM §21` (+ enmiendas
> §7.3, §16.3, §16.7, §19).

### Qué se construyó

| # | Superficie | Archivos |
|---|---|---|
| 1 | **M2 › Curva de precio** (editor de la tabla de puntos) | `app/[locale]/(admin)/admin/m2/curve/*` |
| 2 | **M2 › Salud del catálogo de rarezas** (hospeda «Unificar rarezas») | `m2/sections/RarityHealthSection.tsx` |
| 3 | **Cola de pendientes** con motivo + filtro | `m2/sections/PendingQueueSection.tsx` |
| 4 | **Ficha de carta / ficha de sellado**: el mercado desaparece | `catalog/[cardId]/CardDetailView.tsx`, `sellado/[inventoryItemId]/SealedDetailView.tsx`, `components/ui/PriceTag.tsx` |
| 5 | **Binder M1**: basis, guardarraíl y bounty rebasado | `components/master-set/{VariantPriceConsole,MasterSetBinder}.tsx`, `components/domain/PriceBasisTag.tsx` |

**Retirado sin residuos** (§N.9): `TierRulesSection.tsx`, `TierMapSection.tsx`, `tier-shared.tsx`,
las funciones de API de `/tiers`, `/tier-map`, `/buylist-rules`, `/sales-rules`, los tipos
`Tier*`/`PriceRuleSet`/`BuylistRule`/`SalesRule`/`*RuleMode`, sus mocks y sus claves i18n —
**incluidos `admin.m2.tierRules.finishHint` («Sin regla propia, el acabado hereda la del tier de su
rareza») e `inheritPlaceholder` («Hereda tier»)**. Ese texto era **falso**: el código nunca heredó, y
la promesa fue la causa de que el dueño creyera tener un piso que no tenía. No se corrigió: **se fue
con la pantalla**.

### Decisión central — la matemática de la curva NO vive en el cliente

El previsualizador, **la columna derivada de cada fila** y el **prerrelleno del punto nuevo** salen
todos del **dry-run del servidor** (`POST /admin/pricing/curve/preview`, ARCH §4.36.8a):

- `useCurvePreview.ts` es la **única** puerta a esos números. El request lleva **solo el borrador +
  las sondas**; la columna `VIGENTE` la resuelve el servidor con su curva almacenada (un cliente
  rancio pintaría una «vigente» que no lo es, y esa columna es contra la que el dueño mide su cambio).
- La **memoria de cálculo** (`appliedBp`, `rawCents`, `constantCents`/`constantWon`, `baseCents`,
  `roundingStepCents`, `segment`) se **pinta tal cual llega**: no se deriva ni se recalcula. Por eso
  el editor es inmune al ajuste de `ROUND_HALF_UP` que movió medio centavo dos cifras de ejemplo del
  DS: la pantalla dice lo que el backend calcula, por construcción.
- El **prerrelleno neutro** de §21.2b usa `draft.<axis>.appliedBp` de la sonda en el mercado nuevo:
  es la interpolación **del servidor** sobre la curva actual, no una cuenta local. Un punto colocado
  sobre la curva vigente no cambia ningún precio ⇒ «agregar un punto» es seguro por construcción.
- **`previewPricingCurve` NO tiene rama mock a propósito.** Fingir el cálculo en el cliente sería
  exactamente la duplicación que el endpoint existe para matar. Sin backend, el previsualizador
  muestra su estado de error («no se muestran cifras estimadas») en vez de inventar un precio.
  *(Consecuencia conocida: en `NEXT_PUBLIC_USE_MOCKS` el previsualizador queda en ese estado.)*
- **Y sin embargo `fixtures.ts › mockDemoBuyQuote` sí aproxima la curva de compra** (tramo plano
  inicial + constante, sin interpolar ni redondear) para que el cotizador no quede vacío en modo
  demo. **No es incoherencia: rellenar una demo no es calibrar.** El previsualizador es donde el
  dueño **elige los puntos de la curva** mirando una cifra — si esa cifra fuera local, elegiría
  contra un número que el backend no produce (P-48 en espejo); en el cotizador de demo nadie toma
  una decisión de dinero con ese número. **Consecuencia práctica: un E2E en modo mock que afirme
  MONTOS del cotizador no verifica el precio del producto, verifica el mock.** Por eso el único
  assert de dinero del cotizador (`e2e/buylist.spec.ts`) afirma **formato** (`MONEY_RE`), no monto,
  y así queda anotado en el propio spec. Detalle en `docs/TECH_DEBT.md` F-P48-2.

Lo único que el cliente calcula son **conversiones de unidad** (`curve-draft.ts`: pesos↔centavos,
`×`↔bp, `%`↔bp) y el **diff** del borrador. §21.1c: la pantalla nunca muestra `marketCents`,
`multiplierBp` ni `pctBp`, ni en `title` ni en `aria-label`.

### Validación en tres momentos (§21.4) — y lo que el editor NO hace

- **Al teclear:** nada. Sin rojo, sin sacudidas, sin reformateos.
- **Al `blur`:** solo lo que **un control puede afirmar de sí mismo** (rangos, `multiplicador ≥
  1.00×`, `pago ∈ [0,100]`, `escalón ≥ MX$0.01`, fronteras crecientes) + el duplicado a nivel tabla.
- **Al guardar:** los cruzados llegan como **422**, con resumen anclado `role="alert"` que **recibe
  el foco**, título fijo «No se guardó nada.», botón de salto al punto culpable y fila marcada.
- **El editor no reimplementa V1/V5/V6/V7/V8-fina.** Es deliberado: si el cliente inventara un
  rechazo que el servidor no haría, el dueño dejaría de confiar en la pantalla — y la autoridad del
  dinero es el backend (SEC-A1). Hay un test que lo fija: una curva con la compra cruzando la venta
  **sigue siendo enviable** desde el cliente.
- `violations[]` del dry-run **no se surface pre-guardado** (§21.4a manda que al teclear no haya
  errores). Está tipado y disponible; si se quisiera «enseñar el problema en pesos» antes de
  guardar, ese es el enganche — sin volver a implementar los invariantes.

### §21.8 — el bloque que desaparece

Tres reglas normativas implementadas en `CardDetailView`:

1. **Primero la lista, después la retícula.** `FactSpec[]` se arma evaluando `priceBasis`; `FactGrid`
   pinta sobre la lista **ya filtrada**. Un hecho oculto **no existe** (no hay celda vacía).
2. **El divisor es de la POSICIÓN, no del hecho.** `sm:border-l` se aplica a las celdas que **no
   abren fila** (índice par de la lista filtrada). El `sm:border-l` hardcodeado en «Valor de mercado»
   y «Acabado» **era el bug**: al quitar una celda, el divisor lo heredaba quien no le tocaba.
3. **La fila del dinero nunca queda coja:** sin mercado, «Precio de venta» ocupa `sm:col-span-2`.

El **esqueleto** ya pinta ese layout (una celda de dinero a ancho completo) ⇒ **sin CLS**.
`card.referenceExplainer` se partió en `referenceExplainerWithMarket` / `referenceExplainerNoMarket`:
la clave vieja describía a la vez el bloque que ya no está y el modelo retirado («referencia +
margen»). La variante «sin bloque» **no menciona** el mercado: no hay nada que explicar.

### Decisiones de implementación que conviene conocer

- **Nombres accesibles por eje.** §21.10 propone `aria-label` «Mercado del punto 2» y «Quitar el
  punto de MX$ 80.00», pero hay **dos** tablas de puntos en la misma pantalla: esos nombres
  colisionaban (dos controles con el mismo nombre accesible es un defecto real). Se desambiguó por
  curva: «Mercado del punto 2 **de venta**», «Quitar el punto **de compra** de MX$ 25.00».
- **El marcador sobrevive al «—».** Una variante retenida por el guardarraíl no tiene precio
  publicable; el renglón pinta `— ·!` porque el marcador es justo lo que explica el hueco.
- **`·!` no convive con `·P`** (§21.9b): la retención implica el piso; la causa va en el nombre
  accesible.
- **Namespaces i18n:** las claves nuevas del binder se añadieron a los namespaces **existentes**
  (`admin.pricing.console.*`, `admin.bounty.*`) en vez de crear `admin.m1.priceConsole.*` /
  `admin.m1.bounty.*` como sugiere §21.12. Es el mismo copy en el mismo sitio, con menos churn; si
  el equipo prefiere el nombre del DS, es un rename mecánico.
- **La fila «Regla aplicada» del carrito de venta se retiró** (`SellCartContents.tsx`). Rotulaba
  `appliedRule`, que el contrato retira. Se optó por **quitarla**, no por sustituirla con la
  versalita de `priceBasis`: es una superficie del **cliente**, y un rótulo interno ahí explicaría
  menos que el propio importe. El DS no diseñó esa fila para v2.0.
- **El gráfico de la curva (§21.5c) no se implementó.** Es «recomendada, no bloqueante para el
  primer entregable» y su alternativa accesible obligatoria —la tabla de referencia— **sí** está.
  Anotado en `docs/TECH_DEBT.md`.
- **`GET /admin/pricing/rarities`**: el front ya lee el shape re-propositado
  (`{canonical, raw, premium, mapped, cardCount}`) e **ignora** los campos que el backend todavía
  emite del editor viejo (`rule`, `tierId`, `source`). Cuando E7b/E8 los retiren, no hay cambio de
  frontend.

### §21.8 alcanza a «Tendencia de valor» (hallazgo de QA, 2026-08-24)

> El objeto de la regla **no es una celda**: es **no publicar el valor de mercado cuando el mercado
> no fijó el precio**. La primera versión condicionó la celda y dejó fuera el otro bloque de la
> misma ficha que publica la misma cifra.

- **Defecto:** en `/sellado/:id` con `priceBasis='override'` la celda «Valor de mercado» desaparecía,
  pero 200px más abajo `SealedValueTrend` pintaba la cifra a 32–40px y la rotulaba literalmente
  «Valor de mercado de referencia (TCGCSV), actualizado a diario.» — exactamente lo que §N.7
  prohíbe, solo que más abajo, y contra §21.8c («el hueco no se rellena ni con una explicación de
  por qué no está el mercado»).
- **Fix:** el bloque de tendencia se condiciona por `priceBasis` igual que la celda
  (`trendEnabled && showMarketValue`). **Asimetría legítima:** con precio derivado por **spread**
  sí hay mercado y el bloque **se muestra** — ahí el mercado es justo lo que explica el precio.
- **Cómo se afirma ahora:** el E2E del caso override afirma sobre la **página entera**
  (`getByText(/valor de mercado/i)` → 0), no sobre una celda. Un assert acotado a la celda es
  exactamente el que dejó pasar este defecto.
- **Regla para el futuro:** cualquier bloque nuevo de la ficha (de carta o de sellado) que imprima
  la referencia de mercado entra bajo la misma condición. Hoy solo hay uno; la ficha de carta no
  tiene tendencia y el formulario de restock no publica mercado (verificado).

### V9 `BUY_CURVE_NOT_MONOTONIC` y la disciplina de §21.4e (2026-08-24)

- **Código propio, no una generalización de V5.** Los dos son gemelos —mismo esqueleto de copy,
  misma marca de tramo— pero el verbo cambia porque cambia el daño: en venta el precio **baja**; en
  compra **pagarías menos**. Unificarlos obligaría a un mensaje que no dice ninguna de las dos cosas.
- **`details.axis` enruta las marcas.** Con `axis:"buy"` las dos filas culpables se marcan en la
  tabla de **compra** y el salto «Ir al punto de …» aterriza ahí; las de venta quedan limpias. Hay
  test que lo fija en ambos sentidos.
- **⚠️ Drift de nombre encontrado al cablearlo.** El contrato norma `details: { axis, index,
  marketCents, … }` y deja el **segundo extremo del tramo dentro de ese «…»**; el backend emite
  **`index2` / `marketCentsTo`**, y este front había declarado `toIndex` / `toMarketCents`. Con el
  nombre equivocado, el segundo extremo **no se marcaba** y el dueño buscaría el problema donde no
  está. Ahora se lee `marketCentsTo` (lo real) con el otro como alias tolerado, y los tests usan el
  shape del servidor. **Solicitud al arquitecto:** normar el nombre en el contrato.
- **§21.4e — el aviso no se contagia del invariante.** «Lectura de la curva» (§21.5b) y V9 pueden
  ser ciertos **a la vez sobre la misma curva** y significan cosas distintas: que el **pct baje** es
  legítimo mientras el **pago absoluto suba**; V9 bloquea que baje el pago. El aviso conserva su
  eyebrow `LECTURA DE LA CURVA`, su `role="status"` y su tinta muted **aunque V9 esté presente** —
  sin rojo y sin icono de error. Si aprendiera a verse como error, la próxima vez que apareciera
  solo —el caso normal y legítimo— se leería como un fallo del que nadie tiene que hacer nada. Hay
  un test que dispara los dos a la vez y afirma que el aviso no cambia de tono.

### El assert de la ficha de sellado, ahora también por la CIFRA (matiz de QA)

QA validó que el assert de página entera no es vacuo, y señaló que **caza el rótulo, no el número**:
un bloque futuro que republicara la cifra sin la frase —un eje de gráfica, un tooltip, un
`aria-label`— pasaría en verde. Se cerró **sin volver frágil el test**: el assert por cifra vive en
el **unitario**, que es dueño de su fixture, así que compara contra el mismo valor que inyecta y no
contra un monto global que cualquiera puede mover. El caso elegido es el más exigente: hay mercado
**conocido** y aun así lo fijó un override (§K: `override manual > mercado × spread`), y la serie de
tendencia se sirve con **ese mismo** valor — así, si el bloque volviera, la cifra aparecería.
Verificado por mutación: al revertir la condición, **fallan los dos** (el del rótulo y el de la
cifra, este último nombrando `MX$9,876.54`). La E2E conserva el assert de página entera.

### Cobertura `@real`: de 0 a 3 tests en el spec de P-48 (2026-08-24)

QA corrió los E2E contra el stack vivo y el dato desnudo fue: **80 tests en mock, 8 con
`E2E_REAL=1`** — y `pricing-curve.spec.ts`, el spec del cambio bajo revisión, aportaba **cero**. La
consecuencia estaba a la vista: **B-1** (el backend no emite `priceBasis` en `GroupedListingDTO`, así
que `undefined === 'market'` suprime el bloque **en todas las fichas**) pasó por 80 tests en verde,
porque el fixture **hornea** `priceBasis: 'market'` — que es lo correcto para un mock y justo lo que
lo vuelve ciego a un campo que el servidor no manda.

Añadidos (`@real` corre también en mock, así que **descubren datos y afirman invariantes**, nunca
montos de fixture):

| Spec | Test | Qué mira |
|---|---|---|
| `pricing-curve` | la regla de §21.8 **no está invertida** | Recorre las primeras fichas y exige que **alguna** publique el mercado. Es el detector de B-1 |
| `pricing-curve` | dinero con formato MXN, nunca «precio pendiente» | Money-safe de cara al comprador |
| `pricing-curve` | el editor carga del servidor y **el dry-run responde** | Primera vez que el previsualizador de la curva se ejercita contra un backend vivo |
| `catalog` | la vitrina publica cartas reales con precio | Un catálogo vacío o sin precio ya no pasa en verde |
| `catalog` | la ficha **coincide consigo misma** | Bicondicional de §21.8d: bloque y nota al pie cuentan la misma historia |

**Resultado medido contra el stack vivo:** `@real` pasó de **8 a 13** tests. El detector de B-1
**falla, con su propio mensaje** («Ninguna de las 3 fichas visitadas publicó el valor de mercado…»)
— es el comportamiento correcto hasta que backend emita el campo. El del editor + dry-run **pasa**.

> **Dos lecciones de método que costaron encontrar y conviene no repetir.**
> 1. **Un test que descubre datos tiene que esperar a que existan.** La primera versión leía el DOM
>    tras el `<h1>`; contra un backend real la retícula aún no había pintado, la lista de fichas
>    salía **vacía** y el bucle no se ejecutaba: el test pasaba **en vacío**. Ahora se espera a que
>    haya un enlace de ficha antes de enumerar.
> 2. **Sustituir `.first().click()` por una enumeración quita el auto-wait.** `count()` e
>    `innerText()` leen el DOM del instante; el `.first()` anterior **tapaba** la falta de espera.
>    Mismo bug, mismo día, en `addFirstSellableCard`.

### Cobertura

- `M2View.test.tsx`: 12 casos del editor (retiro sin residuos + texto falso, anatomía, dry-run como
  única fuente de las cifras, probeta con memoria de cálculo, previsualizador sin servidor, reorden
  al blur, prerrelleno neutro, borrar+deshacer, blur vs tecleo, guardar con diff, 422 que no guarda
  nada, y el editor que **no** se adelanta al 422) + 2 de salud de rarezas.
- `CardDetailView.test.tsx`: mercado visible / floor / override + la geometría de la retícula.
- `SealedDetailView.test.tsx`: spread vs override (una sola celda a fila completa).
- `VariantPriceConsole.test.tsx` / `MasterSetBinder.test.tsx`: `·P`, `·!`, enlace del guardarraíl y
  los dos estados del badge de bounty.
- `e2e/pricing-curve.spec.ts` (nuevo) + ajustes en `e2e/catalog.spec.ts` y `e2e/buylist.spec.ts`.

### Conteo por motivo de la cola de pendientes — **servido por el contrato (v2.1)**

> Se pidió como solicitud al arquitecto y **se resolvió durante esta misma entrega**: el contrato
> **v2.1** norma `counts: { no_market, premium_at_floor, unknown }` en el **cuerpo** de
> `GET /admin/pricing/pending`. El frontend lo **pinta**, no lo calcula.

- **Se pintan verbatim.** Los `counts` **ignoran `?reason=` y la paginación pero respetan
  `?context=`**: `reason` filtra **dentro** de la cola que se está triando, mientras que `context`
  elige **qué cola es** (VENTA = `inventory` vs COMPRA = `buylist`). Recalcularlos o filtrarlos en
  cliente reintroduce el defecto original — con un filtro activo el encabezado describiría el
  subconjunto, y **el número mentiría justo cuando el dueño filtra para triar**, que es cuando más
  lo mira. Hay un test que fija exactamente eso (filtrar por motivo **no** mueve el encabezado).
- **`unknown` se pinta cuando es > 0.** Son entradas con `reason = null` (filas anteriores a M-41).
  No es adorno: sostiene el invariante `no_market + premium_at_floor + unknown === entradas open de
  esa cola`. Sin ella, una cola con filas históricas no cuadra con la lista y **parece un bug del
  backend**. §21.7c ya contempla la fila `(ausente) → «—»` en la columna Motivo, que también está.
- **Los dos primeros números juntos son un DIAGNÓSTICO** (ARCH §4.36.5c), no volumen de trabajo, y
  por eso el segundo va en tinta de atención en vez de enterrado en el encabezado: contra la línea
  base ≈3/333, `premium_at_floor` subiendo con `no_market` **plano** ⇒ hay dato de mercado y está
  **bajo el piso** ⇒ **piso mal calibrado**; **subiendo los dos** ⇒ **feed de mercado degradado**, y
  tocar el piso empeoraría las cosas.

### Harness E2E: tres defectos de test (no de app) que bloqueaban el release

QA reportó once fallos E2E **anteriores a P-48** en flujos que este cambio toca. Ninguno era una
regresión del stream y ninguno era de backend; los tres eran **supuestos de test caducados** por
cambios de UI anteriores, más un control muerto:

1. **`buylist` ×7 — el carrito tiene DOS encarnaciones.** `openCart()` clicaba el FAB, y con el
   viewport de la suite (1280×800) ese FAB **no existe**: arriba de 1024px el carrito es el
   `<aside>` fijo (mitigación H1). Ahora el helper es *viewport-aware* y el carrito se localiza por
   su `aria-label` compartido, no por su rol —que es lo único que cambia entre ambas—. El smoke que
   describe literalmente «badge del FAB» y «cerrar regresa el foco al FAB» corre en **390px**, que
   es donde ese comportamiento existe.
2. **`buylist` ×1 y `master-set` ×1 — localizadores que no distinguían el botón de AGREGAR.** Un
   `getByRole('button', { disabled: false })` a secas también casaba con el «Ver detalle de …» de
   cada fila/casilla (P-43, añadido después): el helper abría el pop-up y no agregaba nada, y el
   fallo aparecía más tarde, en un carrito vacío. Ahora se acotan por nombre accesible.
3. **`master-set` ×2 — el cotizador es una rejilla PLANA.** Los tests esperaban «dos casillas dentro
   de la MISMA celda»; desde N-16 (v1.22-2) hay **una casilla `li` por (carta, acabado)**, hermanas.
   Se reexpresó la misma intención (dos casillas para una carta con reverse holo, una para la de un
   solo acabado, y ningún botón de venta para acabados que no existen) contra la estructura real.
4. **`catalog` ×1 — un filtro que no podía acertar.** La casilla «Sellado» del filtro de tipo de
   Compra sobrevivía de antes de la separación singles/sellado (H9, §2-S): `GroupedListingDTO`
   **nunca** trae sellado, así que filtrar por ella solo podía devolver «Ninguna carta coincide»,
   con la pestaña «Producto sellado» a diez centímetros. Se retiró la casilla (y su sub-filtro de
   presentación, que solo se abría bajo ella). **Es el único de los cuatro que tocó UI de
   producto**, y por eso queda dicho aquí: no se cambió ningún dato ni ningún precio, se quitó un
   callejón sin salida.

*(Aparte, `guest-checkout` ×2 fallaban por **strict mode**: el checkout de invitado ofrece el
selector de DESTINO **dos veces a propósito** (N-9: en el formulario y otra vez arriba de «Pagar»,
compartiendo estado) y pinta **dos avisos distintos** (resumen de errores + nota de bloqueo). Los
localizadores ahora dicen a cuál se refieren; **no se tocó el checkout**, que es de otro stream.)*

### Tres arreglos de test que el stack vivo destapó

- **I-2 · un assert que no podía pasar en ningún entorno** (`master-set.spec.ts`). El oráculo
  `['2','10','SV107','TG01']` se copió de `E2E_ORDER_EXPECTED_NUMBERS`, que es el oráculo de
  **cartas** de `GET /buylist/cards`. El binder pinta **una casilla por (carta, acabado)** y
  `E2E Order Two` (#2) tiene dos acabados ⇒ lo real es `['2','2','10','SV107','TG01']`. En mock la
  línea era código muerto (`orderExact: null`) y en real era falsa. **El propio spec ya lo
  demostraba**: el test de «una carta CON reverse holo pinta DOS casillas» pasa. Corregido el
  oráculo a nivel VARIANTE + un assert nuevo de que las casillas de una misma carta quedan juntas.
- **I-3 · el smoke de VENDER se quedaba en el tope AML.** Con la curva real el estimado sube y la
  solicitud cruza el tope: la UI exige INE, que es **AML-1 funcionando**. El test elige ahora la
  fila cotizable **más barata** (sigue siendo descubrimiento, sin hardcodear montos) y contempla
  **los dos desenlaces legítimos**: solicitud creada, o bloqueo por INE — y en ese caso exige que el
  bloqueo sea honesto (mensaje accionable, sección de INE ofrecida, **ninguna** solicitud creada).
  **VENDER pasa `@real` por primera vez.**
- **El mock del cotizador ahora interpola** (ver `docs/TECH_DEBT.md` F-P48-2): cerraba un 67% de
  divergencia medido por QA.

### Dos defaults y un supuesto, cerrados

- **`config.useMocks` pasó a ser opt-in explícito.** Era `!== 'false'`, o sea **encendido por
  defecto**: un build donde se olvidara `NEXT_PUBLIC_USE_MOCKS=false` servía **fixtures en
  silencio** — precios de mentira sin un solo error en pantalla. Ahora es `=== 'true'`: si la API no
  está, la UI muestra su estado de error honesto en vez de inventar datos. Los caminos que quieren
  mocks lo **declaran** (`playwright.config.ts` ya lo hacía; `vitest.config.ts` ahora también).
- **`PriceHistoryEntryDTO` deja de ser un SUPUESTO.** El contrato lo normó en **v2.1.7**
  (`{ data: PriceHistoryEntryDTO[] }`) y resolvió la grieta a favor del **enum** `PriceSource` — que
  es lo que este front ya tipaba. El marcador de supuesto se retira del código.

### Solicitudes al arquitecto (ninguna bloquea)

1. **Nombre del segundo extremo del tramo en `details`.** El contrato lo deja en «…» y el backend
   emite `index2` / `marketCentsTo`. Hoy el front lee ese nombre con alias tolerado, pero mientras
   no esté normado, cualquier renombre silencioso deja de marcar la segunda fila **sin romper
   ningún test de contrato**. Afecta a los tres errores de tramo (V5, V9, V6).
2. **Impacto del cambio sobre inventario real** (§21.13.2, ya diferido): el diálogo de guardado habla
   de **mercados de referencia**, no de cuántas publicaciones cambian de precio. Sin ese dato el
   diseño es veraz, pero un conteo por bracket haría del diff una decisión con volumen.

## Footer legal — degradación con gracia sin razón social (2026-08-23, P-21)

> Rama `fix/variant-composition-regression`. El humano decidió publicar SIN razón social por ahora.
> El literal placeholder **«[Razón social pendiente]»** NO puede verse en producción.

- **Problema:** el footer del storefront (`(storefront)/layout.tsx`, `Footer()`) renderizaba
  `«TCG HUNT · tcghunt.mx · © {año} {footer.legalEntity}»` con `footer.legalEntity` =
  `[Razón social pendiente]` (es) / `[Legal entity pending]` (en), dejando el placeholder visible.
- **Fix data-driven:** nuevo helper puro `resolveLegalEntity(raw)` en
  `frontend/src/app/[locale]/(storefront)/footer.ts`. Devuelve `null` cuando el valor es
  vacío/en blanco o está envuelto en corchetes (convención de placeholder de los archivos de
  mensajes), y el string recortado en caso contrario. `Footer()` (`layout.tsx:58`) omite la razón
  social cuando el helper devuelve `null`: el footer queda «TCG HUNT · tcghunt.mx · © {año}»,
  coherente y sin texto colgando (la marca «TCG HUNT» ya abre la línea, no hay «©» huérfano).
- **Comportamiento futuro:** cuando el humano cargue una razón social real (sin corchetes) en
  `messages/*.json` → `common.footer.legalEntity`, aparece automáticamente, sin cambios de código.
- **Mensajes intactos:** `messages/es.json`/`en.json` conservan el placeholder entre corchetes como
  marcador de intención; el resolver lo neutraliza en runtime. No toqué el contrato ni el backend.
- **Cobertura:** `footerLegalEntity.test.ts` (3 casos: vacío/blanco/undefined/null → null;
  placeholders es/en → null; razón social real recortada). tsc `--noEmit`, `npm test`
  (622 passed) y `next build` verdes.

## Pase de deuda técnica frontend (2026-08-23) — cotizador H1/H3/H4 + H-P38-5

> Pago de deuda **segura y de display/UX** (money-safe intacto). Detalle en `docs/TECH_DEBT.md`
> (marcados RESUELTOS). Rediseño visual conservado.

- **Cotizador H3 — sombreado «En el carrito» en TODAS las tejas** (`components/master-set/MasterSetBinder.tsx`).
  La teja de **producto separado** (`SeparateProductTile`, deck_exclusive/promo) no recibía `inCart`, así que
  un producto separado ya agregado no se sombreaba (las variantes base sí). Ahora se le propaga `inCart` con
  la MISMA identidad que el carrito: `isInCart(cardId, finish, productId)` — con `productId` (una línea propia).
  Se reusa EXACTO el sombreado de `QuoterTile` (`bg-surface-2` + `shadow-[inset_0_0_0_1px_var(--color-border-strong)]`
  + `data-in-cart` + etiqueta textual `quoterInCart` en `text-success`). Solo aplica en quoter (fuera del quoter
  `inCart` es undefined). Sin cambio de contrato.
- **Cotizador H1 — flash de layout en desktop** (`buylist/BuylistView.tsx`). El carrito era JS-driven
  (`useMediaQuery('(min-width:1024px)')`), first-paint móvil que saltaba a 2 columnas al hidratar (layout shift
  visible de la columna `main`). Mitigación: la ESTRUCTURA de 2 columnas se declara por CSS
  (`lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start`, mismo umbral 1024px que `isDesktopCart`), NO por
  JS. El track de 360px queda RESERVADO desde el first-paint en desktop, así `main` nace con su ancho final y no
  refluye. **Trade-off aceptado:** el CONTENIDO del carrito (`<aside>` / FAB+drawer) sigue siendo un ÚNICO render
  JS-driven (`isDesktopCart`) para NO duplicar estado/foco ni el focus-trap; por eso en desktop el `<aside>` aparece
  al hidratar dentro de la columna ya reservada (rellena el hueco, sin reflujo de `main`), y el FAB móvil es `fixed`
  (fuera del flujo del grid), de modo que su breve aparición pre-hidratación tampoco desplaza el layout. El fix
  limpio del todo (SSR-aware del viewport, o extraer el carrito) implicaría reestructurar de más → mitigación mínima.
- **Cotizador H4 — doc drift** (`components/domain/RarityLabel.tsx` + este archivo). El comentario decía «gemelo de
  `FinishLabel`»; el hermano canónico del rediseño que vive junto a `RarityLabel` en `components/domain` es
  **`FinishMark`**. Corregido en ambos sitios.
- **H-P38-5 — no reusar `SealedProduct.id` como `cardId` de relleno** (`admin/m1/SealedAddFlow.tsx` +
  `QuickAdd.tsx`). El alta de sellado por identidad enviaba `cardId: selected.id` (un `SealedProduct.id`) como
  placeholder de tipo, confiando en que el batch lo ignora. Ahora **NO se envía cardId** (se omite): con
  `sealedProductId` el backend deriva la Card ancla. `QuickAddTarget.cardId` pasó a **opcional** (`cardId?: string`,
  ya opcional en `BatchInventoryItemInput` del contrato); el mutation ya omitía cardId bajo identidad sellada, así
  que el alta sigue funcionando idéntica. Sin cambio de contrato.

## §38 · P-38 — alta de sellado con entidad real `SealedProduct` (2026-08-23, contrato v1.39.1, DS §16.8a)

**Qué se hizo:** evolucionar el `SealedAddFlow` de P-35 para que el alta de producto sellado nazca con
**identidad real** (`SealedProduct` persistido, no un ancla a un single del set) y sea **money-safe** de
raíz. Se **retira el camino money-unsafe** «capturar sin catálogo» de P-35 (nacía SIN MAPEO). Todo en
`frontend/`; el alta vive en `(admin)/admin/m1/`. Aditivo al design system — **cero tokens nuevos**.

**Componentes (m1):**
- **`SealedProductPicker.tsx` (NUEVO)** — reemplaza el grid único `SealedProductGrid` (eliminado). Paso 1
  en **DOS SECCIONES `<section>` por `origin`**: «Del set» (`set_main`) primero y «Promos/colecciones»
  (`promo_collection`) después. Cada sección tiene `<h3>` + contador + su propio `role="listbox"`;
  selección única en todo el paso (un solo `sealedProductId` viaja al paso 2). Orden interno lo entrega el
  server (§4.34c: `isPrincipal desc`, `sortOrder`, `name`). Exporta la **teja evolucionada
  `SealedProductTile`**: imagen real + pozo/fallback, nombre (`cleanName`), pill de subtipo (incl. **UPC**
  y **collection**, con afijo tenue `·` + `title` si `subtypeInferred`), **badge «Principal»**, referencia
  money-safe (`marketRef` o pill `SIN PRECIO DE MERCADO`, **nunca 0**; seleccionable aun sin precio).
- **`SealedManualMarketField.tsx` (NUEVO)** — precio de mercado MANUAL en el paso 2. Input de dinero
  **abierto vacío** (jamás 0/sugerido), valida `>0`, aviso de **override auditado**. El flujo solo lo
  renderiza cuando `marketRef` es null **y** el usuario es **`vault_operator+`**; mapea a
  `manualMarketMxnCents`.
- **`SealedGroupLinker.tsx` (NUEVO, `super_admin`)** — curación de grupos promo/colección: lista
  `GET .../sync/candidates` con medidor de confianza (`matchScore` → alta/media/baja, nunca cifra cruda) y
  estado «Ya enlazado»; `POST .../sealed-sets/:setId/groups` (`kind:"promo_collection"`) → dispara re-sync.
- **`SealedAddFlow.tsx` (EVOLUCIONADO)** — orquesta: set → `listSealedProducts` → picker (con buscador `q`
  server-side + toggle «Solo principales» → `principalOnly`) → paso 2. Estado **«Sincronizar»**
  (`needsSync`): CTA `Sincronizar` **solo `super_admin`** (loading sin cerrar el modal, resumen honesto del
  `SealedSyncResultDTO` «12 presentaciones · 9 con precio · 3 pendientes», nunca «0»); para
  `vault_operator` copy sin botón muerto. Alta reusa `QuickAddSection` con `sealedProductId` (+
  `manualMarketMxnCents` cuando aplica).
- **`QuickAdd.tsx` (AJUSTADO)** — `QuickAddTarget` gana `sealedProductId?` y `manualMarketMxnCents?`. Con
  `sealedProductId` la línea del batch **omite `cardId`** (el backend deriva la Card ancla) y **no** manda
  los 4 campos M-37 sueltos (deprecados). Otras superficies que reusan `QuickAddSection` (raw, detalle de
  set) **no cambian** (siguen mandando `cardId`).

**Endpoints consumidos (nuevos en `lib/api.ts`):** `listSealedProducts`, `syncSealedProducts`,
`getSealedSyncCandidates`, `linkSealedSetGroup`. Alta = `batchCreateItems` (`POST .../items/batch`) con
`sealedProductId` + `batchKey` (+ `manualMarketMxnCents?`).

**`types/contract.ts`:** `SealedSubtype` += `upc`/`collection`; nuevos `SealedGroupKind`,
`SealedProductDTO`, `SealedSetGroupDTO`, `SealedProductListResponse`, `TcgcsvGroupCandidateDTO`,
`SealedSyncCandidatesResponse`, `SealedSyncRequest`, `SealedSyncResultDTO`, `SealedSetGroupLinkRequest`;
`BatchInventoryItemInput` gana `sealedProductId?`/`manualMarketMxnCents?` y `cardId` pasa a opcional.

**i18n (es/en):** `admin.sealedAdd.{section.*,sync.*,linker.*,manualMarket.*,principalOnly,principalBadge,
subtypeInferredHint,legitEmpty,legitEmptyHint,sectionEmpty}` · `status.sealedSubtype.{upc,collection}` ·
`error.{SEALED_PRODUCT_NOT_FOUND,MANUAL_MARKET_NOT_ALLOWED}`. Se retiraron las claves del camino de
respaldo P-35 (`fallbackLink/fallbackNotice/fallbackProductName/noProducts*`).

**Money-safe:** sin precio → pill/pendiente/manual, **jamás 0**; el override manual solo llena el hueco
`null` (con mercado vivo el campo no se ofrece; el backend responde `422 MANUAL_MARKET_NOT_ALLOWED`); sin
manual, la aportación queda `PRICE_PENDING` con helper que lo anticipa. Mocks (`lib/mock/fixtures.ts`)
actualizados para los 4 endpoints y para que `mockBatchCreate` derive por `sealedProductId` y aplique las
reglas de `manualMarketMxnCents`/`SEALED_PRODUCT_NOT_FOUND`.

**El alta nace con identidad real (no ancla-a-single):** la línea del batch viaja **sin `cardId`** y con
`sealedProductId` → el backend deriva Card ancla + mapeo + imagen/nombre/subtipo del `SealedProduct` y
congela el snapshot (la pieza nace «ETB Surging Sparks», no la Tropius). Verificado por test.

**Tests añadidos:** `SealedAddFlow.test.tsx` (reescrito, 7): 2 secciones por `origin` con orden fijo, teja
money-safe (precio/pill/badge, nunca 0), sync solo `super_admin` con resumen honesto + copy sin botón para
`vault_operator`, alta manda `sealedProductId` (sin `cardId`), precio manual `vault_operator` solo si
`marketRef` null (valida `>0` → `manualMarketMxnCents`) y NO aparece con mercado vivo. `SealedGroupLinker.
test.tsx` (nuevo, 1): candidatos con confianza + enlace → re-sync.

**Sin solicitudes al arquitecto:** el contrato v1.39.1 cubre todos los datos/pantallas. No se tocó
`backend/` ni `docs/API_CONTRACT.md`.

**Verde:** `vitest run` **78 archivos / 615 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

## §23 · P-30 (publicación única agrupada con stock) — storefront «Compra» al shape AGRUPADO (2026-08-22, contrato v1.38-grouped-listings)

**Qué se hizo:** casar el catálogo del rediseño (que consumía `ListingDTO` por-copia) con el shape
**AGRUPADO** de v1.38 (`GroupedListingDTO`). **Solo se cambió la fuente de datos y el cableado — el look del
rediseño queda intacto** (mismas tejas, retícula, tipografía, ficha 6b).

**Tipos (`src/types/contract.ts`):** añadidos `GroupedListingDTO`, `GroupedListingListResponse`,
`GroupedListingDetailResponse` alineados EXACTO a v1.38 (`representativeInventoryItemId`, `stockCount`,
`salePriceCents` único del grupo = mínimo/«desde», `gradeKey`, `referenceValue`; productType ∈ {raw, graded},
NUNCA sealed — H9). `ListingDTO` se conserva (lo usan `units[]` y el re-quote por-pieza). Sin `certNumber` a
nivel de grupo: es POR SLAB y vive en `units[]`.

**API (`src/lib/api.ts`):**
- `getCatalog` → `GroupedListingListResponse` (`GET /catalog/cards`). La rama mock **agrupa** las piezas por
  `(cardId, productType, gradeKey, finish)` y aplica precio/orden sobre el grupo. `total` = nº de grupos.
- `getCardDetail` → `GroupedListingDetailResponse` (`{ card, listings: GroupedListingDTO[], units: ListingDTO[] }`).
- `getListing` (`GET /catalog/listings/:inventoryItemId`, re-quote por pieza) **sin cambio** (contrato v1.38).

**Mocks (`src/lib/mock/fixtures.ts`):** helpers `gradeKeyOf`, `unitMatchesGroup`, `groupMockListings`,
`mockGroupedDetail`. Se añadieron 2 copias físicas más de **Blastoise raw NM normal** (`inv-1002b/-1002c`)
para que el grupo tenga `stockCount=3` y ejerza el badge «N en stock» y el add-to-cart por N `units` distintos.

**Componentes adaptados (visual preservado):**
- `catalog/CatalogView.tsx`: una teja por **grupo**; `key`/`inCart`/add-to-cart por
  `representativeInventoryItemId`.
- `catalog/CatalogTile.tsx`: renderiza un `GroupedListingDTO`; precio «desde» = `salePriceCents`; badge de
  stock REAL vía `StockBadge` + `stockVariantFromCount(stockCount)` (Último / N en stock / Agotado —
  reutiliza la variante existente, **no** se tocó `StockBadge` ni se añadió prop `size`, MK-D9 sigue como
  deuda registrada). Add-to-cart → `representativeInventoryItemId`.
- `catalog/[cardId]/CardDetailView.tsx`: la grilla de «Ejemplares disponibles» son los **grupos**
  (`listings`); el add-to-cart va por **`units[]` cheapest-first**: «Comprar» agrega la pieza más barata del
  grupo aún NO en el carrito, y clics sucesivos suben hasta `stockCount` (el CTA cambia a «En el carrito» solo
  cuando TODAS las piezas del grupo están en el carrito). El `certNumber` de graded se lee del **slab
  representativo** (`units`), no del grupo. Re-quote por pieza sin cambio.

**Consumidores colaterales de `getCatalog` (home) reconciliados al shape agrupado, visual intacto salvo lo
forzado por el contrato:**
- `_home/FeaturedCarousel.tsx`: tipos → `GroupedListingDTO`, keys/badge por grupo.
- `_home/GradedShelf.tsx`: keys/badge por grupo. **Cambio visual forzado:** se retiró la línea de
  `certNumber` de la teja porque el cert es POR SLAB (`units[]`) y **no** viaja en `GroupedListingDTO` — la
  vitrina agrupada no tiene esa pieza. El chip de grado (empresa + valor) se conserva. *(No es solicitud de
  contrato: es el diseño money-safe correcto — el cert se verifica en la ficha, sobre el slab concreto.)*

**Money-safe:** `salePriceCents` del grupo es el mínimo/«desde»; el cobro real se re-cotiza por
`inventoryItemId` en checkout (ya estaba así). Sin precio → «pendiente»/«—», nunca $0. Los grupos AGOTADOS no
llegan del backend (`stockCount≥1`); la variante «Agotado» del badge queda disponible por si el front la
necesita defensivamente.

**Tests:** `CatalogView.test.tsx` (grupo colapsa 3 copias en 1 teja + badge «3 en stock»),
`CardDetailView.test.tsx` (reescrito al shape `{card,listings,units}`: add-to-cart por `units` cheapest-first,
multi-stock hasta agotar, CTA por grupo, agotado defensivo), y `api.test.ts` (assertions al shape agrupado).
**Verde:** `vitest run` (585 tests), `tsc --noEmit`, `next build`. **Sin solicitudes al arquitecto** (el
contrato v1.38 cubre todo lo necesario).

## §22 · P-29 (baja rápida de inventario) + P-31 (exportar inventario a Excel) — M1 admin (2026-08-22, branch `fix/variant-composition-regression`)

### P-29 · Baja rápida en el drawer del Master Set (simétrica al alta rápida)

**Qué se agregó:** un control de baja por cantidad en el `VariantDrawer` (drill-down por variante de M1),
simétrico al `QuickAddSection` (P-19). Da de baja **N piezas de la misma variante** (carta + acabado, o
carta + sellado) de un golpe, con **confirmación simple** de dos pasos (sin modal).

**Componente:** `frontend/src/app/[locale]/(admin)/admin/m1/QuickRemove.tsx` (`QuickRemoveSection`).
- Stepper de cantidad + Select de motivo de merma **OBLIGATORIO** (reusa `masterSet.adjust.reason`:
  perdida/danada/error_captura, default `perdida`, elegido antes de confirmar) + CTA `destructive` con
  confirmación inline (dos pasos, sin modal).
- **Money-safe (doble barrera):** el stepper se **capa al conteo VISIBLE** de piezas ajustables
  (`removableCount`, prop) — «Sumar uno» se deshabilita en el tope y `qtyNum` clampa a `removableCount`; con
  `removableCount===0` se muestra el vacío y **no hay CTA**. El backend es la barrera dura.
- **Anti doble-submit:** la baja es **ATÓMICA** en el backend + el botón queda `loading`/`disabled` mientras
  corre. **No se manda `batchKey`** (no hay idempotencia por clave; no hace falta).

**Wiring (`VariantDrawer.tsx`):** botón secundario **«Baja rápida»** en la fila de CTA (solo raw/sellado, no
graded — `quickAddTarget` null en graded), que despliega la sección. `removableCount` se deriva de las filas
ya cargadas (`rows`, filtradas a `ownerType=platform` por el query): `status ∈ {in_stock, listed}`. Al éxito
refresca `pieces.refetch()` + `onChanged()` (agregados del binder).

**Endpoint consumido (backend YA implementado — shape reconciliado):**
`POST /admin/inventory/items/bulk-remove` con
`{ cardId, finish, quantity, reason, note?, productType?, rawCondition?, sealedCondition? }` (`reason`
**requerido** ∈ perdida|danada|error_captura) →
`{ removed, requested, reason, toStatus, inventoryItemIds[], folios[], adjustmentIds[] }`.
- **ATÓMICO:** o baja las `quantity` completas o ninguna. Errores manejados legibles:
  `422 INSUFFICIENT_STOCK { available, requested }` (carrera; muestra las disponibles) y
  `422 ITEM_NOT_ADJUSTABLE`.
- API `bulkRemoveInventory` (`api.ts`), mock `mockBulkRemove` (`fixtures.ts`: atómico — si faltan piezas
  lanza `INSUFFICIENT_STOCK` con `{ available, requested }` sin bajar nada). `ApiFixtureError` ganó un campo
  `details?` y `translateFixtureError` lo propaga, para que el mock reproduzca `INSUFFICIENT_STOCK` con datos.

### P-31 · «Exportar a Excel» en M1

**Qué se agregó:** botón **«Exportar a Excel»** en la toolbar de M1 (junto a «Publicar todo…» y «Alta por
lote»), en `M1View.tsx`. Descarga el `.xlsx` del inventario con el **filtro/set actual**: `setId` del binder
abierto (solo pestaña Master Set) + `productType` por pestaña (`sealed`/`graded`).

- **blob → descarga:** helper `triggerBlobDownload` (objectURL → `<a download>` → revoke). El nombre lo dicta
  el **backend por `Content-Disposition`** (`inventario-YYYY-MM-DD.xlsx`), que `requestBlob` parsea y devuelve
  como `filename`; si no viniera, cae al nombre propio `inventario-tcghunt-YYYYMMDD.xlsx` (`exportFilename`).
- **Estados:** botón con `loading` («Exportando…») + `disabled`; error → toast `danger` legible
  (`exportXlsx.error`); éxito → toast `success`.
- **Endpoint consumido (backend YA implementado):** `GET /admin/inventory/export.xlsx`
  (query `setId/status/productType/finish/q`) → binario xlsx. API `exportAdminInventoryXlsx` (`api.ts`)
  devuelve `{ blob, filename }` vía el helper `requestBlob` de `api-client.ts` (fetch binario autenticado, sin
  interceptor de refresh; errores → mismo `ApiClientError`; parsea `filename`/`filename*` del
  `Content-Disposition`). Mock genera un blob con MIME de xlsx (contenido demo) y `filename: null`.

### i18n
Nuevas claves en `messages/{es,en}.json`: `admin.quickRemove.*` (incl. `insufficientStock`),
`admin.drawer.removeQuick`, `admin.inventory.exportXlsx.*`. `error.ITEM_NOT_ADJUSTABLE` ya existía y se reusa.

### Reconciliación con el backend (2026-08-22)
Ambos endpoints los **implementó el backend**; el front se alineó a sus shapes EXACTOS (backend = fuente):
- **P-29:** se quitó `sealedSubtype`, `batchKey` y todo el manejo de `idempotentReplay` (la baja es atómica);
  `reason` pasó a **obligatorio**; el resumen se lee de `{ removed, requested, folios }`; se añadió el manejo
  legible de `INSUFFICIENT_STOCK`/`ITEM_NOT_ADJUSTABLE`. La rama «baja parcial» se eliminó (imposible con la
  atomicidad: en 200 siempre `removed === requested`).
- **P-31:** `requestBlob`/`exportAdminInventoryXlsx` devuelven `{ blob, filename }`; el front usa el
  `filename` del `Content-Disposition` del backend y sólo cae a su nombre propio si no viene.

### Gates
`tsc --noEmit` ✓ · `next lint` sin warnings/errores ✓ · `next build` ✓ · `vitest run` **584/584** verdes
(71 archivos), incluidos los nuevos: `QuickRemove.test.tsx` (7) y P-31 en `M1View.test.tsx` (3, total 25).

---

## §21 · P-28 (dos carritos en «Vender») + P-33 (retiro del selector de proveedor de respaldo) (2026-08-22, branch `fix/variant-composition-regression`)

### P-28 · Los dos carritos de «Vender» ya no compiten

**Diagnóstico (leído del código):** son **dos carritos DISTINTOS**, no un mismo carrito desincronizado.
- **Header «CARRITO N»** = carrito de **COMPRA/tienda** (`useCart` en `src/lib/cart.ts`, persistido en
  `localStorage` `tcg.cart` por `inventoryItemId`; el botón enlaza a `/checkout`). Pintado por
  `StorefrontHeader.tsx`, etiqueta `nav.cart` = «Carrito».
- **FAB flotante «M»** = carrito de **VENTA/cotización** (`useSellCart` en
  `(storefront)/buylist/useSellCart.ts`, render `SellCartFab` + `SellCartDrawer` desde `BuylistView.tsx`).
  Su `aria-label` ya decía «Carrito de venta».

Coexisten en `/buylist` con contadores independientes (compra=1, venta=5) → se lee como un mismo carrito
descuadrado. **No hay bug de estado**: cada uno es su propia fuente y ambos son correctos por separado.

**Arreglo (mínimo, sin tokens nuevos, money-safe — solo UI):** en el flujo de venta se deja **UN SOLO
carrito en pantalla**. `StorefrontHeader.tsx` deriva `onSellFlow = pathname.startsWith('/buylist')` (el
header ya usa `usePathname` de `@/i18n/navigation`, locale-stripped) y **oculta el botón de carrito de
compra** (desktop **y** menú móvil) en esa ruta. El carrito de compra no se pierde: vive en `localStorage`
y reaparece en el resto de la tienda. Así «CARRITO 1» ya no compite con el «5» del cotizador; el único
carrito visible en Vender es el FAB de venta. (Se evaluó relabelar globalmente el carrito de compra, pero
el nav ya tiene «Compra» y «Vender»; ocultar en la ruta de venta es lo más limpio y no cambia copy global
que es propiedad de ux-ui.)
- **Tests:** `StorefrontHeader.test.tsx` — mock de `usePathname` vuelto **mutable** (`mockPathname`); dos
  casos nuevos: fuera de venta (`/catalog`) el carrito de compra aparece con `href=/checkout`; en `/buylist`
  el link «Carrito» **no** está en el DOM.

### P-33 · Retiro del selector de «proveedor de respaldo» de Ingesta de precios (M2)

Decisión del humano: **quitar** el `Select` de «Proveedor de respaldo (fallback)» del panel M2. La ingesta
a mano («Actualizar precios ahora», `PriceIngestSection` / Sección 1) **se queda**. TCGCSV sigue primario y
PPT queda fijo como respaldo **en el backend**, sin control en UI. **NO se tocó la precedencia del backend**
(solo la UI).

- **Sección 3b eliminada entera:** el archivo `sections/PriceProviderSection.tsx` era 100% el control del
  dial (fila fija «Fuente primaria TCGCSV» + `Select` de respaldo + línea de precedencia). Se **borró** el
  archivo y su import/render en `M2View.tsx`.
- **Wrappers de API huérfanos retirados** de `src/lib/api.ts`: `getPriceProvider`/`updatePriceProvider` y el
  import del tipo `PriceProvider` (solo los usaba esa sección). El tipo `PriceProvider` y el campo
  `SettingsDTO.priceProvider` **se conservan** en `contract.ts` (el setting sigue existiendo en el backend,
  solo deja de exponerse en el front).
- **`PRICE_PROVIDERS`** (const del dial) retirado de `sections/shared.tsx` junto con su import de tipo.
- **i18n:** se quitaron las claves huérfanas del grupo `admin.m2.priceIngest` (`title`, `subtitle`,
  `primarySource*`, `fallbackLabel`, `providerOptions`, `fallbackHint`, `precedenceHint`, `providerSaved`)
  en `es.json` y `en.json`. Se conservan las claves de la ingesta a mano (`trigger`, `triggerHint`,
  `queued`, `alreadyRunning`, `sweep*`, `daily*`) que usa `PriceIngestSection`.
- **La línea informativa «FUENTE PRIMARIA TCGCSV → respaldo PPT» se retiró** (no se dejó como texto
  estático): la ingesta ya se explica en la Sección 1 y sin control asociado la línea sobraba.
- **Tests:** `M2View.test.tsx` — el test del selector se reemplazó por un **regression test P-33** que
  asevera que ni el `Select` «Proveedor de respaldo (fallback)» ni el encabezado/precedencia de la sección
  aparecen ya en el DOM (y que «Actualizar precios ahora» sigue). Import de `mockSettings` retirado (quedó
  huérfano).

> **Nota al arquitecto (no bloqueante):** el DESIGN_SYSTEM §19.7 aún describe el «reencuadre del selector de
> proveedor de respaldo» como parte del panel M2. Con P-33 ese control desaparece de la UI (el setting sigue
> en backend, fijo en PPT). Conviene que ux-ui actualice §19.7 para reflejar que la fuente/respaldo ya no
> tiene control en pantalla. No cambia el contrato (`SettingsDTO.priceProvider` intacto).

## §20 · Master Set combinado multi-parte (P-27, v1.33) (2026-08-22, branch `fix/variant-composition-regression`)

Implementa la parte FRONTEND de P-27 contra el contrato **v1.33-master-set-multipart** y ARCHITECTURE
§4.31. Un set multi-parte (Celebrations `cel25` + Classic Collection `cel25c` = 50) se presenta como **UN
master combinado**. **Todo aditivo/retrocompatible**: un set de una sola parte **no cambia**. Money-safe:
el mapa es solo presentación; el front nunca lo trata como fuente de verdad (lee `partSetId`/`parts` del
DTO, no re-llavea nada).

- **Tipos nuevos (`src/types/contract.ts`, aditivos):** `SetPartDTO`; `MasterSetCardCellDTO += { partSetId?,
  partLabel? }`; `MasterSetBinderResponse += { parts?, canonicalSetId? }`; `MasterSetSummaryDTO += {
  partSetIds? }`; `CardSetDTO += { partSetIds? }` (para el plegado de dropdowns). Todos opcionales.
- **Binder combinado (`MasterSetBinder.tsx`):** cuando la respuesta trae `parts`, las celdas se agrupan por
  `partSetId` en **secciones por bloque** (principal primero, luego cada subset en su `order`) con un
  **separador** `PartSeparator` (etiqueta mono en versalitas + la regla del sistema `--rule` + subtotal de
  cartas del bloque — sin cajas ni sombras, DESIGN_SYSTEM §2.2). El re-orden en cliente pasó de
  `compareCardNumber` a **`(partOrder, compareCardNumber)`** para que los bloques no se intercalen (la
  colisión de numeración entre partes —dos "#1"— queda separada por bloque, §4.31f). **Sin `parts`** ⇒ una
  sola sección **sin encabezado** ⇒ render idéntico a hoy.
- **Completitud (encabezado «cubiertas/esperadas · %»):** se sigue derivando de `cells` (suma de
  expected/coveredVariantCount). Como el fan-in ya trae las celdas de todas las partes, el encabezado
  refleja las **50** sin código extra. Money-safe visual intacto (sin precio → "—", nunca $0).
- **`canonicalSetId` (navegación):** si el binder se pidió por un **subset**, el backend normaliza al
  principal y devuelve `canonicalSetId`. El binder toma el **nombre del principal** (`data.set.name`) para
  el título y notifica `onCanonicalResolved`; `MasterSetPanel` **canoniza `selectedSet`** (id+nombre del
  master) para que la selección/estado —y cualquier URL derivada— apunte al set combinado (evita el binder
  roto de 25). En un state-driven panel no hay `router.replace`; el estado ES la fuente de la vista.
- **Índice / dropdowns (entrada combinada ÚNICA):** el mock de `mockMasterSetIndex` **pliega** el subset en
  la fila del principal (suma agregados → 50, recomputa %, añade `partSetIds`, excluye el subset como fila).
  `MasterSetIndex.tsx` pinta un badge **«Combinado»** cuando `partSetIds.length > 1`. Los dropdowns de
  **Compra** (`getSets`/`GET /catalog/sets`) y **cotizador** (`listBuylistSets`/`GET /buylist/sets`) usan
  `foldSetsForDropdown` (Celebrations una vez, con `partSetIds`); `searchBuylistCards`/`GET /buylist/cards`
  **expande** `setId` del principal a `IN partSetIds` (`expandSetIdFilter`) para listar las cartas de todas
  las partes. **CA-71:** si el principal no está importado, el subset **no** se pliega (queda como su set).
- **Mock (`src/lib/mock/fixtures.ts`):** mapa curado `MASTER_SET_GROUPS` (espeja
  `backend/src/config/master-set-groups.ts`) + helpers (`masterPartSetIds`, `normalizeMasterSetId`,
  `expandSetIdFilter`, `foldSetsForDropdown`). Sets `cel25`/`cel25c` + 25 cartas holofoil por parte
  (numeración colisiona a propósito). `mockMasterSetBinder` hace fan-in por partes con `partSetId`/`parts`/
  `canonicalSetId`; `SET_PRINTED_TOTAL` = 25 por parte → binder combinado reporta Σ = 50.
- **Gates:** `tsc --noEmit` limpio, `eslint` limpio, `next build` OK, `vitest run` **572 verdes** (568
  base + 4 nuevos en `MasterSet.test.tsx`: binder combinado 50 con separador; set de una sola parte sin
  cambio; plegado del índice/dropdown con entrada combinada única; navegación por `canonicalSetId`).
- **Desalineaciones con el contrato:** ninguna. Los DTOs consumidos (`parts`, `partSetId`/`partLabel`,
  `canonicalSetId`, `partSetIds`) coinciden con el shape v1.33 (§DTOs líneas 1388-1416). El backend implementa
  el mismo contrato en paralelo; los tipos/mocks del front están listos para conmutar a `useMocks=false`.

## §19 · Reorganización del panel M2 (catálogo/precios) + «Unificar rarezas» (2026-08-22, branch `fix/variant-composition-regression`)

Implementa `DESIGN_SYSTEM.md §19` (v1.9). Reordena las 9 acciones de import/precio de `M2View.tsx` en
**tres grupos con peso decreciente**, ancla el nuevo **«Unificar rarezas»** al editor de reglas por
rareza, retira lo muerto/legacy y reencuadra el selector de proveedor. **Cero cambios de contrato**
salvo el endpoint aditivo de unify (ya especificado por backend en `BACKEND_NOTES §0-ter`).

- **Tres grupos (`M2View.tsx`), debajo de los editores de precio:**
  - **G1 «Datos (rápido · TCGCSV)»** — `<section role="group" aria-labelledby>` destacado (eyebrow +
    h2 + subtítulo con la garantía «funcionan siempre»). Acción global **F** (`refreshVariantsAll`,
    `secondary`, confirmación) con etiqueta corta `catalog.refreshVariantsAllShort`; el «(solo TCGCSV)»
    se movió del botón al subtítulo del grupo. **La tabla de sets ÚNICA vive aquí** (anclada a Datos): su
    acción por-fila **primaria es I** (`refreshVariants`, `catalog.refreshVariantsShort`). El feedback
    de las acciones por-fila (I y H) se pinta junto a la tabla para que sea visible.
  - **G2 «Catálogo (cartas nuevas · usa fuente de catálogo)»** — `role="group"` con **Banner `info`
    persistente** (`groups.catalog.sourceWarning`, `role=status`) que avisa la dependencia de
    pokemontcg.io. Acciones globales **D** (`syncAll`) + **C** (`backfill`). Acción por-fila **G**
    (`catalogSync`, «Importar/Re-sincronizar»), secundaria. **Degradación reactiva (§19.3):** ante
    fuente no disponible (404/405) el warning ahora **reencamina a Datos** (`groups.catalog.sourceDownReroute`).
  - **G3 «Avanzado»** — `<details>` nativo **plegado por defecto** (`groups.advanced.summary`). Contiene
    la global **E** (`syncAllForce`, confirmación). La por-fila **H** (`fullSync`) se movió a un menú
    overflow **«Más ▾»** por-fila (`RowMoreMenu`, `aria-haspopup="menu"` + `aria-expanded`, `Esc`/click
    fuera cierran y devuelven foco; H es un `menuitem` con label completo). Su feedback se pinta en G1
    (junto a la tabla) para que no quede oculto tras el `<details>`.
  - **Orden por-fila:** I (1ª) → G (2ª) → H (overflow), reflejando la jerarquía de grupos.
- **«Unificar rarezas» (§19.5):** botón `secondary sm` (`Wand2`) **en el encabezado del editor de reglas
  de buylist** (Sección 4), no en Datos — el «por qué» solo se entiende viendo la lista fragmentada que
  limpia. Confirmación one-shot (modal). Consume `POST /admin/catalog/unify-rarities` (200, sin body) →
  `{ ok, cardsProcessed, cardsUpdated, distinctCanonical, unmapped: [{ raw, canonical, count }] }`
  (`UnifyRaritiesResponse` en `contract.ts`; wrapper `unifyRarities()` + mock en `api.ts`). Muestra un
  **resumen honesto** (cuántas actualizó + lista de `unmapped` para que el operador sepa qué añadir al
  catálogo canónico). Al éxito **invalida** `buylist-rarities`, `sales-rarities`, `buylist-rules`,
  `sales-rules` para recomponer el editor sin duplicados. Money-safe: local, one-shot, no toca precios.
- **Retirados (§19.6):** sección **B** «Sync de precios de bóveda» (`syncMutation`/`sync.launch`) — se
  eliminó el UI, el wrapper `syncPricing` y el tipo `PricingSyncResponse` (backend deja el endpoint
  `@deprecated`, no lo borra: su servicio es compartido con el cron `price-sync`). Restos de **`rarity-map`**
  (`RarityMapEntryDTO` en `contract.ts`, `mockRarityMap`/`setMockRarityMap` en fixtures, claves i18n
  `admin.m2.rarityMap.*` y `admin.m2.sync.*` + `advancedOps.*`). Verificado que nada más los consumía.
- **Selector de proveedor (§19.7):** fila fija no editable **«FUENTE PRIMARIA: TCGCSV»** + Select
  reetiquetado **«Proveedor de respaldo (fallback)»** + línea de **precedencia** «TCGCSV (primario) →
  respaldo: {selección} → override manual». Sin cambio de contrato (el dial `priceProvider` y sus
  valores no cambian). Claves nuevas `priceIngest.{primarySourceLabel,primarySourceValue,
  primarySourceHint,fallbackLabel,fallbackHint,precedenceHint}`; `providerLabel`/`providerHint` retiradas.
- **Estados/accesibilidad (§19.8/§19.9):** se conserva la serialización (`catalogBusy`/`batchBusy`/
  `otherPerSetPending`) y el keep-alive; confirmaciones para E, F y Unificar rarezas; `role="group"` por
  grupo, `<details>` para Avanzado, kebab con `aria-haspopup="menu"`; **motivos de deshabilitado en
  `aria-describedby`** (spans `sr-only` `m2-reason-needs-import` / `m2-reason-busy` + `title`).
- **i18n:** claves nuevas `admin.m2.groups.*`, `admin.m2.unifyRarities.*`, short labels de botón
  (`catalog.refreshVariantsShort/refreshVariantsAllShort/fullSyncMenuItem/rowMoreAria`), `catalog.setsEmpty`,
  `catalog.busyReason`. Paridad ES/EN verificada (`i18n-parity.test.ts` verde).
- **Gates:** `tsc --noEmit` ✅ · `next lint` ✅ (0 warnings) · `vitest run` ✅ **568/568** (M2 67/67, con
  tests nuevos/ajustados: grupos renderizados, «Unificar rarezas» dispara el endpoint + muestra `unmapped`
  + invalida rarezas, B/rarity-map ausentes, selector reencuadrado, H en menú «Más», F con etiqueta corta)
  · `next build` ✅.
- **Solicitud al arquitecto (no bloqueante):** el endpoint `POST /admin/catalog/unify-rarities` está
  implementado por backend pero **aún no formalizado en `docs/API_CONTRACT.md`** (backend lo dejó anotado
  en `BACKEND_NOTES §0-ter` como «pendiente de formalizar»). El front ya lo consume con el shape descrito;
  conviene que el arquitecto lo incorpore al contrato oficial. También queda pendiente (§19.11) la señal
  de salud de la fuente de catálogo (`source-health`) para volver el banner de G2 proactivo en vez de reactivo.

## P-13 · «Refrescar variantes + precios (solo TCGCSV)» por set en M2 (2026-08-22, branch `fix/variant-composition-regression`)

Tercera acción por-fila en el **Sync de catálogo** de M2 que refresca variantes/acabados y precios
de un set **ya importado** usando **SOLO TCGCSV**, sin pokemontcg.io. Motivación: hoy el «Sync
completo» encadena cartas (pokemontcg.io) + variantes/precios (TCGCSV), así que una caída de
pokemontcg.io **bloquea** arreglar el "fantasma" (variantes/precios faltantes) de un set ya en BD.
Esta acción desacopla ese arreglo del proveedor caído.

- **Contrato consumido (nuevo endpoint del backend):** `POST /admin/catalog/refresh-variants`, body
  `{ setId, force? }`. Respuesta **síncrona** `{ ok, setId, cardsProcessed, cardProductsUpserted,
  pricesUpserted, pending, tcgcsvReachable }` (NO es un job encolado: devuelve un resumen del trabajo).
  Errores del contrato: `SET_NOT_IMPORTED` (409, set no está en BD) y `UPSTREAM_ERROR` (502, TCGCSV
  no disponible). Tipado como `RefreshVariantsResponse` en `types/contract.ts`.
- **Wire (`lib/api.ts`):** `refreshVariants({ setId, force? })` → `apiRequest` POST; `force` solo se
  incluye en el body cuando es `true` (body mínimo por defecto). **Mock** con el shape del contrato:
  simula un refresh con `pending=1` (un producto sin precio) para ejercitar el reflejo money-safe
  honesto (no todo queda con precio).
- **UI (`M2View.tsx`):** botón `secondary` «Variantes + precios (solo TCGCSV)» (icono `RefreshCw`) en
  la columna de acciones por set, junto a «Importar/Re-sincronizar» y «Sync completo». Se **deshabilita
  para sets no importados** (evita el `SET_NOT_IMPORTED` obvio; explica el porqué en `title`) y se
  **serializa** con las otras dos operaciones por-set (una a la vez). El feedback es un **resumen
  honesto**: banner `success` si todo quedó con precio, `warning` («resultado parcial») si
  `tcgcsvReachable=false` o `pending>0`, con el conteo real de pendientes y el aviso de reintento. La
  mutación invalida `remote-sets` y `pending-prices`, y se suma a `catalogBusy` (keep-alive de sesión).
- **Texto claro:** el hint y el copy dejan explícito que **NO** re-importa cartas ni depende de
  pokemontcg.io (diferencia clave frente al «Sync completo»).
- **i18n:** nuevas claves en `messages/{es,en}.json` (`admin.m2.catalog.refreshVariants*`) y códigos de
  error legibles `error.SET_NOT_IMPORTED` / `error.UPSTREAM_ERROR`. Sin texto hardcodeado.
- **Tests (`M2View.test.tsx`, +6):** dispara `refreshVariants({setId})`; render del resumen; reflejo
  money-safe de `pending>0` y de `tcgcsvReachable=false`; render legible de `UPSTREAM_ERROR` (sin
  romper la pantalla) y de `SET_NOT_IMPORTED`; botón deshabilitado para set no importado.
- **Gates:** `tsc` limpio · `eslint` limpio · `next build` OK · suite **559 verde** (553 previos + 6).
- **Alineación con el contrato:** el shape se implementó exactamente como lo especificó el orquestador
  (backend en construcción). **Solicitud pendiente al arquitecto:** documentar formalmente
  `POST /admin/catalog/refresh-variants` + `RefreshVariantsResponse` y los códigos `SET_NOT_IMPORTED` /
  `UPSTREAM_ERROR` en `docs/API_CONTRACT.md`. Si backend ajusta el nombre del endpoint/campos o el
  status de los errores, realinear `refreshVariants` en `lib/api.ts` y los tipos.

## v1.30 (§4.29 / M-32) · Cotizar/vender un producto SEPARADO como línea propia por `productId` (2026-08-22, branch `fix/variant-composition-regression`)

Cierra el hueco que quedó tras v1.29 (§4.27): la **presentación** de productos separados
(`separateProducts: CardProductDTO[]`, `kind ∈ {deck_exclusive, promo}`) ya existía (`SeparateProductTile`),
pero la **línea de buylist** se identificaba solo por `(cardId, finish)` y no podía apuntar a un
`productId` → un Deck Exclusive/promo no era cotizable ni agregable como su propia línea. El
arquitecto cerró el contrato (v1.30, `productId?` aditivo) y aquí se cableó el FRONT.

- **Tipos (`types/contract.ts`, aditivos):** `productId?: number` en `BuylistQuoteItemDTO` (entrada
  del quote por-carta y del batch), en `BuylistQuoteResponse`/`BuylistQuotePayload` (eco) y en
  `SellItemDTO` (snapshot). `BuylistBatchQuoteResultDTO.error.code` gana `PRODUCT_NOT_FOUND` y
  `PRODUCT_CARD_MISMATCH`. `CreateSellRequestInput.items[]` y `BuylistRequestItem` ganan `productId?`.
  Todo opcional/retrocompatible: una línea sin `productId` = set_base, comportamiento v1.29 intacto.
- **Cotizador (`MasterSetBinder.tsx`, `mode="quoter"`):** `fetchQuoterBinder` ahora cotiza DOS clases
  de línea en el mismo `POST /buylist/quote/batch`: el set_base por `(carta, acabado)` y CADA producto
  separado por `(carta, productId, acabado)`. Como el `index` del batch no basta para correlacionar
  (base holofoil y producto holofoil de la misma carta comparten cardId+finish), se lleva un arreglo
  PARALELO de llaves con el `productId` incluido. Las cotizaciones de productos separados se guardan en
  un mapa client-only `separateProductQuotes` (por `${cardId}:${productId}:${finish}`) anexado a la
  respuesta del binder — misma doctrina que `variants[].quote` (no viaja del backend).
- **`SeparateProductTile`:** en modos de inventario/bóveda sigue siendo PRESENTACIÓN (precio de
  mercado propio, «—» sin precio). En `quoter` es COTIZABLE: pinta el ESTIMADO de buylist propio del
  producto (server-side por su `productId`) + botón «Agregar» que lo manda al carrito como su LÍNEA
  PROPIA. Money-safe: sin cotización OK el botón queda inhábil (nunca $0); una línea `precio_pendiente`
  SÍ es agregable (el backend fija su monto al recibir, como el set_base).
- **Carrito (`useSellCart.ts`):** la llave de dedup gana `productId` → `(cardId, productType, finish,
  productId ?? base)`. Dos líneas con el mismo `(cardId, finish)` y distinto `productId` son DISTINTAS
  (NO se fusionan); `requestItems` propaga el `productId` a `POST /buylist/requests`. El nombre de la
  línea de un producto separado es el del PRODUCTO (p. ej. «Charizard (Deck Exclusive)»).
- **Errores del contrato:** `PRODUCT_NOT_FOUND` / `PRODUCT_CARD_MISMATCH` se muestran como error de
  LÍNEA legible en la teja (i18n `masterSet.separateProductErrorCode.*` + catálogo `error.*`), sin
  romper el lote (en batch es error por-ítem; la carta base sigue cotizando).
- **i18n:** nuevas cadenas en `messages/{es,en}.json` (`masterSet.separateProductAddAria`,
  `separateProductError`, `separateProductErrorCode.*`; `error.PRODUCT_NOT_FOUND`,
  `error.PRODUCT_CARD_MISMATCH`). Sin texto hardcodeado.
- **Mocks (`lib/api.ts` + `lib/mock/fixtures.ts`):** `searchBuylistCards` ecoa `separateProducts` en
  `CardDTO`; `resolveSeparateProduct(cardId, productId)` distingue ok/mismatch/not_found; el batch y el
  quote por-carta cotizan el producto por su precio propio (pct sin referencia ⇒ `precio_pendiente`,
  nunca 0). Matiz preservado: el **batch** valida el acabado base ∈ `availableFinishes`; el **quote
  por-carta** no lo hacía (retrocompat de mock) — se conserva con un flag. La whitelist del PRODUCTO
  (`CardProduct.finishes`) SIEMPRE se valida (contrato §4.29).
- **Componentes COMPARTIDOS tocados** (`components/master-set/`, `lib/`, `hooks`-adyacentes): serializar
  el merge con cualquier otro stream que toque esas zonas.
- **Gates:** `tsc` limpio, `eslint .` limpio, `next build` ✓ compiled. Tests: **553 pasando** (548
  previos + 5 nuevos; se actualizó 1 test v1.29 de presentación a la semántica cotizable v1.30).
- **Sin bloqueos de contrato:** el shape v1.30 alcanzó para todo el flujo del front. El **carrito de
  storefront (compra)** NO necesita `productId` (se identifica por `inventoryItemId`, §4.29e) — fuera
  de alcance por diseño.

## Pulido precios/display (2026-08-19, branch `claude/pulido-precios-display`)

Tres tareas independientes de pulido de UI/UX.

### N-16 · Carta normal en el binder Master Set (quitar la agrupación por variante)
Antes (v1.22) cada carta se pintaba con UNA CASILLA DE IMAGEN POR VARIANTE (una imagen por
acabado), lo que visualmente "agrupaba" la carta en varias casillas. El PO pidió mostrar cada
carta como **carta normal**: UNA sola imagen. Como el binder Master Set es un **componente
COMPARTIDO** (`components/master-set/`) usado por las 4 vistas (§4.20f), el cambio se hizo en un
solo lugar y aplica a todas: cotizador (`mode="quoter"`), master set de inventario admin (M1),
Mi bóveda (`user_vault_self`) y bóvedas de cliente admin (`user_vault_admin`).
- **`MasterSetBinder.tsx`**: la cuadrícula pasa a un grid normal de tarjetas
  (`grid-cols-2 … xl:grid-cols-5`). `BinderCell` pinta UNA imagen (`CardTileImage`, antes
  `VariantImage`) + `#número` + completitud por variantes (`{covered}/{expected} casillas`) +
  badge secret rare + chips de drift; el desglose por acabado (conteos/huecos/compra/alta) vive en
  el drawer. `QuoterCell` pinta UNA imagen + botones de venta POR ACABADO en lista debajo (mismos
  `aria-label`/`onAddVariant` → carrito de venta intacto). Se eliminaron `slotCols`,
  `gridColsForSlots` y `slotGridStyle` (ya no hay retícula interna por casilla).
- **`CellDrawer.tsx`** (`VariantSlots`): el detalle deja de repetir la imagen por variante; ahora
  es UNA imagen de la carta + LISTA por acabado (etiqueta, conteo/hueco, CTA de compra en
  `user_vault_self`). Se conservan título "Casillas por acabado", CTA `buyable`/"No disponible" y
  todas las acciones de M1 (alta/publicación/ajuste) sin tocar.
- **Datos/contrato SIN cambios**: se sigue consumiendo `variants[]`/`availableFinishes` del
  contrato (completitud por variante) — solo cambia la PRESENTACIÓN a carta normal.
- Tests (`MasterSet.test.tsx`): se actualizaron las 2 aserciones de grid que exigían "una imagen
  por variante" a la nueva forma (1 imagen por celda; el desglose por acabado se verifica en el
  drawer). El resto (25 tests) verde.
- **Componente compartido tocado** (`components/master-set/`): serializar el merge con cualquier
  otro stream que toque esa carpeta.

### N-14 · Barra de progreso de precios (M2) que aparecía solo tras recargar
`M2View.tsx`: el `refetchInterval` de `price-sync-status` solo poll-eaba si YA había visto
`running:true`. Tras disparar el ingest, el job tarda un instante en marcar `running`, así que el
refetch inmediato veía `running:false`, el poll se apagaba y la barra no salía hasta recargar. Fix:
estado local `justDispatched` (se marca en `onSuccess` de `ingestMutation` junto con un `refetch()`
inmediato) que mantiene el poll vivo (`refetchInterval` considera `running || justDispatched`) hasta
que el barrido asome; al ver `running:true` se suelta la bandera (poll gobernado por `running`, se
detiene al terminar) y un `setTimeout` de 30 s la caduca como red anti-poll-infinito. Test de
regresión N-14 añadido (falla sin el fix).

### CTA del hero: alineación + relabel a "Tienda"
`(storefront)/page.tsx`: los dos CTA del hero ("Ir a la Tienda" botón negro y "Vender mis cartas"
link subrayado) no quedaban al mismo nivel — el link tenía `sm:pb-1.5` sin padding superior, así que
con `items-center` su texto quedaba ~3px arriba del centro del botón. Se cambió a `sm:py-1.5`
(padding vertical simétrico) → centros alineados (verificado con Playwright: delta 0.00px). Además,
como "Compra" ahora se llama **"Tienda"**, la clave i18n `home.ctaCatalog` se renombró a
`home.ctaShop` ("Ir a la Tienda" / "Go to Store") en `messages/es.json` y `en.json`.

## Fix M1 · alta de inventario (2026-08-18, branch `fix/m1-alta-inventario`)

Cuatro hallazgos del diagnóstico E2E (stack real, mocks OFF) sobre el ALTA de inventario admin.

### P-4 (BLOQUEANTE, bug de dinero) — el alta SIEMPRE da feedback visible
**Qué era en realidad:** con el tipo de adquisición **default "aportación en especie"** sobre una
carta SIN precio de referencia, `POST /admin/inventory/items` responde **422 `PRICE_PENDING`** (no
crea la pieza; el backend la deja en la cola de precios pendientes — comportamiento money-safe
intencional). El `Banner` de `create.isError` estaba renderizado al **final del cuerpo scrolleable**
del modal, fuera del viewport (y≈1242 con viewport 900) → el operador veía "que no pasa nada". El
caso "compra" (201) sí funcionaba.

**Resuelto (`M1View.tsx`):**
- **Error anclado ARRIBA (sticky):** el banner de error se movió al inicio del cuerpo del modal en
  un contenedor `sticky top-0 z-10` con `tabIndex=-1`; al fallar, un `useEffect` hace
  `scrollIntoView` + `focus()` al banner (a11y: `role="alert"`). Verificado en navegador: el alert
  queda en `y=114` con viewport 900 (dentro de vista, sin scroll).
- **Copy del OPERADOR, no de storefront:** el `error.PRICE_PENDING` global dice "…aún no se puede
  **comprar**" (lenguaje de tienda) y confunde en el alta. Se añadió un override de i18n SOLO-frontend
  `admin.m1.errorByCode.PRICE_PENDING` ("No se pudo dar de alta: esta carta aún no tiene precio de
  referencia; se envió a la cola de precios pendientes."). El helper `messageForCode()` prioriza
  `admin.m1.errorByCode.*` → `error.*` → mensaje real del backend. **No se tocó el `error.*` global**
  (lo usa el storefront/checkout).
- **Éxito con TOAST + refresco:** no había infra de toasts → se creó `components/ui/Toast.tsx`
  (`useToasts()` + `<Toaster>`), toast MÍNIMO reutilizable alineado a DESIGN_SYSTEM (bloque de tinta
  §7.2b, regla verde/bermellón por variante, mono versalitas, radio 0, portal a `<body>` en `z-[60]`
  para verse sobre el modal `z-50`, auto-cierre). El alta con éxito dispara un toast con el folio
  devuelto; se mantiene además el banner de éxito existente e `invalidateQueries(['admin-inventory'])`.
- No se tocó nada del backend money-safe.

### P-5 (mejora) — alta MASIVA (varias cartas en un envío)
Modo de **selección múltiple** opcional dentro del MISMO modal (checkbox "Seleccionar varias
cartas"): las filas del buscador pasan a checkbox, se arma un "carrito" de líneas y el botón primario
cambia a "Dar de alta N cartas". Reusa el endpoint de lote existente `batchCreateItems({ batchKey,
items })` (POST /admin/inventory/items/batch), con los mismos parámetros del formulario aplicados a
todas las cartas; el acabado se recorta **por-carta** (`finishForCard`) a la unión de acabados del
lote para no mandar un acabado inexistente. Resultado **tolerante por-ítem**: se pinta cada folio
creado (verde) y cada fallo con su motivo (reusa `messageForCode`), más un toast con el `summary`.
**Idempotencia** como MasterSetPanel: `batchKey` ESTABLE por sesión (ref), se renueva solo tras un
envío exitoso; el lote se **vacía siempre** al terminar (aun con fallos parciales) para no reenviar y
duplicar las líneas ya creadas. El alta de UNA sola carta sigue intacta.

### P-3 (pulido) — `PAGE_SIZE` del buscador del alta 20 → 50
Baja la fricción de "Cargar más" (un set de 120 cabe en 3 páginas, no 6; el backend topa en 100).
Verificado en navegador: sigue llegando a **120/120**.

### P-1 (pulido) — logout del back-office sin flash
`AdminTopbar.onLogout` ahora hace `router.replace('/login')` (antes `push('/')`): evita la carrera
con el guard del `AdminShell` que dejaba un flash "Verificando sesión…" y una URL `?next=`.

### Verificación en navegador (stack real, mocks OFF)
Script Playwright ad-hoc (scratchpad) contra `localhost:3000/es`, login `admin@e2e.local`, set de
prueba `Pitch Black TEST`:
- (a) aportación en especie → error CLARO anclado arriba (`y=114`, dentro de viewport 900).
- (b) compra → toast "ALTA REGISTRADA · folio INV-000002" + la pieza aparece en la tabla sin recargar
  (filas 8→9).
- (c) alta MASIVA (compra) → resultado por-ítem con 3 folios (INV-000003/004/005), lista refrescada,
  lote vaciado. Nota: con aportación el endpoint de LOTE **crea** las piezas (pendientes de precio) en
  vez de rechazarlas por-línea, así que no se reprodujo un fallo por-línea REAL en navegador; el
  render de fallos por-ítem queda cubierto por unit test (mock PRICE_PENDING).
- (d) P-3 → "120 de 120 cartas".

### Archivos
`app/[locale]/(admin)/admin/m1/M1View.tsx` (feedback sticky + toast + alta masiva + PAGE_SIZE 50),
`components/ui/Toast.tsx` (**nuevo**), `components/layout/AdminTopbar.tsx` (logout→/login),
`messages/{es,en}.json` (`admin.m1.errorByCode.*`, copy de toast/lote), `M1View.test.tsx` (+toast,
+2 alta masiva, PRICE_PENDING→copy admin, pageSize 50), `AdminTopbar.test.tsx` (replace→/login).

### Comportamiento alta simple vs. por lote (NO hay inconsistencia — aclaración)
Con adquisición `aportacion_en_especie` sobre carta **sin** precio de referencia, alta simple y por
lote **coinciden**: ambos **rechazan** la línea (no crean la pieza). Solo cambia la **forma de
reportarlo**, que es el patrón money-safe normal de cada endpoint:
- **`POST /admin/inventory/items`** (simple) → **422 `PRICE_PENDING`** de todo el request (no crea).
- **`POST /admin/inventory/items/batch`** (lote) → **HTTP 200** con esa línea en **`ok:false`
  `PRICE_PENDING`** (tolerancia por-ítem: no tumba las demás), y **NO** crea la pieza.

Verificado: backend `inventory.service.ts` → `batchCreate` llama `resolveCreation(line)` por línea, que
lanza `PRICE_PENDING` para aportación sin referencia; el `catch` del lote la marca `ok:false` (no crea).
QA lo confirmó contra el backend real (lote mixto de 4 líneas aportación, 2 con precio y 2 sin →
`summary: requested 4, createdItems 2, failedLines 2`; las 2 sin precio salieron `ok:false` PRICE_PENDING
sin crearse en BD). El front consume ambos tal cual. **No hay solicitud al arquitecto: no existe
divergencia que resolver.**

### Gates
`npm run typecheck` ✓ · `npm run lint` ✓ (0 warnings) · `npm run test` ✓ (50 archivos / 384 tests).

### Seguimiento (2026-08-18) — cierre de 2 hallazgos de dinero + 2 menores (post e2df8e0)

Cuatro FIX sobre el mismo alta M1 (solo `frontend/`), aprobado el commit previo por qa+techlead.

- **FIX 1 (dinero — integridad de inventario):** el alta MASIVA aplicaba `gradingCompany/gradeValue/
  certNumber` del formulario a TODAS las cartas del lote; para gradeadas el `certNumber` es **único por
  slab**, así que un lote de N gradeadas creaba N piezas con el **mismo certificado** (dato corrupto en
  inventario de alto valor). Solución mínima: la multi-selección se **deshabilita en `productType==='graded'`**
  (checkbox `disabled` + nota i18n `admin.m1.gradedNoBulk` es/en explicando el porqué) y al **cambiar a
  graded estando en modo masivo** se apaga `multiSelect` y se `clearBatch()` (no queda carrito de gradeadas
  armado). El alta simple de gradeada (con su cert único) sigue intacta. Verificado en navegador: en graded
  no hay botón "Dar de alta N cartas", solo "Crear item".
- **FIX 2 (dinero — base de costo/P&L):** abrir "Alta de item" reseteaba la mutación/lote pero **NO** los
  campos del formulario → la `acq` (que determina costo/origen, M7) se heredaba de la tanda anterior en
  silencio. Se añadió `resetAddForm()` (acq→`aportacion_en_especie`, productType→`raw`, finish→`normal`,
  sealedSubtype→`box`, gradingCompany→`PSA`, gradeValue→`10`, certNumber/listPrice→'', pct→`70`, y limpia
  set/búsqueda/carta/ubicación) invocado en el handler de apertura junto a los `reset()` existentes. **No se
  cambiaron los defaults iniciales.** Verificado: tras elegir "compra" y reabrir, el alta arranca en
  "Aportación en especie".
- **FIX 3 (cosmético):** el banner de error (P-4) repetía el prefijo — `title`="No se pudo dar de alta" y el
  cuerpo `errorByCode.PRICE_PENDING` **también** empezaba con "No se pudo dar de alta:". Se quitó el prefijo del
  cuerpo (es: "Esta carta aún no tiene precio de referencia; …"; en equivalente) → título corto + mensaje real,
  sin redundancia. Solo i18n. Verificado en navegador con 422 real.
- **FIX 4 (tests):** (a) el test rotulado "replay/idempotencia" solo enviaba UNA vez → **renombrado** a
  "vaciado tras éxito" y **añadidos dos tests separados**: uno prueba que tras un ÉXITO el `batchKey` se
  **renueva** (2ª tanda usa otra key), otro que un **reintento tras FALLO reusa** la misma key (idempotencia
  anti-doble-alta). (b) el test de éxito ahora **asserta la invalidación** de `['admin-inventory']`
  (spy sobre `QueryClient.prototype.invalidateQueries`). Suite M1: 21 tests verdes.

**Nota de contrato (sin cambios):** el FIX 1 es una restricción de UI de captura, no del contrato — el batch
endpoint sigue aceptando graded; simplemente el front deja de ofrecer ese camino peligroso. No hay solicitud al
arquitecto en este pase.

Gates de este pase: `typecheck` ✓ · `lint` ✓ (0 warnings) · `test` ✓ (**50 archivos / 387 tests**).
Evidencia navegador (stack real, mocks OFF, `admin@e2e.local`, set `Pitch Black TEST`): graded multi
deshabilitado, reset a "aportación en especie", banner sin repetir copy, y bulk raw con `compra` creando
folios reales (INV-000019/020) + refresco de la tabla.

## WS «Inventario y vault» — Master set en TODAS partes (2026-08-17, contrato v1.20-master-set-everywhere)

El binder Master Set deja de ser exclusivo de M1: los componentes se **promueven a
`frontend/src/components/master-set/`** (zona compartida, RESERVADA por este stream durante la
promoción, ARCHITECTURE §4.20f) y sirven las TRES vistas del contrato con el MISMO shape:
(i) M1 plataforma, (ii) admin viendo la bóveda de un cliente, (iii) el cliente viendo la suya.
Gates verdes: **lint 0**, **tsc 0**, **test 322/322** (43 files; +10 nuevos), **build OK**
(ruta `/[locale]/admin/vaults` registrada).

### Promoción de componentes (rutas viejas → nuevas)

`frontend/src/app/[locale]/(admin)/admin/m1/master-set/{MasterSetIndex,MasterSetBinder,MasterSetPanel,CellDrawer,PerLineErrors}.tsx`
y `capture.ts` → **`frontend/src/components/master-set/`** (mismos nombres) + nuevo `mode.ts`.
La carpeta vieja se eliminó; `M1View` importa `MasterSetPanel` desde `@/components/master-set/`.
`MasterSet.test.tsx` se movió junto a los componentes.

**Parametrización por scope/capacidades (props, §4.20f):** `MasterSetPanel` recibe
`mode: 'platform' | 'user_vault_admin' | 'user_vault_self'` (+ `userId?` en admin, + `onBuyMissing?`
en self). El componente NO decide permisos: renderiza lo que el DTO trae (el backend omite campos
por scope — `buyable` solo (iii), `owner.email` solo (ii)). Capacidades por modo:
- `platform` (M1, default): carrito de captura por lote, publicación masiva y **ajuste por
  levantamiento físico** (nuevo). Endpoints `/admin/inventory/master-sets[...]`.
- `user_vault_admin`: SOLO lectura (sin captura/publicación/ajuste/venta ni CTA de compra).
- `user_vault_self`: lectura + **CTA de compra en variantes faltantes** con `buyable`.

### Binder por VARIANTE (v1.20)

- Cada celda pinta **una casilla por acabado** (`variants[]`, universo = `availableFinishes`):
  cubierta → chip con conteo; faltante → chip **«HUECO»** por acabado (borde punteado, acento).
  El hueco TOTAL (0 variantes cubiertas) conserva la imagen de catálogo **atenuada** (grid visual).
- Los contadores «X/Y» cuentan **variantes**: índice usa `distinctVariantsOwned`/`catalogVariantCount`/
  `variantCompletionPct`; la celda usa `coveredVariantCount/expectedVariantCount`; el header del
  binder suma expected/covered de las celdas (no depende del summary del índice).
- **Drift de catálogo:** `countsByFinish` con acabado fuera del universo se pinta como chip
  atenuado con «⚠» (se VE la pieza pero no cuenta en covered/expected, regla del contrato).
- El filtro «Con huecos» ahora es por variante (≥1 casilla faltante); «Con piezas» = ≥1 cubierta.

### M1 · Ajuste por levantamiento físico (`POST /admin/inventory/adjustments`)

Sección nueva del `CellDrawer` (solo `platform`): **motivo OBLIGATORIO**
(`encontrada | perdida | danada | error_captura`, labels es/en en `masterSet.adjust.reason.*`).
- `encontrada` → alta mínima raw NM (acabado del universo + qty), `acquisitionType`
  `aportacion_en_especie` explícito (default del contrato). *Simplificación deliberada: el alta
  de una gradeada "encontrada" se hace por el alta normal de M1, no desde el ajuste.*
- `perdida | danada | error_captura` → select de pieza **elegible** (solo `in_stock|listed` de
  plataforma; `reserved` etc. ni se ofrecen) + **nota obligatoria** (el submit se deshabilita sin ella).
- Éxito → Banner con folios; error → Banner con `useErrorMessage` (nuevo copy
  `error.ITEM_NOT_ADJUSTABLE` es/en). **NO hay venta directa manual desde el binder** (contrato).

### Admin «Bóvedas de clientes» (`/[locale]/admin/vaults`)

Página nueva `(admin)/admin/vaults/{page,VaultsView}.tsx` + entrada en `AdminSidebar` (grupo
Operación, tras M1; clave `admin.modules.vaults`, `vault_operator+`, sin candado súper-admin):
- Lista `GET /admin/vaults` → `getAdminVaults({q,sort,page,pageSize})`: nombre, email, piezas,
  **valor estimado** (`formatMoneyCents`), conteo sin precio; orden `value_desc|pieces_desc|name_asc`
  (default `value_desc`) y paginación del contrato.
- Clic en cliente → `MasterSetPanel mode="user_vault_admin" userId=…` (binder de lectura,
  owner con email desde el DTO).

### Storefront «Mi bóveda» (vista (iii))

`VaultView` gana pestañas `Piezas ⇆ Master set` (mismo patrón tablist de M1). La pestaña Master
set monta `MasterSetPanel mode="user_vault_self"` con `onBuyMissing = useCart().add`: el CTA de
una variante faltante con `buyable` agrega la **pieza publicada** (`inventoryItemId`) al MISMO
carrito local/checkout del catálogo (`src/lib/cart.ts`, sin órdenes desde el binder);
`buyable=null` → «No disponible» (no clicable). Banner «Agregada al carrito de compra.» como
feedback. Sin acciones de venta/captura en vistas de cliente.

### Contrato consumido (nuevo en este stream)

- `GET /vault/master-sets[/:setId]` → `getVaultMasterSets` / `getVaultMasterSetBinder`.
- `GET /admin/vaults` → `getAdminVaults`; `GET /admin/vaults/:userId/master-sets[/:setId]` →
  `getAdminVaultMasterSets` / `getAdminVaultMasterSetBinder`.
- `POST /admin/inventory/adjustments` → `createInventoryAdjustment`.
- Tipos v1.20 en `contract.ts`: `MasterSetScope`, `VaultOwnerRefDTO`, `MasterSetVariantDTO`,
  extensiones de `MasterSetSummaryDTO`/`MasterSetCardCellDTO`/`MasterSet*Response`,
  `AdminVaultSummaryDTO/Sort/ListResponse`, `AdjustmentReason`,
  `InventoryAdjustmentRequest/Response`, `MovementReason += 'adjustment'`.
- Mocks (`fixtures.ts`, rama `config.useMocks`): `mockMasterSetIndex/Binder` ganan **scope**
  (`MockMasterSetScope`), `variants[]`+`buyable` (pieza `listed` más barata desde `mockListings`),
  `mockVaultHoldingsByUser` (u-777 = mockHoldings, u-778 chica), `mockAdminVaults`,
  `mockCreateAdjustment` (muta status + `pushMockMovement(reason:'adjustment')`), y
  `ApiFixtureError` genérico (status+code) traducido a `ApiClientError` en `api.ts`.

### i18n

El subtree `admin.m1.masterSet` se movió a **`masterSet.*` top-level** (los componentes ahora son
compartidos storefront+admin; el DESIGN_SYSTEM exige claves por superficie y `admin.*` ya no
aplicaba). Claves nuevas: `masterSet.{variantCount,finishGapAria,driftChipAria,driftNote,ownerVault,
variantsTitle,buyCta,buyAdded,notAvailable}`, `masterSet.adjust.*`, `vault.tabs.*`,
`admin.modules.vaults`, `admin.vaults.*`, `error.ITEM_NOT_ADJUSTABLE`. `completionValue` pasa de
«{owned}/{total} cartas» a «{owned}/{total} variantes». Paridad ES/EN verificada por
`i18n-parity.test.ts`. Los labels del formulario de captura (solo modo platform) siguen en
`admin.m1.*` (M1View los usa también).

### Tests (nuevos/ajustados)

`components/master-set/MasterSet.test.tsx` (12): contador por variantes (3/13 · 23.1%), casilla
HUECO por acabado + `2/3 casillas`, orden natural, captura por lote y bulk-publish (sin cambios de
comportamiento), ajuste (perdida con pieza+nota, encontrada con payload de alta, error
`ITEM_NOT_ADJUSTABLE` traducido), modo admin lectura (owner con email; sin captura/publicación/
ajuste/CTA), modo self (CTA comprable → `onBuyMissing('inv-1003')` vs «No disponible»; índice solo
sets con piezas propias). `VaultsView.test.tsx` (2): lista + drill-down lectura.
`VaultView.test.tsx` (+1): pestaña Master set. Comandos reales: `npm run lint` (0), `npx tsc
--noEmit` (0), `npm test` (43 files / 322 pass), `npm run build` (OK).

### Cierre v1.20.1-adjustments-clarify (2026-08-17, post-gates)

Adaptación al changelog **v1.20.1** del contrato (ajuste por levantamiento físico, §M1):

- **Response nuevo** (`contract.ts`): `InventoryAdjustmentResponse` pasa a `adjustmentIds: string[]`
  (SUSTITUYE al singular `adjustmentId`, alineado 1:1 con `inventoryItemIds`/`folios`; longitud 1 en
  motivos ≠ encontrada) + `idempotentReplay: boolean`. `InventoryAdjustmentRequest` gana `batchKey?`
  SOLO en la rama `encontrada`.
- **batchKey ESTABLE por intento** (`CellDrawer.tsx`, sección de ajuste): en `encontrada` el drawer
  SIEMPRE manda `batchKey` (obligación del front por contrato, cierra BE-47). La clave se genera con
  `localUid('adj')` al montar y **solo rota tras un submit exitoso** (fresco o replay): un doble
  submit / retry tras error reusa la MISMA clave → el backend hace replay idempotente y no duplica
  piezas ni filas de ajuste. Mismo mecanismo `localUid` que el alta por lote (`capture.ts`). Los
  motivos `perdida|danada|error_captura` NO llevan batchKey (400 si viaja; su replay cae en
  `422 ITEM_NOT_ADJUSTABLE`, idempotencia natural).
- **Replay sin efectos dobles:** con `idempotentReplay: true` el drawer muestra el MISMO éxito (un
  solo Banner con folios, sin aviso duplicado) y **NO** refresca agregados (`pieces.refetch()` /
  `onAdjusted` solo corren en procesamiento nuevo — nada cambió en el servidor).
- **Mock** (`fixtures.ts`): `mockCreateAdjustment` devuelve el shape v1.20.1 y replica la
  idempotencia con `mockAdjustmentStore` (batchKey → respuesta guardada; replay con
  `idempotentReplay:true` sin re-crear), espejo de `mockBatchStore` del alta por lote.
- **Tests** (`MasterSet.test.tsx`, 17 specs = +2): payload de `encontrada` CON `batchKey`
  (`expect.stringMatching(/^adj-/)`); batchKey estable en retry tras error y rotación tras éxito;
  replay → mismo éxito sin re-consultar piezas (`getAdminInventory` no vuelve a llamarse). Gates
  reales: `npx tsc --noEmit` 0 · `npm run lint` 0 · `npm test` **43 files / 324 pass** · `npm run
  build` OK.
- **Deuda del veredicto techlead** anotada en `docs/TECH_DEBT.md`: **FE-25** (props de
  `MasterSetPanel` permiten estados ilegales → unión discriminada sin default de `mode`) y **FE-26**
  (`PlatformPiecesSection` acumula publicación+ajuste; extraer `AdjustSection` y eliminar el estado
  derivado de `adjustFinish`). Abiertas, no bloqueantes.

### Notas para QA / arquitecto

- Sin desviaciones de contrato. El CTA de compra vive en el **drawer** de la celda (la celda del
  grid abre el drawer, patrón existente); el contrato solo exige que el clic agregue la pieza al
  flujo de compra normal, y así se hace (carrito local → checkout §4).
- Los E2E Playwright existentes (`e2e/*.spec.ts`) no referencian las claves movidas; pendiente de
  QA correr smoke E2E de los flujos tocados contra el stack levantado.

### Merge con main (2026-08-17): integración con «Catálogo y precios» / WS-H retiros

Al integrar este stream con `main` (que traía WS-H retiros v1.17 y el pulido de veredicto WS-E),
los cambios de main sobre la ruta VIEJA `(admin)/admin/m1/master-set/` se **portaron a los
componentes promovidos** `components/master-set/`:
- `MasterSetPanel`/`CellDrawer`: **batchKey estable por sesión** también en captura por lote
  (`batchKeyRef`/`ensureBatchKey`) y en bulk-publish (`publishKeyRef`) — el patrón que ya usábamos
  en el ajuste (`localUid('adj')`) queda ahora en las tres mutaciones idempotentes.
- `CellDrawer`: **piezas no-publicables deshabilitadas** (checkbox `disabled` + hint
  `masterSet.notPublishableHint`, `PUBLISHABLE_STATUSES = ['in_stock','listed']`).
- `MasterSetBinder`/`CellDrawer`: `FINISH_ORDER` desde el módulo único **`@/lib/finish`** (dedup
  de main) en lugar de las consts locales.
- `MasterSet.test.tsx`: se portó el test de checkbox deshabilitado (reemplaza al de
  ITEM_NOT_PUBLISHABLE por-línea vía UI, inalcanzable con la nueva UX) y el de batchKey estable de
  carrito. i18n: `notPublishableHint` se agregó al namespace top-level `masterSet.*` (el subtree
  `admin.m1.masterSet` de main se descartó: ya no existe ningún consumidor).
- Interacción real entre streams: el holding mock `inv-3001` (`mockVaultHoldingsByUser`, este
  stream) ganó los campos v1.17 requeridos (`shipmentState:null`, `activeShipmentId:null`,
  `withdrawable:true`).
- Renumeración post-merge: contrato v1.18→**v1.20** / v1.18.1→**v1.20.1**, ARCHITECTURE
  §4.18→**§4.20**, migración M-22 (inventory)→**M-24**, deuda FE-20/FE-21→**FE-25/FE-26**,
  BE-41→BE-47. Gates del árbol mergeado: **tsc 0 · test 341/341 (45 files) · lint 0 · build OK**.

## WS-H frontend · Retiro visible para el cliente (badge "EN RETIRO" + rastreo) (2026-08-17)

Implementa el ciclo de RETIRO visible en la bóveda según **contrato v1.17-withdrawal-lifecycle** (§3
HoldingDTO, §5 rastreo del cliente). Solo `frontend/` + este doc. **0 cambios de contrato/backend**; se
consume el contrato como interfaz (nada depende de detalles internos del backend). Patrón real+mock
(`config.useMocks`), tokens/`shadow-focus` respetados. Gates: **tsc 0**, **vitest 313** (42 files),
**e2e mock 45 passed** (1 flake de `auth.spec` que pasa al re-correr; no relacionado).

### 1) Tipos (contrato §3/§5) — `src/types/contract.ts`
- `HoldingDTO` gana `shipmentState: ShipmentActiveStage | null`, `activeShipmentId: string | null`,
  `withdrawable: boolean` (los tres **requeridos**, como el contrato). Nuevo alias
  `ShipmentActiveStage = 'solicitado'|'picking'|'guia'|'enviado'`.
- `ShipmentDTO` (== `ClientShipmentDTO` del contrato §5) se **enriquece** con `addressSnapshot`,
  montos (`shippingFeeCents/ivaCents/processingFeeCents/totalCents`), timestamps por etapa
  (`requestedAt/pickingAt/shippedAt`, `deliveredAt` ya existía) e `items[].finish`. Los campos nuevos
  son **opcionales** para tolerar productores/mocks parciales (p. ej. la respuesta de captura de guía M4).

### 2) "Mi Bóveda" (`vault/VaultView.tsx` + `components/domain/WithdrawalBadge.tsx`)
- **Badge "EN RETIRO":** nuevo `WithdrawalBadge` (reusa el primitivo `Badge`, texto mono en versalitas,
  `outline` acento) que se pinta cuando `shipmentState !== null`: chip `EN RETIRO` + el **label de etapa
  del contrato §5** (namespace i18n `shipmentStage.*`, distinto de `status.shipment.*` operativo). Con
  `activeShipmentId`, el badge es un **enlace** al detalle del retiro (`/shipments/:id`) = deep-link
  bóveda→rastreo. Se apila bajo el badge de titularidad en la columna de estado.
- **Gating de RETIRAR:** el botón/enlace usa **`withdrawable`** como fuente ÚNICA de verdad (antes se
  derivaba de `ownershipStatus==='settled'`). Si `!withdrawable` → botón deshabilitado con hint accesible
  (`title` + `aria-label`): "en retiro" si hay envío activo, "solo liquidadas" si aún es `pending`. Ya no
  se descubre el `409/422` al intentar.

### 3) Rastreo de retiros del cliente (contrato §5)
- **`api.ts`:** `getShipments()` (ya existía, envelope `{ data }`) + nuevo **`getShipment(id)`**
  (`GET /shipments/:id`) con rama real+mock.
- **Lista ("Mis retiros"):** la sección de `ShipmentsView` se enriquece — cada retiro muestra la **etapa
  legible** (`shipmentStage.*`), dirección (ciudad/estado del `addressSnapshot`), **total** del retiro,
  guía/tracking y sus **cartas** (folio, nombre, set). El id del retiro es un **deep-link** al detalle.
  La lista de cartas y las acciones de disputa (F6) se **unificaron** en un solo `<ul>` (antes duplicaban
  el nombre de cada carta en dos bloques). La lista **seleccionable** del alta de retiro ahora filtra por
  `withdrawable` (un item settled pero ya EN RETIRO cae en "no elegibles", con su badge + deep-link).
- **Detalle (`shipments/[id]/ShipmentDetailView.tsx`, ruta nueva `shipments/[id]/page.tsx`):** destino del
  deep-link. Muestra la etapa legible, la línea de tiempo (`useShipmentClientSteps` con la tabla §5),
  dirección (snapshot, lectura defensiva), total desglosado (`AmountBreakdown` reconstruido desde los
  montos del DTO; `ivaRatePct` no viaja en §5 → se deriva de iva/fee, default 16) y las cartas
  (folio, nombre, set, número, acabado). Estados carga/error/no-encontrado explícitos (`QueryState`).
- **Navegación:** "Mis retiros" añadido al `StorefrontHeader` (privado, junto a "Mis órdenes") → `/shipments`.

### 4) i18n (ES/EN, paridad verde)
- `nav.shipments`, `vault.inWithdrawal` / `inWithdrawalHint` / `trackWithdrawal`,
  `shipments.{backToList,detailTitle,itemsInWithdrawal,shippingAddress,addressUnavailable,withdrawalTotal}`,
  y el bloque top-level **`shipmentStage.*`** (tabla normativa etapa→texto cliente del contrato §5).

### 5) Mocks (real+mock siguen funcionando)
- `mockHoldings`: los 4 holdings ganan los campos v1.17; el **sellado (`inv-1008`) queda EN RETIRO**
  (`shipmentState='enviado'`, `activeShipmentId='shp-7001'`, `withdrawable=false`); el resto retirables/
  pending según su titularidad. `mockShipments` enriquecidos (address/montos/timestamps/finish); `shp-7001`
  (`enviado`) contiene `inv-1008` para que el deep-link sea consistente.

### 6) E2E (mock)
- `e2e/vault.spec.ts`: +2 tests — badge "EN RETIRO" + etapa + RETIRAR deshabilitado; deep-link del badge al
  detalle. `e2e/shipments.spec.ts`: +1 — la vista de rastreo lista un retiro con sus cartas y abre el
  detalle (dirección + cartas). Todos mock-only (dependen del fixture de retiros); el patrón `@real`
  existente se conserva.

### Solicitudes al arquitecto
- Ninguna. El contrato v1.17 (§3/§5) fue suficiente para implementar el flujo completo. Nota menor: el DTO
  de rastreo §5 no incluye `ivaRatePct` en los montos; el front lo deriva de `iva/shippingFee` (default 16)
  para el desglose. Si se prefiere exponerlo explícito, sería un aditivo sin migración (no bloquea).

## WS-E frontend · Pulido de veredicto (batchKey estable + UX bulk-publish + dedup) (2026-08-17)

Cierra hallazgos NO bloqueantes del veredicto sobre WS-E (Master Set). Solo `frontend/` + este doc +
`docs/TECH_DEBT.md`. **0 cambios de contrato/backend**; no toca lógica de dinero (SEC-A1 intacto: el
precio de venta lo deriva el backend). Patrón real+mock, tokens y `shadow-focus` respetados. Gates
verdes: **lint 0**, **tsc 0**, **test 313** (42 files; +1 neto: se reemplazó 1 test y se añadieron 2),
**build** OK.

### 1) [techlead #1] `batchKey` ESTABLE por sesión de carrito (anti-duplicado)
- **Problema:** `batchKey` se generaba con `localUid()` DENTRO del `mutationFn` en cada `.mutate()`
  (`MasterSetPanel` carrito y `CellDrawer` bulk-publish). Un request que expira por red pero SÍ se
  procesó, al reintentarse generaba una key NUEVA → el backend ya no lo veía como replay → **piezas
  duplicadas** (la `batchKey` es la guardia anti-duplicado server-side).
- **Fix (`MasterSetPanel.tsx`):** `batchKeyRef = useRef<string|null>(null)` + `ensureBatchKey()` que
  la genera UNA vez (al empezar a llenar el carrito, en `addToCart`, y como fallback en `mutationFn`).
  Se **regenera solo tras éxito confirmado** (`onSuccess`, tras limpiar el carrito → `batchKeyRef.current
  = null`) o al vaciar el carrito manualmente (`clearCart`). Un reintento por timeout reusa la MISMA key
  → replay idempotente → no duplica.
- **Fix (`CellDrawer.tsx`):** mismo patrón con `publishKeyRef`/`ensurePublishKey()` para el bulk-publish;
  se renueva tras un éxito confirmado (tras limpiar la selección).

### 2) [qa MENOR] Deshabilitar piezas no-publicables en el bulk-publish del `CellDrawer`
- La lista de piezas trae TODOS los status; solo `{in_stock, listed}` son publicables (contrato §M1
  v1.16.1). Ahora el checkbox de una pieza cuyo status NO está en ese conjunto se **deshabilita** (input
  `disabled` + fila `opacity-60`/`cursor-not-allowed`) con un **hint** (`notPublishableHint`) del porqué.
  Const `PUBLISHABLE_STATUSES: InventoryStatus[] = ['in_stock','listed']`. El guardarraíl server-side
  (`ITEM_NOT_PUBLISHABLE`) se queda; esto es solo UX para no ofrecer una acción que va a fallar.

### 3) [techlead #3] Dedup de `FINISH_ORDER`
- Estaba triplicada (M1View / MasterSetBinder / CellDrawer) y además en ShopFilters / BuylistView (5
  copias). Se movió a un módulo único **`@/lib/finish.ts`** (`export const FINISH_ORDER`) y se importa en
  los **5** consumidores. `Finish` (tipo) se quitó del import de `ShopFilters` por quedar sin uso.

### i18n (paridad ES/EN)
`admin.m1.masterSet.notPublishableHint` (ES/EN).

### Tests (`MasterSet.test.tsx`)
- **batchKey estable:** el reintento del mismo submit lógico reusa la MISMA key (mock que "expira" en la
  1ª llamada); un carrito nuevo tras éxito → key NUEVA.
- **bulk-publish UX:** el checkbox de la pieza `reserved` (INV-000203) está `disabled` + muestra el hint;
  la `in_stock` (INV-000201) queda habilitada y el lote solo incluye la publicable. (Reemplaza al test
  previo de ITEM_NOT_PUBLISHABLE por-línea vía UI, ya inalcanzable al no poder marcar la reservada; la
  tolerancia por-línea sigue cubierta por el test de PRICE_PENDING.)

### Sin solicitudes al arquitecto
0 cambios de contrato/backend. Deuda FE no bloqueante restante registrada en `docs/TECH_DEBT.md`.

## WS-E frontend — Master Set + captura/publicación por lote (2026-08-17, contrato §M1 v1.16.1)

Vista **Master Set** en M1 (índice de sets → binder por número) + **carrito de captura por lote** (#12)
y **publicación masiva** (bulk-publish), contra los 4 endpoints nuevos del §M1. Solo `frontend/` +
esta nota. Patrón real+mock, `shadow-focus`, tokens. Gates verdes: **lint 0**, **tsc 0**,
**test 312** (42 files; +8 nuevos en `MasterSet.test.tsx`), **build** OK.

### Contrato consumido (§M1 v1.16-master-set / v1.16.1)

- `GET /admin/inventory/master-sets` → `getMasterSets({q,page,pageSize,sort})` (`MasterSetIndexResponse`).
- `GET /admin/inventory/master-sets/:setId` → `getMasterSetBinder(setId)` (`MasterSetBinderResponse`).
- `POST /admin/inventory/items/batch` → `batchCreateItems(payload)` — manda `batchKey` en el body **y**
  como header **`Idempotency-Key`** (equivalentes). Respuesta tolerante por-línea.
- `POST /admin/inventory/items/bulk-publish` → `bulkPublishItems(payload)` — errores por-línea
  (`ITEM_NOT_PUBLISHABLE`, `PRICE_PENDING`) que no tumban el resto.

Tipos nuevos en `src/types/contract.ts` (v1.16.1): `MasterSetSummaryDTO`, `MasterSetSort`,
`MasterSetIndexResponse`, `MasterSetCardCellDTO` (con `countsByFinish`/`totalCount`/`gaps` implícitos por
`totalCount=0`/`isSecretRare`/`numberSort`), `MasterSetBinderResponse`, `BatchInventoryItemInput`,
`BatchCreateInventoryRequest`, `BatchInventoryLineResult`, `BatchCreateInventoryResponse`,
`BulkPublishLineInput/Request`, `BulkPublishLineResult`, `BulkPublishResponse`.

### UI (MVP)

- **Pestañas "Piezas" / "Master Set"** en `M1View.tsx` (§6.6, subrayado 2px en la activa). "Piezas" = la
  tabla plana actual intacta; los botones "Alta de item" / "Ubicaciones" solo se muestran en esa pestaña.
- **Índice** (`master-set/MasterSetIndex.tsx`): grid de sets con **completitud** (`distinctCardsOwned /
  catalogCardCount` + barra `progressbar`) y **conteo de piezas**. Búsqueda (`q`), orden (`release_desc`
  default / `completion_asc` / `pieces_desc`) y paginación reales. Click → binder.
- **Binder** (`MasterSetBinder.tsx`): cuadrícula por número. **Confía en el orden natural del backend —
  NO re-ordena números en cliente** (los filtros locales usan `Array.filter`, que preserva el orden).
  Por celda: número, nombre, imagen (`loading=lazy` + `content-visibility:auto`), **chips de cantidad por
  acabado (#11)** desde `countsByFinish`, **huecos** (`totalCount=0`, borde punteado + `HUECO`) y **badge
  `isSecretRare`** (solo display, scrim de tinta §7.2b). Filtros locales: acabado, con/sin piezas, secret
  rares.
- **Drawer por celda** (`CellDrawer.tsx`): (a) alta rápida → añade una `CaptureLine` al carrito; (b)
  **publicar piezas de esa carta** — lista las piezas (`GET /admin/inventory/items?cardId=`), selección
  múltiple → `bulkPublishItems` en 1 request, con **render tolerante por-línea**.
- **Carrito de captura** (`MasterSetPanel.tsx`): acumula líneas de varias celdas → `batchCreateItems` en 1
  request; `batchKey` nuevo por submit (idempotencia server-side). Resultado tolerante por-línea
  (`PerLineErrors.tsx`): las líneas ok muestran su folio, las inválidas su error (código traducido con
  fallback al mensaje del backend). Tras el alta se invalidan `master-sets`/`master-set-binder`/
  `cell-pieces` (los agregados cambian).

### Decisiones / notas

- **Sellado fuera del master-set:** el binder es una cuadrícula *por número*; los productos sellados (sin
  número) se siguen gestionando en la pestaña "Piezas". El alta rápida del drawer ofrece **raw/graded**.
- **Reuso:** el picker de catálogo del alta manual (pestaña Piezas) ya existía; el binder es un componente
  nuevo (el grid del picker de cotización no encajaba 1:1 con la celda agregada, se priorizó claridad).
- **Mock:** `mockMasterSetIndex/Binder/BatchCreate/BulkPublish` en `fixtures.ts` derivan TODO de
  `mockCards`+`mockInventory` (consistente y determinista). Se añadieron 3 piezas de Charizard (base1) para
  ejercitar chips multi-acabado (`normal:3`, `reverse_holo:1`) y una pieza `reserved`
  (→ `ITEM_NOT_PUBLISHABLE`); Zapdos in_stock sin referencia ejercita `PRICE_PENDING`. Se añadió
  `error.ITEM_NOT_PUBLISHABLE` a `messages/{es,en}.json`.

### Sin solicitudes al arquitecto

No hizo falta ningún endpoint/campo nuevo: el contrato §M1 v1.16.1 cubre índice, binder, batch y
bulk-publish. **No se tocó** `docs/API_CONTRACT.md` ni `backend/`.

## WS-G Pass 2 (G3) — Reducir la sobrecomplicación del admin (2026-08-17)

Cinco arreglos de UX del back-office señalados por la evaluación, **frontend-only** (0 cambios de
contrato/backend; NO se tocó lógica de dinero — solo presentación, labels, navegación y etapa de las
acciones). Patrón real+mock, `shadow-focus`, tokens y §9.2 respetados. Gates verdes: **lint 0**, **tsc 0**,
**test 304** (41 files; +9 nuevos), **build** OK.

### M5 (aprobar ventas) · de pila plana a cola por etapa — `admin/m5/M5View.tsx`
- **Pestañas por etapa** (`M5_TABS`): "Por recibir" (`cotizada`), "Verificando" (`recibida`+`verificacion`),
  "Por pagar" (`aprobada`), "Cerradas" (`pagada`/`rechazada`/`abandonada`). Cada pestaña muestra su conteo; la
  etapa activa por defecto es la **primera con solicitudes** (`firstNonEmpty`), respetando la elegida por el
  operador. Las solicitudes se agrupan por `status`.
- **Buscador** por folio/usuario reusando la clave i18n **`admin.searchGlobal`** (antes huérfana): filtra `all`
  por `id`/`userId` (case-insensitive); los conteos por pestaña reflejan el filtro.
- **Acciones por etapa, no las 7 siempre:** aprobar/ajustar/rechazar solo si `req.status ∈ {recibida,
  verificacion}` (`canDecide`) → una `cotizada`/`aprobada` ya no ofrece decidir carta; revelar CLABE / pagar
  SPEI solo en `verificacion`/`aprobada` (`showMoneyOut`); en `pagada` se muestra una nota "Pagada por SPEI".
  Convertir a inventario se conserva como estaba (visible, deshabilitado hasta `aprobada`).
- **Vendedor con enlace a M6:** la cola admin (`AdminBuylistDTO`) **no trae el nombre resuelto** ni hay endpoint
  para ello (ver "Solicitud al arquitecto"); se muestra el `userId` como **enlace** a la ficha 360° en
  `/admin/m6?user=<id>`. `M6View` lee `?user=` (via `useSearchParams`, null-safe) y abre el detalle directo
  reusando `GET /admin/users/:id` — **sin endpoint nuevo**.
- **Imagen de catálogo por ítem** (`CardImage`, `imageSmallUrl`) como referente visual para verificar la carta
  física.

### M2 (precios) · jerarquía + % desambiguado — `admin/m2/M2View.tsx`
- **UNA acción primaria "Actualizar precios"** al tope (sección nueva con el trigger de `triggerPriceIngest`,
  botón `lg`), y una sección **"Operaciones avanzadas de catálogo / sync"** que agrupa/de-enfatiza el resto:
  sync de precios de bóveda (botón bajado a `secondary` y movido aquí) + catálogo (backfill / importar sets /
  re-sync-all / por-set). La sub-navegación **no** se reescribió (fase-2, abajo). El selector de proveedor sigue
  en su sección "Ingesta masiva de precios" (config, no CTA); el trigger se movió al tope (no se duplicó, para
  no romper `findByRole` único).
- **Ejemplos en línea del %** en las dos tablas de reglas, porque el `%` significa lo OPUESTO en cada una:
  buylist `buylistRules.example` ("pagas MX$40 por una carta de MX$100 (40%)") y venta `salesRules.example`
  ("vendes en MX$115 una carta de MX$100 (+15%)").

### M1 (inventario) · enums traducidos + confirmación + alta manual sin buylist
- **Enums traducidos (§9.2, "nunca el enum crudo"):** `productType` → `admin.m1.productTypeLabel.{raw,graded,
  sealed}` ("Suelta (raw)"/"Gradeada"/"Sellado", igual que el cliente) y `acquisitionType` →
  `admin.m1.acquisitionLabel.*`, en los **selects** del alta y en la columna/detalle "Tipo" (`M1View.tsx` +
  `ItemDetailModal.tsx`).
- **Confirmación en "Marcar perdida/dañada" (§7.6):** el botón ya no dispara la mutación directo; abre un modal
  de confirmación (patrón M3/M8) con CTA `mark.confirmCta`.
- **Alta manual sin `buylist`:** `ACQ` pasó a `['aportacion_en_especie','compra']` (buylist es la conversión
  automática de M5, no alta manual). El **label** de `buylist` se conserva para traducir items ya convertidos en
  tabla/detalle.

### Dashboard admin · cola de trabajo accionable + rol legible
- Los conteos de "Cola de trabajo" (envíos/buylist/disputas/precios) y el de "Salud de datos" (precios
  pendientes) son **enlaces** a su módulo (M4/M5/M8/M2) (§7.8), con subrayado en hover y `shadow-focus`
  (`AdminDashboard.tsx`).
- **Rol legible** en el topbar: `admin.roles.{customer,vault_operator,super_admin}` en vez del enum crudo; el
  valor técnico queda en `aria-label`/`title` (`AdminTopbar.tsx`).

### i18n (paridad ES/EN)
`admin.roles.*`; `admin.m5.{tabs.*,searchLabel,emptyTab,emptySearch,seller,sellerLink,paidNote}`;
`admin.m1.{productTypeLabel.*,acquisitionLabel.*,mark.confirmTitle/confirmQuestion/confirmCta}`;
`admin.m2.{updatePrices.*,advancedOps.*,buylistRules.example,salesRules.example}`.

### Mock
`fixtures.ts`: +`sr-3003` (`AdminBuylistDTO` en etapa `aprobada`) para poblar la pestaña "Por pagar" y ejercer
el gating de acciones (pago/convert sí, aprobar/rechazar no). Marcado como fixture G3.

### Tests (+9)
`M5View.test.tsx` (+4: pestañas filtran por etapa, acciones solo de la etapa, buscador, enlace del vendedor a
M6 `?user=` — con stub de `@/i18n/navigation`); `M1View.test.tsx` (+3: tipo traducido en detalle, selects sin
`buylist` y con labels legibles, confirmación antes de marcar); `M2View.test.tsx` (+2: ejemplos del % por
tabla); `AdminDashboard.test.tsx` (nuevo: los conteos son enlaces a su módulo).

### Diferido → fase-2 (ux-ui + frontend, NO en este pase)
- **Rewrite completo de la sub-navegación de M2** (más allá de agrupar en "avanzadas"): reorganizar catálogo/sync
  en un flujo con su propia navegación/tabs. Cosmético/estructural, transversal.
- **Consistencia visual admin §3.2** (h1 serif en los 10 `M*View`): hoy conviven `text-h1 font-bold` (sans) y el
  patrón serif de `AdminDashboard`. Cosmético y transversal; conviene un pase único de ux-ui + frontend.

### Solicitud al arquitecto (no bloqueante, sin cambio en este pase)
- **Nombre del vendedor en la cola de M5:** `AdminBuylistDTO` (§M5) expone solo `userId`; para mostrar el nombre
  sin un fetch por-fila haría falta que el listado incluya `userName` (o un `user: { id, name }`), simétrico a lo
  que ya se hizo en otros DTOs admin. Mientras tanto se muestra el `userId` como enlace a la ficha 360° (M6).

## WS-G Pass 1 — Dedup de config de dinero (G1) + gates de acceso (G2) (2026-08-17)

Dos arreglos de admin, **frontend-only** (backend NO cambia; keys de settings intactas como rollback).
**G1 TOCA config de DINERO** → va a veredicto. Solo `frontend/` + este doc. Patrón real+mock, `shadow-focus`
y tokens del design system respetados; **0 cambios de contrato**. Gates verdes: **lint** (0), **tsc** (0),
**test 294** (40 files; +6 nuevos), **build** OK.

### G1 · Dedup de config de dinero M2 vs M10 (`M10View.tsx` + i18n)
- Del array `DIALS` se **quitaron** dos diales de dinero duplicados/muertos: `salesMarkupPct` (dial MUERTO —
  el precio de venta lo deriva `SALES_PRICE_RULES`+fallback de M2 §5; el contrato lo marca DEPRECADO; quitarlo
  del UI es inerte) y `fxBufferPct` (DUPLICADO real del mismo `fx_buffer_pct`; el editor canónico es **M2 §3
  FX**). Las keys **siguen** en el backend y en `SettingsDTO` (types = espejo del contrato) como rollback;
  solo dejan de editarse desde M10. `SettingsDTO` **no** se tocó.
- Los 3 diales de proveedor `pricingProviderRaw/Graded/Sealed` pasaron de **texto libre** (un typo rompía la
  resolución de precio) a **`Select` validado** con las 4 opciones válidas del contrato (`PriceSource`):
  `pokemontcg_io | pokemonpricetracker | poketrace | manual`. Nuevo `DialKind = 'provider'` + constante
  `PRICE_PROVIDER_OPTIONS`; `fromInputValue('provider')` devuelve el texto tal cual (igual que `text`). El
  render bifurca: `provider` → `<Select>` (design system, `shadow-focus` en el wrapper), el resto → `<Input>`.
- **Relabel** para distinguir del `priceProvider` del ingest BULK (M2 §3b): "Proveedor de referencia
  por-carta (raw/graded/sellado)" / "Per-card reference provider (…)". Son conceptos **distintos** y ambos
  viven. Los labels muertos `salesMarkupPct`/`fxBufferPct` se **eliminaron** de `messages/{es,en}.json`
  (paridad verificada por `i18n-parity`).

### G2 · Gate de rol admin + logout admin + guard de rutas privadas
- **Gate de rol (`AdminShell.tsx`):** antes solo exigía **sesión** (`requireAuth = !config.useMocks`) → un
  customer logueado veía todo el chrome del back-office. Ahora, en modo real, además de sesión exige **rol**
  ∈ `{vault_operator, super_admin}` (nueva const `ADMIN_ROLES`; el rol sale de `useSession().user.role`).
  `!isAuthenticated` → `replace('/login?next=…)`; autenticado pero **rol de cliente** → `replace('/')`. El
  render de bloqueo (loader) ahora también cubre `!hasAdminRole` (nunca se pinta el chrome a un customer).
  Modo mock/demo intacto (RoleProvider simula super_admin por defecto; `requireAuth` sigue apagado).
- **Logout admin (`AdminTopbar.tsx`, P-1):** el topbar no tenía logout. Se añadió un control que reusa
  `logout()` (`api.ts`, limpia access+refresh+user vía WS-B) + `useRouter().push('/')`, mismo patrón que
  `StorefrontHeader.onLogout`. Copy `nav.logout` ya existía (ES/EN).
- **Guard de rutas privadas storefront (`PrivateRouteGuard.tsx` NUEVO + `(storefront)/layout.tsx`):** antes
  `/vault`,`/orders` solo ocultaban el link; el acceso directo por URL renderizaba la vista y daba un banner
  401 críptico. El token vive en **localStorage** (no cookie) → guard de **cliente**, no middleware server.
  **Espeja AdminShell:** activo solo en modo real (`requireAuth = !config.useMocks`; inerte en mock/demo). En
  una ruta privada (prefijos `/vault`, `/orders`, `/shipments`, `/checkout`) con `ready && !isAuthenticated`
  → `replace('/login?next=<ruta>')` y muestra loader (nunca el flash de contenido privado). Rutas públicas y
  sesión válida pasan directo. Se montó envolviendo `{children}` dentro del `<main>` del layout storefront
  (un solo punto; no toca las páginas privadas individuales).

### Tests (+6; total 294 en 40 files)
- `M10View.test.tsx` (+2): ya NO aparecen los diales `Markup de venta`/`Colchón FX`; el proveedor por-carta
  es un `<select>` con exactamente las 4 opciones válidas del contrato (no texto libre).
- `AdminShell.test.tsx` (+1): un **customer logueado** NO ve el back-office → `replace('/')` (no `/login`,
  ya hay sesión) y nunca se pinta el chrome.
- `AdminTopbar.test.tsx` (NUEVO, 1): el control de logout llama `logout()` y rutea a `/`.
- `PrivateRouteGuard.test.tsx` (NUEVO, 4): ruta privada sin sesión → `/login?next=<ruta>` (con preservación
  del destino por prefijo); ruta pública sin sesión → sin redirect; ruta privada con sesión → renderiza.
- `PrivateRouteGuard.mock.test.tsx` (NUEVO, 1): en modo mock el guard es **inerte** (demo sin backend).

### Solicitudes al arquitecto
- **Ninguna.** 0 cambios de contrato/backend. Las keys deprecadas/duplicadas siguen vivas en el backend
  (rollback); el gate de rol y los guards son defensa de UI — el backend sigue siendo la autoridad (401/403).

## WS-F Pass 2 — Cablear 3 flujos usuario↔admin rotos/sin UI (F4/F5/F6) (2026-08-17)

Cablea tres flujos que existían en backend (+ tipos) pero no en UI o estaban rotos: **pipeline de
envío admin (F4)**, **responder ajuste de venta (F5)** y **disputas del cliente (F6)**. **SOLO
`frontend/`** + este doc; **0 cambios de contrato/backend** (todos los endpoints y guardas ya
existían). TOCA DINERO/estado → triple veredicto. Patrón real+mock de `api.ts` respetado (cada método
con rama `apiRequest` + rama mock gateadas por `config.useMocks`); `shadow-focus` y tokens intactos.
Gates verdes: **lint** (0), **tsc** (0), **test 285** (37 files; +18 nuevos), **build** OK.

### F4 · Pipeline de envío admin (`M4View.tsx` + `api.ts`)
- `api.ts`: `updateAdminShipmentStatus(id, to)` → `PATCH /admin/shipments/:id/status` body `{ to }`.
  Nuevo `SHIPMENT_TRANSITIONS` exportado = **espejo exacto** de `ShipmentsService.TRANSITIONS`
  (backend); la rama mock valida la legalidad con esa tabla (transición ilegal → `409 CONFLICT`) y
  espeja el estado en `mockAdminShipments` (+ `mockShipments` si el id coincide).
- `M4View`: botones por-estado que ofrecen **solo transiciones legales** vía `MANUAL_TRANSITIONS`
  (subconjunto): `guia→enviado`, `enviado→entregado` y `→cancelado` según etapa. Se **excluye**
  `solicitado→picking` (WEBHOOK) y `picking→guia` (lo hace la captura de guía ya existente).
  Transiciones hacia adelante = botón directo con banner de éxito; `cancelado` = **modal de
  confirmación** (destructivo). Al éxito invalida `['admin-shipments']` + `['admin-picking-list']`
  (mismo patrón que la mutación de guía). Error real vía `useErrorMessage`.

### F5 · Responder ajuste de venta (`BuylistView.tsx` + `api.ts`)
- `api.ts`: `respondSellRequest(id, decision)` → `POST /buylist/requests/:id/respond` body
  `{ decision }`. El backend devuelve la fila `SellRequest` (sin items); el front solo usa el éxito e
  invalida `['sell-requests']`. La rama mock espeja el efecto (`ajustada→aprobada` en accept, request
  `→aprobada`; `→rechazada` en decline) sobre `mockSellRequests` para que el refetch lo refleje.
- `BuylistView` (Mis solicitudes): `hasAdjustedItems = r.items.some(it => it.itemStatus === 'ajustada')`
  (detección **item-level**, no request-level). Con true, bloque de ajuste con el **precio ajustado**
  (`approvedPriceCents` por ítem, con el original tachado) + botones **Aceptar** / **Rechazar** →
  `respondMutation` → invalida `['sell-requests']`. El precio por-ítem `ajustada` muestra
  `approvedPriceCents` (vigente) en vez del `quotedPriceCents`.

### F6 · Disputas del cliente (`ShipmentsView.tsx` + `api.ts` + `contract.ts`)
- `contract.ts`: tipos **cliente** nuevos `CreateDisputeInput`, `CreateDisputeResponse`
  (`{ disputeId, status, type, deadlineAt, evidenceContact }`) y `ClientDisputeDTO` (fila de
  GET /disputes; `evidenceContact` opcional porque el listado crudo no lo trae, solo el 201). Distintos
  del `DisputeDTO` admin ya existente. `ShipmentDTO` gana `deliveredAt?` y el item gana `productType?`
  (ambos alimentan el UI-gate; el backend `toClientShipment` ya devuelve `deliveredAt`, `productType`
  es best-effort del mock — ver "Notas para arquitecto").
- `api.ts`: `createDispute({ inventoryItemId, description })` → `POST /disputes`; `getDisputes()` →
  `GET /disputes` (unwrap `{data}`); `getDispute(id)` → `GET /disputes/:id`. La rama mock espeja las
  guardas §7 (graded → `422 NOT_RAW`, fuera de 7d → `422 DISPUTE_WINDOW_CLOSED`), deriva el `type` del
  productType, y hace `unshift` en `mockClientDisputes`.
- `ShipmentsView`: en un envío **entregado**, cada ítem elegible ofrece **"Abrir disputa"**
  (`canOpenDispute`): status `entregado` + ítem no gradeado (si se conoce productType) + dentro de la
  ventana de 7 días (si hay `deliveredAt`) + sin disputa **activa** (cruce con `getDisputes`, estados
  `abierta`/`en_revision` → muestra "Disputa abierta" en su lugar). **Modal de creación** con textarea
  (min 10 chars) → `createDispute`; tras el 201 reutiliza **`DisputeEvidenceContact`** (M8) con el
  `evidenceContact` + plazo. Sección **"Mis disputas"** (`getDisputes`) con estado + plazo. UI-gate =
  best-effort para evitar 403/422 como primer feedback; el backend sigue siendo la autoridad.

### Tipos / mocks / i18n
- `fixtures.ts`: `mockShipments` gana un envío **entregado reciente** (`shp-7002`, `deliveredAt`
  dinámico a 2d) con un ítem raw elegible + uno graded no elegible; `mockClientDisputes` (lista
  cliente); `mockSellRequests` gana `sr-3002` con un ítem `ajustada` (+`approvedPriceCents`); export
  `DISPUTE_EVIDENCE_CONTACT`.
- i18n (paridad ES/EN): `shipments.dispute.*`, `buylist.adjust.*`, `admin.m4.statusActions.*`. Los
  códigos `DISPUTE_WINDOW_CLOSED`/`NOT_RAW` ya estaban en el catálogo `error.*` (se reutilizan).

### Tests (+18)
- `api.test.ts` (+8): rama mock — F4 transición legal/ilegal (409), F5 accept mueve `ajustada→aprobada`,
  F6 raw ok (type derivado) + graded `NOT_RAW`; rama REAL (fetch stubeado) — F4 `PATCH …/status {to}`,
  F5 `POST …/respond {decision}`, F6 `POST /disputes {…}` + propaga `DISPUTE_WINDOW_CLOSED`, `GET
  /disputes` (unwrap data).
- `M4View.test.tsx` (+3): "Marcar entregado" → PATCH enviado→entregado + banner; "Cancelar" pide
  confirmación → PATCH →cancelado; envío entregado (terminal) sin botones de transición.
- `BuylistView.test.tsx` (+3): el bloque de ajuste aparece **solo** con ítems `ajustada`; no aparece
  sin ellos; "Aceptar ajuste" llama `respondSellRequest(id,'accept')`.
- `ShipmentsView.test.tsx` (+3): "Abrir disputa" solo en el ítem raw elegible (no graded); fuera de la
  ventana de 7d no aparece; abrir modal → describir → enviar → `createDispute` + contacto de evidencia.

### Solicitudes al arquitecto
- **Ninguna bloqueante.** Todos los endpoints/guardas (F4/F5/F6) ya existen en el contrato §M4/§6/§7.
- **Nota (no bloquea):** `GET /shipments` (listMine) devuelve `ShipmentItem` crudos **sin
  `productType`** (ni `card`/`folio` garantizados) — solo `GET /shipments/:id` incluye `inventoryItem`.
  El UI-gate de F6 excluye graded **solo cuando conoce el productType**; si el listado no lo trae, la
  guarda server-side `NOT_RAW` es la autoridad (se mapea a mensaje amable). Si se quisiera un gate 100%
  cliente, habría que enriquecer la proyección de `GET /shipments` con `productType`/`deliveredAt` por
  ítem (solicitud al arquitecto; NO bloquea este WS).

## WS-F Pass 1 — Flujos de dinero del cliente contra el backend REAL (Stripe) (2026-08-17)

Cablea los flujos de dinero del cliente que eran stubs de demo: **checkout de compra (F1)**,
**gestor de direcciones (F2)** y **retiro/envío real (F3)**, todos con cobro **Stripe** vía un
componente compartido. **TOCA DINERO** → triple veredicto. Solo `frontend/` + este doc; NO se tocó
`backend/`, `api-client.ts`, `session.ts` ni el contrato. **0 cambios de contrato** (todos los DTOs
—`CheckoutSessionResponse`, `ShipmentCreateResponse`, `AddressDTO`, `KycInfoDTO.clabeOnFile`— ya
existían). Patrón real+mock respetado (cada método nuevo con rama `apiRequest` y rama mock gateadas
por `config.useMocks`). SEC-A1 intacto (montos/breakdown server-side; el cliente no fija precios).
Gates verdes: **lint** (0), **tsc** (0), **test 267** (37 files; +5 tests), **build** OK.

### Componente compartido — `StripePaymentModal` (`components/domain/StripePaymentModal.tsx`)
- Recibe `clientSecret`, monta `<Elements stripe={loadStripe(config.stripePublishableKey)}
  options={{clientSecret}}>` + `<PaymentElement>` y al confirmar llama
  `stripe.confirmPayment({ elements, confirmParams:{ return_url }, redirect:'if_required' })`.
  Maneja loading/error/ready.
- **Asentamiento por webhook:** tras un `confirmPayment` exitoso (`succeeded`/`processing`) el pago
  **NO** se trata como final — el modal solo dispara `onConfirmed()`; el padre limpia estado y rutea
  a "procesando". La titularidad pasa a `settled` cuando el backend recibe `payment_intent.succeeded`.
- `loadStripe` es **singleton a nivel de módulo** (se llama una vez).
- **Modo mock:** NO carga Stripe real; un botón simula el éxito para que la demo (sin llaves/backend)
  complete el flujo. Gateado por `config.useMocks`.
- Reusa `Modal`/`Button` del design system, tokens y `shadow-focus`.

### F1 · Checkout real (`CheckoutView.tsx` + `api.ts`)
- `api.ts` nuevo `createCheckoutSession(inventoryItemIds, billingProfileId?)` → `POST
  /checkout/session` con header **`Idempotency-Key`**; respuesta `CheckoutSessionResponse`
  (`{ orderId, breakdown, stripe:{ paymentIntentId, clientSecret } }`). Rama mock reusa
  `computeBreakdown` + clientSecret simulado y replica `422 PRICE_PENDING`.
- `pay()` dejó de ser `setTimeout`: crea la sesión → abre `StripePaymentModal` con el
  `clientSecret` → al confirmar `cart.clear()` + pantalla "pago en proceso" con CTA a
  `/orders` y `/vault`. `return_url` = `${origin}/${locale}/orders`.
- **403 `EMAIL_NOT_VERIFIED`:** se detecta por `ApiClientError.code` y se muestra el
  `EmailNotVerifiedNotice` (banner + reenvío) ya existente, no un error genérico.
- El aviso "simulado" (`checkout.stripeMock`) ahora se **condiciona a `config.useMocks`**.

### F2 · Gestor de direcciones (`components/domain/AddressManager.tsx` + `api.ts`)
- `api.ts`: `listAddresses` (`GET`, unwrap `{data}`), `createAddress` (`POST`), `updateAddress`
  (`PATCH`), `deleteAddress` (`DELETE` 204) sobre `/users/me/addresses`. Rama mock con libreta
  mutable en memoria (`fixtures.mockAddresses`), maneja `isDefault` y replica `422 ADDRESS_NOT_MX`.
- Componente reutilizable: **lista + alta (Modal con form) + marcar predeterminada + borrar**, con
  modo `selectable` (radio) para elegir destino del retiro. Usa `useMutation`+`invalidateQueries`.
  Auto-selecciona la dirección `isDefault` (o la primera). Validación de form: `line1/city/state`
  requeridos, `postalCode≥3`, `phone≥7`. **País fijo MX** (envío solo nacional; evita el
  `ADDRESS_NOT_MX` en el camino feliz — el guardarraíl server-side sigue vivo).

### F3 · Retiro real (`ShipmentsView.tsx` + `api.ts`)
- `api.ts` nuevo `createShipment(inventoryItemIds, addressId)` → `POST /shipments` con
  **`Idempotency-Key`**; respuesta `ShipmentCreateResponse`. Rama mock valida settled+MX, agrega el
  envío a "mis envíos" y devuelve clientSecret simulado; replica `422 ITEM_NOT_SETTLED`/`ADDRESS_NOT_MX`.
- Se reemplazó el **selector de país + `addr-mock`** por el `AddressManager` (picker real). El
  `address.id` seleccionado alimenta `getShipmentQuote` y `createShipment`; la regla **MX-only** sale
  de `address.country`. El botón "Solicitar retiro" ya tiene `onClick`: crea la solicitud → abre
  `StripePaymentModal` → al confirmar limpia selección y refresca `getShipments`/`getHoldings`.
- Botón **habilitado solo con `isMx && selected.length>0 && addressId`**. Maneja **403
  `EMAIL_NOT_VERIFIED`** (banner) y **422 `ITEM_NOT_SETTLED`** (mensaje traducido).
- `useSearchParams` lee `?item=` para preselección; la página envuelve la vista en `<Suspense>`.

### VaultView — "Retirar" por-fila con navegación
- El botón "Retirar" por-fila (habilitado solo si `settled`) ahora es un `Link` a
  `/shipments?item=<inventoryItemId>` (preselección); `pending` queda como botón deshabilitado.

### Tipos / mocks / i18n
- `contract.ts`: **sin cambios** (los DTOs ya existían). `api.ts` importa
  `CheckoutSessionResponse`, `ShipmentCreateResponse`, `AddressDTO`.
- `fixtures.ts`: `mockAddresses` (1 dirección MX default, mutable).
- i18n (paridad ES/EN): namespaces nuevos **`payment`** y **`addresses`**; `checkout` gana
  `preparing/payTitle/processingTitle/processingBody`; `shipments` gana `selectItem/payTitle`.

### Tests
- `api.test.ts`: +bloque mock (checkout/shipment/CRUD direcciones + `ADDRESS_NOT_MX`) y **+bloque
  REAL** (fetch stubeado, `config.useMocks=false`): verifica método/endpoint/`Idempotency-Key` y
  propagación de **403 `EMAIL_NOT_VERIFIED`** en checkout y shipment, y el `list/POST/PATCH/DELETE`
  de direcciones.
- `ShipmentsView.test.tsx` (nuevo): estado del botón (habilitado solo con dirección + ítem) y
  manejo del 403 (muestra el banner de verificación, no un error genérico).

### Sin solicitudes al arquitecto
El backend está completo para estos flujos; no se necesitó ningún endpoint/campo nuevo.

## WS-C — Cotizador de buylist contra el backend REAL (Fase 3b, contrato v1.15) (2026-08-17)

Enchufa el cotizador rediseñado de Fable al backend real: mata el fan-out FE-12 con `POST
/buylist/quote/batch`, y cierra los atajos de CLABE/INE que estaban gateados por `config.useMocks`.
**TOCA DINERO/PII** (buylist = SPEI + CLABE + INE) → triple veredicto. Solo `frontend/` + este doc; NO
se tocó `api-client.ts` ni `session.ts`. SEC-A1 intacto (monto server-side; el cliente nunca fija
precio ni CLABE de terceros). Gates verdes: **lint** (0), **tsc** (0), **test 257** (36 files; +9 nuevos).

### 1) Batch quote — mata el fan-out FE-12 (`api.ts` + `contract.ts` + `BuylistView.tsx`)
- `contract.ts`: `BuylistQuoteItemDTO`, `BuylistQuotePayload` (`rarity: string | null`),
  `BuylistBatchQuoteResultDTO` (unión `ok:true & payload` | `ok:false & error{ NOT_FOUND |
  FINISH_NOT_AVAILABLE }`) y `BuylistBatchQuoteResponse`, espejando el contrato §6 v1.15.
- `api.ts`: nuevo `batchQuote(items)` → `POST /buylist/quote/batch` (thin 1:1 con el endpoint). Cap
  `BUYLIST_QUOTE_BATCH_MAX=50` (exportado); vacío/sobre-cap → `400 VALIDATION_ERROR` (el mock también
  lo espeja). El mock resuelve cada ítem con `mockQuotePayload` (helper extraído de `getBuylistQuote`,
  para que por-carta y batch coincidan) y añade los guardas por-ítem `NOT_FOUND` (carta inexistente) y
  `FINISH_NOT_AVAILABLE` (finish ∉ `availableFinishes`, como el backend real). `getBuylistQuote`
  (por-carta) se **conserva** intacto (lo usa el panel de cotización de UNA carta, que no es fan-out).
- `BuylistView.tsx`:
  - **Grid navegable:** antes cada carta del grid montaba su propio `useQuery(getBuylistQuote)` (N
    cartas = N requests). Ahora UNA sola `useQuery(batchQuote)` por página; `ResultQuote` pasó de
    componente-con-query a **presentacional** que lee su resultado de un `Map<cardId, result>`. Render
    **tolerante por-ítem**: si ESE ítem salió `ok:false` pinta `gridQuoteError` en su fila sin afectar a
    las demás; `precio_pendiente` → `linePending`; ok → el estimado.
  - **Bulk "Agregar seleccionadas":** antes `Promise.all` de N `getBuylistQuote` (**all-or-nothing**:
    una inválida tumbaba TODO). Ahora UNA `batchQuote`; se agregan las `ok:true` y las `ok:false` se
    cuentan aparte. Nuevo estado de aviso `partial` (`bulkAddedPartial` = "{added} agregada(s); {failed}
    no disponible(s)."). `batchResultToQuote()` normaliza `rarity: string|null → string` para el carrito.
- **Decisión:** el panel de la carta seleccionada sigue en `getBuylistQuote` (1 request, no fan-out) y
  el contrato conserva `/buylist/quote`; solo el **grid** y el **bulk** (los dos fan-outs reales)
  migran a batch.

### 2) CLABE en un clic REAL — quita el guard de mock (#5) (`BuylistKycForm.tsx` + `api.ts` + `useSellRequirements.ts`)
- `contract.ts`: `KycInfoDTO` gana `clabeOnFile: boolean` (requerido, simétrico a `ineOnFile`).
- `useSellRequirements`: `clabeOnFile` ahora sale del **booleano REAL** `kyc.clabeOnFile` (antes
  `!!kyc.clabeMasked`). `clabeMasked` se conserva solo para el label.
- `BuylistKycForm`: el atajo "usar mi CLABE ****1234" se gatea por la nueva prop `clabeOnFile` (ya **no**
  por `config.useMocks` — se quitó el import de `config`). En modo atajo, `createSellRequest` se llama
  **OMITIENDO `clabe`** (el backend hace el fallback server-side a la CLABE en archivo del propio
  usuario). Se **eliminó** el flag de cliente `useClabeOnFile` de `CreateSellRequestInput` (ya no hace
  falta stripping antes del backend real; el contrato v1.15 soporta `clabe?` opcional directo).
- Manejo del nuevo `422 CLABE_REQUIRED`: fuerza salir del atajo y capturar la CLABE (`clabeRequired`).

### 3) No re-pedir INE si ya está (#5) (`BuylistKycForm.tsx`)
- Nueva prop `ineOnFile` (de `GET /users/me/kyc`, vía `useSellRequirements`). Si es true, la sección de
  INE **oculta los uploaders** y muestra `ineOnFileNote` ("Tu INE ya está en archivo…"); al enviar se
  **OMITE `ineUploadKeys`** (el backend usa el INE de archivo para el umbral AML — KYC parcial).

### i18n (ES/EN, paridad)
- `buylist.gridQuoteError`, `buylist.bulkAddedPartial`, `buylist.clabeRequired`, `buylist.ineOnFileNote`.

### Diseño
- `shadow-focus` y tokens del design system intactos (no se tocaron Input/Select/Button; el grid, el
  carrito y el modal reusan los mismos componentes/estilos). Sin estilos improvisados.

### Tests añadidos/ajustados
- `api.test.ts`: batch de N en 1 request (mismo monto que el por-carta), tolerancia por-ítem
  (`NOT_FOUND`), `FINISH_NOT_AVAILABLE` por-ítem, y cap vacío/>50 → `400`.
- `BuylistView.test.tsx`: el bulk cotiza en UNA sola `batchQuote` (no loop); batch parcial-tolerante
  (1 ok + 1 error → aviso parcial, la válida entra); CLABE en archivo → enviar omite `clabe`; INE en
  archivo → el modal no re-pide INE. `BASE_KYC` gana `clabeOnFile`.
- `BuylistKycForm.test.tsx`: atajo gateado por `clabeOnFile` (no mock); envío omite `clabe` y ya no
  existe `useClabeOnFile`; `clabeOnFile=false` pide la CLABE; `ineOnFile` oculta uploaders y omite keys.

### Solicitudes al arquitecto
- Ninguna: el contrato v1.15 (§0, §1, §6) ya cubre `POST /buylist/quote/batch`, `clabe?` opcional con
  fallback + `422 CLABE_REQUIRED`, y `clabeOnFile`/`ineOnFile` en `GET /users/me/kyc`. Cero cambios de
  contrato. (La deuda **FE-13** —extraer hooks de `BuylistView`— quedó como oportunista y no se forzó.)

## WS-A — Ingesta masiva de precios (frontend, v1.14-price-ingest) (2026-08-17)

Parte de frontend del epic WS-A (contrato `API_CONTRACT.md` v1.14-price-ingest). Solo `frontend/` +
este doc. NO se tocó `api-client.ts` ni `session.ts`. `api.ts` sí (WS-B ya cerró ahí).

### #13 — Guardar SOLO el colchón (buffer) del FX — `M2View.tsx` (sección FX) + `api.ts`
- `updateFx` (`api.ts`) ahora acepta `{ rate?, bufferPct? }` (**`rate` opcional**, contrato §M2). Si se
  omite `rate`, el mock conserva la tasa vigente y **no** marca `source=manual` (solo cambia el colchón);
  el backend real hace lo propio (no pinnea override de tasa). Al menos uno de los dos debe venir.
- `M2View` arma el payload con las keys realmente capturadas (`saveFx()`): tasa vacía ⇒ `{ bufferPct }`
  sin `rate`. El botón "Fijar override" se habilita si **AL MENOS uno** de los dos tiene valor
  (antes: `disabled` si cualquiera vacío). Mensaje de éxito diferenciado: `fx.savedBufferOnly` cuando solo
  se guardó el colchón (se decide por `fxUpdateMutation.variables.rate === undefined`), `fx.saved` si hubo
  tasa. Se separó el banner de éxito compartido con "Refrescar Banxico" para poder dar el copy correcto.
  Hint nuevo `fx.bufferOnlyHint` bajo los inputs.

### Selector `priceProvider` + disparo manual del ingest — `M2View.tsx` (nueva Sección 3b) + `api.ts` + `contract.ts`
- `contract.ts`: nuevo `type PriceProvider = 'pokemontcg_io' | 'pokemonpricetracker'`; `SettingsDTO` gana
  `priceProvider?: PriceProvider` (opcional: el backend lo puede omitir hasta el seed). Nuevo
  `PriceIngestResponse` (`{ job, enqueued, jobId?, scope?, setId? }`).
- `api.ts`: `getPriceProvider()`/`updatePriceProvider(p)` = wrappers finos sobre el endpoint de settings ya
  existente (`GET`/`PUT /admin/settings` parcial; SEC/auditoría del backend intactas). `triggerPriceIngest({ setId? })`
  → `POST /admin/jobs/price-ingest` (body vacío salvo `setId?`, ÚNICA excepción de la familia `admin/jobs/*`).
- `M2View` Sección 3b "Ingesta masiva de precios": `Select` del proveedor (patrón draft + botón Guardar,
  money-safe como los editores de reglas) con hint "cambia la fuente sin redeploy"; botón "Actualizar
  precios ahora" que llama `triggerPriceIngest()` con feedback encolado (`enqueued=true`) vs ya-en-curso
  (`enqueued=false`, single-flight). Query propia `['price-provider']` con `QueryState` (carga/error/retry);
  el disparo del ingest invalida `['pending-prices']`.
- Mock: `mockSettings.priceProvider = 'pokemontcg_io'` (seed recomendado por contrato) en `mock/fixtures.ts`.
- i18n: `admin.m2.priceIngest.*` + `admin.m2.fx.{bufferOnlyHint,savedBufferOnly}` en ES/EN (paridad). El copy
  del `triggerHint` evita la frase "Corre en segundo plano" para no colisionar con el `getByText` del test
  del barrido de catálogo (ambos textos coexisten en el DOM).
- Tests (`M2View.test.tsx`): guardar-solo-buffer llama `updateFx({ bufferPct })` sin `rate` (+ estado
  enabled/disabled del botón + copy); el selector guarda el dial (`updatePriceProvider('pokemonpricetracker')`);
  el botón dispara `triggerPriceIngest` (feedback encolado y single-flight).
- Preservado `shadow-focus` (Input/Select sin tocar). Gates verdes: lint, tsc, test (248), build.

## WS-D — Quick wins de UX (2026-08-17)
- **#9 P-13 nav por sesión** (`StorefrontHeader.tsx`): "Mi Bóveda"/"Mis Órdenes" se ocultan sin sesión
  (público solo Compra/Vender), vía spread condicional en el array `links` (aplica a nav desktop y móvil;
  `authed` depende de `ready` → sin mismatch de hidratación).
- **#6 márgenes**: `.gutter` 44→32px (`globals.css`, DS §4.1 "32px+"); canal del label vertical 56→40px
  (`BuylistView.tsx`, `page.tsx`); quitado `lg:px-10` redundante del aside; header/footer/`VerifyEmailBanner`
  alineados a `lg:px-8`. `max-w-7xl` intacto (DS §4.4).
- **#7 placeholder**: "Buscar carta" acortado a "Nombre o número" (`buylist`, `admin.m1`).

## WS-B — Auto-refresh del access token (sesión no se cae a los 15m) (2026-08-17)

**Problema:** el access token dura `JWT_ACCESS_TTL`=15m; el backend TIENE `POST /auth/refresh`
(devuelve un `TokenPair` nuevo) y el login/register/google ya devolvían `refreshToken`, pero el front lo
**descartaba** (`persistSession` solo guardaba el access token) y `apiRequest` **no manejaba 401**. Resultado:
a los 15m toda request daba 401 y el usuario quedaba deslogueado a media corrida (p. ej. un sync largo).
Solo `frontend/` + este doc. **No** se tocó backend ni contrato. Auth-sensible → lo revisa seguridad.

### 1) Persistir el refresh token — `lib/api-client.ts` + `lib/api.ts`
- Nueva clave `tcg.refreshToken` en localStorage (junto a `tcg.accessToken`), con `getRefreshToken`/
  `setRefreshToken` espejo de `getToken`/`setToken` (mismo almacenamiento, misma guarda SSR `typeof window`).
- `persistSession` (`api.ts`) ahora guarda **también** `res.refreshToken` (contrato §1 lo devuelve en
  login/register/google/refresh). `logout` limpia también el refresh token (no dejar una credencial de 30d
  huérfana). Nuevo `clearClientSession()` (api-client) que limpia access + refresh + user en un solo lugar.

### 2) Interceptor 401 → refresh → reintento (una vez) — `lib/api-client.ts` `apiRequest`
`apiRequest` delega en un `requestWithRefresh(path, opts, allowRefresh)`:
- Si la respuesta es **401**, hay refresh token, y **no** es una ruta `/auth/*`: llama `POST /auth/refresh`
  (`fetch` directo, no `apiRequest`, para no re-entrar), persiste el `TokenPair` nuevo y **reintenta la
  request original UNA vez** con el access token nuevo (`allowRefresh=false` en el reintento).
- **Single-flight:** si varias requests reciben 401 a la vez, comparten UNA sola llamada a `/auth/refresh`
  (`refreshInFlight`). El backend **rota** el refresh token en cada uso; llamadas paralelas se invalidarían
  entre sí. El resto reutiliza la misma promesa y luego reintenta con el token ya rotado.

### 3) Si el refresh falla → sesión limpiada, sin bucles
- Refresh devuelve `null` (sin refresh token / 401 / error de red) → `clearClientSession()` y se propaga el
  **401 original** al caller; el flujo normal (guards de UI / `useSession`) lleva a login. `setStoredUser(null)`
  emite el evento `tcg.session.changed`, así que header y otras pestañas quedan deslogueadas (sync).
- Reintento que **sigue** en 401 (token fresco igual rechazado ⇒ sesión no confiable) → también
  `clearClientSession()` y se propaga el 401. Nunca hay 2º refresh ni 2º reintento.

### Cómo se evitan los bucles (resumen)
1. El reintento se hace con `allowRefresh=false` ⇒ **un solo** reintento por request.
2. `isAuthPath('/auth/*')` **excluye** todo endpoint de auth del interceptor: el propio `/auth/refresh` nunca
   se dispara a sí mismo, y un 401 de `/auth/login` (credenciales inválidas) no intenta refrescar ni borra la
   sesión — es un error significativo por sí mismo.
3. El refresh usa `fetch` directo (no `apiRequest`) ⇒ no re-entra en el interceptor.
4. Single-flight ⇒ un stampede de 401 concurrentes = **una** llamada de refresh, no N.

### Modo mock (`config.useMocks`) intacto
El branching mock vive en `api.ts` (cada función corta con `delay(...)` sin llegar a `apiRequest`), así que el
interceptor **solo corre en modo real**. Los tests mock existentes no se tocan; `mockAuthResponse` ya traía
`refreshToken`, que ahora `persistSession` guarda sin efectos en las pruebas mock.

### Fuera de alcance (deliberado)
- `exportFinanceCsv` (`api.ts`) usa `fetch` directo (lee CSV, no JSON) y **no** pasa por `apiRequest`, así que
  no tiene refresh-and-retry. Es una **descarga manual** (clic del admin), no un sync en background: si el
  token venció, el siguiente `apiRequest` de esa vista ya habrá refrescado. No se refactorizó para acotar el WS.
- **No** se añadió refresco proactivo (pre-15m). El interceptor 401 reactivo ya cubre el requisito de forma
  transparente; se dejó fuera para minimizar la superficie de un cambio auth-sensible (lo revisa seguridad).
- `inactivity.tsx` / `keep-alive.ts` (auto-logout por **inactividad**, 5 min) cubren otra cosa y **no** se
  tocaron. Son ortogonales: keep-alive evita el logout por inactividad durante operaciones largas; WS-B evita
  la caída por **expiración del access token**.

### Pruebas — `lib/api-client.test.ts` (nuevo, 8 casos)
Ejercitan la rama real mockeando `fetch`: (a) 401 → refresh → reintento OK con el token nuevo + rotación de
tokens persistida; (b) refresh 401 → sesión limpiada (access+refresh+user) y 401 propagado, sin reintento;
(c) reintento sigue 401 → sin bucle (exactamente 3 fetch) + sesión limpiada; (d) sin refresh token → 401 tal
cual; (e) `/auth/login` 401 → sin refresh ni borrado de sesión; (f) 422 y (g) 200 no disparan refresh.

**Gates:** `npm run lint` (0 warnings/errors), `npx tsc --noEmit` (exit 0), `npm run test`
(**36 archivos, 244 tests** verdes — incluye los 8 nuevos del interceptor), `npm run build` (exit 0).

## WS-D — 3 quick wins de UX (nav por sesión, márgenes, placeholder) (2026-08-17)

Tres ajustes de bajo riesgo, solo `frontend/`. **No** se tocó `lib/api.ts`, `api-client.ts` ni `session.ts`
(trabajo paralelo de otro agente), ni backend ni contrato. Sin claves i18n nuevas; paridad ES/EN preservada.

### #9 — Nav por sesión (P-13) — `StorefrontHeader.tsx`
El array `links` pintaba las 4 pestañas siempre. Ahora "Mi Bóveda" (`/vault`) y "Mis Órdenes" (`/orders`) se
**gatean tras `authed`** (`ready && isAuthenticated`, ya calculado en `:51`); el público solo ve "Compra"
(`/catalog`) y "Vender" (`/buylist`). El gate vive en la construcción del array (spread condicional), así que
aplica **igual a nav desktop y menú móvil** (ambos hacen `links.map`). Como `authed` depende de `ready`, en
SSR/hidratación se pinta el nav público (idéntico al render de servidor, sin mismatch) y las pestañas privadas
aparecen al montar la sesión — mismo patrón ya usado para el botón login/logout.

### #6 — Márgenes laterales grandes (columna vertical 56px + gutter 44px)
- `globals.css` `.gutter` `@media (min-width:1024px)`: **44px → 32px** (DESIGN_SYSTEM §4.1 pide "32px+"; 32 es
  el mínimo válido). Afecta a todas las secciones storefront que usan `.gutter` (ese es el objetivo).
- Canal del label vertical **56px → 40px** en `BuylistView.tsx` (`grid lg:grid-cols-[40px_1fr]`) y
  `page.tsx` (`[40px_1fr_1fr]` hero y `[40px_1fr_auto]` banda buylist). La etiqueta vertical (`.vertical-label`,
  `writing-mode: vertical-rl`) se mantiene: en modo vertical su longitud crece en alto, no en ancho, así que
  "Bóveda"/"Buylist" caben de sobra centradas en 40px.
- Quitado `lg:px-10` redundante del `<aside>` del cotizador en `BuylistView.tsx` (ya lleva `.gutter`).
- Alineación del **chrome** con el gutter nuevo (32px): `StorefrontHeader.tsx` y el footer de
  `(storefront)/layout.tsx` bajaron `lg:px-11` → `lg:px-8`. **También** `VerifyEmailBanner.tsx` (banner que se
  monta entre header y `main` y comparte el patrón idéntico `mx-auto max-w-7xl px-5 sm:px-6 lg:px-11`): bajado a
  `lg:px-8` para no introducir una desalineación de 12px cuando el banner es visible. Los `lg:px-10` de asides
  de otras vistas (checkout, order-detail, shipments) y el chrome admin (`AdminTopbar`/`AdminShell`) quedaron
  **intactos** por estar fuera del alcance de este WS.
- `max-w-7xl` **no se tocó** (fijado por DESIGN_SYSTEM §4.4). Anillo de foco `shadow-focus` intacto.

### #7 — Placeholder "Buscar carta" que se truncaba
`"Nombre o número (ej. Charizard, 4)"` se cortaba en el ancho del input. Acortado a **"Nombre o número" /
"Name or number"** (describe los dos modos de búsqueda: nombre o número de carta). Cambiado en las 2 claves
que compartían el texto largo: `buylist.searchPlaceholder` (`BuylistView`) y `admin.m1.searchPlaceholder`
(picker de alta de inventario). `catalog.searchPlaceholder` ("Buscar carta…") ya era corto y no se tocó.

### Tests / gates
- `StorefrontHeader.test.tsx`: ningún test existente asumía las 4 pestañas sin sesión (solo verificaban links
  públicos y el estado login/logout), así que nada se rompió. Se **añadieron 2 casos** de #9: sin sesión el nav
  solo muestra Compra/Vender y **oculta** "Mi bóveda"/"Mis órdenes"; con sesión aparecen ligadas a `/vault` y
  `/orders`.
- Gates: `next lint` ✓ (0 warnings/errores) · `tsc --noEmit` ✓ · `vitest` **236/236** (35 archivos, incl.
  paridad i18n) · `next build` ✓ (Compiled successfully). Sin solicitudes al arquitecto.

## Epic precios · Fase 1 · Tarea 1.4 — "Importar sets nuevos" (claridad UX, sin endpoint nuevo) (2026-08-17)

Contrato/arquitectura v1.12. El humano pidió "mapear los sets nuevos que vayan saliendo"; el endpoint ya
existe (`POST /admin/catalog/sync-all` con `force:false` importa solo los NO importados = trae sets nuevos).
El trabajo fue **de claridad de UX**, no contrato nuevo. Solo `frontend/` + esta nota.

- **`M2View.tsx` §5 (sync de catálogo):** el botón antes rotulado "Sync de todo el catálogo" (`syncAllMutation`,
  `force:false`) ahora se llama **"Importar sets nuevos"**. Su acción **no cambió** (sigue `syncAllCatalog()`
  sin `force`). Se añadió un `<p class="text-xs text-muted">` con `catalog.syncAllHint` bajo la fila de botones
  que explica la diferencia ligera vs. pesada: "Importar sets nuevos" (force:false, solo sets recién salidos +
  el sistema lo hace 2×/día) vs. "Re-sincronizar todo (forzar)" (force:true, repuebla precios, pesado). No se
  tocó la lógica de progreso/polling/keep-alive.
- **i18n (`messages/{es,en}.json`, `admin.m2.catalog`):** cambiada `syncAll` ("Sync de todo el catálogo" →
  **"Importar sets nuevos"** / "Sync entire catalog" → **"Import new sets"**); nueva `syncAllHint` (ES/EN,
  paridad verificada por `i18n-parity`). El resto de claves del bloque intactas.
- **Tests (`M2View.test.tsx`):** las 3 aserciones que buscaban `/Sync de todo el catálogo/` ahora usan
  `/Importar sets nuevos/`; nuevo caso "el botón «Importar sets nuevos» dispara syncAllCatalog sin forzar"
  (verifica `force` ausente/false). El caso del error por set (`/^(Importar|Re-sincronizar)$/`, anclado) sigue
  sin capturar el nuevo botón. Gates: `lint` ✓ · `tsc --noEmit` ✓ · `vitest` **220/220** (35 archivos, incl.
  paridad i18n) · `next build` ✓. Sin solicitudes al arquitecto.

## Gating temprano del flujo de VENDER (buylist) — fix UX del 403 críptico (2026-08-17)

Branch `claude/git-repo-review-c67xyk`. Evidencia de prod: el usuario llenaba TODO el cotizador +
modal "Crear solicitud de venta" y solo al enviar recibía un **403** (correo no verificado). Los
guards del backend son correctos por AML (`JwtAuthGuard → RolesGuard → EmailVerifiedGuard` sobre
`POST /buylist/requests`, contrato §6 → `403 EMAIL_NOT_VERIFIED`); el problema era que el frontend
no comunicaba los requisitos hasta el final. **No se tocó backend ni se relajó nada**: el bloqueo
autoritativo sigue siendo server-side (SEC-A1); el cliente solo comunica ANTES y mapea DESPUÉS.

### Contrato confirmado (no se inventó nada)
- `POST /buylist/requests` — errores: `403 EMAIL_NOT_VERIFIED`, `422 FINISH_NOT_AVAILABLE`,
  `422 BUYLIST_LIMIT_EXCEEDED` (details `{ scope, capCents, wouldBeCents }`), `422 INE_REQUIRED`,
  `422 CLABE_NOT_OWN_NAME` (contrato §6; códigos en `backend/src/common/error-codes.ts`).
- `GET /users/me` → incluye `emailVerified` y `kycStatus`, **no** trae CLABE.
- `GET /users/me/kyc` (rol `customer`) → `{ kycStatus, clabeMasked?, ineOnFile, capPerRequestCents,
  capPerMonthCents, monthUsedCents }` → **sí** permite saber si hay CLABE registrada (`clabeMasked`)
  y anticipar el requisito de INE por topes. **No hace falta pedir nada al arquitecto.**
- `POST /auth/verify-email/resend` (autenticado, sin body, 3/h) para el CTA de reenvío.

### Implementación
- **`hooks/useSellRequirements.ts`** (nuevo): agrega sesión (`useSession`) + `GET /users/me/kyc`
  (solo si `role === 'customer'`, para no provocar 403 en staff) y deriva: `isAuthenticated`,
  `emailBlocked` (SOLO con `emailVerified === false` explícito, espejo de `VerifyEmailBanner`;
  sesiones viejas sin el campo dejan decidir al backend), `clabeOnFile`/`clabeMasked`, `ineOnFile`,
  `ineExpected` (estimado > tope por solicitud o remanente mensual, sin INE en archivo — heads-up,
  el backend re-decide) y `canSubmit`.
- **`components/domain/SellRequirementsPanel.tsx`** (nuevo): visible SIEMPRE en el aside del
  carrito (aun vacío). Sin sesión → Banner "Inicia sesión o crea cuenta para vender" con links
  login/registro; `emailVerified=false` → reusa `EmailNotVerifiedNotice` (CTA de reenvío);
  sesión ok → checklist 5a en mono (`✓ / — / !`): correo verificado, CLABE registrada
  (enmascarada) o pendiente, e INE esperado con el tope formateado.
- **`BuylistView`**: sin sesión el CTA "Enviar solicitud (N)" se SUSTITUYE por links
  login/registro; con correo sin verificar queda `disabled` + motivo visible enlazado por
  `aria-describedby` (`submitBlockedEmail`). Se eliminó el párrafo genérico `kycNotice`
  (reemplazado por el panel). El modal recibe `ineExpected` y `clabeMasked`.
- **`BuylistKycForm`**: segundo cinturón dentro del modal — con `emailVerified === false` el
  submit queda deshabilitado con el aviso de entrada (no espera al 403); `ineExpected` preactiva
  la petición de INE (no espera al `422 INE_REQUIRED`); `clabeMasked` cambia el hint de la CLABE.
  Mapeo de errores del submit: `BUYLIST_LIMIT_EXCEEDED` ahora usa `details.capCents` con monto
  real (`limitExceededCap`); códigos no mapeados caen a `useErrorMessage` (catálogo `error.*`,
  p. ej. `FINISH_NOT_AVAILABLE`) en vez del genérico `requestError`.

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)
Claves nuevas en `buylist`: `requirementsTitle`, `loginToSellTitle`, `loginToSellBody`, `loginCta`,
`registerCta`, `reqChecking`, `reqEmailVerified`, `reqClabeOnFile`, `reqClabeMissing`,
`reqIneOnFile`, `reqIneExpected`, `submitBlockedEmail`, `clabeOnFileHint`, `limitExceededCap`.
Eliminada: `kycNotice` (sustituida por el panel). Los avisos de verificación reusan `verifyEmail.*`.

### Tests (BuylistView 21 · BuylistKycForm 10)
Gating: sin sesión (CTA login/registro, sin botón de enviar), correo no verificado (botón
deshabilitado + motivo + reenvío que llama al endpoint), sin CLABE (checklist pendiente + el modal
no llama al backend con CLABE vacía), CLABE registrada (checklist cumplido enmascarado), estimado
sobre tope (aviso de INE antes de enviar y modal con la petición preactivada), y flujo feliz con
sesión verificada (los tests de carrito existentes ahora corren logueados). Mapeos: 403
`EMAIL_NOT_VERIFIED` → aviso accionable; `BUYLIST_LIMIT_EXCEEDED` con `capCents`;
`FINISH_NOT_AVAILABLE` → catálogo `error.*`.

### Gates (frontend/)
`npm run lint` ✓ · `tsc --noEmit` ✓ · `npx vitest run` ✓ (**35 archivos / 215 tests**, incl.
paridad i18n) · `next build` ✓.

## Operabilidad del back-office: M1–M5, M8 cableados a endpoints reales (2026-08-17)

Branch `claude/git-repo-review-c67xyk`. Varias pantallas admin eran cascarones con botones sin
`onClick` aunque el backend YA exponía los endpoints. Esta ronda cablea la operación completa del
negocio. Solo `frontend/` + esta nota; look 5a intacto (paper/ink/vermilion, radios/sombras 0,
`shadow-focus`). Gates verdes: `lint` ✓ · `typecheck` ✓ · `vitest` **189/189** (35 archivos, incl.
paridad i18n) · `next build` ✓.

### Funciones nuevas en `lib/api.ts` (todas con rama mock que respeta el shape del contrato)
- **M5:** `receiveBuylistRequest(id)` → `POST /admin/buylist/:id/receive`; `verifyBuylistRequest(id)`
  → `POST .../verify`; `decideBuylistItem(itemId, { decision, approvedPriceCents? })` →
  `PATCH /admin/buylist/items/:itemId/decision`; `convertBuylistItemToInventory(itemId)` →
  `POST .../convert-to-inventory`; `revealBuylistClabe(id)` → `GET /admin/buylist/:id/reveal-clabe`;
  `paySpeiBuylist(id, speiReference)` → `POST .../pay-spei` con `Idempotency-Key: pay-spei-<id>`
  estable (reintento no duplica el asiento).
- **M3:** `refundOrder(orderId, reason)` → `POST /admin/orders/:id/refund` con
  `Idempotency-Key: refund-<orderId>`.
- **M8:** `resolveDispute(id, { resolution, note })` → `POST /admin/disputes/:id/resolve`.
- **M4:** `getAdminShipments({ status?, page?, pageSize? })` → `GET /admin/shipments` (cola de
  CLIENTES; antes la vista usaba `getShipments()` = envíos del propio admin) y
  `getAdminPickingList(date?)` → `GET /admin/shipments/picking-list`.
- **M2:** `overridePrice` gana `finish?` (la cola de pendientes es POR ACABADO, M-19: sin `finish`
  el backend defaultea `normal` y el pendiente real quedaba abierto).

### Tipos (`types/contract.ts`, espejo del contrato)
`PendingPriceEntryDTO` += `finish: Finish` + `card? { id, name, number, setName }`;
`PricingOverrideInput` += `finish?`. Nuevos: `AdminShipmentDTO` (fila cruda de la cola admin, con
`requestedAt`/`userId`; items sin carta/folio en el listado), `PickingListEntryDTO`,
`RefundOrderResponse`, `RevealClabeResponse`, `BuylistItemDecisionInput`,
`ConvertToInventoryResponse`, `ResolveDisputeInput`.

### Por pantalla
- **M5 (`M5View`)** — end-to-end: Recibir (visible en `cotizada`), Verificar (en `recibida`),
  Aprobar/Ajustar/Rechazar por ítem (Ajustar abre modal con `approvedPriceCents`; el 422
  `APPROVED_PRICE_CAP_EXCEEDED` u otro error se muestra DENTRO del modal con el mensaje real),
  Convertir a inventario (deshabilitado salvo `aprobada`; confirma con el folio devuelto), Revelar
  CLABE y Pagar SPEI (modal con referencia obligatoria). Cada acción: confirmación `Banner` success
  anclada a SU solicitud, error real, `invalidateQueries(['admin-buylist'])`. La CLABE revelada vive
  SOLO en estado local del componente vía **mutation** (nunca query-cache/estado global), se oculta
  con un botón y se descarta al registrar el pago; cada reveal queda auditado server-side.
  Los ítems muestran su **acabado** (`FinishBadge`) y el precio aprobado cuando existe.
- **M3 (`M3View`)** — refund cableado: modal con **motivo obligatorio** (contrato `{ reason }`),
  confirmación con monto, banner de éxito con el `orderId`, error real en el modal, refresh.
- **M8 (`M8View`)** — Recomprar/Rechazar cableados con modal de confirmación + **nota obligatoria**
  (contrato `{ resolution, note }`); selección por id (no por objeto) para que el estado se refresque
  tras invalidar; los botones desaparecen en disputas ya resueltas.
- **M4 (`M4View`)** — la cola ahora es `GET /admin/shipments` (clientes) con **filtro por estado**;
  la "lista de picking" dejó de derivarse del inventario local y consume el endpoint real
  `GET /admin/shipments/picking-list` (ubicación + folio + envío). Captura de guía igual, con banner
  de éxito e invalidación de ambas queries.
- **M1 (`M1View`)** — (a) **paginación real** del picker (`useInfiniteQuery` con `page/pageSize=20`
  + "Cargar más" + contador "X de Y") — raíz del "solo veo ~20 cartas"; (b) resultados y carta
  seleccionada con **miniatura + #número + rareza + badges de acabados**; (c) **P-4**: el alta usa el
  `folio` devuelto en un `Banner` success y el error muestra el mensaje real
  (`PRICE_PENDING`/`FINISH_NOT_AVAILABLE`…); (d) raw con un solo acabado lo muestra **fijo** en vez
  de ocultarlo.
- **M2 (`M2View`)** — el override envía `finish`; la cola de pendientes muestra **acabado**
  (`FinishBadge`) y nombre de carta + `#número` (proyección `card` del backend); el modal de override
  muestra el acabado que se va a resolver.

### Decisión transversal: mensajes de error reales
`useErrorMessage` (QueryState) ahora cae al **mensaje real del backend** (`ApiClientError.message`)
cuando el `code` no tiene copy i18n, en vez del genérico. Códigos nuevos con copy ES/EN:
`APPROVED_PRICE_CAP_EXCEEDED`, `ITEM_NOT_APPROVED`, `CLABE_UNAVAILABLE`.

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)
Nuevas: `admin.m1.{resultCount,loadMore,finishFixedSingle,createSuccess}` ·
`admin.m2.pending.finish` · `admin.m3.{refundDone,refundReasonLabel,refundReasonHint}` ·
`admin.m4.{queueTitle,statusFilter,statusAll,queueEmpty,itemCount,pickingHint,pickingEmpty,picking.*,tracking.saved}` ·
`admin.m5.{approvedLabel,convertNeedsApproval,revealClabe,hideClabe,clabeLabel,clabeNotice,adjustTitle,adjustPriceLabel,adjustConfirm,adjustHint,paySpeiTitle,speiReferenceLabel,paySpeiConfirm,feedback.*}` ·
`admin.m8.{resolveConfirm,repurchaseQuestion,rejectQuestion,noteLabel,noteHint,resolvedRepurchase,resolvedReject}` ·
`error.{APPROVED_PRICE_CAP_EXCEEDED,ITEM_NOT_APPROVED,CLABE_UNAVAILABLE}`.

### Tests nuevos (26 en 5 archivos + 1 caso en M2)
`M5View.test.tsx` (9: decisión approve/adjust/reject con tope AML, reveal/ocultar CLABE, pago SPEI con
referencia + error real), `M3View.test.tsx` (3), `M8View.test.tsx` (4), `M4View.test.tsx` (4: cola
admin —y que NO llama `getShipments`—, filtro `?status=`, picking real, captura de guía),
`M1View.test.tsx` (5: metadatos del picker, paginación page=2, acabado único fijo, folio en éxito,
error real), `M2View.test.tsx` (+1: override reenvía `finish`).

### Notas para QA/arquitecto
- El fixture mock separa `mockAdminShipments` (cola admin) de `mockShipments` (envíos propios).
- `AdminShipmentDTO` refleja la fila cruda del backend (`requestedAt`, items sin carta/folio en el
  LISTADO). Si M4 necesitara carta/folio por ítem en la cola, habría que enriquecer la proyección de
  `GET /admin/shipments` (solicitud al arquitecto; NO bloquea).
- `pay-spei`/`refund` envían `Idempotency-Key` estable por entidad como pide el contrato (el backend
  hoy además tiene guardas de estado propias).

## v1.9-set-chart · Gráfica pública del valor del set destacado en el hero (2026-08-16)

Contrato: **API_CONTRACT v1.9-set-chart** (`GET /catalog/featured-set/value-history?range=`, DTOs
`SetValueHistoryResponse` / `SetValuePointDTO` / `SetRefDTO` / `SetValueRange`). Diseño: **DESIGN_SYSTEM
§7.18** (`FeaturedSetGlance`) reusando §7.17. Solo `frontend/` + esta nota. **No** se tocó backend, contrato,
`DESIGN_SYSTEM.md`, `.env.example` ni `TECH_DEBT.md`. Gates verdes: `lint` ✓ · `typecheck` ✓ · `vitest`
**163/163** (30 archivos) · `next build` ✓. Playwright **no** ejecutado aquí (requiere el stack corriendo;
lo corre QA) — el e2e de home solo verifica nav + toggle de idioma, no la rama anónima, así que no se rompe.

### Qué se implementó
- **Tipos (`types/contract.ts`):** `SetValuePointDTO`, `SetRefDTO`, `SetValueRange`, `SetValueHistoryResponse`
  — espejo literal del contrato (`set: SetRefDTO | null`, `points`, `change`).
- **API helper (`lib/api.ts`):** `getFeaturedSetValueHistory(range = '1m')` → `GET
  /catalog/featured-set/value-history?range=` cuando `!useMocks`; en mock delega a
  `fx.generateFeaturedSetValueHistory`. El front **no** envía ni hardcodea id de set (lo resuelve el backend).
- **Componente `FeaturedSetGlance` (en `PortfolioTrendChart.tsx`, junto a `PortfolioGlance`):** vive en el
  mismo archivo para **reusar** los subcomponentes privados `Delta` y `Sparkline` sin exportarlos. Query
  `['featured-set-history','1m']` (rango fijo 1m, es un "glance"). Renderiza sub-encabezado (nombre del set
  `lang="en"`, no traducido, + etiqueta `eyebrow` "Valor de mercado · Set destacado"), cifra grande tabular
  (mismo estilo `text-[32px]…lg:text-[41px]` que `PortfolioGlance`), `Delta` (signo+flecha+color, portador
  accesible del cambio) y `Sparkline` desnudo con `summary=""` → `aria-hidden` (la curva es decorativa).
- **Home `page.tsx` (rama ANÓNIMA):** `FeaturedSetGlance` **encabeza** el panel derecho; debajo se conservan
  **2** líneas de confianza (custodia + precio real; la de autenticación se poda por espacio, §7.18) y el
  enlace de acceso (`nav.login`) sigue anclado al pie con `mt-auto`. La rama **con sesión** (`PortfolioGlance`
  + valor por set) **no** cambia.

### Cómo se renderiza la gráfica y el estado vacío (regla dura "nada fabricado")
- **≥ 2 puntos:** cifra de hoy + `Delta` + `Sparkline` (polilínea 1.5px, sin ejes/retícula/relleno/dot).
- **1 punto:** cifra de hoy + microcopy `text-muted` **"Recopilando historial"** en la misma línea; **sin**
  curva (el `Sparkline` ya devuelve `null` con `< 2` puntos) y sin delta engañoso.
- **`points: []`** (serie recién sembrada): se degrada al sub-encabezado (nombre + etiqueta) + "Recopilando
  historial" + frase de apoyo; **sin** cifra, sin curva.
- **`set === null` / error / (loading fallido):** el componente **renderiza `null`** → el panel anónimo cae a
  su forma previa (2 líneas de confianza + acceso). El hero nunca queda roto por este endpoint secundario.
- **Cargando:** skeleton de cifra + skeleton de polilínea (~90px), sin spinner.
- Tendencia negativa = estado legítimo (bermellón + ▼ + signo −), sin banner de alarma. Anillo `shadow-focus`
  intacto; el componente **no** añade controles que atrapen foco ni altera el orden de tabulación.

### Mock añadido (`lib/mock/fixtures.ts`)
- **`generateFeaturedSetValueHistory(range)`:** serie determinista de "Surging Sparks" (id local `sv08`),
  valor agregado alto (~MX$1.32M = suma de ~184 cartas priceadas) con tendencia mensual **sobria** (~+2.7%) y
  ruido acotado (~0.4% via seno) — **sin** rally fabricado. `pricedCardCount` plausible (182–184).
- **`mockFeaturedSetHistoryEmpty`** (`set` presente, `points: []`) y **`mockFeaturedSetHistoryNull`**
  (`set: null`) para ejercer los estados honestos en tests sin backend.

### i18n nuevas (ES/EN, bajo `home.featuredSet`) — paridad verificada por `i18n-parity.test.ts`
- `label`: **"Valor de mercado · Set destacado"** / **"Market value · Featured set"**.
- `collectingTitle`: **"Recopilando historial"** / **"Collecting history"**.
- `collectingBody`: **"La tendencia de este set aparecerá cuando tengamos un par de días de historia."** /
  **"This set's trend will appear once we have a couple of days of history."**
- `marketRefNote` (nota anti-promesa): **"Referencia de mercado de las cartas con precio de este set."** /
  **"Market reference for the priced cards in this set."**
- El `Delta`/`Sparkline` reusan las claves existentes de `portfolio.trend` (noChange/up/down/flat).

### Tests
- **`PortfolioTrendChart.test.tsx`** (`FeaturedSetGlance §7.18`): pide `1m`; serie ≥2 puntos (nombre `lang=en`
  + etiqueta + cifra + `▲` + `2.70`, sin microcopy); 1 punto (cifra + "Recopilando historial", sin `svg`);
  `points: []` (sub-encabezado + "Recopilando historial", sin `svg`); `set: null` (render vacío).
- **`(storefront)/page.test.tsx`** (nuevo): con sesión anónima el panel muestra la gráfica del set destacado
  (etiqueta + nombre `lang=en`), conserva **2** líneas de confianza (no la de autenticación) y el enlace de
  acceso al pie.

### Solicitudes al arquitecto
- Ninguna. El contrato v1.9-set-chart cubre todo lo necesario (endpoint público + DTOs). El endpoint genérico
  por-id `GET /catalog/sets/:id/value-history` existe en el contrato pero **no** se consume aún (el hero usa
  el resuelto server-side); queda disponible para una futura gráfica de "otro set".

## Ronda C · BE-10 — Bóveda de la ficha 360° con acabado + valor (2026-08-16)

Contrato: **API_CONTRACT v1.8-ronda-c** (§M6 nota BE-10, §11 `AdminUserOwnedItemRef`). La proyección de la
pestaña **Bóveda** de la ficha 360° (`GET /admin/users/:id`) ahora trae, por item en custodia,
`productType`, `finish: Finish` y `referenceValue: PriceInfo` (mismo `PriceInfo` por-acabado que
`HoldingDTO`). Solo `frontend/` + esta nota. **No** se tocó backend, contrato ni `TECH_DEBT.md`. Gates
verdes: `lint` ✓ · `typecheck` ✓ · `vitest` **157/157** (29 archivos) · `next build` ✓ · Playwright **40/40**.

### Qué se implementó
- **Tipo (`types/contract.ts`):** `AdminUserOwnedItemRef` gana `productType: ProductType`, `finish: Finish`
  y `referenceValue: PriceInfo` (antes solo `inventoryItemId/folio/card/ownershipStatus`). Se retiró la nota
  de "solicitud al arquitecto" que pedía justo estos campos: el contrato Ronda C ya los entrega.
- **`VaultTab` (M6View.tsx):** pasó de tabla folio+carta+titularidad a folio · carta **+ acabado** ·
  titularidad · **valor**. El acabado se pinta con **`FinishBadge`** (mismo mapeo `finish.*` que Compra y la
  bóveda del cliente; no se inventó label nuevo — para graded/sealed `normal` se oculta, es ruido). El valor
  usa el mismo tratamiento honesto que `VaultView`: `priced` → `formatMoneyCents(referenceMxnCents)`;
  `pending` → **`StatusBadge domain="price" value="pending"`** ("PRECIO PENDIENTE", warning outline), **nunca
  `$0` ni `—`**.
- **Total de la bóveda (sí encajó limpio):** pie de tabla con **valor total** = suma de los `referenceValue`
  **priced**; los `pending` se **excluyen** del total y se indican aparte con un contador (paridad con el
  `pendingPriceCount` del portafolio del cliente, DESIGN_SYSTEM §7.3). Layout minimalista: eyebrow + cifra
  `tabular` a la derecha, separado por regla superior (sin radios/sombras nuevas; sin tocar `shadow-focus`).
- **Mock (`lib/mock/fixtures.ts`):** `mockAdminUserDetail('u-777').ownedItems` ahora trae dos items —
  Blastoise holofoil **priced** (`128000` cents) y Pikachu reverse_holo **pending** — para ejercer ambos
  renders en preview/tests sin backend real.
- **Test (`M6View.test.tsx`):** nuevo caso que abre la pestaña Bóveda y verifica acabado legible (Holofoil /
  Reverse Holo), valor priced formateado, estado pendiente honesto ("Precio pendiente"), total sin pendientes
  y el contador de pendientes.

### i18n nuevas (ES/EN, bajo `admin.m6`) — paridad verificada por `i18n-parity.test.ts`
- `vaultTotal`: **"Valor total (con precio)"** / **"Total value (priced)"**.
- `vaultPending` (ICU plural): **"{count} carta(s) con precio pendiente (excluidas del total)"** /
  **"{count} card(s) with price pending (excluded from total)"**.
- El acabado reusa `finish.*` (ya existían); el estado pendiente reusa `status.price.pending` ("Precio
  pendiente" / "Price pending") y `catalog.marketValue` ("Valor de mercado" / "Market value"). Sin strings
  nuevas para esos dos.

### Solicitudes al arquitecto
- Ninguna. BE-10 cubrió exactamente lo que faltaba (`finish` + `referenceValue` en la proyección de bóveda).

## Destacadas por precio (home) + cierre en lote de deuda 5a (2026-08-16)

Dos cosas, solo `frontend/` (+ esta nota + entradas 5a de `TECH_DEBT.md`). **No** se tocó backend, el
contrato ni las decisiones ratificadas del rediseño (minimalista, sin tema oscuro). Gates verdes al
final: `lint` ✓ · `typecheck` ✓ · `vitest` **156/156** (29 archivos) · `next build` ✓ · Playwright **40/40**.

### 1. DESTACADAS = las MÁS CARAS del inventario real (`(storefront)/page.tsx`)
La home pedía `getCatalog({})` y tomaba `.filter(sellable).slice(0,4)` **sin ordenar por precio**, así que
las "destacadas" eran las 4 primeras del orden por defecto del backend, no las de mayor valor.
- Ahora pide **`getCatalog({ sort: 'price_desc', pageSize: FEATURED })`** (`FEATURED=4`). El backend ordena
  por `salePriceCents` sobre el **set completo ANTES de paginar** y solo devuelve sellables con precio
  (excluye precio-pendiente), así que las 4 que llegan son las de mayor `salePriceCents`. `CatalogSort` y el
  filtro `sort`/`pageSize` ya existían en `lib/api.ts` (no se tocó el contrato).
- `queryKey` cambiado a **`['catalog', { home: true, sort: 'price_desc' }]`** para no colisionar con la caché
  del catálogo general (`CatalogView` usa su propia key con filtros).
- Se **conserva** `.filter(sellable).slice(0, FEATURED)` como red de seguridad. Con inventario vacío no pinta
  nada (correcto); al poblarse, las 4 serán las de mayor precio.

### 2. Deuda del rediseño 5a — cerrada/degradada en lote (IDs `5a-D1/D3/D4/D5/D6` + menores de la home)
- **5a-D3 (CERRADA):** anillo de foco unificado al token **`shadow-focus` (2px)**. Se quitaron los
  `shadow-[0_0_0_3px_var(--color-focus-ring)]` (3px inline) de `DisputeEvidenceContact.tsx` (link mailto +
  botón Copiar) y `PhotoUploader.tsx` (botón de captura). `Button.tsx` ya no tenía inline 3px (usa el
  `:focus-visible` global). Ya **no** hay ningún anillo de 3px en el código (grep `shadow-[0_0_0_3px` → 0);
  todo el foco es el `outline` global o `shadow-focus` 2px, consistente con Input/Select. Sin doble anillo
  (los controles mantienen `outline-none`).
- **5a-D4 (CERRADA):** `ListingSpec.tsx` variante `compact` graded ahora compone el **`aria-label` con
  empresa + grado + cert SIEMPRE** (§7.2b), aunque el texto **visible** siga abreviado (sin cert en la
  retícula). Se construye `gradedAriaLabel` cuando el cert se omite del visible; el `aria-label` final es el
  del tooltip NM (raw) o `gradedAriaLabel` (graded compacto).
- **5a-D5 (CERRADA):** se quitaron las vars muertas **`--radius-sm/md/lg/xl`** de `globals.css` (Tailwind
  hardcodea `borderRadius: 0px`; nadie consume `var(--radius-*)`). No existían vars `--shadow-*` en
  `globals.css` (el único boxShadow con var es `boxShadow.focus` en tailwind.config, que SÍ se usa). **No** se
  tocó `--color-focus-ring` ni `boxShadow.focus`.
- **5a-D6 (CERRADA):** en `PortfolioTrendChart.tsx`, el fallback `LIGHT.up` pasó de `#4E7A49` a **`#4a7345`**
  para alinearse al token vivo `--color-success` (ya ajustado al fix de contraste AA). Elimina el drift en el
  primer paint antes de que `useTrendColors` lea el token real.
- **5a-D1 (CERRADA — opción b, ELIMINADO):** `ConditionBadge` estaba **huérfano** (solo lo importaba su
  test). Se **eliminó** el componente **y su test**. Razón: el rediseño 5a sustituyó la fila de pastillas
  (condición + acabado + cert) por el renglón mono `ListingSpec`, y la **ficha de detalle** (`CardDetailView`)
  pinta la condición como **`Fact` de texto plano** coherente con la dirección minimalista ratificada, con
  `CertNumberField` para el cert gradeado. Adoptar `ConditionBadge` (un `Badge`/pastilla de color +
  `GradedCertChip`) dentro de esos Facts de texto plano sería **forzado** y reintroduciría pastillas que el
  rediseño quitó a propósito. `GradedCertChip` **sobrevive** intacto: lo usa el back-office M8 (`M8View`) de
  forma independiente. El E2E `catalog.spec.ts:56` ("la ficha de detalle pinta la condición con su etiqueta
  legible") sigue verde, confirmando que la lógica inline de la ficha cubre el caso.
- **Menores de la home (qa):**
  - Las queries de la home ya **no degradan en silencio** a grid vacío si fallan. `catalog` (destacadas) y
    `holdings` (valor por set) muestran un bloque **error + botón Reintentar** (`common.errorTitle` +
    `common.retry`, `Button` secundario que llama `refetch()`), con el estilo `rule-note` minimalista.
  - `PortfolioGlance` → el `Sparkline` con `summary=""` ahora es **`aria-hidden`** en vez de `role="img"` con
    `aria-label` vacío. `Sparkline` decide: con `summary` no vacío mantiene `role="img"`+`aria-label` (vista
    completa, con tabla accesible); con `summary` vacío (el vistazo de la home, donde el `Delta` ya narra el
    cambio) es decorativo. Sin lectores anunciando "imagen" sin contenido.


## Adopción del rediseño 5a "sin look de IA" + fix del anillo de foco (2026-08-16)

Rama `claude/rediseno-5a-pantallas`. Una sesión hermana implementó el rediseño 5a (paleta papel/tinta
`#f4f1ea`/`#1a1a18` + bermellón `#b44b3a`, fuentes self-hosted por `next/font`, radios y sombras a 0,
tema oscuro eliminado, carrito en header, `domain/ListingSpec.tsx`, primitivas refinadas). Como rol dueño
de `frontend/` se **adoptó** (revisión + verificación, sin rehacer el diseño). Se respetan las decisiones
ratificadas por el humano: StatusBadge sin iconos en críticos y NM abreviado (mono) en la retícula
—accesibles vía `aria-label`/`title`—, tema oscuro eliminado, y `Home.dc.html` diferida (no implementada).

### MUST-FIX 1 — anillo de foco de accesibilidad (RESTAURADO en Input/Select)
El grueso de la infraestructura de foco **sobrevivió** a "sombras 0" y se confirmó intacta:
- `globals.css` conserva `--color-focus-ring: #b44b3a` y el `:focus-visible` global
  (`outline: 2px solid var(--color-focus-ring); outline-offset: 2px`). Botones y links (sin `outline-none`)
  reciben ese anillo bermellón. `PhotoUploader` trae su propio sustituto `focus-visible:shadow-[0_0_0_3px…]`.
- `tailwind.config.ts` conserva `boxShadow.focus = '0 0 0 2px var(--color-focus-ring)'` (clase `shadow-focus`).

**Hallazgo real y corregido:** `components/ui/Input.tsx` y `Select.tsx` ponían `outline-none` en el control
interno (capa `utilities`), que **gana** sobre el `:focus-visible` global (capa `base`), y el wrapper solo
cambiaba el borde inferior (`border-strong` 32% → `border-text` 100%). Ese indicador de un solo borde es
débil y —clave— DESIGN_SYSTEM §6.2 exige que el foco de un campo sea **`borde --color-primary` + `--shadow-focus`**
(el anillo), reforzado por §8.2 ("foco visible SIEMPRE; el anillo sobrevive a sombras 0"). El rediseño había
soltado el anillo en campos/selects. Fix (solo estas dos primitivas): se añadió `focus-within:shadow-focus`
al wrapper de ambos (el `<input>`/`<select>` interno mantiene `outline-none`, así no hay doble anillo). Ahora
un campo enfocado muestra borde tinta + anillo bermellón 2px, alineado con §6.2/§8.2. Sin tocar
DESIGN_SYSTEM (es de ux-ui); solo se **implementó** lo que ya especificaba.

### Cierre de accesibilidad pre-merge 5a — 2 ajustes qa/techlead (2026-08-16)
Antes del merge del rediseño 5a se cerraron los **dos hallazgos de accesibilidad** que qa y techlead
dejaron como no-negociables (foco visible SIEMPRE + contraste AA, DESIGN_SYSTEM §8.2). Solo se tocó
`frontend/` (+ `docs/`). Las decisiones ratificadas por el humano se respetan sin cambios (StatusBadge
sin iconos, NM abreviado, sin tema oscuro, home diferida).

- **FIX 1 — foco visible en el `<select>` "Ver como" del back-office** (`components/layout/AdminTopbar.tsx`).
  El select del switch de rol tenía `outline-none` **sin sustituto**: `outline-none` (capa utilities) mata
  el `:focus-visible` global (capa base), así que el foco de teclado era **invisible**. Fix: se añadió
  `focus-visible:shadow-focus` **al propio control** (mismo token bermellón 2px que Input/Select). Se puso
  en el control y no en el `<label>` wrapper porque el label envuelve además el texto "Ver como" y el
  triángulo ▾ — un `focus-within` ahí anillaría de más; en el control el anillo cae solo sobre el select,
  sin doble anillo (el `outline-none` sigue matando el outline global).

- **FIX 2 — contraste AA de `--color-success` + consistencia de anillo en inputs crudos**
  (`app/globals.css`, `components/domain/ShopFilters.tsx`, `app/[locale]/(storefront)/catalog/CatalogView.tsx`).
  - `--color-success` pasó de `#4E7A49` (**4.43:1** sobre el papel `#F4F1EA`, por debajo de AA 4.5:1) a
    **`#4A7345`** = **4.86:1** (AA ✓). Se oscureció lo mínimo para cruzar el umbral sin alterar la
    identidad (verde de tinta, no relleno). Ratio verificado con la fórmula WCAG 2.x sobre el papel real.
  - Inputs crudos que usaban `outline-none` + solo `focus:border-text` (un indicador de un solo borde,
    débil): buscador de bloque de `ShopFilters` (`RuleSearch`), wrapper de precio min/max de `ShopFilters`
    (`PriceFilter`), y el buscador de catálogo de `CatalogView`. Se unificaron al **anillo bermellón**
    consistente con Input/Select: `focus-within:shadow-focus` en el `<span>` wrapper del precio, y
    `focus-visible:shadow-focus` en los `<input>` crudos de búsqueda (que no tienen wrapper propio),
    manteniendo `focus:border-text`. Sin doble anillo (los inputs conservan `outline-none`).

**Deuda no bloqueante registrada** (techlead) en `TECH_DEBT.md` sección Frontend, IDs `5a-D1/D3/D4/D5/D6`:
`ConditionBadge` huérfano + condición triplicada; grosor de anillo 3px vs token 2px; `certNumber` ausente
en el `aria-label` de `ListingSpec` graded compacto; vars `--radius-*`/`--shadow-*` muertas en globals.css;
y `PortfolioTrendChart` con hex de paleta hardcodeados. **No** se corrigen en este pase (solo registro).

**Gates:** `lint`, `typecheck`, `vitest`, `next build` y `npx playwright test` (40 E2E) — verdes tras los fixes.

### Verificaciones (todas OK, sin cambios extra)
- **Fuentes:** `app/[locale]/layout.tsx` carga Zen Old Mincho / Archivo / JetBrains Mono por `next/font/google`
  (self-host, `display:'swap'`, sin FOUT roto), exponiendo `--font-serif`/`--font-sans`/`--font-mono` que
  consumen `globals.css` y el `fontFamily` de tailwind. El viejo `--font-inter: 'Inter'` (que nunca se cargaba)
  ya no existe. `body` usa `font-sans`; H1–H4 y `.vertical-label` usan `--font-serif`; cifras/eyebrow, `--font-mono`.
- **Header carrito:** `StorefrontHeader` usa `useCart()` (`lib/cart.ts`), que arranca en `useState([])` y lee
  `localStorage` en `useEffect` → servidor y primer render de cliente pintan `count=0` idéntico (sin mismatch de
  hidratación); la sesión usa el patrón `ready` de `useSession`. Contador visible en desktop y en el menú móvil.
- **i18n paridad:** las 5 claves nuevas existen en ES y EN — `nav.cart` (Carrito/Cart),
  `checkout.removeItem` (Quitar/Remove), `vault.cardColumn` (Carta/Card), `vault.statusColumn` (Estado/Status),
  `admin.superAdminTag` (Súper/Super). El test `i18n-parity` pasa.

### Gates (desde `frontend/`, tras el fix)
`npm run lint` ✓ (0 warnings) · `npm run typecheck` ✓ · `npm run test` (vitest) **163/163** (30 archivos) ·
`npm run build` ✓ (rutas es/en prerenderizadas, `next/font` descarga las 3 familias vía el proxy) ·
Playwright `npx playwright test` **40/40** verdes (Chromium `/opt/pw-browsers/chromium`, server dev en modo
mocks). El fix del anillo es CSS aditivo (una clase `focus-within:shadow-focus` en dos wrappers): no altera
roles/textos/selectores, por eso los 40 E2E siguen verdes.

### Solicitudes al arquitecto
Ninguna. La adopción no consumió endpoints nuevos ni tocó el contrato; el único cambio es de accesibilidad/UI.

## A3 subida robusta de INE + D1 alta M1 por set + G1 bóveda por set (2026-08-16)

Tres cambios independientes, solo `frontend/` (+ esta nota). **No** se tocó el contrato ni backend.
Gates verdes: `lint` ✓ · `typecheck` ✓ · `test` **159** (incl. paridad i18n) · `build` ✓.

### A3 — Compresión/normalización de la foto de INE antes de subir (`components/ui/PhotoUploader.tsx`)

Problema: se subía la foto **cruda** del teléfono (a veces >10 MB → el backend la rechazaba con 422 y el
front lo rotulaba MAL como "no es imagen"); iOS envía **HEIC**, que el presign `image/jpeg` no espera.

Fix (solo cliente, sin tocar el flujo backend):
- **Compresión vía canvas** (`compressImage(file)`): carga la imagen (`img.decode()`), escala al **lado
  máximo ~2000px** manteniendo aspecto, y re-exporta con `canvas.toBlob(_, 'image/jpeg', 0.85)`. Esto baja el
  peso y **normaliza HEIC→JPEG**. Se envuelve el Blob en `new File([blob], 'ine.jpg', { type: 'image/jpeg' })`.
  Si el navegador no puede decodificar (p. ej. HEIC en un navegador sin soporte) o `toBlob` da `null`, hace
  **fallback al archivo original** para no bloquear (el backend valida al final).
- **`contentType`/`contentLength` recalculados del BLOB comprimido** (`upload.type` = `image/jpeg`,
  `upload.size`) y pasados a `presignUpload` → **coinciden con lo que se firma** (residuo S-B3). El PUT sube el
  mismo Blob (`uploadToPresignedUrl(presign, upload)`; usa `upload.type` como `Content-Type`).
- **Chequeo de tamaño movido ANTES de `presignUpload`**, sobre el Blob ya comprimido, contra `maxBytes`
  (prop/`DEFAULT_MAX_UPLOAD_BYTES`); el `presign.maxBytes` sigue como fuente de verdad afinada después.
- **Mapeo de error corregido:** `FILE_TOO_LARGE` (413) → `ine.errTooLarge` ("demasiado grande");
  `VALIDATION_ERROR` (no-imagen) → `ine.errNotImage`; resto → `ine.errUpload`. Ya no se rotula tamaño como
  "no es imagen" (además, al enviar siempre `image/jpeg`, el 422 de content-type deja de aparecer).
- **Estado `processing`** nuevo (spinner + label mientras comprime). i18n nueva: **`ine.processing`** (ES/EN).

### D1 — Alta de inventario M1 sobre el catálogo REAL (`app/[locale]/(admin)/admin/m1/M1View.tsx`)

Antes el dropdown "Carta" salía de `mockCards` (import estático, pocas cartas, sin filtro por set). Se
reemplazó por el patrón del cotizador (`BuylistView`):
- Se **eliminó** el import/uso de `mockCards` en el picker. Estado nuevo `setId`/`searchInput`/`searchQuery`/
  `selectedCard: CardDTO | null`. `<Select>` de set (`listBuylistSets`) + `<Input>` de búsqueda + lista de
  resultados `role="listbox"` (`searchBuylistCards`, `useQuery` gated por `hasSearch`), con `QueryState`
  (loading/error/empty). Ambos endpoints son `@Public()` y usables desde admin (contrato §6).
- `selectedCard`/`availableFinishes` se derivan del **`CardDTO` real** elegido (no de fixtures). El resto del
  formulario (acabado v1.6, tipo, graded/sealed, ubicación, tipo de adquisición, %) **no cambió**.
- **Botón "Crear" cableado** a `createInventoryItem` (nueva en `lib/api.ts`, con rama real
  `POST /admin/inventory/items` y rama **mock** marcada), pasando `cardId: selectedCard.id` + los campos del
  form. `useMutation` con `loading`, deshabilitado si `!selectedCard`/cert faltante, invalida
  `['admin-inventory']` al éxito y muestra `admin.m1.createError` en fallo.
- i18n nueva en `admin.m1` (ES/EN): `filterBySet`, `allSets`, `searchCards`, `searchPlaceholder`,
  `searchAction`, `searchResults`, `noResults`, `selectedCard`, `chooseCardFirst`, `createError`.

### G1 — Bóveda del cliente por set + valor por set (`app/[locale]/(storefront)/vault/VaultView.tsx`)

`HoldingDTO.card` expone **`setId` y `setName`**, así que se agrupa por **`setId`** sin ambigüedad (no hizo
falta agrupar por `setName` ni inventar campos). Todo client-side; el portafolio ya trae `referenceValue`.
- **Filtro por set** (`<Select>` poblado con los sets **distinct presentes en los holdings**, opción "Todos")
  que filtra la lista. Estado `setFilter`.
- **Valor por set**: panel de desglose que suma `referenceValue.referenceMxnCents` por set (los pendientes sin
  valor no aportan), con `formatMoneyCents`. **Total del subconjunto filtrado** mostrado junto al filtro.
- **Decisión de presentación:** se optó por **filtro + desglose de valor por set** manteniendo la **lista plana
  que respeta el orden del control "Ordenar por"** (el contrato/tarea permite "filtro **y/o** agrupada"). Se
  evitó forzar el agrupamiento visual del grid porque re-ordenaría las cartas por set y rompería la semántica
  del sort por valor (y los tests `VaultView.test.tsx` que verifican ese orden). Así se cumplen los tres datos
  pedidos (filtro por set, valor por set, total filtrado) sin colisionar con el ordenamiento existente.
- i18n nueva en `vault` (ES/EN): `setFilter.label`, `setFilter.all`, `valueBySet`, `filteredTotal`, `setCount`.

Sin solicitudes al arquitecto: los tres cambios caben en el contrato v1.6 actual (uploads `kyc_ine`,
`/buylist/sets` + `/buylist/cards`, `POST /admin/inventory/items`, `/vault/holdings`).

## C1 idioma por defecto ES + B2 re-sync forzado en M2 (2026-08-16)

Dos cambios independientes, solo `frontend/` (+ esta nota). **No** se tocó el contrato ni backend.
Gates verdes: `lint` ✓ · `typecheck` ✓ · `test` **159** (incl. paridad i18n + tests nuevos) · `build` ✓.

### C1 — Español como idioma por defecto SIEMPRE (aunque el navegador esté en inglés)

Diagnóstico: `defaultLocale` **ya** era `'es'` en `src/i18n/routing.ts`, pero next-intl v4 trae
`localeDetection: true` por defecto, así que el middleware detectaba el idioma por el header
`accept-language` **y** por la cookie `NEXT_LOCALE`. Un navegador en `en-US` que abría `/` era
redirigido a `/en`. Ese era el comportamiento no deseado.

Fix (un solo archivo de routing):
- **`src/i18n/routing.ts`** — se añadió **`localeDetection: false`** a `defineRouting`. Según los tipos de
  next-intl v4 (`RoutingConfig.localeDetection`), esto hace que el middleware **deje de usar** el header
  `accept-language` **y** la cookie para detectar el idioma. Con `localePrefix: 'always'` + `defaultLocale:
  'es'`, la ruta raíz `/` y cualquier ruta sin prefijo resuelven a **`/es`** de forma determinista,
  independientemente del idioma del navegador.
- **`src/middleware.ts`** — **sin cambios**: ya delega en `routing` vía `createMiddleware(routing)`, por lo
  que hereda `localeDetection: false`. No hizo falta pasar opciones extra al middleware.
- **`src/i18n/request.ts`** — **sin cambios**: ya cae a `routing.defaultLocale` ('es') cuando el locale
  entrante es inválido/ausente.
- **`src/lib/config.ts`** — **ya** alineado: `defaultLocale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'es'`.
  **Valor esperado del env:** `NEXT_PUBLIC_DEFAULT_LOCALE=es` (y su par server-side `DEFAULT_LOCALE=es`).
  Verificado que `.env.example`, `docker-compose*.yml`, `Dockerfile.frontend` y los workflows de CI ya lo
  fijan en `es` (esos archivos son de devops; aquí solo se documenta el valor esperado). **En Vercel/deploy
  la variable `NEXT_PUBLIC_DEFAULT_LOCALE` debe valer `es`.**
- **Selector de idioma (`src/components/ui/LocaleToggle.tsx`)** — **sin cambios**: ya es un segmented control
  ES|EN que refleja el locale activo (`useLocale`, `aria-pressed`) y alterna con
  `router.replace(pathname, { locale })`. Con `localePrefix:'always'`, picar EN navega a `/en` y picar ES
  vuelve a `/es`, preservando la ruta. El estado activo (ES por defecto) se ve reflejado al arrancar.

Cómo se verificó:
- **Test nuevo `src/i18n/routing.test.ts`** (4 casos): `defaultLocale==='es'`, `locales==['es','en']`,
  `localePrefix` modo `'always'`, y **`routing.localeDetection===false`** (documenta que la raíz resuelve a
  `/es` aunque el navegador esté en inglés).
- **`build`** prerenderiza cada ruta en `/es` y `/en`; el `Middleware` (45.9 kB) compila con el routing nuevo.
- Comportamiento efectivo: con detección desactivada, la única forma de llegar a EN es el **switch explícito**
  del usuario (o entrar directo a una URL `/en/...`), que es justo lo pedido.

### B2 — Botón "Re-sincronizar todo (forzar)" en el admin M2

Contrato §M2 (v1.6-finish): `POST /admin/catalog/sync-all` gana **`force?: boolean = false`**. `force=true`
**no filtra** los sets ya importados y reprocesa TODO el catálogo para repoblar `availableFinishes`/precios
por acabado tras M-18. Aditivo y retrocompatible.

- **`src/lib/api.ts` · `syncAllCatalog`** — extendida con `input: { force?: boolean } = {}`. En rama real, el
  body solo incluye `{ force: true }` cuando se pide forzar (omitirlo preserva el body vacío previo →
  retrocompatible). La rama mock, con `force=true`, encola **todos** los sets (no solo los no importados).
- **`src/app/[locale]/(admin)/admin/m2/M2View.tsx`** — nuevo botón **"Re-sincronizar todo (forzar)"** junto a
  los de sync existentes, con `RefreshCw`. Reusa el patrón de mutación/feedback ya presente: mutación
  dedicada `syncAllForceMutation`, banners `info` (corriendo) / `success` (encolado con `setsQueued`) /
  `danger` (error real con `getError`) / `warning` (404-405 = endpoint aún no en backend, vía
  `isEndpointMissing`). Por ser **operación pesada**, el botón **no dispara directo**: abre un **modal de
  confirmación** (reusa `<Modal>`) con Cancelar / "Sí, re-sincronizar todo"; solo al confirmar llama
  `syncAllForceMutation.mutate()`. Se mantiene el botón "Sync de todo el catálogo" normal (sin force) intacto.
- **i18n (`messages/{es,en}.json`, namespace `admin.m2.catalog`)** — llaves nuevas con **paridad ES/EN**:
  `syncAllForce`, `syncAllForceRunning`, `syncAllForceDone`, `syncAllForceConfirmTitle`,
  `syncAllForceConfirmBody`, `syncAllForceConfirmCta`. Pasa `i18n-parity`.
- **Tests (`M2View.test.tsx`, +2):** (1) picar el botón abre el modal y **no** llama al endpoint; al confirmar
  se llama `syncAllCatalog({ force: true })` y aparece el banner de éxito; (2) cancelar no llama al endpoint.
  Se ajustó un test previo del sync por set para usar nombre **exacto** `/^(Importar|Re-sincronizar)$/` (el
  nuevo botón "Re-sincronizar todo (forzar)" ya no lo captura por accidente).

### Solicitudes al arquitecto
Ninguna. El contrato v1.6-finish ya define `force` en `POST /admin/catalog/sync-all` (§M2); solo se consumió.


## Acabado / versión de carta (finish) en toda la cadena — v1.6-finish (2026-08-16)

Consumo del contrato **v1.6-finish** (enum `Finish = normal | reverse_holo | holofoil |
first_edition_holofoil`). El monto siempre lo deriva el backend server-side de `(rarity, finish)`
validado contra `Card.availableFinishes` (SEC-A1); el front solo **elige** el acabado y lo manda.

### Archivos tocados (todos dentro de `frontend/`)
- `src/types/contract.ts` — enum `Finish`; `CardDTO.availableFinishes: Finish[]`; `finish: Finish` en
  `ListingDTO`/`HoldingDTO`/`SellItemDTO`; `finish` (req+res) en `BuylistQuoteResponse`; `finishes:
  Finish[]` en `CatalogFacetsDTO`; `finish?` en `InventoryItemDTO` (M1).
- `src/lib/api.ts` — `CatalogFilters.finish` (query `finish` en `GET /catalog/cards`);
  `getBuylistQuote` recibe `finish?`; `CreateSellRequestInput.items[].finish?`. La rama MOCK replica
  el resolver **por acabado** (reverse_holo → "Reverse Holo"; holofoil/1st ed → rareza base si es holo,
  si no "Holo"; normal → rareza base) y una referencia por carta compartida entre acabados.
- `src/lib/mock/fixtures.ts` — `availableFinishes` por carta (`CARD_FINISHES`), `finish` en listings/
  holdings/inventory/sell-items, `finishes` en facetas, helpers `resolveBuylistRuleForFinish` /
  `mockReferenceForFinish`.
- `src/components/domain/FinishBadge.tsx` — **nuevo**: badge del acabado (i18n `finish`); se oculta para
  graded/sealed (siempre `normal`).
- `src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — **selector de acabado** en el cotizador
  (§ abajo) + dedup de carrito por `(cardId, productType, finish)`.
- `src/components/domain/BuylistKycForm.tsx` — `BuylistRequestItem` gana `finish?`.
- `src/components/domain/ShopFilters.tsx` + `CatalogView.tsx` — filtro/faceta de acabado (chips) y chip
  removible activo.
- `src/components/domain/ListingCard.tsx`, `.../vault/VaultView.tsx`, `.../catalog/[cardId]/CardDetailView.tsx`
  — muestran el acabado de cada listing/holding/ejemplar.
- `src/app/[locale]/(admin)/admin/m1/M1View.tsx` — selector de acabado en el alta + columna de acabado.
- `messages/es.json` / `messages/en.json` — namespace `finish` (label + 4 acabados), `buylist.selectFinish`,
  `shop.finish.*`, `admin.m1.finish*` + columna, error `FINISH_NOT_AVAILABLE` (paridad ES/EN).

### Selector de acabado (cotizador)
Tras elegir una carta, un `<Select>` se puebla de `card.availableFinishes` (ordenado por
`FINISH_ORDER`, con etiquetas i18n Normal / Reverse Holo / Holofoil / 1st Edition). El valor viaja en
`getBuylistQuote({…, finish})` y se snapshotea en la línea del carrito y en los `items` de
`createSellRequest`. **Se muestra solo cuando** `productType==='raw'` **y** hay `>1` acabado
disponible; si la carta es `["normal"]` (o graded/sealed), queda fijo en `normal` y el selector se
oculta. La cotización muestra la **regla aplicada por acabado** (`appliedRule` que ecoa el quote) y un
`FinishBadge` con el acabado resuelto. El acabado **autoritativo** usado en el carrito es el que
**ecoa la respuesta del quote** (`quote.data.finish`), no el estado local.

### Dedup del carrito (hallazgo MENOR de QA #a)
La **identidad de línea** ahora es `(cardId + productType + finish)`. `addToCart` busca una línea
existente con esa clave: si existe, **incrementa la cantidad**; si no, crea una línea nueva. Así, la
misma carta en el mismo acabado suma cantidad (sin duplicar), y la misma carta en **acabado distinto**
es una **línea separada**. Cubierto por tests de dedup en `BuylistView.test.tsx`.

### a11y de botones (hallazgo MENOR de QA #b)
Las dos etiquetas "Enviar solicitud" se distinguen: el **CTA del carrito** es "Enviar solicitud
({count})" (abre el modal de KYC) y el **submit del modal KYC** pasó a "Confirmar y enviar"
(`buylist.submit`). Etiquetas visibles y accesibles distintas, sin ambigüedad para lector de pantalla.

### Solicitudes al arquitecto
- Ninguna. El contrato v1.6-finish cubre todo lo consumido. El mock del front asume que **una carta
  comparte la misma referencia de mercado entre acabados** (simplificación de demo); el backend real
  guarda una `PriceReference` **por acabado** — la UI no depende de esa distinción numérica.

### Gates (todos verdes)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` (153) ✓ · `npm run build` ✓ (incluye paridad i18n ES/EN).

## Cotizador de buylist como CARRITO (varias cartas en una solicitud) — 2026-08-16

Feature **solo frontend** (sin cambio de contrato). El cotizador dejó de ser un flujo de
una-carta-a-la-vez y ahora es un **carrito**: se cotizan varias cartas y se envían en **una sola**
`POST /buylist/requests` (que ya recibía `items: RequestItemDto[]`). No se inventó ningún endpoint
batch: `POST /buylist/quote` sigue siendo **por carta** y sus resultados son **estimados** que se
snapshotean en cada línea; el monto autoritativo lo re-deriva el backend server-side (SEC-A1).

### Archivos tocados (todos dentro de `frontend/`)
- `src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — reescrito: estado de carrito + panel de
  carrito + total estimado + envío único.
- `src/components/domain/BuylistKycForm.tsx` — props cambiadas de `{cardId, productType}` a
  `{items: BuylistRequestItem[]}`; el form ahora envía **todos** los items del carrito (ya
  expandidos). Nuevo tipo exportado `BuylistRequestItem = {cardId, productType, rawCondition?}`.
- `messages/es.json` / `messages/en.json` — llaves nuevas del carrito (paridad ES/EN).
- Tests: `BuylistView.test.tsx` (agrega casos de carrito), `BuylistKycForm.test.tsx` (props `items`),
  `e2e/buylist.spec.ts` (flujo cotizar → agregar al carrito → enviar).

### Flujo del carrito (pasos + UI)
1. **Buscar** por set y/o texto sobre TODO el catálogo (`GET /buylist/cards`, `GET /buylist/sets`).
2. **Elegir carta** de los resultados (`role=option`).
3. **Elegir tipo** (`raw|graded|sealed`; raw fija `NM`, sin selector) y **Cotizar**
   (`POST /buylist/quote`, por carta).
4. **Agregar al carrito** (botón `accent`): añade una **línea** con el snapshot del estimado
   (`BuylistQuoteResponse`) y `quantity=1`. Se puede agregar la misma carta varias veces (líneas
   independientes) y/o subir la **cantidad** por línea.
5. **Panel de carrito** (sección full-width bajo el cotizador): lista de líneas (nombre/set/rareza/
   tipo + estimado c/u + control −/N/+ de cantidad + quitar), **Total estimado** (suma
   `quotedPriceCents × cantidad`; las líneas `precio_pendiente` muestran "Precio pendiente" y aportan
   0), **nota de estimado** (SEC-A1) y **nota de KYC**. Carrito vacío → `EmptyState`, sin botón de
   enviar.
6. **Enviar solicitud ({count})** (habilitado con ≥1 línea) abre **una sola vez** el `BuylistKycForm`
   (CLABE + INE por presign `kyc_ine`) y llama `createSellRequest` con todos los items. Al crear:
   limpia el carrito, invalida `['sell-requests']` y muestra el banner de éxito. El requisito de
   INE/tope lo decide el **backend por el TOTAL** (no se reimplementa en el front).

### Expansión cantidad → items
Al enviar, `cart.flatMap(line => Array(line.quantity).fill({cardId, productType, rawCondition}))`
produce el array `items`: una línea con `quantity=3` genera **3 entradas** idénticas (el modelo es
1 item por carta física). El payload solo lleva `cardId/productType/rawCondition`; **no** se envían
precios ni categorías (el `ValidationPipe` descarta lo demás; SEC-A1).

### SEC-A1 / claridad
- El total del carrito se rotula explícitamente como **ESTIMADO** (`buylist.estimateNote`): "el monto
  final lo confirma la plataforma al recibir y verificar".
- No se envía monto/categoría/rareza en el payload; el backend re-deriva la regla de `Card.rarity`.

### Historial de "mis solicitudes"
Intacto: sigue consumiendo `GET /buylist/requests` y renderizando `PipelineStepper` + items con sus
`StatusBadge`. Solo se invalida su query tras crear una solicitud.

### Gates (frontend/)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` ✓ (144/144, incluye paridad i18n y los
casos nuevos de carrito: agregar, quitar, cantidad, total, envío con múltiples items) ·
`npm run build` ✓.

### Solicitudes al arquitecto
Ninguna. El contrato ya soportaba múltiples ítems en `POST /buylist/requests`; no hizo falta ningún
campo/endpoint nuevo.

## v1.5-auth-email — Verificación de correo + recuperación self-service (2026-08-16)

Implementación del changelog `v1.5-auth-email` del contrato (§1). Verificar el correo **NO** bloquea
login/navegación; **sí** bloquea acciones sensibles (el backend responde `403 EMAIL_NOT_VERIFIED` al
comprar/vender/retirar). Recuperación por email self-service **además** del reset por admin (M6). El
reenvío de verificación es **autenticado**. Solo se tocó `frontend/`.

### Endpoints consumidos (shapes exactos del contrato §1)
- `POST /auth/verify-email` `{token}` → `{verified:true}` (422 `EMAIL_VERIFY_TOKEN_INVALID`) — `verifyEmail(token)`.
- `POST /auth/verify-email/resend` (autenticado, `{}`) → `{ok:true}` (429 `RATE_LIMITED`) — `resendVerificationEmail()`.
- `POST /auth/forgot-password` `{email}` → **siempre** `{ok:true}` — `forgotPassword(email)`.
- `POST /auth/reset-password` `{token, password}` → `{ok:true}` (422 `RESET_TOKEN_INVALID`, 400 `VALIDATION_ERROR`) — `resetPassword({token,password})`.
- `user` de login/register y `GET /users/me` ahora incluye `emailVerified` (ya estaba tipado opcional en `UserDTO`).

### Tipos (`types/contract.ts`)
Añadidos `VerifyEmailResponse`, `ResendVerificationResponse`, `ForgotPasswordResponse`,
`ResetPasswordSelfResponse` (este último NO se llama `ResetPasswordResponse` para no chocar con el ya
existente del reset por admin de M6). `UserDTO.emailVerified` ya existía.

### Pantallas y componentes (rutas nuevas, grupo `(auth)` → URL `/[locale]/…`)
- **`/[locale]/verify-email`** (`(auth)/verify-email/`): la `page` (server) lee `?token=` y lo pasa a
  `VerifyEmailView` (client). Al montar, si hay token, llama `verifyEmail`. Estados: *verificando* →
  *éxito* (banner success "Correo verificado" + link a la tienda) / *inválido* (banner danger, 422). En
  el estado inválido, si hay sesión ofrece **Reenviar** (autenticado); sin sesión invita a iniciar
  sesión. Un `useRef` evita la doble verificación de StrictMode. En éxito, `verifyEmail` hace
  `patchStoredUser({emailVerified:true})` para quitar el banner sin re-consultar `/users/me`.
- **`/[locale]/reset-password`** (`(auth)/reset-password/`): `page` lee `?token=`, `ResetPasswordView`
  es el formulario (nueva contraseña + confirmación). **Política de fuerza igual al registro**: MinLength
  8 (contrato) validado en cliente + confirmación que debe coincidir. Éxito → mensaje + link a login (el
  backend revoca sesiones; el usuario re-inicia sesión, por eso el endpoint no devuelve tokens). `422
  RESET_TOKEN_INVALID` → estado "enlace inválido/expirado" con CTA a **forgot-password**.
- **`/[locale]/forgot-password`** (`(auth)/forgot-password/`): input de email → `forgotPassword` →
  **siempre** el mismo mensaje genérico ("si el correo existe, te enviamos instrucciones"), respetando
  anti-enumeración. Único caso distinto: `429 RATE_LIMITED` (aviso de reintento); cualquier otro error se
  trata también como "enviado" para no filtrar señal. Enlazada desde el login ("¿Olvidaste tu
  contraseña?", solo en modo login de `AuthForm`).
- **Banner "verifica tu correo"** (`components/domain/VerifyEmailBanner.tsx`): montado en el shell de la
  tienda (`(storefront)/layout.tsx`) bajo el header. Persistente (no dismissible) mientras el usuario
  logueado tenga `emailVerified===false`; usa `useSession` (con `ready` para evitar mismatch de
  hidratación). Variante `warning` (no bloquea navegación). CTA "Reenviar correo de verificación" →
  `resendVerificationEmail`, con feedback ("correo enviado" / rate-limit / error).
- **Aviso de 403** (`components/domain/EmailNotVerifiedNotice.tsx`): banner `danger` reutilizable con CTA
  de reenvío para el caso `403 EMAIL_NOT_VERIFIED`.
- **Hook compartido** (`hooks/useResendVerification.ts`): centraliza el reenvío + estados
  (`idle|sending|sent|rateLimited|error`) que usan el banner y el aviso de 403.

### Manejo de `403 EMAIL_NOT_VERIFIED`
Centralizado en el componente `EmailNotVerifiedNotice` (mensaje claro + CTA de reenvío) en vez de un
error genérico. Cableado en el **paso real de venta** (`BuylistKycForm` → `POST /buylist/requests`): el
`catch` detecta `code === 'EMAIL_NOT_VERIFIED'` y muestra el aviso. La compra (`/checkout/session`) y el
retiro (`/shipments`) siguen **mockeados / pendientes de integración Stripe** (no hay `createCheckoutSession`
/ `createShipment` real todavía); cuando se cablee Stripe, el mismo `EmailNotVerifiedNotice` se reutiliza
en esos `catch` (mismo patrón). El `errorCode` también está traducido (`error.EMAIL_NOT_VERIFIED`) para
cualquier ruta que caiga al `QueryState`/`useErrorMessage` genérico.

### i18n (paridad ES/EN)
Secciones nuevas `verifyEmail`, `forgotPassword`, `resetPassword` + `auth.forgotPassword` +
`error.EMAIL_NOT_VERIFIED` / `error.EMAIL_VERIFY_TOKEN_INVALID` / `error.RESET_TOKEN_INVALID` en
`messages/es.json` y `en.json`. El test de paridad (`lib/i18n-parity.test.ts`) pasa.

### Mocks (modo `NEXT_PUBLIC_USE_MOCKS`)
`verifyEmail`/`resetPassword` simulan el `422` cuando el token está vacío o contiene
`invalid|expired|bad`; en otro caso, éxito. `resendVerificationEmail`/`forgotPassword` devuelven `{ok:true}`.
Marcados `// MOCK: pendiente de backend real`.

### Gates (todos verdes)
`npm run lint` (0 warnings), `npm run typecheck` (ok), `npm run test` (29 archivos, 138 tests, incl.
paridad i18n), `npm run build` (ok; rutas `verify-email`/`reset-password`/`forgot-password` generadas
para es/en). Tests nuevos: `VerifyEmailView.test`, `ResetPasswordView.test`, `ForgotPasswordView.test`
(cubre anti-enumeración), `VerifyEmailBanner.test`.

### Solicitudes al arquitecto
Ninguna: los cuatro endpoints y sus shapes están cerrados en el contrato §1. Nota de seguimiento (no
bloqueante): cuando se integre Stripe para `/checkout/session` y `/shipments`, cablear el mismo
`EmailNotVerifiedNotice` en sus `catch` (hoy esas dos acciones están mockeadas).

## v1.4-finance FIX — alinear el P&L de M7 al shape de 6 claves (2026-08-16)

Corrección de RECHAZO de qa/techlead: la ronda previa renombró el P&L solo en la captura (M4) pero
dejó ROTO el consumidor real, **`M7View`** (está montado en `m7/page.tsx` y consume el endpoint real
`GET /admin/finance/pnl`; NO es un stub — la nota previa que decía "ModuleTodo/stub" era incorrecta).
Contrato §M7 ya define el shape nuevo y el backend ya lo devuelve; esto solo espeja el front (sin tocar
el contrato).

Shape del contrato §M7 (6 claves):
`{ incomeCents, shippingRevenueCents, cogsCents, stripeFeesCents, shippingCostCents, profitCents }`
con `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.

Cambios (solo `frontend/`):
- **`types/contract.ts` · `PnlDTO`**: `shippingCents`→`shippingRevenueCents` y **añade**
  `shippingCostCents: number`. Idéntico al contrato de 6 claves.
- **`m7/M7View.tsx`**: el desglose del P&L ahora pinta 5 líneas + total:
  - `+ Ingresos (ventas)` = `incomeCents`
  - `+ Ingreso por envío (cobrado)` = `shippingRevenueCents` (antes `shipping`/`shippingCents`)
  - `− Costo de lo vendido` = `cogsCents`
  - `− Comisiones Stripe` = `stripeFeesCents`
  - `− Costo de envío (paquetería)` = `shippingCostCents` (**NUEVA** línea, resta, mismo `PnlLine`/patrón)
  - `= Ganancia del periodo` = `profitCents` (el desglose cuadra con `profitCents`).
- **i18n `admin.m7.pnl`** (es/en, paridad): la llave `shipping` se renombró a `shippingRevenue`
  ("Ingreso por envío (cobrado)" / "Shipping revenue (collected)") y se añadió `shippingCost`
  ("Costo de envío (paquetería)" / "Shipping cost (carrier)"). También se ajustó `formula`.
- **`lib/mock/fixtures.ts`**: `mockPnl` y `mockCsv` al shape de 6 claves. `shippingCostCents = 31_800`
  ejemplo; profit mock = 1_250_000 + 52_500 − 640_000 − 48_300 − 31_800 = **582_400** cts (MX$5,824.00).
- **Tests**: `M7View.test.tsx` actualizado (nuevo profit + assert de las líneas de envío ingreso/costo);
  nuevo `m4/pesosToCents.test.ts` (vacío/0/decimal/miles/negativo/no-numérico). `pesosToCents` se
  **exportó** desde `M4View.tsx` para poder testearlo.

### M4 `openTracking` (5a) — NO precargable hoy: requiere campo nuevo en el DTO admin
Se intentó precargar el costo ya capturado al reabrir el modal de captura de guía. **`ShipmentDTO`
(`types/contract.ts`) NO expone `shippingCostCents`**, y el contrato de `GET /admin/shipments` /
`GET /admin/shipments/:id` (§M4, líneas 586-587) tampoco lo define en el response. Por la regla de no
inventar campos, `openTracking` se dejó como está (el input arranca en `''` al reabrir).
**Solicitud al arquitecto/backend:** exponer `shippingCostCents` (costo interno, entero ≥ 0) en el
`ShipmentDTO` **del listado/detalle admin** (`GET /admin/shipments` y `/:id`) — NO en el `GET
/shipments/:id` del comprador (§M4 línea 588 lo marca como interno, no expuesto al cliente). Con ese
campo, `openTracking` precargaría `s.shippingCostCents` para que el operador vea el valor vigente al editar.

Gates: lint ✓ · typecheck ✓ · test (123, incl. paridad i18n) ✓ · build ✓.

## v1.4-finance — costo real de paquetería en la captura de guía de M4 (2026-08-16)

Contrato: `POST /admin/shipments/:id/tracking` gana `shippingCostCents?` (opcional, entero ≥ 0,
centavos MXN = costo real que la plataforma paga a la paquetería). Ver API_CONTRACT §M4.

Cambios (solo `frontend/`):
- **`M4View.tsx`**: se añadió el **formulario de captura de guía** (antes M4 era solo lectura). Cada
  envío no `cancelado` muestra un botón "Capturar guía" que abre un `Modal` con tres campos: paquetería
  (`carrier`), número de guía (`trackingNumber`) y **"Costo de envío (paquetería)"** (`shippingCostCents`).
  El costo se captura **en pesos** (prefix `MX$`, `inputMode="decimal"`) y se convierte a centavos con
  `pesosToCents` (`Math.round(n*100)`), igual patrón que M2. Es **opcional**: vacío → no se envía la clave.
  Validación **≥ 0** (bloquea el submit y marca el input con error si es negativo o no numérico). Muestra
  el equivalente formateado en centavos y un `Banner` de error en fallo de la mutación.
- **`lib/api.ts`**: nueva `saveShipmentTracking(shipmentId, ShipmentTrackingRequest)` → `POST
  /admin/shipments/:id/tracking`. `shippingCostCents` solo se incluye en el body cuando el operador lo
  captura. Mock actualiza el envío en memoria y lo avanza a `guia`.
- **`types/contract.ts`**: nuevo `ShipmentTrackingRequest = { carrier, trackingNumber, shippingCostCents? }`.
- **i18n**: `admin.m4.tracking.*` (capture/title/carrierLabel/numberLabel/shippingCostLabel/
  shippingCostHint/shippingCostInvalid/save) en `es.json` y `en.json` con paridad.
- **M7 P&L**: NO se tocó (sigue `ModuleTodo`/stub sin consumidores; el nuevo shape de P&L
  —`shippingRevenueCents`/`shippingCostCents`— se consumirá cuando se construya M7).

Gates: lint ✓ · typecheck ✓ · test (116, incl. paridad i18n) ✓ · build ✓.

## Mejoras UX — presets de rango en M7/M9 + orden de la bóveda (2026-08-16)

Tres mejoras chicas e independientes. Solo `frontend/` (+ esta nota). **No** se tocó el contrato ni el
backend. Todo en cliente sobre datos que ya trae la API. i18n ES/EN espejado (pasa `i18n-parity`). Gates
desde `frontend/`: `lint` OK · `typecheck` OK · `test` **116/116** (24 archivos, +3 nuevos) · `build` OK.

### 1. Presets de rango en M7 (Finanzas) y M9 (Reportes)
- Nuevo helper puro `src/lib/dateRange.ts` → `presetRange(preset, now?)` devuelve `{ from, to }` como
  `YYYY-MM-DD` (hora **local**, sin corrimiento por TZ). Presets: `week` = lunes de la semana actual (ISO) →
  hoy; `month` = mismo día del mes anterior → hoy (ventana rodante ~1 mes); `quarter` = primer día del
  trimestre actual → hoy; `year` = 1-ene del año actual → hoy. `to` siempre = hoy.
- Nuevo componente `src/components/domain/DateRangePresets.tsx` (4 botones `ghost`, `role="group"`) que al
  hacer click llama `onSelect({from,to})`. Reutilizado por M7 y M9.
- **M7** (`m7/M7View.tsx`): se montó `DateRangePresets` en la sección de rango, **sobre** el selector manual
  (que se conserva). Al elegir preset se setean `from`/`to`, y las queries que ya dependen del `range`
  (`GET /admin/finance/pnl`, `GET /admin/finance/iva`) refetchean por su `queryKey`.
- **M9** (`m9/M9View.tsx`): **sí aplica** — M9 ya tenía rango `from`/`to` para `GET
  /admin/reports/launch-metrics` y el export CSV. Se añadieron los mismos presets, misma mecánica.

### 2. Bóveda — orden por set y por valor (`(storefront)/vault/VaultView.tsx`)
- Control `Select` "Ordenar por" con: **Predeterminado** (orden del backend), **Set (A–Z)** (`card.setName`,
  desempate por `card.name`), **Valor (mayor a menor)** y **Valor (menor a mayor)**.
- El valor por carta **sí está** en `HoldingDTO`: `referenceValue.referenceMxnCents` (el valor de referencia
  de mercado del holding, contrato §3). Se ordena en cliente sobre `query.data.data` con `useMemo`. Las
  cartas con **precio pendiente** (`referenceValue.status="pending"`, sin `referenceMxnCents`) quedan
  **siempre al final** en ambos sentidos (asc y desc), no rompen el orden.

### Archivos tocados
- Nuevos: `src/lib/dateRange.ts`, `src/lib/dateRange.test.ts`,
  `src/components/domain/DateRangePresets.tsx`,
  `src/app/[locale]/(storefront)/vault/VaultView.test.tsx`.
- Editados: `m7/M7View.tsx`, `m9/M9View.tsx`, `vault/VaultView.tsx`, `m7/M7View.test.tsx` (+test de presets),
  `messages/{es,en}.json`.
- i18n nuevas (ES/EN): `common.datePresets.{label,week,month,quarter,year}`,
  `vault.sort.{label,default,set,valueDesc,valueAsc}`.

### Tests añadidos
- `dateRange.test.ts` (5): los 4 presets con fecha fija (jueves 2026-08-13) + semana ISO desde domingo.
- `M7View.test.tsx`: click en "Este año"/"Último mes" setea `from`/`to` (comparado contra `presetRange`).
- `VaultView.test.tsx` (4): orden por defecto, valor desc/asc (pendiente al final) y por set (desempate por
  nombre de carta), verificando el orden de los nombres en el DOM.

### Solicitudes al arquitecto
- Ninguna. Todo se resolvió con campos ya presentes en el contrato (`HoldingDTO.referenceValue`,
  `CardDTO.setName`, `from`/`to` de M7/M9). No hubo que inventar endpoints ni campos.

## v1.3.1 — precio de buylist por rareza + cotizador nuevo shape + M6 reset/eliminar (2026-08-16)

Consumo de los bloques del contrato **v1.3.1 §E.1 (precios por rareza)** y **§M6 (reset/eliminar
usuario)**. Solo `frontend/` (+ esta nota). **No** se tocó el contrato. Toggle de mocks intacto (rama real
`apiRequest` + rama mock) e i18n ES/EN espejado. Gates desde `frontend/`: `lint` OK · `typecheck` OK ·
`test` **106/106** (22 archivos, +9 nuevos) · `build` OK.

### 1. Editor de precio de buylist por RAREZA en M2 (`/admin/m2`, super_admin)
- **Reemplaza** la sección "rareza→categoría" (deprecada por el contrato) por un editor **una fila por
  rareza** que consume `GET /admin/pricing/rarities` (rarezas distintas del catálogo unidas a las reglas,
  con `cardCount` + `source` rule/fallback) y guarda con `PUT /admin/pricing/buylist-rules`.
- Cada fila: **selector de modo `fixed|pct`** + **campo de valor** (si `fixed` → MX$ en pesos↔centavos con
  prefijo `MX$`; si `pct` → % con sufijo `%`) + badge de origen (Regla/Fallback). Encima, un **campo de
  fallback %** para rarezas sin regla explícita.
- **Guardado sin redeploy**: el `PUT` envía `{ rules, fallbackPct }` preservando las reglas explícitas del
  servidor y aplicando el borrador encima; una rareza dejada en fallback (no editada) **no** se incluye
  (sigue en fallback); editar una fila de fallback la **promueve** a regla explícita. Loading/error/success
  con `Banner` (patrón M2).
- Se retiró de la UI el uso de `getRarityMap/updateRarityMap` (siguen en `api.ts`/fixtures como legacy
  deprecado); el editor nuevo NO los consume.

### 2. Cotizador y detalle de buylist — nuevo shape `rarity` + `appliedRule`
- `BuylistQuoteResponse` y `SellItemDTO` (`types/contract.ts`) ahora exponen **`rarity`** + **`appliedRule`
  = { mode, value, source }** en vez de `category`. `POST /buylist/requests` ya **no** envía `category`
  (`CreateSellRequestInput.items` sin `category`; el backend deriva la regla server-side de `Card.rarity`).
- `BuylistView` muestra al usuario la **rareza oficial** y la **regla aplicada legible**: `"$1.50 fijo"`
  (`ruleFixed`) o `"40% de referencia"` (`rulePct`). `BuylistKycForm` dejó de recibir/enviar `category`.
- Mock del cotizador (`api.ts`) reescrito para resolver por **regla de rareza** vía
  `fx.resolveBuylistRule()`: `fixed` cotiza sin referencia; `pct` cotiza `% de la referencia` o cae a
  `precio_pendiente` si falta; rareza sin regla → **fallback 40%**. El seed preserva el negocio vigente
  (Common/Uncommon $0.50 fijo, Reverse Holo $1.50 fijo, resto 40%).

### 3. M6 — reset de contraseña y eliminar usuario (super_admin)
- **Reset:** botón en la ficha 360° → `POST /admin/users/:id/reset-password` → modal que muestra la
  **temp password EN CLARO UNA sola vez** (bloque `code` + botón **Copiar**), con aviso de "una sola vez",
  nota para compartirla por canal seguro y nota de `mustChangePassword`. Al cerrar el modal **no** se
  re-muestra (estado local `resetResult` se limpia; también se limpia al cambiar de usuario).
- **Eliminar:** botón `destructive` con **modal de confirmación clara** → `DELETE /admin/users/:id` →
  muestra el **resultado `mode`**: `hard` = "borrado total" / `soft` = "anonimizado, conserva historial".
  Maneja **`409 CANNOT_DELETE_SELF`** (banner de error específico) y **deshabilita** el botón cuando
  `useSession().user.id === selectedId` (no borrarse a uno mismo). Nuevo valor de estado `deleted` en el
  badge de usuario (`UserStatusBadge`); las acciones de cuenta se ocultan para cuentas ya `deleted`.
- **`mustChangePassword`:** `UserDTO.mustChangePassword?`. Tras un login que lo indique, `AuthForm` muestra
  un **aviso** (`Banner` warning) con botón "Continuar" que enruta al destino por rol (no hay página
  dedicada de cambio de contraseña en el MVP; ver solicitud al arquitecto).

### Archivos
- **Tipos** `src/types/contract.ts`: +`BuylistRuleMode`, `BuylistRule`, `BuylistRuleApplied`,
  `BuylistRulesDTO`, `BuylistRarityRowDTO`, `BuylistRaritiesResponse`, `AdminUserStatus`,
  `ResetPasswordResponse`, `DeleteUserResponse`; `BuylistQuoteResponse`/`SellItemDTO` re-shaped;
  `UserDTO.mustChangePassword?`; `AdminUserSummaryDTO.status` incluye `deleted`.
- **API** `src/lib/api.ts`: +`getBuylistRarities`, `getBuylistRules`, `updateBuylistRules`,
  `resetUserPassword`, `deleteUser`; `getBuylistQuote`/`createSellRequest` re-shaped (sin `category`).
- **Fixtures** `src/lib/mock/fixtures.ts`: +`mockBuylistRules`, `mockBuylistFallbackPct`,
  `setMockBuylistRules`, `resolveBuylistRule`, `mockBuylistRarities`; `mockSellRequests` re-shaped.
- **UI** `m2/M2View.tsx` (editor por rareza), `buylist/BuylistView.tsx`, `BuylistKycForm.tsx`,
  `m6/M6View.tsx` (reset/eliminar), `AuthForm.tsx` (mustChangePassword), `components/ui/Input.tsx`
  (soporte `suffix`).
- **i18n** `messages/{es,en}.json`: +`buylist.{rarityLabel,appliedRuleLabel,ruleFixed,rulePct}`,
  `admin.m2.buylistRules.*`, `admin.m6.{deleted,accountTitle,reset*,tempPassword,copy,copied,delete*}`,
  `auth.{mustChangePassword,mustChangeContinue}`.
- **Tests** (+9): `M2View.test.tsx` (editor rareza: render, fixed→centavos+guardar, fallback, promoción de
  modo), `M6View.test.tsx` (reset una-sola-vez, delete confirm+mode hard, 409 self), `api.test.ts`
  (fixed/pct/fallback), `BuylistView.test.tsx`/`BuylistKycForm.test.tsx` re-shaped, `e2e/buylist.spec.ts`
  actualizado a `appliedRule`.

### Endpoints consumidos
- M2: `GET /admin/pricing/rarities`, `GET/PUT /admin/pricing/buylist-rules` (rama real + mock).
- Buylist: `POST /buylist/quote` (nuevo shape), `POST /buylist/requests` (sin `category`).
- M6: `POST /admin/users/:id/reset-password`, `DELETE /admin/users/:id`.

### Supuestos / solicitudes al arquitecto
1. **`mustChangePassword`** — el contrato lo declara opcional (flag del backend) y no fija una página de
   cambio de contraseña. La UI muestra un **aviso** tras el login y enruta por rol. **Solicitud**: si se
   desea forzar el cambio, definir endpoint/página de cambio de contraseña (`POST /users/me/password`?);
   hoy no existe y no bloquea.
2. **`GET /admin/pricing/rarities`** — se consume `{ fallbackPct, rarities:[{ rarity, cardCount, rule,
   source }] }` tal cual el contrato §M2. El `PUT /buylist-rules` recibe la tabla completa `{ rules,
   fallbackPct }`; el front preserva las reglas explícitas y sólo promueve a explícitas las filas editadas.
3. **`DELETE /admin/users/:id`** — se asume 200 `{ userId, mode }` y `409 CANNOT_DELETE_SELF`; el front
   también deshabilita el botón para la cuenta propia (`useSession`). Sin cuerpo en el request.
4. El editor de rareza **reemplaza** la UI de `rarity-map` (deprecado v1.3.1). Las funciones/fixtures
   `getRarityMap/updateRarityMap/mockRarityMap` quedan como legacy sin uso en UI.

## Fix bug reportado — feedback visible en el sync de catálogo de M2 (2026-08-16)

Bug del humano: en `/admin/m2` (Sección 5, "Sync de catálogo") los botones **Backfill**,
**Import/Re-sincronizar** (por set) y **Sync de todo el catálogo** "no hacían nada" al hacer clic.
Causa raíz: las mutaciones solo tenían `onSuccess` (invalidaban `remote-sets`); **sin manejo de
error ni feedback**. Cuando el backend fallaba (rate limit de pokemontcg.io sin API key, timeout del
sync síncrono, 5xx) el botón salía de `loading` y no aparecía nada → parecía inerte. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato ni el backend; es puro feedback de UI con el patrón de
Banners/`errorCodes` ya usado.

### Qué se hizo (`m2/M2View.tsx`)
- **Helper de error:** se importa `useErrorMessage` de `QueryState` (`getError`) — mapea el `code` del
  `ApiClientError` a copy localizado (`error.<CODE>`, fallback `common.errorGeneric`), mismo patrón que
  el resto de la app.
- **Sync por set (Importar/Re-sincronizar), `catalogSyncMutation`:** antes SIN feedback. Ahora:
  Banner `info` mientras `isPending` (aviso "sincronizando… puede tardar"), Banner `success` con el
  resultado del backend (`syncDone`: "Sync encolado: N set(s) (job …)"), y Banner `danger` (`role=alert`,
  con título + `getError`) al fallar. Esta era la causa principal del "no hace nada".
- **Backfill, `backfillMutation`:** tenía success, **le faltaba el error** → se añadió Banner `danger`
  con `getError`.
- **Sync total, `syncAllMutation`:** mantiene success. El error ahora **distingue**: un **404/405**
  (endpoint aún no existe en backend, contrato v1.3 condicional) conserva el aviso `warning` "no
  disponible"; **cualquier otro error real** (rate limit, timeout, 5xx) muestra Banner `danger` con el
  código/mensaje (antes CUALQUIER fallo se tragaba como "no disponible", ocultando errores reales).
  Helper local `isEndpointMissing()` (status 404/405 del `ApiClientError`).
- **Hint de sincronía:** texto bajo el subtítulo (`catalog.syncHint`) avisando que import/resync/backfill
  corren **síncronos**, pueden tardar y el resultado aparece al terminar.
- **Alineación del resto de mutaciones de M2** (tenían feedback parcial o nulo):
  - **Sync de precios** (`syncMutation`): ya tenía banners; su error genérico (`errorGeneric`) se cambió
    a `getError(error)` para mostrar el código real.
  - **FX** (`fxUpdateMutation`/`fxRefreshMutation`): sin feedback → Banner `success` (`fx.saved`) y
    `danger` (`getError`) por cada uno.
  - **Rareza→categoría** (`rarityMutation`): sin feedback → `success` (`rarityMap.saved`) y `danger`.
  - **Override manual** (`overrideMutation`, en el modal): sin feedback de error → Banner `danger` dentro
    del modal (el éxito cierra el modal, que ya es la señal). El `loading` del botón se mantiene.
- **`remote-sets`** (lista de sets) ya se renderiza dentro de `QueryState` (loading/error + Retry) — se
  verificó; el usuario ve el error de la query y puede reintentar.

### i18n (ES/EN espejado, pasa `i18n-parity`)
- `admin.m2.catalog`: `syncHint`, `syncRunning`, `syncDone`.
- `admin.m2.fx.saved`, `admin.m2.rarityMap.saved`.

### Tests (`m2/M2View.test.tsx`, +5; suite total **98** verde)
Con `vi.spyOn(api, …).mockRejectedValueOnce(new ApiClientError(...))`:
- sync por set → **429 RATE_LIMITED** muestra Banner de error con el copy del contrato + `role=alert`.
- backfill → **500 INTERNAL** muestra Banner de error.
- sync total → **500** muestra Banner `danger` y **no** el aviso "no disponible".
- sync total → **404** conserva el aviso `warning` "no disponible".

Gates (desde `frontend/`): `lint` OK · `typecheck` OK · `test` **98/98** (22 archivos) · `build` OK.

## Auth del back-office + auto-logout por inactividad + redirección por rol (2026-08-16)

Tres cambios de sesión/auth reportados por el humano probando en producción (backend real, mocks off).
Solo `frontend/` (+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK,
`test` **94** (22 archivos, +12 nuevos), `build` OK. i18n parity ES/EN intacta.

### 1. El back-office EXIGE sesión (antes: super_admin falso + 401)
- **`AdminShell.tsx`** (grupo `(admin)`) ahora consume `useSession()`. En **modo real** (`!config.useMocks`)
  `requireAuth = true`: mientras `!ready` o `!isAuthenticated` **no** renderiza el back-office — muestra un
  estado de carga (`admin.authLoading`, spinner). Cuando `ready && !isAuthenticated` redirige a
  `/login` con `router.replace({ pathname:'/login', query:{ next: pathname } })` (router de next-intl,
  preserva locale; `next` para volver tras login). En **modo mock/demo** `requireAuth=false`: se deja pasar
  (comportamiento de demostración sin backend).
- **`role.tsx` (`RoleProvider`)** dejó de hardcodear `'super_admin'`. Ahora:
  - Modo real: `role = useSession().user.role` (el backend deriva el rol del JWT y es la autoridad);
    `setRole` es **no-op** y expone `canSwitchRole=false`.
  - Modo mock/demo: sigue el dial local (localStorage `tcg.role`, default `super_admin`) para demostrar el
    enmascarado financiero; `canSwitchRole=true`.
- **`AdminTopbar.tsx`**: el selector "Ver como" (mock role switcher) se renderiza **solo si `canSwitchRole`**
  (modo mock). En modo real muestra el rol autenticado como texto (no editable). El backend sigue siendo la
  autoridad; esto es defensa de UI.

### 2. Auto-logout por 5 min de inactividad (app-wide, todos los roles)
- **`lib/inactivity.tsx` (nuevo)** — `InactivityProvider` montado dentro de `Providers` (raíz), cubre
  storefront + admin. Constante `INACTIVITY_LOGOUT_MS = 5*60*1000`. Solo actúa con sesión activa
  (`useSession().isAuthenticated`). Reinicia el timer con `mousemove/mousedown/keydown/scroll/touchstart`
  (listeners `passive`) y al volver la pestaña visible (`visibilitychange`). Al expirar: `logout()` (de
  `api.ts`, limpia token+user server/local) + `router.replace('/login?reason=inactivity')`. Como `logout()`
  emite el evento de sesión (`tcg.session.changed` + `storage`), **otras pestañas** también quedan
  deslogueadas (sync entre pestañas).
- **`login/page.tsx`** lee `searchParams` (server) y pasa `notice='inactivity'` + `next` a `AuthForm`.
- **`AuthForm.tsx`** muestra `Banner variant="warning"` con `auth.inactivityLogout` cuando
  `notice==='inactivity'` (sin `useSearchParams`, para no forzar Suspense en build).

### 3. Redirección post-login según rol (antes: todos iban a `/`)
- **`AuthForm.tsx`**: tras login/registro exitoso redirige con `destForRole(res.user.role)`:
  `super_admin`/`vault_operator` → **`/admin`**, resto → **`/`**. Si hay `?next` **interno** (empieza con
  `/`) se honra por encima del rol (evita open redirect validando el prefijo).
- **`GoogleSignInButton.tsx`**: `onSuccess` ahora recibe el `role` (`onSuccess(res.user.role)`); `AuthForm`
  lo enruta igual. Registro enruta por rol (normalmente `customer` → `/`).

### Archivos tocados
- `src/components/layout/AdminShell.tsx` (gate de sesión + loading), `src/components/layout/AdminTopbar.tsx`
  (switcher solo en mock), `src/lib/role.tsx` (rol desde sesión / dial en mock + `canSwitchRole`),
  `src/lib/inactivity.tsx` (nuevo), `src/components/Providers.tsx` (monta `InactivityProvider`),
  `src/components/domain/AuthForm.tsx` (redirect por rol + aviso inactividad + `next`),
  `src/components/domain/GoogleSignInButton.tsx` (`onSuccess(role)`),
  `src/app/[locale]/(auth)/login/page.tsx` (searchParams → notice/next),
  `messages/{es,en}.json` (`auth.inactivityLogout`, `admin.authLoading`).
- Tests nuevos: `AdminShell.test.tsx` (sin sesión → loading + `replace` a `/login?next=/admin`; con sesión
  renderiza y el rol viene de la sesión — super_admin/vault_operator; switcher off en real),
  `lib/inactivity.test.tsx` (fake timers: dispara `logout`+redirect tras el umbral; la actividad reinicia el
  timer; sin sesión nunca dispara), `AuthForm.test.tsx` ampliado (redirect super_admin/operator→`/admin`,
  customer→`/`, `next` interno gana; aviso de inactividad).

### Solicitudes al arquitecto
- Ninguna. El rol de sesión ya viene en `AuthResponse.user.role` y `GET /users/me`; `POST /auth/logout` ya
  existe (§1). El gate y el timer son puramente de cliente (defensa de UI); el backend sigue siendo la
  autoridad de autorización (rechaza 401 sin sesión).

## Fix bloqueante techlead — sincronización del form de KYC en M6 (2026-08-16)

Rechazo de techlead: el subformulario de KYC de la ficha 360° (`M6View.tsx`) no sincronizaba su
estado con el usuario cargado. `kycStatus` se inicializaba en `'none'` y nunca se sincronizaba al
llegar `detail.data`; `capRequest`/`capMonth` (`useState('')`) no se reiniciaban al cambiar de
usuario. Como la mutación `updateUserKyc` **siempre** envía `kycStatus`, abrir un usuario `verified`
para ajustar un tope y guardar degradaba silenciosamente el KYC a `'none'` (corrupción de datos que
gobierna topes/INE de dinero saliente); además un borrador tecleado para el usuario A sobrevivía al
abrir el usuario B.

**Fix (patrón "cae al servidor mientras no esté dirty", como M10):**
- Se reemplazaron los tres `useState` sueltos por un único **borrador** `kycDraft` que guarda solo
  las keys que el admin tocó explícitamente.
- Valores efectivos computados: `kycStatus = kycDraft.kycStatus ?? currentKyc?.kycStatus ?? 'none'`
  (cae al valor del servidor); `capRequest`/`capMonth` caen a `''` (vacío = no enviar, se mantiene
  el placeholder con el valor del servidor). Así "Guardar KYC" **nunca** envía un `kycStatus`
  distinto al cargado salvo que el admin lo cambie a propósito.
- `useEffect(() => setKycDraft({}), [selectedId])`: el borrador **no cruza** entre usuarios; se
  reinicia al cambiar de usuario seleccionado. `d`/`currentKyc` se derivan justo tras el query de
  detalle (se eliminó la computación duplicada de más abajo que llevaba el comentario "Sincroniza…"
  que no sincronizaba).
- Los shapes de la ficha 360° (`clabeMasked`/`rfcMasked`/`capPerRequestCents`) se dejaron intactos
  (correctos según contrato; backend se alinea en paralelo).

**Tests añadidos** (`M6View.test.tsx`): (1) al cambiar de usuario seleccionado el form refleja los
valores del nuevo usuario y no arrastra el borrador del anterior (Ana `verified` → Bruno `none`,
tope tecleado se limpia); (2) guardar tras ajustar solo un tope envía `kycStatus:'verified'` (el del
servidor), nunca `'none'` — se verifica el payload de `updateUserKyc` con `vi.spyOn`.

Gates en verde: lint, typecheck, test (82/82), build. Archivos: `frontend/.../m6/M6View.tsx`,
`frontend/.../m6/M6View.test.tsx`.

## Back-office M7/M9 + Cotizador Opción 1 (2026-08-16) — consumo de módulos ya-existentes + buscador real

Se reemplazaron los `ModuleTodo` de **M7 (Finanzas)** y **M9 (Reportes)** por vistas reales que consumen
endpoints **ya implementados** en backend (CONTRATO v1.3 §M7/§M9: "ya existen; falta consumo de frontend"), y
se reescribió el **cotizador de buylist** para buscar sobre TODO el catálogo (Opción 1, contrato §6 v1.3) en
vez de usar `mockCards` (esa era la causa de "no sale nada al cotizar" contra el backend real). Solo `frontend/`
(+ esta nota). **No** se tocó el contrato. Mismo patrón que M2/M6/M10 (TanStack Query + `QueryState`,
`SuperAdminOnly` para la guarda de rol, `StatCard`/`DataTable`/`Banner`/`Input`/`Button`). Gates en verde:
`lint` OK, `typecheck` OK, `test` **80** (20 archivos, +11 nuevos, i18n-parity verde), `build` OK
(m7/m9 prerenderizados es/en).

### Archivos creados/tocados
- **Tipos** `src/types/contract.ts`: +`PnlDTO`, `InventoryValueDTO`, `CustodyValueDTO`, `IvaByOrderEntryDTO` +
  `IvaReportDTO` (M7); `LaunchGoalsDTO` + `LaunchMetricsDTO` (M9).
- **API** `src/lib/api.ts`: +`getPnl`, `getInventoryValue`, `getCustodyValue`, `getIvaReport`,
  `exportFinanceCsv` (M7), `getLaunchMetrics` (M9), `listBuylistSets` + `searchBuylistCards` (cotizador). Cada
  una con rama real (`apiRequest`) y rama mock. `exportFinanceCsv` hace `fetch` con Bearer y lee **texto**
  (no JSON, por eso no usa `apiRequest`); comparte el `exportCsv` de M7/M9 vía `source: 'finance' | 'reports'`.
- **Util** `src/lib/download.ts` (nuevo): `downloadTextFile(filename, text, mime)` — materializa el CSV como
  descarga en el navegador (aislado para poder mockearlo en tests sin tocar el DOM).
- **Fixtures** `src/lib/mock/fixtures.ts`: +`mockPnl` (con la fórmula coherente), `mockInventoryValue`,
  `mockCustodyValue`, `mockIvaReport`, `mockLaunchMetrics` (con `goals` fijadas de ejemplo), `mockCsv(report)`.
- **M7** (`/admin/m7`, super_admin): `m7/M7View.tsx` + `m7/page.tsx` (envuelto en `SuperAdminOnly`) +
  `m7/M7View.test.tsx`. Selector de rango de fechas (aplica a P&L e IVA), **tarjeta de P&L con el desglose de la
  fórmula** (ingresos + envío − COGS − comisiones Stripe = ganancia, ganancia en verde/rojo según signo), valor
  de inventario (a referencia + a costo + pendientes), valor en custodia, IVA acumulado + desglose por orden
  (`DataTable`), y **botones de export CSV** (pnl/iva/inventory).
- **M9** (`/admin/m9`, super_admin): `m9/M9View.tsx` + `m9/page.tsx` + `m9/M9View.test.tsx`. Selector de rango,
  **métricas de lanzamiento** (users/salesSettled/buylistPaid/withdrawalsNoDispute como `StatCard`) con progreso
  vs metas N/X/Y/Z (si `goals` es null muestra solo conteos + banner), y export CSV.
- **Cotizador** `(storefront)/buylist/BuylistView.tsx`: eliminado el `import { mockCards }`; ahora **filtra por
  set** (`listBuylistSets`) y **busca por texto** (`searchBuylistCards` sobre TODA la tabla `Card`, no solo
  bóveda) → lista de resultados seleccionables (`role="listbox"/"option"`) → al elegir carta se cotiza con el
  `getBuylistQuote({ cardId })` existente. Botón "Cotizar" deshabilitado hasta elegir carta. En modo mock cae a
  `fx.mockCards` (fixtures); en real usa los endpoints nuevos. Nuevo test `BuylistView.test.tsx` (4 casos) y
  `e2e/buylist.spec.ts` actualizado al nuevo flujo (buscar → elegir → cotizar).

### Endpoints consumidos
- M7: `GET /admin/finance/pnl?from=&to=`, `GET /admin/finance/inventory-value`,
  `GET /admin/finance/custody-value`, `GET /admin/finance/iva?from=&to=`,
  `GET /admin/finance/export.csv?report=&from=&to=`.
- M9: `GET /admin/reports/launch-metrics?from=&to=`, `GET /admin/reports/export.csv?report=&from=&to=`.
- Cotizador: `GET /buylist/sets`, `GET /buylist/cards?setId=&q=&page=` (+ el ya existente `POST /buylist/quote`).

### Supuestos sobre el contrato (para el arquitecto)
1. **`GET /admin/finance/iva` › `byOrder`** — el contrato lo describe como `byOrder: [...]` sin fijar campos.
   Asumí `IvaByOrderEntryDTO = { orderId, ivaCents, settledAt? }`. **Solicitud**: confirmar/ajustar el shape.
2. **`GET /admin/reports/launch-metrics` › `goals`** — el contrato dice `goals: { N, X, Y, Z }` con "`goals` en
   `null` hasta que el humano fije las metas". Se tipó `goals: LaunchGoalsDTO | null` (goals completo nulo O
   cada valor nulo, ambos soportados en UI). Confirmar cuál es la forma real.
3. **`export.csv` (M7/M9)** — se asume auth por Bearer y respuesta **`text/csv`** descargable; el front hace
   `fetch` directo (no `apiRequest`, que espera JSON) y descarga el blob. `report` default `pnl`. Confirmar el
   `Content-Type` y si requiere algún header extra.
4. **`GET /buylist/cards`** — se reutiliza `CardDTO` y `Paginated` tal cual el contrato (`{ data, page,
   pageSize, total }`, sin `sellable`/precio). El filtro `rarity` está cableado en `searchBuylistCards` pero la
   UI del cotizador hoy solo expone set + texto (rareza es opcional en el contrato); ampliable sin cambio de API.

Con **mocks** (`NEXT_PUBLIC_USE_MOCKS != false`) todo corre contra fixtures que respetan estos shapes; con
`useMocks=false` se ejecutan las ramas `apiRequest`/`fetch` contra el backend real.

## Back-office M2 / M6 / M10 (2026-08-16) — consumo de UI de módulos ya-existentes en backend

Se reemplazaron los `ModuleTodo` de **M2 (Catálogo y precios)**, **M6 (Usuarios/KYC)** y **M10 (Config y
bitácora)** por vistas reales que consumen los endpoints **ya implementados** en backend (ARCHITECTURE/
CONTRACT v1.3: M2/M6/M10 "ya existen; falta consumo de frontend"). Solo `frontend/` (+ esta nota). **No** se
tocó el contrato. Se siguió el patrón de M1/M3/M4/M5/M8 (TanStack Query + `QueryState` loading/error, mismos
componentes UI, `StatusBadge`/`Badge`, `DataTable`, `Modal`, `Banner`). Gates en verde: `lint` OK, `typecheck`
OK, `test` **71** (17 archivos, +11 nuevos, i18n-parity verde), `build` OK (m2/m6/m10 prerenderizados).

### Archivos por módulo
- **Comunes**: `src/types/contract.ts` (+DTOs: `FxDTO`, `PendingPriceEntryDTO`, `RarityMapEntryDTO`,
  `RemoteSetDTO`, `PriceHistoryEntryDTO`, `PricingSyncResponse`, `CatalogSync*Response`, `AdminUserSummaryDTO`,
  `AdminUserDetailDTO`, `AdminKycProfileDTO`, `AdminBillingProfileDTO`, `SettingsDTO`, `AuditLogDTO`,
  `FxSource`). `src/lib/api.ts` (+funciones de los 3 módulos, cada una con rama real `apiRequest` y rama mock).
  `src/lib/mock/fixtures.ts` (+fixtures marcados MOCK). `src/components/domain/SuperAdminOnly.tsx` (nuevo:
  guarda de UI para M2/M6/M10; el backend ya rechaza por rol, esto es defensa de navegación directa por URL con
  el patrón `useRole`). `messages/{es,en}.json` (+claves `admin.m2/m6/m10.*` y `admin.superAdminGate*`).
- **M2** (`/admin/m2`): `m2/M2View.tsx` + `m2/page.tsx` (envuelto en `SuperAdminOnly`) + `m2/M2View.test.tsx`.
  Secciones: (1) **sync de precios de bóveda** (`POST /admin/pricing/sync`), (2) **cola de precio pendiente**
  (`GET /admin/pricing/pending`) con **override manual** en modal (`POST /admin/pricing/override`),
  (3) **FX** (`GET/PUT /admin/fx` + `POST /admin/fx/refresh`) con display de tasa/colchón/fuente/vigencia y
  edición de override + refresh Banxico, (4) **rareza→categoría** editable (`GET/PUT /admin/pricing/rarity-map`),
  (5) **sync de catálogo** (`GET /admin/catalog/remote-sets` con imported/cardCount, `POST /admin/catalog/sync`
  por set, `POST /admin/catalog/backfill`, y `POST /admin/catalog/sync-all` **condicional**: su fallo muestra
  aviso "no disponible" sin romper — cumple la nota del contrato v1.3). `GET /admin/pricing/card/:id`
  (historial) queda cableado en `api.ts` (`getPriceHistory`) pero **aún no montado** en UI (deuda menor).
- **M6** (`/admin/m6`, super_admin): `m6/M6View.tsx` + `m6/page.tsx` + `m6/M6View.test.tsx`. Tabla de usuarios
  con **búsqueda `q` + filtro `status` + paginación** (`GET /admin/users`) y **ficha 360°** en modal
  (`GET /admin/users/:id`): identidad, KYC con **CLABE/RFC enmascarados** (nunca en claro), conteos 360°
  (órdenes/buylist/disputas/bóveda), direcciones, **editar KYC** (`PATCH /admin/users/:id/kyc`) y
  **bloquear/reactivar** con confirmación (`PATCH /admin/users/:id/status`).
- **M10** (`/admin/m10`, super_admin): `m10/M10View.tsx` + `m10/page.tsx` + `m10/M10View.test.tsx`. **Editor de
  diales** (`GET /admin/settings`) que guarda **body PARCIAL** con solo las keys tocadas
  (`PUT /admin/settings`, NO per-key) — dials money en pesos↔centavos; y **bitácora** paginada con filtro por
  acción (`GET /admin/audit-log`).

### Endpoints consumidos
- M2: `POST /admin/pricing/sync`, `GET /admin/pricing/pending`, `POST /admin/pricing/override`,
  `GET /admin/pricing/card/:id` (cableado, sin UI aún), `GET/PUT /admin/fx`, `POST /admin/fx/refresh`,
  `GET/PUT /admin/pricing/rarity-map`, `GET /admin/catalog/remote-sets`, `POST /admin/catalog/sync`,
  `POST /admin/catalog/backfill`, `POST /admin/catalog/sync-all` (condicional).
- M6: `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/kyc`, `PATCH /admin/users/:id/status`.
- M10: `GET/PUT /admin/settings`, `GET /admin/audit-log`.

### Supuestos sobre el contrato (para el arquitecto)
1. **`GET /admin/pricing/card/:id`** — el contrato dice "historial de precios por fecha/fuente" sin fijar el
   shape. Asumí `PriceHistoryEntryDTO` = `{ capturedDate, source, gradeKey, productType, priceMxnCents,
   isManualOverride }`. **Solicitud**: confirmar/ajustar el shape del historial. Aún no se monta en UI.
2. **`GET /admin/pricing/rarity-map`** — asumí respuesta `{ entries: [{ rarity, category }] }` (espejo del PUT).
   Confirmar el envelope exacto (`entries` vs `data`).
3. **`GET /admin/audit-log`** — el contrato muestra respuesta `{ data: AuditLogDTO[] }`; se normaliza a
   `Paginated` en el front (page/pageSize/total con fallback). Si el backend ya devuelve `total`, se usa; si no,
   la paginación del front se apoya solo en `data.length`. **Solicitud**: confirmar si expone `total` para
   paginación fiel.
4. **`GET /admin/users/:id`** — la ficha 360° (kycProfile/billingProfile/addresses/orders/sellRequests/disputes/
   ownedItems) se tipó según la nota del contrato §M6; nombres de sub-campos asumidos (p.ej. `clabeMasked`,
   `rfcMasked`, `ineOnFile`). Ajustar si difieren.
5. **`POST /admin/catalog/sync-all`** — usado condicionalmente; si el backend responde 404/405 el error se
   muestra como "no disponible" y el operador usa sync por set / backfill (sin romper).

Con **mocks** (`NEXT_PUBLIC_USE_MOCKS != false`) todo funciona contra fixtures que respetan estos shapes; al
apuntar al backend real (`useMocks=false`) se ejecutan las ramas `apiRequest`.

---

## Fixes UI/sesión en vivo (2026-08-16) — header de sesión, nav "Sell" y banner de login

Tres arreglos reportados por el humano probando la app en producción (backend real, mocks off). Solo
`frontend/` (+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK,
`test` **60** (14 archivos, +6 nuevos), `build` OK.

### 1. Estado de sesión de cliente + header reactivo
- **`src/lib/session.ts` (nuevo)**: hook `useSession()` + helpers `getStoredUser`/`setStoredUser`.
  Mismo idiom que `useCart` (localStorage `tcg.user` + evento `tcg.session.changed` + `storage` para
  sincronía entre pestañas). Expone `{ user, isAuthenticated, ready }`. `ready` es `false` en SSR y en
  el primer render de cliente (patrón "mounted") para **evitar mismatch de hidratación** de Next: el
  header pinta el estado deslogueado hasta que el efecto de montaje lee localStorage.
- **`src/lib/api.ts`**: `persistSession` ahora persiste **también el `user`** de `AuthResponse`
  (`setStoredUser`) además del token — aplica a `login`, `register` y `loginWithGoogle`. Se añadió
  **`logout()`** (contrato `POST /auth/logout` → 204): invalida server-side y limpia token+user; en
  modo mock solo limpia local; aunque el backend falle, el cliente queda deslogueado (`finally`).
- **`src/components/layout/StorefrontHeader.tsx`**: si hay sesión muestra **perfil** (nombre, o email
  como fallback) + botón **"Cerrar sesión"**; si no, el enlace **"Iniciar sesión"** como antes. Se
  actualiza **reactivamente** vía `useSession` (login/logout sin recargar). Implementado en barra
  desktop y menú móvil. El logout llama `logout()` y hace `router.push('/')`.

### 2. Nav "Buylist" → "Sell/Vender" (solo etiqueta; ruta `/buylist` intacta)
- `messages/en.json` `nav.buylist` = **"Sell"**; `messages/es.json` = **"Vender"**.
- Alineado el título cara al cliente `buylist.title`: "Sell your cards" / "Vende tus cartas" (se quitó
  el paréntesis "(Buylist)"). "Buylist" queda solo como término interno/back-office (`admin.modules.m5`
  se mantiene "M5 · Buylist"). Parity ES/EN intacta (test `i18n-parity` verde).

### 3. Banner engañoso de login solo en modo mock
- `src/components/domain/AuthForm.tsx`: el `<Banner variant="info">{t('mockNotice')}</Banner>` ahora se
  condiciona a **`config.useMocks`** — en producción (backend real) no aparece.

### Tests añadidos
- `src/components/layout/StorefrontHeader.test.tsx`: header muestra perfil+logout con sesión y
  "Iniciar sesión" sin ella; fallback a email; logout reactivo (vuelve a deslogueado + `router.push`);
  label del nav = "Sell"/"Vender" apuntando a `/buylist`. Se mockea `@/i18n/navigation`.
- `src/components/domain/AuthForm.test.tsx`: banner visible con `useMocks=true` y ausente con `false`.
- `vitest.setup.ts`: polyfill de `window.matchMedia` (lo usa `ThemeToggle` dentro del header).

---

## Cierre residuo endurecimiento S-B3 (2026-08-15) — `contentLength` en presign + `maxBytes` del presign

Cierre del residuo señalado por qa/techlead/seguridad en el endurecimiento de `kyc_ine`. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato (`contentLength` y `maxBytes` ya son opcionales/aditivos en §8).
Gates en verde: `lint` OK, `typecheck` OK, `test` **52** (12 archivos), `build` OK.

### Qué se hizo
- **`presignUpload` (`src/lib/api.ts`)** ahora acepta y envía **`contentLength`** en el body del presign
  (`{ purpose, contentType, contentLength }`). El backend, cuando llega, lo fija en la firma (`ContentLength`)
  para que R2/S3 **rechace cuerpos de otro tamaño** end-to-end (cierra S-B3). La rama mock devuelve además
  **`maxBytes`** (≈10 MB) para reflejar el tope del presign.
- **`UploadPresignResponse` (`src/types/contract.ts`)** declara **`maxBytes?: number`** (tope de tamaño que
  admite la firma). Es opcional por compat.
- **`PhotoUploader` (`src/components/ui/PhotoUploader.tsx`)**:
  - Pasa **`contentLength: file.size`** al presign.
  - Valida tamaño en cliente contra **`presign.maxBytes` como fuente única de verdad**; `DEFAULT_MAX_UPLOAD_BYTES`
    (constante local) queda **solo como fallback** si el presign no trae `maxBytes`. La validación de tamaño se
    hace **tras** el presign (ya conocemos el tope real); la de **tipo** (`image/*`) sigue antes de pedir presign.
  - **Nit de memoria:** el object URL del preview se **revoca** (`URL.revokeObjectURL`) al re-seleccionar y al
    desmontar (ref `previewUrlRef` + cleanup en `useEffect`).
- **Tests**: `PhotoUploader.test.tsx` cubre que **`contentLength=file.size`** viaja en el presign y que el
  rechazo por tamaño usa **`presign.maxBytes`** (spy con `maxBytes` chico → no sube ni expone `uploadKey`).
  `api.test.ts` fija que el presign mock devuelve `maxBytes`.

## Cableado del INE en buylist/KYC (2026-08-15) — presign `kyc_ine` + creación de solicitud

Se integró el uploader del INE (antes **huérfano**) en el flujo real de buylist/KYC. Solo `frontend/`
(+ esta nota). **No** se tocó el contrato. Gates en verde: `lint` OK, `typecheck` OK, `test` **50** (12
archivos), `build` OK. E2E (Playwright) de buylist ampliado (lo ejecuta QA).

> Nota de entorno: `node_modules` estaba incompleto (faltaba `recharts`); se corrió `npm install` para dejar
> los gates ejecutables. No se cambiaron versiones de `package.json`.

### Qué se hizo
- **`PhotoUploader` (`src/components/ui/PhotoUploader.tsx`)** dejó de ser un mock con `setTimeout`: ahora hace
  el flujo real **presign → PUT al storage → `uploadKey`**:
  1. **Validación de TIPO en cliente**: solo imágenes. El `<input>` es `accept="image/*"` y además se valida
     `file.type.startsWith('image/')` (rechaza p. ej. PDF con error claro, sin subir).
  2. **Validación de TAMAÑO en cliente**: `maxBytes` (default **10 MB**, `DEFAULT_MAX_UPLOAD_BYTES`); si excede,
     error `ine.errTooLarge` con el límite. Además mapea **413** del storage a ese mismo error (rechazo del
     backend por límite) y `VALIDATION_ERROR` a "no es imagen".
  3. **presign** `POST /uploads/presign` con `{ purpose: "kyc_ine", contentType: file.type }` →
     **PUT directo** a `uploadUrl` enviando el `Content-Type` de imagen y `headers` del presign (sin token de
     sesión; URL firmada). Al terminar expone `onUploaded(uploadKey)`.
  - Estados: vacío / subiendo (`aria-busy`, spinner + `sr-only`) / éxito (`Subida ✓`) / error (`role="alert"`,
    borde `danger`, `aria-describedby`). Botón "Retomar" tras éxito; permite re-seleccionar el mismo archivo.
    i18n vía namespace **`ine`** (labels, estados, errores). Objetivo táctil 48px.
- **`BuylistKycForm` (`src/components/domain/BuylistKycForm.tsx`)** — nuevo paso de pago/KYC del buylist:
  - **CLABE** (`Input`, `inputMode=numeric`, máx 18, filtra no-dígitos) con validación cliente `^\d{18}$`.
  - **Dos slots de INE** (anverso/reverso) con `PhotoUploader purpose="kyc_ine"` + **aviso de privacidad**
    obligatorio (`ine.privacy`, DESIGN §7.10).
  - Envía `POST /buylist/requests` (`createSellRequest`) con `{ items:[{cardId, productType, rawCondition:'NM'
    si raw, category}], clabe, ineUploadKeys? }` — las `ineUploadKeys` solo se adjuntan si **ambas** imágenes
    subieron. Mapea errores de negocio del contrato: **`INE_REQUIRED`** (revela/pide el INE), **`CLABE_NOT_OWN_NAME`**,
    **`CLABE_INVALID`**, **`BUYLIST_LIMIT_EXCEEDED`**, y genérico. loading/error/éxito manejados.
- **`BuylistView`**: el botón "Crear solicitud" (antes inerte) abre un **`Modal`** con `BuylistKycForm`; al crear
  se cierra, se invalida `['sell-requests']` (React Query) y se muestra banner de éxito (`buylist.created`).
- **`api.ts`**: nuevas funciones con rama real + rama mock — `presignUpload`, `uploadToPresignedUrl`
  (raw `fetch` con `Content-Type` imagen; 413→`FILE_TOO_LARGE`), `createSellRequest`, `getKyc`, `updateKyc`.
- **Tipos** (`contract.ts`): `UploadPurpose`, `UploadPresignResponse` (`uploadKey/uploadUrl/method/headers/expiresAt`),
  `IneUploadKeys`. `KycInfoDTO.clabe` → **`clabeMasked`** (alineado al contrato: la CLABE se devuelve enmascarada).
- **Fixtures**: `mockKyc` (`KycInfoDTO`); presign mock devuelve `uploadUrl` `mock://…` para cortar red en tests/dev.

### Consumo del presign (según contrato §8) — resumen
`POST /uploads/presign {purpose:"kyc_ine", contentType, contentLength} → {uploadKey, uploadUrl, method:"PUT", headers, expiresAt, maxBytes}`;
el cliente hace `PUT uploadUrl` con `Content-Type` de imagen y los `headers`; luego la `uploadKey` viaja como
`ineUploadKeys.front/back` en `POST /buylist/requests` (o como `ineFrontUploadKey/ineBackUploadKey` en
`PUT /users/me/kyc` vía `updateKyc`, disponible para el flujo de KYC de perfil).

### Coordinación con backend (endurecimiento de `kyc_ine`)
El uploader ya cumple lo pactado: **solo `image/*`** (accept + validación de `file.type`), envía el
**`Content-Type` de imagen** y **`contentLength`** en el presign, valida **tamaño contra `presign.maxBytes`**
(fuente única de verdad; fallback local ~10 MB) y además maneja el **rechazo del backend** (413 y
`VALIDATION_ERROR`) con mensajes claros. Si el backend fija un límite distinto, lo devuelve en `presign.maxBytes`
y el cliente lo respeta sin cambios (ver sección "Cierre residuo endurecimiento S-B3" arriba); no cambia el contrato.

### Tests
- **`PhotoUploader.test.tsx`** (nuevo): render + `accept="image/*"`; rechazo de **no-imagen** (PDF) sin subir;
  rechazo por **tamaño** (con `maxBytes` chico); imagen válida → presign + `onUploaded(kyc_ine/…)` + estado éxito.
- **`BuylistKycForm.test.tsx`** (nuevo): render de CLABE + dos INE + privacidad; validación CLABE 18 dígitos (no
  llama al backend); creación OK (item raw con `rawCondition:'NM'` y categoría); mapeo de `422 INE_REQUIRED`.
- **`e2e/buylist.spec.ts`**: dos casos nuevos — el paso de solicitud pide CLABE + INE (anverso/reverso, `accept=image/*`)
  con aviso de privacidad; creación con CLABE válida muestra la confirmación.

### Nuevas claves i18n (ES/EN espejadas; pasa `i18n-parity`)
- Namespace **`ine`**: `front/back/takePhoto/retake/uploading/uploaded/privacy/errNotImage/errTooLarge/errUpload`.
- **`buylist`**: `requestTitle, clabeLabel, clabeHint, clabeInvalid, clabeNotOwnName, ineSectionTitle,
  ineSectionNote, ineRequiredError, limitExceeded, submit, submitting, requestError, created`.

### Suposiciones sobre el contrato (a confirmar por el arquitecto)
- **Determinación de "INE requerido"**: el front NO conoce el umbral (dial `ineThresholdCents`), así que ofrece
  el INE como **opcional** y se apoya en el `422 INE_REQUIRED` del backend para exigirlo. Si el arquitecto
  prefiere señalizarlo proactivamente, convendría exponer el umbral (p. ej. en `POST /buylist/quote` o en
  `GET /users/me/kyc`, que ya trae `capPerRequestCents/capPerMonthCents/monthUsedCents`). No bloquea; no cambia
  el contrato hoy.
- **`Content-Type` del PUT**: se envía el MIME real de la imagen (`file.type`). Se asume que el presign del
  backend firma para ese `Content-Type` (el request de presign ya envía `contentType`). Confirmar que el storage
  no exige un header adicional fijo (los `headers` del presign se reenvían tal cual).
- **Códigos de error del presign/PUT**: se asume `413` (tamaño) del storage y `422 VALIDATION_ERROR` (tipo) del
  presign, además de los de negocio de `POST /buylist/requests` (`INE_REQUIRED`, `CLABE_NOT_OWN_NAME`,
  `CLABE_INVALID`, `BUYLIST_LIMIT_EXCEEDED`) — todos ya contemplados en el contrato §6/§8.

## Alcance v1.2.1 (2026-08-14) — sin fotos de producto / fix badge / gradeada por cert / disputa por correo

Simplificación aprobada (PROJECT/CONTRATO/ARCH/DESIGN v1.2.1). Solo `frontend/` (+ esta nota). No se tocó
el contrato. Todo mantiene el **toggle de mocks** (rama real `apiRequest` + rama mock en fixtures) e i18n
ES/EN espejado. `lint`/`typecheck`/`test` (42) y Playwright (36) en verde; `build` OK.

### 1. Sin fotos de producto — imagen de catálogo remota
- **Tipos** (`src/types/contract.ts`): eliminados `frontPhotoUrl`/`backPhotoUrl` de `ListingDTO`,
  `HoldingDTO` e `InventoryItemDTO`. La imagen mostrada es **siempre** `card.imageSmallUrl`/`imageLargeUrl`
  (pokemontcg.io).
- **UI**: `ListingCard`, `CardDetailView`, `VaultView`, M1 y M8 usan la imagen de catálogo remota. Se
  **eliminó la pestaña "Fotos"** de la ficha (tabs = Descripción/Condición) y toda la UI de subida/visualización
  de foto de producto en M1 (alta **sin cámara**; banner `admin.m1.noPhotoNotice`).
- **Fixtures**: `mockListings`/`mockHoldings`/`mockInventory` sin URLs de foto propia.
- Claves i18n retiradas (ambos locales): `card.tabPhotos`, `card.frontPhoto`, `card.backPhoto`,
  `admin.m1.photosFront`, `admin.m1.photosBack`.

### 2. Fix del empalme del badge (DESIGN_SYSTEM §7.2b) — regla exacta implementada
- **Ubicación por defecto = FUERA del arte**, en la **fila de info bajo la imagen**. `ListingCard` ya **no**
  monta el `ConditionBadge` con `absolute` sobre la imagen; lo renderiza en una fila propia debajo (raw NM y
  sellado **siempre** ahí).
- **Única excepción sobre el arte** = **chip de grado de gradeada con scrim sólido**: nuevo componente
  `GradedCertChip` variante `scrim` en `top-2 left-2`, fondo `bg-slate-900/90`, texto blanco `text-xs`
  peso 600, `rounded-[6px]` (radius-sm), `px-2 py-0.5`, sombra `shadow-xs`. Nunca se monta raw/sellado sobre
  el arte ni se usan fondos translúcidos. En el card el chip colapsa a `PSA 10` (compact) y el `certNumber`
  completo va en la fila de info + ficha.

### 3. Gradeadas = grado + certificado
- Nuevo **`GradedCertChip`** (`src/components/ui/GradedCertChip.tsx`): formato canónico **`PSA 10 · #12345678`**
  (empresa+grado peso 600, ` · #<certNumber>` `tabular-nums`), `aria-label` con empresa+grado+cert. Variantes
  `soft` (fila de info/ficha) y `scrim` (sobre arte).
- `ConditionBadge` (graded) delega en `GradedCertChip`; nueva prop `certNumber` propagada desde `ListingDTO`/
  `HoldingDTO` en `ListingCard`, `CardDetailView`, `VaultView`.
- **Ficha** (§7.2c): nuevo `CertNumberField` (`src/components/ui/CertNumberField.tsx`) muestra el cert con
  etiqueta "Certificado / Certificate" como **texto copiable + botón "Copiar"** (no se inventa URL de
  verificación de la graduadora; ver solicitud al arquitecto abajo).
- **Admin M1**: alta de gradeada captura **empresa + grado + `certNumber`**; `certNumber` es **requerido para
  publicar** (el botón "Crear item" se deshabilita y el input muestra error si falta). Tipo `ListingDTO.certNumber?`,
  `InventoryItemDTO.certNumber?`, `HoldingDTO.certNumber?`.

### 4. Disputa por correo (reemplaza `PhotoCompare`)
- Nuevo **`DisputeEvidenceContact`** (`src/components/domain/DisputeEvidenceContact.tsx`): muestra el correo
  de soporte desde **`DisputeDTO.evidenceContact`** (de la API; **NO hardcodeado** en la UI) como enlace
  `mailto:` (con asunto citando la referencia) + botón **"Copiar correo"**. Banner `info`.
- **Admin M8** reescrito: **eliminado el comparador de fotos** (`PhotoColumn`/ingreso vs. reclamo). Muestra
  imagen de catálogo del ítem, descripción, `DisputeEvidenceContact` y —para gradeadas— `GradedCertChip` +
  `CertNumberField` como base de resolución. Tipos: `DisputeDTO` sin `ingressPhotoUrls`/`claimPhotoUrls`; con
  `type` (`condition_raw|condition_sealed`), `evidenceContact?` e `item.{productType,gradingCompany,gradeValue,certNumber}`.
- Fixtures `mockDisputes`: 2 disputas (raw + sealed) con `evidenceContact` (placeholder del contrato
  `soporte@tcgvaultmx.com`); graded **no** genera disputa (coherente con `422 NOT_RAW`).
- `legal.disputeBody` (ES/EN) actualizado: la evidencia va **por correo a soporte** (no se sube foto en la app).

### 5. INE conserva su uploader
- `PhotoUploader` (`src/components/ui/PhotoUploader.tsx`) — el **único uploader** del sistema (INE del buylist,
  `purpose="kyc_ine"`) — **no se tocó**. Se retiró su uso en M1 (fotos de producto); queda listo para cablearse
  al flujo de KYC del buylist.

### Tests actualizados
- `ConditionBadge.test.tsx`: caso graded con `certNumber` (`PSA 10 · #cert` + `aria-label`).
- `e2e/admin.spec.ts`: M1 sin uploader (aviso de imagen de catálogo + `certNumber` requerido al elegir graded);
  M8 con panel de evidencia por correo y **sin** comparador de fotos.

### Nuevas claves i18n (ES/EN espejadas)
- `card.certLabel/certCopy/certCopied/gradedCertAria/gradedGuarantee`.
- `admin.m1.noPhotoNotice/certNumberRequired/certNumberError`.
- Namespace `dispute.evidenceTitle/evidenceBody/copyEmail/copied/mailSubject/mailSubjectGeneric`.

### Solicitud al arquitecto/PO (v1.2.1)
- **URL de verificación de la graduadora**: `CertNumberField` deja el `certNumber` como **texto copiable**
  (no enlace) porque no hay URL oficial confirmada. Si el humano confirma el patrón de verificación de PSA/CGC,
  se puede promover a enlace ("Verificar en PSA/CGC", `target=_blank rel=noopener`). No bloquea; no cambia el contrato.
- **`evidenceContact`**: la UI lo consume tal cual del contrato (`POST /disputes`, `GET /admin/disputes/:id`).
  El correo `soporte@tcgvaultmx.com` sigue marcado como *placeholder por confirmar por el humano* en PROJECT/CONTRATO.

## Alcance v1.1 (2026-08-14) — Compra/filtros/NM/sellado/tendencia/Google

Implementación de las 6 superficies nuevas del contrato+diseño v1.1. Solo `frontend/` (+ esta nota).
No se tocó el contrato. Todo con **toggle de mocks** (`config.useMocks`): cada llamada nueva tiene
rama real (`apiRequest`) y rama mock (fixtures) para funcionar en Vercel sin backend. i18n ES/EN espejado.

### Dependencia añadida
- **`recharts` `^2.15`** (`package.json` `dependencies`) para `PortfolioTrendChart`/`PortfolioSparkline`.
  Añadido polyfill de `ResizeObserver` en `vitest.setup.ts` (jsdom no lo trae; lo usa `ResponsiveContainer`).

### Variable de entorno nueva
- **`NEXT_PUBLIC_GOOGLE_CLIENT_ID`** (opcional) — client id de Google Identity Services para el login
  con Google. Leída en `src/lib/config.ts` (`config.googleClientId`). Sin ella (o con mocks activos) el
  botón simula el login. **Solicitud a devops**: añadirla al `.env.example` (comentario "opcional; login Google").

### 1. Rename "Catálogo" → "Compra"
- Rótulos i18n: `nav.shop`/`nav.catalog` = **"Compra"/"Shop"**, `catalog.title` = "Compra"/"Shop",
  `catalog.subtitle`, `card.backToCatalog`, `home.ctaCatalog`, `vault.emptyCta/emptyBody`. El `StorefrontHeader`
  usa `nav.shop`. La **ruta técnica sigue siendo `/catalog`** (y el contrato mantiene `/catalog/cards`);
  se añadió **alias `/compra`** (`(storefront)/compra/page.tsx` → `CatalogView`) para no romper enlaces.
- Semántica v1.1: la vitrina lista **solo inventario publicado con precio** (`getCatalog` mock ya solo
  contiene `sellable && salePriceCents != null`); **Compra nunca muestra "precio pendiente"** (E2E lo asegura).

### 2. Filtros de Compra (`ShopFilters`, §7.16) sobre `GET /catalog/facets`
- `src/components/domain/ShopFilters.tsx`: **rareza** = multi-select buscable/agrupable (taxonomía abierta;
  a la API se manda la rareza CRUDA como CSV). El mapa **rareza→grupo vive en el front**
  (`src/lib/rarity-groups.ts`, grupos standard/ultra/illustration/special, **fallback "other"/"Otras"**).
  **Set con año** ("Nombre (2024)", orden año desc del contrato). **Tipo** (Todo/Raw NM/Graded/Sellado) con
  **sub-filtro de subtipo** de sellado. **Precio** min/max en MX$→centavos. **Orden** (`sort`) sobre el grid.
- `CatalogView` reescrita: panel lateral sticky (lg+) + **bottom sheet** (Modal) en móvil, **chips removibles**
  de filtros activos, sincroniza `getCatalog(filters)`. Nuevos campos en `CatalogFilters`
  (`rarity: string[]`, `sealedSubtype`, `minPriceCents`, `maxPriceCents`, `sort`).

### 3. Condición NM legible (`ConditionBadge`, §7.2b)
- `RawCondition='NM'` (único valor) en `src/types/contract.ts`; **eliminados LP/MP/HP/DMG** de todos los
  selects/tipos (Compra, buylist, admin M1) y fixtures.
- `ConditionBadge` reescrito: raw → **"Casi nueva (NM)" / "Near Mint (NM)"**, tono **success suave**, la
  descripción del estándar en `title` (tooltip) **+ `aria-label`**, badge focuseable (`tabIndex=0`). Claves
  i18n `catalog.condition.nm.{label,desc}`. Prop `compact` colapsa a "NM" conservando el `aria-label` completo.
- **Buylist**: sin selector de condición (NM fijo; se envía `rawCondition='NM'`) + **banner NM-only**
  (`buylist.nmOnlyTitle/Body`). **Admin M1**: raw sin selector (nota NM fija).

### 4. Tarjeta de SELLADO (`ListingCard` variante, §7.1b)
- `ConditionBadge` sellado → badge **"Sellado"** (info + icono `package`) + **subtipo** (`status.sealedSubtype.*`),
  sin condición/rareza. `ListingCard` oculta `#número` para sellado; imagen `object-contain` (ya en `CardImage`).
  `sealedSubtype?` añadido a `ListingDTO/HoldingDTO/SellItemDTO/InventoryItemDTO`.
- **Admin M1** soporta alta de sellado: selector de **subtipo** + **campo de precio (MXN) obligatorio** para publicar.

### 5. Gráfica de tendencia del portafolio (`PortfolioTrendChart`, §7.17)
- `src/components/domain/PortfolioTrendChart.tsx`: **AreaChart** (recharts) estilo acciones, **toggle
  5d/15d/1m/3m/6m/1a/YTD/Máx**, delta con **signo (+/−) + flecha (▲/▼)** además del color (verde↑/rojo↓),
  **costo base** punteado, estados **cargando / vacío ("recopilando datos") / negativo (legítimo) / estimado /
  error**, **resumen textual `aria-live`** (`role="img"` + aria-label) y "Ver como tabla". Colores leídos de los
  tokens CSS (soporta modo oscuro). **`PortfolioSparkline`** opcional en el `StatCard` de valor total en `VaultView`.
- Consume `GET /vault/portfolio/history?range=...`; el mock (`generatePortfolioHistory`) genera una serie
  determinista que termina en el valor actual del portafolio.

### 6. Login con Google (`GoogleSignInButton`, §6.7)
- `src/components/domain/GoogleSignInButton.tsx`: botón neutro `secondary` full-width con logo "G" oficial.
  En modo real (client id + sin mocks) carga **Google Identity Services**, y al recibir el `credential` llama
  `POST /auth/google`; en modo mock simula el canje sin backend. Estados loading ("Conectando…", `aria-busy`)
  y error inline (`error.GOOGLE_TOKEN_INVALID`/`GOOGLE_EMAIL_UNVERIFIED`). Guarda tokens igual que el login normal.
- **D6 (fix v1.1, 2026-08-14):** en modo real, al descartar/omitir el prompt de GIS el `callback` del
  credential nunca corre, así que el botón se quedaba en spinner. Ahora `prompt()` recibe un
  **moment listener**: si `isDismissedMoment()`/`isSkippedMoment()`/`isNotDisplayed()` → `loading=false`.
  Además hay un **timeout de respaldo** (`PROMPT_TIMEOUT_MS`, 60s) que sale del spinner si GIS no notifica
  ni invoca el callback; se limpia en el callback/listener y al desmontar. En modo mock no aplica (login
  simulado). Cubierto en `GoogleSignInButton.test.tsx` (descarte del prompt y `isNotDisplayed`).
- `AuthForm` reescrito: **email/contraseña es la acción primaria** (ahora vía `login()`/`register()` reales con
  rama mock), divisor **"o/or"**, y el botón Google debajo. Login y registro.

### 7. Cliente API (`src/lib/api.ts`)
- Nuevas funciones con rama real+mock: **`getCatalogFacets()`**, **`getPortfolioHistory(range)`**,
  **`loginWithGoogle(idToken)`**, **`login()`/`register()`**. `getCatalog` ajustada a los nuevos campos
  (rareza multi como CSV, precio, sort, sealedSubtype). Buylist mock usa `mockReferenceByCardId`
  (Zapdos sin market price → "precio pendiente" de adquisición; rarezas modernas → `ex_plus` 40%).

### Tests
- **Unit (vitest): 39 verdes** (antes 10). Nuevos: `rarity-groups.test.ts`, `ConditionBadge.test.tsx`
  (NM legible + tooltip/aria-label + sellado), `ShopFilters.test.tsx` (rareza cruda multi, set con año,
  subtipo sellado, precio→centavos), `GoogleSignInButton.test.tsx` (mock deja sesión + onSuccess),
  `PortfolioTrendChart.test.tsx` (vacío, toggle 8 rangos, refetch por rango), `api.test.ts`
  (facets, history, catálogo sin pendientes, buylist ex_plus/pendiente, google). Helper `renderWithProviders`
  (NextIntl + TanStack Query) en `src/test/render.tsx`.
- **E2E (Playwright): 36 verdes** (antes 30). `catalog.spec.ts` reescrita ("Compra", filtro rareza multi-select,
  sellado, NM tooltip, Compra sin "precio pendiente"); nueva `portfolio.spec.ts` (gráfica + toggle de rangos);
  `auth.spec.ts` + login Google (mock). Corridas HOY contra dev server con `NEXT_PUBLIC_USE_MOCKS=true`.
- `lint`/`typecheck`/`build` en verde. `i18n-parity.test.ts` valida la paridad ES↔EN de todas las claves nuevas.

## Rebrand "TCG Vault MX" + política de ventas finales (2026-08-13)

Dos cambios de negocio pedidos por el humano. Solo tocan `frontend/` (+ esta nota). Sin cambios de contrato.

### 1. Rebrand a "TCG Vault MX"

- `common.appName` → **"TCG Vault MX"** en `messages/es.json` (era el placeholder "Bóveda TCG") y
  `messages/en.json` (era "TCG Vault"). Ambos idiomas comparten ahora el mismo nombre de marca.
- El `title`/metadata de `[locale]/layout.tsx` ya se compone con `t('appName')`, así que se
  actualiza solo (verificado en `next build`).
- **`StorefrontHeader.tsx`** tenía el texto **hardcodeado** `"TCG Vault"`; se cambió a
  `t('appName')` (namespace `common`) para que el rebrand sea de una sola fuente.
- Email/dominio placeholder `boveda-tcg.mx` → **`tcgvaultmx.com`**: `checkout.cfdiNotice` ahora usa
  `facturacion@tcgvaultmx.com` (ES y EN). El `tagline` se mantiene sin cambios.
- **Tests E2E de marca:** no existía ningún E2E que asertara el literal "Bóveda TCG" (grep vacío en
  `frontend/e2e/`), por lo que no hubo aserciones de marca que ajustar. El resto del suite no
  hardcodea el nombre de app (usa claves i18n vía `e2e/utils/i18n.ts`).

### 2. Política de reembolsos visible — VENTAS FINALES

Decisión del humano: **todas las ventas son finales, sin reembolso** una vez comprada la carta.
Única excepción: **carta dañada o equivocada** → disputa de condición (7 días, con fotos); si
procede, se compensa y el usuario **conserva la carta** (sin devolución). Todo bilingüe vía
next-intl (nada hardcodeado).

- **Aviso en checkout**: `CheckoutView.tsx` muestra un `Banner variant="warning"` con
  `checkout.finalSaleNotice` ("Todas las ventas son finales. Sin reembolsos salvo carta dañada o
  equivocada.") y una acción/enlace `checkout.viewTerms` → `/terminos`. Colocado junto al banner
  CFDI en el resumen del pago.
- **Página de términos/política** nueva: `src/app/[locale]/(storefront)/terminos/page.tsx`
  (ruta `/es/terminos` y `/en/terminos`, dentro del layout storefront). Server component con
  `generateMetadata` propio. Namespace i18n `legal.*` con: intro, **alcance por tipo de producto**
  (`scopeNote`: aplica a raw, sellado y gradeadas), **reembolsos/ventas finales**
  (`refundTitle`/`refundBody`), **excepción por error de la plataforma**
  (`platformErrorTitle`/`platformErrorBody`: cobro duplicado o compra sin inventario real → siempre
  se reembolsa, sin disputa) y **disputa de condición** (`disputeTitle`/`disputeBody`/
  `disputeWindowNote`/`disputeOutcome`: 7 días naturales **contados desde la entrega** del envío,
  fotos, compensa y conservas la carta). Usa tokens del DESIGN_SYSTEM (Banner warning + cards con
  borde; icono `BadgeCheck` success para el error de plataforma, `ShieldCheck` info para disputa).
  Coherente con el contrato: el reembolso por error de plataforma se materializa vía
  `charge.refunded` (§9) / `POST /admin/orders/:id/refund` (M3, super_admin); la ventana de disputa
  refleja `422 DISPUTE_WINDOW_CLOSED` ("fuera de 7 días desde entrega", §7). Solo texto, sin cambio
  de contrato.
- **Enlaces a términos**: desde el **checkout** (banner) y desde el **footer** del storefront
  (`(storefront)/layout.tsx`, `nav.terms` "Términos y política"/"Terms & policy").
- Claves i18n nuevas (paridad ES↔EN, cubierta por `i18n-parity.test.ts`): `nav.terms`,
  `checkout.finalSaleNotice`, `checkout.viewTerms`, y el namespace `legal.*` completo (incl.
  `scopeNote`, `platformErrorTitle`/`platformErrorBody`, `disputeWindowNote`).

### E2E añadidos/ajustados (en `e2e/checkout.spec.ts`)

- El aviso de ventas finales aparece en **checkout ES** (`finalSaleNotice` + enlace `viewTerms`) y
  en **checkout EN** (`finalSaleNotice`).
- El enlace de términos navega a `/es/terminos` y muestra la política (refund + disputa +
  excepción por error de plataforma + alcance por tipo de producto + ventana desde la entrega).
- La página de términos existe y muestra la política también en **inglés** (`/en/terminos`),
  incluidas las mismas aclaraciones (`platformErrorBody`, `disputeWindowNote`, `scopeNote`).

Suite E2E total: **30/30** en verde (antes 28). Unit **10/10**, `lint`/`typecheck`/`build` en verde.

## Seguridad — SEC-C2: bump de dependencias vulnerables en runtime (2026-08-13)

Remediación del hallazgo **SEC-C2** (`docs/SECURITY_NOTES.md`): dependencias vulnerables en
runtime del frontend. Objetivo: dejar `npm audit --omit=dev` **sin high/critical**.

### Versiones antes → después

| Paquete | Antes | Después | Motivo |
|---|---|---|---|
| `next` | `14.2.15` | `15.5.23` | Crítica/high: cadena de advisories (SSRF middleware/rewrites, cache poisoning, DoS de RSC/Image Optimizer, XSS con CSP nonces). El 14.2.x —incluso el último 14.2.35— NO limpia el audit: varios advisories solo se parchearon en la línea 15.x. `15.5.23` (tag `backport`, el más parcheado de 15) sí lo limpia y **mantiene React 18** (peer `^18.2.0`), evitando migrar a React 19. |
| `next-intl` | `^3.21.1` (v3) | `^4.13.6` (v4) | Prototype pollution (`experimental.messages.precompile` vía claves de catálogo) + open redirect. Corregidos en v4. |
| `postcss` (dev + empaquetado por next) | `8.4.x` / `8.4.31` | `8.5.26` | High: XSS `</style>`, path traversal/lectura arbitraria de `.map` vía `sourceMappingURL`. Se subió el dev-dep **y** se forzó vía `overrides` para deduplicar todas las copias (incluida la que next empaqueta). |
| `sharp` (dep de optimización de imágenes de next) | `0.34.5` | `0.35.3` (via `overrides`) | High: CVEs heredados de libvips (CVE-2026-33327/33328/35590/35591). next declara `^0.34.3`; el `override` lo fuerza a la línea parcheada `>=0.35.0`. |
| `eslint-config-next` | `14.2.15` | `15.5.23` (dev) | Alinear el config de lint con la major de next. |

`overrides` añadidos en `package.json`: `postcss ^8.5.26`, `sharp ^0.35.3`.

### Breaking changes resueltos

- **Next 15 — `params`/`searchParams` async:** el App Router ahora entrega `params` como
  `Promise`. Migrados a `async` + `await params`:
  - `src/app/[locale]/layout.tsx` (layout **y** `generateMetadata`).
  - `src/app/[locale]/(storefront)/catalog/[cardId]/page.tsx`.
  - `src/app/[locale]/(storefront)/orders/[orderId]/page.tsx`.
  (`npm run typecheck` no lo detecta porque las páginas auto-tipan sus props; **`next build`**
  sí aplica el constraint `PageProps` con `params: Promise<…>`, que es donde saltó.)
- **next-intl v3 → v4:** el código de i18n ya usaba la API moderna compatible con v4
  (`defineRouting`, `createNavigation`, `getRequestConfig({ requestLocale })`,
  `createMiddleware(routing)`, `NextIntlClientProvider` sin prop `locale` en el layout),
  así que **no requirió cambios de i18n**. Verificado que sigue funcionando: rutas `/es|/en`,
  catálogos de mensajes, y el `LocaleToggle` (E2E `i18n-locale.spec.ts` + `auth.spec.ts` en verde).

### Estado del audit tras el bump

- **`npm audit --omit=dev` (runtime): `found 0 vulnerabilities`.** SEC-C2 (parte frontend) cerrado.
- **`npm audit` (incluye dev): 5 restantes (1 critical, 1 high, 3 moderate) — TODAS dev-only y
  no explotables en producción.** Son la cadena del **test runner**:
  `vitest → @vitest/mocker/vite-node → vite → esbuild` (advisory `GHSA-67mh-4wv8-2f99`: el
  dev-server de esbuild acepta requests de cualquier web). **No se empaqueta en el bundle de
  producción** (`output: standalone` no incluye devDependencies) y solo aplica al servidor de
  desarrollo local. Subir a `vitest@4` es un major con cambios de config; se deja como deuda
  menor de tooling. El propio `SECURITY_NOTES.md §0` ya clasificó los críticos de `vitest` como
  dev-only. El gate `security-sast.yml` corre `npm audit` con `--omit=dev` (runtime), por lo que
  estos dev-only no lo bloquean.

### Advertencia benigna en build

`next build` emite un warning de webpack cache sobre `next-intl/dist/esm/production/extractor/
format/index.js` (`import(t)` dinámico del extractor de mensajes de v4). Es informativo (cache
de build), no error; la compilación termina en `✓ Compiled successfully`.

### Verde confirmado (post-bump)

`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` (10/10 unit) ✓ ·
`npm run build` ✓ (SSG) · `npm run test:e2e` (**30/30** Playwright, ES+EN) ✓.

---

## Stack implementado

- **Next.js 15.5 (App Router)** + React 18 + TypeScript.
- **Tailwind CSS** con tokens del DESIGN_SYSTEM §11 (CSS variables claro/oscuro en
  `src/app/globals.css`, mapeo en `tailwind.config.ts`). `darkMode: 'class'`.
- **next-intl v4** para i18n ES/EN (default ES), ruteo `[locale]` con `localePrefix: 'always'`.
  (Subido de v3 → v4 por SEC-C2; ver sección "Seguridad — SEC-C2" arriba.)
- **TanStack Query v5** para data fetching (estados carga/error/vacío consistentes).
- **lucide-react** para iconografía; **clsx + tailwind-merge** (`cn`).
- **Vitest + Testing Library** para tests unitarios.
- **Playwright** (`@playwright/test`) para E2E de flujos contra la app corriendo. Usa el
  **Chromium ya instalado** del entorno (`/opt/pw-browsers/chromium`), sin descargas.
- Output `standalone` (compatible con `Dockerfile.frontend` de devops).

## Cómo correr

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000 (redirige a /es)
npm run lint       # eslint (next/core-web-vitals)
npm run typecheck  # tsc --noEmit
npm run test       # vitest unit (10 tests)
npm run build      # next build (standalone)
npm run test:e2e   # Playwright E2E (30 tests) — ver sección "Tests E2E"
```

Variables (raíz `.env.example`, `NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_API_BASE_URL` — base del API (default `http://localhost:3001/api/v1`).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — clave pública Stripe (aún no cableada, ver TODO).
- `NEXT_PUBLIC_DEFAULT_LOCALE` — `es`.
- **`NEXT_PUBLIC_USE_MOCKS`** (nuevo, opcional) — si NO es `"false"`, el cliente usa
  fixtures locales en vez de llamar al backend. **Default: mocks activos** para poder
  trabajar sin backend. Poner `NEXT_PUBLIC_USE_MOCKS=false` cuando el backend esté arriba.
  → **Solicitud a devops**: añadir esta var al `.env.example` (comentario "local ok").

## Arquitectura del cliente

- **Tipos espejo del contrato**: `src/types/contract.ts` (enums, DTOs base, DTOs por dominio).
- **Cliente API tipado**: `src/lib/api-client.ts` (fetch + `Authorization: Bearer`, mapeo de
  `error.code` a `ApiClientError`) y `src/lib/api.ts` (funciones por endpoint con **fallback a
  mocks**). El punto de integración real está listo: cada función llama a `apiRequest(...)`
  cuando `config.useMocks === false`, usando exactamente las rutas del contrato.
- **Mocks**: `src/lib/mock/fixtures.ts`, marcados `// MOCK: pendiente de backend`. Respetan los
  shapes del contrato; nombres de cartas/sets en inglés (datos de catálogo no se traducen).
- **Mapa de estados** (`src/lib/status-map.ts`): enum del contrato → `{tono de color, forma,
  clave i18n, icono}` según DESIGN_SYSTEM §2.4. Regla **estado = color + texto + icono**.
- **Formato**: `src/lib/format.ts` (`formatMoneyCents` centavos→`MX$`, `formatDate` localizada).
- **Rol de back-office** (`src/lib/role.tsx`): contexto que simula `super_admin`/`vault_operator`
  para demostrar enmascarado financiero y bloqueo de dinero saliente (el backend lo deriva del JWT).

## i18n (ES/EN)

- Catálogos: `messages/es.json` y `messages/en.json`. Cubren `common/nav/catalog/card/checkout/
  vault/shipments/buylist/orders/auth/admin.*` y, clave para el contrato:
  - `status.<domain>.<value>` para **todos los enums** (ownership, order, shipment, sellRequest,
    sellItem, price, dispute, kyc, inventory).
  - `error.<CODE>` para todos los códigos del contrato (`PRICE_PENDING`, `ITEM_NOT_SETTLED`,
    `ADDRESS_NOT_MX`, `BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`, `CLABE_NOT_OWN_NAME`,
    `MONEY_OUT_FORBIDDEN`, etc.).
- Toggle `LocaleToggle` (segmented ES|EN) cambia el locale por ruta. Persistencia con sesión
  (`PATCH /users/me`) queda marcada como TODO cuando exista auth real.
- Un test verifica **paridad de claves ES↔EN** (`i18n-parity.test.ts`) para evitar traducciones
  faltantes, y que cada enum del contrato resuelve a una clave existente en ambos idiomas.

## Pantallas — estado

**Storefront / comprador (completas contra el contrato, con mocks):**
- **Catálogo** (`/catalog`): grid responsivo 2→5, filtros set/rareza/condición/tipo, búsqueda,
  paginación de shape del contrato, PriceTag (venta vs referencia), estados carga/vacío/error.
- **Ficha de carta** (`/catalog/[cardId]`): imagen grande de catálogo (pokemontcg.io), tabs
  (descripción/condición; **sin pestaña "Fotos"** desde v1.2.1), badges condición/grado + certificado
  (`GradedCertChip`/`CertNumberField`), distinción **valor de mercado** vs **precio de venta**, ejemplares.
- **Checkout** (`/checkout`): `AmountBreakdown` (subtotal + fee gross-up **sin IVA** + IVA 16% +
  total), banner CFDI "enviar correo con datos fiscales", banner titularidad pendiente. Pago
  **simulado** (ver TODO Stripe).
- **Mi bóveda** (`/vault`): holdings con badge de titularidad `pending/settled` (color+texto+icono
  candado), **valor de portafolio** contra `referenceValue`, exclusión de precio pendiente, banner
  de custodia, botón retirar deshabilitado para `pending`.
- **Retiro/envío** (`/shipments`): selección de items `settled`, rechazo de no-MX (`ADDRESS_NOT_MX`),
  aviso "solo settled", `AmountBreakdown` de envío+IVA, tarifa fija, PipelineStepper de envío.
- **Buylist** (`/buylist`): cotizador público (categoría+monto o "precio pendiente"), banner
  persistente **PAY_AFTER_RECEIPT**, **guía de envío seguro** (sleeve/top loader) en modal, KYC/
  CLABE/INE avisados, mis solicitudes con PipelineStepper y estados por item.
- **Órdenes** (`/orders`, `/orders/[orderId]`): lista + detalle con desglose, CFDI y solicitar factura.
- **Auth** (`/login`, `/register`) + `LocaleToggle`. Sesión **simulada** (ver TODO).

**Back-office (responsive, captura foto móvil):**
- **Admin shell** (`/admin`): sidebar M1–M10 agrupado, topbar con switch de rol, LocaleToggle,
  ThemeToggle, drawer en móvil. Módulos no permitidos al operador aparecen con candado.
- **Dashboard**: 8 StatCards; enmascarado financiero (candado "Solo súper-admin") para `vault_operator`.
- **M1 Inventario**: alta **sin cámara/uploader de producto** (v1.2.1: se usa la imagen de catálogo remota;
  banner `admin.m1.noPhotoNotice`). Captura tipo/subtipo/condición, **empresa+grado+`certNumber`** (requerido
  para publicar gradeada), ubicación, tipo de adquisición, % aportación con hint de costo; tabla con
  folio/estado/referencia. (El único uploader del sistema es el del INE en el buylist/KYC.)
- **M3 Órdenes**: tabla + **reembolso** destructivo (solo super_admin; operador ve banner
  `MONEY_OUT_FORBIDDEN`).
- **M4 Retiros**: cola de envíos con PipelineStepper + **lista de picking ordenada por ubicación**.
- **M5 Buylist**: PipelineStepper, **cherry-pick por item** (aprobar/ajustar/rechazar/convertir),
  **pago SPEI** solo super_admin.
- **M8 Disputas**: **disputa por correo** (v1.2.1: `DisputeEvidenceContact` con el `evidenceContact` del
  contrato como `mailto:`; **sin comparador de fotos**), imagen de catálogo + descripción y —para gradeadas—
  `GradedCertChip`/`CertNumberField` como base de resolución; resolver recompra (super_admin)/rechazo.

**Pendientes (TODO, documentados en UI):** M2 (precios/FX/override), M6 (usuarios/KYC 360°),
M7 (finanzas/P&L/export CSV), M9 (reportes), M10 (config/diales/bitácora). Rutas creadas con
placeholder `ModuleTodo`; los endpoints del contrato están mapeados en los tipos.

## Componentes del DESIGN_SYSTEM implementados

`Button, Input, Select, Badge, StatusBadge, Banner, Modal, PriceTag, CardImage, ConditionBadge,
ListingCard (CardTile), AmountBreakdown, StatCard, PipelineStepper, PhotoUploader, LocaleToggle,
ThemeToggle, SafeShippingGuide, DataTable (responsive → cards en móvil), EmptyState, Skeleton,
QueryState`. Todos consumen solo tokens semánticos (sin hex crudo), tienen foco visible 3px,
objetivos táctiles ≥44px, y estados carga/vacío/error donde aplica.

## Tests unitarios (vitest, 10, todos verdes)

- `AmountBreakdown.test.tsx`: render de las 4 líneas + total formateado; variante envío; ES y EN.
- `StatusBadge.test.tsx`: enum→texto en ES y EN (cambio de idioma), badge de precio pendiente.
- `format.test.ts`: centavos→MXN, nunca centavos crudos, fecha localizada distinta por locale.
- `i18n-parity.test.ts`: paridad de claves ES↔EN + cobertura enum→clave i18n.

Comando: `npm run test` (vitest). Los unit viven en `src/**/*.test.{ts,tsx}` y están
**separados** de los E2E por script y por config (vitest `include: src/**` no toca `e2e/`).

## Tests E2E (Playwright, 30, todos verdes) — "teoría → realidad"

Verifican los **flujos de usuario contra la app corriendo** (no componentes aislados). Para
QA/devops: mismo espíritu que el humano pidió (que "funcione de verdad", no solo que compile).

### Cómo correr

```bash
cd frontend
npm run test:e2e            # script que invoca devops desde CI
npm run test:e2e:report     # abre el reporte HTML del último run
```

- **Navegador**: Chromium **ya instalado** en el entorno (`/opt/pw-browsers/chromium`).
  `playwright.config.ts` lo apunta con `launchOptions.executablePath` y respeta
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. **No** se corre `playwright install` (sin descargas).
  Sobreescribible con `PLAYWRIGHT_CHROMIUM_PATH`.
- **App bajo prueba**: parametrizada por **`E2E_BASE_URL`** (la app corriendo que levanta devops).
  - Si `E2E_BASE_URL` **está definida** → Playwright **no** levanta server, apunta ahí.
  - Si **no** está definida → Playwright levanta `npm run dev` con **`NEXT_PUBLIC_USE_MOCKS=true`**
    (webServer del config) y prueba en `http://localhost:3000`. Así QA corre los E2E **sin backend**.
- Los asserts usan las **claves i18n reales** de `messages/{es,en}.json` (helper `e2e/utils/i18n.ts`),
  no textos hardcodeados; se prueban **ES y EN** donde aplica. Los datos de catálogo (nombres de
  cartas/sets) se asertan como literales en inglés (por diseño no se traducen).

### Qué cubren (por spec, en `frontend/e2e/`)

- `i18n-locale.spec.ts` — **toggle ES/EN** (AC 32): la UI cambia de idioma, `<html lang>` y el
  prefijo de ruta `/es|/en` se actualizan.
- `auth.spec.ts` — **login/registro** (ES y EN) + toggle de idioma en el shell de auth.
- `catalog.spec.ts` — **catálogo + filtros** (filtra por rareza), **ficha** (valor de mercado vs
  precio de venta, "sin IVA"), carta **"precio pendiente"** no comprable (AC 1, 2, 3, 3b).
- `checkout.spec.ts` — **AmountBreakdown** (subtotal + procesamiento + **IVA 16%** + total),
  mensaje **CFDI por correo**, aviso de titularidad pendiente, pago (simulado) → éxito (AC 4, 30),
  **aviso de ventas finales** (ES y EN) + enlace y página `/terminos` con la política (ES y EN).
- `vault.spec.ts` — **Mi bóveda/portafolio**: titularidad `pending/settled`, valor total, retiro
  solo habilitado para `settled` (AC 5, 6, 8, 10).
- `shipments.spec.ts` — **retiro/envío**: desglose tarifa fija + IVA, rechazo de dirección
  no-MX (`ADDRESS_NOT_MX`), cartas no elegibles (AC 9, 10, 31).
- `buylist.spec.ts` — **cotizador**: EX+ = 40% de la referencia, banner **PAY_AFTER_RECEIPT**,
  **guía de envío seguro** (sleeve/top loader), cola de **precio pendiente** (AC 12, 13, 33, 34).
- `admin.spec.ts` — **panel admin**: dashboard **8 tarjetas**, **enmascarado financiero** para
  `vault_operator`, **M1** (alta sin uploader: aviso de imagen de catálogo + `certNumber` requerido en gradeada),
  **M5** (cherry-pick + nota dinero saliente), **M8** (panel de evidencia por correo, **sin** comparador de
  fotos) (AC 24, 25, 27).

### Qué corre aquí (mocks, sin backend) vs qué necesita backend real

- **Todo el suite corre HOY con `NEXT_PUBLIC_USE_MOCKS=true`** (Chromium local, sin stack). Es el
  modo pensado para que QA lo ejecute sin backend. Los asserts de datos específicos (cartas
  Charizard/Pikachu, totales MXN, portafolio) dependen de los **fixtures** del contrato.
- Contra un **`E2E_BASE_URL` con backend real** los mismos flujos de UI se validan igual, pero:
  - los **datos** deben estar **seeded** de forma equivalente para que los asserts de valores
    concretos coincidan (o se ajustan a datos del backend);
  - las acciones que hoy están **simuladas** en el front pasan a ser **reales**: `POST /auth/*`
    (sesión), **Stripe** en checkout/envío (`/checkout/session`, `/shipments`), **presign+PUT** de
    fotos (`/uploads/presign`) y las **mutaciones de admin** (M1 alta, M3 refund, M5 decisión/convert/
    pay-spei, M8 resolve). Ver "TODO para integración real" abajo.
- **No** hay E2E que dependan de un backend corriendo para poder ejecutarse: el suite es
  **self-contained** en modo mocks. Marcamos arriba qué se vuelve "real" al integrar.

## Supuestos tomados

- Precio de venta = `salePriceCents` del `ListingDTO`; valor de mercado = `referenceValue`
  (`PriceInfo`). PriceTag nunca muestra `$0`: si `status="pending"` y sin salePrice → "Precio
  pendiente" (regla de confianza).
- IVA/fee/gross-up: la UI solo **muestra** el `BreakdownDTO` del backend. Se añadió
  `computeBreakdown` (mock) replicando ARCHITECTURE §5.1 solo para los fixtures; en producción los
  valores vienen del contrato (incluido `ivaRatePct`).
- Fuente única de monto = centavos del contrato; formateo en la capa de presentación.

## M6 · Alta de usuarios (E3) + Historial 360° por pestañas (F3) — v1.7-admin-users

Contrato consumido: `docs/API_CONTRACT.md` §M6 (changelog v1.7-admin-users). Todo en
`frontend/src/app/[locale]/(admin)/admin/m6/M6View.tsx`, `frontend/src/lib/api.ts`,
`frontend/src/types/contract.ts`, `frontend/src/lib/mock/fixtures.ts` y `frontend/messages/{es,en}.json`.

### E3 — Crear usuario (`POST /admin/users`, super_admin)
- Botón **"Crear usuario"** en la barra de filtros, **visible solo para super_admin** vía
  `useRole().isSuperAdmin` (mismo patrón que M3/M5/M8). El backend sigue siendo la autoridad.
- **Modal-formulario**: email, nombre, `<Select>` de rol (`customer|vault_operator|super_admin`) y
  contraseña **opcional**. Contraseña vacía ⇒ el backend autogenera la temporal (patrón reset M-15).
  Aviso de escalada de privilegios al elegir `super_admin`.
- La **temp password** (cuando se autogenera) se muestra **UNA sola vez** reusando el **mismo panel**
  que el reset M-15: extraje el componente `TempPasswordPanel` (aviso "una sola vez" + copiar + nota
  de cambio obligatorio) y lo comparten el modal de reset y el resultado del alta.
- Al crear OK: se **invalida** `['admin-users']` (refresca la lista) y se muestra un modal de éxito
  (con la temp password si vino, o nota de que puede entrar con la password provista).
- Errores mapeados a copy claro: **409 EMAIL_TAKEN**, **422 VALIDATION_ERROR**, **403 FORBIDDEN**.
- API: `createAdminUser(input)` en `lib/api.ts` (rama mock marcada; simula 409 si el email ya existe y
  autogenera la temporal solo si no se envía password). Tipo `AdminCreatedUserDTO` en `types/contract.ts`.

### F3 — Ficha 360°: conteos → pestañas con detalle (servicio al cliente)
- El grid de `SummaryCount` (solo números) se reemplazó por **pestañas** con tablas **paginadas** y
  **lazy-load** (solo se monta la pestaña activa ⇒ la query se dispara al abrir la pestaña). Reusa
  `DataTable`, `QueryState`, `StatusBadge` y el patrón de paginación del proyecto.
- Pestañas y endpoints (todos filtrados por `userId`):
  - **Compras** → `GET /admin/orders?userId=` (`getAdminUserOrders`)
  - **Ventas** → `GET /admin/buylist?userId=` (`getAdminUserBuylist`)
  - **Envíos** → `GET /admin/shipments?userId=` (`getAdminUserShipments`, endpoint **NUEVO**)
  - **Disputas** → `GET /admin/disputes?userId=` (`getAdminUserDisputes`)
  - **Bóveda** → usa el resumen `ownedItems` que ya trae `GET /admin/users/:id` (no hay endpoint admin
    de holdings por usuario en el contrato). Ver solicitud al arquitecto abajo.
  - **Actividad** → `GET /admin/users/:id/audit?scope=target` (`getAdminUserAudit`, endpoint **NUEVO**):
    muestra `action` / `actorRole` / `fecha`; la columna **`ip` solo se pinta si el backend la envía**
    (proyección super_admin). Para `vault_operator` no viene y la columna se **omite** (respeto estricto
    de la proyección por rol; **nunca** se muestran `before`/`after`). Tipo `UserAuditEntryDTO` añadido.
- Se **mantienen intactos** el reset-password y el delete de M-15 (solo se extrajo el panel de temp
  password para reuso; la lógica y las llaves i18n no cambian).

### i18n
- Paridad ES/EN de todas las llaves nuevas bajo `admin.m6` (`create.*`, `tabs.*`, `disputeType.*`,
  `historyEmpty`, y ampliación de `table.*`). El test `src/lib/i18n-parity.test.ts` sigue verde.

### Tests añadidos (`M6View.test.tsx`)
- Crear usuario: super_admin ve el botón, autogenera y ve la temporal **una sola vez**; y **409
  EMAIL_TAKEN** con mensaje claro.
- Pestañas: **Compras** llama a `getAdminUserOrders` con el `userId` al abrir la ficha; **Envíos**
  (endpoint nuevo) llama a `getAdminUserShipments` con el `userId` al abrir la pestaña; **Actividad**
  pinta el `ip` cuando el backend lo envía. (Se mockea `useRole` a super_admin para el flujo de alta.)

### Gates (frontend/)
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` ✓ (163 tests, incl. paridad i18n) ·
`npm run build` ✓.

## Fricciones / solicitudes al arquitecto (no bloquean; NO edité el contrato)

0. **Bóveda en la ficha 360° (M6/F3) — falta `finish` + valor en la proyección**: la pestaña Bóveda
   debería mostrar "carta + acabado + valor", pero `AdminUserOwnedItemRef` (proyección de
   `GET /admin/users/:id.ownedItems`) solo trae `{ inventoryItemId, folio, card, ownershipStatus }`.
   Respetando "no mostrar campos que el backend no envía", hoy la pestaña muestra folio + carta +
   titularidad. **Solicito** enriquecer `ownedItems` con `finish` + `referenceValue` (o un
   `GET /admin/users/:id/holdings` paginado con el shape de `HoldingDTO`) para poder mostrar acabado y
   valor sin romper la proyección PII por rol.
1. **`NEXT_PUBLIC_USE_MOCKS`**: var nueva del frontend para alternar mocks/real. Solicito a devops
   añadirla al `.env.example`. No afecta al contrato.
2. **`capturedDate` en todos los `ListingDTO`**: el diseño muestra la fecha del precio en catálogo y
   bóveda. Confirmar que `PriceInfo.capturedDate` viene poblado en listados (no solo en detalle)
   —igual que anotó ux-ui en DESIGN_SYSTEM §13.1—. La UI lo maneja como opcional si falta.
2. **Fee de procesamiento (tooltip)**: se muestra copy genérico "cubre el procesamiento del pago"
   (DESIGN_SYSTEM §13.2). Sin cambio de contrato.
3. **Presign de fotos**: `PhotoUploader` está listo para `POST /uploads/presign` + `PUT` directo;
   hoy la subida es simulada. Cableado real cuando el backend exponga el bucket (S3/MinIO).

## TODO para integración real (cuando el backend corra)

- Poner `NEXT_PUBLIC_USE_MOCKS=false`; validar shapes 1:1 con el backend.
- **Auth real**: `POST /auth/login|register|refresh`, refresh token, `GET /users/me`, guardado de
  `locale` en `PATCH /users/me`. Hoy la sesión es un token mock en localStorage.
- **Stripe**: montar `@stripe/stripe-js` + Elements con el `clientSecret` de
  `POST /checkout/session` y `POST /shipments`. Hoy el botón de pago simula el flujo.
- **PhotoUploader**: presign PUT real (`/uploads/presign`).
- Cablear mutaciones de admin (M1 alta, M3 refund, M5 decisiones/convert/pay-spei, M8 resolve) a
  sus endpoints `/admin/*`.
- **Self-host de Inter** vía `next/font` (hoy fallback de sistema para evitar dependencia de red en
  build; los tokens tipográficos ya están listos).

---

## M1 · Gestión de inventario (Ola 2, 2026-08-17)

Ola 2 del back-office M1: el operador pasa de "solo alta" a **gestión completa** del inventario.
Todo contra endpoints **verificados** en `docs/API_CONTRACT.md §M1` **y** en
`backend/src/modules/inventory/inventory.controller.ts` (ningún path inventado).

### Endpoints cableados (todos existentes en backend)

| Acción UI | Endpoint | Función `lib/api.ts` |
|---|---|---|
| Tabla con filtros + paginación | `GET /admin/inventory/items?q=&status=&zone=&locationId=&page=&pageSize=` | `getAdminInventory(filters)` (antes iba SIN query → capada a 20 sin filtros) |
| Detalle + historial de movimientos | `GET /admin/inventory/items/:id` | `getAdminInventoryItem(id)` |
| Publicar / retirar de venta + precio manual | `PATCH /admin/inventory/items/:id` (`{ status: 'listed'\|'in_stock', listPriceCents? }`) | `updateInventoryItem(id, input)` |
| Mover de ubicación | `POST /admin/inventory/items/:id/move` (`{ toLocationId, note? }`) | `moveInventoryItem(id, input)` |
| Marcar perdida/dañada | `POST /admin/inventory/items/:id/mark` (`{ mark, note }` — nota OBLIGATORIA) | `markInventoryItem(id, input)` |
| Listar/crear ubicaciones | `GET/POST /admin/locations` (`{ zone, box, row, slot }`) | `getLocations()` / `createLocation(input)` |

> **Nota de path:** las ubicaciones viven en **`/admin/locations`** (contrato §M1 línea "Ubicaciones" +
> `@Controller('admin')` + `@Get('locations')`), NO en `/admin/inventory/locations`.

### Decisiones de implementación

- **Componentes nuevos** (en `frontend/src/app/[locale]/(admin)/admin/m1/`):
  - `ItemDetailModal.tsx` — detalle por pieza: folio + acabado (FinishBadge) + estado (StatusBadge) +
    ubicación + cert (graded) + referencia + precio de venta + **historial de movimientos** (motivo
    traducido `admin.m1.movementReason.*`, transición de ubicación/estado, nota, fecha). Acciones:
    **Publicar/Retirar** (solo `in_stock`/`listed`), **Mover** (excluye la ubicación actual) y
    **Marcar pérdida/daño** (nota obligatoria; botón destructive + Banner de advertencia). Cada acción:
    Banner de confirmación + error REAL del contrato (`useErrorMessage`) + invalidación de
    `['admin-inventory']` y `['admin-inventory-item', id]`.
  - `LocationsModal.tsx` — gestor mínimo de ubicaciones (lista + alta caja/fila/slot + zona). Sin esto,
    el dropdown de ubicación del alta quedaba vacío en una BD limpia. Crear invalida `['locations']`.
- **Precio de publicación:** el operador captura PESOS y se convierte con `Math.round(Number(x) * 100)`.
  Es **precio de venta MANUAL** (override del contrato PATCH §M1), NO una derivación en cliente —
  **SEC-A1 intacto** (la derivación referencia×markup la hace el backend cuando no hay override).
  El **sellado** exige precio manual para publicar (botón bloqueado sin `listPriceCents` previo ni
  capturado); raw/graded pueden publicar sin precio manual (el server deriva de la referencia). La
  invariante "gradeada publicada exige `certNumber`" la valida el backend en el PATCH (la rama mock la
  replica para la demo).
- **Filtros/paginación de la tabla:** estado (enum `InventoryStatus` completo, labels del catálogo global
  `status.inventory`), zona (`platform_stock`/`customer_custody`), ubicación y búsqueda por folio
  (`q` → `folio contains`, case-insensitive, como en el service). Cambiar un filtro reinicia a página 1.
  `queryKey: ['admin-inventory', filters]` — la invalidación por prefijo `['admin-inventory']` sigue
  cubriendo todas las páginas/filtros.
- **Tipos nuevos** (`types/contract.ts`): `MovementReason`, `InventoryMovementDTO`,
  `AdminInventoryItemDetailDTO extends InventoryItemDTO { movements }` (shape del `getItem` del backend:
  include card+location+movements desc).
- **Mocks:** `fixtures.ts` gana `mockInventoryMovements` + `pushMockMovement()`; las ramas mock de
  move/mark/patch mutan `mockInventory` en memoria (misma filosofía que M5).

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)

Claves nuevas bajo `admin.m1`: `view`, `filtersFolio`, `filtersFolioPlaceholder`, `filtersZone`,
`pageInfo`, `prev`, `next`, `emptyTitle`, `emptyBody`, `zone.*` (2), `detail.*` (4), `publish.*` (10),
`move.*` (7), `mark.*` (9), `movementReason.*` (9), `locations.*` (11). Los estados de inventario
reusan el catálogo global `status.inventory.*` (sin duplicar).

### Deudas techlead Ola 1 (dueño frontend) — las 3 RESUELTAS

1. `paginate<T>` único en la cabecera de `api.ts`, reusado por `getAdminShipments` / `getAdminUsers` /
   `searchBuylistCards` / `getAuditLog` (y las nuevas ramas mock de M1). Bonus: `getAdminShipments`
   ahora sí pagina en mock (antes ignoraba `page/pageSize`).
2. `mockJobId()` / `mockTempPassword()` extraídos (5 sitios inline eliminados).
3. Interfaz vacía `AdminBuylistItemDTO` eliminada de `types/contract.ts` (cero consumidores).

Registradas como **TL-FE-1/2/3 (RESUELTAS)** en `docs/TECH_DEBT.md`.

### Tests añadidos

- `M1View.test.tsx` (12 tests): filtros reales (`status` + reinicio a página 1), paginación (`page=2`),
  detalle (folio + cert + movimientos), publicar (pesos→centavos `1234.56 → 123456` + PATCH
  `status=listed` + Banner de éxito), error real del PATCH (422), mark exige nota (botón deshabilitado),
  crear ubicación (payload `{ zone, box, row, slot }` + Banner con label).
- `api.test.ts` (+6): filtros/paginación mock de `getAdminInventory`, detalle con movimientos,
  publicar + invariante cert de gradeada, move/mark registran movimiento, `createLocation` deriva label.

### Gates (frontend/)

`npm run lint` ✓ · `tsc --noEmit` ✓ · `npx vitest run` ✓ (**35 archivos / 202 tests**, incl. paridad
i18n) · `npm run build` ✓.

## Buylist · Rediseño "menos clics" del flujo de venta/cotización (2026-08-17)

Rediseño del cotizador público + carrito de venta (`BuylistView.tsx`) y del paso de pago
(`BuylistKycForm.tsx`). **Solo frontend**: endpoints EXISTENTES del contrato §6, sin cambio de
backend ni de contrato. SEC-A1 intacto (el front solo MUESTRA estimados; el backend re-deriva
todos los montos).

### Qué cambió (recorrido del cliente)

| Antes | Después |
|---|---|
| Elegir carta → clic "Cotizar" → clic "Agregar" (3 clics/carta tras la búsqueda) | Elegir carta → **auto-cotiza** → clic "Agregar" (2 clics; cambiar acabado también re-cotiza solo) |
| Cotizar N cartas = 3N clics | **Bulk**: N checkboxes + 1 clic "Agregar seleccionadas (N)" |
| Cantidad solo con −/+ de 1 en 1 | **Input numérico** por línea (además de −/+) |
| Grid de resultados sin precio | Cada resultado muestra su **estimado de compra** (raw NM, acabado default) |
| Línea/total pendiente = "—" o MX$0.00 | **"Precio pendiente"** explícito + nota que explica el total (carrito, modal y "Mis solicitudes") |
| Modal final sin contexto | **Resumen de la venta** (cartas × cantidad × acabado + total + vigencia) antes de "Confirmar y enviar" |
| Tipos `raw/graded/sealed` crudos | Etiquetas traducidas: **"Suelta (raw)" / "Gradeada" / "Sellado"** |

### Decisiones técnicas

- **Auto-cotización con `useQuery` (no mutation)**: `POST /buylist/quote` es read-only en el
  contrato (v1.12), así que se modela como query con key `['buylist-quote', cardId, productType,
  finish]` y `staleTime` 5 min. La MISMA key la comparten la cotización principal, el precio del
  grid (`ResultQuote`) y el bulk (`fetchQuery`): cotizar en un sitio cachea para los demás.
- **Precio en el grid = 1 quote unitario por resultado visible** (página ≤ ~20), cacheado.
  UX elegida sobre "on-expand" porque convierte el buscador en buylist navegable (objetivo ALTO).
  Marcado `Fase 3b: reemplazar por batch quote` — cuando el arquitecto/backend expongan cotización
  en lote, `ResultQuote` y `addSelectedToCart` cambian a un solo POST.
- **Bulk** cotiza con productType `raw` + NM + primer acabado disponible (la buylist compra raw);
  el acabado/tipo se afina por carta re-cotizando en el panel. Dedup del carrito intacto
  (cardId + productType + finish).
- **Resultados del grid**: se quitó el patrón `listbox/option` (inválido con el checkbox de
  multi-selección dentro) → lista plana con botón `aria-pressed` + checkbox con
  `aria-label="Seleccionar {carta}"`. Anillo de foco `shadow-focus` respetado (DESIGN §8.2);
  el input numérico de cantidad usa `focus-visible:shadow-focus`.
- **"Usar mi CLABE ****1234" (BuylistKycForm)**: implementado como modo por defecto cuando
  `clabeMasked` existe, con "Usar otra CLABE" para capturar una distinta. **LIMITACIÓN DE
  CONTRATO**: `POST /buylist/requests` exige `clabe` en claro (18 dígitos) y la valida por
  blind-index contra la de KYC; el cliente NUNCA tiene la CLABE en claro (solo `clabeMasked`).
  Por eso el atajo está **acotado a modo mock** (`config.useMocks`) y marcado
  `// MOCK: pendiente de contrato`. **Solicitud al arquitecto** (registrada abajo): `clabe?`
  opcional en `POST /buylist/requests` con fallback server-side a la CLABE de KYC (mismo fallback
  que ya implementa `reveal-clabe`). Con ese cambio, quitar el gate `useMocks` habilita el atajo
  en producción sin tocar nada más.
- **Copy de confianza (EDITABLE)**: `buylist.trustShipping` (el vendedor paga el envío de ida y
  la devolución de rechazos no-NM — respaldado por PROJECT §H), `buylist.trustPayment`
  (**placeholder "2–3 días hábiles"** para verificación+pago SPEI — SIN dato oficial, editar
  cuando el negocio lo confirme) y `buylist.trustValidity` (vigencia del estimado; espeja SEC-A1:
  el monto final se confirma al verificar). `trustValidity` se reusa como aviso de vigencia en el
  resumen del modal.
- `onCreated` del modal ahora invalida también `['kyc']` (la solicitud puede registrar la CLABE
  → el checklist de requisitos se refresca).

### i18n (paridad ES/EN verificada por `i18n-parity.test.ts`)

Claves nuevas bajo `buylist`: `gridEstimateLegend`, `bulkSelect`, `bulkAddCta`, `bulkClear`,
`bulkAdded`, `bulkAddError`, `productType.{raw,graded,sealed}`, `quantityFor`, `totalPendingNote`,
`requestPendingNote`, `summaryTitle`, `trustShipping`, `trustPayment`, `trustValidity`,
`clabeSectionTitle`, `clabeStoredSelected`, `clabeUseStored`, `clabeUseAnother`.
Eliminadas (sin consumidores): `getQuote` (ya no hay botón), `quantity` (reemplazada por
`quantityFor`). Ajustada: `chooseCardFirst` (explica la auto-cotización).

### Preservado (no romper)

Cotizador público sin login; gating P-11 (`useSellRequirements` + `SellRequirementsPanel`, tests
intactos y verdes); transparencia de la regla ("40% de referencia" / "$X fijo"); dedup del
carrito; keep-alive de sesión; anillo de foco `shadow-focus`.

### Tests y gates

- `BuylistView.test.tsx`: 31 tests (antes 20) — auto-quote (sin botón "Cotizar"), estimado en el
  grid, bulk (multi-selección + loop del quote unitario + limpiar), input numérico de cantidad,
  pendiente honesto (carrito y "Mis solicitudes"), resumen del modal, tipos traducidos, y TODOS
  los de gating P-11 actualizados al flujo nuevo.
- `BuylistKycForm.test.tsx`: 11 tests — + modo "usar mi CLABE" (toggle y envío con
  `useClabeOnFile` sin reteclear, mock) y el resto intactos.
- `e2e/buylist.spec.ts` (Playwright, la corre QA): actualizado al flujo sin botón "Cotizar";
  + grid con estimado, + bulk, + resumen del modal; los tests de envío ahora SIEMBRAN sesión de
  cliente verificada (`tcg.user` en localStorage, modo mock) porque el gating P-11 sustituye el
  CTA de enviar por login/registro sin sesión (la spec anterior era pre-gating y ya no reflejaba
  la UI).
- Gates (frontend/): `npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npx vitest run` ✓
  (**35 archivos / 231 tests**) · `npm run build` ✓.

### Solicitudes al arquitecto (pendientes de contrato)

1. **Batch quote (Fase 3b)**: endpoint de cotización en lote (p. ej.
   `POST /buylist/quote-batch { items: [{cardId, finish?}] }`) para el precio del grid y el bulk;
   hoy es loop del unitario (marcado en código).
2. **CLABE en archivo**: `clabe?` opcional en `POST /buylist/requests` cuando el usuario tiene
   CLABE en KYC (fallback server-side, mismo patrón que `reveal-clabe`), para habilitar "Usar mi
   CLABE ****1234" contra el backend real.

---

## M2 · Editor de precio de VENTA por rareza (Fase 2, v1.13-sales-pricing)

Sección nueva en `admin/m2/M2View.tsx` ("Sección 5"), clon análogo del editor de buylist por
rareza (Sección 4), pero para el precio de **VENTA**. Consume los endpoints nuevos del backend
(commit `fba6486`, contrato §M2 v1.13-sales-pricing):

- `GET /admin/pricing/sales-rarities` → `getSalesRarities()` (mismo shape que buylist-rarities).
- `GET /admin/pricing/sales-rules` → `getSalesRules()`.
- `PUT /admin/pricing/sales-rules` → `updateSalesRules({ rules, fallbackPct })`.

### Diferencia clave de copy vs. buylist (semántica de `pct`)

El `pct` de VENTA es **markup ARRIBA de mercado** (no "% de la referencia" como en buylist):
`salePrice = mercado × (1 + %)`. El editor lo rotula explícitamente: fallback = "Fallback (%
sobre mercado)", modo pct = "% sobre mercado", más un hint con la fórmula. El `fixed` se rotula
como **piso** en MX$ ("Piso (MX$)"). El validador de venta admite pct hasta 1000 (no topa en 100
como buylist); el front no fuerza tope, deja pasar el valor y el backend valida `[0,1000]`.

### Tipos / API / mocks

- `contract.ts`: `SalesRuleMode`, `SalesRule`, `SalesRuleApplied`, `SalesRulesDTO`,
  `SalesRarityRowDTO`, `SalesRaritiesResponse` (clones de los `Buylist*`).
- `api.ts`: `getSalesRarities`, `getSalesRules`, `updateSalesRules` con rama `config.useMocks`.
- `fixtures.ts`: `mockSalesRules` (seed: Common $5 fijo, Uncommon $10 fijo, Reverse Holo $10
  fijo), `mockSalesFallbackPct=15`, `setMockSalesRules`, `resolveSalesRule`, `mockSalesRarities`.

### i18n (paridad ES/EN)

Claves nuevas bajo `admin.m2.salesRules`: `title`, `subtitle`, `fallbackLabel`, `fallbackHint`,
`rarity`, `cardCount`, `mode`, `value`, `source`, `valueMxn`, `valuePct`, `modeFor`, `valueFor`,
`modeLabel.{fixed,pct}`, `sourceLabel.{rule,fallback}`, `pctHint`, `saved`.

### Tests

`M2View.test.tsx`: +3 tests de la sección de venta (render + hint de markup, editar fijo Common →
`updateSalesRules` en centavos, editar fallback pct>100 sin tope). Los tests de buylist y venta se
acotan a su `<section>` (helper `sectionFor`) porque ambos editores comparten aria-labels
("Guardar", "Modo/Valor para {rarity}"); refactor sin cambiar comportamiento. Suite: 234 tests.

### Preservado

Anillo de foco `shadow-focus`; secciones de sync de catálogo (barra de progreso/keep-alive),
buylist rules, FX y pending sin tocar.

### Nota para el arquitecto

`salesMarkupPct` (dial M10, `SettingsDTO`) queda **DEPRECADO** por el contrato (palanca de
rollback). El front no lo consume en M2; sigue en `SettingsDTO` por compatibilidad hasta su
retiro (decisión abierta v1.13-3). Sin solicitudes de contrato: los tres endpoints ya existen.

---

## WS-G · E2E smoke agnósticos de mocks (comprar / retirar / vender contra backend REAL)

**Problema.** Los smoke de flujos de dinero eran verdes SIEMPRE en modo mock: autenticaban
inyectando `tcg.user` en localStorage (sin token real), asertaban montos exactos de fixture
(`MX$19,400.00`, `MX$3,380.00`), esperaban un stub de pago viejo (`checkout.paidTitle`) y
hardcodeaban cartas (`Charizard`, `c-charizard`). Tras WS-F (comprar/retirar reales con Stripe)
esos 4 tests quedaron ROTOS incluso en mock, pero "QA verde" los ocultó. Ahora los smoke corren,
env-agnósticos, contra el backend real.

### Helper `frontend/e2e/utils/auth.ts`
- `loginAs(page, 'customer'|'admin'|'operator')` env-aware:
  - **Real** (`E2E_REAL=1`): `POST {API}/auth/login` con `page.request` y persiste el `TokenPair`
    + `user` en localStorage con el MISMO shape que `persistSession` (`src/lib/api.ts`):
    `tcg.accessToken`, `tcg.refreshToken`, `tcg.user` (y `tcg.role` para staff), vía `addInitScript`
    (aplica antes de la primera carga → llamar SIEMPRE antes de `page.goto`).
  - **Mock**: inyecta solo `tcg.user` (las ramas mock de `api.ts` ignoran el token).
- Credenciales del seed determinista viven SOLO aquí (sobreescribibles por env):
  `customer@e2e.local`/`Customer123!`, `admin@e2e.local`/`Admin123!`, `operator@e2e.local`/`Operator123!`.
- `IS_REAL` (`E2E_REAL==='1'`) y `MONEY_RE` (`/MX\$[\d,]+\.\d{2}/`, aserción por FORMATO) exportados.
- API real por defecto en `http://localhost:3011/api/v1` (puerto del backend en `docker-compose.staging.yml`);
  override con `E2E_API_BASE_URL`.

### Tag `@real` + `playwright.config.ts`
- Los smoke de dinero llevan `@real`. Cuando `E2E_REAL=1`, el config filtra `grep: /@real/`
  globalmente → en real corre SOLO el subset (comprar/retirar/vender/bóveda). En mock (sin
  `E2E_REAL`) NO se filtra: corre TODA la suite y los `@real` también pasan por su rama mock.
- 4 tests `@real`: `checkout.spec.ts` (comprar), `shipments.spec.ts` (retirar),
  `buylist.spec.ts` (vender), `vault.spec.ts` (portafolio/custodia).

### Env-agnosticismo de los specs
- **Descubre datos, no hardcodea**: catálogo → primera carta con "Agregar"; bóveda/retiro →
  primer checkbox settled; buylist → primer set del dropdown → primera carta del grid
  (`pickFirstSellableCard`).
- **Aserciones de estructura**: `getByTestId('amount-breakdown')`, total con `MONEY_RE`,
  `checkout.shipping`/`checkout.iva`. Cero montos de fixture.
- **Pago (comprar/retirar)**: tras "Pagar"/"Solicitar retiro" el modal SOLO abre si la sesión
  real (`POST /checkout/session` / `POST /shipments`) se creó. En real se asierta que el modal
  monta Stripe `<Elements>` (el cuerpo simulado `payment.mockBody` está ausente); NO se depende de
  una pantalla de "pagado" (el asentamiento es por webhook). En mock se conserva el camino simulado.
- **Vender**: crea la solicitud (`POST /buylist/requests`). Maneja ambos modos de CLABE
  (atajo "usar mi CLABE en archivo" si el seed la trae, o captura de CLABE válida si no) y espera
  `buylist.created`. Viewport alto (2000px) porque el `Modal` no scrollea internamente y el CTA
  quedaría fuera de pantalla (ver deuda menor abajo).

### Cómo correr contra local-staging (lo que el humano SÍ puede)
```
# 1) Levantar el stack real y sembrar (una vez):
docker compose -f docker-compose.staging.yml --profile apps up -d --build
docker compose -f docker-compose.staging.yml exec -T backend npm run seed:synthetic

# 2) Correr el subset @real contra el frontend real:
cd frontend
E2E_BASE_URL=http://localhost:3010 E2E_REAL=1 npm run test:e2e -- --grep @real
```
(El `--grep @real` es redundante con el grep del config cuando `E2E_REAL=1`, pero explícito como
pide el runbook. Usa el Chromium preinstalado `/opt/pw-browsers`; NO `playwright install`.)

### Verificado aquí (sin stack real)
- `npx tsc --noEmit` limpio.
- `npx playwright test --list` enumera los 4 `@real`; con `E2E_REAL=1` el grep deja SOLO esos 4.
- Modo mock verde: `checkout/vault/shipments/buylist` = **20/20**; resto de la suite sin regresión.

### Pendiente de validar contra el stack real (no ejecutable aquí)
- Que `loginAs` real reciba `{accessToken, refreshToken, user}` del seed y el Bearer pase los guards.
- Que exista ≥1 listing vendible en Compra (para comprar) — el seed debería traerlo.
- Que el modal de Stripe monte `<Elements>` con el `clientSecret` real (en CI la publishable key es
  dummy `pk_test_e2e_dummy`; por eso NO se asierta el iframe de Stripe, solo la ausencia del cuerpo
  mock, que ya confirma que la sesión real se creó).
- Que el cliente del seed traiga CLABE/INE en archivo para que "vender" no tope con
  `CLABE_NOT_OWN_NAME` (el spec cae al modo captura si no; según lo confirmado, el seed los trae).

### Solicitudes a otros roles (sin cambio de contrato)
- **devops**: `e2e-real.yml` hoy corre `npm run test:e2e -- checkout.spec.ts shipments.spec.ts
  buylist.spec.ts` **sin** `E2E_REAL=1`. Para que "verde de verdad" signifique real, añadir
  `E2E_REAL: '1'` al `env` del job (basta eso: el config auto-filtra `@real` dentro de esos files).
  Opcional: incluir `vault.spec.ts` en `SMOKE_SPECS`. Sin esto, el job seguiría corriendo la rama
  mock de los `@real` y los tests mock-only fallarían contra el stack real.

### Deuda técnica menor (frontend, no bloqueante)
- `components/ui/Modal.tsx` no tiene `max-height`+scroll interno: en formularios altos (KYC de
  buylist) el CTA "Confirmar y enviar" queda fuera del viewport. El spec lo sortea subiendo el
  viewport a 2000px, pero es una fricción real de usabilidad. Anotar en `TECH_DEBT.md` a petición
  de techlead.

---

## Rediseño del cotizador: grid protagonista (2026-08-17, stream «Catálogo y precios»)

Rediseño integral de `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` en una sola
pasada. Cambios de UX y sus decisiones:

### Layout
- **El grid de resultados manda:** ocupa el ancho/alto disponible con **scroll natural de página**
  (se eliminó la caja `max-h-96 overflow-y-auto`). Retícula responsiva 2→3→4→5→6 columnas.
- **Barra de filtros** encima del grid: set + buscador + **tipo de producto** (el select de tipo se
  movió aquí desde el desaparecido "Paso 2" para no perder la capacidad de cotizar graded/sealed).
- **Carrito de venta como columna lateral colapsable** (`lg:sticky`, 360px): toggle
  "Ocultar/Mostrar carrito (N)" en la barra (`aria-expanded`). Colapsado, el grid usa todo el ancho.
- La política **NM-only** y el copy de confianza (envío/pago SPEI/vigencia) viven en una sección
  propia bajo el grid; **PAY_AFTER_RECEIPT** quedó en la cabecera, visible desde el load.

### Cotización directa (sin panel «COTIZACIÓN»)
- Se eliminó el panel de cotización, el botón "Agregar al carrito" intermedio y el **campo falso
  «Condición: Near Mint (NM) fija»** (el aviso NM-only existente cubre esa información).
- **Cada carta del grid lista sus acabados** (`availableFinishes`, orden `FINISH_ORDER`) como filas
  agregables: una fila = un acabado con **su propio estimado server-side**; el clic **agrega directo
  al carrito** (dedup por `cardId+productType+finish`, misma línea suma cantidad). En tipo
  graded/sealed hay una sola fila por carta (cotizan en `normal`, contrato §I).
- **Transparencia por línea:** cada línea del carrito tiene un **detalle expandible** (rareza,
  acabado, valor de referencia, regla aplicada y la nota de «precio pendiente» cuando aplica) — la
  misma información que daba el panel.

### Límites del batch (decisión no obvia)
- El grid cotiza **por acabado** en `POST /buylist/quote/batch` (cap **50 ítems/llamada**, throttle
  **12/min**). Una página (pageSize 20) × hasta 4 acabados puede llegar a 80 ítems → el queryFn
  **trocea en llamadas de ≤50** (`BUYLIST_QUOTE_BATCH_MAX` de `@/lib/api`): típico 1 llamada, peor
  caso 2 por búsqueda; react-query cachea 5 min por (búsqueda × tipo). Se eligió cotizar TODOS los
  acabados de la página (en vez de lazy al expandir) porque el peor caso cabe holgado en el throttle
  y da estimados visibles sin interacción extra.
- **El bulk ya no llama a la red:** «Agregar seleccionadas (N)» reusa las cotizaciones del batch del
  grid (acabado por defecto por carta), tolerante por-ítem (`ok:false` → aviso parcial). El CTA se
  deshabilita mientras el batch carga.
- SEC-A1 intacto: los montos vienen SIEMPRE del server (batch); la UI no calcula ni manda precios.

### «Mis solicitudes» sin sesión
- El query `getSellRequests` se **gatea por sesión** (`useSellRequirements.ready && isAuthenticated`):
  sin sesión no hay request y la sección muestra una **invitación neutra** a iniciar sesión
  (`buylist.requestsLoginInvite`) — nunca un estado de error.

### i18n (paridad ES/EN mantenida)
- Nuevas claves `buylist.*`: `searchHint`, `gridQuotesFailed`, `addFinishAria`, `addedLine`,
  `cartShow`, `cartHide`, `lineDetailShow`, `lineDetailHide`, `requestsLoginInvite`; rewording de
  `gridEstimateLegend` y `cartEmpty`.
- Claves retiradas (sin consumidores): `quoterTitle`, `selectCard`, `selectCondition`,
  `selectFinish`, `quoting`, `quoteResult`, `category`, `categoryLabel`, `quotedPrice`,
  `createRequest`, `conditionFixedNm`, `selectedCard`, `chooseCardFirst`, `addToCart`,
  `addedToCart`.

### Tests
- `BuylistView.test.tsx` reescrito al nuevo flujo (42 tests): grid por acabado, add directo,
  detalle expandible, colapso del carrito, bulk sin requests extra + parcial por-ítem, dedup por
  acabado, «Mis solicitudes» sin sesión (endpoint NO consultado, sin `role=alert`), gating P-11 y
  v1.15 CLABE/INE intactos.
- `e2e/buylist.spec.ts` actualizado (11 tests, `--list` verificado): helpers `searchFor`/`addCard`
  clican la fila de acabado por su `aria-label` (`buylist.addFinishAria`); el smoke `@real` agrega
  la primera carta descubierta (Playwright auto-espera a que la fila se habilite con el estimado).
- Flujos preservados: modal con `BuylistKycForm` (CLABE + INE, gating P-11), respuesta a ajuste F5.


## 2026-08-17 · Feedback del CTA «Comprar» en la ficha de carta (carrito local)

### Problema
El botón «Comprar» de la ficha (`catalog/[cardId]/CardDetailView.tsx`) agregaba al carrito local
(`useCart`, pieza única deduplicada en localStorage) sin ningún feedback: parecía un botón muerto.

### Decisión (dónde vive el CTA)
- **`InstanceCta` (componente local en `CardDetailView.tsx`):** CTA por ejemplar con tres estados —
  «Comprar» (primary) → «✓ En el carrito» (secondary + check lucide `aria-hidden`; el texto porta el
  estado, §7.4) → «No disponible» (disabled). El segundo clic **no re-agrega** (el carrito es pieza
  única): navega a `/checkout` (misma ruta que el badge del `StorefrontHeader`) vía
  `useRouter` de `@/i18n/navigation`. Vive en la vista y NO en `ListingCard` porque
  `frontend/src/components/` es zona compartida de otro stream y las props actuales de `ListingCard`
  (`{ listing, onAdd }`) no expresan el estado «en carrito».
- **`catalog/CartAddedToast.tsx` (local al módulo de catálogo):** toast efímero (5 s, esquina,
  DESIGN_SYSTEM §7.5) en bloque de tinta con texto mono en versalitas y enlace «Ver carrito» →
  `/checkout`. La región `role="status"`/`aria-live="polite"` está siempre montada para que el
  lector anuncie el cambio. No se construyó infra global de toasts (no existe y las zonas
  compartidas están vetadas a este stream); si otro módulo lo necesita, promoverlo a
  `src/components/` pasa por el stream dueño.
- **Hidratación SSR:** sin `mounted` extra — `useCart` ya inicia `ids=[]` y puebla desde
  localStorage en `useEffect` (post-hidratación), así que el estado «en el carrito» solo se pinta
  tras montar (sin mismatch).
- **`CatalogView` (vitrina):** mismo toast al agregar. El **botón** del card sigue diciendo
  «Agregar» porque vive en `ListingCard` (zona compartida): queda como solicitud (abajo).

### i18n (paridad ES/EN)
Claves nuevas `catalog.inCart` («En el carrito»/«In cart»), `catalog.addedToCart`
(«Agregado al carrito»/«Added to cart»), `catalog.viewCart` («Ver carrito»/«View cart»).

### Tests
- `CardDetailView.test.tsx` (4): agregar → CTA por pieza + toast + persistencia; segundo clic →
  `push('/checkout')` sin re-agregar; pieza ya en carrito al montar → estado inicial correcto (y
  toast vacío); ejemplar no vendible sigue deshabilitado.
- `CatalogView.test.tsx` (1): toast con enlace al carrito al agregar desde la vitrina.
- `e2e/catalog.spec.ts`: +2 tests en «Compra · ficha de carta» (feedback y estado tras recarga).

### Solicitud pendiente (otro stream / arquitecto de streams)
`ListingCard` necesitaría una prop tipo `inCart?: boolean` (+ label alterno del CTA) para que la
vitrina muestre también el estado «En el carrito» en el botón del card; hoy solo la ficha lo hace.


## 2026-08-17 · M5 admin: rechazos de buylist (contrato v1.18-buylist-rejects)

### Qué cambió (`(admin)/admin/m5/M5View.tsx`)
- **Pestaña «Rechazadas» (transversal):** consume `GET /admin/buylist/rejected-items` (query
  propia, `enabled` solo con la pestaña abierta; paginación simple server-side con
  `page/pageSize/total`). Muestra carta (nombre/set/acabado), vendedor legible, motivo,
  `rejectedAt` y los DOS plazos del server: devolución hasta `returnDeadlineAt` (7 días, a costo
  del vendedor) y abandono en `abandonDeadlineAt` (30 días). La **fase** (en plazo de devolución /
  en ventana de abandono / vencido) se deriva en el front de `now` vs esas fechas (helper local
  `rejectPhase`), como manda el contrato — las fechas mismas SIEMPRE vienen del server.
  **Sin acción «Convertir a inventario»** en esta pestaña (PROJECT criterio 16 / §M5: una
  rechazada no-NM jamás es convertible, ni vencidos los plazos); en el detalle de solicitud el
  botón también se oculta para ítems `rechazada` (antes salía deshabilitado).
- **Rechazo con motivo:** «Rechazar» abre un mini-diálogo con motivo obligatorio (3–500,
  validación en cliente que espeja el 400 del backend; el error real del server se muestra dentro
  del diálogo) y aviso de que el vendedor recibirá correo con motivo y plazos. Envía
  `{ decision: 'reject', reason }`.
- **Dinero (SEC-A1):** la cabecera muestra `quotedTotalCents` y, cuando llega,
  `approvedTotalCents` — ambos TAL CUAL del server (que ya excluye rechazadas); la UI no suma
  nada. En el detalle, el ítem rechazado sale con la cotización tachada + badge «Fuera del
  total · no se paga» + motivo/fecha/plazos.
- **Vendedor legible:** `seller.name · seller.email` como identidad primaria (v1.18); el UUID
  queda en `title` (tooltip) y se conserva el enlace a la ficha 360° M6 (`?user=<id>`). El
  buscador ahora también matchea nombre/correo del vendedor. Fallback al `userId` si el DTO no
  trae `seller`.
- **Orden y fecha:** el listado se muestra tal cual llega (el server ordena `createdAt` desc,
  NORMA v1.18 — sin re-ordenar en cliente) y cada solicitud muestra su fecha de creación con
  `formatDate` (mismo formato que el resto del admin).

### API client (zona compartida, cambio serializado autorizado — SOLO aditivo)
- `src/lib/api.ts`: `getAdminRejectedBuylistItems({page,pageSize,userId})` (real + rama mock que
  deriva de fixtures y espeja orden `rejectedAt` desc / plazos 7d/30d); `decideBuylistItem` acepta
  `reason` y en mock valida 3–500 (400 `VALIDATION_ERROR`) y fija `rejectedAt`/plazos/anula
  `approvedPriceCents`; sellers mock locales (`MOCK_SELLERS`) para enriquecer fixtures sin tocar
  `mock/fixtures.ts`.
- `src/types/contract.ts`: `AdminSellerRef`, `RejectedSellItemDTO`, campos de rechazo en
  `SellItemDTO`, `seller?` en `AdminBuylistDTO`, `reason?` en `BuylistItemDecisionInput` (§11).

### i18n / tests / e2e
- Claves nuevas `admin.m5.*` (`tabs.rechazadas`, `created`, `approvedTotal`, `reject*`,
  `rejectedOutOfTotal`, bloque `rejected.*` con fases y paginación) — paridad ES/EN verificada
  (`i18n-parity.test.ts` en verde).
- `M5View.test.tsx`: 17 tests (diálogo de motivo + validación + error 400 del server en el
  diálogo, pestaña Rechazadas con fases/plazos/sin convertir, vendedor con UUID en tooltip,
  fecha de creación, total aprobado del server). `api.test.ts`: reject sin motivo → 400 mock;
  reject con motivo → plazos +7d/+30d y aparición en `rejected-items`; rama REAL: URL/query de
  `rejected-items` y body `{decision,reason}` del PATCH.
- `e2e/admin.spec.ts`: +2 tests M5 (diálogo de motivo; pestaña Rechazadas sin convertir),
  verificado con `--list`.

### Gates
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run test` ✓ (44 archivos / 329 tests).

## 2026-08-18 · Guest checkout — comprar sin cuenta (stream «Órdenes y dinero», contrato v1.21-guest-checkout)

> Alcance implementado: **checkout de invitado** en `(storefront)/checkout` + **vista pública de
> seguimiento** `/[locale]/pedido`. PROJECT §J/§J.1 (criterios 45–56b), contrato **§4-G**,
> DESIGN_SYSTEM **§15**. NO se tocó `backend/` ni `docs/API_CONTRACT.md`.

### Pantallas y componentes nuevos (todos junto a su ruta, no en `components/` compartidos)
| Archivo | Qué es |
|---|---|
| `checkout/CheckoutView.tsx` (modificado) | Conmutador de las dos naturalezas del checkout **en la misma ruta**: con sesión = flujo de cuenta intacto; sin sesión = `GuestCheckoutView`. |
| `checkout/GuestCheckoutView.tsx` | Contenedor del flujo de invitado: cotización, gate, formulario, destino, pago, confirmación. |
| `checkout/CheckoutIdentityGate.tsx` | §15.2 — las tres vías (invitado / iniciar sesión / crear cuenta) inline, con "Cambiar". |
| `checkout/GuestCheckoutForm.tsx` | §15.3 — contacto (correo + lectura de vuelta), envío MX, destino, términos, resumen de errores. |
| `checkout/VaultUpsellPanel.tsx` | §15.4 — upsell inline de bóveda (nunca error), con salida en positivo. |
| `checkout/InlineAuthPanel.tsx` | Login/registro inline **sin navegar** (ver "Por qué no se reusó `AuthForm`"). |
| `checkout/GuestOrderConfirmation.tsx` | §15.5 — confirmación + reclamo post-compra (`AccountClaimOffer` incluido). |
| `checkout/guest-validation.ts` | Validación local (correo, erratas de dominio, `GuestAddressInput` del contrato). |
| `checkout/support-contact.ts` | Correo de soporte para pantallas sin DTO (ver solicitud 1 al arquitecto). |
| `pedido/page.tsx` + `pedido/layout.tsx` | Ruta pública con **chrome reducido** (logo + LocaleToggle) y `noindex, nofollow` + `referrer: no-referrer`. |
| `pedido/TrackingPageClient.tsx` | Token del query → **body** del POST + `history.replaceState`; estados loading/neutral/error. |
| `pedido/PublicOrderTracking.tsx` | §15.6 — vista de datos mínimos (superficie de seguridad). |
| `pedido/TrackingLinkNeutralState.tsx` | §15.7 — **una sola pantalla** para todos los fallos de token, con reenvío neutro. |
| `pedido/tracking-status.ts` | Mapa `GuestOrderPublicStatus` → versalita i18n + pasos del stepper (§4-G.5). |

### Endpoints consumidos (tal cual el contrato §4-G; ninguno inventado)
`POST /checkout/guest/quote` · `POST /checkout/guest/session` · `POST /orders/guest/track` ·
`POST /orders/guest/resend-link` · `POST /orders/claim` (tras el registro del reclamo).
`GET /orders/claimable` queda implementada en `lib/api.ts` pero **sin UI en este stream** (el banner
"tienes N pedidos por reclamar" vive en `/orders`, fuera del alcance acordado).

### Decisiones de implementación que conviene conocer
- **Criterio 46 por construcción:** el estado del formulario de invitado vive en `GuestCheckoutView`,
  **por encima** del gate; el carrito sigue en `localStorage`. Cambiar de vía no desmonta nada ni
  navega, así que ni el carrito ni los datos capturados se pierden (hay test unitario y E2E).
- **Criterio 48 (upsell, no error):** el radio de bóveda **nunca** está `disabled`/`aria-disabled`;
  al elegirlo se expande el panel y el botón de pago se bloquea con **texto explicativo**
  (`aria-describedby`), no mudo. Si el backend devolviera `422 VAULT_REQUIRES_ACCOUNT`, el `catch`
  **abre el upsell** en lugar de pintar error (doble red: proactiva + reactiva).
- **Criterios 51/52/53 (superficies de seguridad):** la vista pública pinta **solo** la lista cerrada
  de §15.6 — en particular **no** se pintan `emailMasked`, `recipientNameMasked` ni
  `postalCodeMasked` aunque el DTO los traiga. Cualquier rechazo del token (404 / 410 / **429** /
  cualquier `< 500`) y también "sin token en la URL" caen en la **misma** pantalla neutra, con el
  mismo texto; solo un 5xx/red muestra el error genérico con reintentar (sin eco de `errorCode`).
- **Confirmación no adivinable:** se pinta desde el estado de la transacción; el `orderId` solo se usa
  para `POST /orders/claim` y nunca se muestra ni entra en la URL. El `return_url` de Stripe (3DS con
  redirección) apunta a `/{locale}/pedido?token=…` con el `trackingToken` que devolvió el checkout
  (§4-G.2): es la única forma de que el invitado recupere su pedido si el navegador pierde estado.
  El token **no** se persiste en `localStorage` ni se loguea.
- **`guestPaid` en `CheckoutView`:** al limpiar el carrito tras pagar, y al crear cuenta desde el
  reclamo, la vista habría conmutado (carrito vacío / sesión nueva) y habría desmontado la
  confirmación. Por eso el "ya pagó como invitado" manda sobre ambas condiciones.
- **Por qué NO se reusó `components/domain/AuthForm`:** navega al terminar
  (`router.push(destForRole(...))`) y no expone `onSuccess`, así que dentro del checkout expulsaría
  al usuario de `/checkout` — justo lo que §15.2 prohíbe. `InlineAuthPanel` usa las **mismas**
  funciones (`login`/`register` de `lib/api`) y el **mismo** `GoogleSignInButton`; no duplica lógica
  de sesión. Alternativa futura (fuera de este stream, toca zona compartida): añadir `onSuccess?` y
  un modo compacto a `AuthForm` y hacer que `InlineAuthPanel` lo envuelva.
- **Barra sticky de pago en móvil (§15.3) NO implementada** a propósito: duplicaría el botón de pago
  y §15.9 exige que solo uno reciba foco. El `aside` ya queda al final del flujo en móvil. Si ux-ui
  la quiere, pido que defina el comportamiento de foco.

### Zonas compartidas tocadas (solo adiciones; nada existente cambia de comportamiento)
- `src/types/contract.ts`: bloque **aditivo** al final con los DTOs de §4-G + `shippingFeeCents?` en
  `BreakdownDTO` (campo opcional que el contrato v1.21 añade; los shapes previos no cambian).
- `src/lib/api.ts`: sección **aditiva** al final (6 funciones nuevas + mocks marcados). Solo se tocó
  la lista de imports de tipos.
- `src/components/ui/AmountBreakdown.tsx`: renglón de **envío** que se pinta **solo si**
  `breakdown.shippingFeeCents != null`. En bóveda y retiros el campo no viene ⇒ desglose idéntico al
  de v1.20 (el test existente del componente sigue verde sin cambios).
- `messages/{es,en}.json`: claves nuevas `checkout.identity/guest/destination/vaultUpsell/confirmation`,
  `track.*`, `track.neutral.*` (copy **normativo** de §15.7 literal), `status.tracking.*` y 4 códigos
  de error. Paridad ES/EN verificada por `i18n-parity.test.ts`.
- `e2e/checkout.spec.ts`: los casos del checkout **con cuenta** ahora hacen `loginAs` antes (sin
  sesión esa ruta es, por diseño, el checkout de invitado).

### `/checkout` deja de ser ruta privada (cambio en zona compartida, AUTORIZADO por el orquestador)
- **`src/components/layout/PrivateRouteGuard.tsx`: se quitó `'/checkout'` de `PRIVATE_PREFIXES`.**
  Con `/checkout` en la lista, en modo real (`NEXT_PUBLIC_USE_MOCKS=false`) un visitante **sin
  sesión** era redirigido a `/login?next=/checkout` y los **criterios 45/46 quedaban rotos**. En modo
  mock el guard es inerte, por eso la suite E2E daba verde igual (verde engañoso).
- **Por qué NO es una relajación de seguridad:** el criterio 45 exige que un visitante sin cuenta
  llegue al checkout y pague, y el contrato §4-G hace `@Public()` los endpoints `/checkout/guest/*`;
  es requisito de producto. El guard es una **conveniencia de cliente** —como dice su propio
  comentario, el **backend sigue siendo la autoridad**— y `/vault`, `/orders` y `/shipments` siguen
  guardados; cualquier llamada privilegiada sigue devolviendo `401`. El flujo con cuenta no cambia.
- **Anclaje de la regresión (modo REAL, no mock):**
  `app/[locale]/(storefront)/checkout/checkout-public-route.test.tsx` monta el guard con
  `config.useMocks = false` y verifica que `/checkout` y sus subrutas se montan **sin** redirección,
  que con sesión se comportan igual, y que `/vault`/`/orders`/`/shipments` **siguen** redirigiendo.
  Verificado a mano: reintroducir `'/checkout'` en el array pone ese test en rojo (2 casos).
- **Efecto colateral en un test preexistente:** `components/layout/PrivateRouteGuard.test.tsx` tenía
  el caso "preserva el destino en `next` … (/checkout)", que afirmaba justo el comportamiento
  derogado. Se cambió **solo ese caso** a `/shipments` (misma intención, prefijo que sigue siendo
  privado) con una nota que apunta al test ancla. No se tocó nada más de `components/`.

### Ambigüedades detectadas (reportadas, NO resueltas por mi cuenta)
1. **Contrato vs. diseño — reenvío de enlace: RESUELTO por arbitraje (v1.21.1 + §15.7 corregida).**
   Lo que reporté (el formulario de un solo campo de §15.7 chocaba con `{email, orderNumber}` de
   §4-G.4) lo arbitró el arquitecto a favor del contrato y ux-ui reescribió §15.7 con las **dos
   vías**. Mi implementación se realineó al texto normativo — ver "Realineación con §15.7" abajo.
2. **Contrato vs. diseño — teléfono.** §15.3 lo marca **opcional**; `GuestAddressInput` (§4-G.1) lo
   pide obligatorio (10 dígitos MX). Se implementó **obligatorio** (manda el contrato).
3. **`recipientName` y `acceptedTerms`** los exige el contrato y el diseño no los describe: se
   añadieron como campo obligatorio y casilla de aceptación explícita, con copy propio.
4. **`name` en el registro inline.** §15.4 dice "no se pide nada más" que correo + contraseña, pero
   `POST /auth/register` (§1) exige `name`. Se pide, **prellenado** con el nombre del destinatario.
5. **Reclamo inmediato vs. `emailVerified`.** §15.5 dibuja éxito inmediato tras crear la cuenta;
   §4-G.9 exige `emailVerified` (403). Implementado: se intenta el reclamo y, si responde
   `EMAIL_NOT_VERIFIED`, se muestra "verifica tu correo y vincúlalo desde tu historial"
   (`checkout.confirmation.claim.needsVerification`), nunca un error rojo.
6. **Estados públicos sin copy en §15.6.** El enum de §4-G.5 tiene 9 valores y la tabla de diseño
   solo 7: añadí `status.tracking.pendingPayment` y `status.tracking.inReview` (neutros, sin nombrar
   "contracargo").

### Solicitudes al arquitecto (no bloquean; NO edité el contrato)
1. **Correo de soporte antes de tener el DTO.** `support.evidenceContact` solo existe dentro de
   `GuestOrderTrackingDTO` (§4-G.3), pero la **confirmación** (§15.5) y el **estado neutro** (§15.7)
   lo necesitan sin token. Hoy vive centralizado en `checkout/support-contact.ts` con el valor
   normativo del contrato. Petición: exponerlo en un endpoint/campo público de configuración.
2. **URL de rastreo de paquetería.** El DTO trae `carrier` + `trackingNumber` pero no un patrón de URL
   confiable: la guía se pinta como **texto copiable**, no como enlace (misma política que
   `certNumber`). Si se confirma el patrón, se vuelve enlace.
3. **`GET /orders/claimable` sin superficie.** Queda lista en `lib/api.ts` para el banner de "pedidos
   por reclamar" en `/orders`; conviene decidir en qué stream se implementa.

### Mocks (claramente marcados, todos con el shape del contrato)
`lib/api.ts` — `computeGuestBreakdown` (réplica de `computeDirectShipBreakdown`), envío
`MOCK_SHIPPING_FEE_CENTS=17500` (el valor real viaja en el `BreakdownDTO`), y para
`trackGuestOrder`: token con `expired`/`revoked` → 410, token que empieza con `mock` → pedido demo,
cualquier otro → 404 `INVALID_TOKEN`. `createGuestCheckoutSession` replica
`422 VAULT_REQUIRES_ACCOUNT` y `422 ADDRESS_NOT_MX`. El backend sigue siendo la autoridad.

### Gates
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ · `npm run test` ✓ (49 archivos /
366 tests) · `npx playwright test` ✓ **60/60** en modo mock (incluye los 9 nuevos de
`e2e/guest-checkout.spec.ts`, que cubren §J.1: camino feliz, upsell, correo inválido, token
manipulado vs. expirado con texto idéntico, reenvío neutro con enfriamiento y ES/EN).


## 2026-08-18 (2ª ronda) · v1.21.1 — `checkoutToken` de 120 min + §15.7 corregida

### 1. Renombre CONTRACT-BREAKING: `trackingToken` → `checkoutToken` (+ `checkoutTokenExpiresAt`)
- `types/contract.ts` · `GuestCheckoutSessionResponse`: el campo pasa a **`checkoutToken`** y se
  añade **`checkoutTokenExpiresAt`** (ISO). Actualizado también el invariante §4-G.0-5 del comentario
  de cabecera.
- `lib/api.ts` · `createGuestCheckoutSession`: doc y **mock** al día
  (`checkoutToken: mock-<orderId>-checkout-token`, `checkoutTokenExpiresAt = ahora + 120 min`). No
  quedó **ninguna** referencia viva al nombre viejo (solo dos menciones históricas en comentarios,
  marcadas como "antes `trackingToken`").
- Consumidor: el `return_url` del 3DS en `GuestCheckoutView` usa `session.checkoutToken`.

### 2. La SEMÁNTICA nueva, reflejada en la UX (§4-G.7a)
- **El token del checkout vive 120 min y nunca viaja por correo.** El enlace de 90 días lo emite el
  webhook del settle y llega **solo** por correo. Verificado que la confirmación **no invita a
  guardar ni marcar como favorito** esa URL: su mensaje es `emailSentTo` ("te enviamos la confirmación
  y el enlace de seguimiento a {email}"), y no muestra ni ofrece la URL del checkout.
- **Aviso nuevo `track.temporaryLinkNotice`** en la vista de seguimiento: si `tokenExpiresAt` cae
  dentro de los 120 min + 10 de holgura (`isShortLivedCheckoutToken`, en `pedido/tracking-status.ts`),
  se avisa de que ese enlace es temporal y que el duradero llega por correo, con "Reenviar el enlace a
  mi correo" a la vista. El enlace de 90 días **no** dispara el aviso. Es solo copy: no cambia el
  acceso, y se apoya en el campo que §15.6 ya destina a eso. El texto dice "en unas horas" (agnóstico
  al valor exacto, coherente con los 120 min).
- **Camino de "volver pasadas las 2 h" verificado:** cae en `TrackingLinkNeutralState` y desde ahí el
  reenvío funciona (vía A con el propio token vencido). Cubierto con E2E dedicada.

### 3. Realineación con `DESIGN_SYSTEM §15.7` (corregida por ux-ui)
- **Copy normativo literal, ES y EN**, reemplazando el mío: el `body` y —lo importante— el `result`:
  *"Si **esos datos** corresponden a un pedido, enviamos un enlace nuevo a ese correo…"*. Mi versión
  anterior condicionaba sobre **el correo** ("si hay un pedido asociado a ese correo"), que enmarca la
  respuesta como una afirmación sobre esa dirección; la normativa condiciona sobre los datos en
  conjunto y no insinúa nada. **La vía A usa exactamente la misma frase** (hay test que compara el
  texto de ambas vías carácter a carácter).
- **Inventario de claves alineado con §15.11:** `track.neutral.*` = `title`, `body`, `emailLabel`,
  `submit`, `result`, `cooldown`, `claimAlternative`, `support`, **`noLinkCta`**, **`manualIntro`**,
  `orderNumberLabel`, `orderNumberHelp`, **`incompleteForm`** (+ `cooldownAnnounce`, exigido por el
  párrafo de accesibilidad de §15.7). Se retiraron mis nombres propios `noLinkToggle`,
  `orderNumberRequired` y `emailInvalid`: la validación local usa **una sola** nota normativa
  (`incompleteForm`), que cubre tanto "falta el dato" como "correo mal formado".
- **Vía B conforme:** tras *disclosure* (`aria-expanded`/`aria-controls`, cerrado por defecto cuando
  hay token); **ningún campo por separado habilita el envío** (el botón está `disabled` hasta tener
  correo válido **y** número de pedido); `<fieldset>` + `<legend>` (= `manualIntro`), labels visibles,
  `autocomplete="email"` en el correo y **`off`** en el número de pedido; `aria-invalid` +
  `aria-describedby` a la nota local en los campos que falten (conservando la ayuda del campo de
  pedido en el `describedby`); foco al primer campo al abrir el disclosure.
- **Validación 100% local, confirmado:** el número de pedido solo se comprueba "no vacío"; no hay
  llamada al servidor en `blur`, ni autocompletado, ni comprobación de existencia. La única petición
  es el `POST /orders/guest/resend-link` al enviar.
- **Frases prohibidas (lista ampliada) verificadas por test:** el render no contiene
  "no encontrado", "no existe", "no coinciden", "incorrecto", "no está registrado", "token",
  "expiró hace N", ni plazos en días.

### Gates de esta ronda
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ (`/[locale]/checkout` y `/[locale]/pedido`
presentes) · `npx vitest run` ✓ **50 archivos / 373 tests** · `npx playwright test` ✓ **62/62** en modo
mock (2 E2E nuevas: enlace de checkout vencido → pantalla neutra que sí reenvía, y enlace de 90 días
sin aviso de temporalidad).

## 2026-08-18 · Cotizador unificado con Master Set (mode="quoter") + fix foco M5

### Tarea 1 — `mode="quoter"` en el binder COMPARTIDO de Master Set

**Qué cambió.** `BuylistView.tsx` (raw) ya NO tiene su propio grid de búsqueda plano: monta
`<MasterSetPanel mode="quoter" onAddToSellCart={...} />` (mismo componente que M1/bóveda,
§4.20f). Cada carta muestra sus **casillas por acabado** derivadas de `card.availableFinishes`
(nunca un chip de texto, nunca una casilla para un acabado que la carta no tiene); clic en una
casilla agrega esa combinación (carta, acabado) al carrito de VENTA con el precio ya cotizado.
graded/sealed (sin variantes por acabado — cotizan siempre en `normal`) CONSERVAN el grid plano
anterior sin cambios, incluida "Filtrar por set"/"Buscar carta" y el bulk multi-selección.

**Sin cambio de contrato.** `mode="quoter"` NO agrega ningún endpoint: compone client-side con
los MISMOS tres endpoints públicos que ya usaba el cotizador — `GET /buylist/sets`,
`GET /buylist/cards` (troceado en TODAS sus páginas antes de resolver — ver bug P-4a abajo) y
`POST /buylist/quote/batch` (troceado en lotes de `BUYLIST_QUOTE_BATCH_MAX`). La lógica vive en
`fetchQuoterIndex` (`MasterSetIndex.tsx`) y `fetchQuoterBinder` (`MasterSetBinder.tsx`), paralelas
a `fetchIndex`/`fetchBinder` existentes. `MasterSetVariantDTO.quote` (`types/contract.ts`) es un
campo ADITIVO documentado como "solo frontend, NO viaja del backend" — no toca `API_CONTRACT.md`.

**Bug de paginación (P-4a, confirmado con Pitch Black · 120 cartas).** Antes el cotizador cortaba
en 20 cartas sin control. `fetchQuoterBinder` acumula TODAS las páginas de `GET /buylist/cards`
(pageSize 50) antes de resolver la promesa del binder, así que el set completo se ve de una vez
— **decisión de diseño, no el patrón "Cargar más" de M1View**: para un set >20 cartas
multi-acabado esto dispara varias llamadas a `batchQuote` al abrir el set (ej. 120 cartas ×
2 acabados ≈ 5 llamadas de 50). Es correcto y simple, pero si algún set crece mucho más
(cientos de cartas) valdría la pena revisar si conviene paginación explícita — anotado, no
bloqueante.

**Decisiones de producto tomadas sin volver a preguntar (AUTO, a revisar si no convencen):**
- El multi-selección (bulk) del grid plano **NO existe para raw**: cada casilla del binder ya es
  su propia acción de un clic: no hace falta un paso de selección previo. Sigue existiendo para
  graded/sealed (sin tocar).
- "Filtrar por set" / "Buscar carta" del enunciado se resuelven con los controles PROPIOS de
  Master Set: `MasterSetIndex` aporta "Buscar set" (elegir un set) y `MasterSetBinder` ahora
  tiene un "Buscar carta" nuevo (SOLO en `quoter`, nombre/número dentro del set elegido). La
  etiqueta exacta difiere ("Buscar set" vs "Filtrar por set" del enunciado) pero la función es
  equivalente; no se duplicaron labels para no fragmentar el sistema de i18n del binder
  compartido.

**Archivos.** `components/master-set/mode.ts` (+`'quoter'`), `MasterSetIndex.tsx` (fetch +
oculta completitud/piezas/orden en `quoter`), `MasterSetBinder.tsx` (fetch + `QuoterCell` nueva:
casillas-botón con precio, "Buscar carta" local, oculta filtros de huecos/secret rare en
`quoter`), `MasterSetPanel.tsx` (prop `onAddToSellCart`), `types/contract.ts`
(`MasterSetVariantDTO.quote?`), `(storefront)/buylist/BuylistView.tsx` (monta el panel en raw;
`CartLine.card` se angostó a `{id,name,number,imageSmallUrl}` — ya no requiere el `CardDTO`
completo del catálogo).

**Tests.** `MasterSet.test.tsx` +4 (dos acabados → dos casillas independientes; un acabado → sin
hueco vacío; 120 cartas → todas visibles sin "Cargar más"; clic agrega al carrito con el precio
correcto de esa combinación). `BuylistView.test.tsx` reescrito: el describe `raw` ahora navega
por el binder Master Set; graded/sealed quedó en su propio describe con el grid plano y el bulk
intactos; carrito/KYC/gating/F5/"Mis solicitudes" sin cambios de fondo (mismos textos i18n,
mismos precios de fixtures — solo cambió CÓMO se llega a tener algo en el carrito).

### Tarea 2 — bug real: el textbox de motivo de rechazo perdía el foco (M5)

**Causa raíz.** `components/ui/Modal.tsx` tenía un solo `useEffect` que hacía
`ref.current?.focus()` Y registraba el listener de Escape, con `[open, onClose]` como
dependencias. `onClose` (`closeReject` en `M5View.tsx`) es una función NUEVA en cada render del
padre (no memoizada) — cada tecleo cambia `rejectReason` → M5View re-renderiza → `onClose` cambia
de referencia → el efecto se re-dispara → `ref.current?.focus()` vuelve a enfocar el **wrapper**
del modal, robándole el foco al `<input>` a media escritura.

**Fix.** Se separó en dos efectos: el foco inicial depende SOLO de `open` (se enfoca una vez al
abrir, nunca en cada re-render); el listener de Escape sigue dependiendo de `[open, onClose]`
(re-suscribirse ahí es inofensivo, no roba foco). Cambio confinado a `Modal.tsx`; no se tocó
`M5View.tsx` — el mismo bug existía potencialmente en cualquier otro modal con un `footer` que
referencia una función inline del padre (p. ej. los otros modales de M5, M1, M6…), así que el fix
en el componente compartido los corrige a todos de una vez.

**Test.** `M5View.test.tsx` +1 (`userEvent.type` de varias letras seguidas sobre "Motivo del
rechazo"; falla sin el fix con solo el primer carácter registrado, pasa con el fix).

### Gates
`npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ · `npm run test` ✓
(45 archivos / 346 tests, incluye los 17 tests preexistentes de `M5View.test.tsx` + 1 nuevo).

## 2026-08-18 · T1/T2/T3 — casillas por variante real, copy de inventario admin, alta concluyente

Tercera ronda sobre el mismo bug (rama `fix/variantes-y-orden-master-set`). El PO pidió, textual:
«en el master set son dos cartas de cada una: la común a la izquierda y la holo a la derecha» — es
decir, una casilla de IMAGEN por variante real, no un chip de texto con etiqueta de acabado.

### T1 — Una casilla de imagen por variante (`MasterSetBinder.tsx`, `CellDrawer.tsx`)

**Qué cambió.** `BinderCell` y `QuoterCell` ya NO pintan una sola imagen + chips de texto por
acabado debajo: pintan **una casilla de imagen por entrada de `cell.variants`**, lado a lado, en
el orden de `FINISH_ORDER` (normal izquierda, reverse holo derecha, contrato v1.22 — el backend
garantiza ese orden y que `|casillas| = |availableFinishes| ≥ 1`, nunca relleno). Las N casillas
de una celda usan la MISMA `cell.imageSmallUrl` (pokemontcg.io no publica arte por acabado; el
contrato lo deja explícito: NO hay `imageByFinish`). Cada casilla lleva su etiqueta de acabado en
mono debajo de la imagen y su estado (conteo si `covered`, «HUECO» si no — atenuada + borde
punteado), así que nunca hay que adivinar cuál casilla es cuál. Una carta con una sola variante
pinta UNA sola casilla (sin hueco fantasma de relleno). Aplica también a `VariantSlots` en
`CellDrawer.tsx` ("Casillas por acabado").

**Rejilla responsive.** El binder calcula `slotCols = max(variants.length)` de las celdas
visibles y baja un escalón de columnas por cada casilla extra (`gridColsForSlots`): 1 casilla →
`grid-cols-2 sm:3 lg:4 xl:5` (como antes); 2 casillas → `grid-cols-1 sm:2 lg:3 xl:4`; así la
imagen de cada casilla no se encoge ilegible en móvil cuando el set tiene cartas multi-acabado.
Todas las celdas comparten el MISMO `slotCols` (vía `style={gridTemplateColumns}`) para que el
binder se lea como una retícula uniforme aunque cada celda tenga distinto nº de variantes.

**Orden — `@/lib/cardOrder.ts` (nuevo).** Contrato v1.22: `CardDTO`/`MasterSetCardCellDTO` ganan
`numberSort`/`numberPrefix` (columnas persistidas, M-26) y el `ORDER BY` correcto es
`(numberPrefix, numberSort, number, id)` — el front NUNCA re-ordena por número tras recibir la
página, pero SÍ debe reproducir ese orden al filtrar LOCALMENTE (el binder ya filtraba por
acabado/huecos/secret-rare/nombre en cliente). `compareCardNumber` implementa ese comparador;
`deriveNumberParts` lo deriva en cliente como red de seguridad si el backend todavía no manda las
columnas (marcadas `?` en el tipo a propósito — ver nota de tipos abajo). El cotizador
(`fetchQuoterBinder`, compuesto 100% client-side) también usa estas claves en vez del índice del
arreglo que usaba antes (`numberSort: idx` quedaba mal para sets con promos intercalados).

**Nota de tipos (decisión de frontend, no de contrato).** `numberSort`/`numberPrefix` se
declararon `?` opcionales en `types/contract.ts` en vez de requeridos: la norma v1.22 los hace
normativos, pero mientras el re-sync/backfill (M-26) no haya corrido en TODAS las filas — y para
no obligar a tocar decenas de fixtures/tests ajenos a este bug en todo el repo — el tipo tolera su
ausencia y `cardOrder.ts` cae a `deriveNumberParts`. Cuando el campo llega, manda él. No es un
relajamiento del contrato: es tolerancia de despliegue documentada in situ.

### T2 — Copy de admin: inventario, no carrito (`CellDrawer.tsx`, `MasterSetPanel.tsx`, i18n)

Regla del PO: el carrito NO aplica a admin. Se renombró TODO el copy de M1 que hablaba de
"carrito" a lenguaje de inventario/alta/lote, en `es.json` y `en.json` (namespace `masterSet`
únicamente — `catalog.addToCart`/`buylist.cartTitle` son carritos DE VERDAD y no se tocaron):

| Antes (`masterSet.*`) | Ahora |
|---|---|
| `quickAddTitle` "Alta rápida al carrito" | `quickIntakeTitle` "Alta rápida al inventario" |
| `addToCart` "Agregar al carrito" | `addToInventory` "Dar de alta al inventario" (alta INMEDIATA) + `addToBatch` "Agregar al lote" (encola, alta por lote) |
| `addedToCart` "Agregado al carrito de captura." | `addedToBatch` "Agregada al lote de alta." |
| `cartTitle`/`cartSummary`/`cartRemove`/`cartSubmit`/`cartClear` | `batchTitle`/`batchSummary`/`batchRemove`/`batchSubmit`/`batchClear` (mismo copy de fondo, "carrito"→"lote") |

`masterSet.buyCta`/`buyAdded` ("Agregar al carrito de compra") NO se tocaron a propósito: es el
CTA de `user_vault_self` para comprar una pieza faltante — un carrito de COMPRA de verdad, del
cliente, no de admin.

### T3 — El botón de alta ahora es concluyente y visible

**Diagnóstico (confirmado, no supuesto).** La mutación de alta SÍ funcionaba — el bug no era de
red ni de lógica de negocio. Era de FLUJO: (1) "Agregar al carrito" solo ENCOLABA la línea; el
botón que REALMENTE hacía POST (`batchCreateItems`, "Dar de alta N piezas") vivía en
`MasterSetPanel.tsx`, renderizado DEBAJO de toda la cuadrícula del binder; (2) el modal del
drawer (`CellDrawer.tsx`) se quedaba abierto tapando la pantalla con el overlay, así que ese
segundo paso quedaba invisible detrás del overlay y al final de la página — para el operador,
"presiono y no pasa nada".

**Solución — el lote vive DENTRO del modal, en su pie fijo.**
- `Modal.tsx`: el diálogo ganó un layout `flex flex-col` con altura acotada
  (`max-h-[100dvh] sm:max-h-[90vh]`); el `title`/header y el `footer` quedan `shrink-0` (fijos) y
  el `children` scrollea (`overflow-y-auto`). Antes un drawer largo (muchos campos + piezas +
  ajuste) desbordaba la ventana y el `footer` quedaba fuera de la vista sin scrollear — exactamente
  el síntoma que reportó el PO. Cambio en el componente COMPARTIDO: beneficia a todos los modales
  con `footer` largo (M1/M5/M6…), no solo a éste.
- `CellDrawer.tsx` gana `BatchFooter`: pinta, DENTRO del `footer` fijo del modal, el desenlace del
  lote — banner de éxito/error tolerante por-línea (`PerLineErrors`) Y, si hay líneas pendientes,
  el resumen + botón "Dar de alta N piezas" / "Vaciar lote". El operador ve el resultado SIN
  cerrar el modal y SIN hacer scroll.
- `QuickAddSection` ahora ofrece DOS acciones, ninguna ambigua: **"Dar de alta al inventario"**
  (primaria) — encola la línea Y envía el lote en el MISMO clic (`queueAndSubmit`), para el caso
  común de una sola carta; **"Agregar al lote"** (secundaria) — solo encola, para seguir
  capturando varias cartas antes de confirmar (alta por LOTE, P-5 de `PENDIENTES.md`, se
  conserva). `MasterSetPanel.tsx` expone ambas como `CaptureBatchState` (`capture.ts`), un objeto
  compartido entre el panel (dueño del `useMutation`/`batchKeyRef`) y el drawer (que solo lo lee y
  dispara).
- **Éxito falso corregido.** Antes `QuickAddSection` hacía `setAdded(true)` incluso si
  `onAddToCart` era `undefined` (nunca ocurría en la práctica porque el padre siempre lo pasaba,
  pero era una trampa: la UI mentía si algún día faltara el callback). Ahora sin `batch` cableado
  no hay botones de alta que fingir — la sección no tiene ninguna ruta de "éxito" sin una
  mutación real detrás.
- **Error visible corregido.** Antes `submit.isError` pintaba un banner en `MasterSetPanel.tsx`,
  AL FONDO de la página — con el modal abierto, tapado por el overlay. Ahora, si el drawer está
  abierto, el error (y el resultado) se pintan en `BatchFooter` (el banner del panel se omite
  mientras `openCell` esté seteado, para no duplicar el aviso); si el drawer está cerrado, el
  banner del panel sigue ahí como antes.
- **Idempotencia intacta.** `queueAndSubmit` reusa la MISMA `batchKeyRef` de la sesión
  (`ensureBatchKey`) — un reintento por timeout sigue siendo replay idempotente en el backend. El
  lote viaja como ARGUMENTO de `submit.mutate(lines)` (no se lee `cart` del closure dentro de
  `mutationFn`), porque React agrupa el `setState` del mismo tick: sin este cambio, la línea recién
  agregada en el mismo clic de "Dar de alta al inventario" se habría perdido de la primera llamada.
  `PlatformPiecesSection` (publicar/ajustar) no se tocó — su idempotencia por batchKey ya estaba
  bien y es independiente de este lote.

**Verificado en navegador (stack real, no mocks) — evidencia:**
- `UPDATE "Card" SET "availableFinishes"='{normal,reverse_holo}' WHERE name='E2E Reverse Bird'`
  (luego el backend la sembró así de forma permanente): en `/es/buylist` → «E2E Base Set» y en
  `/es/admin/m1` → Master Set → «E2E Base Set», «E2E Reverse Bird» (#17) es la ÚNICA carta con
  DOS casillas de imagen lado a lado (NORMAL izquierda, REVERSE HOLO derecha); las demás 5 cartas
  muestran UNA sola casilla.
- Clic en "Dar de alta al inventario" sobre «E2E Charizard» (con precio) → banner
  "1 piezas creadas · 0 líneas con error." + folio `INV-000001` visible DENTRO del modal, sin
  cerrarlo; confirmado además contra la API (`GET /admin/inventory/items?cardId=...`) que la
  pieza existe de verdad (no solo optimista en UI) y que el conteo de la celda subió en vivo.
  Clic sobre «E2E Reverse Bird» en `reverse_holo` (sin precio de referencia) → banner
  "0 piezas creadas · 1 líneas con error." + "Esta carta tiene precio pendiente…" — también
  DENTRO del modal, mismo comportamiento concluyente para el camino de error.

### Archivos
`components/master-set/MasterSetBinder.tsx` (casillas por variante, `slotCols`, orden local con
`cardOrder.ts`), `CellDrawer.tsx` (`VariantSlots` con imagen por variante, `BatchFooter`,
`QuickAddSection` con alta inmediata/por-lote), `MasterSetPanel.tsx` (`CaptureBatchState`,
`queueAndSubmit`/`submitBatch`/`clearBatch`, banner del panel oculto si el drawer está abierto),
`capture.ts` (+`CaptureBatchState`), `components/ui/Modal.tsx` (pie fijo + cuerpo scrolleable),
`lib/cardOrder.ts` (nuevo), `types/contract.ts` (`CardDTO`/`MasterSetCardCellDTO` +=
`numberSort?`/`numberPrefix?`), `messages/{es,en}.json` (copy de inventario, namespace
`masterSet`), `MasterSet.test.tsx` (+5: dos tests de T3 alta inmediata éxito/error dentro del
modal; un test de T1 conteo de imágenes 2 vs 1; tests existentes de "Agregar al carrito" migrados
a "Agregar al lote").

### Solicitud al arquitecto (pendiente, no bloqueante)
Ninguna nueva. Sigue vigente la de la ronda anterior: confirmar si al backend le conviene exponer
`numberSort`/`numberPrefix` como NO opcionales en el DTO ya con M-26 desplegado (el frontend ya
tolera su ausencia por diseño, así que esto es solo para que el contrato deje de decir "aditivo
opcional" si en la práctica ya siempre viajan).

### Gates
`npm run typecheck` ✓ · `npm run lint` ✓ · `npm run test` ✓ (50 archivos / 381 tests).

## Fix de producción — pieza muerta en carrito viejo NO bloquea el checkout (2026-08-18, contrato v1.21.3-quote-prune, rama `fix/carrito-pieza-muerta`)

Los dos quotes (§4 y §4-G.1) ahora resuelven POR ÍTEM y devuelven `200` con
`unavailableItems: UnavailableCartItemDTO[]` (siempre presente). El front cumple su "deber de
contrato": **poda del localStorage** los ids muertos antes de llamar a session (que sigue
estricta, anti double-sell) y muestra un aviso informativo. Además el carrito local gana
**expiración a 30 días** (nota de frontend del contrato, complementa la poda).

### Formato de storage del carrito (`lib/cart.ts`)

- **v2:** `tcg.cart = { ids: string[], updatedAt: number }` (epoch ms de la última modificación).
  `add`/`remove`/`prune`/`clear` refrescan `updatedAt`; **leer NO lo refresca** (si leer contara
  como "tocar", un carrito abierto a diario jamás expiraría distinto… pero tampoco expiraría el
  aviso de 30 días de un carrito que solo se mira; se decidió que solo MODIFICAR cuenta).
- **Expiración:** al leer, si `now - updatedAt > 30 días` (estrictamente MÁS de 30 días — a los
  30 exactos sigue vivo), el carrito se limpia y se persiste vacío.
- **Migración suave:** el formato v1 era un array JSON plano. Un array plano (o un objeto con
  `ids` pero sin `updatedAt` numérico) se trata como carrito VÁLIDO y se re-persiste en v2 con
  `updatedAt = now` en esa misma lectura. **Nunca** se descarta un carrito por cambio de formato;
  el costo es que un carrito legado "renace" con timestamp fresco una única vez.
- **`prune(ids: string[])`** nuevo en `useCart`: poda en lote con la misma semántica de storage
  que `remove` (mismo write + evento), pero **idempotente**: si ningún id sigue en el carrito no
  escribe ni emite — clave para poder llamarlo desde un efecto sin ciclar la re-cotización.

### Dónde vive el estado del aviso (`(storefront)/checkout/unavailable-notice.ts`)

Mini-store de módulo (`useSyncExternalStore`) y NO estado de componente, por dos razones:
1. el aviso debe **sobrevivir a la re-cotización** (la poda cambia `cart.ids` → la queryKey
   cambia → el siguiente fetch trae `unavailableItems: []`); 2. debe sobrevivir al **desmonte de
   la vista que lo produjo** — si TODO el carrito murió, `CheckoutView` desmonta
   `GuestCheckoutView` y pinta el EmptyState, y el aviso tiene que seguir junto al carrito vacío.
Se limpia al cerrarlo (X del banner) o al salir del checkout (cleanup de `CheckoutView`).
`pushUnavailableNotice` dedupea por `inventoryItemId` (idempotente ante re-fetches).

### Vistas (`CheckoutView.tsx` / `GuestCheckoutView.tsx`)

- Efecto idempotente tras cada quote: `pushUnavailableNotice(unavailableItems)` +
  `cart.prune(ids)`. Sin ciclo: el fetch posterior a la poda trae `[]` y el efecto es no-op.
- `UnavailableItemsNotice` (nuevo, carpeta checkout) usa `Banner variant="info"`
  (`role="status"`, regla fina neutra, tinta muted — informativo, NO bermellón ni `alert`).
  Copy i18n en `checkout.unavailable.*` (ES/EN): con nombre si `cardName` viene, genérico si es
  `null`, plural con lista de nombres si son varias. Se renderiza **FUERA de `QueryState`**
  (bajo el título) para que no desaparezca durante el loading de la re-cotización.
- **Carrito 100 % muerto:** la poda vacía el carrito → `CheckoutView` pinta el EmptyState
  existente MÁS el aviso; nunca la pantalla de error genérico ni "Reintentar" (los quotes ya no
  devuelven `404`/`409` globales). No hay mini-cart lateral en la app (el header solo muestra el
  contador `useCart().count`), así que no hubo nada más que podar.
- Mocks (`lib/api.ts`): los dos quotes mock devuelven `unavailableItems` (id ausente de los
  fixtures ⇒ `cardName: null`) y **breakdown en CEROS** si todo murió (guest incluye
  `shippingFeeCents: 0`). El caso "existe pero fuera de venta" (`cardName` poblado) no se modela
  en fixtures; lo cubren los tests de vista con el API mockeado y el backend real.

### F-2 (veredicto techlead, misma rama) — carrera "pieza vendida ENTRE el quote y el pago"

La session sigue estricta (anti double-sell): si la pieza muere DESPUÉS del quote y el usuario
paga, `createCheckoutSession`/`createGuestCheckoutSession` responde `409 ITEM_UNAVAILABLE` (o
`404 NOT_FOUND`) y antes eso era un callejón sin salida (solo el mensaje genérico junto al botón).
Ahora el catch de `pay()` en AMBAS vistas, para esos dos códigos, dispara **`query.refetch()`**:
el re-quote trae la pieza en `unavailableItems` y la maquinaria ya construida (efecto de poda +
`UnavailableItemsNotice`) poda el localStorage y avisa sola.

**Decisión de UX:** con el re-quote en marcha, el banner ES el aviso — NO se pinta además el
`payError` genérico junto al botón (evita el doble mensaje contradictorio "esta carta ya no está
disponible" + banner "se quitó de tu carrito"). **Respaldo si el refetch falla:** se setea
`payError` con el mensaje del error original y, además, el quote queda en estado de error, así que
`QueryState` pinta su aviso con "Reintentar" — nunca una pantalla muda. El manejo de los demás
códigos NO cambió (`EMAIL_NOT_VERIFIED` → banner de verificación; `VAULT_REQUIRES_ACCOUNT` →
upsell de bóveda).

### Tests

`lib/cart.test.ts` +8 (migración v1→v2 sin pérdida, expiración >30d, 30d exactos se conserva,
refresh de timestamp en add/remove/clear, prune en lote e idempotente, `{ids}` sin timestamp).
`checkout/CheckoutUnavailable.test.tsx` +5 (invitado: 1 muerta con nombre + 2 vivas ⇒ banner con
nombre, renglones vivos y storage podado; cierre del aviso; invitado todas muertas ⇒ EmptyState +
aviso plural sin error/reintentar; con cuenta: mismo par de casos, incl. `cardName: null` ⇒ copy
genérico). Tests preexistentes que asserteaban el array plano de `tcg.cart` se actualizaron al
formato v2 (`.ids`).
**F-2:** +3 en `CheckoutUnavailable.test.tsx` (con cuenta y de invitado: session rechaza
`ITEM_UNAVAILABLE` ⇒ se re-cotiza, banner con nombre, renglón y localStorage podados, sin
`role=alert` ni modal Stripe; y el caso "el refetch de respaldo también falla" ⇒ QueryState en
error con "Reintentar", nunca mudo).

### Gates
`npm run lint` ✓ · `npx tsc --noEmit` ✓ · `npm run build` ✓ · `npx vitest run` ✓
(52 archivos / 394 tests, +16 nuevos en la rama).

---

## WS «Sellado / Producto cerrado» (v1.23-sealed-sales) — rama `claude/sellado-producto-cerrado`

Implementa la superficie de front del **producto SELLADO** según contrato §2-S, §3 (`GET /vault/sealed`),
§M1 (`GET /admin/vaults/:userId/sealed`) y §M2 (`GET/PUT /admin/pricing/sealed-spreads`). **Solo venta**
(no hay buylist de sellado). Todo el consumo va por los DTOs del contrato; el precio del sellado lo
resuelve el backend (`override > mercado×spread > PRICE_PENDING`), el front nunca lo calcula.

### Pantallas / componentes creados
- **`(storefront)/sellado`** (`page.tsx` + `SealedShopView.tsx`): ventana de tienda. UNA cuadrícula
  filtrable por set / presentación (`sealedSubtype`) / condición (`SealedCondition`) + orden. Muestra
  SOLO stock (`GET /catalog/sealed`), agrupando piezas idénticas en una tarjeta con **«N disponibles»**,
  imagen TCGCSV (`imageUrl`, fallback a la de catálogo) y precio «desde» (`fromPriceCents`). Incluye el
  **call-out mailto anti-buylist** a `contacto@tcgvaultmx.com` (copy del front, no un endpoint). Estados:
  cargando (skeletons), vacío («aún no hay sellado en stock»), error (QueryState + reintentar).
- **`(storefront)/sellado/[inventoryItemId]`** (`SealedDetailView.tsx`): ficha. Condición visible al
  comprador (mint / «Detalle menor en caja»), valor de mercado informativo, **selector de cantidad**
  (carrito **por-pieza**: agrega las N piezas más baratas del grupo, `listings` ordenados asc) y CTA
  `accent`. El **destino recibir/bóveda se decide en el checkout existente** (§4/§4-G) — nota explícita,
  sin duplicar flujo. Reusa `CartAddedToast` y `useCart`.
- **`SealedValueTrend.tsx`** (feature-flag `sealed_value_trend`): tendencia de valor estilo acciones
  (`GET .../value-history`), gráfica recharts + delta. **Cableado apagado limpio:** se monta solo si
  `SealedGroupDetailResponse.trendEnabled`; si el endpoint responde 404 (`FEATURE_DISABLED`/`NOT_FOUND`)
  el componente se **oculta** (`retry:false`, `isError → null`), nunca error ni curva fabricada.
- **`SealedRestockForm.tsx`** (feature-flag `sealed_restock_alerts`): «avísame cuando vuelva»
  (`POST .../restock-subscriptions`). Se monta solo si `restockEnabled`; ante 404 `FEATURE_DISABLED`
  se oculta. Respuesta **neutra** (mismo mensaje de éxito siempre; no revela existencia del producto).
- **`components/domain/SealedVaultPanel.tsx`**: pestaña «Sellado» de bóveda, **compartida** entre cliente
  (`mode="self"` → `GET /vault/sealed`) y admin (`mode="admin"` + `userId` → `GET /admin/vaults/:id/sealed`).
  Lista con imagen, condición, cantidad y valor de mercado; total valuado a referencia + `pendingPriceCount`
  (piezas sin mercado marcadas «precio pendiente» y excluidas del total, misma base del portafolio §3).

### Integraciones en vistas existentes (reuso, sin duplicar)
- `StorefrontHeader`: nueva entrada de nav **«Sellado»** (pública) → `/sellado`.
- `(storefront)/vault/VaultView`: tercera pestaña **«Sellado»** junto a «Piezas»/«Master set»
  (`SealedVaultPanel mode="self"`).
- `(admin)/admin/vaults/VaultsView`: al abrir la bóveda de un cliente, dos pestañas **«Cartas»**
  (binder master-set existente) / **«Sellado»** (`SealedVaultPanel mode="admin"`).
- `(admin)/admin/m1/M1View`: captura de **`sealedCondition`** en el alta (individual y por lote), default
  `mint`; `listPriceCents` pasó a **opcional** (v1.23: el backend auto-precia por mercado×spread; el
  override manual sigue disponible y gana). Payloads `createInventoryItem` y `batchCreateItems` mandan
  `sealedCondition` solo para `productType='sealed'`.
- `(admin)/admin/m2/M2View`: **editor de spreads de venta del sellado** (§M2), clon del editor de venta
  por rareza pero keyeado por presentación (`SealedSubtype`) + fallback global. Advierte visualmente si
  un spread queda en **0%** (badge por-fila «Sin margen» + banner global money-safe). `GET/PUT
  /admin/pricing/sealed-spreads`.

### Contrato / tipos / API
- `types/contract.ts`: `SealedCondition`, `SealedSpreadSource`, `PriceSource += tcgcsv`, `ListingDTO +=
  sealedCondition?`, `BatchInventoryItemInput/CreateInventoryItemInput += sealedCondition?`, y DTOs
  `SealedGroupDTO`, `SealedGroupListResponse`, `SealedGroupDetailResponse`, `VaultSealedGroupDTO`,
  `VaultSealedResponse`, `SealedSpreadsDTO`.
- `lib/api.ts`: `getSealedGroups`, `getSealedGroupDetail`, `getSealedValueHistory`,
  `subscribeSealedRestock`, `getVaultSealed`, `getAdminVaultSealed`, `getSealedSpreads`,
  `updateSealedSpreads`. Con ramas mock y ramas reales (`apiRequest`).
- `messages/{es,en}.json`: namespace `sealed.*`, `status.sealedCondition.*`, `nav.sealed`,
  `vault.tabs.sealed`, `admin.vaults.detailTabs.*`, `admin.m1.sealed*`/`listPriceOptional*`,
  `admin.m2.sealedSpreads.*`.

### Endpoints consumidos
`GET /catalog/sealed`, `GET /catalog/sealed/:id`, `GET /catalog/sealed/:id/value-history` (flag),
`POST /catalog/sealed/restock-subscriptions` (flag), `GET /vault/sealed`,
`GET /admin/vaults/:userId/sealed`, `GET|PUT /admin/pricing/sealed-spreads`,
`POST /admin/inventory/items` + `.../batch` (con `sealedCondition`). El checkout se reusa tal cual
(`POST /checkout/quote|session`, §4/§4-G): el sellado se compra por `inventoryItemId` como cualquier pieza.

### Mocks (pendientes de backend real, en `lib/mock/fixtures.ts`)
`mockSealedGroups` (3 grupos: box mint, etb mint, box «detalle menor en caja» por override),
`mockSealedGroupDetail`, `mockVaultSealed` (incluye un grupo sin mercado → pendiente), `mockAdminVaultSealed`,
`mockSealedSpreads` (blister a 0% para ejercitar la advertencia), `generateSealedValueHistory`. En el mock
`trendEnabled=true` / `restockEnabled=false` para ejercitar ambos caminos de feature-flag; `subscribeSealedRestock`
simula 404 `FEATURE_DISABLED`.

### Supuestos y notas para el arquitecto
- **Filtro de set en `/sellado`:** las opciones del combo de set se derivan de los grupos ya cargados
  (no hay endpoint de facetas de sellado en el contrato). Con paginación es una aproximación del universo;
  el `setId` viaja igual al backend. Si se quiere un combo completo, haría falta un `GET /catalog/sealed/facets`
  (o reutilizar `/catalog/sets`). **No es bloqueo.**
- **Paginación:** las vistas leen `{page,pageSize,total}` del contrato pero hoy muestran la primera página
  (los volúmenes de sellado son pequeños); si crece, se añade el control prev/next (patrón existente).
- Sin bloqueos para el arquitecto: el contrato §2-S/§3/§M1/§M2 fue suficiente.

### Gates (reales, esta rama)
`npx tsc --noEmit` ✓ · `npx next lint` ✓ (sin warnings) · `npx next build` ✓ (rutas `/[locale]/sellado`
y `/[locale]/sellado/[inventoryItemId]` generadas) · `npx vitest run` ✓ (52 archivos / 403 tests, sin
regresiones). No se añadieron tests unitarios nuevos en esa pasada (los flujos de sellado quedan cubiertos
por typecheck/build; QA levantará E2E).

### Saneo — tests de componente de sellado (pasada `claude/sellado-producto-cerrado`, aprobada por PO)
Cierra la brecha de cobertura marcada por QA (los componentes de sellado no tenían vitest dedicado, a
diferencia de guest-checkout/master-set). **+5 archivos / +25 tests** (total repo: **57 archivos / 428 tests**).
Mismo patrón que el resto del repo: `renderWithProviders` (NextIntl + TanStack Query), `vi.spyOn(api, …)`
para forzar carga/vacío/error/feature-flags, fixtures de `lib/mock/fixtures.ts`, `@/i18n/navigation`
mockeado a `<a>` + `push` espía. No se tocó lógica de producción (ningún test destapó bug).

- `src/app/[locale]/(storefront)/sellado/SealedShopView.test.tsx` (8): grid agrupado + «N disponibles»,
  call-out mailto `contacto@tcgvaultmx.com`, estados carga/vacío/error (con reintentar), y los tres
  filtros (presentación/condición/set) verificando el re-fetch filtrado.
- `src/app/[locale]/(storefront)/sellado/[inventoryItemId]/SealedDetailView.test.tsx` (5): condición
  mint vs. «detalle menor» + su nota, selector de cantidad que agrega las N piezas más baratas al
  carrito (`tcg.cart`), CTA «Ir al carrito» → `/checkout`, nota de destino recibir/bóveda, y grupo
  agotado (controles deshabilitados, carrito intacto).
- `src/components/domain/SealedVaultPanel.test.tsx` (4): modo `self` (imagen/condición/cantidad/valor +
  total + «precio pendiente»), modo `admin` por `userId`, estado vacío y banner de error.
- `src/app/[locale]/(storefront)/sellado/[inventoryItemId]/SealedRestockForm.test.tsx` (4): flag ON
  (CTA gateado por correo válido + confirmación neutra) y OFF (404 `FEATURE_DISABLED` → se oculta limpio),
  más error genérico que mantiene el formulario.
- `src/app/[locale]/(storefront)/sellado/[inventoryItemId]/SealedValueTrend.test.tsx` (4): flag ON
  (tendencia + selector de rangos con `1M` activo), serie vacía («recopilando historial»), y OFF con
  404 `FEATURE_DISABLED` / `NOT_FOUND` → contenedor vacío (oculto limpio). El warning de recharts sobre
  ancho/alto 0 en jsdom es benigno (mismo que en los demás tests de gráfica).

Gates de esta pasada: `npx tsc --noEmit` ✓ · `npx next lint` ✓ (sin warnings) · `npx vitest run` ✓
(57 archivos / 428 tests, sin regresiones).

## N-12 · Resumen de pago reactivo al destino (v1.21.4-dual-breakdown, rama `claude/pulido-checkout`)
`POST /checkout/guest/quote` ahora devuelve DOS desgloses en el mismo `200`: `breakdown` (envío
directo, con `shippingFeeCents`) y `vaultBreakdown` (destino bóveda, SIN envío). El front conmuta
el resumen «recibir ⇄ bóveda» al instante, SIN refetch (ambos vienen precomputados).
- `GuestCheckoutView` calcula `activeBreakdown = destination === 'vault' ? vaultBreakdown : breakdown`
  y lo pasa a `<AmountBreakdown>`, al total del botón «Pagar» y al `amountLabel` del `StripePaymentModal`.
  `AmountBreakdown` NO se tocó: ya oculta la línea de envío cuando `shippingFeeCents == null`.
- `shippingFeeLabel` (hint del radio «envío {amount}» + upsell «te ahorras {amount}») SIGUE saliendo de
  `breakdown.shippingFeeCents` (tarifa REAL de envío), no del vault: es cuánto se ahorra al NO enviar.
- Zonas compartidas de `frontend/src/` tocadas (serializar merge): `types/contract.ts`
  (`GuestCheckoutQuoteResponse` gana `vaultBreakdown: BreakdownDTO`, aditivo) y `lib/api.ts` (mock de
  `getGuestCheckoutQuote` devuelve `vaultBreakdown` = `computeBreakdown(subtotal)`, réplica de
  `computeCartBreakdown`; ceros sin `shippingFeeCents` para el carrito 100 % podado). `lib/mock/fixtures.ts`
  NO cambió (el quote de invitado se compone inline en `api.ts`, no desde un objeto fijo).
- Tests: se desambiguaron 2 fallos preexistentes en `GuestCheckoutView.test.tsx` (había DOS selectores de
  destino tras N-9) con `within()` acotando al formulario (`region` «DESTINO») vs. el aside
  (`complementary`); nuevo archivo `GuestCheckoutDestinationBreakdown.test.tsx` (3) cubre la reactividad.

## P-4 · Botón «Rechazar solicitud» en M5 (v1.24-buylist-request-reject, rama `claude/buylist-ordenes`)
Cierre EXPLÍCITO a nivel solicitud (`POST /admin/buylist/:id/reject`, body `{ reason?: string }`
opcional): resuelve la solicitud atorada en «Verificando» cuyos ítems ya están todos `rechazada`
pero la solicitud nunca transicionó (bug reportado por el PO). Consumo del contrato tal cual; no
mueve dinero ni envía correos.
- `src/app/[locale]/(admin)/admin/m5/M5View.tsx`: botón `destructive` «Rechazar solicitud» en la fila
  de acciones a nivel solicitud + modal de confirmación destructiva (DESIGN_SYSTEM §7.6: «rechazar
  buylist») con motivo OPCIONAL (0–500, interno, sin PII). Regla de visibilidad: se muestra sólo cuando
  la solicitud NO es terminal (`REQUEST_TERMINAL` = `pagada`/`rechazada`/`abandonada`) **y** TODOS sus
  ítems ya son `rechazada` (precondición exacta del endpoint → nunca se ofrece un botón que daría 422).
  Patrón de mutación idéntico al resto (`useMutation` + `ok()/fail()` + `refresh()` que invalida
  `['admin-buylist']`); tras éxito la solicitud cae en la pestaña «Cerradas». El `422
  REQUEST_HAS_NON_REJECTED_ITEMS` se muestra DENTRO del modal vía `useErrorMessage`/`getError`.
- `src/lib/api.ts`: `rejectBuylistRequest(id, { reason? })` (misma firma/patrón que `verifyBuylistRequest`);
  rama mock espeja el guard (idempotente si ya `rechazada`; `409 CONFLICT` sobre `pagada`/`abandonada`;
  `422 REQUEST_HAS_NON_REJECTED_ITEMS` con `details.nonRejectedItemStatuses` si queda ítem vivo).
- i18n (`messages/{es,en}.json`): `admin.m5.rejectRequest` / `rejectRequestTitle` /
  `rejectRequestConsequence` / `rejectRequestReasonLabel` / `rejectRequestReasonHint` /
  `rejectRequestConfirm`, `admin.m5.feedback.requestRejected`, y `error.REQUEST_HAS_NON_REJECTED_ITEMS`
  («quedan ítems sin rechazar»).
- Tests: `M5View.test.tsx` (+3: aparece y dispara el cierre; se oculta con ítems mixtos; 422 dentro del
  modal). Gates para archivos tocados: `npx vitest run M5View` ✓ (21/21) · `npx tsc --noEmit` ✓ ·
  `npx next lint` ✓ (sin warnings).

## P-5 · Paginación server-side + filtros en M5 «Cerradas» y M3 (v1.25-buylist-orders-pagination, rama `claude/buylist-ordenes`)
Decisión del PO: **paginar + filtrar en el servidor** (NO archivar). Contrato ADITIVO consumido tal
cual: params opcionales `q`, `from`, `to`, `minCents`, `maxCents`, `page`, `pageSize` (25/página,
recientes primero) en `GET /admin/buylist` (§M5, `status` acepta CSV) y `GET /admin/orders` (§M3);
respuesta `{ data, page, pageSize, total }`. Omitir params = comportamiento de HOY.

**Capa API (`src/lib/api.ts`):**
- `getAdminBuylist(filters?: AdminBuylistFilters)` y `getAdminOrders(filters?: AdminOrdersFilters)`
  pasan a **aceptar un objeto de params opcional** y devuelven el envoltorio `Paginated<…>` completo
  (antes retornaban `AdminBuylistDTO[]`/`AdminOrderDTO[]`; ahora las vistas leen `.data`). Serializan a
  query string vía `apiRequest` (que ya **omite** `undefined`/`''`, así no se envían params ausentes).
  `AdminBuylistFilters.status` acepta CSV (`'pagada,rechazada,abandonada'`). Ramas mock espejan los
  filtros v1.25 en memoria (status CSV → `IN`, `q` sobre folio/vendedor·folio/comprador, `from`/`to`
  sobre `createdAt`, `minCents`/`maxCents` sobre `quotedTotalCents`·`totalCents`); el **orden**
  (`createdAt desc`) lo aplica el server, el mock respeta el orden de fixtures (no re-ordena) para no
  romper los tests que dependen de él.
- **Hallazgo MENOR QA de P-4 (tipo de `rejectBuylistRequest`):** verificado — el retorno ya es
  `AdminBuylistDTO`, que **es** el tipo del DETALLE de `GET /admin/buylist/:id` en este front (mismo
  shape con `id`/`userId`/`seller`/`items`, idéntico a lo que devuelven `receive`/`verify`/`paySpei` y
  cada fila de `getAdminBuylist`). El DTO de **cliente** `SellRequestDTO` (`sellRequestId`/`ineRequired`,
  sin `seller`) sería **incorrecto** para un endpoint de back-office. Se dejó el tipo como está y se
  documentó la alineación en el docstring de la función (no había regresión que corregir).

**M5 «Cerradas» (`M5View.tsx`):** migrada a server-side siguiendo el patrón de «Rechazadas». Query
dedicada `['admin-buylist-closed', page, q, from, to, min, max]` → `getAdminBuylist({ status:
'pagada,rechazada,abandonada', page, pageSize: 25, q, from, to, minCents, maxCents })`, `enabled` solo
al abrir la pestaña. «Cerradas» y «Rechazadas» pasan a ser **botones transversales** aparte de las
etapas operativas (`M5_OP_TABS` = por_recibir/verificando/por_pagar, que **mantienen** su filtrado
client-side sobre su fetch). El buscador global existente alimenta `q` server-side cuando la activa es
«Cerradas»; controles de filtro de fecha (`from`/`to`) y monto (`minCents`/`maxCents` vía `pesosToCents`
pesos↔centavos) + paginación (prev/next/pageInfo). Conteo de la pestaña = `closedQuery.data.total` (no
se deriva ya del fetch completo, como «Rechazadas»); las otras pestañas conservan su conteo client-side.
Lista read-only (etapa terminal, sin acciones): folio + StatusBadge + vendedor (enlace M6) + fecha +
cotizado/aprobado + resumen de ítems.

**M3 Órdenes (`M3View.tsx`):** UI server-side nueva (antes DataTable sobre TODO, sin buscador). Query
`['admin-orders', page, q, from, to, min, max]` → `getAdminOrders({ page, pageSize: 25, q, from, to,
minCents, maxCents })`. Buscador `q` (folio/orderNumber + comprador; `q` server-side cubre usuario/
comprador por contrato), filtros de fecha y monto (sobre `totalCents`), paginación (prev/next/pageInfo),
estados carga/error/**vacío** (`EmptyState`). Reusa `Input`/`DataTable`/`Button`. La acción de
**reembolso** se preserva intacta (invalida `['admin-orders']`, que sigue casando por prefijo).

**i18n (`messages/{es,en}.json`, sin duplicar):** `admin.m5.filters.{dateFrom,dateTo,minAmount,
maxAmount}` y `admin.m5.closed.{empty,prev,next,pageInfo}`; `admin.m3.{searchLabel,searchPlaceholder,
empty,prev,next,pageInfo}` y `admin.m3.filters.{dateFrom,dateTo,minAmount,maxAmount}`.

- Tests: `M5View.test.tsx` (+4: «Cerradas» dispara la query con `status` CSV + `pageSize` 25; el
  buscador global alimenta `q`; filtros fecha/monto en params; paginación cambia de página) y los 3
  tests de P-4 actualizados al nuevo shape `Paginated`. `M3View.test.tsx` (+3: buscador/fecha/monto en
  params; paginación; estado vacío). Resultado real: `npx vitest run M5View M3View` → **31/31 ✓** ·
  `npx tsc --noEmit` → **✓ (exit 0)** · `eslint` de archivos tocados → **✓ (exit 0)**.
- **Solicitud al arquitecto:** ninguna — el contrato v1.25 cubre todo lo consumido. (Nota menor: si en el
  futuro se quiere un tipo de detalle distinto del de lista para `GET /admin/buylist/:id` con `closedAt`/
  `clabeMasked`, hoy no se consumen en el front y `AdminBuylistDTO` basta.)

### P-5 · pulido no bloqueante del techlead (2026-08-20)

Dos hallazgos baratos aplicados sobre el delta P-5 (el resto queda como deuda FE-35/FE-36 en `TECH_DEBT.md`).

- **Debounce de los inputs de filtro (faltaba; era un fetch por pulsación).** Hook nuevo y tipado
  `frontend/src/hooks/useDebouncedValue.ts` (`useDebouncedValue<T>(value, delayMs = 300)`; `setTimeout` +
  cleanup). Patrón: el **estado del input se actualiza inmediato** (UX responsiva) y **sólo el valor
  DEBOUNCED entra al `queryKey`/params** de la query server-side. No existía `useDebounce`/`useDebouncedValue`
  previo (los `hooks/` sólo tenían `useResendVerification`/`useSellRequirements`), por eso se creó.
  - **M3 (`M3View.tsx`):** debounce sobre `search` (`q`) y los montos `minPesos`/`maxPesos`; las fechas
    (`type=date`) siguen inmediatas (cambian de golpe).
  - **M5 (`M5View.tsx`):** debounce sobre lo que dispara RED de «Cerradas» — el buscador global (`closedQ`)
    y los montos min/max. El **filtrado client-side de las pestañas operativas** (por_recibir/verificando/
    por_pagar) **conserva el `search` inmediato** (no toca red), como pedía el techlead.
- **Fidelidad del mock de `getAdminOrders` (`lib/api.ts`, rama `config.useMocks`).** El filtro `q` del mock
  hacía `o.id.includes(q) || o.userId.includes(q)`; el backend real busca sobre `orderNumber` +
  `guestEmail` + `userId` **(exacto)** + `user.name`/`user.email`. Se alineó el mock a esos campos (folio
  del fixture = `id` como análogo de `orderNumber`, parcial; `guestEmail`/`user.name`/`user.email`
  parciales y defensivos por si el fixture/join los aporta; `userId` **igualdad exacta**, ya no `includes`)
  para no dar falsos verdes en tests de UI. La **ruta real no se tocó** (serializa params y delega en el
  server). El mock de `getAdminBuylist` **ya** filtraba sobre `id` + `seller.name`/`seller.email`
  (= `user.name`/`user.email` del contrato) → ya fiel, sin cambios.
- **Semántica de fechas `from`/`to`:** sin cambios en el front — se sigue enviando el date-only tal cual del
  `<input type=date>`; el ajuste de "fin de día inclusivo" para `to` lo hace el BACKEND en su parseo.
- **Tests:** las suites usan `waitFor` tras cambiar inputs (polling hasta 1000ms por defecto), que tolera el
  debounce de ~300ms con timers reales; el único test que verifica sincronía (filtrado client-side operativo
  de M5, «el buscador filtra por folio/usuario») sigue sobre el valor inmediato, así que no requirió fake
  timers ni cambios.

### Stream A v1.27 · P-15 (mercado por variante) + P-12 (sync completo por set) — 2026-08-21

Implementación frontend de la spec **v1.27-stream-a** (`API_CONTRACT.md` Changelog v1.27, `ARCHITECTURE.md` §4.25b/§4.25c). Sin backend vivo: validado con types + fixtures + tests de componente.

- **P-15 — precio de mercado POR VARIANTE en el binder Master Set.**
  - `types/contract.ts`: `MasterSetVariantDTO += marketReferenceMxnCents?: number | null` y
    `capturedDate?: string | null` (decoración de frescura, presente solo con precio). El campo de
    CELDA `MasterSetCardCellDTO.marketReferenceMxnCents` queda comentado **DEPRECATED v1.27**
    (espejo de `variants[0]`, retiro en la siguiente rev).
  - `MasterSetBinder.tsx` (`BinderTile`): lee `variant.marketReferenceMxnCents`. Semántica del
    fallback: `undefined` (backend rezagado que aún no emite el campo) → cae al campo de celda
    deprecado (retrocompat SOLO durante la ventana de deploy); `null` explícito → "—" honesto
    (pending, NUNCA $0). Ese era el único lector del campo de celda en `src/` (verificado por grep).
  - Fixtures (`lib/mock/fixtures.ts`): helper nuevo `mockMarketReferenceForVariant(cardId, finish)`
    que deriva precios DISTINTOS por acabado (base ×1 / reverse ×1.25 / holo ×1.6 / 1ª ed ×2.5) para
    demostrar el fix; `variantsForCell` puebla variante + capturedDate; la celda emite el espejo
    deprecado `variants[0]` (igual que el backend). NOTA mock-only: `mockReferenceForFinish` (quote
    de buylist/valuación) sigue plano por carta para no tocar los tests del cotizador — divergencia
    solo de fixtures, sin efecto de contrato.
  - Tests (`MasterSet.test.tsx`): Normal ≠ Reverse ≠ Holofoil con montos distintos; null → "—"
    (money-safe); test explícito de retrocompat (variante sin campo → lee celda).
- **P-12 — «Sync completo» por set en M2.**
  - `lib/api.ts`: `syncCatalog` acepta y manda `force?: boolean` (body pass-through).
  - `M2View.tsx`: segundo botón por fila («Sync completo», aria-label con el nombre del set) que
    encadena `syncCatalog({setId, force:true})` → al éxito `triggerPriceIngest({setId})`. Feedback
    HONESTO por fase (banner fase 1/2 y 2/2, éxito solo si el ingest encoló, warning explícito si el
    single-flight NO encoló, error diferenciado por fase; el ingest NO se dispara si falla la fase de
    cartas). Reusa la mecánica N-14 (`justDispatched` + poll de `price-sync-status`) y entra en
    `catalogBusy` (keep-alive). Las dos acciones por-set se serializan entre sí.
  - Copy corregido (es/en): `catalog.syncAllHint` y `syncAllForceConfirmBody` ya NO dicen que el
    re-sync forzado «repuebla precios» (falso desde v1.14/§4.15g) — dicen metadata + cartas +
    variantes/acabados y apuntan a «Actualizar precios ahora» / «Sync completo». Llaves nuevas
    `admin.m2.catalog.fullSync*` en ambos locales.
  - Test nuevo `M2View.test.tsx`: encadenamiento con orden verificado, single-flight honesto y
    corte de cadena en fallo de fase 1.
- **Resultado de checks:** `tsc --noEmit` ✓ · `next lint` ✓ · `vitest run` **438/438 ✓** (suite completa).
- **Solicitud al arquitecto:** ninguna — el contrato v1.27 cubre todo lo consumido.

## Stream B «Inventario M1 operable» (v1.28 · P-17/P-18/P-19/P-20/P-22/P-24/P-25) — rama `claude/backend-e2e-payment-fixtures-77mo4t` (2026-08-21)

Frontend completo del Stream B según `ARCHITECTURE.md §4.26` (a–j), `API_CONTRACT.md` v1.28 y
`DESIGN_SYSTEM.md §16`. Implementado CONTRA EL CONTRATO con mocks (`src/lib/mock/fixtures.ts`,
sección v1.28) mientras el backend aterriza sus fases; en modo real (`NEXT_PUBLIC_USE_MOCKS=false`)
todas las llamadas golpean los endpoints v1.28 tal cual el contrato.

### P-17 · M1 reorganizado (`admin/m1/M1View.tsx`)
- Pestañas **Master Set (default) · Sellado · Gradeadas**; la pestaña «Piezas» desaparece y sus
  capacidades (folio, estado, precio manual por pieza, detalle/historial, publicar/despublicar,
  merma) viven ÍNTEGRAS en el **drill-down por variante** (`VariantDrawer.tsx`): sheet lateral
  480px con header (mini + `RAW · NM · <ACABADO>` + FinishMark), CTA fijo «Alta rápida», sección
  «Precios» colapsable (abierta para super_admin) y «Piezas (N)» con selección múltiple
  (`bulk-publish` con `repriceFresh`), copiar folio/cert, edición inline de `listPriceCents`
  (PATCH) y merma (`POST /admin/inventory/adjustments`, nota obligatoria, modal destructivo).
- **Pestaña activa en la URL** (`?tab=`) vía `history.replaceState` (sin `next/navigation`:
  evita re-montar la vista y simplifica los tests).
- **Buscador por folio persistente** en el header (las 3 pestañas): resuelve con
  `GET /admin/inventory/items?q=` y abre el drawer de la variante dueña con la fila resaltada;
  folio inexistente = mensaje inline (`admin.inventory.folioSearch.notFound`), no toast.
- El alta masiva P-5 se conserva SIN cambios como **«Alta por lote»** (extraída a
  `AddItemModal.tsx`, mismo namespace i18n `admin.m1.*`, misma batchKey idempotente y error
  anclado P-4). El botón «Ubicaciones» se conservó en la toolbar (§16.1 no lo menciona, pero
  «no se pierde ninguna acción» — gestor de ubicaciones sigue siendo necesario para mover piezas).
- `MasterSetPanel`/`MasterSetBinder` (zona compartida, lock Stream B) ganan `onOpenVariant` y
  `onSetOpened` OPCIONALES: sin ellos el comportamiento previo (CellDrawer por carta) queda
  intacto — cotizador, Mi bóveda y bóvedas admin no cambian.

### P-18 · Consola de tres precios (`components/master-set/VariantPriceConsole.tsx`)
- **Compacto en la teja** (`VariantPricingCompact`, solo si `variant.pricing` viene — es decir
  solo scope `platform`): MERCADO/COMPRA/VENTA mono con sufijos `·M` (override) y `·B` (bounty,
  bermellón), `—` para pendiente (nunca $0), `aria-label` por renglón. Sustituye al renglón único
  P-15 en M1; en bóvedas de cliente (sin `pricing`) el renglón P-15 sigue.
- **Consola completa en el drawer**: sugerido/override/efectivo + fuente en versalitas
  (REGLA/MANUAL/BOUNTY/PENDIENTE), UN submit para ambas caras
  (`PUT /admin/pricing/variant-controls/:cardId/:finish` — vacío = null explícito = limpiar),
  «Restablecer a regla» por cara (PUT solo con esa cara en null), validación `> 0`, error de
  servidor anclado (P-4), «Fijar mercado» inline cuando la referencia está pendiente (reusa
  `POST /admin/pricing/override`). Edición solo super_admin (front esconde; guard impone);
  vault_operator ve texto plano.
- **Bounty (P-22a)** en la misma consola (solo raw + super_admin): switch con estado textual,
  precio explícito (error espejo `BOUNTY_PRICE_REQUIRED`), premium vs regla, objetivo opcional
  con barra de progreso, `BOUNTY COMPLETADO · fecha`, copy de apagado con historial. El error
  `BOUNTY_BELOW_RULE` interpola el sugerido vigente.

### P-19 · Alta rápida (`admin/m1/QuickAdd.tsx`) + Publicar todo (`PublishAllDialog.tsx`)
- QuickAdd: SOLO stepper de cantidad + tarjetas-radio **Comprar** (input prellenado con
  `pricing.buy.effectiveCents`, editable, helper según fuente; vacío si no hay sugerido) /
  **Aportación** (valor de mercado mostrado, NO editable, `acquisitionPct: 100` explícito;
  referencia nula ⇒ tarjeta deshabilitada con pill `PRECIO PENDIENTE` — y el 422 `PRICE_PENDING`
  del server queda como respaldo anclado sticky `role=alert`, lección P-4). Sin acabado (viene de
  la casilla), sin ubicación. batchKey por intento (rota tras éxito; retry de red = replay).
- La MISMA `QuickAddSection` la usa la pestaña Sellado con `sealedMarketRef` como referencia.
- «Publicar todo…»: modal con alcance (todo / solo este set / solo sellado) + notas de dinero,
  `POST /admin/inventory/publish-all` con batchKey idempotente, y **resultado honesto de 4
  renglones** (publicadas / ya listadas / sin precio→link a `/admin/m2?context=inventory` /
  fallidas con detalle por folio, nota de capado a 200 y nota de replay). Sin dry-run (no existe
  en contrato §16.11.1).

### P-24 / P-25 / P-20
- `InventoryValueCards.tsx`: 4 StatCards del breakdown de `GET /admin/finance/inventory-value`;
  costo en segunda línea y «N piezas sin precio» como enlace a M2 (exclusión visible). SOLO
  super_admin: para vault_operator la fila se OMITE por completo. `breakdown` es opcional en el
  tipo espejo (resiliencia mientras el backend lo aterriza: sin él solo se pinta el total).
- `SealedTab.tsx`: índice `GET /admin/inventory/sealed-sets` (DataTable con piezas/listadas/
  valor/badge `N SIN MAPEO`) → detalle por set con grupos §4.23 (pills subtipo+condición, conteos,
  `sealedMarketRef` o `SIN PRECIO DE MERCADO`, costo super_admin) con Alta rápida / Ver piezas
  (drawer `productType=sealed`, SIN consola P-18) / Publicar (bulk de folios in_stock del grupo,
  identidad recortada en cliente). Enlace «Cola de no mapeados (N)» solo super_admin.
- `GradedTab.tsx`: `GET /admin/inventory/graded` agregado por carta×empresa×grado, chip de grado
  estilo GradedCertChip SIN cert, valor por grado manual con sufijo `·M` o `SIN VALOR` +
  «Fijar valor…» inline (`POST /admin/pricing/override` con `productType:"graded"` y
  `gradeKey:"graded:<company>:<grade>"`). `AddGradedModal.tsx`: empresa+grado+cert+precio de
  compra → `POST /admin/inventory/items` (qty 1); accesible desde la pestaña y desde el
  VariantDrawer («Agregar gradeada…»). Drill-down muestra `certNumber` completo copiable.

### §16.6 FinishMark + P-22 Top Bounties
- `components/domain/FinishMark.tsx` (compartido; el Stream C lo reusa tal cual): `FinishBand`
  (3px, aria-hidden; reverse = ÚNICO gradiente permitido `#9A6C57→#B44B3A`; holos = tinta;
  normal = sin banda) + etiqueta mono `NORMAL/REVERSE/HOLO/1ED HOLO` (claves
  `finish.{normal,reverse,holo,firstEdHolo}`, no localizadas; `aria-label` legible sí). La banda
  se aplica en las tejas del binder (todas las vistas del binder) y en `BountyCard`; la etiqueta
  del acabado que ya pintaba el tile cubre el canal de texto.
- `components/domain/TopBountiesShelf.tsx` + `BountyCard`: sección «SE BUSCA / Top Bounties»
  ARRIBA de `/buylist` (antes del selector de set), `GET /buylist/bounties`, primeras 12, scroll
  horizontal móvil / grid 4-col lg. Chip `☩ BOUNTY` sobre scrim de tinta, precio héroe en verde
  («Pagamos»), `QUEDAN N` solo con objetivo real; vacía o en error NO se renderiza. CTA
  **«Cotizar esta carta»**: cotiza esa (carta, acabado) server-side vía `POST /buylist/quote/batch`
  (SEC-A1 — nunca el monto del card) y la agrega al carrito de venta con el carrito abierto
  (= «cotizador precargado» de §16.11.2, resuelto sin estado por URL).
- Badge `BOUNTY` (mono bermellón + crosshair decorativo) en la teja del binder cuando
  `pricing.bounty.enabled`.

### Zona compartida (lock §4.26i) y tipos espejo
- `types/contract.ts`: `VariantPricingDTO`/`VariantControls*`, `PublishAll*`, `SealedSet*`,
  `GradedInventory*`, `InventoryValueBucketDTO`+`breakdown?`, `PublicBounty*`;
  `MasterSetVariantDTO.pricing?`; `BatchInventoryItemInput.acquisitionCostCents` (documentado por
  v1.28 §M1) e `InventoryItemDTO.sealedCondition` (espejo v1.23 que faltaba, lo usa la identidad
  de grupo sellado). `lib/api.ts`: `putVariantControls`, `publishAllInventory`,
  `getSealedInventorySets/Set`, `getGradedInventory`, `getPublicBounties`, filtros
  `finish`/`productType` en `getAdminInventory`, `acquisitionCostCents` en el alta. Las ramas
  mock replican validaciones del contrato (422 `BOUNTY_PRICE_REQUIRED`/`BOUNTY_BELOW_RULE`/
  `FINISH_NOT_AVAILABLE`, PRICE_PENDING por línea, idempotencia por batchKey).

### i18n y tests
- Claves §16.10 en `es`/`en` (paridad verificada por `i18n-parity.test.ts`):
  `admin.inventory.*`, `admin.pricing.console.*` (fuente `source.manual` para override, según
  spec), `admin.quickAdd.*`, `admin.publishAll.*`, `admin.drawer.*`, `admin.bounty.*`,
  `buylist.bounties.*`, `finish.{reverse,holo,firstEdHolo}`, `error.BOUNTY_*`,
  `masterSet.bountyBadge`.
- Vitest: 512 pruebas verdes (66 archivos). Nuevas: `FinishMark.test` (doble canal),
  `VariantPriceConsole.test` (compacto ·M/·B/—, guardar ambas caras, restablecer=null,
  validaciones, bounty, lectura operador), `QuickAdd.test` (prellenado, aportación pct 100,
  bloqueo PRECIO PENDIENTE, 422 anclado), `PublishAllDialog.test` (resultado honesto, replay,
  fallos por folio), `TopBountiesShelf.test` (oculta vacía/error, QUEDAN N honesto),
  `VariantDrawer.test` (piezas por variante, bulk-publish honesto, PATCH precio, certs).
  `M1View.test` REESCRITO al layout P-17 conservando la cobertura del alta P-5/P-4 (trigger
  «Alta por lote») y moviendo detalle/merma al drawer. `MasterSet.test` y `BuylistView.test`
  ajustados mínimamente (el «—» ahora aparece por cara; «Pikachu ex» también vive en la vitrina).
- Playwright: `e2e/inventory-stream-b.spec.ts` (folio→drill-down, pestañas Sellado/Gradeadas,
  Top Bounties) + `e2e/admin.spec.ts` actualizado a P-17 — verdes en modo mock. **Nota QA:**
  hay 13 fallos E2E PRE-EXISTENTES en la rama (verificado contra un worktree de HEAD sin mis
  cambios): `buylist.spec.ts` (8: describen el grid plano raw pre-v1.21 — el raw hoy es el binder
  quoter y no monta «Buscar carta»), `master-set.spec.ts:88` (asume 2 imágenes por celda,
  pre-N-16), `catalog.spec.ts:11`, `i18n-locale.spec.ts:10` y `guest-checkout.spec.ts:67/80`.
  No los toqué (drift previo, no es del stream); quedan para su dueño/QA.

### Desviaciones conscientes y solicitudes al arquitecto
1. **Kebab por fila → iconos directos** en el drawer (§16.4.4): no existe componente Menu en el
   DS; mismas 3 acciones (detalle/publicar·despublicar/merma) como icon-buttons con `aria-label`.
   «Agregar gradeada…» vive como acción secundaria DEL DRAWER (a un clic de la teja) en vez de
   kebab en la teja (la teja es un solo botón; anidar menús rompería la semántica).
2. **Cola de no-mapeados**: el enlace apunta a `/admin/m2` (la vista dedicada
   `GET /admin/pricing/sealed/unmapped` no existe aún en el frontend de M2 — es del stream de
   precios). *Solicitud:* confirmar dueño de esa vista.
3. **`SealedInventoryGroupDTO` sin imagen**: §16.8 pide «imagen ancla» pero el DTO no trae
   `imageSmallUrl`; se pinta placeholder (icono Package). *Solicitud al arquitecto:* campo
   `imageSmallUrl?` aditivo en el DTO del grupo si se quiere la imagen real.
4. **Dry-run de publish-all**: no existe en contrato; la confirmación describe alcance/reglas y
   la honestidad va en el resultado (ya registrado en §16.11.1).
5. **`summary.selected` de publish-all**: el contrato no fija si incluye las ya-listadas; el
   front solo pinta los 4 renglones del diseño (no usa `selected`), así que cualquier semántica
   backend es compatible.

## Ronda de corrección Stream B (gate techlead, 2026-08-21)

Rechazo acotado del techlead sobre M1/consola; los tres MAYORES y los menores quedan corregidos:

- **M-1 (consola stale tras guardar):** `VariantPriceConsole` ahora mantiene el pricing
  RESUELTO en estado local — sembrado por el prop y actualizado con
  `VariantControlsResponse.pricing` de cada write (efectivo/fuente/bounty nuevos sin reabrir;
  también re-siembra los inputs y el estado del bounty). El drawer ya no descarta la respuesta:
  pasa `onChanged` para refrescar agregados del binder. Tests en `VariantPriceConsole.test`
  («M-1: tras guardar…») y `VariantDrawer.test`.
- **M-2 («Publicar grupo» sellado truncaba a 100):** el mutation pagina server-side hasta
  agotar la carta (pageSize máx 100 del contrato) y trocea el bulk-publish al cap de 200 líneas
  con sufijo determinista por trozo (`<key>-0`, `<key>-1`, …) sobre una clave base en `useRef`
  REAL (el objeto literal por render que rompía la idempotencia quedó eliminado); la clave solo
  se limpia al éxito, así el reintento replayea idempotente. El toast reporta el agregado real.
  En el drawer, la lista de piezas declara el truncado con el conteo real
  (`admin.drawer.truncated`: «Mostrando {shown} de {total}…»). Tests nuevos en
  `SealedTab.test.tsx` (paginado+troceo, reuse de batchKey en reintento, grupo sin elegibles).
- **M-3 («Fijar mercado» fallaba en silencio y fabricaba respuesta):** `fixMarket` ahora
  comparte el banner de error ANCLADO del patrón P-4 (mismo `errorRef` que `save`), y su éxito
  dispara `onChanged()` (refetch real del dueño) en vez de fabricar un
  `VariantControlsResponse` falso para reusar `onSaved`. `onSaved(res)` queda reservado al
  payload íntegro del PUT variant-controls. Se endureció además el botón «Fijar» (exige monto
  > 0, no solo no-vacío). Tests del caso de error y del éxito (onChanged sí, onSaved no).
- **Menor `gradeKey`:** `VariantPriceConsoleProps` es ahora una unión discriminada —
  `productType='graded'` EXIGE `gradeKey` a nivel de tipo (fuera el default mágico
  `graded:PSA:10`); raw usa la clave canónica del contrato `raw:NM`. El drawer solo monta la
  consola graded cuando hay `gradeInfo`.
- **MENOR-1 QA:** `BuylistRuleApplied.source` ampliado a `"rule"|"fallback"|"bounty"|"override"`
  (contrato v1.28 §6; ningún consumidor hacía switch exhaustivo — cambio aditivo seguro).
- **MENOR-2 QA:** la nota de E2E preexistentes decía «12»; son 13 (corregido arriba).
- **SB-D8:** `FinishBand` deja los hex hardcodeados y usa tokens vivos con fallback
  (`var(--color-neutral-warm|--color-accent|--color-ink, <hex del DS §16.6>)`), mismo criterio
  que `PortfolioTrendChart`, antes de que el Stream C esparza el patrón.

Deuda pendiente de registrar en `docs/TECH_DEBT.md` cuando el backend suelte el archivo (esta
ronda no lo toca): (1) heading «Piezas (N)» del drawer cuenta las filas RECORTADAS en cliente,
no el total server-side cuando hay truncado (el indicador nuevo lo mitiga); (2) el troceo >200
del publish de grupo no es transaccional entre trozos (un fallo intermedio publica parcial; el
reintento con la misma clave lo repara por replay).

## P-21 · Rebrand TCG HUNT (DESIGN_SYSTEM §17 v1.7/v1.7.1) — rama `claude/backend-e2e-payment-fixtures-77mo4t` (2026-08-21)

La marca visible pasa de «TCG VAULT MX» a **TCG HUNT** (tcghunt.mx). Sin rediseño: la dirección
papel/tinta 5a queda intacta; cambia el acento y entra el logo de mira.

**Tokens (§17.2):** `--color-accent/warning/danger/focus-ring` cambian de VALOR (`#B44B3A` →
`#B31217`, bermellón retirado — mismo nombre de token, cero migración de consumidores). Nuevos
`--hunt-*` (red, wine, wine-up, red-hover, red-up, red-deep, tint) de uso restringido a marca.
`FinishBand` (banda reverse) y `PortfolioTrendChart` heredan por token — solo se alinearon sus
FALLBACKS hex al DS. Botones accent/destructive: hover pasa de `brightness-95` a
`--hunt-red-hover` (#8F0E12, 8.3:1).

**Fuente de marca (§17.1e):** Montserrat 700 vía `next/font/google` como `--font-brand` en
`[locale]/layout.tsx` (self-hosted, junto a serif/sans/mono); clase `font-brand` en tailwind con
fallback `var(--font-sans)` (Archivo). Exclusiva del wordmark: no entra en la escala de §3.

**`<LogoTcgHunt />`** (`components/domain/LogoTcgHunt.tsx`, geometría v1.7.1 — retícula con cruz
segmentada, anillos en 4 arcos con gaps cardinales, punto aislado, wordmark dominante):
variantes `lockup` / `lockup-dark` / `mark` / `mark-dark` / `micro` (+ export `HuntMarkMicro`).
Ids de gradiente por instancia con `useId` saneado (varios montajes sin ids duplicados).
`decorative` → `aria-hidden` (el enlace porta `brand.homeAria`). En el DOM el SVG usa
`var(--font-brand), Montserrat, Archivo…` (el nombre de familia de next/font va hasheado: la
variable es la única referencia fiable).

**Dónde quedó la marca:** topbar storefront (≥lg mira 28 + wordmark tinta; <lg solo mira 28,
táctil 44px), sidebar admin (mark-dark 28 + wordmark papel; «Back-office» sigue en el
AdminTopbar), login/auth (lockup-dark en el hero de tinta + mark-dark en cabecera), `/pedido`
(mark 28 + wordmark tinta), footer legal («TCG HUNT · tcghunt.mx · © 2026 [razón social]» con
`footer.legalEntity` placeholder), metadata (`TCG HUNT — {página}`, `og:site_name`), favicon
(`app/icon.svg` + `icon.png` 32 glifo micro; `apple-icon.png` 180 solo-mira sobre papel, margen
12%), badge BOUNTY del shelf y del binder (glifo micro oficial en vez del crosshair de lucide).
i18n: `common.appName` = «TCG HUNT», nuevas `brand.name/domain/homeAria` y `footer.legalEntity`;
`legal.intro` y `sellado.buylistCallout.title` renombrados (es/en).

**Pendientes / decisiones:**
- **OG image PNG 1200×630:** el layout está listo en `public/branding/og-tcg-hunt.svg`, pero el
  export a PNG exige la fuente RESUELTA (Montserrat no está instalada en este entorno; un SVG
  con `<text>` fuera del DOM no la garantiza, §17.1e). Hasta el export, `openGraph` va sin
  `images`. Ruta sugerida: exportar cuando llegue el arte original o generar el raster en CI.
- **Cotejo con el PNG original del humano** (§17.5.1): cuando lo suba a
  `frontend/public/branding/`, comparar métricas finas y sacar wordmark en paths (outline).
- **Correos `@tcgvaultmx.com` NO tocados** (soporte/facturación/contacto en i18n, fixtures y
  fallback del contrato): son buzones operativos reales; migrarlos a `@tcghunt.mx` requiere el
  dominio de correo (devops/humano) y el fallback `evidenceContact` viene del contrato
  (arquitecto). Igual los nombres de archivo CSV `tcgvault_*` de M7/M9 (artefacto técnico,
  §17.4: el nombre interno no cambia).
- Los E2E preexistentes que asertaban copy de marca vía `t()` siguen verdes (leen messages).

Verificación: `tsc --noEmit` limpio; lint limpio; vitest 526/526 (520 previos + 6 del logo);
Playwright `inventory-stream-b.spec.ts` + `admin.spec.ts` 13/13.

## Stream C · Cotizador v2 (P-14 + P-16, DESIGN_SYSTEM §18 v1.8) — 2026-08-21

El cotizador público (`/buylist`) se redistribuye según §18: el carrito lateral fijo de 360px
desaparece y se convierte en drawer flotante disparado por un FAB con contador; la grilla
recupera todo el ancho con la MISMA densidad del binder M1; el distintivo de variante (P-14)
llega al cotizador reutilizando `FinishMark`/`FinishBand` §16.6 TAL CUAL (cero forks). Sin
cambio de contrato (§18.11.1): todo el dato ya existía.

### Componentes NUEVOS
- **`components/domain/SellCartFab.tsx`** (§18.4a): botón `fixed` abajo-derecha (56×56, radio 0,
  sin sombra, tinta/papel, borde strong), icono `shopping-cart` 20px; badge contador cuadrado en
  accent (`#B31217` por token) mono `tabular-nums`, cap visual `99+`, **omitido con carrito
  vacío** (el FAB permanece: da acceso a los requisitos de venta). `aria-haspopup="dialog"` +
  `aria-expanded` + `aria-label` dinámico (`buylist.cartFab.ariaWithCount/ariaEmpty`); el badge
  es `aria-hidden` (la cifra viaja en el label). SIN animación al agregar (§17.3); el anuncio lo
  hace el `role="status"` existente (`addedLine`). z-40 (bajo el drawer z-50, sobre el sticky z-10).
- **`components/domain/SellCartDrawer.tsx`** (§18.4b): contenedor que ENVUELVE el contenido del
  antiguo `<aside>` (no lo reescribe; recibe `children`). `≥lg` sheet derecho 400px
  (min 360/max 440, `border-l border-border-strong`, alto completo); `<lg` bottom sheet ~92vh
  (patrón `VariantDrawer` §16.4). `role="dialog"` + `aria-modal` + **focus trap propio**
  (Tab/Shift+Tab ciclan; el `Modal` base no trae trap) + Esc cierra + clic en overlay cierra +
  botón cerrar 44px; al cerrar el foco **regresa al FAB** (`returnFocusRef`). Encabezado fijo
  (eyebrow CARRITO DE VENTA + conteo + cerrar primero en el orden de foco); contenido scrolleable.

### Modificados (sin cambiar API pública)
- **`BuylistView.tsx`**: layout de UNA columna (fuera el `lg:grid-cols-[1fr_360px]` y el toggle
  textual `cartHide/cartShow`); `<main>` con `pb-24` (el FAB no tapa la última fila); FAB al
  final del contenido (orden de foco §18.8, sin tabindex positivos); abrir el modal de solicitud
  CIERRA el drawer (un solo focus trap activo — criterio permitido por §18.4b); el CTA de
  `BountyCard` sigue siendo la ÚNICA vía que abre el drawer al agregar; grid plano de
  graded/sealed alineado a la escala del binder (`2→3(sm)→4(lg)→5(xl)`, retirado el `2xl:6`);
  skeletons §18.6 con la retícula final (`CardSkeleton` ×10) en la carga del grid plano; líneas
  del carrito y resumen del modal con `<FinishMark />` (banda 3px + etiqueta mono) en vez del
  texto plano del acabado.
- **`MasterSetBinder.tsx`**: `QuoterTile` gana la `FinishBand` §16.6 como primer elemento
  (idéntica a `BinderTile`; `normal` sin banda) y el precio estimado sube de 13px a
  **`text-[15px]` mono en TINTA** (el verde «Pagamos» queda exclusivo del `BountyCard` §16.7c);
  fila de filtros locales del binder **sticky en `≥lg` SOLO en modo quoter** (`top-0`, fondo
  papel, `border-b`, z-10); skeletons de carga con la retícula final (aplica a todos los modos
  del binder — misma retícula, cero costo).
- **i18n** (`messages/es,en.json`): nuevas `buylist.cartFab.{ariaWithCount,ariaEmpty}` y
  `buylist.cartDrawer.{ariaLabel,close}`; **eliminadas** `buylist.cartShow`/`cartHide` (el toggle
  ya no existe). Paridad ES/EN verde.

### Tests
- Nuevos: `SellCartFab.test.tsx` (4: vacío sin badge + aria, contador aria-hidden, cap 99+,
  expanded/click) y `SellCartDrawer.test.tsx` (5: cerrado=nada, dialog+aria+encabezado+foco
  inicial, Esc/overlay/cerrar (y no clic interno), focus trap Tab/Shift+Tab, retorno de foco al
  FAB al cerrar).
- `BuylistView.test.tsx` actualizado al drawer: helper `openCart()` (clic al FAB) antes de todo
  assert de contenido del carrito; test del toggle colapsable reescrito como FAB→drawer (drawer
  cerrado por defecto, vacío útil con requisitos, cierre regresa foco); nuevos asserts: agregar
  desde grilla NO abre el drawer, contador del FAB por PIEZAS, FinishMark en línea del carrito Y
  en resumen del modal. 41 tests del archivo en verde.
- Playwright `e2e/buylist.spec.ts`: helper `openCart(page)` inyectado en los flujos que tocaban
  el carrito lateral (selectores sin cambio: el contenido es el mismo, ahora dentro del dialog);
  smoke NUEVO §18.11.3 (teja → badge FAB sube sin abrir drawer → drawer con `finish-band`
  reverse + etiqueta → cerrar regresa foco al FAB) — verde en mock. Los **8 fallos preexistentes
  de este spec** (describen el grid plano raw pre-v1.21, fallan ANTES del carrito en
  `searchFor`) siguen igual: no se arreglaron ni se empeoraron (siguen siendo del triage
  pendiente pre-release, junto con `master-set.spec.ts:88` — verificado corriendo buylist: 8
  failed/4 passed; master-set+inventory-stream-b+admin: 1 failed (el :88 preexistente)/15 passed).

### Decisiones / desviaciones de §18 (menores, anotadas)
1. **Copy del aria del FAB:** §18.4a ejemplifica «Carrito de venta, 3 cartas»; se usó
   `{count} carta(s)` para mantener la convención SIN plural ICU del catálogo (el helper i18n de
   los E2E no resuelve ICU y `cartCount` ya usa ese estilo). Solo afecta al aria-label.
2. **Skeletons del binder en todos los modos:** §18.6 pide skeletons en el quoter; la retícula
   es compartida con M1/bóvedas, así que el `loading` del `QueryState` del binder aplica a todos
   los modos (mismo layout, sin spinner de página en ninguno).
3. **Al abrir el modal de solicitud se CIERRA el drawer** (§18.4b deja el criterio a frontend:
   «cierra o se apila… solo un focus trap activo»): cerrar es más simple y el resumen del modal
   repite las líneas con su FinishMark.
4. **`buylist.cartDrawer.ariaLabel` interpola `{count}`** («Carrito de venta (N)») tal como pide
   §18.4b; con carrito vacío queda «(0)» (el drawer vacío sigue siendo útil).
5. La idea `source:"bounty"` en el quote público (§18.11.2) NO se implementó (registrada para
   product-owner/arquitecto, no asumida).

Gates: `lint` ✓ · `typecheck` ✓ · `vitest` **536/536** (70 archivos; 526 previos + 9 nuevos de
FAB/drawer + 1 neto en BuylistView) · `next build` ✓.

## Stream C · Ronda de corrección del gate (TL-C1/C2/C3 + SC-D2) — 2026-08-21

QA aprobó; techlead rechazó con tres hallazgos mayores, cerrados en esta ronda (sin cambio de
contrato, todo en `frontend/`):

### TL-C1 · Sticky del binder tapado por el header del storefront
- **Bug:** la barra de filtros del quoter (`MasterSetBinder`, modo quoter) era `lg:sticky lg:top-0
  z-10`, pero `StorefrontHeader` es `sticky top-0 z-40` opaco (~72px) → la barra quedaba escondida
  detrás del header al scrollear.
- **Fix (indicación del techlead):** el offset sale de la **altura real** del header vía var CSS por
  layout. `StorefrontHeader` mide su propio alto (`ResizeObserver`, cubre `py-4 ↔ lg:py-[22px]`, wrap
  y menú móvil) y expone `--app-header-h` en su **padre inmediato** (el wrapper del layout del
  storefront; se limpia al desmontar). El binder usa `lg:top-[var(--app-header-h,0px)]` — fallback
  `0px` para shells que no la definan (en modos no-quoter el sticky no se activa; si el binder
  necesitara sticky bajo el AdminShell, ese shell expondría su propia var). **Nada de `top-[72px]`
  hardcodeado en el componente compartido.**
- **Tests (jsdom no pinta sticky → se asserta el mecanismo):** `StorefrontHeader.test.tsx` (la var
  queda en px en el contenedor y se limpia al desmontar) y `MasterSet.test.tsx` (la barra del quoter
  lleva `lg:top-[var(--app-header-h,0px)]` y NO `lg:top-0`).

### TL-C2 · El focus trap del drawer se desenganchaba al desmontarse el elemento enfocado
- **Bug:** el trap vivía solo en `onKeyDown` del panel; al pulsar «Quitar» en la última línea o
  «Vaciar carrito», React desmonta el botón enfocado, el foco cae a `<body>` (sin evento — la spec no
  dispara blur/focus al remover el nodo activo) y Tab se escapaba detrás del scrim con el diálogo
  abierto.
- **Fix (opción b del techlead, `SellCartDrawer.tsx`):** dos guards mientras `open`:
  (1) **`focusin` a nivel `document`** — si el foco aterriza fuera del panel (Tab escapado desde
  `<body>`, focus programático), se reenfoca el panel; (2) **re-verificación tras cada commit**
  (efecto sin deps) — cubre la caída silenciosa a `<body>` por desmonte, que no emite `focusin`. El
  trap de Tab interno queda igual. Ambos guards se desactivan con el drawer cerrado y son inocuos en
  el cierre (el ref del panel ya es null cuando el retorno de foco al FAB dispara `focusin`).
- **Tests de regresión (obligatorio del techlead):** `BuylistView.test.tsx` — enfocar «Quitar» de la
  única línea → click → el foco queda DENTRO del diálogo (ídem «Vaciar carrito»);
  `SellCartDrawer.test.tsx` — focusin fuera → reenfoque, y desmonte del hijo enfocado → foco al panel.

### TL-C3 · Extracción FE-13 de BuylistView (compromiso «sin tercer aplazamiento»)
- Extracción **mecánica, sin cambio de comportamiento**, por la costura trazada por el techlead, a la
  misma carpeta de la ruta (no a zonas compartidas):
  - **`useSellCart.ts`** (151 líneas): `CartLine`/`QuoterCardRef`/`mergeCartLine` + cantidades +
    `expandedLines` + totales derivados (`totalEstimatedCents`, `pendingCardCount`, `cartCount`,
    `requestItems`). Handlers estables (`useCallback` + setState funcional).
  - **`SellCartContents.tsx`** (274 líneas): el bloque entre `<SellCartDrawer>` y `</SellCartDrawer>`
    (requisitos → líneas → total → CTA → vaciar), con `QuoteRow` y `ruleText`. Recibe `cart`, `sellReq`
    y handlers; el submit lo delega al dueño (cerrar drawer + abrir modal, §18.4b).
  - **`MyRequestsSection.tsx`** (206 líneas): "Mis solicitudes" + respuesta al ajuste (F5). Dueña de su
    query `['sell-requests']` (la MISMA key que invalida BuylistView al crear solicitud) y de
    `respondSellRequest`.
  - `BuylistView.tsx`: 1253 → **787 líneas** (orquestador: filtros, grid graded/sealed, bulk, binder
    quoter, bounty, modal de solicitud). MasterSetBinder, flujo bulk y gating KYC **sin tocar** (solo
    movidos de sitio donde la costura lo exigía).
- **Red de seguridad:** los 41 tests conductuales de `BuylistView.test.tsx` pasan idénticos antes y
  después de la extracción (verificado en dos corridas: post-extracción 86/86 de las 4 suites tocadas;
  final 92/92 con los 6 tests nuevos de TL-C1/TL-C2).
- **Nits pagados al pasar:** `<div>` sin función alrededor de `SellRequirementsPanel` eliminado;
  indentación del bloque movido normalizada (consecuencia de la extracción); `expandedLines` se PODA al
  quitar una línea y se resetea al vaciar (antes acumulaba entradas huérfanas).
- **SC-D3 parcial:** `addFromMasterSet` ahora es `useCallback` sobre los handlers estables del hook
  (identidad estable hacia `MasterSetPanel`); el `memo` de tiles queda como deuda SC-D3 con disparador
  «lag al teclear cantidades en set grande».

### SC-D2 · E2E `buylist.spec.ts`: 8 tests muertos migrados (0 rojos de reposo)
- Los 8 casos que asumían el grid plano en raw (pre-v1.21) se migraron sin inventar cobertura falsa:
  grid plano/bulk → **graded** (helpers `selectGraded`/`searchFor`/`addGradedCard`); acabados
  raw/pendiente/KYC → **binder quoter** (`openBaseSet`/`addFromBinder`, fixtures Base Set). El smoke
  `@real vender` descubre por graded y clica la primera fila **habilitada** (fixtures holofoil-only no
  cotizan graded en mock → fila deshabilitada por-ítem, correcta). **Estado final en mock: 12 passed /
  0 failed** (antes 8 failed / 4 passed). `master-set.spec.ts` re-verificado: 2 passed (el fallo :88
  reportado en el gate ya no reproduce). Pendiente anotado en TECH_DEBT SC-D2: en real, el smoke de
  vender valida ahora la ruta graded.

### Deuda registrada (docs/TECH_DEBT.md)
- **FE-13 → RESUELTA** (esta ronda). Nuevas: **SC-D1** (cuarto shell de diálogo a mano + scrim en
  cuarta copia — NO se implementó el primitivo en este stream, por indicación del techlead), **SC-D2**
  (resuelta, con pendiente @real anotado), **SC-D3** (memo de tiles, parcialmente pagada), **SC-D4**
  (~10 ramas por modo en MasterSetBinder → objeto de capacidades cuando llegue la próxima rama).

Gates de la ronda: `lint` ✓ · `typecheck` ✓ · `vitest` **542/542** (70 archivos; 536 previos + 6
nuevos: 2 BuylistView TL-C2, 2 SellCartDrawer TL-C2, 1 StorefrontHeader TL-C1, 1 MasterSet TL-C1) ·
`next build` ✓ · Playwright `buylist.spec.ts` en mock **12/12** ✓.

## v1.29 — Productos por variante (TCGCSV) + reglas de precio de dos ejes (2026-08-22, branch `fix/variant-composition-regression`)

Implementación **frontend** del diseño v1.29 aprobado (contrato `docs/API_CONTRACT.md` v1.29;
ARCHITECTURE §4.27 «1 carta ↔ N productos» y §4.28 rareza canónica). Backend en paralelo; el
front trabaja contra el **shape del contrato** (mocks marcados). Sin cambios de contrato.

### 1. Binder Master Set + cotizador — productos SEPARADOS por variante (§4.27)
- **Tipos (`types/contract.ts`):** nuevos `CardProductDTO` (`{ productId, kind, name, finishes[],
  prices[] }`), `CardProductKind` (`set_base | deck_exclusive | promo | other`) y
  `CardProductPriceDTO` (`{ finish, marketReferenceMxnCents: number|null, capturedDate? }`). Se
  añade `separateProducts?: CardProductDTO[]` a **`MasterSetCardCellDTO`** y a **`CardDTO`** (el
  cotizador compone el binder client-side desde `GET /buylist/cards`, así que el CardDTO propaga
  los productos separados a la celda).
- **`MasterSetBinder.tsx`:** la rejilla plana ahora mezcla dos clases de teja con un tipo
  discriminado `BinderTileItem` (`variant` | `product`). Los productos `kind ∈ {deck_exclusive,
  promo}` se pintan como **su propio producto** (`SeparateProductTile`, nuevo) con su nombre, un
  distintivo de tipo de producto (badge + renglón mono) y su **propio precio por acabado** —
  **NO fusionado** en la carta base. El set base sigue mostrando sus acabados reales
  (`availableFinishes` = universo exacto TCGCSV: p. ej. energía especial → holofoil + reverse_holo,
  **2 casillas, no 3**). Money-safe: precio ausente (`marketReferenceMxnCents == null`) → **"—"`**,
  nunca `$0` inventado.
  - Los productos separados **no participan de la completitud** del set (`expected/coveredVariantCount`
    los ignoran, como el backend), coherente con «no fusionados». Tampoco entran al filtro con/sin
    huecos (no son variantes de inventario) — solo se listan con el filtro de piezas en «todos»; el
    filtro de acabado sí aplica.
  - `SeparateProductTile` es de **presentación** (no cotizable/agregable in-situ): ver salvedad al
    arquitecto abajo (el carrito/quote del cotizador está keyeado por `(cardId, finish)`, no por
    `productId`).
- **i18n:** `masterSet.productKind.{set_base,deck_exclusive,promo,other}` («Set», «Deck Exclusive»,
  «Promo», «Otro») y `masterSet.separateProductAria` en `es.json`/`en.json`. Sin texto hardcodeado.
- **`displayFinishes` DEPRECADO** por el contrato (= `availableFinishes`); el front lo sigue tolerando
  vía `@/lib/finish` (fallback), retiro en la próxima rev.

### 2. Editor de precios M2 — reglas de DOS EJES + retiro del parche INV-1 (§4.28d)
- **Contrato nuevo `PriceRuleSet { rarityRules, finishRules, fallbackPct }`** (y su análogo de venta
  `SalesPriceRuleSet`): las reglas dejan de ser un mapa plano que mezclaba rareza y acabado. Se
  separan en **eje RAREZA** (keyeado por rareza **canónica** de la carta) y **eje ACABADO** (keyeado
  por el enum `Finish`: `reverse_holo`, `holofoil`, `first_edition_holofoil`; `normal` no lleva
  finish-rule → usa la rareza).
- **`M2View.tsx`:** las secciones 4 (buylist) y 5 (venta) se reescriben en **dos subtablas** (una por
  eje). El **parche INV-1** (preservar a mano las keys sintéticas `Holo`/`Reverse Holo` de la tabla
  cruda, comentarios ~332-336/382-385/436-438) queda **RETIRADO**: el merge del guardado parte del
  `PriceRuleSet` del servidor (que ya trae ambos ejes) y aplica el borrador por eje encima —
  `updateBuylistRules({ rarityRules: {...srv, ...draft}, finishRules: {...srv, ...draft}, fallbackPct })`.
  Ningún eje pisa al otro; no hay keys sintéticas que rescatar. Se conservan: fallbacks pct visibles
  (buylist 40 / venta 15), los guards money-safe (S-P1-1: no persistir `MX$0`) y la UX de «guardar sin
  perder reglas» (gate `!data`).
- **Rarezas canónicas:** el eje de rareza itera `GET /admin/pricing/rarities` por **`row.canonical`**
  (no un groupBy crudo) y muestra el atributo **`premium`** (badge accent) y, si aplica, **`unmapped`**
  (badge warning). `BuylistRarityRowDTO`/`SalesRarityRowDTO` ganan `canonical`, `raw?`, `premium`,
  `mapped`; `rarity` queda como alias DEPRECADO de `canonical`.
- **Filas de acabado:** una fila por finish de `FINISH_RULE_KEYS`; sin regla propia el badge dice
  «Hereda rareza» (no se persiste 0). aria-labels del eje de acabado usan «Valor/Modo **del acabado**
  {finish}» para **no colisionar** con una rareza homónima (p. ej. Eevee rareza «Reverse Holo»).
- **`api.ts` / mocks:** `get/updateBuylistRules` y `get/updateSalesRules` pasan a `PriceRuleSet`.
  Fixtures: `mockBuylistRarityRules` + `mockBuylistFinishRules` (+ `getMock…RuleSet`/`setMock…RuleSet`);
  `resolveBuylistRuleForFinish` resuelve con precedencia **finish-rule > rarity-rule > fallback**
  (reproduce el negocio vigente: reverse_holo fijo $1.50; resto → fallback 40%). El seed migra las
  viejas keys sintéticas a `finishRules`.

### Tests
- `MasterSet.test.tsx`: energía especial (holofoil+reverse_holo → **2 casillas exactas, no 3**);
  Deck Exclusive como producto aparte con su propio precio (no fusionado); promo sin precio → «—»
  (nunca `$0`); binder M1 pinta el Deck Exclusive/promo de Charizard desde fixtures; carta sin
  productos separados no pinta ninguno.
- `M2View.test.tsx`: los tests INV-1 (preservar «Holo» sintético) se **reemplazan** por tests de
  dos ejes (editar el acabado va a `finishRules` sin tocar `rarityRules`; editar la rareza preserva
  la regla de acabado del servidor). Actualizado el shape de `updateBuylist/SalesRules` a
  `{ rarityRules, finishRules, fallbackPct }`.

### Salvedad / solicitud al arquitecto (no bloqueante)
- **Cotización/carrito de un producto separado:** el diseño pide que los Deck Exclusives/promo sean
  «su propio producto **cotizable**». Hoy `POST /buylist/quote/batch` y el carrito de venta están
  keyeados por **`(cardId, finish)`** (`BuylistQuoteItemDTO` no tiene `productId`), así que un producto
  separado **no puede cotizarse ni agregarse como línea distinta** con el contrato v1.29 sin fusionarse
  con la carta base. Por eso `SeparateProductTile` es **de presentación** (nombre + tipo + precio de
  mercado propio), sin botón «Agregar». **Petición:** si se requiere cotizar/vender productos separados
  como líneas propias, el contrato del quote/carrito necesita un identificador `productId` (opcional,
  aditivo). Mientras tanto el front muestra el producto con su precio propio, money-safe.

### Gates de la ronda
`typecheck` (tsc --noEmit) ✓ · `next lint` ✓ (0 warnings) · `vitest run` **548/548** (70 archivos;
+6 nuevos de esta ronda) ✓ · `next build` ✓.

## Botón BATCH «Refrescar variantes + precios de TODO (solo TCGCSV)» en M2 (2026-08-22, rama `fix/variant-composition-regression`)

Botón GLOBAL en la sección «Sync de catálogo» de M2 (`(admin)/admin/m2/M2View.tsx`), junto a
Backfill / Importar sets nuevos / Re-sincronizar todo (forzar). Corre el mismo trabajo que la
acción por-set «Variantes + precios (solo TCGCSV)» (P-13) pero sobre **TODO el catálogo ya
importado**: repuebla variantes/acabados + precios desde **TCGCSV**, **sin re-importar cartas** y
**sin pokemontcg.io**. Sirve para backfillear la composición/precios del catálogo cuando
pokemontcg.io está caído.

> **Actualización (reconciliación con backend): el batch es ASÍNCRONO.** El backend implementó
> `refresh-variants-all` fire-and-forget (POST 202) con un endpoint de STATUS PROPIO para
> progreso/resumen. La sección de abajo refleja ese contrato final.

### Contrato consumido (modelo ASÍNCRONO)
- `POST /api/v1/admin/catalog/refresh-variants-all`, body `{ force? }` (solo se manda `force` cuando
  es `true`; body mínimo por defecto). **Responde HTTP 202** con `{ jobId, setsQueued, remaining }` —
  **NO** trae el resumen; solo arranca el barrido. Tipo `RefreshVariantsAllResponse` (redefinido a ese
  shape).
- `GET /api/v1/admin/catalog/refresh-variants-status` → `{ running, jobId, total, done, startedAt,
  finishedAt, summary }`, donde `summary = { setsTotal, setsOk, setsFailed, cardProductsUpserted,
  pricesUpserted, pending, failures: [{ setId, code, message }] }` (o `null` mientras no haya
  terminado ningún batch). Es el STATUS PROPIO del batch, **distinto** del `sync-status` de sync-all.
  Tipos `RefreshVariantsStatusResponse`, `RefreshVariantsSummary`, `RefreshVariantsAllFailure` en
  `frontend/src/types/contract.ts`. Wire `refreshVariantsAll()` + `getRefreshVariantsStatus()` en
  `frontend/src/lib/api.ts`; **mock async** en `fixtures.ts` (`startMockRefreshVariantsAll` arranca el
  estado en memoria; `readMockRefreshVariantsStatus` avanza `done` en cada lectura y al completar
  apaga `running` y adjunta el `summary` con **un** set fallido + `pending>0` para el reflejo money-safe).
- **Progreso:** se POLLEA `getRefreshVariantsStatus` (**NO** `sync-status`) cada 3 s mientras `running`,
  más una **ventana de gracia** `refreshAllDispatched` tras el POST (hasta que asome `running`, patrón
  N-14 de precios; caduca sola a 30 s). La MISMA barra accesible `SyncProgress` pinta `done/total` con
  labels propios `catalog.refreshVariantsAllSweep*`. `remote-sets` refresca cada 5 s mientras corre.

### UX / comportamiento
- **Confirmación** (operación masiva) por `Modal` — calca el modal de «Re-sincronizar todo (forzar)».
- **Progreso** en vivo desde el status del batch; banner "corriendo" mientras `batchBusy`
  (`POST pending || refreshAllDispatched || running`).
- **Resumen honesto** al terminar (leído del `summary` del status, **no** del POST): si
  `setsFailed>0 || pending>0` → Banner `warning` («resultado parcial»), si no → `success`. Muestra
  `setsOk/setsTotal`, productos, precios, pendientes y la **lista legible de `failures`** (nombre del
  set resuelto vía `remote-sets` + `setId` + motivo). Un `useEffect` gatillado por `finishedAt`
  invalida `remote-sets` + `pending-prices` al terminar.
- **Serialización:** `batchBusy` deshabilita las demás operaciones de catálogo (per-set vía
  `otherPerSetPending`; globales Backfill/Importar/Re-sync vía `disabled`) y el propio botón se
  deshabilita si **otra** operación de catálogo está en curso (`catalogBusy && !batchBusy`).
  `useKeepSessionAlive(catalogBusy)` mantiene viva la sesión durante toda la corrida.
- **Ayuda:** el `hint` deja claro que **NO** re-importa cartas ni usa pokemontcg.io; que es para
  backfillear composición/precios del catálogo ya importado.
- i18n en `messages/{es,en}.json` bajo `admin.m2.catalog.refreshVariantsAll*` (sin hardcode).

### Desalineación con el contrato (solicitud al arquitecto)
- Los endpoints `refresh-variants-all` / `refresh-variants-status` **no están en
  `docs/API_CONTRACT.md`** todavía (implementados contra el contrato reconciliado con backend).
  **Petición al arquitecto:** formalizar ambos: `POST /admin/catalog/refresh-variants-all` (body
  `{ force? }` → 202 `RefreshVariantsAllResponse`) y `GET /admin/catalog/refresh-variants-status`
  (`RefreshVariantsStatusResponse` con el `summary` agregado). Si backend ajusta nombres de endpoint
  o de campos, se alinea en un solo punto: `api.ts` + `contract.ts` (+ mock en `fixtures.ts`).

### Gates de la ronda
`tsc --noEmit` ✓ · `eslint` (archivos tocados) ✓ · `vitest run` **564/564** (70 archivos; +5 tests
del flujo batch async: POST 202 solo arranca + resumen desde el STATUS PROPIO, barra de progreso
done/total desde status, cancelar no llama, `failures`/pendientes parcial money-safe, error de arranque
legible) ✓ · `next build` ✓.

## TD-1 · Refactor de `M2View.tsx` (monolito → secciones) — refactor PURO (2026-08-22, rama `fix/variant-composition-regression`)

Paga la deuda **TD-1** (y de paso **FE-14**): `M2View.tsx` era un monolito de **2.235 líneas** con ~20
hooks y editores inline clonados. Se partió en componentes por sección **sin cambiar comportamiento, UX,
i18n, accesibilidad ni disparos de endpoint** — es refactor de ESTRUCTURA, no de features. `M2View.tsx`
quedó como **orquestador de 56 líneas**.

### Qué se extrajo (`frontend/src/app/[locale]/(admin)/admin/m2/sections/`)
- **`shared.tsx`** — helpers money-safe (`pesosToCents`, `sanitizeDecimalInput`, `isSaveableRuleValue`,
  `isEndpointMissing`), constantes (`RULE_MODES`, `SALES_RULE_MODES`, `PRICE_PROVIDERS`, `SEALED_SUBTYPES`,
  `FINISH_RULE_KEYS`) y los componentes ya-extraídos `SyncProgress` / `RowMoreMenu` (movidos tal cual).
- **`PriceIngestSection.tsx`** — Sección 1 «Actualizar precios» (disparo del ingest + barra de progreso del
  barrido de PRECIOS). Presentacional; consume el hook compartido.
- **`PendingQueueSection.tsx`** — Sección 2 (cola pendiente en dos buckets venta/compra) **+ el modal de
  override manual**. Dueña de sus queries `['pending-prices', ...]` y su mutación de override.
- **`FxSection.tsx`** — Sección 3 (FX: tasa/colchón + override + refresco Banxico). Autocontenida.
- **`PriceProviderSection.tsx`** — Sección 3b (selector de proveedor de respaldo del ingest, §19.7).
- **`BuylistRulesSection.tsx`** — Sección 4 (reglas de compra, modelo NUMÉRICO) **+ «Unificar rarezas»
  anclado a este editor (§19.5) y su modal de confirmación**. Renderiza `<RuleAxisEditor>`.
- **`SalesRulesSection.tsx`** — Sección 5 (reglas de venta, modelo TEXTO-CRUDO + validación S-P1-1).
  Renderiza `<RuleAxisEditor>`.
- **`SealedSpreadsSection.tsx`** — Sección 5b (spreads de venta del sellado por presentación).
- **`CatalogSyncSection.tsx`** — los 3 grupos §19 (Datos/Catálogo/Avanzado) + tabla ÚNICA de sets (jerarquía
  por-fila I→G→H con `RowMoreMenu`) + los spans sr-only de motivos + los modales de re-sync forzado y
  refresh-variants-all. Presentacional; consume el hook compartido.

### Dedup clave: `<RuleAxisEditor>` (colapsa los clones buylist↔venta)
Los editores de compra y venta eran clones ~1:1 del patrón **dos ejes (rareza canónica + acabado) con
borrador/efectivo/fallback**. Se extrajo un `RuleAxisEditor` **presentacional** que contiene SOLO la
estructura visual común (input de fallback, cabeceras + listas de ambos ejes, Select modo + Input valor +
Badge origen por fila, save/cancel, banners de reglas-no-disponibles/guardado/error). Las diferencias de
comportamiento que NO se pueden unificar sin cambiar semántica se mantienen en cada sección vía
**view-models de fila** (`RuleAxisRarityRow` / `RuleAxisFinishRow`) y callbacks:
- **buylist** guarda el valor **numérico** (centavos si `fixed`, número si `pct`), usa `.replace(/[^0-9.]/g,'')`
  y **PRESERVA** el valor al cambiar de modo; sin `pctHint` ni validación de vacío.
- **venta** guarda el valor como **texto crudo**, usa `sanitizeDecimalInput`, **LIMPIA** el valor al cambiar
  de modo, muestra `pctHint` y bloquea Guardar si hay un vacío/NaN (S-P1-1, `showInvalidBanner`).
El botón «Unificar rarezas» se conservó **anclado al editor de rarezas de compra** (§19.5), dentro de
`BuylistRulesSection` (no se movió al `RuleAxisEditor`). El prop `t` se pasa con scope `admin.m2.buylistRules`
o `admin.m2.salesRules` (comparten las mismas keys); es válido porque el proyecto no usa el tipado estricto
de mensajes de next-intl (`t` acepta `string`).

### Estado acoplado precio↔catálogo: hook `useCatalogSync`
La Sección 1 (precios) y `CatalogSyncSection` comparten estado por diseño y **no** son separables en dos
árboles de estado sin cambiar comportamiento: el «Sync completo» por-fila del catálogo dispara el barrido de
PRECIOS (`justDispatched` + `priceSyncStatus.refetch`), y `catalogBusy` —que gobierna `useKeepSessionAlive`—
agrega el barrido de precios Y todas las operaciones de catálogo. Todo ese estado (queries de status con sus
`refetchInterval`, ventanas de gracia N-14, mutaciones, `catalogBusy`/`batchBusy`, keep-alive, invalidaciones)
se centralizó en el hook **`useCatalogSync`**, llamado UNA vez en `M2View` y pasado como prop a las dos
secciones. Así la serialización y las invalidaciones quedan **EXACTAS**. Las invalidaciones cross-sección
(override→`pending-prices`, ingest/refresh→`pending-prices`, unify→rarezas/reglas compra+venta) siguen
funcionando porque el `QueryClient` es compartido; cada sección es dueña de sus propias queries por clave.

### Orden DOM y modales
El orden de render se conservó idéntico (h1 → S1 → S2 → S3 → S3b → S4 → S5 → S5b → grupos catálogo). Los
modales (override, unify, force, refresh-all) se movieron DENTRO de la sección dueña de su estado; como el
componente `Modal` solo monta cuando `open` y los tests los localizan por rol/texto, no hay cambio observable.

### Cero-cambio-de-comportamiento (cómo se garantizó)
Se copió el JSX **verbatim** (classNames, textos, `{' '}`, `aria-*`, `role`, ids `m2-reason-*`), se
preservaron las claves de query y las invalidaciones exactas, y **no se modificó ningún test**. La red de
seguridad son los **67 tests conductuales** de `M2View.test.tsx` (que importan `{ M2View }` e interactúan por
rol/texto) + el resto de la suite.

### Gates
`tsc --noEmit` ✓ · `next lint` sin warnings/errores ✓ · `next build` ✓ · `vitest run` **568/568** verdes
(70 archivos; M2View.test.tsx **67/67**), **sin modificar los tests**. `M2View.tsx`: **2.235 → 56 líneas**.

---

## P-29 baja rápida — `note` obligatorio + idempotencia `batchKey` (v1.35-inventory-bulk-remove-idempotency)

QA rechazó la baja rápida por un bug BLOQUEANTE: `QuickRemove.tsx` no enviaba `note`, que el backend
exige (`@IsString() note!`) ⇒ toda llamada REAL caía en `400 VALIDATION_ERROR`; los tests pasaban solo
porque los mocks omitían `note` (lo enmascaraban). El contrato subió a v1.35 y se cerró así:

- **`note` OBLIGATORIO (texto libre):** nuevo campo `Input` de nota en el control (`admin.quickRemove.noteLabel`),
  validado no-vacío (`note.trim() !== ''`). El CTA «Dar de baja» se **deshabilita** con la nota vacía (barrera
  de UI; el backend es la barrera dura). Es ADICIONAL al `reason` enum (perdida/danada/error_captura), que ya
  existía — son dos campos distintos y **ambos** viajan en el request.
- **Idempotencia `batchKey`:** se replica el patrón EXACTO de `QuickAdd`/`adjustFound` — `batchKeyRef` +
  `ensureBatchKey()` con `localUid('qrem')`: la key se genera **una vez por intento**, se **reusa en el
  reintento del mismo submit** (backend lo trata idempotente = replay, no re-baja otras N piezas ⇒ cierra el
  «encogimiento fantasma»), y **rota tras un éxito**. `idempotentReplay` de la respuesta se consume sin romper
  el tipado (no se pinta).
- **`contract.ts`** (espejo del contrato): `BulkRemoveInventoryRequest.note` pasó de opcional a **requerido** y
  ganó `batchKey?: string`; `BulkRemoveInventoryResponse` ganó `batchKey?: string` e `idempotentReplay: boolean`.
- **Mock (`fixtures.ts`):** `mockBulkRemove` ahora **valida `note` no-vacía** (400 si falta — refleja la llamada
  real, ya no la enmascara), aplica idempotencia por `batchKey` (`mockBulkRemoveStore`, replay con
  `idempotentReplay:true`) y devuelve `batchKey`/`idempotentReplay`.
- **Tests:** los mocks/asserts ahora mandan y verifican `note` (no-vacía) y `batchKey` en el body; nuevo test de
  «CTA deshabilitado sin nota» y de «reintento del mismo submit reusa la batchKey». Suite **586/586** ✓,
  `tsc --noEmit` ✓, `next build` ✓.
- **Money-safe:** la baja solo transiciona `status`; no toca precios (garantía del backend, inalterada).

---

## Órdenes storefront — «Solicitar factura» cableado real + paginación en /orders (rama claude/frontend-redesign-320uai)

> **⚠️ REVERTIDO (2026-08-22, coordinación de streams):** el orquestador acotó la frontera del
> rediseño a la capa visual: la plomería de datos (`lib/api.ts`, `lib/mock/`, `types/contract.ts`)
> la está tocando en paralelo la sesión de features admin (P-34/P-35). Estos dos arreglos requerían
> tocarla, así que se revirtieron del árbol y quedaron **preservados como parche**
> (hallazgo QA: el parche no viaja en el repo para no cruzar la frontera de plomería; quedó enrutado al orquestador de Pendientes y el trabajo está descrito íntegro abajo para rehacerlo cuando P-34/P-35 liberen `lib/api.ts`) para reaplicar
> cuando esa sesión libere la plomería. Pendiente resultante: el botón «Solicitar factura» sigue
> siendo estado local (falso) y `/orders` sigue sin paginación — el endpoint
> `POST /orders/:orderId/request-invoice` existe en contrato y backend; solo falta el cliente.
> Lo de abajo documenta el trabajo del parche.

Dos arreglos quirúrgicos en `(storefront)/orders` (sin rediseño):

- **«Solicitar factura» dejó de ser un botón falso.** `OrderDetailView.tsx` ya no hace
  `setRequested(true)` local: llama `requestOrderInvoice(orderId)` (nueva función en `lib/api.ts`,
  contrato §4 · `POST /orders/:orderId/request-invoice`, req `{}`, res
  `{ orderId, invoiceRequested: true, instructions: "SEND_FISCAL_DATA_BY_EMAIL" }`).
  Estados reales: `loading` (spinner del Button), error visible (`Banner danger` +
  `orders.invoiceError`) y éxito **persistente**: `onSuccess` escribe `invoiceRequested: true` en la
  caché de la query `['order', orderId]`, así el render usa SIEMPRE `query.data.invoiceRequested`
  (misma fuente que reporta el backend en un refetch). Éxito muestra `orders.invoiceRequested` en
  mono + el aviso CFDI existente. Tipo espejo `RequestInvoiceResponse` en `types/contract.ts`.
  Rama mock: muta `fx.mockOrderDetail.invoiceRequested = true` (persistencia igual al backend real).
- **Paginación en `/orders`.** `getOrders(page = 1)` ahora manda `?page=` (el backend pagina a 20;
  `GET /orders → { data, page, pageSize, total }`) y la rama mock usa el helper `paginate`.
  `OrdersView.tsx`: estado `page` en query key + `placeholderData: keepPreviousData` (sin flash de
  vacío) y paginador sobrio papel/tinta: número de página en mono tabular (`orders.pageInfo`) y
  flechas cuadradas 36×36 con borde 1px sin radius (lucide ArrowLeft/Right), deshabilitadas en los
  extremos con el mismo tratamiento apagado del Button del sistema. Solo se pinta con `totalPages > 1`.
- **i18n:** solo namespace `orders.*` en `es.json`/`en.json` (`invoiceError`, `pagination`,
  `pageInfo`, `prevPage`, `nextPage`).
- Gates: `tsc --noEmit` ✓ · `next lint` ✓.

---

## Makeover 1a «Conservadora» · Vender (buylist) + Carrito y pago (checkout) + Mi bóveda (rama claude/frontend-redesign-320uai, 2026-08-22)

Restyling según el artboard «TCGHunt Comprar y Vender» (dirección papel/tinta/rojo #B31217). Solo piel y
copy; cero cambios de lógica de dinero (SEC-A1 intacto: `batchQuote` y `BreakdownDTO` server-side).

**Vender (`/buylist`):**
- Hero con el nuevo lenguaje: «Vender mis cartas» + subtítulo + rule-note de PAY_AFTER_RECEIPT
  («primero autenticamos, luego transferimos») + enlace «Guía de envío seguro» (keys `buylist.*`).
- `SafeShippingGuide` reescrita al lenguaje editorial: retícula 01–04 (numeral mono rojo, regla superior),
  sin iconos ni cajas; prop `columns` (2 = modal, 4 = inline). Ahora vive DOS veces: modal del hero y
  sección inline al pie de la página (artboard 630–657). Copy de pasos actualizado en `safeShipping.*`
  (funda blanda / top loader / sobre o caja rígida / guía con seguro).
- Carrito de venta (drawer, se conserva FAB+drawer de §18.4): título «Tu lista», total estimado como
  cifra héroe mono 26px con etiqueta en versalitas, nota del estimado como rule-note roja, CTA
  «Enviar solicitud» en **tinta (primary, 54px)** — el rojo queda reservado al pago del checkout —,
  «Vaciar la lista» como texto mono centrado y pie mono en versalitas `cartFooterNote` (SPEI 2–3 días
  hábiles: se conserva la política real, no el «24–48 h» placeholder del artboard).
- `SellRequirementsPanel`: título «Requisitos para cobrar» (checklist ✓/—/! sin cambios).
- «Mis solicitudes»: el bloque de respuesta al ajuste (F5) deja la caja `bg-accent/5` y pasa a
  rule-note (sin rellenos de color, DESIGN §2.1). Funcionalidad intacta.

**Carrito y pago (`/checkout`, con cuenta e invitado):**
- Título «Tu carrito» + subtítulo de bóveda (`checkout.subtitle`).
- Líneas con miniatura grande (92px desktop / 64px móvil), nombre serif 19px, meta mono
  (set · #número · NM en raw con cuenta), «Quitar» bajo la meta y precio tabular 19px a la derecha.
- Bloque «Guardar en mi bóveda» (flujo con cuenta) reusa los benefits del upsell
  (`checkout.vaultUpsell.benefit.*`) como lista con reglas; eyebrow nuevo `checkout.vaultKeepEyebrow`.
- Resumen: cabecera «Resumen» con regla fuerte; botón «Pagar {monto}» sigue **accent (rojo)** y crece
  a 54px. Sin tocar `AmountBreakdown` (componente compartido, fuera del alcance de este stream).
- Estados EMAIL_NOT_VERIFIED / ITEM_UNAVAILABLE (poda + aviso) y todo el flujo invitado/upsell/claim
  se conservan sin cambio de comportamiento.

**Mi bóveda (`/vault`):**
- «Mis piezas» pasa de renglones-tabla a **tejas** (retícula del binder 2→3→4→5): imagen 5:7, nombre
  serif, `ListingSpec` mono, folio, fila valor+estado sobre regla y CTA «Retirar» por teja (Link
  bordeado si `withdrawable`; Button disabled con hint accesible si no — misma lógica v1.17;
  `WithdrawalBadge` manda sobre el badge de titularidad cuando hay envío activo).
- Sin precio de referencia la teja dice «Pendiente» en mono rojo (nunca MX$0.00 ni «—»); key nueva
  `vault.valuePending`. Lenguaje «piezas» (setCount/pendingPrice/onlySettled actualizado a «piezas
  liquidadas y sin envío activo»). Encabezado de sección `vault.myPieces` + `vault.piecesLegend`.
- Pestañas Piezas/Master set/Sellado, portafolio (`PortfolioTrendChart`, ya tokenizado — sin cambios),
  «Valor por set» y filtros se conservan.

**No implementado / desviaciones conscientes:**
- «Queda 1 / N en stock» por línea del carrito (artboard): `OrderItemPreview` no trae disponibilidad —
  pedido al arquitecto (no se inventan datos).
- Copy de la vitrina Top Bounties («Buscamos estas cartas» / «Te pagamos» / «Top bounties») NO se
  cambió: `TopBountiesShelf.test.tsx` (fuera del alcance de archivos de este encargo) asserta el copy
  vigente; la vitrina ya cumple visualmente el artboard (banda, chip, precio verde, QUEDAN N, CTA).
- El carrito de venta sigue como FAB+drawer (spec §18.4 ratificada) en vez de la columna fija de 420px
  del artboard; el drawer adopta el lenguaje del artboard.
- Tests: `BuylistView.test.tsx` actualizado a los nuevos copys («Vaciar la lista», «Requisitos para
  cobrar»). Suite tocada 103/103 ✓ · `tsc --noEmit` ✓ · `next lint` ✓.

---

## Makeover home 1a «Conservadora» (rama claude/frontend-redesign-320uai)

**Alcance:** home del storefront (`(storefront)/page.tsx` + componentes nuevos en
`(storefront)/_home/`), `StorefrontHeader`, footer del storefront (`(storefront)/layout.tsx`) y
claves i18n `home.*` / `nav.*`.

**Estructura nueva del home (orden del artboard 1a):**
1. Banda de portafolio (solo sesión iniciada): `PortfolioGlance` conservado del home anterior,
   ahora como banda propia bajo el header con link «Ver mi bóveda». El diseño 1a no la dibuja;
   se conserva por valor para el usuario recurrente.
2. Hero 2 columnas (1fr/392px): kicker mono, H1 serif 50px, CTA negro «Ver el catálogo» + link
   rojo «Producto sellado» (→ /sellado), chips «Sets buscados» con sets REALES de
   `GET /catalog/facets` (si no hay sets, no se pintan).
3. Mini-cotizador (`_home/HomeQuoter.tsx`): búsqueda `searchBuylistCards` (debounce 300 ms) +
   cotización POR EL SERVER con `getBuylistQuote` (SEC-A1: jamás se calcula un monto en cliente;
   sin referencia ⇒ línea «Pendiente», nunca $0; el total solo suma centavos cotizados por el
   server). El estado se IZA a la página (`useHomeQuoter`) porque el panel se pinta dos veces:
   columna del hero (lg) y sección propia (móvil), compartiendo líneas.
4. «Piezas destacadas» (`_home/FeaturedCarousel.tsx`): `getCatalog({sort:'price_desc'})`, primera
   teja grande + resto numeradas en mono rojo, flechas cuadradas funcionales (scroll + estado
   disabled real por posición). Badge «Queda 1» literal: en el modelo actual 1 publicación = 1
   copia; NO se muestra stock agregado por carta (no existe en el contrato de /catalog/cards).
5. «Producto sellado» (`_home/SealedShelf.tsx`): `getSealedGroups()` — aquí el stock agregado SÍ
   es real (`availableCount`): «N en stock» / «Último».
6. «Cartas gradeadas» (`_home/GradedShelf.tsx`): `getCatalog({productType:'graded'})` con chip
   empresa+grado y `certNumber` reales.
7. «Lo que más buscamos hoy» (`_home/BountyBoard.tsx`): condicional — solo si
   `getPublicBounties()` trae elementos (error/vacío ⇒ la sección no existe, regla de
   TopBountiesShelf). Columna «Condición» pinta la constante honesta «NM» (la buylist solo
   compra NM; el DTO de bounty no trae condición por fila).
8. «Cómo funciona la bóveda»: 3 pasos estáticos i18n. 9. Banda de tinta con único botón rojo
   «Cotizar mi lista». 10. Footer mono una línea (padding 26px del artboard).

**Header:** nav del artboard «Comprar / Vender / Mi cuenta» (activo = border-bottom rojo, ya
existente). Anónimo: «Mi cuenta» → /login (sustituye el link suelto «Iniciar sesión»); con
sesión se conservan las pestañas privadas (Mi bóveda / Mis órdenes / Mis retiros) y el bloque
nombre + Cerrar sesión. P-28 (ocultar carrito de compra en /buylist) y `--app-header-h` intactos.

**Decisiones / desviaciones conscientes:**
- «Continuar mi cotización» SOLO navega a /buylist sin transferir las líneas: llevarlas al
  `useSellCart` de `BuylistView` exigiría tocar el módulo buylist (fuera de los archivos de este
  encargo). Opción menos invasiva elegida y documentada; si se quiere transferencia real, el
  dueño del módulo buylist puede aceptar un query param (p. ej. `?add=cardId:finish,…`).
- Los links «filtrados» (`/catalog?setId=…`, `/catalog?productType=graded`) llevan el query
  param y `CatalogView` YA los inicializa desde la URL (`parseUrlFilters`, cerrado en este mismo
  stream por el módulo catálogo): los deep-links del home aterrizan filtrados.
- Tejas destacadas usan `CardImage` (aspecto 5:7) también para la teja grande (el artboard
  sugiere 4:5): el arte de las cartas es 5:7 nativo y recortarlo mentiría.
- El eyebrow de gradeadas dice «PSA · CGC» (el artboard decía «PSA · BGS · CGC»; BGS no existe
  en `GradingCompany` del contrato).
- `FeaturedSetGlance` (§7.18, gráfica pública del set destacado en la rama anónima) SALE de la
  home: su lugar lo ocupa el cotizador. El componente y sus claves `home.featuredSet.*` se
  conservan (los usa su propio test); si UX lo da de baja, retirar ambos.
- El panel «Valor por set» del home anterior también sale (sigue viviendo en /vault).
- i18n: claves nuevas bajo `home.quoter/sealed/graded/bounties/how`, `home.heroKicker`,
  `home.setsWanted`, `home.trustPayout`, `home.lastOne`, `home.pricePending`,
  `home.carouselPrev/Next`, `home.vaultLink`, `home.featuredTitleShort`; `nav.buy`,
  `nav.myAccount`; valores actualizados: `home.ctaShop` («Ver el catálogo»), `home.sellCta`
  («Cotizar mi lista»). Paridad ES/EN verificada.
- Tests: `page.test.tsx` reescrito (hero + doble panel de cotizador + añadir carta cotiza contra
  el mock del server); `StorefrontHeader.test.tsx` actualizado a «Comprar / Mi cuenta».

---

## Makeover 1a «Conservadora» — Comprar / Ficha de carta / Sellado (rama claude/frontend-redesign-320uai)

Aplicación de los artboards aprobados «2a Comprar» y «Ficha de carta» (Claude Design, papel/tinta/rojo
`#B31217`) a la vitrina de compra, la ficha y la tienda de sellado. Cero tokens nuevos: todo se compone
con `--color-*`/`--hunt-*`, las tres familias (`--font-serif/sans/mono`) y las reglas 1px del sistema.

### Comprar (`catalog/CatalogView.tsx` + nuevos `CatalogTile.tsx` y `Paginator.tsx`)
- **Encabezado del artboard:** eyebrow `Catálogo · MXN sin IVA` + h1 mincho «Comprar» + conteo mono
  tabular «N piezas disponibles» (total real de la query filtrada) a la línea base.
- **Pestañas de la Tienda (StoreTabs):** ganan la tercera pestaña **Gradeadas**, que NO es ruta nueva:
  es `/catalog?type=graded`. `CatalogView` lee el parámetro con `useSearchParams` y lo sincroniza en
  ambos sentidos con `filters.productType` (cambiar el tipo desde el panel/chips hace `router.replace`
  para que la pestaña no mienta). Las páginas `/catalog`, `/compra` y `/sellado` ganan `<Suspense>`
  (requisito de `useSearchParams` en Next 15).
- **Filtros iniciales desde la URL (enlaces del Home):** `parseUrlFilters` inicializa el estado al
  montar desde la query — `?setId=<id>`, `?productType=raw|graded|sealed` (y el alias `?type=graded`
  de la pestaña), más los triviales `q`, `finish`, `sealedSubtype`, `rarity` (CSV) y `sort`; los enums
  se validan contra sus listas y un valor inválido se ignora. Un efecto keyed por
  `searchParams.toString()` MERGEA los filtros de la URL en navegaciones posteriores (pestañas,
  back/forward) sin borrar lo elegido en el panel. `StoreTabs` marca Gradeadas activa también con
  `?productType=graded`. Sin cambios de contrato ni de `lib/api.ts`.
- **Teja propia de la vista (`CatalogTile`)**: arte 5:7, nombre en mincho, `set · #número` mono muted,
  renglón `ListingSpec` (se conserva por §7.2b y por el e2e que verifica el tooltip NM), precio tabular
  en sans y **«Queda 1» rojo literal** (1 publicación = 1 copia física; no se inventa stock agregado).
  CTA «Añadir al carrito» (móvil «Añadir» vía spans responsivos + `aria-label` estable); en carrito →
  «En el carrito» y el segundo clic navega a `/checkout`. NO se tocó `ListingCard` (zona compartida);
  la teja vive en `catalog/` y es propiedad de esta vista. Sin precio jamás pinta `$0`: cae al
  `price.pendingLabel` (defensivo; Compra solo lista con precio).
- **Paginación (hueco real cerrado):** `Paginator` sobrio (flechas cuadradas 38px con borde + `p / N`
  mono tabular). `filters.page` viaja en `getCatalog` (el backend pagina a 20); **cualquier cambio de
  filtro/orden/búsqueda resetea la página** (`updateFilters`). Nota: la rama MOCK de `getCatalog`
  ignora `page` y devuelve todo (`lib/api.ts` es zona compartida; no se tocó) — con mocks el paginador
  casi siempre queda en `1 / 1`. Contra backend real funciona completo.
- Filtros: mismo panel (9 filtros + facetas), reordenado según artboard (Set primero) y con reglas de
  sección a 0.32 (`border-border-strong`); encabezado FILTROS + «Limpiar» rojo; en móvil el botón
  Filtros muestra el conteo activo en rojo.

### Ficha de carta (`catalog/[cardId]/CardDetailView.tsx`)
- Ya seguía la retícula del artboard; se ajustó: **chip de grado** (borde tinta, mono «PSA 9») en la
  celda Condición para gradeadas; **precio de venta ausente → «Precio pendiente»** rojo mono (antes
  decía «No disponible»); `card.backToCatalog` pasa a «Volver al catálogo».
- **`CertNumberField` restilizado** (el diseño lo exige): etiqueta eyebrow + renglón con borde 0.32,
  número mono tabular y «Copiar» rojo mono a la derecha. Afecta también a M8 (admin) — mismo lenguaje.

### Sellado (`sellado/SealedShopView.tsx`, `SealedDetailView.tsx`, nuevo `StockBadge.tsx`)
- La cuadrícula 5:7 se sustituye por la **banda sobre pozo (`bg-surface-2`) con tejas horizontales**
  del home 1a: miniatura cuadrada 88px (object-contain, sin recorte), nombre mincho, renglón mono
  set·presentación(+condición), precio «Desde · sin IVA» tabular y **`StockBadge` con cantidades
  reales del endpoint**: «N en stock» verde / «Último» rojo / «Agotado» muted. Toda la teja enlaza a
  la ficha. La ficha de sellado usa el mismo `StockBadge`; los bloques tras feature-flags
  (`trendEnabled`/`restockEnabled`, 404 `FEATURE_DISABLED`) ya degradaban limpio y no se tocaron.
- i18n nuevos (namespaces ya usados por estas vistas): `storeTabs.graded`, `catalog.eyebrow`,
  `catalog.piecesAvailable`, `catalog.lastOne`, `catalog.addToCartShort`, `catalog.pagination.*`,
  `sealed.inStock`, `sealed.lastOne`, `sealed.soldOut`; y cambios de valor: `catalog.title`
  («Comprar»), `catalog.addToCart` («Añadir al carrito»), `catalog.resultsCount` (resultados),
  `card.backToCatalog`. ES+EN.

### Desviaciones conscientes del artboard
- **Filtro «Grado» del sidebar (chips PSA 10/PSA 9/…):** el contrato de `/catalog/facets` no expone
  facetas de grado ni `getCatalog` filtra por grado — no se pintó (pintarlo sin backend sería mentir).
  Solicitud al arquitecto anotada abajo. La pestaña «Gradeadas» cubre el corte grueso.
- **«Solo con stock»:** no existe en el contrato y la vitrina ya lista solo inventario publicado con
  precio — el toggle sería un no-op; se omite.
- **«2/4/6 en stock» verdes del artboard 2a:** placeholders del diseño; en el modelo real cada
  listing de cartas es una copia única, así que TODAS las tejas vendibles pintan «Queda 1» (los
  agregados con stock real viven en /sellado, donde sí se pintan).
- **Orden como `Select` con etiqueta** (no el rectángulo «Precio ↓» del artboard): se reusa el Select
  del sistema por a11y/consistencia; mismo lugar (barra de resultados).
- CTA de teja a 44px de alto (artboard: 42px) por el objetivo táctil mínimo del DS (§6.1).

### Gates locales
`tsc --noEmit` ✓ · `next lint` ✓ · `vitest run` **587/587** ✓ · `next build` ✓. Tests propios
actualizados: `CatalogView.test` (nuevo nombre del CTA + mock `next/navigation`), `SealedShopView.test`
(«N en stock» + mock `next/navigation`).

### Solicitud al arquitecto (no bloqueante)
- Facetas/filtro de **grado** en Compra: `GET /catalog/facets` con `grades: [{ company, value }]` y
  `GET /catalog/cards?gradingCompany=&gradeValue=` (o similar) para poder pintar el bloque «Grado»
  del artboard 2a con datos reales.

---

## Pase de refactors del makeover 1a — R1–R5 del veredicto techlead (2026-08-22, rama `claude/frontend-redesign-320uai`)

Refactor PURO dentro de `(storefront)/` + `messages/` (única excepción autorizada: R4 en
`components/domain/StoreTabs.tsx`). Nuevos compartidos del stream en `(storefront)/_shared/`
(NO en `frontend/src/components/` — zona compartida de otro stream).

### R1 · `_shared/StockBadge.tsx` — distintivo de stock único (§20.6)
- API semántica `variant: 'unique' | 'count' | 'lastUnit' | 'soldOut'` + helper
  `stockVariantFromCount(count)` para los sitios con conteo agregado real (sellado).
- **Colores canónicos decididos POR LA TABLA del DS §20.6** (ante la duda, manda el DS):
  `unique` («Queda 1») = **accent**; `count` («N en stock») = **success**; `lastUnit` («Último») =
  **muted** (la implementación previa de `sellado/StockBadge` lo pintaba accent — corregido);
  `soldOut` («Agotado») = muted. Mono 10px (9px móvil), uppercase, tracking 0.12em.
- Sustituye las 4 implementaciones (sellado/StockBadge — **eliminado**, SealedShelf inline,
  FeaturedCarousel/GradedShelf `home.lastOne`, CatalogTile `catalog.lastOne`) y también se usa en
  `SealedDetailView`. Namespace i18n único **`stock.*`** (`lastOne`, `inStock`, `lastUnit`,
  `soldOut`, ES+EN — §20.16). Claves borradas tras grep de uso cero: `home.lastOne`,
  `home.sealed.inStock`, `home.sealed.last`, `catalog.lastOne`, `sealed.inStock`, `sealed.lastOne`,
  `sealed.soldOut`. La semántica ambigua de `lastOne` («Queda 1» vs «Último») quedó partida en dos
  claves distintas (`stock.lastOne` / `stock.lastUnit`).

### R2 · `_shared/PendingPriceLabel.tsx` — señal única de precio pendiente
- Color canónico **accent** (§16.4 «texto mono rojo PENDIENTE» + §20.13 «aviso mono rojo, nunca $0»);
  los dos sitios del home que lo pintaban muted quedaron alineados.
- Una sola clave: **`price.pendingLabel`** (ya era la fuente de catálogo/ficha); `home.pricePending`
  **borrada**. Prop `hint` añade `price.pendingHint` (fila de ejemplares de la ficha). Usado en los
  5 sitios: CatalogTile, CardDetailView (Fact + fila de ejemplar), FeaturedCarousel (TilePrice),
  GradedShelf. `components/ui/PriceTag.tsx` NO se tocó (zona compartida): consolidación final
  anotada en TECH_DEBT (MK-D7).

### R3 · Estantes del home sin duplicación
- **Errores:** los tres bloques de error a mano (FeaturedCarousel/SealedShelf/GradedShelf) ahora usan
  `components/ui/QueryState` (solo import, como CatalogView/SealedShopView). Detalle de composición:
  el wrapper `<div className={isError ? 'gutter pb-12' : undefined}>` aporta el gutter SOLO en la
  rama de error, para no alterar la pista de scroll del carrusel ni duplicar gutter en las grillas.
- **`_shared/Shelf.tsx`:** encabezado de estante único (H2 serif 22/29 + link muted + variantes
  `kicker`/`subtitle`/`actions`); consumido por FeaturedCarousel (flechas como `actions`),
  SealedShelf, GradedShelf y BountyBoard.
- **`_shared/EditorialLink.tsx`:** micropatrón §20.0 (variant `accent` = subrayado rojo + tinta,
  hover subrayado a tinta; `muted` = terciario sin subrayado). Renderiza `Link` con `href` o
  `<button>` con `onClick`. Usado en: `page.tsx` (link bóveda; CTA sellado del hero con overrides
  responsivos móviles vía `className`+twMerge), `HomeQuoter` («Continuar mi cotización»),
  `BuylistView` (guía de envío — la variante divergida `text-accent`/minúsculas se normalizó al
  canon) y dentro de `Shelf` (los «Ver todo…» muted).

### R4 · StoreTabs sin ARIA de tabs (excepción autorizada, solo ese cambio)
- `components/domain/StoreTabs.tsx`: fuera `role="tablist"/"tab"` y `aria-selected` (prometían un
  tab-panel controlado con navegación por flechas que no existe); ahora es
  `<nav aria-label={t('storeTabs.label')}>` + `aria-current="page"` en el link activo. Visual §20.1
  intacto. Nada más se tocó en ese archivo.

### R5 · Catálogo: debounce + `keepPreviousData`
- El input de búsqueda pasa a estado inmediato propio (`searchTerm`) y solo su valor **debounced**
  (`useDebouncedValue`, 300 ms — patrón P-5) entra a `filters.q`/queryKey: cero fetch por pulsación.
  Sincronización: chip «✕»/limpiar y `?q=` de URL escriben de vuelta al input; cambios de
  orden/facetas NO lo pisan (guard por comparación de `q`). El reset de página viaja con el término
  debounced (cambio real de `q` ⇒ `page: undefined`).
- `catalogQuery` con `placeholderData: keepPreviousData`: paginar/filtrar ya no desmonta la grilla
  (skeleton solo en el primer fetch).

### D-menores corregidos de paso (D3/D7)
- **D3:** `Paginator` movido a `_shared/Paginator.tsx` (era genérico) y **`SealedShopView` ahora
  pagina** (§20.12): `page` en filtros (los 4 selects resetean página), total de páginas del
  `total/pageSize` del contrato, ancla de scroll en la barra de resultados, oculto con una página.
- **D7:** © del footer con año dinámico (`layout.tsx`); numeración del carrusel `aria-hidden`
  (§20.3); `BountyBoard` con semántica de tabla (`role="table"/row/columnheader/cell"` — alternativa
  válida de §20.7 conservando la retícula responsiva); chips removibles con
  `aria-label` de acción (`catalog.removeFilter`, ES+EN); literal `BUYLIST` → `buylist.verticalLabel`
  (uppercase vía clase, §20.15). Lo NO corregido quedó en TECH_DEBT (MK-D7): `<img>` crudo de
  SealedShelf, HomeQuoter sin cancelación/combobox ARIA, header de /checkout sin simplificar.

### Gates locales
`tsc --noEmit` ✓ · `next lint` ✓ (sin warnings) · `vitest run` **589/589** ✓ (sin tocar tests: los
textos visibles no cambiaron salvo el color/semántica ya descritos) · `next build` ✓.
## P-35 — Alta dedicada de producto SELLADO (`SealedAddFlow`, contrato v1.36-sealed-alta, §16.8a)

**Problema corregido:** la pestaña «Sellado» caía en `AddItemModal` (buscador de CARTAS sobre singles),
etiquetando un single como «sellado» (money-unsafe, sin mapeo TCGCSV). Ahora el alta de sellado es un flujo
dedicado que elige un PRODUCTO sellado real.

**Componentes nuevos (todos en `frontend/src/app/[locale]/(admin)/admin/m1/`, sin tocar storefront ni la capa
visual compartida `frontend/src/components/`):**
- `SealedAddFlow.tsx` — asistente modal ancho de 2 pasos (stepper mono `PASO 1/2 DE 2`, `Esc` cierra, foco
  inicial). Modal ancho LOCAL a M1 (`max-w-3xl`); no se reescribió el `Modal` compartido (es `max-w-md`).
  Paso 0 selector de set (Combobox con año, `listBuylistSets`; se salta con `presetSet`) → Paso 1 grid →
  Paso 2 `QuickAddSection` (P-19) + subtipo/condición. Camino de respaldo honesto (fuente 502 o vacío
  legítimo): mini-form manual con banner `info` de excepción → nace SIN mapeo (`PRICE_PENDING` visible).
- `SealedProductGrid.tsx` (`SealedProductGrid` + `SealedProductTile` + `SealedProductGridSkeleton`) — grid
  `role="listbox"` con `option`s navegables (flechas + Home/End), foco visible, `aria-selected`, `aria-label`
  por teja. Imagen `aspect-[5/7] object-contain` sobre pozo con fallback textual mono (nunca un roto).
  Money-safe por teja: precio `MERCADO` o pill **`SIN PRECIO DE MERCADO`** (nunca `MX$ 0.00`).

**Contrato consumido:** `GET /admin/inventory/sealed-catalog?setId=&groupId?=&q=` → `SealedCatalogResponse`
(`getSealedCatalog` en `lib/api.ts`, con mock `mockSealedCatalog`). El alta reusa
`POST /admin/inventory/items/batch` con `batchKey` idempotente por operación; cada línea envía
`{ cardId:<anchorCardId>, productType:'sealed', sealedSubtype, sealedCondition, finish:'normal',
tcgplayerProductId, tcgplayerGroupId, sealedImageUrl, sealedProductName, qty, acquisition* }`. La pieza NACE
MAPEADA (productId+groupId JUNTOS) ⇒ la aportación valúa en el acto (`marketRef` null ⇒ tarjeta Aportación
deshabilitada, heredado de QuickAddSection §16.5a2).

**Cambios en `contract.ts`:** `BatchInventoryItemInput` gana `tcgplayerProductId/tcgplayerGroupId/
sealedImageUrl/sealedProductName` (v1.36); nuevos `SealedCatalogProductDTO` y `SealedCatalogResponse`.
`QuickAddTarget` gana los 4 campos aditivos de sellado (se reenvían al batch solo si productId+groupId están).

**Retirado:** `AddItemModal` ya NO ofrece `productType='sealed'` (`PRODUCT_TYPES = ['raw','graded']`); se
eliminó su rama de subtipo/condición/listPrice. La pestaña Sellado y su estado vacío ahora abren
`SealedAddFlow` (CTA `Agregar sellado`), no `AddItemModal`. `Agregar otra presentación` en el detalle de set
abre el flujo con el set precargado.

**i18n:** `admin.sealedAdd.*` (es/en) según §16.10; el paso 2 reusa `admin.quickAdd.*` y
`status.sealedSubtype.*`/`status.sealedCondition.*`.

**Tests:** `SealedAddFlow.test.tsx` (grid + money-safe pill; aportación deshabilitada sin mercado; envío del
alta con identidad TCGCSV + cardId ancla; 502 con banner/retry/respaldo; vacío legítimo + respaldo sin mapeo).
Suite **591/591** ✓, `tsc --noEmit` ✓, `next lint` ✓, `next build` ✓.

**Solicitud al arquitecto (no bloqueante):** el camino de respaldo en el caso **502 UPSTREAM_ERROR** no tiene
`anchorCardId` (el cuerpo de error no lo trae), así que la captura manual solo puede anclarse en respuestas
`200` (incluido `groupResolved:false`). Si se quiere permitir captura manual anclada aun con la fuente caída,
el contrato tendría que exponer el `anchorCardId` del set por otra vía (p. ej. incluirlo en el 502 o un
endpoint ligero de ancla por `setId`). Mientras tanto, el 502 ofrece **Reintentar** + el respaldo, y el
respaldo con ancla queda operativo en el vacío legítimo (`200`).

---

## P-34 · Editor de PRICING POR TIERS (M2, v1.37-pricing-tiers)

**Alcance tocado:** SOLO `frontend/src/app/[locale]/(admin)/admin/m2/` + `types/contract.ts` +
`lib/api.ts` + `lib/mock/fixtures.ts` + `messages/{es,en}.json` + este doc. **NO** se tocó `(storefront)/`
ni `frontend/src/components/` (capa visual compartida bajo rediseño por otra sesión). Los componentes
visuales que necesité son **locales a M2** (`RuleCell` en `TierRulesSection`, badges/banners de conflicto);
solo se **importan** (lectura) los primitivos ya existentes de `@/components/ui/*`.

**Qué reemplaza:** el editor de ~30 reglas por rareza (`BuylistRulesSection` + `SalesRulesSection` +
`RuleAxisEditor`) fue **eliminado** y sustituido por dos secciones nuevas. El contrato v1.37 retira los
`PUT /admin/pricing/buylist-rules` y `/sales-rules`; el eje rareza ya no se edita por rareza suelta.

**Componentes creados (locales a M2):**
- `sections/TierRulesSection.tsx` — Sección 4. **5 filas por tier** (T0 Bulk, T1 Uncommon/Reverse, T2
  Rare/Holo, T3 Premium/Chase, T4 Ultra/Grail), cada fila con su regla de **COMPRA** y de **VENTA**
  (fijo MX$ / %). Eje **acabado** (`reverse_holo`/`holofoil`/`first_edition_holofoil`, buy+sell) y
  **fallbacks** por eje. Invariante visible: en tiers premium (T3/T4) el modo `fijo` de COMPRA está
  **bloqueado** (solo `%`) porque un bin fijo regalaría cartas caras. Consume `GET/PUT
  /admin/pricing/tiers`.
- `sections/TierMapSection.tsx` — Sección 5. **Asignador rareza canónica → tier**: un dropdown de tier
  por rareza (patch parcial: solo las cambiadas). Consume `GET/PUT /admin/pricing/tier-map`. Hospeda
  «Unificar rarezas» (§19.5), reubicado desde la difunta `BuylistRulesSection` (mismas keys i18n
  `admin.m2.unifyRarities`).
- `sections/tier-shared.tsx` — helpers locales: `TIER_ORDER`, `ruleToRaw`, `premiumFixedOffenders`
  (extrae `details.offending` del 422).

**Money-safe (UI):** el valor de regla se edita como **texto crudo** y se castea SOLO al guardar
(`sanitizeDecimalInput` + `isSaveableRuleValue` + `pesosToCents`, reusados de `sections/shared.tsx`); un
vacío/NaN **nunca** se persiste como MX$0 (Guardar se deshabilita y se explica por qué). buy `pct`
topado en `[0,100]`, sell `pct` (markup) en `[0,1000]`. Una rareza **sin tier** se marca como
**«Fallback (pendiente)»** con el dropdown vacío (no inventa un tier ni un $0); copy explícito de que un
`pct` sin referencia de mercado deja el precio **pendiente**, nunca $0.

**Manejo de 422:**
- `PREMIUM_RARITY_FIXED_TIER` (emitido por AMBOS PUT): banner de error que **lista los pares
  infractores** `(rareza premium → tierId)` desde `details.offending`; en el asignador la fila
  infractora recibe además un badge «En conflicto».
- `UNKNOWN_RARITY` (PUT /tier-map): mensaje claro vía catálogo i18n (`error.UNKNOWN_RARITY`).

**Cambios en `contract.ts` (alineado a v1.37):** `TierId`, `TierRuleDTO`, **`TieredRuleSet`**,
`UpdateTiersRequest`, `TierMapTierDTO`, `TierMapRowDTO`, `TierMapResponse`, `UpdateTierMapRequest`,
`PremiumRarityFixedTierDetails`.

**Cambios en `lib/api.ts`:** `getPricingTiers`, `updatePricingTiers`, `getPricingTierMap`,
`updatePricingTierMap` (con ramas mock ↔ `apiRequest` reales). Mocks money-safe en `lib/mock/fixtures.ts`
(seed que reproduce los defaults v1.9 LOCKED y preserva el invariante premium→`pct`).

**i18n:** `admin.m2.tierRules.*` y `admin.m2.tierMap.*` (es/en) + `error.PREMIUM_RARITY_FIXED_TIER` /
`error.UNKNOWN_RARITY`.

**Tests añadidos** (`M2View.test.tsx`, describe «Editor de precios por TIER (P-34, v1.37)»): render de
las 5 filas, guardar COMPRA de T0 (centavos), invariante premium→% (T3 sin opción `fijo`), money-safe
(vaciar → Guardar off), 422 PREMIUM_RARITY_FIXED_TIER en `/tiers`, asignar Common→T2 en `/tier-map`, 422
PREMIUM_RARITY_FIXED_TIER y UNKNOWN_RARITY en `/tier-map`, y money-safe del fallback pendiente. Se
retiraron los tests de los editores por rareza eliminados.

**Verde:** `tsc --noEmit` ✓, `vitest run` **72 archivos / 580 tests** ✓, `next build` ✓.

**Solicitud al arquitecto:** ninguna — el contrato v1.37-pricing-tiers cubre los 4 endpoints, los shapes
(`TieredRuleSet`, `TierMapRowDTO`) y ambos 422 con `details.offending`. No se necesitaron mocks fuera de
contrato ni campos nuevos.

---

## FE-1 (P-30 storefront) · Badge de singles: restaurado «Queda 1» (2026-08-22)

Regresión visual del rediseño marcada por QA + techlead en la adaptación P-30. Las tejas de **singles**
consumían `stockVariantFromCount` (mapeador del **sellado**: `count===1 → 'lastUnit'` = «Último»), lo que
contradecía DS §20.6 y el docstring de `CatalogView` («Queda 1»). Con el modelo agrupado de P-30
`stockCount===1` = «1 disponible ahora mismo» → variante `unique` («Queda 1», accent).

**Decisión de diseño (por qué DOS mapeadores y no uno):** `count===1` diverge por familia en DS §20.6 —
en singles es `unique` («Queda 1»), en sellado es `lastUnit` («Último», última de varias). Por eso se
introdujo `stockVariantForSingle(count)` (`0→soldOut`, `1→unique`, `N≥2→count`) junto al ya existente
`stockVariantFromCount` (sellado, `1→lastUnit`), en `_shared/StockBadge.tsx`.

- **Consumen `stockVariantForSingle`:** `CatalogTile`, `_home/GradedShelf`, `_home/FeaturedCarousel`,
  `catalog/[cardId]/CardDetailView`.
- **Siguen en `stockVariantFromCount` (sellado):** `_home/SealedShelf`, `sellado/SealedShopView`,
  `sellado/[inventoryItemId]/SealedDetailView`.
- **`lastUnit` se CONSERVA** (no se retiró): DS §20.6 la reserva para sellado. Ambas claves i18n quedan
  usadas — `stock.lastOne` («Queda 1») des-huérfana por singles, `stock.lastUnit` («Último») por sellado.
  Sin huérfanos en ninguna dirección. (No existe clave `home.lastOne`; la referida en el hallazgo es
  `stock.lastOne`.)
- El docstring de `CatalogView` («Queda 1» literal) **ya era correcto**; tras el fix el código concuerda,
  no requirió cambio. Se corrigieron comentarios «Último / N en stock» → «Queda 1 / N en stock» en las
  tejas de singles.

Test nuevo `_shared/StockBadge.test.tsx` (8 casos): afirma `stockCount===1 → «Queda 1»` (unique) para
singles y el contraste `availableCount===1 → «Último»` (lastUnit) para sellado.

**Verde:** `vitest run` **73 archivos / 593 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

**FE-2 registrada** en `TECH_DEBT.md` (Baja, dueño frontend, bloqueada por backend **H1**/arquitecto):
alinear el trato «desde»/sin IVA en singles cuando el rename `salePriceCents→fromPriceCents` llegue por
contrato. **FE-1 marcada RESUELTO.**

---

## P-36 · Fix stepper «Baja rápida» (QuickRemove) — bug reportado en prod

**Síntoma:** en «Baja rápida» del inventario admin (M1), los botones +/− de «CANTIDAD A DAR DE BAJA»
no cambiaban el número (carta con «1 piezas disponibles»).

**Causa raíz = caso (b), NO bug funcional.** Con `removableCount=1` el stepper queda topado en `[1,1]`
(min=max=1): ambos botones **deben** ser no-op y ya llevaban el atributo `disabled`. El
incremento/decremento funciona correctamente para `removableCount≥2` (cubierto por tests), y
`removableCount` está **bien calculado**: sale de `VariantDrawer` como
`rows.filter(status ∈ {in_stock,listed}).length` sobre piezas `ownerType=platform`; cada
`InventoryItemDTO` es UNA pieza física (no hay campo `quantity` que sumar), y el filtro respeta el
contrato (§ «solo platform + in_stock|listed son ajustables»). Es decir: la carta de la captura
**realmente** tiene 1 pieza ajustable → 1 es correcto.

**El defecto real era de UI:** los botones deshabilitados conservaban `hover:bg-surface-2`, que en
Tailwind se dispara al pasar el cursor **aunque** el botón esté `disabled` → el botón se «encendía»
bajo el puntero y se leía como *clickeable-pero-muerto*. El humano lo interpretó como «no responden».

**Cambio (`QuickRemove.tsx`, ambos botones):**
- `hover:bg-surface-2` → `enabled:hover:bg-surface-2` (el hover solo aplica cuando NO está disabled).
- Estado disabled más evidente: `disabled:border-border disabled:bg-surface-2 disabled:text-muted`
  (además del `disabled:opacity-45 disabled:cursor-not-allowed` que ya existía) + `aria-disabled`.
- Lógica del stepper intacta (ya era correcta): + sube hasta `removableCount`, − baja hasta 1.

**Money-safe intacto:** el envío sigue exigiendo `note` no-vacía + `batchKey` idempotente; el stepper
sigue capado a `removableCount`. No se tocó `removableCount` (estaba bien).

**Nota de borde (no bug):** `getAdminInventory` pide `pageSize:100`; una variante con >100 piezas
subcontaría `removableCount` — dirección **money-safe** (nunca ofrece bajar de más). Sin acción.

**Tests añadidos** (`QuickRemove.test.tsx`): caso P-36 (1 pieza → ambos botones `disabled`, el número
no cambia, CTA «Dar de baja 1» operativo) y multi-pieza (3 → + sube 1→3 y se deshabilita en el tope;
− baja 3→1 y se deshabilita en el piso).

**Verde:** `vitest run` **73 archivos / 595 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

---

## P-39 · Imagen de alta resolución en superficies prominentes + P-40 · Acabado visible

Ambos ajustes son **aditivos** sobre el rediseño ya mergeado (no rediseño): conservan tokens,
tipografía y layout del makeover.

### P-39 · `imageLargeUrl` en las vistas prominentes (fallback a `imageSmallUrl`)
El contrato **ya** expone las dos URLs en `CardDTO` (`imageSmallUrl`, `imageLargeUrl`), y
`GroupedListingDTO.card` es un `CardDTO`, así que ambas ya viajaban al front. No hubo cambio de
contrato ni de tipos.

- **Featured del home (`_home/FeaturedCarousel.tsx`):** las DOS tejas (hero grande y las numeradas
  secundarias) pasan de `imageSmallUrl` a `imageLargeUrl ?? imageSmallUrl`. Son piezas de showcase
  prominentes, no un grid denso.
- **Ficha de la carta (`catalog/[cardId]/CardDetailView.tsx`):** ya usaba `imageLargeUrl`; se añadió
  el fallback `?? imageSmallUrl` por robustez (nunca imagen rota si el backend emite null).
- **Grid del catálogo (`catalog/CatalogTile.tsx`): se CONSERVA `imageSmallUrl`.**
  **Decisión small/large (documentada):** el grid del catálogo es **denso** (muchas tejas por
  viewport); mantener la imagen chica ahorra ancho de banda y acelera el primer render. La alta
  resolución se reserva para superficies prominentes (featured y ficha). Comentario in-code en la teja.
- **Fallback:** en featured y ficha se usa `imageLargeUrl ?? imageSmallUrl` (si `imageLargeUrl` es
  null cae a la chica). `eslint` (solo `next/core-web-vitals`) no marca el `??` sobre tipo no-nulo.

### P-40 · Etiqueta legible de acabado (Normal / Reverse Holo / Holofoil)
- Las claves i18n **ya existían** (`finish.normal`, `finish.reverse_holo`, `finish.holofoil`, etc. en
  `messages/{es,en}.json`); no se agregó nada a los mensajes.
- **Nuevo componente `_shared/FinishLabel.tsx`:** etiqueta discreta (renglón mono muted, NO pastilla
  con caja — respeta la dirección 5a del rediseño que sustituyó las pastillas por texto mono).
  Devuelve `null` para `productType === 'sealed'` (sellado no tiene acabado de carta); defensivo,
  porque `GroupedListingDTO.productType` es `raw|graded` por contrato.
- **Featured (`FeaturedCarousel.tsx`): era el único hueco real** — las tejas no mostraban acabado.
  Se añadió `<FinishLabel>` en ambas tejas.
- **Catálogo (`CatalogTile.tsx`) y ficha (`CardDetailView.tsx`): YA mostraban el acabado** y se
  dejaron como estaban para no duplicar/ensuciar:
  - `CatalogTile` lo pinta vía `ListingSpec` (`RAW · NM · HOLOFOIL`, último segmento i18n).
  - `CardDetailView` lo pinta vía el `Fact` «Acabado» (primario) y el `ListingSpec` de cada grupo.
  No se tocó `ListingSpec` (vive en `components/domain/`, zona compartida de otros streams).

### Tests añadidos
- `_home/FeaturedCarousel.test.tsx` (nuevo): hero pinta `imageLargeUrl`; fallback a `imageSmallUrl`
  cuando `imageLargeUrl` es null; etiqueta de acabado (Reverse Holo / Holofoil) presente.
- `catalog/CatalogTile.test.tsx` (nuevo): el grid conserva `imageSmallUrl`; el acabado (Holofoil /
  Reverse Holo) aparece en la ficha técnica de la teja.

**Money-safe:** cambios puramente de display; no se tocan precios ni lógica de carrito.

**Verde:** `vitest run` **75 archivos / 601 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

---

## P-41…P-44 · Ajustes de UX del storefront (cotizador/catálogo) — un solo pase

Cuatro cambios ADITIVOS/de comportamiento; se conserva el visual del rediseño ya mergeado.
Solo `frontend/`. Money-safe: todo display/UX — no se tocan precios ni la cotización (los montos
siguen viniendo del server; la UI solo los MUESTRA).

### P-41 · Cotizador del home surtía corto (fix rápido)
- `_home/HomeQuoter.tsx`: la búsqueda del mini-cotizador pasó de `pageSize: 5` → **`20`**. Con 5,
  un nombre con muchas variantes (p. ej. 6 Tropius, «Pitch Black») dejaba fuera cartas de forma
  arbitraria (el corte desempataba por uuid de set). Sin cambio de backend/contrato.
- Se añadió el affordance **«Ver más en el cotizador»** (link `/buylist`) al pie del desplegable de
  resultados, para nombres con aún más variantes.

### P-42 · Carrito de venta fijo (desktop) + sombreado de lo agregado
- **Layout (`buylist/BuylistView.tsx`):** en **desktop (≥1024px)** el carrito de venta es un
  **PANEL FIJO a la derecha, a la par del grid** (2 columnas persistentes, `sticky`), reusando
  EXACTAMENTE el mismo `SellCartContents` que el drawer. En **móvil** se conserva el sheet (FAB +
  `SellCartDrawer`). La decisión de layout es **JS-driven** (`useMediaQuery('(min-width:1024px)')`,
  hook nuevo en `hooks/useMediaQuery.ts`): así el carrito se renderiza **UNA sola vez** (sin DOM ni
  focus-trap duplicados por breakpoints CSS). En jsdom `matchMedia` devuelve `matches:false`, por lo
  que la suite existente sigue corriendo la variante MÓVIL (FAB+drawer) sin cambios.
- **Sombreado:** `useSellCart` expone un predicado estable **`isInCart(cardId, productType, finish,
  productId?)`** (misma identidad que el dedup del carrito, sin la cantidad). Tras AGREGAR:
  - **grid raw (binder Master Set, `QuoterTile`):** la teja de esa (carta, acabado) se destaca
    (pozo de papel + regla de tinta) con la marca textual **«En el carrito»** (doble canal;
    `data-in-cart="true"` para pruebas). Se propaga `isInCart` por `MasterSetPanel → MasterSetBinder
    → QuoterTile` (prop opcional, solo modo `quoter`).
  - **grid plano (graded/sealed, `BuylistView`):** la teja se sombrea si CUALQUIER acabado está en
    el carro; además la fila del acabado agregado marca `✓` en lugar de `+`.

### P-43 · Click en la carta → pop-up de detalle
- Componente nuevo **`components/domain/CardDetailModal.tsx`** (reusa el `Modal` §7.6 → cierra por
  **backdrop + Esc + botón**, con foco/aria-modal). Muestra **imagen grande** (`imageLargeUrl` con
  fallback a `imageSmallUrl`) + datos (nombre, set·#, acabado, rareza, precio estimado). AGREGAR
  sigue siendo su propia acción, aparte del click de detalle (el arte es su propio `<button>`).
- **Cableado:** grid raw (`QuoterTile`, modal por teja) y grid plano (`BuylistView`, estado
  `detailCard` único). `TileHeader` (binder compartido) ganó `onImageClick` opcional: SOLO el
  cotizador lo pasa; el binder admin/bóveda NO (allí la teja entera ya es `<button>` → evita botón
  anidado).
- **Nota de imagen grande en el binder:** `MasterSetCardCellDTO` no lleva `imageLargeUrl`, pero el
  binder del cotizador se compone client-side desde `GET /buylist/cards` (`CardDTO` SÍ la trae), así
  que se propaga por un mapa client-only `imageLargeByCardId` en `QuoterBinderResponse` (sin tocar el
  DTO del contrato). En modos no-quoter no aplica (usarían la imagen chica como fallback).

### P-44 · Rareza en las tejas
- Componente nuevo **`components/domain/RarityLabel.tsx`** (gemelo de `FinishMark`: mono muted, sin
  pastilla; vive en `components/domain` junto al `FinishMark` canónico del rediseño). El VALOR de rareza es taxonomía ABIERTA de pokemontcg.io → se pinta crudo con
  `lang="en"` (no se traduce); lo único i18n es el prefijo accesible (`catalog.rarityAria` →
  «Rareza: …»). Devuelve `null` para sellado o rareza vacía.
- **Cableado:** `CatalogTile` (catálogo), grid plano del cotizador (`BuylistView`) y `TileHeader`
  del binder — este último COMPARTIDO, así que la rareza aparece también en el **binder admin M1 y
  las bóvedas** (lo pedido por P-44). Se lee de `CardDTO.rarity` / `MasterSetCardCellDTO.rarity`
  (ambos ya presentes en el contrato — **ningún DTO tuvo que cambiar**).

### DTOs y contrato
- **Todos los DTOs necesarios ya traían `rarity`, `imageLargeUrl`/`imageSmallUrl`** — no hubo que
  editar `docs/API_CONTRACT.md` ni `types/contract.ts` para datos. **Sin solicitudes al arquitecto.**
- Único matiz reportable (no bloqueante): el binder Master Set (`MasterSetCardCellDTO`) no expone
  `imageLargeUrl`; en el cotizador se resolvió client-side (ver P-43). Si en el futuro se quiere la
  imagen grande en el detalle del binder de INVENTARIO (M1/bóveda), habría que sumarla al DTO —
  eso sí pasaría por el arquitecto.

### Tests añadidos/ajustados
- `_home/HomeQuoter.test.tsx` (nuevo): la búsqueda pide `pageSize: 20`; affordance «Ver más» → `/buylist`.
- `buylist/BuylistView.test.tsx`: P-42 carrito fijo en desktop (mock `matchMedia` → sin FAB/drawer,
  total y CTA visibles sin abrir nada) + sombreado «En el carrito»; P-43 modal abre por click en el
  arte y cierra por backdrop y por Esc; P-44 rareza visible en tejas. Se acotó un assert previo de
  «Rare Holo» al diálogo del carrito (ahora la rareza también vive en las tejas).
- `components/domain/RarityLabel.test.tsx` (nuevo): valor crudo + aria localizado; null en sellado y
  en rareza vacía.
- `catalog/CatalogTile.test.tsx`: rareza visible con aria «Rareza: Rare Holo».

**Verde:** `vitest run` **77 archivos / 612 tests** ✓, `tsc --noEmit` ✓, `next build` ✓.

---

## Pase v1.41/v1.42 — sellado con identidad real + regresión de composición de variantes (rama `fix/variant-composition-regression`)

Consume los campos nuevos del contrato v1.41 (IMP-1) y v1.42 (BLOQ-2a/2b/3, menores) y cierra los
hallazgos del gate E2E. Todo confinado a `frontend/`. Money-safe respetado: sin precio ⇒ «pendiente»/«—»,
NUNCA $0.

### Tipos (espejo del contrato) — `src/types/contract.ts`
- +`SealedPriceSource = 'tcgcsv' | 'off'` (dial §M10).
- `SealedProductDTO` +`effectiveMarketCents: number | null` (autoritativo, gateado por `sealedPriceSource`);
  `marketRef` reetiquetado como INFORMATIVO.
- `SealedProductListResponse` +`sealedPriceSource`.
- `HoldingDTO` +`sealedProductId?/sealedProductName?/sealedImageUrl?/sealedCondition?` (solo sealed; display
  ya RESUELTO server-side por la cascada §4.34a).
- `PendingPriceEntryDTO` +`sealedProductId?/sealedProductName?/sealedSubtype?` (solo sealed).

### IMP-1 (v1.41) — dead-end del alta de sellado eliminado
`src/app/[locale]/(admin)/admin/m1/SealedAddFlow.tsx`
- La visibilidad del campo manual y el copy «valor de mercado» ahora KEYEAN en
  `selected.effectiveMarketCents` (autoritativo, gateado), no en `marketRef`/caché (`liveMarketCents`
  eliminado):
  - `gatedMarketCents = selected?.effectiveMarketCents ?? null` (~L175).
  - `showManualField = selected != null && gatedMarketCents == null && canManualMarket` (~L188).
  - `resolvedMarketCents = gatedMarketCents ?? (manualValid ? manualCents : null)` → pasa a
    `QuickAddSection.marketRefCents` (~L186, L419).
  - `manualMarketMxnCents` viaja solo si `gatedMarketCents == null && manualValid` (~L414).
  - `SelectedSummary` recibe `gatedMarketCents` y pinta el chip de mercado desde ese valor (~L370, L512).
  - `marketRef` queda como sugerencia informativa opcional cuando no hay mercado gateado, vía nuevo prop
    `suggestionCents`/`locale` de `SealedManualMarketField.tsx` (+ i18n `admin.sealedAdd.manualMarket.suggestion`).
- Invariante logrado: lo que la UI ofrece == lo que el backend acepta (con dial `off`, `effectiveMarketCents`
  es null ⇒ muestra manual; nunca promete un mercado que daría 422). Regresión cubierta por test nuevo
  «IMP-1 (dead-end): dial off …» en `SealedAddFlow.test.tsx`.

### BLOQ-2a (v1.42) — «Mis piezas» del cliente con identidad real del sellado
`src/app/[locale]/(storefront)/vault/VaultView.tsx` (~L280): para `productType==='sealed'`,
`displayName = sealedProductName ?? card.name`, `displayImage = sealedImageUrl ?? card.imageSmallUrl`.
raw/graded intactos. Mock: holding sealed `inv-1008` ganó identidad (`sealedProductName`/`sealedImageUrl`/…).

### BLOQ-2b (v1.42) — cola M2 muestra el nombre del sellado
`src/app/[locale]/(admin)/admin/m2/sections/PendingQueueSection.tsx`: helper `pendingDisplayName(e)` usa
`sealedProductName` para sealed; se aplica en ambas columnas (venta/compra) y en el modal de override.
Mock: entradas `ppe-3`/`ppe-4` (ETB vs blíster del mismo set) como pendientes SEPARADOS por `sealedProductId`.

### BLOQ-3 (v1.42) — el binder no muestra sellado como single
Mock `piecesOfScope` (fixtures) ahora EXCLUYE `productType==='sealed'` de los conteos del binder (platform y
user_vault), alineado con el backend. La UI del binder es data-driven (variants/countsByFinish) y no cuelga
tejas de sellado; el sellado se ve solo en M1›«Sellado» y bóveda›«Sellado».

### IMP-2 — badge «N EN TOTAL» ya no queda stale tras la baja
`src/components/master-set/MasterSetBinder.tsx` (`TileHeader`): el total por carta se DERIVA de
`countsByFinish` (que por contrato suma a `totalCount`), la misma fuente de la respuesta con la que cada
teja decide su conteo/«HUECO». Al bajar la última pieza, la suma cae a 0 y el badge desaparece sin recargar;
antes leía el escalar `cell.totalCount`, que podía quedar rezagado respecto a los conteos por acabado.

### Menores (display)
- M1›Sellado›lista de sets: se quitó el UUID interno pegado al nombre (`SealedTab.tsx` ~L106; solo el nombre).
- Badge «N SIN MAPEO» → «N sin precio» y enlace «Cola de no mapeados» → «Cola de precios pendientes»
  (i18n `admin.inventory.sealedTab.unmappedBadge`/`unmappedQueue`, es+en) — el dato cuenta piezas SIN PRECIO,
  no sin mapeo.
- Hero de «Compra»: «N piezas disponibles» → «N publicaciones disponibles» (i18n `catalog.piecesAvailable`,
  es+en) — el total es de publicaciones agrupadas (GroupedListing), no de piezas físicas.
- Ruido 401 en navegación admin: `src/lib/api-client.ts` gana REFRESH PROACTIVO — decodifica el `exp` del
  access JWT (`isAccessTokenExpired`, sin validar firma) y, si venció y hay refresh token, renueva ANTES de
  disparar la request (single-flight), evitando el 401 garantizado y su ruido en consola en cada navegación.
  El fallback reactivo 401→refresh→retry queda intacto. Causa raíz acotada en el cliente de API.

### Verde
`tsc --noEmit` ✓ · `vitest run` **78 archivos / 616 tests** ✓ (incluye test nuevo de regresión IMP-1) ·
`next build` ✓.

## Gate E2E pre-publicación — fixes (rama `fix/variant-composition-regression`)

### IMP-A — el stepper del carrito de venta ya no revienta la página con cantidades absurdas
`src/app/[locale]/(storefront)/buylist/useSellCart.ts`: teclear un número gigante (p. ej.
`646180157000000004`) en «Cantidad de {carta}» llegaba crudo hasta `requestItems`
(`Array.from({ length: l.quantity }, …)`, L159) y lanzaba `RangeError: Invalid array length`
(los arrays JS topan en 2³²−1) → «Application error», pantalla blanca. Fix money-safe (el monto lo
re-deriva el backend; esto es robustez de UI):
- Nuevo `MAX_LINE_QUANTITY = 999` (tope defensivo — no hay límite de stock explícito en el cotizador)
  y helper `clampQuantity(n)` → entero en `[1, 999]`, `NaN`→1.
- `setQuantity` clampa (cubre input numérico y botones ±, todos pasan por ahí), `mergeCartLine`
  clampa el `+1`, y `requestItems` clampa el `length` como última barrera. El `<input>` de
  `SellCartContents.tsx` gana `max={MAX_LINE_QUANTITY}`.
- Test de regresión en `BuylistView.test.tsx` («una cantidad gigante … se clampa al tope (999)»):
  el change no lanza, la vista sigue montada y la cantidad queda en 999.

### IMP-B — pagar antes de convertir ya no atora la carta en «Cerradas»
`src/app/[locale]/(admin)/admin/m5/M5View.tsx`: la rama «Cerradas» (~L675) renderizaba los ítems
read-only «sin acciones», así que tras «PAGAR POR SPEI» (solicitud → `pagada`) desaparecía «Convertir
a inventario» aunque el ítem siguiera `aprobada` y el backend SÍ lo permita (el guard de
`POST /admin/buylist/items/:id/convert-to-inventory` mira el `itemStatus`, no el estado de la
solicitud; contrato §M5 líneas 4694/4699: solo `aprobada` convierte). Fix:
- En «Cerradas», cada ítem con `itemStatus === 'aprobada'` (pagada la solicitud pero NO convertido)
  ofrece el botón «Convertir a inventario», que dispara el `convertMutation` existente (sin endpoints
  nuevos). Los `convertida_inventario`/`rechazada` no lo muestran (badge de estado ya los distingue).
- `convertMutation.onSuccess` ahora invalida también `['admin-buylist-closed']` para repintar el ítem
  como convertido sin recargar.
- Tests de regresión en `M5View.test.tsx`: (a) solicitud `pagada` con ítem `aprobada` → aparece el
  botón y el clic llama `convertBuylistItemToInventory('sr-c9-i')`; (b) ítem `rechazada` en «Cerradas»
  → NO ofrece convertir.

### Menores (display)
- **Quick-add de sellado (aportación bloqueada):** `QuickAddSection` es compartido entre el quick-add de
  variante M1 (sin campo manual inline → «fíjalo en la sección Precios») y el add-flow de sellado (con
  campo manual INLINE). Se agregó prop `hasInlineManualField` a `QuickAddSection`
  (`m1/QuickAdd.tsx`); `SealedAddFlow.tsx` la pasa como `showManualField`. Nuevo copy
  `admin.quickAdd.contrib.pendingBlockedInline` (es+en): apunta al campo manual de arriba en vez de
  mandar a otra sección. El hint `admin.sealedAdd.manualMarket.pendingIfEmpty` se realineó: ya no dice
  «la aportación quedará pendiente de precio» (contradecía la radio deshabilitada) sino que la aportación
  queda DESHABILITADA hasta capturar el precio manual de arriba.
- **Cola pendiente M2 pintaba «… #4» en sellado:** `m2/sections/PendingQueueSection.tsx` (ambas columnas
  venta/compra): el `#número` era el de la CARTA ANCLA, no de la pieza de sellado. Ahora solo se pinta
  para `productType !== 'sealed'`.

### Verde (gate pre-publicación)
`tsc --noEmit` ✓ · `vitest run` **78 archivos / 619 tests** ✓ (incluye los 3 tests nuevos de regresión
IMP-A/IMP-B) · `next build` ✓.

## Fix DISPLAY-1 — badge on-hand del binder era por CARTA, debe ser por ACABADO (regresión de IMP-2)

**Bug (prod, binder admin Master Set / M1):** al dar de alta 2 piezas de un acabado (p. ej. Spinarak
NORMAL), el badge negro «N EN TOTAL» aparecía en TODAS las tejas de esa carta —incluida la teja de un
acabado con **0 piezas** (REVERSE HOLO)—, pintando «2» donde no había ninguna pieza. El badge mostraba
el **total de la carta**, no el conteo del acabado de esa teja.

**Causa raíz** (`frontend/src/components/master-set/MasterSetBinder.tsx`, `TileHeader`, ~L648, código
de IMP-2): el badge se derivaba de `cell.countsByFinish.reduce((s,c)=>s+c.count,0)` = **suma de TODOS
los acabados**. Como `TileHeader` es COMPARTIDO por todas las tejas de una misma carta (N-16: una teja
por impresión), ese total de carta se repetía en cada teja de acabado. IMP-2 corrigió bien el *lag*
del escalar `cell.totalCount` (pasando a derivar de `countsByFinish` para que cayera a 0 en vivo), pero
mantuvo la **suma por-carta**, que es la semántica equivocada para una rejilla por-acabado.

**Fix (solo UI, sin backend):** el DTO YA trae el desglose por acabado
(`MasterSetCardCellDTO.countsByFinish: {finish,count}[]`, contrato L1016/L1057). `TileHeader` ahora
recibe el `finish` de su teja y lee `countsByFinish.find(c => c.finish === finish)?.count ?? 0`; si es
0 no pinta badge (la teja ya se muestra como «HUECO» por su footer). Se conserva la caída a 0 en vivo
de IMP-2 (misma fuente `countsByFinish` de la respuesta refrescada), pero **por acabado**. `BinderTile`
pasa `finish={variant.finish}` + `showFinishCount`; `QuoterTile` sigue SIN el flag (el on-hand no
aplica al cotizador).

- i18n (`messages/es.json` · `en.json`): se retiró `cardTotalCount`/`cardTotalCountAria` («N en total»
  / «N in total») y se añadió `finishOnHandCount` (badge visible = el número, `"{count}"`, para no
  colisionar con el «N piezas» del footer) + `finishOnHandCountAria` («Tengo N piezas de este acabado»
  / «You have N pieces of this finish», en el `title` del badge).
- Tests: nuevo `frontend/src/components/master-set/MasterSetBinder.test.tsx` (3 casos: Spinarak con 2
  NORMAL / 0 REVERSE HOLO → badge «2» solo en NORMAL, REVERSE HOLO = HUECO sin badge, y el badge de la
  carta no se repite entre tejas). Se actualizó el test INV-2 de `MasterSet.test.tsx` (Charizard 3/1/0
  → badge por acabado, holofoil sin badge, y el total 4 no aparece en ninguna teja) y el lock del
  cotizador (queda como «sin badge de on-hand por acabado» vía `title`).

**Money-safe:** es solo display de conteo de inventario; no toca precio ni dinero.

**Sin solicitud al arquitecto:** el contrato ya exponía `countsByFinish` desglosado por acabado; no se
necesita cambio de DTO ni de backend.

### Verde (gate)
`tsc --noEmit` ✓ · `vitest run` **80 archivos / 625 tests** ✓ · `next build` ✓.

---

## Consistencia del acento de acabado en las tejas del binder (Master Set) — spec humano 2026-08

**Petición del humano:** la línea/acento de color en la parte superior de las tejas del binder
(Master Set) debe ir **estrictamente por acabado (finish)** y ser CONSISTENTE en todas las vistas.
Spec: **reverse_holo → ROJO**, **holofoil → AZUL**, **normal → sin banda (como estaba)**.

### Causa de la inconsistencia reportada
El acento es la banda de 3px de `FinishBand` (`frontend/src/components/domain/FinishMark.tsx`). En el
código el color **ya dependía SOLO de `finish`** (no de la rareza, ni del orden, ni de la composición
de variantes de la carta): cada teja del binder plano se expande con `displayedVariants` y pinta
`<FinishBand finish={variant.finish} />` con su acabado propio. Es decir, NO había una rama por
composición. La percepción de «el color cambia cuando la carta tiene holofoil y reverse holo» venía
del mapeo de color en sí:
- `reverse_holo` era un **GRADIENTE** 90° `neutral-warm (#9A6C57) → accent (#B31217)`: el color varía a
  lo ancho de la banda según el tamaño de la teja, así que no leía como un rojo estable.
- `holofoil` y `first_edition_holofoil` compartían la **MISMA tinta oscura** (`--color-ink`): dos foils
  indistinguibles y ninguno azul.

Al ver una carta con holofoil (banda oscura) y reverse holo (gradiente marrón→rojo) juntas, las dos
bandas leían «muddy»/oscuras y el reverse «cambiaba de color» a lo ancho → percepción de inconsistencia.

### Qué se cambió (dónde se centralizó)
- **`frontend/src/components/domain/FinishMark.tsx`** — se centralizó el mapeo finish→color en UN solo
  lugar: la constante `FINISH_BAND_BACKGROUND` (Record parcial por `Finish`), consumida por `FinishBand`
  (que es la ÚNICA superficie que pinta el acento, usada por binder M1, bóveda cliente, bóveda admin,
  cotizador, línea del carrito de venta, `TopBountiesShelf` y `VariantDrawer`). Ninguna vista tiene
  lógica de color propia — todas heredan de aquí.
  - `reverse_holo → var(--color-finish-reverse, var(--color-accent, #B31217))` (ROJO **sólido**, ya no
    gradiente → color estable).
  - `holofoil → var(--color-finish-holo, #1F5C8F)` (AZUL).
  - `normal → sin banda` (sin cambio).
  - `first_edition_holofoil → var(--color-ink)` (sin cambio: no es reverse ni holofoil).
- **`frontend/src/app/globals.css`** — se añadieron dos tokens en `:root`:
  - `--color-finish-reverse: var(--color-accent);` (alias del rojo de marca).
  - `--color-finish-holo: #1f5c8f;` (**azul acero — TOKEN NUEVO**: no existía azul en la paleta
    paper/tinta/rojo/verde; se eligió apagado/acero para no romper el aire cálido vintage).

### Accesibilidad
El acento es doble canal: la banda (decorativa, `aria-hidden`) va acompañada SIEMPRE de la etiqueta de
acabado del `TileHeader` («REVERSE HOLO» / «HOLOFOIL»), así que el color no es el único canal. Rojo vs
azul es además un par seguro para daltonismo (a diferencia de rojo/verde).

### Tests
- `frontend/src/components/domain/FinishMark.test.tsx`: reverse_holo → banda SÓLIDA roja (sin gradiente),
  holofoil → banda azul (`--color-finish-holo`).
- `frontend/src/components/master-set/MasterSetBinder.test.tsx`: nuevo describe de composición mixta —
  una carta con normal + reverse_holo + holofoil a la vez pinta ROJO en la teja reverse y AZUL en la
  holofoil (independiente de la composición); la teja normal no lleva banda.

### ⚠️ Pendiente de ratificar por ux-ui (DESIGN_SYSTEM §16.6)
El color es dominio de `DESIGN_SYSTEM.md`. Se implementó el spec del humano y se **añadió un token nuevo
`--color-finish-holo` (azul #1F5C8F)** que NO existía en la paleta. **Falta ratificar en el sistema de
diseño** (§16.6 y §17.2): (a) la convención finish→color (reverse=rojo sólido / holofoil=azul), (b) el
retiro del gradiente reverse (§16.6 lo describía como «la única superficie con gradiente permitida» —
esa nota del DS queda desactualizada) y (c) el valor/nombre del token azul. **No edité DESIGN_SYSTEM.md.**

**Money-safe:** N/A — es solo color.

### Verde (gate)
`tsc --noEmit` ✓ · `vitest run` **80 archivos / 627 tests** ✓ · `next build` ✓.

---

## Control de UI del bulk price provider re-expuesto en M10 (P-47)

**Contexto.** El dial de la **ingesta masiva** de precios es `priceProvider`
(`SettingKey.PRICE_PROVIDER` / `price_provider`), DISTINTO de los tres `pricingProvider*` per-carta.
El backend ya lo expone en `GET /admin/settings` y valida `PUT` parcial contra
`PRICE_PROVIDER_VALUES = ['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']`, pero el UI de M10 no
renderizaba ningún control para él (el del bulk se había retirado de M2 en P-33). Faltaba el botón para
flipear el dial del barrido diario y activar el precio automático por-acabado (P-47, `tcgcsv_singles`).

**Qué se implementó (`frontend/src/app/[locale]/(admin)/admin/m10/M10View.tsx`).**
- Nueva **sección propia** (Sección 1b) en M10, VISUALMENTE SEPARADA de los tres diales per-carta
  (card con borde `border-primary/40`, encabezado y nota propios), para que el humano no los confunda.
  Etiqueta ES «Proveedor de ingesta masiva (barrido diario de precios)» + nota con los valores
  `pokemontcg_io` (legacy) / `pokemonpricetracker` / `tcgcsv_singles` (precio por-acabado diario, P-47)
  y el rollback money-safe = volver a `pokemontcg_io`. i18n en `messages/es.json` y `en.json` (bloque
  `admin.m10.ingest`).
- Conjunto de opciones **DEDICADO** `PRICE_PROVIDER_INGEST_OPTIONS =
  ['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']` — coincide EXACTO con
  `PRICE_PROVIDER_VALUES` del backend. **NO** reutiliza el `PRICE_PROVIDER_OPTIONS` per-carta (ese lleva
  `poketrace`/`manual`, que en el bulk darían 422).
- Read desde el DTO (`settings.data.priceProvider`) y **PUT parcial dedicado** que envía SOLO la key
  camelCase `{ priceProvider }` y solo cuando se toca (draft/mutation propios, botón Guardar propio).
- **NO se tocaron** los tres diales per-carta (`pricingProvider*`) ni su `PRICE_PROVIDER_OPTIONS`
  (`tcgcsv_singles` no va ahí).

**Tipo espejo.** `frontend/src/types/contract.ts` — `PriceProvider` pasó de
`'pokemontcg_io' | 'pokemonpricetracker'` a incluir `'tcgcsv_singles'` (espejo del contrato §M10 / P-47;
NO se modificó `API_CONTRACT.md`).

**Tests.** `M10View.test.tsx` +2 casos: (a) el control del bulk aparece, es `<select>` y lista
exactamente `['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']` (incluye `tcgcsv_singles`, excluye
`poketrace`/`manual`); (b) al cambiarlo el PUT envía `{ priceProvider: 'tcgcsv_singles' }` (camelCase,
parcial). Verde: `vitest run M10View.test.tsx` **7/7** ✓ · `tsc --noEmit` ✓.

**Money-safe.** El control solo cambia la fuente del barrido sin redeploy; el rollback documentado es
volver a `pokemontcg_io`. La derivación de montos sigue server-side; el UI solo selecciona el dial.
## §22 · T-1 (techlead) + IMPORTANTE-2 (QA) — la lista de sellado que tapaba el enum, y el modo E2E que no podía autenticar (2026-08-24, rama `claude/card-pricing-rules-2e537m`)

> Dos hallazgos del gate de release, del mismo tipo: **algo que no falla, MIENTE**. Uno en el
> producto (un filtro que descarta en silencio, una perilla de dinero sin fila) y otro en el arnés
> (un modo de prueba que no puede autenticar por construcción y aun así se anuncia como el más
> exigente). Fuentes: `API_CONTRACT` **v2.1.9** (§Enums, §DTOs, §M2, §4.34c) · `PROJECT §K`.

### T-1 · `SealedSubtype`: UNA lista, derivada del enum, en `src/types/contract.ts`

**Qué estaba roto.** El contrato define **siete** presentaciones (`box · etb · bundle · tin ·
blister · upc · collection`), el backend las acepta (`?sealedSubtype=upc` → 200, basura → 400) y el
`PUT /admin/pricing/sealed-spreads` ya calibra `upc`. El front tenía **tres listas de cinco escritas
a mano** que tapaban el tipo:

| Sitio | Consecuencia real |
|---|---|
| `m2/sections/shared.tsx` | el editor pinta **una fila por elemento** ⇒ **no había dónde teclearle el spread a UPC ni a Collection**. El dueño **sí vende UPC**. |
| `(storefront)/catalog/CatalogView.tsx` | `?sealedSubtype=upc` se **descartaba en silencio** |
| `(storefront)/sellado/SealedShopView.tsx` | ídem en el `<select>` de la tienda |

**No fue un descuido del front:** el ejemplo de respuesta de §M2 del contrato listaba cinco llaves y
el front lo espejó. El arquitecto ya corrigió el ejemplo y **normó que un ejemplo nunca es el dominio
de llaves** (v2.1.9). Aquí solo queda la mitad del cliente.

**Cómo quedó.**
- **`src/types/contract.ts`** — la lista es la **fuente única** y **la unión se DERIVA de ella**:
  `export const SEALED_SUBTYPES = [...] as const` + `type SealedSubtype = (typeof SEALED_SUBTYPES)[number]`.
  Desincronizar lista y tipo deja de ser posible por construcción. Orden = el **`sortOrder` canónico
  del contrato §4.34c** (`upc=0 … collection=6`), el mismo con el que el backend ordena las
  presentaciones: la UI lo espeja en vez de inventar tres ordenamientos.
- Los **cuatro** consumidores (los tres del hallazgo + `admin/m1/SealedAddFlow.tsx`, que ya tenía los
  siete por su cuenta) importan de ahí. Ninguno declara lista propia.
- **Copy:** los siete ya existían en `messages/{es,en}.json` › `status.sealedSubtype.*`. **Paridad
  es/en verificada** (mismas siete claves, mismos valores) y ahora **fijada por test**.

### T-1 (corrección del arquitecto) · los renglones salen del ENUM, no de las llaves de la respuesta

Arreglar la lista **no bastaba**: `GET /admin/pricing/sealed-spreads` devuelve un mapa **PARCIAL**
(omite lo no configurado) y **`upc`/`collection` no tienen semilla** en §K. Verificado contra el
stack vivo: `{"box":18,"etb":22,"tin":30,"bundle":25,"blister":35}` — sin `upc`. Un editor que
derivara sus renglones de la respuesta habría reproducido el hueco por otra puerta.

`m2/sections/SealedSpreadsSection.tsx`:
- **Una fila por valor del enum, siempre** — independiente de lo que traiga el `GET`.
- **Llave ausente ⇒ «Usa el global (25%)»**, no un vacío mudo ni un cero: el campo queda **vacío**
  con el global de **marca de agua** y una etiqueta que lo dice. Pintar el 25 como si fuera su valor
  es justo lo que ocultaba el fallback — el dueño no sabía que sus UPC caían ahí. **Ausente ≠ 0%**.
- La alarma money-safe de «spread 0%» ahora cuenta **solo reglas explícitas en 0**; el hueco→global
  ya no la dispara (antes tampoco, pero por accidente: el campo nunca estaba vacío).
- **Money-safe (nuevo):** el guardado usa `isSaveableRuleValue` + `sanitizeDecimalInput` (los mismos
  helpers de S-P1-1 que ya protegían las otras cajas de dinero de M2). Antes esta sección hacía
  `Number(val) || 0`: con el campo vacío ahora siendo el estado natural, eso habría **guardado 0%**
  (vender al costo) al limpiar una fila. Un borrador vacío o mal formado se **ignora**.

**✅ CONTESTADA (contrato v2.1.9 enmendado, `32484cd`) — ver §22.2.** El arquitecto normó el
sentinel `null`. Lo que aquí quedaba «se ignora, money-safe» ya es un gesto de primera clase.

**Tests.**
- `src/types/sealed-subtype.test.ts` — candado anti-desincronización: (a) la lista cubre
  **exactamente** el enum del contrato; (b) `upc`/`collection` presentes; (c) sin duplicados;
  (d) orden §4.34c; (e) etiqueta en **ambos** locales; (f) **ningún módulo bajo `src/` declara una
  segunda lista literal** (`: SealedSubtype[] =`) — verificado que ese guard **falla** si se
  reintroduce una. Además dos asignaciones de tipo que rompen `tsc` si lista y unión divergen.
- `m2/sections/SealedSpreadsSection.test.tsx` (7 casos): siete filas con un `GET` de cinco llaves;
  la fila sin regla vacía + placeholder + etiqueta; escribir en UPC llega al `PUT`; **una fila vacía
  NO se guarda como 0%**; hueco→global no dispara la alarma; un 0 explícito sí.
- `e2e/admin.spec.ts` › «hay fila editable para UPC y Collection» — corre en **los dos modos** (el
  fixture y el backend real omiten ambas llaves) y **verificado en verde contra el stack vivo**.

### Contrato v2.1.9 (D2) · las rejillas pierden `priceBasis` y `referenceValue`

`GET /catalog/cards` y `GET /catalog/sealed` pasan a emitir **DTOs propios**:
`GroupedListingSummaryDTO` y `SealedGroupSummaryDTO` (este último **también sin `priceSource`**, de
donde `priceBasis` se derivaba). Espejados en `src/types/contract.ts` como **tipos propios, no campos
opcionales**: un `priceBasis?` cuya ausencia apaga la regla de §N.7 es literalmente B-1
(`undefined === 'market'` ⇒ `false` **siempre** ⇒ el bloque no se muestra nunca, y en verde).

- Consumidores migrados: `catalog/CatalogTile.tsx`, `catalog/CatalogView.tsx` (`onAdd`),
  `_home/FeaturedCarousel.tsx` (`tileMeta`/`TilePrice`), `sellado/SealedShopView.tsx`
  (`SealedGroupTile`). **Ninguno leía los campos retirados** — la teja nunca pintó el mercado.
- Los fixtures de test de esas dos tejas se recortaron al DTO de rejilla **a propósito**: si mañana
  una teja leyera `priceBasis`, no compila.
- **La regla de la ficha NO cambia:** `priceBasis` sigue en `GroupedListingDTO`/`SealedGroupDTO`/
  `ListingDTO` y el mercado se muestra `iff priceBasis === 'market'`.
- El backend del stack vivo **todavía emite** los campos (va en paralelo); es inocuo: sobra en el
  JSON y el tipo ya no lo expone a ningún consumidor.

### Contrato v2.1.9 · `details.index` puede ser `null` + techo de cordura de piso/bin

- `CurveErrorDetails.index` pasa a **`number | null`**. Ningún consumidor lo indexaba (el front nunca
  trató `VALIDATION_ERROR` como infracción de curva), así que **no había `undefined` esperando**;
  se corrige el espejo y se documenta la lectura: `number` ⇒ marca el **renglón**, `null` ⇒ marca el
  **campo** de piso/bin.
- **Nuevo `constantError()`** (`curve/curve-draft.ts`) con `MAX_CURVE_CONSTANT_CENTS`
  (**MX$2,000** tras Q-D1 — ver §22.2). Piso y bin dejan de validarse con `marketError` (sin techo):
  son las dos únicas entradas que por sí solas fijan el precio de **todo** el catálogo. El
  `ConstantField` ahora **enuncia** el error (`role="alert"`), no solo colorea el borde. Copy nuevo
  `admin.m2.curve.fieldError.constantTooHigh` en **es/en**.

### IMPORTANTE-2 · el modo E2E «suite completa contra el stack real» no podía autenticar

**Diagnóstico (reproducido: 59 rojos de 85, idéntico al de QA).** `e2e/utils/auth.ts` derivaba
`IS_REAL` de `E2E_REAL`, que en `playwright.config.ts` es la bandera de **SELECCIÓN DE SPECS**
(`grep: /@real/`). Dos preguntas distintas viajaban en la misma variable:

```
(a) ¿QUÉ specs corro?          → E2E_REAL=1 ⇒ solo los @real
(b) ¿CONTRA QUÉ habla la APP?  → lo decide quién levantó el frontend
```

Con `E2E_BASE_URL` puesto y `E2E_REAL` ausente —el modo que el runbook vende como el más exigente—
el helper inyectaba el token **inventado** `'mock.session.token'` contra un front con
`NEXT_PUBLIC_USE_MOCKS=false`: 401 → el interceptor limpia sesión → `/login`, en bucle.

**Y no era solo local:** `.github/workflows/e2e-real.yml` (el gate de CI del smoke de dinero contra
el stack completo) fija `E2E_BASE_URL` y **NO** fija `E2E_REAL` — o sea que **el gate «real»
también autenticaba con el token de mentira**. El arreglo del helper lo corrige sin tocar `.github/`.

**Cómo quedó.** La pregunta (b) se contesta con la fuente correcta: `playwright.config.ts` hornea
`NEXT_PUBLIC_USE_MOCKS=true` en **un solo lugar** — el `webServer` que levanta él mismo, que solo
existe cuando `E2E_BASE_URL` está **ausente**.

```
sin E2E_BASE_URL (app la levanta Playwright) ⇒ MOCKS
con E2E_BASE_URL (app la levanta devops/QA)  ⇒ BACKEND REAL  → login real vía POST /auth/login
E2E_REAL=1                                    ⇒ implica real (compatibilidad) + filtra @real
E2E_MOCKS=1                                   ⇒ escotilla: app externa servida con fixtures
```

Otros cambios del helper, todos para que el modo real **funcione de verdad**:
- **Descubrimiento de la API**: `E2E_API_BASE_URL` gana; si no, se prueba `/health` (público) sobre
  el host del front en `:3099` (stack nativo) → `:3011` (staging/CI) → `:3001` (default del config).
  Si ninguna contesta, el error dice qué hacer en vez de un 401 tres asserts después.
- **Sesión memoizada por rol y por worker** (TTL 10 min contra el token de 15) **+ reintento con
  backoff ante `429`**. Sin esto, un login real por test hace que el `ThrottlerGuard` responda
  `429 RATE_LIMITED` a media suite: 8 rojos del arnés disfrazados de rojos de producto (los vi).
  El throttler es una defensa legítima del producto y **no se tocó**: se adaptó el arnés.
- **`credentialsFor(role)`**: el smoke «login se muestra y redirige» ahora **teclea credenciales del
  seed** en modo real. Antes usaba un par inventado ⇒ 401 ⇒ medía el arnés. Ahora ejerce
  `POST /auth/login` de punta a punta (**verde** contra el stack vivo, es/en).
- **`loginAs` donde faltaba**: `admin.spec` (8), `pricing-curve` (m2), `portfolio`, `vault`,
  `shipments`, `inventory-stream-b`. En modo mock los guards (`AdminShell`, `PrivateRouteGuard`) son
  **inertes** (`requireAuth = !config.useMocks`), así que estos specs navegaban a rutas privadas sin
  sesión y «pasaban»; contra el stack real eso es un redirect a `/login`.

### Clasificación honesta de lo que NO corre en el modo real

Un `skip` con motivo **impreso en el reporte** es una clasificación; 59 rojos indistinguibles no lo
son. Dos helpers **distintos a propósito** (`e2e/utils/auth.ts`):

- **`mockOnly(reason)`** — depende de algo que solo existe en mock: literales de
  `src/lib/mock/fixtures.ts` (`c-charizard`, `INV-000110`, `MX$4,800.00`, `mock-demo-token`) o una
  afordancia de **demo** (el switcher «Ver como», que en real no se pinta porque el rol lo dicta el
  JWT). **No puede correr contra un backend real sin reescribirlo.**
- **`needsSeed(reason)`** — el test está bien escrito y **falta el DATO** en `seed-e2e`. Pasaría tal
  cual el día que se siembre. Es una **petición accionable**, no una limitación.

**Regla que me impuse:** copy, i18n, navegación, guardas y desgloses **no** son mock-only. Si eso
falla contra el stack real es un desacuerdo de verdad y **tiene que verse rojo**. Los tres smokes de
dinero bloqueados por Stripe **se dejaron ROJOS a propósito** (ver abajo).

**Huecos del seed real detectados (petición a backend/QA, `backend/prisma/seed-e2e.ts`):**

| Hueco | Verificado contra el stack vivo | Deja sin cubrir |
|---|---|---|
| Sin solicitudes de buylist | `GET /admin/buylist` → `total: 0` | M5 cherry-pick + diálogo de rechazo v1.18 |
| Sin disputas | `GET /admin/disputes` → `total: 0` | M8 (el panel de evidencia cuelga de la disputa activa) |
| Sin sellado publicado | `GET /catalog/sealed` → `total: 0` | vitrina `/sellado` completa |
| Gradeada sin referencia de mercado | el grid de buylist pinta «Precio pendiente» | estimado de gradeadas (el «pendiente» es **correcto**: sin dato no se inventa cifra) |

### Números del modo `E2E_BASE_URL` sin `E2E_REAL` (suite completa contra el stack vivo)

Comando: `cd frontend && E2E_BASE_URL=http://localhost:3000 npx playwright test` contra el stack
nativo vivo (`:3000` front con `NEXT_PUBLIC_USE_MOCKS=false` · `:3099` backend).

| Corrida | Verdes | Rojos | Saltados (clasificados) |
|---|---|---|---|
| **Antes** (reproducción exacta del reporte de QA) | 26 | **59** | 0 |
| Con el env-gating + los `loginAs` que faltaban | 39 | 33 (**8** de ellos `429` del propio arnés) | 14 |
| **Final** (`--workers=1`) | **48** | **3** | **35** (31 `mock-only` + 4 `needsSeed`) |

**Los 3 rojos que quedan son los MISMOS y son de ENTORNO, no de producto:** los smokes `@real` de
comprar / comprar como invitado / retirar. Causa verificada a mano contra el backend vivo:

```
POST /api/v1/checkout/session → {"code":"PAYMENT_PROVIDER_UNAVAILABLE"}
```

No hay clave de Stripe en este stack. **Se dejaron rojos a propósito** (ver el comentario en los tres
specs): un smoke de dinero que se salta solo cuando no hay proveedor de pago es la misma clase de
mentira que este encargo vino a quitar.

**Flakiness bajo paralelismo (no es producto):** con `--workers=3` y la suite completa aparecen 2
rojos extra e intermitentes (`i18n-locale` ×2, `auth login [es]`) — el toggle de idioma navega a una
ruta que **`next dev` compila bajo demanda** y con tres workers golpeando el mismo dev server la
compilación pasa de los 15 s del `expect`. Con `--workers=1` pasan las tres; con `--workers=3` pero
menos archivos, también. Contra un build de producción no debería ocurrir. Si se quiere el modo
paralelo estable, el camino es `next build && next start` en el stack, no subir timeouts.

**Ningún rojo resultó ser un desacuerdo real entre frontend y backend.** Los dos hallazgos que sí
salieron de aquí son (1) el gate de CI `e2e-real.yml` autenticando con token de mentira y (2) los
cuatro huecos del seed de la tabla de arriba.

### Trampa del entorno: `reuseExistingServer`

`playwright.config.ts` levanta su webServer con `reuseExistingServer: !isCI` en `:3000`. Si el stack
nativo ya ocupa `:3000` con `NEXT_PUBLIC_USE_MOCKS=false`, una corrida **sin** `E2E_BASE_URL`
**reutiliza ese servidor**: crees estar en modo mock y estás pegándole al backend real sin sesión.
Para correr mock de verdad hay que bajar el stack o apuntar el front a otro puerto. (Lo dejo
anotado aquí porque me costó un falso negativo; el runbook lo mantiene devops.)

## §22.2 · Contrato v2.1.9 enmendado (`32484cd`) — el techo baja a MX$2,000 y el borrado se llama `null` (2026-08-25)

> Tres encargos, dos del contrato enmendado y uno de devops sobre mi propio arreglo del arnés.

### El techo de la curva vive en DOS lados y tiene que decir lo mismo

`MAX_CURVE_CONSTANT_CENTS` pasa de `1_000_000` a **`200_000` (MX$2,000)**, el número que cerró el
dueño en **Q-D1**. Es mi copia del techo del backend, y ahí está el punto: si el cliente aceptara en
el campo un piso de MX$5,000 que el `PUT` rechaza con `422`, **cliente y servidor estarían
discrepando sobre la misma regla** — §21.4 con el signo invertido (el editor promete un guardado que
no ocurre). Van los dos con el mismo valor.

El anclaje nuevo, que además es el que hace defendible un número tan apretado: **`floorCents` ES el
precio de la carta más barata de la tienda**, así que su techo sale de lo plausible como carta más
barata (**80×** sobre la semilla de MX$25), no de ningún límite de dinero. El anclaje anterior —los
topes AML de §E— **queda retirado por escrito** en el contrato, y lo repito en el comentario del
código para que nadie lo «restaure» viendo que las cifras se parecían.

- Copy actualizado en **es/en** (`constantTooHigh`): ya no dice MX$10,000, y explica *qué* es el
  número acotado, no solo cuál es.
- **`curve/curve-constants.test.ts` (5 casos)** fija la cifra, el borde exacto (2000 pasa, 2000.01
  no), que no se pierden `required`/`negative`, que las semillas (piso MX$25, bin MX$1) siguen
  entrando, y —el que más me importa— **que el copy nombre el MISMO número que el validador**: un
  mensaje que dice 10,000 junto a un corte en 2,000 es peor que no tener mensaje.
- **Estado del backend en el stack vivo:** todavía acepta `floorCents: 500000` en `preview` (`201`).
  Mi editor queda **más estricto que el servidor corriendo**, que es la dirección segura; converge
  cuando backend lo aterrice.

### Borrar una regla de spread: `null`, y **`null` ≠ `0`**

El contrato normó lo que yo había pedido. Semántica **parcial de tres estados**, y el editor ahora
los distingue de verdad:

| Gesto en la pantalla | Qué viaja | Efecto |
|---|---|---|
| Escribe un número | `{"upc": 20}` | fija la regla |
| **Vacía el campo** | **`{"upc": null}`** | **retira** la regla ⇒ vuelve al global |
| No lo toca | la llave **no viaja** | no se toca |

**Esto conecta con la mina que ya había desactivado.** Yo había matado el `Number(val) || 0` de
`saveSpreads` porque con el campo vacío como estado natural, limpiar una fila habría guardado **0%**.
El contrato ahora le pone nombre a por qué eso era un bug de dinero y no un detalle: **`0` es un
spread legítimo** (§SUP-8, «vender AL mercado, sin markup»), así que `0` y «sin regla» **no pueden
compartir representación**. Antes yo resolvía el empate ignorando el gesto (seguro pero mudo: el
dueño vaciaba y no pasaba nada); ahora el gesto significa algo y significa lo correcto.

- **El `PUT` pasa a ser PARCIAL de verdad**: viajan **solo las llaves tocadas**. Antes mandaba
  `{...server, ...draft}` — funcionaba, pero es la forma que el arquitecto descartó, y por una razón
  que me toca directo: un cliente rancio con «las cinco llaves de siempre» **borraría `upc` y
  `collection` en silencio**, o sea el bug de la lista de cinco reabierto desde el otro lado.
  `fallbackPct` solo viaja si cambió. Si no cambió nada, no se llama al endpoint.
- **Un borrador mal formado (`"."`, `"1.2.3"`) no manda NADA** — ni fija ni retira. El dueño está a
  medio teclear y ninguna de las dos cosas es lo que pidió.
- **Vaciar una fila que nunca tuvo regla propia no manda nada**: no hay qué retirar (el backend sería
  idempotente igual, pero ensuciar la bitácora con un no-op no ayuda a nadie que la lea después).
- **La fila vaciada se previsualiza como «Usa el global»**, igual que una sin regla: los dos estados
  terminan en el fallback, así que la pantalla cuenta lo mismo en los dos — y **ninguno es un 0%**.
- **El global NO se puede vaciar** (`fallbackPct: null` ⇒ 422). Retirarlo dejaría en `PRICE_PENDING`
  a toda presentación sin regla, o sea **fuera de la vitrina**, por un gesto que parece de limpieza.
  El editor lo **impide** (Guardar deshabilitado, `aria-invalid`) **y lo explica**: «El spread global
  no se puede quitar… Para no aplicar markup, escribe **0**». Antes revertía en silencio al valor del
  servidor — seguro, pero el dueño no se enteraba de que su gesto no había hecho nada.
- El **mock** reproduce la semántica de tres estados (`setMockSealedSpreads` aplica el parche y
  **borra** en `null`). Si el mock guardara `null` como 0, el modo demo enseñaría un comportamiento
  de dinero que el backend real no tiene — y esa divergencia, en una perilla de precio, no se puede.
- Tipos: **`SealedSpreadsUpdateRequest`** (request) separado de **`SealedSpreadsDTO`** (respuesta).
  Son tipos distintos porque **la diferencia es el punto**: solo el request admite `null`.
- **Estado del backend en el stack vivo:** `PUT {"spreadPctBySubtype":{"collection":null}}` responde
  **`422`** («must be a number in [0, 1000]»), así que el gesto de *vaciar* aún no funciona
  end-to-end. Probado con una llave **ausente** a propósito, para que fuera un no-op verificable:
  el `GET` posterior devolvió el mismo mapa. Las demás rutas (fijar, cambiar el global) sí funcionan
  hoy. Las dos mitades tienen que aterrizar juntas para que «vaciar» sirva.
- El dueño ya eligió **`upc: 18`, `collection: 22`**; en el stack vivo la semilla todavía no está
  (el `GET` sigue trayendo cinco llaves) y el editor los muestra como «usa el global», que era el punto.

### El spec que le preguntaba al entorno en vez de al helper (hallazgo de devops)

`guest-checkout.spec.ts` ramificaba con **`process.env.E2E_REAL` crudo** — el único sitio de `e2e/`
que lo hacía. Sin la bandera puesta tomaba la **rama mock de sus asertos** (clic en el «Pagar»
simulado y esperar `guest-order-number`) **contra un modal de Stripe real**: exactamente la clase de
mentira que el arreglo del env-gating fue a matar, un piso más abajo, y **un verde falso en uno de
los tres flujos de dinero** — justo el que el gate de promoción acababa de empezar a correr.

Ahora usa `IS_REAL` como sus hermanas. Con eso, `frontend/e2e/` deja de obligar a `.github/` a fijar
`E2E_REAL` **solo para que un archivo se comporte**: la bandera vuelve a significar únicamente lo que
`playwright.config.ts` dice que significa (seleccionar `@real`).

**`src/test/e2e-harness.test.ts` (2 casos)** lo vuelve irrepetible: ningún `*.spec.ts` puede leer
`process.env.E2E_REAL` (ignorando comentarios, porque explicar *por qué* no se usa sí debe seguir
escrito), y quien ramifique por entorno tiene que **importar `IS_REAL`** del helper. Verificado que
el guard **falla** al reintroducir la fuga. La regla, en una línea: **un solo módulo lee la variable;
los specs le preguntan a él.**

### Verde (gate)

`tsc --noEmit` ✓ · `next lint` ✓ · `vitest run` **84 archivos / 677 tests** ✓ · E2E contra el stack
vivo (`admin` + `pricing-curve`): **13 verdes / 0 rojos** (6 saltados, clasificados).

---

## v1.50.3-e2e — El gancho de grading entra al gate, y el gate deja de depender de los núcleos

> **Rechazo de QA (dos bloqueantes, ambos del arnés, ninguno de producto).** QA verificó **en vivo**
> que la feature funciona: el `intent` viaja, la sección de captura existe y su pre-vuelo bloquea el
> grado con slab, la lista de revisión cumple sus cuatro reglas y las traducciones están. Lo que
> **no** existía era una prueba automatizada que lo dijera contra el stack corriendo.

> **Rótulo de nomenclatura (añadido 2026-08-31).** Esta entrada es de **v1.50.3-e2e** y nombra el dial
> `gradedEstimatesEnabled`, que era el correcto **en esa fecha**. **M-46 lo renombró a
> `gradingHookEnabled`** y el arnés dejó de poder encenderlo sin precondición verificada (**§31**). Se
> conserva el nombre viejo porque describe lo que el arnés hacía entonces, no lo que hace hoy.

### 1. El bloqueante real: la feature no estaba en el gate (no eran «9 rojos»)

Los 9 specs de `grading-estimate.spec.ts` navegaban a **ids de fixture** (`c-blastoise`,
`c-milotic-fa`, `c-eevee`, `c-pikachu`) y asertaban **montos de fixture** (`MX$29,000.00`), sin
declarar `mockOnly`. Contra el stack vivo eso son 9 rojos, sí — pero el daño de verdad es otro:

- **en modo mock**, el gancho se probaba contra **sus propias simulaciones**;
- **en modo real**, las dos únicas specs escritas de forma agnóstica (la captura de back-office y la
  lista de revisión) llevaban `mockOnly` y se **saltaban** ⇒ **no se probaba nada**;
- el subset **`@real`**, que es el gate que corre contra la plataforma levantada, **no contenía ni un
  solo test del gancho**.

Un «97/97» medido en modo mock es cierto y **no puede emitir veredicto** sobre esta feature. QA tenía
razón: la cobertura que suplió a mano no queda cableada en CI, así que no cuenta.

#### Qué se hizo: reescribirlos agnósticos (la opción cara), no taparlos con `mockOnly`

`e2e/utils/grading.ts` resuelve **qué cartas usar** según el entorno:

| | MOCK | REAL |
|---|---|---|
| origen de las cartas | ids de `src/lib/mock/fixtures.ts` | **descubiertas** de `GET /catalog/cards` |
| origen de las cifras | fixtures | **sembradas por la API del contrato** |
| oráculo del gate | fixture `mockGradingShowcaseCardIds` | **`GET /admin/pricing/graded-estimates/preview`** |
| I/O | ninguno | login admin compartido + 5 llamadas |

La siembra usa **exactamente los endpoints que usa el back-office**, no una puerta trasera:
`PUT /admin/settings { gradedEstimatesEnabled: "on" }` (interruptor maestro §M10, seed `off`
fail-closed) y `POST /admin/pricing/override` con **`intent:"graded_estimate"`** — que es, por
§O.6/decisión 47, **la captura de fase 1 del gancho**. Sembrar por ahí ejercita de punta a punta la
vía que el producto usa de verdad, incluida la obligatoriedad de `intent` (§4.38l); un seed con la
fila ya puesta probaría **menos**.

**Ningún monto se hornea.** Los importes se derivan de los **diales vivos** del entorno
(`minUpsidePct`, `gradingCostTiers`, `maxRawMultiple`), resolviendo el escalón de costo por valor
declarado igual que §O.2.1, y con holgura para no quedar en el filo de un redondeo. Quien dictamina
si la carta quedó destacada **no es el test**: es el backend, vía `preview` (`eligible` + `reason`).
El test **elige datos**; el gate lo evalúa el servidor. Si la siembra no consigue dejar la carta
elegible, el helper **falla ahí** con el `preview` completo en el mensaje, no tres asserts después.

**Los asserts pasan a ser de ESTRUCTURA**: una cifra por grado del dial `grades` (contada sobre el
texto renderizado, no con `getByText(MONEY_RE).count()` — el selector de texto casa también
contenedores intermedios y aquí el número exacto *es* la aserción), `MX$…` por formato, y el
condicional de la teja derivado de la **clave i18n** (`catalog.gradingBadge.figure` cortada en su
`<approx>`), nunca copiado a mano.

**Resultado: el subset `@real` pasa de 0 a 11 tests del gancho** — ficha (4), teja de Compra (3),
vitrina del home (2) y back-office (2) —, y **los mismos asserts** corren en los dos modos.

#### Huella en el entorno, declarada

- El dial `gradedEstimatesEnabled` se enciende y **se restaura en `globalTeardown`**
  (`e2e/global-teardown.ts`), leyendo el valor previo de un archivo de estado. Se hace ahí y **no en
  un `afterAll`** a propósito: `afterAll` corre **por worker** y apagaría el interruptor con otros
  workers todavía navegando. Verificado en vivo: tras la corrida, `GET /admin/settings` devuelve
  `gradedEstimatesEnabled = off`.
- Las `PriceReference` de estimado **quedan escritas**: el contrato **no expone borrado**. La siembra
  es **idempotente** (un override posterior supersede al anterior) y con el dial en `off` nada de eso
  se publica. Ver «Peticiones al arquitecto» abajo.

#### Lo que sigue sin poder correr en real, y por qué (clasificado, no escondido)

| Caso | Marca | Motivo |
|---|---|---|
| Pre-vuelo del grado con slab (§O.8 / INV-D) | `mockOnly` | `publishedSlabGrades` viaja **por grupo raw**; hace falta una carta con **raw publicado Y slab publicado del mismo grado**, y el seed sintético no la tiene (su única gradeada no tiene raw publicado). El test además asserta el copy del 409 con literales de fixture. **La cobertura real de esa superficie no se pierde**: la da el nuevo test `@real` de captura. |
| Lista de revisión: default vs opt-in por conjunto de cartas | `mockOnly` | el conjunto marcado es dato de fixture. Sustituido en real por un test que **compara el resumen de la UI contra la respuesta del contrato** (`total`/`scannedCards`, y el aviso de truncado ausente si el backend no truncó). |
| «Dos grados con dato y sin destacar» | `needsSeed` | el seed sintético solo tiene **dos** cartas raw publicadas; con dos no se pueden tener a la vez «un solo grado» y «dos grados sin destacar». |

#### Candado para que no vuelva a pasar

`src/test/e2e-harness.test.ts` gana dos casos: (1) `grading-estimate.spec.ts` debe conservar
cobertura `@real`; (2) **ningún test que navegue a un id de fixture (`/catalog/c-…`) puede correr en
real sin declararse `mockOnly`/`needsSeed`**. Es el mismo patrón del candado de `process.env.E2E_REAL`:
la regla deja de depender de que alguien se acuerde.

### 2. El otro bloqueante: «un gate cuyo verde depende de cuántos núcleos tenga la máquina no es un gate»

`loginAs` memoizaba la sesión en un `Map` **a nivel de módulo** ⇒ **por worker**, que en Playwright es
un **proceso**. Con `fullyParallel: true` y `workers: undefined` fuera de CI eso son
**`roles × núcleos`** canjes contra `POST /auth/login`, que el backend limita —legítimamente— a
**5/min por IP** (`@Throttle({ ttl: 60_000, limit: 5 })`, `auth.controller.ts`). Desde dos núcleos la
suite se comía su propio cupo: `429 RATE_LIMITED` en `checkout.spec.ts:12/87/100`, y el login del
stack inservible ~60 s para quien estuviera mirando en paralelo.

**El throttler no se toca** — es una defensa legítima del producto y el pentester la va a querer viva.
Lo que se arregla es el arnés:

- **`e2e/utils/state.ts` (nuevo)** — estado compartido **entre procesos**: caché en disco con
  escritura atómica (`rename`), exclusión mutua con **`mkdir`** (atómico; `writeFile` no lo es),
  detección de candado rancio, y `sharedOnce` con **doble comprobación** dentro del candado. Ese
  segundo `readState` es lo que evita la estampida: los N-1 workers que esperaban encuentran el valor
  ya publicado y **no** recalculan.
- **`e2e/utils/env.ts` (nuevo)** — se extrae de `auth.ts` todo el plumbing de entorno (`IS_REAL`,
  credenciales, resolución de la API, canje de token, helpers `apiAs`/`apiAsOk`) **sin importar
  `@playwright/test`**, para que el `globalTeardown` —que corre fuera del runner— pueda reutilizarlo.
  `auth.ts` mantiene todos sus exports: ningún spec cambia sus imports.
- **Cota dura: 3 logins por API y por corrida** (uno por rol), **independiente de los núcleos**.
- La caché se valida por el **`exp` real del JWT** (no solo por la edad del archivo), con 3 min de
  colchón sobre los 15 min del contrato: una corrida que reutiliza estado de otra reciente no arranca
  con un token muerto y no vuelve a fabricar el 401 silencioso.
- El **backoff ante `429` cubre >60 s** (6 intentos: 1+2+4+8+16+32 s) — la ventana **completa** del
  throttler. El anterior (4 intentos, ~15 s) se rendía **dentro** de la ventana: por eso «reintentaba,
  pero no lo suficiente». Solo el 429 se reintenta; un 401 es credencial mala y reintentarlo solo
  gasta cupo.

**Presupuesto de logins de la suite completa en real:** 3 (API, compartidos) + 2 (formulario, los dos
`login se muestra y redirige [es|en]` de `auth.spec.ts`, que **deben** teclear credenciales reales)
= **5**, que es exactamente el cupo. Si alguien añade otro login por formulario, hay que etiquetarlo
o subir el límite en el entorno de pruebas. Queda anotado aquí para que no se descubra por sorpresa.

### 3. El `webServer` de Playwright: build de producción y nada de reutilizar lo que haya

`playwright.config.ts` usaba `command: 'npm run dev'` + `reuseExistingServer: !isCI`. Dos trampas
encadenadas:

1. **`next dev` no es la app que se despliega** (otro compilador, sin `NODE_ENV=production`, otro
   comportamiento de RSC/caché). Un verde en `dev` no autoriza un deploy.
2. **`reuseExistingServer: true` fabrica falsos verdes silenciosos**: si en :3000 ya hay un Next
   —el del stack real de devops, por ejemplo—, Playwright **no** levanta el suyo, **no** aplica
   `NEXT_PUBLIC_USE_MOCKS=true`, y la suite «de mocks» corre contra el backend real sin decirlo.

Ahora: **`next build && next start`** y `reuseExistingServer: false` salvo opt-in
(`E2E_REUSE_SERVER=1`); `E2E_DEV_SERVER=1` recupera `next dev` para iterar en local (no es el gate).

Y dos parámetros nuevos que **hacen posible correr los dos modos en la misma máquina**, que es como
se verifica de verdad:

- **`E2E_MOCK_PORT`** (default `3000`) — el server de mocks ya no choca con el stack real.
- **`NEXT_DIST_DIR`** (`next.config.mjs`) — el bundle de mocks se hornea en **`.next-e2e-mock`**.
  Es indispensable: `NEXT_PUBLIC_USE_MOCKS` **se hornea en el artefacto**, así que compilar los mocks
  sobre `.next` convertiría en modo-fixtures el `next start` que devops tenga corriendo. Añadido a
  `frontend/.gitignore`, y `.next-e2e-mock/types/**` queda pre-registrado en el `include` de
  `tsconfig.json` para que `next build` no reescriba (y reformatee) ese archivo en cada corrida.

### Verificación (números reales de las dos corridas)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | ✓ |
| `npx next lint` | ✓ sin warnings |
| `npx vitest run` | ✓ **90 archivos / 753 tests** |
| `npx next build` | ✓ (verificado con `NEXT_DIST_DIR=.next-e2e-verify` para no pisar el `.next` del stack vivo) |
| **MOCK** — `E2E_MOCK_PORT=3010 npx playwright test` (build de producción + `next start`) | **98 passed / 0 failed / 2 skipped** (los 2 saltados son los `realOnly`, que por definición no corren aquí) |
| **REAL** — `E2E_BASE_URL=http://localhost:3000 npx playwright test` (4 workers, stack vivo) | **59 passed / 3 failed / 38 skipped** |
| **REAL, segunda corrida consecutiva** | **59 / 3 / 38** — idéntica |
| **Gate `@real`** — `E2E_BASE_URL=… E2E_REAL=1 npx playwright test` | **21 passed / 3 failed** de 24; **11 de los 21 son del gancho** (antes: 0 tests del gancho en el subset) |

Los **3 rojos en real** son el hueco de entorno preexistente de **Stripe** (`checkout.spec.ts:57`,
`guest-checkout.spec.ts:131`, `shipments.spec.ts:30`: el modal de pago no abre sin claves de Stripe).
**No queda ningún rojo de los 9 del gancho ni de los 3 del throttler.** Comprobado además el síntoma
que QA midió desde fuera: **inmediatamente** después de la suite, tres `POST /auth/login` manuales
seguidos devuelven `200`, `200`, `200` — antes quedaba `429` ~60 s.

### Peticiones al arquitecto (no se toca `API_CONTRACT.md`)

1. **Borrado/retirada de una `PriceReference` de estimado.** El contrato dice que el override manual
   «solo lo revoca otro override o la limpieza/borrado explícito de la fila por `super_admin`», pero
   **no hay endpoint** para esa limpieza. Sin él: (a) el back-office no puede *quitar* una cifra
   errónea, solo pisarla —y la lista de revisión (§111(e)) dice explícitamente «se corrige
   recapturando el estimado, **o borrando el dato**», un gesto hoy imposible por API—; y (b) el arnés
   E2E no puede dejar el entorno como lo encontró. Propuesta: `DELETE /admin/pricing/override`
   (o `.../graded-estimates/:cardId/:gradeKey`), `super_admin`, auditado, con la misma guarda INV-D.
2. **Seed sintético — dos filas que faltan** (petición a backend vía arquitecto, `seed-e2e.ts`):
   - una carta con **grupo raw publicado Y slab publicado del mismo grado** ⇒ desbloquea el
     pre-vuelo de §O.8/INV-D y el `SLAB_PUBLISHED` de la lista de revisión en modo real;
   - una **tercera carta raw publicada** ⇒ permite cubrir a la vez «un solo grado» y «dos grados sin
     destacar» sin que un caso pise al otro.
   Los tests ya están escritos y marcados `needsSeed`: pasarán el día que existan las filas.

---

## v1.50.3-d · «Retirar» — el consumidor del `DELETE` que mi propio hallazgo pidió (2026-08-29, rama `claude/psa-graded-card-value-gmhv5u`)

**Qué se entrega.** La **acción de retirar** un estimado en la lista de revisión de M2, consumiendo
`DELETE /api/v1/admin/pricing/graded-estimates/:cardId/:gradeValue` (contrato §M2 v1.50.3-d,
`super_admin`, auditado), **más** las dos mitades de v1.50.3-c que el front aún no consumía y sin las
cuales el botón no sirve para su caso central: el **opt-in `?reason=STALE`** y el campo **`isManual`**.

### Por qué el botón entra en la misma entrega que el endpoint

Porque enviar el endpoint sin superficie repetiría **exactamente** el error que esta ronda corrigió:
construir el detector y dejar al operador sin la herramienta. La justificación entera del `DELETE` es
que el dueño **encuentra** la cifra mala **en esta lista** y necesita **descartarla**; sin botón,
tendría que hacerlo con `curl`. Y el criterio 111(e) es una afirmación sobre lo que el dueño **ve**.

### Por qué `STALE` + `isManual` venían en el mismo paquete (no es alcance que me inventé)

El caso de uso central del borrado **es una fila caducada**: con `manualFreshnessDays = 30` una cifra
errónea desaparece de las tres superficies **en silencio** y **sigue en la tabla**. El contrato ya la
hacía enumerable (`?reason=STALE`, addendum v1.50.3-c) y el backend ya la emitía (commit `76e6d98`),
pero **el front no lo consumía**: `GradedEstimateReviewReason` no incluía `STALE` y
`GradedEstimatePreviewDTO` no tenía `isManual`. Sin eso, el botón «Retirar» existiría pero **la fila
que más justifica su existencia sería inalcanzable desde la UI**. `isManual` no es decorado: separa
dos remedios **opuestos** —manual rancia ⇒ recapturar o **retirar**; automática rancia ⇒ **mirar el
ingest, no la carta**— y se pinta pegado a la fecha porque describe **la misma fila** que ella.

### Las seis reglas del contrato que la UI implementa, y por qué cada una

1. **Confirmación previa, siempre** (DESIGN_SYSTEM §7.6): es destructivo, es dinero y es
   `super_admin`. Modal con verbo explícito («Retirar PSA 10»), importe a la vista y la nota «solo
   súper-admin · queda en bitácora».
2. **El copy NO dice «la última»:** dice que se borran **todas** las capturas de ese grado,
   historial incluido, **y por qué** — si solo se quitara la vigente, afloraría una más vieja y la
   cifra **reaparecería sola**. Un copy que insinuara «se quita la última» describiría un
   comportamiento que el backend no tiene y prometería una resurrección que sí ocurriría.
3. **`deletedCount` se pinta tal cual** (plural ICU). No se asume `1`: el operador tiene que
   enterarse de cuánto historial se fue.
4. **`409 GRADED_ESTIMATE_SLAB_PUBLISHED` no se trata como fallo del sistema.** Doble tratamiento,
   el mismo que la captura de 5d: **pre-vuelo** (con slab publicado de ese grado el botón queda
   deshabilitado, con el motivo y el remedio a la vista, una sola vez y no repetido por fila) **y**
   manejo del `409` real por si el pre-vuelo iba rancio. El mensaje explica que **con el slab
   publicado esa fila ya no es un estimado —es la referencia de mercado de una pieza física— y
   borrarla dejaría sin sustento de precio a un slab que se está vendiendo**, y orienta al remedio
   correcto: **repreciar con `intent:"market"`** (M1 › Gradeadas), nunca insistir en borrar. La
   inferencia contraria («busco las expuestas con `?reason=SLAB_PUBLISHED` y las borro») es tentadora
   y falsa; el copy la cierra explícitamente.
5. **`404` significa «no había nada», y se dice con esas palabras.** Se cierra el diálogo, se pinta
   un aviso **`info` (no `alert`)** —«No había nada que borrar… no se borró nada porque no había
   nada»— y **se refresca la lista**, que es justo lo que estaba desactualizado.
6. **Tras el borrado no se recarga la página:** se invalidan `['graded-estimate-review']` (todas sus
   páginas y filtros, no solo la vista actual) y `['graded-estimate-preview']` (la sección 5d muestra
   las mismas cifras). La fila desaparece sola.

**Detalles de UI que son decisiones, no estilo:**
- **Un botón por grado, y solo si ese grado tiene cifra.** El `DELETE` es por `(cardId, gradeValue)`
  y el DTO trae los montos en campos fijos; ofrecer «Retirar PSA 9» en una fila sin PSA 9 sería
  ofrecer un gesto que **solo puede dar `404`**.
- **La guarda es por GRADO, no por carta:** en una carta con PSA 9 publicada, el PSA 10 sí se puede
  retirar. La UI lo refleja (uno deshabilitado, el otro activo) porque es lo que hace el backend.
- El desenlace se pinta en **banner persistente, no en toast**: DESIGN_SYSTEM §7.5 prohíbe el toast
  para resultados de dinero.

### Mock: qué replica y en qué diverge (declarado)

`deleteMockGradedEstimate` replica las **tres** reglas que el flujo necesita ejercitar de punta a
punta en Playwright (que corre en modo mocks): `400` si el grado no está en `grades`, `409` con los
mismos `details` si hay slab publicado de ese grado, y `404` si no había nada. Al retirar, la fila
**desaparece de la lista** (sin la cifra su motivo pasa a `NO_PSA10`/`NO_PSA9`, que esta lista no
enumera), que es lo que el operador debe ver. **Divergencia declarada:** el fixture guarda **una**
proyección por `(carta, grado)`, así que `deletedCount` es siempre `1`; el backend borra todas las
filas de la clave y puede devolver más — por eso la UI **pinta el número que venga** y no lo asume.
Se añadieron dos filas `STALE` a los fixtures de la lista (una manual, una del ingest) porque los
remedios son opuestos y había que poder verlos.

### Verificación (números reales, dos modos)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | ✓ |
| `npx next lint` | ✓ sin warnings |
| `npx vitest run` | ✓ **90 archivos / 761 tests** (antes 753: +8 nuevos — 2 de `STALE`/origen, 6 del borrado) |
| `npx next build` | ✓ |
| **MOCK** — `E2E_MOCK_PORT=3010 npx playwright test` | **100 passed / 0 failed / 2 skipped** (los 2 son los `realOnly`) |
| **REAL** — `E2E_BASE_URL=http://localhost:3000 npx playwright test` | **59 passed / 3 failed / 40 skipped** |
| **Gate `@real`** — `… E2E_REAL=1` | **21 passed / 3 failed** de 24 |

Los **3 rojos en real** son el **hueco de entorno preexistente de Stripe** (`checkout.spec.ts:57`,
`guest-checkout.spec.ts:131`, `shipments.spec.ts:30`: el modal de pago no abre sin claves). Son los
mismos tres de la corrida anterior, ni uno más. Los `skipped` suben de 38 a 40 porque esta entrega
añade **dos** E2E `mockOnly` (ver abajo).

> **⚠️ Dos incidencias de ENTORNO que encontré por el camino, y que no son del código:**
>
> 1. **El frontend de `:3000` estaba sirviendo un bundle roto.** El proceso arrancó a las 22:56 y el
>    `.next` del disco se reconstruyó después (23:31), así que el manifiesto en memoria apuntaba a
>    chunks que ya no existían: `GET /_next/static/chunks/2799-….js` → **400**, la app se quedaba en
>    «Verificando sesión…» y la suite real daba **62 rojos**, todos ambientales. Lo **rehorneé y
>    reinicié** con exactamente el mismo comando y entorno que `scripts/stack-native.sh`
>    (`NODE_ENV=production`, `NEXT_PUBLIC_USE_MOCKS=false`,
>    `NEXT_PUBLIC_API_BASE_URL=http://localhost:3099/api/v1`, `next build && next start -p 3000`),
>    verificando que los chunks responden `200` y que `localhost:3099` quedó horneado. Actualicé
>    `.native-stack/frontend.pid` y `frontend.log` para que el `down` de devops siga funcionando —
>    **no toqué el script ni el backend** (`start_backend` no se reinició: lleva arriba desde las
>    22:55 sin interrupción). Con el bundle sano, la corrida real vuelve al baseline documentado.
>    **Devops:** conviene que `up --gate` detecte este caso (proceso vivo con `BUILD_ID` más nuevo que
>    su arranque), porque produce 62 rojos que parecen del producto y no lo son.
> 2. **No se puede correr la suite real contra un frontend en otro puerto.** Lo intenté en `:3012`
>    para no tocar el stack: **43 rojos** en bloque, porque la allow-list de CORS del backend sale de
>    `APP_BASE_URL` y es **solo** `http://localhost:3000` (`main.ts:resolveCorsOrigins`, S-M2). La
>    guarda es correcta y no se toca; queda anotado para que nadie repita el diagnóstico.

### Cobertura E2E del borrado: qué se cubre hoy y qué falta (y por qué)

**Hoy, en modo mock (2 tests nuevos, verdes):** (a) el opt-in de lo caducado + el origen de la cifra +
el ciclo completo **confirmar → `DELETE` → la fila desaparece** con su conteo; (b) el pre-vuelo INV-D:
el grado con slab publicado **no ofrece** borrado, el otro grado sí, y la UI nombra el remedio.

**En real, todavía no**, y no por el test: **la ruta no está viva**. El código del backend está en el
repo (commit `fea436c`) pero el proceso de `:3099` arrancó **antes** (`ts-node`, sin recarga), y
`DELETE …/graded-estimates/abc/10` responde **404** (una ruta existente daría `401`). En cuanto
devops/backend redespliegue el proceso, la cobertura real natural es un test que **siembre una cifra
incoherente, la encuentre en la lista y la retire desde la UI** — y que, por primera vez, **se limpia
a sí mismo**: es justo lo que este `DELETE` habilita (ARCHITECTURE §4.38q.4).

### Estado de mis peticiones anteriores al arquitecto

1. **Borrado del estimado — ✅ RESUELTA y consumida.** El arquitecto la normó (contrato v1.50.3-d,
   ARCHITECTURE §4.38q) y encontró que el hueco era **mayor**: cuatro sitios lo prometían. Esta
   entrega es su consumidor. Se actualizaron los dos comentarios de `e2e/utils/grading.ts` que
   afirmaban «el contrato no expone borrado» — ya no es cierto y habría desorientado a quien los
   leyera. **El teardown E2E todavía NO retira lo que siembra**: la mitigación vigente (siembra
   idempotente + dial devuelto a `off`, así que nada se publica) sigue siendo correcta, y cablear un
   `DELETE` contra una ruta que hoy da 404 solo añadiría ruido a corridas ya terminadas. Se cablea
   cuando la ruta esté viva.
2. **Seed sintético — dos filas.** Aceptadas y en curso. La de «raw publicado + slab del mismo grado»
   desbloquea **tres** cosas, no dos: el pre-vuelo de INV-D, el `SLAB_PUBLISHED` de la lista en real
   y —lo notó el arquitecto— es la **única** forma de verificar el `409` de este `DELETE` de punta a
   punta. Los tests `needsSeed` pasarán tal cual cuando existan.

**Sin peticiones nuevas al arquitecto.** `raw` y `sealed` siguen sin borrado, pero eso está declarado
como hueco en el contrato, no prometido: no lo necesito para esta superficie.

---

## §27 · Cierre del stream: higiene de credenciales del arnés, el `@real` que faltaba y dos candados que medían mal — 2026-08-29

> Rama `claude/psa-graded-card-value-gmhv5u`, sobre `eaea9e9`. Cinco hallazgos del cierre de QA +
> techlead (IMP-A, IMP-B, D3, D5, D6). Ningún cambio de contrato; ninguna superficie pública se toca.

### 1. IMP-A (QA, **seguridad**) — el arnés dejaba JWT reales de `super_admin` en `/tmp` con `0644`

**El hallazgo, medido:** `e2e/utils/state.ts` cachea en disco el `TokenPair` **completo** (access **y
refresh**) de cada rol del seed —incluido `super_admin`— para no comerse el rate-limit de
`POST /auth/login` (5/min por IP). Se escribía con el modo por defecto y **nunca se borraba**: el
`globalTeardown` limpiaba `dial` y `scenario`, y la sesión no la limpiaba nadie.

**Por qué no era «bajo riesgo y ya».** Hoy son credenciales sintéticas, cierto. Pero
`scripts/stack-native.sh` y `DEVOPS_NOTES` documentan correr **esta misma suite** con `E2E_BASE_URL`
apuntando a **staging**, y ahí lo que queda legible por cualquier usuario del runner es el **refresh
token** de un `super_admin` de staging: una sesión **renovable**, no un access token que expira en 15
minutos. Que caduque solo no es una mitigación.

**El arreglo, en tres piezas** (`e2e/utils/state.ts`, `e2e/utils/env.ts`, `e2e/global-teardown.ts`):

| Pieza | Qué hace | Por qué así |
|---|---|---|
| Directorio `0700`, archivos `0600` | `mkdirSync({ mode })` + **`chmodSync` explícito**; `writeFileSync({ mode })` + `chmod` del temporal antes del `rename` | el `mode` de `mkdir`/`writeFile` solo aplica **al crear** y lo recorta el `umask`: un directorio heredado de una corrida anterior seguiría siendo `0755`. El `chmod` es lo que **retro-arregla** lo que ya estaba en disco |
| `clearStateByPrefix('session:')` | purga por **clave lógica**, que ahora viaja dentro del sobre (`{ at, name, value }`) | el nombre del archivo es un **hash**: sin la clave en el sobre, «purga todas las sesiones» exigiría resolver la API base — justo lo que no se puede hacer si el stack se cayó a mitad, que es cuando más molesta dejar tokens |
| `clearTokenState()` | purga por **CONTENIDO**: cualquier entrada cuyo valor tenga `accessToken`/`refreshToken` | alcanza los archivos de corridas **anteriores a este arreglo** (no llevan `name`) y a cualquier consumidor futuro que cachee credenciales con otra clave. La garantía que se quiere es «al terminar la corrida no queda un token en disco», y esa se afirma sobre el contenido |

El `globalTeardown` llama a la purga en un **`finally`** y **fuera** del `if (IS_REAL)`: si restaurar
el dial revienta (stack caído), los tokens se borran igual. Se imprime cuántos archivos se llevó.

**Verificado en el entorno real, no en teoría.** Antes de la corrida, `/tmp/tcg-vault-e2e-state` era
`drwxr-xr-x` con dos `-rw-r--r--` llenos de tokens de la corrida de QA. Después de la primera suite
real con el arreglo: **directorio `drwx------` y vacío** — el barrido por contenido se llevó también
los dos archivos legados. Cada corrida posterior imprime
`[e2e] Estado de sesión purgado del disco: 2 archivo(s) con tokens.`

**Efecto colateral declarado:** dos corridas que compartan `E2E_STATE_DIR` se invalidan la caché de
sesión mutuamente (a lo sumo 3 logins extra). Aislar corridas concurrentes es exactamente para lo que
`E2E_STATE_DIR` existe.

### 2. IMP-B (QA) — decisión: **sí es viable**, y el `@real` está subido

QA lo dejó dicho con precisión: la ruta `DELETE` estaba verificada **a nivel API** (409/404 por
`curl`) y la UI **contra fixtures**, pero `deleteGradedEstimate()` de `src/lib/api.ts` **nunca había
hablado con el backend real en ninguna suite**. El riesgo residual no era el contrato: era el
**pegamento del cliente HTTP** (URL compuesta, verbo, `Authorization`, parseo de `deletedCount`,
invalidación de React Query). Los dos impedimentos anteriores desaparecieron —la ruta está viva en
`:3099` y las dos filas de seed existen—, así que **se sube el `@real`**:

`grading-estimate.spec.ts` › *«@real retira la cifra desde la lista y el contrato confirma que se
fue»*. Siembra una cifra incoherente en la carta `deletable`, la encuentra en la lista de revisión,
la retira **con el gesto del operador** (botón → modal → confirmar) y luego comprueba contra el
contrato que se fue de verdad: `preview` sin la cifra, un **segundo `DELETE` que responde `404`** (la
prueba de que el primero se llevó todas las filas de la clave) y el grado auxiliar **intacto** (la
guarda y el borrado son **por grado**, no por carta). **Se limpia solo:** el entorno queda como
estaba, verificado tras la corrida.

**Descubrimiento del camino, y es una petición al arquitecto (§5).** La primera versión sembraba
**solo** el grado alto y el test fallaba: la fila no aparecía en la lista de revisión. Contra el
stack real, `GET /admin/pricing/graded-estimates/review` **solo llega a evaluar la coherencia cuando
la carta tiene los DOS grados**; con un único PSA 10 el diagnóstico se detiene antes, en `NO_PSA9`.
El arnés se adaptó (siembra ambos grados, el bajo por debajo del alto para que el motivo sea
`NOT_ABOVE_RAW` y no `GRADE_ORDER_INVERTED`), pero el hallazgo se escala tal cual.

**Lo que sigue sin cobertura real, y es DATO, no gesto:** el opt-in `?reason=STALE` y la columna de
origen `ingest`. Una cifra **caducada** exige una `capturedDate` vieja y una de origen **automático**
exige `isManual:false`, y **ninguna de las dos se puede fabricar por la API del contrato**
(`POST /admin/pricing/override` escribe siempre manual y con fecha de hoy). El smoke de esos dos
sigue `mockOnly`, ahora con **ese** motivo escrito, no con el de «la ruta no está desplegada».

### 3. D5 (techlead) — `bare` ya tiene el guardarraíl que su vecino tenía

El caso «sin gancho» afirma una **ausencia**, y una ausencia es justo lo que una corrida anterior
puede haber roto sin que nada lo delate: si el ranking de precio se mueve, una carta a la que ya se le
sembró una cifra cae en `bare` y el test falla como un **rojo de UI** («la ficha muestra el gancho»)
en vez de decir qué hacer. Ahora la candidata **no se toma a ciegas**: se verifica contra `preview`
que no tiene ninguna cifra escrita, se recorren las candidatas y, si ninguna está limpia, el error
nombra **qué borrar y con qué endpoint** —`DELETE …/graded-estimates/<cardId>/10`—, igual que el de
`informed`.

De paso, la selección del escenario pasó a ser explícita y verificada contra el contrato: `curated` y
`informed` por precio, **`deletable`** = primera raw libre **sin slab publicado** (con slab el `DELETE`
daría `409` por INV-D y el test mediría la guarda, no el borrado), y `bare` = primera candidata
limpia, preferentemente no-raw. El suelo de cartas raw del seed sube de 2 a **3**, con el mensaje
diciendo para qué es cada una.

### 4. D3 (techlead) — el candado anti-regresión medía otra cosa

Cinco defectos, cinco arreglos (`src/test/e2e-harness.test.ts`):

1. **Contaba `@real` sobre el fuente crudo** y 3 de las 8 ocurrencias vivían en **comentarios**: el
   umbral se sostenía sobre prosa. Ahora todo se mide sobre código sin comentarios (`stripComments`,
   extraída y compartida — la técnica ya estaba en el `describe` de arriba, solo no se aplicó aquí).
2. **Contaba ETIQUETAS, no TESTS.** Playwright hace `grep` sobre el **título completo**
   (`describe` + `test`): una etiqueta en el `describe` cubre N tests y otra en un `test` cubre uno.
   Ahora se resuelve la herencia y se cuenta **cuántos tests seleccionaría el gate**. Contrastado con
   el propio Playwright: `--list --grep @real` dice **«25 tests in 9 files»** y el candado calcula
   exactamente 25 y 9.
3. **Solo miraba `grading-estimate.spec.ts`** — protegía el archivo, no la clase. Las reglas
   estructurales se aplican ahora a **toda** la carpeta `e2e/`, con pisos de suite (≥24 tests `@real`,
   9 archivos con cobertura).
4. **`src.split(/\n\s*test\(/)` descartaba la cabecera**, así que una navegación a un id de fixture
   desde un `beforeEach` **esquivaba el candado** y arrastraba a todos los tests del `describe`,
   `@real` incluidos. Ahora el fuente se parte en segmentos con dueño —módulo, preámbulo de cada
   `describe` (sus hooks) y cada test— y un id de fixture fuera de un test es offender **siempre**: un
   hook no puede declararse `mockOnly` por sus tests.
5. **Regla nueva:** ningún test `@real` puede llamar `mockOnly()` en su cuerpo. Es el mismo agujero
   con otra forma —el gate lo selecciona y lo salta siempre—.

Y se añadieron tres tests que fijan IMP-A: permisos `0700`/`0600` reales sobre disco, purga por clave
respetando el resto del estado, y purga por contenido alcanzando los archivos legados sin `name`.

### 5. D6 (techlead) — la errata que dejaba muda la frase del remedio

`messages/es.json` › `admin.m2.gradedEstimateReview.deleteSlabPublishedNote`: **«Represa la pieza»** →
**«Reprecia la pieza»**. Es la frase exacta que dirige al operador al **único** remedio correcto del
`409` de INV-D, y tal como estaba no decía nada. La versión `en` («Reprice the piece») ya era correcta.

### Verificación (números reales, no «pasa todo»)

| Comprobación | Resultado |
|---|---|
| `npx tsc --noEmit` | limpio |
| `npx next lint` | 0 warnings, 0 errors |
| `npx vitest run` | **767 pasan / 90 archivos** (eran 766/90: +4 de IMP-A y D3, −3 del candado viejo reemplazado) |
| `npx next build` | verde, sin aviso de `NODE_ENV` no estándar |
| Playwright **mock** (`E2E_MOCK_PORT=3020`) | **100 pasan, 3 saltados** (los tres `realOnly`) de 103 |
| Playwright **real** (`E2E_BASE_URL=http://localhost:3000 E2E_REAL=1`) | **22 pasan, 3 fallan** de 25 — los 3 son el hueco de entorno de Stripe (checkout, guest-checkout, shipments: el modal «Completar pago» no abre). **Cero rojos del gancho** |
| Solo `grading-estimate.spec.ts` en real | **12/12**, incluido el `@real` del borrado |
| Huella en el entorno tras la corrida | dial `gradedEstimatesEnabled` = `off`; carta `deletable` sin cifras; `/tmp/tcg-vault-e2e-state` `0700` y **vacío** |

> **Rótulo (añadido 2026-08-31).** Esta tabla es la **medición del 2026-08-29** y se conserva tal cual.
> El dial que nombra, `gradedEstimatesEnabled`, **ya no existe**: M-46 lo renombró a
> `gradingHookEnabled` (**§31**).

**Nota para devops (entorno, no código).** Al verificar el build corrí `npx next build` **sin** las
variables que usa `scripts/stack-native.sh`, y eso horneó `.next` con la URL de API por defecto
(`:3001`) bajo el `next start` que estaba sirviendo en `:3000` — la primera corrida real dio 25 rojos
por eso, no por producto. **Reparado:** se reconstruyó con `NODE_ENV=production
NEXT_PUBLIC_USE_MOCKS=false NEXT_PUBLIC_API_BASE_URL=http://localhost:3099/api/v1` (idéntico al
script) y se reinició el proceso de `:3000` con esas mismas variables. El artefacto y el proceso vivo
vuelven a coincidir. La verificación final de `next build` se hizo contra `NEXT_DIST_DIR=.next-verify`
(borrado después) **precisamente para no volver a tocar** el artefacto que el stack sirve.

### Peticiones al arquitecto

1. **`review` y la carta con un solo grado (Media).** El contrato §M2 declara que `NOT_ABOVE_RAW` se
   dispara cuando `psa10 <= salePriceCents`, sin condicionarlo a que exista PSA 9. En el stack real,
   una carta con **solo** PSA 10 incoherente (verificado: raw MX$460, PSA 10 MX$230) **no aparece** en
   `GET /admin/pricing/graded-estimates/review`: el diagnóstico resuelve `NO_PSA9` y se detiene antes
   de la coherencia. Importa porque el error que esa categoría existe para cazar —**USD capturados
   como MXN**— es más probable en la **primera** captura de una carta, que es justo cuando todavía
   solo hay un grado. O el contrato dice que la lista exige ambos grados, o el orden de razones deja
   pasar la coherencia antes que la ausencia del otro grado. **No toco nada:** lo dejo escrito y el
   arnés se adapta sembrando los dos grados.
2. **Seed — sigue faltando una CUARTA carta raw publicada y libre.** Las tres que hay ya son `curated`,
   `informed` y `deletable`. El test `needsSeed` de «dos grados con dato y sin destacar» pasará tal
   cual el día que exista. No bloquea nada.

---

## §28 · La marca del descargo: «TCG Vault MX» → «TCG HUNT», y el candado que lo fija (2026-08-31, rama `claude/psa-graded-card-value-gmhv5u`)

**El defecto.** El descargo legal del gancho de grading nombraba a la empresa como **«TCG Vault MX»**
— el nombre interno del proyecto (el título de `CLAUDE.md`), no la marca. La marca es **TCG HUNT**
(`common.brand.name`, dominio `tcghunt.mx`). Lo introdujimos nosotros al redactar el descargo: de todo
el texto visible al comprador, el nombre viejo aparecía **solo** en esas dos claves, en los dos idiomas.

**El arreglo (4 cadenas, nada más).** `catalog.gradingNote.p4` y `catalog.gradingNote.p5` en `es.json`
y `en.json`. Se sustituyó **únicamente el token de la marca**; el resto del descargo está aprobado
literal por el dueño y no se tocó ni una coma. ES y EN quedan paralelos.

**Por qué la marca y no la razón social.** El proyecto distingue marca (`common.brand.name`) de razón
social (`common.footer.legalEntity`, hoy `[Razón social pendiente]` / `[Legal entity pending]`, que el
pie omite con gracia — ver `footerLegalEntity.test.ts`). La razón social **no está cargada todavía**,
así que no entra aquí. El precedente que manda es `legal.intro`: *«Estos términos aplican a todas las
compras y a la bóveda de cartas en TCG HUNT»*. El descargo debe hablar igual que los términos.

**El candado.** No se creó archivo nuevo: el barrido de catálogos ya vivía en
`src/lib/i18n-parity.test.ts` (paridad de claves ES/EN), así que el caso entra ahí, junto a su vecino
natural. Un helper `stringEntries()` recorre el JSON y devuelve `[ruta, valor]` de **cada** cadena; el
caso —un `it.each` por locale— exige que ninguna case con `/tcg\s*vault/i`. Falla **listando la ruta
de la clave culpable** (verificado reinyectando el texto viejo: `expected [ 'catalog.gradingNote.p4' ]
to deeply equal []`), no con un booleano mudo. Es barato y cierra la puerta a que cualquier copy futuro
—no solo el descargo— reintroduzca la marca vieja.

**Verificación.** `npx tsc --noEmit` limpio · `npx vitest run` **769 pasan / 90 archivos** (eran
767/90: +2 del `it.each` nuevo, uno por locale). **Ningún test existente citaba la marca vieja**, así
que no hubo aserciones que actualizar.

## §29 · La cuarta superficie del gancho: la burbuja entra al carrusel «Piezas destacadas» (§22.6b) — 2026-08-31, rama `claude/psa-graded-card-value-gmhv5u`

Implementación de `DESIGN_SYSTEM.md` §22.6b (PROJECT §O.3 superficie 4, criterio 113). **Cero cambios
de backend y cero cambios de contrato**: verificado antes de empezar que `GET /catalog/cards` emite
`gradingHighlight` en el summary de todo grupo raw elegible **sin** el filtro `?gradingHighlight=true`
(`catalog.service.ts:1093` llama `loadGradingContext` de forma incondicional; el `:1104` con
`gradingHighlight=true` solo **filtra**). El carrusel ya pedía `getCatalog({sort:'price_desc',
pageSize:8})` y ya recibía el campo en el DTO: solo faltaba pintarlo.

### 1. El punto que mata la feature en silencio: la nota al pie es la UNIÓN, no la vitrina

Hasta hoy `page.tsx` derivaba `GradingFootnoteBoundary active` **solo** de la vitrina «Joyas para
gradear». Con el carrusel como cuarta superficie eso deja de ser suficiente y se convierte en un
**fallo silencioso de manual**:

- El carrusel ordena por **precio descendente** y el gate de ROI castiga justo a las caras (R6 exige
  `psa10 > raw`), así que **«vitrina vacía + una burbuja en el carrusel» es el estado FRECUENTE**.
- En ese estado la página no hospedaría la nota; y como toda cifra es **fail-closed** sin nota (R3.3),
  el badge devuelve `null`. El carrusel **no pintaría nada**: ni excepción, ni hueco, ni log. Solo una
  feature que no aparece.

El arreglo es literal a §22.6b-g: un solo booleano, `gemsHaveFigures || carouselHasFigures`, derivado
del **mismo** `pageHasGradingFigures` para las dos fuentes. Para que las dos listas no puedan divergir
de lo que cada sección pinta, la consulta del carrusel se **extrae y se comparte** —`useFeaturedCatalog()`
/ `featuredOf()` en `FeaturedCarousel.tsx`, exactamente el patrón que ya usaba `useGradingGems()`—:
mismo `queryKey`, TanStack la dedupe, una sola petición. Dos `useQuery` con opciones distintas habrían
reabierto el mismo agujero por otra puerta.

El `returnToId` deja de ser fijo: **vitrina si pintó, si no el carrusel** (§22.4a). Un ancla fija a una
sección que hoy puede no renderizarse es un enlace de regreso apuntando a la nada — y ese es el caso
normal aquí, no un borde.

### 2. `surface`: un enumerado cerrado, no un `className`

`GradingEstimateBadge` gana **un** prop, `surface: 'grid' | 'featuredLead' | 'featuredRest'`, con
`'grid'` por defecto — **Compra y la vitrina no cambian ni una clase**. Toda la variación vive en un
mapa `SURFACE_SPEC` de tres entradas y tres campos: qué envoltorio lleva la forma larga (`null` ⇒ no se
pinta nunca), cuál la corta, y el tamaño de la cifra.

Existe porque **el breakpoint del viewport no predice el ancho de la teja** en el carrusel: la teja
chica mide 160px aunque el viewport ya sea `sm`. Por eso el corte de `featuredLead` es **`lg`, no `sm`**
(236px → 400px) y `featuredRest` usa **`figureShort` siempre** (268px en su mejor momento contra los
~274px que pide la forma larga en EN).

Lo que el prop **no** puede hacer, y por eso es un enumerado y no un `className` libre: no apaga el
micro-aviso, no lo acorta, no cambia su familia ni su tamaño, no toca la regla superior, no suprime la
llamada `*` y no baja el piso de 11px (§22.4d). Un `surface: string` —o un `figureForm` que aceptara
cualquier cosa— reabriría por la puerta de atrás la variante «ligera» sin aviso que R3 prohíbe. **Un
cuarto valor es una decisión de diseño, no de implementación.**

### 3. El `whitespace-nowrap` pasa del párrafo al MONTO (y esto endurece también a Compra)

La clase estaba en el `<p>` **entero**. En una teja estrecha, un importe grande no envolvía: **desbordaba
la teja en silencio** —no hay caja ni fondo que lo delate (§2.1)— en vez de dejar envolver la prosa que
sí puede envolver. Ahora lo indivisible es la cifra y nada más.

**Coste declarado:** requirió envolver el placeholder en un tag de rich text (`<nb>{amount}</nb>`) en
`catalog.gradingBadge.figure` y `figureShort`, ES y EN. **No es copy nuevo ni una clave nueva** —§22.11
dice que esta superficie no añade ninguna—: es el mismo mecanismo de `<approx>` y `<b>` que las claves
ya usaban, y el texto renderizado es idéntico carácter por carácter. Fue necesario porque
`RichTranslationValues` de next-intl solo admite `string | number | Date | RichTagsFunction`: no se
puede pasar un `ReactNode` como valor de `{amount}`.

### 4. La numeración: condicional POR PISTA, todo o nada

`showNumbering = !(anchors !== null && pageHasGradingFigures(featured))`. Dos matices deliberados:

- **El predicado incluye el `fail-closed`.** «Si la pista pinta cifra» significa *pinta*, y sin boundary
  activa el badge devuelve `null`. Con `anchors` en la condición es **imposible** que la pista pierda
  los números sin haber ganado la burbuja (hay test).
- **Todo o nada**, nunca teja por teja: el número vive en la fila del título (`flex items-baseline
  gap-2`) **antes** del nombre, así que quitarlo solo en las tejas con burbuja arrancaría esos nombres
  ~20px a la izquierda de sus vecinos y se leería como error de maquetación. No se renumera para tapar
  el hueco, no se sustituye por otro glifo y no queda espacio reservado: el `<span>` sencillamente no se
  renderiza y el `gap-2` de un solo hijo no deja rastro (verificado con `row.children` = 1).

### 5. Lo que NO se hizo, porque §22.6b lo prohíbe

Sin `min-height`, sin espacio reservado, sin skeleton del badge, sin regla ni guion de relleno en las
siete tejas sin cifra, sin reordenar por elegibilidad y **sin deduplicar contra la vitrina** (una carta
cara que además califica sale en las dos, con su burbuja en ambas). El badge es el **último elemento**
de las dos anatomías, así que nada de lo que está encima —arte, nombre, set/#, acabado, precio, stock—
se mueve un píxel: las ocho imágenes siguen alineadas por su borde superior, que es el eje que el ojo
usa en una pista horizontal. La pista crece lo que crezca la teja más alta y ese aire cae **debajo** de
las cortas. **La ausencia es el estado por defecto de esta superficie, no un estado degradado.**

En la teja grande la burbuja va **a todo el ancho, bajo toda la fila de datos**, no dentro de la columna
derecha del precio: esa columna es estrecha y va `text-right`, y ahí una cifra `nowrap` la reventaría y
el micro-aviso —que es prosa— quedaría en bandera derecha (§22.4c).

### 6. Accesibilidad: **prohibido `aria-label` en el enlace de la teja**

A diferencia de la teja de Compra, aquí el `<a>` envuelve todo, así que el badge queda **dentro** del
enlace y su texto pasa a formar parte del **nombre accesible**: el lector anuncia nombre, set, precio,
stock, la cifra y el micro-aviso completo. Eso es lo que §22.5 pide. Un `aria-label` **sustituiría** el
contenido y borraría el aviso del árbol de accesibilidad — que es exactamente el defecto bloqueante que
§22.4c corrigió. Hay un test que lo fija (`aria-label` y `aria-labelledby` a cero en todas las tejas), y
otro que comprueba que la llamada `*` no es un ancla anidada (`variant="plain"`).

`Shelf` gana un prop opcional `id` para que el ancla del carrusel y su
`scroll-mt-[calc(var(--app-header-h,0px)+16px)]` vivan **en el mismo elemento** (§4.5). Es aditivo: los
otros cuatro estantes no pasan `id` y no cambian.

### Verificación (números reales)

- `npx tsc --noEmit` limpio · `npx next lint` sin avisos · `npx next build` verde.
- `npx vitest run` → **786 pasan / 91 archivos** (base 769/90; +17 en el archivo nuevo
  `_home/FeaturedCarouselGrading.test.tsx`). **Ningún test existente se tocó**: los de Compra
  (`CatalogTile.test.tsx`), los del badge (`gradingEstimates.test.tsx`) y los de la vitrina
  (`GradingGemsShelf.test.tsx`) siguen verdes tal cual, que es la prueba de que `surface='grid'` no
  cambió nada.
- **El caso del punto 1 está cubierto renderizando el HOME COMPLETO**, no el carrusel aislado: el
  defecto vive en la página. `getCatalog` se mockea por argumentos —`gradingHighlight:true` ⇒ `[]`
  (vitrina VACÍA), la del carrusel ⇒ ocho piezas con **una** elegible— y se afirma que (a) «Joyas para
  gradear» no existe, (b) la burbuja **sí se pinta** con su micro-aviso visible, (c) `#nota-estimado`
  está en la página con el disclaimer completo y (d) el regreso apunta a `#piezas-destacadas`, que
  existe y lleva su `scroll-mt`. Dos casos hermanos: con vitrina el regreso apunta a la vitrina y hay
  **una sola** nota; sin cifras en ninguna de las dos, no hay nota ni aviso huérfano.
- El micro-aviso se verifica **como lo verificó QA la primera vez**: con `sightedText()`, que retira del
  árbol todo lo `sr-only` y comprueba que el aviso sigue ahí, en las dos anatomías y en ES y EN.
- E2E: un bloque nuevo `@real` en `e2e/grading-estimate.spec.ts`. **No aserta «hay burbuja»** —cero
  entre ocho es el estado normal, así que sería verde por casualidad o rojo por diseño—: aserta las
  **invariantes** (la pista es anclable y lleva `scroll-mt`; cero `aria-label` en sus tejas; numeración
  y cifra **no coexisten**, en los dos sentidos; el regreso de la nota nunca apunta a la nada).

### Peticiones al arquitecto

**Ninguna.** No se necesitó ningún endpoint ni campo que no exista, no hay mocks pendientes de contrato
y no se tocó `docs/API_CONTRACT.md`.

### Observación para ux-ui / PO (no bloquea, no la corregí porque no está en el alcance)

`GradingFootnoteBoundary` renderiza la nota **después** de sus `children`, y en el home los `children`
son el `<div>` que incluye la banda de tinta del buylist. Resultado: la nota queda **después** de esa
banda, mientras §22.4b la sitúa *«después de la última vitrina, antes de la banda de tinta del
buylist»*. Es **pre-existente** a esta entrega (no lo introduce §22.6b) y arreglarlo obliga a partir el
árbol del home en dos, así que lo dejo anotado en vez de meterlo de contrabando en este pase. Si ux-ui
lo confirma como defecto, es mío y lo tomo en la siguiente.

### Verificación contra el stack REAL (no solo unitarios)

Se levantó la plataforma con `./scripts/stack-native.sh up --seed --gate` (backend :3099 `db:up/redis:up`,
frontend :3000 con `next build` + `next start`, `mocks=false`) y se ejercitaron **los dos estados** del
carrusel, sembrando por la API del contrato (`PUT /admin/settings` + `POST /admin/pricing/override` con
`intent:"graded_estimate"`), no tocando la BD a mano:

| Estado | Qué se midió en la página servida |
|---|---|
| **Dial `off`, cero elegibles** (el estado por defecto) | 7 números en la pista (`01…07`), **cero** `≈`, **cero** nota al pie, la vitrina no existe. El carrusel es **exactamente §20.3 de hoy**. |
| **Dial `on`, una elegible entre ocho** | la burbuja se pinta **solo** en esa teja, con su micro-aviso visible; la **numeración desaparece de las ocho**; `aria-label` en tejas = **0**; `#nota-estimado` presente; el regreso resuelve a un ancla que existe. |

La elegible del entorno resultó ser la **tercera** pieza (`E2E Charizard`, MX$1,150) — una teja **chica**;
las dos primeras del seed son `graded` y nunca califican. Es la ilustración perfecta del contexto de
§22.6b: **la teja grande es la más cara y es a la que peor le va el gate**. A 160px la cifra
(`figureShort`) entra en **un renglón** y el aviso ocupa **dos**, tal como predice la tabla de §22.6b-b.

Después de las capturas **se restauró el entorno**: `DELETE /admin/pricing/graded-estimates/:cardId/:grade`
para los dos grados sembrados y el dial de vuelta a `off` (su valor previo). `preview` confirma
`psa10:null, psa9:null`.

**Lo que NO se pudo demostrar en vivo, y por qué no es una laguna:** el estado «vitrina vacía + burbuja en
el carrusel» **no es alcanzable con este seed**, porque la vitrina se alimenta del mismo
`?gradingHighlight=true` y con una sola carta elegible en todo el sitio ésta aparece necesariamente en las
dos. Es un límite del *dato*, no del código — por eso ese caso se cubre con el unitario que renderiza el
home completo y mockea `getCatalog` por argumentos.

### Observación pre-existente que la captura a 160px dejó a la vista (no la toqué)

Con el micro-aviso a **dos renglones**, la llamada `*` de `GradingNoteCall variant="plain"`
(`align-super` + `leading-[0]`, §22.4a) sube casi un renglón completo y queda **encima del primer
renglón** del aviso en vez de junto al final del segundo. **No lo introduce §22.6b**: se reproduce
idéntico en la teja de la **vitrina** (`CatalogTile`, código intacto) a 390px, así que ya vivía en Compra
desde la entrega anterior — la captura del carrusel solo lo hizo evidente. No lo corrijo en este pase
porque `GradingNoteCall` es compartido por las cuatro superficies y tocarlo cambiaría Compra y la vitrina,
que este pase tiene mandato explícito de **no** cambiar. Si ux-ui lo confirma como defecto, es mío.

---

## §30 · El test que decía verificar la cuarta superficie y no verificaba nada — bloqueante de QA sobre el PR #26 (2026-08-31, rama `claude/psa-graded-card-value-gmhv5u`)

**Veredicto que lo abre:** QA rechazó el PR #26 por un bloqueante mío en
`frontend/e2e/grading-estimate.spec.ts`, el bloque del carrusel «Piezas destacadas» (§22.6b) —
**la única cobertura E2E de la superficie que acababa de añadir**. Falló 2 de 2 corridas.

### El defecto, dicho sin adornos

El bloque comprobaba que `#piezas-destacadas` era **visible** y acto seguido leía su `innerText` y
contaba la numeración. Pero la `<section>` la pinta `Shelf`, y `Shelf` **renderiza su encabezado en el
primer frame**: las tejas llegan después, por react-query, y mientras tanto la pista son cuatro cajas
grises (`QueryState.loading`). O sea: **el ancla no era el contenido, era el contenedor**, y el
contenedor existe desde antes de que haya nada que medir.

Con la pista vacía salían `hasFigure=false` y `numbering=0`, y la invariante de §22.6b-c —«o cifra sin
numeración, o numeración sin cifra»— **no llegaba a decir nada**: se resolvía sobre el esqueleto. El
test nunca verificó lo que su nombre promete. Es el patrón que llevamos todo el día persiguiendo —algo
que afirma comprobar X y no comprueba X— y aquí dolía más porque era la **única** red de esa superficie.

### Qué anclé, y por qué NO copié la sugerencia de QA

QA validó en una copia desechable insertar `await expect(track.locator('a').first()).toBeVisible()`.
**Ese ancla no espera nada** y lo comprobé antes de descartarla: el encabezado del `Shelf` ya trae el
enlace **«Ver todo»** (`viewAllHref="/catalog"`), que está en el DOM desde el primer frame y es el
**primer `<a>` de la sección**. La corrida de QA salió verde por el retardo que introduce, no por la
espera — habría reabierto el mismo agujero con otra cara.

El ancla que puse espera por **la condición que el test necesita** — que la pista tenga **tejas**:

```ts
const tiles = track.locator('a[href*="/catalog/"]');   // la teja va a /es/catalog/<cardId>…
await expect(tiles.first(), '…nunca pintó una teja…').toBeVisible();  // …el «Ver todo» va a /es/catalog
const tileCount = await tiles.count();
expect(tileCount, 'sin tejas no hay ninguna invariante que medir').toBeGreaterThan(1);
```

El `href` distingue teja de encabezado sin depender del orden del DOM ni de una clase de layout. Nada
de `waitForTimeout`.

### Y la parte de fondo: que la invariante no se pueda cumplir por vacuidad

Dos cambios, y el segundo es el que de verdad importa:

1. **Contra-vacuidad explícita.** `tileCount > 1` se exige **antes** de juzgar nada, y con su mensaje:
   la invariante solo *dice* algo si hay tejas, y solo *distingue* los dos casos si hay más de una (la
   teja grande nunca lleva ordinal, §20.3). Si la pista no pinta, ahora se pone rojo **el aserto que
   nombra la causa real**, en vez de fabricarse un verde silencioso.
2. **La invariante pasa de umbral a igualdad exacta:** `numbering === (hasFigure ? 0 : tileCount - 1)`,
   en vez de `numbering > 0`. «Todo o nada por pista» (§22.6b-c) es una afirmación sobre **las ocho
   tejas**, y un `> 0` la deja pasar con una sola.

### Demostración de que el test arreglado detecta el fallo (lo exigió QA, y era la parte útil)

Spec desechable contra el stack real, ejecutando el oráculo **viejo** y el **nuevo** sobre el mismo
navegador y el mismo estado. Los cuatro casos:

| Caso | Oráculo VIEJO | Oráculo NUEVO |
|---|---|---|
| **Pista vacía** (`sort=price_desc` interceptado ⇒ `data: []`) | 🔴 pero con **diagnóstico falso**: «perdió la numeración de §20.3» — acusa al producto de una regresión que no ocurrió | 🔴 **por la causa real**: `waiting for locator('#piezas-destacadas').locator('a[href*="/catalog/"]')` |
| **Numeración mutilada** (se borran 6 de los 7 ordinales del DOM) | 🟢 **PASA** — `numbering > 0` se cumple con **uno** | 🔴 `Expected: 7 · Received: 1` |
| Estado normal (stack real) | 🟢 | 🟢 (`tiles=8`, `hasFigure=false`, `numbering=7`) |

La fila del medio es la que justifica el cambio de umbral a igualdad: el oráculo viejo **aceptaba una
regresión real** de §22.6b-c/§20.3. La primera es el bloqueante de QA, ya cerrado.

### Auditoría del resto del archivo: había UNO más, y está arreglado

Revisé **todos** los bloques que miden contenido asíncrono justo después de comprobar que su contenedor
es visible. Resultado:

- **`e2e/grading-estimate.spec.ts:696` (lista de revisión, opt-in `STALE`) — MISMO DEFECTO, arreglado.**
  Afirmaba que el badge `STALE` **no** está en el default (`toHaveCount(0)`) anclándose solo en el
  `subtitle` de la sección… que `GradedEstimateReviewSection` pinta **fuera** del `QueryState`. Una
  aserción de **ausencia** contra una lista todavía sin cargar se cumple sola. Ahora el ancla es
  `howToFix`, el único texto fijo que vive **dentro** de `{query.data && …}`: si está, la consulta
  resolvió y lo que se mide es la lista del default.
- **`:442` (el regreso de la nota en el carrusel) — endurecido de paso.** Era
  `if (await back.count())`: una foto del DOM que, tomada a media carga, se salta el caso **en
  silencio**. Ahora la rama que **sí** conocemos (`hasFigure` ⇒ hay nota, por R3.3) entra **sin
  condicional**, y se afirma además que la nota trae su enlace de regreso (`toHaveCount(1)`, §22.4b
  garantiza exactamente uno). El `count()` solo gobierna la rama que depende del dato del entorno.

**Y los que NO son el mismo defecto, dicho explícitamente para que nadie los "arregle" por parecido:**

- **Vitrina «Joyas para gradear» (`:324`)** — parece el mismo patrón (título del `Shelf` ⇒ contar
  cifras) y **no lo es**: esa vitrina es la **excepción ratificada a §8.1**, no pinta skeleton, así que
  su `Shelf` se renderiza *ya resuelto* o no se renderiza. Ver el título implica tejas en el **mismo
  commit de React**. Lo dejé anotado en el propio spec, porque la diferencia con el carrusel no es
  obvia leyendo el test.
- **Retícula de Compra (`:265`, `:285`)** y **ficha (`:162`, `:216`, `:231`)** — anclan en el **dato**
  (el nombre de la carta, el eyebrow del bloque), no en un contenedor estático; el badge sale del mismo
  render (`useGradingFootnote` es **contexto**, no una segunda consulta que pueda llegar tarde).
- **Back-office `:585` y `:628`** — ya anclaban en una fila / en el `summary`, ambos dentro del
  `QueryState`.
- **Desapariciones post-borrado (`:778`, `:907`)** — `toHaveCount(0)` con auto-retry tras el banner de
  éxito; la transición es monótona y la invalidación de react-query no vacía la lista (refetch conserva
  el dato viejo). No hay ventana de verde prematuro.

### Los dos hallazgos menores de QA (no bloqueantes), en la misma vuelta

**El dominio muerto en los fixtures.** `EVIDENCE_CONTACT` era el literal `soporte@tcgvaultmx.com`, y su
propio comentario confesaba de dónde salía: copiado del contrato. `API_CONTRACT.md` §0 cláusula 4 admite
un literal de *fallback* en fixtures **solo si se construye sobre `common.brand.domain`**, «nunca sobre
un literal copiado de este documento».

Nuevo **`frontend/src/lib/brand.ts`** con `BRAND_DOMAIN` + `brandEmail(mailbox)`, y `fixtures.ts` pasa a
`brandEmail('soporte')` / `brandEmail('operador')`. **Por qué una constante y no un `import` de
`messages/es.json`:** `src/lib/api.ts` importa `fixtures.ts` de forma **estática**, así que traer el JSON
de mensajes ahí lo metería en el bundle de **toda** la app, no solo del modo mock (que es opt-in). Es un
**espejo fijado por test**: `brand.test.ts` compara `BRAND_DOMAIN` con `common.brand.domain` de **las dos**
traducciones, así que no puede separarse de la fuente sin que CI lo diga — que es justo lo que faltó
cuando `tcgvaultmx.com` sobrevivió al rebrand.

**Los cuatro tests que arrastraban el dominio muerto** (`PublicOrderTracking.test.tsx`,
`ShipmentsView.test.tsx`, `api.test.ts`, `AdminShell.test.tsx`). QA tenía razón en que no eran candados
invertidos —inyectan el valor y comprueban que se rinde lo inyectado—, pero mantenían vivo el dominio.
Ahora inyectan **`evidencias@ejemplo.test` / `admin@ejemplo.test`**, deliberadamente **ajenos a la marca**:
así el test no solo deja de citar un dominio muerto, sino que **prueba mejor lo que dice probar** — si
algún día la UI derivara o hardcodeara el buzón en vez de rendir el que recibe (lo que §0 cláusula 4
prohíbe), estos tests lo cazarían en vez de taparlo.

### Verificación

- `npx tsc --noEmit` ✔ · `npx next lint` ✔ (0 warnings) · `npx vitest run` **789/789 en 92 archivos**
  (base 786/91; +3 son `brand.test.ts`).
- **E2E contra el stack real** (`./scripts/stack-native.sh down` y `up --gate` **desde este commit** —
  había un frontend de otra sesión en :3000 desde las 01:15, el mismo estorbo que reportó QA; verificado
  `BUILD_ID` 01:33 y una sola instancia por puerto): **`grading-estimate.spec.ts` 13/13**.
- **E2E en modo mock** (`E2E_MOCK_PORT=3010`, build de producción con fixtures, puerto separado para
  no pisar el stack real de :3000): **suite completa 101 pasan · 3 saltan (`realOnly`) · 0 fallan**.
  Importante correrla: el arreglo del opt-in `STALE` es **`mockOnly`** —solo se ejercita aquí— y el
  cambio de `EVIDENCE_CONTACT` solo vive en el modo fixtures.
- **Fuera de mi alcance, para que no se confunda con una regresión mía:** en la corrida `@real` completa
  fallan 3 smokes de **dinero** (`checkout`, `guest-checkout`, `shipments`), los tres esperando el modal
  de pago. Causa en el log del backend: `STRIPE_SECRET_KEY ausente; usando sk_test_dummy`. Es
  **ambiental** (sin clave de test ni egress), pre-existente y ajeno a este cambio — no toqué esos specs
  ni nada que ellos usen.

### Peticiones al arquitecto

**Ninguna.** No hizo falta ningún endpoint ni campo nuevo, y no se tocó `docs/API_CONTRACT.md`.

---

## §31 · M-46: el dial único del gancho, y la incapacitación explícita del arnés E2E (contrato v1.51-one-dial, `ARCHITECTURE.md` §4.38r, `DESIGN_SYSTEM.md` §22.13) — 2026-08-31

> Rama `claude/psa-graded-card-value-gmhv5u`, sobre `816a94d`. **Decisión del dueño, tomada y
> reafirmada; no se re-litiga aquí.** Este § documenta *cómo* se implementó y, sobre todo, la parte
> que no se ve en la pantalla: por qué la suite E2E dejó de poder gastar dinero **por construcción**.

### 1. El renombrado, que no es un renombrado

`SettingsDTO.gradedEstimatesEnabled` → **`gradingHookEnabled`**, y `GradedEstimateConfigDTO` pierde
`ingestEnabled`. Es tentador leerlo como cosmética y **no lo es**: la clave es NUEVA a propósito
(§4.38r.1). Producción tiene `graded_estimates_enabled="on"`, y reusar esa clave habría ensanchado
el significado de un valor **ya almacenado** («publica» → «publica **y gasta**»), de modo que el
siguiente tick del cron —≤12 h, sin humano— habría sido la primera factura del proveedor. Con clave
nueva, ningún valor guardado en ningún entorno puede armar el dial: todos aterrizan en `off`.

En el cliente eso se traduce en una consecuencia concreta y **buscada**: el campo es `?` opcional y
**la ausencia se lee como `off`** (`toInputValue` ya lo hacía). Entre el deploy y el flip manual del
dueño la tienda no muestra cifras de grading. **Es el precio declarado y aceptado, no un bug.**

### 2. Los dos avisos: el aviso lo elige el SENTIDO, no el estado

El estado efectivo del switch (borrador si se tocó, guardado si no) cruzado con el guardado da la
matriz de §22.13(c), implementada literal en `M10View`:

| Guardado | Efectivo | Banner | `role` |
|---|---|---|---|
| `off` | `off` | ninguno (solo la nota persistente) | — |
| `off` | `on` | **encendido** | `alert` |
| `on` | `on` | **encendido** (recordatorio) | `status` |
| `on` | `off` | **apagado** | `status` |

`alert` **solo** en el flip a `on` porque ese es el instante que autoriza el gasto; el apagado nunca
sube a `alert` — poner fricción en la dirección segura se paga en el peor momento posible.

**La cifra de créditos se interpola, no se hornea.** `{maxCards}` es el `ingestMaxCardsPerRun` VIVO
de M2, leído reusando `getGradedEstimateConfig` con la query key `['graded-estimates-config']` que
M2 ya usa (una lectura más en M10, **no un cambio de contrato**). `{perCard}` (2 créditos/carta,
§4.38h.3) y `{runs}` (2 corridas/día) viven en **un solo módulo**, `src/lib/grading-hook-cost.ts`:
repartirlos por el copy o por dos componentes los desincroniza, y entonces el aviso **miente sobre
dinero**, que es justo el defecto que §4.38(r) cierra.

**Y el aviso nunca espera a un número.** Si esa query falla —cargando, error, permiso— se pinta
`onNoFigures`: cede la cifra, **nunca el aviso** (§22.13h). Va con test propio, y la mutación que lo
esconde se pone en rojo (ver §31.5).

**Corrección de hecho que NO es estilo:** el copy anterior decía que el disclaimer *«todavía NO
tiene el visto bueno del dueño»*. **El dueño lo aprobó** (§22.12 nº14); escribirlo hoy sería
publicar en pantalla algo falso, en la pantalla que existe para que nadie encienda una fuente de
gasto a ciegas. Se conserva lo único cierto, «sin revisión legal profesional». Hay **candado**: un
test en `i18n-parity.test.ts` exige **cero apariciones** de esa frase en `messages/`, igual que el
candado de la marca TCG HUNT que ya vivía ahí.

### 3. El ancla que parece un detalle y no lo es

El aviso de apagado enlaza a `/admin/m2#gancho-revision`, y la sección de la lista de revisión de M2
lleva ahora ese `id` con su `scroll-mt` derivado de `--app-header-h`. Sin el ancla, el enlace lleva a
una página **y a ningún sitio dentro de ella**, y la escalera de remedios —lo único que evita que el
dueño apague la feature entera por una carta mal capturada— **muere en silencio**: el peor modo de
fallo posible para un remedio. Tiene test, y quitar el `id` lo pone en rojo.

### 4. ⚠️ Lo importante: el arnés E2E dejó de poder gastar, y ahora es por construcción

**El riesgo.** `e2e/utils/grading.ts` hacía, en **cada corrida**, `PUT /admin/settings
{ gradedEstimatesEnabled: 'on' }`. Hasta v1.50 eso encendía solo la **exhibición**. Tras el colapso,
ese mismo `PUT` enciende también la **obtención** desde un proveedor **de paga**.

**Por qué «en CI no hay llave» no era una respuesta.** Lo medí: ningún workflow de
`.github/workflows/` define `POKEMONPRICETRACKER_API_KEY`, pero `docker-compose.yml:187` la pasa
como `${POKEMONPRICETRACKER_API_KEY}` **sin default** — toma la del `.env` de quien levante el
stack. En CI queda vacía **por accidente, no por diseño**; en la máquina de alguien con la llave real
una corrida de E2E encendería el gasto. Y la protección que sí existe (el proveedor sale con `warn`
sin llave) vive **en el backend**, no en el arnés, y depende de que la llave **esté ausente**.
Depender de que alguien olvide poner una variable no es un diseño.

**El mecanismo elegido: precondición verificada + un solo punto de encendido.** Módulo nuevo
`e2e/utils/paid-provider-guard.ts`:

1. **Observación donde se puede observar.** Si la API bajo prueba corre en esta máquina (localhost),
   el arnés **mira las fuentes de entorno que el backend lee de verdad**: `process.env`, el `.env` de
   la raíz (el que interpola docker-compose) y `backend/.env` (el que carga `ConfigModule.forRoot()`
   en el stack nativo), más sus `.env.local`. Con una llave viva y la sonda apagada, **se niega a
   encender el dial** y explica el remedio. Los placeholders (`CHANGE_ME`…) no cuentan como llave: un
   guardarraíl que siempre grita se acaba desactivando.
2. **Constancia solo donde no se puede observar.** Contra staging/CI remoto el entorno del backend no
   es observable desde aquí y **no hay endpoint del contrato que lo exponga** —ni debe haberlo:
   §4.38(r.3.3) rechaza justamente un interruptor escondido que gobierne el gasto—. Ahí se exige la
   constancia de devops `E2E_GRADING_PROVIDER_INCAPACITATED=1`, que es suya por reparto. Sin ella el
   arnés **no enciende**; antes encendía a ciegas.
3. **La constancia NO gana sobre la observación.** Contra un backend local con llave viva, declarar
   la variable no desbloquea nada. Si bastara, habríamos cambiado un olvido por una promesa.
4. **Un solo punto de encendido.** El literal `{ gradingHookEnabled: 'on' }` existe **únicamente**
   dentro de `enableGradingHookGuarded`, que lleva la precondición pegada. El arnés no puede
   encender el dial por otra vía, y hay un test que falla si alguien vuelve a escribir el `PUT` a
   mano en `grading.ts` (que es exactamente como estaba antes).
5. **La sonda se lee EXACTAMENTE como la lee el backend** (`on|true|1|yes`). Un arnés más laxo que el
   backend daría por incapacitado un entorno que sí escribe, y esa divergencia se pagaría en
   créditos, no en un rojo.

**El teardown APAGA; no restaura.** `restoreDialValue()` devuelve `off` **siempre**. Dos razones:
la clave es nueva, así que «el valor previo» es `undefined` en todas las bases y restaurar solo puede
significar `off`; y encender es un **acto de dinero** que hace el dueño desde el back-office
(§4.38r.3), nunca un teardown automático. Si el dial estaba en `on` antes de la suite, se dice en voz
alta en el log y se deja apagado.

**La huella se declara en la corrida, no solo en un comentario.** Al sembrar, el arnés imprime
`INCAPACITACIÓN=<mecanismo>: <detalle>`. Si mañana alguien afloja el guardarraíl, el log de la
corrida dice con qué se autorizó el encendido.

**Lo que este módulo NO es:** un feature flag. Solo puede **negar** la autorización, nunca darla. El
gate del ingest sigue siendo del backend, que lee el dial.

**Petición a devops (no bloquea este trabajo):** el reparto de §4.38(r.6.1) le asigna «quitar la
capacidad de escritura automática del entorno E2E/CI». Con esto, un entorno remoto sin
`E2E_GRADING_PROVIDER_INCAPACITATED=1` **para la suite** en vez de gastar; conviene fijar esa
variable en el job de `e2e-real` junto con dejar la llave fuera del entorno.

### 5. Demostración de que la incapacitación DETECTA (mutación deliberada)

No basta con escribir el guardarraíl: hay que probar que su prueba se pone roja **por la razón
correcta**. Cinco mutaciones, aplicadas y revertidas:

| # | Qué rompí | Test que se puso rojo | Mensaje |
|---|---|---|---|
| **A** | `assessGradingWriteCapability` deja de detectar la llave viva (devuelve `incapacitated: true`) | `con llave viva NO llega a hacerse el PUT que enciende el gancho` | «REGRESIÓN DE DINERO: el arnés ejecutó el PUT que enciende el gancho con una llave del proveedor DE PAGA viva… **expected "spy" to not be called at all, but actually been called 1 times**» (+5 rojos más del mismo bloque) |
| **B** | Vuelvo a poner el `PUT` directo en `grading.ts`, saltándome el guardarraíl | `el arnés no contiene ningún PUT que ponga el dial en 'on'` | `expected 'import { IS_REAL, …' not to match /gradingHookEnabled['"]?\s*:\s*['"]on…/` |
| **C** | El teardown «restaura el valor previo» en vez de apagar | `aterriza en 'off' sea cual sea el valor previo observado` | `expected 'on' to be 'off'` |
| **D** | El aviso de encendido se oculta cuando falta la cifra de créditos | `si el tope de M2 no está disponible, el aviso de encendido SIGUE saliendo` | `Unable to find role="alert"` |
| **E** | Quito el `id="gancho-revision"` de la lista de revisión de M2 | `es el DESTINO del enlace del aviso de apagado` | `expected null to be truthy` |

El aserto de A está **ordenado a propósito**: primero se afirma que el `PUT` **no ocurrió** y después
que hubo error. Así, si el guardarraíl deja de detectar, el rojo dice literalmente *que se autorizó
el gasto*, en vez de un «esperaba un error» que se puede leer como un problema del test.

Los tests del guardarraíl viven en **vitest** (`src/test/e2e-paid-provider-guard.test.ts`) y no solo
en Playwright: el gate unitario es el que corre en cada cambio, y un guardarraíl de dinero verificado
únicamente por la suite que él mismo protege es un guardarraíl que nadie mira. Son deterministas —
reciben las fuentes de entorno por parámetro, así que un `.env` real en la máquina de quien corra los
tests no los vuelve verdes ni rojos por accidente.

### Verificación

- `npx tsc --noEmit` ✔ · `npx next lint` ✔ (0 warnings) · `npx vitest run` **818/818 en 93 archivos**
  · `npx next build` ✔ (62 páginas estáticas).
- **Base: 789/92.** El delta **+29 tests / +1 archivo** es todo cobertura nueva, ninguna prueba
  retirada: `e2e-paid-provider-guard.test.ts` **+21** (archivo nuevo) · `M10View.test.tsx` **+5** (dos
  tests del dial viejo sustituidos por siete: etiqueta, aviso de encendido con cifra, `onNoFigures`,
  aviso de apagado con su enlace, recordatorio `status`, no-coexistencia, prohibición del «visto
  bueno») · `i18n-parity.test.ts` **+2** (el candado del disclaimer, ES y EN) ·
  `GradedEstimateReviewSection.test.tsx` **+1** (el ancla).
- **Restricciones del dueño respetadas:** cero tokens de color nuevos (el aviso de apagado usa
  `variant="info"`, que es tinta muted sin color propio; el de encendido, `warning`, que ya usaba
  `--color-accent`), cero hexes crudos y cero apariciones de la marca retirada.

### Peticiones al arquitecto

**Ninguna.** §22.13 no necesitó ningún dato ni pantalla que el contrato no cubra: el dial ya está en
`SettingsDTO` (`gradingHookEnabled`) y el tope en `GradedEstimateConfigDTO` (`ingestMaxCardsPerRun`).
No se tocó `docs/API_CONTRACT.md`.

---

## §32 · El aviso de encendido deja de afirmar un gasto que nadie midió, y la ficha deja de pintar una fecha que no es la que parece (`DESIGN_SYSTEM.md` §22.13(d)/(d.1)/(h), `PROJECT.md` decisión 62 / criterio 119) — 2026-08-31

Dos correcciones de la misma familia: **una pantalla afirmaba como hecho algo que el producto no
puede respaldar**. Una era sobre dinero (M10) y otra sobre una fecha (la ficha). Van juntas porque
en las dos el trabajo real no fue escribir el texto nuevo, sino **quitar el candado que protegía el
viejo**.

### 1. El defecto de M10: la cifra era una hipótesis vestida de medición

El aviso decía, en el momento del consentimiento, *«hasta **1 000 créditos al día**»*, sin
calificador. Ese número es `maxCards × perCard × runs` y **solo vale si el proveedor cobra por
petición**. La petición manda `fetchAllInSet=true` —pide el **set entero**—, así que
`ingestMaxCardsPerRun` acota las cartas **en alcance**, no las **devueltas**: si se cobra por carta
devuelta, el gasto real es `techo × A`, con `A = devueltas / en alcance ≥ 1` y **ningún dial que lo
acote**. Con 250 cartas repartidas en 20 sets de 200, `A = 16` ⇒ **16 000/día** frente a los 1 000
anunciados. La diferencia entre los dos regímenes es la diferencia entre gastar el **5 %** y el
**80 %** de la cuota diaria del dueño.

**`onNoFigures` mentía igual, y esa parte casi se pasa por alto.** Decía «consume créditos en cada
corrida, **hasta el tope de cartas que fijaste en M2**», lo que insinúa que ese tope acota el gasto.
No lo acota. Ahora dice explícitamente qué acota (*cuántas cartas tuyas mira*) y qué no (*cuántas te
cobra el proveedor*).

El copy nuevo es literal de §22.13(d): tres entradillas —*Publica* / *Y gasta* / *Cuánto gasta*—,
con la tercera separando **lo que sabemos** (el alcance) de **lo que no** (el régimen de cobro), y
cerrando con quién lo dirime: *«La primera corrida lo mide»*. La cifra **no se borra** —un aviso de
gasto sin orden de magnitud no deja decidir— pero se publica **con su supuesto pegado**, en la misma
frase y con el mismo peso visual (nada de muted, `text-xs`, paréntesis final ni tooltip: §22.13b).

### 2. ⚠️ El test que protegía la falsedad — es la parte que importa de este cambio

`M10View.test.tsx` afirmaba:

```js
await waitFor(() => expect(warning.textContent).toMatch(/1[.,\s]?000 créditos al día/));
```

**Esa aserción fija la cifra desnuda, así que convertía el error de producto en un invariante de
CI.** Corregir el copy sin tocarla ponía CI en rojo diciendo que devolvieras el texto a la versión
falsa. No es un detalle de mantenimiento: es el mecanismo por el que este defecto **sobrevivió a una
revisión**. Un test que fija un número sin su calificador no verifica la verdad del aviso — la
sustituye.

La aserción nueva exige la **frase condicional completa**, en orden: cifra **+** régimen que la hace
válida **+** régimen que la invalida (`set entero`, `varias veces`) **+** quién lo dirime
(`La primera corrida lo mide`). Y encima lleva un **invariante por oración**, que es lo que impide
mover el candado en vez de quitarlo:

```js
for (const oracion of oraciones.filter((o) => /créditos al día/.test(o))) {
  expect(oracion).toMatch(/si cobra por petición|ya está medido|medida el/);
}
```

El mismo invariante existe a nivel de **catálogo** en `i18n-parity.test.ts`, sobre `messages/` ES y
EN: ninguna cadena puede interpolar `{credits}` junto a «créditos al día» / «credits a day» sin el
régimen de cobro o sin `{measuredOn}`; y «aproximadamente / ~ / unos / about» **no cuentan** como
calificador (§22.13h: el error posible es un **factor**, no un decimal). Va sobre el catálogo y no
solo sobre la pantalla a propósito: un candado sobre el texto renderizado se mueve reescribiendo el
texto; este se mueve solo quitándole el calificador a la cadena, que es justo lo que debe estar
prohibido.

#### Demostración de que el candado nuevo se pone rojo por la razón correcta

Dos mutaciones aplicadas y revertidas. La primera es la que pidió el encargo: **devolver el copy a
la versión que afirma la cifra sin calificador**.

| # | Mutación | Candado VIEJO | Candado NUEVO | Mensaje real |
|---|---|---|---|---|
| **A** | `…gradingHook.on` vuelve a *«El barrido consume hasta {credits} créditos al día ({maxCards} cartas × {perCard} créditos × {runs} corridas).»* | **VERDE — protege la falsedad** | **ROJO** | `expected 'Encendido: publica cifras y consume c…' to match /si cobra por petición, el techo son\s…/` |
| **A** (mismo copy, candado de catálogo) | ídem | — | **ROJO** | `admin.m10.dials.gradingHook.on: cifra de créditos sin calificador: expected false to be true` |
| **B** | *Mover* el candado: se **conserva** la frase condicional entera y además se cuela «En resumen: gasta {credits} créditos al día.» como oración aparte | **VERDE** | **ROJO** | `expected 'En resumen: gasta 1000 créditos al día.' to match /si cobra por petición\|ya está medido\|medida el/` |

La mutación **A** se verificó con una sonda temporal que evaluaba **las dos** expresiones sobre el
mismo render, para que la comparación no fuera de memoria:

```
[SONDA] candado VIEJO (cifra desnuda) sobre copy FALSO → VERDE (protege la falsedad)
[SONDA] candado NUEVO (frase condicional) sobre copy FALSO → ROJO (rechaza la cifra sin supuesto)
[SONDA] frase con la cifra que pinta la pantalla → El barrido consume hasta 1000 créditos al día (250 cartas × 2 créditos × 2 corridas).
```

La **B** es la que demuestra que no basta con cambiar un número por otro: el rojo **nombra la oración
infractora**, no un fallo de formato. La sonda se borró; las mutaciones se revirtieron y la suite
volvió a verde.

### 3. `costBasis`, y por qué `onMeasured` queda dormido a propósito

`src/lib/grading-hook-cost.ts` (el **módulo único** donde ya vivían `{perCard}` y `{runs}`) suma:

- `GRADING_COST_MEASUREMENT: GradingCostMeasurement | null` — **hoy `null`**, y no es un pendiente
  del módulo. Su única fuente honesta es la línea `[VEREDICTO-PSA] COSTE MEDIDO:` de la sonda,
  transcrita a `DEVOPS_NOTES.md` (`ARCHITECTURE.md` §4.38r.3.1.1): **no viaja en ningún DTO**, así
  que la pantalla no puede verificarla.
- `gradingCostBasis()` — devuelve `'estimated'` **fijo**, derivado de lo anterior.

Las **tres** variantes están traducidas y montadas (ES y EN), pero `onMeasured` **no se pinta**.
§22.13(h) prohíbe rellenarlo desde un `.env`, un literal o una constante «temporal»: sería el defecto
original con la palabra «medido» encima. El tipo es la parte deliberada — **obliga a traer cifra Y
fecha**, así que nadie puede declarar «medido» sin una medición, y el día que el contrato exponga el
dato, encenderlo es **rellenar una constante**, no reabrir con prisa el copy de una pantalla de
consentimiento. Además, cuando se encienda, la cifra que se pinta es `measurement.creditsPerDay`,
**no** el producto de las constantes: si viniera del cálculo, «medido» sería el mismo cálculo con
otro nombre. `grading-hook-cost.test.ts` (archivo nuevo) es el candado de esa prohibición.

### 4. El rango de M2 `[1, 5000] → [1, 1000]` (contrato v1.51-a): **no había nada que actualizar**, y lo verifiqué con patrones que sí pueden casar

Lo digo con las búsquedas delante, porque en esta misma sesión yo mismo di por inexistente un campo
buscando un nombre que no existía:

| Patrón buscado | Resultado |
|---|---|
| `ingestMaxCardsPerRun` / `MaxCardsPerRun` / `maxCardsPerRun` | 9 · 9 · 3 apariciones — **todas** en `contract.ts` (tipos), `M10View.tsx` (lectura), `fixtures.ts`, `grading-hook-cost.ts` y tests |
| `5000` / `5 000` / `5,000` / `5.000` en `messages/` | **0** |
| `cartas por corrida` / `cards per run` en `messages/` | solo la nota persistente de M10 (sin cifra) |

**La UI de M2 no dibuja ese dial ni su rango**: `GradedEstimatesSection` edita escalones de costo,
margen mínimo y frescura; `ingestMaxCardsPerRun` solo se **lee** (en M10, para cifrar el techo).
Bajar el máximo de 5 000 a 1 000 no cambia ni un píxel del frontend. **Petición abierta al arquitecto
/ ux-ui al final de esta sección**, porque el copy sí afirma que ese tope «se edita en M2».

### 5. La fecha de la ficha: se retira (decisión 62, criterio 119)

`GradingEstimateBlock` pintaba un eyebrow derecho **«ESTIMADO · 22 ago 2026»** alimentado por
`oldestCapturedDate()` sobre `capturedDate`. Esa fecha es **cuándo bajamos el dato**, no cuándo
ocurrió la venta que lo respalda — y el rótulo no lo decía, así que un comprador podía leerla como
la fecha de la **venta**, que es justo el dato que no tenemos: `evidenceDate` **no se persiste**, y
la captura puede ir hasta 30 días adelantada. Se le ofreció al dueño rotularla con honestidad y
**eligió quitarla**.

Qué se quitó: el `<span>` del eyebrow, la clave `catalog.gradingEstimate.updatedAt` en **ES y EN**, y
`oldestCapturedDate()`, que quedó muerta (en su sitio queda un comentario que explica por qué, para
que no vuelva por inercia).

**Alcance, que es donde esto se tuerce.** No se toca la **frescura interna** —los dos relojes del
criterio 118 siguen midiendo server-side sobre `capturedDate`, y por eso el campo **sigue viajando
en el DTO**: retirarlo del contrato es decisión del arquitecto, no mía—. Tampoco se toca la fecha
del **valor de mercado** (`marketValue.note`, criterio 119e), que es otro dato y otra fila. Se retira
lo que se **muestra**, no lo que se **mide**. Y no se suaviza a «actualizado» ni a un tooltip: media
solución aquí es el defecto entero.

Los tests que cubrían el eyebrow **se invierten, no se borran** (`gradingEstimates.test.tsx`,
`CardDetailView.test.tsx`): si alguien vuelve a cablear una fecha al bloque, esto se pone rojo. La
verificación negativa mira el `<section>` del bloque y no la página, porque la nota al pie de §O.5 sí
habla de que los precios «pueden quedar desactualizados» — eso es el disclaimer, no una fecha de este
dato. Y el criterio 119(b) («cero apariciones de la clave en `messages/` ES y EN») vive además en
`i18n-parity.test.ts`, junto al candado de paridad que caza el retirar una clave en un solo idioma.

### Verificación

- `npx tsc --noEmit` ✔ · `npx next lint` ✔ (0 warnings) · `npx vitest run` **830/830 en 94 archivos**
  · `npx next build` ✔.
- **Base: 818/93.** Delta **+12 tests / +1 archivo**, todo cobertura nueva; **ninguna prueba
  retirada**, dos invertidas:
  - `grading-hook-cost.test.ts` **+4** (archivo nuevo: el techo se deriva del tope vivo y cede la
    cifra cuando no lo hay; `costBasis` fijo en `'estimated'`; `measured` exige cifra y fecha).
  - `i18n-parity.test.ts` **+6** (ES/EN × tres candados de catálogo: cifra con su régimen de cobro,
    «aproximadamente» no vale como calificador, `updatedAt` retirada).
  - `gradingEstimates.test.tsx` **+2 neto** (−1 el test de la fecha «más antigua», +1 la
    verificación negativa del bloque, +2 la de las claves ES/EN).
  - `M10View.test.tsx` **±0**: mismo número de tests, aserciones **más fuertes** (la condicional
    completa, el invariante por oración, y `onNoFigures` obligado a decir qué acota el tope).
- Cero tokens nuevos, cero componentes nuevos, cero cambios de contrato, cero escrituras fuera de
  `frontend/` y de este documento.

### Peticiones al arquitecto / ux-ui / PO

1. **(Abierta, no bloqueante — la hereda §22.12 nº14) Un canal para el COSTE MEDIDO.** `onMeasured`
   está montado y dormido. Para encenderlo hace falta que `GET /admin/pricing/graded-estimates` (o
   donde el arquitecto decida) exponga **coste medido por día + fecha de la medición**. Hasta
   entonces el aviso dice explícitamente que **no está medido**, que es la verdad. **No lo relleno
   por mi cuenta**, y el tipo de `GRADING_COST_MEASUREMENT` está hecho para que nadie pueda.
2. **(Nueva, y es de la misma familia que el defecto que este pase corrige) El copy afirma que el
   tope «se edita en M2 · Catálogo y precios», y hoy M2 no lo dibuja.** `ingestMaxCardsPerRun` es
   editable **por contrato** (`GradedEstimateConfigInput`), pero la sección de M2 no expone el campo:
   solo se **lee** desde M10. Es la misma clase de afirmación no respaldada —manda al dueño a una
   pantalla donde no puede hacer lo que el aviso le dice— aunque de gravedad mucho menor, y es
   hermana de la deuda **F-19** (`manualFreshnessDays` / `maxRawMultiple`, también editables solo por
   API). **No lo arreglé por mi cuenta** porque hay dos salidas y ninguna es mía: **(a)** ux-ui añade
   el campo a §22.x de M2 y yo lo implemento, o **(b)** ux-ui ajusta el copy de §22.13(d)/(f). Pido
   decisión.
3. **Sin cambios en `docs/API_CONTRACT.md`.** `capturedDate` sigue viajando en `GradedEstimateDTO` y
   **debe seguir**: la frescura del criterio 118 se evalúa con él. La decisión 62 retira lo que se
   **muestra**. Si el arquitecto quiere además retirarlo del contrato, es decisión suya, no mía.

---

## §33 · El candado que se burlaba con un espacio, la fecha que solo oía el lector de pantalla, y el campo que hace verdad el aviso (`DESIGN_SYSTEM.md` §22.14 / §22.13(e)(f), criterio 119) — 2026-08-31, rama `claude/psa-graded-card-value-gmhv5u`

> Tres cosas en un solo toque, las dos primeras porque QA las rompió de punta a punta y la tercera
> porque es la que convierte en verdad una frase que el aviso de M10 ya publica.

### 33.1 El invariante por oración cazaba la regresión realista — y se burlaba con no poner un espacio

**Lo que había.** `M10View.test.tsx` partía el aviso con `split(/(?<=\.)\s+/)`: **exige whitespace
tras el punto**. Y `textContent` no pone espacio entre bloques — el propio aviso ya lo demostraba,
produce `…consume créditosPublica.` al concatenar párrafos.

**La burla de QA, reproducida aquí antes de tocar nada.** Se inyectó la cifra desnuda **pegada** al
punto de la oración calificada, en `messages/es.json`:

```
…la factura puede ser varias veces esa cifra.En resumen: gasta 1000 créditos al día. La primera corrida lo mide…
```

El fragmento inyectado **se fusiona** con la oración anterior, hereda su «si cobra por petición» y
pasa. Corrida real con la mutación puesta: **`M10View.test.tsx` 14/14 en verde**, y
`i18n-parity.test.ts` **12/12 en verde** — una afirmación plana de gasto en la pantalla del
consentimiento del dueño, con los dos candados aplaudiendo.

**El arreglo.** El corte vive ahora en `src/test/grading.ts` (`splitSentences`) y **no se copia en
ninguna pantalla**, porque desde §22.14 hay **dos** superficies que publican la misma cifra:

```ts
text.split(/(?<=\.)(?:\s+|(?=[^\s\d]))/)
```

Corta tras un punto **con o sin** espacio detrás. La única excepción es **punto seguido de dígito**
(`1.000`), que es separador de millares y no fin de oración — sin esa excepción el candado se
pondría rojo solo, que es la otra forma de no servir para nada. Es más ancho que el
`(?<=\.)\s*(?=[A-ZÁÉÍÓÚ¡¿])` que propuso QA: también caza continuaciones en minúscula o abiertas por
signo, no solo las que empiezan con mayúscula.

**Alcance, dicho sin adornos (y esta es la lección de redacción del pase).** El resumen anterior
afirmaba que *«mover el candado no basta para burlarlo»*, y eso era **más fuerte de lo que el código
sostenía**: el candado había mejorado, la frase se pasó de rosca. Lo que este corte sostiene, y nada
más: **caza toda continuación tras un punto, lleve espacio o no**. No inventa fronteras donde el
copy no puso ninguna — un título sin punto sigue fundiéndose con la primera oración del cuerpo, y
un texto sin puntos se juzga como una sola oración.

**Segunda línea de defensa, en el catálogo.** La burla también pasaba la paridad porque aquel
candado solo mira las cadenas que **interpolan** `{credits}`. Se añade en `i18n-parity.test.ts`
—ES y EN— que **ninguna cifra de créditos se escriba a mano**: el techo se calcula en
`grading-hook-cost.ts` y se interpola, nunca se teclea. Un número a mano es, por construcción, un
número que nadie recalcula cuando el tope cambia. Con la mutación de QA puesta, ese candado señala
`admin.m10.dials.gradingHook.on` por su nombre.

### 33.2 Criterio 119: una fecha que solo existe para el lector de pantalla **es** la fecha

**Lo que había.** El candado miraba `textContent` y `time, [title], [datetime]`. QA metió
`<span aria-label="Capturado el 22 de agosto de 2026" />` en el bloque de grading: **19/19 en
verde** (reproducido aquí).

**El arreglo.** Se barre el valor de **todos** los atributos del subárbol —no solo `aria-label` y
`aria-description`— y se juzga junto con el texto: fechas ISO, el año, los meses en letra y las dos
capturas del fixture. Se barren todos los atributos a propósito: un dato que no debe existir no debe
existir en ningún canal, y así el candado no depende de acertar **qué atributo** elegirá el próximo.
El selector estructural anterior se queda: dice otra cosa (que no haya `<time>` ni tooltip) y cuesta
una línea.

### 33.3 §22.14 — el tope de cartas por corrida gana campo en M2

Hasta hoy `ingestMaxCardsPerRun` **no se pintaba ni viajaba en el `PUT`**: la única cota entre un
`PUT` y la factura del proveedor (`ARCHITECTURE.md` §4.38r.3) solo se movía por `curl`, mientras el
aviso de M10 le decía al dueño que «ese tope se edita en M2». Era el defecto que costó el rediseño a
dial único (M-46), una pantalla más allá.

- **Bloque propio**, con su regla `border-t border-border pt-4`, bajo la retícula de margen/frescura
  y encima de los párrafos read-only. **No** es una tercera celda: aquellos dos son gates de
  **publicación**, éste **gasta** (§22.14b). El test lo fija de forma verificable —el input de
  frescura sí tiene un `.grid` por ancestro, el del tope **no**—, no por comentario.
- **Payload del `PUT`** + validación cliente `[1, 1000]` entera con `rangeError`. Money-safe: campo
  vacío **no** cae a 0 ni al default, bloquea. **Cero 5 000** en código, copy y tests: salió del
  contrato en v1.51-a, y un test es tan buen sitio como cualquiera para reintroducir un número
  muerto — hay candado de catálogo para eso.
- **`Banner` de créditos solo cuando el borrador difiere de lo guardado**: `warning` al subir,
  `info` al bajar, **títulos distintos** (el color no es el único canal, §2.4), `role="status"` —el
  dueño teclea en su borrador; una región asertiva por pulsación es hostil— y **no bloquea guardar**.
  La cifra es la **del borrador** y sale de `grading-hook-cost.ts`: **una sola aritmética en el
  producto**, la misma que cifra el aviso de M10.
- **Hereda §22.13(d.1) sin excepción**: el mismo `expectCreditsFigureQualified` corre sobre el aviso
  de M2. Quitarle el régimen de cobro a `ingestCap.warn` pone rojo **tres** tests (la pantalla y la
  paridad ES/EN) — verificado rompiéndolo.
- **`admin.m10.dials.gradingHook.{off,note}` reescritas: sale «grados».** En M2 son un párrafo
  read-only, así que la escalera de remedios prometía un escalón inexistente. Pasa a **dos**
  escalones, ambos reales (lista de revisión con su ancla, margen mínimo con su `Input`), con
  candado de catálogo ES/EN que lo fija.
- **El check que cierra el círculo (§22.14f f):** guardar el tope en M2 mueve la cifra del aviso de
  M10 **sin recargar**. Se montan las dos pantallas juntas bajo el mismo `QueryClient` y el doble del
  servidor **guarda lo que recibe**: si el `PUT` dejara de llevar el tope, el `GET` de la
  invalidación devolvería el viejo y el aviso no se movería. Un mock que devolviera el valor nuevo
  pase lo que pase probaría la invalidación, no el círculo.

**Detalle para ux-ui (no bloqueante):** el encabezado `h3` del bloque y la etiqueta del `Input` usan
la **misma** clave `ingestCap.label`, porque §22.14 pide las dos cosas y solo define seis claves.
Se imprime dos veces la misma frase. Si se quiere un título de bloque distinto, hace falta una clave
más — no la invento.

### 33.4 Las tres mutaciones (evidencia, no promesa)

| Guarda | Mutación | Rojo real |
|---|---|---|
| Invariante por oración (M10) | cifra desnuda pegada al punto, en `messages/es.json` | `cifra de créditos SIN calificador en su oración: «En resumen: gasta 1000 créditos al día.»: expected … to match /cobra por petición\|ya está medido\|medida el/` |
| Criterio 119 (ficha) | `<span aria-label="Capturado el 22 de agosto de 2026" />` en `GradingEstimateBlock` | `expected 'VALOR ESTIMADO SI SE GRADEASI SALEPSA…' not to match /2026/` |
| §22.14 (tope en M2) | quitar `ingestMaxCardsPerRun` del payload del `PUT` | `expected undefined to be 400` **y** `(f) … expected 'Encendido: publica cifras y consume c…' to match /2000 créditos al día/` |

Antes de cada arreglo se **reprodujo** el verde: 14/14 con la cifra desnuda inyectada, 19/19 con la
fecha en `aria-label`. Los dos candados nuevos de catálogo también se rompieron a propósito y
señalan la clave culpable por su nombre.

### 33.5 Verificación

- `npx tsc --noEmit` ✔ · `npx next lint` ✔ (0 warnings) · `npx vitest run` **842/842 en 94 archivos**
  · `npx next build` ✔.
- **Base: 830/94.** Delta **+12 tests, 0 archivos nuevos, ninguna prueba retirada**:
  - `GradedEstimatesSection.test.tsx` **+6** (§22.14: el campo existe y en su bloque propio · subir ·
    bajar/volver · rango y bloqueo · el tope en el `PUT` con el vacío que no guarda · el círculo con
    M10).
  - `i18n-parity.test.ts` **+6** (ES/EN × tres candados: cifra de créditos escrita a mano, «grados»
    como remedio en `off`/`note`, y el 5 000 retirado en el copy del gancho).
  - `M10View.test.tsx` y `gradingEstimates.test.tsx` **±0 tests**, aserciones más fuertes.
- Cero componentes nuevos, cero tokens nuevos, cero cambios de contrato
  (`GradedEstimateConfigInput.ingestMaxCardsPerRun` ya era opcional), cero escrituras fuera de
  `frontend/`, `docs/FRONTEND_NOTES.md` y `docs/TECH_DEBT.md`.
- El candado de paridad busca ahora el calificador por su **núcleo** («cobra por petición» /
  «charges per request») y no por la frase literal de M10: §22.14 añadió una segunda superficie
  donde el sujeto es explícito («si **el proveedor** cobra por petición»), y un candado atado a la
  variante de una pantalla habría dejado la otra sin cubrir.

### 33.6 Peticiones

1. **La petición 2 de §32 queda CERRADA por la vía (a):** ux-ui especificó §22.14 y el campo está
   implementado. El puntero «ese tope se edita en M2» es verdad verificable, y hay un test que lo
   comprueba **por los dos lados**.
2. **Sigue abierta la de §32 nº1** (canal para el **coste medido**): `onMeasured` continúa montado y
   dormido, y no se rellena a mano.
3. **Editor de «grados» — no lo pido, lo constato.** `grades`/`highlightGrades` siguen read-only en
   M2 (hermanos de **F-19**). Desde este pase **ninguna pantalla los ofrece como remedio**, así que
   no hay nada roto que arreglar: darles editor es feature nueva con invariantes propios
   (`highlightGrades ⊆ grades`) y entra por `PROJECT.md`, como dice §22.12 nº17.

## §34 · Peso de imagen en la home, la candidata a LCP, el preconnect que faltaba, la miniatura del carrito de VENTA y el mock que tapaba un bug de producción — 2026-08-31, rama `claude/tcg-hunt-orchestrator-28p7z1`

> Seis arreglos acotados de rendimiento de imágenes + una miniatura faltante. Diagnóstico previo
> verificado; aquí solo se implementa. **Cero cambios de contrato** (uno se ESCALA, ver §34.7).
> Escrituras: `frontend/` y este archivo. No se tocó `backend/`, `next.config.mjs` ni `next/image`
> (esa decisión está con el arquitecto).

### 34.1 El carrusel descargaba 7 imágenes HD para pintarlas a 160px

`FeaturedCarousel.tsx` — las tejas **secundarias** pedían `imageLargeUrl ?? imageSmallUrl`
(~734×1024 en pokemontcg.io) y las pintaban a `w-[160px]` / `lg:w-[268px]`. Son **siete** tejas y es
el **primer bloque con imágenes de la home**. Pasan a `imageSmallUrl` (245×342).

La teja **líder** (`w-[236px]` / `lg:w-[400px]`) **NO cambia**: ahí P-39 («foto HD en el
featured/ficha») sigue vigente y con 400px la chica se vería blanda. La asimetría es intencional y
queda escrita **en las dos tejas** para que nadie la «uniformice» de vuelta en una limpieza.

> Nota honesta: en `lg` la teja secundaria mide 268px y la imagen chica 245px de ancho — un 9 % de
> upscale en pantallas 1x. Se acepta: el ahorro de bytes es de otro orden de magnitud. Si esas tejas
> crecen por encima de ~245px reales en móvil/tablet, toca revisar.

**No pude medir los bytes.** El egress a `images.pokemontcg.io` está **bloqueado por política del
proxy** en este entorno (`CONNECT … 403`, `connect_rejected`), así que no hay cifra real que
reportar y **no la estimo**. Lo verificable es la geometría: 734×1024 contra 245×342 (**~12.6× el
área de píxeles**). Queda como tarea de medición para quien tenga red hacia el CDN.

### 34.2 `CardImage` gana `priority` (opt-in) — la imagen del LCP dejaba de ser prioritaria

`CardImage` ponía `loading="lazy"` a **todo**, incluida la teja líder del carrusel, que es la
**candidata a LCP** de la home. Encima el fade-in `opacity-0 → opacity-100` esperaba al `onLoad`:
aunque los bytes ya hubieran llegado, el pintado (y con él la métrica) se retrasaba.

Nueva prop `priority` (default `false` ⇒ **conducta previa idéntica en las 14 superficies que ya
usaban el componente**): `loading="eager"` + `fetchpriority="high"` + sin fade. Se usa **en un solo
sitio**: la teja líder. En rejillas NO se usa — `lazy` es lo correcto ahí, y varias `high`
compitiendo por ancho de banda retrasan justo a la que importa. La regla está escrita en el JSDoc de
la prop.

**Detalle de react-dom 18:** el atributo va en **minúsculas** (`fetchpriority`). Con la grafía
camelCase que declara `@types/react` (`fetchPriority`), react-dom 18 no lo reconoce y avisa por
consola («React does not recognize the fetchPriority prop…»), ensuciando la salida de los tests. Se
emite en minúsculas con un `as` acotado y comentado; al subir a React 19 puede volver a camelCase.
Hay un test que falla si vuelve el aviso.

### 34.3 `decoding="async"` en `CardImage`

Para todas las imágenes de carta. Barato, sin efecto visual, no bloquea el hilo principal mientras
el navegador descomprime el JPEG.

### 34.4 `preconnect` a `images.pokemontcg.io`

`grep -rn "preconnect\|dns-prefetch" frontend/src` daba **cero**. **Todas** las imágenes de carta de
la app vienen de ese tercero, así que el navegador pagaba DNS + TCP + TLS completos **después** de
descubrir el primer `<img>`. Van `preconnect` + `dns-prefetch` (respaldo) en el `<head>` del layout
raíz `src/app/[locale]/layout.tsx` — es el único layout que renderiza `<html>`; el layout de
`(storefront)` no llega al `<head>`.

- **Sin `crossOrigin`**: un `<img>` normal no se pide en modo CORS; un preconnect `anonymous` abriría
  una conexión de otra piscina que esas imágenes no reutilizarían (trabajo de más, ahorro cero).
- **`tcgplayer-cdn.tcgplayer.com` queda FUERA, a propósito**: en la home el sellado vive en
  `SealedShelf`, **por debajo** del carrusel (bajo el pliegue). Preconectar dominios que quizá no se
  usen desperdicia conexiones. Si algún día el sellado sube sobre el pliegue, ese es el momento.

### 34.5 El carrito de VENTA tenía la imagen y no la pintaba

`SellCartContents.tsx` no pintaba miniatura, pero el dato **ya viajaba** en la línea
(`useSellCart.CartLine.card.imageSmallUrl`, poblado desde el binder y el picker de `BuylistView`).
Era el único listado de piezas de la app que lo tenía y no lo usaba. Se pinta con el patrón de
`CheckoutView`: columna fija `w-12` a la izquierda, contenido en `min-w-0 flex-1` (el nombre sigue
truncando en el drawer de 400px). **Es el único cambio visual de este pase.**

`QuoterCardRef.imageSmallUrl` es **opcional** (el binder de Master Set puede no traerla), así que la
columna entera se omite cuando no hay imagen: un `CardImage` sin `src` deja el esqueleto pulsando
para siempre, que se lee como un «cargando» eterno.

> El carrito de **COMPRA** falla por otra causa (el backend no manda la URL) y **no se tocó**: no es
> del front. Ver §34.6 y §34.7.

### 34.6 El simulador mentía, y por eso el bug llegó a producción sin que nadie lo viera

`api.ts` · `getCheckoutQuote` (rama mock) devolvía `card: l.card`, el **`CardDTO` completo** del
fixture. El backend real devuelve otra cosa: `OrdersService.quote()` → `cardSnapshot()`, un snapshot
plano `{ cardId, name, setName, number, productType, rawCondition, gradingCompany, gradeValue }` —
**sin `imageSmallUrl`/`imageLargeUrl`, sin `id`**, y con `productType`/`rawCondition` **dentro** de
`card` en vez de al nivel del ítem. Por eso el carrito se veía impecable en `dev` y en los e2e de
Playwright, y llegaba roto a producción.

El mock ahora replica el snapshot real (`mockQuoteCardSnapshot`). **El mock queda «peor» a
propósito**: en desarrollo el checkout de compra ahora se ve como se ve en producción. Un simulador
feo es mejor que uno que miente.

Para que no se quede desalineado **en la otra dirección**, `api.checkout-quote.test.ts` **pinea las
llaves exactas** del snapshot (`MOCK_QUOTE_CARD_KEYS`, exportada). Cuando backend añada la imagen a
este camino, el test falla y obliga a actualizar mock + lista en el mismo commit.

**Efecto colateral revelado (no es regresión, es la verdad saliendo a flote):** `CheckoutView:237`
lee `item.productType` al nivel del ítem, que el backend **nunca manda ahí** ⇒ el sufijo de condición
(`· NM`) tampoco se pinta hoy en producción. No lo «arreglo» en el front moviendo la lectura dentro
de `card`: eso sería adivinar un contrato. Va a §34.7.

**Gemelo conocido, NO tocado:** `getGuestCheckoutQuote` tiene exactamente la misma mentira
(`guest-checkout.service.ts` usa el mismo `cardSnapshot`). Queda fuera de este pase por alcance;
mismo dueño y mismo arreglo que §34.7 nº1.

### 34.7 Peticiones al ARQUITECTO (regla 9 — no toqué el contrato)

1. **`OrderItemPreview` no está definido en `API_CONTRACT.md`.** El contrato solo lo nombra en
   `POST /checkout/quote` («Res 200: `{ items: OrderItemPreview[], … }`») y el ejemplo trae
   `"card": {}`. `frontend/src/types/contract.ts:158` declara `CardDTO.imageSmallUrl` **obligatorio**
   y `OrderItemPreview.card: CardDTO`, y el backend **no lo cumple**: manda el `cardSnapshot`. Pido
   **definir `OrderItemPreview` en el contrato** y decidir el sentido del arreglo:
   (a) el snapshot gana `imageSmallUrl` (es lo que la UI necesita: el checkout **pinta** miniatura), o
   (b) el tipo del front deja de prometer un `CardDTO`. **La (a) es la que arregla el carrito de
   compra**; con la (b) hay que quitar la miniatura del checkout, que es peor producto.
   Aplica **igual** a `POST /checkout/guest/quote` (§4-G.1) — mismo snapshot, mismo bug.
   Mientras tanto: mock alineado a la realidad + un `as unknown as` acotado y comentado en el punto
   exacto de la divergencia (`api.ts`), más el test que la pinea.
2. **`productType` / `rawCondition` en el preview del quote**: hoy viven dentro de `card` en el
   backend y al nivel del ítem en el tipo del front. Al cerrar el punto 1, decidir dónde van (no lo
   asumo).

### 34.8 Verificación

- `npm install` ✔ (exit 0) · `npm run lint` ✔ **0 warnings, 0 errors** · `npm run typecheck` ✔
  (`tsc --noEmit`, sin salida) · `npm run test` ✔ **849/849 en 96 archivos** · `npm run build` ✔.
- Base antes de este pase: **842/94** (la de §33.5). Delta **+7 tests, +2 archivos**, ninguna prueba
  retirada ni debilitada:
  - `CardImage.test.tsx` **+5**: el default sigue en `lazy` y sin `fetchpriority` (candado de
    no-regresión para las 14 superficies existentes) · `priority` ⇒ `eager` + `fetchpriority=high` ·
    `decoding="async"` siempre · `priority` pinta sin esperar al `onLoad` y sin `priority` conserva
    el fade · **cero avisos de React** por props desconocidas.
  - `api.checkout-quote.test.ts` **+2**: llaves exactas del snapshot y ausencia de imagen.
- **El `preconnect` se verificó en el HTML servido**, no solo en el JSX: `next build` + `next start`
  + `curl /es` ⇒ los dos `<link>` salen **dentro de `<head>`** (offset 23 959, `<body` en 24 163).
  Importaba comprobarlo: con React 18 no hay hoisting de `<link>`, por eso van en el `<head>`
  explícito del layout raíz y no en un layout de grupo.
- Cero tokens nuevos, cero componentes nuevos, cero cambios de contrato, cero escrituras fuera de
  `frontend/` y este archivo. `next/image` sigue sin adoptarse y `next.config.mjs` sin tocar.

---

## §35 · El sufijo «· NM» vuelve, y el tipo falso que lo escondía se retira (contrato v1.51-b) — 2026-08-31

> Rama `claude/tcg-hunt-orchestrator-28p7z1`, sobre `8c6f2ba`. Cierra las dos peticiones al
> arquitecto de §34.7. El arquitecto declaró **`OrderItemCardDTO`** (contrato §4, rev **v1.51-b**) y
> backend implementó `imageSmallUrl` (commit `8c6f2ba`). Este pase alinea el cliente.

### 35.1 La causa raíz no era una línea: era un tipo que prometía lo que nadie enviaba

`contract.ts` declaraba `OrderItemPreview.card: CardDTO` y `CardDTO.imageSmallUrl: string`
(obligatorio). El backend nunca sirvió un `CardDTO` en esa posición: sirve un snapshot congelado.
Con el tipo mintiendo, `CheckoutView` podía leer `item.productType` **al nivel del ítem** y compilar
tan feliz — y el sufijo de condición salía **siempre vacío**, en silencio, durante un release entero.
Un `undefined` en un campo que el tipo jura obligatorio no da error: da una cadena en blanco.

Por eso el arreglo empieza por el tipo y no por la línea. `OrderItemCardDTO`
(`frontend/src/types/contract.ts`) declara los **ocho campos congelados + `imageSmallUrl:
string | null`** y **nada más**; `OrderItemPreview` queda en **tres claves**
(`{ inventoryItemId, card, unitPriceCents }`), espejo exacto del test del backend
(`expect(preview).not.toHaveProperty('productType')`). Las **tres** superficies que sirven líneas de
compra apuntan al mismo tipo: `CheckoutQuoteResponse`, `GuestCheckoutQuoteResponse` y
`OrderDetailDTO`.

Con el tipo honesto, el compilador señaló **solo** los sitios que leían de más — y ninguno más apareció
en las vistas: el resto del código ya leía `card.name` / `card.setName` / `card.number` /
`card.imageSmallUrl`, que sí existen. El bug era exactamente el que se había escalado, ni uno más.

### 35.2 Lo que cambió, sitio por sitio

| Archivo | Cambio |
|---|---|
| `src/types/contract.ts` | nace `OrderItemCardDTO`; `OrderItemPreview` a 3 claves; `OrderDetailDTO.items` y `GuestCheckoutQuoteResponse.items` pasan a `OrderItemPreview[]` |
| `CheckoutView.tsx` | `item.productType`/`item.rawCondition` → **`item.card.productType`/`item.card.rawCondition`**. El sufijo «· NM» vuelve a pintarse |
| `GuestCheckoutView.tsx` | misma meta que la cuenta: el invitado tampoco veía la condición (§4-G.1 comparte forma con §4) |
| `components/ui/CardImage.tsx` | `src?: string \| null` y el esqueleto pulsa **solo si hay `src`** |
| `lib/mock/fixtures.ts` | nace `orderItemCard(listing)`; `mockOrderDetail.items[].card` deja de ser un `CardDTO` |
| `lib/api.ts` | los **dos** mocks de quote sirven `OrderItemCardDTO` con `imageSmallUrl`; muere el `as unknown as` |

### 35.3 `null` no es «cargando»

`imageSmallUrl` es **clave siempre presente, valor nullable**, y `null` es un resultado **legítimo**
(la columna es nullable y la fila `Card` puede no existir). El defecto de `CardImage` era que sin
`src` dejaba el `animate-pulse` **eterno**: un dato ausente por diseño se leía como una app colgada.

Se arregló **en el componente**, no en cada llamada. En §34.5 lo resolví en `SellCartContents` con un
`&&` en el sitio de uso, que es correcto pero no escala: `CardImage` tiene **16 superficies** y varias
más ya recibían `undefined` (`SealedVaultPanel` con `?? undefined`, `PublicOrderTracking` con la
`imageSmallUrl?` opcional de `GuestTrackingItemDTO`) — todas pulsando para siempre. Ahora sin `src`
queda el **pozo de papel quieto**, que es exactamente el «placeholder» que pide el contrato §4.
Con `src` el esqueleto sigue igual: mientras la imagen viaja, sí hay algo que esperar.

Nota deliberada: en el checkout **no se colapsa la columna** de la miniatura como en el carrito de
venta. En una línea de compra la columna es parte de la retícula (§20) y hacerla desaparecer
desalinearía la fila; en el drawer de venta la miniatura era un extra opcional.

### 35.4 El mock ya no miente en ninguna de las dos direcciones

En §34.6 el mock se puso a decir la verdad del backend **de entonces** (ocho campos, sin imagen) y el
pin de `api.checkout-quote.test.ts` se dejó fallando **a propósito hacia arriba**: en cuanto el
backend añadiera `imageSmallUrl`, obligaría a mover mock y pin en el mismo commit. Funcionó
exactamente así — esa es la razón de que el pin exista y no un capricho.

Actualizado contra el contrato nuevo: `MOCK_QUOTE_CARD_KEYS` gana la **novena** llave
(`imageSmallUrl`) y nace `MOCK_QUOTE_ITEM_KEYS` (`inventoryItemId`, `card`, `unitPriceCents`) — el pin
de que **nada se cuela al nivel del ítem**, que es la mitad del bug que nadie estaba vigilando. El
mock de **invitado** (`getGuestCheckoutQuote`), gemelo declarado en §34.6, servía `card: l.card` (el
`CardDTO` del fixture) y ahora pasa por el mismo `orderItemCard()`; el test lo cubre.

### 35.5 Un tipo falso más, del mismo linaje, corregido de paso

`ShipmentDTO.items[].card` estaba tipado `CardDTO` y el contrato §5 declara `ClientShipmentItemDTO.card`
con **cinco** campos (`id, name, setName, number, imageSmallUrl`). **No había bug visible** —
`ShipmentsView` y `ShipmentDetailView` solo leen esos cinco—, pero es la misma clase de defecto que
acaba de costar un release: un tipo que promete `imageLargeUrl`/`rarity`/`availableFinishes` que esa
ruta no envía. Se corrigió el tipo; cero cambios de render, cero fallos de `tsc`.

### 35.6 Verificación

- `npm run lint` ✔ **0 warnings, 0 errors** · `npm run typecheck` ✔ (`tsc --noEmit`, sin salida) ·
  `npm run test` ✔ **857/857 en 97 archivos**.
- Base antes de este pase: **849/96** (§34.8). Delta **+8 tests, +1 archivo**, ninguna prueba retirada
  ni debilitada:
  - `checkout/CheckoutItemLine.test.tsx` **+4** (nuevo): el sufijo «· NM» en el DOM para cuenta y para
    invitado · una pieza `graded` **no** inventa sufijo · `imageSmallUrl: null` no deja `animate-pulse`.
    Lee el **DOM**, no el tipo: si alguien vuelve a subir los campos un nivel, el sufijo desaparece y
    el test cae.
  - `api.checkout-quote.test.ts` **+3** (2 → 5): las 9 llaves del `card`, las 3 del ítem con el
    `not.toHaveProperty('productType')` espejo del backend, `imageSmallUrl` siempre presente y
    nullable, el `card` sin los 5 campos de `CardDTO` que §4 declara ausentes, y la misma forma en el
    camino de invitado.
  - `CardImage.test.tsx` **+1**: sin `src` (y con `src={null}`) ni `<img>` ni esqueleto; con `src` el
    esqueleto vuelve.
- Cero tokens nuevos, cero componentes nuevos, cero escrituras fuera de `frontend/` y este archivo.
  `next.config.mjs` sin tocar y `next/image` sin adoptar (§5.3 de ARCHITECTURE tiene decisión propia
  del arquitecto; **este pase no la implementa**).

---

## §36 · P-49: la rotación automática del carrusel de destacadas (`DESIGN_SYSTEM.md` §23, v2.6) — 2026-08-31, rama `claude/tcg-hunt-orchestrator-28p7z1`

> ⚠️ **RÓTULO DE ESTADO (añadido 2026-08-31) — ESTA SECCIÓN ESTÁ SUPERADA EN PARTE. NO ES EL SITIO AL QUE
> IR POR LA DECISIÓN DEL DUEÑO.**
>
> §36 documenta el pase que **CONSTRUYÓ** el conmutador de reproducción. El dueño lo **retiró** después,
> y esa decisión —con su razón, su alcance y lo que se perdió— vive en **§39**, no aquí. Quien siga un
> puntero a «§36» buscando la decisión aterriza en una descripción de piezas que **ya no existen**:
> `PlaybackToggle`, el slot `titleAdjacent` de `Shelf`, «las 10 claves de §23.12» y la cadencia de 7 s.
> Los punteros del código (`FeaturedCarousel.tsx`) se corrigieron a §39 en el pase de §40.
>
> **Qué sigue vigente de §36:** los dos hallazgos de navegador (36.2 «cualquier scroll que no hayamos
> originado deja la función muerta» y 36.3 «R6 no se cumple en el extremo derecho»), 36.4 (§23.8 promete
> ocho tejas sin JS y hoy no es cierto) y la geometría. **Qué NO:** todo lo que menciona el conmutador,
> sus claves i18n, su área táctil, `titleAdjacent` y la cadencia de 7 s.
>
> Correcciones puntuales anteriores: §38.1 y §38.2 (dentro del texto, en su sitio).

**Procedencia.** Este frontend **recomendó no hacerlo**, con tres argumentos. El dueño los oyó y decidió
hacerlo igualmente, y ux-ui **resolvió los tres** en vez de ignorarlos (§23.1 reconcilia la doctrina de
movimiento con la nueva §17.3a, §23.8 corrige la nota 2 de §20.16, §23.7 cierra el hueco de
`prefers-reduced-motion`). Este pase implementa §23 al pie de la letra salvo **dos** puntos, ambos
descubiertos **en el navegador** y documentados abajo con su evidencia.

### 36.1 Qué se construyó

| Pieza | Archivo | Qué hace |
|---|---|---|
| Geometría pura | `frontend/src/app/[locale]/(storefront)/_home/carouselGeometry.ts` | `readTrackGeometry` / `nextScrollTarget` / `prevScrollTarget` / `pageScrollTarget` / `scrollTrackTo`. Todo el cálculo del destino, **sin DOM**, para que R6 quede cubierto por tests de verdad |
| Rotación + máquina de estados | `_home/FeaturedCarousel.tsx:220-560` | modos `playing`/`paused`/`ended`, suspensión de nivel 1, temporizador, precondiciones, canal de estado |
| Conmutador | `_home/FeaturedCarousel.tsx:139-181` (`PlaybackToggle`) | mono 10px + glifo lucide 12/14px, tinta, sin caja, área táctil por `::after` |
| Slot del encabezado | `_shared/Shelf.tsx` (`titleAdjacent`, `sectionRef`, `ariaRoledescription`) | el hueco estructural del kicker, **sin** su envoltorio `.eyebrow` |
| Aviso de carga de la foto líder | `frontend/src/components/ui/CardImage.tsx` (`onLoaded`) | precondición 3 de §23.3 |
| i18n | `frontend/messages/{es,en}.json` → `home.featured.*` | las 10 claves de §23.12, con paridad ES/EN |

**Las siete reglas duras, una por una:**

- **R1 (rota la ventana, nunca el rol).** ⚠️ **Enunciado CORREGIDO en §38.2 — lo que decía aquí era
  falso.** Decía: *«lo único que la rotación escribe es `scrollLeft`; el tic no provoca ni un
  `setState`»*. **No es cierto:** el tic llama a `measure()`, que escribe `canPrev`/`canNext`/`overflows`,
  y hay re-render en el primer tic y en el último. R1 se cumple igual, pero **por otra razón**: el rol de
  teja se deriva del **índice del array** sobre una lista que la rotación jamás toca, con `key` estable,
  así que React reconcilia en sitio (mismo nodo, mismo `src`, mismo `fetchpriority`). Ésa es la garantía
  dura y la fija el test `FeaturedCarouselRotation.test.tsx` («la teja líder conserva identidad, sitio,
  imagen HD y fetchpriority en TODOS los tics»), que compara la **referencia del nodo** y el orden de
  `alt` de las ocho tejas en los siete tics. Es la prueba que protege lo que arregló §34.1 — y el
  invariante se sostiene **por** ella, no sin ella. Detalle y por qué el argumento viejo era peligroso:
  §38.2.
- **R2 (nunca coexiste con carga).** Cuatro precondiciones: hidratado · consulta resuelta con ≥ 2 tejas ·
  `load` de la foto líder **o** tope de 3 s · 7 s de reposo. Con skeleton no hay pista, y sin pista no hay
  ni temporizador ni conmutador.
- **R3 (freno siempre visible).** El conmutador se renderiza con **el mismo booleano** que habilita el
  movimiento (`rotationPossible`), así que no puede existir uno sin el otro.
- **R4 (`prefers-reduced-motion` ⇒ cero).** En la **lógica del componente**, como pide §8.2: el
  temporizador no arranca, el conmutador no se renderiza, las flechas pasan a `behavior:'auto'`. Se
  escucha **en vivo** con `useMediaQuery`, que ya suscribía `change`.
- **R5 (la intervención gana para siempre).** Sin reanudación automática. Ver §36.2 — la regla se conserva
  en su intención pero **hubo que acotarla**.
- **R6 (una teja por tic, al punto de snap).** Destino desde `offsetLeft`, nunca `scrollBy(ancho × 0,8)`.
  Ver §36.3 — hay una excepción geométricamente inevitable.
- **R7 (una pasada y para).** `ended` usa **el mismo predicado** que apaga la flecha «siguiente». Sin
  clones, sin bucle, sin rebobinado animado; REPETIR salta a 0 sin animación.

### 36.2 Hallazgo 1 — «cualquier scroll que no hayamos originado» deja la función MUERTA al primer render

§23.5 enuncia: *«cualquier desplazamiento de la pista que el carrusel no haya originado ⇒ PAUSA
PERMANENTE»*, como regla general para cubrir los casos que nadie enumeró. Implementada literalmente,
**el carrusel se pausaba solo antes de su primer tic**. Evidencia, con un listener de captura en
Chromium sobre la home real (build de producción, modo mocks):

```
{"ev":[{"t":999,"id":"piezas-destacadas-pista","left":32}], "label":"Reanudar la rotación automática"}
```

Un único evento `scroll`, ~1 s después de hidratar, sin usuario de por medio: es **el propio motor
aplicando `scroll-snap`**, que mueve `scrollLeft` de 0 al valor del `gutter` (32px en `lg`). El anclaje de
scroll hace lo mismo cuando una imagen tardía cambia el layout. En la primera corrida de E2E el
conmutador ya decía **REANUDAR** antes de que nadie tocara nada.

**Resolución (no re-litiga la decisión, la hace funcionar):** ⚠️ **CORREGIDA en §38.1 — la guarda (a)
se retiró.** Este pase dejó **dos** guardas: (a) no lo originamos nosotros **y** (b) el usuario tocó la
pista hace menos de `USER_INPUT_WINDOW_MS` (1200 ms), medido con `pointerdown` / `touchstart` / `wheel` /
`keydown` / `focus` sobre la pista. **(a) sobraba y hacía daño**: hoy queda **solo (b)**, que es el
enunciado literal de §23.5a. Ver §38.1 con la medición.

La guarda que queda cubre **exactamente** lo que §23.5 enumera —swipe, arrastre, rueda/trackpad y «el
scroll que provoca el navegador al tabular a una teja fuera de pantalla», que llega por `focus`— y deja
fuera lo que §23.5 no puede haber querido decir: un reajuste del motor de layout no es una intervención
del usuario. Los cinco listeners solo escriben un `ref`: cero re-render por mover el ratón.

Regresión fijada en `FeaturedCarouselRotation.test.tsx` («un re-snap del NAVEGADOR (scroll sin entrada del
usuario) NO pausa»).

### 36.3 Hallazgo 2 — R6 no puede cumplirse en el extremo derecho de la pista

R6 dice: *«ningún reposo deja una teja cortada por el borde izquierdo»*. En el **tope** de la pista
(`scrollWidth − clientWidth`) eso es geométricamente imposible salvo que el contenido sea múltiplo exacto
del paso de teja: ahí la última teja queda flush a la **derecha** y la primera visible sale cortada por la
izquierda. Afecta al **último** tic de la pasada y a la última pulsación de flecha, y no hay alternativa
mejor —pararse en el snap anterior dejaría la última teja permanentemente inalcanzable, que es peor—.
Se acepta, se documenta y los asertos de E2E lo contemplan explícitamente (`snap || tope`). No es una
licencia de implementación: en cualquier otro reposo el aterrizaje **sí** es un punto de snap.

### 36.4 Hallazgo 3 — §23.8 promete ocho tejas sin JS, y hoy eso NO es cierto (y no lo introduce §23)

§23.8 (y la corrección de §20.16 nota 2) afirman que sin JS queda *«una pista de scroll-snap nativa con
sus ocho tejas completas y legibles»* y que *«el contenido nunca depende del JS»*. **Verificado en
Chromium con `javaScriptEnabled: false`: el contenido sí depende del JS.** Las tejas las trae
`GET /catalog/cards` por react-query **en el cliente**, así que sin JS el estante se queda en su estado de
carga. Es una condición **preexistente** de la home, no algo que §23 haya introducido, y §23 la mejora en
lo que sí le toca: sin JS **no se pinta ni una flecha ni el conmutador**, así que no queda ningún control
muerto y —lo que importa para 2.2.2— **no puede haber movimiento sin freno**.

Corregirlo del todo es mover la consulta a servidor (RSC/prefetch/hidratación de la caché), decisión de
arquitectura fuera de este pase. **Solicitud al arquitecto** anotada en el resumen. El E2E afirma lo
verificable y declara en su cabecera lo que no puede afirmar, en vez de fingir cobertura.

### 36.5 Decisiones de implementación menores

- **`titleAdjacent` en vez de ampliar `kicker` a `ReactNode`** (§23.15 nº1 ofrecía las dos vías). El
  camino del kicker envuelve el contenido en `<span class="eyebrow">`, que impone **color muted** y
  `gap-4` en todas las anchuras; §23.4b pide **tinta** y `gap` 12/16px. El slot hermano evita
  sobreescribir dos propiedades heredadas por accidente. `kicker` **también** se amplió a `ReactNode`
  como pedía la nota (cambio de tipo, cero cambios de render): el kicker de Gradeadas sigue siendo texto
  y ninguna otra pantalla se toca — verificado con `tsc` y con los 917 tests.
- **Las flechas se arreglaron sin cambiarles el paso.** §23.15 nº2 señalaba el `scrollBy(clientWidth ×
  0,8)`; §23.13 nº13 prohíbe cambiar el **paso** de las flechas. Se conservan las dos cosas: el paso sigue
  siendo ~una página, pero el **destino** es ahora el punto de snap de una teja (`pageScrollTarget`), así
  que la flecha ya no deja media teja cortada por el borde izquierdo. Con `snap-x` en `proximity` (que es
  lo que hay hoy) el navegador **no** corregía ese reposo por su cuenta.
- **Las flechas dejaron de pintarse antes de hidratar** (§23.8, §20.16 nota 2 corregida). Su paso, su
  tamaño y su apagado en los extremos **no cambian** (§23.13 nº13).
- **REANUDAR desde el extremo va a TERMINADO, no a «reproduciendo».** El diagrama de §23.5 no cubre
  «pausado + ya no queda pista»; anunciar «reproduciendo» sobre algo que no puede moverse sería falso.
  Se resuelve con el mismo predicado (`canNext === false`) y el conmutador queda en **REPETIR**.
- **`aria-live` de la pista atado al temporizador**, no al modo (§23.9b), y línea `role="status"`
  `sr-only` que emite **solo** en las dos transiciones no solicitadas.
- **Suspensión por «< 50 % visible»** con `IntersectionObserver` y una escotilla: si la pista es más alta
  que la mitad del viewport, el ratio nunca llegaría a 0,5 y el carrusel quedaría congelado con la pista
  llenando la pantalla. Sin `IntersectionObserver` (jsdom, navegadores viejos) se asume visible.
- **Cero tokens nuevos, cero componentes de dominio nuevos, cero cambios de contrato.** `next/image` **no**
  se adopta (§5.3 de `ARCHITECTURE.md` es decisión del arquitecto, fuera de este pase) y `next.config.mjs`
  no se toca.

### 36.6 La red de seguridad: qué quedó cubierto y qué NO

**Cubierto** — `carouselGeometry.test.ts` (**17**, aritmética pura) + `FeaturedCarouselRotation.test.tsx`
(**43**, temporizadores falsos) + `e2e/featured-rotation.spec.ts` (**8**, Chromium):
reposo inicial y las cuatro precondiciones · una teja por tic y el aterrizaje en snap · `prefers-reduced-
motion` inactivo, activo, y **activado en caliente** · el conmutador ausente en los cinco casos de §23.4d
· suspensión por puntero, foco y pestaña oculta, sin tics acumulados · intervención por swipe, rueda,
foco perseguido, flecha y ancla, permanente · re-snap del navegador que **no** pausa · fin de pasada,
REPETIR y el retroceso desde TERMINADO · identidad y `fetchpriority` de la teja líder en los siete tics ·
numeración intacta · `aria-roledescription`, `aria-live` conmutando, pista con nombre, tejas sin
`aria-label` · orden de tabulación, WCAG 2.5.3, área táctil ≥ 44×44 **medida en el navegador** en 390 /
640 / 1024 sin solaparse con el H2 ni el link · paridad ES/EN.

**NO cubierto, y por qué:**

1. **La suspensión por «menos del 50 % de la pista visible»** (§23.5). jsdom no tiene
   `IntersectionObserver`, y en E2E exigiría dejar la home haciendo scroll durante ≥ 7 s para distinguir
   la suspensión de un tic tardío. Es el único freno de §23.5 sin test.
2. **`behavior:'smooth'` vs `'auto'` como comportamiento observable.** `Element.prototype.scrollTo` **no
   existe en jsdom**; el componente cae a `scrollLeft = n`, que es un salto. Lo que sí está cubierto es
   *qué* `behavior` se pide (rama con `scrollTo` inyectado en `carouselGeometry.test.ts`) y que con
   movimiento reducido la flecha llega a su destino sin esperar animación (E2E).
3. **Los ≈ 550 ms del deslizamiento y el ≈ 7 % de ciclo de trabajo** (§23.1 punto 3). Los fija el scroll
   suave nativo del navegador; no hay API para medirlo de forma estable en CI.
4. **El renderizado del servidor sin hidratar** (fila del medio de §23.8). RTL monta y ejecuta efectos: no
   hay forma de observar el frame previo. El E2E sin JS cubre el extremo (ni flechas ni conmutador).
5. **Contraste y versalitas.** Son CSS (`.eyebrow` + `text-text`, par ya verificado en §10/§23.11);
   ningún test los mide.
6. **El layout de la pista en los tests unitarios está INYECTADO.** jsdom no calcula layout, así que
   `offsetLeft`/`clientWidth`/`scrollWidth` se sobrescriben a mano. Los unitarios no demuestran que la
   teja aterrice visualmente flush: eso lo demuestra el E2E, midiendo `getBoundingClientRect()` real.

### 36.7 Verificación

- `npm run lint` ✔ **0 warnings, 0 errors** · `npm run typecheck` ✔ · `npm run test` ✔ **917/917 en 99
  archivos** · `npm run build` ✔.
- Base antes de este pase: **857/97** (§35.6). Delta **+60 tests, +2 archivos**, ninguna prueba retirada ni
  debilitada.
- `npx playwright test e2e/featured-rotation.spec.ts` ✔ **8/8** en Chromium (build de producción, modo
  mocks). Sin regresiones en `grading-estimate.spec.ts`, `catalog.spec.ts` e `i18n-locale.spec.ts`
  (**30 passed, 3 skipped** — los 3 son los `@real` que necesitan backend).
- Cero escrituras fuera de `frontend/` y este archivo.

---

## §37 · El acta histórica deja de pintarse MUDA: forma tolerante + render degradado (contrato v1.51-c, ARCHITECTURE §5.2.9) — 2026-08-31, rama `claude/tcg-hunt-orchestrator-28p7z1`

> Encargo del arquitecto (§5.2.9, fila **frontend**, puerta: antes del merge del stream «Órdenes y
> dinero»), convertido en bloqueante por QA. Los commits anteriores de este stream se escribieron
> contra **v1.51-b** y eran conformes a él; **v1.51-c** aterrizó después. Es encargo abierto, no
> regresión.

### 37.1 El defecto: el mismo del `CardDTO` falso, por el otro lado

`GET /orders/:orderId` es la **única** superficie que lee del HISTÓRICO. Su `card` sale de
`OrderItem.cardSnapshot`, una columna `Json` que PostgreSQL **no valida** y que en un pedido antiguo
escribió una versión anterior de nuestro propio código. `src/types/contract.ts` la tipaba como
`OrderItemPreview` — o sea `OrderItemCardDTO` completo, con `name: string` **requerido**.

Servido el blob incompleto que el backend produce de verdad, la línea **no reventaba y el importe salía
bien**, pero se pintaba muda:

```
NOMBRE RENDERIZADO => [""]        ← `{it.card.name}` con `name` ausente rinde cadena vacía en React
IMGS => [{"alt": null, ...}]      ← <img> sin alt (WCAG 1.1.1)
```

Es el gemelo exacto del `CardDTO` falso de §35: un tipo de cliente **prometiendo** lo que el backend
puede no enviar. En §35 el tipo prometía de más y escondía el «· NM»; aquí promete de más y deja la
línea sin voz. La misma grieta, invertida.

### 37.2 Lo que cambió, sitio por sitio

| Archivo:línea | Cambio |
|---|---|
| `frontend/src/types/contract.ts:638` | `FrozenCardFacts` (los 8 hechos de clase F) + `ResolvedCardImage` (clase P) como piezas separadas. |
| `frontend/src/types/contract.ts:652,654,656` | **I3**: `rawCondition`/`gradingCompany`/`gradeValue` pasan de `?: T` (opcional-ausente) a **`T \| null` con la clave SIEMPRE presente**, que es como viajan de verdad (el checkout los congela desde columnas nullables de `InventoryItem`). Sin bug hoy —nadie usaba `in` como discriminante— pero el tipo ya no miente. El discriminante sigue siendo `productType`. |
| `frontend/src/types/contract.ts:675,699` | `OrderItemCardDTO = FrozenCardFacts & ResolvedCardImage` (los DOS quotes, forma completa) y **`HistoricalOrderItemCardDTO = Partial<FrozenCardFacts> & ResolvedCardImage`** (histórico, forma tolerante). |
| `frontend/src/types/contract.ts:719` | `OrderItemDTO` (línea de `GET /orders/:orderId`) — mismas tres claves que el quote, `card` tolerante. |
| `frontend/src/types/contract.ts:772` | `OrderDetailDTO.items: OrderItemDTO[]` (era `OrderItemPreview[]`). **El cambio de tipo solo ya puso el `alt` en rojo en `tsc`.** |
| `frontend/src/lib/historical-card.ts` (nuevo) | `historicalCardName` + `historicalCardMeta`: render degradado por campo, funciones **puras**. No hay dónde colgar una petición aunque alguien quisiera. |
| `frontend/.../orders/[orderId]/OrderDetailView.tsx:52-109` | Render degradado: etiqueta neutra i18n, `alt` siempre con texto, subtítulo compuesto por fragmentos y omitido entero si no queda ninguno. |
| `frontend/messages/{es,en}.json` | `orders.item.unknownCard` («Carta sin registro» / «Card not recorded») + `orders.item.unknownCardHint` (el `title` que explica que **el importe no cambia**). No existía en ninguno de los dos idiomas. |
| `frontend/src/lib/mock/fixtures.ts:333-335` | `orderItemCard()` sirve los tres campos como `null`, no `undefined` (alineado a I3). |
| `frontend/src/lib/mock/fixtures.ts:995` | `mockOrderDetailLegacy` (`ord-9003`) — acta con blob incompleto, tres líneas: completa / parcial / vacía. |
| `frontend/src/lib/api.ts:878` | `getOrder('ord-9003')` sirve ese acta en modo mocks. |

### 37.3 La etiqueta neutra tenía que verse deliberada, no como un error

Mono en versalitas `text-muted` (`font-mono text-[11px] uppercase tracking-[0.08em]`): el mismo
tratamiento que el resto de etiquetas honestas del sistema, y **no** el `accent` de `PendingPriceLabel`
—esto no es una alerta, es un hecho que el acta no registró—. Tres detalles que no son cosméticos:

1. **Sin `lang="en"`.** El nombre de una carta es dato de catálogo en inglés; la etiqueta neutra es copy
   de la interfaz. Heredar el `lang="en"` haría que un lector de pantalla leyera «Carta sin registro» con
   fonética inglesa.
2. **`title` con el porqué** (`unknownCardHint`), que dice explícitamente que **el importe cobrado no
   cambia**. Es lo que un cliente mirando su acta necesita saber.
3. **El `alt` de la miniatura es la misma etiqueta.** `alt=""` (decorativa) sería mentir: la miniatura de
   una línea de compra es contenido.

El subtítulo (`Base Set · #4 · NM`) se compone con lo registrado y **se omite lo demás**: sin `#`
huérfano, sin `· ` colgando, sin renglón vacío que reserve espacio y se lea como un fallo de carga. Es
el mismo renglón mono del checkout, así que el acta y el carrito dicen lo mismo con la misma voz.

### 37.4 Lo que NO se hizo, que es la parte importante

⛔ **No se rellena el hueco.** Ni con `GET /catalog/cards/:cardId` ni con ninguna otra consulta. El
catálogo dice cómo se llama esa carta **hoy**, no qué decía el pedido cuando se pagó; rellenar convierte
«el acta no lo registró» en un dato inventado presentado como probatorio, dentro de un registro
dinero-adyacente (§5.2.2 / §5.2.9). El hueco se ve; el relleno no.

Backend ya tiene su guardián del lado servidor. Del lado del cliente el guardián es un **test**:
`OrderDetailView.test.tsx` espía `getCardDetail` y `getCatalog` con una línea que trae `cardId` y **no**
trae `name` —el caso donde el relleno sería posible— y exige que **ninguna** se llame, y que el nombre
que hoy tiene esa carta en el catálogo **no aparezca** en pantalla. Además, las dos funciones de
`historical-card.ts` son puras y síncronas: para rellenar habría que reescribir el módulo, no colarse
en él.

**`null` ≠ ausente en las tres condicionales.** `rawCondition`/`gradingCompany`/`gradeValue` se leen con
`== null` (cubre los dos casos: la clave presente con `null` del checkout vigente y la clave omitida de
un blob viejo). Y `productType` ausente **no se infiere**: sin él no se pinta adorno de condición aunque
`rawCondition` viniera en el blob — inferir el tipo desde qué claves llegaron es el `'rawCondition' in
card` que el contrato prohíbe.

### 37.5 El simulador vuelve a poder producir lo que el backend produce

`ord-9003` (`mockOrderDetailLegacy`) es un pedido de **2024** con tres líneas: blob completo, blob
parcial (`name` + `number`, sin `setName` ni `productType`) y **blob vacío** (`{ imageSmallUrl: null }`,
el peor caso del contrato). Está en `mockOrders`, así que el render degradado es **visible en `dev`**, no
solo en un test. Es la lección de §34.6 aplicada otra vez: la grieta anterior existió porque el mock
servía datos más completos que el backend y en local todo se veía impecable.

Importes de ese acta: `unitPriceCents` **intactos** en las tres líneas y `breakdown` coherente, porque el
dinero **no vive en el blob** (`OrderItem.unitPriceCents` es columna propia; el desglose sale de columnas
de `Order`). Un snapshot incompleto no puede mover un centavo.

### 37.6 M-1 — el candado que le faltaba al trabajo de rendimiento de `171f24b`

QA revirtió las dos mejoras y la suite siguió verde: una mejora invisible para los tests es una conducta
que el siguiente refactor deshace sin enterarse. Ahora muerde:

- `FeaturedCarousel.test.tsx` (+3): las tejas **secundarias** piden `imageSmallUrl` (y su `src` no
  contiene `-large`); la teja **líder** conserva `priority` (`loading="eager"` + `fetchpriority="high"` +
  sin fade-in); y `priority` es **exclusivo** de la líder (las demás `lazy`, sin `fetchpriority`).
- `src/app/[locale]/layout.test.tsx` (nuevo, 3): el `<head>` trae `preconnect` **y** `dns-prefetch` a
  `images.pokemontcg.io`, **sin** `crossorigin` (un `<img>` normal no se pide en modo CORS: el
  `anonymous` abriría otra piscina de conexiones), y **un solo** dominio preconectado. Se renderiza el
  layout de verdad con `renderToStaticMarkup` —`next/font/google` y `next-intl/server` se sustituyen,
  porque lo que se mide es el `<head>`, no la fuente—.

### 37.7 M-3 — el comentario que dejó de ser cierto: se alinea la geometría

`SellCartContents.tsx` omitía **la columna de imagen entera** cuando la línea no traía miniatura,
justificándolo con «un `CardImage` sin `src` deja el esqueleto pulsando para siempre». Esa razón la
derogué yo mismo en `6396edb`: hoy el esqueleto pulsa **solo** mientras hay una imagen en vuelo, y sin
`src` queda el pozo de papel quieto, que **es** el placeholder del sistema (§35.3).

Elijo **alinear la geometría**, no reescribir la excusa: la columna se pinta siempre. Dos filas con
geometría distinta en el mismo drawer —y distinta de la del checkout— según un dato que el usuario no
controla era el peor de los dos resultados. El comentario ahora cuenta esa historia.

### 37.8 Peticiones al arquitecto (regla 9 — no toqué el contrato)

Ninguna. El encargo §5.2.9 se implementa tal cual está escrito; no hizo falta ningún campo ni endpoint
que el contrato no tenga. (La petición sobre §23.8 —resolver la consulta del carrusel en servidor— sigue
enrutada aparte y no bloquea.)

### 37.9 Verificación

- `npm run lint` ✔ **0 warnings, 0 errors** · `npm run typecheck` ✔ · `npm run test` ✔ **943/943 en 102
  archivos** · `npm run build` ✔.
- Base antes de este pase: **917/99** (§36.7). Delta **+26 tests, +3 archivos**, ninguna prueba retirada
  ni debilitada.
- **Verificación destructiva.** Sirviendo `mockOrderDetailLegacy` (el blob incompleto):

  | | Antes | Ahora |
  |---|---|---|
  | Nombre de la línea vacía | `[""]` | `"Carta sin registro"` / `"Card not recorded"` |
  | `alt` de la miniatura sin nombre | `null` | la etiqueta neutra (no vacía) |
  | Subtítulo del blob parcial | (no había) | `#58` — sin `· ` colgando ni adorno inferido |
  | Importes | `MX$450.00 / MX$125.00 / MX$80.00` | **idénticos** |

- **Los candados muerden** (revertido cada cambio, uno por uno): render degradado → **8 tests en rojo** +
  `tsc` en rojo (`alt`: `string | undefined` no asignable a `string`); teja secundaria a `imageLargeUrl`
  → **1 en rojo**; `priority` fuera de la líder → **1 en rojo**; `preconnect` borrado → **2 en rojo**.
  Todo restaurado después.
- Cero escrituras fuera de `frontend/` y este archivo. `next/image` **no** se adopta, `next.config.mjs`
  intacto, `backend/` intacto.

---

## §38 · Un test verde que certificaba lo contrario de la norma, y dos enunciados falsos que lo sostenían (hallazgos del techlead sobre §36) — 2026-08-31, rama `claude/tcg-hunt-orchestrator-28p7z1`

> Pase corto de cierre. El trabajo de §36 quedó aprobado y se mergea; esto cierra cuatro cosas que el
> techlead encontró y que **no podían sobrevivir a quien las escribió**: una prueba que afirmaba lo
> contrario de la norma, el comentario falso que la justificaba, un enunciado de rendimiento que era
> falso (aunque su conclusión fuera correcta) y tres huecos de cobertura que sí eran cubribles.
> Nada de esto era urgente por accesibilidad —el conmutador cumple WCAG 2.2.2 y sigue cumpliéndolo—;
> era urgente porque una afirmación falsa **con forma de prueba** es lo que el próximo mantenedor lee
> como especificación.

### 38.1 El hallazgo principal: la guarda que solo disparaba contra la persona a la que decía proteger

**Lo que había.** `handleScroll` tenía dos guardas:

```ts
if (programmaticRef.current > 0) return;   // (a) «este scroll lo originamos NOSOTROS»
if (userInputRef.current === 0) return;    // (b) «nadie tocó la pista hace poco»
```

…y encima el comentario *«Dos guardas, y las dos son necesarias»*. Y un test verde en
`FeaturedCarouselRotation.test.tsx` que hacía `pointerDown(track)` e **inmediatamente después**
`scroll(track)`, y afirmaba que **NO** pausa.

**Por qué eso es una afirmación falsa.** §23.5a es normativa y es un **si y solo si**: un `scroll` pausa
*si y solo si* hay `pointerdown`/`touchstart`/`wheel`/`keydown`/`focus` en los **1200 ms** previos. En ese
test hay un `pointerdown` inmediatamente anterior ⇒ **la norma dice que debe pausar**. El test decía lo
contrario y pasaba, porque el código hacía ganar a la evidencia débil.

**Decisión: se RETIRA (a). No se invirtió el orden.** Tres razones, en orden de peso:

1. **§23.5a es un bicondicional, y una guarda es el bicondicional.** Con (b) sola, el código *es* la norma
   leída en voz alta. Con dos guardas hay que explicar cuál gana y en qué orden — y esa explicación es
   precisamente lo que se había escrito mal.
2. **Invertir el orden deja (a) viva pero inalcanzable en el único caso donde difería.** Sería código
   muerto con un comentario diciendo que es necesario: exactamente la misma forma del defecto que este
   pase viene a cerrar, un escalón más abajo.
3. **(b) ya domina a (a).** Medido, no razonado — abajo.

**La medición (Chromium, build de producción, modo mocks, home real).** Dos sondas de Playwright,
temporales, retiradas tras medir:

| Medición | Qué se instrumentó | Resultado |
|---|---|---|
| **1-bis** — ¿(b) sola basta contra el motor? | Listener de captura de `scroll` + de las cinco entradas, instalado con `addInitScript` (o sea, **desde antes de hidratar**). Pasada completa, 25 s, sin tocar nada | **53 eventos `scroll`, 0 con antecedente de usuario ≤ 1200 ms.** El primero es el famoso `t ≈ 954 ms, scrollLeft: 32` — **el `scroll-snap` de la hidratación que motivó §23.5a**. (b) lo descarta él solo, y descarta los 53 |
| **2** — ¿(a) cambia el resultado en algún sitio? | Esperar al arranque de un tic (`polling: 16`) y emitir una **rueda real** sobre la pista dentro del deslizamiento | Gesto a **+56 ms** del tic ⇒ conmutador **se quedó en PAUSAR** (el gesto se tragó) y, al retirar el puntero, `scrollLeft` **460 → 756**: la rotación **se reanudó sola**. R5 incumplido y §23.13 nº9 al pie de la letra |
| **3** — insumo para la deuda FR-C1 | Rueda **vertical** pura sobre la pista | `dx=0 dy=250` **llega a la pista y arma la ventana** de 1200 ms. §23.5 solo nombra la rueda *horizontal* |

O sea: (a) no aportaba nada en el camino del motor (0 de 53) y su **único** efecto observable era contra
un gesto real. *La guarda solo disparaba contra la persona a la que decía proteger.*

**Confirmación de que el candado nuevo muerde.** Se volvió a poner (a) a mano y se corrió la suite: **1
test en rojo, exactamente el nuevo** (`un gesto REAL dentro del deslizamiento del tic PAUSA…`), 45 en
verde. Es decir: (a) es inerte para todo lo demás que está probado, y lo único que cambia es el caso que
la norma exige. Restaurado después.

**Lo que se borró con ella:** `PROGRAMMATIC_SETTLE_MS` (la constante de 900 ms), `programmaticRef` y el
temporizador que lo decrementaba. `scrollProgrammatically` pasa a llamarse **`moveTrack`**: ya no marca
nada, solo desplaza y mide, y el nombre viejo prometía una marca que ya no existe. El comentario que
queda **no dice «necesarias»**: trae la doctrina («cuando dos evidencias coexisten, gana el humano») y la
medición, y pide explícitamente que quien quiera reintroducir una marca de origen traiga el escenario
concreto en que la persona se equivoca y el motor acierta.

**Los tests, que es lo que no podía quedarse como estaba.** El test falso se sustituye por **dos**, que
son las dos caras del bicondicional:

- *«el scroll de NUESTRO propio tic no pausa, y lo bloquea el antecedente (no una marca de origen)»* — el
  propósito legítimo que (a) decía cubrir, ahora fijado sobre la guarda que de verdad lo cubre.
- *«un gesto REAL dentro del deslizamiento del tic PAUSA: el antecedente del usuario gana (§23.5a)»* — el
  caso que el test viejo negaba, con su comentario explicando qué decía antes y por qué era falso.

Y el escenario se fija además **en el navegador**, que es donde la ventana de coexistencia existe de
verdad (jsdom no tiene scroll suave): `e2e/featured-rotation.spec.ts` → *«§23.5a · un gesto REAL dentro
del tic PAUSA y no se reanuda sola (gana el humano)»*, que reproduce la medición 2 y asserta las dos
mitades: pausa inmediata **y** ni un tic más tras retirar el puntero.

### 38.2 El enunciado de R1 era falso; la conclusión era correcta por otra razón

**Lo que se declaró en §36.1 (y en el comentario de `FeaturedCarousel.tsx`):** *«lo único que la rotación
escribe es `scrollLeft`; el tic no provoca ni un `setState`»*. **Es falso.** `moveTrack` y `handleScroll`
llaman a `measure()`, que escribe `canPrev` / `canNext` / `overflows`. Hay re-render en el primer tic
(se enciende «anterior») y en el último (se apaga «siguiente»), además del que cierra la pasada.

**R1 se cumple igual, pero por otra razón — y la otra razón es más fuerte.** El rol de teja se deriva del
**índice del array** (`i === 0` ⇒ teja líder, HD + `priority`) sobre una lista que la rotación **jamás
toca**, con `key` estable (`representativeInventoryItemId`). React reconcilia en sitio: mismo nodo, mismo
`src`, mismo `fetchpriority`, **haya los `setState` que haya**.

**Por qué el argumento viejo era peligroso, y no solo inexacto.** Hacía creer dos cosas falsas:

1. Que meter un `setState` en el camino del tic **rompería el LCP**. No lo rompe. Quien tenga que añadir
   estado ahí mañana se habría autoprohibido algo inocuo, o —peor— habría concluido que el argumento no
   se sostiene y que R1 tampoco.
2. Que el invariante **se sostiene sin el test**. Se sostiene **por** el test: `FeaturedCarouselRotation`
   compara la referencia del nodo líder, el orden de los ocho `alt` y el `src`/`fetchpriority` de la teja
   2 en los siete tics. Sin él, nada impide que alguien derive el rol de la posición de scroll.

Corregido en los dos sitios: el bloque R1 de la cabecera del componente, el comentario del temporizador
(`FeaturedCarousel.tsx`) y §36.1 de este archivo, que ahora remite aquí.

### 38.3 Tres huecos que sí eran cubribles (la lista de §36.6 era honesta pero incompleta)

1. **La llegada por ancla MID-VISIT.** El test que había ponía `location.hash` **antes de montar**, así
   que ejercitaba el `check()` del montaje y **el listener de `hashchange` no se ejecutaba nunca**. Pero
   el camino real de §22.4a es el otro: el usuario ya está en la home, vuelve de la nota al pie del gancho
   y el `hash` cambia **con el componente montado y rotando**. *El camino tapado era el secundario; el
   primario no tenía red.* Cubierto: se deja rotar un tic, se dispara `HashChangeEvent`, y se afirma
   pausa + anuncio + **que no se rebobina** (§23.5) ni se mueve después.
2. **La intervención dentro de los ~900 ms.** No es que no estuviera cubierta: estaba cubierta **al
   revés**. Ver §38.1.
3. **`onError` de la foto líder como desbloqueo.** `CardImage` llama a `settle()` también en `onError`
   («un 404 no puede dejar a nadie esperando»), pero que un fallo de la líder habilite la rotación **sin
   gastar los 3 s de `LEAD_IMAGE_CAP_MS`** no lo afirmaba nadie. Cubierto con un `fireEvent.error`: el
   reposo de 7 s arranca en el instante del error, no en el tope.

### 38.4 Los dos menores que el techlead señaló sin ficha

- **`onTogglePlayback` resolvía `'paused'` POR DESCARTE**, tras los `if` de `'playing'` y `'ended'`.
  Correcto hoy con una unión de tres y silenciosamente incorrecto con una de cuatro: un modo nuevo caería
  en REANUDAR sin que nada avise. Es **el patrón que este proyecto lleva todo el día cerrando**, así que
  se cierra igual: `switch` exhaustivo con candado `never` (`const unhandled: never = mode`). Un cuarto
  modo **no compila** hasta que alguien decida qué hace este botón con él.
- **`statusTextRef.current = {…}` era mutación de ref en FASE DE RENDER.** Idempotente y benigna hoy,
  pero es el patrón que muerde bajo StrictMode (doble render). Pasa a un `useEffect` sin deps —el mismo
  patrón que ya usaba `pauseRef`— declarado **antes** que el efecto del ancla, que es el único que puede
  leer esos textos en el primer commit.
- **De regalo, en el mismo sitio:** `settleTimersRef` era un `array` al que se hacía `push` en cada
  entrada del usuario y que solo se vaciaba al desmontar ⇒ crecía sin tope durante toda la visita (una
  rueda larga son decenas de entradas). Pasa a `Set` y cada temporizador **se borra a sí mismo** al
  cumplirse. No cambia ninguna conducta.

### 38.5 Deuda anotada, no arreglada

**FR-C1** en `docs/TECH_DEBT.md`: la ventana de 1200 ms de §23.5a se arma con `onWheel` **sin discriminar
eje** (medido: `dx=0 dy=250` la arma) y con `onFocus`. El riesgo va **en dirección contraria** a la que se
sospechaba: no es el falso negativo —un swipe emite muchos `scroll` y el primero llega en milisegundos—
sino el falso **positivo**: si en esos 1200 ms una imagen tardía provoca *scroll anchoring* (el escenario
que §23.5a describe, y lo que pasa en red lenta), el carrusel se pausa sin que nadie lo pidiera. No se
toca aquí porque **§23.5a es normativa**: el enunciado y el número viven en `DESIGN_SYSTEM.md` y su dueño
es ux-ui. Disparador: que QA o soporte vean el conmutador en REANUDAR sin intervención.

### 38.6 Verificación

- `npm run lint` ✔ **0 warnings, 0 errors** · `npm run typecheck` ✔ · `npm run test` ✔ **946/946 en 102
  archivos** · `npm run build` ✔.
- Base antes de este pase: **943/102** (§37.9). Delta **+3 tests** (`FeaturedCarouselRotation` 43 → 46),
  sin archivos nuevos. **Una prueba retirada: la falsa**, sustituida por dos que cubren las dos caras del
  bicondicional de §23.5a — el saldo neto de asertos sube, no baja.
- **E2E del carrusel, obligatorio porque cambió la conducta de las guardas:**
  `npx playwright test e2e/featured-rotation.spec.ts` ✔ **9/9** en Chromium (build de producción, modo
  mocks). Eran 8; el nuevo es la regresión de §23.5a en navegador. Nótese que el nº 1 («reposo inicial de
  7 s… sin auto-pausarse») **sigue verde sin la guarda (a)**: es la confirmación en vivo de que (b) sola
  aguanta el `scroll-snap` de la hidratación.
- **El candado muerde:** con (a) reintroducida a mano, **1 rojo y solo 1** — el test nuevo. Restaurado.
- Cero cambios de contrato, cero tokens nuevos, cero componentes nuevos. Escrituras: `frontend/`,
  este archivo y `docs/TECH_DEBT.md`. `backend/` intacto.

## §39 · Se retira el conmutador de reproducción del carrusel y la cadencia baja a 5 s (`DESIGN_SYSTEM.md` §23 rev.) — 2026-08-31, rama `claude/tcg-hunt-orchestrator-28p7z1`

> ⚠️ **DOS AFIRMACIONES DE ESTA SECCIÓN ERAN FALSAS Y ESTÁN CORREGIDAS EN §40** (hallazgos de QA y del
> techlead, cada uno por su lado): §39.6 decía «**ni uno solo cubría conducta que siga viva**» y «ahora
> muerde por los dos lados» sobre el test de la ventana de 1200 ms. Lo primero **no era cierto** (§40.2),
> lo segundo describía un candado **simbólico** (§40.1). El resto de §39 se sostiene. Se dejan las frases
> donde estaban, con su corrección al lado, en vez de reescribirlas: eran afirmaciones sobre el propio
> trabajo de quien las escribió, y borrarlas sería el mismo error otra vez.

Decisión del **dueño**, tomada tras ver P-49 publicado. No se re-discute aquí; se documenta y se
implementa.

### 39.1 Por qué se retira — la razón, no solo el cambio

El conmutador PAUSAR/REANUDAR/REPETIR se fundó en **WCAG 2.2.2** («Pausar, detener, ocultar»), que
exige un mecanismo para detener cualquier movimiento automático que dure más de 5 s. Ese fundamento es
correcto **como estándar** y sigue siéndolo. Lo que no es, es una **obligación legal** para esta tienda:

- **WCAG es una recomendación del W3C**, un consorcio industrial. No es ley en ninguna jurisdicción por
  sí misma; adquiere fuerza solo cuando una ley la incorpora por referencia.
- **En México**, las obligaciones de accesibilidad digital con dientes apuntan a **sitios de gobierno**
  y servicios públicos. Una tienda privada de cartas no cae bajo ellas.
- **La norma europea** que sí cubre comercio electrónico privado (la de accesibilidad de productos y
  servicios) solo aplicaría **si vendiéramos a Europa**. No es el caso.

El dueño decidió no adoptarlo. **Lo que se retira es el CONTROL MANUAL, no la protección**: los cinco
frenos automáticos siguen enteros (§39.3), y el que de verdad protege a una persona —
`prefers-reduced-motion`— no solo se queda, sino que ahora está probado en navegador real (§39.6).

Que quede escrito para quien lo lea en un año: **esto es una decisión de negocio sobre un estándar
voluntario, no un descuido ni una regresión de accesibilidad por ignorancia.** Si algún día se vende a
Europa, o si el criterio del dueño cambia, el control vuelve — y vuelve entero, porque el predicado que
lo gobernaba sigue vivo (§39.4).

### 39.2 Qué se fue, con archivo

| Qué | Dónde |
|---|---|
| Componente `PlaybackToggle` (46 líneas: iconos `Pause`/`Play`/`RotateCcw`, área táctil `::after`, `.eyebrow`) | `FeaturedCarousel.tsx` |
| `onTogglePlayback` con su `switch` exhaustivo y su candado `never` | `FeaturedCarousel.tsx` |
| `goToMode`, `playbackWord`, `playbackAria` | `FeaturedCarousel.tsx` |
| El paso del slot `titleAdjacent` a `Shelf` | `FeaturedCarousel.tsx` |
| El slot `titleAdjacent` **entero** (prop, tipo y rama de render) | `_shared/Shelf.tsx` |
| Claves `home.featured.playback.*` (6 por idioma) | `messages/es.json`, `messages/en.json` |
| Import `lucide-react` de los tres glifos | `FeaturedCarousel.tsx` |

**El slot se pudo borrar porque se verificó primero**: `titleAdjacent` no tenía más consumidor que el
carrusel (`grep` sobre `src/` y `e2e/`). El encabezado de §20.3 vuelve a su **fila de tres elementos**
(H2 · «Ver todo el catálogo» · flechas) y el H2 deja de vivir dentro de un `<div>` de agrupación.

### 39.3 Los cinco frenos automáticos: intactos, y ahora probados por movimiento

Ninguno se tocó. Lo que cambió es **cómo se prueban**: con el botón fuera, la única evidencia honesta de
que un freno funciona es que **la pista no se mueve**. Todas las aserciones que leían la etiqueta del
control ahora leen `scrollLeft` (helper `expectFrozen`, en los dos archivos de test). Es una aserción
**más fuerte**, no más débil: *el botón decía lo que el componente creía; el `scrollLeft` dice lo que el
componente hizo.*

1. **Hover** — `pointerInside`, suspensión silenciosa y reversible.
2. **Foco de teclado** — `focusInside`, sobre la sección entera.
3. **Intervención del usuario ⇒ PAUSA PERMANENTE** — §23.5a con su ventana de **1200 ms**, que **no se
   tocó** (es una medición de navegador, no una comodidad).
4. **Visibilidad** — `IntersectionObserver` (< 50 % visible) + `visibilitychange` (pestaña oculta).
5. **`prefers-reduced-motion` ⇒ CERO movimiento**, escuchado **en vivo**, enforzado en JS y no en
   `globals.css` (§8.2: la regla global solo anula duraciones de CSS, no un `setTimeout`).

### 39.4 El acoplamiento que había que desmontar sin romper — `rotationPossible`

`rotationPossible` era **el mismo booleano** que decidía dos cosas: si había rotación **y** si se pintaba
el conmutador («control y movimiento nacen del mismo booleano», §23.8). Retirado el control, la trampa
evidente era borrarlo «porque ya no hay botón que pintar». **No se borró**: sigue siendo la única puerta
de `timerRunning`, y con él siguen vivos los cuatro apagados que gobierna — movimiento reducido, pista
que no desborda, una sola teja, y consulta en carga o en error. Está anotado en el propio código con la
advertencia explícita.

**Ramas muertas retiradas** (el otro encargo del pase):

- **El `never`.** El candado de exhaustividad vivía dentro de `onTogglePlayback`; se fue con él. No
  quedó ningún `never` discriminando una unión que ya nadie conmuta.
- **La transición `ended` → `paused`** de `pauseByIntervention`. La pedía §23.6 **por el conmutador**
  (para que el botón pasara de REPETIR a REANUDAR). Sin control, no tiene **un solo efecto observable**:
  los dos modos dejan el temporizador parado y la pista en `aria-live="polite"`. La guarda se colapsa a
  `if (modeRef.current !== 'playing') return;` y `paused`/`ended` quedan **ambos terminales**.
- **`PlaybackMode` se conserva con sus tres modos**, y no por inercia: distinguen el anuncio del canal de
  estado («rotación pausada» vs «fin de las piezas destacadas», §23.9c). Colapsarlos a un booleano
  `rotando/no rotando` haría indistinguibles esos dos anuncios.

### 39.5 Cadencia 7 s → 5 s

`ROTATION_REST_MS` 7000 → **5000**. Los 7 s se eligieron para quedar **por encima** del umbral de 5 s de
WCAG 2.2.2 y sostener el argumento del control; retirado el control, la cadencia deja de estar atada a
ese umbral. **Lo demás del tic no cambia**: una teja por tic, deslizamiento de ~0,5 s, no arranca hasta
que cargaron las fotos, reposo antes del primer movimiento, **una sola pasada y se detiene**. Al terminar
queda quieta —ya no hay control que ofrezca REPETIR— y las flechas siguen navegando a mano.

### 39.6 Tests: adaptados, no borrados — y el saldo real

**Se retiraron 9 unitarios y 1 E2E**, todos los que probaban **exclusivamente el control**: área táctil
44×44 por pseudo-elemento, orden de tabulación (primer control del estante), «nunca `disabled` ni
`loading`», el ciclo PAUSAR ⟷ REANUDAR, REPETIR, «el conmutador no emite por el canal de estado», su
sitio pegado al H2, su nombre accesible WCAG 2.5.3, y el presupuesto de la fila en 390/640/1024. ~~**Ni uno
solo cubría conducta que siga viva.**~~

> ⚠️ **FALSO, y corregido en §40.2 y §40.3.** QA lo midió a los dos lados del diff y tenía razón por
> partida doble: **(1)** los tres casos de §23.4d se reescribieron de «no se pinta el botón» a «la pista
> no se mueve» y **perdieron poder discriminante** (en jsdom la pista tampoco se mueve cuando el guard no
> existe); **(2)** de los diez casos retirados, uno tenía **enunciado hermano vivo** —la guarda de
> `pauseByIntervention` que impide un segundo anuncio tras el fin— y quedó **descubierto**. Los dos
> huecos están cerrados en §40 con mutación que los pone en rojo.

**Todo lo demás se adaptó.** Los dos que más importaba que sobrevivieran lo hicieron, y con la aserción
correcta:

- **«Reposo inicial sin auto-pausarse»** (E2E). Prueba que el `scroll-snap` que Chromium aplica al
  hidratar **no se lee como intervención**. Antes se leía en la etiqueta («sigue diciendo PAUSAR»); ahora
  se lee donde está la respuesta de verdad: **la pista se mueve**.
- **La regresión de §23.5a** (unit + E2E). El gesto real que cae dentro del deslizamiento de un tic tiene
  antecedente de usuario ⇒ pausa, y no se reanuda sola. Aserción reescrita sobre `scrollLeft`.

**Se añadieron 3 casos**, dos de ellos porque el pase destapó agujeros reales:

- `§20.3 · el encabezado vuelve a su fila de tres elementos` (2 unitarios): el H2 va suelto, y los únicos
  botones del estante son las dos flechas.
- **`§23.5 · la pista fuera de vista suspende` (E2E, NUEVO).** El freno de `IntersectionObserver`
  **no tenía ninguna red**: jsdom no lo implementa, así que una mutación que borre `inView` de
  `suspended` pasaba **los 39 unitarios en verde**. Se aparta la vista con `window.scrollTo` y nunca
  tocando la pista — un gesto sobre la pista sería intervención (§23.5 nivel 2) y el test pasaría por el
  motivo equivocado.
- **`la ventana de §23.5a dura de verdad: a 1199 ms el gesto TODAVÍA cuenta` (unit, NUEVO).** La ventana
  estaba pinneada solo por el lado de FUERA (a 1201 ms ya caducó); por dentro no, y `USER_INPUT_WINDOW_MS
  = 0` pasaba en verde. ~~Ahora muerde por los dos lados.~~ El número es una medición de navegador y
  acortarlo se lleva por delante la pausa por swipe en táctil (§23.13 nº9).

  > ⚠️ **«Muerde por los dos lados» era falso, y el título del test afirmaba más de lo que el test
  > hacía** (hallazgo del techlead). El caso calculaba sus tiempos con `USER_INPUT_WINDOW_MS - 1`, así
  > que **se movía con la constante**: lo que pinneaba era la **forma del predicado**, no el número.
  > Demostrado con `USER_INPUT_WINDOW_MS = 300` ⇒ **40/40 en verde**. Mata `= 0` (ahí la resta da −1 y
  > no hay ventana), y nada más. Corregido en §40.1: los dos bordes pasan a **1199/1201 literales** y se
  > añade el `expect(USER_INPUT_WINDOW_MS).toBe(1200)` que fija el número.

### 39.7 Verificación — se probó, no se asumió

- `npm run lint` ✔ **0 warnings, 0 errors** · `npm run typecheck` ✔ · `npm run test` ✔ **940/940 en 102
  archivos** · `npm run build` ✔.
- Base antes del pase: **946/102**. Delta **−6** (`FeaturedCarouselRotation` 46 → 40: −9 retirados del
  conmutador, +3 nuevos). Sin archivos nuevos ni borrados.
- **E2E del carrusel** (obligatorio: cambia conducta de rotación):
  `npx playwright test e2e/featured-rotation.spec.ts` ✔ **9/9** en Chromium, build de producción, modo
  mocks. Eran 9: se retiró el del presupuesto del conmutador y entró el de visibilidad.
- **Pasada completa medida**: **15,3 s** de punta a punta en el viewport por defecto (menos tejas fuera
  de pantalla ⇒ menos tics que en 390px). El presupuesto del test bajó de `180 s` a `120 s` y la espera
  del fin de `120 s` a `80 s`.

**Los cinco frenos, verificados por MUTACIÓN — no por lectura del código.** Se rompió cada uno a mano y
se comprobó que la suite se pone roja:

| Freno | Mutación | Resultado |
|---|---|---|
| 1 · hover | quitar `pointerInside` de `suspended` | **3 unitarios rojos** |
| 2 · foco | quitar `focusInside` | **1 unitario rojo** |
| 3 · intervención | anular la llamada a `pauseByIntervention()` en `handleScroll` | **4 unitarios rojos** |
| 3b · ventana 1200 ms | `USER_INPUT_WINDOW_MS = 0` | **1 unitario rojo** (el nuevo) |
| 4a · pestaña oculta | quitar `!tabVisible` | **1 unitario rojo** |
| 4b · fuera de vista | quitar `!inView` | **E2E rojo** — la pista siguió rotando fuera de pantalla (`460 → 960`). En unitarios **no lo detecta nadie** (jsdom no tiene `IntersectionObserver`): por eso existe el caso E2E nuevo |
| 5 · `prefers-reduced-motion` | quitar `!reducedMotion` de `rotationPossible` | **3 unitarios rojos + 2 E2E rojos** en Chromium con `emulateMedia({ reducedMotion: 'reduce' })` — movimiento real, preferencia real |
| extra · `rotationPossible` | `= true` | **3 unitarios rojos** |

La fuente quedó **byte a byte idéntica** al commit tras cada mutación (`git diff --stat` vacío).

### 39.8 Nota sobre deuda ya registrada

**FR-C1** (`docs/TECH_DEBT.md`, anotada en §38.5) sigue vigente en su sustancia —la ventana de 1200 ms se
arma con `onWheel` sin discriminar eje— pero **su disparador quedó obsoleto**: decía «que QA o soporte
vean el conmutador en REANUDAR sin intervención», y ya no hay conmutador que mirar. El síntoma
observable ahora es **que la pista deje de rotar sola antes de terminar su pasada**. No se edita
`TECH_DEBT.md` aquí porque ese archivo se escribe **a petición del techlead**; queda señalado para él.

### 39.9 Alcance

Cero cambios de contrato, cero endpoints nuevos, cero tokens nuevos, cero componentes nuevos.
Escrituras: `frontend/` y este archivo. `backend/` intacto. **`docs/DESIGN_SYSTEM.md` NO se tocó**: §23
es de ux-ui, que documenta esta misma decisión en paralelo.

---

## §40 · Los candados que faltaban: la petición del dueño no la protegía nada, y una frase mía sobre mi propio trabajo era falsa — 2026-08-31, rama `claude/tcg-hunt-orchestrator-28p7z1`

Tanda de cierre del stream. QA y techlead aprobaron §39, cada uno con condiciones, y **los dos
encontraron por separado el mismo agujero**. Esta sección no rehace §39: le pone la red que le faltaba y
corrige lo que afirmaba de más.

La lección de fondo, que vale más que los tests: **un test que deriva sus tiempos de la constante que
dice proteger no protege la constante — se mueve con ella.** Pinnea la *forma* del predicado, no el
*número*. Y como los números de §23 son mediciones de navegador y decisiones del dueño, ahí es donde
había que morder.

### 40.1 Los tres números medidos, clavados con literales

**El problema, medido por QA:** `ROTATION_REST_MS = 5000 → 7000` dejaba **940/940 unitarios y 9/9 E2E en
verde**. Los unitarios importan la constante y calculan sus esperas con ella; el E2E la **duplicaba a
mano** (`const REST_MS = 5000`, con un comentario —«debe seguir a `ROTATION_REST_MS`»— que nada
enforzaba) y su único aserto temporal, `waitForTimeout(REST_MS - 2000)` + `waitForFunction` con 15 s de
margen, pasa igual con 7 s reales.

Dicho sin adornos: **la petición explícita del dueño era lo único de §39 sin red de regresión.** El
techlead extendió el hallazgo a `USER_INPUT_WINDOW_MS = 1200` y `LEAD_IMAGE_CAP_MS = 3000`, y demostró
que el test «pinneada por ambos lados» de §39.6 era **simbólico**: con `USER_INPUT_WINDOW_MS = 300` la
suite quedaba 40/40 en verde.

**Lo que se hizo,** siguiendo la dirección del techlead (`expect(CONSTANTE).toBe(n)` con el porqué al
lado, o literales absolutos en los tests de borde) — se hicieron **las dos**:

| Candado | Dónde | Qué mata |
|---|---|---|
| `expect(ROTATION_REST_MS).toBe(5000)` | `FeaturedCarouselRotation.test.tsx`, describe propio | cualquier cambio de cadencia |
| `expect(USER_INPUT_WINDOW_MS).toBe(1200)` | ídem | cualquier cambio de la ventana de §23.5a |
| `expect(LEAD_IMAGE_CAP_MS).toBe(3000)` | ídem | cualquier cambio del tope de la precondición 3 |
| bordes **1199 / 1201 literales** (antes `USER_INPUT_WINDOW_MS ± 1`) | los dos casos de la ventana | que se acorte **o** se alargue, con conducta y no solo con un número |
| `expect(constantInSource('ROTATION_REST_MS')).toBe(REST_MS)` + `expect(REST_MS).toBe(5000)` | `e2e/featured-rotation.spec.ts`, test propio | que las dos copias diverjan **y** que la cadencia cambie |

El describe de los tres `toBe` lleva escrito el porqué, y es el que importa: *esto es una medición o una
decisión del dueño; si se pone rojo, la respuesta no es actualizar el literal, es traer la decisión y
actualizar `DESIGN_SYSTEM.md` §23 y este archivo en el mismo commit.*

**Sobre el E2E: no se importa el componente.** `FeaturedCarousel.tsx` es `'use client'` y arrastra React,
`next-intl` y `@tanstack/react-query` al proceso de Playwright. Se **lee el fuente** y se compara con una
expresión regular acotada (`export const NOMBRE = <número>;`), que falla ruidosamente si el fuente cambia
de forma. Detalle que costó una corrida: **`__dirname`, no `import.meta.url`** — Playwright transpila los
specs a CJS y basta un `import.meta` en el archivo para que lo trate como ESM y reviente el `require` de
los demás imports (`ReferenceError: require is not defined in ES module scope`). Queda anotado en el
propio spec.

También se corrigió el **título** del test de la ventana (afirmaba más de lo que hacía) y el enunciado de
§39.6 que lo repetía.

### 40.2 Sí se había perdido cobertura de conducta viva, y §39 lo afirmaba al revés

**El hallazgo de QA, verificado a los dos lados del diff:**

| Mutación | `origin/main` (aserción = «no se pinta el botón») | `HEAD` de §39 (aserción = «la pista no se mueve») |
|---|---|---|
| quitar `overflows` de `rotationPossible` | **2 unitarios rojos** | **40/40 verdes** |
| `featured.length > 1` → `> 0` | **2 unitarios rojos** | **40/40 verdes** |

**La causa, y es sutil:** en jsdom, con geometría degenerada, `nextScrollTarget()` devuelve `null` y la
pista **no se mueve aunque el guard no exista**. Los tres casos de §23.4d se reescribieron de «no se
pinta el botón» a «la pista no se mueve», y **dos pasaban por el motivo equivocado**.

**El defecto sí es observable en navegador real**, y ahí está la aserción que faltaba: sin `overflows`,
una pista que no desborda entra en `mode='ended'` en el primer tic y **anuncia «Fin de las piezas
destacadas.»** por el `role="status"` sobre algo que nunca se movió. Eso rompe §23.9(c) en el canal que
ux-ui acaba de subir a obligatorio.

**Cierre:** cada caso de §23.4d exige ahora **las dos cosas** — pista quieta **y canal de estado mudo**.
La segunda es la que discrimina: distingue «el guard apagó el temporizador» de «el temporizador corrió y
descubrió que no había a dónde ir». Y el caso de **una sola teja** (§40.4) recibe layout que **sí**
desborda, para que aísle la causa que su nombre promete.

**La frase falsa se corrigió donde estaba, en los dos sitios durables:** la cabecera de
`FeaturedCarouselRotation.test.tsx` (líneas 20-21) y §39.6 de este archivo. En los dos se deja el
enunciado original visible con su corrección al lado. Es el patrón que este proyecto lleva todo el día
cerrando —una afirmación que no se sostiene, escrita en un documento que la gente cree—, esta vez en una
afirmación de este frontend sobre su propio trabajo. Se anota así a propósito.

### 40.3 La guarda que protege el canal de estado: no era vía muerta, y no tenía prueba

`FeaturedCarousel.tsx` · `pauseByIntervention`. El colapso a `if (modeRef.current !== 'playing') return;`
es **correcto** (el techlead lo confirmó), pero el comentario lo describía como rama muerta y eso
**subestimaba lo que hace hoy**: borrarla emite `setStatusMessage('Rotación automática pausada.')`
**después** de «Fin de las piezas destacadas.» ⇒ **dos anuncios en la misma visita**, y §23.9(c) permite
**como mucho uno**.

Tres caminos reales lo disparan, y los tres llaman a `pauseByIntervention` **incondicionalmente**:

1. la flecha «anterior» tras el fin (`goByArrow` no mira el modo),
2. un swipe sobre la pista tras el fin (`handleScroll`),
3. el regreso por ancla de §22.4a vía `hashchange`.

**Y la mutación pasaba en verde**: ningún test intervenía después de `ended` y leía la línea de estado.
Era el único de los diez casos retirados con el conmutador cuyo **enunciado hermano sigue vivo**.

Cerrado con un caso que ejercita **dos** de los tres caminos (flecha y swipe, ambos tras la pasada
completa) y exige que el canal siga diciendo «Fin de las piezas destacadas.». El comentario del código se
reescribió para decir qué protege de verdad, con la lista de llamadores.

### 40.4 «Una sola teja ⇒ no rota» ahora aísla su causa

El caso no llamaba a `applyFakeLayout` ni disparaba `resize`, así que `overflows` era `false` y la pista
estaba quieta **por desbordamiento, no por longitud**: el `describe` decía «estos casos son los que lo
fijan» y éste no fijaba lo que nombra.

Se le inyecta a propósito una pista **que sí desborda con una sola teja** (`clientWidth 200 /
scrollWidth 1000` — una teja más ancha que el viewport). Es geometría sintética y **declarada**, como
todo el layout de ese archivo, pero deja `overflows === true`, con lo que el único predicado que puede
apagar la rotación es `featured.length > 1`. Con la mutación `> 0` el temporizador arranca, el tic no
encuentra teja siguiente (`offsets === [0]`) y **anuncia el fin**: rojo. Se cubrió, no se aceptó como
incubrible.

### 40.5 Frases falsas en documentos vivos, corregidas

| Dónde | Decía | Dice |
|---|---|---|
| `TECH_DEBT.md` **FR-C1**, premisa | «WCAG 2.2.2 sigue cumplido por el conmutador, que es visible y opera» | Falso desde `bb3fb2c`. Premisa nueva remitiendo a `DESIGN_SYSTEM.md` **§23.4.0**, que deja escrito que **no** se cumple y por qué se acepta |
| `TECH_DEBT.md` **FR-C1**, disparador | «que QA o soporte vean el conmutador en REANUDAR sin intervención» | «que **la pista deje de rotar sola antes de terminar su pasada**» — observable sin conmutador |
| `TECH_DEBT.md` **FR-C1**, severidad | Media-baja | **Media**. No cambió el síntoma: **se fue el remedio** (§40.6) |
| `FeaturedCarousel.tsx:45` y `:175` | «ver `FRONTEND_NOTES.md` §36» para la decisión del dueño | **§39**. §36 es el pase que **construyó** el conmutador; quien seguía el puntero aterrizaba en `PlaybackToggle`, `titleAdjacent` y «las 10 claves de §23.12», todo falso |
| `FRONTEND_NOTES.md` §36 | sin rótulo | **Banner de superado**, con qué sigue vigente y qué no (mismo patrón que el rótulo de §38 dentro de §36) |
| `FeaturedCarouselRotation.test.tsx:716` | «una descarga cada **7 s**» | «cada **5 s**, §34.1» |
| `e2e/featured-rotation.spec.ts` | «~28 s» la pasada completa | **15,3 s medidos** (QA midió ~14 s netos). El «~28 s» era cuenta de servilleta sobre 390 px |
| `FeaturedCarouselRotation.test.tsx` | «los **38** casos restantes» | 39 — costura del reaplicado tras el reset del árbol; el texto se reescribió entero |

### 40.6 FR-C1: no cambió el síntoma, se fue el remedio

Es lo más importante de esa ficha y merece decirse aparte, porque lo señaló QA y no estaba escrito en
ningún sitio. FR-C1 describe un **falso positivo**: una rueda **vertical pura** sobre la pista, o un
*scroll anchoring* provocado por una imagen tardía, arma la ventana de 1200 ms y **pausa la rotación
permanentemente sin que nadie lo haya pedido**.

Cuando esa deuda se aceptó como Media-baja, el usuario al que le ocurría **tenía salida: pulsar
REANUDAR**. Hoy **no hay ninguna recuperación en toda la visita**: `paused` es terminal, no hay control,
y ni el hover, ni el foco, ni volver a la pestaña devuelven la rotación. El defecto pasó de «molesto y
reversible por el usuario» a «la función queda muerta hasta la siguiente carga de página».

**La severidad registrada ya no describía el riesgo**, y por eso sube a Media. Sigue no bloqueante por
una razón concreta y no por inercia: **no se ha reproducido ni una vez** (53 eventos `scroll` / 0 con
antecedente en la medición de la pasada completa), y esa corrida no tenía red lenta. Las salidas siguen
siendo de **ux-ui** porque tocan §23.5a; ninguna se implementa aquí.

### 40.7 Deuda anotada

- **FR-C2** (`TECH_DEBT.md`, NUEVA) — **el freno por visibilidad tiene un único punto de cobertura en
  todo el proyecto**, y es un E2E. Aviso de QA. `IntersectionObserver` no existe en jsdom, así que
  borrar `inView` de `suspended` pasa **los 44 unitarios en verde**; toda la red es el caso
  `§23.5 · la pista fuera de vista suspende` de `e2e/featured-rotation.spec.ts`. Si alguna vez se compone
  un gate solo con la suite unitaria, ese freno queda a ciegas. Dueño **frontend** (el test) + **devops**
  (la composición del gate).
- **No se abrieron FR-C3 ni FR-C4**: se cerraron en código. Las constantes medidas quedan las tres con
  candado (§40.1), §23.9(c) «un solo mensaje por visita» tiene test (§40.3) y el caso de una sola teja
  aísla su causa (§40.4). Anotar como deuda algo que cabía en el pase habría sido moverlo de sitio, no
  resolverlo.

### 40.8 Verificación — mutación, no lectura

- `npm run lint` ✔ **0 warnings, 0 errors** · `npm run typecheck` ✔ · `npm run test` ✔ **944/944 en 102
  archivos** · `npm run build` ✔.
- Delta de casos: **+4** (`FeaturedCarouselRotation` 40 → 44: 3 candados de constante + 1 del canal de
  estado). Sin archivos nuevos ni borrados.
- **E2E del carrusel** ✔ **10/10** en Chromium, build de producción, modo mocks (eran 9; entra el candado
  de cadencia).
- **Pasada completa: 15,3 s** en el viewport por defecto, sin cambio respecto a §39 (no se tocó conducta).

**Cada candado, verificado rompiéndolo** — la fuente del componente quedó **byte a byte idéntica** tras
cada mutación (`git status` limpio):

| Mutación | Resultado |
|---|---|
| `ROTATION_REST_MS = 7000` | **1 unitario rojo** (`ROTATION_REST_MS = 5000 …`) **+ 1 E2E rojo** (`la cadencia de este archivo es la MISMA …`, `Expected 5000 / Received 7000`) |
| `USER_INPUT_WINDOW_MS = 300` | **2 unitarios rojos** (el candado + el borde de 1199 ms) |
| `USER_INPUT_WINDOW_MS = 5000` | **2 unitarios rojos** (el candado + el borde de 1201 ms) |
| `LEAD_IMAGE_CAP_MS = 1000` | **1 unitario rojo** |
| quitar `overflows` de `rotationPossible` | **1 unitario rojo** — `pista que no desborda ⇒ ni se mueve NI anuncia el fin`. Antes de §40: **0** |
| `featured.length > 1` → `> 0` | **1 unitario rojo** — `una sola teja ⇒ … es la LONGITUD lo que lo impide`. Antes de §40: **0** |
| quitar `if (modeRef.current !== 'playing') return;` | **1 unitario rojo** — `tras el fin, una intervención NO añade un segundo anuncio`. Antes de §40: **0** |

**Respuesta directa a la pregunta del cierre: sí.** Revertir `ROTATION_REST_MS` a 7000 pone **dos** cosas
en rojo, una en cada suite, y las dos nombran el número en su enunciado. Probado, no asumido.

### 40.9 Alcance

Cero cambios de contrato, cero endpoints nuevos, cero tokens nuevos, cero componentes nuevos, **cero
cambios de conducta** (la única línea de producto tocada es un comentario). Escrituras: `frontend/`,
este archivo y `docs/TECH_DEBT.md` (a petición explícita del techlead, que es su dueño de petición).
`backend/` intacto. **`docs/DESIGN_SYSTEM.md` NO se tocó**: §23 es de ux-ui, que trabajaba en él en
paralelo durante este pase.

---

## §41 · Copy del home reescrito con la voz de marca HUNT — solo cadenas, cero render (2026-09-01, rama `claude/ecommerce-home-copy-optimization-dd3d2w`)

Pase **exclusivamente de copy**. No se tocó ni un componente, estilo, ruta, hook ni llamada a la API: el
árbol que pinta el home es **byte a byte el mismo** que antes del pase. Lo único que cambia es el **valor**
de un conjunto de claves i18n del bloque `home.*` y de `common.tagline`, en ES y EN.

### 41.1 Qué se buscaba

El home hablaba como un catálogo genérico («Compra cartas Pokémon con precio real…», «Ver el catálogo»,
«Sets buscados»). La marca es **TCG HUNT**, y el léxico de caza (cazar/cacería/bounty) ya vivía en el
producto solo a medias: «Top Bounties» estaba, pero el resto del home no lo acompañaba. Este pase alinea el
copy con esa voz **sin romper la sobriedad editorial del sistema de diseño** (§1: claro, directo,
tranquilizador; nada infantil; sin emojis; sin signos de admiración).

Decisión del humano, no del frontend. Aquí solo queda registrada la implementación.

### 41.2 Regla que gobernó el pase: se cambian VALORES, nunca el juego de claves

`src/lib/i18n-parity.test.ts` exige que ES y EN tengan **el mismo conjunto de rutas de clave**. Añadir o
borrar una clave en un solo idioma es un rojo inmediato, y borrarla en los dos rompe en silencio a
cualquier consumidor. Por eso el pase se aplicó con un editor **consciente de la ruta** que reescribe solo
la porción de valor de las líneas objetivo y luego **verifica estructuralmente** que:

- la lista de rutas de clave (y su orden) es idéntica antes y después, y
- el conjunto de valores que difieren es **exactamente** el conjunto pedido — ni uno más.

Se conservan intactas las **claves muertas** del bloque (`home.ctaBuylist`, `home.trustAuth`,
`home.trustPrice`, `home.vaultLabel`, `home.featuredSet.*`). Están sin consumidor hoy, pero borrarlas es
un cambio de superficie i18n que no le toca a un pase de copy; si deben morir, es una limpieza aparte y
deliberada, con la paridad ES/EN movida a la vez.

### 41.3 Qué NO se tocó, y por qué

Copy **legal** o **fuente de verdad**, deliberadamente fuera del alcance:

| Clave(s) | Razón |
|---|---|
| `catalog.gradingNote.*`, `catalog.gradingBadge.*` | Deslinde legal del gancho de grading. |
| `home.gradingGems.kicker` (`ILUSTRATIVO · NO EVALUAMOS LA PIEZA`) | Deslinde legal (§22.6). Reescribirlo por «tono» es publicar otra afirmación jurídica. |
| `common.brand.*` (`TCG HUNT`, `tcghunt.mx`) | Fuente de verdad de la marca (§28), con candado propio en `brand.test.ts` y en la paridad. |
| `nav.*`, pie, `stock.*`, `price.pending*`, `finish.*`, aria-labels de control, estados del carrusel | Fuera del home o portadores de estado/accesibilidad, no de marketing. |

`home.gradingGems.lead` **sí** se reescribió: es la frase descriptiva de la vitrina, no el descargo. El
descargo es el `kicker`, y sigue palabra por palabra como estaba.

### 41.4 El efecto colateral que este pase sí tenía: `home.featuredTitle` es también un `aria-label`

`featuredTitle` no es solo el H2 de la vitrina. `FeaturedCarousel.tsx` lo usa además como
**`ariaLabel` de la región** del carrusel (`ariaLabel={t('featuredTitle')}`). Cambiar el título de «Piezas
destacadas del catálogo» a «Piezas destacadas» mueve, por tanto, **el nombre accesible de la región**, y
con él dos candados de `FeaturedCarouselRotation.test.tsx` que lo fijan en duro:

- `getByRole('region', { name: … })` (ES) y su gemelo en EN,
- la aserción de §23.9 `expect(section).toHaveAttribute('aria-label', …)`.

Se actualizaron los tres literales. `aria-roledescription` sigue siendo `carrusel`/`carousel`.

**Corrección (hallazgo bloqueante del techlead, cerrado en este mismo pase).** La primera redacción de
esta sección afirmaba que la aserción
`expect(section.getAttribute('aria-label')).not.toMatch(/rotaci|carrus|grad?|PSA/i)` «sigue viva y verde»
y que «cambió la cadena esperada, no la norma verificada». **Para tres de los cuatro brazos era cierto;
para el cuarto era falso.** La `e` de `grade` era el **homoglifo cirílico U+0435 CYRILLIC SMALL LETTER
IE**, no la `e` ASCII: ese brazo exigía la secuencia `grad` + U+0435, que **ningún copy latino puede
producir jamás**. El guard contra «gradeadas/graded» en el nombre accesible de la región llevaba tiempo
sin poder fallar, y como los otros tres brazos sí funcionaban, el test estaba verde y el lint callado.

El homoglifo **es preexistente: venía de `main`, no lo introdujo este pase** (verificado con
`git show HEAD~1`). Lo que sí introdujo este pase fue *escribir en el registro durable que la aserción
verificaba algo que no verificaba*, que es la parte que de verdad hacía daño: una nota que certifica una
cobertura inexistente es peor que no tener nota.

Arreglado aquí: `e` ASCII restaurada, la regex extraída a la constante compartida
`NOMBRE_ACCESIBLE_PROHIBIDO`, y **un caso de control que la prueba en positivo** (`it.each` con
`'Cartas gradeadas'`, `'… rotación automática'`, `'Carrusel de destacadas'`, `'Gradeadas PSA'`: una
cadena por brazo). El control **reusa el mismo objeto regex** a propósito — duplicar el literal habría
reproducido el defecto en vez de cazarlo.

**Verificado rompiéndolo:** reintroducir el homoglifo pone en rojo el control con el mensaje
`AssertionError: expected 'Cartas gradeadas' to match /rotaci|carrus|grad<U+0435>|PSA/i`. Antes de este
pase, esa misma mutación daba **verde**.

**Lección, y es la que importa:** una aserción **negativa** (`not.toMatch`, `not.toContain`,
`toEqual([])`) no demuestra nada por sí sola — pasa igual si el sujeto está limpio que si el candado está
roto. Toda aserción negativa que proteja algo real necesita un control que la dispare. En este archivo
ahora lo tiene; en el resto del repo, no necesariamente.

**Barrido asociado:** escaneado todo `frontend/` (`.ts`, `.tsx`, `.json`, `.css`) en busca de cirílico y
griego disfrazados de latín. Único cirílico era este; las 11 coincidencias restantes son `Σ` (GREEK
CAPITAL LETTER SIGMA) usada legítimamente como notación de sumatoria en comentarios de `contract.ts`,
`fixtures.ts` y `MasterSet.test.tsx`. **Ningún otro homoglifo vivo en el frontend.**

**Alcance del brazo: `grad`, y cubre la familia completa. Sin residuo pendiente.** La restauración
literal del homoglifo dejaba el brazo como `grade`, que caza «gradeadas» y «graded» pero **no «grading»**
ni «grados» — justo las formas que usaría un copy nuevo. Lo dejé señalado sin ampliarlo, porque ensanchar
un candado es un cambio de **norma** y no una corrección de dedazo. **El techlead resolvió ampliarlo**, y
el argumento cierra el asunto: la norma ya estaba escrita **antes** que la regex —la primera línea del
comentario del bloque dice que el nombre accesible no habla «ni de grading», y §22.6b-e es sobre el gancho
de grading entero—, así que el brazo siempre estuvo escrito para la **familia**; el homoglifo solo tapó
que no la cubría.

**Norma vigente:** `NOMBRE_ACCESIBLE_PROHIBIDO` cubre
`grade` · `graded` · `grading` · `gradeadas` · `gradeo` · `grados`. Riesgo de falso positivo **benigno,
no nulo** (corrección del techlead: «nulo» estaba sobrevendido). `upgrade` y `gradual` contienen `grad`,
y «Upgrade your collection» es inglés de marketing perfectamente plausible en un H2. Lo que hace el
residuo inofensivo no es que la cadena no exista, es que **`DESIGN_SYSTEM.md` §1 (v2.9) ya veta la voz de
marca en mensajes de accesibilidad**: cualquier cadena capaz de disparar el brazo está prohibida en ese
hueco por otra vía. Sobre los cuatro valores reales de hoy (`Piezas destacadas`, `Destacadas`,
`Featured pieces`, `Featured`) no casa ninguno.

**El control se amplió con la norma, y ahí hubo una trampa que casi cuela.** Añadir casos que la regex
nueva acepta no prueba nada si la **vieja** también los aceptaba: serían decorativos, el mismo defecto
que este apartado existe para matar. Los dos casos nuevos están elegidos para **discriminar**:

| Caso de control | `/grad/` | `/grade/` | ¿Discrimina? |
|---|---|---|---|
| `Gancho de grading` | ✔ | ✘ | **sí** |
| `Grados y certificados` | ✔ | ✘ | **sí** |
| ~~`Gradeo de piezas`~~ | ✔ | ✔ | **no — descartado** |

El primer candidato para el segundo hueco fue «Gradeo de piezas», y **es inservible**: «grade**o**»
contiene `grade` como subcadena, así que pasa igual con el brazo estrecho.

**T1 (techlead) — el mismo error, en la dirección contraria, y se me coló.** Al escribir ese criterio
anoté «no colar `PSA` en la cadena del brazo de grading»… y dejé en la lista `'Gradeadas PSA'` como
control del brazo `PSA`. Contiene `grad`: **casa por el brazo de grading y nunca llega a probar `PSA`**.
Consecuencia medida: se podía **borrar el brazo `PSA` entero, o meterle una `А` cirílica U+0410, y los
seis controles seguían verdes**. Era el agujero que este apartado existe para cerrar, reintroducido al
cerrarlo. Y arrastraba dos afirmaciones falsas: el comentario del `it.each` decía «cada cadena existe para
disparar UN brazo» y esta nota decía «una cadena por brazo» — para `PSA`, ninguna de las dos era cierta.
Sustituido por `'Certificadas PSA'` (casa `PSA` y ningún otro brazo).

**Lo que cambió de fondo, y es la lección del hallazgo.** Dos veces seguidas el criterio correcto estaba
**escrito en un comentario** y aun así se violó al aplicarlo. Un comentario no verifica nada. Así que el
criterio pasó a ser **código**:

- Los brazos se declaran sueltos (`BRAZOS_PROHIBIDOS = ['rotaci', 'carrus', 'grad', 'PSA']`) y la regex se
  **compone** de ellos. Con la regex como literal opaco, «qué brazo prueba esta cadena» no es una pregunta
  que un test pueda hacer — y por eso el agujero era invisible.
- Cada control es un par `[cadena, brazo]`, y el test exige que la cadena case con **su** brazo y con
  **ninguno de los otros**. Esa es la regla general que pediste, ejecutable en vez de comentada.
- Un test de **cobertura** exige que todo brazo tenga al menos un control. Añadir un brazo sin su cadena
  ahora es rojo, no un descuido silencioso.

**Verificado rompiéndolo, cuatro mutaciones:**

| Mutación | Resultado |
|---|---|
| estrechar `grad` → `grade` | **3 rojos** — `Gancho de grading`, `Grados y certificados` y `Cartas gradeadas` (este último por casar con un brazo ajeno) |
| homoglifo U+0435 en `grad` | **3 rojos** — los tres controles del brazo de grading |
| **borrar el brazo `PSA`** | **2 rojos** — `Certificadas PSA` **+ el test de cobertura**, que nombra el brazo que falta |
| **`PSA` → `PАS` (А cirílica U+0410)** | **1 rojo** — `Certificadas PSA` |

Antes de T1, las dos últimas filas daban **verde**. El candado ya no solo detecta que alguien lo mate o lo
estreche: detecta que alguien lo **vacíe por un brazo**.

Vale la pena dejarlo escrito porque es la trampa del pase: «solo cambio textos» dejó de ser cierto en el
momento en que un texto de marketing es a la vez el nombre accesible de un `role="region"`. Un cambio de
copy en `featuredTitle` es siempre también un cambio de accesibilidad, y quien lo toque después debe
mirar `FeaturedCarousel.tsx:600` antes de asumir que no.

### 41.5 Tests de render que fijaban copy en duro

`page.test.tsx` fija literales en español para comprobar que el home pinta lo que debe. Se actualizaron
**ocho** (no los seis previstos: el brief no contaba `quoter.empty` ni `quoter.continue`, que también
cambiaron de valor): `heroTitle`, `ctaShop`, `quoter.title`, `quoter.empty`, `setsWanted`,
`featuredTitle`, `sellCta`, `quoter.continue`.

Los **E2E de Playwright no se tocaron y no rompen**: leen las claves con el helper `t(locale, 'home.…')`
en vez de teclear la frase, así que siguen a la traducción sola. Es la razón por la que ese helper existe,
y este pase es su primera cobranza real.

### 41.6 Comentarios de código con copy viejo — no corregidos, señalados

Quedan **cinco** referencias al copy anterior en **comentarios** de archivos de producto:

| Archivo | Línea | Copy viejo citado |
|---|---|---|
| `_home/FeaturedCarousel.tsx` | 157 | «Piezas destacadas del catálogo» |
| `_home/FeaturedCarousel.tsx` | 601 | «Piezas destacadas del catálogo» |
| `_home/HomeQuoter.tsx` | 22 | «Continuar mi cotización» |
| `(storefront)/page.tsx` | 35 | «Sets buscados» |
| `(storefront)/page.tsx` | 37 | «Continuar mi cotización» |

Son prosa, no render. **No se editaron a propósito** porque el encargo acotaba el pase a cadenas de
copy y ninguna de estas líneas cambia lo que ve el usuario.

*(Corrección del techlead: la primera redacción daba además una segunda razón —«`ux-ui` trabajaba sobre
estos mismos componentes», con riesgo de conflicto de merge— que es **falsa**. Por la tabla de propiedad
de `CLAUDE.md`, `ux-ui` escribe en `docs/DESIGN_SYSTEM.md` y **no puede escribir en `frontend/`**: el
riesgo de conflicto en `frontend/src/` era **cero**. Se retira, porque dejarla escrita le enseñaría una
regla de propiedad equivocada al próximo que lea esta nota. El primer motivo se sostiene solo. También se
completó el inventario: eran cinco sitios, no cuatro — faltaba `HomeQuoter.tsx:22`.)*

Queda anotado como **deuda cosmética menor**, no bloqueante, para el próximo pase que toque esos archivos
por un motivo real.

### 41.7 Verificación

Suite completa, no un subconjunto (cifras finales, tras las tres rondas de corrección):

| Comando | Resultado |
|---|---|
| `npm run test` | ✔ **102 archivos / 951 casos, todos verdes** (~94 s) |
| `npm run typecheck` | ✔ `tsc --noEmit` sin errores |
| `npm run lint` | ✔ `No ESLint warnings or errors` |

**Delta de casos: +7**, y los siete son el control de §41.4: un `it.each` con **seis** cadenas (una por
brazo, con tres para el brazo `grad` porque cubren la ampliación) **más** el test de **cobertura de
brazos** que entró con T1. El pase de copy en sí aporta **0**: un cambio de textos no debe añadir ni
quitar pruebas. Los 944 originales siguen siendo los mismos 944.

`i18n-parity.test.ts` verde confirma lo importante: paridad ES/EN intacta (**2 287 claves, conjuntos
idénticos**), cero apariciones de la marca retirada «TCG Vault», y ningún candado semántico del catálogo
(créditos, grados, disclaimer del gancho) movido por el camino.

**Inestabilidad observada, ajena a este pase.** En una de las corridas completas cayó
`M2View.test.tsx > «money-safe: si TCGCSV no fue alcanzable del todo …»`. **En aislado el archivo pasa
65/65**, y la corrida completa siguiente pasó 948/948. Es **GR-D4**, ya registrada en `TECH_DEBT.md` como
inestable en suite completa; es un test de **admin M2** que no toca ninguna clave del home. No se
investigó más aquí porque no pertenece a este pase, pero queda dicho que se vio.

### 41.8 Alcance

Escrituras: `frontend/messages/es.json`, `frontend/messages/en.json`,
`frontend/src/app/[locale]/(storefront)/page.test.tsx`,
`frontend/src/app/[locale]/(storefront)/_home/FeaturedCarouselRotation.test.tsx`, este archivo y
`docs/TECH_DEBT.md` (a petición explícita del techlead, que es su dueño de petición).
Cero cambios de contrato, cero endpoints nuevos, cero mocks nuevos, cero tokens nuevos, cero componentes
tocados. `backend/` intacto. **`docs/DESIGN_SYSTEM.md` NO se tocó** (es de ux-ui) ni tampoco
`docs/API_CONTRACT.md`.

**Una clave fuera del home:** `vault.trustBanner` (§41.10). Sale del encargo original —que era
«copy de marketing del home»— y se tocó a propósito, porque repetía **palabra por palabra** la misma
afirmación falsa que se estaba corrigiendo en el home. Corregir cuatro superficies y dejar la quinta
habría dejado la contradicción **dentro del producto**, que es peor que no haber tocado ninguna. Sigue
siendo `frontend/`, así que no cruza ninguna frontera de propiedad.

### 41.9 Ronda de corrección de QA — tres afirmaciones que el producto desmiente

QA rechazó la primera versión del copy. Los tres hallazgos son de **veracidad**, no de tono, y ninguno se
discutió: si el texto y el producto discrepan, el texto está mal.

**(a) BLOQUEANTE — «Lo que ves es lo que pagas» / «What you see is what you pay» era falso.**
`PROJECT.md:346` fija que los precios de catálogo/ficha se muestran **sin IVA**, y `:348`, `:401` y `:766`
que al total se le suman **IVA 16 %**, **costo de procesamiento** y **MX$175 de envío** (verificado línea
por línea antes de reescribir, no asumido). Prometer equivalencia de precio en el home y desmentirla en el
checkout es exactamente la sorpresa que el título «Compras sin sorpresas» decía evitar. Lo bueno es que el
desglose **es** el argumento: se dice, no se esconde.
- `how.step1Title` → `Compras con las cuentas claras` / `You buy with the numbers up front`
- `how.step1Body` → `… Antes de pagar ves el desglose completo: IVA, procesamiento y envío.` /
  `… Before you pay, you see the full breakdown: VAT, processing and shipping.`

**(b) `trustPayout` prometía un plazo inexistente.** «Te transferimos **en cuanto** verificamos» promete
inmediatez, y **no hay SLA de pago**: el SPEI lo opera el admin a mano (`:431`), el pipeline pasa por
`aprobada` donde el dueño decide **carta por carta** y puede rechazar por NM-only (`:424-428`, `:435`), y
sobre MX$3 000 el pago está **bloqueado por KYC** (`:439-443`). Encima había perdido la palabra
**recepción**, que `:433-435` exige comunicar («el pago se realiza DESPUÉS de que recibimos y
verificamos»). Nuevo valor: `Te pagamos por transferencia tras recibir y verificar` /
`We pay by bank transfer after we receive and verify`.

**(c) `gradingGems.lead` había perdido su anclaje.** Mi redacción («valen mucho más en el mercado»)
soltaba el anclaje a **valor de mercado** y sonaba a predicción sobre **esas** copias — justo lo que
`catalog.gradingNote.p3` desmiente. En EN era más marcado. ES vuelve a anclar
(`Cartas sin gradear cuyo valor de mercado, ya gradeadas, es muy superior.`) y **EN se revierte al valor
original de `main`**, byte a byte (verificado contra `478a826~1`).

**Lección del pase:** el riesgo de un cambio de copy no es el tono, es que una frase más pegadora afirme
algo que el sistema no cumple. Las tres eran mejores como marketing y peores como descripción del
producto. Ninguna la habría cazado un test: no hay candado que compare el copy con `PROJECT.md`.

### 41.9-bis Segunda ronda de QA — el precio mostrado NO es el de mercado, en ninguna de las dos direcciones

QA rechazó **otra vez**, con tres bloqueantes, y los tres son **la misma falla**: el copy afirmaba que el
número que se enseña **es** el valor de mercado. En este producto no lo es en ningún sentido:

| Dirección | Regla | Fuente verificada |
|---|---|---|
| Venta | `redondeo↑(max(piso, mercado × markup))`, markup **1.60× → 1.15×** | `PROJECT.md:1200`, `:1209`; `backend/src/common/money.ts` (`computeSalePriceFromCurve`) |
| Compra | **30 % → 50 %** del mercado | `PROJECT.md:1201`, `:1210` |

Mercado $50 ⇒ **venta $70**. Mercado $100 ⇒ **compra $40**. El «precio de mercado» no se cobra ni se paga
nunca; es una **referencia**.

- **(B1) `heroSubtitle`** decía «al precio real del mercado» / «at real market prices». Falso por
  construcción. **Se quita el claim entero**, no se matiza: el precio nunca fue el argumento del hero, la
  custodia sí. Vuelve a «con condición garantizada» / «condition guaranteed».
- **(B2) `sellBody`** — **una preposición volvió falsa la frase.** Yo había cambiado «cotizamos **con** el
  valor de mercado» por «**al** valor de mercado». «Cotizar **al** valor X» dice que X es lo que recibes, y
  se paga 30-50 % de eso. Restaurado a **«con … como referencia»** / «using … as the reference». Lo que lo
  hace grave: el cotizador de **esa misma página** solo enseña «Te pagamos $X», así que la contradicción
  era visible en la pantalla siguiente.
- **(B3) `how.step1Body`** decía «su precio de mercado», contra una decisión **LOCKED** (§N.7 / decisión 2 /
  criterio 92): `PROJECT.md:1320-1321` fija que **tejas y listados no muestran mercado «y no van a
  mostrarlo»** — solo la ficha. Verificado en el código: `FeaturedCarousel.tsx:141-151` pinta
  **únicamente** `salePriceCents`. Era falso **en la misma pantalla donde se leía**.

**Fuera de los bloqueantes, dos más de la misma familia:**

- **`how.step3Body` vendía consignación**, que está **fuera de alcance** (`PROJECT.md:2076`,
  «Consignación / marketplace C2C»). Comprobado en el producto: la bóveda solo tiene **`Retirar`** —no
  existe ninguna acción de venta en `VaultView`—, y §E exige que el vendedor **envíe** la carta. «O las
  vendes desde la bóveda, sin moverlas» prometía una función que no existe y que nadie va a construir.
  Ahora: `Un solo envío para todo lo que acumulaste, cuando tú lo pidas.`
- **`setsWanted` (EN)**: `Sets on the hunt` se lee como que **los sets** cazan. → `Sets to hunt`. El ES
  (`Sets en cacería`) lo aprobó el humano y **no se toca**.

**Auditoría, no confianza en la lista.** Tras aplicar, se barrió **todo** el bloque `home.*` en los dos
idiomas por `mercado|precio|pagam|valor|vend` (ES) y `market|price|pay|value|sell|worth` (EN) buscando
cualquier otra afirmación de precio. **Ninguna más es falsa**: las de pago (`quoter.*`, `bounties.*`)
dicen «lo que te pagamos», que es exactamente lo que el cotizador enseña; `featuredSet.*` y `trustPrice`
son **claves muertas** (no se renderizan).

**Por qué esto pasó tres gates.** Los tres bloqueantes sobrevivieron a `test`, `typecheck` y `lint` y a una
ronda de corrección. Ningún candado compara el copy con `PROJECT.md` ni con el componente que lo pinta, y
**no puede haberlo** sin inventar un acoplamiento peor que el problema. La verificación de un cambio de
copy es **leer la fuente**, y la fuente no es el brief que pide el cambio: los tres errores venían del
brief, y el brief es justo lo que no se puede usar como referencia para validarlos.

**Y la regla que faltaba explícita: el brief de un rol NO es fuente de verdad para otro.** La regla de
conflicto de `CLAUDE.md` ordena `PROJECT.md` > contrato > código. La instrucción de un compañero —por
detallada que venga, y aunque traiga el valor exacto a teclear— **no está en esa cadena**. Los tres
bloqueantes salieron del brief y sobrevivieron dos gates precisamente porque cada revisión posterior lo
dio por bueno: un texto entre comillas parece un dato verificado y no lo es. Un valor de copy solo se
puede validar contra `PROJECT.md` y contra el componente que lo pinta; si el brief y la fuente discrepan,
manda la fuente y se devuelve el hallazgo a quien lo redactó.

### 41.9-ter Tercera ronda — dos residuos que yo mismo levanté

Ninguno era falso; los dos eran **sobrepromesa o ruido**, y los levanté al reportar en vez de aplicarlos
en silencio.

- **`how.step1Body`: «su precio final» → «su precio de venta»** (EN: `final price` → `sale price`). Los
  precios se muestran **sin IVA** (`PROJECT.md:346`), así que «final» se podía leer como «no hay más
  cargos» — la misma familia de sobrepromesa que «Lo que ves es lo que pagas», más pequeña. El criterio
  con el que se decidió, y que vale más que el caso: **el copy no debería necesitar que la línea de al
  lado lo rescate**. Que la frase siguiente desactivara la lectura mala no era razón para dejarla.
- **La muletilla «cuando tú digas/quieras/pidas» estaba cuatro veces** en el home: `heroSubtitle`,
  `trustCustody`, `how.step3Title` y `how.step3Body` — el paso 3 **se repetía a sí mismo**, título y
  cuerpo. Se queda donde pega y se dice de otra forma en el resto: `how.step3Body` →
  `Todo lo que acumulaste sale junto, en un solo envío.`, `trustCustody` →
  `Bóveda bajo resguardo: un solo envío para todo`.

**Verificado que la reescritura no cuela un claim nuevo** (es una reformulación, no una promesa distinta):
`PROJECT.md:400` da el retiro de una o varias piezas **sin mínimo**, y `:401` fija la tarifa **por
paquete**, que es lo que sostiene «un solo envío para todo». La restricción real —solo se retiran piezas
**liquidadas y sin envío activo** (`vault.onlySettled`)— es **preexistente** y afectaba igual a la
redacción anterior; no la introduce este cambio.

> **Residuo declarado, no resuelto:** el objetivo era dejar la frase **solo en el hero**, y quedan **dos**
> apariciones — `heroSubtitle` y `how.step3Title` («Pides el envío cuando quieras»). `step3Title` no
> entraba en el cambio pedido y **no se tocó**: es el titular del paso cuyo asunto *es* el envío a
> petición, y vaciarlo lo dejaría sin tema. Queda dicho para que nadie lea «solo en el hero» como un
> hecho verificado: son dos, y la segunda es deliberada.

### 41.11 Se borran `home.trustAuth` y `home.trustPrice`: el bloqueante B1 estaba embotellado en una clave muerta

`home.trustPrice` decía «Valor de mercado transparente en MXN» / «Transparent market value in MXN» — es
**la misma afirmación que §41.9-bis acaba de retirar del hero y del paso 1** por falsa (el precio mostrado
es `mercado × markup`, 1.15×–1.60×). Nadie la pintaba, así que no engañaba a nadie **hoy**.

Ese «hoy» es todo el problema. El día que alguien reponga la banda de confianza completa, **B1 vuelve
solo**, y por un camino que ningún gate puede ver: una clave que ya estaba ahí, que nadie escribió en ese
diff, y que por tanto nadie revisa. Es la **misma forma que el homoglifo de §41.4** — algo latente que no
falla hasta que alguien lo toca, y que entonces falla en silencio.

**Elegido: borrarlas** (ES y EN), frente a la alternativa de corregir el texto de `trustPrice`. Una cadena
muerta *correcta* sigue siendo una cadena que nadie verifica, y la decisión se apoya en evidencia, no en
preferencia:

- `git log -S"trustAuth" -- frontend/src` no devuelve **ningún** commit: estas claves **nunca se
  renderizaron en toda la historia del repo**. No son claves que perdieron su consumidor — nacieron sin él.
- `DESIGN_SYSTEM.md` **no tiene sección de banda de confianza** que las exija (comprobado; ux-ui no
  depende de ellas).
- La banda real (`HomeQuoter.tsx:304-311`) tiene **dos** renglones y solo dos: `trustCustody` y
  `trustPayout`.
- El texto queda en el historial de git si alguna vez hace falta.

**Alcance deliberadamente corto.** Se borran **solo esas dos**. Las otras huérfanas del home
(`home.ctaBuylist`, `home.vaultLabel`, `home.featuredSet.*`) **se quedan**: no cargan ninguna afirmación
falsa —`featuredSet.*` dice «referencia de mercado», que es justamente el término correcto—, así que no
había razón para adelantar su baja fuera del acuerdo pendiente con ux-ui. La ficha **MK-D2** de
`TECH_DEBT.md`, que las cubría a las cinco, queda actualizada: baja **parcial**, el resto sigue abierto.

Paridad ES/EN tras el borrado: **2 285 claves, conjuntos idénticos** (eran 2 287). Se van de los dos
locales o de ninguno — `i18n-parity` no admite otra cosa, y es el candado que lo garantiza.

### 41.10 «Asegurado» no era un sinónimo: era una póliza que no existe

Hallazgo escalado al humano durante el pase, sobre una bandera abierta en `PROJECT.md:2969-2971`
(«definir si hay seguro formal»). **Respuesta del humano: no hay póliza contratada** — *«No hay seguro
sino que están en lugar seguro»*. La bóveda es un lugar físicamente seguro; **no existe cobertura
aseguradora del inventario en custodia**.

«Asegurado» no es sinónimo de «resguardado»: **nombra una póliza**. Afirmarlo sobre **bienes de terceros**
sin tenerla es la promesa que se vuelve cara el día que se pierde un paquete, y estaba escrita en cinco
sitios. Corregidas:

| Clave | ES | EN |
|---|---|---|
| `home.heroSubtitle` | «Viven **resguardadas** en tu bóveda…» | «They live **safe** in your vault…» |
| `home.trustCustody` | `Bóveda bajo resguardo: un solo envío, cuando tú digas` | `Vault storage: one shipment, whenever you say` |
| `home.how.tag` | `Custodia en bóveda` | `Vault custody` |
| `home.how.step2Body` | `Guardadas bajo resguardo, …` | `Kept safe, …` |
| `vault.trustBanner` | «autenticadas y **resguardadas** en bóveda» | «authenticated and **kept safe** in custody» |

**Auditoría exhaustiva, no lista a ojo.** Se barrieron ambos catálogos completos por `asegurad|seguro`
(ES) e `insur` (EN) sobre las 2 287 claves, y se reauditó después de editar: **cero afirmaciones de seguro
sobre la custodia** sobreviven en `home.*` ni en `vault.*`. Ese barrido es lo que da derecho a decir que
son cinco y no «las que se vieron».

**Lo que NO se tocó, porque es otra afirmación y es legítima** — asegurar un *paquete* con la paquetería
no es asegurar un *inventario en custodia*:

| Clave | Por qué se queda |
|---|---|
| `shipments.shippingFee` («Envío (con seguro)» / «Shipping fee (insured)») | Habla del **envío**, no de la custodia. **Ver pregunta abierta abajo.** |
| `safeShipping.step4Title` / `step4Body`, `buylist.trustShipping`, `buylist.shippingGuideLink` | Instrucciones al **vendedor** del buylist para que asegure **su** envío hacia nosotros. |
| `admin.m2.gradedEstimates.tiers.hint` («retorno asegurado») | Costeo de PSA en back-office, no promesa al cliente. |
| `catalog.gradingNote.p5` | Copy **legal** de grading, congelado. |
| `admin.m6.resetShareNote` («canal seguro»), `admin.m6.deleteQuestion` («¿Seguro que…?») | «Seguro» en otra acepción; falsos positivos del barrido. |

> **PREGUNTA ABIERTA para product-owner — no la resuelvo yo.** `shipments.shippingFee` afirma que el envío
> va **con seguro** / **insured**. **No está verificado** que la paquetería lo cubra dentro de la tarifa de
> **MX$175** (`PROJECT.md:401`). Es la **misma clase de afirmación** que la que se acaba de retirar de la
> custodia —una cobertura declarada en el copy— solo que sobre el envío, así que no puede quedarse sin
> comprobar solo porque el barrido la clasificara como «legítima»: es legítima **si la póliza existe**.
> Si no la hay, esa cadena necesita el mismo tratamiento. **Dueño de la respuesta: product-owner**
> (es negocio/contrato con la paquetería, no copy).

---

## §42 · P-54: el índice de sets pinta el LOGO de la expansión — la placa de tinta (`DESIGN_SYSTEM.md` §24, contrato v1.52 / M-47, `ARCHITECTURE.md` §4.40) — 2026-09-02, rama `claude/tcg-hunt-orchestrator-28p7z1`

> El diseño estaba **escrito** (ux-ui, §24 completa con cinco reglas duras R1–R5). Esto es su ejecución,
> no una interpretación. Riesgo de dinero: **ninguno** — es presentación pura.

### 1. Qué cambió, y por qué cabe en UN archivo

`MasterSetIndex.tsx` es el índice **compartido por los cuatro modos** (`platform` de M1, `quoter` del
cotizador, `user_vault_self`, `user_vault_admin`, §4.20f). La teja vive entera ahí, así que las cuatro
pantallas anfitrionas reciben el cambio **sin tocarlas**: siguen invocando el mismo componente con su
`mode`. Ese es el motivo de que §24.1 diseñe «para una superficie» y salgan cuatro gratis.

La teja pasa de **tarjeta de texto** (borde + `bg-surface` + hover de fondo) a **placa + leyenda sobre
papel**:

| Pieza | Implementación |
|---|---|
| Placa (`SetPlate`) | `aspect-[3/2] w-full bg-ink`, radio 0, **sin borde**, aire 16/20/24px. ⚠️ **La primera versión de esta fila era FALSA**: decía «cero CLS» y la placa sí saltaba de alto al cargar, porque la `<img>` iba en flujo y anulaba la relación de aspecto. Corregido y **medido** en §43 (bloqueante B-1 de QA) |
| Logo | `<img>` crudo (**nivel B**, §4.40.7): sin `next/image`, sin `srcset`, `loading="lazy"` en TODAS, `decoding="async"`, `object-contain` (R1) |
| Contorno de seguridad | `filter: drop-shadow(0 0 1px var(--color-on-ink)) ×2` en línea. **Obligatorio** (§24.2): salva al logo oscuro sin filete *sin* tener que inspeccionar logo a logo |
| Sin logo | **Monograma** serif sobre la tinta (§24.5), `aria-hidden`. ⚠️ La primera versión lo dejaba pintado **también con logo** (se transparentaba a través del PNG): corregido en §43 (bloqueante B-2) |
| Leyenda | Nombre serif 16/18/20px con **2 líneas reservadas** (40/45/50px) y sin truncado; meta mono 11px versalitas `tracking-label` |
| Retícula | `grid-cols-2 · sm:3 · lg:4`, gap 24/32 → 32/40. **Se topa en 4** |
| Foco | El anillo **estándar** del sistema (`:focus-visible` global de `globals.css`: `outline 2px` + `offset 2px`). Se retiró el `focus-visible:shadow-focus focus-visible:outline-none` que traía la teja: el anillo tiene que caer **por fuera**, sobre papel — rojo sobre tinta es 2,5:1 (§24.9) |

### 2. El monograma no es un esqueleto: es contenido final (R4)

> ⚠️ **CORRECCIÓN (§43).** Este párrafo decía «la imagen lo tapa» y **no era cierto**: el monograma se
> quedaba pintado debajo de un PNG con transparencia, así que se veía **a través** del logo, para
> siempre. Hoy se **retira** al `onLoad`. Lo que sigue vale con esa corrección aplicada.

Se pinta **desde el primer frame** y **se retira cuando la imagen carga**, sin transición. Consecuencia
deliberada: **la placa no pulsa nunca**. Es el precedente literal de `CardImage`, que deja el pozo QUIETO
cuando no hay `src` porque un `animate-pulse` eterno hace que un dato ausente **legítimo** parezca una app
colgada. Y aquí `logoUrl: null` es legítimo, **normal y permanente** (§4.40.6): promos, colecciones y sets
viejos no van a tener logo nunca, y un set aún no re-sincronizado se ve **idéntico** a propósito.

`onError` retira el `<img>` y deja el monograma: un 404 del CDN **no deja a nadie esperando** y jamás se ve
un icono de imagen rota. La placa va keyada por `logoUrl`, así que ni un fallo ni una carga previa se
heredan al paginar **ni cuando un re-sync cambia el logo del mismo set** (§43).

La derivación (`setMonogram`, exportada para poder probarla) es **presentación del front**, no un dato:
iniciales de las palabras significativas, máximo 3, ignorando `and`/`&`/`of`/`the`, con caída a los 3
primeros caracteres cuando el nombre es numérico (`151` → `151`). Que dos sets compartan iniciales da igual:
el nombre completo está debajo.

### 3. A11y: el logo es decorativo, el texto es el dato (R2)

`alt=""` + `aria-hidden="true"` en el logo **y** en el monograma. El nombre accesible de la teja lo dan el
nombre visible y la meta, que ya están dentro del `<button>`; no se añade `aria-label` (duplicaría y
desalinearía ES/EN). Sin ese `aria-hidden`, un lector de pantalla anunciaría «BS, Base Set, Base 1999».
Hay **una** parada de tabulación por set y `lang="en"` viaja ahora en el nombre y en la meta (antes envolvía
también al badge `Combinado`, que es español).

### 4. Contrato: `logoUrl` REQUERIDO donde llega, OPCIONAL donde no lo emiten

- **`MasterSetSummaryDTO.logoUrl: string | null`** — requerido a propósito. Ser requerido es lo que obliga al
  compilador a que quien compone el DTO **client-side** (el modo `quoter`, que lo arma desde
  `GET /buylist/sets`) decida el valor en vez de olvidarlo. Sin eso, la teja del cotizador sería la única sin
  logo de todo el producto y **nada** fallaría hasta verlo con los ojos. Al añadir el campo, el typecheck
  señaló **exactamente** los dos sitios que lo construían a mano (dos fixtures de test) — que es el efecto
  buscado.
- **`CardSetDTO.logoUrl?: string | null`** — opcional, y no por descuido: el mismo tipo sirve a **dos**
  endpoints y solo uno lo emite. `GET /buylist/sets` lo manda siempre; `GET /catalog/sets` **no**
  (§4.40.5: alimenta dropdown y filtro de texto, no tejas). En esa respuesta la clave está **ausente de
  verdad**, y el tipo lo dice.

### 5. El mock dice la verdad — los dos casos, en la misma retícula

Los fixtures traen sets **con** logo (`sv08`, `sv06`, `sv1`, `cel25`) y sets **sin** logo (`cel25c`,
`swsh1`, `base1` → `logoUrl: null`, clave presente). Si todos tuvieran logo, el monograma **no se
ejercitaría jamás** en dev ni en Playwright y el hueco solo aparecería en producción: es el modo exacto en
que se escapó el bug de la imagen del carrito (§34). Hay un test dedicado a esto —«conviven tejas con logo
y tejas sin logo»— que se pone **rojo** si alguien uniforma los fixtures en cualquiera de las dos
direcciones.

**Divergencia conocida y acotada:** `lib/api.ts` sirve `getSets()` (`/catalog/sets`) y `listBuylistSets()`
(`/buylist/sets`) del **mismo** array `mockSets`, así que en modo mock `/catalog/sets` también rinde
`logoUrl` aunque el backend real no lo emita ahí. No lo consume nadie (los chips de la home y el `SetFilter`
son texto) y el tipo opcional impide asumirlo. Se deja anotado porque la separación limpia exige tocar
`lib/api.ts`, que en este pase lo tenía otra rama.

### 6. Verificación por mutación (no «los tests pasan»)

13 pruebas nuevas en `MasterSetIndexPlate.test.tsx`. Cada una se comprobó **rompiendo a propósito** lo que
afirma y confirmando que la suite se pone roja:

| Mutación | Resultado |
|---|---|
| `fetchQuoterIndex` deja de mapear `logoUrl` | 2 rojas |
| Se quita el `aria-hidden` del monograma | 1 roja (nombre accesible contaminado) |
| `object-contain` → `object-cover` | 1 roja |
| Se quita el contorno de seguridad | 1 roja |
| Se quita el `onError` | 1 roja |
| Se añade `animate-pulse` a la placa | 2 rojas |
| Se quita el `aria-current` | 1 roja |
| Retícula a 1 columna | 1 roja |
| Monograma sin tope de 3 / sin stop-words / sin caída a 3 caracteres | 1 roja cada una |
| La teja vuelve a ser tarjeta (`border` + `bg-surface`) | 1 roja |
| Fixtures: **todos** con logo / **ninguno** con logo / el índice mock deja de proyectar el campo | 2, 4 y 4 rojas |

Suite completa del front: **964 pruebas verdes**, typecheck y lint limpios.

> ⚠️ **Y aun así el pase se rechazó.** Ninguna de esas 13 pruebas podía ver los dos bloqueantes: jsdom no
> hace layout ni carga imágenes. La tabla de arriba es honesta sobre lo que mutó, pero **la cobertura que
> yo creí tener no existía** — dos de esas pruebas afirmaban más de lo que verificaban. Ver §43.

### 7. Lo que queda pendiente (y quién lo debe)

1. **§24.10 — la placa `sm` (112×64) en el encabezado del binder.** Diseñada por ux-ui, **no
   implementada** en este pase: el encargo acotaba el trabajo a la teja del índice y `MasterSetBinder.tsx`
   estaba fuera de alcance. Es aditivo y pequeño (`MasterSetBinder` ya recibe el `MasterSetSummaryDTO`
   entero, logo incluido). **Dueño: frontend, siguiente pase.**
2. **`currentSetId`** existe como prop opcional del índice (§24.6) y **ningún anfitrión la pasa todavía**:
   hoy, al abrir un set, el índice se desmonta y no hay «set actual» que pintar. Está para cuando el
   anfitrión sepa de verdad cuál es (vuelta del binder con el set en la URL) — §24.6 prohíbe **inventar**
   una selección que no existe.
3. **Cero claves i18n nuevas**, tal como manda §24.15: el nombre, la serie y el año ya se pintaban, el
   `alt` es vacío por diseño y el monograma se deriva del nombre — no se traduce. `messages/*.json` no se
   tocó y la paridad ES/EN queda intacta.

---

## §43 · P-54, segunda ronda: los dos bloqueantes que 964 pruebas verdes no podían ver (rechazo de QA sobre §42) — 2026-09-02, rama `claude/tcg-hunt-orchestrator-28p7z1`

> QA midió en **Chromium real** lo que mi suite medía en **jsdom**. Lo importante de este rechazo no es
> que el componente estuviera mal: es que **yo creí que mis pruebas lo cubrían**. Dos de ellas afirmaban
> más de lo que verificaban.

### 1. B-1 · La placa NO era de tamaño fijo: crecía con la proporción del logo

**El defecto.** La `<img>` iba **en flujo** con `h-full` (`height:100%`) dentro de un padre cuya altura la
fijaba `aspect-ratio`. Esa altura **no es definida** para el hijo, así que `height:100%` resuelve a `auto`,
la imagen toma su **proporción intrínseca**, y su alto pasa a ser el `min-content` del padre: el
`aspect-[3/2]` queda **anulado**. Medido por QA a 1440 y reproducido por mí:

| Proporción del logo | Placa que salía | Esperado |
|---|---|---|
| 1.92:1 | 180×120 ✅ | 180×120 |
| **1.60:1** | **180×131** | 180×120 |
| **1:1** | **180×180** | 180×120 |
| **1:2** | **180×312** | 180×120 |

Umbral ≈1.83:1 en `lg`: **cualquier logo menos apaisado que eso descuadraba la retícula**, y §4.40.2 dice
que el logo es de «proporción MUY variable entre sets». Viola **R1**, §24.3 («uno cuadrado o vertical se
contiene igual») y §24.12 nº3. Y además la placa **saltaba de alto al cargar la imagen** — CLS, lo que
§4.40.8 encargo (c) prohíbe explícitamente y lo que §42 afirmaba, en falso, no tener.

**El arreglo.** Los **dos** hijos de la placa pasan a **absolutos**: un hijo absoluto no contribuye a la
altura del padre, así que la caja mide `width × 2/3` **siempre**, haya logo apaisado, cuadrado, vertical o
ninguno. El aire interior (16/20/24px) se muda del padre a la **imagen** (`p-4 sm:p-5 lg:p-6`): para un
hijo absoluto el bloque contenedor es la **caja de relleno** del padre, así que un `p-4` arriba no lo
tocaría, y con `box-sizing:border-box` el `object-contain` encaja dentro de la caja de contenido — mismo
aire, sin devolverle el alto a la imagen. Se añade `container-type: inline-size`, que además aísla el
tamaño de la caja de su contenido.

**Medido, no razonado** (viewport → ancho de placa, con logo cuadrado forzado):

| Viewport | Placa | ¿3:2? |
|---|---|---|
| 390 | 163×109 | ✅ |
| 640 | 181×121 | ✅ |
| 1024 | 116×77 | ✅ |
| 1280 / 1440 | 180×120 | ✅ |

### 2. B-2 · El monograma nunca se ocultaba: se transparentaba bajo el logo

**El defecto.** Había `onError` pero **no su contraparte al cargar**. El monograma se pintaba siempre, y
§24.2 establece como hecho que los logos del proveedor son **PNG con transparencia**: `object-contain` no
pinta fondo, así que el monograma se veía **a través** del logo, de forma permanente. Viola §24.5 («cuando
la imagen llega, **la imagen lo tapa**») y §24.14 nº6.

**El arreglo.** `SetPlate` pasa de un booleano a **tres estados** —`pending` · `loaded` · `failed`— y el
monograma se **retira** en `loaded`, sin transición (un cross-fade mostraría justo las dos cosas
superpuestas que se están corrigiendo). `failed` vuelve a mostrarlo, así que un fallo posterior a la carga
tampoco deja la placa vacía.

### 3. I-2 · El monograma estaba atado al breakpoint del VIEWPORT, no al ancho de la PLACA

QA lo midió en `/es/buylist`: a viewport 1024 la placa del cotizador mide **116×77** —**más pequeña que en
móvil**— y el monograma fijo de `lg:text-[44px]` la llenaba de borde a borde («CEL» desbordado).

**El arreglo:** `container-type: inline-size` en la placa + `text-[16cqw]` en el monograma ⇒ el tamaño se
mide contra **la placa**, que es la caja de la que depende de verdad. §24.5 pide ≈28px a 167px de ancho y
≈44px a 280px, o sea 16,8 % y 15,7 %: **16 %** interpola los dos puntos. Medido después del arreglo, la
proporción es **exactamente 0,16 en los cuatro viewports** (26,08/163 · 29,01/181 · 18,56/116 ·
28,80/180). La curva exacta queda como consulta a ux-ui (`TECH_DEBT.md` DT-Gc).

### 4. I-1 · La lección: la prueba que afirmaba más de lo que verificaba

`expect(plate.className).toContain('aspect-[3/2]')` comprueba que **la cadena de clase está**, no que la
caja mida 3:2. Con esa afirmación de más, B-1 pasó con **964 pruebas verdes**. Igual el caso R4: verificaba
el monograma solo en la teja **sin** logo, nunca que **desapareciera** en la teja con logo — por eso B-2
tampoco se vio. **Ninguna prueba de vitest puede cerrar esta clase**: jsdom no hace layout ni carga
imágenes. La aserción de clase no se «arregla» afinándola; hay que **cambiar de instrumento**.

Lo que se hizo, en dos frentes:

**(a) En vitest se REBAJA la afirmación a lo que de verdad se verifica.** La prueba de geometría se
sustituye por una de **estructura** —los dos hijos son absolutos, el aire vive en la imagen y no en el
padre— que es la *causa* del defecto, y su comentario dice explícitamente que **no mide la caja** y dónde
se mide. Se añaden dos pruebas de B-2 (el monograma se retira al `load`; y vuelve si la imagen falla
después). Total: **16** pruebas, suite completa **967 verdes**.

**(b) La geometría se mide en Chromium.** Nuevo `frontend/e2e/master-set-plate.spec.ts` (5 pruebas):

1. **R1** — todas las placas de la retícula miden **exactamente lo mismo** y su alto es 2/3 de su ancho,
   con logos interceptados de proporción **1.92:1, 1.60:1, 1:1 y 1:2** conviviendo en la misma página.
   ⚠️ **CORRECCIÓN (§43.8, defecto N-2):** escrito así era **falso**. El reparto era un `hash(url) % 4`
   y de los cuatro sets con logo del fixture **tres colisionaban en `1:1` y uno en `1:2`**: las dos
   proporciones **apaisadas no se servían nunca**. Hoy el reparto es por índice de descubrimiento y la
   propia prueba **afirma** qué se sirvió, así que la frase de arriba ya es cierta — y verificable.
2. **Cero CLS** — se **retiene** la respuesta del logo, se mide la placa vacía, se libera y se vuelve a
   medir: el alto no cambia. Sirve un logo **cuadrado** a propósito: con uno apaisado de 1.92:1 el defecto
   no se manifestaba y la prueba habría pasado sin probar nada.
3. **B-2** — hay exactamente **un monograma por placa sin logo, ni uno más**, y ninguna placa tiene
   `<img>` y monograma a la vez (`imgs + monos === 1`).
4. **404** — se descubre del DOM el primer logo con imagen, se le fuerza un 404 y se comprueba que esa
   placa cae al monograma **y conserva su caja**.
   ⚠️ **CORRECCIÓN (§43.8, defecto N-1):** «**esa** placa» era **falso** y era un **falso verde**. La
   víctima se localizaba como «la primera teja SIN imagen», y el fixture trae **dos** sets legítimamente
   sin logo: al borrar el `onError` del componente, la víctima conservaba su `<img>` rota y el selector
   se iba a un set que nunca tuvo logo — la prueba pasaba **con la caída al monograma eliminada**. Hoy
   la víctima se ata **por su identidad** y hay un **testigo** sano que impide el aprobado por
   apagón general.
5. **I-2** — el monograma guarda la misma proporción con su placa en dos anchos de placa muy distintos
   (181px y 116px), y las letras nunca llenan la placa.

**Verificación por mutación, esta vez en el navegador** (cada mutación = build de producción + suite):

| Mutación | Resultado |
|---|---|
| B-1: la `<img>` vuelve al flujo con `h-full` y el aire al padre | **4 rojas**, con el mensaje `placa 1: 180×131 no es 3:2` — el número exacto que reportó QA |
| B-2: el monograma se pinta siempre | **1 roja**, y solo esa: `Expected 2, Received 6` monogramas |
| I-2: el monograma vuelve a `text-[28px] lg:text-[44px]` | **1 roja**: `monograma 44px sobre placa 116px` |
| Sin mutar | **5 verdes** |

⚠️ **CORRECCIÓN (§43.8):** en esta tabla **faltaba la mutación de `onError`**, y ésa es exactamente la
razón por la que el falso verde N-1 no salió. La tabla completa —con `onError` dentro y con los dos
defectos del propio spec— está en §43.8.

### 5. Dos cosas más que se cerraron en esta ronda

- **`SetPlate.failed` no se reiniciaba** si cambiaba el `logoUrl` del **mismo** `setId` (tras un re-sync,
  la teja se quedaba en monograma hasta desmontarse). La placa ahora va keyada por `logoUrl`.
- **Falso rojo propio, dejado escrito porque volverá a morder:** el primer intento del test del 404
  localizaba la teja con `page.locator('li').filter({ hasText: 'Surging Sparks' })`, y `/es/buylist`
  **también** pinta «Top Bounties», cuyas tarjetas mencionan ese set y llevan arte de carta. El test medía
  una tarjeta de bounty. Se corrigió acotando a las `li` **que tienen placa**. Y de paso el spec se
  reescribió **agnóstico**: cero nombres de set literales — la proporción se reparte por hash de la URL y
  la víctima del 404 se descubre del DOM.
  ⚠️ **CORRECCIÓN (§43.8):** esa segunda mitad envejeció mal en el mismo día. **El hash era N-2** y
  **«se descubre del DOM» sin atarla era N-1**: al corregir un falso rojo metí un falso verde. El
  objetivo (spec agnóstico) era correcto; el **mecanismo** no. Hoy: índice de descubrimiento e
  identidad explícita de la víctima.

### 6. Alcance del nuevo spec, dicho sin adornos

Corre en **modo mock** y está marcado `needsSeed` contra el stack real, con su razón impresa: `logoUrl` es
`null` en **todo** el catálogo real hasta que un operador re-sincronice (§4.40.4 — **no hay backfill**), así
que en real no habría ninguna placa **con** logo que medir. No es «no supe escribirlo agnóstico»: el spec ya
lo es, y el día que el seed E2E traiga un set con logo basta **borrar el guardarraíl**. Interceptar las
imágenes no es la parte mock — la geometría es una propiedad del CSS y hay que forzar proporciones que un
CDN de terceros no sirve a la carta.

Verificado además que el pase **no rompe lo que ya existía**: `e2e/master-set.spec.ts` y
`e2e/buylist.spec.ts` (los que recorren el índice del cotizador) pasan — **20 pruebas E2E verdes** en total.

### 7. Consulta abierta para ux-ui (no toco §24)

§24.4 declara para `lg` una placa de **~216×144**. En el cotizador sale de **116×77**, y a 640 sale de
**181×121**: es decir, **en `lg` la placa es más pequeña que en móvil**. La causa no es la placa sino la
retícula: el número de columnas está atado al **viewport** (`sm:grid-cols-3 lg:grid-cols-4`) mientras que
la retícula del cotizador vive en una **columna estrecha** (~560px a viewport 1024), así que las 4 columnas
entran donde §24.4 asumía 4 columnas de una página ancha. Las cifras de §24.4 describen el índice de M1 y
la bóveda, no el cotizador.

**No lo cambio yo.** La corrección natural sería contar columnas por **contenedor** en vez de por viewport
(la placa ya usa `container-type` para su monograma), pero §24.4 está escrita en anchos de viewport y
tocarlo es decisión de ux-ui. Queda como pregunta con las medidas encima de la mesa.

### 8. Tercera ronda: los dos defectos que el propio spec traía dentro (N-1, N-2, N-4) — 2026-09-02

QA aprobó los bloqueantes (los volvió a medir en navegador, incluido un caso que yo no había probado:
**imagen en caché**, donde `onLoad` puede no dispararse — sin monograma pegado). Pero encontró **dos
defectos en el spec que escribí para cerrar el falso verde anterior**. No se mergean: ese archivo es la
única defensa de esta clase de defecto y **contenía otro**.

**N-1 · La prueba del 404 era un FALSO VERDE.** QA borró el `onError` **entero** del componente y el spec
dio **5 passed**. Causa: mi propia corrección del falso rojo de «Top Bounties». La víctima se elegía como
*«la primera teja que no tiene imagen»* — pero el fixture ya trae **dos sets legítimamente sin logo**, así
que sin `onError` la víctima conservaba su `<img>` rota y el selector se iba a *Sword & Shield*, que nunca
tuvo logo: las tres aserciones pasaban **sin haber tocado a la víctima**. Acertaba solo por accidente
(el primer set con logo era también el primero del DOM). **Cambié un falso rojo por un falso verde**, en
la prueba que existe para impedirlos.

**Arreglo:** la víctima se ata **por identidad**. Se descubren del DOM (a) la primera teja **con** logo —su
nombre y su URL— y (b) un **testigo**: otra teja con logo que no se toca. Se rompe solo la URL de la
víctima, se recarga, y se le exige el resultado **a ella, localizada por su nombre**:
`toHaveCount(1)` sobre el nombre (si identificara dos tejas, falla en vez de elegir), `img → 0`,
monograma visible. El **testigo** conserva su `<img>` y no tiene monograma: sin esa aserción, un apagón
general de imágenes también aprobaría la prueba. Las dos acotaciones conviven —«solo `li` con placa»
(falso rojo) e «identidad de la víctima» (falso verde)— porque ninguna sustituye a la otra.

**N-2 · El spec servía 2 de las 4 proporciones que decía servir.** `shapeFor` era un `hash(url) % 4`, no
un reparto cíclico. QA instrumentó mi función: `sv8 → 1:1`, `sv6 → 1:1`, `sv1 → 1:1`, `cel25 → 1:2`. Las
**dos apaisadas no se servían nunca**, mientras el título del test, mi comentario y §43 afirmaban que sí.
La colisión era benigna **por suerte** (caía en los dos peores casos); un cambio de ids del fixture podía
mandarlas las cuatro a `1.92:1` —la única que **no** manifiesta B-1— y dejar el test insignia en verde
permanente.

**Arreglo:** reparto por **índice de descubrimiento** (cada URL distinta toma la siguiente forma de la
lista) ⇒ con ≥4 logos se sirven **las cuatro, siempre, por construcción**, y sigue sin depender de qué ids
traiga el catálogo, que era el objetivo del hash. Además el stub **devuelve el mapa** URL→forma y la prueba
lo **afirma** (`Set(servidas) === Set(las cuatro)`) y lo **imprime**: la afirmación del título dejó de ser
una suposición.

**N-4 · La cabecera del archivo de vitest listaba «R1: caja de tamaño fijo»** entre lo que defiende, cuando
el propio archivo declara que no puede medirla. Reescrita: ahora el **límite va arriba y en primer lugar**
—jsdom no hace layout ni carga imágenes, aquí no se verifica NINGUNA geometría— y R1 aparece solo como
«la ESTRUCTURA que lo hace posible», con el puntero al spec de Chromium.

**Verificación de esta ronda** (las dos que pidió el coordinador, más las de regresión):

| Mutación | Resultado |
|---|---|
| **`onError` BORRADO ENTERO** (la mutación con la que QA sacó el falso verde) | **1 roja, y solo esa**: el test del 404, `Expected 0, Received 1` — la víctima conserva su `<img>` rota. En vitest, **2 rojas** más |
| **Reparto por hash** (se reintroduce N-2) | **1 roja**: el oráculo del stub. Reprodujo la instrumentación de QA clavada: `sv8 → 1:1, sv6 → 1:1, sv1 → 1:1, cel25 → 1:2` |
| Sin mutar | **5 verdes**, con `[proporciones servidas] sv8 → 1.92:1 · sv6 → 1.60:1 · sv1 → 1:1 · cel25 → 1:2` impreso |

Suites completas tras la corrección: **967 vitest verdes** · **20 E2E verdes** (`master-set-plate` +
`master-set` + `buylist`) · typecheck y lint limpios.

> **Nota de operación, porque me costó diez minutos de diagnóstico falso.** Al arrancar esta ronda el spec
> dio 3 rojas contra un servidor que yo no había reconstruido: `.next-e2e-mock` **es un artefacto
> compartido** y contenía todavía el build mutado de QA. El `webServer` de `playwright.config.ts` lo
> reconstruye siempre; quien reutilice el servidor a mano (`E2E_BASE_URL` + `next start`) **tiene que
> rebuildear primero**, o está midiendo el código de otro. Dicho de otro modo: aquellas 3 rojas eran
> correctas — mis pruebas detectaron una mutación que yo no sabía que estaba puesta.

---

## v1.51.5 · D43 + D36/D37 — el cotizador dice el envío EN PALABRAS, conserva el faltante del mínimo y exige dirección de origen (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

**Por qué este pase salió ANTES que el de backend (precedencia BL-11).** `POST /buylist/requests`
está vivo en producción y gana un campo **obligatorio** (`addressId`). El `ValidationPipe` con
whitelist **descarta** lo que no conoce ⇒ **front nuevo contra backend viejo funciona** (el
`addressId` se ignora y la solicitud nace sin snapshot, recuperable con
`PATCH …/pickup-address`); **backend nuevo contra front viejo rompe TODAS las altas**. El orden no
es una preferencia: es la única secuencia sin ventana rota.

### 1. Lo que se BORRÓ (y el hallazgo: casi todo ya no existía)

| Lo que D43 manda retirar | Estado real en el código |
|---|---|
| La línea «Envío que ponemos nosotros − MX$…» | **Nunca existió.** El cotizador jamás implementó la aritmética de v2.3 |
| La resta y el neto `RECIBIRÍAS ≈` | **Nunca existió** |
| `buylist.quote.money.shippingOnUs`, `…youWouldGet`, `…money.rule` | **Ausentes en los dos catálogos** (verificado con `grep`). El test de paridad queda en verde **con las tres ausentes en ES y EN**, que es lo que §23.12 exige |
| `shippingFeeCents` leído por una pantalla pública | **Ningún consumidor.** Los usos que quedan son de *checkout* y *retiros* (tarifa que el COMPRADOR paga), otro eje de dinero |

Lo que sí se borró de verdad:

1. **`buylist.totalEstimated` («Total estimado»)** — retirada de los dos catálogos y sustituida por
   **`buylist.quote.money.cardsValue`** («Valor de tus cartas» / "Value of your cards"), el único
   rótulo de monto del bloque (§23.12). Se aplica en las **dos** superficies de cotizador: el
   carrito (drawer móvil y panel fijo de escritorio comparten `SellCartContents`) y el resumen del
   paso de crear.
2. **La primera cláusula de `buylist.trustShipping`** — decía *«Tú cubres el envío de tus cartas
   hacia nosotros»* / "You cover the shipping of your cards to us". Eso **contradice PROJECT.md**
   (D16/D31: *«SIEMPRE ponemos la guía y SIEMPRE se descuenta»*), y con la nota de §23.3d en la
   misma página el vendedor leía dos afirmaciones opuestas. Se eliminó **solo esa cláusula** (no se
   redactó copy nuevo); sobrevive intacta la parte de la devolución NM a su costo, que sigue siendo
   cierta. **Queda señalado a PO/ux-ui abajo.**

### 2. La nota de servicio — `BuylistShippingNote` (`src/components/domain/BuylistShippingNote.tsx`)

Un párrafo, **una sola clave** (`buylist.quote.shippingNote`), **sin placeholders** y sin ninguna
cifra. Propiedades que el componente hace verificables:

- **No recibe props de datos**: es imposible que espere a una llamada, que se esqueletice o que
  aparezca/desaparezca con el estado del carrito. Se pinta desde el primer render, **incluso con el
  carrito vacío**, y con el mismo texto por encima y por debajo del mínimo (§23.9).
- **Tinta (`text-text`), `text-sm`, sin icono, sin caja, sin regla**: solo aire (`mt-3`) la separa
  del monto. Un escalón de superficie la convertiría en «aviso» y §23.3c ya explicó por qué no.
- **No es región `aria-live`** y no se trunca (sin `line-clamp`, sin «ver más»).
- Se monta en las dos superficies de §23.3g: dentro del bloque de dinero del carrito
  (`data-testid="sell-cart-money"`) y en el paso de crear, **antes del botón**, junto a la condición
  NM (`BuylistKycForm`).

### 3. El faltante del mínimo — se queda, y con el número del servidor

- **`useQuotePolicy`** (`src/app/[locale]/(storefront)/buylist/useQuotePolicy.ts`) pide
  `GET /buylist/quote-policy` **al montar el cotizador**: `staleTime: 0` + `refetchOnMount: 'always'`
  + **`gcTime: 0`**, es decir *no hay store de vida larga entre navegaciones* — el contrato lo norma
  por la caché pública de 5 minutos.
- **`minimumShortfallCents(min, total)`** es la ÚNICA resta autorizada, aislada y probada aparte
  (borde **inclusivo**: exactamente el mínimo procede, criterio 158a). La otra resta
  (`neto ≈ total − tarifa`) no está prohibida solo por disciplina: **la tarifa no viaja**.
- **`BuylistMinimumShortfall`** pinta *«Te faltan {amount} para el mínimo de {amount}. Agrega otra
  carta.»* en tinta, y el CTA queda **apagado pero no mudo** (`aria-describedby` → el texto que
  explica y da el remedio, §15.9).
- **El cruce se anuncia una sola vez** (`aria-live="polite"`, *«Ya alcanzaste el mínimo de …»*), solo
  en la transición debajo→arriba, y **sin mencionar envío ni neto**. La nota nunca entra en la live
  region.
- **Fail-OPEN, y es la decisión que más importa:** si la llamada falla (red/5xx/429),
  `minimumRequestCents` queda `undefined` ⇒ **no se pinta faltante, no se inventa ningún número y el
  CTA sigue HABILITADO**. Apagarlo sería fail-closed: bloquearía a un vendedor legítimo por un error
  de red cuando la puerta real —el `422 BUYLIST_MINIMUM_NOT_MET`— ya protege el invariante y responde
  con el número exacto. En el paso de crear, ese `422` **repinta con `details.minimumCents` /
  `details.shortfallCents`**: *la pantalla informa; la puerta decide.*

### 4. `addressId` obligatorio y EXPLÍCITO

- `CreateSellRequestInput.addressId` pasa a ser **requerido en el tipo**: un cliente que lo olvide no
  compila.
- **`BuylistPickupAddressField`** reusa la libreta que ya existe (`GET`/`POST /users/me/addresses`):
  con direcciones guardadas, **`Select` con la predeterminada preseleccionada** (el recurrente no
  teclea nada); sin ninguna, **alta INLINE** (nunca un modal encima del modal) que **queda en su
  libreta**. La preselección es **comodidad de pantalla**: el id viaja siempre explícito en el body.
  **No hay fallback silencioso a `isDefault`** — la libreta tiene N filas y elegir por el vendedor es
  elegir de dónde salen sus cartas.
- Para no duplicar la validación de CP/teléfono se extrajeron de `AddressManager` **`useAddressForm`
  + `AddressFormFields`** (refactor mecánico; el modal de la libreta los consume igual). `buylist`
  **no** abre un segundo camino de alta de domicilios.
- **Errores nuevos, inline en el campo (nunca toast):** `422 PICKUP_ADDRESS_REQUIRED` y
  `422 PICKUP_ADDRESS_NOT_FOUND`. El segundo **limpia la selección e invalida la libreta** (refrescar
  y volver a elegir); los dos casos del contrato comparten respuesta a propósito (anti-IDOR) y la UI
  no intenta distinguirlos.
- Sin dirección, el botón de crear está **apagado con `aria-describedby`** al «por qué»
  (*«La necesitamos para imprimir la guía que te vamos a mandar.»*), que además está **siempre**
  visible, no solo cuando bloquea.

### 5. Espejo mock (`src/lib/api.ts` + `src/lib/mock/fixtures.ts`)

- `getBuylistQuotePolicy()` — rama real `GET /buylist/quote-policy`; rama mock devuelve
  `fx.mockBuylistQuotePolicy` (**un** entero). El valor sembrado vive en *fixtures*, es decir del
  lado del **servidor falso**: la ruta real nunca tiene un default «por si acaso».
- `createSellRequest()` mock replica las **tres puertas**: `PICKUP_ADDRESS_REQUIRED` (sin id),
  `PICKUP_ADDRESS_NOT_FOUND` (id que no está en la libreta) y `BUYLIST_MINIMUM_NOT_MET` sobre el
  **total bruto** con `details: { minimumCents, totalCents, shortfallCents }` (una línea en
  `precio_pendiente` aporta 0).

### 6. i18n (paridad ES/EN verificada por test)

**Altas:** `buylist.quote.money.cardsValue` · `buylist.quote.shippingNote` ·
`buylist.quote.minimum.{shortfall,minimumIs,addAnother,reachedAnnounce}` ·
`buylist.request.address.{label,why,printed,missing}` · `error.PICKUP_ADDRESS_REQUIRED` ·
`error.PICKUP_ADDRESS_NOT_FOUND` · `error.BUYLIST_MINIMUM_NOT_MET`.
**Bajas:** `buylist.totalEstimated`.
**No implementadas (declarado, no silenciado):** `buylist.request.address.change` de §23.12 —
el patrón elegido por la propia §23.3j (un `Select`) hace innecesario un enlace «usar otra
dirección»; se omite para no dejar una clave muerta. Y `buylist.quote.pendingLine.{label,note}`
(§23.3h, versalita `SIN PRECIO`) **no entra en este pase**: cambia el rótulo de las líneas sin precio
en el grid y en el carrito, que es otro alcance; hoy sigue viva `buylist.linePending`.

### 7. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | `Test Files 91 passed (91)` · `Tests 789 passed (789)` |
| Flakes observados (**no** de este pase) | En corridas completas intermedias fallaron **una vez cada uno** `PhotoUploader.test.tsx` y `M2View.test.tsx` (uploader de INE y sync de catálogo en M2 — dos áreas que este pase no toca). **Los dos pasan aislados y en la corrida siguiente**: son inestabilidad de tiempos bajo carga, y queda escrito para que QA no lo descubra como novedad |
| `npm run typecheck` | limpio (sin salida) |
| `npm run lint` | `✔ No ESLint warnings or errors` |
| `npx next build` (en `NEXT_DIST_DIR=.next-verify`, borrado después) | verde |

Cobertura nueva: 6 casos del cotizador en `BuylistView.test.tsx` (nota con carrito vacío, nota con la
política caída, **un solo monto** en el bloque de dinero, faltante + CTA apagado, cruce del mínimo
anunciado, **fail-open**), 6 en `BuylistKycForm.test.tsx` (id explícito, libreta vacía → alta inline
con botón apagado y motivo, `PICKUP_ADDRESS_NOT_FOUND` inline, repintado autoritativo del `422`,
faltante preventivo, la nota antes del botón), 5 del espejo mock en `api.test.ts` y 4 de la resta
autorizada en `useQuotePolicy.test.ts`. E2E (`e2e/buylist.spec.ts`) actualizado: rótulo nuevo, nota
con carrito vacío, `ensureMinimumReached` (sube cantidad hasta cruzar el mínimo **sin hardcodearlo**)
y `choosePickupAddress` (preselección, o alta inline contra un stack sin libreta).

### 8. Señalado a otros roles (no resuelto aquí)

1. **PO / ux-ui — `buylist.trustShipping` decía lo contrario de D16/D31** (ver §1.2). Quité la
   cláusula falsa; **el texto de reemplazo, si lo quieren, es suyo**.
2. **PO / ux-ui — `safeShipping.step4Body`** («Guía con seguro: asegura por el valor cotizado…»)
   sigue instruyendo al vendedor a **comprar y asegurar la guía**, que bajo D16 ponemos nosotros. No
   lo toqué: la guía de empaque es copy de producto y su reescritura pertenece al pase del ciclo de
   adquisición (§23.4/§23.5), no a éste.
3. **ux-ui — el cotizador del HOME rotula su total `home.quoter.wePay` («Te pagamos»)**. §23.3c
   prohíbe en el bloque de dinero cualquier rótulo que **prometa depósito** —y bajo D43 lo que se
   deposita es el neto—, pero §23.3g no lista esa superficie. **No lo cambié**: decidir si el teaser
   del home es «cotizador» a efectos de §23.3 es de ux-ui.
4. **Arquitecto — sin petición de contrato.** `GET /buylist/quote-policy` y el `addressId` de
   `POST /buylist/requests` alcanzaron para todo lo de este pase; no hizo falta ningún campo nuevo ni
   ningún dato mock sin contrato.

---

## v2.3.2 · §23.14 — el pase de copy: retirar la línea que le costaba dinero al vendedor (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> Ejecuta **DESIGN_SYSTEM §23.14** (commit `195261e`), incluida su nota 4 a frontend (§23.14.7-4).
> **Cero componentes nuevos. Cero claves nuevas.** Se **retiran dos** y se **reutilizan dos** que ya
> existían. El pase anterior (§ v1.51.5, arriba) reportó tres de estas contradicciones y **no las
> tocó** porque el copy es de ux-ui; §23.14 las resolvió y encontró cuatro más.

### 1. Lo que estaba en juego, en una línea

`safeShipping.step4Body` decía *«Asegura por el valor cotizado…»* mientras que bajo **D16/D31 la
guía la ponemos nosotros y su costo se descuenta del pago**. Un vendedor que **obedecía ese paso
compraba y aseguraba una etiqueta que ya venía incluida: pagaba dos veces.** Era la única línea del
producto que le costaba **dinero real** a quien la seguía. Todo lo demás de este pase es del mismo
tipo —texto escrito antes de una decisión que cambió **quién paga**— pero solo esa cobraba.

### 2. Las siete cadenas, y qué se hizo con cada una

| Clave | Antes (resumen) | Ahora | Superficie |
|---|---|---|---|
| `safeShipping.step4Title` | «Guía con seguro» | «La guía la ponemos nosotros» | modal + sección inline |
| `safeShipping.step4Body` | «Asegura por el valor cotizado y anota tu número de solicitud.» | quién pone la etiqueta + **que se descuenta** + las tres prohibiciones | idem |
| `safeShipping.intro` | hablaba de **disputas** (remedio del *comprador*) | la política **NM-only**, que además cierra el hueco de **AC 34 en el modal** | idem |
| `safeShipping.title` · `buylist.shippingGuideLink` | «Guía de envío seguro» | «Cómo empacar tus cartas» | enlace del hero, título del modal, `h2` inline |
| `safeShipping.step3Body` | — | hereda «una hoja con tu número de solicitud» del paso 4 viejo | idem |
| `buylist.estimateNote` | «el monto final lo confirma la plataforma **cuando recibimos y verificamos**» | «los precios se mueven y puede que no compremos todas las líneas; lo firme va en la oferta» | bloque de dinero del carrito |
| `buylist.trustValidity` | «el monto final se confirma con los **precios vigentes al verificar**» | «el **precio** vinculante es el de la oferta, y **ese precio ya no se mueve**» | pie de `/buylist` + resumen de crear |
| `buylist.created` | «te avisaremos **cuando recibamos tu carta**» | «**no mandes tus cartas todavía**: primero aceptas la oferta y después te llega la guía» | aviso `role="status"` |

**Las dos retiradas** (de **los dos** catálogos — una clave viva en un solo idioma es el modo típico
en que un texto retirado revive, y `i18n-parity.test.ts` lo caza):

- **`home.quoter.wePay`** («Te pagamos»): rotulaba con una **promesa de depósito** un bruto del que
  se descuenta el envío. El total del teaser pasa a **`buylist.quote.money.cardsValue`**, la **misma
  clave** del carrito y del resumen de crear. *No se creó `home.quoter.cardsValue`*: un segundo
  string con el mismo significado es el mecanismo exacto por el que este rótulo se desincronizó.
- **`buylist.trustShipping`**: el remanente que dejé en el pase anterior era un **recorte**, no texto
  escrito a propósito — un eco degradado de `nmOnlyBody`, que está dos párrafos arriba y lo dice con
  más detalle. El bloque de confianza del pie baja a **dos párrafos** (`trustPayment`, `trustValidity`)
  y no pierde información.

### 3. Dónde quedó la nota del envío (las dos superficies nuevas de §23.3g)

`BuylistShippingNote` ya existía; lo nuevo es **dónde se monta**.

| Fila | Sitio exacto | Detalle que no es cosmético |
|---|---|---|
| **0 · teaser del home** (`HomeQuoterPanel`) | cuerpo del panel, **después** del bloque de dinero (o del estado vacío) y **antes** de «Continuar mi cotización» | Va **fuera de los dos brazos del ternario** ⇒ se pinta con cero líneas y con líneas. Y **fuera de `withTrust`**: esa banda es `false` en la sección de 390px, y **una regla de dinero que solo existe en escritorio no es una regla** |
| **1-bis · cabecera de `/buylist`** (`BuylistView`) | justo debajo de `payAfterReceipt`, antes del enlace de la guía | **Tinta `text-sm`**, sin `muted`, sin `rule-note`, sin caja (§23.3c: al mismo nivel visual que los montos). Motivo decisivo: **en móvil el carrito es un drawer cerrado**, así que sin esta instancia se recorre `/buylist` entera sin leer la regla |

**Repetición aceptada:** en escritorio `/buylist` muestra la nota **dos veces** (cabecera + panel
fijo del carrito). Es **el mismo string, carácter por carácter** — el test lo afirma con un `Set` de
`textContent` de tamaño 1. Una regla de dinero repetida es redundancia; **dos redacciones distintas
de la misma regla** sería el defecto.

### 4. Lo que NO se tocó, y por qué (para que nadie lo «arregle» después)

- **`safeShipping.step1*` / `step2*` / `understood`** — **AC 34 exige** las palabras *funda/sleeve* y
  *top loader*. Reescribirlos «por consistencia» rompe un criterio de aceptación. Hay test.
- **`payAfterReceipt` · `cartFooterNote` · `trustPayment`** — **siguen siendo ciertas**. El pago sí
  ocurre tras verificar; lo que no ocurre es **repreciar**. *Cuándo se paga* ≠ *cuándo se fija el
  monto*: esa distinción es justo lo que arreglan `estimateNote` y `trustValidity`.
- **`home.bounties.wePay` / `buylist.bounties.wePay`** — es un **precio POR CARTA**, no una suma. La
  regla nueva es que pierden el verbo de pago **los rótulos de sumas**, no las tarifas.
- **`withdrawals.*` · `checkout.*` · `shipmentStage.*`** — **el envío del COMPRADOR**, que sí paga el
  suyo. Otro eje de dinero; D16 no lo toca. `withdrawals.shippingFee` es legítima.
- **`grading.*`** — otro dominio (§22) y otra decisión.
- **`buylist.adjust.*`** — ux-ui lo señaló como **posible pantalla muerta** (D30 disuelve la
  re-confirmación; D9 mata el repreciado) y **está pendiente de dictamen del arquitecto**. Sin ese
  dictamen no se retira: borrar UI viva por inferencia es peor que dejar copy dudoso un ciclo más.
- **`buylist.subtitle` · `home.sellBody`** — §23.14.4d los marca **mejora opcional, no
  contradicción**, y la decisión es del **PO**.

### 5. Archivos tocados

| Archivo | Qué |
|---|---|
| `frontend/messages/{es,en}.json` | 10 cadenas reescritas · 2 claves retiradas (paridad estricta) |
| `frontend/src/components/domain/SafeShippingGuide.tsx` | **solo documentación**: el copy vive en el catálogo. Se escriben los invariantes (AC 34, la resta del paso 4, sin cifras, sin `line-clamp`) |
| `frontend/src/app/[locale]/(storefront)/_home/HomeQuoter.tsx` | rótulo → clave compartida; `BuylistShippingNote` en el cuerpo, fuera de `withTrust` |
| `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` | `BuylistShippingNote` bajo `payAfterReceipt`; `<p>{t('trustShipping')}</p>` borrado |
| `frontend/src/app/[locale]/(storefront)/buylist/SellCartContents.tsx` | solo comentario (el de `estimateNote` documentaba la promesa retirada) |
| `frontend/src/components/domain/SafeShippingGuide.test.tsx` | **nuevo** · 11 casos, ES y EN |
| `.../page.test.tsx` · `.../BuylistView.test.tsx` · `e2e/buylist.spec.ts` | cobertura de las superficies nuevas |

**Ningún componente nuevo. Ninguna clave nueva. `backend/` intacto.**

### 6. Cobertura añadida

- **`SafeShippingGuide.test.tsx` (nuevo, 11 casos ES+EN):** el paso 4 dice quién pone la etiqueta y
  **que se descuenta**; **nunca** aparece «asegura/insure» como instrucción al vendedor; D43 (sin
  monto, sin rango, sin «gratis»); **AC 34** (funda/sleeve, top loader, `intro` con Near Mint); el
  número de solicitud sobrevive en el paso 3; sin `line-clamp` ni altura fija.
- **`BuylistView.test.tsx`:** la regla se lee en la **cabecera con el carrito cerrado** (1 instancia);
  con el drawer abierto son **2 instancias con el mismo texto**; el bloque de confianza queda en dos
  párrafos **sin** el eco retirado, con `trustValidity` afirmando que **el precio** no se mueve.
- **`page.test.tsx`:** la nota en **las dos** instancias del teaser (incluida la de móvil sin banda de
  confianza), con cero cartas y con cartas; el total rotulado «Valor de tus cartas» y «Te pagamos»
  **ausente del documento**.
- **`e2e/buylist.spec.ts`:** el modal de empaque afirma el paso 4 y la resta y **no** dice «asegura
  por»; `/buylist` a **390px con el carrito cerrado** lee la regla en la cabecera; el **teaser del
  home** en 1280 y en 390 (dos viewports, un test cada uno).

### 7. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | `Test Files 92 passed (92)` · `Tests 803 passed (803)` |
| `npm run typecheck` | limpio (sin salida) |
| `npm run lint` | `✔ No ESLint warnings or errors` |
| Flakes conocidos (`M2View`, `PhotoUploader`) | **no se dispararon** en esta corrida completa |

Los tres fallos intermedios que sí hubo eran **consecuencia correcta del cambio**, no roturas:
`page.test.tsx` afirmaba el rótulo «Te pagamos» retirado, y dos casos de `BuylistView.test.tsx`
usaban `getByTestId('buylist-shipping-note')` cuando ahora hay **dos** instancias en `/buylist`.
Ambos se actualizaron a la realidad normativa nueva (no se relajaron: se ampliaron).

### 8. §23.14.6 — el resultado de los `grep` normativos

1. **Afirmación prohibida** (`por tu cuenta` / `a tu costo` / `at your cost` / `on you`): cuatro
   supervivientes, **todas legítimas** — `grading.microNotice`, `grading.p5`, `buylist.nmOnlyBody` y
   `safeShipping.intro`. Ninguna otra.
2. **Paridad de las retiradas:** `home.quoter.wePay` y `buylist.trustShipping` **no existen en
   ninguno de los dos catálogos**, y ningún componente las referencia (las tres apariciones que
   quedan del identificador son **comentarios** que explican la retirada).
3. **Promesa de depósito sobre una suma** en `home.quoter.*` / `buylist.quote.*`: cero rótulos. Ver
   la nota 2 de §9 sobre la calibración de este `grep`.

### 9. Señalado a otros roles (no resuelto aquí)

1. **Arquitecto — `buylist.adjust.*` sigue esperando dictamen.** §23.14.7-2 pide confirmar si el
   estado `ajustada` sigue vivo. El catálogo mantiene un modal completo
   (`adjust.{title,body,newTotal,accept,decline,error}`) cuyo cuerpo dice *«Tras la verificación
   ajustamos el precio de una o más cartas»* — **la misma contradicción con D9 que este pase acaba de
   cerrar en `estimateNote` y `trustValidity`, pero con UI detrás**. Retirar la pantalla es mío; **decidir
   si el flujo existe es del arquitecto**. Lo dejo intacto y visible, no lo borro por inferencia.
2. **ux-ui — el `grep` 2 de §23.14.6 está mal calibrado** (nota menor, sin efecto en lo entregado).
   Tal como está escrito, `Te pagamos` / `We pay you` sobre `buylist.quote.*` marca
   **`buylist.quote.shippingNote`**, que contiene *«se descuenta siempre de lo que **te pagamos**»* —
   y esa cadena es **normativa e intocada** (§23.3d, citada carácter por carácter en el mock-up de
   §23.3g). El criterio real es *«rótulo que promete depósito **sobre una suma**»*, no la frase suelta.
   Es el mismo tipo de falso positivo que §23.14.5 ya anticipa para `withdrawals.shippingFee`.
3. **PO — tres textos de este pase son los «sensibles» que §23.14.7-1 pide ratificar**
   (`safeShipping.step4Body`, `estimateNote`, `buylist.created`). Están implementados **tal cual**
   §23.14; si el PO los matiza, es un cambio de catálogo de una línea por clave.
4. **Arquitecto — sin petición de contrato.** Este pase es 100 % copy y montaje: **ningún endpoint,
   ningún campo, ningún mock**. No quedó ningún `// MOCK: pendiente de contrato` abierto.

---

## v1.51 · §4.39c sitio 9 — la quinta copia del set terminal: se borra consumiendo `isTerminal` (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> Ejecuta **ARCHITECTURE §4.39(c) sitio 9** («`M5View.tsx` borra su literal. **No lo sustituye por
> otra constante de frontend: el backend le dice**») y **API_CONTRACT §M5/§11 v1.51**. Toca además
> lo que el mismo crecimiento del enum dejó **invisible**: DESIGN_SYSTEM §23.1a/§23.1d y §23.2a.

### 1. El hallazgo, y por qué tenía DOS daños y no uno

`M5View.tsx:110` mantenía `REQUEST_TERMINAL = new Set<SellRequestStatus>(['pagada','rechazada',
'abandonada'])` — la **quinta de cinco copias** del set terminal y la única fuera del backend. El
enum creció a **cuatro** terminales (criterio 113) y la copia se quedó en tres. Los dos daños son
distintos y ninguno falla en compilación:

| # | Daño | Cómo se manifestaba |
|---|---|---|
| 1 | **La acción imposible** | `canRejectRequest` (`:780`) daba `true` sobre una `expirada` ⇒ la pantalla ofrecía «Rechazar solicitud» y el servidor contestaba **409** |
| 2 | **La desaparición silenciosa** | `visible = filtered.filter(r => activeStatuses.includes(r.status))`. `ofertada`, `aceptada` y `en_transito` **no estaban en ninguna pestaña**, y `expirada` tampoco: **no salían en ninguna vista de M5** — sin error, sin aviso, sin test rojo |

El daño 2 es el peor de los dos porque es **latente**: hoy nada escribe esos estados, así que la
pantalla se ve bien. Deja de verse bien el día que el ciclo se encienda, que es exactamente cuando
nadie estará mirando esto.

### 2. `isTerminal`: sí se consiguió consumir, y en las DOS proyecciones

El backend ya lo emite server-derived en las tres proyecciones (verificado en
`buylist.service.ts:123`, `:1280`, `:1526`). El frontend **no tenía ni una sola lectura del campo**.

- **`M5View.tsx`** — `REQUEST_TERMINAL` **borrado**. `canRejectRequest = req.isTerminal === false &&
  allItemsRejected`.
  **`=== false` y no `!req.isTerminal`, a propósito:** si el campo faltara (backend anterior a
  v1.51), fallar hacia «no ofrecer la acción» le quita al operador un botón; fallar al revés le
  ofrece un cierre que el servidor rechaza. **Fail-closed**, como todo lo que toca el cierre de una
  solicitud. Hay test dedicado para esa dirección.
- **`MyRequestsSection.tsx:105`** — era `errored={r.status === 'rechazada' || r.status ===
  'abandonada'}`: **otra derivación local**, esta vez del set «terminal NO feliz». Pasa a
  `r.isTerminal && r.status !== 'pagada'`. Lo único que queda escrito es el **único terminal
  feliz**, que es un literal suelto y no un subconjunto que haya que mantener.
- **`SellRequestDTO.isTerminal` y `AdminBuylistDTO.isTerminal` son OBLIGATORIOS**, no opcionales.
  Si fueran opcionales, cada consumidor escribiría un `?? <adivinanza local>` y **la copia volvería
  disfrazada de default**. Hay candado de tipo que lo fija.

### 3. Dónde quedaron los cuatro estados nuevos en M5 — y el candado que impide la próxima desaparición

El arreglo **no** fue añadir cuatro literales más a tres listas. El filtro por pestañas se derivó de
una **asignación TOTAL** `Record<SellRequestStatus, M5TabAll>`:

| Estado nuevo | Pestaña | Por qué |
|---|---|---|
| `ofertada` | **`ciclo`** (NUEVA — «Ciclo de oferta» / «Offer cycle») | oferta vinculante afuera, el reloj es del vendedor |
| `aceptada` | **`ciclo`** | dijo que sí; **nada viaja todavía** (§23.1b, criterio 156) |
| `en_transito` | **`ciclo`** | un paquete viaja de verdad |
| `expirada` | **`cerradas`** | es el **cuarto terminal** (criterio 113); entra al CSV `status=pagada,rechazada,abandonada,expirada` |

`Record<SellRequestStatus, …>` convierte la desaparición silenciosa en **error de compilación**:
añadir un valor al enum del contrato deja de compilar M5 hasta que alguien decida dónde vive.
`M5_OP_TABS` y `M5_CLOSED_STATUSES` se **derivan** de ese mapa; no se escriben dos veces.

**Por qué UNA pestaña y no tres.** Los tres son estados de **monitoreo** desde esta cola. Las colas
con acción propia del ciclo (por autorizar, por confirmar envío, guías por cancelar, vendedores
vivos) son **vistas aparte** con endpoints propios (§23.8) y todavía no están montadas. Y `aceptada`
**no** se agrupó bajo ningún rótulo que diga «en camino»: aceptar no mueve nada, y llamarlo así
repetiría el error conceptual que el criterio 156 existe para evitar.

### 4. Las otras derivaciones locales del mismo tipo, y qué se hizo con cada una

| Sitio | Qué codificaba | Resolución |
|---|---|---|
| `M5View.tsx:110` `REQUEST_TERMINAL` | set terminal (3 de 4) | **BORRADO** — se consume `isTerminal` |
| `MyRequestsSection.tsx:105` `errored` | terminal-no-feliz (2 literales) | **DERIVADO** de `isTerminal` |
| `pipelines.ts` `useBuylistSteps` | pipeline de **CINCO** pasos | **OCHO** (§23.2a). Con cinco, una solicitud `ofertada`/`aceptada`/`en_transito` caía en `currentIdx === -1` y **el stepper no marcaba ningún paso**: el estado desaparecía también de ahí |
| `status-map.ts` `sellRequest` | **siete** de once estados | los cuatro nuevos, con los tonos de §2.4/§23.1a |
| `contract.ts` `SellRequestStatus` | **siete** valores | los **once** del contrato §Enums |
| `M5_CLOSED_STATUSES` | CSV terminal escrito a mano | derivado del mapa total |

**`expirada` se pinta por su MOTIVO, no por su estado (§23.1d).** Es la única excepción de mapeo del
sistema y es obligatoria: `not_shipped` acusa al vendedor y `no_offer` **nos acusa a nosotros**.
`getBadgeSpec(domain, value, reason)` busca primero la fila refinada y cae al **fallback neutro**
—nunca al acusatorio— cuando el motivo falta. Rótulos bajo `status.sellRequestExpiry.{not_shipped,
no_offer,unknown}` (las **tres** claves de §23.12, no bajo `status.sellRequest.*`).

### 5. El mock es el SERVIDOR falso, y ahí vive la única derivación que queda

`isTerminal` es server-derived, así que **no puede vivir en una fixture**: las ramas mock **mutan**
el `status` en memoria (`respondSellRequest`, `paySpeiBuylist`, `rejectBuylistRequest`…) y un
booleano guardado se quedaría mintiendo en cuanto la solicitud cambiara de estado. Las fixtures
guardan **filas** (`MockSellRequestRow`, `MockAdminBuylistRow`) y las proyecciones
`mockSellRequestDTO` / `mockAdminBuylistDTO` ponen el campo al responder, igual que el backend real.

Eso deja **una** derivación del set terminal en el frontend, en `src/lib/mock/fixtures.ts`, espejo
de `backend/src/common/sell-request-states.ts`. **No es la copia que §4.39c mandó borrar:** aquélla
la consultaba una VISTA para decidir botones **teniendo el dato del servidor a mano**; ésta existe
porque en modo mock **no hay servidor que lo derive**. Ninguna pantalla la importa, y el candado de
§6 falla si alguna lo hace.

### 6. El candado (`src/types/sell-request-status.test.ts`)

Mismo patrón que `sealed-subtype.test.ts` (T-1, §22). Cuatro propiedades:

1. **Tipo:** la unión del front cubre **exactamente** los once valores del contrato §Enums, en las
   dos direcciones (falla en `tsc`, no solo en runtime).
2. **Tipo:** `isTerminal` es **obligatorio** en los dos DTOs — si se volviera opcional, su tipo
   pasaría a `boolean | undefined` y las asignaciones no compilarían bajo `strict`.
3. Los once resuelven a badge propio con rótulo en **ambos** catálogos; diez bajo
   `status.sellRequest.*` y `expirada` bajo `status.sellRequestExpiry.*`.
4. **Nadie declara una lista LITERAL de estados fuera de `contract.ts`** (patrón
   `new Set<SellRequestStatus>([…])` / `: SellRequestStatus[] = […]`). Las listas **derivadas** no
   matchean: derivar es legítimo, transcribir a mano es la deuda. Única excepción, **nombrada en el
   test en vez de escondida**: `src/lib/mock/` (el servidor falso).
   **Verificado que falla:** reintroduciendo el `REQUEST_TERMINAL` original, el test rojo nombra el
   archivo culpable.

### 7. i18n (paridad ES/EN verificada por test)

Claves **nuevas**, las mismas de DESIGN_SYSTEM §23.12:
`status.sellRequest.{ofertada,aceptada,en_transito}` ·
`status.sellRequestExpiry.{not_shipped,no_offer,unknown}` · `admin.m5.tabs.ciclo`.
`status.sellRequest` queda con los **diez** que lista §23.12 (sin `expirada`, que rotula por motivo).

### 8. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | `Test Files 93 passed (93)` · `Tests 822 passed (822)` (base: 92/803) |
| `npm run typecheck` | limpio (sin salida) |
| `npm run lint` | `✔ No ESLint warnings or errors` |
| Flakes conocidos (`M2View`, `PhotoUploader`) | **no se dispararon** en las dos corridas completas |

### 9. Lo que NO se tocó, y por qué (para que nadie lo dé por hecho)

1. **§23.2b-e — el rediseño de `PipelineStepper`.** Se implementó **solo el mapa** (§23.2a: cinco
   pasos → ocho). El **truncado en terminal** con la versalita del motivo colgando, los tres
   breakpoints, la vertical con timestamps del portal y las claves
   `buylist.stepper.{1..8}.label` / `buylist.stepper.closed.*` son rediseño del componente y
   pertenecen al pase del ciclo. Hoy una solicitud terminal simplemente no marca paso actual, que
   es el **comportamiento previo** (no una regresión nueva).
2. **§23.8 — las cuatro colas nuevas de M5** (`offers/pending-authorization`,
   `pending-shipment-confirmation`, `guides/pending-cancellation`, `live-sellers`) y la **mesa de
   decisión** (§23.6). Son endpoints que el backend aún no expone.
3. **El rótulo `admin.m5.tabs.por_recibir` («Por recibir»).** §23.1a ratifica que `cotizada`
   **cambió de sentido** en v2.3: ya no es «llegó y algún día se verá», es **«te debemos una
   respuesta»**. El rótulo quedó describiendo lo que ya no significa. **No lo renombré**: es copy,
   y el pase que lo cambie debería cambiarlo con el resto del vocabulario del ciclo. Ver §10-2.
4. **`ITEM_TERMINAL` (`M5View.tsx`) y `RESOLVED` (`M8View.tsx`).** Son subconjuntos de
   `SellItemStatus` y `DisputeStatus`, **dos enums que v1.51 NO toca** (el contrato lo dice con
   todas sus letras para `SellItemStatus`). Misma clase de deuda, **cero radio de este cambio**.
   Se dejan y se señalan.

### 10. Señalado a otros roles (no resuelto aquí)

1. **Arquitecto — `live?` está en el contrato pero el backend no lo implementa.** §M5 v1.51 define
   `live=true|false`, que filtra los terminales **por exclusión server-side** y volvería innecesario
   incluso el CSV que M5 manda hoy (`grep live` en `backend/src/modules/buylist/` no devuelve nada).
   Mientras tanto la pestaña «Cerradas» sigue mandando `status=` CSV, que **enumera** los cuatro
   terminales. **Es correcto pero no es la forma final**, y está anotado en el código. En cuanto el
   parámetro exista, esa enumeración se retira.
2. **Arquitecto — `canPay` es una sexta copia, y ésta NO tiene contraparte server-derived.**
   `M5View.tsx` deriva `canPay = isSuperAdmin && (status === 'aprobada' || status ===
   'verificacion')`. Ese par es exactamente `SELL_REQUEST_PAYABLE_STATES` (ARCHITECTURE §4.39c
   **sitio 8**), y el frontend lo transcribe a mano igual que transcribía el terminal. **A
   diferencia de `isTerminal`, el contrato no expone ningún booleano equivalente**, así que no
   había forma de curarlo sin inventarme un campo. Toca dinero saliente. **No lo cambié**: si
   quiere el mismo remedio, es un campo derivado en `AdminBuylistDTO` (p. ej. `isPayable`), y esa
   decisión es del arquitecto.
3. **Arquitecto — ambigüedad menor de alcance en §6.** El bloque de notas de `isTerminal` dice *«la
   proyección de CLIENTE»* y cuelga de **dos** encabezados (`GET /buylist/requests` **lista** y
   `…/:id` **detalle**), mientras que las adiciones vecinas sí distinguen (`pickupAddress` y
   `lastOfferCancelledAt` dicen explícitamente «el DETALLE»). Lo leí como **las dos**, que es como
   lo implementó el backend (`listMine` lo emite). **Lo señalo en vez de resolverlo en silencio**:
   si la intención era solo el detalle, `MyRequestsSection` —que consume la **lista**— se quedaría
   sin el campo.
4. **ux-ui — falta rótulo de pestaña para el tramo del ciclo en M5.** §23.8 especifica las cuatro
   **colas** nuevas, pero no las **pestañas de etapa** de la cola existente. Puse
   `admin.m5.tabs.ciclo` = «Ciclo de oferta» / «Offer cycle» (el nombre que el propio contrato le
   da al tramo) porque **algún rótulo hacía falta para que los tres estados no desaparecieran**.
   Es una clave de una línea por catálogo si ux-ui prefiere otro. Junto con ella, el rótulo
   «Por recibir» de §9-3.
5. **Arquitecto — sin petición de contrato.** Todo lo consumido en este pase existe:
   `isTerminal` y `expiredReason` en las dos proyecciones. **Cero mocks pendientes de contrato**;
   no quedó ningún `// MOCK: pendiente de contrato` abierto.

---

## v2.3.5 · §23.8a — en M5 el rótulo dice DE QUIÉN ES EL PENDIENTE (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> Ejecuta **DESIGN_SYSTEM §23.8a** (nueva, commit `daee187`) + §23.12 v2.3.5 + la verificación
> §23.14.6-3bis. **Cero cambios de conducta**: tres rótulos, tres claves y el **eje** que los
> genera. La estructura del pase anterior (`2f796b5`) **queda ratificada y normada**.

### 1. El eje, que es lo que había que implementar (no las tres cadenas)

§23.8a le da a M5 el criterio que le faltaba: es una **cola de trabajo**, así que sus pestañas
contestan **«¿qué me toca?»**, no «¿en qué estado está el registro?». Dos formas, y no hay tercera:

| Pendiente | Forma del rótulo | Pestañas |
|---|---|---|
| **NUESTRO** (y casi siempre con un reloj en contra) | **«Por + verbo»** — nombra la acción | `por_ofertar`, `por_pagar` |
| **NO nuestro** | nombra **de quién depende**, nunca la acción | `con_vendedor` |

El eje vive **en el código**, no solo en el catálogo: está escrito en el TSDoc de `M5OpTab`, que es
lo primero que lee quien tenga que colocar el próximo estado del enum. Con el eje, los seis rótulos
se derivan solos.

### 2. Los tres rótulos y las tres claves

| Clave | Antes | Ahora |
|---|---|---|
| ~~`por_recibir`~~ ⇒ **`por_ofertar`** | «Por recibir» / "To receive" | **«Por ofertar» / "To offer"** |
| ~~`ciclo`~~ ⇒ **`con_vendedor`** | «Ciclo de oferta» / "Offer cycle" | **«Con el vendedor» / "With the seller"** |
| ~~`rechazadas`~~ ⇒ **`piezas_rechazadas`** | «Rechazadas» / "Rejected" | **«Piezas rechazadas» / "Rejected items"** |

**Las tres viejas se borraron de los DOS catálogos** (paridad estricta, cero coexistencia:
verificado por test). «Verificando», «Por pagar» y «Cerradas» **no se tocaron** — está dicho
explícitamente en §23.8ad y un barrido que cambia de más hace daño nuevo.

**El renombre de `piezas_rechazadas` tenía una consecuencia fuera de `src/`:** `e2e/admin.spec.ts`
resuelve el rótulo **por la clave** (`t('es','admin.m5.tabs.rechazadas')`). Sin actualizarlo, el
spec habría fallado al hacer clic en una pestaña inexistente — es decir, el renombre habría roto
la suite E2E que corre QA, no la de unitarios. Actualizado.

### 3. Acepté la recomendación: los identificadores acompañan al renombre

`M5OpTab` y `M5_STATUS_TAB` son código y la decisión era mía; **los renombré**. La razón es la
misma que justifica renombrar la clave y no solo el texto: ese mapa es exactamente lo que alguien
lee para decidir dónde vive el próximo estado, y un `por_recibir` ahí dentro seguiría diciendo
*«esto es la cola de paquetes»* mucho después de que la pestaña dijera otra cosa. **Dejarlo habría
reintroducido en el código el desfase que se acababa de quitar del texto** — con el agravante de
que el código no lo revisa ux-ui.

Los identificadores **son** las claves i18n, y hay test que lo fija: si alguien renombra el rótulo
sin renombrar el discriminante, se pone rojo.

### 4. La comprobación de §23.14.6-3bis, como aserción positiva

En `M5View.test.tsx`, seis casos. La forma importa: *un estado sin pestaña **no falla, no avisa y
desaparece del back-office***, así que no hay cadena que buscar — se afirma la **partición**.

1. **Partición TOTAL**: el reparto se compara contra la tabla de §23.8a **transcrita a mano**. No
   se recorre `M5_STATUS_TAB` para comprobarlo (se afirmaría a sí mismo). **Verificado que falla:**
   moviendo `en_transito` a otra pestaña, el diff sale en el test.
2. **`aceptada` no comparte pestaña con nada que se lea «en camino»** — la restricción de criterio
   156 que §23.8ab deja viva con el rótulo nuevo, ahora asertada sobre el rótulo real en ES y EN.
3. **Ninguna pestaña dice «recibir»/«receive»**. **Verificado que falla** restaurando «Por recibir».
4. **Ninguna se llama «Rechazadas»/"Rejected" a secas** (la colisión con el estado `rechazada`).
5. **Las tres claves viejas no existen en ninguno de los dos catálogos.**
6. **Los identificadores del mapa son claves i18n existentes** en ambos idiomas.

### 5. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | `Test Files 93 passed (93)` · `Tests 828 passed (828)` (base: 93/822) |
| `npm run typecheck` | limpio (sin salida) |
| `npm run lint` | `✔ No ESLint warnings or errors` |
| Flakes conocidos (`M2View`, `PhotoUploader`) | **no se dispararon** |

### 6. Señalado a otros roles (no resuelto aquí)

1. **ux-ui — §23.14.6-3bis dice «los DIEZ valores de `SellRequestStatus`»; son ONCE.** Lo implementé
   sobre **once**, porque el contrato manda (`API_CONTRACT.md` §Enums:
   `cotizada | ofertada | aceptada | en_transito | recibida | verificacion | aprobada | pagada |
   rechazada | abandonada | expirada`) y porque **la propia frase de §23.8a suma once**: 1
   (`cotizada`) + 3 (el tramo) + 2 (`recibida`/`verificacion`) + 1 (`aprobada`) + 4 (terminales).
   El mapa normativo de §23.8a también reparte los once. **Es una errata de conteo, no una
   discrepancia de fondo**, y la señalo en vez de resolverla en silencio porque el número aparece
   en una regla de verificación: un test escrito contra «diez» dejaría un estado sin comprobar.
   **Sospecha del origen:** §23.12 lista **diez** claves bajo `status.sellRequest.*` — correcto
   ahí, porque `expirada` rotula por su MOTIVO (`status.sellRequestExpiry.*`, §23.1d) y no tiene
   clave en ese espacio. Diez **rótulos de estado**, once **estados**.
2. **Arquitecto — sin petición de contrato.** Este pase es rótulos, claves e identificadores:
   **ningún endpoint, ningún campo, ningún mock**. Siguen abiertas las dos peticiones del pase
   anterior (`live?` sin implementar en backend, y `canPay` como sexta copia sin contraparte
   server-derived).

---

## v1.51.8 · `isPayable` y `live?` — se borra la SEXTA copia (la que ya estaba rota) y la última enumeración de terminales (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> Consume los dos campos que backend entregó en `1ac4304` a raíz de las dos peticiones que dejé
> abiertas en el pase de §4.39c. Contrato: **API_CONTRACT §M5 v1.51.8** (`isPayable`) y **BL-18**
> (`live?`). ARCHITECTURE §4.39(c) **sitio 10**.

### 1. `canPay` — no era una copia que pudiera romperse: ya estaba rota

Cuando levanté esta sexta copia dije que no la curaba porque el contrato no exponía nada
equivalente. Al implementarla el backend apareció **lo que desde el cliente no se veía**: la
precondición del servidor son **DOS** términos y el literal replicaba **el primero**.

```
servidor:  status ∈ SELL_REQUEST_PAYABLE_STATES  ∧  verifiedAt IS NOT NULL
cliente:   status === 'aprobada' || status === 'verificacion'      ← solo el primero
```

⇒ **la pantalla habilitaba el botón de pagar en filas donde el servidor responde `422`.** No es una
copia que pudiera desincronizarse algún día. Ya lo estaba, en dinero saliente.

```ts
const canPay = isSuperAdmin && req.isPayable === true;
```

- **El literal de estados se borró.** El remedio **no** era replicar bien las dos condiciones: eso
  duplicaría **dos** reglas en vez de una y metería `verifiedAt` en la lógica de una pantalla.
- **`=== true`, y aquí importa más que en `isTerminal`:** si el campo faltara, el botón que sobra
  es un **botón de pago**. Fail-closed, con test.
- **El ROL se queda en el cliente y NO se fundió en el campo.** *«¿esta solicitud está en condición
  de pagarse?»* es propiedad de **la fila**; *«¿puedo pagarla yo?»* es propiedad **del actor**. Un
  check de permiso en el cliente es *affordance*; un check de máquina de estados es una regla
  duplicada — **solo la segunda se cura**. El servidor impone el rol igual con `MoneyOutGuard`:
  `isPayable: true` **no autoriza** un pago.

### 2. `live=false` — la última enumeración de terminales que quedaba viva en el cliente

La pestaña «Cerradas» mandaba `status=pagada,rechazada,abandonada,expirada`: **la forma exacta que
este ciclo retiró de los otros cinco sitios**, sobreviviendo en el único lugar donde el contrato
todavía no ofrecía alternativa. Ahora manda **`live: false`** y el servidor filtra **por exclusión**
sobre su propio set ⇒ **un terminal nuevo entra a esta pestaña solo**, sin tocar este archivo.

- `M5_CLOSED_STATUSES` y `M5_CLOSED_STATUS_CSV` **desaparecen**. `M5_STATUS_TAB` conserva la
  asignación de los cuatro terminales a `cerradas` porque eso es la **partición** (lo que impide
  que un estado desaparezca del back-office), no una consulta.
- El booleano se serializa **en el call-site** (`String(filters.live)`), siguiendo el precedente ya
  establecido por `guest`/`needsManual` en M3 — `api-client` no acepta `boolean` y no hacía falta
  ampliarlo.
- **No dependo del borde no especificado** que backend señaló (un valor mal escrito no filtra y no
  falla): solo se manda `false`, literal.
- Hay aserción **negativa** además de la positiva: si alguien repone el CSV, el test se pone rojo.

### 3. El mock tenía que dejar de reproducir el bug

En modo mock **no hay servidor que derive**, así que la regla vive en el servidor falso — y si se
hubiera quedado con un término, **el mock mantendría vivo el bug en la pantalla que existe para
demostrarlo**. Tres cambios:

1. `MockAdminBuylistRow` gana **`verifiedAt`** — una **columna de la «tabla»**, no un campo del
   DTO: `mockAdminBuylistDTO` la destructura fuera a propósito para que no se filtre al cliente por
   un `...row` distraído. Es exactamente el reparto del backend real.
2. La guarda de `paySpei` del mock pregunta por **`isPayable`**, no por una tercera lista de
   estados. Antes replicaba solo el primer término, igual que la UI.
3. `verifyBuylistRequest` sella `verifiedAt`, como hace el backend en el mismo `verify()`.

**Y una fixture que modelaba un estado imposible:** `sr-3001` estaba en `verificacion` **sin**
`verifiedAt`. El backend sella las dos cosas en la misma transacción, así que esa fila no existe en
producción — y con la regla completa se volvía no-pagable, rompiendo dos tests. No era un dato de
más: era **un estado que el servidor no puede producir**. Corregida (y `sr-3003`/`aprobada` igual).

### 4. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | `Test Files 93 passed (93)` · `Tests 832 passed (832)` (base: 93/828) |
| `npm run typecheck` | limpio (sin salida) |
| `npm run lint` | `✔ No ESLint warnings or errors` |
| Flakes conocidos (`M2View`, `PhotoUploader`) | **no se dispararon** |

Los cuatro casos nuevos de `isPayable` **se verificaron en rojo**: reponiendo el literal viejo caen
dos —el `aprobada`-sin-verificar (el caso del `422`) y el fail-closed—, que son justamente los que
el literal no podía ver.

### 5. ⚠️ Encontré DOS derivaciones más del mismo tipo, y una es del MISMO set

El barrido posterior al borrado dio dos transcripciones más en `M5View`, **dos líneas por debajo**
de la que acabo de curar:

| Línea | Literal | Constante del backend que transcribe |
|---|---|---|
| `:873` `canDecide` | `status === 'recibida' \|\| status === 'verificacion'` | **`SELL_REQUEST_VERIFYING_STATES`** |
| `:874` `showMoneyOut` | `status === 'verificacion' \|\| status === 'aprobada'` | **`SELL_REQUEST_PAYABLE_STATES`** — *el MISMO set que la sexta copia*, transcrito **una segunda vez** |

**`showMoneyOut` es la séptima copia y es gemela de la sexta.** Gatea la sección de dinero (revelar
CLABE + el bloque de pago). **No la toqué, y no por descuido:**

- **No puedo reusar `isPayable`**: no son el mismo predicado. `isPayable` lleva el término
  `verifiedAt`; `showMoneyOut` no. Sustituirlo **ocultaría la sección de dinero** —incluido el
  reveal de CLABE, que es una acción auditada con su propia guarda server-side— en filas donde el
  contrato no dice que se oculte. Sería resolver en silencio un cambio de conducta en superficie
  money-out.
- **No me invento un campo.** Es la misma disciplina que apliqué con `canPay` antes de que
  existiera `isPayable`.

**Consecuencia visible hoy, y es correcta:** una `aprobada` **sin** `verifiedAt` pinta la sección de
dinero con el botón de pagar **deshabilitado** (`showMoneyOut` true, `canPay` false). Se ve la
sección, no se puede pagar. Es estrictamente mejor que antes —cuando el botón salía habilitado y
contestaba `422`— y está cubierto por test para que nadie lo lea como un olvido.

### 6. Señalado a otros roles (no resuelto aquí)

1. **Arquitecto — la SÉPTIMA copia (`showMoneyOut`) es del mismo set que la sexta.** Si merece el
   mismo remedio, es un derivado más en `AdminBuylistDTO` (¿`isMoneyOutVisible`? ¿o `isPayable` con
   el término `verifiedAt` movido al consumidor?). **La decisión es suya**, con un matiz que pesa:
   una sección de dinero que aparece y desaparece por un campo derivado es más delicada que un
   botón, porque **el reveal de CLABE cuelga de ahí**. La octava (`canDecide` =
   `SELL_REQUEST_VERIFYING_STATES`) es del mismo tipo pero no toca dinero.
2. **Arquitecto / backend — `isPayable` NO viaja en las respuestas de `receive`/`verify`/
   `reject`/`pay-spei`.** El §11 lo declara en el composite `AdminBuylistDTO` (sin `?`), pero
   `toAdminSellRequestDTO` —la proyección que devuelven esos cuatro endpoints— **solo emite
   `isTerminal`**; `isPayable` sale **únicamente** de la lista. **Hoy no rompe nada** (M5 lo lee de
   la lista y descarta el cuerpo de las mutaciones), y lo tipé **obligatorio** porque el contrato
   manda. Pero el tipo afirma algo que esas cuatro respuestas no entregan: quien mañana escriba
   `if (res.isPayable)` sobre el resultado de `verifyBuylistRequest` obtendrá un `false` silencioso
   **en una superficie de dinero**. O lo emiten las cuatro, o el contrato acota dónde viaja.
3. **`ITEM_TERMINAL` (`M5View`) y `RESOLVED` (`M8View`)** siguen como estaban: subconjuntos de
   `SellItemStatus` y `DisputeStatus`, **dos enums que v1.51 no toca**. Misma clase, cero radio.

---

## v1.51 · §23.5 — el portal del vendedor: la pantalla a la que el correo de la oferta no llevaba (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> **El hueco, dicho como lo encontró devops:** el correo 1 está escrito, es **vinculante**, y su
> botón apuntaba a un 404. `POST /buylist/requests/:id/offer-response` existe y el bloque `offer`
> de `GET /buylist/requests/:id` existe, pero **no había pantalla**: el portal vivía en
> `/[locale]/buylist` (`MyRequestsSection`), que no lee ningún parámetro de URL, y
> `/buylist/requests/:id` era ruta de la **API**, no de vista. La variable del enlace se quedó
> vacía a propósito (con ella vacía la plantilla degrada a instrucción de texto, que es mejor que
> un botón muerto). Este pase construye la pantalla y **enciende el enlace**.

### 1. La ruta — y el path exacto que el correo debe apuntar

```
frontend/src/app/[locale]/(storefront)/buylist/requests/[id]/page.tsx
  URL:  /{locale}/buylist/requests/{sellRequestId}     ej. /es/buylist/requests/BL-000123
```

- **El `{locale}` no es decorativo:** `routing` corre con `localePrefix: 'always'`, así que
  `/buylist/requests/:id` **sin prefijo no resuelve** — es exactamente el 404 que devops encontró.
- El path elegido es **el mínimo delta** sobre lo que backend ya genera
  (`${APP_PUBLIC_URL}/buylist/requests/:id`, `buylist.service.ts:2190`): **añadirle el prefijo de
  idioma**, que es lo que hace el resto de los correos del proyecto (`buildFrontendLink` en
  `auth.service.ts:63` → `${origin}/${locale}/${path}`, con `APP_BASE_URL`).
- **Queda una decisión para el arquitecto** (no la tomo yo, ver §8): hoy conviven **dos variables
  de base** —`APP_PUBLIC_URL` (solo la usa el correo de buylist) y `APP_BASE_URL` (todo lo demás)—
  y el `locale` del enlace debería ser el `User.locale`, que es el mismo con el que el backend
  renderiza el correo **y** `offer.terms`. Si el arquitecto fija otro path, mover la carpeta es el
  cambio completo.
- **No hay choque con la ruta de la API:** el front habla con el backend por
  `NEXT_PUBLIC_API_BASE_URL` (otro origen y otro prefijo). La coincidencia de nombre es
  deliberada: el vendedor y el operador hablan del mismo objeto.
- **El portal no depende del correo.** `MyRequestsSection` gana un enlace «Ver esta solicitud» por
  fila (`buylist.offer.viewRequestCta`): quien borró el correo tiene que poder llegar a su oferta
  —y a los tres montos— sin depender de una bandeja de entrada.

### 2. Cómo se ve la oferta (§23.5b, espejo de §23.4.2)

En este orden, que **es la decisión**: condición → desglose → montos → plazo → acciones.

| Bloque | Qué pinta | Norma |
|---|---|---|
| Cabecera | eyebrow «Oferta de compra» + folio + `StatusBadge` (con `expiredReason`) | §23.1d |
| Recorrido | `PipelineStepper` **vertical con fecha y hora** | §23.2b |
| Intro | «Esta oferta es condicional y así funciona…» | R2 |
| **COMPRAMOS (n)** | nombre · set/número/acabado · **condición y monto EN EL MISMO RENGLÓN** | §23.4.2-1 |
| **NO COMPRAMOS (n)** | nombre, **sin monto** y sin explicar por qué | criterio 118 |
| Consecuencia | bloque **sobre pozo** (`bg-surface-2`), único de la pantalla, texto **verbatim** de `offer.terms.consequence` | §23.4.2-2 |
| **Los tres montos** | bruto · `−` envío · **regla de TINTA** · **neto a 22px** + la prosa que repite envío y neto | §23.4.2-4/5, D43 |
| Plazo | fecha, hora, día de la semana, «hora del centro de México» | criterio 154 |
| Acciones | **Aceptar** `primary` · **Rechazar** `secondary`, **nunca** `destructive` | §23.5c |

- **La UI no calcula NADA.** No hay `gross − shipping` en ningún archivo de este pase: los tres
  montos llegan congelados y se pintan como llegan. Si un día no cuadran a la vista, el bug es del
  servidor y **hay que poder verlo**, no taparlo con una resta local que siempre cuadra.
- **La condición NM y el bloque de consecuencia NO existen en `messages/*.json`.** Son `offer.terms`,
  que **renderiza el backend con las plantillas del correo**. Una copia en el catálogo del front
  sería la segunda plantilla que se separa en el primer cambio de copy — y aquí «separarse»
  significa que el correo y la pantalla le dicen al vendedor **dos tratos distintos**.
- **La condición por línea usa `line.condition` y cae a `terms.perLineConditionLabel`** si no viene.
  Nunca hay copy propio de por medio.
- **Todo-o-nada, demostrado por lo que NO está:** lista de solo lectura, cero `checkbox`, cero
  «quitar esta carta», cero contraoferta; y el body del endpoint es `{ decision }` **y nada más**
  (probado: `api.test.ts` afirma el JSON exacto — SEC-A1 es la FORMA del DTO, no una validación).
- **Confirmación al aceptar** (§7.6, es dinero): repite **el neto y la condición** en una frase y el
  botón dice el verbo con el monto («Aceptar y recibir mi guía»). **La resta no se repite ahí**: el
  diálogo se abre a un palmo del bloque de los tres montos.
- **`aria-live="polite"` envuelve a las acciones desde el primer render** (§23.10). Una región que
  aparece *junto con* su contenido no se anuncia en varios lectores: la región existe siempre y lo
  que cambia es lo de dentro (botones → desenlace). `assertive` queda para el error de dinero
  (`Banner role="alert"`).
- **`409 OFFER_EXPIRED` / `OFFER_NOT_PENDING` → banner PERSISTENTE**, no toast (§23.5c).
- **Nada de la mesa de decisión llega a esta pantalla**, y no por disciplina: `SellItemDTO` en
  `types/contract.ts` **no declara** `offerDerivedPriceCents`, `offerOverrideReason`,
  `offerPriceBasis`, `offerMarketMxnCents` ni `offerMarketBracket`. El contrato los marca
  ADMIN-ONLY y ese tipo lo consume el portal del vendedor: **un campo que no está en el tipo no se
  pinta por accidente**. Cuando M5 los necesite, entran en un DTO admin. Hay un test que barre el
  DOM buscando «en camino», «comprometido», «sugerencia», «no comprar» y «tope».

### 3. Las decisiones defensivas — y hacia dónde falla cada una

Cinco, todas en la misma dirección: **si no se puede enseñar el trato entero, no se ofrece firmarlo;
y si no se puede saber quién hizo qué, no se acusa a nadie.**

1. **El reloj del navegador NO apaga los botones.** El único gate de las acciones es
   `status === 'ofertada'` + oferta completa. Comparar `acceptDeadlineAt > now` en el cliente parece
   prudente y es **el peor de los dos errores**: con el reloj adelantado o una zona mal configurada
   le impediríamos aceptar **una oferta viva y vinculante** —se pierde la venta, sin remedio
   self-service—. Si el plazo sí venció, el servidor responde `409`, **nada se mueve** y la pantalla
   lo dice con la fecha real. *La pantalla informa; la puerta decide.*
2. **Oferta incompleta ⇒ ni montos, ni plazo, ni acciones** (`offer-readiness.ts`). Se bloquea si
   falta `terms.perLineConditionLabel`/`consequence` (**R2 no tiene excepción**: un monto ofertado
   sin su condición al lado promete un trato **mejor** del que le estamos haciendo) o si alguna
   línea no trae `offerDecision`, o trae `buy` sin precio (criterio 118: el paquete tendría
   contenido desconocido). Una línea `buy` sin precio **no se rescata con `MX$ 0.00`** — cero es un
   precio. Enseñar «al menos el neto» era la tentación y es justo lo que R2 prohíbe.
   ⚠️ **Lo que ese módulo NO hace, a propósito:** no valida que la suma de las líneas cuadre con
   `grossCents`. R4 dice que ninguna cifra del ciclo se calcula en el cliente, y una aritmética
   escondida bloquearía una oferta **real** por cualquier diferencia legítima que el servidor
   conozca y el front no.
3. **`offer` ausente se lee igual que `null`.** El contrato lo declara siempre presente en el
   detalle, pero el tipo lo marca opcional: durante el despliegue incremental un backend anterior
   responde sin él, y ausente ⇒ **estado previo a la oferta** (§23.5d), que no promete dinero, no
   enseña guía y no ofrece aceptar. Lo contrario —asumir oferta— sería pintar un contrato
   vinculante a partir de datos que no llegaron.
4. **`rechazada` en frío se dice con una frase NEUTRA.** §23.5f la rotula «La oferta venció el
   {fecha}», pero **el DTO no dice quién la cerró**: el vendedor a mano, o el barrido por no
   responder. Decir «venció» a quien la rechazó es falso; decir «la rechazaste» a quien no contestó,
   también. Mientras lo sabemos de primera mano (acaba de pulsar en esta sesión) se dice con
   precisión; en frío se usa *«Esta oferta ya no está vigente»*, cierta en los dos casos. Misma
   doctrina que el fallback de §23.1d. **Ver la petición 3 de §8.**
5. **`expirada + no_offer`: segundo cinturón sobre el dinero.** El servidor ya proyecta los montos a
   `null` (v1.51.4), y la pantalla **además** no los pinta. Si un backend anterior los sigue
   mandando, «MX$ 1,200» junto a «no procedimos» no aparece igual. Las cartas **sí** se siguen
   listando: no se le borra su solicitud, se le quita una cifra que ya no significa nada.

**Estados obligatorios (§23.9/§8.1):** carga (skeleton **sin hueco de dinero** — mientras la
petición está en vuelo *no sabemos si hay oferta*, y reservar el hueco prometería una cifra que en
la mitad de los casos nunca llega), error (banner + reintentar), **404 neutro** (el contrato usa
`404` y no `403` para no confirmar que la solicitud ajena existe: el copy tampoco lo confirma) y
**sin sesión** → invitación a entrar con `?next=`, sin consultar el endpoint (un `401` pintaría un
banner de error donde toca una invitación) y repitiendo la frase del correo: *«esta oferta no se
acepta desde un enlace del correo»*.

### 4. Qué se tocó fuera de la ruta nueva

| Archivo | Cambio | Por qué |
|---|---|---|
| `src/types/contract.ts` | `SellOfferPublicDTO`, `SellRequestDetailDTO`, `SellOfferResponseDTO`, `PickupAddressSnapshotDTO`, `BuyDecision`; `SellItemDTO +=` los **tres** campos de cliente | El detalle y la lista son *shapes distintos* (v1.51.8): tipos separados ⇒ ningún listado puede leer un `offer` que el servidor no manda, y lo dice el compilador |
| `src/lib/api.ts` | `getSellRequest(id)` y `respondToSellOffer(id, decision)` (+ ramas mock) | — |
| `src/lib/format.ts` | **`formatDateTimeMx`** | Zona **fija** `America/Mexico_City` y `dateStyle:'full' + timeStyle:'short'`, **idénticos** a `formatDateTime` del correo: un vendedor de vacaciones en Madrid tiene que leer la misma hora que su correo sobre la misma fecha límite |
| `src/components/ui/PipelineStepper.tsx` | `orientation="vertical"` + `timestamps` (**aditivos**, default = conducta previa) | §23.2b: en el portal el recorrido es siempre vertical — *el vendedor lee el historial de su venta, no un pipeline* |
| `src/lib/mock/fixtures.ts` | fila `sr-3003` **con la oferta emitida**, `mockSellOffer`, `mockSellRequestDetailDTO`, `mockOfferTerms` | El servidor falso proyecta **como el real**: `offer` solo con `offerState='sent'`, `terms` en el `locale` del dueño, y **la lista NO reparte `offer`** |
| `MyRequestsSection.tsx` | enlace al portal por fila | El portal no puede ser accesible solo desde el correo |

**Un paso sin sello de tiempo no pinta nada** en el stepper vertical: hoy la proyección de cliente
solo sella `createdAt`, `offer.sentAt` y `offer.acceptedAt`. Rellenar los demás con la fecha más
cercana sería **inventar el historial de una venta**.

### 5. i18n — claves nuevas y de quién es el copy

Namespace **`buylist.offer.*` (41 claves)** + `error.OFFER_EXPIRED` / `error.OFFER_NOT_PENDING`.
**Paridad ES/EN completa** (test de paridad en verde) y **cero claves retiradas**.

- **§23.12 no inventaría las claves del PORTAL** — lista las de los correos (`buylist.mail.*`), las
  del stepper, `status.*` y `buylist.request.address.*`, pero **no las de esta pantalla**. El
  **texto ES sí es normativo** (está en §23.5 y §23.4.2) y se usa palabra por palabra; **el EN lo
  traduje yo** y **los nombres de clave son míos**. Ambas cosas quedan **a ratificación de ux-ui**
  (§8, petición 1).
- **Copy que redacté por no existir en §23:** `confirmRejectTitle/Body/Cta` (§23.5c especifica la
  confirmación de **aceptar**, no la de **rechazar** — y rechazar también es irreversible: terminal
  es terminal, criterio 145), `incompleteTitle/Body`, `notFoundTitle/Body`, `noLongerActive`,
  `closedPaid` y `viewRequestCta`.
- **`ruleParagraph` es un duplicado inevitable HOY**, y conviene que se sepa: §23.5b obliga a que el
  portal lleve *«la misma frase en prosa del correo»* con el envío y el neto nombrados, pero esa
  frase la renderiza el backend dentro del correo y **no viaja en `offer.terms`**. Así que hay **dos
  copias del mismo párrafo** (`buylist.mail.offer.ruleParagraph` en backend, `buylist.offer.ruleParagraph`
  aquí) que pueden desincronizarse — exactamente el defecto que `terms` existe para impedir.
  **Petición 4 de §8.**
- **La frase de confirmación cita la condición VERBATIM**, con su singular: *«Aceptas que te
  compremos 2 cartas por MX$ 840.00, siempre que **llegue** en Near Mint»*. §23.5c la escribe en
  plural (*«lleguen»*), pero el servidor manda la variante por línea y **preferí la cita textual a
  una redacción propia**: un plural nuestro es una segunda plantilla de la condición. **Petición 2
  de §8.**

### 6. Lo que este pase NO implementa (declarado, no silenciado)

1. **«Cambiar» la dirección de origen (§23.5e).** La dirección **sí se muestra** (es su dato y es lo
   que vamos a imprimir), pero el enlace a `PATCH …/pickup-address` no entra: arrastra el selector
   de libreta completo y es otro alcance. Tampoco se pinta *«Ya imprimimos la guía con esta
   dirección»* porque **`guideSentAt` no viaja en la proyección de cliente** — ver petición 5.
2. **`POST …/declare-shipped` («ya lo mandé») y la guía/tránsito.** Es el tramo **posterior** a la
   aceptación (§23.5f, criterio 156). Se respeta la mitad prohibitiva del criterio 114: antes de la
   oferta no hay guía, ni nuestra dirección, ni vía para declarar envío.
3. **El CIERRE truncado del stepper (§23.2d)** —colgar la versalita del motivo del último paso
   alcanzado— sigue pendiente (ya estaba declarado en `lib/pipelines.ts`). Lo que sí está garantizado
   es la prohibición que importa: **ningún paso se pinta como fallido ni se tacha** — en `no_offer`
   el vendedor no falló nada.
4. **`pagada`: la fecha del SPEI** (§23.5f pide los tres montos + la fecha del SPEI + el desglose de
   aprobadas/rechazadas). Los tres montos y las líneas están; **la fecha del SPEI no viaja** en la
   proyección de cliente y **no se inventa**. Petición 6.

### 7. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | **`Test Files 95 passed (95)` · `Tests 871 passed (871)`** |
| `npm run typecheck` | **limpio (sin salida)** |
| `npm run lint` | **`✔ No ESLint warnings or errors`** |
| `npx next build` (en `NEXT_DIST_DIR=.next-verify`, borrado después) | verde; la ruta aparece como **`ƒ /[locale]/buylist/requests/[id]`** |
| E2E nuevo `e2e/buylist-offer.spec.ts` (mock, `E2E_DEV_SERVER=1`) | **`6 passed`** |

- **Flake observado (NO de este pase, y no es el par conocido):** en **una** de las tres corridas
  completas de `npm test` salió `1 failed | 870 passed`. Las corridas **anterior y posterior**
  dieron 871/871, y los dos ficheros con flake conocido —`PhotoUploader.test.tsx` (5/5) y
  `M2View.test.tsx` (65/65)— **pasan aislados**, igual que el bloque tocado por este pase
  (`buylist/`, `api`, `format`, paridad i18n, `components/ui`: **178/178**).
- **⚠️ DOS E2E de `e2e/buylist.spec.ts` fallan, y son PREEXISTENTES — verificado con `git stash`**
  (fallan igual con el árbol limpio, sin una línea de este pase):
  1. `@real vender: crea la solicitud…` → *«el carrito no alcanzó el mínimo ni con la cantidad
     máxima»*: la primera carta cotizable del grid GRADED no llega a MX$500 ni con `qty=999`.
  2. `en móvil 390px el teaser dice la regla del envío…` → `buylist-shipping-note` **existe en el
     DOM pero está `hidden`** a 390px en el teaser del **home**. Bajo D43 esa nota es *lo único*
     que el vendedor lee sobre el envío antes de la oferta, y §23.14.2a la puso ahí **precisamente
     para que también se viera en móvil**. **Es un defecto vivo de superficie de dinero** y lo
     tomo como pendiente propio del siguiente pase (no de éste: no toqué `HomeQuoter`).

Cobertura nueva: **8** casos de `offer-readiness.test.ts` (las tres puertas + que **no** valida
aritmética), **21** de `SellRequestDetailView.test.tsx` (tres montos, condición por línea, `skip` sin
monto, plazo con hora, sin casillas, aceptar, rechazar, `409` persistente, **plazo aparentemente
vencido sigue ofreciendo responder**, cero fugas de la mesa, sin oferta, `offer` ausente, ya
aceptada, rechazada en frío, términos incompletos, líneas sin clasificar, 404, sin sesión,
`no_offer` sin cifras, `expirada` sin motivo, oferta cancelada, **paridad EN en pantalla**), **6** de
`api.test.ts` (body exacto `{ decision }`, URL del detalle, oferta mock con `skip` sin monto, la
lista **sin** `offer`, 404, `accept → aceptada` + `409` en la segunda llamada) y **3** de
`format.test.ts` (zona fija, día de la semana, entrada inválida ⇒ `''`).

### 8. Peticiones a otros roles (no resueltas aquí)

**Al arquitecto:**

1. **El path del CTA del correo — decisión suya, la pantalla ya existe.** Propuesto y construido:
   **`/{locale}/buylist/requests/{sellRequestId}`** con `locale = User.locale`. Falta que el
   contrato/ARCHITECTURE fije (a) el prefijo de idioma —hoy `portalRequestUrl` no lo pone y es la
   causa del 404— y (b) si `APP_PUBLIC_URL` se unifica con `APP_BASE_URL`, que es la base que usan
   todos los demás correos. **No toqué backend.** Si se fija otro path, mover la carpeta es todo.
2. **`offer.terms` necesita una tercera cadena: la regla del descuento en prosa.** §23.5b obliga al
   portal a repetir *«Su costo, {shipping}, es una tarifa fija… La cifra que se te deposita es
   {net}»*, pero esa frase solo existe dentro de la plantilla del correo. Hoy la duplico en
   `buylist.offer.ruleParagraph`. **Petición concreta:** `terms.rule` (renderizada por el backend,
   con los dos montos ya interpolados), igual que `perLineConditionLabel` y `consequence`. Es
   **aditivo** y borra la única copia de copy que este pase se vio obligado a crear.
3. **`rechazada` no tiene discriminador de PRODUCTOR.** La cierran dos hechos opuestos —el vendedor
   rechaza, o el barrido la cierra por silencio— y el DTO de cliente no los distingue, así que en
   frío el portal solo puede decir una frase neutra. §23.5f asume el segundo caso y **le diría
   «venció» a quien pulsó “rechazar”**. Bastaría algo como `rejectedBy: 'seller' | 'timeout'` (o
   reusar el par `acceptedAt`/`closedAt` con una regla escrita). Mismo espíritu que `expiredReason`
   en D33, y por la misma razón: *no acusar a nadie de un desenlace que no eligió*.
4. **`SellItemDTO` mezcla dos audiencias.** El contrato añade a un solo DTO campos de cliente
   (`offerDecision`, `offeredPriceCents`, `condition`) y campos **ADMIN-ONLY**
   (`offerDerivedPriceCents`, `offerOverrideReason`, `offerPriceBasis`, `offerMarketMxnCents`,
   `offerMarketBracket`). En el front **no declaré los cinco admin-only** para que el portal no
   pueda pintarlos ni por autocompletado, pero eso deja el tipo del front **más estrecho que el
   contrato**, a sabiendas. Vale la pena que el contrato **nombre las dos proyecciones** como ya
   hizo con la lista y el detalle en v1.51.8.
5. **`guideSentAt` no viaja al cliente** y §23.5e depende de él: es lo que decide si el vendedor
   todavía puede corregir su dirección («Cambiar») o si ya solo cabe *«Ya imprimimos la guía con
   esta dirección»*. La línea es `guideSentAt`, **no `status`** (lo dice la precondición de
   `PATCH …/pickup-address`), así que el front no puede derivarlo sin recodificar una regla del
   servidor. Petición: exponerlo (o un booleano equivalente) en el detalle de cliente.
6. **`pagada` sin fecha de SPEI.** §23.5f la pide en pantalla; la proyección de cliente no la trae.
   Hoy no se pinta —no se inventa una fecha de un pago—, y queda el hueco declarado.

**A ux-ui:**

1. **Ratificar el copy del portal.** El ES sale de §23.5/§23.4.2 palabra por palabra, pero **§23.12
   no inventaría las claves de esta pantalla**: los nombres bajo `buylist.offer.*` y **todo el EN**
   son míos. Y hay copy que §23 no cubre y tuve que redactar: la **confirmación de rechazar**, el
   aviso de **oferta incompleta**, el **404 neutro**, la frase neutra de **`rechazada` en frío** y
   el enlace **«Ver esta solicitud»**.
2. **El plural de la condición en la confirmación.** §23.5c escribe *«siempre que **lleguen** en
   Near Mint»*, pero el servidor manda la variante **por línea** (singular) y la cito verbatim para
   no fabricar una segunda plantilla de la condición. O el backend manda también la variante plural
   (junto con la petición 2 al arquitecto), o §23.5c se ajusta al singular. **No lo decido yo.**
3. **§23.2d sigue sin implementarse** (el cierre truncado del stepper con la versalita del motivo).
   Está declarado desde el pase anterior; lo repito porque **esta pantalla es donde más se nota**:
   es la que el vendedor abre cuando su solicitud ya cerró.

**A backend** (no es cambio de contrato — el contrato ya los especifica; es que la proyección **aún
no los emite**):

- **`itemDTO` no emite `offerDecision`, `offeredPriceCents` ni `condition`**
  (`buylist.service.ts:1283`), que el contrato §11 declara para la proyección de cliente. **Sin
  ellos el portal no puede ofrecer aceptar** —y no lo hace: pinta el aviso de «oferta incompleta»,
  que es el lado seguro—. Los tres son lo único que falta para que la pantalla encienda entera; los
  *mocks* ya los emiten según contrato, así que en modo fixtures el flujo está completo y
  demostrable hoy.
- **Detalle menor del espejo (§23.5a):** el correo formatea con `Intl` sin normalizar el símbolo, así
  que en ES imprime **`$1,020.00`** mientras toda la app imprime **`MX$1,020.00`** (§9.3). El
  **número es idéntico**; es solo el símbolo. Lo señalo porque en una pantalla de dinero la
  identidad literal con el correo es la propiedad que se está comprando.

---

## v1.51 · Pase correctivo del arnés: «el test comprueba PRESENCIA, el usuario necesita VISIBILIDAD» (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> Cierra los dos E2E preexistentes que dejé señalados en el pase anterior. **Ninguno de los dos era
> un defecto de producto** — y el primero lo reporté mal, así que lo primero es corregir mi propio
> parte.

### 1. ⚠️ CORRECCIÓN DE MI REPORTE ANTERIOR — la nota del envío SÍ se ve a 390px

Escribí que la nota de servicio del envío *«existe en el DOM pero está `hidden` a 390px»* y lo
califiqué de **defecto vivo en superficie de dinero**. **Era una lectura incompleta: conté el
elemento que el test elegía, no los que hay.** Medido con el navegador de verdad:

| Ancho | `buylist-shipping-note` en `/es` | Veredicto |
|---|---|---|
| **390 px** | **2 en el DOM · 1 VISIBLE** | ✅ el vendedor la lee |
| **1280 px** | **2 en el DOM · 1 VISIBLE** | ✅ el vendedor la lee |

**La causa:** el home monta el panel del cotizador **dos veces** —`<div className="hidden lg:flex">`
para escritorio y `<div className="lg:hidden">` para móvil— y `BuylistShippingNote` va dentro de
los dos, con el **mismo `data-testid`**. El test hacía `.first()`, que resuelve **siempre** a la
copia de escritorio; a 390px esa copia está en `display:none`. **El test medía el arnés, no el
teaser**, y §23.14.2a **está cumplida**: la regla del envío existe en móvil, que es justo lo que
esa decisión vino a garantizar.

**El arreglo no es `.last()`** —sería igual de frágil, solo que al revés—. La aserción honesta para
una regla de dinero no es «existe en el DOM», es **«hay exactamente UNA visible en este ancho»**:

```ts
const note = page.getByTestId('buylist-shipping-note').filter({ visible: true });
await expect(note).toHaveCount(1);
```

Eso caza los **dos** fallos que importan: **0 visibles** (la regla desapareció de un ancho, el
defecto que §23.14.2a previene) y **2 visibles** (el duplicado que confundiría al vendedor).
`toBeInTheDocument()` y `.first()` no distinguen ninguno de los dos.

### 2. El barrido que pidió el orquestador: ¿hay más «presente pero oculto»?

Se instrumentó una sonda con navegador real que, en `/es`, `/es/buylist`, `/es/catalog`,
`/es/sellado`, `/es/compra` y `/es/login`, cuenta para **cada `data-testid`** cuántos hay y
cuántos están **visibles**, a 390 y 1280:

| Superficie | testid | 390 (total/visibles) | 1280 (total/visibles) | Lectura |
|---|---|---|---|---|
| `/es` | `buylist-shipping-note` | 2 / **1** | 2 / **1** | correcto (gemelos responsive) |
| `/es` | `finish-band` | 2 / 2 | 2 / 2 | correcto |
| `/es/buylist` | `buylist-shipping-note` | 1 / 1 | **2 / 2** | ver abajo |
| `/es/buylist` | `sell-cart-fab` | 1 / 1 | 0 / 0 | correcto (FAB solo en móvil) |
| `/es/catalog`, `/es/sellado`, `/es/compra`, `/es/login` | — | sin testids | sin testids | — |

**No hay ningún otro caso de «presente pero oculto».** El único elemento con gemelo responsive es
la nota, y en cada ancho se ve exactamente una.

**Hallazgo lateral (no lo arreglo, es de copy):** en `/es/buylist` a **1280px hay DOS notas
visibles a la vez** —la de la cabecera (§23.14.2b) y la del bloque de dinero del carrito fijo
(§23.3g)—. Las dos superficies están autorizadas por separado y el texto es cierto, pero verlo
duplicado en la misma pantalla es una decisión de **ux-ui**, no mía. Queda señalado.

**Límite estructural que conviene dejar escrito:** la visibilidad responsive **no se puede
verificar en unitarios**. En jsdom no hay hoja de estilos de Tailwind ni media queries, así que
`toBeVisible()` allí no sabe nada de `hidden lg:flex`. **`toBeInTheDocument()` en un unitario no
está mal usado: es que no es la herramienta.** La única red que puede cazar esta clase de defecto
es el E2E, y ahora la caza.

### 3. El otro E2E: no era el mínimo, ni el cotizador — era qué carta agregaba el helper

`@real vender` moría en *«el carrito no alcanzó el mínimo ni con la cantidad máxima»*. Medido set
por set con el navegador:

| Set (orden del dropdown) | filas graded | **con precio** | más barata |
|---|---|---|---|
| Surging Sparks (2024) | 8 | **0** | — |
| Twilight Masquerade (2024) | 2 | **0** | — |
| Scarlet & Violet (2023) | 0 | 0 | — |
| Celebrations (2021) | 40 | **0** | — |
| Sword & Shield (2020) | 0 | 0 | — |
| **Base Set (1999)** | 12 | **10** | **MX$ 37.36** |

**Dos defectos del helper encadenados:**

1. `addFirstSellableCard` cogía **`option[1]`**, «el primer set real». El dropdown viene ordenado
   por **año descendente**, así que `option[1]` es **el set más nuevo** — y los sets nuevos son
   precisamente los que **no tienen referencia de precio en graded**.
2. Su bucle de «la más barata» asignaba `MAX_SAFE_INTEGER` a una fila sin precio pero **la aceptaba
   igual** en la primera vuelta (`!best || cents < best.cents`). Con cero filas con precio,
   agregaba una carta en **`precio_pendiente`**.

A partir de ahí el rojo era inevitable **y engañoso**: una línea `precio_pendiente` **no suma al
total por diseño** (§23.3h — el front no inventa un precio y no pinta `MX$ 0.00`), así que
`ensureMinimumReached` subía la cantidad hasta 999 y el total seguía en cero. **999 × 0 = 0.**

**El cotizador suma bien:** `totalEstimatedCents = Σ quotedPriceCents × quantity`
(`useSellCart.ts:146`), y con la carta de MX$37.36 el mínimo de MX$500 se cruza en `qty = 14`.
**No hay hallazgo money-safe que enrutar al dueño**: lo que el test tomó por «no suma» era
`132(a)` funcionando —CTA apagado, faltante exacto en pantalla— sobre un carrito cuyo total
legítimamente vale cero.

**Arreglos (todos en el arnés, que es mío):**
- `addFirstSellableCard` **recorre los sets** hasta encontrar uno con filas que **muestren un
  monto**, y elige la más barata **de entre las que tienen precio**. Devuelve `false` si ningún set
  tiene ninguna ⇒ el test **se salta con motivo** («falta el dato») en vez de morir once pasos más
  adelante. Para no pagar una espera fija por set, distingue *«este set no tiene precios»* de *«el
  batch todavía no llegó»* esperando a una fila **resuelta** (con monto **o** con el rótulo de
  precio pendiente).
- `ensureMinimumReached` **nombra la causa** en su mensaje de fallo, incluyendo el contenido del
  bloque de dinero: *«si el total dice precio pendiente, la línea NO suma por diseño (§23.3h) y
  subir la cantidad no puede cruzar el mínimo: revisa qué carta agregó el helper, no el
  cotizador»*. La próxima vez el rojo se diagnostica solo.
- El smoke se marca `test.slow()`: descubrir recorriendo N sets cuesta más que coger el primero a
  ciegas, y **ese es el precio de no hardcodear nada**. Se paga con presupuesto, no con un helper
  frágil. (Tras optimizar la detección de «set resuelto»: **46 s → 30 s**.)

### 4. Dos defectos MÁS de la misma familia, que solo salieron al desbloquear el camino

El primero apareció en cuanto el test pasó del bloque del mínimo; el segundo, solo bajo la suite
completa en paralelo. **Los tres comparten patrón: leer el DOM del instante en vez de esperar al
estado asentado.**

| Helper | Qué hacía | Por qué fallaba |
|---|---|---|
| `choosePickupAddress` | `select.count()` y, si daba 0, tecleaba el alta inline | La libreta llega por red (`GET /users/me/addresses`) y **`count()` no auto-espera**: con la petición en vuelo devolvía 0, se iba por la rama de «no hay libreta» y tecleaba en un formulario **que nunca existió**. El rojo salía como *«no encuentro Calle y número»* |
| `openCart` | `fab.count()` y luego `fab.click()` | Qué superficie monta el carrito la decide una **medición del viewport en cliente**: durante la hidratación el primer render puede pintar el FAB y sustituirlo por el panel fijo. Playwright encontraba el botón **ya desprendido** (*«element was detached from the DOM, retrying»*) y agotaba el tiempo esperando a un elemento que había dejado de existir |

- `choosePickupAddress` ahora **espera a que el campo se decida** (`select.or(line1)`) antes de
  ramificar. Las dos ramas son excluyentes por construcción.
- `openCart` ahora persigue **el estado final** —el carrito visible— en vez de una secuencia de
  clics: espera a que la superficie se decida, pulsa el FAB **solo si sigue ahí**, y **el fallo de
  ese clic no es un fallo del test** (si el FAB desapareció es porque el panel fijo tomó su lugar).

**Y un tercero que la aserción nueva de `openCart` destapó:** `cartPanel` seleccionaba
`[aria-label^="Carrito de venta"]`, prefijo que **también casa con el FAB**
(`buylist.cartFab.ariaWithCount` = «Carrito de venta, 1 carta(s)»). Con el drawer abierto resolvía
a **dos elementos** — strict-mode violation, o peor: una aserción sobre «el carrito» mirando **el
botón que lo abre**. Ahora es `…:not(button)`: el carrito es un `dialog`/`aside`, el FAB es el
mando. *Llevaba ahí desde que existe el FAB, tapado porque nadie aseveraba el estado final.*

### 5. A ux-ui (no lo arreglo yo)

1. **Dos notas de envío visibles a la vez en `/es/buylist` a 1280px** (cabecera + bloque de dinero
   del carrito fijo). Ambas superficies están autorizadas por separado (§23.14.2b y §23.3g); que
   convivan en la misma pantalla no lo decide frontend.
2. **El faltante del mínimo no explica por qué una carta no cuenta.** Con el carrito lleno de
   líneas en `precio_pendiente` la pantalla dice *«TE FALTAN MX$500.00 para el mínimo de MX$500.00.
   **Agrega otra carta**»* mientras el vendedor mira 999 cartas en el carrito. Es
   **aritméticamente correcto** —esas líneas no suman— pero el bloque **nunca conecta las dos
   ideas**. §23.3h ya tiene el puente escrito: `buylist.quote.pendingLine.{label,note}`
   (`SIN PRECIO` + «no suma a tu total»), **que sigue sin implementarse** (hoy vive
   `buylist.linePending`, «Precio pendiente», solo en la fila). Si ux-ui confirma el alcance, lo
   implemento en el siguiente pase.

### 6. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | **`Test Files 95 passed (95)` · `Tests 871 passed (871)`** |
| `npm run typecheck` | **limpio (sin salida)** |
| `npm run lint` | **`✔ No ESLint warnings or errors`** |
| **Suite E2E COMPLETA** (mock, `E2E_DEV_SERVER=1 E2E_MOCK_PORT=3111`) | **`110 passed · 3 skipped · 0 failed`** (7.9 min) |
| `e2e/buylist.spec.ts` + `e2e/buylist-offer.spec.ts` aislados | **`22 passed`** |

- **Los 3 saltados** son los `@real` de `grading-estimate.spec.ts` (captura manual del estimado,
  resumen de la lista de revisión y retiro de la cifra): **piden el stack real**, no fixtures.
- **Los dos E2E que dejé en rojo en el pase anterior están en verde**, y con ellos el flujo
  `@real vender` de punta a punta. **La suite E2E completa no tiene ningún fallo.**
- **Cero cambios de producto en este pase**: solo `e2e/buylist.spec.ts`. Ni un componente, ni una
  clave i18n, ni un archivo de `src/`.

---

## v2.3.8 · §23.14.7-7 — una nota, un total que se explica, y dos montajes con nombre (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> Ejecuta las tres partes del alcance que ux-ui confirmó (`181cdf3`): **(a)** `pendingLine.{label,note}`
> con la `note` reescrita, **(b)** `minimum.addPricedCard`, **(c)** la nota del envío **condicionada al
> layout**. Más la **petición de testabilidad**, que es la causa raíz de todo el episodio.
> **Cero componentes visuales nuevos**: `BuylistShippingNote` no cambia un píxel; cambia **dónde** se monta.

### 1. (c) EXACTAMENTE UNA nota de envío por pantalla (§23.3g-bis)

**La decisión vive en UN solo sitio** —`BuylistView`, la única capa que ve la pantalla entera— y se
llama `shippingNoteHost`:

```
requestOpen                      ⇒ 'createStep'   // el paso de crear pinta la suya
isDesktopCart || drawerOpen      ⇒ 'cart'         // el bloque de dinero está a la vista
resto                            ⇒ 'header'       // móvil, drawer cerrado
```

- **El desempate no es arbitrario: gana la más cercana a la decisión.** La cabecera existe
  **únicamente** para cubrir el caso en que el carrito no se ve; donde el carrito sí se ve, su razón
  de ser desaparece y **no se monta**.
- **Repartir la decisión entre los componentes es exactamente cómo se llegó a las dos copias**, así
  que `SellCartContents` recibe `showShippingNote` y **obedece**: no decide. El comentario del prop lo
  dice, para que nadie «arregle» el acoplamiento devolviéndole la decisión.
- **No contradice §23.3c** («no aparece, no desaparece, no se mueve»): esa prohibición es sobre el
  **estado del carrito** —vacío/lleno, bajo/sobre el mínimo—, no sobre el **layout**. La invariante
  nueva es **más fuerte y más barata de comprobar**: *siempre exactamente una*, en vez de *al menos
  una*.
- **Por qué dos copias idénticas sí eran un defecto**, aunque el texto fuera correcto: dos párrafos
  iguales a 600px con el mismo peso visual son **la firma de un error de render**. El vendedor no
  concluye «esto es importante», concluye «esta página está rota».

### 2. (a) El total que explica su propia aritmética (§23.3h)

**`BuylistPendingLinesNote`** (nuevo archivo, **no** un componente visual nuevo: es un `<p>` con una
clave) se pinta **UNA vez, dentro del bloque de dinero**, con el conteo interpolado, en **tinta
`text-sm`**. **`BuylistPendingLineLabel`** sustituye el rótulo largo por la versalita **`SIN PRECIO`**
(`accent`) en las superficies del **cotizador**.

| Antes | Ahora |
|---|---|
| `linePending` («Precio pendiente») en la casilla del grid, en la línea del carrito y en el total | **`quote.pendingLine.label`** (`SIN PRECIO`), versalita mono `accent` |
| `totalPendingNote` **fuera** del bloque de dinero, en **mono 11px muted** | **`quote.pendingLine.note`** **dentro** del bloque, en **tinta `text-sm`**, con `{count}` |

- **`buylist.totalPendingNote` se RETIRA de los dos catálogos.** Decía *«esas las cotizamos a mano
  **cuando las recibimos**»*, y bajo el ciclo de oferta eso es **falso**: se cotizan a mano **al
  ofertar**, antes de que el vendedor mande nada. Dejarla viva junto a la nota nueva habría sido
  **dos redacciones del mismo hecho** — el defecto exacto que §23.14 lleva todo el ciclo cazando.
  *(La decisión de retirar esa clave concreta es mía: §23.3h manda el texto y el sitio, no nombra la
  clave que queda huérfana.)*
- **`buylist.linePending` SIGUE VIVA**, y no es un olvido: la usa **«Mis solicitudes»**, que **no es
  el cotizador**. Ahí la línea ya no es una cotización viva, es el registro de una solicitud enviada.
- **La segunda frase de la nota no es relleno.** Sin *«Las cotizamos a mano y te las incluimos en la
  oferta»*, «no suman» se lee como «no las queremos» y **la reacción racional del vendedor es
  borrarlas** — perdiendo justo las cartas que más trabajo nos costó catalogar.
- **Con TODAS las líneas sin precio el total no es `MX$ 0.00`**: es la versalita. *Un total de cero
  que significa «todavía no lo he calculado» no es un cero* — R7 aplicada al agregado.
- **El bloque sigue teniendo exactamente un monto**: un conteo de cartas **no es un monto**, y la nota
  no lleva ninguno.

### 3. (b) El consejo del faltante (§23.3f-bis)

`BuylistMinimumShortfall` gana **`hasPendingLines`** y **solo cambia el consejo**:
`minimum.addAnother` ⇒ **`minimum.addPricedCard`**. La **cifra no se toca**: sigue siendo la del
servidor.

⛔ **No se funde el faltante con la explicación** («te faltan MX$500 **porque** tus cartas no tienen
precio»): mezclar dos hechos en una cifra hace que **la cifra deje de ser verificable**. Dos frases,
dos trabajos — el **por qué** vive arriba (§23.3h) y **no se repite** aquí. Hay un test que lo
comprueba por lo negativo (el faltante no contiene «porque» ni «no tiene precio»).

### 4. La petición de testabilidad — el arreglo de LA CAUSA

El arreglo del test (`filter({ visible: true })`) fue correcto **para el test**. Esto es el arreglo
del defecto que lo hizo posible:

- **`HomeQuoterPanel` gana `surface: 'hero' | 'mobile'`, y es OBLIGATORIO.** Un tercer montaje
  **tiene que declararse**; no se puede añadir en silencio. Emite
  `data-testid="home-quoter-{surface}"` + `data-quoter-surface`.
- **`BuylistShippingNote` gana `surface?`** → `data-note-surface`. Instancias hoy: `home-hero`,
  `home-mobile`, `buylist-header`, `cart-money`, `create-step`.
- **Qué compra esto, dicho con precisión:** `data-testid` responde *«¿es esto una nota de envío?»*;
  `data-note-surface` responde *«¿CUÁL de las notas es?»*. **§23.3g-bis decide cuántas se ven;
  `surface` decide cuál se está mirando.** Sin lo segundo, cualquier comprobación futura vuelve a
  adivinar — y adivinar fue lo que puso un defecto inexistente en la fuente de verdad del diseño.

### 5. i18n (paridad ES/EN verificada por test)

**Altas:** `buylist.quote.pendingLine.{label,note}` · `buylist.quote.minimum.addPricedCard`.
**Bajas:** `buylist.totalPendingNote` (ausente en los dos catálogos).

- **`pendingLine.note` y `minimum.addPricedCard` van carácter por carácter como los fija §23.3h /
  §23.3f-bis**, incluida la forma ICU con `{count, plural, …}`.
- **⚠ El EN de `pendingLine.label` es MÍO y queda a ratificación de ux-ui.** §23.3h y §23.11 fijan la
  versalita **`SIN PRECIO`** pero **no dan su par en inglés** (a diferencia de `SIN ENVÍO`/`NOT
  SHIPPED`, que §23.12 sí empareja). Elegí **«No price»** por longitud: la versalita convive en la
  misma celda que un monto y **EN no puede ser más largo que ES** ahí (`Sin precio` = 10,
  `No price` = 8). Si ux-ui prefiere «No price yet», cabe igual.

### 6. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | **`Test Files 95 passed (95)` · `Tests 875 passed (875)`** |
| `npm run typecheck` | **limpio (sin salida)** |
| `npm run lint` | **`✔ No ESLint warnings or errors`** |
| **Suite E2E COMPLETA** (mock, `E2E_DEV_SERVER=1 E2E_MOCK_PORT=3111`) | **`116 passed · 3 skipped · 0 failed`** (8.1 min) |

- **Flake conocido, caracterizado:** en **2 de 5** corridas completas de `npm test` salió
  `1 failed | 874 passed`, y en la corrida que lo identificó el fichero era **`M2View.test.tsx`** —
  uno de los dos flakes ya declarados. **Pasa aislado (65/65)**, igual que `PhotoUploader` (5/5), y
  las otras **3 corridas** dieron **875/875**. **Ninguna de las dos áreas la toca este pase.**
- **Los 3 saltados de E2E** son los `@real` de `grading-estimate.spec.ts`: piden stack real.

**Cobertura nueva.** Unitaria (+4 en `BuylistView.test.tsx`, 67 en total): escritorio ⇒ la nota es la
del carrito y **la cabecera no se monta**; carrito de puros pendientes ⇒ versalita en vez de
`MX$ 0.00` + explicación **una vez** + «qué pasa con esas cartas» + **ningún monto extra**; la
explicación **no se repite** con `qty = 999`; y el consejo `addPricedCard` **sin fundirse** con el
faltante. Los tres tests que codificaban la conducta vieja (*«son DOS instancias, repetición
aceptada»*) **se reescribieron a la invariante nueva** y ahora afirman **la instancia** por
`data-note-surface`, no «la primera».
E2E (+7 en `e2e/buylist.spec.ts`, 22 en el fichero): §23.3g-bis a **390px con drawer cerrado**,
**390px con drawer abierto** y **1280px**; §23.14.6-6 en el **home** a los dos anchos, afirmando el
**montaje** por su identificador nuevo; y el describe nuevo de §23.3h/§23.3f-bis con el **caso exacto
que confundió al test** (8.1–8.5).

⚠️ **Un detalle del arnés que costó un rojo y queda escrito:** el test de escritorio simula el
viewport con **`vi.spyOn(window, 'matchMedia')`**, no con una asignación directa. `window` es
**compartido por todos los tests del fichero**: reescribirlo a mano dejaba al resto de la suite en
modo escritorio (sin FAB) y los rojos aparecían en tests que no tocan nada de esto. El
`vi.restoreAllMocks()` del `beforeEach` deshace el espía; una asignación no se deshace.

### 7. A ux-ui (una sola cosa, y es pequeña)

**Ratificar el EN de la versalita `SIN PRECIO`** (hoy «No price»). Es la única cadena de este pase que
no venía fijada por §23: todas las demás se implementaron carácter por carácter.

---

## v1.51.19 · §23.6/§23.7 — LA MESA DE DECISIÓN, y las dos correcciones de §23.5g (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> **Pase acotado a propósito.** El backend del ciclo está completo y **nada tenía interfaz**. De los
> cuatro frentes de admin, este pase entrega **la mesa de decisión y la emisión de la oferta** —que
> es *la petición original del humano*— y **declara los otros dos** (guía/confirmación y las cuatro
> colas) para un segundo pase. Prefiero dos pases verdes a uno grande y dudoso.

### 0. Primero: las dos correcciones de §23.5g que ya estaban ratificadas

Se aplicaron **carácter por carácter**; son copy normativo sobre pantalla que yo mismo escribí:

| Clave | Qué cambia y por qué |
|---|---|
| `offer.deadline` | ~~«la oferta **se cancela sola**»~~ ⇒ **«la oferta vence y ya no podremos comprarte a este precio»**. Tras v2.3.3 **«cancelar» es el verbo del correo 5 — lo que hacemos NOSOTROS**; una oferta que muere por silencio **vence**. La misma palabra para *«la retiramos»* y *«se te acabó el plazo»* reintroducía en la pantalla la fusión que los correos acababan de deshacer |
| `confirmAcceptBody` | El marco se reencuadra a **«La condición es la misma para cada carta: {condition}»**. Yo había citado la condición del servidor **en singular** dentro de un marco plural; §23.5g cambia **el marco**, no el texto — *cuando un texto del servidor no encaja en el marco de la UI, se cambia el marco, no se duplica el texto* |
| `confirmRejectBody` | Ahora **lleva el neto y la condición**. Mi versión los omitía «para no presionar»; **choca con R2 por el lado contrario**: es el último instante en que el vendedor puede saber **qué está soltando**. *La línea entre informar y presionar no está en decir el número: está en el tono* — y hay un test que verifica por lo negativo que el diálogo **no argumenta** (sin «¿estás seguro?», sin reencuadre del beneficio, sin un segundo CTA de aceptar) |
| `preOfferTitle`/`preOfferBody` | Dejan de repetir la misma frase: leídos juntos dan la de §23.5d **exacta, sin eco** |

*(Nota menor de higiene: `messages/en.json` tenía **11 `’` escapados** —artefacto de mi propia
inserción anterior— frente a **195 líneas** con UTF-8 literal. Quedan normalizados a literal, que es
la convención real del fichero. **Cero cambios de valor.**)*

### 1. La mesa de decisión (§23.6) — cinco cifras leídas en dos tiempos

`GET /admin/buylist/:id/decision-table` · `src/app/[locale]/(admin)/admin/m5/BuylistDecisionDesk.tsx`.
Se abre **desde la fila `cotizada` de M5**, una a la vez.

**La posición, en dos tiempos.** Primero **una** fracción —`POSICIÓN 9/10`— con la versalita de qué
regla manda; después **los cuatro sumandos**, siempre los cuatro y siempre en el mismo orden. Se
llama **POSICIÓN y no «inventario»** porque contesta *«¿de cuántas copias ya soy responsable?»*, e
incluye dinero comprometido: llamarla «tengo» sería mentir.

**Los cuatro mecanismos que impiden que el ojo sume «en camino» + «comprometido» (R6)** —que es el
valor de la pantalla, no un detalle—:

1. **Regla vertical de 1px** entre `VERIFICANDO` y `EN CAMINO`: la frontera *está en la casa /
   todavía no está*.
2. **Encabezados de grupo reales** (`<th colSpan={2} scope="colgroup">`): el lector de pantalla
   anuncia **el grupo antes de la cifra**.
3. **Gradiente de confianza por PESO, no por contraste**: 500 / 400, y **las cuatro cifras en
   `--color-text`**. Un número que decide una compra es información esencial y §10 prohíbe el muted
   para eso.
4. **Por ausencia**: ni subtotal, ni `+`, ni «(3 por llegar)», ni barra apilada. Hay un test que lo
   mide **por lo que no está**, incluido que la suma `1+2` no aparezca como cifra en ninguna celda.

**«En camino» que se pinta es `position.inTransit` y nada más.** No suman una `aceptada`, ni una con
guía emitida sin confirmar, ni un «ya lo mandé» del vendedor. *Contar promesas como inventario es
exactamente el error que esta pantalla existe para evitar.*

### 2. El conteo que no se pudo hacer (§23.7) — `null` NO es cero

Con `positionUnavailable`, **desaparece la tira entera, incluido el titular** —ni siquiera el
denominador: un `—/10` invita a leerlo como `0/10`— y en su lugar va **una frase**, en **tinta**.

**La distinción con un cero real no es un matiz de glifo: es presencia de estructura numérica frente
a ausencia total de ella.** `EN INVENTARIO 0` con su retícula y su `POSICIÓN 0/10` es **un dato**;
esto es **una oración**. Los dos casos están sembrados en el servidor falso —Pikachu es el cero real,
Eevee el sin-conteo— y los dos tienen test: *se reconoce a un metro y sobrevive a una captura en
gris*.

El test de prohibiciones se mide **sobre los NODOS, no sobre la cadena**: el em dash de *«Sin
sugerencia — falta el conteo»* es **puntuación de prosa**; lo prohibido es un `—` **ocupando el sitio
de un valor** (ahí ya significa «precio pendiente», §16.3a, y además se lee como cero). La regla
comprobable es: **ningún nodo cuyo texto completo sea un marcador de hueco**, y ningún `0`.

Y el aviso de pantalla (§23.7d) **no bloquea nada**: se puede ofertar sin conteo — *lo que falta es
el consejo, no el permiso*.

### 3. La sugerencia informa; el sistema no decide (D6)

- **Frase en prosa, no semáforo.** Una pastilla verde/roja se lee como **permiso**; una frase, como
  **opinión**. Esa diferencia **es** D6.
- **Asimétrica:** `do_not_buy` pinta «no comprar» en `accent` peso 500; `buy` va **todo muted**. Un
  consejo que dice «adelante» no necesita interrumpir; uno que dice «para», sí.
- **Mismo alto en los tres veredictos**: si la fila saltara al cambiar el veredicto, el operador
  aprendería a temerle.
- **Explica con cifras** qué regla se disparó y contra qué número —incluido el caso legacy del bounty
  vivo **sin objetivo**, que se mide con el tope y **lo dice**.

**Y las dos pruebas que protegen D6 de una «mejora» futura**, porque es lo que un revisor prudente
endurecería sin querer:
- **`do_not_buy` NO apaga «Emitir»** — ni con confirmación extra. El servidor no la valida;
  endurecerlo **contradice PROJECT.md**.
- **El default de la casilla IGNORA la sugerencia.** Toda línea con precio nace **marcada**, también
  las desaconsejadas. Si el default la siguiera, «no comprar» sería un **bloqueo blando**: la inercia
  haría el trabajo que D6 le prohíbe al sistema. `defaultSelection` **no mira `suggestion` ni una
  vez**, y hay un test que lo fija.

### 4. Emitir — dos desenlaces, y el botón no puede mentir sobre cuál

- **`lines` cubre EXACTAMENTE los ítems**: lo no marcado viaja como **`skip`**, nunca se omite. Una
  línea olvidada saldría del correo **sin que nadie hubiera decidido nada sobre ella**.
- **Override con motivo obligatorio ⇔ el monto DIFIERE del derivado.** Mandar **exactamente** el
  derivado **no es un override**: no pide motivo y el campo ni aparece (v1.51.12). **Igualdad entera
  exacta sobre centavos, sin banda de tolerancia** — un centavo ya es override. Hay test para los dos
  lados. Y **la cifra que se pisó se sigue viendo** bajo el input.
- **El verbo del botón lo decide `requiresAuthorization` DEL SERVIDOR.** *Un botón que dice «Emitir»
  y en realidad encola miente sobre lo que va a pasar.*
- ⚠️ **`requiresAuthorization` NO se recalcula, ni siquiera contra `operatorCapCents`**, y esa
  decisión merece leerse: depende del **rol del actor**, que esta pantalla no conoce —un súper-admin
  oferta sin tope—. Derivarlo aquí le diría a un súper-admin *«enviar a autorización»* sobre una
  oferta que **sí va a salir con su correo**: el botón mintiendo **en la dirección peligrosa**. Se
  usa el booleano del servidor, y **el desenlace real lo dice `offerState`** en la respuesta, que es
  lo que se lee (**nunca el código HTTP**, que es dinámico `200`/`202`).
- **Tras responder, el resultado se dice sin ambigüedad**: `sent` ⇒ *«el correo salió y el vendedor
  ya tiene X sobre la mesa»*; `pending_authorization` ⇒ *«el correo **NO** se ha mandado y la
  solicitud sigue igual para el vendedor»*. **Una oferta pendiente no existe para él.**
- **Emitida ⇒ la mesa es de solo lectura**: el override vive **solo antes** del correo (D2).

**Qué apaga «Emitir» y qué no** (`emitBlocker`, con test para cada rama): apagan
`pickupAddressMissing`, cero líneas, línea marcada sin monto, override sin motivo y `netBelowMinimum`
—los cinco los rechazaría el servidor, y dejar el botón vivo sería **prometer una acción que va a
fallar**—. **No apagan** `do_not_buy` ni `positionUnavailable`. Y **nunca apagado y mudo**: el motivo
va por `aria-describedby`, con el mínimo, el faltante **en BRUTO** (la única palanca que el operador
puede mover) y el remedio.

**La frontera de qué se calcula aquí**, que es la regla que el orquestador subrayó: la UI **recalcula
la suma al desmarcar** —el servidor mandó la del default y no puede saber qué quitó el operador— pero
**el umbral, la tarifa y los veredictos los manda el servidor**. `minimumOfferNetCents`,
`shippingFeeCents` y `requiredGrossCents` son **diales editables sin redeploy**: una constante aquí
quedaría desincronizada **en silencio**, y en una pantalla de dinero eso es un aviso que aparece
cuando no toca — o que **no aparece cuando sí**. El piso se compara con **`<`**, nunca `≤`: el borde
es **inclusivo** y hay un test parametrizado en `37999 / 38000 / 38001`.

### 5. Archivos y i18n

- **Nuevos:** `m5/decision-desk.ts` (lógica pura, 23 tests), `m5/BuylistDecisionDesk.tsx` (17 tests).
- **Tocados:** `types/contract.ts` (5 DTOs), `lib/api.ts` (`getBuylistDecisionTable`,
  `emitBuylistOffer`), `lib/mock/fixtures.ts` (servidor falso + **una solicitud `cotizada`**),
  `m5/M5View.tsx` (el botón que abre la mesa), `messages/*` (**64 claves** bajo `admin.m5.desk.*`).
- **⚠️ Divergencia de namespace declarada:** §23.12 nombra las claves `admin.buylist.desk.*`, pero
  **ese namespace no existe en este catálogo** — M5 vive bajo `admin.m5.*`. Se usó
  **`admin.m5.desk.*`**. Es un cambio de prefijo, no de contenido; si ux-ui prefiere el del
  documento, es un renombre mecánico.
- **El servidor falso siembra los TRES casos de posición a propósito** (posición completa, cero real,
  sin conteo): sin una solicitud `cotizada` el ciclo era **indemostrable en modo mock** y quedaba sin
  cobertura E2E.

### 6. Un efecto colateral del arnés que vale la pena contar

Sembrar esa solicitud `cotizada` **tumbó 16 tests de `M5View` de golpe, sin que el producto
cambiara**: la pestaña activa por defecto es *la primera con solicitudes*, y esos tests estaban
leyendo «Verificando» **por accidente** —era la primera no vacía porque no existía ninguna
`cotizada`—. Se añadió `openStage(label)` y **cada test declara ahora su etapa**.

*La lección es la misma que lleva tres pases apareciendo: **un test que no dice en qué pestaña está,
está midiendo el orden de los datos**.* Sembrar una fila nueva ya no puede volver a tumbarlos.

### 7. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | **`Test Files 97 passed (97)` · `Tests 916 passed (916)`** |
| `npm run typecheck` | **limpio (sin salida)** |
| `npm run lint` | **`✔ No ESLint warnings or errors`** |
| **Suite E2E COMPLETA** (mock, `E2E_DEV_SERVER=1 E2E_MOCK_PORT=3111`) | **`119 passed · 3 skipped · 0 failed`** (6.5 min) |

Cobertura nueva: **23** unitarios de `decision-desk.ts` (default que ignora la sugerencia, borde de
la igualdad al centavo, motivo 3–500, el piso inclusivo parametrizado, `max(0,…)` que **no** enmascara
el aviso, y `emitBlocker` rama por rama **incluidas las dos que NO bloquean**), **17** de
`BuylistDecisionDesk` (los dos tiempos, los grupos como `<th>` reales, R6 por ausencia, sin-conteo vs
cero real, sugerencia asimétrica, bounty legacy, default marcado, totales al desmarcar con el motivo
del bloqueo, override en sus dos bordes, payload con `skip`, los dos desenlaces de la emisión,
dirección ausente, 422 como alerta, solo-lectura y **paridad EN**), **+1** en el portal (el diálogo de
rechazar dice el neto y la condición **y no argumenta**) y **3** E2E de la mesa en `admin.spec.ts`.

### 8. Lo que este pase NO entrega (declarado, no silenciado)

1. **Guía y confirmación de envío** (`POST …/guide`, `POST …/shipment-confirm`). ⚠️ Y el matiz que
   importa cuando se implemente: **capturar la guía NO mueve el estado**; **solo confirmar** mueve a
   `en_transito`. Y el **«ya lo mandé» del vendedor no mueve nada**: detiene **su** reloj.
2. **Las cuatro colas** (pendientes de autorización, por confirmar envío, guías por cancelar) y **la
   cola de listas para publicar** en M1. §23.8 las especifica; no se ha escrito una línea de ellas.
3. **`POST …/decline`** («declinar ahora») y `POST …/offer/cancel`, con su confirmación de
   consecuencia.
4. **Las densidades de §23.6d** (compacta ≥lg y el colapso a card en <md): la mesa se implementó en
   **densidad cómoda**, que §23.6d declara *«la única en `< lg`»* y el default en todos los anchos.
   Es un refinamiento de retícula, no una regla de dinero.

### 9. A ux-ui

1. **Namespace de las claves de la mesa**: §23.12 dice `admin.buylist.desk.*`; el catálogo real usa
   `admin.m5.*`, así que quedaron en **`admin.m5.desk.*`**. Renombre mecánico si prefieren el otro.
2. **§23.6 no da el copy literal de la mesa** —da la anatomía, los rótulos en versalita y las cuatro
   frases de ejemplo de la sugerencia—, así que **la redacción exacta de las 64 claves es mía**
   (ES y EN), incluidas las de override, las de la barra de totales y las dos frases de desenlace de
   la emisión. Queda a ratificación.
3. **§23.6d (dos densidades) no se implementó**; ver §8.4.

---

## v1.51.19 · Cierre de la interfaz del ciclo: guía, confirmación, las cuatro colas y la que lo cierra (2026-09-01, rama `claude/buylist-inventory-workflow-hdnls3`)

> Con este pase **el ciclo de adquisición tiene interfaz completa**: se puede ofertar, autorizar,
> mandar la guía, confirmar el envío, trabajar las cuatro colas y ver qué falta para publicar.

### 0. Primero: el fallo de R4 que ux-ui encontró en una cadena mía

**`confirm.deadlineNote` decía «El vendedor tendrá 2 días hábiles para responder», con el 2 escrito a
mano** — y ese plazo es **un dial de M10**. Es literalmente la constante que R4 describe, y dolía el
doble por dónde estaba: **se le prometía al operador en el diálogo donde emite dinero, mientras el
correo saldría con el plazo real**.

**El DTO de la mesa no trae el dial**, así que se tomó la salida (2): **se quita el número.**

> **ES:** «El plazo para responder empieza a correr al emitir y se congela ahí.»
> **EN:** "The response deadline starts when you issue the offer and is frozen at that moment."

No se pierde nada: lo que el operador necesita saber es **que se congela al emitir**, no cuántos días
son — y eso es cierto siempre. Queda un comentario en el código diciendo que **si el DTO gana el
dial, se interpola**, para que nadie vuelva a escribirlo a mano.

### 1. Guía y confirmación — por qué son DOS actos (§M5 · D19/D20/D21)

`BuylistShipmentActions.tsx`, montado **solo en `aceptada`**, que es el único estado donde las dos
acciones existen.

> **El requisito que obliga a separarlos:** el plazo mide **una acción del vendedor** —que deposite
> el paquete— pero **nos enteramos por una acción nuestra** —que alguien lo confirme—. Sin
> separarlos, quien deposita el día 3 pierde su venta si el operador confirma el día 4, **y encima
> ya gastamos la guía**.

Las tres reglas se hacen **evidentes en pantalla**, no solo se respetan:

| Acto | Qué hace | Qué NO hace |
|---|---|---|
| **Capturar la guía** | **congela el plazo del vendedor**, que arranca **con la entrega de la guía, no con la aceptación** | **no mueve el estado**. Re-capturar corrige un typo y **no re-congela** una fecha ya comunicada |
| **Confirmar el envío** | **lo ÚNICO** que mueve a `en_transito` — y lo único que hace que estas cartas cuenten como «en camino» en la mesa **de otras solicitudes** | — |
| **El «ya lo mandé» del vendedor** | **detiene SU reloj** | **no mueve nada**: se pinta como **renglón informativo, nunca como badge**. Un segundo badge invitaría a leerlo como estado y a contarlo como inventario en camino |

- **Sin guía, la pantalla lo DICE**: *«Sin guía todavía: el plazo del vendedor no ha arrancado»*, en
  vez de dejar un hueco que se lea como «sin plazo» o, peor, como «ya venció». (Y es correcto que no
  corra: *un plazo del vendedor solo puede vencer por algo que dependa del vendedor*, y la etiqueta
  depende de nosotros.)
- **`guideSentAt` NO es precondición para confirmar.** Si el paquete llegó sin guía capturada, el
  diálogo **avisa** y deja confirmar igual: *negarlo no devuelve el paquete*. Fail-visible.
- **La frontera money-safe se dice donde alguien podría creer lo contrario:** el costo real de la
  etiqueta es **insumo de reporte**, y bajo el campo se lee *«No cambia lo que se le deposita al
  vendedor: eso es la tarifa que él aceptó»*.

### 2. Las cuatro colas (§23.8) — `BuylistCycleQueues.tsx`

Van **fuera** de las pestañas de etapa, y la distinción importa: las pestañas **particionan
`SellRequestStatus`**; las colas contestan **un pendiente nuestro con acción propia**.

| Cola | Lo que la hace distinta |
|---|---|
| **Ofertas por autorizar** | Columna **«Muere el»** con la fecha, y a ≤1 día hábil la versalita `CADUCA HOY/MAÑANA` en accent. *Una cola cuyas filas se mueren sin avisar se trabaja a ciegas.* Autorizar **autoriza lo guardado**: el diálogo lo dice y **no ofrece editar nada** |
| **Por confirmar envío** | La **alerta la manda el servidor y no se deriva de los días** (ver §3) |
| **Guías por cancelar** | **Tiene salida, y es obligatoria** (ver §4) |
| **Vendedores con solicitudes vivas** | **El teléfono viaja en la fila** (D12), para poder llamar sin ir a buscar al usuario. Sin teléfono se **dice** («Sin teléfono»), no se deja un hueco |

- **Un `vault_operator` no ve el botón de autorizar** y, en su lugar, **se le dice de quién es la
  acción** — nunca un botón apagado y mudo (§15.9).
- **El «por qué se cerró» de las guías se pinta por su MOTIVO** (§23.1d): una `expirada` +
  `not_shipped` sale como **SIN ENVÍO**, no como el rótulo genérico. Hay test que verifica que
  «Expirada» **no** aparece.

### 3. Lo que NO se recalcula, mismo criterio que la autorización de la mesa

**`businessDaysWaiting: null` NO es cero: es «no se pudo calcular»** (el cálculo de días hábiles
**lanza** fuera de la cobertura del calendario, por doctrina — degradar a «no hay festivos»
adelantaría vencimientos). La fila **se degrada y la cola se pinta**; *prohibido que una fila
devuelva 500 en un listado*.

Y **el `alert` se usa tal cual, jamás derivado del número**: **falla hacia «sí, avisa»** porque
*«llevo demasiado esperando»* y *«no sé cuánto llevo»* piden **la misma acción humana** — y un
`false` sacaría la fila del filtro de alertas, con lo que **la más rara sería la más escondida**.
Hay test unitario **y** E2E de que con `null` se pinta *«No se pudo calcular»*, **no aparece
`0 días hábiles`**, y **la alerta sigue encendida**.

**Y la alerta no promete nada más:** no expira, no cancela, no mueve el estado y no suma a «en
camino». *El vendedor ya cumplió; el pendiente es nuestro, así que el remedio es hacerlo visible, no
castigarlo.*

### 4. La cola de guías tiene salida, y las dos mitades de D22 van juntas

`POST …/guide/cancellation-done` es **la única forma** de que una fila salga de esa cola: **no
desaparece sola**. Sin implementar la salida, la cola **no se vacía nunca** — y el propósito de D22
(*una etiqueta comprada y olvidada es dinero tirado que nadie ve*) se convertiría en una lista que
crece.

El diálogo captura el **costo real** (`0` si la paquetería reembolsó) porque **es el único momento en
que se conoce el costo final de una etiqueta cancelada**, con la misma frontera money-safe escrita al
lado: *«no toca lo que se le deposita a nadie»*. Y el **vacío es positivo**: *«Ninguna guía pendiente
de cancelar»*, porque aquí «no hay nada» es una buena noticia.

### 5. La cola que cierra el ciclo — `PendingPublishQueue.tsx` en M1

> *Comprar bien y dejar la carta en una caja sin precio es comprar mal.*

Cada fila dice **qué le falta** (ubicación, precio o ambos) y **de dónde viene** la pieza. Sin precio
resoluble **no se pinta `MX$ 0.00`** —cero es un precio— sino la versalita + **deep-link a la cola de
precio pendiente de M2**. **No hay botón de publicar**: la pieza **sale sola** en cuanto no le falta
nada, *sin depender de que alguien se acuerde de apretarlo*.

**⚠️ Y la regla defensiva que el orquestador subrayó, implementada y probada por los dos lados:**
una fila con **`missing` vacío o ausente** se pinta **«POR REVISAR»**, **nunca como «ya está
lista»** — si la pintáramos así, **la pieza saldría de la única pantalla donde alguien la
encontraría**. Es la misma doctrina del conteo ausente de la mesa: *un «no sé» que se ve como un
valor bueno es peor que no mostrar nada*. Hay test para `missing: []` **y** para el campo ausente del
DTO.

Se monta **arriba del inventario general**, antes de las pestañas: es un pendiente nuestro **con
dinero ya gastado**, y además **es la RED del disparo de auto-publicación** —best-effort— cuya
aceptabilidad depende de que un disparo perdido **deje la pieza en esta cola** en vez de invisible.

### 6. Archivos, i18n y un efecto colateral

- **Nuevos:** `m5/BuylistShipmentActions.tsx` (8 tests), `m5/BuylistCycleQueues.tsx` (12 tests),
  `m1/PendingPublishQueue.tsx` (7 tests).
- **Tocados:** `types/contract.ts` (7 DTOs + el pipeline del ciclo en `AdminBuylistDTO`),
  `lib/api.ts` (9 funciones), `lib/mock/fixtures.ts` (servidor falso de las cuatro colas + guía +
  confirmación + autorizar + `cancellation-done`), `m5/M5View.tsx`, `m1/M1View.tsx`, `messages/*`
  (**89 claves** en `admin.m5.shipment.*`, `admin.m5.queues.*` y `admin.m1.publishQueue.*`).
- **La cola de guías del mock es MUTABLE a propósito**: se vacía **solo** por
  `cancellation-done`, igual que la real. Un fixture inmutable habría hecho pasar un test que en
  producción fallaría.
- **Efecto colateral del arnés, y van dos pases seguidos:** la cola de publicación lista Charizard,
  y un test de M1 esperaba por `findAllByText('Charizard')` **como ancla de la pestaña Gradeadas**.
  El `await` pasó a resolver **antes** de que cargaran las gradeadas y las aserciones siguientes
  medían un DOM a medias. Se cambió el ancla a **«PSA 9»**, que es lo único que solo existe ahí.
  *Un `await` sobre un texto que otra sección también pinta no es una espera: es una coincidencia.*

### 7. Verificación (resultado literal)

| Comprobación | Resultado |
|---|---|
| `npm test` | **`Test Files 100 passed (100)` · `Tests 943 passed (943)`** |
| `npm run typecheck` | **limpio (sin salida)** |
| `npm run lint` | **`✔ No ESLint warnings or errors`** |
| **Suite E2E COMPLETA** (mock, `E2E_DEV_SERVER=1 E2E_MOCK_PORT=3111`) | **`124 passed · 3 skipped · 0 failed`** (7.1 min) |

Cobertura nueva: **27 unitarios** (guía que no confirma, plazo que se dice cuando no ha arrancado,
«corregir» con guía existente, el «ya lo mandé» sin badge, confirmar como único movimiento, el costo
real como reporte, confirmar sin guía; la caducidad destacada, autorizar-lo-guardado sin edición, el
operador sin botón pero con explicación, días no calculables con alerta encendida, la salida única de
la cola de guías, el vacío positivo, el motivo del cierre, el teléfono y su ausencia; qué le falta a
cada pieza, sin `MX$ 0.00`, el deep-link, **`missing` vacío y ausente ⇒ POR REVISAR**, sin botón de
publicar, y **paridad EN en las tres superficies**) y **5 E2E** en `admin.spec.ts`.

### 8. Lo que sigue sin entregarse (declarado)

1. **`POST …/decline`** («declinar ahora», D39) y **`POST …/offer/cancel`**, con su confirmación de
   consecuencia (§23.8 da el copy exacto del diálogo de declinar).
2. **`PATCH /admin/buylist/:id/pickup-address`** — corregir la dirección **después** de la guía
   (BL-13), que es el tercer productor de la cola de guías por cancelar.
3. **Paginación de las cuatro colas y de la de publicar**: hoy se pinta la primera página que
   devuelve el servidor. Con volumen real hará falta el paginador (el patrón ya existe en M5
   «Cerradas»).
4. **`?onlyAlerts=true`** en la cola de confirmación: el contrato lo ofrece y aún no hay filtro en
   la UI.

### 9. A ux-ui

**§23.8 da las columnas clave y el tratamiento propio de cada cola, pero no el copy literal**, así
que **las 89 claves de este pase son mías** (ES y EN), incluidos los tres textos que hacen el trabajo
pedagógico y que conviene revisar con calma: el de la guía (*«capturar la guía NO mueve el
estado…»*), el del «ya lo mandé» (*«eso detuvo su reloj y nada más»*) y el de la alerta (*«…o no
pudimos calcular cuánto. Las dos piden lo mismo»*). Los tres explican **por qué** la pantalla se
comporta así, que es lo que evita que alguien la «arregle».
---

## §45 · La fusión de `main` en el stream del buylist, y **DT-Gd pagada**: dos DTOs de set, dos fixtures y un candado que ahora sí muerde (2026-09-05, rama `claude/buylist-inventory-workflow-hdnls3`)

> Pase de absorción de `origin/main` (83 commits, con **P-54** entero — logos de expansión) hacia la
> rama del ciclo de buylist. Tres ficheros míos en conflicto y, en el mismo pase, la ficha **DT-Gd**
> de `docs/TECH_DEBT.md`, cuyo disparador era literalmente *«el primer pase de frontend después de
> que `claude/buylist-inventory-workflow-hdnls3` fusione y `lib/api.ts` quede libre»*. `lib/api.ts`
> auto-fusionó: el fichero que la bloqueaba estaba libre, así que se pagó aquí.

### 1. Los tres conflictos: qué se conservó de cada lado

| Fichero | Lado `main` | Lado rama | Resolución |
|---|---|---|---|
| `SellCartContents.tsx` | §34: la **miniatura** de la carta en la línea del carrito de venta (`CardImage` + columna `w-12` fija + `min-w-0 flex-1`) | §23.3h: la **versalita** `BuylistPendingLineLabel` en vez del rótulo largo `linePending`, por línea y por unidad | **Las dos.** Se toma la estructura de `main` (la que reindenta la fila) y dentro van las dos sustituciones de la rama. Ninguna toca a la otra: una es la caja, la otra es lo que se pinta cuando **no hay precio** |
| `fixtures.ts` | `mockOrderDetailLegacy` (v1.51-c, el acta histórica con `cardSnapshot` incompleto — la consume `getOrderDetail`) | `MockSellRequestRow` + las proyecciones del servidor falso (`mockSellRequestDTO`, `mockSellOffer`, `mockAdminBuylistDTO`, …) | **Las dos.** El choque era de posición, no de sentido: los dos lados abrían un bloque justo detrás de `mockOrderDetail`. `mockSellRequests` conserva el tipo de la rama (`MockSellRequestRow[]`) |
| `FRONTEND_NOTES.md` | §28…§43 | las secciones tituladas por versión del ciclo del buylist | **Las dos, íntegras.** Primero el bloque de `main` (continúa la numeración que el fichero dejaba en §27), después el de la rama. **Y una renumeración:** la rama había abierto un segundo «§27» cuando ése era el último número libre; con §28…§43 dentro, «§27» resolvía a dos secciones. Pasa a **§44** (ver la nota en su cabecera) |

### 2. DT-Gd — el problema no era el campo opcional, era que **el opcional apagaba el candado**

La ficha lo dice en sus términos y no lo repito: `GET /catalog/sets` y `GET /buylist/sets`
compartían `CardSetDTO`, pero el contrato **los define distintos** — `logoUrl` entra en el del
cotizador (clave **siempre presente**, ARCHITECTURE §4.40.6) y **no** en el de catálogo (§4.40.5
«NO entra»). Colapsarlos obligó a `logoUrl?: string | null`, y **ese `?` era el daño**: no por
feo, sino porque una respuesta del cotizador **sin** el campo seguía siendo un `CardSetDTO`
perfectamente válido, y `fetchQuoterIndex` la absorbía con `s.logoUrl ?? null` **compilando en
verde y pintando las tejas sin logo, todas, en silencio**.

**Lo implementado, que es la dirección de la ficha sin desviarse:**

```ts
// src/types/contract.ts
export interface CardSetDTO { id; name; series?; releaseDate?; year?; partSetIds? }  // ⛔ SIN logoUrl
export interface BuylistSetDTO extends CardSetDTO { logoUrl: string | null }         // requerido
```

```ts
// src/lib/api.ts
getSets():         Promise<CardSetDTO[]>     // /catalog/sets   → fx.mockCatalogSets
listBuylistSets(): Promise<BuylistSetDTO[]>  // /buylist/sets   → fx.mockBuylistSets
```

Y en `fetchQuoterIndex` (`MasterSetIndex.tsx`) el mapeo pasa de `logoUrl: s.logoUrl ?? null` a
**`logoUrl: s.logoUrl`**. El `??` no era una defensa: era el sitio exacto por donde el invariante
se escapaba. Sin él, si el campo desaparece del tipo del cotizador, **esa línea deja de compilar**.

**`foldSetsForDropdown` pasa a genérico** (`<T extends CardSetDTO>(sets: T[]): T[]`) — el plegado
del master combinado de P-27 lo usan **los dos** endpoints, y con la firma vieja el resultado de
`/buylist/sets` se degradaba a `CardSetDTO[]` justo antes de servirse, tirando el tipo recién
partido. La semántica no cambia: la entrada combinada sigue siendo la del **principal**, así que la
teja de Celebrations usa el logo de `cel25` y no el `null` de `cel25c` (hay test).

### 3. La segunda mitad de la ficha: **el mock prometía más que el backend**

`getSets()` y `listBuylistSets()` servían del **mismo** `fx.mockSets`, así que en modo mock
`/catalog/sets` **también** rendía `logoUrl` — que el backend real no manda nunca. Nadie lo
consumía, pero es la clase de divergencia de §34, la que ya costó un defecto en producción.

Se cierra con la doctrina que este mismo fichero ya tenía escrita para las solicitudes de venta
(*«⚠️ Fila mock, NO el DTO»*): **`mockSets` es la TABLA `CardSet` del servidor falso**, con
`logoUrl` como **columna** `string | null` **requerida** (`MockCardSetRow`), y cada endpoint recibe
una **proyección**:

- `mockCatalogSets` = `mockSets.map(mockCatalogSetDTO)` — **borra la clave** por destructuring, como
  el `select` del backend real. Tiparlo `CardSetDTO[]` **no bastaba**: TypeScript acepta la
  propiedad de más en un valor que no es literal, así que el `Omit` tiene que ocurrir **en runtime**.
- `mockBuylistSets` = las filas con la columna, tipadas `BuylistSetDTO[]`.

Tres pruebas nuevas en `src/lib/api.test.ts` lo defienden, y **comprueban con `in`, no con
`toBeUndefined()`**: lo que el contrato distingue es **clave ausente** (catálogo) de **clave
presente con valor nulo** (cotizador), y `undefined` confunde justo esos dos.

### 4. La prueba de que la deuda está pagada de verdad (no «está más bonito»)

Un cambio de tipos solo paga esta ficha si **quitar el campo rompe la compilación**. Comprobado
en las dos direcciones, sobre el árbol resuelto:

| Experimento | Antes (tipo compartido) | Ahora |
|---|---|---|
| **A.** El contrato del cotizador deja de declarar `logoUrl` | compilaba | **`MasterSetIndex.tsx(202,16): error TS2339: Property 'logoUrl' does not exist on type 'BuylistSetDTO'`** (+ 4 sitios más) |
| **B.** Una respuesta de `/buylist/sets` **omite** `logoUrl` | compilaba, y `?? null` la volvía una teja sin logo | **`error TS2741: Property 'logoUrl' is missing … but required in type 'BuylistSetDTO'`** |

El «antes» de la columna izquierda no es una afirmación de memoria: se reprodujo el tipo viejo
(`logoUrl?: string | null`) con la respuesta sin el campo y `tsc --strict` salió en **0**, con el
`.map` produciendo `logoUrl: null` para **todas** las tejas sin una sola queja. Eso es exactamente
lo que la ficha describía.

### 5. Verificación del pase completo

`npm test` **1152/1152** en 113 ficheros · `npx tsc --noEmit` **limpio** · `npm run lint` **sin
warnings ni errores**. La referencia previa a la fusión eran **949**: la subida es `main`
entrando con sus propias suites (P-54 y demás) **más las 3 de DT-Gd**; no bajó ninguna.

### 6. El contrato **v1.53** aterrizó mientras esto se escribía, y coincide nombre por nombre

Empecé el pase asumiendo lo que dice la ficha: *«cero cambios de contrato; si el arquitecto prefiere
nombrarlos, mejor»*. Al terminar, `API_CONTRACT.md` ya traía la **rev v1.53 (acta de la fusión)** con
el punto **D**: *«DT-Gd — SÍ los nombro. Nacen `CardSetDTO` y `BuylistSetDTO`, y es DECLARACIÓN, no
cambio»*, con la forma `BuylistSetDTO = CardSetDTO & { logoUrl: string | null }`. **Es exactamente lo
implementado**, mismo nombre y misma forma, así que no hubo nada que reconciliar. Lo apunto porque el
diagnóstico del arquitecto es mejor que el mío y conviene que quede escrito: la causa raíz no fue que
el cliente eligiera mal, fue que **las dos respuestas se escribían como shapes anónimos inline** —
*un shape sin nombre no tiene con qué estar en desacuerdo*, y colapsarlos salía gratis.

**Y la limpieza que v1.53 punto C enruta a los dueños, hecha en mis rutas.** La fusión encontró que
`§4.39` nombraba **dos** secciones de `ARCHITECTURE.md`: el ciclo de adquisición (`§4.39(a)`…`§4.39(t)`,
de la rama) y las imágenes de set (`§4.39.1`…`§4.39.9`, de `main`). Manda el ciclo por radio de
citación, y **las imágenes de set pasan a `§4.40.1`–`§4.40.9`**. Reescritas las **30** citas de la
forma `§4.39.N` que vivían en `frontend/` y en este fichero, **más las 4 con `§4.39` a secas que
hablaban de M-47** (`contract.ts`, `fixtures.ts`, `MasterSetIndexPlate.test.tsx` y la cabecera de
§42). ⚠️ **Las `§4.39c` / `§4.39(x)` NO se tocaron**: ésas son del ciclo de adquisición y siguen
apuntando donde deben. Después de la reescritura no queda ninguna cita `§4.39.N` en mis rutas.

**Para el arquitecto — nada pendiente de DT-Gd.** El único punto que quedaba abierto (nombrar los dos
DTOs) lo cerró v1.53 y el cliente ya está alineado.
