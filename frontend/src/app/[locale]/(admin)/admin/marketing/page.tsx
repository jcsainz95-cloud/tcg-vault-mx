import { MarketingView } from './MarketingView';
import { parseMktUrl } from './url-state';

/**
 * `/admin/marketing` — Panel de Marketing (`DESIGN_SYSTEM §MKT-UX`; `API_CONTRACT §MKT.G`). Fase 0: solo el dueño
 * (`super_admin`, `marketing:read` implícito). ⛔ Sin `SuperAdminOnly`: quien no tiene permiso recibe `403` del servidor y
 * la vista pinta el estado neutro «sin permiso» de §MKT-UX.11. Lee `?pantalla=&periodo=&week=|month=` (valores fuera
 * de dominio se ignoran, `url-state.ts`).
 */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  return <MarketingView initial={parseMktUrl(sp)} />;
}
