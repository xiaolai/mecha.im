package policies

import "fmt"

// parseBoolField extracts a bool from a map, returning an error if the value
// exists but is not a bool (e.g. "yes" or 1).
func parseBoolField(m map[string]any, key, section string) (bool, error) {
	v, ok := m[key]
	if !ok {
		return false, nil
	}
	b, ok := v.(bool)
	if !ok {
		return false, fmt.Errorf("policy.%s.%s must be a boolean, got %T(%v)", section, key, v, v)
	}
	return b, nil
}

func parseIntField(m map[string]any, key string) int {
	if v, ok := m[key].(int); ok {
		return v
	}
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

func parseStringList(m map[string]any, key string) []string {
	raw, ok := m[key].([]any)
	if !ok {
		return nil
	}
	var out []string
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// ParseRules converts a raw YAML map into a RuleFilter.
// Returns AllowAll if the map is nil or empty.
// Returns an error if field types are wrong (e.g. allow: "yes").
func ParseRules(raw map[string]any) (Filter, error) {
	if len(raw) == 0 {
		return &AllowAll{}, nil
	}
	r := &RuleFilter{}
	if cm, ok := raw["comment"].(map[string]any); ok {
		allow, err := parseBoolField(cm, "allow", "comment")
		if err != nil {
			return nil, err
		}
		r.Comment = &CommentPolicy{
			Allow:     allow,
			MaxLength: parseIntField(cm, "max_length"),
		}
	}
	if lm, ok := raw["labels"].(map[string]any); ok {
		allow, err := parseBoolField(lm, "allow", "labels")
		if err != nil {
			return nil, err
		}
		r.Labels = &LabelPolicy{
			Allow:   allow,
			Allowed: parseStringList(lm, "allowed"),
			Blocked: parseStringList(lm, "blocked"),
		}
	}
	if sm, ok := raw["status"].(map[string]any); ok {
		allow, err := parseBoolField(sm, "allow", "status")
		if err != nil {
			return nil, err
		}
		r.Status = &StatusPolicy{Allow: allow}
	}
	if cm, ok := raw["commit"].(map[string]any); ok {
		allow, err := parseBoolField(cm, "allow", "commit")
		if err != nil {
			return nil, err
		}
		r.Commit = &CommitPolicy{
			Allow:   allow,
			MaxSize: parseIntField(cm, "max_size"),
		}
	}
	if mm, ok := raw["metadata"].(map[string]any); ok {
		allow, err := parseBoolField(mm, "allow", "metadata")
		if err != nil {
			return nil, err
		}
		r.Metadata = &MetadataPolicy{Allow: allow}
	}
	return r, nil
}
