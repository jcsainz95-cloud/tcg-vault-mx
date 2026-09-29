import type { Metadata } from 'next';
import { Archivo, JetBrains_Mono, Montserrat } from 'next/font/google';
import localFont from 'next/font/local';
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
/*
 * P-FONTS-CJK: Zen Old Mincho es una familia CJK y `next/font/google` IGNORA `subsets: ['latin']`
 * en ella: Google la trocea en ~122 tramos unicode-range por peso y los glifos latinos quedan
 * repartidos en ~22 de ellos (`$`, `N`, `=`… cada uno en un tramo distinto). Medido: 366 woff2
 * de esta familia en `.next/static/media` y 242 precargados por este layout. El sitio no tiene
 * ni un carácter japonés, así que se sirve la MISMA familia recortada a latín (3 ficheros de
 * ~16 KB), generada con `frontend/scripts/subset-zen-old-mincho.sh`. Licencia OFL al lado.
 */
const zenOldMincho = localFont({
  src: [
    { path: '../fonts/zen-old-mincho/zen-old-mincho-latin-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/zen-old-mincho/zen-old-mincho-latin-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/zen-old-mincho/zen-old-mincho-latin-600.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-serif',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
  adjustFontFallback: 'Times New Roman',
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
// Marca TCG HUNT (§17.1e): Montserrat 700, EXCLUSIVA del wordmark/lockup.
// Un peso, un uso: no entra en la escala tipográfica de §3.
const brand = Montserrat({
  subsets: ['latin'],
  weight: ['700'],
  display: 'swap',
  variable: '--font-brand',
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
  // §17.4: patrón de título «TCG HUNT — {página}» y og:site_name "TCG HUNT".
  // La imagen OG (PNG 1200×630 del lockup) queda pendiente de export con la fuente
  // resuelta (§17.3); el layout vive en public/branding/og-tcg-hunt.svg.
  const title = `${t('appName')} — ${t('tagline')}`;
  return {
    title,
    description: t('tagline'),
    openGraph: {
      siteName: t('appName'),
      title,
      description: t('tagline'),
      type: 'website',
    },
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
    <html
      lang={locale}
      className={`${zenOldMincho.variable} ${sans.variable} ${mono.variable} ${brand.variable}`}
    >
      <head>
        {/* PERF — TODAS las imágenes de carta (catálogo, carrusel, carritos, bóveda, admin)
            vienen de un TERCERO. Sin esto, el navegador solo empieza el DNS + TCP + TLS cuando
            descubre el primer <img> del HTML, y paga ese handshake completo antes del primer
            byte de píxel. El `preconnect` lo adelanta al parseo del <head>; el `dns-prefetch`
            es el respaldo para navegadores que ignoran el primero. Van los DOS por host y en
            este orden — es el patrón canónico, no una redundancia.

            SON DOS HOSTS, no uno — el mismo conjunto cerrado que gobierna `next.config.mjs`
            (`images.remotePatterns`) y `SET_IMAGE_HOSTS` en el backend:
              · images.pokemontcg.io — CDN histórico (arte de todos los sets hasta 2026-08).
              · images.scrydex.com   — CDN vigente desde 2026-09; sirve el arte de los sets
                NUEVOS (me2pt5/me3/me4/me5…), 661 cartas ya en producción. Omitirlo dejaba SIN
                calentar la conexión justo para las cartas más recientes —las que más se ven en
                el carrusel del home y en las primeras páginas del catálogo—, que pagaban el
                handshake frío entero al aparecer su primer <img>. Este era el hueco medido de
                perf de imágenes: el preconnect existía solo para el CDN viejo.

            El CDN de sellado (tcgplayer-cdn.tcgplayer.com) NO entra: en la home vive en
            SealedShelf, por DEBAJO del carrusel (bajo el pliegue), y ahí `lazy` + conexión
            tardía es el comportamiento correcto.
            SIN `crossOrigin`: un `<img>` normal no se pide en modo CORS, y un preconnect
            `anonymous` abre una conexión de OTRA piscina que esas imágenes no reutilizarían
            (sería trabajo de más y ahorro cero). El `crossorigin` es para fuentes/fetch CORS. */}
        <link rel="preconnect" href="https://images.pokemontcg.io" />
        <link rel="dns-prefetch" href="https://images.pokemontcg.io" />
        <link rel="preconnect" href="https://images.scrydex.com" />
        <link rel="dns-prefetch" href="https://images.scrydex.com" />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-text antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
