import type { AbstractIntlMessages } from 'next-intl';

/**
 * PERF portada (§DYN.3): qué parte del catálogo de traducciones viaja a CADA página.
 *
 * `NextIntlClientProvider` serializa su prop `messages` en el payload RSC del HTML. El layout de
 * `[locale]` mandaba `getMessages()` entero, y el namespace `admin` es el 74 % de `es.json`
 * (medido 2026-10-29: 303 987 de 411 590 B en el HTML de `/es`): todo visitante anónimo de la
 * tienda descargaba los textos del back-office.
 *
 * Regla: el layout raíz manda `storefrontMessages(...)` (todo menos `admin`), y el layout de
 * `/admin` añade `admin` en el cliente con `AdminMessagesProvider` (sin re-enviar el resto).
 * Los componentes de servidor no dependen de esto: `getTranslations` lee la config de la
 * petición, que sigue teniendo el catálogo completo.
 */
export const ADMIN_NAMESPACE = 'admin' as const;

export function storefrontMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const { [ADMIN_NAMESPACE]: _admin, ...rest } = messages;
  void _admin;
  return rest;
}

export function adminMessagesOf(messages: AbstractIntlMessages): AbstractIntlMessages {
  const admin = messages[ADMIN_NAMESPACE];
  return admin && typeof admin === 'object' ? (admin as AbstractIntlMessages) : {};
}
