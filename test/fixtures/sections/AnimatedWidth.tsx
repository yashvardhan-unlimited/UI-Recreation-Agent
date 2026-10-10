import { motion } from "motion/react";

export default function AnimatedWidth() {
  return (
    <section className="px-5 py-12">
      <p>A bar that grows by animating its width.</p>
      <motion.div className="h-2 bg-accent" initial={{ width: 0 }} animate={{ width: 200 }} />
    </section>
  );
}
