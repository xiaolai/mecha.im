package tasks

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"
)

func genID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func checkRowAffected(res sql.Result, id, verb string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("%s task %q: not found or invalid state", verb, id)
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTask(s scanner) (*Task, error) {
	var t Task
	var state, result, errMsg string
	var taskCtx, eventID, dedupKey sql.NullString
	var createdAt, updatedAt int64
	var dispatchedAt, completedAt, nextRetryAt sql.NullInt64
	err := s.Scan(&t.ID, &t.WorkerName, &t.Prompt, &taskCtx, &eventID, &dedupKey,
		&state, &result, &errMsg, &t.Attempts, &t.MaxRetries,
		&nextRetryAt, &createdAt, &updatedAt, &dispatchedAt, &completedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("task not found")
		}
		return nil, fmt.Errorf("scan task: %w", err)
	}
	t.State = State(state)
	t.Result = result
	t.ErrorMsg = errMsg
	if taskCtx.Valid {
		t.Context = taskCtx.String
	}
	if eventID.Valid {
		t.EventID = eventID.String
	}
	if dedupKey.Valid {
		t.DedupKey = dedupKey.String
	}
	if nextRetryAt.Valid {
		nra := time.Unix(nextRetryAt.Int64, 0)
		t.NextRetryAt = &nra
	}
	t.CreatedAt = time.Unix(createdAt, 0)
	t.UpdatedAt = time.Unix(updatedAt, 0)
	if dispatchedAt.Valid {
		dt := time.Unix(dispatchedAt.Int64, 0)
		t.DispatchedAt = &dt
	}
	if completedAt.Valid {
		ct := time.Unix(completedAt.Int64, 0)
		t.CompletedAt = &ct
	}
	return &t, nil
}
