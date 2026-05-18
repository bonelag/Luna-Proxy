# Plan mới: Hoàn thiện Runtime Orchestrator, Scheduler, Session Binding và IP Isolation

## 0. Mục tiêu của plan này

Plan cũ đã được triển khai một phần, nhưng còn nhiều phần chỉ là khung API/module và chưa được nối vào request path chính. Plan mới này thay thế plan cũ và tập trung vào việc đưa hệ thống về trạng thái thật sự chạy được theo các tiêu chí ban đầu:

- Mỗi request có lifecycle rõ ràng qua `RunContext`.
- Scheduler có queue thật, capacity thật, lock thật.
- Cùng upstream provider chat không bao giờ bị POST đồng thời.
- Một provider duy nhất vẫn xử lý được nhiều request/subagent song song khi khác provider chat.
- Session không còn phụ thuộc vào một field `providerSessionId` duy nhất.
- Provider/account router được dùng trong route chính.
- IP isolation strict thật sự chặn direct upstream call khi không có worker hợp lệ.
- Cancel run thật sự abort upstream request/worker request.
- UI/API diagnostics phản ánh đúng runtime state.

## 1. Hiện trạng đã xác nhận

### 1.1 Đã có nhưng chưa đủ

Các phần sau đã tồn tại:

- `src/runtime/types.ts`
- `src/runtime/runStore.ts`
- `src/runtime/locks.ts`
- `src/runtime/scheduler.ts`
- `src/runtime/providerRouter.ts`
- `src/runtime/providerFactory.ts`
- `src/runtime/workerClient.ts`
- `src/runtime/networkProfiles.ts`
- Settings cho `multiThread` và `egressIsolation`
- API cơ bản cho runs/workers/network profiles
- UI pages: Runs, Network, Settings
- Session model có `providerBindings?` và `activeRunIds?`

Nhưng nhiều phần chưa được nối vào đường chạy chính `/v1/chat/completions`.

### 1.2 Lỗi logic quan trọng hiện tại

1. `src/server.ts` đang dùng `sanitizerMeta` không tồn tại trong `addRunRecord`.
   - Vì file có `// @ts-nocheck`, typecheck không báo.
   - Runtime error bị nuốt bởi `catch {}`.
   - Hậu quả: run có thể không completed/failed, activeRunIds không được remove, scheduler capacity không được release.

2. `scheduleRun(currentRun)` được gọi trước khi biết `providerSessionId/chatId`.
   - Provider chat lock không thể hoạt động.
   - Hai request cùng Qwen chat vẫn có thể POST đồng thời.

3. `currentRun` không có `accountId`.
   - Account capacity không hoạt động.

4. Scheduler capacity hiện trả fail ngay khi full.
   - Chưa có queue chờ đến `queueTimeoutMs`.

5. Route chính vẫn hard-code `qwen-ai`.
   - `selectProvider`, `selectAccount`, `createAdapter`, `WorkerClient` chưa được dùng.

6. `egressIsolation.enabled=true` không ảnh hưởng route chính.
   - Strict mode không chặn direct call.

7. Cancel run chỉ update status và release lock.
   - Không abort upstream stream.
   - Có nguy cơ double-release capacity nếu request vẫn tiếp tục chạy.

8. Provider binding chưa được dùng để allocate chat.
   - Route vẫn dùng `currentSession.providerSessionId`.

9. UI gọi endpoint chưa có: `POST /api/network-profiles/:id/verify`.

10. Session write lock từ scheduler được import nhưng chưa dùng ở route chính.

## 2. Nguyên tắc triển khai

### 2.1 Không sửa lan man

Tập trung vào các file:

- `src/server.ts`
- `src/runtime/scheduler.ts`
- `src/runtime/locks.ts`
- `src/runtime/runStore.ts`
- `src/runtime/providerRouter.ts`
- `src/runtime/providerFactory.ts`
- `src/runtime/workerClient.ts`
- `src/runtime/networkProfiles.ts`
- `src/sessionStore.ts`
- `src/configStore.ts`
- `frontend/src/pages/Runs.tsx`
- `frontend/src/pages/Sessions.tsx`
- `frontend/src/pages/NetworkProfiles.tsx`
- tests mới trong `tests/`

Không refactor UI/CSS lớn nếu không cần.

### 2.2 Route chính phải có flow chuẩn

Flow cuối cùng của `/v1/chat/completions` phải là:

