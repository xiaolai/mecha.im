package worker

import (
	"fmt"
	"os/user"
	"strconv"
)

// CurrentUser returns the current OS user as "uid:gid" for container --user flag.
func CurrentUser() (string, error) {
	u, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("resolve current user: %w", err)
	}
	return u.Uid + ":" + u.Gid, nil
}

func ptr[T any](v T) *T { return &v }

func parseMemory(s string) (int64, error) {
	if len(s) < 2 {
		return 0, fmt.Errorf("invalid memory: %s", s)
	}
	unit := s[len(s)-1]
	num, err := strconv.ParseInt(s[:len(s)-1], 10, 64)
	if err != nil {
		return 0, err
	}
	if num <= 0 {
		return 0, fmt.Errorf("memory must be positive: %s", s)
	}
	var multiplier int64
	switch unit {
	case 'G', 'g':
		multiplier = 1024 * 1024 * 1024
	case 'M', 'm':
		multiplier = 1024 * 1024
	default:
		return 0, fmt.Errorf("unknown memory unit: %c", unit)
	}
	const maxInt64 = int64(^uint64(0) >> 1)
	if num > maxInt64/multiplier {
		return 0, fmt.Errorf("memory value overflow: %s", s)
	}
	return num * multiplier, nil
}
