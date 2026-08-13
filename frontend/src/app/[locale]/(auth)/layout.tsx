import { LocaleToggle } from '@/components/ui/LocaleToggle';
import { Link } from '@/i18n/navigation';
import { Zap } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center justify-between p-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-text">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-fg">
            <Zap size={18} aria-hidden />
          </span>
          TCG Vault
        </Link>
        <LocaleToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
          {children}
        </div>
      </main>
    </div>
  );
}
