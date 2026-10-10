import { Float, TorusKnot } from "@react-three/drei";

// three.js can't read CSS variables, so resolve the token once when the chunk loads.
const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();

export default function Scene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 5]} intensity={1.4} />
      <Float speed={1.5} rotationIntensity={1.2} floatIntensity={1}>
        <TorusKnot args={[1, 0.32, 160, 24]}>
          <meshStandardMaterial color={accent} roughness={0.35} metalness={0.2} />
        </TorusKnot>
      </Float>
    </>
  );
}
