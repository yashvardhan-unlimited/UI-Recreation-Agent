import { Reveal } from "../kit/motion";
import { Scene3D } from "../kit/Scene3D";

export default function Showcase() {
  return (
    <section id="subscribe" className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-24 md:grid-cols-2">
      <Reveal>
        <h2 className="font-display text-3xl md:text-5xl">One bag, every other week</h2>
        <p className="mt-4 text-lg text-muted">
          250 grams of whatever we are most excited about, whole bean or ground for your brewer. Skip or cancel from the email we send before each roast.
        </p>
        <p className="mt-6 font-display text-2xl">€14 a bag, shipping included</p>
        <button type="button" className="mt-8 rounded-full bg-accent px-6 py-3 font-medium text-bg">Subscribe</button>
      </Reveal>
      <Scene3D
        load={() => import("./Showcase.scene")}
        poster="/demo/scene-poster.svg"
        alt="A copper-coloured knot sculpture turning slowly"
        width={1200}
        height={900}
        className="overflow-hidden rounded-card bg-surface"
      />
    </section>
  );
}
