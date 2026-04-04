package workers

import (
	"fmt"
	"net"
	"net/url"
)

// blockedCIDRs are IP ranges that adapter upstream URLs must not resolve to.
// Blocks cloud metadata endpoints and link-local ranges. Private ranges
// (10.x, 172.16.x, 192.168.x, loopback) are intentionally allowed because
// adapters legitimately target local services (e.g., Ollama on localhost).
var blockedCIDRs = []net.IPNet{
	cidr("169.254.169.254/32"), // cloud metadata (AWS, GCP, Azure)
	cidr("169.254.0.0/16"),     // link-local
	cidr("0.0.0.0/8"),          // "this" network
	cidr("fe80::/10"),          // IPv6 link-local
}

func cidr(s string) net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic("bad CIDR: " + s)
	}
	return *n
}

// ValidateUpstreamURL checks that a URL is well-formed and does not target
// blocked IP ranges. Used for adapter upstream URLs to prevent SSRF.
func ValidateUpstreamURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("upstream scheme must be http or https, got %q", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("upstream URL has no host")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		// Not an IP literal — resolve hostname
		ips, err := net.LookupIP(host)
		if err != nil {
			return fmt.Errorf("resolve %q: %w", host, err)
		}
		for _, resolved := range ips {
			if isBlockedIP(resolved) {
				return fmt.Errorf("upstream %q resolves to blocked IP %s", host, resolved)
			}
		}
		return nil
	}
	if isBlockedIP(ip) {
		return fmt.Errorf("upstream IP %s is in a blocked range", ip)
	}
	return nil
}

func isBlockedIP(ip net.IP) bool {
	for _, cidr := range blockedCIDRs {
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}
