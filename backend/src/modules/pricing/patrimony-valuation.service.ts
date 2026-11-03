/**
 * patrimony-valuation.service.ts — 💰 v1.116.4⟨ids⟩ (API_CONTRACT §IDS.2 «Valor de patrimonio» `IDS-PAT`, criterio 531;
 * ARCHITECTURE §15.1 D-IDS-R/S, §15.4 D-IDS-9). **LA PUERTA ÚNICA del valor de patrimonio de una pieza.**
 *
 * La leen, UNA vez por petición con todas sus piezas, los nueve lectores de `IDS-PAT`: «Mi bóveda» (`holdings`), su detalle,
 * `/vault/sealed`, `marketValueOf`/`marketRefOf` (`M` de §M4-SHIP.15.5 y valor asegurado del retiro), `/admin/vaults`,
 * `custodyValue`, `ownedItemRefs` (ficha 360°), `inventoryValue` y el export `.xlsx`. Antes la versión se añadía AL LADO de SK-5
 * con un ternario repetido en seis lectores, un N+1 en `holdings` y el decider `@Optional()` (con él ausente la española se
 * valuaba como inglesa SIN aviso): el próximo cambio de valor tocaba seis sitios. Ahora toca este.
 *
 * ```
 * 1. cardProductId de un promo|deck_exclusive ⇒ pending (D-IDS-S; plataforma Y cliente)
 * 2. versión ≠ (en, null) ⇒ versionReferences(pieza, v, entradas).price (solo raw; graded/sealed ⇒ pending)
 * 3. (en, null) ⇒ valuationKeyFor + valuationCentsOf (SK-5, sin cambio)
 * ```
 * Lecturas por llamada, cada una ≤ 1 sin importar N (IDS-B26): `getReferencesBatch` **SIN retención** (DYN.5.9 es solo de
 * venta; `R_en` del paso 2 sale del MISMO mapa que el paso 3 ⇒ español = inglés × X exacto en la bóveda), `sealedSourceOnFor`
 * y, solo con piezas `es` o con `cardProductId`, `loadVersionInputs` (ligas, sus referencias, productos separados y X).
 *
 * 💰 Cambio de dinero declarado (D-IDS-R): con un caso de revisión abierto en la inglesa, la bóveda del español vale `R_en`
 * VIVO × X; la venta sigue con la referencia retenida (IDS-B25).
 *
 * No vive en `PricingService` (necesita el cuerpo de venta, que depende de él: ciclo) ni en `SaleDecisionService`
 * (patrimonio no es venta: sin curva, política, overrides ni retención). Inyectada **obligatoria** en los lectores.
 */
import { Injectable } from '@nestjs/common';
import { InventoryItem } from '@prisma/client';
import { isDefaultVersion } from '../../common/card-version';
import { variantKey } from '../../common/variant-key';
import { PriceInfo, PricingService } from './pricing.service';
import { SaleDecisionService, VersionInputs } from './sale-decision.service';

/** Lo que la puerta lee de una pieza (API_CONTRACT §IDS.2 `PatrimonyPiece`): identidad de variante, de mercado y de versión. */
export type PatrimonyPiece = Pick<
  InventoryItem,
  'id' | 'cardId' | 'productType' | 'finish' | 'rawCondition' | 'gradingCompany' | 'gradeValue' | 'tcgplayerProductId' | 'language' | 'cardProductId'
>;

const pending = (): PriceInfo => ({ status: 'pending' });

@Injectable()
export class PatrimonyValuationService {
  constructor(
    private readonly pricing: PricingService,
    private readonly decider: SaleDecisionService,
  ) {}

  /**
   * El valor de patrimonio de cada pieza, por id: una entrada por pieza. `priced` ⇒ `referenceMxnCents ≠ null`, con
   * `capturedDate` y `source` de su referencia; si no, `{ status: 'pending' }` (no suma y cuenta como pendiente; ⛔ nunca 0).
   */
  async valuePieces(items: readonly PatrimonyPiece[]): Promise<Map<string, PriceInfo>> {
    const out = new Map<string, PriceInfo>();
    if (items.length === 0) return out;
    // Paso 3 (y `R_en` del paso 2): las claves de SK-5 de TODO el lote, en UNA lectura sin retención.
    const keys = items.map((i) => this.pricing.valuationKeyFor(i));
    const wanted = keys.flatMap((k) => (k ? [k] : []));
    // Sin ninguna clave (todo sellado sin mapeo / graduado sin slab) no se consulta: no hay fila que pueda valuar nada.
    const refs = wanted.length > 0 ? await this.pricing.getReferencesBatch(wanted) : new Map<string, PriceInfo>();
    const sourceOn = await this.pricing.sealedSourceOnFor(items);
    // Pasos 1 y 2: solo si el lote trae alguna pieza que pueda no ser (inglés, sin liga).
    const versioned = items.some((i) => i.language === 'es' || i.cardProductId != null);
    const inputs: VersionInputs | null = versioned ? await this.decider.loadVersionInputs(items) : null;
    items.forEach((item, idx) => {
      if (inputs) {
        // 1. D-IDS-S: un producto separado ⛔ nunca toma la referencia de la base (de plataforma o de cliente).
        if (this.decider.isSeparateProduct(item, inputs)) {
          out.set(item.id, pending());
          return;
        }
        // 2. Otra versión: su referencia de entrada, con `R_en` del mapa SIN retención de esta misma lectura.
        const v = this.decider.versionOf(item, inputs);
        if (!isDefaultVersion(v)) {
          const r = this.decider.versionReferences(item, v, { ...inputs, refs });
          out.set(
            item.id,
            r.price == null
              ? pending()
              : {
                  status: 'priced',
                  referenceMxnCents: r.price,
                  ...(r.capturedDate != null ? { capturedDate: r.capturedDate } : {}),
                  ...(r.source != null ? { source: r.source } : {}),
                },
          );
          return;
        }
      }
      // 3. (inglés, sin liga): SK-5 sin cambio — QUÉ fila (`valuationKeyFor`) y CUÁNTO cuenta (`valuationCentsOf`, gate del sellado).
      const k = keys[idx];
      const ref = k ? refs.get(variantKey(k)) : undefined;
      const cents = this.pricing.valuationCentsOf(item, ref, sourceOn);
      out.set(item.id, cents == null || ref == null ? pending() : { ...ref, status: 'priced', referenceMxnCents: cents });
    });
    return out;
  }
}
