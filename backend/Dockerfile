FROM golang:1.21-alpine AS builder

# Install necessary packages for network tools
RUN apk add --no-cache git iputils

WORKDIR /app

# Copy go mod files
COPY go.mod ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Final stage
FROM alpine:latest

# Install network utilities and ca-certificates
RUN apk --no-cache add ca-certificates iputils curl bind-tools

WORKDIR /root/

# Copy the binary from builder
COPY --from=builder /app/main .

# Expose port
EXPOSE 8080

# Run the application
CMD ["./main"]
