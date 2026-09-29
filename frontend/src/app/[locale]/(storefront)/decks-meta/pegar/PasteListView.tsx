'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { DeckMetaPasteResponse } from '@/types/contract';
import { pasteDeckList } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useErrorMessage } from '@/components/ui/QueryState';
import { DeckAvailability } from '../DeckAvailability';

export function PasteListView() {
  const t = useTranslations('decksMeta');
  const tc = useTranslations('common');
  const getErrorMessage = useErrorMessage();
  const [text, setText] = useState('');

  const mutation = useMutation<DeckMetaPasteResponse, unknown, string>({
    mutationFn: (value: string) => pasteDeckList(value),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(text);
  };

  const onClear = () => {
    setText('');
    mutation.reset();
  };

  return (
    <div className="gutter py-12">
      <header className="max-w-2xl">
        <h1 className="font-serif text-[32px] leading-[1.05] text-text lg:text-[42px]">{t('paste.title')}</h1>
        <p className="mt-3 text-[15px] leading-[1.7] text-muted">{t('paste.subtitle')}</p>
      </header>

      <form onSubmit={onSubmit} className="mt-8 max-w-2xl">
        <label htmlFor="deck-list" className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          {t('paste.label')}
        </label>
        <textarea
          id="deck-list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={t('paste.placeholder')}
          className="mt-2 w-full border border-border bg-bg p-4 font-mono text-[13px] leading-[1.6] text-text focus:border-text focus:outline-none"
        />
        <div className="mt-4 flex items-center gap-4">
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {t('paste.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClear} disabled={mutation.isPending && !text}>
            {t('paste.clear')}
          </Button>
        </div>
      </form>

      <div className="mt-10">
        {mutation.isPending && <p className="text-sm text-muted">{tc('loading')}</p>}

        {mutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {getErrorMessage(mutation.error)}
          </Banner>
        )}

        {mutation.data ? (
          <DeckAvailability groups={mutation.data.groups} />
        ) : (
          !mutation.isPending &&
          !mutation.isError && <EmptyState title={t('paste.emptyTitle')} body={t('paste.emptyBody')} />
        )}
      </div>

      <p className="mt-10 border-t border-border pt-5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
        <Link href="/decks-meta" className="underline underline-offset-4 hover:text-text">
          {t('detail.back')}
        </Link>
      </p>
    </div>
  );
}
