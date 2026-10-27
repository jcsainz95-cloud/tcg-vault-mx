/**
 * MKT-F2-3 · el `what` de `ENCENDER_BLOCKERS` nombra la versión de Graph que fija el contrato (§MKT.H.1, bloque
 * `META-GRAPH-VERSION`, única fuente en `docs/`). Antes decía `v21.0` cuando el contrato ya fijaba `v26.0` (v1.112):
 * el rótulo del build habría nombrado una versión que nadie va a verificar con el botón de §MKT.H.12.
 * MKT-F2-3 salió el 2026-10-27 (evento de prueba de Meta recibido en producción con `v26.0`, HECHOS.md): la segunda
 * prueba queda dormida y solo vuelve a mirar si alguien reintroduce la entrada.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENCENDER_BLOCKERS } from './measurement-gate';

const CONTRACT = readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'API_CONTRACT.md'), 'utf8');

function contractMetaVersion(): string | undefined {
  const block = CONTRACT.split('<!-- META-GRAPH-VERSION:start -->')[1]?.split('<!-- META-GRAPH-VERSION:end -->')[0] ?? '';
  return /\|\s*`(v\d+\.\d+)`\s*\|/.exec(block)?.[1];
}

describe('MKT-F2-3 · versión de Graph en ENCENDER_BLOCKERS = la del contrato', () => {
  it('el contrato fija una versión entre marcadores', () => {
    expect(contractMetaVersion()).toMatch(/^v\d+\.\d+$/);
  });

  it('si la entrada sigue abierta, su `what` nombra esa versión y ninguna otra', () => {
    const entry = ENCENDER_BLOCKERS.find((b) => b.id === 'MKT-F2-3');
    if (!entry) return;
    const version = contractMetaVersion() as string;
    expect(entry.what).toContain(`'${version}'`);
    const named = [...entry.what.matchAll(/v\d+\.\d+/g)].map((m) => m[0]);
    expect(new Set(named)).toEqual(new Set([version]));
  });
});
