import type { Metadata } from 'next';
import '../fonts/google-subsets.css';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { NONCE_HEADER } from '@/security/csp';
import { CARD_SHOW } from '@/content/card-show';
import '../globals.css';

/**
 * Layout RAÍZ de `/card-show` (API_CONTRACT §CARDSHOW.2, ARCHITECTURE §4.CARDSHOW.a).
 *
 * La landing vive FUERA de `app/[locale]/`: es un árbol raíz propio con su `<html>`, para que la
 * ruta exista SIN prefijo de idioma y el middleware NO la redirija a `/es`. La CSP con nonce sí se
 * aplica (el middleware la pone en todas las rutas del matcher). Un solo idioma: `lang="es-MX"`.
 *
 * Las fuentes se redeclaran aquí (next/font/local exige argumentos literales): son los MISMOS
 * ficheros self-hospedados que usa `app/[locale]/layout.tsx`, sin petición a Google en runtime.
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
const sans = localFont({
  src: [
    { path: '../fonts/archivo/archivo-latin.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/archivo/archivo-latin.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/archivo/archivo-latin.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/archivo/archivo-latin.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-sans',
  declarations: [
    { prop: 'font-family', value: "'Archivo'" },
    { prop: 'font-stretch', value: '100%' },
  ],
  fallback: ["'Archivo Fallback'"],
  adjustFontFallback: false,
});
const mono = localFont({
  src: [
    { path: '../fonts/jetbrains-mono/jetbrains-mono-latin.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/jetbrains-mono/jetbrains-mono-latin.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mono',
  declarations: [{ prop: 'font-family', value: "'JetBrains Mono'" }],
  fallback: ["'JetBrains Mono Fallback'"],
  adjustFontFallback: false,
});
const brand = localFont({
  src: [{ path: '../fonts/montserrat/montserrat-700-latin.woff2', weight: '700', style: 'normal' }],
  display: 'swap',
  variable: '--font-brand',
  declarations: [{ prop: 'font-family', value: "'Montserrat'" }],
  fallback: ["'Montserrat Fallback'"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: 'Card Show — TCG HUNT',
  description: 'El punto de encuentro del Pokémon TCG en México. Avísame y preinscríbete al torneo.',
  // `<link rel="canonical" href="https://tcghunt.mx/card-show">` (§CARDSHOW.2).
  alternates: { canonical: CARD_SHOW.canonicalUrl },
  robots: { index: true, follow: true },
  openGraph: {
    siteName: 'TCG HUNT',
    title: 'Card Show — TCG HUNT',
    description: 'El punto de encuentro del Pokémon TCG en México.',
    type: 'website',
    locale: 'es_MX',
    url: CARD_SHOW.canonicalUrl,
  },
};

export default async function CardShowLayout({ children }: { children: React.ReactNode }) {
  // Leer la petición fuerza render POR PETICIÓN: así Next pone el nonce de la CSP de la petición en
  // sus scripts (sin esto saldría prerenderizado con scripts sin nonce; en `enforce` la CSP los
  // bloquearía).
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html
      lang={CARD_SHOW.lang}
      className={`${zenOldMincho.variable} ${sans.variable} ${mono.variable} ${brand.variable}`}
      data-csp={nonce ? 'nonce' : undefined}
    >
      <body className="min-h-dvh bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}
