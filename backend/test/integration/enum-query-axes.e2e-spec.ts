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
 *    añadir un eje cuesta escribir un bloque nuevo, el eje número veinticinco no se añade*.
 *
 * 2. ⭐ **DESCUBRIMIENTO** — falla ante el eje que **nadie registró**. *Una suite no puede fallar por
 *    un parámetro que nunca le contaron.* `?context=`, `?reason=` y `?axis=` no se saltaron por
 *    descuido en `P-84`/`P-89`: **no estaban en el censo**, y un censo escrito a mano no puede
 *    enterarse de lo que nadie le contó. Aquí el inventario **se lee del código**
 *    (`helpers/query-axis-census.ts`, **sobre código y no texto**) y se cruza contra listas explícitas.
 *
 * ### ⚠️ Tres listas, no dos — y es una desviación CONSCIENTE de la especificación, con su motivo
 * §4.37.1-a pide cruzar contra **dos** listas: (a) los ejes del registro y (b) los que no son de
 * dominio cerrado. Al correr el descubrimiento por primera vez (2026-09-13, **176** `@Query` en
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
import { ACCEPTED_RAW_CONDITIONS } from '../../src/common/business-rules';
import { BOUNTY_STATE_VALUES } from '../../src/modules/pricing/bounty-state';
import { ADMIN_BOUNTY_SORT_VALUES } from '../../src/modules/pricing/admin-bounties.service';
import { PENDING_PUBLISH_MISSING_VALUES } from '../../src/modules/inventory/inventory.controller';
import { PRICING_BRACKETS_AXIS_VALUES } from '../../src/modules/admin/admin.controller';

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
  /** Un token legítimo del dominio (para la fila 2 del punto 1: «filtra»). */
  readonly valid: string;
  /** Querystring obligatoria del endpoint (p. ej. `setId=…`), sin el `?`. */
  readonly extra?: (ctx: Ctx) => string;
  readonly auth: 'admin' | 'public';
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
    readonly [K in Propiedad]?: { readonly motivo: string; readonly hoy: (res: ApiRes) => void };
  };
}

type Propiedad = 'vacio' | 'espacios' | 'filtra' | 'error' | 'value' | 'sinNormalizar' | 'cota';
type ApiRes = { status: number; body: ErrorBody; text: string };

interface Ctx {
  setId: string;
}

/**
 * ⭐ **EL REGISTRO — transcripción de §0-Q punto 4 (25 filas: las 24 de la tabla + el `?sort=` que
 * la tabla registra en su última columna como «no es filtro: es ORDEN — punto 6»).**
 *
 * Es una afirmación de **clase (A) — decisión**, y por eso sí se transcribe: cambia solo cuando el
 * arquitecto lo decide. Lo que ⛔ **no** se transcribe es el **dominio** de una clase E: ése se
 * **deriva** del enum de Prisma (§0-Q punto 3), que es la diferencia entre este registro y el censo
 * que la v1.73 retiró.
 */
