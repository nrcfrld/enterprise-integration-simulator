package events

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type recordingTx struct {
	pgx.Tx
	arguments [][]any
	err       error
}

func (t *recordingTx) Exec(_ context.Context, _ string, arguments ...any) (pgconn.CommandTag, error) {
	t.arguments = append(t.arguments, arguments)
	return pgconn.CommandTag{}, t.err
}

func TestRecord(t *testing.T) {
	t.Parallel()
	t.Run("writes event and outbox in order", func(t *testing.T) {
		tx := &recordingTx{}
		if err := Record(context.Background(), tx, "shop_1", "order.paid", "ord_1", map[string]any{"total": 100}); err != nil {
			t.Fatalf("Record() error = %v", err)
		}
		if len(tx.arguments) != 2 {
			t.Fatalf("Exec calls = %d, want 2", len(tx.arguments))
		}
		eventID, _ := tx.arguments[0][0].(string)
		outboxEventID, _ := tx.arguments[1][1].(string)
		if eventID == "" || eventID != outboxEventID {
			t.Fatalf("outbox event id = %q, want %q", outboxEventID, eventID)
		}
	})
	t.Run("does not write a payload that cannot be marshalled", func(t *testing.T) {
		tx := &recordingTx{}
		err := Record(context.Background(), tx, "shop_1", "order.paid", "ord_1", map[string]float64{"invalid": math.Inf(1)})
		if err == nil || len(tx.arguments) != 0 {
			t.Fatalf("Record() error = %v, calls = %d", err, len(tx.arguments))
		}
	})
	t.Run("returns database failure", func(t *testing.T) {
		failure := errors.New("database unavailable")
		tx := &recordingTx{err: failure}
		if !errors.Is(Record(context.Background(), tx, "shop_1", "order.paid", "ord_1", map[string]string{}), failure) {
			t.Fatal("Record() did not preserve database error")
		}
	})
}
