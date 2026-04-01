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
	"time"

	"mecha.im/internal/event"
)

// SlackSource parses Slack webhook payloads into events.
// Verifies HMAC-SHA256 signatures using X-Slack-Signature.
type SlackSource struct {
	signingSecret string
}

// NewSlackSource creates a Slack webhook source.
func NewSlackSource(signingSecret string) *SlackSource {
	return &SlackSource{signingSecret: signingSecret}
}

// Name returns "slack".
func (s *SlackSource) Name() string { return "slack" }

// Authenticated marks Slack as self-authenticating (HMAC-SHA256).
func (s *SlackSource) Authenticated() {}

// Parse validates the HMAC signature and normalizes the webhook payload.
// URL verification challenges are returned as ErrSlackChallenge; the caller
// should use VerifyChallenge() to extract the response.
func (s *SlackSource) Parse(headers http.Header, body []byte) (*event.Event, error) {
	if s.signingSecret != "" {
		if err := s.verifySignature(headers, body); err != nil {
			return nil, err
		}
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("parse slack body: %w", err)
	}

	// Handle url_verification challenge inline
	if t, _ := payload["type"].(string); t == "url_verification" {
		return nil, ErrSlackChallenge
	}

	return s.parseEventPayload(payload, body)
}

func (s *SlackSource) parseEventPayload(payload map[string]any, body []byte) (*event.Event, error) {
	eventID, _ := payload["event_id"].(string)
	evData, _ := payload["event"].(map[string]any)
	if evData == nil {
		return nil, fmt.Errorf("missing event field in slack payload")
	}

	eventType, _ := evData["type"].(string)
	subtype, _ := evData["subtype"].(string)
	if subtype != "" {
		eventType = eventType + "." + subtype
	}

	ev := &event.Event{
		DeliveryID: eventID,
		Source:     "slack",
		Type:       eventType,
		Raw:        json.RawMessage(body),
		Attrs:      make(event.Attrs),
	}

	// Actor
	ev.Actor, _ = evData["user"].(string)
	ev.Attrs["sender"] = ev.Actor

	// Subject (channel)
	if ch, ok := evData["channel"].(string); ok {
		ev.Subject = ch
		ev.Attrs["channel"] = ch
	}

	// Message text
	if text, ok := evData["text"].(string); ok {
		ev.Attrs["text"] = text
	}

	// Thread
	if ts, ok := evData["thread_ts"].(string); ok {
		ev.Attrs["thread_ts"] = ts
	}
	if ts, ok := evData["ts"].(string); ok {
		ev.Attrs["ts"] = ts
	}

	// Team
	if team, _ := payload["team_id"].(string); team != "" {
		ev.Attrs["team_id"] = team
	}

	return ev, nil
}

func (s *SlackSource) verifySignature(headers http.Header, body []byte) error {
	sig := headers.Get("X-Slack-Signature")
	ts := headers.Get("X-Slack-Request-Timestamp")
	if sig == "" || ts == "" {
		return fmt.Errorf("missing slack signature headers")
	}
	// Reject requests older than 5 minutes (replay protection)
	tsInt, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid timestamp: %w", err)
	}
	if abs(time.Now().Unix()-tsInt) > 300 {
		return fmt.Errorf("slack request timestamp too old")
	}
	baseString := "v0:" + ts + ":" + string(body)
	mac := hmac.New(sha256.New, []byte(s.signingSecret))
	mac.Write([]byte(baseString))
	expected := "v0=" + hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(sig)) {
		return fmt.Errorf("invalid slack signature")
	}
	return nil
}

// VerifyChallenge extracts the challenge response from a url_verification payload.
// Call this from a POST handler when Parse returns url_verification error.
func VerifyChallenge(body []byte) ([]byte, bool) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, false
	}
	if t, _ := payload["type"].(string); t != "url_verification" {
		return nil, false
	}
	challenge, ok := payload["challenge"].(string)
	if !ok {
		return nil, false
	}
	resp, _ := json.Marshal(map[string]string{"challenge": challenge})
	return resp, true
}

func abs(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

// ErrSlackChallenge is returned by Parse when the payload is a url_verification
// challenge. The caller should use VerifyChallenge() to extract the response.
var ErrSlackChallenge = errors.New("slack url_verification challenge")

func init() {
	var _ Source = (*SlackSource)(nil)
	var _ Authenticated = (*SlackSource)(nil)
}
