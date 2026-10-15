"use client";

import { useEffect, useState } from "react";
import { apiFetch, getCompanyId } from "./ui";

/** Ask Denny: a question box with the example questions one click away. */
export function AskDenny() {
  const [examples, setExamples] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ question: string; answer: string[]; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/companies/${getCompanyId()}/denny/examples`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { questions: [] }))
      .then((j) => setExamples(j.questions ?? []));
  }, []);

  async function ask(question: string) {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/companies/${getCompanyId()}/denny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? "Denny couldn't answer that.");
      setAnswer(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-title">Ask Denny</div>
      <form
        className="ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Can I afford another crew?" maxLength={500} />
        <button className="btn btn-primary" disabled={busy || q.trim().length < 2}>
          {busy ? "…" : "Ask"}
        </button>
      </form>
      <div className="chips" style={{ marginTop: 12 }}>
        {examples.map((x) => (
          <button key={x} type="button" className="chip" disabled={busy} onClick={() => ask(x)}>
            {x}
          </button>
        ))}
      </div>
      {error && <p className="neg">{error}</p>}
      {answer && (
        <div className="denny-answer">
          <div className="denny-q">{answer.question}</div>
          {answer.answer.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
}
