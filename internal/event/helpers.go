package event

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

type rowScanner interface{ Scan(dest ...any) error }

func scanEvent(s rowScanner) (*Event, error) {
	var ev Event
	var state, payloadStr, raw, wn, tid string
	var createdAt, updatedAt int64
	err := s.Scan(&ev.ID, &ev.DeliveryID, &ev.Source, &ev.Type,
		&ev.RepoOwner, &ev.RepoName, &ev.Ref, &ev.Number, &ev.Sender,
		&payloadStr, &raw, &state, &wn, &tid, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("event not found")
		}
		return nil, fmt.Errorf("scan event: %w", err)
	}
	ev.State = State(state)
	ev.WorkerName = wn
	ev.TaskID = tid
	ev.Raw = json.RawMessage(raw)
	ev.CreatedAt = time.Unix(createdAt, 0)
	ev.UpdatedAt = time.Unix(updatedAt, 0)
	if payloadStr != "" {
		if err := json.Unmarshal([]byte(payloadStr), &ev.Payload); err != nil {
			return nil, fmt.Errorf("unmarshal event payload: %w", err)
		}
	}
	return &ev, nil
}

func genID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func checkRows(res sql.Result, id, verb string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("%s event %q: not found or invalid state", verb, id)
	}
	return nil
}
