import { PROOF_METRICS, CUSTOMER_LOGOS, QUOTE } from "../data";
import { Section } from "./Section";
import { Reveal } from "./Reveal";

export function Proof() {
  return (
    <Section
      id="customers"
      eyebrow="Customers"
      title="Trusted by teams that measure"
      lede="Kinetiq runs in production where uptime and throughput are non-negotiable."
    >
      <Reveal>
        <ul
          aria-label="Customer logos"
          className="mb-14 flex flex-wrap items-center gap-x-10 gap-y-5 border-y border-line py-7"
        >
          {CUSTOMER_LOGOS.map((logo) => (
            <li
              key={logo}
              className="font-display text-base font-bold uppercase tracking-[0.18em] text-muted/70"
            >
              {logo}
            </li>
          ))}
        </ul>
      </Reveal>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
            {PROOF_METRICS.map((m) => (
              <li key={m.label} className="bg-ink p-6 sm:p-8">
                <div className="font-display text-4xl font-extrabold tracking-tight text-paper sm:text-5xl">
                  {m.value}
                </div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted">
                  {m.label}
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.08}>
          <figure className="flex h-full flex-col justify-center rounded-md border border-line bg-ink-2 p-8 sm:p-10">
            <span aria-hidden="true" className="font-display text-6xl leading-none text-accent">
              “
            </span>
            <blockquote className="mt-2">
              <p className="font-display text-xl font-medium leading-snug tracking-tight text-paper sm:text-2xl">
                {QUOTE.text}
              </p>
            </blockquote>
            <figcaption className="mt-6 border-t border-line pt-5">
              <div className="text-sm font-semibold text-paper">{QUOTE.author}</div>
              <div className="font-mono text-xs uppercase tracking-widest text-muted">
                {QUOTE.company}
              </div>
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </Section>
  );
}
