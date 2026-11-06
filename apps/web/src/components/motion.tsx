import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

/** Fades, unblurs and lifts its children the first time they scroll into view. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 28, filter: "blur(10px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** A glass card whose light and border follow the cursor. */
export function Spotlight({ children, className, as = "div", ...rest }: { children: ReactNode; className?: string; as?: "div" | "button" } & React.HTMLAttributes<HTMLElement>) {
  const Tag = as as "div";
  return (
    <Tag
      {...rest}
      className={cn("spotlight", className)}
      onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </Tag>
  );
}

/** Counts up to `to` once it is on screen. */
export function CountUp({ to, decimals = 0, suffix = "", className }: { to: number; decimals?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    const c = animate(0, to, {
      duration: 1.4,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => (el.textContent = v.toFixed(decimals) + suffix),
    });
    return () => c.stop();
  }, [inView, to, decimals, suffix]);
  return (
    <span ref={ref} className={className}>
      {(0).toFixed(decimals) + suffix}
    </span>
  );
}

/** Dot plus a lagging ring, in difference blend so it reads on any surface. Grows over clickable things. */
export function Cursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const rx = useSpring(x, { stiffness: 350, damping: 30, mass: 0.6 });
  const ry = useSpring(y, { stiffness: 350, damping: 30, mass: 0.6 });
  const scale = useSpring(1, { stiffness: 300, damping: 22 });
  const opacity = useMotionValue(0);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    document.documentElement.classList.add("has-cursor");
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      opacity.set(1);
      const t = e.target as HTMLElement | null;
      scale.set(t?.closest("a,button,input,[data-cursor]") ? 1.9 : 1);
    };
    const leave = () => opacity.set(0);
    const down = () => scale.set(0.8);
    const up = () => scale.set(1);
    window.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [x, y, scale, opacity]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] mix-blend-difference">
      <motion.div
        style={{ x: rx, y: ry, scale, opacity }}
        className="absolute -left-4 -top-4 size-8 rounded-full border border-white/80"
      />
      <motion.div style={{ x, y, opacity }} className="absolute -left-[3px] -top-[3px] size-1.5 rounded-full bg-white" />
    </div>
  );
}

