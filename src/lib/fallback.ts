import { findGap, findTarget, gapOutranksTarget } from "@/lib/match";
import { chooseAction, unknownReply } from "@/lib/policy";
import type { AppConfig, ProposedIntent } from "@/lib/types";

export type FallbackResult =
  | { type: "intent"; intent: ProposedIntent }
  | { type: "reply"; reply: string; tone: "ask" | "refuse"; refused: boolean };

export function parseFallback(utterance: string, config: AppConfig): FallbackResult {
  const gap = gapOutranksTarget(utterance, config.gaps, config.targets);
  if (gap) return { type: "reply", reply: gap.reply, tone: "refuse", refused: true };

  const found = findTarget(utterance, config.targets);
  if (found.type === "many") {
    const names = found.targets.map((target) => target.alias).join(", ");
    return {
      type: "reply",
      reply: `I heard more than one thing (${names}). Say just one of them.`,
      tone: "ask",
      refused: false,
    };
  }
  if (found.type === "none") {
    const namedGap = findGap(utterance, config.gaps);
    if (namedGap) return { type: "reply", reply: namedGap.gap.reply, tone: "refuse", refused: true };
    return { type: "reply", reply: unknownReply(config), tone: "refuse", refused: true };
  }

  const chosen = chooseAction(utterance, found.target, config.targets);
  if (!chosen.ok) return { type: "reply", reply: chosen.reply, tone: "ask", refused: false };
  return {
    type: "intent",
    intent: {
      action: chosen.action,
      targetAlias: found.target.alias,
      brightnessPct: chosen.brightnessPct,
    },
  };
}
