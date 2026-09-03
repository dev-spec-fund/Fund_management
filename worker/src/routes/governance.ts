import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAdmin, requireFinance, requireCloseMonth } from "../auth";
import { auditEntity, ensureOperationalSchema, isMonthClosed, requireOpenMonth } from "../ops";
import { validMonth } from "../validation";
import { currentMonth, getBranding } from "../db";
import { sendMessage } from "../telegram";
import { rateForMonthFromRows } from "../contributionRates";

export const governanceRoute = new Hono<AppEnv>();

const monthRx=/^\d{4}-(0[1-9]|1[0-2])$/;
const yearRx=/^\d{4}$/;
const n=(v:any)=>Number(v||0);

async function monthMetrics(env:any, month:string){
  const [cash,donations,expenses,memberRows,pendingContrib,openErrors,lastBackup]=await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE status='approved' AND month=?").bind(month).first<any>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month=?").bind(month).first<any>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month=?").bind(month).first<any>(),
    env.DB.prepare(`
      WITH paid AS (
        SELECT member_id,SUM(amount) paid FROM (
          SELECT ca.member_id,ca.amount FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id WHERE ca.month=? AND c.status='approved'
          UNION ALL
          SELECT c.member_id,c.amount FROM contributions c WHERE c.month=? AND c.status='approved' AND NOT EXISTS(SELECT 1 FROM contribution_allocations x WHERE x.contribution_id=c.id)
        ) GROUP BY member_id
      )
      SELECT m.id,
        COALESCE((SELECT r.amount FROM member_contribution_rates r WHERE r.member_id=m.id AND r.effective_from<=? AND (r.effective_to IS NULL OR r.effective_to>=?) ORDER BY r.effective_from DESC LIMIT 1),m.monthly_amount) monthly_amount,
        COALESCE(p.paid,0) paid,
        CASE WHEN ex.member_id IS NOT NULL THEN 'exempt' WHEN COALESCE(p.paid,0)<=0 THEN 'unpaid' WHEN COALESCE(p.paid,0)<COALESCE((SELECT r.amount FROM member_contribution_rates r WHERE r.member_id=m.id AND r.effective_from<=? AND (r.effective_to IS NULL OR r.effective_to>=?) ORDER BY r.effective_from DESC LIMIT 1),m.monthly_amount) THEN 'partial' ELSE 'paid' END payment_status
      FROM members m LEFT JOIN paid p ON p.member_id=m.id LEFT JOIN exemptions ex ON ex.member_id=m.id AND ex.month=?
      WHERE m.active=1 AND substr(COALESCE(m.joined_at,m.created_at),1,7)<=?
    `).bind(month,month,month,month,month,month,month,month).all<any>(),
    env.DB.prepare("SELECT COUNT(*) count FROM contributions WHERE status='pending' AND month=?").bind(month).first<any>(),
    env.DB.prepare("SELECT COUNT(*) count FROM error_log WHERE status='open'").first<any>(),
    env.DB.prepare("SELECT created_at FROM audit_log WHERE action='database_backup_exported' ORDER BY created_at DESC LIMIT 1").first<any>()
  ]);
  const before=await env.DB.prepare(`SELECT
    (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved' AND month < ?) +
    (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active' AND transaction_month < ?) -
    (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved' AND transaction_month < ?) balance`).bind(month,month,month).first<any>();
  const rows=memberRows.results;
  const totalDue=rows.reduce((s:number,r:any)=>s+(r.payment_status==='exempt'?0:n(r.monthly_amount)),0);
  const totalCollected=rows.reduce((s:number,r:any)=>s+(r.payment_status==='exempt'?0:Math.min(n(r.paid),n(r.monthly_amount))),0);
  const counts=(status:string)=>rows.filter((r:any)=>r.payment_status===status).length;
  const contributionCash=n(cash?.total), donationCash=n(donations?.total), expenseCash=n(expenses?.total), opening=n(before?.balance);
  return {
    month,opening_balance:opening,contribution_cash:contributionCash,donation_cash:donationCash,expenses:expenseCash,
    closing_balance:opening+contributionCash+donationCash-expenseCash,total_due:totalDue,total_collected:totalCollected,
    collection_rate:totalDue>0?Math.min(100,(totalCollected/totalDue)*100):100,active_members:rows.length,
    paid_members:counts('paid'),partial_members:counts('partial'),unpaid_members:counts('unpaid'),exempt_members:counts('exempt'),
    pending_contributions:n(pendingContrib?.count),open_errors:n(openErrors?.count),last_backup_at:lastBackup?.created_at||null
  };
}

