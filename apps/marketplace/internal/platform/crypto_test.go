package platform

import "testing"

func TestEncryptDecrypt(t *testing.T) {
	t.Parallel()
	key := []byte("01234567890123456789012345678901")
	ciphertext, err := Encrypt(key, "marketplace-secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if ciphertext == "marketplace-secret" {
		t.Fatal("secret was not encrypted")
	}
	plaintext, err := Decrypt(key, ciphertext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if plaintext != "marketplace-secret" {
		t.Fatalf("got %q", plaintext)
	}
}
