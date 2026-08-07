# Imagem do piloto do worker Meli (Fase B1). NÃO faz parte do build do frontend.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

# Build reprodutível: sempre npm ci a partir do package-lock.json versionado.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts

RUN npx tsc -p tsconfig.build.json \
  && npm prune --omit=dev

ENV NODE_ENV=production

# Volume persistente para o arquivo de sessão cifrado.
VOLUME ["/data"]
ENV SESSION_FILE_PATH=/data/adminml-session.enc

CMD ["node", "dist/index.js"]
