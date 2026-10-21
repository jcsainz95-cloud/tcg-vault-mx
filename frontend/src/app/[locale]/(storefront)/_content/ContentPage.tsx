import type { ReactNode } from 'react';
import type { PublicFaq } from '@/content/seo/faq.es';

/**
 * ⭐ §MKT tienda §E4/§E6 — armazón de las páginas de contenido (`/preguntas`, `/como-funciona`,
 * `/guias`). Mismo patrón que `/privacidad` (`PrivacyNoticeView`): `article lang="es"` porque el
 * texto solo existe en español; en `/en/…` se añade la línea «available in Spanish only» en inglés.
 * Componente de servidor sin hooks: recibe las cadenas ya resueltas.
 */
export function ContentPage({
  title,
  dateLine,
  spanishOnlyNotice,
  children,
}: {
  title: string;
  /** «Última revisión: …» / «Publicada: …» — visible, nunca oculta. */
  dateLine: string;
  /** Solo fuera de `es`. */
  spanishOnlyNotice?: string;
  children: ReactNode;
}) {
  return (
    <article lang="es" className="gutter mx-auto flex max-w-2xl flex-col gap-8 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-h1 font-bold">{title}</h1>
        <p data-content-date className="font-mono text-[11px] uppercase tracking-label text-muted">
          {dateLine}
        </p>
        {spanishOnlyNotice && (
          <p lang="en" className="text-sm text-muted">
            {spanishOnlyNotice}
          </p>
        )}
      </header>
      {children}
    </article>
  );
}

/**
 * Bloques de FAQ agrupados. La pregunta y la respuesta se pintan TAL CUAL (texto plano, sin
 * `<details>`: el texto visible es el mismo que va al `FAQPage`, y el sistema de diseño no esconde
 * contenido tras un clic). `data-faq-*` lo usa la prueba de paridad visible = JSON-LD.
 */
export function FaqGroups({
  groups,
}: {
  groups: readonly { group: string; faqs: readonly PublicFaq[] }[];
}) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.group} className="flex flex-col gap-5 border-t border-border pt-5">
          <h2 className="text-h3 font-semibold">{g.group}</h2>
          {g.faqs.map((f) => (
            <div key={f.id} id={f.id.toLowerCase()} className="flex flex-col gap-2">
              <h3 data-faq-question className="font-semibold text-text">
                {f.question}
              </h3>
              <p data-faq-answer className="text-sm leading-relaxed text-text/90">
                {f.answer}
              </p>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

export function EmptyContent({ message }: { message: string }) {
  return (
    <p role="status" className="border-t border-border pt-5 text-sm text-muted">
      {message}
    </p>
  );
}
