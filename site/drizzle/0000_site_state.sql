CREATE TABLE `site_state` (
  `id` text PRIMARY KEY NOT NULL,
  `revision` integer NOT NULL DEFAULT 1,
  `state_json` text NOT NULL,
  `updated_at` text NOT NULL
);