```text
1. Parse body/model/messages/stream.
2. Resolve config.
3. Resolve session identity.
4. Build combined messages/history.
5. Apply overflow policy.
6. Select provider.
7. Select account.
8. Resolve provider binding / provider chat purpose.
9. Create run with providerId/accountId/sessionId/providerChatId.
10. Acquire scheduler queue/capacity/chat locks.
11. Execute via direct adapter OR worker based on egressIsolation.
12. Stream/collect response.
13. Persist session messages under session-write lock.
14. Update provider binding if chat changed.
15. Mark run completed/failed/cancelled.
16. Release locks/capacity exactly once.
```

### 2.3 Release phải idempotent

Mọi lock/capacity release phải an toàn khi bị gọi nhiều lần. Request path có nhiều event:

- success
- provider error
- stream end
- stream close
- client disconnect
- run timeout
- cancel endpoint

Không được để capacity âm hoặc release nhầm lock của run khác.

### 2.4 Không khóa toàn bộ session trong provider call

Chỉ khóa:

- capacity global/provider/account/worker
- provider-chat
- session-binding mutation
- session-write persist

Không khóa session trong lúc stream provider, vì sẽ làm mất multi-thread.

## 3. Phase 1: Sửa lifecycle blocker và release safety

### 3.1 Mục tiêu

Trước khi triển khai scheduler sâu hơn, phải đảm bảo run không bị kẹt active vì lỗi runtime hoặc release thiếu.

### 3.2 Việc cần làm

#### 3.2.1 Sửa `addRunRecord`

File: `src/server.ts`

Hiện tại có logic sai:

```ts
providerChatId: sanitizerMeta?.fileBackedSessionId as string | undefined
```

Sửa thành:

- Không dùng `sanitizerMeta` free variable.
- Không dùng file-backed session id làm `providerChatId`.
- Nhận `providerChatId` từ biến thật `chatId`.
- Nhận `overflowResult.sanitizerMeta?.fileBackedSessionId` nếu cần log riêng là `fileBackedSessionId`.

Gợi ý shape:

```ts
const finalizeRun = async (status: 'completed' | 'failed' | 'cancelled', extra?: {
  error?: string;
  providerChatId?: string;
  fileBackedSessionId?: string;
}) => {
  if (finalized) return;
  finalized = true;
  runStore.updateRun(currentRun.id, {
    status,
    error: extra?.error,
    providerChatId: extra?.providerChatId ?? currentRun.providerChatId,
  });
  if (currentSession?.id) sessionStore.removeActiveRunId(currentSession.id, currentRun.id);
  await releaseRun(currentRun.id);
};
```

Lưu ý: sau Phase 1 có thể cần đổi `releaseRun` nhận `runId` thay vì object snapshot.

#### 3.2.2 Không nuốt lỗi release

Các `catch {}` quanh finalize/release phải đổi thành log tối thiểu:

```ts
catch (err) {
  console.warn('[Runtime] finalizeRun failed', currentRun.id, err);
}
```

Không log token/cookie.

#### 3.2.3 Mark streaming đúng lúc

Hiện run status có thể ở `routing` trong lúc stream.

Khi upstream response đã có và trước khi trả stream:

```ts
runStore.updateRun(currentRun.id, { status: 'streaming', startedAt: Date.now() });
```

Non-stream cũng cần set `streaming` hoặc thêm status trung gian. Đơn giản Phase 1:

- Sau scheduler acquired: `routing`.
- Trước call provider: `routing`.
- Khi provider response bắt đầu: `streaming`.
- Khi xong: `completed`.

#### 3.2.4 Release khi client disconnect

Với stream:

- listen `ctx.req.on('close')`
- nếu response chưa completed, abort upstream nếu có AbortController
- finalize `cancelled` hoặc `failed` tùy trạng thái

Tạm Phase 1 chưa cần abort provider nếu chưa có controller, nhưng phải finalize/release.

### 3.3 Acceptance

- Request success tạo run `completed`.
- Request error tạo run `failed`.
- Stream close không để active run kẹt.
- `activeRunIds` được remove.
- Runtime diagnostics không còn capacity kẹt sau request.

### 3.4 Test

Thêm test đơn vị cho finalize/release nếu tách helper ra module riêng. Nếu chưa tách được, thêm integration nhẹ bằng mocked adapter sau Phase 3.

## 4. Phase 2: Làm scheduler queue thật và release idempotent

### 4.1 Mục tiêu

Scheduler phải queue thay vì fail ngay khi capacity full.

### 4.2 Thiết kế mới cho `LockManager`

File: `src/runtime/locks.ts`

Cần thêm queue FIFO cho capacity:

