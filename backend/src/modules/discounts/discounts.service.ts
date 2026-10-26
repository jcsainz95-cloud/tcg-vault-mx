/**
 * discounts.service.ts — 💰 CÓDIGOS DE DESCUENTO del lado del cliente (API_CONTRACT §DSC.5, §DSC.6, §DSC.8).
 *
 * Qué decide aquí y qué no:
 *  - Validez del código (los SEIS casos genéricos de §0: no existe, archivado, pausado, fuera de vigencia, agotado,
 *    agotado para este cliente) y el candado de la fila (`FOR UPDATE`) que hace que el último uso no se reparta dos
 *    veces (I-6). El camino inválido hace las MISMAS consultas que el válido (busca por texto y cuenta usos aunque el
 *    código no exista).
 *  - El límite de intentos fallidos (`DiscountCodeThrottle`, diales `discount_code_*`): claves `ip:`/`email:` con HMAC,
 *    `user:` con el id. ⛔ Ni IP ni correo en claro.
 *  - Apartar el uso (`DiscountRedemption`) y sellar `firstReservedAt`.
 *  ⛔ La aritmética del dinero NO vive aquí: `common/money.ts` (`discountOf`, `allocateDiscount`) y
 *    `discount-pricing.ts` (orden del cálculo con los desgloses de siempre).
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DiscountCode, DiscountKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import type { DiscountTerms } from '../../common/money';
import { orderDiscountOf } from './redemption';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import type { AppliedPrice, DiscountNotApplicableReason, NotApplicable } from './discount-pricing';

type Db = Prisma.TransactionClient | PrismaService;

/** Un uuid que ninguna fila tiene: el camino inválido cuenta usos igual que el válido (mismas consultas). */
const NIL_CODE_ID = '00000000-0000-0000-0000-000000000000';
/** Texto máximo aceptado en el request (§DSC.6: string ≤ 40). La forma canónica (`^[A-Z0-9-]{4,20}$`) la pone el CHECK. */
export const DISCOUNT_CODE_INPUT_MAX = 40;

/** Quién compra, para el límite por cliente (§DSC.5): `customerUserId = yo ∨ customerEmail = correo normalizado`. */
export interface DiscountCustomer {
  userId?: string | null;
  email?: string | null;
}

/** Las identidades del límite de intentos (§DSC.6): IP siempre; cuenta y correo si los hay. */
export interface ThrottleIdentity {
  ip?: string | null;
  userId?: string | null;
  email?: string | null;
}

export type DiscountQuoteDTO =
  | {
      outcome: 'applied';
      code: string;
      kind: DiscountKind;
      merchandiseBeforeDiscountCents: number;
      discountCents: number;
      shippingWaivedCents: number;
    }
  | { outcome: 'invalid' }
  | { outcome: 'not_applicable'; code: string; reason: DiscountNotApplicableReason; details: Record<string, number | string[]> }
  | { outcome: 'rate_limited'; retryAfterSeconds: number };

/** `trim` + mayúsculas; vacío (o no-string) ⇒ como ausente (§DSC.6). */
export function normalizeDiscountCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  return t.length === 0 ? null : t;
}

export function termsOf(row: Pick<DiscountCode, 'kind' | 'percentPct' | 'amountCents' | 'maxDiscountCents' | 'minSubtotalCents' | 'productScopes' | 'destinations'>): DiscountTerms {
  return {
    kind: row.kind,
    percentPct: row.percentPct,
    amountCents: row.amountCents,
    maxDiscountCents: row.maxDiscountCents,
    minSubtotalCents: row.minSubtotalCents,
    productScopes: row.productScopes ?? [],
    destinations: row.destinations ?? [],
  };
}

/** Lo que `applyInTx` devuelve: el cálculo del llamador, el DTO `applied` y el verbo que aparta (o consume) el uso. */
export interface AppliedInTx<P extends AppliedPrice> {
  priced: P;
  discount: DiscountQuoteDTO & { outcome: 'applied' };
  reserve: (subject: { orderId: string } | { shipmentRequestId: string }, status?: 'reserved' | 'consumed') => Promise<void>;
}

