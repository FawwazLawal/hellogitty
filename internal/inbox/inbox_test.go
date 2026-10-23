package inbox

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/store"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

var t0 = time.Date(2026, 10, 20, 7, 40, 1, 0, time.UTC)

func tp(t time.Time) *time.Time { return &t }

// board is one open pull request carrying every kind of event, plus things that must stay out.
func board() *work.Board {
	return &work.Board{Login: "me", Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, Repo: "OpenCTI-Platform/opencti", Number: 19110, State: "OPEN",
			URL: "https://github.com/OpenCTI-Platform/opencti/pull/19110", HeadOID: "abcdef0123456789", Base: "master",
			ReviewDecision: "CHANGES_REQUESTED", ChangesBy: []string{"Archidoit"}, ChangesAt: tp(t0), Conflict: true,
			Threads: []work.Thread{{Author: "Archidoit"}, {Author: "Archidoit"},
				{Author: "coderabbitai", Bot: true, Path: "src/a.ts", Body: "Rename this", At: t0.Add(2 * time.Minute),
					URL: "https://github.com/OpenCTI-Platform/opencti/pull/19110#discussion_r777"}},
			CheckList: []work.Check{{Name: "lint", State: work.CheckFailed, At: tp(t0.Add(time.Hour))}, {Name: "test", State: work.CheckPassed}},
			Recent: []work.Activity{
				{Author: "Archidoit", Review: "CHANGES_REQUESTED", Body: "Use the EMPTY_VALUE constant", At: t0,
					URL: "https://github.com/OpenCTI-Platform/opencti/pull/19110#pullrequestreview-1761234567"},
				{Author: "Archidoit", Body: "<!-- x -->Also **here**", At: t0.Add(time.Minute),
					URL: "https://github.com/OpenCTI-Platform/opencti/pull/19110#issuecomment-555"},
				{Author: "coderabbitai", Bot: true, Path: "src/a.ts", Body: "Rename this", At: t0.Add(2 * time.Minute),
					URL: "https://github.com/OpenCTI-Platform/opencti/pull/19110#discussion_r777"},
			}},
		{PR: true, Role: work.RoleAuthor, Repo: "pbakaus/impeccable", Number: 1084, State: "MERGED", MergedBy: "pbakaus", ClosedAt: tp(t0.Add(3 * time.Hour)),
			URL: "https://github.com/pbakaus/impeccable/pull/1084"},
		{PR: false, Role: work.RoleAuthor, Repo: "x/issue", Number: 1, State: "OPEN", Recent: []work.Activity{{Author: "a", Body: "issue reply", URL: "u#issuecomment-1"}}},
		{PR: true, Role: work.RoleInvolved, Repo: "x/other", Number: 2, State: "OPEN", Recent: []work.Activity{{Author: "a", Body: "not ours", URL: "u#issuecomment-2"}}},
	}, Incoming: []work.Item{{PR: true, Role: work.RoleMaintains, Repo: "me/tool", Number: 3, State: "OPEN",
		Recent: []work.Activity{{Author: "a", Body: "incoming", URL: "u#issuecomment-3"}}}}}
}

func reports() []store.RepoReport {
	return []store.RepoReport{{Repo: store.Repo{Owner: "corazawaf", Name: "coraza"}, Watch: []store.WatchReport{
		{Number: 804, Title: "Document skip", Status: "claimed", ClaimDetail: "https://github.com/corazawaf/coraza/issues/804#issuecomment-9", StatusChangedAt: tp(t0)},
		{Number: 805, Title: "Still open", Status: "open"},
	}}}
}

// seenAt records first sightings like the store does: the first call for an id fixes its time.
func seenAt(table map[string]time.Time, now time.Time) FirstSeen {
	return func(id string) time.Time {
		if t, ok := table[id]; ok {
			return t
		}
		table[id] = now
		return now
	}
}

