import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { Roles } from '../../common/decorators/roles.decorator';
import { FINISH_VALUES } from '../../common/enum-values';
// `H3-d`: §0-Q (ausente/vacío/token/inválido) en UN solo sitio.
import { parseEnumFilter } from '../../common/enum-filter';
import { parseAdminListFilters } from '../../common/admin-list-filters';
import { BOUNTY_STATE_VALUES, BountyState } from './bounty-state';
import {
  ADMIN_BOUNTY_SORT_VALUES,
  AdminBountiesService,
  AdminBountyListResponse,
  AdminBountySort,
} from './admin-bounties.service';

/**
 * admin-bounties.controller.ts — v1.62/v1.62.1 · **`GET /api/v1/admin/pricing/bounties`**
 * (API_CONTRACT §M2-B.1 · ARCHITECTURE §4.42 · PROJECT criterio 184/D52).
 *
 * ### ⛔⛔ ESTE CONTROLLER EXPONE **SOLO** `@Get`, Y ESO ES NORMATIVO (§M2-B.2)
 * La pantalla **edita**, pero **fila a fila y reusando el endpoint que ya existe**
 * (`PUT /admin/pricing/variant-controls/:cardId/:finish`, sin un solo campo nuevo). **No hay
 * `POST /admin/pricing/bounties/bulk`, ni cuerpo con array, ni `?ids=`, ni «aplicar a los
 * seleccionados», ni «+10 % a los rebasados», ni «apagar los N rebasados».** Se escribe aquí porque
 * es como llegaría: *una lista invita al multi-select*. La razón que decide —y es medible— es que
 * **un `rebasada` ya no paga nada** (la precedencia de compra se lo salta), así que un botón masivo
 * de apagado **frenaría un gasto que el sistema ya frenó solo** mientras convierte N diagnósticos en
 * N decisiones que nadie tomó una por una. Las cuatro razones completas viven en §M2-B.2.
 * *(Candado: el inventario de rutas de `admin-bounties.routes.spec.ts`.)*
 *
 * ### Rol: `super_admin`, no `vault_operator+`
 * El binder expone `pricing.bounty` de **un set** a `vault_operator+` porque lo necesita para
 * capturar inventario; **la lista consolidada de todo lo que el negocio paga por encima de su tarifa
 * es un activo distinto** —la estrategia de compra en una pantalla— y su única acción es una
 * escritura `super_admin`.
 *
 * ### El borde HTTP es quien responde `400`
 * `state`/`sort`/`finish` fuera de enum y `page`/`pageSize` fuera de rango ⇒ **`400
 * VALIDATION_ERROR`** (patrón transversal de paginación/filtros admin, no el `422` de regla de
 * negocio). **No se hace *clamp* silencioso**: un `pageSize` inválido que se corrige solo devuelve
 * una página distinta de la pedida, y el operador creería estar en otro sitio.
 *
 * ### ⚠️ `H3-d` (2026-09-13) — el VACÍO no es un valor inválido: es «no filtres» ([§0-Q] fila 1)
 * Los cuatro parámetros de este handler contestan ahora lo mismo a `?x=` y `?x=%20` (**`200`**, sin
 * filtrar), y eso **no era así**. Medido por HTTP antes del arreglo
 * (`test/integration/pricing-enum-filters-empty.e2e-spec.ts`):
 *
 * | Param | `?x=` | `?x=%20` | Por qué |
 * |---|---|---|---|
 * | `state` | ✅ `200` | ✅ `200` | `parseStates` hace `.trim()` y `.filter(v => v !== '')` |
 * | `setId` | ✅ `200` | ✅ `200` | `trimmed()` |
 * | `sort` | ✅ `200` | ⛔ **`400`** | `raw === ''` es exacto: **un espacio no es la cadena vacía** |
 * | `finish` | ⛔ **`400`** | ⛔ **`400`** | `finish !== undefined` no mira el contenido |
 *
 * ⭐ **Lo que esta tabla enseña, y es el motivo de que esté escrita:** los cuatro parámetros viven en
 * el **mismo handler**, escritos por la misma mano, y salieron con **tres** conductas distintas ante
 * la misma entrada. **Nadie decidió eso** — se coló, tres veces, porque cada uno se escribió con el
 * operador que tenía a mano (`!== undefined`, `=== ''`, `trim()`). Es la deuda `H3` en miniatura y en
 * un solo fichero: *la conducta no la fija quien la escribe bien una vez, la fija tenerla en un sitio.*
 * Por eso `finish` pasa al helper único y no a una cuarta variante local.
 */
@Controller('admin/pricing/bounties')
@Roles(Role.super_admin)
export class AdminBountiesController {
  constructor(private readonly bounties: AdminBountiesService) {}

