package idempotency

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type idempotencyExecResult struct {
	tag pgconn.CommandTag
	err error
}

type idempotencyDatabase struct {
	execResults []idempotencyExecResult
	rows        []pgx.Row
	execIndex   int
	rowIndex    int
}

func (d *idempotencyDatabase) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	if d.execIndex >= len(d.execResults) {
		return pgconn.CommandTag{}, errors.New("unexpected Exec call")
	}
	result := d.execResults[d.execIndex]
	d.execIndex++
	return result.tag, result.err
}

func (d *idempotencyDatabase) QueryRow(context.Context, string, ...any) pgx.Row {
	if d.rowIndex >= len(d.rows) {
		return idempotencyRow{err: errors.New("unexpected QueryRow call")}
	}
	row := d.rows[d.rowIndex]
	d.rowIndex++
	return row
}

type idempotencyRow struct {
	storedHash string
	state      string
	status     *int
	body       []byte
	lease      *time.Time
	err        error
}

func (r idempotencyRow) Scan(destinations ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(destinations) != 5 {
		return errors.New("unexpected idempotency scan destinations")
	}
	*destinations[0].(*string) = r.storedHash
	*destinations[1].(*string) = r.state
	*destinations[2].(**int) = r.status
	*destinations[3].(*[]byte) = r.body
	*destinations[4].(**time.Time) = r.lease
	return nil
}

func commandTag(rows int64) pgconn.CommandTag {
	if rows == 1 {
		return pgconn.NewCommandTag("UPDATE 1")
	}
	return pgconn.NewCommandTag("UPDATE 0")
}

func testClaim() Claim {
	return Claim{ID: "idem_1", CredentialID: "cred_1", Operation: "webhook.create", Key: "key_1", RequestHash: "hash_1"}
}

func TestAcquireOutcomes(t *testing.T) {
	t.Parallel()
	now := time.Now()
	status := 201
	dependencyErr := errors.New("database unavailable")
	tests := []struct {
		name     string
		database *idempotencyDatabase
		want     Result
		wantErr  error
	}{
		{
			name:     "new claim executes",
			database: &idempotencyDatabase{execResults: []idempotencyExecResult{{tag: commandTag(1)}}},
			want:     Result{Outcome: OutcomeExecute},
		},
		{
			name:     "insert failure is returned",
			database: &idempotencyDatabase{execResults: []idempotencyExecResult{{err: dependencyErr}}},
			wantErr:  dependencyErr,
		},
		{
			name: "different payload conflicts",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}},
				rows:        []pgx.Row{idempotencyRow{storedHash: "different", state: "PROCESSING"}},
			},
			want: Result{Outcome: OutcomeConflict},
		},
		{
			name: "completed claim replays",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}},
				rows:        []pgx.Row{idempotencyRow{storedHash: "hash_1", state: "COMPLETED", status: &status, body: []byte(`{"ok":true}`)}},
			},
			want: Result{Outcome: OutcomeReplay, Status: 201, Body: []byte(`{"ok":true}`)},
		},
		{
			name: "active lease remains in progress",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}},
				rows:        []pgx.Row{idempotencyRow{storedHash: "hash_1", state: "PROCESSING", lease: timePointer(now.Add(time.Hour))}},
			},
			want: Result{Outcome: OutcomeInProgress},
		},
		{
			name: "expired lease executes under new owner",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}, {tag: commandTag(1)}},
				rows:        []pgx.Row{idempotencyRow{storedHash: "hash_1", state: "PROCESSING", lease: timePointer(now.Add(-time.Hour))}},
			},
			want: Result{Outcome: OutcomeExecute},
		},
		{
			name: "claim load failure is returned",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}},
				rows:        []pgx.Row{idempotencyRow{err: dependencyErr}},
			},
			wantErr: dependencyErr,
		},
		{
			name: "renewal failure is returned",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}, {err: dependencyErr}},
				rows:        []pgx.Row{idempotencyRow{storedHash: "hash_1", state: "PROCESSING"}},
			},
			wantErr: dependencyErr,
		},
		{
			name: "lost renewal remains in progress",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}, {tag: commandTag(0)}},
				rows:        []pgx.Row{idempotencyRow{storedHash: "hash_1", state: "PROCESSING"}},
			},
			want: Result{Outcome: OutcomeInProgress},
		},
		{
			name: "released claim retries three times",
			database: &idempotencyDatabase{
				execResults: []idempotencyExecResult{{tag: commandTag(0)}, {tag: commandTag(0)}, {tag: commandTag(0)}},
				rows: []pgx.Row{
					idempotencyRow{err: pgx.ErrNoRows},
					idempotencyRow{err: pgx.ErrNoRows},
					idempotencyRow{err: pgx.ErrNoRows},
				},
			},
			want: Result{Outcome: OutcomeInProgress},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			result, err := (&Manager{db: test.database, lease: time.Minute}).Acquire(context.Background(), testClaim())
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Acquire() error = %v, want %v", err, test.wantErr)
			}
			if result.Outcome != test.want.Outcome || result.Status != test.want.Status || string(result.Body) != string(test.want.Body) {
				t.Fatalf("Acquire() = %#v, want %#v", result, test.want)
			}
		})
	}
}

func TestComplete(t *testing.T) {
	t.Parallel()
	dependencyErr := errors.New("database unavailable")
	tests := []struct {
		name     string
		database *idempotencyDatabase
		wantErr  error
	}{
		{name: "stores response", database: &idempotencyDatabase{execResults: []idempotencyExecResult{{tag: commandTag(1)}}}},
		{name: "wraps database failure", database: &idempotencyDatabase{execResults: []idempotencyExecResult{{err: dependencyErr}}}, wantErr: dependencyErr},
		{name: "rejects stale owner", database: &idempotencyDatabase{execResults: []idempotencyExecResult{{tag: commandTag(0)}}}, wantErr: pgx.ErrNoRows},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := (&Manager{db: test.database, lease: time.Minute}).Complete(context.Background(), testClaim(), 201, []byte(`{"ok":true}`))
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Complete() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestRelease(t *testing.T) {
	t.Parallel()
	dependencyErr := errors.New("database unavailable")
	tests := []struct {
		name     string
		database *idempotencyDatabase
		wantErr  error
	}{
		{name: "removes processing claim", database: &idempotencyDatabase{execResults: []idempotencyExecResult{{tag: commandTag(1)}}}},
		{name: "wraps database failure", database: &idempotencyDatabase{execResults: []idempotencyExecResult{{err: dependencyErr}}}, wantErr: dependencyErr},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := (&Manager{db: test.database, lease: time.Minute}).Release(context.Background(), testClaim())
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Release() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestNewManager(t *testing.T) {
	t.Parallel()
	manager := NewManager(nil, time.Minute)
	if manager.lease != time.Minute {
		t.Fatalf("NewManager() = %#v", manager)
	}
}

func timePointer(value time.Time) *time.Time { return &value }
