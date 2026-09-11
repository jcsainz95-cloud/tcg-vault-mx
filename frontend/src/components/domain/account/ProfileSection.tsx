'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { updateMe } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { LocaleToggle } from '@/components/ui/LocaleToggle';
import type { UserDTO } from '@/types/contract';
import { SaveStatus, SectionShell } from './SectionShell';

/** Misma regla que `BuylistKycForm` (10 dígitos MX). */
const PHONE_RE = /^\d{10}$/;
const NAME_MAX = 120;

/**
 * a · Datos personales (`#profile`, DESIGN_SYSTEM §33.6a). Su propio formulario, «Guardar» solo
 * con cambios; el aviso de nombre derivado se decide por `user.nameSource === 'derived'` (contrato
 * v1.67 — la heurística por `authProvider` queda retirada) y va en `aria-describedby` del campo.
 */
export function ProfileSection({
  user,
  focusNameOnMount,
}: {
  user: UserDTO;
  /** Llegó por `#profile`: con nombre derivado, el campo arranca con el foco (§33.6a). */
  focusNameOnMount?: boolean;
}) {
  const t = useTranslations('account.profile');
  const tAcc = useTranslations('account');
  const qc = useQueryClient();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [saved, setSaved] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const derivedNoteId = useId();

  // Si el servidor devuelve otro valor (p. ej. tras un refetch de `me`), resincroniza los campos
  // que el usuario no está editando.
  useEffect(() => {
    setName(user.name);
    setPhone(user.phone ?? '');
  }, [user.name, user.phone]);

  const derived = user.nameSource === 'derived';

  useEffect(() => {
    if (focusNameOnMount && derived) nameRef.current?.focus();
  }, [focusNameOnMount, derived]);

  const dirty = name !== user.name || phone !== (user.phone ?? '');
  // Con nombre derivado el botón se habilita aunque no haya cambios: el usuario viene a escribirlo.
  const canSave = dirty || derived;

  const mut = useMutation({
    mutationFn: (input: { name?: string; phone?: string }) => updateMe(input),
    onSuccess: (me) => {
      setSaved(true);
      setErrors({});
      qc.setQueryData(['me'], me);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
        const field = err.details?.field;
        if (field === 'name') setErrors({ name: name.trim() ? t('name.tooLong') : t('name.required') });
        if (field === 'phone') setErrors({ phone: t('phone.invalid') });
      }
    },
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const trimmed = name.trim();
    const next: { name?: string; phone?: string } = {};
    if (!trimmed) return setErrors({ name: t('name.required') });
    if (trimmed.length > NAME_MAX) return setErrors({ name: t('name.tooLong') });
    if (phone !== '' && !PHONE_RE.test(phone)) return setErrors({ phone: t('phone.invalid') });
    setErrors({});
    // Solo se manda lo que cambió (o el nombre, si es derivado: guardarlo tal cual lo marca `user`).
    if (trimmed !== user.name || derived) next.name = trimmed;
    if (phone !== (user.phone ?? '')) next.phone = phone;
    mut.mutate(next);
  }

  function onLocaleChange(locale: 'es' | 'en') {
    // Idioma: cambia al instante (sin «Guardar»); persiste en `User.locale`. Con temporal activa
    // el guard bloquea `PATCH /users/me` (403): no se llama para no rebotar al usuario.
    if (user.mustChangePassword) return;
    void updateMe({ locale }).catch(() => {
      /* la ruta ya cambió; el idioma persistido se reintenta en el siguiente cambio */
    });
  }

  return (
    <SectionShell id="profile" title={t('title')}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <div>
          <Input
            ref={nameRef}
            id="profile-name"
            label={t('name.label')}
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            hint={t('name.hint')}
            error={errors.name}
            // `Input` deriva `<id>-err` / `<id>-hint`; con nombre derivado se AÑADE la nota
            // (§33.6a: «enlazada por aria-describedby»), sin perder el hint o el error.
            aria-describedby={
              derived
                ? `${errors.name ? 'profile-name-err' : 'profile-name-hint'} ${derivedNoteId}`
                : undefined
            }
          />
          {derived && (
            <p
              id={derivedNoteId}
              data-testid="name-derived-note"
              className="mt-3 border-l-2 border-accent pl-4 text-sm leading-relaxed text-muted"
            >
              {t('name.derivedFromEmail')}
            </p>
          )}
        </div>

        <div>
          {phone === '' && !errors.phone && (
            <p className="mb-2 font-mono text-[11px] uppercase tracking-label text-accent">
              {t('phone.missing')}
            </p>
          )}
          <Input
            label={t('phone.label')}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={10}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setSaved(false);
            }}
            hint={t('phone.hint')}
            error={errors.phone}
          />
        </div>

        <div className="flex flex-col">
          <span className="eyebrow" id="profile-locale-label">
            {t('locale.label')}
          </span>
          <div className="mt-3" aria-labelledby="profile-locale-label">
            <LocaleToggle onChange={onLocaleChange} />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            loading={mut.isPending}
            disabled={!canSave}
            className="w-full sm:w-auto"
          >
            {mut.isPending ? tAcc('saving') : tAcc('save')}
          </Button>
          <SaveStatus saved={saved && !mut.isPending} error={mut.isError && !errors.name && !errors.phone ? mut.error : null} />
        </div>
      </form>
    </SectionShell>
  );
}
