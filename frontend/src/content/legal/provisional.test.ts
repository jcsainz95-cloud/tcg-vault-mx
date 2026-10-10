// @vitest-environment node
/**
 * LIVE-8 · errata v1.84.4 «modo provisional» (API_CONTRACT §14.17, ancla LIVE-E4, tabla E4-3;
 * HECHOS 2026-10-05 sesión 6: el dueño sale sin datos fiscales y regulariza después).
 *
 * LEG-P1…P7: funciones puras con fixtures, en la suite normal (no detrás de LEGAL_PUBLISH_CHECK).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/test/strip-comments';
import {
  OWNER_EMAIL,
  PROVISIONAL_FISCAL_TEXT,
  privacyNoticeEs,
  type LegalDocument,
  type PendingOwnerDatum,
} from './privacidad.es';
import { findLegalMarkers, privacyVisibility, provisionalProblems } from './legal-gate';
import { legalPublishProblems, type LegalMessages } from './publish-check';
import { PRIVACY_NOTICE_SITES } from './privacy-sites';
import { privacyLinkVisible } from '@/app/[locale]/(storefront)/footer';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

const ROOT = join(__dirname, '../../..');
const PROD = { vercelEnv: 'production', nodeEnv: 'production' } as const;
const MESSAGES = { es, en } as unknown as LegalMessages;

/** Fuentes reales de los siete sitios (sin comentarios). */
const REAL_SITES: Record<number, string> = Object.fromEntries(
  PRIVACY_NOTICE_SITES.map((s) => [s.id, stripComments(readFileSync(join(ROOT, s.file), 'utf8'), s.file)]),
);

/** Los siete sitios cumpliendo (fixture): aísla las reglas del documento de las de LEG-5. */
const ALL_SITES_OK: Record<number, string> = Object.fromEntries(
  PRIVACY_NOTICE_SITES.map((s) => [
    s.id,
    [
      '<PrivacyNoticeLink variant="nav" />',
      '<PrivacySiteNote site="register" />',
      '<PrivacySiteNote site="googleSignIn" />',
      '<PrivacySiteNote site="guestCheckout" as="span" />',
      '<PrivacySiteNote site="checkout" />',
      '<PrivacySiteNote site="sellForm" />',
      '<PrivacySiteNote site="accountIne" />',
    ].join('\n'),
  ]),
);

const clone = (d: LegalDocument): LegalDocument => JSON.parse(JSON.stringify(d));

/** Documento final de ejemplo (fixture, datos de mentira): sin frase provisional y sin pendientes. */
function finalDoc(): LegalDocument {
  const d = clone(privacyNoticeEs);
  d.pendingOwnerData = [];
  d.sections[0].blocks = [
    { type: 'p', text: '**Comercializadora Ejemplo S.A. de C.V.**, RFC **CEJ010101AAA**, domicilio en Calle 1.' },
  ];
  return d;
}

const sectionText = (doc: LegalDocument, id: string) =>
  JSON.stringify(doc.sections.find((s) => s.id === id)?.blocks ?? []);

describe('LEG-P1 · el aviso real (provisional y coherente) se publica en producción', () => {
  it('sin marcadores, coherente, pendientes = razón social, RFC y domicilio', () => {
    expect(findLegalMarkers(privacyNoticeEs)).toEqual([]);
    expect(provisionalProblems(privacyNoticeEs)).toEqual([]);
    expect([...privacyNoticeEs.pendingOwnerData].sort()).toEqual(['domicilio', 'razonSocial', 'rfc']);
  });

  it('privacyVisibility en producción de Vercel y en un servidor sin VERCEL_ENV ⇒ published', () => {
    expect(privacyVisibility(privacyNoticeEs, PROD)).toBe('published');
    expect(privacyVisibility(privacyNoticeEs, { nodeEnv: 'production' })).toBe('published');
  });

  it('el pie enlaza el aviso en producción', () => {
    expect(privacyLinkVisible(PROD)).toBe(true);
  });

  it('el apartado «responsable» lleva el texto normativo de E4-1, literal', () => {
    const blocks = privacyNoticeEs.sections[0].blocks;
    expect(privacyNoticeEs.sections[0].id).toBe('responsable');
    expect(blocks).toEqual([
      {
        type: 'p',
        text:
          'El responsable del tratamiento de tus datos personales cuando usas **tcghunt.mx** es quien opera la tienda ' +
          '**TCG HUNT** (en adelante, «TCG HUNT»).',
      },
      { type: 'p', text: PROVISIONAL_FISCAL_TEXT },
      { type: 'p', text: 'Contacto para todo lo relacionado con tus datos: **soporte@tcghunt.mx**.' },
    ]);
    expect(PROVISIONAL_FISCAL_TEXT).toBe(
      '**Nombre o razón social, RFC y domicilio del responsable:** todavía no están publicados en este aviso. Los ' +
        'añadiremos aquí en cuanto estén disponibles, con su fecha de actualización. Mientras tanto, puedes dirigir ' +
        'cualquier solicitud sobre tus datos personales al correo de abajo.',
    );
  });

  // ✏ 2026-10-06: sube con el cambio de fondo de PROJECT §LEG.2 punto 5 (el vendedor como remitente a Skydropx y a la
  // paquetería). Sigue fijando versión y fecha EXACTAS: una versión vieja con texto nuevo vuelve a poner esto rojo.
  // ✏ 2026-10-07: sube otra vez con el párrafo «Lista de deseos» (PROJECT §WSH.5, criterio 824).
  it('versión y fecha vigentes (E4-2 :42-43; §LEG.2 p. 5; §WSH.5)', () => {
    expect(privacyNoticeEs.version).toBe('0.4-provisional-2026-10-07');
    expect(privacyNoticeEs.updatedAt).toBe('7 de octubre de 2026');
  });
});

