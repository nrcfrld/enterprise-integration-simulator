package orders

import "testing"

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
