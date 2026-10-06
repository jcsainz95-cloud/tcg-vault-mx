/** LIVE-8 · el pie solo enlaza el aviso cuando la página se sirve (LEG-2 aplicado al enlace). */
import { describe, expect, it } from 'vitest';
import { privacyNoticeWithMarkers } from '@/content/legal/test-fixtures';
import { privacyLinkVisible } from './footer';

const MARKED = privacyNoticeWithMarkers();

describe('privacyLinkVisible', () => {
  it('producción con un texto CON marcadores ⇒ sin enlace', () => {
    expect(privacyLinkVisible({ vercelEnv: 'production', nodeEnv: 'production' }, MARKED)).toBe(false);
    expect(privacyLinkVisible({ nodeEnv: 'production' }, MARKED)).toBe(false);
  });
  it('vista previa con marcadores ⇒ con enlace (al borrador)', () => {
    expect(privacyLinkVisible({ vercelEnv: 'preview', nodeEnv: 'production' }, MARKED)).toBe(true);
  });
  it('LEG-P1 · el aviso real (provisional, §14.17) ⇒ con enlace también en producción', () => {
    expect(privacyLinkVisible({ vercelEnv: 'production', nodeEnv: 'production' })).toBe(true);
    expect(privacyLinkVisible({ nodeEnv: 'production' })).toBe(true);
  });
});
