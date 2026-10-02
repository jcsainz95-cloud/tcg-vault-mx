import { ReplacementCaseView } from './ReplacementCaseView';

/**
 * `/admin/m4/reponer/[caseId]` — el detalle de un caso «Por reponer» (`DESIGN_SYSTEM §37.8c`, contrato
 * `§M4-SHIP.15.8` `GET /admin/replacement-cases/:id`), con URL propia para que la tarjeta de un retiro y el
 * detalle M3 puedan enlazarlo. Guard: el layout de `(admin)`; el backend es la autoridad (`403`/`404`).
 */
export default async function ReplacementCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <ReplacementCaseView caseId={caseId} />;
}
