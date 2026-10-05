/**
 * label-quote.service.ts — 💰 D2b de Skydropx: `POST /api/v1/admin/shipments/:id/quote` y `GET …/quote` (operador+).
 * Norma: API_CONTRACT §M4-SHIP.19.6 con lo que la sustituye — §19.19.4 (cuerpo, eco del seguro, reutilización y vigencia,
 * normalización, recomendada, DTO), §19.19.5 (seguro por escalones), §19.20.1 (vigencia por `addressVersion`), §19.20.4
 * (`isPromo`), §19.22.2 (`missing`), §19.30.5 (C-23: neutralizar el destino también al COTIZAR). `HECHOS.md:48` (seguro
 * «el que aplique»), `:35` (99minutos preferente).
 *
 * ⛔ Este verbo NO escribe en `ShipmentRequest` (solo inserta/actualiza la cotización): cotizar es gratis y reversible.
 * ⛔ No pasa por la puerta de compra (§19.19.7): solo exige `shipping_provider = 'skydropx'`.
 * La tx solo toma el candado para las guardas y se cierra ANTES de la llamada de red (§4.50/§4.57 (e)).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, Role, ShipmentQuote, ShipmentRequest, ShippingPackage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { netShippingRevenueCents, shipmentNetRevenueCents, skydropxComputedIvaCents } from '../../common/money';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { InsuranceTier } from '../settings/shipping-dials';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { ProviderRate, QuoteInput } from '../shipping-provider/shipping-provider.port';
import { emptyExcluded, normalizeRates, pickRecommendedRateId } from '../shipping-provider/rate-normalization';
import { isPromoPlan } from '../shipping-provider/promo-plan';
import { ShipmentPrepService } from './shipment-prep.service';
import { shipmentAddressMissing } from './shipment-address-missing';
import { labelSourceOf } from './label-source';
import { insuranceCoverageFor, maxCoverageCentsOf } from './insurance';
import { neutralizeOutboundAddress } from './folio-neutralize';
import { ExcludedRatesDTO, ShipmentQuoteDTO, ShipmentRateDTO } from './label-dto';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { VaultService } from '../vault/vault.service';

/** R4 / §19.6: una cotización vale 24 h desde la PRIMERA vez que nuestro sistema vio su `providerQuotationId`. */
export const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;

export interface QuoteActor {
  id: string;
  role: Role;
}

export interface QuoteBody {
  packageCode: string | null;
  force: boolean;
}

/** El cuerpo de `POST …/quote` (§19.19.4): `{ packageCode?, force? }`. ⛔ `declaredValueCents` no existe: si viene, se ignora. */
export function parseQuoteBody(raw: unknown): QuoteBody {
  const body = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const pc = body.packageCode;
  if (pc !== undefined && pc !== null && (typeof pc !== 'string' || pc.trim().length === 0 || pc.length > 64)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'packageCode must be a non-empty string', { field: 'packageCode' });
  }
  const force = body.force;
  if (force !== undefined && typeof force !== 'boolean') {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'force must be a boolean', { field: 'force' });
  }
  return { packageCode: typeof pc === 'string' ? pc.trim() : null, force: force === true };
}

/** Lo que el envío cobró al cliente por el envío (§19.6 paso 6): columnas PERSISTIDAS, ⛔ nunca el dial. */
export interface ChargedShipping {
  grossCents: number;
  netCents: number;
}

export interface RateNormalizationContext {
  chargedNetCents: number;
  /** El costo del escalón de la tabla (§19.19.5) — el del seguro cuando el eco NO coincide. */
  tierCostCents: number;
  insuranceEchoOk: boolean;
  preferredCarriers: readonly string[];
  dropoffPoints: Readonly<Record<string, { name: string; address: string }>>;
  onInsuranceTierDrift?: (rateId: string, quoteCents: number, tierCents: number) => void;
}

/**
 * §19.19.4 — de `ProviderRate` a `ShipmentRateDTO`, puro. `priceCents = totalCents + seguro`; IVA de `vat_fee`
 * (`'provider'`) o, solo con `vat_fee: null`, `round((total − service_fee) × 16/116)` (`'computed'`); el seguro sin IVA;
 * `netCostCents = priceCents − ivaCents`; `marginCents = cobrado neto − costo neto`. Recomendada: la de §19.19.4
 * (`pickRecommendedRateId`). Orden `priceCents` asc (empate: `rateId`, para que la lista sea determinista).
 */
