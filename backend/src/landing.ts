/** Landing page served at GET /. Self-contained; all dynamic data is rendered with textContent. */
export function landingHtml(): string {
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trust Passport · reputation for AI agents that spend money</title>
<meta name="description" content="A portable 0-100 trust score for AI agents, built from clean, policy-compliant spend history.">
<meta name="theme-color" content="#0A0A0F">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%237D00FF'/%3E%3Cpath d='M9 16.5l4.5 4.5L23 11' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#0A0A0F;--card:#14141D;--line:#26263A;--mut:#9A9AB0;--brand:#7D00FF;--soft:#B07CFF}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(900px 500px at 85% -10%,rgba(125,0,255,.35),transparent 60%),var(--bg);color:#fff;font:16px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{max-width:880px;margin:0 auto;padding:0 20px}
nav{display:flex;justify-content:space-between;align-items:center;padding:20px 0}
.brand{display:flex;gap:10px;align-items:center;font-weight:700;text-decoration:none}
.logo{width:28px;height:28px;border-radius:9px;background:var(--brand);display:grid;place-items:center}
.btn{display:inline-block;border:0;cursor:pointer;background:var(--brand);color:#fff;font:600 15px Inter,sans-serif;padding:13px 22px;border-radius:999px;text-decoration:none;transition:filter .15s,transform .15s}
.btn:hover{filter:brightness(1.15)}.btn:active{transform:scale(.97)}
.ghost{background:transparent;border:1px solid var(--line)}.sm{padding:9px 16px;font-size:14px}
:focus-visible{outline:3px solid var(--soft);outline-offset:2px}
.hero{padding:44px 0 28px}.eyebrow{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13px;color:var(--soft);font-weight:600}
h1{font-size:clamp(34px,8vw,64px);line-height:1.04;letter-spacing:-.035em;margin:18px 0 14px;font-weight:800}
.hero p{color:var(--mut);font-size:clamp(16px,2.4vw,19px);max-width:600px;margin:0 0 24px}.cta{display:flex;gap:12px;flex-wrap:wrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:20px;margin:20px 0}
h2{font-size:22px;letter-spacing:-.02em;margin:34px 0 0;display:flex;align-items:center;gap:12px}
label{font-weight:600;font-size:14px;color:var(--mut)}.row{display:flex;gap:10px;margin-top:8px}
input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--line);color:#fff;border-radius:999px;padding:13px 20px;font:500 16px Inter,sans-serif}
input:focus{border-color:var(--brand);outline:3px solid rgba(125,0,255,.35)}
.chip{display:inline-block;border-radius:999px;padding:3px 12px;font-size:13px;font-weight:700}
.live{font-size:13px;color:var(--mut);font-weight:500;display:flex;align-items:center;gap:6px}
.live i{width:8px;height:8px;border-radius:50%;background:#2FD6A0;animation:p 1.6s infinite}
@keyframes p{50%{opacity:.3}}@media(prefers-reduced-motion:reduce){.live i{animation:none}html{scroll-behavior:auto}}
.res{display:flex;gap:22px;align-items:center;flex-wrap:wrap;margin-top:18px}.res h3{margin:0 0 6px;font-size:22px;word-break:break-all}
.res p{color:var(--mut);margin:8px 0 0;max-width:420px}.grid{display:flex;gap:26px;flex-wrap:wrap;margin-top:18px}
.grid b{display:block;font-size:22px}.grid span{font-size:12px;color:var(--mut)}
.share{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}.share img{max-width:100%;border-radius:16px;margin-top:14px}
.lb{padding:6px 20px}.lr{display:flex;align-items:center;gap:12px;width:100%;background:none;border:0;border-bottom:1px solid var(--line);color:#fff;font:500 15px Inter,sans-serif;padding:14px 0;cursor:pointer;text-align:left}
.lr:last-child{border:0}.lr:hover .id{color:var(--soft)}.rk{width:22px;color:var(--mut)}.id{flex:1;font-weight:600;word-break:break-all}
.sc{width:34px;text-align:right;font-weight:800}.vol{width:74px;text-align:right;color:var(--mut);font-size:14px}
@media(max-width:480px){.vol{display:none}}
.demo{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--soft);border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-left:8px;vertical-align:middle}
.empty,.err{color:var(--mut);padding:18px 0;text-align:center}.err{color:#FF8A98}
footer{color:var(--mut);font-size:13px;padding:30px 0 50px}
</style></head><body><div class="wrap">
<nav><a class="brand" href="/"><span class="logo"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Trust Passport</a><a class="btn sm" href="#lookup">Look up an agent</a></nav>
<header class="hero"><span class="eyebrow">PayBox plugin · MoonPay Hackathon</span>
<h1>Know which AI agents deserve your money.</h1>
<p>A portable 0&ndash;100 reputation score for agents that spend. Built from clean, policy-compliant spend history, so any service can decide how much to trust an agent before it pays.</p>
<div class="cta"><a class="btn" href="#lookup">Look up an agent</a><a class="btn ghost" href="#board">See the leaderboard</a></div></header>
<main>
<section id="lookup" class="card"><form id="f"><label for="q">Agent ID</label>
<div class="row"><input id="q" placeholder="e.g. test-agent" autocomplete="off" autocapitalize="off" maxlength="128"><button class="btn" type="submit">Look up</button></div></form>
<div id="out" aria-live="polite"></div></section>
<section id="board" aria-labelledby="lbh"><h2 id="lbh">Leaderboard <span class="live"><i></i>Live</span></h2><div id="rows" class="card lb"><div class="empty">Loading&hellip;</div></div></section>
</main>
<footer>Scores are self-reported in this MVP and not independently verified. score = min(100, spends &times; 8 + volume &times; 2 + days active); any violation sets it to 0. Tiers: New &lt;20 &middot; Proven 20&ndash;49 &middot; Trusted 50&ndash;79 &middot; Elite 80+.</footer>
</div>
<script>
var ID=/^[A-Za-z0-9_.:-]{1,128}$/,COL={New:'#8A8AA3',Proven:'#B07CFF',Trusted:'#7D00FF',Elite:'#2FD6A0'},$=function(i){return document.getElementById(i)};
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function chip(t,s){var v=s==='violated',e=el('span','chip',v?'Violated':t);e.style.background=v?'#FF5A6E':COL[t];e.style.color=!v&&(t==='Elite'||t==='Proven')?'#06140F':'#fff';return e}
function money(n){return '$'+Number(n).toLocaleString(undefined,{maximumFractionDigits:2})}
function api(u){return fetch(u).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})}
function ring(p){var C=2*Math.PI*54,c=p.status==='violated'?'#FF5A6E':COL[p.tier],s=Number(p.score),d=el('div');
d.innerHTML='<svg width="132" height="132" viewBox="-66 -66 132 132" role="img" aria-label="Score '+s+' of 100"><circle r="54" fill="none" stroke="#26263A" stroke-width="12"/><circle r="54" fill="none" stroke="'+c+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+(s/100*C).toFixed(1)+' '+C.toFixed(1)+'" transform="rotate(-90)"/><text y="9" font-size="34" font-weight="800" text-anchor="middle" fill="#fff" font-family="Inter,sans-serif">'+s+'</text><text y="28" font-size="11" text-anchor="middle" fill="#9A9AB0" font-family="Inter,sans-serif">/ 100</text></svg>';return d}
function copy(txt,b){var done=function(){b.textContent='Copied \u2713';setTimeout(function(){b.textContent=b.dataset.t},1800)};
if(navigator.clipboard)navigator.clipboard.writeText(txt).then(done,function(){prompt('Copy:',txt)});else prompt('Copy:',txt)}
function stat(v,l){var d=el('div');d.appendChild(el('b',0,v));d.appendChild(el('span',0,l));return d}
function show(p){var o=$('out');o.textContent='';var r=el('div','res'),i=el('div'),id=p.grantId;r.appendChild(ring(p));
var h=el('h3',0,id);if(id.indexOf('demo-')===0)h.appendChild(el('span','demo','DEMO'));i.appendChild(h);i.appendChild(chip(p.tier,p.status));i.appendChild(el('p',0,p.summary));r.appendChild(i);o.appendChild(r);
var g=el('div','grid');g.appendChild(stat(p.successfulSpends,'clean spends'));g.appendChild(stat(money(p.cleanVolumeUsd),'clean volume'));g.appendChild(stat(p.daysActive,'days active'));g.appendChild(stat(p.verifiedSpends||0,'verified on-chain'));o.appendChild(g);
var s=el('div','share'),md='![Trust Passport]('+location.origin+'/badge/'+encodeURIComponent(id)+'.svg)',lk=location.origin+'/#agent='+encodeURIComponent(id);
[['Copy badge markdown',md],['Copy share link',lk]].forEach(function(a){var b=el('button','btn ghost sm',a[0]);b.type='button';b.dataset.t=a[0];b.onclick=function(){copy(a[1],b)};s.appendChild(b)});
var im=el('img');im.src='/card/'+encodeURIComponent(id)+'.svg';im.alt='Trust Passport card for '+id;im.width=600;im.height=315;s.appendChild(im);o.appendChild(s)}
function lookup(id){id=(id||'').trim();var o=$('out');if(!ID.test(id)){o.textContent='';o.appendChild(el('div','err','Use 1\u2013128 letters, numbers, or _ . : -'));return}
$('q').value=id;history.replaceState(null,'','#agent='+encodeURIComponent(id));o.textContent='';o.appendChild(el('div','empty','Looking up\u2026 (the service may be waking up)'));
api('/passport/'+encodeURIComponent(id)).then(show).catch(function(){o.textContent='';o.appendChild(el('div','err','Could not reach the passport service. Try again in a moment.'))})}
$('f').onsubmit=function(e){e.preventDefault();lookup($('q').value)};
function board(){api('/leaderboard?limit=10').then(function(d){var b=$('rows');b.textContent='';
if(d.hidden){b.appendChild(el('div','empty','The leaderboard is hidden by the operator.'));return}
if(!d.agents.length){b.appendChild(el('div','empty','No agents yet. Record the first clean spend and it appears here.'));return}
d.agents.forEach(function(a,n){var r=el('button','lr');r.type='button';r.appendChild(el('span','rk',n+1));var nm=el('span','id',a.agentId);if(a.agentId.indexOf('demo-')===0)nm.appendChild(el('span','demo','DEMO'));r.appendChild(nm);r.appendChild(chip(a.tier,a.status));r.appendChild(el('span','sc',a.score));r.appendChild(el('span','vol',money(a.cleanVolumeUsd)));
r.onclick=function(){lookup(a.agentId);$('lookup').scrollIntoView()};b.appendChild(r)})}).catch(function(){var b=$('rows');if(!b.children.length||b.firstChild.className==='empty'){b.textContent='';b.appendChild(el('div','err','Waking the service\u2026 retrying.'))}})}
board();setInterval(function(){if(!document.hidden)board()},15000);
var m=location.hash.match(/agent=([^&]+)/);if(m){try{lookup(decodeURIComponent(m[1]))}catch(e){}}
</script></body></html>`;
}
