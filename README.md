# agent-classroom

Browser-based observer for Claude Code sessions.

Watch multiple Claude Code sessions running in parallel as a **school** in your browser — each running session is a **classroom**, and the agents inside it (main + Task tool sub-agents) are **students**. Four Claude Code sessions running simultaneously? Four classrooms visible at a glance.

## Status

Early design / pre-alpha. Nothing to install yet.

## Concept

```
校舎 (schoolhouse)  =  the observer process (persistent, always on)
教室 (classroom)    =  one Claude Code session (= one tmux pane / one VibePod container)
生徒 (student)      =  an agent inside that session (main agent + Task-tool sub-agents)
```

The building (observer) and the classrooms (slots) persist. The teams (sessions) form, enter an empty classroom, do their work, and leave. The asymmetry between *ephemeral sessions* and *persistent observation* is the design core.

## Roadmap

- **Phase 1** — Observe a single plain Claude Code session (running on the host, in any terminal) from the browser. Nail down the observation contract (JSONL paths, state inference, event protocol).
- **Phase 2** — Extend observation to [VibePod](https://github.com/ryugou/vibepod) containers.
- **Phase 3** — Design the classroom abstraction based on what Phase 1 and 2 actually need (not speculation).
- **Phase 4** — Full implementation: multi-session dynamic slotting, classroom visualization, team check-in/out.

## Acknowledgements

Inspired by [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) (MIT). The JSONL-transcript-watching approach to Claude Code agent observation originates from that project. `agent-classroom` is an independent reimplementation with a different scope (standalone browser, multi-session, school/classroom metaphor) and does not reuse any of its source code or art assets.

## License

MIT
