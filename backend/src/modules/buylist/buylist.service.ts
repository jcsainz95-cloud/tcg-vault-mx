import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  BuylistRuleMode,
  Card,
  Finish,
  MovementReason,
  Prisma,
  ProductType,
  RawCondition,
  SellItemStatus,
  SellRequestStatus,
  VariantPriceOverride,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { toCardDTO } from '../catalog/catalog.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { UsersService, isValidClabe } from '../users/users.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe } from '../../common/crypto/pii-mask';
import { AcquisitionRuleSource, BuylistRule, quoteAcquisitionForFinish } from '../../common/money';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { sellItemRejectedTemplate } from './buylist-mail.templates';
import { rejectDeadlines, SELL_REQUEST_TERMINAL_STATES } from './buylist-reject.constants';

interface QuoteItemInput {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  // v1.6-finish: acabado del item (default normal), validado contra card.availableFinishes.
  finish?: Finish;
  // v1.3.1: el cliente ya NO envía `category`. La regla se deriva server-side de Card.rarity.
}

/**
 * Payload de una cotización por-carta = shape de la respuesta de `POST /buylist/quote`
 * (BuylistQuotePayload del contrato §DTOs base). Lo reusan el quote por-carta y el batch.
 */
export interface BuylistQuotePayload {
  rarity: string | null;
  finish: Finish;
  // v1.28 (P-18/P-22, §6): `source` gana "bounty" | "override" (ADITIVO; el front DEBE tolerarlos)
  // cuando el control por variante (M-30) pisó la regla. Aplica a quote, quote/batch y al snapshot
  // `ruleSource` de createRequest (habilita el conteo de bounty al pagar, fase P-22).
  appliedRule: { mode: BuylistRuleMode; value: number; source: AcquisitionRuleSource };
  quote: { status: 'cotizada' | 'precio_pendiente'; quotedPriceCents: number | null; currency: 'MXN' };
  referencePrice: { status: 'priced'; priceMxnCents: number } | { status: 'pending' };
  paymentNotice: 'PAY_AFTER_RECEIPT';
}

/**
 * v1.15 (§4.16b) — resultado por-ítem del batch quote (BuylistBatchQuoteResultDTO). Una carta
 * inválida NO tumba el lote: `ok:false` acarrea su propio error; el HTTP global es 200. `index` =
 * posición 0-based en `items[]` (llave de correlación robusta ante cardId+finish repetidos).
 */
export type BuylistBatchQuoteResult =
  | ({ index: number; cardId: string; ok: true } & BuylistQuotePayload)
  | {
      index: number;
      cardId: string;
      ok: false;
      error: { code: 'NOT_FOUND' | 'FINISH_NOT_AVAILABLE'; message: string };
    };

