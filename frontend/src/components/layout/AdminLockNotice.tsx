'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { dismissLockNotice, getMe } from '@/lib/api';
import { formatDateTimeMx } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { UserDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';

/**
 * ⭐ v1.80.9 — aviso de candado en el panel (`API_CONTRACT §M6-U.5`, `DESIGN_SYSTEM §42.6`, criterio 265).
 *
 * Una cuenta del equipo SIN correo no puede recibir el correo de «hubo varios intentos fallidos»: el
 * servidor deja `lockNotice` en `GET /users/me` y aquí se pinta hasta que el titular lo cierra.
 *
 * - Datos: `['me']`, la MISMA clave que «Mi cuenta» (caché compartida). Solo se consulta con `enabled`
 *   (sesión de staff y ⛔ sin `mustChangePassword`: el `dismiss` no está en la allowlist del 403).
 * - `role="status"`, ⛔ no `alert`: no roba el foco ni interrumpe al entrar.
 * - Cerrar = `POST /users/me/lock-notice/dismiss`. ⛔ Sin cierre optimista: solo el `204` lo quita (si se
 *   ocultara sin registrarlo, reaparecería en la siguiente entrada y parecería un candado nuevo). Error ⇒
 *   el aviso se queda con `dismissError` debajo.
 * - «Uno cada 24 h» lo garantiza el servidor; aquí no hay lógica de tiempo.
 */
export function AdminLockNotice({ enabled, onDismissed }: { enabled: boolean; onDismissed?: () => void }) {
  const t = useTranslations('admin.lockNotice');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe, enabled });
  const dismiss = useMutation({
    mutationFn: dismissLockNotice,
    onSuccess: () => {
      qc.setQueryData<UserDTO>(['me'], (prev) => (prev ? { ...prev, lockNotice: null } : prev));
      onDismissed?.();
    },
  });

  const user = me.data;
  const notice = user?.lockNotice;
  if (!enabled || !user || !notice || user.mustChangePassword === true) return null;

  return (
    <div className="mb-6" data-testid="admin-lock-notice">
      <Banner
        variant="warning"
        role="status"
        title={t('title')}
        action={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={dismiss.isPending}
            onClick={() => dismiss.mutate()}
          >
            {t('dismiss')}
          </Button>
        }
      >
        <p>{t('body', { since: formatDateTimeMx(notice.since, locale) })}</p>
        <Link
          href="/admin/account/password"
          className="mt-2 inline-block text-text underline underline-offset-4 hover:text-accent"
        >
          {t('changeLink')}
        </Link>
      </Banner>
      {dismiss.isError && (
        <p role="alert" className="mt-2 pl-4 font-mono text-xs text-accent">
          {t('dismissError')}
        </p>
      )}
    </div>
  );
}
