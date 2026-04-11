package source

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func slackSignature(secret string, ts int64, body []byte) (string, string) {
	timestamp := strconv.FormatInt(ts, 10)
	baseString := "v0:" + timestamp + ":" + string(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(baseString))
	sig := "v0=" + hex.EncodeToString(mac.Sum(nil))
	return sig, timestamp
}

func slackHeaders(sig, ts string) http.Header {
	h := http.Header{}
	h.Set("X-Slack-Signature", sig)
	h.Set("X-Slack-Request-Timestamp", ts)
	return h
}

func TestSlackSourceName(t *testing.T) {
	t.Parallel()
	s := NewSlackSource("secret")
	if got := s.Name(); got != "slack" {
		t.Errorf("Name() = %q, want %q", got, "slack")
	}
}

func TestSlackSourceParse(t *testing.T) {
	t.Parallel()
	secret := "test-signing-secret"
	src := NewSlackSource(secret)

	payload := map[string]any{
		"event_id": "Ev01ABC",
		"team_id":  "T01TEAM",
		"event": map[string]any{
			"type":    "message",
			"user":    "U01USER",
			"channel": "C01CHAN",
			"text":    "hello world",
			"ts":      "1234567890.123456",
		},
	}
	body, _ := json.Marshal(payload)
	now := time.Now().Unix()
	sig, ts := slackSignature(secret, now, body)

	ev, err := src.Parse(slackHeaders(sig, ts), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Source != "slack" {
		t.Errorf("Source = %q, want %q", ev.Source, "slack")
	}
	if ev.Type != "message" {
		t.Errorf("Type = %q, want %q", ev.Type, "message")
	}
	if ev.DeliveryID != "Ev01ABC" {
		t.Errorf("DeliveryID = %q, want %q", ev.DeliveryID, "Ev01ABC")
	}
	if ev.Actor != "U01USER" {
		t.Errorf("Actor = %q, want %q", ev.Actor, "U01USER")
	}
	if ev.Subject != "C01CHAN" {
		t.Errorf("Subject = %q, want %q", ev.Subject, "C01CHAN")
	}
	if ev.Attrs["text"] != "hello world" {
		t.Errorf("Attrs[text] = %v, want %q", ev.Attrs["text"], "hello world")
	}
	if ev.Attrs["team_id"] != "T01TEAM" {
		t.Errorf("Attrs[team_id] = %v, want %q", ev.Attrs["team_id"], "T01TEAM")
	}
	if ev.Attrs["ts"] != "1234567890.123456" {
		t.Errorf("Attrs[ts] = %v", ev.Attrs["ts"])
	}
}

func TestSlackSourceParseInvalidSignature(t *testing.T) {
	t.Parallel()
	src := NewSlackSource("correct-secret")

	payload := map[string]any{
		"event_id": "Ev01",
		"event":    map[string]any{"type": "message", "user": "U01"},
	}
	body, _ := json.Marshal(payload)
	now := time.Now().Unix()
	sig, ts := slackSignature("wrong-secret", now, body)

	_, err := src.Parse(slackHeaders(sig, ts), body)
	if err == nil {
		t.Fatal("expected error for invalid signature")
	}
	if got := err.Error(); got != "invalid slack signature" {
		t.Errorf("error = %q, want %q", got, "invalid slack signature")
	}
}

func TestSlackSourceParseExpiredTimestamp(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewSlackSource(secret)

	payload := map[string]any{
		"event_id": "Ev01",
		"event":    map[string]any{"type": "message"},
	}
	body, _ := json.Marshal(payload)
	// 10 minutes ago — should exceed 5-minute window
	oldTS := time.Now().Add(-10 * time.Minute).Unix()
	sig, ts := slackSignature(secret, oldTS, body)

	_, err := src.Parse(slackHeaders(sig, ts), body)
	if err == nil {
		t.Fatal("expected error for expired timestamp")
	}
	if got := err.Error(); got != "slack request timestamp too old" {
		t.Errorf("error = %q, want %q", got, "slack request timestamp too old")
	}
}

func TestSlackSourceParseNoEvent(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewSlackSource(secret)

	// Payload with no "event" field
	payload := map[string]any{
		"event_id": "Ev01",
		"team_id":  "T01",
	}
	body, _ := json.Marshal(payload)
	now := time.Now().Unix()
	sig, ts := slackSignature(secret, now, body)

	_, err := src.Parse(slackHeaders(sig, ts), body)
	if err == nil {
		t.Fatal("expected error for missing event field")
	}
	if got := err.Error(); got != "missing event field in slack payload" {
		t.Errorf("error = %q", got)
	}
}

func TestSlackSourceParseURLVerification(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewSlackSource(secret)

	payload := map[string]any{
		"type":      "url_verification",
		"challenge": "abc123xyz",
	}
	body, _ := json.Marshal(payload)
	now := time.Now().Unix()
	sig, ts := slackSignature(secret, now, body)

	_, err := src.Parse(slackHeaders(sig, ts), body)
	if err == nil {
		t.Fatal("expected error for url_verification")
	}
	if !errors.Is(err, ErrSlackChallenge) {
		t.Errorf("error = %v, want ErrSlackChallenge", err)
	}
}

func TestSlackSourceParseMissingHeaders(t *testing.T) {
	t.Parallel()
	src := NewSlackSource("secret")
	body := []byte(`{"event_id":"Ev01","event":{"type":"message"}}`)

	tests := []struct {
		name    string
		headers http.Header
	}{
		{"no headers", http.Header{}},
		{"signature only", func() http.Header {
			h := http.Header{}
			h.Set("X-Slack-Signature", "v0=abc")
			return h
		}()},
		{"timestamp only", func() http.Header {
			h := http.Header{}
			h.Set("X-Slack-Request-Timestamp", "123")
			return h
		}()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := src.Parse(tt.headers, body)
			if err == nil {
				t.Error("expected error for missing headers")
			}
		})
	}
}

