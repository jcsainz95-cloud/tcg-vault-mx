import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Allow } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { CatalogService } from './catalog.service';
import { SettingKey, validateGradeList } from '../settings/settings.constants';
import {
  validateGradingCostTiers,
  toGradedEstimateConfigDTO,
  GRADING_MIN_UPSIDE_PCT_MAX,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MAX,
  GRADED_ESTIMATE_FRESHNESS_DAYS_MIN,
} from '../../common/graded-estimate';

/**
 * Las 5 claves de M2 que gobierna este recurso (el dial maestro `graded_estimates_enabled` NO: se edita
 * en `PUT /admin/settings`). Se usa para la foto forense `storedRaw` de la bitácora (D4).
 */
const GRADED_ESTIMATE_M2_KEYS = [
  SettingKey.GRADED_ESTIMATE_GRADES,
  SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES,
  SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS,
  SettingKey.GRADING_MIN_UPSIDE_PCT,
  SettingKey.GRADING_COST_TIERS,
] as const;

/**
 * v1.44-graded-estimate (§M2) — body de `PUT /admin/pricing/graded-estimates`. `@Allow()` (whitelist sin
 * validar aquí): la validación es MANUAL abajo porque los invariantes I1–I7 son ENTRE FILAS
 * (contigüidad, escalón final abierto, `highlightGrades ⊆ grades`) y deben salir 422 con códigos propios
 * (`GRADING_TIERS_EMPTY` / `GRADING_TIERS_NOT_CONTIGUOUS` / `GRADING_TIERS_NOT_OPEN_ENDED`), algo que los
 * decoradores de class-validator no expresan.
 */
class GradedEstimatesPutDto {
  @Allow() grades?: unknown;
  @Allow() highlightGrades?: unknown;
  @Allow() freshnessDays?: unknown;
  @Allow() minUpsidePct?: unknown;
  @Allow() gradingCostTiers?: unknown;
  /** ESPEJO read-only del dial M10: si viene, se IGNORA (se edita en `PUT /admin/settings`). */
  @Allow() enabled?: unknown;
}

/**
 * M2 — «Gancho de grading»: diales del estimado PSA + curaduría del destacado (v1.44, `super_admin`).
 * API_CONTRACT §M2 › «Gancho de grading»; ARCHITECTURE §4.35d.
 *
 * **Recurso PROPIO, no `/admin/pricing/tiers`** (§4.35d / GU-A1): los tiers de rareza son una taxonomía
 * LOCKED de 5 filas nombradas cuyo `PUT` EXIGE las 5 y valida el refinamiento premium; los escalones de
 * costo son filas AÑADIBLES/ELIMINABLES que son RANGOS y cuyo invariante es contigüidad + escalón final
 * abierto. Dos validadores incompatibles no caben en un `PUT`, y `PUT /admin/settings` valida key por key
 * y no puede expresar un invariante ENTRE filas con un error accionable.
 *
 * **Por qué vive en `CatalogModule` y no en `PricingController`:** el diagnóstico `/preview` necesita
 * componer los **grupos raw publicados** de la carta (`CatalogService`), y `CatalogModule` ya importa
 * `PricingModule` — inyectar `CatalogService` en el controller de pricing crearía un ciclo de módulos
 * (haría falta `forwardRef`). El recurso queda ENTERO en un solo controller; el prefijo de ruta
 * (`admin/pricing/...`) es el del contrato, independiente del módulo que lo aloja.
 *
 * NADA de lo que se edita aquí viaja al cliente. Los ESTIMADOS no se capturan aquí: se fijan con
 * `POST /admin/pricing/override` (fase 1 manual-first, §4.35a).
 */
