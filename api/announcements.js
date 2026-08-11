// 기업마당(bizinfo.go.kr) 지원사업 공고 수집 API
// Vercel 환경변수 BIZINFO_API_KEY 필요 (설치가이드 5단계, 무료 발급)
// 키가 없거나 호출 실패 시 { items: [], source: "seed" } 를 반환하고,
// 프론트엔드가 내장 샘플 공고로 대체 표시합니다.

let cache = { at: 0, payload: null }; // 람다 인스턴스 내 캐시 (약 3시간)

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=10800, stale-while-revalidate=600");

  const key = process.env.BIZINFO_API_KEY;
  if (!key) {
    return res.status(200).json({ source: "seed", reason: "no_key", items: [] });
  }

  if (cache.payload && Date.now() - cache.at < 3 * 60 * 60 * 1000) {
    return res.status(200).json(cache.payload);
  }

  try {
    const url =
      "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=" +
      encodeURIComponent(key) +
      "&dataType=json&searchCnt=80";

    const r = await fetch(url, { headers: { accept: "application/json" } });
    const raw = await r.text();

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return res.status(200).json({ source: "seed", reason: "parse_fail", items: [] });
    }

    // 응답 구조가 문서와 다를 수 있어 방어적으로 배열을 탐색
    let list = null;
    if (Array.isArray(json)) list = json;
    else if (Array.isArray(json.jsonArray)) list = json.jsonArray;
    else if (json.body && Array.isArray(json.body.items)) list = json.body.items;
    else {
      for (const k of Object.keys(json)) {
        if (Array.isArray(json[k]) && json[k].length && typeof json[k][0] === "object") {
          list = json[k];
          break;
        }
      }
    }
    if (!list) return res.status(200).json({ source: "seed", reason: "no_array", items: [] });

    const items = list
      .map((it) => {
        const title = it.pblancNm || it.pblancnm || it.title || "";
        if (!title) return null;
        let link = it.pblancUrl || it.pblancurl || it.link || "";
        if (link && link.startsWith("/")) link = "https://www.bizinfo.go.kr" + link;
        return {
          key: String(it.pblancId || it.pblancid || link || title).slice(0, 120),
          title: stripHtml(title),
          field: stripHtml(it.pldirSportRealmLclasCodeNm || it.pldirsportrealmlclascodenm || it.field || "기타"),
          agency: stripHtml(it.jrsdInsttNm || it.jrsdinsttnm || it.excInsttNm || it.excinsttnm || "기업마당"),
          org: stripHtml(it.excInsttNm || it.excinsttnm || ""),
          period: stripHtml(it.reqstBeginEndDe || it.reqstbeginendde || it.reqstDe || ""),
          registered: stripHtml(it.creatPnttm || it.creatpnttm || ""),
          summary: stripHtml(it.bsnsSumryCn || it.bsnssumrycn || "").slice(0, 300),
          url: link,
          source: "기업마당"
        };
      })
      .filter(Boolean);

    const payload = { source: "bizinfo", count: items.length, items };
    cache = { at: Date.now(), payload };
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(200).json({ source: "seed", reason: "fetch_fail", items: [] });
  }
};
