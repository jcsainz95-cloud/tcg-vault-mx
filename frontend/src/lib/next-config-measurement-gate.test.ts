/**
 * TL D7 (2026-10-19) · C-D1 mínima en `next.config.mjs`: corre con CUALQUIER `next build`, no solo con
 * `npm run build` (prebuild). Modo `on` + declaración nula o incompleta ⇒ cargar la configuración lanza.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { measurementDisclosureProblem } from '../../next.config.mjs';

const FRONTEND = resolve(__dirname, '../..');
const ON = { NEXT_PUBLIC_MEASUREMENT_MODE: 'on' };
const decl = (value: string) => `export const MEASUREMENT_DISCLOSURE: MeasurementDisclosure | null = ${value};\n`;
const GOOD = decl(`{ version: 'aviso-2026-11', approvedByOwnerOn: '2026-11-01', legalReviewOn: '2026-10-30' }`);

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
    expect(measurementDisclosureProblem(ON, decl(`{ version: 'v1', approvedByOwnerOn: '2026-11-01' }`))).toMatch(/legalReviewOn/);
    expect(measurementDisclosureProblem(ON, decl(`{ version: 'v 1', approvedByOwnerOn: '2026-11-01', legalReviewOn: '2026-10-30' }`))).toMatch(/version/);
    expect(measurementDisclosureProblem(ON, decl(`{ version: 'v1', approvedByOwnerOn: 'pronto', legalReviewOn: '2026-10-30' }`))).toMatch(/approvedByOwnerOn/);
    expect(measurementDisclosureProblem(ON, 'export const OTRA = 1;')).toMatch(/no se encontró/);
  });

  it('on + completa ⇒ sin problema', () => {
    expect(measurementDisclosureProblem(ON, GOOD)).toBeNull();
  });

  it('on en bundle de MOCKS (E2E, no se publica) ⇒ exento', () => {
    expect(measurementDisclosureProblem({ ...ON, NEXT_PUBLIC_USE_MOCKS: 'true' }, decl('null'))).toBeNull();
  });

  it('el fichero REAL hoy (null) con on ⇒ problema', () => {
    expect(measurementDisclosureProblem(ON)).toMatch(/null/);
  });
});

describe('D7 · cargar next.config.mjs (lo que hace `next build`)', () => {
  const load = (env: Record<string, string>) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./next.config.mjs')"], {
      cwd: FRONTEND,
      env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 60_000,
    });

  it('off ⇒ carga (rc 0)', () => {
    expect(load({ NEXT_PUBLIC_MEASUREMENT_MODE: 'off' }).status).toBe(0);
  });

  it('on con el aviso de hoy ⇒ lanza MEASUREMENT_NOTICE_REQUIRED (rc ≠ 0)', () => {
    const r = load({ NEXT_PUBLIC_MEASUREMENT_MODE: 'on' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('MEASUREMENT_NOTICE_REQUIRED mode=on (next.config)');
  });
});
