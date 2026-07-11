'use strict';

module.exports = {
  version: '2026.07.11i',
  features: {
    date_range: true,
    date_range_mode: 'recent_lookback_filter',
    pagination: true,
    lite_fetch: true,
    max_limit: 50000,
    cleanup_delete_max: 10000,
    daily_cleanup: true,
    never_trash_senders: true,
    move_to_folder: true,
    web_search: true,
    sender_rule_trash: true,
    background_email_jobs: true,
    year_cleanup: true,
    year_cleanup_checkpoint: true,
    year_cleanup_weekly_slices: true,
    email_job_cancel: true,
    email_job_progress_log: true,
    email_cleanup_preview: true,
  },
};
