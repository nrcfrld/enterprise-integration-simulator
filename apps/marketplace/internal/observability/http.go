// Package observability provides small, dependency-free HTTP signals for the simulator.
package observability

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

const RequestIDHeader = "X-Request-ID"

// HTTPMetrics records process-local request counts suitable for a single simulator deployment.
type HTTPMetrics struct {
	requests  atomic.Int64
	inFlight  atomic.Int64
	responses [5]atomic.Int64
}

// NewHTTPMetrics creates an empty request counter.
func NewHTTPMetrics() *HTTPMetrics { return &HTTPMetrics{} }

// Middleware assigns a safe request ID, emits structured request logs, and records response classes.
func (m *HTTPMetrics) Middleware(logger *slog.Logger) gin.HandlerFunc {
	if logger == nil {
		logger = slog.Default()
	}
	return func(c *gin.Context) {
		requestID := sanitizeRequestID(c.GetHeader(RequestIDHeader))
		if requestID == "" {
			requestID = newRequestID()
		}
		c.Set(RequestIDHeader, requestID)
		c.Header(RequestIDHeader, requestID)
		m.inFlight.Add(1)
		started := time.Now()
		c.Next()
		m.inFlight.Add(-1)
		m.requests.Add(1)
		status := c.Writer.Status()
		m.responses[responseClass(status)].Add(1)
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		logger.Info("http request",
			"request_id", requestID,
			"method", c.Request.Method,
			"route", route,
			"status", status,
			"duration_ms", time.Since(started).Milliseconds(),
			"client_ip", c.ClientIP(),
		)
	}
}

// Recovery converts panics into a correlated JSON error and logs the stack trace.
func Recovery(logger *slog.Logger) gin.HandlerFunc {
	if logger == nil {
		logger = slog.Default()
	}
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("http handler panic", "request_id", RequestID(c), "error", recovered, "stack", string(debug.Stack()))
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_ERROR", "message": "unexpected server error"}})
			}
		}()
		c.Next()
	}
}

// Handler exposes Prometheus-compatible counters without adding a metrics dependency.
func (m *HTTPMetrics) Handler(c *gin.Context) {
	c.Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = fmt.Fprintf(c.Writer, "# HELP marketplace_http_requests_total Total HTTP requests completed.\n# TYPE marketplace_http_requests_total counter\nmarketplace_http_requests_total %d\n", m.requests.Load())
	_, _ = fmt.Fprintf(c.Writer, "# HELP marketplace_http_in_flight_requests Current HTTP requests in progress.\n# TYPE marketplace_http_in_flight_requests gauge\nmarketplace_http_in_flight_requests %d\n", m.inFlight.Load())
	_, _ = fmt.Fprintln(c.Writer, "# HELP marketplace_http_responses_total HTTP responses grouped by status class.\n# TYPE marketplace_http_responses_total counter")
	for class := 1; class <= 5; class++ {
		_, _ = fmt.Fprintf(c.Writer, "marketplace_http_responses_total{code_class=\"%dxx\"} %d\n", class, m.responses[class-1].Load())
	}
}

// RequestID returns the ID assigned by Middleware, if any.
func RequestID(c *gin.Context) string {
	value, _ := c.Get(RequestIDHeader)
	id, _ := value.(string)
	return id
}

func responseClass(status int) int {
	if status < 100 || status > 599 {
		return 4
	}
	return status/100 - 1
}

func sanitizeRequestID(value string) string {
	if len(value) == 0 || len(value) > 128 {
		return ""
	}
	for _, character := range value {
		if !allowedRequestIDCharacter(character) {
			return ""
		}
	}
	return value
}

func allowedRequestIDCharacter(character rune) bool {
	return character >= 'a' && character <= 'z' ||
		character >= 'A' && character <= 'Z' ||
		character >= '0' && character <= '9' ||
		character == '-' || character == '_' || character == '.'
}

func newRequestID() string {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return "req_" + hex.EncodeToString(bytes)
}
