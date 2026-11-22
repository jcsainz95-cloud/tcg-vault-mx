'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  NOTE_MAX_LENGTH,
  createAdminUserNote,
  deleteAdminUserNote,
  getAdminUserNotes,
  updateAdminUserNote,
  type NoteDTO,
} from '@/lib/api/customer-file';
import { ApiClientError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Textarea } from '@/components/ui/Textarea';
import { Skeleton } from '@/components/ui/Skeleton';

const RECENT = 3;

/** Código de error del servidor (real: `ApiClientError.code`; mock: `Error.message`). */
function errorCode(e: unknown): string | null {
  if (e instanceof ApiClientError) return e.code ?? null;
  if (e instanceof Error) return e.message;
  return null;
}

/**
 * §FICHA-CLIENTE §1b — notas internas del cliente. Solo texto plano: se pinta como texto de React (nunca HTML) y los
 * saltos de línea se conservan con CSS. Permisos: `canEdit` lo manda el servidor (el front no decide).
 * ⛔ El texto de las notas no va a logs, URL, `localStorage` ni medición.
 */
export function NotesPanel({ userId }: { userId: string }) {
  const t = useTranslations('admin.m6.ficha.notes');
  const tf = useTranslations('admin.m6.ficha');
  const qc = useQueryClient();
  const locale = useLocale() as AppLocale;
  const key = ['admin-user-notes', userId, 'pages'];
  // El servidor pagina con `cursor`/`limit` (máx. 50; tope 200 notas por cliente): se sigue `nextCursor` hasta agotarlo.
  const notes = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getAdminUserNotes(userId, { limit: 50, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftPinned, setDraftPinned] = useState(false);
  // Un solo id por intento: el doble clic y el reintento repiten el MISMO `clientRequestId` (idempotente).
  const reqId = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-user-notes', userId] });

  const create = useMutation({
    mutationFn: () => {
      reqId.current ??= globalThis.crypto.randomUUID();
      return createAdminUserNote(userId, { body: draft.trim(), pinned: draftPinned || undefined, clientRequestId: reqId.current });
    },
    onSuccess: () => {
      reqId.current = null;
      setDraft('');
      setDraftPinned(false);
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body?: string; pinned?: boolean }) =>
      updateAdminUserNote(userId, v.id, { body: v.body, pinned: v.pinned }),
    onSuccess: () => {
      setEditingId(null);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAdminUserNote(userId, id),
    onSuccess: () => {
      setConfirmDeleteId(null);
      void refresh();
    },
  });

  const all = notes.data?.pages.flatMap((pg) => pg.items) ?? [];
  const pinned = all.filter((n) => n.pinned);
  const rest = all.filter((n) => !n.pinned);
  const visible = showAll ? all : [...pinned, ...rest.slice(0, RECENT)];
  const hidden = all.length - visible.length;

  const draftLen = draft.trim().length;
  const canAdd = draftLen >= 1 && draft.length <= NOTE_MAX_LENGTH;

  function errorText(e: unknown): string {
    const c = errorCode(e);
    if (c === 'FORBIDDEN') return t('forbidden');
    if (c === 'NOTE_LIMIT') return t('limit');
    if (c === 'VALIDATION_ERROR') return t('tooLong');
    return t('saveError');
  }
  const mutationError = create.error ?? update.error ?? remove.error;

  function renderNote(n: NoteDTO) {
    const author = n.authorName ?? t('unknownAuthor');
    const editing = editingId === n.id;
    return (
      <li key={n.id} data-testid="note-item" className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          {n.pinned && <span className="text-accent">{t('pinned')}</span>}
          <span>{author}</span>
          <span>{formatDate(n.createdAt, locale)}</span>
          {n.edited && <span>{t('edited')}</span>}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              label={t('editLabel')}
              value={editText}
              rows={3}
              maxLength={NOTE_MAX_LENGTH + 200}
              counter={{ max: NOTE_MAX_LENGTH }}
              onChange={(e) => setEditText(e.target.value)}
              error={editText.length > NOTE_MAX_LENGTH ? t('tooLong') : undefined}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={update.isPending}
                disabled={!editText.trim() || editText.length > NOTE_MAX_LENGTH}
                onClick={() => update.mutate({ id: n.id, body: editText.trim() })}
              >
                {t('save')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : (
          // Texto plano: React escapa todo; `pre-wrap` conserva los saltos de línea.
          <p className="whitespace-pre-wrap break-words text-sm text-text" data-testid="note-body">
            {n.body}
          </p>
        )}
        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={n.pinned ? t('unpin') : t('pinNote', { author })}
              onClick={() => update.mutate({ id: n.id, pinned: !n.pinned })}
            >
              {n.pinned ? t('unpin') : t('pin')}
            </Button>
            {n.canEdit && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingId(n.id);
                    setEditText(n.body);
                  }}
                >
                  {t('edit')}
                </Button>
                {confirmDeleteId === n.id ? (
                  <span className="flex flex-wrap items-center gap-2" role="alert">
                    <span className="text-xs text-muted">{t('deleteQuestion')}</span>
                    <Button size="sm" variant="destructive" loading={remove.isPending} onClick={() => remove.mutate(n.id)}>
                      {t('deleteConfirm')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>
                      {t('cancel')}
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(n.id)}>
                    {t('delete')}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="notes-panel">
      <p className="text-xs text-muted">{t('hint')}</p>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd && !create.isPending) create.mutate();
        }}
      >
        <Textarea
          label={t('label')}
          placeholder={t('placeholder')}
          value={draft}
          rows={3}
          counter={{ max: NOTE_MAX_LENGTH }}
          onChange={(e) => setDraft(e.target.value)}
          error={draft.length > NOTE_MAX_LENGTH ? t('tooLong') : undefined}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={draftPinned} onChange={(e) => setDraftPinned(e.target.checked)} />
            {t('pin')}
          </label>
          <Button type="submit" size="sm" loading={create.isPending} disabled={!canAdd}>
            {t('add')}
          </Button>
        </div>
      </form>

      {mutationError && (
        <Banner variant="danger" role="alert">
          {errorText(mutationError)}
        </Banner>
      )}

      {notes.isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : notes.isError ? (
        <div className="flex items-center gap-3 text-sm text-muted" role="alert">
          <span>{t('loadError')}</span>
          <Button size="sm" variant="secondary" onClick={() => notes.refetch()}>
            {tf('retry')}
          </Button>
        </div>
      ) : all.length === 0 ? (
        <p className="text-sm text-muted">{t('empty')}</p>
      ) : (
        <>
          <ul aria-label={t('list')} className="flex flex-col">
            {visible.map(renderNote)}
          </ul>
          {(hidden > 0 || showAll) && all.length > pinned.length + RECENT && (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t('seeLess') : t('seeAll', { count: all.length })}
            </Button>
          )}
          {notes.hasNextPage && (
            <Button size="sm" variant="secondary" className="self-start" loading={notes.isFetchingNextPage} onClick={() => void notes.fetchNextPage()} data-testid="notes-load-more">
              {t('loadMore')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
