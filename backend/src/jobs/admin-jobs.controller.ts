import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
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
    private readonly audit: AuditService,
  ) {}

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
    const result = await this.priceIngest.run(dto.setId);
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
}
