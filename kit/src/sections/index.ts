import type { ComponentType } from "react";
import Hero from "./Hero";
import Story from "./Story";
import Showcase from "./Showcase";

export const sections: { id: string; Section: ComponentType }[] = [
  { id: "Hero", Section: Hero },
  { id: "Story", Section: Story },
  { id: "Showcase", Section: Showcase },
];
