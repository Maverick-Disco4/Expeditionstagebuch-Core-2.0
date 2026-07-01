const STORE_KEY="expedition-core2-db";
let db, activeTrip, map=null, plannedLayer=null, poiLayer=null, stageMaps={};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const uid=p=>p+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);
const money=v=>Number(v||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
const today=()=>new Date().toISOString().slice(0,10);
const hasCoords=p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lon))&&Number(p.lat)!==0&&Number(p.lon)!==0;
const distM=(a,b)=>{const R=6371000,dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));};
const isSamePoint=(a,b)=>hasCoords(a)&&hasCoords(b)&&distM(a,b)<80;
const routeTime=s=>{const h=Math.floor((s||0)/3600),m=Math.round(((s||0)%3600)/60);return `${h}:${String(m).padStart(2,"0")} h`;};

async function init(){
  const stored=localStorage.getItem(STORE_KEY);
  db=stored?JSON.parse(stored):await fetch("data.json").then(r=>r.json());
  db.settings ||= {routeMode:"osrm",orsApiKey:""};
  activeTrip=db.trips.find(t=>t.id===db.activeTripId)||db.trips[0];
  normalizeAll();
  bind();
  renderAll();
  registerSW();
}
function save(){
  const slim=JSON.stringify(db);
  localStorage.setItem(STORE_KEY,slim);
}
function normalizeAll(){
  db.trips.forEach(t=>{
    t.stages ||= []; t.pois ||= []; t.journal ||= []; t.expenses ||= []; t.tracks ||= [];
    t.stages.forEach(s=>{
      s.type ||= isSamePoint(s.start,s.end) ? "stay" : "drive";
      s.route ||= null;
      if(s.route?.coords?.length>700) s.route.coords=simplify(s.route.coords,650);
    });
  });
}
function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  document.querySelectorAll("nav button[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  if(id==="mapView") setTimeout(initMainMap,150);
  if(id==="planning") setTimeout(rebuildStageMaps,180);
}
window.showView=showView;

