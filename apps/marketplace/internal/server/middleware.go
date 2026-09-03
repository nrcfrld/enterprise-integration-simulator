package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const requestBodyContextKey = "marketplace.request_body"

type responseRecorder struct {
	gin.ResponseWriter
	body   bytes.Buffer
	status int
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	r.WriteHeaderNow()
	return r.body.Write(data)
}

func (r *responseRecorder) WriteString(value string) (int, error) {
	r.WriteHeaderNow()
	return r.body.WriteString(value)
}

func (r *responseRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}

func (r *responseRecorder) WriteHeaderNow() {
	if r.status == 0 {
		r.status = http.StatusOK
	}
}

func (r *responseRecorder) Status() int {
	if r.status == 0 {
		return http.StatusOK
	}
	return r.status
}

func (r *responseRecorder) Size() int {
	return r.body.Len()
}

func (r *responseRecorder) Written() bool {
	return r.status != 0
}

// Flush deliberately buffers idempotent responses until the database claim is
// complete. Public mutations do not support streaming responses.
func (r *responseRecorder) Flush() {
	r.WriteHeaderNow()
}

func (r *responseRecorder) commit() error {
	r.ResponseWriter.WriteHeader(r.Status())
	if r.body.Len() == 0 {
		return nil
	}
	_, err := r.ResponseWriter.Write(r.body.Bytes())
	return err
}

const (
	corsAllowedHeaders = "Authorization, Content-Type, Idempotency-Key, X-Client-Id, X-Timestamp, X-Signature, X-Shopee-Partner-Id, X-Shopee-Timestamp, X-Shopee-Signature, x-tts-access-token"
	corsExposedHeaders = "Idempotent-Replayed, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Shopee-Api-Call-Limit, X-Shopee-RateLimit-Reset, X-TTS-Api-Call-Limit, X-TTS-RateLimit-Limit, X-TTS-RateLimit-Remaining, X-TTS-RateLimit-Reset"
)

func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if isDevelopmentOrigin(origin) {
			c.Header("Access-Control-Allow-Origin", origin)
			appendVary(c, "Origin")
		}
		c.Header("Access-Control-Allow-Headers", corsAllowedHeaders)
		c.Header("Access-Control-Expose-Headers", corsExposedHeaders)
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			appendVary(c, "Access-Control-Request-Headers")
			appendVary(c, "Access-Control-Request-Method")
			c.Status(http.StatusNoContent)
			c.Abort()
			return
		}
		c.Next()
	}
}

func isDevelopmentOrigin(origin string) bool {
	return origin == "http://localhost:5173" || origin == "http://127.0.0.1:5173"
}

func appendVary(c *gin.Context, value string) {
	current := c.Writer.Header().Values("Vary")
	for _, entry := range current {
		for _, existing := range strings.Split(entry, ",") {
			if strings.EqualFold(strings.TrimSpace(existing), value) {
				return
			}
		}
	}
	c.Writer.Header().Add("Vary", value)
}

func readRequestBody(c *gin.Context, limit int64) ([]byte, error) {
	if limit <= 0 {
		limit = 1 << 20
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil, err
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	return body, nil
}

func isRequestTooLarge(err error) bool {
	var maxBytesError *http.MaxBytesError
	return errors.As(err, &maxBytesError)
}

func setRequestBody(c *gin.Context, body []byte) {
	c.Set(requestBodyContextKey, append([]byte(nil), body...))
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
}

func requestBody(c *gin.Context) []byte {
	body, _ := c.Get(requestBodyContextKey)
	raw, _ := body.([]byte)
	return raw
}

func requestFingerprint(request *http.Request, body []byte) string {
	query := request.URL.Query()
	// Tokopedia-like authentication uses volatile query parameters. They prove
	// request authenticity but are not part of the logical mutation identity.
	query.Del("timestamp")
	query.Del("sign")
	query.Del("app_key")
	canonical := request.Method + "\n" + request.URL.Path
	if encoded := query.Encode(); encoded != "" {
		canonical += "?" + encoded
	}
	digest := sha256.Sum256(append([]byte(canonical+"\n"), body...))
	return hex.EncodeToString(digest[:])
}
