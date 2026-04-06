ALTER TABLE `companies` ADD `timezone` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `partner_email` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `required_docs` text;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `submission_due_days` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE `financial_documents` ADD `included_statements` text;--> statement-breakpoint
ALTER TABLE `kpi_definitions` ADD `description` text;