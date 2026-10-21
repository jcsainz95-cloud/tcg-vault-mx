/**
 * marketing-aggregates.types.ts — forma ÚNICA de los agregados del Panel. El endpoint JSON y los
 * exports (xlsx/csv) se construyen de ESTA MISMA estructura ⇒ paridad A=B por construcción
 * (Brief 2 §6 criterio 8; ARCHITECTURE §13.5). PURO (sin IO).
 */
import type { CellPrivacy, SuppressedCount } from './small-cells';
import type { MarketingScreen } from './marketing-period';
import type { EmbeddedAnnotation } from './marketing-annotations.service';

/** Una celda ya saneada: número, centinela «< 5» u «oculta» (§MKT.G.10), texto (etiqueta), o null (dato oculto / NO MEDIDO). */
export type Cell = number | SuppressedCount | string | null;

export type ColumnKind = 'text' | 'count' | 'money' | 'pct' | 'number';

export interface Column {
  key: string;
  /** Cabecera en español (Brief 2 §4). */
  labelEs: string;
  /** Nombre técnico (utm_content, view_item…) para la 2ª fila / hoja «Info». */
  tech?: string;
  kind: ColumnKind;
}

export interface AggTable {
  id: string; // 'a1', 'a3', 'd1', 'c7'…
  title: string;
  /** Fuente de los datos de la tabla (leyenda h2). */
  source: 'BD' | 'GA4' | 'SC' | 'Srv' | 'mixed';
  columns: Column[];
  /** Filas; cada fila mapea `column.key` → celda. El orden de columnas lo da `columns`. */
  rows: Record<string, Cell>[];
  /** Notas de la tabla (N chico, supuestos, «NO MEDIDO», cobertura…). */
  notes?: string[];
  /** false ⇒ la tabla no se pudo medir (GA4/SC apagado, etc.); `notMeasuredReason` lo explica. */
  measured: boolean;
  notMeasuredReason?: string;
}

export interface ScreenPayload {
  screen: MarketingScreen;
  period: { kind: 'week' | 'month'; from: string; to: string; label: string; timezone: 'America/Mexico_City' };
  /** Comparación con el periodo anterior de igual naturaleza (solo pantallas que la tienen). */
  previousPeriod?: { from: string; to: string };
  /** Leyenda de fuente por sigla (h2). */
  sourceLegend: Record<string, string>;
  tables: AggTable[];
  /**
   * Anotaciones de fecha del periodo (h1, §MKT.E / §13.4.6), EMBEBIDAS para pintar las gráficas a/b/c
   * y la hoja «Info» del export. TEXTO saneado al exportar (PM-B1); ⛔ sin celdas pequeñas (no son conteo).
   */
  annotations: EmbeddedAnnotation[];
  /** Avisos de pantalla (cobertura de consentimiento, Fase 0…). */
  notes?: string[];
  /**
   * Régimen APLICADO (API_CONTRACT v1.103 §MKT.G.2/.5): `exact` solo en la pantalla del dueño; `aggregates` y los
   * exports, siempre `small_cells`.
   */
  privacy: CellPrivacy;
}
