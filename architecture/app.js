'use strict';
const diagramSources = {
  "stack": "flowchart TB\n  subgraph A[\"Participant A's machine\"]\n    UA[\":o UI\"] <--> BA[\"Local bridge A\"]\n    BA <--> HA[\"Owned harnesses\"]\n  end\n  subgraph B[\"Participant B's machine\"]\n    UB[\":o UI\"] <--> BB[\"Local bridge B\"]\n    BB <--> HB[\"Owned harnesses\"]\n  end\n  BA <-->|WSS| G[\"Worker: login and room routing\"]\n  BB <-->|WSS| G\n  More[\"More participant bridges\"] <--> G\n  G <--> R[\"Room per channel or direct chat\"]\n  R <--> E[(\"SQLite events and messages\")]\n  G <--> D[(\"D1 workspace directory\")]\n  G <--> F[(\"R2 artifacts\")]\n",
  "messages": "flowchart LR\n  A[\"Alex's UI\"] <--> BA[\"Bridge A\"]\n  BA <--> R[\"One shared room: saved order\"]\n  R <--> BB[\"Bridge B\"]\n  BB <--> B[\"Jo's UI\"]\n  HA[\"the Alex harness\"] <--> BA\n  BB <--> HB[\"Jo's harness\"]\n",
  "participation": "flowchart LR\n  M[\"Human sends message\"] --> R[\"Save in shared room\"]\n  R --> C{\"Agent tagged, or enabled condition met?\"}\n  C -->|no| Q[\"No harness run\"]\n  C -->|yes| P[\"Check owner permission and budget\"]\n  P --> B[\"Owner's bridge: run selected harness\"]\n  B --> O[\"Reply or artifact in chat\"]\n",
  "projects": "flowchart LR\n  C[\"Project channel\"] --> G[\"GitHub repository and collaborator invites\"]\n  C --> R[\"Tagged agent request\"]\n  R --> B[\"Owner's bridge and tools\"]\n  B --> F[\"Music, GIF, code, or other output\"]\n  F --> S[(\"Private artifact storage\")]\n  S --> C\n  F -->|branch and PR| G\n",
  "hordes": "flowchart TB\n  W[\"Workspace: people, projects, agents\"] --> C[\"Channels and direct chats\"]\n  W --> M[\"Community mission\"]\n  M --> T[\"Task claims, budgets, and dependencies\"]\n  T --> A[\"Task room A and contributor bridges\"]\n  T --> B[\"Task room B and contributor bridges\"]\n  A --> V[\"Review artifacts and evidence\"]\n  B --> V\n  V --> S[\"Accepted findings in mission summary\"]\n",
  "backends": "flowchart LR\n  C[\"Same versioned chat protocol\"] --> A[\"Cloudflare room object\"]\n  C --> B[\"Node room service\"]\n  C --> S[\"Supabase transaction and Realtime\"]\n  A --> A1[(\"SQLite events\")]\n  B --> B1[(\"Postgres events and outbox\")]\n  S --> S1[(\"Postgres events and outbox\")]\n  A1 --> V[\"Ordered history and reconnect replay\"]\n  B1 --> V\n  S1 --> V\n",
  "appa": "flowchart LR\n  Chat[\"Shared context and provenance\"] --> H[\"Local harness\"]\n  H --> Hook[\"Blocking tool hook\"]\n  Hook --> P[\"OpenAPPA: policy decision\"]\n  P -->|allow| T[\"Tool on owner's machine\"]\n  P -->|deny or remedy| H\n  T -->|labeled result| Hook\n",
  "mvp": "flowchart LR\n  A[\"3 people in 1 workspace\"] --> B[\"Project channel and direct chats\"]\n  B --> C[\"3 local bridges\"]\n  C --> D[\"2 connected agents on 2 harnesses\"]\n  D --> E[\"Shared outputs, replay, notifications\"]\n"
};

