/**
 * enum-query-axes.e2e-spec.ts — ⭐⭐ **`C-EQ-1`: la ÚNICA autoridad sobre si un eje de query cumple
 * §0-Q hoy.** (API_CONTRACT §0-Q punto 4 · ARCHITECTURE §4.37.1-a, NORMATIVO. Dueño: backend.)
 *
 * ### Por qué existe, dicho con el dato y no con la intención
 * La v1.72 de §0-Q llevaba un **censo de estado** dentro del contrato, rotulado *«se actualiza cuando
 * cambie»*. **Caducó dos veces en tres días**, y la segunda caducidad **costó trabajo real**: una
 * ficha de deuda citó el censo como autoridad para **no mirar** el catálogo, que era el sitio roto.
 * A la pregunta *«¿qué lo mantenía al día?»* la respuesta medida es **nada**: tres pases con doble
 * veredicto APROBADO pasaron por encima sin actualizarlo, porque **nada fallaba cuando se
 * desactualizaba**. El arquitecto retiró el censo del contrato en v1.73 — *un censo de estado dentro
 * de un documento normativo no envejece como una nota: envejece **con autoridad**, y entonces la
 * afirmación caducada **gana** contra el código que la contradice*.
 *
 * **Este fichero es el «algo que falla».** *«¿cumple `GET /x?y=` con §0-Q?»* se contesta **corriendo
 * esta suite**. Quien lo conteste citando `API_CONTRACT.md` está contestando una pregunta de estado
 * con una fuente de decisión — el error exacto que la v1.73 vino a cerrar.
 *
 * ### Dos obligaciones. La segunda es la que cierra la clase.
 *
 * 1. **CONFORMIDAD** — ejercita **por HTTP** cada fila del registro de §0-Q punto 4: las tres
 *    conductas del punto 1 (ausente/vacío/`' '` ⇒ `200` sin filtrar · token ⇒ filtra · basura ⇒
 *    `400`), la forma del punto 2 (`field` obligatorio, `allowed` = el dominio **declarado**, `400` y
 *    **no `422`**, `value` **solo** donde el punto 2 lo declara) y la **cota del eco**.
 *    **Tabla-dirigida a propósito:** una fila de datos por eje, no un `describe` escrito a mano — *si
 *    añadir un eje cuesta escribir un bloque nuevo, el eje número treinta y tres no se añade*.
 *
 *    ⭐⭐ **`QA-M3` (2026-09-13) — la propiedad «FILTRA» no comprobaba que filtrara.** Se titulaba
 *    *«un token del dominio FILTRA (u ordena)»* y su cuerpo entero era
 *    `expect(res.status).toBe(200)`. QA dejó `parseEnumFilter` **validando** y **tirando el valor**
 *    en `inventory.controller.ts:204`: `C-EQ-1` **3/3 VERDE** y la suite backend entera verde
 *    —integración 39/39 · 776, unitarias 293/293 · 4830—, *sin un solo test que mordiera*. Y lo
 *    delicado es dónde vivía: §4.37.1-a declara este fichero **NORMATIVO** y «la ÚNICA autoridad»,
 *    o sea **la caducidad-con-autoridad que este pase vino a matar, reintroducida en el candado**.
 *    Ahora cada fila mide **el resultado**: hay datos que filtrar · el token lo **cambia** · y el
 *    token **discrimina** de un segundo token. Con fixture propio (`sembrarFixture`) para los ocho
 *    ejes que no tenían datos con qué demostrarlo.
 *
 * 2. ⭐ **DESCUBRIMIENTO** — falla ante el eje que **nadie registró**. *Una suite no puede fallar por
 *    un parámetro que nunca le contaron.* `?context=`, `?reason=` y `?axis=` no se saltaron por
 *    descuido en `P-84`/`P-89`: **no estaban en el censo**, y un censo escrito a mano no puede
 *    enterarse de lo que nadie le contó. Aquí el inventario **se lee del código**
 *    (`helpers/query-axis-census.ts`, **sobre código y no texto**) y se cruza contra listas explícitas.
 *
 * ### ⚠️ CUATRO listas, no dos — y es una desviación CONSCIENTE de la especificación, con su motivo
 * §4.37.1-a pide cruzar contra **dos** listas: (a) los ejes del registro y (b) los que no son de
 * dominio cerrado. La (b) está **partida en dos** desde `QA-M4` (por nombre lo que es transversal
 * por la FORMA del valor; por `MÉTODO /ruta::param` lo que es una **medición de esa ruta**) — ver
 * `NO_ENUM_TRANSVERSAL` / `NO_ENUM_POR_RUTA`, con el defecto medido al lado. Al correr el descubrimiento por primera vez (2026-09-13, **176** `@Query` en
 * código) apareció lo que ninguna de las dos listas admite sin mentir: **22 ejes de dominio cerrado
 * medido que el registro de §0-Q no contiene** (la bóveda, `?kind=`, `?scope=`, `?report=`,
 * `?range=`, ocho `?sort=`…). Meterlos en (b) sería **declarar falso** que su dominio es abierto —
 * y enterrar justo lo que el descubrimiento acaba de encontrar. Dejarlos fuera de las dos sería
 * **rojo permanente** por algo que este pase no puede decidir (la clase la decide el arquitecto,
 * regla 9) ni arreglar (son de otros work streams).
 *
 * Por eso hay una tercera: **`SIN_CLASE_DECLARADA`**, con la conducta de HOY **medida** al lado y su
 * dueño. No es un censo de estado escondido: es una **cola de enrutamiento**, y está **fijada
 * exactamente** (`toEqual`), así que **no puede crecer en silencio** — un eje nuevo no se cuela en
 * ella, hay que escribirlo a mano y justificarlo. La propiedad que importa se conserva entera: **un
 * `@Query` que no esté en NINGUNA de las tres ⇒ ROJO.**
 *
 * ### El canario, con sus dos mitades (`test/enum-query-census-canary.spec.ts`)
 * Un candado sin canario es una esperanza. El de aquí demuestra las dos cosas que hay que demostrar:
 * que **muerde** (un `@Query` nuevo sin clase ⇒ rojo) y que **no es ciego** (si el escáner dejara de
 * mirar código —p. ej. mirando texto, o perdiendo la resolución de ruta— seguiría VERDE, que es el
 * fallo silencioso: *un candado roto al revés no se nota nunca*).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AcquisitionType,
  DisputeStatus,
  Finish,
  InventoryStatus,
  KycStatus,
  OrderStatus,
  OwnerType,
  PendingPriceContext,
  PendingPriceReason,
  ProductType,
  SealedCondition,
  SealedGroupKind,
  SealedSubtype,
  SellRequestStatus,
  ShipmentStatus,
  UserStatus,
  VaultZone,
} from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { censusQueryAxes } from '../helpers/query-axis-census';
import {
  huerfanos,
  NO_ENUM_POR_RUTA,
  NO_ENUM_TRANSVERSAL,
  QUERY_SIN_NOMBRE,
  SIN_CLASE_DECLARADA,
} from '../helpers/query-axis-cross';
import { ACCEPTED_RAW_CONDITIONS } from '../../src/common/business-rules';
import { BOUNTY_STATE_VALUES } from '../../src/modules/pricing/bounty-state';
import { ADMIN_BOUNTY_SORT_VALUES } from '../../src/modules/pricing/admin-bounties.service';
import { PENDING_PUBLISH_MISSING_VALUES } from '../../src/modules/inventory/inventory.controller';
// ⭐ `EQ-D2` — dominio del eje `?state=` de `GET /admin/inventory/sealed-price-status` (M11 §10, clase L).
import { SEALED_PRICE_STATE_VALUES } from '../../src/modules/inventory/sealed-product.service';
import { PRICING_BRACKETS_AXIS_VALUES } from '../../src/modules/admin/admin.controller';
import { VAULT_SEALED_SORT_VALUES } from '../../src/modules/vault/vault.service';
// ⭐ `EQ-D1` — dominios de los ejes migrados en este pase (kind/scope/sort de catálogo).
import { SHIPMENT_KIND_VALUES } from '../../src/modules/shipments/shipments.service';
// ⭐ §M4-PREP (v1.78) — dominio de `?destination=` de «Pedidos a preparar».
import { PREPARATION_DESTINATION_VALUES } from '../../src/modules/shipments/shipments.service';
import { USER_AUDIT_SCOPE_VALUES } from '../../src/modules/audit/audit.service';
import { SEALED_LIST_SORT_VALUES } from '../../src/modules/catalog/sealed-catalog.service';
import { CATALOG_CARDS_SORT_VALUES } from '../../src/modules/catalog/catalog.service';
// ⭐ `EQ-D1` lote 2 — dominios de los ejes de ORDEN/RANGO sin dinero migrados en este pase.
import { MASTER_SET_SORT_VALUES } from '../../src/modules/inventory/master-set.service';
import { ADMIN_VAULTS_SORT_VALUES } from '../../src/modules/vault/admin-vaults.service';
import { PORTFOLIO_HISTORY_RANGE_VALUES } from '../../src/modules/vault/vault.service';

type ErrorBody = { error: { code: string; message: string; details: Record<string, unknown> } };

const SRC = join(__dirname, '..', '..', 'src');
const CONTRACT = join(__dirname, '..', '..', '..', 'docs', 'API_CONTRACT.md');
const SCHEMA = join(__dirname, '..', '..', 'prisma', 'schema.prisma');

/** Una fila del registro de §0-Q punto 4, con lo que hace falta para ejercitarla por HTTP. */
interface AxisRow {
  /** Llave del cruce con el censo de código: `MÉTODO /ruta` tal como la resuelve el escáner. */
  readonly route: string;
  /** Nombre del query param **tal como lo manda el cliente**. */
  readonly param: string;
  /** `details.field` esperado. Por defecto `param` (⚠️ `zone`, no `location.zone` — §0-Q punto 2). */
  readonly field?: string;
  /** Clase declarada (§0-Q punto 3 / §4.37). `ORDEN` = §0-Q punto 6 (no es filtro, es orden). */
  readonly clazz: 'E' | 'R' | 'L' | 'ORDEN';
  /** El dominio DECLARADO: derivado del enum (E/R) o el literal junto al call-site (L/ORDEN). */
  readonly allowed: readonly string[];
  /**
   * ⭐ Un token legítimo del dominio **que CAMBIA el resultado** respecto de no filtrar.
   *
   * ⚠️ No vale cualquier token del dominio, y la diferencia es el agujero que `QA-M3` midió: hasta
   * hoy la propiedad `filtra` solo miraba el **código de estado**, así que un `valid` que devolviera
   * *exactamente la lista entera* pasaba igual. Se eligen **con el conteo del fixture delante**
   * (`fixture-conteos`, abajo): `?status=settled` daba `1` de `1` — verde con y sin filtro.
   */
  readonly valid: string;
  /**
   * ⭐ Un SEGUNDO token del dominio cuyo resultado **difiere del de `valid`**. Es lo que distingue
   * *«filtra por el valor que le mandé»* de *«devuelve vacío ante cualquier token»* — la mutación
   * hermana de `QA-M3`, que un `valid ≠ sin filtrar` por sí solo NO atrapa.
   *
   * Obligatorio siempre que el dominio declarado tenga **≥2** tokens; lo vigila un test propio, no
   * este comentario. Se omite **solo** cuando `allowed.length === 1` (hoy: `?condition=` de
   * `/catalog/cards`, cuyo dominio es `['NM']` por política — `business-rules.ts:44`).
   */
  readonly alterno?: string;
  /**
   * Cómo se OBSERVA el resultado de este endpoint. Por defecto, una lista paginada
   * (`{ total, data }`). Los dos que no lo son lo declaran: el XLSX (bytes) y
   * `/admin/reports/pricing-brackets` (dos arrays hermanos, sin `data`).
   */
  readonly obs?: Obs;
  /** Querystring obligatoria del endpoint (p. ej. `setId=…`), sin el `?`. */
  readonly extra?: (ctx: Ctx) => string;
  /**
   * Ruta REAL a golpear cuando `route` lleva parámetros de ruta (`:userId`). `route` no se toca:
   * es la llave del cruce con el censo de código y tiene que seguir siendo la del escáner.
   */
  readonly path?: (ctx: Ctx) => string;
  readonly auth: 'admin' | 'public' | 'customer';
  /**
   * ⭐ **¿Esta fila TRANSCRIBE §0-Q punto 4, o solo mide una conducta que ya conforma?**
   *
   * `'transcrita'` (default) = el registro de §0-Q punto 4 contiene la fila, con su clase decidida
   * por el arquitecto. `'PENDIENTE-ARQUITECTO'` = la **conducta** ya cumple §0-Q (medida aquí, por
   * HTTP) pero **la fila del contrato todavía no existe**: escribirla es cambiar §0-Q y eso es del
   * arquitecto (regla 9).
   *
   * ⚠️ Existe para que este registro **no mienta sobre lo que es**. Meter una fila sin decirlo
   * convertiría una transcripción de decisiones en un censo de estado — que es exactamente lo que la
   * v1.73 retiró del contrato y lo que este fichero existe para no repetir.
   */
  readonly filaEn0Q?: 'transcrita' | 'PENDIENTE-ARQUITECTO';
  /**
   * §0-Q punto 2: `details.value` es **CONDICIONAL**. ✅ obligatorio en los seis ejes de dominio
   * cerrado de los DOS catálogos públicos (ya estaba publicado antes de que §0-Q existiera);
   * ⛔ prohibido en cualquier otro.
   */
  readonly echoValue: boolean;
  /**
   * Eje **CSV** (§0-Q punto 5): la coma es separador y el espacio a su alrededor es **sintaxis de
   * lista**, no parte del token ⇒ `?x=%20tok` **filtra**. En un eje escalar, `' tok'` es `400`.
   */
  readonly csv?: boolean;
  /**
   * ⭐ **Excepciones MEDIDAS, por PROPIEDAD y no por fila** — con su motivo y su conducta de HOY.
   *
   * Se hace así y no con un `diferida` de fila entera porque un eje que cumple cinco de siete
   * propiedades **tiene que seguir midiéndose en las cinco**: apagar la fila completa por una
   * excepción convierte un hueco conocido en cinco huecos invisibles. Cada excepción trae una
   * aserción `hoy` que **fija la conducta actual**, así que el día que alguien la cierre esto se
   * pone rojo y tiene que venir aquí a moverla — ⛔ el cambio no puede ser silencioso.
   */
  readonly excepciones?: {
    readonly [K in Propiedad]?: {
      readonly motivo: string;
      readonly hoy: (res: ApiRes, extra: Extra) => void;
    };
  };
}