async function nextReversalId(env:any){
  await env.DB.prepare("INSERT OR IGNORE INTO id_sequences(kind,value) VALUES('R',0)").run();
  const row=await env.DB.prepare("UPDATE id_sequences SET value=value+1 WHERE kind='R' RETURNING value").first<any>();
  return `RV${String(row?.value||1).padStart(7,'0')}`;
}

async function laterClosedMonth(env:any, month:string) {
  return env.DB.prepare("SELECT month FROM month_closures WHERE month>? ORDER BY month ASC LIMIT 1").bind(month).first<{month:string}>();
}

governanceRoute.get('/month-close', requireAdmin, async c=>{
  await ensureOperationalSchema(c.env);
  const rows=await c.env.DB.prepare("SELECT mc.*,a.name closed_by_name FROM month_closures mc LEFT JOIN admins a ON a.id=mc.closed_by ORDER BY month DESC").all<any>();
  return c.json(rows.results);
});

governanceRoute.delete('/month-close/:month', requireCloseMonth, async c=>{
  await ensureOperationalSchema(c.env);
  const admin=c.get('admin')!; const month=c.req.param('month') || "";
  if(!validMonth(month)) return c.json({error:'Use YYYY-MM'},400);
  if(!(await isMonthClosed(c.env,month))) return c.json({error:'Month is not closed'},404);

  const later=await laterClosedMonth(c.env,month);
  if(later) return c.json({
    error:`Cannot reopen ${month} because ${later.month} is already closed. Reopen the latest closed month first.`,
    code:'LATER_MONTH_ALREADY_CLOSED',
    later_month:later.month
  },409);

  const result=await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM month_closures WHERE month=? AND NOT EXISTS (SELECT 1 FROM month_closures WHERE month>?)").bind(month,month),
    c.env.DB.prepare("DELETE FROM monthly_snapshots WHERE month=? AND NOT EXISTS (SELECT 1 FROM month_closures WHERE month>?)").bind(month,month)
  ]);
  if(!Number((result[0] as any)?.meta?.changes||0)) {
    const newest=await laterClosedMonth(c.env,month);
    if(newest) return c.json({error:`Cannot reopen ${month} because ${newest.month} is already closed. Reopen the latest closed month first.`,code:'LATER_MONTH_ALREADY_CLOSED',later_month:newest.month},409);
    return c.json({error:'Month could not be reopened. Refresh and try again.'},409);
  }

  await auditEntity(c.env,admin.id,'month_reopened','month',month,null,{snapshot_removed:true});
  return c.json({ok:true});
});

governanceRoute.get('/month-close/:month/check', requireAdmin, async c=>{
  await ensureOperationalSchema(c.env); const month=c.req.param('month');
  if(!validMonth(month)) return c.json({error:'Use YYYY-MM'},400);
  const metrics=await monthMetrics(c.env,month);
  const already=await isMonthClosed(c.env,month);
  return c.json({...metrics,closed:already,blockers:[
    ...(metrics.pending_contributions?[`${metrics.pending_contributions} pending contribution(s)`]:[]),
  ],warnings:[
    ...((metrics.unpaid_members+metrics.partial_members)>0?[`${metrics.unpaid_members+metrics.partial_members} member(s) still outstanding`]:[]),
    ...(metrics.open_errors?[`${metrics.open_errors} unresolved system error(s)`]:[]),
    ...(!metrics.last_backup_at?[`No database backup recorded`]:[])
  ]});
});

