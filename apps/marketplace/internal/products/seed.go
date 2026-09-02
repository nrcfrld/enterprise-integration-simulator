// Package products owns marketplace-specific catalogue rules.
package products

import (
	"fmt"

	dummygenerator "github.com/enrico/enterprise-integration-simulator/packages/dummy-generator"
)

// CatalogSeed keeps the development catalogue stable between targeted resets.
const CatalogSeed int64 = 20260831

// SeedProduct combines generic dummy text with marketplace catalogue rules.
type SeedProduct struct {
	SKU         string
	Name        string
	Category    string
	Description string
	Price       int64
	Stock       int
}

// SeedCatalogProduct creates a valid product at a deterministic position.
func SeedCatalogProduct(generator *dummygenerator.Generator, position int) SeedProduct {
	details := generator.Product()
	return SeedProduct{
		SKU:         fmt.Sprintf("SIM-%03d", position),
		Name:        details.Name,
		Category:    details.Category,
		Description: fmt.Sprintf("%s · %s", details.Category, details.Description),
		Price:       int64(25+(position*37)%2476) * 1000,
		Stock:       8 + (position*11)%73,
	}
}
