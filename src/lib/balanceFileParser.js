/* Parses the optional "EL / CL / CO Opening Balance" upload.
   Expected header (any column order): Employee ID | Name | Opening EL | Opening CL | Opening CO
   Returns [{ id, name, nname, el, cl, co }]. Matched to the roster by ID then name. */
import { cv, normId, normName } from './excelHelpers.js';
import { numOrNull } from './templateParser.js';

export function parseBalanceFile(wb){
  const ws=wb.worksheets[0];
  let hr=null, cID=null, cName=null, cEL=null, cCL=null, cCO=null;
  for(let r=1;r<=Math.min(ws.rowCount,15);r++){
    for(let c=1;c<=ws.columnCount;c++){ const t=cv(ws.getCell(r,c));
      if(typeof t==='string'){ const s=t.toLowerCase().trim();
        if(/employee\s*id|emp.*id|^id$/.test(s)) cID=c;
        else if(/name/.test(s)) cName=c;
        if(/opening\s*el|^el\b/.test(s)) cEL=c;
        if(/opening\s*cl|^cl\b/.test(s)) cCL=c;
        if(/opening\s*co|^co\b/.test(s)) cCO=c;
      }
    }
    if(cEL && (cID||cName)){ hr=r; break; }
  }
  if(hr==null) return [];
  const out=[];
  for(let r=hr+1;r<=ws.rowCount;r++){
    const id=cID?cv(ws.getCell(r,cID)):null;
    const nm=cName?cv(ws.getCell(r,cName)):null;
    if(id==null && (nm==null||String(nm).trim()==='')) continue;
    out.push({ id:normId(id), name:String(nm||'').trim(), nname:normName(nm),
      el:cEL?numOrNull(cv(ws.getCell(r,cEL))):null,
      cl:cCL?numOrNull(cv(ws.getCell(r,cCL))):null,
      co:cCO?numOrNull(cv(ws.getCell(r,cCO))):null });
  }
  return out;
}

/* Match balance rows to roster employees (ID first, then normalised name).
   Returns an openingOverride map: ti -> { el, cl, co }. */
export function balanceRowsToOverride(rows, templateEmps){
  const byId={}, byName={};
  templateEmps.forEach((t,ti)=>{ if(t.id) byId[t.id]=ti; if(t.nname) byName[t.nname]=ti; });
  const ov={}; const unmatched=[];
  rows.forEach(row=>{
    let ti = (row.id!=null && byId[row.id]!=null) ? byId[row.id]
           : (row.nname && byName[row.nname]!=null) ? byName[row.nname] : null;
    if(ti==null){ unmatched.push(row.name||row.id); return; }
    ov[ti]={ el:row.el, cl:row.cl, co:row.co };
  });
  return { override:ov, unmatched };
}
