/* Ask anything — the studio's chat assistant. Beta, and read-only.

   The assistant answers by looking things up: the bridge runs a short loop of
   read-only tool calls over the agents' own records until it can answer. This
   page sends the question and shows the result, including which lookups the
   answer was based on, so nobody has to take a figure on trust.

   Conversations live in three places, deliberately.

   The bridge database is the record: it survives a browser, a device and a
   restart, and it is what the history list reads. localStorage is a cache, so
   reopening the page restores the last thread instantly instead of flashing an
   empty screen while the fetch lands. sessionStorage holds only which thread
   this tab had open, so two tabs can sit in different conversations without
   fighting over one key.

   Every storage read is wrapped: a browser with site data blocked must lose
   the convenience, not the page. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp, ChatCircleDots, ClockCounterClockwise, FileText, MagnifyingGlass,
  NotePencil, Sparkle, WarningCircle,
} from "@phosphor-icons/react";
import {
  LiveApiError, liveApi,
  type AskConversationSummary, type AskReference, type AskToolCall, type AskTurn,
} from "../live";
import { campaignCost, personById, slaInfo, useStore } from "../store";
import { useNav, type NavTarget } from "../nav";
import { Chip, MicButton } from "../ui";
import type { AppState, PageKey, Person } from "../types";

const SUGGESTIONS = [
  "What is waiting on me?",
  "Which campaigns are closest to sign-off?",
  "What did the quality gate flag?",
  "What has each campaign cost so far?",
];

const PAGE_KEYS: Record<string, true> = {
  home: true, campaigns: true, agents: true, approvals: true, library: true,
  insights: true, activity: true, users: true, intake: true, rollout: true,
  live: true, ask: true,
};

/* ------------------------------------------------------------ local cache */

const CACHE_KEY = "shiftai.ask.cache.v1";
const ACTIVE_KEY = "shiftai.ask.active.v1";

type Cache = { conversationId: string | null; turns: AskTurn[] };

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null; // private window, blocked site data, or corrupt JSON
  }
}

function writeCache(cache: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage unavailable or full; the bridge still has the record */ }
}

