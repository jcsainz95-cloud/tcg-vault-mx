import { Injectable } from '@nestjs/common';
import {
  BuylistRuleMode,
  Card,
  Finish,
  MovementReason,
  Prisma,
  ProductType,
  RawCondition,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { UsersService, isValidClabe } from '../users/users.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe } from '../../common/crypto/pii-mask';
import { BuylistRule, quoteAcquisitionForFinish } from '../../common/money';

interface QuoteItemInput {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  // v1.6-finish: acabado del item (default normal), validado contra card.availableFinishes.
  finish?: Finish;
  // v1.3.1: el cliente ya NO envía `category`. La regla se deriva server-side de Card.rarity.
}

@Injectable()
export class BuylistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly pii: PiiCryptoService,
  ) {}

  /**
   * v1.6-finish: valida que el `finish` pedido esté entre los acabados disponibles de la carta
   * (SEC-A1). Fuera de la lista → 422 FINISH_NOT_AVAILABLE. Default `normal` si se omite.
   */
  private assertFinishAvailable(card: Card, finish?: Finish): Finish {
    const f = finish ?? 'normal';
    const available = (card.availableFinishes ?? ['normal']) as Finish[];
    if (!available.includes(f)) {
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        `Finish '${f}' is not available for this card`,
        { finish: f, availableFinishes: available },
      );
    }
    return f;
  }

  /** Cotizador público (stateless). API_CONTRACT §6 (v1.6-finish: por RAREZA + ACABADO). */
  async publicQuote(
    cardId: string,
    productType: ProductType,
    rawCondition?: RawCondition,
    finish?: Finish,
  ) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
    // SEC-A1: el acabado se valida contra los acabados REALES de la carta antes de cotizar.
    const f = this.assertFinishAvailable(card, finish);
    const { rules, fallbackPct } = await this.buylistRules();
    const gradeKey = this.pricing.gradeKeyFor({ productType, rawCondition });
    // v1.6-finish: la referencia del `pct` es la del ACABADO cotizado.
    const ref = await this.pricing.getReference(cardId, productType, gradeKey, f);
    const referenceMxnCents =
      ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
    // SEC-A1: rareza + acabado derivados server-side (Card.rarity, finish validado), no del cliente.
    const quote = quoteAcquisitionForFinish(card.rarity, f, referenceMxnCents, rules, fallbackPct);
    return {
      rarity: card.rarity ?? null,
      finish: f,
      appliedRule: {
        mode: quote.appliedRule.mode,
        value: quote.appliedRule.value,
        source: quote.ruleSource,
      },
      quote: {
        status: quote.status,
        quotedPriceCents: quote.quotedPriceCents,
        currency: 'MXN' as const,
      },
      referencePrice:
        referenceMxnCents != null
          ? { status: 'priced' as const, priceMxnCents: referenceMxnCents }
          : { status: 'pending' as const },
      paymentNotice: 'PAY_AFTER_RECEIPT' as const,
    };
  }

  /**
   * Lee la tabla de precio de buylist por rareza (dial M2) + el fallback %.
   * BUYLIST_PRICE_RULES = `{ [rarity]: { mode, value } }`; BUYLIST_PRICE_FALLBACK_PCT = número.
   * v1.3.1 reemplaza el antiguo `rarity_map` (deprecado, ya no se lee en la ruta de cotización).
   */
  async buylistRules(): Promise<{ rules: Record<string, BuylistRule>; fallbackPct: number }> {
    const raw = (await this.settings.getRaw(SettingKey.BUYLIST_PRICE_RULES)) as
      | Record<string, BuylistRule>
      | null;
    const fallbackPct = await this.settings.getNumber(SettingKey.BUYLIST_PRICE_FALLBACK_PCT);
    return { rules: raw ?? {}, fallbackPct };
  }

  /**
   * Crea la solicitud de venta. Valida topes (solicitud/mes), INE sobre tope y
   * CLABE a nombre propio. API_CONTRACT §6, PROJECT criterio 14.
   */
  async createRequest(
    userId: string,
    items: QuoteItemInput[],
    clabe: string,
    ineUploadKeys?: { front: string; back: string },
  ) {
    if (!isValidClabe(clabe)) {
      throw BusinessException.validation('CLABE_INVALID', 'CLABE must be 18 digits');
    }
    // La CLABE debe estar a nombre del propio usuario: se valida contra la KYC declarada.
    // SEC/PII: el match se hace por BLIND INDEX (HMAC), SIN descifrar la CLABE almacenada.
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId } });
    const incomingHmac = this.pii.clabeBlindIndex(clabe);
    if (kyc?.clabeHmac && !this.pii.blindIndexEquals(kyc.clabeHmac, incomingHmac)) {
      throw BusinessException.validation(
        'CLABE_NOT_OWN_NAME',
        'CLABE must match the one on file (own name)',
      );
    }

    // Cotiza cada item. SEC-A1: la regla (que determina el monto a pagar) NO se toma del DTO
    // del cliente; se DERIVA server-side de la RAREZA REAL de la carta (Card.rarity) vía la
    // tabla BUYLIST_PRICE_RULES (dial M2). Así un DTO malicioso no puede inflar `quotedTotalCents`.
    // Se snapshotea la regla aplicada (rarity/ruleMode/ruleValue/ruleSource) para auditoría.
    const { rules, fallbackPct } = await this.buylistRules();
    const itemsData: {
      cardId: string;
      productType: ProductType;
      rawCondition?: RawCondition;
      finish: Finish;
      rarity: string | null;
      ruleMode: BuylistRuleMode;
      ruleValue: number;
      ruleSource: string;
      quotedPriceCents: number | null;
      itemStatus: 'cotizada' | 'precio_pendiente';
    }[] = [];
    let quotedTotalCents = 0;
    for (const it of items) {
      const card = await this.prisma.card.findUnique({ where: { id: it.cardId } });
      if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
      // SEC-A1: valida el acabado contra los acabados REALES de la carta (422 si no).
      const f = this.assertFinishAvailable(card, it.finish);
      const gradeKey = this.pricing.gradeKeyFor({ productType: it.productType, rawCondition: it.rawCondition });
      // v1.6-finish: referencia del ACABADO cotizado.
      const ref = await this.pricing.getReference(it.cardId, it.productType, gradeKey, f);
      const referenceMxnCents =
        ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
      const q = quoteAcquisitionForFinish(card.rarity, f, referenceMxnCents, rules, fallbackPct);
      if (q.status === 'precio_pendiente') {
        await this.pricing.escalatePending(it.cardId, it.productType, gradeKey, 'buylist');
      }
      quotedTotalCents += q.quotedPriceCents ?? 0;
      itemsData.push({
        cardId: it.cardId,
        productType: it.productType,
        rawCondition: it.rawCondition,
        finish: f,
        rarity: card.rarity ?? null,
        ruleMode: q.appliedRule.mode,
        ruleValue: q.appliedRule.value,
        ruleSource: q.ruleSource,
        quotedPriceCents: q.quotedPriceCents,
        itemStatus: q.status,
      });
    }

    // Topes.
    const capPerRequest =
      kyc?.capPerRequestCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS));
    const capPerMonth =
      kyc?.capPerMonthCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_MONTH_CENTS));
    const ineThreshold = await this.settings.getNumber(SettingKey.INE_THRESHOLD_CENTS);

    // El tope por-solicitud no depende de concurrencia (es sobre el total de ESTA
    // solicitud), se valida fuera de la transacción.
    if (quotedTotalCents > capPerRequest) {
      throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-request cap exceeded', {
        scope: 'per_request',
        capCents: capPerRequest,
        wouldBeCents: quotedTotalCents,
      });
    }

    // INE sobre el tope configurado.
    const ineProvided = Boolean(
      (ineUploadKeys?.front && ineUploadKeys?.back) || (kyc?.ineFrontKey && kyc?.ineBackKey),
    );
    const ineRequired = quotedTotalCents >= ineThreshold;
    if (ineRequired && !ineProvided) {
      throw BusinessException.validation('INE_REQUIRED', 'INE required above threshold', {
        thresholdCents: ineThreshold,
      });
    }

    // Persiste CLABE/INE en KYC declarada. CLABE cifrada en reposo + blind index.
    const clabeEnc = this.pii.encrypt(clabe);
    await this.prisma.kycProfile.upsert({
      where: { userId },
      create: {
        userId,
        clabeEnc,
        clabeHmac: incomingHmac,
        ineFrontKey: ineUploadKeys?.front,
        ineBackKey: ineUploadKeys?.back,
        kycStatus: 'pending',
      },
      update: {
        clabeEnc,
        clabeHmac: incomingHmac,
        ...(ineUploadKeys?.front ? { ineFrontKey: ineUploadKeys.front } : {}),
        ...(ineUploadKeys?.back ? { ineBackKey: ineUploadKeys.back } : {}),
      },
    });

    // SEC-A2: el tope MENSUAL sufre TOCTOU si se lee `monthUsed` y luego se crea sin
    // atomicidad (N solicitudes concurrentes leen el mismo acumulado y todas pasan).
    // Se lee el acumulado y se crea la solicitud DENTRO de una transacción SERIALIZABLE:
    // dos solicitudes concurrentes cerca del tope entran en conflicto de serialización y
    // solo una prospera, cerrando el bypass del límite AML/mensual.
    const request = await this.prisma.$transaction(
      async (tx) => {
        const monthUsed = await this.monthUsedCentsTx(tx, userId);
        if (monthUsed + quotedTotalCents > capPerMonth) {
          throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-month cap exceeded', {
            scope: 'per_month',
            capCents: capPerMonth,
            wouldBeCents: monthUsed + quotedTotalCents,
          });
        }
        return tx.sellRequest.create({
          data: {
            userId,
            status: 'cotizada',
            quotedTotalCents,
            clabeSnapshotEnc: clabeEnc,
            ineRequired,
            ineProvided,
            items: { create: itemsData },
          },
          include: { items: { include: { card: true } } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      sellRequestId: request.id,
      status: request.status,
      quotedTotalCents,
      ineRequired,
      items: request.items.map((i) => this.itemDTO(i)),
    };
  }

  /**
   * SEC-A2: acumulado del mes en curso leído sobre el cliente transaccional (`tx`), para
   * que el chequeo del tope mensual y la creación de la solicitud sean atómicos bajo
   * aislamiento serializable. Misma regla que `UsersService.monthUsedCents`.
   */
  private async monthUsedCentsTx(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const agg = await tx.sellRequest.aggregate({
      where: {
        userId,
        createdAt: { gte: start },
        status: { notIn: ['rechazada', 'abandonada'] },
      },
      _sum: { quotedTotalCents: true },
    });
    return agg._sum.quotedTotalCents ?? 0;
  }

  private itemDTO(i: {
    id: string;
    card: { id: string; name: string; number: string } | null;
    cardId: string;
    productType: ProductType;
    rawCondition: RawCondition | null;
    finish?: Finish | null;
    rarity?: string | null;
    ruleMode?: BuylistRuleMode | null;
    ruleValue?: number | null;
    ruleSource?: string | null;
    quotedPriceCents: number | null;
    approvedPriceCents: number | null;
    itemStatus: string;
    inventoryItemId: string | null;
  }) {
    // v1.3.1: `category` reemplazado por `rarity` + `appliedRule` (SellItemDTO). API_CONTRACT §11.
    return {
      id: i.id,
      cardId: i.cardId,
      card: i.card,
      productType: i.productType,
      rawCondition: i.rawCondition ?? undefined,
      // v1.6-finish: acabado snapshoteado en la cotización/solicitud.
      finish: i.finish ?? 'normal',
      rarity: i.rarity ?? undefined,
      appliedRule:
        i.ruleMode != null && i.ruleValue != null
          ? { mode: i.ruleMode, value: i.ruleValue, source: (i.ruleSource ?? 'rule') as 'rule' | 'fallback' }
          : undefined,
      quotedPriceCents: i.quotedPriceCents ?? undefined,
      approvedPriceCents: i.approvedPriceCents ?? undefined,
      itemStatus: i.itemStatus,
      inventoryItemId: i.inventoryItemId ?? undefined,
    };
  }

  async listMine(userId: string) {
    // QA-BUG: sin `include` las filas Prisma crudas no traían `items`/`card` y el
    // frontend (BuylistView) crasheaba al iterar `r.items`. Se devuelve el shape
    // `SellRequestDTO` del contrato (sellRequestId + items[] con card), coherente con
    // el que ya emite `createRequest`.
    const rows = await this.prisma.sellRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { card: true } } },
    });
    const data = rows.map((r) => ({
      sellRequestId: r.id,
      status: r.status,
      quotedTotalCents: r.quotedTotalCents,
      ineRequired: r.ineRequired,
      createdAt: r.createdAt,
      items: r.items.map((i) => this.itemDTO(i)),
    }));
    return { data };
  }

  async getMine(userId: string, id: string) {
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: { items: { include: { card: true } } },
    });
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    return req;
  }

  /** Responde a un ajuste del admin (accept/decline). API_CONTRACT §6. */
  async respond(userId: string, id: string, decision: 'accept' | 'decline') {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    if (decision === 'decline') {
      return this.prisma.sellRequest.update({ where: { id }, data: { status: 'rechazada' } });
    }
    // accept: mueve items 'ajustada' a 'aprobada' y limpia el plazo de 7d.
    await this.prisma.sellRequestItem.updateMany({
      where: { sellRequestId: id, itemStatus: 'ajustada' },
      data: { itemStatus: 'aprobada' },
    });
    return this.prisma.sellRequest.update({
      where: { id },
      data: { adjustmentSentAt: null, status: 'aprobada', approvedAt: new Date() },
    });
  }

  // ---------------- Admin M5 ----------------

  async adminList(
    status: string | undefined,
    page: number,
    pageSize: number,
    userId?: string,
  ) {
    const where: Prisma.SellRequestWhereInput = {};
    if (status) where.status = status as never;
    // v1.7-admin-users: filtro opcional por SellRequest.userId (simetría con /admin/orders).
    if (userId) where.userId = userId;
    // QA-BUG: `include: { items: true }` no traía `card`, y M5View crasheaba al leer
    // `it.card.name`. AdminBuylistDTO.items exige `card: CardDTO`; se incluye y mapea.
    const [rows, total] = await Promise.all([
      this.prisma.sellRequest.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: { include: { card: true } } },
      }),
      this.prisma.sellRequest.count({ where }),
    ]);
    const data = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      status: r.status,
      quotedTotalCents: r.quotedTotalCents,
      approvedTotalCents: r.approvedTotalCents ?? undefined,
      createdAt: r.createdAt,
      items: r.items.map((i) => this.itemDTO(i)),
    }));
    return { data, page, pageSize, total };
  }

  async adminGet(id: string) {
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: { items: { include: { card: true } } },
    });
    if (!req) throw BusinessException.notFound();
    // La CLABE cifrada NUNCA se expone en la vista de detalle; solo por el reveal dedicado.
    const { clabeSnapshotEnc: _enc, ...safe } = req;
    return { ...safe, clabeMasked: maskClabe(this.pii.decryptOptional(_enc)) };
  }

  /**
   * Reveal on-demand de la CLABE COMPLETA (18 dígitos) para ejecutar el pago SPEI.
   * Marcado @MoneyOut (solo super_admin) y AUDITADO en el controller. Descifra el
   * snapshot cifrado de la solicitud (o, en su defecto, la CLABE de KYC). No enmascara:
   * es el único punto del sistema que devuelve la CLABE en claro, para copiarla a la banca.
   */
  async revealClabe(id: string): Promise<{ sellRequestId: string; clabe: string }> {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req) throw BusinessException.notFound();
    let clabe = this.pii.decryptOptional(req.clabeSnapshotEnc);
    if (!clabe) {
      const kyc = await this.prisma.kycProfile.findUnique({ where: { userId: req.userId } });
      clabe = this.pii.decryptOptional(kyc?.clabeEnc);
    }
    if (!clabe) {
      throw BusinessException.notFound('NOT_FOUND', 'No CLABE on file for this request');
    }
    return { sellRequestId: id, clabe };
  }

  async receive(id: string) {
    await this.adminGet(id);
    await this.prisma.sellRequestItem.updateMany({
      where: { sellRequestId: id, itemStatus: { in: ['cotizada', 'precio_pendiente'] } },
      data: { itemStatus: 'recibida' },
    });
    return this.prisma.sellRequest.update({
      where: { id },
      data: { status: 'recibida', receivedAt: new Date() },
    });
  }

  async verify(id: string) {
    await this.adminGet(id);
    await this.prisma.sellRequestItem.updateMany({
      where: { sellRequestId: id, itemStatus: 'recibida' },
      data: { itemStatus: 'verificacion' },
    });
    return this.prisma.sellRequest.update({
      where: { id },
      data: { status: 'verificacion', verifiedAt: new Date() },
    });
  }

  /** Cherry-pick: decisión carta por carta. API_CONTRACT §M5. */
  async itemDecision(
    itemId: string,
    decision: 'approve' | 'adjust' | 'reject',
    approvedPriceCents?: number,
  ) {
    const item = await this.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
    if (!item) throw BusinessException.notFound();
    let itemStatus: 'aprobada' | 'ajustada' | 'rechazada';
    const data: Prisma.SellRequestItemUpdateInput = {};
    if (decision === 'approve') {
      itemStatus = 'aprobada';
      data.approvedPriceCents = approvedPriceCents ?? item.quotedPriceCents ?? 0;
    } else if (decision === 'adjust') {
      itemStatus = 'ajustada';
      data.approvedPriceCents = approvedPriceCents ?? 0;
      // Dispara el plazo de 7 días en la solicitud.
      await this.prisma.sellRequest.update({
        where: { id: item.sellRequestId },
        data: { adjustmentSentAt: new Date() },
      });
    } else {
      itemStatus = 'rechazada';
    }
    data.itemStatus = itemStatus;
    return this.prisma.sellRequestItem.update({ where: { id: itemId }, data });
  }

  /** Conversión a inventario en un clic. API_CONTRACT §M5. */
  async convertToInventory(itemId: string, actorUserId: string) {
    const item = await this.prisma.sellRequestItem.findUnique({
      where: { id: itemId },
      include: { card: true },
    });
    if (!item) throw BusinessException.notFound();
    // Guardia rápida (pre-check): si ya está convertido, es idempotente. Se evalúa ANTES
    // que la guardia de aprobación para que un item ya convertido (itemStatus=
    // 'convertida_inventario') no dispare 422 en reintentos.
    if (item.inventoryItemId) {
      return { inventoryItemId: item.inventoryItemId, alreadyConverted: true };
    }
    // GUARDIA DE APROBACIÓN (PROJECT §H, criterios 3d/16): SOLO una carta cuyo resultado
    // de verificación fue `aprobada` puede convertirse en InventoryItem vendible. Una carta
    // `rechazada` (resultado de verificación NO-NM) NUNCA debe volverse vendible; tampoco
    // una `cotizada`/`recibida`/`verificacion`/`ajustada` (aún sin decisión de aprobación).
    if (item.itemStatus !== 'aprobada') {
      throw BusinessException.validation(
        'ITEM_NOT_APPROVED',
        'Only an approved sell item can be converted to sellable inventory',
        { itemStatus: item.itemStatus },
      );
    }
    // SEC-A3: el pre-check por sí solo sufre TOCTOU (dos llamadas concurrentes ven
    // `inventoryItemId=null`). La guardia real es el índice único en
    // `InventoryItem.sourceSellRequestItemId`: la creación concurrente colisiona (P2002)
    // y se resuelve como "ya convertido", garantizando UN solo InventoryItem.
    try {
      const folio = await this.prisma.nextFolio();
      const created = await this.prisma.$transaction(async (tx) => {
        const inv = await tx.inventoryItem.create({
          data: {
            folio,
            cardId: item.cardId,
            productType: item.productType,
            rawCondition: item.rawCondition,
            // v1.6-finish: el acabado snapshoteado se PROPAGA a la copia física (ARCHITECTURE §3.7).
            finish: item.finish,
            ownerType: 'platform',
            status: 'in_stock',
            acquisitionType: 'buylist',
            acquisitionCostCents: item.approvedPriceCents ?? item.quotedPriceCents ?? 0,
            sourceSellRequestItemId: item.id,
          },
        });
        await tx.inventoryMovement.create({
          data: {
            itemId: inv.id,
            toStatus: 'in_stock',
            reason: MovementReason.buylist_convert,
            actorUserId,
            note: `from sellRequestItem ${item.id}`,
          },
        });
        await tx.sellRequestItem.update({
          where: { id: itemId },
          data: { itemStatus: 'convertida_inventario', inventoryItemId: inv.id },
        });
        return inv;
      });
      return { inventoryItemId: created.id, folio: created.folio };
    } catch (e) {
      // Violación de unicidad → otra conversión ganó la carrera: ya convertido.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.inventoryItem.findFirst({
          where: { sourceSellRequestItemId: itemId },
          select: { id: true },
        });
        return { inventoryItemId: existing?.id, alreadyConverted: true };
      }
      throw e;
    }
  }

  /**
   * Pago SPEI manual (super_admin, money-out). Precondición: aprobada + verificada.
   * API_CONTRACT §M5, PROJECT criterio 26.
   */
  async paySpei(id: string, speiReference: string, paidBy: string) {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req) throw BusinessException.notFound();
    // SEC-M5: idempotencia — si ya está pagada, no se hace un segundo asiento; se
    // devuelve el estado existente (dos POST /pay-spei concurrentes o reintentos).
    if (req.status === 'pagada') {
      return req;
    }
    if (!['aprobada', 'verificacion'].includes(req.status) || !req.verifiedAt) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Payment allowed only after receipt/verification and approval',
      );
    }
    // SEC-M5: transición atómica con guardia de estado (patrón count===1). El
    // `updateMany` solo prospera si la solicitud sigue en un estado pagable; dos
    // llamadas concurrentes → solo una hace la transición a `pagada`.
    const res = await this.prisma.sellRequest.updateMany({
      where: { id, status: { in: ['aprobada', 'verificacion'] }, verifiedAt: { not: null } },
      data: { status: 'pagada', speiReference, paidBy, paidAt: new Date() },
    });
    if (res.count !== 1) {
      const current = await this.prisma.sellRequest.findUnique({ where: { id } });
      if (current?.status === 'pagada') return current;
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Payment allowed only after receipt/verification and approval',
      );
    }
    return this.prisma.sellRequest.findUnique({ where: { id } });
  }
}
