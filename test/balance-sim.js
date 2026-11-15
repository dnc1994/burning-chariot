// 远征平衡模拟：让电脑替玩家开车跑 N 次远征，看能走多远、每场打几回合、掉多少血。
// 用法：node test/balance-sim.js [次数=12] [代打水平 easy|normal|hard=hard]
// 奖励是随机拿的、不会躲炮，所以它比认真玩的人弱——把结果当下限看。
const { loadRZ } = require('./harness');
const RZ = loadRZ(); const Run = RZ.Run;
const N = +process.argv[2] || 12, playerDiff = process.argv[3] || 'hard';
let stats = { reach: [], turns: [], frames: [], won: 0, byType: {} };
for (let r = 0; r < N; r++) {
  const s = Run.newRun(RZ.VEHICLES[r % 10].id);
  let guard = 0;
  while (!s.over && guard++ < 200) {
    let eventFight = false;
    if (s.pending) {
      const p = s.pending;
      if (p.kind === 'reward') { const i = (Math.random() * 3) | 0; Run.takeReward(s, i, ['w1', 'w1', 'w2', 'ss'][(Math.random() * 4) | 0]); }
      else if (p.kind === 'shop') { for (let i = 0; i < p.stock.length; i++) if (!p.stock[i].black) Run.buy(s, i, 'w1'); Run.leave(s); }
      else if (p.kind === 'rest') Run.rest(s, s.hp < Run.maxHp(s) * 0.6 ? 'repair' : 'forge');
      else if (p.kind === 'event') {
        // 选第一个选得了的选项；转成战斗的就接着往下打
        const ev = Run.eventById(p.id), k = ev.options.findIndex((o) => Run.canChoose(s, o));
        eventFight = Run.eventChoose(s, k) === 'fight';
      }
      else Run.leave(s);
      if (!eventFight) continue;
    }
    const ch = Run.choices(s);
    let idx = ch.findIndex(n => n.type === 'fight' || n.type === 'boss');
    if (idx < 0) idx = s.gold >= 70 ? ch.findIndex(n => n.type === 'shop') : 0;
    if (idx < 0) idx = 0;
    if (s.hp < Run.maxHp(s) * 0.45) { const j = ch.findIndex(n => n.type === 'rest'); if (j >= 0) idx = j; }
    if (eventFight || Run.enter(s, idx)) {
      const o = Run.battleOpts(s, playerDiff); 
      const g = new RZ.Game(o);
      // 玩家那辆用 playerDiff 的抖动：临时包一层
      let f = 0; const hp0 = s.hp;
      while (g.result === null && f < 60 * 60 * 10) { g.update(16); f++; }
      const t = s.node.type === 'boss' ? 'boss' + (s.act + 1) : s.node.type;   // 三个 Boss 分开统计
      Run.afterBattle(s, g);
      const b = stats.byType[t] = stats.byType[t] || { n: 0, win: 0, loss: 0, turns: 0, sec: 0 };
      b.n++; b.turns += g.turnNo; b.sec += f / 60;
      if (!s.over) { b.win++; b.loss += (hp0 - g.units[0].hp) / Run.maxHp(s); }
    }
  }
  stats.reach.push(s.won ? 'WIN' : `a${s.act + 1}s${s.step + 1}`);
  if (s.won) stats.won++;
}
console.log(stats.reach.join(' '));
for (const t in stats.byType) { const b = stats.byType[t]; console.log(t, 'n', b.n, 'win%', (b.win / b.n * 100).toFixed(0), 'avgTurns', (b.turns / b.n).toFixed(1), 'avgSec', (b.sec / b.n).toFixed(0), 'hpLoss%', (b.loss / Math.max(1, b.win) * 100).toFixed(0)); }
