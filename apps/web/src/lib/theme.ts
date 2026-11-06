import { useEffect, useState } from "react";

const KEY = "popcorn-theme";
type Theme = "dark" | "light";

const read = (): Theme => {
  try {
    return (localStorage.getItem(KEY) as Theme) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: keep in memory only */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
