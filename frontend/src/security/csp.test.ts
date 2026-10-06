// @vitest-environment node
/**
 * LIVE-3 · SEC-HDR-2 (API_CONTRACT §14.3) — la política CSP como FUNCIÓN PURA.
 *
 * Aquí se fija el texto de la política objetivo del contrato, directiva por directiva, y lo que la
 * rodea: el nonce, la fase (`CSP_MODE`), los orígenes que salen de variables públicas y lo que
 * ⛔ nunca puede entrar (`'unsafe-inline'`/`'unsafe-eval'` en `script-src` de producción, comodín
 * de esquema, `vercel.live` fuera de la vista previa). La cabecera servida (CSP-1) se prueba en
 * `src/middleware.test.ts`; los `<script>` con nonce (CSP-2) y el script inyectado (CSP-5), en
 * `e2e/csp.spec.ts` contra el artefacto construido.
 */
import { describe, expect, it } from 'vitest';
import {
  CSP_MODE,
  DEFAULT_UPLOAD_ORIGIN,
  buildCsp,
  cspHeaderName,
  generateNonce,
  parseCsp,
  type CspEnv,
} from './csp';

const PROD: CspEnv = {
  apiBaseUrl: 'https://api.tcghunt.mx/api/v1',
  uploadOrigin: 'https://abc123.r2.cloudflarestorage.com',
  vercelEnv: 'production',
  nodeEnv: 'production',
};

function directives(env: CspEnv = PROD, nonce = 'TESTNONCE', mode: 'report-only' | 'enforce' = 'enforce') {
  return parseCsp(buildCsp(nonce, env, mode));
}

describe('LIVE-3 · política objetivo (§14.3), producción', () => {
  it('script-src: self + nonce + strict-dynamic + https: (respaldo CSP2), y nada más', () => {
    expect(directives()['script-src']).toEqual(["'self'", "'nonce-TESTNONCE'", "'strict-dynamic'", 'https:']);
  });

  it('exactamente las directivas del contrato, ni una más (un `script-src-elem` o `script-src-attr` extra anularía script-src)', () => {
    expect(Object.keys(directives())).toEqual([
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'frame-src',
      'worker-src',
      'object-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
      'upgrade-insecure-requests',
      'report-uri',
    ]);
  });

  it("⛔ ninguna directiva lleva 'unsafe-inline' salvo style-src, ni 'unsafe-eval' (producción)", () => {
    for (const [name, values] of Object.entries(directives())) {
      if (name !== 'style-src') expect(values, name).not.toContain("'unsafe-inline'");
      expect(values, name).not.toContain("'unsafe-eval'");
    }
  });

  it("⛔ script-src nunca lleva 'unsafe-inline' ni 'unsafe-eval' en producción", () => {
    const s = directives()['script-src'];
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
  });

  it('directivas fijas del contrato', () => {
    const d = directives();
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style']);
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https:']);
    expect(d['font-src']).toEqual(["'self'", 'data:']);
    expect(d['worker-src']).toEqual(["'self'", 'blob:']);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['upgrade-insecure-requests']).toEqual([]);
  });

  it('connect-src: self, origen de la API (sin ruta), Stripe, Google y el origen de subida', () => {
    expect(directives()['connect-src']).toEqual([
      "'self'",
      'https://api.tcghunt.mx',
      'https://api.stripe.com',
      'https://accounts.google.com',
      'https://abc123.r2.cloudflarestorage.com',
    ]);
  });

  it('style-src: la hoja de Google Identity con su RUTA EXACTA (v1.84.1, E-4), no el host entero', () => {
    const s = directives()['style-src'];
    expect(s).toContain('https://accounts.google.com/gsi/style');
    expect(s).not.toContain('https://accounts.google.com');
    expect(s).not.toContain('https://accounts.google.com/');
    expect(s.filter((v) => v.startsWith('https://'))).toEqual(['https://accounts.google.com/gsi/style']);
    // Igual en las dos fases y en la vista previa (no depende del entorno).
    expect(directives(PROD, 'n', 'report-only')['style-src']).toEqual(s);
    expect(directives({ ...PROD, vercelEnv: 'preview' })['style-src']).toEqual(s);
  });

  it('frame-src: Stripe (3DS incluido) y Google', () => {
    expect(directives()['frame-src']).toEqual([
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      'https://hooks.stripe.com',
      'https://accounts.google.com',
    ]);
  });

  it('report-uri apunta a POST /api/v1/telemetry/csp del origen de la API', () => {
    expect(directives()['report-uri']).toEqual(['https://api.tcghunt.mx/api/v1/telemetry/csp']);
  });

  it('sin NEXT_PUBLIC_UPLOAD_ORIGIN ⇒ el comodín de R2 del contrato', () => {
    expect(DEFAULT_UPLOAD_ORIGIN).toBe('https://*.r2.cloudflarestorage.com');
    const d = directives({ ...PROD, uploadOrigin: undefined });
    expect(d['connect-src']).toContain('https://*.r2.cloudflarestorage.com');
  });

  it('un origen de subida mal formado (ruta, comillas, `;`, comodín de esquema) NO entra: cae al de R2', () => {
    for (const bad of [
      'https://x.r2.cloudflarestorage.com/bucket',
      "https://x.com'; script-src *",
      'https:',
      '*',
      'javascript:alert(1)',
      'https://a.com https://b.com',
    ]) {
      const d = directives({ ...PROD, uploadOrigin: bad });
      expect(d['connect-src'], bad).toContain(DEFAULT_UPLOAD_ORIGIN);
      expect(d['connect-src'], bad).not.toContain(bad);
      expect(d['script-src'], bad).toEqual(["'self'", "'nonce-TESTNONCE'", "'strict-dynamic'", 'https:']);
    }
  });

  it('⛔ ninguna directiva lleva un comodín de esquema suelto salvo img-src y el respaldo CSP2', () => {
    const d = directives();
    for (const [name, values] of Object.entries(d)) {
      if (name === 'img-src' || name === 'script-src') continue;
      expect(values, name).not.toContain('https:');
      expect(values, name).not.toContain('*');
      expect(values, name).not.toContain('http:');
    }
  });

  it('⛔ vercel.live nunca en producción', () => {
    expect(buildCsp('n', PROD)).not.toContain('vercel.live');
  });
});

