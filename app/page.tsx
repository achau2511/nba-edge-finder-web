'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Prediction, MarketPrice, MergedRow, Stat, Market } from '@/lib/types'

const STAT_EMOJI: Record<Stat, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM'
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

type Tab = 'best' | 'kalshi' | 'polymarket'

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
      rows.push({
        ...pred, market,
        market_price: price.price,
        edge: pred.model_prob - price.price,
        updated_at: price.updated_at,
      })
    }
    return rows.sort((a, b) => b.edge - a.edge)
  }

  const kalshiRows = merge('kalshi')
  const polyRows = merge('polymarket')
  const bestBets = [
    ...kalshiRows.filter(r => r.edge >= EDGE_THRESH && r.model_prob >= MODEL_THRESH),
    ...polyRows.filter(r => r.edge >= EDGE_THRESH && r.model_prob >= MODEL_THRESH),
  ].sort((a, b) => b.model_prob * b.edge - a.model_prob * a.edge)

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
          { label: 'Best Bets', value: bestBets.length },
          { label: 'Kalshi', value: kalshiRows.length },
          { label: 'K +Edge', value: kalshiRows.filter(r => r.edge > 0.07).length },
          { label: 'Poly', value: polyRows.length },
          { label: 'P +Edge', value: polyRows.filter(r => r.edge > 0.07).length },
        ].map(m => (
          <div key={m.label} className="card" style={{ padding: '10px 10px' }}>
            <div className="metric-value">{loading ? '—' : m.value}</div>
            <div className="metric-label">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ padding: '0 var(--px)' }}>
        {([
          ['best', `Best Bets${bestBets.length > 0 ? ` (${bestBets.length})` : ''}`],
          ['kalshi', 'Kalshi'],
          ['polymarket', 'Polymarket'],
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
            {tab === 'best' && <BestBetsTab rows={bestBets} />}
            {tab === 'kalshi' && <MarketsTab rows={kalshiRows} market="kalshi" />}
            {tab === 'polymarket' && <MarketsTab rows={polyRows} market="polymarket" />}
          </>
        )}
      </div>
    </div>
  )
}

function BetCard({ row }: { row: MergedRow }) {
  return (
    <div className="bet-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className={`badge badge-${row.team.toLowerCase()}`}>{row.team}</span>
        <span className={`market-badge market-badge-${row.market}`}>{row.market}</span>
      </div>
      <div>
        <div className="bet-player">{row.player}</div>
        <div className="bet-detail">over {row.line} {row.stat}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className={`bet-edge ${edgeClass(row.edge)}`}>{edgeSign(row.edge)}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', color: 'var(--text)' }}>
            {Math.round(row.model_prob * 100)}%
          </div>
          <div className="stat-label">model</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
        {[
          { label: 'PRED', value: row.prediction.toFixed(1) },
          { label: 'MODEL', value: `${Math.round(row.model_prob * 100)}%` },
          { label: 'MKT', value: `${Math.round(row.market_price * 100)}%` },
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

function BestBetsTab({ rows }: { rows: MergedRow[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
        No best bets right now
      </div>
    )
  }
  return (
    <div>
      <div style={{ marginBottom: '12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        EDGE &gt; {EDGE_THRESH * 100}% · MODEL &gt; {MODEL_THRESH * 100}%
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
        {rows.map((r, i) => <BetCard key={i} row={r} />)}
      </div>
    </div>
  )
}

function MarketsTab({ rows, market }: { rows: MergedRow[]; market: Market }) {
  const [statFilter, setStatFilter] = useState<Stat | 'all'>('all')
  const filtered = statFilter === 'all' ? rows : rows.filter(r => r.stat === statFilter)
  const stats: (Stat | 'all')[] = ['all', 'points', 'rebounds', 'assists', 'threes']

  return (
    <div>
      {/* Stat filter — horizontal scroll on mobile */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto', paddingBottom: '4px', WebkitOverflowScrolling: 'touch' }}>
        {stats.map(s => (
          <button
            key={s}
            onClick={() => setStatFilter(s)}
            style={{
              padding: '4px 10px',
              borderRadius: '3px',
              border: '1px solid',
              borderColor: statFilter === s ? 'var(--nyk)' : 'var(--border)',
              background: statFilter === s ? 'rgba(245,132,38,0.1)' : 'var(--bg-card)',
              color: statFilter === s ? 'var(--nyk)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {s === 'all' ? 'All' : (STAT_EMOJI[s as Stat] + ' ' + s)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          No {market} markets
        </div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ minWidth: '500px' }}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Stat</th>
                <th>Line</th>
                <th className="hide-mobile">Pred</th>
                <th>Model</th>
                <th>Mkt</th>
                <th>Edge</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`badge badge-${r.team.toLowerCase()}`}>{r.team}</span>
                      <span style={{ color: 'var(--text)', fontSize: '12px' }}>{r.player}</span>
                    </div>
                  </td>
                  <td><span className="stat-label">{STAT_EMOJI[r.stat]}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{r.line}</td>
                  <td className="hide-mobile" style={{ fontFamily: 'var(--font-mono)' }}>{r.prediction.toFixed(1)}</td>
                  <td>
                    <span className={probClass(r.model_prob)} style={{ fontFamily: 'var(--font-mono)' }}>
                      {Math.round(r.model_prob * 100)}%
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(r.market_price * 100)}%</td>
                  <td>
                    <span className={edgeClass(r.edge)} style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {edgeSign(r.edge)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
