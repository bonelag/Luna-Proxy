# Bao cao phan tich tool call, prompt injection va ho tro OpenAI/Anthropic

Tai lieu nay phan tich cach du an `Qwen2API_Go` bien Qwen Chat thanh API tuong thich OpenAI va Anthropic, dac biet la chuc nang tool call. Muc tieu la rut ra mot thiet ke co the ap dung lai trong du an khac.

## 1. Tong quan kien truc

Du an cung cap hai API chat chinh:

- OpenAI compatible: `POST /v1/chat/completions`, dinh nghia trong `internal/server/server.go`, xu ly boi `Handler.HandleChatCompletion`.
- Anthropic compatible: `POST /v1/messages` va `POST /v1/messages/count_tokens`, xu ly boi `Handler.HandleAnthropicMessages` va `Handler.HandleAnthropicCountTokens`.

Ca hai format cuoi cung deu di vao mot pipeline chung:

1. Parse request cua client.
2. Chuyen request thanh `executedChatRequest` noi bo.
3. Inject prompt dieu khien neu co system prompt mac dinh hoac neu co tools.
4. Chuyen message noi bo thanh format Qwen upstream.
5. Goi Qwen upstream.
6. Parse response cua Qwen.
7. Neu model tra ve XML tool call, tach thanh tool call co cau truc.
8. Render lai thanh response OpenAI hoac Anthropic tuy endpoint ban dau.

Trong du an nay Qwen upstream khong duoc xem la model co native tool calling on dinh. Thay vao do, proxy gia lap tool call bang cach ep model sinh XML theo protocol rieng, sau do proxy parse XML va chuyen ve format chuan cua client.

## 2. Duong di OpenAI chat completions

File chinh: `internal/openai/handler.go`.

Request OpenAI duoc parse vao `chatRequest`, gom cac truong quan trong:

- `model`
- `messages`
- `stream`
- `tools`
- `tool_choice`
- `parallel_tool_calls`
- `reasoning_effort`
- `enable_thinking`
- `size`

`HandleChatCompletion` lam cac viec sau:

1. Decode JSON request.
2. Uoc luong input token bang `estimateOpenAIInputTokens`.
3. Neu model la Lingma thi chuyen sang luong rieng.
4. Neu request la `hi` thi tra response nhanh noi bo.
5. Goi `executeChatRequest` voi `executedChatRequest`.
6. Tuy `stream` ma goi `handleStream` hoac `handleNonStream`.

`executeChatRequest` nam trong `internal/openai/chat_execution.go`. Ham nay goi `prepareChatRequest`, sau do chon account, tao hoac reuse `chat_id`, upload inline media neu can, build body Qwen, roi goi Qwen upstream.

## 3. Duong di Anthropic messages

File chinh: `internal/openai/anthropic.go`.

Request Anthropic duoc parse vao `anthropicRequest`, gom:

- `model`
- `system`
- `messages`
- `max_tokens`
- `stream`
- `tools`
- `tool_choice`
- `thinking`
- `response_format`
- `parallel_tool_calls`

`HandleAnthropicMessages` lam cac viec:

1. Kiem tra header `anthropic-version`. Du an chi validate format `YYYY-MM-DD`, khong bat buoc mot version cu the.
2. Decode JSON.
3. Goi `convertAnthropicRequestWithOverrides` de chuyen Anthropic request thanh `executedChatRequest`.
4. Uoc luong token bang `estimateAnthropicInputTokens`.
5. Goi chung `executeChatRequest`.
6. Tuy `stream` ma render response bang `handleAnthropicStream` hoac `handleAnthropicNonStream`.

Dieu quan trong: Anthropic chi la lop compatibility o bien ngoai. Sau khi normalize, no di vao cung mot co che tool prompt XML nhu OpenAI.

## 4. Chuan hoa Anthropic ve request noi bo

`convertAnthropicRequestWithOverrides` la ham trung tam.

### System

Anthropic `system` co the la string hoac list content block. Du an dung `normalizeAnthropicSystem`:

- Neu la string: trim va dung truc tiep.
- Neu la array block: chi gom cac block `type: "text"` lai bang newline.

Neu request co `response_format`, du an them instruction vao system:

- `{"type":"json_object"}` them prompt `Respond with a valid JSON object only.`
- `{"type":"json_schema","json_schema":...}` them prompt `Respond with JSON that conforms to this schema: ...`
- Neu schema thieu thi dung fallback prompt.

Nhung prompt nay nam trong `internal/prompts/prompts.go` va co the override.

