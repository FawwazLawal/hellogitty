package main

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/FawwazLawal/hellogitty/internal/config"
	"github.com/FawwazLawal/hellogitty/internal/store"
)

func TestUnwatchReportsRemovedAndUnknown(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "w.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	id, _ := st.UpsertRepo("Owner", "Repo", "https://github.com/Owner/Repo")
	st.AddWatch(id, 12)

	var out strings.Builder
	if err := unwatch(st, config.Repo{Owner: "owner", Name: "repo"}, []int{12, 13}, &out); err != nil {
		t.Fatal(err)
	}
	want := "stopped watching Owner/Repo#12\nnot watching Owner/Repo#13, nothing to remove\n"
	if out.String() != want {
		t.Errorf("output\n got  %q\n want %q", out.String(), want)
	}
	if w, _ := st.WatchList(id); len(w) != 0 {
		t.Errorf("watch list should be empty: %+v", w)
	}

	out.Reset()
	if err := unwatch(st, config.Repo{Owner: "never", Name: "seen"}, []int{1}, &out); err != nil {
		t.Fatalf("unknown repository must not be an error: %v", err)
	}
	if !strings.HasPrefix(out.String(), "not watching never/seen#1") {
		t.Errorf("unknown repository output: %q", out.String())
	}
}

func TestIssueNumbers(t *testing.T) {
	got, err := issueNumbers([]string{"12", "#34"})
	if err != nil || !reflect.DeepEqual(got, []int{12, 34}) {
		t.Errorf("got %v %v, want [12 34]", got, err)
	}
	for _, bad := range []string{"0", "-3", "abc", "#"} {
		if _, err := issueNumbers([]string{"5", bad}); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
}