/** El bloque `discount` forma `applied` (quotes, sesiones y retiro): el código, su tipo y los tres importes del cálculo. */
export function appliedDiscountOf(row: Pick<DiscountCode, 'code' | 'kind'>, priced: AppliedPrice): DiscountQuoteDTO & { outcome: 'applied' } {
  return {
    outcome: 'applied',
    code: row.code,
    kind: row.kind,
    merchandiseBeforeDiscountCents: priced.merchandiseBeforeDiscountCents,
    discountCents: priced.discountCents,
    shippingWaivedCents: priced.shippingWaivedCents,
  };
}

/** El GENÉRICO (§0, criterio 907): mismo estado, mismo cuerpo, sin `details`, en los seis casos. */
export function discountInvalidError(): BusinessException {
  return BusinessException.validation('DISCOUNT_CODE_INVALID', 'The discount code is not valid.');
}

export function discountNotApplicableError(reason: DiscountNotApplicableReason, details: Record<string, unknown>): BusinessException {
  return BusinessException.validation('DISCOUNT_CODE_NOT_APPLICABLE', 'The discount code does not apply.', { reason, ...details });
}

export function discountRateLimitedError(retryAfterSeconds: number): BusinessException {
  return new BusinessException('DISCOUNT_CODE_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'Too many invalid discount codes.', {
    retryAfterSeconds,
  });
}

/** El `Retry-After` de un `429 DISCOUNT_CODE_RATE_LIMITED` (lo pone el controlador antes de relanzar). */
export function retryAfterOf(e: unknown): number | null {
  if (e instanceof BusinessException && e.code === 'DISCOUNT_CODE_RATE_LIMITED') {
    const s = Number(e.details?.retryAfterSeconds);
    return Number.isFinite(s) && s > 0 ? s : 1;
  }
  return null;
}

