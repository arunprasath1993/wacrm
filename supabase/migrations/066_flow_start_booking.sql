-- ============================================================
-- 066 — Flows: `start_booking` node type
--
-- Lets a flow hand the chat to the AI booking assistant and pick the
-- run back up once the booking is saved. The node's config lives in
-- the existing `flow_nodes.config` JSONB:
--   { booking_type_id?: uuid, text: string, next_node_key?: string }
--
-- Only the node_type CHECK changes. The run parks on the node with
-- status 'active' (no new run status) and reuses the existing
-- flow_run_events event types.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'start_booking',
    'handoff',
    'http_fetch',
    'end'
  ));
