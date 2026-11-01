/**
 * Datos de torneos del Card Show (dueño JC, chat 2026-10-21; API_CONTRACT §CARDSHOW.1a-quater M-90).
 */
import { describe, expect, it } from 'vitest';
import { CARD_SHOW, CARD_SHOW_GAMES, cardShowGameLabel } from './card-show';

const all = JSON.stringify(CARD_SHOW);

describe('card-show · torneos (JC 2026-10-21)', () => {
  it('cinco juegos; Magic con valor `magic` y nombre «Magic: The Gathering»', () => {
    expect(CARD_SHOW_GAMES.map((g) => g.id)).toEqual(['pokemon', 'riftbound', 'lorcana', 'shardbugs', 'magic']);
    expect(cardShowGameLabel('magic')).toBe('Magic: The Gathering');
    expect(CARD_SHOW.torneos.juegos.map((j) => j.id).sort()).toEqual(
      ['lorcana', 'magic', 'pokemon', 'riftbound', 'shardbugs'],
    );
  });

  it('sin horarios preliminares ni «cuatro juegos»', () => {
    expect(all).not.toMatch(/preliminar/i);
    expect(all).not.toMatch(/12:00|17:00–|cuatro juegos/i);
  });

  it('programa: Pokémon 14:00–18:00 MX$200 cupo 64 ambos días; los demás 11:00–14:00 gratis cupo 32', () => {
    const [sat, sun] = CARD_SHOW.torneos.programa;
    expect(sat.id).toBe('sat');
    expect(sun.id).toBe('sun');
    expect(sat.torneos.map((t) => t.id)).toEqual(['magic', 'shardbugs', 'pokemon']);
    expect(sun.torneos.map((t) => t.id)).toEqual(['lorcana', 'riftbound', 'pokemon']);
    for (const d of [sat, sun]) {
      for (const t of d.torneos) {
        if (t.id === 'pokemon') expect(t).toMatchObject({ horas: '14:00–18:00', precio: 'MX$200', cupo: 64 });
        else expect(t).toMatchObject({ horas: '11:00–14:00', precio: 'Gratis', cupo: 32, premios: ['Premios por anunciar'] });
      }
    }
  });

  it('premios Pokémon por día, tal como los dio el dueño', () => {
    const premios = (i: number) => CARD_SHOW.torneos.programa[i].torneos.find((t) => t.id === 'pokemon')!.premios;
    expect(premios(0)).toEqual([
      '1.º Ultra Premium Collection 30 aniversario',
      '2.º Elite Trainer Box 30 aniversario',
      '3.º Poster Collection',
    ]);
    expect(premios(1)).toEqual(['1.º Elite Trainer Box 30 aniversario', '2.º Poster Collection 30 aniversario']);
  });

  it('registro final en el lugar: en la sección de torneos y en la FAQ; FAQ de costos', () => {
    expect(CARD_SHOW.torneos.registroFinal).toMatch(/registro final en el lugar/);
    const faq = CARD_SHOW.faq.map((f) => f.a).join(' ');
    expect(faq).toMatch(/registro final en el lugar/);
    const costo = CARD_SHOW.faq.find((f) => /cuesta/.test(f.q))!.a;
    expect(costo).toMatch(/Pokémon cuesta MX\$200/);
    expect(costo).toMatch(/Magic: The Gathering.*son gratis/);
  });
});

describe('card-show · pie: WhatsApp de la fuente única (TL-MKT6-4)', () => {
  it('el pie muestra y enlaza el mismo número que «Quiénes somos» (lib/about.ts)', () => {
    expect(CARD_SHOW.footer.whatsappDisplay).toBe('55 6489 3921');
    expect(CARD_SHOW.footer.whatsappHref).toBe('https://wa.me/525564893921');
  });
});
