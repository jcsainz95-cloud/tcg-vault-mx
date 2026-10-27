/**
 * 🔒 SEC-MKT-3 — `MEASUREMENT_MODE=on` SOLO en el backend también pasa por los bloqueos de encendido (ARCHITECTURE §14.1
 * D-MKT2-0c; SECURITY_NOTES SEC-MKT-3). Con bloqueos abiertos de dueño backend, el modo EFECTIVO es `off` y el arranque lo dice
 * con una línea `MEASUREMENT_ENCENDER_BLOCKED` (sin valores). El arranque NO se cae: la tienda sigue, sin medir.
 *
 *  1. `gateMeasurementConfig`: on + bloqueos ⇒ off con su línea; on sin bloqueos ⇒ on; off ⇒ off sin línea.
 *  2. El servicio tal como lo arma Nest con los providers de `MeasurementModule` (la lista real) ⇒ `mode` off, ningún destino.
 *  3. Paridad: toda entrada backend de `ENCENDER_BLOCKERS` (frontend) está en `BACKEND_ENCENDER_BLOCKERS` o tiene su ficha de
 *     TECH_DEBT cerrada; y toda entrada de `BACKEND_ENCENDER_BLOCKERS` tiene su ficha ABIERTA (una cerrada se quita). Con canario.
 * Hoy (2026-10-27) la lista real está VACÍA (MKT-F2-3 cerrada): las pruebas de la puerta usan un bloqueo sintético y la del módulo
 * fija que la lista que provee Nest es la real; los canarios reinyectan MKT-F2-3 abierta.
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

/** Bloqueos sintéticos (la lista real está vacía desde 2026-10-27): la puerta se prueba con ellos. */
const FAKE_BLOCKERS = [
  { id: 'MKT-X-1', what: 'bloqueo de prueba', closedBy: '—' },
  { id: 'MKT-X-2', what: 'otro bloqueo de prueba', closedBy: '—' },
] as const;

describe('SEC-MKT-3 · gateMeasurementConfig', () => {
  it('on + bloqueos abiertos ⇒ off, con UNA línea que nombra los ids (sin valores de secretos)', () => {
    const { config, lines } = gateMeasurementConfig(readMeasurementConfig(fullEnv()), FAKE_BLOCKERS);
    expect(config.mode).toBe('off');
    expect(lines).toEqual(['MEASUREMENT_ENCENDER_BLOCKED requested=on effective=off blockers=MKT-X-1,MKT-X-2']);
    expect(lines.join('\n')).not.toContain(GA4_SECRET);
    expect(lines.join('\n')).not.toContain(CAPI_TOKEN);
  });
  it('on sin bloqueos ⇒ on (la puerta no apaga nada cerrado); off ⇒ off sin línea', () => {
    expect(gateMeasurementConfig(readMeasurementConfig(fullEnv()), []).config.mode).toBe('on');
    expect(gateMeasurementConfig(readMeasurementConfig(fullEnv({ MEASUREMENT_MODE: 'off' })), FAKE_BLOCKERS)).toMatchObject({ config: { mode: 'off' }, lines: [] });
  });
  it('la lista real hoy (MKT-F2-3 y MKT-F2-4 cerradas) ⇒ on pedido = on efectivo, sin línea', () => {
    expect(BACKEND_ENCENDER_BLOCKERS).toEqual([]);
    expect(gateMeasurementConfig(readMeasurementConfig(fullEnv()), BACKEND_ENCENDER_BLOCKERS)).toMatchObject({ config: { mode: 'on' }, lines: [] });
  });
});

