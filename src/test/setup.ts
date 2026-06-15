import '@testing-library/jest-dom';

// Vitest exposes import.meta.env from process.env automatically,
// but we also need to ensure globals are available for modules that
// use browser APIs (e.g., TextEncoder/TextDecoder in jsdom).
// TextEncoder is available in Node but not always on globalThis in jsdom.
import { TextEncoder, TextDecoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}
