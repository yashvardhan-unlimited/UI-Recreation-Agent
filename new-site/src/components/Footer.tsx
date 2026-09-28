const FOOTER_COLS = [
  {
    title: "Platform",
    links: ["Foundation model", "Fleet control", "Safety layer", "Developer API"],
  },
  {
    title: "Company",
    links: ["About", "Careers", "Research", "Contact"],
  },
  {
    title: "Resources",
    links: ["Documentation", "Whitepaper", "Security", "Status"],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink-2">
      <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-16">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2.5" aria-label="Kinetiq">
              <span className="relative grid h-8 w-8 place-items-center" aria-hidden="true">
                <span className="absolute inset-0 border border-accent" />
                <span className="h-2.5 w-2.5 bg-accent" />
              </span>
              <span className="font-display text-lg font-extrabold tracking-tight text-paper">
                KINETIQ
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              The foundation-model robotics platform. One policy, every robot.
            </p>
          </div>
          {FOOTER_COLS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#top"
                      className="text-sm text-paper/80 transition-colors hover:text-accent"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-muted">
            © 2026 Kinetiq Robotics, Inc. — Fictional demo content.
          </p>
          <div className="flex gap-6 font-mono text-xs text-muted">
            <a href="#top" className="transition-colors hover:text-paper">Privacy</a>
            <a href="#top" className="transition-colors hover:text-paper">Terms</a>
            <a href="#top" className="transition-colors hover:text-paper">Security</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