### Messages

`normalizeAnthropicMessage` chuyen tung Anthropic message thanh list OpenAI-like message:

- `text` -> content item `{type:"text", text:"..."}`
- `image` base64 -> `{type:"image_url", image_url:{url:"data:<media>;base64,<data>"}}`
- `image_url` -> cung ve `image_url`
- `tool_result` -> message role `tool` voi `tool_call_id` va content text

Neu `tool_result.is_error = true`, content duoc prefix `ERROR: `.

Luu y: du an khong giu block `tool_use` cua Anthropic input nhu mot assistant tool call rieng trong `normalizeAnthropicMessage`. Trong uoc luong token thi co tinh `tool_use`, nhung normalize message chi xu ly `text`, `image`, `image_url`, `tool_result`.

### Tools

`convertAnthropicTools` chuyen Anthropic tools ve OpenAI tools:

Anthropic:

```json
{
  "name": "search",
  "description": "Search docs",
  "input_schema": {"type": "object"}
}
```

Noi bo/OpenAI-like:

```json
{
  "type": "function",
  "function": {
    "name": "search",
    "description": "Search docs",
    "parameters": {"type": "object"}
  }
}
```

Du an cung ho tro bien the LiteLLM/OpenAI-style trong Anthropic endpoint:

```json
{
  "type": "function",
  "function": {
    "name": "search",
    "description": "Search docs",
    "parameters": {"type": "object"}
  }
}
```

### Tool choice

`convertAnthropicToolChoice` map nhu sau:

- `"auto"` -> `"auto"`
- `{"type":"auto"}` -> `"auto"`
- `{"type":"any"}` hoac `{"type":"required"}` -> `"required"`
- `{"type":"tool","name":"search"}` -> OpenAI specific function choice
- `{"type":"function","name":"search"}` -> OpenAI specific function choice

Sau do `toolcall.InjectPromptWithOverrides` doc `tool_choice` theo OpenAI-like format.

## 5. Prompt injection cua du an

Co hai lop prompt injection chinh.

### 5.1 Qwen Web2 control prompt

File: `internal/openai/chat_execution.go`.

`prepareChatRequest` goi:

```go
messages := injectQwenWeb2ControlPrompt(payload.Messages, h.qwenWeb2ControlPrompt())
```

Neu prompt `qwen.web2.control` khong rong, du an them mot message system vao dau danh sach:

```json
{"role": "system", "content": "<control prompt>"}
```

Prompt nay co the cau hinh qua:

- env cu: `QWEN_WEB2_CONTROL_PROMPT`
- env moi: `PROMPT_OVERRIDES_JSON`
- Admin API/UI: `/api/prompts`, `/api/setQwenWeb2ControlPrompt`

### 5.2 OpenAI tool prompt injection

File: `internal/toolcall/toolcall.go`.

`prepareChatRequest` tiep tuc goi:

```go
injection := toolcall.InjectPromptWithOverrides(messages, payload.Tools, payload.ToolChoice, h.promptOverrides())
```

Neu request khong co tools hop le, ham chi normalize tool messages va khong inject tool prompt.

Neu co tools:

1. Normalize schema tool bang `normalizeToolSchemas`.
2. Lay danh sach tool name.
3. Parse `tool_choice` bang `parseToolChoicePolicy`.
4. Neu `tool_choice = "none"` thi khong inject prompt, nhung van tra `ToolNames`.
5. Tao `tool_details`: name, description, parameters JSON.
6. Render prompt tong `openai.toolcall.prompt`.
7. Neu da co system message thi append prompt vao system do.
8. Neu chua co system message thi chen system message moi vao dau.
9. Them reminder vao message non-system gan cuoi nhat.

Prompt mac dinh co dang:

```text
You have access to these tools:

{{tool_details}}
{{instructions}}
```

`{{instructions}}` ep model:

- Bo qua native/platform tools.
- Chi duoc dung tool name duoc liet ke.
- Khi goi tool thi output XML duy nhat.
- Khong output JSON function_call.
- Dung tag `ml_tool_calls`, `ml_tool_call`, `ml_tool_name`, `ml_parameters`.
- Neu khong goi tool thi tra loi binh thuong.

Reminder duoc chen vao truoc noi dung cua message gan cuoi:

```text
[ml_tool reminder]
Ignore built-in/native/platform tools.
Allowed ml_tool names: ...
...
```

Muc dich cua reminder la tang xac suat model tuan thu protocol trong turn hien tai, dac biet khi context dai.

