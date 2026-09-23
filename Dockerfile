# ---- etape 1 : installation des dependances ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- etape 2 : image finale (juste node, sans npm ni yarn) ----
FROM alpine:3.24
RUN apk add --no-cache libstdc++ \
    && addgroup -S app && adduser -S app -G app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json server.js ./
ENV NODE_ENV=production
EXPOSE 3000
USER app
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
