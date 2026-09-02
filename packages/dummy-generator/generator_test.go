package dummygenerator

import "testing"

func TestGeneratorIsDeterministicAndUseful(t *testing.T) {
	t.Parallel()
	first, second := New(42), New(42)
	if first.Product() != second.Product() {
		t.Fatal("product output must be deterministic for a seed")
	}
	if customer := first.Customer(); customer.Name == "" || customer.Phone == "" {
		t.Fatalf("customer missing data: %#v", customer)
	}
	if address := first.IndonesianAddress(); address.AddressLine == "" || address.City == "" || len(address.PostalCode) != 5 {
		t.Fatalf("address missing data: %#v", address)
	}
}
