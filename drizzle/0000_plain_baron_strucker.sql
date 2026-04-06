CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`company_id` text NOT NULL,
	`period_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`kpi_definition_id` text NOT NULL,
	`severity` text NOT NULL,
	`message` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kpi_definition_id`) REFERENCES `kpi_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_submission_def_idx` ON `alerts` (`submission_id`,`kpi_definition_id`);--> statement-breakpoint
CREATE INDEX `alerts_firm_company_period_idx` ON `alerts` (`firm_id`,`company_id`,`period_id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`industry` text,
	`submission_token` text NOT NULL,
	`linked_at` text,
	`link_mode` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_submission_token_unique` ON `companies` (`submission_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_firm_slug_idx` ON `companies` (`firm_id`,`slug`);--> statement-breakpoint
CREATE TABLE `email_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`reminder_subject` text DEFAULT 'Action Required: KPI Submission for {{period}}' NOT NULL,
	`reminder_body` text DEFAULT 'Dear {{company_name}},

This is a reminder that your KPI submission for {{period}} is due by {{due_date}}.

Please submit your data using the link below:
{{submission_link}}

Required documents:
{{required_docs}}

Thank you.' NOT NULL,
	`from_email` text DEFAULT 'noreply@portcopulse.com' NOT NULL,
	`from_name` text DEFAULT 'PortCo Pulse' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_settings_firm_id_unique` ON `email_settings` (`firm_id`);--> statement-breakpoint
CREATE TABLE `financial_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`company_id` text NOT NULL,
	`period_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`document_type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`uploaded_by_user_id` text,
	`uploaded_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fin_docs_submission_type_version_idx` ON `financial_documents` (`submission_id`,`document_type`,`version`);--> statement-breakpoint
CREATE INDEX `fin_docs_submission_id_idx` ON `financial_documents` (`submission_id`);--> statement-breakpoint
CREATE TABLE `firm_link_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text,
	`created_by_user_id` text NOT NULL,
	`link_mode` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firm_link_tokens_token_unique` ON `firm_link_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `firms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`org_type` text DEFAULT 'pe_firm' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kpi_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`scope` text NOT NULL,
	`company_id` text,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`section` text,
	`unit` text,
	`value_type` text NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_defs_firm_key_company_idx` ON `kpi_definitions` (`firm_id`,`key`,`company_id`);--> statement-breakpoint
CREATE TABLE `kpi_values` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`firm_id` text NOT NULL,
	`company_id` text NOT NULL,
	`period_id` text NOT NULL,
	`kpi_definition_id` text NOT NULL,
	`actual_number` real,
	`actual_text` text,
	`target_number` real,
	`target_text` text,
	`target_date` text,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kpi_definition_id`) REFERENCES `kpi_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_values_submission_def_idx` ON `kpi_values` (`submission_id`,`kpi_definition_id`);--> statement-breakpoint
CREATE INDEX `kpi_values_firm_company_idx` ON `kpi_values` (`firm_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `kpi_values_firm_period_idx` ON `kpi_values` (`firm_id`,`period_id`);--> statement-breakpoint
CREATE INDEX `kpi_values_period_id_idx` ON `kpi_values` (`period_id`);--> statement-breakpoint
CREATE INDEX `kpi_values_submission_id_idx` ON `kpi_values` (`submission_id`);--> statement-breakpoint
CREATE TABLE `periods` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`period_type` text NOT NULL,
	`period_start` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `periods_firm_type_start_idx` ON `periods` (`firm_id`,`period_type`,`period_start`);--> statement-breakpoint
CREATE INDEX `periods_firm_id_idx` ON `periods` (`firm_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`company_id` text NOT NULL,
	`period_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text,
	`submitted_by_user_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`period_id`) REFERENCES `periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_company_period_idx` ON `submissions` (`company_id`,`period_id`);--> statement-breakpoint
CREATE INDEX `submissions_firm_company_period_idx` ON `submissions` (`firm_id`,`company_id`,`period_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE INDEX `submissions_period_id_idx` ON `submissions` (`period_id`);--> statement-breakpoint
CREATE TABLE `threshold_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`company_id` text,
	`kpi_definition_id` text NOT NULL,
	`rule_type` text NOT NULL,
	`threshold_value` real NOT NULL,
	`severity` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kpi_definition_id`) REFERENCES `kpi_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`firm_id` text NOT NULL,
	`company_id` text,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`role` text NOT NULL,
	`persona` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);