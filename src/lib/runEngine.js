/* Orchestration: matches employees, walks the cycle day-by-day, applies monthly
   leave utilisation (consume CL/EL before LOP), and assembles the report rows. */
import { matchEmployees } from './matcher.js';
import { getWorkScheduleType } from './fiveDayParser.js';
import { determineAttendanceStatus, detectCompOffReviewCase, calculateLeaveUsageFromCodes, calculateLOPFromCodes, consumeFullDay, consumeHalfDay } from './attendanceEngine.js';
import { codeMeta } from './codeDictionary.js';
import { dateKey, fmtDate, fmtTime, normalizeTime, normalizeDate, WDL } from './excelHelpers.js';
import { HOLIDAY_COVERAGE_END } from '../data/holidays.js';

function runEngine({template, biometric, fiveList, holidayMap, cycle, settings, mappingOverride, openingOverride}){
  const audit=[]; const dict=settings.dict;
  // auto match (or apply overrides)
  const auto=matchEmployees(template.emps, biometric.blocks);
  const mapping={}; // ti -> bi or null
  template.emps.forEach((t,ti)=>{ const ov=mappingOverride&&mappingOverride[ti]; mapping[ti]= ov!==undefined? ov : (auto.matches[ti]?auto.matches[ti].bi:null); });

  const dailyRows=[], missingRows=[], compRows=[], summaries=[];
  const cycleKeys=cycle.days.map(dateKey);
  let totals={present:0,lop:0,msp:0,wo:0,hol:0,comp:0,half:0,review:0};

  template.emps.forEach((t,ti)=>{
    const schedule=getWorkScheduleType(t, fiveList);
    const bi=mapping[ti];
    const block= (bi!=null)? biometric.blocks[bi] : null;
    const ctx={scheduleType:schedule, holidayMap, settings, dict};
    const codesForRow={}; // dateKey -> code
    const empCodes=[];

    if(!block){
      audit.push({type:'Employee on roster, missing in biometric', detail:`${t.name} (${t.bioRaw??'no id'}) — no biometric data this month; day-cells left blank.`});
      summaries.push(buildSummaryStub(t,schedule)); return;
    }
    if(auto.matches[ti] && auto.matches[ti].conf!=='hi'){
      audit.push({type:'Employee mapping (review)', detail:`${t.name} ↔ biometric "${block.name}" (${block.idRaw}) matched by ${auto.matches[ti]?auto.matches[ti].how:'override'} — please confirm.`});
    }

    // effective opening balances (uploaded file / carry-forward / manual edits via
    // openingOverride; otherwise the embedded template value; unknown -> 0)
    const ovB=(openingOverride&&openingOverride[ti])||{};
    const pick=(a,b)=> a!=null?a : (b!=null?b:0);
    const eff={ openEL:pick(ovB.el,t.openEL), openCL:pick(ovB.cl,t.openCL), openCO:pick(ovB.co,t.openCO) };
    // monthly accrual: +1 EL for everyone; +1 CL for 6-day only (CL N/A to 5-day)
    const elAccr=settings.elAccrual;
    const clAccr=(schedule==='5-Day')?0:settings.clAccrual;
    // running available balance for the month (carried-over consumed before accrued; same total)
    const bal={ el:eff.openEL+elAccr, cl:(schedule==='5-Day')?0:(eff.openCL+clAccr) };

    cycle.days.forEach((d,di)=>{
      const k=cycleKeys[di];
      // joining handling
      if(t.doj && d < t.doj){ codesForRow[k]='';
        if(di===0) audit.push({type:'JOINED ON', detail:`${t.name} DOJ ${fmtDate(t.doj)} is within/after cycle start — pre-joining days left blank.`});
        return; }
      const rec=block.byKey[k]!=null? block.records[block.byKey[k]] : null;
      const st=determineAttendanceStatus(d, rec, ctx);

      // apply monthly leave utilisation to confirmed absences (consume CL/EL before LOP)
      let finalCode=st.code, remark=st.remark;
      if(st.code==='L'){ const r=consumeFullDay(bal,schedule); finalCode=r.code; remark=r.remark; }
      else if(st.code==='P/A'){ const r=consumeHalfDay(bal,schedule,true);  finalCode=r.code; remark=r.remark; }
      else if(st.code==='A/P'){ const r=consumeHalfDay(bal,schedule,false); finalCode=r.code; remark=r.remark; }

      codesForRow[k]=finalCode; empCodes.push(finalCode);

      // tallies from the final code
      const mf=codeMeta(finalCode,dict);
      if(mf){ if(mf.kind==='holiday')totals.hol++; if(mf.kind==='weekoff')totals.wo++; if(mf.kind==='missing')totals.msp++; if(mf.half)totals.half++; }
      if(finalCode==='P'||finalCode==='OD')totals.present++;
      if(mf&&mf.lop)totals.lop+=mf.lop;
      if(st.flags.review)totals.review++;

      // daily register row
      dailyRows.push({ id:t.bioRaw??block.idRaw, name:t.name, date:fmtDate(d), day:WDL[d.getUTCDay()], schedule,
        inT:rec?fmtTime(normalizeTime(rec.inV)):'', outT:rec?fmtTime(normalizeTime(rec.outV)):'',
        hours: st.hours!=null? st.hours.toFixed(2):'', raw: rec?rec.dayStatus:'(no record)', code:finalCode, remark, review:!!st.flags.review });

      if(st.flags.missingPunch){ missingRows.push({id:t.bioRaw??block.idRaw, name:t.name, date:fmtDate(d), day:WDL[d.getUTCDay()],
        type:`Missing ${st.flags.missingPunch.missing} Punch`, inT:rec?fmtTime(normalizeTime(rec.inV)):'', outT:rec?fmtTime(normalizeTime(rec.outV)):'', raw:rec?rec.dayStatus:'', remark:st.remark}); }
      const co=detectCompOffReviewCase(t,d,rec,st);
      if(co){ totals.comp++; compRows.push({id:t.bioRaw??block.idRaw, name:t.name, date:fmtDate(d), day:WDL[d.getUTCDay()], schedule, reason:co,
        inT:rec?fmtTime(normalizeTime(rec.inV)):'', outT:rec?fmtTime(normalizeTime(rec.outV)):'', hours:st.hours!=null?st.hours.toFixed(2):'',
        suggest:'HR to confirm CO / CO/2 / ECO / ECO/2 manually'}); }
    });

    const used=calculateLeaveUsageFromCodes(empCodes,dict);
    const lop=calculateLOPFromCodes(empCodes,dict);
    // closing balances reflect the auto-consumption (running remainder)
    const closeEL = Math.max(0, bal.el);
    const closeCL = (schedule==='5-Day') ? eff.openCL : Math.max(0, bal.cl);
    const closeCO = eff.openCO;
    const activeDays=cycle.days.filter(d=> (!t.doj||d>=t.doj)).length;

    summaries.push({ id:t.bioRaw??block.idRaw, name:t.name, unit:t.unit||'', schedule,
      present:empCodes.filter(c=>c==='P'||c==='OD').length, half:empCodes.filter(c=>{const m=codeMeta(c,dict);return m&&m.half;}).length,
      lop, el:used.el, cl:used.cl, ml:used.ml, wo:empCodes.filter(c=>{const m=codeMeta(c,dict);return m&&m.kind==='weekoff';}).length,
      nh:empCodes.filter(c=>c==='NH').length, fh:empCodes.filter(c=>c==='FH').length, ho:empCodes.filter(c=>c==='HO').length,
      msp:empCodes.filter(c=>c==='MSP').length, co:used.co, eco:used.eco,
      openEL:eff.openEL, closeEL, openCL:eff.openCL, closeCL, openCO:eff.openCO, closeCO, elAccr, clAccr,
      twd:activeDays, paid:activeDays-lop, _row:t.row, _codes:codesForRow });
  });

  // biometric-only extras -> audit
  auto.unmatchedB.forEach(bi=>{ if(Object.values(mapping).indexOf(bi)===-1){ const b=biometric.blocks[bi];
    audit.push({type:'Employee in biometric, not on roster', detail:`${b.name} (${b.idRaw}) present in biometric but not on the built-in payroll roster — not added. If a permanent hire, ask for the roster to be updated.`}); }});
  audit.push({type:'Info', detail:`Leave utilisation: 6-day staff CL -> EL -> LOP; 5-day staff EL -> LOP (CL not applicable). Available balances consumed before any LOP.`});
  audit.push({type:'Info', detail:`Default classification: employees not on the 5-day list are treated as 6-day.`});
  audit.push({type:'Info', detail:`All Sundays marked "${settings.sundayCode}" (and Saturdays "${settings.saturdayOffCode}" for 5-day staff). Built-in holiday list applied per work schedule.`});
  // holiday-coverage warning if the cycle runs past the embedded list
  const covEnd=normalizeDate(HOLIDAY_COVERAGE_END);
  if(covEnd && cycle.end>covEnd){ audit.push({type:'Holiday coverage', detail:`This cycle extends to ${fmtDate(cycle.end)}, beyond the built-in holiday list (through ${fmtDate(covEnd)}). Jan-Mar 2027 holidays are not yet loaded - verify any holidays after ${fmtDate(covEnd)} manually.`}); }

  return {mapping, auto, dailyRows, missingRows, compRows, summaries, audit, totals};
}
function buildSummaryStub(t,schedule){ return {id:t.bioRaw??'', name:t.name, unit:t.unit||'', schedule, present:'',half:'',lop:'',el:'',cl:'',ml:'',wo:'',nh:'',fh:'',ho:'',msp:'',co:'',eco:'',openEL:t.openEL,closeEL:'',openCL:t.openCL,closeCL:'',openCO:t.openCO,closeCO:'',elAccr:0,clAccr:0,twd:'',paid:'',_row:t.row,_codes:null,_stub:true}; }

export { runEngine, buildSummaryStub };
