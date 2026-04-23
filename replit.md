# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **warehouse-router** (`artifacts/warehouse-router`) — Single-page Three.js tool for navigating a GLB warehouse model. Admin mode supports building Catmull-Rom spline camera paths to shelves with WASD/mouse free-fly controls, setting LookAt targets, uploading 360° equirectangular panoramas per shelf, placing marker dots, and saving rotation presets. It also supports importing additional GLB props as scene objects with Blender-style G/R/S transform gestures (X/Y/Z to lock axis, LMB/Enter confirm, RMB/Esc cancel) plus precise numeric position/rotation/scale editing in the side panel; the warehouse scene itself is selectable only via the menu while imported objects are mouse-pickable. Runtime mode lets a user enter a shelf ID/barcode to fly the camera through the saved path and transition into the panorama view. Config is persisted to localStorage and can be exported/imported as JSON.
