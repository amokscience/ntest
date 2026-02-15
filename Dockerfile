# Stage 1: build frontend using node
FROM node:18-alpine AS frontend-builder
WORKDIR /src/frontend
COPY frontend/package*.json ./
COPY frontend/ ./
RUN npm install --no-audit --no-fund
RUN npm run build

# Stage 2: build Go backend
FROM golang:1.21-alpine AS go-builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -v -o /out/ntest .

# Final image
FROM alpine:3.18
RUN apk add --no-cache ca-certificates iputils curl bind-tools
COPY --from=go-builder /out/ntest /usr/local/bin/ntest
COPY --from=frontend-builder /src/frontend/build /app/frontend/build
WORKDIR /app
ENV HTTP_PORT=8080
EXPOSE 8080
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["/usr/local/bin/ntest"]
