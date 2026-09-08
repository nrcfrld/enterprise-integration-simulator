package server

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

const eventFilter = ` FROM domain_events e WHERE e.shop_id=$1
 AND ($2='' OR e.aggregate_id=$2)
 AND ($3='' OR split_part(e.event_type,'.',1)=$3)
 AND ($4='' OR e.event_type=$4)`

// shopEvents filters before pagination, including events whose resource is archived.
func (s *Server) shopEvents(c *gin.Context) {
	shop := c.Param("id")
	if !s.mustAccessShop(c, shop) {
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		c.JSON(400, errorBody("INVALID_REQUEST", "page must be a positive integer"))
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if err != nil || limit < 1 || limit > 100 {
		c.JSON(400, errorBody("INVALID_REQUEST", "limit must be between 1 and 100"))
		return
	}
	resource := c.Query("resource_type")
	if resource != "" && resource != "order" && resource != "shipment" && resource != "product" {
		c.JSON(400, errorBody("INVALID_REQUEST", "resource_type must be order, shipment, or product"))
		return
	}
	args := []any{shop, c.Query("aggregate_id"), resource, c.Query("event_type")}
	var total int
	if err := s.db.QueryRow(c, `SELECT count(*)`+eventFilter, args...).Scan(&total); err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not count events"))
		return
	}
	totalPages := max(1, (total+limit-1)/limit)
	page = min(page, totalPages)
	data, err := s.queryEvents(c, args, limit, (page-1)*limit)
	if err != nil {
		c.JSON(500, errorBody("DATABASE_ERROR", "could not load events"))
		return
	}
	c.JSON(200, gin.H{"data": data, "pagination": gin.H{"page": page, "limit": limit, "total": total, "total_pages": totalPages, "has_next": page < totalPages, "has_previous": page > 1}})
}

func (s *Server) resourceEvents(ctx context.Context, shop, aggregate string) ([]gin.H, error) {
	// Detail trails include all events for the resource; the shop feed is paginated.
	return s.queryEvents(ctx, []any{shop, aggregate, "", ""}, nil, 0)
}

func (s *Server) queryEvents(ctx context.Context, args []any, limit any, offset int) ([]gin.H, error) {
	rows, err := s.db.Query(ctx, `SELECT e.id,e.event_type,e.aggregate_id,split_part(e.event_type,'.',1),e.occurred_at,e.payload,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'event_id',d.event_id,'status',d.status,'attempt_count',d.attempt_count) ORDER BY d.created_at,d.id) FROM webhook_deliveries d WHERE d.event_id=e.id),'[]'::jsonb)`+eventFilter+` ORDER BY e.occurred_at DESC,e.id DESC LIMIT $5 OFFSET $6`, append(args, limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, event, aggregate, resource string
		var at time.Time
		var payload, deliveries []byte
		if err := rows.Scan(&id, &event, &aggregate, &resource, &at, &payload, &deliveries); err != nil {
			return nil, err
		}
		data = append(data, gin.H{"id": id, "event_type": event, "aggregate_id": aggregate, "aggregate_type": resource, "occurred_at": at, "payload": json.RawMessage(payload), "deliveries": json.RawMessage(deliveries)})
	}
	return data, rows.Err()
}