describe('LEG-P2 · un marcador sigue mandando aunque haya pendientes declarados', () => {
  for (const idx of [0, 4, 9]) {
    it(`[DATO DEL DUEÑO: RFC] en el apartado ${idx + 1} ⇒ hidden en producción y el modo provisional lo nombra`, () => {
      const d = clone(privacyNoticeEs);
      d.sections[idx].blocks.push({ type: 'p', text: 'RFC: [DATO DEL DUEÑO: RFC]' });
      expect(privacyVisibility(d, PROD)).toBe('hidden');
      const p = legalPublishProblems('provisional', { doc: d, messages: MESSAGES, siteSources: ALL_SITES_OK });
      expect(p.join('\n')).toContain('[DATO DEL DUEÑO: RFC]');
    });
  }
});

describe('LEG-P3 · incoherencia entre pendingOwnerData y la frase fija', () => {
  it('(a) hay pendientes y «responsable» NO tiene la frase ⇒ hidden y problema nombrado', () => {
    const d = clone(privacyNoticeEs);
    d.sections[0].blocks = d.sections[0].blocks.filter(
      (b) => !(b.type === 'p' && b.text === PROVISIONAL_FISCAL_TEXT),
    );
    expect(findLegalMarkers(d)).toEqual([]);
    expect(provisionalProblems(d).join('\n')).toMatch(/PROVISIONAL_FISCAL_TEXT/);
    expect(privacyVisibility(d, PROD)).toBe('hidden');
    expect(
      legalPublishProblems('provisional', { doc: d, messages: MESSAGES, siteSources: ALL_SITES_OK }).join('\n'),
    ).toMatch(/responsable/);
  });

  it('(a) la frase en OTRO apartado no cuenta: tiene que estar en «responsable»', () => {
    const d = clone(privacyNoticeEs);
    const fixed = d.sections[0].blocks.splice(1, 1)[0];
    d.sections[6].blocks.push(fixed);
    expect(provisionalProblems(d).length).toBeGreaterThan(0);
    expect(privacyVisibility(d, PROD)).toBe('hidden');
  });

  it('(b) sin pendientes y el documento SÍ tiene la frase ⇒ hidden y problema nombrado', () => {
    const d = clone(privacyNoticeEs);
    d.pendingOwnerData = [];
    expect(findLegalMarkers(d)).toEqual([]);
    expect(provisionalProblems(d).join('\n')).toMatch(/PROVISIONAL_FISCAL_TEXT/);
    expect(privacyVisibility(d, PROD)).toBe('hidden');
    expect(
      legalPublishProblems('provisional', { doc: d, messages: MESSAGES, siteSources: ALL_SITES_OK }).length,
    ).toBeGreaterThan(0);
  });

  it('documento final coherente (sin pendientes, sin frase) ⇒ sin problemas y published', () => {
    expect(provisionalProblems(finalDoc())).toEqual([]);
    expect(privacyVisibility(finalDoc(), PROD)).toBe('published');
  });
});

describe('LEG-P4 · el modo final exige los datos fiscales y la razón social del pie', () => {
  it('reales + siete sitios ⇒ provisional verde; final rojo nombrando razón social, RFC, domicilio y legalEntity', () => {
    const input = { doc: privacyNoticeEs, messages: MESSAGES, siteSources: ALL_SITES_OK };
    expect(legalPublishProblems('provisional', input)).toEqual([]);
    const final = legalPublishProblems('final', input).join('\n');
    expect(final).toMatch(/P-LEG-1…3/);
    expect(final).toMatch(/razón social/);
    expect(final).toMatch(/RFC/);
    expect(final).toMatch(/domicilio/);
    expect(final).toMatch(/legalEntity \(es\)/);
    expect(final).toMatch(/legalEntity \(en\)/);
  });

  it('final con datos cargados y razón social en el pie ⇒ verde', () => {
    const messages = {
      es: { common: { footer: { legalEntity: 'Comercializadora Ejemplo S.A. de C.V.' } } },
      en: { common: { footer: { legalEntity: 'Comercializadora Ejemplo S.A. de C.V.' } } },
    };
    expect(legalPublishProblems('final', { doc: finalDoc(), messages, siteSources: ALL_SITES_OK })).toEqual([]);
  });

  it('final con legalEntity vacío en un idioma ⇒ rojo nombrando el idioma', () => {
    const messages = {
      es: { common: { footer: { legalEntity: 'Comercializadora Ejemplo S.A. de C.V.' } } },
      en: { common: { footer: { legalEntity: '  ' } } },
    };
    const p = legalPublishProblems('final', { doc: finalDoc(), messages, siteSources: ALL_SITES_OK });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/legalEntity \(en\)/);
  });
});

