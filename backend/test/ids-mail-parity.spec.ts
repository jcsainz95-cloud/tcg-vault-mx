/**
 * ids-mail-parity.spec.ts — TL-IDS-1 (techlead sobre `f2cd0e31`; API_CONTRACT §IDS.5 «correo»: «literales de DESIGN_SYSTEM
 * §IDS-UX.1, los mismos que pinta frontend»). Propiedad: backend.
 *
 * El correo de confirmación lo traduce backend (`orders/mail/order-notice.templates.ts`, `MAIL_VERSION_TEXT`) con literales
 * COPIADOS del catálogo de la tienda (`frontend/messages/{es,en}.json`). Sin esta prueba, un cambio de copy en la tienda dejaba al
 * correo diciendo otra cosa (medido al escribirla: EN de campeonato «Championship (…)» en el correo y «Tournament (…)» en la
 * tienda, HECHOS 2026-11-03 «Copy EN de §IDS…»). Aquí se lee el JSON REAL y se compara el texto del correo para las 5 × 5 × 2
 * combinaciones (`StampType` × `FinishLabel` × idioma), más el español sin liga. Lee `frontend/`: corre sobre el árbol ENTERO.
 * Determinista (N=1).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Finish, StampType } from '@prisma/client';
import { FinishLabel, FINISH_LABEL_VALUES } from '../src/common/card-version';
import { orderMailVersionTextOf } from '../src/modules/orders/mail/order-notice.templates';

type Catalog = {
  version: { language: Record<'en' | 'es', string>; finishLabel: Record<FinishLabel, string> };
  versionDetail: { long: Record<StampType, string> };
};
const LOCALES = ['es', 'en'] as const;
const catalogOf = (l: (typeof LOCALES)[number]): Catalog =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'frontend', 'messages', `${l}.json`), 'utf8')) as Catalog;
const STAMPS: StampType[] = ['prize_pack', 'league', 'championship', 'prerelease', 'staff'];

/** Una línea congelada que produce `label` (`cosmos_holo` sale del rótulo del producto, D-IDS-N). */
function lineFor(stampType: StampType | null, label: FinishLabel, language: 'en' | 'es') {
  const finish: Record<FinishLabel, Finish> = {
    non_holo: 'normal',
    holo: 'holofoil',
    reverse_holo: 'reverse_holo',
    first_edition_holo: 'first_edition_holofoil',
    cosmos_holo: 'holofoil',
  };
  return { language, stampType, stampLabel: label === 'cosmos_holo' ? 'Cosmos Holo' : null, finish: finish[label] };
}

/** Lo que pinta la tienda con su catálogo: [idioma si es español] · tipo largo (si liga) · acabado. */
function storeText(cat: Catalog, stampType: StampType | null, label: FinishLabel, language: 'en' | 'es'): string {
  const parts: string[] = [];
  if (language === 'es') parts.push(cat.version.language.es);
  if (stampType) parts.push(cat.versionDetail.long[stampType]);
  parts.push(cat.version.finishLabel[label]);
  return parts.join(' · ');
}

describe('TL-IDS-1 · el correo dice EXACTAMENTE lo que la tienda (frontend/messages/{es,en}.json)', () => {
  const cases = LOCALES.flatMap((l) => STAMPS.flatMap((s) => FINISH_LABEL_VALUES.map((f) => [l, s, f] as const)));

  it('las combinaciones son 5 × 5 × 2', () => {
    expect(STAMPS).toHaveLength(5);
    expect(FINISH_LABEL_VALUES).toHaveLength(5);
    expect(cases).toHaveLength(50);
  });

  it.each(cases)('%s · %s · %s (español de liga)', (l, s, f) => {
    expect(orderMailVersionTextOf(lineFor(s, f, 'es'), l)).toBe(storeText(catalogOf(l), s, f, 'es'));
  });

  it.each(cases)('%s · %s · %s (inglés de liga)', (l, s, f) => {
    expect(orderMailVersionTextOf(lineFor(s, f, 'en'), l)).toBe(storeText(catalogOf(l), s, f, 'en'));
  });

  it.each(LOCALES.flatMap((l) => FINISH_LABEL_VALUES.filter((f) => f !== 'cosmos_holo').map((f) => [l, f] as const)))(
    '%s · español sin liga · %s',
    (l, f) => {
      expect(orderMailVersionTextOf(lineFor(null, f, 'es'), l)).toBe(storeText(catalogOf(l), null, f, 'es'));
    },
  );

  it('CANARIO: un literal de la tienda distinto SE VE (la comparación no es tautológica)', () => {
    const cat = catalogOf('en');
    const mutated: Catalog = { ...cat, versionDetail: { long: { ...cat.versionDetail.long, staff: 'Staff (Staff promo) X' } } };
    const mail = orderMailVersionTextOf(lineFor('staff', 'holo', 'en'), 'en');
    expect(mail).toBe(storeText(cat, 'staff', 'holo', 'en'));
    expect(mail).not.toBe(storeText(mutated, 'staff', 'holo', 'en'));
  });
});
