/**
 * 🔒 CANDADO D-IMG-5 — `images.remotePatterns` no puede volver a admitir un host arbitrario.
 *
 * ## Por qué existe este fichero
 * El 2026-08-23 entró en `next.config.mjs` un `{ protocol: 'https', hostname: '**' }`. Sobrevivió
 * **dos semanas** en producción sin que lo señalara NADIE: no está en `SECURITY_NOTES`, ni en
 * `PENTEST_NOTES`, ni en `TECH_DEBT`, ni en `FRONTEND_NOTES`. Lo encontró el blue team en el cierre
 * de release del 2026-09-08 (hallazgo **A-1**), agravando un `next@15.5.23` vulnerable a
 * **GHSA-2xp9-vwfh-vxw4** (RCE sin autenticar en el optimizador de imágenes, vía AVIF): el comodín
 * es *justo* la precondición del aviso, porque deja que un tercero elija QUÉ imagen —y de qué
 * servidor— procesa nuestro despliegue.
 *
 * Una revisión humana ya falló una vez. Por eso el guardarraíl es un test, no una nota.
 *
 * ## Qué mide, y por qué así
 * Mide **CONDUCTA, no texto**. Un test que hiciera `expect(fuente).not.toContain("'**'")` sería
 * teatro: pasa en verde con `hostname: '*'`, con `'**.io'`, con un `images.domains` heredado, o con
 * el comodín construido por concatenación. Aquí se hace la única pregunta que importa —
 * **«¿esta configuración aceptaría una URL de un host que controla el atacante?»**— y se hace con
 * `hasRemoteMatch`, **el mismo matcher que Next ejecuta en `/_next/image`**. Si el matcher dice que
 * sí, el optimizador diría que sí.
 *
 * Se evalúa la **política efectiva**, que son DOS campos, no uno: `remotePatterns` y el legacy
 * `images.domains`. Reintroducir el agujero por `domains` es igual de fácil y el candado también
 * lo cubre.
 *
 * ⚠️ Este control es **independiente de que hoy exista o no `next/image`** en el árbol. `/_next/image`
 * lo sirve el servidor de Next **siempre**, lo importe o no un componente nuestro: hoy el arte de
 * carta y los logos de set son Nivel B (`<img>` crudo, ARCHITECTURE §4.41.7), así que el comodín
 * era *inerte de cara al render* pero **NUNCA inerte de cara al endpoint**.
 *
 * ## Si este test se pone rojo
 * NO lo relajes ni lo borres. Cerrarlo tiene una sola forma correcta: si necesitas un host nuevo,
 * **añade el host exacto** a `remotePatterns` — detrás del backend, nunca por delante (§5.3.4) —
 * y añádelo también a `HOSTS_QUE_DEBEN_PASAR` de abajo, con su procedencia.
 */
import { describe, expect, it } from 'vitest';
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern.js';

// El config REAL, tal cual lo carga Next (pasa por el plugin de next-intl). Importarlo —en vez de
// redeclarar los patrones aquí— es lo que hace que el candado vigile el fichero de verdad: una
// copia local se quedaría en verde mientras `next.config.mjs` se pudre.
import nextConfig from '../../next.config.mjs';

type RemotePatternish = Parameters<typeof hasRemoteMatch>[1][number];

const images = (nextConfig as { images?: { remotePatterns?: unknown; domains?: unknown } }).images;

const remotePatterns = (images?.remotePatterns ?? []) as RemotePatternish[];
const domains = (images?.domains ?? []) as string[];

/** ¿Aceptaría el optimizador de Next esta URL con la config vigente? */
function optimizerWouldAccept(url: string): boolean {
  return hasRemoteMatch(domains, remotePatterns, new URL(url));
}

/**
 * Los dos hosts legítimos, con su procedencia. Espejo de `SET_IMAGE_HOSTS`
 * (`backend/src/modules/catalog/catalog-sync.service.ts`).
 */
const HOSTS_QUE_DEBEN_PASAR = [
  // CDN histórico: logos de todos los sets hasta 2026-08.
  'https://images.pokemontcg.io/sv8/logo.png',
  // CDN vigente desde 2026-09 (sets me2pt5/me3/me4/me5 en adelante). Ya servía arte de 661 cartas
  // en producción antes de admitirse en la lista del backend (ARCHITECTURE §4.41.1 hecho 8).
  'https://images.scrydex.com/me3/logo.png',
];

