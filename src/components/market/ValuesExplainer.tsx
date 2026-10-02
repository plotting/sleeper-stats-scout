const ITEMS: Array<[string, string[]]> = [
  ["How are trade values calculated?", [
    "Values come from thousands of completed trades in public Sleeper dynasty leagues with a lineup like yours (1 QB, 2 RB, 2 WR, 1 TE, 3 flex). Every trade is assumed to be roughly even, so we find the values that make the two sides of as many trades as possible balance.",
    "Recent trades count more (a trade's weight halves every 120 days), clean 1-for-1 deals carry the most signal, and outlier trades are capped so one lopsided deal can't drag a price. The most valuable player is set to 10,000.",
  ]],
  ["Why isn't there a consolidation adjustment?", [
    "Values are built from what managers actually accept, so the market's premium for consolidating (two good players for one great one) is already priced in. We tested this: in a simulated market where managers really do discount extra pieces, the plain-sum fit still graded a four-for-one correctly and was off by only about 7% on shapes it had never seen.",
  ]],
  ["What does the Market ↔ VORP slider do?", [
    "VORP is how much a player's production beat a replacement-level starter at his position, counting how often players at that position miss games and how many flex spots your league has. At 0% you get pure market prices; at 100% values follow recent VORP and age. Whatever the setting, the top player is rescaled to 10,000.",
  ]],
  ["How are picks valued?", [
    "Market prices for a round and class are scaled by how rookie picks of that round actually turned out in your league's drafts, and split into early (1-3), mid (4-6) and late (7-10) slots. The Pick value slider multiplies the result.",
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
