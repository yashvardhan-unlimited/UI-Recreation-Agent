import { animate, motion, useInView, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";

type Box = { children: ReactNode; className?: string };

const ease = [0.22, 1, 0.36, 1] as const;
// Fire once, slightly after the element's top crosses the bottom edge, so it's actually seen.
const once = { once: true, margin: "0px 0px -10% 0px" } as const;
const rise = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } } };

/** Fades and lifts children in once when they enter the viewport. */
export function Reveal({ children, className, delay = 0, y = 24 }: Box & { delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={once} transition={{ duration: 0.6, delay, ease }}>
      {children}
    </motion.div>
  );
}

/** Reveals its <Item> children one after another on enter; `gap` is seconds between items. */
export function Stagger({ children, className, gap = 0.08, as = "div" }: Box & { gap?: number; as?: "div" | "ul" | "ol" }) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag className={className} initial={reduce ? false : "hidden"} whileInView="show" viewport={once} variants={{ show: { transition: { staggerChildren: gap } } }}>
      {children}
    </Tag>
  );
}

/** One child of <Stagger>; use as="li" inside a list. */
export function Item({ children, className, as = "div" }: Box & { as?: "div" | "li" }) {
  const Tag = motion[as];
  return <Tag className={className} variants={rise}>{children}</Tag>;
}

/** Reveals a heading or line word by word on enter; pass the string as `text`. */
export function TextReveal({ text, className, as = "h2" }: { text: string; className?: string; as?: "h1" | "h2" | "h3" | "p" }) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag className={className} initial={reduce ? false : "hidden"} whileInView="show" viewport={once} variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
      <span className="sr-only">{text}</span>
      {text.split(" ").map((word, i) => (
        <span key={i} aria-hidden>
          {i > 0 && " "}
          <motion.span className="inline-block" variants={rise}>{word}</motion.span>
        </span>
      ))}
    </Tag>
  );
}

/** <img> that fades in and settles from a slight zoom on enter; alt, width and height are required. */
export function ImageReveal({ className, ...img }: { src: string; alt: string; width: number; height: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={`overflow-hidden ${className ?? ""}`}>
      <motion.img {...img} loading="lazy" className="h-auto w-full" initial={reduce ? false : { opacity: 0, scale: 1.08 }} whileInView={{ opacity: 1, scale: 1 }} viewport={once} transition={{ duration: 0.9, ease }} />
    </div>
  );
}

/** Drifts children vertically while scrolling past (speed -1..1, default 0.2); off under reduced motion. */
export function Parallax({ children, className, speed = 0.2 }: Box & { speed?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [speed * 100, speed * -100]);
  return <motion.div ref={ref} className={className} style={{ y: reduce ? 0 : y }}>{children}</motion.div>;
}

/** Scales children from `from` (default 0.85) to full size as they scroll to the viewport center; off under reduced motion. */
export function ZoomOnScroll({ children, className, from = 0.85 }: Box & { from?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const scale = useTransform(scrollYProgress, [0, 1], [from, 1]);
  return <motion.div ref={ref} className={className} style={{ scale: reduce ? 1 : scale }}>{children}</motion.div>;
}

function Panel({ children, i, n, progress }: { children: ReactNode; i: number; n: number; progress: MotionValue<number> }) {
  // Offsets must stay within 0..1: motion hands these to native ScrollTimeline, which rejects negatives.
  const end = (i + 1) / n, fade = 0.3 / n, start = Math.max(i / n, fade);
  // First panel is visible before scrolling starts; last stays visible after the pin releases.
  const opacity = useTransform(progress, [start - fade, start, end - fade, end], [i === 0 ? 1 : 0, 1, 1, i === n - 1 ? 1 : 0]);
  const y = useTransform(progress, [start - fade, start, end - fade, end], [i === 0 ? 0 : 40, 0, 0, i === n - 1 ? 0 : -40]);
  return <motion.div className="col-start-1 row-start-1 w-full" style={{ opacity, y }}>{children}</motion.div>;
}

/** Pins a full-viewport stage while the visitor scrolls through `panels`, cross-fading one into the next; stacks them under reduced motion. */
export function PinnedScroll({ panels, className }: { panels: ReactNode[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  if (reduce) return <div ref={ref} className={`py-16 ${className ?? ""}`}>{panels.map((p, i) => <div key={i} className="py-8">{p}</div>)}</div>;
  return (
    <div ref={ref} className={`relative ${className ?? ""}`} style={{ height: `${panels.length * 100}svh` }}>
      <div className="sticky top-0 grid h-svh place-items-center overflow-hidden">
        {panels.map((p, i) => <Panel key={i} i={i} n={panels.length} progress={scrollYProgress}>{p}</Panel>)}
      </div>
    </div>
  );
}

/** Endless horizontal ticker of children; pauses on hover and becomes a static wrapped row under reduced motion. */
export function Marquee({ children, className, seconds = 30 }: Box & { seconds?: number }) {
  const row = "flex shrink-0 items-center gap-12 pr-12 motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-2 motion-reduce:px-5";
  return (
    <div className={`group overflow-hidden ${className ?? ""}`}>
      <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused] motion-reduce:w-auto motion-reduce:animate-none" style={{ animationDuration: `${seconds}s` }}>
        <div className={row}>{children}</div>
        <div className={`${row} motion-reduce:hidden`} aria-hidden inert>{children}</div>
      </div>
    </div>
  );
}

/** Counts up from 0 to `to` once on enter without shifting layout; shows the final value under reduced motion. */
export function Counter({ to, decimals = 0, prefix = "", suffix = "", className }: { to: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const format = (n: number) => prefix + n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  useEffect(() => {
    if (!inView || reduce) return;
    // Write text directly: one React render instead of one per frame.
    const run = animate(0, to, { duration: 1.6, ease, onUpdate: (n) => { if (ref.current) ref.current.textContent = format(n); } });
    return () => run.stop();
  }, [inView, reduce, to]);
  return (
    <span className={`inline-grid tabular-nums ${className ?? ""}`}>
      <span className="invisible col-start-1 row-start-1" aria-hidden>{format(to)}</span>
      <span ref={ref} className="col-start-1 row-start-1">{format(to)}</span>
    </span>
  );
}

function usePointer(scale: number) {
  const reduce = useReducedMotion();
  const spring = { stiffness: 200, damping: 18, mass: 0.4 };
  const x = useSpring(0, spring), y = useSpring(0, spring);
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set(((e.clientX - r.left) / r.width - 0.5) * scale);
    y.set(((e.clientY - r.top) / r.height - 0.5) * scale);
  };
  return { x, y, onPointerMove, onPointerLeave: () => { x.set(0); y.set(0); } };
}

/** Pulls its child toward the mouse on hover (CTAs, icons); `strength` in px; off for touch and reduced motion. */
export function Magnetic({ children, className, strength = 16 }: Box & { strength?: number }) {
  const { x, y, ...on } = usePointer(strength);
  return <motion.div className={`inline-block ${className ?? ""}`} style={{ x, y }} {...on}>{children}</motion.div>;
}

/** Tilts a card in 3D toward the mouse; `degrees` is the max tilt; off for touch and reduced motion. */
export function Tilt({ children, className, degrees = 8 }: Box & { degrees?: number }) {
  const { x, y, ...on } = usePointer(degrees * 2);
  const rotateX = useTransform(y, (v) => -v);
  return <motion.div className={className} style={{ rotateX, rotateY: x, transformPerspective: 800 }} {...on}>{children}</motion.div>;
}
