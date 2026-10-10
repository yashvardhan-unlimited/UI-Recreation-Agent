import { Counter, ImageReveal, Reveal, TextReveal } from "../kit/motion";

export default function Clean() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16">
      <TextReveal as="h2" text="Small batches, roasted twice a week" className="font-display text-3xl" />
      <Reveal>
        <p className="mt-4 text-muted">Every bag carries its roast date, and leaves the same afternoon it is packed.</p>
      </Reveal>
      <ImageReveal src="/demo/photo.svg" alt="Beans cooling in a steel tray" width={1200} height={800} className="mt-8 rounded-card" />
      <p className="mt-8 font-display text-4xl"><Counter to={48} suffix=" hours" /></p>
    </section>
  );
}