function bind(){
  document.querySelectorAll("nav button[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $("quickAddBtn").onclick=()=>showView("journal");
  $("routeMode").value=db.settings.routeMode||"osrm";
  $("orsApiKey").value=db.settings.orsApiKey||"";
  $("routeMode").onchange=()=>{db.settings.routeMode=$("routeMode").value;save();};
  $("orsApiKey").onchange=()=>{db.settings.orsApiKey=$("orsApiKey").value.trim();save();};
  $("buildAllRoutesBtn").onclick=buildAllRoutes;
  $("addStageBtn").onclick=()=>editStage(null);
  $("fitMapBtn").onclick=()=>fitMainMap();
  $("clearRouteBtn").onclick=()=>{if(confirm("Alle gespeicherten Routen dieser Expedition löschen?")){activeTrip.stages.forEach(s=>s.route=null);save();renderAll();}};
  $("addJournalBtn").onclick=()=>editJournal(null);
  $("addPoiBtn").onclick=()=>editPoi(null);
  $("expenseForm").onsubmit=saveExpense;
  $("newTripBtn").onclick=newTrip;
  $("exportAllBtn").onclick=()=>downloadJSON(db,"expeditionstagebuch-core2-backup.json");
  $("importAllInput").onchange=e=>importJSON(e.target.files[0],data=>{if(!data.trips)throw new Error("Ungültiges Backup");db=data;activeTrip=db.trips.find(t=>t.id===db.activeTripId)||db.trips[0];normalizeAll();save();renderAll();});
}
function renderAll(){renderDashboard();renderTrips();renderPlanning();renderJournal();renderCash();if(map)setTimeout(drawMainMap,100);}
function routeKm(){return activeTrip.stages.reduce((sum,s)=>sum+(s.route?.distanceM?Number(s.route.distanceM)/1000:0),0);}
function costSum(){return activeTrip.expenses.reduce((s,e)=>s+Number(e.amount||0),0);}
function renderDashboard(){
  $("subline").textContent=activeTrip.name+" · Build 2026-06-08";
  $("dashName").textContent=activeTrip.name; $("dashMeta").textContent=activeTrip.subtitle||"";
  $("dashStages").textContent=activeTrip.stages.length; $("dashRouteKm").textContent=Math.round(routeKm())+" km"; $("dashPois").textContent=activeTrip.pois.length; $("dashCost").textContent=money(costSum());
  $("progressBar").style.width=Math.min(100,Math.round(activeTrip.stages.filter(s=>s.route||s.type==="stay").length/Math.max(1,activeTrip.stages.length)*100))+"%";
  const next=activeTrip.stages.find(s=>!s.route&&s.type!=="stay")||activeTrip.stages[0];
  $("nextStageTitle").textContent=next?.title||"Keine Etappe";
  $("nextStageMeta").textContent=next?`${next.date} · ${next.start.name} → ${next.end.name}`:"";
  const j=activeTrip.journal.at(-1); $("dashJournal").innerHTML=j?`<strong>${esc(j.title)}</strong><p>${esc(j.text||"")}</p>`:"Noch keine Einträge.";
  $("dashExpenses").innerHTML=activeTrip.expenses.length?`<h2>${money(costSum())}</h2>`:"Keine Ausgaben.";
}
function renderTrips(){
  $("tripList").innerHTML=db.trips.map(t=>`<div class="item"><strong>${esc(t.name)}</strong><br>${esc(t.subtitle||"")}<div class="action-row"><button onclick="selectTrip('${t.id}')">Öffnen</button><button class="danger" onclick="deleteTrip('${t.id}')">Löschen</button></div></div>`).join("");
}
window.selectTrip=id=>{activeTrip=db.trips.find(t=>t.id===id);db.activeTripId=id;save();destroyStageMaps();if(map){map.remove();map=null;}renderAll();showView("dashboard");};
window.deleteTrip=id=>{if(db.trips.length<2)return alert("Mindestens eine Expedition muss bleiben.");if(confirm("Expedition löschen?")){db.trips=db.trips.filter(t=>t.id!==id);db.activeTripId=db.trips[0].id;activeTrip=db.trips[0];save();renderAll();}};
function newTrip(){
  const name=prompt("Name der Expedition?"); if(!name)return;
  const t={id:uid("trip"),name,subtitle:"Neue Expedition",vehicle:"",startDate:today(),endDate:today(),stages:[],pois:[],journal:[],expenses:[],tracks:[]};
  db.trips.push(t); db.activeTripId=t.id; activeTrip=t; save(); renderAll(); showView("trips");
}

function chip(s){
  if(s.type==="stay")return `<span class="chip stay">Aufenthalt</span>`;
  if(s.route?.coords?.length)return `<span class="chip ok">Route gespeichert</span>`;
  if(!hasCoords(s.start)||!hasCoords(s.end))return `<span class="chip err">Koordinaten fehlen</span>`;
  return `<span class="chip warn">Route offen</span>`;
}
function renderPlanning(){
  $("stageList").innerHTML=activeTrip.stages.map((s,i)=>`
    <div class="stage" data-stage="${s.id}">
      <div class="stage-head"><div><strong>${i+1}. ${esc(s.title)}</strong><br>${esc(s.date)} · ${esc(s.start.name)} → ${esc(s.end.name)}<br>${chip(s)}</div><button class="secondary" onclick="editStage('${s.id}')">Bearbeiten</button></div>
      <div class="stage-points"><div><strong>Start</strong>${esc(s.start.name)}<br><small>${Number(s.start.lat).toFixed(5)}, ${Number(s.start.lon).toFixed(5)}</small></div><div><strong>Ziel</strong>${esc(s.end.name)}<br><small>${Number(s.end.lat).toFixed(5)}, ${Number(s.end.lon).toFixed(5)}</small></div></div>
      <div class="stage-meta"><div><strong>${s.route?.distanceM?Math.round(s.route.distanceM/1000):Number(s.plannedKm||0)} km</strong><small>${s.route?"echte Route":"Planwert"}</small></div><div><strong>${s.route?.durationS?routeTime(s.route.durationS):(s.plannedTime||"–")}</strong><small>${s.route?"Routingzeit":"Planzeit"}</small></div></div>
      <div class="mini-map" id="stageMap-${s.id}"></div>
      <div class="stage-actions"><button onclick="buildStageRoute('${s.id}',true)">Route laden</button><button class="secondary" onclick="openStageMap('${s.id}')">Große Karte</button><button class="secondary" onclick="moveStage('${s.id}',-1)">↑</button><button class="secondary" onclick="moveStage('${s.id}',1)">↓</button><button class="secondary" onclick="duplicateStage('${s.id}')">Duplizieren</button><button class="danger" onclick="deleteStage('${s.id}')">Löschen</button></div>
    </div>`).join("")||"<p>Noch keine Etappen.</p>";
  setTimeout(rebuildStageMaps,250);
}
function destroyStageMaps(){Object.values(stageMaps).forEach(m=>{try{m.remove();}catch(e){}});stageMaps={};}
function rebuildStageMaps(){
  destroyStageMaps();
  activeTrip.stages.forEach(s=>{
    const el=$("stageMap-"+s.id); if(!el)return;
    try{delete el._leaflet_id;}catch(e){}
    const m=L.map(el,{zoomControl:false,attributionControl:false}).setView([s.start.lat||46,s.start.lon||3],8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(m);
    stageMaps[s.id]=m;
    setTimeout(()=>{m.invalidateSize(true);drawStageMap(s.id);},200);
  });
}
function drawStageMap(id){
  const s=activeTrip.stages.find(x=>x.id===id),m=stageMaps[id]; if(!s||!m)return;
  m.eachLayer(l=>{if(l instanceof L.Marker||l instanceof L.Polyline)m.removeLayer(l);});
  if(!hasCoords(s.start))return;
  L.marker([s.start.lat,s.start.lon]).addTo(m).bindPopup(s.start.name);
  if(s.type==="stay"||isSamePoint(s.start,s.end)){m.setView([s.start.lat,s.start.lon],13);return;}
  if(hasCoords(s.end))L.marker([s.end.lat,s.end.lon]).addTo(m).bindPopup(s.end.name);
  const coords=s.route?.coords?.length?s.route.coords.map(c=>[c[1],c[0]]):[[s.start.lat,s.start.lon],[s.end.lat,s.end.lon]];
  const line=L.polyline(coords,{color:"#4e9cff",weight:4,opacity:s.route?0.95:0.55,dashArray:s.route?null:"6 6"}).addTo(m);
  try{m.fitBounds(line.getBounds(),{padding:[14,14]});}catch(e){}
}
function editStage(id){
  const s=id?activeTrip.stages.find(x=>x.id===id):{id:uid("stage"),type:"drive",date:"",title:"Neue Etappe",start:{name:"",lat:0,lon:0},end:{name:"",lat:0,lon:0},plannedKm:0,plannedTime:"",overnight:"",notes:"",route:null};
  const e=$("stageEditor"); e.hidden=false; e.className="editor";
  e.innerHTML=`<h3>${id?"Etappe bearbeiten":"Etappe hinzufügen"}</h3>
    <div class="two"><input id="st-title" value="${esc(s.title)}" placeholder="Titel"><select id="st-type"><option value="drive">Fahretappe</option><option value="stay">Aufenthalt/Rundtag</option></select></div>
    <div class="three"><input id="st-date" value="${esc(s.date)}" placeholder="Datum"><input id="st-km" type="number" value="${Number(s.plannedKm||0)}" placeholder="Plan-km"><input id="st-time" value="${esc(s.plannedTime||"")}" placeholder="Planzeit"></div>
    <input id="st-start-name" value="${esc(s.start.name)}" placeholder="Start Name">
    <div class="two"><input id="st-start-lat" type="number" step="0.000001" value="${Number(s.start.lat||0)}" placeholder="Start Lat"><input id="st-start-lon" type="number" step="0.000001" value="${Number(s.start.lon||0)}" placeholder="Start Lon"></div>
    <input id="st-end-name" value="${esc(s.end.name)}" placeholder="Ziel Name">
    <div class="two"><input id="st-end-lat" type="number" step="0.000001" value="${Number(s.end.lat||0)}" placeholder="Ziel Lat"><input id="st-end-lon" type="number" step="0.000001" value="${Number(s.end.lon||0)}" placeholder="Ziel Lon"></div>
    <input id="st-overnight" value="${esc(s.overnight||"")}" placeholder="Übernachtung">
    <textarea id="st-notes" placeholder="Notizen">${esc(s.notes||"")}</textarea>
    <div class="action-row"><button onclick="saveStage('${s.id}','${id?"update":"new"}')">Speichern</button><button class="secondary" onclick="$('stageEditor').hidden=true">Abbrechen</button></div>`;
  $("st-type").value=s.type;
  e.scrollIntoView({behavior:"smooth",block:"start"});
}
window.editStage=editStage;
window.saveStage=(id,mode)=>{
  const s=mode==="update"?activeTrip.stages.find(x=>x.id===id):{id};
  Object.assign(s,{type:$("st-type").value,date:$("st-date").value,title:$("st-title").value,start:{name:$("st-start-name").value,lat:Number($("st-start-lat").value||0),lon:Number($("st-start-lon").value||0)},end:{name:$("st-end-name").value,lat:Number($("st-end-lat").value||0),lon:Number($("st-end-lon").value||0)},plannedKm:Number($("st-km").value||0),plannedTime:$("st-time").value,overnight:$("st-overnight").value,notes:$("st-notes").value,route:null});
  if(mode==="new")activeTrip.stages.push(s);
  save(); $("stageEditor").hidden=true; renderAll();
};
window.moveStage=(id,d)=>{const a=activeTrip.stages,i=a.findIndex(s=>s.id===id),j=i+d;if(i<0||j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];save();renderAll();};
window.duplicateStage=id=>{const i=activeTrip.stages.findIndex(s=>s.id===id);if(i<0)return;const c=JSON.parse(JSON.stringify(activeTrip.stages[i]));c.id=uid("stage");c.title+=" (Kopie)";c.route=null;activeTrip.stages.splice(i+1,0,c);save();renderAll();};
window.deleteStage=id=>{if(confirm("Etappe löschen?")){activeTrip.stages=activeTrip.stages.filter(s=>s.id!==id);save();renderAll();}};
window.openStageMap=id=>{showView("mapView");setTimeout(()=>{const s=activeTrip.stages.find(x=>x.id===id);if(s&&map){if(s.route?.coords?.length){const b=L.latLngBounds(s.route.coords.map(c=>[c[1],c[0]]));map.fitBounds(b,{padding:[30,30]});}else map.fitBounds([[s.start.lat,s.start.lon],[s.end.lat,s.end.lon]],{padding:[30,30]});}},300);};

function simplify(coords,max=650){
  if(!Array.isArray(coords))return[];
  if(coords.length<=max)return coords.map(c=>[+Number(c[0]).toFixed(5),+Number(c[1]).toFixed(5)]);
  const step=Math.ceil(coords.length/max),out=[];
  for(let i=0;i<coords.length;i+=step)out.push([+Number(coords[i][0]).toFixed(5),+Number(coords[i][1]).toFixed(5)]);
  const last=[+Number(coords.at(-1)[0]).toFixed(5),+Number(coords.at(-1)[1]).toFixed(5)];
  if(out.at(-1)?.[0]!==last[0]||out.at(-1)?.[1]!==last[1])out.push(last);
  return out;
}
async function buildStageRoute(id,force=false){
  const s=activeTrip.stages.find(x=>x.id===id); if(!s)return false;
  if(s.type==="stay"||isSamePoint(s.start,s.end)){s.route=null;save();renderAll();return true;}
  if(!force&&s.route?.coords?.length){drawStageMap(id);return true;}
  try{
    $("batchStatus").textContent="Berechne: "+s.title;
    const res=db.settings.routeMode==="ors-avoid"?await fetchORS(s.start,s.end):db.settings.routeMode==="straight"?straightRoute(s.start,s.end):await fetchOSRM(s.start,s.end);
    s.route={mode:db.settings.routeMode,distanceM:res.distanceM,durationS:res.durationS,coords:simplify(res.coords,650),updatedAt:new Date().toISOString()};
    save(); renderAll(); return true;
  }catch(e){console.error(e);$("batchStatus").textContent="Fehler: "+s.title+" · "+e.message;return false;}
}
window.buildStageRoute=buildStageRoute;
async function buildAllRoutes(){
  let ok=0,total=activeTrip.stages.length;
  for(let i=0;i<total;i++){
    $("batchStatus").textContent=`Berechne ${i+1}/${total}: ${activeTrip.stages[i].title}`;
    const r=await buildStageRoute(activeTrip.stages[i].id,true); if(r)ok++;
    await new Promise(r=>setTimeout(r,250));
  }
  $("batchStatus").textContent=`Fertig: ${ok}/${total} Etappen geprüft/berechnet.`;
}
async function fetchOSRM(a,b){
  const url=`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=false`;
  const r=await fetch(url); if(!r.ok)throw new Error("OSRM "+r.status);
  const d=await r.json(); const route=d.routes?.[0]; if(!route)throw new Error("keine Route");
  return{coords:route.geometry.coordinates,distanceM:route.distance,durationS:route.duration};
}
async function fetchORS(a,b){
  if(!db.settings.orsApiKey)throw new Error("OpenRouteService API-Key fehlt");
  const body={coordinates:[[a.lon,a.lat],[b.lon,b.lat]],options:{avoid_features:["highways"]}};
  const r=await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson",{method:"POST",headers:{Authorization:db.settings.orsApiKey,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok)throw new Error("ORS "+r.status);
  const d=await r.json(); const f=d.features?.[0]; if(!f)throw new Error("keine Route");
  return{coords:f.geometry.coordinates,distanceM:f.properties.summary.distance,durationS:f.properties.summary.duration};
}
function straightRoute(a,b){return{coords:[[a.lon,a.lat],[b.lon,b.lat]],distanceM:distM(a,b),durationS:0};}

function initMainMap(){
  if(map){map.invalidateSize(true);drawMainMap();return;}
  map=L.map("map").setView([46,3],5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
  drawMainMap();
}
function drawMainMap(){
  if(!map)return;
  if(plannedLayer)plannedLayer.remove(); if(poiLayer)poiLayer.remove();
  const group=[];
  activeTrip.stages.forEach(s=>{
    if(s.route?.coords?.length){
      const line=L.polyline(s.route.coords.map(c=>[c[1],c[0]]),{color:"#4e9cff",weight:4}).addTo(map); group.push(line);
    }else if(hasCoords(s.start)&&hasCoords(s.end)&&s.type!=="stay"){
      const line=L.polyline([[s.start.lat,s.start.lon],[s.end.lat,s.end.lon]],{color:"#4e9cff",weight:3,opacity:.45,dashArray:"6 6"}).addTo(map); group.push(line);
    }
    if(hasCoords(s.start))group.push(L.marker([s.start.lat,s.start.lon]).addTo(map).bindPopup(s.start.name));
    if(hasCoords(s.end))group.push(L.marker([s.end.lat,s.end.lon]).addTo(map).bindPopup(s.end.name));
  });
  poiLayer=L.layerGroup(activeTrip.pois.filter(p=>hasCoords(p)).map(p=>L.marker([p.lat,p.lon]).bindPopup(p.name))).addTo(map);
  fitMainMap();
}
function fitMainMap(){
  if(!map)return;
  const pts=[];
  activeTrip.stages.forEach(s=>{if(hasCoords(s.start))pts.push([s.start.lat,s.start.lon]);if(hasCoords(s.end))pts.push([s.end.lat,s.end.lon]);});
  activeTrip.pois.forEach(p=>{if(hasCoords(p))pts.push([p.lat,p.lon]);});
  if(pts.length)map.fitBounds(pts,{padding:[30,30]});
}

function editJournal(id){
  const j=id?activeTrip.journal.find(x=>x.id===id):{id:uid("j"),date:today(),title:"",text:"",photoIds:[]};
  const e=$("journalEditor"); e.hidden=false; e.className="editor";
  e.innerHTML=`<h3>${id?"Journal bearbeiten":"Journal-Eintrag"}</h3><input id="j-date" value="${esc(j.date)}"><input id="j-title" value="${esc(j.title)}" placeholder="Titel"><textarea id="j-text" placeholder="Text">${esc(j.text||"")}</textarea><input id="j-photos" type="file" accept="image/*" multiple><div class="action-row"><button onclick="saveJournal('${j.id}','${id?"update":"new"}')">Speichern</button><button class="secondary" onclick="$('journalEditor').hidden=true">Abbrechen</button></div>`;
}
window.saveJournal=async(id,mode)=>{
  const j=mode==="update"?activeTrip.journal.find(x=>x.id===id):{id,photoIds:[]};
  j.date=$("j-date").value;j.title=$("j-title").value;j.text=$("j-text").value;
  const files=[...$("j-photos").files]; for(const f of files){const p=await storePhoto(f);j.photoIds.push(p.id);}
  if(mode==="new")activeTrip.journal.push(j); save(); $("journalEditor").hidden=true; renderAll();
};
async function editPoi(id){
  const p=id?activeTrip.pois.find(x=>x.id===id):{id:uid("poi"),name:"",category:"Camping",lat:0,lon:0,note:"",photoIds:[]};
  const name=prompt("POI Name",p.name); if(name===null)return;
  p.name=name; p.category=prompt("Kategorie",p.category)||p.category; p.note=prompt("Notiz",p.note)||p.note;
  p.lat=Number(prompt("Breitengrad",p.lat)||p.lat); p.lon=Number(prompt("Längengrad",p.lon)||p.lon);
  if(!id)activeTrip.pois.push(p); save(); renderAll();
}
async function storePhoto(file){
  const data=await resizeImage(file,900);
  const id=uid("photo");
  const old=JSON.parse(localStorage.getItem("expedition-core2-photos")||"{}");
  old[id]=data;
  try{localStorage.setItem("expedition-core2-photos",JSON.stringify(old));}catch(e){alert("Foto konnte wegen Speicherlimit nicht gespeichert werden.");}
  return{id};
}
function getPhoto(id){return JSON.parse(localStorage.getItem("expedition-core2-photos")||"{}")[id];}
function resizeImage(file,max){
  return new Promise((resolve,reject)=>{
    const img=new Image(),r=new FileReader();
    r.onload=()=>{img.onload=()=>{const scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);const ctx=c.getContext("2d");ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",0.72));};img.onerror=reject;img.src=r.result;};
    r.onerror=reject;r.readAsDataURL(file);
  });
}
function renderJournal(){
  $("journalList").innerHTML=activeTrip.journal.slice().reverse().map(j=>`<div class="item"><strong>${esc(j.date)} · ${esc(j.title)}</strong><p>${esc(j.text||"")}</p><div class="photo-grid">${(j.photoIds||[]).map(id=>`<img src="${getPhoto(id)||""}">`).join("")}</div><button class="danger" onclick="deleteJournal('${j.id}')">Löschen</button></div>`).join("")||"<p>Noch keine Einträge.</p>";
  $("poiList").innerHTML=activeTrip.pois.map(p=>`<div class="item"><strong>${esc(p.name)}</strong><br>${esc(p.category)} · ${p.lat}, ${p.lon}<p>${esc(p.note||"")}</p><button class="danger" onclick="deletePoi('${p.id}')">Löschen</button></div>`).join("")||"<p>Noch keine POIs.</p>";
}
window.deleteJournal=id=>{if(confirm("Eintrag löschen?")){activeTrip.journal=activeTrip.journal.filter(j=>j.id!==id);save();renderAll();}};
window.deletePoi=id=>{if(confirm("POI löschen?")){activeTrip.pois=activeTrip.pois.filter(p=>p.id!==id);save();renderAll();}};

function saveExpense(e){e.preventDefault();activeTrip.expenses.push({id:uid("exp"),date:today(),amount:Number($("expenseAmount").value||0),category:$("expenseCategory").value,note:$("expenseNote").value});save();e.target.reset();renderAll();}
function renderCash(){
  const cats={};activeTrip.expenses.forEach(e=>cats[e.category]=(cats[e.category]||0)+Number(e.amount||0));
  $("expenseSummary").innerHTML=`<h2>${money(costSum())}</h2>`+Object.entries(cats).map(([k,v])=>`<div class="item"><strong>${esc(k)}</strong><span style="float:right">${money(v)}</span></div>`).join("");
  $("expenseList").innerHTML=activeTrip.expenses.slice().reverse().map(e=>`<div class="item"><strong>${esc(e.category)}</strong><span style="float:right">${money(e.amount)}</span><br>${esc(e.date)} · ${esc(e.note||"")}<br><button class="danger" onclick="deleteExpense('${e.id}')">Löschen</button></div>`).join("")||"<p>Noch keine Ausgaben.</p>";
}
window.deleteExpense=id=>{if(confirm("Ausgabe löschen?")){activeTrip.expenses=activeTrip.expenses.filter(e=>e.id!==id);save();renderAll();}};

function downloadJSON(data,name){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));a.download=name;a.click();}
function importJSON(file,cb){if(!file)return;const r=new FileReader();r.onload=()=>{try{cb(JSON.parse(r.result));}catch(e){alert("Import fehlgeschlagen: "+e.message)}};r.readAsText(file);}
async function registerSW(){if("serviceWorker"in navigator)navigator.serviceWorker.register("./sw.js");}
let deferredPrompt;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false;});$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();deferredPrompt=null;$("installBtn").hidden=true;}};
window.addEventListener("resize",()=>{setTimeout(()=>{Object.values(stageMaps).forEach(m=>{try{m.invalidateSize(true)}catch(e){}});if(map)map.invalidateSize(true);},250);});

