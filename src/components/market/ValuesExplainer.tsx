const ITEMS: Array<[string, string[]]> = [
  ["How are trade values calculated?", [
    "Values come from thousands of completed trades in public Sleeper dynasty leagues with a lineup like yours (1 QB, 2 RB, 2 WR, 1 TE, 3 flex). Every trade is assumed to be roughly even, so we find the values that make the two sides of as many trades as possible balance.",
    "Only the last 18 months of trades are used (older ones reflect a different market). Within that, recent trades count more (a trade's weight halves every 120 days), clean 1-for-1 deals carry the most signal, and outlier trades are capped so one lopsided deal can't drag a price. The most valuable player is set to 10,000. The fit re-runs daily and the crawler keeps adding new trades.",
  ]],
  ["What is the consolidation premium?", [
    "In real trades, a side that gives one great asset for several lesser ones is accepted at a lower plain-sum value than the pile of pieces. The fit measures that premium per trade shape (2-for-1, 3-for-1, …) and the calculator multiplies the single-asset side by it.",
    "It only applies when the extra pieces are much lesser than the best asset: full at 50% or less of that asset's value, none at 85% or more, scaled in between. So two starters for one star is nearly a plain swap, and tacking a throw-in or a pick onto a side never switches a premium on. Rare shapes are shrunk toward no premium.",
  ]],
  ["What does the Market ↔ VORP slider do?", [
    "VORP is how much a player's production beat a replacement-level starter at his position, counting how often players at that position miss games and how many flex spots your league has. At 0% you get pure market prices; at 100% values follow recent VORP and age. Whatever the setting, the top player is rescaled to 10,000.",
  ]],
  ["How are picks valued?", [
    "Market prices for a round and class are scaled by how rookie picks of that round actually turned out in your league's drafts, and split into early (1-3), mid (4-6) and late (7-10) slots. The Pick value slider multiplies the result.",
  ]],
  ["What do the trade finder and league grades do?", [
    "The trade finder (league mode) looks for packages that match an asset's value, including the premium, and shows each offer's change to both teams' best starting lineups (annual VORP). Win-win looks across every leaguemate for trades that improve both lineups.",
    "League trade grades price every trade in your league at today's values (hindsight); a used pick counts as the player it became. Trades made since the daily value history began also show the grade at the time. Movers and the 7-day change next to each player come from the same daily history.",
  ]],
  ["Do injuries change values?", [
    "Not by default. Injured players are flagged with Sleeper's designation (OUT, IR, Doubtful, Questionable) wherever they appear. If you turn on the Injury discount slider (up to 50%), out / IR / PUP / suspended players lose the full setting, doubtful players half, and questionable players 15%. It applies everywhere: the verdict, the finder and the league views.",
  ]],
  ["What's in value over time and durability?", [
    "Value over time moves each player along an age curve for his position fitted from today's values (younger players are priced higher up to a peak, then value declines); picks stay flat. Durability is games missed per season from our season stats. Neither is a forecast of injuries or breakouts.",
  ]],
];

export function ValuesExplainer() {
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold">How these values work</p>
      {ITEMS.map(([q, paras]) => (
        <details key={q} className="group rounded-lg border border-white/10 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold list-none flex justify-between items-center">{q}<span className="text-slate-500 group-open:rotate-180 transition-transform">⌄</span></summary>
          <div className="mt-2 space-y-2 text-sm text-slate-400 leading-relaxed">{paras.map((p) => <p key={p}>{p}</p>)}</div>
        </details>
      ))}
    </div>
  );
}
