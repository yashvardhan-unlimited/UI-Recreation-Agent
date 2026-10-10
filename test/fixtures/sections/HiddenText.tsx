export default function HiddenText() {
  return (
    <section className="px-5 py-12">
      <h2 className="font-display text-2xl">Visible heading</h2>
      <p style={{ opacity: 0 }}>This line never fades in.</p>
    </section>
  );
}
