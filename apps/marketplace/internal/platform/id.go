package platform

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// NewID creates an opaque, sortable-prefix-compatible public identifier.
func NewID(prefix string) string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("generate random ID: %v", err))
	}
	return prefix + "_" + hex.EncodeToString(buf)
}
