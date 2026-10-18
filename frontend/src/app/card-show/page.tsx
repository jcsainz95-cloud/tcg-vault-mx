import { CARD_SHOW } from '@/content/card-show';
import { LogoTcgHunt } from '@/components/domain/LogoTcgHunt';
import { Countdown } from './_components/Countdown';
import { RegistrationForms } from './_components/RegistrationForms';
import { StickyRegisterCta } from './_components/StickyRegisterCta';
import { CardShowMotion } from './_components/CardShowMotion';
import { HeroTicket } from './_components/HeroTicket';

/**
 * Landing del Card Show — PÁGINA DE CAPTURA DE LEADS (pivote del dueño JC 2026-10-17) con RESTYLE
 * dinámico (JC 2026-10-18): más movimiento en las TRANSICIONES entre secciones, manteniendo la línea
 * TCG HUNT y SIN perder nada de lo gateado (doble opt-in, anti-abuso, rifa separada y desmarcada,
 * formularios Vendedor/Patrocinador + TorneoForm, StickyRegisterCta, páginas de acción, §CS-UX.3).
 *
 * ⛔ No expone el modelo de negocio: nada de precios de mesa, plano ni montos de patrocinio. Orden:
 * Topbar (lockup TCG HUNT × Jakomi) → Hero (ink, countdown + ticket con parallax + CTA «Regístrate»)
 * → Colaborador (Jakomi, sin enlaces) → Cuándo y dónde (línea de tiempo de 2 días) → Qué encontrarás
 * → Torneos (tira horizontal con scroll-snap) → Registro (3 formularios) → FAQ → Rifa (al final, con
 * la imagen) → Footer.
 *
 * MOVIMIENTO (ver `card-show.css` + `CardShowMotion`): superficies que alternan tinta↔papel al bajar
 * (la «versión negativa» de la página), reveals al entrar en viewport, parallax sutil del ticket del
 * hero y cuenta regresiva viva. Progressive enhancement: todo se pinta SSR y se ve sin JS; con
 * `prefers-reduced-motion: reduce` el sitio queda estático y legible (gate de ux-review + e2e).
 *
 * Server Component: todo el contenido va en el HTML inicial; formularios, countdown, ticket (parallax)
 * y el motor de reveals son islas de cliente. Marca real: papel/tinta, Montserrat (`font-brand`) en
 * títulos (§CS-UX.4), mono en cifras/etiquetas, rojo `#E0353B` sobre tinta (§CS-UX.1).
 */

const btnRed =
  'inline-flex min-h-[48px] items-center justify-center bg-accent px-7 font-mono text-xs uppercase leading-none tracking-label text-accent-fg hover:bg-[color:var(--hunt-red-hover)]';
// CTA sobre TINTA (§CS-UX.1 variante A): relleno #E0353B (no #B31217, 2.50:1), etiqueta papel. El
// relleno #E0353B sobre tinta separa a 3.94:1 (WCAG 1.4.11) y el hover oscurece un 6%.
const btnRedOnInk =
  'inline-flex min-h-[48px] items-center justify-center bg-hunt-red-on-ink px-7 font-mono text-xs uppercase leading-none tracking-label text-accent-fg hover:brightness-95';
const btnGhostInk =
  'inline-flex min-h-[48px] items-center justify-center border border-on-ink-rule px-7 font-mono text-xs uppercase leading-none tracking-label text-on-ink hover:border-on-ink';
// CTA compacto del topbar sobre TINTA (§CS-UX.1 variante B): etiqueta mono pequeña ⇒ relleno #B31217
// (papel 6.18:1) MÁS contorno de 2px papel (el relleno solo da 2.50:1 contra la tinta; el contorno
// separa a 15.5:1, WCAG 1.4.11). Se oculta en <360px: el CTA principal vive en el hero (§CS-UX.5).
const btnTopbarInk =
  'hidden min-[360px]:inline-flex min-h-[44px] items-center justify-center border-2 border-on-ink bg-accent px-4 font-mono text-[11px] uppercase leading-none tracking-label text-accent-fg hover:bg-[color:var(--hunt-red-hover)]';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-3">{children}</p>;
}

