// Node ≥ 22 defines a global `localStorage` getter that yields undefined unless
// Node is started with --localstorage-file, and it shadows the DOM one. Provide
// a plain in-memory Storage for tests.
if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => [...store.keys()][i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
  if (typeof window !== 'undefined')
    Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true });
}

// happy-dom lacks IntersectionObserver and scrollIntoView; provide controllable stubs.
type IOCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
const ioInstances: { callback: IOCallback; targets: Set<Element> }[] = [];
class FakeIntersectionObserver {
  private targets = new Set<Element>();
  constructor(private callback: IOCallback) {
    ioInstances.push({ callback, targets: this.targets });
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
}
Object.defineProperty(globalThis, 'IntersectionObserver', {
  value: FakeIntersectionObserver,
  configurable: true,
});
/** Simulates `el` scrolling into view (or out of it) for every observer watching it. */
(
  globalThis as unknown as { intersect: (el: Element, isIntersecting?: boolean) => void }
).intersect = (el, isIntersecting = true) => {
  for (const io of ioInstances)
    if (io.targets.has(el)) io.callback([{ target: el, isIntersecting }]);
};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
