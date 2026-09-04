package inventory

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type inventoryRow struct {
	values []any
	err    error
}

func (r inventoryRow) Scan(destinations ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(destinations) != len(r.values) {
		return errors.New("unexpected scan destinations")
	}
	for index, value := range r.values {
		if err := assignInventoryValue(destinations[index], value); err != nil {
			return err
		}
	}
	return nil
}

type inventoryRows struct {
	values  [][]any
	index   int
	scanErr error
	err     error
	closed  bool
}

func newInventoryRows(values ...[]any) *inventoryRows {
	return &inventoryRows{values: values, index: -1}
}

func (r *inventoryRows) Close()                                       { r.closed = true }
func (r *inventoryRows) Err() error                                   { return r.err }
func (r *inventoryRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *inventoryRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *inventoryRows) RawValues() [][]byte                          { return nil }
func (r *inventoryRows) Conn() *pgx.Conn                              { return nil }

func (r *inventoryRows) Next() bool {
	if r.index+1 >= len(r.values) {
		r.closed = true
		return false
	}
	r.index++
	return true
}

func (r *inventoryRows) Scan(destinations ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if r.index < 0 || r.index >= len(r.values) || len(destinations) != len(r.values[r.index]) {
		return errors.New("unexpected rows scan destinations")
	}
	for index, value := range r.values[r.index] {
		if err := assignInventoryValue(destinations[index], value); err != nil {
			return err
		}
	}
	return nil
}

func (r *inventoryRows) Values() ([]any, error) {
	if r.index < 0 || r.index >= len(r.values) {
		return nil, errors.New("no current row")
	}
	return r.values[r.index], nil
}

func assignInventoryValue(destination, value any) error {
	switch target := destination.(type) {
	case *string:
		got, ok := value.(string)
		if !ok {
			return errors.New("inventory value is not a string")
		}
		*target = got
	case *int:
		got, ok := value.(int)
		if !ok {
			return errors.New("inventory value is not an integer")
		}
		*target = got
	default:
		return errors.New("unsupported inventory scan destination")
	}
	return nil
}

type inventoryQueryResult struct {
	rows pgx.Rows
	err  error
}

type inventoryExecResult struct {
	tag pgconn.CommandTag
	err error
}

type inventoryTx struct {
	pgx.Tx
	row          pgx.Row
	rowResults   []pgx.Row
	queryResults []inventoryQueryResult
	execResults  []inventoryExecResult
	rowIndex     int
	queryIndex   int
	execCalls    int
	err          error
}

func (t *inventoryTx) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	if t.rowIndex < len(t.rowResults) {
		row := t.rowResults[t.rowIndex]
		t.rowIndex++
		return row
	}
	return t.row
}

func (t *inventoryTx) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	if t.queryIndex >= len(t.queryResults) {
		return nil, errors.New("unexpected inventory Query call")
	}
	result := t.queryResults[t.queryIndex]
	t.queryIndex++
	return result.rows, result.err
}

func (t *inventoryTx) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	t.execCalls++
	if t.execCalls <= len(t.execResults) {
		result := t.execResults[t.execCalls-1]
		return result.tag, result.err
	}
	if t.err != nil {
		return pgconn.CommandTag{}, t.err
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func TestEnsureDefaultWarehouse(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		row     pgx.Row
		want    string
		wantErr bool
	}{
		{name: "returns default warehouse", row: inventoryRow{values: []any{"wh_default_shop_1"}}, want: "wh_default_shop_1"},
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

func TestAllocate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		lines     []Line
		tx        *inventoryTx
		want      Warehouse
		wantErr   error
		execCalls int
	}{
		{name: "rejects empty order", tx: &inventoryTx{}, wantErr: ErrNoEligibleWarehouse},
		{name: "rejects invalid line", lines: []Line{{OrderItemID: "item_1", ProductID: "prd_1"}}, tx: &inventoryTx{}, wantErr: ErrNoEligibleWarehouse},
		{
			name:  "selects first eligible warehouse",
			lines: []Line{{OrderItemID: "item_1", ProductID: "prd_1", Quantity: 2}},
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows(
					[]any{"wh_high", "HIGH", "High priority", 100},
					[]any{"wh_backup", "BACKUP", "Backup", 50},
				)}},
				rowResults: []pgx.Row{
					inventoryRow{values: []any{2, 1}},
					inventoryRow{values: []any{10, 1}},
				},
			},
			want:      Warehouse{ID: "wh_backup", Code: "BACKUP", Name: "Backup", Priority: 50},
			execCalls: 4,
		},
		{
			name:  "returns no eligible warehouse",
			lines: []Line{{OrderItemID: "item_1", ProductID: "prd_1", Quantity: 2}},
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows([]any{"wh_1", "ONE", "One", 1})}},
				rowResults:   []pgx.Row{inventoryRow{values: []any{2, 1}}},
			},
			wantErr: ErrNoEligibleWarehouse,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			warehouse, err := Allocate(context.Background(), test.tx, "shop_1", "ord_1", test.lines)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Allocate() error = %v, want %v", err, test.wantErr)
			}
			if warehouse != test.want || test.tx.execCalls != test.execCalls {
				t.Fatalf("Allocate() = %#v, exec calls = %d", warehouse, test.tx.execCalls)
			}
		})
	}
}

