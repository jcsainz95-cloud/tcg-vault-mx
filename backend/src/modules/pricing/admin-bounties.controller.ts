import { Controller, Get, Query } from '@nestjs/common';
import { Finish, Role } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { Roles } from '../../common/decorators/roles.decorator';
import { FINISH_VALUES } from '../../common/enum-values';
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
    return this.bounties.list({
      states: this.parseStates(state),
      ...(this.trimmed(setId) !== undefined ? { setId: this.trimmed(setId) } : {}),
      ...(finish !== undefined ? { finish: this.parseFinish(finish) } : {}),
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

  private parseFinish(raw: string): Finish {
    if (!(FINISH_VALUES as readonly string[]).includes(raw)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `invalid finish '${raw}'`, {
        field: 'finish',
        allowed: [...FINISH_VALUES],
      });
    }
    return raw as Finish;
  }

  private parseSort(raw: string | undefined): AdminBountySort {
    if (raw === undefined || raw === '') return 'attention_first';
    if (!(ADMIN_BOUNTY_SORT_VALUES as readonly string[]).includes(raw)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `invalid sort '${raw}'`, {
        field: 'sort',
        allowed: [...ADMIN_BOUNTY_SORT_VALUES],
      });
    }
    return raw as AdminBountySort;
  }
}
