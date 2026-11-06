import { useEffect } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { NAV } from "@/components/GlassNav";
import { CORNERS, MODULES } from "@/lib/catalog";
import { RUNS } from "@/lib/runs";
import { go } from "@/lib/route";

export const CLONE = "git clone https://github.com/ayush18pop/Popcorn.git && cd Popcorn && bun install";

/** ⌘K: every page, every module, every example, and a couple of actions. */
export function CommandMenu({ open, onOpenChange, onToggleTheme }: { open: boolean; onOpenChange: (o: boolean) => void; onToggleTheme: () => void }) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search modules, examples, pages…" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={run(() => go("home"))}>Home</CommandItem>
          {NAV.map((n) => (
            <CommandItem key={n.page} onSelect={run(() => go(n.page))}>
              {n.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Modules">
          {MODULES.map((m) => (
            <CommandItem key={m.id} value={`${m.name} ${m.corner} ${m.trigger} ${m.status}`} onSelect={run(() => go("modules", m.corner, m.id))}>
              <span>{m.name}</span>
              <CommandShortcut className="font-mono normal-case tracking-normal">
                {CORNERS.find((c) => c.id === m.corner)?.name} · {m.status}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Examples">
          {Object.entries(RUNS).map(([key, r]) => (
            <CommandItem key={key} value={`example ${r.title} ${key}`} onSelect={run(() => go("examples", ...key.split("/")))}>
              {r.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={run(() => navigator.clipboard?.writeText(CLONE))}>Copy the clone command</CommandItem>
          <CommandItem onSelect={run(onToggleTheme)}>
            Toggle theme <CommandShortcut>◐</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
