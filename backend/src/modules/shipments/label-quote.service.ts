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
import { accessoryInsuredCents } from './accessory-prep';
import { createHash } from 'crypto';
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
import { LABEL_SUBJECT_SELECT, LabelSubject, AdminShipmentKind, INBOUND_ADMIN_KIND, isBuylistInbound, labelSubjectOf, lockSubjectRows } from './label-subject';
import {
  INBOUND_SELL_REQUEST_GUARD_SELECT,
  OriginSnapshotDial,
  assertInboundOpenForLabel,
  inboundChargedOf,
  inboundInsuredValueCents,
  inboundPackageLines,
  inboundQuoteAddresses,
  rejectDestinationKeys,
  storeDestinationOf,
} from './label-inbound';

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
  // ⭐ rev BSD-1 (§BSD.4.2, criterio 532): el destino de una guía no se edita por el cuerpo — antes de cualquier red.
  rejectDestinationKeys(raw);
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
  kind: AdminShipmentKind;
  lines: PickedLine[];
  charged: ChargedShipping;
  customerUserId: string | null;
  /** ⭐ rev BSD-1 (§BSD.3 «Valor a asegurar»): solo la guía de entrada, ya resuelto (`offerGrossCents`). */
  inboundInsuredValueCents?: number;
  /**
   * 💰 v1.86⟨accesorios⟩ (§AC.9 «Seguro», criterio 714): Σ `(quantity − missingQty) × unitPriceCents` de los renglones de
   * accesorio `picked|missing` del envío directo (el paquete entra entero o nada). `0` sin renglones.
   */
  accessoryInsuredCents?: number;
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
    const exists = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true, ...LABEL_SUBJECT_SELECT } });
    if (!exists) throw BusinessException.notFound();
    // rev BSD-1 (§BSD.3): la política de la fila (salida o guía de ENTRADA del buylist). `kind`/`sellRequestId` son inmutables.
    const subject = labelSubjectOf(exists);

    // 2–3. Candado de fila y las guardas, en el orden del contrato; la dirección bajo el mismo candado.
    const g = await this.guardedRead(shipmentId, subject);
    // ⭐ rev BSD-1 (§BSD.3, I-BSD-5): el destino de la guía de entrada es SIEMPRE la tienda; incompleta ⇒ 409, antes de la red.
    const store = subject.sellRequestId
      ? storeDestinationOf(await this.settings.get<OriginSnapshotDial>(SettingKey.SKYDROPX_ORIGIN_SNAPSHOT))
      : null;

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
      if (reusable) {
        // ⭐💰 v1.80.12.13 (§19.32.2): REUTILIZAR también escribe `requestedAt`/`requestedByUserId` (la «vigente» de
        // `GET …/quote` es la última que el operador pidió) con CAS `expiresAt > now` — ⛔ `expiresAt` no cambia, y el CAS
        // mantiene el CHECK `expiresAt > requestedAt` por construcción. `count 0` ⇒ venció entre la lectura y la escritura ⇒
        // «sin reutilizable», sigue a la red (⛔ ni 500 ni 409). El reloj se relee: es el instante de la escritura.
        const at = this.clock.now();
        const touched = await this.prisma.shipmentQuote.updateMany({
          where: { id: reusable.id, expiresAt: { gt: at } },
          data: { requestedAt: at, requestedByUserId: actor.id },
        });
        if (touched.count === 1) {
          return this.toDto({ ...reusable, requestedAt: at, requestedByUserId: actor.id }, packages, g.charged, coverage.costCents, true);
        }
      }
    }

    // La llamada de red, FUERA de la tx. ⛔ El destino viaja neutralizado (C-23), el snapshot no cambia.
    // ⭐ rev BSD-1 (§BSD.3): en la guía de entrada `from` = el VENDEDOR (neutralizado) y `to` = la tienda.
    const snap = asObj(g.row.addressSnapshot);
    const parcel = { lengthCm: pkg.lengthCm, widthCm: pkg.widthCm, heightCm: pkg.heightCm, weightKg: pkg.weightKg, coverageCents: coverage.coverageCents };
    const input: QuoteInput = store
      ? { ...inboundQuoteAddresses(g.row.addressSnapshot, store), parcel }
      : {
          from: { templateId: (await this.settings.get<string>(SettingKey.SKYDROPX_ORIGIN_ADDRESS_TEMPLATE_ID)) as string },
          to: neutralizeOutboundAddress({
            countryCode: 'MX' as const,
            postalCode: String(snap.postalCode ?? ''),
            state: String(snap.state ?? ''),
            city: String(snap.city ?? ''),
            neighborhood: String(snap.neighborhood ?? ''),
          }),
          parcel,
        };
    let result;
    try {
      result = await this.selection.port.quote(input);
    } catch (e) {
      throw e instanceof ShippingProviderError ? e.toBusinessException() : e;
    }

    // ⭐ rev BSD-1 (§BSD.3 «Recomendada», P-BSD-4): la guía de entrada recomienda la más barata a domicilio (la tienda) y
    // ⛔ no lleva puntos de entrega (los del dial son de salida).
    const [preferred, dropoffs] =
      subject.recommendation === 'cheapest_home'
        ? [[] as string[], {} as Record<string, { name: string; address: string }>]
        : await Promise.all([
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

  /**
   * §19.6 paso 2–3 bajo `SELECT … FOR UPDATE`. Devuelve la foto con la que se cotiza. ⭐ rev BSD-1 (I-BSD-4): la guía de
   * entrada toma PRIMERO la solicitud y después la fila (`lockSubjectRows`).
   */
  private async guardedRead(shipmentId: string, subject: LabelSubject): Promise<GuardedShipment> {
    return this.prisma.$transaction(
      async (tx) => {
        await lockSubjectRows(tx, subject, shipmentId);
        if (subject.sellRequestId) return this.inboundGuardedRead(tx, shipmentId, subject);
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
          accessoryInsuredCents: accessoryInsuredCents(view.accLines ?? []),
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /**
   * ⭐ rev BSD-1 (§BSD.3) — la foto de la guía de ENTRADA bajo los dos candados: la guarda de la solicitud y de la fila, y lo
   * que la solicitud aporta (líneas `buy` para el empaque, la tarifa congelada como «lo cobrado», `offerGrossCents` asegurado).
   */
  private async inboundGuardedRead(tx: Prisma.TransactionClient, shipmentId: string, subject: LabelSubject): Promise<GuardedShipment> {
    const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
    const sr = await tx.sellRequest.findUniqueOrThrow({
      where: { id: subject.sellRequestId as string },
      select: {
        ...INBOUND_SELL_REQUEST_GUARD_SELECT,
        offerShippingFeeCents: true,
        offerGrossCents: true,
        items: { select: { id: true, offerDecision: true, productType: true, offeredPriceCents: true } },
      },
    });
    assertInboundOpenForLabel(row, sr, subject.openStatus);
    if (row.labelProcessingSince !== null) {
      throw BusinessException.conflict('LABEL_IN_PROGRESS', 'A label purchase is in progress for this shipment');
    }
    const missing = shipmentAddressMissing(row.addressSnapshot);
    if (missing.length > 0) throw new BusinessException('SHIPMENT_ADDRESS_INCOMPLETE', 422, 'Shipment address is incomplete', { missing });
    return {
      row,
      kind: INBOUND_ADMIN_KIND,
      lines: inboundPackageLines(sr.items),
      charged: inboundChargedOf(sr),
      customerUserId: null,
      inboundInsuredValueCents: inboundInsuredValueCents(sr),
    };
  }

  /**
   * Las guardas de §19.6 paso 2 + paso 3, en el orden del contrato: estado ⇒ preparado ⇒ las de §M4-SHIP.6 (casos,
   * orden, origen; ⛔ **las mismas funciones**: `prep.assertCanAdvance`) ⇒ ya tiene guía ⇒ compra en curso ⇒ dirección.
   * Las usa también `label` (D2c, paso 2).
   */
  async assertQuotable(tx: Prisma.TransactionClient, row: ShipmentRequest): Promise<void> {
    if (row.status !== labelSubjectOf(row).openStatus) {
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

  /**
   * Lo cobrado por el envío: directo ⇒ la orden (`netShippingRevenueCents`); retiro ⇒ la fila (`shipmentNetRevenueCents`);
   * ⭐ rev BSD-1 guía de entrada ⇒ la tarifa congelada de la solicitud (`inboundChargedOf`, §BSD.3 «Lo cobrado»).
   */
  async chargedOf(row: ShipmentRequest, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<ChargedShipping> {
    const sellRequestId = isBuylistInbound(row) ? labelSubjectOf(row).sellRequestId : null;
    if (sellRequestId) {
      return inboundChargedOf(await db.sellRequest.findUniqueOrThrow({ where: { id: sellRequestId }, select: { offerShippingFeeCents: true, offerGrossCents: true } }));
    }
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
    // ⭐ rev BSD-1 (§BSD.3): la guía de entrada asegura lo que vamos a pagar por las cartas (`offerGrossCents`).
    if (g.inboundInsuredValueCents !== undefined) return g.inboundInsuredValueCents;
    if (g.kind === 'guest_direct_ship') return g.lines.reduce((s, l) => s + (l.paidCents ?? 0), 0) + (g.accessoryInsuredCents ?? 0);
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
   * §19.19.4 con §19.31.2 — persistencia con la unicidad `(shipmentRequestId, providerQuotationId)`: mismo envío ⇒ se
   * ACTUALIZA la fila, ahora con `requestedAt = now` y `requestedByUserId = actor` (así «la vigente» de `GET …/quote` es la
   * última que el operador pidió). `expiresAt` = `quoteExpiryFor(filas del id en CUALQUIER envío, now)`: la misma generación
   * mientras haya una viva (⛔ nunca se alarga una viva, PS-95) o una generación nueva (`now + 24 h`) si todas vencieron.
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
    const seen = await this.prisma.shipmentQuote.findMany({
      where: { providerQuotationId: q.providerQuotationId },
      select: { shipmentRequestId: true, expiresAt: true },
    });
    const expiry = quoteExpiryFor(seen, now);
    if (expiry.reissuedAfter !== null) {
      this.logger.log(
        `skydropx quotation_id_reissued_after_expiry fp=${quotationFingerprint(q.providerQuotationId)} lastExpiredAt=${expiry.reissuedAfter.toISOString()}`,
      );
    }
    // La fila de ESTE envío, si estaba vigente, conserva su `expiresAt` (§19.31.2 punto 4); si estaba vencida, abre generación.
    const own = seen.find((r) => r.shipmentRequestId === shipmentId);
    const ownExpiresAt = own && own.expiresAt.getTime() > now.getTime() ? own.expiresAt : expiry.expiresAt;
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
        update: { ...fields, requestedAt: now, expiresAt: ownExpiresAt },
        create: {
          shipmentRequestId: shipmentId,
          providerQuotationId: q.providerQuotationId,
          requestedAt: now,
          expiresAt: expiry.expiresAt,
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

/**
 * 💰 §19.31.2 — la vigencia de una cotización con un `providerQuotationId` ya visto. Función PURA sobre las filas de ese id
 * (en CUALQUIER envío):
 *  - `V` = las vigentes (`expiresAt > now`); `V ≠ ∅` ⇒ `max(V.expiresAt)` (misma generación; ⛔ nunca se alarga);
 *  - `V = ∅` ⇒ generación nueva `now + 24 h`; si había filas (todas vencidas) `reissuedAfter` = la última vencida (el log
 *    `quotation_id_reissued_after_expiry`: ⛔ NO MEDIDO si Skydropx honra la tarifa de un id reutilizado).
 */
export function quoteExpiryFor(rows: readonly { expiresAt: Date }[], now: Date): { expiresAt: Date; reissuedAfter: Date | null } {
  const t = now.getTime();
  let alive: number | null = null;
  let lastExpired: number | null = null;
  for (const r of rows) {
    const e = r.expiresAt.getTime();
    if (e > t) alive = alive === null ? e : Math.max(alive, e);
    else lastExpired = lastExpired === null ? e : Math.max(lastExpired, e);
  }
  if (alive !== null) return { expiresAt: new Date(alive), reissuedAfter: null };
  return { expiresAt: new Date(t + QUOTE_TTL_MS), reissuedAfter: lastExpired === null ? null : new Date(lastExpired) };
}

/** Huella corta (sha256, 12 hex) del id de cotización para el log: ⛔ el id entero no viaja a los registros. */
export function quotationFingerprint(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Los contadores de lo excluido, recalculados con el MISMO filtro sobre la respuesta guardada (ya redactada). */
export function excludedFromRaw(raw: Prisma.JsonValue | null): ExcludedRatesDTO {
  const rates = asObj(raw).rates;
  return Array.isArray(rates) ? normalizeRates(rates, { insuranceEchoOk: false }).excluded : emptyExcluded();
}
