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
  // Light: wide horizontal planks in a very light sand tone.
  planks_sand: { size: 300, fn: "planks", a: "#ece1ce", b: "#e2d4ba", seam: "rgba(150,120,80,0.28)", grain: "rgba(150,120,80,0.06)", plankH: 50, across: 3 },
  // Walnut: horizontal parquet planks.
  parquet_walnut: { size: 300, fn: "planks", a: "#7c5436", b: "#6b4528", seam: "rgba(30,18,8,0.4)", grain: "rgba(196,149,106,0.06)", plankH: 43, across: 3 },
  // Marble: few soft HORIZONTAL veins on a bright base.
  marble: { size: 360, fn: "marble", base: "#f8f5ef", veinDark: "rgba(110,98,80,0.45)", veinSoft: "rgba(150,135,110,0.16)" },
};

const DRAW = `
function draw(cfg){
  const S=cfg.size, c=document.getElementById('c'); c.width=S; c.height=S;
  const x=c.getContext('2d'); x.clearRect(0,0,S,S);
  const wrap=(d)=>{for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){x.save();x.translate(ox*S,oy*S);d();x.restore();}};
  if(cfg.fn==='planks'){
    // Horizontal wood planks. Rows of height plankH; each row split into long
    // boards with vertical end-joints, brick-offset row to row. Alternating board
    // tone + 2 faint grain lines. Tiles seamlessly (rows divide S; offsets wrap).
    const H=cfg.plankH, rows=Math.round(S/H), hh=S/rows;  // exact rows for clean wrap
    const boardW=S/(cfg.across||2);                       // boards across; offset → brick look
    for(let r=0;r<rows;r++){
      const y=r*hh, off=(r%2)*(boardW/2);
      for(let bx=-boardW;bx<S+boardW;bx+=boardW){
        const x0=bx+off, tone=((Math.round((bx+off)/boardW)+r)%2)?cfg.a:cfg.b;
        x.fillStyle=tone; x.fillRect(x0,y,boardW,hh);
        // grain (horizontal hairlines)
        x.strokeStyle=cfg.grain;x.lineWidth=1;
        x.beginPath();x.moveTo(x0,y+hh*0.35);x.lineTo(x0+boardW,y+hh*0.35);
        x.moveTo(x0,y+hh*0.7);x.lineTo(x0+boardW,y+hh*0.7);x.stroke();
        // end-joint (vertical seam)
        x.strokeStyle=cfg.seam;x.lineWidth=1.2;x.beginPath();x.moveTo(x0,y);x.lineTo(x0,y+hh);x.stroke();
      }
      // row seam (horizontal)
      x.strokeStyle=cfg.seam;x.lineWidth=1.4;x.beginPath();x.moveTo(0,y);x.lineTo(S,y);x.stroke();
    }
  } else if(cfg.fn==='marble'){
    // Bright base + a FEW soft horizontal veins. The sine periods divide S so the
    // curve meets itself at the left/right edges → seamless horizontal tiling.
    x.fillStyle=cfg.base;x.fillRect(0,0,S,S);
    x.lineCap='round';
    const TAU=Math.PI*2;
    // k1/k2 = integer wave counts across the tile (so it wraps); phase varies it.
    const vein=(yoff,amp,w,col,k1,k2,ph)=>{x.strokeStyle=col;x.lineWidth=w;x.beginPath();
      for(let px=0;px<=S;px+=4){const py=yoff+Math.sin(px/S*TAU*k1+ph)*amp+Math.sin(px/S*TAU*k2+ph)*amp*0.3;
        px===0?x.moveTo(px,py):x.lineTo(px,py);} x.stroke();};
    vein(S*0.34,17,5,cfg.veinSoft,1,3,0.4);    // soft ghost under the upper vein
    vein(S*0.34,15,2.4,cfg.veinDark,1,3,0.4);  // upper main vein
    vein(S*0.66,12,1.8,cfg.veinDark,1,2,2.1);  // lower vein, different phase
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
