import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeVisitOrigin, visitColumnsData, VISIT_REFERRERS } from './visit-origin';
import { VisitReferrer } from '@prisma/client';
import { measurementColumnsData } from '../modules/measurement/measurement-input';

describe('§ORIGEN-VISITA · sanitizeVisitOrigin (CV-4)', () => {
  it('acepta utm válidos (en minúsculas) y referrer del enum', () => {
    expect(sanitizeVisitOrigin({ utmSource: 'Instagram', utmMedium: 'social', utmCampaign: 'otono_26', utmContent: 'reel.1' })).toEqual({
      visitUtmSource: 'instagram',
      visitUtmMedium: 'social',
      visitUtmCampaign: 'otono_26',
      visitUtmContent: 'reel.1',
    });
    for (const r of VISIT_REFERRERS) expect(sanitizeVisitOrigin({ referrer: r })).toEqual({ visitReferrer: r });
  });
  it('descarta campo a campo lo inválido y conserva el resto', () => {
    expect(sanitizeVisitOrigin({ utmSource: 'juan@correo.com', utmMedium: 'social', utmCampaign: 'x'.repeat(200), referrer: 'evil.com' })).toEqual({ visitUtmMedium: 'social' });
    expect(sanitizeVisitOrigin({ utmSource: 'a b', utmContent: 5, referrer: 7 })).toEqual({});
    expect(sanitizeVisitOrigin({ utmSource: 'ok', referrer: 'GOOGLE' })).toEqual({ visitUtmSource: 'ok' });
  });
  it('nunca lanza: arreglos, null, primitivos, claves desconocidas y proto', () => {
    for (const raw of [undefined, null, 'x', 3, true, [], [{ utmSource: 'a' }], { utm_source: 'a', url: 'https://x.mx', gclid: 'z' }, JSON.parse('{"__proto__":{"visitReferrer":"google"}}')]) {
      expect(sanitizeVisitOrigin(raw)).toEqual({});
    }
  });
  it('visitColumnsData proyecta solo las cinco columnas (nada de dinero se cuela)', () => {
    expect(visitColumnsData({ visitReferrer: 'directo', totalCents: 1, firstUtmSource: 'x' } as never)).toEqual({ visitReferrer: 'directo' });
  });
});

describe('§ORIGEN-VISITA · paridad enum', () => {
  it('VISIT_REFERRERS == enum Postgres VisitReferrer == lista del anexo del contrato', () => {
    expect([...VISIT_REFERRERS].sort()).toEqual(Object.values(VisitReferrer).sort());
    const annex = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'API_CONTRACT_ORIGEN.md'), 'utf8');
    for (const r of VISIT_REFERRERS) expect(annex).toContain(`'${r}'`);
  });
});

describe('§ORIGEN-VISITA · aislamiento: ningún visit* llega a GA4/Meta/CAPI/MeasurementContext', () => {
  it('measurementColumnsData descarta visit*', () => {
    expect(measurementColumnsData({ visitUtmSource: 'instagram', visitReferrer: 'google' } as never)).toEqual({});
  });
  it('ningún fichero de producción de modules/measurement ni marketing-ga4/external menciona visit*', () => {
    const dirs = [join(__dirname, '../modules/measurement'), join(__dirname, '../modules/marketing')];
    const offenders: string[] = [];
    for (const d of dirs) {
      for (const f of readdirSync(d)) {
        if (!f.endsWith('.ts') || f.endsWith('.spec.ts')) continue;
        // El panel (lectura de agregados propios) SÍ lee visit*; GA4/CAPI/contexto/drenaje no.
        if (d.endsWith('marketing') && !/ga4|external|capi|meta/i.test(f)) continue;
        if (/visit(Utm|Referrer)/.test(readFileSync(join(d, f), 'utf8'))) offenders.push(`${d.split('/').pop()}/${f}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
