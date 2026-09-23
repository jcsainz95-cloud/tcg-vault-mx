'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Check, X, Play, AlertTriangle } from 'lucide-react';
import { getDecksMetaPreview, runDecksMetaPublishNow } from '@/lib/api';
import type {
  DecksMetaCanaryCheck,
  DecksMetaDeckReport,
  DecksMetaRefreshReport,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DecksMetaDialControl } from './DecksMetaDialControl';

/**
 * §13 Fase 2 — pantalla de OPERADOR para el ENSAYO (dry-run) del auto-fetch de decks del meta.
 *
 * Regla de oro de esta pantalla: la escribe un dueño NO técnico y decide con ella. Por eso el
 * VEREDICTO va primero y en grande («PUBLICARÍA» / «NO PUBLICARÍA»), y el detalle debajo. Todo en
 * llano; los ids crudos (archetypeId/listId) no se pintan.
 *
 * ⛔ NO hay control de encendido aquí (encender el jalado automático es un acto deliberado que se
 * hace DESPUÉS de validar este ensayo en prod, §8). Sólo se muestra, en solo-lectura, en qué modo
 * corrió y si la publicación automática está encendida, más una nota que lo dice explícito.
 */
export function M12View() {
  const t = useTranslations('admin.decksMetaRefresh');
  const locale = useLocale() as AppLocale;

  const run = useMutation({ mutationFn: getDecksMetaPreview });

  // El endpoint devuelve el `RefreshRunResult`: o corrió (report), o se saltó (single-flight).
  const result = run.data;
  const report = result && !result.skipped ? result.report : null;
  const skipped = result && result.skipped ? result : null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">{t('moduleTitle')}</h1>
        <p className="max-w-[70ch] text-sm text-muted">{t('moduleSubtitle')}</p>
      </div>

      {/* A · Interruptor del jalado automático (super_admin edita; operador ve el estado). */}
      <DecksMetaDialControl />

      <hr className="border-border" />

      {/* B · Ensayo (dry-run). Sección de verificación; no publica nada. */}
      <section className="flex flex-col gap-8" aria-labelledby="dmr-section-title">
      <div className="flex flex-col gap-1">
        <h2 id="dmr-section-title" className="text-h2 font-semibold">{t('title')}</h2>
        <p className="max-w-[70ch] text-sm text-muted">{t('subtitle')}</p>
      </div>

      {/* El disparador + su estado de carga. El ensayo tarda ~30-45s (egress real). */}
      <div className="flex flex-col gap-3">
        <div>
          <Button loading={run.isPending} onClick={() => run.mutate()}>
            <Play size={18} aria-hidden /> {t('runButton')}
          </Button>
        </div>

        {run.isPending && (
          <Banner variant="info" role="status">
            <span className="flex items-center gap-2 text-text">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              {t('running')}
            </span>
            <p className="mt-1">{t('runningNote')}</p>
          </Banner>
        )}

        {/* Fallo de red / servidor: aviso amable con reintento (no volcamos el error crudo). */}
        {run.isError && (
          <Banner
            variant="danger"
            role="alert"
            action={
              <Button size="sm" variant="secondary" onClick={() => run.mutate()}>
                {t('retry')}
              </Button>
            }
          >
            {t('error')}
          </Banner>
        )}

        {/* Single-flight: ya hay un ensayo/corrida en curso en el servidor. */}
        {skipped && (
          <Banner
            variant="warning"
            role="status"
            action={
              <Button size="sm" variant="secondary" onClick={() => run.mutate()}>
                {t('retry')}
              </Button>
            }
          >
            {t('alreadyRunning')}
          </Banner>
        )}

        {/* Nota permanente: encender es un paso posterior y deliberado (§8). */}
        <p className="text-xs text-muted">{t('notLivePrompt')}</p>
      </div>

      {!run.isPending && !report && !run.isError && !skipped && (
        <p className="text-sm text-muted">{t('empty')}</p>
      )}

      {report && <Report report={report} locale={locale} />}
      </section>

      <hr className="border-border" />

      {/* C · Publicar ahora. Publicación REAL inmediata; solo super_admin. */}
      <PublishNowSection locale={locale} />
    </div>
  );
}

/**
 * §13 Fase 2 — súper-admin: dispara la publicación REAL inmediata
 * (`POST /admin/jobs/decks-meta-refresh`, sin `dryRun`). Corre el pipeline en vivo RESPETANDO el
 * interruptor de arriba: si está apagado, no publica nada. Publica de verdad en la tienda, así que
 * el botón pide confirmación explícita antes de disparar.
 */