func TestBuildKeepsOnlyPertinentEvents(t *testing.T) {
	got := Build(board(), reports(), seenAt(map[string]time.Time{}, t0.Add(10*time.Hour)))
	byID := map[string]Entry{}
	for _, e := range got {
		byID[e.ID] = e
	}
	want := map[string]string{
		"hg-opencti-platform-opencti-19110-review-1761234567": KindReview,
		"hg-opencti-platform-opencti-19110-comment-555":       KindComment,
		"hg-opencti-platform-opencti-19110-bot-inline-777":    KindBot,
		"hg-opencti-platform-opencti-19110-ci-red-abcdef0":    KindState,
		"hg-opencti-platform-opencti-19110-conflict-abcdef0":  KindState,
		"hg-pbakaus-impeccable-1084-merged":                   KindState,
		"hg-corazawaf-coraza-804-watch-claimed":               KindWatched,
	}
	if len(got) != len(want) {
		var ids []string
		for _, e := range got {
			ids = append(ids, e.ID)
		}
		t.Fatalf("got %d entries %v, want %d", len(got), ids, len(want))
	}
	for id, kind := range want {
		if e, ok := byID[id]; !ok || e.Kind != kind {
			t.Errorf("missing or wrong kind for %s: %+v", id, e)
		}
	}
	r := byID["hg-opencti-platform-opencti-19110-review-1761234567"]
	if r.Actor != "Archidoit" || !r.OccurredAt.Equal(t0) || r.Summary != "CHANGES_REQUESTED, 2 unresolved inline comments: Use the EMPTY_VALUE constant" {
		t.Errorf("review entry %+v", r)
	}
	if c := byID["hg-opencti-platform-opencti-19110-bot-inline-777"]; c.Summary != "1 open finding from @coderabbitai. Newest: Inline on a.ts: Rename this" {
		t.Errorf("a bot's finding is one entry per PR, naming the file, not the whole path: %q", c.Summary)
	}
	if c := byID["hg-opencti-platform-opencti-19110-comment-555"]; c.Summary != "Also here" {
		t.Errorf("comment summary should be one clean line: %q", c.Summary)
	}
	if ci := byID["hg-opencti-platform-opencti-19110-ci-red-abcdef0"]; !ci.OccurredAt.Equal(t0.Add(time.Hour)) || ci.Summary != "CI failing: lint" {
		t.Errorf("CI entry should carry the failing check's own time and name: %+v", ci)
	}
	if w := byID["hg-corazawaf-coraza-804-watch-claimed"]; w.URL != "https://github.com/corazawaf/coraza/issues/804#issuecomment-9" {
		t.Errorf("watched entry should link the claim: %+v", w)
	}
	for i := 1; i < len(got); i++ {
		if got[i].OccurredAt.Before(got[i-1].OccurredAt) {
			t.Error("entries should be oldest first")
		}
	}
}

func TestIDsAndTimesStableAcrossPolls(t *testing.T) {
	table := map[string]time.Time{}
	first := Build(board(), reports(), seenAt(table, t0.Add(10*time.Hour)))
	second := Build(board(), reports(), seenAt(table, t0.Add(11*time.Hour))) // an hour later
	if !reflect.DeepEqual(first, second) {
		t.Errorf("the same events must keep the same ids and times across polls\nfirst  %+v\nsecond %+v", first, second)
	}
	for _, e := range first {
		if strings.Contains(e.ID, "conflict") && !e.OccurredAt.Equal(t0.Add(10*time.Hour)) {
			t.Errorf("an event GitHub doesn't timestamp keeps its first-seen time: %+v", e)
		}
	}
}

func TestEventIDFromGitHubIDs(t *testing.T) {
	for url, want := range map[string]string{
		"https://github.com/o/r/pull/1#issuecomment-123":      "comment-123",
		"https://github.com/o/r/pull/1#pullrequestreview-456": "review-456",
		"https://github.com/o/r/pull/1#discussion_r789":       "inline-789",
	} {
		if got := eventID(url); got != want {
			t.Errorf("%s: got %s want %s", url, got, want)
		}
	}
	if a, b := eventID("https://example/x"), eventID("https://example/x"); a != b || !strings.HasPrefix(a, "event-") {
		t.Errorf("fallback id must be stable: %s %s", a, b)
	}
}

func TestWriteReplacesAtomicallyAndLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "inbox.json")
	for i := 0; i < 2; i++ {
		f := File{GeneratedAt: t0.Add(time.Duration(i) * time.Minute), PollIntervalMinutes: 5, Entries: Build(board(), reports(), seenAt(map[string]time.Time{}, t0))}
		if err := Write(path, f); err != nil {
			t.Fatal(err)
		}
	}
	var got File
	b, _ := os.ReadFile(path)
	if err := json.Unmarshal(b, &got); err != nil || len(got.Entries) != 7 || !got.GeneratedAt.Equal(t0.Add(time.Minute)) {
		t.Fatalf("second write should be the whole file: err=%v entries=%d at=%v", err, len(got.Entries), got.GeneratedAt)
	}
	names, _ := os.ReadDir(dir)
	if len(names) != 1 {
		t.Errorf("temporary files left behind: %v", names)
	}
	if fi, _ := os.Stat(path); fi.Mode().Perm() != 0o644 {
		t.Errorf("mode %v", fi.Mode().Perm())
	}
	if err := Write(path, File{}); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(path)
	if !strings.Contains(string(b), `"entries": []`) {
		t.Errorf("an empty inbox is an empty list, not null: %s", b)
	}
}

func TestFailedWriteKeepsThePreviousFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "inbox.json")
	if err := Write(path, File{PollIntervalMinutes: 5}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	os.Chmod(dir, 0o555) // no new files allowed, so the temporary file cannot be created
	defer os.Chmod(dir, 0o755)
	if err := Write(path, File{PollIntervalMinutes: 60}); err == nil {
		t.Skip("directory permissions not enforced here (running as root?)")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Error("a failed write must leave the previous inbox untouched")
	}
}

func TestReaderNeverSeesAHalfWrittenFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "inbox.json")
	big := Build(board(), reports(), seenAt(map[string]time.Time{}, t0))
	for len(big) < 2000 {
		big = append(big, big...)
	}
	if err := Write(path, File{Entries: big}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 40; i++ {
			Write(path, File{PollIntervalMinutes: i, Entries: big})
		}
		close(stop)
	}()
	reads := 0
	for done := false; !done; {
		select {
		case <-stop:
			done = true
		default:
		}
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var f File
		if err := json.Unmarshal(b, &f); err != nil {
			t.Fatalf("read a partial inbox (%d bytes): %v", len(b), err)
		}
		reads++
	}
	wg.Wait()
	if reads == 0 {
		t.Error("no reads happened during the writes")
	}
}

func TestOverlapsSayOneThingPerWatchedIssue(t *testing.T) {
	rows := []store.Overlap{
		{Repo: "hapifhir/hapi-fhir", Number: 8504, Signal: "similar-pr-8600", Actor: "z", URL: "u1", Summary: "Worth a look", OccurredAt: t0, ReportedAt: t0},
		{Repo: "hapifhir/hapi-fhir", Number: 8504, Signal: "pr-8521", Hard: true, Actor: "rasmus0201", URL: "https://github.com/hapifhir/hapi-fhir/pull/8521",
			Summary: "Another pull request cites this issue: #8521", OccurredAt: t0.Add(-time.Hour), ReportedAt: t0},
		{Repo: "o/soft", Number: 2, Signal: "similar-pr-3", URL: "u3", Summary: "Worth a look: #3", OccurredAt: t0, ReportedAt: t0},
		{Repo: "o/gone", Number: 4, Signal: "closed", Hard: true, Summary: "Closed", OccurredAt: t0, ReportedAt: t0},
		{Repo: "corazawaf/coraza", Number: 804, Signal: "assigned-x", Hard: true, Summary: "Assigned to @x", OccurredAt: t0, ReportedAt: t0},
	}
	watching := map[string]bool{"hapifhir/hapi-fhir#8504": true, "o/soft#2": true, "corazawaf/coraza#804": true} // o/gone left the board
	got := WithOverlaps(Build(nil, reports(), seenAt(map[string]time.Time{}, t0)), rows, watching)
	byID := map[string]Entry{}
	for _, e := range got {
		byID[e.ID] = e
	}
	if len(got) != 3 {
		t.Fatalf("one entry per watched issue, got %+v", got)
	}
	hard := byID["hg-hapifhir-hapi-fhir-8504-overlap-pr-8521"]
	if hard.Kind != KindOverlap || hard.Actor != "rasmus0201" || !hard.OccurredAt.Equal(t0.Add(-time.Hour)) {
		t.Errorf("what happened outranks the soft match: %+v", got)
	}
	if e := byID["hg-o-soft-2-similar-pr-3"]; e.Kind != KindSimilar {
		t.Errorf("soft entry %+v", e)
	}
	if _, ok := byID["hg-corazawaf-coraza-804-watch-claimed"]; ok {
		t.Error("the watched-issue entry for the same issue is dropped")
	}
	if _, ok := byID["hg-corazawaf-coraza-804-overlap-assigned-x"]; !ok {
		t.Error("the overlap entry replaces it")
	}
	if again := WithOverlaps(nil, rows, watching); !reflect.DeepEqual(again[0].ID, got[0].ID) {
		t.Error("ids are stable")
	}
}

