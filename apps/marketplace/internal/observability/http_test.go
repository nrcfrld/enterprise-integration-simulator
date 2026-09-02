package observability

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSanitizeRequestID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, input, want string
	}{
		{"safe ID", "trace-42.alpha", "trace-42.alpha"},
		{"empty", "", ""},
		{"contains whitespace", "trace id", ""},
		{"contains newline", "trace\nnext", ""},
		{"too long", string(make([]byte, 129)), ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := sanitizeRequestID(test.input); got != test.want {
				t.Fatalf("sanitizeRequestID(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestResponseClass(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ status, want int }{{200, 1}, {404, 3}, {500, 4}, {99, 4}, {600, 4}} {
		if got := responseClass(test.status); got != test.want {
			t.Fatalf("responseClass(%d) = %d, want %d", test.status, got, test.want)
		}
	}
}

func TestMiddlewareCorrelatesAndCountsRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	metrics := NewHTTPMetrics()
	router := gin.New()
	router.Use(metrics.Middleware(slog.New(slog.NewJSONHandler(io.Discard, nil))))
	router.GET("/widgets/:id", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	request := httptest.NewRequest(http.MethodGet, "/widgets/42", nil)
	request.Header.Set(RequestIDHeader, "integration.trace-42")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if got := recorder.Header().Get(RequestIDHeader); got != "integration.trace-42" {
		t.Fatalf("request ID = %q", got)
	}
	if got := metrics.requests.Load(); got != 1 {
		t.Fatalf("requests = %d, want 1", got)
	}
	if got := metrics.responses[1].Load(); got != 1 {
		t.Fatalf("2xx responses = %d, want 1", got)
	}
}
