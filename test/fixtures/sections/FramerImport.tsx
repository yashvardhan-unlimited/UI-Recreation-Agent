import { motion } from "framer-motion";

export default function FramerImport() {
  return <section className="px-5 py-12"><motion.p animate={{ opacity: 1 }}>Imported from the old package name.</motion.p></section>;
}
