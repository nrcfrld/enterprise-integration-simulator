// Package auth owns control-plane session token encoding and verification.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Claims identify an authenticated control-plane actor.
type Claims struct {
	ID             string `json:"id"`
	Email          string `json:"email"`
	Role           string `json:"role"`
	SessionVersion int    `json:"session_version"`
	Exp            int64  `json:"exp"`
}

// Issue creates a signed, twelve-hour session token.
func Issue(secret []byte, claims Claims) (string, error) {
	claims.Exp = time.Now().Add(12 * time.Hour).Unix()
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("marshal session claims: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

// Parse verifies a token signature and expiration without querying persistence.
func Parse(secret []byte, token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return Claims{}, fmt.Errorf("invalid token")
	}
	provided, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, fmt.Errorf("decode token signature: %w", err)
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0]))
	if subtle.ConstantTimeCompare(mac.Sum(nil), provided) != 1 {
		return Claims{}, fmt.Errorf("invalid token signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, fmt.Errorf("decode token claims: %w", err)
	}
	var claims Claims
	if err := json.Unmarshal(raw, &claims); err != nil || claims.Exp < time.Now().Unix() {
		return Claims{}, fmt.Errorf("expired or malformed token")
	}
	return claims, nil
}
