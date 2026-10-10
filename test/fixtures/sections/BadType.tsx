export default function BadType() {
  const roasts: number = "two a week";
  return <section className="px-5 py-12"><p>Roasts: {roasts}</p></section>;
}