```ts
interface CapacityState {
  active: number;
  max: number;
  waiters: Array<{
    resolve: (ok: boolean) => void;
    timer?: ReturnType<typeof setTimeout>;
    runId?: string;
    reason?: string;
  }>;
}
```

API đề xuất:

```ts
async acquireCapacityQueued(
  key: string,
  max: number,
  timeoutMs: number,
  meta?: { runId?: string; reason?: string }
): Promise<boolean>

releaseCapacity(key: string): void
```

Behavior:

- Nếu active < max: active++, return true.
- Nếu full: push waiter.
- Khi release: active-- rồi wake waiter đầu tiên nếu còn capacity.
- Timeout: remove waiter, return false.
- Không để active âm.

### 4.3 Lock provider-chat cũng cần owner token

Hiện lock chỉ theo key, release key có thể release nhầm nếu cancel double path.

Thêm owner:

```ts
interface LockHandle {
  key: string;
  ownerId: string;
  release: () => void;
}
```

API:

```ts
async acquireLock(key: string, ownerId: string, timeoutMs?: number): Promise<LockHandle | null>
```

Nếu chưa muốn đổi lớn, ít nhất phải bảo đảm `releaseRun` chỉ release những lock mà run đã acquire.

### 4.4 Runtime leases trong scheduler

File: `src/runtime/scheduler.ts`

Thêm map:

```ts
interface RunLease {
  runId: string;
  capacityKeys: string[];
  lockKeys: string[];
  released: boolean;
}

const leases = new Map<string, RunLease>();
```

`scheduleRun(run, providerChatId)` sau khi acquire thành công lưu lease.

`releaseRun(runId)`:

- đọc lease theo runId
- nếu không có hoặc released=true thì return
- release lockKeys/capacityKeys
- set released=true
- clear timeout

Không dựa vào object `RunContext` snapshot cũ.

### 4.5 Status khi queue

Trong lúc chờ capacity:

- run status: `queued`
- set `queueReason`

Khi qua capacity:

- status: `routing`

Với provider chat:

- status: `waiting_provider_chat`
- queueReason: `provider_chat_busy`

### 4.6 Acceptance

- Với `globalMaxConcurrentRuns=1`, request thứ 2 chờ thay vì fail ngay.
- Nếu request 1 xong trước timeout, request 2 chạy.
- Nếu request 1 không xong trước `queueTimeoutMs`, request 2 fail có kiểm soát.
- Release double không làm capacity âm.

### 4.7 Tests

Thêm `tests/runtimeScheduler.test.ts`:

1. capacity FIFO:
   - max=1
   - acquire run A
   - run B pending
   - release A
   - B acquired

2. queue timeout:
   - max=1
   - acquire A
   - B timeout 50ms
   - B returns false

3. idempotent release:
   - acquire A
   - release A twice
   - snapshot capacity = 0

4. provider chat lock:
   - same chat serializes
   - different chat parallel

## 5. Phase 3: Đưa provider/account/chat vào schedule đúng thời điểm

### 5.1 Mục tiêu

Scheduler phải biết đầy đủ:

- providerId
- accountId
- providerChatId
- workerId nếu có

trước khi acquire locks.

### 5.2 Chọn provider

File: `src/server.ts`

Thay hard-code:

```ts
const providerConf = conf.providers.find(p => p.id === 'qwen-ai');
```

bằng:

```ts
const availableProviderIds = conf.providers.map(p => p.id);
const providerId = selectProvider(model, body, ctx.headers as any, availableProviderIds);
const providerConf = conf.providers.find(p => p.id === providerId);
```

Phase này vẫn chỉ adapter Qwen hoạt động, nhưng route không được hard-code.

Nếu provider không support:

```json
{
  "error": {
    "message": "No adapter available for provider: <providerId>"
  }
}
```

### 5.3 Normalize account config

Hiện config `providers` chỉ có credentials ở provider-level. Plan cũ muốn accounts.

Để backward compatible, tạo helper:

```ts
function getProviderAccounts(providerConf): ProviderAccount[] {
  if (Array.isArray(providerConf.accounts)) return ...
  return [{
    id: providerConf.accountId || 'local',
    providerId: providerConf.id,
    name: providerConf.name || 'local',
    enabled: true,
    credentials: providerConf.credentials || {},
    maxConcurrentRuns: providerConf.maxConcurrentRuns,
    networkProfileId: providerConf.networkProfileId,
  }];
}
```

Cập nhật `ProviderConfig` trong `src/configStore.ts` để có optional:

```ts
accounts?: ProviderAccountConfig[];
maxConcurrentRuns?: number;
networkProfileId?: string;
```

