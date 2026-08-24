import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
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
// v2.0 (P-48, §4.36): la CURVA de compra sustituye a la tabla por rareza/acabado. UN solo cuerpo de
// precedencia (`quoteAcquisitionFromCurve`) para quote, batch, createRequest y la vitrina de bounties.
import { CurvePriceResult, PriceBasis, quoteAcquisitionFromCurve } from '../../common/money';
import {
  MarketBracket as MarketBracketType,
  PendingReason,
  PricingCurve,
  isBountyEffective,
  marketBracketOf,
  resolvePendingReason,
} from '../../common/pricing-curve';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { sellItemRejectedTemplate } from './buylist-mail.templates';
import { rejectDeadlines, SELL_REQUEST_TERMINAL_STATES } from './buylist-reject.constants';

/**
 * v2.0 (§4.36.6) — caps de la vitrina pública de bounties. `SHOWCASE` es el del contrato (50, sin
 * paginación: es una vitrina, no un listado). `CANDIDATE` acota la lectura ANTES del filtro por
 * efectividad, para que el endpoint anónimo no haga una lectura sin cota.
 */
const BOUNTY_SHOWCASE_CAP = 50;
const BOUNTY_CANDIDATE_CAP = 500;

interface QuoteItemInput {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  // v1.6-finish: acabado del item (default normal), validado contra card.availableFinishes.
  finish?: Finish;
  // v1.30 (§4.29): productId TCGplayer OPCIONAL (== CardProduct.tcgplayerProductId, el de
  // `separateProducts`). Presente ⇒ la línea es ESE producto separado (deck_exclusive/promo): whitelist
  // de acabado = CardProduct.finishes, referencia por su cardProductId. Ausente ⇒ set_base (v1.29).
  productId?: number;
  // v1.3.1: el cliente ya NO envía `category`. La regla se deriva server-side de Card.rarity.
}

/**
 * Payload de una cotización por-carta = shape de la respuesta de `POST /buylist/quote`
 * (BuylistQuotePayload del contrato §DTOs base). Lo reusan el quote por-carta y el batch.
 */
export interface BuylistQuotePayload {
  rarity: string | null;
  finish: Finish;
  // v1.30 (§4.29a): eco del productId cotizado (snapshot). Ausente ⇒ línea de set_base. La rareza sigue
  // saliendo de la carta; solo el ancla de la línea cambia.
  productId?: number;
  // v2.0 (P-48, §4.36.7a) — `appliedRule` RETIRADO (ya no hay `{mode,value}`: no hay reglas, hay CURVA).
  // Lo reemplaza `priceBasis`: QUÉ determinó el monto. Valores alcanzables en el eje de COMPRA:
  // "bounty" | "override" | "market" | "floor" | "pending". `precio_pendiente` ⇔ `priceBasis="pending"`.
  priceBasis: PriceBasis;
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
      // v1.30 (§4.29c): `code` gana PRODUCT_NOT_FOUND (productId inexistente) y PRODUCT_CARD_MISMATCH
      // (productId que no cuelga del cardId) — errores POR-ÍTEM (no tumban el lote).
      error: {
        code: 'NOT_FOUND' | 'FINISH_NOT_AVAILABLE' | 'PRODUCT_NOT_FOUND' | 'PRODUCT_CARD_MISMATCH';
        message: string;
      };
    };

/**
 * v2.0 (P-48, §4.36.5b) — LA DECISIÓN DE COMPRA de UNA línea: acabado resuelto, de qué variante se
 * leyó el mercado, monto **y** veredicto. Es lo que devuelve el cuerpo único `decideBuyLine`, y lo
 * consumen por igual la cotización pública (que solo lo pinta) y `createRequest` (que además lo
 * congela y lo escala). Mismo invariante que el eje de venta: `pendingReason != null` ⇒
 * `quotedPriceCents === null` y `priceBasis === 'pending'`.
 */
