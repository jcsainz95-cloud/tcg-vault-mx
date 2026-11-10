'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AppLocale } from '@/i18n/routing';
import type { MarketingCell } from '@/types/contract';
import { annotationDate } from './mkt-format';

/**
 * Gráfica diaria de `r3` (solo se monta con `privacy: 'exact'`, §MKT-V2 D2). Dos barras apiladas, sin ejes decorados:
 * nuevos vs recurrentes y sesiones por fuente. La tabla de `r3` (en un `<details>` aparte) es la alternativa accesible.
 * Colores = tokens de DESIGN_SYSTEM (tinta, bermellón, grises); la leyenda y el tooltip dicen cuál es cuál.
 */
type Row = Record<string, MarketingCell>;

const INK = '#1a1a18';
const VERMILION = '#b31217';
const GREYS = ['#6e695e', '#a8a294', '#d8d2c2'];

const n = (c: MarketingCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : 0);

export function ResumenCharts({ rows }: { rows: Row[] }) {
  const t = useTranslations('admin.marketing.resumen.daily');
  const locale = useLocale() as AppLocale;
  const data = rows.map((r) => ({
    dia: annotationDate(String(r.dia), locale),
    nuevos: n(r.nuevos),
    recurrentes: n(r.recurrentes),
    ig_org: n(r.ses_instagram_organico),
    ig_pag: n(r.ses_instagram_pagado),
    google: n(r.ses_google),
    ia: n(r.ses_ia),
    otros: n(r.ses_directo_otros),
  }));
  const common = { margin: { top: 4, right: 4, bottom: 0, left: -20 } };
  const axis = { fontSize: 11, fill: '#6e695e' };
  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="mkt-r3-charts">
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm text-text">{t('newVsReturning')}</figcaption>
        <div role="img" aria-label={t('newVsReturning')} className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} {...common}>
              <CartesianGrid vertical={false} stroke="rgba(26,26,24,0.16)" />
              <XAxis dataKey="dia" tick={axis} tickLine={false} />
              <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
              <Tooltip isAnimationActive={false} />
              <Legend />
              <Bar dataKey="nuevos" name={t('new')} stackId="v" fill={VERMILION} isAnimationActive={false} />
              <Bar dataKey="recurrentes" name={t('returning')} stackId="v" fill={INK} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm text-text">{t('bySource')}</figcaption>
        <div role="img" aria-label={t('bySource')} className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} {...common}>
              <CartesianGrid vertical={false} stroke="rgba(26,26,24,0.16)" />
              <XAxis dataKey="dia" tick={axis} tickLine={false} />
              <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
              <Tooltip isAnimationActive={false} />
              <Legend />
              <Bar dataKey="ig_org" name={t('igOrganic')} stackId="s" fill={VERMILION} isAnimationActive={false} />
              <Bar dataKey="ig_pag" name={t('igPaid')} stackId="s" fill="#7a0d11" isAnimationActive={false} />
              <Bar dataKey="google" name={t('google')} stackId="s" fill={INK} isAnimationActive={false} />
              <Bar dataKey="ia" name={t('ai')} stackId="s" fill={GREYS[0]} isAnimationActive={false} />
              <Bar dataKey="otros" name={t('other')} stackId="s" fill={GREYS[1]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