func TestSlackSourceParseSubtype(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewSlackSource(secret)

	payload := map[string]any{
		"event_id": "Ev02",
		"event": map[string]any{
			"type":    "message",
			"subtype": "bot_message",
			"user":    "B01BOT",
			"channel": "C01",
			"text":    "bot says hi",
		},
	}
	body, _ := json.Marshal(payload)
	now := time.Now().Unix()
	sig, ts := slackSignature(secret, now, body)

	ev, err := src.Parse(slackHeaders(sig, ts), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Type != "message.bot_message" {
		t.Errorf("Type = %q, want %q", ev.Type, "message.bot_message")
	}
}

func TestSlackSourceParseNoSecret(t *testing.T) {
	t.Parallel()
	// Empty signing secret skips verification
	src := NewSlackSource("")
	payload := map[string]any{
		"event_id": "Ev01",
		"event":    map[string]any{"type": "message", "user": "U01"},
	}
	body, _ := json.Marshal(payload)

	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() with empty secret should not error: %v", err)
	}
	if ev.Type != "message" {
		t.Errorf("Type = %q", ev.Type)
	}
}

func TestVerifyChallenge(t *testing.T) {
	t.Parallel()
	payload := map[string]any{
		"type":      "url_verification",
		"challenge": "abc123xyz",
		"token":     "legacy-token",
	}
	body, _ := json.Marshal(payload)

	resp, ok := VerifyChallenge(body)
	if !ok {
		t.Fatal("VerifyChallenge returned false")
	}
	var result map[string]string
	if err := json.Unmarshal(resp, &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if result["challenge"] != "abc123xyz" {
		t.Errorf("challenge = %q, want %q", result["challenge"], "abc123xyz")
	}
}

func TestVerifyChallengeNonVerification(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		body []byte
	}{
		{"event_callback type", []byte(`{"type":"event_callback","event":{"type":"message"}}`)},
		{"no type field", []byte(`{"event":{"type":"message"}}`)},
		{"invalid json", []byte(`not json`)},
		{"missing challenge field", []byte(`{"type":"url_verification"}`)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, ok := VerifyChallenge(tt.body)
			if ok {
				t.Error("expected false for non-verification payload")
			}
		})
	}
}

