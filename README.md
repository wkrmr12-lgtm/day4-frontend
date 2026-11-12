# 한국 날씨·미세먼지 지도 + AI 장소 추천 에이전트

Vercel만으로 동작합니다 (정적 프런트 + 서버리스 함수). 별도 서버(Railway 등)는 필요 없습니다.

## 구조
```
index.html, style.css, app.js, places.js   프런트 (Leaflet 한글 지도, 날씨·미세먼지)
agent.js                                    AI 채팅 UI
api/chat.js                                 Vercel 서버리스 함수: Gemini function calling 에이전트 루프
lib/tools.js                                도구 2개: get_weather, find_spots
```

## 에이전트 동작
1. 사용자 질문 → `/api/chat`
2. Gemini가 도구를 선택(function calling): `get_weather`(Open-Meteo 날씨·미세먼지), `find_spots`(OpenStreetMap 장소 검색)
3. 서버가 도구를 실행하고 결과를 Gemini에 전달 → 날씨·미세먼지를 반영한 추천 답변
4. 프런트가 도구 호출 내역, 답변, 지도 마커를 표시

## Vercel 배포
1. GitHub 저장소를 Vercel에 Import (Framework: Other, Root Directory: `./`)
2. **Settings → Environment Variables** 에 `GEMINI_API_KEY` 등록 ([Google AI Studio](https://aistudio.google.com/apikey)에서 발급)
3. (선택) `GEMINI_MODEL` 로 모델 변경 (기본 `gemini-3.1-flash-lite`)
4. 환경변수 추가 후 **Redeploy**

로컬 실행: `npm i -g vercel` → `.env.local`에 키 저장 → `vercel dev`
(`index.html`을 파일로 직접 열면 지도·날씨는 되지만 `/api/chat`은 동작하지 않습니다.)

## 참고
- 장소 데이터는 OpenStreetMap이라 평점·리뷰가 없습니다.
- 미세먼지는 모델 예측값(CAMS)이며 한국 환경부 등급 기준으로 표시합니다.
- `/api/chat`은 공개 엔드포인트입니다. 키 남용을 막기 위해 IP당 분당 12회로 제한하지만, Google AI Studio에서 쿼터·예산 한도도 설정해 두세요.
