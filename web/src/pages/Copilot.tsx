import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ActionCardView, ApprovalPanel } from '../components/ActionCard'
import { Chip, Empty, ErrorNote, ErrorTag, Hash, Loading, PageHeader } from '../components/bits'
import { ConfirmCard } from '../components/ConfirmCard'
import { DecisionChain } from '../components/DecisionChain'
import { expectedSigner, RecordSheet } from '../components/RecordSheet'
import { SwitchSeat, usePageTitle } from '../components/chrome'
import { isRecordedTx } from '../replay/hashes'
import { proofFor, proofSentence, refusalFor } from '../lib/proof'
import { useAegis } from '../lib/source'
import { useIdentity } from '../lib/identity'
import { usePendingApprovals, useRequest, useRequestHistory } from '../lib/queries'
import { clock, stamp } from '../lib/format'
import { sentenceCase } from '../lib/vocabulary'
import { confirmRequest, holdText, REPLY_MODE, type ConfirmChoice } from '../lib/confirm'
import type { ChatStage } from '../lib/api/contract'
import type { PendingConfirmation, ReplyMode, RequestRecord, WorkflowState } from '../lib/types'

type Msg = {
  id: string; who: 'owner' | 'agent'; text: string; at: number; requestId?: string; state?: WorkflowState; streamed?: boolean
  pending?: PendingConfirmation; replyMode?: ReplyMode; holdReason?: string
}

type Ask = { message: string; requestId?: string }

type Live = { text: string; stage: ChatStage | null }

const IDLE: Live = { text: '', stage: null }

const STAGE_TEXT: Record<ChatStage | 'start', string> = {
  start: 'Reading the treasury and building options…',
  thinking: 'Reading your message…',
  reading: 'Reading your treasury…',
  writing: 'Writing the reply…',
}

const SUGGESTIONS = [
  'What is our reserve?',
  'Put idle cash to work',
  'Deposit 800 into Vault B',
  'Exit Vault B',
  'Send all USDC to 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
  'Hold for now',
]

