// AI 장소 추천 에이전트 UI: /api/chat (Vercel 서버리스, Gemini function calling) 호출
(function () {
  const chat = document.getElementById("chat"), form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput"), sendBtn = document.getElementById("chatSend");
  const history = [];          // [{role:'user'|'model', text}]
  let spotLayer = null, busy = false;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 최소 마크다운(굵게, 목록, 줄바꿈) → 안전한 HTML
  function md(text) {
    const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    const out = []; let list = false;
    for (const line of String(text).split("\n")) {
      const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      if (m) { if (!list) { out.push("<ul>"); list = true; } out.push("<li>" + inline(m[1]) + "</li>"); }
      else { if (list) { out.push("</ul>"); list = false; } if (line.trim()) out.push("<p>" + inline(line) + "</p>"); }
    }
    if (list) out.push("</ul>");
    return out.join("");
  }
  function addMsg(role, html, extraClass) {
    const d = document.createElement("div");
    d.className = "msg " + role + (extraClass ? " " + extraClass : "");
    d.innerHTML = html; chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
    return d;
  }
  const toolHtml = calls => !calls || !calls.length ? "" :
    '<div class="tools">' + calls.map(t => {
      const args = Object.values(t.args || {}).join(", ");
      return `<span class="tool ${t.ok ? "" : "fail"}">🔧 <code>${esc(t.name)}(${esc(args)})</code> → ${esc(t.summary || "")} · ${t.ms ?? "?"}ms</span>`;
    }).join("") + "</div>";

  function showSpots(spots, focus) {
    if (spotLayer) { spotLayer.remove(); spotLayer = null; }
    if (!spots || !spots.length) return 0;
    spotLayer = L.layerGroup().addTo(map);
    const pts = [];
    spots.forEach((s, i) => {
      const ll = [s.latitude, s.longitude]; pts.push(ll);
      L.marker(ll, { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 26], html: `<div class="spot"><b>${i + 1}</b></div>` }) })
        .bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.category || "")}${s.distance_km != null ? " · 중심에서 " + s.distance_km + "km" : ""}`)
        .addTo(spotLayer);
    });
    if (focus) pts.push([focus.latitude, focus.longitude]);
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
    return spots.length;
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true; input.disabled = sendBtn.disabled = true;
    addMsg("user", esc(text)); history.push({ role: "user", text });
    const pending = addMsg("model", '<span class="dots">도구를 고르는 중</span>');
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history.slice(-10) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { pending.className = "msg model err"; pending.innerHTML = toolHtml(data.toolCalls) + esc(data.error || `오류 (HTTP ${res.status})`); history.pop(); return; }
      history.push({ role: "model", text: data.answer });
      const n = showSpots(data.spots, data.focus);
      pending.innerHTML = toolHtml(data.toolCalls) + md(data.answer) +
        (n ? `<button type="button" class="mapbtn">📍 지도에서 ${n}곳 보기</button>` : "");
      const b = pending.querySelector(".mapbtn");
      if (b) b.onclick = () => document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
      // 추천 지역의 날씨 카드도 함께 갱신 (지도 범위는 유지)
      if (data.focus) { window.noFlyUntil = Date.now() + 8000; load({ name: data.focus.name, latitude: data.focus.latitude, longitude: data.focus.longitude }); }
    } catch (e) {
      pending.className = "msg model err";
      pending.textContent = location.protocol === "file:"
        ? "AI 에이전트는 서버 기능(/api/chat)이 필요해서 Vercel 배포 주소(또는 `vercel dev`)에서만 동작합니다."
        : "네트워크 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
      history.pop();
    } finally {
      busy = false; input.disabled = sendBtn.disabled = false; input.focus(); chat.scrollTop = chat.scrollHeight;
    }
  }

  form.addEventListener("submit", e => { e.preventDefault(); const t = input.value.trim(); input.value = ""; send(t); });
  document.getElementById("chips").addEventListener("click", e => { const b = e.target.closest("button"); if (b) send(b.textContent); });
})();