func TestIssueRepliesThatNeedYou(t *testing.T) {
	b := &work.Board{Login: "me", Sent: []work.Item{
		{Repo: "o/r", Number: 5, Move: work.MoveYou, Status: "@maint replied",
			Last: &work.Activity{Author: "maint", Body: "Can you share the **stack trace**?", URL: "https://github.com/o/r/issues/5#issuecomment-42", At: t0}},
		{Repo: "o/r", Number: 6, Move: work.MoveThem, Status: "@x commented after you; nothing asked of you",
			Last: &work.Activity{Author: "x", Body: "fyi", URL: "u#issuecomment-43", At: t0}},
	}}
	got := Build(b, nil, seenAt(map[string]time.Time{}, t0))
	if len(got) != 1 || got[0].ID != "hg-o-r-5-comment-42" || got[0].Kind != KindIssue || got[0].Summary != "@maint replied: Can you share the stack trace?" {
		t.Errorf("only the reply that needs you: %+v", got)
	}
	b.Sent[0].Move = work.MoveThem // you answered
	if got := Build(b, nil, seenAt(map[string]time.Time{}, t0)); len(got) != 0 {
		t.Errorf("the entry goes once you reply: %+v", got)
	}
}

// coraza#1785 as it stood on 2026-10-21: CodeRabbit's review said "Actionable comments posted: 1"
// at 19:38Z, a commit at 21:53Z addressed it, and CodeRabbit resolved its own thread.
func TestBotFindings(t *testing.T) {
	review := t0.Add(-time.Hour)
	pr := func() work.Item {
		return work.Item{PR: true, Role: work.RoleAuthor, State: "OPEN", Repo: "corazawaf/coraza", Number: 1785,
			URL: "https://github.com/corazawaf/coraza/pull/1785", LastCommitAt: tp(review.Add(2 * time.Hour)),
			BotReviews: []work.Activity{
				{Author: "codecov", Bot: true, Body: "Coverage is 81.2% (+0.1%)", At: review.Add(-time.Minute)},
				{Author: "coderabbitai", Bot: true, Review: "COMMENTED", Body: "**Actionable comments posted: 1**\n\n<details>prompt</details>", At: review,
					URL: "https://github.com/corazawaf/coraza/pull/1785#pullrequestreview-900"},
			}}
	}
	if _, ok := botEntry(pr()); ok {
		t.Error("a finding a later commit addressed (its thread resolved) is not reported")
	}

	unanswered := pr()
	unanswered.LastCommitAt = tp(review.Add(-time.Hour))
	e, ok := botEntry(unanswered)
	if !ok || e.ID != "hg-corazawaf-coraza-1785-bot-review-900" || e.Kind != KindBot || e.Actor != "coderabbitai" ||
		e.Summary != "1 open finding from @coderabbitai. Newest: @coderabbitai: 1 actionable comments posted" {
		t.Errorf("an actionable review with no commit since: %+v %v", e, ok)
	}

	open := pr()
	open.Threads = []work.Thread{
		{Author: "coderabbitai", Bot: true, Path: "internal/corazawaf/rule_multiphase.go", At: review,
			Body: "**🎯 Functional Correctness** | **🟡 Minor**\n\n**Correct the reason for the second `allow` skip.**",
			URL:  "https://github.com/corazawaf/coraza/pull/1785#discussion_r4318032150"},
		{Author: "coderabbitai", Bot: true, Outdated: true, Body: "old", URL: "u#discussion_r1"},
		{Author: "fzipi", Body: "human thread", URL: "u#discussion_r2"},
	}
	e, ok = botEntry(open)
	if !ok || e.ID != "hg-corazawaf-coraza-1785-bot-inline-4318032150" ||
		e.Summary != "1 open finding from @coderabbitai. Newest: Inline on rule_multiphase.go: Correct the reason for the second allow skip." {
		t.Errorf("an open bot thread, badge line dropped, outdated and human threads left out: %+v %v", e, ok)
	}

	again := open
	again.Threads = append([]work.Thread{{Author: "coderabbitai", Bot: true, At: review.Add(3 * time.Hour), Body: "New finding", URL: "u#discussion_r5"}}, open.Threads...)
	if e2, _ := botEntry(again); e2.ID == e.ID || !strings.HasPrefix(e2.Summary, "2 open findings") {
		t.Errorf("a re-review replaces the entry under a new id: %+v", e2)
	}

	blocked := pr()
	blocked.BotChanges = []string{"policy-bot"}
	if e, ok := botEntry(blocked); !ok || !strings.Contains(e.Summary, "@policy-bot requested changes") {
		t.Errorf("a bot's standing changes-requested review: %+v", e)
	}

	theirs := open
	theirs.Role = work.RoleInvolved
	if _, ok := botEntry(theirs); ok {
		t.Error("never a bot on someone else's pull request")
	}
}