governanceRoute.post('/month-close/:month', requireCloseMonth, async c=>{
  await ensureOperationalSchema(c.env); const admin=c.get('admin')!; const month=c.req.param('month'); const body=await c.req.json().catch(()=>({})) as any;
  if(!validMonth(month)) return c.json({error:'Use YYYY-MM'},400);
  if(await isMonthClosed(c.env,month)) return c.json({error:'Month is already closed'},409);
  const later=await laterClosedMonth(c.env,month);
  if(later) return c.json({
    error:`Cannot close ${month} while later month ${later.month} is already closed. Reopen later months first.`,
    code:'LATER_MONTH_ALREADY_CLOSED',
    later_month:later.month
  },409);
  const m=await monthMetrics(c.env,month);
  if((m.pending_contributions||0)>0) return c.json({error:'Resolve pending contributions before closing',check:m},409);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR REPLACE INTO monthly_snapshots(month,opening_balance,contribution_cash,donation_cash,expenses,closing_balance,total_due,total_collected,collection_rate,active_members,paid_members,partial_members,unpaid_members,exempt_members,closed_by,closed_at,note)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)`).bind(month,m.opening_balance,m.contribution_cash,m.donation_cash,m.expenses,m.closing_balance,m.total_due,m.total_collected,m.collection_rate,m.active_members,m.paid_members,m.partial_members,m.unpaid_members,m.exempt_members,admin.id,String(body.note||'').trim()||null),
    c.env.DB.prepare("INSERT INTO month_closures(month,closed_by,closed_at,note) VALUES(?,?,datetime('now'),?)").bind(month,admin.id,String(body.note||'').trim()||null)
  ]);
  await auditEntity(c.env,admin.id,'month_closed_with_snapshot','month',month,null,m);
  return c.json({ok:true,snapshot:{...m,closed_by:admin.id,note:body.note||null}});
});

governanceRoute.get('/snapshots', requireAdmin, async c=>{
  const year=String(c.req.query('year')||'');
  const where=yearRx.test(year)?"WHERE s.month LIKE ?":""; const vals=yearRx.test(year)?[`${year}-%`]:[];
  const rows=await c.env.DB.prepare(`SELECT s.*,a.name closed_by_name FROM monthly_snapshots s LEFT JOIN admins a ON a.id=s.closed_by ${where} ORDER BY s.month DESC`).bind(...vals).all<any>();
  return c.json(rows.results);
});

governanceRoute.post('/reverse', requireFinance, async c=>{
  const admin=c.get('admin')!; const body=await c.req.json().catch(()=>({})) as any;
  const type=String(body.entity_type||''); const id=Number(body.entity_id); const reason=String(body.reason||'').trim();
  if(!['contribution','expense','donation'].includes(type) || !Number.isInteger(id) || id<=0 || reason.length<3) return c.json({error:'Transaction and reversal reason are required'},400);
  const cfg:any={contribution:{table:'contributions',month:'month',live:"status='approved'"},expense:{table:'expenses',month:'transaction_month',live:"status='approved'"},donation:{table:'donations',month:'transaction_month',live:"status='active'"}}[type];
  const row=await c.env.DB.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).bind(id).first<any>();
  if(!row) return c.json({error:'Transaction not found'},404); if(!(['approved','active'].includes(String(row.status)))) return c.json({error:`Transaction is ${row.status} and cannot be reversed`},409);
  const month=String(row[cfg.month]||''); if(monthRx.test(month)){try{await requireOpenMonth(c.env,month)}catch(e:any){return c.json({error:e.message},409)}}
  const existing=await c.env.DB.prepare("SELECT reversal_id FROM financial_reversals WHERE entity_type=? AND entity_id=?").bind(type,id).first<any>();
  if(existing) return c.json({error:`Already reversed as ${existing.reversal_id}`},409);
  const reversalId=await nextReversalId(c.env);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE ${cfg.table} SET status='reversed' WHERE id=?`).bind(id),
      c.env.DB.prepare("INSERT INTO financial_reversals(reversal_id,entity_type,entity_id,original_txn_id,amount,month,reason,reversed_by) VALUES(?,?,?,?,?,?,?,?)").bind(reversalId,type,id,row.txn_id||null,n(row.amount),month||null,reason,admin.id)
    ]);
  } catch (error:any) {
    // The unique (entity_type, entity_id) index is the final guard for two
    // near-simultaneous reversal requests. Return a stable conflict instead of
    // exposing a D1 constraint error to the Mini App.
    const duplicate=await c.env.DB.prepare("SELECT reversal_id FROM financial_reversals WHERE entity_type=? AND entity_id=?").bind(type,id).first<any>();
    if(duplicate) return c.json({error:`Already reversed as ${duplicate.reversal_id}`},409);
    throw error;
  }
  await auditEntity(c.env,admin.id,'financial_transaction_reversed',type,id,row,{...row,status:'reversed',reversal_id:reversalId,reason});
  return c.json({ok:true,reversal_id:reversalId});
});

governanceRoute.get('/reversals', requireAdmin, async c=>{
  const rows=await c.env.DB.prepare("SELECT r.*,a.name reversed_by_name FROM financial_reversals r LEFT JOIN admins a ON a.id=r.reversed_by ORDER BY r.created_at DESC LIMIT 200").all<any>();
  return c.json(rows.results);
});

