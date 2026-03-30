package source

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"mecha.im/internal/event"
)

// GenericSource parses arbitrary JSON webhook payloads.
// Event type is read from a configurable header (default: X-Event-Type).
// No signature validation — use network-level auth (API key, IP allowlist).
type GenericSource struct {
	name       string
	typeHeader string
}

// NewGenericSource creates a generic webhook source.
// name is the source identifier used in worker event rules.
// typeHeader is the HTTP header containing the event type (empty = "X-Event-Type").
func NewGenericSource(name, typeHeader string) *GenericSource {
	if typeHeader == "" {
		typeHeader = "X-Event-Type"
	}
	return &GenericSource{name: name, typeHeader: typeHeader}
}

// Name returns the configured source name.
func (g *GenericSource) Name() string { return g.name }

// Parse extracts the event type from the header and passes the JSON payload through.
func (g *GenericSource) Parse(headers http.Header, body []byte) (*event.Event, error) {
	eventType := headers.Get(g.typeHeader)
	if eventType == "" {
		return nil, fmt.Errorf("missing %s header", g.typeHeader)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("parse webhook body: %w", err)
	}

	// Generate delivery ID from content hash for deduplication
	h := sha256.Sum256(append([]byte(eventType+":"), body...))
	deliveryID := g.name + ":" + hex.EncodeToString(h[:16])

	ev := &event.Event{
		DeliveryID: deliveryID,
		Source:     g.name,
		Type:       eventType,
		Raw:        json.RawMessage(body),
		Payload:    make(event.Payload),
	}

	// Copy all top-level string/number fields into Payload for template access
	for k, v := range payload {
		switch val := v.(type) {
		case string:
			ev.Payload[k] = val
		case float64:
			ev.Payload[k] = val
		case bool:
			ev.Payload[k] = val
		}
	}

	return ev, nil
}
