// 지원사업 공고 수집 API — K-Startup + 중소벤처24 + 기업마당 통합판
// 환경변수:
//   KSTARTUP_API_KEY  : 공공데이터포털 인증키 (K-Startup 조회서비스)
//   BIZINFO_API_KEY   : 중소벤처24 인증키(token) — smes.go.kr 데이터 개방에서 발급
//   BIZINFO_GOKR_KEY  : 기업마당(bizinfo.go.kr) 지원사업정보 API 인증키 — 발급 시 자동 연동
//   MSIT_API_KEY      : 과기부 R&D 사업공고(1721000/msitannouncementinfo) 인증키
//                       (공공데이터포털 일반 인증키 — K-Startup 키와 값이 같아도 별도 등록해야 동작)
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
  try {
    const it = json.response && json.response.body && json.response.body.items;
    if (it) {
      if (Array.isArray(it)) return it;
      if (Array.isArray(it.item)) return it.item;
      if (it.item && typeof it.item === "object") return [it.item];
    }
  } catch (e) {}
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
function cleanVal(v) {
  const s = String(v == null ? "" : v).trim();
  return (s === "" || /^(null|undefined|none|-)$/i.test(s)) ? "" : s;
}
function pick(it, keys) {
  for (const k of keys) {
    let v = cleanVal(it[k]);
    if (v) return v;
    const lk = Object.keys(it).find((x) => x.toLowerCase() === k.toLowerCase());
    if (lk) { v = cleanVal(it[lk]); if (v) return v; }
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

/* ── 기업마당 지원사업정보 (bizinfo.go.kr/uss/rss/bizinfoApi.do) ── */
async function fetchBizinfoGokr(key) {
  const url = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=" +
    (key.indexOf("%") >= 0 ? key : encodeURIComponent(key)) + "&dataType=json&searchCnt=150";
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const raw = await r.text();
  let json;
  try { json = JSON.parse(raw); }
  catch (e) { return { items: [], note: "응답이 JSON이 아님 · HTTP " + r.status + " · " + raw.replace(/\s+/g, " ").slice(0, 120) }; }
  const list = findArray(json);
  if (!list) return { items: [], note: "기업마당 서버 응답: " + JSON.stringify(json).replace(/\s+/g, " ").slice(0, 200) };
  const items = list.map((it) => {
    const title = stripHtml(pick(it, ["pblancNm", "pblancnm", "title"]));
    if (!title) return null;
    let link = pick(it, ["pblancUrl", "pblancurl", "link"]);
    if (link && link.startsWith("/")) link = "https://www.bizinfo.go.kr" + link;
    const period = stripHtml(pick(it, ["reqstBeginEndDe", "reqstbeginendde"]));
    const eNums = String(period).replace(/[^0-9]/g, "");
    if (eNums.length >= 16 && eNums.slice(8, 16) < yyyymmdd(new Date())) return null; // 마감 지난 공고 제외
    return {
      key: "bz-" + (pick(it, ["pblancId", "pblancid"]) || link || title).slice(0, 110),
      title: title,
      field: stripHtml(pick(it, ["pldirSportRealmLclasCodeNm", "pldirsportrealmlclascodenm"])) || "기타",
      agency: stripHtml(pick(it, ["jrsdInsttNm", "jrsdinsttnm", "excInsttNm", "excinsttnm"])) || "기업마당",
      period: period,
      registered: stripHtml(pick(it, ["creatPnttm", "creatpnttm"])).slice(0, 10).replace(/-/g, "."),
      summary: stripHtml(pick(it, ["bsnsSumryCn", "bsnssumrycn"])).slice(0, 300),
      url: link || "https://www.bizinfo.go.kr",
      source: "기업마당"
    };
  }).filter(Boolean);
  return { items: items, note: items.length ? "" : "응답은 정상이나 공고 0건" };
}

/* ── 과기부 R&D 사업공고 (apis.data.go.kr/1721000/msitannouncementinfo) ── */
async function fetchMsit(key) {
  // 공식 가이드의 기본 응답(XML)을 직접 파싱 — 문서 샘플과 1:1 구조
  const base = "https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList";
  const token = key.indexOf("%") >= 0 ? key : encodeURIComponent(key);
  const tag = (block, name) => {
    const m = block.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">"));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
  };
  const callPage = async (p) => {
    const r = await fetch(base + "?serviceKey=" + token + "&numOfRows=10&pageNo=" + p, { headers: { accept: "application/xml" } });
    const raw = await r.text();
    if (raw.indexOf("<") < 0) return { err: "XML 아님(HTTP " + r.status + "): " + raw.slice(0, 100) };
    if (/NO_OPENAPI|SERVICE_KEY_IS|SERVICE ERROR/i.test(raw)) return { err: raw.replace(/\s+/g, " ").slice(0, 150) };
    const code = tag(raw, "resultCode");
    if (code && code !== "00") return { err: "서버 코드 " + code + ": " + tag(raw, "resultMsg") };
    const blocks = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(raw)) !== null) blocks.push(m[1]);
    return { blocks: blocks, total: parseInt(tag(raw, "totalCount"), 10) || 0 };
  };
  const first = await callPage(1);
  if (first.err) return { items: [], note: first.err };
  let blocks = (first.blocks || []).slice();
  const total = first.total || 0;
  const lastPage = Math.max(1, Math.ceil(total / 10));
  // 실측 결과 최신순 정렬 확인 → 앞쪽 페이지(2~6) 위주로 수집, 뒤쪽 1페이지는 역정렬 대비 보험
  const pages = [];
  for (let p = 2; p <= Math.min(6, lastPage); p++) pages.push(p);
  if (lastPage > 6) pages.push(lastPage);
  let note = "";
  const results = await Promise.allSettled(pages.map(callPage));
  for (const rr of results) {
    if (rr.status === "fulfilled" && rr.value.blocks) blocks = blocks.concat(rr.value.blocks);
    else if (rr.status === "fulfilled" && rr.value.err) note = rr.value.err;
  }
  const cutoff = yyyymmdd(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
  let maxPress = "";
  const seenMs = new Set();
  const items = blocks.map((b) => {
    const title = stripHtml(tag(b, "subject"));
    if (!title) return null;
    const press = tag(b, "pressDt").replace(/[^0-9]/g, "").slice(0, 8);
    if (press > maxPress) maxPress = press;
    if (press && press < cutoff) return null;
    const url = tag(b, "viewUrl").replace(/&amp;/g, "&") || "https://www.msit.go.kr";
    const k = "ms-" + String(url || title).slice(-80);
    if (seenMs.has(k)) return null;
    seenMs.add(k);
    const dept = stripHtml(tag(b, "deptName"));
    const contact = [dept, stripHtml(tag(b, "managerName")), stripHtml(tag(b, "managerTel"))].filter(Boolean).join(" · ");
    return {
      key: k, title: title, field: "기술·R&D",
      agency: "과학기술정보통신부" + (dept ? " " + dept : ""),
      period: "", registered: ymd(press),
      summary: (contact ? "담당: " + contact + " — " : "") + "접수기간·자격요건은 원문 공고를 확인하세요.",
      url: url, source: "과기부 R&D"
    };
  }).filter(Boolean).sort((a, b) => String(b.registered).localeCompare(String(a.registered))).slice(0, 60);
  return {
    items: items,
    note: items.length ? "" : ("XML " + blocks.length + "건 파싱 · 최신 게시일 " + (maxPress ? ymd(maxPress) : "없음") + " · total " + total + " · 샘플: " + String(blocks[0] || "").replace(/\s+/g, " ").slice(0, 150) + (note ? " · " + note : "")),
    fields: "subject,viewUrl,deptName,managerName,managerTel,pressDt (XML)",
    path: "/businessAnnouncMentList xml p1+last5"
  };
}

