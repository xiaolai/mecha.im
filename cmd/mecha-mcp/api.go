package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"mecha.im/internal/workers"
)

// mechaAPI is the base URL for the mecha serve instance.
var mechaAPI string

// mechaAPIKey is the optional API key for authenticating to mecha serve.
var mechaAPIKey string

var apiClient = &http.Client{Timeout: 5 * time.Minute}

func initAPI() {
	mechaAPI = os.Getenv("MECHA_API_URL")
	mechaAPIKey = os.Getenv("MECHA_API_KEY")

	// Fall back to config file if env vars not set
	if mechaAPI == "" || mechaAPIKey == "" {
		if cfg, err := workers.LoadServerConfig(); err == nil {
			if mechaAPI == "" && cfg.Addr != "" {
				mechaAPI = "http://" + cfg.Addr
			}
			if mechaAPIKey == "" && cfg.APIKey != "" {
				mechaAPIKey = cfg.APIKey
			}
		}
	}
	if mechaAPI == "" {
		mechaAPI = "http://127.0.0.1:21212"
	}
	mechaAPI = strings.TrimRight(mechaAPI, "/")
}

func apiGet(path string) ([]byte, int, error) {
	req, err := http.NewRequest("GET", mechaAPI+path, nil)
	if err != nil {
		return nil, 0, err
	}
	if mechaAPIKey != "" {
		req.Header.Set("Authorization", "Bearer "+mechaAPIKey)
	}
	resp, err := apiClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("mecha API unreachable: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func apiPostRaw(path, rawBody string, args map[string]any) ([]byte, int, error) {
	req, err := http.NewRequest("POST", mechaAPI+path, strings.NewReader(rawBody))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if mechaAPIKey != "" {
		req.Header.Set("Authorization", "Bearer "+mechaAPIKey)
	}
	// Forward event-type header for generic sources
	if h, ok := args["event_type"].(string); ok {
		req.Header.Set("X-Event-Type", h)
	}
	resp, err := apiClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("mecha API unreachable: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func apiPost(path string, payload any) ([]byte, int, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequest("POST", mechaAPI+path, bytes.NewReader(data))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if mechaAPIKey != "" {
		req.Header.Set("Authorization", "Bearer "+mechaAPIKey)
	}
	resp, err := apiClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("mecha API unreachable: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}