export function toRateDtos(rates: readonly ProviderRate[], ctx: RateNormalizationContext): { rates: ShipmentRateDTO[]; recommendedRateId: string | null } {
  const priced = rates.map((r) => {
    const fromQuote = ctx.insuranceEchoOk && r.insuranceCents !== null;
    const insuranceCents = fromQuote ? (r.insuranceCents as number) : ctx.tierCostCents;
    if (fromQuote && insuranceCents !== ctx.tierCostCents) ctx.onInsuranceTierDrift?.(r.rateId, insuranceCents, ctx.tierCostCents);
    const ivaFromProvider = r.vatCents !== null;
    const ivaCents = ivaFromProvider ? (r.vatCents as number) : skydropxComputedIvaCents(r.totalCents - r.serviceFeeCents);
    const priceCents = r.totalCents + insuranceCents;
    const netCostCents = priceCents - ivaCents;
    return {
      r,
      priceCents,
      dto: {
        rateId: r.rateId,
        carrierName: r.carrierName,
        carrierLabel: r.carrierLabel,
        serviceName: r.serviceName,
        priceCents,
        breakdown: {
          amountCents: r.amountCents,
          extraFeesCents: r.extraFeesCents,
          ivaCents,
          serviceFeeCents: r.serviceFeeCents,
          totalCents: r.totalCents,
          insuranceCents,
        },
        ivaSource: ivaFromProvider ? ('provider' as const) : ('computed' as const),
        insuranceSource: fromQuote ? ('quote' as const) : ('tier_table' as const),
        netCostCents,
        marginCents: ctx.chargedNetCents - netCostCents,
        days: r.days,
        deliveryKind: r.deliveryKind,
        pickup: r.pickup,
        planType: r.planType,
        isPromo: isPromoPlan(r.planType),
        dropoff: ctx.dropoffPoints[r.carrierName] ?? null,
        recommended: false,
        hidden: r.deliveryKind === 'branch',
      } satisfies ShipmentRateDTO,
    };
  });
  const recommendedRateId = pickRecommendedRateId(
    priced.map((p) => ({ rateId: p.r.rateId, carrierName: p.r.carrierName, deliveryKind: p.r.deliveryKind, priceCents: p.priceCents })),
    ctx.preferredCarriers,
  );
  const out = priced
    .map((p) => ({ ...p.dto, recommended: p.dto.rateId === recommendedRateId }))
    .sort((a, b) => a.priceCents - b.priceCents || a.rateId.localeCompare(b.rateId));
  return { rates: out, recommendedRateId };
}

/** La línea que cuenta para empaque y valor: `picked` y disponible (la que sale en la caja). */
export interface PickedLine {
  inventoryItemId: string;
  sealed: boolean;
  /** Lo pagado por la pieza (origen); `null` sin origen. */
  paidCents: number | null;
}

/** §19.6 paso 4 — la regla de empaque: sellado en la caja **o** más de N cartas ⇒ `box`; si no `envelope`. */
export function packageCodeByRule(lines: readonly PickedLine[], boxMinCards: number): 'box' | 'envelope' {
  return lines.some((l) => l.sealed) || lines.length > boxMinCards ? 'box' : 'envelope';
}

/** Lo que la tx de las guardas devuelve (la foto del envío bajo el candado). */
interface GuardedShipment {
  row: ShipmentRequest;
  kind: 'vault_withdrawal' | 'guest_direct_ship';
  lines: PickedLine[];
  charged: ChargedShipping;
  customerUserId: string | null;
}

