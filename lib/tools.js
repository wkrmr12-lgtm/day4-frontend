"use strict";
// 에이전트가 호출하는 두 개의 도구: get_weather(실시간 날씨·미세먼지), find_spots(장소 검색)
// 모두 API 키가 필요 없는 공개 API만 사용합니다 (Open-Meteo, OpenStreetMap Overpass/Nominatim).

const UA = "day4-frontend/1.0 (korea weather & spots agent)";

async function fetchJson(url, opt = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: ctrl.signal, headers: { "User-Agent": UA, ...(opt.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status} (${new URL(url).host})`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// ───────── 한글 → 로마자 (Open-Meteo 지오코딩은 영문 검색이 정확함) ─────────
const R_INIT = ["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];
const R_MID = ["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","wo","we","wi","yu","eu","ui","i"];
const R_FIN = ["","k","k","k","n","n","n","t","l","k","m","l","l","l","p","l","m","p","p","t","t","ng","t","t","k","t","p","t"];
const hasHangul = s => /[가-힣]/.test(s);
function romanize(s) {
  return [...s].map(ch => {
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) return ch;
    return R_INIT[Math.floor(c / 588)] + R_MID[Math.floor((c % 588) / 28)] + R_FIN[c % 28];
  }).join("");
}
const stripSuffix = s => s.length > 2 ? s.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구|도)$/, "") : s;
const inKorea = (lat, lon) => lat >= 32.9 && lat <= 38.62 && lon >= 124.5 && lon <= 131.95;

// ───────── 지역명 → 좌표 ─────────
async function omGeocode(name) {
  const d = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=ko&countryCode=KR`);
  return (d.results || [])
    .filter(r => r.country_code === "KR" && /^PPL/.test(r.feature_code || "PPL"))
    .map(r => ({
      name: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : ""].filter(Boolean).join(", "),
      latitude: r.latitude, longitude: r.longitude,
      pop: r.population || 0, major: /^PPL(C|A\d?)$/.test(r.feature_code || "")
    }));
}
async function nominatimSearch(q) {
  const d = await fetchJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=kr&limit=3&accept-language=ko`);
  return d.map(r => ({ name: r.name || String(r.display_name).split(",")[0], latitude: +r.lat, longitude: +r.lon }));
}
async function resolveLocation(q) {
  q = String(q || "").trim();
  if (!q) throw new Error("location 값이 비어 있습니다");
  if (/평양|함흥|신의주|북한|pyongyang|north\s*korea/i.test(q)) throw new Error("북한 지역은 지원하지 않습니다 (대한민국 지역만 조회 가능)");
  const names = [q];
  if (hasHangul(q)) names.push(romanize(stripSuffix(q)));
  const om = (await Promise.all(names.map(n => omGeocode(n).catch(() => [])))).flat()
    .sort((a, b) => (b.major - a.major) || (b.pop - a.pop));
  let pick = om.find(r => r.major || r.pop > 0);
  if (!pick) {   // 역·랜드마크·소규모 지명은 Nominatim으로
    const nom = await nominatimSearch(q).catch(() => []);
    pick = nom.find(r => inKorea(r.latitude, r.longitude)) || om[0];
  }
  if (!pick || !inKorea(pick.latitude, pick.longitude)) throw new Error(`'${q}' 에 해당하는 한국 지역을 찾지 못했습니다`);
  return { name: pick.name, latitude: +pick.latitude.toFixed(4), longitude: +pick.longitude.toFixed(4) };
}

// ───────── 도구 1: get_weather ─────────
const WMO_KO = {0:"맑음",1:"대체로 맑음",2:"구름 조금",3:"흐림",45:"안개",48:"서리 안개",51:"약한 이슬비",53:"이슬비",55:"강한 이슬비",56:"어는 이슬비",57:"강한 어는 이슬비",
  61:"약한 비",63:"비",65:"강한 비",66:"어는 비",67:"강한 어는 비",71:"약한 눈",73:"눈",75:"강한 눈",77:"싸락눈",80:"약한 소나기",81:"소나기",82:"강한 소나기",
  85:"눈 소나기",86:"강한 눈 소나기",95:"뇌우",96:"우박 동반 뇌우",99:"강한 우박 뇌우"};
const grade = (v, cut) => v == null ? null : ["좋음", "보통", "나쁨", "매우나쁨"][v <= cut[0] ? 0 : v <= cut[1] ? 1 : v <= cut[2] ? 2 : 3];

async function getWeather({ location, days = 3 }) {
  const loc = await resolveLocation(location);
  days = Math.min(7, Math.max(1, Math.round(Number(days) || 3)));
  const w = new URLSearchParams({
    latitude: loc.latitude, longitude: loc.longitude, timezone: "Asia/Seoul", forecast_days: days,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
  });
  const a = new URLSearchParams({ latitude: loc.latitude, longitude: loc.longitude, timezone: "Asia/Seoul", current: "pm10,pm2_5" });
  const [wd, ad] = await Promise.all([
    fetchJson("https://api.open-meteo.com/v1/forecast?" + w),
    fetchJson("https://air-quality-api.open-meteo.com/v1/air-quality?" + a).catch(() => null)
  ]);
  const c = wd.current, d = wd.daily, ac = ad && ad.current;
  return {
    location: loc.name, latitude: loc.latitude, longitude: loc.longitude, observed_at_kst: c.time,
    current: {
      condition: WMO_KO[c.weather_code] || "알 수 없음", temperature_c: c.temperature_2m, feels_like_c: c.apparent_temperature,
      humidity_pct: c.relative_humidity_2m, wind_kmh: c.wind_speed_10m, precipitation_mm: c.precipitation
    },
    air_quality: ac ? {
      pm2_5_ugm3: ac.pm2_5, pm2_5_grade: grade(ac.pm2_5, [15, 35, 75]),
      pm10_ugm3: ac.pm10, pm10_grade: grade(ac.pm10, [30, 80, 150]),
      note: "모델 예측값(CAMS)이라 측정소 실측과 다를 수 있음, 등급은 한국 환경부 기준"
    } : null,
    forecast: d.time.map((t, i) => ({
      date: t, condition: WMO_KO[d.weather_code[i]] || "알 수 없음",
      temp_min_c: d.temperature_2m_min[i], temp_max_c: d.temperature_2m_max[i], precip_probability_pct: d.precipitation_probability_max[i]
    }))
  };
}

// ───────── 도구 2: find_spots ─────────
const CATEGORIES = {
  cafe:               { overpass: [["amenity", "cafe"]], nominatim: "cafe", label: "카페" },
  restaurant:         { overpass: [["amenity", "restaurant"]], nominatim: "restaurant", label: "음식점" },
  tourist_attraction: { overpass: [["tourism", "attraction"], ["tourism", "theme_park"], ["tourism", "zoo"], ["tourism", "aquarium"]], nominatim: "attraction", label: "관광명소" },
  park:               { overpass: [["leisure", "park"], ["leisure", "garden"], ["leisure", "nature_reserve"]], nominatim: "park", label: "공원·자연" },
  museum:             { overpass: [["tourism", "museum"], ["tourism", "gallery"]], nominatim: "museum", label: "박물관·미술관 (실내)" },
  shopping:           { overpass: [["shop", "mall"], ["shop", "department_store"]], nominatim: "mall", label: "쇼핑 (실내)" },
  beach:              { overpass: [["natural", "beach"]], nominatim: "beach", label: "해변" },
  viewpoint:          { overpass: [["tourism", "viewpoint"], ["natural", "peak"]], nominatim: "viewpoint", label: "전망·산" }
};
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

function overpassQuery(filters, lat, lon, radiusM) {
  const parts = filters.map(([k, v]) => `nwr["${k}"="${v}"]["name"](around:${radiusM},${lat},${lon});`).join("");
  return `[out:json][timeout:20];(${parts});out center tags 100;`;
}
function distKm(a, b, c, d) {
  const R = 6371, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function overpassSearch(filters, lat, lon, radiusM) {
  const body = "data=" + encodeURIComponent(overpassQuery(filters, lat, lon, radiusM));
  const one = ep => fetchJson(ep, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }, 8000);
  const d = await Promise.any(OVERPASS.slice(0, 2).map(one));      // 동시 요청 → 가장 빠른 성공 응답
  return d.elements.map(e => {
    const t = e.tags || {}, la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
    return la == null ? null : { tags: t, latitude: la, longitude: lo };
  }).filter(Boolean);
}
async function nominatimSpots(word, lat, lon, radiusKm, limit) {
  const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  const vb = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].join(",");
  const d = await fetchJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(word)}&format=jsonv2&limit=${Math.min(40, limit * 3)}&accept-language=ko&viewbox=${vb}&bounded=1&extratags=1&addressdetails=1`);
  return d.map(r => ({ tags: { name: r.name, ...(r.extratags || {}), "addr:full": r.display_name }, latitude: +r.lat, longitude: +r.lon }));
}
function toSpot(e, lat, lon, label) {
  const t = e.tags, dist = distKm(lat, lon, e.latitude, e.longitude);
  const score = (t.wikidata || t.wikipedia ? 3 : 0) + (t.website || t["contact:website"] ? 1 : 0) + (t.opening_hours ? 1 : 0)
    + (t["name:ko"] ? .5 : 0) + (t.tourism === "attraction" ? .5 : 0) - dist * .3;
  const addr = t["addr:full"] || [t["addr:city"], t["addr:district"], t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  const spot = { name: t["name:ko"] || t.name, category: label, latitude: +e.latitude.toFixed(5), longitude: +e.longitude.toFixed(5), distance_km: +dist.toFixed(2) };
  if (addr) spot.address = addr;
  if (t.opening_hours) spot.opening_hours = t.opening_hours;
  if (t.cuisine) spot.cuisine = t.cuisine;
  if (t.website || t["contact:website"]) spot.website = t.website || t["contact:website"];
  return { spot, score };
}

async function findSpots({ location, category = "tourist_attraction", limit = 6, radius_km = 3 }) {
  const cat = CATEGORIES[category];
  if (!cat) throw new Error(`category는 다음 중 하나여야 합니다: ${Object.keys(CATEGORIES).join(", ")}`);
  const loc = await resolveLocation(location);
  limit = Math.min(10, Math.max(1, Math.round(Number(limit) || 6)));
  let radiusKm = Math.min(15, Math.max(0.5, Number(radius_km) || 3));
  let source = "OpenStreetMap (Overpass)", raw = [], overpassDown = false;
  for (let attempt = 0; attempt < 2; attempt++) {                    // 결과가 적으면 반경을 넓혀 한 번 더
    if (!overpassDown) {
      try { raw = await overpassSearch(cat.overpass, loc.latitude, loc.longitude, radiusKm * 1000); }
      catch (e) { overpassDown = true; }
    }
    if (overpassDown) { source = "OpenStreetMap (Nominatim)"; raw = await nominatimSpots(cat.nominatim, loc.latitude, loc.longitude, radiusKm, limit).catch(() => []); }
    if (raw.length >= 3 || radiusKm >= 10) break;
    radiusKm = Math.min(15, radiusKm * 2.5);
  }
  const seen = new Set();
  const spots = raw.map(e => toSpot(e, loc.latitude, loc.longitude, cat.label))
    .filter(x => x.spot.name && x.spot.distance_km <= radiusKm + 0.05 && !seen.has(x.spot.name) && seen.add(x.spot.name))
    .sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.spot);
  return {
    location: loc.name, center: { latitude: loc.latitude, longitude: loc.longitude }, category: cat.label, radius_km: +radiusKm.toFixed(1),
    count: spots.length, source, spots,
    note: spots.length ? "OpenStreetMap 데이터라 평점·리뷰·혼잡도 정보는 없음" : "결과 없음: radius_km를 늘리거나 다른 category로 다시 검색해 보세요"
  };
}

