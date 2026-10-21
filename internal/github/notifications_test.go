package github

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMarkThreadRead(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Method + " " + r.URL.Path
		w.WriteHeader(http.StatusResetContent) // what GitHub answers
	}))
	defer srv.Close()
	c := New("t")
	c.BaseURL = srv.URL
	if err := c.MarkThreadRead(context.Background(), "26516245455"); err != nil {
		t.Fatal(err)
	}
	if got != "PATCH /notifications/threads/26516245455" {
		t.Errorf("request %q", got)
	}
	if err := c.MarkThreadRead(context.Background(), "../user"); err == nil {
		t.Error("only a numeric thread id is ever sent")
	}
}
