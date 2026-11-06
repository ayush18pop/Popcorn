import { useState } from "react";
import { CommandMenu } from "@/components/CommandMenu";
import { GlassNav } from "@/components/GlassNav";
import { Footer } from "@/components/bits";
import { Cursor } from "@/components/motion";
import { useRoute } from "@/lib/route";
import { useTheme } from "@/lib/theme";
import Home from "@/pages/Home";
import Modules from "@/pages/Modules";
import ModulePage from "@/pages/ModulePage";
import Examples from "@/pages/Examples";
import Explorer from "@/pages/Explorer";
import Skills from "@/pages/Skills";
import Mcp from "@/pages/Mcp";
import Docs from "@/pages/Docs";

export default function App() {
  const { page, parts } = useRoute();
  const { theme, toggle } = useTheme();
  const [menu, setMenu] = useState(false);

  return (
    <>
      <GlassNav page={page} theme={theme} onToggleTheme={toggle} onOpenMenu={() => setMenu(true)} />
      <Cursor />
      <CommandMenu open={menu} onOpenChange={setMenu} onToggleTheme={toggle} />
      <main>
        {page === "home" && <Home />}
        {page === "modules" && (parts.length >= 2 ? <ModulePage key={parts[1]} corner={parts[0]} id={parts[1]} /> : <Modules corner={parts[0]} />)}
        {page === "examples" && <Examples key={parts.join("/")} runKey={parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined} />}
        {page === "explorer" && <Explorer />}
        {page === "skills" && <Skills />}
        {page === "mcp" && <Mcp />}
        {page === "docs" && <Docs section={parts[0]} anchor={parts[1]} />}
      </main>
      <Footer />
    </>
  );
}
