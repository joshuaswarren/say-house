const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "my",
  "our",
  "please",
  "just",
  "can",
  "you",
  "would",
  "for",
  "me",
  "in",
  "of",
  "and",
  "turn",
  "switch",
  "set",
  "make",
  "put",
  "lets",
  "let",
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\bgood\s+night\b/g, "goodnight")
    .replace(/\bnight\s+light\b/g, "nightlight")
    .replace(/\bbrighten(?:ed|er)?\b/g, "bright")
    .replace(/\bdimm(?:er|ed)\b/g, "dim")
    .replace(/\brelax(?:ed|ing)\b/g, "relax")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function contentWords(text: string): string[] {
  const normalized = normalize(text);
  if (!normalized) return [];
  return normalized.split(" ").filter((word) => word && !STOPWORDS.has(word));
}

export function wordSet(text: string): Set<string> {
  return new Set(contentWords(text));
}

export function brightnessPct(text: string): number | null {
  const normalized = normalize(text);
  const match = normalized.match(/\b(\d{1,3})\s*%/) ?? normalized.match(/\b(\d{1,3})\s*percent\b/);
  if (match) {
    const value = Number(match[1]);
    if (value >= 0 && value <= 100) return value;
  }
  if (/\bhalf\b/.test(normalized)) return 50;
  return null;
}