const REGISTRO: readonly AxisRow[] = [
  { route: 'GET /admin/orders', param: 'status', clazz: 'E', allowed: Object.values(OrderStatus), valid: 'settled', auth: 'admin', echoValue: false },
  { route: 'GET /admin/disputes', param: 'status', clazz: 'E', allowed: Object.values(DisputeStatus), valid: 'abierta', auth: 'admin', echoValue: false },
  { route: 'GET /admin/shipments', param: 'status', clazz: 'E', allowed: Object.values(ShipmentStatus), valid: 'solicitado', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/items', param: 'status', clazz: 'E', allowed: Object.values(InventoryStatus), valid: 'in_stock', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/items', param: 'ownerType', clazz: 'E', allowed: Object.values(OwnerType), valid: 'platform', auth: 'admin', echoValue: false },
  // ⚠️ `details.field` = `"zone"` (el query param), NO `"location.zone"` (la ruta de Prisma).
  { route: 'GET /admin/inventory/items', param: 'zone', clazz: 'E', allowed: Object.values(VaultZone), valid: 'platform_stock', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/items', param: 'finish', clazz: 'E', allowed: Object.values(Finish), valid: 'normal', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/items', param: 'productType', clazz: 'E', allowed: Object.values(ProductType), valid: 'raw', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/pending-publish', param: 'acquisitionType', clazz: 'E', allowed: Object.values(AcquisitionType), valid: 'compra', auth: 'admin', echoValue: false },
  // ⭐ `D-EQ-2` · CLASE L: `location | price` no existe en el schema — nombra QUÉ LE FALTA a la fila.
  { route: 'GET /admin/inventory/pending-publish', param: 'missing', clazz: 'L', allowed: PENDING_PUBLISH_MISSING_VALUES, valid: 'price', auth: 'admin', echoValue: false },
  { route: 'GET /admin/inventory/export.xlsx', param: 'productType', clazz: 'E', allowed: Object.values(ProductType), valid: 'raw', auth: 'admin', echoValue: false },
  // ⭐ `D-EQ-2` · CLASE E derivada: `enum SealedGroupKind` existe en el schema ⇒ ⛔ no se transcribe.
  { route: 'GET /admin/inventory/sealed-products', param: 'origin', clazz: 'E', allowed: Object.values(SealedGroupKind), valid: 'set_main', auth: 'admin', echoValue: false, extra: (c) => `setId=${c.setId}` },
  { route: 'GET /admin/users', param: 'status', clazz: 'E', allowed: Object.values(UserStatus), valid: 'active', auth: 'admin', echoValue: false },
  { route: 'GET /admin/users', param: 'kycStatus', clazz: 'E', allowed: Object.values(KycStatus), valid: 'pending', auth: 'admin', echoValue: false },
  {
    route: 'GET /admin/buylist',
    param: 'status',
    clazz: 'E',
    allowed: Object.values(SellRequestStatus),
    valid: 'pagada',
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
  { route: 'GET /admin/pricing/pending', param: 'context', clazz: 'E', allowed: Object.values(PendingPriceContext), valid: 'inventory', auth: 'admin', echoValue: false },
  // ⭐ `D-EQ-2` · CLASE E derivada: `enum PendingPriceReason` sobre COLUMNA PERSISTIDA E INDEXADA.
  { route: 'GET /admin/pricing/pending', param: 'reason', clazz: 'E', allowed: Object.values(PendingPriceReason), valid: 'no_market', auth: 'admin', echoValue: false },
  {
    route: 'GET /admin/pricing/bounties',
    param: 'state',
    clazz: 'L',
    allowed: BOUNTY_STATE_VALUES,
    valid: 'activa',
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
  { route: 'GET /admin/pricing/bounties', param: 'finish', clazz: 'E', allowed: Object.values(Finish), valid: 'normal', auth: 'admin', echoValue: false },
  {
    // §0-Q punto 6: un `?sort=` **no es un filtro**, es un ORDEN CON DEFAULT. Su fila 1 es distinta
    // (vacío ⇒ el default declarado, no «no filtra»), pero observable igual: `200`. Las otras dos
    // filas son idénticas, incluida ⛔ la prohibición del *clamp* silencioso.
    route: 'GET /admin/pricing/bounties',
    param: 'sort',
    clazz: 'ORDEN',
    allowed: ADMIN_BOUNTY_SORT_VALUES,
    valid: 'attention_first',
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
  { route: 'GET /admin/reports/pricing-brackets', param: 'axis', clazz: 'L', allowed: PRICING_BRACKETS_AXIS_VALUES, valid: 'sale', auth: 'admin', echoValue: false },
  {
    route: 'GET /catalog/cards',
    param: 'productType',
    clazz: 'R',
    allowed: Object.values(ProductType).filter((v) => v !== 'sealed'),
    valid: 'raw',
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
  { route: 'GET /catalog/cards', param: 'finish', clazz: 'E', allowed: Object.values(Finish), valid: 'normal', auth: 'public', echoValue: true },
  { route: 'GET /catalog/cards', param: 'condition', clazz: 'R', allowed: ACCEPTED_RAW_CONDITIONS, valid: 'NM', auth: 'public', echoValue: true },
  { route: 'GET /catalog/sealed', param: 'sealedSubtype', clazz: 'E', allowed: Object.values(SealedSubtype), valid: 'box', auth: 'public', echoValue: true },
  { route: 'GET /catalog/sealed', param: 'condition', clazz: 'E', allowed: Object.values(SealedCondition), valid: 'mint', auth: 'public', echoValue: true },
];

/** `GET /admin/orders` ⇒ `/admin/orders` (el arnés ya antepone `/api/v1`). */
const pathOf = (row: AxisRow) => row.route.slice(row.route.indexOf(' ') + 1);

function url(row: AxisRow, ctx: Ctx, value: string): string {
  const extra = row.extra ? `${row.extra(ctx)}&` : '';
  return `${pathOf(row)}?${extra}${row.param}=${value}`;
}

const idOf = (row: AxisRow) => `${row.route}?${row.param}=`;

/** Las filas que SÍ se exigen en una propiedad dada (las demás van al bloque de excepciones). */
const exigidas = (p: Propiedad) => REGISTRO.filter((r) => !r.excepciones?.[p]).map((r) => [idOf(r), r] as const);
/** Las filas con excepción MEDIDA en esa propiedad: se fija su conducta de HOY. */
const exceptuadas = (p: Propiedad) => REGISTRO.filter((r) => r.excepciones?.[p]).map((r) => [idOf(r), r] as const);

const LARGO = 'A'.repeat(5000);
const BASURA = 'no_soy_un_token_valido';

describe('⭐ `C-EQ-1` — conformidad §0-Q, tabla-dirigida por HTTP', () => {
  let h: E2EHarness;
  let adminToken: string;
  let ctx: Ctx;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    // `GET /admin/inventory/sealed-products` exige `?setId=` ANTES de mirar `?origin=`: sin un set
    // real, la fila 1 («vacío ⇒ 200») no se podría medir — daría el `400` del setId y se leería
    // como conformidad.
    const set = await h.prisma.cardSet.findFirst({ select: { id: true } });
    if (!set) throw new Error('fixture sin CardSet: `?origin=` no se puede ejercitar');
    ctx = { setId: set.id };
  }, 120000);

  afterAll(async () => {
    await h?.close();
  });

  const get = (row: AxisRow, value: string): Promise<ApiRes> =>
    h.api<ErrorBody>('GET', url(row, ctx, value), row.auth === 'admin' ? { token: adminToken } : {}) as Promise<ApiRes>;

  /** La aserción conforme de cada propiedad, en UN sitio: la excepción usa la misma llave. */
  const CONFORME: Record<Propiedad, (row: AxisRow, res: ApiRes) => void> = {
    // Punto 1 fila 1 — vacío ≡ ausente ⇒ `200`. En un `?sort=` (punto 6): el DEFAULT, también `200`.
    vacio: (_row, res) => expect(res.status).toBe(200),
    // ⚠️ Las dos mitades, no una: `if (x)` deja pasar `' '` (un espacio es truthy) y `raw === ''` no
    // lo atrapa (un espacio no es la cadena vacía).
    espacios: (_row, res) => expect(res.status).toBe(200),
    filtra: (_row, res) => expect(res.status).toBe(200),
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
    filtra: 'punto 1 · fila 2 — un token del dominio FILTRA (u ordena): `200`',
    error: 'punto 1 · fila 3 + punto 2 — basura ⇒ `400` con `field` y `allowed` (⛔ NO `422`)',
    value: 'punto 2 — `details.value`: obligatorio en los 6 públicos, ⛔ PROHIBIDO en el resto',
    sinNormalizar: 'punto 1 · ⛔ el `trim()` decide si viene VACÍO, NO «arregla» el token',
    cota: '⭐ punto 2 — la COTA DEL ECO: el tamaño de la respuesta NO lo decide quien la pide',
  };

  const PROPIEDADES: readonly Propiedad[] = ['vacio', 'espacios', 'filtra', 'error', 'value', 'sinNormalizar', 'cota'];

  for (const p of PROPIEDADES) {
    describe(TITULO[p], () => {
      it.each(exigidas(p))('%s ⇒ conforme', async (_id, row) => {
        CONFORME[p](row, await get(row, VALOR[p](row)));
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
            exc.hoy(await get(row, VALOR[p](row)));
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
  it('⛔ `D-EQ-3` (frontend primero) — `/catalog/cards?productType=sealed` HOY devuelve `200`', async () => {
    const row = REGISTRO.find((r) => r.route === 'GET /catalog/cards' && r.param === 'productType')!;
    expect((await get(row, 'sealed')).status).toBe(200);
  });
});
describe('⭐⭐ `C-EQ-1` — DESCUBRIMIENTO: ningún `@Query` sin clase declarada', () => {
  /**
   * Llaves de query cuyo dominio **NO es cerrado**: texto libre, identificadores, fechas, números,
   * banderas booleanas y paginación. Los gobierna la línea anterior de §0 del contrato, no §0-Q
   * (punto 7: *«filtros que no son de dominio cerrado»*).
   *
   * Se cruzan **por nombre** (no por ruta) porque son transversales por construcción: un `?page=` es
   * el mismo `?page=` en las veinticinco rutas que lo declaran.
   */
  const NO_ENUM: readonly string[] = [
    // Paginación y búsqueda libre (§0, línea de «filtros de lista admin»).
    'page',
    'pageSize',
    'q',
    'from',
    'to',
    // Identificadores.
    'setId',
    'cardId',
    'userId',
    'actorUserId',
    'locationId',
    'groupId',
    // Montos y fechas.
    'minCents',
    'maxCents',
    'minPriceCents',
    'maxPriceCents',
    'quotedTotalCents',
    'date',
    // Texto libre sobre columnas `String` del schema (medido 2026-09-13: `Card.rarity`,
    // `AuditLog.action`, `AuditLog.entityType` son `String`, no enums).
    'rarity',
    'action',
    'entityType',
    // Banderas booleanas (`'true'`/`'1'`): no son dominios de enum.
    'force',
    'guest',
    'live',
    'needsManual',
    'awaitingGuide',
    'offerReissueAlert',
    'onlyAlerts',
    'principalOnly',
    'gradingHighlight',
  ];

  /**
   * ⭐ **La cola de enrutamiento: ejes de dominio CERRADO medido que §0-Q NO registra.**
   *
   * Salieron **de este descubrimiento**, no de una lista que alguien recordara — que es exactamente
   * la diferencia que `C-EQ-1` existe para marcar. Cada uno lleva su medición y su dueño. ⛔ **No se
   * arreglan aquí**: la clase la decide el arquitecto (regla 9) y el código es de otros work
   * streams. Están fijados con `toEqual` ⇒ **la cola no puede crecer en silencio**.
   *
   * | Eje | Conducta medida (2026-09-13) | Por qué incumple §0-Q | Stream |
   * |---|---|---|---|
   * | `/vault/sealed?sealedSubtype=` · `?condition=` | `vault.service.ts` `if (q.x && SET.has(q.x))` ⇒ **el filtro se IGNORA EN SILENCIO** | punto 1 ⛔ «prohibido ignorar el filtro»: *el fallo se ve y la cola falsa no*. Es el defecto de `?kycStatus=` que `A5` cerró, vivo en la bóveda del CLIENTE | Inventario y vault |
   * | `/admin/vaults/:userId/sealed?sealedSubtype=` · `?condition=` | ídem (mismo servicio) | ídem | Inventario y vault |
   * | `/admin/shipments?kind=` | `shipments.service.ts` `if (kind === 'guest_direct_ship')…` ⇒ **ignora en silencio** lo desconocido | punto 1 fila 3: debería ser `400` | Órdenes y dinero |
   * | `/admin/users/:id/audit?scope=` | `admin.controller.ts` cae al default `target` ante basura ⇒ **clamp silencioso** | punto 6 ⛔ «prohibido el clamp silencioso»: devuelve una lista distinta de la pedida | Admin y auditoría |
   * | `/admin/pricing/graded-estimates/review?reason=` | `400` con `details.{field,invalid,allowed}` | **CUARTA forma de `details`**: `invalid` no es `invalidStatus` (punto 2) ni está declarada | Catálogo y precios |
   * | `/admin/finance/export.csv?report=` · `/admin/reports/export.csv?report=` | `admin.service.ts` `if(report==='pnl')…if(report==='iva')…` ⇒ **cualquier otra cosa cae a `inventory`** | punto 1 fila 3 con el signo peor: devuelve **otro informe** del pedido | Admin y auditoría |
   * | `?range=` ×4 (`/catalog/…/value-history`, `/vault/portfolio/history`) | `normalizeRange` ⇒ **clamp silencioso a `'1m'`** | punto 6 ⛔ clamp silencioso | Catálogo y precios · Inventario y vault |
   * | `?sort=` ×8 (catálogo, sellado, master-sets, bóvedas) | todos caen a su default ante basura | punto 6 ⛔ clamp silencioso; y §0-Q **no declara su dominio** (solo registra el de `bounties`) | varios |
   * | `/catalog/cards?sealedSubtype=` | sigue vivo y filtrando | **RETIRADO del contrato en v1.73** (§2 y §0-Q punto 7): su cura es **quitar el parámetro**, no arreglarlo ⇒ `D-EQ-3`, **frontend primero** | Catálogo y precios |
   */
  const SIN_CLASE_DECLARADA: readonly string[] = [
    'GET /admin/finance/export.csv::report',
    'GET /admin/pricing/graded-estimates/review::reason',
    'GET /admin/reports/export.csv::report',
    'GET /admin/shipments::kind',
    'GET /admin/users/:id/audit::scope',
    'GET /admin/inventory/master-sets::sort',
    'GET /admin/vaults::sort',
    'GET /admin/vaults/:userId/master-sets::sort',
    'GET /admin/vaults/:userId/sealed::condition',
    'GET /admin/vaults/:userId/sealed::sealedSubtype',
    'GET /admin/vaults/:userId/sealed::sort',
    'GET /catalog/cards::sealedSubtype',
    'GET /catalog/cards::sort',
    'GET /catalog/featured-set/value-history::range',
    'GET /catalog/sealed::sort',
    'GET /catalog/sealed/:inventoryItemId/value-history::range',
    'GET /catalog/sets/:id/value-history::range',
    'GET /vault/master-sets::sort',
    'GET /vault/portfolio/history::range',
    'GET /vault/sealed::condition',
    'GET /vault/sealed::sealedSubtype',
    'GET /vault/sealed::sort',
  ];

  /**
   * Los `@Query()` **sin nombre** (la query entera). El escáner no puede ver sus llaves, así que el
   * hueco se cierra **diciéndolo**: cada sitio se declara con dónde vive su lista de llaves. Un
   * `@Query()` desnudo nuevo ⇒ **rojo**, porque sería un endpoint entero fuera del inventario.
   */
  const QUERY_SIN_NOMBRE: readonly string[] = [
    // `ADMIN_USERS_QUERY_KEYS` (`admin.controller.ts`): `q status kycStatus page pageSize`. Lee la
    // query ENTERA a propósito (`D-A5-3`): con params sueltos, una llave desconocida se descartaba
    // en silencio y el operador recibía el padrón entero con cara de cola filtrada.
    'GET /admin/users::<sin nombre>',
    // `RejectedItemsQueryDto`: `userId page pageSize` — los tres NO son de dominio cerrado.
    'GET /admin/buylist/rejected-items::<sin nombre>',
  ];

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

  it('⭐ ningún `@Query` fuera de las tres listas (si sale uno: su clase la decide el ARQUITECTO)', () => {
    const huerfanos = sites
      .filter(
        (s) =>
          !(s.param !== null && NO_ENUM.includes(s.param)) &&
          !registrados.has(s.key) &&
          !SIN_CLASE_DECLARADA.includes(s.key) &&
          !QUERY_SIN_NOMBRE.includes(s.key),
      )
      .map((s) => `${s.key}   @ ${s.file}`);

    expect(
      huerfanos,
      // El mensaje es parte del candado: quien lo tope tiene que saber que la salida NO es añadirlo
      // a `NO_ENUM` sin medir.
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
    // Medido el 2026-09-13 (`D-EQ-2`): 22 ejes de dominio cerrado sin clase en §0-Q, y 2 rutas con
    // `@Query()` sin nombre. Estos números son el techo, y el techo solo baja.
    expect(SIN_CLASE_DECLARADA.length).toBeLessThanOrEqual(22);
    expect(QUERY_SIN_NOMBRE.length).toBeLessThanOrEqual(2);
    // Sin duplicados: dos entradas iguales inflarían la cola sin tocar el tope.
    expect(new Set(SIN_CLASE_DECLARADA).size).toBe(SIN_CLASE_DECLARADA.length);
    expect(new Set(QUERY_SIN_NOMBRE).size).toBe(QUERY_SIN_NOMBRE.length);
  });

  it('la cola de enrutamiento no puede ENCOGER en silencio tampoco: lo que lista sigue existiendo', () => {
    const vistos = sites.map((s) => s.key);
    // Todo lo que está en la cola sigue existiendo en el código: si alguien lo arregló o lo retiró,
    // hay que quitarlo de aquí — la cola tampoco puede afirmar un estado que ya no es.
    expect(SIN_CLASE_DECLARADA.filter((k) => !vistos.includes(k))).toEqual([]);
    expect(QUERY_SIN_NOMBRE.filter((k) => !vistos.includes(k))).toEqual([]);
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
    ];

    it.each(L.map((l) => [l.param, l] as const))('`?%s=` — el literal == la línea del contrato', (_p, l) => {
      const m = l.re.exec(contrato);
      if (!m) throw new Error(`el contrato no declara el dominio de ?${l.param}= en su línea canónica`);
      const delContrato = m[1]
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
