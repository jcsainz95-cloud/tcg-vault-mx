import { MailService } from '../src/modules/mail/mail.service';
import { NoopMailAdapter } from '../src/modules/mail/noop-mail.adapter';
import {
  emailVerificationTemplate,
  passwordResetTemplate,
} from '../src/modules/mail/mail.templates';

/**
 * v1.5 — MailService con el NoopMailAdapter (mockeado): construye el mensaje bilingüe por
 * `User.locale`, fija el destinatario y pasa el link al puerto sin enviar realmente.
 */
describe('MailService (Noop adapter)', () => {
  const LINK = 'https://app.tcgvaultmx.com/es/verify-email?token=ABC';

  it('sendEmailVerification (es): asunto en español, to=email y link en html+text', async () => {
    const noop = new NoopMailAdapter();
    const spy = jest.spyOn(noop, 'send');
    const svc = new MailService(noop);

    await svc.sendEmailVerification({ email: 'a@x.com', name: 'Ana', locale: 'es' }, LINK);

    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0];
    expect(msg.to).toBe('a@x.com');
    expect(msg.subject).toMatch(/Verifica/);
    expect(msg.html).toContain(LINK);
    expect(msg.text).toContain(LINK);
  });

  it('sendEmailVerification (en): asunto en inglés', async () => {
    const noop = new NoopMailAdapter();
    const spy = jest.spyOn(noop, 'send');
    const svc = new MailService(noop);

    await svc.sendEmailVerification({ email: 'b@x.com', name: 'Bob', locale: 'en' }, LINK);
    expect(spy.mock.calls[0][0].subject).toMatch(/Verify/);
  });

  it('sendPasswordReset: usa la plantilla de reset y el destinatario correcto', async () => {
    const noop = new NoopMailAdapter();
    const spy = jest.spyOn(noop, 'send');
    const svc = new MailService(noop);
    const resetLink = 'https://app.tcgvaultmx.com/es/reset-password?token=XYZ';

    await svc.sendPasswordReset({ email: 'c@x.com', name: 'Cy', locale: 'es' }, resetLink);
    const msg = spy.mock.calls[0][0];
    expect(msg.to).toBe('c@x.com');
    expect(msg.subject).toMatch(/Restablece/);
    expect(msg.html).toContain(resetLink);
  });

  it('locale ausente → default español', async () => {
    const noop = new NoopMailAdapter();
    const spy = jest.spyOn(noop, 'send');
    const svc = new MailService(noop);
    await svc.sendEmailVerification({ email: 'd@x.com', name: 'Dee' }, LINK);
    expect(spy.mock.calls[0][0].subject).toMatch(/Verifica/);
  });
});

/**
 * S15-B1 — escape de HTML en los valores dinámicos (name/link) del cuerpo HTML de TODAS las
 * plantillas (verificación y reset, ES y EN). Cierra el defecto de inyección: `User.name` es
 * dato controlado por el usuario y antes se interpolaba en crudo.
 */
describe('mail.templates — escape de HTML (S15-B1)', () => {
  const XSS = '<script>alert("x")</script>';
  const templates: Array<[string, (l: string, n: string, loc?: string) => { html: string }]> = [
    ['emailVerification', emailVerificationTemplate],
    ['passwordReset', passwordResetTemplate],
  ];

  for (const [label, fn] of templates) {
    for (const locale of ['es', 'en']) {
      it(`${label} (${locale}): escapa < > " ' & del name en el HTML`, () => {
        const { html } = fn('https://app.tcgvaultmx.com/x?token=T', XSS, locale);
        // El HTML NO debe contener el payload crudo (no hay <script> vivo ni comillas sin escapar).
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('</script>');
        expect(html).not.toContain('alert("x")');
        // Sí debe contener la versión escapada del payload.
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&quot;');
      });
    }
  }

  it("escapa el apóstrofo (') y el ampersand (&) del name", () => {
    const { html } = passwordResetTemplate('https://app.tcgvaultmx.com/x?token=T', `O'Brien & Co <b>`, 'es');
    expect(html).toContain('O&#39;Brien &amp; Co &lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
});
