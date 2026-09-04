// Package idempotency coordinates retry-safe public mutations.
package idempotency

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Outcome identifies what a caller should do after trying to claim a key.
type Outcome string

const (
	OutcomeExecute    Outcome = "EXECUTE"
	OutcomeReplay     Outcome = "REPLAY"
	OutcomeInProgress Outcome = "IN_PROGRESS"
	OutcomeConflict   Outcome = "CONFLICT"
)

// Claim uniquely identifies one logical mutation and its request payload.
type Claim struct {
	ID           string
	CredentialID string
	Operation    string
	Key          string
	RequestHash  string
}

// Result is the atomic claim result. Status and Body are populated for replay.
type Result struct {
	Outcome Outcome
	Status  int
	Body    []byte
}

type database interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Manager owns PostgreSQL-backed idempotency claims.
type Manager struct {
	db    database
	lease time.Duration
}

// NewManager creates a manager with a bounded processing lease.
func NewManager(db *pgxpool.Pool, lease time.Duration) *Manager {
	return &Manager{db: db, lease: lease}
}

// Acquire atomically claims a new key, replays a completed response, or reports
// that the same key belongs to a different request or an active execution.
func (m *Manager) Acquire(ctx context.Context, claim Claim) (Result, error) {
	for attempt := 0; attempt < 3; attempt++ {
		result, retry, err := m.acquire(ctx, claim)
		if err != nil {
			return Result{}, err
		}
		if !retry {
			return result, nil
		}
	}
	// A failed owner can release a row between the conflicting insert and the
	// following read. Under sustained churn, ask the caller to retry instead of
	// returning an infrastructure error or permitting duplicate execution.
	return Result{Outcome: OutcomeInProgress}, nil
}

func (m *Manager) acquire(ctx context.Context, claim Claim) (Result, bool, error) {
	lockedUntil := time.Now().Add(m.lease)
	command, err := m.db.Exec(ctx, `
		INSERT INTO idempotency_keys(
			id,credential_id,operation,key,request_hash,state,locked_until,response_status,response_body
		) VALUES($1,$2,$3,$4,$5,'PROCESSING',$6,NULL,NULL)
		ON CONFLICT(credential_id,operation,key) DO NOTHING`,
		claim.ID, claim.CredentialID, claim.Operation, claim.Key, claim.RequestHash, lockedUntil,
	)
	if err != nil {
		return Result{}, false, fmt.Errorf("create idempotency claim: %w", err)
	}
	if command.RowsAffected() == 1 {
		return Result{Outcome: OutcomeExecute}, false, nil
	}

	var storedHash, state string
	var status *int
	var body []byte
	var currentLease *time.Time
	err = m.db.QueryRow(ctx, `
		SELECT request_hash,state,response_status,response_body,locked_until
		FROM idempotency_keys
		WHERE credential_id=$1 AND operation=$2 AND key=$3`,
		claim.CredentialID, claim.Operation, claim.Key,
	).Scan(&storedHash, &state, &status, &body, &currentLease)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Result{}, true, nil
		}
		return Result{}, false, fmt.Errorf("load idempotency claim: %w", err)
	}
	if storedHash != "" && storedHash != claim.RequestHash {
		return Result{Outcome: OutcomeConflict}, false, nil
	}
	if state == "COMPLETED" && status != nil {
		return Result{Outcome: OutcomeReplay, Status: *status, Body: body}, false, nil
	}
	if currentLease != nil && currentLease.After(time.Now()) {
		return Result{Outcome: OutcomeInProgress}, false, nil
	}

	command, err = m.db.Exec(ctx, `
		UPDATE idempotency_keys
		SET id=$1,request_hash=$2,locked_until=$3
		WHERE credential_id=$4 AND operation=$5 AND key=$6
		  AND state='PROCESSING' AND (locked_until IS NULL OR locked_until<=now())
		  AND (request_hash='' OR request_hash=$2)`,
		claim.ID, claim.RequestHash, lockedUntil, claim.CredentialID, claim.Operation, claim.Key,
	)
	if err != nil {
		return Result{}, false, fmt.Errorf("renew idempotency claim: %w", err)
	}
	if command.RowsAffected() == 1 {
		return Result{Outcome: OutcomeExecute}, false, nil
	}
	return Result{Outcome: OutcomeInProgress}, false, nil
}

// Complete publishes the stable response for all later retries.
func (m *Manager) Complete(ctx context.Context, claim Claim, status int, body []byte) error {
	command, err := m.db.Exec(ctx, `
		UPDATE idempotency_keys
		SET state='COMPLETED',response_status=$1,response_body=$2,locked_until=NULL
		WHERE id=$3 AND credential_id=$4 AND operation=$5 AND key=$6
		  AND request_hash=$7 AND state='PROCESSING'`,
		status, body, claim.ID, claim.CredentialID, claim.Operation, claim.Key, claim.RequestHash,
	)
	if err != nil {
		return fmt.Errorf("complete idempotency claim: %w", err)
	}
	if command.RowsAffected() != 1 {
		return fmt.Errorf("complete idempotency claim: %w", pgx.ErrNoRows)
	}
	return nil
}

// Release removes a failed processing claim so a corrected retry can execute.
func (m *Manager) Release(ctx context.Context, claim Claim) error {
	_, err := m.db.Exec(ctx, `
		DELETE FROM idempotency_keys
		WHERE id=$1 AND credential_id=$2 AND operation=$3 AND key=$4
		  AND request_hash=$5 AND state='PROCESSING'`,
		claim.ID, claim.CredentialID, claim.Operation, claim.Key, claim.RequestHash,
	)
	if err != nil {
		return fmt.Errorf("release idempotency claim: %w", err)
	}
	return nil
}
