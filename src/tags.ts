/**
 * The tag registry: every tag a post may use, defined once (like the
 * options of a Notion multi-select). Posts list tag ids in front matter;
 * an id not in this file, or more than MAX_TAGS, fails the build.
 *
 * Rules: lowercase-hyphen ids, one spelling (US), singular topics.
 * Project and post kind are front-matter fields, not tags.
 * To merge a tag: move its id into the canonical tag's `aliases` and
 * update the posts; /tags/<alias>/ then redirects to the canonical page.
 */
export const TAG_GROUPS = [
  "Serving",
  "Method",
  "Models",
  "Data",
  "Architecture",
  "Stack",
  "Other",
] as const;

export type TagGroup = (typeof TAG_GROUPS)[number];

export type TagMeta = {
  name: string;
  group: TagGroup;
  description: string;
  aliases?: readonly string[];
};

export const MAX_TAGS = 5;

export const TAG_REGISTRY = {
  // Serving
  "llm-serving": {
    name: "LLM serving",
    group: "Serving",
    description: "Running language models behind an API for many users.",
    aliases: ["inference", "overview"],
  },
  batching: {
    name: "Batching",
    group: "Serving",
    description:
      "How requests share a GPU step: continuous batching, chunked prefill, token budgets.",
    aliases: [
      "batch",
      "continuous-batching",
      "chunked-prefill",
      "prefill",
      "token-budget",
      "pdmux",
    ],
  },
  "kv-cache": {
    name: "KV cache",
    group: "Serving",
    description:
      "The attention key/value memory: paging, prefix reuse, offload to CPU.",
    aliases: [
      "paged-attention",
      "radix-attention",
      "prefix-cache",
      "memory",
      "memory-fraction",
      "offload",
      "kv-offload",
    ],
  },
  quantization: {
    name: "Quantization",
    group: "Serving",
    description:
      "Smaller number formats (FP8, INT4) and what they cost in quality.",
    aliases: ["quantisation", "fp8", "int4", "quality"],
  },
  parallelism: {
    name: "Parallelism",
    group: "Serving",
    description:
      "Splitting or copying a model across GPUs: tensor parallel, replicas, disaggregation.",
    aliases: ["tensor-parallel", "disaggregation", "co-location", "replicas"],
  },
  routing: {
    name: "Routing",
    group: "Serving",
    description:
      "Gateways, queues, rate limits and which replica gets a request.",
    aliases: [
      "router",
      "gateway",
      "rate-limit",
      "admission-control",
      "queue",
      "head-of-line",
      "scheduling",
    ],
  },
  latency: {
    name: "Latency",
    group: "Serving",
    description:
      "Time to first token, time per output token, SLOs and cold starts.",
    aliases: ["ttft", "tpot", "slo", "cold-start", "cuda-graph"],
  },
  capacity: {
    name: "Capacity",
    group: "Serving",
    description:
      "How many users a system holds: load models, Little's law, autoscaling.",
    aliases: [
      "capacity-model",
      "little-law",
      "autoscaling",
      "think-time",
      "closed-loop",
      "load-shapes",
      "load-generation",
    ],
  },
  // Method
  benchmarking: {
    name: "Benchmarking",
    group: "Method",
    description:
      "Measuring fairly: baselines, noise, paired tests, harnesses, tuning.",
    aliases: [
      "methodology",
      "noise",
      "paired-test",
      "baseline",
      "baselines",
      "diagnostics",
      "determinism",
      "harness",
      "tuning",
    ],
  },
  evaluation: {
    name: "Evaluation",
    group: "Method",
    description: "Scoring results, ablations, and what did not work.",
    aliases: ["ablation", "negative-results", "lessons", "field-notes"],
  },
  cost: {
    name: "Cost",
    group: "Method",
    description: "What a system costs to run, per month or per request.",
  },
  // Models
  "fine-tuning": {
    name: "Fine-tuning",
    group: "Models",
    description: "SFT, LoRA and distillation, and how they overfit.",
    aliases: [
      "sft",
      "lora",
      "training",
      "self-distillation",
      "overfitting",
      "generalisation",
    ],
  },
  agents: {
    name: "Agents",
    group: "Models",
    description: "Models that act in a loop: ReAct, CodeAct, tool calls.",
    aliases: ["codeact", "react", "tool-calling", "code-generation"],
  },
  "self-consistency": {
    name: "Self-consistency",
    group: "Models",
    description: "Sampling several answers and voting.",
    aliases: ["vote", "voting"],
  },
  abstention: {
    name: "Abstention",
    group: "Models",
    description: "When a model should say it does not know.",
    aliases: ["abstain"],
  },
  vlm: {
    name: "Vision-language models",
    group: "Models",
    description: "Models that read images as well as text.",
  },
  moe: {
    name: "Mixture of experts",
    group: "Models",
    description: "Models that route each token to a few expert layers.",
  },
  qwen: {
    name: "Qwen",
    group: "Models",
    description: "The Qwen model family.",
    aliases: ["qwen3-4b", "qwen3.5"],
  },
  // Data
  "table-qa": {
    name: "Table QA",
    group: "Data",
    description:
      "Answering questions over spreadsheets: loading, cleaning, schema mapping.",
    aliases: [
      "excel",
      "data-cleaning",
      "schema-mapping",
      "semantic-layer",
      "loader",
      "data-layer",
    ],
  },
  retrieval: {
    name: "Retrieval",
    group: "Data",
    description: "Embeddings and search that feed a model.",
    aliases: ["embedding"],
  },
  // Architecture
  "system-design": {
    name: "System design",
    group: "Architecture",
    description: "The shape of a whole system and the trade-offs behind it.",
    aliases: ["architecture", "software-architecture"],
  },
  ddd: {
    name: "Domain-driven design",
    group: "Architecture",
    description:
      "Bounded contexts, layers and module boundaries in a codebase.",
    aliases: [
      "hexagonal",
      "clean-architecture",
      "module-design",
      "modularity",
      "connascence",
      "monorepo",
    ],
  },
  microservices: {
    name: "Microservices",
    group: "Architecture",
    description: "Small services that own their data and deploy alone.",
  },
  "event-driven": {
    name: "Event-driven",
    group: "Architecture",
    description: "Services that talk through events and queues.",
    aliases: ["outbox", "saga", "idempotency", "cqrs"],
  },
  serverless: {
    name: "Serverless",
    group: "Architecture",
    description: "Functions that run on demand, such as AWS Lambda.",
    aliases: ["aws-lambda", "lambda"],
  },
  realtime: {
    name: "Real-time",
    group: "Architecture",
    description:
      "WebSockets, push notifications, sync across devices and WebRTC calls.",
    aliases: [
      "websocket",
      "real-time",
      "sync",
      "push-notifications",
      "webrtc",
      "turn",
      "sfu",
    ],
  },
  security: {
    name: "Security",
    group: "Architecture",
    description:
      "Authentication, tokens, trust boundaries and least privilege.",
  },
  reliability: {
    name: "Reliability",
    group: "Architecture",
    description: "High availability, backups and disaster recovery.",
    aliases: ["high-availability", "disaster-recovery", "backups"],
  },
  // Stack
  vllm: {
    name: "vLLM",
    group: "Stack",
    description: "The vLLM serving engine.",
  },
  sglang: {
    name: "SGLang",
    group: "Stack",
    description: "The SGLang serving engine.",
  },
  "tensorrt-llm": {
    name: "TensorRT-LLM",
    group: "Stack",
    description: "NVIDIA's TensorRT-LLM serving engine.",
  },
  "llama-cpp": {
    name: "llama.cpp",
    group: "Stack",
    description: "llama.cpp and running models locally, e.g. on a Mac.",
    aliases: ["local", "apple-silicon"],
  },
  "nvidia-l4": {
    name: "NVIDIA L4",
    group: "Stack",
    description: "The 24 GB L4 GPU.",
    aliases: ["l4"],
  },
  "nvidia-l40s": {
    name: "NVIDIA L40S",
    group: "Stack",
    description: "The 48 GB L40S GPU.",
    aliases: ["l40s"],
  },
  aws: {
    name: "AWS",
    group: "Stack",
    description: "Amazon Web Services.",
  },
  modal: {
    name: "Modal",
    group: "Stack",
    description: "Modal serverless GPUs and containers.",
    aliases: ["docker"],
  },
  typescript: {
    name: "TypeScript",
    group: "Stack",
    description: "TypeScript on the server and the client.",
  },
  postgresql: {
    name: "PostgreSQL",
    group: "Stack",
    description: "PostgreSQL, hosted on Supabase and Neon.",
    aliases: ["postgres"],
  },
  mobile: {
    name: "Client apps",
    group: "Stack",
    description: "Web, PWA, Android (Capacitor) and native macOS clients.",
    aliases: ["capacitor", "swift", "pwa"],
  },
  // Other
  vietnamese: {
    name: "Vietnamese",
    group: "Other",
    description: "Vietnamese-language data and competitions.",
    aliases: ["zalo-ai-challenge"],
  },
} as const satisfies Record<string, TagMeta>;

export type TagId = keyof typeof TAG_REGISTRY;

export const TAG_IDS = Object.keys(TAG_REGISTRY) as [TagId, ...TagId[]];

export function tagMeta(id: TagId): TagMeta {
  return TAG_REGISTRY[id];
}

/** Old tag name -> canonical id, for redirects. */
export const TAG_ALIASES: Record<string, TagId> = Object.fromEntries(
  (Object.entries(TAG_REGISTRY) as [TagId, TagMeta][]).flatMap(([id, m]) =>
    (m.aliases ?? []).map(a => [a, id])
  )
);
