# Proxy-Luna Frontend

This directory contains the React + TypeScript source for the Proxy-Luna admin
UI. The backend does not run this directory directly; it serves the built static
files from `../public`.

## Layout

```text
frontend/
├── index.html
├── tsconfig.json
├── DESIGN_GUIDELINES.md
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── styles.css
    ├── components/
    ├── design/
    └── pages/
```

## Runtime Relationship

- `frontend/` is source code for developing the admin UI.
- `public/` is the static UI output served by the proxy server.
- `bun run dev` from the repository root starts the backend proxy and serves
  whatever is currently in `public/`.

See the root `README.md` and `STRUCTURE.md` for proxy-level setup and module
ownership.
