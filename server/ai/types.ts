// Provider-independent AI service contracts. The capture pipeline, and in
// Phase 2 Ask Inkwell and AI actions, depend only on these types.

export interface TypeOption {
  type_id: string;
  key: string; // e.g. "paper", "meeting"; user types use their id
  name: string;
  description?: string;
}

export interface ExtractionContext {
  /** Day the capture was made (YYYY-MM-DD), used for "yarın", "bugün". */
  today: string;
  /** Object types the user can pick from. */
  types: TypeOption[];
  /** Names the user already uses (people table), for matching plain-text names. */
  knownPeople: string[];
  /** Metadata fetched for a pasted URL, if any. */
  link?: { url: string; title?: string; description?: string; site?: string; author?: string } | null;
  /** Attached file, if any. */
  file?: { name: string; content_type: string; size: number } | null;
}

export interface Extraction {
  type_key: string;
  type_confidence: number; // 0..1
  title: string;
  summary: string;
  tags: string[];
  people: string[];
  organizations: string[];
  locations: string[];
  dates: string[]; // YYYY-MM-DD
  tasks: string[];
  author?: string | null;
}

export interface AiProvider {
  id: "gemini" | "openai" | "anthropic" | "heuristic" | "mock";
  /** Shown to users next to results, e.g. "Kural tabanlı" or "Gemini". */
  label: string;
  /** true when the provider uses a real language model. */
  isModel: boolean;
  available(): boolean;
  extract(text: string, ctx: ExtractionContext): Promise<Extraction>;
  /** Free-form generation (Ask Inkwell, AI actions). Throws AiUnavailableError without a model. */
  generate(req: GenerateRequest): Promise<string>;
  embed(text: string): Promise<number[] | null>;
  /** Name of the embedding model, so stored vectors from another model are never compared. */
  embedModel?: string;
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Ask for a JSON reply (the caller still parses defensively). */
  json?: boolean;
}

export class AiUnavailableError extends Error {}
