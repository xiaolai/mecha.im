package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mecha.im/internal/events"
	"mecha.im/internal/source"
	"mecha.im/internal/workers"
)

// slackSignature computes the Slack HMAC-SHA256 signature.
func slackSignature(secret, ts string, body []byte) string {
	baseString := "v0:" + ts + ":" + string(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(baseString))
	return "v0=" + hex.EncodeToString(mac.Sum(nil))
}

func TestSource_SlackWebhook(t *testing.T) {
	slackSecret := "slack-signing-secret-test"

	sources := source.NewRegistry()
	sources.Register(source.NewSlackSource(slackSecret))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Slack event payload (message type).
	payload := map[string]any{
		"type":     "event_callback",
		"event_id": "Ev01SLACK001",
		"team_id":  "T12345",
		"event": map[string]any{
			"type":    "message",
			"user":    "U12345",
			"text":    "hello world",
			"channel": "C67890",
			"ts":      "1234567890.123456",
		},
	}
	body, _ := json.Marshal(payload)
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := slackSignature(slackSecret, ts, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/slack", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Slack-Signature", sig)
	req.Header.Set("X-Slack-Request-Timestamp", ts)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait for event to appear and verify source = "slack".
	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for slack event")
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			for _, ev := range evs {
				if ev.Source == "slack" {
					if ev.Type != "message" {
						t.Errorf("event type = %q, want message", ev.Type)
					}
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

func TestSource_SlackChallenge(t *testing.T) {
	slackSecret := "slack-challenge-secret"

	sources := source.NewRegistry()
	sources.Register(source.NewSlackSource(slackSecret))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Slack url_verification payload.
	payload := map[string]any{
		"type":      "url_verification",
		"challenge": "test-challenge-string-abc123",
		"token":     "deprecated-token",
	}
	body, _ := json.Marshal(payload)
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := slackSignature(slackSecret, ts, body)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/slack", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Slack-Signature", sig)
	req.Header.Set("X-Slack-Request-Timestamp", ts)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	defer resp.Body.Close()

	// Challenge should return 200 with the challenge value.
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 for challenge, got %d: %s", resp.StatusCode, respBody)
	}

	var challengeResp map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&challengeResp); err != nil {
		t.Fatalf("decode challenge response: %v", err)
	}
	if challengeResp["challenge"] != "test-challenge-string-abc123" {
		t.Errorf("challenge = %q, want test-challenge-string-abc123", challengeResp["challenge"])
	}
}

func TestSource_TelegramWebhook(t *testing.T) {
	telegramSecret := "telegram-secret-token-test"

	sources := source.NewRegistry()
	sources.Register(source.NewTelegramSource(telegramSecret))

	rec := &apiRecorder{}
	ghSrv := httptest.NewServer(rec.handler())
	defer ghSrv.Close()

	pts, cleanup := newPipelineServer(t, sources, ghSrv.URL)
	defer cleanup()

	// Telegram message update payload.
	payload := map[string]any{
		"update_id": 123456789,
		"message": map[string]any{
			"message_id": 42,
			"from": map[string]any{
				"id":       float64(111222),
				"username": "testuser",
			},
			"chat": map[string]any{
				"id":   float64(-100123456),
				"type": "group",
			},
			"text": "Hello from Telegram",
		},
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/telegram", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Telegram-Bot-Api-Secret-Token", telegramSecret)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait for event to appear and verify source = "telegram".
	deadline := time.After(5 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for telegram event")
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			for _, ev := range evs {
				if ev.Source == "telegram" {
					if ev.Type != "message" {
						t.Errorf("event type = %q, want message", ev.Type)
					}
					if ev.Actor != "testuser" {
						t.Errorf("event actor = %q, want testuser", ev.Actor)
					}
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

func TestSource_GitLabWebhookPipeline(t *testing.T) {
	gitlabSecret := "gitlab-webhook-secret"

	// Mock worker returns a result with comment.
	mockWkr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(200)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"output":  "MR review complete",
			"comment": map[string]string{"body": "GitLab MR looks good"},
		})
	}))
	defer mockWkr.Close()

	// Mock GitLab API records calls.
	glRec := &apiRecorder{}
	glSrv := httptest.NewServer(glRec.handler())
	defer glSrv.Close()

	srcs := source.NewRegistry()
	glSource := source.NewGitLabSource(gitlabSecret)
	srcs.Register(glSource)
	// Register GitLab responder pointed at mock GitLab API.
	glResponder := source.NewGitLabResponder(glSrv.URL, "glpat-test-token")
	srcs.RegisterResponder(glResponder)

	// We still need a dummy GH server for OverrideAPIBase (always called).
	dummyGH := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	defer dummyGH.Close()

	pts, cleanup := newPipelineServer(t, srcs, dummyGH.URL)
	defer cleanup()

	// Register a worker matching GitLab merge_request.open events.
	w := &workers.Worker{
		Name:     "gitlab-mr-reviewer",
		Endpoint: mockWkr.URL,
		Events: []workers.EventRule{{
			Source: "gitlab",
			On:     []string{"merge_request.open"},
			Prompt: "Review MR #{{.number}}",
		}},
	}
	if err := pts.Registry.Add(w); err != nil {
		t.Fatalf("registry add: %v", err)
	}
	if err := pts.Registry.Start(w.Name); err != nil {
		t.Fatalf("registry start: %v", err)
	}

	// GitLab merge request webhook payload.
	payload := map[string]any{
		"object_kind":   "merge_request",
		"user_username": "bob",
		"project": map[string]any{
			"path_with_namespace": "mygroup/myrepo",
		},
		"object_attributes": map[string]any{
			"iid":           float64(7),
			"action":        "open",
			"title":         "Fix something",
			"description":   "A fix for the bug",
			"source_branch": "fix-branch",
			"target_branch": "main",
			"last_commit": map[string]any{
				"id": "deadbeef12345678",
			},
		},
	}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", "http://"+pts.Addr+"/webhook/gitlab", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gitlab-Event", "Merge Request Hook")
	req.Header.Set("X-Gitlab-Token", gitlabSecret)
	req.Header.Set("X-Gitlab-Event-UUID", "gl-delivery-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("webhook POST: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 202 {
		t.Fatalf("expected 202, got %d", resp.StatusCode)
	}

	// Wait for event to reach completed state.
	deadline := time.After(10 * time.Second)
	for {
		select {
		case <-deadline:
			evs, _ := pts.Events.List(context.Background(), "")
			t.Fatalf("timed out waiting for gitlab event completion; events: %+v", evs)
		default:
			evs, _ := pts.Events.List(context.Background(), "")
			for _, ev := range evs {
				if ev.Source == "gitlab" && ev.State == events.StateCompleted {
					// Verify the GitLab API received a note (comment).
					calls := glRec.getCalls()
					var hasNote bool
					for _, c := range calls {
						if c.Method == "POST" && strings.Contains(c.Path, "/notes") {
							hasNote = true
							if !strings.Contains(c.Body, "GitLab MR looks good") {
								t.Errorf("note body = %q", c.Body)
							}
						}
					}
					if !hasNote {
						t.Error("expected note API call to mock GitLab")
					}
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}