/* ===== Core 3.2 GPS & Tracking ===== */
let gpsWatchId=null,wakeLock=null,liveTrackLayer=null,liveMarker=null,savedTrackLayer=null,followLive=true;
let gpsState={active:false,paused:false,startedAt:null,elapsedBeforePause:0,points:[]};
function gpsDistanceKm(points){let sum=0;for(let i=1;i<points.length;i++)sum+=distM({lat:points[i-1].lat,lon:points[i-1].lon},{lat:points[i].lat,lon:points[i].lon})/1000;return sum;}
function gpsElapsedMs(){return gpsState.active?(gpsState.elapsedBeforePause||0)+(Date.now()-(gpsState.startedAt||Date.now())):(gpsState.elapsedBeforePause||0);}
function fmtDuration(ms){const t=Math.floor((ms||0)/1000),h=Math.floor(t/3600),m=Math.floor((t%3600)/60);return `${h}:${String(m).padStart(2,"0")} h`;}
function setGpsStatus(text){if($("gpsStatus"))$("gpsStatus").textContent=text;}
function renderGps(){if($("gpsKm"))$("gpsKm").textContent=gpsDistanceKm(gpsState.points).toFixed(2)+" km";if($("gpsTime"))$("gpsTime").textContent=fmtDuration(gpsElapsedMs());if($("gpsPoints"))$("gpsPoints").textContent=String(gpsState.points.length);if($("wakeLockState"))$("wakeLockState").textContent=wakeLock?"Display: aktiv":"Display: bereit";renderTracks();}
function renderTracks(){const list=$("trackList");if(!list)return;list.innerHTML=(activeTrip.tracks||[]).slice().reverse().map(t=>`<div class="item"><strong>${esc(t.name||"Track")}</strong><br>${esc(t.date||"")} · ${Number(t.km||0).toFixed(2)} km · ${fmtDuration(t.ms||0)} · ${t.points?.length||0} Punkte<div class="track-actions"><button class="secondary" onclick="showTrackOnMap('${t.id}')">Auf Karte</button><button class="secondary" onclick="exportTrackGpx('${t.id}')">GPX</button><button class="danger" onclick="deleteTrack('${t.id}')">Löschen</button></div></div>`).join("")||"<p>Noch keine Tracks.</p>";}
async function requestWake(){try{if("wakeLock"in navigator&&!wakeLock){wakeLock=await navigator.wakeLock.request("screen");wakeLock.addEventListener("release",()=>{wakeLock=null;renderGps();});}}catch(e){console.warn("Wake Lock nicht verfügbar",e)}renderGps();}
async function releaseWake(){try{if(wakeLock)await wakeLock.release();}catch(e){}wakeLock=null;renderGps();}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&gpsState.active&&!gpsState.paused)requestWake();});
function gpsStart(){if(!navigator.geolocation){alert("GPS wird von diesem Browser nicht unterstützt.");return;}if(gpsWatchId)navigator.geolocation.clearWatch(gpsWatchId);gpsState={active:true,paused:false,startedAt:Date.now(),elapsedBeforePause:0,points:[]};requestWake();setGpsStatus("GPS aktiv. Warte auf Position …");showView("mapView");gpsWatchId=navigator.geolocation.watchPosition(gpsPosition,gpsError,{enableHighAccuracy:true,maximumAge:3000,timeout:20000});renderGps();}
function gpsPause(){if(gpsWatchId)navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;if(gpsState.active&&!gpsState.paused){gpsState.elapsedBeforePause=gpsElapsedMs();gpsState.paused=true;gpsState.active=false;}releaseWake();setGpsStatus("GPS pausiert.");renderGps();}
function gpsResume(){if(!navigator.geolocation){alert("GPS wird nicht unterstützt.");return;}if(gpsWatchId)navigator.geolocation.clearWatch(gpsWatchId);gpsState.active=true;gpsState.paused=false;gpsState.startedAt=Date.now();requestWake();setGpsStatus("GPS fortgesetzt.");showView("mapView");gpsWatchId=navigator.geolocation.watchPosition(gpsPosition,gpsError,{enableHighAccuracy:true,maximumAge:3000,timeout:20000});renderGps();}
function gpsFinish(){if(gpsWatchId)navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;const km=gpsDistanceKm(gpsState.points),ms=gpsElapsedMs();if(gpsState.points.length>=2){activeTrip.tracks||=[];activeTrip.tracks.push({id:uid("track"),name:"Track "+new Date().toLocaleString("de-DE"),date:today(),km,ms,points:gpsState.points});save();setGpsStatus("Track gespeichert.");}else setGpsStatus("Track verworfen: zu wenige GPS-Punkte.");gpsState={active:false,paused:false,startedAt:null,elapsedBeforePause:0,points:[]};releaseWake();drawLiveTrack();drawMainMap();renderGps();}
function gpsPosition(pos){const p={lat:pos.coords.latitude,lon:pos.coords.longitude,acc:pos.coords.accuracy,time:new Date().toISOString()};const last=gpsState.points.at(-1);if(!last||distM(last,p)>5)gpsState.points.push(p);setGpsStatus(`GPS aktiv · Genauigkeit ca. ${Math.round(pos.coords.accuracy||0)} m`);drawLiveTrack();renderGps();}
function gpsError(err){setGpsStatus("GPS-Fehler: "+err.message);}
function liveIcon(){return L.divIcon({html:`<div class="live-marker">🚙</div>`,className:"",iconSize:[34,34],iconAnchor:[17,17]});}
function drawLiveTrack(){if(!map)return;if(liveTrackLayer){try{map.removeLayer(liveTrackLayer)}catch(e){}liveTrackLayer=null}if(liveMarker){try{map.removeLayer(liveMarker)}catch(e){}liveMarker=null}const pts=gpsState.points.map(p=>[p.lat,p.lon]);if(pts.length>=2)liveTrackLayer=L.polyline(pts,{color:"#22b83f",weight:5,opacity:.95}).addTo(map);if(pts.length>=1){liveMarker=L.marker(pts.at(-1),{icon:liveIcon()}).addTo(map).bindPopup("🚙 Aktuelle Position");if(followLive)map.setView(pts.at(-1),Math.max(map.getZoom(),15),{animate:true});}}
function drawSavedTracks(){if(!map)return;if(savedTrackLayer){try{map.removeLayer(savedTrackLayer)}catch(e){}}const layers=(activeTrip.tracks||[]).filter(t=>t.points?.length>1).map(t=>L.polyline(t.points.map(p=>[p.lat,p.lon]),{color:"#63db78",weight:4,opacity:.75}).bindPopup(`${esc(t.name||"Track")}<br>${Number(t.km||0).toFixed(2)} km`));savedTrackLayer=L.layerGroup(layers).addTo(map);}
const oldDrawMainMap=drawMainMap;drawMainMap=function(){oldDrawMainMap();drawSavedTracks();drawLiveTrack();};
function showTrackOnMap(id){showView("mapView");setTimeout(()=>{const t=(activeTrip.tracks||[]).find(x=>x.id===id);if(t?.points?.length&&map)map.fitBounds(L.latLngBounds(t.points.map(p=>[p.lat,p.lon])),{padding:[30,30]});},300);}
function deleteTrack(id){if(confirm("Track löschen?")){activeTrip.tracks=(activeTrip.tracks||[]).filter(t=>t.id!==id);save();renderGps();drawMainMap();}}
function exportTrackGpx(id){const t=(activeTrip.tracks||[]).find(x=>x.id===id);if(!t)return;const gpx=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Expeditionstagebuch Core 3.2" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(t.name||"Track")}</name><trkseg>${(t.points||[]).map(p=>`<trkpt lat="${p.lat}" lon="${p.lon}"><time>${p.time||""}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([gpx],{type:"application/gpx+xml"}));a.download=(t.name||"track").replace(/[^a-z0-9_-]+/gi,"_")+".gpx";a.click();}
function exportLatestGpx(){const t=(activeTrip.tracks||[]).at(-1);if(!t)return alert("Noch kein gespeicherter Track vorhanden.");exportTrackGpx(t.id);}
const oldBindCore21=bind;bind=function(){oldBindCore21();$("gpsStartBtn").onclick=gpsStart;$("gpsPauseBtn").onclick=gpsPause;$("gpsResumeBtn").onclick=gpsResume;$("gpsFinishBtn").onclick=gpsFinish;$("gpsOpenMapBtn").onclick=()=>showView("mapView");$("gpxExportBtn").onclick=exportLatestGpx;};
const oldRenderAllCore21=renderAll;renderAll=function(){oldRenderAllCore21();renderGps();};
setInterval(()=>{const g=document.getElementById("gps");if(g&&g.classList.contains("active"))renderGps();},1000);


/* ===== Core 3.2 GPS praxis/debug layer ===== */
let gpsLastPointCore22=null;
function core22SetStatus(text,cls=""){const el=document.getElementById("gpsStatus");if(!el)return;el.textContent=text;el.className="status "+cls;}
function core22DebugText(){const tracks=activeTrip?.tracks?.length||0;const active=gpsState?.active?"aktiv":(gpsState?.paused?"pausiert":"bereit");if(!gpsLastPointCore22)return `Status: <strong>${active}</strong><br>Letzter Punkt: –<br>Gespeicherte Tracks: <strong>${tracks}</strong>`;const p=gpsLastPointCore22;return `Status: <strong>${active}</strong><br>Letzter Punkt: <strong>${Number(p.lat).toFixed(6)}, ${Number(p.lon).toFixed(6)}</strong><br>Genauigkeit: <strong>±${Math.round(p.acc||0)} m</strong> · Zeit: <strong>${new Date(p.time).toLocaleTimeString("de-DE")}</strong><br>Gespeicherte Tracks: <strong>${tracks}</strong>`;}
function core22RenderDebug(){const el=document.getElementById("gpsDebug");if(el)el.innerHTML=core22DebugText();}
const oldRenderGpsCore22=typeof renderGps==="function"?renderGps:null;if(oldRenderGpsCore22){renderGps=function(){oldRenderGpsCore22();core22RenderDebug();};}
const oldGpsStartCore22=typeof gpsStart==="function"?gpsStart:null;if(oldGpsStartCore22){gpsStart=function(){core22SetStatus("GPS wird gestartet …","warn");oldGpsStartCore22();setTimeout(core22RenderDebug,300);};}
const oldGpsPauseCore22=typeof gpsPause==="function"?gpsPause:null;if(oldGpsPauseCore22){gpsPause=function(){oldGpsPauseCore22();core22SetStatus("GPS pausiert.","warn");core22RenderDebug();};}
const oldGpsResumeCore22=typeof gpsResume==="function"?gpsResume:null;if(oldGpsResumeCore22){gpsResume=function(){core22SetStatus("GPS wird fortgesetzt …","warn");oldGpsResumeCore22();setTimeout(core22RenderDebug,300);};}
const oldGpsFinishCore22=typeof gpsFinish==="function"?gpsFinish:null;if(oldGpsFinishCore22){gpsFinish=function(){const before=activeTrip?.tracks?.length||0;oldGpsFinishCore22();const after=activeTrip?.tracks?.length||0;if(after>before)core22SetStatus("Track gespeichert und in der Liste abgelegt.","ok");else core22SetStatus("Kein Track gespeichert: zu wenige GPS-Punkte.","warn");core22RenderDebug();};}
const oldGpsPositionCore22=typeof gpsPosition==="function"?gpsPosition:null;if(oldGpsPositionCore22){gpsPosition=function(pos){gpsLastPointCore22={lat:pos.coords.latitude,lon:pos.coords.longitude,acc:pos.coords.accuracy,time:new Date().toISOString()};oldGpsPositionCore22(pos);core22SetStatus(`GPS aktiv · Genauigkeit ca. ${Math.round(pos.coords.accuracy||0)} m`,"ok");core22RenderDebug();};}
const oldGpsErrorCore22=typeof gpsError==="function"?gpsError:null;if(oldGpsErrorCore22){gpsError=function(err){oldGpsErrorCore22(err);core22SetStatus("GPS-Fehler: "+err.message,"err");core22RenderDebug();};}
const oldRenderTracksCore22=typeof renderTracks==="function"?renderTracks:null;if(oldRenderTracksCore22){renderTracks=function(){oldRenderTracksCore22();core22RenderDebug();};}
setInterval(core22RenderDebug,1500);


/* ===== Core 3.2: camera + gallery photos for Journal and POI ===== */
let core23PhotoTarget = null;

function core23PhotoStore(){
  try{return JSON.parse(localStorage.getItem("expedition-core2-photos") || "{}");}
  catch(e){return {};}
}
function core23PhotoSave(store){
  localStorage.setItem("expedition-core2-photos", JSON.stringify(store));
}
async function core23AddFilesToTarget(files){
  if(!core23PhotoTarget || !files || !files.length) return;
  const store = core23PhotoStore();
  const ids = [];
  for(const f of [...files]){
    const data = await resizeImage(f, 1100);
    const id = uid("photo");
    store[id] = data;
    ids.push(id);
  }
  try{ core23PhotoSave(store); }
  catch(e){ alert("Fotos konnten nicht vollständig gespeichert werden. Vermutlich ist der lokale Speicher voll."); return; }

  if(core23PhotoTarget.type === "journal"){
    const j = activeTrip.journal.find(x => x.id === core23PhotoTarget.id);
    if(j){ j.photoIds ||= []; j.photoIds.push(...ids); }
  }
  if(core23PhotoTarget.type === "poi"){
    const p = activeTrip.pois.find(x => x.id === core23PhotoTarget.id);
    if(p){ p.photoIds ||= []; p.photoIds.push(...ids); }
  }
  save();
  renderAll();
}
function core23OpenCamera(type,id){
  core23PhotoTarget = {type,id};
  const input = type === "journal" ? $("journalCameraInput") : $("poiCameraInput");
  if(input){ input.value = ""; input.click(); }
}
function core23OpenGallery(type,id){
  core23PhotoTarget = {type,id};
  const input = type === "journal" ? $("journalGalleryInput") : $("poiGalleryInput");
  if(input){ input.value = ""; input.click(); }
}
function core23PhotoGrid(ids=[]){
  return `<div class="photo-grid">${(ids||[]).map(id => `<img src="${getPhoto(id)||""}" loading="lazy">`).join("")}</div>`;
}

renderJournal = function(){
  $("journalList").innerHTML = activeTrip.journal.slice().reverse().map(j=>`
    <div class="item">
      <strong>${esc(j.date)} · ${esc(j.title)}</strong>
      <p>${esc(j.text||"")}</p>
      <span class="photo-count">${(j.photoIds||[]).length} Fotos</span>
      ${core23PhotoGrid(j.photoIds||[])}
      <div class="photo-actions">
        <button class="secondary" onclick="core23OpenCamera('journal','${j.id}')">Foto aufnehmen</button>
        <button class="secondary" onclick="core23OpenGallery('journal','${j.id}')">Fotos aus Galerie</button>
      </div>
      <button class="danger" onclick="deleteJournal('${j.id}')">Löschen</button>
    </div>`).join("") || "<p>Noch keine Einträge.</p>";

  $("poiList").innerHTML = activeTrip.pois.map(p=>`
    <div class="item">
      <strong>${esc(p.name)}</strong><br>${esc(p.category)} · ${p.lat}, ${p.lon}
      <p>${esc(p.note||"")}</p>
      <span class="photo-count">${(p.photoIds||[]).length} Fotos</span>
      ${core23PhotoGrid(p.photoIds||[])}
      <div class="photo-actions">
        <button class="secondary" onclick="core23OpenCamera('poi','${p.id}')">Foto aufnehmen</button>
        <button class="secondary" onclick="core23OpenGallery('poi','${p.id}')">Fotos aus Galerie</button>
      </div>
      <button class="danger" onclick="deletePoi('${p.id}')">Löschen</button>
    </div>`).join("") || "<p>Noch keine POIs.</p>";
};

const oldBindCore23 = typeof bind === "function" ? bind : null;
if(oldBindCore23){
  bind = function(){
    oldBindCore23();
    const pairs = [
      ["journalCameraInput", e=>core23AddFilesToTarget(e.target.files)],
      ["journalGalleryInput", e=>core23AddFilesToTarget(e.target.files)],
      ["poiCameraInput", e=>core23AddFilesToTarget(e.target.files)],
      ["poiGalleryInput", e=>core23AddFilesToTarget(e.target.files)]
    ];
    pairs.forEach(([id,fn])=>{
      const el=$(id);
      if(el && !el.__core23){ el.__core23=true; el.onchange=fn; }
    });
  };
}
setTimeout(()=>{
  ["journalCameraInput","journalGalleryInput","poiCameraInput","poiGalleryInput"].forEach(id=>{
    const el=$(id);
    if(el) el.onchange=e=>core23AddFilesToTarget(e.target.files);
  });
  renderJournal();
},800);



/* ===== Core 3.2: expedition map, map POIs, chronology, search links ===== */
const core27Layers = {planned:true, tracks:true, pois:true, live:true};
let core27RouteLayer = null;
let core27PoiLayer = null;
let core27TrackLayer = null;
let core27LiveLayer = null;
let core27LongPressTimer = null;

function core27PoiIcon(category="POI", hasPhotos=false){
  const c = (category || "").toLowerCase();
  let icon = "📍";
  if(c.includes("camp")) icon = "🏕️";
  else if(c.includes("kajak") || c.includes("kanu")) icon = "🚣";
  else if(c.includes("diesel") || c.includes("tank")) icon = "⛽";
  else if(c.includes("foto") || c.includes("aussicht")) icon = "📸";
  else if(c.includes("restaurant") || c.includes("essen")) icon = "🍽️";
  else if(c.includes("geheim")) icon = "⭐";
  if(hasPhotos) icon = "📸";
  return L.divIcon({html:`<div class="poi-icon">${icon}</div>`,className:"",iconSize:[28,28],iconAnchor:[14,24]});
}
function core27AttachLayerControls(){
  const bindings = [
    ["layerPlanned","planned"],["layerTracks","tracks"],["layerPois","pois"],["layerLive","live"]
  ];
  bindings.forEach(([id,key])=>{
    const el=$(id);
    if(el && !el.__core27){
      el.__core27=true;
      el.checked=core27Layers[key];
      el.onchange=()=>{core27Layers[key]=el.checked; drawMainMap();};
    }
  });
  const bindBtn=(id,fn)=>{const el=$(id); if(el && !el.__core27){el.__core27=true;el.onclick=fn;}};
  bindBtn("mapMyPositionBtn",core27MapMyPosition);
  bindBtn("mapCurrentStageBtn",core27FitCurrentStage);
  bindBtn("searchPark4NightBtn",()=>core27Search("park4night"));
  bindBtn("searchCampspaceBtn",()=>core27Search("campspace"));
  bindBtn("searchSupermarketBtn",()=>core27Search("supermarket"));
  bindBtn("searchBakeryBtn",()=>core27Search("bakery"));
  bindBtn("searchFuelBtn",()=>core27Search("fuel"));
  bindBtn("searchFoodBtn",()=>core27Search("restaurant"));
}
function core27ClearLayer(layer){
  if(layer && map){try{map.removeLayer(layer);}catch(e){}}
}
function drawMainMap(){
  if(!map) return;
  core27AttachLayerControls();
  core27ClearLayer(core27RouteLayer);
  core27ClearLayer(core27PoiLayer);
  core27ClearLayer(core27TrackLayer);
  core27ClearLayer(core27LiveLayer);
  if(typeof savedTrackLayer !== "undefined" && savedTrackLayer){try{map.removeLayer(savedTrackLayer);}catch(e){} savedTrackLayer=null;}
  if(typeof liveTrackLayer !== "undefined" && liveTrackLayer){try{map.removeLayer(liveTrackLayer);}catch(e){} liveTrackLayer=null;}
  if(typeof liveMarker !== "undefined" && liveMarker){try{map.removeLayer(liveMarker);}catch(e){} liveMarker=null;}

  const routeItems = [];
  if(core27Layers.planned){
    activeTrip.stages.forEach((s,idx)=>{
      if(s.route?.coords?.length){
        routeItems.push(L.polyline(s.route.coords.map(c=>[c[1],c[0]]),{color:"#4e9cff",weight:4,opacity:.95}).bindPopup(`${idx+1}. ${esc(s.title)}`));
      }else if(hasCoords(s.start)&&hasCoords(s.end)&&s.type!=="stay"){
        routeItems.push(L.polyline([[s.start.lat,s.start.lon],[s.end.lat,s.end.lon]],{color:"#4e9cff",weight:3,opacity:.4,dashArray:"6 6"}).bindPopup(`${idx+1}. ${esc(s.title)} · Luftlinie`));
      }
      if(hasCoords(s.start)) routeItems.push(L.circleMarker([s.start.lat,s.start.lon],{radius:4,color:"#4e9cff"}).bindPopup(esc(s.start.name)));
      if(hasCoords(s.end)) routeItems.push(L.circleMarker([s.end.lat,s.end.lon],{radius:4,color:"#4e9cff"}).bindPopup(esc(s.end.name)));
    });
  }
  core27RouteLayer = L.layerGroup(routeItems).addTo(map);

  if(core27Layers.tracks){
    const trackLines=(activeTrip.tracks||[]).filter(t=>t.points?.length>1).map(t=>L.polyline(t.points.map(p=>[p.lat,p.lon]),{color:"#63db78",weight:4,opacity:.8}).bindPopup(`${esc(t.name||"Track")}<br>${Number(t.km||0).toFixed(2)} km`));
    core27TrackLayer = L.layerGroup(trackLines).addTo(map);
  }

  if(core27Layers.pois){
    const poiMarkers=(activeTrip.pois||[]).filter(p=>hasCoords(p)).map(p=>L.marker([p.lat,p.lon],{icon:core27PoiIcon(p.category,(p.photoIds||[]).length>0)}).bindPopup(`<strong>${esc(p.name)}</strong><br>${esc(p.category||"POI")}<br>${esc(p.note||"")}`));
    core27PoiLayer = L.layerGroup(poiMarkers).addTo(map);
  }

  if(core27Layers.live && typeof gpsState !== "undefined"){
    const pts=(gpsState.points||[]).map(p=>[p.lat,p.lon]);
    const liveItems=[];
    if(pts.length>=2) liveItems.push(L.polyline(pts,{color:"#22b83f",weight:5,opacity:.95}));
    if(pts.length>=1){
      const icon = typeof liveIcon === "function" ? liveIcon() : undefined;
      liveItems.push(L.marker(pts.at(-1), icon?{icon}:{}).bindPopup("🚙 Aktuelle Position"));
    }
    core27LiveLayer = L.layerGroup(liveItems).addTo(map);
  }
}
function fitMainMap(){
  if(!map)return;
  const pts=[];
  activeTrip.stages.forEach(s=>{
    if(hasCoords(s.start))pts.push([s.start.lat,s.start.lon]);
    if(hasCoords(s.end))pts.push([s.end.lat,s.end.lon]);
    if(s.route?.coords?.length) s.route.coords.forEach(c=>pts.push([c[1],c[0]]));
  });
  (activeTrip.tracks||[]).forEach(t=>(t.points||[]).forEach(p=>pts.push([p.lat,p.lon])));
  (activeTrip.pois||[]).forEach(p=>{if(hasCoords(p))pts.push([p.lat,p.lon]);});
  if(pts.length) map.fitBounds(pts,{padding:[30,30]});
}
function core27MapMyPosition(){
  const p = (typeof gpsState !== "undefined" && gpsState.points?.length) ? gpsState.points.at(-1) : null;
  if(p && map) map.setView([p.lat,p.lon],16);
  else alert("Noch keine Live-Position verfügbar.");
}
function core27CurrentStage(){
  return activeTrip.stages.find(s=>!s.route&&s.type!=="stay") || activeTrip.stages[0];
}
function core27FitCurrentStage(){
  const s=core27CurrentStage();
  if(!s||!map)return;
  if(s.route?.coords?.length) map.fitBounds(L.latLngBounds(s.route.coords.map(c=>[c[1],c[0]])),{padding:[30,30]});
  else if(hasCoords(s.start)&&hasCoords(s.end)) map.fitBounds([[s.start.lat,s.start.lon],[s.end.lat,s.end.lon]],{padding:[30,30]});
}
function core27Search(type){
  const p = (typeof gpsState !== "undefined" && gpsState.points?.length) ? gpsState.points.at(-1) : null;
  const stage=core27CurrentStage();
  const lat = p?.lat || stage?.start?.lat || 46;
  const lon = p?.lon || stage?.start?.lon || 3;
  let url = "";
  if(type==="park4night") url = `https://park4night.com/en/search?lat=${lat}&lng=${lon}&z=10`;
  else if(type==="campspace") url = `https://campspace.com/en/s?lat=${lat}&lng=${lon}`;
  else {
    const q = {supermarket:"supermarket",bakery:"bakery",fuel:"gas station",restaurant:"restaurant"}[type] || type;
    url = `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${lat},${lon},12z`;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
function core27InstallLongPressPoi(){
  if(!map || map.__core27LongPress) return;
  map.__core27LongPress=true;
  const start=e=>{
    core27LongPressTimer=setTimeout(()=>core27CreatePoiAt(e.latlng),750);
  };
  const cancel=()=>{if(core27LongPressTimer)clearTimeout(core27LongPressTimer);core27LongPressTimer=null;};
  map.on("mousedown",start); map.on("touchstart",start);
  map.on("mouseup",cancel); map.on("touchend",cancel); map.on("move",cancel);
}
function core27CreatePoiAt(latlng){
  const name=prompt("POI Name?");
  if(!name)return;
  const category=prompt("Kategorie: Camping, Kajak, Diesel, Fotospot, Restaurant, Geheimtipp", "Geheimtipp") || "POI";
  const note=prompt("Notiz", "") || "";
  activeTrip.pois ||= [];
  activeTrip.pois.push({id:uid("poi"),name,category,note,lat:latlng.lat,lon:latlng.lng,photoIds:[]});
  save();
  renderAll();
  drawMainMap();
}
const oldInitMainMapCore27 = typeof initMainMap === "function" ? initMainMap : null;
if(oldInitMainMapCore27){
  initMainMap=function(){
    oldInitMainMapCore27();
    setTimeout(()=>{core27AttachLayerControls();core27InstallLongPressPoi();drawMainMap();},250);
  };
}
const oldShowViewCore27 = typeof showView === "function" ? showView : null;
if(oldShowViewCore27){
  showView=function(id){
    oldShowViewCore27(id);
    if(id==="mapView") setTimeout(()=>{core27AttachLayerControls();core27InstallLongPressPoi();drawMainMap();},350);
  };
  window.showView=showView;
}
const oldRenderJournalCore27 = typeof renderJournal === "function" ? renderJournal : null;
renderJournal=function(){
  if(oldRenderJournalCore27) oldRenderJournalCore27();
  renderChronology();
};
function renderChronology(){
  const el=$("chronologyList"); if(!el)return;
  const byDate={};
  const add=(date,row)=>{date=date||"ohne Datum";byDate[date]||=[];byDate[date].push(row);};
  (activeTrip.tracks||[]).forEach(t=>add(t.date,`🟩 Track: ${Number(t.km||0).toFixed(1)} km · ${fmtDuration ? fmtDuration(t.ms||0) : ""}`));
  (activeTrip.pois||[]).forEach(p=>add(p.date||today(),`📍 ${esc(p.name)} · ${esc(p.category||"POI")}`));
  (activeTrip.journal||[]).forEach(j=>add(j.date,`📝 ${esc(j.title)} ${(j.photoIds||[]).length?`· 📷 ${(j.photoIds||[]).length}`:""}`));
  (activeTrip.expenses||[]).forEach(e=>add(e.date,`💶 ${esc(e.category)} · ${money(e.amount)}`));
  const dates=Object.keys(byDate).sort().reverse();
  el.innerHTML = dates.length ? dates.map(d=>`<div class="chrono-day"><h4>${esc(d)}</h4>${byDate[d].map(r=>`<div class="chrono-row">${r}</div>`).join("")}</div>`).join("") : "<p>Noch keine Chronikdaten.</p>";
}
const oldRenderAllCore27 = typeof renderAll === "function" ? renderAll : null;
if(oldRenderAllCore27){
  renderAll=function(){
    oldRenderAllCore27();
    renderChronology();
    if(map) setTimeout(drawMainMap,100);
  };
}
setTimeout(()=>{core27AttachLayerControls();renderChronology();if(map){core27InstallLongPressPoi();drawMainMap();}},1000);


/* ===== Core 3.2: planning editor with geocoding and validation ===== */
let core28GeoCache=JSON.parse(localStorage.getItem("expedition-core2-geocache")||"{}");
function core28SaveGeoCache(){try{localStorage.setItem("expedition-core2-geocache",JSON.stringify(core28GeoCache));}catch(e){}}
function core28ValidPoint(p){return !!p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lon))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lon))<=180&&!(Number(p.lat)===0&&Number(p.lon)===0);}
function core28SetStatus(id,msg,cls=""){const el=$(id);if(!el)return;el.textContent=msg;el.className="geo-status "+cls;}
function core28MarkCoords(prefix){const lat=$(`${prefix}-lat`),lon=$(`${prefix}-lon`);const ok=core28ValidPoint({lat:Number(lat?.value),lon:Number(lon?.value)});[lat,lon].forEach(el=>{if(!el)return;el.classList.toggle("coord-valid",ok);el.classList.toggle("coord-invalid",!ok);});return ok;}
async function core28Geocode(query){query=String(query||"").trim();if(!query)throw new Error("Ort fehlt");const key=query.toLowerCase();if(core28GeoCache[key])return core28GeoCache[key];const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;const r=await fetch(url,{headers:{"Accept":"application/json"}});if(!r.ok)throw new Error("Geocoding fehlgeschlagen: "+r.status);const data=await r.json();const results=(data||[]).map(x=>({name:x.display_name,lat:Number(x.lat),lon:Number(x.lon),type:x.type||"",cls:x.class||""})).filter(x=>core28ValidPoint(x));if(!results.length)throw new Error("Keine Koordinaten gefunden");core28GeoCache[key]=results;core28SaveGeoCache();return results;}
async function core28Lookup(prefix){const nameEl=$(`${prefix}-name`),q=nameEl?.value,statusId=`${prefix}-status`,resId=`${prefix}-results`,res=$(resId);core28SetStatus(statusId,"Suche Koordinaten …","warn");if(res)res.innerHTML="";try{const list=await core28Geocode(q);if(list.length===1){core28ApplyGeo(prefix,list[0]);}else{core28SetStatus(statusId,`${list.length} Treffer gefunden. Bitte auswählen.`,"warn");if(res)res.innerHTML=list.map((g,i)=>`<button type="button" onclick="core28ApplyGeo('${prefix}', core28GeoCache[${JSON.stringify(String(q||"").toLowerCase())}][${i}])">${esc(g.name)}</button>`).join("");}}catch(e){core28SetStatus(statusId,e.message,"err");}}
function core28ApplyGeo(prefix,g){$(`${prefix}-name`).value=($(`${prefix}-name`).value||"").trim()||g.name.split(",")[0];$(`${prefix}-lat`).value=Number(g.lat).toFixed(6);$(`${prefix}-lon`).value=Number(g.lon).toFixed(6);const res=$(`${prefix}-results`);if(res)res.innerHTML="";core28SetStatus(`${prefix}-status`,`Koordinaten gesetzt: ${Number(g.lat).toFixed(5)}, ${Number(g.lon).toFixed(5)}`,"ok");core28MarkCoords(prefix);core28ValidateStageEditor();}
function core28ValidateStageEditor(){const sOk=core28MarkCoords("st-start"),eOk=core28MarkCoords("st-end"),warn=$("stageEditorWarning"),saveBtn=$("stageSaveBtn");if(warn){if(sOk&&eOk){warn.textContent="Start und Ziel sind gültig. Speichern ist möglich.";warn.className="geo-status ok";}else{warn.textContent="Start und Ziel benötigen gültige Koordinaten. Nutze „Koordinaten suchen“ oder trage gültige Werte ein.";warn.className="editor-warning";}}if(saveBtn)saveBtn.disabled=!(sOk&&eOk);return sOk&&eOk;}
function core28FallbackKnownPlace(name){const places={"bad zwischenahn":[53.183,8.000],"reims":[49.258,4.031],"morvan":[47.466,3.747],"lac des settons":[47.207,4.066],"amboise":[47.413,0.982],"dierre":[47.3497,0.9578],"chenonceau":[47.3249,1.0703],"tournon-sur-rhône":[45.067,4.833],"la croix-valmer":[43.206,6.567],"moustiers-sainte-marie":[43.846,6.221],"sainte-enimie":[44.365,3.412],"sarlat-la-canéda":[44.890,1.216],"bellême":[48.379,0.570]};const key=String(name||"").toLowerCase().trim();for(const [k,v] of Object.entries(places)){if(key.includes(k))return{name,lat:v[0],lon:v[1]};}return null;}

