function base(): string {
  // In production/staging: set NEXT_PUBLIC_AGENT_URL to the hosted agent URL.
  // In local dev: /api → Next.js proxies /api/* to the agent service on 3001.
  return process.env.NEXT_PUBLIC_AGENT_URL ?? "/api";
}

// ── Voice notes (speech → text) ─────────────────────────────────────────────

export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set("audio", blob, "voice-note.webm");

  const res = await fetch(`${base()}/transcribe`, { method: "POST", body: form, signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `Transcription failed (${res.status})`);
  }
  const data = await res.json() as { text?: string };
  return data.text ?? "";
}