let activeSection = 'stack';
let diagramGeneration = 0;
let diagramQueue = Promise.resolve();
let costChart;
let supabaseChart;
const sections = new Set(['stack','participation','messages','projects','hordes','backends','costs','openappa','mvp']);
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function isDark(){const mode=document.documentElement.dataset.theme||'system';return mode==='dark'||(mode==='system'&&mq.matches);}
function diagramTheme(){
  const dark=isDark();
  return {startOnLoad:false,securityLevel:'strict',theme:'base',fontFamily:'Arial, Helvetica, sans-serif',
    themeVariables:{fontSize:'13px',primaryColor:dark?'#1d2530':'#FAFAF7',primaryTextColor:dark?'#e1e6ed':'#293345',
      primaryBorderColor:dark?'#afc0ed':'#2148B8',lineColor:dark?'#8598b5':'#657086',secondaryColor:dark?'#242e3b':'#f0f1ed',
      tertiaryColor:dark?'#151a21':'#FAFAF7',clusterBkg:dark?'#151a21':'#FAFAF7',clusterBorder:dark?'#354050':'#dce0e5',
      actorBkg:dark?'#1d2530':'#FAFAF7',actorBorder:dark?'#afc0ed':'#2148B8',actorTextColor:dark?'#e1e6ed':'#293345',
      signalColor:dark?'#afc0ed':'#2148B8',signalTextColor:dark?'#e1e6ed':'#293345',labelBoxBkgColor:dark?'#151a21':'#FAFAF7',
      edgeLabelBackground:dark?'#151a21':'#FAFAF7'},flowchart:{curve:'linear',nodeSpacing:24,rankSpacing:34},sequence:{useMaxWidth:true,actorMargin:30,diagramMarginX:8}};
}
function renderActiveDiagram(){
  const container=document.querySelector('#'+activeSection+' [data-diagram]');
  if(!container || !window.mermaid)return;
  const source=diagramSources[container.dataset.diagram];
  const generation=++diagramGeneration;
  diagramQueue=diagramQueue.catch(()=>{}).then(async()=>{
    if(generation!==diagramGeneration)return;
    mermaid.initialize(diagramTheme());
    try{
      const rendered=await mermaid.render('sf_diagram_'+generation,source);
      if(generation===diagramGeneration){container.innerHTML=rendered.svg;if(rendered.bindFunctions)rendered.bindFunctions(container);}
    }catch(error){
      const fallback=document.createElement('pre');fallback.className='fallback';fallback.textContent=source;container.replaceChildren(fallback);
      console.error('Diagram could not render',error);
    }
  });
}
function showSection(){
  const requested=location.hash.slice(1);
  activeSection=sections.has(requested)?requested:'stack';
  for(const panel of document.querySelectorAll('.panel'))panel.hidden=panel.id!==activeSection;
  for(const link of document.querySelectorAll('aside nav a')){
    if(link.hash==='#'+activeSection)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  renderActiveDiagram();
  if(activeSection==='costs'){updateCosts();updateSupabase();}
}
function refreshVisuals(){renderActiveDiagram();if(activeSection==='costs'){updateCosts();updateSupabase();}}
window.addEventListener('hashchange',showSection);
window.addEventListener('sf-theme-change',refreshVisuals);
mq.addEventListener('change',refreshVisuals);

// A fixed illustration, deliberately independent of any real room or harness.
const simEvents=[
  {type:'create',id:41,sender:'Alex',body:'@alex-agent can we try a smaller game map?',note:'Alex tags an owned agent. The room saves the request as #41 and both views receive it.'},
  {type:'create',id:42,sender:'Alex agent / Pi',body:'Waiting for local runner',agent:true,context:'41',state:'queued',note:'The room saves empty reply #42 and freezes context containing message #41 before starting the Alex harness.'},
  {type:'update',id:42,body:'A compact map would let us...',state:'streaming',note:'The first output batch fills #42. It keeps its original position.'},
  {type:'create',id:43,sender:'Jo',body:'@jo-agent help me plan the terrain.',note:'Jo sends #43 while the Alex agent is working. It appears after the empty reply #42.'},
  {type:'create',id:44,sender:'Jo agent / Codex',body:'Waiting for local runner',agent:true,context:'41, 43',state:'queued',note:"Jo's agent gets empty reply #44. Its frozen context includes #41 and #43; the incomplete #42 is excluded."},
  {type:'update',id:42,body:'Try a 32 x 32 map. It leaves enough room to test the movement system.',state:'complete',note:'The Alex agent finishes #42. Completion does not move it after newer messages.'},
  {type:'update',id:44,body:'I can draft the terrain layout...',state:'streaming',note:"Jo's agent streams into #44 using its earlier snapshot. The completed #42 has not silently entered its prompt."},
  {type:'create',id:45,sender:'Alex',body:'Keep a clear path through the center.',note:'Alex message #45 is accepted during the second run. It can be included in the next request.'},
  {type:'update',id:44,body:'I can draft three terrain layouts for a 32 x 32 map.',state:'complete',note:"The second run finishes in #44. Both views retain order 41, 42, 43, 44, 45."},
  {type:'duplicate',id:45,note:'A retry of Alex previous send returns the original #45 acknowledgment. No new event or message is created.'}
];
let simIndex=0;
function renderSimulation(){
  const messages=[];
  let committed=0;
  for(const event of simEvents.slice(0,simIndex)){
    if(event.type==='create')messages.push({...event});
    if(event.type==='update')Object.assign(messages.find(m=>m.id===event.id),{body:event.body,state:event.state});
    if(event.type!=='duplicate')committed++;
  }
  for(const id of ['view-a','view-b']){
    const view=document.getElementById(id);view.replaceChildren();
    for(const message of messages){
      const row=document.createElement('li');if(message.agent)row.classList.add('agent');
      const sender=document.createElement('div');sender.className='sender';
      const name=document.createElement('span');name.textContent=message.sender;
      const position=document.createElement('span');position.textContent='#'+message.id;sender.append(name,position);
      const body=document.createElement('p');body.className='body';body.textContent=message.body;row.append(sender,body);
      if(message.agent){const metadata=document.createElement('div');metadata.className='run';metadata.textContent=message.state+' / context: '+message.context;row.append(metadata);}
      view.append(row);
    }
  }
  document.getElementById('sim-count').textContent=simIndex+' / '+simEvents.length+' steps | '+committed+' committed events';
  document.getElementById('sim-description').textContent=simIndex?simEvents[simIndex-1].note:'Start with one sent message. Use Next event to see how concurrent replies keep their positions.';
  document.getElementById('sim-next').disabled=simIndex===simEvents.length;
}
document.getElementById('sim-next').addEventListener('click',()=>{if(simIndex<simEvents.length)simIndex++;renderSimulation();});
document.getElementById('sim-reset').addEventListener('click',()=>{simIndex=0;renderSimulation();});
renderSimulation();

function boundedInput(id,defaultValue){
  const input=document.getElementById(id), raw=Number(input.value);
  if(input.value===''||!Number.isFinite(raw))return defaultValue;
  return Math.max(Number(input.min||0),Math.min(Number(input.max||1e10),raw));
}
function overage(usage,included,unit,price){return Math.ceil(Math.max(0,usage-included)/unit)*price;}
function updateCosts(){
  const rooms=boundedInput('rooms',100),hours=boundedInput('hours',8),events=Number(document.getElementById('events').value),
    handler=boundedInput('handler',10),connections=boundedInput('connections',150000);
  const residentSeconds=rooms*hours*3600*30;
  const activeSeconds=Math.min(residentSeconds,events*handler/1000);
  const requestCost=overage(connections+events/20,1e6,1e6,.15);
  const sleeping=5+requestCost+overage(activeSeconds*.128,400000,1e6,12.5);
  const resident=5+requestCost+overage(residentSeconds*.128,400000,1e6,12.5);
  const money=value=>'$'+value.toFixed(2);
  document.getElementById('cost-sleep').textContent=money(sleeping);
  document.getElementById('cost-awake').textContent=money(resident);
  const rows=boundedInput('cf-rows',3),storage=boundedInput('cf-storage',5);
  const dataCost=overage(events*rows,50e6,1e6,1)+Math.max(0,storage-5)*.2;
  document.getElementById('cf-data-cost').textContent=money(dataCost);
  document.getElementById('cf-total').textContent=money(sleeping+dataCost);
  document.getElementById('cost-detail').textContent='Modeled duration: '+Math.round(activeSeconds*.128).toLocaleString()+' GB-s with hibernation; '+Math.round(residentSeconds*.128).toLocaleString()+' GB-s if resident. Request overage: '+money(requestCost)+'.';
  const dark=isDark(),color=dark?'#a0aab9':'#657086',line=dark?'#354050':'#dce0e5';
  const canvas=document.getElementById('cost-chart');
  canvas.setAttribute('aria-label','Monthly compute subtotal: '+money(sleeping)+' with hibernation; '+money(resident)+' for always resident rooms.');
  if(!window.Chart)return;
  if(!costChart){
    costChart=new Chart(canvas,{type:'bar',data:{labels:['Hibernatable','Always resident'],datasets:[{label:'Monthly compute subtotal, USD',data:[sleeping,resident],backgroundColor:['#2148B8','#C83232'],maxBarThickness:55,borderRadius:0}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>money(ctx.raw)}}},scales:{x:{beginAtZero:true,ticks:{color,callback:value=>'$'+value},grid:{color:line},border:{display:false}},y:{ticks:{color},grid:{display:false},border:{display:false}}}}});
  }else{costChart.data.datasets[0].data=[sleeping,resident];costChart.options.scales.x.ticks.color=color;costChart.options.scales.y.ticks.color=color;costChart.options.scales.x.grid.color=line;costChart.resize();costChart.update('none');}
}
for(const id of ['rooms','hours','events','handler','connections','cf-rows','cf-storage'])document.getElementById(id).addEventListener('input',updateCosts);

