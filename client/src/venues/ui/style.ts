// Stile der Venue-Oberflächen (DS-Stil: zweiter „Bildschirm“ unten, dicke Rahmen, Pixel-Überschriften).
const CSS = /* css */ `
#venue-ds{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);width:min(760px,calc(100vw - 20px));max-height:min(54vh,520px);
  background:linear-gradient(#1c1030,#120a20);border:5px solid #ff3fa4;border-radius:18px;box-shadow:0 0 0 4px #1a1030,0 10px 30px rgba(0,0,0,.6);
  color:#fdf6ff;font:15px/1.35 'Trebuchet MS',sans-serif;z-index:60;display:none;flex-direction:column;overflow:hidden}
#venue-ds.casino{border-color:#e8c35a;background:linear-gradient(#2a0d18,#170810)}
#venue-ds.open{display:flex}
#venue-ds .vh{display:flex;align-items:center;gap:10px;padding:8px 14px;background:rgba(0,0,0,.35);border-bottom:3px solid rgba(255,255,255,.08)}
#venue-ds .vh b{font:900 17px 'Courier New',monospace;letter-spacing:1px;text-transform:uppercase;color:#ffd23a}
#venue-ds .vh .sp{flex:1}
#venue-ds .vh .chips{background:#0a0612;border:2px solid #e8c35a;border-radius:10px;padding:2px 10px;font-weight:bold;color:#ffd23a}
#venue-ds .vb{padding:10px 14px;overflow:auto;flex:1}
#venue-ds .vf{display:flex;gap:8px;flex-wrap:wrap;padding:8px 14px;border-top:3px solid rgba(255,255,255,.08);background:rgba(0,0,0,.25)}
#venue-ds button{font:bold 14px 'Trebuchet MS',sans-serif;color:#1a1030;background:#ffd23a;border:3px solid #1a1030;border-radius:10px;padding:6px 12px;cursor:pointer;box-shadow:0 3px 0 #1a1030}
#venue-ds button.alt{background:#3af2ff}#venue-ds button.pink{background:#ff3fa4;color:#fff}#venue-ds button.dim{background:#6a5a80;color:#eee}
#venue-ds button:disabled{opacity:.35;cursor:default}
#venue-ds button.sel,#venue-ds button.pad-focus{outline:4px solid #fff;outline-offset:1px}
#venue-ds .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0}
#venue-ds .muted{opacity:.7;font-size:13px}
#venue-ds .say{background:#fffdf4;color:#1a1030;border:3px solid #1a1030;border-radius:12px;padding:6px 10px;margin:6px 0;display:inline-block}
#venue-ds .tip{background:#0e2a18;border:2px dashed #7dff6a;color:#7dff6a;border-radius:10px;padding:4px 8px;font-size:13px}
#venue-ds .list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px}
#venue-ds .item{border:3px solid rgba(255,255,255,.15);border-radius:12px;padding:6px 8px;cursor:pointer;background:rgba(255,255,255,.04)}
#venue-ds .item.sel{border-color:#ffd23a;background:rgba(255,210,58,.12)}
#venue-ds canvas.lane{width:100%;height:210px;display:block;background:#0a0612;border-radius:12px;border:3px solid #3a2458}
/* Spielautomat */
.v-reels{display:flex;gap:10px;justify-content:center;margin:6px 0}
.v-reel{width:96px;height:104px;border:5px solid #1a1030;border-radius:14px;background:linear-gradient(#fff,#e8e0f0 45%,#fff);color:#1a1030;display:flex;align-items:center;justify-content:center;font:900 54px 'Trebuchet MS',sans-serif;box-shadow:inset 0 0 0 3px #e8c35a}
.v-reel.spin{animation:vreel .09s linear infinite;filter:blur(1.2px)}
@keyframes vreel{0%{transform:translateY(-6px)}100%{transform:translateY(6px)}}
.v-lever{width:22px;height:110px;position:relative;margin-left:8px}
.v-lever i{position:absolute;left:8px;top:10px;width:6px;height:80px;background:#b0b0c0;border-radius:3px;transform-origin:50% 100%;transition:transform .25s}
.v-lever i::before{content:'';position:absolute;left:-8px;top:-14px;width:22px;height:22px;border-radius:50%;background:#e0203a;border:3px solid #1a1030}
.v-lever.pull i{transform:rotateX(70deg) scaleY(.4)}
.v-win{text-align:center;font:900 22px 'Trebuchet MS',sans-serif;color:#ffd23a;min-height:28px;text-shadow:0 2px 0 #1a1030}
/* Karten (eigenes Comic-Design) */
.v-cards{display:flex;gap:6px;align-items:flex-end;min-height:84px}
.v-card{width:54px;height:78px;border-radius:9px;background:#fffdf4;border:3px solid #1a1030;color:#1a1030;display:flex;flex-direction:column;justify-content:space-between;padding:3px 5px;font:900 20px 'Trebuchet MS',sans-serif;box-shadow:3px 3px 0 rgba(0,0,0,.4);animation:vdeal .25s ease-out}
.v-card.red{color:#d0202a}.v-card .s{font-size:24px;text-align:center}.v-card .r2{transform:rotate(180deg);font-size:14px}
.v-card.back{background:repeating-linear-gradient(45deg,#ff3fa4 0 8px,#7a1f2e 8px 16px);}
@keyframes vdeal{from{transform:translateY(-30px) rotate(-12deg);opacity:0}to{transform:none;opacity:1}}
.v-seat{border:3px solid rgba(255,255,255,.12);border-radius:12px;padding:4px 6px;min-width:130px}
.v-seat.me{border-color:#ffd23a}.v-seat.turn{box-shadow:0 0 0 3px #3af2ff}
.v-total{display:inline-block;background:#1a1030;border-radius:8px;padding:0 6px;margin-left:4px;font-weight:bold}
.v-timer{height:6px;background:#3af2ff;border-radius:3px;transition:width .2s linear}
/* Roulette-Tableau */
.v-tab{display:grid;grid-template-columns:34px repeat(12,1fr) 40px;gap:2px;font-weight:bold;font-size:13px}
.v-tab div{border:2px solid #0e3a22;border-radius:5px;text-align:center;padding:5px 0;cursor:pointer;background:#1d6b44;position:relative;user-select:none}
.v-tab .r{background:#c0202a}.v-tab .k{background:#16161c}.v-tab .z{background:#1aa050;grid-row:span 3;display:flex;align-items:center;justify-content:center}
.v-tab .hit{outline:3px solid #ffd23a;z-index:1}
.v-tab .chip::after{content:attr(data-c);position:absolute;right:-4px;top:-6px;background:#ffd23a;color:#1a1030;border-radius:9px;font-size:10px;padding:0 4px;border:2px solid #1a1030}
.v-out{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;margin-top:3px}
.v-out div{border:2px solid #0e3a22;border-radius:5px;text-align:center;padding:4px 0;cursor:pointer;background:#1d6b44;font-weight:bold;font-size:13px;position:relative}
.v-ball{font:900 34px 'Trebuchet MS',sans-serif;display:inline-block;min-width:60px;text-align:center;border-radius:50%;padding:4px 8px;border:4px solid #e8c35a}
/* Derby */
.v-gators{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.v-gator{border:3px solid rgba(255,255,255,.15);border-radius:12px;padding:6px;cursor:pointer}
.v-gator.sel{border-color:#7dff6a;background:rgba(125,255,106,.1)}
/* Tanz */
.v-judge{font:900 26px 'Trebuchet MS',sans-serif;text-align:center;height:32px}
.v-hype{height:12px;background:#2a1840;border-radius:6px;overflow:hidden;border:2px solid #1a1030}
.v-hype i{display:block;height:100%;background:linear-gradient(90deg,#ff3fa4,#ffd23a);transition:width .15s}
.v-rank{font:900 64px 'Courier New',monospace;color:#ffd23a;text-shadow:0 4px 0 #ff3fa4;text-align:center}
#venue-fade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .28s;z-index:55}
#venue-fade.on{opacity:1}
#venue-flash{position:fixed;inset:0;pointer-events:none;z-index:54;opacity:0;transition:opacity .4s;background:radial-gradient(circle,rgba(255,210,58,.0) 30%,rgba(255,210,58,.55))}
#venue-flash.on{opacity:1}
`;
let done = false;
export function injectVenueCss() {
  if (done) return;
  done = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}
