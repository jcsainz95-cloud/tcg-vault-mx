import type {
  AcquisitionType,
  BatchCreateInventoryResponse,
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

/**
 * Estado del LOTE DE ALTA de M1, elevado al panel y pasado al drawer.
 *
 * Por qué vive aquí y no solo en `MasterSetPanel`: el segundo paso del alta («Dar de alta N
 * piezas») estaba renderizado DEBAJO de la cuadrícula del binder, así que con el modal abierto
 * quedaba tapado por el overlay y fuera de la vista → el operador presionaba «agregar» y «no
 * pasaba nada». El drawer necesita ver y disparar el MISMO lote (misma `batchKey`, misma
 * idempotencia) para que la acción sea concluyente sin cerrar ni hacer scroll.
 */
export interface CaptureBatchState {
  lines: CaptureLine[];
  totalPieces: number;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  result: BatchCreateInventoryResponse | null;
  /** Encola la línea en el lote (alta por LOTE: se confirma después con `submit`). */
  queue: (line: CaptureLine) => void;
  /** Alta INMEDIATA: encola la línea y envía el lote en el mismo clic (acción concluyente). */
  queueAndSubmit: (line: CaptureLine) => void;
  /** Envía el lote pendiente tal cual está. */
  submit: () => void;
  clear: () => void;
  removeLine: (key: string) => void;
}

/** id local corto para líneas del carrito y batchKey de submit (no criptográfico). */
export function localUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
