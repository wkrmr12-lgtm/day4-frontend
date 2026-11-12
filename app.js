// ───────── WMO 날씨 코드 ─────────
const WMO = {
  0:["☀️","🌙","맑음"],1:["🌤️","🌙","대체로 맑음"],2:["⛅","☁️","구름 조금"],3:["☁️","☁️","흐림"],
  45:["🌫️","🌫️","안개"],48:["🌫️","🌫️","서리 안개"],
  51:["🌦️","🌧️","약한 이슬비"],53:["🌦️","🌧️","이슬비"],55:["🌧️","🌧️","강한 이슬비"],
  56:["🌧️","🌧️","어는 이슬비"],57:["🌧️","🌧️","강한 어는 이슬비"],
  61:["🌧️","🌧️","약한 비"],63:["🌧️","🌧️","비"],65:["🌧️","🌧️","강한 비"],
  66:["🌧️","🌧️","어는 비"],67:["🌧️","🌧️","강한 어는 비"],
  71:["🌨️","🌨️","약한 눈"],73:["🌨️","🌨️","눈"],75:["❄️","❄️","강한 눈"],77:["🌨️","🌨️","싸락눈"],
  80:["🌦️","🌧️","약한 소나기"],81:["🌧️","🌧️","소나기"],82:["⛈️","⛈️","강한 소나기"],
  85:["🌨️","🌨️","눈 소나기"],86:["❄️","❄️","강한 눈 소나기"],
  95:["⛈️","⛈️","뇌우"],96:["⛈️","⛈️","우박 동반 뇌우"],99:["⛈️","⛈️","강한 우박 뇌우"]
};
const RAIN = [51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99], SNOW = [71,73,75,77,85,86];
const info = (code, isDay=1) => { const w = WMO[code] || ["❔","❔","알 수 없음"]; return { icon: isDay ? w[0] : w[1], text: w[2] }; };
const $ = id => document.getElementById(id);
const DEFAULT = { name: "서울특별시", latitude: 37.5665, longitude: 126.978 };

// 일시적 네트워크 오류 대비: 1회 재시도
async function fetchRetry(url, opt){
  try{ const r = await fetch(url, opt); if(r.ok) return r; throw new Error("HTTP "+r.status); }
  catch(e){ if(opt?.signal?.aborted) throw e; await new Promise(r=>setTimeout(r,600)); return fetch(url, opt); }
}
function setStatus(msg, isError=false){ const s=$("status"); s.textContent=msg; s.className="status"+(isError?" error":""); s.hidden=!msg; }

// ───────── 한글 → 로마자 (국어의 로마자 표기법, 단순 변환) ─────────
const R_INIT=["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];
const R_MID=["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","wo","we","wi","yu","eu","ui","i"];
const R_FIN=["","k","k","k","n","n","n","t","l","k","m","l","l","l","p","l","m","p","p","t","t","ng","t","t","k","t","p","t"];
const hasHangul = s => /[가-힣]/.test(s);
function romanize(s){
  return [...s].map(ch=>{
    const c = ch.charCodeAt(0) - 0xAC00;
    if(c < 0 || c > 11171) return ch;
    return R_INIT[Math.floor(c/588)] + R_MID[Math.floor((c%588)/28)] + R_FIN[c%28];
  }).join("");
}
// "수원시"→"수원", "강남구"→"강남" (행정 접미사 제거 후 검색해야 잘 맞음)
const stripSuffix = s => s.length > 2 ? s.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구|도)$/, "") : s;

// ───────── 내장 목록 검색 (1글자부터 즉시) ─────────
const LOCAL = [
  ...PROVINCES.map(([n,la,lo,en])=>({name:n, sub:"", latitude:la, longitude:lo, en, rank:0})),
  ...CITIES.map(([n,la,lo,en,sub])=>({name:n, sub, latitude:la, longitude:lo, en, rank:1}))
];
function searchLocal(q){
  const k = q.toLowerCase();
  return LOCAL.filter(p => p.name.startsWith(q) || p.name.includes(q) || p.en.toLowerCase().startsWith(k))
    .sort((a,b)=> (b.name.startsWith(q)-a.name.startsWith(q)) || (a.rank-b.rank))
    .slice(0, 8);
}

