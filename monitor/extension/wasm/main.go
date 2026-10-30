//go:build js && wasm

// Command wasm exposes the work board classifier to the browser extension. The extension sends
// the GraphQL requests itself; this builds them and turns the responses into the board, with
// the same sentences the dashboard shows.
//
// The board draws from eight searches. They used to ride in one request and share one resource
// budget, which tipped over on a well-stocked board and nulled nested fields such as the check
// status. Each search now goes in its own request. requests() returns the eight sub-requests;
// boardMulti() takes the eight bodies and assembles the board.
//
// It sets globalThis.hellogitty with these functions, each taking and returning JSON strings:
//
//	requests({login, maintain, finishedDays, now})   -> {requests: [{name, query, variables}, ...], scope}
//	boardMulti({login, maintain, scope, now}, bodies) -> {board, error}
//
// where bodies is a JSON array of {name, body} with one entry per sub-request. The pre-split
// contract (request / board) is still exported for compatibility.
package main

import (
	"encoding/json"
	"strconv"
	"strings"
	"syscall/js"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/help"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

type args struct {
	Login        string   `json:"login"`
	Maintain     []string `json:"maintain"`
	Scope        string   `json:"scope"`
	FinishedDays int      `json:"finishedDays"`
	Now          string   `json:"now"`
}

func (a args) now() time.Time {
	if t, err := time.Parse(time.RFC3339, a.Now); err == nil {
		return t.UTC()
	}
	return time.Now().UTC()
}

type note struct {
	Text  string `json:"text"`
	Level string `json:"level,omitempty"`
	Term  string `json:"term,omitempty"` // the glossary entry hover help shows for it
}

type row struct {
	Kind     string   `json:"kind"`
	Repo     string   `json:"repo"`
	Number   int      `json:"number"`
	Title    string   `json:"title"`
	URL      string   `json:"url"`
	Author   string   `json:"author"`
	Why      string   `json:"why,omitempty"`
	Status   string   `json:"status"`
	Level    string   `json:"level,omitempty"`
	Personal string   `json:"personal,omitempty"`
	Notes    []note   `json:"notes,omitempty"`
	Labels   []string `json:"labels,omitempty"`
	Since    string   `json:"since"`
	Incoming bool     `json:"incoming,omitempty"`
	Quote    string   `json:"quote,omitempty"`
	QuoteBy  string   `json:"quoteBy,omitempty"`
	QuoteURL string   `json:"quoteURL,omitempty"`
	// Peek is the hover card for the row title, with only what is known.
	Peek *help.Peek `json:"peek,omitempty"`
}

type view struct {
	Login     string `json:"login"`
	Scope     string `json:"scope"`
	FetchedAt string `json:"fetchedAt"`
	Cost      int    `json:"cost"`
	Remaining int    `json:"remaining"`
	You       []row  `json:"you"`
	Them      []row  `json:"them"`
	Done      []row  `json:"done"`
	// UnresolvedPRs names the user's open PRs that have unresolved review threads,
	// as "repo#number" strings for the alert cell.
	UnresolvedPRs []string `json:"unresolvedPRs"`
	// Glossary is the hover help text, the same as the dashboard's.
	Glossary map[string]help.Term `json:"glossary"`
}

func main() {
	js.Global().Set("hellogitty", js.ValueOf(map[string]any{
		"request":    js.FuncOf(request),
		"board":      js.FuncOf(board),
		"requests":   js.FuncOf(requests),
		"boardMulti": js.FuncOf(boardMulti),
	}))
	select {}
}

func reply(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		b, _ = json.Marshal(map[string]string{"error": err.Error()})
	}
	return string(b)
}

func parse(v []js.Value) (args, error) {
	var a args
	if len(v) == 0 {
		return a, nil
	}
	err := json.Unmarshal([]byte(v[0].String()), &a)
	return a, err
}

func request(_ js.Value, v []js.Value) any {
	a, err := parse(v)
	if err != nil {
		return reply(map[string]string{"error": err.Error()})
	}
	days := a.FinishedDays
	if days <= 0 {
		days = 30
	}
	q, vars, scope := work.Request(a.Login, a.Maintain, a.now().AddDate(0, 0, -days))
	return reply(map[string]any{"query": q, "variables": vars, "scope": scope})
}

func board(_ js.Value, v []js.Value) any {
	a, err := parse(v)
	if err != nil || len(v) < 2 {
		return reply(map[string]string{"error": "board: want arguments and a response body"})
	}
	b, err := work.Decode([]byte(v[1].String()), a.Login, a.Maintain, a.Scope, a.now())
	out := map[string]any{}
	if err != nil {
		out["error"] = err.Error()
	}
	if b != nil {
		out["board"] = toView(b)
	}
	return reply(out)
}

