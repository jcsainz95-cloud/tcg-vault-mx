import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { AdminSellItemDTO } from '@/types/contract';
import { ReceivedVersionSelector, declaredPick, stampChoices, type ReceivedPick } from './ReceivedVersion';

const PP = { productId: 648703, type: 'prize_pack', label: 'Prize Pack' };
const item = (o: Partial<AdminSellItemDTO> = {}): AdminSellItemDTO =>
  ({ id: 'i1', card: { id: 'c', name: 'Pikachu ex' }, productType: 'raw', finish: 'holofoil', itemStatus: 'recibida', ...o }) as AdminSellItemDTO;

function Host({ it, onPick }: { it: AdminSellItemDTO; onPick: (p: ReceivedPick) => void }) {
  const [pick, setPick] = useState<ReceivedPick>(declaredPick(it));
  return (
    <ReceivedVersionSelector
      item={it}
      pick={pick}
      onChange={(n) => {
        setPick(n);
        onPick(n);
      }}
    />
  );
}

describe('ReceivedVersionSelector · idioma y versión (§BUYLIST-ES F3/F4 §4.1)', () => {
  it('sin ligas: solo la fila de idioma y el default es lo declarado (productId no aplica)', () => {
    expect(declaredPick(item({ language: 'es' }))).toEqual({ language: 'es' });
    renderWithIntl(<Host it={item()} onPick={() => {}} />);
    expect(screen.getByRole('group', { name: /Idioma recibido de/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Versión recibida/ })).toBeNull();
  });

  it('con ligas en `versions[]`: fila «Versión: Normal | liga»; default = declarado; un toque cambia y avisa que difiere', () => {
    const it = item({
      versions: [
        { key: 'en', language: 'en', stamp: null, offerCents: 50000, reason: null },
        { key: 'en.648703', language: 'en', stamp: PP, offerCents: 400000, reason: null },
      ],
    });
    expect(stampChoices(it)).toEqual([PP]);
    expect(declaredPick(it)).toEqual({ language: 'en', productId: null });
    const onPick = vi.fn();
    renderWithIntl(<Host it={it} onPick={onPick} />);
    const group = screen.getByRole('group', { name: /Versión recibida de/ });
    expect(group.querySelector('button[data-stamp="normal"]')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('received-version-mismatch-i1')).toBeNull();
    fireEvent.click(group.querySelector('button[data-stamp="648703"]')!);
    expect(onPick).toHaveBeenCalledWith({ language: 'en', productId: 648703 });
    expect(screen.getByTestId('received-version-mismatch-i1').textContent).toContain('Distinto de lo declarado (Inglés · Normal)');
  });

  it('línea declarada de liga: el default es esa liga, aunque no haya `versions`', () => {
    const it = item({ language: 'es', stamp: PP });
    expect(declaredPick(it)).toEqual({ language: 'es', productId: 648703 });
    renderWithIntl(<Host it={it} onPick={() => {}} />);
    expect(screen.getByRole('group', { name: /Versión recibida de/ }).querySelector('button[data-stamp="648703"]')).toHaveAttribute('aria-pressed', 'true');
  });

  it('en inglés: «Received language» / «Received version»', () => {
    renderWithIntl(<Host it={item({ stamp: PP })} onPick={() => {}} />, 'en');
    expect(screen.getByRole('group', { name: /Received language of/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Received version of/ })).toBeInTheDocument();
  });
});
