import { describe, it, expect } from 'vitest';
import { resolveApiAssetUrl } from './accessories';

/**
 * §AC.3 dice «rutas absolutas de la API, con versión»; el backend sirve `'/api/v1/accessories/:id/photo/:v/full'`
 * (`backend/src/modules/accessories/accessory-dto.ts:76-81`): ruta con `/`, SIN origen. La tienda vive en otro
 * origen y Next no reescribe `/api` (`next.config.mjs`, sin `rewrites`), así que la ruta se ancla al ORIGEN de
 * `NEXT_PUBLIC_API_BASE_URL`. Una URL completa (o `null`) pasa tal cual.
 */
describe('resolveApiAssetUrl', () => {
  it('ruta con «/» ⇒ origen de la API + ruta (sin duplicar /api/v1)', () => {
    expect(resolveApiAssetUrl('/api/v1/accessories/a/photo/v/full', 'https://api.tcghunt.mx/api/v1')).toBe(
      'https://api.tcghunt.mx/api/v1/accessories/a/photo/v/full',
    );
  });
  it('URL completa o nada ⇒ tal cual', () => {
    expect(resolveApiAssetUrl('https://cdn.x/y.webp', 'https://api.tcghunt.mx/api/v1')).toBe('https://cdn.x/y.webp');
    expect(resolveApiAssetUrl(null, 'https://api.tcghunt.mx/api/v1')).toBeNull();
    expect(resolveApiAssetUrl('//evil.example/x.png', 'https://api.tcghunt.mx/api/v1')).toBe('https://api.tcghunt.mx//evil.example/x.png');
  });
});
