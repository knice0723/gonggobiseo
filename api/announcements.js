// 지원사업 공고 수집 API — 기업마당 + K-Startup 통합판
// 환경변수:
//   BIZINFO_API_KEY   : 기업마당 인증키 (기존)
//   KSTARTUP_API_KEY  : 공공데이터포털 인증키 (Decoding 버전 붙여넣기)
// 키가 하나만 있으면 그 소스만, 둘 다 없으면 { source:"seed" } 반환 → 프론트가 예시 공고 표시

let cache = { at: 0, payload: null }; // 약 3시간 캐시

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function ymd(s) { // "20260820" → "2026.08.20"
  const t = String(s || "").replace(/[^0-9]/g, "");
  return t.length >= 8 ? t.slice(0, 4) + "." + t.slice(4, 6) + "." + t.slice(6, 8) : String(s || "");
}

/* ── 기업마당 ── */
async function fetchBizinfo(key) {
  const url = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=" +
    encodeURIComponent(key) + "&dataType=json&searchCnt=80";
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const raw = await r.text();
  let json; try { json = JSON.parse(raw); } catch (e) { return []; }
  let list = null;
  if (Array.isArray(json)) list = json;
  else if (Array.isArray(json.jsonArray)) list = json.jsonArray;
  else if (json.body && Array.isArray(json.body.items)) list = json.body.items;
  else for (const k of Object.keys(json)) {
    if (Array.isArray(json[k]) && json[k].length && typeof json[k][0] === "object") { list = json[k]; break; }
  }
  if (!list) return [];
  return list.map((it) => {
    const title = it.pblancNm || it.pblancnm || it.title || "";
    if (!title) return null;
    let link = it.pblancUrl || it.pblancurl || it.link || "";
    if (link && link.startsWith("/")) link = "https://www.bizinfo.go.kr" + link;
    return {
      key: "bz-" + String(it.pblancId || it.pblancid || link || title).slice(0, 110),
      title: stripHtml(title),
      field: stripHtml(it.pldirSportRealmLclasCodeNm || it.pldirsportrealmlclascodenm || "기타"),
      agency: stripHtml(it.jrsdInsttNm || it.jrsdinsttnm || it.excInsttNm || it.excinsttnm || "기업마당"),
      period: stripHtml(it.reqstBeginEndDe || it.reqstbeginendde || ""),
      registered: stripHtml(it.creatPnttm || it.creatpnttm || ""),
      summary: stripHtml(it.bsnsSumryCn || it.bsnssumrycn || "").slice(0, 300),
      url: link, source: "기업마당"
    };
  }).filter(Boolean);
}

/* ── K-Startup (공공데이터포털 15125364) ── */
async function fetchKstartup(key) {
  const url = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01" +
    "?serviceKey=" + (key.indexOf("%") >= 0 ? key : encodeURIComponent(key)) + "&page=1&perPage=100&returnType=json";
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const raw = await r.text();
  let json; try { json = JSON.parse(raw); } catch (e) { return []; }
  let list = Array.isArray(json.data) ? json.data
    : (json.response && json.response.body && Array.isArray(json.response.body.items)) ? json.response.body.items
    : null;
  if (!list) {
    for (const k of Object.keys(json)) {
      if (Array.isArray(json[k]) && json[k].length && typeof json[k][0] === "object") { list = json[k]; break; }
    }
  }
  if (!list) return [];
  return list.map((it) => {
    const title = it.biz_pbanc_nm || it.pbanc_nm || it.bizPbancNm || it.title || "";
    if (!title) return null;
    // 모집 진행 여부 필드가 있으면 진행 중(Y)만 사용
    const prog = it.rcrt_prgs_yn || it.rcrtPrgsYn;
    if (prog !== undefined && String(prog).toUpperCase() === "N") return null;
    const bgng = it.pbanc_rcpt_bgng_dt || it.pbancRcptBgngDt || "";
    const end = it.pbanc_rcpt_end_dt || it.pbancRcptEndDt || "";
    const region = stripHtml(it.supt_regin || it.suptRegin || "");
    let t = stripHtml(title);
    if (region && region !== "전국" && !/^\[/.test(t)) t = "[" + region + "] " + t;
    return {
      key: "ks-" + String(it.pbanc_sn || it.pbancSn || it.id || title).slice(0, 110),
      title: t,
      field: stripHtml(it.supt_biz_clsfc || it.suptBizClsfc || "창업"),
      agency: stripHtml(it.pbanc_ntrp_nm || it.pbancNtrpNm || "창업진흥원"),
      period: (bgng || end) ? (ymd(bgng) + " ~ " + ymd(end)) : "",
      registered: ymd(it.reg_dt || it.regDt || bgng || ""),
      summary: stripHtml(it.pbanc_ctnt || it.pbancCtnt || it.aply_trgt_ctnt || "").slice(0, 300),
      url: it.detl_pg_url || it.detlPgUrl || "https://www.k-startup.go.kr",
      source: "K-Startup"
    };
  }).filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=10800, stale-while-revalidate=600");

  const bizKey = process.env.BIZINFO_API_KEY;
  const ksKey = process.env.KSTARTUP_API_KEY;
  if (!bizKey && !ksKey) return res.status(200).json({ source: "seed", reason: "no_key", items: [] });

  if (cache.payload && Date.now() - cache.at < 3 * 60 * 60 * 1000) {
    return res.status(200).json(cache.payload);
  }

  const results = await Promise.allSettled([
    bizKey ? fetchBizinfo(bizKey) : Promise.resolve([]),
    ksKey ? fetchKstartup(ksKey) : Promise.resolve([])
  ]);
  const biz = results[0].status === "fulfilled" ? results[0].value : [];
  const ks = results[1].status === "fulfilled" ? results[1].value : [];

  // 제목 기준 중복 제거 (두 사이트에 같은 공고가 올라오는 경우)
  const seen = new Set(); const items = [];
  for (const it of [...ks, ...biz]) {
    const norm = it.title.replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, "").slice(0, 40);
    if (seen.has(norm)) continue;
    seen.add(norm); items.push(it);
  }

  if (!items.length) return res.status(200).json({ source: "seed", reason: "all_failed", items: [] });

  const payload = { source: (biz.length && ks.length) ? "bizinfo+kstartup" : (ks.length ? "kstartup" : "bizinfo"), count: items.length, items };
  cache = { at: Date.now(), payload };
  return res.status(200).json(payload);
};
