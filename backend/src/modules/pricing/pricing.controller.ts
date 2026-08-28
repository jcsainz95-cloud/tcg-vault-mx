import { Body, Controller, Get, HttpCode, Logger, Param, Post, Put, Query } from '@nestjs/common';
import { Finish, PendingPriceContext, Prisma, ProductType, Role } from '@prisma/client';
import { FINISH_VALUES } from '../../common/enum-values';
import { Allow, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { PricingService, toPriceHistoryEntry } from './pricing.service';
import { FxService } from './fx.service';
import { SettingsService } from '../settings/settings.service';
import {
  SettingKey,
  validateSealedSpreads,
  validateSealedSpreadFallback,
  validateFxManualOverrideRate,
} from '../settings/settings.constants';
// v2.0/v2.1 (P-48, §4.36.8/§4.36.8a): la CURVA — editor de M2 y su dry-run.
import {
  CurveErrorCode,
  PendingReason,
  PricingCurve,
  collectCurveViolations,
  normalizePricingCurve,
} from '../../common/pricing-curve';
// v2.0 (§4.36.4): SOBREVIVE el catálogo canónico de rarezas, pero FUERA del pricing — aquí solo
// alimenta la vista de SALUD que respalda el guardarraíl (`GET /admin/pricing/rarities`).
import { rarityInfo } from '../../common/rarity-catalog';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceSyncJobService } from '../../jobs/price-sync.service';
// N-11: estado en memoria del barrido masivo de precios (barra de progreso del sync).
import { PriceIngestService } from './price-ingest.service';
// v1.28 (P-18/P-22): consola de precios por variante (M-30) — validación/upsert/auditoría.
import { VariantControlsService } from './variant-controls.service';

/** P-6 (§M2): valores válidos del query `?context=` de `GET /admin/pricing/pending`. */
const VALID_PENDING_CONTEXTS: readonly PendingPriceContext[] = Object.values(PendingPriceContext);

/** v2.0 (§M2): valores válidos del query `?reason=` de `GET /admin/pricing/pending`. */
const VALID_PENDING_REASONS: readonly PendingReason[] = ['no_market', 'premium_at_floor'];

/**
 * v2.1 (§4.36.8a): cap de sondas del dry-run. La tabla de referencia del editor necesita los 10
 * mercados de la prueba de mesa ∪ los puntos del borrador de un tiro; 50 deja holgura sin abrir un
 * vector de coste (el endpoint es puro CPU sobre aritmética entera).
 */
const CURVE_PREVIEW_MAX_PROBES = 50;

/**
 * v2.0 (§4.36.8) — body del `PUT /admin/pricing/curve`. La validación REAL es V1–V8
 * (`collectCurveViolations`), que es la MISMA que usa el dry-run: aquí solo se declara la forma
 * mínima para que `class-validator` no rechace el objeto antes de llegar al validador de dinero.
 */
class CurvePutDto {
  @IsInt() version!: number;
  @IsObject() sale!: Record<string, unknown>;
  @IsObject() buy!: Record<string, unknown>;
}

/** v2.1 (§4.36.8a) — body del dry-run. `draft` = la curva EN EDICIÓN (sin guardar). */
class CurvePreviewDto {
  @IsObject() draft!: Record<string, unknown>;
  // El rango/cap/enteros se validan en el handler para poder devolver `field` y un mensaje accionable.
  @Allow() marketsCents!: number[];
}

/**
 * v1.50.2 (§M2 / ARCHITECTURE §4.38l.1) — discriminante OBLIGATORIO cuando `productType:'graded'`.
 *
 *  - `market`          → precio de mercado REAL de un slab publicado (comportamiento vigente, §M1 v1.28).
 *  - `graded_estimate` → «valor estimado si se gradea» del gancho (§4.38): informativo, NO es dinero…
 *    **salvo que exista un slab publicado de ese grado**, y por eso ese caso se BLOQUEA con 409.
 */
const GRADED_INTENT_VALUES = ['market', 'graded_estimate'] as const;
type GradedIntent = (typeof GRADED_INTENT_VALUES)[number];

