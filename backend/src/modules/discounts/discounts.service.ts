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
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import type { DiscountNotApplicableReason } from './discount-pricing';

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
   * Un intento FALLIDO (solo `invalid`: un `not_applicable` es de un código real y no castiga, §DSC.6). Por clave, bajo
   * el candado de su fila: ventana vencida ⇒ empieza otra; `failures ≥ max` ⇒ `blockedUntil = now + block`.
   * Fuera de la `tx` del checkout a propósito: el `422` de la sesión no escribe nada, pero el intento sí cuenta.
   */
  async recordFailure(keys: string[], now = new Date()): Promise<void> {
    const max = await this.settings.getNumber(SettingKey.DISCOUNT_CODE_MAX_FAILURES);
    const windowMs = (await this.settings.getNumber(SettingKey.DISCOUNT_CODE_FAILURE_WINDOW_MIN)) * 60_000;
    const blockMs = (await this.settings.getNumber(SettingKey.DISCOUNT_CODE_BLOCK_MIN)) * 60_000;
    for (const key of keys) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "DiscountCodeThrottle" ("key", "failures", "windowStartedAt", "updatedAt")
          VALUES (${key}, 0, ${now}, ${now}) ON CONFLICT ("key") DO NOTHING`;
        await tx.$queryRaw`SELECT "key" FROM "DiscountCodeThrottle" WHERE "key" = ${key} FOR UPDATE`;
        const row = await tx.discountCodeThrottle.findUniqueOrThrow({ where: { key } });
        const fresh = row.failures === 0 || row.windowStartedAt.getTime() + windowMs <= now.getTime();
        const failures = fresh ? 1 : row.failures + 1;
        await tx.discountCodeThrottle.update({
          where: { key },
          data: {
            failures,
            windowStartedAt: fresh ? now : row.windowStartedAt,
            ...(failures >= max ? { blockedUntil: new Date(now.getTime() + blockMs) } : {}),
          },
        });
      });
    }
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

  /** El texto del código con el que se apartó el uso de una orden (`null` sin código). Decide REUSO vs SUSTITUCIÓN. */
  async codeOfOrder(db: Db, orderId: string): Promise<string | null> {
    const r = await db.discountRedemption.findUnique({ where: { orderId }, select: { code: { select: { code: true } } } });
    return r?.code.code ?? null;
  }

  /** El bloque `discount` (forma `applied`) de una orden ya creada: lo congelado en sus columnas, ⛔ sin recalcular. */
  async appliedOfOrder(
    db: Db,
    order: { id: string; subtotalCents: number; discountCents: number; shippingWaivedCents: number },
  ): Promise<DiscountQuoteDTO | null> {
    const r = await db.discountRedemption.findUnique({ where: { orderId: order.id }, select: { code: { select: { code: true, kind: true } } } });
    if (!r) return null;
    return {
      outcome: 'applied',
      code: r.code.code,
      kind: r.code.kind,
      merchandiseBeforeDiscountCents: order.subtotalCents + order.discountCents,
      discountCents: order.discountCents,
      shippingWaivedCents: order.shippingWaivedCents,
    };
  }

  /**
   * §DSC.6 «Dónde se ve el pedido» (914) — `discount: { code, kind, discountCents, shippingWaivedCents }` de una orden, solo si
   * tiene `DiscountRedemption` (`null` si no: el campo se OMITE, I-1).
   */
  async orderDiscountOf(
    db: Db,
    order: { id: string; discountCents: number; shippingWaivedCents: number },
  ): Promise<{ code: string; kind: DiscountKind; discountCents: number; shippingWaivedCents: number } | null> {
    const r = await db.discountRedemption.findUnique({ where: { orderId: order.id }, select: { code: { select: { code: true, kind: true } } } });
    return r ? { code: r.code.code, kind: r.code.kind, discountCents: order.discountCents, shippingWaivedCents: order.shippingWaivedCents } : null;
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