describe('LIVE-3 · entornos', () => {
  it('vista previa de Vercel añade https://vercel.live a script-src, frame-src y connect-src', () => {
    const d = directives({ ...PROD, vercelEnv: 'preview' });
    expect(d['script-src']).toContain('https://vercel.live');
    expect(d['frame-src']).toContain('https://vercel.live');
    expect(d['connect-src']).toContain('https://vercel.live');
  });

  it("'unsafe-eval' SOLO en next dev (NODE_ENV=development)", () => {
    expect(directives({ ...PROD, nodeEnv: 'development' })['script-src']).toContain("'unsafe-eval'");
    expect(directives({ ...PROD, nodeEnv: 'test' })['script-src']).not.toContain("'unsafe-eval'");
  });

  it('report-only ⇒ sin upgrade-insecure-requests (el navegador la ignora y ensucia la consola); el resto, idéntico', () => {
    const ro = directives(PROD, 'TESTNONCE', 'report-only');
    const enf = directives(PROD, 'TESTNONCE', 'enforce');
    expect(ro['upgrade-insecure-requests']).toBeUndefined();
    expect(enf['upgrade-insecure-requests']).toEqual([]);
    delete enf['upgrade-insecure-requests'];
    expect(ro).toEqual(enf);
  });

  it('por defecto usa la fase vigente (CSP_MODE)', () => {
    expect(buildCsp('n', PROD)).toBe(buildCsp('n', PROD, CSP_MODE));
  });

  it('API local en http ⇒ sin upgrade-insecure-requests (rompería el stack local); https ⇒ con ella', () => {
    const local = directives({ ...PROD, apiBaseUrl: 'http://localhost:3001/api/v1', vercelEnv: undefined });
    expect(local['upgrade-insecure-requests']).toBeUndefined();
    expect(local['connect-src']).toContain('http://localhost:3001');
    expect(local['report-uri']).toEqual(['http://localhost:3001/api/v1/telemetry/csp']);
    expect(directives()['upgrade-insecure-requests']).toEqual([]);
  });

  it('API base relativa o inválida ⇒ connect-src sin ella y report-uri relativo al propio origen no se inventa', () => {
    const d = directives({ ...PROD, apiBaseUrl: 'not a url' });
    expect(d['connect-src'][0]).toBe("'self'");
    expect(d['connect-src']).not.toContain('not');
    expect(d['report-uri']).toBeUndefined();
  });
});

describe('LIVE-3 · nonce', () => {
  it('base64 de 16 bytes y distinto en cada llamada', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const n = generateNonce();
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      seen.add(n);
    }
    expect(seen.size).toBe(50);
  });

  it('el nonce va en script-src tal cual', () => {
    const n = generateNonce();
    expect(directives(PROD, n)['script-src']).toContain(`'nonce-${n}'`);
  });
});

describe('LIVE-3 · fase (CSP-6)', () => {
  it('cada fase tiene su cabecera', () => {
    expect(cspHeaderName('report-only')).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeaderName('enforce')).toBe('Content-Security-Policy');
  });

  it('fase vigente: report-only (§14.3 paso 1). Pasar a enforce es un cambio consciente con baseline.conf 10038/10055 a FAIL', () => {
    // Cuando se pase a `enforce`, este caso se cambia EN EL MISMO COMMIT que la constante, y devops
    // sube 10038/10055 a FAIL en `security/baseline.conf`. Antes: medir TTFB (N=10, §14.3).
    expect(CSP_MODE).toBe('report-only');
  });
});
