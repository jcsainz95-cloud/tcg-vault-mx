'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { updateAdminUserPhone } from '@/lib/api/customer-file';
import { ApiClientError } from '@/lib/api-client';
import { formatMxPhone, normalizeMxPhone } from '@/lib/phone';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/** `https://wa.me/52<10 dígitos>` armado en el cliente, sin texto precargado (contrato §FICHA-CLIENTE §4). */
export function whatsappHref(phone: string | null | undefined): string | null {
  const n = normalizeMxPhone(phone ?? '');
  return n ? `https://wa.me/52${n}` : null;
}

/**
 * §CELULAR (parte M6): celular del cliente — ver, copiar y (solo `super_admin`) editar con `PATCH /admin/users/:id/phone`.
 * Misma validación que el servidor (`lib/phone.ts`): 10 dígitos, normaliza `+52`/`52`/guiones; nunca se vacía.
 * ⛔ El celular no va a `dataLayer`, URL ni logs.
 */
export function PhoneField({
  userId,
  name,
  phone,
  canEdit,
  onSaved,
}: {
  userId: string;
  name: string;
  phone: string | null | undefined;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('admin.m6.ficha');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const valid = normalizeMxPhone(phone ?? '') !== null;
  const normalized = normalizeMxPhone(value);

  const save = useMutation({
    mutationFn: () => updateAdminUserPhone(userId, normalized!),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });
  const serverRejected = save.error instanceof ApiClientError && save.error.code === 'PHONE_INVALID';

  async function copy() {
    try {
      await navigator.clipboard.writeText(normalizeMxPhone(phone ?? '') ?? phone ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin portapapeles: no pasa nada */
    }
  }

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (normalized && !save.isPending) save.mutate();
        }}
      >
        <Input
          label={t('phoneEditLabel', { name })}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          prefix="+52"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={value && !normalized ? t('phoneError') : serverRejected ? t('phoneError') : undefined}
        />
        <Button type="submit" size="sm" loading={save.isPending} disabled={!normalized}>
          {t('phoneSave')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
          {t('phoneCancel')}
        </Button>
        {save.isError && !serverRejected && (
          <span role="alert" className="w-full text-xs text-accent">
            {t('phoneSaveError')}
          </span>
        )}
      </form>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="phone-field">
      {phone ? (
        <span className="tabular font-mono">{formatMxPhone(phone)}</span>
      ) : (
        <span className="text-muted">—</span>
      )}
      {valid ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-success">{t('phoneValid')}</span>
      ) : (
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">{t('phoneMissing')}</span>
      )}
      {valid && (
        <Button type="button" size="sm" variant="secondary" onClick={copy} aria-live="polite">
          {copied ? t('copied') : t('copyPhone')}
        </Button>
      )}
      {canEdit && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setValue(normalizeMxPhone(phone ?? '') ?? '');
            save.reset();
            setEditing(true);
          }}
        >
          {t('phoneEdit')}
        </Button>
      )}
    </span>
  );
}
