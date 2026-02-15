FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY src/ ./src/
RUN CGO_ENABLED=0 go build -o /agent ./src/main.go

FROM alpine:3.20
COPY --from=builder /agent /usr/local/bin/agent
ENTRYPOINT ["agent"]
