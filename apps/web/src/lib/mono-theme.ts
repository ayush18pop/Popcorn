// Monochrome syntax themes for Shiki: white, grey, black. No hue.
const make = (name: string, type: "dark" | "light", fg: string, mid: string, dim: string, bg: string) => ({
  name,
  type,
  colors: { "editor.background": bg, "editor.foreground": fg },
  settings: [
    { settings: { foreground: fg, background: bg } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: dim, fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "constant.numeric", "constant.language"], settings: { foreground: mid } },
    { scope: ["keyword", "storage", "storage.type", "keyword.control"], settings: { foreground: fg, fontStyle: "bold" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: fg } },
    { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: mid } },
  ],
});

export const monoDark = make("popcorn-dark", "dark", "#EDEDED", "#8A8A8A", "#5C5C5C", "#111111");
export const monoLight = make("popcorn-light", "light", "#0A0A0A", "#6B6B6B", "#A8A8A8", "#FAFAFA");
export const monoThemes = { light: monoLight, dark: monoDark } as never;
