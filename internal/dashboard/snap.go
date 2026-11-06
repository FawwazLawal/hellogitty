package dashboard

// Reference implementation of the dashboard's snap-to-row-boundary arithmetic.
//
// The behaviour lives client-side in web/index.html as snapPanelToRowBoundary; a Go
// reference exists here so the pure arithmetic can be tested against concrete inputs
// (including the non-uniform-row case the first implementation got wrong: multiplying
// one measured row height by N quietly slices a differently-sized row). The JS
// implementation must walk the same algorithm; see the test for the behaviour both
// must guarantee.
//
// SnapRowsToBoundary takes the heights of a panel's visible rows in order, the panel's
// chrome height (header + sort bar + presize handle), and the height the caller
// wanted the panel to be. It returns a height that:
//
//  1. is never greater than `wanted` ("floor against wanted, never a cap"),
//  2. lands exactly on the bottom of a row — chrome + sum of some prefix of row
//     heights — whenever at least one row fits inside `wanted - chrome`,
//  3. falls back to `min(wanted, chrome + rows[0])` when no row fits, so a tall row
//     on a narrow viewport does not jump the panel above the wanted height.
//
// `rows` must contain strictly positive heights; non-positive entries are skipped so
// a transiently unmeasurable row does not corrupt the prefix sum.
func SnapRowsToBoundary(rows []int, chrome, wanted int) int {
	if wanted <= 0 {
		return wanted
	}
	if chrome < 0 {
		chrome = 0
	}
	avail := wanted - chrome
	if avail <= 0 || len(rows) == 0 {
		return wanted
	}
	var acc int
	lastFit := -1
	for _, h := range rows {
		if h <= 0 {
			continue
		}
		next := acc + h
		if next > avail {
			break
		}
		acc = next
		lastFit = acc
	}
	if lastFit < 0 {
		// No row fits. Keep the floor-against-wanted promise: never return above
		// wanted, even when a single row is taller than the whole available space.
		oneRow := chrome + rows[0]
		if oneRow <= wanted {
			return oneRow
		}
		return wanted
	}
	return chrome + lastFit
}