## 6. Protocol XML tool call noi bo

Du an ep model output XML theo schema:

```xml
<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>TOOL_NAME_HERE</ml_tool_name>
    <ml_parameters>
      <ARG_NAME><![CDATA[ARG_VALUE]]></ARG_NAME>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>
```

Vi du:

```xml
<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>search</ml_tool_name>
    <ml_parameters>
      <query><![CDATA[golang]]></query>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>
```

Parser van chap nhan mot so legacy tag:

- `tool_calls`
- `tool_call`
- `tool_name`
- `parameters`

Nhung prompt lai yeu cau model khong dung legacy tag. Day la chien luoc tot: prompt nghiem ngat, parser khoan dung.

## 7. Normalize message khi co tool history

File: `internal/toolcall/toolcall.go`.

`normalizeToolMessages` xu ly lich su OpenAI tools:

### Multiple system messages

Tat ca system message duoc gom lai thanh mot system message duy nhat o dau, ngan cach bang hai newline.

### Assistant tool calls cu

Neu message assistant co `tool_calls`, du an chuyen thanh text XML va append vao content assistant.

OpenAI assistant:

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_1",
      "type": "function",
      "function": {
        "name": "search",
        "arguments": "{\"query\":\"golang\"}"
      }
    }
  ]
}
```

Noi bo gui cho Qwen:

```text
<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>search</ml_tool_name>
    <ml_parameters>
      <query><![CDATA[golang]]></query>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>
```

### Tool result

Message role `tool` duoc doi thanh role `user`, content la:

```xml
<ml_tool_result>
  <ml_tool_name>tool</ml_tool_name>
  <ml_tool_call_id>call_1</ml_tool_call_id>
  <content><![CDATA[...tool output...]]></content>
</ml_tool_result>
```

Ly do: Qwen upstream khong hieu role `tool`, nen proxy bọc tool result thanh text de model tiep tuc suy luan.

## 8. Chuyen message sang Qwen upstream

File: `internal/openai/handler.go`.

Sau khi inject prompt, `prepareChatRequest` goi:

```go
fullUpstreamMessages := normalizeMessages(cloneMessageList(expandedMessages), chatType, thinkingMode)
```

`normalizeMessages` khong gui nguyen list OpenAI messages len Qwen. No dong goi lai thanh mot message user duy nhat phu hop Qwen Web2:

- Neu chi co mot conversation message: neu co system thi prefix `system:<system>\n\n`.
- Neu co nhieu message: tao transcript dang `role:content;role:content;...`, message cuoi van la latest turn.
- Gan `chat_type`, `extra`, `feature_config`.

Vi du noi bo:

```json
[
  {"role":"system","content":"You are helpful"},
  {"role":"user","content":"hello"}
]
```

Co the thanh upstream:

```json
[
  {
    "role": "user",
    "content": "system:You are helpful\n\nhello",
    "chat_type": "t2t",
    "extra": {},
    "feature_config": {
      "thinking_enabled": false,
      "output_schema": "phase",
      "research_mode": "normal",
      "auto_thinking": false,
      "auto_search": true,
      "thinking_mode": "Fast"
    }
  }
]
```

## 9. Parse tool call non-stream

File: `internal/openai/chat_execution.go`.

`readCompletedChat` doc toan bo response upstream:

1. Parse content bang `parseChatCompletionContent`.
2. Neu request co `toolNames`, goi `toolcall.ParseCalls(fullContent)`.
3. Neu parse duoc calls, clean visible text bang `toolcall.CleanVisibleText`.
4. Dat `finishReason = "tool_calls"`.
5. Neu khong co tool call, `finishReason = "stop"`.

OpenAI non-stream response:

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "index": 0,
            "id": "call_<random>",
            "type": "function",
            "function": {
              "name": "search",
              "arguments": "{\"query\":\"golang\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

Anthropic non-stream response:

```json
{
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_<message>_0",
      "name": "search",
      "input": {"query": "golang"}
    }
  ],
  "stop_reason": "tool_use"
}
```

## 10. Parse tool call streaming

File: `internal/toolcall/toolcall.go` va `internal/openai/handler.go`.

`handleStream` doc tung SSE `data:` cua Qwen. Neu request co tools:

1. Lay `delta.content`.
2. Dua content vao `toolcall.ProcessStreamChunk`.
3. Ham nay giu state gom `pending`, `capturing`, `captureBuff`.
4. Neu chua thay marker `<ml_tool_calls` thi emit text binh thuong.
5. Neu thay marker tool call, no bat dau capture va tam thoi khong leak XML ra client.
6. Khi gap close tag hop le, parse XML thanh `ToolCall`.
7. Emit OpenAI delta `tool_calls`.
8. Cuoi stream goi `FinalizeStream` de xu ly phan con lai.

OpenAI stream khi co tool:

```text
data: {"choices":[{"delta":{"tool_calls":[...]}, "finish_reason":null}]}