// ───────── Open-Meteo 지오코딩 (한국만) ─────────
async function geoApi(name, signal){
  if(name.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=ko&countryCode=KR`;
  const res = await fetchRetry(url, { signal });
  if(!res.ok) return [];
  const d = await res.json();
  return (d.results || [])
    .filter(r => r.country_code === "KR" && /^PPL/.test(r.feature_code || "PPL"))   // 산·지형 제외, 한국만
    .map(r => ({
      name: r.name, sub: r.admin1 && r.admin1 !== r.name ? r.admin1 : "",
      latitude: r.latitude, longitude: r.longitude,
      pop: r.population || 0, major: /^PPL(C|A\d?)$/.test(r.feature_code || "")
    }));
}
function prune(list){
  const big = list.filter(r => r.major || r.pop > 0);
  return (big.length ? big : list).slice(0, 5);
}
async function searchApi(q, signal){
  const jobs = [];
  if(hasHangul(q)){
    const rom = romanize(stripSuffix(q));      // 한글 → 영문 변환 검색 (큰 지역이 먼저 나옴)
    jobs.push(geoApi(rom, signal), geoApi(q, signal));
  } else jobs.push(geoApi(q, signal));
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set();
  const uniq = all.filter(r => { const key = r.latitude.toFixed(2)+","+r.longitude.toFixed(2); if(seen.has(key)) return false; seen.add(key); return true; })
    .sort((a,b)=> (b.major-a.major) || (b.pop-a.pop));
  return prune(uniq);
}


// ───────── 자동완성 UI ─────────
const input = $("q"), box = $("suggest");
let items = [], active = -1, ctrl, timer;

function showSuggest(list){
  items = list; active = -1;
  box.innerHTML = list.map((p,i)=>`<li data-i="${i}"><span>${p.name}</span><small>${p.sub||""}</small></li>`).join("");
  box.hidden = !list.length;
}
function pick(p){
  input.value = p.name; box.hidden = true;
  load({ name: p.sub ? `${p.name} (${p.sub})` : p.name, latitude: p.latitude, longitude: p.longitude });
}
function merge(local, remote){
  const seen = new Set(local.map(p=>p.latitude.toFixed(1)+","+p.longitude.toFixed(1)));
  return [...local, ...remote.filter(r=>!seen.has(r.latitude.toFixed(1)+","+r.longitude.toFixed(1)))].slice(0, 10);
}
input.addEventListener("input", ()=>{
  const q = input.value.trim();
  clearTimeout(timer); ctrl?.abort();
  if(!q){ box.hidden = true; return; }
  const local = searchLocal(q);
  showSuggest(local);                                    // 즉시 표시
  if(q.length < 2) return;
  timer = setTimeout(async ()=>{                         // 이후 API 결과 합치기
    ctrl = new AbortController();
    try{
      const remote = await searchApi(q, ctrl.signal);
      if(input.value.trim() === q) showSuggest(merge(local, remote));
    }catch(e){ /* 취소/네트워크 오류는 무시 */ }
  }, 250);
});
input.addEventListener("keydown", e=>{
  if(box.hidden) return;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    e.preventDefault();
    active = (active + (e.key==="ArrowDown"?1:-1) + items.length) % items.length;
    [...box.children].forEach((li,i)=>li.classList.toggle("active", i===active));
  } else if(e.key==="Enter" && active>=0){ e.preventDefault(); pick(items[active]); }
  else if(e.key==="Escape") box.hidden = true;
});
box.addEventListener("mousedown", e=>{ const li=e.target.closest("li"); if(li) pick(items[+li.dataset.i]); });
document.addEventListener("click", e=>{ if(!e.target.closest(".searchbox")) box.hidden = true; });

$("search").addEventListener("submit", async e=>{
  e.preventDefault();
  const q = input.value.trim(); if(!q) return;
  const first = items[0] || searchLocal(q)[0] || (await searchApi(q).catch(()=>[]))[0];
  if(first) pick(first); else setStatus(`'${q}' 에 해당하는 한국 지역을 찾을 수 없습니다`, true);
});

// ───────── 날씨 ─────────
async function fetchWeather({latitude, longitude}){
  const p = new URLSearchParams({
    latitude, longitude,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day",
    hourly: "temperature_2m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Seoul", forecast_days: 7
  });
  const res = await fetchRetry("https://api.open-meteo.com/v1/forecast?" + p);
  if(!res.ok) throw new Error("날씨 데이터를 가져오지 못했습니다");
  return res.json();
}

async function fetchAir(points){
  const arr = Array.isArray(points) ? points : [points];
  const p = new URLSearchParams({
    latitude: arr.map(x=>x.latitude).join(","), longitude: arr.map(x=>x.longitude).join(","),
    current: "pm10,pm2_5,us_aqi", timezone: "Asia/Seoul"
  });
  const res = await fetchRetry("https://air-quality-api.open-meteo.com/v1/air-quality?" + p);
  if(!res.ok) throw new Error("대기질 데이터를 가져오지 못했습니다");
  const d = await res.json();
  return Array.isArray(points) ? d : (Array.isArray(d) ? d[0] : d);
}
// 환경부 기준 (μg/m³): PM10 30/80/150, PM2.5 15/35/75
const GRADE = ["좋음","보통","나쁨","매우나쁨"];
function grade(v, cut){ if(v==null) return -1; return v<=cut[0]?0 : v<=cut[1]?1 : v<=cut[2]?2 : 3; }
const g10 = v => grade(v,[30,80,150]), g25 = v => grade(v,[15,35,75]);
const badge = g => g<0 ? `<b class="gx">정보 없음</b>` : `<b class="g${g+1}">${GRADE[g]}</b>`;

function renderAir(air){
  const el = $("air");
  if(!air || !air.current){ el.innerHTML = `<div class="airerr">미세먼지 정보를 불러오지 못했습니다</div>`; return; }
  const c = air.current;
  el.innerHTML = `
    <div class="airrow"><span>초미세먼지 PM2.5</span><span>${c.pm2_5 ?? "-"} μg/m³ ${badge(g25(c.pm2_5))}</span></div>
    <div class="airrow"><span>미세먼지 PM10</span><span>${c.pm10 ?? "-"} μg/m³ ${badge(g10(c.pm10))}</span></div>`;
}

function render(place, d, air){
  const c = d.current, w = info(c.weather_code, c.is_day);
  $("place").textContent = place.name;
  $("icon").textContent = w.icon;
  $("temp").textContent = Math.round(c.temperature_2m);
  $("desc").textContent = w.text;
  $("feels").textContent = Math.round(c.apparent_temperature) + "°";
  $("humidity").textContent = c.relative_humidity_2m + "%";
  $("wind").textContent = c.wind_speed_10m + " km/h";
  $("precip").textContent = c.precipitation + " mm";
  $("updated").textContent = "기준 시각 " + c.time.replace("T"," ") + " (KST)";
  document.body.className = [!c.is_day && "night", RAIN.includes(c.weather_code) && "rain", SNOW.includes(c.weather_code) && "snow"].filter(Boolean).join(" ");

  const h = d.hourly, start = Math.max(0, h.time.findIndex(t => t >= c.time.slice(0,13)+":00"));
  $("hourly").innerHTML = h.time.slice(start, start+24).map((t,i)=>{
    const k = start+i, x = info(h.weather_code[k], h.is_day[k]);
    return `<div class="hour"><div class="t">${i===0?"지금":t.slice(11,13)+"시"}</div><div class="i">${x.icon}</div><div class="d">${Math.round(h.temperature_2m[k])}°</div></div>`;
  }).join("");

  const days = ["일","월","화","수","목","금","토"];
  $("daily").innerHTML = d.daily.time.map((t,i)=>{
    const x = info(d.daily.weather_code[i]), dt = new Date(t+"T00:00");
    return `<li><span>${i===0?"오늘":days[dt.getDay()]+" "+(dt.getMonth()+1)+"/"+dt.getDate()}</span><span class="i">${x.icon}</span>
      <span class="p">💧${d.daily.precipitation_probability_max[i] ?? 0}%</span>
      <span class="r"><span>${Math.round(d.daily.temperature_2m_min[i])}°</span> / ${Math.round(d.daily.temperature_2m_max[i])}°</span></li>`;
  }).join("");
  renderAir(air);
  ["current","hourlyWrap","dailyWrap"].forEach(id => $(id).hidden = false);
}

let currentPlace = null, reqId = 0;
async function load(place){
  const id = ++reqId;
  setStatus("날씨를 불러오는 중…");
  try{
    currentPlace = place;
    const [w, air] = await Promise.all([fetchWeather(place), fetchAir(place).catch(()=>null)]);
    if(id !== reqId) return;           // 그 사이 다른 지역을 선택했으면 무시
    render(place, w, air);
    focusMap(place);
    setStatus("");
  }catch(e){ setStatus(e.message || "오류가 발생했습니다", true); }
}

// ───────── 지도 (Leaflet + OpenStreetMap) ─────────
const KOREA_BOUNDS = [[32.8,124.0],[38.7,132.2]];
const map = L.map("map", { minZoom: 6, maxZoom: 13, maxBounds: [[31.5,122.0],[40.0,134.0]], maxBoundsViscosity: .8 })
  .setView([36.2,127.8], 7);
// 한글 지도: OpenFreeMap 벡터 타일(API 키 불필요) + 라벨을 한글(name:ko → 현지명)로 고정
function esriFallback(){
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 18, attribution: "Tiles © Esri (영문 표기)" }).addTo(map);
}
(async function addBaseMap(){
  try{
    if(!window.maplibregl || !L.maplibreGL) throw new Error("maplibre 로드 실패");
    const style = await (await fetchRetry("https://tiles.openfreemap.org/styles/liberty")).json();
    style.layers.forEach(l => {
      const t = l.layout && l.layout["text-field"];
      if(t && JSON.stringify(t).indexOf('"ref"') < 0)
        l.layout["text-field"] = ["coalesce", ["get","name:ko"], ["get","name"]];
    });
    L.maplibreGL({ style, attribution: "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors" }).addTo(map);
  }catch(e){ console.warn("한글 지도 실패, Esri로 대체:", e); esriFallback(); }
})();
let selMarker = null;
function focusMap(place){
  const ll = [place.latitude, place.longitude];
  if(selMarker) selMarker.setLatLng(ll);
  else selMarker = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#ff4d6d", fillOpacity: 1 }).addTo(map);
  map.flyTo(ll, Math.max(map.getZoom(), 8), { duration: .8 });
  if(typeof Map3D !== "undefined") Map3D.focus(place);
}
// 클릭한 좌표 → 가장 가까운 내장 지역 이름 (역지오코딩 키 없이)
function distKm(a,b,c,d){ const R=6371,t=x=>x*Math.PI/180,dl=t(c-a),dn=t(d-b);
  const h=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dn/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
function nameFor(lat, lon){
  let best=null, bd=1e9;
  for(const p of LOCAL){ const d=distKm(lat,lon,p.latitude,p.longitude); if(d<bd){bd=d;best=p;} }
  return bd < 15 ? best.name : `${best.name} 인근 (${lat.toFixed(2)}, ${lon.toFixed(2)})`;
}
map.on("click", e=>{
  const {lat, lng} = e.latlng;
  if(lat > 38.62 || lat < 32.9 || lng < 124.5 || lng > 131.95){ setStatus("대한민국 지역을 선택해 주세요", true); return; }
  input.value = "";
  load({ name: nameFor(lat,lng), latitude: lat, longitude: lng });
});

// ───────── 전국 한눈에: 17개 시·도 (날씨 1회 + 대기질 1회 호출) ─────────
const shortName = n => n.replace(/(특별자치시|특별자치도|특별시|광역시)$/,"").replace("청북도","북").replace("청남도","남").replace("라북도","북").replace("라남도","남").replace("상북도","북").replace("상남도","남").replace("충북","충북");
let provMarkers = [];
async function loadOverview(){
  const pts = PROVINCES.map(x=>({latitude:x[1], longitude:x[2]}));
  const wp = new URLSearchParams({
    latitude: pts.map(x=>x.latitude).join(","), longitude: pts.map(x=>x.longitude).join(","),
    current: "temperature_2m,weather_code,is_day", timezone: "Asia/Seoul"
  });
  try{
    const [wres, air] = await Promise.all([fetchRetry("https://api.open-meteo.com/v1/forecast?" + wp).then(r=>r.json()), fetchAir(pts).catch(()=>null)]);
    provMarkers.forEach(m=>m.remove()); provMarkers = [];
    const ov = [];
    $("overview").innerHTML = PROVINCES.map((pv,i)=>{
      const c = wres[i].current, x = info(c.weather_code, c.is_day), t = Math.round(c.temperature_2m);
      const pm = air?.[i]?.current?.pm2_5, g = g25(pm), gc = g<0 ? "gx" : "g"+(g+1);
      const nm = shortName(pv[0]);
      ov.push({ full: pv[0], short: nm, latitude: pv[1], longitude: pv[2], icon: x.icon, temp: t, pm, g });
      // 지도 마커
      const m = L.marker([pv[1],pv[2]], { icon: L.divIcon({ className:"", iconSize:[58,44], iconAnchor:[29,22],
        html:`<div class="pin ${gc}"><span>${x.icon}</span><b>${t}°</b></div>` }), title: `${pv[0]} · PM2.5 ${pm ?? "-"}` }).addTo(map);
      m.on("click", ()=>{ input.value = pv[0]; load({ name: pv[0], latitude: pv[1], longitude: pv[2] }); });
      provMarkers.push(m);
      return `<button class="cell ${gc}" data-i="${i}"><span class="n">${nm}</span><span class="i">${x.icon}</span><span class="t">${t}°</span><span class="pm">PM2.5 ${pm!=null?Math.round(pm):"-"}</span></button>`;
    }).join("");
    window.overviewData = ov; if(typeof Map3D !== "undefined") Map3D.setData();
    $("overviewWrap").hidden = false;
  }catch(e){ /* 개요 실패는 무시 */ }
}
$("overview").addEventListener("click", e=>{
  const b = e.target.closest(".cell"); if(!b) return;
  const pv = PROVINCES[+b.dataset.i];
  input.value = pv[0];
  load({ name: pv[0], latitude: pv[1], longitude: pv[2] });
});

function locate(){
  if(!navigator.geolocation){ load(DEFAULT); return; }
  setStatus("현재 위치 확인 중…");
  navigator.geolocation.getCurrentPosition(
    pos => load({ name: "현재 위치", latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
    () => load(DEFAULT), { timeout: 8000 });
}
$("locate").addEventListener("click", locate);

load(DEFAULT);          // 첫 화면은 서울 (위치 권한 팝업 없이). 📍 버튼으로 내 위치 사용
loadOverview();
setInterval(() => { if(currentPlace) load(currentPlace); loadOverview(); }, 10*60*1000);
