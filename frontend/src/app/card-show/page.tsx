import { CARD_SHOW, MAILTO_PATROCINIO, WHATSAPP, LINKS } from '@/content/card-show';
import { AvisameForm } from './_components/AvisameForm';
import { TorneoForm } from './_components/TorneoForm';
import { PlanoMesas } from './_components/PlanoMesas';
import { Countdown } from './_components/Countdown';
import { TrackedLink } from './_components/TrackedLink';

/**
 * Landing del Card Show — datos REALES (decisión JC 2026-10-16). Orden: Hero (+ cuenta regresiva) →
 * Números → Qué vas a encontrar → Torneos+preinscripción → Cómo llegar → Regístrate → franja →
 * Mesas (plano + WhatsApp) → Patrocinios (mailto) → Qué es TCG HUNT → FAQ → Footer. CTA fija de
 * WhatsApp en móvil.
 *
 * ⛔ Único secreto: los NOMBRES de patrocinador. El bloque de logos va oculto (`showSponsors:false`).
 * Server Component: todo el contenido se pinta en el HTML inicial, sin `opacity:0` hasta hidratar.
 */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-4">{children}</p>;
}

const btnAccent =
  'inline-flex min-h-[48px] items-center bg-accent px-8 text-xs uppercase leading-none tracking-[0.16em] text-accent-fg hover:bg-[color:var(--hunt-red-hover)]';
const btnOutline =
  'inline-flex min-h-[48px] items-center border border-text px-8 text-xs uppercase leading-none tracking-[0.16em] text-text hover:bg-text hover:text-primary-fg';