class OverrideDto {
  @IsString() cardId!: string;
  @IsString() productType!: ProductType;
  @IsString() gradeKey!: string;
  // SEGURIDAD L1 (dinero): rechaza 0 centavos. Un $0 de override/referencia de mercado NO debe ser
  // fijable — P-6 enruta al operador a override-and-publish, de modo que un 0 nunca es un precio legítimo.
  @IsInt() @Min(1) priceMxnCents!: number;
  // v1.6-finish: override por acabado (default normal). Cada acabado tiene su PriceReference.
  @IsOptional() @IsIn(FINISH_VALUES)
  finish?: Finish;
  /**
   * v1.50.2 — **OBLIGATORIO con `productType:'graded'`** (la exigencia se aplica en el handler, que es
   * quien conoce el `productType`; aquí solo se acota el DOMINIO). Con otro `productType` se IGNORA.
   *
   * ⚠️ **Deliberadamente SIN default.** Un `intent` que cayera a `'market'` por omisión es FAIL-OPEN:
   * el operador que olvida el campo obtendría, en silencio, la ruta que MUEVE DINERO (la fila que fija
   * el precio de venta de un slab publicado). Cuando la intención se perdió, no se adivina.
   */
  @IsOptional() @IsIn(GRADED_INTENT_VALUES)
  intent?: GradedIntent;
}

/**
 * v1.14-price-ingest (#13): `rate?` opcional. Si se omite, se actualiza SOLO el colchón
 * (`bufferPct`) sin pinnear el override manual de tasa (Banxico auto sigue activo). Ambos son
 * opcionales pero el controller exige al menos uno (422 si el body no trae ninguno).
 */
class FxDto {
  // FX-B2: fraccional permitido (FxRate es Decimal(12,6)); el rango [min, MAX] lo aplica el
  // validador compartido `validateFxManualOverrideRate` en setManual(), MISMA regla que
  // PUT /admin/settings. Aquí solo se exige que sea número finito (rechaza strings/NaN).
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsInt() @Min(0) bufferPct?: number;
}

/**
 * v1.23-sealed-sales (§M2): spreads de venta del SELLADO por presentación (+ fallback global).
 * PARCIAL: solo las claves a cambiar. `pct` = markup ARRIBA de mercado, número en [0,1000].
 */
/**
 * `SealedSpreadsUpdateRequest` del contrato (§DTOs) — **el REQUEST, distinto del DTO de respuesta, y
 * la diferencia es el punto**: los valores admiten `null` como sentinel de RETIRO (v2.1.9, D3-b).
 *
 * `fallbackPct` NO lo admite: se declara `@Allow()` en vez de `@IsNumber()` para que un `null`
 * **llegue al validador manual** y reciba el 422 con el motivo («el global es el respaldo del que
 * dependen las presentaciones sin regla; usa 0 para “sin markup global”») en vez del mensaje genérico
 * del pipe, que no diría qué hacer en su lugar.
 */
class SealedSpreadsDto {
  @IsOptional() @IsObject() spreadPctBySubtype?: Record<string, number | null>;
  @IsOptional() @Allow() fallbackPct?: number | null;
}

class SyncDto {
  @IsOptional() @IsString() scope?: 'all_vault' | 'cardIds';
  @IsOptional() cardIds?: string[];
}

/**
 * v1.28 (P-18/P-22, §M2) — body de PUT /admin/pricing/variant-controls/:cardId/:finish.
 * `@Allow()` (whitelist sin validar aquí): la validación es MANUAL en `VariantControlsService`
 * porque el contrato distingue OMITIDO (no tocar) de `null` (limpiar) — semántica que los
 * decoradores de class-validator no expresan — y los errores deben salir 422 con códigos propios
 * (VALIDATION_ERROR / FINISH_NOT_AVAILABLE / BOUNTY_PRICE_REQUIRED / BOUNTY_BELOW_RULE).
 */
class VariantControlsDto {
  @Allow() productType?: unknown;
  @Allow() gradeKey?: unknown;
  @Allow() sellOverrideCents?: unknown;
  @Allow() buyOverrideCents?: unknown;
  @Allow() bounty?: unknown;
}

/**
 * M2 — Catálogo y precios (super_admin). API_CONTRACT §M2.
 */
@Controller('admin/pricing')
@Roles(Role.super_admin)
export class PricingController {
  private readonly logger = new Logger(PricingController.name);

  constructor(
    private readonly pricing: PricingService,
    private readonly fx: FxService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly priceSync: PriceSyncJobService,
    private readonly priceIngest: PriceIngestService,
    private readonly variantControls: VariantControlsService,
  ) {}

  /**
   * @deprecated (v1.30) — «sync de precios (bóveda)» del UI M2. El front lo retira. NO se borra
   * todavía porque `PriceSyncJobService.run()` sigue siendo el ejecutable del job PROGRAMADO
   * `price-sync` (BullMQ, cron `15 6 * * *`, ver `scheduler.service.ts`), que SÍ depende del servicio.
   * Solo el DISPARO MANUAL por este endpoint (`.enqueue`) queda deprecado; retirarlo definitivamente es
   * follow-up del arquitecto una vez confirmado que ningún cliente lo llama. Ver docs/BACKEND_NOTES.md.
   */
  @Post('sync')
  async sync(@Body() dto: SyncDto, @CurrentUser('id') userId: string) {
    const result = await this.priceSync.enqueue(dto.scope ?? 'all_vault', dto.cardIds);
    await this.audit.log({ actorUserId: userId, action: 'pricing.sync', entityType: 'PriceReference' });
    return result;
  }

