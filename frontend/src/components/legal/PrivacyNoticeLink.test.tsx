// @vitest-environment jsdom
/**
 * LIVE-8 · `PrivacyNoticeLink` (DESIGN_SYSTEM §80.1, §80.6; API_CONTRACT v1.84.1 §14.14 E-9).
 * Candados UX-PRIV-1…5 de §80.6 y el cierre del riesgo F-7.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { stripComments } from '@/test/strip-comments';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import { privacyNoticeWithMarkers } from '@/content/legal/test-fixtures';
import { findLegalMarkers } from '@/content/legal/legal-gate';
import { privacyLinkVisible } from '@/app/[locale]/(storefront)/footer';
import { PrivacyLinkProvider, PrivacyNoticeLink, PrivacySiteNote } from './PrivacyNoticeLink';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const SITES = ['register', 'googleSignIn', 'checkout', 'sellForm', 'accountIne'] as const;

function plain(s: string) {
  return s.replace(/<\/?(terms|privacy)>/g, '');
}

afterEach(() => vi.unstubAllEnvs());

describe('UX-PRIV-1 · inline con la página servida', () => {
  for (const site of SITES) {
    it(`${site}: <a href=/privacidad> en pestaña nueva, rel noopener, aviso para lector, frase entera`, () => {
      renderWithIntl(
        <PrivacyLinkProvider linked>
          <PrivacySiteNote site={site} />
        </PrivacyLinkProvider>,
      );
      const p = screen.getByTestId(`privacy-site-${site}`);
      const a = p.querySelector('a[href="/privacidad"]') as HTMLAnchorElement;
      expect(a).not.toBeNull();
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel') ?? '').toMatch(/\bnoopener\b/);
      expect(a.textContent).toContain('Aviso de privacidad');
      expect(a.textContent).toContain('(se abre en otra pestaña)');
      expect(a.querySelector('.sr-only')?.textContent?.trim()).toBe('(se abre en otra pestaña)');
      expect(a.querySelector('svg')).toHaveAttribute('aria-hidden');
      // La frase es la de la clave, sin quitar ni añadir palabras (salvo el aviso oculto).
      const visible = p.textContent!.replace(/\s*\(se abre en otra pestaña\)/g, '');
      expect(visible).toBe(plain((es.privacy.sites as Record<string, string>)[site]));
    });
  }

  it('«Términos» de la misma frase (register, googleSignIn) se comporta igual: pestaña nueva y aviso', () => {
    renderWithIntl(
      <PrivacyLinkProvider linked>
        <PrivacySiteNote site="register" />
      </PrivacyLinkProvider>,
    );
    const a = screen.getByTestId('privacy-site-register').querySelector('a[href="/terminos"]')!;
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.textContent).toContain('(se abre en otra pestaña)');
  });

  it('en inglés: «Privacy notice (opens in a new tab)»', () => {
    renderWithIntl(
      <PrivacyLinkProvider linked>
        <PrivacySiteNote site="checkout" />
      </PrivacyLinkProvider>,
      'en',
    );
    const a = screen.getByTestId('privacy-site-checkout').querySelector('a[href="/privacidad"]')!;
    expect(a.textContent).toBe('Privacy notice (opens in a new tab)');
  });
});

describe('UX-PRIV-2 · inline con la página NO servida', () => {
  for (const site of SITES) {
    it(`${site}: el mismo texto, sin <a> al aviso, sin aviso de pestaña`, () => {
      renderWithIntl(
        <PrivacyLinkProvider linked={false}>
          <PrivacySiteNote site={site} />
        </PrivacyLinkProvider>,
      );
      const p = screen.getByTestId(`privacy-site-${site}`);
      expect(p.querySelector('a[href="/privacidad"]')).toBeNull();
      // Términos (si la frase lo lleva) sigue enlazado; el trozo del aviso no lleva aviso de pestaña.
      const visible = p.textContent!.replace(/\s*\(se abre en otra pestaña\)/g, '');
      expect(visible).toBe(plain((es.privacy.sites as Record<string, string>)[site]));
      expect(p.querySelector('[data-privacy-link="off"]')?.textContent).toBe('Aviso de privacidad');
    });
  }

  it('sin proveedor ⇒ sin enlace (falla hacia lo seguro)', () => {
    renderWithIntl(<PrivacySiteNote site="checkout" />);
    expect(screen.getByTestId('privacy-site-checkout').querySelector('a')).toBeNull();
  });
});

describe('UX-PRIV-3 · nav', () => {
  it('sin página ⇒ cero nodos', () => {
    const { container } = renderWithIntl(
      <PrivacyLinkProvider linked={false}>
        <PrivacyNoticeLink variant="nav" />
      </PrivacyLinkProvider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('con página ⇒ <a href=/privacidad> en la MISMA pestaña, texto privacy.link, sin icono', () => {
    renderWithIntl(
      <PrivacyLinkProvider linked>
        <PrivacyNoticeLink variant="nav" className="text-text hover:text-accent" />
      </PrivacyLinkProvider>,
    );
    const a = screen.getByRole('link', { name: 'Aviso de privacidad' });
    expect(a).toHaveAttribute('href', '/privacidad');
    expect(a).not.toHaveAttribute('target');
    expect(a.querySelector('svg')).toBeNull();
    expect(a).toHaveClass('text-text');
  });
});

describe('UX-PRIV-4 · el enlace inline va subrayado (el color solo no lo distingue, §80.4)', () => {
  it('clase underline en el enlace al aviso y en el de términos', () => {
    renderWithIntl(
      <PrivacyLinkProvider linked>
        <PrivacySiteNote site="register" />
      </PrivacyLinkProvider>,
    );
    for (const href of ['/privacidad', '/terminos']) {
      const a = screen.getByTestId('privacy-site-register').querySelector(`a[href="${href}"]`)!;
      expect(a.className.split(/\s+/), href).toContain('underline');
      expect(a.className, href).not.toMatch(/outline-none/);
    }
  });
});

describe('UX-PRIV-5 · paridad ES/EN de privacy.sites.* (mismas claves, mismas etiquetas)', () => {
  const tags = (s: string) => (s.match(/<\/?(terms|privacy)>/g) ?? []).join('');
  it('mismas claves, en el mismo orden', () => {
    expect(Object.keys(en.privacy.sites)).toEqual(Object.keys(es.privacy.sites));
    expect(Object.keys(es.privacy.sites)).toEqual([...SITES]);
  });
  it('cada clave lleva las mismas etiquetas <terms>/<privacy> en los dos idiomas, y siempre <privacy>', () => {
    for (const k of SITES) {
      const a = (es.privacy.sites as Record<string, string>)[k];
      const b = (en.privacy.sites as Record<string, string>)[k];
      expect(tags(b), k).toBe(tags(a));
      expect(tags(a), k).toContain('<privacy></privacy>');
    }
  });
  it('opensInNewTab en los dos idiomas', () => {
    expect(es.privacy.opensInNewTab).toBe('(se abre en otra pestaña)');
    expect(en.privacy.opensInNewTab).toBe('(opens in a new tab)');
  });
});

describe('F-7 (§80.6) · la decisión viaja del servidor; el cliente no lee VERCEL_ENV', () => {
  it('vista previa con el texto CON marcadores ⇒ la frase enlaza, igual que el pie, aunque el «navegador» no tenga VERCEL_ENV', () => {
    // Un texto con marcadores (fixture: el aviso real ya es provisional sin marcadores, §14.17) es
    // justo el caso del riesgo.
    const marked = privacyNoticeWithMarkers();
    expect(findLegalMarkers(marked).length).toBeGreaterThan(0);
    // Servidor de la vista previa: la decisión del pie.
    const serverDecision = privacyLinkVisible({ vercelEnv: 'preview', nodeEnv: 'production' }, marked);
    expect(serverDecision).toBe(true);
    // «Navegador»: ninguna variable de Vercel (no se exponen al cliente) y NODE_ENV de producción.
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LEGAL_DRAFT_PREVIEW', '');
    renderWithIntl(
      <PrivacyLinkProvider linked={serverDecision}>
        <PrivacySiteNote site="accountIne" />
        <PrivacyNoticeLink variant="nav" />
      </PrivacyLinkProvider>,
    );
    expect(screen.getByTestId('privacy-site-accountIne').querySelector('a[href="/privacidad"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Aviso de privacidad' })).toHaveAttribute('href', '/privacidad');
  });

  it('producción con marcadores ⇒ ni la frase ni el pie enlazan', () => {
    const serverDecision = privacyLinkVisible(
      { vercelEnv: 'production', nodeEnv: 'production' },
      privacyNoticeWithMarkers(),
    );
    expect(serverDecision).toBe(false);
    renderWithIntl(
      <PrivacyLinkProvider linked={serverDecision}>
        <PrivacySiteNote site="accountIne" />
        <PrivacyNoticeLink variant="nav" />
      </PrivacyLinkProvider>,
    );
    expect(document.querySelector('a[href="/privacidad"]')).toBeNull();
  });

  it('⛔ el componente de cliente no lee process.env ni importa el módulo legal (ni el aviso entero al paquete)', () => {
    const src = stripComments(readFileSync(join(__dirname, 'PrivacyNoticeLink.tsx'), 'utf8'), 'PrivacyNoticeLink.tsx');
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(src).not.toMatch(/process\.env/);
    expect(imports.join('\n')).not.toMatch(/content\/legal|footer|legal-gate|privacidad/);
  });

  it('el layout de [locale] (servidor) pasa privacyLinkVisible() al proveedor', () => {
    const src = readFileSync(join(__dirname, '../../app/[locale]/layout.tsx'), 'utf8');
    expect(src).toMatch(/<PrivacyLinkProvider linked=\{privacyLinkVisible\(\)\}>/);
    expect(src).not.toMatch(/^'use client'/m);
  });
});
