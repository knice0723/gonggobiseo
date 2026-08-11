// OpenAI(GPT) API 프록시
// 브라우저에 API 키를 노출하지 않기 위해 서버에서 대신 호출합니다.
// Vercel 환경변수 OPENAI_API_KEY 필요
// (선택) OPENAI_MODEL 환경변수로 모델 변경 가능. 기본값: gpt-4o-mini

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

    // 프론트엔드는 Anthropic 형식으로 보내므로 OpenAI 형식으로 변환합니다.
    // - 문자열 content → 그대로
    // - PDF 문서 블록 → OpenAI의 file 콘텐츠 파트로 변환
    const oaMessages = messages.map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content };
      }
      const parts = (m.content || []).map((b) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "document" && b.source && b.source.type === "base64") {
          return {
            type: "file",
            file: {
              filename: "document.pdf",
              file_data: "data:" + (b.source.media_type || "application/pdf") + ";base64," + b.source.data
            }
          };
        }
        if (b.type === "image" && b.source && b.source.type === "base64") {
          return {
            type: "image_url",
            image_url: { url: "data:" + b.source.media_type + ";base64," + b.source.data }
          };
        }
        return null;
      }).filter(Boolean);
      return { role: m.role, content: parts };
    });

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + key
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(max_tokens, 2000),
        messages: oaMessages
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const text =
      data.choices && data.choices[0] && data.choices[0].message
        ? String(data.choices[0].message.content || "")
        : "";

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "server_error", message: String(e && e.message ? e.message : e) });
  }
};
