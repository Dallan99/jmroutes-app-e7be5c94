# Imagem do piloto do worker Meli (Fase B1). NÃO faz parte do build do frontend.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm install --no-save typescript@5.8.3 && npx tsc -p tsconfig.build.json

# Volume persistente para o arquivo de sessão cifrado.
VOLUME ["/data"]
ENV SESSION_FILE_PATH=/data/adminml-session.enc

CMD ["node", "dist/index.js"]
