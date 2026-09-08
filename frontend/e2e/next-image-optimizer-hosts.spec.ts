import { expect, test } from '@playwright/test';

/**
 * 🔒 D-IMG-5 en el SERVIDOR CORRIENDO — `/_next/image` no es un proxy de imágenes abierto.
 *
 * Complemento E2E del candado unitario (`src/lib/next-image-remote-patterns.test.ts`). El unitario
 * pregunta al matcher de Next si la config aceptaría un host; ESTE pregunta **al servidor real, por
 * HTTP**, que es donde el atacante pregunta. Los dos importan: el unitario da el diagnóstico
 * preciso y corre en milisegundos; éste demuestra que la política llega de verdad al artefacto
 * desplegado (se hornea en el build — se comprobó en `required-server-files.json`).
 *
 * Contexto (hallazgo A-1, 2026-09-08): `next.config.mjs` llevaba desde el 2026-08-23 un
 * `{ protocol: 'https', hostname: '**' }`. `/_next/image` lo sirve Next **siempre**, importe o no
 * un componente nuestro `next/image`: con el comodín, cualquiera podía hacer que nuestro despliegue
 * descargara y procesara una imagen de SU servidor — quemando transformaciones facturables y
 * cumpliendo la precondición de GHSA-2xp9-vwfh-vxw4 (RCE sin autenticar por AVIF, parcheado
 * subiendo `next` a 15.5.24).
 */

/** Construye la petición al optimizador tal cual la haría un atacante. */
const optimizerUrl = (target: string) =>
  `/_next/image?url=${encodeURIComponent(target)}&w=640&q=75`;

test.describe('D-IMG-5 · el optimizador de imágenes solo acepta hosts de la allowlist', () => {
  test('🔴 RECHAZA (400) una imagen alojada en un host arbitrario del atacante', async ({
    request,
  }) => {
    // Éste es EXACTAMENTE el vector de A-1: el host lo elige quien hace la petición.
    const hostiles = [
      'https://evil.example/payload.avif',
      'https://attacker.test/x.png',
      // Sufijo controlado por el atacante sobre un host bueno.
      'https://images.pokemontcg.io.evil.example/x.png',
      // Subdominio del host bueno: otro endpoint, nunca verificado.
      'https://cdn.images.pokemontcg.io/x.png',
      // SSRF a metadatos de la nube / red interna.
      'https://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1/x.png',
      // Otro puerto del host bueno (lo cubre `port: ''`).
      'https://images.pokemontcg.io:8443/x.png',
    ];

    for (const target of hostiles) {
      const res = await request.get(optimizerUrl(target));
      // Next responde 400 «url parameter is not allowed» cuando el host no empata la allowlist.
      // Se asserta el 400 y NO un 200: un 2xx aquí significaría que acabamos de servir bytes que
      // un tercero eligió, desde nuestro origen.
      expect(res.status(), `/_next/image NO debe aceptar ${target}`).toBe(400);
    }
  });

  test('✅ los hosts admitidos SÍ pasan el portero de la allowlist', async ({ request }) => {
    // La otra mitad: que el cierre no se haya pasado de frenada. No se puede exigir 200 —el
    // entorno E2E no tiene salida a internet, así que la descarga aguas arriba fallará (5xx)—,
    // pero sí se puede distinguir «lo rechazó la ALLOWLIST» de «lo intentó y falló la red»:
    // el 400 de host no permitido es justo lo que NO debe ocurrir aquí.
    for (const target of [
      'https://images.pokemontcg.io/sv8/logo.png',
      'https://images.scrydex.com/me3/logo.png',
    ]) {
      const res = await request.get(optimizerUrl(target));
      expect(res.status(), `${target} no debe ser rechazado por la allowlist`).not.toBe(400);
    }
  });
});

/**
 * El otro lado del encargo: **no romper los logos de expansión**, que el humano confirmó vivos.
 *
 * Hoy esto no puede romperse por `remotePatterns` —los logos son **Nivel B**: `<img>` crudo
 * (ARCHITECTURE §4.41.7), y `remotePatterns` solo gobierna a `next/image`, del que no hay ni una
 * línea en el árbol—, y precisamente por eso el cierre del comodín fue de riesgo funcional cero.
 * Pero «no puede romperse» es una deducción, y el encargo pedía una MEDIDA. Aquí está la medida.
 */
test.describe('los logos de expansión siguen saliendo', () => {
  test('las placas con logo pintan una imagen realmente decodificada', async ({ page }) => {
    // Se sirve el logo desde el propio test (el entorno no tiene red). Lo que se mide no es el
    // CDN, sino que la placa **pide** su logo y el navegador lo pinta: si el cierre de D-IMG-5
    // hubiera bloqueado esta ruta, no habría petición que interceptar o la imagen no decodificaría.
    const requested: string[] = [];
    await page.route('**/logo.png', (route) => {
      requested.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body:
          '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="100" ' +
          'viewBox="0 0 192 100"><rect width="192" height="100" fill="#e8e4d8"/></svg>',
      });
    });

    await page.goto('/es/buylist');
    const plates = page.getByTestId('set-plate');
    await expect(plates.first()).toBeVisible();
    // `loading="lazy"`: sin recorrerlas, las de la segunda fila ni se piden.
    const count = await plates.count();
    for (let i = 0; i < count; i += 1) await plates.nth(i).scrollIntoViewIfNeeded();

    const logos = page.locator('[data-testid="set-plate"] img');
    await expect
      .poll(() => logos.count(), { message: 'ninguna placa con logo que medir' })
      .toBeGreaterThan(0);

    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[data-testid="set-plate"] img')).every(
        (el) => (el as HTMLImageElement).complete,
      ),
    );

    // `complete` es true también en una imagen ROTA: el oráculo honesto es `naturalWidth > 0`,
    // que solo es cierto si el navegador decodificó bytes de verdad.
    const widths = await logos.evaluateAll((els) =>
      els.map((el) => (el as HTMLImageElement).naturalWidth),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w, 'logo de set roto (naturalWidth = 0)').toBeGreaterThan(0);

    // Y que las URLs pedidas son las del host del contrato, no algo fabricado por el cliente.
    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(new URL(url).host).toBe('images.pokemontcg.io');
    }
  });
});
