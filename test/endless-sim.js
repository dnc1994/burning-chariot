// 一身「糊了」的流派去打无尽各圈的普通战斗和 Boss，看胜率和掉血
const { loadRZ } = require('./harness');
const RZ = loadRZ(); const Run = RZ.Run;
function build() {
  const s = Run.newRun('liehuo', { seed: 'S' + Math.random() });
  s.relics = ['crit', 'after', 'demo', 'combo', 'plate', 'vamp', 'turbo', 'tank', 'scope', 'nano', 'ultra', 'titan'];
  s.hpBonus = 300;
  s.mods = { w1: ['split', 'heavy', 'blast', 'chain', 'cluster'], w2: ['heavy', 'burn', 'mirv'], ss: ['nuke', 'burn'] };
  s.items = ['heal2', 'double', 'power', 'heal1'];
  return s;
}
for (const act of [3, 4, 5, 6, 7]) {
  for (const kind of ['fight', 'boss']) {
    let win = 0, loss = 0, n = kind === 'boss' ? 5 : 8, turns = 0;
    for (let k = 0; k < n; k++) {
      const s = build(); s.act = act; s.endless = act >= 3 ? act - 2 : 0; s.layers = Run.genLayers(s); s.hp = Run.maxHp(s);
      s.step = kind === 'boss' ? 4 : 3;
      s.node = kind === 'boss' ? s.layers[4][0] : s.layers[3].find((x) => x.type === 'fight' || x.type === 'elite' || x.type === 'trial');
      const g = new RZ.Game(Run.battleOpts(s, 'hard'));
      let f = 0; while (g.result === null && f++ < 80000) g.update(16);
      if (g.result === 0 && g.units[0].alive) { win++; loss += 1 - g.units[0].hp / g.units[0].maxHp; } else loss += 1;
      turns += g.turnNo;
    }
    console.log('act', act, act >= 3 ? '无尽第' + (act - 2) + '区' : '(通关前)', kind, 'win', win + '/' + n, 'hpLoss', Math.round(loss / n * 100) + '%', 'turns', (turns / n).toFixed(0));
  }
}
