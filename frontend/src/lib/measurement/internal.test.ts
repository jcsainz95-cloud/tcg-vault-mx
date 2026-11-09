import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INTERNAL_RE, internalFromSearch, isInternalTraffic, isInternalUtm, syncInternalFlag } from './internal';

afterEach(() => window.localStorage.clear());

describe('tráfico propio (§MKT-V2 §4)', () => {
  it('el patrón crece solo: cualquier prefijo + separador', () => {
    for (const v of ['diag-lighthouse', 'QA-playwright', 'e2e-run', 'smoke-1', 'test-x', 'probe-x', 'internal-a']) {
      expect(isInternalUtm(v), v).toBe(true);
    }
    for (const v of ['instagram', 'diagnostico', 'testing', 'qatar', 'google', 'diag', 'qa', 'e2e_run', 'smoke.1', 'diag-', '', null]) expect(isInternalUtm(v as string), String(v)).toBe(false);
  });

  it('la URL manda: utm_source propio (con guion; nunca utm_medium) o ?tcg_int=1 marcan; ?tcg_int=0 quita', () => {
    expect(internalFromSearch('?utm_source=diag-x')).toBe('on');
    expect(internalFromSearch('?utm_medium=qa-x')).toBeNull();
    expect(internalFromSearch('?tcg_int=1')).toBe('on');
    expect(internalFromSearch('?tcg_int=0&utm_source=diag-x')).toBe('off');
    expect(internalFromSearch('?utm_source=instagram')).toBeNull();
    expect(internalFromSearch('')).toBeNull();
  });

  it('syncInternalFlag guarda 90 días y una URL normal no la quita', () => {
    const t0 = 1_000_000;
    expect(syncInternalFlag('?tcg_int=1', t0)).toBe(true);
    expect(window.localStorage.getItem('tcg_int')).toBe('1');
    expect(syncInternalFlag('?utm_source=instagram', t0 + 1000)).toBe(true);
    expect(isInternalTraffic(t0 + 91 * 86_400_000)).toBe(false);
    expect(window.localStorage.getItem('tcg_int')).toBeNull();
  });

  it('?tcg_int=0 la quita', () => {
    syncInternalFlag('?tcg_int=1');
    expect(syncInternalFlag('?tcg_int=0')).toBe(false);
  });

  it('paridad con el backend (si ya existe el fichero)', () => {
    const f = resolve(__dirname, '../../../../backend/src/modules/marketing/internal-traffic.ts');
    expect(existsSync(f), `falta ${f}: sin el fichero del backend no hay paridad que comprobar`).toBe(true);
    const src = readFileSync(f, 'utf8');
    const list = /INTERNAL_UTM_PREFIXES = \[([^\]]+)\]/.exec(src)?.[1];
    expect(list, 'lista de prefijos no encontrada en el backend').toBeTruthy();
    const prefixes = [...list!.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    // Mismo conjunto de prefijos y mismo separador que la copia del navegador.
    expect(INTERNAL_RE.source).toBe(`^(${prefixes.join('|')})-.+`);
    expect(INTERNAL_RE.flags).toBe('i');
  });
});