  /**
   * N-11 — GET /admin/pricing/sync-status: progreso del barrido MASIVO de precios (`price-ingest`)
   * en curso o del último. Calca `GET /admin/catalog/sync-status`. En memoria del proceso, NO llama
   * al proveedor en cada poll. El front lo pollea ~3s mientras `running` y pinta la barra done/total;
   * `dailyLimited` señala "pausado por límite del día (retoma 00:00 UTC), N pendientes".
   */
  @Get('sync-status')
  getSyncStatus() {
    return this.priceIngest.getSyncStatus();
  }

  /**
   * P-6 (§M2): dos buckets. Query param opcional `?context=` — **VENTA** = `context=inventory`;
   * **COMPRA** = vista READ-ONLY sobre `context=buylist`. Sin `context` → todos (back-compat).
   * Validación estricta: un valor fuera del enum `PendingPriceContext` → 422 VALIDATION_ERROR
   * (mismo estilo que el resto del controller). Producir el precio de COMPRA es WRITE del stream
   * buylist (`itemDecision`) — FUERA DE ALCANCE aquí; este endpoint es solo lectura.
   */
  @Get('pending')
  pending(@Query('context') context?: string, @Query('reason') reason?: string) {
    if (context !== undefined && !VALID_PENDING_CONTEXTS.includes(context as PendingPriceContext)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        `invalid context '${context}'`,
        { field: 'context', allowed: VALID_PENDING_CONTEXTS },
      );
    }
    // v2.0 (P-48, §M2): filtro `?reason=`. Distinguir las dos razones es lo que hace TRIABLE la cola:
    // `no_market` la cura sola el siguiente barrido; `premium_at_floor` (el guardarraíl) necesita que
    // el dueño mire — es la señal inequívoca de que el dato de mercado de esa chase está mal.
    if (reason !== undefined && !VALID_PENDING_REASONS.includes(reason as PendingReason)) {
      throw BusinessException.validation('VALIDATION_ERROR', `invalid reason '${reason}'`, {
        field: 'reason',
        allowed: VALID_PENDING_REASONS,
      });
    }
    return this.pricing.pendingQueue(
      context as PendingPriceContext | undefined,
      reason as PendingReason | undefined,
    );
  }

  /**
   * v2.1.7 (§M2) — Res `{ data: PriceHistoryEntryDTO }`: la referencia recién escrita **PROYECTADA**,
   * no la entidad.
   *
   * **Éste era el caso testigo de la regla.** Devolvía la fila Prisma `PriceReference` COMPLETA
   * (`id`, `priceUsdCents`, `fxRate`, `fxBufferPct`, `cardProductId`, `createdAt`…) con el contrato
   * sin decir nada. No era fuga pública —es `super_admin`— pero sí la **causa raíz** de esta familia:
   * cuando la respuesta ES la entidad, la forma de la API la define el **schema**, y **cada migración
   * pasa a ser un cambio de contrato silencioso**.
   *
   * El SERVICIO sigue devolviendo la entidad a propósito: sus otros llamadores la componen dentro de
   * una transacción (el alta de sellado con precio manual) y necesitan la fila. La proyección vive
   * **en el borde HTTP**, que es donde se decide la forma de la API.
   */
  @Post('override')
  // v1.50.3-c (QA MENOR-1): el contrato NORMA `200` («Res `200` NORMADA en v2.1.7») y `@Post` de Nest
  // responde `201` por default, así que el código venía incumpliendo su propia especificación. Manda el
  // contrato sobre el código (regla de conflicto), y `200` es además lo correcto en semántica: este
  // endpoint no crea un recurso direccionable —el `id` de la `PriceReference` va a la BITÁCORA, no a la
  // respuesta— y no hay `Location` que devolver.
  @HttpCode(200)
  async override(@Body() dto: OverrideDto, @CurrentUser('id') userId: string) {
    // ===== v1.50.2 (INV-D, §4.38l.1) — guarda de ESCRITURA, ANTES de tocar la tabla de dinero =====
    //
    // El problema, en una frase: la fila del ESTIMADO y la referencia de mercado real de una pieza PSA N
    // PUBLICADA son **la misma fila** (`cardId` + `graded` + `gradeKey` + `finish='normal'`). Fijar un
    // «estimado» sobre una carta que además tiene un slab publicado de ese grado **cambia el precio de
    // venta real de esa pieza**. Es preexistente; el gancho lo AMPLIFICA porque vuelve esa captura una
    // tarea rutinaria de curaduría. La solución NO es duplicar la verdad con una clave paralela (el
    // admin tendría que capturar dos veces y las dos filas divergirían): es **exigir que se declare la
    // intención** y bloquear la combinación imposible.
    if (dto.productType === 'graded') {
      if (dto.intent === undefined) {
        // §O.8 / criterio 112(b): el intento bloqueado se AUDITA antes de rechazarlo. Sin esta línea la
        // guarda es muda por la vía manual (el ingest ya audita en `price-ingest.service`) y nadie puede
        // ver si el operador está chocando contra ella a diario ni por qué.
        await this.auditGradedBlock(userId, dto, 'GRADED_INTENT_REQUIRED', {
          reason: 'intent_missing',
        });
        throw BusinessException.validation(
          'GRADED_INTENT_REQUIRED',
          'Para productType:"graded" debes declarar intent: "market" (precio de mercado real de un ' +
            'slab publicado) o "graded_estimate" (valor estimado si se gradea).',
          { field: 'intent', allowed: [...GRADED_INTENT_VALUES] },
        );
      }
      if (dto.intent === 'graded_estimate') {
        const slabs = await this.pricing.publishedSlabsForGradeKey(dto.cardId, dto.gradeKey);
        if (slabs.length > 0) {
          const grade = dto.gradeKey.split(':')[2] ?? '';
          await this.auditGradedBlock(userId, dto, 'GRADED_ESTIMATE_SLAB_PUBLISHED', {
            reason: 'slab_published',
            publishedSlabCount: slabs.length,
            inventoryItemIds: slabs.map((i) => i.id),
          });
          throw BusinessException.conflict(
            'GRADED_ESTIMATE_SLAB_PUBLISHED',
            `No se puede fijar un valor ESTIMADO de PSA ${grade} para esta carta: hay ${slabs.length} ` +
              `slab(s) PSA ${grade} publicado(s). Esa fila es el precio de mercado real de esas piezas ` +
              'y cambiaría su precio de venta. Usa intent:"market" si lo que quieres es fijar el precio ' +
              'de mercado del slab.',
            {
              cardId: dto.cardId,
              gradeKey: dto.gradeKey,
              publishedSlabCount: slabs.length,
              inventoryItemIds: slabs.map((i) => i.id),
            },
          );
        }
      }
    }
    const ref = await this.pricing.manualOverride(
      dto.cardId,
      dto.productType,
      dto.gradeKey,
      dto.priceMxnCents,
      dto.finish ?? 'normal',
    );
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.override',
      entityType: 'PriceReference',
      // El `id` sigue yendo a la BITÁCORA (donde se necesita para trazar), no a la respuesta.
      entityId: ref.id,
      // v1.50.2: el `intent` va a la BITÁCORA. Es la única señal que distingue «fijé el mercado de un
      // slab» de «capturé un estimado del gancho» sobre una fila idéntica; sin él, la auditoría no
      // puede reconstruir qué quiso hacer el operador.
      after: {
        priceMxnCents: dto.priceMxnCents,
        finish: dto.finish ?? 'normal',
        ...(dto.productType === 'graded' ? { intent: dto.intent } : {}),
      },
    });
    return { data: toPriceHistoryEntry(ref) };
  }

  /**
   * §O.8 / criterio 112(b) — **traza obligatoria del intento BLOQUEADO por la vía manual.**
   *
   * La guarda INV-D corta ANTES de escribir, así que sin esta bitácora un rechazo no deja ningún
   * rastro: el `422`/`409` lo ve solo quien hizo la petición y se pierde al cerrar la pestaña. §O.8
   * pide justo lo contrario —«que se vea si la guarda está saltando seguido y por qué»—, y la vía del
   * ingest ya lo cumple (`PriceIngestService.auditGradedSkip`). Esto la iguala.
   *
   * Se registra el intento COMPLETO (qué carta, qué grado, qué monto se quiso escribir y con qué
   * intención) porque el valor del registro está en poder reconstruir el intento, no en saber que hubo
   * uno. `action` distinta de `pricing.override` a propósito: un intento BLOQUEADO no es un override.
   *
   * **Nunca convierte un rechazo en un 500:** si la bitácora falla, se loguea y el `422`/`409` sigue
   * su curso. Perder la traza es malo; dejar pasar el intento por perderla sería peor.
   */
  private async auditGradedBlock(
    userId: string,
    dto: OverrideDto,
    code: 'GRADED_INTENT_REQUIRED' | 'GRADED_ESTIMATE_SLAB_PUBLISHED',
    extra: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.log({
        actorUserId: userId,
        action: 'pricing.override.blocked',
        entityType: 'PriceReference',
        entityId: dto.cardId,
        after: {
          code,
          cardId: dto.cardId,
          productType: dto.productType,
          gradeKey: dto.gradeKey,
          finish: dto.finish ?? 'normal',
          // El monto que NO se escribió: es lo que permite ver si el operador insiste con la misma cifra.
          attemptedPriceMxnCents: dto.priceMxnCents,
          intent: dto.intent ?? null,
          ...extra,
        },
      });
    } catch (e) {
      this.logger.warn(
        `pricing.override BLOQUEADO (${code}) card=${dto.cardId} gradeKey=${dto.gradeKey}: no se pudo ` +
          `escribir la bitácora (${(e as Error).message}). El rechazo se mantiene.`,
      );
    }
  }

  /**
   * v1.28 (P-18/P-22, §M2 / ARCHITECTURE §4.26a-b) — upsert de los CONTROLES de precio por
   * (carta, variante[, grado]): override de VENTA (pisa el storefront), override de COMPRA (pisa el
   * cotizador público) y bounty (P-22). `super_admin` (hereda el @Roles del controller: precios =
   * M2, §7) y AUDITADO (before/after) dentro del servicio. Campo omitido no se toca; `null` limpia.
   * NO toca PriceReference ni resuelve PendingPriceEntry (el mercado es otra perilla).
   */
  @Put('variant-controls/:cardId/:finish')
  putVariantControls(
    @Param('cardId') cardId: string,
    @Param('finish') finish: string,
    @Body() dto: VariantControlsDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.variantControls.update(cardId, finish, dto, userId);
  }

  /**
   * v2.1.7 (§M2) — Res `{ data: PriceHistoryEntryDTO[] }`, `capturedDate` desc.
   *
   * Forma NORMADA tras B-1: el contrato decía «historial de precios por fecha/fuente» **sin fijar
   * campos**, así que backend y frontend coincidían por **acuerdo tácito** —cada uno marcándolo como
   * SUPUESTO en su propio código— y el acuerdo ya tenía **grieta** (`source: string` aquí,
   * `PriceSource` allá). Es la misma condición que produjo B-1.
   */
  @Get('card/:cardId')
  async history(@Param('cardId') cardId: string) {
    return { data: await this.pricing.priceHistory(cardId) };
  }

  // ==========================================================================
  // v2.0/v2.1 (P-48) — LA CURVA: editor de M2 (§4.36.8) + dry-run (§4.36.8a)
  // ==========================================================================

  /**
   * §4.36.8 — lee la curva COMPLETA. Read-only. Es la fuente del editor de la tabla de puntos.
   */
  @Get('curve')
  async getCurve(): Promise<PricingCurve> {
    return this.pricing.loadPricingCurve();
  }

  /**
   * §4.36.8 — **REEMPLAZA el objeto completo** (semántica de reemplazo, no de patch por índice: mover
   * o borrar un renglón por índice es frágil y no auditable; el `AuditLog` guarda `before`/`after` del
   * objeto entero). Los puntos pueden venir DESORDENADOS: el server ordena por `marketCents`.
   *
   * Valida V1–V8 **al GUARDAR** (no solo en runtime) sobre el objeto completo, con el código y el
   * `details` que señalan QUÉ PUNTO lo rompe (criterio 87). **Autoridad única del dinero (SEC-A1):**
   * re-valida desde cero — un `preview` previo NO autoriza nada.
   *
   * Sin redeploy: mover un punto **repricia en el siguiente cálculo**, porque el precio de venta se
   * resuelve EN LECTURA y no está persistido (§4.36.9c) — por eso no hay que re-publicar nada.
   */
  @Put('curve')
  async putCurve(@Body() dto: CurvePutDto, @CurrentUser('id') userId: string): Promise<PricingCurve> {
    const problem = collectCurveViolations(dto)[0];
    if (problem) {
      throw BusinessException.validation(problem.code as CurveErrorCode, problem.message, problem.details);
    }
    const before = await this.pricing.loadPricingCurve();
    const curve = normalizePricingCurve(dto as unknown as PricingCurve);
    const valueJson = curve as unknown as Prisma.InputJsonValue;
    await this.prisma.configSetting.upsert({
      where: { key: SettingKey.PRICING_CURVE },
      create: { key: SettingKey.PRICING_CURVE, valueJson, updatedBy: userId },
      update: { valueJson, updatedBy: userId },
    });
    const after = await this.pricing.loadPricingCurve();
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.curve.update',
      entityType: 'ConfigSetting',
      before,
      after,
    });
    return after;
  }

  /**
   * v2.1 (§4.36.8a) — **DRY-RUN**: evalúa una curva BORRADOR contra N mercados de sonda y devuelve
   * precio + `priceBasis` + **memoria de cálculo**, junto al mismo cálculo con la curva **VIGENTE**
   * (que resuelve el servidor con SU almacén — el request NO la trae, a propósito).
   *
   * **No persiste, no audita, NO AUTORIZA:** un `200` con `violations: []` NO significa que el `PUT`
   * vaya a pasar; el `PUT` re-valida desde cero y es la única autoridad del dinero (SEC-A1).
   *
   * **El borrador inválido se parte por COMPUTABILIDAD, no por severidad** (§4.36.8a(c)): las
   * infracciones que impiden calcular (V1/V2/V3 y la escalera estructural) salen como `422` con el
   * mismo código y `details` que el `PUT` — un `200` ahí sería inventar un precio. Las que SÍ dejan
   * calcular (V4/V5/V6/V7 y la condición fina de V8) salen en `200` dentro de `violations[]`, para
   * que el previsualizador enseñe el problema EN PESOS mientras el dueño corrige.
   */
  @Post('curve/preview')
  async previewCurve(@Body() dto: CurvePreviewDto) {
    const draft = dto?.draft as unknown;
    const markets = dto?.marketsCents;
    // v2.1.2 (M1) — **400, no 422**: la FORMA de la petición (array no vacío, ≤ cap, enteros ≥ 0) es
    // un contrato de request, no una regla de negocio; el precedente local es unánime para la misma
    // forma (`/buylist/quote/batch`, `bulk-publish`, `bulk-remove` responden todos 400). Los 422 de
    // este endpoint quedan SOLO para las infracciones de la curva que impiden calcular (abajo).
    if (!Array.isArray(markets) || markets.length === 0 || markets.length > CURVE_PREVIEW_MAX_PROBES) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        `marketsCents must be a non-empty array of at most ${CURVE_PREVIEW_MAX_PROBES} integers`,
        { field: 'marketsCents' },
      );
    }
    for (const m of markets) {
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 0) {
        throw BusinessException.badRequest(
          'VALIDATION_ERROR',
          'each marketCents must be an integer >= 0 (cents). `0` IS a legitimate probe: it shows that without market data the price is PENDING (the floor does NOT win)',
          { field: 'marketsCents', value: m },
        );
      }
    }
    // Solo las BLOQUEANTES cortan: sin ellas no hay número que devolver.
    const blocking = collectCurveViolations(draft).find((e) => e.blocking);
    if (blocking) {
      throw BusinessException.validation(blocking.code as CurveErrorCode, blocking.message, blocking.details);
    }
    const { rows, violations } = await this.pricing.previewCurve(draft as PricingCurve, markets);
    // El contrato expone `{ code, details }` — `blocking` es detalle interno del validador.
    return { rows, violations: violations.map((v) => ({ code: v.code, details: v.details })) };
  }

  /**
   * §4.36.8 — `GET /admin/pricing/rarities` **SOBREVIVE, RE-PROPOSITADO**: es lo único que queda del
   * editor viejo. Deja de ser un editor de precios (la rareza SALIÓ del pricing, criterio 84) y pasa a
   * ser la **SALUD DEL CATÁLOGO DE RAREZAS QUE RESPALDA EL GUARDARRAÍL** (§4.36.5): qué rarezas
   * existen, cuáles son `premium` y cuántas cartas hay de cada una.
   *
   * Se RETIRAN `rule`, `tierId`, `source`, `fallbackPct` y el alias deprecado `rarity`: ya no hay
   * reglas que mostrar. Ordenado por `cardCount` desc.
   */
  @Get('rarities')
  async rarities() {
    // Agrupa por la CANÓNICA (§4.28c: empate 1:1 con el catálogo) + una forma cruda representativa
    // por canónica (diagnóstico del ingest).
    const grouped = await this.prisma.card.groupBy({
      by: ['rarityCanonical', 'rarity'],
      _count: { _all: true },
    });
    const byCanonical = new Map<string, { canonical: string; raw: string | null; cardCount: number }>();
    for (const g of grouped) {
      const canonical = g.rarityCanonical;
      if (canonical == null) continue;
      const acc = byCanonical.get(canonical) ?? { canonical, raw: g.rarity ?? null, cardCount: 0 };
      acc.cardCount += g._count._all;
      if (acc.raw == null && g.rarity != null) acc.raw = g.rarity;
      byCanonical.set(canonical, acc);
    }
    const rarities = [...byCanonical.values()]
      .map((r) => {
        const info = rarityInfo(r.canonical);
        return {
          canonical: r.canonical,
          raw: r.raw,
          // `premium` es lo ÚNICO de esta respuesta que toca dinero — y lo hace BLOQUEANDO
          // (guardarraíl §4.36.5), nunca fijando un monto.
          premium: info.premium,
          mapped: info.mapped,
          cardCount: r.cardCount,
        };
      })
      .sort((a, b) => b.cardCount - a.cardCount);
    return { rarities };
  }

  // v2.0 (P-48, §4.36.8 / API_CONTRACT §M2) — **RETIRADOS por la curva**, sin sustituto:
  //   GET/PUT /admin/pricing/tiers        · GET/PUT /admin/pricing/tier-map
  //   GET     /admin/pricing/buylist-rules · GET     /admin/pricing/sales-rules
  //   GET     /admin/pricing/sales-rarities
  // El eje RAREZA ya no se edita porque SALIÓ del pricing: no hay tabla por rareza, ni mapa
  // rareza→tier, ni reglas por acabado. El editor de precios es ahora la TABLA DE PUNTOS
  // (`GET/PUT /admin/pricing/curve`, arriba). Las filas `ConfigSetting` de los cinco settings
  // retirados quedan huérfanas e inertes a propósito (§4.36.9b): borrar config en el mismo paso que
  // cambia la matemática elimina la vía de diagnóstico y el rollback barato.


  // ---------------- Spreads de venta del SELLADO (v1.23-sealed-sales, §4.23c) ----------------
  // Espejo de sales-rules pero keyeado por SealedSubtype. `pct` = markup ARRIBA de mercado.
  // Auditados (super_admin). Surten efecto sin redeploy. API_CONTRACT §M2 (sealed-spreads).

  /** Lee los spreads crudos por presentación + el fallback global. */
  private async readSealedSpreads(): Promise<{
    spreadPctBySubtype: Record<string, number>;
    fallbackPct: number;
  }> {
    const spreadPctBySubtype =
      ((await this.settings.getRaw(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE)) as Record<
        string,
        number
      > | null) ?? {};
    const fallbackPct = await this.settings.getNumber(SettingKey.SEALED_SPREAD_FALLBACK_PCT);
    return { spreadPctBySubtype, fallbackPct };
  }

  @Get('sealed-spreads')
  async getSealedSpreads() {
    return this.readSealedSpreads();
  }

  /**
   * Actualiza los spreads y/o el fallback. **PARCIAL por llave** (v2.1.9, D3-b): llave ausente = no se
   * toca; número = se fija; **`null` = se RETIRA** (esa presentación vuelve al `fallbackPct`, y el
   * `GET` deja de emitir la llave). Idempotente: retirar una llave que no estaba devuelve `200`.
   * `fallbackPct: null` ⇒ `422` (el global no se retira: dejaría en `PRICE_PENDING`, o sea fuera de la
   * vitrina, a toda presentación sin regla). Validación estricta
   * (`subtype ∈ SEALED_SUBTYPE_KEYS`, value/fallback en `[0, SEALED_SPREAD_PCT_MAX]`) →
   * `422 VALIDATION_ERROR`. Auditado (before/after). Surte efecto sin redeploy.
   *
   * ⚠️ v2.1.9 (D4) — este docstring decía `subtype ∈ {box,etb,bundle,tin,blister}`: **CINCO** de los
   * SIETE del enum. Era el residuo textual del mismo bug que v2.1.8 arregló en el código (`upc` y
   * `collection` faltaban en ocho listas, y el dueño no podía calibrar el spread de un UPC — caía
   * siempre al fallback del 25 %). El código ya derivaba del schema; la documentación no, y un
   * comentario desfasado sobre un dominio de llaves es exactamente lo que hace que alguien
   * «corrija» el código para que coincida. Se cita la CONSTANTE, no sus valores: un dominio de
   * llaves no se enumera a mano en prosa.
   */
  @Put('sealed-spreads')
  async putSealedSpreads(@Body() dto: SealedSpreadsDto, @CurrentUser('id') userId: string) {
    if (dto.spreadPctBySubtype === undefined && dto.fallbackPct === undefined) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Provide spreadPctBySubtype and/or fallbackPct',
      );
    }
    if (dto.spreadPctBySubtype !== undefined) {
      const err = validateSealedSpreads(dto.spreadPctBySubtype);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'spreadPctBySubtype' });
    }
    if (dto.fallbackPct !== undefined) {
      const err = validateSealedSpreadFallback(dto.fallbackPct);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'fallbackPct' });
    }

    const before = await this.readSealedSpreads();
    if (dto.spreadPctBySubtype !== undefined) {
      // v2.1.9 (D3-b) — MERGE PARCIAL, no reemplazo. Tres estados por llave, y los tres importan:
      //   ausente        ⇒ NO SE TOCA        (la semántica «parcial» que el contrato ya declaraba)
      //   número         ⇒ se fija
      //   null           ⇒ SE RETIRA         (esa presentación vuelve al `fallbackPct`; el GET la omite)
      //
      // ⚠️ Antes esto REEMPLAZABA el mapa entero (`valueJson: dto.spreadPctBySubtype`), que es
      // literalmente la alternativa que el arquitecto DESCARTÓ: un cliente rancio que mandara las
      // CINCO llaves de siempre borraría `upc` y `collection` **en silencio** — el bug de D3 reabierto
      // desde el otro lado, y ahora con consecuencia real porque las dos ya tienen semilla (v2.1.9).
      // El reemplazo total es correcto en el `PUT` de la CURVA, donde el objeto ES la unidad de
      // validación cruzada; aquí las llaves son INDEPENDIENTES, así que la unidad de edición es la llave.
      const merged: Record<string, number> = { ...before.spreadPctBySubtype };
      for (const [subtype, value] of Object.entries(dto.spreadPctBySubtype)) {
        if (value === null) delete merged[subtype]; // retiro (idempotente: borrar lo ausente es no-op)
        else merged[subtype] = value;
      }
      const spreadsJson = merged as unknown as Prisma.InputJsonValue;
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE },
        create: { key: SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE, valueJson: spreadsJson, updatedBy: userId },
        update: { valueJson: spreadsJson, updatedBy: userId },
      });
    }
    // `null` ya fue rechazado arriba con su motivo (el global no se retira), así que aquí solo puede
    // ser número. Se estrecha con un `const` en vez de un cast: si mañana alguien relajara el
    // validador, esto deja de compilar en lugar de escribir un `null` en el dial de respaldo.
    const nextFallbackPct: number | undefined = dto.fallbackPct ?? undefined;
    if (nextFallbackPct !== undefined) {
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SEALED_SPREAD_FALLBACK_PCT },
        create: { key: SettingKey.SEALED_SPREAD_FALLBACK_PCT, valueJson: nextFallbackPct, updatedBy: userId },
        update: { valueJson: nextFallbackPct, updatedBy: userId },
      });
    }
    const after = await this.readSealedSpreads();
    await this.audit.log({
      actorUserId: userId,
      action: 'pricing.sealed_spreads.update',
      entityType: 'ConfigSetting',
      before,
      after,
    });
    return after;
  }
}

