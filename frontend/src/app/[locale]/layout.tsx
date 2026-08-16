import type { Metadata } from 'next';
import { Archivo, JetBrains_Mono, Zen_Old_Mincho } from 'next/font/google';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { routing, type AppLocale } from '@/i18n/routing';
import { Providers } from '@/components/Providers';
import '../globals.css';

/*
 * Dirección 5a: mincho para títulos, Archivo para UI, mono para cifras.
 * Self-hospedadas vía next/font (la mejora que FRONTEND_NOTES dejaba pendiente
 * cuando Inter se declaraba solo por nombre): sin petición a Google en runtime,
 * sin FOUT y con las variables que consume tailwind.config.ts.
 */
const serif = Zen_Old_Mincho({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-serif',
});
const sans = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-mono',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    title: `${t('appName')} · ${t('tagline')}`,
    description: t('tagline'),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as AppLocale)) notFound();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-bg font-sans text-text antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
