import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./docs.css";

/**
 * The `/docs` route: a plain-language guide written for a non-technical user.
 * Two parts — how to explore a codebase map in the browser, and how to let an
 * AI assistant read the same map over MCP. No terminal commands except the one
 * the MCP connection genuinely needs.
 */

const TOC: { id: string; label: string; part: 1 | 2 }[] = [
  { id: "start", label: "Pick a codebase", part: 1 },
  { id: "map", label: "Move around the map", part: 1 },
  { id: "colours", label: "What the colours mean", part: 1 },
  { id: "panel", label: "Read the details", part: 1 },
  { id: "people", label: "See who does what", part: 1 },
  { id: "chat", label: "Just ask", part: 1 },
  { id: "mcp-what", label: "What MCP is", part: 2 },
  { id: "mcp-setup", label: "What you need", part: 2 },
  { id: "mcp-connect", label: "Connect an assistant", part: 2 },
  { id: "mcp-verify", label: "Check it works", part: 2 },
  { id: "mcp-prompts", label: "What to ask", part: 2 },
];

// Hosted MCP: the deployed API exposes a Streamable HTTP MCP endpoint, so an
// assistant can connect to the shared graph with one command — nothing to clone
// or run locally.
const MCP_URL = `https://cartograph-api.greenocean-3c22b32a.centralindia.azurecontainerapps.io/api/mcp`;

const MCP_HTTP_COMMAND = `claude mcp add --transport http cartograph ${MCP_URL}`;

// Local alternative: run the stdio MCP server yourself from a clone of the repo.
const MCP_COMMAND = `claude mcp add cartograph -- pnpm --filter @cartograph/mcp run start`;

const MCP_START = `pnpm --filter @cartograph/mcp run start`;

const MCP_SETUP: string[] = [
  "An AI assistant that supports MCP — this guide uses Claude Code.",
  "That's it — the map is hosted, so you don't need to install or run anything.",
];

const MODES: { name: string; description: string }[] = [
  { name: "Owner", description: "Who works on each file, most recently." },
  { name: "Recency", description: "How recently each file was last touched." },
  { name: "Bus factor", description: "Whether one person alone holds all the knowledge of a file." },
  { name: "Coverage", description: "Whether a file has tests that import it." },
  { name: "Directory", description: "Which folder each file lives in." },
];

