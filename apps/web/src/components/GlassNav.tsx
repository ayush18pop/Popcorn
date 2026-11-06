import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Menu, Moon, Search, Sun, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { href, type Page } from "@/lib/route";
import { cn } from "@/lib/utils";

export const NAV: { page: Page; label: string }[] = [
  { page: "blocks", label: "Blocks" },
  { page: "examples", label: "Examples" },
  { page: "explorer", label: "Explorer" },
  { page: "skills", label: "Skills" },
  { page: "mcp", label: "MCP" },
  { page: "docs", label: "Docs" },
];

/** Floating glass pill. Narrows once the page scrolls; a hover highlight slides between links. */
export function GlassNav({ page, theme, onToggleTheme, onOpenMenu }: { page: Page; theme: "dark" | "light"; onToggleTheme: () => void; onOpenMenu: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [hover, setHover] = useState<Page | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [page]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center px-4">
      <motion.header
        initial={false}
        animate={{ maxWidth: scrolled ? 960 : 1120 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="glass pointer-events-auto flex h-14 w-full items-center gap-2 rounded-full pl-5 pr-2"
      >
        <a href="#/" className="flex items-center gap-2 pr-3 text-[15px] font-semibold tracking-tight">
          <img src="/popcorn.svg" alt="" className="size-5" />
          popcorn
        </a>

        <nav className="hidden items-center lg:flex" onMouseLeave={() => setHover(null)}>
          {NAV.map((l) => (
            <a
              key={l.page}
              href={href(l.page)}
              onMouseEnter={() => setHover(l.page)}
              className={cn("relative rounded-full px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground", page === l.page && "text-foreground")}
            >
              {hover === l.page && (
                <motion.span layoutId="nav-hover" className="absolute inset-0 rounded-full bg-foreground/[0.07]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
              )}
              {page === l.page && <motion.span layoutId="nav-active" className="absolute inset-x-3 -bottom-px h-px bg-foreground/70" />}
              <span className="relative">{l.label}</span>
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onOpenMenu}
            className="hidden h-10 items-center gap-5 rounded-full border border-[var(--glass-border)] bg-foreground/[0.03] pl-4 pr-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground md:flex"
          >
            <span className="flex items-center gap-2">
              <Search className="size-3.5" /> Search
            </span>
            <Kbd className="rounded-full px-2">⌘K</Kbd>
          </button>
          <button
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <a
            href={href("blocks")}
            className="hidden h-10 items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 sm:flex"
          >
            Browse blocks <ArrowRight className="size-3.5" />
          </a>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={open}
            className="grid size-10 place-items-center rounded-full text-muted-foreground hover:text-foreground lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-strong pointer-events-auto mt-2 grid w-full max-w-[1120px] grid-cols-2 gap-1 rounded-3xl p-2 lg:hidden"
          >
            {NAV.map((l) => (
              <a key={l.page} href={href(l.page)} className={cn("rounded-2xl px-4 py-3 text-[14px] text-muted-foreground", page === l.page && "bg-foreground/[0.07] text-foreground")}>
                {l.label}
              </a>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}
