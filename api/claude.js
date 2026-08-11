// AI 비서 프록시 — GPT / Claude / Gemini 멀티 프로바이더
// 환경변수: OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY (사용할 회사 것만 등록)

const MODELS = {
  "gpt-5.6-terra": "openai", "gpt-5.6-sol": "openai", "gpt-5.6-luna": "openai",
  "claude-sonnet-4-6": "anthropic", "claude-haiku-4-5-20251001": "anthropic",
  "gemini-3.6-flash": "google", "gemini-3.5-flash-lite": "google"
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { messages, max_tokens = 1000 } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "bad_request" });

    const reqModel = req.body && req.body.model;
    const model = MODELS[reqModel] ? reqModel : (process.env.OPENAI_MODEL || "gpt-5.6-terra");
    const provider = MODELS[model] || "openai";
    const maxTok = Math.min(max_tokens, 4000);

    /* ── Anthropic (Claude): 프론트가 이미 Anthropic 형식이라 그대로 전달 ── */
    if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) return res.status(500).json({ error: "no_key", message: "Claude 모델은 ANTHROPIC_API_KEY 환경변수가 필요합니다." });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTok, messages })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return res.status(200).json({ text });
    }

    /* ── Google (Gemini): generateContent 형식으로 변환 ── */
    if (provider === "google") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return res.status(500).json({ error: "no_key", message: "Gemini 모델은 GEMINI_API_KEY 환경변수가 필요합니다." });
      const contents = messages.map((m) => {
        const role = m.role === "assistant" ? "model" : "user";
        let parts;
        if (typeof m.content === "string") parts = [{ text: m.content }];
        else parts = (m.content || []).map((b) => {
          if (b.type === "text") return { text: b.text };
          if ((b.type === "document" || b.type === "image") && b.source && b.source.type === "base64") {
            return { inline_data: { mime_type: b.source.media_type || "application/pdf", data: b.source.data } };
          }
          return null;
        }).filter(Boolean);
        return { role, parts };
      });
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTok } })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      const cand = data.candidates && data.candidates[0];
      const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || "").join("") : "";
      return res.status(200).json({ text });
    }

    /* ── OpenAI (GPT) ── */
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: "no_key", message: "GPT 모델은 OPENAI_API_KEY 환경변수가 필요합니다." });
    const oaMessages = messages.map((m) => {
      if (typeof m.content === "string") return { role: m.role, content: m.content };
      const parts = (m.content || []).map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "document" && b.source && b.source.type === "base64") {
          return { type: "file", file: { filename: "document.pdf", file_data: "data:" + (b.source.media_type || "application/pdf") + ";base64," + b.source.data } };
        }
        if (b.type === "image" && b.source && b.source.type === "base64") {
          return { type: "image_url", image_url: { url: "data:" + b.source.media_type + ";base64," + b.source.data } };
        }
        return null;
      }).filter(Boolean);
      return { role: m.role, content: parts };
    });
    const body = { model, max_completion_tokens: maxTok, messages: oaMessages };
    if (model.indexOf("gpt-5") === 0) body.reasoning_effort = "low";
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + key },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    const text = data.choices && data.choices[0] && data.choices[0].message ? String(data.choices[0].message.content || "") : "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "server_error", message: String(e && e.message ? e.message : e) });
  }
};