function seedFrom(history: RequestRecord[]): Msg[] {
  const seen = new Set<string>()
  const out: Msg[] = []
  for (const r of [...history].sort((a, b) => a.createdAt - b.createdAt)) {
    if (r.origin !== 'owner') continue
    const key = `${r.message}@${r.createdAt}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ id: `${r.id}-q`, who: 'owner', text: r.message, at: r.createdAt })
    }
    out.push({ id: `${r.id}-a`, who: 'agent', text: r.explanation ?? r.actionCard?.reason ?? 'Waiting for your approval.', at: r.history[r.history.length - 1]?.at ?? r.createdAt, requestId: r.id, state: r.state })
  }
  return out
}

export default function Copilot() {
  usePageTitle('Copilot')
  const { api, mode, health, chainId, deployment } = useAegis()
  const { role } = useIdentity()
  const qc = useQueryClient()
  const history = useRequestHistory()
  const pending = usePendingApprovals()
  const [messages, setMessages] = useState<Msg[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const [jump, setJump] = useState<string | null>(null)
  const [live, setLive] = useState<Live>(IDLE)
  const [used, setUsed] = useState<Record<string, ConfirmChoice>>({})
  const streamRef = useRef<AbortController | null>(null)
  const shownRef = useRef(false)
  const req = useRequest(selected)

  useEffect(() => () => streamRef.current?.abort(), [])

  useEffect(() => {
    if (messages !== null || !history.data) return
    const seeded = mode === 'replay' ? seedFrom(history.data) : []
    setMessages(seeded.length ? seeded : [{ id: 'hello', who: 'agent', text: 'Ask about the treasury, or ask me to deploy surplus, exit a vault or hold. I can only choose among plans the engines build; anything material waits for your signature.', at: Date.now() / 1000 }])
  }, [history.data, messages, mode])

  useEffect(() => {
    if (selected || !pending.data) return
    if (pending.data[0]) setSelected(pending.data[0].requestId)
  }, [pending.data, selected])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, live.text])

  const chat = useMutation({
    mutationFn: ({ message: m, requestId }: Ask) => {
      if (!api.chatStream) return api.chat(m, requestId)
      streamRef.current?.abort()
      const ctrl = new AbortController()
      streamRef.current = ctrl
      return api.chatStream(m, {
        onStatus: (stage) => setLive((l) => ({ ...l, stage })),
        onDelta: (t) => {
          shownRef.current = true
          setLive((l) => ({ ...l, text: l.text + t }))
        },
        onReplace: (t) => {
          shownRef.current = true
          setLive((l) => ({ ...l, text: t }))
        },
      }, ctrl.signal, requestId)
    },
    onMutate: ({ message: m }) => {
      shownRef.current = false
      setLive(IDLE)
      setMessages((xs) => [...(xs ?? []), { id: `q-${Date.now()}`, who: 'owner', text: m, at: Date.now() / 1000 }])
    },
    onSuccess: (res) => {
      setMessages((xs) => [...(xs ?? []), { id: `a-${res.requestId}-${Date.now()}`, who: 'agent', text: res.reply, at: Date.now() / 1000, requestId: res.requestId, state: res.state, streamed: shownRef.current, pending: res.pendingConfirmation, replyMode: res.replyMode, holdReason: res.holdReason }])
      setSelected(res.requestId)
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['requests'] })
    },
    onError: (e: Error, ask) => {
      if (e.name === 'AbortError') return
      const bound = ask.requestId
      if (bound) setUsed((u) => Object.fromEntries(Object.entries(u).filter(([k]) => k !== bound)))
      setMessages((xs) => [...(xs ?? []), { id: `e-${Date.now()}`, who: 'agent', text: `Request refused: ${e.message}`, at: Date.now() / 1000 }])
    },
    onSettled: () => setLive(IDLE),
  })

  const send = (e?: FormEvent) => {
    e?.preventDefault()
    const m = text.trim()
    if (!m || chat.isPending) return
    setText('')
    chat.mutate({ message: m })
  }

  const choose = (choice: ConfirmChoice, p: PendingConfirmation) => {
    if (chat.isPending || used[p.requestId]) return
    setUsed((u) => ({ ...u, [p.requestId]: choice }))
    chat.mutate(confirmRequest(choice, p))
  }

  const r = req.data

  useEffect(() => {
    if (!jump || r?.id !== jump) return
    const target = document.getElementById(`approval-${jump}`) ?? document.getElementById('decision')
    if (!target) return
    target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    target.focus({ preventScroll: true })
    setJump(null)
  }, [jump, r?.id])
  const lastAgent = useMemo(() => [...(messages ?? [])].reverse().find((m) => m.who === 'agent' && m.requestId)?.id, [messages])
  const latest = useMemo(() => r?.state ?? [...(messages ?? [])].reverse().find((m) => m.state)?.state, [messages, r?.state])
  const isPending = r?.state === 'AWAITING_APPROVAL'
  const pendingRole = pending.data?.find((p) => p.requestId === r?.id)?.role ?? 'owner'

  return (
    <main id="main" className="page">
      <div className="page-body">
      <PageHeader
        title="Copilot"
        subtitle={<>{pending.data ? `${pending.data.length} waiting for you` : '…'}<span className="sep" aria-hidden="true" />{mode === 'replay' || /determin/i.test(health?.llm ?? health?.llmMode ?? health?.agentMode ?? '') ? 'Deterministic agent' : `${health?.llm ?? health?.llmMode ?? health?.agentMode ?? 'Model'} agent`}{latest ? <><span className="sep" aria-hidden="true" />Last: {sentenceCase(latest).toLowerCase()}</> : null}</>}
        info="Ask in plain words. The agent holds no key and writes no calldata: it picks among options the deterministic engines build, and material actions wait for your signature. No safety property depends on the model."
        actions={pending.data?.[0] ? (
          <button type="button" className="button" onClick={() => { setSelected(pending.data![0].requestId); setJump(pending.data![0].requestId) }}>Review approval</button>
        ) : null}
      />

      <div className={`copilot${isPending ? ' is-approving' : ''}`}>
        <section className="chat" aria-labelledby="chat-title">
          <h2 id="chat-title" className="sr-only">Conversation</h2>
          {role !== 'owner' ? (
            <div className="alert-inline seat-note">
              <p>Only the owner can ask the agent: chat is bound to the owner’s Safe. {role === 'bank' ? 'You are in the bank officer’s seat.' : 'You are looking read-only.'}</p>
              <SwitchSeat to="owner" className="button small secondary" />
            </div>
          ) : null}
          <ol className="messages" ref={listRef} aria-live="polite" aria-relevant="additions">
            {messages === null ? <li><Loading what="the conversation" /></li> : messages.map((m) => (
              <li key={m.id} className={`msg msg-${m.who}${m.streamed ? ' is-streamed' : ''}`}>
                <span className="msg-who">
                  {m.who === 'owner' ? 'You' : 'Porthmos'} <span className="msg-time nums">{clock(m.at)}</span>
                  {m.replyMode ? <span className="msg-mode" title={REPLY_MODE[m.replyMode].title}>{REPLY_MODE[m.replyMode].label}<span className="sr-only">: {REPLY_MODE[m.replyMode].title}</span></span> : null}
                </span>
                <p>{m.text}</p>
                {holdText(m.holdReason) && !(m.pending && m.holdReason === 'AwaitingConfirmation') ? <p className="msg-reason">{holdText(m.holdReason)}</p> : null}
                {m.pending ? (
                  <ConfirmCard pending={m.pending} latest={m.id === lastAgent} used={used[m.pending.requestId]} busy={chat.isPending}
                    onChoose={(choice) => choose(choice, m.pending!)} />
                ) : null}
                {m.requestId ? (
                  <button type="button" className={`msg-inspect${selected === m.requestId ? ' is-on' : ''}`} onClick={() => setSelected(m.requestId!)} aria-pressed={selected === m.requestId}>
                    {m.state ? <Chip state={m.requestId === r?.id && r ? r.state : m.state} /> : null} <span className="msg-inspect-label">Inspect the decision</span>
                  </button>
                ) : null}
              </li>
            ))}
            {chat.isPending ? (
              <li className="msg msg-agent" aria-busy="true">
                <span className="msg-who">Porthmos</span>
                {live.text ? <p>{live.text}<span className="msg-caret" aria-hidden="true" /></p> : <p className="msg-stage">{STAGE_TEXT[live.stage ?? 'start']}</p>}
              </li>
            ) : null}
          </ol>
          <div className="suggest" aria-label="Try one of these">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="suggest-chip" disabled={role !== 'owner' || chat.isPending} onClick={() => chat.mutate({ message: s })}>
                {s.length > 34 ? `${s.slice(0, 31)}…` : s}
              </button>
            ))}
          </div>
          <form className="composer" onSubmit={send}>
            <label htmlFor="ask" className="sr-only">Message to the agent</label>
            <textarea id="ask" className="field" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Put this week’s idle cash to work, keep payroll safe"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} disabled={role !== 'owner'} />
            <button type="submit" className="button" disabled={role !== 'owner' || chat.isPending || !text.trim()}>{chat.isPending ? 'Asking…' : 'Ask'}</button>
          </form>
        </section>

        <section className="inspector" aria-labelledby="insp-title">
          <h2 id="insp-title" className="sr-only">Decision inspector</h2>
          {pending.data?.length ? (
            <div className="pending-list">
              <h3>Approval queue <Chip state="AWAITING_APPROVAL">{`${pending.data.length} waiting`}</Chip></h3>
              <ul>
                {pending.data.map((p) => (
                  <li key={p.requestId}>
                    <button type="button" className={`pending-item${selected === p.requestId ? ' is-on' : ''}`} onClick={() => { setSelected(p.requestId); setJump(p.requestId) }}>
                      <span className="nums">{p.actionCard.amount.display}</span> into {p.actionCard.vault.name}, tier {p.actionCard.tier}
                      <span className="muted"> expires {stamp(p.expiresAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!selected ? <Empty>Ask something, or pick a message to inspect its decision.</Empty> : req.isLoading ? <Loading what="the decision" /> : r ? (
            <article className="decision" id="decision" tabIndex={-1} aria-label="Selected decision">
              <header className="decision-head">
                <p className="decision-quote">“{r.message}”</p>
                <p className="decision-meta"><Chip state={r.state} /> <span className="muted">{r.origin.replace('_', ' ')}, {stamp(r.createdAt)}</span></p>
              </header>
              {isPending && r.actionCard ? (
                <>
                  <ApprovalPanel card={r.actionCard} role={pendingRole} />
                  <ActionCardView card={r.actionCard} />
                </>
              ) : null}
              <DecisionChain history={r.history} revertReason={r.revertReason} />
              {r.options?.length ? (
                <div className="options">
                  <h3>Plan options</h3>
                  <ul>
                    {r.options.map((o) => (
                      <li key={o.id} className={o.chosen ? 'is-chosen' : undefined}>
                        <span>{o.label}</span>
                        {o.isDefault ? <span className="tag">default</span> : null}
                        {o.chosen ? <span className="tag tag-on">chosen</span> : null}
                      </li>
                    ))}
                  </ul>
                  <p className="muted">The model may pick the default, hold, or anything smaller. Anything larger escalates to your approval.</p>
                </div>
              ) : null}
              {r.actionCard && !isPending ? <ActionCardView card={r.actionCard} /> : null}
              {r.dar ? (
                <div className="dar-block">
                  <h3>Decision record</h3>
                  <RecordSheet record={r.dar} chainId={chainId} module={deployment.module} illustrative={mode === 'replay'}
                    expected={expectedSigner(r.dar, mode, r.origin === 'exit_agent' ? { address: deployment.roles.exitKey, label: 'exit key' } : { address: deployment.roles.authorizer, label: 'authorizer' })} />
                </div>
              ) : null}
              {r.revertReason && mode === 'replay' && !isRecordedTx(r.txHash) ? (
                <p className="decision-tx">Refused with <ErrorTag name={r.revertReason} /> in the replay narrative. {refusalFor(r.revertReason) ? proofSentence(proofFor(refusalFor(r.revertReason)!)) : ''}</p>
              ) : r.txHash ? (
                <p className="decision-tx">{r.revertReason ? <>Reverted <ErrorTag name={r.revertReason} /> in</> : 'Executed in'} <Hash value={r.txHash} label="transaction" /></p>
              ) : r.revertReason ? <p className="decision-tx">Reverted <ErrorTag name={r.revertReason} /></p> : null}
              {r.explanation ? <p className="decision-why">{r.explanation}</p> : null}
            </article>
          ) : <ErrorNote error={req.error} />}
        </section>
      </div>
      </div>
    </main>
  )
}
