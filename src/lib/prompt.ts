const PANORAMA_PREFIX = "360 equirectangular image";
const PREFIX_DETECTOR = /\b360\b.*\bequirectangular\b/i;

export function buildPrompt(userInput: string): string {
  const trimmed = userInput.trim();
  if (trimmed.length === 0) {
    throw new Error("Prompt cannot be empty.");
  }
  if (PREFIX_DETECTOR.test(trimmed)) {
    return trimmed;
  }
  return `${PANORAMA_PREFIX}, ${trimmed}`;
}