data: {"choices":[{"delta":{}, "finish_reason":"tool_calls"}]}

data: {"choices":[],"usage":{...}}

data: [DONE]
```

Anthropic stream khi co tool:

```text
event: message_start
data: {"type":"message_start",...}

event: content_block_start
data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_...","name":"search","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"query\":\"golang\"}"}}

event: content_block_stop
data: {"type":"content_block_stop",...}

event: message_delta
data: {"delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":...}}

event: message_stop
data: {"type":"message_stop"}
```

## 11. Format output tool call

### OpenAI

`toolcall.FormatOpenAIToolCalls` tao:

```json
{
  "index": 0,
  "id": "call_<random_hex>",
  "type": "function",
  "function": {
    "name": "<tool_name>",
    "arguments": "<json-string>"
  }
}
```

`arguments` bat buoc la JSON string, khong phai object.

### Anthropic

`anthropicContentFromResult` tao block:

```json
{
  "type": "tool_use",
  "id": "toolu_<message_id>_<index>",
  "name": "<tool_name>",
  "input": {}
}
```

Trong stream, du an emit `input_json_delta.partial_json` la JSON string cua input.

## 12. Cach du an loc markup va leak

`toolcall.CleanVisibleText` va `CleanVisibleChunk` xoa:

- XML tool block hoan chinh.
- Residual tag nhu `</ml_tool_calls>`.
- Mot so cau leak thuong gap nhu "tool resources exhausted", "直接聊天", "无法访问该链接".

Day la phan rat quan trong khi dung prompt-based tool calling. Model co the output sai hoac leak tag; proxy phai co bo loc truoc khi tra ve client.

## 13. Cau hinh prompt va hot reload

Tat ca prompt co ID trong `internal/prompts/prompts.go`.

Nhung ID lien quan truc tiep:

- `qwen.web2.control`
- `openai.toolcall.prompt`
- `openai.toolcall.instructions`
- `openai.toolcall.reminder`
- `anthropic.response_format.json_object`
- `anthropic.response_format.json_schema`
- `anthropic.response_format.json_schema_fallback`

Prompt override duoc load tu env `PROMPT_OVERRIDES_JSON`.

Admin API:

- `GET /api/prompts`: lay danh sach prompt, gia tri default va override.
- `POST /api/prompts`: set override.
- `POST /api/prompts/reset`: reset override.

Khi update qua admin, du an ghi lai vao `.env` va update runtime config, khong can restart.

## 14. Nhung diem thiet ke dang hoc theo

### 14.1 Dung mot representation noi bo

Du an khong viet hai pipeline rieng cho OpenAI va Anthropic. Anthropic duoc convert ve `executedChatRequest`, sau do dung chung:

- prompt injection
- Qwen upstream request
- parser tool XML
- session reuse
- token fallback

Khi lam du an rieng, nen tao mot struct noi bo kieu:

```go
type ChatRequestInternal struct {
    Model       string
    Messages    []Message
    Tools       []Tool
    ToolChoice  ToolChoice
    Stream      bool
    Thinking    ThinkingOptions
    Metadata    map[string]any
}
```

Roi viet adapter:

- `OpenAIToInternal`
- `AnthropicToInternal`
- `InternalToOpenAIResponse`
- `InternalToAnthropicResponse`

### 14.2 Prompt nghiem ngat, parser khoan dung

Prompt chi cho phep `ml_tool_*`, nhung parser chap nhan ca `tool_*`. Cach nay giam output sai trong case binh thuong, nhung van recover duoc khi model lam sai.

### 14.3 Tool result phai quay lai model bang text

Neu upstream khong ho tro native role `tool`, dung wrapper text nhu:

```xml
<ml_tool_result>
  <ml_tool_name>...</ml_tool_name>
  <ml_tool_call_id>...</ml_tool_call_id>
  <content><![CDATA[...]]></content>
