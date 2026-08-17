import type {
  AcquisitionType,
  Finish,
  GradingCompany,
  ProductType,
  RawCondition,
} from '@/types/contract';

/**
 * Línea del carrito de captura por lote (#12). Acumula la intención de alta de N piezas
 * de una carta concreta; el carrito se envía en UN request a `batchCreateItems`. `key` es un
 * id LOCAL (solo para render/edición en cliente); nunca viaja al backend.
 */
export interface CaptureLine {
  key: string;
  cardId: string;
  cardName: string;
  number: string;
  productType: ProductType;
  finish: Finish;
  rawCondition?: RawCondition;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  certNumber?: string;
  locationId?: string;
  acquisitionType: AcquisitionType;
  acquisitionPct?: number;
  qty: number;
}

/** id local corto para líneas del carrito y batchKey de submit (no criptográfico). */
export function localUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
