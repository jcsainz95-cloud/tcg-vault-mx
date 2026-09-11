import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { KycReviewView } from './KycReviewView';

/**
 * `/admin/m6/kyc/[userId]` — **Revisión de identidad** (DESIGN_SYSTEM §34.1).
 *
 * Ruta propia y **no** un modal dentro de la ficha 360°, por cuatro razones medidas: el `Modal` del
 * sistema es `max-w-md` = 448 px y una INE legible necesita ≥ 560 px por cara; un modal dentro de
 * otro modal es una trampa de foco; **una URL delimita el acto que se audita** (abrir esta ruta
 * *es* el acto de mirar); y así el payload de los listados **nunca toca las imágenes**.
 *
 * Guard: `super_admin`. El backend es la autoridad (`403` llamando al endpoint, §M6-K.2.2); esto
 * es la defensa de UI para la navegación directa por URL.
 */
export default async function KycReviewPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <SuperAdminOnly>
      <KycReviewView userId={userId} />
    </SuperAdminOnly>
  );
}
