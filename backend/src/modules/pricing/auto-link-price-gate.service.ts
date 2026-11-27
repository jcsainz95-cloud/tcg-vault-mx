import { Injectable, Logger, Optional } from '@nestjs/common';
import { Finish, PriceAxis, ProductType } from '@prisma/client';
import { PricingService } from './pricing.service';
import { PriceReviewService } from './price-review.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { DEFAULT_PRICE_JUMP_FACTOR, decideLock, validatePriceJumpFactor, type LockDecision, type RobustResult } from '../../common/robust-market';
import { variantKey } from '../../common/variant-key';

/** Constantes del freno por set (contrato §9.6 ii; sin dial nuevo). */
export const SANITY_HELD_RATIO = 0.2;
export const SANITY_MIN_CHECKED = 5;
/** Espera de un set frenado por cordura (días). */
export const SANITY_WAIT_DAYS = 7;

export interface GateCandidate {
  cardId: string;
  finish: Finish;
  /** MXN (FX horneado) de la cotización `tcgcsv_singles` que se quiere publicar. */
  candidateMxnCents: number;
}

export interface GateVerdict {
  cardId: string;
  finish: Finish;
  candidateMxnCents: number;
  /** Había valor sano previo contra qué medir (entra en el freno por set). */
  hasBase: boolean;
  /** `true` ⇒ el candado lo retiene (salto grande sin consenso): NO se escribe `PriceReference`. */
  held: boolean;
  baselineMxnCents: number | null;
  decision: LockDecision;
  result: RobustResult;
}

const KEY = (c: { cardId: string; finish: Finish }) => ({ cardId: c.cardId, productType: 'raw' as ProductType, gradeKey: 'raw:NM', finish: c.finish });

/**
 * §AUTO-ENLACE §9.6 — el candado de precios del barrido (`decideLock` + dial `price_jump_factor` + árbitro de fuentes) aplicado a lo que el job,
 * `link-repair` y las confirmaciones van a publicar. Se decide ANTES de escribir `PriceReference` (una variante retenida no queda legible por la
 * lectura legada). Las que pasan se escriben y, como en `price-ingest` (`runPriceCandado`), se registra su decisión DESPUÉS (abre/cierra el caso).
 */
@Injectable()
export class AutoLinkPriceGate {
  private readonly logger = new Logger(AutoLinkPriceGate.name);

  constructor(
    private readonly pricing: PricingService,
    @Optional() private readonly review?: PriceReviewService,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  /** Dial `price_jump_factor` (fallback seguro al seed ×5), igual que `price-ingest`. */
  async jumpFactor(): Promise<number> {
    try {
      const raw = await this.settings?.getRaw(SettingKey.PRICE_JUMP_FACTOR);
      if (raw !== undefined && validatePriceJumpFactor(raw) === null) return raw as number;
    } catch {
      /* seed */
    }
    return DEFAULT_PRICE_JUMP_FACTOR;
  }

  async evaluate(cands: readonly GateCandidate[]): Promise<Map<string, GateVerdict>> {
    const out = new Map<string, GateVerdict>();
    if (cands.length === 0) return out;
    const today = new Date().toISOString().slice(0, 10);
    const jump = await this.jumpFactor();
    // Una sola cotización candidata por variante (la última gana; mismo (carta, acabado) de dos productos no se espera).
    const uniq = new Map<string, GateCandidate>();
    for (const c of cands) uniq.set(variantKey(KEY(c)), c);
    const detail = await this.pricing.arbiterPreviewWithCandidates(
      [...uniq.values()].map((c) => ({ key: KEY(c), candidate: { source: 'tcgcsv_singles', priceMxnCents: c.candidateMxnCents, capturedDate: today } })),
    );
    for (const [k, c] of uniq) {
      const d = detail.get(k);
      if (!d) continue;
      const decision = decideLock(d.result, d.baselineMxnCents, jump);
      const hasBase = d.baselineMxnCents != null && d.baselineMxnCents > 0;
      // Retenida = hay base y el candado NO publica (salto ≥ factor sin consenso). Sin base rige lo de `price-ingest` (se escribe y se registra después).
      out.set(k, { cardId: c.cardId, finish: c.finish, candidateMxnCents: c.candidateMxnCents, hasBase, held: hasBase && decision.outcome !== 'publish', baselineMxnCents: d.baselineMxnCents, decision, result: d.result });
    }
    return out;
  }

  /** Freno por set: ≥ 20 % (con N ≥ 5) de las variantes CON referencia previa retenidas ⇒ el set entero no se publica. */
  static sanity(verdicts: Iterable<GateVerdict>): { checked: number; held: number; tripped: boolean } {
    let checked = 0;
    let held = 0;
    for (const v of verdicts) {
      if (!v.hasBase) continue;
      checked += 1;
      if (v.held) held += 1;
    }
    return { checked, held, tripped: checked >= SANITY_MIN_CHECKED && held * 5 >= checked /* = 20 % exacto, sin float */ };
  }

  /** Abre el caso (`sell`) de las variantes retenidas: conserva el último sano, jamás publica el candidato. Best-effort. */
  async recordHeld(verdicts: readonly GateVerdict[]): Promise<void> {
    if (!this.review) return;
    for (const v of verdicts) {
      try {
        await this.review.recordArbiterDecision({ cardId: v.cardId, productType: 'raw', gradeKey: 'raw:NM', finish: v.finish, cardProductId: null, sealedProductId: null }, PriceAxis.sell, v.result, v.decision);
      } catch (e) {
        this.logger.warn(`auto-link: no se pudo abrir el caso de revisión (${(e as Error).message}).`);
      }
    }
  }

  /** Igual que `price-ingest.runPriceCandado` para lo ya escrito (sin base ⇒ consenso publica, fuente única abre caso). Best-effort. */
  async recordWritten(keys: readonly { cardId: string; finish: Finish }[]): Promise<void> {
    if (!this.review || keys.length === 0) return;
    try {
      const jump = await this.jumpFactor();
      const ks = [...new Map(keys.map((k) => [variantKey(KEY(k)), KEY(k)])).values()];
      const detail = await this.pricing.arbiterDetailForKeys(ks);
      for (const key of ks) {
        const d = detail.get(variantKey(key));
        if (!d) continue;
        await this.review.recordArbiterDecision({ ...key, cardProductId: null, sealedProductId: null }, PriceAxis.sell, d.result, decideLock(d.result, d.baselineMxnCents, jump));
      }
    } catch (e) {
      this.logger.warn(`auto-link: el candado posterior a la escritura falló (${(e as Error).message}); los precios YA se escribieron.`);
    }
  }
}
