import type { ReactNode } from "react";

export function Section({
  id,
  children,
  className = "",
  eyebrow,
  title,
  lede,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  title?: ReactNode;
  lede?: ReactNode;
}) {
  return (
    <section id={id} className={`relative py-20 sm:py-28 lg:py-36 ${className}`}>
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        {(eyebrow || title || lede) && (
          <header className="mb-12 max-w-3xl sm:mb-16">
            {eyebrow && (
              <p className="mb-4 flex items-center gap-3 font-mono text-xs font-medium uppercase tracking-[0.22em] text-accent">
                <span aria-hidden="true" className="inline-block h-px w-8 bg-accent" />
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="font-display text-4xl font-extrabold leading-[1.02] tracking-tight text-paper sm:text-5xl lg:text-6xl">
                {title}
              </h2>
            )}
            {lede && (
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
                {lede}
              </p>
            )}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
