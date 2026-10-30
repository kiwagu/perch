/**
 * How many update-log rows past its snapshot a region holds before it is compacted: on the
 * server, which then asks the pushing device for a snapshot, and on a device, whose leading tab
 * compacts its local log on a full pass.
 */
export const COMPACTION_LOG_LIMIT = 200
