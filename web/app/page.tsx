"use client";

import { useState, useRef, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTimeMs: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  question?: string;
  sql?: string;
  data?: QueryResult;
  error?: string;
  detail?: string;   // validator reason (e.g. which layer failed and why)
  tokens?: { prompt?: number; completion?: number };
  timestamp: Date;
}

const SUGGESTIONS = [
  "Show total AUM by advisor",
  "List active accounts opened this year",
  "Top 10 advisors by AUM in Northeast",
  "Transactions in last 30 days for ACC001",
];

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSql, setShowSql] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const question = input.trim();
    setInput("");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      question,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      const body = await res.json();

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        sql: body.sql,
        data: body.data,
        error: body.error,
        detail: body.detail,
        tokens: body.tokens,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        error: err.message || "Failed to connect to query engine",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }

  function toggleSql(id: string) {
    setShowSql((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-base)" }}>

      {/* ── Header ── */}
      <header style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        padding: "0 24px",
        height: "60px",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
      }}>
        <div style={{
          maxWidth: "900px",
          width: "100%",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          {/* Logo + title */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "34px",
              height: "34px",
              borderRadius: "9px",
              background: "linear-gradient(135deg, var(--teal-primary), var(--teal-bright))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "15px",
              fontWeight: "700",
              color: "#ffffff",
              flexShrink: 0,
              boxShadow: "0 0 16px rgba(14,165,160,0.25)",
            }}>
              Q
            </div>
            <div>
              <div style={{ fontWeight: "600", fontSize: "15px", letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
                QueryAssist
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", letterSpacing: "0.02em" }}>
                LPL Financial — Operations Query Tool
              </div>
            </div>
          </div>

          {/* Status badge */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "var(--teal-subtle)",
            border: "1px solid var(--teal-muted)",
            borderRadius: "20px",
            padding: "4px 12px",
            fontSize: "11px",
            color: "var(--teal-bright)",
            fontWeight: "500",
          }}>
            <div style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--teal-bright)",
              boxShadow: "0 0 6px var(--teal-bright)",
            }} />
            MS SQL Connected
          </div>
        </div>
      </header>

      {/* ── Messages ── */}
      <main style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>

          {/* Empty state */}
          {messages.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: "80px", paddingBottom: "40px" }}>
              {/* Icon */}
              <div style={{
                width: "64px",
                height: "64px",
                borderRadius: "18px",
                background: "linear-gradient(135deg, var(--teal-primary), var(--teal-bright))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "28px",
                margin: "0 auto 20px",
                boxShadow: "0 0 32px rgba(14,165,160,0.2)",
              }}>
                ⚡
              </div>
              <h2 style={{
                fontSize: "22px",
                fontWeight: "600",
                color: "var(--text-primary)",
                marginBottom: "8px",
                letterSpacing: "-0.02em",
              }}>
                Ask anything about your data
              </h2>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "32px" }}>
                Natural language → SQL → Results, instantly
              </p>

              {/* Suggestion chips */}
              <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                justifyContent: "center",
                maxWidth: "600px",
                margin: "0 auto",
              }}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-bright)",
                      borderRadius: "20px",
                      padding: "8px 16px",
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                    onMouseEnter={e => {
                      (e.target as HTMLButtonElement).style.borderColor = "var(--teal-primary)";
                      (e.target as HTMLButtonElement).style.color = "var(--teal-bright)";
                      (e.target as HTMLButtonElement).style.background = "var(--teal-subtle)";
                    }}
                    onMouseLeave={e => {
                      (e.target as HTMLButtonElement).style.borderColor = "var(--border-bright)";
                      (e.target as HTMLButtonElement).style.color = "var(--text-secondary)";
                      (e.target as HTMLButtonElement).style.background = "var(--bg-card)";
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {messages.map((msg) =>
              msg.role === "user" ? (

                /* ── User bubble ── */
                <div key={msg.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={{
                    background: "linear-gradient(135deg, var(--teal-primary), var(--teal-bright))",
                    color: "#ffffff",
                    borderRadius: "18px 18px 4px 18px",
                    padding: "10px 16px",
                    maxWidth: "70%",
                    fontSize: "14px",
                    fontWeight: "500",
                    boxShadow: "0 4px 16px rgba(14,165,160,0.25)",
                  }}>
                    {msg.question}
                  </div>
                </div>

              ) : (

                /* ── Assistant response ── */
                <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>

                  {/* Error */}
                  {msg.error && (
                    <div style={{
                      background: "rgba(232,96,74,0.1)",
                      border: "1px solid rgba(232,96,74,0.3)",
                      borderRadius: "12px",
                      padding: "12px 16px",
                      color: "var(--coral)",
                      fontSize: "13px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                        <span>⚠</span>
                        <span>{msg.error}</span>
                      </div>
                      {msg.detail && (
                        <div style={{ fontSize: "12px", opacity: 0.85, paddingLeft: "20px" }}>
                          {msg.detail}
                        </div>
                      )}
                      {msg.sql && msg.sql !== "ERROR" && (
                        <div style={{
                          marginTop: "6px",
                          paddingLeft: "20px",
                          fontFamily: "'DM Mono', monospace",
                          fontSize: "11px",
                          color: "var(--coral)",
                          opacity: 0.75,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}>
                          LLM output: {msg.sql}
                        </div>
                      )}
                    </div>
                  )}

                  {/* SQL toggle */}
                  {msg.sql && (
                    <button
                      onClick={() => toggleSql(msg.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 0",
                        fontFamily: "'DM Mono', monospace",
                        fontSize: "11px",
                        color: "var(--teal-primary)",
                        width: "fit-content",
                      }}
                    >
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "16px",
                        height: "16px",
                        borderRadius: "4px",
                        background: "var(--teal-subtle)",
                        border: "1px solid var(--teal-muted)",
                        fontSize: "9px",
                        transition: "transform 0.15s",
                        transform: showSql[msg.id] ? "rotate(90deg)" : "rotate(0deg)",
                      }}>▶</span>
                      {showSql[msg.id] ? "Hide" : "View"} Generated SQL
                    </button>
                  )}

                  {/* SQL block */}
                  {msg.sql && showSql[msg.id] && (
                    <div style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-bright)",
                      borderRadius: "12px",
                      overflow: "hidden",
                    }}>
                      <div style={{
                        background: "var(--bg-surface)",
                        borderBottom: "1px solid var(--border)",
                        padding: "8px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--coral)" }} />
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--amber)" }} />
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--success)" }} />
                        <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
                          T-SQL
                        </span>
                      </div>
                      <pre style={{
                        padding: "16px",
                        fontSize: "12px",
                        fontFamily: "'DM Mono', monospace",
                        color: "var(--text-primary)",
                        overflowX: "auto",
                        margin: 0,
                        lineHeight: "1.7",
                      }}>
                        {msg.sql}
                      </pre>
                    </div>
                  )}

                  {/* Results table */}
                  {msg.data && msg.data.rowCount > 0 && (
                    <div style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-bright)",
                      borderRadius: "12px",
                      overflow: "hidden",
                    }}>
                      {/* Table header bar */}
                      <div style={{
                        background: "var(--bg-surface)",
                        borderBottom: "1px solid var(--border)",
                        padding: "8px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{
                            background: "var(--teal-subtle)",
                            border: "1px solid var(--teal-muted)",
                            borderRadius: "6px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            color: "var(--teal-bright)",
                            fontWeight: "600",
                          }}>
                            {msg.data.rowCount} rows
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {msg.data.columns.length} columns
                          </span>
                        </div>
                        <span style={{
                          fontSize: "11px",
                          color: "var(--text-muted)",
                          fontFamily: "'DM Mono', monospace",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}>
                          <span style={{ color: "var(--success)" }}>●</span>
                          {msg.data.executionTimeMs}ms
                        </span>
                      </div>

                      {/* Table */}
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                          <thead>
                            <tr style={{ background: "var(--bg-surface)" }}>
                              {msg.data.columns.map((col) => (
                                <th
                                  key={col}
                                  style={{
                                    textAlign: "left",
                                    padding: "10px 16px",
                                    fontWeight: "600",
                                    color: "var(--text-secondary)",
                                    fontSize: "11px",
                                    letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                    whiteSpace: "nowrap",
                                    borderBottom: "1px solid var(--border)",
                                  }}
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {msg.data.rows.map((row, i) => (
                              <tr
                                key={i}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                  transition: "background 0.1s",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-card-hover)")}
                                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                              >
                                {msg.data!.columns.map((col) => (
                                  <td
                                    key={col}
                                    style={{
                                      padding: "10px 16px",
                                      color: "var(--text-primary)",
                                      whiteSpace: "nowrap",
                                      fontFamily: typeof row[col] === "number" ? "'DM Mono', monospace" : undefined,
                                      fontSize: "13px",
                                    }}
                                  >
                                    {row[col]?.toString() ?? (
                                      <span style={{ color: "var(--text-muted)" }}>—</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* No results */}
                  {msg.data && msg.data.rowCount === 0 && !msg.error && (
                    <div style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      padding: "16px",
                      fontSize: "13px",
                      color: "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}>
                      <span>○</span> Query returned no results.
                    </div>
                  )}

                  {/* Token usage */}
                  {msg.tokens && (
                    <div style={{
                      fontSize: "10px",
                      color: "var(--text-muted)",
                      display: "flex",
                      gap: "12px",
                      paddingLeft: "2px",
                      fontFamily: "'DM Mono', monospace",
                    }}>
                      {msg.tokens.prompt && <span>↑ {msg.tokens.prompt} prompt</span>}
                      {msg.tokens.completion && <span>↓ {msg.tokens.completion} completion</span>}
                    </div>
                  )}
                </div>
              )
            )}

            {/* Loading indicator */}
            {loading && (
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "var(--text-muted)",
                fontSize: "13px",
                padding: "4px 0",
              }}>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "var(--teal-primary)",
                        animation: "pulse 1.2s ease-in-out infinite",
                        animationDelay: `${i * 0.2}s`,
                        opacity: 0.7,
                      }}
                    />
                  ))}
                </div>
                Generating SQL query...
                <style>{`
                  @keyframes pulse {
                    0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
                    40% { transform: scale(1.2); opacity: 1; }
                  }
                `}</style>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      </main>

      {/* ── Input Footer ── */}
      <footer style={{
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border)",
        padding: "16px 24px",
        flexShrink: 0,
      }}>
        <form
          onSubmit={handleSubmit}
          style={{
            maxWidth: "900px",
            margin: "0 auto",
            display: "flex",
            gap: "10px",
          }}
        >
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "var(--bg-card)",
            border: "1px solid var(--border-bright)",
            borderRadius: "12px",
            padding: "0 16px",
            transition: "border-color 0.15s",
          }}
            onFocusCapture={e => (e.currentTarget.style.borderColor = "var(--teal-primary)")}
            onBlurCapture={e => (e.currentTarget.style.borderColor = "var(--border-bright)")}
          >
            <span style={{ color: "var(--text-muted)", marginRight: "10px", fontSize: "16px" }}>⌕</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about your data..."
              disabled={loading}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                padding: "14px 0",
                fontSize: "14px",
                color: "var(--text-primary)",
                fontFamily: "'DM Sans', sans-serif",
              }}
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  padding: "4px",
                  fontSize: "16px",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              padding: "0 24px",
              background: loading || !input.trim()
                ? "var(--teal-muted)"
                : "linear-gradient(135deg, var(--teal-primary), var(--teal-bright))",
              color: loading || !input.trim() ? "var(--text-muted)" : "#ffffff",
              border: "none",
              borderRadius: "12px",
              fontWeight: "600",
              fontSize: "14px",
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
              fontFamily: "'DM Sans', sans-serif",
              boxShadow: loading || !input.trim() ? "none" : "0 0 20px rgba(14,165,160,0.25)",
              whiteSpace: "nowrap",
            }}
          >
            {loading ? "..." : "Ask →"}
          </button>
        </form>

        {/* Footer hint */}
        <div style={{
          maxWidth: "900px",
          margin: "8px auto 0",
          fontSize: "11px",
          color: "var(--text-muted)",
          display: "flex",
          gap: "16px",
        }}>
          <span>SELECT only · Read-only access · Validated before execution</span>
        </div>
      </footer>
    </div>
  );
}