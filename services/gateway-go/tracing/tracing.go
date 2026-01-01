// Package tracing provides OpenTelemetry tracing configuration for the gateway.
package tracing

import (
	"context"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Config holds tracing configuration.
type Config struct {
	// ServiceName is the name of the service for tracing
	ServiceName string

	// ServiceVersion is the version of the service
	ServiceVersion string

	// OTLPEndpoint is the OTLP collector endpoint (e.g., "localhost:4317")
	OTLPEndpoint string

	// Enabled controls whether tracing is enabled
	Enabled bool

	// SampleRate is the sampling rate (0.0 to 1.0)
	SampleRate float64
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		ServiceName:    "mentatlab-gateway",
		ServiceVersion: "1.0.0",
		OTLPEndpoint:   "localhost:4317",
		Enabled:        false,
		SampleRate:     1.0,
	}
}

// Provider wraps the OpenTelemetry TracerProvider.
type Provider struct {
	provider *sdktrace.TracerProvider
	logger   *slog.Logger
}

// Init initializes the OpenTelemetry tracing provider.
func Init(ctx context.Context, cfg *Config, logger *slog.Logger) (*Provider, error) {
	if cfg == nil {
		cfg = DefaultConfig()
	}
	if logger == nil {
		logger = slog.Default()
	}

	if !cfg.Enabled {
		logger.Info("tracing disabled")
		return &Provider{logger: logger}, nil
	}

	// Create OTLP exporter
	exporter, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(cfg.OTLPEndpoint),
		otlptracegrpc.WithInsecure(), // Use TLS in production
		otlptracegrpc.WithTimeout(5*time.Second),
	)
	if err != nil {
		return nil, err
	}

	// Create resource with service info
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(cfg.ServiceName),
			semconv.ServiceVersion(cfg.ServiceVersion),
		),
	)
	if err != nil {
		return nil, err
	}

	// Create sampler based on sample rate
	var sampler sdktrace.Sampler
	if cfg.SampleRate >= 1.0 {
		sampler = sdktrace.AlwaysSample()
	} else if cfg.SampleRate <= 0.0 {
		sampler = sdktrace.NeverSample()
	} else {
		sampler = sdktrace.TraceIDRatioBased(cfg.SampleRate)
	}

	// Create tracer provider
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	)

	// Set global tracer provider
	otel.SetTracerProvider(tp)

	// Set global propagator (W3C Trace Context + Baggage)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	logger.Info("tracing initialized",
		slog.String("endpoint", cfg.OTLPEndpoint),
		slog.Float64("sample_rate", cfg.SampleRate),
	)

	return &Provider{
		provider: tp,
		logger:   logger,
	}, nil
}

// Shutdown gracefully shuts down the tracer provider.
func (p *Provider) Shutdown(ctx context.Context) error {
	if p.provider == nil {
		return nil
	}

	p.logger.Info("shutting down tracer provider...")
	return p.provider.Shutdown(ctx)
}

// TracerProvider returns the underlying TracerProvider.
func (p *Provider) TracerProvider() *sdktrace.TracerProvider {
	return p.provider
}
