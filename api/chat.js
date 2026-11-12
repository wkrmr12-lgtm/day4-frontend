"use strict";
// Vercel 서버리스 함수: Gemini 함수 호출(function calling) 에이전트
// 흐름: 사용자 질문 → Gemini가 도구 선택(get_weather / find_spots) → 서버가 도구 실행 → 결과를 Gemini에 전달 → 최종 추천 답변
const { DECLARATIONS, runTool } = require("../lib/tools");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const ENDPOINT = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const MAX_STEPS = 5;           // 도구 호출 왕복 최대 횟수
const hits = new Map();        // 간단한 IP별 호출 제한 (인스턴스 단위, 분당 12회)

function rateLimited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => now - t < 60000)) hits.delete(k);
  return list.length > 12;
}

function systemPrompt() {
  const now = new Date(Date.now() + 9 * 3600 * 1000), iso = now.toISOString();
  const day = ["일", "월", "화", "수", "목", "금", "토"][now.getUTCDay()];
  return `당신은 한국 여행·나들이 장소를 추천하는 AI 에이전트입니다.
현재 시각(KST): ${iso.slice(0, 10)} (${day}요일) ${iso.slice(11, 16)}

사용할 수 있는 도구
- get_weather: 지역의 실시간 날씨·미세먼지·예보
- find_spots: 지역 주변 장소 검색(카페, 음식점, 관광명소, 공원, 박물관, 쇼핑, 해변, 전망)

규칙
1. 장소 추천 요청이면 find_spots로 후보를 찾고, 야외/실내 판단에 날씨가 필요하면 get_weather도 호출합니다. 서로 독립적인 호출은 한 번에 함께 요청하세요.
2. 날씨와 미세먼지를 반영하세요. 비·눈이 오거나 PM2.5가 '나쁨'(36μg/m³ 이상)이거나 기온이 극단적이면 박물관·쇼핑·카페 같은 실내 위주로 추천하고 이유를 알려 주세요.
3. 도구 결과에 없는 장소·평점·영업시간·가격은 절대 지어내지 마세요. 장소 데이터는 OpenStreetMap이라 평점이 없습니다.
4. 한국 지역만 다룹니다. 북한이나 해외는 정중히 범위 밖이라고 안내하세요. 지역이 불분명하면 한 번만 되물으세요.
5. 답변은 한국어로 간결하게: ① 날씨 한두 줄 ② 추천 장소 3~5곳(이름, 추천 이유, 거리 등 도구 결과 근거) ③ 한 줄 팁. 필요하면 마크다운 목록을 쓰세요.
6. 도구가 실패하면 실패 사실을 솔직히 알리고 가능한 범위에서 답하세요.`;
}

async function callGemini(contents) {
  const r = await fetch(ENDPOINT(MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      tools: [{ functionDeclarations: DECLARATIONS }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 4096 }
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `Gemini API 오류 (HTTP ${r.status})`;
    const hint = r.status === 404 ? " — 모델명을 확인하세요(환경변수 GEMINI_MODEL)." : r.status === 400 && /API key/i.test(msg) ? " — GEMINI_API_KEY를 확인하세요." : "";
    const err = new Error(msg + hint); err.status = r.status; throw err;
  }
  return data;
}

// 도구 결과를 화면 표시용 한 줄로 요약
function summarize(name, res) {
  if (name === "get_weather") return `${res.location} · ${res.current.condition} ${res.current.temperature_c}°C` + (res.air_quality ? ` · PM2.5 ${res.air_quality.pm2_5_ugm3} (${res.air_quality.pm2_5_grade})` : "");
  if (name === "find_spots") return `${res.location} · ${res.category} ${res.count}곳 · ${res.source.replace(/OpenStreetMap |[()]/g, "")}`;
  return "완료";
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다" });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다 (Vercel → Settings → Environment Variables)" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const history = Array.isArray(body?.messages) ? body.messages.slice(-10) : [];
  const contents = history
    .filter(m => m && typeof m.text === "string" && m.text.trim())
    .map(m => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text.slice(0, 800) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user")
    return res.status(400).json({ error: "마지막 메시지는 사용자 질문이어야 합니다" });

  const toolCalls = [], spots = [];
  let focus = null, answer = "";
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await callGemini(contents);
      const cand = data.candidates && data.candidates[0];
      if (!cand || !cand.content) {
        answer = data.promptFeedback?.blockReason ? "죄송해요, 이 질문에는 답변드릴 수 없어요. 다른 질문을 해 주세요." : "답변을 생성하지 못했어요. 다시 시도해 주세요.";
        break;
      }
      const parts = cand.content.parts || [];
      const calls = parts.filter(p => p.functionCall);
      if (!calls.length) { answer = parts.filter(p => p.text && !p.thought).map(p => p.text).join("").trim(); break; }

      contents.push(cand.content);   // thoughtSignature 보존을 위해 모델 응답을 그대로 이어 붙임
      const responses = await Promise.all(calls.map(async ({ functionCall: fc }) => {
        const t0 = Date.now(), entry = { name: fc.name, args: fc.args || {} };
        let result;
        try {
          result = await runTool(fc.name, fc.args);
          entry.ok = true; entry.summary = summarize(fc.name, result);
          if (fc.name === "find_spots") {
            spots.push(...result.spots.map(s => ({ name: s.name, latitude: s.latitude, longitude: s.longitude, category: s.category, distance_km: s.distance_km })));
            focus = { name: result.location, ...result.center };
          } else if (fc.name === "get_weather" && !focus) focus = { name: result.location, latitude: result.latitude, longitude: result.longitude };
        } catch (e) {
          entry.ok = false; entry.summary = e.message; result = { error: e.message };
        }
        entry.ms = Date.now() - t0; toolCalls.push(entry);
        const fr = { name: fc.name, response: result.error ? { error: result.error } : { result } };
        if (fc.id) fr.id = fc.id;
        return { functionResponse: fr };
      }));
      contents.push({ role: "user", parts: responses });
    }
    if (!answer) answer = "도구 호출이 너무 많아 답변을 마무리하지 못했어요. 질문을 조금 더 구체적으로 해 주세요.";
    return res.status(200).json({ answer, toolCalls, spots, focus, model: MODEL });
  } catch (e) {
    console.error("chat error:", e);
    return res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message || "에이전트 오류", toolCalls });
  }
};
