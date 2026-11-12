"use strict";
const { cleanKey } = require("../lib/key");
// 진단용: 서버가 읽은 GEMINI_API_KEY가 어떤 값인지 (키 전체는 절대 노출하지 않음: 길이·앞 3글자·뒤 4글자만)
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const raw = process.env.GEMINI_API_KEY || "";
  const key = cleanKey(raw);
  res.status(200).json({
    gemini_api_key: !raw ? "없음 (환경변수가 연결되지 않았거나 재배포 전)" : {
      raw_length: raw.length, length: key.length,
      starts_with: key.slice(0, 3), ends_with: key.slice(-4),
      changed_by_cleanup: raw !== key,
      has_invalid_chars: /[^A-Za-z0-9_.-]/.test(key)
    },
    model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite (기본값)"
  });
};
