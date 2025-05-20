const win: (Window & typeof globalThis) | undefined =
  typeof window !== "undefined" ? window : undefined;

const global: typeof globalThis | undefined =
  typeof globalThis !== "undefined" ? globalThis : win;
export const document = global?.document as Document;

export { win as window };

export const fetch = window.fetch;
