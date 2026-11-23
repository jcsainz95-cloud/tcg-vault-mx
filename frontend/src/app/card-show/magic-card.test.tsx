import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';

/* m-31/m-32 (QA 3ac8be4d/bccf2492): la tarjeta de Magic pinta patrocinio e inscripción desde el contenido, con enlaces seguros. */
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('./_components/TournamentCounter', () => ({ TournamentCounter: () => null }));
vi.mock('./_components/RegistrationForms', () => ({ RegistrationForms: () => null }));
vi.mock('./_components/CardShowMotion', () => ({ CardShowMotion: () => null }));
vi.mock('./_components/HeroExplosion', () => ({ HeroExplosion: () => null }));

import CardShowPage from './page';

afterEach(cleanup);

async function magicCard() {
  const { container } = render(await CardShowPage());
  const h3 = Array.from(container.querySelectorAll('h3')).find((h) => h.textContent === 'Magic: The Gathering');
  if (!h3 || !h3.parentElement) throw new Error('falta la tarjeta de Magic');
  return within(h3.parentElement as HTMLElement);
}

describe('Card Show · tarjeta de Magic', () => {
  it('patrocinio: «Patrocinado por bracket3.net y TCG Wolf» con enlace externo seguro', async () => {
    const card = await magicCard();
    const p = card.getByText(/Patrocinado por/).closest('p') as HTMLElement;
    expect(p.textContent).toBe('Patrocinado por bracket3.net y TCG Wolf');
    const a = within(p).getByRole('link', { name: 'bracket3.net' });
    expect(a).toHaveAttribute('href', 'https://bracket3.net');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('inscripción: texto exacto y enlace externo seguro', async () => {
    const card = await magicCard();
    const p = card.getByText(/Revisa tu deck/).closest('p') as HTMLElement;
    expect(p.textContent).toBe('Revisa tu deck e inscríbete en bracket3.net.');
    const a = within(p).getByRole('link', { name: 'bracket3.net' });
    expect(a).toHaveAttribute('href', 'https://bracket3.net');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('m-33 (JC 2026-11-23): el formato se lee «Commander Bracket 3 · 1v1», sin `uppercase`, en la tarjeta y en el programa', async () => {
    const { container } = render(await CardShowPage());
    const els = Array.from(container.querySelectorAll('p')).filter((p) => p.textContent === 'Commander Bracket 3 · 1v1');
    expect(els).toHaveLength(2); // tarjeta de Magic + programa del sábado
    for (const el of els) {
      expect(el.textContent).toContain('1v1');
      expect(el.className).not.toMatch(/\buppercase\b/);
    }
  });
});