### 5.4 Chọn account

Sửa `selectAccount` để hỗ trợ least-inflight thật:

Input thêm:

```ts
inflightByAccount?: (accountId: string) => number
```

Policy:

1. preferred account từ session binding nếu có.
2. explicit `body.account` hoặc `metadata.account_id` hoặc header `x-luna-account-id`.
3. enabled account có `status !== disabled`.
4. sort by:
   - non-error trước
   - inflight thấp trước
   - stable id/name

### 5.5 Resolve provider chat trước schedule

Route hiện đang lấy:

```ts
let providerSessionId = currentSession?.providerSessionId;
```

Sửa thành helper:

```ts
async function resolveProviderBindingForRun(params): Promise<{
  purpose: ProviderBinding['purpose'];
  providerSessionId?: string;
  binding?: ProviderBinding;
}>
```

Policy Phase 3:

- Nếu request có explicit `body.providerSessionId` hoặc `body.provider_session_id` hoặc header `x-luna-provider-session-id`:
  - dùng id đó
  - purpose `main`
  - bắt buộc provider-chat lock.

- Nếu có persistent session:
  - lấy binding `providerId + accountId + purpose=main`
  - fallback legacy `currentSession.providerSessionId`
  - nếu chưa có chat thì để undefined, adapter sẽ create chat.

- Nếu không có session:
  - stateless run, no providerChatId trước call.
  - adapter create chat riêng.

Ghi chú: nếu chưa có `providerChatId` trước call, không có chat lock cần acquire. Khi adapter tạo chat mới thì không conflict với run khác.

### 5.6 Update run trước schedule

Tạo run sau khi đã có provider/account/binding:

```ts
const currentRun = runStore.createRun({
  providerId,
  accountId: account.id,
  providerChatId: providerSessionId,
  model,
  stream,
  sessionId: currentSession?.id,
  activeTaskPreview: promptPreview,
  status: 'queued',
});
```

Sau đó:

```ts
const scheduleResult = await scheduleRun(currentRun, providerSessionId);
```

### 5.7 Acceptance

- Run record có `accountId`.
- Request cùng explicit provider session id bị serialize.
- Request khác provider session id chạy song song theo capacity.
- Provider capacity hoạt động.
- Account capacity hoạt động.

### 5.8 Tests

Thêm tests cho helper provider/account selection.

Nếu khó mock route nguyên khối, tách các helper ra file:

- `src/runtime/accounts.ts`
- `src/runtime/providerBinding.ts`

rồi test trực tiếp.

## 6. Phase 4: Provider bindings đúng nghĩa

### 6.1 Mục tiêu

Session không còn chỉ có một `providerSessionId`.

### 6.2 Cập nhật SessionStore

File: `src/sessionStore.ts`

Các method mới:

```ts
withProviderBindingLock<T>(sessionId: string, fn: () => Promise<T> | T): Promise<T>

getProviderBinding(
  sessionId: string,
  providerId: string,
  accountId: string,
  purpose: ProviderBinding['purpose']
): ProviderBinding | undefined

upsertProviderBinding(
  sessionId: string,
  binding: ProviderBinding
): Promise<void>
```

Hiện đã có `addProviderBinding` sync, nhưng cần:

- async lock
- update `updatedAt`
- backward compatible update legacy `providerSessionId` nếu `purpose=main`

### 6.3 Binding purpose policy

Phase 4 policy:

- `main`: persistent session normal chat.
- `overflow`: overflow/file parsing chat nếu muốn tách khỏi main.
- `compact`: compact session chat.
- `stateless`: không persist binding.
- `subagent`: chỉ dùng nếu client gửi metadata rõ ràng:
  - `body.metadata.subagent_id`
  - `body.metadata.agent_id`
  - header `x-luna-subagent-id`

Không dùng heuristic phức tạp trong Phase 4 để tránh sai.

### 6.4 Khi adapter tạo chat mới

Sau:

```ts
const { response, chatId } = await adapter.chatCompletion(...)
```

Nếu có session và purpose không phải `stateless`:

```ts
await sessionStore.upsertProviderBinding(session.id, {
  providerId,
  accountId: account.id,
  providerSessionId: chatId,
  purpose,
  workerId,
  createdAt: existing?.createdAt ?? Date.now(),
  updatedAt: Date.now(),
});
```

### 6.5 Reset provider

Endpoint `POST /api/sessions/:id/reset-provider` phải:

- clear legacy `providerSessionId`
- clear `providerBindings`
- hoặc support body `{purpose}` để clear một purpose

