FROM oven/bun:1 AS build
WORKDIR /app
ARG VITE_API_BASE_URL=http://localhost:18080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
