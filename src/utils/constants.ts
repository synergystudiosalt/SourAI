/**
 * App-wide hardcoded constants. Keeping these in one place makes the
 * "hardcoded" values easy to audit and change in a single spot.
 */

/** Total number of chat/agent messages a workspace is allowed to send before hitting the usage wall. */
export const MESSAGE_QUOTA = 120;

/** Hard ceiling on how many sub-agents the sour.ai Agent may run concurrently. */
export const MAX_CONCURRENT_SUBAGENTS = 4;
