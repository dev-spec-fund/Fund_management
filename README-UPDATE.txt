Fund Management advanced controls update

Implemented:
- Full audit logging for approvals, member actions, finance changes and admin changes
- Duplicate bank-slip blocking by normalized reference + amount + bank date
- Manual OCR correction from Pending tab before approval
- Pending dashboard for registrations, contribution slips and high-value expenses
- Member statement PDF/CSV export with monthly status, contributions, matching donations and running balance history
- Soft-delete/void for financial records
- Paid / Partial / Unpaid / Exempt monthly status
- Normalized duplicate-member protection
- D1 JSON backup in app + full SQL backup script (npm run db:backup)
- Super Admin / Treasurer / Viewer permissions (legacy owner is treated as Super Admin)
- Health page for DB, Telegram bot/webhook, AI/OCR, Mini App URL and reminder schedule
- Persistent error log
- Rate limits for /start, slip uploads and callbacks
- Second-admin approval for expenses above configurable threshold (default MVR 5000) when multiple admins exist
- Month close/reopen locking

Deployment:
1. Replace the included files, preserving their paths.
2. Worker: npm install && npx wrangler deploy
3. Frontend: npm install && npm run build / deploy as usual.

Existing D1 databases:
The Worker creates the new operational tables/columns automatically on first authenticated API/bot use. schema.sql is also updated for fresh databases.

Before deployment, optional full D1 SQL backup:
cd worker
npm run db:backup
