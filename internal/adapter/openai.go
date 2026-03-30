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

// OpenAIAdapter translates any OpenAI-compatible /v1/chat/completions endpoint.
// Works with vLLM, LiteLLM, llama.cpp server, and other compatible APIs.
type OpenAIAdapter struct {
	upstream string
	model    string
	apiKey   string
	client   *http.Client
}

// NewOpenAIAdapter creates an adapter for an OpenAI-compatible API endpoint.
func NewOpenAIAdapter(upstream, model, apiKey string) *OpenAIAdapter {
	return &OpenAIAdapter{
		upstream: upstream,
		model:    model,
		apiKey:   apiKey,
		client:   &http.Client{Timeout: 10 * time.Minute},
	}
}

func (o *OpenAIAdapter) Name() string { return "openai" }

func (o *OpenAIAdapter) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", o.upstream+"/v1/models", nil)
	if err != nil {
		return fmt.Errorf("create health request: %w", err)
	}
	if o.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+o.apiKey)
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("api unreachable: %w", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("api health check status %d", resp.StatusCode)
	}
	return nil
}

func (o *OpenAIAdapter) SendTask(ctx context.Context, prompt string) ([]byte, error) {
	start := time.Now()

	payload, _ := json.Marshal(map[string]any{
		"model":    o.model,
		"messages": []map[string]string{{"role": "user", "content": prompt}},
	})

	req, err := http.NewRequestWithContext(ctx, "POST", o.upstream+"/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if o.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+o.apiKey)
	}

	resp, err := o.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("api call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("api %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}

	output := ""
	if len(result.Choices) > 0 {
		output = result.Choices[0].Message.Content
	}

	durationMs := int(time.Since(start).Milliseconds())
	return json.Marshal(map[string]any{
		"output": output,
		"metadata": map[string]any{
			"model":         o.model,
			"duration_ms":   durationMs,
			"input_tokens":  result.Usage.PromptTokens,
			"output_tokens": result.Usage.CompletionTokens,
			"exit_code":     0,
		},
	})
}
