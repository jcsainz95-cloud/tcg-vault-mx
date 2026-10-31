/**
 * TL D7 (2026-10-19) · C-D1 mínima en `next.config.mjs`: corre con CUALQUIER `next build`, no solo con
 * `npm run build` (prebuild). Modo `on` + declaración nula o incompleta ⇒ cargar la configuración lanza.
 * v1.111 (2026-10-26): `legalReviewOn` y `legalReviewWaivedByOwnerOn`, exactamente una con fecha.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { measurementDisclosureProblem, MEASUREMENT_REVIEW_BOTH as CFG_BOTH, MEASUREMENT_REVIEW_NONE as CFG_NONE } from '../../next.config.mjs';
import { MEASUREMENT_REVIEW_BOTH, MEASUREMENT_REVIEW_NONE } from '@/content/legal/measurement-gate';

const FRONTEND = resolve(__dirname, '../..');
const ON = { NEXT_PUBLIC_MEASUREMENT_MODE: 'on' };
const decl = (value: string) => `export const MEASUREMENT_DISCLOSURE: MeasurementDisclosure | null = ${value};\n`;
const obj = (review: string) => decl(`{ version: 'aviso-2026-11', approvedByOwnerOn: '2026-11-01', ${review} }`);
const GOOD = obj(`legalReviewOn: null, legalReviewWaivedByOwnerOn: '2026-10-23'`);

describe('D7 · measurementDisclosureProblem (texto de measurement-disclosure.ts)', () => {
  it('off (o sin variable, o valor raro): nunca estorba', () => {
    expect(measurementDisclosureProblem({}, decl('null'))).toBeNull();
    expect(measurementDisclosureProblem({ NEXT_PUBLIC_MEASUREMENT_MODE: 'off' }, decl('null'))).toBeNull();
    expect(measurementDisclosureProblem({ NEXT_PUBLIC_MEASUREMENT_MODE: 'ON' }, decl('null'))).toBeNull();
  });

  it('on + null ⇒ problema', () => {
    expect(measurementDisclosureProblem(ON, decl('null'))).toMatch(/null/);
  });

  it('on + incompleta o mal formada ⇒ problema que nombra el campo', () => {
    expect(measurementDisclosureProblem(ON, decl(`{ version: 'v1', approvedByOwnerOn: '2026-11-01' }`))).toBe(
      'measurementDisclosure mal formado: legalReviewOn, legalReviewWaivedByOwnerOn',
    );
    expect(measurementDisclosureProblem(ON, decl(`{ version: 'v 1', approvedByOwnerOn: '2026-11-01', legalReviewOn: null, legalReviewWaivedByOwnerOn: '2026-10-23' }`))).toMatch(/version/);
    expect(measurementDisclosureProblem(ON, decl(`{ version: 'v1', approvedByOwnerOn: 'pronto', legalReviewOn: null, legalReviewWaivedByOwnerOn: '2026-10-23' }`))).toMatch(/approvedByOwnerOn/);
    expect(measurementDisclosureProblem(ON, 'export const OTRA = 1;')).toMatch(/no se encontró/);
  });

  it('on + completa (solo renuncia del dueño) ⇒ sin problema', () => {
    expect(measurementDisclosureProblem(ON, GOOD)).toBeNull();
  });

  // v1.111 · exactamente una de las dos fechas; clave ausente ⇒ mal formada.
  it('on + solo revisión legal ⇒ sin problema', () => {
    expect(measurementDisclosureProblem(ON, obj(`legalReviewOn: '2026-10-30', legalReviewWaivedByOwnerOn: null`))).toBeNull();
  });

  it('on + las dos fechas ⇒ problema «las dos»', () => {
    expect(measurementDisclosureProblem(ON, obj(`legalReviewOn: '2026-10-30', legalReviewWaivedByOwnerOn: '2026-10-23'`))).toBe(CFG_BOTH);
  });

  it('on + ninguna fecha ⇒ problema «ninguna», distinto del de «las dos»', () => {
    expect(measurementDisclosureProblem(ON, obj(`legalReviewOn: null, legalReviewWaivedByOwnerOn: null`))).toBe(CFG_NONE);
    expect(CFG_NONE).not.toBe(CFG_BOTH);
  });

  it('on + sin la clave legalReviewWaivedByOwnerOn (o sin legalReviewOn) ⇒ mal formada, aunque la otra tenga fecha', () => {
    expect(measurementDisclosureProblem(ON, obj(`legalReviewOn: '2026-10-30'`))).toBe('measurementDisclosure mal formado: legalReviewWaivedByOwnerOn');
    expect(measurementDisclosureProblem(ON, obj(`legalReviewWaivedByOwnerOn: '2026-10-23'`))).toBe('measurementDisclosure mal formado: legalReviewOn');
    expect(measurementDisclosureProblem(ON, obj(`legalReviewOn: 'ayer', legalReviewWaivedByOwnerOn: null`))).toBe('measurementDisclosure mal formado: legalReviewOn');
  });

  it('paridad: los mensajes «las dos» y «ninguna» son los mismos que en measurement-gate.ts', () => {
    expect(CFG_BOTH).toBe(MEASUREMENT_REVIEW_BOTH);
    expect(CFG_NONE).toBe(MEASUREMENT_REVIEW_NONE);
  });

  it('on en bundle de MOCKS (E2E, no se publica) ⇒ exento', () => {
    expect(measurementDisclosureProblem({ ...ON, NEXT_PUBLIC_USE_MOCKS: 'true' }, decl('null'))).toBeNull();
    expect(measurementDisclosureProblem({ ...ON, NEXT_PUBLIC_USE_MOCKS: 'true', VERCEL_ENV: 'development' }, decl('null'))).toBeNull();
  });

  // TL-MKT2b-e (2026-10-19): la exención de MOCKS no vale en un despliegue de Vercel.
  it('on + MOCKS en Vercel production o preview ⇒ problema (la exención no aplica)', () => {
    for (const VERCEL_ENV of ['production', 'preview']) {
      expect(measurementDisclosureProblem({ ...ON, NEXT_PUBLIC_USE_MOCKS: 'true', VERCEL_ENV }, decl('null')), VERCEL_ENV).toMatch(/null/);
    }
    // Y con la declaración completa, sin problema: la puerta mide el aviso, no castiga los mocks.
    expect(measurementDisclosureProblem({ ...ON, NEXT_PUBLIC_USE_MOCKS: 'true', VERCEL_ENV: 'production' }, GOOD)).toBeNull();
  });

  it('el fichero REAL hoy (aprobado 2026-10-26, renuncia 2026-10-23) con on ⇒ sin problema', () => {
    expect(measurementDisclosureProblem(ON)).toBeNull();
  });
});

describe('D7 · cargar next.config.mjs (lo que hace `next build`)', () => {
  const load = (env: Record<string, string>, cwd = FRONTEND) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./next.config.mjs')"], {
      cwd,
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 60_000,
    });

  /**
   * Copia mínima de la configuración DENTRO de `frontend/` (para que `next-intl/plugin` resuelva desde su
   * `node_modules`) con una declaración dada. Así se prueba que CARGAR lanza, ahora que el fichero real ya declara.
   */
  const withDisclosure = (source: string, run: (dir: string) => void) => {
    const dir = mkdtempSync(join(FRONTEND, '.ncfg-gate-'));
    try {
      copyFileSync(join(FRONTEND, 'next.config.mjs'), join(dir, 'next.config.mjs'));
      mkdirSync(join(dir, 'src/security'), { recursive: true });
      copyFileSync(join(FRONTEND, 'src/security/measurement-origins.mjs'), join(dir, 'src/security/measurement-origins.mjs'));
      // Interruptor del optimizador (§4.DYN (f) 7): `next.config.mjs` lo importa.
      mkdirSync(join(dir, 'src/lib'), { recursive: true });
      copyFileSync(join(FRONTEND, 'src/lib/image-optimizer-switch.mjs'), join(dir, 'src/lib/image-optimizer-switch.mjs'));
      mkdirSync(join(dir, 'src/content/legal'), { recursive: true });
      writeFileSync(join(dir, 'src/content/legal/measurement-disclosure.ts'), source);
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('off ⇒ carga (rc 0)', () => {
    expect(load({ NEXT_PUBLIC_MEASUREMENT_MODE: 'off' }).status).toBe(0);
  });

  it('on con el aviso REAL de hoy (declarado) ⇒ carga (rc 0); los bloqueos los mide la puerta completa (prebuild)', () => {
    const r = load({ NEXT_PUBLIC_MEASUREMENT_MODE: 'on' });
    expect(r.stderr).not.toContain('MEASUREMENT_NOTICE_REQUIRED');
    expect(r.status).toBe(0);
  });

  it('on con declaración null ⇒ lanza MEASUREMENT_NOTICE_REQUIRED (rc ≠ 0)', () => {
    withDisclosure(decl('null'), (dir) => {
      const r = load({ NEXT_PUBLIC_MEASUREMENT_MODE: 'on' }, dir);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('MEASUREMENT_NOTICE_REQUIRED mode=on (next.config)');
    });
  });

  it('on con las dos fechas ⇒ lanza con el mensaje «las dos» (rc ≠ 0)', () => {
    withDisclosure(obj(`legalReviewOn: '2026-10-30', legalReviewWaivedByOwnerOn: '2026-10-23'`), (dir) => {
      const r = load({ NEXT_PUBLIC_MEASUREMENT_MODE: 'on' }, dir);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain(CFG_BOTH);
    });
  });

  it('TL-MKT2b-e · on + MOCKS + VERCEL_ENV=production con declaración null ⇒ lanza (rc ≠ 0)', () => {
    withDisclosure(decl('null'), (dir) => {
      const r = load({ NEXT_PUBLIC_MEASUREMENT_MODE: 'on', NEXT_PUBLIC_USE_MOCKS: 'true', VERCEL_ENV: 'production' }, dir);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('MEASUREMENT_NOTICE_REQUIRED mode=on (next.config)');
    });
  });
});