describe('LEG-P5 · pendingOwnerData es una unión cerrada (guarda en tiempo de ejecución)', () => {
  it('«correoPrivacidad» (forzado con cast) ⇒ problema en los dos modos', () => {
    const d = clone(privacyNoticeEs);
    d.pendingOwnerData = [...d.pendingOwnerData, 'correoPrivacidad' as PendingOwnerDatum];
    expect(provisionalProblems(d).join('\n')).toMatch(/correoPrivacidad/);
    expect(privacyVisibility(d, PROD)).toBe('hidden');
    for (const mode of ['provisional', 'final'] as const) {
      const p = legalPublishProblems(mode, { doc: d, messages: MESSAGES, siteSources: ALL_SITES_OK });
      expect(p.join('\n'), mode).toMatch(/correoPrivacidad/);
    }
  });

  it('valor repetido ⇒ problema', () => {
    const d = clone(privacyNoticeEs);
    d.pendingOwnerData = ['rfc', 'rfc'];
    expect(provisionalProblems(d).join('\n')).toMatch(/repetido/);
  });
});

describe('LEG-P6 · el modo provisional también exige los siete sitios (503–505 no los cubre la excepción)', () => {
  for (const site of PRIVACY_NOTICE_SITES) {
    it(`sin el componente en el sitio ${site.id} ⇒ rojo nombrando el sitio`, () => {
      const siteSources = { ...ALL_SITES_OK, [site.id]: 'export function X() { return null; }' };
      const p = legalPublishProblems('provisional', { doc: privacyNoticeEs, messages: MESSAGES, siteSources });
      expect(p).toHaveLength(1);
      expect(p[0]).toContain(`sitio ${site.id} · ${site.name}`);
    });
  }

  it('fichero de un sitio ausente ⇒ rojo nombrando el sitio', () => {
    const siteSources: Record<number, string> = { ...ALL_SITES_OK };
    delete siteSources[4];
    const p = legalPublishProblems('provisional', { doc: privacyNoticeEs, messages: MESSAGES, siteSources });
    expect(p.join('\n')).toMatch(/sitio 4 · /);
  });

  it('árbol real: lo único que falta en modo provisional son sitios (ni marcadores ni incoherencias)', () => {
    const p = legalPublishProblems('provisional', { doc: privacyNoticeEs, messages: MESSAGES, siteSources: REAL_SITES });
    for (const line of p) expect(line).toMatch(/^sitio \d · /);
  });
});

describe('LEG-P7 · contacto único y sin trámites inventados', () => {
  it('soporte@tcghunt.mx en §1 y §7, con la misma constante', () => {
    expect(OWNER_EMAIL).toBe('soporte@tcghunt.mx');
    expect(sectionText(privacyNoticeEs, 'responsable')).toContain('**soporte@tcghunt.mx**');
    expect(sectionText(privacyNoticeEs, 'arco')).toContain('**soporte@tcghunt.mx**');
    const emails = JSON.stringify(privacyNoticeEs).match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    expect(new Set(emails)).toEqual(new Set(['soporte@tcghunt.mx']));
  });

  it('no dice «trámite» ni nombra la marca como razón social', () => {
    const all = JSON.stringify(privacyNoticeEs);
    expect(all).not.toMatch(/tr[áa]mite/i);
    expect(all).not.toMatch(/privacidad@/);
  });
});

describe('E4-2 `:141` · Skydropx entra como fila propia con el lote 2 (criterio 502)', () => {
  it('«Con quién compartimos» lista Stripe, Paqueterías, Skydropx, Resend, Cloudflare, Railway/Vercel y Google', () => {
    const s = privacyNoticeEs.sections.find((x) => x.id === 'remisiones')!;
    const table = s.blocks.find((b) => b.type === 'table');
    expect(table?.type).toBe('table');
    const providers = table!.type === 'table' ? table!.rows.map((r) => r[0]) : [];
    expect(providers).toEqual([
      '**Stripe**',
      '**Paqueterías**',
      '**Skydropx**',
      '**Resend**',
      '**Cloudflare (R2)**',
      '**Railway y Vercel**',
      '**Google**',
    ]);
  });
});
