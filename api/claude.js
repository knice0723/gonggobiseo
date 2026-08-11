// OpenAI(GPT) API 프록시 — GPT-5.6 Terra 기본
// Vercel 환경변수 OPENAI_API_KEY 필요
// (선택) OPENAI_MODEL 로 모델 변경 가능. 기본값: gpt-5.6-terra (지능·비용 균형)
//   - 더 높은 품질: gpt-5.6-sol / 더 저렴: gpt-5.6-luna

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "no_key", message: "OPENAI_API_KEY 환경변수가 설정되지 않았습니다. Vercel → Settings → Environment Variables 를 확인하세요." });
  }

  try {
    const { messages, max_tokens = 1000 } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "bad_request" });
    }

    // Anthropic 형식(프론트) → OpenAI 형식 변환 (텍스트/PDF/이미지)
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

    const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
    const body = {
      model,
      max_completion_tokens: Math.min(max_tokens, 4000),
      messages: oaMessages
    };
    // GPT-5 계열은 추론 강도 조절 가능 — 속도·비용을 위해 low 로 설정
    if (model.indexOf("gpt-5") === 0) body.reasoning_effort = "low";

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + key },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const text = data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || "") : "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "server_error", message: String(e && e.message ? e.message : e) });
  }
};
