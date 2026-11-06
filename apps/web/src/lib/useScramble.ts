import { useEffect, useState } from "react";

const GLYPHS = "!<>-_\\/[]{}=+*^?#01";

/** Resolves `text` from random glyphs, left to right. Works in every browser; no canvas. */
export function useScramble(text: string, run = true, ms = 700) {
  const [out, setOut] = useState(run ? "" : text);
  useEffect(() => {
    if (!run || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOut(text);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const fixed = Math.floor(p * text.length);
      let s = text.slice(0, fixed);
      for (let i = fixed; i < text.length; i++) s += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, run, ms]);
  return out;
}
