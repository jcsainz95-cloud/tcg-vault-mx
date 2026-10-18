import { SuperAdminOnly } from '@/components/domain/SuperAdminOnly';
import { CardShowAdminView } from './CardShowAdminView';

/**
 * `/admin/card-show` — Panel del Card Show (API_CONTRACT §CARDSHOW.15). Solo super_admin: el backend
 * lo impone por rol (403) y `SuperAdminOnly` es la defensa de UI ante navegación directa por URL.
 * `?tab=players` abre directo el listado de preinscritos.
 */
export default async function CardShowAdminPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const initialSection = sp.tab === 'players' ? 'players' : 'leads';
  return (
    <SuperAdminOnly>
      <CardShowAdminView initialSection={initialSection} />
    </SuperAdminOnly>
  );
}