func TestAllocateDatabaseFailures(t *testing.T) {
	t.Parallel()
	dependencyErr := errors.New("database unavailable")
	validLines := []Line{{OrderItemID: "item_1", ProductID: "prd_1", Quantity: 1}}
	tests := []struct {
		name string
		tx   *inventoryTx
	}{
		{
			name: "warehouse query",
			tx:   &inventoryTx{queryResults: []inventoryQueryResult{{err: dependencyErr}}},
		},
		{
			name: "warehouse scan",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: &inventoryRows{
					values:  [][]any{{"wh_1", "ONE", "One", 1}},
					index:   -1,
					scanErr: dependencyErr,
				},
			}}},
		},
		{
			name: "warehouse rows",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: &inventoryRows{index: -1, err: dependencyErr},
			}}},
		},
		{
			name: "reserve inventory",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows([]any{"wh_1", "ONE", "One", 1})}},
				rowResults:   []pgx.Row{inventoryRow{values: []any{10, 0}}},
				execResults:  []inventoryExecResult{{err: dependencyErr}},
			},
		},
		{
			name: "product availability drift",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows([]any{"wh_1", "ONE", "One", 1})}},
				rowResults:   []pgx.Row{inventoryRow{values: []any{10, 0}}},
				execResults: []inventoryExecResult{
					{tag: pgconn.NewCommandTag("UPDATE 1")},
					{tag: pgconn.NewCommandTag("UPDATE 0")},
				},
			},
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if _, err := Allocate(context.Background(), test.tx, "shop_1", "ord_1", validLines); err == nil {
				t.Fatal("Allocate() accepted a failed database operation")
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

func TestRelease(t *testing.T) {
	t.Parallel()
	rows := newInventoryRows(
		[]any{"wh_1", "prd_complete", 0},
		[]any{"wh_1", "prd_partial", 2},
	)
	tx := &inventoryTx{queryResults: []inventoryQueryResult{{rows: rows}}}
	if err := Release(context.Background(), tx, "ord_1"); err != nil {
		t.Fatalf("Release() error = %v", err)
	}
	if tx.execCalls != 2 || !rows.closed {
		t.Fatalf("Release() exec calls = %d, rows closed = %t", tx.execCalls, rows.closed)
	}
}

func TestReleaseFailures(t *testing.T) {
	t.Parallel()
	dependencyErr := errors.New("database unavailable")
	tests := []struct {
		name string
		tx   *inventoryTx
	}{
		{
			name: "reservation query",
			tx:   &inventoryTx{queryResults: []inventoryQueryResult{{err: dependencyErr}}},
		},
		{
			name: "reservation scan",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: &inventoryRows{
					values:  [][]any{{"wh_1", "prd_1", 1}},
					index:   -1,
					scanErr: dependencyErr,
				},
			}}},
		},
		{
			name: "reservation rows",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: &inventoryRows{index: -1, err: dependencyErr},
			}}},
		},
		{
			name: "warehouse release",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows([]any{"wh_1", "prd_1", 1})}},
				execResults:  []inventoryExecResult{{err: dependencyErr}},
			},
		},
		{
			name: "warehouse drift",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows([]any{"wh_1", "prd_1", 1})}},
				execResults:  []inventoryExecResult{{tag: pgconn.NewCommandTag("UPDATE 0")}},
			},
		},
		{
			name: "product restore",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows([]any{"wh_1", "prd_1", 1})}},
				execResults: []inventoryExecResult{
					{tag: pgconn.NewCommandTag("UPDATE 1")},
					{err: dependencyErr},
				},
			},
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if err := Release(context.Background(), test.tx, "ord_1"); err == nil {
				t.Fatal("Release() accepted a failed database operation")
			}
		})
	}
}