</ml_tool_result>
```

Sau do prompt can noi ro: neu da co `<ml_tool_result>`, hay dung ket qua de tiep tuc.

### 14.4 Streaming phai co state machine

Khong nen parse tung chunk doc lap. Tool XML co the bi cat o giua tag. Can state:

- pending suffix de bat dau marker bi split, vi du chunk 1 `<ml_`, chunk 2 `tool_calls>`.
- capture buffer den khi gap close tag.
- fallback neu model bat dau tag sai roi tra loi text binh thuong.
- finalize cuoi stream.

## 15. Huong dan trien khai cho du an cua ban

### Buoc 1: Tao model noi bo

Can co cac type toi thieu:

```go
type Message struct {
    Role       string
    Content    any
    ToolCallID string
    ToolCalls  []ToolCall
}

type Tool struct {
    Name        string
    Description string
    Parameters  map[string]any
}

type ToolChoice struct {
    Mode string // auto, none, required, specific
    Name string
}

type ToolCall struct {
    ID    string
    Name  string
    Input map[string]any
}
```

Khong de OpenAI/Anthropic structs chay sau vao core business logic.

### Buoc 2: Viet adapter input OpenAI

Can ho tro:

- `messages[].role`: system, user, assistant, tool
- `messages[].content`: string hoac array content blocks
- `tools[].function.name`
- `tools[].function.description`
- `tools[].function.parameters`
- `tool_choice`: `none`, `auto`, `required`, hoac object function

Sau khi parse, normalize:

- merge system messages
- assistant `tool_calls` -> internal `ToolCall`
- role `tool` -> internal tool result message

### Buoc 3: Viet adapter input Anthropic

Can ho tro:

- top-level `system`
- `messages[].content` string hoac content blocks
- content block `text`, `image`, `image_url`, `tool_result`
- `tools[].name`, `description`, `input_schema`
- `tool_choice.type`: `auto`, `none`, `any`, `required`, `tool`

Map sang internal:

- Anthropic system -> internal system message
- Anthropic image base64 -> data URI hoac upload truoc neu upstream yeu cau URL
- Anthropic `tool_result.tool_use_id` -> internal tool result
- Anthropic tools -> internal tools

### Buoc 4: Inject prompt tool calling

Neu upstream cua ban khong co native tool calling, chen system prompt:

```text
You have access to these tools:

Tool: search
Description: Search documents
Parameters: {"type":"object","properties":{"query":{"type":"string"}}}

When you call a tool, output XML only:
<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>TOOL_NAME</ml_tool_name>
    <ml_parameters>
      <ARG><![CDATA[VALUE]]></ARG>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>

