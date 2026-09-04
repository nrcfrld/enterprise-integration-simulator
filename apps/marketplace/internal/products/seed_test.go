package products

import (
	"strings"
	"testing"

	dummygenerator "github.com/enrico/enterprise-integration-simulator/packages/dummy-generator"
)

func TestSeedCatalogProduct(t *testing.T) {
	t.Parallel()
	first := SeedCatalogProduct(dummygenerator.New(CatalogSeed), 12)
	second := SeedCatalogProduct(dummygenerator.New(CatalogSeed), 12)

	if first != second {
		t.Fatalf("SeedCatalogProduct() is not deterministic: %#v != %#v", first, second)
	}
	if first.SKU != "SIM-012" || first.Name == "" || first.Category == "" {
		t.Fatalf("SeedCatalogProduct() identity fields = %#v", first)
	}
	if !strings.HasPrefix(first.Description, first.Category+" · ") {
		t.Fatalf("SeedCatalogProduct() description = %q", first.Description)
	}
	if first.Price <= 0 || first.Price%1000 != 0 || first.Stock < 8 || first.Stock > 80 {
		t.Fatalf("SeedCatalogProduct() marketplace values = %#v", first)
	}
}
