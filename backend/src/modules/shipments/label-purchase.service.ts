/**
 * label-purchase.service.ts — 💰🔒 D2c de Skydropx: `POST /api/v1/admin/shipments/:id/label` — comprar la guía con la tarifa
 * elegida. Norma: API_CONTRACT §M4-SHIP.19.7 leída con TODAS sus erratas, que mandan donde choquen (de la más vieja a la
 * más nueva): §19.18.3 (pagada pero cancelado), §19.19.7 (la puerta: dial + rol + env), §19.19.8 (cuerpo y costo),
 * §19.20.1 (versión de la dirección), §19.20.5 (`in_flight`), §19.21.4, §19.26.1–.4 (rechazo con id, sin replay,
 * `rate_already_purchased`, `provider_id_taken`, candado tras el reclamo), §19.27.2–.3 (una compra en vuelo a la vez,
 * paso 7b), §19.28.1–.3/.8 (folio en `address_to.reference`, vida máxima, `since` exacto, `pg_try_advisory_xact_lock`),
 * §19.29.1/.4/.6 (C-15…C-18, TG-1/TG-2, libros de intentos y guías pagadas, avisos), §19.30.4/.5 (C-22, C-23).
 * Porqué: ARCHITECTURE §4.60 (o)…(w). `HECHOS.md:58` (también el personal compra), `:61` (folio), `:62` (topes).
 *
 * ⛔ `port.purchase` tiene UN llamador en `backend/src`: `purchase()` de aquí, DESPUÉS del CAS del reclamo y del 7b
 * (PS-117, C-2). ⛔ Nunca se reintenta la compra (la cliente solo reintenta `401`/`429`). ⛔ Ninguna prueba compra de
 * verdad (PS-99): el candado de ejecución vive DENTRO del cliente real y la llave de entorno se inyecta (`LABEL_SPEND_KEY`).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, Role, ShipmentLabelAttempt, ShipmentQuote, ShipmentRequest, ShippingPackage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { skydropxComputedIvaCents } from '../../common/money';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import {
  PurchaseDeadlineError,
  ShippingProviderError,
  ShippingProviderPurchaseInFlightError,
  SkydropxMutationForbiddenError,
} from '../shipping-provider/shipping-provider.errors';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { OriginSnapshot, PurchaseInput, PurchaseResult, rejectedWithIdResult } from '../shipping-provider/shipping-provider.port';
import { providerUrlsFrom } from '../shipping-provider/provider-url';
import { FOLIO_ATTEMPT_MAX, providerReferenceOf, referenceTextOf } from '../shipping-provider/folio-token';
import { isPurchaseKeyTurned, ProviderKind } from '../shipping-provider/spend-gate';
import { OWNER_SELECT, isOwnerAccount } from '../spend-alerts/owner';
import { SpendAlertsService, dayMx } from '../spend-alerts/spend-alerts.service';
import { ShipmentQuoteService } from './label-quote.service';
import { ShipmentPrepService } from './shipment-prep.service';
import { ShipmentsService } from './shipments.service';
import { neutralizeOutboundAddress } from './folio-neutralize';
import { ShipmentRateDTO } from './label-dto';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { LABEL_VERIFY_CONFIG, LabelVerifyConfig, SKYDROPX_PURCHASE_LOCK_KEY, inflightBlockOf } from './label-verify.constants';
import { checkLabelLimits, LabelLimit } from './label-spend';
import { LabelOptionsDTO, asRate } from './label-view';
import { labelSourceOf } from './label-source';
import { shipmentAddressMissing } from './shipment-address-missing';

/**
 * 🔒 La tercera llave de la puerta (§19.19.7 con §19.31.5), INYECTABLE: las pruebas la sustituyen sin tocar el entorno
 * (PS-99). Por defecto `purchaseKeyFor(selection.kind)`: el `kind` sale del ARRANQUE, nunca de la petición.
 */
export const LABEL_SPEND_KEY = 'LABEL_SPEND_KEY';
export interface LabelSpendKey {
  turned(): boolean;
}
/** La llave por defecto: `isPurchaseKeyTurned(kind)` leída del proceso en CADA llamada (⛔ sin caché). */
export function purchaseKeyFor(kind: ProviderKind): LabelSpendKey {
  return { turned: () => isPurchaseKeyTurned(kind) };
}

/** C-13: conjuntos EXPLÍCITOS de roles por modo del dial (⛔ nunca `role !== 'customer'`). */
const PURCHASE_ROLES: Readonly<Record<'super_admin_only' | 'operators', ReadonlySet<Role>>> = {
  super_admin_only: new Set<Role>([Role.super_admin]),
  operators: new Set<Role>([Role.vault_operator, Role.super_admin]),
};

export interface LabelActor {
  id: string;
  role: Role;
}

export interface LabelBody {
  quoteId: string;
  rateId: string;
  expectedPriceCents: number;
  expectedMarginCents: number;
  confirmNegativeMargin: boolean;
  confirmBranchDelivery: boolean;
}

export type LabelOutcome = 'labeled' | 'processing' | 'in_progress' | 'in_flight';

/** El cuerpo de `POST …/label` (§19.7): `400 VALIDATION_ERROR {field}`. Campos de costo del cuerpo ⇒ se IGNORAN (SDX-R12). */
export function parseLabelBody(raw: unknown): LabelBody {
  const b = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => {
    const v = b[k];
    if (typeof v !== 'string' || v.trim() === '' || v.length > 200) throw BusinessException.badRequest('VALIDATION_ERROR', `${k} is required`, { field: k });
    return v;
  };
  const int = (k: string) => {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isInteger(v)) throw BusinessException.badRequest('VALIDATION_ERROR', `${k} must be an integer`, { field: k });
    return v;
  };
  const bool = (k: string) => {
    const v = b[k];
    if (v !== undefined && typeof v !== 'boolean') throw BusinessException.badRequest('VALIDATION_ERROR', `${k} must be a boolean`, { field: k });
    return v === true;
  };
  return {
    quoteId: str('quoteId'),
    rateId: str('rateId'),
    expectedPriceCents: int('expectedPriceCents'),
    expectedMarginCents: int('expectedMarginCents'),
    confirmNegativeMargin: bool('confirmNegativeMargin'),
    confirmBranchDelivery: bool('confirmBranchDelivery'),
  };
}

/** Lo que el paso 7 dejó escrito (la foto con la que se compra). */
interface Claim {
  since: Date;
  attemptId: string;
  /** Quien RECLAMÓ (el intento es suyo: TG-1 y AG-1 se le atribuyen aunque adopte o libere otro, §19.29.4). */
  claimerId: string;
  rate: ShipmentRateDTO;
  recommended: ShipmentRateDTO | null;
  quote: ShipmentQuote;
  pkg: ShippingPackage;
  row: ShipmentRequest;
  folio: string;
}

/**
 * Lo que necesitan las escrituras de la respuesta (paso 9) y de la adopción (§19.27.5): el reclamo con su `since` exacto,
 * su intento y la tarifa elegida. La adopción lo reconstruye de la fila y del intento (no tiene cotización ni empaque).
 */
export type PersistClaim = Pick<Claim, 'since' | 'attemptId' | 'claimerId' | 'rate' | 'recommended' | 'row' | 'folio'>;

/** La adopción (§19.18.4 paso 4, §19.27.5): bitácora `shipment.label_adopted` en la MISMA tx que la escritura. */
export interface AdoptionMark {
  via: 'reference' | 'recent_list';
  note?: string;
  actorTag?: string;
}

/** Datos de dinero que se escriben con la guía (§19.11, §19.19.8). */
interface LabelCost {
  shippingCostCents: number;
  shippingCostIvaCents: number;
  shippingIvaSource: 'provider' | 'computed';
  insuranceCostCents: number;
  totalCents: number;
}

type Tx = Prisma.TransactionClient;

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

/** La respuesta de `label`. `shipment` es el `AdminShipmentDTO` (con `labelOptions` del actor). */
export interface LabelResponse {
  outcome: LabelOutcome;
  shipment: unknown;
  label?: unknown;
  providerError?: { code: string; message: string };
}

@Injectable()
export class ShipmentLabelService {
  private readonly logger = new Logger(ShipmentLabelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly prep: ShipmentPrepService,
    private readonly quotes: ShipmentQuoteService,
    private readonly shipments: ShipmentsService,
    private readonly alerts: SpendAlertsService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
    @Inject(LABEL_VERIFY_CONFIG) private readonly cfg: LabelVerifyConfig,
    @Inject(LABEL_SPEND_KEY) private readonly spendKey: LabelSpendKey,
  ) {}

  // ================================================================ la puerta (§19.19.7, §19.26.6, C-13)

