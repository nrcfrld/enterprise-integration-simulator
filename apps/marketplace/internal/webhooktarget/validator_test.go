package webhooktarget

import (
	"net/http"
	"testing"
	"time"
)

func TestValidateURL(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, rawURL string
		allowPrivate bool
		wantErr      bool
	}{
		{name: "public https URL", rawURL: "https://hooks.example.test/events"},
		{name: "development loopback", rawURL: "http://127.0.0.1:9000/hook", allowPrivate: true},
		{name: "production loopback", rawURL: "http://127.0.0.1:9000/hook", wantErr: true},
		{name: "production localhost", rawURL: "http://localhost:9000/hook", wantErr: true},
		{name: "production private address", rawURL: "http://10.0.0.1/hook", wantErr: true},
		{name: "production cloud metadata address", rawURL: "http://169.254.169.254/latest/meta-data", wantErr: true},
		{name: "production IPv6 loopback", rawURL: "http://[::1]:9000/hook", wantErr: true},
		{name: "production IPv6 unique local", rawURL: "http://[fd00::1]/hook", wantErr: true},
		{name: "unspecified address", rawURL: "http://0.0.0.0/hook", wantErr: true},
		{name: "credentials are rejected", rawURL: "https://user:secret@example.test/hook", wantErr: true},
		{name: "unsupported scheme", rawURL: "file:///tmp/hook", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateURL(test.rawURL, test.allowPrivate)
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateURL(%q) error = %v, wantErr %t", test.rawURL, err, test.wantErr)
			}
		})
	}
}

func TestClientRevalidatesRedirectTargets(t *testing.T) {
	t.Parallel()
	client := Client(time.Second, false)
	request, err := http.NewRequest(http.MethodGet, "http://169.254.169.254/latest/meta-data", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.CheckRedirect(request, nil); err == nil {
		t.Fatal("private redirect target was accepted")
	}

	developmentClient := Client(time.Second, true)
	if err := developmentClient.CheckRedirect(request, nil); err != nil {
		t.Fatalf("private redirect target should be allowed in development: %v", err)
	}
	if err := developmentClient.CheckRedirect(request, make([]*http.Request, 10)); err == nil {
		t.Fatal("redirect limit was not enforced")
	}
	if transport, ok := client.Transport.(*http.Transport); !ok || transport.Proxy != nil {
		t.Fatal("webhook client must bypass process-wide HTTP proxies")
	}
}
