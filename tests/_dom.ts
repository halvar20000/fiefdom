/**
 * The little of the browser the pure modules touch: localStorage. A Map with
 * the Storage methods, installed on globalThis before the module under test
 * is imported (which is why tests import this file first).
 */
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
(globalThis as unknown as { localStorage: typeof storage }).localStorage = storage;
export {};
