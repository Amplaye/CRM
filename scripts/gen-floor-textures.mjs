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
  // Bigger boards + soft grain + faint seams → clean, not busy.
  parquet_oak: { size: 240, fn: "herringbone", a: "#e6cda4", b: "#dcbf8e", seam: "rgba(150,110,65,0.35)", grain: "rgba(120,82,45,0.05)" },
  parquet_walnut: { size: 240, fn: "herringbone", a: "#7c5436", b: "#664228", seam: "rgba(30,18,8,0.4)", grain: "rgba(196,149,106,0.05)" },
  cotto: { size: 200, fn: "cotto", a: "#cf7c4c", b: "#bd6840", grout: "rgba(110,55,30,0.6)" },
  marble: { size: 360, fn: "marble", base: "#f8f5ef", veinDark: "rgba(110,98,80,0.45)", veinSoft: "rgba(150,135,110,0.16)" },
  concrete: { size: 256, fn: "concrete", base: "#f2ebde", spec: "rgba(120,100,70,0.05)" },
  sage: { size: 256, fn: "concrete", base: "#cfdac4", spec: "rgba(70,90,60,0.06)" },
};

const DRAW = `
function draw(cfg){
  const S=cfg.size, c=document.getElementById('c'); c.width=S; c.height=S;
  const x=c.getContext('2d'); x.clearRect(0,0,S,S);
  const wrap=(d)=>{for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){x.save();x.translate(ox*S,oy*S);d();x.restore();}};
  if(cfg.fn==='herringbone'){
    // Big boards (few pieces) read calm, not busy; grain is just 2 faint lines.
    const W=S/4,L=W*2;
    x.fillStyle=cfg.a;x.fillRect(0,0,S,S);
    const board=(cx,cy,ang,tone)=>wrap(()=>{x.save();x.translate(cx,cy);x.rotate(ang);
      x.fillStyle=tone;x.fillRect(-L/2,-W/2,L,W);
      x.strokeStyle=cfg.grain;x.lineWidth=1;
      for(let i=-L/4;i<=L/4;i+=L/4){x.beginPath();x.moveTo(i,-W/2);x.lineTo(i,W/2);x.stroke();}
      x.strokeStyle=cfg.seam;x.lineWidth=1;x.strokeRect(-L/2,-W/2,L,W);x.restore();});
    const step=L;
    for(let row=-2;row*W<S+L;row++)for(let col=-2;col*step<S+L;col++){
      const bx=col*step+(row%2?step/2:0), by=row*W, tone=(row+col)%2?cfg.a:cfg.b;
      board(bx,by,((row+col)%2?1:-1)*Math.PI/4,tone);}
  } else if(cfg.fn==='cotto'){
    const N=4,T=S/N;
    const mix=(h1,h2,k)=>{const a=parseInt(h1.slice(1),16),b=parseInt(h2.slice(1),16);
      const f=(s)=>Math.round(((a>>s)&255)*(1-k)+((b>>s)&255)*k);return 'rgb('+f(16)+','+f(8)+','+f(0)+')';};
    for(let r=0;r<N;r++)for(let col=0;col<N;col++){
      const t=(r*7+col*13)%3/6; x.fillStyle=mix(cfg.a,cfg.b,t); x.fillRect(col*T,r*T,T,T);} // gentler tone variation
    x.strokeStyle=cfg.grout;x.lineWidth=2.5;
    for(let i=0;i<=N;i++){x.beginPath();x.moveTo(i*T,0);x.lineTo(i*T,S);x.moveTo(0,i*T);x.lineTo(S,i*T);x.stroke();}
  } else if(cfg.fn==='marble'){
    // Clean Carrara: bright base + a couple of BOLD defined diagonal veins with
    // a few soft branches. Few, deliberate lines — legible, not a tangle.
    x.fillStyle=cfg.base;x.fillRect(0,0,S,S);
    x.lineCap='round';
    // a flowing diagonal vein from one corner to the opposite, wrapped seamlessly
    const diagVein=(off,amp,w,col)=>wrap(()=>{x.strokeStyle=col;x.lineWidth=w;x.beginPath();
      for(let t=-S;t<=2*S;t+=8){const px=t, py=t*0.7+off+Math.sin(t/90)*amp; t===-S?x.moveTo(px,py):x.lineTo(px,py);} x.stroke();});
    diagVein(S*0.12,30,5,cfg.veinSoft);      // soft wide shadow under the main vein
    diagVein(-S*0.15,26,3,cfg.veinDark);     // main bold vein
    diagVein(S*0.45,20,1.8,cfg.veinDark);    // secondary vein
    diagVein(S*0.7,16,1,cfg.veinSoft);       // faint branch
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