function updateSupabase(){
  const broadcasts=boundedInput('sb-broadcasts',1e6),receivers=boundedInput('sb-receivers',10);
  const subtotal=n=>25+overage(broadcasts*(1+n),5e6,1e6,2.5);
  const total=broadcasts*(1+receivers);
  document.getElementById('sb-messages').textContent=Math.round(total).toLocaleString();
  document.getElementById('sb-cost').textContent='$'+subtotal(receivers).toFixed(2);
  const counts=[2,10,100], values=counts.map(subtotal), canvas=document.getElementById('sb-chart');
  canvas.setAttribute('aria-label','Supabase base plus message overage for '+broadcasts.toLocaleString()+' broadcasts: '+counts.map((n,i)=>n+' receivers: $'+values[i].toFixed(2)).join('; '));
  if(!window.Chart)return;
  const color=isDark()?'#a0aab9':'#657086',line=isDark()?'#354050':'#dce0e5';
  if(!supabaseChart){supabaseChart=new Chart(canvas,{type:'bar',data:{labels:counts.map(n=>n+' receivers'),datasets:[{data:values,backgroundColor:'#2148B8',maxBarThickness:40}]},options:{responsive:true,maintainAspectRatio:false,animation:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{color,callback:value=>'$'+value},grid:{color:line}},y:{ticks:{color},grid:{display:false}}}}});}
  else{supabaseChart.data.datasets[0].data=values;supabaseChart.options.scales.x.ticks.color=color;supabaseChart.options.scales.y.ticks.color=color;supabaseChart.options.scales.x.grid.color=line;supabaseChart.resize();supabaseChart.update('none');}
}
for(const id of ['sb-broadcasts','sb-receivers'])document.getElementById(id).addEventListener('input',updateSupabase);
showSection();
