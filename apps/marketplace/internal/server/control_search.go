package server

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

// Filter the complete shop-scoped result before calculating pagination totals.
func (s *Server) controlSearchResponse(c *gin.Context, data []gin.H, fields ...string) {
	query := strings.ToLower(strings.TrimSpace(c.Query("q")))
	status := strings.TrimSpace(c.Query("status"))
	filtered := make([]gin.H, 0, len(data))
	for _, row := range data {
		if status != "" && !strings.EqualFold(fmt.Sprint(row["status"]), status) {
			continue
		}
		matches := query == ""
		for _, field := range fields {
			if value, ok := row[field]; ok && strings.Contains(strings.ToLower(fmt.Sprint(value)), query) {
				matches = true
			}
		}
		if matches {
			filtered = append(filtered, row)
		}
	}
	s.controlListResponse(c, filtered)
}