governanceRoute.get('/meetings/:id/minutes', requireAdmin, async c=>{
  const id=Number(c.req.param('id')); const meeting=await c.env.DB.prepare("SELECT id,title,meeting_date,status FROM meetings WHERE id=?").bind(id).first<any>();
  if(!meeting) return c.json({error:'Meeting not found'},404);
  const minutes=await c.env.DB.prepare("SELECT mm.*,a.name recorded_by_name FROM meeting_minutes mm LEFT JOIN admins a ON a.id=mm.recorded_by WHERE meeting_id=?").bind(id).first<any>();
  const actions=await c.env.DB.prepare(`SELECT ai.*,m.name member_name,m.member_code,a.name admin_name FROM meeting_action_items ai LEFT JOIN members m ON m.id=ai.assigned_member_id LEFT JOIN admins a ON a.id=ai.assigned_admin_id WHERE ai.meeting_id=? ORDER BY CASE ai.status WHEN 'open' THEN 0 ELSE 1 END, ai.due_date, ai.id`).bind(id).all<any>();
  return c.json({meeting,minutes:minutes||null,actions:actions.results});
});

governanceRoute.put('/meetings/:id/minutes', requireFinance, async c=>{
  const admin=c.get('admin')!;
  const id=Number(c.req.param('id'));
  if(!Number.isInteger(id)||id<=0) return c.json({error:'Invalid meeting'},400);
  const body=await c.req.json().catch(()=>({})) as any;
  const meeting=await c.env.DB.prepare("SELECT id FROM meetings WHERE id=?").bind(id).first<any>();
  if(!meeting) return c.json({error:'Meeting not found'},404);
  const minutes=String(body.minutes||'').trim().slice(0,12000);
  const decisions=String(body.decisions||'').trim().slice(0,8000);

  await c.env.DB.prepare(`INSERT INTO meeting_minutes(meeting_id,minutes,decisions,recorded_by,updated_at)
    VALUES(?,?,?,?,datetime('now'))
    ON CONFLICT(meeting_id) DO UPDATE SET
      minutes=excluded.minutes,
      decisions=excluded.decisions,
      recorded_by=excluded.recorded_by,
      updated_at=datetime('now')`
  ).bind(id,minutes||null,decisions||null,admin.id).run();

  // Read the row back before reporting success. This catches deployment/schema/write
  // problems instead of showing a false "saved" message in the Mini App.
  const saved=await c.env.DB.prepare(`SELECT mm.*,a.name recorded_by_name
    FROM meeting_minutes mm LEFT JOIN admins a ON a.id=mm.recorded_by
    WHERE mm.meeting_id=?`).bind(id).first<any>();
  if(!saved) return c.json({error:'Minutes could not be persisted. Please try again.'},500);

  await auditEntity(c.env,admin.id,'meeting_minutes_saved','meeting',id,null,{minutes_length:minutes.length,decisions_length:decisions.length});
  return c.json({ok:true,minutes:saved});
});

governanceRoute.post('/meetings/:id/actions', requireFinance, async c=>{
  const admin=c.get('admin')!;
  const id=Number(c.req.param('id'));
  if(!Number.isInteger(id)||id<=0) return c.json({error:'Invalid meeting'},400);
  const meeting=await c.env.DB.prepare("SELECT id,title FROM meetings WHERE id=?").bind(id).first<any>();
  if(!meeting) return c.json({error:'Meeting not found'},404);
  const b=await c.req.json().catch(()=>({})) as any;
  const description=String(b.description||'').trim().slice(0,1000);
  if(!description) return c.json({error:'Action item is required'},400);
  const due=String(b.due_date||'').trim()||null;
  const memberId=b.assigned_member_id?Number(b.assigned_member_id):null;
  const adminId=b.assigned_admin_id?Number(b.assigned_admin_id):null;
  const r=await c.env.DB.prepare("INSERT INTO meeting_action_items(meeting_id,description,assigned_member_id,assigned_admin_id,due_date,created_by) VALUES(?,?,?,?,?,?)").bind(id,description,memberId,adminId,due,admin.id).run();
  const actionId=Number(r.meta.last_row_id);
  const saved=await c.env.DB.prepare(`SELECT ai.*,m.name member_name,m.member_code,a.name admin_name
    FROM meeting_action_items ai
    LEFT JOIN members m ON m.id=ai.assigned_member_id
    LEFT JOIN admins a ON a.id=ai.assigned_admin_id
    WHERE ai.id=?`).bind(actionId).first<any>();
  if(!saved) return c.json({error:'Action item could not be persisted. Please try again.'},500);

  if(memberId){
    const assigned=await c.env.DB.prepare("SELECT name,telegram_id FROM members WHERE id=?").bind(memberId).first<any>();
    if(assigned?.telegram_id){try{const brand=await getBranding(c.env);await sendMessage(c.env,assigned.telegram_id,`📌 <b>${brand.fund_name} · Meeting action item</b>\n\n${String(meeting.title||'Meeting')}\n${description}${due?`\nDue: <b>${due}</b>`:''}`)}catch{}}
  }
  await auditEntity(c.env,admin.id,'meeting_action_created','meeting_action',actionId,null,{meeting_id:id,description,due_date:due,assigned_member_id:memberId});
  return c.json({ok:true,action:saved});
});

