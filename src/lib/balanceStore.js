/* Persists monthly closing balances in the browser so the next month pre-fills
   automatically. Keyed by employee (ID if present, else normalised name). */
const KEY=(y,m)=>`aa_bal_${y}_${String(m).padStart(2,'0')}`;
export const empKey = emp => `${emp.id||''}|${emp.nname||''}`;

export function saveClosing(year, month, map){
  try{ localStorage.setItem(KEY(year,month), JSON.stringify(map)); return true; }
  catch(e){ return false; }
}
export function loadClosing(year, month){
  try{ const s=localStorage.getItem(KEY(year,month)); return s? JSON.parse(s) : null; }
  catch(e){ return null; }
}
export function prevMonth(year, month){ return month===1 ? {year:year-1, month:12} : {year, month:month-1}; }

/* Build an openingOverride (ti -> {el,cl,co}) from a stored closing map. */
export function storedToOverride(stored, templateEmps){
  if(!stored) return {};
  const ov={};
  templateEmps.forEach((t,ti)=>{ const v=stored[empKey(t)]; if(v) ov[ti]={el:v.el, cl:v.cl, co:v.co}; });
  return ov;
}

/* Build a closing map (keyed by employee) from engine summaries, to persist. */
export function summariesToClosing(summaries, templateEmps){
  const byRow={}; templateEmps.forEach(t=> byRow[t.row]=t);
  const map={};
  summaries.forEach(s=>{ if(s._stub) return; const t=byRow[s._row]; if(!t) return;
    const num=v=> (typeof v==='number')? v : null;
    map[empKey(t)]={ el:num(s.closeEL), cl:num(s.closeCL), co:num(s.closeCO) };
  });
  return map;
}
