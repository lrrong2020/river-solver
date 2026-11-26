# Riverlab — heads-up NLHE river solver

A local, heads-up no-limit Hold’em river solver. Explore a fixed five-card board with weighted hole-card ranges, a starting pot, and equal effective stacks. The out-of-position player acts first. Amounts are in big blinds and the game has zero rake.

## Quick start · 快速开始

You’ll need Git, Node.js 20 or newer with npm, and a modern browser. The project has no third-party runtime dependencies or build step.

```sh
git clone https://github.com/lrrong2020/river-solver.git
cd river-solver
npm start
```

Open the URL printed in the terminal. The default is [http://127.0.0.1:4173](http://127.0.0.1:4173). If that port is busy, the server picks another available port. Keep the terminal open while using the app and press `Ctrl+C` to stop the server.

1. Click **Run solve** to solve the preloaded spot.
2. In **Strategy explorer**, choose **Check**, then **Bet 10 bb** to see how the out-of-position player responds. Select a hand class to inspect each combo’s action frequencies and expected value.
3. To test an opponent assumption, choose **Lock strategy**, set the action percentages, and click **Save and re-solve**.

安装 Node.js 20 或更高版本后，运行上面的三行命令，打开终端显示的网址。点击 **Run solve** 求解示例牌局，在 **Strategy explorer** 中沿下注路线查看策略和 EV。选择 **Lock strategy** 可以固定指定手牌的行动频率，再求解其他手牌的应对策略。

Run `npm test` from the project directory to check hand evaluation, betting rules, solver accuracy, and node locks.

## Set up a spot

Enter five cards such as `Ks 9d 6s 2h 2c`. Paint hand classes on each player's matrix or enter a comma-separated range such as `TT+,99-77,AKs,AQo:0.5,AhKh:0.25`. Weights run from zero to one. Later entries override earlier entries for the same combo. A board card blocks every combo that contains it.

Opening bet sizes are percentages of the pot. A raise multiple uses the total wager faced. For example, a 3× raise over a 5 bb bet is a raise to 15 bb. The raise cap counts raises after the opening bet. An empty opening-size list with all-in off forces a check when that player is first to bet.

## Read a result

The solver uses alternating CFR+ and reports the average strategy. Its exploitability is the mean gain available to the two players from switching individually to an exact best response, expressed as a percentage of the starting pot. This measures accuracy for the bet sizes and raise cap in the chosen tree. The iteration limit or a manual stop can leave the solve above its target.

Follow the action history to see each player's strategy conditional on reaching that decision. Action EV includes what the player can collect from the current pot and deducts future contributions. Folding has EV zero at the decision. Hand frequencies account for both range weights, shared-card blockers, and earlier action frequencies.

## Lock a strategy

Solve a spot and open a decision in the strategy explorer. Use the node lock editor to select one combo, a hand class, or the acting range. For example, to model an opponent who folds half their hands to a bet, select their decision, choose the acting range, and set fold to 50%, call to 50%, and every raise to 0%. Each selected combo will use that mix. You can instead freeze the solved frequencies to preserve each combo’s individual strategy.

Re-solve to see how the unlocked hands and decisions respond. With locks active, the displayed exploitability measures the gain from deviations available **within the locks**. Remove the locks and re-solve to return to the unrestricted game.

Locks belong to the current session. Edits to a range keep locks on the combos still present. Changes to bet sizes keep a lock only when the same betting history and action menu exist. Changing the board, starting pot, or effective stack starts a new spot and clears its locks.
