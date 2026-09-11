import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';

// Presupuesto de espera de las utilidades async de Testing Library (`findBy*`, `waitFor`).
// El default de RTL es 1000ms, medido para un test suelto. Esta suite corre 125 archivos en
// forks paralelos sobre 4 núcleos, y varias vistas (M2/M9/admin) montan árboles grandes con
// react-query encima de mocks que ya cuestan ~120ms: bajo contención de CPU esos `findBy*`
// rozaban el segundo y caían por RELOJ, no por defecto de producto (síntoma: el mismo test
// pasa suelto y falla en la corrida completa, y el test que cae cambia de corrida a corrida).
// Subir el techo no esconde nada: si el elemento no aparece NUNCA, el test sigue fallando —
// solo tarda más en rendirse. Va acompañado de `testTimeout` en vitest.config.ts, que debe
// quedar por encima de este valor para que el fallo real sea el de la aserción y no el del test.
configure({ asyncUtilTimeout: 5000 });

// Polyfill de ResizeObserver para jsdom (lo usa recharts ResponsiveContainer, §7.17).
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}

// Polyfill de matchMedia para jsdom (lo usa ThemeToggle para leer prefers-color-scheme).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