func TestSlackSourceParseThreadTS(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewSlackSource(secret)

	payload := map[string]any{
		"event_id": "Ev03",
		"event": map[string]any{
			"type":      "message",
			"user":      "U01",
			"channel":   "C01",
			"text":      "threaded reply",
			"ts":        "1234567890.000001",
			"thread_ts": "1234567890.000000",
		},
	}
	body, _ := json.Marshal(payload)
	now := time.Now().Unix()
	sig, ts := slackSignature(secret, now, body)

	ev, err := src.Parse(slackHeaders(sig, ts), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Attrs["thread_ts"] != "1234567890.000000" {
		t.Errorf("thread_ts = %v", ev.Attrs["thread_ts"])
	}
}

func TestSlackSourceAuthenticated(t *testing.T) {
	t.Parallel()
	// Ensure SlackSource implements Authenticated marker interface
	src := NewSlackSource("secret")
	var _ Authenticated = src
	// Just calling it to confirm no panic
	src.Authenticated()
}

func TestErrSlackChallenge(t *testing.T) {
	t.Parallel()
	src := NewSlackSource("secret")
	body := []byte(`{"type":"url_verification","challenge":"abc"}`)
	sig, tsStr := slackSignature("secret", time.Now().Unix(), body)
	headers := http.Header{
		"X-Slack-Signature":         {sig},
		"X-Slack-Request-Timestamp": {tsStr},
	}
	_, err := src.Parse(headers, body)
	if !errors.Is(err, ErrSlackChallenge) {
		t.Errorf("expected ErrSlackChallenge, got %v", err)
	}
}

func TestSlackSignatureTimestampEdge(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewSlackSource(secret)

	payload := map[string]any{
		"event_id": "Ev01",
		"event":    map[string]any{"type": "message"},
	}
	body, _ := json.Marshal(payload)

	// Exactly 5 minutes should still pass (boundary = 300 seconds)
	edgeTS := time.Now().Add(-5 * time.Minute).Unix()
	sig, ts := slackSignature(secret, edgeTS, body)
	_, err := src.Parse(slackHeaders(sig, ts), body)
	// At exactly 300 seconds, abs(now-ts) == 300 which is NOT > 300, so it should pass.
	if err != nil {
		t.Logf("boundary test: error = %v (acceptable due to timing)", err)
	}

	// 6 minutes is definitely too old
	oldTS := time.Now().Add(-6 * time.Minute).Unix()
	sig2, ts2 := slackSignature(secret, oldTS, body)
	_, err2 := src.Parse(slackHeaders(sig2, ts2), body)
	if err2 == nil {
		t.Error("expected error for 6-minute-old timestamp")
	}
}

func TestSlackSourceParseInvalidTimestamp(t *testing.T) {
	t.Parallel()
	src := NewSlackSource("secret")
	body := []byte(`{"event_id":"Ev01","event":{"type":"message"}}`)
	h := http.Header{}
	h.Set("X-Slack-Signature", "v0=abc")
	h.Set("X-Slack-Request-Timestamp", "not-a-number")

	_, err := src.Parse(h, body)
	if err == nil {
		t.Error("expected error for invalid timestamp")
	}
	expected := "invalid timestamp"
	if got := err.Error(); len(got) < len(expected) || got[:len(expected)] != expected {
		t.Errorf("error = %q, want prefix %q", got, expected)
	}
}

func TestSlackSourceParseInvalidJSON(t *testing.T) {
	t.Parallel()
	src := NewSlackSource("")
	_, err := src.Parse(http.Header{}, []byte("not json"))
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
	expected := "parse slack body"
	if got := err.Error(); len(got) < len(expected) || got[:len(expected)] != expected {
		fmt.Println(got)
		t.Errorf("error = %q, want prefix %q", got, expected)
	}
}
