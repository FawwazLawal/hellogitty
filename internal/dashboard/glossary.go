package dashboard

import (
	"encoding/json"
	"github.com/FawwazLawal/hellogitty/internal/help"
	"html/template"

	"github.com/FawwazLawal/hellogitty/internal/pipeline"
)

// The terms themselves live in internal/help, shared with the extension.
type Term = help.Term

var glossary = help.Glossary()

func noteTerm(text string) string { return help.NoteTerm(text) }

// pipelineOnly names the terms for things the page shows only with a pipeline command.
var pipelineOnly = map[string]bool{"cell-repo-flagged": true, "cell-stage-failed": true, "stage-done": true, "stage-current": true, "stage-failed": true}

// terms merges the built-in glossary with the pipeline command's words. Without a pipeline its
// terms are left out; with one, its cells keep the names the command gave them.
func terms(st *pipeline.State) map[string]Term {
	out := make(map[string]Term, len(glossary))
	for k, v := range glossary {
		if st == nil && pipelineOnly[k] {
			continue
		}
		out[k] = v
	}
	if st != nil {
		for id, label := range map[string]string{"cell-repo-flagged": st.Labels.Flagged, "cell-stage-failed": st.Labels.Failed} {
			t := out[id]
			t.Label = label
			out[id] = t
		}
		for word, means := range st.Glossary {
			out["p:"+word] = Term{Label: word, Means: means}
		}
	}
	return out
}

// glossaryJSON is the glossary as the page reads it. encoding/json escapes <, > and &, so the
// text is safe inside a script element.
func glossaryJSON(t map[string]Term) template.JS {
	b, _ := json.Marshal(t)
	return template.JS(b)
}
