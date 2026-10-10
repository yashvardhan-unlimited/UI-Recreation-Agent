import { Counter, Item, PinnedScroll, Stagger, Tilt, ZoomOnScroll } from "../kit/motion";

const steps = [
  { title: "Source", body: "We agree a fixed price with each farm before harvest, so a bad market year is our problem, not theirs." },
  { title: "Roast", body: "Tuesdays and Thursdays on a 12-kilo drum. Every batch is cupped before it is bagged." },
  { title: "Ship", body: "Bags leave the same afternoon with the roast date printed on the front." },
];

const brew = [
  { n: "01", title: "Weigh", body: "15 grams of coffee for 250 grams of water. A kitchen scale beats a scoop." },
  { n: "02", title: "Bloom", body: "Pour twice the coffee's weight in water and wait 30 seconds while the gas escapes." },
  { n: "03", title: "Pour", body: "Finish in slow circles. Aim for three minutes from first pour to last drip." },
];

const stats = [
  { label: "Partner farms", value: 6 },
  { label: "Hours, roast to door", value: 48 },
  { label: "Kilos per batch", value: 12 },
];

export default function Story() {
  return (
    <section className="pt-24">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="font-display text-3xl md:text-5xl">From farm to kettle</h2>
        <Stagger as="ol" className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <Item as="li" key={s.title}>
              <Tilt className="h-full rounded-card border border-line bg-surface p-6">
                <span className="text-sm text-muted">0{i + 1}</span>
                <h3 className="mt-3 font-display text-2xl">{s.title}</h3>
                <p className="mt-2 text-muted">{s.body}</p>
              </Tilt>
            </Item>
          ))}
        </Stagger>
        <ZoomOnScroll className="mt-20">
          <img src="/demo/photo.svg" alt="The roastery floor beside the drum roaster" width={1200} height={800} loading="lazy" className="h-auto w-full rounded-card" />
        </ZoomOnScroll>
        <dl className="mt-16 grid grid-cols-3 gap-4 border-t border-line pt-8">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-sm text-muted">{s.label}</dt>
              <dd className="mt-2 font-display text-3xl md:text-5xl"><Counter to={s.value} /></dd>
            </div>
          ))}
        </dl>
      </div>
      <PinnedScroll
        className="mt-24 bg-surface"
        panels={brew.map((b) => (
          <div key={b.n} className="mx-auto max-w-2xl px-5 text-center">
            <span className="text-sm font-semibold text-accent">{b.n}</span>
            <h3 className="mt-4 font-display text-4xl md:text-6xl">{b.title}</h3>
            <p className="mt-4 text-lg text-muted">{b.body}</p>
          </div>
        ))}
      />
    </section>
  );
}
