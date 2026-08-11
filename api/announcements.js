// 지원사업 공고 수집 API — 중소벤처24 + K-Startup 통합판
// 환경변수:
//   BIZINFO_API_KEY   : 중소벤처24 인증키(token) — smes.go.kr 데이터 개방에서 발급받은 키
//   KSTARTUP_API_KEY  : 공공데이터포털 인증키 (K-Startup 조회서비스)
// ?fresh=1 을 붙이면 캐시를 무시하고 새로 수집합니다.

let cache = { at: 0, payload: null }; // 약 3시간 캐시

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
function ymd(s) {
  const t = String(s || "").replace(/[^0-9]/g, "");
  return t.length >= 8 ? t.slice(0, 4) + "." + t.slice(4, 6) + "." + t.slice(6, 8) : String(s || "");
}
function yyyymmdd(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
}
function findArray(json) {
  if (Array.isArray(json)) return json;
  for (const k of Object.keys(json)) {
    const v = json[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
    if (v && typeof v === "object") {
      for (const k2 of Object.keys(v)) {
        if (Array.isArray(v[k2]) && v[k2].length && typeof v[k2][0] === "object") return v[k2];
      }
    }
  }
  return null;
}
function pick(it, keys) {
  for (const k of keys) {
    if (it[k] !== undefined && it[k] !== null && String(it[k]).trim() !== "") return String(it[k]);
    const lk = Object.keys(it).find((x) => x.toLowerCase() === k.toLowerCase());
    if (lk && String(it[lk]).trim() !== "") return String(it[lk]);
  }
  return "";
}
function pickDateByPattern(it, pattern) {
  for (const k of Object.keys(it)) {
    if (!pattern.test(k)) continue;
    const v = String(it[k] || "").replace(/[^0-9]/g, "");
    if (v.length >= 8) return v.slice(0, 8);
  }
  return "";
}

/* ── 중소벤처24 공고정보 (portal.smes.go.kr/ione-gw/api/pblanc/list) ── */
async function fetchSmes(key) {
  const today = new Date();
  const past = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000); // 최근 60일 등록 공고
  const token = key.indexOf("%") >= 0 ? key : encodeURIComponent(key);
  const url = "https://portal.smes.go.kr/ione-gw/api/pblanc/list?token=" + token +
    "&strDt=" + yyyymmdd(past) + "&endDt=" + yyyymmdd(today) + "&html=no";
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const raw = await r.text();
  let json;
  try { json = JSON.parse(raw); }
  catch (e) { return { items: [], note: "응답이 JSON이 아님 · HTTP " + r.status + " · 응답 앞부분: " + raw.replace(/\s+/g, " ").slice(0, 150) }; }

  const list = findArray(json);
  if (!list) return { items: [], note: "중소벤처24 서버 응답: " + JSON.stringify(json).replace(/\s+/g, " ").slice(0, 200) };

  const fields = Object.keys(list[0] || {}).join(",").slice(0, 300);
  const items = list.map((it) => {
    const title = stripHtml(pick(it, ["pblancNm", "pblancSj", "bsnsNm", "sj", "title", "subject"]));
    if (!title) return null;
    const status = pick(it, ["sttus", "progrsSttus", "reqstSttus", "status"]);
    if (status && /마감|종료|완료/.test(status)) return null;
    const sDt = pickDateByPattern(it, /(str|bgn|begin|start).*(dt|de|dt)$/i) || pickDateByPattern(it, /^strDt$/i);
    const eDt = pickDateByPattern(it, /(end|fin|closs?).*(dt|de)$/i) || pickDateByPattern(it, /^endDt$/i);
    let link = pick(it, ["dtlUrl", "detailUrl", "url", "link", "pblancUrl", "hmpgUrl"]);
    if (link && link.startsWith("/")) link = "https://www.smes.go.kr" + link;
    return {
      key: "sm-" + (pick(it, ["pblancId", "pblancSn", "sn", "id", "seq"]) || link || title).slice(0, 110),
      title: title,
      field: stripHtml(pick(it, ["lclasNm", "pldirSportRealmLclasCodeNm", "bsnsSeNm", "cl", "category"])) || "중기부 지원사업",
      agency: stripHtml(pick(it, ["cntcInsttNm", "insttNm", "jrsdInsttNm", "excInsttNm", "sportInsttNm", "orgNm"])) || "중소벤처24",
      period: (sDt || eDt) ? (ymd(sDt) + " ~ " + ymd(eDt)) : stripHtml(pick(it, ["rcptPd", "reqstPd", "period"])),
      registered: ymd(pick(it, ["pblancDt", "regDt", "frstRegistDt", "registDt", "creatDt"]) || sDt),
      summary: stripHtml(pick(it, ["cn", "cntnts", "pblancCn", "bsnsSumryCn", "sumry", "content"])).slice(0, 300),
      url: link || "https://www.smes.go.kr/main/sportsBsnsPolicy",
      source: "중소벤처24"
    };
  }).filter(Boolean);

  return { items: items, note: items.length ? "" : ("응답은 정상이나 매핑된 공고 0건 · 항목 필드: " + fields), fields: fields };
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
    : findArray(json);
  if (!list) return [];
  return list.map((it) => {
    const title = it.biz_pbanc_nm || it.pbanc_nm || it.bizPbancNm || it.title || "";
    if (!title) return null;
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

  const smesKey = process.env.BIZINFO_API_KEY;
  const ksKey = process.env.KSTARTUP_API_KEY;
  if (!smesKey && !ksKey) return res.status(200).json({ source: "seed", reason: "no_key", items: [] });

  const fresh = req.url && req.url.indexOf("fresh=1") >= 0;
  if (!fresh && cache.payload && Date.now() - cache.at < 3 * 60 * 60 * 1000) {
    return res.status(200).json(cache.payload);
  }

  const results = await Promise.allSettled([
    smesKey ? fetchSmes(smesKey) : Promise.resolve({ items: [], note: "키 없음" }),
    ksKey ? fetchKstartup(ksKey) : Promise.resolve([])
  ]);
  const smRes = results[0].status === "fulfilled" ? results[0].value : { items: [], note: "호출 실패: " + String(results[0].reason).slice(0, 100) };
  const sm = smRes.items || [];
  const ks = results[1].status === "fulfilled" ? results[1].value : [];

  const seen = new Set(); const items = [];
  for (const it of [...ks, ...sm]) {
    const norm = it.title.replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, "").slice(0, 40);
    if (seen.has(norm)) continue;
    seen.add(norm); items.push(it);
  }

  if (!items.length) {
    return res.status(200).json({ source: "seed", reason: "all_failed", smes24_note: smRes.note || "", items: [] });
  }

  const payload = {
    source: (sm.length && ks.length) ? "smes24+kstartup" : (ks.length ? "kstartup" : "smes24"),
    count: items.length,
    smes24_count: sm.length,
    kstartup_count: ks.length,
    smes24_note: smRes.note || "",
    smes24_fields: smRes.fields || "",
    items
  };
  cache = { at: Date.now(), payload };
  return res.status(200).json(payload);
};
