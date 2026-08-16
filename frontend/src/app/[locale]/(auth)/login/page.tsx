import { AuthForm } from '@/components/domain/AuthForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const { reason, next } = await searchParams;
  return (
    <AuthForm
      mode="login"
      notice={reason === 'inactivity' ? 'inactivity' : undefined}
      next={next}
    />
  );
}