editStage=function(id){const prev=activeTrip.stages.at(-1);const s=id?activeTrip.stages.find(x=>x.id===id):{id:uid("stage"),type:"drive",date:"",title:"Neue Etappe",start:{name:prev?.end?.name||"",lat:prev?.end?.lat||0,lon:prev?.end?.lon||0},end:{name:"",lat:0,lon:0},plannedKm:0,plannedTime:"",overnight:"",notes:"",route:null};const e=$("stageEditor");e.hidden=false;e.className="editor";e.innerHTML=`<h3>${id?"Etappe bearbeiten":"Etappe hinzufügen"}</h3>
<div id="stageEditorWarning" class="editor-warning">Start und Ziel benötigen gültige Koordinaten.</div>
<div class="two"><input id="st-title" value="${esc(s.title)}" placeholder="Titel"><select id="st-type"><option value="drive">Fahretappe</option><option value="stay">Aufenthalt/Rundtag</option></select></div>
<div class="three"><input id="st-date" value="${esc(s.date)}" placeholder="Datum"><input id="st-km" type="number" value="${Number(s.plannedKm||0)}" placeholder="Plan-km"><input id="st-time" value="${esc(s.plannedTime||"")}" placeholder="Planzeit"></div>
<label>Start</label><div class="geo-row"><input id="st-start-name" value="${esc(s.start.name)}" placeholder="Start Name"><button type="button" class="secondary" onclick="core28Lookup('st-start')">Koordinaten suchen</button></div><div id="st-start-status" class="geo-status">Startkoordinaten prüfen.</div><div id="st-start-results" class="geo-results"></div><div class="two"><input id="st-start-lat" type="number" step="0.000001" value="${Number(s.start.lat||0)}" placeholder="Start Lat"><input id="st-start-lon" type="number" step="0.000001" value="${Number(s.start.lon||0)}" placeholder="Start Lon"></div>
<label>Ziel</label><div class="geo-row"><input id="st-end-name" value="${esc(s.end.name)}" placeholder="Ziel Name"><button type="button" class="secondary" onclick="core28Lookup('st-end')">Koordinaten suchen</button></div><div id="st-end-status" class="geo-status">Zielkoordinaten prüfen.</div><div id="st-end-results" class="geo-results"></div><div class="two"><input id="st-end-lat" type="number" step="0.000001" value="${Number(s.end.lat||0)}" placeholder="Ziel Lat"><input id="st-end-lon" type="number" step="0.000001" value="${Number(s.end.lon||0)}" placeholder="Ziel Lon"></div>
<input id="st-overnight" value="${esc(s.overnight||"")}" placeholder="Übernachtung"><textarea id="st-notes" placeholder="Notizen">${esc(s.notes||"")}</textarea>
<div class="action-row"><button id="stageSaveBtn" onclick="saveStage('${s.id}','${id?"update":"new"}')">Speichern</button><button class="secondary" onclick="$('stageEditor').hidden=true">Abbrechen</button></div>`;$("st-type").value=s.type;["st-start-lat","st-start-lon","st-end-lat","st-end-lon"].forEach(fid=>$(fid).addEventListener("input",core28ValidateStageEditor));["st-start-name","st-end-name"].forEach(fid=>$(fid).addEventListener("change",()=>{const prefix=fid==="st-start-name"?"st-start":"st-end";const fb=core28FallbackKnownPlace($(fid).value);if(fb)core28ApplyGeo(prefix,fb);else core28ValidateStageEditor();}));const fs=core28FallbackKnownPlace(s.start.name),fe=core28FallbackKnownPlace(s.end.name);if(!core28ValidPoint(s.start)&&fs)core28ApplyGeo("st-start",fs);if(!core28ValidPoint(s.end)&&fe)core28ApplyGeo("st-end",fe);core28ValidateStageEditor();e.scrollIntoView({behavior:"smooth",block:"start"});};
window.editStage=editStage;

