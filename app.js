(function(){

  /* ---------------------- reference data ---------------------- */
  const PROVIDERS = [
    { name:"Lakeside Family Medicine", spec:"Primary Care" },
    { name:"Crestview Orthopedics", spec:"Orthopedic Surgery" },
    { name:"Harbor Pediatrics", spec:"Pediatrics" },
    { name:"Northgate Diagnostic Imaging", spec:"Radiology" },
    { name:"Fairview Physical Therapy", spec:"Rehabilitation" },
    { name:"Summit Cardiology Group", spec:"Cardiology" },
    { name:"Elmhurst Urgent Care", spec:"Urgent Care" },
    { name:"Rosewood Dermatology", spec:"Dermatology" }
  ];

  const NAMES = ["Sana Iqbal","Marcus Reed","Fatima Noor","Daniel Osei","Ayesha Raza","Liam Carter",
    "Zainab Hussain","Noah Feldman","Hira Sheikh","Omar Aslam","Grace Kimani","Ahsan Tariq",
    "Priya Nair","Jonah Whitfield","Mahnoor Baig","Ethan Brooks"];

  const STATUSES = ["Submitted","Under Review","Approved","Denied","Paid"];
  const STATUS_COLOR = {
    "Submitted":"var(--slate)", "Under Review":"var(--amber)",
    "Approved":"var(--green)", "Denied":"var(--red)", "Paid":"var(--teal)"
  };
  const STATUS_CLASS = {
    "Submitted":"st-submitted","Under Review":"st-review",
    "Approved":"st-approved","Denied":"st-denied","Paid":"st-paid"
  };
  const SERVICES = ["Office Visit","Specialist Consultation","Lab Work","Imaging / MRI","Physical Therapy","Emergency Visit","Surgery","Prescription"];
  const SWATCHES = ["#0F6E63","#B8752B","#4468A8","#8A4B8C","#3D7A4F","#AE3B34"];
  const PLAN_TYPES = ["Employer Group","Individual & Family","Medicare Advantage","Medicaid Managed Care"];

  /* ---------------------- state ---------------------- */
  const STORAGE_KEY = "meridian_claims_data_v1";
  let CLIENTS = [];
  let activeClientId = null;
  let sortKey = "date", sortDir = -1;
  let activeStatusFilter = "all";
  let searchTerm = "";
  let pendingSwatch = SWATCHES[0];

  function uid(prefix){
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  }
  function newClaimId(){
    return "CLM-2026-" + Date.now().toString(36).toUpperCase().slice(-4) + Math.random().toString(36).slice(2,4).toUpperCase();
  }
  function newClientId(){ return uid("client"); }
  function fmtMoney(n){ return "PKR " + n.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2}); }
  function fmtDate(d){ return d.toLocaleDateString("en-US",{month:"short", day:"numeric", year:"numeric"}); }
  function rand(min,max){ return Math.random()*(max-min)+min; }
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function initials(name){
    return name.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
  }

  function getActiveClient(){ return CLIENTS.find(c=>c.id===activeClientId); }
  function getClaims(){ const c = getActiveClient(); return c ? c.claims : []; }

  /* ---------------------- seeding ---------------------- */
  function seedClaimsFor(count){
    const today = new Date(2026,7,20);
    const list = [];
    for (let i=0;i<count;i++){
      const daysAgo = Math.floor(rand(0,175));
      const date = new Date(today); date.setDate(date.getDate()-daysAgo);
      const submittedDate = new Date(date);
      submittedDate.setDate(submittedDate.getDate() + Math.floor(rand(0,5)));
      if (submittedDate > today) submittedDate.setTime(today.getTime());
      const status = weightedStatus();
      const amount = Math.round(rand(60,4200)*100)/100;
      list.push({
        id: newClaimId(),
        policyholder: pick(NAMES),
        member: "MB-" + Math.floor(rand(10000,99999)),
        provider: pick(PROVIDERS).name,
        service: pick(SERVICES),
        date: date,
        submittedDate: submittedDate,
        amount: amount,
        status: status,
        notes: pick([
          "Prior authorization on file.","Follow-up from ER visit on record.","Routine annual checkup.",
          "Referral from primary care physician.","Second opinion requested by member.",""
        ])
      });
    }
    list.sort((a,b)=> b.date - a.date);
    return list;
  }
  function weightedStatus(){
    const r = Math.random();
    if (r < 0.16) return "Submitted";
    if (r < 0.34) return "Under Review";
    if (r < 0.52) return "Approved";
    if (r < 0.66) return "Denied";
    return "Paid";
  }

  function addClient(name, plan, color, seedCount){
    const c = {
      id: newClientId(),
      name: name,
      plan: plan,
      color: color,
      claims: seedCount ? seedClaimsFor(seedCount) : []
    };
    CLIENTS.push(c);
    return c;
  }

  function seedClients(){
    addClient("Atlas Health Group", "Employer Group", "#0F6E63", 26);
    addClient("Beacon Mutual Insurance", "Individual & Family", "#B8752B", 17);
    addClient("Coastal Care Partners", "Medicare Advantage", "#4468A8", 9);
    activeClientId = CLIENTS[0].id;
  }

  /* ---------------------- remote persistence (Supabase) ---------------------- */
  const supabaseConfigured = typeof SUPABASE_URL !== "undefined" &&
    typeof SUPABASE_ANON_KEY !== "undefined" &&
    !SUPABASE_URL.includes("YOUR_SUPABASE") &&
    !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

  const db = supabaseConfigured && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  let currentUserId = null;

  function setSyncStatus(state, text){
    const pill = document.getElementById("sync-pill");
    const label = document.getElementById("sync-pill-text");
    pill.className = "sync-pill " + state;
    label.textContent = text;
  }

  function claimToRow(clientId, cl){
    return {
      id: cl.id, user_id: currentUserId, client_id: clientId, policyholder: cl.policyholder, member: cl.member,
      provider: cl.provider, service: cl.service,
      date: cl.date.toISOString().slice(0,10),
      submitted_date: cl.submittedDate.toISOString().slice(0,10),
      amount: cl.amount, status: cl.status, notes: cl.notes
    };
  }

  async function remoteLoad(){
    // RLS scopes both of these to the signed-in user automatically —
    // no explicit user_id filter needed here.
    const { data: clientRows, error: cErr } = await db.from("clients").select("*").order("created_at");
    if (cErr) throw cErr;
    const { data: claimRows, error: kErr } = await db.from("claims").select("*").order("date", { ascending:false });
    if (kErr) throw kErr;

    CLIENTS = clientRows.map(row=>({
      id: row.id, name: row.name, plan: row.plan, color: row.color,
      claims: claimRows.filter(cl=>cl.client_id===row.id).map(cl=>({
        id: cl.id, policyholder: cl.policyholder, member: cl.member,
        provider: cl.provider, service: cl.service,
        date: new Date(cl.date + "T00:00:00"),
        submittedDate: new Date(cl.submitted_date + "T00:00:00"),
        amount: Number(cl.amount), status: cl.status, notes: cl.notes || ""
      }))
    }));
    return CLIENTS.length > 0;
  }

  async function remoteSeedIfEmpty(){
    seedClients();
    for (const c of CLIENTS){
      await db.from("clients").insert({ id:c.id, user_id: currentUserId, name:c.name, plan:c.plan, color:c.color });
      if (c.claims.length){
        await db.from("claims").insert(c.claims.map(cl=>claimToRow(c.id, cl)));
      }
    }
  }

  async function remoteInsertClient(c){
    await db.from("clients").insert({ id:c.id, user_id: currentUserId, name:c.name, plan:c.plan, color:c.color });
  }
  async function remoteUpdateClient(c){
    await db.from("clients").update({ name:c.name, plan:c.plan, color:c.color }).eq("id", c.id);
  }
  async function remoteDeleteClient(id){
    await db.from("clients").delete().eq("id", id); // claims cascade
  }
  async function remoteInsertClaim(clientId, cl){
    await db.from("claims").insert(claimToRow(clientId, cl));
  }
  async function remoteUpdateClaim(clientId, cl){
    await db.from("claims").update(claimToRow(clientId, cl)).eq("id", cl.id);
  }
  async function remoteDeleteClaim(id){
    await db.from("claims").delete().eq("id", id);
  }

  // Fires a remote write without blocking the UI; flips the sync
  // pill to an error state (without discarding local changes) if it fails.
  function syncRemote(promiseFactory){
    if (!db) return;
    setSyncStatus("synced", "Syncing…");
    promiseFactory()
      .then(()=> setSyncStatus("synced", "Synced"))
      .catch(err=>{
        console.error("Sync failed:", err);
        setSyncStatus("error", "Sync error — retrying next change");
      });
  }

  /* ---------------------- local fallback (browser storage) ---------------------- */
  function lsSaveState(){
    try{
      const payload = {
        activeClientId,
        clients: CLIENTS.map(c=>({
          ...c,
          claims: c.claims.map(cl=>({
            ...cl,
            date: cl.date.toISOString(),
            submittedDate: cl.submittedDate.toISOString()
          }))
        }))
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch(e){
      console.error("Could not save to local storage:", e);
    }
  }

  function lsLoadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.clients || !data.clients.length) return false;

      CLIENTS = data.clients.map(c=>({
        ...c,
        claims: c.claims.map(cl=>({
          ...cl,
          date: new Date(cl.date),
          submittedDate: new Date(cl.submittedDate)
        }))
      }));
      activeClientId = CLIENTS.find(c=>c.id===data.activeClientId) ? data.activeClientId : CLIENTS[0].id;
      return true;
    } catch(e){
      console.error("Could not load saved data, falling back to sample data:", e);
      return false;
    }
  }

  function persistFallback(){
    if (!db) lsSaveState();
  }

  function resetToSampleData(){
    if (db){
      alert("Reset isn't wired up for the shared database yet — delete clients individually from the Clients tab instead.");
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    CLIENTS = [];
    seedClients();
    lsSaveState();
  }

  /* ---------------------- form setup ---------------------- */
  document.getElementById("f-date").valueAsDate = new Date(2026,7,20);
  let editingClaimId = null;

  const planSelect = document.getElementById("nc-plan");
  PLAN_TYPES.forEach(p=>{
    const o = document.createElement("option");
    o.value = p; o.textContent = p;
    planSelect.appendChild(o);
  });

  const swatchRow = document.getElementById("nc-swatches");
  SWATCHES.forEach((hex,i)=>{
    const s = document.createElement("div");
    s.className = "swatch" + (i===0 ? " selected" : "");
    s.style.background = hex;
    s.dataset.hex = hex;
    s.innerHTML = i===0 ? "✓" : "";
    s.addEventListener("click", ()=>{
      pendingSwatch = hex;
      document.querySelectorAll("#nc-swatches .swatch").forEach(sw=>{ sw.classList.remove("selected"); sw.innerHTML=""; });
      s.classList.add("selected"); s.innerHTML = "✓";
    });
    swatchRow.appendChild(s);
  });

  /* ---------------------- client switcher ---------------------- */
  const clientToggle = document.getElementById("client-toggle");
  const clientDropdown = document.getElementById("client-dropdown");

  clientToggle.addEventListener("click", (e)=>{
    e.stopPropagation();
    clientDropdown.classList.toggle("open");
    clientToggle.classList.toggle("open");
  });
  document.addEventListener("click", ()=>{
    clientDropdown.classList.remove("open");
    clientToggle.classList.remove("open");
  });

  function renderClientSwitcher(){
    const active = getActiveClient();
    document.getElementById("client-avatar-current").style.background = active.color;
    document.getElementById("client-avatar-current").textContent = initials(active.name);
    document.getElementById("client-name-label").textContent = active.name;

    document.getElementById("client-dropdown-list").innerHTML = CLIENTS.map(c=>`
      <div class="client-dropdown-item" data-id="${c.id}">
        <span class="client-avatar" style="background:${c.color}">${initials(c.name)}</span>
        <span class="cname">${c.name}</span>
        ${c.id===active.id ? '<span class="ccheck">✓</span>' : ''}
      </div>
    `).join("");

    document.querySelectorAll(".client-dropdown-item").forEach(item=>{
      item.addEventListener("click", ()=>{
        switchClient(item.dataset.id);
        clientDropdown.classList.remove("open");
        clientToggle.classList.remove("open");
      });
    });
  }

  function switchClient(id){
    activeClientId = id;
    renderAll();
  }

  document.getElementById("client-dropdown-add").addEventListener("click", ()=>{
    clientDropdown.classList.remove("open");
    clientToggle.classList.remove("open");
    openNewClientModal();
  });

  /* ---------------------- nav ---------------------- */
  document.querySelectorAll(".nav-item").forEach(item=>{
    item.addEventListener("click", ()=>{
      document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
      document.getElementById("view-"+item.dataset.view).classList.add("active");
      if (item.dataset.view === "reports") renderReports();
      if (item.dataset.view === "providers") renderProviders();
      if (item.dataset.view === "clients") renderClientsView();
    });
  });

  function goToView(view){
    document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
    const navItem = document.querySelector(`[data-view="${view}"]`);
    if (navItem) navItem.classList.add("active");
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    document.getElementById("view-"+view).classList.add("active");
  }

  /* ---------------------- stat cards ---------------------- */
  function renderStats(){
    const claims = getClaims();
    const total = claims.length;
    const pending = claims.filter(c=> c.status==="Submitted" || c.status==="Under Review").length;
    const paidClaims = claims.filter(c=> c.status==="Paid");
    const paidAmt = paidClaims.reduce((s,c)=> s+c.amount, 0);
    const deniedRate = total ? Math.round(claims.filter(c=>c.status==="Denied").length/total*100) : 0;

    const cards = [
      { label:"Total Claims", value: total, sub: pending + " awaiting decision", color:"var(--teal)" },
      { label:"Pending Review", value: pending, sub: "Submitted + Under Review", color:"var(--amber)" },
      { label:"Paid Out", value: fmtMoney(paidAmt), sub: paidClaims.length + " claims settled", color:"var(--green)" },
      { label:"Denial Rate", value: deniedRate + "%", sub: "of all filed claims", color:"var(--red)" }
    ];
    document.getElementById("stat-row").innerHTML = cards.map(c=>`
      <div class="stat-card">
        <div class="accent-bar" style="background:${c.color}"></div>
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub}</div>
      </div>
    `).join("");

    document.getElementById("nav-claims-count").textContent = total;
  }

  /* ---------------------- donut ---------------------- */
  function renderDonut(){
    const claims = getClaims();
    const total = claims.length;
    const counts = {};
    STATUSES.forEach(s=> counts[s] = claims.filter(c=>c.status===s).length);

    if (!total){
      document.getElementById("status-donut").style.background = "var(--slate-soft)";
    } else {
      let acc = 0;
      const stops = [];
      STATUSES.forEach(s=>{
        const pct = counts[s]/total*100;
        const start = acc; const end = acc + pct;
        stops.push(`${STATUS_COLOR[s]} ${start}% ${end}%`);
        acc = end;
      });
      document.getElementById("status-donut").style.background = `conic-gradient(${stops.join(",")})`;
    }
    document.getElementById("donut-n").textContent = total;
    document.getElementById("donut-total-hint").textContent = total + " claims on file";

    document.getElementById("status-legend").innerHTML = STATUSES.map(s=>`
      <div class="legend-item">
        <span class="legend-dot" style="background:${STATUS_COLOR[s]}"></span>
        ${s}
        <span class="lv">${counts[s]}</span>
      </div>
    `).join("");
  }

  /* ---------------------- monthly bars ---------------------- */
  function monthBuckets(){
    const claims = getClaims();
    const today = new Date(2026,7,20);
    const months = [];
    for (let i=5;i>=0;i--){
      const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
      months.push({ label: d.toLocaleDateString("en-US",{month:"short"}), y:d.getFullYear(), m:d.getMonth() });
    }
    return months.map(mo=>{
      const inMonth = claims.filter(c=> c.date.getFullYear()===mo.y && c.date.getMonth()===mo.m);
      const paid = inMonth.filter(c=>c.status==="Paid").reduce((s,c)=>s+c.amount,0);
      const pending = inMonth.filter(c=>c.status==="Submitted"||c.status==="Under Review"||c.status==="Approved").reduce((s,c)=>s+c.amount,0);
      const denied = inMonth.filter(c=>c.status==="Denied").reduce((s,c)=>s+c.amount,0);
      return { label:mo.label, paid, pending, denied, count: inMonth.length, billed: paid+pending+denied };
    });
  }

  function renderBars(targetId){
    const data = monthBuckets();
    const max = Math.max(1, ...data.map(d=> d.paid+d.pending+d.denied));
    document.getElementById(targetId).innerHTML = data.map(d=>{
      const total = d.paid + d.pending + d.denied;
      const scale = total ? (total/max*100) : 0;
      const paidPct = total ? d.paid/total*100 : 0;
      const pendPct = total ? d.pending/total*100 : 0;
      const denyPct = total ? d.denied/total*100 : 0;
      return `
        <div class="bar-col">
          <div class="amt">${total ? "PKR "+Math.round(total).toLocaleString() : "—"}</div>
          <div class="bar-stack" style="height:${scale}%;">
            <div class="bar-seg" style="height:${paidPct}%; background:var(--teal);" title="Paid"></div>
            <div class="bar-seg" style="height:${pendPct}%; background:var(--amber);" title="Pending/Approved"></div>
            <div class="bar-seg" style="height:${denyPct}%; background:var(--red);" title="Denied"></div>
          </div>
          <div class="mo">${d.label}</div>
        </div>
      `;
    }).join("");
  }

  /* ---------------------- recent activity ---------------------- */
  function renderRecent(){
    const claims = getClaims();
    const recent = [...claims].sort((a,b)=>b.date-a.date).slice(0,6);
    const body = document.getElementById("recent-body");
    if (!recent.length){
      body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--ink-soft); padding:30px;">No claims filed for this client yet.</td></tr>`;
      return;
    }
    body.innerHTML = recent.map(rowHtml).join("");
    attachRowClicks("recent-body");
  }

  function rowHtml(c){
    return `
      <tr data-id="${c.id}">
        <td class="claim-id">${c.id}</td>
        <td class="who"><div class="name">${c.policyholder}</div></td>
        <td class="who"><div class="provider">${c.provider || "—"}</div></td>
        <td>${fmtDate(c.submittedDate)}</td>
        <td><span class="stamp ${STATUS_CLASS[c.status]}">${c.status}</span></td>
        <td class="amt-cell">${fmtMoney(c.amount)}</td>
      </tr>
    `;
  }

  /* ---------------------- claims table ---------------------- */
  function filteredClaims(){
    let list = getClaims();
    if (activeStatusFilter !== "all") list = list.filter(c=>c.status===activeStatusFilter);
    if (searchTerm){
      const t = searchTerm.toLowerCase();
      list = list.filter(c=>
        c.id.toLowerCase().includes(t) ||
        c.policyholder.toLowerCase().includes(t) ||
        (c.provider || "").toLowerCase().includes(t)
      );
    }
    list = [...list].sort((a,b)=>{
      let av, bv;
      switch(sortKey){
        case "id": av=a.id; bv=b.id; break;
        case "policyholder": av=a.policyholder; bv=b.policyholder; break;
        case "provider": av=a.provider; bv=b.provider; break;
        case "status": av=a.status; bv=b.status; break;
        case "amount": av=a.amount; bv=b.amount; break;
        case "submitted": av=a.submittedDate; bv=b.submittedDate; break;
        default: av=a.date; bv=b.date;
      }
      if (av<bv) return -1*sortDir;
      if (av>bv) return 1*sortDir;
      return 0;
    });
    return list;
  }

  function renderClaimsTable(){
    const list = filteredClaims();
    document.getElementById("claims-count-hint").textContent = list.length + " of " + getClaims().length + " claims";
    const body = document.getElementById("claims-body");
    if (!list.length){
      body.innerHTML = "";
      document.getElementById("claims-empty").style.display = "block";
    } else {
      document.getElementById("claims-empty").style.display = "none";
      body.innerHTML = list.map(c=>`
        <tr data-id="${c.id}">
          <td class="claim-id">${c.id}</td>
          <td class="who"><div class="name">${c.policyholder}</div><div class="provider">${c.member}</div></td>
          <td>${c.provider || "—"}</td>
          <td>${c.service}</td>
          <td>${fmtDate(c.date)}</td>
          <td>${fmtDate(c.submittedDate)}</td>
          <td><span class="stamp ${STATUS_CLASS[c.status]}">${c.status}</span></td>
          <td class="amt-cell">${fmtMoney(c.amount)}</td>
        </tr>
      `).join("");
    }
    attachRowClicks("claims-body");
  }

  function attachRowClicks(bodyId){
    document.querySelectorAll("#"+bodyId+" tr[data-id]").forEach(tr=>{
      tr.addEventListener("click", ()=> openDetail(tr.dataset.id));
    });
  }

  document.querySelectorAll(".chip").forEach(chip=>{
    chip.addEventListener("click", ()=>{
      document.querySelectorAll(".chip").forEach(c=>c.classList.remove("active"));
      chip.classList.add("active");
      activeStatusFilter = chip.dataset.status;
      renderClaimsTable();
    });
  });

  document.querySelectorAll("[data-sort]").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.sort;
      if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
      renderClaimsTable();
    });
  });

  document.getElementById("global-search").addEventListener("input", (e)=>{
    searchTerm = e.target.value.trim();
    renderClaimsTable();
    goToView("claims");
  });

  /* ---------------------- providers view ---------------------- */
  function renderProviders(){
    const claims = getClaims();
    document.getElementById("provider-grid").innerHTML = PROVIDERS.map(p=>{
      const list = claims.filter(c=>c.provider===p.name);
      const paid = list.filter(c=>c.status==="Paid").reduce((s,c)=>s+c.amount,0);
      return `
        <div class="provider-card">
          <h4>${p.name}</h4>
          <div class="spec">${p.spec}</div>
          <div class="provider-stats">
            <div><div class="n">${list.length}</div><div class="l">Claims</div></div>
            <div><div class="n">${fmtMoney(paid)}</div><div class="l">Paid</div></div>
          </div>
        </div>
      `;
    }).join("");
  }

  /* ---------------------- clients management view ---------------------- */
  function renderClientsView(){
    const active = getActiveClient();
    const cards = CLIENTS.map(c=>{
      const total = c.claims.length;
      const pending = c.claims.filter(x=>x.status==="Submitted"||x.status==="Under Review").length;
      const paid = c.claims.filter(x=>x.status==="Paid").reduce((s,x)=>s+x.amount,0);
      return `
        <div class="client-card ${c.id===active.id ? "is-active":""}" data-id="${c.id}">
          ${c.id===active.id ? '<span class="active-tag">Active</span>' : ''}
          <div class="client-card-actions">
            <button class="icon-btn" data-edit-client="${c.id}" title="Edit client">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="icon-btn danger" data-delete-client="${c.id}" title="Delete client">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z"/></svg>
            </button>
          </div>
          <div class="client-card-head">
            <span class="client-avatar" style="background:${c.color}">${initials(c.name)}</span>
            <div>
              <h4>${c.name}</h4>
              <div class="plan">${c.plan}</div>
            </div>
          </div>
          <div class="client-card-stats">
            <div><div class="n">${total}</div><div class="l">Claims</div></div>
            <div><div class="n">${pending}</div><div class="l">Pending</div></div>
            <div><div class="n">${fmtMoney(paid)}</div><div class="l">Paid</div></div>
          </div>
        </div>
      `;
    }).join("");

    const addCard = `
      <div class="client-card-add" id="clients-add-card">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        Add new client
      </div>
    `;

    document.getElementById("client-grid").innerHTML = cards + addCard;

    document.querySelectorAll(".client-card[data-id]").forEach(card=>{
      card.addEventListener("click", ()=>{
        switchClient(card.dataset.id);
        goToView("dashboard");
      });
    });
    document.getElementById("clients-add-card").addEventListener("click", openNewClientModal);

    document.querySelectorAll("[data-edit-client]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        openEditClientModal(btn.dataset.editClient);
      });
    });
    document.querySelectorAll("[data-delete-client]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        e.stopPropagation();
        deleteClient(btn.dataset.deleteClient);
      });
    });
  }

  function deleteClient(id){
    if (CLIENTS.length <= 1){
      alert("You need at least one client — add a new one before deleting this one.");
      return;
    }
    const c = CLIENTS.find(x=>x.id===id);
    if (!c) return;
    if (!confirm(`Delete "${c.name}" and all ${c.claims.length} of their claims? This can't be undone.`)) return;

    CLIENTS = CLIENTS.filter(x=>x.id!==id);
    if (activeClientId === id){
      activeClientId = CLIENTS[0].id;
    }
    syncRemote(()=> remoteDeleteClient(id));
    renderAll();
    renderClientsView();
  }

  /* ---------------------- reports view ---------------------- */
  function renderReports(){
    renderBars("report-bars");
    const data = monthBuckets();
    document.getElementById("report-body").innerHTML = data.map(d=>`
      <tr>
        <td>${d.label}</td>
        <td style="text-align:right;">${d.count}</td>
        <td style="text-align:right;">${fmtMoney(d.billed)}</td>
        <td style="text-align:right;">${fmtMoney(d.paid)}</td>
        <td style="text-align:right;">${fmtMoney(d.denied)}</td>
      </tr>
    `).join("");
  }

  /* ---------------------- detail modal ---------------------- */
  const PIPELINE = ["Submitted","Under Review","Approved","Paid"];

  function openDetail(id){
    const claims = getClaims();
    const c = claims.find(x=>x.id===id);
    if (!c) return;
    const isDenied = c.status === "Denied";
    const currentIdx = isDenied ? 1 : PIPELINE.indexOf(c.status);

    const pipelineHtml = isDenied
      ? `
        <div class="pipeline">
          <div class="pipeline-step done"><div class="dot">✓</div><div class="lbl">Submitted</div></div>
          <div class="pipeline-step done"><div class="dot">✓</div><div class="lbl">Reviewed</div></div>
          <div class="pipeline-step denied"><div class="dot">✕</div><div class="lbl">Denied</div></div>
        </div>`
      : `
        <div class="pipeline">
          ${PIPELINE.map((step,i)=>`
            <div class="pipeline-step ${i<=currentIdx ? "done":""}">
              <div class="dot">${i<=currentIdx ? "✓" : i+1}</div>
              <div class="lbl">${step}</div>
            </div>
          `).join("")}
        </div>`;

    let actions = "";
    if (c.status === "Submitted") actions = `<button class="status-btn" data-action="Under Review">Move to review</button>`;
    if (c.status === "Under Review") actions = `<button class="status-btn" data-action="Approved">Approve</button><button class="status-btn danger" data-action="Denied">Deny</button>`;
    if (c.status === "Approved") actions = `<button class="status-btn" data-action="Paid">Mark as paid</button>`;
    if (c.status === "Denied" || c.status === "Paid") actions = `<span style="font-size:12px;color:var(--ink-soft);">Claim closed — no further action.</span>`;

    document.getElementById("detail-body").innerHTML = `
      <div class="detail-top">
        <div>
          <div class="claim-id mono">${c.id}</div>
          <h3>${c.policyholder}</h3>
        </div>
        <span class="stamp ${STATUS_CLASS[c.status]}" style="font-size:12px;">${c.status}</span>
      </div>
      ${pipelineHtml}
      <div class="detail-meta">
        <div><div class="k">Member ID</div><div class="v mono">${c.member}</div></div>
        <div><div class="k">Date of Service</div><div class="v">${fmtDate(c.date)}</div></div>
        <div><div class="k">Provider</div><div class="v">${c.provider || "—"}</div></div>
        <div><div class="k">Service Type</div><div class="v">${c.service}</div></div>
        <div><div class="k">Billed Amount</div><div class="v mono">${fmtMoney(c.amount)}</div></div>
        <div><div class="k">Submitted</div><div class="v">${fmtDate(c.submittedDate)}</div></div>
      </div>
      ${c.notes ? `<div class="k" style="font-size:10.5px;text-transform:uppercase;color:var(--ink-soft);margin-bottom:4px;">Adjuster Notes</div><div class="note-line" style="margin-bottom:16px;">${c.notes}</div>` : ""}
      <div class="detail-actions">
        <button class="status-btn" id="detail-edit-btn">Edit claim</button>
        <button class="status-btn danger" id="detail-delete-btn">Delete claim</button>
      </div>
      <div>
        <div class="k" style="font-size:10.5px;text-transform:uppercase;color:var(--ink-soft);margin-bottom:8px;">Update status</div>
        <div class="status-actions">${actions}</div>
      </div>
    `;

    document.querySelectorAll("#detail-body .status-btn:not(#detail-edit-btn):not(#detail-delete-btn)").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        c.status = btn.dataset.action;
        syncRemote(()=> remoteUpdateClaim(activeClientId, c));
        renderAll();
        openDetail(c.id);
      });
    });

    document.getElementById("detail-edit-btn").addEventListener("click", ()=>{
      document.getElementById("modal-detail").classList.remove("open");
      openEditModal(c.id);
    });
    document.getElementById("detail-delete-btn").addEventListener("click", ()=>{
      if (confirm(`Delete claim ${c.id} for ${c.policyholder}? This can't be undone.`)){
        const client = getActiveClient();
        client.claims = client.claims.filter(x=>x.id!==c.id);
        document.getElementById("modal-detail").classList.remove("open");
        syncRemote(()=> remoteDeleteClaim(c.id));
        renderAll();
      }
    });

    document.getElementById("modal-detail").classList.add("open");
  }

  /* ---------------------- modal open/close ---------------------- */
  document.querySelectorAll("[data-close]").forEach(btn=>{
    btn.addEventListener("click", ()=> document.getElementById(btn.dataset.close).classList.remove("open"));
  });
  document.querySelectorAll(".modal-overlay").forEach(ov=>{
    ov.addEventListener("click", (e)=>{ if (e.target === ov) ov.classList.remove("open"); });
  });
  function resetClaimForm(){
    ["f-policyholder","f-member","f-service","f-notes"].forEach(id=> document.getElementById(id).value="");
    document.getElementById("f-amount").value = "";
    document.getElementById("f-date").valueAsDate = new Date(2026,7,20);
  }

  document.getElementById("open-new-claim").addEventListener("click", ()=>{
    editingClaimId = null;
    document.getElementById("new-claim-modal-title").textContent = "File a new claim";
    document.getElementById("submit-new-claim").textContent = "Submit claim";
    resetClaimForm();
    document.getElementById("modal-new").classList.add("open");
  });

  function openEditModal(id){
    const c = getClaims().find(x=>x.id===id);
    if (!c) return;
    editingClaimId = id;
    document.getElementById("new-claim-modal-title").textContent = "Edit claim " + c.id;
    document.getElementById("submit-new-claim").textContent = "Save changes";
    document.getElementById("f-policyholder").value = c.policyholder;
    document.getElementById("f-member").value = c.member;
    document.getElementById("f-service").value = c.service;
    document.getElementById("f-date").valueAsDate = c.date;
    document.getElementById("f-amount").value = c.amount;
    document.getElementById("f-notes").value = c.notes;
    document.getElementById("modal-new").classList.add("open");
  }

  document.getElementById("submit-new-claim").addEventListener("click", ()=>{
    const policyholder = document.getElementById("f-policyholder").value.trim();
    const member = document.getElementById("f-member").value.trim();
    const service = document.getElementById("f-service").value.trim();
    const dateVal = document.getElementById("f-date").value;
    const amount = parseFloat(document.getElementById("f-amount").value);
    const notes = document.getElementById("f-notes").value.trim();

    if (!policyholder || !service || !dateVal || isNaN(amount) || amount <= 0){
      alert("Please fill in policyholder name, service type, date of service, and a valid billed amount.");
      return;
    }

    if (editingClaimId){
      const c = getClaims().find(x=>x.id===editingClaimId);
      if (c){
        c.policyholder = policyholder;
        c.member = member || c.member;
        c.service = service;
        c.date = new Date(dateVal + "T00:00:00");
        c.amount = amount;
        c.notes = notes;
        syncRemote(()=> remoteUpdateClaim(activeClientId, c));
      }
    } else {
      const today = new Date(2026,7,20);
      const newClaim = {
        id: newClaimId(),
        policyholder,
        member: member || ("MB-" + Math.floor(rand(10000,99999))),
        provider: "",
        service,
        date: new Date(dateVal + "T00:00:00"),
        submittedDate: today,
        amount,
        status: "Submitted",
        notes
      };
      getActiveClient().claims.unshift(newClaim);
      syncRemote(()=> remoteInsertClaim(activeClientId, newClaim));
    }

    document.getElementById("modal-new").classList.remove("open");
    editingClaimId = null;
    resetClaimForm();
    renderAll();
  });

  /* ---------------------- new / edit client modal ---------------------- */
  let editingClientId = null;

  function setSwatchSelection(hex){
    pendingSwatch = hex;
    document.querySelectorAll("#nc-swatches .swatch").forEach(sw=>{
      const on = sw.dataset.hex === hex;
      sw.classList.toggle("selected", on);
      sw.innerHTML = on ? "✓" : "";
    });
  }

  function openNewClientModal(){
    editingClientId = null;
    document.getElementById("new-client-modal-title").textContent = "Add a new client";
    document.getElementById("submit-new-client").textContent = "Add client";
    document.getElementById("nc-name").value = "";
    document.getElementById("nc-plan").selectedIndex = 0;
    setSwatchSelection(SWATCHES[0]);
    document.getElementById("modal-new-client").classList.add("open");
  }

  function openEditClientModal(id){
    const c = CLIENTS.find(x=>x.id===id);
    if (!c) return;
    editingClientId = id;
    document.getElementById("new-client-modal-title").textContent = "Edit client";
    document.getElementById("submit-new-client").textContent = "Save changes";
    document.getElementById("nc-name").value = c.name;
    const planIdx = PLAN_TYPES.indexOf(c.plan);
    document.getElementById("nc-plan").selectedIndex = planIdx >= 0 ? planIdx : 0;
    setSwatchSelection(c.color);
    document.getElementById("modal-new-client").classList.add("open");
  }

  document.getElementById("submit-new-client").addEventListener("click", ()=>{
    const name = document.getElementById("nc-name").value.trim();
    const plan = document.getElementById("nc-plan").value;
    if (!name){
      alert("Please enter a client name.");
      return;
    }

    if (editingClientId){
      const c = CLIENTS.find(x=>x.id===editingClientId);
      if (c){
        c.name = name;
        c.plan = plan;
        c.color = pendingSwatch;
        syncRemote(()=> remoteUpdateClient(c));
      }
    } else {
      const c = addClient(name, plan, pendingSwatch, 0);
      activeClientId = c.id;
      syncRemote(()=> remoteInsertClient(c));
    }

    editingClientId = null;
    document.getElementById("modal-new-client").classList.remove("open");
    renderAll();
    if (document.getElementById("view-clients").classList.contains("active")) renderClientsView();
  });

  /* ---------------------- render all ---------------------- */
  function renderAll(){
    persistFallback();
    renderClientSwitcher();
    document.getElementById("topbar-client-sub").textContent = "Managing claims for " + getActiveClient().name;
    renderStats();
    renderDonut();
    renderBars("month-bars");
    renderRecent();
    renderClaimsTable();
    if (document.getElementById("view-providers").classList.contains("active")) renderProviders();
    if (document.getElementById("view-clients").classList.contains("active")) renderClientsView();
    if (document.getElementById("view-reports").classList.contains("active")) renderReports();
  }

  document.getElementById("reset-data-link").addEventListener("click", (e)=>{
    e.preventDefault();
    if (confirm("This erases every saved client and claim in this browser and restores the original sample data. Continue?")){
      resetToSampleData();
      renderAll();
      goToView("dashboard");
    }
  });

  /* ---------------------- data loading (after auth, or immediately in local mode) ---------------------- */
  async function loadAppData(){
    const banner = document.getElementById("sync-banner");
    if (db){
      banner.classList.remove("show");
      setSyncStatus("synced", "Loading…");
      try{
        const hasData = await remoteLoad();
        if (!hasData) await remoteSeedIfEmpty();
        activeClientId = CLIENTS[0].id;
        setSyncStatus("synced", "Synced");
      } catch(err){
        console.error("Could not reach Supabase, falling back to local storage:", err);
        setSyncStatus("error", "Sync error — using local copy");
        if (!lsLoadState()) seedClients();
      }
    } else {
      banner.classList.add("show");
      setSyncStatus("local", "Local only");
      if (!lsLoadState()) seedClients();
    }
    renderAll();
  }

  /* ---------------------- authentication (Supabase Auth) ---------------------- */
  function showAuthView(id){
    ["auth-signin","auth-signup","auth-forgot","auth-update-password"].forEach(v=>{
      document.getElementById(v).style.display = (v===id) ? "block" : "none";
    });
    document.querySelectorAll(".auth-msg").forEach(m=> m.classList.remove("show"));
    document.getElementById("auth-screen").style.display = "flex";
    document.getElementById("app-root").style.display = "none";
  }
  function showMsg(id, text){
    const el = document.getElementById(id);
    el.textContent = text;
    el.classList.add("show");
  }
  function clearMsgs(){
    document.querySelectorAll(".auth-msg").forEach(m=> m.classList.remove("show"));
  }

  document.getElementById("show-forgot").addEventListener("click", (e)=>{ e.preventDefault(); showAuthView("auth-forgot"); });
  document.getElementById("show-signup").addEventListener("click", (e)=>{ e.preventDefault(); showAuthView("auth-signup"); });
  document.getElementById("show-signin-a").addEventListener("click", (e)=>{ e.preventDefault(); showAuthView("auth-signin"); });
  document.getElementById("show-signin-b").addEventListener("click", (e)=>{ e.preventDefault(); showAuthView("auth-signin"); });

  document.getElementById("auth-signin-btn").addEventListener("click", async ()=>{
    clearMsgs();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    if (!email || !password){ showMsg("auth-error", "Enter your email and password."); return; }
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error){ showMsg("auth-error", error.message); return; }
    // onAuthStateChange handles the transition into the app
  });

  document.getElementById("auth-signup-btn").addEventListener("click", async ()=>{
    clearMsgs();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    if (!email || !password || password.length < 6){
      showMsg("signup-error", "Enter an email and a password of at least 6 characters.");
      return;
    }
    const { data, error } = await db.auth.signUp({ email, password });
    if (error){ showMsg("signup-error", error.message); return; }
    if (!data.session){
      showMsg("signup-success", "Account created — check your email to confirm it, then sign in.");
    }
    // If email confirmation is off, onAuthStateChange fires SIGNED_IN automatically.
  });

  document.getElementById("auth-forgot-btn").addEventListener("click", async ()=>{
    clearMsgs();
    const email = document.getElementById("forgot-email").value.trim();
    if (!email){ showMsg("forgot-error", "Enter your email."); return; }
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split("#")[0] });
    if (error){ showMsg("forgot-error", error.message); return; }
    showMsg("forgot-success", "Check your email for a reset link.");
  });

  document.getElementById("auth-update-btn").addEventListener("click", async ()=>{
    clearMsgs();
    const pw = document.getElementById("update-password").value;
    if (!pw || pw.length < 6){ showMsg("update-error", "Password must be at least 6 characters."); return; }
    const { error } = await db.auth.updateUser({ password: pw });
    if (error){ showMsg("update-error", error.message); return; }
    document.getElementById("update-password").value = "";
    alert("Password updated.");
  });

  document.getElementById("sign-out-link").addEventListener("click", async (e)=>{
    e.preventDefault();
    await db.auth.signOut();
  });

  async function onAuthenticated(user){
    currentUserId = user.id;
    document.getElementById("auth-screen").style.display = "none";
    document.getElementById("app-root").style.display = "flex";
    document.getElementById("current-user-email").textContent = user.email;
    document.getElementById("sign-out-link").style.display = "inline";
    await loadAppData();
  }

  async function bootstrap(){
    if (!db){
      // No Supabase configured — auth doesn't apply, run in local-only mode.
      document.getElementById("auth-screen").style.display = "none";
      document.getElementById("app-root").style.display = "flex";
      document.getElementById("sign-out-link").style.display = "none";
      await loadAppData();
      return;
    }

    db.auth.onAuthStateChange((event, session)=>{
      if (event === "PASSWORD_RECOVERY"){
        showAuthView("auth-update-password");
      } else if (event === "SIGNED_IN" && session && session.user){
        onAuthenticated(session.user);
      } else if (event === "SIGNED_OUT"){
        currentUserId = null;
        CLIENTS = [];
        document.getElementById("sign-out-link").style.display = "none";
        showAuthView("auth-signin");
      }
    });

    const { data: { session } } = await db.auth.getSession();
    if (session && session.user){
      await onAuthenticated(session.user);
    } else {
      showAuthView("auth-signin");
    }
  }

  bootstrap();

})();
