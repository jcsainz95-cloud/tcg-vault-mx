/**
 * FE-MKT-T1 (techlead, 2026-10-18) — contenido FICTICIO con fechas fijas para las pruebas de vigencia y sus canarios
 * (`seo-content.test.ts`, `llms-txt.test.ts`). Las FAQ vivas se renuevan cada mes (`validThrough` se mueve); si los
 * canarios las usaran, cada renovación obligaría a reescribirlos. Aquí las fechas no se mueven nunca.
 *
 * ⛔ La prueba ⏳ R1 con el RELOJ REAL NO usa este fixture: vigila los datos vivos y así debe seguir.
 *
 * Calendario del fixture (último día de publicación, CDMX, inclusive):
 *  - FX1 → 2030-01-05 (la de vida corta, como P19)
 *  - FX2 → 2030-01-10 (citada por la guía `fx-cita`)
 *  - FX3 → 2030-01-20
 */
import type { PublicFaq } from '@/content/seo/faq.es';
import type { Guide } from '@/content/seo/guides.es';
import type { ContentSource } from './seo-content';

/** Un día con las tres FAQ del fixture vigentes. */
export const FX_NOW = new Date('2030-01-01T18:00:00Z');

const FAQS: readonly PublicFaq[] = [
  { id: 'FX1', core: true, group: 'Comprar', question: 'Pregunta FX1', answer: 'Respuesta FX1.', validThrough: '2030-01-05' },
  { id: 'FX2', core: false, group: 'Cartas y condición', question: 'Pregunta FX2', answer: 'Respuesta FX2.', validThrough: '2030-01-10' },
  { id: 'FX3', core: false, group: 'Vender', question: 'Pregunta FX3', answer: 'Respuesta FX3.', validThrough: '2030-01-20' },
];

const GUIDES: readonly Guide[] = [
  {
    slug: 'fx-cita',
    headline: 'Guía FX que cita FX2',
    datePublished: '2029-12-01',
    blocks: [{ kind: 'faq', faqId: 'FX2' }, { kind: 'p', text: 'Párrafo FX de la guía con cita.' }],
    cta: 'catalog',
    source: [],
    omitted: [],
  },
  {
    slug: 'fx-sola',
    headline: 'Guía FX sin citas',
    datePublished: '2029-12-02',
    blocks: [{ kind: 'p', text: 'Párrafo FX de la guía sin citas.' }],
    cta: 'buylist',
    source: [],
    omitted: [],
  },
];

export const FIXTURE_CONTENT: ContentSource = {
  faqs: FAQS,
  guides: GUIDES,
  howItWorks: [
    { group: 'Comprar', faqIds: ['FX1'] },
    { group: 'Vender', faqIds: ['FX3'] },
  ],
};
