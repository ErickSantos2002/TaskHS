# ── build stage ───────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# URL pública da API do backend (ex.: https://taskhs-api.seudominio.com/api).
# Injetada em build time pelo Vite. Default = dev local.
ARG VITE_API_URL=http://localhost:8000/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ── serve stage ───────────────────────────────────────────────
# imagem unprivileged: roda como usuário não-root (nginx) e escuta na 8080
FROM nginxinc/nginx-unprivileged:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
