/**
 * The abbreviation dictionary (D-072): the one spelling of each term on screen. Labels use the
 * abbreviation, never a long form or a variant (PX, not PRICE; QTY, not SIZE or SHARES). HELP lists
 * them; `abbrev.test.ts` scans the UI's labels for the long forms in `LONG_FORMS`.
 */
export const ABBREV = {
  QTY: "Quantity: a number of shares.",
  PX: "Price, in dollars and cents.",
  AVG: "Average price of an order's fills.",
  MID: "Mid: halfway between the best bid and the best ask.",
  "ARR MID": "Arrival mid: the mid when your order arrived, the price you intended.",
  SLIP: "Slippage: what an order cost versus the arrival mid. Positive is a cost.",
  "P&L": "Profit and loss: cash plus shares valued at the mid.",
  BPS: "Basis points: hundredths of a percent of the order's value.",
  "¢/SH": "Cents per share.",
  VOL: "Volume: shares traded since the open.",
  "B/S": "Buy or sell; on TAPE, the side that crossed the spread.",
  SRC: "Source: YOU (by hand) or STRAT (your strategy).",
  CHG: "Change since the scenario opened.",
  SL: "Stop loss: exit when the position loses this much.",
  TP: "Take profit: exit when the position gains this much.",
  "MAX DD": "Maximum drawdown: the largest fall in equity from a running peak.",
  N: "Number of samples (one-second returns) behind a statistic.",
  MKT: "Market order: trades now at the best prices available.",
  LMT: "Limit order: trades only at your price or better; otherwise it rests in the book.",
  FV: "Fair value: what value traders believe the stock is worth.",
  MM: "Market makers: quote both sides and earn the spread (Avellaneda–Stoikov).",
  NET: "Aggressive buying minus aggressive selling, in shares.",
} as const;

/** Long forms and variants that a label must not use, with the dictionary term to use instead. */
export const LONG_FORMS: Readonly<Record<string, keyof typeof ABBREV>> = {
  PRICE: "PX",
  SIZE: "QTY",
  SHARES: "QTY",
  SH: "QTY",
  QUANTITY: "QTY",
  AVERAGE: "AVG",
  SLIPPAGE: "SLIP",
  BP: "BPS",
  VOLUME: "VOL",
  PNL: "P&L",
  SIDE: "B/S",
  AGGRESSOR: "B/S",
  SOURCE: "SRC",
  CHANGE: "CHG",
  DRAWDOWN: "MAX DD",
  "STOP LOSS": "SL",
  "TAKE PROFIT": "TP",
};
