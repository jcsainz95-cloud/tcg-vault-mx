/**
 * 🔒 SEC-MKT-3 — `MEASUREMENT_MODE=on` SOLO en el backend también pasa por los bloqueos de encendido (ARCHITECTURE §14.1
 * D-MKT2-0c; SECURITY_NOTES SEC-MKT-3). Con bloqueos abiertos de dueño backend, el modo EFECTIVO es `off` y el arranque lo dice
 * con una línea `MEASUREMENT_ENCENDER_BLOCKED` (sin valores). El arranque NO se cae: la tienda sigue, sin medir.
 *
 *  1. `gateMeasurementConfig`: on + bloqueos ⇒ off con su línea; on sin bloqueos ⇒ on; off ⇒ off sin línea.
 *  2. El servicio tal como lo arma Nest con los providers de `MeasurementModule` (la lista real) ⇒ `mode` off, ningún destino.
 *  3. Paridad: toda entrada backend de `ENCENDER_BLOCKERS` (frontend) está en `BACKEND_ENCENDER_BLOCKERS` o tiene su ficha de
 *     TECH_DEBT cerrada; y toda entrada de `BACKEND_ENCENDER_BLOCKERS` tiene su ficha ABIERTA (una cerrada se quita). Con canario.
 * Determinista: N=1.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  BACKEND_ENCENDER_BLOCKERS,
  gateMeasurementConfig,
  MEASUREMENT_ENCENDER_BLOCKERS,
  readMeasurementConfig,
} from '../src/modules/measurement/measurement.config';
import { MeasurementModule } from '../src/modules/measurement/measurement.module';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CAPI_TOKEN, GA4_SECRET, fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const ROOT = resolve(__dirname, '../..');

describe('SEC-MKT-3 · gateMeasurementConfig', () => {
  it('on + bloqueos abiertos ⇒ off, con UNA línea que nombra los ids (sin valores de secretos)', () => {
    const { config, lines } = gateMeasurementConfig(readMeasurementConfig(fullEnv()), BACKEND_ENCENDER_BLOCKERS);
    expect(config.mode).toBe('off');
    expect(lines).toEqual([`MEASUREMENT_ENCENDER_BLOCKED requested=on effective=off blockers=${BACKEND_ENCENDER_BLOCKERS.map((b) => b.id).join(',')}`]);
    expect(lines.join('\n')).not.toContain(GA4_SECRET);
    expect(lines.join('\n')).not.toContain(CAPI_TOKEN);
  });
  it('on sin bloqueos ⇒ on (la puerta no apaga nada cerrado); off ⇒ off sin línea', () => {
    expect(gateMeasurementConfig(readMeasurementConfig(fullEnv()), []).config.mode).toBe('on');
    expect(gateMeasurementConfig(readMeasurementConfig(fullEnv({ MEASUREMENT_MODE: 'off' })), BACKEND_ENCENDER_BLOCKERS)).toMatchObject({ config: { mode: 'off' }, lines: [] });
  });
});

describe('SEC-MKT-3 · el servicio que arma Nest con los providers de MeasurementModule', () => {
  it('MEASUREMENT_MODE=on con bloqueos ⇒ modo efectivo off, ningún destino habilitado, y el arranque lo registra (no se cae)', async () => {
    const providers = (Reflect.getMetadata('providers', MeasurementModule) as unknown[]).filter(
      (p) => p === MeasurementService || (typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === MEASUREMENT_ENCENDER_BLOCKERS),
    );
    expect(providers).toHaveLength(2);
    const mod = await Test.createTestingModule({
      providers: [...(providers as never[]), { provide: PrismaService, useValue: {} }, { provide: ConfigService, useValue: fakeConfig(fullEnv()) }],
    }).compile();
    const svc = mod.get(MeasurementService);
    const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect(() => svc.onModuleInit()).not.toThrow();
    expect(svc.mode).toBe('off');
    expect([svc.enabled('ga4_mp'), svc.enabled('meta_capi')]).toEqual([false, false]);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/^MEASUREMENT_ENCENDER_BLOCKED requested=on effective=off blockers=MKT-F2-3$/)]);
    expect(logs.mock.calls.map((c) => String(c[0]))).toContain('MEASUREMENT_MODE=off');
    errors.mockRestore();
    logs.mockRestore();
  });
});

/** Estado de una ficha en TECH_DEBT: la fila del índice cuya primera celda es el id (con o sin ✅). */
function fichaState(techDebt: string, id: string): 'open' | 'closed' | 'missing' {
  const esc = id.replace(/[-]/g, '\\-');
  const row = techDebt.split('\n').find((l) => new RegExp(`^\\|\\s*${esc}(\\s|\\|)`).test(l) && !new RegExp(`^\\|\\s*${esc}[a-z0-9]`, 'i').test(l));
  if (!row) return 'missing';
  return /✅|CERRADA/.test(row.split('|')[1]) ? 'closed' : 'open';
}

