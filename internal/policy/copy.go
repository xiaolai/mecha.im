package policy

// Deep-copy helpers for Result fields. Ensures policy filtering never
// aliases the caller's original data.

func copyComment(c *CommentAction) *CommentAction {
	if c == nil {
		return nil
	}
	cc := *c
	return &cc
}

func copyLabels(l *LabelAction) *LabelAction {
	if l == nil {
		return nil
	}
	cp := LabelAction{
		Add:    append([]string(nil), l.Add...),
		Remove: append([]string(nil), l.Remove...),
	}
	return &cp
}

func copyStatus(s *StatusAction) *StatusAction {
	if s == nil {
		return nil
	}
	ss := *s
	return &ss
}

func copyCommit(c *CommitAction) *CommitAction {
	if c == nil {
		return nil
	}
	cc := *c
	return &cc
}

func copyMetadata(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	cp := make(map[string]any, len(m))
	for k, v := range m {
		cp[k] = v
	}
	return cp
}
