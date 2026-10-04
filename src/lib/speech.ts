export type SpeechAlternative = { transcript: string };

export type SpeechResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative | undefined;
};

export type SpeechResultList = ArrayLike<SpeechResult>;

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const host = window as SpeechWindow;
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export function speechBlockedReason(hasConstructor: boolean, secureContext: boolean): string | null {
  if (!secureContext) {
    return "Talking needs a secure page. Open this app with https, or on localhost. You can still type.";
  }
  if (!hasConstructor) {
    return "This browser can't hear you. Chrome, Edge, and current Safari can. Firefox usually can't, and older Safari can't either. You can still type.";
  }
  return null;
}

export function speechErrorCopy(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Allow the microphone for this page, then tap Talk again. Say House does not send the recording to its own server.";
  }
  if (code === "audio-capture") return "No microphone was found. You can still type.";
  if (code === "network") {
    return "The browser couldn't turn that into text. You can still type. Say House does not add its own speech service.";
  }
  if (code === "no-speech") return "I didn't hear anything. Tap Talk and try again.";
  return "Talking stopped. Tap Talk again, or type.";
}

export function transcriptFromResults(results: SpeechResultList): { finalText: string; interimText: string } {
  let finalText = "";
  let interimText = "";
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const text = result?.[0]?.transcript ?? "";
    if (result?.isFinal) finalText += text;
    else interimText += text;
  }
  return { finalText: finalText.trim(), interimText: interimText.trim() };
}

export function joinHeard(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
