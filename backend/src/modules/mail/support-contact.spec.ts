import { SUPPORT_CONTACT_DEFAULT, supportContact } from './support-contact';

/**
 * v1.82 · PNL-1 (`D-PNL-2`) — el resolutor ÚNICO del buzón de soporte. DSC-6/DSC-7 a nivel de función;
 * por HTTP en `test/integration/support-contact.e2e-spec.ts`, y el barrido DSC-8 en
 * `test/support-contact.single-resolver.spec.ts`.
 */
describe('supportContact() — SUPPORT_EMAIL → DISPUTE_EVIDENCE_CONTACT → default', () => {
  const ENV_KEYS = ['SUPPORT_EMAIL', 'DISPUTE_EVIDENCE_CONTACT'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('sin ninguna ⇒ default vivo', () => {
    expect(supportContact()).toBe(SUPPORT_CONTACT_DEFAULT);
    expect(SUPPORT_CONTACT_DEFAULT).toBe('soporte@tcghunt.mx');
  });

  it('DSC-6 · las dos fijadas y distintas ⇒ gana SUPPORT_EMAIL', () => {
    process.env.SUPPORT_EMAIL = 'a@x';
    process.env.DISPUTE_EVIDENCE_CONTACT = 'b@x';
    expect(supportContact()).toBe('a@x');
  });

  it('DSC-7 · SUPPORT_EMAIL vacía y DISPUTE_EVIDENCE_CONTACT con blancos ⇒ la segunda, saneada', () => {
    process.env.SUPPORT_EMAIL = '';
    process.env.DISPUTE_EVIDENCE_CONTACT = '  b@x ';
    expect(supportContact()).toBe('b@x');
  });

  it('se lee EN CADA LLAMADA (no se fija al importar)', () => {
    process.env.SUPPORT_EMAIL = 'uno@x';
    expect(supportContact()).toBe('uno@x');
    process.env.SUPPORT_EMAIL = 'dos@x';
    expect(supportContact()).toBe('dos@x');
  });
});
