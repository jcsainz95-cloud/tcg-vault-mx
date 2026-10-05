/** LIVE-8 · el pie solo enlaza el aviso cuando la página se sirve (LEG-2 aplicado al enlace). */
import { describe, expect, it } from 'vitest';
import { privacyLinkVisible } from './footer';

describe('privacyLinkVisible', () => {
  it('producción con el borrador vigente ⇒ sin enlace', () => {
    expect(privacyLinkVisible({ vercelEnv: 'production', nodeEnv: 'production' })).toBe(false);
    expect(privacyLinkVisible({ nodeEnv: 'production' })).toBe(false);
  });
  it('vista previa ⇒ con enlace (al borrador)', () => {
    expect(privacyLinkVisible({ vercelEnv: 'preview', nodeEnv: 'production' })).toBe(true);
  });
});
