export type Capability = {
  id: string;
  index: string;
  title: string;
  description: string;
  tag: string;
};

export type UseCase = {
  id: string;
  title: string;
  description: string;
  metric: string;
  metricLabel: string;
};

export type Spec = {
  label: string;
  value: string;
  note?: string;
};

export type ProofMetric = {
  value: string;
  label: string;
};

export const NAV_LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "Use cases", href: "#use-cases" },
  { label: "Architecture", href: "#architecture" },
  { label: "Customers", href: "#customers" },
] as const;

export const CAPABILITIES: Capability[] = [
  {
    id: "foundation-model",
    index: "01",
    title: "One foundation model, every robot",
    description:
      "A single policy backbone trained on 40M+ hours of manipulation, navigation, and perception. Swap end-effectors, not software.",
    tag: "POLICY CORE",
  },
  {
    id: "zero-shot",
    index: "02",
    title: "Zero-shot task generalization",
    description:
      "Describe the goal in natural language. Kinetiq plans, adapts, and recovers from novel scenes without per-task retraining.",
    tag: "GENERALIZATION",
  },
  {
    id: "fleet",
    index: "03",
    title: "Fleet orchestration at scale",
    description:
      "Deploy, monitor, and roll back policies across thousands of units with deterministic versioning and full audit trails.",
    tag: "OPERATIONS",
  },
  {
    id: "safety",
    index: "04",
    title: "Certifiable safety layer",
    description:
      "Hardware-in-the-loop guardrails, formal reachability bounds, and ISO 10218 / 13482 alignment for human-shared spaces.",
    tag: "SAFETY",
  },
];

export const USE_CASES: UseCase[] = [
  {
    id: "logistics",
    title: "Warehouse & fulfillment",
    description: "Picking, packing, and bin-to-bin transfer across mixed-SKU environments.",
    metric: "3.4x",
    metricLabel: "throughput vs. rule-based",
  },
  {
    id: "manufacturing",
    title: "Manufacturing cells",
    description: "Load/unload, inspection, and kitting beside existing production lines.",
    metric: "-62%",
    metricLabel: "changeover time",
  },
  {
    id: "field",
    title: "Field & inspection",
    description: "Autonomous survey, defect detection, and data capture in unstructured terrain.",
    metric: "24/7",
    metricLabel: "unattended operation",
  },
  {
    id: "research",
    title: "Research & prototyping",
    description: "A shared policy API so your team ships new behaviors in days, not quarters.",
    metric: "10x",
    metricLabel: "faster iteration",
  },
];

export const SPECS: Spec[] = [
  { label: "Model class", value: "12B-parameter VLA", note: "vision-language-action" },
  { label: "Inference latency", value: "< 40 ms", note: "per control step, on-device" },
  { label: "Compute", value: "Jetson Orin / x86", note: "edge + cloud hybrid" },
  { label: "Sensors", value: "RGB-D + LiDAR + tactile", note: "plug-and-play" },
  { label: "Fleet size", value: "1,000+ units", note: "single control plane" },
  { label: "Uptime", value: "99.95%", note: "rolling 12-month" },
];

export const PROOF_METRICS: ProofMetric[] = [
  { value: "40M+", label: "hours of robot data" },
  { value: "1,200+", label: "deployed units" },
  { value: "99.95%", label: "fleet uptime" },
  { value: "14", label: "industries served" },
];

export const CUSTOMER_LOGOS = [
  "NORDWIND",
  "HELIOS MFG",
  "VANTA LABS",
  "COREX",
  "ATLAS FLEET",
  "MERIDIAN",
];

export const QUOTE = {
  text: "We replaced four bespoke control stacks with one Kinetiq policy. Our engineers now ship new behaviors in a sprint, not a quarter.",
  author: "VP of Engineering",
  company: "Helios Manufacturing",
};