/**
 * Índice mono de sección (NN / Nombre). Los tonos cambian por superficie para cumplir contraste
 * (§CS-UX.1/.2): sobre PAPEL rojo de marca #B31217 (6.2:1) + muted (4.55:1); sobre TINTA
 * hunt-red-up (5.6:1) + on-ink-nav (6.46:1). ⛔ el rojo claro y el nav NO leen sobre papel.
 */
function SectionIndex({ n, label, tone }: { n: string; label: string; tone: 'ink' | 'paper' }) {
  const nCls = tone === 'ink' ? 'text-[color:var(--hunt-red-up)]' : 'text-accent';
  const labelCls = tone === 'ink' ? 'text-on-ink-nav' : 'text-muted';
  return (
    <span className={`font-mono text-xs tracking-label ${nCls}`}>
      {n} <span className={labelCls}>/ {label}</span>
    </span>
  );
}

export default function CardShowPage() {
  const c = CARD_SHOW;
  return (
    <div data-cs-root>
      {/* TOPBAR (tinta) — lockup «TCG HUNT × Jakomi» con el LOGO real (§CS-UX.5): solo-mira + wordmark
          nowrap con tracking responsivo + logo Jakomi (≥12px, ⛔ nunca oculto). */}
      <header className="sticky top-0 z-30 border-b border-on-ink-rule bg-ink text-on-ink">
        <div className="gutter flex items-center justify-between gap-3 py-3.5">
          <div
            className="flex items-center gap-2 whitespace-nowrap sm:gap-2.5"
            aria-label="TCG HUNT por Jakomi"
          >
            <LogoTcgHunt variant="mark-dark" size={30} decorative className="shrink-0" />
            <span className="font-brand font-bold uppercase leading-none tracking-[0.02em] text-[14px] text-on-ink min-[360px]:tracking-[0.04em] min-[390px]:tracking-wordmark min-[390px]:text-base">
              TCG&nbsp;HUNT
            </span>
            <span aria-hidden className="mx-1.5 font-mono text-sm text-[color:var(--hunt-red-up)] min-[360px]:mx-2">
              ×
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.colaborador.logo}
              alt={c.colaborador.nombre}
              className="h-5 w-auto shrink-0 border border-on-ink-rule bg-white px-1 py-0.5 min-[390px]:h-6"
            />
          </div>
          <a href="#registro" className={btnTopbarInk}>
            Regístrate
          </a>
        </div>
      </header>

      {/* pb en móvil reserva el alto de la CTA fija para que no tape la última línea del footer. */}
      <main className="pb-[76px] sm:pb-0">
        {/* HERO (tinta) */}
        <section id="hero" className="bg-ink text-on-ink scroll-mt-[73px]">
          <div className="gutter grid items-end gap-x-14 gap-y-10 py-14 sm:py-20 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="cs-reveal">
              <div className="mb-5 flex items-center gap-4">
                <p className="eyebrow">{c.hero.fecha}</p>
                <span aria-hidden className="h-px flex-1 bg-[color:var(--hunt-red-up)] opacity-60" />
              </div>
              <h1 className="font-brand text-[clamp(2.9rem,11vw,5.6rem)] font-bold leading-[0.95] tracking-[-0.01em] text-on-ink">
                {c.hero.titulo}
                <br />
                <span className="text-[color:var(--hunt-red-up)]">{c.hero.lineaDos}</span>
              </h1>
              <p className="mt-5 max-w-[44ch] text-lg text-on-ink">{c.hero.lede}</p>

              <a
                href="#rifa"
                className="mt-6 inline-flex items-center gap-2 border border-on-ink-rule border-l-2 border-l-[color:var(--hunt-red-on-ink)] px-3.5 py-2.5 font-mono text-sm text-on-ink hover:border-[color:var(--hunt-red-on-ink)]"
              >
                <span className="font-bold text-[color:var(--hunt-red-up)]">
                  Rifa: set del 30.º aniversario de Pokémon
                </span>
                — sin costo. Regístrate y participa.
              </a>

              <div className="mt-7 flex flex-wrap gap-3">
                <a href={c.hero.ctaPrimario.href} className={btnRedOnInk}>
                  {c.hero.ctaPrimario.label}
                </a>
                <a href="#vendedores" className={btnGhostInk}>
                  {c.hero.ctaSecundario.label} →
                </a>
              </div>

              <div className="mt-9 border-t border-on-ink-rule pt-7">
                <Countdown targetIso={c.countdownTargetIso} />
              </div>
            </div>

            {/* Ticket del evento con parallax sutil (isla de cliente). */}
            <div className="cs-reveal cs-delay-1 lg:pb-2">
              <HeroTicket facts={c.hero.facts} acceso={c.hero.entrada} />
            </div>
          </div>
        </section>

        {/* COLABORADOR (papel · Jakomi, SIN enlaces a sus redes) */}
        <section className="gutter border-b border-border bg-surface-2 py-10">
          <div className="cs-reveal">
            <p className="font-mono text-[11px] uppercase tracking-label text-muted">{c.colaborador.label}</p>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.colaborador.logo}
                alt={c.colaborador.nombre}
                className="h-20 w-20 border border-border bg-white object-contain p-2"
              />
              <div className="min-w-0">
                <h2 className="font-brand text-h3 font-bold">{c.colaborador.nombre}</h2>
                <p className="mt-1 max-w-[48ch] text-sm text-muted">{c.colaborador.descripcion}</p>
              </div>
            </div>
          </div>
        </section>

        {/* CUÁNDO Y DÓNDE (papel · línea de tiempo de 2 días + sede como lista con reglas) */}
        <section id="cuando-donde" className="gutter scroll-mt-[73px] border-b border-border py-16">
          <div className="cs-reveal flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
            <div>
              <Eyebrow>{c.evento.eyebrow}</Eyebrow>
              <h2 className="font-brand text-h2 font-bold">{c.evento.titulo}</h2>
            </div>
            <SectionIndex n="01" label="Agenda" tone="paper" />
          </div>

          {/* Línea de tiempo: dos días, no rejilla de tarjetas. */}
          <div className="cs-reveal mt-9 grid border border-border sm:grid-cols-2">
            {c.evento.horarios.map((h, i) => (
              <div
                key={h.dia}
                className={
                  i === 0
                    ? 'border-b border-border p-6 sm:border-b-0 sm:border-r sm:p-8'
                    : 'p-6 sm:p-8'
                }
              >
                <p className="font-mono text-[11px] uppercase tracking-label text-accent">{`Día ${String(i + 1).padStart(2, '0')}`}</p>
                <h3 className="mt-2 font-brand text-h3 font-bold">{h.dia}</h3>
                <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-dashed border-border pt-3">
                  <span className="text-sm text-muted">Puertas</span>
                  <span className="tabular font-mono text-text">{h.horas}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="cs-reveal mt-4 text-sm text-text">{c.evento.entrada}</p>
          <p className="cs-reveal rule-note mt-4 py-2 text-sm text-muted">{c.evento.torneoPokemon}</p>
          <p className="cs-reveal mt-3 text-sm text-muted">{c.evento.montaje}</p>

          {/* Sede + cómo llegar como lista con reglas. */}
          <div className="cs-reveal mt-9 grid gap-8 md:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-label text-accent">Dirección</p>
              <address className="mt-3 not-italic text-sm leading-relaxed text-text">
                {c.evento.direccion.calle}
                <br />
                {c.evento.direccion.colonia}
                <br />
                {c.evento.direccion.cp}
              </address>
              <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">
                {c.evento.direccion.pisos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <a
                href={c.evento.direccion.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 border border-border-strong px-3.5 py-2 font-mono text-xs uppercase tracking-label text-text hover:border-text"
              >
                {c.evento.direccion.mapsLabel} →
              </a>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-label text-accent">Cómo llegar</p>
              <ol className="mt-3 border-t border-border">
                {c.evento.comoLlegar.map((via, i) => (
                  <li key={via} className="flex items-start gap-4 border-b border-border py-3 text-sm">
                    <span className="font-mono text-xs tracking-label text-accent">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-text">{via}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* QUÉ VAS A ENCONTRAR (papel) */}
        <section className="gutter border-b border-border py-16">
          <div className="cs-reveal">
            <Eyebrow>Qué vas a encontrar</Eyebrow>
            <h2 className="font-brand text-h2 font-bold">Un fin de semana completo para la comunidad TCG</h2>
            <p className="mt-3 max-w-[60ch] text-muted">
              Pensado para jugadores y coleccionistas: compite, completa tu colección y conoce a la comunidad en
              persona.
            </p>
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {c.queEncontraras.map((b, i) => (
              <div key={b.n} className={`cs-reveal border border-border p-6 ${i === 1 ? 'cs-delay-1' : i === 2 ? 'cs-delay-2' : ''}`}>
                <p className="font-mono text-xs tracking-label text-accent">{b.n}</p>
                <h3 className="mt-2 font-brand text-h3 font-bold">{b.titulo}</h3>
                <p className="mt-2 text-sm text-muted">{b.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* TORNEOS POR JUEGO (tinta · tira horizontal con scroll-snap, no rejilla) */}
        <section id="torneos" className="bg-ink text-on-ink scroll-mt-[73px]">
          <div className="gutter py-16">
            <div className="cs-reveal flex flex-wrap items-end justify-between gap-4 border-b border-on-ink-rule pb-5">
              <div>
                <p className="eyebrow mb-3">Torneos</p>
                <h2 className="font-brand text-h2 font-bold text-on-ink">Compite en tu juego</h2>
              </div>
              <SectionIndex n="02" label="Juego" tone="ink" />
            </div>
            <p className="cs-reveal mt-6 max-w-[60ch] text-on-ink-muted">{c.torneos.intro}</p>
          </div>

          {/* La tira sangra hasta el borde: scroll horizontal con snap. */}
          <div
            className="cs-reveal cs-rail flex overflow-x-auto border-y border-on-ink-rule"
            role="group"
            aria-label="Torneos por juego — desliza para ver los cuatro"
          >
            {c.torneos.juegos.map((g) => (
              <div
                key={g.id}
                className="cs-rail-item relative min-w-[78vw] border-r border-on-ink-rule p-7 last:border-r-0 sm:min-w-[340px]"
              >
                {g.principal && (
                  <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-hunt-red-on-ink" />
                )}
                <p className="font-mono text-[10px] uppercase tracking-label text-[color:var(--hunt-red-up)]">
                  {g.pill}
                </p>
                <h3 className="mt-3 font-brand text-h2 font-bold text-on-ink">{g.nombre}</h3>
                <p className="mt-3 min-h-[4.5em] text-sm text-on-ink-muted">{g.linea}</p>
                <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-on-ink-rule pt-4">
                  <span className="font-mono text-[11px] uppercase tracking-label text-on-ink-nav">Inscripción</span>
                  <span className="font-brand text-xl font-bold text-[color:var(--hunt-red-up)]">{g.precio}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="gutter py-16">
            <p className="cs-reveal font-mono text-sm text-on-ink-muted">{c.torneos.cuarto}</p>
            {/* Abre la pestaña «Preinscríbete al torneo» y pone el foco en el primer campo (§CARDSHOW.3). */}
            <a href="#preinscribete" className={`${btnRedOnInk} cs-reveal mt-6`}>
              Preinscríbete
            </a>
          </div>
        </section>

        {/* REGISTRO (papel · 3 formularios) */}
        <section id="registro" className="gutter scroll-mt-[73px] border-b border-border bg-surface-2 py-16">
          <div className="cs-reveal">
            <Eyebrow>Regístrate</Eyebrow>
            <h2 className="font-brand text-h2 font-bold">Déjanos tus datos</h2>
            <p className="mt-3 max-w-[60ch] text-muted">
              Elige tu perfil. Te escribimos con los detalles del evento — y si eres vendedor o patrocinador, nos
              ponemos en contacto directo.
            </p>
          </div>
          <div className="cs-reveal mt-8">
            <RegistrationForms />
          </div>
        </section>

        {/* FAQ (papel) */}
        <section id="faq" className="gutter scroll-mt-[73px] border-b border-border py-16">
          <div className="cs-reveal">
            <Eyebrow>Preguntas frecuentes</Eyebrow>
            <h2 className="font-brand text-h2 font-bold">Lo esencial</h2>
          </div>
          <div className="cs-reveal mt-7 max-w-[760px] divide-y divide-border border-y border-border">
            {c.faq.map((f) => (
              <details key={f.q} className="py-4">
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-brand font-bold text-text marker:text-accent">
                  {f.q}
                  <span aria-hidden className="text-accent">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-[68ch] text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* RIFA (tinta · AL FINAL, con la imagen del producto) */}
        <section id="rifa" className="bg-ink text-on-ink scroll-mt-[73px]">
          <div className="gutter grid items-center gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="cs-reveal">
              <p className="mb-3 font-mono text-[11px] uppercase tracking-label text-[color:var(--hunt-red-up)]">
                {c.rifa.eyebrow}
              </p>
              <h2 className="font-brand text-h1 font-bold text-on-ink">{c.rifa.titulo}</h2>
              <p className="mt-4 max-w-[40ch] text-on-ink">{c.rifa.lede}</p>
              <ol className="mt-6 flex flex-col gap-2.5">
                {c.rifa.pasos.map((p, i) => (
                  <li key={p} className="flex items-start gap-3 text-sm">
                    <span className="w-5 shrink-0 font-mono font-bold text-[color:var(--hunt-red-up)]">{i + 1}</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-6 border border-on-ink-rule px-3.5 py-3 font-mono text-xs leading-relaxed text-on-ink-nav">
                {c.rifa.bases}
              </p>
              <a href={c.rifa.cta.href} className={`${btnRedOnInk} mt-6`}>
                {c.rifa.cta.label}
              </a>
            </div>
            <div className="cs-reveal cs-delay-1 flex justify-center">
              {/* Imagen del PRODUCTO aprobada; fácil de sustituir (cambia `rifa.imagen` en content/card-show.ts).
                  El NOMBRE EXACTO del premio (`rifa.premio`) va como TEXTO visible en el figcaption —
                  fuente de verdad única, no se hardcodea (MENOR-1, tester-e2e 2026-10-17). */}
              <figure className="flex w-full max-w-[360px] flex-col items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.rifa.imagen}
                  alt={c.rifa.imagenAlt}
                  className="w-full border border-on-ink-rule bg-white p-3 object-contain"
                />
                <figcaption className="text-center">
                  <span className="block font-mono text-[11px] uppercase tracking-label text-on-ink-nav">
                    El premio
                  </span>
                  <span className="mt-1 block font-brand font-bold text-on-ink">{c.rifa.premio}</span>
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* FOOTER (tinta) */}
        <footer className="bg-ink text-on-ink">
          <div className="gutter flex flex-wrap justify-between gap-7 py-12">
            <div>
              <p className="font-brand text-base font-bold uppercase tracking-wordmark">{c.footer.marca}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-label text-on-ink-nav">{c.footer.wordmarkSub}</p>
            </div>
            <nav aria-label="Evento" className="flex flex-col gap-1.5 text-sm">
              <p className="mb-1 font-mono text-[11px] uppercase tracking-label text-on-ink-nav">Evento</p>
              <a href="#torneos" className="hover:text-[color:var(--hunt-red-up)]">
                Torneos
              </a>
              <a href="#rifa" className="hover:text-[color:var(--hunt-red-up)]">
                Rifa
              </a>
              <a href="#registro" className="hover:text-[color:var(--hunt-red-up)]">
                Registro
              </a>
              <a href="#faq" className="hover:text-[color:var(--hunt-red-up)]">
                Preguntas
              </a>
            </nav>
            <div className="flex flex-col gap-1.5 text-sm">
              <p className="mb-1 font-mono text-[11px] uppercase tracking-label text-on-ink-nav">Contacto</p>
              <a
                href={c.footer.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[color:var(--hunt-red-up)]"
              >
                WhatsApp: {c.footer.whatsappDisplay}
              </a>
              <a href={c.footer.contactoEmailHref} className="hover:text-[color:var(--hunt-red-up)]">
                {c.footer.contactoEmail}
              </a>
              <a
                href={c.footer.privacidadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[color:var(--hunt-red-up)]"
              >
                Aviso de privacidad
              </a>
            </div>
            <p className="w-full border-t border-on-ink-rule pt-5 text-xs leading-relaxed text-on-ink-nav">
              {c.footer.legal}
            </p>
          </div>
        </footer>
      </main>

      {/* CTA FIJA en móvil: «Regístrate». Oculta en ≥sm y mientras el hero o el registro siguen en
          viewport (no tapa el botón del hero ni el panel de éxito — MENOR-3/BLOQ-4). */}
      <StickyRegisterCta
        href={c.hero.ctaPrimario.href}
        label={c.hero.ctaPrimario.label}
        anchorClassName={`${btnRed} w-full`}
      />

      {/* Motor de movimiento (reveals al scroll). No pinta nada; respeta reduced-motion y PE. */}
      <CardShowMotion />
    </div>
  );
}