saveStage=function(id,mode){if(!core28ValidateStageEditor()){alert("Speichern nicht möglich: Start und Ziel benötigen gültige Koordinaten.");return;}const s=mode==="update"?activeTrip.stages.find(x=>x.id===id):{id};if(!s){alert("Etappe nicht gefunden.");return;}Object.assign(s,{type:$("st-type").value,date:$("st-date").value,title:$("st-title").value,start:{name:$("st-start-name").value.trim(),lat:Number($("st-start-lat").value),lon:Number($("st-start-lon").value)},end:{name:$("st-end-name").value.trim(),lat:Number($("st-end-lat").value),lon:Number($("st-end-lon").value)},plannedKm:Number($("st-km").value||0),plannedTime:$("st-time").value,overnight:$("st-overnight").value,notes:$("st-notes").value,route:null});if(mode==="new")activeTrip.stages.push(s);normalizeAll();save();$("stageEditor").hidden=true;renderAll();};
window.saveStage=saveStage;

const oldBuildStageRouteCore28=typeof buildStageRoute==="function"?buildStageRoute:null;
buildStageRoute=async function(id,force=false){const s=activeTrip.stages.find(x=>x.id===id);if(!s){alert("Etappe nicht gefunden.");return false;}if(!core28ValidPoint(s.start)||!core28ValidPoint(s.end)){alert("Route kann nicht berechnet werden: Start oder Ziel haben keine gültigen Koordinaten.");editStage(id);return false;}return oldBuildStageRouteCore28(id,force);};
window.buildStageRoute=buildStageRoute;
deleteStage=function(id){if(confirm("Etappe löschen?")){activeTrip.stages=activeTrip.stages.filter(s=>s.id!==id);normalizeAll();save();renderAll();}};
window.deleteStage=deleteStage;


