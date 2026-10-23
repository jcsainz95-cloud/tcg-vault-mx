import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

/*
 * MKT-E5 — JSON-LD `Event` del Card Show: se EMITE en la página de servidor, es JSON válido, los datos son los de
 * `content/card-show.ts` y no lleva nada secreto ni no anunciado (patrocinadores, precio, premios por anunciar).
 */
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
// Islas de cliente que tocan red/`IntersectionObserver`: aquí solo se mide el HTML de servidor.
vi.mock('./_components/TournamentCounter', () => ({ TournamentCounter: () => null }));
vi.mock('./_components/RegistrationForms', () => ({ RegistrationForms: () => null }));
vi.mock('./_components/CardShowMotion', () => ({ CardShowMotion: () => null }));
vi.mock('./_components/HeroExplosion', () => ({ HeroExplosion: () => null })); // `<canvas>`: jsdom no lo implementa

import { CARD_SHOW, CARD_SHOW_GAMES } from '@/content/card-show';
import { JsonLd } from '@/components/seo/JsonLd';
import CardShowPage from './page';
import { cardShowDates, cardShowEventJsonLd } from './event-jsonld';

afterEach(() => cleanup());

function ldScripts(container: HTMLElement): HTMLScriptElement[] {
  return [...container.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')];
}

/** Todas las claves del objeto, a cualquier profundidad. */
function allKeys(o: unknown): string[] {
  if (Array.isArray(o)) return o.flatMap(allKeys);
  if (typeof o !== 'object' || o === null) return [];
  return Object.entries(o).flatMap(([k, v]) => [k, ...allKeys(v)]);
}

describe('MKT-E5 · JSON-LD Event del Card Show', () => {
  it('la página de servidor emite UN bloque JSON-LD, JSON válido, de tipo Event e igual al builder', async () => {
    const { container } = render(await CardShowPage());
    const scripts = ldScripts(container);
    expect(scripts).toHaveLength(1);
    const ld = JSON.parse(scripts[0].innerHTML) as Record<string, unknown>;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Event');
    expect(ld).toEqual(cardShowEventJsonLd());
    // `<` escapado: ningún `<` crudo dentro del <script> (XSS clásico de JSON-LD).
    expect(scripts[0].innerHTML).not.toContain('<');
  });

  it('`<` se escapa como en el resto del JSON-LD: un `</script>` en un texto no cierra la etiqueta', () => {
    const evil = { ...cardShowEventJsonLd(), description: '</script><script>alert(1)</script>' };
    const { container } = render(<JsonLd data={evil} />);
    const [s] = ldScripts(container);
    expect(s.innerHTML).not.toContain('</script');
    expect(s.innerHTML).toContain('\\u003c/script>');
    expect(JSON.parse(s.innerHTML)).toEqual(evil);
  });

  it('fechas, sede, juegos y organizadores salen de content/card-show.ts', () => {
    const ld = cardShowEventJsonLd() as {
      startDate: string;
      endDate: string;
      url: string;
      isAccessibleForFree: boolean;
      location: { name: string; address: Record<string, string> };
      organizer: { name: string }[];
      about: { name: string }[];
    };
    expect(cardShowDates()).toEqual({ startDate: '2026-12-05T11:00:00-06:00', endDate: '2026-12-06T18:00:00-06:00' });
    expect(ld.startDate).toBe(CARD_SHOW.countdownTargetIso);
    expect(ld.url).toBe(CARD_SHOW.canonicalUrl);
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.location.name).toBe(CARD_SHOW.hero.sede);
    expect(ld.location.address).toMatchObject({
      streetAddress: CARD_SHOW.evento.direccion.calle,
      addressLocality: 'Benito Juárez',
      postalCode: '03900',
      addressRegion: 'CDMX',
      addressCountry: 'MX',
    });
    expect(ld.organizer.map((o) => o.name)).toEqual(['TCG HUNT', CARD_SHOW.colaborador.nombre]);
    expect(ld.about.map((g) => g.name)).toEqual(CARD_SHOW_GAMES.map((g) => g.label));
  });

  it('sin campos secretos ni no anunciados: ni patrocinador, ni precio/oferta, ni premios, ni montaje, ni enlaces del colaborador', () => {
    const ld = cardShowEventJsonLd();
    const keys = allKeys(ld).map((k) => k.toLowerCase());
    for (const banned of ['sponsor', 'funder', 'offers', 'price', 'pricecurrency', 'performer', 'sameas', 'award']) {
      expect(keys, `campo «${banned}» en el JSON-LD`).not.toContain(banned);
    }
    const blob = JSON.stringify(ld);
    expect(blob).not.toMatch(/patrocin|sponsor/i);
    expect(blob).not.toMatch(/\$\s?\d|MX\$|MXN/);
    expect(blob).not.toMatch(/por anunciar|se confirma|montaje|premio/i);
    // Ninguna URL ajena: solo el dominio propio.
    for (const u of blob.match(/https?:\/\/[^"]+/g) ?? []) {
      expect(u, u).toMatch(/^https:\/\/(tcghunt\.mx|schema\.org)(\/|$)/);
    }
  });

  it('con CARDSHOW_SECRET_TERMS (CI): ningún término secreto en el JSON-LD', () => {
    const raw = process.env.CARDSHOW_SECRET_TERMS ?? '';
    const terms = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const blob = JSON.stringify(cardShowEventJsonLd()).toLowerCase();
    // ⛔ Mensaje genérico: nunca imprime el término.
    expect(terms.filter((t) => blob.includes(t)).length, 'un término secreto apareció en el JSON-LD').toBe(0);
  });
});
