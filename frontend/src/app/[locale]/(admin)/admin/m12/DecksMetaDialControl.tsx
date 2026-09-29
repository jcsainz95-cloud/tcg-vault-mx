'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { getDecksMetaDial, setDecksMetaDial } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { DecksMetaAutofetch, DecksMetaDialDTO, DecksMetaDialUpdateRequest } from '@/types/contract';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * §13 Fase 2 — INTERRUPTOR del jalado automático (dial de auto-fetch).
 *
 * El backend guarda dos diales: `autofetch` (Apagado / Ensayo / Encendido) y `autopublish`
 * («publicar solo»). Leerlos es de operador (`GET /admin/decks-meta/dial`); CAMBIARLOS es
 * **super_admin** (`PUT`), porque «Encendido» dispara egress real a un tercero y, con «publicar solo»
 * activo, publica sin intervención humana. Por eso encender —o activar «publicar solo»— pide una
 * confirmación explícita.
 *
 * El operador ve el estado en solo-lectura; el súper-admin ve los controles. El backend es la
 * autoridad y rechaza el `PUT` de un operador con `403` (se maneja con un aviso claro).
 */
const DIAL_KEY = ['admin', 'decks-meta', 'dial'] as const;
const AUTOFETCH_OPTIONS: DecksMetaAutofetch[] = ['off', 'dryrun', 'on'];

export function DecksMetaDialControl() {
  const t = useTranslations('admin.decksMetaDial');
  const { isSuperAdmin } = useRole();
  const queryClient = useQueryClient();

  const dialQuery = useQuery({ queryKey: DIAL_KEY, queryFn: getDecksMetaDial });
  const current = dialQuery.data;

  // Estado del formulario: sembrado por la lectura y re-sembrado en cada respuesta del write.
  const [autofetch, setAutofetch] = useState<DecksMetaAutofetch>('off');
  const [autopublish, setAutopublish] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    if (!current) return;
    setAutofetch(current.autofetch);
    setAutopublish(current.autopublish);
  }, [current]);

  const save = useMutation({
    mutationFn: (patch: DecksMetaDialUpdateRequest) => setDecksMetaDial(patch),
    onSuccess: (res) => {
      queryClient.setQueryData<DecksMetaDialDTO>(DIAL_KEY, res);
      setAutofetch(res.autofetch);
      setAutopublish(res.autopublish);
      setSavedOk(true);
      setConfirmOpen(false);
    },
  });

  if (dialQuery.isLoading) {
    return <p className="text-sm text-muted">{t('loading')}</p>;
  }
  if (dialQuery.isError || !current) {
    return (
      <Banner
        variant="danger"
        role="alert"
        action={
          <Button size="sm" variant="secondary" onClick={() => dialQuery.refetch()}>
            {t('retry')}
          </Button>
        }
      >
        {t('loadError')}
      </Banner>
    );
  }

  const dirty = autofetch !== current.autofetch || autopublish !== current.autopublish;
  // Escalada de riesgo: encender el jalado, o activar «publicar solo». Cualquiera de las dos pide
  // confirmación explícita antes de escribir.
  const escalates =
    (autofetch === 'on' && current.autofetch !== 'on') ||
    (autopublish && !current.autopublish);

  function buildPatch(): DecksMetaDialUpdateRequest {
    const patch: DecksMetaDialUpdateRequest = {};
    if (autofetch !== current!.autofetch) patch.autofetch = autofetch;
    if (autopublish !== current!.autopublish) patch.autopublish = autopublish;
    return patch;
  }

  function onSaveClick() {
    setSavedOk(false);
    if (!dirty) return;
    if (escalates) {
      setConfirmOpen(true);
      return;
    }
    save.mutate(buildPatch());
  }

  const forbidden =
    save.error instanceof ApiClientError && save.error.status === 403;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="dmd-title">
      <div className="flex flex-col gap-1">
        <h2 id="dmd-title" className="text-h2 font-semibold">
          {t('title')}
        </h2>
        <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
      </div>

      {/* Estado actual (siempre visible, incluso para el operador). */}
      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div className="flex items-center gap-2">
          <dt className="eyebrow">{t('state.autofetch')}</dt>
          <dd className="font-medium text-text">{t(`autofetch.${current.autofetch}`)}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="eyebrow">{t('state.autopublish')}</dt>
          <dd className="font-medium text-text">
            {current.autopublish ? t('autopublish.on') : t('autopublish.off')}
          </dd>
        </div>
      </dl>

      {save.isError && (
        <Banner variant="danger" role="alert">
          {forbidden ? t('forbidden') : t('saveError')}
        </Banner>
      )}
      {savedOk && !save.isError && (
        <Banner variant="success" role="status">
          {t('saved')}
        </Banner>
      )}

      {isSuperAdmin ? (
        <div className="flex flex-col gap-5">
          {/* Interruptor de 3 estados. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="eyebrow mb-1">{t('autofetch.label')}</legend>
            <div className="flex flex-col gap-2">
              {AUTOFETCH_OPTIONS.map((opt) => (
                <label key={opt} className="flex items-start gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name="dmd-autofetch"
                    value={opt}
                    checked={autofetch === opt}
                    onChange={() => setAutofetch(opt)}
                    className="mt-0.5 h-4 w-4 accent-[color:var(--color-accent)]"
                  />
                  <span className="flex flex-col">
                    <span className="font-medium">{t(`autofetch.${opt}`)}</span>
                    <span className="text-xs text-muted">{t(`autofetch.help.${opt}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* «Publicar solo». */}
          <label className="flex items-start gap-2 text-sm text-text">
            <input
              type="checkbox"
              role="switch"
              aria-checked={autopublish}
              checked={autopublish}
              onChange={(e) => setAutopublish(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[color:var(--color-accent)]"
            />
            <span className="flex flex-col">
              <span className="font-medium">{t('autopublish.label')}</span>
              <span className="text-xs text-muted">{t('autopublish.help')}</span>
            </span>
          </label>

          <div>
            <Button onClick={onSaveClick} disabled={!dirty || save.isPending} loading={save.isPending}>
              {t('save')}
            </Button>
          </div>
        </div>
      ) : (
        <Banner variant="info" role="status">
          {t('readOnly')}
        </Banner>
      )}

      {/* Confirmación de encendido / «publicar solo». */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('confirm.title')}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              {t('confirm.cancel')}
            </Button>
            <Button
              variant="accent"
              size="sm"
              loading={save.isPending}
              onClick={() => save.mutate(buildPatch())}
            >
              {t('confirm.confirmCta')}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <p>{t('confirm.body')}</p>
        </div>
      </Modal>
    </section>
  );
}
