import type { Metadata } from 'next';
import { LinkActionClient } from '../_components/LinkActionClient';

/**
 * Página de baja del doble opt-in (Diseño A, §CARDSHOW.6 / ARCHITECTURE §4.CARDSHOW.f).
 * Fuera del i18n, igual que la landing. El GET ⛔ NO muta (C4): solo lee el `token` del query y queda
 * a la espera del clic; el cambio de estado lo hace el POST del botón.
 */
export const metadata: Metadata = {
  title: 'Date de baja — Card Show · TCG HUNT',
  robots: { index: false, follow: false },
};

export default async function CardShowUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <LinkActionClient action="unsubscribe" token={Array.isArray(token) ? token[0] : token} />;
}
