



/* ═══════════════════════════════════════════════════════════════════
   CrackAI Sign-In Page Animation — v5.0  "NOVA"
   Ultra-cinematic right-panel. 5 immersive feature scenes.
   Video-quality motion: parallax depth, cinematic cuts, live UI.
   Zero deps. Runs after splash exits.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Styles ── */
  var S = document.createElement('style');
  S.id = 'cai-signin-v5-styles';
  S.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500;600&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');

    #cai-anim-panel {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: #030210;
      display: none;
    }
    #cai-anim-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }

    /* Vignette */
    #cai-anim-panel::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 3;
      background: radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.72) 100%);
      pointer-events: none;
    }

    /* ── HUD ── */
    #cai-anim-hud {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      pointer-events: none;
      z-index: 10;
      padding: 0 24px 32px;
    }

    /* Scene chip */
    #cai-scene-chip {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: rgba(167,139,250,0.95);
      background: rgba(139,92,246,0.12);
      border: 1px solid rgba(139,92,246,0.32);
      border-radius: 100px;
      padding: 5px 16px;
      opacity: 0;
      transform: translateY(12px) scale(0.95);
      transition: opacity 0.4s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1);
      margin-bottom: 12px;
    }
    #cai-scene-chip.show { opacity: 1; transform: translateY(0) scale(1); }

    /* Scene title */
    #cai-scene-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(22px, 3.5vw, 34px);
      font-weight: 800;
      color: #f8f7ff;
      letter-spacing: -0.045em;
      text-align: center;
      line-height: 1.12;
      opacity: 0;
      transform: translateY(18px);
      transition: opacity 0.5s cubic-bezier(0.22,1,0.36,1) 0.05s, transform 0.55s cubic-bezier(0.22,1,0.36,1) 0.05s;
    }
    #cai-scene-title.show { opacity: 1; transform: translateY(0); }
    #cai-scene-title .hl {
      background: linear-gradient(135deg, #a78bfa 0%, #f472b6 55%, #fb923c 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }

    /* Scene description */
    #cai-scene-desc {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: clamp(11px, 1.45vw, 13px);
      font-weight: 400;
      color: rgba(255,255,255,0.36);
      text-align: center;
      margin-top: 9px;
      opacity: 0;
      transition: opacity 0.55s ease 0.17s;
      max-width: 290px;
      line-height: 1.7;
      letter-spacing: 0.01em;
    }
    #cai-scene-desc.show { opacity: 1; }

    /* Stats row */
    #cai-live-stats {
      display: flex;
      gap: 9px;
      margin-top: 20px;
      opacity: 0;
      transition: opacity 0.6s ease 0.26s;
    }
    #cai-live-stats.show { opacity: 1; }
    .cai-ls {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 9px 14px;
      border: 1px solid rgba(139,92,246,0.20);
      border-radius: 14px;
      background: rgba(139,92,246,0.06);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      position: relative;
      overflow: hidden;
    }
    .cai-ls::after {
      content: '';
      position: absolute;
      top: 0; left: -100%; width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(167,139,250,0.12), transparent);
      animation: caiLsShimmer5 3.2s ease infinite;
    }
    @keyframes caiLsShimmer5 { to { left: 200%; } }
    .cai-ls-val {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 17px; font-weight: 800; letter-spacing: -0.03em;
      background: linear-gradient(135deg, #a78bfa, #f472b6);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .cai-ls-lbl {
      font-family: 'JetBrains Mono', monospace;
      font-size: 8px; letter-spacing: 0.15em;
      text-transform: uppercase; color: rgba(255,255,255,0.22); margin-top: 2px;
    }

    /* Scene progress dots */
    #cai-scene-dots {
      display: flex; gap: 5px; margin-top: 18px;
      opacity: 0; transition: opacity 0.5s ease 0.32s;
    }
    #cai-scene-dots.show { opacity: 1; }
    .cai-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: rgba(255,255,255,0.13);
      transition: background 0.35s ease, width 0.38s cubic-bezier(0.22,1,0.36,1);
    }
    .cai-dot.active {
      background: linear-gradient(90deg, #a78bfa, #f472b6);
      width: 22px; border-radius: 3px;
    }

    /* Corner brackets */
    .cai-corner-br { position: absolute; width: 20px; height: 20px; opacity: 0.28; z-index: 8; }
    .cai-corner-br.tl { top: 20px; left: 20px; }
    .cai-corner-br.tr { top: 20px; right: 20px; transform: scaleX(-1); }
    .cai-corner-br.bl { bottom: 20px; left: 20px; transform: scaleY(-1); }
    .cai-corner-br.br { bottom: 20px; right: 20px; transform: scale(-1,-1); }

    /* Scanline */
    #cai-scanline {
      position: absolute; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(167,139,250,0.16) 20%, rgba(167,139,250,0.32) 50%, rgba(167,139,250,0.16) 80%, transparent 100%);
      pointer-events: none; z-index: 9;
      animation: caiScan5 8s linear infinite; top: 0;
    }
    @keyframes caiScan5 { 0%{top:0%;opacity:0} 4%{opacity:1} 92%{opacity:0.5} 100%{top:100%;opacity:0} }

    /* Progress bar */
    #cai-status-bar {
      position: absolute; top: 0; left: 0; right: 0; height: 2.5px;
      background: rgba(255,255,255,0.04); z-index: 8; overflow: hidden;
    }
    #cai-status-fill {
      height: 100%; width: 0%;
      background: linear-gradient(90deg, #6d28d9, #a78bfa, #f472b6);
      background-size: 200% 100%;
      animation: caiBar5 2s linear infinite;
      transition: width 0.1s linear;
      box-shadow: 0 0 10px rgba(167,139,250,0.7);
    }
    @keyframes caiBar5 { 0%{background-position:0%} 100%{background-position:200%} }

    /* Scene flash overlay */
    #cai-scene-flash {
      position: absolute; inset: 0; z-index: 20;
      pointer-events: none; opacity: 0;
      background: radial-gradient(circle at 50% 40%, rgba(167,139,250,0.28) 0%, rgba(0,0,0,0) 70%);
    }

    /* Floating badge */
    #cai-floating-badge-v5 {
      position: absolute; bottom: 0; right: 0;
      transform: translate(0, -20px);
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff; font-family: 'Space Grotesk', sans-serif;
      font-size: 10px; font-weight: 700;
      padding: 6px 13px; border-radius: 100px;
      box-shadow: 0 4px 22px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.14);
      opacity: 0; pointer-events: none; white-space: nowrap;
      letter-spacing: -0.01em; z-index: 5; display: none;
    }
    #cai-floating-badge-v5.show {
      display: block;
      animation: caiBadgeIn5 0.6s cubic-bezier(0.22,1,0.36,1) forwards,
                 caiBadgeFloat5 4s ease-in-out 0.6s infinite;
    }
    @keyframes caiBadgeIn5 {
      from { opacity: 0; transform: translate(0, 18px) scale(0.8); }
      to   { opacity: 1; transform: translate(0, 0) scale(1); }
    }
    @keyframes caiBadgeFloat5 {
      0%,100% { transform: translate(0, 0px); }
      50%     { transform: translate(0, -7px); }
    }

    @media (max-width: 640px) {
      #cai-anim-panel { display: none !important; }
      #cai-floating-badge-v5 { display: none !important; }
    }
  `;
  document.head.appendChild(S);

  /* ── Wait for authScreen ── */
  function init() {
    var authEl = document.getElementById('authScreen');
    if (!authEl) { setTimeout(init, 300); return; }
    function trySetup() { if (!authEl.classList.contains('hidden')) setup(authEl); }
    var obs = new MutationObserver(function() {
      if (!authEl.classList.contains('hidden')) { obs.disconnect(); setup(authEl); }
    });
    obs.observe(authEl, { attributes: true, attributeFilter: ['class'] });
    trySetup();
  }

  function setup(authEl) {
    var rightPanel = authEl.querySelector('.cai-right');
    if (!rightPanel || rightPanel._caiV5Done) return;
    rightPanel._caiV5Done = true;
    rightPanel.style.cssText += ';position:relative;padding:0;overflow:hidden;min-height:500px;';

    var existing = Array.from(rightPanel.children);
    existing.forEach(function(el) { el.style.cssText = 'display:none!important'; });

    var cSVG = '<svg viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 11V2H11" stroke="rgba(167,139,250,0.8)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="2" cy="2" r="1.4" fill="rgba(167,139,250,0.9)"/></svg>';

    var panel = document.createElement('div');
    panel.id = 'cai-anim-panel';
    panel.style.display = 'block';
    panel.innerHTML =
      '<canvas id="cai-anim-canvas"></canvas>' +
      '<div id="cai-scanline"></div>' +
      '<div id="cai-status-bar"><div id="cai-status-fill"></div></div>' +
      '<div id="cai-scene-flash"></div>' +
      '<div class="cai-corner-br tl">' + cSVG + '</div>' +
      '<div class="cai-corner-br tr">' + cSVG + '</div>' +
      '<div class="cai-corner-br bl">' + cSVG + '</div>' +
      '<div class="cai-corner-br br">' + cSVG + '</div>' +
      '<div id="cai-anim-hud">' +
        '<div id="cai-scene-chip">AI Feature</div>' +
        '<div id="cai-scene-title">Solving Questions</div>' +
        '<div id="cai-scene-desc">Ask anything, get instant answers</div>' +
        '<div id="cai-live-stats">' +
          '<div class="cai-ls"><div class="cai-ls-val" id="cai-ls-q">51.2K</div><div class="cai-ls-lbl">Students</div></div>' +
          '<div class="cai-ls"><div class="cai-ls-val" id="cai-ls-a">98%</div><div class="cai-ls-lbl">Accuracy</div></div>' +
          '<div class="cai-ls"><div class="cai-ls-val" id="cai-ls-b">284K</div><div class="cai-ls-lbl">Questions</div></div>' +
        '</div>' +
        '<div id="cai-scene-dots">' +
          '<div class="cai-dot" data-idx="0"></div>' +
          '<div class="cai-dot" data-idx="1"></div>' +
          '<div class="cai-dot" data-idx="2"></div>' +
          '<div class="cai-dot" data-idx="3"></div>' +
          '<div class="cai-dot" data-idx="4"></div>' +
        '</div>' +
      '</div>';
    rightPanel.appendChild(panel);

    /* Left panel extras */
    var googleBtn = authEl.querySelector('#googleSignInBtn');
    if (googleBtn) { googleBtn.classList.add('cai-btn-google-premium'); }
    var leftPanel = authEl.querySelector('.cai-left');
    if (leftPanel) {
      leftPanel.style.position = 'relative';
      var badge = document.createElement('div');
      badge.id = 'cai-floating-badge-v5';
      badge.innerHTML = '✦ 51,200+ students active now';
      leftPanel.appendChild(badge);
      setTimeout(function() { badge.classList.add('show'); }, 3500);
    }

    /* ── Canvas setup ── */
    var canvas = document.getElementById('cai-anim-canvas');
    var ctx    = canvas.getContext('2d');
    var W, H, CX, CY;
    var DPR    = Math.min(window.devicePixelRatio || 1, 2.5);
    var statusFill = document.getElementById('cai-status-fill');
    var flashEl    = document.getElementById('cai-scene-flash');

    function resize() {
      W  = panel.offsetWidth  || rightPanel.offsetWidth  || window.innerWidth  * 0.5;
      H  = panel.offsetHeight || rightPanel.offsetHeight || window.innerHeight;
      CX = W / 2; CY = H / 2;
      canvas.width  = W * DPR; canvas.height = H * DPR;
      canvas.style.width  = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    /* ── Math utils ── */
    var TAU = Math.PI * 2;
    function lerp(a,b,t){ return a + (b-a)*t; }
    function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
    function eOut3(t){ return 1 - Math.pow(1-t,3); }
    function eOut5(t){ return 1 - Math.pow(1-t,5); }
    function eInOut3(t){ return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
    function rand(lo,hi){ return lo + Math.random()*(hi-lo); }
    function rInt(lo,hi){ return Math.floor(rand(lo,hi)); }

    /* ── Particle pool ── */
    var particles = [];
    function spawnP(x,y,vx,vy,color,life,size,type) {
      particles.push({x:x,y:y,vx:vx,vy:vy,color:color,life:0,maxLife:life,size:size,type:type||'dot'});
    }
    function tickP(dt) {
      for (var i=particles.length-1;i>=0;i--) {
        var p=particles[i];
        p.life+=dt; p.x+=p.vx*dt; p.y+=p.vy*dt;
        p.vx*=0.93; p.vy*=0.93;
        if (p.type==='dot') p.vy+=20*dt;
        if (p.life>p.maxLife) particles.splice(i,1);
      }
    }
    function drawP() {
      particles.forEach(function(p) {
        var t=p.life/p.maxLife, a=(1-eOut3(t))*0.9;
        if (a<0.01) return;
        ctx.save(); ctx.globalAlpha=a;
        ctx.fillStyle=p.color; ctx.shadowColor=p.color; ctx.shadowBlur=12;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size*(1-t*0.4),0,TAU); ctx.fill();
        ctx.restore();
      });
    }
    function burst(x,y,color,n,speed) {
      for (var i=0;i<(n||14);i++) {
        var a=rand(0,TAU), s=rand(speed||55,(speed||55)*2.6);
        spawnP(x,y,Math.cos(a)*s,Math.sin(a)*s-45,color,rand(0.55,1.3),rand(2,5.5),'dot');
      }
    }

    /* ── Rounded rect ── */
    function rr(x,y,w,h,r) {
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }
      else {
        ctx.beginPath();
        ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
        ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
        ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
        ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
        ctx.closePath();
      }
    }
    function wrapText(text, x, y, maxW, lineH) {
      var words=text.split(' '), line='';
      for(var n=0;n<words.length;n++){
        var test=line+words[n]+' ';
        if(ctx.measureText(test).width>maxW && n>0){ ctx.fillText(line.trim(),x,y); line=words[n]+' '; y+=lineH; }
        else line=test;
      }
      ctx.fillText(line.trim(),x,y);
    }

    /* ── Star field (pre-seeded) ── */
    var STARS = (function(){
      var arr=[];
      for(var i=0;i<55;i++) arr.push({
        x: (i*397+113)%1000, y: (i*211+79)%1000,
        r: 0.5 + (i%4)*0.35, phase: rand(0,TAU), speed: rand(0.4,1.1)
      });
      return arr;
    })();

    /* ── Shared background ── */
    function drawBG(t) {
      /* Dark void base */
      ctx.fillStyle = '#030210';
      ctx.fillRect(0,0,W,H);

      /* Nebula blobs */
      var nebulae = [
        {x: CX + Math.sin(t*0.10)*W*0.24, y: CY - H*0.33, r: W*0.72, c:'72,48,190', a:0.042},
        {x: CX - Math.cos(t*0.08)*W*0.20, y: CY + H*0.28, r: W*0.68, c:'180,48,120', a:0.030},
        {x: CX + Math.cos(t*0.13)*W*0.12, y: CY,           r: W*0.48, c:'40,110,210', a:0.022}
      ];
      nebulae.forEach(function(n) {
        var g=ctx.createRadialGradient(n.x*(W/1000),n.y*(H/1000),0,n.x*(W/1000),n.y*(H/1000),n.r);
        /* resolve relative coords */
        var gx=CX + Math.sin(t*0.10)*W*0.24, gy=CY - H*0.33;
        if (n.c==='72,48,190') { gx = CX + Math.sin(t*0.10)*W*0.24; gy = CY - H*0.33; }
        else if (n.c==='180,48,120') { gx = CX - Math.cos(t*0.08)*W*0.20; gy = CY + H*0.28; }
        else { gx = CX + Math.cos(t*0.13)*W*0.12; gy = CY; }
        var g2=ctx.createRadialGradient(gx,gy,0,gx,gy,n.r);
        g2.addColorStop(0,'rgba('+n.c+','+n.a+')');
        g2.addColorStop(0.5,'rgba('+n.c+','+(n.a*0.38)+')');
        g2.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);
      });

      /* Subtle perspective grid */
      ctx.save();
      ctx.globalAlpha = 0.024;
      ctx.strokeStyle = '#7c6fcd';
      ctx.lineWidth   = 0.7;
      var gs = Math.max(W,H) / 16;
      for (var gy2=0; gy2<=H; gy2+=gs) { ctx.beginPath(); ctx.moveTo(0,gy2); ctx.lineTo(W,gy2); ctx.stroke(); }
      for (var gx2=0; gx2<=W; gx2+=gs) { ctx.beginPath(); ctx.moveTo(gx2,0); ctx.lineTo(gx2,H); ctx.stroke(); }
      ctx.restore();

      /* Stars */
      STARS.forEach(function(s) {
        var bri = 0.10 + 0.55*(Math.sin(t*s.speed+s.phase)*0.5+0.5);
        ctx.save();
        ctx.globalAlpha = bri * 0.55;
        ctx.fillStyle='#fff';
        var sx2 = s.x/1000*W, sy2 = s.y/1000*H;
        ctx.beginPath(); ctx.arc(sx2, sy2, s.r, 0, TAU); ctx.fill();
        ctx.restore();
      });
    }

    /* ════════════════════════════════════════════════════════
       SCENE 1 — PHONE MOCKUP: Snap & Solve
    ════════════════════════════════════════════════════════ */
    var s1T=0, s1Typed=0, s1Replied=false, s1TypeTimer=0, s1EnterProg=0;
    function initS1(){ s1T=0; s1Typed=0; s1Replied=false; s1TypeTimer=0; s1EnterProg=0; particles.length=0; }
    initS1();

    function drawS1(st,dt) {
      s1T+=dt;
      s1EnterProg=clamp(s1EnterProg+dt*2.2,0,1);

      var ph=H*0.57, pw=ph*0.49;
      var px=CX-pw/2;
      /* Phone enters from below on scene start */
      var pyBase=CY-ph/2-H*0.04;
      var py=pyBase + (1-eOut5(s1EnterProg))*H*0.22;

      /* Ambient glow */
      var aGlow=ctx.createRadialGradient(CX,CY,0,CX,CY,pw*1.8);
      aGlow.addColorStop(0,'rgba(109,40,217,0.13)');
      aGlow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=aGlow; ctx.fillRect(0,0,W,H);

      ctx.save();
      ctx.globalAlpha=eOut5(s1EnterProg);

      /* Phone shadow */
      ctx.save();
      ctx.shadowColor='rgba(90,50,220,0.65)';
      ctx.shadowBlur=60; ctx.shadowOffsetY=18;
      rr(px,py,pw,ph,22); ctx.fillStyle='#0c0a20'; ctx.fill();
      ctx.restore();

      /* Phone border */
      var phoneBorder=ctx.createLinearGradient(px,py,px+pw,py+ph);
      phoneBorder.addColorStop(0,'rgba(167,139,250,0.40)');
      phoneBorder.addColorStop(0.5,'rgba(244,114,182,0.22)');
      phoneBorder.addColorStop(1,'rgba(139,92,246,0.35)');
      ctx.strokeStyle=phoneBorder; ctx.lineWidth=1.6;
      rr(px,py,pw,ph,22); ctx.stroke();

      /* Notch */
      ctx.fillStyle='#0c0a20';
      rr(CX-15,py-1,30,11,5); ctx.fill();

      /* Screen fill */
      rr(px+4,py+12,pw-8,ph-24,15);
      ctx.fillStyle='#06050f'; ctx.fill();

      /* Status bar */
      ctx.fillStyle='rgba(167,139,250,0.06)';
      ctx.fillRect(px+4,py+12,pw-8,22);
      ctx.font='bold 7px "JetBrains Mono",monospace';
      ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.20)';
      ctx.fillText('CrackAI', CX, py+27);
      /* Signal bars */
      for(var si2=0;si2<3;si2++){
        ctx.fillStyle='rgba(167,139,250,'+(0.25+si2*0.28)+')';
        ctx.fillRect(px+10+si2*6,py+19,4,5+si2*2);
      }

      /* Chat bg */
      rr(px+4,py+34,pw-8,ph-62,0); ctx.fillStyle='#06050f'; ctx.fill();

      /* User question bubble */
      var bx=px+8, bw2=pw-16, by=py+44;
      var bGrad=ctx.createLinearGradient(bx,by,bx,by+48);
      bGrad.addColorStop(0,'rgba(109,40,217,0.24)');
      bGrad.addColorStop(1,'rgba(109,40,217,0.14)');
      ctx.fillStyle=bGrad; ctx.strokeStyle='rgba(167,139,250,0.28)'; ctx.lineWidth=1;
      rr(bx,by,bw2,48,10); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.45)';
      ctx.font='6px "JetBrains Mono",monospace';
      ctx.textAlign='left'; ctx.fillText('YOU', bx+8, by+12);
      ctx.fillStyle='rgba(248,247,255,0.90)';
      ctx.font='7px "Plus Jakarta Sans",sans-serif';
      wrapText('If 2x² + 5x - 3 = 0, find x', bx+8, by+26, bw2-16, 11);
      /* Camera icon */
      ctx.shadowColor='#a78bfa'; ctx.shadowBlur=8;
      ctx.fillStyle='rgba(167,139,250,0.92)';
      rr(bx+bw2-26, by+6, 18, 16, 4); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='9px sans-serif';
      ctx.textAlign='center'; ctx.shadowBlur=0;
      ctx.fillText('📷', bx+bw2-17, by+18);
      ctx.fillStyle='rgba(255,255,255,0.28)';
      ctx.font='5px sans-serif'; ctx.textAlign='right';
      ctx.fillText('now', bx+bw2-5, by+44);

      /* AI response */
      var ry=by+56;
      if (s1T < 2.0) {
        /* Typing dots */
        ctx.fillStyle='rgba(251,146,60,0.10)';
        rr(bx+bw2-50,ry,42,18,9); ctx.fill();
        for(var di=0;di<3;di++){
          var dp2=(s1T*2.2+di*0.44)%1;
          ctx.fillStyle='rgba(251,146,60,'+(0.32+dp2*0.68)+')';
          ctx.beginPath(); ctx.arc(bx+bw2-40+di*10, ry+9+Math.sin(s1T*4+di*1.1)*2.5, 2.2,0,TAU); ctx.fill();
        }
      } else {
        if(!s1Replied){ s1Replied=true; burst(CX, CY, '#a78bfa', 14, 90); }
        s1TypeTimer+=dt;
        var maxChars=45;
        s1Typed=Math.min(maxChars, Math.floor(s1TypeTimer*42));
        var ansText='x = 0.5 or x = -3 ✓  (discriminant = 49)';
        var shown=ansText.substring(0,s1Typed);
        var rGrad=ctx.createLinearGradient(bx,ry,bx,ry+54);
        rGrad.addColorStop(0,'rgba(251,146,60,0.20)');
        rGrad.addColorStop(1,'rgba(251,146,60,0.09)');
        ctx.fillStyle=rGrad; ctx.strokeStyle='rgba(251,146,60,0.30)'; ctx.lineWidth=1;
        rr(bx,ry,bw2-4,54,10); ctx.fill(); ctx.stroke();
        ctx.fillStyle='rgba(251,146,60,0.72)';
        ctx.font='6px "JetBrains Mono",monospace'; ctx.textAlign='left';
        ctx.fillText('CRACKAI ✦', bx+8, ry+12);
        ctx.fillStyle='rgba(248,247,255,0.85)';
        ctx.font='7px "Plus Jakarta Sans",sans-serif';
        wrapText(shown, bx+8, ry+26, bw2-24, 11);
        if(s1Typed<maxChars){
          ctx.fillStyle='rgba(251,146,60,0.9)';
          ctx.fillRect(bx+8+ctx.measureText(shown.split('\n').pop()).width+1, ry+20, 1.5, 9);
        }
      }

      /* Home indicator */
      ctx.fillStyle='rgba(255,255,255,0.13)';
      rr(CX-18,py+ph-10,36,4,2); ctx.fill();

      ctx.restore(); /* end enter alpha */

      /* Floating subject tags */
      var tags=[
        {t:'Algebra', c:'#a78bfa', ox:-pw*0.75, oy:-ph*0.20},
        {t:'Physics', c:'#f472b6', ox: pw*0.75, oy:-ph*0.08},
        {t:'SSC CGL', c:'#fb923c', ox:-pw*0.65, oy: ph*0.24}
      ];
      tags.forEach(function(tg,i) {
        var tagA=clamp(s1EnterProg*1.5-(i*0.15),0,1);
        var fx=CX+tg.ox+Math.sin(s1T*0.7+i*1.1)*5;
        var fy=CY+tg.oy+Math.cos(s1T*0.55+i*0.9)*3.5;
        ctx.save(); ctx.globalAlpha=tagA*(0.48+Math.sin(s1T*0.8+i)*0.18);
        var tw=ctx.measureText(tg.t).width+18;
        ctx.fillStyle=tg.c+'18'; ctx.strokeStyle=tg.c+'52'; ctx.lineWidth=1;
        rr(fx-tw/2,fy-10,tw,20,10); ctx.fill(); ctx.stroke();
        ctx.fillStyle=tg.c;
        ctx.font='bold 8px "Space Grotesk",sans-serif'; ctx.textAlign='center';
        ctx.fillText(tg.t,fx,fy+3.5);
        ctx.restore();
      });
      tickP(dt); drawP();
    }

    /* ════════════════════════════════════════════════════════
       SCENE 2 — NEURAL ORB: AI Intelligence
    ════════════════════════════════════════════════════════ */
    var s2T=0, s2Enter=0;
    function initS2(){ s2T=0; s2Enter=0; particles.length=0; }

    function drawS2(st,dt) {
      s2T+=dt;
      s2Enter=clamp(s2Enter+dt*2.0,0,1);
      var orbR=Math.min(W,H)*0.155*(0.4+eOut5(s2Enter)*0.6);
      var pulse=Math.sin(s2T*1.9)*0.055;

      ctx.globalAlpha=eOut3(s2Enter);

      /* Wide halo */
      var halo=ctx.createRadialGradient(CX,CY,orbR*0.5,CX,CY,orbR*4.5);
      halo.addColorStop(0,'rgba(109,40,217,0.12)');
      halo.addColorStop(0.35,'rgba(167,139,250,0.06)');
      halo.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=halo; ctx.fillRect(0,0,W,H);

      /* Pulse rings */
      for(var ri=0;ri<6;ri++){
        var rp=(s2T*0.62+ri*0.25)%1;
        var rrad=orbR*(1.1+rp*3.5);
        var ra=(1-rp)*0.16*(1+ri*0.04);
        ctx.save(); ctx.globalAlpha=ra*eOut3(s2Enter);
        ctx.strokeStyle='rgba(124,58,237,1)'; ctx.lineWidth=1.1;
        ctx.shadowColor='#7c3aed'; ctx.shadowBlur=14;
        ctx.beginPath(); ctx.arc(CX,CY,rrad,0,TAU); ctx.stroke();
        ctx.restore();
      }

      /* Rotating energy rings */
      for(var eri=0;eri<3;eri++){
        var eAngle=s2T*0.85*(eri%2===0?1:-1)+eri*1.2;
        var eRx=orbR*(1.55+eri*0.22), eRy=orbR*(0.28+eri*0.06);
        ctx.save(); ctx.globalAlpha=eOut3(s2Enter);
        ctx.translate(CX,CY); ctx.rotate(eAngle);
        ctx.scale(1, eRy/eRx);
        ctx.strokeStyle=['rgba(167,139,250,0.40)','rgba(244,114,182,0.30)','rgba(251,146,60,0.24)'][eri];
        ctx.lineWidth=1.2+eri*0.3;
        ctx.shadowColor=['#a78bfa','#f472b6','#fb923c'][eri]; ctx.shadowBlur=14;
        ctx.beginPath(); ctx.arc(0,0,eRx,0,TAU); ctx.stroke();
        ctx.restore();
      }

      /* Orb body */
      var orbBodyG=ctx.createRadialGradient(CX-orbR*0.28,CY-orbR*0.3,orbR*0.04,CX,CY,orbR*(1+pulse));
      orbBodyG.addColorStop(0,'#f5f0ff');
      orbBodyG.addColorStop(0.08,'#d8b4fe');
      orbBodyG.addColorStop(0.28,'#7c3aed');
      orbBodyG.addColorStop(0.6,'#3b0764');
      orbBodyG.addColorStop(0.85,'#120424');
      orbBodyG.addColorStop(1,'#030210');
      ctx.save();
      ctx.globalAlpha=eOut3(s2Enter);
      ctx.shadowColor='#a78bfa'; ctx.shadowBlur=55;
      ctx.fillStyle=orbBodyG;
      ctx.beginPath(); ctx.arc(CX,CY,orbR*(1+pulse),0,TAU); ctx.fill();
      /* Specular */
      var specG=ctx.createRadialGradient(CX-orbR*0.30,CY-orbR*0.32,0,CX-orbR*0.18,CY-orbR*0.20,orbR*0.36);
      specG.addColorStop(0,'rgba(255,255,255,0.94)');
      specG.addColorStop(0.5,'rgba(220,200,255,0.32)');
      specG.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=specG;
      ctx.beginPath(); ctx.arc(CX-orbR*0.18,CY-orbR*0.20,orbR*0.36,0,TAU); ctx.fill();
      /* Rim */
      var rimG=ctx.createRadialGradient(CX+orbR*0.36,CY+orbR*0.36,0,CX+orbR*0.36,CY+orbR*0.36,orbR*0.28);
      rimG.addColorStop(0,'rgba(244,114,182,0.42)');
      rimG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=rimG;
      ctx.beginPath(); ctx.arc(CX+orbR*0.36,CY+orbR*0.36,orbR*0.28,0,TAU); ctx.fill();
      ctx.restore();

      /* Orbiting knowledge nodes */
      var NODES=[
        {a:0.0,  dist:0.40, label:'SSC',    c:'#a78bfa'},
        {a:1.26, dist:0.37, label:'Maths',  c:'#f472b6'},
        {a:2.51, dist:0.39, label:'GK',     c:'#fb923c'},
        {a:3.77, dist:0.36, label:'English',c:'#34d399'},
        {a:5.03, dist:0.38, label:'Science',c:'#38bdf8'}
      ];
      var maxOrbitR=Math.min(W,H)*0.44;
      var nodeAlpha=eOut3(clamp(s2Enter*1.5-0.2,0,1));
      NODES.forEach(function(n,ni) {
        var angle=n.a+s2T*0.50;
        var nx=CX+Math.cos(angle)*maxOrbitR*n.dist;
        var ny=CY+Math.sin(angle)*maxOrbitR*n.dist;
        /* Connector */
        ctx.save(); ctx.globalAlpha=(0.22+Math.sin(s2T*1.4+n.a)*0.08)*nodeAlpha;
        ctx.strokeStyle=n.c; ctx.lineWidth=0.9; ctx.setLineDash([3,6]);
        ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(nx,ny); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        /* Packet */
        var pp=(s2T*0.72+ni*0.22)%1;
        var bpx=lerp(CX,nx,pp), bpy=lerp(CY,ny,pp);
        ctx.save(); ctx.globalAlpha=(1-Math.abs(pp-0.5)*2)*0.85*nodeAlpha;
        ctx.fillStyle=n.c; ctx.shadowColor=n.c; ctx.shadowBlur=12;
        ctx.beginPath(); ctx.arc(bpx,bpy,2.5,0,TAU); ctx.fill();
        ctx.restore();
        /* Node */
        var nr=18;
        ctx.save(); ctx.globalAlpha=nodeAlpha;
        ctx.shadowColor=n.c; ctx.shadowBlur=24;
        var nG=ctx.createRadialGradient(nx-nr*0.3,ny-nr*0.3,2,nx,ny,nr);
        nG.addColorStop(0,n.c+'cc'); nG.addColorStop(1,n.c+'22');
        ctx.fillStyle=nG; ctx.strokeStyle=n.c+'88'; ctx.lineWidth=1.2;
        ctx.beginPath(); ctx.arc(nx,ny,nr,0,TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#fff'; ctx.shadowBlur=0;
        ctx.font='bold 7.5px "Space Grotesk",sans-serif'; ctx.textAlign='center';
        ctx.textBaseline='middle'; ctx.fillText(n.label, nx, ny);
        /* Pulse ring */
        var pp2=(s2T*0.9+ni*0.35)%1;
        ctx.globalAlpha=(1-pp2)*0.28*nodeAlpha;
        ctx.strokeStyle=n.c; ctx.lineWidth=1.3;
        ctx.beginPath(); ctx.arc(nx,ny,nr+pp2*16,0,TAU); ctx.stroke();
        ctx.restore();
      });

      /* Accuracy badge */
      var badgeY=CY+Math.min(W,H)*0.305;
      ctx.save(); ctx.globalAlpha=0.90*nodeAlpha;
      var bG=ctx.createLinearGradient(CX-55,badgeY,CX+55,badgeY);
      bG.addColorStop(0,'rgba(109,40,217,0.24)');
      bG.addColorStop(1,'rgba(244,114,182,0.20)');
      ctx.fillStyle=bG; ctx.strokeStyle='rgba(167,139,250,0.42)'; ctx.lineWidth=1.2;
      rr(CX-55,badgeY-15,110,30,15); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.88)';
      ctx.font='bold 12px "Space Grotesk",sans-serif'; ctx.textAlign='center';
      ctx.textBaseline='middle'; ctx.shadowColor='#a78bfa'; ctx.shadowBlur=8;
      ctx.fillText('⚡ 98% Accuracy · Real-time', CX, badgeY);
      ctx.restore();
      ctx.globalAlpha=1;
      tickP(dt); drawP();
    }

    /* ════════════════════════════════════════════════════════
       SCENE 3 — BATTLE ARENA: cinematic VS match
    ════════════════════════════════════════════════════════ */
    var s3T=0, s3Enter=0, s3ComboShown=false, s3QCount=0, s3QTimer=0;
    function initS3(){ s3T=0; s3Enter=0; s3ComboShown=false; s3QCount=0; s3QTimer=0; particles.length=0; }

    function drawS3(st,dt) {
      s3T+=dt;
      s3Enter=clamp(s3Enter+dt*2.0,0,1);

      var ea=eOut5(s3Enter);

      /* Arena glows — split purple/pink */
      var leftGlow=ctx.createRadialGradient(CX-W*0.3,CY,0,CX-W*0.3,CY,W*0.6);
      leftGlow.addColorStop(0,'rgba(109,40,217,0.14)');
      leftGlow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=leftGlow; ctx.fillRect(0,0,W,H);
      var rightGlow=ctx.createRadialGradient(CX+W*0.3,CY,0,CX+W*0.3,CY,W*0.6);
      rightGlow.addColorStop(0,'rgba(236,72,153,0.14)');
      rightGlow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=rightGlow; ctx.fillRect(0,0,W,H);

      /* Arena floor glow */
      var floorG=ctx.createRadialGradient(CX,H*0.92,0,CX,H*0.92,W*0.55);
      floorG.addColorStop(0,'rgba(251,146,60,0.06)');
      floorG.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=floorG; ctx.fillRect(0,0,W,H);

      /* Dashed center divider */
      ctx.save();
      var divG=ctx.createLinearGradient(CX,CY-H*0.30,CX,CY+H*0.30);
      divG.addColorStop(0,'rgba(255,255,255,0)');
      divG.addColorStop(0.5,'rgba(255,255,255,0.14)');
      divG.addColorStop(1,'rgba(255,255,255,0)');
      ctx.strokeStyle=divG; ctx.lineWidth=1; ctx.setLineDash([6,9]);
      ctx.beginPath(); ctx.moveTo(CX,CY-H*0.30); ctx.lineTo(CX,CY+H*0.30); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();

      /* VS badge — cinematic pulsing */
      var vsS=ea*(1+Math.sin(s3T*2.4)*0.055);
      ctx.save();
      ctx.translate(CX, lerp(CY-H*0.12, CY-H*0.06, ea));
      ctx.scale(vsS,vsS);
      /* Outer ring */
      ctx.globalAlpha=0.22*ea;
      ctx.strokeStyle='rgba(251,146,60,0.8)'; ctx.lineWidth=1.2;
      var vsRing=(s3T*0.6)%1;
      ctx.beginPath(); ctx.arc(0,0,55+vsRing*22,0,TAU); ctx.stroke();
      ctx.globalAlpha=1;
      /* Glow */
      var vsGlow=ctx.createRadialGradient(0,0,0,0,0,60);
      vsGlow.addColorStop(0,'rgba(251,146,60,0.22)');
      vsGlow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=vsGlow; ctx.fillRect(-60,-60,120,120);
      /* Hexagon frame */
      ctx.save();
      ctx.rotate(s3T*0.35);
      ctx.strokeStyle='rgba(251,146,60,0.38)'; ctx.lineWidth=1;
      ctx.shadowColor='#fb923c'; ctx.shadowBlur=15;
      ctx.beginPath();
      for(var vi=0;vi<6;vi++){
        var va=vi*(TAU/6)-TAU/12;
        vi===0 ? ctx.moveTo(Math.cos(va)*40,Math.sin(va)*40) : ctx.lineTo(Math.cos(va)*40,Math.sin(va)*40);
      }
      ctx.closePath(); ctx.stroke();
      ctx.restore();
      /* VS text */
      ctx.font='bold 46px "Space Grotesk",sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      var vsG=ctx.createLinearGradient(-26,-20,26,20);
      vsG.addColorStop(0,'#fb923c'); vsG.addColorStop(1,'#f472b6');
      ctx.fillStyle=vsG;
      ctx.shadowColor='rgba(251,146,60,0.75)'; ctx.shadowBlur=40;
      ctx.fillText('VS', 0, 0);
      ctx.restore();

      /* Players */
      var playerY = CY + lerp(H*0.15, 0, ea);
      drawArenaPlayer(CX - W*0.27, playerY, s3T, 'You',   '#a78bfa', 0.0, '🎓', ea);
      drawArenaPlayer(CX + W*0.27, playerY, s3T, 'Rival', '#f472b6', 1.4, '👤', ea);

      /* LIVE question ticker */
      s3QTimer+=dt;
      var QUESTIONS=['What is HCF of 48 & 64?','Fill in: He ___ to Delhi.','Article 370 was about?','Ohm\'s Law: V = ?'];
      var qIdx=Math.floor(s3T*0.8)%QUESTIONS.length;
      var qA=clamp(s3QTimer*4,0,1);
      var qFade=1-clamp((s3QTimer-1.0)*4,0,1);
      if(s3QTimer>1.35){ s3QTimer=0; }
      ctx.save();
      ctx.globalAlpha=Math.min(qA,qFade)*ea*0.9;
      var qW=Math.min(W*0.72,240);
      ctx.fillStyle='rgba(15,10,35,0.80)';
      ctx.strokeStyle='rgba(167,139,250,0.30)'; ctx.lineWidth=1;
      rr(CX-qW/2, CY-H*0.28, qW, 30, 15); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.82)';
      ctx.font='bold 9px "Space Grotesk",sans-serif'; ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.fillText('⚡ ' + QUESTIONS[qIdx], CX, CY-H*0.28+15);
      ctx.restore();

      /* Score bar */
      var scoreA=Math.min(Math.floor(s3T*24),265);
      var scoreB=Math.min(Math.floor(s3T*17),198);
      var sy=playerY+Math.min(W,H)*0.31;
      ctx.save(); ctx.globalAlpha=ea;
      ctx.fillStyle='rgba(4,3,13,0.75)';
      ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
      rr(CX-78,sy-16,156,32,16); ctx.fill(); ctx.stroke();
      ctx.font='bold 18px "Space Grotesk",sans-serif'; ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.fillStyle='#a78bfa'; ctx.fillText(scoreA, CX-28, sy);
      ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.font='11px "JetBrains Mono",monospace';
      ctx.fillText('·', CX, sy);
      ctx.fillStyle='#f472b6'; ctx.font='bold 18px "Space Grotesk",sans-serif';
      ctx.fillText(scoreB, CX+28, sy);
      ctx.restore();

      /* Lightning every ~0.5s */
      if (s3T>0.6 && Math.floor(s3T*4)%2===0) {
        drawLightning(CX-W*0.13, CY-H*0.05, CX+W*0.13, CY+H*0.05);
      }

      /* COMBO flash */
      if(!s3ComboShown && s3T>3.2){
        s3ComboShown=true;
        burst(CX-W*0.27, playerY, '#a78bfa', 18, 120);
        burst(CX, playerY, '#fde047', 10, 80);
        if(flashEl){ flashEl.style.opacity='0.32'; setTimeout(function(){ flashEl.style.opacity='0'; },320); }
      }
      if(s3T>3.2){
        var comboA=clamp((s3T-3.2)/0.4,0,1)*clamp(1-(s3T-5.5)/0.6,0,1);
        ctx.save(); ctx.globalAlpha=comboA*0.92;
        var comboG=ctx.createLinearGradient(CX-W*0.27-50,0,CX-W*0.27+50,0);
        comboG.addColorStop(0,'#7c3aed'); comboG.addColorStop(1,'#a78bfa');
        ctx.fillStyle=comboG; ctx.shadowColor='#a78bfa'; ctx.shadowBlur=18;
        rr(CX-W*0.27-44, playerY-62, 88, 24, 12); ctx.fill();
        ctx.fillStyle='#fff'; ctx.font='bold 10px "Space Grotesk",sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.shadowBlur=0;
        ctx.fillText('🔥 COMBO x3', CX-W*0.27, playerY-50);
        ctx.restore();
      }

      tickP(dt); drawP();
    }

    function drawArenaPlayer(x,y,t,name,color,phase,emoji,alpha) {
      var scale=(0.6+eOut5(alpha)*0.4)*(1+Math.sin(t*2.2+phase)*0.033);
      ctx.save();
      ctx.translate(x,y); ctx.scale(scale,scale); ctx.globalAlpha=alpha;
      /* Pulse ring */
      var rp2=(t*1.1+phase)%1;
      ctx.globalAlpha=(1-rp2)*0.22*alpha;
      ctx.strokeStyle=color; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(0,0,44+rp2*14,0,TAU); ctx.stroke();
      ctx.globalAlpha=alpha;
      /* Halo */
      ctx.shadowColor=color; ctx.shadowBlur=35;
      /* Body */
      var ag=ctx.createRadialGradient(-10,-10,4,0,0,30);
      ag.addColorStop(0,color); ag.addColorStop(1,color+'33');
      ctx.fillStyle=ag;
      ctx.beginPath(); ctx.arc(0,0,28,0,TAU); ctx.fill();
      /* Ring */
      ctx.strokeStyle=color+'cc'; ctx.lineWidth=1.8;
      ctx.beginPath(); ctx.arc(0,0,30,0,TAU); ctx.stroke();
      /* Emoji */
      ctx.font='17px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.shadowBlur=0; ctx.fillText(emoji, 0, 1);
      /* Name */
      ctx.font='bold 9px "Space Grotesk",sans-serif';
      ctx.textBaseline='top'; ctx.fillStyle=color;
      ctx.shadowColor=color; ctx.shadowBlur=10;
      ctx.fillText(name, 0, 36);
      ctx.restore();
      /* HP bar */
      var bw3=60, bh=5, charge=clamp(0.25+Math.sin(t*1.4+phase)*0.35+0.45,0.2,1.0);
      ctx.save(); ctx.globalAlpha=alpha;
      ctx.fillStyle='rgba(255,255,255,0.06)'; rr(x-bw3/2,y+scale*52,bw3,bh,3); ctx.fill();
      var barG=ctx.createLinearGradient(x-bw3/2,0,x+bw3/2,0);
      barG.addColorStop(0,color); barG.addColorStop(1,color+'66');
      ctx.fillStyle=barG; rr(x-bw3/2,y+scale*52,bw3*charge,bh,3); ctx.fill();
      ctx.restore();
    }
    function drawLightning(x1,y1,x2,y2) {
      ctx.save();
      ctx.strokeStyle='rgba(253,224,71,0.88)'; ctx.lineWidth=2.2;
      ctx.shadowColor='#fde047'; ctx.shadowBlur=20;
      ctx.globalAlpha=0.78;
      var mx=(x1+x2)/2+rand(-12,12), my=(y1+y2)/2+rand(-8,8);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(mx,my,x2,y2); ctx.stroke();
      ctx.lineWidth=0.9; ctx.globalAlpha=0.42;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(mx+rand(-14,14),my+rand(-14,14)); ctx.stroke();
      /* Spark nodes at ends */
      [x1,y1,x2,y2].forEach(function(_,i){
        if(i%2===0){
          ctx.globalAlpha=0.55;
          ctx.fillStyle='#fde047'; ctx.shadowBlur=10;
          ctx.beginPath(); ctx.arc([x1,x2][i/2],[y1,y2][i/2],3,0,TAU); ctx.fill();
        }
      });
      ctx.restore();
    }

    /* ════════════════════════════════════════════════════════
       SCENE 4 — LEADERBOARD: #1 rank achievement
    ════════════════════════════════════════════════════════ */
    var s4T=0, s4Spawned=false, s4Enter=0;
    function initS4(){ s4T=0; s4Spawned=false; s4Enter=0; particles.length=0; }

    function drawS4(st,dt) {
      s4T+=dt;
      s4Enter=clamp(s4Enter+dt*2.2,0,1);
      var ea4=eOut5(s4Enter);

      if(!s4Spawned && s4T>0.2){
        s4Spawned=true;
        var cols=['#a78bfa','#f472b6','#fb923c','#fde047','#34d399'];
        for(var ci=0;ci<45;ci++){
          spawnP(rand(W*0.1,W*0.9), rand(-35,10),
            rand(-38,38), rand(65,200),
            cols[rInt(0,cols.length)], rand(1.5,3.5), rand(3,8), 'dot');
        }
      }

      /* Crown glow */
      var cwY=CY-H*0.26;
      var cwGlow=ctx.createRadialGradient(CX,cwY,0,CX,cwY,W*0.4);
      cwGlow.addColorStop(0,'rgba(253,224,71,0.20)');
      cwGlow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=cwGlow; ctx.fillRect(0,0,W,H);

      /* Trophy */
      var ts=ea4;
      var bob=Math.sin(s4T*1.6)*4;
      ctx.save();
      ctx.translate(CX, cwY+bob);
      ctx.scale(ts,ts);
      ctx.font=Math.floor(Math.min(W,H)*0.13)+'px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.shadowColor='#fde047'; ctx.shadowBlur=55;
      ctx.fillText('🏆', 0, 0);
      ctx.restore();

      /* Rank #1 badge */
      if(s4T>0.4){
        var rnkA=clamp((s4T-0.4)/0.5,0,1)*ea4;
        ctx.save(); ctx.globalAlpha=rnkA;
        var rnkG=ctx.createLinearGradient(CX-48,0,CX+48,0);
        rnkG.addColorStop(0,'rgba(253,224,71,0.22)'); rnkG.addColorStop(1,'rgba(251,146,60,0.18)');
        ctx.fillStyle=rnkG; ctx.strokeStyle='rgba(253,224,71,0.50)'; ctx.lineWidth=1.2;
        ctx.shadowColor='rgba(253,224,71,0.4)'; ctx.shadowBlur=18;
        rr(CX-48, cwY+Math.min(W,H)*0.115, 96, 22, 11); ctx.fill(); ctx.stroke();
        ctx.fillStyle='rgba(255,255,255,0.92)';
        ctx.font='bold 10px "Space Grotesk",sans-serif'; ctx.textAlign='center';
        ctx.textBaseline='middle'; ctx.shadowBlur=0;
        ctx.fillText('✦ RANK #1 IN INDIA ✦', CX, cwY+Math.min(W,H)*0.115+11);
        ctx.restore();
      }

      /* Leaderboard rows */
      var rows=[
        {rank:1, name:'You',   score:2480, c:'#fde047', emoji:'🥇', hl:true},
        {rank:2, name:'Aarav', score:2340, c:'#c0c0c0', emoji:'🥈', hl:false},
        {rank:3, name:'Priya', score:2210, c:'#cd7f32', emoji:'🥉', hl:false}
      ];
      var rowH=36, rowW=Math.min(W*0.78,278), rowX=CX-rowW/2;
      var startY=CY-H*0.04;

      rows.forEach(function(row,ri) {
        var rowA=clamp((s4T-0.3-ri*0.16)/0.45,0,1)*ea4;
        var rx=lerp(-rowW, rowX, eOut5(rowA));
        var ry=startY+ri*rowH*1.1;
        ctx.save(); ctx.globalAlpha=rowA;
        if(row.hl){
          var hlGr=ctx.createLinearGradient(rx,ry,rx+rowW,ry+rowH-4);
          hlGr.addColorStop(0,'rgba(253,224,71,0.20)');
          hlGr.addColorStop(1,'rgba(251,146,60,0.14)');
          ctx.fillStyle=hlGr; ctx.strokeStyle='rgba(253,224,71,0.50)'; ctx.lineWidth=1.2;
          ctx.shadowColor='rgba(253,224,71,0.32)'; ctx.shadowBlur=16;
        } else {
          ctx.fillStyle='rgba(255,255,255,0.04)';
          ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=1; ctx.shadowBlur=0;
        }
        rr(rx,ry,rowW,rowH-4,10); ctx.fill(); ctx.stroke();
        ctx.font='14px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(row.emoji, rx+10, ry+rowH*0.5-2);
        ctx.font=row.hl?'bold 12px "Space Grotesk",sans-serif':'12px "Space Grotesk",sans-serif';
        ctx.fillStyle=row.hl?'#fff':'rgba(255,255,255,0.60)';
        ctx.shadowBlur=0; ctx.fillText(row.name, rx+36, ry+rowH*0.5-2);
        ctx.font='bold 12px "Space Grotesk",sans-serif';
        ctx.fillStyle=row.c; ctx.textAlign='right';
        ctx.fillText(row.score.toLocaleString('en-IN'), rx+rowW-12, ry+rowH*0.5-2);
        ctx.restore();
      });

      /* XP badge */
      if(s4T>1.5){
        var xpA=clamp((s4T-1.5)/0.4,0,1)*ea4;
        var xp=Math.floor(Math.min((s4T-1.5)/1.5,1)*500);
        ctx.save(); ctx.globalAlpha=xpA;
        var xpG=ctx.createLinearGradient(CX-44,0,CX+44,0);
        xpG.addColorStop(0,'#6d28d9'); xpG.addColorStop(1,'#f472b6');
        ctx.fillStyle=xpG; ctx.shadowColor='rgba(109,40,217,0.55)'; ctx.shadowBlur=20;
        rr(CX-46,CY+H*0.26,92,28,14); ctx.fill();
        ctx.fillStyle='#fff'; ctx.font='bold 11.5px "Space Grotesk",sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.shadowBlur=0;
        ctx.fillText('+'+xp+' XP earned', CX, CY+H*0.26+14);
        ctx.restore();
      }
      tickP(dt); drawP();
    }

    /* ════════════════════════════════════════════════════════
       SCENE 5 — LIVE STUDY NETWORK: collaborative hub
    ════════════════════════════════════════════════════════ */
    var s5T=0, s5Enter=0;
    function initS5(){ s5T=0; s5Enter=0; particles.length=0; }

    function drawS5(st,dt) {
      s5T+=dt;
      s5Enter=clamp(s5Enter+dt*1.8,0,1);
      var ea5=eOut5(s5Enter);

      /* Hub glow */
      var hubGlow=ctx.createRadialGradient(CX,CY,0,CX,CY,W*0.38);
      hubGlow.addColorStop(0,'rgba(109,40,217,0.14)');
      hubGlow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=hubGlow; ctx.fillRect(0,0,W,H);

      var n=6, ringR=Math.min(W,H)*0.30;
      var COLORS=['#a78bfa','#f472b6','#fb923c','#34d399','#38bdf8','#fde047'];
      var EMOJIS=['🎓','👨‍💻','👩‍🎓','🧑‍🏫','📚','⚡'];
      var NAMES=['Arjun','Neha','Vikram','Siya','Rahul','Meera'];

      for(var gi=0;gi<n;gi++){
        var nodeDelay=gi*0.12;
        var nodeAlpha5=clamp((s5Enter-nodeDelay)*1.6,0,1);
        var ga=gi*(TAU/n)-TAU/4+s5T*0.28;
        var gx=CX+Math.cos(ga)*ringR;
        var gy=CY+Math.sin(ga)*ringR;
        /* Interpolate from center outward on enter */
        var gxA=lerp(CX,gx,eOut5(nodeAlpha5));
        var gyA=lerp(CY,gy,eOut5(nodeAlpha5));
        var gc=COLORS[gi];

        /* Connector */
        var conA=(0.18+Math.sin(s5T*1.2+gi)*0.08)*nodeAlpha5;
        ctx.save(); ctx.globalAlpha=conA;
        ctx.strokeStyle=gc; ctx.lineWidth=1.1; ctx.setLineDash([4,9]);
        ctx.shadowColor=gc; ctx.shadowBlur=4;
        ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(gxA,gyA); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();

        /* Data packet */
        var fp=(s5T*0.68+gi*0.18)%1;
        var fpx=lerp(CX,gxA,fp), fpy=lerp(CY,gyA,fp);
        ctx.save(); ctx.globalAlpha=(1-Math.abs(fp-0.5)*2)*0.75*nodeAlpha5;
        ctx.fillStyle=gc; ctx.shadowColor=gc; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.arc(fpx,fpy,2.5,0,TAU); ctx.fill();
        ctx.restore();

        /* Avatar node */
        ctx.save(); ctx.globalAlpha=nodeAlpha5;
        ctx.shadowColor=gc; ctx.shadowBlur=22;
        var nodeG5=ctx.createRadialGradient(gxA-8,gyA-8,3,gxA,gyA,20);
        nodeG5.addColorStop(0,gc+'ee'); nodeG5.addColorStop(1,gc+'28');
        ctx.fillStyle=nodeG5; ctx.strokeStyle=gc+'88'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.arc(gxA,gyA,20,0,TAU); ctx.fill(); ctx.stroke();
        ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.shadowBlur=0; ctx.fillText(EMOJIS[gi],gxA,gyA);
        /* Pulse ring */
        var pp3=(s5T*0.82+gi*0.2)%1;
        ctx.globalAlpha=(1-pp3)*0.22*nodeAlpha5;
        ctx.strokeStyle=gc; ctx.lineWidth=1.3;
        ctx.beginPath(); ctx.arc(gxA,gyA,20+pp3*16,0,TAU); ctx.stroke();
        /* Name */
        ctx.globalAlpha=(0.52+Math.sin(s5T*0.6+gi)*0.12)*nodeAlpha5;
        ctx.fillStyle=gc; ctx.shadowColor=gc; ctx.shadowBlur=4;
        ctx.font='bold 7.5px "Space Grotesk",sans-serif'; ctx.textAlign='center';
        ctx.textBaseline='top'; ctx.fillText(NAMES[gi], gxA, gyA+24);
        ctx.restore();
      }

      /* Central hub */
      ctx.save(); ctx.globalAlpha=ea5;
      ctx.shadowColor='#a78bfa'; ctx.shadowBlur=45;
      var hubG5=ctx.createRadialGradient(CX-10,CY-10,5,CX,CY,28);
      hubG5.addColorStop(0,'#d8b4fe'); hubG5.addColorStop(1,'#7c3aed');
      ctx.fillStyle=hubG5;
      ctx.beginPath(); ctx.arc(CX,CY,28,0,TAU); ctx.fill();
      ctx.strokeStyle='rgba(167,139,250,0.65)'; ctx.lineWidth=1.8;
      ctx.beginPath(); ctx.arc(CX,CY,32,0,TAU); ctx.stroke();
      ctx.font='18px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.shadowBlur=0; ctx.fillText('🤖',CX,CY);
      ctx.restore();

      /* Live message bubbles */
      var MSGS=['Great answer! 🎉','Score: 94%','Level 8 reached','#1 in batch!'];
      MSGS.forEach(function(msg,mi){
        var mt=((s5T*0.52+mi*0.70)%1);
        var ma=mt<0.12?mt/0.12:mt>0.82?(1-(mt-0.82)/0.18):1;
        var angle=(mi*(TAU/4))+s5T*0.17;
        var mx2=CX+Math.cos(angle)*W*0.38;
        var my2=CY+Math.sin(angle)*H*0.30;
        ctx.save(); ctx.globalAlpha=ma*0.72*ea5;
        ctx.font='7.5px "Plus Jakarta Sans",sans-serif';
        var mw=ctx.measureText(msg).width+22;
        ctx.fillStyle='rgba(109,40,217,0.20)'; ctx.strokeStyle='rgba(167,139,250,0.40)'; ctx.lineWidth=1;
        rr(mx2-mw/2,my2-10,mw,20,10); ctx.fill(); ctx.stroke();
        ctx.fillStyle='rgba(248,247,255,0.84)'; ctx.textAlign='center';
        ctx.fillText(msg,mx2,my2+4);
        ctx.restore();
      });

      /* Active users counter */
      var uY=CY+Math.min(W,H)*0.32;
      ctx.save(); ctx.globalAlpha=0.85*ea5;
      ctx.fillStyle='rgba(109,40,217,0.14)'; ctx.strokeStyle='rgba(167,139,250,0.32)'; ctx.lineWidth=1.2;
      rr(CX-68,uY-14,136,28,14); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.78)';
      ctx.font='bold 10.5px "Space Grotesk",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('👥 ' + (1243+Math.floor(s5T*3)) + ' students online', CX, uY);
      ctx.restore();

      tickP(dt); drawP();
    }

    /* ── Scene transition flash ── */
    function triggerSceneFlash() {
      if(!flashEl) return;
      flashEl.style.transition = 'none';
      flashEl.style.opacity = '0.25';
      setTimeout(function(){
        flashEl.style.transition = 'opacity 0.5s ease';
        flashEl.style.opacity = '0';
      }, 40);
    }

    /* ── Scenes registry ── */
    var SCENES=[
      {chip:'📷 Step 1', title:'Snap a <span class="hl">Question</span>',       desc:'Photo, PDF or type — CrackAI understands everything',          draw:drawS1, init:initS1},
      {chip:'🧠 Step 2', title:'<span class="hl">AI Solves</span> It Live',     desc:'Step-by-step reasoning · 98% accuracy · Hindi & English',       draw:drawS2, init:initS2},
      {chip:'⚔️ Step 3', title:'Enter the <span class="hl">Arena</span>',        desc:'Challenge friends. Answer faster. Climb the ranks',              draw:drawS3, init:initS3},
      {chip:'🏆 Step 4', title:'You <span class="hl">Ranked #1</span>',          desc:'Track streaks, earn XP, and unlock achievements daily',          draw:drawS4, init:initS4},
      {chip:'👥 Step 5', title:'Live <span class="hl">Study Network</span>',     desc:'1,200+ groups active now — learn together, win together',        draw:drawS5, init:initS5}
    ];

    var sceneIdx=0, sceneElapsed=0, SCENE_DUR=8.5;
    var fadingOut=false, transAlpha=1, nextSceneIdx=0;

    var chipEl    = document.getElementById('cai-scene-chip');
    var titleEl   = document.getElementById('cai-scene-title');
    var descEl    = document.getElementById('cai-scene-desc');
    var statsEl2  = document.getElementById('cai-live-stats');
    var dotsEl    = document.getElementById('cai-scene-dots');
    var dotsAll   = dotsEl ? dotsEl.querySelectorAll('.cai-dot') : [];

    function showHUD(idx){
      var sc=SCENES[idx];
      [chipEl,titleEl,descEl,statsEl2,dotsEl].forEach(function(el){ el && el.classList.remove('show'); });
      setTimeout(function(){
        if(chipEl)  chipEl.textContent=sc.chip;
        if(titleEl) titleEl.innerHTML=sc.title;
        if(descEl)  descEl.textContent=sc.desc.replace(/<[^>]+>/g,'');
        [chipEl,titleEl,descEl,statsEl2,dotsEl].forEach(function(el){ el && el.classList.add('show'); });
        dotsAll.forEach(function(d,i){ d.classList.toggle('active',i===idx); });
      }, 200);
    }
    showHUD(0);

    /* ── Main render loop ── */
    var elapsed2=0, lastTs2=null, rafId2=null;

    function renderLoop(ts){
      rafId2=requestAnimationFrame(renderLoop);
      var authEl2=document.getElementById('authScreen');
      if(authEl2 && authEl2.classList.contains('hidden')) return;
      if(!lastTs2) lastTs2=ts;
      var dt=Math.min((ts-lastTs2)/1000,0.05);
      lastTs2=ts; elapsed2+=dt; sceneElapsed+=dt;

      /* Scene transition */
      if(sceneElapsed>=SCENE_DUR && !fadingOut){
        fadingOut=true;
        nextSceneIdx=(sceneIdx+1)%SCENES.length;
      }
      if(fadingOut){
        transAlpha=Math.max(0,transAlpha-dt*3.8);
        if(transAlpha<=0){
          triggerSceneFlash();
          sceneIdx=nextSceneIdx; sceneElapsed=0;
          fadingOut=false; transAlpha=0;
          SCENES[sceneIdx].init();
          showHUD(sceneIdx);
        }
      } else {
        transAlpha=Math.min(1,transAlpha+dt*3.4);
      }

      /* Progress bar */
      if(statusFill) statusFill.style.width=(Math.min(sceneElapsed/SCENE_DUR,1)*100)+'%';

      ctx.clearRect(0,0,W,H);
      drawBG(elapsed2);
      ctx.save(); ctx.globalAlpha=transAlpha;
      SCENES[sceneIdx].draw(sceneElapsed,dt);
      ctx.restore();
    }

    function startAnim(){
      if(!rafId2) renderLoop(performance.now());
    }
    setTimeout(startAnim,200);
    var splashObs2=new MutationObserver(function(ml){
      ml.forEach(function(){
        if(!document.getElementById('sscIntroOverlay')){ splashObs2.disconnect(); startAnim(); }
      });
    });
    splashObs2.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();

})();