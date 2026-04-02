package policy

// Result is the shared worker result contract.
// Used by policy filtering and write-back.
type Result struct {
	Output   string         `json:"output"`
	Comment  *CommentAction `json:"comment,omitempty"`
	Labels   *LabelAction   `json:"labels,omitempty"`
	Status   *StatusAction  `json:"status,omitempty"`
	Commit   *CommitAction  `json:"commit,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// CommentAction posts a comment to a PR or issue.
type CommentAction struct {
	Target string `json:"target"`
	Body   string `json:"body"`
}

// LabelAction adds or removes labels.
type LabelAction struct {
	Add    []string `json:"add,omitempty"`
	Remove []string `json:"remove,omitempty"`
}

// StatusAction sets a commit status.
type StatusAction struct {
	State       string `json:"state"`
	Description string `json:"description"`
}

// CommitAction suggests code changes.
type CommitAction struct {
	Message string `json:"message"`
	Diff    string `json:"diff"`
}

// ValidStatusStates are the allowed commit status states (GitHub API).
var ValidStatusStates = map[string]bool{
	"error": true, "failure": true, "pending": true, "success": true,
}
