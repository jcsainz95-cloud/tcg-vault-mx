'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { getStandardLegality, updateStandardLegality } from '@/lib/api';
import type { StandardLegalityUpdateRequest } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';

/**
 * §12.1 — VENTANA de legalidad de Standard: qué marcas de regulación cuentan como vigentes ahora
 * (`activeMarks`) y qué cartas están baneadas por `externalId` (`banlistCardIds`). Editarla recalcula
 * la legalidad derivada sin re-sync. Es de operador (`vault_operator+`) y AUDITADA server-side.
 *
 * ⚠️ **Es el arreglo del ensayo**: con la ventana VACÍA, casi toda carta cae como «rotada / no
 * vigente» — que es lo que se vio en el ensayo de producción. Poner aquí las marcas vigentes lo
 * corrige.
 *
 * La ventana vigente se PRE-CARGA con `GET /admin/config/standard-legality` (sólo lectura, no
 * auditado). Guardar (`PUT`) REEMPLAZA por completo el arreglo enviado.
 */
const LEGALITY_KEY = ['admin', 'standard-legality'] as const;

export function StandardLegalityControl() {
  const t = useTranslations('admin.standardLegality');

  const legalityQuery = useQuery({ queryKey: LEGALITY_KEY, queryFn: getStandardLegality });
  const current = legalityQuery.data;

  const [marks, setMarks] = useState<string[]>([]);
  const [banlist, setBanlist] = useState<string[]>([]);
  const [okMsg, setOkMsg] = useState(false);

  // Siembra los chips con la ventana vigente al montar (y re-siembra si la lectura cambia).
  useEffect(() => {
    if (!current) return;
    setMarks(current.activeMarks);
    setBanlist(current.banlistCardIds);
  }, [current]);

  const save = useMutation({
    mutationFn: (patch: StandardLegalityUpdateRequest) => updateStandardLegality(patch),
    onSuccess: (res) => {
      setMarks(res.activeMarks);
      setBanlist(res.banlistCardIds);
      setOkMsg(true);
    },
  });

  function onSave() {
    setOkMsg(false);
    save.mutate({ activeMarks: marks, banlistCardIds: banlist });
  }

  if (legalityQuery.isLoading) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="dml-title">
        <div className="flex flex-col gap-1">
          <h2 id="dml-title" className="text-h2 font-semibold">
            {t('title')}
          </h2>
          <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
        </div>
        <p className="text-sm text-muted">{t('loading')}</p>
      </section>
    );
  }
  if (legalityQuery.isError || !current) {
    return (
      <section className="flex flex-col gap-4" aria-labelledby="dml-title">
        <div className="flex flex-col gap-1">
          <h2 id="dml-title" className="text-h2 font-semibold">
            {t('title')}
          </h2>
          <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button size="sm" variant="secondary" onClick={() => legalityQuery.refetch()}>
              {t('retry')}
            </Button>
          }
        >
          {t('loadError')}
        </Banner>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="dml-title">
      <div className="flex flex-col gap-1">
        <h2 id="dml-title" className="text-h2 font-semibold">
          {t('title')}
        </h2>
        <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
      </div>

      {save.isError && (
        <Banner variant="danger" role="alert">
          {t('saveError')}
        </Banner>
      )}
      {okMsg && !save.isError && (
        <Banner variant="success" role="status">
          {t('saved')}
        </Banner>
      )}

      <ChipsField
        label={t('marks.label')}
        help={t('marks.help')}
        placeholder={t('marks.placeholder')}
        emptyLabel={t('marks.empty')}
        removeLabel={(v) => t('remove', { value: v })}
        values={marks}
        onChange={setMarks}
      />

      <ChipsField
        label={t('banlist.label')}
        help={t('banlist.help')}
        placeholder={t('banlist.placeholder')}
        emptyLabel={t('banlist.empty')}
        removeLabel={(v) => t('remove', { value: v })}
        values={banlist}
        onChange={setBanlist}
      />

      <div>
        <Button onClick={onSave} disabled={save.isPending} loading={save.isPending}>
          {t('save')}
        </Button>
      </div>
    </section>
  );
}

/**
 * Editor de fichas (chips): teclear + Enter/coma agrega, la ✗ quita. Deduplica y recorta. Sin caja
 * (Dirección 5a): las fichas son rectángulos de tinta bajo una etiqueta en versalitas.
 */
function ChipsField({
  label,
  help,
  placeholder,
  emptyLabel,
  removeLabel,
  values,
  onChange,
}: {
  label: string;
  help: string;
  placeholder: string;
  emptyLabel: string;
  removeLabel: (value: string) => string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    // Una o varias fichas separadas por coma; se recortan y deduplican (respetando lo ya presente).
    const additions = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (additions.length === 0) return;
    const next = [...values];
    for (const a of additions) if (!next.includes(a)) next.push(a);
    onChange(next);
    setDraft('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      // Backspace en un campo vacío borra la última ficha (patrón de tokens estándar).
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col">
      <span className="eyebrow">{label}</span>
      <p className="mt-2 font-mono text-xs text-muted">{help}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {values.length === 0 ? (
          <span className="text-sm text-muted">{emptyLabel}</span>
        ) : (
          values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 border border-border-strong px-2 py-1 text-sm text-text"
            >
              <span className="font-mono">{v}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={removeLabel(v)}
                className="text-muted hover:text-accent"
              >
                <X size={14} aria-hidden />
              </button>
            </span>
          ))
        )}
      </div>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        aria-label={label}
        className="mt-3 w-full min-w-0 border-b border-border-strong bg-transparent pb-2 text-base text-text outline-none placeholder:text-muted focus-within:border-text focus:shadow-focus"
      />
    </div>
  );
}
