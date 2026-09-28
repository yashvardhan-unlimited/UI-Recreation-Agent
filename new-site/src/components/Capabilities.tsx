import { CAPABILITIES } from "../data";
import { Section } from "./Section";
import { Reveal } from "./Reveal";

export function Capabilities() {
  return (
    <Section
      id="platform"
      eyebrow="Platform"
      title={
        <>
          Built for teams who ship,
          <br className="hidden sm:block" />
          not just prototype.
        </>
      }
      lede="Four capabilities that turn a research-grade policy into a production autonomy stack."
    >
      <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
        {CAPABILITIES.map((cap, i) => (
          <Reveal as="li" key={cap.id} delay={i * 0.06} className="h-full">
            <article className="group flex h-full flex-col gap-5 bg-ink p-7 transition-colors duration-300 hover:bg-ink-2 sm:p-9">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-medium text-accent">{cap.index}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  {cap.tag}
                </span>
              </div>
              <h3 className="font-display text-2xl font-bold leading-tight tracking-tight text-paper sm:text-[1.7rem]">
                {cap.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted sm:text-base">
                {cap.description}
              </p>
            </article>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
}