function readActive(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActive(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(ACTIVE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch { /* as above */ }
}

/* ------------------------------------------------------------- references */

/* A reference the assistant cited, mapped to somewhere the studio can go. An
   id the studio does not recognise renders as plain text rather than a dead
   link, because a confident-looking link to nowhere is worse than no link. */
function targetFor(reference: AskReference, state: AppState): PageKey | NavTarget | null {
  switch (reference.kind) {
    case "campaign": {
      const byId = state.campaigns.find((c) => c.id === reference.id);
      // The assistant reads agent-side records, so it cites cmp_… ids; the
      // studio keys campaigns on its own id and mirrors the agent one.
      const mirrored = state.campaigns.find((c) => c.liveCampaignId === reference.id);
      const found = byId ?? mirrored;
      return found ? { page: "campaigns", campaignId: found.id } : null;
    }
    case "task":
      return state.tasks.some((t) => t.id === reference.id)
        ? { page: "approvals", taskId: reference.id }
        : null;
    case "screen":
      return reference.id in PAGE_KEYS ? (reference.id as PageKey) : null;
    default:
      return null;
  }
}

/* Who is asking. The assistant looks the rest up itself; this is only so it
   can say "waiting on you" and mean the right person. */
function buildViewer(state: AppState, viewer: Person, now: number) {
  const mine = state.tasks.filter((t) => t.status === "open" && t.assigneeId === viewer.id);
  return {
    id: viewer.id,
    name: viewer.name,
    role: viewer.role,
    email: viewer.email,
    open_task_count: mine.length,
    open_tasks: mine.map((t) => ({
      id: t.id,
      title: t.title,
      campaign: state.campaigns.find((c) => c.id === t.campaignId)?.name,
      sla: slaInfo(t, now).remaining,
    })),
    // Studio-side figures the assistant would otherwise have to recompute.
    campaign_costs_usd: state.campaigns.map((c) => ({
      name: c.name,
      live_campaign_id: c.liveCampaignId ?? null,
      cost_usd: Number(campaignCost(state, c.id).toFixed(4)),
      owner: personById(state, c.ownerId)?.name,
    })),
  };
}

function ToolTrace({ calls }: { calls: AskToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <details className="ask-trace">
      <summary>
        <MagnifyingGlass size={12} />
        {calls.length === 1 ? "1 lookup" : `${calls.length} lookups`}
      </summary>
      <ul>
        {calls.map((call, i) => (
          <li key={i} className={call.ok ? "" : "failed"}>
            <code>{call.name}</code>
            {Object.keys(call.args).length > 0 && (
              <small>{Object.values(call.args).join(", ")}</small>
            )}
            {call.error && <em>{call.error}</em>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function AskScreen() {
  const { state, viewer, now } = useStore();
  const { go } = useNav();

  const cached = useRef<Cache | null>(readCache()).current;
  const [turns, setTurns] = useState<AskTurn[]>(cached?.turns ?? []);
  const [conversationId, setConversationId] = useState<string | null>(
    readActive() ?? cached?.conversationId ?? null,
  );
  const [history, setHistory] = useState<AskConversationSummary[]>([]);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [offline, setOffline] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const { conversations } = await liveApi.askConversations(viewer.email);
      setHistory(conversations);
      setOffline(false);
    } catch {
      setOffline(true); // the bridge is down; the cached thread still renders
    }
  }, [viewer.email]);

  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  useEffect(() => {
    writeCache({ conversationId, turns });
    writeActive(conversationId);
  }, [conversationId, turns]);

  function startNew() {
    setTurns([]);
    setConversationId(null);
    setQuestion("");
    inputRef.current?.focus();
  }

  async function openConversation(id: string) {
    if (id === conversationId) return;
    try {
      const loaded = await liveApi.askConversation(id);
      setTurns(loaded.turns);
      setConversationId(loaded.conversation_id);
    } catch (e) {
      setTurns([
        {
          role: "assistant", text: `I could not reopen that conversation: ${
            e instanceof Error ? e.message : String(e)
          }`,
          at: "", references: [], tool_calls: [], suggested_screen: null,
          grounded: false, cost_usd: null, model: null,
        },
      ]);
    }
  }

  async function send(text: string) {
    const asked = text.trim();
    if (!asked || thinking) return;
    const youTurn: AskTurn = {
      role: "you", text: asked, at: new Date().toISOString(),
      references: [], tool_calls: [], suggested_screen: null,
      grounded: true, cost_usd: null, model: null,
    };
    setTurns((t) => [...t, youTurn]);
    setQuestion("");
    setThinking(true);
    try {
      const answer = await liveApi.ask(
        asked, buildViewer(state, viewer, now), viewer.email, conversationId,
      );
      setConversationId(answer.conversation_id);
      setTurns((t) => [
        ...t,
        {
          role: "assistant", text: answer.answer, at: new Date().toISOString(),
          references: answer.references, tool_calls: answer.tool_calls,
          suggested_screen: answer.suggested_screen, grounded: answer.grounded,
          cost_usd: answer.cost_usd, model: answer.model,
        },
      ]);
      void refreshHistory();
    } catch (e) {
      // An offline bridge is the common case in local dev, so say that plainly
      // rather than showing a marketer a stack trace.
      const unreachable = !(e instanceof LiveApiError);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: unreachable
            ? "I cannot reach the agent service right now, so I have nothing to answer from. If you are running locally, check the bridge is up."
            : `The assistant refused that one: ${e instanceof Error ? e.message : String(e)}`,
          at: new Date().toISOString(), references: [], tool_calls: [],
          suggested_screen: null, grounded: false, cost_usd: null, model: null,
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  const references = turns
    .flatMap((t) => t.references)
    .filter((r, i, all) => all.findIndex((o) => o.id === r.id) === i);
  const spend = turns.reduce((total, t) => total + (t.cost_usd ?? 0), 0);

  return (
    <div className="screen-content ask-screen">
      <section className="simple-page-header">
        <div>
          <h1>Ask anything <Chip tone="blue">Beta</Chip></h1>
          <p>
            Questions about this workspace, answered by looking them up in the
            agents' own records. It reads and explains; it does not decide.
            Decisions still happen at the gates.
          </p>
        </div>
        <button className="secondary-button" onClick={startNew}>
          <NotePencil size={14} /> New chat
        </button>
      </section>

      <div className="ask-layout">
        <aside className="ask-history" aria-label="Previous conversations">
          <p className="meta-label"><ClockCounterClockwise size={12} /> History</p>
          {offline && <p className="ask-empty">Bridge unreachable, so earlier chats are not listed.</p>}
          {!offline && history.length === 0 && (
            <p className="ask-empty">Your conversations will be listed here.</p>
          )}
          {history.map((row) => (
            <button
              key={row.conversation_id}
              className={`ask-history-row${row.conversation_id === conversationId ? " active" : ""}`}
              onClick={() => void openConversation(row.conversation_id)}
            >
              <strong>{row.title}</strong>
              <small>{row.turns} messages</small>
            </button>
          ))}
        </aside>

        <section className="ask-main" aria-label="Conversation">
          <div className="ask-thread" ref={threadRef}>
            {turns.length === 0 && (
              <div className="ask-welcome">
                <span className="ask-welcome-mark"><ChatCircleDots size={22} /></span>
                <h2>What would you like to know?</h2>
                <p>
                  Ask about campaigns, gates, drafts, cost or what is waiting on
                  you. I look things up before answering, show you what I read,
                  and say when I do not know rather than guessing.
                </p>
                <div className="ask-suggest">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => void send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, i) => (
              <article key={i} className={`ask-turn ask-turn-${turn.role}`}>
                {turn.role === "assistant" && (
                  <span className="ask-turn-icon"><Sparkle size={13} weight="fill" /></span>
                )}
                <div className="ask-turn-body">
                  <p>{turn.text}</p>
                  {turn.role === "assistant" && <ToolTrace calls={turn.tool_calls} />}
                  {turn.role === "assistant" && turn.tool_calls.length > 0 && !turn.grounded && (
                    <p className="ask-ungrounded">
                      <WarningCircle size={12} /> This answer cites nothing specific,
                      so treat it with care.
                    </p>
                  )}
                  {turn.role === "assistant" && turn.suggested_screen && (
                    <button
                      className="ask-goto"
                      onClick={() => {
                        const page = turn.suggested_screen ?? "";
                        if (page in PAGE_KEYS) go(page as PageKey);
                      }}
                    >
                      Open {turn.suggested_screen}
                    </button>
                  )}
                </div>
              </article>
            ))}

            {thinking && (
              <article className="ask-turn ask-turn-assistant">
                <span className="ask-turn-icon"><Sparkle size={13} weight="fill" /></span>
                <div className="ask-turn-body">
                  <p className="ask-thinking">Looking it up…</p>
                </div>
              </article>
            )}
          </div>

          <form
            className="ask-composer"
            onSubmit={(e) => { e.preventDefault(); void send(question); }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={question}
              placeholder="Ask about this workspace…"
              aria-label="Ask anything about this workspace"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(question); }
              }}
            />
            <MicButton onText={(t) => { setQuestion(t); inputRef.current?.focus(); }} />
            <button
              type="submit" className="ask-send" aria-label="Send"
              disabled={thinking || !question.trim()}
            >
              <ArrowUp size={14} weight="bold" />
            </button>
          </form>
          <p className="ask-foot">
            Enter sends, Shift and Enter makes a new line. Read-only in this release.
            {/* {spend > 0 && ` This conversation has cost $${spend.toFixed(4)}.`}
          */}</p> 
        </section>

        {/* The records an answer leaned on, kept beside the thread so a
            citation stays open-able after the next question. */}
        <aside className="ask-refs" aria-label="Referenced items">
          <p className="meta-label">References</p>
          {references.length === 0 && (
            <p className="ask-empty">Anything an answer cites shows up here, ready to open.</p>
          )}
          {references.map((reference) => {
            const target = targetFor(reference, state);
            const body = (
              <>
                <FileText size={13} />
                <span>
                  <strong>{reference.label || reference.id}</strong>
                  <small>{reference.kind}</small>
                </span>
              </>
            );
            return target ? (
              <button key={reference.id} className="ask-ref" onClick={() => go(target)}>
                {body}
              </button>
            ) : (
              <div key={reference.id} className="ask-ref is-static">{body}</div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
