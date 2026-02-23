import { useState, useRef, useEffect } from "react";

// ── constants ──────────────────────────────────────────────────────────────────
const MOTHER_TONGUES = ["Korean", "Spanish", "Italian", "Greek", "English"];

const LESSONS = {
  14: { title: "Proposer une sortie" },
  15: { title: "Se repérer dans la ville" },
  16: { title: "Décrire son quotidien" },
  17: { title: "Faire les courses" },
  18: { title: "Acheter des vêtements" },
  19: { title: "Parler de ses activités" },
  20: { title: "Faire une recette" },
  21: { title: "Commander au restaurant" },
};

const SESSION_DURATION = 20 * 60;

const PHASES = [
  { id: "warmup",  label: "Warm-up",       color: "bg-amber-500",  secs: 120 },
  { id: "core",    label: "Core Practice",  color: "bg-indigo-500", secs: 900 },
  { id: "debrief", label: "Debrief",        color: "bg-green-500",  secs: 180 },
];

function fmt(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function phaseFor(elapsed) {
  if (elapsed < 120) return 0;
  if (elapsed < 1020) return 1;
  return 2;
}

function buildSystemPrompt(motherTongue, lesson, lessonTitle, material, sessionType) {
  return `You are a warm, encouraging French tutor for A1.2 beginners working through the Inspire 1 textbook (by Le Bougnec & Lopes).

STUDENT PROFILE:
- Mother tongue: ${motherTongue}
- Level: A1.2 (beginner-elementary)
- Goal: Pass DELF A1 comfortably by end of course
- Session type: ${sessionType === "monday" ? "Monday recap (covering previous week's Tuesday & Thursday lessons)" : "Day-after review"}

TODAY'S FOCUS: Leçon ${lesson} – "${lessonTitle}"

CLASS MATERIAL (uploaded by student):
"""
${material || `No material uploaded. Use your knowledge of Inspire 1 Leçon ${lesson}: "${lessonTitle}".`}
"""

LANGUAGE GUIDANCE:
- Explain concepts by referencing ${motherTongue} where helpful (cognates, false friends, structural differences).
- Korean speakers: note French word order (SVO) differs from Korean (SOV); articles don't exist in Korean so explain them carefully; French nasal vowels are unique.
- Keep ALL instructions and feedback in English. Use French only for practice prompts, example sentences, and drills.

PRACTICE PRIORITIES (in order):
1. Pronunciation — highlight tricky sounds relevant to this lesson; give phonetic tips.
2. Conversation — short, realistic dialogues fitting the lesson theme.
3. Grammar — focused drills on the grammar points of this lesson.
4. Vocabulary — key words/expressions from this lesson.
Weave in gentle DELF A1 prep throughout (short comprehension snippets, simple oral-style prompts, postcard writing for Leçon 21).

ERROR CORRECTION:
- When the student makes a mistake, first ask them to self-correct ("Almost! Try once more." or "Hmm, regarde encore — tu es sûr(e)?").
- After exactly ONE failed self-correction attempt, reveal and clearly explain the correct answer.
- Always celebrate effort. Never make the student feel bad.

SESSION STRUCTURE:
- Warm-up (first 2 min): 2–3 quick recap questions about the lesson topic.
- Core Practice (next 15 min): Mix pronunciation tip → mini-dialogue → grammar drill → vocab check. Keep it conversational.
- Debrief (final 3 min): Summarise — 2 things they did well, 1 thing to review, 1 DELF A1 tip.

START NOW with the Warm-up. Ask the FIRST warm-up question only, then wait for the student. Keep each message short and conversational.`.trim();
}

// ── API call (via secure serverless proxy) ────────────────────────────────────
async function callClaude(systemPrompt, history) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: history,
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "Désolé, une erreur s'est produite.";
}

