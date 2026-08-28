import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Allow } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import {
  CatalogService,
  GRADED_REVIEW_ALLOWED_REASONS,
  REVIEW_PAGE_SIZE_DEFAULT,
  REVIEW_PAGE_SIZE_MAX,
} from './catalog.service';
import {
  SettingKey,
  validateGradeList,
  validateGradedEstimateFreshnessDays,
  validateGradingMinUpsidePct,
} from '../settings/settings.constants';
import {
  validateGradingCostTiers,
  toGradedEstimateConfigDTO,
  GradedEstimateConfigDTO,
  validateGradedEstimateIngestMaxCards,
  validateGradedEstimateManualFreshnessDays,
  validateGradedEstimateMaxRawMultiple,
  validateGradedEstimateMinSampleCount,
  validateGradedEstimateSourceStat,
  HighlightReason,
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
  // v1.50.2 — las 5 nuevas de M2 (los DOS diales M10 siguen fuera: se editan en PUT /admin/settings).
  SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
  SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
  SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
  SettingKey.GRADED_ESTIMATE_SOURCE_STAT,
  SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
] as const;

/**
 * v1.50-graded-estimate (§M2) — body de `PUT /admin/pricing/graded-estimates`. `@Allow()` (whitelist sin
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
  // v1.50.2 — los 5 diales del gate de confianza y del ingest (I8/I9).
  @Allow() manualFreshnessDays?: unknown;
  @Allow() maxRawMultiple?: unknown;
  @Allow() minSampleCount?: unknown;
  @Allow() sourceStat?: unknown;
  @Allow() ingestMaxCardsPerRun?: unknown;
  /** ESPEJOS read-only de los DOS diales M10: si vienen, se IGNORAN (se editan en `PUT /admin/settings`). */
  @Allow() enabled?: unknown;
  @Allow() ingestEnabled?: unknown;
}