Phase 4 đơn giản: clear tất cả provider bindings.

### 6.6 UI Sessions

File: `frontend/src/pages/Sessions.tsx`

Detail phải hiển thị:

- activeRunIds
- providerBindings table:
  - providerId
  - accountId
  - purpose
  - providerSessionId
  - workerId
  - updatedAt

List vẫn có thể hiển thị legacy main chat.

### 6.7 Acceptance

- Session detail thấy provider bindings.
- Main request update `purpose=main`.
- Subagent metadata tạo/ghi `purpose=subagent`.
- Reset provider xóa bindings.

## 7. Phase 5: Session history write serialization và metadata

### 7.1 Mục tiêu

Ghi session history không bị lẫn metadata, có trace run/provider/account.

### 7.2 Cập nhật SessionMessage

File: `src/sessionStore.ts`

Thêm:

```ts
runId?: string;
providerId?: string;
accountId?: string;
workerId?: string;
providerSessionId?: string;
```

### 7.3 Sửa `persistSessionMessages`

File: `src/server.ts`

Thêm params:

```ts
private async persistSessionMessages(
  sessionId: string,
  incomingMessages: any[],
  response: any,
  overflowResult: ...,
  meta: {
    runId: string;
    providerId: string;
    accountId?: string;
    workerId?: string;
    providerSessionId?: string;
  }
)
```

Bọc bằng:

```ts
await acquireSessionWriteLock(sessionId);
try {
  ...
  await sessionStore.appendMessages(sessionId, sessionMessages);
} finally {
  releaseSessionWriteLock(sessionId);
}
```

Lưu ý: `sessionStore.appendMessages` đã có lock nội bộ, nhưng scheduler-level lock giúp thống nhất diagnostics và policy.

### 7.4 Không build history trong lock dài

Đọc history trước call provider có thể vẫn race nhẹ. Phase 5 chấp nhận completion order, nhưng persist phải serialize.

Phase sau nếu muốn strict order hơn, thêm `acceptedSequence`.

### 7.5 Acceptance

- 2 request cùng session hoàn tất đồng thời không corrupt session.
- Message persisted có `runId/providerId/accountId`.
- Diagnostics session hiển thị active run đúng.

## 8. Phase 6: IP isolation strict thật sự

### 8.1 Mục tiêu

Khi `egressIsolation.enabled=true` và `strict=true`, route chính không được gọi direct adapter nếu không có worker verified hợp lệ.

### 8.2 Worker selection helper

Tạo file:

```text
src/runtime/workerSelector.ts
```

API:

```ts
interface SelectWorkerParams {
  providerId: string;
  accountId?: string;
  networkProfileId?: string;
  workers: ProviderWorker[];
  requireVerified: boolean;
  directIp?: string;
}

function selectWorker(params): ProviderWorker | undefined
```

Policy:

1. enabled worker.
2. matching providerId.
3. accountId exact match nếu worker có accountId.
4. matching networkProfile nếu account yêu cầu.
5. status healthy.
6. nếu requireVerified:
   - lastVerifiedIp tồn tại.
   - nếu expectedIp có, phải match.
   - lastVerifiedAt không quá TTL, ví dụ 10 phút.
7. least inflight worker.

### 8.3 Route execution mode

Trong route:

```ts
const egress = conf.settings?.egressIsolation || {};
const isolationEnabled = egress.enabled === true;

if (isolationEnabled) {
  const worker = selectWorker(...);
  if (!worker) {
    if (egress.strict !== false || !egress.fallbackToDirect) {
      fail 503 without direct call
    }
    log warning fallback direct
  } else {
    execute via worker
  }
} else {
  execute direct
}
```

### 8.4 Worker capacity

Scheduler phải support worker capacity:

Lock key:

```text
worker:{workerId}
```

Nếu isolation dùng worker, run phải có:

- `workerId`
- `networkProfileId`
- `outboundIp` sau verify hoặc response header

### 8.5 Worker forwarding

File: `src/runtime/workerClient.ts`

`forwardChatCompletion` cần forward headers an toàn:

- Content-Type
- Authorization nếu worker cần internal auth sau này
- x-luna-run-id
- x-luna-provider-id
- x-luna-account-id

Không forward Qwen cookies/token từ orchestrator nếu worker tự giữ credential. Nếu Phase 6 worker chưa có credential store, có thể forward payload internal, nhưng phải ghi rõ là temporary và không log.

### 8.6 Missing worker service

Plan cũ có worker service nhưng repo hiện chưa có:

```text
src/worker/server.ts
src/worker/dev.ts
```

