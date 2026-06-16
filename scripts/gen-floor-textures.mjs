// Generates seamless, tileable floor textures as PNGs under public/floors/.
// Owned + brand-matched + seamless, so no external image dependency or licensing
// risk. Regenerate with:
//   node scripts/gen-floor-textures.mjs
//   cd public/floors && for f in *.png; do cwebp -q 82 "$f" -o "${f%.png}.webp" && rm "$f"; done
// The app references the .webp tiles (see FLOOR_TEXTURES in floor/page.tsx).
//
// All canvas drawing happens inside the page via an injected <script> that reads
// window.__TEX; we extract the result with page.$eval (no page.evaluate).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";

const OUT = new URL("../public/floors/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const TILES = {
  parquet_oak: { size: 240, fn: "herringbone", a: "#e3c79a", b: "#d3b27d", seam: "#9c7b4e", grain: "rgba(120,82,45,0.10)" },
  parquet_walnut: { size: 240, fn: "herringbone", a: "#7a5132", b: "#5d3a22", seam: "#2c1c10", grain: "rgba(196,149,106,0.10)" },
  cotto: { size: 200, fn: "cotto", a: "#cd7849", b: "#b65f37", grout: "#7a3c20" },
  marble: { size: 320, fn: "marble", base: "#f5f1ea", vein: "rgba(150,128,96,0.35)" },
  concrete: { size: 256, fn: "concrete", base: "#efe7da", spec: "rgba(120,100,70,0.06)" },
  sage: { size: 256, fn: "concrete", base: "#cdd8c2", spec: "rgba(70,90,60,0.07)" },
};

const DRAW = `
function draw(cfg){
  const S=cfg.size, c=document.getElementById('c'); c.width=S; c.height=S;
  const x=c.getContext('2d'); x.clearRect(0,0,S,S);
  const wrap=(d)=>{for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){x.save();x.translate(ox*S,oy*S);d();x.restore();}};
  if(cfg.fn==='herringbone'){
    const W=S/8,L=W*2;
    x.fillStyle=cfg.a;x.fillRect(0,0,S,S);
    const board=(cx,cy,ang,tone)=>wrap(()=>{x.save();x.translate(cx,cy);x.rotate(ang);
      x.fillStyle=tone;x.fillRect(-L/2,-W/2,L,W);
      x.strokeStyle=cfg.grain;x.lineWidth=1;
      for(let i=-L/2+3;i<L/2;i+=5){x.beginPath();x.moveTo(i,-W/2);x.lineTo(i,W/2);x.stroke();}
      x.strokeStyle=cfg.seam;x.lineWidth=1.5;x.strokeRect(-L/2,-W/2,L,W);x.restore();});
    const step=L;
    for(let row=-2;row*W<S+L;row++)for(let col=-2;col*step<S+L;col++){
      const bx=col*step+(row%2?step/2:0), by=row*W, tone=(row+col)%2?cfg.a:cfg.b;
      board(bx,by,((row+col)%2?1:-1)*Math.PI/4,tone);}
  } else if(cfg.fn==='cotto'){
    const N=4,T=S/N;
    const mix=(h1,h2,k)=>{const a=parseInt(h1.slice(1),16),b=parseInt(h2.slice(1),16);
      const f=(s)=>Math.round(((a>>s)&255)*(1-k)+((b>>s)&255)*k);return 'rgb('+f(16)+','+f(8)+','+f(0)+')';};
    for(let r=0;r<N;r++)for(let col=0;col<N;col++){
      const t=(r*7+col*13)%5/5; x.fillStyle=mix(cfg.a,cfg.b,t); x.fillRect(col*T,r*T,T,T);
      const g=x.createRadialGradient(col*T+T*0.3,r*T+T*0.3,2,col*T+T*0.3,r*T+T*0.3,T);
      g.addColorStop(0,'rgba(255,235,205,0.25)');g.addColorStop(1,'transparent');x.fillStyle=g;x.fillRect(col*T,r*T,T,T);}
    x.strokeStyle=cfg.grout;x.lineWidth=3;
    for(let i=0;i<=N;i++){x.beginPath();x.moveTo(i*T,0);x.lineTo(i*T,S);x.moveTo(0,i*T);x.lineTo(S,i*T);x.stroke();}
  } else if(cfg.fn==='marble'){
    x.fillStyle=cfg.base;x.fillRect(0,0,S,S);
    const vein=(yoff,amp,w)=>wrap(()=>{x.strokeStyle=cfg.vein;x.lineWidth=w;x.beginPath();
      for(let px=-S;px<=2*S;px+=6){const py=yoff+Math.sin(px/60)*amp+Math.sin(px/23)*(amp/3); px===-S?x.moveTo(px,py):x.lineTo(px,py);} x.stroke();});
    vein(S*0.35,40,2.2);vein(S*0.62,28,1.4);vein(S*0.8,50,1);
    // faint secondary hairline veins for richness (also wrapped)
    vein(S*0.2,18,0.7);vein(S*0.5,22,0.7);
  } else if(cfg.fn==='concrete'){
    x.fillStyle=cfg.base;x.fillRect(0,0,S,S);
    // fine speckle only — no corner gradient, so the tile wraps seamlessly.
    let seed=1234; const rnd=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
    for(let i=0;i<S*S/22;i++){const px=rnd()*S,py=rnd()*S,r=rnd()*1.3;
      x.fillStyle=rnd()>0.5?cfg.spec:'rgba(255,255,255,0.05)';x.beginPath();x.arc(px,py,r,0,7);x.fill();}
  }
  return c.toDataURL('image/png').split(',')[1];
}
window.__draw = draw;
`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent("<canvas id='c'></canvas>");
await page.addScriptTag({ content: DRAW });

for (const [name, cfg] of Object.entries(TILES)) {
  const data = await page.$eval("#c", (_c, cfg) => window.__draw(cfg), cfg);
  writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(data, "base64"));
  console.log("wrote", name);
}
await browser.close();
console.log("done");
