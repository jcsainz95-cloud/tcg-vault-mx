'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Toggle claro/oscuro (DESIGN_SYSTEM §8.2): prefers-color-scheme + manual. */
export function ThemeToggle() {
  const t = useTranslations('common');
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem('tcg.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefersDark;
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('tcg.theme', next ? 'dark' : 'light');
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('theme')}
      aria-pressed={dark}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-surface-2"
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
