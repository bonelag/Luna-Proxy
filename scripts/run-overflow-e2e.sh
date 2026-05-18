#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
PROXY_KEY="${PROXY_KEY:-123456}"
MODEL="${MODEL:-qwen3.6-plus}"
THRESHOLD="${THRESHOLD:-1000}"
# Generate ~1100 tokens (approx 4 chars/token) -> 4500 chars to exceed 1000-token threshold
LONG_CHARS="${LONG_CHARS:-4500}"
INPUT_MODE="${INPUT_MODE:-prompt}"
INPUT_FILE="${INPUT_FILE:-src/server.ts}"
PROMPT_TEXT="${PROMPT_TEXT:-}"
LOG_FILE="${LOG_FILE:-/tmp/proxy-luna-run.log}"

echo "[1/5] Skipping proxy start (assume server already running on ${BASE_URL})"
cd /home/wholock/Projects/AI/Proxy/Proxy-Luna

echo "[2/5] Health check"
curl -sS "${BASE_URL}/health"
echo

echo "[3/5] Set threshold=${THRESHOLD}"
curl -sS -X POST "${BASE_URL}/api/config" \
  -H 'Content-Type: application/json' \
  -d "{\"settings\":{\"tokenOverflow\":{\"enabled\":true,\"threshold\":${THRESHOLD}}}}" >/dev/null

echo "[4/5] Send over-threshold request to /v1/chat/completions"
if [[ "${INPUT_MODE}" == "file" ]]; then
  SOURCE_FILE="${INPUT_FILE}"
  if [[ ! -f "${SOURCE_FILE}" ]]; then
    echo "Missing INPUT_FILE: ${SOURCE_FILE}" >&2
    exit 1
  fi
  LONG="$(LONG_CHARS="${LONG_CHARS}" node -e "const fs=require('fs'); const p=process.argv[1]; const target=Number(process.env.LONG_CHARS||'6200'); const txt=fs.readFileSync(p,'utf8'); const repeat=Math.max(1, Math.ceil(target / Math.max(1, txt.length))); process.stdout.write(txt.repeat(repeat).slice(0, target));" "${SOURCE_FILE}")"
else
  if [[ -n "${PROMPT_TEXT}" ]]; then
    LONG="${PROMPT_TEXT}"
  else
    LONG="$(LONG_CHARS="${LONG_CHARS}" node -e "const target=Number(process.env.LONG_CHARS||'6200'); const blocks=['Tôi đang kiểm tra cơ chế overflow-to-file trong Proxy-Luna.','Mục tiêu là khi nội dung vượt ngưỡng token thì phần dư được ghi vào file txt rồi upload lên Qwen.','Bạn hãy tóm tắt nội dung sau và giữ lại cấu trúc chính, nhưng đoạn văn bên dưới là dữ liệu kiểm thử.']; const filler=['Yêu cầu: xác nhận đường xử lý upload, parse, rồi đính file vào payload chat.','Nếu phần prompt quá dài, hãy chuyển phần tràn sang file thay vì nhúng nguyên văn.','Đây là chuỗi kiểm thử để mô phỏng prompt thật có ngôn ngữ tự nhiên và yêu cầu thao tác hệ thống.']; let text=blocks.concat(filler).join('\\n\\n'); while (text.length < target) text += '\\n\\n' + filler.join(' '); process.stdout.write(text.slice(0, target));")"
  fi
fi
PAYLOAD_FILE="$(mktemp)"
LONG="${LONG}" MODEL="${MODEL}" node -e "const fs=require('fs'); const out=process.argv[1]; const body={model:process.env.MODEL,stream:false,messages:[{role:'user',content:process.env.LONG}]}; fs.writeFileSync(out, JSON.stringify(body), 'utf8');" "${PAYLOAD_FILE}"
RESP_FILE="$(mktemp)"
curl -sS -X POST "${BASE_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${PROXY_KEY}" \
  -H 'Content-Type: application/json' \
  --data-binary @"${PAYLOAD_FILE}" \
  | tee "${RESP_FILE}" >/dev/null
node -e '
const fs = require("fs");
const path = process.argv[1];
const raw = fs.readFileSync(path, "utf8");
try {
  const data = JSON.parse(raw);
  const msg = data?.choices?.[0]?.message || {};
  process.stdout.write(`[response] id=${data.id || ""}\n`);
  process.stdout.write(`[response] content=${String(msg.content || "").slice(0, 800)}\n`);
  process.stdout.write(`[response] reasoning=${String(msg.reasoning_content || "").slice(0, 300)}\n`);
} catch (err) {
  process.stdout.write(`[response] raw=${raw.slice(0, 1000)}\n`);
}
' "${RESP_FILE}"
rm -f "${PAYLOAD_FILE}" "${RESP_FILE}"
echo

echo "[5/5] Log check (upload + parse + payload)"
rg -n 'getstsToken|OSS upload response|files/parse|Overflow content moved to file|upload failed|Request payload' "${LOG_FILE}" | tail -n 120 || true

echo "Done."
