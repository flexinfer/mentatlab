// Package metrics provides Prometheus metrics for the gateway service.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// HTTPRequestsTotal counts HTTP requests by method, path, and status.
	HTTPRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "http_requests_total",
			Help:      "Total number of HTTP requests",
		},
		[]string{"method", "path", "status"},
	)

	// HTTPRequestDuration tracks request latency by method and path.
	HTTPRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "http_request_duration_seconds",
			Help:      "HTTP request duration in seconds",
			Buckets:   prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)

	// WebSocketConnections tracks active WebSocket connections.
	WebSocketConnections = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "websocket_connections_active",
			Help:      "Number of active WebSocket connections",
		},
	)

	// WebSocketMessagesTotal counts WebSocket messages by direction.
	WebSocketMessagesTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "websocket_messages_total",
			Help:      "Total number of WebSocket messages",
		},
		[]string{"direction"}, // "inbound" or "outbound"
	)

	// SSEConnectionsTotal counts SSE connections.
	SSEConnectionsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "sse_connections_total",
			Help:      "Total number of SSE connections established",
		},
	)

	// SSEConnectionsActive tracks active SSE connections.
	SSEConnectionsActive = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "sse_connections_active",
			Help:      "Number of active SSE connections",
		},
	)

	// RedisSubscriptions tracks active Redis pubsub subscriptions.
	RedisSubscriptions = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "redis_subscriptions_active",
			Help:      "Number of active Redis pubsub subscriptions",
		},
	)

	// ProxyRequestsTotal counts proxied requests by target service.
	ProxyRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "proxy_requests_total",
			Help:      "Total number of proxied requests",
		},
		[]string{"target", "status"},
	)

	// ProxyRequestDuration tracks proxy latency by target.
	ProxyRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mentatlab",
			Subsystem: "gateway",
			Name:      "proxy_request_duration_seconds",
			Help:      "Proxy request duration in seconds",
			Buckets:   prometheus.DefBuckets,
		},
		[]string{"target"},
	)
)
