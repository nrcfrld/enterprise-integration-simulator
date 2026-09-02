package inventory

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type inventoryRow struct {
	warehouseID string
	err         error
}

func (r inventoryRow) Scan(destinations ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(destinations) != 1 {
		return errors.New("unexpected scan destinations")
	}
	*destinations[0].(*string) = r.warehouseID
	return nil
}

type inventoryTx struct {
	pgx.Tx
	row       pgx.Row
	execCalls int
	err       error
}

func (t *inventoryTx) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row { return t.row }

func (t *inventoryTx) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	t.execCalls++
	return pgconn.CommandTag{}, t.err
}

func TestEnsureDefaultWarehouse(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		row     pgx.Row
		want    string
		wantErr bool
	}{
		{name: "returns default warehouse", row: inventoryRow{warehouseID: "wh_default_shop_1"}, want: "wh_default_shop_1"},
		{name: "wraps database error", row: inventoryRow{err: errors.New("database unavailable")}, wantErr: true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := EnsureDefaultWarehouse(context.Background(), &inventoryTx{row: test.row}, "shop_1")
			if (err != nil) != test.wantErr || got != test.want {
				t.Fatalf("EnsureDefaultWarehouse() = (%q, %v)", got, err)
			}
		})
	}
}

func TestCommit(t *testing.T) {
	t.Parallel()
	tx := &inventoryTx{}
	if err := Commit(context.Background(), tx, "ord_1"); err != nil || tx.execCalls != 1 {
		t.Fatalf("Commit() error = %v, calls = %d", err, tx.execCalls)
	}
}