describe('SEC-MKT-3 · el servicio que arma Nest con los providers de MeasurementModule', () => {
  const moduleProviders = () => {
    const providers = (Reflect.getMetadata('providers', MeasurementModule) as unknown[]).filter(
      (p) => p === MeasurementService || (typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === MEASUREMENT_ENCENDER_BLOCKERS),
    );
    expect(providers).toHaveLength(2);
    return providers as never[];
  };

  it('el módulo provee la lista REAL de bloqueos (no una copia)', () => {
    const entry = moduleProviders().find((p) => (p as { provide?: unknown }).provide === MEASUREMENT_ENCENDER_BLOCKERS) as unknown as { useValue: unknown };
    expect(entry.useValue).toBe(BACKEND_ENCENDER_BLOCKERS);
  });

  it('MEASUREMENT_MODE=on con bloqueos ⇒ modo efectivo off, ningún destino habilitado, y el arranque lo registra (no se cae)', async () => {
    const mod = await Test.createTestingModule({
      providers: [...moduleProviders(), { provide: PrismaService, useValue: {} }, { provide: ConfigService, useValue: fakeConfig(fullEnv()) }],
    })
      .overrideProvider(MEASUREMENT_ENCENDER_BLOCKERS)
      .useValue(FAKE_BLOCKERS)
      .compile();
    const svc = mod.get(MeasurementService);
    const errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const logs = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect(() => svc.onModuleInit()).not.toThrow();
    expect(svc.mode).toBe('off');
    expect([svc.enabled('ga4_mp'), svc.enabled('meta_capi')]).toEqual([false, false]);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/^MEASUREMENT_ENCENDER_BLOCKED requested=on effective=off blockers=MKT-X-1,MKT-X-2$/)]);
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

/** La declaración del frontend: su apertura (`export const ENCENDER_BLOCKERS…= [`) y su cierre (`];` al inicio de línea). */
const DECL_OPEN = /export const ENCENDER_BLOCKERS\s*:[^=\n]*=\s*\[/;
const DECL_CLOSE = /^\];/m;
const ENTRY = /\{\s*id:\s*'([^']+)',[\s\S]*?owner:\s*'([a-z]+)'/g;

type FrontendBlockers = { ok: true; entries: { id: string; owner: string }[] } | { ok: false; error: string };

/**
 * Lee `ENCENDER_BLOCKERS` del frontend distinguiendo «lista vacía leída bien» (ok, sin entradas) de «no se encontró la
 * declaración / formato irreconocible» (error ⇒ rojo: es el candado contra renombrar la constante o cambiar su forma sin
 * actualizar este lector). Irreconocible = sin cierre `];`, algún `id:` del cuerpo que el patrón de entrada no capturó, o
 * texto que no es entrada, coma ni comentario.
 */
function readFrontendBlockers(frontendGate: string): FrontendBlockers {
  const open = DECL_OPEN.exec(frontendGate);
  if (!open) return { ok: false, error: 'no se encontró la declaración `export const ENCENDER_BLOCKERS …= [` en el gate del frontend' };
  const rest = frontendGate.slice(open.index + open[0].length);
  const close = DECL_CLOSE.exec(rest);
  if (!close) return { ok: false, error: 'ENCENDER_BLOCKERS sin cierre `];` al inicio de línea: formato irreconocible' };
  const body = rest
    .slice(0, close.index)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const entries = [...body.matchAll(ENTRY)].map((m) => ({ id: m[1], owner: m[2] }));
  const idKeys = (body.match(/\bid\s*:/g) ?? []).length;
  if (idKeys !== entries.length) return { ok: false, error: `ENCENDER_BLOCKERS con ${idKeys} claves id: y ${entries.length} entradas reconocidas: formato irreconocible` };
  if (entries.length === 0 && !/^[\s,]*$/.test(body)) return { ok: false, error: 'ENCENDER_BLOCKERS con contenido que no es una entrada reconocible: formato irreconocible' };
  return { ok: true, entries };
}

