# Warehouse NAV

## Overview

3D warehouse navigation app (Three.js + React/Vite) with an Express backend for file storage. Designed to run on a Raspberry Pi on a local network. pnpm workspace monorepo using TypeScript.

## Artifacts

- **`artifacts/warehouse-nav`** — React + Vite frontend (Three.js). Preview path `/`, port `20188`.
- **`artifacts/api-server`** — Express 5 backend. Port `8080`. Handles file uploads and config persistence.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **3D engine**: Three.js ^0.184.0
- **API framework**: Express 5
- **File uploads**: multer (GLBs up to 512 MB, images up to 64 MB)
- **Build**: esbuild (ESM bundle for api-server), Vite (frontend)

## Backend API (`/api`)

- `GET  /api/healthz` — health check
- `GET  /api/files` — list uploaded GLBs and photos
- `GET  /api/files/glbs/:name` — serve a GLB file
- `GET  /api/files/photos/:name` — serve a panorama photo
- `POST /api/upload/glb` — upload a GLB/GLTF file (multipart `file` field)
- `POST /api/upload/photo` — upload a panorama image (multipart `file` field)
- `DELETE /api/files/:type/:name` — delete an uploaded file
- `GET  /api/configs` — list saved configs
- `POST /api/configs` — save a config `{ name, config }`
- `GET  /api/configs/:name` — fetch a saved config
- `DELETE /api/configs/:name` — delete a saved config

## Data Storage

Files stored in `$DATA_DIR/{glbs,photos,configs}/`. Defaults to `./data` in the api-server working directory. On Pi, set via `DATA_DIR` environment variable (install.sh uses `/var/lib/warehouse-nav`).

## Frontend API Proxy (dev)

Vite dev server proxies `/api/*` → `http://localhost:8080/api/*` so the frontend can talk to the backend during development. Production: Express serves the built frontend as static files and handles `/api` directly.

## Raspberry Pi Install

```bash
curl -fsSL https://raw.githubusercontent.com/RX-LOST/Warehouse-NAV/main/install.sh | bash
```

Options: `--port 3000`, `--data-dir /var/lib/warehouse-nav`, `--no-service`.
Creates a systemd service `warehouse-nav` auto-starting on boot.

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — run API server (builds then starts)
- `pnpm --filter @workspace/warehouse-nav run dev` — run frontend dev server
- `pnpm --filter @workspace/warehouse-nav run build` — build frontend to `dist/public`
- `pnpm --filter @workspace/api-server run build` — bundle backend to `dist/index.mjs`

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