interface BuyLineDecision {
  /** Acabado VALIDADO server-side (SEC-A1), ya sea contra `Card.availableFinishes` o `CardProduct.finishes`. */
  finish: Finish;
  gradeKey: string;
  /** Valor de MERCADO que entró al cálculo (de la variante correcta: set_base o producto separado). */
  referenceMxnCents: number | null;
  /** Resultado crudo de la precedencia de compra (bounty > override > curva > pendiente). */
  quote: CurvePriceResult;
  /** `null` = se cotiza. No-null = bloqueada: `no_market` o el guardarraíl `premium_at_floor`. */
  pendingReason: PendingReason | null;
  /** Monto FINAL a pagar por la línea; `null` ⇔ bloqueada. */
  quotedPriceCents: number | null;
  priceBasis: PriceBasis;
}

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
   * v1.30 (§4.29b) — Resuelve el `CardProduct` de una línea con `productId` y lo valida money-safe:
   *  - inexistente ⇒ `PRODUCT_NOT_FOUND` (422 / batch ok:false).
   *  - existe pero NO cuelga del `cardId` enviado ⇒ `PRODUCT_CARD_MISMATCH` — RECHAZO validado, NUNCA
   *    fusión silenciosa con la carta de set (un productId de otra carta no se reinterpreta).
   * El productId de entrada es el TCGplayer `tcgplayerProductId` (== CardProductDTO.productId), NO el
   * UUID interno.
   */
  private async resolveCardProductForCard(
    cardId: string,
    productId: number,
  ): Promise<{ id: string; finishes: Finish[] }> {
    const cp = await this.pricing.findCardProductByTcgId(productId);
    if (!cp) {
      throw BusinessException.validation('PRODUCT_NOT_FOUND', 'Product not found', { productId });
    }
    if (cp.cardId !== cardId) {
      throw BusinessException.validation(
        'PRODUCT_CARD_MISMATCH',
        'Product does not belong to the given card',
        { productId, cardId },
      );
    }
    return { id: cp.id, finishes: (cp.finishes ?? []) as Finish[] };
  }

  /**
   * v1.30 (§4.29b) — Whitelist de acabado de un producto SEPARADO (contra `CardProduct.finishes`, NO
   * `Card.availableFinishes`). Si se OMITE `finish` y el producto tiene un solo acabado ⇒ se default-ea;
   * con >1 acabado ⇒ `finish` es OBLIGATORIO. Falta o fuera de la lista ⇒ `FINISH_NOT_AVAILABLE`. El
   * producto ya define su(s) acabado(s); el cliente no puede inventar uno.
   */
  private assertFinishForProduct(finishes: Finish[], finish?: Finish): Finish {
    if (finish == null) {
      if (finishes.length === 1) return finishes[0];
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        'Finish is required for this product',
        { finish: null, availableFinishes: finishes },
      );
    }
    if (!finishes.includes(finish)) {
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        `Finish '${finish}' is not available for this product`,
        { finish, availableFinishes: finishes },
      );
    }
    return finish;
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
    // v1.30 (§4.29): productId TCGplayer OPCIONAL. Presente ⇒ la línea es ESE CardProduct separado.
    productId?: number,
  ): Promise<BuylistQuotePayload> {
    // v2.0 (P-48, §4.36.2): iza la CURVA UNA vez y delega en el núcleo compartido (el mismo del batch).
    const curve = await this.pricing.loadPricingCurve();
    // v1.28 (P-18): control por variante (bounty/override pisan la regla, §4.26b). Un solo ítem ⇒
    // lectura single (misma vía batch de una clave). v1.30: el override (M-30, clave sin cardProductId)
    // aplica SOLO a la línea de set_base; en la rama `productId` se IGNORA (ver quoteCardForFinish).
    const key = this.overrideKeyOf({ cardId, productType, rawCondition, finish });
    const override = await this.pricing.getVariantOverride(
      key.cardId,
      key.productType,
      key.gradeKey,
      key.finish,
    );
    return this.quoteCardForFinish(cardId, productType, rawCondition, finish, curve, override, productId);
  }

  /**
   * v1.15 (§4.16b) — cotización en LOTE (`POST /buylist/quote/batch`, public, READ-ONLY). Mata el
   * fan-out FE-12: cotiza N cartas en 1 request. Es un `map` de la MISMA lógica por-carta
   * (`quoteCardForFinish`) compartiendo la curva izada UNA vez (`PricingService.loadPricingCurve()`,
   * v2.0 §4.36.2) → misma matemática y mismos guardarraíles (gate premium-en-el-piso, referencia por
   * acabado, FX ya bakeada en PriceReference). SEC-A1 intacto.
   *
   * ERRORES POR-ÍTEM: una carta inválida (NOT_FOUND / FINISH_NOT_AVAILABLE) NO tumba las demás — su
   * resultado sale `ok:false` con el `error` de ESE ítem; el HTTP global es 200. Correlación por
   * `index` + eco de `cardId`. READ-ONLY estricto: NO crea solicitud, NO mueve dinero, NO persiste y
   * NO escala a PendingPriceEntry (endpoint anónimo; la escalada sigue solo en `createRequest`).
   */
  async batchQuote(items: QuoteItemInput[]): Promise<{ results: BuylistBatchQuoteResult[] }> {
    const curve = await this.pricing.loadPricingCurve();
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
          curve,
          overrides.get(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`) ?? null,
          it.productId,
        );
        results.push({ index, cardId: it.cardId, ok: true, ...payload });
      } catch (e) {
        // Solo los errores por-ítem esperados (los mismos que el endpoint por-carta devolvería como
        // 404/422) se degradan a `ok:false`; cualquier otro error (p. ej. fallo de infra) se propaga.
        if (
          e instanceof BusinessException &&
          (e.code === 'NOT_FOUND' ||
            e.code === 'FINISH_NOT_AVAILABLE' ||
            // v1.30 (§4.29c): errores del producto separado también degradan a ok:false por-ítem.
            e.code === 'PRODUCT_NOT_FOUND' ||
            e.code === 'PRODUCT_CARD_MISMATCH')
        ) {
          const body = e.getResponse() as { message?: string };
          results.push({
            index,
            cardId: it.cardId,
            ok: false,
            error: {
              code: e.code as
                | 'NOT_FOUND'
                | 'FINISH_NOT_AVAILABLE'
                | 'PRODUCT_NOT_FOUND'
                | 'PRODUCT_CARD_MISMATCH',
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
    // v2.0 (P-48, §4.36.2): la CURVA izada por el caller (una lectura por request, BE-25).
    curve: PricingCurve,
    // v1.28 (P-18/P-22, §4.26b): fila M-30 de la variante, pre-cargada por el caller (single o en
    // lote). `null`/omitida = sin control ⇒ solo la curva.
    override?: VariantPriceOverride | null,
    // v1.30 (§4.29): productId TCGplayer. Presente ⇒ la línea es ESE CardProduct separado.
    productId?: number,
  ): Promise<BuylistQuotePayload> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
    // TODO el dinero de esta respuesta sale del cuerpo compartido; aquí solo se arma el DTO.
    const line = await this.decideBuyLine({ card, productType, rawCondition, finish, curve, override, productId });
    return this.toQuotePayload(card, line, productId);
  }

  /**
   * v2.0 (P-48, §4.36.5b / gate techlead) — **CUERPO ÚNICO de la DECISIÓN DE COMPRA de UNA línea**:
   * resuelve el acabado válido, DE QUÉ variante se lee el mercado, el override EFECTIVO, aplica la
   * precedencia de compra y devuelve el veredicto del guardarraíl. Lo consumen las TRES superficies:
   * `POST /buylist/quote` y `/quote/batch` (vía `quoteCardForFinish`) y `POST /buylist/requests`
   * (`createRequest`).
   *
   * **Por qué un solo cuerpo y no dos que hoy coinciden.** `createRequest` reimplementaba esta misma
   * secuencia —rama `productId`, rama `set_base`, `quoteAcquisitionFromCurve`, `resolvePendingReason`
   * y la derivación de `quotedPriceCents`/`priceBasis`— y aunque los dos cuerpos daban EXACTAMENTE el
   * mismo número, la spec exige uno solo por una razón concreta: la cotización pública y la solicitud
   * que se paga no pueden divergir. **El vendedor ve un número y firma otro.** Cualquier matiz futuro
   * (un tope, una condición, un segundo control por variante) entraría en uno de los dos y la
   * divergencia solo se descubriría por una queja. Lo ÚNICO propio de `createRequest` es lo que no es
   * decisión de precio: la instrumentación que se congela y el `settlePendingForVariant`.
   *
   * `card` llega YA cargada (single o en lote) para que el caller controle el N+1.
   * READ-ONLY: no escribe en la cola ni en ningún lado — quien escala sigue siendo `createRequest`.
   */
  private async decideBuyLine(input: {
    card: Card;
    productType: ProductType;
    rawCondition?: RawCondition;
    finish?: Finish;
    curve: PricingCurve;
    override?: VariantPriceOverride | null;
    productId?: number;
  }): Promise<BuyLineDecision> {
    const { card, productType, rawCondition, finish, curve, productId } = input;
    const gradeKey = this.pricing.gradeKeyFor({ productType, rawCondition });

    let f: Finish;
    let referenceMxnCents: number | null;
    let effectiveOverride: VariantPriceOverride | null | undefined = input.override;
    if (productId != null) {
      // v1.30 (§4.29b): rama PRODUCTO SEPARADO. La identidad de la línea es ESE CardProduct: whitelist de
      // acabado = CardProduct.finishes (NO Card.availableFinishes); la referencia se lee filtrada por su
      // cardProductId (precio propio del producto). El override M-30 (clave sin cardProductId) NO aplica
      // aquí: mapea a la variante set_base, no a este producto — aplicarlo sería fusión de precios
      // (money-safe: se IGNORA). La rareza NO cambia de fuente (sale de la carta).
      const cp = await this.resolveCardProductForCard(card.id, productId);
      f = this.assertFinishForProduct(cp.finishes, finish);
      const ref = await this.pricing.getReferenceByCardProduct(cp.id, productType, gradeKey, f);
      referenceMxnCents =
        ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
      effectiveOverride = null;
    } else {
      // Rama SET_BASE (comportamiento v1.29 idéntico).
      // SEC-A1: el acabado se valida contra los acabados REALES de la carta antes de cotizar.
      f = this.assertFinishAvailable(card, finish);
      // v1.6-finish: la referencia es la del ACABADO cotizado.
      const ref = await this.pricing.getReference(card.id, productType, gradeKey, f);
      referenceMxnCents =
        ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
    }
    // v2.0 (P-48, §4.36.1): el monto sale SOLO del valor de mercado — NO de la rareza ni del acabado
    // (criterio 84). El acabado ya hizo su único trabajo: elegir DE QUÉ VARIANTE se lee el mercado.
    // Precedencia NORMATIVA bounty VÁLIDO > override > curva > pendiente (un solo cuerpo, money.ts);
    // el bounty se revalida AQUÍ contra la curva vigente, no solo al crearlo (§4.36.6).
    // SEC-A1: mercado y acabado derivados server-side, jamás del DTO del cliente.
    const quote = quoteAcquisitionFromCurve(referenceMxnCents, curve, effectiveOverride);
    // v2.0 (P-48, §4.36.5b) — GUARDARRAÍL del eje de COMPRA: una rareza PREMIUM que aterriza en el BIN
    // NO se cotiza. Pagar de menos es la MISMA pérdida irreversible que vender de menos (§N.0), y que
    // una chase resuelva al bin solo puede significar que su dato de mercado está mal. NO dispara con
    // override ni bounty (decisiones deliberadas del admin).
    const pendingReason = resolvePendingReason(quote.basis, card.rarityCanonical ?? card.rarity);
    const quotedPriceCents = pendingReason == null ? quote.priceCents : null;
    return {
      finish: f,
      gradeKey,
      referenceMxnCents,
      quote,
      pendingReason,
      quotedPriceCents,
      // MISMO invariante que el eje de venta: monto en `null` ⇔ basis `pending`.
      priceBasis: pendingReason == null ? quote.basis : 'pending',
    };
  }

  /**
   * DTO de cotización a partir de la decisión compartida. Presentación pura: NO decide dinero.
   * READ-ONLY (doctrina v1.12 de endpoints anónimos): reporta `precio_pendiente` SIN escribir en la
   * cola; quien escala sigue siendo `createRequest`.
   */
  private toQuotePayload(card: Card, line: BuyLineDecision, productId?: number): BuylistQuotePayload {
    return {
      // `rarity` se conserva como dato INFORMATIVO/de display del catálogo: el monto NO depende de ella.
      rarity: card.rarity ?? null,
      finish: line.finish,
      // v1.30: eco del productId cotizado (ausente en la rama set_base).
      ...(productId != null ? { productId } : {}),
      priceBasis: line.priceBasis,
      quote: {
        status: line.quotedPriceCents != null ? ('cotizada' as const) : ('precio_pendiente' as const),
        quotedPriceCents: line.quotedPriceCents,
        currency: 'MXN' as const,
      },
      referencePrice:
        line.referenceMxnCents != null
          ? { status: 'priced' as const, priceMxnCents: line.referenceMxnCents }
          : { status: 'pending' as const },
      paymentNotice: 'PAY_AFTER_RECEIPT' as const,
    };
  }

  // v2.0 (P-48, §4.36.2) — `buylistRules()` RETIRADO. Era el segundo lector de configuración de dinero
  // del backend (no delegaba en `PricingService`), así que compra y venta podían ver tablas distintas.
  // Ahora hay UN SOLO lector de la curva en todo el backend: `PricingService.loadPricingCurve()`.

  /**
   * v1.28 (P-22, §4.26e / API_CONTRACT §6) — GET /buylist/bounties: vitrina pública «Top
   * Bounties» de la página Vender. READ-ONLY ESTRICTO (doctrina v1.12 de endpoints anónimos: no
   * persiste, no escala pendientes, no mueve dinero). Solo bounties ACTIVOS
   * (`bountyEnabled=true` + `bountyPriceCents>0` — la regla de presencia money-safe H-1) y solo
   * `productType=raw` (defensa en profundidad: el write ya lo impone; la vitrina es de sueltas).
   * Orden `bountyPriceCents desc`, cap 50, sin paginación ni query params. Un bounty
   * completado/apagado DESAPARECE de la lista (quien ya cotizó conserva su monto snapshoteado).
   */
  async publicBounties(): Promise<{
    data: {
      cardId: string;
      name: string;
      number: string;
      setName: string;
      imageSmallUrl?: string;
      rarity?: string;
      finish: Finish;
      bountyPriceCents: number;
      targetQty: number | null;
      remainingQty: number | null;
    }[];
  }> {
    // v2.0 (P-48, §4.36.6, criterios 90/91) — SEAM «PUBLICAR» de la revalidación del bounty.
    // ORDEN DE OPERACIONES NORMATIVO (importa): seleccionar candidatos activos → resolver el mercado
    // en LOTE → FILTRAR los no efectivos → ordenar `bountyPriceCents desc` → tomar el TOP 50.
    // Filtrar DESPUÉS del cap dejaría huecos silenciosos en la vitrina.
    // Efecto garantizado: para TODO bounty visible aquí, `/buylist/quote` cotiza EXACTAMENTE ese monto
    // y es ESTRICTAMENTE mayor que la tarifa estándar de esa variante.
    const candidates = await this.prisma.variantPriceOverride.findMany({
      where: { bountyEnabled: true, bountyPriceCents: { gt: 0 }, productType: 'raw' },
      // Desempate estable por edición más reciente (el contrato solo norma el precio desc).
      orderBy: [{ bountyPriceCents: 'desc' }, { updatedAt: 'desc' }],
      // Cap de CANDIDATOS (no de la vitrina): el endpoint es público/anónimo y una lectura sin cota
      // es superficie de abuso. Muy por encima del cap 50 de la vitrina, así que el filtro por
      // efectividad no se queda sin material salvo en un escenario que no existe (>500 bounties
      // activos, todos rebasados por la curva).
      take: BOUNTY_CANDIDATE_CAP,
      include: { card: { include: { set: true } } },
    });
    const curve = await this.pricing.loadPricingCurve();
    // Mercado EN LOTE (una query), mismo lote que usa el resto del eje de compra.
    const refs = await this.pricing.getReferencesBatch(
      candidates.map((r) => ({
        cardId: r.cardId,
        productType: r.productType,
        gradeKey: r.gradeKey,
        finish: r.finish,
      })),
    );
    const rows = candidates.filter((r) => {
      const ref = refs.get(`${r.cardId}|${r.productType}|${r.gradeKey}|${r.finish}`);
      const referenceMxnCents = ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
      // MISMO cuerpo de precedencia que la cotización ⇒ el número publicado ES el que se paga.
      const curveQuoteCents = quoteAcquisitionFromCurve(referenceMxnCents, curve).curveQuoteCents;
      return isBountyEffective(r.bountyPriceCents, curveQuoteCents);
    })
      // Re-orden explícito tras el filtro (el `orderBy` del query ya lo daba; se conserva por claridad
      // de que el ORDEN es parte del contrato de la vitrina) y CAP de la vitrina.
      .sort((a, b) => (b.bountyPriceCents as number) - (a.bountyPriceCents as number))
      .slice(0, BOUNTY_SHOWCASE_CAP);
    const data = rows.map((r) => ({
      cardId: r.cardId,
      name: r.card.name,
      number: r.card.number,
      setName: r.card.set.name,
      ...(r.card.imageSmallUrl ? { imageSmallUrl: r.card.imageSmallUrl } : {}),
      ...(r.card.rarity ? { rarity: r.card.rarity } : {}),
      finish: r.finish,
      bountyPriceCents: r.bountyPriceCents as number,
      targetQty: r.bountyTargetQty,
      // Dato motivacional, no compromiso contractual: target − acquired con PISO 0; null sin objetivo.
      remainingQty:
        r.bountyTargetQty != null ? Math.max(0, r.bountyTargetQty - r.bountyAcquiredQty) : null,
    }));
    return { data };
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

    // Cotiza cada item. SEC-A1: el monto a pagar NO se toma del DTO del cliente; se DERIVA server-side
    // del VALOR DE MERCADO REAL de la variante (§4.36.1). Así un DTO malicioso no puede inflar
    // `quotedTotalCents`.
    // v2.0 (P-48, §4.36.7c): se snapshotea `priceBasis` (QUÉ determinó el precio) en la MISMA
    // transacción que congela `quotedPriceCents`. Los `ruleMode`/`ruleValue`/`ruleSource` quedan LEGACY:
    // nada nuevo los escribe (no hay reglas que snapshotear).
    const curve = await this.pricing.loadPricingCurve();
    // v1.28 (P-18/P-22, §4.26b): overrides por variante EN LOTE (una query por request). El snapshot
    // `priceBasis="bounty"` es el que habilita el conteo de bounty al pagar (P-22).
    const overrides = await this.pricing.getVariantOverridesBatch(items.map((it) => this.overrideKeyOf(it)));
    const itemsData: {
      cardId: string;
      productType: ProductType;
      rawCondition?: RawCondition;
      finish: Finish;
      // v1.30 (§4.29d): snapshot del productId TCGplayer cuando la línea es un producto separado.
      cardProductId?: number;
      rarity: string | null;
      // v2.0 (P-48, §4.36.7c / §N.8): INSTRUMENTACIÓN DE COMPRA — los cinco datos se congelan en la
      // MISMA transacción que `quotedPriceCents` (que es el precio final) y con el `finish` que ya
      // tenía. Un AJUSTE posterior del admin (`approvedPriceCents`) NO los reescribe: la serie mide
      // LA DECISIÓN DE LA CURVA, y el monto realmente pagado se lee de `approvedPriceCents ?? quoted`.
      priceBasis: PriceBasis;
      marketMxnCents: number | null;
      marketBracket: MarketBracketType | null;
      quotedPriceCents: number | null;
      itemStatus: 'cotizada' | 'precio_pendiente';
    }[] = [];
    let quotedTotalCents = 0;
    /**
     * v2.1.6 (fase de seguridad) — INTENCIONES de cola, a aplicar SOLO si la solicitud se crea.
     *
     * Antes, el bucle escribía en `PendingPriceEntry` **antes** de los topes y del umbral de INE y
     * **fuera** de la transacción: una solicitud RECHAZADA por tope dejaba igualmente su rastro en la
     * cola del dueño — y, peor, podía **CERRAR** entradas (`reason=null`) por una solicitud que nunca
     * existió. Es la misma clase que S48-M1 (un cliente moviendo la cola del dueño) por otra puerta.
     */
    const pendingSettlements: Array<{
      reason: PendingReason | null;
      key: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish; cardProductId: number | null };
    }> = [];
    // Cartas EN LOTE (una query por request): antes se hacía un `findUnique` POR ÍTEM dentro del
    // bucle mientras el override sí venía en lote — N+1 que este refactor cierra de paso.
    const cardsById = new Map(
      (
        await this.prisma.card.findMany({ where: { id: { in: [...new Set(items.map((it) => it.cardId))] } } })
      ).map((c) => [c.id, c]),
    );
    for (const it of items) {
      const card = cardsById.get(it.cardId);
      if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
      // v2.0 (P-48, §4.36.5b / gate techlead) — MISMO cuerpo que `POST /buylist/quote` y `/quote/batch`:
      // el vendedor firma EXACTAMENTE el número que le cotizamos. Aquí no se re-deriva nada de dinero;
      // lo único propio de `createRequest` es lo de abajo (instrumentación + escalada a la cola).
      const line = await this.decideBuyLine({
        card,
        productType: it.productType,
        rawCondition: it.rawCondition,
        finish: it.finish,
        curve,
        // v1.28 (P-18): el override de la variante viene del LOTE. La rama `productId` lo ignora
        // dentro del cuerpo compartido (money-safe: no se fusionan precios de dos identidades).
        override:
          overrides.get(
            `${it.cardId}|${it.productType}|${this.pricing.gradeKeyFor({ productType: it.productType, rawCondition: it.rawCondition })}|${it.finish ?? 'normal'}`,
          ) ?? null,
        productId: it.productId,
      });
      // v2.1.6 (fase de seguridad) — la escritura en la cola se DIFIERE hasta después de que la
      // solicitud exista de verdad (ver abajo). Aquí solo se ACUMULA la intención.
      pendingSettlements.push({
        reason: line.pendingReason,
        key: {
          cardId: it.cardId,
          productType: it.productType,
          gradeKey: line.gradeKey,
          finish: line.finish,
          cardProductId: it.productId ?? null,
        },
      });
      quotedTotalCents += line.quotedPriceCents ?? 0;
      itemsData.push({
        cardId: it.cardId,
        productType: it.productType,
        rawCondition: it.rawCondition,
        finish: line.finish,
        ...(it.productId != null ? { cardProductId: it.productId } : {}),
        // Dato de display del catálogo; el monto NO depende de él (criterio 84).
        rarity: card.rarity ?? null,
        priceBasis: line.priceBasis,
        // Sin mercado (override/bounty sin referencia, o pendiente) van en `null`: honesto, jamás un
        // 0 inventado. El BRACKET es un índice de conveniencia; el dato real es el monto crudo.
        marketMxnCents: line.quote.marketMxnCents,
        marketBracket: marketBracketOf(line.quote.marketMxnCents),
        quotedPriceCents: line.quotedPriceCents,
        itemStatus: line.quotedPriceCents != null ? 'cotizada' : 'precio_pendiente',
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

    // v2.1.6 — AHORA sí: la solicitud EXISTE, así que la cola refleja un hecho real. Va DESPUÉS del
    // commit y no dentro de la transacción serializable a propósito: meter N escrituras de cola en
    // la tx del tope mensual alargaría su ventana de conflicto sin ganar nada — el seam es idempotente
    // y simétrico, así que si el proceso muriera entre el commit y esto, la siguiente cotización o el
    // siguiente `publish-all` vuelven a escalar. Perder una escalada es recuperable; escribir la cola
    // por una solicitud que NO se creó, no.
    for (const s of pendingSettlements) {
      // v1.8-ronda-c: la cola es POR acabado (M-19). v1.30 (§4.29d): con productId, la entrada lleva
      // su cardProductId a la clave lógica. §4.36.5c: el MISMO seam CIERRA (salida simétrica).
      await this.pricing.settlePendingForVariant(s.reason, s.key, 'buylist');
    }

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

  /**
   * v2.1.6 (AML-1, §4.36.6a) — acumulado **PAGADO** del mes del vendedor: *el dinero que SALIÓ*.
   *
   * **Por qué no basta el acumulado de intake** (`monthUsedCentsTx`, que suma `quotedTotalCents`): el
   * tope se evaluaba sobre la COTIZACIÓN de entrada, pero el dinero sale en la APROBACIÓN. Una línea
   * `precio_pendiente` entra al mes consumiendo **$0**; si después el dueño le fija precio y la
   * aprueba, ese monto **sí es dinero que sale** y hasta v2.1.5 **nada lo medía**. Con suficientes
   * líneas pendientes, el pago mensual real podía superar el tope sin que ningún control lo notara.
   *
   * Y este cambio **amplió la población de líneas en `$0`**: la curva trajo dos vías nuevas hacia
   * `precio_pendiente` (sin mercado —el bin NO gana— y el guardarraíl `premium_at_floor`). Por eso el
   * hueco es responsabilidad de este pase aunque el remedio viva en el seam de M5.
   *
   * Se suma en memoria porque el monto que salió es `approvedTotalCents ?? quotedTotalCents` — un
   * COALESCE que `_sum` de Prisma no expresa, y sumar el campo equivocado sería exactamente el error
   * que este control viene a cerrar. El conjunto está acotado por el propio tope (las solicitudes
   * PAGADAS de UN vendedor en UN mes).
   */
  private async monthPaidOutCentsTx(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const rows = await tx.sellRequest.findMany({
      // Ancla en `paidAt` (cuándo salió el dinero), no en `createdAt` (cuándo entró la solicitud):
      // una solicitud de diciembre que se paga en enero consume tope de ENERO, que es el mes en que
      // el dinero sale.
      where: { userId, status: 'pagada', paidAt: { gte: start } },
      select: { approvedTotalCents: true, quotedTotalCents: true },
    });
    return rows.reduce((acc, r) => acc + (r.approvedTotalCents ?? r.quotedTotalCents ?? 0), 0);
  }

  private itemDTO(i: {
    id: string;
    card: { id: string; name: string; number: string } | null;
    cardId: string;
    productType: ProductType;
    rawCondition: RawCondition | null;
    finish?: Finish | null;
    // v1.30 (§4.29): snapshot del productId TCGplayer (null = línea de set_base).
    cardProductId?: number | null;
    rarity?: string | null;
    // v2.0 (P-48, §4.36.7a/c): `priceBasis` reemplaza al trío legacy `ruleMode`/`ruleValue`/`ruleSource`
    // (que sobrevive en BD por retención de filas históricas, pero nada nuevo lo escribe ni lo expone).
    priceBasis?: PriceBasis | null;
    marketMxnCents?: number | null;
    marketBracket?: MarketBracketType | null;
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
    // v1.3.1: `category` reemplazado por `rarity`; v2.0 (P-48): `appliedRule` → `priceBasis`.
    return {
      id: i.id,
      cardId: i.cardId,
      card: i.card,
      productType: i.productType,
      rawCondition: i.rawCondition ?? undefined,
      // v1.6-finish: acabado snapshoteado en la cotización/solicitud.
      finish: i.finish ?? 'normal',
      // v1.30 (§4.29): eco del productId cotizado (omitido si la línea es de set_base).
      ...(i.cardProductId != null ? { productId: i.cardProductId } : {}),
      rarity: i.rarity ?? undefined,
      // v2.0 (P-48): `appliedRule` RETIRADO del DTO (no hay `{mode,value}`). Lo reemplaza `priceBasis`
      // (§4.36.7a); `null` en filas históricas anteriores a M-41, que se omiten.
      ...(i.priceBasis != null ? { priceBasis: i.priceBasis } : {}),
      // v2.0 (§N.8): instrumentación de COMPRA. `null` en filas anteriores a M-41 (se omiten).
      ...(i.marketMxnCents !== undefined ? { marketMxnCents: i.marketMxnCents } : {}),
      ...(i.marketBracket !== undefined ? { marketBracket: i.marketBracket } : {}),
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
  async rejectRequest(id: string): Promise<{ request: unknown; transitioned: boolean }> {
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
   *
   * v1.28 (P-22, §4.26e): la transición a `pagada` y el CONTEO de bounty
   * (`bountyAcquiredQty` por cada ítem con snapshot `priceBasis='bounty'`, con auto-apagado al
   * alcanzar `bountyTargetQty`) corren en la MISMA transacción — o se paga Y se cuenta, o nada.
   * Idempotente ante replays: el conteo solo corre en la llamada que HACE la transición
   * (updateMany count===1); un re-POST/replay ve `pagada` y devuelve el estado sin re-contar.
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
    // v2.1.6 (AML-1, §4.36.6a) — TOPE MENSUAL SOBRE EL DINERO QUE SALE, no solo sobre la cotización
    // de entrada. Se lee el override de KYC del VENDEDOR (mismo criterio que el intake).
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId: req.userId } });
    const capPerMonth =
      kyc?.capPerMonthCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_MONTH_CENTS));

    // SEC-M5: transición atómica con guardia de estado (patrón count===1). El
    // `updateMany` solo prospera si la solicitud sigue en un estado pagable; dos
    // llamadas concurrentes → solo una hace la transición a `pagada` (y solo esa CUENTA bounty).
    //
    // v2.1.6 (AML-1): SERIALIZABLE, por la misma razón que el intake (SEC-A2). Sin ella, dos
    // `pay-spei` concurrentes de solicitudes distintas del MISMO vendedor leen el mismo acumulado y
    // las dos pasan — el bypass clásico del tope. Con serializable, una de las dos entra en conflicto
    // y no liquida.
    const paid = await this.prisma.$transaction(
      async (tx) => {
        // Lo que REALMENTE sale por esta solicitud: lo aprobado manda; sin cherry-pick, lo cotizado.
        const payoutCents = req.approvedTotalCents ?? req.quotedTotalCents ?? 0;
        const alreadyPaid = await this.monthPaidOutCentsTx(tx, req.userId);
        if (alreadyPaid + payoutCents > capPerMonth) {
          throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-month payout cap exceeded', {
            scope: 'per_month_payout',
            capCents: capPerMonth,
            wouldBeCents: alreadyPaid + payoutCents,
          });
        }
        const res = await tx.sellRequest.updateMany({
          where: { id, status: { in: ['aprobada', 'verificacion'] }, verifiedAt: { not: null } },
          // SEC-D2: `pagada` es terminal → sella closedAt (ancla la retención de INE al cierre real).
          data: { status: 'pagada', speiReference, paidBy, paidAt: new Date(), closedAt: new Date() },
        });
        if (res.count !== 1) return null;
        // v1.28 (P-22): conteo de bounty EN LA MISMA transacción del pago (§4.26e).
        await this.countBountyAcquisitionsTx(tx, id, paidBy);
        return tx.sellRequest.findUnique({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!paid) {
      const current = await this.prisma.sellRequest.findUnique({ where: { id } });
      if (current?.status === 'pagada') return current;
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Payment allowed only after receipt/verification and approval',
      );
    }
    return paid;
  }

  /**
   * v1.28 (P-22, §4.26e) — conteo TRANSACCIONAL de bounty al pagar: por cada `SellRequestItem`
   * de la solicitud con snapshot `priceBasis='bounty'` se incrementa `bountyAcquiredQty` de SU
   * fila M-30 (clave `(cardId, productType, gradeKey, finish)` del ítem — misma derivación que la
   * cotización). Reglas money-safe:
   *  - B-1 (mismo filtro que la invariante BL-1 de `recomputeApprovedTotal`): los ítems
   *    `itemStatus='rechazada'` se EXCLUYEN del conteo — con cherry-pick esas piezas NO se compran
   *    ni suman en `approvedTotalCents`, así que tampoco cuentan hacia el bounty (§4.26a: el campo
   *    mide «piezas COMPRADAS vía buylist PAGADA bajo bounty»). Sin este filtro, las rechazadas
   *    inflarían el contador, podrían auto-apagar el bounty antes de tiempo y auditarían
   *    `bounty.completed` en falso;
   *  - el incremento aplica AUNQUE el bounty ya esté apagado (la pieza SE COMPRÓ bajo bounty; el
   *    monto quedó snapshoteado — apagar no borra ni congela el contador);
   *  - fila M-30 desaparecida (borrada sin historia) ⇒ no hay contador que llevar: se omite SIN
   *    tumbar el pago (updateMany count=0);
   *  - AUTO-APAGADO: si el bounty sigue activo, tiene `bountyTargetQty` y `acquired ≥ target` ⇒
   *    `bountyEnabled=false` + `bountyCompletedAt=now()` + `AuditLog action=bounty.completed`
   *    (el aviso de M1 sale de `completedAt`). Sin objetivo ⇒ solo contador, nunca auto-off.
   * Corre DENTRO de la transacción del pago (el caller garantiza que solo la llamada que hizo la
   * transición llega aquí ⇒ idempotente ante replays).
   */
  private async countBountyAcquisitionsTx(
    tx: Prisma.TransactionClient,
    sellRequestId: string,
    actorUserId: string,
  ): Promise<void> {
    const bountyItems = await tx.sellRequestItem.findMany({
      // B-1: mismo filtro que BL-1 — un ítem rechazado NO se compró, así que NO cuenta bounty.
      // v2.0 (P-48): el snapshot pasa de `ruleSource='bounty'` a `priceBasis='bounty'` (mismo criterio,
      // campo nuevo). Las filas históricas con `ruleSource='bounty'` ya se pagaron o son legacy.
      where: { sellRequestId, priceBasis: 'bounty', itemStatus: { not: 'rechazada' } },
      select: { cardId: true, productType: true, rawCondition: true, finish: true },
    });
    if (bountyItems.length === 0) return;
    // Agrupa por clave M-30: UNA actualización por variante (+n piezas), sin N+1 por pieza.
    const byKey = new Map<
      string,
      { cardId: string; productType: ProductType; gradeKey: string; finish: Finish; qty: number }
    >();
    for (const it of bountyItems) {
      const gradeKey = this.pricing.gradeKeyFor({
        productType: it.productType,
        rawCondition: it.rawCondition,
      });
      const finish = (it.finish ?? 'normal') as Finish;
      const key = `${it.cardId}|${it.productType}|${gradeKey}|${finish}`;
      const prev = byKey.get(key);
      if (prev) prev.qty += 1;
      else byKey.set(key, { cardId: it.cardId, productType: it.productType, gradeKey, finish, qty: 1 });
    }
    for (const g of byKey.values()) {
      const uniqueKey = {
        cardId: g.cardId,
        productType: g.productType,
        gradeKey: g.gradeKey,
        finish: g.finish,
      };
      const res = await tx.variantPriceOverride.updateMany({
        where: uniqueKey,
        data: { bountyAcquiredQty: { increment: g.qty } },
      });
      if (res.count === 0) continue; // fila borrada: nada que contar, el pago NO se cae
      const row = await tx.variantPriceOverride.findUnique({
        where: { cardId_productType_gradeKey_finish: uniqueKey },
      });
      if (
        row &&
        row.bountyEnabled &&
        row.bountyTargetQty != null &&
        row.bountyAcquiredQty >= row.bountyTargetQty
      ) {
        await tx.variantPriceOverride.update({
          where: { id: row.id },
          data: { bountyEnabled: false, bountyCompletedAt: new Date() },
        });
        // Auditoría del auto-apagado, en la MISMA tx del pago (sin PII; patrón AuditLog directo
        // porque AuditService escribe fuera de la transacción).
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'bounty.completed',
            entityType: 'VariantPriceOverride',
            entityId: row.id,
            after: {
              cardId: g.cardId,
              productType: g.productType,
              gradeKey: g.gradeKey,
              finish: g.finish,
              acquiredQty: row.bountyAcquiredQty,
              targetQty: row.bountyTargetQty,
              sellRequestId,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }
  }
}
