export const MODELS = {
  SONNET_4_6: "claude-sonnet-4-6",
  OPUS_4_7: "claude-opus-4-7",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export const MODEL_LABELS: Record<ModelId, string> = {
  [MODELS.SONNET_4_6]: "Sonnet 4.6",
  [MODELS.OPUS_4_7]: "Opus 4.7",
};

export function isModelId(v: unknown): v is ModelId {
  return v === MODELS.SONNET_4_6 || v === MODELS.OPUS_4_7;
}
