// Command go-client lists SHOPEE_LIKE products using the provider public API.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	baseURL := env("MARKETPLACE_BASE_URL", "http://127.0.0.1:18080")
	clientID := os.Getenv("MARKETPLACE_CLIENT_ID")
	clientSecret := os.Getenv("MARKETPLACE_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		fmt.Fprintln(os.Stderr, "MARKETPLACE_CLIENT_ID and MARKETPLACE_CLIENT_SECRET are required")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	response, err := signedRequest(ctx, http.MethodGet, baseURL, "/api/shopee/v1/products?page_no=1&page_size=10", clientID, clientSecret, nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "request failed:", err)
		os.Exit(1)
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "close response body:", err)
		}
	}()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read response:", err)
		os.Exit(1)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fmt.Fprintf(os.Stderr, "marketplace returned %d: %s\n", response.StatusCode, body)
		os.Exit(1)
	}
	fmt.Println(string(body))
}

func signedRequest(ctx context.Context, method, baseURL, path, clientID, secret string, body []byte) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(baseURL, "/")+path, strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(clientID + request.URL.Path + timestamp + string(body)))
	request.Header.Set("X-Shopee-Partner-Id", clientID)
	request.Header.Set("X-Shopee-Timestamp", timestamp)
	request.Header.Set("X-Shopee-Signature", hex.EncodeToString(mac.Sum(nil)))
	return http.DefaultClient.Do(request)
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
