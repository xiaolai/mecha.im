package source

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"mecha.im/internal/events"
)

// TelegramSource parses Telegram Bot API webhook payloads into events.
// Verifies via X-Telegram-Bot-Api-Secret-Token header.
type TelegramSource struct {
	secretToken string
}

// NewTelegramSource creates a Telegram webhook source.
func NewTelegramSource(secretToken string) *TelegramSource {
	return &TelegramSource{secretToken: secretToken}
}

// Name returns "telegram".
func (t *TelegramSource) Name() string { return "telegram" }

// Authenticated marks Telegram as self-authenticating (secret token comparison).
func (t *TelegramSource) Authenticated() {}

// Parse validates the secret token and normalizes the webhook payload.
func (t *TelegramSource) Parse(headers http.Header, body []byte) (*events.Event, error) {
	if t.secretToken != "" {
		token := headers.Get("X-Telegram-Bot-Api-Secret-Token")
		if subtle.ConstantTimeCompare([]byte(token), []byte(t.secretToken)) != 1 {
			return nil, fmt.Errorf("invalid telegram secret token")
		}
	}

	var update map[string]any
	if err := json.Unmarshal(body, &update); err != nil {
		return nil, fmt.Errorf("parse telegram body: %w", err)
	}

	updateID := ""
	if uid, ok := update["update_id"].(float64); ok {
		updateID = strconv.FormatInt(int64(uid), 10)
	}

	// Content hash for delivery ID dedup
	h := sha256.Sum256(body)
	deliveryID := "telegram:" + hex.EncodeToString(h[:16])

	ev := &events.Event{
		DeliveryID: deliveryID,
		Source:     "telegram",
		Raw:        json.RawMessage(body),
		Attrs:      make(events.Attrs),
	}
	ev.Attrs["update_id"] = updateID

	// Determine event type and extract fields.
	// Use comma-ok assertions to avoid panic on malformed payloads.
	switch {
	case update["message"] != nil:
		if msg, ok := update["message"].(map[string]any); ok {
			t.parseMessage(msg, ev, "message")
		} else {
			ev.Type = "message"
		}
	case update["edited_message"] != nil:
		if msg, ok := update["edited_message"].(map[string]any); ok {
			t.parseMessage(msg, ev, "edited_message")
		} else {
			ev.Type = "edited_message"
		}
	case update["callback_query"] != nil:
		if cq, ok := update["callback_query"].(map[string]any); ok {
			t.parseCallbackQuery(cq, ev)
		} else {
			ev.Type = "callback_query"
		}
	case update["inline_query"] != nil:
		if iq, ok := update["inline_query"].(map[string]any); ok {
			t.parseInlineQuery(iq, ev)
		} else {
			ev.Type = "inline_query"
		}
	default:
		ev.Type = "unknown"
	}

	return ev, nil
}

func (t *TelegramSource) parseMessage(msg map[string]any, ev *events.Event, eventType string) {
	ev.Type = eventType

	if from, ok := msg["from"].(map[string]any); ok {
		ev.Actor, _ = from["username"].(string)
		if ev.Actor == "" {
			if fn, ok := from["first_name"].(string); ok {
				ev.Actor = fn
			}
		}
		ev.Attrs["sender"] = ev.Actor
		if id, ok := from["id"].(float64); ok {
			ev.Attrs["from_id"] = int(id)
		}
	}

	if chat, ok := msg["chat"].(map[string]any); ok {
		if id, ok := chat["id"].(float64); ok {
			ev.Subject = strconv.FormatInt(int64(id), 10)
			ev.Attrs["chat_id"] = int64(id)
		}
		if ct, ok := chat["type"].(string); ok {
			ev.Attrs["chat_type"] = ct
		}
		if title, ok := chat["title"].(string); ok {
			ev.Attrs["chat_title"] = title
		}
	}

	if text, ok := msg["text"].(string); ok {
		ev.Attrs["text"] = text
	}
	if msgID, ok := msg["message_id"].(float64); ok {
		ev.Attrs["message_id"] = int(msgID)
	}
}

func (t *TelegramSource) parseCallbackQuery(cq map[string]any, ev *events.Event) {
	ev.Type = "callback_query"
	if from, ok := cq["from"].(map[string]any); ok {
		ev.Actor, _ = from["username"].(string)
		ev.Attrs["sender"] = ev.Actor
	}
	if data, ok := cq["data"].(string); ok {
		ev.Attrs["callback_data"] = data
	}
	if msg, ok := cq["message"].(map[string]any); ok {
		if chat, ok := msg["chat"].(map[string]any); ok {
			if id, ok := chat["id"].(float64); ok {
				ev.Subject = strconv.FormatInt(int64(id), 10)
				ev.Attrs["chat_id"] = int64(id)
			}
		}
	}
}

func (t *TelegramSource) parseInlineQuery(iq map[string]any, ev *events.Event) {
	ev.Type = "inline_query"
	if from, ok := iq["from"].(map[string]any); ok {
		ev.Actor, _ = from["username"].(string)
		ev.Attrs["sender"] = ev.Actor
	}
	if query, ok := iq["query"].(string); ok {
		ev.Attrs["query"] = query
	}
}

func init() {
	var _ Source = (*TelegramSource)(nil)
	var _ Authenticated = (*TelegramSource)(nil)
}
