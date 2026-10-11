import { AuthForm } from '@/components/domain/AuthForm';

/**
 * `reason` del URL ⇒ aviso del login. `inactivity` (cierre por inactividad, `lib/inactivity.tsx`) y
 * `session_max_age` (LIVE-2, DESIGN_SYSTEM §81 F-1: mismo valor que `details.reason` del contrato
 * §14.2). Son excluyentes (un solo `reason`); cualquier otro valor ⇒ sin aviso.
 */
const NOTICE_BY_REASON = {
  inactivity: 'inactivity',
  session_max_age: 'sessionMaxAge',
} as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const { reason, next } = await searchParams;
  const notice =
    reason && Object.prototype.hasOwnProperty.call(NOTICE_BY_REASON, reason)
      ? NOTICE_BY_REASON[reason as keyof typeof NOTICE_BY_REASON]
      : undefined;
  return <AuthForm mode="login" notice={notice} next={next} />;
}
