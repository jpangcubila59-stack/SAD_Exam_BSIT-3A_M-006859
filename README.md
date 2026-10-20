# Student Scholarship Monitoring and Academic Compliance System

## Files
- `index.html` — login page
- `css/styles.css` — responsive login and dashboard styling
- `js/config.js` — Supabase URL and publishable/anon key settings
- `js/auth.js` — validation, Supabase sign-in, and role-based redirect
- `js/dashboard.js` — scholar and staff dashboard workflows
- `scholar-dashboard.html` — semester submissions, correction, and status tracking
- `staff-dashboard.html` — scholar assignment, verification, evaluation, decisions, search, and activity
- `database/schema.sql` — tables, policy seeds, row-level security, validation triggers, and audit history

## Run in VS Code
1. Open the project folder in VS Code.
2. Use Live Server on `index.html`, or run `python -m http.server 8000` and open `http://localhost:8000`.
3. Configure Supabase and run the SQL setup below before signing in.

## Connect Supabase
1. Open your Supabase project and go to **Project Settings > API**.
2. Copy the project URL and publishable/anon key into `js/config.js`.
3. Run `database/schema.sql` in the Supabase SQL Editor. The setup creates the dashboard tables and `profiles.role` as a checked text field for `scholar`, `staff`, or `admin`; on existing profiles it adds the dashboard's `student_id` and `updated_at` columns. It is safe to rerun and creates the Merit Scholar and Community Scholar programs only if they do not already exist, preserving configured thresholds.
4. Create a staff account in **Authentication > Users**. Add its profile using the actual Auth UUID and role `staff`:

```sql
insert into public.profiles (id, email, full_name, role)
values ('PASTE-STAFF-AUTH-UUID-HERE', 'staff@example.com', 'Scholarship Staff', 'staff')
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role;
```

   If the existing `staff@gmail.com` account can authenticate but the portal reports that it has no profile, run `database/fix-staff-login.sql` in the Supabase SQL Editor as the project owner. It finds that account's actual Auth UUID and upserts its `pangcubila` staff profile without changing browser-side role protections.

5. Sign in as staff. In the Staff Dashboard, register existing Auth users as scholars using their Auth UUID, email, student ID, and name. The dashboard creates or updates their scholar profile. Create scholar Auth users in Supabase first; this browser app never creates Auth users or handles passwords.
6. Scholars type or choose an active scholarship program from the suggestions on Submit Requirements. Only existing active programs can be selected; new program names and policies must be added by staff. Scholars may change their selection until their first semester submission; after that, staff must handle any program change. Scholars then submit their semester summary and grade-document reference. Staff verify or return evidence, evaluate verified records against the selected program's stored policy, and explicitly record renewal decisions.

## Login troubleshooting
- A Supabase Auth user and a `public.profiles` row are both required. The profile `id` must exactly match the Auth user's UUID; use role `staff` or `admin` for the staff dashboard.
- If `staff@gmail.com` authenticates but has no profile, run `database/fix-staff-login.sql` in the Supabase SQL Editor as the project owner.
- The password is managed by Supabase Authentication, not by the profile row. Reset it in **Authentication > Users** if Supabase reports invalid credentials, and confirm the account's email if confirmation is enabled.
- Login now distinguishes invalid credentials, unconfirmed email, missing role profiles, and profile lookup failures instead of silently treating them as one error.

## Dashboard behavior
- Staff pages are available at `staff-dashboard.html?page=dashboard|scholars|verification|compliance|renewals|reports|notifications|profile`.
- Scholar pages are available at `scholar-dashboard.html?page=dashboard|submit|submissions|compliance|renewal|notifications|profile`.
- Staff can search by scholar name or student ID and filter by program or compliance result.
- Overview counts use the selected academic year and semester; assigned scholar count covers all current assignments.
- Verification, evaluation, renewal decisions, and resubmissions are written to `submission_history` with actor and timestamp.
- The deadline and thresholds are stored in the `programs` table and can be adjusted by staff through the database.
- This is an exam MVP; it does not integrate with a Registrar, process payments, or implement appeals.
- The database enforces role access and workflow rules. Scholars can read only their own assignments, submissions, and history. Approval is blocked unless the submission is verified and compliant. Returned submissions can be corrected and resubmitted; duplicate semester entries are rejected.

Existing sessions must run the updated schema to create the dashboard columns, tables, policies, and triggers. Do not rerun older SQL that restores a profile self-update policy.

## Security
- Never put a Supabase `service_role` key in browser code.
- Role redirects are not a security boundary; database row-level security and workflow triggers enforce access.
- Profile role changes must use a trusted administrative process.
- Both Login and Sign In buttons trigger the same authentication action.
