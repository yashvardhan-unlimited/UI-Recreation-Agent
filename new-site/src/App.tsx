import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Capabilities } from "./components/Capabilities";
import { UseCases } from "./components/UseCases";
import { Specs } from "./components/Specs";
import { Proof } from "./components/Proof";
import { CTA } from "./components/CTA";
import { Footer } from "./components/Footer";

export function App() {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <Nav />
      <main id="main">
        <Hero />
        <Capabilities />
        <UseCases />
        <Specs />
        <Proof />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