If you are not calling a tool, answer normally.
```

Nen them reminder vao latest user message:

```text
[ml_tool reminder]
Allowed ml_tool names: search, read_file.
If calling a tool, output only complete <ml_tool_calls> XML.
```

Neu co `tool_choice=required`, doi mode line thanh "You must call one listed tool before the final answer."

Neu co specific tool, doi thanh "You must call tool X."

### Buoc 5: Chuyen history tool ve text cho upstream

Neu upstream khong hieu role tool:

- Assistant tool call cu -> XML `<ml_tool_calls>`.
- Tool result -> XML `<ml_tool_result>`.

Vi vay model co context day du de tiep tuc sau khi tool duoc client thuc thi.

### Buoc 6: Parse non-stream response

Can ham:

```go
func ParseToolCalls(text string) []ToolCall
func RemoveToolMarkup(text string) string
```

Regex toi thieu:

- Tim wrapper `<ml_tool_calls>...</ml_tool_calls>`
- Tim tung `<ml_tool_call>...</ml_tool_call>`
- Lay `<ml_tool_name>...</ml_tool_name>`
- Lay `<ml_parameters>...</ml_parameters>`
- Lay tung tag con lam key, CDATA/text lam value

Sau khi parse duoc:

- OpenAI `finish_reason = "tool_calls"`
- Anthropic `stop_reason = "tool_use"`
- Content visible phai xoa XML.

### Buoc 7: Parse stream response bang state machine

Can state:

```go
type StreamState struct {
    pending string
    capturing bool
    captureBuffer string
}
```

Logic:

1. Append chunk vao pending.
2. Neu thay prefix marker `<ml_tool_calls` thi emit text truoc marker, sau do bat dau capture.
3. Khi capture, tiep tuc gom den close tag.
4. Khi du XML day du, parse calls va emit tool delta.
5. Giu lai suffix marker bi split de khong leak nua tag.
6. Finalize cuoi stream.

Day la phan nen co test ky vi streaming hay bi cat tag o bat ky byte nao, ke ca UTF-8.

### Buoc 8: Render response OpenAI

Non-stream:

```json
{
  "id": "chatcmpl_x",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_x",
            "type": "function",
            "function": {
              "name": "search",
              "arguments": "{\"query\":\"golang\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

Stream:

- Emit text chunks bang `delta.content`.
- Emit tool bang `delta.tool_calls`.
- Emit final chunk voi `finish_reason: "tool_calls"` neu co tool, nguoc lai `"stop"`.
- Ket thuc bang `data: [DONE]`.

### Buoc 9: Render response Anthropic

Non-stream:

```json
{
  "id": "msg_x",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_x_0",
      "name": "search",
      "input": {"query": "golang"}
    }
  ],
  "stop_reason": "tool_use",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 3
  }
}
```

Stream:

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

Voi text thi dung `text_delta`. Voi tool input thi dung `input_json_delta.partial_json`.

### Buoc 10: Them cau hinh prompt override

Nen co bang prompt definitions:

```go
type PromptDefinition struct {
    ID           string
    DefaultValue string
    Placeholders []string
}
```

Va runtime override:

- Load tu env JSON.
- Co API admin de xem/set/reset.
- Normalize: neu override rong thi xoa de quay ve default.

Nhung prompt nen tach rieng:

- tool outer prompt
- tool XML instructions
- latest-message reminder
- response_format JSON object
- response_format JSON schema
- upstream control prompt

### Buoc 11: Viet test bat buoc

Nen co test cho:

- OpenAI tools -> injected prompt co tool details.
- `tool_choice=none` khong inject.
- `tool_choice=required` co mode line bat buoc.
- Assistant `tool_calls` history -> XML.
- Role `tool` -> `<ml_tool_result>`.
- Parse XML tool call non-stream.
- Clean XML de khong leak ra content.
- Stream marker bi split: `<ml` + `_tool_calls>`.
- Stream close tag bi split.
- UTF-8 boundary trong stream.
- Anthropic tools -> OpenAI/internal tools.
- Anthropic `tool_result` -> internal tool result.
- Anthropic non-stream tool -> `tool_use`.
- Anthropic stream tool -> dung SSE event Anthropic, khong leak OpenAI chunk.

## 16. Checklist trien khai nhanh

- [ ] Tao internal chat representation.
- [ ] Viet OpenAI input adapter.
- [ ] Viet Anthropic input adapter.
- [ ] Viet prompt renderer co override.
- [ ] Inject upstream control prompt.
- [ ] Inject tool prompt va latest-message reminder.
- [ ] Convert tool history thanh XML text.
- [ ] Build upstream request tu internal messages.
- [ ] Parse upstream response non-stream.
- [ ] Parse upstream response stream bang state machine.
- [ ] Render OpenAI response.
- [ ] Render Anthropic response.
- [ ] Them token usage fallback.
- [ ] Them test stream split tag va tool leak.
- [ ] Them admin/env config cho prompt overrides.

## 17. Rủi ro khi áp dụng

Prompt-based tool calling khong bao gio chac chan 100%. Can chap nhan cac rui ro sau:

- Model output XML sai format.
- Model vua output text vua output tool call.
- XML bi split giua stream chunk.
- Model leak instruction hoac tag dong.
- Tham so tool la object/list phuc tap nhung XML tag con chi luu string.
- Ten tham so co ky tu khong hop le voi XML tag.
- Anthropic va OpenAI co semantics khac nhau ve `tool_choice`, `tool_result`, stream events.

Cach giam rui ro:

- Prompt chat che.
- Parser khoan dung.
- Clean visible output.
- Test stream nhieu edge case.
- Neu upstream co native tool calling that su, uu tien native tool calling hon prompt XML.

## 18. Ket luan

Du an nay ho tro OpenAI va Anthropic bang cach dua tat ca request ve mot pipeline noi bo chung. Tool call duoc gia lap bang XML prompt protocol, sau do proxy parse XML va render lai thanh `tool_calls` cua OpenAI hoac `tool_use` cua Anthropic.

Phan can sao chep nhat cho du an khac la:

- Adapter input rieng cho tung public API.
- Representation noi bo chung.
- Prompt injection co override.
- XML/action protocol ro rang cho upstream khong co native tool.
- Parser streaming co state.
- Response renderer rieng cho OpenAI va Anthropic.

Neu lam dung cac lop nay, ban co the them format API moi ma khong phai viet lai toan bo core chat pipeline.