// ── main component ─────────────────────────────────────────────────────────────
export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [motherTongue, setMotherTongue] = useState("Korean");
  const [tmpTongue, setTmpTongue]       = useState("Korean");

  const [screen, setScreen]             = useState("home");
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [sessionType, setSessionType]   = useState("review");
  const [pdfText, setPdfText]           = useState("");
  const [pdfName, setPdfName]           = useState("");
  const [pdfLoading, setPdfLoading]     = useState(false);

  const [messages, setMessages]         = useState([]);
  const [input, setInput]               = useState("");
  const [loading, setLoading]           = useState(false);

  const [elapsed, setElapsed]           = useState(0);
  const [running, setRunning]           = useState(false);
  const timerRef  = useRef(null);
  const bottomRef = useRef(null);
  const fileRef   = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (running) {
      timerRef.current = setInterval(() => {
        setElapsed(e => {
          if (e + 1 >= SESSION_DURATION) { endSession(); return SESSION_DURATION; }
          return e + 1;
        });
      }, 1000);
    } else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [running]);

  // ── PDF reader ──────────────────────────────────────────────────────────────
  async function handlePdf(file) {
    if (!file) return;
    setPdfName(file.name);
    setPdfLoading(true);
    setPdfText("");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: "Extract all text content from this document. Return only the raw text, no commentary." }
            ]
          }]
        })
      });
      const data = await res.json();
      const extracted = data.content?.[0]?.text || "";
      setPdfText(extracted);
      const match = extracted.match(/[Ll]e[çc]on\s*(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (LESSONS[num]) setSelectedLesson(num);
      }
    } catch {
      setPdfText("Could not extract PDF text. The tutor will use its built-in knowledge.");
    }
    setPdfLoading(false);
  }

  // ── session control ─────────────────────────────────────────────────────────
  async function startSession() {
    setScreen("session");
    setMessages([]);
    setElapsed(0);
    setLoading(true);
    setRunning(true);
    const sys = buildSystemPrompt(motherTongue, selectedLesson, LESSONS[selectedLesson]?.title, pdfText, sessionType);
    try {
      const init = [{ role: "user", content: "Bonjour ! Je suis prêt(e) pour la session d'aujourd'hui." }];
      const reply = await callClaude(sys, init);
      setMessages([...init, { role: "assistant", content: reply }]);
    } catch {
      setMessages([{ role: "assistant", content: "Oops — connection error. Please retry." }]);
    }
    setLoading(false);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const sys = buildSystemPrompt(motherTongue, selectedLesson, LESSONS[selectedLesson]?.title, pdfText, sessionType);
    const userMsg = { role: "user", content: input.trim() };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);
    try {
      const reply = await callClaude(sys, newHistory);
      setMessages([...newHistory, { role: "assistant", content: reply }]);
    } catch {
      setMessages([...newHistory, { role: "assistant", content: "Désolé, une erreur. Réessaie !" }]);
    }
    setLoading(false);
  }

  async function endSession() {
    setRunning(false);
    setLoading(true);
    const sys = buildSystemPrompt(motherTongue, selectedLesson, LESSONS[selectedLesson]?.title, pdfText, sessionType);
    const prompt = "The 20-minute session is now over. Please give the debrief: 2 things I did well, 1 thing to focus on next time, and 1 DELF A1 tip related to today's lesson. Keep it warm and concise.";
    const finalHistory = [...messages, { role: "user", content: prompt }];
    try {
      const reply = await callClaude(sys, finalHistory);
      setMessages(prev => [
        ...prev,
        { role: "user", content: "⏱ Session terminée !" },
        { role: "assistant", content: reply },
      ]);
    } catch {}
    setLoading(false);
    setScreen("summary");
  }

  function resetToHome() {
    setScreen("home");
    setMessages([]);
    setElapsed(0);
    setSelectedLesson(null);
    setPdfText("");
    setPdfName("");
  }

  const currentPhase = phaseFor(elapsed);
  const progressPct  = Math.min((elapsed / SESSION_DURATION) * 100, 100);
  const timeLeft     = Math.max(SESSION_DURATION - elapsed, 0);

  // ── HOME ────────────────────────────────────────────────────────────────────
  if (screen === "home") return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex flex-col items-center justify-center p-6">
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <h2 className="text-lg font-bold mb-1 text-gray-800">⚙️ Settings</h2>
            <p className="text-xs text-gray-400 mb-4">Affects how the tutor explains concepts.</p>
            <label className="block text-sm font-medium text-gray-600 mb-1">Your mother tongue</label>
            <select className="w-full border rounded-lg px-3 py-2 mb-6 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={tmpTongue} onChange={e => setTmpTongue(e.target.value)}>
              {MOTHER_TONGUES.map(t => <option key={t}>{t}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setShowSettings(false)}
                className="flex-1 py-2 rounded-lg border text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => { setMotherTongue(tmpTongue); setShowSettings(false); }}
                className="flex-1 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
            </div>
          </div>
        </div>
      )}
      <div className="w-full max-w-md">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-indigo-800">🇫🇷 Mon Tuteur</h1>
            <p className="text-indigo-400 text-sm mt-1">Inspire 1 · A1.2 · DELF Prep</p>
          </div>
          <button onClick={() => { setTmpTongue(motherTongue); setShowSettings(true); }}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-indigo-100 text-xl transition">⚙️</button>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Studying as</p>
            <p className="font-semibold text-gray-700 mt-0.5">🗣 <span className="text-indigo-600">{motherTongue}</span> speaker</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-gray-400">Course</p>
            <p className="font-semibold text-gray-700 mt-0.5">A1.2 · 8 leçons</p>
          </div>
        </div>
        <button onClick={() => setScreen("setup")}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-lg shadow-md transition mb-5">
          Commencer la session ▶
        </button>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400 mb-3">Course lessons</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(LESSONS).map(([num, l]) => (
              <div key={num} className="bg-indigo-50 rounded-xl p-3">
                <p className="font-bold text-indigo-700 text-sm">Leçon {num}</p>
                <p className="text-xs text-gray-500 leading-tight mt-0.5">{l.title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ── SETUP ───────────────────────────────────────────────────────────────────
  if (screen === "setup") return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6">
        <button onClick={() => setScreen("home")} className="text-indigo-400 hover:text-indigo-600 mb-4 text-sm">← Back</button>
        <h2 className="text-xl font-bold text-gray-800 mb-5">Set up today's session</h2>
        <label className="block text-sm font-medium text-gray-600 mb-2">Session type</label>
        <div className="flex gap-2 mb-6">
          {[["review", "📖 Day-after review", "Wed or Fri"], ["monday", "🔁 Monday recap", "Previous Tue + Thu"]].map(([v, label, sub]) => (
            <button key={v} onClick={() => setSessionType(v)}
              className={`flex-1 py-3 px-2 rounded-xl border-2 text-sm font-medium transition text-left ${sessionType === v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-500 hover:border-indigo-200"}`}>
              <div>{label}</div>
              <div className="text-xs font-normal mt-0.5 opacity-60">{sub}</div>
            </button>
          ))}
        </div>
        <label className="block text-sm font-medium text-gray-600 mb-2">
          Which leçon? <span className="text-gray-400 font-normal">(auto-detected from PDF)</span>
        </label>
        <div className="grid grid-cols-4 gap-2 mb-1">
          {Object.keys(LESSONS).map(n => (
            <button key={n} onClick={() => setSelectedLesson(Number(n))}
              className={`py-3 rounded-xl border-2 text-sm font-bold transition ${selectedLesson === Number(n) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-400 hover:border-indigo-300"}`}>
              {n}
            </button>
          ))}
        </div>
        {selectedLesson && (
          <p className="text-xs text-indigo-500 mb-5 pl-1">📚 {LESSONS[selectedLesson].title}</p>
        )}
        {!selectedLesson && <div className="mb-5" />}
        <label className="block text-sm font-medium text-gray-600 mb-2">Upload class notes (PDF)</label>
        <div onClick={() => fileRef.current?.click()}
          className={`w-full border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition mb-5 ${pdfName ? "border-indigo-400 bg-indigo-50" : "border-gray-300 hover:border-indigo-300 hover:bg-indigo-50"}`}>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={e => handlePdf(e.target.files?.[0])} />
          {pdfLoading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-indigo-500">Reading PDF…</p>
            </div>
          ) : pdfName ? (
            <div>
              <p className="text-2xl mb-1">📄</p>
              <p className="text-sm font-medium text-indigo-700">{pdfName}</p>
              <p className="text-xs text-gray-400 mt-1">{pdfText ? `${pdfText.length.toLocaleString()} characters extracted` : "Extraction failed — tutor will use built-in knowledge"}</p>
              <button className="text-xs text-red-400 mt-2 hover:text-red-600"
                onClick={e => { e.stopPropagation(); setPdfName(""); setPdfText(""); }}>Remove</button>
            </div>
          ) : (
            <div>
              <p className="text-3xl mb-2">📎</p>
              <p className="text-sm font-medium text-gray-600">Click to upload your class notes PDF</p>
              <p className="text-xs text-gray-400 mt-1">The tutor reads it and anchors the session to it</p>
            </div>
          )}
        </div>
        <button disabled={!selectedLesson || pdfLoading} onClick={startSession}
          className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-lg shadow-md transition">
          Allons-y ! 🚀
        </button>
      </div>
    </div>
  );

  // ── SESSION / SUMMARY ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-800 text-sm truncate">Leçon {selectedLesson} · {LESSONS[selectedLesson]?.title}</p>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {PHASES.map((p, i) => (
                <span key={p.id} className={`text-xs px-2 py-0.5 rounded-full font-medium transition-all ${
                  screen === "session" && i === currentPhase ? `${p.color} text-white`
                  : i < currentPhase || screen === "summary" ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-400"
                }`}>
                  {(i < currentPhase || screen === "summary") ? "✓ " : ""}{p.label}
                </span>
              ))}
            </div>
          </div>
          <div className="ml-3 text-right flex-shrink-0">
            {screen === "session" ? (
              <>
                <p className={`font-mono font-bold text-xl leading-none ${timeLeft < 60 ? "text-red-500" : "text-indigo-600"}`}>{fmt(timeLeft)}</p>
                <p className="text-xs text-gray-400 mt-0.5">remaining</p>
              </>
            ) : (
              <span className="text-sm font-medium text-green-600 bg-green-50 px-3 py-1 rounded-full">✓ Done</span>
            )}
          </div>
        </div>
        <div className="h-1 bg-gray-100 rounded-full mt-2 overflow-hidden">
          <div className="h-1 bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && <span className="text-lg mr-2 mt-1 flex-shrink-0">🇫🇷</span>}
            <div className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
            }`}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <span className="text-lg mr-2 flex-shrink-0">🇫🇷</span>
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center">
                {[0,1,2].map(i => (
                  <div key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {screen === "session" ? (
        <div className="bg-white border-t border-gray-100 px-4 py-3">
          <div className="flex gap-2">
            <input
              className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Écris ta réponse ici…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              disabled={loading}
            />
            <button onClick={sendMessage} disabled={loading || !input.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-sm font-medium transition">
              Send
            </button>
            <button onClick={endSession} disabled={loading}
              className="px-3 py-2 border border-gray-200 hover:bg-gray-50 text-gray-400 hover:text-gray-600 rounded-xl text-sm transition" title="End session early">
              ⏹
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">Press ⏹ to end early and get your debrief</p>
        </div>
      ) : (
        <div className="bg-white border-t border-gray-100 px-4 py-4 flex gap-3">
          <button onClick={resetToHome}
            className="flex-1 py-3 border-2 border-indigo-200 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-50 transition">🏠 Home</button>
          <button onClick={() => { setScreen("setup"); setMessages([]); setElapsed(0); }}
            className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition">🔄 New Session</button>
        </div>
      )}
    </div>
  );
}
