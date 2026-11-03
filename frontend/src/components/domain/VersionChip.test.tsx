/**
 * IDS-F6 (API_CONTRACT §IDS.9) — candados 5, 7 y 7b de IDS-UX.6 sobre la insignia y su catálogo de textos.
 *  (5) «sello» no aparece en textos de cliente (solo `admin`); el detalle «Prize Pack» no es una insignia ES.
 *  (7) paridad ES/EN del namespace `version`, incluidas las cinco claves de `FinishLabel` y los cinco `StampType`.
 *  (7b) las insignias no usan `uppercase` ni fuente mono.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import { FINISH_LABELS, STAMP_TYPES, CARD_LANGUAGES } from '@/types/contract';
import { VersionChips, StampChip, LanguageChip } from './VersionChip';

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}
function strings(obj: unknown, prefix = ''): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => strings(v, prefix ? `${prefix}.${k}` : k));
}

describe('VersionChip · textos D-6 v3 (IDS-UX.1)', () => {
  it('ES: «Español» relleno + «De liga» contorno, en ese orden; inglés sin liga = sin insignia', () => {
    const { container, rerender } = renderWithIntl(
      <VersionChips version={{ language: 'es', stamp: { type: 'prize_pack', label: 'Cosmos Holo', productId: 1 } }} />,
    );
    const chips = Array.from(container.querySelectorAll('[data-version-chip]'));
    expect(chips.map((c) => c.textContent)).toEqual(['Español', 'De liga']);
    expect(chips[0].getAttribute('data-version-chip')).toBe('language');
    expect(chips[0].className).toContain('bg-text');
    expect(chips[1].className).toContain('border-accent');
    expect(chips[1].className).toContain('text-accent');
    // el detalle del proveedor NO va en la insignia
    expect(container.textContent).not.toContain('Cosmos');
    rerender(<VersionChips version={{ language: 'en', stamp: null }} />);
    expect(screen.queryByTestId('version-chips')).toBeNull();
  });

  it('EN: «Spanish» + «Prize Pack»; liga antigua «League»; campeonato «Championship» (nunca «De liga»)', () => {
    renderWithIntl(
      <>
        <VersionChips testId="a" version={{ language: 'es', stamp: { type: 'prize_pack', label: null, productId: 1 } }} />
        <StampChip type="league" />
        <StampChip type="championship" />
      </>,
      'en',
    );
    expect(screen.getByTestId('a').textContent).toBe('SpanishPrize Pack');
    expect(screen.getByText('League')).toBeInTheDocument();
    expect(screen.getByText('Championship')).toBeInTheDocument();
  });

  it('ES: prerelease, Staff y campeonato NUNCA dicen «De liga»', () => {
    renderWithIntl(
      <>
        <StampChip type="prerelease" />
        <StampChip type="staff" />
        <StampChip type="championship" />
      </>,
    );
    expect(screen.getByText('Prerelease')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('De torneo')).toBeInTheDocument();
    expect(screen.queryByText('De liga')).toBeNull();
  });

  it('(7b) ninguna insignia lleva `uppercase` ni `font-mono`; rectas (sin rounded-*); nunca aria-hidden', () => {
    const { container } = renderWithIntl(
      <>
        <LanguageChip language="es" size="detail" />
        <StampChip type="prize_pack" size="sheet" />
        <StampChip type="staff" onInk />
      </>,
    );
    const chips = Array.from(container.querySelectorAll('[data-version-chip]'));
    expect(chips).toHaveLength(3);
    for (const c of chips) {
      const cls = c.className.split(/\s+/);
      expect(cls).not.toContain('uppercase');
      expect(cls).not.toContain('font-mono');
      expect(cls).toContain('normal-case');
      expect(cls.some((k) => k.startsWith('rounded'))).toBe(false);
      expect(c.getAttribute('aria-hidden')).toBeNull();
      expect(cls).toContain('whitespace-nowrap');
    }
  });
});

describe('IDS-F6 · catálogo de textos `version`', () => {
  it('(7) paridad ES/EN de los namespaces `version` y `versionDetail`', () => {
    expect(keyPaths(es.version).sort()).toEqual(keyPaths(en.version).sort());
    expect(keyPaths(es.versionDetail).sort()).toEqual(keyPaths(en.versionDetail).sort());
  });
  it('(7) las cinco claves de FinishLabel, los cinco StampType y los dos idiomas existen en ambos', () => {
    for (const [cat, catD] of [
      [es.version, es.versionDetail],
      [en.version, en.versionDetail],
    ] as const) {
      expect(Object.keys(cat.finishLabel).sort()).toEqual([...FINISH_LABELS].sort());
      expect(Object.keys(cat.chip).sort()).toEqual([...STAMP_TYPES].sort());
      expect(Object.keys(catD.long).sort()).toEqual([...STAMP_TYPES].sort());
      expect(Object.keys(catD.stampNote).sort()).toEqual([...STAMP_TYPES].sort());
      expect(Object.keys(cat.language).sort()).toEqual([...CARD_LANGUAGES].sort());
    }
  });
  it('vIDS-6: el acabado sin brillo es «No holo» y la versión sin liga «Sin liga» (⛔ «Normal»)', () => {
    expect(es.version.finishLabel.non_holo).toBe('No holo');
    expect(es.versionDetail.row.noStamp).toBe('Sin liga');
    expect(strings({ ...es.version, ...es.versionDetail }).filter(([, v]) => /\bnormal\b/i.test(v))).toEqual([]);
  });
  it('textos EN fijados por marketing: «LANGUAGE AND VERSION», «Spanish», «Prize Pack», «League», «Championship»', () => {
    expect(en.versionDetail.picker.label).toBe('LANGUAGE AND VERSION');
    expect(es.versionDetail.picker.label).toBe('IDIOMA Y VERSIÓN');
    expect(en.version.language.es).toBe('Spanish');
    expect(en.version.chip).toMatchObject({ prize_pack: 'Prize Pack', league: 'League', championship: 'Championship' });
  });
  it('(5) «sello» no existe en ningún texto de cliente (todo namespace salvo `admin`)', () => {
    for (const cat of [es, en] as Record<string, unknown>[]) {
      const offenders = Object.entries(cat)
        .filter(([ns]) => ns !== 'admin')
        .flatMap(([ns, v]) => strings(v, ns))
        .filter(([, v]) => /\bsellos?\b|\bstamped?\b/i.test(v))
        .map(([k]) => k);
      expect(offenders).toEqual([]);
    }
  });
});
