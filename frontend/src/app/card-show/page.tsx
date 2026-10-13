import Link from 'next/link';
import { CARD_SHOW } from '@/content/card-show';
import { trackedHref } from '@/lib/card-show-clicks';
import { AvisameForm } from './_components/AvisameForm';
import { TorneoForm } from './_components/TorneoForm';
import { PlanoMesas } from './_components/PlanoMesas';
import { TrackedLink } from './_components/TrackedLink';

/**
 * Landing del Card Show — wireframe «público primero» (RONDA_0 §2, API_CONTRACT §CARDSHOW.2).
 * Orden: Hero → Números → Qué vas a encontrar → Torneos+preinscripción → Cómo llegar → Regístrate →
 * franja → Mesas → Patrocinios → Qué es TCG HUNT → FAQ → Footer.
 *
 * Server Component: todo el contenido (Hero y formularios incluidos) se pinta en el HTML inicial,
 * SIN JS y SIN `opacity:0` hasta hidratar. Todo dato del evento sale de `content/card-show.ts`
 * (marcadores hasta el anuncio).
 */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-4">{children}</p>;
}

export default function CardShowPage() {
  const c = CARD_SHOW;
  return (
    <main>
      {/* 1 · HERO — se pinta sin JS */}
      <section className="gutter border-b border-border-strong py-16 sm:py-24">
        <p className="font-brand text-sm uppercase tracking-wordmark text-accent">{c.footer.marca}</p>
        <h1 className="mt-6 font-serif text-display leading-[1.05] sm:text-[3.25rem]">{c.hero.titulo}</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">{c.hero.subtitulo}</p>
        <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 font-mono text-sm">
          <div>
            <dt className="eyebrow">Fecha</dt>
            <dd className="tabular">{c.hero.fecha}</dd>
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
        <div className="mt-10 flex flex-wrap gap-4">
          <a
            href={c.hero.ctaPrimario.href}
            className="inline-flex min-h-[48px] items-center bg-accent px-8 text-xs uppercase leading-none tracking-[0.16em] text-accent-fg hover:bg-[color:var(--hunt-red-hover)]"
          >
            {c.hero.ctaPrimario.label}
          </a>
          <a
            href={c.hero.ctaSecundario.href}
            className="inline-flex min-h-[48px] items-center border border-text px-8 text-xs uppercase leading-none tracking-[0.16em] text-text hover:bg-text hover:text-primary-fg"
          >
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

      {/* 4 · TORNEOS + PREINSCRIPCIÓN */}
      <section id="torneo" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Torneo oficial · {c.torneo.organizador}</Eyebrow>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <p className="max-w-prose text-muted">{c.torneo.descripcion}</p>
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 font-mono text-sm">
              <div>
                <dt className="eyebrow">Días</dt>
                <dd className="tabular">{c.torneo.dias.map((d) => d.label).join(' · ')}</dd>
              </div>
              <div>
                <dt className="eyebrow">Cupo</dt>
                <dd className="tabular">{c.torneo.cupo}</dd>
              </div>
              <div>
                <dt className="eyebrow">Cierre</dt>
                <dd className="tabular">{c.torneo.cierrePreinscripcion}</dd>
              </div>
              <div>
                <dt className="eyebrow">Preinscripción</dt>
                <dd>{c.torneo.estado === 'cerrada' ? 'Cerrada' : 'Abierta'}</dd>
              </div>
            </dl>
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
        <p className="font-mono text-sm tabular">{c.comoLlegar.zona}</p>
        <p className="mt-4 max-w-prose text-muted">{c.comoLlegar.indicaciones}</p>
        {c.comoLlegar.mapaUrl && (
          <TrackedLink
            destino="mapa"
            href={c.comoLlegar.mapaUrl}
            className="mt-6 inline-block text-accent underline underline-offset-4"
          >
            Ver en el mapa
          </TrackedLink>
        )}
      </section>

      {/* 6 · REGÍSTRATE (captura pública) */}
      <section id="registrate" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Regístrate</Eyebrow>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="font-serif text-h2">Avísame del Card Show</h2>
            <p className="mt-4 max-w-prose text-muted">
              Déjanos tu correo y te avisamos de la fecha, la sede y los detalles. Dinos también si quieres vender o
              patrocinar.
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
          <a href="#patrocinios" className="text-accent underline underline-offset-4">
            Pide la propuesta de patrocinio
          </a>
        </div>
      </section>

      {/* 8 · MESAS (plano + precios) */}
      <section id="mesas" className="gutter border-b border-border-strong py-16">
        <Eyebrow>Mesas</Eyebrow>
        <p className="max-w-prose text-muted">{c.mesas.intro}</p>
        <div className="mt-10">
          <PlanoMesas />
        </div>
        <a href="#registrate" className="mt-10 inline-block text-accent underline underline-offset-4">
          Aparta tu mesa
        </a>
      </section>

      {/* 9 · PATROCINIOS (3 niveles, SIN patrocinador nombrado) */}
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
        <a href="#registrate" className="mt-10 inline-block text-accent underline underline-offset-4">
          {c.patrocinios.cta.label}
        </a>
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
          href={trackedHref('home')}
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
        <nav className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          <Link href={c.footer.privacidadUrl} className="hover:text-text">
            Aviso de privacidad
          </Link>
          <a href={`mailto:${c.footer.contactoEmail}`} className="hover:text-text">
            Contacto
          </a>
        </nav>
      </footer>
    </main>
  );
}
