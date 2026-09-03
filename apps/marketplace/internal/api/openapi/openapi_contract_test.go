package openapi

import (
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type contractDocument struct {
	Paths      map[string]contractPathItem `yaml:"paths"`
	Components struct {
		Parameters map[string]struct {
			Name     string `yaml:"name"`
			In       string `yaml:"in"`
			Required bool   `yaml:"required"`
		} `yaml:"parameters"`
	} `yaml:"components"`
}

type contractOperation struct {
	Parameters []struct {
		Ref string `yaml:"$ref"`
	} `yaml:"parameters"`
	Responses map[string]any `yaml:"responses"`
}

type contractPathItem struct {
	Get    *contractOperation `yaml:"get"`
	Post   *contractOperation `yaml:"post"`
	Put    *contractOperation `yaml:"put"`
	Patch  *contractOperation `yaml:"patch"`
	Delete *contractOperation `yaml:"delete"`
}

func (item contractPathItem) operations() map[string]*contractOperation {
	return map[string]*contractOperation{
		"GET": item.Get, "POST": item.Post, "PUT": item.Put,
		"PATCH": item.Patch, "DELETE": item.Delete,
	}
}

func TestPublicMutationIdempotencyContract(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("../../../openapi/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var document contractDocument
	if err := yaml.Unmarshal(raw, &document); err != nil {
		t.Fatalf("parse OpenAPI document: %v", err)
	}
	parameter := document.Components.Parameters["IdempotencyKey"]
	if parameter.Name != "Idempotency-Key" || parameter.In != "header" || !parameter.Required {
		t.Fatalf("IdempotencyKey component must be a required header: %+v", parameter)
	}

	for path, pathItem := range document.Paths {
		if !strings.HasPrefix(path, "/api/") {
			continue
		}
		for method, operation := range pathItem.operations() {
			if operation == nil {
				continue
			}
			mutation := method != httpMethodGet && !strings.HasSuffix(path, "/search")
			hasKey := false
			for _, parameter := range operation.Parameters {
				if parameter.Ref == "#/components/parameters/IdempotencyKey" {
					hasKey = true
				}
			}
			if hasKey != mutation {
				t.Errorf("%s %s idempotency parameter = %t, want %t", method, path, hasKey, mutation)
			}
			if mutation {
				for _, status := range []string{"409", "413"} {
					if _, ok := operation.Responses[status]; !ok {
						t.Errorf("%s %s is missing documented %s response", method, path, status)
					}
				}
			}
		}
	}
}

const httpMethodGet = "GET"
