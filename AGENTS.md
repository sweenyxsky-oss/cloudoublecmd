<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Keep the prototype filesystem in an in-memory browser-safe model with recursive operations; no real TrueNAS access is implied or performed.
- Render the commander workspace through a dedicated feature component at the index route, keeping mock filesystem operations separate from presentation.
- Route prototype copy, move, create, delete, write, rename and synchronization through a typed immutable snapshot-operation boundary; this centralizes validation and recursive changes without implying a remote provider or real filesystem authorization.
- Use semantic CSS tokens for the light and dark themes, and the shared Button and Dialog controls for actions and confirmations.

- Keep scalable colored toolbar and file icons in a dedicated browser-safe icon component so the Windows-style visual vocabulary stays consistent at every display density.
- Keep drive-button and folder-tab visibility in the Show menu; quick drives appear below volume selection by default, and migrate existing drive preferences once so the requested navigation is visible.
- Manage appearance through the dedicated theme hook, reading local preferences after hydration and tolerating blocked storage; this preserves SSR safety without persisting filesystem data.
- Keep sample transfer jobs in a dedicated in-memory hook with captured operations and revalidation at completion; this permits pause/cancel/background browsing without falsely implying durable server transfers.
- Keep protocol connection dialogs explicitly disconnected until an authenticated TrueNAS-side file-access service is configured; browser credentials or mock remote listings must never substitute for actual protocol support.
- Isolate the external TrueNAS access service under services/truenas-access with its own Node runtime and package manifest; no OS filesystem or protocol dependencies may enter the web app's Worker bundle.
- Expose authenticated allowlisted connection discovery and listings; FTPS verifies TLS and SMB/NFS are host-mounted read-only roots to avoid privileged mount operations.
- Self-host the commander on TrueNAS as a static SPA (vite.nas.config.ts → services/truenas-access/public) served by the access service; the hosted build stays mock-only so the LAN service never needs public exposure.
- Guard the NAS web UI with a password-file session cookie and same-origin checks in the access service, keeping the bearer token server-side; live `nas://` paths bypass the mock operation boundary.
- NAS file changes are allowed only on connections with `"writable": true` (FTPS limited to edit/mkdir/rename/delete via services/truenas-access/src/ftp.mjs; jobs and tools are mounted-only), through session-protected JSON POSTs that require a same-origin Origin header; every path is re-confined at use, symlinks are never followed, copy/move overwrites require an explicit per-conflict or job-wide decision and atomic temporary-file publication with destination revalidation, and copy/move run as in-memory service jobs polled by the browser. The /v1 bearer API stays read-only.
- Keep menu tool dialogs in commander-tools (pure helpers in lib/commander-tools) and user settings in the use-commander-options hook with sanitized browser storage; new file-creating tools go through the 'create'/'attributes' operations so validation stays centralized.
- NAS content tools (checksums, split/combine, compare, size, archive pack/unpack) live in services/truenas-access/src/tools.mjs behind session-protected POST /api/tools/*; created files are published via hard-link so nothing is ever overwritten, and archives extract only plain files/folders with clean relative paths.

- Copy/move merges existing directories recursively and asks about file conflicts, preserving skipped move sources; the NAS owns paused conflict jobs so browsing and background transfers remain independent.
- Centralize duplicate-file presentation in TransferConflictDialog and menu icon mapping in CommanderMenuIcon to keep mock and NAS workflows visually consistent.

- Implement mouse marking/dragging inside the commander and pass captured source/selection to the existing transfer boundary so pane changes cannot redirect a drop.
- Use the separate NAS archives module and a checksum-pinned official x86_64 7-Zip binary for additional formats; extract regular entries to bounded stdout and publish only through confined paths, never let CLI tools write archive-controlled paths.
- Start the self-hosted UI on configured NAS connections and exclude sample roots from its navigation and search so production listings cannot be mistaken for mock files.
- Keep production TrueNAS YAML and connection examples under services/truenas-access/deploy with least-privilege mounts and explicit configuration requirements.
