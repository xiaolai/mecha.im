package source

// intVal extracts an integer from a JSON-decoded value (float64 or int).
func intVal(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}