function PublishNowSection({ locale }: { locale: AppLocale }) {
  const t = useTranslations('admin.decksMetaRefresh');
  const { isSuperAdmin } = useRole();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = useMutation({ mutationFn: runDecksMetaPublishNow });

  if (!isSuperAdmin) return null;

  const result = run.data;
  const report = result && !result.skipped ? result.report : null;
  const skipped = result && result.skipped ? result : null;
  const publishedCount = report?.publishedSlugs.length ?? 0;

  function onConfirm() {
    setConfirmOpen(false);
    run.mutate();
  }

  return (
    <section className="flex flex-col gap-8" aria-labelledby="dmr-publish-now-title">
      <div className="flex flex-col gap-1">
        <h2 id="dmr-publish-now-title" className="text-h2 font-semibold">
          {t('publishNow.title')}
        </h2>
        <p className="max-w-[70ch] text-sm text-muted">{t('publishNow.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <Button loading={run.isPending} disabled={run.isPending} onClick={() => setConfirmOpen(true)}>
            <Play size={18} aria-hidden /> {t('publishNow.button')}
          </Button>
        </div>

        {run.isPending && (
          <Banner variant="info" role="status">
            <span className="flex items-center gap-2 text-text">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              {t('publishNow.running')}
            </span>
            <p className="mt-1">{t('publishNow.runningNote')}</p>
          </Banner>
        )}

        {/* Fallo de red / servidor: aviso amable con reintento (no volcamos el error crudo). */}
        {run.isError && (
          <Banner
            variant="danger"
            role="alert"
            action={
              <Button size="sm" variant="secondary" onClick={() => run.mutate()}>
                {t('publishNow.retry')}
              </Button>
            }
          >
            {t('publishNow.error')}
          </Banner>
        )}

        {/* El interruptor de arriba estaba apagado: la corrida no publicó nada. */}
        {skipped && skipped.reason === 'DIAL_OFF' && (
          <Banner variant="warning" role="status">
            {t('publishNow.dialOff')}
          </Banner>
        )}

        {/* Single-flight: ya hay una corrida en curso en el servidor. */}
        {skipped && skipped.reason === 'ALREADY_RUNNING' && (
          <Banner
            variant="warning"
            role="status"
            action={
              <Button size="sm" variant="secondary" onClick={() => run.mutate()}>
                {t('publishNow.retry')}
              </Button>
            }
          >
            {t('publishNow.alreadyRunning')}
          </Banner>
        )}

        {/* Corrió de verdad: éxito si publicó algo, aviso si algún chequeo no dejó publicar. */}
        {report &&
          (publishedCount > 0 ? (
            <Banner variant="success" role="status">
              {t('publishNow.published', { count: publishedCount })}
            </Banner>
          ) : (
            <Banner variant="warning" role="status">
              {t('publishNow.nothingPublished')}
            </Banner>
          ))}
      </div>

      {report && <Report report={report} locale={locale} />}

      {/* Confirmación: esto publica de verdad en la tienda, así que no dispara de un clic. */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('publishNow.confirm.title')}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              {t('publishNow.confirm.cancel')}
            </Button>
            <Button variant="accent" size="sm" loading={run.isPending} onClick={onConfirm}>
              {t('publishNow.confirm.confirmCta')}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <p>{t('publishNow.confirm.body')}</p>
        </div>
      </Modal>
    </section>
  );
}

/** El reporte completo, veredicto primero. */
function Report({ report, locale }: { report: DecksMetaRefreshReport; locale: AppLocale }) {
  const t = useTranslations('admin.decksMetaRefresh');
  const publish = report.wouldPublish;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Veredicto grande (lo primero que lee el dueño) ─────────────────────────────────── */}
      <section
        className={`flex flex-col gap-2 border-l-2 pl-4 ${publish ? 'border-success' : 'border-accent'}`}
        aria-labelledby="dmr-verdict"
      >
        <p
          id="dmr-verdict"
          className={`font-brand text-[28px] font-bold uppercase tracking-[0.04em] lg:text-[34px] ${
            publish ? 'text-success' : 'text-accent'
          }`}
        >
          {publish ? t('verdict.publish') : t('verdict.noPublish')}
        </p>
        <p className="max-w-[70ch] text-sm text-muted">
          {publish ? t('verdict.publishBody') : t('verdict.noPublishBody')}
        </p>
        {/* Contexto de solo-lectura: modo, formato, publicación automática, cuándo y cuánto se jaló. */}
        <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-1 text-xs text-muted">
          <MetaItem label={t('mode.label')} value={t(`mode.${report.mode}`)} />
          <MetaItem label={t('format')} value={report.formatLabel} />
          <MetaItem
            label={t('autopublish.label')}
            value={report.autopublish ? t('autopublish.on') : t('autopublish.off')}
          />
          <span className="tabular">{t('ranAt', { date: formatDate(report.finishedAt, locale) })}</span>
          <span className="tabular">{t('urlsFetched', { count: report.urlsFetched.length })}</span>
        </dl>
      </section>

      {/* ── Por deck ───────────────────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('decks.title')}</h2>
        {report.decks.length > 0 ? (
          <div className="rounded-lg border border-border bg-surface p-2">
            <DataTable columns={deckColumns(t)} rows={report.decks} rowKey={(d) => d.archetypeId} />
          </div>
        ) : (
          <p className="text-sm text-muted">{t('decks.empty')}</p>
        )}
      </section>

      {/* ── Chequeos C1–C5 ─────────────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('canary.title')}</h2>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {report.canary.checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      </section>

      {/* ── Notas (conflictos manuales, pausados, errores) ─────────────────────────────────── */}
      <Notes report={report} />
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <dt className="font-medium text-text">{label}:</dt>
      <dd className="tabular">{value}</dd>
    </span>
  );
}