// lakehq/sail#2821 as GitHub has it: labelled "suspicious automation" by linhr at 07:30:42Z and
// closed by him at 07:34:06Z with no comment and no review; only bots had written on it.
func TestOurPRClosedOrLabelledIsShouted(t *testing.T) {
	labelled := time.Date(2026, 10, 21, 7, 30, 42, 0, time.UTC)
	closed := time.Date(2026, 10, 21, 7, 34, 6, 0, time.UTC)
	b := &work.Board{Login: "me", Sent: []work.Item{
		{PR: true, Role: work.RoleAuthor, Repo: "lakehq/sail", Number: 2821, State: "CLOSED", ClosedAt: &closed, ClosedBy: "linhr",
			URL: "https://github.com/lakehq/sail/pull/2821", Labels: []string{"suspicious automation", "size/S"},
			LabeledBy: map[string]work.LabelEvent{"suspicious automation": {Actor: "linhr", At: labelled}}},
		{PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 5, State: "OPEN", URL: "https://github.com/o/r/pull/5",
			Labels: []string{"community", "Area: docs", "policy: needs maintainer decision"}},
		{PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 6, State: "CLOSED", ClosedAt: &closed, ClosedBy: "maint", URL: "u6",
			Last: &work.Activity{Author: "maint", Body: "Thanks, but we went another way in #7."}},
		{PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 8, State: "MERGED", MergedBy: "maint", ClosedAt: &closed, URL: "u8"},
		{PR: true, Role: work.RoleAuthor, Repo: "o/r", Number: 10, State: "CLOSED", ClosedAt: &closed, ClosedBy: "Me", URL: "u10",
			Last: &work.Activity{Author: "me", Body: "Closing in favour of #11."}},
		{PR: true, Role: work.RoleInvolved, Repo: "x/y", Number: 9, State: "OPEN", Labels: []string{"spam"}},
	}}
	got := Build(b, nil, seenAt(map[string]time.Time{}, closed.Add(time.Hour)))
	byID := map[string]Entry{}
	for _, e := range got {
		byID[e.ID] = e
	}
	c := byID["hg-lakehq-sail-2821-closed"]
	if c.Summary != "Closed without merging by @linhr, with no comment; labelled “suspicious automation”" ||
		c.Actor != "linhr" || !c.OccurredAt.Equal(closed) || c.Priority != "high" || c.Kind != KindState {
		t.Errorf("silent close: %+v", c)
	}
	l := byID["hg-lakehq-sail-2821-label-suspicious-automation"]
	if l.Kind != KindLabel || l.Summary != "Labelled “suspicious automation” by @linhr (now closed without merging)" ||
		!l.OccurredAt.Equal(labelled) || l.Priority != "high" {
		t.Errorf("unknown label: %+v", l)
	}
	if p := byID["hg-o-r-5-label-policy-needs-maintainer-decision"]; p.Summary != "Labelled “policy: needs maintainer decision”" || !p.OccurredAt.Equal(closed.Add(time.Hour)) {
		t.Errorf("a label with no event in sight keeps its first-seen time: %+v", p)
	}
	for _, id := range []string{"hg-lakehq-sail-2821-label-size-s", "hg-o-r-5-label-community", "hg-o-r-5-label-area-docs", "hg-x-y-9-label-spam"} {
		if _, ok := byID[id]; ok {
			t.Errorf("%s: benign labels and other people's pull requests are not reported", id)
		}
	}
	if c := byID["hg-o-r-6-closed"]; c.Summary != "Closed without merging by @maint: “Thanks, but we went another way in #7.”" {
		t.Errorf("a close with the closer's words: %q", c.Summary)
	}
	if c := byID["hg-o-r-10-closed"]; c.Summary != "You closed it without merging" || c.Priority != "" {
		t.Errorf("your own close is not an alarm: %+v", c)
	}
	if m := byID["hg-o-r-8-merged"]; m.Summary != "Merged by @maint" {
		t.Errorf("the first merge must not arrive silently: %+v", m)
	}
}

