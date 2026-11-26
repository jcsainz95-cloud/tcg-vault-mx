'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { NAME_MAX, updateAdminUserName, validNameInput } from '@/lib/api/customer-file';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Nombre del cliente en la cabecera de la ficha: ver y (solo `super_admin`) editar. Mismo patrón que `PhoneField`.
 * Sin nombre (en blanco o fabricado del correo) ⇒ «Sin nombre — agregar». Validación 2–80 caracteres con al menos una letra;
 * el servidor es el juez (cualquier rechazo ⇒ mensaje claro, el valor no se pierde).
 */
export function NameField({
  userId,
  name,
  missing,
  canEdit,
  onSaved,
}: {
  userId: string;
  name: string;
  /** `true` ⇔ en blanco o `nameSource: 'derived'`. */
  missing: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations('admin.m6.ficha');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const valid = validNameInput(value);
  const save = useMutation({
    mutationFn: () => updateAdminUserName(userId, valid!),
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !save.isPending) save.mutate();
        }}
      >
        <Input
          label={t('nameEditLabel')}
          autoComplete="off"
          maxLength={NAME_MAX + 20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={value.trim() && !valid ? t('nameError', { min: 2, max: NAME_MAX }) : undefined}
        />
        <Button type="submit" size="sm" loading={save.isPending} disabled={!valid}>
          {t('nameSave')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
          {t('phoneCancel')}
        </Button>
        {save.isError && (
          <span role="alert" className="w-full text-xs text-accent">
            {t('nameSaveError')}
          </span>
        )}
      </form>
    );
  }

  const start = () => {
    setValue(missing ? '' : name);
    save.reset();
    setEditing(true);
  };
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="name-field">
      {missing ? (
        canEdit ? (
          <button type="button" onClick={start} className="font-serif text-2xl text-accent underline underline-offset-4 focus-visible:shadow-focus focus-visible:outline-none">
            {t('nameMissingAdd')}
          </button>
        ) : (
          <span className="font-serif text-2xl text-accent">{t('nameMissing')}</span>
        )
      ) : (
        <span className="font-serif text-2xl text-text">{name}</span>
      )}
      {canEdit && !missing && (
        <Button type="button" size="sm" variant="secondary" onClick={start} aria-label={t('nameEditAria', { name })}>
          {t('nameEdit')}
        </Button>
      )}
    </span>
  );
}
