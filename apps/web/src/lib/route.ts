import { useEffect, useState } from "react";

/** Hash routes, so the site stays a static bundle with no server rewrites. `#/modules/pause/guarded-vault` → ["modules", "pause", "guarded-vault"]. */
export type Page = "home" | "modules" | "examples" | "explorer" | "skills" | "mcp" | "docs";

const PAGES: Page[] = ["modules", "examples", "explorer", "skills", "mcp", "docs"];

export interface Route {
  page: Page;
  parts: string[];
}

const parse = (): Route => {
  const [head = "", ...parts] = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const page = PAGES.find((p) => p === head) ?? "home";
  return { page, parts: page === "home" ? [] : parts };
};

export function useRoute(): Route {
  const [state, setState] = useState(parse);
  useEffect(() => {
    const on = () => {
      const next = parse();
      setState((prev) => {
        // a new page starts at the top; an anchor inside the same page does not
        if (prev.page !== next.page || prev.parts.slice(0, 2).join("/") !== next.parts.slice(0, 2).join("/")) window.scrollTo({ top: 0 });
        return next;
      });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return state;
}

export const href = (page: Page, ...parts: string[]) => (page === "home" ? "#/" : `#/${[page, ...parts].join("/")}`);

export const go = (page: Page, ...parts: string[]) => {
  window.location.hash = href(page, ...parts).slice(1);
};