func TestNewIssuesOneEntryPerRepository(t *testing.T) {
	now := time.Date(2026, 10, 21, 21, 0, 0, 0, time.UTC)
	issues := []store.RecentIssue{
		{Repo: "pbakaus/impeccable", Number: 1101, Title: "[Bug] Stop deep pass is silent", Labels: []string{"needs triage"}, CreatedAt: now.Add(-4 * time.Hour)},
		{Repo: "wazuh/wazuh", Number: 40575, Assignees: []string{"nbertoldo"}, CreatedAt: now.Add(-4 * time.Hour)},
		{Repo: "golang/go", Number: 82403, Title: "cmd/go: failures", CreatedAt: now.Add(-1 * time.Hour)},
		{Repo: "golang/go", Number: 82402, Title: "Proposal: crypto/tls", CreatedAt: now.Add(-2 * time.Hour)},
		{Repo: "golang/go", Number: 82401, Title: "x/build: freebsd", CreatedAt: now.Add(-3 * time.Hour)},
		{Repo: "golang/go", Number: 82400, Title: "x/build: openbsd", CreatedAt: now.Add(-4 * time.Hour)},
		{Repo: "golang/go", Number: 82399, ClaimSignal: "comment", CreatedAt: now.Add(-time.Hour)},
		{Repo: "golang/go", Number: 82398, Labels: []string{"Question"}, CreatedAt: now.Add(-time.Hour)},
		{Repo: "golang/go", Number: 82300, CreatedAt: now.Add(-30 * time.Hour)},
		{Repo: "shadcn-ui/ui", Number: 12408, CreatedAt: now.Add(-time.Hour)},
	}
	planning := map[string]bool{"pbakaus/impeccable": true, "wazuh/wazuh": true, "golang/go": true}
	got := NewIssues(issues, planning, now)
	byID := map[string]Entry{}
	for _, e := range got {
		byID[e.ID] = e
	}
	if len(got) != 2 {
		t.Fatalf("one entry per repository with something new: %+v", got)
	}
	if e := byID["hg-pbakaus-impeccable-new-issues-1101"]; e.Kind != KindNewIssue || e.Number != 1101 ||
		e.Summary != "1 new unassigned issue in the last day: #1101 [Bug] Stop deep pass is silent" {
		t.Errorf("impeccable: %+v", e)
	}
	if e := byID["hg-golang-go-new-issues-82403"]; e.Summary != "4 new unassigned issues in the last day: #82403 cmd/go: failures; #82402 Proposal: crypto/tls; #82401 x/build: freebsd; and 1 more" {
		t.Errorf("golang: %q", e.Summary)
	}
}
