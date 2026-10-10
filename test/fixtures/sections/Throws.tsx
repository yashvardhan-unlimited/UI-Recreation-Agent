export default function Throws() {
  const origins = JSON.parse("null") as string[];
  return <section className="px-5 py-12"><ul>{origins.map((o) => <li key={o}>{o}</li>)}</ul></section>;
}
