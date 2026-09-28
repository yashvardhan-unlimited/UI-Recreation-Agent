import { useState } from "react";
import { NAV_LINKS } from "../data";

function Logo() {
  return (
    <span className="flex items-center gap-2.5" aria-label="Kinetiq home">
      <span className="relative grid h-8 w-8 place-items-center" aria-hidden="true">
        <span className="absolute inset-0 border border-accent" />
        <span className="h-2.5 w-2.5 bg-accent" />
      </span>
      <span className="font-display text-lg font-extrabold tracking-tight text-paper">
        KINETIQ
      </span>
    </span>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-ink/85 backdrop-blur-md">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8"
      >
        <a href="#top" className="shrink-0" aria-label="Kinetiq — home">
          <Logo />
        </a>

        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-sm font-medium text-muted transition-colors hover:text-paper"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
          <a
            href="#demo"
            className="inline-flex items-center gap-2 rounded-sm bg-accent px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-soft"
          >
            Request a demo
          </a>
        </div>

        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-sm border border-line text-paper md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true" className="text-lg">
            {open ? "×" : "≡"}
          </span>
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-t border-line bg-ink-2 md:hidden">
          <ul className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-5 py-4 sm:px-8">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-sm px-3 py-3 text-base font-medium text-paper hover:bg-ink-3"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="pt-2">
              <a
                href="#demo"
                onClick={() => setOpen(false)}
                className="block rounded-sm bg-accent px-3 py-3 text-center text-base font-semibold text-ink"
              >
                Request a demo
              </a>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