// ───────── Gemini 함수 선언 ─────────
const DECLARATIONS = [
  {
    name: "get_weather",
    description: "한국 지역의 실시간 날씨(기온·체감·습도·바람·강수), 미세먼지(PM2.5/PM10과 등급), 며칠 예보를 조회합니다. 야외/실내 판단이나 날씨가 궁금할 때 호출하세요.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "한국의 시·군·구, 역, 관광지 이름. 예: 부산, 강릉, 해운대, 강남역" },
        days: { type: "integer", description: "예보 일수 1~7 (기본 3)" }
      },
      required: ["location"]
    }
  },
  {
    name: "find_spots",
    description: "한국 지역 주변의 장소(카페, 음식점, 관광명소, 공원, 박물관 등)를 검색합니다. 장소 추천 요청이면 호출하세요. 평점·리뷰 정보는 없습니다.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "검색 중심이 될 한국 지역 이름. 예: 전주, 해운대, 성수동" },
        category: { type: "string", enum: Object.keys(CATEGORIES), description: "장소 종류. 비가 오거나 미세먼지가 나쁘면 museum, shopping, cafe 같은 실내를 고려" },
        limit: { type: "integer", description: "결과 개수 1~10 (기본 6)" },
        radius_km: { type: "number", description: "검색 반경(km) 0.5~15 (기본 3)" }
      },
      required: ["location", "category"]
    }
  }
];
const IMPL = { get_weather: getWeather, find_spots: findSpots };
async function runTool(name, args) {
  const fn = IMPL[name];
  if (!fn) throw new Error("알 수 없는 도구: " + name);
  return fn(args || {});
}

module.exports = { DECLARATIONS, runTool, resolveLocation, CATEGORIES, _t: { romanize, stripSuffix, overpassQuery, grade } };
