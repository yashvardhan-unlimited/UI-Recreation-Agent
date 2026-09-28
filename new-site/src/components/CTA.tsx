import { Button } from "./Button";
import { Reveal } from "./Reveal";

export function CTA() {
  return (
    <section id="demo" className="relative overflow-hidden border-t border-line grid-bg">
      <div className="mx-auto w-full max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
        <Reveal>
          <div className="flex flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-5 flex items-center gap-3 font-mono text-xs font-medium uppercase tracking-[0.22em] text-accent">
                <span aria-hidden="true" className="inline-block h-px w-8 bg-accent" />
                Get started
              </p>
              <h2 className="font-display text-4xl font-extrabold leading-[1.02] tracking-tight text-paper sm:text-5xl lg:text-6xl">
                Put a general-purpose
                <br className="hidden sm:block" />
                policy on your robots.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                Talk to our engineering team about your fleet, your stack, and a 30-day
                pilot. No slideware — we bring the model.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button href="#demo" variant="primary">
                Request a demo
              </Button>
              <Button href="#architecture" variant="ghost">
                Read the architecture
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
