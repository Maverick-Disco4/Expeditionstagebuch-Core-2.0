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

/* ===== Core 2.1 GPS & Tracking ===== */
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
function exportTrackGpx(id){const t=(activeTrip.tracks||[]).find(x=>x.id===id);if(!t)return;const gpx=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Expeditionstagebuch Core 2.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(t.name||"Track")}</name><trkseg>${(t.points||[]).map(p=>`<trkpt lat="${p.lat}" lon="${p.lon}"><time>${p.time||""}</time></trkpt>`).join("")}</trkseg></trk></gpx>`;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([gpx],{type:"application/gpx+xml"}));a.download=(t.name||"track").replace(/[^a-z0-9_-]+/gi,"_")+".gpx";a.click();}
function exportLatestGpx(){const t=(activeTrip.tracks||[]).at(-1);if(!t)return alert("Noch kein gespeicherter Track vorhanden.");exportTrackGpx(t.id);}
const oldBindCore21=bind;bind=function(){oldBindCore21();$("gpsStartBtn").onclick=gpsStart;$("gpsPauseBtn").onclick=gpsPause;$("gpsResumeBtn").onclick=gpsResume;$("gpsFinishBtn").onclick=gpsFinish;$("gpsOpenMapBtn").onclick=()=>showView("mapView");$("gpxExportBtn").onclick=exportLatestGpx;};
const oldRenderAllCore21=renderAll;renderAll=function(){oldRenderAllCore21();renderGps();};
setInterval(()=>{const g=document.getElementById("gps");if(g&&g.classList.contains("active"))renderGps();},1000);

init();