@Injectable()
export class BuylistService {
  private readonly logger = new Logger(BuylistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly pii: PiiCryptoService,
    // v1.18-buylist-rejects (§4.18c): puerto global MAIL_PORT para el correo de rechazo. El módulo
    // `mail` (otro stream) NO se toca: solo se inyecta su token @Global. @Optional para que los
    // tests unitarios legacy que construyen el servicio a mano no truenen; el envío es best-effort
    // (sin puerto ⇒ se loggea y sigue, misma semántica que un fallo de envío).
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
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

  /**
   * v1.28 (P-18/P-22, §4.26b) — clave del control por variante (M-30) de un ítem de cotización.
   * MISMA derivación que la referencia (`gradeKeyFor` + finish default `normal`): paridad exacta
   * con la clave única de la tabla. Se usa para leer los overrides EN LOTE (una query por request,
   * patrón `getReferencesBatch` — sin N+1).
   */
  private overrideKeyOf(it: QuoteItemInput): {
    cardId: string;
    productType: ProductType;
    gradeKey: string;
    finish: Finish;
  } {
    return {
      cardId: it.cardId,
      productType: it.productType,
      gradeKey: this.pricing.gradeKeyFor({ productType: it.productType, rawCondition: it.rawCondition }),
      finish: it.finish ?? 'normal',
    };
  }

  /** Cotizador público (stateless). API_CONTRACT §6 (v1.6-finish: por RAREZA + ACABADO). */
  async publicQuote(
    cardId: string,
    productType: ProductType,
    rawCondition?: RawCondition,
    finish?: Finish,
  ): Promise<BuylistQuotePayload> {
    // Carga la tabla de reglas UNA vez y delega en el núcleo compartido (mismo que usa el batch).
    const { rules, fallbackPct } = await this.buylistRules();
    // v1.28 (P-18): control por variante (bounty/override pisan la regla, §4.26b). Un solo ítem ⇒
    // lectura single (misma vía batch de una clave).
    const key = this.overrideKeyOf({ cardId, productType, rawCondition, finish });
    const override = await this.pricing.getVariantOverride(
      key.cardId,
      key.productType,
      key.gradeKey,
      key.finish,
    );
    return this.quoteCardForFinish(cardId, productType, rawCondition, finish, rules, fallbackPct, override);
  }

  /**
   * v1.15 (§4.16b) — cotización en LOTE (`POST /buylist/quote/batch`, public, READ-ONLY). Mata el
   * fan-out FE-12: cotiza N cartas en 1 request. Es un `map` de la MISMA lógica por-carta
   * (`quoteCardForFinish`) compartiendo `buylistRules()` (un solo read de config) → misma matemática
   * y mismos guardarraíles (gate premium, BUYLIST_PRICE_RULES + fallback, referencia por acabado, FX
   * ya bakeada en PriceReference). SEC-A1 intacto.
   *
   * ERRORES POR-ÍTEM: una carta inválida (NOT_FOUND / FINISH_NOT_AVAILABLE) NO tumba las demás — su
   * resultado sale `ok:false` con el `error` de ESE ítem; el HTTP global es 200. Correlación por
   * `index` + eco de `cardId`. READ-ONLY estricto: NO crea solicitud, NO mueve dinero, NO persiste y
   * NO escala a PendingPriceEntry (endpoint anónimo; la escalada sigue solo en `createRequest`).
   */
  async batchQuote(items: QuoteItemInput[]): Promise<{ results: BuylistBatchQuoteResult[] }> {
    const { rules, fallbackPct } = await this.buylistRules();
    // v1.28 (P-18): overrides por variante leídos EN LOTE (UNA query por request, §4.26b — sin N+1).
    const overrides = await this.pricing.getVariantOverridesBatch(items.map((it) => this.overrideKeyOf(it)));
    const results: BuylistBatchQuoteResult[] = [];
    for (let index = 0; index < items.length; index++) {
      const it = items[index];
      try {
        const k = this.overrideKeyOf(it);
        const payload = await this.quoteCardForFinish(
          it.cardId,
          it.productType,
          it.rawCondition,
          it.finish,
          rules,
          fallbackPct,
          overrides.get(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`) ?? null,
        );
        results.push({ index, cardId: it.cardId, ok: true, ...payload });
      } catch (e) {
        // Solo los errores por-ítem esperados (los mismos que el endpoint por-carta devolvería como
        // 404/422) se degradan a `ok:false`; cualquier otro error (p. ej. fallo de infra) se propaga.
        if (
          e instanceof BusinessException &&
          (e.code === 'NOT_FOUND' || e.code === 'FINISH_NOT_AVAILABLE')
        ) {
          const body = e.getResponse() as { message?: string };
          results.push({
            index,
            cardId: it.cardId,
            ok: false,
            error: {
              code: e.code,
              message: typeof body?.message === 'string' ? body.message : e.code,
            },
          });
        } else {
          throw e;
        }
      }
    }
    return { results };
  }

  /**
   * Núcleo de cotización por-carta+acabado (READ-ONLY). Lo comparten `publicQuote` (por-carta) y
   * `batchQuote` (lote) — recibe `rules`/`fallbackPct` ya cargados para no re-leer config por ítem.
   * SEC-A1: rareza + acabado se derivan SIEMPRE server-side (Card.rarity + finish validado contra
   * card.availableFinishes), nunca del cliente. Lanza `NOT_FOUND` (carta inexistente) o
   * `FINISH_NOT_AVAILABLE` (acabado fuera de availableFinishes) — el batch los captura por-ítem.
   *
   * v1.12-catalog-pricing (§4.13b) — READ-ONLY: NO escala a `PendingPriceEntry` aunque el resultado
   * sea `precio_pendiente`. Con el catálogo ya priceado (§4.13a) este `getReference` casi siempre
   * encuentra precio; un endpoint público/anónimo NO debe escribir en la cola del dueño (superficie
   * de abuso). La escalada queda SOLO en el flujo autenticado `createRequest`.
   */
  private async quoteCardForFinish(
    cardId: string,
    productType: ProductType,
    rawCondition: RawCondition | undefined,
    finish: Finish | undefined,
    rules: Record<string, BuylistRule>,
    fallbackPct: number,
    // v1.28 (P-18/P-22, §4.26b): fila M-30 de la variante, pre-cargada por el caller (single o en
    // lote). `null`/omitida = sin control ⇒ cadena de reglas de SIEMPRE, sin cambio.
    override?: VariantPriceOverride | null,
  ): Promise<BuylistQuotePayload> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
    // SEC-A1: el acabado se valida contra los acabados REALES de la carta antes de cotizar.
    const f = this.assertFinishAvailable(card, finish);
    const gradeKey = this.pricing.gradeKeyFor({ productType, rawCondition });
    // v1.6-finish: la referencia del `pct` es la del ACABADO cotizado.
    const ref = await this.pricing.getReference(cardId, productType, gradeKey, f);
    const referenceMxnCents =
      ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
    // SEC-A1: rareza + acabado derivados server-side (Card.rarity, finish validado), no del cliente.
    // v1.28: precedencia NORMATIVA bounty > override > regla > pendiente (un solo cuerpo, money.ts).
    const quote = quoteAcquisitionForFinish(card.rarity, f, referenceMxnCents, rules, fallbackPct, override);
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
   * v1.28: `PricingService.loadBuylistRules()` lee las MISMAS claves para la consola/binder — si
   * cambia el formato del dial, cambian juntos (misma SettingKey, misma forma).
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
    // v1.15 (§4.16a, PII): `clabe` OPCIONAL. Ver resolución/fallback abajo.
    clabe?: string,
    ineUploadKeys?: { front: string; back: string },
  ) {
    // SEC/PII: la KYC se lee SIEMPRE por el `userId` autenticado (nunca la de otro usuario).
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId } });

    // v1.15 (§4.16a) — Resolución de la CLABE efectiva:
    //  - `clabe` presente → comportamiento actual: valida formato (CLABE_INVALID) y nombre propio
    //    por BLIND INDEX (HMAC, SIN descifrar) contra la de archivo (CLABE_NOT_OWN_NAME); se persiste
    //    en KYC (clabeEnc + clabeHmac).
    //  - `clabe` omitida → FALLBACK server-side a la CLABE del PROPIO usuario en archivo
    //    (KycProfile.clabeEnc, desencriptada — MISMA fuente que revealClabe). NUNCA la de otro.
    //    Sin CLABE en archivo → 422 CLABE_REQUIRED. La CLABE en claro NUNCA se loguea ni se devuelve.
    let effectiveClabe: string;
    // Solo cuando `clabe` viene en el body se (re)persiste en la KYC; el fallback ya está en archivo.
    let kycClabeFields: { clabeEnc: string; clabeHmac: string } | null = null;
    if (clabe != null && clabe !== '') {
      if (!isValidClabe(clabe)) {
        throw BusinessException.validation('CLABE_INVALID', 'CLABE must be 18 digits');
      }
      const incomingHmac = this.pii.clabeBlindIndex(clabe);
      if (kyc?.clabeHmac && !this.pii.blindIndexEquals(kyc.clabeHmac, incomingHmac)) {
        throw BusinessException.validation(
          'CLABE_NOT_OWN_NAME',
          'CLABE must match the one on file (own name)',
        );
      }
      effectiveClabe = clabe;
      kycClabeFields = { clabeEnc: this.pii.encrypt(clabe), clabeHmac: incomingHmac };
    } else {
      // FALLBACK: CLABE del propio usuario en archivo (misma vía que revealClabe, buylist.service.ts).
      const onFile = this.pii.decryptOptional(kyc?.clabeEnc);
      if (!onFile) {
        throw BusinessException.validation(
          'CLABE_REQUIRED',
          'A CLABE is required: none provided and none on file',
        );
      }
      effectiveClabe = onFile;
    }

    // Cotiza cada item. SEC-A1: la regla (que determina el monto a pagar) NO se toma del DTO
    // del cliente; se DERIVA server-side de la RAREZA REAL de la carta (Card.rarity) vía la
    // tabla BUYLIST_PRICE_RULES (dial M2). Así un DTO malicioso no puede inflar `quotedTotalCents`.
    // Se snapshotea la regla aplicada (rarity/ruleMode/ruleValue/ruleSource) para auditoría.
    const { rules, fallbackPct } = await this.buylistRules();
    // v1.28 (P-18/P-22, §4.26b): overrides por variante EN LOTE (una query por request). El snapshot
    // `ruleSource` gana los valores "bounty" | "override" — habilita el conteo de bounty al pagar (P-22).
    const overrides = await this.pricing.getVariantOverridesBatch(items.map((it) => this.overrideKeyOf(it)));
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
      // v1.28 (P-18): mismo núcleo único de precedencia que quote/batch (bounty > override > regla).
      const override = overrides.get(`${it.cardId}|${it.productType}|${gradeKey}|${f}`) ?? null;
      const q = quoteAcquisitionForFinish(card.rarity, f, referenceMxnCents, rules, fallbackPct, override);
      if (q.status === 'precio_pendiente') {
        // v1.8-ronda-c: escala el pendiente del ACABADO cotizado (cola por acabado, M-19).
        await this.pricing.escalatePending(it.cardId, it.productType, gradeKey, 'buylist', undefined, f);
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
    // Fase 0.3 (compliance) — cierre del bypass del umbral INE / topes AML vía "precio pendiente".
    // Un ítem `precio_pendiente` suma 0 a `quotedTotalCents` (base del tope por solicitud, tope
    // mensual y umbral INE). Sin este control, un cliente podía enviar una carta CARA sin referencia
    // → suma $0 → no se le exigía INE ni topaba contra los caps AML.
    // DECISIÓN CONSERVADORA (para validación de seguridad): si la solicitud contiene ≥1 línea
    // `precio_pendiente`, se EXIGE INE. La incertidumbre del monto se trata como potencialmente por
    // encima del umbral (el monto real se conocerá al resolver el pendiente, ya con la carta física
    // y posiblemente por encima del tope). No debilita ningún control existente: solo endurece.
    const hasPendingLine = itemsData.some((i) => i.itemStatus === 'precio_pendiente');
    const ineRequired = quotedTotalCents >= ineThreshold || hasPendingLine;
    if (ineRequired && !ineProvided) {
      throw BusinessException.validation('INE_REQUIRED', 'INE required above threshold', {
        thresholdCents: ineThreshold,
      });
    }

    // Snapshot CIFRADO de la CLABE resuelta (de request o fallback) para el pago SPEI: usa la CLABE
    // vigente al crear la solicitud aunque el usuario cambie luego su KYC. NUNCA en claro/logueada.
    const clabeEnc = this.pii.encrypt(effectiveClabe);
    // Persiste CLABE/INE en KYC. La CLABE solo se (re)escribe cuando vino en el body (`kycClabeFields`);
    // en el fallback ya está en archivo. El INE se actualiza si vienen keys nuevas.
    await this.prisma.kycProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...(kycClabeFields ?? {}),
        ineFrontKey: ineUploadKeys?.front,
        ineBackKey: ineUploadKeys?.back,
        kycStatus: 'pending',
      },
      update: {
        ...(kycClabeFields ?? {}),
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
    rejectedAt?: Date | null;
    rejectionReason?: string | null;
  }) {
    // v1.18-buylist-rejects (§11): campos de RECHAZO — poblados SOLO si itemStatus='rechazada';
    // en cualquier otro status se OMITEN. Los plazos returnDeadlineAt/abandonDeadlineAt se DERIVAN
    // server-side de rejectedAt (fuente única; NO son columnas). Ítems legacy (rechazados pre-M-22,
    // sin rejectedAt) exponen los cuatro campos null.
    const rejection =
      i.itemStatus === 'rechazada'
        ? {
            rejectedAt: i.rejectedAt ?? null,
            rejectionReason: i.rejectionReason ?? null,
            ...rejectDeadlines(i.rejectedAt),
          }
        : {};
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
          ? // v1.28 (P-18/P-22): `source` puede ser además "bounty" | "override" (snapshot M-30).
            { mode: i.ruleMode, value: i.ruleValue, source: (i.ruleSource ?? 'rule') as AcquisitionRuleSource }
          : undefined,
      quotedPriceCents: i.quotedPriceCents ?? undefined,
      approvedPriceCents: i.approvedPriceCents ?? undefined,
      itemStatus: i.itemStatus,
      inventoryItemId: i.inventoryItemId ?? undefined,
      ...rejection,
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
    // v1.18-buylist-rejects (§6): los items del detalle del PROPIO cliente se proyectan como
    // SellItemDTO — cuando itemStatus='rechazada' exponen rejectionReason/rejectedAt y los plazos
    // derivados (la misma información del correo de rechazo). Además, el snapshot CIFRADO de la
    // CLABE jamás sale en la respuesta (el contrato: "nunca se devuelve").
    const { clabeSnapshotEnc: _enc, items, ...rest } = req;
    return {
      ...rest,
      sellRequestId: req.id,
      items: items.map((i) => this.itemDTO(i)),
    };
  }

  /** Responde a un ajuste del admin (accept/decline). API_CONTRACT §6. */
  async respond(userId: string, id: string, decision: 'accept' | 'decline') {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    if (decision === 'decline') {
      // SEC-D2: transición a estado TERMINAL → sella closedAt (ancla la retención de INE al cierre real).
      return this.prisma.sellRequest.update({
        where: { id },
        data: { status: 'rechazada', closedAt: new Date() },
      });
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
    // v1.25-buylist-orders-pagination (§M5): filtros ya validados por el controller
    // (parseAdminListFilters → 400 VALIDATION_ERROR). Omitidos = listado como HOY.
    filters?: {
      q?: string;
      dateRange?: { gte?: Date; lte?: Date };
      centsRange?: { gte?: number; lte?: number };
    },
  ) {
    const where: Prisma.SellRequestWhereInput = {};
    // v1.25-buylist-orders-pagination (§M5): `status` pasa a aceptar CSV → `status IN (...)`
    // (la pestaña «Cerradas» = `pagada,rechazada,abandonada` en UNA llamada). Compat TOTAL: un solo
    // token se comporta IDÉNTICO a hoy (escalar `where.status = token`, no `{ in: [...] }`); omitirlo
    // = sin filtro de estado. Cada token debe ser `SellRequestStatus` válido; desconocido → 400
    // VALIDATION_ERROR con `details.invalidStatus` (nunca SQL crudo — Prisma parametrizado).
    if (status) {
      const tokens = status
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (tokens.length > 0) {
        const valid = Object.values(SellRequestStatus) as string[];
        const invalidStatus = tokens.filter((t) => !valid.includes(t));
        if (invalidStatus.length > 0) {
          throw BusinessException.badRequest(
            'VALIDATION_ERROR',
            'Invalid status token',
            { invalidStatus },
          );
        }
        where.status =
          tokens.length === 1
            ? (tokens[0] as SellRequestStatus)
            : { in: tokens as SellRequestStatus[] };
      }
    }
    // v1.7-admin-users: filtro opcional por SellRequest.userId (simetría con /admin/orders).
    if (userId) where.userId = userId;
    // v1.25-buylist-orders-pagination (§M5): `q` contains case-insensitive OR sobre folio
    // (`SellRequest.id`) + vendedor (`User.name`/`User.email` vía el join `user` ya existente).
    // NUNCA busca sobre CLABE/RFC/INE ni datos de pago (evita oráculo de enumeración de PII).
    if (filters?.q) {
      where.OR = [
        { id: { contains: filters.q, mode: 'insensitive' } },
        { user: { name: { contains: filters.q, mode: 'insensitive' } } },
        { user: { email: { contains: filters.q, mode: 'insensitive' } } },
      ];
    }
    // Rango `createdAt` (gte/lte) y rango de MONTO sobre `quotedTotalCents` (gte/lte) — snapshot
    // histórico SIEMPRE presente (Int @default(0)); NO `approvedTotalCents` (nullable, excluiría las
    // rechazadas/abandonadas que dominan «Cerradas»). Ya validados/normalizados por el controller.
    if (filters?.dateRange) where.createdAt = filters.dateRange;
    if (filters?.centsRange) where.quotedTotalCents = filters.centsRange;
    // QA-BUG: `include: { items: true }` no traía `card`, y M5View crasheaba al leer
    // `it.card.name`. AdminBuylistDTO.items exige `card: CardDTO`; se incluye y mapea.
    // v1.18-buylist-rejects: orden NORMATIVO `createdAt desc` (más reciente primero; antes `asc`,
    // desviación anotada en BL-1) + `seller: AdminSellerRef` (join a User). El correo del vendedor
    // es dato de contacto operativo de back-office por rol — NO es la CLABE: sin enmascarado ni
    // reveal auditado (§4.18d). `userId` se conserva por compat (seller.id === userId).
    const [rows, total] = await Promise.all([
      this.prisma.sellRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: { include: { card: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.sellRequest.count({ where }),
    ]);
    const data = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      seller: this.sellerRef(r.user),
      status: r.status,
      quotedTotalCents: r.quotedTotalCents,
      approvedTotalCents: r.approvedTotalCents ?? undefined,
      createdAt: r.createdAt,
      items: r.items.map((i) => this.itemDTO(i)),
    }));
    return { data, page, pageSize, total };
  }

  /** v1.18-buylist-rejects: AdminSellerRef = { id, name, email } (§11). Tolerante a mocks sin join. */
  private sellerRef(
    user: { id: string; name: string; email: string } | null | undefined,
  ): { id: string; name: string; email: string } | undefined {
    return user ? { id: user.id, name: user.name, email: user.email } : undefined;
  }

  async adminGet(id: string) {
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: {
        items: { include: { card: true } },
        // v1.18-buylist-rejects: mismo `seller: AdminSellerRef` que el listado (§M5).
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!req) throw BusinessException.notFound();
    // La CLABE cifrada NUNCA se expone en la vista de detalle; solo por el reveal dedicado.
    // El join de User tampoco se propaga crudo: se proyecta SOLO el AdminSellerRef.
    const { clabeSnapshotEnc: _enc, user, items, ...safe } = req;
    return {
      ...safe,
      seller: this.sellerRef(user),
      // v1.18-buylist-rejects: items como SellItemDTO (incluye campos de rechazo + plazos derivados).
      items: (items ?? []).map((i) => this.itemDTO(i)),
      clabeMasked: maskClabe(this.pii.decryptOptional(_enc)),
    };
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

  /**
   * B-4 / S-B5: factor de ajuste al alza permitido sobre el precio cotizado. El admin puede
   * subir el monto aprobado hasta 2× lo cotizado (margen razonable para reevaluar al alza tras
   * verificar la carta) — nunca un monto arbitrario. Por encima de ese factor o del tope AML por
   * solicitud, se rechaza (422). NO afecta el flujo normal (aprobar el cotizado siempre pasa).
   */
  private static readonly APPROVED_PRICE_UPLIFT_FACTOR = 2;

  /**
   * B-4 / S-B5: valida server-side que el monto de dinero saliente por SPEI que un
   * `vault_operator`/admin aprueba no exceda una cota razonable. Defensa en profundidad además
   * del `@Max` del DTO (SEC-A1: el dinero se deriva/valida en el servidor, nunca se confía al DTO).
   *  - Cota relativa: ≤ `quotedPriceCents` × FACTOR (permite ajustes al alza acotados).
   *  - Cota absoluta AML: ≤ tope por solicitud (`buylist_cap_per_request_cents`); un ítem no puede
   *    aprobar más que el tope completo de una solicitud.
   * Sin `quotedPriceCents` (p. ej. carta que estaba en `precio_pendiente`), solo aplica la cota AML.
   *
   * RB-3 (v1.8-ronda-c): el cap AML se recibe YA resuelto por el llamador honrando el
   * `kyc.capPerRequestCentsOverride` del usuario (misma fuente que `createRequest`), no el dial
   * global a secas. Así un usuario con override más alto no ve rechazada una aprobación legítima.
   */
  private async assertApprovedPriceWithinCap(
    effectiveCents: number,
    quotedPriceCents: number | null,
    amlCap: number,
  ): Promise<void> {
    const relativeCap =
      quotedPriceCents != null && quotedPriceCents > 0
        ? quotedPriceCents * BuylistService.APPROVED_PRICE_UPLIFT_FACTOR
        : amlCap;
    const cap = Math.min(relativeCap, amlCap);
    if (effectiveCents > cap) {
      throw BusinessException.validation(
        'APPROVED_PRICE_CAP_EXCEEDED',
        'Approved price exceeds the allowed cap for this item',
        { approvedPriceCents: effectiveCents, quotedPriceCents, cap },
      );
    }
  }

  /** Cherry-pick: decisión carta por carta. API_CONTRACT §M5. */
  async itemDecision(
    itemId: string,
    decision: 'approve' | 'adjust' | 'reject',
    approvedPriceCents?: number,
    // v1.18-buylist-rejects: motivo del rechazo — OBLIGATORIO con reject (3–500 chars); se IGNORA
    // (no se persiste) para approve/adjust.
    reason?: string,
  ) {
    const item = await this.prisma.sellRequestItem.findUnique({
      where: { id: itemId },
      include: {
        sellRequest: {
          select: {
            userId: true,
            // v1.18: destinatario/idioma del correo de rechazo (dueño de la solicitud).
            user: { select: { email: true, name: true, locale: true } },
          },
        },
        // v1.18: datos de la carta para el correo de rechazo (nombre/set/número).
        card: { select: { name: true, number: true, set: { select: { name: true } } } },
      },
    });
    if (!item) throw BusinessException.notFound();

    // ------- v1.18-buylist-rejects: semántica COMPLETA de `reject` (API_CONTRACT §M5) -------
    if (decision === 'reject') {
      // Idempotencia: re-reject sobre un ítem ya `rechazada` = no-op (200 con el estado actual;
      // NO re-fija rejectedAt, NO re-envía correo).
      if (item.itemStatus === 'rechazada') {
        const { sellRequest: _sr, card: _card, ...plain } = item;
        return plain;
      }
      // `reason` obligatorio (3–500 chars tras trim). El DTO ya lo valida (400 VALIDATION_ERROR);
      // esto es defensa en profundidad para llamadas internas/whitespace-only.
      const trimmedReason = (reason ?? '').trim();
      if (trimmedReason.length < 3 || trimmedReason.length > 500) {
        throw BusinessException.badRequest(
          'VALIDATION_ERROR',
          'reason is required for decision "reject" (3–500 chars)',
          { field: 'reason' },
        );
      }
      const rejectedAt = new Date();
      // INVARIANTE de dinero (BL-1, §4.18b): el rechazo SACA el ítem del total aprobado aunque
      // antes hubiera sido aprobado/ajustado → approvedPriceCents=null ANTES del recompute.
      const updated = await this.prisma.sellRequestItem.update({
        where: { id: itemId },
        data: {
          itemStatus: 'rechazada',
          approvedPriceCents: null,
          rejectedAt,
          rejectionReason: trimmedReason,
        },
      });
      await this.recomputeApprovedTotal(item.sellRequestId);
      // Correo al vendedor: best-effort POST-commit — su fallo se loggea y NO revierte la decisión.
      await this.sendItemRejectedMail(item, trimmedReason, rejectedAt);
      // v1.24-buylist-request-reject (§4.18f, P-4): auto-transición de la SOLICITUD como efecto del
      // reject, TRAS el recompute. Si NO queda ningún ítem no-rechazado, cierra la solicitud a
      // `rechazada`+`closedAt`. NO toca montos (BL-1 ya lo hizo) NI envía correos.
      await this.maybeAutoRejectRequest(item.sellRequestId);
      return updated;
    }
    // RB-3: cap AML efectivo = override por-KYC del usuario si existe, si no el dial global.
    // Misma fuente que honra `createRequest` (evita rechazar una aprobación legítima de un
    // usuario con tope elevado).
    const kyc = await this.prisma.kycProfile.findUnique({
      where: { userId: item.sellRequest.userId },
      select: { capPerRequestCentsOverride: true },
    });
    const amlCap =
      kyc?.capPerRequestCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS));
    let itemStatus: 'aprobada' | 'ajustada';
    const data: Prisma.SellRequestItemUpdateInput = {};
    if (decision === 'approve') {
      itemStatus = 'aprobada';
      const effective = approvedPriceCents ?? item.quotedPriceCents ?? 0;
      // B-4: cota server-side de dinero saliente (además del @Max del DTO).
      await this.assertApprovedPriceWithinCap(effective, item.quotedPriceCents, amlCap);
      data.approvedPriceCents = effective;
    } else {
      itemStatus = 'ajustada';
      const effective = approvedPriceCents ?? 0;
      // B-4: cota server-side de dinero saliente (además del @Max del DTO).
      await this.assertApprovedPriceWithinCap(effective, item.quotedPriceCents, amlCap);
      data.approvedPriceCents = effective;
      // Dispara el plazo de 7 días en la solicitud.
      await this.prisma.sellRequest.update({
        where: { id: item.sellRequestId },
        data: { adjustmentSentAt: new Date() },
      });
    }
    data.itemStatus = itemStatus;
    // v1.18: si un ítem antes rechazado se re-decide approve/adjust, los campos de rechazo se
    // LIMPIAN (solo un ítem `rechazada` los expone; higiene de la fuente única de plazos).
    if (item.itemStatus === 'rechazada') {
      data.rejectedAt = null;
      data.rejectionReason = null;
    }
    const updated = await this.prisma.sellRequestItem.update({ where: { id: itemId }, data });
    // RB-6 / SEC-D3: deriva y persiste `approvedTotalCents` server-side desde los montos aprobados
    // por ítem, en el punto donde esos montos cambian. Lo lee el P&L / la tarjeta "buylist del periodo".
    await this.recomputeApprovedTotal(item.sellRequestId);
    return updated;
  }

  /**
   * RB-6 / SEC-D3: recalcula `SellRequest.approvedTotalCents` como la SUMA de `approvedPriceCents`
   * de sus ítems (derivación server-side, SEC-A1 — nunca de input del cliente). Se invoca cada vez
   * que una decisión de ítem fija/ajusta el monto aprobado. Si ningún ítem tiene monto aprobado,
   * queda `null` (no `0`) para distinguir "sin aprobar aún" de "aprobado en cero".
   *
   * v1.18-buylist-rejects (BL-1, §4.18b): el aggregate EXCLUYE además `itemStatus='rechazada'` —
   * defensa en profundidad sobre el invariante "un ítem rechazado JAMÁS suma en
   * approvedTotalCents" (el reject ya anula approvedPriceCents; esto lo blinda ante escrituras
   * futuras que olviden anular el monto). `quotedTotalCents` nunca se recalcula (snapshot).
   */
  private async recomputeApprovedTotal(sellRequestId: string): Promise<void> {
    const agg = await this.prisma.sellRequestItem.aggregate({
      where: {
        sellRequestId,
        approvedPriceCents: { not: null },
        itemStatus: { not: 'rechazada' },
      },
      _sum: { approvedPriceCents: true },
      _count: { approvedPriceCents: true },
    });
    const approvedTotalCents = agg._count.approvedPriceCents > 0 ? (agg._sum.approvedPriceCents ?? 0) : null;
    await this.prisma.sellRequest.update({
      where: { id: sellRequestId },
      data: { approvedTotalCents },
    });
  }

  /**
   * v1.24-buylist-request-reject (§4.18f, cierra P-4): re-evalúa el estado de la SOLICITUD tras
   * rechazar un ítem. Regla EXACTA de agregación: la solicitud pasa a `status='rechazada'` **sólo si
   * TODO ítem** está `itemStatus='rechazada'` (equivalente: **cero** ítems en estado no-rechazado).
   * `convertida_inventario` NO cuenta como rechazado (es un desenlace positivo), así que una solicitud
   * con ítems convertidos + rechazados **NO** se auto-rechaza. Al sellar el terminal fija
   * `closedAt=now()` (patrón SEC-D2, misma ancla que `paySpei`/`ine-retention`).
   *
   * IDEMPOTENTE y money-safe: NO toca montos (BL-1 ya sacó los ítems rechazados de
   * `approvedTotalCents` vía el recompute) NI envía correos (el correo por-ítem ya salió). Guard «no
   * pisar terminal»: `updateMany` con guardia de estado (mismo patrón atómico que `paySpei`) — nunca
   * reescribe una `pagada`/`abandonada` ni re-sella una `rechazada`.
   */
  private async maybeAutoRejectRequest(sellRequestId: string): Promise<void> {
    // v1.24 (endurecimiento §4.18f): el "¿queda algún ítem no-rechazado?" (count) y el "sella la
    // solicitud a rechazada" (updateMany) van en UN SOLO boundary atómico Serializable (mismo patrón
    // que `createRequest`/SEC-A2), haciendo verdadera la afirmación del doc «mismo transaction
    // boundary». Sin esto, count y update eran awaits secuenciales no atómicos. Dentro se usa `tx`.
    await this.prisma.$transaction(
      async (tx) => {
        // ¿Queda algún ítem NO-rechazado en la solicitud? (convertida_inventario cuenta como vivo).
        const nonRejectedCount = await tx.sellRequestItem.count({
          where: { sellRequestId, itemStatus: { not: 'rechazada' } },
        });
        if (nonRejectedCount > 0) return; // aún hay ítems no-rechazados → no se auto-rechaza.
        // Transición con guardia «no pisar terminal» (patrón updateMany de paySpei). Si la solicitud
        // ya es terminal (pagada/rechazada/abandonada) el updateMany no matchea → no-op.
        await tx.sellRequest.updateMany({
          where: { id: sellRequestId, status: { notIn: [...SELL_REQUEST_TERMINAL_STATES] } },
          data: { status: 'rechazada', closedAt: new Date() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * v1.24-buylist-request-reject (§4.18g): cierre EXPLÍCITO — botón «Rechazar solicitud» de M5
   * (`POST /admin/buylist/:id/reject`). Sella una solicitud a `rechazada`+`closedAt` SÓLO si TODOS
   * sus ítems ya están `rechazada`. Diseño deliberadamente ESTRECHO y money-safe: NO rechaza ítems
   * en cascada (eso es cherry-pick por-ítem con motivo/plazos/correo), NO mueve dinero, NO reevalúa
   * montos, NO manda correos. Cubre el back-log de solicitudes atoradas pre-fix P-4.
   *
   * Precondición: si queda ≥1 ítem no-rechazado → `422 REQUEST_HAS_NON_REJECTED_ITEMS`
   * (`details.nonRejectedItemStatuses`). Idempotencia: ya `rechazada` → `200` con el estado actual
   * (no re-sella, `transitioned=false` para que el controller NO audite como cambio). Otro terminal
   * (`pagada`/`abandonada`) → `409 CONFLICT` (`details.status`, invariante «no pisar terminal»).
   * `404` si no existe.
   *
   * @returns `{ request, transitioned }` — `request` es el shape de `adminGet` (Res 200 del contrato);
   *   `transitioned` indica si hubo un cambio real de estado (guía la auditoría del controller).
   */
  async rejectRequest(id: string, reason?: string): Promise<{ request: unknown; transitioned: boolean }> {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req) throw BusinessException.notFound();
    // Idempotencia: ya rechazada → 200 con el estado actual, sin re-sellar closedAt ni auditar.
    if (req.status === 'rechazada') {
      return { request: await this.adminGet(id), transitioned: false };
    }
    // Guard «no pisar terminal»: otro estado terminal (pagada/abandonada) NO se reescribe → 409.
    // (La `rechazada` ya se resolvió arriba como idempotente, así que aquí el set solo matchea
    // pagada/abandonada.) Reusa la constante única de terminales en vez del literal inline.
    if ((SELL_REQUEST_TERMINAL_STATES as readonly string[]).includes(req.status)) {
      throw BusinessException.conflict(
        'CONFLICT',
        'Request is already in a terminal state and cannot be rejected',
        { status: req.status },
      );
    }
    // v1.24 (endurecimiento §4.18g): el guard de precondición (leer ítems vivos) y el sellado del
    // estado (updateMany) van en UN SOLO boundary atómico Serializable (mismo patrón que
    // `createRequest`/SEC-A2), para que "todos los ítems rechazados" y "solicitud rechazada" no
    // puedan divergir tras un commit exitoso. Dentro se usa `tx`.
    const transitioned = await this.prisma.$transaction(
      async (tx) => {
        // Precondición (idéntica a la regla f): cierra SÓLO si TODOS los ítems ya están `rechazada`.
        // Cualquier ítem vivo (aprobada/ajustada/convertida_inventario/verificacion/…) bloquea el
        // cierre → 422 con los status vivos encontrados.
        const liveItems = await tx.sellRequestItem.findMany({
          where: { sellRequestId: id, itemStatus: { not: 'rechazada' } },
          select: { itemStatus: true },
        });
        if (liveItems.length > 0) {
          const nonRejectedItemStatuses = Array.from(
            new Set(liveItems.map((i) => i.itemStatus)),
          ) as SellItemStatus[];
          throw BusinessException.validation(
            'REQUEST_HAS_NON_REJECTED_ITEMS',
            'Request still has non-rejected items; reject them per-item before closing the request',
            { nonRejectedItemStatuses },
          );
        }
        // Efecto ÚNICO: status → rechazada + closedAt=now(). Guard atómico «no pisar terminal»
        // (patrón updateMany de paySpei) por si una transición concurrente ganó la carrera.
        const res = await tx.sellRequest.updateMany({
          where: { id, status: { notIn: [...SELL_REQUEST_TERMINAL_STATES] } },
          data: { status: 'rechazada', closedAt: new Date() },
        });
        // count===0 ⇒ una transición concurrente cerró la solicitud entre la lectura inicial y el
        // update (espejo de la verificación de `paySpei`). Re-lee DENTRO de la tx y decide:
        //  - quedó `rechazada` → idempotente: 200 con estado actual, SIN auditar como cambio.
        //  - otro terminal (`pagada`/`abandonada`) → 409 CONFLICT. NUNCA reportamos `transitioned:true`
        //    cuando el update no cambió nada (elimina la entrada de auditoría fantasma).
        if (res.count === 0) {
          const current = await tx.sellRequest.findUnique({ where: { id }, select: { status: true } });
          if (current?.status === 'rechazada') return false;
          throw BusinessException.conflict(
            'CONFLICT',
            'Request is already in a terminal state and cannot be rejected',
            { status: current?.status },
          );
        }
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { request: await this.adminGet(id), transitioned };
  }

  /**
   * v1.18-buylist-rejects (§4.18c): correo al vendedor por RECHAZO de su carta. BEST-EFFORT
   * POST-COMMIT: se invoca DESPUÉS de persistir la decisión + recompute; cualquier fallo (puerto
   * ausente, proveedor caído, datos incompletos) se loggea y NO revierte la decisión ni falla el
   * request. Sin cola de reintentos en MVP (deuda aceptada BE-43). Minimización: solo carta
   * (nombre/set/número), acabado, motivo y plazos — SIN CLABE, SIN montos/estado de otros ítems.
   */
  private async sendItemRejectedMail(
    item: {
      id: string;
      finish: Finish;
      sellRequest?: { user?: { email: string; name: string; locale: string | null } | null } | null;
      card?: { name: string; number: string; set?: { name: string } | null } | null;
    },
    reason: string,
    rejectedAt: Date,
  ): Promise<void> {
    try {
      const user = item.sellRequest?.user;
      if (!this.mail || !user?.email) {
        this.logger.warn(
          `buylist reject mail skipped for item ${item.id}: ${this.mail ? 'no recipient email' : 'MAIL_PORT unavailable'}`,
        );
        return;
      }
      const { returnDeadlineAt, abandonDeadlineAt } = rejectDeadlines(rejectedAt);
      const msg = sellItemRejectedTemplate(
        {
          cardName: item.card?.name ?? '',
          setName: item.card?.set?.name ?? '',
          cardNumber: item.card?.number ?? '',
          finish: item.finish ?? 'normal',
          reason,
          returnDeadlineAt,
          abandonDeadlineAt,
        },
        user.name ?? '',
        user.locale,
      );
      await this.mail.send({ ...msg, to: user.email });
    } catch (e) {
      // El correo es efecto lateral best-effort: su fallo NUNCA revierte la decisión (§M5).
      this.logger.error(
        `buylist reject mail failed for item ${item.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * v1.18-buylist-rejects (§M5): pestaña «Rechazadas» — listado paginado TRANSVERSAL (todas las
   * solicitudes) de ítems `itemStatus='rechazada'` (RejectedSellItemDTO, §11). Orden `rejectedAt`
   * desc con legacy (sin rejectedAt) AL FINAL. La "fase" (ventana devolución/abandono/abandonada)
   * la deriva el FRONT de now vs las fechas — aquí no se expone como campo. Índice
   * `@@index([itemStatus])` (M-22) sirve el filtro sin barrer la tabla.
   */
  async adminRejectedItems(page: number, pageSize: number, userId?: string) {
    const where: Prisma.SellRequestItemWhereInput = { itemStatus: 'rechazada' };
    // Filtro por vendedor (simetría F1 con ?userId= de los otros listados admin).
    if (userId) where.sellRequest = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.sellRequestItem.findMany({
        where,
        orderBy: { rejectedAt: { sort: 'desc', nulls: 'last' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          // `set` completo: `toCardDTO` proyecta `setName` desde la relación (patrón
          // canónico, mismo include que sealed-mapping.service).
          card: { include: { set: true } },
          sellRequest: {
            select: { id: true, userId: true, user: { select: { id: true, name: true, email: true } } },
          },
        },
      }),
      this.prisma.sellRequestItem.count({ where }),
    ]);
    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(rows.map((i) => i.cardId));
    const data = rows.map((i) => ({
      id: i.id,
      sellRequestId: i.sellRequestId,
      seller: this.sellerRef(i.sellRequest?.user),
      // T-1 (techlead v1.19): proyección canónica CardDTO (setName/subtypes/availableFinishes),
      // NUNCA la fila Prisma cruda — contrato §11 RejectedSellItemDTO exige card: CardDTO.
      card: toCardDTO(i.card, pricedByCard.get(i.cardId)),
      productType: i.productType,
      finish: i.finish ?? 'normal',
      quotedPriceCents: i.quotedPriceCents ?? undefined,
      reason: i.rejectionReason ?? null,
      rejectedAt: i.rejectedAt ?? null,
      // Plazos DERIVADOS de rejectedAt (misma familia 7d/30d que buylist-sweep); legacy → null.
      ...rejectDeadlines(i.rejectedAt),
    }));
    return { data, page, pageSize, total };
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
      // SEC-D2: `pagada` es terminal → sella closedAt (ancla la retención de INE al cierre real).
      data: { status: 'pagada', speiReference, paidBy, paidAt: new Date(), closedAt: new Date() },
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
