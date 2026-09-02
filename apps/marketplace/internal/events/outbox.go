// Package events records durable domain events and their transactional outbox rows.
package events

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/enrico/enterprise-integration-simulator/apps/marketplace/internal/platform"
)

// Record writes an event and its outbox entry in the caller's transaction.
func Record(ctx context.Context, tx pgx.Tx, shopID, eventType, aggregateID string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	eventID := platform.NewID("evt")
	if _, err := tx.Exec(ctx, `INSERT INTO domain_events(id,shop_id,event_type,aggregate_id,payload) VALUES($1,$2,$3,$4,$5)`, eventID, shopID, eventType, aggregateID, raw); err != nil {
		return fmt.Errorf("insert event: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO outbox(id,event_id) VALUES($1,$2)`, platform.NewID("out"), eventID); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}
