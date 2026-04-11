package source

import (
	"encoding/json"
	"net/http"
	"testing"
)

func telegramHeaders(secret string) http.Header {
	h := http.Header{}
	if secret != "" {
		h.Set("X-Telegram-Bot-Api-Secret-Token", secret)
	}
	return h
}

func TestTelegramSourceName(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("secret")
	if got := src.Name(); got != "telegram" {
		t.Errorf("Name() = %q, want %q", got, "telegram")
	}
}

func TestTelegramSourceParseMessage(t *testing.T) {
	t.Parallel()
	secret := "my-bot-secret"
	src := NewTelegramSource(secret)

	update := map[string]any{
		"update_id": float64(12345),
		"message": map[string]any{
			"message_id": float64(100),
			"from": map[string]any{
				"id":         float64(9876),
				"username":   "testuser",
				"first_name": "Test",
			},
			"chat": map[string]any{
				"id":    float64(-100123456),
				"type":  "group",
				"title": "Test Group",
			},
			"text": "hello from telegram",
		},
	}
	body, _ := json.Marshal(update)

	ev, err := src.Parse(telegramHeaders(secret), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Source != "telegram" {
		t.Errorf("Source = %q, want %q", ev.Source, "telegram")
	}
	if ev.Type != "message" {
		t.Errorf("Type = %q, want %q", ev.Type, "message")
	}
	if ev.Actor != "testuser" {
		t.Errorf("Actor = %q, want %q", ev.Actor, "testuser")
	}
	if ev.Subject != "-100123456" {
		t.Errorf("Subject = %q, want %q", ev.Subject, "-100123456")
	}
	if ev.Attrs["text"] != "hello from telegram" {
		t.Errorf("Attrs[text] = %v", ev.Attrs["text"])
	}
	if ev.Attrs["chat_type"] != "group" {
		t.Errorf("Attrs[chat_type] = %v", ev.Attrs["chat_type"])
	}
	if ev.Attrs["chat_title"] != "Test Group" {
		t.Errorf("Attrs[chat_title] = %v", ev.Attrs["chat_title"])
	}
	if ev.Attrs["update_id"] != "12345" {
		t.Errorf("Attrs[update_id] = %v", ev.Attrs["update_id"])
	}
	if ev.Attrs["message_id"] != 100 {
		t.Errorf("Attrs[message_id] = %v (type %T)", ev.Attrs["message_id"], ev.Attrs["message_id"])
	}
	if ev.Attrs["from_id"] != 9876 {
		t.Errorf("Attrs[from_id] = %v", ev.Attrs["from_id"])
	}
	// DeliveryID should be a content-hash based ID
	if ev.DeliveryID == "" {
		t.Error("expected non-empty DeliveryID")
	}
	if len(ev.DeliveryID) < 10 {
		t.Errorf("DeliveryID = %q, expected telegram:hex format", ev.DeliveryID)
	}
}

func TestTelegramSourceParseEditedMessage(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewTelegramSource(secret)

	update := map[string]any{
		"update_id": float64(12346),
		"edited_message": map[string]any{
			"message_id": float64(101),
			"from": map[string]any{
				"id":       float64(111),
				"username": "editor",
			},
			"chat": map[string]any{
				"id":   float64(222),
				"type": "private",
			},
			"text": "edited text",
		},
	}
	body, _ := json.Marshal(update)

	ev, err := src.Parse(telegramHeaders(secret), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Type != "edited_message" {
		t.Errorf("Type = %q, want %q", ev.Type, "edited_message")
	}
	if ev.Actor != "editor" {
		t.Errorf("Actor = %q, want %q", ev.Actor, "editor")
	}
	if ev.Attrs["text"] != "edited text" {
		t.Errorf("Attrs[text] = %v", ev.Attrs["text"])
	}
}

func TestTelegramSourceParseCallbackQuery(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewTelegramSource(secret)

	update := map[string]any{
		"update_id": float64(12347),
		"callback_query": map[string]any{
			"id": "cb-001",
			"from": map[string]any{
				"username": "clicker",
			},
			"data": "button_action",
			"message": map[string]any{
				"chat": map[string]any{
					"id": float64(333),
				},
			},
		},
	}
	body, _ := json.Marshal(update)

	ev, err := src.Parse(telegramHeaders(secret), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Type != "callback_query" {
		t.Errorf("Type = %q, want %q", ev.Type, "callback_query")
	}
	if ev.Actor != "clicker" {
		t.Errorf("Actor = %q, want %q", ev.Actor, "clicker")
	}
	if ev.Attrs["callback_data"] != "button_action" {
		t.Errorf("Attrs[callback_data] = %v", ev.Attrs["callback_data"])
	}
	if ev.Subject != "333" {
		t.Errorf("Subject = %q, want %q", ev.Subject, "333")
	}
}

func TestTelegramSourceParseInlineQuery(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewTelegramSource(secret)

	update := map[string]any{
		"update_id": float64(12348),
		"inline_query": map[string]any{
			"id": "iq-001",
			"from": map[string]any{
				"username": "searcher",
			},
			"query": "search term",
		},
	}
	body, _ := json.Marshal(update)

	ev, err := src.Parse(telegramHeaders(secret), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Type != "inline_query" {
		t.Errorf("Type = %q, want %q", ev.Type, "inline_query")
	}
	if ev.Actor != "searcher" {
		t.Errorf("Actor = %q, want %q", ev.Actor, "searcher")
	}
	if ev.Attrs["query"] != "search term" {
		t.Errorf("Attrs[query] = %v", ev.Attrs["query"])
	}
}

func TestTelegramSourceParseInvalidToken(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("correct-secret")

	update := map[string]any{
		"update_id": float64(1),
		"message": map[string]any{
			"text": "hello",
			"from": map[string]any{"username": "u"},
			"chat": map[string]any{"id": float64(1)},
		},
	}
	body, _ := json.Marshal(update)

	_, err := src.Parse(telegramHeaders("wrong-secret"), body)
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
	if got := err.Error(); got != "invalid telegram secret token" {
		t.Errorf("error = %q", got)
	}
}

func TestTelegramSourceParseUnknown(t *testing.T) {
	t.Parallel()
	secret := "my-secret"
	src := NewTelegramSource(secret)

	// Update with no recognized type
	update := map[string]any{
		"update_id":       float64(99),
		"channel_post":    map[string]any{"text": "post"},
	}
	body, _ := json.Marshal(update)

	ev, err := src.Parse(telegramHeaders(secret), body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Type != "unknown" {
		t.Errorf("Type = %q, want %q", ev.Type, "unknown")
	}
}

func TestTelegramSourceParseMissingToken(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("my-secret")
	update := map[string]any{
		"update_id": float64(1),
		"message": map[string]any{
			"text": "hi",
			"from": map[string]any{"username": "u"},
			"chat": map[string]any{"id": float64(1)},
		},
	}
	body, _ := json.Marshal(update)

	// No header at all
	_, err := src.Parse(http.Header{}, body)
	if err == nil {
		t.Error("expected error when secret token header is missing")
	}
}

func TestTelegramSourceParseNoSecret(t *testing.T) {
	t.Parallel()
	// Empty secret skips verification
	src := NewTelegramSource("")
	update := map[string]any{
		"update_id": float64(1),
		"message": map[string]any{
			"text": "hi",
			"from": map[string]any{"username": "u"},
			"chat": map[string]any{"id": float64(1)},
		},
	}
	body, _ := json.Marshal(update)

	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() with empty secret should not error: %v", err)
	}
	if ev.Type != "message" {
		t.Errorf("Type = %q", ev.Type)
	}
}

func TestTelegramSourceParseInvalidJSON(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("")
	_, err := src.Parse(http.Header{}, []byte("not json"))
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestTelegramSourceParseFallbackActor(t *testing.T) {
	t.Parallel()
	// When username is empty, falls back to first_name
	src := NewTelegramSource("")
	update := map[string]any{
		"update_id": float64(1),
		"message": map[string]any{
			"from": map[string]any{
				"id":         float64(42),
				"first_name": "John",
			},
			"chat": map[string]any{"id": float64(1), "type": "private"},
			"text": "hi",
		},
	}
	body, _ := json.Marshal(update)

	ev, err := src.Parse(http.Header{}, body)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if ev.Actor != "John" {
		t.Errorf("Actor = %q, want %q (first_name fallback)", ev.Actor, "John")
	}
}

func TestTelegramSourceAuthenticated(t *testing.T) {
	t.Parallel()
	src := NewTelegramSource("secret")
	var _ Authenticated = src
	src.Authenticated()
}
