package serve

import (
	"fmt"

	"mecha.im/internal/source"
	"mecha.im/internal/workers"
)

// ReloadSecrets re-reads the secrets file and live-updates source HMAC keys
// and the write-back token without restarting mecha serve. Called on SIGHUP.
//
// Only sources that have credentials in the new secrets file are updated.
// Sources with empty credentials are not deregistered — they keep their
// previous credentials. This prevents accidental deregistration on a partial
// secrets file.
func (s *Server) ReloadSecrets(secretsPath string) error {
	secrets, err := workers.LoadSecrets(secretsPath)
	if err != nil {
		return fmt.Errorf("reload secrets: %w", err)
	}

	if s.sources != nil {
		// Re-register sources with updated credentials. Register() overwrites
		// the existing entry by the same Name() key, so in-flight webhook
		// handlers that already hold a reference to the old source object
		// finish with the old HMAC secret; subsequent requests use the new one.
		ghToken := secrets.GitHub.Token
		ghSecret := secrets.GitHub.WebhookSecret
		if ghToken != "" || ghSecret != "" {
			s.sources.Register(source.NewGitHubSource(ghSecret, ghToken))
		}
		if glSecret := secrets.GitLab.WebhookSecret; glSecret != "" {
			s.sources.Register(source.NewGitLabSource(glSecret))
		}
		if slackSecret := secrets.Slack.SigningSecret; slackSecret != "" {
			s.sources.Register(source.NewSlackSource(slackSecret))
		}
		if tgSecret := secrets.Telegram.SecretToken; tgSecret != "" {
			s.sources.Register(source.NewTelegramSource(tgSecret))
		}
	}

	if s.writeback != nil {
		s.writeback.UpdateToken(secrets.GitHub.Token)
	}

	s.logger.Info("secrets reloaded", "path", secretsPath)
	return nil
}
