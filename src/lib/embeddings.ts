import { GoogleGenAI } from '@google/genai';

let aiInstance: GoogleGenAI | null = null;

export function getGenAI(): GoogleGenAI | null {
  if (aiInstance) return aiInstance;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  aiInstance = new GoogleGenAI({ apiKey });
  return aiInstance;
}

/**
 * Generate 768-dimensional text embedding for a given string using Gemini API or fallback
 */
export async function generateTextEmbedding(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;
  const cleaned = text.slice(0, 8000);

  const ai = getGenAI();
  if (ai) {
    try {
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: cleaned,
      });
      const embeddingObj = (response as any)?.embedding || (response as any)?.embeddings?.[0];
      if (embeddingObj?.values) {
        return embeddingObj.values;
      }
    } catch (err) {
      console.warn('Gemini embedding failed, creating deterministic hash-vector fallback:', err);
    }
  }

  // Deterministic 768-dim vector fallback if API key not available or rate limited
  const vector: number[] = new Array(768).fill(0);
  let hash = 0;
  for (let i = 0; i < cleaned.length; i++) {
    hash = (hash << 5) - hash + cleaned.charCodeAt(i);
    hash |= 0;
    const idx = Math.abs((hash + i * 31) % 768);
    vector[idx] += 1 / (1 + Math.abs(hash % 10));
  }
  // normalize L2
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
  return vector.map((v) => v / norm);
}
