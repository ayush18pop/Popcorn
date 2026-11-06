import { OLD_BLOCK_IDS } from "@/lib/catalog";
import { useEffect, useState } from "react";

/** Hash routes, so the site stays a static bundle with no server rewrites. `#/blocks/pause-the-target` → ["blocks", "pause-the-target"]. Old `#/modules/...` links open the blocks page. */
export type Page = "home" | "blocks" | "examples" | "explorer" | "skills" | "mcp" | "docs";

const PAGES: Page[] = ["blocks", "examples", "explorer", "skills", "mcp", "docs"];

export interface Route {
  page: Page;
  parts: string[];
}

const parse = (): Route => {
  const [head = "", ...parts] = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (head === "modules") {
    // old links: #/modules, #/modules/<group>, #/modules/<group>/<id>
    const id = parts.length >= 2 ? parts[parts.length - 1]! : undefined;
    return { page: "blocks", parts: id ? [OLD_BLOCK_IDS[id] ?? id] : [] };
  }
  const page = PAGES.find((p) => p === head) ?? "home";
  if (page === "blocks" && parts[0] && OLD_BLOCK_IDS[parts[0]]) parts[0] = OLD_BLOCK_IDS[parts[0]]!;
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
