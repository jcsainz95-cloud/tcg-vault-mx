// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import * as real from './button-classes';

/**
 * TL-CTA R2: `buttonClassName` la llaman Server Components (un `<Link>` con aspecto de botón). Vive en
 * `button-classes.ts`, SIN `'use client'`. Si el módulo fuese de cliente, para el servidor cada export es una
 * *referencia de cliente*: renderizable si es componente, pero ⛔ no invocable («Attempted to call X() from the
 * server», el defecto de `db7d1c2` que vigila `app/server-client-boundary.test.ts` en page/layout).
 *
 * vitest no implementa la frontera RSC: en jsdom/node `'use client'` es una cadena suelta y el módulo es normal
 * (medido: con la directiva devuelta al fichero, importar y llamar la función real sigue en VERDE). Por eso la
 * prueba lee la directiva del fichero REAL y, si está, entrega al Server Component lo que le entregaría Next: una
 * referencia de cliente que lanza al invocarse. La prueba definitiva sigue siendo el build de producción.
 */

const FILE = path.join(__dirname, 'button-classes.ts');
const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/;

/** Lo que ve un Server Component al importar `button-classes` (regla RSC de Next, emulada). */
function serverView(): typeof real {
  if (!USE_CLIENT.test(fs.readFileSync(FILE, 'utf8'))) return real;
  return {
    ...real,
    buttonClassName: () => {
      throw new Error('Attempted to call buttonClassName() from the server but buttonClassName is on the client.');
    },
  };
}

/** Un Server Component (sin `'use client'`, sin hooks) que da a un enlace el aspecto de botón. */
function ServerLinkButton({ href, children }: { href: string; children: string }) {
  const { buttonClassName } = serverView();
  return (
    <a href={href} className={buttonClassName({ variant: 'secondary', size: 'sm', className: 'w-full' })}>
      {children}
    </a>
  );
}

describe('buttonClassName se puede llamar desde un Server Component (TL-CTA R2)', () => {
  it('button-classes.ts no lleva `use client` (ni `use server`)', () => {
    const src = fs.readFileSync(FILE, 'utf8');
    expect(USE_CLIENT.test(src)).toBe(false);
    expect(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(src)).toBe(false);
  });

  it('un Server Component que la llama renderiza el enlace con las clases del botón', () => {
    const html = renderToStaticMarkup(<ServerLinkButton href="/es/login">Entrar</ServerLinkButton>);
    expect(html).toContain('href="/es/login"');
    expect(html).toContain('>Entrar</a>');
    expect(html).toContain('border-text');
    expect(html).toContain('uppercase');
    expect(html).toContain('w-full');
  });

  it('Button.tsx no la redefine: la importa de button-classes (una sola fuente)', () => {
    const btn = fs.readFileSync(path.join(__dirname, 'Button.tsx'), 'utf8');
    expect(btn).toMatch(/from '\.\/button-classes'/);
    expect(btn).not.toMatch(/function buttonClassName/);
    expect(btn).not.toMatch(/export\s*\{[^}]*buttonClassName/);
  });
});