@Injectable()
export class DiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pii: PiiCryptoService,
  ) {}

  // ================================================================ límite de intentos (§DSC.6)

  throttleKeys(id: ThrottleIdentity): string[] {
    const keys: string[] = [];
    keys.push(`ip:${this.pii.domainHmac('dsc-throttle:ip:', id.ip ?? 'unknown')}`);
    if (id.userId) keys.push(`user:${id.userId}`);
    if (id.email) keys.push(`email:${this.pii.domainHmac('dsc-throttle:email:', id.email.trim().toLowerCase())}`);
    return keys;
  }

  /** Segundos de bloqueo que quedan (el mayor de las claves), o `null` si ninguna está bloqueada. */
  async retryAfterSeconds(keys: string[], now = new Date()): Promise<number | null> {
    const rows = await this.prisma.discountCodeThrottle.findMany({ where: { key: { in: keys }, blockedUntil: { gt: now } } });
    if (rows.length === 0) return null;
    const until = Math.max(...rows.map((r) => (r.blockedUntil as Date).getTime()));
    return Math.max(1, Math.ceil((until - now.getTime()) / 1000));
  }

  /** `429` si alguna clave está bloqueada (sesión y retiro); el quote lo traduce a `rate_limited`. */
  async assertNotBlocked(keys: string[], now = new Date()): Promise<void> {
    const s = await this.retryAfterSeconds(keys, now);
    if (s !== null) throw discountRateLimitedError(s);
  }

  /**
   * Un intento FALLIDO (§DSC.6 v1.110.3, `HECHOS.md` 2026-10-26 «…un código vigente que no aplica cuenta como intento»). Por
   * clave, bajo el candado de su fila: ventana vencida ⇒ empieza otra (y se vacía `countedCodeHashes`); `failures ≥ max` ⇒
   * `blockedUntil = now + block`.
   *  - `invalid` (sin `notApplicableCode`): suma 1 siempre.
   *  - `not_applicable` (con `notApplicableCode`): suma 1 **una vez por código y ventana** — el HMAC del código entra a
   *    `countedCodeHashes`; si ya estaba, no suma (re-cotizar el mismo código al llenar el carrito no bloquea).
   * Fuera de la `tx` del checkout a propósito: el `422` de la sesión no escribe nada, pero el intento sí cuenta.
   */
  async recordFailure(keys: string[], now = new Date(), notApplicableCode?: string): Promise<void> {
    const max = await this.settings.getNumber(SettingKey.DISCOUNT_CODE_MAX_FAILURES);
    const windowMs = (await this.settings.getNumber(SettingKey.DISCOUNT_CODE_FAILURE_WINDOW_MIN)) * 60_000;
    const blockMs = (await this.settings.getNumber(SettingKey.DISCOUNT_CODE_BLOCK_MIN)) * 60_000;
    // ⛔ El texto del código no se guarda en claro (como IP y correo): HMAC de dominio propio.
    const codeHash = notApplicableCode !== undefined ? this.pii.domainHmac('dsc-throttle:code:', notApplicableCode) : null;
    for (const key of keys) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "DiscountCodeThrottle" ("key", "failures", "windowStartedAt", "updatedAt")
          VALUES (${key}, 0, ${now}, ${now}) ON CONFLICT ("key") DO NOTHING`;
        await tx.$queryRaw`SELECT "key" FROM "DiscountCodeThrottle" WHERE "key" = ${key} FOR UPDATE`;
        const row = await tx.discountCodeThrottle.findUniqueOrThrow({ where: { key } });
        const fresh = row.failures === 0 || row.windowStartedAt.getTime() + windowMs <= now.getTime();
        const counted = fresh ? [] : row.countedCodeHashes;
        if (codeHash !== null && counted.includes(codeHash)) return; // ese `not_applicable` ya contó en esta ventana
        const failures = fresh ? 1 : row.failures + 1;
        await tx.discountCodeThrottle.update({
          where: { key },
          data: {
            failures,
            windowStartedAt: fresh ? now : row.windowStartedAt,
            countedCodeHashes: codeHash !== null ? [...counted, codeHash] : counted,
            ...(failures >= max ? { blockedUntil: new Date(now.getTime() + blockMs) } : {}),
          },
        });
      });
    }
  }

  // ================================================================ las dos entradas del checkout (quote y sesión)

  /**
   * La puerta de una sesión o un retiro CON código: las claves del límite y `429` si alguna está bloqueada (durante el bloqueo
   * TODO código —válido incluido— da `429`, antes de tocar nada). Devuelve las claves para `countingAttempts`.
   */
  async openAttempt(identity: ThrottleIdentity, now = new Date()): Promise<string[]> {
    const keys = this.throttleKeys(identity);
    await this.assertNotBlocked(keys, now);
    return keys;
  }

  /**
   * Corre la `tx` de la sesión o del retiro y, si sale con el genérico o con `not_applicable`, anota el intento (§DSC.6: los
   * dos cuentan; el perdedor de la carrera del último uso sale con el genérico y también cuenta). Se anota FUERA de la `tx`
   * deshecha. Sin código ⇒ `run` tal cual.
   */
  async countingAttempts<T>(code: string | null, keys: readonly string[], run: () => Promise<T>): Promise<T> {
    if (code === null) return run();
    return run().catch(async (e: unknown) => {
      if (e instanceof BusinessException && e.code === 'DISCOUNT_CODE_INVALID') await this.recordFailure([...keys]);
      if (e instanceof BusinessException && e.code === 'DISCOUNT_CODE_NOT_APPLICABLE') await this.recordFailure([...keys], new Date(), code);
      throw e;
    });
  }

  /**
   * ENTRADA 1 — el bloque `discount` de un QUOTE (siempre `200`, ⛔ no aparta nada): bloqueo ⇒ `rate_limited`; genérico ⇒
   * `invalid` (+1 intento); el cálculo de precio lo pone el llamador (`price`, con los términos del código) ⇒ `not_applicable`
   * (+1 intento, una vez por código y ventana) o `applied`. `customer` vacío ⇒ el por-cliente no se evalúa (lo decide la sesión).
   * Devuelve el DTO y, si aplica, el cálculo completo del llamador (desglose, rebajas por unidad…).
   */
  async quoteOutcome<P extends AppliedPrice>(q: {
    code: string;
    throttle: ThrottleIdentity;
    customer: DiscountCustomer;
    excludeOrderIds?: readonly string[];
    price: (terms: DiscountTerms) => P | NotApplicable | Promise<P | NotApplicable>;
    now?: Date;
  }): Promise<{ discount: DiscountQuoteDTO; applied: P | null }> {
    const now = q.now ?? new Date();
    const keys = this.throttleKeys(q.throttle);
    const blocked = await this.retryAfterSeconds(keys, now);
    if (blocked !== null) return { discount: { outcome: 'rate_limited', retryAfterSeconds: blocked }, applied: null };
    const ev = await this.evaluate(this.prisma, q.code, q.customer, now, { lock: false, excludeOrderIds: q.excludeOrderIds ?? [] });
    if (!ev.ok) {
      await this.recordFailure(keys, now);
      return { discount: { outcome: 'invalid' }, applied: null };
    }
    const priced = await q.price(termsOf(ev.row));
    if (priced.outcome === 'not_applicable') {
      await this.recordFailure(keys, now, ev.row.code);
      return { discount: { outcome: 'not_applicable', code: ev.row.code, reason: priced.reason, details: priced.details }, applied: null };
    }
    return { discount: appliedDiscountOf(ev.row, priced), applied: priced };
  }

  /**
   * ENTRADA 2 — aplicar en la `tx` de la sesión o del retiro (§DSC.5 «Apartar»), DESPUÉS de la puerta del cliente y de
   * sustituir: candado de la fila (`FOR UPDATE`, I-6), validez con el `now` de la `tx`, cálculo del llamador. Genérico ⇒
   * `422 DISCOUNT_CODE_INVALID`; no aplica ⇒ `422 DISCOUNT_CODE_NOT_APPLICABLE` — los dos deshacen la `tx` (ni orden, ni uso,
   * ni PI). Devuelve el cálculo, el DTO y `reserve` (aparta o consume el uso una vez creada la orden o el retiro).
   */
  async applyInTx<P extends AppliedPrice>(
    tx: Prisma.TransactionClient,
    a: { code: string; customer: DiscountCustomer; now: Date; price: (terms: DiscountTerms) => P | NotApplicable },
  ): Promise<AppliedInTx<P>> {
    const ev = await this.evaluate(tx, a.code, a.customer, a.now, { lock: true });
    if (!ev.ok) throw discountInvalidError();
    const priced = a.price(termsOf(ev.row));
    if (priced.outcome === 'not_applicable') throw discountNotApplicableError(priced.reason, priced.details);
    const row = ev.row;
    return {
      priced,
      discount: appliedDiscountOf(row, priced),
      reserve: (subject, status = 'reserved') => this.reserve(tx, row, subject, a.customer, a.now, status),
    };
  }

  // ================================================================ validez (§DSC.5, §0)

  /**
   * ¿Vale este código para este cliente AHORA? `lock` ⇒ `SELECT … FOR UPDATE` de la fila (dentro de la `tx` de la sesión
   * o del retiro: el conteo y la reserva ocurren bajo el candado, I-6). `excludeOrderIds`: usos de órdenes propias que la
   * sesión va a sustituir (solo el quote los necesita; en la sesión la sustitución ya los liberó).
   * Un `reserved` cuenta aunque su reserva de cartas haya vencido (cuenta conservadora, §DSC.5).
   */
  async evaluate(
    db: Db,
    code: string,
    customer: DiscountCustomer,
    now: Date,
    opts: { lock: boolean; excludeOrderIds?: readonly string[] } = { lock: false },
  ): Promise<{ ok: true; row: DiscountCode } | { ok: false }> {
    if (opts.lock) await db.$queryRaw`SELECT "id" FROM "DiscountCode" WHERE "code" = ${code} FOR UPDATE`;
    const row = await db.discountCode.findUnique({ where: { code } });
    const codeId = row?.id ?? NIL_CODE_ID;
    const exclude: Prisma.DiscountRedemptionWhereInput[] =
      opts.excludeOrderIds && opts.excludeOrderIds.length > 0
        ? [{ OR: [{ orderId: null }, { orderId: { notIn: [...opts.excludeOrderIds] } }] }]
        : [];
    const live: Prisma.DiscountRedemptionWhereInput = { codeId, status: { in: ['reserved', 'consumed'] } };
    const total = await db.discountRedemption.count({ where: { AND: [live, ...exclude] } });
    const who: Prisma.DiscountRedemptionWhereInput[] = [];
    if (customer.userId) who.push({ customerUserId: customer.userId });
    if (customer.email) who.push({ customerEmail: customer.email });
    const mine = who.length > 0 ? await db.discountRedemption.count({ where: { AND: [live, { OR: who }, ...exclude] } }) : 0;
    const valid =
      row !== null &&
      row.archivedAt === null &&
      row.status === 'active' &&
      row.startsAt.getTime() <= now.getTime() &&
      (row.endsAt === null || now.getTime() < row.endsAt.getTime()) &&
      (row.maxTotalUses === null || total < row.maxTotalUses) &&
      (row.maxUsesPerCustomer === null || mine < row.maxUsesPerCustomer);
    return valid ? { ok: true, row: row as DiscountCode } : { ok: false };
  }

  /**
   * Aparta (o consume, en el retiro gratis de §DSC.8) el uso y sella `firstReservedAt`. Bajo el candado de `evaluate`.
   * ⛔ Un uso por pedido o retiro (I-5): `orderId`/`shipmentRequestId` únicos.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    row: DiscountCode,
    subject: { orderId: string } | { shipmentRequestId: string },
    customer: DiscountCustomer,
    now: Date,
    status: 'reserved' | 'consumed' = 'reserved',
  ): Promise<void> {
    await tx.discountRedemption.create({
      data: {
        codeId: row.id,
        ...subject,
        status,
        ...(status === 'consumed' ? { consumedAt: now } : {}),
        customerUserId: customer.userId ?? null,
        customerEmail: customer.email ?? null,
        createdAt: now,
      },
    });
    if (row.firstReservedAt === null) {
      await tx.discountCode.updateMany({ where: { id: row.id, firstReservedAt: null }, data: { firstReservedAt: now } });
    }
  }

  /** El bloque `discount` (forma `applied`) de una orden ya creada (reuso de la sesión, congelado del quote): sus columnas. */
  async appliedOfOrder(
    db: Db,
    order: { id: string; subtotalCents: number; discountCents: number; shippingWaivedCents: number },
  ): Promise<(DiscountQuoteDTO & { outcome: 'applied' }) | null> {
    const d = await orderDiscountOf(db, order);
    return d ? { outcome: 'applied', ...d } : null;
  }

  // ================================================================ alta interna (pruebas)

  /**
   * Alta INTERNA de un código (las pruebas de integración siembran con ella). La superficie HTTP del dueño, con su
   * validación y su bitácora, es `AdminDiscountsService.create` (§DSC.7). Normaliza el texto; el resto lo exigen los CHECK.
   */
  async createCode(input: {
    code: string;
    kind: DiscountKind;
    percentPct?: number | null;
    amountCents?: number | null;
    maxDiscountCents?: number | null;
    minSubtotalCents?: number | null;
    productScopes?: Prisma.DiscountCodeCreateInput['productScopes'];
    destinations?: Prisma.DiscountCodeCreateInput['destinations'];
    startsAt?: Date;
    endsAt?: Date | null;
    maxTotalUses?: number | null;
    maxUsesPerCustomer?: number | null;
    status?: 'active' | 'paused';
    createdByUserId: string;
  }): Promise<DiscountCode> {
    const code = normalizeDiscountCode(input.code);
    if (!code) throw BusinessException.validation('VALIDATION_ERROR', 'code is required');
    // PROJECTION-EXEMPT: alta INTERNA sin superficie HTTP (pruebas); ningún cliente recibe esta fila.
    return this.prisma.discountCode.create({
      data: {
        code,
        kind: input.kind,
        percentPct: input.percentPct ?? null,
        amountCents: input.amountCents ?? null,
        maxDiscountCents: input.maxDiscountCents ?? null,
        minSubtotalCents: input.minSubtotalCents ?? null,
        productScopes: input.productScopes ?? [],
        destinations: input.destinations ?? [],
        startsAt: input.startsAt ?? new Date(),
        endsAt: input.endsAt ?? null,
        maxTotalUses: input.maxTotalUses ?? null,
        maxUsesPerCustomer: input.maxUsesPerCustomer === undefined ? 1 : input.maxUsesPerCustomer,
        status: input.status ?? 'active',
        createdByUserId: input.createdByUserId,
      },
    });
  }
}