  /** `labelOptions` (§19.19.7 + §19.29.4 `limit`): lo que la ventana necesita para no ofrecer un botón que dará 403/404. */
  async labelOptionsFor(actor: LabelActor, shipmentId: string): Promise<LabelOptionsDTO> {
    const provider = (await this.settings.get<string>(SettingKey.SHIPPING_PROVIDER)) === 'skydropx' ? 'skydropx' : 'off';
    const purchase = (await this.settings.get<LabelOptionsDTO['purchase']>(SettingKey.SHIPPING_LABEL_PURCHASE)) ?? 'disabled';
    const roleOk = purchase !== 'disabled' && PURCHASE_ROLES[purchase].has(actor.role);
    const canPurchase = provider === 'skydropx' && roleOk && this.spendKey.turned();
    const actorRow = await this.prisma.user.findUnique({ where: { id: actor.id }, select: OWNER_SELECT });
    let limit: LabelOptionsDTO['limit'] = null;
    if (!isOwnerAccount(actorRow)) {
      const dials = await this.limitDials();
      // `reissue` si el envío ya agotó sus guías; `daily_spend` si el actor ya está en el tope (sin la cifra).
      const v = await checkLabelLimits(this.prisma, actorRow ?? { isOwner: false, role: actor.role, email: null, status: 'active', deletedAt: null }, actor.id, shipmentId, 0, this.clock.now(), dials);
      if (v.limit === 'reissue') limit = 'reissue';
      else if (v.usedCents >= dials.capCents) limit = 'daily_spend';
    }
    return { provider, purchase, canPurchase, limit };
  }

  /** Paso 1 (§19.7 + §19.19.7): proveedor ⇒ dial de compra ⇒ rol ⇒ llave de entorno ⇒ ajustes. Cero red, cero escrituras. */
  private async assertGate(actor: LabelActor, shipmentId: string): Promise<void> {
    await this.quotes.assertProviderOn();
    const purchase = await this.settings.get<string>(SettingKey.SHIPPING_LABEL_PURCHASE);
    if (purchase !== 'super_admin_only' && purchase !== 'operators') {
      throw new BusinessException('FEATURE_DISABLED', 404, 'Label purchase is disabled', { feature: 'label_purchase' });
    }
    if (!PURCHASE_ROLES[purchase].has(actor.role)) {
      await this.audit(this.prisma, actor, shipmentId, 'shipment.label_purchase_denied', { reason: 'label_purchase_super_admin_only', dial: purchase });
      throw BusinessException.forbidden('FORBIDDEN', 'Only a super admin can buy labels now', { reason: 'label_purchase_super_admin_only' });
    }
    if (!this.spendKey.turned()) throw ShippingProviderError.notConfigured(['allow_spend']).toBusinessException();
    const packages = await this.prisma.shippingPackage.findMany();
    const note = await this.settings.get<string | null>(SettingKey.SHIPPING_CONSIGNMENT_NOTE);
    await this.quotes.assertProviderConfigured(packages, note ? [] : ['consignment_note']);
  }

  private async limitDials() {
    return {
      capCents: await this.settings.getNumber(SettingKey.OPERATOR_LABEL_CAP_24H_CENTS),
      reissueMax: await this.settings.getNumber(SettingKey.SHIPPING_LABEL_REISSUE_MAX_PER_SHIPMENT),
    };
  }

  // ================================================================ POST …/label

  async purchase(shipmentId: string, raw: unknown, actor: LabelActor): Promise<LabelResponse> {
    const body = parseLabelBody(raw);
    await this.assertGate(actor, shipmentId);
    const exists = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();

    // 2–5. Bajo el candado de fila, SOLO LECTURA: guardas, cotización, tarifa, topes (previa), cifras, confirmaciones.
    const pre = await this.precheck(shipmentId, body, actor);
    if (pre.kind === 'in_progress') return this.respond(shipmentId, actor, 'in_progress');
    if (pre.kind === 'limited') {
      await this.onLimited(actor, shipmentId, pre.limit, pre.priceCents, pre.usedCents, pre.paidLabels);
      throw BusinessException.forbidden('LABEL_PURCHASE_LIMIT', 'Label purchase limit reached', { limit: pre.limit });
    }
    if (pre.kind === 'requote') {
      // 3. ⛔ Nunca se compra en la misma llamada tras re-cotizar: el operador no vio ese precio. Sin `force` (SEC-SDX-8).
      const quote = await this.quotes.quote(shipmentId, { packageCode: pre.packageCode }, actor);
      throw BusinessException.conflict('QUOTE_EXPIRED', 'The quote expired; confirm the new price', { quote, reason: pre.reason });
    }
    const { rate } = pre;

    // 6. Saldo (FUERA de la tx): salida temprana sin escribir. ⛔ El operador no ve el saldo (T.11).
    const now0 = this.clock.now();
    const balance0 = await this.readBalance();
    if (balance0 < rate.priceCents) {
      await this.alerts.raise(this.prisma, { kind: 'provider_balance_low', severity: 'immediate', dedupKey: `ag7:insufficient:${shipmentId}:${dayMx(now0)}`, shipmentRequestId: shipmentId, facts: { requiredCents: rate.priceCents } }, now0);
      throw BusinessException.conflict('SHIPPING_INSUFFICIENT_BALANCE', 'Insufficient provider balance', { requiredCents: rate.priceCents });
    }

    // 7. EL RECLAMO, bajo el candado consultivo de la cuenta (una compra en vuelo a la vez) y con los topes que mandan.
    let claimed: Awaited<ReturnType<ShipmentLabelService['claim']>>;
    try {
      claimed = await this.claim(shipmentId, body, actor, pre.quote, rate, pre.recommended);
    } catch (e) {
      // §19.28.8 + §19.31.3: candado ocupado ⇒ se relee la fila del PROPIO envío con `FOR SHARE` (espera SOLO a la tx del
      // reclamo que ya escribió esta fila, milisegundos; ⛔ nunca al candado consultivo). Lectura sola, cero escrituras,
      // cero red. En este orden: ya tiene guía ⇒ `409 SHIPMENT_ALREADY_LABELED {labelSource}`; reclamo de ESTE envío
      // (doble clic) ⇒ `200 in_progress`; si no ⇒ el `409 purchase_in_flight {otherShipmentId:null}` del candado.
      if (e instanceof BusinessException && (e.details as { reason?: string } | undefined)?.reason === 'purchase_in_flight') {
        const [now] = await this.prisma.$queryRaw<
          { labelProcessingSince: Date | null; labelSource: ShipmentRequest['labelSource']; trackingNumber: string | null }[]
        >`SELECT "labelProcessingSince", "labelSource", "trackingNumber" FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR SHARE`;
        const ls = now ? labelSourceOf(now) : null;
        if (ls !== null) throw BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'Shipment already has a label', { labelSource: ls });
        if (now?.labelProcessingSince) return this.respond(shipmentId, actor, 'in_progress');
      }
      throw e;
    }
    if (claimed.kind === 'in_progress') return this.respond(shipmentId, actor, 'in_progress');
    if (claimed.kind === 'limited') {
      await this.onLimited(actor, shipmentId, claimed.limit, rate.priceCents, claimed.usedCents, claimed.paidLabels);
      throw BusinessException.forbidden('LABEL_PURCHASE_LIMIT', 'Label purchase limit reached', { limit: claimed.limit });
    }
    const claim = claimed.claim;

    // 7b.1 La foto del saldo DESPUÉS del reclamo (§19.27.3): error o insuficiente ⇒ reclamo deshecho, cero compra.
    let balanceBefore: number;
    try {
      balanceBefore = await this.readBalance();
    } catch (e) {
      await this.undo(claim, actor, 'balance', { providerCode: 'balance_unavailable' });
      throw e instanceof ShippingProviderError ? ShippingProviderError.busy('balance').toBusinessException() : e;
    }
    const balanceReadAt = this.clock.now();
    if (balanceBefore < rate.priceCents) {
      await this.undo(claim, actor, 'balance', { providerCode: 'insufficient_balance' });
      await this.alerts.raise(this.prisma, { kind: 'provider_balance_low', severity: 'immediate', dedupKey: `ag7:insufficient:${shipmentId}:${dayMx(balanceReadAt)}`, shipmentRequestId: shipmentId, facts: { requiredCents: rate.priceCents } }, balanceReadAt);
      throw BusinessException.conflict('SHIPPING_INSUFFICIENT_BALANCE', 'Insufficient provider balance', { requiredCents: rate.priceCents });
    }

