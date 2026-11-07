document.addEventListener("DOMContentLoaded",()=>{
const p=location.pathname.split("/").pop()||"index.html";
document.querySelectorAll("aside.side a").forEach(a=>{if(a.getAttribute("href")===p)a.setAttribute("aria-current","page")});
document.querySelectorAll("pre").forEach(pre=>{
if(pre.querySelector(".copybtn"))return;
const b=document.createElement("button");b.className="copybtn";b.textContent="copy";b.setAttribute("aria-label","Copy code");
b.addEventListener("click",()=>{const t=pre.querySelector("code");if(!t)return;const s=t.innerText;
 if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(s).then(()=>{b.textContent="copied";setTimeout(()=>b.textContent="copy",1200)}).catch(()=>{fallback()})}else fallback();
 function fallback(){const r=document.createRange();r.selectNode(t);const w=window.getSelection();w.removeAllRanges();w.addRange(r);try{document.execCommand("copy");b.textContent="copied";setTimeout(()=>b.textContent="copy",1200)}catch(e){}w.removeAllRanges()}});
pre.appendChild(b)});
const inp=document.getElementById("search"),box=document.getElementById("results");
if(inp&&box&&typeof SEARCH_INDEX!=="undefined"){
const render=q=>{const s=q.trim().toLowerCase();const hits=s?SEARCH_INDEX.filter(i=>(i.title+" "+i.keywords).toLowerCase().includes(s)):[];box.innerHTML="";
 if(!s)return; if(!hits.length){box.innerHTML="<p>No matches.</p>";return}
 hits.forEach(i=>{const d=document.createElement("div");d.className="search-item";const a=document.createElement("a");a.href=i.href;a.textContent=i.title;d.appendChild(a);box.appendChild(d)})};
inp.addEventListener("input",()=>render(inp.value));render("");}
document.querySelectorAll("[data-tabs]").forEach(t=>{
const btns=t.querySelectorAll("[role=tab]"),panels=t.querySelectorAll("[role=tabpanel]");
const show=i=>{btns.forEach((b,j)=>{b.setAttribute("aria-selected",j===i?"true":"false");b.style.textDecoration=j===i?"underline":"none"});panels.forEach((p,j)=>p.hidden=j!==i)};
btns.forEach((b,i)=>b.addEventListener("click",()=>show(i)));show(0)})});
