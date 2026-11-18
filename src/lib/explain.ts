/**
 * Learn mode (D-072): every sentence that left the default view lives here, keyed by id, and shows
 * through `<Explain id>` only when Learn mode is on (`?learn=1`). The default view shows data; Learn
 * mode adds the words. An entry whose text depends on the market (a percentage, a rule with the
 * student's numbers) is listed here with what it says, and its live text is passed as children.
 */
export const EXPLAIN = {
  // Status bar
  "status.agents": "Every trade on screen comes from the simulated agents trading in a real limit order book.",
  // WHO
  "who.window": "Aggressive volume by trader type over the last 60 s. Click a candle in GP to see who traded in it; Esc returns to live.",
  "who.summary": "Which trader type did most of the dominant side's trading in this window (live text).",
  // CHAT
  "chat.empty": "The desk is watching the market…",
  // TKT
  "tkt.simulated": "A simulated market: no real security and no real money.",
  "tkt.messages": "Orders you send show here, and on the FILLS tab (EXR) with their exact cost.",
  "tkt.paused": "PAUSED: orders wait and execute when the market resumes (RUN).",
  "tkt.estimate": "Walks the book on screen the way the matching engine will: average price and cost in cents per share versus the mid (live text).",
  "tkt.rests": "A limit order that does not cross the spread rests in the book and fills only if the market trades to its price (live text).",
  "tkt.empty": "Nothing to trade against: this order would be cancelled.",
  // BOOK
  "book.vacuum": "Liquidity vacuum: no one is quoting this side of the book.",
  // EXR
  "exr.what": "Cost versus the mid when your order arrived: the price you intended against the price you got. Slippage splits into spread (mid to the best price) and impact (your own size pushing past it). BPS is hundredths of a percent of the order's value; ¢/SH is cents per share.",
  "exr.row": "Under each order: the arrival mid (the price you intended) and the slippage in cents per share (live text).",
  "exr.empty": "Send an order from ORDER, or type BUY 500. This report shows what each one really cost: the price you intended against the price you got.",
  // STRAT
  "strat.intro": "Describe a trading idea in plain English. It becomes rules from a fixed menu (buy or sell after a drop or rise, stop loss, take profit, time exit) that you check before it trades.",
  "strat.rule": "The strategy's rule in words, with its numbers (live text).",
  "strat.sharpe": "Sharpe is annualized from one-second returns with the sim's clock. Short runs are noisy: a Sharpe from a few minutes of data means little.",
  "strat.waiting": "No decision yet: waiting for the entry rule.",
  "strat.reason": "The AI's reason for the rules it chose (live text).",
  // NEWS
  "news.brief": "The scenario's situation (live text).",
  "news.teaches": "What the scenario teaches (live text).",
  "news.noHeadlines": "None yet. Type a headline in your own words, FED, or SHOCK -3 to send one.",
  "news.adverse": "Market makers lost while value traders gained: the makers were trading against people who knew the news (adverse selection).",
  "news.release": "Executed trades versus the last trade before release. Peak is the furthest move toward fair value; overshoot requires more than 0.3 percentage points beyond it.",
} as const;

export type ExplainId = keyof typeof EXPLAIN;