@Controller('admin/pricing/graded-estimates')
@Roles(Role.super_admin)
export class GradedEstimatesController {
  constructor(
    private readonly pricing: PricingService,
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * `GET /admin/pricing/graded-estimates` — config EFECTIVA (la misma que usa el resolver, ya saneada
   * fail-closed). Read-only. `enabled` es el ESPEJO del dial M10 `gradedEstimatesEnabled`.
   *
   * **Se PROYECTA al `GradedEstimateConfigDTO` del contrato** (`toGradedEstimateConfigDTO`): los flags
   * internos de GU-A8 (`estimatesEnabled`/`highlightEnabled`) **no** forman parte del DTO. Devolver el
   * objeto interno tal cual filtraría al contrato cualquier estado que el resolver gane en el futuro.
   */
  @Get()
  async get() {
    return toGradedEstimateConfigDTO(await this.pricing.loadGradedEstimateConfigForAdmin());
  }

  /**
   * `PUT /admin/pricing/graded-estimates` — body PARCIAL por campo; el array `gradingCostTiers` se
   * reemplaza **COMPLETO** cuando viene (un patch por fila no puede validar contigüidad). `enabled` se
   * IGNORA (se edita en M10). Auditado (before/after). Sin redeploy.
   *
   * **Recalcula el conjunto destacado AL VUELO** (no hay materialización: el gate se evalúa en cada
   * request) ⇒ subir `minUpsidePct` o encarecer un escalón vacía la vitrina y quita los badges **sin
   * tocar ningún precio de venta** (criterio 86).
   */
  @Put()
  async put(@Body() dto: GradedEstimatesPutDto, @CurrentUser('id') userId: string) {
    const writes: { key: string; value: Prisma.InputJsonValue }[] = [];

    // I7 — `grades`/`highlightGrades` ⊆ {"10","9"}, no vacíos, sin duplicados, y highlightGrades ⊆ grades.
    // El subconjunto se valida contra el ESTADO RESULTANTE (mezcla de lo enviado y lo vigente), no solo
    // contra lo enviado: editar `grades` sin tocar `highlightGrades` no puede dejar un badge huérfano.
    const before = await this.pricing.loadGradedEstimateConfigForAdmin();
    // D4 — foto FORENSE de lo ALMACENADO (sin sanear) para la bitácora: es lo único que permite
    // reconstruir qué había realmente si el valor previo era corrupto o la fila no existía.
    const storedRaw = Object.fromEntries(
      (
        await this.prisma.configSetting.findMany({
          where: { key: { in: [...GRADED_ESTIMATE_M2_KEYS] } },
        })
      ).map((r) => [r.key, r.valueJson]),
    );
    const grades = dto.grades !== undefined ? this.gradeList(dto.grades, 'grades') : before.grades;
    const highlightGrades =
      dto.highlightGrades !== undefined
        ? this.gradeList(dto.highlightGrades, 'highlightGrades')
        : before.highlightGrades;
    const orphan = highlightGrades.filter((g) => !grades.includes(g));
    if (orphan.length > 0) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'highlightGrades must be a subset of grades',
        { field: 'highlightGrades', orphan },
      );
    }
    if (dto.grades !== undefined) {
      writes.push({ key: SettingKey.GRADED_ESTIMATE_GRADES, value: grades });
    }
    if (dto.highlightGrades !== undefined) {
      writes.push({ key: SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES, value: highlightGrades });
    }