type Propiedad = 'vacio' | 'espacios' | 'filtra' | 'error' | 'value' | 'sinNormalizar' | 'cota';
type ApiRes = { status: number; body: ErrorBody; text: string };

/**
 * ⭐ **La observación del resultado — lo que convierte `filtra` en una medición y no en un `200`.**
 *
 * `huella` es el **conteo más el contenido** de lo devuelto. El conteo solo no basta: medido el
 * 2026-09-13 sobre el fixture, `/admin/pricing/pending?reason=no_market` y `?reason=premium_at_floor`
 * devuelven **una fila cada uno** — un eje que filtrara «bien de menos» (siempre la primera fila)
 * daría el mismo `1` en los dos. Con el cuerpo dentro, se distinguen.
 *
 * ⚠️ La huella tiene que ser **estable entre dos llamadas idénticas** o la suite se vuelve
 * intermitente.
 *
 * ⭐⭐ **`R3` — aquí decía «Medido antes de escribir esto, N=2 por eje sobre las 26 filas: estable en
 * todas», y la frase se volvió FALSA sin que nadie la tocara.** Esa medición se hizo sobre las 26
 * filas de la fase 1; luego entraron las **seis de la bóveda** y la frase pasó a cubrirlas **sin
 * haberlas medido**. Es la clase que `ARCHITECTURE §4.37.1-a` declara mortal —una afirmación de
 * estado que envejece con autoridad— **dentro del fichero que se declara NORMATIVO**, y es la tercera
 * vez en este mismo fichero (`QA-M3` la primera, `C2` la segunda).
 *
 * **La cura no es corregir el número: es que deje de ser prosa.** La estabilidad la comprueba ahora
 * un test, `huella ESTABLE entre dos llamadas idénticas`, **sobre las filas que haya** — así una fila
 * nueva se mide sola y ninguna frase puede volver a cubrir lo que nadie miró. Si algún día un
 * endpoint mete un `now()` en su DTO, ese test lo dice y la fila declara su propia `huella`; no se
 * afloja la propiedad para todos.
 */
interface Obs {
  /** Huella observable de la respuesta: dos resultados distintos ⇒ huellas distintas. */
  readonly huella: (res: ApiRes) => string;
  /** ¿El resultado SIN filtrar trae algo? Con cero filas, «filtra» NO es observable aquí. */
  readonly hayDatos: (res: ApiRes) => boolean;
  /**
   * ⭐⭐ **Distancia entre dos huellas, y el SUELO DE RUIDO del instrumento.**
   *
   * ### De dónde sale: el candado de estabilidad cazó un defecto MÍO
   * La fila del XLSX observaba `bytes=<longitud>` y `filtra` exigía solo `!==`. **El XLSX no es
   * estable byte a byte**: medido N=40 repartidas en ~80 s sobre la MISMA consulta, la longitud toma
   * **12 valores distintos con un spread de 18 bytes** (`exceljs` escribe la fecha de creación dentro
   * del ZIP, y el DEFLATE de esa cadena cambia de tamaño). Consecuencia doble, y la segunda es la
   * grave:
   *
   *  1. la prueba de estabilidad salía **intermitente** (7254 vs 7250, cazado en una corrida);
   *  2. ⛔ **`filtra` podía pasar por RUIDO**: dos respuestas idénticas en contenido daban longitudes
   *     distintas, así que el `!==` se satisfacía **sin que el filtro hiciera nada** — o sea, en esa
   *     fila `QA-M3` no estaba realmente cerrada. *Un `!==` sobre un instrumento ruidoso no es una
   *     medición.*
   *
   * Por eso la comparación es **distancia contra un umbral medido**, no igualdad: `filtra` exige
   * superar el ruido, y la estabilidad exige quedarse por debajo. Para todo lo demás (JSON) el
   * instrumento es exacto y el umbral es `0`, con lo que se reduce a `!==` / `===`.
   */
  readonly distancia?: (a: string, b: string) => number;
  /** Umbral de ruido MEDIDO del instrumento. Por defecto `0`: la respuesta es byte-determinista. */
  readonly ruido?: number;
}

/** Instrumento exacto (JSON): dos huellas o son la misma o están infinitamente lejos. */
const DISTANCIA_EXACTA = (a: string, b: string): number => (a === b ? 0 : Number.POSITIVE_INFINITY);
const distanciaDe = (obs: Obs) => obs.distancia ?? DISTANCIA_EXACTA;
const ruidoDe = (obs: Obs) => obs.ruido ?? 0;

type Lista = { total?: number; data?: unknown[] };
const filas = (res: ApiRes): number => {
  const b = res.body as unknown as Lista;
  return b?.total ?? b?.data?.length ?? -1;
};
/** El caso normal: lista paginada `{ total, data }` — todas las filas menos las dos de abajo. */
const OBS_LISTA: Obs = {
  huella: (res) => `n=${filas(res)}|${JSON.stringify((res.body as unknown as Lista)?.data ?? null)}`,
  hayDatos: (res) => filas(res) > 0,
};
/**
 * `GET /admin/inventory/export.xlsx` — el cuerpo es un XLSX binario: se observa su TAMAÑO, **con
 * suelo de ruido**.
 *
 * **Las tres cifras que justifican el 64, medidas el 2026-09-14 sobre BD efímera:**
 *
 * | Qué | Valor |
 * |---|---|
 * | Ruido del instrumento (N=40 de la MISMA consulta, ~80 s) | **18 bytes** (12 valores distintos) |
 * | Señal más PEQUEÑA que `filtra` necesita distinguir (sin filtro 7 391 vs `raw` 7 246) | **145 bytes** |
 * | Señal entre dos tokens (`raw` 7 246 vs `graded` 6 738) | **508 bytes** |
 *
 * `64` deja **3.5×** de holgura sobre el ruido medido y se queda **2.3×** por debajo de la señal más
 * pequeña. Si algún día el fixture encoge hasta que esas dos se crucen, la fila se pondrá roja —
 * y la salida NO será subir el umbral: será sembrar más filas o dejar de observar bytes.
 */
const OBS_XLSX: Obs = {
  huella: (res) => `bytes=${res.text.length}`,
  hayDatos: (res) => res.text.length > 0,
  distancia: (a, b) => Math.abs(Number(a.slice(6)) - Number(b.slice(6))),
  ruido: 64,
};
/** `GET /admin/reports/pricing-brackets` — `{ sale?, buy? }`: el eje decide qué MITAD se emite. */
const OBS_BRACKETS: Obs = {
  huella: (res) => JSON.stringify(res.body),
  hayDatos: (res) => {
    const b = res.body as unknown as { sale?: unknown[]; buy?: unknown[] };
    return (b?.sale?.length ?? 0) + (b?.buy?.length ?? 0) > 0;
  },
};

/**
 * ⭐ `EQ-D1` lote 2 — `GET /vault/portfolio/history?range=` responde `{range, points, change}`: ⛔ sin
 * `data` ni `total`, así que `OBS_LISTA` daría `n=-1|null` para TODO rango (huella constante ⇒ `filtra`
 * no observable, verde por omisión). Se observa la **serie de puntos**, que es lo que el `?range=`
 * cambia (una ventana más ancha trae más puntos). Determinista (orden `asOfDate asc`, sin `now()` en el
 * cuerpo) ⇒ ruido `0`.
 */
const OBS_HISTORY: Obs = {
  huella: (res) => JSON.stringify((res.body as unknown as { points?: unknown[] })?.points ?? null),
  hayDatos: (res) => ((res.body as unknown as { points?: unknown[] })?.points?.length ?? 0) > 0,
};

/** Las respuestas extra que la propiedad `filtra` necesita (no filtrar, y el token alterno). */
type Extra = { base?: ApiRes; alterno?: ApiRes };

interface Ctx {
  setId: string;
  /** `:userId` de las rutas admin de bóveda — el CLIENTE del fixture, no el admin. */
  userId: string;
}

/**
 * ⭐ **EL REGISTRO — 43 filas: 26 que transcriben §0-Q punto 4 + 6 de la bóveda + 4 de `EQ-D1` lote 1 + 1 de `EQ-D2` + 1 de `EQ-D3` + 5 de `EQ-D1` LOTE 2.**
 *
 * Las **26 transcritas** son las 24 de la tabla de §0-Q punto 4, el `?sort=` que esa tabla registra
 * en su última columna como «no es filtro: es ORDEN — punto 6», y el `?origin=` de `sealed-products`.
 * Las **6** de `EQ-D0` (la bóveda) y las **5** de `EQ-D1` LOTE 2 (este pase: `?sort=` del índice
 * master set ×3, `?sort=` de `/admin/vaults`, `?range=` de `/vault/portfolio/history`) son conducta
 * YA conforme cuya **fila de §0-Q todavía no existe**: van marcadas `filaEn0Q: 'PENDIENTE-ARQUITECTO'`
 * (11 en total). Las **4** de `EQ-D1` lote 1 (`?kind=`, `?scope=`, `?sort=` de los dos catálogos
 * públicos), la **1** de `EQ-D2` (`?state=` de `sealed-price-status`, M11 §10) y la **1** de `EQ-D3`
 * (`?productType=` de `pending-publish`, M11) SÍ tienen fila de §0-Q (el arquitecto la escribió) ⇒
 * van `transcrita`.
 *
 * ⚠️ **`R3`: el conteo va fijado con un literal en el trinquete**, no escrito aquí y ya. Este
 * docstring decía «25 filas» cuando había 32 — y el pase entero defiende que *un número sí falla y
 * una fecha no*. Si el registro crece, el trinquete lo dice antes que esta prosa.
 *
 * Es una afirmación de **clase (A) — decisión**, y por eso sí se transcribe: cambia solo cuando el
 * arquitecto lo decide. Lo que ⛔ **no** se transcribe es el **dominio** de una clase E: ése se
 * **deriva** del enum de Prisma (§0-Q punto 3), que es la diferencia entre este registro y el censo
 * que la v1.73 retiró.
 */
