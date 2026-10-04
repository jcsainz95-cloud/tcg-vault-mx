'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getMe } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import type { OwnerOnlySettingDetails } from '@/types/contract';

/**
 * 🔒 v1.80.12.10 (§M4-SHIP.19.30.3): ¿la sesión es la cuenta del dueño? Lee `GET /users/me` (`isOwner`), la misma
 * consulta `['me']` que ya usa el panel. **Solo para mostrar u ocultar**: ⛔ nunca autoriza (autoriza el servidor con
 * `403 OWNER_ONLY_SETTING` / `403 OWNER_ACCOUNT_PROTECTED`). Mientras no se sabe, o si falla, `false`: falla cerrado
 * (los diales del dueño se ven deshabilitados y el servidor decide).
 */
export function useIsOwner(): { isOwner: boolean; known: boolean } {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe, retry: false, staleTime: 60_000 });
  return { isOwner: me.data?.isOwner === true, known: me.isSuccess };
}

/**
 * `403 OWNER_ONLY_SETTING {keys}` ⇒ «No se guardó nada: solo el dueño puede cambiar {campos}.», nombrando los campos
 * por sus `keys` (⛔ nunca por el `message`). Otro error ⇒ `null` (lo pinta quien llama).
 */
export function useOwnerOnlyDenied() {
  const t = useTranslations('admin.m10.ownerOnly');
  return (e: unknown): string | null => {
    const err = asApiError(e);
    if (err?.code !== 'OWNER_ONLY_SETTING') return null;
    const raw = (err.details as Partial<OwnerOnlySettingDetails> | undefined)?.keys;
    const keys = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
    const names = keys.map((k) => (t.has(`field.${k}`) ? t(`field.${k}`) : t('field.other')));
    const unique = [...new Set(names.length ? names : [t('field.other')])];
    return t('denied', { fields: unique.join(', ') });
  };
}
