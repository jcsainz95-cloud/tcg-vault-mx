import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Finish, PendingPriceContext, Prisma, ProductType, Role } from '@prisma/client';
import { Allow, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from './pricing.service';
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

class OverrideDto {
  @IsString() cardId!: string;
  @IsString() productType!: ProductType;
  @IsString() gradeKey!: string;
  // SEGURIDAD L1 (dinero): rechaza 0 centavos. Un $0 de override/referencia de mercado NO debe ser
  // fijable — P-6 enruta al operador a override-and-publish, de modo que un 0 nunca es un precio legítimo.
  @IsInt() @Min(1) priceMxnCents!: number;
  // v1.6-finish: override por acabado (default normal). Cada acabado tiene su PriceReference.
  @IsOptional() @IsIn(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'])
  finish?: Finish;
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
class SealedSpreadsDto {
  @IsOptional() @IsObject() spreadPctBySubtype?: Record<string, number>;
  @IsOptional() @IsNumber() fallbackPct?: number;
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

  @Post('override')
  async override(@Body() dto: OverrideDto, @CurrentUser('id') userId: string) {
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
      entityId: ref.id,
      after: { priceMxnCents: dto.priceMxnCents, finish: dto.finish ?? 'normal' },
    });
    return ref;
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

  @Get('card/:cardId')
  history(@Param('cardId') cardId: string) {
    return this.pricing.priceHistory(cardId);
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
   * Reemplaza los spreads y/o el fallback (parcial: solo las claves a cambiar). Validación estricta
   * (subtype ∈ {box,etb,bundle,tin,blister}, value/fallback en [0,1000]) → 422 VALIDATION_ERROR.
   * Auditado (before/after). Surte efecto sin redeploy.
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
      const spreadsJson = dto.spreadPctBySubtype as unknown as Prisma.InputJsonValue;
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE },
        create: { key: SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE, valueJson: spreadsJson, updatedBy: userId },
        update: { valueJson: spreadsJson, updatedBy: userId },
      });
    }
    if (dto.fallbackPct !== undefined) {
      await this.prisma.configSetting.upsert({
        where: { key: SettingKey.SEALED_SPREAD_FALLBACK_PCT },
        create: { key: SettingKey.SEALED_SPREAD_FALLBACK_PCT, valueJson: dto.fallbackPct, updatedBy: userId },
        update: { valueJson: dto.fallbackPct, updatedBy: userId },
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
