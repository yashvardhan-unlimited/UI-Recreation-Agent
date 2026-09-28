import { USE_CASES } from "../data";
import { Section } from "./Section";
import { Reveal } from "./Reveal";

export function UseCases() {
  return (
    <Section
      id="use-cases"
      eyebrow="Use cases"
      title="Where Kinetiq runs"
      lede="From high-throughput fulfillment to unstructured field work — one policy, many environments."
    >
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {USE_CASES.map((uc, i) => (
          <Reveal as="li" key={uc.id} delay={i * 0.05} className="h-full">
            <article className="tick flex h-full flex-col justify-between gap-8 rounded-md border border-line bg-ink-2 p-6 transition-colors duration-300 hover:border-accent/60">
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight text-paper">
                  {uc.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {uc.description}
                </p>
              </div>
              <div className="border-t border-line pt-5">
                <div className="font-display text-3xl font-extrabold tracking-tight text-accent">
                  {uc.metric}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">
                  {uc.metricLabel}
                </div>
              </div>
            </article>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
