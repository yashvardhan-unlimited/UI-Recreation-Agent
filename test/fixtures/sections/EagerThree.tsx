import { Canvas } from "@react-three/fiber";

export default function EagerThree() {
  return (
    <section className="px-5 py-12">
      <p>A 3D box imported eagerly.</p>
      <div className="aspect-video w-full">
        <Canvas frameloop="demand">
          <mesh><boxGeometry /><meshNormalMaterial /></mesh>
        </Canvas>
      </div>
    </section>
  );
}
