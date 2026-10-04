"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getSpeechRecognition,
  joinHeard,
  speechBlockedReason,
  speechErrorCopy,
  transcriptFromResults,
  type SpeechRecognitionLike,
} from "@/lib/speech";

function speechAvailability(): string {
  return speechBlockedReason(Boolean(getSpeechRecognition()), window.isSecureContext) ?? "";
}

export function useHouseSpeech(onFinal: (text: string) => void) {
  const availability = useSyncExternalStore(
    () => () => {},
    speechAvailability,
    () => "pending",
  );
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listeningRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const carriedRef = useRef("");
  const sessionFinalRef = useRef("");
  const restartsRef = useRef(0);
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    try {
      recognition?.stop();
    } catch {
      // The session was already closed.
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    const reason = speechBlockedReason(Boolean(Ctor), window.isSecureContext);
    if (!Ctor || reason) {
      setError(reason ?? "This browser can't hear you. Type the phrase instead.");
      return;
    }

    listeningRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      // Nothing was listening.
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const { finalText, interimText } = transcriptFromResults(event.results);
      sessionFinalRef.current = finalText;
      const stable = joinHeard(carriedRef.current, finalText);
      setLiveText(joinHeard(stable, interimText));
      if (stable) onFinalRef.current(stable);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      listeningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setError(speechErrorCopy(event.error));
    };
    recognition.onend = () => {
      if (!listeningRef.current || recognitionRef.current !== recognition) {
        setListening(false);
        return;
      }
      carriedRef.current = joinHeard(carriedRef.current, sessionFinalRef.current);
      sessionFinalRef.current = "";
      if (restartsRef.current >= 20) {
        listeningRef.current = false;
        recognitionRef.current = null;
        setListening(false);
        setError("Talking stopped. Tap Talk again, or type.");
        return;
      }
      restartsRef.current += 1;
      try {
        recognition.start();
      } catch {
        listeningRef.current = false;
        recognitionRef.current = null;
        setListening(false);
      }
    };

    carriedRef.current = "";
    sessionFinalRef.current = "";
    restartsRef.current = 0;
    recognitionRef.current = recognition;
    listeningRef.current = true;
    setError(null);
    setLiveText("");
    setListening(true);
    try {
      recognition.start();
    } catch {
      listeningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setError("The microphone didn't start. Tap Talk again.");
    }
  }, []);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Unmount during an idle session.
      }
    };
  }, []);

  const ready = availability !== "pending";
  const blockedReason = availability === "pending" || availability === "" ? null : availability;

  return {
    ready,
    supported: availability === "",
    blockedReason,
    listening,
    liveText,
    error,
    start,
    stop,
  };
}