/** Problemas de paridad (vacío = verde). Pura: el canario le pasa textos y listas modificados. */
function parityProblems(frontendGate: string, techDebt: string, backendIds: readonly string[]): string[] {
  const out: string[] = [];
  const entries = [...frontendGate.matchAll(/\{\s*id:\s*'([^']+)',[\s\S]*?owner:\s*'([a-z]+)'/g)].map((m) => ({ id: m[1], owner: m[2] }));
  if (entries.length === 0) out.push('no se leyó ninguna entrada de ENCENDER_BLOCKERS');
  for (const e of entries.filter((x) => x.owner === 'backend')) {
    if (!backendIds.includes(e.id) && fichaState(techDebt, e.id) !== 'closed') out.push(`${e.id}: bloqueo backend del frontend sin entrada en BACKEND_ENCENDER_BLOCKERS y con la ficha sin cerrar`);
  }
  for (const id of backendIds) if (fichaState(techDebt, id) !== 'open') out.push(`${id}: está en BACKEND_ENCENDER_BLOCKERS pero su ficha no está abierta (${fichaState(techDebt, id)})`);
  return out;
}

describe('SEC-MKT-3 · paridad de bloqueos backend ↔ frontend ↔ TECH_DEBT', () => {
  const gate = readFileSync(resolve(ROOT, 'frontend/src/content/legal/measurement-gate.ts'), 'utf8');
  const debt = readFileSync(resolve(ROOT, 'docs/TECH_DEBT.md'), 'utf8');
  const ids = BACKEND_ENCENDER_BLOCKERS.map((b) => b.id);

  it('hoy: verde', () => {
    expect(parityProblems(gate, debt, ids)).toEqual([]);
  });
  it('CANARIO: quitar MKT-F2-3 de la lista del backend con su ficha abierta ⇒ rojo; reabrir MKT-TL2 ⇒ rojo si el frontend aún la tiene', () => {
    expect(parityProblems(gate, debt, ids.filter((i) => i !== 'MKT-F2-3'))).toEqual([expect.stringMatching(/^MKT-F2-3: /)]);
    const reopened = debt.replace(/^\|\s*MKT-TL2 ✅\s*\|/m, '| MKT-TL2 |');
    expect(reopened).not.toBe(debt);
    expect(parityProblems(gate.includes("id: 'MKT-TL2'") ? gate : `${gate}\n{ id: 'MKT-TL2', what: '', owner: 'backend' }`, reopened, ids)).toEqual([expect.stringMatching(/^MKT-TL2: /)]);
  });
  it('CANARIO: una entrada del backend cuya ficha se cerró ⇒ rojo (se quita en el mismo commit)', () => {
    const closed = debt.replace(/^\|\s*MKT-F2-3\s*\|/m, '| MKT-F2-3 ✅ |');
    expect(parityProblems(gate, closed, ids)).toEqual([expect.stringMatching(/^MKT-F2-3: está en BACKEND_ENCENDER_BLOCKERS/)]);
  });
});
