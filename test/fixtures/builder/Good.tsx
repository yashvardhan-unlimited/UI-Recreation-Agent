import { Reveal } from "../kit/motion";

export default function Good() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16">
      <Reveal>
        <h2 className="font-display text-3xl">Roasted on Tuesday</h2>
        <p className="mt-4 text-muted">Every bag leaves the same afternoon it is packed.</p>
      </Reveal>
    </section>
  );
}