/**
 * M2 — FX (super_admin). Separado por prefijo de ruta.
 */
@Controller('admin/fx')
@Roles(Role.super_admin)
export class FxController {
  constructor(
    private readonly fx: FxService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  current() {
    return this.fx.getCurrent();
  }

  @Put()
  async setManual(@Body() dto: FxDto, @CurrentUser('id') userId: string) {
    // #13: al menos uno de rate/bufferPct. Omitir `rate` guarda SOLO el colchón (no pinnea tasa).
    if (dto.rate == null && dto.bufferPct == null) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Provide rate and/or bufferPct');
    }
    // FX-B1/FX-B2: mismo validador compartido que PUT /admin/settings → rango [min, MAX] idéntico
    // en ambas puertas (esta NO queda más permisiva). Rechaza overrides absurdos que desbordarían
    // `Int priceMxnCents` en price-ingest. `null`/omitido = no pinnea la tasa (solo colchón).
    if (dto.rate != null) {
      const err = validateFxManualOverrideRate(dto.rate);
      if (err) throw BusinessException.validation('VALIDATION_ERROR', err, { field: 'rate' });
    }
    await this.fx.setManual(dto.rate, dto.bufferPct);
    await this.audit.log({
      actorUserId: userId,
      action: 'fx.override',
      after: { rate: dto.rate ?? null, bufferPct: dto.bufferPct ?? null },
    });
    return this.fx.getCurrent();
  }

  @Post('refresh')
  async refresh(@CurrentUser('id') userId: string) {
    const r = await this.fx.refreshFromBanxico();
    await this.audit.log({ actorUserId: userId, action: 'fx.refresh', after: r });
    return this.fx.getCurrent();
  }
}
