FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

# pg is pure JS — no native build tools needed
RUN npm install --omit=dev && npm cache clean --force

COPY bin.mjs ./
COPY src/ ./src/
COPY SYSTEM_PROMPT.md ./

ENV PORT=3100
ENV HOST=0.0.0.0

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

CMD ["node", "bin.mjs"]