const PROMPTS: string[] = [
  "Who owns src/router in hono?",
  "Which files change together most often in papermark?",
  "Are there any import loops in drizzle-orm?",
  "What's the shortest call path between two functions I care about?",
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`doc-code__copy${copied ? " is-copied" : ""}`}
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="doc-code">
      <div className="doc-code__bar">
        <span className="doc-code__label">{label}</span>
        <CopyButton text={text} />
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export default function Docs() {
  const [active, setActive] = useState("start");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const item of TOC) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="docs">
      <header className="landing-nav">
        <Link to="/" className="landing-nav__brand">
          <span className="landing-nav__mark" aria-hidden="true">◆</span>
          <span>Cartograph</span>
        </Link>
        <span className="landing-nav__status"><i /> Documentation</span>
      </header>

      <section className="docs-hero">
        <p className="picker__eyebrow">Documentation</p>
        <h1 className="docs-hero__title">
          No jargon,<br />
          <em>just answers.</em>
        </h1>
        <p className="docs-hero__lede">
          Two short guides: how to explore a codebase map in your browser, and
          how to let your AI assistant read the same map for you.
        </p>
      </section>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="On this page">
          <span className="docs-toc__label">On this page</span>
          {TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`docs-toc__link${active === item.id ? " is-active" : ""}`}
            >
              <span className="docs-toc__num">0{item.part}</span>
              {item.label}
            </a>
          ))}
        </aside>

        <main className="docs-content">
          {/* ---------------- Part 1: How to use ---------------- */}
          <section className="docs-part">
            <div className="docs-part__head">
              <span className="docs-part__num">01</span>
              <h2>Using Cartograph</h2>
            </div>

            <section className="docs-subsection" id="start">
              <h3>Pick something to look at</h3>
              <p>
                On the home page, click one of the ready-made codebases to open
                its map instantly. Or paste a link to any public GitHub project —
                Cartograph builds the map while you watch, then adds it to the
                home page when it's ready.
              </p>
            </section>

            <section className="docs-subsection" id="map">
              <h3>Move around the map</h3>
              <p>
                Each dot is a <strong>file</strong>, a <strong>function</strong>,
                or a <strong>commit</strong>. The lines between them are the
                relationships — what imports what, what calls what, what changes
                together. Drag to pan, scroll to zoom, and press{" "}
                <span className="doc-kbd">F</span> to fit the whole map on screen.
                Click any dot to select it.
              </p>
            </section>

            <section className="docs-subsection" id="colours">
              <h3>What the colours mean</h3>
              <p>
                Use the buttons at the top of the map to colour the dots by
                different signals — the legend explains the exact shades:
              </p>
              <div className="doc-modes">
                {MODES.map((m) => (
                  <div key={m.name} className="doc-mode">
                    <b>{m.name}</b>
                    <span>{m.description}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="docs-subsection" id="panel">
              <h3>Read the details</h3>
              <p>
                When you select something, a panel on the right tells its story:
                who owns it, whether one person is a single point of failure,
                which other files tend to change alongside it, whether it has
                tests, and its recent history.
              </p>
            </section>

            <section className="docs-subsection" id="people">
              <h3>See who does what</h3>
              <p>
                The <b>People</b> tab shows the humans behind the code — who
                touched what, how recently, and where the project leans on a
                single person.
              </p>
            </section>

            <section className="docs-subsection" id="chat">
              <h3>Just ask</h3>
              <p>
                Open the chat and type a question in plain English —{" "}
                <em>"who owns this file?"</em>,{" "}
                <em>"which files change together?"</em>,{" "}
                <em>"are there loops in the imports?"</em> — and Cartograph
                answers from the real map, highlighting the parts it used.
              </p>
              <p className="doc-note">
                Chat needs to be switched on by whoever set up Cartograph. If it
                isn't, the panel will tell you.
              </p>
            </section>
          </section>

          {/* ---------------- Part 2: MCP guide ---------------- */}
          <section className="docs-part">
            <div className="docs-part__head">
              <span className="docs-part__num">02</span>
              <h2>The MCP guide</h2>
            </div>

            <section className="docs-subsection" id="mcp-what">
              <h3>What MCP is</h3>
              <p>
                MCP (the Model Context Protocol) is a standard way for an AI
                coding assistant to connect to outside tools. Cartograph speaks
                MCP, which means your assistant can look things up in the{" "}
                <em>exact same graph</em> you see in the browser — the same
                facts, no guessing, no making things up.
              </p>
              <p>
                Once connected, you don't switch apps. You keep working in your
                assistant, and it quietly checks the graph whenever you ask a
                question about the code.
              </p>
            </section>

            <section className="docs-subsection" id="mcp-setup">
              <h3>What you need</h3>
              <ul className="doc-list">
                {MCP_SETUP.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="doc-note">
                The assistant brings its own brain (model) — Cartograph doesn't
                need any extra API key for MCP to work.
              </p>
            </section>

            <section className="docs-subsection" id="mcp-connect">
              <h3>Connect an assistant</h3>
              <p>
                Cartograph's MCP server is <strong>hosted</strong> — it's already
                running online, so there's nothing to install. Point your
                assistant at it with a single command.
              </p>
              <div className="doc-steps">
                <div className="doc-step">
                  <span className="doc-step__num">1</span>
                  <div>
                    <p>
                      <strong>Tell Claude Code about it</strong> — one command in
                      a terminal, from anywhere:
                    </p>
                    <CodeBlock label="terminal" text={MCP_HTTP_COMMAND} />
                  </div>
                </div>
                <div className="doc-step">
                  <span className="doc-step__num">2</span>
                  <div>
                    <p>
                      <strong>Restart Claude Code</strong> (or start a new chat)
                      so it picks up the connection. That's the whole setup.
                    </p>
                  </div>
                </div>
              </div>
              <details className="doc-details">
                <summary>Prefer to run it yourself?</summary>
                <p>
                  If you've cloned the repo, you can run the MCP server locally
                  over stdio instead of using the hosted one. Start it in a
                  terminal (leave it open):
                </p>
                <CodeBlock label="terminal" text={MCP_START} />
                <p>Then register that local server with Claude Code:</p>
                <CodeBlock label="terminal" text={MCP_COMMAND} />
              </details>
            </section>

            <section className="docs-subsection" id="mcp-verify">
              <h3>Check it works</h3>
              <p>
                In your assistant, ask a question that needs the graph — try this
                one first:
              </p>
              <div className="doc-quote">
                <span className="doc-kbd">you</span> Who owns src/router in hono?
              </div>
              <p>
                If the connection worked, the assistant will look it up in the
                graph and answer with the real owners. If it says it has no
                tools, go back to step 2 and restart your assistant.
              </p>
            </section>

            <section className="docs-subsection" id="mcp-prompts">
              <h3>What to ask</h3>
              <ul className="doc-list doc-list--prompts">
                {PROMPTS.map((prompt) => (
                  <li key={prompt}><span className="doc-kbd">you</span> {prompt}</li>
                ))}
              </ul>
              <p>
                The assistant only answers from the map. If it can't find
                something, it will tell you honestly — it never makes things up.
              </p>
            </section>
          </section>

          <footer className="docs-cta">
            <p className="picker__eyebrow">Ready when you are</p>
            <Link to="/" className="docs-cta__link">
              Open a codebase <b>→</b>
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}