/** Columnas de la tabla por deck. En llano: nombre, rank, % del meta, cartas y casadas. */
function deckColumns(t: ReturnType<typeof useTranslations>): Column<DecksMetaDeckReport>[] {
  return [
    {
      key: 'deck',
      header: t('columns.deck'),
      render: (d) => (
        <span className="flex flex-col">
          <span lang="en" className="font-medium text-text">{d.name ?? d.archetypeId}</span>
          {d.error && <span className="text-xs text-accent">{t('deckError', { error: d.error })}</span>}
        </span>
      ),
    },
    {
      key: 'rank',
      header: t('columns.rank'),
      align: 'right',
      render: (d) => <span className="tabular">{d.rank != null ? `#${d.rank}` : '—'}</span>,
    },
    {
      key: 'share',
      header: t('columns.share'),
      align: 'right',
      render: (d) => <span className="tabular">{d.sharePct != null ? `${d.sharePct}%` : '—'}</span>,
    },
    {
      key: 'cardsParsed',
      header: t('columns.cardsParsed'),
      align: 'right',
      numeric: true,
      render: (d) => <span className="tabular">{d.cardsParsed}</span>,
    },
    {
      key: 'sumQuantity',
      header: t('columns.sumQuantity'),
      align: 'right',
      render: (d) => (
        <span className={`inline-flex items-center gap-1 tabular font-medium ${d.inBand ? 'text-success' : 'text-accent'}`}>
          {d.sumQuantity}
          {d.inBand && <Check size={14} aria-label={t('sumOk')} />}
        </span>
      ),
    },
    {
      key: 'matched',
      header: t('columns.matched'),
      align: 'right',
      render: (d) => <span className="tabular">{d.matched}/{d.total}</span>,
    },
  ];
}

/** Una fila de chequeo: rótulo humano + ✓/✗ + medido vs umbral. */
function CheckRow({ check }: { check: DecksMetaCanaryCheck }) {
  const t = useTranslations('admin.decksMetaRefresh');
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-text">
        {check.ok ? (
          <Check size={16} className="text-success" aria-label={t('canary.ok')} />
        ) : (
          <X size={16} className="text-accent" aria-label={t('canary.fail')} />
        )}
        {t(`checks.${check.id}`)}
      </span>
      <span className="tabular text-xs text-muted">
        {t('canary.measured', { measured: check.measured, threshold: check.threshold })}
      </span>
    </li>
  );
}

/** Conflictos y avisos operativos. Sólo se pinta lo que trae contenido; si nada, un «sin notas». */
function Notes({ report }: { report: DecksMetaRefreshReport }) {
  const t = useTranslations('admin.decksMetaRefresh');
  const has =
    report.manualConflicts.length > 0 ||
    report.pausedSkipped.length > 0 ||
    report.errors.length > 0;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('notes.title')}</h2>
      {!has ? (
        <p className="text-sm text-muted">{t('notes.none')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {report.manualConflicts.length > 0 && (
            <NoteList title={t('notes.manualConflicts')} items={report.manualConflicts} />
          )}
          {report.pausedSkipped.length > 0 && (
            <NoteList title={t('notes.pausedSkipped')} items={report.pausedSkipped} />
          )}
          {report.errors.length > 0 && (
            <NoteList title={t('notes.errors')} items={report.errors} tone="accent" />
          )}
        </div>
      )}
    </section>
  );
}

function NoteList({ title, items, tone }: { title: string; items: string[]; tone?: 'accent' }) {
  return (
    <div className="flex flex-col gap-1">
      <p className={`text-sm font-medium ${tone === 'accent' ? 'text-accent' : 'text-text'}`}>{title}</p>
      <ul className="list-disc pl-5 text-sm text-muted">
        {items.map((it, i) => (
          <li key={`${it}-${i}`} className="break-words">{it}</li>
        ))}
      </ul>
    </div>
  );
}
