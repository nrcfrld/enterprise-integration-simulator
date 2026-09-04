package orders

import "testing"

func TestProviderNormalizationAndSupport(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		provider   string
		normalized string
		supported  bool
	}{
		{name: "empty provider defaults to Shopee", provider: "", normalized: ShopeeLike, supported: true},
		{name: "provider is trimmed and uppercased", provider: " tokopedia_like ", normalized: TokopediaLike, supported: true},
		{name: "unknown provider is rejected", provider: "generic", normalized: "GENERIC", supported: false},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := NormaliseProvider(test.provider); got != test.normalized {
				t.Fatalf("NormaliseProvider(%q) = %q, want %q", test.provider, got, test.normalized)
			}
			if got := SupportsProvider(test.provider); got != test.supported {
				t.Fatalf("SupportsProvider(%q) = %t, want %t", test.provider, got, test.supported)
			}
		})
	}
}

func TestShopeeLikeCancellationPolicy(t *testing.T) {
	tests := []struct {
		name, provider, status, actor string
		want                          bool
	}{
		{"customer may cancel unpaid", ShopeeLike, Unpaid, Customer, true},
		{"customer may cancel paid before seller process", ShopeeLike, Paid, Customer, true},
		{"customer cannot cancel while seller processes", ShopeeLike, Processing, Customer, false},
		{"seller may cancel processing stock issue", ShopeeLike, Processing, Seller, true},
		{"seller cannot cancel ready package", ShopeeLike, ReadyToShip, Seller, false},
		{"system may expire unpaid", ShopeeLike, Unpaid, System, true},
		{"tokopedia keeps canonical cancellation", TokopediaLike, Processing, Customer, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := CanCancel(test.provider, test.status, test.actor); got != test.want {
				t.Fatalf("CanCancel(%q, %q, %q) = %t, want %t", test.provider, test.status, test.actor, got, test.want)
			}
		})
	}
}
