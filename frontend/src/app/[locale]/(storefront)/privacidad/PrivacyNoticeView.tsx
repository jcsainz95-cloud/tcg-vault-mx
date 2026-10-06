import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import type { LegalBlock, LegalDocument } from '@/content/legal/privacidad.es';

/**
 * LIVE-8 — pinta un documento legal de `src/content/legal/` (formato mínimo: `**negrita**` y
 * `[marcador]`). En borrador, cada marcador sale RESALTADO (`<mark data-legal-marker>`) y arriba va
 * el aviso «Borrador — no publicado»; publicado, no hay marcadores que pintar (el candado
 * `legal-gate.ts` lo garantiza). Lectura a una columna, como `/terminos`.
 */
function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]*\])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\[[^\]]*\]$/.test(part) ? (
          <mark
            key={i}
            data-legal-marker=""
            className="bg-warning-bg px-1 font-mono text-[0.85em] text-text outline outline-1 outline-accent"
          >
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={i} className="font-semibold text-text">
            <Marked text={part.slice(2, -2)} />
          </strong>
        ) : (
          <Marked key={i} text={part} />
        ),
      )}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === 'p') {
    return (
      <p className="text-sm leading-relaxed text-text/90">
        <Inline text={block.text} />
      </p>
    );
  }
  if (block.type === 'list') {
    return (
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-text/90">
        {block.items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border-strong">
            {block.head.map((h, i) => (
              <th key={i} scope="col" className="py-2 pr-4 font-mono text-[11px] uppercase tracking-label text-muted">
                <Inline text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-b border-border">
              {row.map((cell, c) => (
                <td key={c} className="py-2 pr-4 align-top text-text/90">
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PrivacyNoticeView({
  doc,
  draft,
  showSpanishOnly,
}: {
  doc: LegalDocument;
  draft: boolean;
  showSpanishOnly: boolean;
}) {
  const t = useTranslations('privacy');
  return (
    <article lang="es" className="gutter mx-auto flex max-w-2xl flex-col gap-8 py-10">
      {draft && (
        <Banner variant="warning" title={t('draftTitle')} role="alert">
          {t('draftBody')}
        </Banner>
      )}
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-h1 font-bold">{t('title')}</h1>
        <p className="font-mono text-[11px] uppercase tracking-label text-muted">
          {t('updated')} <Marked text={doc.updatedAt} />
        </p>
        {showSpanishOnly && (
          <p lang="en" className="text-sm text-muted">
            {t('spanishOnly')}
          </p>
        )}
        <p className="text-h3 font-semibold">
          <Marked text={doc.title} />
        </p>
      </header>
      {doc.sections.map((s) => (
        <section key={s.id} id={s.id} className="flex flex-col gap-3 border-t border-border pt-5">
          <h2 className="text-h3 font-semibold">
            <Marked text={s.title} />
          </h2>
          {s.blocks.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </section>
      ))}
    </article>
  );
}