governanceRoute.patch('/meeting-actions/:id', requireFinance, async c=>{
  const admin=c.get('admin')!; const id=Number(c.req.param('id')); const b=await c.req.json().catch(()=>({})) as any; const before=await c.env.DB.prepare("SELECT * FROM meeting_action_items WHERE id=?").bind(id).first<any>(); if(!before)return c.json({error:'Action item not found'},404);
  const status=['open','done','cancelled'].includes(String(b.status))?String(b.status):String(before.status); const desc=String(b.description??before.description).trim().slice(0,1000); const due=b.due_date===undefined?before.due_date:(String(b.due_date||'').trim()||null);
  await c.env.DB.prepare("UPDATE meeting_action_items SET description=?,due_date=?,status=?,completed_at=CASE WHEN ?='done' THEN datetime('now') ELSE NULL END,completed_by=CASE WHEN ?='done' THEN ? ELSE NULL END WHERE id=?").bind(desc,due,status,status,status,admin.id,id).run();
  await auditEntity(c.env,admin.id,'meeting_action_updated','meeting_action',id,before,{...before,description:desc,due_date:due,status}); return c.json({ok:true});
});

async function yearData(env:any, year:string){
  const now=currentMonth(env.FUND_TIMEZONE || 'Indian/Maldives');
  const nowYear=now.slice(0,4), nowMonthNumber=Number(now.slice(5,7));
  const count=year<nowYear?12:year===nowYear?nowMonthNumber:0;
  const months=Array.from({length:count},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
  // Closed months are immutable accounting periods. Annual/AGM totals must use
  // the snapshot captured at close time instead of recalculating from current member state.
  const snapshots=await env.DB.prepare("SELECT * FROM monthly_snapshots WHERE month LIKE ? ORDER BY month").bind(`${year}-%`).all<any>();
  const snapshotMap=new Map(snapshots.results.map((r:any)=>[String(r.month),r]));
  const metrics=await Promise.all(months.map(async m=>{
    const snap:any=snapshotMap.get(m);
    if(snap) return {
      month:m,opening_balance:n(snap.opening_balance),contribution_cash:n(snap.contribution_cash),donation_cash:n(snap.donation_cash),
      expenses:n(snap.expenses),closing_balance:n(snap.closing_balance),total_due:n(snap.total_due),total_collected:n(snap.total_collected),
      collection_rate:n(snap.collection_rate),active_members:n(snap.active_members),paid_members:n(snap.paid_members),partial_members:n(snap.partial_members),
      unpaid_members:n(snap.unpaid_members),exempt_members:n(snap.exempt_members),source:'snapshot',closed_at:snap.closed_at
    };
    return {...await monthMetrics(env,m),source:'live'};
  }));
  const [categories,expenseDetails,expenseAdjustments,donationDetails,donationAdjustments,memberRows,reversals,meetings,meetingRsvps,meetingActions,projectSummary]=await Promise.all([
    env.DB.prepare(`SELECT COALESCE(cat.name,'Uncategorised') category,COALESCE(SUM(e.amount),0) total FROM expenses e LEFT JOIN expense_categories cat ON cat.id=e.category_id WHERE e.status='approved' AND e.transaction_month LIKE ? GROUP BY COALESCE(cat.name,'Uncategorised') ORDER BY total DESC`).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT e.id,e.txn_id,e.description,e.amount,e.expense_date,e.transaction_month,e.status,e.created_at,e.approved_at,
             COALESCE(cat.name,'Uncategorised') category,e.project_id,p.project_code,p.name project_name,COALESCE(a.name,'-') logged_by_name
      FROM expenses e
      LEFT JOIN expense_categories cat ON cat.id=e.category_id
      LEFT JOIN projects p ON p.id=e.project_id
      LEFT JOIN admins a ON a.id=e.logged_by
      WHERE e.status='approved' AND e.transaction_month LIKE ?
      ORDER BY e.transaction_month ASC,COALESCE(e.expense_date,date(e.created_at)) ASC,e.id ASC
    `).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT e.id,e.txn_id,e.description,e.amount,e.expense_date,e.transaction_month,e.status,e.created_at,e.voided_at,e.void_reason,
             COALESCE(cat.name,'Uncategorised') category,e.project_id,p.project_code,p.name project_name
      FROM expenses e
      LEFT JOIN expense_categories cat ON cat.id=e.category_id
      LEFT JOIN projects p ON p.id=e.project_id
      WHERE e.status IN ('reversed','voided') AND e.transaction_month LIKE ?
      ORDER BY e.transaction_month ASC,COALESCE(e.voided_at,e.expense_date,e.created_at) ASC,e.id ASC
    `).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT d.id,d.txn_id,d.donor_name,d.member_id,d.amount,d.note,d.transaction_month,d.status,d.created_at,
             m.member_code,m.name member_name,d.project_id,p.project_code,p.name project_name,COALESCE(a.name,'-') logged_by_name
      FROM donations d
      LEFT JOIN members m ON m.id=d.member_id
      LEFT JOIN projects p ON p.id=d.project_id
      LEFT JOIN admins a ON a.id=d.logged_by
      WHERE COALESCE(d.status,'active')='active' AND d.transaction_month LIKE ?
      ORDER BY d.transaction_month ASC,d.created_at ASC,d.id ASC
    `).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT d.id,d.txn_id,d.donor_name,d.member_id,d.amount,d.note,d.transaction_month,d.status,d.created_at,d.voided_at,d.void_reason,
             m.member_code,m.name member_name,d.project_id,p.project_code,p.name project_name
      FROM donations d
      LEFT JOIN members m ON m.id=d.member_id
      LEFT JOIN projects p ON p.id=d.project_id
      WHERE d.status IN ('reversed','voided') AND d.transaction_month LIKE ?
      ORDER BY d.transaction_month ASC,COALESCE(d.voided_at,d.created_at) ASC,d.id ASC
    `).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT m.id,m.member_code,m.name,m.monthly_amount,m.joined_at,m.created_at,
        COALESCE((SELECT SUM(ca.amount) FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
          WHERE ca.member_id=m.id AND ca.month>=? AND ca.month<=? AND c.status='approved'),0)+
        COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.member_id=m.id AND c.month>=? AND c.month<=? AND c.status='approved'
          AND NOT EXISTS(SELECT 1 FROM contribution_allocations ca WHERE ca.contribution_id=c.id)),0) applied_raw,
        COALESCE((SELECT SUM(ca.amount) FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
          WHERE ca.member_id=m.id AND ca.month>? AND c.status='approved'),0)+
        COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.member_id=m.id AND c.month>? AND c.status='approved'
          AND NOT EXISTS(SELECT 1 FROM contribution_allocations ca WHERE ca.contribution_id=c.id)),0) future_allocated
      FROM members m
      WHERE m.active=1
      ORDER BY m.member_code,m.name
    `).bind(`${year}-01`,`${year}-${String(count).padStart(2,'0')}`,`${year}-01`,`${year}-${String(count).padStart(2,'0')}`,`${year}-${String(count).padStart(2,'0')}`,`${year}-${String(count).padStart(2,'0')}`).all<any>(),
    env.DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) total FROM financial_reversals WHERE month LIKE ?").bind(`${year}-%`).first<any>(),
    env.DB.prepare(`
      SELECT mt.id,mt.title,mt.meeting_date,mt.meeting_time,mt.venue,mt.status,
             CASE WHEN mm.meeting_id IS NULL THEN 0 ELSE 1 END minutes_recorded
      FROM meetings mt
      LEFT JOIN meeting_minutes mm ON mm.meeting_id=mt.id
      WHERE mt.meeting_date LIKE ?
      ORDER BY mt.meeting_date ASC,mt.meeting_time ASC,mt.id ASC
    `).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT meeting_id,
             SUM(CASE WHEN response='yes' THEN 1 ELSE 0 END) yes_count,
             SUM(CASE WHEN response='maybe' THEN 1 ELSE 0 END) maybe_count,
             SUM(CASE WHEN response='no' THEN 1 ELSE 0 END) no_count,
             COUNT(*) response_count
      FROM meeting_rsvps
      WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_date LIKE ?)
      GROUP BY meeting_id
    `).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT ai.id,ai.meeting_id,ai.description,ai.due_date,ai.status,ai.completed_at,
             m.member_code,m.name member_name,a.name admin_name,mt.title meeting_title,mt.meeting_date
      FROM meeting_action_items ai
      JOIN meetings mt ON mt.id=ai.meeting_id
      LEFT JOIN members m ON m.id=ai.assigned_member_id
      LEFT JOIN admins a ON a.id=ai.assigned_admin_id
      WHERE mt.meeting_date LIKE ?
      ORDER BY mt.meeting_date ASC,ai.id ASC
    `).bind(`${year}-%`).all<any>(),
    env.DB.prepare(`
      SELECT p.id,p.project_code,p.name,p.description,p.budget,p.start_date,p.target_end_date,p.status,
             COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id AND e.status='approved' AND e.transaction_month LIKE ?),0) annual_spend,
             COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.project_id=p.id AND e.status='approved'),0) lifetime_spend,
             COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active' AND d.transaction_month LIKE ?),0) annual_donations,
             COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.project_id=p.id AND COALESCE(d.status,'active')='active'),0) lifetime_donations
      FROM projects p
      WHERE p.start_date IS NULL OR substr(p.start_date,1,4)<=?
      ORDER BY (annual_spend+annual_donations) DESC,p.name
    `).bind(`${year}-%`,`${year}-%`,year).all<any>()
  ]);

  const memberContributions=await Promise.all(memberRows.results.map(async(r:any)=>{
    const [rates,exemptions]=await Promise.all([
      env.DB.prepare("SELECT amount,effective_from,effective_to FROM member_contribution_rates WHERE member_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from").bind(r.id,`${year}-12`,`${year}-01`).all<any>(),
      env.DB.prepare("SELECT month FROM exemptions WHERE member_id=? AND month LIKE ?").bind(r.id,`${year}-%`).all<any>()
    ]);
    const exempt=new Set(exemptions.results.map((x:any)=>String(x.month)));
    const joined=String(r.joined_at||r.created_at||`${year}-01`).slice(0,7);
    let annualTarget=0;
    for(let monthNo=1;monthNo<=count;monthNo++){
      const month=`${year}-${String(monthNo).padStart(2,'0')}`;
      if(month<joined||exempt.has(month)) continue;
      annualTarget+=rateForMonthFromRows(rates.results as any[],month,n(r.monthly_amount));
    }
    const appliedRaw=n(r.applied_raw);
    const applied=Math.min(annualTarget,appliedRaw);
    const advance=Math.max(0,appliedRaw-annualTarget)+n(r.future_allocated);
    const outstanding=Math.max(0,annualTarget-applied);
    return {id:r.id,member_code:r.member_code,name:r.name,annual_target:annualTarget,applied,collected:applied,advance,outstanding,rate:annualTarget>0?Math.min(100,applied/annualTarget*100):100};
  }));

  const rsvpByMeeting=new Map((meetingRsvps.results as any[]).map((r:any)=>[Number(r.meeting_id),r]));
  const meetingSummary=(meetings.results as any[]).map((m:any)=>{
    const r:any=rsvpByMeeting.get(Number(m.id))||{};
    const actions=(meetingActions.results as any[]).filter((a:any)=>Number(a.meeting_id)===Number(m.id));
    return {...m,rsvp_yes:n(r.yes_count),rsvp_maybe:n(r.maybe_count),rsvp_no:n(r.no_count),rsvp_responses:n(r.response_count),action_total:actions.length,action_open:actions.filter((a:any)=>a.status==='open').length,action_done:actions.filter((a:any)=>a.status==='done').length};
  });

  return {
    year,months:metrics,expense_categories:categories.results,expenses:expenseDetails.results,expense_adjustments:expenseAdjustments.results,
    donations:donationDetails.results,donation_adjustments:donationAdjustments.results,member_contributions:memberContributions,
    reversals:{count:n(reversals?.count),total:n(reversals?.total)},meetings:meetingSummary.length,
    meeting_summary:meetingSummary,meeting_actions:meetingActions.results,projects:projectSummary.results
  };
}

governanceRoute.get('/annual/:year', requireAdmin, async c=>{
  const year=c.req.param('year'); if(!yearRx.test(year))return c.json({error:'Use YYYY'},400); const data=await yearData(c.env,year);
  const totals=data.months.reduce((a:any,m:any)=>({contributions:a.contributions+m.contribution_cash,donations:a.donations+m.donation_cash,expenses:a.expenses+m.expenses,collected:a.collected+m.total_collected,due:a.due+m.total_due}),{contributions:0,donations:0,expenses:0,collected:0,due:0});
  const branding=await getBranding(c.env);
  const months=data.months.map((m:any)=>({...m,collection_rate:n(m.total_due)>0?n(m.collection_rate):null}));
  return c.json({...data,months,organization:branding,totals:{...totals,net:totals.contributions+totals.donations-totals.expenses,collection_rate:totals.due>0?totals.collected/totals.due*100:null,opening_balance:data.months[0]?.opening_balance||0,closing_balance:data.months[data.months.length-1]?.closing_balance||0}});
});

governanceRoute.get('/analytics/:year', requireAdmin, async c=>{
  const year=c.req.param('year'); if(!yearRx.test(year))return c.json({error:'Use YYYY'},400);
  const now=currentMonth(c.env.FUND_TIMEZONE || 'Indian/Maldives');
  const lastMonth=year<now.slice(0,4)?12:year===now.slice(0,4)?Number(now.slice(5,7)):0;
  const periodEnd=`${year}-${String(lastMonth).padStart(2,'0')}`;
  const [memberPerformance,reversals,meetings]=await Promise.all([
    c.env.DB.prepare(`
      SELECT m.id,m.member_code,m.name,m.monthly_amount,
        COALESCE((SELECT SUM(ca.amount) FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
          WHERE ca.member_id=m.id AND ca.month>=? AND ca.month<=? AND c.status='approved'),0)+
        COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.member_id=m.id AND c.month>=? AND c.month<=? AND c.status='approved'
          AND NOT EXISTS(SELECT 1 FROM contribution_allocations ca WHERE ca.contribution_id=c.id)),0) applied_raw,
        COALESCE((SELECT SUM(ca.amount) FROM contribution_allocations ca JOIN contributions c ON c.id=ca.contribution_id
          WHERE ca.member_id=m.id AND ca.month>? AND c.status='approved'),0)+
        COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.member_id=m.id AND c.month>? AND c.status='approved'
          AND NOT EXISTS(SELECT 1 FROM contribution_allocations ca WHERE ca.contribution_id=c.id)),0) future_allocated
      FROM members m WHERE m.active=1 ORDER BY m.name LIMIT 100
    `).bind(`${year}-01`,periodEnd,`${year}-01`,periodEnd,periodEnd,periodEnd).all<any>(),
    c.env.DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) total FROM financial_reversals WHERE month LIKE ?").bind(`${year}-%`).first<any>(),
    c.env.DB.prepare("SELECT COUNT(*) count FROM meetings WHERE meeting_date LIKE ?").bind(`${year}-%`).first<any>()
  ]);
  const performance=await Promise.all(memberPerformance.results.map(async(r:any)=>{
    const [rates,exemptions,member]=await Promise.all([
      c.env.DB.prepare("SELECT amount,effective_from,effective_to FROM member_contribution_rates WHERE member_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from").bind(r.id,`${year}-12`,`${year}-01`).all<any>(),
      c.env.DB.prepare("SELECT month FROM exemptions WHERE member_id=? AND month LIKE ?").bind(r.id,`${year}-%`).all<any>(),
      c.env.DB.prepare("SELECT joined_at,created_at FROM members WHERE id=?").bind(r.id).first<any>()
    ]);
    const ex=new Set(exemptions.results.map((x:any)=>String(x.month))); const joined=String(member?.joined_at||member?.created_at||`${year}-01`).slice(0,7);
    let target=0; for(let m=1;m<=lastMonth;m++){const month=`${year}-${String(m).padStart(2,'0')}`;if(month<joined||ex.has(month))continue;target+=rateForMonthFromRows(rates.results as any[],month,n(r.monthly_amount));}
    const appliedRaw=n(r.applied_raw); const applied=Math.min(target,appliedRaw); const advance=Math.max(0,appliedRaw-target)+n(r.future_allocated);
    return {...r,collected:applied,applied,advance,annual_target:target,outstanding:Math.max(0,target-applied),rate:target>0?Math.min(100,applied/target*100):null};
  }));
  return c.json({year,reversals:{count:n(reversals?.count),total:n(reversals?.total)},meetings:n(meetings?.count),member_performance:performance});
});
