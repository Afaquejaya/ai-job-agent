-- Job search from the CV (D-049): a new background task kind.
ALTER TABLE "agent_tasks" DROP CONSTRAINT "agent_tasks_kind";
ALTER TABLE "agent_tasks"
  ADD CONSTRAINT "agent_tasks_kind" CHECK ("kind" IN (
    'job_match_analysis', 'cv_processing', 'job_search', 'daily_discovery', 'job_application',
    'cv_analysis', 'email_outreach', 'morning_report'));
