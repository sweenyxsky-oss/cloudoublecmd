import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// Returns { type, body } for a file inside publicDir, or null. Never lists directories.
export async function staticFile(publicDir, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part.startsWith('.') && part !== '')) return null;
  const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
  const type = MIME[path.extname(relative).toLowerCase()];
  if (!type) return null;
  try {
    const root = await realpath(publicDir);
    const file = path.join(root, relative);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const resolved = await realpath(file);
    if (!resolved.startsWith(root + path.sep)) return null;
    return { type, body: await readFile(resolved) };
  } catch { return null; }
}

export function loginPage(error) {
  const message = error === 'limited' ? 'Too many attempts. Wait a minute and try again.' : error ? 'Incorrect password.' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — ClouDouble Commander</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:13px "Segoe UI",system-ui,sans-serif;background:#eef1f5;color:#1d2433}
@media (prefers-color-scheme:dark){body{background:#1b1e24;color:#e6e8ec}form{background:#262a32!important;border-color:#3a3f49!important}input{background:#1b1e24!important;color:inherit!important;border-color:#3a3f49!important}}
form{width:300px;padding:24px;background:#fff;border:1px solid #c9d0db;border-radius:4px;display:grid;gap:12px}
h1{margin:0;font-size:15px}p{margin:0;opacity:.7}input{padding:7px 8px;border:1px solid #b8c0cc;border-radius:3px;font:inherit}
button{padding:7px;border:1px solid #2f6fd6;background:#3a7be0;color:#fff;border-radius:3px;font:inherit;cursor:pointer}.e{color:#c62828;opacity:1}
</style></head><body><form method="post" action="/auth/login"><h1>ClouDouble Commander</h1><p>Sign in to browse your TrueNAS files.</p>${message ? `<p class="e" role="alert">${message}</p>` : ''}<label>Password<br><input type="password" name="password" autocomplete="current-password" required autofocus style="width:100%;box-sizing:border-box;margin-top:4px"></label><button type="submit">Sign in</button></form></body></html>`;
}