Phase 6 có hai lựa chọn:

#### Option A: Chỉ client strict gate trước

- Không build worker service ngay.
- Khi bật strict mà không có worker healthy: fail an toàn.
- Acceptance strict no worker đạt.

#### Option B: Build minimal worker service

Implement:

```text
GET  /health
GET  /egress-ip
POST /v1/chat/completions
POST /runs/:runId/cancel
```

Worker dùng lại Qwen adapter.

Khuyến nghị: làm Option A trước, Option B sau khi direct orchestrator ổn.

### 8.7 Verify endpoints

Server đang thiếu:

```text
POST /api/network-profiles/:id/verify
```

Implement:

- direct profile: call `verifyDirectIp(profile.verifyIpUrl)`
- update `lastVerifiedIp`, `lastVerifiedAt`
- compare expectedIp nếu có
- trả `{profileId, ip, expectedIp, match}`

Worker verify phải:

- gọi `/egress-ip`
- nếu worker expectedIp có thì compare
- nếu directIp known và strict mode, worker IP trùng direct IP thì mark `ip-mismatch` trừ khi expectedIp cũng là direct IP và user cho phép

### 8.8 Acceptance

- `egressIsolation.enabled=false`: direct call vẫn hoạt động.
- `enabled=true strict=true` không worker: request fail 503 trước khi tạo direct adapter/call upstream.
- Worker mismatch IP không được chọn.
- Verified worker được chọn và run có `workerId/networkProfileId/outboundIp`.

## 9. Phase 7: Cancel và timeout đúng nghĩa

### 9.1 Mục tiêu

Cancel phải dừng upstream request nếu có thể, không chỉ đổi trạng thái.

### 9.2 Run controller registry

Tạo file:

```text
src/runtime/runControllers.ts
```

API:

```ts
interface RunController {
  runId: string;
  abortController: AbortController;
  workerClient?: WorkerClient;
  workerRunId?: string;
}

registerRunController(runId, controller): void
abortRun(runId, reason): Promise<boolean>
unregisterRunController(runId): void
```

### 9.3 Direct adapter abort

`QwenAiAdapter.chatCompletion` cần nhận signal nếu axios/fetch support:

```ts
signal?: AbortSignal
```

Pass vào axios request.

### 9.4 Worker abort

If worker mode:

- call `WorkerClient.cancelRun(runId)`
- abort local HTTP request too.

### 9.5 `/api/runs/:id/cancel`

Flow:

```text
1. get run
2. if terminal: return ok already terminal
3. abortRun(runId)
4. update status cancelled
5. releaseRun(runId)
6. remove activeRunIds
```

### 9.6 Timeout

`startRunTimeout` should:

- mark failed timeout
- abort run
- release lease

Do not let original provider response later mark completed. Use finalized flag or run terminal check.

### 9.7 Acceptance

- Cancel streaming run closes client stream.
- Provider request aborts or worker cancel endpoint called.
- Cancelled run cannot later become completed.
- Timeout releases capacity and cannot later become completed.

## 10. Phase 8: Direct adapter factory integration

### 10.1 Mục tiêu

Route chính dùng provider factory, không instantiate Qwen trực tiếp.

### 10.2 Sửa `providerFactory`

File: `src/runtime/providerFactory.ts`

Hiện bỏ qua `networkProfile` và `settings`.

Phase 8:

- vẫn support Qwen.
- pass model mappings.
- pass account credentials.
- nếu direct profile là proxy/local-address chưa support thì reject rõ:

```ts
throw new Error('Network profile mode socks5/http-proxy/local-address is not supported in direct adapter yet');
```

Không âm thầm ignore network profile nếu user cấu hình isolation/direct proxy.

### 10.3 Adapter call interface

Tạo wrapper:

```ts
interface ProviderAdapter {
  chatCompletion(request: any): Promise<{ response: any; chatId?: string }>;
  mapModel?(model: string): string;
}
```

Không nhất thiết refactor class Qwen, chỉ type ở factory.

### 10.4 Acceptance

- Route không `new QwenAiAdapter(...)` trực tiếp trong happy path.
- Debug endpoints có thể vẫn dùng direct Qwen adapter.
- Unsupported provider trả lỗi rõ.

## 11. Phase 9: File-backed session attach vào request chính

### 11.1 Vấn đề hiện tại

`applyTokenOverflowPolicy` có thể tạo file-backed session nhưng route chính vẫn giữ `currentSession` cũ hoặc `null`.

Hậu quả:

