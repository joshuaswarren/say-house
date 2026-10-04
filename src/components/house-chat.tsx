"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHouseSpeech } from "@/components/use-house-speech";
import type { HealthInfo, Tone } from "@/lib/types";

type Bubble = {
  id: number;
  role: "user" | "assistant";
  text: string;
  tone?: Tone;
  modelUsed?: boolean;
};

let bubbleId = 1;

export function HouseChat() {
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([
    {
      id: 0,
      role: "assistant",
      text: "Say what you want the house to do. I'll only change lights and scenes on the allowlist.",
      tone: "ok",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const speech = useHouseSpeech((text) => setDraft(text));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then(async (response) => {
        const data = (await response.json()) as HealthInfo & { error?: string; reply?: string };
        if (!response.ok) throw new Error(data.error ?? data.reply ?? "The house config couldn't be read.");
        if (cancelled) return;
        setHealth(data);
        if (data.dryRunLocked) setDryRun(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setHealthError(error instanceof Error ? error.message : "Couldn't reach Say House.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function send(text: string) {
    const message = text.trim();
    speech.stop();
    if (!message || sending || healthError) return;
    setDraft("");
    setMessages((current) => [...current, { id: bubbleId++, role: "user", text: message }]);
    setSending(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, sessionId: sessionId(), dryRun }),
      });
      const data = (await response.json().catch(() => null)) as {
        reply?: string;
        tone?: Tone;
        modelUsed?: boolean;
      } | null;
      setMessages((current) => [
        ...current,
        {
          id: bubbleId++,
          role: "assistant",
          text: data?.reply ?? "Say House didn't answer. Try again in a moment.",
          tone: data?.tone ?? "error",
          modelUsed: data?.modelUsed,
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: bubbleId++,
          role: "assistant",
          text: "I couldn't reach Say House. Check that the app is running and try again.",
          tone: "error",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const phrase = (speech.listening ? speech.liveText : draft).trim();
  const phraseReady = phrase.length > 0;
  const last = messages[messages.length - 1];
  const showConfirm = last?.role === "assistant" && last.tone === "confirm" && !sending;
  const showChips = messages.length <= 1 && !sending && (health?.suggestions.length ?? 0) > 0;
  const modelLabel = health?.llmConfigured ? health.llmModel : "Keywords only";

  return (
    <div className="min-h-dvh bg-background md:bg-[#e4d5c3] md:p-6">
      <div className="mx-auto flex h-dvh max-w-lg flex-col bg-background md:h-[calc(100dvh-3rem)] md:overflow-hidden md:rounded-3xl md:border md:border-border md:shadow-sm">
        <header className="shrink-0 border-b border-border px-4 py-4">
          <div className="flex items-start gap-3">
            <LampMark />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl leading-none text-foreground">Say House</h1>
              <p className="mt-1 text-sm text-muted-foreground">{health?.tagline ?? "Plain English for the lights."}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <StatusPill>{health ? backendLabel(health.backend) : "Checking the link…"}</StatusPill>
            <StatusPill>{modelLabel}</StatusPill>
            {health ? <span className="text-muted-foreground">{health.configFile}</span> : null}
          </div>
          {health && !health.llmConfigured ? (
            <p className="mt-3 text-sm leading-5 text-muted-foreground">
              Keyword backup is on. Point <span className="font-medium text-foreground">LLM_BASE_URL</span> at a local
              OpenAI-compatible server and an open-weight model will parse what you say.
            </p>
          ) : null}
          {health && !health.backendReady ? (
            <p className="mt-2 text-sm text-destructive">{health.backendMessage}</p>
          ) : null}
          {healthError ? <p className="mt-2 text-sm text-destructive">{healthError}</p> : null}
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              showBackup={message.modelUsed === false && Boolean(health?.llmConfigured)}
            />
          ))}
          {sending ? <p className="text-sm text-muted-foreground">Asking the house…</p> : null}
          {showChips ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {health?.suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  className="h-10 rounded-full px-3"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          ) : null}
          {showConfirm ? (
            <div className="flex gap-2">
              <Button type="button" className="h-11 px-4" onClick={() => void send("yes")}>
                Yes
              </Button>
              <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void send("no")}>
                No
              </Button>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form
          className="shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(event) => {
            event.preventDefault();
            void send(speech.listening ? speech.liveText : draft);
          }}
        >
          {speech.supported ? (
            <Button
              type="button"
              variant={phraseReady ? "outline" : "default"}
              className="h-14 w-full text-lg"
              aria-pressed={speech.listening}
              disabled={sending || Boolean(healthError)}
              onClick={() => {
                if (speech.listening) {
                  const heard = speech.liveText.trim();
                  speech.stop();
                  if (heard) setDraft(heard);
                  return;
                }
                setDraft("");
                speech.start();
              }}
            >
              <Mic aria-hidden="true" />
              {speech.listening ? "Done" : "Talk"}
            </Button>
          ) : null}
          <p className="mt-2 min-h-5 text-sm text-muted-foreground" aria-live="polite">
            {speechCaption(speech, draft)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <label htmlFor={inputId} className="sr-only">
              Phrase
            </label>
            <Input
              id={inputId}
              value={speech.listening ? speech.liveText : draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={health?.suggestions[0] ? `Or type “${health.suggestions[0]}”` : "Or type what you want"}
              maxLength={400}
              autoComplete="off"
              enterKeyHint="send"
              readOnly={speech.listening}
              disabled={Boolean(healthError)}
              aria-invalid={speech.error ? true : undefined}
              className="h-12 px-3 text-base md:text-base"
            />
            <Button
              type="submit"
              variant={phraseReady ? "default" : "outline"}
              className="h-12 px-4 text-base"
              disabled={sending || Boolean(healthError) || !phraseReady}
            >
              Send
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={dryRun}
                disabled={health?.dryRunLocked}
                onChange={(event) => setDryRun(event.target.checked)}
              />
              Dry run
            </label>
            <p className="text-right text-xs text-muted-foreground">Locks, garage, alarms, and cameras are refused.</p>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message, showBackup }: { message: Bubble; showBackup: boolean }) {
  const mine = message.role === "user";
  const tone = message.tone ?? "ok";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          mine
            ? "max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-base text-primary-foreground"
            : `max-w-[85%] rounded-2xl rounded-bl-md border px-3 py-2 text-base ${bubbleClass(tone)}`
        }
      >
        {!mine && tone === "refuse" ? (
          <p className="mb-1 text-xs font-medium tracking-wide uppercase">Not doing that</p>
        ) : null}
        {!mine && tone === "error" ? <p className="mb-1 text-xs font-medium tracking-wide uppercase">House did not answer</p> : null}
        <p className="whitespace-pre-wrap leading-6">{message.text}</p>
        {showBackup ? <p className="mt-1 text-xs text-muted-foreground">Keyword backup. The model did not answer.</p> : null}
      </div>
    </div>
  );
}

function bubbleClass(tone: Tone): string {
  if (tone === "refuse") return "border-destructive/30 bg-card text-foreground";
  if (tone === "error") return "border-destructive/40 bg-card text-foreground";
  if (tone === "confirm" || tone === "ask") return "border-primary/30 bg-card text-foreground";
  return "border-border bg-card text-foreground";
}

function StatusPill({ children }: { children: string }) {
  return <span className="rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground">{children}</span>;
}

function backendLabel(backend: HealthInfo["backend"]): string {
  if (backend === "homeassistant") return "Home Assistant";
  if (backend === "hue") return "Hue bridge";
  return "Mock house";
}

function speechCaption(
  speech: {
    ready: boolean;
    supported: boolean;
    blockedReason: string | null;
    listening: boolean;
    liveText: string;
    error: string | null;
  },
  draft: string,
): string {
  if (!speech.ready) return "";
  if (speech.error) return speech.error;
  if (!speech.supported) return speech.blockedReason ?? "You can still type.";
  if (speech.listening) {
    return speech.liveText
      ? `Hearing “${shortPhrase(speech.liveText)}”. Tap Send to tell the house.`
      : "Listening… say a phrase, then Send.";
  }
  const phrase = draft.trim();
  if (phrase) return `Send “${shortPhrase(phrase)}” to the house, or tap Talk to say it again.`;
  return "Tap Talk and say what you want. Typing works too.";
}

function shortPhrase(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}…`;
}

function sessionId(): string {
  const key = "sayhouse.session";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function LampMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className="size-10 shrink-0">
      <rect width="40" height="40" rx="12" fill="#f3e2d2" />
      <path d="M10 16h20l-2.2 7H12.2L10 16z" fill="#c4653a" />
      <path d="M20 23v7" stroke="#5c3d32" strokeWidth="1.6" />
      <path d="M15 30h10" stroke="#5c3d32" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
