import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const KALSHI_SERIES: Record<string, string> = {
  KXNBAPTS: 'points',
  KXNBAREB: 'rebounds',
  KXNBAAST: 'assists',
  KXNBA3PT: 'threes',
}

const PROP_TYPES: Record<string, string> = {
  basketball_player_points: 'points',
  basketball_player_rebounds: 'rebounds',
  basketball_player_assists: 'assists',
  basketball_player_threes: 'threes',
}

const TEAMS: Record<string, string> = {
  'Jalen Brunson': 'NYK', 'OG Anunoby': 'NYK', 'Karl-Anthony Towns': 'NYK',
  'Mikal Bridges': 'NYK', 'Josh Hart': 'NYK', 'Mitchell Robinson': 'NYK',
  'Miles McBride': 'NYK', 'Landry Shamet': 'NYK', 'Julian Champagnie': 'SAS',
  'Jose Alvarado': 'NYK', 'Victor Wembanyama': 'SAS', 'Stephon Castle': 'SAS',
  "De'Aaron Fox": 'SAS', 'Devin Vassell': 'SAS', 'Keldon Johnson': 'SAS',
  'Dylan Harper': 'SAS', 'Zach Collins': 'SAS', 'Luke Kornet': 'SAS',
}

async function fetchKalshiPrices() {
  const rows: object[] = []
  for (const [ticker, stat] of Object.entries(KALSHI_SERIES)) {
    try {
      const resp = await fetch(
        `https://external-api.kalshi.com/trade-api/v2/markets?limit=200&series_ticker=${ticker}&status=open`,
        { next: { revalidate: 0 } }
      )
      const data = await resp.json()
      for (const m of data.markets || []) {
        const title = m.title || ''
        if (!title.includes(':')) continue
        const player = title.split(':')[0].trim()
        const line = m.floor_strike
        const yesAsk = m.yes_ask_dollars
        const yesBid = m.yes_bid_dollars
        if (!line || !yesAsk || !yesBid) continue
        const price = (parseFloat(yesAsk) + parseFloat(yesBid)) / 2
        if (price === 0) continue
        rows.push({
          player, stat, line: parseFloat(line),
          market: 'kalshi', price: Math.round(price * 10000) / 10000,
          updated_at: new Date().toISOString(),
        })
      }
      await new Promise(r => setTimeout(r, 300))
    } catch (e) {
      console.error(`Kalshi ${ticker} error:`, e)
    }
  }
  return rows
}

async function fetchPolymarketPrices() {
  const rows: object[] = []
  try {
    const resp = await fetch(
      'https://gateway.polymarket.us/v1/search?query=Wembanyama+points&limit=5',
      { next: { revalidate: 0 } }
    )
    const data = await resp.json()
    const events = data.events || []
    const event = events.find((e: { active: boolean; closed: boolean }) => e.active && !e.closed) || events[0]
    if (!event) return rows

    const seen = new Set<string>()
    for (const m of event.markets || []) {
      const smt = m.sportsMarketType
      if (!PROP_TYPES[smt]) continue

      // Parse "Will {player} record at least {N} {stat}"
      const match = m.question?.match(/Will (.+?) record at least (\d+(?:\.\d+)?) (.+?) in/i)
      if (!match) continue
      const player = match[1].trim()
      const n = parseFloat(match[2])
      const statRaw = match[3].toLowerCase()

      if (!TEAMS[player]) continue

      let stat = ''
      if (statRaw.includes('points')) stat = 'points'
      else if (statRaw.includes('rebounds')) stat = 'rebounds'
      else if (statRaw.includes('assists')) stat = 'assists'
      else if (statRaw.includes('three') || statRaw.includes('3-point')) stat = 'threes'
      else continue

      const line = n - 0.5
      const key = `${player}|${stat}|${line}`
      if (seen.has(key)) continue
      seen.add(key)

      // description='No' is the over side shown on app
      let overPrice: number | null = null
      let underPrice: number | null = null
      for (const side of m.marketSides || []) {
        const p = parseFloat(side.price)
        if (isNaN(p)) continue
        if (side.description === 'No') overPrice = p
        else underPrice = p
      }
      if (overPrice === null || underPrice === null) continue
      if (overPrice <= 0) continue

      rows.push({
        player, stat, line,
        market: 'polymarket',
        price: Math.round(overPrice * 10000) / 10000,
        under_price: Math.round((1 - underPrice) * 10000) / 10000,
        updated_at: new Date().toISOString(),
      })
    }
  } catch (e) {
    console.error('Polymarket error:', e)
  }
  return rows
}

export async function POST() {
  try {
    const [kalshiRows, polyRows] = await Promise.all([
      fetchKalshiPrices(),
      fetchPolymarketPrices(),
    ])

    const allRows = [...kalshiRows, ...polyRows]

    // Delete and reinsert all market prices
    await supabase.from('market_prices').delete().gte('id', 0)
    const { error } = await supabase.from('market_prices').insert(allRows)

    if (error) throw error

    return NextResponse.json({
      success: true,
      kalshi: kalshiRows.length,
      polymarket: polyRows.length,
      updated_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Refresh error:', e)
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
