export type Stat = 'points' | 'rebounds' | 'assists' | 'threes'
export type Market = 'kalshi' | 'polymarket'

export interface Prediction {
  player: string
  team: string
  stat: Stat
  line: number
  prediction: number
  model_prob: number
  game_date: string
}

export interface MarketPrice {
  player: string
  stat: Stat
  line: number
  market: Market
  price: number
  updated_at: string
}

export interface MergedRow {
  player: string
  team: string
  stat: Stat
  line: number
  prediction: number
  model_prob: number
  game_date: string
  market: Market
  market_price: number
  edge: number
  updated_at: string
}
