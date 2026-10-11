/**
 * LIVE-8 · candado del aviso de privacidad (PROJECT.md criterios 500/501, §LEG.3: «Nada de esto se
 * publica con marcadores»). LEG-1…LEG-4 de API_CONTRACT §14 (frontend).
 */
import { describe, expect, it } from 'vitest';
import { privacyNoticeEs, type LegalDocument } from './privacidad.es';
import { findLegalMarkers, privacyVisibility } from './legal-gate';
import { privacyNoticeWithMarkers } from './test-fixtures';

/** Fixture con marcadores (el aviso real ya no los tiene: modo provisional, §14.17). */
const MARKED = privacyNoticeWithMarkers();

const CLEAN: LegalDocument = {
  version: '1.0',
  pendingOwnerData: [],
  updatedAt: '5 de octubre de 2026',
  title: 'Aviso de privacidad integral — TCG HUNT',
  sections: [
    {
      id: 'responsable',
      title: '1. Quién es el responsable de tus datos.',
      blocks: [
        { type: 'p', text: '**Comercializadora Ejemplo S.A. de C.V.** con RFC **CEJ010101AAA**.' },
        { type: 'list', items: ['uno', 'dos'] },
        { type: 'table', head: ['a'], rows: [['b']] },
      ],
    },
  ],
};

function withText(text: string, where: 'title' | 'p' | 'list' | 'table' | 'updatedAt'): LegalDocument {
  const doc: LegalDocument = JSON.parse(JSON.stringify(CLEAN));
  if (where === 'updatedAt') doc.updatedAt = text;
  if (where === 'title') doc.sections[0].title = text;
  if (where === 'p') (doc.sections[0].blocks[0] as { text: string }).text = text;
  if (where === 'list') (doc.sections[0].blocks[1] as { items: string[] }).items.push(text);
  if (where === 'table') (doc.sections[0].blocks[2] as { rows: string[][] }).rows[0].push(text);
  return doc;
}

describe('LEG-1 · findLegalMarkers detecta cualquier marcador, esté donde esté', () => {
  it('texto limpio ⇒ sin marcadores', () => {
    expect(findLegalMarkers(CLEAN)).toEqual([]);
  });

  it.each([
    ['[DATO DEL DUEÑO: RFC]', 'p'],
    ['[FECHA DE PUBLICACIÓN]', 'updatedAt'],
    ['[Razón social pendiente]', 'list'],
    ['[Legal entity pending]', 'table'],
    ['nota para el abogado: confirmar', 'p'],
    ['Nota para el abogado', 'title'],
    ['SUPUESTO / default', 'list'],
    ['BORRADOR', 'title'],
    ['dato del dueño sin corchetes', 'table'],
    ['cualquier [cosa entre corchetes]', 'p'],
  ] as const)('%s en %s', (text, where) => {
    expect(findLegalMarkers(withText(text, where)).length).toBeGreaterThan(0);
  });

  it('el aviso vigente (provisional, §14.17) NO tiene marcadores; el fixture del borrador sí', () => {
    expect(findLegalMarkers(privacyNoticeEs)).toEqual([]);
    const found = findLegalMarkers(MARKED);
    expect(found.some((m) => m.includes('DATO DEL DUEÑO'))).toBe(true);
    expect(found.some((m) => m.includes('FECHA'))).toBe(true);
  });
});

describe('LEG-2 · visibilidad: con marcadores, NUNCA en producción', () => {
  it('producción en Vercel + marcadores ⇒ hidden (404 y sin enlace)', () => {
    expect(privacyVisibility(MARKED, { vercelEnv: 'production', nodeEnv: 'production' })).toBe('hidden');
  });

  it('servidor sin VERCEL_ENV (self-hosted / next start) + marcadores ⇒ hidden (falla hacia lo seguro)', () => {
    expect(privacyVisibility(MARKED, { nodeEnv: 'production' })).toBe('hidden');
  });

  it('vista previa de Vercel, next dev o LEGAL_DRAFT_PREVIEW=1 ⇒ borrador visible (con marcadores resaltados)', () => {
    expect(privacyVisibility(MARKED, { vercelEnv: 'preview', nodeEnv: 'production' })).toBe('draft');
    expect(privacyVisibility(MARKED, { nodeEnv: 'development' })).toBe('draft');
    expect(privacyVisibility(MARKED, { nodeEnv: 'production', draftPreview: '1' })).toBe('draft');
  });

  it('⛔ LEGAL_DRAFT_PREVIEW no abre el borrador en producción de Vercel', () => {
    expect(
      privacyVisibility(MARKED, { vercelEnv: 'production', nodeEnv: 'production', draftPreview: '1' }),
    ).toBe('hidden');
  });

  it('texto limpio ⇒ published en cualquier entorno', () => {
    expect(privacyVisibility(CLEAN, { vercelEnv: 'production', nodeEnv: 'production' })).toBe('published');
    expect(privacyVisibility(CLEAN, { vercelEnv: 'preview' })).toBe('published');
  });
});

describe('LEG-3 · estructura del aviso (criterio 500)', () => {
  it('los diez apartados de §LEG.2, en orden', () => {
    expect(privacyNoticeEs.sections.map((s) => s.id)).toEqual([
      'responsable',
      'datos',
      'finalidades-primarias',
      'finalidades-secundarias',
      'remisiones',
      'conservacion',
      'arco',
      'cookies',
      'cambios',
      'aceptacion',
    ]);
  });

  it('lleva versión y fecha de actualización', () => {
    expect(privacyNoticeEs.version).toBeTruthy();
    expect(privacyNoticeEs.updatedAt).toBeTruthy();
  });

  it('proveedores del criterio 502: Stripe, paqueterías, Resend, Cloudflare R2, Railway, Vercel, Google', () => {
    const all = JSON.stringify(privacyNoticeEs);
    for (const p of ['Stripe', 'Paqueterías', 'Resend', 'Cloudflare (R2)', 'Railway', 'Vercel', 'Google']) {
      expect(all, p).toContain(p);
    }
  });
});
