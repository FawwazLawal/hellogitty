package help

import (
	"testing"
	"time"
)

func TestAgo(t *testing.T) {
	loc := time.FixedZone("TEST", 0)
	now := time.Date(2026, 10, 29, 14, 32, 0, 0, loc)

	tests := []struct {
		name string
		t    time.Time
		want string
	}{
		{"zero", time.Time{}, "—"},
		{"just now", now.Add(-30 * time.Second), "just now"},
		{"minutes ago", now.Add(-12 * time.Minute), "12 min ago"},
		{"1 min ago", now.Add(-90 * time.Second), "1 min ago"},
		{"today", time.Date(2026, 10, 29, 9, 15, 0, 0, loc), "09:15"},
		{"yesterday", time.Date(2026, 10, 28, 9, 15, 0, 0, loc), "Yesterday 09:15"},
		{"this week (Mon)", time.Date(2026, 10, 26, 9, 15, 0, 0, loc), "Mon 09:15"},
		{"this year", time.Date(2026, 10, 2, 14, 32, 0, 0, loc), "Oct 2 14:32"},
		{"older", time.Date(2025, 12, 3, 10, 0, 0, 0, loc), "2025-12-03"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Ago(now, tt.t)
			if got != tt.want {
				t.Errorf("Ago(%v) = %q, want %q", tt.t, got, tt.want)
			}
		})
	}
}
