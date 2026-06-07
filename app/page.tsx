'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Prediction, MarketPrice, MergedRow, Stat, Market } from '@/lib/types'

const STAT_DISPLAY: Record<Stat, string> = {
  points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threes: 'Threes'
}

const EDGE_THRESH = 0.12
const MODEL_THRESH = 0.75

function edgeClass(edge: number) {
  if (edge >= 0.15) return 'edge-high'
  if (edge >= 0.07) return 'edge-mid'
  if (edge >= -0.07) return ''
  if (edge >= -0.15) return 'edge-neg'
  return 'edge-very-neg'
}

function probClass(prob: number) {
  if (prob >= 0.80) return 'prob-high'
  if (prob >= 0.55) return 'prob-mid'
  return 'prob-low'
}

function edgeSign(edge: number) {
  return edge >= 0 ? `+${Math.round(edge * 100)}` : `${Math.round(edge * 100)}`
}

type Tab = 'best' | 'kalshi' | 'polymarket' | 'polymarket-unders'

export default function Dashboard() {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [prices, setPrices] = useState<MarketPrice[]>([])
  const [tab, setTab] = useState<Tab>('best')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const [predsRes, pricesRes] = await Promise.all([
      supabase.from('predictions').select('*'),
      supabase.from('market_prices').select('*'),
    ])
    if (predsRes.data) setPredictions(predsRes.data as Prediction[])
    if (pricesRes.data) {
      setPrices(pricesRes.data as MarketPrice[])
      const latest = (pricesRes.data as MarketPrice[]).reduce((a, b) =>
        a.updated_at > b.updated_at ? a : b, pricesRes.data[0] as MarketPrice)
      if (latest) setLastUpdated(latest.updated_at)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetch('/api/refresh-prices', { method: 'POST' })
      await fetchData()
    } finally {
      setRefreshing(false)
    }
  }

  const merge = (market: Market): MergedRow[] => {
    const mp = prices.filter(p => p.market === market)
    const rows: MergedRow[] = []
    for (const pred of predictions) {
      const price = mp.find(p =>
        p.player === pred.player && p.stat === pred.stat && p.line === pred.line
      )
      if (!price) continue
      const under_model_prob = 1 - pred.model_prob
      const under_market_price = price.under_price ?? (1 - price.price)
      rows.push({
        ...pred, market,
        market_price: price.price,
        under_price: price.under_price,
        edge: pred.model_prob - price.price,
        under_edge: under_model_prob - under_market_price,
        updated_at: price.updated_at,
      })
    }
    return rows.sort((a, b) => b.edge - a.edge)
  }

  const kalshiRows = merge('kalshi')
  const polyRows = merge('polymarket')

  const kalshiBestBets = kalshiRows.filter(r => r.edge >= EDGE_THRESH && r.model_prob >= MODEL_THRESH)
  const polyBestOvers = polyRows.filter(r => r.edge >= EDGE_THRESH && r.model_prob >= MODEL_THRESH)
  const polyBestUnders = polyRows
    .filter(r => (r.under_edge ?? 0) >= EDGE_THRESH && (1 - r.model_prob) >= MODEL_THRESH)
    .sort((a, b) => (b.under_edge ?? 0) - (a.under_edge ?? 0))

  const totalBestBets = kalshiBestBets.length + polyBestOvers.length + polyBestUnders.length

  const gameDate = predictions[0]?.game_date
    ? new Date(predictions[0].game_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'

  const lastUpdatedStr = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <div style={{ minHeight: '100vh', maxWidth: '100vw', overflowX: 'hidden' }}>

      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '12px var(--px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            NBA EDGE FINDER
          </div>
          <div className="ticker">NYK vs SAS · {gameDate}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span className="pulse-dot" />
            <span className="last-updated">{lastUpdatedStr}</span>
          </div>
          <button className={`btn ${refreshing ? 'loading' : ''}`} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? '↻' : '⚡'} <span className="hide-mobile">{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      {/* Metrics */}
      <div style={{
        padding: '12px var(--px)',
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '8px',
        borderBottom: '1px solid var(--border)',
      }}>
        {[
          { label: 'Best Bets', value: totalBestBets },
          { label: 'Kalshi', value: kalshiRows.length },
          { label: 'K +Edge', value: kalshiRows.filter(r => r.edge > 0.07).length },
          { label: 'Poly', value: polyRows.length },
          { label: 'P +Edge', value: polyRows.filter(r => r.edge > 0.07).length },
        ].map(m => (
          <div key={m.label} className="card" style={{ padding: '10px' }}>
            <div className="metric-value">{loading ? '—' : m.value}</div>
            <div className="metric-label">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ padding: '0 var(--px)' }}>
        {([
          ['best', `Best Bets${totalBestBets > 0 ? ` (${totalBestBets})` : ''}`],
          ['kalshi', 'Kalshi'],
          ['polymarket', 'Poly Overs'],
          ['polymarket-unders', 'Poly Unders'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '16px var(--px)' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            Loading...
          </div>
        ) : (
          <>
            {tab === 'best' && (
              <BestBetsTab
                kalshiBets={kalshiBestBets}
                polyBets={polyBestOvers}
                polyUnders={polyBestUnders}
              />
            )}
            {tab === 'kalshi' && <MarketsTab rows={kalshiRows} market="kalshi" />}
            {tab === 'polymarket' && <MarketsTab rows={polyRows} market="polymarket" />}
            {tab === 'polymarket-unders' && <MarketsTab rows={polyRows} market="polymarket" isUnder />}
          </>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ title, count, color = 'var(--nyk)' }: { title: string; count: number; color?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      marginBottom: '12px', marginTop: '20px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        {title}
      </div>
      {count > 0 && (
        <div style={{ background: color, color: '#000', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
          {count}
        </div>
      )}
    </div>
  )
}

function BetCard({ row, isUnder = false }: { row: MergedRow; isUnder?: boolean }) {
  const displayEdge = isUnder ? (row.under_edge ?? 0) : row.edge
  const displayModelProb = isUnder ? (1 - row.model_prob) : row.model_prob
  const displayMarketPrice = isUnder 
    ? (row.under_price ?? (1 - row.market_price))
    : row.market_price
  return (
    <div className="bet-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className={`badge badge-${row.team.toLowerCase()}`}>{row.team}</span>
        <span className={`market-badge market-badge-${row.market}`}>{row.market}</span>
      </div>
      <div>
        <div className="bet-player" style={{ color: row.team === 'NYK' ? 'var(--nyk)' : 'var(--text)' }}>{row.player}</div>
        <div className="bet-detail">{isUnder ? 'under' : 'over'} {row.line} {row.stat}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className={`bet-edge ${edgeClass(displayEdge)}`}>{edgeSign(displayEdge)}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', color: 'var(--text)' }}>
            {Math.round(displayModelProb * 100)}%
          </div>
          <div className="stat-label">model</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
        {[
          { label: 'PRED', value: row.prediction.toFixed(1) },
          { label: 'MODEL', value: `${Math.round(displayModelProb * 100)}%` },
          { label: 'MKT', value: `${Math.round(displayMarketPrice * 100)}%` },
        ].map(m => (
          <div key={m.label}>
            <div className="stat-label">{m.label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BetGrid({ rows, isUnder = false }: { rows: MergedRow[]; isUnder?: boolean }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
        None right now
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
      {rows.map((r, i) => <BetCard key={i} row={r} isUnder={isUnder} />)}
    </div>
  )
}

function BestBetsTab({ kalshiBets, polyBets, polyUnders }: {
  kalshiBets: MergedRow[]
  polyBets: MergedRow[]
  polyUnders: MergedRow[]
}) {
  const total = kalshiBets.length + polyBets.length + polyUnders.length
  return (
    <div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        EDGE &gt; {EDGE_THRESH * 100}% · MODEL &gt; {MODEL_THRESH * 100}%
      </div>

      <div style={{ marginTop: '4px' }}>
        <SectionHeader title="Kalshi Best Bets" count={kalshiBets.length} color="var(--green-bright)" />
        <BetGrid rows={kalshiBets} />
      </div>

      <div>
        <SectionHeader title="Polymarket Best Overs" count={polyBets.length} color="var(--blue)" />
        <BetGrid rows={polyBets} />
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '4px' }}>
        <SectionHeader title="Polymarket Best Unders" count={polyUnders.length} color="var(--red-muted)" />
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: '10px' }}>
          UNDER MODEL &gt; {MODEL_THRESH * 100}% · UNDER EDGE &gt; {EDGE_THRESH * 100}%
        </div>
        <BetGrid rows={polyUnders} isUnder />
      </div>

      {total === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          No best bets right now
        </div>
      )}
    </div>
  )
}

// Mobile-friendly row card for markets tab
function MarketRow({ row, isUnder = false }: { row: MergedRow; isUnder?: boolean }) {
  return (
    <div style={{
      padding: '12px',
      borderBottom: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '8px',
      alignItems: 'center',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
          <span className={`badge badge-${row.team.toLowerCase()}`}>{row.team}</span>
          <span style={{ color: row.team === 'NYK' ? 'var(--nyk)' : 'var(--text)', fontSize: '13px', fontWeight: 500 }}>{row.player}</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span className="stat-label">{isUnder ? 'under' : 'over'} {STAT_DISPLAY[row.stat]} {row.line}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
            pred {row.prediction.toFixed(1)}
          </span>
        </div>
      </div>
      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
        <span className={edgeClass(isUnder ? (row.under_edge ?? 0) : row.edge)} style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 700 }}>
          {edgeSign(isUnder ? (row.under_edge ?? 0) : row.edge)}
        </span>
        <div style={{ display: 'flex', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          <span className={probClass(isUnder ? (1 - row.model_prob) : row.model_prob)}>
            {Math.round((isUnder ? (1 - row.model_prob) : row.model_prob) * 100)}%
          </span>
          <span style={{ color: 'var(--text-muted)' }}>vs</span>
          <span style={{ color: 'var(--text-dim)' }}>
            {Math.round((isUnder
              ? (row.under_price !== undefined ? row.under_price : (1 - row.market_price))
              : row.market_price) * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}

function MarketsTab({ rows, market, isUnder = false }: { rows: MergedRow[]; market: Market; isUnder?: boolean }) {
  const [statFilter, setStatFilter] = useState<Stat | 'all'>('all')

  const sortedRows = isUnder
    ? [...rows].sort((a, b) => (b.under_edge ?? 0) - (a.under_edge ?? 0))
    : rows

  const filtered = statFilter === 'all' ? sortedRows : sortedRows.filter(r => r.stat === statFilter)
  const stats: (Stat | 'all')[] = ['all', 'points', 'rebounds', 'assists', 'threes']

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
        {stats.map(s => (
          <button
            key={s}
            onClick={() => setStatFilter(s)}
            style={{
              padding: '5px 11px',
              borderRadius: '3px',
              border: '1px solid',
              borderColor: statFilter === s ? 'var(--nyk)' : 'var(--border)',
              background: statFilter === s ? 'rgba(245,132,38,0.1)' : 'var(--bg-card)',
              color: statFilter === s ? 'var(--nyk)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {s === 'all' ? 'All' : STAT_DISPLAY[s as Stat]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          No {market} markets
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-bright)',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Player / Stat / Line
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Edge · Model vs Mkt
            </span>
          </div>
          {filtered.map((r, i) => <MarketRow key={i} row={r} isUnder={isUnder} />)}
        </div>
      )}
    </div>
  )
}