/* ===== Core 3.2: IndexedDB storage foundation for photos ===== */
const CORE30_DB_NAME="expeditionstagebuch-core3";
const CORE30_DB_VERSION=1;
let core30DbPromise=null;
let core30PhotoMemory={};
let core30PhotoLoading=new Set();

function core30OpenDb(){
  if(core30DbPromise)return core30DbPromise;
  core30DbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(CORE30_DB_NAME,CORE30_DB_VERSION);
    req.onupgradeneeded=e=>{
      const dbx=e.target.result;
      if(!dbx.objectStoreNames.contains("photos"))dbx.createObjectStore("photos",{keyPath:"id"});
      if(!dbx.objectStoreNames.contains("meta"))dbx.createObjectStore("meta",{keyPath:"key"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return core30DbPromise;
}
async function core30Put(storeName,value){
  const dbx=await core30OpenDb();
  return new Promise((resolve,reject)=>{
    const tx=dbx.transaction(storeName,"readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
}
async function core30Get(storeName,key){
  const dbx=await core30OpenDb();
  return new Promise((resolve,reject)=>{
    const tx=dbx.transaction(storeName,"readonly");
    const req=tx.objectStore(storeName).get(key);
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function core30GetAll(storeName){
  const dbx=await core30OpenDb();
  return new Promise((resolve,reject)=>{
    const tx=dbx.transaction(storeName,"readonly");
    const req=tx.objectStore(storeName).getAll();
    req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error);
  });
}
async function core30StorePhotoData(id,data){
  core30PhotoMemory[id]=data;
  await core30Put("photos",{id,data,createdAt:new Date().toISOString()});
}
async function core30LoadPhoto(id){
  if(core30PhotoMemory[id])return core30PhotoMemory[id];
  if(core30PhotoLoading.has(id))return "";
  core30PhotoLoading.add(id);
  try{
    const rec=await core30Get("photos",id);
    if(rec?.data){
      core30PhotoMemory[id]=rec.data;
      setTimeout(renderAll,30);
      return rec.data;
    }
  }catch(e){console.warn("Foto konnte nicht aus IndexedDB geladen werden",e);}
  finally{core30PhotoLoading.delete(id);}
  return "";
}
function getPhoto(id){
  if(core30PhotoMemory[id])return core30PhotoMemory[id];
  core30LoadPhoto(id);
  return "";
}
async function storePhoto(file){
  const data=await resizeImage(file,1100);
  const id=uid("photo");
  await core30StorePhotoData(id,data);
  return{id};
}
async function core23AddFilesToTarget(files){
  if(!core23PhotoTarget||!files||!files.length)return;
  const ids=[];
  for(const f of [...files]){
    const data=await resizeImage(f,1100);
    const id=uid("photo");
    try{await core30StorePhotoData(id,data);ids.push(id);}
    catch(e){alert("Foto konnte nicht in IndexedDB gespeichert werden: "+e.message);return;}
  }
  if(core23PhotoTarget.type==="journal"){
    const j=activeTrip.journal.find(x=>x.id===core23PhotoTarget.id);
    if(j){j.photoIds||=[];j.photoIds.push(...ids);}
  }
  if(core23PhotoTarget.type==="poi"){
    const p=activeTrip.pois.find(x=>x.id===core23PhotoTarget.id);
    if(p){p.photoIds||=[];p.photoIds.push(...ids);}
  }
  save(); renderAll();
}
async function core30MigrateLocalStoragePhotos(){
  let migrated=0;
  try{
    const raw=localStorage.getItem("expedition-core2-photos");
    if(!raw)return 0;
    const old=JSON.parse(raw);
    for(const [id,data] of Object.entries(old)){
      if(data&&!core30PhotoMemory[id]){await core30StorePhotoData(id,data);migrated++;}
    }
    localStorage.removeItem("expedition-core2-photos");
  }catch(e){console.warn("Migration alter Fotos fehlgeschlagen",e);}
  return migrated;
}
async function core30StorageEstimate(){
  let estimate=null;
  try{if(navigator.storage?.estimate)estimate=await navigator.storage.estimate();}catch(e){}
  const photos=await core30GetAll("photos").catch(()=>[]);
  const used=estimate?.usage?(estimate.usage/1024/1024).toFixed(1)+" MB":"unbekannt";
  const quota=estimate?.quota?(estimate.quota/1024/1024).toFixed(0)+" MB":"unbekannt";
  return{photos:photos.length,used,quota};
}
async function core30RenderStorageStatus(){
  const el=$("storageStatusCore30"); if(!el)return;
  try{
    await core30OpenDb();
    const s=await core30StorageEstimate();
    el.innerHTML=`IndexedDB aktiv.<br>Fotos gespeichert: <strong>${s.photos}</strong><br>Speicher genutzt: <strong>${s.used}</strong> / <strong>${s.quota}</strong>`;
  }catch(e){el.innerHTML=`IndexedDB nicht verfügbar: ${esc(e.message)}`;}
}
const oldBindCore30=typeof bind==="function"?bind:null;
if(oldBindCore30){
  bind=function(){
    oldBindCore30();
    const mig=$("migratePhotosBtn"),ref=$("storageRefreshBtn");
    if(mig&&!mig.__core30){mig.__core30=true;mig.onclick=async()=>{mig.disabled=true;const n=await core30MigrateLocalStoragePhotos();await core30RenderStorageStatus();mig.disabled=false;alert(n?`${n} Fotos migriert.`:"Keine alten Fotos zur Migration gefunden.");};}
    if(ref&&!ref.__core30){ref.__core30=true;ref.onclick=core30RenderStorageStatus;}
  };
}
const oldRenderAllCore30=typeof renderAll==="function"?renderAll:null;
if(oldRenderAllCore30){renderAll=function(){oldRenderAllCore30();core30RenderStorageStatus();};}
setTimeout(async()=>{await core30OpenDb().catch(()=>{});await core30MigrateLocalStoragePhotos();await core30RenderStorageStatus();renderAll();},800);


/* ===== Core 3.2 HARD REPLACEMENT: planning editor, geocoding, route mode, minimaps ===== */

function core32ValidPoint(p){
  return !!p &&
    Number.isFinite(Number(p.lat)) &&
    Number.isFinite(Number(p.lon)) &&
    Math.abs(Number(p.lat)) <= 90 &&
    Math.abs(Number(p.lon)) <= 180 &&
    !(Number(p.lat) === 0 && Number(p.lon) === 0);
}
function core32DistanceM(a,b){
  const R=6371000;
  const dLat=(Number(b.lat)-Number(a.lat))*Math.PI/180;
  const dLon=(Number(b.lon)-Number(a.lon))*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(Number(a.lat)*Math.PI/180)*Math.cos(Number(b.lat)*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function core32SamePoint(a,b){return core32ValidPoint(a)&&core32ValidPoint(b)&&core32DistanceM(a,b)<80;}
function core32Status(id,msg,cls=""){
  const el=$(id); if(!el)return;
  el.textContent=msg; el.className="geo-status "+cls;
}
function core32Mark(prefix){
  const lat=$(`${prefix}-lat`), lon=$(`${prefix}-lon`);
  const ok=core32ValidPoint({lat:Number(lat?.value), lon:Number(lon?.value)});
  [lat,lon].forEach(el=>{
    if(!el)return;
    el.classList.toggle("coord-valid",ok);
    el.classList.toggle("coord-invalid",!ok);
  });
  return ok;
}
function core32ValidateEditor(){
  const ok = core32Mark("st-start") && core32Mark("st-end");
  const warn=$("stageEditorWarning"), btn=$("stageSaveBtn");
  if(warn){
    warn.textContent = ok ? "Start und Ziel sind gültig. Speichern ist möglich." : "Start und Ziel benötigen gültige Koordinaten.";
    warn.className = ok ? "editor-warning ok" : "editor-warning";
  }
  if(btn) btn.disabled = !ok;
  return ok;
}
function core32KnownPlace(name){
  const key=String(name||"").toLowerCase().trim();
  const places={
    "bad zwischenahn":[53.183,8.000],"reims":[49.258,4.031],
    "morvan":[47.466,3.747],"lac des settons":[47.207,4.066],
    "amboise":[47.413,0.982],"dierre":[47.3497,0.9578],
    "chenonceau":[47.3249,1.0703],"tournon-sur-rhône":[45.067,4.833],
    "la croix-valmer":[43.206,6.567],"moustiers-sainte-marie":[43.846,6.221],
    "sainte-enimie":[44.365,3.412],"sarlat-la-canéda":[44.890,1.216],
    "bellême":[48.379,0.570]
  };
  for(const [k,v] of Object.entries(places)){
    if(key.includes(k)) return {name, lat:v[0], lon:v[1]};
  }
  return null;
}
function core32ApplyGeo(prefix,g){
  if(!g)return;
  const nameEl=$(`${prefix}-name`);
  if(nameEl && !nameEl.value.trim()) nameEl.value = (g.name||"").split(",")[0];
  $(`${prefix}-lat`).value = Number(g.lat).toFixed(6);
  $(`${prefix}-lon`).value = Number(g.lon).toFixed(6);
  const res=$(`${prefix}-results`); if(res)res.innerHTML="";
  core32Status(`${prefix}-status`, `Koordinaten gesetzt: ${Number(g.lat).toFixed(5)}, ${Number(g.lon).toFixed(5)}`, "ok");
  core32ValidateEditor();
}
async function core32Lookup(prefix){
  const q=$(`${prefix}-name`)?.value?.trim();
  const res=$(`${prefix}-results`);
  if(res)res.innerHTML="";
  if(!q){core32Status(`${prefix}-status`, "Bitte Ort eingeben.", "err");return;}
  core32Status(`${prefix}-status`, "Suche Koordinaten …", "warn");
  try{
    let list=[];
    const known=core32KnownPlace(q);
    if(known) list.push(known);
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
    const r=await fetch(url,{headers:{"Accept":"application/json"}});
    if(r.ok){
      const data=await r.json();
      list=[...list,...(data||[]).map(x=>({name:x.display_name,lat:Number(x.lat),lon:Number(x.lon)}))];
    }
    const seen=new Set();
    list=list.filter(g=>{
      const key=`${Number(g.lat).toFixed(4)},${Number(g.lon).toFixed(4)}`;
      if(seen.has(key))return false;
      seen.add(key);
      return core32ValidPoint(g);
    }).slice(0,5);
    if(!list.length){core32Status(`${prefix}-status`,"Keine Koordinaten gefunden.","err");return;}
    if(list.length===1){core32ApplyGeo(prefix,list[0]);return;}
    core32Status(`${prefix}-status`,`${list.length} Treffer gefunden. Bitte auswählen.`,"warn");
    if(res){
      list.forEach(g=>{
        const b=document.createElement("button");
        b.type="button";
        b.textContent=g.name;
        b.addEventListener("click",()=>core32ApplyGeo(prefix,g));
        res.appendChild(b);
      });
    }
  }catch(e){
    core32Status(`${prefix}-status`, e.message || "Geocoding fehlgeschlagen", "err");
  }
}
window.core32Lookup=core32Lookup;
window.core32ApplyGeo=core32ApplyGeo;
window.core28Lookup=core32Lookup;
window.core28ApplyGeo=core32ApplyGeo;
window.core31Lookup=core32Lookup;
window.core31ApplyGeo=core32ApplyGeo;

function core32RouteModeLabel(mode){
  if(mode==="osrm")return"Autobahn erlaubt";
  if(mode==="ors-avoid")return"Autobahn vermeiden";
  if(mode==="straight")return"Luftlinie";
  return"globale Routing-Einstellung";
}
function core32StageChip(s){
  if(s.type==="stay")return`<span class="chip stay">Aufenthalt</span>`;
  if(s.route?.coords?.length)return`<span class="chip ok">Route gespeichert</span>`;
  if(!core32ValidPoint(s.start)||!core32ValidPoint(s.end))return`<span class="chip err">Koordinaten fehlen</span>`;
  return`<span class="chip warn">Route offen</span>`;
}
function editStage(id){
  const prev=activeTrip.stages.at(-1);
  const s=id?activeTrip.stages.find(x=>x.id===id):{
    id:uid("stage"), type:"drive", routeMode:"inherit", date:"", title:"Neue Etappe",
    start:{name:prev?.end?.name||"", lat:prev?.end?.lat||0, lon:prev?.end?.lon||0},
    end:{name:"", lat:0, lon:0}, plannedKm:0, plannedTime:"", overnight:"", notes:"", route:null
  };
  if(!s){alert("Etappe nicht gefunden.");return;}
  const e=$("stageEditor");
  e.hidden=false;
  e.className="editor stage-editor-core32";
  e.innerHTML=`<h3>${id?"Etappe bearbeiten":"Etappe hinzufügen"}</h3>
    <div id="stageEditorWarning" class="editor-warning">Start und Ziel benötigen gültige Koordinaten.</div>

    <div class="two">
      <input id="st-title" value="${esc(s.title)}" placeholder="Titel">
      <select id="st-type"><option value="drive">Fahretappe</option><option value="stay">Aufenthalt/Rundtag</option></select>
    </div>

    <div class="route-mode-box">
      <strong>Routing dieser Etappe</strong>
      <label><input type="radio" name="st-route-mode" value="inherit"> globale Einstellung verwenden</label>
      <label><input type="radio" name="st-route-mode" value="osrm"> Autobahn erlaubt / normale Straßenroute</label>
      <label><input type="radio" name="st-route-mode" value="ors-avoid"> Autobahn vermeiden</label>
      <label><input type="radio" name="st-route-mode" value="straight"> Luftlinie</label>
    </div>

    <div class="three">
      <input id="st-date" value="${esc(s.date)}" placeholder="Datum">
      <input id="st-km" type="number" value="${Number(s.plannedKm||0)}" placeholder="Plan-km">
      <input id="st-time" value="${esc(s.plannedTime||"")}" placeholder="Planzeit">
    </div>

    <label>Start</label>
    <div class="geo-row">
      <input id="st-start-name" value="${esc(s.start.name)}" placeholder="Start Name">
      <button type="button" class="secondary" id="st-start-lookup">Koordinaten suchen</button>
    </div>
    <div id="st-start-status" class="geo-status">Startkoordinaten prüfen.</div>
    <div id="st-start-results" class="geo-results"></div>
    <div class="two">
      <input id="st-start-lat" type="number" step="0.000001" value="${Number(s.start.lat||0)}" placeholder="Start Lat">
      <input id="st-start-lon" type="number" step="0.000001" value="${Number(s.start.lon||0)}" placeholder="Start Lon">
    </div>

    <label>Ziel</label>
    <div class="geo-row">
      <input id="st-end-name" value="${esc(s.end.name)}" placeholder="Ziel Name">
      <button type="button" class="secondary" id="st-end-lookup">Koordinaten suchen</button>
    </div>
    <div id="st-end-status" class="geo-status">Zielkoordinaten prüfen.</div>
    <div id="st-end-results" class="geo-results"></div>
    <div class="two">
      <input id="st-end-lat" type="number" step="0.000001" value="${Number(s.end.lat||0)}" placeholder="Ziel Lat">
      <input id="st-end-lon" type="number" step="0.000001" value="${Number(s.end.lon||0)}" placeholder="Ziel Lon">
    </div>

    <input id="st-overnight" value="${esc(s.overnight||"")}" placeholder="Übernachtung">
    <textarea id="st-notes" placeholder="Notizen">${esc(s.notes||"")}</textarea>
    <div class="action-row">
      <button type="button" id="stageSaveBtn">Speichern</button>
      <button type="button" class="secondary" onclick="$('stageEditor').hidden=true">Abbrechen</button>
    </div>`;
  $("st-type").value=s.type;
  document.querySelectorAll('input[name="st-route-mode"]').forEach(r=>{r.checked=r.value===(s.routeMode||"inherit");});
  $("st-start-lookup").addEventListener("click",()=>core32Lookup("st-start"));
  $("st-end-lookup").addEventListener("click",()=>core32Lookup("st-end"));
  $("stageSaveBtn").addEventListener("click",()=>saveStage(s.id,id?"update":"new"));
  ["st-start-lat","st-start-lon","st-end-lat","st-end-lon"].forEach(fid=>$(fid).addEventListener("input",core32ValidateEditor));
  core32ValidateEditor();
  e.scrollIntoView({behavior:"smooth",block:"start"});
}
window.editStage=editStage;

function saveStage(id,mode){
  if(!core32ValidateEditor()){
    alert("Speichern nicht möglich: Start und Ziel benötigen gültige Koordinaten.");
    return;
  }
  const s=mode==="update"?activeTrip.stages.find(x=>x.id===id):{id};
  if(!s){alert("Etappe nicht gefunden.");return;}
  const routeMode=document.querySelector('input[name="st-route-mode"]:checked')?.value || "inherit";
  Object.assign(s,{
    type:$("st-type").value,
    routeMode,
    date:$("st-date").value,
    title:$("st-title").value,
    start:{name:$("st-start-name").value.trim(),lat:Number($("st-start-lat").value),lon:Number($("st-start-lon").value)},
    end:{name:$("st-end-name").value.trim(),lat:Number($("st-end-lat").value),lon:Number($("st-end-lon").value)},
    plannedKm:Number($("st-km").value||0),
    plannedTime:$("st-time").value,
    overnight:$("st-overnight").value,
    notes:$("st-notes").value,
    route:null
  });
  if(mode==="new")activeTrip.stages.push(s);
  normalizeAll();
  save();
  $("stageEditor").hidden=true;
  renderAll();
  setTimeout(rebuildStageMaps,350);
}
window.saveStage=saveStage;

function renderPlanning(){
  const list=$("stageList");
  list.innerHTML=activeTrip.stages.map((s,i)=>`
    <div class="stage" data-stage="${s.id}">
      <div class="stage-head">
        <div>
          <strong>${i+1}. ${esc(s.title)}</strong><br>
          ${esc(s.date)} · ${esc(s.start.name)} → ${esc(s.end.name)}<br>
          ${core32StageChip(s)}<br>
          <span class="route-mode-note chip">${core32RouteModeLabel(s.routeMode||"inherit")}</span>
        </div>
        <button class="secondary" onclick="editStage('${s.id}')">Bearbeiten</button>
      </div>
      <div class="stage-points">
        <div><strong>Start</strong>${esc(s.start.name)}<br><small>${Number(s.start.lat||0).toFixed(5)}, ${Number(s.start.lon||0).toFixed(5)}</small></div>
        <div><strong>Ziel</strong>${esc(s.end.name)}<br><small>${Number(s.end.lat||0).toFixed(5)}, ${Number(s.end.lon||0).toFixed(5)}</small></div>
      </div>
      <div class="stage-meta">
        <div><strong>${s.route?.distanceM?Math.round(s.route.distanceM/1000):Number(s.plannedKm||0)} km</strong><small>${s.route?"echte Route":"Planwert"}</small></div>
        <div><strong>${s.route?.durationS?routeTime(s.route.durationS):(s.plannedTime||"–")}</strong><small>${s.route?"Routingzeit":"Planzeit"}</small></div>
      </div>
      <div class="mini-map" id="stageMap-${s.id}"></div>
      <div class="stage-actions">
        <button onclick="buildStageRoute('${s.id}',true)">Route laden</button>
        <button class="secondary" onclick="openStageMap('${s.id}')">Große Karte</button>
        <button class="secondary" onclick="moveStage('${s.id}',-1)">↑</button>
        <button class="secondary" onclick="moveStage('${s.id}',1)">↓</button>
        <button class="secondary" onclick="duplicateStage('${s.id}')">Duplizieren</button>
        <button class="danger" onclick="deleteStage('${s.id}')">Löschen</button>
      </div>
    </div>`).join("")||"<p>Noch keine Etappen.</p>";
  setTimeout(rebuildStageMaps,250);
}
window.renderPlanning=renderPlanning;

function destroyStageMaps(){
  Object.values(stageMaps||{}).forEach(m=>{try{m.remove();}catch(e){}});
  stageMaps={};
}
window.destroyStageMaps=destroyStageMaps;

function drawStageMap(id){
  const s=activeTrip.stages.find(x=>x.id===id),m=stageMaps[id];
  if(!s||!m)return;
  m.eachLayer(l=>{if(l instanceof L.Marker||l instanceof L.Polyline||l instanceof L.CircleMarker)m.removeLayer(l);});
  if(!core32ValidPoint(s.start)&&!core32ValidPoint(s.end))return;
  if(core32ValidPoint(s.start))L.marker([s.start.lat,s.start.lon]).addTo(m).bindPopup(s.start.name);
  if(core32ValidPoint(s.end))L.marker([s.end.lat,s.end.lon]).addTo(m).bindPopup(s.end.name);
  if(s.type==="stay"||core32SamePoint(s.start,s.end)){
    if(core32ValidPoint(s.start))m.setView([s.start.lat,s.start.lon],13);
    return;
  }
  let coords=[];
  if(s.route?.coords?.length)coords=s.route.coords.map(c=>[c[1],c[0]]);
  else if(core32ValidPoint(s.start)&&core32ValidPoint(s.end))coords=[[s.start.lat,s.start.lon],[s.end.lat,s.end.lon]];
  if(coords.length>=2){
    const line=L.polyline(coords,{color:"#4e9cff",weight:4,opacity:s.route?0.95:0.55,dashArray:s.route?null:"6 6"}).addTo(m);
    try{m.fitBounds(line.getBounds(),{padding:[14,14]});}catch(e){}
  }
}
window.drawStageMap=drawStageMap;

function rebuildStageMaps(){
  destroyStageMaps();
  activeTrip.stages.forEach(s=>{
    const el=$("stageMap-"+s.id);
    if(!el)return;
    try{delete el._leaflet_id;}catch(e){}
    const base=core32ValidPoint(s.start)?s.start:(core32ValidPoint(s.end)?s.end:{lat:46,lon:3});
    try{
      const m=L.map(el,{zoomControl:false,attributionControl:false}).setView([base.lat,base.lon],8);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(m);
      stageMaps[s.id]=m;
      setTimeout(()=>{m.invalidateSize(true);drawStageMap(s.id);},250);
      setTimeout(()=>{m.invalidateSize(true);drawStageMap(s.id);},900);
    }catch(e){console.warn("Minikarte Fehler",s.id,e);}
  });
}
window.rebuildStageMaps=rebuildStageMaps;

async function core32FetchRouteForStage(s){
  const mode=(s.routeMode&&s.routeMode!=="inherit")?s.routeMode:(db.settings.routeMode||"osrm");
  if(mode==="straight")return straightRoute(s.start,s.end);
  if(mode==="ors-avoid")return fetchORS(s.start,s.end);
  return fetchOSRM(s.start,s.end);
}
async function buildStageRoute(id,force=false){
  const s=activeTrip.stages.find(x=>x.id===id);
  if(!s){alert("Etappe nicht gefunden.");return false;}
  if(!core32ValidPoint(s.start)||!core32ValidPoint(s.end)){
    alert("Route kann nicht berechnet werden: Start oder Ziel haben keine gültigen Koordinaten.");
    editStage(id);
    return false;
  }
  if(s.type==="stay"||core32SamePoint(s.start,s.end)){
    s.route=null;
    save();
    renderAll();
    return true;
  }
  if(!force&&s.route?.coords?.length){drawStageMap(id);return true;}
  try{
    $("batchStatus").textContent="Berechne: "+s.title;
    const res=await core32FetchRouteForStage(s);
    const mode=(s.routeMode&&s.routeMode!=="inherit")?s.routeMode:(db.settings.routeMode||"osrm");
    s.route={mode,distanceM:res.distanceM,durationS:res.durationS,coords:simplify(res.coords,650),updatedAt:new Date().toISOString()};
    save();
    renderAll();
    setTimeout(rebuildStageMaps,350);
    return true;
  }catch(e){
    console.error(e);
    $("batchStatus").textContent="Fehler: "+s.title+" · "+e.message;
    alert("Route konnte nicht berechnet werden: "+e.message);
    return false;
  }
}
window.buildStageRoute=buildStageRoute;

function deleteStage(id){
  if(confirm("Etappe löschen?")){
    activeTrip.stages=activeTrip.stages.filter(s=>s.id!==id);
    normalizeAll();
    save();
    renderAll();
    setTimeout(rebuildStageMaps,350);
  }
}
window.deleteStage=deleteStage;

setTimeout(()=>{try{renderPlanning();}catch(e){console.warn(e);}},1200);

init();
