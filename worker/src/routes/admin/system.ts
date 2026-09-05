import type { Hono } from "hono";
import type { AppEnv } from "../../types";
import { requireAdmin, requireSuperAdmin, requireBackup } from "../../auth";
import { auditEntity, ensureOperationalSchema, safeLogError } from "../../ops";
import { currentMonth, getSetting, getBranding } from "../../db";
import { retryContributionReviewMessage } from "../../contributionReviewMessages";

export function registerSystemAdminRoutes(route: Hono<AppEnv>) {
route.get('/health', requireAdmin, async c => {
  await ensureOperationalSchema(c.env);
  const admin=c.get('admin')!; const full=admin.role==='owner'||admin.role==='super_admin';
  const out:any={checked_at:new Date().toISOString(),db:{ok:false},telegram:{ok:false},webhook:{ok:false},ai:{ok:!!c.env.AI}};
  if(full){out.mini_app_url=await getSetting(c.env,'mini_app_url');out.reminder_schedule=await getSetting(c.env,'reminder_schedule');out.month=currentMonth(c.env.FUND_TIMEZONE||'Indian/Maldives');}
  try{const x=await c.env.DB.prepare('SELECT 1 ok').first<any>();out.db={ok:Number(x?.ok)===1}}catch(e){await safeLogError(c.env,'health.db',e)}
  try{const r=await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getMe`);const j:any=await r.json();out.telegram=full?{ok:!!j.ok,username:j.result?.username||null}:{ok:!!j.ok}}catch(e){await safeLogError(c.env,'health.telegram',e)}
  try{const r=await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);const j:any=await r.json();out.webhook=full?{ok:!!j.ok,url:j.result?.url||'',pending:j.result?.pending_update_count||0,last_error:j.result?.last_error_message||null}:{ok:!!j.ok}}catch(e){await safeLogError(c.env,'health.webhook',e)}
  return c.json(out);
});

route.get('/errors', requireSuperAdmin, async c => { await ensureOperationalSchema(c.env); return c.json((await c.env.DB.prepare("SELECT * FROM error_log ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200").all()).results); });
route.post('/errors/:id/retry', requireSuperAdmin, async c => {
  const admin=c.get('admin')!; const id=Number(c.req.param('id'));
  const row=await c.env.DB.prepare("SELECT * FROM error_log WHERE id=?").bind(id).first<any>();
  if(!row)return c.json({error:'Not found'},404);
  if(row.source!=='telegram.contribution_review_sync')return c.json({error:'This error does not support retry'},400);
  let detail:any={}; try{detail=JSON.parse(row.detail||'{}')}catch{}
  const reviewMessageId=Number(detail.review_message_id||0);
  if(!reviewMessageId)return c.json({error:'Review message reference is missing'},400);
  const result=await retryContributionReviewMessage(c.env,reviewMessageId);
  if(!result.ok)return c.json({error:'Telegram message could not be updated',retry:result},502);
  await c.env.DB.prepare("UPDATE error_log SET status='resolved',resolved_at=datetime('now'),resolved_by=? WHERE id=?").bind(admin.id,id).run();
  await auditEntity(c.env,admin.id,'telegram_review_sync_retried','error_log',id,row,{...row,status:'resolved'});
  return c.json({ok:true,retry:result});
});

route.post('/errors/:id/resolve', requireSuperAdmin, async c => { const admin=c.get('admin')!; const id=Number(c.req.param('id')); const before=await c.env.DB.prepare("SELECT * FROM error_log WHERE id=?").bind(id).first<any>(); if(!before)return c.json({error:'Not found'},404); await c.env.DB.prepare("UPDATE error_log SET status='resolved',resolved_at=datetime('now'),resolved_by=? WHERE id=?").bind(admin.id,id).run(); await auditEntity(c.env,admin.id,'error_resolved','error_log',id,before,{...before,status:'resolved'}); return c.json({ok:true}); });
route.post('/errors/resolve-all', requireSuperAdmin, async c => { const admin=c.get('admin')!; const row=await c.env.DB.prepare("SELECT COUNT(*) n FROM error_log WHERE status='open'").first<any>(); await c.env.DB.prepare("UPDATE error_log SET status='resolved',resolved_at=datetime('now'),resolved_by=? WHERE status='open'").bind(admin.id).run(); await auditEntity(c.env,admin.id,'errors_resolved','error_log','open',null,{resolved:Number(row?.n||0)}); return c.json({ok:true,resolved:Number(row?.n||0)}); });

route.get('/backup', requireBackup, async c => {
  await ensureOperationalSchema(c.env);
  const tables=['members','admin_roles','admin_role_permissions','admins','member_registration_requests','contributions','contribution_allocations','member_contribution_rates','contribution_review_messages','telegram_update_receipts','donations','expense_categories','projects','expenses','expense_documents','donation_documents','exemptions','settings','id_sequences','audit_log','month_closures','meetings','meeting_rsvps','meeting_minutes','meeting_action_items','monthly_snapshots','financial_reversals','error_log','rate_limits','elections','election_positions','election_candidates','election_voters','election_ballots','election_applications','election_runoffs','election_runoff_candidates','election_runoff_voters','election_runoff_ballots','exco_role_assignments','election_notification_log','exco_terms','exco_handover_records','exco_handover_items','exco_responsibilities','exco_responsibility_history','meeting_resolutions','meeting_resolution_history','schema_migrations'];
  const version=await c.env.DB.prepare("SELECT MAX(version) version FROM schema_migrations").first<any>();
  const branding=await getBranding(c.env); const slug=branding.short_name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'fund';
  const data:any={exported_at:new Date().toISOString(),format:`${slug}-fund-json-v2`,organization:branding,schema_version:Number(version?.version||0),tables:{}};
  for(const t of tables){data.tables[t]=(await c.env.DB.prepare(`SELECT * FROM ${t}`).all()).results;}
  const admin=c.get('admin')!; await auditEntity(c.env,admin.id,'database_backup_exported','database','D1',null,{tables:tables.length,schema_version:data.schema_version});
  c.header('Content-Disposition',`attachment; filename="${slug}-fund-backup-${new Date().toISOString().slice(0,10)}.json"`); return c.json(data);
});
}
