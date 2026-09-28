import { SPECS } from "../data";
import { Section } from "./Section";
import { Reveal } from "./Reveal";

function ArchitectureDiagram() {
  const nodes = ["Sensors", "Perception", "Policy core", "Planning", "Actuators"];
  return (
    <div className="rounded-md border border-line bg-ink-2 p-6 sm:p-8" aria-label="System architecture flow" role="img">
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-0">
        {nodes.map((node, i) => (
          <div key={node} className="flex flex-1 items-center gap-2 sm:flex-col sm:gap-3">
            <div
              className={`flex-1 rounded-sm border px-3 py-3 text-center font-mono text-[11px] uppercase tracking-widest sm:flex-none sm:px-4 sm:py-4 sm:text-xs ${
                node === "Policy core"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line bg-ink text-paper"
              }`}
            >
              {node}
            </div>
            {i < nodes.length - 1 && (
              <span aria-hidden="true" className="text-accent sm:mx-1 sm:rotate-90">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-muted">
        Closed-loop control · 25 Hz · on-device inference
      </p>
    </div>
  );
}

export function Specs() {
  return (
    <Section
      id="architecture"
      eyebrow="Architecture & specs"
      title="Engineered to be audited"
      lede="Deterministic, versioned, and observable — the properties your engineering org needs to trust an autonomy stack."
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
        <Reveal>
          <ArchitectureDiagram />
        </Reveal>
        <Reveal delay={0.08}>
          <ul className="divide-y divide-line rounded-md border border-line bg-ink-2">
            {SPECS.map((spec) => (
              <li key={spec.label} className="flex items-baseline justify-between gap-4 px-5 py-4 sm:px-6">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                    {spec.label}
                  </div>
                  {spec.note && (
                    <div className="mt-1 text-xs text-muted/70">{spec.note}</div>
                  )}
                </div>
                <div className="shrink-0 text-right font-display text-lg font-bold tracking-tight text-paper sm:text-xl">
                  {spec.value}
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
