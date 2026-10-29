/**
 * v1.113⟨portada⟩ (API_CONTRACT §DYN.3) — el `GradedEstimateConfigDTO` de §M2 SIN `ingestMaxCardsPerRun` (dial retirado).
 *
 * Existe aparte porque `common/graded-estimate.ts` (donde vive `toGradedEstimateConfigDTO`) es el gate de §O.2/§O.7 y la
 * invariante I-5 / candado DYN-B15 exige que su `git diff` quede VACÍO. El campo sigue en el tipo interno (valor inerte de
 * código); aquí se quita de toda superficie que lo exponía: `GET/PUT /admin/pricing/graded-estimates` y el `config` del preview.
 */
import { GradedEstimateConfig, GradedEstimateConfigDTO, toGradedEstimateConfigDTO } from '../../common/graded-estimate';

export type AdminGradedEstimateConfigDTO = Omit<GradedEstimateConfigDTO, 'ingestMaxCardsPerRun'>;

export function toAdminGradedEstimateConfigDTO(cfg: GradedEstimateConfig): AdminGradedEstimateConfigDTO {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ingestMaxCardsPerRun, ...dto } = toGradedEstimateConfigDTO(cfg);
  return dto;
}
