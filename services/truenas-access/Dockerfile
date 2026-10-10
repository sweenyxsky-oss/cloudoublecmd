FROM node:22-alpine
# Official x86_64 7-Zip (with RAR decoding) is downloaded and checksum-verified by the
# GitHub workflow into vendor/7zip before this build; Alpine's package disables RAR.
COPY vendor/7zip/7zzs /usr/local/bin/7z
COPY vendor/7zip/License.txt /usr/share/licenses/7zip/License.txt
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
USER node
EXPOSE 7070
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:7070/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]