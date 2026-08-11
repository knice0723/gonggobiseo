// Anthropic Claude API 프록시
// 브라우저에 API 키를 노출하지 않기 위해 서버에서 대신 호출합니다.
// Vercel 환경변수 ANTHROPIC_API_KEY 필요 (설치가이드 4단계)

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "no_key", message: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다. 설치가이드 4단계를 확인하세요." });
  }

  try {
    const { messages, max_tokens = 1000, system } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "bad_request" });
    }

    const body = { model: "claude-sonnet-4-6", max_tokens: Math.min(max_tokens, 2000), messages };
    if (system) body.system = system;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "server_error", message: String(e && e.message ? e.message : e) });
  }
};
