package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// OllamaAdapter translates Ollama's /api/chat endpoint into the worker contract.
type OllamaAdapter struct {
	upstream string
	model    string
	client   *http.Client
}

// NewOllamaAdapter creates an adapter for a running Ollama instance.
func NewOllamaAdapter(upstream, model string) *OllamaAdapter {
	return &OllamaAdapter{
		upstream: upstream,
		model:    model,
		client:   &http.Client{Timeout: 10 * time.Minute},
	}
}

func (o *OllamaAdapter) Name() string { return "ollama" }

func (o *OllamaAdapter) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", o.upstream+"/", nil)
	if err != nil {
		return fmt.Errorf("create health request: %w", err)
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("ollama unreachable: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("ollama status %d", resp.StatusCode)
	}
	return nil
}

func (o *OllamaAdapter) SendTask(ctx context.Context, prompt string) ([]byte, error) {
	start := time.Now()

	payload, _ := json.Marshal(map[string]any{
		"model":    o.model,
		"messages": []map[string]string{{"role": "user", "content": prompt}},
		"stream":   false,
	})

	req, err := http.NewRequestWithContext(ctx, "POST", o.upstream+"/api/chat", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := o.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ollama api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("ollama %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}

	var result struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		PromptEvalCount int `json:"prompt_eval_count"`
		EvalCount       int `json:"eval_count"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse ollama response: %w", err)
	}

	durationMs := int(time.Since(start).Milliseconds())
	return json.Marshal(map[string]any{
		"output": result.Message.Content,
		"metadata": map[string]any{
			"model":        o.model,
			"duration_ms":  durationMs,
			"input_tokens": result.PromptEvalCount,
			"output_tokens": result.EvalCount,
			"exit_code":    0,
		},
	})
}
