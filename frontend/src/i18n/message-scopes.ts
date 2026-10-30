import type { AbstractIntlMessages } from 'next-intl';

/**
 * PERF portada (§DYN.3, §DYN.6.7 c1; ARCHITECTURE §4.DYN (f) 8): qué parte del catálogo de traducciones viaja a
 * CADA página. Esta es la ÚNICA lista de ámbitos del árbol.
 *
 * `NextIntlClientProvider` serializa su prop `messages` en el payload RSC del HTML. Reparto:
 *  - el layout raíz (`[locale]/layout`) manda solo `SHELL_NAMESPACES`: lo que usan los componentes de CLIENTE que
 *    pintan los layouts en toda ruta (encabezado, banner de cookies, guarda de rutas privadas, `[locale]/error`);
 *  - cada segmento añade su ámbito con `RouteMessages` (`components/i18n/RouteMessages.tsx`): la portada `home`;
 *    el resto de páginas `storefront` = todo − `admin` − `SHELL` (calculado, no listado: un namespace nuevo cae ahí
 *    solo); el panel `storefront` y además `admin` (`AdminMessagesProvider`).
 * Los componentes de SERVIDOR no dependen de esto: `getTranslations`/`useTranslations` en servidor leen la config
 * de la petición, que sigue teniendo el catálogo completo.
 * Candados: `[locale]/layout.messages.test.tsx` (DYN-F10 a–c; las listas se MIDEN contra el código que importa cada
 * ámbito, no se suponen) y `e2e/route-messages.spec.ts` (d).
 */
export const ADMIN_NAMESPACE = 'admin' as const;

/** Lo que pinta el cliente en TODA ruta de `[locale]` fuera de un `RouteMessages` (medido: DYN-F10 a). */
export const SHELL_NAMESPACES = ['common', 'consent', 'nav', 'privacy', 'verifyEmail'] as const;

/**
 * Lo que usa la portada (`HomeView` y todo lo que importa) además de `SHELL` (medido: DYN-F10 a). `error` va porque
 * `QueryState` traduce los códigos del API (`error.<CODE>`) en cualquier estante que falle.
 */
export const HOME_NAMESPACES = [
  'buylist',
  'card',
  'catalog',
  'error',
  'finish',
  'home',
  'portfolio',
  'price',
  'sealed',
  'status',
  'stock',
] as const;

export type MessageScope = 'home' | 'storefront';

function pick(messages: AbstractIntlMessages, keep: (ns: string) => boolean): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(messages).filter(([ns]) => keep(ns)));
}

/** El provider raíz: solo `SHELL`. */
export function shellMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const shell = new Set<string>(SHELL_NAMESPACES);
  return pick(messages, (ns) => shell.has(ns));
}

/** Lo que AÑADE un segmento a lo que ya trae la raíz (`SHELL`). */
export function scopeMessages(messages: AbstractIntlMessages, scope: MessageScope): AbstractIntlMessages {
  const shell = new Set<string>(SHELL_NAMESPACES);
  if (scope === 'home') {
    const home = new Set<string>(HOME_NAMESPACES);
    return pick(messages, (ns) => home.has(ns) && !shell.has(ns));
  }
  return pick(messages, (ns) => ns !== ADMIN_NAMESPACE && !shell.has(ns));
}

/** Lo que tiene en total una página de la tienda que no es la portada (`SHELL` + `storefront`): todo menos `admin`. */
export function storefrontMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const { [ADMIN_NAMESPACE]: _admin, ...rest } = messages;
  void _admin;
  return rest;
}

export function adminMessagesOf(messages: AbstractIntlMessages): AbstractIntlMessages {
  const admin = messages[ADMIN_NAMESPACE];
  return admin && typeof admin === 'object' ? (admin as AbstractIntlMessages) : {};
}
