import { contentWords, wordSet } from "@/lib/normalize";
import type { Gap, Target } from "@/lib/types";

export interface PhraseHit<T> {
  item: T;
  score: number;
}

export function phraseScore(utteranceWords: Set<string>, phrase: string): number | null {
  const words = contentWords(phrase);
  if (words.length === 0) return null;
  if (!words.every((word) => utteranceWords.has(word))) return null;
  return words.length;
}

export function bestPhraseScore(utterance: string, phrases: string[]): number | null {
  const words = wordSet(utterance);
  let best: number | null = null;
  for (const phrase of phrases) {
    const score = phraseScore(words, phrase);
    if (score == null) continue;
    if (best == null || score > best) best = score;
  }
  return best;
}

export function findTarget(
  utterance: string,
  targets: Target[],
): { type: "none" } | { type: "one"; target: Target; score: number } | { type: "many"; targets: Target[] } {
  const ranked: PhraseHit<Target>[] = [];
  for (const target of targets) {
    const score = bestPhraseScore(utterance, target.phrases);
    if (score == null) continue;
    ranked.push({ item: target, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { type: "none" };
  const top = ranked[0];
  const contenders = ranked.filter((hit) => hit.score === top.score || (hasAnd(utterance) && hit.score >= 1));
  const unique = new Map<string, Target>();
  for (const hit of contenders) unique.set(hit.item.alias, hit.item);
  if (unique.size > 1 && (contenders.some((hit) => hit.score === top.score && hit.item.alias !== top.item.alias) || hasAnd(utterance))) {
    return { type: "many", targets: [...unique.values()] };
  }
  return { type: "one", target: top.item, score: top.score };
}

export function findGap(utterance: string, gaps: Gap[]): { gap: Gap; score: number } | null {
  let best: { gap: Gap; score: number } | null = null;
  for (const gap of gaps) {
    const score = bestPhraseScore(utterance, gap.phrases);
    if (score == null) continue;
    if (!best || score > best.score) best = { gap, score };
  }
  return best;
}

export function gapOutranksTarget(utterance: string, gaps: Gap[], targets: Target[]): Gap | null {
  const gap = findGap(utterance, gaps);
  if (!gap) return null;
  const target = findTarget(utterance, targets);
  const targetScore = target.type === "one" ? target.score : 0;
  if (gap.score > targetScore) return gap.gap;
  return null;
}

function hasAnd(utterance: string): boolean {
  return /\band\b/i.test(utterance);
}
