"use strict";
// 복사·붙여넣기 과정에서 망가진 API 키 복구
// - 긴 줄표(—) 하나는 하이픈 두 개(--)가 자동 변환된 것이므로 "--"로 되돌림 (Mac 스마트 대시 등)
// - 나머지 대시류(–, ‐, − 등)는 하이픈 하나로
// - 공백·줄바꿈·보이지 않는 문자는 제거
function cleanKey(raw) {
  return String(raw || "")
    .replace(/—/g, "--")
    .replace(/[‐-–―−﹣－]/g, "-")
    .replace(/[\s​-‍﻿]/g, "");
}
module.exports = { cleanKey };
