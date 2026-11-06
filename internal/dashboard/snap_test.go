package dashboard

import "testing"

// TestSnapRowsToBoundary nails the pure arithmetic behind the dashboard's panel snap.
// The first JS implementation measured one row and multiplied by N, which sliced any
// board with non-uniform rows — exactly the live case intake caught: rows [85, 86×9,
// 223] at wanted=710 and chrome=115 returned 710 and sliced the seventh row against
// 595px of content area. These cases pin the algorithm so the next time somebody
// reaches for `rowH * N` the test speaks up first.
func TestSnapRowsToBoundary(t *testing.T) {
	cases := []struct {
		name          string
		rows          []int
		chrome        int
		wanted        int
		expect        int
		notGreaterNor bool // when true, assert result <= wanted (the floor promise)
	}{
		{
			name:          "uniform rows, preset-sized panel",
			rows:          []int{86, 86, 86, 86, 86, 86, 86, 86, 86},
			chrome:        91,
			wanted:        720,
			expect:        91 + 7*86, // 693
			notGreaterNor: true,
		},
		{
			name: "non-uniform rows — first is 85, rest are 86: the live case",
			// Content area = 710 − 115 = 595. Accumulated: 85, 171, 257, 343, 429,
			// 515, 601 → last fit is 515 (six rows). Seven rows = 601 > 595 so the
			// seventh is dropped. snap = 115 + 515 = 630.
			rows:          []int{85, 86, 86, 86, 86, 86, 86, 86, 86, 86},
			chrome:        115,
			wanted:        710,
			expect:        115 + (85 + 5*86),
			notGreaterNor: true,
		},
		{
			name: "a tall row in the middle: walk accumulates until the next row would overflow",
			// avail = 600 − 115 = 485. Cumulative row bottoms: 85, 171, 257, 480;
			// 480+86 = 566 > 485 so the fifth row is dropped. snap = 115 + 480 = 595,
			// which is an honest edge after FOUR rows (the fourth being the 223px one).
			// The old `rowH*N` algorithm, taking rowH from the first row (85), would
			// have returned 115 + floor(485/85)*85 = 115 + 5*85 = 540 and sliced the
			// fifth row cleanly in half: the test here anchors that the walk reaches
			// 480 of actual row bottoms rather than 425 of assumed-uniform rows.
			rows:          []int{85, 86, 86, 223, 86, 86, 86},
			chrome:        115,
			wanted:        600,
			expect:        115 + (85 + 86 + 86 + 223),
			notGreaterNor: true,
		},
		{
			name:          "wanted smaller than chrome — honour wanted, do not jump above it",
			rows:          []int{86, 86, 86},
			chrome:        115,
			wanted:        80,
			expect:        80, // avail <= 0 → return wanted
			notGreaterNor: true,
		},
		{
			name:          "no row fits — return chrome + first row when that still respects wanted",
			rows:          []int{90, 90, 90},
			chrome:        115,
			wanted:        210,
			expect:        115 + 90, // 205 ≤ 210
			notGreaterNor: true,
		},
		{
			name: "mobile case — tall row, small wanted. The cap-breaker bug returned chrome+rowH above wanted. The floor promise says return wanted.",
			rows: []int{300, 100},
			// avail = 180; first row 300 > 180; no row fits; chrome+rows[0]=415
			// which is above wanted=200 → the function must return wanted.
			chrome:        115,
			wanted:        200,
			expect:        200,
			notGreaterNor: true,
		},
		{
			name:   "empty rows list — return wanted",
			rows:   []int{},
			chrome: 115,
			wanted: 400,
			expect: 400,
		},
		{
			name:          "zero-height rows are skipped so a transiently unmeasurable row does not corrupt the prefix",
			rows:          []int{86, 0, 86, 86, 86},
			chrome:        115,
			wanted:        500,
			expect:        115 + (86 + 86 + 86 + 86), // 459
			notGreaterNor: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := SnapRowsToBoundary(c.rows, c.chrome, c.wanted)
			if got != c.expect {
				t.Fatalf("SnapRowsToBoundary(%v, chrome=%d, wanted=%d) = %d, want %d",
					c.rows, c.chrome, c.wanted, got, c.expect)
			}
			if c.notGreaterNor && got > c.wanted {
				t.Fatalf("snap returned %d > wanted %d — the floor-against-wanted promise is broken", got, c.wanted)
			}
		})
	}
}
