import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import es from '../../../../../messages/es.json';
import en from '../../../../../messages/en.json';

/*
 * §E4/§E6 — las páginas de contenido renderizadas COMO LAS SIRVE NEXT (el componente de servidor
 * entero, con sus traducciones reales), y el candado del brief: el texto del JSON-LD es IDÉNTICO al
 * visible, y «Última revisión: <fecha>» se ve.
 */
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: locale === 'en' ? en : es, namespace } as never),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import PreguntasPage from '../preguntas/page';
import ComoFuncionaPage from '../como-funciona/page';
import GuiasPage from '../guias/page';
import GuiaPage, { generateStaticParams } from '../guias/[slug]/page';

type Graph = { '@graph': Record<string, unknown>[] };

function jsonLdOf(container: HTMLElement): Graph {
  const scripts = container.querySelectorAll('script[type="application/ld+json"]');
  expect(scripts).toHaveLength(1);
  return JSON.parse(scripts[0].innerHTML) as Graph;
}

function node(graph: Graph, type: string): Record<string, unknown> | undefined {
  return graph['@graph'].find((n) => n['@type'] === type);
}

function params(locale: string): Promise<{ locale: string }>;
function params<E extends Record<string, string>>(
  locale: string,
  extra: E,
): Promise<{ locale: string } & E>;
function params(locale: string, extra: Record<string, string> = {}) {
  return Promise.resolve({ locale, ...extra });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T18:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('/preguntas (§E4)', () => {
  it.each(['es', 'en'])('%s: FAQPage idéntico al texto visible, pregunta por pregunta', async (locale) => {
    const { container } = render(await PreguntasPage({ params: params(locale) }));
    const visibleQ = [...container.querySelectorAll('[data-faq-question]')].map((e) => e.textContent);
    const visibleA = [...container.querySelectorAll('[data-faq-answer]')].map((e) => e.textContent);
    const faq = node(jsonLdOf(container), 'FAQPage') as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(visibleQ).toHaveLength(23);
    expect(faq.mainEntity.map((q) => q.name)).toEqual(visibleQ);
    expect(faq.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(visibleA);
  });

  it('«Última revisión: <fecha>» visible + BreadcrumbList con URL absolutas', async () => {
    const { container, getByText } = render(await PreguntasPage({ params: params('es') }));
    expect(getByText('Última revisión: 2026-10-11 · manual v5')).toBeVisible();
    const bc = node(jsonLdOf(container), 'BreadcrumbList') as {
      itemListElement: { item: string }[];
    };
    expect(bc.itemListElement.map((i) => i.item)).toEqual([
      'https://tcghunt.mx/es',
      'https://tcghunt.mx/es/preguntas',
    ]);
  });

  it('en: aviso en inglés de que el contenido está en español', async () => {
    const { getByText } = render(await PreguntasPage({ params: params('en') }));
    expect(getByText('This content is available in Spanish only.')).toHaveAttribute('lang', 'en');
    expect(getByText('Last reviewed: 2026-10-11 · manual v5')).toBeVisible();
  });

  it('con todas las FAQ vencidas: estado vacío y SIN FAQPage', async () => {
    vi.setSystemTime(new Date('2026-11-12T18:00:00Z'));
    const { container, getByRole } = render(await PreguntasPage({ params: params('es') }));
    expect(getByRole('status')).toHaveTextContent('Estamos revisando estas respuestas.');
    expect(node(jsonLdOf(container), 'FAQPage')).toBeUndefined();
  });
});

describe('/como-funciona (§E4)', () => {
  it('pinta las respuestas compuestas, «Última revisión» y WebPage sin FAQPage duplicado', async () => {
    const { container, getByText } = render(await ComoFuncionaPage({ params: params('es') }));
    expect(getByText('Última revisión: 2026-10-11 · manual v5')).toBeVisible();
    const text = container.textContent ?? '';
    expect(text).toContain('Cotizar es gratis, sin cuenta y sin compromiso.');
    expect(text).toContain('Su costo es una tarifa fija que se descuenta de lo que te pagamos');
    const graph = jsonLdOf(container);
    expect(node(graph, 'WebPage')).toMatchObject({ url: 'https://tcghunt.mx/es/como-funciona' });
    expect(node(graph, 'FAQPage')).toBeUndefined();
  });
});

describe('/guias (§E6)', () => {
  it('el índice enlaza las 4 guías', async () => {
    const { container } = render(await GuiasPage({ params: params('es') }));
    const hrefs = [...container.querySelectorAll('h2 a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/guias/que-es-nm',
      '/guias/carta-pirata-5-senales',
      '/guias/como-guardar-tus-cartas',
      '/guias/que-es-una-sir',
    ]);
  });

  it.each(generateStaticParams().map((p) => p.slug))(
    '%s: Article.headline = <h1>, fecha visible, cierre a catálogo o cotizador',
    async (slug) => {
      const { container, getByRole } = render(await GuiaPage({ params: params('es', { slug }) }));
      const h1 = getByRole('heading', { level: 1 }).textContent;
      const graph = jsonLdOf(container);
      const article = node(graph, 'Article') as { headline: string; datePublished: string };
      expect(article.headline).toBe(h1);
      expect(container.querySelector('[data-content-date]')).toHaveTextContent(
        `Publicada: ${article.datePublished}`,
      );
      const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(hrefs.some((h) => h === '/catalog' || h === '/buylist')).toBe(true);
      const bc = node(graph, 'BreadcrumbList') as { itemListElement: unknown[] };
      expect(bc.itemListElement).toHaveLength(3);
    },
  );

  it('R1: con P7 vencida, `que-es-nm` da 404 y sale del índice (se retira entera, no a medias)', async () => {
    vi.setSystemTime(new Date('2026-11-12T18:00:00Z'));
    await expect(GuiaPage({ params: params('es', { slug: 'que-es-nm' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    const { container } = render(await GuiasPage({ params: params('es') }));
    const hrefs = [...container.querySelectorAll('h2 a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/guias/que-es-nm');
    expect(hrefs).toHaveLength(3);
  });

  it('un slug que no es de las 4 ⇒ 404', async () => {
    await expect(GuiaPage({ params: params('es', { slug: 'inventada' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
