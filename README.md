# ClouDouble Commander

A web-native, Total Commander–style dual-pane file manager for **TrueNAS**. It runs as one container on your NAS and opens in any browser — no VNC, no desktop session.

![platform](https://img.shields.io/badge/platform-TrueNAS%20%2F%20linux%2Famd64-blue) ![image](https://img.shields.io/badge/image-ghcr.io%2Fsweenyxsky--oss%2Fcloudoublecmd-green)

## Features

- **Two panes**: folder tabs, drive/connection buttons, path bar with history, sortable Name/Ext/Size/Date/Attr columns, free space, status line.
- **Keyboard first**: Tab switches panes. Arrows move the cursor. Insert/Space or Shift+Arrows mark files. Enter opens, Backspace goes up. F3 View, F4 Edit, F5 Copy, F6 Move, F7 New folder, F8 Delete, Alt+F4 Exit. Enter confirms dialogs.
- **Mouse like Total Commander**: left-drag copies. Shift/Alt-drag moves and Ctrl forces copy. Right-click marks a file, right-drag marks a range, and holding the right button for about one second opens file actions.
- **Transfers**: copy and move show progress, speed, pause, cancel and a background (minimized) mode with a progress bar. If a file already exists, you choose Overwrite, Skip, Overwrite all or Skip all after comparing the size and date of both files.
- **Tools**: multi-rename, attributes/date, checksums (create/verify), compare by content, split/combine, occupied space, folder sync (copies missing items only), compare folders, mark tools, search, hotlist and quick view.
- **Archives**:

  | Format | Create | List / test / extract |
  |---|---|---|
  | ZIP, 7z | Yes | Yes |
  | TAR, TAR.GZ, TGZ | Yes | Yes |
  | GZ, BZ2, XZ | One file only | Yes |
  | RAR / RAR5, CAB, ISO, ARJ | No | Yes (unencrypted regular files) |

  RAR creation needs proprietary software and is not included. Password-protected archives are not supported.
- **Connections**: local datasets, host-mounted SMB/NFS folders, and explicit FTPS. FTPS supports edit, new folder, rename and delete.
- **Light and dark themes**, plus an eight-page Options dialog (layout, display, colours, columns, tabs, operations, quick search, viewer/editor).

## Architecture

```text
browser ──HTTP(S)──► container :7070
                      ├─ static UI (built from src/ with vite.nas.config.ts)
                      └─ access service (services/truenas-access, Node 22)
                           ├─ session-cookie login (password file)
                           ├─ allowlisted roots from connections.json
                           └─ 7-Zip 26.00 (checksum-verified) for archives
```

| Path | Purpose |
|---|---|
| `src/` | React UI (TanStack Start). The hosted preview runs on sample data. |
| `nas/`, `vite.nas.config.ts` | Self-hosted build. Outputs to `services/truenas-access/public`. |
| `services/truenas-access/` | Node service: file access, jobs, tools, archives, login. Has its own `Dockerfile`. |
| `services/truenas-access/deploy/` | Production TrueNAS YAML and example connections. |
| `.github/workflows/nas-image.yml` | Tests, builds and publishes `ghcr.io/<owner>/cloudoublecmd:latest`. |

## Deploy on TrueNAS (step by step)

The steps assume pool **`tank`**. Replace it with your own pool name everywhere.

**1. Image.** Each push to `main` runs **Actions → NAS image**. Wait for the green tick. Then open **Packages → cloudoublecmd → Package settings** and set visibility to **Public**. If the package was first created by another repo, also add this repo under **Manage Actions access** with the *Write* role.

**2. Create the dataset** `tank/cloudoublecmd` in Storage, then run this in **System → Shell**:

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
sudo chown 1000:1000 /mnt/tank/cloudoublecmd/config/*
sudo chmod 600 /mnt/tank/cloudoublecmd/config/*
sudo docker pull ghcr.io/sweenyxsky-oss/cloudoublecmd:latest
sudo cat /mnt/tank/cloudoublecmd/config/ui_password   # your sign-in password; keep it private
```

To use an existing dataset such as `/mnt/tank/media`, give UID 1000 access through the dataset **ACL**. Do not recursively `chown` real data. Then add a volume and a connection entry for it (see *Adding folders*).

**3. Install the app.** Go to **Apps → Discover → ⋮ → Install via YAML**, name it `cloudoublecmd`, and paste [`services/truenas-access/deploy/compose.yaml`](services/truenas-access/deploy/compose.yaml). Adjust its paths if your pool isn't `tank`.

**4. Open** `http://<nas-ip>:7080` and sign in with the password from step 2.

**Updating:** push to `main` or rerun the workflow, then **Stop** and **Start** the app in TrueNAS. `pull_policy: always` fetches the new image. Finish or cancel transfers before restarting, because a restart signs users out.

### Adding folders

For each folder, add a volume to the YAML and an entry to `connections.json`, then restart the app:

```yaml
      - /mnt/tank/media:/data/media          # add :ro for read-only
```
```json
{ "id": "media", "label": "Media", "protocol": "local", "root": "/data/media", "writable": true }
```

- `smb` / `nfs`: mount the share on the host first, then add it like `local`. The container never runs mount commands.
- `ftp`: explicit FTPS only. Use `{ "id": "ftp1", "label": "FTP", "protocol": "ftp", "host": "…", "port": 21, "user": "…", "password": "…", "root": "/", "writable": true }`.
- IDs may use letters, numbers, `_` and `-`. Omit `"writable"` for read-only browsing.

### Notes and limits

- Archive packing uses the container's temporary space. That is set to 4 GB in the YAML. Raise `size=` in `tmpfs` (it uses RAM) to pack larger selections.
- Deleting is permanent. Turn on TrueNAS snapshots for writable datasets.
- Keep port 7080 on your local network. For remote access, use an HTTPS reverse proxy or VPN. Never forward the port to the internet.
- Jobs live in memory. If the container stops during a transfer, files that already finished copying stay in place.

## Security model

- Browser login uses an HttpOnly, SameSite=Strict, 12-hour session cookie. Sign-in attempts are rate-limited. Change requests need a valid session, a JSON body and a matching `Origin` header.
- Every path is checked against its configured root each time it is used. Symlinks are never followed. Overwrites need an explicit choice, and files are published atomically.
- The bearer token stays on the server. Only the read-only `/v1` API accepts it.
- The container runs as UID 1000 with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, and limits on processes, memory and CPU.

## Development

Requirements: [Bun](https://bun.sh) (or Node 22 + npm) and Docker for image builds.

```sh
bun install
bun run dev                              # UI with sample data at http://localhost:8080
bunx vitest run                          # UI tests
bunx vite build -c vite.nas.config.ts    # NAS UI → services/truenas-access/public

cd services/truenas-access
npm ci
ARCHIVER_BIN=/path/to/7zzs npm test      # service tests (official 7-Zip binary)
docker build --platform linux/amd64 -t cloudoublecmd .   # only after the NAS UI build above
```

To run the service locally, create files for `ACCESS_TOKEN_FILE`, `UI_PASSWORD_FILE` and `CONNECTIONS_FILE`, then run `npm start` (port `PORT`, default 7070).

## License notes

The image includes the official 7-Zip 26.00 binary. Its license is kept at `/usr/share/licenses/7zip/License.txt` inside the image.
