import { GoogleSignupComplete } from '@/components/domain/GoogleSignupComplete';

/** `/completa-cuenta?next=` — paso «Completa tu cuenta» de Google (§CELULAR-ALTA §6.2). */
export default async function CompleteAccountPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <GoogleSignupComplete next={Array.isArray(next) ? next[0] : next} />;
}
