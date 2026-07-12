# TCDS Domain 6 Warehouse PWA — deterministic Coolify/Linode build
FROM node:20.18-alpine AS build
WORKDIR /app

ENV NODE_ENV=development \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json .npmrc ./
RUN grep -R "packages\.applied-caas-gateway1\.internal\.api\.openai\.org" package-lock.json .npmrc && exit 1 || true
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run verify:registry && npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/health || exit 1
CMD ["nginx", "-g", "daemon off;"]