func requests(_ js.Value, v []js.Value) any {
	a, err := parse(v)
	if err != nil {
		return reply(map[string]string{"error": err.Error()})
	}
	days := a.FinishedDays
	if days <= 0 {
		days = 30
	}
	reqs, scope := work.Requests(a.Login, a.Maintain, a.now().AddDate(0, 0, -days))
	return reply(map[string]any{"requests": reqs, "scope": scope})
}

// bodies is a JSON array of {"name": ..., "body": "..."} entries where body is the raw response
// text. Keeping it as a string per entry avoids re-encoding each body through JSON twice.
type namedBody struct {
	Name string `json:"name"`
	Body string `json:"body"`
}

func boardMulti(_ js.Value, v []js.Value) any {
	a, err := parse(v)
	if err != nil || len(v) < 2 {
		return reply(map[string]string{"error": "boardMulti: want arguments and sub-response bodies"})
	}
	var raw []namedBody
	if err := json.Unmarshal([]byte(v[1].String()), &raw); err != nil {
		return reply(map[string]string{"error": "boardMulti: " + err.Error()})
	}
	bodies := make([]work.SubResponse, 0, len(raw))
	for _, r := range raw {
		bodies = append(bodies, work.SubResponse{Name: r.Name, Body: []byte(r.Body)})
	}
	b, err := work.DecodeMulti(bodies, a.Login, a.Maintain, a.Scope, a.now())
	out := map[string]any{}
	if err != nil {
		out["error"] = err.Error()
	}
	if b != nil {
		out["board"] = toView(b)
	}
	return reply(out)
}

func toView(b *work.Board) view {
	v := view{Login: b.Login, Scope: b.Scope, FetchedAt: b.FetchedAt.Format(time.RFC3339),
		Cost: b.Cost, Remaining: b.Remaining, You: []row{}, Them: []row{}, Done: []row{}, Glossary: help.Glossary()}
	for _, list := range [][]work.Item{b.Sent, b.Incoming} {
		for _, it := range list {
			r := toRow(it, b.Login, b.FetchedAt)
			switch it.Move {
			case work.MoveYou:
				v.You = append(v.You, r)
			case work.MoveThem:
				v.Them = append(v.Them, r)
			default:
				v.Done = append(v.Done, r)
			}
		}
	}
	for _, it := range b.Sent {
		if !it.PR || it.State != "OPEN" {
			continue
		}
		var open int
		for _, t := range it.Threads {
			if !t.RepliedLast {
				open++
			}
		}
		if open > 0 {
			parts := strings.SplitN(it.Repo, "/", 2)
			name := it.Repo
			if len(parts) == 2 {
				name = parts[1]
			}
			v.UnresolvedPRs = append(v.UnresolvedPRs, name+"#"+strconv.Itoa(it.Number))
		}
	}
	return v
}

// toRow, why and noteLevel follow internal/dashboard/work.go, which the extension cannot import
// without pulling in the store; the text helpers come from internal/help, as the dashboard's do.
func toRow(it work.Item, login string, now time.Time) row {
	r := row{Kind: "Issue", Repo: it.Repo, Number: it.Number, Title: it.Title, URL: it.URL, Author: it.Author,
		Why: why(it), Status: it.Status, Level: it.Level, Personal: it.Personal, Labels: it.Labels,
		Since:    it.Since.UTC().Format(time.RFC3339),
		Incoming: it.Role == work.RoleReviewer || it.Role == work.RoleMaintains}
	if it.PR {
		r.Kind = "PR"
	}
	for _, n := range it.Notes {
		r.Notes = append(r.Notes, note{Text: n, Level: noteLevel(n), Term: help.NoteTerm(n)})
	}
	l := it.Quote
	if l == nil {
		l = it.Last
	}
	if l != nil && !strings.EqualFold(l.Author, login) {
		if q := help.Excerpt(l.Body, quoteChars); q != "" {
			r.Quote, r.QuoteBy, r.QuoteURL = q, "@"+l.Author, l.URL
		}
	}
	if p := help.WorkPeek(it, login, now); len(p.Lines) > 0 {
		r.Peek = &p
	}
	return r
}

const quoteChars = 220

func why(it work.Item) string {
	switch it.Role {
	case work.RoleAuthor:
		return "You opened it"
	case work.RoleAssigned:
		return "Assigned to you"
	case work.RoleInvolved:
		return "You joined the thread"
	case work.RoleReviewer:
		return "From @" + it.Author + ", you're a reviewer"
	case work.RoleMaintains:
		return "From @" + it.Author
	}
	return ""
}

func noteLevel(n string) string {
	switch {
	case n == "Checks failing", n == "Merge conflict", strings.HasPrefix(n, "Failing: "),
		strings.HasPrefix(n, "Behind "), strings.Contains(n, "unresolved thread"):
		return "caution"
	case n == "Checks passed":
		return "ok"
	}
	return ""
}
