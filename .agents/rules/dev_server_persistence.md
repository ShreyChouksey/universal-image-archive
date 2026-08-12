# Dev Server Persistence & Operational Readiness Rule

This rule ensures that the Vite development server (`http://localhost:5273/`) remains continuously active and persistent across all development, audit, and checkup sessions.

## 1. Continuous Dev Server Maintenance
- **Requirement**: The Vite development server (`npm run dev`) MUST be kept running as a background daemon process (`IsDaemon: true`) on port 5273.
- **Workflow**:
  1. At the beginning of any session or after completing audit commands (`npm test`, `npm run check`, `npm run build`), verify if `http://localhost:5273/` is active.
  2. If the dev server is down or no task is active for it, launch `npm run dev` using `run_command` with `IsDaemon: true` and `Cwd` set to the workspace root.
  3. Verify that the task log confirms `Local: http://localhost:5273/`.

## 2. Non-Disruptive Audit Execution
- **Requirement**: Background test, typecheck, or build commands (`npm test`, `tsc --noEmit`, `vite build`) MUST NOT terminate or overwrite the standing `npm run dev` daemon task.
- **Rationale**: The user actively relies on `http://localhost:5273/` to interact with and preview the platform. Disruption of the dev server during checkups causes unnecessary downtime.