/** Problemas de paridad (vacío = verde). Pura: el canario le pasa textos y listas modificados. */
function parityProblems(frontendGate: string, techDebt: string, backendIds: readonly string[]): string[] {
  const out: string[] = [];
  const read = readFrontendBlockers(frontendGate);
  if (!read.ok) return [read.error];
  for (const e of read.entries.filter((x) => x.owner === 'backend')) {
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
  /** El gate del frontend con la entrada backend `id` DENTRO de la lista (la inyecta tras la apertura si el frontend ya la quitó). */
  const withEntry = (id: string) =>
    gate.includes(`id: '${id}'`) ? gate : gate.replace(DECL_OPEN, (open) => `${open}\n  { id: '${id}', what: '', owner: 'backend', closedBy: '' },`);

  it('el lector toma la lista real (hoy vacía) como leída bien, y withEntry inyecta DENTRO de la lista', () => {
    expect(readFrontendBlockers(gate)).toEqual({ ok: true, entries: [] });
    expect(withEntry('MKT-X-9')).not.toBe(gate);
    expect(readFrontendBlockers(withEntry('MKT-X-9'))).toEqual({ ok: true, entries: [{ id: 'MKT-X-9', owner: 'backend' }] });
  });
  it('CANARIO: renombrar la constante, perder el cierre o cambiar la forma de una entrada ⇒ rojo (no se lee como «vacía»)', () => {
    const renamed = gate.replace(/\bENCENDER_BLOCKERS\b(?=\s*:)/, 'ENCENDER_BLOCKERS_V2');
    expect(renamed).not.toBe(gate);
    expect(parityProblems(renamed, debt, ids)).toEqual([expect.stringMatching(/no se encontró la declaración/)]);
    const unclosed = gate.replace(/(export const ENCENDER_BLOCKERS[^\n]*\n)\];/, '$1]   ;');
    expect(unclosed).not.toBe(gate);
    expect(parityProblems(unclosed, debt, ids)).toEqual([expect.stringMatching(/sin cierre/)]);
    const quoted = gate.replace(DECL_OPEN, (o) => `${o}\n  { "id": "MKT-X-9", "what": "", "owner": "backend" },`);
    expect(parityProblems(quoted, debt, ids)).toEqual([expect.stringMatching(/formato irreconocible/)]);
    const ownerFirst = gate.replace(DECL_OPEN, (o) => `${o}\n  { owner: 'backend', id: 'MKT-X-9', what: '' },`);
    expect(parityProblems(ownerFirst, debt, ids)).toEqual([expect.stringMatching(/formato irreconocible/)]);
  });

  it('CANARIO: reabrir MKT-F2-3 sin volver a meterla en la lista del backend ⇒ rojo; reabrir MKT-TL2 ⇒ rojo si el frontend aún la tiene', () => {
    const reopenedF23 = debt.replace(/^\|\s*MKT-F2-3 ✅\s*\|/m, '| MKT-F2-3 |');
    expect(reopenedF23).not.toBe(debt);
    expect(parityProblems(withEntry('MKT-F2-3'), reopenedF23, ids)).toEqual([expect.stringMatching(/^MKT-F2-3: /)]);
    expect(parityProblems(withEntry('MKT-F2-3'), reopenedF23, [...ids, 'MKT-F2-3'])).toEqual([]);
    const reopened = debt.replace(/^\|\s*MKT-TL2 ✅\s*\|/m, '| MKT-TL2 |');
    expect(reopened).not.toBe(debt);
    expect(parityProblems(withEntry('MKT-TL2'), reopened, ids)).toEqual([expect.stringMatching(/^MKT-TL2: /)]);
  });
  it('CANARIO: una entrada del backend cuya ficha está cerrada ⇒ rojo (se quita en el mismo commit); un id sin ficha ⇒ rojo', () => {
    expect(parityProblems(gate, debt, [...ids, 'MKT-F2-3'])).toEqual([expect.stringMatching(/^MKT-F2-3: está en BACKEND_ENCENDER_BLOCKERS.*\(closed\)/)]);
    expect(parityProblems(gate, debt, [...ids, 'MKT-NOPE-9'])).toEqual([expect.stringMatching(/^MKT-NOPE-9: .*\(missing\)/)]);
  });
});
