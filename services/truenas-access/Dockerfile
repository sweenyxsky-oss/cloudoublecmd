FROM node:22-alpine
# Official x86_64 build includes RAR/RAR5 decoding; Alpine's package disables it.
RUN apk add --no-cache curl xz \
 && curl -fsSL https://www.7-zip.org/a/7z2600-linux-x64.tar.xz -o /tmp/7zip.tar.xz \
 && echo "c74dc4a48492cde43f5fec10d53fb2a66f520e4a62a69d630c44cb22c477edc6  /tmp/7zip.tar.xz" | sha256sum -c - \
 && mkdir /tmp/7zip \
 && tar -xJf /tmp/7zip.tar.xz -C /tmp/7zip \
 && install -m 755 /tmp/7zip/7zzs /usr/local/bin/7z \
 && mkdir -p /usr/share/licenses/7zip \
 && cp /tmp/7zip/License.txt /usr/share/licenses/7zip/ \
 && rm -rf /tmp/7zip /tmp/7zip.tar.xz
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
USER node
EXPOSE 7070
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:7070/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]