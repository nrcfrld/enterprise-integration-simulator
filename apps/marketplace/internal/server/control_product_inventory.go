package server

import (
	"context"

	"github.com/gin-gonic/gin"
)

func (s *Server) productInventory(ctx context.Context, shop, product string) ([]gin.H, error) {
	rows, err := s.db.Query(ctx, `SELECT w.id,w.code,w.name,w.status,w.priority,COALESCE(i.on_hand_quantity,0),COALESCE(i.reserved_quantity,0)
 FROM warehouses w LEFT JOIN warehouse_inventory i ON i.warehouse_id=w.id AND i.product_id=$2
 WHERE w.shop_id=$1 ORDER BY w.priority DESC,w.code`, shop, product)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	data := []gin.H{}
	for rows.Next() {
		var id, code, name, status string
		var priority, onHand, reserved int
		if err := rows.Scan(&id, &code, &name, &status, &priority, &onHand, &reserved); err != nil {
			return nil, err
		}
		data = append(data, gin.H{"warehouse_id": id, "code": code, "name": name, "status": status, "priority": priority, "on_hand_quantity": onHand, "reserved_quantity": reserved, "available_quantity": onHand - reserved})
	}
	return data, rows.Err()
}