- Run không attach đúng file-backed session.
- UI thấy overflow chain nhưng request log stateless.
- Scheduler/session diagnostics sai.

### 11.2 Sửa contract của overflow policy

Đổi return:

```ts
interface OverflowPolicyResult {
  messages: any[];
  fileIds: string[];
  files: any[];
  sanitized?: boolean;
  sanitizerMeta?: Record<string, any>;
  fileBackedSessionId?: string;
}
```

Khi tạo `fbSession`, set:

```ts
returnResult.fileBackedSessionId = fbSession.id
```

### 11.3 Route attach logic

Sau overflow:

```ts
if (!currentSession && overflowResult.fileBackedSessionId) {
  currentSession = sessionStore.getSession(overflowResult.fileBackedSessionId) ?? null;
  sessionMode = 'file-backed';
  sessionResolveReason = 'overflow_file_backed_attached';
}
```

Nếu đã có `currentSession`, append overflow anchor vào chính session đó thay vì tạo session mới:

- thêm optional param vào `applyTokenOverflowPolicy`: `currentSessionId?: string`
- nếu có currentSessionId: `sessionStore.appendOverflowAnchor(currentSessionId, anchor)`
- không tạo file-backed session rời.

### 11.4 Acceptance

- Request overflow không explicit session tạo file-backed session và run gắn vào session đó.
- Request overflow có explicit session append anchor vào session hiện tại, không tạo session rời.
- Sessions UI hiển thị overflow chain đúng.

## 12. Phase 10: UI/API diagnostics hoàn chỉnh

### 12.1 Runs page

File: `frontend/src/pages/Runs.tsx`

Sửa:

- remove duplicate Provider Chat row.
- hiển thị queuedMs:
  - `startedAt - queuedAt`
- hiển thị duration:
  - completedAt - startedAt
- cancel button chỉ active khi status non-terminal.
- refresh interval optional 2s khi có active run.

### 12.2 Sessions page

File: `frontend/src/pages/Sessions.tsx`

Thêm:

- providerBindings table.
- activeRunIds.
- message metadata nếu có detail message view.

### 12.3 Network page

File: `frontend/src/pages/NetworkProfiles.tsx`

Sửa:

- endpoint verify profile phải tồn tại.
- hiển thị verify result/mismatch.
- không show proxy password raw nếu có proxyUrl.

### 12.4 Providers page

Nếu có thời gian:

- hiển thị accounts.
- inflight count theo `lockManager.currentCapacity`.
- assigned workers.

### 12.5 API runtime

`GET /api/runtime` nên trả:

```json
{
  "config": {},
  "locks": {},
  "activeRuns": [],
  "capacity": {},
  "queues": {},
  "workers": []
}
```

Không chỉ count.

## 13. Phase 11: Tests bắt buộc

### 13.1 Unit tests

Tạo:

```text
tests/runtimeLocks.test.ts
tests/runtimeScheduler.test.ts
tests/providerRouter.test.ts
tests/providerBinding.test.ts
tests/egressIsolation.test.ts
```

#### runtimeLocks

- acquire/release capacity.
- queued capacity FIFO.
- timeout removes waiter.
- double release safe.

#### runtimeScheduler

- schedule stores lease.
- release by runId idempotent.
- same providerChat queues.
- different providerChat parallel.
- account capacity works.

#### providerRouter

- body provider wins.
- metadata provider wins.
- header provider wins.
- model rule wins.
- default provider fallback.

#### providerBinding

- main binding upsert.
- subagent binding separate.
- legacy providerSessionId updated only for main.
- reset clears bindings.

#### egressIsolation

- disabled means direct allowed.
- enabled strict no worker means fail before adapter.
- enabled non-strict fallback direct only when `fallbackToDirect=true`.
- worker selected only when healthy/verified.

### 13.2 Integration tests

Nếu route quá khó test do Qwen real upstream, tạo fake adapter/fake worker:

```text
tests/fakes/fakeProviderAdapter.ts
tests/fakes/fakeWorkerServer.ts
```

Test cases:

1. 2 same chat requests:
   - fake adapter delay 100ms
   - assert second starts after first completes.

2. 2 different chat requests:
   - assert overlap start time.

3. capacity max=1:
   - second queued.

4. cancel:
   - start stream
   - cancel run
   - fake adapter receives abort.

5. strict isolation:
   - set enabled true strict true
   - no worker
   - fake direct adapter must not be called.

### 13.3 Existing tests

Giữ pass:

```text
npx ts-node tests/sessionStore.test.ts
npx ts-node tests/overflowSanitizer.test.ts
npm run typecheck
```

