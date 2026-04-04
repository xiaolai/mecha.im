package events

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrNotFound is returned when an event does not exist.
var ErrNotFound = errors.New("not found")

type rowScanner interface{ Scan(dest ...any) error }

func scanEvent(s rowScanner) (*Event, error) {
	var ev Event
	var state, attrsStr, raw, wn, tid string
	var createdAt, updatedAt int64
	err := s.Scan(&ev.ID, &ev.DeliveryID, &ev.DedupKey,
		&ev.Source, &ev.Type, &ev.Actor, &ev.Subject,
		&attrsStr, &raw, &state, &wn, &tid, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("event: %w", ErrNotFound)
		}
		return nil, fmt.Errorf("scan event: %w", err)
	}
	ev.State = State(state)
	ev.WorkerName = wn
	ev.TaskID = tid
	ev.Raw = json.RawMessage(raw)
	ev.CreatedAt = time.Unix(createdAt, 0)
	ev.UpdatedAt = time.Unix(updatedAt, 0)
	if attrsStr != "" && attrsStr != "null" {
		if err := json.Unmarshal([]byte(attrsStr), &ev.Attrs); err != nil {
			return nil, fmt.Errorf("unmarshal event attrs: %w", err)
		}
	}
	if ev.Attrs == nil {
		ev.Attrs = make(Attrs)
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
