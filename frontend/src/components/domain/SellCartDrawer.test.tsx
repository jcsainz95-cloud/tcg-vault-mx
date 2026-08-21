import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SellCartDrawer } from './SellCartDrawer';

/** Props mínimas del drawer (el copy real viene de BuylistView; aquí es literal). */
const BASE = {
  ariaLabel: 'Carrito de venta (2)',
  title: 'Carrito de venta',
  countLabel: '2 carta(s)',
  closeLabel: 'Cerrar carrito',
};

describe('SellCartDrawer (§18.4b) · drawer flotante del carrito', () => {
  it('cerrado: no renderiza nada (ni overlay ni diálogo)', () => {
    render(
      <SellCartDrawer open={false} onClose={vi.fn()} {...BASE}>
        <p>contenido</p>
      </SellCartDrawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('contenido')).not.toBeInTheDocument();
  });

  it('abierto: dialog con aria-modal + aria-label, encabezado (título + conteo), contenido y cierre 44px', () => {
    render(
      <SellCartDrawer open onClose={vi.fn()} {...BASE}>
        <p>contenido</p>
      </SellCartDrawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Carrito de venta (2)' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Carrito de venta')).toBeInTheDocument();
    expect(screen.getByText('2 carta(s)')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar carrito' })).toBeInTheDocument();
    // Foco inicial en el panel del diálogo.
    expect(dialog).toHaveFocus();
  });

  it('cierra con Esc, con clic en el overlay y con el botón cerrar (no con clic dentro)', () => {
    const onClose = vi.fn();
    render(
      <SellCartDrawer open onClose={onClose} {...BASE}>
        <p>contenido</p>
      </SellCartDrawer>,
    );

    fireEvent.click(screen.getByText('contenido'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('sell-cart-overlay'));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar carrito' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('focus trap: Tab desde el último focusable regresa al primero (cerrar) y Shift+Tab al revés', () => {
    render(
      <SellCartDrawer open onClose={vi.fn()} {...BASE}>
        <button type="button">Vaciar carrito</button>
      </SellCartDrawer>,
    );
    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: 'Cerrar carrito' });
    const lastBtn = screen.getByRole('button', { name: 'Vaciar carrito' });

    lastBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(lastBtn).toHaveFocus();
  });

  it('TL-C2: si el foco escapa FUERA del panel con el diálogo abierto, el guard de focusin lo reencauza al panel', () => {
    render(
      <>
        <button type="button">Fuera del diálogo</button>
        <SellCartDrawer open onClose={vi.fn()} {...BASE}>
          <p>contenido</p>
        </SellCartDrawer>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();

    // Un focus fuera del panel (p. ej. Tab escapado desde <body> hacia detrás del scrim,
    // o focus programático) dispara focusin a nivel document → se devuelve al panel.
    screen.getByRole('button', { name: 'Fuera del diálogo' }).focus();
    expect(dialog).toHaveFocus();
  });

  it('TL-C2: al DESMONTARSE el elemento enfocado (quitar la última línea), el foco no cae a <body>: vuelve al panel', () => {
    // Reproduce el bug: el trap vivía solo en onKeyDown del panel; al desmontar el botón
    // enfocado el foco caía a <body> y Tab se escapaba detrás del scrim con el diálogo abierto.
    function Harness() {
      const [hasLine, setHasLine] = useState(true);
      return (
        <SellCartDrawer open onClose={vi.fn()} {...BASE}>
          {hasLine ? (
            <button type="button" onClick={() => setHasLine(false)}>
              Quitar
            </button>
          ) : (
            <p>Tu carrito está vacío.</p>
          )}
        </SellCartDrawer>
      );
    }
    render(<Harness />);
    const remove = screen.getByRole('button', { name: 'Quitar' });
    remove.focus();
    expect(remove).toHaveFocus();

    fireEvent.click(remove);
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    // El foco quedó DENTRO del diálogo (en el panel), no en <body>.
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('al cerrar, el foco REGRESA al elemento de returnFocusRef (el FAB)', () => {
    function Harness() {
      const fabRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" ref={fabRef}>
            FAB
          </button>
          <SellCartDrawer
            open={open}
            onClose={() => setOpen(false)}
            returnFocusRef={fabRef}
            {...BASE}
          >
            <p>contenido</p>
          </SellCartDrawer>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar carrito' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FAB' })).toHaveFocus();
  });
});
