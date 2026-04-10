package serve

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"mecha.im/internal/workers"
)

func (s *Server) sendTask(ctx context.Context, endpoint, taskID, prompt string, timeout time.Duration, apiKey string) (string, error) {
	if timeout == 0 {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	payload, err := json.Marshal(map[string]string{
		"id":     taskID,
		"prompt": prompt,
	})
	if err != nil {
		return "", fmt.Errorf("marshal task payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/task", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := dispatchClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("send task: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("worker returned %d: %s", resp.StatusCode, workers.RedactSecrets(string(body)))
	}

	return string(body), nil
}
