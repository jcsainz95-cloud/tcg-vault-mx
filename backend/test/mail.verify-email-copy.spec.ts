import { emailVerificationTemplate } from '../src/modules/mail/mail.templates';
import { escapeHtml } from '../src/modules/buylist/mail-shell';

/**
 * 🔒 v1.117.2 (API_CONTRACT §1 «Verificación de correo», D-CTA-12; DESIGN_SYSTEM §CTA-UX.3b y §CTA-UX.6 petición 7) — el correo
 * «Verifica tu correo» avisa, ANTES de abrir el enlace, que la página pedirá la contraseña (o dejará elegir una nueva). Texto
 * EXACTO de §CTA-UX.3b en ES y EN, en el texto plano y en el HTML (escapado), junto con la entrada y el botón de §CTA-UX.3b.
 * Mutación que lo pone rojo: quitar el aviso, o volver al cuerpo viejo («para poder comprar, retirar y vender»).
 */
const LINK = 'https://tienda.example.test/es/verify-email?token=abc';

const COPY = {
  es: {
    subject: 'Verifica tu correo',
    intro: 'Confirma tu correo para tu cuenta en TCG HUNT.',
    button: 'CONFIRMAR MI CORREO',
    notice:
      'Al abrir el enlace te pediremos tu contraseña. Si no creaste esta cuenta o no la recuerdas, ábrelo igual: podrás elegir una nueva. El enlace sirve una vez.',
  },
  en: {
    subject: 'Verify your email',
    intro: 'Confirm your email for your TCG HUNT account.',
    button: 'CONFIRM MY EMAIL',
    notice:
      "When you open the link we'll ask for your password. If you didn't create this account or don't remember it, open it anyway: you can choose a new one. The link works once.",
  },
} as const;

describe('«Verifica tu correo» avisa que se pedirá la contraseña (§CTA-UX.3b)', () => {
  it.each([['es'], ['en']] as const)('%s: asunto, entrada, botón y aviso exactos, en texto y HTML; sin «comprar»', (l) => {
    const m = emailVerificationTemplate(LINK, 'Ana', l);
    const c = COPY[l];
    expect(m.subject).toBe(c.subject);
    for (const part of [c.intro, c.notice]) {
      expect(m.text).toContain(part);
      expect(m.html).toContain(escapeHtml(part));
    }
    expect(m.html).toContain(c.button);
    expect(m.text).toContain(LINK);
    // El aviso va DESPUÉS del enlace (se lee al decidir abrirlo) y el cuerpo viejo no vuelve.
    expect(m.text.indexOf(c.notice)).toBeGreaterThan(m.text.indexOf(LINK));
    // (El pie común de la marca dice «Buying, selling…»; la regla es para el cuerpo de ESTE correo: el texto plano.)
    expect(m.text).not.toMatch(/comprar|buying/i);
  });
});
