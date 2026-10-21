package dashboard

import (
	"github.com/FawwazLawal/hellogitty/internal/help"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

// OverlapSource is optional: a Source that watches planned issues for someone else's work shows
// those reports in the row peeks.
type OverlapSource interface {
	OverlapReports() []store.Overlap
}

// The peek card and the work peek live in internal/help, shared with the extension.
type (
	peek     = help.Peek
	peekLine = help.PeekLine
)

// overlapsByIssue indexes overlap reports by "owner/name#123", lower case.
func overlapsByIssue(rows []store.Overlap) map[string][]store.Overlap {
	out := map[string][]store.Overlap{}
	for _, o := range rows {
		k := rowKey(o.Repo, o.Number)
		out[k] = append(out[k], o)
	}
	return out
}

// workPeek is help.WorkPeek plus any overlap reports about the row.
func workPeek(it work.Item, login string, now time.Time, overlaps map[string][]store.Overlap) peek {
	p := help.WorkPeek(it, login, now)
	for _, o := range overlaps[rowKey(it.Repo, it.Number)] {
		lvl := ""
		if o.Hard {
			lvl = "caution"
		}
		p.Add("Someone else", lvl, o.Summary)
	}
	return p
}

// addOverlapPeeks adds the overlap reports to the work rows they are about.
func addOverlapPeeks(v *workView, overlaps map[string][]store.Overlap) {
	for _, list := range []*[]workRow{&v.You, &v.Them, &v.Done, &v.InYou, &v.InThem} {
		for i := range *list {
			r := &(*list)[i]
			for _, o := range overlaps[r.K] {
				lvl := ""
				if o.Hard {
					lvl = "caution"
				}
				r.Peek.Add("Someone else", lvl, o.Summary)
			}
		}
	}
}

func repoPeek(rw row, now time.Time, overlaps []store.Overlap) peek {
	p := peek{Head: rw.Owner + "/" + rw.Name}
	health := map[string]string{"ACTIVE": "Active", "SLOW": "Slowing", "DORMANT": "Dormant", "UNKNOWN": "Not checked yet"}[rw.Health]
	lvl := ""
	if rw.Health == "SLOW" || rw.Health == "DORMANT" {
		lvl = "caution"
	}
	if rw.AgeKnown {
		health += ", last commit " + plural(rw.AgeDays, "day") + " ago"
	}
	p.Add("Health", lvl, health)
	p.Add("Issues", "", strconv.Itoa(rw.Open)+" open · "+strconv.Itoa(rw.GFI)+" good first · "+strconv.Itoa(rw.Unassigned)+" unassigned")
	if rw.InPipeline {
		s := "Stage " + rw.Stage
		if rw.Label != "" {
			s += " · " + rw.Label
		}
		p.Add("Pipeline", rw.Level, s)
	}
	var prs []string
	for _, pr := range rw.PRs {
		prs = append(prs, "#"+strconv.Itoa(pr.Number)+" "+strings.ToLower(pr.State))
	}
	p.Add("Your PRs", "", strings.Join(prs, " · "))
	if n := len(rw.Watch); n > 0 {
		p.Add("Watching", "", plural(n, "issue"))
	}
	if len(rw.Denied) > 0 {
		d := rw.Denied[0]
		why := "no comment before closing"
		if c := excerptN(d.ClosingComment, 110); c != "" {
			why = "“" + c + "”"
		}
		p.Add("Last turned down", "", "#"+strconv.Itoa(d.Number)+" "+excerptN(d.Title, 60)+": "+why)
	}
	shown := 0
	for _, o := range overlaps {
		if !strings.EqualFold(o.Repo, rw.Owner+"/"+rw.Name) || shown == 3 {
			continue
		}
		shown++
		lvl := ""
		if o.Hard {
			lvl = "caution"
		}
		p.Add("Someone else", lvl, "#"+strconv.Itoa(o.Number)+": "+o.Summary)
	}
	if rw.Error != "" {
		p.Add("Last check", "warn", "failed: "+excerptN(rw.Error, 100))
	}
	return p
}
