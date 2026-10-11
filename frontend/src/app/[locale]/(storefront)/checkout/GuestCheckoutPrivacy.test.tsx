/**
 * LIVE-8 · sitio 3 del aviso de privacidad: la casilla de términos del checkout de invitado
 * (API_CONTRACT §14.14 E-9 lote 2 y §14.17 E4-3; DESIGN_SYSTEM §80.1–§80.3, F-5; criterio 505 i).
 *
 * Lo que se vigila:
 *  - dentro de la ETIQUETA de la casilla, «términos» y «aviso de privacidad» enlazan (pestaña nueva);
 *  - la frase no cambia ni una palabra respecto de la que el cliente ya aceptaba (§80.3);
 *  - sin página servida, la frase sigue entera y sin enlace al aviso (⛔ nunca un enlace a un 404);
 *  - el resumen de errores usa texto plano derivado de LA MISMA clave (§80.1).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { PrivacyLinkProvider } from '@/components/legal/PrivacyNoticeLink';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/checkout',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, createGuestCheckoutSession: vi.fn() };
});

import { createGuestCheckoutSession } from '@/lib/api';
import { GuestCheckoutView } from './GuestCheckoutView';
import { clearUnavailableNotice } from './unavailable-notice';

/** La frase de antes del lote 2 (`checkout.guest.acceptTerms`, retirada), literal: no cambia ni una palabra. */
const PHRASE_ES = 'Acepto los términos y el aviso de privacidad, y entiendo que todas las ventas son finales.';
const PHRASE_EN = 'I accept the terms and the privacy notice, and I understand that all sales are final.';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearUnavailableNotice();
  vi.mocked(createGuestCheckoutSession).mockReset();
  window.localStorage.setItem('tcg.cart', JSON.stringify({ ids: ['inv-1002'], updatedAt: Date.now() }));
});

async function openGuestForm(linked: boolean, locale: 'es' | 'en' = 'es') {
  const usr = userEvent.setup();
  renderWithProviders(
    <PrivacyLinkProvider linked={linked}>
      <GuestCheckoutView onPaid={vi.fn()} onAccountReady={vi.fn()} />
    </PrivacyLinkProvider>,
    locale,
  );
  const cta = locale === 'es' ? 'Continuar como invitado' : 'Continue as guest';
  await usr.click(await screen.findByRole('button', { name: cta }));
  const box = document.getElementById('guest-terms') as HTMLInputElement;
  expect(box).not.toBeNull();
  const label = document.querySelector('label[for="guest-terms"]') as HTMLLabelElement;
  expect(label).not.toBeNull();
  return { usr, box, label };
}

/** Texto visible (sin el aviso para lector de pantalla). */
function visibleText(el: Element, hidden = /\s*\((se abre en otra pestaña|opens in a new tab)\)/g) {
  return el.textContent!.replace(hidden, '');
}

describe('LIVE-8 · sitio 3 — casilla de términos del checkout de invitado', () => {
  it('con la página servida: «términos» y «aviso de privacidad» enlazan DENTRO de la etiqueta, en pestaña nueva', async () => {
    const { label, box } = await openGuestForm(true);
    const note = label.querySelector('[data-testid="privacy-site-guestCheckout"]')!;
    expect(note).not.toBeNull();
    expect(note.tagName).toBe('SPAN'); // dentro de <label> no cabe un <p>

    const privacy = note.querySelector('a[href="/privacidad"]')!;
    expect(privacy).not.toBeNull();
    expect(privacy).toHaveAttribute('target', '_blank');
    expect(privacy.getAttribute('rel') ?? '').toMatch(/\bnoopener\b/);
    expect(privacy.textContent).toBe('aviso de privacidad (se abre en otra pestaña)');

    const terms = note.querySelector('a[href="/terminos"]')!;
    expect(terms).not.toBeNull();
    expect(terms).toHaveAttribute('target', '_blank');

    expect(visibleText(note)).toBe(PHRASE_ES);
    // La casilla sigue nombrada por su etiqueta (empieza por la frase de siempre).
    expect(screen.getByRole('checkbox', { name: /^Acepto los términos/ })).toBe(box);
  });

  it('sin página servida: la frase sigue entera y el aviso va sin enlace (términos sí)', async () => {
    const { label } = await openGuestForm(false);
    const note = label.querySelector('[data-testid="privacy-site-guestCheckout"]')!;
    expect(note.querySelector('a[href="/privacidad"]')).toBeNull();
    expect(note.querySelector('[data-privacy-link="off"]')?.textContent).toBe('aviso de privacidad');
    expect(note.querySelector('a[href="/terminos"]')).not.toBeNull();
    expect(visibleText(note)).toBe(PHRASE_ES);
  });

  it('en inglés: misma frase de antes, con los dos enlaces', async () => {
    const { label } = await openGuestForm(true, 'en');
    const note = label.querySelector('[data-testid="privacy-site-guestCheckout"]')!;
    expect(note.querySelector('a[href="/privacidad"]')!.textContent).toBe('privacy notice (opens in a new tab)');
    expect(visibleText(note)).toBe(PHRASE_EN);
  });

  it('marcar la casilla sigue funcionando con los enlaces dentro de la etiqueta', async () => {
    const { usr, box } = await openGuestForm(true);
    expect(box.checked).toBe(false);
    await usr.click(box);
    expect(box.checked).toBe(true);
  });

  it('resumen de errores: la casilla se nombra en TEXTO PLANO derivado de la misma clave', async () => {
    const { usr } = await openGuestForm(true);
    await usr.type(screen.getByLabelText('Correo electrónico'), 'juan@dominio.com');
    await usr.click(screen.getByRole('checkbox', { name: /Confirmo que/ }));
    await usr.click(screen.getByRole('button', { name: /Pagar/ }));
    const alerts = await screen.findAllByRole('alert');
    const item = alerts.map((el) => el.querySelector('a[href="#guest-terms"]')).find(Boolean)!;
    expect(item).not.toBeNull();
    expect(item.textContent).toBe(`${PHRASE_ES}: Para pagar, acepta los términos.`);
    expect(item.querySelector('a')).toBeNull(); // sin enlaces anidados
    expect(createGuestCheckoutSession).not.toHaveBeenCalled();
  });
});
