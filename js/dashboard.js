(() => {
  const root = document.querySelector('.dashboard-shell');
  const role = root?.dataset.role;
  const message = document.getElementById('dashboard-message');
  const pageNames = [...document.querySelectorAll('[data-page]')].map(page => page.dataset.page);
  let activePage = new URLSearchParams(window.location.search).get('page') || 'dashboard';
  const client = window.supabase?.createClient && window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;
  let currentUser;
  let currentProfile;
  let assignment;
  let scholarProgram;
  let scholarPrograms = [];
  let programs = [];
  let staffAssignments = [];
  let staffProfiles = [];
  let submissions = [];
  let history = [];

  function showActivePage() {
    if (!pageNames.includes(activePage)) activePage = 'dashboard';
    document.querySelectorAll('[data-page]').forEach(page => {
      page.hidden = page.dataset.page !== activePage;
    });
    document.querySelectorAll('[data-page-link]').forEach(link => {
      const active = link.dataset.pageLink === activePage;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  function showMessage(text, type = 'error') {
    if (!message) return;
    message.textContent = text;
    message.className = text ? `dashboard-message ${type}` : 'dashboard-message';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function displayDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function statusLabel(value) {
    return ({
      pending: 'Pending',
      verified: 'Verified',
      returned: 'Returned',
      compliant: 'Compliant',
      with_deficiency: 'With deficiency',
      approved: 'Approved',
      held: 'Held',
      active: 'Active',
      suspended: 'Suspended',
      ended: 'Ended'
    })[value] || value || '—';
  }

  function statusPill(value) {
    return `<span class="status-pill status-${escapeHtml(value)}">${escapeHtml(statusLabel(value))}</span>`;
  }

  function setBusy(form, busy) {
    form.querySelectorAll('button[type="submit"], button[data-action]').forEach(button => {
      button.disabled = busy;
    });
  }

  function getSubmissionValues(form) {
    const fields = new FormData(form);
    const values = {
      academic_year: String(fields.get('academic_year')).trim(),
      semester: Number(fields.get('semester')),
      gwa: Number(fields.get('gwa')),
      enrolled_units: Number(fields.get('enrolled_units')),
      failed_count: Number(fields.get('failed_count')),
      incomplete_count: Number(fields.get('incomplete_count')),
      dropped_count: Number(fields.get('dropped_count')),
      evidence_reference: String(fields.get('evidence_reference')).trim()
    };
    if (!/^\d{4}-\d{4}$/.test(values.academic_year)) {
      throw new Error('Enter the academic year as YYYY-YYYY, for example 2026-2027.');
    }
    if (!Number.isFinite(values.gwa) || values.gwa < 1 || values.gwa > 5) {
      throw new Error('GWA must be between 1.00 and 5.00.');
    }
    for (const [label, value] of [
      ['Enrolled units', values.enrolled_units],
      ['Failed subjects', values.failed_count],
      ['Incomplete grades', values.incomplete_count],
      ['Dropped subjects', values.dropped_count]
    ]) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${label} must be a nonnegative whole number.`);
      }
    }
    if (!values.evidence_reference) throw new Error('Enter a grade document reference.');
    return values;
  }

  function submissionForDatabase(values) {
    return {
      academic_year: values.academic_year,
      semester: String(values.semester),
      gwa: values.gwa,
      units_completed: values.enrolled_units,
      failed_subjects: values.failed_count,
      incomplete_subjects: values.incomplete_count,
      dropped_subjects: values.dropped_count,
      evidence_reference: values.evidence_reference
    };
  }

  function normalizeSubmission(row) {
    let complianceReasons = row.compliance_reasons;
    if (!Array.isArray(complianceReasons)
      || (!complianceReasons.length && row.deficiency_reasons)) {
      complianceReasons = String(row.deficiency_reasons || '')
        .split(/\s*;\s*|\r?\n/)
        .filter(Boolean);
    }
    const semesterValue = String(row.semester || '').toLowerCase();
    const semesterNumber = semesterValue.includes('summer')
      ? 3
      : Number.parseInt(semesterValue.match(/\d+/)?.[0] || semesterValue, 10);
    return {
      ...row,
      semester: Number.isFinite(semesterNumber) ? semesterNumber : 0,
      enrolled_units: row.enrolled_units ?? row.units_completed ?? 0,
      failed_count: row.failed_count ?? row.failed_subjects ?? 0,
      incomplete_count: row.incomplete_count ?? row.incomplete_subjects ?? 0,
      dropped_count: row.dropped_count ?? row.dropped_subjects ?? 0,
      verification_reason: row.verification_reason
        ?? (row.verification_status === 'returned' ? row.notes : null),
      compliance_reasons: complianceReasons,
      renewal_note: row.renewal_note
        ?? (row.renewal_status !== 'pending' ? row.notes : null)
    };
  }

  async function start() {
    showActivePage();
    window.addEventListener('popstate', () => {
      activePage = new URLSearchParams(window.location.search).get('page') || 'dashboard';
      showActivePage();
    });
    if (!client) {
      showMessage('Supabase could not load. Check your connection and js/config.js, then reload.');
      return;
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      window.location.replace('index.html');
      return;
    }
    currentUser = sessionData.session.user;
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, full_name, student_id, email')
      .eq('id', currentUser.id)
      .single();
    if (profileError) throw profileError;
    currentProfile = profile;
    const actualRole = ['staff', 'admin'].includes(String(profile.role).toLowerCase()) ? 'staff' : 'scholar';
    if (!['staff', 'admin', 'scholar', 'student'].includes(String(profile.role).toLowerCase())) {
      await client.auth.signOut();
      throw new Error('Your account role is not recognized. Contact the scholarship office.');
    }
    if (actualRole !== role) {
      window.location.replace(actualRole === 'staff' ? 'staff-dashboard.html' : 'scholar-dashboard.html');
      return;
    }
    const welcome = document.getElementById('welcome-message');
    if (welcome) welcome.textContent = `Welcome, ${profile.full_name || currentUser.email}.`;
    if (role === 'staff') {
      document.getElementById('staff-profile-details').innerHTML = profileMarkup(profile);
      bindPasswordChange('staff-password-form');
    } else {
      document.getElementById('scholar-profile-details').innerHTML = profileMarkup(profile);
      bindPasswordChange('scholar-password-form');
    }
    document.querySelectorAll('[data-signout]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const { error } = await client.auth.signOut();
        if (error) {
          button.disabled = false;
          showMessage(error.message);
          return;
        }
        window.location.replace('index.html');
      });
    });
    document.querySelectorAll('[data-refresh]').forEach(button => {
      button.addEventListener('click', () => refresh().catch(error => showMessage(error.message)));
    });
    if (role === 'staff') {
      bindStaff();
      await refreshStaff();
    } else {
      bindScholar();
      await refreshScholar();
    }
  }

  function bindScholar() {
    const programInput = document.getElementById('scholar-program');
    let programSavePromise = Promise.resolve();
    programInput.addEventListener('change', () => {
      programSavePromise = saveScholarProgram(programInput).catch(error => showMessage(error.message));
    });
    document.getElementById('submission-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      setBusy(form, true);
      try {
        await programSavePromise;
        await saveScholarProgram(programInput);
        if (!assignment) throw new Error('No scholarship assignment is linked to your account. Contact the scholarship office.');
        const values = getSubmissionValues(form);
        const { data: inserted, error } = await client.from('submissions').insert({
          assignment_id: assignment.id,
          ...submissionForDatabase(values)
        }).select('id').single();
        if (error) throw error;
        form.reset();
        form.elements.academic_year.value = '2026-2027';
        form.elements.failed_count.value = '0';
        form.elements.incomplete_count.value = '0';
        form.elements.dropped_count.value = '0';
        showMessage('Grades submitted. Your evidence is pending staff verification.', 'success');
        await refreshScholar();
      } catch (error) {
        showMessage(error.message);
      } finally {
        setBusy(form, false);
      }
    });
    document.getElementById('scholar-submissions').addEventListener('submit', async event => {
      const form = event.target.closest('[data-correction-id]');
      if (!form) return;
      event.preventDefault();
      if (!form.reportValidity()) return;
      setBusy(form, true);
      try {
        const values = submissionForDatabase(getSubmissionValues(form));
        const { error } = await client
          .from('submissions')
          .update(values)
          .eq('id', form.dataset.correctionId)
          .select('id')
          .single();
        if (error) throw error;
        showMessage('Correction resubmitted. Verification has returned to Pending.', 'success');
        await refreshScholar();
      } catch (error) {
        showMessage(error.message);
      } finally {
        setBusy(form, false);
      }
    });
    document.querySelector('.dashboard-shell').addEventListener('click', event => {
      const button = event.target.closest('[data-toggle-correction]');
      if (!button) return;
      const correctionForm = document.getElementById(`correction-${button.dataset.toggleCorrection}`);
      correctionForm.hidden = !correctionForm.hidden;
      button.textContent = correctionForm.hidden ? 'Correct and resubmit' : 'Close correction form';
    });
  }

  async function refreshScholar() {
    const programInput = document.getElementById('scholar-program');
    const programOptions = document.getElementById('scholar-program-options');
    const { data: activePrograms, error: programsError } = await client
      .from('programs')
      .select('id, name')
      .eq('is_active', true)
      .order('name');
    if (programsError) throw programsError;
    scholarPrograms = activePrograms || [];
    programOptions.innerHTML = scholarPrograms
      .map(program => `<option value="${escapeHtml(program.name)}"></option>`).join('');
    const { data: foundAssignment, error: assignmentError } = await client
      .from('assignments')
      .select('*')
      .eq('scholar_id', currentUser.id)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    assignment = foundAssignment;
    const form = document.getElementById('submission-form');
    if (!assignment) {
      scholarProgram = null;
      submissions = [];
      history = [];
      programInput.value = '';
      programInput.disabled = scholarPrograms.length === 0;
      form.querySelector('button[type="submit"]').disabled = true;
      showMessage(scholarPrograms.length
        ? 'Choose a scholarship program before submitting requirements.'
        : 'There are no active scholarship programs available. Contact the scholarship office.', scholarPrograms.length ? 'success' : 'error');
      renderScholar([]);
      updateScholarSummary(null);
      return;
    }
    const { data: program, error: programError } = await client
      .from('programs')
      .select('*')
      .eq('id', assignment.program_id)
      .single();
    if (programError) throw programError;
    scholarProgram = program;
    const programIsActive = scholarPrograms.some(item => String(item.id) === String(program.id));
    programInput.value = programIsActive ? program.name : '';
    const { data: rows, error } = await client
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignment.id)
      .order('submitted_at', { ascending: false });
    if (error) throw error;
    submissions = (rows || []).map(normalizeSubmission);
    programInput.disabled = submissions.length > 0;
    form.querySelector('button[type="submit"]').disabled = !programIsActive;
    if (!programIsActive && !submissions.length) {
      showMessage('Your assigned program is inactive. Select an active program before submitting.', 'error');
    }
    if (submissions.length) {
      const { data: events, error: historyError } = await client
        .from('submission_history')
        .select('*')
        .in('submission_id', submissions.map(row => row.id))
        .order('created_at', { ascending: false });
      if (historyError) throw historyError;
      history = (events || []).map(event => ({ ...event, actor_id: event.actor_id ?? event.changed_by }));
    } else {
      history = [];
    }
    renderScholar(submissions);
    updateScholarSummary(program);
  }

  async function saveScholarProgram(programInput) {
    const selectedName = programInput.value.trim();
    const selectedProgram = scholarPrograms.find(program =>
      program.name.trim().toLocaleLowerCase() === selectedName.toLocaleLowerCase()
    );
    if (!selectedProgram) throw new Error('Choose an active program from the suggestions. New program names must be added by staff.');
    if (assignment && String(assignment.program_id) === String(selectedProgram.id)) return;
    if (submissions.length) {
      programInput.value = scholarProgram?.name || '';
      showMessage('Your program cannot be changed after your first semester submission.');
      return;
    }

    const previousValue = scholarProgram?.name || '';
    programInput.disabled = true;
    let saved = false;
    try {
      const query = assignment
        ? client.from('assignments').update({ program_id: selectedProgram.id }).eq('id', assignment.id)
        : client.from('assignments').insert({ scholar_id: currentUser.id, program_id: selectedProgram.id });
      const { error } = await query.select('id').single();
      if (error) throw error;
      saved = true;
      showMessage('Scholarship program saved. You can change it until your first submission.', 'success');
      await refreshScholar();
    } catch (error) {
      if (!saved) {
        programInput.value = previousValue;
        programInput.disabled = false;
      }
      throw error;
    }
  }

  function correctionForm(row) {
    return `
      <button class="btn btn-outline compact-button" type="button" data-toggle-correction="${escapeHtml(row.id)}">Correct and resubmit</button>
      <form id="correction-${escapeHtml(row.id)}" class="dashboard-form correction-form" data-correction-id="${escapeHtml(row.id)}" hidden>
        <input type="hidden" name="academic_year" value="${escapeHtml(row.academic_year)}">
        <input type="hidden" name="semester" value="${escapeHtml(row.semester)}">
        <p class="form-hint form-wide">Correct the submitted values below. Academic year and semester cannot be changed.</p>
        <label>GWA<input name="gwa" type="number" min="1" max="5" step="0.01" value="${escapeHtml(row.gwa)}" required></label>
        <label>Enrolled units<input name="enrolled_units" type="number" min="0" step="1" value="${escapeHtml(row.enrolled_units)}" required></label>
        <label>Failed subjects<input name="failed_count" type="number" min="0" step="1" value="${escapeHtml(row.failed_count)}" required></label>
        <label>Incomplete grades<input name="incomplete_count" type="number" min="0" step="1" value="${escapeHtml(row.incomplete_count)}" required></label>
        <label>Dropped subjects<input name="dropped_count" type="number" min="0" step="1" value="${escapeHtml(row.dropped_count)}" required></label>
        <label class="form-wide">Grade document reference<input name="evidence_reference" value="${escapeHtml(row.evidence_reference)}" maxlength="500" required></label>
        <button class="btn btn-primary form-action" type="submit">Resubmit correction</button>
      </form>`;
  }

  function renderScholar(rows) {
    const empty = '<p class="empty-state">No semester submissions yet.</p>';
    const card = (row, mode) => `
      <article class="record-card">
        <div class="record-heading">
          <div><h3>${escapeHtml(row.academic_year)} · ${row.semester === 3 ? 'Summer' : `Semester ${escapeHtml(row.semester)}`}</h3>
          <p>Submitted ${escapeHtml(displayDate(row.submitted_at))}</p></div>
          ${mode === 'compliance' ? statusPill(row.compliance_status) : statusPill(row.verification_status)}
        </div>
        ${mode === 'submissions' ? `<div class="status-row">
          <span>Compliance ${statusPill(row.compliance_status)}</span>
          <span>Renewal ${statusPill(row.renewal_status)}</span>
          <span>Award ${statusPill(assignment?.award_status || 'active')}</span>
        </div>` : mode === 'renewal' ? `<div class="status-row">
          <span>Compliance ${statusPill(row.compliance_status)}</span>
          <span>Renewal ${statusPill(row.renewal_status)}</span>
        </div>` : ''}
        <dl class="detail-grid">
          <div><dt>GWA</dt><dd>${escapeHtml(row.gwa ?? '—')}</dd></div>
          <div><dt>Completed units</dt><dd>${escapeHtml(row.enrolled_units)}</dd></div>
          <div><dt>Failed / Incomplete / Dropped</dt><dd>${escapeHtml(row.failed_count)} / ${escapeHtml(row.incomplete_count)} / ${escapeHtml(row.dropped_count)}</dd></div>
          ${mode === 'submissions' ? `<div><dt>Evidence reference</dt><dd>${escapeHtml(row.evidence_reference || '—')}</dd></div>` : ''}
        </dl>
        ${row.verification_reason ? `<p class="reason-text"><strong>Staff feedback:</strong> ${escapeHtml(row.verification_reason)}</p>` : ''}
        ${mode === 'compliance' ? renderPolicyChecks(row, scholarProgram) : ''}
        ${mode === 'compliance' && Array.isArray(row.compliance_reasons) && row.compliance_reasons.length
          ? `<ul class="reason-list">${row.compliance_reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}
        ${mode === 'renewal' && row.renewal_note ? `<p class="reason-text"><strong>Staff decision:</strong> ${escapeHtml(row.renewal_note)}</p>` : ''}
        ${mode === 'submissions' ? `${renderScholarHistory(row.id)}${row.verification_status === 'returned' ? correctionForm(row) : ''}` : ''}
      </article>`;
    const renderTo = (id, list, mode) => {
      const container = document.getElementById(id);
      if (container) container.innerHTML = list.length ? list.map(row => card(row, mode)).join('') : empty;
    };
    renderTo('scholar-submissions', rows, 'submissions');
    renderTo('scholar-compliance-list', rows, 'compliance');
    renderTo('scholar-renewal-list', rows, 'renewal');
    renderScholarNotifications();
  }

  function updateScholarSummary(program) {
    const latest = submissions[0];
    document.getElementById('overview-program').textContent = program?.name || 'Not assigned';
    document.getElementById('overview-deadline').textContent = program?.deadline
      ? `Submission deadline: ${displayDate(program.deadline)}`
      : 'Contact staff for the submission deadline.';
    document.getElementById('overview-compliance').textContent = statusLabel(latest?.compliance_status);
    document.getElementById('overview-gwa').textContent = `Latest GWA: ${latest?.gwa ?? '—'}`;
    document.getElementById('overview-verification').textContent = statusLabel(latest?.verification_status);
    document.getElementById('overview-units').textContent = `Completed units: ${latest?.enrolled_units ?? '—'}`;
    document.getElementById('overview-renewal').textContent = statusLabel(latest?.renewal_status);
    const pending = latest?.verification_status === 'returned'
      ? 'Action needed: correct and resubmit your requirements.'
      : latest?.verification_status === 'pending'
        ? 'Your latest submission is awaiting staff verification.'
        : latest?.compliance_status === 'pending'
          ? 'Your verified record is awaiting compliance evaluation.'
          : 'No pending action';
    document.getElementById('overview-pending').textContent = pending;
  }

  function renderPolicyChecks(row, program) {
    if (!program) return '';
    const checks = [
      [`GWA ${row.gwa ?? '—'} (maximum ${program.max_gwa})`, Number(row.gwa) <= Number(program.max_gwa)],
      [`Completed units ${row.enrolled_units} (minimum ${program.min_units})`, Number(row.enrolled_units) >= Number(program.min_units)],
      [`Failed subjects ${row.failed_count} (maximum ${program.max_failed})`, Number(row.failed_count) <= Number(program.max_failed)],
      [`Incomplete subjects ${row.incomplete_count} (maximum ${program.max_incomplete})`, Number(row.incomplete_count) <= Number(program.max_incomplete)],
      [`Dropped subjects ${row.dropped_count} (maximum ${program.max_dropped})`, Number(row.dropped_count) <= Number(program.max_dropped)],
      [`Deadline ${displayDate(program.deadline)}`, !program.deadline || Date.parse(row.submitted_at) <= Date.parse(program.deadline)]
    ];
    return `<h3 class="checklist-heading">Policy checks</h3><ul class="policy-check-list">
      ${checks.map(([label, passed]) => `<li><span>${escapeHtml(label)}</span>${statusPill(passed ? 'compliant' : 'with_deficiency')}</li>`).join('')}
    </ul>${row.verification_status !== 'verified'
      ? '<p class="form-hint">These checks are informational until staff verify your evidence and evaluate compliance.</p>' : ''}`;
  }

  function renderScholarNotifications() {
    const container = document.getElementById('scholar-notifications');
    if (!container) return;
    const deadlineDate = scholarProgram?.deadline ? Date.parse(scholarProgram.deadline) : NaN;
    const daysUntilDeadline = (deadlineDate - Date.now()) / 86400000;
    const reminders = Number.isFinite(daysUntilDeadline) && daysUntilDeadline >= 0 && daysUntilDeadline <= 7
      ? [{ action: 'deadline', created_at: new Date().toISOString(), detail: `Scholarship submission deadline: ${displayDate(scholarProgram.deadline)}.` }]
      : [];
    if (!history.length && !reminders.length) {
      container.innerHTML = '<p class="empty-state">No notifications yet.</p>';
      return;
    }
    const labels = {
      submitted: 'Requirements submitted',
      verified: 'Evidence verified',
      returned: 'Requirements returned for correction',
      evaluated: 'Compliance evaluated',
      renewal_decided: 'Renewal decision recorded',
      corrected_and_resubmitted: 'Correction resubmitted'
    };
    const events = [
      ...reminders,
      ...history.map(item => ({
        ...item,
        detail: item.details?.reason || item.details?.note || item.details?.status || ''
      }))
    ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    container.innerHTML = events.map(item => `<article class="history-item">
      <div><strong>${escapeHtml(labels[item.action] || item.action)}</strong>
        <span>${escapeHtml(item.detail || '')}</span></div>
      <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(displayDate(item.created_at))}</time>
    </article>`).join('');
  }

  function profileMarkup(profile) {
    return `
      <div><dt>Full name</dt><dd>${escapeHtml(profile.full_name || '—')}</dd></div>
      <div><dt>Email</dt><dd>${escapeHtml(profile.email || currentUser?.email || '—')}</dd></div>
      <div><dt>Student ID</dt><dd>${escapeHtml(profile.student_id || '—')}</dd></div>
      <div><dt>Account role</dt><dd>${escapeHtml(profile.role || '—')}</dd></div>`;
  }

  function bindPasswordChange(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const fields = new FormData(form);
      const password = String(fields.get('password'));
      if (password !== String(fields.get('password_confirm'))) {
        showMessage('The new passwords do not match.');
        return;
      }
      setBusy(form, true);
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        form.reset();
        showMessage('Password updated successfully.', 'success');
      } catch (error) {
        showMessage(error.message);
      } finally {
        setBusy(form, false);
      }
    });
  }

  function renderScholarHistory(submissionId) {
    const events = history.filter(item => item.submission_id === submissionId);
    if (!events.length) return '';
    const labels = {
      submitted: 'Submitted',
      verified: 'Evidence verified',
      returned: 'Returned for correction',
      evaluated: 'Compliance evaluated',
      renewal_decided: 'Renewal decision recorded',
      corrected_and_resubmitted: 'Correction resubmitted'
    };
    return `<details class="record-history">
      <summary>Activity history (${events.length})</summary>
      <ul>${events.map(item => `<li><strong>${escapeHtml(labels[item.action] || item.action)}</strong>
        <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(displayDate(item.created_at))}</time>
        ${item.details?.reason ? `<span>${escapeHtml(item.details.reason)}</span>` : ''}
        ${item.details?.note ? `<span>${escapeHtml(item.details.note)}</span>` : ''}
      </li>`).join('')}</ul>
    </details>`;
  }

  function bindStaff() {
    document.getElementById('assignment-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      setBusy(form, true);
      try {
        const fields = new FormData(form);
        const scholarId = String(fields.get('scholar_id')).trim();
        const { data: existing, error: lookupError } = await client
          .from('profiles')
          .select('role')
          .eq('id', scholarId)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing && String(existing.role).toLowerCase() !== 'scholar') {
          throw new Error('That Auth user already has a staff or admin profile and cannot be assigned as a scholar.');
        }
        const { data: currentAssignment, error: assignmentLookupError } = await client
          .from('assignments')
          .select('id')
          .eq('scholar_id', scholarId)
          .limit(1)
          .maybeSingle();
        if (assignmentLookupError) throw assignmentLookupError;
        if (currentAssignment) throw new Error('This scholar already has an assignment. Contact an administrator to change the assigned program.');
        if (!existing) {
          const { error: profileError } = await client.from('profiles').insert({
            id: scholarId,
            email: String(fields.get('email')).trim(),
            full_name: String(fields.get('full_name')).trim(),
            student_id: String(fields.get('student_id')).trim(),
            role: 'scholar'
          });
          if (profileError) throw profileError;
        } else {
          const { error: profileError } = await client.from('profiles')
            .update({
              email: String(fields.get('email')).trim(),
              full_name: String(fields.get('full_name')).trim(),
              student_id: String(fields.get('student_id')).trim()
            })
            .eq('id', scholarId)
            .select('id')
            .single();
          if (profileError) throw profileError;
        }
        const { error } = await client.from('assignments').insert({
          scholar_id: scholarId,
          program_id: Number(fields.get('program_id'))
        });
        if (error) throw error;
        form.reset();
        showMessage('Scholar profile and program assignment saved.', 'success');
        await refreshStaff();
      } catch (error) {
        showMessage(error.message);
      } finally {
        setBusy(form, false);
      }
    });
    document.querySelectorAll('[data-search], [data-program-filter], [data-verification-filter], [data-compliance-filter], [data-renewal-filter], #filter-year, #filter-semester').forEach(element => {
      element.addEventListener('input', () => {
        renderStaffRecords();
        renderScholarDirectory();
      });
      element.addEventListener('change', () => {
        renderStaffRecords();
        renderScholarDirectory();
      });
    });
    document.querySelector('.dashboard-shell').addEventListener('click', handleStaffAction);
    document.querySelectorAll('[data-report]').forEach(button => {
      button.addEventListener('click', () => downloadReport(button.dataset.report));
    });
  }

  async function refreshStaff() {
    const results = await Promise.all([
      client.from('programs').select('*').order('name'),
      client.from('assignments').select('*').order('assigned_at', { ascending: false }),
      client.from('submissions').select('*').order('submitted_at', { ascending: false }),
      client.from('submission_history').select('*').order('created_at', { ascending: false }).limit(100)
    ]);
    for (const result of results) if (result.error) throw result.error;
    programs = results[0].data || [];
    staffAssignments = results[1].data || [];
    submissions = (results[2].data || []).map(normalizeSubmission);
    history = results[3].data || [];
    const scholarIds = [...new Set(staffAssignments.map(item => item.scholar_id))];
    const assignedStaffIds = [...new Set(staffAssignments.map(item => item.assigned_by).filter(Boolean))];
    const actorIds = [...new Set(history.map(item => item.actor_id ?? item.changed_by).filter(Boolean))];
    const profileIds = [...new Set([...scholarIds, ...assignedStaffIds, ...actorIds])];
    if (profileIds.length) {
      const { data: profiles, error } = await client
        .from('profiles')
        .select('id, student_id, full_name, email')
        .in('id', profileIds);
      if (error) throw error;
      staffProfiles = profiles || [];
    } else {
      staffProfiles = [];
    }
    populatePrograms();
    renderStaffRecords();
    renderScholarDirectory();
    renderStaffNotifications();
    updateStaffMetrics();
  }

  function populatePrograms() {
    const assignmentSelect = document.getElementById('program-select');
    const previous = assignmentSelect.value;
    assignmentSelect.innerHTML = '<option value="">Select a program</option>' + programs
      .map(program => `<option value="${escapeHtml(program.id)}">${escapeHtml(program.name)}</option>`).join('');
    if (previous) assignmentSelect.value = previous;
    document.querySelectorAll('[data-program-filter]').forEach(filterSelect => {
      const filter = filterSelect.value;
      filterSelect.innerHTML = '<option value="">All programs</option>' + programs
        .map(program => `<option value="${escapeHtml(program.id)}">${escapeHtml(program.name)}</option>`).join('');
      filterSelect.value = filter;
    });
  }

  function getRecordContext(row) {
    const assignmentRow = staffAssignments.find(item => String(item.id) === String(row.assignment_id));
    const scholar = staffProfiles.find(item => item.id === assignmentRow?.scholar_id) || {};
    const program = programs.find(item => String(item.id) === String(assignmentRow?.program_id)) || {};
    return { assignmentRow, scholar, program };
  }

  function renderStaffRecords() {
    const year = document.getElementById('filter-year').value.trim();
    const semester = Number(document.getElementById('filter-semester').value);
    const semesterRows = submissions.filter(row => row.academic_year === year && row.semester === semester);
    document.getElementById('metric-assigned').textContent = String(staffAssignments.length);
    document.getElementById('metric-pending').textContent = String(semesterRows.filter(row => row.verification_status === 'pending').length);
    document.getElementById('metric-verified').textContent = String(semesterRows.filter(row => row.verification_status === 'verified').length);
    document.getElementById('metric-deficiency').textContent = String(semesterRows.filter(row => row.compliance_status === 'with_deficiency').length);
    document.getElementById('metric-renewals').textContent = String(semesterRows.filter(row =>
      row.verification_status === 'verified' && row.compliance_status !== 'pending' && row.renewal_status === 'pending'
    ).length);

    renderStaffList('staff-verification-list', 'verification', semesterRows);
    renderStaffList('staff-compliance-list', 'compliance', semesterRows);
    renderStaffList('staff-renewal-list', 'renewal', semesterRows);
  }

  function renderStaffList(containerId, mode, rows) {
    const container = document.getElementById(containerId);
    const page = container.closest('[data-page]');
    const search = page.querySelector('[data-search]').value.trim().toLowerCase();
    const programFilter = page.querySelector('[data-program-filter]').value;
    const statusFilter = page.querySelector(`[data-${mode}-filter]`)?.value || '';
    const filtered = rows.filter(row => {
      const { assignmentRow, scholar } = getRecordContext(row);
      const searchable = `${scholar.full_name || ''} ${scholar.student_id || ''} ${scholar.email || ''}`.toLowerCase();
      return (!programFilter || String(assignmentRow?.program_id) === programFilter)
        && (!search || searchable.includes(search))
        && (!statusFilter
          || (mode === 'verification' ? row.verification_status === statusFilter
            : mode === 'compliance' ? row.compliance_status === statusFilter
              : row.renewal_status === statusFilter));
    }).filter(row => {
      if (mode === 'compliance') return row.verification_status === 'verified';
      if (mode === 'renewal') return row.verification_status === 'verified' && row.compliance_status !== 'pending';
      return true;
    });
    if (!filtered.length) {
      container.innerHTML = '<p class="empty-state">No submissions match these filters.</p>';
      return;
    }
    container.innerHTML = filtered.map(row => staffRecordCard(row, mode)).join('');
  }

  function staffRecordCard(row, mode) {
    const { assignmentRow, scholar, program } = getRecordContext(row);
    const canVerify = row.verification_status === 'pending' || row.verification_status === 'returned';
    const canEvaluate = row.verification_status === 'verified' && row.compliance_status === 'pending';
    const canDecide = row.verification_status === 'verified' && row.compliance_status !== 'pending';
    let actions = '';
    if (mode === 'verification' && canVerify) {
      actions = `<div class="staff-actions">
        <label>Return reason (required when returning)<input type="text" data-reason-for="${escapeHtml(row.id)}" placeholder="Explain what needs correction"></label>
        <div class="action-buttons">
          <button type="button" class="btn btn-primary compact-button" data-action="verify" data-id="${escapeHtml(row.id)}">Verify evidence</button>
          <button type="button" class="btn btn-outline compact-button" data-action="return" data-id="${escapeHtml(row.id)}">Return with reason</button>
        </div>
      </div>`;
    } else if (mode === 'compliance' && canEvaluate) {
      actions = `<div class="staff-actions"><p class="form-hint">Evaluation checks GWA, completed units, failed, incomplete, dropped subjects, and deadline.</p>
        <button type="button" class="btn btn-primary compact-button" data-action="evaluate" data-id="${escapeHtml(row.id)}">Evaluate compliance</button></div>`;
    } else if (mode === 'renewal' && canDecide) {
      actions = `<div class="staff-actions">
        <label>Decision note<input type="text" data-note-for="${escapeHtml(row.id)}" placeholder="Explain this decision" required></label>
        <div class="action-buttons">
          <button type="button" class="btn btn-primary compact-button" data-action="approve" data-id="${escapeHtml(row.id)}" ${row.compliance_status !== 'compliant' ? 'disabled title="Approval requires a compliant evaluation"' : ''}>Approve renewal</button>
          <button type="button" class="btn btn-outline compact-button" data-action="hold" data-id="${escapeHtml(row.id)}">Hold renewal</button>
        </div>
      </div>`;
    }
    return `<article class="record-card staff-record">
      <div class="record-heading"><div><h3>${escapeHtml(scholar.full_name || 'Scholar')} <span class="record-id">${escapeHtml(scholar.student_id || '')}</span></h3>
        <p>${escapeHtml(scholar.email || '')} · ${escapeHtml(program.name || 'Unassigned program')} · ${escapeHtml(row.academic_year)} ${row.semester === 3 ? 'Summer' : `Semester ${escapeHtml(row.semester)}`}</p></div>
        ${statusPill(row.verification_status)}</div>
      <div class="status-row"><span>Compliance ${statusPill(row.compliance_status)}</span><span>Renewal ${statusPill(row.renewal_status)}</span>
        <span>Award ${statusPill(assignmentRow?.award_status || 'active')}</span></div>
      <dl class="detail-grid">
        <div><dt>GWA / limit</dt><dd>${escapeHtml(row.gwa ?? '—')} / ${escapeHtml(program.max_gwa ?? '—')}</dd></div>
        <div><dt>Units / minimum</dt><dd>${escapeHtml(row.enrolled_units)} / ${escapeHtml(program.min_units ?? '—')}</dd></div>
        <div><dt>Failed / INC / dropped</dt><dd>${escapeHtml(row.failed_count)} / ${escapeHtml(row.incomplete_count)} / ${escapeHtml(row.dropped_count)}</dd></div>
        <div><dt>Submitted</dt><dd>${escapeHtml(displayDate(row.submitted_at))}</dd></div>
        <div class="detail-wide"><dt>Evidence reference</dt><dd>${escapeHtml(row.evidence_reference || '—')}</dd></div>
      </dl>
      ${mode === 'compliance' ? renderPolicyChecks(row, program) : ''}
      ${row.verification_reason ? `<p class="reason-text"><strong>Verification feedback:</strong> ${escapeHtml(row.verification_reason)}</p>` : ''}
      ${row.compliance_reasons.length ? `<ul class="reason-list">${row.compliance_reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}
      ${row.renewal_note ? `<p class="reason-text"><strong>Decision note:</strong> ${escapeHtml(row.renewal_note)}</p>` : ''}
      ${actions}
    </article>`;
  }

  async function handleStaffAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    button.disabled = true;
    try {
      let update;
      if (action === 'verify' || action === 'return') {
        const reason = document.querySelector(`[data-reason-for="${CSS.escape(id)}"]`)?.value.trim() || '';
        if (action === 'return' && !reason) throw new Error('Enter a reason before returning the submission.');
        update = {
          verification_status: action === 'verify' ? 'verified' : 'returned',
          verification_reason: action === 'return' ? reason : null
        };
      } else if (action === 'evaluate') {
        const row = submissions.find(item => String(item.id) === String(id));
        if (!row || row.verification_status !== 'verified') throw new Error('Only verified submissions can be evaluated.');
        const { program } = getRecordContext(row);
        if (!program?.id) throw new Error('The scholar does not have a valid scholarship policy assignment.');
        const reasons = [];
        if (Number(row.gwa) > Number(program.max_gwa)) reasons.push(`GWA ${row.gwa} exceeds the program limit of ${program.max_gwa}.`);
        if (Number(row.enrolled_units) < Number(program.min_units)) reasons.push(`Completed units ${row.enrolled_units} are below the minimum of ${program.min_units}.`);
        if (Number(row.failed_count) > Number(program.max_failed || 0)) reasons.push(`Failed subjects ${row.failed_count} exceed the allowed maximum of ${program.max_failed || 0}.`);
        if (Number(row.incomplete_count) > Number(program.max_incomplete || 0)) reasons.push(`Incomplete grades ${row.incomplete_count} exceed the allowed maximum of ${program.max_incomplete || 0}.`);
        if (Number(row.dropped_count) > Number(program.max_dropped || 0)) reasons.push(`Dropped subjects ${row.dropped_count} exceed the allowed maximum of ${program.max_dropped || 0}.`);
        if (program.deadline && Date.parse(row.submitted_at) > Date.parse(program.deadline)) {
          reasons.push('Submission was received after the program deadline.');
        }
        update = {
          compliance_status: reasons.length ? 'with_deficiency' : 'compliant',
          deficiency_reasons: reasons.join('; '),
          compliance_reasons: reasons,
          evaluated_at: new Date().toISOString(),
          evaluated_by: currentUser.id,
          renewal_status: 'pending',
          renewal_note: null,
          notes: null
        };
      } else {
        const note = document.querySelector(`[data-note-for="${CSS.escape(id)}"]`)?.value.trim() || '';
        if (!note) throw new Error('Enter a decision note before approving or holding renewal.');
        if (action === 'approve') {
          const row = submissions.find(item => String(item.id) === String(id));
          if (!row || row.compliance_status !== 'compliant') throw new Error('Renewal approval requires a compliant evaluation.');
        }
        update = {
          renewal_status: action === 'approve' ? 'approved' : 'held',
          renewal_note: note,
          notes: note,
          decided_by: currentUser.id,
          decided_at: new Date().toISOString()
        };
      }
      const { error } = await client
        .from('submissions')
        .update(update)
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      showMessage(action === 'evaluate'
        ? 'Compliance evaluated using the assigned program policy.'
        : 'Submission updated and activity recorded.', 'success');
      await refreshStaff();
    } catch (error) {
      button.disabled = false;
      showMessage(error.message);
    }
  }

  function renderHistory(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!history.length) {
      container.innerHTML = '<p class="empty-state">No submission activity has been recorded yet.</p>';
      return;
    }
    const actionNames = {
      submitted: 'New submission',
      verified: 'Evidence verified',
      returned: 'Evidence returned',
      evaluated: 'Compliance evaluated',
      renewal_decided: 'Renewal decision recorded',
      corrected_and_resubmitted: 'Correction resubmitted'
    };
    container.innerHTML = history.map(item => {
      const row = submissions.find(submission => String(submission.id) === String(item.submission_id));
      const { scholar } = row ? getRecordContext(row) : { scholar: {} };
      const actor = staffProfiles.find(profile => profile.id === (item.actor_id ?? item.changed_by));
      const detail = item.details?.reason || item.details?.note
        || item.details?.status || item.details?.reasons?.join?.('; ') || '';
      return `<article class="history-item">
        <div><strong>${escapeHtml(actionNames[item.action] || item.action)}</strong>
          <span>${escapeHtml(scholar.full_name || 'Scholar')} · ${escapeHtml(actor?.full_name || actor?.email || 'System')}</span></div>
        <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(displayDate(item.created_at))}</time>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
      </article>`;
    }).join('');
  }

  function renderScholarDirectory() {
    const container = document.getElementById('scholar-directory');
    if (!container) return;
    if (!staffAssignments.length) {
      container.innerHTML = '<p class="empty-state">No scholar assignments yet.</p>';
      return;
    }
    const filterPage = document.querySelector('[data-page="scholars"]');
    const search = filterPage.querySelector('[data-search]').value.trim().toLowerCase();
    const programFilter = filterPage.querySelector('[data-program-filter]').value;
    const rows = staffAssignments.filter(item => {
      const scholar = staffProfiles.find(profile => profile.id === item.scholar_id) || {};
      const text = `${scholar.full_name || ''} ${scholar.student_id || ''} ${scholar.email || ''}`.toLowerCase();
      return (!search || text.includes(search))
        && (!programFilter || String(item.program_id) === programFilter);
    });
    container.innerHTML = rows.length ? rows.map(item => {
      const scholar = staffProfiles.find(profile => profile.id === item.scholar_id) || {};
      const program = programs.find(row => String(row.id) === String(item.program_id)) || {};
      const latest = submissions.find(row => String(row.assignment_id) === String(item.id));
      return `<article class="record-card">
        <div class="record-heading"><div><h3>${escapeHtml(scholar.full_name || 'Scholar')}</h3>
          <p>${escapeHtml(scholar.student_id || 'No student ID')} · ${escapeHtml(scholar.email || '')}</p></div>
          ${statusPill(latest?.compliance_status || 'pending')}</div>
        <dl class="detail-grid"><div><dt>Scholarship program</dt><dd>${escapeHtml(program.name || 'Unassigned')}</dd></div>
          <div><dt>Assigned staff</dt><dd>${escapeHtml(staffProfiles.find(profile => profile.id === item.assigned_by)?.full_name || currentProfile?.full_name || currentUser.email)}</dd></div>
          <div><dt>Latest submission</dt><dd>${escapeHtml(latest ? `${latest.academic_year} · Semester ${latest.semester}` : 'None')}</dd></div>
          <div><dt>Award status</dt><dd>${escapeHtml(statusLabel(item.award_status || 'active'))}</dd></div></dl>
      </article>`;
    }).join('') : '<p class="empty-state">No scholars match this search.</p>';
  }

  function renderStaffNotifications() {
    const container = document.getElementById('staff-notifications');
    if (!container) return;
    const pending = submissions.filter(row => row.verification_status === 'pending').map(row => ({
      created_at: row.submitted_at,
      action: 'pending_submission',
      row,
      detail: 'Submission is waiting for evidence verification.'
    }));
    const recent = history.map(item => ({
      ...item,
      row: submissions.find(submission => String(submission.id) === String(item.submission_id))
    }));
    const now = Date.now();
    const deadlineReminders = programs.filter(program => {
      const deadline = Date.parse(program.deadline);
      const days = (deadline - now) / 86400000;
      return Number.isFinite(days) && days >= 0 && days <= 7;
    }).map(program => ({
      created_at: new Date().toISOString(),
      action: 'deadline',
      detail: `${program.name} submission deadline is ${displayDate(program.deadline)}.`
    }));
    const items = [...pending, ...recent, ...deadlineReminders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    if (!items.length) {
      container.innerHTML = '<p class="empty-state">No notifications yet.</p>';
      return;
    }
    const labels = {
      pending_submission: 'New submission needs verification',
      deadline: 'Upcoming scholarship deadline',
      submitted: 'New submission',
      verified: 'Evidence verified',
      returned: 'Submission returned',
      evaluated: 'Compliance evaluated',
      renewal_decided: 'Renewal decision recorded',
      corrected_and_resubmitted: 'Correction resubmitted'
    };
    container.innerHTML = items.map(item => {
      const { scholar } = item.row ? getRecordContext(item.row) : { scholar: {} };
      const detail = item.detail || item.details?.reason || item.details?.note
        || item.details?.status || item.details?.reasons?.join?.('; ') || '';
      return `<article class="history-item"><div><strong>${escapeHtml(labels[item.action] || item.action)}</strong>
        <span>${escapeHtml(scholar.full_name || 'Scholar')} ${escapeHtml(scholar.student_id || '')}</span></div>
        <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(displayDate(item.created_at))}</time>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</article>`;
    }).join('');
  }

  function downloadReport(kind) {
    const year = document.querySelector('[data-report-year]').value.trim();
    const semester = Number(document.querySelector('[data-report-semester]').value);
    const rows = submissions.filter(row => row.academic_year === year && row.semester === semester);
    const selected = rows.filter(row => {
      if (kind === 'compliant') return row.compliance_status === 'compliant';
      if (kind === 'with_deficiency') return row.compliance_status === 'with_deficiency';
      if (kind === 'pending') return row.verification_status === 'pending';
      if (kind === 'renewals') return row.renewal_status !== 'pending';
      return true;
    });
    const columns = ['Student ID', 'Scholar', 'Email', 'Program', 'Academic Year', 'Semester', 'GWA',
      'Completed Units', 'Failed', 'Incomplete', 'Dropped', 'Submitted At', 'Verification',
      'Compliance', 'Deficiency Reasons', 'Renewal', 'Decision Note'];
    const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csvRows = selected.map(row => {
      const { scholar, program } = getRecordContext(row);
      return [
        scholar.student_id, scholar.full_name, scholar.email, program.name,
        row.academic_year, row.semester, row.gwa, row.enrolled_units, row.failed_count,
        row.incomplete_count, row.dropped_count, row.submitted_at, row.verification_status,
        row.compliance_status, row.compliance_reasons.join('; '), row.renewal_status, row.renewal_note
      ].map(csvEscape).join(',');
    });
    const blob = new Blob([[columns.map(csvEscape).join(','), ...csvRows].join('\r\n')], {
      type: 'text/csv;charset=utf-8'
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `scholarship-${kind}-${year}-semester-${semester}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showMessage(`Exported ${selected.length} records.`, 'success');
  }

  async function refresh() {
    if (role === 'staff') await refreshStaff();
    else await refreshScholar();
  }

  start().catch(error => {
    showMessage(error.message || 'Unable to load the dashboard.');
  });
})();
