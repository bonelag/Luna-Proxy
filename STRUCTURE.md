# Project Structure

This file documents the current Proxy-Luna layout.

```text
Proxy-Luna/
├── README.md                 # Project overview and quick start
├── STRUCTURE.md              # Directory map and module ownership
├── package.json              # Root scripts and dependencies
├── tsconfig.json             # TypeScript compiler configuration
├── src/                      # Backend proxy source
├── frontend/                 # React admin UI source
├── public/                   # Built/static UI served by the backend
├── scripts/                  # Local test/dev helper scripts
├── tests/                    # TypeScript test files
├── data/                     # Local runtime state and logs
├── lib/                      # TypeScript build output
└── node_modules/             # Installed dependencies
```

## Backend Source

```text
src/
├── dev.ts                    # Development entry point
├── index.ts                  # Package export surface
├── server.ts                 # Koa server, API routes, request pipeline
├── configStore.ts            # Persistent config and log storage
├── sessionStore.ts           # Session persistence and provider bindings
├── modules/                  # Feature modules used by the server
├── runtime/                  # Run scheduling, locks, routing, workers
├── main/
│   ├── oauth/                # Qwen credential capture/validation helpers
│   ├── providers/            # Built-in provider definitions
│   ├── proxy/                # Qwen adapter, prompt handling, stream tools
│   └── store/                # Shared provider/account type definitions
└── types/                    # Local declaration files
```

## Backend Modules

```text
src/modules/
├── overflowPolicy.ts         # Token overflow file generation and upload
├── ossUploader.ts            # Qwen file upload helper
├── responseAnalyzer.ts       # Response/tool-output inspection helpers
├── sessionCompactor.ts       # Session compaction flow
├── sessionPersistence.ts     # Persist user/assistant turns into sessions
├── sseCollector.ts           # Convert streamed responses to final objects
├── textUtils.ts              # Text extraction and token estimates
└── workers.ts                # Worker registry and worker verification
```

## Runtime Layer

```text
src/runtime/
├── locks.ts                  # Account/provider/session lock management
├── networkProfiles.ts        # Network profile persistence and verification
├── providerFactory.ts        # Provider adapter construction
├── providerRouter.ts         # Provider/account selection
├── runControllers.ts         # Abort/cancel controller registry
├── runStore.ts               # Run persistence
├── scheduler.ts              # Queueing and concurrency policies
├── types.ts                  # Runtime type definitions
├── workerClient.ts           # Worker forwarding client
└── workerSelector.ts         # Worker selection rules
```

## Qwen Proxy Layer

```text
src/main/proxy/
├── adapters/qwen-ai.ts       # Qwen chat/file/model adapter
├── clientContracts.ts        # Downstream client protocol detection
├── clineXmlContract.ts       # XML passthrough prompt injection
├── overflowSanitizer.ts      # Legacy/specialized overflow sanitizer helpers
├── projectSnapshot.ts        # Project snapshot rendering helper
├── promptToolUse.ts          # Tool-use parsing helpers
├── providerToolGuard.ts      # Provider tool-output guard helpers
├── constants/                # Signature and marker constants
├── prompt/                   # Prompt variants
└── utils/                    # Stream/tool parser utilities
```

## Frontend Source

```text
frontend/
├── index.html                # UI HTML shell
├── README.md                 # UI-specific notes
├── tsconfig.json             # UI TypeScript config
├── dist/                     # Frontend build output, generated
├── node_modules/             # Frontend dependencies, generated
└── src/
    ├── App.tsx               # App router and shell
    ├── main.tsx              # React entry point
    ├── styles.css            # UI styling
    ├── components/           # Shared UI components
    ├── design/               # Design tokens
    └── pages/                # Dashboard, providers, logs, sessions, etc.
```

The backend serves `public/`, not `frontend/`. `frontend/` is kept as source so
the proxy runtime remains centered on `src/` plus the static files in `public/`.

## Tests

```text
tests/
├── overflowSanitizer.test.ts # Overflow sanitizer behavior tests
├── providerRouter.test.ts    # Provider/account selection tests
├── runtimeLocks.test.ts      # Lock manager tests
├── runtimeScheduler.test.ts  # Scheduler/concurrency tests
├── sessionStore.test.ts      # Session persistence tests
└── utils.ts                  # Minimal test harness helpers
```

`tests/` is source code and should stay visible in the project tree.

## Runtime Data

```text
data/
├── config.json               # Local configuration and application logs
├── sessions.json             # Session history and bindings
├── runs.json                 # Run history
├── overflow/                 # Overflow prompt files
└── wire-logs/                # Provider wire/stream logs
```

The `data/`, `lib/`, `node_modules/`, `frontend/dist/`, and
`frontend/node_modules/` directories are generated or local runtime artifacts.