func TestFulfillPackage(t *testing.T) {
	t.Parallel()
	tx := &inventoryTx{queryResults: []inventoryQueryResult{{rows: newInventoryRows(
		[]any{"res_1", "wh_1", "prd_1", 3, 0, "COMMITTED", 2},
	)}}}
	if err := FulfillPackage(context.Background(), tx, "pkg_1"); err != nil {
		t.Fatalf("FulfillPackage() error = %v", err)
	}
	if tx.execCalls != 2 {
		t.Fatalf("FulfillPackage() exec calls = %d, want 2", tx.execCalls)
	}
}

func TestFulfillPackageFailures(t *testing.T) {
	t.Parallel()
	dependencyErr := errors.New("database unavailable")
	validItem := []any{"res_1", "wh_1", "prd_1", 3, 0, "COMMITTED", 2}
	tests := []struct {
		name string
		tx   *inventoryTx
	}{
		{
			name: "reservation query",
			tx:   &inventoryTx{queryResults: []inventoryQueryResult{{err: dependencyErr}}},
		},
		{
			name: "empty package",
			tx:   &inventoryTx{queryResults: []inventoryQueryResult{{rows: newInventoryRows()}}},
		},
		{
			name: "reservation scan",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: &inventoryRows{values: [][]any{validItem}, index: -1, scanErr: dependencyErr},
			}}},
		},
		{
			name: "reservation rows",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: &inventoryRows{index: -1, err: dependencyErr},
			}}},
		},
		{
			name: "released reservation",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: newInventoryRows([]any{"res_1", "wh_1", "prd_1", 3, 0, "RELEASED", 2}),
			}}},
		},
		{
			name: "over allocated reservation",
			tx: &inventoryTx{queryResults: []inventoryQueryResult{{
				rows: newInventoryRows([]any{"res_1", "wh_1", "prd_1", 3, 2, "ACTIVE", 2}),
			}}},
		},
		{
			name: "warehouse consume",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows(validItem)}},
				execResults:  []inventoryExecResult{{err: dependencyErr}},
			},
		},
		{
			name: "warehouse drift",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows(validItem)}},
				execResults:  []inventoryExecResult{{tag: pgconn.NewCommandTag("UPDATE 0")}},
			},
		},
		{
			name: "reservation update",
			tx: &inventoryTx{
				queryResults: []inventoryQueryResult{{rows: newInventoryRows(validItem)}},
				execResults: []inventoryExecResult{
					{tag: pgconn.NewCommandTag("UPDATE 1")},
					{err: dependencyErr},
				},
			},
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if err := FulfillPackage(context.Background(), test.tx, "pkg_1"); err == nil {
				t.Fatal("FulfillPackage() accepted an invalid package or failed database operation")
			}
		})
	}
}

func TestAggregateRequiredQuantityCombinesDuplicateProducts(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		lines   []Line
		want    map[string]int
		wantErr bool
	}{
		{
			name:  "duplicate product lines are combined",
			lines: []Line{{OrderItemID: "item_1", ProductID: "prd_1", Quantity: 2}, {OrderItemID: "item_2", ProductID: "prd_1", Quantity: 3}},
			want:  map[string]int{"prd_1": 5},
		},
		{
			name:  "multiple products remain separate",
			lines: []Line{{OrderItemID: "item_1", ProductID: "prd_1", Quantity: 1}, {OrderItemID: "item_2", ProductID: "prd_2", Quantity: 4}},
			want:  map[string]int{"prd_1": 1, "prd_2": 4},
		},
		{name: "invalid quantity is rejected", lines: []Line{{OrderItemID: "item_1", ProductID: "prd_1", Quantity: 0}}, wantErr: true},
		{name: "missing product is rejected", lines: []Line{{OrderItemID: "item_1", Quantity: 1}}, wantErr: true},
		{name: "missing order item is rejected", lines: []Line{{ProductID: "prd_1", Quantity: 1}}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := aggregateRequiredQuantity(test.lines)
			if (err != nil) != test.wantErr {
				t.Fatalf("aggregateRequiredQuantity() error = %v", err)
			}
			if test.wantErr {
				return
			}
			if len(got) != len(test.want) {
				t.Fatalf("aggregateRequiredQuantity() = %#v, want %#v", got, test.want)
			}
			for productID, quantity := range test.want {
				if got[productID] != quantity {
					t.Fatalf("quantity for %s = %d, want %d", productID, got[productID], quantity)
				}
			}
		})
	}
}