    // I6 — umbrales.
    if (dto.freshnessDays !== undefined) {
      const v = dto.freshnessDays;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < GRADED_ESTIMATE_FRESHNESS_DAYS_MIN || v > GRADED_ESTIMATE_FRESHNESS_DAYS_MAX) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          `freshnessDays must be an integer in [${GRADED_ESTIMATE_FRESHNESS_DAYS_MIN}, ${GRADED_ESTIMATE_FRESHNESS_DAYS_MAX}] (days)`,
          { field: 'freshnessDays' },
        );
      }
      writes.push({ key: SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS, value: v });
    }
    if (dto.minUpsidePct !== undefined) {
      const v = dto.minUpsidePct;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > GRADING_MIN_UPSIDE_PCT_MAX) {
        throw BusinessException.validation(
          'VALIDATION_ERROR',
          `minUpsidePct must be a number in [0, ${GRADING_MIN_UPSIDE_PCT_MAX}]`,
          { field: 'minUpsidePct' },
        );
      }
      writes.push({ key: SettingKey.GRADING_MIN_UPSIDE_PCT, value: v });
    }

    // I1–I5 — la tabla de escalones, con el MISMO validador compartido que usa la lectura fail-closed.
    // `costMxnCents >= 1`, JAMÁS 0: un costo de gradeo subestimado es exactamente lo que haría que el
    // comprador pierda dinero (§N.4).
    if (dto.gradingCostTiers !== undefined) {
      const err = validateGradingCostTiers(dto.gradingCostTiers);
      if (err) throw BusinessException.validation(err.code, err.message, err.details);
      writes.push({
        key: SettingKey.GRADING_COST_TIERS,
        value: dto.gradingCostTiers as unknown as Prisma.InputJsonValue,
      });
    }

    if (writes.length === 0) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Provide at least one of grades, highlightGrades, freshnessDays, minUpsidePct, gradingCostTiers',
      );
    }

    // v1.44 D4 — TODO-O-NADA de verdad: los upserts van en UNA transacción. Antes era un bucle suelto,
    // así que un fallo a media escritura (p. ej. `grades` sí y `gradingCostTiers` no) dejaba la config
    // en un estado MIXTO que nadie pidió, mientras BACKEND_NOTES §0.2 nº4 prometía atomicidad.
    await this.prisma.$transaction(
      writes.map((w) =>
        this.prisma.configSetting.upsert({
          where: { key: w.key },
          create: { key: w.key, valueJson: w.value, updatedBy: userId },
          update: { valueJson: w.value, updatedBy: userId },
        }),
      ),
    );
    const after = toGradedEstimateConfigDTO(await this.pricing.loadGradedEstimateConfigForAdmin());
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.graded_estimates.update',
      entityType: 'ConfigSetting',
      // `before`/`after` son la config EFECTIVA (saneada). `storedRaw` es el FORENSE: los valores tal
      // cual estaban almacenados, con las claves AUSENTES omitidas y las corruptas intactas. Sin él, un
      // `grading_cost_tiers` corrupto se auditaba como `[]` y la bitácora perdía la evidencia de qué
      // había realmente antes de la edición (D4).
      before: { ...toGradedEstimateConfigDTO(before), storedRaw },
      after,
    });
    return after;
  }

  /**
   * `GET /admin/pricing/graded-estimates/preview?cardId=` — diagnóstico de CURADURÍA (read-only).
   * Responde «¿por qué esta carta no está destacada?» con el escalón aplicado, el umbral, la ganancia
   * neta sobre PSA 9 y un `reason` accionable, POR grupo raw publicado. Es el ÚNICO lugar donde los
   * insumos del gate se exponen (al admin, jamás al cliente). Indispensable en fase 1, donde el humano
   * cura a mano: sin él, «fijé el precio y no salió» sería una caja negra.
   */
  @Get('preview')
  async preview(@Query('cardId') cardId?: string) {
    if (!cardId || cardId.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'cardId is required', { field: 'cardId' });
    }
    return this.catalog.gradedEstimatePreview(cardId);
  }

  /**
   * I7 sobre UNA lista de grados. Lista CERRADA a propósito (§N.1: otros grados quedan fuera).
   *
   * v1.44 D3 — ENVUELVE el validador COMPARTIDO `validateGradeList` (`settings.constants.ts`, el mismo
   * que aplica `PUT /admin/settings` y la lectura fail-closed). Antes esta función re-implementaba la
   * regla completa: dos copias de la misma verdad que podían divergir en silencio. Lo único propio de
   * este endpoint es la FORMA del error (422 con `details.field`), así que eso es lo único que queda
   * aquí; el mensaje del validador se prefija con el campo para no perder contexto.
   */
  private gradeList(v: unknown, field: string): string[] {
    const err = validateGradeList(v);
    if (err) {
      throw BusinessException.validation('VALIDATION_ERROR', `${field} ${err}`, { field });
    }
    return v as string[];
  }
}
