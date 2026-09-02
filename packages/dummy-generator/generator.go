// Package dummygenerator provides deterministic, domain-neutral sample data.
// Applications compose the generated values with their own identifiers, prices,
// stock levels, and other business rules.
package dummygenerator

import "github.com/brianvoe/gofakeit/v7"

// ProductDetails are generic catalogue words with no marketplace-specific rules.
type ProductDetails struct {
	Name        string
	Description string
	Category    string
}

// Customer contains generic customer contact data suitable for local demos.
type Customer struct {
	Name  string
	Phone string
}

// Address is a generic Indonesian postal address for local development fixtures.
type Address struct {
	AddressLine string
	City        string
	PostalCode  string
}

// Generator produces repeatable fake records from a supplied seed.
type Generator struct{ faker *gofakeit.Faker }

// New constructs a deterministic generator.
func New(seed int64) *Generator { return &Generator{faker: gofakeit.New(uint64(seed))} }

// Product creates readable catalogue text. Pricing and inventory remain a domain concern.
func (g *Generator) Product() ProductDetails {
	category := g.faker.ProductCategory()
	return ProductDetails{
		Name:        g.faker.ProductName(),
		Description: g.faker.ProductDescription(),
		Category:    category,
	}
}

// Customer creates sample contact data.
func (g *Generator) Customer() Customer {
	return Customer{Name: g.faker.Name(), Phone: g.faker.PhoneFormatted()}
}

// IndonesianAddress creates a local-looking address without depending on an application domain.
func (g *Generator) IndonesianAddress() Address {
	return Address{
		AddressLine: "Jl. " + g.faker.Street() + " No. " + g.faker.DigitN(2),
		City:        g.faker.RandomString([]string{"Jakarta", "Bandung", "Surabaya", "Yogyakarta"}),
		PostalCode:  g.faker.DigitN(5),
	}
}
