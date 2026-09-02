package auth

import "testing"

func TestIssueAndParse(t *testing.T) {
	t.Parallel()
	secret := []byte("test-session-secret")
	issued, err := Issue(secret, Claims{ID: "usr_1", Email: "admin@example.test", Role: "ADMIN", SessionVersion: 2})
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	claims, err := Parse(secret, issued)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if claims.ID != "usr_1" || claims.SessionVersion != 2 {
		t.Fatalf("claims = %#v", claims)
	}
}

func TestParseRejectsTamperedToken(t *testing.T) {
	t.Parallel()
	issued, err := Issue([]byte("test-session-secret"), Claims{ID: "usr_1"})
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	if _, err := Parse([]byte("different-secret"), issued); err == nil {
		t.Fatal("Parse() accepted a token with a different secret")
	}
}