describe('D-IMG-5 · images.remotePatterns no admite hosts arbitrarios', () => {
  it('la config expone una política de imagen inspeccionable (si esto falla, el resto no mide nada)', () => {
    // Guarda de integridad del propio candado: si alguien renombra o borra `images.remotePatterns`,
    // `hasRemoteMatch` recibiría `[]` y TODO pasaría a denegado ⇒ los asserts de abajo seguirían
    // verdes por la razón equivocada y el candado se volvería decorativo sin avisar.
    expect(Array.isArray(remotePatterns)).toBe(true);
    expect(remotePatterns.length).toBeGreaterThan(0);
  });

  it('🔴 RECHAZA un host arbitrario controlado por el atacante', () => {
    const hostilURLs = [
      // El caso canónico del aviso: el atacante sirve el AVIF desde su propio servidor.
      'https://evil.example/payload.avif',
      'https://attacker.test/x.png',
      // Sufijo controlado por el atacante sobre un host bueno (rompe cualquier `startsWith`).
      'https://images.pokemontcg.io.evil.example/x.png',
      'https://images.scrydex.com.evil.example/x.png',
      // Subdominio de un host bueno: es OTRO endpoint, nunca verificado (rompe `endsWith`).
      'https://cdn.images.pokemontcg.io/x.png',
      'https://cdn.images.scrydex.com/x.png',
      // Host bueno como subdominio del malo.
      'https://images.pokemontcg.io.attacker.test/x.png',
      // SSRF a la red interna / metadatos de la nube.
      'https://169.254.169.254/latest/meta-data/',
      'https://localhost/x.png',
      'https://127.0.0.1/x.png',
      // userinfo: el host REAL es el de después de la `@`.
      'https://images.pokemontcg.io@evil.example/x.png',
      // Puerto distinto = endpoint distinto.
      'https://images.pokemontcg.io:8443/x.png',
    ];

    for (const url of hostilURLs) {
      expect(optimizerWouldAccept(url), `el optimizador NO debe aceptar ${url}`).toBe(false);
    }
  });

  it('🔴 RECHAZA hosts aleatorios (un comodín no se puede esconder de esto)', () => {
    // Property-style: hosts irrepetibles generados en tiempo de ejecución. Ningún literal que
    // alguien pueda haber añadido a la allowlist «para que el test pase» los cubre; solo un
    // comodín real los aceptaría. Es la prueba que un assert sobre el texto del fichero no da.
    for (let i = 0; i < 250; i += 1) {
      const host = `h${Math.random().toString(36).slice(2)}${i}.example`;
      const url = `https://${host}/img.avif`;
      expect(optimizerWouldAccept(url), `el optimizador NO debe aceptar ${url}`).toBe(false);
    }
  });

  it('🔴 RECHAZA http:// incluso en los hosts admitidos (solo https, §5.3.4)', () => {
    expect(optimizerWouldAccept('http://images.pokemontcg.io/sv8/logo.png')).toBe(false);
    expect(optimizerWouldAccept('http://images.scrydex.com/me3/logo.png')).toBe(false);
  });

  it('✅ SIGUE ACEPTANDO los dos hosts legítimos de logos de set', () => {
    // La otra mitad del candado: impide «arreglar» un rojo vaciando la lista. Cerrar de más
    // rompería los logos de los sets nuevos (me2pt5/me3/me4/me5+) el día que alguna superficie
    // suba a Nivel A, que es exactamente el fallo que este proyecto ya conoce.
    for (const url of HOSTS_QUE_DEBEN_PASAR) {
      expect(optimizerWouldAccept(url), `el optimizador DEBE aceptar ${url}`).toBe(true);
    }
  });

  it('🔴 el legacy images.domains no reabre el agujero por la puerta de atrás', () => {
    // `domains` está deprecado, pero Next lo sigue honrando y acepta el host ENTERO sin patrón.
    // Si alguien lo reintroduce, la política efectiva se ensancha sin tocar `remotePatterns`.
    expect(domains).toEqual([]);
  });
});