Sau khi bỏ dần `// @ts-nocheck`, `npm run typecheck` mới có giá trị hơn.

## 14. Phase 12: Giảm `// @ts-nocheck` ở server

### 14.1 Mục tiêu

`src/server.ts` đang che lỗi thật. Không nhất thiết bỏ ngay toàn bộ, nhưng phải giảm rủi ro.

### 14.2 Cách làm an toàn

1. Tách helper runtime ra file typed:
   - provider/account resolution
   - run finalizer
   - egress selection
   - provider binding

2. Test các helper typed.

3. Khi route chính ít logic hơn, thử bỏ `// @ts-nocheck`.

### 14.3 Không làm trong một bước lớn

Không nên vừa refactor server lớn vừa bỏ ts-nocheck. Làm từng phần để tránh vỡ route.

## 15. Thứ tự triển khai khuyến nghị

### Milestone A: Không kẹt run, lock release đúng

Bao gồm Phase 1 và Phase 2.

Kết quả mong muốn:

- runtime không leak active runs/capacity.
- scheduler có queue thật.
- tests scheduler pass.

### Milestone B: Same chat lock thật sự hoạt động

Bao gồm Phase 3 và Phase 4.

Kết quả mong muốn:

- route tạo run với accountId/providerChatId trước schedule.
- same provider chat serialize.
- different chat parallel.
- provider bindings hoạt động.

### Milestone C: Session persist và overflow attach đúng

Bao gồm Phase 5 và Phase 9.

Kết quả mong muốn:

- messages có run metadata.
- file-backed session gắn với request chính.
- session diagnostics đáng tin.

### Milestone D: IP isolation strict

Bao gồm Phase 6 và Phase 7.

Kết quả mong muốn:

- strict no worker không direct call.
- worker verified được chọn.
- cancel/timeout abort đúng.

### Milestone E: UI và typed cleanup

Bao gồm Phase 8, Phase 10, Phase 11, Phase 12.

Kết quả mong muốn:

- UI/API đồng bộ.
- tests đầy đủ.
- server logic typed hơn.

## 16. Definition of Done cuối cùng

Hoàn thành khi tất cả điều sau đúng:

1. `npm run typecheck` pass.
2. Existing tests pass.
3. Runtime scheduler tests pass.
4. Provider router/binding tests pass.
5. Direct mode:
   - nhiều request khác chat chạy song song theo capacity.
   - same chat queue.
6. Single provider:
   - 1 provider/1 account vẫn xử lý nhiều subagents nếu khác chat.
7. Session:
   - không ghi đè provider chat giữa main/subagent/compact.
   - activeRunIds được cleanup.
   - message metadata có run/provider/account.
8. Overflow:
   - file-backed session attach vào run chính.
   - explicit session không tạo session rời khi overflow.
9. IP isolation:
   - off: direct mode hoạt động.
   - on strict no worker: fail an toàn, không gọi upstream direct.
   - worker verified: request đi qua worker.
10. Cancel:
   - abort upstream/worker.
   - không chuyển cancelled thành completed sau đó.
11. UI:
   - Runs hiển thị đúng lifecycle.
   - Sessions hiển thị bindings/active runs.
   - Network verify endpoint hoạt động.

## 17. Checklist triển khai nhanh

- [ ] Phase 1: fix `addRunRecord`/finalize lifecycle.
- [ ] Phase 2: scheduler queue + idempotent leases.
- [ ] Phase 3: provider/account/chat resolution trước schedule.
- [ ] Phase 4: provider bindings thật.
- [ ] Phase 5: session write lock + message metadata.
- [ ] Phase 6: egress isolation strict gate + verify profile endpoint.
- [ ] Phase 7: cancel/timeout abort.
- [ ] Phase 8: providerFactory dùng trong route chính.
- [ ] Phase 9: file-backed session attach vào request chính.
- [ ] Phase 10: UI/API diagnostics.
- [ ] Phase 11: tests bắt buộc.
- [ ] Phase 12: tách typed helpers, giảm phụ thuộc `// @ts-nocheck`.

## 18. Ghi chú triển khai thực tế

- Làm từng milestone và chạy test sau mỗi milestone.
- Không triển khai worker service trước khi strict gate và scheduler ổn.
- Không thêm heuristic subagent phức tạp trước khi provider binding main/subagent rõ ràng.
- Không log token/cookie/proxy password.
- Không fallback direct trong strict mode, kể cả khi worker lỗi.
- Không release scheduler bằng object run cũ; release theo lease/runId để tránh sai trạng thái.
