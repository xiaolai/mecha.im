package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strings"
)

var (
	repoDir       string
	webhookSecret string
)

func handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}
	if webhookSecret == "" {
		http.Error(w, "webhook disabled: no secret configured", http.StatusForbidden)
		return
	}
	sig := r.Header.Get("X-Hub-Signature-256")
	if !validateHMAC(webhookSecret, body, sig) {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}
	if r.Header.Get("X-GitHub-Event") != "push" {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ignored: not a push event"))
		return
	}
	if !touchesDocs(body) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ignored: no docs changes"))
		return
	}
	go func() {
		log.Printf("webhook: pulling %s", repoDir)
		cmd := exec.Command("git", "-C", repoDir, "pull", "--ff-only")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("webhook: git pull failed: %s: %v", string(out), err)
			return
		}
		log.Printf("webhook: git pull ok: %s", strings.TrimSpace(string(out)))
		reloadPages()
		log.Printf("webhook: docs reloaded (%d pages)", len(getPages()))
	}()
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte("pulling"))
}

func touchesDocs(body []byte) bool {
	var payload struct {
		Commits []struct {
			Added    []string `json:"added"`
			Modified []string `json:"modified"`
			Removed  []string `json:"removed"`
		} `json:"commits"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return true
	}
	for _, c := range payload.Commits {
		for _, files := range [][]string{c.Added, c.Modified, c.Removed} {
			for _, f := range files {
				if strings.HasPrefix(f, "website/") || strings.HasPrefix(f, ".claude/rules/") || strings.HasPrefix(f, "workers/") {
					return true
				}
			}
		}
	}
	return false
}

func validateHMAC(secret string, body []byte, sig string) bool {
	if !strings.HasPrefix(sig, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(sig))
}
