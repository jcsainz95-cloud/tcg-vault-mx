/**
 * shipping-quote.service.ts — 💰🔒 §ENV3 (DECISIONES puntos 1–7, 12). El cobro de envío de la compra a domicilio.
 *
 *   cotiza(CP, perfil) → costo de UNA caja → × cajas + MX$20 → redondeo al peso → `quoteId` firmado (30 min)
 *
 * Orden de fuentes: caché (Redis, 6 h) → Skydropx en vivo (timeout duro 6 s, single-flight, disyuntor) → tabla `ShippingZoneRate`.
 * Si el vivo se pasa del plazo, la petición se resuelve con la tabla y la llamada SIGUE en segundo plano hasta llenar la caché
 * (equivale al job `ship-quote-warm` sin cola). Skydropx NUNCA se llama desde las pruebas: el puerto se inyecta.
 *
 * ⛔ Nada de esto lee peso ni costo del cliente. ⛔ Después de pagar nada se recalcula (el pedido guarda `shippingQuoteSnapshot`).
 */
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/business.exception';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingKey } from '../settings/settings.constants';
import { SettingsService } from '../settings/settings.service';
import { InsuranceTier } from '../settings/shipping-dials';
import { insuranceCoverageFor } from '../shipments/insurance';
import { PostalCodeService } from '../shipping-provider/geo/postal-code';
import { SHIPPING_PROVIDER_PORT, ShippingProviderPort } from '../shipping-provider/shipping-provider.port';
import { SHIP_QUOTE_CACHE, ShipQuoteCache } from './ship-quote-cache';
import { SHIP_QUOTE_CONTROL, ShipQuoteControl } from './ship-quote-control';
import {
  PickedRate,
  ZoneRow,
  customerFeeCents,
  guideCostPerBoxCents,
  pickRate,
  pickZoneRow,
} from './ship-quote-math';
import { ShipCartInput, ShipDials, ShipProfile, cacheKeyOf, dimsOf, profileHashOf, shipProfileOf, tableProfileKey } from './ship-profile';
import {
  ShipQuotePayload,
  ShipQuoteSnapshot,
  ShipQuoteVerdict,
  signShipQuote,
  verifyShipQuote,
} from './ship-quote-token';

export interface ShippingQuoteDTO {
  quoteId: string;
  shippingFeeCents: number;
  service: string;
  etaDays: number;
  expiresAt: string;
}

/** Costo de UNA caja, de dónde vino. */
export interface PerBoxCost extends PickedRate {
  source: 'live' | 'table';
}

export const CP_RE = /^\d{5}$/;

/** Resultado de contrastar un `quoteId` con el carrito/CP de la sesión. */
export type ShipQuoteGate = { ok: true; feeCents: number; snapshot: ShipQuoteSnapshot & { quotedAt: string } } | { ok: false };

export interface ShipSettingsView extends ShipDials {
  enabled: boolean;
  marginCents: number;
  ttlS: number;
  timeoutMs: number;
  serviceOrder: readonly string[];
  freeFromCents: number;
  tiers: readonly InsuranceTier[];
  maxPerMin: number;
  cacheTtlS: number;
}