/* ── 중소벤처24 공고정보 (portal.smes.go.kr/ione-gw/api/pblanc/list) ── */
async function fetchSmes(key) {
  const today = new Date();
  const token = key.indexOf("%") >= 0 ? key : encodeURIComponent(key);
  const windows = [30, 7]; // 1차 30일, 실패 시 7일(가벼운 요청)로 재시도
  let json = null, lastNote = "";
  for (let attempt = 0; attempt < windows.length; attempt++) {
    const past = new Date(today.getTime() - windows[attempt] * 24 * 60 * 60 * 1000);
    const url = "https://portal.smes.go.kr/ione-gw/api/pblanc/list?token=" + token +
      "&strDt=" + yyyymmdd(past) + "&endDt=" + yyyymmdd(today) + "&html=no";
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      const raw = await r.text();
      try { json = JSON.parse(raw); break; }
      catch (e) { lastNote = "응답이 JSON이 아님 · HTTP " + r.status + " · " + raw.replace(/\s+/g, " ").slice(0, 150); }
    } catch (e) { lastNote = "호출 실패: " + String(e && e.message ? e.message : e).slice(0, 100); }
  }
  if (!json) return { items: [], note: lastNote + " (30일→7일 2회 시도, 그쪽 서버 응답 없음)" };

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
    if (eDt && eDt < yyyymmdd(new Date())) return null; // 접수 마감 지난 공고 제외
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
  res.setHeader("Cache-Control", "s-maxage=1200, stale-while-revalidate=300");

  const smesKey = process.env.BIZINFO_API_KEY;
  const ksKey = process.env.KSTARTUP_API_KEY;
  const bizKey = process.env.BIZINFO_GOKR_KEY;
  const msitKey = process.env.MSIT_API_KEY; // 과기부 전용 환경변수 (등록된 경우에만 수집)
  if (!smesKey && !ksKey && !bizKey) return res.status(200).json({ source: "seed", reason: "no_key", items: [] });

  const fresh = req.url && req.url.indexOf("fresh=1") >= 0;
  const lmm = req.url && req.url.match(/limit=(\d+)/);
  const lim = lmm ? Math.max(10, Math.min(800, parseInt(lmm[1], 10))) : 0;
  if (!fresh && cache.payload && Date.now() - cache.at < 3 * 60 * 60 * 1000) {
    const p = cache.payload;
    return res.status(200).json(lim ? Object.assign({}, p, { items: p.items.slice(0, lim), limited: lim }) : p);
  }

  const results = await Promise.allSettled([
    smesKey ? fetchSmes(smesKey) : Promise.resolve({ items: [], note: "키 없음" }),
    ksKey ? fetchKstartup(ksKey) : Promise.resolve([]),
    bizKey ? fetchBizinfoGokr(bizKey) : Promise.resolve({ items: [], note: "키 없음" }),
    msitKey ? fetchMsit(msitKey) : Promise.resolve({ items: [], note: "키 없음" })
  ]);
  const smRes = results[0].status === "fulfilled" ? results[0].value : { items: [], note: "호출 실패: " + String(results[0].reason).slice(0, 100) };
  const sm = smRes.items || [];
  const ks = results[1].status === "fulfilled" ? results[1].value : [];
  const bzRes = results[2].status === "fulfilled" ? results[2].value : { items: [], note: "호출 실패: " + String(results[2].reason).slice(0, 100) };
  const bz = bzRes.items || [];
  const msRes = results[3].status === "fulfilled" ? results[3].value : { items: [], note: "호출 실패: " + String(results[3].reason).slice(0, 100) };
  const ms = msRes.items || [];

  const map = new Map();
  for (const it of [...ks, ...sm, ...bz, ...ms]) {
    const norm = it.title.replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, "").slice(0, 40);
    if (map.has(norm)) { map.get(norm).dual = true; continue; }
    map.set(norm, it);
  }
  let items = [...map.values()];
  items.sort((a, b) => String(b.registered).localeCompare(String(a.registered)));
  if (items.length > 800) items = items.slice(0, 800);

  if (!items.length) {
    return res.status(200).json({ source: "seed", reason: "all_failed", smes24_note: smRes.note || "", bizinfo_note: bzRes.note || "", items: [] });
  }

  const parts = [];
  if (ks.length) parts.push("kstartup");
  if (sm.length) parts.push("smes24");
  if (bz.length) parts.push("bizinfo");
  if (ms.length) parts.push("msit");
  const payload = {
    source: parts.join("+") || "seed",
    count: items.length,
    kstartup_count: ks.length,
    smes24_count: sm.length,
    bizinfo_count: bz.length,
    msit_count: ms.length,
    smes24_note: smRes.note || "",
    bizinfo_note: bzRes.note || "",
    msit_note: msRes.note || "",
    msit_fields: msRes.fields || "",
    msit_path: msRes.path || "",
    items
  };
  cache = { at: Date.now(), payload };
  return res.status(200).json(lim ? Object.assign({}, payload, { items: payload.items.slice(0, lim), limited: lim }) : payload);
};