    // 7b.2 I-SENT (C-16/C-17/C-18): la fila del intento y la bitácora se COMITEAN antes de que salga cualquier intento.
    const sent = await this.markSent(claim, actor, balanceBefore, balanceReadAt);
    if (sent.kind !== 'ok') {
      if (sent.kind === 'exhausted') throw BusinessException.conflict('CONFLICT', 'Too many purchase attempts for this shipment', { reason: 'attempts_exhausted' });
      // §19.31.7 (a): 7b.2 con `count ≠ 1` ⇒ el reclamo se liberó mientras se preparaba; ⛔ cero compra.
      if (sent.kind === 'released') throw BusinessException.conflict('CONFLICT', 'The purchase claim was released meanwhile; nothing was bought', { reason: 'claim_released' });
      throw ShippingProviderError.busy('purchase').toBusinessException();
    }

    // 8. La compra — el ÚNICO llamador de `port.purchase` (PS-117), con plazo (`notAfter`, §19.28.2).
    const input = await this.purchaseInput(claim, sent.providerReference);
    let result: PurchaseResult;
    try {
      result = await this.selection.port.purchase(input);
    } catch (e) {
      return this.onPurchaseError(claim, actor, e);
    }
    // 9. El resultado (§19.26.1 matriz).
    return this.onPurchaseResult(claim, actor, result, sent.providerReference);
  }

  // ---------------------------------------------------------------- pasos 2–5

  private async precheck(
    shipmentId: string,
    body: LabelBody,
    actor: LabelActor,
  ): Promise<
    | { kind: 'in_progress' }
    | { kind: 'requote'; packageCode: string; reason: 'expired' | 'address_changed' }
    | { kind: 'limited'; limit: LabelLimit; priceCents: number; usedCents: number; paidLabels: number }
    | { kind: 'go'; quote: ShipmentQuote; rate: ShipmentRateDTO; recommended: ShipmentRateDTO | null }
  > {
    // ⛔ Los diales se leen ANTES de abrir la tx: una lectura con `this.prisma` dentro de una tx interactiva pide una
    // SEGUNDA conexión del pool, y con N peticiones esperando el candado de la fila el pool se agota (medido: 500 por
    // `Timed out fetching a new connection` con 10 compras simultáneas, PS-73).
    const dials = await this.limitDials();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR UPDATE`;
      const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
      // 2. «Ya tiene guía» primero (PS-73: repetir tras `labeled` ⇒ `409 SHIPMENT_ALREADY_LABELED`, aunque ya esté en `guia`),
      // luego las guardas de §19.6 (las MISMAS funciones), y la compra en curso es `200 in_progress` (doble clic).
      const labelSource0 = labelSourceOf(row);
      if (labelSource0 !== null) throw BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'Shipment already has a label', { labelSource: labelSource0 });
      if (row.status !== 'picking') {
        throw BusinessException.conflict('SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status: row.status });
      }
      if (row.preparedAt === null) throw BusinessException.conflict('SHIPMENT_NOT_PREPARED', 'Shipment is not prepared');
      await this.prep.assertCanAdvance(tx, row.id, 'guia');
      if (row.labelProcessingSince !== null) return { kind: 'in_progress' as const };
      const missing = shipmentAddressMissing(row.addressSnapshot);
      if (missing.length > 0) throw new BusinessException('SHIPMENT_ADDRESS_INCOMPLETE', 422, 'Shipment address is incomplete', { missing });
      const quote = await tx.shipmentQuote.findUnique({ where: { id: body.quoteId } });
      if (!quote || quote.shipmentRequestId !== shipmentId) throw BusinessException.notFound();
      const rates = (Array.isArray(quote.ratesJson) ? quote.ratesJson : []) as unknown as ShipmentRateDTO[];
      const rate = rates.find((r) => r.rateId === body.rateId);
      if (!rate) throw new BusinessException('RATE_NOT_IN_QUOTE', 422, 'Rate is not in this quote');
      // §19.26.3 (a): la misma `rate_id` ya comprada (o en vuelo) por OTRO envío (M-5) ⇒ falla cerrado, cero red.
      const other = await tx.shipmentRequest.findFirst({
        where: { id: { not: shipmentId }, providerRateId: body.rateId, OR: [{ providerShipmentId: { not: null } }, { labelProcessingSince: { not: null } }] },
        select: { id: true },
      });
      if (other) throw BusinessException.conflict('CONFLICT', 'This rate was already purchased for another shipment', { reason: 'rate_already_purchased', otherShipmentId: other.id });
      // §19.29.4: la comprobación PREVIA de los topes (solo lectura), ANTES del re-cotizado y del saldo (criterio 321).
      const actorRow = await tx.user.findUnique({ where: { id: actor.id }, select: OWNER_SELECT });
      const lim = await checkLabelLimits(tx, actorRow ?? { isOwner: false, role: actor.role, email: null, status: 'blocked', deletedAt: null }, actor.id, shipmentId, rate.priceCents, this.clock.now(), dials);
      if (lim.limit) return { kind: 'limited' as const, limit: lim.limit, priceCents: rate.priceCents, usedCents: lim.usedCents, paidLabels: lim.paidLabels };
      // 3. Vigencia (R4) y versión de la dirección (§19.20.1).
      if (quote.addressVersion !== row.addressVersion) return { kind: 'requote' as const, packageCode: quote.packageCode, reason: 'address_changed' as const };
      if (quote.expiresAt.getTime() <= this.clock.now().getTime()) return { kind: 'requote' as const, packageCode: quote.packageCode, reason: 'expired' as const };
      // 4. Las cifras que vio el operador.
      if (rate.priceCents !== body.expectedPriceCents || rate.marginCents !== body.expectedMarginCents) {
        throw BusinessException.conflict('LABEL_PREVIEW_STALE', 'The price changed', { priceCents: rate.priceCents, marginCents: rate.marginCents });
      }
      // 5. Confirmaciones (margen negativo, sucursal); ambas pueden ir juntas.
      const required: string[] = [];
      if (rate.marginCents < 0 && !body.confirmNegativeMargin) required.push('negative_margin');
      if (rate.deliveryKind === 'branch' && !body.confirmBranchDelivery) required.push('branch_delivery');
      if (required.length > 0) {
        throw new BusinessException('LABEL_CONFIRMATION_REQUIRED', 422, 'Confirmation required', {
          required,
          ...(required.includes('negative_margin') ? { marginCents: rate.marginCents } : {}),
        });
      }
      const recommended = quote.recommendedRateId ? (rates.find((r) => r.rateId === quote.recommendedRateId) ?? null) : null;
      return { kind: 'go' as const, quote, rate, recommended };
    }, TX);
  }

  // ---------------------------------------------------------------- paso 7

  private async claim(
    shipmentId: string,
    body: LabelBody,
    actor: LabelActor,
    quote: ShipmentQuote,
    rate: ShipmentRateDTO,
    recommended: ShipmentRateDTO | null,
  ): Promise<
    | { kind: 'claimed'; claim: Claim }
    | { kind: 'in_progress' }
    | { kind: 'limited'; limit: LabelLimit; usedCents: number; paidLabels: number }
  > {
    const since = this.clock.now();
    const dials = await this.limitDials();
    const warnPct = await this.settings.getNumber(SettingKey.SPEND_ALERT_LABEL_CAP_WARN_PCT);
    return this.prisma.$transaction(async (tx) => {
      // §19.28.8 (SDX-D-18): PRIMERA sentencia, ⛔ nunca se espera: otro reclamo está en su tx de milisegundos.
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SKYDROPX_PURCHASE_LOCK_KEY}::bigint) AS ok`;
      if (!ok) {
        throw BusinessException.conflict('CONFLICT', 'Another label purchase is in progress', {
          reason: 'purchase_in_flight',
          otherShipmentId: null,
          otherFolio: null,
          retryAfterSeconds: 1,
        });
      }
      // §19.27.2 + §19.28.8: otra compra SIN id de menos de `T_INFLIGHT_BLOCK` bloquea (hace atribuibles saldo y listado).
      const block = inflightBlockOf(this.cfg);
      const other = await tx.shipmentRequest.findFirst({
        where: { id: { not: shipmentId }, providerShipmentId: null, labelProcessingSince: { gt: new Date(since.getTime() - block) } },
        orderBy: { labelProcessingSince: 'desc' },
        select: { id: true, folio: true, labelProcessingSince: true },
      });
      if (other) {
        const retryAfterSeconds = Math.max(1, Math.ceil((other.labelProcessingSince!.getTime() + block - since.getTime()) / 1000));
        throw BusinessException.conflict('CONFLICT', 'Another label purchase is in progress', {
          reason: 'purchase_in_flight',
          otherShipmentId: other.id,
          otherFolio: other.folio,
          retryAfterSeconds,
        });
      }
      // §19.29.4: los topes que MANDAN, dentro del candado (serializa el paso 7 de toda la cuenta).
      const actorRow = await tx.user.findUnique({ where: { id: actor.id }, select: OWNER_SELECT });
      const exempt = isOwnerAccount(actorRow);
      const lim = await checkLabelLimits(tx, actorRow ?? { isOwner: false, role: actor.role, email: null, status: 'blocked', deletedAt: null }, actor.id, shipmentId, rate.priceCents, since, dials);
      if (lim.limit) return { kind: 'limited' as const, limit: lim.limit, usedCents: lim.usedCents, paidLabels: lim.paidLabels };
      const pkg = await tx.shippingPackage.findUnique({ where: { code: quote.packageCode } });
      if (!pkg || !pkg.active || pkg.providerPackageType.trim() === '') throw ShippingProviderError.notConfigured(['packages']).toBusinessException();
      // EL CAS del reclamo (§19.7 paso 7 + §19.20.1 + §19.23.3): el predicado entero de «sin guía» y la versión que se cotizó.
      const cas = await tx.shipmentRequest.updateMany({
        where: {
          id: shipmentId,
          status: 'picking',
          preparedAt: { not: null },
          labelSource: null,
          trackingNumber: null,
          labelProcessingSince: null,
          addressVersion: quote.addressVersion,
        },
        data: {
          labelProcessingSince: since,
          providerQuotationId: quote.providerQuotationId,
          providerRateId: rate.rateId,
          chosenRateJson: rate as unknown as Prisma.InputJsonValue,
          recommendedRateJson: recommended ? (recommended as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          rateChosenByUserId: actor.id,
          rateChosenAt: since,
          // §19.2: el código de empaque DE SKYDROPX congelado (`providerPackageType`), no el nuestro.
          packageCode: pkg.providerPackageType,
          packageDimsJson: quote.packageDimsJson as Prisma.InputJsonValue,
          declaredValueCents: quote.declaredValueCents,
          insuredValueCents: quote.insuredValueCents,
        },
      });
      if (cas.count !== 1) {
        const now = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
        if (now.labelProcessingSince !== null) return { kind: 'in_progress' as const };
        const ls = labelSourceOf(now);
        if (ls !== null) throw BusinessException.conflict('SHIPMENT_ALREADY_LABELED', 'Shipment already has a label', { labelSource: ls });
        // §19.31.7 (a): el «otro ⇒ 409 CONFLICT» del paso 7 (sin `reason`). La dirección corregida entre el paso 2 y el 7 es
        // la causa esperada (PS-105b/PS-113: el `WHERE` de `addressVersion` es el muro); cualquier otra no debería ocurrir.
        if (now.addressVersion === quote.addressVersion) {
          this.logger.error(`label paso 7: CAS 0 sin rama para ${shipmentId} (status=${now.status}, preparedAt=${now.preparedAt ? 'sí' : 'no'})`);
        }
        throw BusinessException.conflict('CONFLICT', 'The shipment changed; reload it');
      }
      const attempt = await tx.shipmentLabelAttempt.create({
        data: {
          shipmentRequestId: shipmentId,
          since,
          actorUserId: actor.id,
          capExempt: exempt,
          rateId: rate.rateId,
          carrierName: rate.carrierName,
          expectedChargeCents: rate.priceCents,
          recommendedPriceCents: recommended?.priceCents ?? null,
          marginCents: rate.marginCents,
        },
        select: { id: true },
      });
      await this.audit(tx, actor, shipmentId, 'shipment.label_requested', {
        quoteId: quote.id,
        rateId: rate.rateId,
        carrierName: rate.carrierName,
        serviceName: rate.serviceName,
        priceCents: rate.priceCents,
        marginCents: rate.marginCents,
        recommendedRateId: quote.recommendedRateId,
        wasRecommended: rate.rateId === quote.recommendedRateId,
        confirmNegativeMargin: body.confirmNegativeMargin,
        confirmBranchDelivery: body.confirmBranchDelivery,
      });
      // AG-2 (§19.29.6): cruzar `pct·tope` con ESTE intento (una vez por persona y día MX: la llave lo hace).
      if (!exempt) {
        const threshold = (warnPct / 100) * dials.capCents;
        if (lim.usedCents < threshold && lim.usedCents + rate.priceCents >= threshold) {
          await this.alerts.raise(tx, { kind: 'label_cap_warning', severity: 'digest', dedupKey: `ag2:${actor.id}:${dayMx(since)}`, subjectUserId: actor.id, facts: { usedCents: lim.usedCents + rate.priceCents, capCents: dials.capCents, pct: warnPct } }, since);
        }
      }
      const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
      return { kind: 'claimed' as const, claim: { since, attemptId: attempt.id, claimerId: actor.id, rate, recommended, quote, pkg, row, folio: row.folio } };
    }, TX);
  }

  /** Negativa por tope: DESPUÉS del rollback, bitácora (solo súper-admin la ve) y AG-3 / AG-4 (i). Cero red. */
  private async onLimited(actor: LabelActor, shipmentId: string, limit: LabelLimit, priceCents: number, usedCents: number, paidLabels: number): Promise<void> {
    const now = this.clock.now();
    const dials = await this.limitDials();
    await this.audit(this.prisma, actor, shipmentId, 'shipment.label_purchase_limited', {
      limit,
      shipmentId,
      priceCents,
      usedCents,
      ...(limit === 'daily_spend' ? { capCents: dials.capCents } : { reissueMax: dials.reissueMax }),
      paidLabels,
    });
    if (limit === 'daily_spend') {
      await this.alerts.raise(this.prisma, { kind: 'label_cap_blocked', severity: 'immediate', dedupKey: `ag3:${actor.id}:${dayMx(now)}`, subjectUserId: actor.id, shipmentRequestId: shipmentId, amountCents: priceCents, facts: { shipmentId, priceCents, usedCents, capCents: dials.capCents } }, now);
    } else {
      const ref = await this.reissueFacts(shipmentId);
      await this.alerts.raise(this.prisma, { kind: 'label_reissue_loop', severity: 'immediate', dedupKey: `ag4:s:${shipmentId}`, subjectUserId: actor.id, shipmentRequestId: shipmentId, facts: { ...ref, triggers: ['reissue_denied'] } }, now);
    }
  }

  /** AG-4 `facts`: cuántas guías `reissue` canceladas, lo no recuperado conocido y los reembolsos sin cifra, y quién. */
  async reissueFacts(shipmentId: string, db: Tx | PrismaService = this.prisma): Promise<{ cancelledCount: number; unrecoveredCents: number; unknownRefunds: number; actors: string[] }> {
    const cancelled = await db.shipmentPaidLabel.findMany({ where: { shipmentRequestId: shipmentId, cancelKind: 'reissue' }, select: { unrefundedCents: true, cancelledByUserId: true } });
    const ids = [...new Set(cancelled.map((c) => c.cancelledByUserId).filter((x): x is string => !!x))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { name: true } }) : [];
    return {
      cancelledCount: cancelled.length,
      unrecoveredCents: cancelled.reduce((s, c) => s + (c.unrefundedCents ?? 0), 0),
      unknownRefunds: cancelled.filter((c) => c.unrefundedCents === null).length,
      actors: users.map((u) => u.name),
    };
  }

  // ---------------------------------------------------------------- paso 7b.2

  private async markSent(
    claim: Claim,
    actor: LabelActor,
    balanceBeforeCents: number,
    balanceReadAt: Date,
  ): Promise<{ kind: 'ok'; providerReference: string } | { kind: 'released' } | { kind: 'exhausted' } | { kind: 'failed' }> {
    const shipmentId = claim.row.id;
    try {
      const res = await this.prisma.$transaction(async (tx) => {
        // (a) el reclamo sigue siendo ESTE (`since` exacto, sin id): exige count = 1 y toma el candado de la fila.
        const a = await tx.shipmentRequest.updateMany({
          where: { id: shipmentId, labelProcessingSince: claim.since, providerShipmentId: null },
          data: { labelProcessingSince: claim.since },
        });
        if (a.count !== 1) return { kind: 'released' as const };
        // (b) el número de intento sale del libro (C-18), ⛔ no de contar bitácoras.
        const max = await tx.shipmentLabelAttempt.aggregate({ where: { shipmentRequestId: shipmentId }, _max: { attemptNo: true } });
        const attemptNo = (max._max.attemptNo ?? 0) + 1;
        if (attemptNo > FOLIO_ATTEMPT_MAX) return { kind: 'exhausted' as const };
        const providerReference = providerReferenceOf(claim.folio, attemptNo);
        // (c) la fila del intento: `sentAt` es LA prueba de I-SENT (C-16).
        const c = await tx.shipmentLabelAttempt.updateMany({
          where: { shipmentRequestId: shipmentId, since: claim.since, outcome: 'pending', sentAt: null },
          data: { sentAt: this.clock.now(), attemptNo, providerReference },
        });
        if (c.count !== 1) return { kind: 'released' as const };
        // (d) la bitácora con la foto del saldo (dato de súper-admin; ⛔ ningún DTO del operador lleva `balance*`).
        await this.audit(tx, actor, shipmentId, 'shipment.label_purchase_sent', {
          since: claim.since.toISOString(),
          rateId: claim.rate.rateId,
          carrierName: claim.rate.carrierName,
          totalCents: claim.rate.breakdown.totalCents,
          expectedChargeCents: claim.rate.priceCents,
          balanceBeforeCents,
          balanceReadAt: balanceReadAt.toISOString(),
          providerReference,
        });
        return { kind: 'ok' as const, providerReference };
      }, TX);
      if (res.kind === 'exhausted') await this.undo(claim, actor, 'rejected', { providerCode: 'attempts_exhausted' });
      return res;
    } catch (e) {
      // C-16: la escritura del 7b.2 falló ⇒ CERO compra; se deshace el reclamo (si también falla, el job lo libera como `not_sent`).
      this.logger.error(`label 7b.2 falló para ${shipmentId}: ${e instanceof Error ? e.message : String(e)}`);
      await this.undo(claim, actor, 'sent_write_failed', { providerCode: 'sent_write_failed' }).catch(() => undefined);
      return { kind: 'failed' };
    }
  }

  // ---------------------------------------------------------------- paso 8

  private async purchaseInput(claim: Claim, providerReference: string): Promise<PurchaseInput> {
    const snap = obj(claim.row.addressSnapshot);
    const [templateId, origin, note, format, email] = await Promise.all([
      this.settings.get<string>(SettingKey.SKYDROPX_ORIGIN_ADDRESS_TEMPLATE_ID),
      this.settings.get<Record<string, string | null> | null>(SettingKey.SKYDROPX_ORIGIN_SNAPSHOT),
      this.settings.get<string>(SettingKey.SHIPPING_CONSIGNMENT_NOTE),
      this.settings.get<'standard' | 'thermal'>(SettingKey.SHIPPING_LABEL_FORMAT),
      this.shipments.recipientEmailOf(claim.row),
    ]);
    const name = String(snap.recipientName ?? '').trim();
    const line2 = typeof snap.line2 === 'string' && snap.line2.trim() !== '' ? ` ${snap.line2.trim()}` : '';
    const references = typeof snap.references === 'string' && snap.references.trim() !== '' ? snap.references.trim() : undefined;
    // §19.19.8 + T.11 + SEC-SDX-7: SOLO esto; ⛔ el snapshot entero, la libreta o la orden (PS-85, PS-106).
    const to = neutralizeOutboundAddress(
      {
        street1: `${String(snap.line1 ?? '').trim()}${line2}`,
        name,
        company: name,
        phone: String(snap.phone ?? ''),
        email: email ?? '',
        reference: referenceTextOf(providerReference),
        ...(references ? { furtherInformation: references } : {}),
      },
      ['reference'],
    );
    const originSnap: OriginSnapshot | null = origin
      ? {
          street1: origin.street1 ?? '',
          name: origin.name ?? '',
          company: origin.company ?? '',
          phone: origin.phone ?? '',
          email: origin.email ?? '',
          reference: origin.reference ?? '',
        }
      : null;
    return {
      rateId: claim.rate.rateId,
      printingFormat: format === 'thermal' ? 'thermal' : 'standard',
      from: { templateId, snapshot: originSnap },
      to,
      package: { coverageCents: claim.quote.declaredValueCents, consignmentNote: note, packageType: claim.pkg.providerPackageType },
      idempotencyKey: `label:${claim.row.id}:${claim.rate.rateId}`,
      notAfter: claim.since.getTime() + this.cfg.purchaseSendDeadlineMs,
    };
  }

  // ---------------------------------------------------------------- paso 9: errores de la compra

  private async onPurchaseError(claim: Claim, actor: LabelActor, e: unknown): Promise<LabelResponse> {
    const shipmentId = claim.row.id;
    // §19.26.4: el candado de ejecución saltó DESPUÉS del reclamo ⇒ deshacer (por CLASE y ANTES del manejo genérico).
    if (e instanceof SkydropxMutationForbiddenError) {
      await this.undo(claim, actor, 'forbidden', { providerCode: 'mutation_forbidden', reason: e.reason });
      throw ShippingProviderError.notConfigured(['allow_spend']).toBusinessException();
    }
    if (e instanceof PurchaseDeadlineError) {
      await this.undo(claim, actor, 'deadline', { providerCode: 'deadline' });
      throw e.toBusinessException();
    }
    // §19.20.5 / §19.21.4: la petición SALIÓ y no sabemos ⇒ el reclamo se CONSERVA ⇒ `200 in_flight`.
    if (e instanceof ShippingProviderPurchaseInFlightError) {
      this.logger.warn(`label in_flight shipmentId=${shipmentId} since=${claim.since.toISOString()}`);
      return this.respond(shipmentId, actor, 'in_flight');
    }
    if (e instanceof ShippingProviderError) {
      const idFromBody = typeof e.details.providerShipmentId === 'string' ? (e.details.providerShipmentId as string) : null;
      if (e.code === 'SHIPPING_PROVIDER_REJECTED' && idFromBody) {
        // §19.26.1: `422` CON id ⇒ «rechazo con id»: el id se persiste, el reclamo se conserva.
        return this.persistProcessing(
          claim,
          actor,
          rejectedWithIdResult(idFromBody, { code: String(e.details.providerCode ?? 'rejected'), message: String(e.details.providerMessage ?? '') }),
        );
      }
      if (e.code === 'SHIPPING_PROVIDER_REJECTED') {
        return this.rejectWithoutId(claim, actor, String(e.details.providerCode ?? 'rejected'), String(e.details.providerMessage ?? ''));
      }
      // Antes de que salga la compra (borde, 2.º `401`, `429` agotado): no se procesó ⇒ reclamo deshecho.
      await this.undo(claim, actor, 'rejected', { providerCode: String(e.details.reason ?? e.code) });
      throw e.toBusinessException();
    }
    // Un error NUESTRO (no del proveedor): no sabemos si la petición salió ⇒ ⛔ no se deshace (la ventana relee y ve el reclamo).
    this.logger.error(`label purchase error inesperado shipmentId=${shipmentId}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }

  private async rejectWithoutId(claim: Claim, actor: LabelActor, providerCode: string, providerMessage: string): Promise<never> {
    await this.undo(claim, actor, 'rejected', { providerCode, providerMessage });
    let quote: unknown = null;
    try {
      quote = await this.quotes.current(claim.row.id);
    } catch {
      quote = null;
    }
    throw new BusinessException('SHIPPING_PROVIDER_REJECTED', 422, 'The provider rejected the purchase', {
      provider: 'skydropx',
      op: 'purchase',
      providerCode,
      providerMessage,
      quote,
    });
  }

  /** La rama de rechazo: el reclamo se DESHACE (mismo `data`), el intento queda `not_charged`, bitácora `label_failed`. */
  private async undo(claim: Claim, actor: LabelActor, outcomeReason: string, failed: Record<string, unknown>): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.shipmentRequest.updateMany({
        where: { id: claim.row.id, labelProcessingSince: claim.since, providerShipmentId: null },
        // El `data` de la rama de rechazo (§19.7 paso 9; = `CLAIM_UNDO`, escrito en línea para el censo de `status`).
        data: {
          labelProcessingSince: null,
          providerQuotationId: null,
          providerRateId: null,
          chosenRateJson: Prisma.DbNull,
          recommendedRateJson: Prisma.DbNull,
          rateChosenByUserId: null,
          rateChosenAt: null,
          packageCode: null,
          packageDimsJson: Prisma.DbNull,
          declaredValueCents: null,
          insuredValueCents: null,
        },
      });
      await tx.shipmentLabelAttempt.updateMany({
        where: { shipmentRequestId: claim.row.id, since: claim.since, outcome: 'pending' },
        data: { outcome: 'not_charged', outcomeReason, outcomeAt: now },
      });
      if (r.count === 1) await this.audit(tx, actor, claim.row.id, 'shipment.label_failed', { rateId: claim.rate.rateId, ...failed });
    }, TX);
  }

  // ---------------------------------------------------------------- paso 9: la respuesta del proveedor

  private async onPurchaseResult(claim: Claim, actor: LabelActor, result: PurchaseResult, providerReference: string): Promise<LabelResponse> {
    const id = result.providerShipmentId;
    if (!id) {
      // `error` sin id legible ⇒ rechazo (se deshace el reclamo). Un `2xx` sin id y sin error ya es «en vuelo» en el adaptador.
      return this.rejectWithoutId(claim, actor, result.error?.code ?? 'no_id', result.error?.message ?? '');
    }
    if (result.error) return this.persistProcessing(claim, actor, result);
    if (result.trackingNumber) return this.persistLabeled(claim, actor, result, providerReference);
    return this.persistProcessing(claim, actor, result);
  }

  /** §19.19.8 + §19.11: el costo. `total` de la compra manda; si derivó del cotizado, IVA 16/116 (`computed`) y log. */
  private costOf(claim: PersistClaim, result: PurchaseResult): LabelCost {
    const rate = claim.rate;
    const totalCents = result.totalCents ?? rate.breakdown.totalCents;
    const insuranceCostCents = result.insuranceCents ?? rate.breakdown.insuranceCents;
    if (result.insuranceCents !== null && result.insuranceCents !== rate.breakdown.insuranceCents) {
      this.logger.warn(`skydropx insurance_purchase_drift shipmentId=${claim.row.id} quoted=${rate.breakdown.insuranceCents} purchased=${result.insuranceCents}`);
    }
    let iva = rate.breakdown.ivaCents;
    let source: 'provider' | 'computed' = rate.ivaSource;
    if (result.totalCents !== null && result.totalCents !== rate.breakdown.totalCents) {
      this.logger.warn(`skydropx purchase_total_drift shipmentId=${claim.row.id} quoted=${rate.breakdown.totalCents} purchased=${result.totalCents}`);
      iva = skydropxComputedIvaCents(result.totalCents - rate.breakdown.serviceFeeCents);
      source = 'computed';
    }
    return { shippingCostCents: totalCents + insuranceCostCents, shippingCostIvaCents: iva, shippingIvaSource: source, insuranceCostCents, totalCents };
  }

  /** Éxito CON número ⇒ `setTrackingFromProvider`: el mismo hecho que `setTracking` + lo de Skydropx, `since` exacto. */
  async persistLabeled(
    claim: PersistClaim,
    actor: LabelActor | null,
    result: PurchaseResult,
    providerReference: string | null,
    origin: 'response' | 'adopted' = 'response',
    adoption?: AdoptionMark,
  ): Promise<LabelResponse> {
    const id = result.providerShipmentId as string;
    const cost = this.costOf(claim, result);
    const urls = providerUrlsFrom(result, this.selection.urlHosts);
    const now = this.clock.now();
    let wrote: 'ok' | 'cas0' | 'taken' = 'cas0';
    let takenBy: string | null = null;
    try {
      wrote = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${claim.row.id} FOR UPDATE`;
        // Las guardas de §M4-SHIP.6 bajo el candado; si ya no pasan, es la rama `count 0` (§19.28.3 punto 4).
        try {
          await this.prep.assertCanAdvance(tx, claim.row.id, 'guia');
        } catch {
          return 'cas0' as const;
        }
        const r = await tx.shipmentRequest.updateMany({
          where: {
            id: claim.row.id,
            status: 'picking',
            preparedAt: { not: null },
            labelProcessingSince: claim.since,
            providerShipmentId: null,
            replacementCases: { none: { status: 'open' } },
          },
          data: {
            status: 'guia',
            carrier: result.carrierName ?? claim.rate.carrierName,
            trackingNumber: result.trackingNumber,
            trackingNoticeSentAt: null, // §R.4.b: par nuevo ⇒ el aviso de guía se reclama de nuevo
            labelSource: 'skydropx',
            providerShipmentId: id,
            labelUrl: urls.labelUrl,
            trackingUrl: urls.trackingUrl,
            labelPurchasedAt: now,
            labelProcessingSince: null,
            shippingCostCents: cost.shippingCostCents,
            shippingCostIvaCents: cost.shippingCostIvaCents,
            shippingIvaSource: cost.shippingIvaSource,
            insuranceCostCents: cost.insuranceCostCents,
            carrierStatus: 'created',
            carrierStatusAt: now,
          },
        });
        if (r.count !== 1) return 'cas0' as const;
        await this.recordPaidLabel(tx, claim, id, origin, cost.shippingCostCents, now);
        if (adoption) await this.auditAdoption(tx, actor, claim, id, adoption, now);
        await this.audit(tx, actor, claim.row.id, 'shipment.tracking', {
          carrier: result.carrierName ?? claim.rate.carrierName,
          trackingNumber: result.trackingNumber,
          shippingCostCents: cost.shippingCostCents,
          shippingCostIvaCents: cost.shippingCostIvaCents,
          labelSource: 'skydropx',
          providerShipmentId: id,
          priceCents: claim.rate.priceCents,
          ivaCents: cost.shippingCostIvaCents,
          insuranceCents: cost.insuranceCostCents,
        });
        await this.urlRejections(tx, claim.row.id, urls.rejected);
        await this.afterPaidLabelAlerts(tx, claim, cost.shippingCostCents, now);
        return 'ok' as const;
      }, TX);
    } catch (e) {
      takenBy = await this.takenBy(e, id, claim.row.id);
      if (takenBy === null) throw e;
      wrote = 'taken';
    }
    if (wrote === 'taken') return this.providerIdTaken(claim, actor, id, takenBy as string);
    if (wrote === 'cas0') return this.casZero(claim, actor, result, providerReference, origin);
    // Post-commit, best-effort: AV-4 (una vez; T.4.4). ⛔ No puede tumbar la respuesta.
    await this.shipments.notifyLabelCaptured(claim.row.id);
    return this.respond(claim.row.id, actor, 'labeled');
  }

  /** Éxito SIN número (R5) y «rechazo con id» (§19.26.1): el id se persiste, el envío sigue `picking` con el reclamo vivo. */
  async persistProcessing(
    claim: PersistClaim,
    actor: LabelActor | null,
    result: PurchaseResult,
    origin: 'response' | 'adopted' = 'response',
    adoption?: AdoptionMark,
  ): Promise<LabelResponse> {
    const id = result.providerShipmentId as string;
    const cost = this.costOf(claim, result);
    const urls = providerUrlsFrom(result, this.selection.urlHosts);
    const now = this.clock.now();
    let wrote: 'ok' | 'cas0' | 'taken' = 'cas0';
    let takenBy: string | null = null;
    try {
      wrote = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${claim.row.id} FOR UPDATE`;
        const r = await tx.shipmentRequest.updateMany({
          where: { id: claim.row.id, status: 'picking', labelProcessingSince: claim.since, providerShipmentId: null },
          data: {
            providerShipmentId: id,
            labelSource: 'skydropx',
            labelPurchasedAt: now,
            labelUrl: urls.labelUrl,
            trackingUrl: urls.trackingUrl,
            shippingCostCents: cost.shippingCostCents,
            shippingCostIvaCents: cost.shippingCostIvaCents,
            shippingIvaSource: cost.shippingIvaSource,
            insuranceCostCents: cost.insuranceCostCents,
          },
        });
        if (r.count !== 1) return 'cas0' as const;
        await this.recordPaidLabel(tx, claim, id, origin, cost.shippingCostCents, now);
        if (adoption) await this.auditAdoption(tx, actor, claim, id, adoption, now);
        await this.urlRejections(tx, claim.row.id, urls.rejected);
        if (result.error) {
          await this.audit(tx, actor, claim.row.id, 'shipment.label_failed', {
            rateId: claim.rate.rateId,
            providerCode: result.error.code,
            providerMessage: result.error.message,
            providerShipmentId: id,
            kept: true,
          });
        }
        await this.afterPaidLabelAlerts(tx, claim, cost.shippingCostCents, now);
        return 'ok' as const;
      }, TX);
    } catch (e) {
      takenBy = await this.takenBy(e, id, claim.row.id);
      if (takenBy === null) throw e;
      wrote = 'taken';
    }
    if (wrote === 'taken') return this.providerIdTaken(claim, actor, id, takenBy as string);
    if (wrote === 'cas0') return this.casZero(claim, actor, result, null, origin);
    if (result.error) {
      this.logger.error(`skydropx purchase_error_with_id providerShipmentId=${id} providerCode=${result.error.code}`);
      const res = await this.respond(claim.row.id, actor, 'processing');
      return { ...res, providerError: { code: result.error.code, message: result.error.message } };
    }
    return this.respond(claim.row.id, actor, 'processing');
  }

  /** ¿La escritura chocó con el `@unique` del id de otro envío? Devuelve ese envío (o `null` si no es eso). */
  private async takenBy(e: unknown, providerShipmentId: string, selfId: string): Promise<string | null> {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
    const target = JSON.stringify(e.meta?.target ?? '');
    if (!/providerShipmentId/.test(target)) return null;
    const other = await this.prisma.shipmentRequest.findFirst({ where: { providerShipmentId, id: { not: selfId } }, select: { id: true } });
    const paid = other ? null : await this.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId }, select: { shipmentRequestId: true } });
    return other?.id ?? paid?.shipmentRequestId ?? '';
  }

  /** §19.26.3 (b): cero `500`; el reclamo de B se CONSERVA; bitácora `label_conflict`; ⛔ A no se toca. */
  private async providerIdTaken(claim: PersistClaim, actor: LabelActor | null, providerShipmentId: string, otherShipmentId: string): Promise<never> {
    this.logger.error(`skydropx provider_id_taken shipmentId=${claim.row.id} providerShipmentId=${providerShipmentId} other=${otherShipmentId}`);
    await this.audit(this.prisma, actor, claim.row.id, 'shipment.label_conflict', { rateId: claim.rate.rateId, providerShipmentId, otherShipmentId }, this.clock.now());
    throw BusinessException.conflict('CONFLICT', 'The provider returned a shipment that belongs to another order', { reason: 'provider_id_taken', otherShipmentId });
  }

  /**
   * §19.28.3 — `count 0`: tx nueva bajo candado, releer y CLASIFICAR (en este orden): (1) ya está ESE id ⇒ idempotente;
   * (2) otro `since` u otro id ⇒ respuesta VENCIDA: ⛔ cero escrituras en la fila, ⛔ cero `cancel`, `label_orphan`;
   * (3) mismo `since` y `cancelado` ⇒ §19.18.3 punto 2 (persistir con `auto_close` y cancelar); (4) mismo `since` en
   * `picking` por otra causa ⇒ deshacer el reclamo y cancelar la guía (es el MISMO reclamo).
   */
  private async casZero(
    claim: PersistClaim,
    actor: LabelActor | null,
    result: PurchaseResult,
    providerReference: string | null,
    origin: 'response' | 'adopted' = 'response',
  ): Promise<LabelResponse> {
    const id = result.providerShipmentId as string;
    const now = this.clock.now();
    const cost = this.costOf(claim, result);
    const urls = providerUrlsFrom(result, this.selection.urlHosts);
    const verdict = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${claim.row.id} FOR UPDATE`;
      const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: claim.row.id } });
      if (row.providerShipmentId === id) return { kind: 'same' as const, row };
      const sameSince = row.labelProcessingSince !== null && row.labelProcessingSince.getTime() === claim.since.getTime();
      if (!sameSince || row.providerShipmentId !== null) {
        const cause = row.providerShipmentId !== null ? 'adopted_other' : 'stale_response';
        await this.audit(tx, null, claim.row.id, 'shipment.label_orphan', {
          since: claim.since.toISOString(),
          providerShipmentId: id,
          providerReference: providerReference ?? (await this.referenceOf(tx, claim)),
          cause,
          actor: 'system:label-purchase',
        }, now);
        await tx.shipmentPaidLabel.createMany({ data: [{ providerShipmentId: id, shipmentRequestId: claim.row.id, attemptId: claim.attemptId, origin: 'orphan', chargedCents: claim.rate.priceCents }], skipDuplicates: true });
        return { kind: 'stale' as const };
      }
      if (row.status === 'cancelado') {
        // §19.18.3 punto 2: la guía se persiste con sello `auto_close` (⛔ sin par, sin AV-4, sin cambio de estado) y se cancela.
        const w = await tx.shipmentRequest.updateMany({
          where: { id: row.id, status: 'cancelado', labelProcessingSince: claim.since, providerShipmentId: null },
          data: {
            providerShipmentId: id,
            labelSource: 'skydropx',
            labelPurchasedAt: now,
            labelUrl: urls.labelUrl,
            trackingUrl: urls.trackingUrl,
            shippingCostCents: cost.shippingCostCents,
            shippingCostIvaCents: cost.shippingCostIvaCents,
            shippingIvaSource: cost.shippingIvaSource,
            insuranceCostCents: cost.insuranceCostCents,
            providerCanceledAt: now,
            providerCancelReason: 'auto_close',
            labelProcessingSince: null,
          },
        });
        if (w.count !== 1) return { kind: 'stale' as const };
        await this.recordPaidLabel(tx, claim, id, origin, cost.shippingCostCents, now);
        await this.audit(tx, actor, row.id, 'shipment.label_cancelled', { reason: 'auto_close', during: 'purchase' }, now, { providerShipmentId: id, priceCents: claim.rate.priceCents });
        return { kind: 'auto_close' as const };
      }
      // (4) mismo reclamo en `picking` (p. ej. `preparedAt` retirado o un caso abierto): deshacer y cancelar la guía pagada.
      await tx.shipmentRequest.updateMany({
        where: { id: row.id, labelProcessingSince: claim.since, providerShipmentId: null },
        data: {
          labelProcessingSince: null,
          providerQuotationId: null,
          providerRateId: null,
          chosenRateJson: Prisma.DbNull,
          recommendedRateJson: Prisma.DbNull,
          rateChosenByUserId: null,
          rateChosenAt: null,
          packageCode: null,
          packageDimsJson: Prisma.DbNull,
          declaredValueCents: null,
          insuredValueCents: null,
        },
      });
      await tx.shipmentPaidLabel.createMany({ data: [{ providerShipmentId: id, shipmentRequestId: row.id, attemptId: claim.attemptId, origin, chargedCents: cost.shippingCostCents }], skipDuplicates: true });
      await tx.shipmentLabelAttempt.updateMany({ where: { id: claim.attemptId, outcome: 'pending' }, data: { outcome: 'labeled', outcomeAt: now } });
      await this.audit(tx, actor, row.id, 'shipment.label_failed', { rateId: claim.rate.rateId, providerCode: 'LOCAL_CAS', providerShipmentId: id }, now);
      return { kind: 'local_cas' as const };
    }, TX);
    if (verdict.kind === 'same') return this.respond(claim.row.id, actor, verdict.row.trackingNumber ? 'labeled' : 'processing');
    if (verdict.kind === 'stale') {
      this.logger.error(`skydropx label_orphan shipmentId=${claim.row.id} providerShipmentId=${id} since=${claim.since.toISOString()}`);
      throw BusinessException.conflict('CONFLICT', 'The purchase answered for a claim that is no longer current', { reason: 'stale_purchase_response' });
    }
    // Post-commit: `cancel` (best-effort). ⛔ Una guía pagada nunca se olvida.
    await this.autoCancelPaid(claim.row.id, id, 'auto_close');
    if (verdict.kind === 'auto_close') {
      throw BusinessException.conflict('SHIPMENT_NOT_IN_PREPARATION', 'The shipment was cancelled while buying the label; the label was cancelled', {
        status: 'cancelado',
        labelAutoCancelled: true,
      });
    }
    // §19.31.7 (a): mismo reclamo en `picking` por otra causa ⇒ la guía se pidió cancelar (si falla, `label_cancel_failed`).
    throw BusinessException.conflict('CONFLICT', 'The shipment changed while buying the label; the label was cancelled', {
      reason: 'shipment_changed_during_purchase',
      labelAutoCancelled: true,
    });
  }

  /**
   * `port.cancel` post-commit de una guía pagada que no debe vivir (§19.18.3 punto 3): `ok` ⇒ confirmación (CAS), libro con
   * `cancelKind:'auto_close'`, ajuste por lo no devuelto (SEC-SDX-11) y AG-8 (a); fallo ⇒ log `label_cancel_failed` (la alerta
   * la deriva `labelStateOf`: `providerCanceledAt` sin confirmación).
   */
  async autoCancelPaid(shipmentId: string, providerShipmentId: string, reason: 'auto_close'): Promise<void> {
    try {
      const r = await this.selection.port.cancel(providerShipmentId, reason);
      if (!r.ok) {
        this.logger.error(`skydropx label_cancel_failed shipmentId=${shipmentId} providerShipmentId=${providerShipmentId} code=${r.code}`);
        return;
      }
      await this.confirmCancellation(shipmentId, providerShipmentId, r.refundedCents, 'auto_close', null, reason);
    } catch (e) {
      this.logger.error(`skydropx label_cancel_failed shipmentId=${shipmentId} providerShipmentId=${providerShipmentId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** El `ok` de `port.cancel`: confirmación, libro, ajuste (SEC-SDX-11) y AG-8 (a). UN cuerpo (también lo usa `label/cancel`). */
  async confirmCancellation(
    shipmentId: string,
    providerShipmentId: string,
    refundedCents: number | null,
    cancelKind: 'auto_close' | 'reissue',
    cancelledByUserId: string | null,
    note: string,
    db?: Tx,
  ): Promise<void> {
    const now = this.clock.now();
    const run = async (tx: Tx) => {
      await tx.shipmentRequest.updateMany({
        where: { id: shipmentId, providerCanceledAt: { not: null }, providerCancelConfirmedAt: null },
        data: { providerCancelConfirmedAt: now },
      });
      const paid = await tx.shipmentPaidLabel.findUnique({ where: { providerShipmentId } });
      const charged = paid?.chargedCents ?? 0;
      const unrefunded = refundedCents === null ? null : Math.max(0, charged - refundedCents);
      if (paid && paid.cancelledAt === null) {
        await tx.shipmentPaidLabel.update({
          where: { id: paid.id },
          data: { cancelledAt: now, cancelKind, cancelledByUserId, unrefundedCents: unrefunded },
        });
      }
      if (refundedCents !== null && unrefunded !== null && unrefunded > 0) {
        await tx.shipmentCostAdjustment.createMany({
          data: [{
            shipmentRequestId: shipmentId,
            kind: 'other',
            providerChargeId: `cancel:${providerShipmentId}`,
            providerChargeType: 'Cancellation::NotRefunded',
            amountCents: unrefunded,
            ivaCents: skydropxComputedIvaCents(unrefunded),
            ivaSource: 'computed',
            chargedAt: now,
            note,
          }],
          skipDuplicates: true,
        });
        if (paid) {
          await this.alerts.raise(tx, { kind: 'cancel_refund_missing', severity: 'immediate', dedupKey: `ag8:${paid.id}`, shipmentRequestId: shipmentId, amountCents: unrefunded, facts: { chargedCents: charged, refundedCents, unrefundedCents: unrefunded, cancelKind } }, now);
        }
      }
    };
    if (db) await run(db);
    else await this.prisma.$transaction(run, TX);
  }

  // ---------------------------------------------------------------- libros y avisos

  /**
   * I-1 (§19.29.2): EL escritor de `ShipmentPaidLabel` para la guía de un intento (respuesta o adopción), en la MISMA tx que
   * escribe `shippingCostCents`; el intento pasa a `labeled`.
   */
  async recordPaidLabel(tx: Tx, claim: Pick<Claim, 'attemptId'> & { row: { id: string } }, providerShipmentId: string, origin: 'response' | 'adopted', chargedCents: number, now: Date): Promise<void> {
    await tx.shipmentPaidLabel.create({
      data: { providerShipmentId, shipmentRequestId: claim.row.id, attemptId: claim.attemptId, origin, chargedCents },
    });
    await tx.shipmentLabelAttempt.updateMany({ where: { id: claim.attemptId, outcome: 'pending' }, data: { outcome: 'labeled', outcomeAt: now } });
  }

  /** AG-1, AG-5, AG-13 (§19.29.6) cuando un intento obtiene guía (en la tx del hecho). */
  private async afterPaidLabelAlerts(tx: Tx, claim: PersistClaim, chargedCents: number, now: Date): Promise<void> {
    // AG-1: la MISMA persona que RECLAMÓ corrigió la dirección de este envío (⛔ no quien adopta o libera).
    const claimer = claim.claimerId;
    const fixes = await tx.auditLog.findMany({ where: { entityId: claim.row.id, action: 'shipment.address_corrected', actorUserId: claimer }, select: { after: true, createdAt: true } });
    if (fixes.length > 0) {
      const keys = [...new Set(fixes.flatMap((f) => (Array.isArray(obj(f.after).changedKeys) ? (obj(f.after).changedKeys as string[]) : [])))];
      const severe = keys.some((k) => ['recipientName', 'line1', 'postalCode', 'city', 'state', 'country'].includes(k));
      await this.alerts.raise(tx, {
        kind: 'label_after_address_fix',
        severity: severe ? 'immediate' : 'digest',
        dedupKey: `ag1:${claim.row.id}`,
        subjectUserId: claimer,
        shipmentRequestId: claim.row.id,
        amountCents: chargedCents,
        facts: { changedKeys: keys, carrierName: claim.rate.carrierName, chargedCents, correctionAt: fixes[fixes.length - 1].createdAt.toISOString(), revisionCount: fixes.length },
      }, now);
    }
    // AG-5: lo cobrado ≠ lo que vio el operador.
    const diff = chargedCents - claim.rate.priceCents;
    if (diff !== 0) {
      const big = await this.settings.getNumber(SettingKey.SPEND_ALERT_CHARGE_DRIFT_IMMEDIATE_CENTS, tx);
      await this.alerts.raise(tx, {
        kind: 'label_charge_drift',
        severity: Math.abs(diff) > big ? 'immediate' : 'digest',
        dedupKey: `ag5:${claim.attemptId}`,
        shipmentRequestId: claim.row.id,
        amountCents: chargedCents,
        facts: { quotedCents: claim.rate.priceCents, chargedCents, diffCents: diff },
      }, now);
    }
    // AG-13: margen negativo o más cara que la recomendada (🟡, ⛔ nunca correo inmediato).
    const rec = claim.recommended?.priceCents ?? null;
    if (claim.rate.marginCents < 0 || (rec !== null && claim.rate.priceCents > rec)) {
      await this.alerts.raise(tx, {
        kind: 'label_costly_choice',
        severity: 'digest',
        dedupKey: `ag13:${claim.attemptId}`,
        subjectUserId: claimer,
        shipmentRequestId: claim.row.id,
        amountCents: claim.rate.priceCents,
        facts: { marginCents: claim.rate.marginCents, priceCents: claim.rate.priceCents, recommendedPriceCents: rec, overRecommendedCents: rec !== null ? Math.max(0, claim.rate.priceCents - rec) : 0 },
      }, now);
    }
  }

  private async urlRejections(tx: Tx, shipmentId: string, rejected: { field: string; host: string | null }[]): Promise<void> {
    for (const r of rejected) {
      // ⛔ Sin la URL entera (puede llevar firma): solo el campo y el host (§19.18.5).
      await this.audit(tx, null, shipmentId, 'shipment.provider_url_rejected', { field: r.field, host: r.host });
    }
  }

  /** §19.18.4 paso 4 / §19.27.5: la bitácora de la adopción (actor de sistema si no hay persona). */
  private async auditAdoption(tx: Tx, actor: LabelActor | null, claim: PersistClaim, providerShipmentId: string, a: AdoptionMark, now: Date): Promise<void> {
    await this.audit(tx, actor, claim.row.id, 'shipment.label_adopted', {
      providerShipmentId,
      since: claim.since.toISOString(),
      via: a.via,
      ...(a.note ? { note: a.note } : {}),
      ...(actor ? {} : { actor: a.actorTag ?? 'system:label-verify' }),
    }, now);
  }

  private async referenceOf(tx: Tx, claim: PersistClaim): Promise<string | null> {
    const a = await tx.shipmentLabelAttempt.findUnique({ where: { id: claim.attemptId }, select: { providerReference: true } });
    return a?.providerReference ?? null;
  }

  private async readBalance(): Promise<number> {
    const now = this.clock.now();
    let b;
    try {
      b = await this.selection.port.balance();
    } catch (e) {
      throw e instanceof ShippingProviderError ? e.toBusinessException() : e;
    }
    await this.alerts.observeBalance(b.balanceCents, now);
    return b.balanceCents;
  }

  async audit(
    db: Tx | PrismaService,
    actor: LabelActor | null,
    shipmentId: string,
    action: string,
    after: Record<string, unknown>,
    at?: Date,
    before?: Record<string, unknown>,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        actorUserId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action,
        entityType: 'ShipmentRequest',
        entityId: shipmentId,
        ...(before ? { before: before as Prisma.InputJsonValue } : {}),
        after: after as Prisma.InputJsonValue,
        // 🔒 C-17: un reloj — la bitácora de la compra se fecha con el MISMO reloj que `since` (las ventanas la comparan).
        createdAt: at ?? this.clock.now(),
      },
    });
  }

  async respond(shipmentId: string, actor: LabelActor | null, outcome: LabelOutcome): Promise<LabelResponse> {
    const shipment = (actor
      ? await this.shipments.adminGet(shipmentId, actor, this.labelOptionsFor.bind(this))
      : await this.shipments.adminGet(shipmentId)) as { label?: unknown };
    return outcome === 'labeled' ? { outcome, shipment, label: shipment.label ?? null } : { outcome, shipment };
  }
}

/** El `data` de la rama de rechazo (§19.7 paso 9; §19.18.4 paso 5): todo lo que escribió el reclamo vuelve a `NULL`. */
export const CLAIM_UNDO = {
  labelProcessingSince: null,
  providerQuotationId: null,
  providerRateId: null,
  chosenRateJson: Prisma.DbNull,
  recommendedRateJson: Prisma.DbNull,
  rateChosenByUserId: null,
  rateChosenAt: null,
  packageCode: null,
  packageDimsJson: Prisma.DbNull,
  declaredValueCents: null,
  insuredValueCents: null,
} satisfies Prisma.ShipmentRequestUpdateManyMutationInput;

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export type { ShipmentLabelAttempt };
export { asRate };
