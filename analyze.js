const fs=require("fs"),zlib=require("zlib");
const buf=fs.readFileSync("/workspace/chat-repo/assets/ct-heart-wings.png");
let pos=8,width,height,ct,idat=[];
while(pos<buf.length){const len=buf.readUInt32BE(pos);const t=buf.toString("ascii",pos+4,pos+8);const d=buf.slice(pos+8,pos+8+len);if(t==="IHDR"){width=d.readUInt32BE(0);height=d.readUInt32BE(4);ct=d[9];}else if(t==="IDAT")idat.push(d);else if(t==="IEND")break;pos+=12+len;}
const raw=zlib.inflateSync(Buffer.concat(idat));
const bpp=(ct===6)?4:3,stride=width*bpp;
function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:(pb<=pc?b:c);}
const out=Buffer.alloc(height*stride);const prev=Buffer.alloc(stride);
for(let y=0;y<height;y++){const f=raw[y*(stride+1)];const line=raw.slice(y*(stride+1)+1,y*(stride+1)+1+stride);const cur=out.slice(y*stride,y*stride+stride);for(let i=0;i<stride;i++){const a=i>=bpp?cur[i-bpp]:0;const b=prev[i];const c=i>=bpp?prev[i-bpp]:0;let v;switch(f){case 0:v=line[i];break;case 1:v=line[i]+a;break;case 2:v=line[i]+b;break;case 3:v=line[i]+((a+b)>>1);break;case 4:v=line[i]+paeth(a,b,c);break;default:v=line[i];}cur[i]=v&255;}cur.copy(prev);}
function px(x,y){const i=(y*width+x)*bpp;return [out[i],out[i+1],out[i+2],ct===6?out[i+3]:255];}
// wing detection: saturation-based + bluish, excluding white bg and neutral heart
function isWing(x,y){
  const [r,g,b,a]=px(x,y);
  if(a<200) return false;                       // background transparent? 
  // non-white distance
  const nw=Math.abs(r-255)+Math.abs(g-255)+Math.abs(b-255);
  if(nw<30) return false;                        // near-white (bg, heart body, wing highlight) -> background
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
  const sat=mx>0?((mx-mn)/mx):0;
  // colored = saturated (wing) ; heart is neutral gray (sat ~0)
  return sat>0.04;                               // bluish colored feathers
}
// Render mask grid
console.log("=== wing mask (saturation>0.04) ===");
for(let y=0;y<height;y+=5){let line="";for(let x=0;x<width;x+=5){line+=isWing(x,y)?"#":(nonW(x,y)?"+":".");}console.log(line.replace(/[#+]\s*$/,''));}
// helper nonW for neutral to show heart
function nonW(x,y){const [r,g,b,a]=px(x,y);return a>200 && (Math.abs(r-255)+Math.abs(g-255)+Math.abs(b-255))>30;}