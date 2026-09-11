import { greetingName } from '../src/modules/mail/greeting-name';
import { emailVerificationTemplate, passwordResetTemplate } from '../src/modules/mail/mail.templates';
import { MailService } from '../src/modules/mail/mail.service';
import { MailMessage } from '../src/modules/mail/mail.port';

/**
 * v1.67 (Stream A · B6, ARCHITECTURE §4.47.5 / D-CTA-5) — los correos de cuenta NO saludan con un nombre
 * que el sistema fabricó (`nameSource='derived'`): «Hola:» / «Hi,». Con `user`/`google` (o sin
 * `nameSource`, llamadores antiguos) saludan con nombre. El escape HTML (S15-B1) se conserva.
 */
describe('greetingName()', () => {
  it('derived ⇒ null (aunque el nombre no esté vacío)', () => {
    expect(greetingName({ name: 'jcsainz95', nameSource: 'derived' })).toBeNull();
  });
  it.each(['user', 'google'] as const)('%s ⇒ el nombre (trim)', (src) => {
    expect(greetingName({ name: '  Ana Pérez ', nameSource: src })).toBe('Ana Pérez');
  });
  it('sin nameSource (llamador antiguo) ⇒ el nombre', () => {
    expect(greetingName({ name: 'Ana' })).toBe('Ana');
    expect(greetingName({ name: 'Ana', nameSource: null })).toBe('Ana');
  });
  it('nombre vacío/blanco ⇒ null (no se saluda con «Hola :»)', () => {
    expect(greetingName({ name: '   ', nameSource: 'user' })).toBeNull();
    expect(greetingName({ name: '', nameSource: 'google' })).toBeNull();
  });
});

describe('plantillas de cuenta — saludo con y sin nombre', () => {
  const LINK = 'https://app.tcghunt.mx/es/x?token=T';

  it.each([
    ['emailVerification', emailVerificationTemplate],
    ['passwordReset', passwordResetTemplate],
  ] as const)('%s ES: null ⇒ «Hola:» en html y text; nombre ⇒ «Hola Ana:»', (_n, tpl) => {
    const sin = tpl(LINK, null, 'es');
    expect(sin.html).toContain('<p>Hola:</p>');
    expect(sin.text.startsWith('Hola:\n')).toBe(true);
    expect(sin.html).not.toMatch(/Hola\s+:/);
    const con = tpl(LINK, 'Ana', 'es');
    expect(con.html).toContain('<p>Hola Ana:</p>');
    expect(con.text.startsWith('Hola Ana:\n')).toBe(true);
  });

  it.each([
    ['emailVerification', emailVerificationTemplate],
    ['passwordReset', passwordResetTemplate],
  ] as const)('%s EN: null ⇒ «Hi,»; nombre ⇒ «Hi Bob,»', (_n, tpl) => {
    const sin = tpl(LINK, null, 'en');
    expect(sin.html).toContain('<p>Hi,</p>');
    expect(sin.text.startsWith('Hi,\n')).toBe(true);
    const con = tpl(LINK, 'Bob', 'en');
    expect(con.html).toContain('<p>Hi Bob,</p>');
    expect(con.text.startsWith('Hi Bob,\n')).toBe(true);
  });

  it('S15-B1 se conserva: el nombre sigue escapado en el HTML', () => {
    const { html, text } = passwordResetTemplate(LINK, `O'Brien & Co <b>`, 'es');
    expect(html).toContain('Hola O&#39;Brien &amp; Co &lt;b&gt;:');
    expect(html).not.toContain('<b>');
    expect(text).toContain(`Hola O'Brien & Co <b>:`);
  });
});

describe('MailService — aplica greetingName() según nameSource', () => {
  type Send = jest.Mock<Promise<void>, [MailMessage]>;
  const mkSend = (): Send => jest.fn(async (_m: MailMessage) => undefined);
  const svc = (send: Send) => new MailService({ send } as never);
  const LINK = 'https://app.tcghunt.mx/es/verify?token=T';

  it('derived ⇒ el correo NO lleva el nombre fabricado', async () => {
    const send = mkSend();
    await svc(send).sendEmailVerification(
      { email: 'jcsainz95@x.com', name: 'jcsainz95', nameSource: 'derived', locale: 'es' },
      LINK,
    );
    const msg = send.mock.calls[0][0];
    expect(msg.to).toBe('jcsainz95@x.com');
    expect(msg.html).toContain('<p>Hola:</p>');
    expect(msg.html).not.toContain('jcsainz95');
    expect(msg.text).not.toContain('jcsainz95');
  });

  it('google ⇒ saluda con nombre (reset)', async () => {
    const send = mkSend();
    await svc(send).sendPasswordReset({ email: 'a@x.com', name: 'Ana', nameSource: 'google', locale: 'en' }, LINK);
    expect(send.mock.calls[0][0].html).toContain('<p>Hi Ana,</p>');
  });

  it('sin nameSource (compatibilidad) ⇒ saluda con nombre, como antes', async () => {
    const send = mkSend();
    await svc(send).sendEmailVerification({ email: 'a@x.com', name: 'Ana', locale: 'es' }, LINK);
    expect(send.mock.calls[0][0].html).toContain('<p>Hola Ana:</p>');
  });
});
