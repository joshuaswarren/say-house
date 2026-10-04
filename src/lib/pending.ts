import { normalize } from "@/lib/normalize";
import type { Action } from "@/lib/types";

export interface PendingAction {
  targetAlias: string;
  action: Action;
  brightnessPct: number | null;
  utterance: string;
  expires: number;
}

const pending = new Map<string, PendingAction>();
const YES = /^(yes|yeah|yep|yup|ok|okay|sure|confirm|do it)( please)?$/;
const NO = /^(no|nope|cancel|stop|never mind|nevermind)$/;

export function confirmationAnswer(text: string): "yes" | "no" | null {
  const normalized = normalize(text);
  if (YES.test(normalized)) return "yes";
  if (NO.test(normalized)) return "no";
  return null;
}

export function setPending(sessionId: string, action: PendingAction): void {
  pending.set(sessionId, action);
}

export function getPending(sessionId: string): PendingAction | null {
  const value = pending.get(sessionId);
  if (!value) return null;
  if (value.expires < Date.now()) {
    pending.delete(sessionId);
    return null;
  }
  return value;
}

export function clearPending(sessionId: string): void {
  pending.delete(sessionId);
}

export function resetPending(): void {
  pending.clear();
}
