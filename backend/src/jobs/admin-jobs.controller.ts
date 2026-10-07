import { Body, Controller, HttpCode, Optional, Post } from '@nestjs/common';
import { BusinessException } from '../common/business.exception';
import { Role } from '@prisma/client';
import { Allow, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../modules/audit/audit.service';
import { PortfolioSnapshotJobService } from './portfolio-snapshot.service';
import { IneRetentionJobService } from './ine-retention.service';
import { BuylistSweepJobService } from './buylist-sweep.service';
import { DisputeDeadlineJobService } from './dispute-deadline.service';
import { AuthTokenSweepJobService } from './auth-token-sweep.service';
import { SetPriceSyncJobService } from './set-price-sync.service';
import { SetValueSnapshotJobService } from './set-value-snapshot.service';
import { CatalogPriceSyncJobService } from './catalog-price-sync.service';
import { PriceIngestJobService } from './price-ingest.service';
import { SealedPriceIngestJobService } from './sealed-price-ingest.service';
import { SealedRestockNotifyService } from '../modules/catalog/sealed-restock-notify.service';
import { DecksMetaRefreshService } from '../modules/decks-meta/decks-meta-refresh.service';
import { ShipmentTrackingPollJob } from '../modules/shipments/tracking-poll.job';
import { ShipmentLabelProcessingJob } from '../modules/shipments/label-processing.job';
import { ShipmentExtraChargesJob } from '../modules/shipments/extra-charges.job';
import { SpendWatchService } from '../modules/spend-alerts/spend-watch.service';
import { SpendDigestService } from '../modules/spend-alerts/spend-digest.service';
import { isYmd } from '../modules/spend-alerts/mx-day';
import { WishlistNotifyService } from '../modules/wishlist/wishlist-notify.service';

/**
 * Body opcional del disparo de `spend-digest` (💰 C1, API_CONTRACT §M4-SHIP.19.33.9): `day?: 'YYYY-MM-DD'` re-manda el resumen de
 * ese día (solo si quedó `failed`); omitirlo = ayer en México. `@Allow()` para que el `ValidationPipe` global (whitelist) NO se
 * coma el campo: la forma la valida el controlador ⇒ `400 VALIDATION_ERROR {field:'day'}` (la forma del resto de días MX).
 */
class SpendDigestDto {
  @Allow() day?: unknown;
}

/** Body opcional del disparo de `decks-meta-refresh` (DECKS-META Fase 2, §7): `dryRun?`. */
class DecksMetaRefreshDto {
  // `dryRun:true` corre el pipeline REAL sin escribir nada publicado (verificación en prod, §8);
  // omitirlo respeta el dial `decks_meta_autofetch` (off ⇒ no-op).
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

/**
 * Body opcional del disparo de `shipment-tracking-poll` (⭐ D2d, API_CONTRACT §M4-SHIP.19.10: excepción a la familia, como
 * `price-ingest {setId}`): `shipmentId?` refresca UN envío; omitirlo corre el lote.
 */
class ShipmentTrackingPollDto {
  @IsOptional() @IsUUID() shipmentId?: string;
}

/** Body opcional del disparo de `price-ingest` (excepción a la familia body-vacío, §M10-ops). */
class PriceIngestDto {
  // v1.14-price-ingest: `setId?` (externalId `sv8` o id interno) para ingestar UN solo set y
  // verificar el esquema del proveedor en la 1ª corrida; omitirlo ingesta TODO el catálogo.
  @IsOptional() @IsString() setId?: string;
}

/** Body opcional del disparo de `sealed-price-ingest` (2ª excepción a la familia, §M10-ops). */
class SealedPriceIngestDto {
  // v1.19-sealed-tcgcsv: `groupId?` (entero positivo) para ingestar UN solo grupo TCGCSV —
  // verificación del esquema real en staging antes del flip del dial (§4.19f). Omitirlo
  // barre los grupos distintos de los items sellados mapeados.
  @IsOptional() @IsInt() @Min(1) groupId?: number;
}

/**
 * Disparo MANUAL de jobs (super_admin, auditado). Complementa al scheduler BullMQ (BE-5 /
 * v15-D1): price-sync y fx-refresh ya tienen su disparo en M2; aquí quedan
 * `portfolio-snapshot` y los 4 barridos (`ine-retention`, `buylist-sweep`,
 * `dispute-deadline`, `auth-token-sweep`). El scheduler los corre solos cuando hay
 * REDIS_URL; estos endpoints permiten dispararlos a mano (operación/ops).
 */
@Controller('admin/jobs')
@Roles(Role.super_admin)
export class AdminJobsController {
  constructor(
    private readonly portfolioSnapshot: PortfolioSnapshotJobService,
    private readonly ineRetention: IneRetentionJobService,
    private readonly buylistSweep: BuylistSweepJobService,
    private readonly disputeDeadline: DisputeDeadlineJobService,
    private readonly authTokenSweep: AuthTokenSweepJobService,
    private readonly setPriceSync: SetPriceSyncJobService,
    private readonly setValueSnapshot: SetValueSnapshotJobService,
    private readonly catalogPriceSync: CatalogPriceSyncJobService,
    private readonly priceIngest: PriceIngestJobService,
    private readonly sealedPriceIngest: SealedPriceIngestJobService,
    private readonly sealedRestockNotify: SealedRestockNotifyService,
    private readonly decksMetaRefresh: DecksMetaRefreshService,
    private readonly audit: AuditService,
    // ⭐💰 D2d (§M4-SHIP.19.10): los tres jobs de Skydropx (no-op con `shipping_provider='off'`). `@Optional()` SOLO por las
    // pruebas unitarias que construyen el controlador con la lista posicional de antes; en la app los da `ShipmentsModule`
    // (sin ellos, el disparo responde `404`, ⛔ nunca un `500`).
    @Optional() private readonly trackingPoll?: ShipmentTrackingPollJob,
    @Optional() private readonly labelProcessing?: ShipmentLabelProcessingJob,
    @Optional() private readonly extraCharges?: ShipmentExtraChargesJob,
    // 💰 C1 (§M4-SHIP.19.33.9): los dos jobs de avisos al dueño (D2g). `@Optional()` como los de D2d; sin ellos ⇒ `404`.
    @Optional() private readonly spendWatch?: SpendWatchService,
    @Optional() private readonly spendDigest?: SpendDigestService,
    // rev v1.87⟨wishlist⟩ (§WSH.5): el aviso «ya la tenemos». `@Optional()` como los de arriba; sin él ⇒ `404`.
    @Optional() private readonly wishlistNotify?: WishlistNotifyService,
  ) {}

  private need<T>(svc: T | undefined): T {
    if (!svc) throw BusinessException.notFound();
    return svc;
  }

  /**
   * ⭐ D2d (§M4-SHIP.19.10) — el sondeo de rastreo de Skydropx; `{shipmentId?}` refresca uno (el mismo cuerpo que
   * `POST /admin/shipments/:id/refresh-tracking`). Lee al proveedor; ⛔ no compra ni cancela.
   */
  @Post('shipment-tracking-poll')
  @HttpCode(200)
  async runShipmentTrackingPoll(@Body() dto: ShipmentTrackingPollDto, @CurrentUser() user: { id: string; role: Role }) {
    const result = await this.need(this.trackingPoll).run({ shipmentId: dto.shipmentId });
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.shipment_tracking_poll.run',
      entityType: 'Job',
      entityId: 'shipment-tracking-poll',
      after: { shipmentId: dto.shipmentId ?? null, ...result },
    });
    return result;
  }

  /**
   * ⭐💰 D2d (§M4-SHIP.19.10 con §19.27–§19.30) — guía en proceso, verificación de la compra en vuelo (adopta / libera /
   * incierta), conciliación de huérfanas con fusible, calibración pasiva y purga. ⛔ Nunca `purchase` (PS-99).
   */
  @Post('shipment-label-processing')
  @HttpCode(200)
  async runShipmentLabelProcessing(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.need(this.labelProcessing).run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.shipment_label_processing.run',
      entityType: 'Job',
      entityId: 'shipment-label-processing',
      after: result as unknown as Record<string, unknown>,
    });
    return result;
  }

  /** 💰 D2d (§M4-SHIP.19.10, AG-6) — los cargos extra de Skydropx de los últimos 45 días (idempotente por `providerChargeId`). */
  @Post('shipment-extra-charges')
  @HttpCode(200)
  async runShipmentExtraCharges(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.need(this.extraCharges).run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.shipment_extra_charges.run',
      entityType: 'Job',
      entityId: 'shipment-extra-charges',
      after: { ...result },
    });
    return result;
  }

  /**
   * 💰 C1 (§M4-SHIP.19.33.9, §19.29.7) — `spend-watch` a mano: marca del dueño (AG-21), correos pendientes, lotes de la hora y,
   * con `shipping_provider='skydropx'`, saldo (AG-7), AG-8 (b) y AG-10. Single-flight por el candado del servicio (otra corrida
   * viva ⇒ `skipped:'already_running'`). ⛔ No compra ni cancela.
   */
  @Post('spend-watch')
  @HttpCode(200)
  async runSpendWatch(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.need(this.spendWatch).run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.spend_watch.run',
      entityType: 'Job',
      entityId: 'spend-watch',
      after: result as unknown as Record<string, unknown>,
    });
    return result;
  }

  /**
   * 💰 C1 (§M4-SHIP.19.33.9, §19.29.7) — `spend-digest` a mano. `{day?}` (`YYYY-MM-DD`, día de México): re-manda ese día solo si
   * quedó `failed`; sin `day` = ayer en México (lo que haría el cron). Fuera de formato ⇒ `400 VALIDATION_ERROR {field:'day'}`.
   */
  @Post('spend-digest')
  @HttpCode(200)
  async runSpendDigest(@Body() dto: SpendDigestDto, @CurrentUser() user: { id: string; role: Role }) {
    const svc = this.need(this.spendDigest);
    const day = dto?.day;
    if (day !== undefined && !isYmd(day)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'day must be YYYY-MM-DD', { field: 'day' });
    }
    const result = await svc.run(day !== undefined ? { day } : {});
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.spend_digest.run',
      entityType: 'Job',
      entityId: 'spend-digest',
      after: { requestedDay: day ?? null, ...result },
    });
    return result;
  }

  @Post('portfolio-snapshot')
  @HttpCode(200)
  async runPortfolioSnapshot(@CurrentUser() user: { id: string; role: Role }) {
    const snapshotted = await this.portfolioSnapshot.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      // RB-1: taxonomía uniforme `jobs.<name>.run` (antes este job era el único sin sufijo `.run`).
      action: 'jobs.portfolio_snapshot.run',
      // RB-2: entityType/entityId presentes en TODA la auditoría de jobs (paridad con los disparos M2).
      entityType: 'Job',
      entityId: 'portfolio-snapshot',
      after: { snapshotted },
    });
    return { snapshotted };
  }

  @Post('ine-retention')
  @HttpCode(200)
  async runIneRetention(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.ineRetention.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.ine_retention.run',
      entityType: 'Job',
      entityId: 'ine-retention',
      after: result,
    });
    return result;
  }

  @Post('buylist-sweep')
  @HttpCode(200)
  async runBuylistSweep(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.buylistSweep.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.buylist_sweep.run',
      entityType: 'Job',
      entityId: 'buylist-sweep',
      after: result,
    });
    return result;
  }

  @Post('dispute-deadline')
  @HttpCode(200)
  async runDisputeDeadline(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.disputeDeadline.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.dispute_deadline.run',
      entityType: 'Job',
      entityId: 'dispute-deadline',
      after: result,
    });
    return result;
  }

  @Post('auth-token-sweep')
  @HttpCode(200)
  async runAuthTokenSweep(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.authTokenSweep.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.auth_token_sweep.run',
      entityType: 'Job',
      entityId: 'auth-token-sweep',
      after: result,
    });
    return result;
  }

  // v1.9-set-chart — siembra manual del primer punto sin esperar al cron: precia el set destacado…
  @Post('set-price-sync')
  @HttpCode(200)
  async runSetPriceSync(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.setPriceSync.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.set_price_sync.run',
      entityType: 'Job',
      entityId: 'set-price-sync',
      after: result,
    });
    return result;
  }

  // …y luego captura el snapshot del día (upsert idempotente).
  @Post('set-value-snapshot')
  @HttpCode(200)
  async runSetValueSnapshot(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.setValueSnapshot.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.set_value_snapshot.run',
      entityType: 'Job',
      entityId: 'set-value-snapshot',
      after: result,
    });
    return result;
  }

  // v1.12-catalog-pricing (§4.13c) — disparo manual del re-sync completo del catálogo (precios de
  // todo el catálogo + import de sets nuevos, `force:true`). Alias operativo del job 2×/día.
  @Post('catalog-price-sync')
  @HttpCode(200)
  async runCatalogPriceSync(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.catalogPriceSync.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.catalog_price_sync.run',
      entityType: 'Job',
      entityId: 'catalog-price-sync',
      after: result,
    });
    return result;
  }

  /**
   * v1.14-price-ingest (WS-A, §4.15h / §M10-ops) — dispara la INGESTA MASIVA de precios vía el
   * proveedor seleccionado por el dial `priceProvider`. Encola un fan-out BullMQ (un job por set,
   * reanudable) o —sin Redis— corre secuencial AWAITED. `setId?` opcional ingesta un solo set
   * (verificación de esquema en la 1ª corrida). **TOCA DINERO** (mueve precios de referencia) →
   * super_admin, auditado, single-flight. Res `202` (contrato §M10-ops).
   */
  @Post('price-ingest')
  @HttpCode(202)
  async runPriceIngest(@Body() dto: PriceIngestDto, @CurrentUser() user: { id: string; role: Role }) {
    // N-11: `setId` → ingesta AWAITED de UN set (verificación de esquema). Sin `setId` → barrido del
    // catálogo COMPLETO en SEGUNDO PLANO (fire-and-forget); el front pollea `GET /admin/pricing/sync-status`.
    const result = dto.setId ? await this.priceIngest.run(dto.setId) : await this.priceIngest.runBackground();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.price_ingest.run',
      entityType: 'Job',
      entityId: 'price-ingest',
      after: { job: result.job, setId: dto.setId ?? null, enqueued: result.enqueued },
    });
    return result;
  }

  /**
   * v1.19-sealed-tcgcsv (§4.19d / §M10-ops) — dispara la ingesta de la REFERENCIA de mercado
   * del SELLADO vía TCGCSV. Secuencial y AWAITED (sin fan-out), single-flight, fail-closed por
   * el dial `sealedPriceSource` (`off` → `enqueued:false, reason:'SEALED_PRICE_SOURCE_OFF'`).
   * `groupId?` opcional acota a UN grupo (verificación de esquema en staging). Es referencia
   * INFORMATIVA (no fija precio de venta ni pago) pero escribe `PriceReference` → super_admin,
   * auditado. Res `202` (contrato §M10-ops).
   */
  @Post('sealed-price-ingest')
  @HttpCode(202)
  async runSealedPriceIngest(
    @Body() dto: SealedPriceIngestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const result = await this.sealedPriceIngest.run(dto.groupId);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.sealed_price_ingest.run',
      entityType: 'Job',
      entityId: 'sealed-price-ingest',
      after: {
        job: result.job,
        groupId: dto.groupId ?? null,
        enqueued: result.enqueued,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
    return result;
  }

  /**
   * v1.23-sealed-sales (§4.23h / §M10-ops) — dispara `sealed-restock-notify`: empareja las
   * suscripciones «avísame cuando vuelva» PENDIENTES con los productos sellados de vuelta a `listed`
   * y envía correo. FEATURE-FLAGGED por `sealed_restock_alerts` (`off` → no-op, `enqueued:false`).
   * NO agendado en cron hasta el flip (§4.23h); este disparo manual es la superficie de ops. Res 202.
   */
  @Post('sealed-restock-notify')
  @HttpCode(202)
  async runSealedRestockNotify(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.sealedRestockNotify.run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.sealed_restock_notify.run',
      entityType: 'Job',
      entityId: 'sealed-restock-notify',
      after: {
        job: result.job,
        enqueued: result.enqueued,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.notified != null ? { notified: result.notified } : {}),
      },
    });
    return result;
  }

  /**
   * rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.5 «Disparo manual (QA)») — corre `wishlist-notify` una vez, con el mismo cuerpo
   * que el cron (candado consultivo incluido). `super_admin`, auditado como los demás. `200` con el resultado del job.
   */
  @Post('wishlist-notify')
  @HttpCode(200)
  async runWishlistNotify(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.need(this.wishlistNotify).run();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.wishlist_notify.run',
      entityType: 'Job',
      entityId: 'wishlist-notify',
      after: { ...result },
    });
    return result;
  }

  /**
   * DECKS-META Fase 2 (§7 / §8) — disparo manual del refresh semanal de decks meta desde Limitless.
   * `{ dryRun:true }` corre el pipeline REAL (fetch→parse→match→canary) SIN escribir nada publicado
   * (verificación en prod, ya que el sandbox bloquea el egress); sin `dryRun` respeta el dial
   * `decks_meta_autofetch` (off ⇒ no-op). NO toca dinero (datos de catálogo/meta). super_admin,
   * auditado (mismo patrón que los demás `POST /admin/jobs/*`). Res 202.
   */
  @Post('decks-meta-refresh')
  @HttpCode(202)
  async runDecksMetaRefresh(@Body() dto: DecksMetaRefreshDto, @CurrentUser() user: { id: string; role: Role }) {
    const result = await this.decksMetaRefresh.run({ dryRun: dto.dryRun });
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.decks_meta_refresh.run',
      entityType: 'Job',
      entityId: 'decks-meta-refresh',
      after: {
        skipped: result.skipped,
        mode: result.mode,
        ...(result.skipped
          ? { reason: result.reason }
          : {
              verdict: result.report.verdict,
              applied: result.report.applied,
              deckCount: result.report.decks.length,
              publishedSlugs: result.report.publishedSlugs,
            }),
      },
    });
    return result;
  }
}
