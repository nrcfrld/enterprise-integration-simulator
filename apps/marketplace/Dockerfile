FROM golang:1.25.14-alpine AS build
WORKDIR /src
COPY go.work go.work.sum ./
COPY apps/marketplace/go.mod apps/marketplace/go.sum ./apps/marketplace/
COPY packages/dummy-generator/go.mod packages/dummy-generator/go.sum ./packages/dummy-generator/
WORKDIR /src/apps/marketplace
RUN go mod download
WORKDIR /src
COPY apps/marketplace ./apps/marketplace
COPY packages/dummy-generator ./packages/dummy-generator
WORKDIR /src/apps/marketplace
RUN CGO_ENABLED=0 go build -o /out/marketplace-api ./cmd/api
RUN CGO_ENABLED=0 go build -o /out/marketplace-worker ./cmd/worker

FROM alpine:3.21 AS api
WORKDIR /app
RUN addgroup -S marketplace && adduser -S -G marketplace marketplace
COPY --from=build --chown=marketplace:marketplace /out/marketplace-api ./marketplace-api
COPY --chown=marketplace:marketplace apps/marketplace/migrations ./migrations
COPY --chown=marketplace:marketplace apps/marketplace/openapi ./openapi
USER marketplace
EXPOSE 8080
ENTRYPOINT ["./marketplace-api"]

FROM alpine:3.21 AS worker
WORKDIR /app
RUN addgroup -S marketplace && adduser -S -G marketplace marketplace
COPY --from=build --chown=marketplace:marketplace /out/marketplace-worker ./marketplace-worker
COPY --chown=marketplace:marketplace apps/marketplace/migrations ./migrations
USER marketplace
ENTRYPOINT ["./marketplace-worker"]
