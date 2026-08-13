// 공고 원문 페이지 텍스트 프록시 — AI 정밀 분석용
// 허용된 정부 도메인만 접근 가능
const ALLOW = ["bizinfo.go.kr", "smes.go.kr", "k-startup.go.kr", "msit.go.kr", "mss.go.kr", "data.go.kr"];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
  try {
    const m = (req.url || "").match(/[?&]url=([^&]+)/);
    if (!m) return res.status(400).json({ ok: false, error: "url 파라미터 필요" });
    const target = decodeURIComponent(m[1]);
    let host = "";
    try { host = new URL(target).hostname; } catch (e) { return res.status(400).json({ ok: false, error: "잘못된 URL" }); }
    if (!ALLOW.some((d) => host === d || host.endsWith("." + d))) {
      return res.status(403).json({ ok: false, error: "허용되지 않은 도메인: " + host });
    }
    const r = await fetch(target, { headers: { "user-agent": "Mozilla/5.0 (compatible; GonggobiseoBot/1.0)", "accept": "text/html,*/*" }, redirect: "follow" });
    const raw = await r.text();
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ").trim();
    if (!text || text.length < 200) return res.status(200).json({ ok: false, error: "본문 추출 실패(동적 페이지)" });
    return res.status(200).json({ ok: true, length: text.length, text: text.slice(0, 15000) });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 120) });
  }
};
