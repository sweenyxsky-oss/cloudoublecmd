# ClouDouble Commander — production NAS deployment

The container serves the real file manager and its authenticated file-access service on TrueNAS. No VNC and no separate server are required. The deployed UI starts on configured NAS folders; sample datasets are only available in the hosted development preview. The image targets **linux/amd64** (including Intel i5-10400F) and is published as `ghcr.io/sweenyxsky-oss/cloudoublecmd:latest`. Keep the GHCR package public to allow anonymous pulls.

## Install on TrueNAS

Create the production dataset yourself. Below assumes pool `tank` and dataset `cloudoublecmd`; change these paths to your actual dataset. Do not recursively change ownership on existing production data: grant UID/GID 1000 access using the dataset ACL instead. All commands below use sudo.

```sh
sudo install -d -m 750 -o 1000 -g 1000 /mnt/tank/cloudoublecmd/config
sudo install -d -m 750 -o 1000 -g 1000 /mnt/tank/cloudoublecmd/files
sudo sh -c 'umask 077; openssl rand -hex 32 > /mnt/tank/cloudoublecmd/config/access_token'
sudo sh -c 'umask 077; openssl rand -base64 24 > /mnt/tank/cloudoublecmd/config/ui_password'
sudo sh -c 'cat > /mnt/tank/cloudoublecmd/config/connections.json <<"JSON"
[
  { "id": "files", "label": "Files", "protocol": "local", "root": "/data/files", "writable": true }
]
JSON'
sudo chown 1000:1000 /mnt/tank/cloudoublecmd/config/access_token /mnt/tank/cloudoublecmd/config/ui_password /mnt/tank/cloudoublecmd/config/connections.json
sudo chmod 600 /mnt/tank/cloudoublecmd/config/access_token /mnt/tank/cloudoublecmd/config/ui_password /mnt/tank/cloudoublecmd/config/connections.json
sudo docker pull ghcr.io/sweenyxsky-oss/cloudoublecmd:latest
```

Read the generated sign-in password **locally** on your NAS with `sudo cat /mnt/tank/cloudoublecmd/config/ui_password`; do not paste it into chat or commit it. Alternatively set a private password of at least 12 characters with `sudo nano /mnt/tank/cloudoublecmd/config/ui_password`.

Paste **[deploy/compose.yaml](deploy/compose.yaml)** into TrueNAS Apps → Install via YAML after adapting mount paths. This configuration includes restart policy, a read-only container OS, dropped capabilities, resource limits, a writable temporary area and log rotation. Open `http://<nas-ip>:7080` and sign in. Do not run a separate compose instance alongside the TrueNAS-managed app.

For an existing installation, keep your existing configuration, password and dataset mounts; pull the new image and stop/start the app in TrueNAS. `pull_policy: always` ensures it requests the current `latest` image. Record the running image digest before upgrading for rollback. Restarting signs users out and interrupts active jobs; finish or cancel transfers first.

## Connections and permissions

Only administrators edit `connections.json`; the browser cannot supply hosts or credentials. Mount only allowlisted folders. IDs contain letters, numbers, `_` or `-`. Each entry needs `id`, `label`, `protocol` and `root` (container path).

- `local`, `smb`, `nfs`: existing host-mounted roots. The service never mounts shares or runs privileged mount operations. For read-only browsing, use a `:ro` volume and omit `writable`. For changes, set `"writable": true`, mount read-write and grant UID 1000 the relevant filesystem permissions.
- `ftp`: verified **explicit FTPS**, not plaintext FTP. Add `host`, `user`, `password`, optional `port` (default 21). The configured root must match the server's PWD path. Credentials stay in the private JSON file. With `writable: true`, text edit, mkdir, rename and delete are enabled; copy/move and content tools remain mounted-only.

## Features and limits

- Real listings and available space for mounted folders, view/edit text up to 1 MB, mkdir, rename, delete, permissions/date changes.
- Mounted copy/move with rate, progress, pause/cancel/background and per-file overwrite/skip decisions, including apply-to-all. Moves preserve skipped sources. Completed background jobs disappear from the strip.
- Checksums, compare, split/combine, occupied space and synchronization of missing top-level items. Synchronization is **not** a bidirectional mirror or same-name directory merge.
- Left drag copies; Shift/Alt drag moves; Ctrl forces copy. Drops onto folders, parent entries, panes and tabs ask for confirmation. Right-click toggles marking; right-drag marks/unmarks crossed rows; hold right for one second opens file actions. No OS-shell extension actions or link creation.

### Archives

| Format | Create | List / test / extract |
|---|---|---|
| ZIP, 7z | Yes | Yes |
| TAR, TAR.GZ, TGZ | Yes | Yes |
| GZ, BZ2, XZ | One file only | Yes |
| RAR / RAR5, CAB, ISO, ARJ | No | Yes, supported unencrypted regular-file entries |

RAR creation is proprietary and is not bundled. Encrypted/password-protected archives are not supported. This is the stated format set, not every Total Commander plugin format. The image bundles checksum-verified official 7-Zip 26.00 including the RAR decoder; its license is retained in `/usr/share/licenses/7zip`. Archive invocations never use a shell or let the CLI choose output filesystem paths. Link/special entries are refused/skipped, unsafe paths and duplicate names are rejected, and extracted regular files are published without replacing existing files. There is no archive size or time limit: packing stages hard links in a hidden folder on the destination dataset (files from other datasets are copied there), and extraction writes directly onto the destination dataset, so the only limit is free space on your pool. Archive tools run in the foreground; they are not pausable transfer jobs.

## Security and release checks

The web UI uses an HttpOnly, SameSite=Strict 12-hour session cookie and rate-limited sign-in. Change requests require a valid session, JSON and a matching Origin. The bearer-authenticated `/v1/health`, `/v1/connections` and `/v1/connections/{id}/entries?path=/` stay read-only. Never put the bearer token in browser storage. Restart invalidates sessions. LAN HTTP is not encrypted; use a trusted HTTPS reverse proxy and access restrictions before remote use. Never expose port 7080 directly to the internet.

Operations validate confined paths and reject symlinks. Do not expose roots concurrently writable by untrusted users: OS path checks cannot fully eliminate adversarial races. Deletion is permanent: configure TrueNAS snapshots/backups before granting writes. Jobs are in-memory, not durable queues; files already finished are kept after interruption. Review unfinished temporary transfer files after an abrupt container kill rather than automatically deleting potentially useful recovery data.

CI runs app and service tests before publishing. Tests use disposable folders and protocol doubles; they do not prove compatibility with your NAS, external FTP server, ACLs, reverse proxy, large datasets or storage capacity. Validate these on your actual installation before relying on production data. The requested TrueNAS target is 25.10.7 — Goldeye; compatibility remains user-side verification, not a blanket certification.

Local service checks: `npm ci` then `npm test` in this directory, with the official 7-Zip binary available as `7z` or set `ARCHIVER_BIN`. The web build is produced by the existing GitHub workflow and copied into `public/` before the container build; do not build this service Dockerfile alone without the bundled UI.
