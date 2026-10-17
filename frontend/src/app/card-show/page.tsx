import { CARD_SHOW } from '@/content/card-show';
import { Countdown } from './_components/Countdown';
import { RegistrationForms } from './_components/RegistrationForms';
import { StickyRegisterCta } from './_components/StickyRegisterCta';

/**
 * Landing del Card Show — PÁGINA DE CAPTURA DE LEADS (pivote del dueño JC 2026-10-17). ⛔ No expone el
 * modelo de negocio: nada de precios de mesa, plano ni montos de patrocinio. Orden (preview aprobado
 * por el dueño, `scratchpad/cardshow-preview-brand.html`, traducido al sistema de diseño):
 * Topbar → Hero (countdown + CTA único «Regístrate» + secundario a vendedor) → Colaborador (Jakomi,
 * sin enlaces) → Qué vas a encontrar → Torneos por juego → Registro (3 formularios) → FAQ →
 * Rifa (AL FINAL, con la imagen del producto) → Footer. CTA fija de «Regístrate» en móvil.
 *
 * Server Component: todo el contenido se pinta en el HTML inicial (los formularios y el countdown son
 * islas de cliente). Marca real: papel/tinta, rojo #b31217, Montserrat (`font-brand`) en títulos.
 */

const btnRed =
  'inline-flex min-h-[48px] items-center justify-center bg-accent px-7 font-mono text-xs uppercase leading-none tracking-label text-accent-fg hover:bg-[color:var(--hunt-red-hover)]';
const btnGhostInk =
  'inline-flex min-h-[48px] items-center justify-center border border-on-ink-rule px-7 font-mono text-xs uppercase leading-none tracking-label text-on-ink hover:border-on-ink';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-3">{children}</p>;
}

