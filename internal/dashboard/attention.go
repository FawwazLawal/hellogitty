package dashboard

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/FawwazLawal/hellogitty/internal/notify"
	"github.com/FawwazLawal/hellogitty/internal/work"
)

// NotificationSource is optional: a Source that also has GitHub notifications gets the
// new-activity dots.
type NotificationSource interface {
	Notifications() notify.View
}

// otherShown caps the notifications that match no row.
const otherShown = 12

// attn is what is new on one row: the time of the newest unread notification and what it says.
type attn struct {
	New  int64  `json:"new"`
	What string `json:"what"`
}

// otherRow is a notification that matches no row on the board: a CI run on a branch with no open
// pull request, a mention on someone else's pull request, a release.
type otherRow struct {
	Key      string
	Title    string
	URL      string
	Repo     string
	Number   int
	Words    string
	Ago      string
	AgoTitle string
	New      int64 // unix time when unread, else 0
	Attn     string
	Move     string // "you" when it asks something of you, for the "Needs me only" filter
}

type attention struct {
	Rows  map[string]attn // by row key, "owner/name#123"
	Other []otherRow
}

// matchNotifications sorts the notifications onto the board's rows: issues and pull requests by
// number, CI runs by your pull request's branch. What matches no row is "other"; of those, only
// unread threads and read ones that still ask something of you are kept.
func matchNotifications(b *work.Board, items []notify.Item, now time.Time) attention {
	a := attention{Rows: map[string]attn{}}
	rows, branches := map[string]bool{}, map[string]string{}
	if b != nil {
		for _, list := range [][]work.Item{b.Sent, b.Incoming} {
			for _, it := range list {
				k := rowKey(it.Repo, it.Number)
				rows[k] = true
				if it.PR && it.Role == work.RoleAuthor && it.Head != "" {
					branches[strings.ToLower(it.Repo)+"@"+it.Head] = k
				}
			}
		}
	}
	items = append([]notify.Item(nil), items...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	repeats := map[string]bool{}
	for _, n := range items {
		k := n.Key()
		if k == "" && n.Kind == "CheckSuite" && n.Branch != "" {
			k = branches[strings.ToLower(n.Repo)+"@"+n.Branch]
		}
		if rows[k] {
			if n.Unread && n.UpdatedAt.Unix() > a.Rows[k].New {
				a.Rows[k] = attn{New: n.UpdatedAt.Unix(), What: n.Words()}
			}
			continue
		}
		if !n.Unread && !n.Action() {
			continue // read and nothing asked: acknowledged
		}
		// The same workflow failing again on the same branch is one row, the newest.
		if r := n.Repo + "|" + n.Kind + "|" + n.Words() + "|" + n.Branch; n.Kind == "CheckSuite" {
			if repeats[r] {
				continue
			}
			repeats[r] = true
		}
		o := otherRow{Key: "n:" + n.ID, Title: n.Title, URL: n.URL, Repo: n.Repo, Number: n.Number, Words: n.Words(),
			Ago: ago(now, n.UpdatedAt), AgoTitle: n.UpdatedAt.UTC().Format("2006-01-02 15:04Z")}
		o.Move = work.MoveThem
		if n.Action() {
			o.Move = work.MoveYou
		}
		if n.Unread {
			o.New, o.Attn = n.UpdatedAt.Unix(), "new"
		} else {
			o.Attn = "caution"
		}
		a.Other = append(a.Other, o)
	}
	sort.SliceStable(a.Other, func(i, j int) bool {
		if (a.Other[i].New > 0) != (a.Other[j].New > 0) {
			return a.Other[i].New > 0
		}
		return a.Other[i].AgoTitle > a.Other[j].AgoTitle
	})
	if len(a.Other) > otherShown {
		a.Other = a.Other[:otherShown]
	}
	return a
}

func rowKey(repo string, n int) string {
	return strings.ToLower(repo) + "#" + strconv.Itoa(n)
}

// applyAttention sets each row's dot: green when something on it is unread, amber when it is your
// move, hollow otherwise.
func applyAttention(v *workView, nv notify.View, a attention) {
	v.NotifyState, v.NotifyNote = nv.State, nv.Note
	v.Other = a.Other
	for _, list := range []*[]workRow{&v.You, &v.Them, &v.Done, &v.InYou, &v.InThem} {
		for i := range *list {
			r := &(*list)[i]
			if n, ok := a.Rows[r.K]; ok && nv.State == "ok" {
				r.New, r.NewWhat, r.Attn = n.New, n.What, "new"
			}
		}
	}
}

// serveAttention answers the page's once-a-minute check, so a dot turns from green as soon as the
// thread is read on GitHub, without waiting for the five-minute reload.
func (h *Handler) serveAttention(w http.ResponseWriter, r *http.Request) {
	out := struct {
		State string          `json:"state"`
		Rows  map[string]attn `json:"rows"`
		Other map[string]attn `json:"other"`
	}{Rows: map[string]attn{}, Other: map[string]attn{}}
	if ns, ok := h.Source.(NotificationSource); ok {
		nv := ns.Notifications()
		out.State = nv.State
		if nv.State == "ok" {
			board, _ := h.Source.Work()
			a := matchNotifications(board, nv.Items, time.Now())
			out.Rows = a.Rows
			for _, o := range a.Other {
				out.Other[o.Key] = attn{New: o.New, What: o.Words}
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(out)
}