@Injectable()
export class ShippingQuoteService {
  private readonly logger = new Logger(ShippingQuoteService.name);
  private readonly inflight = new Map<string, Promise<PerBoxCost | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pii: PiiCryptoService,
    private readonly postal: PostalCodeService,
    @Inject(SHIPPING_PROVIDER_PORT) private readonly port: ShippingProviderPort,
    @Inject(SHIP_QUOTE_CACHE) private readonly cache: ShipQuoteCache,
    @Inject(SHIP_QUOTE_CONTROL) private readonly gateCtl: ShipQuoteControl,
  ) {}

  async enabled(): Promise<boolean> {
    return (await this.settings.get<string>(SettingKey.SHIP_V3_ENABLED)) === 'on';
  }

  async view(): Promise<ShipSettingsView> {
    const [enabled, marginCents, envelopeMaxCards, ttlS, timeoutMs, serviceOrder, sealedWeightsG, freeFromCents, tiers, maxPerMin, cacheTtlS] = await Promise.all([
      this.enabled(),
      this.settings.getNumber(SettingKey.SHIP_MARGIN_CENTS),
      this.settings.getNumber(SettingKey.SHIP_ENVELOPE_MAX_CARDS),
      this.settings.getNumber(SettingKey.SHIP_QUOTE_TTL_S),
      this.settings.getNumber(SettingKey.SHIP_QUOTE_TIMEOUT_MS),
      this.settings.get<string[]>(SettingKey.SHIP_SERVICE_ORDER),
      this.settings.get<Record<string, number>>(SettingKey.SHIP_SEALED_WEIGHTS_G),
      this.settings.getNumber(SettingKey.DIRECT_SHIP_FREE_FROM_CENTS),
      this.settings.get<InsuranceTier[]>(SettingKey.SHIPPING_INSURANCE_TIERS),
      this.settings.getNumber(SettingKey.SHIP_SKYDROPX_MAX_PER_MIN),
      this.settings.getNumber(SettingKey.SHIP_CACHE_TTL_S),
    ]);
    return {
      enabled,
      marginCents,
      envelopeMaxCards,
      ttlS,
      timeoutMs,
      serviceOrder,
      sealedWeightsG,
      freeFromCents,
      tiers,
      maxPerMin,
      cacheTtlS,
      insuranceCoverages: tiers.map((t) => t.coverageCents),
    };
  }

  async profileOf(cart: ShipCartInput): Promise<ShipProfile> {
    return shipProfileOf(cart, await this.view());
  }

  verifyToken(token: unknown, now: Date = new Date()): ShipQuoteVerdict {
    return verifyShipQuote(this.pii, token, Math.floor(now.getTime() / 1000));
  }

  /**
   * ¿Este `quoteId` rige para ESTE CP y ESTE carrito con ESTE subtotal? PURA salvo por la verificación HMAC.
   *  - firma/vigencia/CP/hash de perfil; ⛔ un token emitido «gratis por umbral» no sirve si el pedido bajó del umbral.
   *  - sobre el umbral (`S ≥ T`) no hace falta cotización: cobro 0.
   */
  gate(args: { token: unknown; cp: string; profile: ShipProfile; subtotalCents: number; freeFromCents: number; hasCode?: boolean; now?: Date }): ShipQuoteGate {
    const now = args.now ?? new Date();
    if (args.subtotalCents >= args.freeFromCents) {
      // 💰 DECISIONES punto 15: el umbral se mide DESPUÉS del descuento. Con código (o con un token presentado) la cotización de referencia
      // (`ref`) debe ir firmada y ser > 0 (§17(2): sin `ref` válido NUNCA hay envío 0 ⇒ stale); sin código ni token ⇒ 0 por umbral.
      const presented = typeof args.token === 'string' && args.token !== '';
      if (args.hasCode || presented) {
        const v = this.verifyToken(args.token, now);
        if (!v.ok || v.payload.cp !== args.cp || v.payload.h !== profileHashOf(args.profile) || !Number.isSafeInteger(v.payload.ref) || (v.payload.ref as number) <= 0) return { ok: false };
        return { ok: true, feeCents: v.payload.ref as number, snapshot: v.payload.snap };
      }
      return {
        ok: true,
        feeCents: 0,
        snapshot: {
          serviceCode: 'free_threshold',
          serviceName: 'FedEx',
          carrier: 'fedex',
          etaDays: 0,
          costQuotedCents: 0,
          extendedAreaCents: 0,
          marginCents: 0,
          source: 'table',
          profile: profileSummary(args.profile),
          free: 'threshold',
          quotedAt: now.toISOString(),
        },
      };
    }
    const v = this.verifyToken(args.token, now);
    if (!v.ok) return { ok: false };
    const p = v.payload;
    if (p.cp !== args.cp || p.h !== profileHashOf(args.profile)) return { ok: false };
    if (p.snap.free === 'threshold') return { ok: false };
    return { ok: true, feeCents: p.fee, snapshot: p.snap };
  }

  /** Emite una cotización nueva (y su `quoteId`). `subtotalCents` = lo pagado por la mercancía, antes de código. */
  async quote(input: { cp: string; cart: ShipCartInput; subtotalCents: number; now?: Date }): Promise<ShippingQuoteDTO> {
    if (!CP_RE.test(input.cp)) throw BusinessException.badRequest('VALIDATION_ERROR', 'cp must be 5 digits', { field: 'cp' });
    const now = input.now ?? new Date();
    const v = await this.view();
    const profile = shipProfileOf(input.cart, v);
    let fee: number;
    let ref: number | undefined;
    let refCost: number | undefined;
    let snap: ShipQuoteSnapshot;
    if (input.subtotalCents >= v.freeFromCents) {
      // Sobre el umbral no se cotiza en vivo (sin esperar 2.5 s): cobro 0; `ref` = respaldo por tabla por si un código baja el subtotal bajo el umbral.
      fee = 0;
      const r = await this.referenceFee(input.cp, profile, v);
      ref = r.fee;
      refCost = r.guide;
      snap = { serviceCode: 'free_threshold', serviceName: 'FedEx', carrier: 'fedex', etaDays: 0, costQuotedCents: refCost ?? 0, extendedAreaCents: 0, marginCents: 0, source: 'table', profile: profileSummary(profile), free: 'threshold' };
    } else {
      const cost = await this.costPerBox(input.cp, profile, v);
      const guide = profile.boxes * guideCostPerBoxCents(cost);
      fee = customerFeeCents(profile.boxes, guideCostPerBoxCents(cost), v.marginCents);
      snap = {
        serviceCode: cost.serviceCode,
        serviceName: cost.serviceName,
        carrier: cost.carrier,
        etaDays: cost.etaDays,
        costQuotedCents: guide,
        extendedAreaCents: profile.boxes * cost.extendedAreaCents,
        marginCents: v.marginCents,
        source: cost.source,
        profile: profileSummary(profile),
      };
    }
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + v.ttlS;
    const payload: Omit<ShipQuotePayload, 'v'> = { cp: input.cp, h: profileHashOf(profile), fee, iat, exp, ...(ref !== undefined ? { ref, refCost } : {}), snap: { ...snap, quotedAt: now.toISOString() } };
    return {
      quoteId: signShipQuote(this.pii, payload),
      shippingFeeCents: fee,
      service: snap.serviceName,
      etaDays: snap.etaDays,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /**
   * Cobro de referencia de un pedido ≥ umbral: respaldo por tabla (sin llamada en vivo). ⛔ NO traga errores (QA-ENV3-REF0): tabla vacía ⇒ 503,
   * fallo de BD ⇒ el error sale; nunca se firma un `ref` inventado ni 0.
   */
  private async referenceFee(cp: string, profile: ShipProfile, v: ShipSettingsView): Promise<{ fee: number; guide: number }> {
    const c = await this.fromTable(cp, profile, v);
    const per = guideCostPerBoxCents(c);
    return { fee: customerFeeCents(profile.boxes, per, v.marginCents), guide: profile.boxes * per };
  }

  // ── costo de UNA caja ────────────────────────────────────────────────────────────────────────────────────────

  async costPerBox(cp: string, profile: ShipProfile, v: ShipSettingsView): Promise<PerBoxCost> {
    const key = cacheKeyOf(cp, profile);
    const hit = await this.cache.get(key);
    if (hit) {
      const parsed = parseCached(hit);
      if (parsed) return { ...parsed, source: 'live' };
    }
    if (!(await this.gateCtl.isOpen())) {
      let flight = this.inflight.get(key);
      if (!flight) {
        flight = this.live(cp, profile, v, key).finally(() => this.inflight.delete(key));
        this.inflight.set(key, flight);
      }
      // Plazo duro: el vivo sigue en segundo plano (llena la caché) y esta petición se resuelve con la tabla.
      const winner = await raceTimeout(flight.catch(() => null), v.timeoutMs);
      if (winner !== 'timeout' && winner !== null) return winner;
      if (winner === 'timeout') {
        // ENV3-3: un plazo vencido cuenta como fallo del proveedor (antes no contaba y 30 CPs distintos ⇒ 30 llamadas colgadas).
        await this.gateCtl.recordFailure();
        this.logger.warn(`ship_quote live_timeout prefix=${cp.slice(0, 2)} profile=${tableProfileKey(profile)}`);
      }
    }
    return this.fromTable(cp, profile, v);
  }

  /** La llamada a Skydropx. Devuelve `null` si no hay servicio FedEx del orden (⇒ respaldo). Nunca lanza. */
  private async live(cp: string, profile: ShipProfile, v: ShipSettingsView, key: string, lowPriority = false): Promise<PerBoxCost | null> {
    // Tope global (llamadas/min y en vuelo): excedido ⇒ `null` ⇒ respaldo por tabla, sin tocar Skydropx.
    if (!(await this.gateCtl.acquire(v.maxPerMin, { lowPriority }))) return null;
    try {
      const template = await this.settings.get<string | null>(SettingKey.SKYDROPX_ORIGIN_ADDRESS_TEMPLATE_ID);
      const rec = await this.postal.resolvePostalCode(cp);
      if (!template || !rec) return null; // sin origen configurado o CP fuera del catálogo ⇒ tabla (no cuenta como fallo del proveedor)
      const first = rec.entries[0];
      const dims = dimsOf(profile);
      const res = await this.port.quote({
        from: { templateId: template },
        // Solo geografía pública (CP/estado/municipio/colonia del catálogo): ⛔ nada de la dirección del cliente.
        to: { countryCode: 'MX', postalCode: cp, state: first.state, city: first.municipality, neighborhood: first.neighborhood },
        parcel: { ...dims, coverageCents: profile.perBoxCoverageCents },
      });
      const tierCost = insuranceCoverageFor(profile.perBoxCoverageCents, v.tiers)?.costCents ?? 0;
      const picked = res.completed ? pickRate(res.rates, v.serviceOrder, tierCost) : null;
      await this.gateCtl.recordSuccess();
      if (!picked) return null;
      const out: PerBoxCost = { ...picked, source: 'live' };
      await this.cache.set(key, JSON.stringify(picked), v.cacheTtlS);
      void this.logObserved(cp, profile, res.rates.filter((r) => r.carrierName === 'fedex' && r.deliveryKind === 'home' && r.serviceCode !== null && v.serviceOrder.includes(r.serviceCode)), 'live');
      return out;
    } catch (e) {
      // Cuentan los fallos del proveedor (red/timeout/5xx); un 4xx es nuestro (petición mal formada) y NO abre el disyuntor.
      const st = (e as { httpStatus?: number }).httpStatus;
      if (st === undefined || st >= 500) await this.gateCtl.recordFailure();
      this.logger.warn(`ship_quote live_failed prefix=${cp.slice(0, 2)} ${e instanceof Error ? e.name : 'error'}`);
      return null;
    } finally {
      await this.gateCtl.release();
    }
  }

  private async logObserved(cp: string, profile: ShipProfile, rates: ReadonlyArray<{ serviceCode: string | null; totalCents: number }>, source: 'live' | 'label'): Promise<void> {
    try {
      const rows = rates.map((r) => ({ prefix2: cp.slice(0, 2), profileKey: tableProfileKey(profile), serviceCode: r.serviceCode as string, costCents: r.totalCents, source }));
      if (rows.length > 0) await this.prisma.shippingQuoteLog.createMany({ data: rows });
    } catch (e) {
      this.logger.warn(`ship_quote log_failed ${e instanceof Error ? e.name : 'error'}`);
    }
  }

  /** Respaldo: p75 de la tabla + seguro del escalón. Sin ninguna fila ⇒ 503 (⛔ nunca se inventa un precio). */
  private async fromTable(cp: string, profile: ShipProfile, v: ShipSettingsView): Promise<PerBoxCost> {
    const rows = (await this.prisma.shippingZoneRate.findMany({ where: { profileKey: tableProfileKey(profile) } })) as ZoneRow[];
    const picked = pickZoneRow(rows, cp.slice(0, 2), tableProfileKey(profile), v.serviceOrder);
    if (!picked) {
      throw new BusinessException('SHIPPING_QUOTE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE, 'Shipping cannot be quoted right now', {});
    }
    const insurance = insuranceCoverageFor(profile.perBoxCoverageCents, v.tiers)?.costCents ?? 0;
    return {
      serviceCode: picked.row.serviceCode,
      serviceName: serviceNameOf(picked.row.serviceCode),
      carrier: 'fedex',
      etaDays: picked.row.serviceCode === 'standard_overnight' ? 2 : 4,
      transportCents: picked.row.costCents,
      insuranceCents: insurance,
      extendedAreaCents: 0,
      source: 'table',
    };
  }

  /**
   * Sondeo de calibración (job diario): UNA cotización viva por perfil (sobre y caja) para `cp`. Solo cotiza (⛔ cero guías); respeta el
   * disyuntor. Devuelve cuántas llamadas hizo (0 con el disyuntor abierto).
   */
  async probe(cp: string, coverageCents: number): Promise<number> {
    if (!CP_RE.test(cp) || (await this.gateCtl.isOpen())) return 0;
    const v = await this.view();
    let calls = 0;
    for (const pkg of ['envelope', 'box'] as const) {
      const profile: ShipProfile = { package: pkg, boxes: 1, perBoxKg: dimsOf({ package: pkg }).weightKg, weightG: 0, perBoxCoverageCents: coverageCents };
      await this.live(cp, profile, v, cacheKeyOf(cp, profile), true);
      calls += 1;
    }
    return calls;
  }

  /** AG-26 / calibración: una guía comprada alimenta la tabla (DECISIONES punto 8). Nunca lanza. */
  async recordPurchasedLabel(args: { postalCode: string; profileKey: string; serviceCode: string; transportCents: number }): Promise<void> {
    if (!CP_RE.test(args.postalCode)) return;
    try {
      await this.prisma.shippingQuoteLog.create({
        data: { prefix2: args.postalCode.slice(0, 2), profileKey: args.profileKey, serviceCode: args.serviceCode, costCents: args.transportCents, source: 'label' },
      });
    } catch (e) {
      this.logger.warn(`ship_quote label_log_failed ${e instanceof Error ? e.name : 'error'}`);
    }
  }
}

function profileSummary(p: ShipProfile): ShipQuoteSnapshot['profile'] {
  return { package: p.package, boxes: p.boxes, perBoxKg: p.perBoxKg, perBoxCoverageCents: p.perBoxCoverageCents };
}

function serviceNameOf(code: string): string {
  return code === 'standard_overnight' ? 'FedEx Standard Overnight' : code === 'fedex_express_saver' ? 'FedEx Express Saver' : `FedEx ${code}`;
}

/** ENV3-4: entero en [0, max] (una caché corrupta o manipulada con negativos o enormes se ignora). */
function inRange(n: unknown, max: number): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
}

function parseCached(s: string): PickedRate | null {
  try {
    const o = JSON.parse(s) as Partial<PickedRate>;
    if (
      typeof o.serviceCode === 'string' &&
      typeof o.serviceName === 'string' &&
      typeof o.carrier === 'string' &&
      inRange(o.etaDays, 365) &&
      inRange(o.transportCents, 100_000_000) &&
      inRange(o.insuranceCents, 100_000_000) &&
      inRange(o.extendedAreaCents, 100_000_000) &&
      (o.transportCents as number) > 0
    ) {
      return o as PickedRate;
    }
  } catch {
    /* caché corrupta ⇒ se ignora */
  }
  return null;
}

/** `p` o `'timeout'` si pasan `ms`; el temporizador se cancela siempre (ningún handle abierto). */
async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
