import { ImageReveal, Magnetic, Marquee, Parallax, Reveal, TextReveal } from "../kit/motion";

const origins = ["Huila, Colombia", "Sidama, Ethiopia", "Nyeri, Kenya", "Cerrado, Brazil", "Santa Bárbara, Honduras", "Kirinyaga, Kenya"];

export default function Hero() {
  return (
    <section className="flex min-h-svh flex-col justify-between pt-6">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5">
        <span className="font-display text-xl">Halden</span>
        <a href="#subscribe" className="text-sm text-muted underline-offset-4 hover:underline">Subscribe</a>
      </header>
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-14 md:grid-cols-[1.1fr_1fr] md:py-20">
        <div>
          <TextReveal as="h1" text="Roasted on Tuesday, in your cup by Friday." className="font-display text-4xl leading-tight md:text-6xl" />
          <Reveal delay={0.3}>
            <p className="mt-6 max-w-md text-lg text-muted">
              We buy from six farms we have visited, roast twice a week in small batches and ship the same afternoon. Nothing waits on a shelf.
            </p>
            <Magnetic className="mt-8">
              <a href="#subscribe" className="inline-block rounded-full bg-accent px-6 py-3 font-medium text-bg">Start a subscription</a>
            </Magnetic>
          </Reveal>
        </div>
        <Parallax speed={0.15}>
          <ImageReveal src="/demo/photo.svg" alt="Freshly roasted beans cooling in a steel tray" width={1200} height={800} className="rounded-card" />
        </Parallax>
      </div>
      <Marquee className="border-y border-line py-4 text-sm uppercase tracking-widest text-muted">
        {origins.map((o) => <span key={o}>{o}</span>)}
      </Marquee>
    </section>
  );
}
