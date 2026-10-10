import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { Safe } from "./kit/Safe";
import { sections } from "./sections";
import "./styles.css";

// Safe already logs "[section <Id>] ..."; React's default would log the same crash again, unattributed.
createRoot(document.getElementById("root")!, { onCaughtError: () => {} }).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <main>
        {sections.map(({ id, Section }) => (
          <div key={id} data-section={id}>
            <Safe id={id}>
              <Section />
            </Safe>
          </div>
        ))}
      </main>
    </MotionConfig>
  </StrictMode>,
);
