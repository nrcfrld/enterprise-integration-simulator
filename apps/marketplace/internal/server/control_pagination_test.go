package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestControlPaginationIncludesRecordsBeyondOneThousand(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rows := make([]gin.H, 1001)
	for i := range rows {
		rows[i] = gin.H{"id": fmt.Sprintf("product_%d", i+1)}
	}
	router := gin.New()
	router.GET("/products", func(c *gin.Context) { (&Server{}).controlListResponse(c, rows) })
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/products?page=11&limit=100", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Pagination struct {
			Total      int `json:"total"`
			TotalPages int `json:"total_pages"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "product_1001" || body.Pagination.Total != 1001 || body.Pagination.TotalPages != 11 {
		t.Fatalf("incomplete page: %s", response.Body.String())
	}
}
