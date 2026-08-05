// A v4-shaped UUID generator using Math.random — not cryptographically
// secure, but these ids only need to be unique enough to dedupe message
// rows, never anything security-sensitive. Avoids pulling in a native
// crypto module (and the prebuild it would require) for that.
export function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
