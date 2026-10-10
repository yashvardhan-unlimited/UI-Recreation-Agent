import { lazy, Suspense, useRef, useState, type ComponentType } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { Safe } from "./Safe";

type Frameloop = "always" | "demand" | "never";
type Props = { load: () => Promise<{ default: ComponentType }>; poster: string; alt: string; width: number; height: number; animate?: boolean; className?: string };

/** Lazy 3D scene over a same-size poster image: load={() => import("./<Id>.scene")}; poster only under reduced motion or without WebGL. */
export function Scene3D({ load, poster, alt, width, height, animate = true, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const near = useInView(ref, { once: true, margin: "200px" });
  const visible = useInView(ref);
  const [ready, setReady] = useState(false);
  // three/R3F only ever arrive through this dynamic import, keeping them out of the entry chunk.
  const [Stage] = useState(() => lazy(async () => {
    const [{ Canvas }, { default: Scene }] = await Promise.all([import("@react-three/fiber"), load()]);
    const dpr: [number, number] = [1, matchMedia("(pointer: coarse)").matches ? 1 : 1.5];
    return { default: ({ frameloop }: { frameloop: Frameloop }) => <Canvas dpr={dpr} frameloop={frameloop} onCreated={() => setReady(true)}><Scene /></Canvas> };
  }));
  return (
    <div ref={ref} data-scene3d className={`relative ${className ?? ""}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <img src={poster} alt={alt} width={width} height={height} className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500" style={{ opacity: ready ? 0 : 1 }} />
      {near && !reduce && (
        <div className="absolute inset-0" aria-hidden>
          {/* A WebGL or chunk failure leaves the poster in place instead of taking the section down. */}
          <Safe id="Scene3D">
            <Suspense fallback={null}>
              <Stage frameloop={visible ? (animate ? "always" : "demand") : "never"} />
            </Suspense>
          </Safe>
        </div>
      )}
    </div>
  );
}