export default function CardShowPage() {
  const c = CARD_SHOW;
  return (
    <>
      {/* TOPBAR */}
      <header className="sticky top-0 z-20 border-b border-border bg-[color:rgba(244,241,234,0.9)] backdrop-blur">
        <div className="gutter flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-brand text-base font-bold uppercase tracking-wordmark text-text">TCG HUNT</span>
            <span className="text-muted">×</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.colaborador.logo}
              alt={c.colaborador.nombre}
              className="h-7 w-auto border border-border bg-white px-1.5 py-0.5"
            />
            <span className="font-brand text-base font-bold">Jakomi</span>
          </div>
          <a href="#registro" className={`${btnRed} px-4`}>
            Regístrate
          </a>
        </div>
      </header>

      {/* pb en móvil reserva el alto de la CTA fija para que no tape la última línea del footer. */}
      <main className="pb-[76px] sm:pb-0">
        {/* HERO */}
        <section id="hero" className="bg-ink text-on-ink">
          <div className="gutter py-14 sm:py-20">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-label text-on-ink-nav">
              {c.hero.tier.map((t, i) => (
                <span key={t} className={i === 1 ? 'text-[color:var(--hunt-red-up)]' : undefined}>
                  {t}
                  {i < c.hero.tier.length - 1 && <span className="ml-3 text-on-ink-rule">·</span>}
                </span>
              ))}
            </p>
            <h1 className="mt-4 font-brand text-[clamp(2.6rem,9vw,5rem)] font-bold leading-[1.05] text-on-ink">
              {c.hero.titulo}
              <br />
              <span className="text-[color:var(--hunt-red-up)]">{c.hero.lineaDos}</span>
            </h1>
            <p className="mt-5 max-w-[44ch] text-lg text-on-ink">{c.hero.lede}</p>

            <dl className="mt-7 flex flex-wrap gap-2">
              {c.hero.facts.map((f) => (
                <div key={f.k} className="border border-on-ink-rule px-3.5 py-2.5">
                  <dt className="font-mono text-[11px] uppercase tracking-label text-on-ink-nav">{f.k}</dt>
                  <dd className="mt-0.5 font-brand font-bold">{f.v}</dd>
                </div>
              ))}
            </dl>

            <a
              href="#rifa"
              className="mt-6 inline-flex items-center gap-2 border border-on-ink-rule border-l-2 border-l-accent px-3.5 py-2.5 font-mono text-sm text-on-ink hover:border-accent"
            >
              <span className="font-bold text-[color:var(--hunt-red-up)]">
                Rifa: set del 30.º aniversario de Pokémon
              </span>
              — sin costo. Regístrate y participa.
            </a>

            <div className="mt-7 flex flex-wrap gap-3">
              <a href={c.hero.ctaPrimario.href} className={btnRed}>
                {c.hero.ctaPrimario.label}
              </a>
              <a href="#vendedores" className={btnGhostInk}>
                {c.hero.ctaSecundario.label} →
              </a>
            </div>

            <div className="mt-8">
              <Countdown targetIso={c.countdownTargetIso} />
            </div>
          </div>
        </section>

        {/* COLABORADOR (Jakomi · SIN enlaces a sus redes) */}
        <section className="gutter border-b border-border bg-surface-2 py-10">
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
        </section>

        {/* QUÉ VAS A ENCONTRAR */}
        <section className="gutter border-b border-border py-16">
          <Eyebrow>Qué vas a encontrar</Eyebrow>
          <h2 className="font-brand text-h2 font-bold">Un fin de semana completo para la comunidad TCG</h2>
          <p className="mt-3 max-w-[60ch] text-muted">
            Pensado para jugadores y coleccionistas: compite, completa tu colección y conoce a la comunidad en persona.
          </p>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {c.queEncontraras.map((b) => (
              <div key={b.n} className="border border-border p-6">
                <p className="font-mono text-xs tracking-label text-accent">{b.n}</p>
                <h3 className="mt-2 font-brand text-h3 font-bold">{b.titulo}</h3>
                <p className="mt-2 text-sm text-muted">{b.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* TORNEOS POR JUEGO */}
        <section id="torneos" className="gutter border-b border-border py-16">
          <Eyebrow>Torneos</Eyebrow>
          <h2 className="font-brand text-h2 font-bold">Compite en tu juego</h2>
          <p className="mt-3 max-w-[60ch] text-muted">{c.torneos.intro}</p>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {c.torneos.juegos.map((g) => (
              <div key={g.id} className="border border-border">
                <div
                  className={
                    g.principal
                      ? 'flex items-center justify-between gap-3 bg-accent px-4 py-4 text-accent-fg'
                      : 'flex items-center justify-between gap-3 bg-ink px-4 py-4 text-on-ink'
                  }
                >
                  {/* text-inherit vence al `h3 { color: var(--color-text) }` global y hereda el
                      color del contenedor: accent-fg (tarjeta roja) u on-ink (tarjeta tinta). */}
                  <h3 className="font-brand font-bold text-inherit">{g.nombre}</h3>
                  <span className="font-mono text-[10px] uppercase tracking-label">{g.pill}</span>
                </div>
                <p className="px-4 py-4 text-sm text-muted">{g.linea}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 border-t border-dashed border-border pt-4 font-mono text-sm text-muted">{c.torneos.cuarto}</p>
        </section>

        {/* REGISTRO (3 formularios) */}
        <section id="registro" className="gutter border-b border-border bg-surface-2 py-16">
          <Eyebrow>Regístrate</Eyebrow>
          <h2 className="font-brand text-h2 font-bold">Déjanos tus datos</h2>
          <p className="mt-3 max-w-[60ch] text-muted">
            Elige tu perfil. Te escribimos con los detalles del evento — y si eres vendedor o patrocinador, nos
            ponemos en contacto directo.
          </p>
          <div className="mt-8">
            <RegistrationForms />
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="gutter border-b border-border py-16">
          <Eyebrow>Preguntas frecuentes</Eyebrow>
          <h2 className="font-brand text-h2 font-bold">Lo esencial</h2>
          <div className="mt-7 max-w-[760px] divide-y divide-border border-y border-border">
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

        {/* RIFA (AL FINAL, con la imagen del producto) */}
        <section id="rifa" className="bg-ink text-on-ink">
          <div className="gutter grid items-center gap-10 py-16 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
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
              <a href={c.rifa.cta.href} className={`${btnRed} mt-6`}>
                {c.rifa.cta.label}
              </a>
            </div>
            <div className="flex justify-center">
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

        {/* FOOTER */}
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
              <p>WhatsApp: {c.footer.whatsappDisplay}</p>
              <p>{c.footer.contactoEmail}</p>
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

      {/* CTA FIJA en móvil: «Regístrate». Oculta en ≥sm y mientras el hero sigue en viewport
          (no tapa el botón del hero — MENOR-3). */}
      <StickyRegisterCta
        href={c.hero.ctaPrimario.href}
        label={c.hero.ctaPrimario.label}
        anchorClassName={`${btnRed} w-full`}
      />
    </>
  );
}
