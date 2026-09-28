import { motion, useReducedMotion } from "motion/react";
import { Button } from "./Button";

function HeroVisual() {
  const reduce = useReducedMotion();
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-md border border-line bg-ink-2 grid-bg">
      {/* Crosshair frame */}
      <div className="pointer-events-none absolute inset-6" aria-hidden="true">
        <span className="absolute left-0 top-0 h-5 w-5 border-l-2 border-t-2 border-accent" />
        <span className="absolute right-0 top-0 h-5 w-5 border-r-2 border-t-2 border-accent" />
        <span className="absolute bottom-0 left-0 h-5 w-5 border-b-2 border-l-2 border-accent" />
        <span className="absolute bottom-0 right-0 h-5 w-5 border-b-2 border-r-2 border-accent" />
      </div>

      {/* Center reticle */}
      <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
        <div className="relative h-40 w-40 sm:h-56 sm:w-56">
          <div className="absolute inset-0 rounded-full border border-line" />
          <div className="absolute inset-6 rounded-full border border-line" />
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-line" />
          <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-line" />
          {!reduce && (
            <motion.div
              className="absolute inset-0 rounded-full border border-accent/60"
              animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 bg-accent" />
        </div>
      </div>

      {/* Readout labels */}
      <div className="absolute left-4 top-4 font-mono text-[10px] uppercase tracking-widest text-muted" aria-hidden="true">
        POLICY // ACTIVE
      </div>
      <div className="absolute bottom-4 right-4 font-mono text-[10px] uppercase tracking-widest text-accent" aria-hidden="true">
        38.2 ms
      </div>
    </div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  return (
    <section id="top" className="relative overflow-hidden border-b border-line grid-bg">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-12 lg:gap-8 lg:py-36">
        <div className="lg:col-span-7">
          {!reduce ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="mb-6 flex items-center gap-3 font-mono text-xs font-medium uppercase tracking-[0.22em] text-accent">
                <span aria-hidden="true" className="inline-block h-px w-8 bg-accent" />
                Foundation-model robotics
              </p>
              <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-paper sm:text-6xl lg:text-7xl">
                One model.
                <br />
                Every robot.
                <br />
                <span className="text-accent">Zero retraining.</span>
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
                Kinetiq is the autonomy platform for engineering teams who ship. A single
                vision-language-action policy that generalizes across your fleet — so you
                deploy new behaviors in days, not quarters.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button href="#demo" variant="primary">
                  Request a demo
                </Button>
                <Button href="#platform" variant="ghost">
                  Explore the platform
                </Button>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-xs uppercase tracking-widest text-muted">
                <span><span className="text-paper">1,200+</span> units deployed</span>
                <span className="hidden h-3 w-px bg-line sm:block" aria-hidden="true" />
                <span><span className="text-paper">99.95%</span> fleet uptime</span>
              </div>
            </motion.div>
          ) : (
            <div>
              <p className="mb-6 flex items-center gap-3 font-mono text-xs font-medium uppercase tracking-[0.22em] text-accent">
                <span aria-hidden="true" className="inline-block h-px w-8 bg-accent" />
                Foundation-model robotics
              </p>
              <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-paper sm:text-6xl lg:text-7xl">
                One model.
                <br />
                Every robot.
                <br />
                <span className="text-accent">Zero retraining.</span>
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
                Kinetiq is the autonomy platform for engineering teams who ship. A single
                vision-language-action policy that generalizes across your fleet — so you
                deploy new behaviors in days, not quarters.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button href="#demo" variant="primary">
                  Request a demo
                </Button>
                <Button href="#platform" variant="ghost">
                  Explore the platform
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="lg:col-span-5">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}