  @Get()
  async list(
    @Query('state') state?: string | string[],
    @Query('setId') setId?: string,
    @Query('finish') finish?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
  ): Promise<AdminBountyListResponse> {
    // `page`/`pageSize`/`q` con el MISMO parser transversal que el resto de colas admin (400, tope
    // de 100, `q` ≤ 200 chars). No se re-teclea aquí una segunda semántica de paginación.
    const parsed = parseAdminListFilters({ page, pageSize, q });
    const parsedSetId = this.trimmed(setId);
    // `H3-d`: `?finish=` era el ÚNICO de los cuatro parámetros de este handler que no descartaba el
    // vacío — `finish !== undefined` dejaba pasar `''` y `' '` a la validación ⇒ `400` donde §0-Q
    // fila 1 manda `200`. `parseEnumFilter` devuelve `undefined` para ausente/vacío, así que el
    // spread resuelve solo: sin valor ⇒ sin llave ⇒ no filtra. (Se evalúa UNA vez: la versión con el
    // ternario llamando dos veces al parser lanzaría dos veces en el camino de error.)
    const parsedFinish = parseEnumFilter('finish', finish, FINISH_VALUES);
    return this.bounties.list({
      states: this.parseStates(state),
      ...(parsedSetId !== undefined ? { setId: parsedSetId } : {}),
      ...(parsedFinish !== undefined ? { finish: parsedFinish } : {}),
      ...(parsed.q !== undefined ? { q: parsed.q } : {}),
      page: parsed.page,
      pageSize: parsed.pageSize,
      sort: this.parseSort(sort),
    });
  }

  /** `''`/whitespace = ausente (mismo criterio que `q` en el parser transversal). */
  private trimmed(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const t = raw.trim();
    return t === '' ? undefined : t;
  }

  /**
   * `state` es **repetible** (`?state=rebasada&state=invalida`) y sus valores son los CINCO del enum
   * de §M2-B.0. Omitido ⇒ **todos** (`undefined`, no una lista de cinco: «sin filtro» y «pedí los
   * cinco» son la misma respuesta hoy, pero solo una de las dos lo dice).
   *
   * ⛔ Un valor desconocido **no se ignora en silencio**: un filtro que se descarta calladamente
   * devuelve MÁS filas de las pedidas sobre una pantalla de dinero.
   */
  private parseStates(raw: string | string[] | undefined): BountyState[] | undefined {
    if (raw === undefined) return undefined;
    const values = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v).trim()).filter((v) => v !== '');
    if (values.length === 0) return undefined;
    for (const v of values) {
      if (!(BOUNTY_STATE_VALUES as readonly string[]).includes(v)) {
        throw BusinessException.badRequest('VALIDATION_ERROR', `invalid state '${v}'`, {
          field: 'state',
          allowed: [...BOUNTY_STATE_VALUES],
        });
      }
    }
    return [...new Set(values)] as BountyState[];
  }

  /**
   * `sort` NO es un filtro: es un **orden con default** (`attention_first`, §M2-B.1). Por eso no pasa
   * por `parseEnumFilter` —que devuelve `undefined` para «no filtres»— sino que resuelve al default.
   *
   * ### ⚠️ `H3-d` — aquí había MEDIO arreglo, que se lee igual que uno entero
   * Se encargó este parámetro como uno de los que «sí descartan el vacío». **Medido, descartaba `''`
   * pero no `' '`**: `raw === ''` es comparación exacta y **un espacio no es la cadena vacía**, así
   * que `?sort=%20` caía al `includes` y salía `400`
   * (`test/integration/pricing-enum-filters-empty.e2e-spec.ts`, medido antes del arreglo). §0-Q fila 1
   * dice literalmente *«cadena vacía, o **solo espacios** (tras `trim()`)»* — las dos, no una.
   *
   * Es **la misma trampa del `if (status)` de `P-84`** en su otra cara: allí `' '` era *truthy* y
   * pasaba; aquí `' '` **no es `''`** y pasa. El mismo espacio, el mismo desenlace, dos operadores
   * distintos. Por eso el arreglo es `trim()`, no otra comparación exacta.
   *
   * ⛔ **Esto NO decide la pregunta abierta del arquitecto.** `ADMIN_BOUNTY_SORT_VALUES`
   * (`admin-bounties.service.ts:42`) es una **unión de literales pura** (no hay enum de Prisma
   * detrás), así que si entra o no en §0-Q es de `H3-b`. Aquí no se migra al helper ni se cambia su
   * clase: solo se corrige el borde del vacío, que no dependía de esa decisión.
   */
  private parseSort(raw: string | undefined): AdminBountySort {
    if (raw === undefined || raw.trim() === '') return 'attention_first';
    if (!(ADMIN_BOUNTY_SORT_VALUES as readonly string[]).includes(raw)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `invalid sort '${raw}'`, {
        field: 'sort',
        allowed: [...ADMIN_BOUNTY_SORT_VALUES],
      });
    }
    return raw as AdminBountySort;
  }
}