/**
 * M2 — «Gancho de grading»: diales del estimado PSA + curaduría del destacado (v1.44, `super_admin`).
 * API_CONTRACT §M2 › «Gancho de grading»; ARCHITECTURE §4.38d.
 *
 * **Recurso PROPIO, no `/admin/pricing/tiers`** (§4.38d / GU-A1): los tiers de rareza son una taxonomía
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
 * `POST /admin/pricing/override` (fase 1 manual-first, §4.38a).
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
   * tocar ningún precio de venta** (criterio 104).
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

    let gradingCostTiers: unknown;

    // I1–I5 — la tabla de escalones, con el MISMO validador compartido que usa la lectura fail-closed.
    // `costMxnCents >= 1`, JAMÁS 0: un costo de gradeo subestimado es exactamente lo que haría que el
    // comprador pierda dinero (§O.4).
    if (dto.gradingCostTiers !== undefined) {
      const err = validateGradingCostTiers(dto.gradingCostTiers);
      if (err) throw BusinessException.validation(err.code, err.message, err.details);
      writes.push({
        key: SettingKey.GRADING_COST_TIERS,
        value: dto.gradingCostTiers as unknown as Prisma.InputJsonValue,
      });
      gradingCostTiers = dto.gradingCostTiers;
    }

    // I6 + I8/I9 — los SIETE diales escalares, todos con el MISMO validador compartido que aplican
    // `PUT /admin/settings` y la lectura fail-closed del resolver. Una sola verdad por invariante.
    //
    // ⚠️ `freshnessDays` y `minUpsidePct` entraron aquí en v1.50.2 (techlead): se revalidaban A MANO
    // —`typeof v !== 'number' || !Number.isInteger(v) || v < MIN || v > MAX`— con el rango reescrito en
    // el mensaje, mientras `validateGradedEstimateFreshnessDays` / `validateGradingMinUpsidePct` ya
    // existían y eran los que gobernaban las otras DOS puertas a la misma clave. Tres copias del mismo
    // invariante que nadie obliga a coincidir: relajar el rango en el validador compartido dejaba esta
    // puerta estricta (o al revés) **sin que nada fallara**. El mensaje y el `details.field` que ve el
    // cliente no cambian: `${field} ${err}` reproduce exactamente el texto anterior.
    const patch: Partial<Record<keyof GradedEstimateConfigDTO, unknown>> = {};
    const applyDial = (
      field:
        | 'freshnessDays'
        | 'minUpsidePct'
        | 'manualFreshnessDays'
        | 'maxRawMultiple'
        | 'minSampleCount'
        | 'sourceStat'
        | 'ingestMaxCardsPerRun',
      key: (typeof GRADED_ESTIMATE_M2_KEYS)[number],
      validate: (v: unknown) => string | null,
    ): void => {
      const v = dto[field];
      if (v === undefined) return; // body PARCIAL: omitido = no se toca.
      const err = validate(v);
      if (err) {
        throw BusinessException.validation('VALIDATION_ERROR', `${field} ${err}`, { field });
      }
      writes.push({ key, value: v as Prisma.InputJsonValue });
      patch[field] = v;
    };
    applyDial('freshnessDays', SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS, validateGradedEstimateFreshnessDays);
    applyDial('minUpsidePct', SettingKey.GRADING_MIN_UPSIDE_PCT, validateGradingMinUpsidePct);
    // ⚠️ `manualFreshnessDays` acepta `null` como VALOR («no decae»), no como ausencia. Por eso la
    // guarda de arriba compara contra `undefined` y no es un `!= null`: un `null` explícito SE ESCRIBE.
    applyDial(
      'manualFreshnessDays',
      SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
      validateGradedEstimateManualFreshnessDays,
    );
    applyDial('maxRawMultiple', SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE, validateGradedEstimateMaxRawMultiple);
    applyDial('minSampleCount', SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT, validateGradedEstimateMinSampleCount);
    applyDial('sourceStat', SettingKey.GRADED_ESTIMATE_SOURCE_STAT, validateGradedEstimateSourceStat);
    applyDial(
      'ingestMaxCardsPerRun',
      SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
      validateGradedEstimateIngestMaxCards,
    );

    if (writes.length === 0) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Provide at least one of grades, highlightGrades, freshnessDays, minUpsidePct, gradingCostTiers, ' +
          'manualFreshnessDays, maxRawMultiple, minSampleCount, sourceStat, ingestMaxCardsPerRun',
      );
    }

    // v1.50.2 — el `after` se COMPUTA en vez de re-leerse, y es lo que permite auditar DENTRO de la
    // transacción (abajo). Es exacto por construcción: cada clave escrita ya pasó su validador, así que
    // la config efectiva resultante es `before` con esas claves sustituidas — el saneo on-read sobre un
    // valor válido es la identidad, y `highlightGrades ⊆ grades` ya se comprobó contra el ESTADO
    // RESULTANTE unas líneas más arriba. (Re-leer con `loadGradedEstimateConfigForAdmin()` desde dentro
    // de la transacción no serviría: ese lector usa su propia conexión y no vería lo aún no commiteado.)
    const after: GradedEstimateConfigDTO = {
      ...toGradedEstimateConfigDTO(before),
      ...(dto.grades !== undefined ? { grades } : {}),
      ...(dto.highlightGrades !== undefined ? { highlightGrades } : {}),
      ...(gradingCostTiers !== undefined ? { gradingCostTiers } : {}),
      ...patch,
    } as GradedEstimateConfigDTO;

    // v1.44 D4 — TODO-O-NADA de verdad: los upserts van en UNA transacción. Antes era un bucle suelto,
    // así que un fallo a media escritura (p. ej. `grades` sí y `gradingCostTiers` no) dejaba la config
    // en un estado MIXTO que nadie pidió, mientras BACKEND_NOTES §0.2 nº4 prometía atomicidad.
    //
    // v1.50.2 (deuda BE-GE2, PARIDAD con v2.1.6/P48-B1) — **la bitácora entra a la MISMA transacción**.
    // Antes se escribía DESPUÉS del commit, así que una excepción entre commit y `audit.log` (caída del
    // proceso, timeout del pool, fallo del insert de auditoría) dejaba **la config de dinero cambiada y
    // sin registro** — exactamente el agujero que P48-B1 cerró en `PUT /admin/settings`, en un endpoint
    // que gobierna una afirmación comercial y el gate que decide qué se promociona. Ahora efecto y
    // bitácora **commitean o revierten juntos**: es imposible que exista uno sin el otro, en cualquier
    // orden de fallo.
    await this.prisma.$transaction(async (tx) => {
      for (const w of writes) {
        await tx.configSetting.upsert({
          where: { key: w.key },
          create: { key: w.key, valueJson: w.value, updatedBy: userId },
          update: { valueJson: w.value, updatedBy: userId },
        });
      }
      await this.audit.log(
        {
          actorUserId: userId,
          action: 'pricing.graded_estimates.update',
          entityType: 'ConfigSetting',
          // `before`/`after` son la config EFECTIVA (saneada). `storedRaw` es el FORENSE: los valores
          // tal cual estaban almacenados, con las claves AUSENTES omitidas y las corruptas intactas.
          // Sin él, un `grading_cost_tiers` corrupto se auditaba como `[]` y la bitácora perdía la
          // evidencia de qué había realmente antes de la edición (D4).
          before: { ...toGradedEstimateConfigDTO(before), storedRaw },
          after,
        },
        tx,
      );
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
   * `GET /admin/pricing/graded-estimates/review` — **LISTA DE REVISIÓN** (v1.50.3, §4.38n, criterio
   * 111(e)). `super_admin`, read-only, paginada. Query: `?reason=&page=&pageSize=`, todos opcionales.
   *
   * Es la **contrapartida** de §4.38(k.3): decidimos NO ocultar en la ficha la cifra incoherente, y esa
   * decisión solo se sostiene si alguien puede enterarse de que existe. El `preview` exige `cardId`
   * —solo contesta si ya sospechabas—; esto responde «¿de qué cartas debo sospechar?».
   *
   * La lógica vive en `CatalogService.gradedEstimateReview`; aquí solo el borde HTTP: validación de
   * query con errores accionables y defaults del contrato.
   */
  @Get('review')
  async review(
    @Query('reason') reason?: string | string[],
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.catalog.gradedEstimateReview({
      reasons: this.reviewReasons(reason),
      page: this.reviewInt(page, 'page', 1, 1, Number.MAX_SAFE_INTEGER),
      pageSize: this.reviewInt(pageSize, 'pageSize', REVIEW_PAGE_SIZE_DEFAULT, 1, REVIEW_PAGE_SIZE_MAX),
    });
  }

  /**
   * `?reason=` repetible **o** CSV (las dos formas circulan por igual en el front y en `curl`).
   * Omitido ⇒ `undefined` ⇒ el servicio aplica el default del contrato (los TRES de coherencia).
   *
   * ⚠️ **Un `reason` no admitido es `400`, no un filtro vacío.** `NO_PSA10`, `NO_PSA9`, `NO_COST_TIER`,
   * `BELOW_MIN_UPSIDE`, `NOT_RAW`, `NOT_PUBLISHED` y `FEATURE_OFF` **no son incoherencias**: son
   * AUSENCIA de dato o el gate comercial haciendo su trabajo, y **la ausencia de estimado es el estado
   * NORMAL del catálogo** (§4.38b.4). Una lista que los aceptara tendría miles de filas normales y cero
   * valor operativo. Devolver `[]` en silencio sería peor: el operador leería «no hay nada que revisar»
   * de una consulta que nunca podía encontrar nada.
   *
   * ⚠️ **v1.50.3-c (§4.38n.2-bis, GU-A24): `STALE` SALIÓ de esa lista y ahora se ADMITE** (opt-in,
   * nunca en el default). Estaba agrupado con la «ausencia» y no pertenecía ahí: `NO_PSA10` significa
   * *nunca hubo dato*; `STALE` significa **hubo un dato, alguien lo puso o lo ingestó, y expiró** —una
   * cifra que existe en la BD **ahora mismo** y que desapareció de las tres superficies en silencio—.
   * Fuera del default por el mismo motivo que `SLAB_PUBLISHED`: ahogaría la señal de coherencia.
   */
  private reviewReasons(raw?: string | string[]): HighlightReason[] | undefined {
    if (raw === undefined) return undefined;
    const values = (Array.isArray(raw) ? raw : [raw])
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim())
      .filter((v) => v !== '');
    if (values.length === 0) return undefined;
    const invalid = values.filter((v) => !GRADED_REVIEW_ALLOWED_REASONS.includes(v as HighlightReason));
    if (invalid.length > 0) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        `reason no admitido: ${invalid.join(', ')}. Esta lista enumera INCOHERENCIAS de magnitud (y, ` +
          'como opt-in, `SLAB_PUBLISHED` y `STALE`), no ausencias de dato ni el gate comercial ' +
          'funcionando.',
        { field: 'reason', invalid, allowed: [...GRADED_REVIEW_ALLOWED_REASONS] },
      );
    }
    return [...new Set(values)] as HighlightReason[];
  }

  /** Entero de paginación con rango del contrato. Fuera de rango o no entero ⇒ `400` (jamás un clamp
   * silencioso: un `pageSize=1000` recortado a 100 sin avisar hace creer que se vio todo). */
  private reviewInt(raw: string | undefined, field: string, def: number, min: number, max: number): number {
    if (raw === undefined || raw.trim() === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        `${field} must be an integer in [${min}, ${max === Number.MAX_SAFE_INTEGER ? '∞' : max}]`,
        { field },
      );
    }
    return n;
  }

  /**
   * I7 sobre UNA lista de grados. Lista CERRADA a propósito (§O.1: otros grados quedan fuera).
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
