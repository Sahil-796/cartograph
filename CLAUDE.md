# Cartograph

Cartograph turns a repo into a graph (files, symbols, commits, authors + the relationships between them), stores it in CognoDB, and exposes a fixed set of query "tools." The product builds the map and the roads; any AI model does the driving by calling those tools. Phase 1 doesn't build any of the product yet — it builds the foundation: config, the DB connection, and an empty app shell.

The plan files is plan.html in the root of the repo
A grill-me was run for clarifications and locked decisions are written in there respect them.

We drive by phases of work and document what was shipped after each phase fanout finishes to document the journey to avoid any kind of handoff mishaps.