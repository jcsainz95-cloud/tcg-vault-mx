import '@testing-library/jest-dom/vitest';

// Polyfill de ResizeObserver para jsdom (lo usa recharts ResponsiveContainer, §7.17).
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}