export default function CardShowPage() {
  const c = CARD_SHOW;
  return (
    <main className="pb-20 sm:pb-0">
      {/* 1 · HERO — se pinta sin JS */}
      <section className="gutter border-b border-border-strong py-16 sm:py-24">
        <p className="font-brand text-sm uppercase tracking-wordmark text-accent">{c.hero.presenta}</p>
        <h1 className="mt-6 font-serif text-display leading-[1.05] sm:text-[3.25rem]">{c.hero.titulo}</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">{c.hero.subtitulo}</p>
        <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 font-mono text-sm">
          <div>
            <dt className="eyebrow">Fecha</dt>
            <dd className="tabular">{c.hero.fecha}</dd>
          </div>
          <div>
            <dt className="eyebrow">Horario</dt>
            <dd className="tabular">{c.hero.horario}</dd>
          </div>
          <div>
            <dt className="eyebrow">Sede</dt>
            <dd className="tabular">{c.hero.sede}</dd>
          </div>
          <div>
            <dt className="eyebrow">Entrada</dt>
            <dd>{c.hero.entrada}</dd>
          </div>
          <div>
            <dt className="eyebrow">Torneo</dt>
            <dd>{c.hero.chipTorneo}</dd>
          </div>
        </dl>
        <div className="mt-10">
          <Countdown targetIso={c.countdownTargetIso} />
        </div>
        <div className="mt-10 flex flex-wrap gap-4">
          <a href={c.hero.ctaPrimario.href} className={btnAccent}>
            {c.hero.ctaPrimario.label}
          </a>
          <a href={c.hero.ctaSecundario.href} className={btnOutline}>
            {c.hero.ctaSecundario.label}
          </a>
        </div>
      </section>

      {/* 2 · NÚMEROS */}
      <section className="gutter border-b border-border-strong py-12">
        <dl className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {c.numeros.map((n) => (
            <div key={n.label}>
              <dt className="eyebrow">{n.label}</dt>
              <dd className="mt-2 font-serif text-h2 tabular">{n.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 3 · QUÉ VAS A ENCONTRAR */}
      <section id="que-vas-a-encontrar" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Qué vas a encontrar</Eyebrow>
        <div className="grid gap-10 sm:grid-cols-2">
          {c.queEncontraras.map((b) => (
            <div key={b.titulo}>
              <h3 className="font-serif text-h3">{b.titulo}</h3>
              <p className="mt-2 text-muted">{b.texto}</p>
            </div>
          ))}
        </div>
        <a href="#registrate" className="mt-10 inline-block text-accent underline underline-offset-4">
          Avísame
        </a>
      </section>

      {/* 4 · TORNEOS + PREINSCRIPCIÓN (⛔ sin «oficial», sin cupo) */}
      <section id="torneo" className="gutter border-b border-border-strong py-16">
        <Eyebrow>{c.torneo.titulo}</Eyebrow>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <p className="max-w-prose text-muted">{c.torneo.descripcion}</p>
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 font-mono text-sm">
              {c.torneo.dias.map((d) => (
                <div key={d.id}>
                  <dt className="eyebrow">{d.label.split(' · ')[0]}</dt>
                  <dd className="tabular">{d.label.split(' · ')[1] ?? ''}</dd>
                </div>
              ))}
              <div>
                <dt className="eyebrow">Inscripción</dt>
                <dd className="tabular">{c.torneo.inscripcion}</dd>
              </div>
            </dl>
            <p className="mt-4 text-[13px] text-muted">{c.torneo.notaHorarios}</p>
          </div>
          <div>
            <h3 className="font-serif text-h3">Preinscríbete</h3>
            <div className="mt-6">
              <TorneoForm />
            </div>
          </div>
        </div>
      </section>

      {/* 5 · CÓMO LLEGAR */}
      <section id="como-llegar" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Cómo llegar</Eyebrow>
        <p className="font-mono text-sm tabular">{c.comoLlegar.direccion}</p>
        <p className="mt-4 max-w-prose text-muted">{c.comoLlegar.pisos}</p>
        <p className="mt-4 max-w-prose text-muted">{c.comoLlegar.indicaciones}</p>
        <ul className="mt-4 max-w-prose list-disc space-y-1 pl-5 text-[13px] text-muted">
          {c.comoLlegar.transporte.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {/* ⛔ Sin iframe de mapa: la CSP de la landing (frame-src, de devops) no admite google.com; un
            embed quedaría bloqueado. Se enlaza a Google Maps (navegación de primer nivel, permitida). */}
        <TrackedLink
          destino="mapa"
          href={c.comoLlegar.mapaUrl}
          target="_blank"
          className="mt-8 inline-block text-accent underline underline-offset-4"
        >
          Abrir en Google Maps
        </TrackedLink>
      </section>

      {/* 6 · REGÍSTRATE (captura pública) */}
      <section id="registrate" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Regístrate</Eyebrow>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-serif text-h2">Avísame del Card Show</h2>
            <p className="mt-4 max-w-prose text-muted">
              Déjanos tu correo y te avisamos de los horarios finales y los detalles del torneo. Dinos también si
              quieres vender o patrocinar.
            </p>
          </div>
          <div>
            <AvisameForm source="cta_hero" />
          </div>
        </div>
      </section>

      {/* 7 · FRANJA ¿Vendes o patrocinas? */}
      <section className="gutter border-b border-border-strong bg-surface-2 py-12">
        <h2 className="font-serif text-h3">¿Vendes o patrocinas?</h2>
        <div className="mt-6 flex flex-wrap gap-4">
          <a href="#mesas" className="text-accent underline underline-offset-4">
            Aparta tu mesa
          </a>
          {/* ⛔ Abre el MAILTO de patrocinio (NO scroll al formulario). */}
          <a href={MAILTO_PATROCINIO} className="text-accent underline underline-offset-4">
            Pide la propuesta de patrocinio
          </a>
        </div>
      </section>

      {/* 8 · MESAS (plano + WhatsApp) */}
      <section id="mesas" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Mesas</Eyebrow>
        <p className="max-w-prose text-muted">{c.mesas.intro}</p>
        <p className="mt-2 max-w-prose text-[13px] text-muted">{c.mesas.nota}</p>
        <p className="mt-1 max-w-prose text-[13px] text-muted">{c.mesas.montaje}</p>

        <div className="mt-8">
          <h3 className="eyebrow mb-3">Incluye</h3>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-text">
            {c.mesas.incluye.map((i) => (
              <li key={i}>· {i}</li>
            ))}
          </ul>
        </div>

        <div className="mt-10">
          <PlanoMesas />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <TrackedLink destino="whatsapp_mesas" href={WHATSAPP.apartarMesaGenerico} target="_blank" className={btnAccent}>
            Aparta tu mesa por WhatsApp
          </TrackedLink>
          <p className="font-mono text-sm tabular text-muted">
            WhatsApp <span className="text-text">{WHATSAPP.numeroDisplay}</span>
          </p>
        </div>
        <p className="mt-4 text-[13px] text-muted">
          <TrackedLink
            destino="convocatoria"
            href={c.mesas.convocatoriaUrl}
            target="_blank"
            className="text-accent underline underline-offset-4"
          >
            Ver la convocatoria de vendedores
          </TrackedLink>
        </p>
      </section>

      {/* 9 · PATROCINIOS (3 niveles, ⛔ SIN patrocinador nombrado, logos ocultos) */}
      <section id="patrocinios" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Patrocinios</Eyebrow>
        <p className="max-w-prose text-muted">{c.patrocinios.intro}</p>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {c.patrocinios.niveles.map((n) => (
            <div key={n.id} className="border-t-2 border-text pt-4">
              <h3 className="font-serif text-h3">{n.nombre}</h3>
              <p className="mt-1 font-mono text-sm tabular text-muted">{n.precio}</p>
              <ul className="mt-4 space-y-2 text-[13px] text-muted">
                {n.beneficios.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <h3 className="eyebrow mb-3">Todos los niveles incluyen</h3>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-text">
            {c.patrocinios.comunes.map((b) => (
              <li key={b}>· {b}</li>
            ))}
          </ul>
        </div>

        {/* ⛔ Logos de patrocinadores OCULTOS hasta nuevo aviso (nombres secretos). */}
        {c.patrocinios.showSponsors && (
          <div className="mt-10" aria-label="Patrocinadores">
            {/* Bloque de logos: se activa cuando JC autorice nombrar a los patrocinadores. */}
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center gap-6">
          {/* (d) El CTA abre el MAILTO, no hace scroll. */}
          <a href={c.patrocinios.cta.href} className={btnAccent}>
            {c.patrocinios.cta.label}
          </a>
          <TrackedLink
            destino="whatsapp_patrocinio"
            href={WHATSAPP.patrocinio}
            target="_blank"
            className="text-accent underline underline-offset-4"
          >
            O escríbenos por WhatsApp
          </TrackedLink>
          <TrackedLink
            destino="deck"
            href={c.patrocinios.deckUrl}
            target="_blank"
            className="text-accent underline underline-offset-4"
          >
            Ver el deck
          </TrackedLink>
        </div>
      </section>

      {/* 10 · QUÉ ES TCG HUNT (copy B) */}
      <section className="gutter border-b border-border-strong py-16">
        <Eyebrow>{c.queEsTcgHunt.titulo}</Eyebrow>
        <p className="font-serif text-h2">{c.queEsTcgHunt.lema}</p>
        <p className="mt-4 max-w-prose text-muted">{c.queEsTcgHunt.parrafo}</p>
        <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-2 font-mono text-sm text-text">
          {c.queEsTcgHunt.puntos.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
        <TrackedLink
          destino="home"
          href={c.queEsTcgHunt.cta.href}
          target="_blank"
          className="mt-8 inline-block text-accent underline underline-offset-4"
        >
          {c.queEsTcgHunt.cta.label}
        </TrackedLink>
      </section>

      {/* 11 · FAQ (expandible, funciona sin JS con <details>) */}
      <section id="faq" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Preguntas frecuentes</Eyebrow>
        <div className="divide-y divide-border">
          {c.faq.map((f) => (
            <details key={f.q} className="py-4">
              <summary className="cursor-pointer font-medium text-text marker:text-accent">{f.q}</summary>
              <p className="mt-2 max-w-prose text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 12 · FOOTER */}
      <footer className="gutter py-12 text-sm text-muted">
        <p className="font-brand text-sm uppercase tracking-wordmark text-text">{c.footer.marca}</p>
        <p className="mt-2">{c.footer.colaboracion}</p>
        <p className="mt-1 text-[13px]">{c.footer.jakomiDireccion}</p>
        <p className="mt-4 font-mono text-sm tabular">
          ¿Dudas? WhatsApp <span className="text-text">{WHATSAPP.numeroDisplay}</span>
        </p>
        <nav className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          <TrackedLink destino="whatsapp_dudas" href={WHATSAPP.dudas} target="_blank" className="hover:text-text">
            Escríbenos por WhatsApp
          </TrackedLink>
          <a href={c.footer.privacidadUrl} target="_blank" rel="noopener noreferrer" className="hover:text-text">
            Aviso de privacidad
          </a>
          <TrackedLink destino="ig_tcghunt" href={LINKS.tcgHuntIg} target="_blank" className="hover:text-text">
            Instagram TCG HUNT
          </TrackedLink>
          <TrackedLink destino="ig_jakomi" href={LINKS.jakomiIg} target="_blank" className="hover:text-text">
            Instagram Jakomi
          </TrackedLink>
        </nav>
      </footer>

      {/* CTA FIJA en móvil: WhatsApp genérico (#2). Oculta en ≥sm. */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border-strong bg-bg p-3 sm:hidden">
        <TrackedLink
          destino="whatsapp_sticky"
          href={WHATSAPP.apartarMesaGenerico}
          target="_blank"
          className={`${btnAccent} w-full justify-center`}
        >
          Aparta tu mesa por WhatsApp
        </TrackedLink>
      </div>
    </main>
  );
}
