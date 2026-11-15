/* 远征模式与爽快规则的回归测试。由 test/run.js 末尾调用，也可以单独跑：
 *   node test/run-mode.js
 * 经典规则的不变量仍由 run.js 前面那些节负责；这里只管新加的东西，
 * 以及「新东西没有漏进经典规则」。
 */
const { loadRZ, flatten } = require('./harness');

module.exports = function runModeTests(RZ, check, head) {
  const Run = RZ.Run;
  const V = (id) => RZ.vehicleById(id);
  const mk = (extra, a, b) => new RZ.Game(Object.assign({
    mapId: 'dry', difficulty: 'normal', guide: true, humanTeam: 0,
    roster: [
      Object.assign({ vehicle: V('liehuo'), team: 0, ai: false, name: '烈火' }, a || {}),
      Object.assign({ vehicle: V('honglong'), team: 1, ai: true, name: '红龙' }, b || {})
    ]
  }, extra || {}));
  /** 平地、无风、无油桶、两车摆好位置的爽快对局 */
  const arena = (a, b, gap) => {
    const g = mk({ arcade: true, barrels: 0 }, a, b);
    const floor = flatten(g);
    g.wind = 0;
    g.units[0].x = 500; g.units[1].x = 500 + (gap || 600);
    g.units.forEach((u) => { u.y = floor; u.airborne = false; u.vy = 0; });
    return g;
  };
  const settle = (g, n) => { for (let i = 0; i < (n || 400); i++) g.update(16); };

  // ---------- 版本号 ----------
  head('版本号');
  {
    const log = require('fs').readFileSync(require('path').join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    check(/^\d+\.\d+\.\d+$/.test(RZ.VERSION), 'RZ.VERSION 是 x.y.z 的形式', RZ.VERSION);
    check(log.indexOf('## v' + RZ.VERSION) >= 0, 'CHANGELOG.md 里有当前版本的小节');
  }

  // ---------- 经典规则没被污染 ----------
  head('爽快规则没有漏进经典规则');
  {
    const g = mk();
    check(g.arc === null, '不传 arcade 就是经典规则');
    check(g.units[0].fuel === RZ.START_FUEL, '经典开局油量不变', `=${g.units[0].fuel}`);
    check(g.props.length === 0, '经典规则没有油桶');
    check(g.previewPath() === null, '经典规则没有弹道预览');
    check(g.hudState().queue === null, '经典规则不给出手队列');
    const x0 = g.units[1].x;
    flatten(g); g.units[1].y = 600;
    g.explode(g.units[1].x - 20, 590, V('liehuo').w1, g.units[0], null, 1);
    settle(g, 120);
    check(g.units[1].x === x0, '经典规则爆炸不会横向击飞');
  }

  // ---------- 节奏 ----------
  head('爽快规则：节奏');
  {
    const g = mk({ arcade: true });
    check(g.units[0].fuel === RZ.ARCADE.startFuel, '开局 60 油', `=${g.units[0].fuel}`);
    check(g.props.length > 0, '场上有油桶', `${g.props.length} 个`);
    const u = g.units[0];
    u.spentThisTurn = 9;
    const classic = mk();
    classic.units[0].spentThisTurn = 9;
    check(g.refuel(u) > classic.refuel(classic.units[0]), '回油比经典快');
    const q = g.hudState().queue;
    check(Array.isArray(q) && q.length === 2 && q[0].name === g.active.name, '给出手队列，当前行动者排第一');
    check(mk({ arcade: true, hardcore: true }).hudState().queue === null, '硬核开关关掉出手队列');
  }
  {
    let turns = 0, n = 0;
    for (const m of RZ.MAPS) {
      const g = new RZ.Game({
        mapId: m.id, difficulty: 'normal', arcade: true, humanTeam: null,
        roster: [{ vehicle: V('liehuo'), team: 0, ai: true, name: 'A' }, { vehicle: V('aodin'), team: 1, ai: true, name: 'B' }]
      });
      let f = 0;
      while (g.result === null && f < 60 * 60 * 12) { g.update(16); f++; }
      check(g.result !== null, `${m.name} 爽快规则能打完`, `回合=${g.turnNo} 轮=${g.round}`);
      turns += g.turnNo; n++;
    }
    check(turns / n < 30, '平均回合数明显短于经典', `均值 ${(turns / n).toFixed(1)}`);
  }
  {
    // 两辆车都不开火：过热必须把对局烧完
    const g = arena({ ai: false }, { ai: false });
    g.opts.humanTeam = null;
    let f = 0;
    while (g.result === null && f < 200000) { if (g.phase === 'aim') g.passTurn(); g.update(16); f++; }
    check(g.result !== null, '谁都不开火也会被「过热」烧出胜负', `轮=${g.round}`);
  }

  // ---------- 击飞 ----------
  head('爽快规则：击飞');
  {
    const g = arena();
    const foe = g.units[1], x0 = foe.x;
    g.explode(foe.x - 22, foe.y - 14, V('liehuo').w1, g.units[0], null, 1);
    settle(g, 200);
    check(foe.x > x0 + 15, '爆炸把车往远离爆心的方向掀出去', `位移 ${Math.round(foe.x - x0)}px`);
    check(!foe.airborne && foe.vx === 0, '落地后停稳');

    const g2 = arena(null, { perks: { anchor: 1 } });
    const f2 = g2.units[1], x2 = f2.x;
    g2.explode(f2.x - 22, f2.y - 14, V('liehuo').w1, g2.units[0], null, 1);
    settle(g2, 200);
    check(f2.x === x2, '磁力底盘不会被击飞');
  }
  {
    // 天空之城：把人掀出浮岛算击杀，还有赏金
    const g = mk({ arcade: true, barrels: 0, mapId: 'sky' });
    const foe = g.units[1];
    foe.x = 300; foe.y = RZ.WORLD_H + 80; foe.airborne = true; foe.vy = 2; foe.lastHitBy = g.units[0];
    settle(g, 30);
    check(!foe.alive, '掉出地图即出局');
    check(g.style.tags['ringout@' + g.turnNo] && g.style.gold >= 15, '击飞出界有赏金', `金=${g.style.gold}`);
  }
  {
    const g = mk({ arcade: true, barrels: 0, mapId: 'sky' }, { perks: { rescue: 1 } });
    const me = g.units[0], hp0 = me.hp;
    me.safeX = me.x;
    me.y = RZ.WORLD_H + 80; me.airborne = true; me.vy = 2;
    settle(g, 300);
    check(me.alive && me.y < RZ.WORLD_H, '牵引回收：掉出地图被拖回来');
    check(me.hp < hp0 && me.rescueLeft === 0, '回收要掉血，且每场只有一次', `${hp0}→${Math.round(me.hp)}`);
    me.y = RZ.WORLD_H + 80; me.airborne = true; me.vy = 2;
    settle(g, 60);
    check(!me.alive, '第二次掉下去就真的出局');
  }

  // ---------- 油桶 ----------
  head('爽快规则：油桶');
  {
    const g = arena();
    const foe = g.units[1], hp0 = foe.hp;
    g.props.push({ x: foe.x - 40, y: foe.y, vy: 0, lit: false });
    g.props.push({ x: foe.x - 130, y: foe.y, vy: 0, lit: false });
    g.props.push({ x: foe.x - 220, y: foe.y, vy: 0, lit: false });
    g.explode(foe.x - 270, foe.y - 6, V('liehuo').w1, g.units[0], null, 1);   // 只够得着最远那个桶
    check(foe.hp === hp0, '第一下爆炸本身打不到人');
    settle(g, 120);
    check(g.props.length === 0, '三个油桶连锁炸光');
    check(foe.hp < hp0, '连锁到最后炸到了人', `-${Math.round(hp0 - foe.hp)}`);
    check(foe.dots.some((d) => d.type === 'fire'), '油桶会点燃目标');
  }
  {
    const g = arena(null, null, 700);
    const me = g.units[0];
    g.props.push({ x: 800, y: me.y, vy: 0, lit: false });
    // 一颗贴着地面平飞的炮弹，路上正好有个油桶
    const p = RZ.launch(me, me.vehicle.w1, 0, 60, g.map.gravity)[0];
    p.x = 760; p.y = me.y - 12; p.vx = 6; p.vy = 0; p.dmgMul = 1;
    g.projectiles.push(p); g.phase = 'fly';
    settle(g, 200);
    check(g.props.length === 0, '炮弹直接撞上油桶会引爆');
  }

  // ---------- 弹道预览 ----------
  head('爽快规则：弹道预览');
  {
    const g = arena();
    g.units[0].aim = 45; g.units[0].lastPower = 70;
    const half = g.previewPath();
    check(half && half.length >= 8, '默认给一段预览', `${half ? half.length / 2 : 0} 点`);
    g.units[0].perks = { scope: 1 };
    const full = g.previewPath();
    check(full.length > half.length * 1.8, '激光测距仪给全程', `${half.length / 2} → ${full.length / 2}`);
    check(Math.abs(full[full.length - 1] - 600) < 30, '全程预览的终点就是落点（平地）');
    g.guide = false;
    check(g.previewPath() === null, '按 G 可以关掉');
    g.guide = true; g.hardcore = true;
    check(g.previewPath() === null, '硬核开关关掉预览');
  }

  // ---------- 遗物 ----------
  head('遗物效果');
  {
    const base = arena(); const armored = arena(null, { perks: { armor: 0.2 } });
    base.damage(base.units[1], 100, base.units[0]);
    armored.damage(armored.units[1], 100, armored.units[0]);
    check(base.units[1].hp === 780 - 100 && armored.units[1].hp === 780 - 80, '反应装甲按比例减伤');
  }
  {
    const g = arena(null, { perks: { thorns: 0.3 } });
    const me = g.units[0], hp0 = me.hp;
    g.damage(g.units[1], 100, me);
    check(me.hp === hp0 - 30, '荆棘电网反弹 30%');
  }
  {
    const g = arena({ perks: { siphon: 5, vamp: 0.1 } });
    const me = g.units[0]; me.hp = 500; const f0 = me.fuel;
    g.damage(g.units[1], 100, me);
    check(me.fuel === f0 + 5 && me.hp === 510, '虹吸回油、吸能回血');
  }
  {
    const g = arena({ perks: { ambush: 1 } });
    const me = g.units[0];
    check(g.perkMul(me) === 2 && g.perkMul(me) === 1, '先发制人只管每场第一发');
  }
  {
    const g = arena({ perks: { combo: 0.15, berserk: 0.6 } });
    const me = g.units[0]; me.streak = 3; me.hp = me.maxHp / 2;
    const m = g.perkMul(me);
    check(Math.abs(m - 1.45 * 1.3) < 1e-6, '连击与狂战士相乘', m.toFixed(3));
  }
  {
    const g = arena(null, { perks: { revive: 1 } });
    const foe = g.units[1];
    g.damage(foe, 5000, g.units[0]);
    check(foe.alive && foe.hp === Math.round(foe.maxHp * 0.4) && foe.revived, '应急核心复活一次');
    g.damage(foe, 5000, g.units[0]);
    check(!foe.alive, '第二次就救不回来了');
  }
  {
    const g = arena({ perks: { aftershock: 0.4 } });
    const foe = g.units[1];
    g.explode(foe.x, foe.y - 14, V('liehuo').w1, g.units[0], foe, 1);
    const afterFirst = foe.hp;
    settle(g, 60);
    check(foe.hp < afterFirst, '余震装置追加一次爆炸', `${afterFirst} → ${foe.hp}`);
    check(g.pendingBlasts.length === 0, '余震不会再触发余震');
  }
  {
    const g = arena({ perks: { autoDouble: 1 } });
    const me = g.units[0];
    me.turnsTaken = 2; g.arcadeTurnStart(me);
    check(me.buffDouble === true, '自动装填：第三回合送一次双倍');
  }

  // ---------- 改造 ----------
  head('武器改造');
  {
    const w1 = V('liehuo').w1;
    const snapshot = JSON.stringify(w1);
    for (const m of Run.MODS) {
      const w = Run.modWeapon(w1, [m.id, m.id]);
      const g = arena(null, null, 500);
      const me = g.units[0], foe = g.units[1], hp0 = foe.hp;
      g.explode(foe.x, foe.y - 14, w, me, foe, 1);
      settle(g, 500);
      check(foe.hp < hp0 && g.projectiles.length === 0, `「${m.name}」叠两层仍能正常结算`, `-${Math.round(hp0 - foe.hp)}`);
    }
    check(JSON.stringify(w1) === snapshot, '改造不会改动原始武器数据');
    const s3 = Run.modWeapon(w1, ['split', 'split']);
    check(s3.count === 3, '分裂弹头叠两层 = 三发', `count=${s3.count}`);
    const mix = Run.modWeapon(V('duzhizhu').w1, ['burn', 'venom']);
    check(mix.dot && mix.dot2 && mix.dot.type !== mix.dot2.type, '火与毒可以挂在同一把武器上');
    const g = arena();
    g.explode(g.units[1].x - 200, 590, Run.modWeapon(w1, ['cluster']), g.units[0], null, 1);
    check(g.projectiles.length === 3, '集束：落点蹦出三颗子弹药');
  }

  // ---------- 远征流程 ----------
  head('远征：状态机');
  {
    const s = Run.newRun('liehuo');
    check(s.layers.length === Run.LAYERS_PER_ACT && s.layers[4][0].type === 'boss', '每个区域五层，最后一层是 Boss');
    check(s.layers.every((L) => L.length >= 1 && L.length <= 3), '每层一到三个选项');
    const back = JSON.parse(JSON.stringify(s));
    check(JSON.stringify(back) === JSON.stringify(s), '状态是纯 JSON，可以原样存取');
    Run.save(s);
    check(Run.load() && Run.load().vehicleId === 'liehuo', '存档能读回来');

    check(Run.enter(s, 0) === true && s.node.type === 'fight', '选战斗节点 → 该开打了');
    const o = Run.battleOpts(s);
    check(o.arcade && o.roster[0].team === 0 && !o.roster[0].ai && o.roster.length >= 2, '战斗参数：爽快规则、玩家在红队');
    check(o.roster[1].vehicle.hp < V(o.roster[1].vehicle.id).hp, '第一层的敌人比原版脆', `${o.roster[1].vehicle.hp}`);

    // 假装打赢了
    const g = new RZ.Game(o);
    g.units[0].hp = 500; g.units[0].items = ['fly'];
    g.units.slice(1).forEach((u) => { u.alive = false; });
    g.result = 0; g.style.gold = 10;
    const gold0 = s.gold;
    Run.afterBattle(s, g);
    check(s.pending && s.pending.kind === 'reward' && s.pending.choices.length === 3, '打赢后三选一');
    check(s.gold === gold0 + s.pending.gold && s.pending.gold >= 40, '发了金币（含花式赏金）', `+${s.pending.gold}`);
    check(s.hp > 500 && s.hp <= Run.maxHp(s), '耐久带回来，外加一点战后抢修', `${s.hp}`);
    check(s.items.length === 1 && s.items[0] === 'fly', '道具带回来');
    check(Run.enter(s, 0) === false, '奖励没领完不能走下一步');

    s.pending.choices[0] = { type: 'mod', id: 'split' };
    check(Run.takeReward(s, 0) === false, '改造必须指定装在哪把武器上');
    check(Run.takeReward(s, 0, 'w1') && s.mods.w1[0] === 'split' && s.step === 1, '装上改造，前进一层');
    check(Run.playerVehicle(s).w1.count === 2, '改造体现在实际开的车上');
  }
  {
    const s = Run.newRun('liehuo');
    s.pending = { kind: 'reward', from: 'fight', gold: 0, choices: [{ type: 'relic', id: 'hull' }, { type: 'relic', id: 'glass' }, { type: 'relic', id: 'turbo' }] };
    Run.takeReward(s, 0);
    check(Run.maxHp(s) === 860 + 150 && s.hp === 860 + 150, '加厚底盘：上限和当前耐久一起涨');
    s.relics.push('glass');
    check(Run.maxHp(s) === Math.round(1010 * 0.75) && Run.playerVehicle(s).atk === 140, '玻璃大炮：攻击 +40%、上限 -25%');
    s.relics.push('turbo', 'jet');
    const v = Run.playerVehicle(s), b = V('liehuo');
    check(v.regen === b.regen + 8 && v.moveCost === b.moveCost / 2 && v.climb === b.climb + 8, '涡轮 / 喷气履带折进车辆数值');
    check(b.hp === 860 && b.atk === 100, '基础车辆数据没被改动');
  }
  {
    const s = Run.newRun('liehuo'); s.gold = 500; s.step = 2;
    Run.enter(s, 1);
    check(s.pending.kind === 'shop' && s.pending.stock.length >= 8, '商店有货', `${s.pending.stock.length} 件`);
    const i = s.pending.stock.findIndex((x) => x.type === 'relic');
    const cost = s.pending.stock[i].cost;
    check(Run.buy(s, i) && s.gold === 500 - cost && s.relics.length === 1, '买遗物扣钱');
    check(Run.buy(s, i) === false, '同一件不能买两次');
    s.gold = 0;
    check(Run.buy(s, s.pending.stock.findIndex((x) => x.type === 'item')) === false, '没钱买不了');
    check(Run.leave(s) && s.step === 3 && !s.pending, '离开商店，前进一层');
  }
  {
    const s = Run.newRun('liehuo'); s.hp = 300; s.step = 2;
    Run.enter(s, 2);
    check(Run.rest(s, 'repair') && s.hp === 300 + 344, '修整回 40% 耐久', `${s.hp}`);
    for (const ev of Run.EVENTS) {
      for (let k = 0; k < ev.options.length; k++) {
        const t = Run.newRun('liehuo');
        t.pending = { kind: 'event', id: ev.id };
        const ok = Run.eventChoose(t, k) && t.pending.kind === 'note' && t.pending.text.length > 0 && t.hp >= 1;
        check(ok && Run.leave(t) && t.step === 1, `事件「${ev.title}」选项 ${k + 1}`);
      }
    }
  }
  {
    Run.saveMeta({ medals: 0, unlocked: Run.STARTERS.slice(), asc: 0, wins: 0, runs: 0, best: 0 });
    const s = Run.newRun('liehuo'); s.battles = 5; s.bosses = 1;
    Run.finish(s, false);
    const m = Run.loadMeta();
    check(s.over && !s.won && s.earned === 8 && m.medals === 8 && m.runs === 1, '失败也按战绩发勋章', `+${s.earned}`);
    check(Run.load() === null, '远征结束后清掉存档');
    check(Run.unlock(m, 'honglong') && m.medals === 2 && m.unlocked.indexOf('honglong') >= 0, '勋章解锁新战车');
    check(Run.unlock(m, 'aodin') === false, '勋章不够不能解锁');
    const w = Run.newRun('liehuo'); w.act = 2; w.step = 4;
    Run.advance(w);
    check(w.over && w.won && Run.loadMeta().asc === 1, '打穿三个区域 = 通关，开放进阶 1');
  }

  head('远征：电脑代打跑完整局');
  {
    Run.saveMeta({ medals: 0, unlocked: Run.STARTERS.slice(), asc: 0, wins: 0, runs: 0, best: 0 });
    let fights = 0, err = null, s = null;
    for (let r = 0; r < 2 && !err; r++) {
      s = Run.newRun(Run.STARTERS[r]);
      let guard = 0;
      try {
        while (!s.over && guard++ < 300) {
          const p = s.pending;
          if (p) {
            if (p.kind === 'reward') Run.takeReward(s, guard % 3, ['w1', 'w2', 'ss'][guard % 3]);
            else if (p.kind === 'shop') { p.stock.forEach((x, i) => Run.buy(s, i, 'w1')); Run.leave(s); }
            else if (p.kind === 'rest') Run.rest(s, 'repair');
            else if (p.kind === 'event') Run.eventChoose(s, guard % 2);
            else Run.leave(s);
            continue;
          }
          if (!Run.enter(s, guard % Run.choices(s).length)) continue;
          const g = new RZ.Game(Run.battleOpts(s, 'hard'));
          let f = 0;
          while (g.result === null && f < 60 * 60 * 12) { g.update(16); f++; }
          if (g.result === null) throw new Error('战斗没打完');
          Run.afterBattle(s, g);
          fights++;
        }
      } catch (e) { err = e; }
      check(!err && s.over, `第 ${r + 1} 次远征跑到了结局`, err ? String(err.stack || err) : `${s.won ? '通关' : '倒在区域 ' + (s.act + 1)} · 打赢 ${s.battles} 场`);
    }
    check(fights >= 4, '中途确实打了不少场', `${fights} 场`);
    check(Run.loadMeta().runs === 2, '局外存档记下了这两次远征');
  }
};

if (require.main === module) {
  const RZ = loadRZ();
  let pass = 0, fail = 0;
  module.exports(RZ, (ok, label, extra) => {
    if (ok) pass++; else fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  }, (t) => console.log(`\n${t}`));
  console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}
