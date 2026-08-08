'use strict';

/** Minimal stand-in for integrations/continuum-bridge/emailMove used by tests. */
module.exports.runImapCopyBatched = async (imapScript, uids, destFolder) => ({
  success: true,
  uids,
  action: 'copied_to_folder',
  destination_mailbox: destFolder,
  count: uids.length,
  batches: 1,
});
