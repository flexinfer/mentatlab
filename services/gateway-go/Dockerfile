FROM golang:1.24-alpine AS builder

# Accept cache proxy for Go modules
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o gateway main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates curl
WORKDIR /app
COPY --from=builder /app/gateway .
EXPOSE 8080
USER 65534:65534
CMD ["./gateway"]