const REGISTRO: readonly AxisRow[] = [
  { route: 'GET /admin/orders', param: 'status', clazz: 'E', allowed: Object.values(OrderStatus), valid: 'pending', alterno: 'settled', auth: 'admin', echoValue: false },
  { route: 'GET /admin/disputes', param: 'status', clazz: 'E', allowed: Object.values(DisputeStatus), valid: 'abierta', alterno: 'resuelta_recompra', auth: 'admin', echoValue: false },
  { route: 'GET /admin/shipments', param: 'status', clazz: 'E', allowed: Object.values(ShipmentStatus), valid: 'solicitado', alterno: 'entregado', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/items', param: 'status', clazz: 'E', allowed: Object.values(InventoryStatus), valid: 'in_stock', alterno: 'listed', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/items', param: 'ownerType', clazz: 'E', allowed: Object.values(OwnerType), valid: 'customer', alterno: 'platform', auth: 'admin', echoValue: false },
  // ⚠️ `details.field` = `"zone"` (el query param), NO `"location.zone"` (la ruta de Prisma).
  { route: 'GET /admin/inventory/items', param: 'zone', clazz: 'E', allowed: Object.values(VaultZone), valid: 'customer_custody', alterno: 'platform_stock', auth: 'admin', echoValue: false },
  // ⚠️ `valid: 'reverse_holo'` y no `'normal'`: el fixture es 15/15 `normal` ⇒ `?finish=normal` devuelve
  // la lista ENTERA y la fila salía verde con y sin filtro. `alterno` recupera la discriminación.
  { route: 'GET /admin/inventory/items', param: 'finish', clazz: 'E', allowed: Object.values(Finish), valid: 'reverse_holo', alterno: 'normal', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/items', param: 'productType', clazz: 'E', allowed: Object.values(ProductType), valid: 'graded', alterno: 'raw', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/pending-publish', param: 'acquisitionType', clazz: 'E', allowed: Object.values(AcquisitionType), valid: 'compra', alterno: 'buylist', auth: 'admin', echoValue: false },
  // ⭐ `D-EQ-2` · CLASE L: `location | price` no existe en el schema — nombra QUÉ LE FALTA a la fila.
  { route: 'GET /admin/inventory/pending-publish', param: 'missing', clazz: 'L', allowed: PENDING_PUBLISH_MISSING_VALUES, valid: 'price', alterno: 'location', auth: 'admin', echoValue: false },
  // ⭐ **`EQ-D3` (este pase, M11) — `?productType=`: el eje que la cola de «Listas para publicar» de
  // M11 monta con `productType=sealed` y que HASTA HOY el endpoint NO tenía**, así que NestJS lo
  // ignoraba y la cola devolvía TODO — una carta SUELTA (`raw`) se colaba en la cola «filtrada a
  // sellado». Clase **E** derivada de `enum ProductType` (⛔ no se transcribe el dominio; se deriva),
  // exactamente como el `?productType=` del drill-down de items y el del export.xlsx (dos y una filas
  // más arriba). ⚠️ `valid: 'sealed'` y no `'raw'`: la única pieza pendiente del fixture (`E2E-STK-0001`)
  // es `raw`, así que `?productType=raw` devolvería la cola ENTERA (verde con y sin filtro, el agujero de
  // `QA-M3`). `sealed` la EXCLUYE ⇒ el resultado cambia respecto de no filtrar; `alterno: 'raw'` recupera
  // la discriminación. Es el mismo perfil que la fila hermana `acquisitionType` (`valid` selecciona el
  // subconjunto que NO trae la suelta). ⛔ sin `echoValue`: eje NUEVO, no de los seis públicos legados.
  { route: 'GET /admin/inventory/pending-publish', param: 'productType', clazz: 'E', allowed: Object.values(ProductType), valid: 'sealed', alterno: 'raw', auth: 'admin', echoValue: false },
  // El cuerpo es un XLSX binario: no hay `data` que contar ⇒ se observa su TAMAÑO (`OBS_XLSX`).
  { route: 'GET /admin/inventory/export.xlsx', param: 'productType', clazz: 'E', allowed: Object.values(ProductType), valid: 'raw', alterno: 'graded', obs: OBS_XLSX, auth: 'admin', echoValue: false },
  // ⭐ `D-EQ-2` · CLASE E derivada: `enum SealedGroupKind` existe en el schema ⇒ ⛔ no se transcribe.
  { route: 'GET /admin/inventory/sealed-products', param: 'origin', clazz: 'E', allowed: Object.values(SealedGroupKind), valid: 'set_main', alterno: 'promo_collection', auth: 'admin', echoValue: false, extra: (c) => `setId=${c.setId}` },
  { route: 'GET /admin/users', param: 'status', clazz: 'E', allowed: Object.values(UserStatus), valid: 'blocked', alterno: 'active', auth: 'admin', echoValue: false },
  { route: 'GET /admin/users', param: 'kycStatus', clazz: 'E', allowed: Object.values(KycStatus), valid: 'pending', alterno: 'none', auth: 'admin', echoValue: false },
  {
    route: 'GET /admin/buylist',
    param: 'status',
    clazz: 'E',
    allowed: Object.values(SellRequestStatus),
    valid: 'pagada',
    alterno: 'cotizada',
    auth: 'admin',
    echoValue: false,
    csv: true,
    excepciones: {
      cota: {
        motivo:
          '⚠️ HALLAZGO de `C-EQ-1`, NO arreglado en este pase (no es uno de los cuatro ejes de ' +
          '`D-EQ-2`). El eje CSV arma `details.invalidStatus` con los tokens CRUDOS, sin pasar por ' +
          '`assertEnumFilter`, así que la cota del eco (§0-Q punto 2) NO se le aplica: 5 KB de ' +
          'entrada vuelven íntegros. Es la misma amplificación de `P-89.C1`, aquí con sesión admin. ' +
          'Dueño: backend, stream «Catálogo y precios» (`buylist/buylist.service.ts`).',
        hoy: (res) => {
          expect(res.status).toBe(400);
          // El valor vuelve ÍNTEGRO: es exactamente lo que la cota existe para impedir.
          expect(res.text.length).toBeGreaterThan(5000);
        },
      },
    },
  },
  { route: 'GET /admin/pricing/pending', param: 'context', clazz: 'E', allowed: Object.values(PendingPriceContext), valid: 'catalog', alterno: 'inventory', auth: 'admin', echoValue: false },
  // ⭐ `D-EQ-2` · CLASE E derivada: `enum PendingPriceReason` sobre COLUMNA PERSISTIDA E INDEXADA.
  { route: 'GET /admin/pricing/pending', param: 'reason', clazz: 'E', allowed: Object.values(PendingPriceReason), valid: 'no_market', alterno: 'premium_at_floor', auth: 'admin', echoValue: false },
  {
    route: 'GET /admin/pricing/bounties',
    param: 'state',
    clazz: 'L',
    allowed: BOUNTY_STATE_VALUES,
    // El fixture de esta suite siembra una fila `rebasada` y otra `completada` (ver `sembrarFixture`).
    valid: 'rebasada',
    alterno: 'completada',
    auth: 'admin',
    echoValue: false,
    excepciones: {
      sinNormalizar: {
        motivo:
          '⚠️ HALLAZGO de `C-EQ-1`, NO arreglado en este pase. `parseStates` hace `trim()` de CADA ' +
          'token, así que `?state=%20activa` FILTRA. §0-Q punto 5 recorta el espacio solo donde es ' +
          '**sintaxis de lista** (la coma de un eje CSV), y este eje NO es CSV — medido: ' +
          '`?state=activa,apagada` ⇒ `400` (no parte por coma; es REPETIBLE, `?state=a&state=b`). ' +
          'Luego el espacio rodea al TOKEN, no al separador ⇒ §0-Q punto 1 manda `400`. ' +
          'Dueño: backend, stream «Catálogo y precios» (`pricing/admin-bounties.controller.ts`).',
        hoy: (res) => expect(res.status).toBe(200),
      },
      cota: {
        motivo:
          '⚠️ HALLAZGO de `C-EQ-1`, NO arreglado en este pase. El `throw` inline de `parseStates` ' +
          'interpola el valor crudo en el `message` sin la cota del eco (§0-Q punto 2). Mismo ' +
          'dueño y mismo fichero que la excepción de arriba: las dos las cierra migrar `?state=` al ' +
          'helper único, que es un cambio de FORMA del eje repetible ⇒ arquitecto (regla 9).',
        hoy: (res) => {
          expect(res.status).toBe(400);
          expect(res.text.length).toBeGreaterThan(5000);
        },
      },
    },
  },
  { route: 'GET /admin/pricing/bounties', param: 'finish', clazz: 'E', allowed: Object.values(Finish), valid: 'normal', alterno: 'reverse_holo', auth: 'admin', echoValue: false },
  {
    // §0-Q punto 6: un `?sort=` **no es un filtro**, es un ORDEN CON DEFAULT. Su fila 1 es distinta
    // (vacío ⇒ el default declarado, no «no filtra»), pero observable igual: `200`. Las otras dos
    // filas son idénticas, incluida ⛔ la prohibición del *clamp* silencioso.
    route: 'GET /admin/pricing/bounties',
    param: 'sort',
    clazz: 'ORDEN',
    allowed: ADMIN_BOUNTY_SORT_VALUES,
    // ⚠️ `valid: 'price_desc'` y no `'attention_first'`: medido, `attention_first` ES el default ⇒ su
    // salida es **idéntica** a la de `?sort=` vacío y la fila no podría distinguir «ordena» de «no
    // hace nada». `alterno` vuelve a ser el default, así que la pareja prueba que el token MANDA.
    valid: 'price_desc',
    alterno: 'attention_first',
    auth: 'admin',
    echoValue: false,
    excepciones: {
      cota: {
        motivo:
          '⚠️ HALLAZGO de `C-EQ-1`, NO arreglado en este pase. `parseSort` interpola el valor crudo ' +
          'en el `message` sin la cota del eco (§0-Q punto 2, que la exige «dondequiera que el valor ' +
          'recibido se devuelva al cliente»). Mismo fichero y mismo dueño que `?state=`.',
        hoy: (res) => {
          expect(res.status).toBe(400);
          expect(res.text.length).toBeGreaterThan(5000);
        },
      },
    },
  },
  // ⭐ `D-EQ-2` · CLASE L: `rg 'enum .*[Aa]xis' schema.prisma` ⇒ 0. Es un MODO de la consulta.
  // `{ sale?, buy? }`: el eje decide qué MITAD se emite, no cuántas filas ⇒ `OBS_BRACKETS`.
  { route: 'GET /admin/reports/pricing-brackets', param: 'axis', clazz: 'L', allowed: PRICING_BRACKETS_AXIS_VALUES, valid: 'sale', alterno: 'buy', obs: OBS_BRACKETS, auth: 'admin', echoValue: false },
  {
    route: 'GET /catalog/cards',
    param: 'productType',
    clazz: 'R',
    allowed: Object.values(ProductType).filter((v) => v !== 'sealed'),
    valid: 'graded',
    alterno: 'raw',
    auth: 'public',
    echoValue: true,
    excepciones: {
      error: {
        motivo:
          '⛔ `D-EQ-3` — dueño **FRONTEND**, y va PRIMERO: el orden NO es negociable. §0-Q declara ' +
          'este dominio SIN `sealed` (clase R, cláusula en §2: `/catalog/cards` es la rejilla de ' +
          'SINGLES), pero empezar a `400` antes de que el front deje de mandarlo convierte un enlace ' +
          'profundo que hoy da «rejilla vacía» en **«pantalla rota»**. Hoy `details.allowed` trae ' +
          'los TRES valores del enum, `sealed` incluido.',
        hoy: (res) => {
          expect(res.status).toBe(400);
          expect(res.body.error.details.allowed).toContain('sealed');
        },
      },
    },
  },
  { route: 'GET /catalog/cards', param: 'finish', clazz: 'E', allowed: Object.values(Finish), valid: 'reverse_holo', alterno: 'normal', auth: 'public', echoValue: true },
  // ⛔ SIN `alterno`: `ACCEPTED_RAW_CONDITIONS` es `['NM']` (`business-rules.ts:44`, política de
  // PROJECT.md §E) — no hay segundo token con el que discriminar. Lo vigila el test de coherencia.
  { route: 'GET /catalog/cards', param: 'condition', clazz: 'R', allowed: ACCEPTED_RAW_CONDITIONS, valid: 'NM', auth: 'public', echoValue: true },
  { route: 'GET /catalog/sealed', param: 'sealedSubtype', clazz: 'E', allowed: Object.values(SealedSubtype), valid: 'box', alterno: 'etb', auth: 'public', echoValue: true },
  { route: 'GET /catalog/sealed', param: 'condition', clazz: 'E', allowed: Object.values(SealedCondition), valid: 'mint', alterno: 'minor_box_damage', auth: 'public', echoValue: true },

  // ==========================================================================================
  // ⭐⭐ `EQ-D0` / `P-93` — LA BÓVEDA, que hasta hoy IGNORABA EN SILENCIO los filtros del CLIENTE.
  //
  // Las seis filas salen de `SIN_CLASE_DECLARADA` (22 → 16) porque su **conducta** ya cumple §0-Q:
  // se arregló en `vault.service.ts` (un `parseEnumFilter` por eje y un `switch` exhaustivo en vez
  // del `else` que clampaba). Lo que NO se arregló aquí —y no se podía— es la **fila de §0-Q punto
  // 4**: escribirla es cambiar el contrato ⇒ arquitecto (regla 9). Por eso van marcadas
  // `PENDIENTE-ARQUITECTO`: el registro dice **lo que son**, no lo que convendría que fueran.
  //
  // Clases MEDIDAS, no elegidas: `sealedSubtype`/`condition` son **E** derivadas de los enums de
  // Prisma `SealedSubtype`/`SealedCondition` — el MISMO nombre de eje sobre el MISMO enum que
  // `/catalog/sealed`, que §0-Q ya registra como E (dos filas más arriba). `sort` es **ORDEN** con
  // dominio de clase L declarado en la línea del endpoint del contrato (§3), con su paridad a dos
  // bandas abajo. ⛔ Ninguna lleva `echoValue`: no son de los seis públicos.
  // ==========================================================================================
  { route: 'GET /vault/sealed', param: 'sealedSubtype', clazz: 'E', allowed: Object.values(SealedSubtype), valid: 'box', alterno: 'etb', auth: 'customer', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /vault/sealed', param: 'condition', clazz: 'E', allowed: Object.values(SealedCondition), valid: 'mint', alterno: 'minor_box_damage', auth: 'customer', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /vault/sealed', param: 'sort', clazz: 'ORDEN', allowed: VAULT_SEALED_SORT_VALUES, valid: 'count_desc', alterno: 'name_asc', auth: 'customer', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /admin/vaults/:userId/sealed', path: (c) => `/admin/vaults/${c.userId}/sealed`, param: 'sealedSubtype', clazz: 'E', allowed: Object.values(SealedSubtype), valid: 'box', alterno: 'etb', auth: 'admin', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /admin/vaults/:userId/sealed', path: (c) => `/admin/vaults/${c.userId}/sealed`, param: 'condition', clazz: 'E', allowed: Object.values(SealedCondition), valid: 'mint', alterno: 'minor_box_damage', auth: 'admin', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /admin/vaults/:userId/sealed', path: (c) => `/admin/vaults/${c.userId}/sealed`, param: 'sort', clazz: 'ORDEN', allowed: VAULT_SEALED_SORT_VALUES, valid: 'count_desc', alterno: 'name_asc', auth: 'admin', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },

  // ==========================================================================================
  // ⭐⭐ `EQ-D1` (este pase) — LOTE no-dinero migrado a `parseEnumFilter`. Su fila de §0-Q punto 4
  // SÍ existe (el arquitecto la escribió en este mismo pase: `?sort=`/`?range=` declarados y
  // `?kind=`/`?scope=` con su `allowed` literal), así que van `transcrita` (el default), NO
  // `PENDIENTE-ARQUITECTO`. Salen de `SIN_CLASE_DECLARADA` (16 → 12).
  //
  //  - `?kind=` (envíos) y `?scope=` (auditoría): clase **R** — subconjunto semántico fijado por el
  //    contrato (§M4 / §M6), NO un enum de Prisma. Antes: `kind` se ignoraba en silencio y `scope`
  //    se clampaba a `target`.
  //  - `?sort=` de los DOS catálogos públicos: **ORDEN** (§0-Q punto 6) con dominio clase L declarado
  //    en la línea del endpoint (§2 / §2-S). Antes caían a su default ante basura (clamp silencioso).
  //    ⛔ Ninguno lleva `echoValue`: son ejes NUEVOS, no de los seis públicos legados (§0-Q punto 2).
  // ==========================================================================================
  { route: 'GET /admin/shipments', param: 'kind', clazz: 'R', allowed: SHIPMENT_KIND_VALUES, valid: 'vault_withdrawal', alterno: 'guest_direct_ship', auth: 'admin', echoValue: false },
  // ⭐ **§M4-PREP (v1.78) — `?destination=` de «Pedidos a preparar»** (`GET …/picking-list`).
  //
  // Clase **L** y ⛔ no **R**: `PreparationDestination` es un **TIPO DE DTO**, no un subconjunto de
  // ningún enum de Prisma — sus tokens (`vault`/`ship`) **no coinciden** con los de `FulfillmentMode`
  // (`vault`/`direct_ship`), del que se DERIVA por un mapeo explícito del backend. Por eso ⛔ no entra
  // en la paridad de enums y su dominio se toma de la constante del servicio, no del schema.
  //
  // `filaEn0Q: 'PENDIENTE-ARQUITECTO'` — medido el 2026-09-22: el contrato declara el eje y su `400`
  // en **§M4-PREP** («misma doctrina §0-Q que `?kind=`»), pero la **tabla del registro de §0-Q punto
  // 4 NO tiene su fila**. Escribirla es cambiar §0-Q ⇒ arquitecto (regla 9). La CONDUCTA sí se mide
  // aquí, por HTTP, como en las demás.
  //
  // ⚠️ **`valid: 'vault'` y NO `'ship'`, y el motivo es una medición, no una preferencia:** bajo el
  // modelo actual **toda** fila de esta cola es `destination='ship'` (las órdenes
  // `fulfillmentMode='vault'` no generan `ShipmentRequest`), así que `?destination=ship` devuelve la
  // cola ENTERA y la fila saldría **verde con y sin filtro** — el agujero exacto de `QA-M3`. Con
  // `vault` el resultado **cambia** respecto de no filtrar (cubeta vacía a propósito) y
  // `alterno: 'ship'` recupera la discriminación. El fixture siembra el envío en `picking` del
  // bloque (g-bis) para que «hay datos SIN filtrar» sea cierto.
  { route: 'GET /admin/shipments/picking-list', param: 'destination', clazz: 'L', allowed: PREPARATION_DESTINATION_VALUES, valid: 'vault', alterno: 'ship', auth: 'admin', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /admin/users/:id/audit', path: (c) => `/admin/users/${c.userId}/audit`, param: 'scope', clazz: 'R', allowed: USER_AUDIT_SCOPE_VALUES, valid: 'actor', alterno: 'both', auth: 'admin', echoValue: false },
  // ⚠️ `valid: 'price_desc'` y no `'price_asc'`: los dos sellados del fixture comparten `createdAt`
  // (mismo `createMany`), así que `newest` (default) = orden de inserción = price ASC ⇒ `price_asc`
  // salía **idéntico** a no ordenar y la fila no distinguía «ordena» de «no hace nada». `price_desc`
  // es el reverso y sí cambia el resultado; `alterno: 'price_asc'` discrimina del reverso.
  { route: 'GET /catalog/sealed', param: 'sort', clazz: 'ORDEN', allowed: SEALED_LIST_SORT_VALUES, valid: 'price_desc', alterno: 'price_asc', auth: 'public', echoValue: false },
  { route: 'GET /catalog/cards', param: 'sort', clazz: 'ORDEN', allowed: CATALOG_CARDS_SORT_VALUES, valid: 'price_asc', alterno: 'price_desc', auth: 'public', echoValue: false },

  // ==========================================================================================
  // ⭐⭐ `EQ-D2` (este pase) — el eje `?state=` de `GET /admin/inventory/sealed-price-status` (M11 §10),
  // que QA rechazó por NO estar registrado (huérfano de `C-EQ-1`). Clase **L**: `SealedPriceState` es
  // una UNIÓN PURA (⛔ sin columna en `schema.prisma`, `rg 'enum .*SealedPriceState' ⇒ 0`), fuente única
  // en §Enums; su fila de §0-Q punto 4 la escribió el arquitecto en este pase (clase L ya establecida,
  // como `?missing=`/`?axis=`) ⇒ va `transcrita`. Ya cableado con `parseEnumFilter('state', …)` en
  // `inventory.controller.ts` ⇒ ausente ⇒ `200`, fuera de dominio ⇒ `400` con `details.{field,allowed}`,
  // ⛔ sin `echoValue` (eje NUEVO, no de los seis públicos legados). `valid`/`alterno` discriminan dos
  // sets sembrados en estados distintos (bloque (i) del fixture).
  // ==========================================================================================
  { route: 'GET /admin/inventory/sealed-price-status', param: 'state', clazz: 'L', allowed: SEALED_PRICE_STATE_VALUES, valid: 'unmapped', alterno: 'mapped_unpriced', auth: 'admin', echoValue: false },

  // ==========================================================================================
  // ⭐⭐ `EQ-D1` LOTE 2 (este pase) — CINCO ejes de ORDEN/RANGO SIN DINERO que hoy CLAMPABAN en
  // silencio al default (§0-Q punto 6/1 lo prohíbe). Migrados a `parseEnumFilter`: fuera de dominio
  // ⇒ `400` con `details.{field,allowed}`, ausente/vacío ⇒ el default (`200`), ⛔ sin `echoValue`.
  //
  // ⛔ **Van `PENDIENTE-ARQUITECTO`, NO `transcrita`** — al revés que las 4 de EQ-D1 lote 1: aquí el
  // arquitecto **todavía NO ha escrito** su fila de §0-Q punto 4 (son MODOS de la consulta sin enum
  // homónimo en el schema, clase L/ORDEN, y el contrato es del arquitecto por regla 9). El registro
  // dice **lo que son**: conducta YA conforme (medida aquí por HTTP), fila de §0-Q pendiente. Es el
  // mismo patrón que las 6 de la bóveda (`EQ-D0`).
  //
  //  - `?sort=` del índice master set — MISMO dominio (`MASTER_SET_SORT_VALUES`) en sus TRES
  //    consumidores: `/admin/inventory/master-sets`, `/admin/vaults/:userId/master-sets` y
  //    `/vault/master-sets`. Un solo validador (`master-set.service.ts` `sortSummaries`).
  //  - `?sort=` de `/admin/vaults` — dominio propio (`ADMIN_VAULTS_SORT_VALUES`).
  //  - `?range=` de `/vault/portfolio/history` — clase L (unión de literales, `normalizeRange`). Su
  //    respuesta es `{range, points, change}` (⛔ sin `data`/`total`) ⇒ se observa `points`
  //    (`OBS_HISTORY`), igual que el XLSX y `pricing-brackets` declaran su propia observación.
  // ⚠️ Los otros 7 de `SIN_CLASE_DECLARADA` quedan fuera de este lote a propósito: `?report=` ×2 y
  // `graded-estimates/review?reason=` TOCAN DINERO (3 gates aparte), `?sealedSubtype=` de
  // `/catalog/cards` es `D-EQ-3` (frontend primero), y los 3 `?range=` de `value-history` viven en
  // `catalog` (otro work stream — este pase no lo toca).
  // ==========================================================================================
  { route: 'GET /admin/inventory/master-sets', param: 'sort', clazz: 'ORDEN', allowed: MASTER_SET_SORT_VALUES, valid: 'pieces_desc', alterno: 'completion_asc', auth: 'admin', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /admin/vaults/:userId/master-sets', path: (c) => `/admin/vaults/${c.userId}/master-sets`, param: 'sort', clazz: 'ORDEN', allowed: MASTER_SET_SORT_VALUES, valid: 'pieces_desc', alterno: 'completion_asc', auth: 'admin', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /vault/master-sets', param: 'sort', clazz: 'ORDEN', allowed: MASTER_SET_SORT_VALUES, valid: 'pieces_desc', alterno: 'completion_asc', auth: 'customer', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /admin/vaults', param: 'sort', clazz: 'ORDEN', allowed: ADMIN_VAULTS_SORT_VALUES, valid: 'pieces_desc', alterno: 'name_asc', auth: 'admin', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
  { route: 'GET /vault/portfolio/history', param: 'range', clazz: 'L', allowed: PORTFOLIO_HISTORY_RANGE_VALUES, valid: 'all', alterno: '5d', obs: OBS_HISTORY, auth: 'customer', echoValue: false, filaEn0Q: 'PENDIENTE-ARQUITECTO' },
];

/**
 * `GET /admin/orders` ⇒ `/admin/orders` (el arnés ya antepone `/api/v1`). Si la fila declara `path`,
 * manda ése: `route` lleva el `:userId` literal porque es la llave del censo, no una URL.
 */
const pathOf = (row: AxisRow, ctx: Ctx) =>
  row.path ? row.path(ctx) : row.route.slice(row.route.indexOf(' ') + 1);

function url(row: AxisRow, ctx: Ctx, value: string): string {
  const extra = row.extra ? `${row.extra(ctx)}&` : '';
  return `${pathOf(row, ctx)}?${extra}${row.param}=${value}`;
}

const idOf = (row: AxisRow) => `${row.route}?${row.param}=`;

/** Las filas que SÍ se exigen en una propiedad dada (las demás van al bloque de excepciones). */
const exigidas = (p: Propiedad) => REGISTRO.filter((r) => !r.excepciones?.[p]).map((r) => [idOf(r), r] as const);
/** Las filas con excepción MEDIDA en esa propiedad: se fija su conducta de HOY. */
const exceptuadas = (p: Propiedad) => REGISTRO.filter((r) => r.excepciones?.[p]).map((r) => [idOf(r), r] as const);

const LARGO = 'A'.repeat(5000);
const BASURA = 'no_soy_un_token_valido';

/**
 * ⭐⭐ **EL FIXTURE DE `C-EQ-1` — sin él, «filtra» no se puede medir y el verde es por OMISIÓN.**
 *
 * ### De dónde sale (medido el 2026-09-13 sobre BD virgen, antes de escribirlo)
 * Se recorrieron los **26** ejes que el registro tenía entonces, contando el resultado **sin
 * filtrar** y el de **cada** token de su dominio. Ocho devolvían **cero filas con y sin filtro**, así
 * que la mutación *«valida y tira el valor»* era **invisible** en ellos por construcción — incluido
 * `?origin=`, que es justo donde QA plantó `QA-M3`. Con la siembra de abajo quedaron **26/26
 * medibles**; las **6 de la bóveda** entraron después (`EQ-D0`) con su propia siembra (bloque `f`),
 * y las mide el mismo bucle de propiedades. Total hoy: **32/32**, sin marcas de «no medible».
 *
 * ⚠️ El total NO se afirma aquí: lo fija el trinquete con un literal (`R3`).
 *
 * ### Reglas que se respetan aquí, y por qué
 *  - **Se siembra lo MÍNIMO y se nombra**: todo lo que crea lleva el prefijo `CEQ1-` (o el
 *    `externalId` `ceq1-fixture-set`), así que `limpiarFixture` puede barrerlo **sin adivinar**.
 *  - **Es idempotente**: limpia ANTES de crear. Una corrida que se cayó a mitad no envenena la
 *    siguiente — y este proyecto ya pagó una contaminación de fixture entre specs (`vault-shipments`).
 *  - **Set PROPIO, no el del seed**: `?origin=` necesita `SealedProduct`s, y colgarlos del set del
 *    fixture compartido volteaba su `needsSync` a `false` para todas las demás suites. Un set propio
 *    no le cambia el mundo a nadie.
 *  - ⛔ **No toca dinero de nadie**: filas nuevas, propias y efímeras; ningún `update` sobre datos
 *    del seed.
 */
const CEQ1_SET_EXTERNAL_ID = 'ceq1-fixture-set';
const CEQ1_SEALED_PRODUCT_IDS = [990001, 990002];
const CEQ1_BOUNTY_PRICES = [50_000, 900_000];
// ⭐ `EQ-D2` — DOS sets propios para `GET /admin/inventory/sealed-price-status?state=`: uno `unmapped`
//    (producto con grupo NO enlazado) y otro `mapped_unpriced` (grupo enlazado vía `SealedSetGroup`
//    pero sin precio gateado — sets sintéticos sin cartas ⇒ sin ancla ⇒ sin precio, §10 money-safe).
//    `releaseDate` en el futuro lejano para que dominen la página 1 (orden `releaseDate desc`) y la
//    huella de `?state=` sea observable con independencia de cuántos sets tenga el seed.
const CEQ1_PRICE_SET_EXTERNAL_IDS = ['ceq1-price-unmapped', 'ceq1-price-mapped'];
const CEQ1_PRICE_PRODUCT_IDS = [990201, 990202];
const CEQ1_PRICE_MAPPED_GROUP_ID = 990302;
// ⭐ `EQ-D1` LOTE 2 — DOS sets propios con cartas para que el índice master set del CLIENTE reordene:
//    A (viejo, 1 carta, 3 piezas ⇒ pieces=3/completion=100%) y B (nuevo, 3 cartas, 1 pieza ⇒
//    pieces=1/completion=33%). `release_desc`=[B,A], `pieces_desc`=[A,B] (⇒ `valid` cambia el orden),
//    `completion_asc`=[B,A] (⇒ discrimina de `pieces_desc`). Cartas con `externalId` prefijo `CEQ1-`.
const CEQ1_MS_SET_EXTERNAL_IDS = ['ceq1-ms-antiguo', 'ceq1-ms-nuevo'];
// ⭐ `EQ-D1` LOTE 2 — `GET /admin/vaults?sort=`: DOS clientes propios SIN precio (valor 0) para que el
//    orden reordene entre `value_desc` (empata por nombre), `pieces_desc` y `name_asc`. `AAA` (1 pieza)
//    y `ZZZ` (5 piezas): value_desc/name_asc=[AAA,ZZZ], pieces_desc=[ZZZ,AAA]. Al ser propios y de valor
//    0, su reordenamiento es observable con independencia de qué clientes traiga el seed.
const CEQ1_VAULT_CUSTOMER_EMAILS = ['ceq1-vault-aaa@ceq1.local', 'ceq1-vault-zzz@ceq1.local'];
// ⭐ `EQ-D1` LOTE 2 — `GET /vault/portfolio/history?range=`: TRES snapshots del cliente a −100/−10/−2
//    días ⇒ `all`=3 puntos, `1m`=2, `5d`=1. Valores sentinela para barrer sin adivinar (⛔ el modelo
//    no tiene campo de texto que marcar).
const CEQ1_SNAPSHOT_CENTS = [990_010, 990_020, 990_030];

async function limpiarFixture(h: E2EHarness): Promise<void> {
  await h.prisma.dispute.deleteMany({ where: { description: { startsWith: 'CEQ1-' } } });
  // ⚠️ El envío `guest_direct_ship` (`EQ-D1` · `?kind=`) cuelga de un Order con `onDelete: Restrict`,
  //    así que el envío se borra ANTES que su orden.
  await h.prisma.shipmentRequest.deleteMany({ where: { carrier: { startsWith: 'CEQ1-' } } });
  await h.prisma.order.deleteMany({ where: { orderNumber: { startsWith: 'CEQ1-' } } });
  // ⭐ `EQ-D1` · `?scope=` — filas de auditoría sembradas para medir `target` vs `actor`.
  await h.prisma.auditLog.deleteMany({ where: { action: { startsWith: 'CEQ1-' } } });
  await h.prisma.inventoryItem.deleteMany({ where: { folio: { startsWith: 'CEQ1-' } } });
  // ⭐ `EQ-D1` LOTE 2 — cartas del índice master set: DESPUÉS de sus piezas (FK `cardId`), ANTES de sus
  //    sets (FK `setId`). Barrido por `externalId` prefijo `CEQ1-`.
  await h.prisma.card.deleteMany({ where: { externalId: { startsWith: 'CEQ1-' } } });
  // ⭐ `EQ-D1` LOTE 2 — los dos clientes propios de `?sort=` de `/admin/vaults`: sus piezas ya cayeron
  //    arriba (folio `CEQ1-`); ahora los usuarios. Sus snapshots caen por `onDelete: Cascade`.
  await h.prisma.user.deleteMany({ where: { email: { in: CEQ1_VAULT_CUSTOMER_EMAILS } } });
  // ⭐ `EQ-D1` LOTE 2 — snapshots del portafolio del cliente por valor sentinela (el modelo no tiene
  //    campo de texto que marcar; los cents sentinela no coinciden con nada del seed).
  await h.prisma.portfolioSnapshot.deleteMany({ where: { totalValueMxnCents: { in: CEQ1_SNAPSHOT_CENTS } } });
  // ⭐ `EQ-D2` — los dos sets de precio: borrar el `SealedProduct` (y el `SealedSetGroup` cae por
  //    `onDelete: Cascade` al borrar el `CardSet`) antes del set. Barrido por id/externalId, sin adivinar.
  await h.prisma.sealedProduct.deleteMany({ where: { tcgplayerProductId: { in: [...CEQ1_SEALED_PRODUCT_IDS, ...CEQ1_PRICE_PRODUCT_IDS] } } });
  await h.prisma.cardSet.deleteMany({ where: { externalId: { in: [CEQ1_SET_EXTERNAL_ID, ...CEQ1_PRICE_SET_EXTERNAL_IDS, ...CEQ1_MS_SET_EXTERNAL_IDS] } } });
  await h.prisma.variantPriceOverride.deleteMany({ where: { bountyPriceCents: { in: CEQ1_BOUNTY_PRICES } } });
}

/** Siembra y devuelve el contexto de rutas (`setId` propio + el `userId` del cliente del fixture). */
async function sembrarFixture(h: E2EHarness): Promise<Ctx> {
  await limpiarFixture(h);

  // (a) `GET /admin/inventory/sealed-products?origin=` — DOS presentaciones con `origin` distinto.
  //     Es el eje donde QA plantó `QA-M3`: sin estas dos filas, la mutación es invisible.
  const set = await h.prisma.cardSet.create({
    data: { externalId: CEQ1_SET_EXTERNAL_ID, name: 'C-EQ-1 fixture', series: 'CEQ1' },
  });
  await h.prisma.sealedProduct.createMany({
    data: [
      { setId: set.id, tcgplayerProductId: CEQ1_SEALED_PRODUCT_IDS[0], tcgplayerGroupId: 990101, name: 'CEQ1 caja', subtype: 'box', origin: 'set_main', active: true },
      { setId: set.id, tcgplayerProductId: CEQ1_SEALED_PRODUCT_IDS[1], tcgplayerGroupId: 990102, name: 'CEQ1 promo', subtype: 'etb', origin: 'promo_collection', active: true },
    ],
  });

  const card = await h.prisma.card.findFirstOrThrow({ select: { id: true } });
  const cliente = await h.prisma.user.findFirstOrThrow({ where: { email: E2E_USERS.customer.email }, select: { id: true } });

  // (b) `GET /catalog/sealed?sealedSubtype=` · `?condition=` — dos piezas SELLADAS de plataforma,
  //     `listed` y con `listPriceCents` (el catálogo solo lista lo que tiene precio resuelto > 0).
  await h.prisma.inventoryItem.createMany({
    data: [
      { folio: 'CEQ1-SELLADO-1', cardId: card.id, productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'mint', status: 'listed', ownerType: 'platform', listPriceCents: 123_400, acquisitionType: 'compra' },
      { folio: 'CEQ1-SELLADO-2', cardId: card.id, productType: 'sealed', sealedSubtype: 'etb', sealedCondition: 'minor_box_damage', status: 'listed', ownerType: 'platform', listPriceCents: 567_800, acquisitionType: 'compra' },
    ],
  });

  // (c) `GET /admin/pricing/bounties?state=` · `?finish=` · `?sort=` — dos filas M-30 en ESTADOS y
  //     acabados distintos. El `state` NO es columna: se deriva (`bounty-state.ts:56`), así que se
  //     siembran los insumos y se toma el estado que salga (medido: `rebasada` y `completada`).
  const cards = await h.prisma.card.findMany({ select: { id: true }, take: 2 });
  await h.prisma.variantPriceOverride.createMany({
    data: [
      { cardId: cards[0].id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', bountyEnabled: true, bountyPriceCents: CEQ1_BOUNTY_PRICES[0] },
      { cardId: cards[1]?.id ?? cards[0].id, productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo', bountyEnabled: false, bountyPriceCents: CEQ1_BOUNTY_PRICES[1], bountyCompletedAt: new Date() },
    ],
    skipDuplicates: true,
  });

  // (d) `GET /admin/disputes?status=` — dos disputas en estados distintos.
  const pieza = await h.prisma.inventoryItem.findFirstOrThrow({ where: { folio: 'CEQ1-SELLADO-1' }, select: { id: true } });
  const manana = new Date(Date.now() + 86_400_000);
  await h.prisma.dispute.createMany({
    data: [
      { userId: cliente.id, inventoryItemId: pieza.id, status: 'abierta', description: 'CEQ1-fixture abierta', deadlineAt: manana },
      { userId: cliente.id, inventoryItemId: pieza.id, status: 'resuelta_recompra', description: 'CEQ1-fixture resuelta', deadlineAt: manana },
    ],
  });

  // (e) `GET /admin/shipments?status=` — dos solicitudes de envío en estados distintos. `carrier`
  //     lleva la marca `CEQ1-` porque es el campo libre que la limpieza puede barrer sin adivinar.
  const direccion = { line1: 'CEQ1 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX' };
  await h.prisma.shipmentRequest.createMany({
    data: [
      { userId: cliente.id, addressSnapshot: direccion, status: 'solicitado', shippingFeeCents: 9_900, priceConvention: 'IVA_EXCLUSIVE', carrier: 'CEQ1-fixture-a' },
      { userId: cliente.id, addressSnapshot: direccion, status: 'entregado', shippingFeeCents: 9_900, priceConvention: 'IVA_EXCLUSIVE', carrier: 'CEQ1-fixture-b' },
    ],
  });

  // (f) ⭐ `EQ-D0` — la BÓVEDA DEL CLIENTE (`/vault/sealed` y su hermana admin). Tres piezas y no
  //     dos: con dos grupos de una pieza y sin mercado, `value_desc`, `count_desc` y `name_asc`
  //     COINCIDEN y el eje de ORDEN no sería observable (el `QA-M3` del punto 6). Con dos `box` el
  //     conteo desempata, y con el nombre invertido respecto del conteo los dos órdenes son opuestos.
  await h.prisma.inventoryItem.createMany({
    data: [
      { folio: 'CEQ1-BOVEDA-1', cardId: card.id, productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'mint', sealedProductName: 'ZZZ Caja CEQ1', tcgplayerProductId: 970001, status: 'in_custody', ownerType: 'customer', ownerUserId: cliente.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
      { folio: 'CEQ1-BOVEDA-2', cardId: card.id, productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'mint', sealedProductName: 'ZZZ Caja CEQ1', tcgplayerProductId: 970001, status: 'in_custody', ownerType: 'customer', ownerUserId: cliente.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
      { folio: 'CEQ1-BOVEDA-3', cardId: card.id, productType: 'sealed', sealedSubtype: 'etb', sealedCondition: 'minor_box_damage', sealedProductName: 'AAA ETB CEQ1', tcgplayerProductId: 970002, status: 'in_custody', ownerType: 'customer', ownerUserId: cliente.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
    ],
  });

  // (g) ⭐ `EQ-D1` · `GET /admin/shipments?kind=` — el filtro parte por naturaleza del envío:
  //     `vault_withdrawal` = SIN orden (los dos de (e)); `guest_direct_ship` = CON orden. Sin al
  //     menos uno de cada, `?kind=` no discrimina. Se siembra UN pedido mínimo + su envío.
  const order = await h.prisma.order.create({
    data: {
      guestEmail: 'ceq1-guest@example.com',
      orderNumber: 'CEQ1-ORD-1',
      fulfillmentMode: 'direct_ship',
      // CHECK `Order_direct_ship_has_address_chk`: un pedido directo EXIGE dirección capturada.
      shippingAddressSnapshot: direccion,
      status: 'settled',
      subtotalCents: 100_000,
      processingFeeCents: 0,
      ivaCents: 16_000,
      totalCents: 116_000,
      priceConvention: 'IVA_EXCLUSIVE',
    },
  });
  await h.prisma.shipmentRequest.create({
    data: {
      userId: cliente.id,
      orderId: order.id, // ⇒ `guest_direct_ship` (el filtro parte por `orderId != null`)
      addressSnapshot: direccion,
      status: 'solicitado',
      shippingFeeCents: 9_900,
      priceConvention: 'IVA_EXCLUSIVE',
      carrier: 'CEQ1-fixture-c',
    },
  });

  // (g-bis) ⭐ §M4-PREP — `GET /admin/shipments/picking-list?destination=`. La cola proyecta SOLO
  //     `status='picking'` (fix QA #3) y los envíos de (e)/(g) están en `solicitado`/`entregado` ⇒
  //     sin esta fila la cola sale VACÍA y la propiedad `filtra` no es observable (verde por
  //     omisión). Es un RETIRO DE BÓVEDA (`orderId` null) ⇒ `destination='ship'`, que es lo que hace
  //     que `?destination=vault` devuelva vacío y discrimine. Marca `CEQ1-` en `carrier` para que
  //     `limpiarFixture` lo barra sin adivinar.
  await h.prisma.shipmentRequest.create({
    data: {
      userId: cliente.id,
      addressSnapshot: direccion,
      status: 'picking',
      shippingFeeCents: 9_900,
      priceConvention: 'IVA_EXCLUSIVE',
      carrier: 'CEQ1-fixture-picking',
    },
  });

  // (h) ⭐ `EQ-D1` · `GET /admin/users/:id/audit?scope=` — `target` (acciones SOBRE el cliente) y
  //     `actor` (acciones POR el cliente) tienen que devolver conjuntos DISTINTOS para que `?scope=`
  //     sea observable. Una fila de cada clase, con `createdAt` distinto (huella estable).
  await h.prisma.auditLog.createMany({
    data: [
      // target-only: acción SOBRE el cliente (entityType User, entityId = cliente), por otro actor.
      { action: 'CEQ1-target', entityType: 'User', entityId: cliente.id, actorUserId: null, createdAt: new Date(Date.now() - 60_000) },
      // actor-only: acción POR el cliente sobre otra entidad ⇒ NO aparece en scope `target`.
      { action: 'CEQ1-actor', entityType: 'Order', entityId: order.id, actorUserId: cliente.id, createdAt: new Date(Date.now() - 30_000) },
    ],
  });

  // (i) ⭐ `EQ-D2` · `GET /admin/inventory/sealed-price-status?state=` — DOS sets propios en estados
  //     DISTINTOS para que `?state=` sea observable (`unmapped` vs `mapped_unpriced`). El servicio hace
  //     rollup del PEOR estado por set (`sealed-product.service.ts`); `releaseDate` futuro los pone en la
  //     cabeza del orden `releaseDate desc` ⇒ su presencia/ausencia CAMBIA la huella con y sin filtro y
  //     entre tokens, sin depender de cuántos sets traiga el seed. Sin cartas ⇒ sin ancla ⇒ sin precio.
  const unmappedSet = await h.prisma.cardSet.create({
    data: { externalId: CEQ1_PRICE_SET_EXTERNAL_IDS[0], name: 'CEQ1 sin mapear', series: 'CEQ1', releaseDate: '2999-12-01' },
  });
  const mappedSet = await h.prisma.cardSet.create({
    data: { externalId: CEQ1_PRICE_SET_EXTERNAL_IDS[1], name: 'CEQ1 mapeado sin precio', series: 'CEQ1', releaseDate: '2999-11-01' },
  });
  await h.prisma.sealedProduct.createMany({
    data: [
      // `unmapped`: su grupo NO está enlazado (sin `SealedSetGroup`, `tcgcsvGroupId` null) ⇒ SIN emparejar.
      { setId: unmappedSet.id, tcgplayerProductId: CEQ1_PRICE_PRODUCT_IDS[0], tcgplayerGroupId: 990301, name: 'CEQ1 caja sin mapear', subtype: 'box', origin: 'set_main', active: true },
      // `mapped_unpriced`: su grupo SÍ está enlazado (abajo), pero sin ancla no hay precio gateado.
      { setId: mappedSet.id, tcgplayerProductId: CEQ1_PRICE_PRODUCT_IDS[1], tcgplayerGroupId: CEQ1_PRICE_MAPPED_GROUP_ID, name: 'CEQ1 caja mapeada', subtype: 'box', origin: 'set_main', active: true },
    ],
  });
  await h.prisma.sealedSetGroup.create({
    data: { setId: mappedSet.id, tcgplayerGroupId: CEQ1_PRICE_MAPPED_GROUP_ID, kind: 'set_main', label: 'CEQ1-fixture-mapped' },
  });

  // (j) ⭐ `EQ-D1` LOTE 2 · `?sort=` del índice master set (`/admin/inventory/master-sets`,
  //     `/admin/vaults/:userId/master-sets`, `/vault/master-sets`) — el CLIENTE necesita piezas
  //     (SINGLES, ⛔ no sellado: la agregación excluye `productType='sealed'`) en DOS sets que
  //     reordenen. Set A (viejo, 1 carta, 3 piezas) y set B (nuevo, 3 cartas, 1 pieza): `release_desc`
  //     y `completion_asc` dan [B,A]; `pieces_desc` da [A,B] ⇒ `valid=pieces_desc` cambia el orden y
  //     discrimina de `alterno=completion_asc`. (El seed solo le da singles en UN set ⇒ 1 fila ⇒ el
  //     orden no era observable; con estos dos, hay ≥3 filas que reordenan.)
  const msSetA = await h.prisma.cardSet.create({
    data: { externalId: CEQ1_MS_SET_EXTERNAL_IDS[0], name: 'CEQ1 MS antiguo', series: 'CEQ1', releaseDate: '2001-01-01' },
  });
  const msSetB = await h.prisma.cardSet.create({
    data: { externalId: CEQ1_MS_SET_EXTERNAL_IDS[1], name: 'CEQ1 MS nuevo', series: 'CEQ1', releaseDate: '2099-01-01' },
  });
  const msCardA = await h.prisma.card.create({
    data: { externalId: 'CEQ1-MS-A1', setId: msSetA.id, name: 'CEQ1 MS A1', number: '1' },
  });
  const msCardB = await h.prisma.card.create({
    data: { externalId: 'CEQ1-MS-B1', setId: msSetB.id, name: 'CEQ1 MS B1', number: '1' },
  });
  await h.prisma.card.createMany({
    data: [
      { externalId: 'CEQ1-MS-B2', setId: msSetB.id, name: 'CEQ1 MS B2', number: '2' },
      { externalId: 'CEQ1-MS-B3', setId: msSetB.id, name: 'CEQ1 MS B3', number: '3' },
    ],
  });
  await h.prisma.inventoryItem.createMany({
    data: [
      { folio: 'CEQ1-MS-A-1', cardId: msCardA.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', status: 'in_custody', ownerType: 'customer', ownerUserId: cliente.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
      { folio: 'CEQ1-MS-A-2', cardId: msCardA.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', status: 'in_custody', ownerType: 'customer', ownerUserId: cliente.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
      { folio: 'CEQ1-MS-A-3', cardId: msCardA.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', status: 'in_custody', ownerType: 'customer', ownerUserId: cliente.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
      { folio: 'CEQ1-MS-B-1', cardId: msCardB.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', status: 'in_custody', ownerType: 'customer', ownerUserId: cliente.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
    ],
  });

  // (k) ⭐ `EQ-D1` LOTE 2 · `GET /admin/vaults?sort=` — DOS clientes propios SIN precio (valor 0) para
  //     que el orden reordene entre value/pieces/name. `AAA` (1 pieza) y `ZZZ` (5 piezas): sin valor,
  //     `value_desc` empata por nombre ⇒ [AAA,ZZZ] = `name_asc`; `pieces_desc` ⇒ [ZZZ,AAA]. Así
  //     `valid=pieces_desc` cambia respecto de `value_desc` y discrimina de `alterno=name_asc`. Propios
  //     y de valor 0 ⇒ su reordenamiento es observable con independencia de qué clientes traiga el seed.
  const custAaa = await h.prisma.user.create({
    data: { email: CEQ1_VAULT_CUSTOMER_EMAILS[0], name: 'AAA CEQ1 Vault', role: 'customer', locale: 'es' },
  });
  const custZzz = await h.prisma.user.create({
    data: { email: CEQ1_VAULT_CUSTOMER_EMAILS[1], name: 'ZZZ CEQ1 Vault', role: 'customer', locale: 'es' },
  });
  await h.prisma.inventoryItem.createMany({
    data: [
      { folio: 'CEQ1-VAULT-AAA-1', cardId: card.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', status: 'in_custody', ownerType: 'customer', ownerUserId: custAaa.id, ownershipStatus: 'settled', acquisitionType: 'aportacion_en_especie' },
      ...[1, 2, 3, 4, 5].map((n) => ({
        folio: `CEQ1-VAULT-ZZZ-${n}`, cardId: card.id, productType: 'raw' as const, rawCondition: 'NM' as const, finish: 'normal' as const,
        status: 'in_custody' as const, ownerType: 'customer' as const, ownerUserId: custZzz.id, ownershipStatus: 'settled' as const, acquisitionType: 'aportacion_en_especie' as const,
      })),
    ],
  });

  // (l) ⭐ `EQ-D1` LOTE 2 · `GET /vault/portfolio/history?range=` — TRES snapshots del cliente a
  //     −100/−10/−2 días ⇒ `all`=3 puntos, `1m`(base)=2, `5d`=1. Con eso `valid=all` trae MÁS puntos
  //     que el default y `alterno=5d` MENOS ⇒ los tres rangos difieren. `@db.Date` ⇒ solo la fecha
  //     cuenta; valores sentinela (`CEQ1_SNAPSHOT_CENTS`) para el barrido.
  const diaMs = 86_400_000;
  const soloFecha = (offsetDias: number) => {
    const d = new Date(Date.now() - offsetDias * diaMs);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };
  await h.prisma.portfolioSnapshot.createMany({
    data: [
      { userId: cliente.id, asOfDate: soloFecha(100), totalValueMxnCents: CEQ1_SNAPSHOT_CENTS[0] },
      { userId: cliente.id, asOfDate: soloFecha(10), totalValueMxnCents: CEQ1_SNAPSHOT_CENTS[1] },
      { userId: cliente.id, asOfDate: soloFecha(2), totalValueMxnCents: CEQ1_SNAPSHOT_CENTS[2] },
    ],
    skipDuplicates: true,
  });

  return { setId: set.id, userId: cliente.id };
}

describe('⭐ `C-EQ-1` — conformidad §0-Q, tabla-dirigida por HTTP', () => {
  let h: E2EHarness;
  let adminToken: string;
  /** `/vault/sealed` es del CLIENTE: se mide con sesión de cliente, que es como la vive quien la sufre. */
  let clienteToken: string;
  let ctx: Ctx;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    clienteToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    ctx = await sembrarFixture(h);
  }, 180000);

  afterAll(async () => {
    if (h) await limpiarFixture(h);
    await h?.close();
  });

  const tokenDe = (row: AxisRow): Record<string, string> =>
    row.auth === 'admin' ? { token: adminToken } : row.auth === 'customer' ? { token: clienteToken } : {};

  const get = (row: AxisRow, value: string): Promise<ApiRes> =>
    h.api<ErrorBody>('GET', url(row, ctx, value), tokenDe(row)) as Promise<ApiRes>;

  /** La aserción conforme de cada propiedad, en UN sitio: la excepción usa la misma llave. */
  const CONFORME: Record<Propiedad, (row: AxisRow, res: ApiRes, extra: Extra) => void> = {
    // Punto 1 fila 1 — vacío ≡ ausente ⇒ `200`. En un `?sort=` (punto 6): el DEFAULT, también `200`.
    vacio: (_row, res) => expect(res.status).toBe(200),
    // ⚠️ Las dos mitades, no una: `if (x)` deja pasar `' '` (un espacio es truthy) y `raw === ''` no
    // lo atrapa (un espacio no es la cadena vacía).
    espacios: (_row, res) => expect(res.status).toBe(200),
    /**
     * ⭐⭐ **Punto 1 fila 2 — y es la propiedad que `QA-M3` demostró VACÍA.**
     *
     * Aquí decía, entero: `filtra: (_row, res) => expect(res.status).toBe(200)`. **Miraba el código
     * de estado y nada más.** QA lo midió con una mutación en `inventory.controller.ts:204` que
     * dejaba `parseEnumFilter` **validando** (basura ⇒ `400` igual) y **tiraba el valor**: `C-EQ-1`
     * salió **3/3 VERDE** y la suite backend entera también — *ningún test del proyecto mordía*.
     * Reproducido por mí antes de tocar nada: **3/3 verde** (N=3, `QA-M3`) y **3/3 verde** (N=3,
     * `QA-M4`). Un título que dice «FILTRA» sobre una aserción que no lo comprueba es la
     * caducidad-con-autoridad que este fichero existe para matar, **dentro del fichero**.
     *
     * Ahora son tres aserciones, y cada una cierra un modo de fallo distinto:
     *
     *  1. **el fixture tiene con qué** — sin filas que excluir, «filtra» no es observable y el `200`
     *     sería un verde **por omisión**. Es la mitad que convierte un hueco en un rojo: el día que
     *     un endpoint se quede sin fixture, esto lo dice en vez de callarlo;
     *  2. **el token CAMBIA el resultado** (`valid` ≠ sin filtrar) ⇒ *validar y tirar el valor* es
     *     ROJO. Ésta es literalmente `QA-M3`;
     *  3. **el token DISCRIMINA** (`valid` ≠ `alterno`) ⇒ *devolver vacío ante cualquier token*
     *     también es ROJO. Sin ella, un filtro que borra la lista pasaría la (2) tan campante.
     */
    filtra: (row, res, extra) => {
      expect(res.status).toBe(200);
      const base = extra.base!;
      expect(base.status).toBe(200);
      const obs = row.obs ?? OBS_LISTA;
      // (1) medible: si el fixture está vacío, esto NO se puede afirmar — y se dice, no se calla.
      expect(`${idOf(row)} · hay datos SIN filtrar`).toBe(
        obs.hayDatos(base) ? `${idOf(row)} · hay datos SIN filtrar` : `${idOf(row)} · FIXTURE VACÍO`,
      );
      // (2) `QA-M3`: el token cambia el resultado — por ENCIMA del ruido del instrumento, no solo
      //     «distinto» (ver `Obs.distancia`: en el XLSX un `!==` se satisfacía por ruido).
      const dist = distanciaDe(obs);
      const ruido = ruidoDe(obs);
      expect(dist(obs.huella(res), obs.huella(base))).toBeGreaterThan(ruido);
      // (3) el token discrimina (solo donde el dominio tiene con qué: ver `alterno`).
      if (row.alterno !== undefined) {
        const alt = extra.alterno!;
        expect(alt.status).toBe(200);
        expect(dist(obs.huella(res), obs.huella(alt))).toBeGreaterThan(ruido);
      }
    },
    error: (row, res) => {
      // `400` y no `422`: es query, no cuerpo. Un `422` aquí es incumplimiento, no estilo de módulo.
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      // `details.field` OBLIGATORIO SIEMPRE — el nombre del param tal como lo mandó el cliente.
      expect(res.body.error.details.field).toBe(row.field ?? row.param);
      // `details.allowed` OBLIGATORIO y == el dominio DECLARADO (derivado, no transcrito).
      expect([...(res.body.error.details.allowed as string[])].sort()).toEqual([...row.allowed].sort());
    },
    value: (row, res) => {
      if (row.echoValue) {
        expect(res.body.error.details.value).toBe(BASURA);
      } else {
        // El dominio de `details` de §0-Q son `field` + `allowed`: quien recibe el `400` ya tiene el
        // valor, lo mandó él. Encenderlo en un eje nuevo es ensanchar §0-Q ⇒ arquitecto (regla 9).
        expect(res.body.error.details.value).toBeUndefined();
      }
    },
    // `' pending'` es entrada mal formada ⇒ `400`; no es un `pending` con adornos. En un eje CSV la
    // regla única «se recorta la SINTAXIS, nunca el TOKEN» hace que `%20tok` sí filtre.
    sinNormalizar: (row, res) => expect(res.status).toBe(row.csv ? 200 : 400),
    cota: (_row, res) => {
      expect(_row).toBeDefined();
      expect(res.status).toBe(400);
      // Ni en `message` ni en `details`: las DOS puntas del eco, no una.
      expect(res.text.includes(LARGO)).toBe(false);
      expect(res.text.length).toBeLessThan(2000);
    },
  };

  const VALOR: Record<Propiedad, (row: AxisRow) => string> = {
    vacio: () => '',
    espacios: () => '%20',
    filtra: (row) => row.valid,
    error: () => BASURA,
    value: () => BASURA,
    sinNormalizar: (row) => `%20${row.valid}`,
    cota: () => LARGO,
  };

  const TITULO: Record<Propiedad, string> = {
    vacio: 'punto 1 · fila 1 — la cadena VACÍA no filtra (o da el default): `200`, ⛔ nunca `400`',
    espacios: 'punto 1 · fila 1 — SOLO ESPACIOS (`%20`) se trata igual que el vacío: `200`',
    filtra:
      'punto 1 · fila 2 — ⭐ un token del dominio FILTRA DE VERDAD (u ORDENA): el resultado CAMBIA ' +
      'respecto de no filtrar y DISCRIMINA de otro token (⛔ `QA-M3`: `200` no demuestra nada)',
    error: 'punto 1 · fila 3 + punto 2 — basura ⇒ `400` con `field` y `allowed` (⛔ NO `422`)',
    value: 'punto 2 — `details.value`: obligatorio en los 6 públicos, ⛔ PROHIBIDO en el resto',
    sinNormalizar: 'punto 1 · ⛔ el `trim()` decide si viene VACÍO, NO «arregla» el token',
    cota: '⭐ punto 2 — la COTA DEL ECO: el tamaño de la respuesta NO lo decide quien la pide',
  };

  const PROPIEDADES: readonly Propiedad[] = ['vacio', 'espacios', 'filtra', 'error', 'value', 'sinNormalizar', 'cota'];

  /**
   * Las respuestas EXTRA que solo la propiedad `filtra` necesita: el resultado **sin filtrar** y el
   * del token **alterno**. Se piden aquí y no dentro de `CONFORME` para que la aserción siga siendo
   * pura (recibe respuestas, no hace red) — y para que la excepción medida reciba exactamente lo
   * mismo que la fila conforme.
   */
  const extrasDe = async (p: Propiedad, row: AxisRow): Promise<Extra> =>
    p !== 'filtra'
      ? {}
      : {
          base: await get(row, ''),
          ...(row.alterno !== undefined ? { alterno: await get(row, row.alterno) } : {}),
        };

  for (const p of PROPIEDADES) {
    describe(TITULO[p], () => {
      it.each(exigidas(p))('%s ⇒ conforme', async (_id, row) => {
        const res = await get(row, VALOR[p](row));
        CONFORME[p](row, res, await extrasDe(p, row));
      });

      const conExcepcion = exceptuadas(p);
      if (conExcepcion.length > 0) {
        /**
         * ⛔ **Excepción MEDIDA, no exigida.** Se fija la conducta de HOY para que el cambio, cuando
         * llegue, **sea visible**. Si esto se pone rojo no es una regresión: es que alguien cerró el
         * hallazgo y tiene que venir aquí a borrar la excepción.
         */
        describe('⛔ EXCEPCIONES medidas (ver `motivo`) — conducta de HOY congelada', () => {
          it.each(conExcepcion)('%s — hoy NO conforma, y aquí está por qué', async (_id, row) => {
            const exc = row.excepciones![p]!;
            expect(exc.motivo.length).toBeGreaterThan(80); // una excepción sin motivo no es una excepción
            const res = await get(row, VALOR[p](row));
            exc.hoy(res, await extrasDe(p, row));
          });
        });
      }
    });
  }

  /**
   * §0-Q punto 3 declara el dominio de `?productType=` de `/catalog/cards` **sin `sealed`** (clase
   * R). Mientras `D-EQ-3` no cierre, el token se sigue aceptando: se fija para que deje de
   * aceptarse **con ruido**, no en silencio.
   */
  /**
   * ⭐ **El candado del candado.** `valid` y `alterno` son la munición de la propiedad `filtra`: si
   * una fila nueva se escribe sin `alterno`, la aserción (3) se salta **en silencio** y la fila
   * vuelve a la conformidad de mentira que `QA-M3` midió. Aquí se exige que la omisión solo sea
   * legítima donde es estructural — dominio de UN solo token — y que los dos tokens sean del
   * dominio DECLARADO y distintos entre sí.
   */
  /**
   * ⭐ **La cola de enrutamiento no desaparece: se muda.** Las seis filas de la bóveda salieron de
   * `SIN_CLASE_DECLARADA` (22 → 16) porque su CONDUCTA ya cumple §0-Q — pero su **fila en §0-Q punto
   * 4 sigue sin existir**, y eso lo decide el arquitecto (regla 9). Fijado con `toEqual` para que
   * ni se olvide ni crezca en silencio: si alguien mete una fila nueva marcándola
   * `PENDIENTE-ARQUITECTO` sin escribirla aquí, esto se pone rojo.
   */
  it('⭐ las filas SIN fila en §0-Q punto 4 están NOMBRADAS (⇒ arquitecto, regla 9)', () => {
    const pendientes = REGISTRO.filter((r) => r.filaEn0Q === 'PENDIENTE-ARQUITECTO').map(idOf).sort();
    expect(pendientes).toEqual([
      // ⭐ `EQ-D1` lote 2 (este pase): 5 ejes de ORDEN/RANGO cuya CONDUCTA ya conforma pero cuya fila
      // de §0-Q punto 4 sigue pendiente del arquitecto (regla 9).
      'GET /admin/inventory/master-sets?sort=',
      // ⭐ §M4-PREP (v1.78): el contrato declara el eje y su `400` en §M4-PREP, pero la TABLA del
      // registro de §0-Q punto 4 no tiene su fila. Escribirla es cambiar §0-Q ⇒ arquitecto (regla 9).
      'GET /admin/shipments/picking-list?destination=',
      'GET /admin/vaults/:userId/master-sets?sort=',
      'GET /admin/vaults/:userId/sealed?condition=',
      'GET /admin/vaults/:userId/sealed?sealedSubtype=',
      'GET /admin/vaults/:userId/sealed?sort=',
      'GET /admin/vaults?sort=',
      'GET /vault/master-sets?sort=',
      'GET /vault/portfolio/history?range=',
      'GET /vault/sealed?condition=',
      'GET /vault/sealed?sealedSubtype=',
      'GET /vault/sealed?sort=',
    ]);
  });

  it('⭐ coherencia del REGISTRO — `alterno` solo se omite si el dominio tiene UN token', () => {
    const malas = REGISTRO.filter(
      (r) =>
        !r.allowed.includes(r.valid) ||
        (r.alterno === undefined ? r.allowed.length > 1 : !r.allowed.includes(r.alterno) || r.alterno === r.valid),
    ).map((r) => `${idOf(r)} (valid=${r.valid}, alterno=${r.alterno ?? '—'}, |dominio|=${r.allowed.length})`);
    expect(malas).toEqual([]);
  });

  /**
   * ⭐⭐ **`R3` — la estabilidad de la huella deja de ser una frase y pasa a ser una medición.**
   *
   * La propiedad `filtra` compara huellas entre peticiones distintas. Si la huella de un endpoint no
   * fuera **estable entre dos llamadas idénticas** (un `now()` en el DTO, un orden no determinista),
   * la fila saldría roja **por el instrumento**, no por el producto — y la salida barata sería
   * aflojar la propiedad para todos.
   *
   * Hasta hoy eso se afirmaba en prosa («N=2 por eje sobre las 26 filas: estable en todas») y la
   * frase **caducó sola** cuando entraron las seis de la bóveda. Ahora se mide **sobre las filas que
   * haya**: una fila nueva se comprueba sola, y ninguna frase puede volver a cubrir lo que nadie
   * miró. N=2 por fila, que es lo que hace falta para detectar no-determinismo por llamada.
   */
  it.each(REGISTRO.map((r) => [idOf(r), r] as const))(
    '%s — huella ESTABLE entre dos llamadas idénticas (si no, la propiedad `filtra` mide el instrumento)',
    async (_id, row) => {
      const obs = row.obs ?? OBS_LISTA;
      const a = await get(row, row.valid);
      const b = await get(row, row.valid);
      // Por debajo del ruido DECLARADO del instrumento (0 para todo lo que es JSON ⇒ igualdad).
      expect(distanciaDe(obs)(obs.huella(a), obs.huella(b))).toBeLessThanOrEqual(ruidoDe(obs));
    },
  );

  it('⛔ `D-EQ-3` (frontend primero) — `/catalog/cards?productType=sealed` HOY devuelve `200`', async () => {
    const row = REGISTRO.find((r) => r.route === 'GET /catalog/cards' && r.param === 'productType')!;
    expect((await get(row, 'sealed')).status).toBe(200);
  });
});
describe('⭐⭐ `C-EQ-1` — DESCUBRIMIENTO: ningún `@Query` sin clase declarada', () => {
  /**
   * ⭐⭐ **`R1` — las cuatro listas y EL CRUCE viven en `test/helpers/query-axis-cross.ts`.**
   *
   * No es una mudanza de higiene: el **canario** (`test/enum-query-census-canary.spec.ts`) tenía su
   * propia `huerfanos()` con **tres** listas y `noEnum` **por nombre** — o sea certificaba el cruce
   * que `QA-M4` refutó, no el que se embarca. techlead lo razonó y no hay vuelta: *el canario no
   * importaba ni una lista del spec, luego revertir la partición no podía poner roja ninguna
   * aserción suya*. Ahora los dos importan **la misma función y las mismas listas**, y eso lo
   * comprueba el propio canario (su test de costura mira este fichero).
   */
  const sites = censusQueryAxes(SRC);
  const registrados = new Set(REGISTRO.map((r) => `${r.route}::${r.param}`));

  it('el escáner ve la app REAL (ancla: si dejara de ver código, esto lo dice)', () => {
    // Sin ancla, un escáner que devolviera `[]` pasaría TODOS los cruces en verde: el fallo
    // silencioso. Medido el 2026-09-13 sobre `2e40a8b`: 176 `@Query` en código, 18 controllers.
    expect(sites.length).toBeGreaterThanOrEqual(170);
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThanOrEqual(18);
    // Y ve rutas COMPLETAS, no solo nombres de param: la resolución del prefijo `@Controller` es
    // parte de lo que se vigila (un `?status=` son cinco ejes distintos, no uno).
    expect(sites.some((s) => s.key === 'GET /admin/pricing/pending::context')).toBe(true);
    expect(sites.some((s) => s.key === 'GET /catalog/cards::finish')).toBe(true);
  });

  /** Las cinco fuentes de clase, tal como las cruza `huerfanos()` — la MISMA que usa el canario. */
  const LISTAS = {
    transversal: NO_ENUM_TRANSVERSAL,
    porRuta: NO_ENUM_POR_RUTA,
    registro: [...registrados],
    sinClase: SIN_CLASE_DECLARADA,
    sinNombre: QUERY_SIN_NOMBRE,
  };

  it('⭐ ningún `@Query` fuera de las CINCO listas (si sale uno: su clase la decide el ARQUITECTO)', () => {
    const porFichero = new Map(sites.map((s) => [s.key, s.file]));
    expect(
      // El mensaje es parte del candado: quien lo tope tiene que saber que la salida NO es añadirlo
      // a `NO_ENUM_TRANSVERSAL` sin medir — esa lista absuelve GLOBALMENTE y tiene tope (`R2a`).
      huerfanos(sites, LISTAS).map((k) => `${k}   @ ${porFichero.get(k)}`),
    ).toEqual([]);
  });

  /**
   * ⭐ **TRINQUETE — estos dos números solo pueden BAJAR.** (techlead, condición `C1`.)
   *
   * La primera versión de este bloque se titulaba *«no puede crecer ni encogerse»* y solo
   * comprobaba lo segundo: que toda llave de la cola siguiera existiendo en el código. **La mitad de
   * «crecer» no estaba implementada**, y `docs/TECH_DEBT.md` la afirmaba como hecha — o sea, este
   * pase, que existe para cerrar la clase *«afirmación de mecanismo que nadie mide»*, estaba
   * **abriendo una instancia nueva de esa misma clase**. techlead lo leyó y tiene razón.
   *
   * **Por qué un número y no una fecha de caducidad: una fecha no falla; un número sí.** Y el
   * argumento que lo hace bloqueante: *«hay que escribirlo a mano» y «nadie lo nota» son
   * compatibles* — de 22 a 40 hay **dieciocho diffs de una línea**, cada uno intachable en su PR.
   * Con el tope, la entrada nº 23 deja de ser un diff de una línea y pasa a ser una conversación:
   * hay que **subir el número a mano**, y eso se ve en la revisión.
   *
   * ⛔ **Subir cualquiera de estos dos topes es cambiar la deuda aceptada**, no arreglar un test.
   * *Un número que solo puede bajar es una deuda que se paga; una lista sin número es una deuda que
   * crece.*
   */
  it('⭐ TRINQUETE — la cola de enrutamiento solo puede ENCOGER (nunca crecer en silencio)', () => {
    // ⭐⭐ `R3` — el tamaño del REGISTRO, con LITERAL. La prosa de este fichero llegó a decir «25
    // filas», «26 filas» y «las 26» cuando había **32**, y una de esas frases afirmaba haber medido
    // la estabilidad «sobre las 26 filas» — cubriendo las seis de la bóveda **sin haberlas medido**.
    // Es la clase que §4.37.1-a declara mortal, dentro del fichero que se declara «la ÚNICA
    // autoridad», y ya van tres veces aquí (`QA-M3`, `C2`, ésta). *Ya que el pase entero defiende
    // que un número sí falla y una fecha no*, el conteo se fija donde falla.
    // 26 transcritas de §0-Q punto 4 + 6 de la bóveda (`EQ-D0`, `filaEn0Q: 'PENDIENTE-ARQUITECTO'`)
    // + 4 de `EQ-D1` (`?kind=`, `?scope=`, `?sort=` de los dos catálogos públicos) + 1 de `EQ-D2`
    // (`?state=` de `sealed-price-status`, M11 §10) + 1 de `EQ-D3` (`?productType=` de
    // `pending-publish`, M11) + 5 de `EQ-D1` LOTE 2 (este pase: `?sort=` de los 3 índices master set,
    // `?sort=` de `/admin/vaults`, `?range=` de `/vault/portfolio/history`) ⇒ 43.
    // Las 5 del lote 2 van `PENDIENTE-ARQUITECTO` (su fila de §0-Q NO existe todavía) ⇒ el conteo de
    // pendientes SUBE de 6 a 11. Las de `EQ-D1` lote 1/`EQ-D2`/`EQ-D3` fueron `transcrita` (su fila la
    // escribió el arquitecto en aquel pase) y por eso NO subían el conteo de pendientes.
    // ⭐ **43 → 44 (§M4-PREP, v1.78):** `?destination=` de `GET /admin/shipments/picking-list`, el eje
    // nuevo de «Pedidos a preparar». Entra `PENDIENTE-ARQUITECTO` (11 → 12): su CONDUCTA conforma
    // —se mide aquí, por HTTP— pero su fila en la **tabla** de §0-Q punto 4 **no existe**; el
    // contrato la declara en §M4-PREP y escribirla en el registro es del arquitecto (regla 9).
    // ⛔ Subir este literal sin una fila nueva justificada arriba es exactamente lo que impide.
    expect(REGISTRO.length).toBe(44);
    expect(REGISTRO.filter((r) => r.filaEn0Q === 'PENDIENTE-ARQUITECTO')).toHaveLength(12);
    // Medido el 2026-09-13 (`D-EQ-2`): 22 ejes de dominio cerrado sin clase en §0-Q, y 2 rutas con
    // `@Query()` sin nombre. Estos números son el techo, y el techo solo baja.
    // ⭐ 22 → **16**: `EQ-D0` (la bóveda) paga SEIS. *Un número que solo puede bajar es una deuda que
    // se paga.* Las seis salieron porque su CONDUCTA ya cumple §0-Q (`vault.service.ts`), no porque
    // alguien decidiera que ya no molestan — y la fila del contrato que les falta se sigue diciendo,
    // ahora dentro del registro (`filaEn0Q: 'PENDIENTE-ARQUITECTO'`), que es donde se ve.
    // ⭐ 16 → **12**: `EQ-D1` lote 1 paga CUATRO — `?kind=` (envíos), `?scope=` (auditoría) y `?sort=`
    // de los dos catálogos públicos. Migrados a `parseEnumFilter` (clamp/ignorar ⇒ `400`) y con su
    // fila de §0-Q ya escrita ⇒ salen de la cola y entran al `REGISTRO`.
    // ⭐ 12 → **7**: `EQ-D1` LOTE 2 (este pase) paga CINCO — `?sort=` del índice master set (un
    // dominio, tres rutas: inventario + bóveda admin + bóveda cliente), `?sort=` de `/admin/vaults` y
    // `?range=` de `/vault/portfolio/history`. Migrados a `parseEnumFilter` (clamp silencioso ⇒
    // `400`). Su fila de §0-Q NO existe todavía ⇒ entran al `REGISTRO` como `PENDIENTE-ARQUITECTO`
    // (igual que la bóveda), no como `transcrita`. Los 7 que quedan en la cola son los 3 de DINERO
    // (`?report=` ×2, `graded-estimates/review?reason=`), `?sealedSubtype=` de `/catalog/cards`
    // (`D-EQ-3`, frontend primero) y los 3 `?range=` de `value-history` (stream `catalog`). El tope
    // baja a mano.
    expect(SIN_CLASE_DECLARADA.length).toBeLessThanOrEqual(7);
    expect(QUERY_SIN_NOMBRE.length).toBeLessThanOrEqual(2);
    // ⭐ `QA-M4`: la lista de exenciones MEDIDAS POR RUTA también tiene techo. Sin él, la salida
    // barata ante el rojo del huérfano sería añadir la llave aquí — un diff de una línea,
    // intachable en su PR, y la exención por-ruta se volvería otra lista por nombre disfrazada.
    // Medido el 2026-09-13: 15 sitios (3 de texto libre + 12 banderas booleanas).
    // 15 (3 de texto libre + 12 banderas) + 21 (`?from=`/`?to=`/`?date=`, movidos desde
    // `TRANSVERSAL` en `R2a`: una «fecha» PUEDE ser un dominio cerrado con nombre de fecha).
    // ⭐ **36 → 38 (D56, `API_CONTRACT §M10-IVA.2`):** los dos ejes de
    // `GET /admin/settings/iva-transfer/preview`. **El arquitecto los autorizó CON su costo
    // contabilizado**, y ése es el punto: subir un tope no es gratis ni silencioso — se paga
    // nombrando la ruta, la clase medida de cada eje y la rev que lo autoriza.
    // ⛔ `NO_ENUM_TRANSVERSAL` **NO se toca**: su `toEqual` de 14 nombres queda igual (la exención
    // es de ESTA ruta, no del nombre).
    expect(NO_ENUM_POR_RUTA.length).toBeLessThanOrEqual(38);
    // ⭐⭐ `R2a` — LA QUINTA PUERTA, que era la única sin techo Y la única que cruza por NOMBRE.
    //
    // `QA-M5` lo demostró con mutación (no leyendo): endpoint nuevo con `@Query('q')` + `@Query('date')`
    // ⇒ **3/3 VERDE, N=3**. El fondo está ratificado —QA enumeró los 113 sitios y ninguno es de
    // dominio cerrado—, así que lo que se congela NO es la decisión sino la lista: **17 nombres**.
    //
    // ⛔ Va con `toEqual` y no con `length <= 17` a propósito: esta lista absuelve **globalmente**
    // (un nombre exime TODAS las rutas, presentes y futuras), así que sustituir un nombre por otro
    // sin cambiar el conteo es tan peligroso como añadirlo. `?date=today|yesterday|week` —el caso
    // que QA puso encima— **entraba sin un solo rojo**; ahora entra con uno.
    expect([...NO_ENUM_TRANSVERSAL].sort()).toEqual([
      'actorUserId', 'cardId', 'groupId', 'locationId', 'maxCents', 'maxPriceCents', 'minCents',
      'minPriceCents', 'page', 'pageSize', 'q', 'quotedTotalCents', 'setId', 'userId',
    ]);
    // Sin duplicados: dos entradas iguales inflarían la cola sin tocar el tope.
    expect(new Set(SIN_CLASE_DECLARADA).size).toBe(SIN_CLASE_DECLARADA.length);
    expect(new Set(QUERY_SIN_NOMBRE).size).toBe(QUERY_SIN_NOMBRE.length);
    expect(new Set(NO_ENUM_POR_RUTA).size).toBe(NO_ENUM_POR_RUTA.length);
    expect(new Set(NO_ENUM_TRANSVERSAL).size).toBe(NO_ENUM_TRANSVERSAL.length);
  });

  /**
   * ⭐⭐ **`R2b` — la quinta puerta y media: las `excepciones`, que NO añaden una entrada sino que
   * DEBILITAN una aserción.**
   *
   * Las otras cuatro listas crecen sumando una llave; ésta crece **apagando una propiedad para una
   * fila**. Y la peor de todas sería `excepciones: { filtra: … }`: borraría, para esa fila, la
   * aserción **(1)** —la del fixture vacío—, que es justo la que convierte un hueco silencioso en un
   * rojo con nombre. Hoy hay **5 excepciones en 4 filas** y **ninguna es de `filtra`** (QA lo
   * verificó); mañana, sin esto, la primera entraría con un diff de una línea.
   *
   * ⛔ **Y el guardián que había no guarda:** `expect(exc.motivo.length).toBeGreaterThan(80)` exige
   * **prosa**, que es exactamente lo que este stream ha medido tres veces que **no sostiene nada**
   * (`QA-M3`, `C2`, `R3`). Ochenta caracteres de texto no son una medición. El censo sí.
   */
  it('⭐ CENSO de `excepciones` — fijado y con tope: una excepción nueva NO es un diff de una línea', () => {
    const censo = REGISTRO.flatMap((r) =>
      Object.keys(r.excepciones ?? {}).map((prop) => `${idOf(r)}::${prop}`),
    ).sort();
    expect(censo).toEqual([
      'GET /admin/buylist?status=::cota',
      'GET /admin/pricing/bounties?sort=::cota',
      'GET /admin/pricing/bounties?state=::cota',
      'GET /admin/pricing/bounties?state=::sinNormalizar',
      'GET /catalog/cards?productType=::error',
    ]);
    // El tope, por si alguien sustituye una por otra: son 5, en 4 filas, y el número solo baja.
    expect(censo.length).toBeLessThanOrEqual(5);
    // ⛔ NINGUNA sobre `filtra`: apagar esa propiedad es apagar la aserción del fixture vacío.
    expect(censo.filter((k) => k.endsWith('::filtra'))).toEqual([]);
  });

  it('la cola de enrutamiento no puede ENCOGER en silencio tampoco: lo que lista sigue existiendo', () => {
    const vistos = sites.map((s) => s.key);
    // Todo lo que está en la cola sigue existiendo en el código: si alguien lo arregló o lo retiró,
    // hay que quitarlo de aquí — la cola tampoco puede afirmar un estado que ya no es.
    expect(SIN_CLASE_DECLARADA.filter((k) => !vistos.includes(k))).toEqual([]);
    expect(QUERY_SIN_NOMBRE.filter((k) => !vistos.includes(k))).toEqual([]);
    // Ídem para las exenciones medidas por ruta: si el endpoint se fue, la medición ya no aplica.
    expect(NO_ENUM_POR_RUTA.filter((k) => !vistos.includes(k))).toEqual([]);
  });

  it('el registro de §0-Q existe ENTERO en el código (un eje registrado que nadie expone es un registro caduco)', () => {
    const vistos = new Set(sites.map((s) => s.key));
    // ⚠️ Las rutas con `@Query()` SIN NOMBRE no exponen sus llaves al escáner: `GET /admin/users`
    // lee la query entera a propósito (`D-A5-3`), así que sus dos ejes registrados (`status`,
    // `kycStatus`) viven dentro de `ADMIN_USERS_QUERY_KEYS` y no como decoradores. Se exime la RUTA,
    // no el eje — y su conformidad la mide igual la mitad 1, por HTTP, que es donde se ve de verdad.
    const rutasSinNombre = new Set(QUERY_SIN_NOMBRE.map((k) => k.split('::')[0]));
    const ausentes = [...registrados].filter(
      (k) => !vistos.has(k) && !rutasSinNombre.has(k.split('::')[0]),
    );
    expect(ausentes).toEqual([]);
  });

  /**
   * §4.37 clase **L** — paridad a **DOS** bandas: **contrato ↔ literal** junto al call-site. No hay
   * tercera porque no hay schema que espejar; y la prueba (3) de la tabla de §4.37 es justamente que
   * **no exista** el enum homónimo — el día que alguien lo cree, el literal deja de ser legítimo.
   */
  describe('§4.37 clase L — paridad a dos bandas (contrato ↔ literal) + «no hay enum detrás»', () => {
    const contrato = readFileSync(CONTRACT, 'utf8');
    const schema = readFileSync(SCHEMA, 'utf8');

    const L = [
      {
        param: 'missing',
        literal: PENDING_PUBLISH_MISSING_VALUES,
        // §M1, línea del endpoint (canónica para clase L):
        // «Query: `?missing=location|price&acquisitionType=&setId=&page=&pageSize=`»
        re: /Query: `\?missing=([a-z|]+)&/,
        enunciado: /enum\s+\w*Missing\w*\s*\{/,
      },
      {
        param: 'axis',
        literal: PRICING_BRACKETS_AXIS_VALUES,
        // §M9, línea del endpoint: «`axis?` (`sale | buy`; omitido = ambos)»
        re: /`axis\?` \(`([a-z |]+)`; omitido = ambos\)/,
        enunciado: /enum\s+\w*[Aa]xis\w*\s*\{/,
      },
      {
        // ⭐ `EQ-D0` — el ORDEN de la bóveda. §3, línea del endpoint de `GET /vault/sealed`:
        // «Query: `?sealedSubtype=&condition=&sort=` (`sort` default `value_desc`; también
        // `count_desc | name_asc`)». El DEFAULT es parte del dominio, así que el grupo 1 entra.
        param: 'sort (bóveda)',
        literal: VAULT_SEALED_SORT_VALUES,
        re: /`sort` default `([a-z_]+)`; también `([a-z_ |]+)`/,
        enunciado: /enum\s+\w*[Ss]ort\w*\s*\{/,
      },
    ];

    it.each(L.map((l) => [l.param, l] as const))('`?%s=` — el literal == la línea del contrato', (_p, l) => {
      const m = l.re.exec(contrato);
      if (!m) throw new Error(`el contrato no declara el dominio de ?${l.param}= en su línea canónica`);
      // El dominio puede venir repartido en varios grupos (el `?sort=` de la bóveda declara su
      // DEFAULT aparte de las alternativas): se unen todos los grupos capturados.
      const delContrato = m
        .slice(1)
        .join('|')
        .split('|')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      expect([...l.literal].sort()).toEqual(delContrato.sort());
    });

    it.each(L.map((l) => [l.param, l] as const))('`?%s=` — ⛔ no existe enum homónimo en `schema.prisma`', (_p, l) => {
      // Si existe la columna, existe la clase E y el literal es el bug de `SealedSubtype`/`upc`
      // esperando a repetirse (§4.37: «lo que L NO autoriza»).
      expect(l.enunciado.test(schema)).toBe(false);
    });
  });
});
