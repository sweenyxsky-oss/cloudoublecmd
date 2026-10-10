# ClouDouble Commander

A Total Commander–style, two-pane file manager for **TrueNAS** that runs in your web browser. It installs as one app on your NAS, with no VNC and no desktop session.

![platform](https://img.shields.io/badge/platform-TrueNAS%20SCALE%20%2F%20linux%2Famd64-blue) ![image](https://img.shields.io/badge/image-ghcr.io%2Fsweenyxsky--oss%2Fcloudoublecmd-green)

---

## Contents

1. [Features](#features)
2. [Quick install on TrueNAS (5 minutes)](#quick-install-on-truenas-5-minutes)
3. [Build it yourself (easy mode)](#build-it-yourself-easy-mode)
4. [Adding pools, folders, SMB/NFS and FTPS](#adding-pools-folders-smbnfs-and-ftps)
5. [Updating](#updating)
6. [Troubleshooting](#troubleshooting)
7. [Keyboard and mouse](#keyboard-and-mouse)
8. [Security model](#security-model)
9. [Project layout](#project-layout)
10. [Development](#development)
11. [License notes](#license-notes)

---

## Features

- **Two panes** with folder tabs, drive/pool buttons, a path bar with history, and sortable Name/Ext/Size/Date/Attr columns. The top of each pane shows pool usage, for example *"1.2 TB used of 3.6 TB · 97 GB free"*.
- **Every pool and dataset** you mount is shown, with **full read-write access**.
- **Keyboard first:** Tab switches panes. Space marks a file, or marks a folder and shows its total size. F3 View, F4 Edit, F5 Copy, F6 Move, F7 New folder, F8 Delete.
- **Mouse like Total Commander:** drag to copy, Shift/Alt-drag to move, right-click to mark, and hold the right button to open file actions.
- **Transfers** show progress, speed, pause and cancel, and can be minimized to the bottom bar with a progress bar. When a file already exists you choose **Overwrite / Skip / Overwrite all / Skip all**, with the size and date of both files side by side.
- **Tools:** multi-rename, attributes, checksums (create and verify), compare by content, split/combine, occupied space, folder sync, compare folders, search, hotlist and quick view.
- **Archives** (no size limit, only the free space on your pool):

  | Format | Create | Open / test / extract |
  |---|---|---|
  | ZIP, 7z, TAR, TAR.GZ, TGZ | Yes | Yes |
  | GZ, BZ2, XZ | Single file | Yes |
  | RAR / RAR5, CAB, ISO, ARJ | No | Yes |

- **Connections:** TrueNAS datasets, SMB/NFS shares mounted on the NAS, and FTPS servers.
- **Light and dark themes**, plus an eight-page Options dialog.

---

## Quick install on TrueNAS (5 minutes)

You need TrueNAS SCALE (24.10 or newer) with Apps enabled. You don't need to build anything: the ready-made image is `ghcr.io/sweenyxsky-oss/cloudoublecmd:latest`.

> In the commands below, replace **`tank`** with your pool name (for example `appPool`). Paste the commands **one line at a time** into **System → Shell**.

### Step 1: Create a settings folder

```sh
sudo install -d -m 750 -o 1000 -g 1000 /mnt/tank/cloudoublecmd/config
```

### Step 2: Create your password and access key

```sh
sudo sh -c 'umask 077; openssl rand -hex 32 > /mnt/tank/cloudoublecmd/config/access_token'
sudo sh -c 'umask 077; openssl rand -base64 24 > /mnt/tank/cloudoublecmd/config/ui_password'
```

### Step 3: List the pools the app may use

This lets the app edit everything in the pool `tank`. To add more pools, see [Adding pools](#adding-pools-folders-smbnfs-and-ftps).

```sh
sudo sh -c 'printf "%s\n" "[" "  { \"id\": \"tank\", \"label\": \"tank\", \"protocol\": \"local\", \"root\": \"/data/tank\", \"writable\": true }" "]" > /mnt/tank/cloudoublecmd/config/connections.json'
```

### Step 4: Lock down the settings files

```sh
sudo sh -c 'chown 1000:1000 /mnt/tank/cloudoublecmd/config/* && chmod 600 /mnt/tank/cloudoublecmd/config/*'
sudo ls -l /mnt/tank/cloudoublecmd/config
```

You should see three files (`access_token`, `connections.json`, `ui_password`), each owned by `1000 1000`.

### Step 5: Let the app edit your pool

The app runs as user **1000**. In TrueNAS go to **Datasets**, select your pool's top dataset, then **Permissions → Edit**:

1. **Add Item**, then choose **User**: `1000`, **Permissions**: **Modify**.
2. Tick **Apply permissions recursively** and click **Save**.

Repeat for every pool you add. Without this step, folders appear empty or changes fail with "permission denied".

### Step 6: Install the app

Go to **Apps → Discover → ⋮ (top right) → Install via YAML**, name it `cloudoublecmd`, paste the YAML below (change `tank` to your pool), and click **Save**.

```yaml
services:
  commander:
    image: ghcr.io/sweenyxsky-oss/cloudoublecmd:latest
    pull_policy: always
    restart: unless-stopped
    init: true
    user: "1000:1000"
    ports:
      - "7080:7070"
    environment:
      PORT: "7070"
      UI_PASSWORD_FILE: /run/secrets/ui_password
      ACCESS_TOKEN_FILE: /run/secrets/access_token
      CONNECTIONS_FILE: /run/secrets/connections.json
    volumes:
      - /mnt/tank/cloudoublecmd/config/access_token:/run/secrets/access_token:ro
      - /mnt/tank/cloudoublecmd/config/ui_password:/run/secrets/ui_password:ro
      - /mnt/tank/cloudoublecmd/config/connections.json:/run/secrets/connections.json:ro
      - /mnt/tank:/data/tank
    read_only: true
    tmpfs:
      - /tmp:rw,nosuid,nodev,noexec,size=512m,uid=1000,gid=1000,mode=0700
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 128
    mem_limit: 2g
    cpus: 2
    stop_grace_period: 30s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

The same file is in [`services/truenas-access/deploy/compose.yaml`](services/truenas-access/deploy/compose.yaml). The three `:ro` lines are only the app's own settings files. Your pools are mounted read-write.

### Step 7: Open it

1. Show your password: `sudo cat /mnt/tank/cloudoublecmd/config/ui_password`
2. Open **http://YOUR-NAS-IP:7080** and sign in.

> **Before you start:** turn on TrueNAS **snapshots** for your pools (Data Protection → Periodic Snapshot Tasks). Deleting in the app is permanent.

---

## Build it yourself (easy mode)

Build your own copy if you changed the code or want your own image. There are two ways.

### Option A: Let GitHub build it for you (easiest, nothing to install)

1. Click **Fork** at the top of this GitHub page.
2. In your fork, open the **Actions** tab and click **"I understand my workflows, go ahead and enable them"**.
3. Click **NAS image (app + access service)** → **Run workflow** → **Run workflow**.
4. Wait about 5 minutes for the green tick ✅.
5. On your GitHub profile, open **Packages → cloudoublecmd → Package settings**, and set **Change visibility → Public**.
6. In the YAML from Step 6, change the image line to:
   ```yaml
   image: ghcr.io/YOUR-GITHUB-NAME/cloudoublecmd:latest
   ```

From then on, every change you push to `main` builds a new image automatically.

### Option B: Build on your own computer

You need a Linux or macOS computer (Windows: use WSL) with:

- [Docker](https://docs.docker.com/get-docker/)
- [Bun](https://bun.sh): install it with `curl -fsSL https://bun.sh/install | bash`
- `git`, `curl`, `sha256sum` (already on most systems)

Then run these four commands:

```sh
git clone https://github.com/sweenyxsky-oss/cloudoublecmd.git
cd cloudoublecmd
sh scripts/build-image.sh cloudoublecmd:local
docker save cloudoublecmd:local | gzip > cloudoublecmd.tar.gz
```

The script builds the web interface, downloads and checks 7-Zip, and builds the image. To move the image to your NAS:

```sh
scp cloudoublecmd.tar.gz YOUR-USER@YOUR-NAS-IP:/tmp/
# then on the NAS:
sudo docker load -i /tmp/cloudoublecmd.tar.gz
```

In the Step 6 YAML, use `image: cloudoublecmd:local` and `pull_policy: never`.

---

## Adding pools, folders, SMB/NFS and FTPS

Each location needs **two edits**: one line in the YAML and one entry in `connections.json`. After both, **Stop** and **Start** the app.

**1. YAML** (Apps → cloudoublecmd → Edit), under `volumes:`:

```yaml
      - /mnt/fast:/data/fast
```

**2. connections.json:**

```sh
sudo nano /mnt/tank/cloudoublecmd/config/connections.json
```

```json
[
  { "id": "tank", "label": "tank", "protocol": "local", "root": "/data/tank", "writable": true },
  { "id": "fast", "label": "fast", "protocol": "local", "root": "/data/fast", "writable": true }
]
```

Save with **Ctrl+O**, then **Enter**, then exit with **Ctrl+X**. Remember Step 5 (permissions) for the new pool.

- **SMB / NFS shares:** mount the share on the NAS first, then add it exactly like a pool, using `"protocol": "smb"` or `"nfs"`.
- **FTPS:** no YAML line is needed. Add:
  `{ "id": "ftp1", "label": "FTP", "protocol": "ftp", "host": "ftp.example.com", "port": 21, "user": "me", "password": "secret", "root": "/", "writable": true }`
  FTPS supports view, edit, new folder, rename and delete. Copy/move and tools only work on pools and mounted shares.
- **Rules:** IDs may contain only letters, numbers, `_` and `-`. Every entry needs `"writable": true` to allow changes.

---

## Updating

Open **Apps → cloudoublecmd**, click **Stop**, then **Start**. `pull_policy: always` downloads the newest image each time the app starts. Finish or cancel any transfers first, because a restart signs you out.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `zsh: no matches found` | Wrap the command in `sudo sh -c '…'` as shown above. |
| `zsh: command not found: #` | Harmless. Don't paste comment lines. |
| App won't start: `denied` / `manifest unknown` | The package on GitHub is private, or the build hasn't finished. Make it Public and wait for the green tick. |
| Page doesn't open | Use `http://` with port **7080**, from the same network as the NAS. |
| Folder looks empty / "permission denied" | Redo Step 5 for that dataset. |
| A pool is missing | Check that both its YAML line and its `connections.json` entry exist, then Stop/Start the app. |
| Changes are refused | Make sure the YAML line has no `:ro` and the entry has `"writable": true`. |
| Still the old version | Stop/Start the app, then press **Ctrl+Shift+R** in the browser. |

To see the app's log: `sudo docker logs $(sudo docker ps -qf name=cloudoublecmd)`

---

## Keyboard and mouse

| Key | Action | Key | Action |
|---|---|---|---|
| Tab | Switch pane | F3 / F4 | View / Edit |
| Enter | Open / confirm | F5 / F6 | Copy / Move |
| Backspace | Parent folder | F7 / F8 | New folder / Delete |
| Space / Insert | Mark (folder: show size) | Shift+↑/↓ | Mark while moving |
| Left drag | Copy | Shift/Alt drag | Move |
| Right click | Mark | Hold right button | File actions menu |

---

## Security model

- Sign-in uses a password file and an HttpOnly, SameSite=Strict, 12-hour cookie. Sign-in attempts are rate-limited, and every change needs a valid session plus a matching `Origin` header.
- Each path is checked against its configured root on every use. Symbolic links are never followed. Overwrites always need your explicit choice, and files are published atomically.
- The container runs as UID 1000 with a read-only system, all capabilities dropped and `no-new-privileges`. Only what you list in the YAML is visible.
- **Keep port 7080 on your home network.** For remote access, use a VPN or an HTTPS reverse proxy. Never forward the port to the internet.

---

## Project layout

```text
browser ──► NAS :7080 ──► container :7070
                           ├─ web interface (built from src/)
                           └─ access service (Node 22)
                               ├─ password login
                               ├─ pools/folders from connections.json
                               └─ 7-Zip (checksum-verified) for archives
```

| Path | Purpose |
|---|---|
| `src/` | React interface. The online preview runs on sample data only. |
| `nas/`, `vite.nas.config.ts` | NAS build of the interface, output to `services/truenas-access/public`. |
| `services/truenas-access/` | Node service: file access, transfers, tools, archives, login, `Dockerfile`. |
| `services/truenas-access/deploy/` | TrueNAS YAML and example `connections.json`. |
| `scripts/build-image.sh` | One-command local image build. |
| `.github/workflows/nas-image.yml` | Tests, builds and publishes `ghcr.io/<owner>/cloudoublecmd:latest`. |

---

## Development

```sh
bun install
bun run dev                              # interface with sample data at http://localhost:8080
bunx vitest run                          # interface tests

cd services/truenas-access
npm ci
ARCHIVER_BIN=/path/to/7zzs npm test      # service tests
```

To run the service without Docker, create the three files named by `ACCESS_TOKEN_FILE`, `UI_PASSWORD_FILE` and `CONNECTIONS_FILE`, then run `npm start` (port `PORT`, default 7070).

---

## License notes

The image includes the official 7-Zip 26.00 binary. Its license is at `/usr/share/licenses/7zip/License.txt` inside the image. RAR creation needs proprietary software and is not included.

---

## Credits

ClouDouble Commander stands on the shoulders of two great open-source projects:

- **[Double Commander](https://github.com/doublecmd/doublecmd)** by Alexander Koblov and contributors (GPL-2.0). It inspired the dual-pane workflow, keyboard layout, menus and file-operation behaviour.
- **[Cloud Commander](https://github.com/coderaiser/cloudcmd)** by coderaiser (Iurii Shkurko) and contributors (MIT). It inspired the web-native, browser-based file manager approach.

The look and feel follows **Total Commander** by Christian Ghisler. ClouDouble Commander is an independent project and isn't affiliated with or endorsed by any of these projects.
