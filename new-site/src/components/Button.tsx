import type { ReactNode } from "react";

export function Button({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const base =
    "group inline-flex items-center justify-center gap-2 rounded-sm px-6 py-3.5 text-sm font-semibold tracking-wide transition-colors duration-200";
  const styles =
    variant === "primary"
      ? "bg-accent text-ink hover:bg-accent-soft"
      : "border border-line text-paper hover:border-accent hover:text-accent";
  return (
    <a href={href} className={`${base} ${styles} ${className}`}>
      {children}
      <span aria-hidden="true" className="transition-transform duration-200 group-hover:translate-x-1">
        →
      </span>
    </a>
  );
}
