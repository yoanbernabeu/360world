import "fake-indexeddb/auto";

if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== "function") {
  const { webcrypto } = await import("node:crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
