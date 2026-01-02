FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o orchestrator ./cmd/orchestrator/

FROM alpine:latest
RUN apk --no-cache add ca-certificates curl
WORKDIR /app
COPY --from=builder /app/orchestrator .
EXPOSE 7070
USER 65534:65534
CMD ["./orchestrator"]