@Injectable()
export class ShipmentQuoteService {
  private readonly logger = new Logger(ShipmentQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly prep: ShipmentPrepService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ================================================================ POST …/quote

  async quote(shipmentId: string, raw: unknown, actor: QuoteActor): Promise<ShipmentQuoteDTO> {
    const body = parseQuoteBody(raw);
    // 1. El interruptor (fail-closed) y los ajustes. Cotizar NO pasa por la puerta de compra (§19.19.7).
    await this.assertProviderOn();
    const packages = await this.prisma.shippingPackage.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    await this.assertProviderConfigured(packages);
    const exists = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();

    // 2–3. Candado de fila y las guardas, en el orden del contrato; la dirección bajo el mismo candado.
    const g = await this.guardedRead(shipmentId);

    // 4. Empaque: el pedido explícito o la regla.
    const rule = await this.settings.getNumber(SettingKey.SHIPPING_PACKAGE_RULE_BOX_MIN_CARDS);
    const pkg = this.resolvePackage(packages, body.packageCode ?? packageCodeByRule(g.lines, rule), body.packageCode !== null);

    // 5. Valor a asegurar (lo que va en la caja) y el escalón que lo cubre (§19.19.5).
    const insuredValueCents = await this.insuredValueOf(g);
    const tiers = await this.settings.get<InsuranceTier[]>(SettingKey.SHIPPING_INSURANCE_TIERS);
    const coverage = insuranceCoverageFor(insuredValueCents, tiers);
    if (!coverage) {
      throw new ShippingProviderError('SHIPPING_PROVIDER_NOT_CONFIGURED', 409, {
        missing: ['insurance_tier'],
        insuredValueCents,
        maxCoverageCents: maxCoverageCentsOf(tiers),
      }).toBusinessException();
    }

    // 6. Reutilizar una vigente con los MISMOS parámetros (empaque, cobertura y versión de la dirección), salvo `force`.
    const now = this.clock.now();
    if (!body.force) {
      const reusable = await this.prisma.shipmentQuote.findFirst({
        where: {
          shipmentRequestId: shipmentId,
          expiresAt: { gt: now },
          packageCode: pkg.code,
          declaredValueCents: coverage.coverageCents,
          addressVersion: g.row.addressVersion,
        },
        orderBy: { requestedAt: 'desc' },
      });
      if (reusable) return this.toDto(reusable, packages, g.charged, coverage.costCents, true);
    }

    // La llamada de red, FUERA de la tx. ⛔ El destino viaja neutralizado (C-23), el snapshot no cambia.
    const snap = asObj(g.row.addressSnapshot);
    const input: QuoteInput = {
      from: { templateId: (await this.settings.get<string>(SettingKey.SKYDROPX_ORIGIN_ADDRESS_TEMPLATE_ID)) as string },
      to: neutralizeOutboundAddress({
        countryCode: 'MX' as const,
        postalCode: String(snap.postalCode ?? ''),
        state: String(snap.state ?? ''),
        city: String(snap.city ?? ''),
        neighborhood: String(snap.neighborhood ?? ''),
      }),
      parcel: { lengthCm: pkg.lengthCm, widthCm: pkg.widthCm, heightCm: pkg.heightCm, weightKg: pkg.weightKg, coverageCents: coverage.coverageCents },
    };
    let result;
    try {
      result = await this.selection.port.quote(input);
    } catch (e) {
      throw e instanceof ShippingProviderError ? e.toBusinessException() : e;
    }

    const [preferred, dropoffs] = await Promise.all([
      this.settings.get<string[]>(SettingKey.SHIPPING_PREFERRED_CARRIERS),
      this.settings.get<Record<string, { name: string; address: string }>>(SettingKey.SHIPPING_DROPOFF_POINTS),
    ]);
    const normalized = toRateDtos(result.rates, {
      chargedNetCents: g.charged.netCents,
      tierCostCents: coverage.costCents,
      insuranceEchoOk: result.insuranceEcho.ok,
      preferredCarriers: preferred,
      dropoffPoints: dropoffs,
      onInsuranceTierDrift: (rateId, q, t) =>
        this.logger.warn(`skydropx insurance_tier_drift shipmentId=${shipmentId} rateId=${rateId} quote=${q} tier=${t}`),
    });

    const saved = await this.persist(shipmentId, actor, now, {
      providerQuotationId: result.providerQuotationId,
      completed: result.completed,
      packageCode: pkg.code,
      packageDimsJson: { lengthCm: pkg.lengthCm, widthCm: pkg.widthCm, heightCm: pkg.heightCm, weightKg: pkg.weightKg },
      declaredValueCents: coverage.coverageCents,
      insuredValueCents,
      insuranceEchoOk: result.insuranceEcho.ok,
      addressVersion: g.row.addressVersion,
      ratesJson: normalized.rates,
      rawResponseJson: result.raw,
      recommendedRateId: normalized.recommendedRateId,
    });

    // 7. Bitácora (solo cuando se habló con el proveedor: una reutilización no es una cotización nueva).
    await this.prisma.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'shipment.quoted',
        entityType: 'ShipmentRequest',
        entityId: shipmentId,
        after: {
          quoteId: saved.id,
          providerQuotationId: saved.providerQuotationId,
          packageCode: saved.packageCode,
          declaredValueCents: saved.declaredValueCents,
          rates: normalized.rates.length,
          recommendedRateId: normalized.recommendedRateId,
        },
      },
    });
    return this.toDto(saved, packages, g.charged, coverage.costCents, false, result.excluded);
  }

  // ================================================================ GET …/quote

  /** La cotización vigente (la ÚLTIMA, si sigue en plazo y es de la dirección vigente, §19.20.1) o `404`. */
  async current(shipmentId: string): Promise<ShipmentQuoteDTO> {
    const row = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId } });
    if (!row) throw BusinessException.notFound();
    const last = await this.prisma.shipmentQuote.findFirst({ where: { shipmentRequestId: shipmentId }, orderBy: { requestedAt: 'desc' } });
    if (!last || !this.isCurrent(last, row)) throw BusinessException.notFound();
    const packages = await this.prisma.shippingPackage.findMany();
    const tiers = await this.settings.get<InsuranceTier[]>(SettingKey.SHIPPING_INSURANCE_TIERS);
    const tierCost = insuranceCoverageFor(last.insuredValueCents, tiers)?.costCents ?? 0;
    return this.toDto(last, packages, await this.chargedOf(row), tierCost, true);
  }

  /** §19.20.1: vigente ⇔ `expiresAt > now ∧ addressVersion = ShipmentRequest.addressVersion`. */
  isCurrent(q: Pick<ShipmentQuote, 'expiresAt' | 'addressVersion'>, row: Pick<ShipmentRequest, 'addressVersion'>): boolean {
    return q.expiresAt.getTime() > this.clock.now().getTime() && q.addressVersion === row.addressVersion;
  }

  // ================================================================ piezas compartidas con `label` (D2c)

  /** `shipping_provider = 'off'` ⇒ `404 FEATURE_DISABLED` (fail-closed: sin `on` humano no se cotiza). */
  async assertProviderOn(): Promise<void> {
    const provider = await this.settings.get<string>(SettingKey.SHIPPING_PROVIDER);
    if (provider !== 'skydropx') throw BusinessException.notFound('FEATURE_DISABLED', 'Shipping provider is off');
  }

  /** `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing}` con `origin`, `env`, `packages` (en ese orden). */
  async assertProviderConfigured(packages: readonly ShippingPackage[], extra: string[] = []): Promise<void> {
    const missing: string[] = [];
    const template = await this.settings.get<string | null>(SettingKey.SKYDROPX_ORIGIN_ADDRESS_TEMPLATE_ID);
    if (template === null || template === undefined || template === '') missing.push('origin');
    if (this.selection.kind === 'noop') missing.push('env');
    if (!packages.some((p) => p.active && p.providerPackageType.trim().length > 0)) missing.push('packages');
    missing.push(...extra);
    if (missing.length > 0) throw ShippingProviderError.notConfigured(missing).toBusinessException();
  }

  /** §19.6 paso 2–3 bajo `SELECT … FOR UPDATE`. Devuelve la foto con la que se cotiza. */
  private async guardedRead(shipmentId: string): Promise<GuardedShipment> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR UPDATE`;
        const shipRow = (await this.prep.loadRow(tx, shipmentId))!;
        await this.assertQuotable(tx, shipRow);
        const view = await this.prep.buildView(tx, shipRow);
        const picked = view.lines.filter((l) => l.prepStatus === 'picked' && l.available);
        const sealedIds = new Set(
          shipRow.items.filter((i) => i.inventoryItem.productType === 'sealed').map((i) => i.inventoryItemId),
        );
        const lines: PickedLine[] = picked.map((l) => ({
          inventoryItemId: l.inventoryItemId,
          sealed: sealedIds.has(l.inventoryItemId),
          paidCents: l.origin?.unitPriceCents ?? null,
        }));
        return {
          row: shipRow,
          kind: view.kind,
          lines,
          charged: await this.chargedOf(shipRow, tx),
          customerUserId: shipRow.userId,
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /**
   * Las guardas de §19.6 paso 2 + paso 3, en el orden del contrato: estado ⇒ preparado ⇒ las de §M4-SHIP.6 (casos,
   * orden, origen; ⛔ **las mismas funciones**: `prep.assertCanAdvance`) ⇒ ya tiene guía ⇒ compra en curso ⇒ dirección.
   * Las usa también `label` (D2c, paso 2).
   */
  async assertQuotable(tx: Prisma.TransactionClient, row: ShipmentRequest): Promise<void> {
    if (row.status !== 'picking') {
      throw BusinessException.conflict('SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status: row.status });
    }
    if (row.preparedAt === null) throw BusinessException.conflict('SHIPMENT_NOT_PREPARED', 'Shipment is not prepared');
    await this.prep.assertCanAdvance(tx, row.id, 'guia');
    const labelSource = labelSourceOf(row);
    if (labelSource !== null) {
      throw BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'Shipment already has a label', { labelSource });
    }
    if (row.labelProcessingSince !== null) {
      throw BusinessException.conflict('LABEL_IN_PROGRESS', 'A label purchase is in progress for this shipment');
    }
    const missing = shipmentAddressMissing(row.addressSnapshot);
    if (missing.length > 0) {
      throw new BusinessException('SHIPMENT_ADDRESS_INCOMPLETE', 422, 'Shipment address is incomplete', { missing });
    }
  }

  /** Lo cobrado por el envío: directo ⇒ la orden (`netShippingRevenueCents`); retiro ⇒ la fila (`shipmentNetRevenueCents`). */
  async chargedOf(row: ShipmentRequest, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<ChargedShipping> {
    if (row.orderId) {
      const o = await db.order.findUniqueOrThrow({
        where: { id: row.orderId },
        select: { subtotalCents: true, shippingFeeCents: true, ivaCents: true, ivaRatePct: true, priceConvention: true },
      });
      return { grossCents: o.shippingFeeCents, netCents: netShippingRevenueCents(o) };
    }
    return { grossCents: row.shippingFeeCents, netCents: shipmentNetRevenueCents(row) };
  }

  /**
   * §19.19.5 — lo que va en la caja: directo ⇒ Σ `OrderItem.unitPriceCents` de las líneas `picked`; retiro ⇒ Σ
   * `marketValueOf(pieza)` (la valuación de «Mi bóveda», UN cuerpo) y, sin mercado, lo pagado (`resolveOrigin`).
   */
  private async insuredValueOf(g: GuardedShipment): Promise<number> {
    if (g.kind === 'guest_direct_ship') return g.lines.reduce((s, l) => s + (l.paidCents ?? 0), 0);
    if (g.lines.length === 0) return 0;
    // `VaultModule` importa `ShipmentsModule`: la valuación se toma del contenedor (sin ciclo de MÓDULOS Nest).
    const vault = this.moduleRef.get(VaultService, { strict: false });
    const pieces = await this.prisma.inventoryItem.findMany({ where: { id: { in: g.lines.map((l) => l.inventoryItemId) } } });
    const byId = new Map(pieces.map((p) => [p.id, p]));
    let total = 0;
    for (const l of g.lines) {
      const piece = byId.get(l.inventoryItemId);
      const ref = piece ? await vault.marketValueOf(piece) : null;
      total += ref && ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : (l.paidCents ?? 0);
    }
    return total;
  }

  /** `packageCode` explícito: inexistente ⇒ `400 {field}`; inactivo o sin código de proveedor ⇒ `409 {missing:['packages']}`. */
  private resolvePackage(packages: readonly ShippingPackage[], code: string, explicit: boolean): ShippingPackage {
    const pkg = packages.find((p) => p.code === code);
    if (!pkg && explicit) throw BusinessException.badRequest('VALIDATION_ERROR', 'Unknown package code', { field: 'packageCode' });
    if (!pkg || !pkg.active || pkg.providerPackageType.trim().length === 0) {
      throw ShippingProviderError.notConfigured(['packages']).toBusinessException();
    }
    return pkg;
  }

  /**
   * §19.19.4 — persistencia con la unicidad `(shipmentRequestId, providerQuotationId)`: mismo envío ⇒ se ACTUALIZA la fila
   * (`requestedAt` no se toca); `expiresAt` = primera observación del id por NUESTRO sistema (en cualquier envío) + 24 h.
   */
  private async persist(
    shipmentId: string,
    actor: QuoteActor,
    now: Date,
    q: {
      providerQuotationId: string;
      completed: boolean;
      packageCode: string;
      packageDimsJson: Prisma.InputJsonValue;
      declaredValueCents: number;
      insuredValueCents: number;
      insuranceEchoOk: boolean;
      addressVersion: number;
      ratesJson: ShipmentRateDTO[];
      rawResponseJson: unknown;
      recommendedRateId: string | null;
    },
  ): Promise<ShipmentQuote> {
    const first = await this.prisma.shipmentQuote.findFirst({
      where: { providerQuotationId: q.providerQuotationId },
      orderBy: { requestedAt: 'asc' },
      select: { requestedAt: true },
    });
    const firstSeen = first?.requestedAt ?? now;
    const fields = {
      completedAt: q.completed ? now : null,
      packageCode: q.packageCode,
      packageDimsJson: q.packageDimsJson,
      declaredValueCents: q.declaredValueCents,
      insuredValueCents: q.insuredValueCents,
      insuranceEchoOk: q.insuranceEchoOk,
      addressVersion: q.addressVersion,
      ratesJson: q.ratesJson as unknown as Prisma.InputJsonValue,
      rawResponseJson: (q.rawResponseJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      recommendedRateId: q.recommendedRateId,
      requestedByUserId: actor.id,
    };
    const key = { shipmentRequestId_providerQuotationId: { shipmentRequestId: shipmentId, providerQuotationId: q.providerQuotationId } };
    const write = () =>
      this.prisma.shipmentQuote.upsert({
        where: key,
        update: fields,
        create: {
          shipmentRequestId: shipmentId,
          providerQuotationId: q.providerQuotationId,
          requestedAt: now,
          expiresAt: new Date(firstSeen.getTime() + QUOTE_TTL_MS),
          ...fields,
        },
      });
    try {
      return await write();
    } catch (e) {
      // Dos cotizaciones simultáneas del mismo envío con el mismo id: la segunda `create` choca ⇒ es una actualización.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return write();
      throw e;
    }
  }

  /** La proyección (lista blanca). En una reutilizada, `excluded` sale de la respuesta redactada guardada (mismo filtro). */
  toDto(
    q: ShipmentQuote,
    packages: readonly ShippingPackage[],
    charged: ChargedShipping,
    tierCostCents: number,
    reused: boolean,
    excluded?: ExcludedRatesDTO,
  ): ShipmentQuoteDTO {
    const rates = (Array.isArray(q.ratesJson) ? q.ratesJson : []) as unknown as ShipmentRateDTO[];
    const dims = asObj(q.packageDimsJson);
    const pkg = packages.find((p) => p.code === q.packageCode);
    const fromQuote = rates.find((r) => r.insuranceSource === 'quote');
    return {
      quoteId: q.id,
      providerQuotationId: q.providerQuotationId,
      requestedAt: q.requestedAt.toISOString(),
      expiresAt: q.expiresAt.toISOString(),
      completed: q.completedAt !== null,
      reused,
      package: {
        code: q.packageCode,
        label: pkg?.label ?? q.packageCode,
        lengthCm: Number(dims.lengthCm),
        widthCm: Number(dims.widthCm),
        heightCm: Number(dims.heightCm),
        weightKg: Number(dims.weightKg),
      },
      insurance: {
        insuredValueCents: q.insuredValueCents,
        coverageCents: q.declaredValueCents,
        costCents: fromQuote ? fromQuote.breakdown.insuranceCents : (rates[0]?.breakdown.insuranceCents ?? tierCostCents),
      },
      charged,
      recommendedRateId: q.recommendedRateId,
      rates,
      excluded: excluded ?? excludedFromRaw(q.rawResponseJson),
    };
  }
}

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Los contadores de lo excluido, recalculados con el MISMO filtro sobre la respuesta guardada (ya redactada). */
export function excludedFromRaw(raw: Prisma.JsonValue | null): ExcludedRatesDTO {
  const rates = asObj(raw).rates;
  return Array.isArray(rates) ? normalizeRates(rates, { insuranceEchoOk: false }).excluded : emptyExcluded();
}
