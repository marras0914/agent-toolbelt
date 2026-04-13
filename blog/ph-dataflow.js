// Every call fetches 3 sources in parallel, then synthesizes with Claude

//  ┌─────────────┐
//  │  Your Agent │
//  └──────┬──────┘
//         │  { "ticker": "NVDA" }
//         ▼
//  ┌─────────────────────────────────────┐
//  │           Agent Toolbelt            │
//  │                                     │
//  │  Polygon.io  Finnhub  FMP           │
//  │  (price)     (metrics) (financials) │
//  │      └──────────┬──────────┘        │
//  │                 ▼                   │
//  │          Claude Haiku               │
//  └─────────────────┬───────────────────┘
//                    │  structured JSON
//                    ▼
//           verdict · thesis · signals
//           valuation · risks · buy zone
