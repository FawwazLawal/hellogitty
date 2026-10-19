package pipeline

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

const sample = `{
  "stages": ["triage", {"name": "build", "abbr": "bld"}, "review"],
  "labels": {"status": "CHECK"},
  "repos": {
    "Owner/Name": {"stage": "build", "done": ["triage"], "label": "PASS", "level": "ok", "notes": "/tmp/n.md"},
    "x/broken":   {"stage": "review", "done": ["triage", "build"], "failed": ["review"], "level": "caution"}
  }
}`

func TestParse(t *testing.T) {
	st, err := Parse([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	if got := []Stage{{"triage", "TRI"}, {"build", "BLD"}, {"review", "REV"}}; !reflect.DeepEqual(st.Stages, got) {
		t.Errorf("stages %v", st.Stages)
	}
	if st.Labels.Status != "CHECK" || st.Labels.Flagged != "Repo flagged" || st.Labels.Notes != "Notes" {
		t.Errorf("labels %+v", st.Labels)
	}
	r, ok := st.Repo("owner", "NAME")
	if !ok || r.Notes != "/tmp/n.md" {
		t.Fatalf("case-insensitive lookup failed: %+v %v", r, ok)
	}
	if got := st.Phases(r); !reflect.DeepEqual(got, []StageState{Done, Current, Todo}) {
		t.Errorf("phases %v", got)
	}
	b, _ := st.Repo("x", "broken")
	if got := st.Phases(b); !reflect.DeepEqual(got, []StageState{Done, Done, Failed}) {
		t.Errorf("failed phases %v", got)
	}
	for _, bad := range []string{`{}`, `{"stages":[]}`, `not json`, `{"stages":["a"],"repos":{"o/n":{"stage":"zzz"}}}`} {
		if _, err := Parse([]byte(bad)); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func TestNilProviderMeansNotConfigured(t *testing.T) {
	var p *Provider
	if st, err := p.Get(context.Background()); st != nil || err != nil {
		t.Errorf("nil provider: %v %v", st, err)
	}
	if st, err := (&Provider{}).Get(context.Background()); st != nil || err != nil {
		t.Errorf("empty command: %v %v", st, err)
	}
}

func TestProviderRunsCachesAndKeepsLastGood(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "out.json")
	os.WriteFile(out, []byte(sample), 0o644)
	p := &Provider{Command: []string{"cat", "out.json"}, Dir: dir, TTL: time.Hour}
	st, err := p.Get(context.Background())
	if err != nil || st.Len() != 2 {
		t.Fatalf("first run: %v %v", st, err)
	}
	os.WriteFile(out, []byte("garbage"), 0o644)
	if st2, _ := p.Get(context.Background()); st2 != st {
		t.Error("within TTL the cached state should be returned")
	}
	p.TTL = time.Nanosecond
	time.Sleep(time.Millisecond)
	st3, err := p.Get(context.Background())
	if err == nil || st3 != st {
		t.Errorf("a failed run should return the last good state with the error: %v %v", st3, err)
	}
	fail := &Provider{Command: []string{"sh", "-c", "echo boom >&2; exit 3"}, Dir: dir}
	if _, err := fail.Get(context.Background()); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Errorf("stderr should be in the error: %v", err)
	}
}
